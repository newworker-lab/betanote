// Layout-translation quality regression with realistic-length mocked Korean.
// Default: a generated journal fixture with strict assertions. With
// APP_QUALITY_PDF=/path/paper.pdf it reports the same per-page placement
// for a real paper (add APP_QUALITY_STRICT=1 to fail on displaced prose).
const {_electron:electron}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const appName = require('../core/app-name.cjs');
process.env.APP_UI_LANG||='ko'; // the Korean screen, whatever the system's language (tests/app-executable.cjs)
const root=path.resolve(__dirname,'..'),real=process.env.APP_QUALITY_PDF,stress=process.env.APP_QUALITY_STRESS==='1',strict=(!real&&!stress)||process.env.APP_QUALITY_STRICT==='1',ratio=Number(process.env.APP_QUALITY_RATIO||0.6);
(async()=>{
 const temp=await fs.mkdtemp(path.join(os.tmpdir(),`${appName.id}-quality-`)),vault=path.join(temp,'vault'),pdf=path.join(temp,'paper.pdf');await fs.mkdir(vault);let app;
 try{
  app=await electron.launch({executablePath:require('electron'),args:[root,'--no-sandbox','--ozone-platform=headless','--disable-gpu',`--user-data-dir=${path.join(temp,'profile')}`]});
  // The width gives the pages the scale the fixtures were drawn for (a paragraph with ink one row
  // above its box, which another scale rounds into the box): the pages now span their pane, 8px wider.
  const p=await app.firstWindow();p.setDefaultTimeout(30000);await p.setViewportSize({width:1492,height:1100});
  const errors=[];p.on('pageerror',e=>errors.push(e.message));
  if(real)await fs.copyFile(real,pdf);
  else{
   const html=await fs.readFile(path.join(__dirname,'fixtures','journal-layout.html'),'utf8');
   const bytes=await app.evaluate(async({BrowserWindow},html)=>{const w=new BrowserWindow({show:false});await w.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(html));const data=await w.webContents.printToPDF({printBackground:true,preferCSSPageSize:true,margins:{top:0,bottom:0,left:0,right:0}});w.destroy();return Buffer.from(data).toString('base64');},html);
   await fs.writeFile(pdf,Buffer.from(bytes,'base64'));
  }
  // Korean of realistic rendered width: ~0.6 Hangul syllables per English character.
  await app.evaluate(({app,dialog},ratio)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:app.getPath('userData')+'/quality.pdf'});globalThis.choices=[];dialog.showOpenDialog=async()=>({canceled:false,filePaths:globalThis.choices.shift()});
   const {ChatGPT}=process.getBuiltinModule('module').createRequire(app.getAppPath()+'/package.json')('./desktop/chatgpt.cjs');ChatGPT.prototype.status=()=>({connected:true,usable:true});ChatGPT.prototype.models=async()=>[{id:'fixture',name:'Fixture'}];
   const filler='미생물 성장 곡선의 변동을 추정하는 계층적 통계 모형을 비교하고 그 결과를 해석합니다. ';
   globalThis.sentTexts=[];ChatGPT.prototype.translate=async(_m,blocks)=>blocks.map(b=>{globalThis.sentTexts.push(b.text);if(/^A\. Researcher/.test(b.text))return {id:b.id,text:b.text};const m=/^(Table|Fig\.?|Figure)\s*(\d+)[.:]/i.exec(b.text),prefix=m?(/^t/i.test(m[1])?'표 ':'그림 ')+m[2]+'. ':'',title=m?'성장 모형의 예측 성능. ':'',marks=b.text.match(/<(sub|sup)>[^<]*<\/\1>/g)||[],lead=marks.length?'모형 M'+marks.join(', M')+'의 ':'',n=Math.max(2,Math.round(b.text.replace(/<\/?su[bp]>/g,'').length*ratio)-prefix.length-title.length-lead.length);let t='';while(t.length<n)t+=filler;return {id:b.id,text:prefix+title+lead+t.slice(0,n).trim()+'.'};});},ratio);
  await app.evaluate((_,f)=>globalThis.choices.push(f),[vault]);await p.locator('[data-action="storage"]').first().click();await p.locator('.library').waitFor();
  await app.evaluate((_,f)=>globalThis.choices.push(f),[pdf]);await p.locator('[data-action="add-files"]').first().click();await p.locator('.paper-item').click();
  await p.locator('[data-mode="dual"]').click();await p.locator('[data-action="gpt-start"]').click();await p.locator('[data-action="gpt-export"]').waitFor({timeout:300000});
  await p.locator('[data-mode="translated"]').click();
  const count=await p.evaluate(()=>document.querySelector('.translated-pane .translated-pages').pdfViewer.pagesCount),report=[],shown=[];
  for(let i=1;i<=count;i++){
   await p.evaluate(i=>{document.querySelector('.translated-pane .translated-pages').pdfViewer.currentPageNumber=i;},i);
   await p.waitForFunction(i=>document.querySelector(`.translated-sheet[data-page="${i}"] .translation-layer[data-ready="true"]`),i);
   const page=await p.evaluate(i=>{
    const plan=document.querySelector('.translated-pane .translated-pages').pdfController.plans.get(i-1),layer=document.querySelector(`.translated-sheet[data-page="${i}"] .translation-layer`);
    const moved=plan.blocks.filter(b=>!b.sourceOnly&&(b.preserveSource||b.overflow)).map(b=>({id:b.id,reason:b.reason,split:Number.isInteger(b.splitAt),text:b.text.slice(0,60)}));
    const nodes=[...layer.querySelectorAll('.translated-block:not(.source-preserved)')].map(n=>({overflow:n.querySelector('.translation-content').scrollHeight>n.querySelector('.translation-content').clientHeight+1||n.querySelector('.translation-content').scrollWidth>n.querySelector('.translation-content').clientWidth+1,rect:{x:parseFloat(n.style.left),y:parseFloat(n.style.top),w:parseFloat(n.style.width),h:parseFloat(n.style.height)},id:n.dataset.blockId,text:n.querySelector('.translation-content').textContent,strong:n.querySelector('strong')?.textContent||'',serif:n.dataset.serif,kind:n.dataset.kind,indent:parseFloat(n.style.getPropertyValue('--indent'))||0,hang:parseFloat(n.style.getPropertyValue('--hang'))||0,subs:n.querySelectorAll('.translation-content sub').length,sups:n.querySelectorAll('.translation-content sup').length}));
    return {page:i,blocks:plan.blocks.length,translated:nodes.length,sourceOnly:plan.blocks.filter(b=>b.sourceOnly).map(b=>b.text.slice(0,30)),moved,shrunk:plan.blocks.filter(b=>b.fitScale<1).length,continuation:Boolean(document.querySelector(`.layout-flow-continuation[data-continuation-for="${i}"]`)),nodes};
   },i);
   // Source ink visible in a 3px ring just outside each translation mask
   // (stray glyph tops, fringes); with and without the mask extension.
   // PDF.js may swap the canvas while re-rendering; measure once it is back.
   const edges=async()=>{await p.waitForFunction(i=>document.querySelector(`.translated-sheet[data-page="${i}"] canvas`)?.width>0,i);return p.evaluate(i=>{
    const sheet=document.querySelector(`.translated-sheet[data-page="${i}"]`),canvas=sheet.querySelector('canvas'),layer=sheet.querySelector('.translation-layer');
    const img=canvas.getContext('2d',{willReadFrequently:true}).getImageData(0,0,canvas.width,canvas.height),k=canvas.width/Number(layer.dataset.sourceWidth);
    const boxes=[...layer.querySelectorAll('.translated-block')].map(n=>({text:n.dataset.sourceText,x:parseFloat(n.style.left),y:parseFloat(n.style.top),w:parseFloat(n.style.width),h:parseFloat(n.style.height),masked:!n.classList.contains('source-preserved'),pad:['top','right','bottom','left'].map(s=>parseFloat(getComputedStyle(n).getPropertyValue('--mask-'+s))||0)}));
    // A point under another box or its mask extension is not visible ink.
    const inside=(x,y,self)=>boxes.some(b=>b!==self&&x>=b.x-(b.masked?b.pad[3]:0)-1&&x<=b.x+b.w+(b.masked?b.pad[1]:0)+1&&y>=b.y-(b.masked?b.pad[0]:0)-1&&y<=b.y+b.h+(b.masked?b.pad[2]:0)+1);
    const dark=(x,y)=>{const px=Math.round(x*k),py=Math.round(y*k);if(px<0||py<0||px>=img.width||py>=img.height)return false;const j=(py*img.width+px)*4,c=[img.data[j],img.data[j+1],img.data[j+2]];return (c[0]+c[1]+c[2])/3<140&&Math.max(...c)-Math.min(...c)<=60;};// coloured graphics are not glyph remnants
    const out={};
    for(const b of boxes.filter(b=>b.masked)){const [t,r,bt,l]=b.pad;let hits=0;
     for(const d of [1,2,3]){const sides=[[],[],[],[]];
      for(let x=b.x-l;x<=b.x+b.w+r;x+=1/k){sides[0].push([x,b.y-t-d/k]);sides[1].push([x,b.y+b.h+bt+d/k]);}
      // Side strips skip the corners, where a rule under the box would read as ink.
      for(let y=b.y-t+2;y<=b.y+b.h+bt-2;y+=1/k){sides[2].push([b.x-l-d/k,y]);sides[3].push([b.x+b.w+r+d/k,y]);}
      // A strip that is mostly ink is a rule or border, not a remnant.
      for(const strip of sides){const hit=strip.filter(([x,y])=>!inside(x,y,b)&&dark(x,y)).length;if(hit/Math.max(1,strip.length)<.3)hits+=hit;}}
     if(hits)out[b.text.slice(0,40)]=hits;}
    return out;
   },i);};
   page.edges=await edges();
   const off=await p.addStyleTag({content:'.translation-layer .translated-block{--mask-top:0px!important;--mask-right:0px!important;--mask-bottom:0px!important;--mask-left:0px!important}'});page.edgesWithoutExtension=await edges();await off.evaluate(n=>n.remove());
   const remnant=Object.values(page.edges).reduce((a,b)=>a+b,0);console.log(`  edge remnants: ${remnant}px${remnant?' '+JSON.stringify(page.edges):''} (without mask extension ${Object.values(page.edgesWithoutExtension).reduce((a,b)=>a+b,0)}px)`);
   assert.ok(page.nodes.every(n=>!n.overflow),'screen translation text fits its box');
   for(let a=0;a<page.nodes.length;a++)for(let b=a+1;b<page.nodes.length;b++){
    const x=page.nodes[a].rect,y=page.nodes[b].rect;
    assert.ok(Math.min(x.x+x.w,y.x+y.w)-Math.max(x.x,y.x)<=2||Math.min(x.y+x.h,y.y+y.h)-Math.max(x.y,y.y)<=2,'screen translation boxes must not overlap');
   }
   report.push(page);shown.push(...page.nodes.map(n=>n.text));
   console.log(`page ${i}: ${page.translated}/${page.blocks} in place, shrunk ${page.shrunk}, displaced ${page.moved.length}${page.moved.length?' '+JSON.stringify(page.moved):''}${page.continuation?' (continuation)':''}`);
  }
  const record=await p.evaluate(()=>translationRecord.pages.flatMap(p=>p.blocks.filter(b=>b.flowIds?.length).map(b=>({id:b.id,members:b.flowIds}))));
  console.log(`paragraph chains: ${record.length}${record.length?' '+JSON.stringify(record):''}`);
  // Inspect actual print fragments before printing: columns/continuations may
  // interleave a paragraph in the PDF text stream even when every glyph exists.
  await app.evaluate(({app})=>app.on('web-contents-created',(_event,contents)=>{
   const print=contents.printToPDF.bind(contents);
   contents.printToPDF=async options=>{
    globalThis.printFragments=await contents.executeJavaScript("Array.from(document.querySelectorAll('.block')).map(n=>({id:n.dataset.blockId,text:n.textContent,overflow:n.scrollHeight>n.clientHeight+1||n.scrollWidth>n.clientWidth+1}))");
    return print(options);
   };
  }));
  await p.evaluate(()=>saveGPTPdf());const out=await app.evaluate(({app})=>app.getPath('userData')+'/quality.pdf');
  for(let i=0;i<300;i++){try{await fs.access(out);break;}catch{await new Promise(r=>setTimeout(r,200));}}
  await new Promise(r=>setTimeout(r,1000));
  const pdfjs=await import('pdfjs-dist/legacy/build/pdf.mjs'),task=pdfjs.getDocument({data:new Uint8Array(await fs.readFile(out)),standardFontDataUrl:path.join(root,'node_modules/pdfjs-dist/standard_fonts/')}),doc=await task.promise;let text='';
  for(let n=1;n<=doc.numPages;n++){const page=await doc.getPage(n);text+=(await page.getTextContent()).items.map(i=>i.str||'').join('');page.cleanup();}
  const saved=doc.numPages;await task.destroy();console.log(`saved PDF: ${saved} pages for ${count} source pages`);
  if(process.env.APP_QUALITY_REPORT)await fs.writeFile(process.env.APP_QUALITY_REPORT,JSON.stringify({report,chains:record,saved},null,1));
  const fragments=await app.evaluate(()=>globalThis.printFragments);
  assert.ok(fragments?.length,'print fragments captured');
  assert.ok(fragments.every(f=>!f.overflow),'no printed fragment clips text');
  const compact=text.replace(/\s/g,''),joined=new Map();
  for(const f of fragments)joined.set(f.id,(joined.get(f.id)||'')+f.text);
  for(const node of report.flatMap(r=>r.nodes))assert.ok((joined.get(node.id)||'').replace(/\s/g,'').includes(node.text.replace(/\s/g,'')),'print retains displayed block '+node.id);
  const missing=fragments.filter(f=>!compact.includes(f.text.replace(/\s/g,'')));
  assert.deepEqual(errors,[]);
  assert.deepEqual(missing,[],'saved PDF keeps each rendered print fragment');
  if(strict){
   assert.deepEqual(report.flatMap(r=>r.moved).filter(m=>m.reason!=='math'),[],'prose must stay in place at realistic length');
   assert.equal(report.some(r=>r.continuation),false);assert.equal(saved,count);
  }
  if(!real&&!stress){
   const [one,two,three,four,five]=report,find=(r,start)=>r.nodes.find(n=>n.text.startsWith(start));
   // The model receives repaired math-font notation: brackets, commas, braces, primes, ≤ and ∼.
   const sent=(await app.evaluate(()=>globalThis.sentTexts)).join('\n');
   for(const piece of ['for 1 ≤ r ≤ R as','GP(0, km(t, t′))','hyperparameters {s2 m, ‘m}','N(0, s2 r I)'])assert.ok(sent.includes(piece),'sent text carries '+piece);
   // Subscripts and superscripts reach the model marked, and the translation's marks render as scripts.
   for(const piece of ['Other M<sub>null</sub> models are converted to M<sub>batch</sub>','batches<sup>12,15</sup>'])assert.ok(sent.includes(piece),'sent text carries '+piece);
   assert.ok(four.nodes.some(n=>n.subs===2),'the Model page paragraph shows its two subscripts: '+JSON.stringify(four.nodes.map(n=>n.subs)));assert.ok(two.nodes.some(n=>n.sups===1),'the citation superscript is drawn raised');
   assert.ok(!report.some(r=>r.nodes.some(n=>/<\/?su[bp]>/.test(n.text))),'no tag is shown as text');assert.doesNotMatch(text,/<\/?su[bp]>/,'no tag is printed as text');
   assert.doesNotMatch(sent,/[ðÞ]| \uFFFD /,'no math-font brackets or lost relation signs reach the model');
   // Mis-encoded math-font text: prose (nested "ð…Þ", "∼" as U+FFFD) is translated
   // in place and every display equation keeps its source.
   assert.equal(three.nodes.filter(n=>n.text.length>80).length,5,'all five prose paragraphs are translated in place: '+JSON.stringify(three.sourceOnly));
   assert.equal(three.sourceOnly.filter(t=>/^(?:yr|ap|bc)\(/.test(t)).length,5,'display equations keep their source: '+JSON.stringify(three.sourceOnly));
   assert.ok(one.sourceOnly.includes('OD600')&&one.sourceOnly.includes('Time (h)'),'figure labels keep their source');
   assert.equal(find(one,'표 1.').strong,'표 1. 성장 모형의 예측 성능.');assert.equal(find(one,'그림 2.').strong,'그림 2. 성장 모형의 예측 성능.');
   assert.equal(record.length,1,'the paragraph continued from column 1 to column 2 is one chain');
   assert.ok(two.sourceOnly.includes('A. Researcher and B. Scientist')&&!two.moved.length,'a translation equal to its source (author names) stays as source in place');
   const member=two.nodes.find(n=>n.id===record[0].members[0]);assert.ok(member&&member.text.length>10,'the column 2 continuation shows its share of the joined translation');
   // Paragraph breaks: the indented "Table 1 summarises …" paragraph is its own box with its indent.
   const summary=one.nodes.find(n=>n.kind==='body'&&n.indent>0);assert.ok(summary,'an indented source paragraph keeps its first-line indent');
   // Model section: five indented source paragraphs stay five boxes (indents kept),
   // with encoded inline math translated in place.
   assert.equal(four.nodes.filter(n=>n.kind==='body'&&n.text.length>60).length,6,'each source paragraph is its own translated box: '+JSON.stringify(four.nodes.map(n=>n.text.length)));
   assert.ok(four.nodes.filter(n=>n.indent>0).length>=3,'first-line indents are reproduced');
   // Prose with lost math glyphs ("�k,r") and a paragraph above a tall display
   // equation stay translated in place; the equation pieces stay source as one block.
   assert.deepEqual(four.moved,[],'no Model-page paragraph is kept as source: '+JSON.stringify(four.moved));
   assert.ok(!four.sourceOnly.some(t=>/^verged/.test(t)),'the line finishing "con-" stays in its paragraph: '+JSON.stringify(four.sourceOnly));
   // Equation (7) with math-font overbraces ("zﬄ…}|ﬄ…{") is one source-only formula, never sent or painted over.
   assert.ok(four.sourceOnly.some(t=>/^zffl/.test(t)),'the overbrace equation keeps its source: '+JSON.stringify(four.sourceOnly));
   assert.doesNotMatch((await app.evaluate(()=>globalThis.sentTexts)).join('\n'),/(?:ffl|\uFB04){2,}/,'brace pieces are never sent for translation');
   assert.equal(four.sourceOnly.filter(t=>/^yk;r|^yk,r|^yk/.test(t)).length,1,'equation (8) is one source block: '+JSON.stringify(four.sourceOnly));
   // References: every numbered entry is its own block (PLOS sets each number in its own column;
   // the number opens its entry), kept as its source and never sent for translation.
   const entries=five.sourceOnly.filter(t=>/^(?:8|9|10|11|12|13)\. \p{Lu}/u.test(t));assert.equal(entries.length,6,'six reference entries, each its own source block: '+JSON.stringify(five.sourceOnly));
   assert.deepEqual(entries.map(t=>t.split(' ')[0]),['8.','9.','10.','11.','12.','13.'],'each entry carries its own number');
   assert.ok(!(await app.evaluate(()=>globalThis.sentTexts)).some(t=>/^(?:8|9|10|11|12|13)\. \p{Lu}/u.test(t)),'reference entries are not sent for translation');
   assert.ok(!five.sourceOnly.some(t=>/^\d+\.?$/.test(t.trim())),'no number is left behind as a separate source block: '+JSON.stringify(five.sourceOnly));
   assert.ok(!five.sourceOnly.some(t=>/^6\. https/.test(t)),'a wrapped line starting "6. https" stays in its entry: '+JSON.stringify(five.sourceOnly));
   const inked=Object.keys(one.edgesWithoutExtension).find(t=>t.startsWith('We compared'));
   assert.ok(inked,'the fixture leaves ink just above the first paragraph');assert.equal(Object.keys(one.edges).some(t=>t.startsWith('We compared')),false,'the mask extension hides ink just outside the box');
   assert.ok(one.nodes.filter(n=>n.kind==='body'&&n.text.length>80).every(n=>n.serif==='true')&&one.nodes.some(n=>n.kind==='body'&&n.serif==='true'),'serif source paragraphs use the serif Korean face');
  }
  console.log(real||stress?`PASS layout quality report${strict?' (strict: no displaced prose)':''}: ${saved}-page export keeps every displayed translation`:`PASS layout quality: prose in place, shared paragraph chains, figure labels kept, bold caption titles, ${saved}-page export with every displayed translation`);
 }finally{await app?.close();await fs.rm(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }).catch(error => console.warn(`임시 폴더를 다 지우지 못했습니다(${error.code}). 테스트 결과와는 무관합니다: ${temp}`));}
})().catch(error=>{console.error(error);process.exitCode=1;});
