// The words this function writes into the saved PDF, in the translation's language (they are part of that
// document), and its errors, in the screen language. printText() builds them where tr() is (main), and the
// function fills their places itself.
const {tr,trIn}=require('./i18n.js');
function printText(language='ko'){return {sourceAt:trIn(language,'[{page}쪽] {text}'),keptFooter:trIn(language,'원문으로 둔 문단의 번역 · {count}'),continued:trIn(language,'원문 {page} · 계속 {count}'),tooSmall:tr('PDF 페이지가 원문 글자 크기의 두 줄을 담기에도 작습니다. 페이지 크기를 확인하세요.'),unfinished:tr('PDF 연속 페이지의 텍스트 배치를 완료하지 못했습니다. 원문 {page}페이지를 확인하세요.')};}
// Runs in the isolated Electron print window. Keep this function self-contained:
// main.cjs serializes it; text always comes from the validated translation cache.
async function preparePrintDocument(sample,emphasis=(text,label)=>{const m=label&&/^([^:：\n]{1,24}[:：])([\s\S]*)$/.exec(text);return m?[m[1],m[2]]:null;},limits={body:.8,line:.65,tail:{lines:2.5,scale:.72,leading:1.2},hard:.5},text){
  text=text||{sourceAt:'[{page}쪽] {text}',keptFooter:'원문으로 둔 문단의 번역 · {count}',continued:'원문 {page} · 계속 {count}',tooSmall:'PDF 페이지가 원문 글자 크기의 두 줄을 담기에도 작습니다. 페이지 크기를 확인하세요.',unfinished:'PDF 연속 페이지의 텍스트 배치를 완료하지 못했습니다. 원문 {page}페이지를 확인하세요.'}; // i18n:keep — printText('ko') for a caller that passes no text (tests/print-text.test.cjs keeps them equal)
  const say=(template,values)=>template.replace(/\{(\w+)\}/g,(whole,name)=>Object.hasOwn(values,name)?String(values[name]):whole);
  await Promise.all(Array.from(document.images).map(image=>image.decode()));
  await document.fonts.ready;
  const adjustments=[];
  // Math drawn as graphics in a sentence: cut from this page's own image, in em of its line.
  const graphicCache=new Map(),pageImage=i=>document.querySelector(`.page[data-source-page="${i}"]>img`);
  const fillGraphic=span=>{const spec=span.dataset.graphic,[page,x,y,width,height]=spec.split(':').map(Number);let url=graphicCache.get(spec);
   if(!pageImage(page))return;if(url===undefined){url=null;const image=pageImage(page),sheet=image?.parentElement;if(image&&image.naturalWidth&&sheet){const k=image.naturalWidth/parseFloat(sheet.style.width),pad=height*.4,top=Math.max(0,y-pad),bottom=Math.min(parseFloat(sheet.style.height),y+height+pad),canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(width*k));canvas.height=Math.max(1,Math.round((bottom-top)*k));const context=canvas.getContext('2d',{willReadFrequently:true});context.drawImage(image,x*k,top*k,width*k,(bottom-top)*k,0,0,canvas.width,canvas.height);
     // As on screen, above and below its box the drawing reaches only as far as ink goes on without a blank band of a
     // quarter of its height: the next line of a tightly set slide is not cut with it.
     let from=0,to=canvas.height-1;try{const W=canvas.width,H=canvas.height,data=context.getImageData(0,0,W,H).data,px=(i)=>[data[i],data[i+1],data[i+2]].join(),corners=[0,(W-1)*4,((H-1)*W)*4,((H-1)*W+W-1)*4].map(px),back=(corners.find(c=>corners.filter(d=>d===c).length>1)||corners[0]).split(',').map(Number),row=r=>{for(let c=0;c<W;c++){const i=(r*W+c)*4;if(Math.abs(data[i]-back[0])+Math.abs(data[i+1]-back[1])+Math.abs(data[i+2]-back[2])>60)return true;}return false;},gap=Math.max(2,Math.round(height*k*.25)),b0=Math.max(0,Math.round((y-top)*k)),b1=Math.min(H-1,Math.round((y+height-top)*k));from=b0;to=b1;for(let r=b0-1,blank=0;r>=0;r--){if(row(r)){from=r;blank=0;}else if(++blank>gap)break;}for(let r=b1+1,blank=0;r<H;r++){if(row(r)){to=r;blank=0;}else if(++blank>gap)break;}}catch{/* a canvas that cannot be read is printed untrimmed */}
     const cut=document.createElement('canvas');cut.width=canvas.width;cut.height=Math.max(1,to-from+1);cut.getContext('2d').drawImage(canvas,0,from,canvas.width,cut.height,0,0,cut.width,cut.height);url={src:cut.toDataURL('image/png'),w:width/height,h:cut.height/k/height};}graphicCache.set(spec,url);}
   span.replaceChildren();span.style.cssText='display:inline-block;vertical-align:middle;line-height:0';if(url){const img=document.createElement('img');img.src=url.src;img.style.cssText=`display:block;width:${url.w}em;height:${url.h}em`;span.append(img);}};
  for(const span of document.querySelectorAll('.graphic-math'))fillGraphic(span);
  const probe=document.createElement('div');probe.className='block print-measure';probe.style.cssText='position:fixed;left:-100000px;top:0;height:auto;visibility:hidden;overflow:visible';document.body.append(probe);
  try{
    // As on screen, nothing leaves its page (limits.hard). A paragraph kept as its source has
    // its translation gathered here and set after the last page, so page N stays page N.
    const sourcePages=[...document.querySelectorAll('.page[data-source-page]')],appendix=[];
    for(const page of sourcePages){
      const image=page.querySelector(':scope>img');if(!image)continue;
      const width=parseFloat(page.style.width),height=parseFloat(page.style.height),sourcePage=Number(page.dataset.sourcePage);
      const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;
      const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(image,0,0);const pixels=ctx.getImageData(0,0,canvas.width,canvas.height);
      const nodes=[...page.querySelectorAll(':scope>.block')];
      const boxes=nodes.map(node=>({node,x:parseFloat(node.style.left),y:parseFloat(node.style.top),width:parseFloat(node.style.width),height:parseFloat(node.style.height),fontSize:parseFloat(getComputedStyle(node).fontSize),role:node.dataset.typography,sectionId:node.dataset.sectionId||'page',text:node.dataset.text??node.textContent,emph:node.dataset.label}));
      const protectedBoxes=[...page.querySelectorAll('.protected-region')].map(n=>({x:parseFloat(n.style.left),y:parseFloat(n.style.top),width:parseFloat(n.style.width),height:parseFloat(n.style.height)}));
      // Persistent x positions and widths are the continuation template. Full
      // width titles/captions are spanning objects, not another narrow column.
      const lanes=[];
      for(const box of boxes.filter(b=>!['title','heading','subheading','figure-caption','table-caption'].includes(b.role)&&b.width>=width*.16&&b.width<=width*.68)){
        const lane=lanes.find(l=>Math.abs(l.x-box.x)<16&&Math.abs(l.width-box.width)<Math.max(30,l.width*.2));
        if(lane){lane.width=Math.max(lane.width,box.width);lane.count++;}else lanes.push({x:box.x,width:box.width,count:1});
      }
      if(!lanes.length)lanes.push({x:Math.max(16,Math.min(...boxes.map(b=>b.x),width*.08)),width:Math.min(width-32,Math.max(...boxes.map(b=>b.width),width*.5)),count:1});
      lanes.sort((a,b)=>a.x-b.x);
      // Overlapping width variants must not create physically overlapping lanes.
      for(let i=lanes.length-1;i>0;i--)if(lanes[i-1].x+lanes[i-1].width>lanes[i].x+2){
        if(lanes[i-1].count>=lanes[i].count)lanes.splice(i,1);else lanes.splice(i-1,1);
      }
      const top=Math.max(24,height*.08),bottom=height-Math.max(28,height*.06),pending=[];
      const setup=box=>{
        probe.dataset.typography=box.role;probe.style.width=box.width+'px';probe.style.setProperty('--type-size',box.fontSize+'px');
        // Measure with the block's own family, alignment and source line pitch.
        for(const key of ['serif','align','heavy'])probe.dataset[key]=box.node.dataset[key]||'';
        for(const name of ['--type-leading','--indent','--hang']){const value=box.node.style.getPropertyValue(name);if(value&&!(name==='--indent'&&box.emph===null))probe.style.setProperty(name,value);else probe.style.removeProperty(name);}
      };
      // Re-apply the source emphasis (bold field label or caption title) after splitting.
      // Measuring and drawing use the same bold run: a bold caption title or
      // field label is wider than plain text. Continued tails are plain.
      // Marked subscripts and superscripts (<sub>/<sup> in the text) render as
      // real scripts; unbalanced tags are dropped or closed, other text stays text.
      const rich=(node,text)=>{const stack=[node];for(const piece of String(text??'').split(/(<\/?(?:sub|sup)>|⟦g:[\d:]+⟧)/)){const graphic=/^⟦g:([\d:]+)⟧$/.exec(piece);if(graphic){const span=document.createElement('span');span.className='graphic-math';span.dataset.graphic=graphic[1];stack.at(-1).append(span);fillGraphic(span);continue;}const tag=/^<(\/?)(sub|sup)>$/.exec(piece);if(!tag){if(piece)stack.at(-1).append(piece);continue;}if(!tag[1]){if(stack.length<3){const el=document.createElement(tag[2]);stack.at(-1).append(el);stack.push(el);}}else if(stack.length>1&&stack.at(-1).localName===tag[2])stack.pop();}};
      // Places a block leaves open for another block (data-holes, from pdf-layout holeFloats): a gap of
      // clear text, then a box at one edge, top to bottom; the text is set around them, as on screen.
      const openings=node=>{let list;try{list=JSON.parse(node.dataset.holes||'[]');}catch{list=[];}for(const hole of [...list].reverse()){const gap=document.createElement('span'),box=document.createElement('span');gap.style.cssText=`float:left;clear:both;width:0;height:${Number(hole.gap)||0}px`;box.style.cssText=`float:${hole.side==='right'?'right':'left'};clear:left;width:${Number(hole.width)||0}px;height:${Number(hole.height)||0}px`;node.prepend(gap,box);}};
      // A list (data-list, from pdf-layout's bullet and items): each line starting with a bullet is an
      // item, its bullet in a box as wide as its hanging indent, set as on screen (pdf-view fillList).
      const BULLET_ITEM=/^\s*([•◦▪▫●○■□‣⁃▶►▸▹▷➤➢➔])\s+/;
      const listed=(node,text)=>{
        let list;try{list=JSON.parse(node.dataset.list||'null');}catch{list=null;}
        const lines=String(text??'').split('\n').filter(line=>line.trim());if(!list||!lines.some(line=>BULLET_ITEM.test(line)))return false;
        const spec=Array.isArray(list.items)&&list.items.length===lines.length&&list.items.every((t,i)=>Boolean(t.bullet)===BULLET_ITEM.test(lines[i]))?list.items:null,own=list.hang>0?list.hang:(Number(list.size)||12)*1.4;
        const box=document.createElement('span');box.className='tl-list';node.append(box);let inner=0;
        lines.forEach((line,i)=>{
          const item=document.createElement('span'),mark=BULLET_ITEM.exec(line),at=spec?.[i],hang=at?.hang>0?at.hang:own,dx=at?Math.max(0,Number(at.dx)||0):mark?0:inner;
          item.className='tl-item';item.style.marginLeft=dx+'px';if(i&&at?.gap>0)item.style.marginTop=Number(at.gap)+'px';
          if(mark){const bullet=document.createElement('span');bullet.className='tl-bullet';bullet.style.width=hang+'px';bullet.textContent=mark[1];item.style.paddingLeft=hang+'px';item.style.textIndent=-hang+'px';item.append(bullet);rich(item,line.slice(mark[0].length));inner=dx+hang;}
          else rich(item,line.trim());
          box.append(item);
        });
        return true;
      };
      const fill=(node,text,value)=>{const match=value&&value!=='false'&&emphasis(text,value==='true'?'field':value);node.replaceChildren();if(listed(node,text)){}else if(!match)rich(node,text);else{const strong=document.createElement('strong');rich(strong,match[0]);node.append(strong);rich(node,match[1]);}openings(node);};
      const label=(node,text)=>fill(node,text,node.dataset.label);
      const measure=(box,text)=>{setup(box);if(box.node?.dataset.holes)probe.dataset.holes=box.node.dataset.holes;else delete probe.dataset.holes;if(box.node?.dataset.list)probe.dataset.list=box.node.dataset.list;else delete probe.dataset.list;fill(probe,text,box.emph);return Math.max(probe.getBoundingClientRect().height,probe.scrollHeight);};
      const split=(box,text,space)=>{
        if(!text)return {head:'',tail:'',height:0};
        const total=measure(box,text),leading=parseFloat(getComputedStyle(probe).lineHeight);
        if(total<=space+.1)return {head:text,tail:'',height:total};
        if(space<leading*2-.1)return {head:'',tail:text,height:0};
        // Never cut inside a marked subscript or superscript.
        const spans=[...text.matchAll(/<(sub|sup)>[\s\S]*?<\/\1>|<\/?(?:sub|sup)>/g)].map(m=>[m.index,m.index+m[0].length]),cuttable=i=>!spans.some(([a,b])=>i>a&&i<b);
        const points=[0];for(const part of new Intl.Segmenter('ko',{granularity:'grapheme'}).segment(text))if(cuttable(part.index+part.segment.length))points.push(part.index+part.segment.length);
        const prefix=limit=>{let low=0,high=points.length-1;while(low<high){const mid=Math.ceil((low+high)/2);if(measure(box,text.slice(0,points[mid]))<=limit+.1)low=mid;else high=mid-1;}return points[low];};
        let end=prefix(space);
        // Prefer a word boundary near the end, keeping every original character.
        const floor=Math.max(1,end-80);for(let i=end-1;i>=floor;i--)if(/\s/u.test(text[i])&&cuttable(i+1)&&measure(box,text.slice(0,i+1))>=leading*2-.1){end=i+1;break;}
        if(end&&measure(box,text.slice(end))<leading*2-.1&&measure(box,text.slice(0,end))>leading*3)end=prefix(space-leading);
        return {head:text.slice(0,end),tail:text.slice(end),height:measure(box,text.slice(0,end))};
      };
      // Original page slots stay in place. Only the remainder of a split
      // paragraph, or a preserved one, continues; neighbours that fit stay put.
      for(const box of boxes){
        const {node}=box;
        const sampled=sample(pixels,{x:box.x*pixels.width/width,y:box.y*pixels.height/height,width:box.width*pixels.width/width,height:box.height*pixels.height/height});
        const background=node.style.backgroundColor||sampled.color;
        node.style.backgroundColor=background;if(sampled.ink&&!node.style.color)node.style.color=sampled.ink;
        // The mask extension (maskPads): a background-coloured shadow clipped
        // per side, so it never changes the measured text overflow.
        const spread=Math.max(...['top','right','bottom','left'].map(side=>parseFloat(node.style.getPropertyValue('--mask-'+side))||0));
        if(spread)node.style.boxShadow=`0 0 0 ${spread}px ${background}`;
        setup(box);
        const minimumWidth=parseFloat(getComputedStyle(probe).fontSize)*2;
        const preserve=node.dataset.preserveSource==='true'||!sampled.safe||box.width<minimumWidth;
        const neighbours=[...boxes,...protectedBoxes].filter(b=>b!==box&&b.y>=box.y+box.height-1&&b.x<box.x+box.width&&b.x+b.width>box.x);
        const available=Math.max(box.height,Math.min(box.height+2,...neighbours.map(b=>b.y-box.y-1),height-box.y));
        node.style.height=available+'px';
        let tooLong=false; // far longer than its box even at half size: set with the kept-source translations at the end
        const isHeading=['title','heading','subheading'].includes(box.role);
        // As on screen, one line is set solid before anything shrinks; text that wraps keeps its leading.
        if(!preserve&&measure(box,box.text)>available+.1&&box.height<parseFloat(getComputedStyle(probe).lineHeight)*2.2){const leading=node.style.getPropertyValue('--type-leading');node.style.setProperty('--type-leading','1');if(measure(box,box.text)>box.fontSize*1.5){if(leading)node.style.setProperty('--type-leading',leading);else node.style.removeProperty('--type-leading');}}
        // Same rule as the screen: shrink by at most 20% (35% for headings and
        // single lines), then split.
        if(!preserve&&measure(box,box.text)>available+.1){
          const base=box.fontSize,fits=scale=>measure({...box,fontSize:base*scale},box.text)<=available+.1;
          setup(box);const floor=isHeading||box.height<parseFloat(getComputedStyle(probe).lineHeight)*2.2?limits.line:limits.body;
          let scale=floor;
          if(fits(floor)){let low=floor,high=1;for(let i=0;i<6;i++){const mid=(low+high)/2;if(fits(mid))low=mid;else high=mid;}scale=low;}
          // Short of room by a line or two: tighter leading and a little
          // smaller type (TAIL_FIT) keep the paragraph whole, as on screen.
          else if(!isHeading&&floor!==limits.line&&limits.tail){
            const leading=parseFloat(node.style.getPropertyValue('--type-leading'))||1.4,needed=measure({...box,fontSize:base*floor},box.text),line=parseFloat(getComputedStyle(probe).lineHeight);
            if((needed-available)/line<=limits.tail.lines){
              node.style.setProperty('--type-leading',Math.min(leading,limits.tail.leading));
              if(fits(limits.tail.scale)){let low=limits.tail.scale,high=1;for(let i=0;i<6;i++){const mid=(low+high)/2;if(fits(mid))low=mid;else high=mid;}scale=low;}
              else node.style.setProperty('--type-leading',leading);
            }
          }
          // Still too long: shrink further, to limits.hard at most; past that the box grows.
          if(limits.hard&&!fits(scale)){if(fits(limits.hard)){let low=limits.hard,high=scale;for(let i=0;i<7;i++){const mid=(low+high)/2;if(fits(mid))low=mid;else high=mid;}scale=low;}else{scale=limits.hard;if(measure({...box,fontSize:base*limits.hard},box.text)<=available*2.5){node.style.height='auto';node.style.minHeight=available+'px';node.style.overflow='visible';}else tooLong=true;}}
          box.fontSize=base*scale;node.style.setProperty('--type-size',box.fontSize+'px');
        }
        const part=preserve||tooLong?{head:'',tail:box.text,height:0}:limits.hard?{head:box.text,tail:'',height:available}:split(box,box.text,available);
        // Do not strand a heading at the bottom of the source page.
        if(isHeading&&part.tail){part.head='';part.tail=box.text;}
        // Moving a whole paragraph must leave the source visible, not an empty
        // background mask over the abstract, summary or equation it came from.
        if(preserve||tooLong||!part.head)node.remove();else label(node,part.head);
        if(part.tail)(limits.hard?appendix:pending).push({...box,text:limits.hard?say(text.sourceAt,{page:sourcePage,text:part.tail}):part.tail,background:limits.hard?'#ffffff':background,emph:null});
      }
      if(limits.hard&&page===sourcePages.at(-1))pending.push(...appendix);
      canvas.width=canvas.height=0;
      let current=null,last=page,count=0;
      const newPage=()=>{
        const sheet=document.createElement('section');sheet.className='page continuation-page';sheet.dataset.continuationFor=sourcePage;sheet.dataset.continuationIndex=++count;
        sheet.style.cssText=`width:${width}px;height:${height}px;page:${page.style.page}`;
        const header=document.createElement('div');header.className='continuation-header';header.style.height=Math.max(0,Math.min(height*.065,...boxes.map(b=>b.y-4)))+'px';
        const copy=image.cloneNode();copy.style.cssText=`width:${width}px;height:${height}px`;header.append(copy);sheet.append(header);
        const footer=document.createElement('div');footer.className='continuation-footer';footer.dataset.typography='metadata';footer.textContent=limits.hard?say(text.keptFooter,{count}):say(text.continued,{page:sourcePage,count});sheet.append(footer);
        last.after(sheet);last=sheet;current={sheet,cursors:lanes.map(()=>top),groups:new Map()};return current;
      };
      const fitsLane=box=>lanes.map((l,i)=>({...l,index:i})).filter(l=>Math.abs(l.width-box.width)<Math.max(28,box.width*.2));
      for(let index=0;index<pending.length;index++){
        const box=pending[index];let remaining=box.text;
        // Equal-width columns are one flow. A narrow sidebar, footnote or
        // differently sized caption retains its own x position and width.
        const compatible=['body','heading','subheading'].includes(box.role)?fitsLane(box):[];
        const group=compatible.length?compatible.map(l=>l.index).join(','):null;
        while(remaining){
          if(!current)newPage();
          let column=group?(current.groups.get(group)||0):0;
          const lane=group?compatible[column]:null;
          const placed={...box,x:lane?lane.x+Math.max(0,box.x-lanes.reduce((best,l)=>Math.abs(l.x-box.x)<Math.abs(best.x-box.x)?l:best,lanes[0]).x):box.x,width:lane?Math.min(lane.width,box.width):box.width};
          // Tiny extracted table labels cannot hold even one Korean glyph at
          // the source font size. Keep their source; widen only the continuation.
          setup(placed);const minimumWidth=parseFloat(getComputedStyle(probe).fontSize)*2;
          if(placed.width<minimumWidth){placed.width=Math.min(minimumWidth,width-32);placed.x=Math.max(16,Math.min(placed.x,width-16-placed.width));}
          let intersect=lanes.map((l,i)=>({l,i})).filter(({l})=>l.x<placed.x+placed.width&&l.x+l.width>placed.x);
          if(!intersect.length)intersect=[{i:0,l:lanes[0]}];
          let y=Math.max(...intersect.map(({i})=>current.cursors[i]));
          const needed=measure(placed,remaining),leading=parseFloat(getComputedStyle(probe).lineHeight);
          if(bottom-top<leading*2)throw Error(text.tooSmall);
          if(['footnote','annotation'].includes(box.role)&&needed<bottom-top)y=Math.max(y,bottom-needed);
          const isHeading=['title','heading','subheading'].includes(box.role);
          const next=pending[index+1];const reserve=isHeading&&next?Math.min(measure({...placed,role:next.role,fontSize:next.fontSize},next.text),leading*2):0;
          let part=(isHeading&&needed+reserve>bottom-y&&needed<bottom-top)?{head:'',tail:remaining,height:0}:split(placed,remaining,bottom-y);
          if(!part.head){
            if(group&&column+1<compatible.length){current.groups.set(group,column+1);continue;}
            // A pathological single unbreakable heading is allowed to split on
            // a fresh page. For ordinary text, fresh columns always fit >=2 lines.
            if(y<=top+.1&&isHeading&&needed+reserve>bottom-top)part=split(placed,remaining,bottom-y);
            if(!part.head){newPage();continue;}
          }
          const node=box.node.cloneNode(false);node.removeAttribute('data-preserve-source');fill(node,part.head,null);
          node.style.cssText=`--type-size:${box.fontSize}px;--indent:0px;--hang:0px;${box.node.style.getPropertyValue('--type-leading')?'--type-leading:'+box.node.style.getPropertyValue('--type-leading')+';':''}left:${placed.x}px;top:${y}px;width:${placed.width}px;height:${part.height}px;background-color:${box.background};${box.node.style.color?'color:'+box.node.style.color:''}`;
          current.sheet.append(node);
          const gap=parseFloat(getComputedStyle(probe).fontSize)*parseFloat(getComputedStyle(probe).getPropertyValue('--type-gap'))||6;
          for(const {i} of intersect)current.cursors[i]=y+part.height+gap;
          remaining=part.tail;
          if(remaining){if(group&&column+1<compatible.length)current.groups.set(group,column+1);else newPage();}
        }
      }
      if(count)adjustments.push({page:sourcePage,addedPages:count,lanes:lanes.map(({x,width})=>({x,width}))});
    }
  }finally{probe.remove();}
  // A continuation header may refer to the source image. Ensure it is decoded
  // before printToPDF so a repeated running header cannot become blank.
  await Promise.all(Array.from(document.images).map(image=>image.decode()));
  for(const block of document.querySelectorAll('.block'))if(block.textContent&&(block.scrollHeight>block.clientHeight+1||block.scrollWidth>block.clientWidth+1))throw Error(say(text.unfinished,{page:block.parentElement.dataset.sourcePage||block.parentElement.dataset.continuationFor}));
  return adjustments;
}
module.exports={preparePrintDocument,printText};
