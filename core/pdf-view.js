import './pdf-text.js';
import './pdf-layout.js';
const {warningText,ocrRuns,scriptTokens,scriptCut,splitPoints,MIN_FIT,MIN_FIT_LINE,TAIL_FIT,HARD_FIT,repairPages,maskPads,settleMasks,markSame,figureTop,applyFlow,emphasis,formulaOnly,sectionHeading,backgroundSample,expandLayoutBlocks,textLines,paragraphs,layoutBlocks,reconcilePage,sectionDocument,layoutCollisions,pageTypography}=globalThis.appPdfLayout,{collisionHoles,holeFloats,holeClip}=globalThis.appPdfLayout;
// The page's tr() (core/i18n.js is loaded before the reader), as markdown.js uses it.
const tr=(...args)=>globalThis.tr(...args);
// A section without a heading of its own (no sourceTitle) has the name pdf-layout.js gives it, named on this
// screen; a section named by a heading in the paper keeps its title as translated.
const sectionName=s=>s.sourceTitle!==undefined?s.title:s.role==='metadata'&&s.title==='문서 정보'?tr('문서 정보'):s.role==='body'&&s.title==='본문'?tr('본문'):s.title; // i18n:keep — the names pdf-layout.js gives
let enginePromise;
// What the reader asks of the app around it: the bytes and hash of an original (readOriginal,
// originalHash), a page read by OCR (ocrPage, optional) and a link opened outside (openPdfLink).
// The desktop app's preload gives these as window.appApi; another shell names its own (setHost).
let shell=null;
const host=()=>shell||globalThis.appApi||{};
export function setHost(next){shell=next||null;}
// A scroll handler that reads page layout runs at most once per frame.
const perFrame=fn=>{let queued=false;return ()=>{if(queued)return;queued=true;requestAnimationFrame(()=>{queued=false;fn();});};};
const documents = new Map();
const handles = new Map(), images = new Map();
async function engine(){
  if(!enginePromise)enginePromise=import('./pdfjs/pdf.mjs').then(pdfjs=>{pdfjs.GlobalWorkerOptions.workerSrc=new URL('./pdfjs/pdf.worker.mjs',location.href).href;return pdfjs;});
  return enginePromise;
}
export async function documentFor(id,paperId,refresh=false,attachmentId){
  const handleKey=id+':'+paperId+':'+(attachmentId||'primary');
  // A refresh re-reads the PDF only when its bytes changed on disk.
  if(refresh&&handles.has(handleKey)){try{const [open,hash]=await Promise.all([handles.get(handleKey),host().originalHash(id,paperId,attachmentId)]);if(open.hash===hash)return open;}catch{/* a handle that cannot be checked is opened again below */}handles.delete(handleKey);}
  if(handles.has(handleKey))return handles.get(handleKey);
  const pending=loadDocument(id,paperId,attachmentId);handles.set(handleKey,pending);try{return await pending}catch(error){handles.delete(handleKey);throw error}
}
async function loadDocument(id,paperId,attachmentId){
  const data=await host().readOriginal(id,paperId,attachmentId),key=id+':'+paperId+':'+data.hash;
  if(!documents.has(key)){
    const pdfjs=await engine();
    const task=pdfjs.getDocument({data:new Uint8Array(data.bytes),fontExtraProperties:true,disableAutoFetch:true,cMapUrl:new URL('./pdfjs/cmaps/',location.href).href,cMapPacked:true,standardFontDataUrl:new URL('./pdfjs/standard_fonts/',location.href).href,wasmUrl:new URL('./pdfjs/wasm/',location.href).href,isEvalSupported:false});
    task.onPassword=()=>{task.destroy();};
    documents.set(key,task.promise.catch(error=>{documents.delete(key);throw error;}));
    evictDocuments().catch(()=>{});
  }else{const pending=documents.get(key);documents.delete(key);documents.set(key,pending);}
  documentUsed.set(key,Date.now());
  return {pdf:await documents.get(key),hash:data.hash};
}
// Parsed documents (with their bytes in the worker) and page images are kept
// for the few most recently opened PDFs; older ones that no viewer shows are
// destroyed, so browsing many papers does not grow memory without end.
const KEEP_DOCUMENTS=6,documentUsed=new Map();
async function evictDocuments(){
  for(const [key,pending] of documents){
    if(documents.size<=KEEP_DOCUMENTS)return;
    const pdf=await pending.catch(()=>null);if(!pdf){documents.delete(key);continue;}
    // Shown in a viewer, or asked for in the last two minutes (an extraction or comparison may still be reading it).
    if(Date.now()-(documentUsed.get(key)||0)<120000||[...document.querySelectorAll('.original-pages,.translated-pages')].some(c=>c.pdfViewer?.pdfDocument===pdf))continue;
    documents.delete(key);documentUsed.delete(key);images.delete(pdf);for(const [handleKey,handle] of handles)if(await handle.then(h=>h.pdf===pdf,()=>true))handles.delete(handleKey);
    pdf.destroy().catch(()=>{});
  }
}
// The paper's paragraphs for translation and AI requests: each page is read
// once per open PDF (the same reading the translated view reconciles with)
// and the whole paper is structured once. A few pages are in flight at a
// time, so the PDF worker parses one while this thread lays out another.
// Asking again while it runs joins the same work; onProgress(done,total)
// reports pages read.
const structuredDocs=new WeakMap();
export function structuredPages(pdf,hash,onProgress){
  let entry=structuredDocs.get(pdf);
  if(!entry||entry.hash!==hash){
    entry={hash,done:0,listeners:new Set()};const run=entry;
    entry.promise=(async()=>{
      if(pdf.numPages>500)throw Error(tr('500페이지 이하 PDF만 번역할 수 있습니다.'));
      const pages=new Array(pdf.numPages);let next=1;
      await Promise.all(Array.from({length:Math.min(4,pdf.numPages)},async()=>{
        while(next<=pdf.numPages){const n=next++;pages[n-1]=await canonicalPage(pdf,n);run.done++;for(const listener of run.listeners)listener(run.done,pdf.numPages);}
      }));
      return globalThis.appPdfLayout.structureTranslationPages(pages,hash);
    })();
    entry.promise.then(()=>run.listeners.clear(),()=>{run.listeners.clear();if(structuredDocs.get(pdf)===run)structuredDocs.delete(pdf);});
    structuredDocs.set(pdf,entry);
  }
  if(onProgress&&entry.done<pdf.numPages){entry.listeners.add(onProgress);onProgress(entry.done,pdf.numPages);}
  return entry.promise;
}
const ocrPages=new Map();
// A scan whose text layer is a patchwork: an old capture tool cut the page into many small
// pictures and put its own reading behind them as hidden text, piece by piece. Such a layer
// breaks paragraphs into fragments ("solu-", "to a" as paragraphs of their own) and carries
// the tool's misreadings. Its pieces are joined line by line (joinLinePieces), and the page
// is translated with its picture like a page read by OCR, for what the tool misread.
// The test is on the page's own drawing, and strict: text that is (almost) all hidden, over
// many small pictures. A scan with one page picture and a hidden layer (a "searchable
// image"), a born-digital page with figures, and a slide are not this, and stay as they are.
// The first three pages decide whether the document is looked at at all, so an ordinary
// PDF pays for at most three operator lists.
const patchworkDocs=new WeakMap();
async function patchworkPage(pdf,index,page,pdfjs){
  let doc=patchworkDocs.get(pdf);if(!doc){doc={pages:new Map(),gate:null};patchworkDocs.set(pdf,doc);}
  const OPS=pdfjs.OPS,shows=[OPS.showText,OPS.showSpacedText,OPS.nextLineShowText,OPS.nextLineSetSpacingShowText].filter(Number.isFinite),pictures=[OPS.paintImageXObject,OPS.paintInlineImageXObject,OPS.paintImageMaskXObject,OPS.paintImageXObjectRepeat].filter(Number.isFinite);
  const check=(n,given)=>{
    if(!doc.pages.has(n))doc.pages.set(n,(async()=>{
      const target=given||await pdf.getPage(n),ops=await target.getOperatorList();let mode=0,hidden=0,visible=0,images=0;
      for(let i=0;i<ops.fnArray.length;i++){const f=ops.fnArray[i];if(f===OPS.setTextRenderingMode)mode=ops.argsArray[i]?.[0];else if(shows.includes(f)){if(mode===3)hidden++;else visible++;}else if(pictures.includes(f))images++;}
      if(!given)target.cleanup();
      return images>=8&&hidden>=20&&hidden>=visible*4;
    })().catch(()=>false));
    return doc.pages.get(n);
  };
  if(!doc.gate)doc.gate=(async()=>{for(let n=1;n<=Math.min(3,pdf.numPages);n++)if(await check(n,n===index?page:null))return true;return false;})();
  return await doc.gate?check(index,page):false;
}
// The words of one line of a patchwork layer, as one piece. The layer's glyph widths are not
// the scan's, so its word gaps come out wide and uneven, and line up down a column like the
// gap between two columns ("solu-", "to a" then stand apart as paragraphs). The layer itself
// says where each line ends (hasEOL), so pieces are joined up to there: same baseline, moving
// right, no further apart than a wide word gap (1.7em: wider, and the gap between two
// columns is crossed, since the layer puts its spaces there as well).
function joinLinePieces(items){
  const out=[],wide=[],row=new Map();let last=null,broken=true,line=null;
  const add=(to,item)=>{to.str+=(/\s$/.test(to.str)?'':' ')+item.str;to.width=item.transform[4]+item.width-to.transform[4];};
  for(const item of items){
    if(!item.str?.trim()){if(item.hasEOL)broken=true;continue;}
    const t=item.transform,flat=Math.abs(t[1])<1e-3&&Math.abs(t[2])<1e-3,size=Math.hypot(t[2],t[3]);
    let from=null;
    if(last&&!broken&&flat&&last.flat&&Math.abs(t[5]-last.item.transform[5])<=size*.3&&Math.abs(size-last.size)<=Math.max(size,last.size)*.35){
      const gap=t[4]-(last.item.transform[4]+last.item.width);
      if(gap>=-size*.5&&gap<=size*1.7){
        // A run-in heading measured smaller than the sentence after it ("PLSR." at 8, the line at 10.6): the line takes the size of its longer part.
        if(Math.abs(size-last.size)>size*.05){last.other+=item.str.length;if(last.other>last.own){const k=size/last.size,lt=last.item.transform;lt[0]*=k;lt[3]*=k;last.size=size;[last.own,last.other]=[last.other,last.own];}}else last.own+=item.str.length;
        add(last.item,item);line.x1=t[4]+item.width;broken=Boolean(item.hasEOL);continue;}
      if(gap>0&&gap<=size*3.5)from=last.item;
    }
    last={item:{...item,transform:[...t]},flat,size,own:item.str.length,other:0};out.push(last.item);broken=Boolean(item.hasEOL);
    // `line`: the pieces the layer sets as one line, from its first piece to its line end.
    if(!from)line={x0:t[4],x1:t[4]};line.x1=t[4]+item.width;row.set(last.item,line);
    if(from)wide.push([from,last.item,size]);
  }
  // A line justified hard has word gaps as wide as the gap between two columns. Such a gap
  // is a word gap where a line close by runs across it: no line crosses a column gap.
  // The witnesses are lines within three lines of it, as they stand before any such gap is
  // closed, that start and end where its own line does (a running head above the first
  // line crosses the column gap, and is no such line).
  const gone=new Map(),root=item=>{while(gone.has(item))item=gone.get(item);return item;},box=out.map(o=>[o.transform[4],o.transform[4]+o.width,o.transform[5]]);
  const word=wide.filter(([from,item,size])=>{const left=from.transform[4]+from.width,right=item.transform[4],y=item.transform[5],own=row.get(item);return box.some(([x0,x1,oy])=>Math.abs(oy-y)<=size*3.2&&Math.abs(oy-y)>size*.5&&x0<=left-size&&x1>=right+size&&Math.abs(x0-own.x0)<=size*3&&x1<=own.x1+size*3);});
  for(const [from,item] of word){add(root(from),item);gone.set(item,root(from));}
  for(let i=out.length-1;i>=0;i--)if(gone.has(out[i]))out.splice(i,1);
  // The tool measured each line's type on its own (10.6, 11.5, 12.8 pt for one text face), and
  // a paragraph would break wherever the size changes. Lines within 15% of the page's most
  // common size take that size.
  const sizes=new Map();for(const item of out){const size=Math.round(Math.hypot(item.transform[2],item.transform[3])*10)/10;sizes.set(size,(sizes.get(size)||0)+item.str.length);}
  const common=[...sizes].sort((a,b)=>b[1]-a[1])[0]?.[0];
  if(common)for(const item of out){const t=item.transform,size=Math.hypot(t[2],t[3]);if(size!==common&&Math.abs(size-common)<=common*.15&&Math.abs(t[1])<1e-3&&Math.abs(t[2])<1e-3){const k=common/size;t[0]*=k;t[3]*=k;if(item.height)item.height*=k;}}
  // The layer's glyphs are narrower than the scan's, so a full line stops a little short of
  // its column's edge and would read as a paragraph's last line. A line ending within 1.5em
  // of the furthest line end of its column (lines close by starting where it starts) reaches it.
  const edge=out.map(item=>{const t=item.transform,size=Math.hypot(t[2],t[3]),right=t[4]+item.width;
    const far=Math.max(...out.filter(o=>Math.abs(o.transform[4]-t[4])<=size*3&&Math.abs(o.transform[5]-t[5])<=size*8).map(o=>o.transform[4]+o.width));
    return far>right&&far-right<=size*1.5?far:right;});
  out.forEach((item,i)=>{item.width=edge[i]-item.transform[4];});
  // An accent drawn over a letter (the bar of "c̄", a hat) was read by the tool as a line of
  // its own between two text lines ("-", "- -1"). Lying inside the paragraph's box, it would
  // keep the whole paragraph from being translated in place. A short piece without a letter,
  // holding such a mark, set between the baselines of the lines it overlaps, is dropped.
  const mark=item=>item.str.trim().length<=5&&!/\p{L}/u.test(item.str)&&/[-–—_~^¯ˉ'`.]/.test(item.str);
  return out.filter(item=>{
    if(!mark(item))return true;
    const t=item.transform,size=Math.hypot(t[2],t[3]);
    return !out.some(o=>{if(o===item||o.str.trim().length<10)return false;const dy=Math.abs(o.transform[5]-t[5]);return dy>=size*.25&&dy<=size*.8&&o.transform[4]<t[4]+item.width&&o.transform[4]+o.width>t[4];});
  });
}
async function ocrWords(pdf,index,page,viewport,runs,pdfjs){
  if(!host().ocrPage||runs.reduce((n,r)=>n+String(r.text).replace(/\s/g,'').length,0)>=80)return [];
  const key=`${String(pdf.fingerprints?.[0]||'pdf').replace(/[^A-Za-z0-9]/g,'').slice(0,48)}-${index}`;
  if(!ocrPages.has(key))ocrPages.set(key,(async()=>{
    const ops=await page.getOperatorList(),pictures=[pdfjs.OPS.paintImageXObject,pdfjs.OPS.paintInlineImageXObject,pdfjs.OPS.paintImageXObjectRepeat].filter(Number.isFinite);
    if(!ops.fnArray.some(f=>pictures.includes(f)))return [];
    const {canvas}=await renderCanvas(pdf,index),scale=canvas.width/viewport.width;
    const png=new Uint8Array(await (await new Promise(resolve=>canvas.toBlob(resolve,'image/png'))).arrayBuffer());canvas.width=canvas.height=0;
    const result=await host().ocrPage(`${key}-${Math.round(scale*100)}`,png);
    return ocrRuns(result?.lines,scale,[],index);
  })().catch(error=>{console.error('OCR',error);ocrPages.delete(key);return [];}));
  const words=await ocrPages.get(key);
  // Words over text the PDF already has (a slide's title) are not read twice.
  return ocrRuns.length?words.filter(w=>!runs.some(r=>{const ix=Math.min(r.x+r.width,w.x+w.width)-Math.max(r.x,w.x),iy=Math.min(r.y+r.height,w.y+w.height)-Math.max(r.y,w.y);return ix>0&&iy>0&&ix*iy>=w.width*w.height*.3;})):[];
}
// layer: the page's own text layer even where it is a patchwork (see canonicalFor).
export async function extractPage(pdf,index,layer=false){
  const pdfjs=await engine();
  if(pdf.numPages>500)throw Error(tr('500페이지 이하 PDF만 번역할 수 있습니다.'));

    const page=await pdf.getPage(index),viewport=page.getViewport({scale:4/3}),content=await page.getTextContent(),runs=[],rotated=[];
    // Embedded font names exist only after the page fonts are loaded. They
    // identify bold field labels and serif text; heading rules stay unchanged.
    // Parse only pages with a field label or caption candidate, and release
    // the operator list right away (fonts stay document-wide), so extracting
    // a long paper neither re-parses every page nor keeps its images.
    const fonts=content.items.some(item=>/^\s*(?:[A-Z][A-Za-z ]{1,30}:|(?:fig(?:ure)?\.?|table)\s*[A-Z]?\d)/i.test(item.str||''));
    if(fonts)await page.getOperatorList().catch(()=>{});
    const embedded=name=>{try{return page.commonObjs.has(name)&&page.commonObjs.get(name)?.name||'';}catch{return '';}};
    // A patchwork layer (patchworkPage) is read line by line; `layer` asks for it as it is.
    const joined=!layer&&await patchworkPage(pdf,index,page,pdfjs).catch(()=>false);
    for(const item of joined?joinLinePieces(content.items):content.items){
      if(!item.str?.trim())continue;
      const tx=pdfjs.Util.transform(viewport.transform,item.transform),size=Math.hypot(tx[2],tx[3]);
      const x=Math.max(0,tx[4]),ascent=Math.min(1,Math.max(.6,content.styles[item.fontName]?.ascent||.8)),y=Math.max(0,tx[5]-size*ascent),width=Math.min(viewport.width-x,item.width*4/3+1),height=Math.min(viewport.height-y,size);
      if(width<=0||height<=0||size<=0)continue;
      // Text set at an angle (a download stamp up the margin, an arXiv
      // identifier, a rotated axis title) stays as drawn and is never
      // translated in place. Its box as older versions measured it lets
      // reconcilePage drop such stamps from translations made then.
      if(Math.abs(Math.atan2(tx[1],tx[0]))>.2){rotated.push({x,y,width,height});continue;}
      // `heavy` (embedded bold) drives labels and emphasis only; the `bold`
      // heading rule in headingLine is not fed from extraction.
      const family=content.styles[item.fontName]?.fontFamily||'',real=embedded(item.fontName);
      runs.push({x,y,width,height,fontSize:size,baseline:tx[5],text:item.str,fontName:real||family||item.fontName,heavy:/bold|black|demi|heavy|semibold/i.test(real),serif:serifFont(real,family)});
    }
    if(fonts)page.cleanup();
    // A page with almost no text over a picture (slides exported as images, a
    // scan) is read by local OCR; its words join the PDF's own runs.
    // A slide may keep only its bullets ("•") as PDF text over the picture of its words: once OCR reads the
    // page, those glyphs give way to OCR's own (read as "e", "o" or "•" at each line's head), so each bullet
    // stays with its line instead of standing apart in another size.
    const bullet=r=>/^[•◦▪●○■□‣⁃]$/.test(String(r.text).trim()),read=await ocrWords(pdf,index,page,viewport,runs.filter(r=>!bullet(r)),pdfjs);
    if(read.length)for(let i=runs.length-1;i>=0;i--)if(bullet(runs[i]))runs.splice(i,1);
    runs.push(...read);
    // `ocr` marks a page read from its picture, by local OCR or by the tool that made a patchwork layer: its translation is asked with the picture (ocrPageImage).
    return {width:viewport.width,height:viewport.height,blocks:paragraphs(textLines(runs),viewport.width,viewport.height,index),...(rotated.length?{rotatedMarks:rotated}:{}),...(read.length||joined?{ocr:true}:{}),...(joined?{joined:true}:{})};
}
// Embedded names decide first; PDF.js derives `family` from the font flags.
function serifFont(name,family){
  if(/sans|arial|helvetica|gothic|frutiger|univers|myriad|verdana|tahoma|calibri|roboto|lato|source ?code|mono|courier/i.test(name))return false;
  if(/serif|times|minion|roman|garamond|georgia|palatino|cambria|charter|baskerville|caslon|libertine|utopia|stix|bookman|century|batang|myeongjo|mincho|song|cmr\d|lmroman|nimbusrom/i.test(name))return true;
  return family==='serif';
}
export async function imageFor(pdf,index){
  let cache=images.get(pdf);if(!cache){cache=new Map();images.set(pdf,cache);}if(cache.has(index))return cache.get(index);
  const task=renderImage(pdf,index);cache.set(index,task);try{const result=await task;while(cache.size>8)cache.delete(cache.keys().next().value);return result}catch(error){cache.delete(index);throw error}
}
// The page drawn at export resolution (at most 4 megapixels).
async function renderCanvas(pdf,index,options){
  const page=await pdf.getPage(index),base=page.getViewport({scale:4/3}),scale=Math.min(1.5,Math.sqrt(4000000/(base.width*base.height))),viewport=page.getViewport({scale:4/3*scale}),canvas=document.createElement('canvas');
  canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
  const context=canvas.getContext('2d',options);await page.render({canvasContext:context,viewport}).promise;
  return {canvas,context};
}
// A page read by OCR as the model sees it beside the OCR text: PNG, at most 1600 px wide.
export async function ocrPageImage(pdf,index){
  const page=await pdf.getPage(index),base=page.getViewport({scale:1}),viewport=page.getViewport({scale:Math.min(2,1600/base.width)}),canvas=document.createElement('canvas');
  canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);await page.render({canvasContext:canvas.getContext('2d'),viewport}).promise;
  const url=canvas.toDataURL('image/png');canvas.width=canvas.height=0;return url;
}
async function renderImage(pdf,index){
  const {canvas}=await renderCanvas(pdf,index),result=canvas.toDataURL('image/png');canvas.width=0;canvas.height=0;return result;
}
// Bound high-resolution background samples across documents, not per document.
const pixelPages=[];
async function pagePixels(pdf,index){
  let entry=pixelPages.find(item=>item.pdf===pdf&&item.index===index);
  if(!entry){
    entry={pdf,index,promise:(async()=>{
      // Read straight from the drawn page: the same pixels as the exported
      // PNG (lossless) without encoding and decoding it.
      const {canvas,context}=await renderCanvas(pdf,index,{willReadFrequently:true}),pixels=context.getImageData(0,0,canvas.width,canvas.height);canvas.width=canvas.height=0;return pixels;
    })()};pixelPages.push(entry);while(pixelPages.length>3)pixelPages.shift();
  }
  try{return await entry.promise;}catch(error){const at=pixelPages.indexOf(entry);if(at>=0)pixelPages.splice(at,1);throw error;}
}
let viewerModule;
const canonicalPages=new WeakMap();
async function canonicalPage(pdf,index,layer=false){
  let cache=canonicalPages.get(pdf);if(!cache){cache=new Map();canonicalPages.set(pdf,cache);}
  const key=layer?`layer-${index}`:index;
  if(!cache.has(key)){const pending=extractPage(pdf,index,layer);cache.set(key,pending);pending.catch(()=>{if(cache.get(key)===pending)cache.delete(key);});}
  return cache.get(key);
}
// The page a stored translation is checked against. A translation made before a patchwork page
// was read line by line holds the raw layer's paragraphs: it keeps being shown against that,
// exactly as it was, until the page is translated again. Nothing is stored for this: the stored
// paragraphs themselves say which reading they came from.
export async function canonicalFor(pdf,index,stored){
  const page=await canonicalPage(pdf,index);if(!page.joined||!stored?.blocks?.length)return page;
  const layer=await canonicalPage(pdf,index,true),same=p=>{const by=new Map(p.blocks.map(b=>[b.id,b.text]));return stored.blocks.filter(b=>by.get(b.id)===b.text).length;};
  return same(layer)>same(page)?layer:page;
}
// A link drawn over a translated paragraph no longer points at its words
// (they moved or became Korean), so it shows neither a box nor a target there.
function unmatchLinks(sheet){
  const blocks=[...sheet.querySelectorAll(':scope>.translation-layer>.translated-block:not(.source-preserved)')].map(n=>n.getBoundingClientRect());
  for(const link of sheet.querySelectorAll('.annotationLayer .linkAnnotation')){
    const r=link.getBoundingClientRect(),area=Math.max(1,r.width*r.height);
    const covered=blocks.reduce((sum,b)=>sum+Math.max(0,Math.min(r.right,b.right)-Math.max(r.left,b.left))*Math.max(0,Math.min(r.bottom,b.bottom)-Math.max(r.top,b.top)),0);
    link.classList.toggle('link-unmatched',covered>area/2);
  }
}
async function ensureViewer(container,pdf,translated=false){
  if(container.viewerPromise)return container.viewerPromise;
  container.classList.add('native-pdf');
  container.viewerPromise=(async()=>{
    await engine();viewerModule ||= import('./pdfjs/pdf_viewer.mjs');
    const {PDFViewer,PDFLinkService,PDFFindController,EventBus}=await viewerModule;
    if(!container.isConnected)return null;
    const inner=document.createElement('div');inner.className='pdfViewer';container.replaceChildren(inner);
    const eventBus=new EventBus(),linkService=new PDFLinkService({eventBus,externalLinkTarget:2,externalLinkRel:'noopener noreferrer'}),findController=new PDFFindController({eventBus,linkService}),lifetime=new AbortController();
    const viewer=new PDFViewer({container,viewer:inner,eventBus,linkService,findController,removePageBorders:true,annotationMode:2,annotationEditorMode:-1,enableSelectionRendering:false,enableDetailCanvas:false,maxCanvasPixels:4000000,maxCanvasDim:8192,capCanvasAreaFactor:-1,imageResourcesPath:new URL('./pdfjs/images/',location.href).href,abortSignal:lifetime.signal});
    linkService.setViewer(viewer);linkService.setDocument(pdf);
    const controller={viewer,eventBus,linkService,findController,plans:new Map(),continuations:new Map(),onPage:null,disposed:false,fit(zoom=1){
      if(!viewer.pagesCount||controller.disposed)return;
      const first=viewer.getPageView(0),base=first.pdfPage?.getViewport({scale:4/3}).width||first.viewport.width/viewer.currentScale;
      const box=getComputedStyle(container),width=container.clientWidth-(parseFloat(box.paddingLeft)||0)-(parseFloat(box.paddingRight)||0);const scale=Math.max(.05,width/base*zoom); // the room between the container's own insets
      if(Math.abs(viewer.currentScale-scale)>.001)viewer.currentScale=scale;
      for(let i=0;i<viewer.pagesCount;i++){
        const pageView=viewer.getPageView(i),sheet=pageView.div;
        sheet.dataset.page=i+1;sheet.classList.add(translated?'translated-sheet':'pdf-source-sheet');sheet.style.width=pageView.viewport.width+'px';sheet.style.height=pageView.viewport.height+'px';sheet.style.zoom=1;
        const continuation=controller.continuations.get(i);
        if(continuation){continuation.style.width=pageView.viewport.width+'px';continuation.style.setProperty('--section-scale',String(pageView.viewport.width/Number(continuation.dataset.sourceWidth)));}
        const layer=sheet.querySelector('.translation-layer');if(layer)layer.style.transform=`scale(${pageView.viewport.width/Number(layer.dataset.sourceWidth)})`;
      }
      const last=viewer.getPageView(viewer.pagesCount-1);inner.style.paddingBottom=Math.max(0,container.clientHeight-last.viewport.height)+'px';
      viewer.update();
    },find(query,again=false,previous=false){eventBus.dispatch('find',{source:container,type:again?'again':'',query,caseSensitive:false,entireWord:false,highlightAll:true,findPrevious:previous});},dispose(){if(controller.disposed)return;controller.disposed=true;lifetime.abort();viewer.setDocument(null);findController.setDocument(null);}};
    container.pdfController=controller;container.pdfViewer=viewer;container.observer={disconnect:()=>controller.dispose()};
    eventBus.on('pagerendered',event=>{const pageView=viewer.getPageView(event.pageNumber-1);if(!pageView||controller.disposed)return;pageView.div.dataset.ready='true';controller.onPage?.(pageView,event.pageNumber-1);container.dispatchEvent(new CustomEvent('app-pagerendered',{detail:{pageView,index:event.pageNumber-1}}));});
    if(translated)eventBus.on('annotationlayerrendered',event=>{const pageView=viewer.getPageView(event.pageNumber-1);if(pageView&&!controller.disposed)unmatchLinks(pageView.div);});
    eventBus.on('updatefindmatchescount',event=>{const status=container.closest('.pdf-pane')?.querySelector('.pdf-find-status');if(status)status.textContent=`${event.matchesCount.current}/${event.matchesCount.total}`;});
    const ready=new Promise(resolve=>{eventBus.on('pagesinit',()=>{controller.fit();resolve(controller);},{once:true});lifetime.signal.addEventListener('abort',()=>resolve(null),{once:true});});
    viewer.setDocument(pdf);return ready;
  })();return container.viewerPromise;
}
function makeBlock(block){
  const node=document.createElement('div');node.className='translated-block';
  node.dataset.blockId=block.id;node.dataset.sourceText=block.text;node.dataset.kind=block.kind||'body';node.dataset.typography=block.typographyRole||'body';
  node.dataset.serif=String(Boolean(block.serif));node.dataset.heavy=String(Boolean(block.heavy));node.dataset.align=block.align||'start';node.dataset.baseSize=block.fontSize;
  node.style.cssText=`left:${block.x}px;top:${block.y}px;width:${block.width}px;height:${block.height}px;--type-size:${block.fontSize}px;font-size:${block.fontSize}px;--type-leading:${block.lineHeight};--indent:${block.indent>0?block.indent:0}px;--hang:${block.hang>0?block.hang:0}px`;
  const text=document.createElement('div');text.className='translation-content';fillTranslation(text,block.sourceOnly?block.text:block.translation,!block.sourceOnly&&block.label,block.sourceOnly?null:{bullet:block.bullet,hang:block.hang,size:block.fontSize,items:block.items});node.append(text);
  // Places left open for another block (collisionHoles): the text is set around them and the mask does not cover them.
  if(!block.sourceOnly&&block.holes?.length){
    for(const hole of holeFloats(block.holes,block.width).reverse()){
      const gap=document.createElement('span'),box=document.createElement('span');gap.className=box.className='hole-float';
      gap.style.cssText=`float:left;clear:both;width:0;height:${hole.gap}px`;box.style.cssText=`float:${hole.side};clear:left;width:${hole.width}px;height:${hole.height}px`;text.prepend(gap,box);
    }
    node.dataset.holes=String(block.holes.length);
  }
  // A paragraph's warnings: in the section view under it and read out with it (aria-description), never as a title: the
  // browser's tooltip would cover the translation that opens beside a paragraph kept as its source.
  if(block.warnings?.length){const shown=block.warnings.map(w=>warningText(w)).join(' · ');node.setAttribute('aria-description',shown);const warning=document.createElement('span');warning.className='quality-warning';warning.textContent=shown;node.append(warning);}
  return node;
}
// Marked subscripts and superscripts (<sub>/<sup> in the text) render as
// real scripts; any other markup-like text stays text.
// Math drawn as graphics in a sentence comes back from the translation as its
// placeholder; it shows as the source drawing, cut from the page's pixels.
const graphicCrops=new Map();let graphicDocument='';
function graphicNode(spec){
  const span=document.createElement('span');span.className='graphic-math';span.dataset.graphic=spec;
  const crop=graphicCrops.get(graphicDocument+'|'+spec);
  if(crop){if(crop.url){const image=document.createElement('img');image.alt=tr('수식');image.src=crop.url;image.style.width=crop.width+'em';image.style.height=crop.height+'em';span.append(image);}span.dataset.filled='true';}
  else span.textContent=tr('[수식]');
  return span;
}
function appendRich(element,text){
  for(const part of String(text??'').split(/(⟦g:\d+:\d+:\d+:\d+:\d+⟧)/)){
    const graphic=/^⟦g:([\d:]+)⟧$/.exec(part);if(graphic){element.append(graphicNode(graphic[1]));continue;}
    for(const token of scriptTokens(part)){
      let target=element;for(const tag of token.tags){const node=document.createElement(tag);target.append(node);target=node;}
      target.append(token.text);
    }
  }
}
// The drawing's ink inside its gap (a little above and below the line for
// fractions), sized in em of the source line so it scales with the translation.
async function fillGraphics(root,pdf){
  const key=pdf.fingerprints?.[0]||'';graphicDocument=key;
  for(const span of root.querySelectorAll('.graphic-math:not([data-filled])')){
    const spec=span.dataset.graphic,id=key+'|'+spec;
    if(!graphicCrops.has(id)){
      const [page,x,y,width,height]=spec.split(':').map(Number);let crop={url:null,width:0,height:0};
      try{
        const pixels=await pagePixels(pdf,page),base=(await pdf.getPage(page)).getViewport({scale:4/3}),k=pixels.width/base.width;
        const left=Math.max(0,Math.floor(x*k)),right=Math.min(pixels.width,Math.ceil((x+width)*k)),top=Math.max(0,Math.floor((y-height*.6)*k)),bottom=Math.min(pixels.height,Math.ceil((y+height*1.6)*k));
        const back=backgroundSample(pixels,{x:left,y:Math.floor(y*k),width:right-left,height:Math.ceil(height*k)}).color.match(/\d+/g).map(Number);
        const inked=(px,py)=>{const i=(py*pixels.width+px)*4;return pixels.data[i+3]>200&&Math.abs(pixels.data[i]-back[0])+Math.abs(pixels.data[i+1]-back[1])+Math.abs(pixels.data[i+2]-back[2])>60;};
        // Above and below its box the drawing reaches only as far as ink goes on without a blank band of a
        // quarter of its height (a fraction's parts do; the next line of a tightly set slide does not).
        const rowInk=py=>{for(let px=left;px<right;px++)if(inked(px,py))return true;return false;},gap=Math.max(2,Math.round(height*k*.25));
        const boxTop=Math.max(top,Math.floor(y*k)),boxBottom=Math.min(bottom-1,Math.ceil((y+height)*k));let from=boxTop,to=boxBottom;
        for(let py=boxTop-1,blank=0;py>=top;py--){if(rowInk(py)){from=py;blank=0;}else if(++blank>gap)break;}
        for(let py=boxBottom+1,blank=0;py<bottom;py++){if(rowInk(py)){to=py;blank=0;}else if(++blank>gap)break;}
        let x0=right,x1=left,y0=bottom,y1=top;
        for(let py=from;py<=to;py++)for(let px=left;px<right;px++)if(inked(px,py)){if(px<x0)x0=px;if(px>x1)x1=px;if(py<y0)y0=py;if(py>y1)y1=py;}
        if(x1>=x0&&y1>=y0){
          x0=Math.max(left,x0-2);x1=Math.min(right-1,x1+2);y0=Math.max(top,y0-2);y1=Math.min(bottom-1,y1+2);
          const canvas=document.createElement('canvas');canvas.width=x1-x0+1;canvas.height=y1-y0+1;canvas.getContext('2d').putImageData(pixels,-x0,-y0,x0,y0,canvas.width,canvas.height);
          const line=Math.max(1,height*k);crop={url:canvas.toDataURL('image/png'),width:canvas.width/line,height:canvas.height/line};
        }
      }catch(error){console.error(error);}
      graphicCrops.set(id,crop);
    }
    const node=graphicNode(spec);span.replaceWith(node);
  }
}
// Source emphasis (bold "Received:" labels, bold caption titles) stays bold.
// A list: each line of the text that starts with a bullet is an item. The bullet stands in a box as
// wide as the item's hanging indent, so the item's text and its wrapped lines start at one place
// whatever the alignment; an item set further in (a second level) keeps its place, and the gap
// above it. `list` is the block's hang, type size and, for a box of several of today's items, each
// item's place (pdf-layout reconcilePage); pdf-print.cjs sets the same structure in a saved PDF.
const BULLET_ITEM=/^\s*([•◦▪▫●○■□‣⁃▶►▸▹▷➤➢➔])\s+/;
function fillList(element,value,list){
  const lines=String(value??'').split('\n').filter(line=>line.trim());if(!lines.some(line=>BULLET_ITEM.test(line)))return false;
  const spec=list.items?.length===lines.length&&list.items.every((t,i)=>Boolean(t.bullet)===BULLET_ITEM.test(lines[i]))?list.items:null,own=list.hang>0?list.hang:list.size*1.4;
  const box=document.createElement('span');box.className='tl-list';element.replaceChildren(box);
  let inner=0; // where the text of the item above starts: a line without a bullet goes on from there
  lines.forEach((line,i)=>{
    const item=document.createElement('span'),mark=BULLET_ITEM.exec(line),at=spec?.[i],hang=at?.hang>0?at.hang:own,dx=at?Math.max(0,at.dx):mark?0:inner;
    item.className='tl-item';item.style.marginLeft=dx+'px';if(i&&at?.gap>0)item.style.marginTop=at.gap+'px';
    if(mark){const bullet=document.createElement('span');bullet.className='tl-bullet';bullet.style.width=hang+'px';bullet.textContent=mark[1];item.style.paddingLeft=hang+'px';item.style.textIndent=-hang+'px';item.append(bullet);appendRich(item,line.slice(mark[0].length));inner=dx+hang;}
    else appendRich(item,line.trim());
    box.append(item);
  });
  return true;
}
function fillTranslation(element,value,label,list){
  if(list?.bullet&&fillList(element,value,list))return;
  const match=label&&emphasis(value,label);element.replaceChildren();
  if(!match){appendRich(element,value||'');return;}
  const strong=document.createElement('strong');appendRich(strong,match[0]);element.append(strong);appendRich(element,match[1]);
}
// Shrink by at most MIN_FIT inside the source box. A paragraph that still
// overflows keeps the part that fits in place; only the rest continues below.
function fitBlock(node,value,label){
  if(node.classList.contains('source-preserved'))return {scale:1,head:null};
  const text=node.querySelector('.translation-content'),base=parseFloat(node.dataset.baseSize);
  const over=()=>text.scrollHeight>text.clientHeight+1||text.scrollWidth>text.clientWidth+1;
  const size=scale=>{node.style.setProperty('--type-size',base*scale+'px');node.style.fontSize=base*scale+'px';};
  const heading=['title','heading','subheading'].includes(node.dataset.typography);
  const single=parseFloat(node.style.height)<base*parseFloat(node.style.getPropertyValue('--type-leading')||1.4)*2.2;
  const floor=heading||single?MIN_FIT_LINE:MIN_FIT;
  // One line is set solid: a heading or label then fits its source line,
  // whose glyph box is often shorter than the type size ("References" set
  // at 77% otherwise). Text that wraps keeps its leading.
  if(single&&base>0&&over()){const leading=node.style.getPropertyValue('--type-leading');node.style.setProperty('--type-leading','1');if(text.scrollHeight>base*1.5){if(leading)node.style.setProperty('--type-leading',leading);else node.style.removeProperty('--type-leading');}}
  let scale=1,head=null;
  if(over()&&base>0){
    size(floor);
    if(over()){scale=floor;size(scale);}
    else{let low=floor,high=1;for(let i=0;i<6;i++){const mid=(low+high)/2;size(mid);if(over())high=mid;else low=mid;}scale=low;size(scale);}
  }
  // Short of room by a line or two: tighten the leading and shrink a little
  // further (TAIL_FIT) instead of continuing those lines below the page.
  if(over()&&!heading&&!single&&base>0){
    const leading=parseFloat(node.style.getPropertyValue('--type-leading'))||1.4,short=(text.scrollHeight-text.clientHeight)/(base*scale*leading);
    if(short<=TAIL_FIT.lines){
      node.style.setProperty('--type-leading',Math.min(leading,TAIL_FIT.leading));size(TAIL_FIT.scale);
      if(over()){node.style.setProperty('--type-leading',leading);size(scale);}
      else{let low=TAIL_FIT.scale,high=1;for(let i=0;i<6;i++){const mid=(low+high)/2;size(mid);if(over())high=mid;else low=mid;}scale=low;size(scale);}
    }
  }
  // Nothing leaves the page (HARD_FIT): what still does not fit shrinks further, to half
  // size at most; past that the paragraph keeps its place and its box grows downwards.
  let grown=false,clipped=false;
  if(over()&&base>0){
    size(HARD_FIT);
    if(over()){
      scale=HARD_FIT;
      // A little too long even at half size: the box grows. Far too long (a paragraph
      // several times its box): it is cut at the box and the whole translation opens
      // in the note panel, as for a paragraph kept as its source.
      if(text.scrollHeight<=text.clientHeight*2.5&&text.scrollWidth<=text.clientWidth+1){grown=true;node.style.minHeight=node.style.height;node.style.height='auto';text.style.height='auto';text.style.overflow='visible';}
      else{clipped=true;node.classList.add('has-translation-note');node.tabIndex=0;node.setAttribute('aria-label',tr('전체 번역 보기'));const note=document.createElement('span');note.className='translation-note';note.hidden=true;appendRich(note,String(value||''));node.append(note);}
    }
    else{let low=HARD_FIT,high=scale;for(let i=0;i<7;i++){const mid=(low+high)/2;size(mid);if(over())high=mid;else low=mid;}scale=low;size(scale);}
  }
  node.classList.toggle('block-grow',grown);node.classList.toggle('block-clipped',clipped);
  const overflow=false;
  node.classList.toggle('block-overflow',overflow);node.classList.toggle('block-split',head!==null);node.dataset.fitScale=scale;
  text.removeAttribute('tabindex');text.removeAttribute('role');text.removeAttribute('aria-label');
  return {scale,head};
}
async function paintSections(container,record,pdf,valid,onVisible,onPaint){
  const top=container.getBoundingClientRect().top;
  const visible=[...container.querySelectorAll('[data-source-anchor]')].find(n=>n.getBoundingClientRect().bottom>top);
  const saved=visible?{id:visible.dataset.sourceAnchor,offset:visible.getBoundingClientRect().top-top}:null;
  const pages=[];
  for(let i=0;i<record.pages.length;i++){
    const page=record.pages[i],repaired=page?reconcilePage(page,await canonicalFor(pdf,i+1,page)):null;pages.push(repaired?{...repaired,blocks:pageTypography(repaired)}:null);if(!valid())return;
  }
  const model=sectionDocument(pages,record.sourceHash),fragment=document.createDocumentFragment();
  container.translationDocument=model;
  container.getSection=id=>model.sections.find(s=>s.id===id);
  for(let i=0;i<pages.length;i++){
    const sheet=document.createElement('article');sheet.className='translated-sheet section-sheet';sheet.dataset.page=i+1;
    const label=document.createElement('div');label.className='section-page-label';label.textContent=tr('원문 {n}페이지',{n:i+1});sheet.append(label);
    if(!pages[i]){const pending=document.createElement('p');pending.textContent=tr('번역 대기 중…');sheet.append(pending);fragment.append(sheet);continue;}
    if(!pages[i].blocks.length){const empty=document.createElement('p');empty.className='section-cache-warning';empty.textContent=tr('이 페이지에는 추출 가능한 텍스트가 없습니다. 원문 보기에서 이미지·수식을 확인하세요.');sheet.append(empty);}
    for(const section of [...model.sections].sort((a,b)=>Number(a.role==='metadata')-Number(b.role==='metadata'))){
      const nodes=section.nodes.filter(n=>n.page===i+1);if(!nodes.length)continue;
      const element=document.createElement('section');element.className='translation-section';element.dataset.sectionId=section.id;element.dataset.role=section.role;
      const heading=document.createElement('h'+Math.min(4,section.level+1)),button=document.createElement('button');button.type='button';button.className='section-heading';button.dataset.typography=nodes.find(sectionHeading)?.typographyRole||'heading';button.style.setProperty('--type-size',(nodes.find(sectionHeading)?.fontSize||nodes[0].fontSize)+'px');button.textContent=section.nodes[0].page<i+1?tr('{title} · 계속',{title:sectionName(section)}):sectionName(section);button.title=tr('원문 위치로 이동');
      button.addEventListener('click',()=>{
        container.querySelectorAll('.section-selected').forEach(n=>n.classList.remove('section-selected'));element.classList.add('section-selected');
        const anchor=nodes[0].anchor,original=document.querySelector('.original-pages'),view=original?.pdfViewer?.getPageView(anchor.page-1);
        if(view){original.pdfViewer.currentPageNumber=anchor.page;original.scrollTop+=view.div.getBoundingClientRect().top-original.getBoundingClientRect().top+anchor.y/pages[i].height*view.div.getBoundingClientRect().height;}
        container.dispatchEvent(new CustomEvent('app-section-select',{bubbles:true,detail:{sectionId:section.id,sourceHash:model.sourceHash,anchors:section.nodes.map(n=>n.anchor)}}));
      });heading.append(button);element.append(heading);
      for(const block of nodes){
        const node=document.createElement(sectionHeading(block)?'div':'p');node.className='translated-block section-paragraph';node.dataset.blockId=block.id;node.dataset.sourceAnchor=block.id;node.dataset.sourceText=block.text;node.dataset.sectionId=section.id;node.dataset.kind=block.kind;node.dataset.typography=block.typographyRole;node.dataset.sourceY=block.y;node.dataset.sourceX=block.x;node.dataset.sourceHeight=block.height;node.style.setProperty('--type-size',block.fontSize+'px');
        // Heading text already appears in the section button; retain its anchor.
        if(sectionHeading(block)&&section.sourceTitle===block.text){
          node.classList.add('section-title-anchor');element.append(node);
          if(!block.translation?.trim()||block.missingTranslation){const warning=document.createElement('small');warning.className='section-cache-warning missing-translation';warning.textContent=tr('제목 번역이 누락되었습니다. 이 페이지를 다시 번역하세요.');element.append(warning);}
          continue;
        }
        const content=document.createElement('span');content.className='translation-content';appendRich(content,block.translation||block.text);
        if(block.kind==='caption'){
          // Keep the original figure above a caption when a clear vertical gap
          // separates it from prose. Ambiguous figures stay available in PDF.js.
          const start=figureTop(pages[i],block,6);
          if(block.y-start>45){const image=document.createElement('img');image.className='section-source-crop';image.alt=tr('그림 원문');image.src=await selectionImage(pdf,i+1,{x:block.x/pages[i].width,y:start/pages[i].height,width:Math.min(block.width,pages[i].width-block.x)/pages[i].width,height:(block.y-start)/pages[i].height});if(!valid())return;node.append(image);}
        }
        if(formulaOnly(block)){
          const image=document.createElement('img');image.className='section-source-crop';image.alt=tr('수식이 포함된 원문');
          image.src=await selectionImage(pdf,i+1,{x:block.x/pages[i].width,y:block.y/pages[i].height,width:Math.min(block.width,pages[i].width-block.x)/pages[i].width,height:Math.min(block.height,pages[i].height-block.y)/pages[i].height});
          if(!valid())return;node.append(image);
          // A mixed prose paragraph may have a useful cached translation. Keep
          // it in normal flow alongside the source instead of hiding it.
          if(block.translation&&block.translation!==block.text)node.append(content);
        }else node.append(content);
        if(block.pending){const note=document.createElement('small');note.className='section-cache-warning';note.textContent=tr('번역 중…');node.append(note);}
        else if(!formulaOnly(block)&&(!block.translation?.trim()||block.missingTranslation)){
          const missing=document.createElement('small');missing.className='section-cache-warning missing-translation';missing.textContent=tr('번역이 누락된 문단입니다. 아래의 이 페이지 다시 번역을 실행하세요.');node.append(missing);
        }
        if(block.mappingUncertain){const warning=document.createElement('small');warning.className='section-cache-warning';warning.textContent=tr('이전 번역의 문단 대응을 확인하려면 이 페이지를 다시 번역하세요.');node.append(warning);}
        element.append(node);
      }
      sheet.append(element);
    }
    const retry=document.createElement('button');retry.type='button';retry.className='secondary small page-retranslate';retry.dataset.retranslatePage=i+1;retry.textContent=tr('이 페이지 다시 번역');retry.disabled=Boolean(record.partial);sheet.append(retry);fragment.append(sheet);
  }
  await fillGraphics(fragment,pdf);
  if(!valid())return;container.replaceChildren(fragment);
  if(saved){const anchor=[...container.querySelectorAll('[data-source-anchor]')].find(n=>n.dataset.sourceAnchor===saved.id);if(anchor)container.scrollTop+=anchor.getBoundingClientRect().top-container.getBoundingClientRect().top-saved.offset;}
  else if(!container.dataset.initialPage){container.dataset.initialPage=record.startPage||1;container.querySelector(`[data-page="${record.startPage||1}"]`)?.scrollIntoView({block:'start'});}
  container.onscroll=perFrame(()=>{const bounds=container.getBoundingClientRect(),sheet=[...container.querySelectorAll('[data-page]')].find(n=>n.getBoundingClientRect().bottom>bounds.top+20);if(sheet)onVisible(Number(sheet.dataset.page));});
  pages.forEach((page,i)=>{if(page)onPaint(i+1);});
}
// Reflow displaced translations in section order after their source page.
// Native PDF.js keeps its page coordinates; no paragraph gets a scroll box.
// A paragraph whose translation cannot be drawn in place (dense math, a picture behind it,
// boxes that collide, an older translation that no longer matches today's paragraphs) keeps
// its source on the page. Its translation is not sent below the page any more: it opens
// beside the paragraph on hover or focus, so a translated page is always one page.
// The translation of a paragraph kept as its source opens in one floating panel, set at a
// readable size whatever the page zoom, beside the paragraph and inside the window.
let notePanel=null,noteOwner=null;
function hideTranslationNote(){if(notePanel)notePanel.hidden=true;noteOwner=null;}
function showTranslationNote(node){
  const source=node.querySelector(':scope>.translation-note');if(!source||noteOwner===node)return;
  if(!notePanel){notePanel=document.createElement('div');notePanel.className='translation-note-pop';notePanel.setAttribute('role','note');document.body.append(notePanel);}
  notePanel.replaceChildren(...[...source.childNodes].map(child=>child.cloneNode(true)));notePanel.hidden=false;noteOwner=node;
  const box=node.getBoundingClientRect(),width=Math.min(520,Math.max(280,box.width),innerWidth-16);notePanel.style.width=width+'px';
  const height=notePanel.getBoundingClientRect().height,below=box.bottom+6+height<=innerHeight-8||box.top<height+14;
  notePanel.style.left=Math.max(8,Math.min(box.left,innerWidth-8-width))+'px';notePanel.style.top=Math.max(8,below?Math.min(box.bottom+6,innerHeight-8-height):box.top-6-height)+'px';
}
document.addEventListener('pointerover',event=>{const node=event.target.closest?.('.has-translation-note');if(node)showTranslationNote(node);else if(!event.target.closest?.('.translation-note-pop'))hideTranslationNote();});
// A scroll closes the panel (it would no longer sit beside its paragraph); the pointer still over the paragraph opens it again.
document.addEventListener('pointermove',event=>{if(noteOwner)return;const node=event.target.closest?.('.has-translation-note');if(node)showTranslationNote(node);});
document.addEventListener('focusin',event=>{const node=event.target.closest?.('.has-translation-note');if(node)showTranslationNote(node);});
document.addEventListener('focusout',event=>{if(event.target.closest?.('.has-translation-note'))hideTranslationNote();});
document.addEventListener('scroll',event=>{if(!notePanel?.contains(event.target))hideTranslationNote();},true);
document.addEventListener('keydown',event=>{if(event.key==='Escape')hideTranslationNote();});
async function continuationFor(pdf,index,page,plan,controller,pageView,current){
  controller.continuations.get(index)?.remove();controller.continuations.delete(index);
  for(const planned of plan.blocks){
    if(planned.sourceOnly||!planned.preserveSource)continue;
    const node=[...pageView.div.querySelectorAll('.translation-layer>.translated-block')].find(n=>n.dataset.blockId===planned.id);if(!node)continue;
    node.classList.add('source-preserved');planned.displayInContinuation=false;
    const translation=String(planned.translation||'').trim();if(!translation||planned.untranslated)continue;
    node.classList.add('has-translation-note');node.tabIndex=0;node.setAttribute('aria-label',tr('원문으로 둔 문단의 번역 보기'));
    const note=document.createElement('span');note.className='translation-note';note.hidden=true;
    appendRich(note,translation);node.append(note);
  }
  await fillGraphics(pageView.div.querySelector('.translation-layer'),pdf);
}
export async function paint(container,record,id,paperId,onVisible=()=>{},onPaint=()=>{},attachmentId){
  const generation=(container.paintGeneration||0)+1;container.paintGeneration=generation;
  const {pdf,hash}=await documentFor(id,paperId,false,attachmentId);if(!container.isConnected||container.paintGeneration!==generation)return;
  if(hash!==record.sourceHash)throw Error(tr('원문이 변경됐습니다. 다시 번역하세요.'));
  // Paragraphs continued across columns/pages share one translation.
  record={...record,pages:repairPages(applyFlow(record.pages))};
  if(container.classList.contains('reading-translation')){
    // While pages are still arriving, the whole-document section view is
    // rebuilt at most once a second; a newer paint replaces one that waits.
    const streaming=record.pages.some(page=>!page||page.partial),wait=streaming?Math.max(0,1000-(performance.now()-(container.sectionPaintedAt||0))):0;
    if(wait){await new Promise(resolve=>setTimeout(resolve,wait));if(!container.isConnected||container.paintGeneration!==generation)return;}
    container.sectionPaintedAt=performance.now();
    await paintSections(container,record,pdf,()=>container.isConnected&&container.paintGeneration===generation,onVisible,onPaint);
    return;
  }
  const controller=await ensureViewer(container,pdf,true);if(!controller)return;
  const valid=()=>!controller.disposed&&container.isConnected&&container.paintGeneration===generation;
  async function draw(pageView,index){
    const page=record.pages[index];if(!valid()||!page||!pageView.canvas)return;
    const stamp=JSON.stringify(page.blocks.map(b=>b.translation));
    const old=pageView.div.querySelector('.translation-layer');if(old?.dataset.stamp===stamp&&old.dataset.ready==='true'){old.style.transform=`scale(${pageView.viewport.width/page.width})`;return;}
    const ticket=pageView.appTicket=(pageView.appTicket||0)+1,current=()=>valid()&&pageView.appTicket===ticket;
    const repaired=reconcilePage(page,await canonicalFor(pdf,index+1,page));if(!current()||!pageView.canvas?.width||!pageView.canvas?.height)return;
    await document.fonts.load('16px "Noto Sans KR"',repaired.blocks.map(b=>b.translation||'').join('')).catch(()=>{});if(!current())return;
    const layer=document.createElement('div');layer.className='translation-layer';layer.dataset.stamp=stamp;layer.dataset.sourceWidth=page.width;layer.style.width=page.width+'px';layer.style.height=page.height+'px';layer.style.transform=`scale(${pageView.viewport.width/page.width})`;
    const pixels=await pagePixels(pdf,index+1),blocks=maskPads(repaired,expandLayoutBlocks({...repaired,blocks:markSame(repaired.blocks,repaired.width)},pixels),pixels),styled=pageTypography({...page,blocks}),collisions=layoutCollisions(blocks);if(!current())return;
    const styledById=new Map(styled.map(b=>[b.id,b]));
    const plan={width:page.width,height:page.height,blocks:[],stamp};
    // Each block's fate first (translated, or its source kept), then the masks
    // are settled against what stays visible, then the page is built.
    // A colliding block set around the other block's place (collisionHoles) is no conflict.
    const uncertain=blocks.filter(b=>b.mappingUncertain),holes=collisionHoles(blocks,collisions);
    const decided=blocks.map(block=>{
      const collides=collisions.has(block.id)&&!holes.has(block.id);
      const sample=backgroundSample(pixels,{x:block.x*pixels.width/page.width,y:block.y*pixels.height/page.height,width:block.width*pixels.width/page.width,height:block.height*pixels.height/page.height});
      // A translation equal to its source (markSame) keeps the source in place;
      // so does a paragraph still untranslated: it is counted, never moved.
      const untranslated=!block.sourceOnly&&(!String(block.translation||'').trim()||block.missingTranslation),sourceOnly=block.sourceOnly||untranslated;
      // A stored translation from an older paragraph split keeps its own box
      // (reconcilePage) and stays in place unless that box collides.
      const conflict=!sourceOnly&&(collides||untranslated);
      // A collision with an older translation's block that no longer matches
      // today's paragraphs is a mapping problem: translating the page again fixes it.
      const reason=untranslated?'untranslated':collides?(block.mappingUncertain||uncertain.some(o=>o!==block&&Math.min(o.x+o.width,block.x+block.width)-Math.max(o.x,block.x)>2&&Math.min(o.y+o.height,block.y+block.height)-Math.max(o.y,block.y)>2)?'mapping':'overlap'):block.preserveSource?'math':!sample.safe?'background':'overflow';
      return {...block,reason,untranslated,layoutConflict:conflict,...(holes.get(block.id)?.length?{holes:holes.get(block.id)}:{}),...(reason==='overlap'&&collisions.partners?.get(block.id)?{collidedWith:collisions.partners.get(block.id)}:{}),backgroundColor:sample.color,...(sample.ink?{inkColor:sample.ink}:{}),sourceOnly,preserveSource:!sourceOnly&&(block.preserveSource||!sample.safe||conflict)};
    });
    for(const block of settleMasks(decided)){
      // A dark panel keeps its colour; its translation is set in light ink.
      const open=!block.sourceOnly&&!block.preserveSource&&block.holes?.length?block.holes:null;
      const node=makeBlock({...styledById.get(block.id),holes:open});node.style.backgroundColor=block.backgroundColor;if(block.inkColor)node.style.color=block.inkColor;
      // The mask, grown or not, never covers an opening.
      if(open)node.style.clipPath=holeClip(open,block.width,block.height,{top:1e5,right:1e5,bottom:1e5,left:1e5});
      if(block.sourceOnly||block.preserveSource)node.classList.add('source-preserved');
      if(block.maskPad)for(const side of ['top','right','bottom','left'])node.style.setProperty('--mask-'+side,block.maskPad[side]+'px');
      layer.append(node);plan.blocks.push(block);
    }
    for(const previous of pageView.div.querySelectorAll(':scope>.translation-layer'))previous.remove();layer.style.transform=`scale(${pageView.viewport.width/page.width})`;pageView.div.append(layer);await document.fonts.ready;if(!current()){layer.remove();return;}
    const plannedById=new Map(plan.blocks.map(b=>[b.id,b]));
    // Drawings in sentences take their size before the text is fitted.
    await fillGraphics(layer,pdf);if(!current()){layer.remove();return;}
    for(const node of layer.querySelectorAll('.translated-block')){const planned=plannedById.get(node.dataset.blockId),fit=fitBlock(node,planned.translation,planned.label);planned.fitScale=fit.scale;if(fit.head!==null)planned.splitAt=fit.head;planned.overflow=false;planned.grown=node.classList.contains('block-grow');planned.clipped=node.classList.contains('block-clipped');}
    await continuationFor(pdf,index,repaired,plan,controller,pageView,current);if(!current())return;
    unmatchLinks(pageView.div);
    // English-only results count as untranslated; pending paragraphs of a
    // streaming page are simply not there yet.
    const missing=plan.blocks.filter(b=>b.untranslated||b.englishOnly).length;
    const retained=plan.blocks.filter(b=>!b.sourceOnly&&b.preserveSource).length;
    const overflow=plan.blocks.filter(b=>b.clipped).length;
    if(retained||overflow||missing){
      const notice=document.createElement('button');notice.type='button';notice.className='layout-reading-notice';
      // Name why text left the page so a report can point at the exact rule.
      const reasons={};for(const b of plan.blocks.filter(b=>!b.sourceOnly&&(b.preserveSource||b.clipped)))reasons[b.reason]=(reasons[b.reason]||0)+1;
      const english=plan.blocks.filter(b=>b.englishOnly).length;if(english)reasons.english=english;
      const labels={overflow:tr('넘침'),math:tr('수식',null,'reason'),background:tr('배경'),overlap:tr('겹침'),mapping:tr('문단 대응'),untranslated:tr('미번역'),english:tr('영문 응답')};
      notice.dataset.reasons=Object.keys(reasons).join(' ');
      // The reason is on the button itself so a screenshot shows the rule.
      const why=Object.entries(reasons).map(([k,n])=>`${labels[k]||k} ${n}`).join(', ');
      // Untranslated paragraphs say why the reply was not accepted.
      const missingCounts={};for(const b of plan.blocks.filter(b=>b.untranslated&&b.missingReason))missingCounts[b.missingReason]=(missingCounts[b.missingReason]||0)+1;
      const missingLabels={missing:tr('응답 누락'),english:tr('영문 응답'),math:tr('수식 표시 누락'),format:tr('응답 형식 오류')},missingWhy=Object.entries(missingCounts).map(([k,n])=>`${missingLabels[k]||k} ${n}`).join(', ');
      notice.textContent=[missing?(missingWhy?tr('미번역 {n}개({why})',{n:missing,why:missingWhy}):tr('미번역 {n}개',{n:missing})):'',retained?tr('원문 유지 {n}개 (문단에 마우스를 올리면 번역)',{n:retained}):'',overflow?tr('칸보다 긴 번역 {n}개 (마우스를 올리면 전체)',{n:overflow}):'',why?tr('사유: {why}',{why}):'',reasons.mapping?tr('이 페이지를 다시 번역하면 맞춰집니다'):'',tr('전체 번역 보기')].filter(Boolean).join(' · ');
      // Name why text left the page first, then how to read it.
      notice.title=tr('사유: {why}',{why:Object.entries(reasons).map(([k,n])=>`${labels[k]||k} ${n}`).join(', ')})+'\n'+tr('원문으로 둔 문단은 그 문단에 마우스를 올리거나 Tab으로 고르면 번역이 옆에 열립니다. 섹션 보기에서는 제목별로 전체 번역을 표시합니다. 미번역 문단은 해당 페이지를 다시 번역하세요.');
      notice.addEventListener('click',()=>container.closest('.pdf-pane')?.querySelector('[data-action="toggle-translation-reading"]')?.click());layer.append(notice);
    }
    layer.dataset.ready='true';controller.plans.set(index,plan);
    const retry=document.createElement('button');retry.className='secondary small page-retranslate';retry.dataset.retranslatePage=index+1;retry.textContent=tr('이 페이지 다시 번역');retry.disabled=Boolean(record.partial);layer.append(retry);onPaint(index+1);
  }
  controller.onPage=(pageView,index)=>draw(pageView,index).catch(error=>{if(valid())console.error(error);});
  for(let i=0;i<controller.viewer.pagesCount;i++){const view=controller.viewer.getPageView(i);if(view.canvas)await draw(view,i);}
  container.onscroll=perFrame(()=>{const bounds=container.getBoundingClientRect(),visible=[...container.querySelectorAll('[data-page]')].find(sheet=>sheet.getBoundingClientRect().bottom>bounds.top+20);if(visible)onVisible(Number(visible.dataset.page));});
  if(!container.dataset.initialPage){container.dataset.initialPage=String(record.startPage||1);controller.viewer.currentPageNumber=record.startPage||1;}

}
export async function exportImages(id,paperId,attachmentId){
  const {pdf}=await documentFor(id,paperId,false,attachmentId),images=[];for(let index=1;index<=pdf.numPages;index++)images.push(await imageFor(pdf,index));return images;
}

export async function clearDocuments(){pixelPages.length=0;graphicCrops.clear();ocrPages.clear();handles.clear();images.clear();crops.clear();for(const pending of documents.values()){try{await(await pending).destroy();}catch{/* a document that failed to open has nothing to destroy */}}documents.clear();}

// Crops already cut are reused (section view repaints while a job streams and
// would otherwise decode a full page image for every caption and formula).
const crops=new Map();
// A PDF from outside the vault (pages added to a notebook): opened from its bytes, never cached.
export async function openBytes(bytes){
  const pdfjs=await import('./pdfjs/pdf.mjs');
  return pdfjs.getDocument({data:new Uint8Array(bytes),fontExtraProperties:true,disableAutoFetch:true,cMapUrl:new URL('./pdfjs/cmaps/',location.href).href,cMapPacked:true,standardFontDataUrl:new URL('./pdfjs/standard_fonts/',location.href).href,wasmUrl:new URL('./pdfjs/wasm/',location.href).href,isEvalSupported:false}).promise;
}
// A page as a notebook background: its size in points and a PNG of about 1.6 megapixels.
export async function pageBackground(pdf,index){
  const page=await pdf.getPage(index),base=page.getViewport({scale:1}),scale=Math.min(3,Math.sqrt(1600000/(base.width*base.height))),viewport=page.getViewport({scale}),canvas=document.createElement('canvas');
  canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);const context=canvas.getContext('2d');context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);
  await page.render({canvasContext:context,viewport}).promise;const dataUrl=canvas.toDataURL('image/png');canvas.width=0;canvas.height=0;page.cleanup();
  return {dataUrl,width:base.width,height:base.height};
}
export async function selectionImage(pdf,index,rect){
  const key=rect&&[pdf.fingerprints?.[0]||'',index,rect.x,rect.y,rect.width,rect.height].map(v=>typeof v==='number'?v.toFixed(5):v).join('|');
  if(key&&crops.has(key)){const hit=crops.get(key);crops.delete(key);crops.set(key,hit);return hit;}
  const url=await cutSelection(pdf,index,rect);
  if(key){crops.set(key,url);if(crops.size>300)crops.delete(crops.keys().next().value);}
  return url;
}
async function cutSelection(pdf,index,rect){
  const image=new Image();image.src=await imageFor(pdf,index);await image.decode();
  if(!rect||![rect.x,rect.y,rect.width,rect.height].every(Number.isFinite)||rect.x<0||rect.y<0||rect.width<=0||rect.height<=0||rect.x+rect.width>1.001||rect.y+rect.height>1.001)throw Error(tr('그림 영역을 다시 선택하세요.'));
  const width=rect.width*image.naturalWidth,height=rect.height*image.naturalHeight,scale=Math.min(1,1600/Math.max(width,height)),canvas=document.createElement('canvas');
  canvas.width=Math.max(1,Math.round(width*scale));canvas.height=Math.max(1,Math.round(height*scale));
  canvas.getContext('2d').drawImage(image,rect.x*image.naturalWidth,rect.y*image.naturalHeight,width,height,0,0,canvas.width,canvas.height);
  return canvas.toDataURL('image/png');
}

// Native PDF.js viewer: canvas, selectable text, annotations, links and find.
export async function paintOriginal(container,id,paperId,attachmentId){
  const {pdf}=await documentFor(id,paperId,false,attachmentId);if(!container.isConnected)return;
  await ensureViewer(container,pdf,false);
}
// The pages of a stored translation that only translating again will put right: pages with a
// paragraph left untranslated (the reply failed, or the paragraph was not read when the page
// was translated: a slide's picture text before OCR), and pages whose stored paragraphs no
// longer line up with today's. Checked against today's paragraphs, as the page is drawn.
export async function problemPages(record,id,paperId,attachmentId){
  const {pdf,hash}=await documentFor(id,paperId,false,attachmentId);if(hash!==record.sourceHash)return {missing:[],mapping:[]};
  const pages=repairPages(applyFlow(record.pages)),missing=[],mapping=[];
  for(let i=0;i<pages.length;i++){
    const page=pages[i];if(!page||page.partial)continue;
    const repaired=reconcilePage(page,await canonicalFor(pdf,i+1,page)),blocks=layoutBlocks({...repaired,blocks:markSame(repaired.blocks,repaired.width)});
    if(blocks.some(b=>!b.sourceOnly&&(!String(b.translation||'').trim()||b.missingTranslation)))missing.push(i+1);
    else{
      // As when the page is drawn: a paragraph out of place, or one kept as its source for meeting such a paragraph.
      const collisions=layoutCollisions(blocks),holes=collisionHoles(blocks,collisions),uncertain=blocks.filter(b=>b.mappingUncertain),meets=(a,b)=>Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x)>2&&Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y)>2;
      if(blocks.some(b=>!b.sourceOnly&&(b.mappingUncertain||collisions.has(b.id)&&!holes.has(b.id)&&uncertain.some(o=>o!==b&&meets(o,b)))))mapping.push(i+1);
    }
  }
  return {missing,mapping};
}
export async function exportLayout(container,record,id,paperId,attachmentId,images){
  const {pdf}=await documentFor(id,paperId,false,attachmentId),pages=[];record={...record,pages:repairPages(applyFlow(record.pages))};
  for(let i=0;i<record.pages.length;i++){
    const page=record.pages[i];if(!page||page.partial)throw Error(tr('번역 완료 후 PDF를 저장하세요.'));
    const repaired=reconcilePage(page,await canonicalFor(pdf,i+1,page)),pixels=await pagePixels(pdf,i+1);
    const blocks=maskPads(repaired,expandLayoutBlocks({...repaired,blocks:markSame(repaired.blocks,repaired.width)},pixels),pixels),collisions=layoutCollisions(blocks),holes=collisionHoles(blocks,collisions);
    if(blocks.some(b=>!b.sourceOnly&&(!b.translation?.trim()||b.missingTranslation)))throw Error(tr('원문 {n}페이지에 누락된 번역이 있습니다. 이 페이지를 다시 번역한 뒤 저장하세요.',{n:i+1}));
    for(const block of blocks){
      const sampled=backgroundSample(pixels,{x:block.x*pixels.width/page.width,y:block.y*pixels.height/page.height,width:block.width*pixels.width/page.width,height:block.height*pixels.height/page.height});
      block.backgroundColor=sampled.color;if(sampled.ink)block.inkColor=sampled.ink;
      block.preserveSource=block.preserveSource||!sampled.safe||collisions.has(block.id)&&!holes.has(block.id);
      if(!block.sourceOnly&&!block.preserveSource&&holes.get(block.id)?.length)block.holes=holes.get(block.id);
    }
    // Every stored paragraph is named once in the plan the export checks. A page whose stored
    // translation no longer lines up with today's paragraphs (an older split) can leave a
    // paragraph unnamed; it then keeps its source at its stored place instead of failing the
    // whole PDF, and its translation goes with the others kept as source.
    const settled=settleMasks(blocks),stored=new Map(page.blocks.map(b=>[b.id,b])),named=new Set(settled.flatMap(b=>Array.isArray(b.sourceIds)?b.sourceIds:[]));
    const planned=settled.filter(b=>{if(Array.isArray(b.sourceIds)&&b.sourceIds.length)return true;if(stored.has(b.id)&&!named.has(b.id)){b.sourceIds=[b.id];named.add(b.id);return true;}return false;});
    for(const [blockId,block] of stored)if(!named.has(blockId)){const translated=Boolean(String(block.translation||'').trim())&&!block.missingTranslation;planned.push({...block,sourceIds:[blockId],sourceOnly:block.sourceOnly||!translated,preserveSource:translated&&!block.sourceOnly,backgroundColor:'rgb(255, 255, 255)'});}
    pages.push({...repaired,blocks:planned});
  }return pages;
}

// Keep application navigation locked down; only explicit annotation link clicks
// are routed through the protocol-checked Electron bridge.
document.addEventListener('click',event=>{
  const link=event.target.closest?.('.native-pdf .annotationLayer a[href]');
  if(!link||!event.isTrusted||!/^https?:|^mailto:/i.test(link.href))return;
  event.preventDefault();host().openPdfLink(link.href).catch(error=>console.error(error));
});
