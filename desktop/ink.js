/* Handwriting layer: pen, highlighter and stroke eraser over PDF.js pages.
   Strokes are stored in PDF user space by the main process; drawing, reopening
   and exporting never ask for a translation or any model. */
// The highlighter's four (yellow, green, pink, sky) are strong colours that, laid as a highlighter lays them on white paper
// (multiply, opacity .35), show the pastel colours of the example: seen = 1 − .35 × (1 − value) per channel. The four it
// had before (INK_HIGHLIGHTER_BEFORE) stay on offer in its + panel, which also has the example's orange and violet.
const inkPalettes={pen:['#1f2937','#1d4ed8','#dc2626','#047857'],highlighter:['#fffc00','#00f600','#cc00ee','#00f4f6']};
const INK_HIGHLIGHTER_BEFORE=['#fde047','#4ade80','#f472b6','#60a5fa'];
const inkColorNames={'#1f2937':tr('검정'),'#1d4ed8':tr('파랑'),'#dc2626':tr('빨강'),'#047857':tr('초록',null,'color'),'#7c3aed':tr('보라'),'#fffc00':tr('노랑'),'#00f600':tr('연두'),'#cc00ee':tr('분홍'),'#00f4f6':tr('하늘'),'#f1a118':tr('주황'),'#1820e0':tr('연보라'),
  '#9f1239':tr('와인'),'#ff8a65':tr('산호'),'#fecdd3':tr('연분홍'),'#fed7aa':tr('살구'),'#92400e':tr('갈색'),'#0891b2':tr('청록'),'#134e4a':tr('짙은 청록'),'#808000':tr('올리브'),'#365314':tr('짙은 올리브'),'#ecfccb':tr('연한 연두'),
  '#fde047':tr('진한 노랑'),'#4ade80':tr('진한 연두'),'#f472b6':tr('진한 분홍'),'#60a5fa':tr('진한 하늘')};
const inkWidths={pen:{min:.5,max:6,step:.25},highlighter:{min:4,max:24,step:1}};
const inkPressureWidth=(width,p)=>width*(.4+1.2*p);
// Colours added by the user, after the fixed palette: a few per tool, the oldest giving way.
const inkCustomMax=3,inkHex=c=>typeof c==='string'&&/^#[0-9a-f]{6}$/.test(c);
// Three thickness presets per tool (thin, medium, bold); pressing the chosen
// one again opens a slider that adjusts it.
const inkSizeNames=[tr('가늘게'),tr('보통'),tr('굵게',null,'ink size')];
const inkState={tool:'read',color:{pen:inkPalettes.pen[0],highlighter:inkPalettes.highlighter[0]},width:{pen:1.5,highlighter:12},sizes:{pen:[.75,1.5,3],highlighter:[8,12,18]},sizeIndex:{pen:1,highlighter:1},sizeOpen:false,custom:{pen:[],highlighter:[]},recent:{pen:[],highlighter:[]},touchWrites:false,inputSeen:false,includeInk:true,docs:new Map(),undo:[],redo:[],key:null,bases:new Map(),baseRecords:new Map(),surfaces:new Map(),pending:new Set()};
const inkWidthOk=(tool,w)=>Number.isFinite(w)&&w>=inkWidths[tool].min&&w<=inkWidths[tool].max;
// A highlighter colour chosen in an earlier version (the four before, and the older yellow #facc15) is read as the
// colour of the same name now; strokes keep the colour they were drawn in.
const inkHighlighterMoved={'#facc15':'#fffc00','#fde047':'#fffc00','#4ade80':'#00f600','#f472b6':'#cc00ee','#60a5fa':'#00f4f6'};
const inkRecentMax=6;
try{const saved=JSON.parse(localStorage.getItem('app-ink')||'null');if(saved){if(inkHighlighterMoved[saved.color?.highlighter]&&!(Array.isArray(saved.custom?.highlighter)&&saved.custom.highlighter.includes(saved.color.highlighter)))saved.color.highlighter=inkHighlighterMoved[saved.color.highlighter];for(const tool of ['pen','highlighter']){if(Array.isArray(saved.recent?.[tool]))inkState.recent[tool]=[...new Set(saved.recent[tool].filter(inkHex))].slice(0,inkRecentMax);if(Array.isArray(saved.custom?.[tool]))inkState.custom[tool]=[...new Set(saved.custom[tool].filter(inkHex))].slice(-inkCustomMax);if(inkPalettes[tool].includes(saved.color?.[tool])||inkState.custom[tool].includes(saved.color?.[tool]))inkState.color[tool]=saved.color[tool];
  const sizes=saved.sizes?.[tool],at=saved.sizeIndex?.[tool],w=Number(saved.width?.[tool]);
  if(Array.isArray(sizes)&&sizes.length===3&&sizes.every(v=>inkWidthOk(tool,v))&&[0,1,2].includes(at)){inkState.sizes[tool]=sizes.map(Number);inkState.sizeIndex[tool]=at;}
  // Settings from before the presets: the saved width becomes the nearest preset.
  else if(inkWidthOk(tool,w)){const near=inkState.sizes[tool].reduce((best,v,i,a)=>Math.abs(v-w)<Math.abs(a[best]-w)?i:best,0);inkState.sizes[tool][near]=w;inkState.sizeIndex[tool]=near;}
  inkState.width[tool]=inkState.sizes[tool][inkState.sizeIndex[tool]];}
  inkState.touchWrites=saved.touchWrites===true;inkState.inputSeen=saved.inputSeen===true;if(typeof saved.includeInk==='boolean')inkState.includeInk=saved.includeInk;
  // Text boxes: the colour used last (the next box starts with it) and colours picked by hand (newest first).
  if(inkHex(saved.textColor))inkState.textColor=saved.textColor;if(Number.isInteger(saved.textSize)&&saved.textSize>=6&&saved.textSize<=72)inkState.textSize=saved.textSize;if(Array.isArray(saved.textCustom))inkState.textCustom=[...new Set(saved.textCustom.filter(inkHex))].slice(0,4);}}catch{/* saved pen settings that cannot be read: the defaults stay */}
function persistInkPrefs(){try{localStorage.setItem('app-ink',JSON.stringify({color:inkState.color,custom:inkState.custom,recent:inkState.recent,width:inkState.width,sizes:inkState.sizes,sizeIndex:inkState.sizeIndex,touchWrites:inkState.touchWrites,inputSeen:inkState.inputSeen,includeInk:inkState.includeInk,...(inkState.textColor?{textColor:inkState.textColor}:{}),...(inkState.textSize?{textSize:inkState.textSize}:{}),textCustom:inkState.textCustom||[]}));}catch{}}
// Touch writing is offered only once a pen or touch screen is known: the
// system reports touch points, or a pen/touch pointer has reached the app
// (a pen-only tablet can report none). Until then a finger never writes.
const inkCoarse=matchMedia('(any-pointer: coarse)');
function inkTouchCapable(){return inkState.inputSeen||navigator.maxTouchPoints>0||inkCoarse.matches;}
function inkTouchWrites(){return inkState.touchWrites&&inkTouchCapable();}
// Some pads on a touch screen send their pen as touch. A contact with real pressure or tilt is a pen,
// so it writes even while fingers move the page.
function inkPenLike(event){return event.pointerType==='pen'||event.pointerType==='touch'&&(Math.abs(event.tiltX||0)+Math.abs(event.tiltY||0)>0||event.pressure>0&&event.pressure!==.5&&event.pressure!==1);}
function inkFingerPans(event){return event.pointerType==='touch'&&!inkTouchWrites()&&!inkPenLike(event);}
function inkTouchOffer(){const bar=document.querySelector('.ink-toolbar');if(bar&&inkTouchCapable()&&!bar.querySelector('[data-ink-touch]'))bar.querySelector('[data-ink-undo]').insertAdjacentHTML('beforebegin',inkTouchButton());}
function inkSeeInput(event){
  if(event.pointerType!=='pen'&&event.pointerType!=='touch')return;
  inkState.inputSeen=true;persistInkPrefs();document.removeEventListener('pointerdown',inkSeeInput,true);document.removeEventListener('pointermove',inkSeeInput,true);
  // Added in place, so a press that is landing on the toolbar still clicks.
  inkTouchOffer();
}
if(!inkState.inputSeen){document.addEventListener('pointerdown',inkSeeInput,true);document.addEventListener('pointermove',inkSeeInput,true);}
inkCoarse.addEventListener('change',inkTouchOffer);
function inkId(){return crypto.randomUUID?.()||Array.from(crypto.getRandomValues(new Uint8Array(16)),b=>b.toString(16).padStart(2,'0')).join('');}

// One document per attachment surface: the original PDF, or one stored translation.
function inkDoc(surface){
  const key=state.storageKey+':'+state.selected+':'+(state.selectedAttachment||'primary')+':'+surface;
  let doc=inkState.docs.get(key);
  if(!doc){
    doc={key,libraryId:state.storageKey,paperId:state.selected,attachmentId:state.selectedAttachment,surface,strokes:new Map(),pending:[],saving:null,failed:null,stale:false,containers:new Set()};
    doc.loaded=window.appApi.inkLoad(doc.libraryId,doc.paperId,doc.attachmentId,surface).then(view=>{doc.stale=view.stale;for(const stroke of view.strokes)doc.strokes.set(stroke.id,stroke);if(view.stale)toast(tr('원문 파일이 바뀌어 이전 필기를 표시하지 않습니다. 필기 기록은 보관합니다.'));}).catch(error=>{doc.loadError=error;toast(tr('필기를 불러오지 못했습니다: {error}',{error:shownError(error)}));});
    inkState.docs.set(key,doc);
  }
  return doc;
}
function inkPageViews(container){const viewer=container.pdfViewer;if(!viewer)return [];const views=[];for(let i=0;i<viewer.pagesCount;i++){const view=viewer.getPageView(i);if(view?.div?.dataset.ready==='true'&&view.pdfPage)views.push(view);}return views;}
function inkAttach(container,surface){
  if(!container)return;
  if(container.inkSurface===surface)return;
  container.inkDoc?.containers.delete(container);container.inkSurface=surface;container.inkDoc=surface?inkDoc(surface):null;
  container.querySelectorAll('.app-ink-layer,.app-ink-live').forEach(node=>node.remove());
  if(!container.inkBound){container.inkBound=true;container.addEventListener('app-pagerendered',event=>{if(container.inkDoc)inkDrawPage(container,event.detail.pageView);});}
  const doc=container.inkDoc;if(!doc)return;doc.containers.add(container);
  doc.loaded.then(()=>{if(container.inkDoc===doc)for(const view of inkPageViews(container))inkDrawPage(container,view);});
}
function inkLayer(container,view){
  let canvas=view.div.querySelector(':scope>.app-ink-layer');
  if(!canvas){canvas=document.createElement('canvas');canvas.className='app-ink-layer';canvas.setAttribute('aria-hidden','true');view.div.append(canvas);canvas.addEventListener('pointerdown',event=>inkPointerDown(container,view,canvas,event));canvas.addEventListener('pointermove',event=>inkHover(container,view,canvas,event));canvas.addEventListener('pointerleave',()=>canvas.classList.remove('ink-over-selection'));}
  canvas.inkView=view;
  return canvas;
}
function inkBacking(canvas,view){
  const dpr=window.devicePixelRatio||1,w=view.viewport.width,h=view.viewport.height,k=Math.min(dpr,Math.sqrt(8e6/Math.max(1,w*h)));
  const width=Math.max(1,Math.round(w*k)),height=Math.max(1,Math.round(h*k));
  if(canvas.width!==width||canvas.height!==height){canvas.width=width;canvas.height=height;}
  return k;
}
function inkScale(viewport){return Math.hypot(viewport.transform[0],viewport.transform[1]);}
function inkPaint(ctx,stroke,viewport,k){
  const pts=[];for(let i=0;i<stroke.points.length;i+=4){const [x,y]=viewport.convertToViewportPoint(stroke.points[i],stroke.points[i+1]);pts.push([x*k,y*k,stroke.points[i+2]]);}
  if(!pts.length)return;
  const scale=inkScale(viewport)*k;ctx.save();ctx.lineCap='round';ctx.lineJoin='round';ctx.strokeStyle=stroke.color;ctx.fillStyle=stroke.color;
  if(stroke.tool==='highlighter'){
    ctx.globalAlpha=.35;ctx.globalCompositeOperation='multiply';ctx.lineWidth=stroke.width*scale;ctx.beginPath();ctx.moveTo(pts[0][0],pts[0][1]);
    if(pts.length===1)ctx.lineTo(pts[0][0]+.01,pts[0][1]);for(const p of pts.slice(1))ctx.lineTo(p[0],p[1]);ctx.stroke();ctx.restore();return;
  }
  // A shape (rectangle, triangle, arrow, ellipse, line) runs corner to corner
  // at one width; the pen's smoothing through midpoints would round a
  // rectangle's corners into a "D".
  if(stroke.shape&&pts.length>1){
    ctx.lineWidth=inkPressureWidth(stroke.width,.5)*scale;ctx.beginPath();pts.forEach((p,i)=>i?ctx.lineTo(p[0],p[1]):ctx.moveTo(p[0],p[1]));
    if(pts.length>2&&Math.hypot(pts[0][0]-pts.at(-1)[0],pts[0][1]-pts.at(-1)[1])<.5)ctx.closePath();
    ctx.stroke();ctx.restore();return;
  }
  if(pts.length===1){ctx.beginPath();ctx.arc(pts[0][0],pts[0][1],inkPressureWidth(stroke.width,pts[0][2])*scale/2,0,Math.PI*2);ctx.fill();ctx.restore();return;}
  // Pressure changes the width per segment; midpoints keep joins smooth.
  // Consecutive segments of the same (quantized) width share one path.
  let width=null;
  for(let i=1;i<pts.length;i++){
    const a=pts[i-1],b=pts[i],from=i===1?a:[(pts[i-2][0]+a[0])/2,(pts[i-2][1]+a[1])/2],to=i===pts.length-1?b:[(a[0]+b[0])/2,(a[1]+b[1])/2];
    const w=Math.round(inkPressureWidth(stroke.width,(a[2]+b[2])/2)*scale*4)/4;
    if(w!==width){if(width!==null)ctx.stroke();width=w;ctx.lineWidth=w;ctx.beginPath();ctx.moveTo(from[0],from[1]);}
    if(i===pts.length-1)ctx.lineTo(b[0],b[1]);else ctx.quadraticCurveTo(a[0],a[1],to[0],to[1]);
  }
  ctx.stroke();
  ctx.restore();
}
function inkDrawPage(container,view){
  const doc=container.inkDoc;if(!doc||!view?.pdfPage)return;
  const canvas=inkLayer(container,view),k=inkBacking(canvas,view),ctx=canvas.getContext('2d');ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,canvas.width,canvas.height);
  if(doc.stale)return;
  const index=view.id-1,hidden=inkState.hidden?.doc===doc?inkState.hidden.ids:null,strokes=[...doc.strokes.values()].filter(s=>s.page===index&&!hidden?.has(s.id)).sort((a,b)=>(a.tool==='highlighter'?0:1)-(b.tool==='highlighter'?0:1));
  for(const stroke of strokes)inkPaint(ctx,stroke,view.viewport,k);
}
function inkRedraw(doc,pages){for(const container of doc.containers){if(!container.isConnected){doc.containers.delete(container);continue;}for(const view of inkPageViews(container))if(!pages||pages.has(view.id-1))inkDrawPage(container,view);}}

// One active tool decides who gets the pointer: in reading mode the ink layer
// lets every event through to PDF.js text selection, links and scrolling.
let inkStroke=null;
// A stroke whose lift never arrived (a remote pen app such as EasyCanvas can drop it) would
// swallow every later press and hold its pane. It ends, with what was written so far, when its
// pointer is seen moving with nothing pressed, or at a new press from the same pointer or the
// same pen, or one after the open stroke has gone quiet.
function inkStrokeStale(event){const s=inkStroke;return !s.canvas.isConnected||event.pointerId===s.pointerId||event.pointerType==='pen'&&s.device==='pen'||event.timeStamp-s.lastAt>1500;}
function inkEndStale(event){
  if(!inkStroke||!inkStrokeStale(event))return;
  const s=inkStroke;s.detach?.();try{if(s.canvas.hasPointerCapture?.(s.pointerId))s.canvas.releasePointerCapture(s.pointerId);}catch{/* the pointer is already released */}
  if(s.path)inkGestureEnd();else inkFinish();
}
function inkPoint(view,event){
  const rect=view.div.getBoundingClientRect(),x=(event.clientX-rect.left)*view.viewport.width/rect.width,y=(event.clientY-rect.top)*view.viewport.height/rect.height;
  return view.viewport.convertToPdfPoint(x,y);
}
function inkPressure(event){return inkPenLike(event)&&event.pressure>0?Math.min(1,event.pressure):.5;}
function inkPointerDown(container,view,canvas,event){
  if(inkState.tool==='read'||!container.inkDoc)return;
  const doc=container.inkDoc;
  // A palm touching the screen while the pen writes is ignored; otherwise a
  // finger moves the page unless touch writing is switched on.
  inkEndStale(event);
  if(event.pointerType==='touch'&&!inkPenLike(event)&&inkStroke)return;
  if(inkFingerPans(event)){inkPan(container,canvas,event);return;}
  if(event.button!==0&&!(event.buttons&32))return;
  if(inkStroke)return;
  if(doc.stale){toast(tr('원문 파일이 바뀌어 이 필기는 수정할 수 없습니다.'));return;}
  event.preventDefault();canvas.setPointerCapture(event.pointerId);
  const tool=event.buttons&32?'eraser':inkState.tool,start=event.timeStamp;
  inkStroke={container,view,canvas,doc,tool,pointerId:event.pointerId,start,device:['pen','mouse','touch'].includes(event.pointerType)?event.pointerType:undefined,lastAt:event.timeStamp,points:[],erased:new Map()};
  inkMove(event);
  // A page re-rendered by PDF.js mid-stroke drops the capture; the stroke
  // written so far is still kept.
  const detach=()=>{for(const type of ['pointerup','pointercancel','lostpointercapture'])canvas.removeEventListener(type,up);canvas.removeEventListener('pointermove',move);};
  const move=e=>{if(e.pointerId!==inkStroke?.pointerId)return;if(!e.buttons){detach();inkFinish();return;}inkStroke.lastAt=e.timeStamp;inkMove(e);},up=e=>{if(e.pointerId!==inkStroke?.pointerId)return;detach();if(e.type==='pointerup')inkMove(e);inkFinish();};
  inkStroke.detach=detach;
  canvas.addEventListener('pointermove',move);for(const type of ['pointerup','pointercancel','lostpointercapture'])canvas.addEventListener(type,up);
}
function inkPan(container,canvas,event){
  let x=event.clientX,y=event.clientY;canvas.setPointerCapture(event.pointerId);
  const move=e=>{if(e.pointerId!==event.pointerId)return;container.scrollBy(x-e.clientX,y-e.clientY);x=e.clientX;y=e.clientY;},up=e=>{if(e.pointerId!==event.pointerId)return;canvas.removeEventListener('pointermove',move);canvas.removeEventListener('pointerup',up);canvas.removeEventListener('pointercancel',up);};
  canvas.addEventListener('pointermove',move);canvas.addEventListener('pointerup',up);canvas.addEventListener('pointercancel',up);
}
function inkMove(event){
  const s=inkStroke;if(!s)return;
  for(const e of event.getCoalescedEvents?.().length?event.getCoalescedEvents():[event]){
    const [x,y]=inkPoint(s.view,e);
    if(s.tool==='eraser'){inkErase(s,x,y);continue;}
    if(e.shiftKey)s.ruler=true;
    if(s.ruler){inkRuler(s.points,Math.round(x*100)/100,Math.round(y*100)/100,Math.max(0,Math.round(e.timeStamp-s.start)));continue;}
    const n=s.points.length;if(n>=80000||n&&s.points[n-4]===x&&s.points[n-3]===y)continue; // the store keeps up to 20,000 points a stroke
    s.points.push(Math.round(x*100)/100,Math.round(y*100)/100,Math.round(inkPressure(e)*1000)/1000,Math.max(0,Math.round(e.timeStamp-s.start)));
  }
  if(s.tool!=='eraser')inkLiveOf(s).request();
}
// ---- The gesture in progress, drawn the same way on PDF pages and notebook pages ----
// A stroke, shape, lasso loop or move box is painted on its own canvas over the page, at most
// once a frame; only that canvas is redrawn while the pen moves. end() cancels a paint still
// waiting and removes the canvas, so nothing drawn for a gesture can outlive it (a leftover paint
// over the saved stroke once made a notebook highlighter twice as dark).
// size() gives the page's drawing space in CSS pixels; paint(ctx,k) draws at k device pixels per one.
function inkLivePreview(host,size,paint){
  let canvas=null,frame=0,ended=false;
  const draw=()=>{frame=0;if(ended||!host.isConnected)return;
    if(!canvas){canvas=document.createElement('canvas');canvas.className='app-ink-live';canvas.setAttribute('aria-hidden','true');host.append(canvas);}
    const {width,height}=size(),dpr=window.devicePixelRatio||1,k=Math.min(dpr,Math.sqrt(8e6/Math.max(1,width*height))),w=Math.max(1,Math.round(width*k)),h=Math.max(1,Math.round(height*k));
    if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;}
    const ctx=canvas.getContext('2d');ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,w,h);paint(ctx,k);};
  return {request(){if(!ended&&!frame)frame=requestAnimationFrame(draw);},end(){ended=true;if(frame)cancelAnimationFrame(frame);frame=0;canvas?.remove();canvas=null;}};
}
// A PDF page's gesture: a stroke draws as itself; shapes, lassos and moves draw as outlines.
const inkLiveOf=s=>s.live||=inkLivePreview(s.view.div,()=>s.view.viewport,(ctx,k)=>s.mode?inkOverlayPaint(s,ctx,k):inkLivePaint(s,ctx,k));
function inkLivePaint(s,ctx,k){inkPaint(ctx,{tool:s.tool,color:inkState.color[s.tool],width:inkState.width[s.tool],points:s.points},s.view.viewport,k);}
// Point bounds of a stroke in PDF units. Strokes are never changed in place
// (edits make new objects), so the cache cannot go stale.
const inkBoundsCache=new WeakMap();
function inkBounds(stroke){
  let b=inkBoundsCache.get(stroke);if(b)return b;const p=stroke.points;b=[Infinity,Infinity,-Infinity,-Infinity];
  for(let i=0;i<p.length;i+=4){if(p[i]<b[0])b[0]=p[i];if(p[i]>b[2])b[2]=p[i];if(p[i+1]<b[1])b[1]=p[i+1];if(p[i+1]>b[3])b[3]=p[i+1];}
  inkBoundsCache.set(stroke,b);return b;
}
const inkNear=(stroke,x,y,reach)=>{const b=inkBounds(stroke);return x>=b[0]-reach&&x<=b[2]+reach&&y>=b[1]-reach&&y<=b[3]+reach;};
function inkErase(s,x,y){
  const index=s.view.id-1,radius=8/inkScale(s.view.viewport);let hit=false;
  for(const stroke of s.doc.strokes.values()){
    if(stroke.page!==index||s.erased.has(stroke.id))continue;
    // Highlights and underlines of selected text have no points: their line boxes are what the eraser touches.
    if(stroke.tool==='mark'){const b=inkBox(stroke,s.view.viewport),v=s.view.viewport.convertToViewportPoint(x,y),pad=8;if(v[0]>=b.x0-pad&&v[0]<=b.x1+pad&&v[1]>=b.y0-pad&&v[1]<=b.y1+pad){s.erased.set(stroke.id,stroke);hit=true;}continue;}
    if(inkStrokeReach(stroke,x,y,radius)){s.erased.set(stroke.id,stroke);hit=true;}
  }
  if(hit){for(const id of s.erased.keys())s.doc.strokes.delete(id);inkDrawPage(s.container,s.view);}
}
// Whether a point (page units) is within `radius` of a stroke's line, its width counted: what the eraser touches and
// what the select tool presses (notebook pages too).
function inkStrokeReach(stroke,x,y,radius){
  const reach=radius+(stroke.tool==='highlighter'?stroke.width:inkPressureWidth(stroke.width,1))/2,p=stroke.points;
  if(!inkNear(stroke,x,y,reach))return false;
  for(let i=0;i<p.length;i+=4){
    const ax=p[i],ay=p[i+1],bx=i+4<p.length?p[i+4]:ax,by=i+4<p.length?p[i+5]:ay,dx=bx-ax,dy=by-ay,t=dx||dy?Math.max(0,Math.min(1,((x-ax)*dx+(y-ay)*dy)/(dx*dx+dy*dy))):0;
    if(Math.hypot(ax+t*dx-x,ay+t*dy-y)<=reach)return true;
  }
  return false;
}
function inkFinish(){
  const s=inkStroke;inkStroke=null;if(!s)return;
  s.live?.end();
  if(s.tool==='eraser'){
    if(!s.erased.size)return;
    const strokes=[...s.erased.values()];inkRecord({doc:s.doc,type:'delete',strokes});inkQueue(s.doc,{type:'delete',ids:strokes.map(x=>x.id)});inkRedraw(s.doc,new Set(strokes.map(x=>x.page)));return;
  }
  if(!s.points.length)return;
  const page=s.view.pdfPage,stroke={id:inkId(),page:s.view.id-1,tool:s.tool,color:inkState.color[s.tool],width:inkState.width[s.tool],points:s.points,...(s.device?{device:s.device}:{}),createdAt:new Date().toISOString()};
  s.doc.strokes.set(stroke.id,stroke);inkRecord({doc:s.doc,type:'add',strokes:[stroke]});
  inkQueue(s.doc,{type:'add',stroke,geometry:{view:[...page.view],rotate:page.rotate,userUnit:page.userUnit||1}});
  inkRedraw(s.doc,new Set([stroke.page]));
}

// Undo works on user actions (a stroke, an erase), never on pointer events,
// and the stacks belong to the open paper only.
function inkRecord(action){inkState.undo.push(action);if(inkState.undo.length>500)inkState.undo.shift();inkState.redo=[];inkToolbarState();}
function inkReverse(action,undo){
  if(action.custom){if(undo)action.undo();else action.redo();return;}
  const {doc,strokes}=action,remove=(action.type==='add')===undo;
  if(remove)for(const s of strokes)doc.strokes.delete(s.id);else for(const s of strokes)doc.strokes.set(s.id,s);
  inkQueue(doc,{type:remove?'delete':'restore',ids:strokes.map(s=>s.id)});inkRedraw(doc,new Set(strokes.map(s=>s.page)));
}
function inkUndo(){const action=inkState.undo.pop();if(!action)return;inkReverse(action,true);inkState.redo.push(action);inkToolbarState();}
function inkRedo(){const action=inkState.redo.pop();if(!action)return;inkReverse(action,false);inkState.undo.push(action);inkToolbarState();}

// A change is shown as saved only after the main process has synced it to disk.
function inkQueue(doc,op){doc.touched=true;doc.pending.push(op);inkState.pending.add(doc);inkFlush(doc).catch(()=>{});}
// Before the window closes: every queued stroke reaches the main process,
// then the notebook (registered by notebook.js) saves.
globalThis.appFlushAll=async()=>{if(typeof desktopNotes==='function')await desktopNotes().catch(()=>{});await Promise.all([...inkState.pending].map(doc=>inkFlush(doc).catch(()=>{})));await globalThis.appNotebookFlush?.();};
function inkFlush(doc){
  if(doc.saving)return doc.saving;
  if(!doc.pending.length){inkState.pending.delete(doc);inkStatus();return Promise.resolve();}
  clearTimeout(doc.retry);const batch=doc.pending.splice(0,200);inkStatus();
  doc.saving=window.appApi.inkApply(doc.libraryId,doc.paperId,doc.attachmentId,doc.surface,batch).then(()=>{doc.saving=null;doc.failed=null;return inkFlush(doc);},error=>{
    doc.saving=null;
    // A refusal that no retry can change (the source or translation was
    // replaced, the limit is reached) drops this batch instead of holding
    // every later stroke behind it; a changed source makes the layer read-only.
    const code=errorCode(error);
    if(code==='APP_INK_STALE'||code==='APP_INK_REJECTED'||code==='APP_VAULT_CHANGED'){
      if(code==='APP_INK_STALE')doc.stale=true;doc.failed=null;toast(tr('필기 일부를 저장하지 못했습니다: {error}',{error:shownError(error).replace(/^.*Error: /,'')}));return inkFlush(doc);
    }
    doc.pending.unshift(...batch);doc.failed=error;inkStatus();toast(tr('필기 저장 실패: {error}',{error:shownError(error)}));
    doc.retry=setTimeout(()=>inkFlush(doc).catch(()=>{}),3000);throw error;
  });
  return doc.saving;
}
async function inkFlushAll(){for(const doc of [...inkState.pending]){await inkFlush(doc);}if([...inkState.docs.values()].some(d=>d.pending.length||d.failed))throw Error(tr('저장하지 못한 필기가 있습니다. 필기 저장을 다시 시도한 뒤 내보내세요.'));}
function inkStatus(){
  const node=document.querySelector('.ink-status');if(!node)return;
  const docs=[...inkState.docs.values()].filter(d=>d.paperId===state.selected&&d.libraryId===state.storageKey);
  const failed=docs.some(d=>d.failed),busy=docs.some(d=>d.saving||d.pending.length);
  const before=node.dataset.state;node.dataset.state=failed?'failed':busy?'saving':'saved';
  if((before==='failed')!==failed&&typeof layoutReaderStatus==='function')requestAnimationFrame(()=>layoutReaderStatus()); // a failed save needs its room in the row
  node.innerHTML=failed?`${tr('필기 저장 실패')} <button type="button" class="secondary small" data-ink-retry>${tr('다시 시도')}</button>`:'';
  node.toggleAttribute('data-touched',docs.some(d=>d.touched)); // something was written here since the paper was opened
}

// Tools are icon buttons: the name shows on hover or keyboard focus (inkTip)
// and is read out from aria-label.
Object.assign(paths,{
  inkRead:'M5 3l14 7.5-6.2 1.6L10 18.5z',
  inkPen:'M4 20l1.1-4.6L15.6 4.9a2 2 0 0 1 2.8 0l.7.7a2 2 0 0 1 0 2.8L8.6 18.9z M13.8 6.7l3.5 3.5',
  inkHighlighter:'M9 11l-6 6v3h9l3-3 M22 12l-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4',
  inkEraser:'M8 20l-4.3-4.3a1 1 0 0 1 0-1.4l9.6-9.6a1 1 0 0 1 1.4 0l5.6 5.6a1 1 0 0 1 0 1.4L12 20z M9 9.5l5.5 5.5 M8 20h12',
  inkMemo:'M4 4h16v12h-8l-5 4v-4H4z M8 8.5h8 M8 12h5',
  inkShape:'M3 3h9v9H3z M17 21a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  inkLasso:'M3.5 9a8.5 5 0 1 0 17 0a8.5 5 0 1 0-17 0 M7.5 13c-2 1.5-1.5 4 .5 4.5s.5 3-2 3.5',
  inkMark:'M4 21h16 M7 17l5-13 5 13 M8.5 13h7',
  inkUndo:'M9 14L4 9l5-5 M4 9h10.5a5.5 5.5 0 0 1 0 11H11',
  inkRedo:'M15 14l5-5-5-5 M20 9H9.5a5.5 5.5 0 0 0 0 11H13',
  inkTouchWrite:'M4 20l4-1 10-10-3-3L5 16z M14 7l3 3 M3 21h7',inkTouch:'M9 11V4.5a1.5 1.5 0 0 1 3 0V10 M12 9.5a1.5 1.5 0 0 1 3 0V11 M15 10.5a1.5 1.5 0 0 1 3 0V15a6 6 0 0 1-6 6h-1.5a5 5 0 0 1-4-2L3.8 15.6a1.5 1.5 0 0 1 2.3-1.9L9 16.5V11',
  inkCrosshair:'M7 2v10 M2 7h10 M14 14h7v7h-7z',
  inkAdd:'M12 6v12 M6 12h12'
});
function inkButton(attrs,cls,name,iconName,tip=name){return `<button type="button" ${attrs} class="${cls} ink-icon" aria-label="${name}" data-tip="${tip}">${icon(iconName)}</button>`;}
// Pen and highlighter carry a bar in the colour they write with.
function inkToolButton(id,name,iconName,tip){const on=inkState.tool===id,inked=id==='pen'||id==='highlighter';return inkButton(`data-ink-tool="${id}" aria-pressed="${on}"${inked?` style="--tool-color:${inkState.color[id]}"`:''}`,[on?'active':'',inked?'ink-inked':''].join(' ').trim(),name,iconName,tip);}
// The icon shows what a finger does now: a hand (moves the page) or a pen (writes).
function inkTouchButton(){const on=inkState.touchWrites;return inkButton(`data-ink-touch aria-pressed="${on}"`,'ink-ghost',on?tr('손가락으로 쓰기'):tr('손가락으로 화면 이동'),on?'inkTouchWrite':'inkTouch',on?tr('손가락: 쓰기 · 누르면 손가락으로 화면을 움직이고 펜으로만 씁니다'):tr('손가락: 화면 이동(펜으로 씀) · 누르면 손가락으로도 씁니다'));}
// A preset's dot grows with its width (square root, so the thin presets
// still differ), in the tool's colour.
function inkSizeDot(kind,w){const r=inkWidths[kind];return Math.round(3+Math.sqrt((w-r.min)/(r.max-r.min))*13);}
function inkSizes(kind){
  const on=inkState.sizeIndex[kind],w=inkState.width[kind],r=inkWidths[kind],name=kind==='pen'?tr('펜'):tr('형광펜',null,'ink tool');
  const pop=inkState.sizeOpen?`<div class="ink-size-pop" role="group" aria-label="${kind==='pen'?tr('펜 굵기 조절'):tr('형광펜 굵기 조절')}"><input type="range" data-ink-width min="${r.min}" max="${r.max}" step="${r.step}" value="${w}" aria-label="${kind==='pen'?tr('펜 굵기'):tr('형광펜 굵기')}"><output>${w}</output></div>`:'';
  return `<div class="ink-sizes" role="group" aria-label="${kind==='pen'?tr('펜 굵기'):tr('형광펜 굵기')}" style="--dot-color:${inkState.color[kind]}">${inkState.sizes[kind].map((v,i)=>`<button type="button" class="ink-size" data-ink-size="${i}" aria-pressed="${i===on}" aria-label="${inkSizeNames[i]} ${v}" data-tip="${i===on?tr('{size} · {value} (다시 누르면 조절)',{size:inkSizeNames[i],value:v}):`${inkSizeNames[i]} · ${v}`}"><span class="ink-dot" style="--dot:${inkSizeDot(kind,v)}px"></span></button>`).join('')}${pop}</div>`;
}
function inkToolbar(){
  const tool=inkState.tool,kind=tool==='highlighter'?'highlighter':'pen';
  const tools=[['read',tr('읽기',null,'ink tool'),'inkRead',tr('읽기 · 선택과 스크롤')],['pen',tr('펜'),'inkPen'],['highlighter',tr('형광펜',null,'ink tool'),'inkHighlighter'],['eraser',tr('지우개'),'inkEraser']];
  return `<div class="ink-toolbar" role="toolbar" aria-label="${tr('필기 도구')}"><div class="segmented ink-tools">${tools.map(t=>inkToolButton(...t)).join('')}</div><div class="ink-colors" role="group" aria-label="${kind==='pen'?tr('펜 색'):tr('형광펜 색')}">${inkPalettes[kind].map(color=>`<button type="button" class="ink-color" data-ink-color="${color}" style="--ink-color:${color}" aria-label="${inkColorNames[color]}" data-tip="${inkColorNames[color]}" aria-pressed="${inkState.color[kind]===color}"></button>`).join('')}${inkState.custom[kind].map(color=>`<button type="button" class="ink-color" data-ink-color="${color}" data-ink-custom style="--ink-color:${color}" aria-label="${tr('추가한 색 {color}',{color})}" data-tip="${tr('추가한 색 · 오른쪽 클릭이나 Delete로 지우기')}" aria-pressed="${inkState.color[kind]===color}"></button>`).join('')}${inkButton('data-ink-add-color','ink-color-add',tr('색 추가'),'inkAdd',tr('색 추가 · 원하는 색을 골라 칸에 더하기'))}</div>${inkSizes(kind)}<div class="ink-history">${inkTouchCapable()?inkTouchButton():''}${inkButton('data-ink-undo','ink-ghost',tr('필기 실행 취소'),'inkUndo',tr('실행 취소 (Ctrl+Z)'))}${inkButton('data-ink-redo','ink-ghost',tr('필기 다시 실행'),'inkRedo',tr('다시 실행 (Ctrl+Shift+Z)'))}</div><span class="ink-status" role="status" aria-live="polite"></span><span class="ink-hint small muted"></span></div>`;
}
// The pointer over a page takes the tool's shape, with its hotspot where the
// tool marks; pen and highlighter are filled with the current colour.
const inkCursors={pen:['inkPen',4,20],highlighter:['inkHighlighter',4,19],eraser:['inkEraser',6,18],lasso:['inkLasso',6,21],text:['inkMemo',4,4],memo:['memoPin',12,21],shape:['inkCrosshair',7,7]};
function inkCursor(tool){
  if(tool==='hand')return 'grab';
  if(tool==='laser')return `url("data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><circle cx="8" cy="8" r="5" fill="#ef4444" stroke="#fff" stroke-width="2"/></svg>')}") 8 8, crosshair`;
  const c=inkCursors[tool];if(!c)return '';
  const d=paths[c[0]],fill=tool==='pen'||tool==='highlighter'?inkState.color[tool]:'none';
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="${d}" stroke="#fff" stroke-width="4"/><path d="${d}" fill="${fill}" stroke="#1f2937" stroke-width="1.6"/></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${c[1]} ${c[2]}, crosshair`;
}
function inkToolbarState(){
  const bar=document.querySelector('.ink-toolbar');if(!bar)return;
  bar.querySelector('[data-ink-undo]').disabled=!inkState.undo.length;bar.querySelector('[data-ink-redo]').disabled=!inkState.redo.length;
  document.body.classList.toggle('ink-active',inkState.tool!=='read');document.body.classList.toggle('ink-erasing',inkState.tool==='eraser');
  const cursor=inkCursor(inkState.tool);if(cursor)document.body.style.setProperty('--ink-cursor',cursor);else document.body.style.removeProperty('--ink-cursor');
  const translated=document.querySelector('.translated-pane .translated-pages'),hint=bar.querySelector('.ink-hint');
  if(hint)hint.dataset.tip=hint.textContent=inkState.tool==='read'||!translated||translated.inkSurface||state.mode==='original'?'':translated.classList.contains('reading-translation')?tr('섹션 보기에는 필기할 수 없습니다. 원문 배치에서 필기하세요.'):tr('번역이 완료되면 번역 화면에도 필기할 수 있습니다.');
  inkStatus();
}
// A window that only shows the original (원문 새 창) reads: no writing tool is taken up there.
const inkViewOnly=()=>document.body.classList.contains('view-window');
function inkSetTool(tool){if(inkViewOnly()&&!['read','hand'].includes(tool)){toast(tr('이 창은 보기 전용입니다. 필기와 표시는 본 창에서 하세요.'));tool='read';}inkState.tool=tool;const bar=document.querySelector('.ink-toolbar');if(bar){bar.outerHTML=inkToolbar();}inkToolbarState();}
// One floating name label below the hovered tool, outside the toolbar so the
// toolbar's overflow never clips it. The toolbar is redrawn on every change,
// so the handlers are delegated.
let inkTipNode=null,inkTipFor=null;
function inkTipShow(button){
  if(!inkTipNode){inkTipNode=document.createElement('div');inkTipNode.className='ink-tip';inkTipNode.setAttribute('role','tooltip');document.body.append(inkTipNode);}
  inkTipFor=button;inkTipNode.textContent=button.dataset.tip;inkTipNode.hidden=false;
  // An open choice menu or thickness slider sits below its button, so the name goes below it.
  const r=button.getBoundingClientRect(),below=(button.closest('.ink-group')?.querySelector('.ink-flyout')||button.closest('.ink-sizes')?.querySelector('.ink-size-pop')||button).getBoundingClientRect().bottom,w=inkTipNode.offsetWidth,h=inkTipNode.offsetHeight;
  inkTipNode.style.left=Math.max(4,Math.min(innerWidth-w-4,r.left+r.width/2-w/2))+'px';
  inkTipNode.style.top=(below+6+h>innerHeight?r.top-6-h:below+6)+'px';
}
function inkTipHide(){if(inkTipNode)inkTipNode.hidden=true;inkTipFor=null;}
const inkTipTarget=event=>event.target.closest?.('.ink-toolbar [data-tip]');
document.addEventListener('pointerover',event=>{const button=inkTipTarget(event);if(button)inkTipShow(button);else if(inkTipFor)inkTipHide();});
document.addEventListener('pointerout',event=>{if(!event.relatedTarget&&inkTipFor)inkTipHide();});
document.addEventListener('pointerdown',inkTipHide,true);
document.addEventListener('focusin',event=>{const button=inkTipTarget(event);if(button?.matches(':focus-visible'))inkTipShow(button);else if(inkTipFor)inkTipHide();});
document.addEventListener('focusout',event=>{if(inkTipTarget(event)===inkTipFor)inkTipHide();});

// Which stored translation the translated pane shows: the current cache, or
// an earlier translation kept because it carries ink.
function inkBaseRecord(key){const revision=inkState.bases.get(key),record=inkState.baseRecords.get(key);return revision&&record?.renderRevision===revision?record:null;}
globalThis.appInk={flashTextBox:(view,stroke)=>inkFlashTextBox(view,stroke),setTool:tool=>inkSetTool(tool),baseRecord:inkBaseRecord,record:inkRecord,paint:inkPaint,pressureWidth:inkPressureWidth,get tool(){return inkState.tool;},get color(){return inkState.color;},get width(){return inkState.width;},get touchWrites(){return inkTouchWrites();},fingerPans:inkFingerPans,penLike:inkPenLike};
function inkTranslationRecord(key){
  const job=currentJob?.key===key?currentJob:null,busy=job&&['running','extracting'].includes(job.state);if(busy)return null;
  return inkBaseRecord(key)||(translationRecord?.key===key&&!translationRecord.partial?translationRecord:null);
}
async function inkLoadSurfaces(key){
  const id=state.storageKey,paperId=state.selected,attachmentId=state.selectedAttachment;
  const list=await window.appApi.inkSurfaces(id,paperId,attachmentId);if(key!==targetKey())return;
  inkState.surfaces.set(key,list);inkBaseSelector();
}
function inkBaseSelector(){
  const key=targetKey(),pane=document.querySelector('.translated-pane'),tools=pane?.querySelector(':scope>.pdf-pane-tools');if(!tools)return;
  const current=translationRecord?.key===key?translationRecord.renderRevision:null,bases=(inkState.surfaces.get(key)||[]).filter(b=>b.revision!==current&&b.strokes>0);
  tools.querySelector('.ink-base-select')?.remove();
  const chosen=inkState.bases.get(key)||'';pane.classList.toggle('viewing-ink-base',Boolean(chosen));
  if(!bases.length&&!chosen)return;
  const select=document.createElement('select');select.className='ink-base-select';select.setAttribute('aria-label',tr('표시할 번역'));
  select.innerHTML=`<option value="">${current?tr('현재 번역'):tr('저장된 번역')}</option>${bases.map(b=>`<option value="${esc(b.revision)}" ${b.revision===chosen?'selected':''}>${tr('필기한 이전 번역 · {date} · 필기 {n}개',{date:esc(b.createdAt?new Date(b.createdAt).toLocaleString(appI18n.uiLocale()):tr('날짜 없음')),n:b.strokes})}</option>`).join('')}`;
  tools.append(select);
}
document.addEventListener('change',event=>{
  if(!event.target.matches('.ink-base-select'))return;
  const key=targetKey(),revision=event.target.value;
  runDesktop(async()=>{
    if(revision){const record=await window.appApi.inkBase(state.storageKey,state.selected,state.selectedAttachment,revision);if(key!==targetKey())return;if(!record)throw Error(tr('필기한 번역 바탕을 찾을 수 없습니다.'));inkState.baseRecords.set(key,{...record,key,partial:false});inkState.bases.set(key,revision);}
    else inkState.bases.delete(key);
    const container=document.querySelector('.translated-pane .translated-pages');if(container)container.dataset.revision='';refreshTranslationPane();
  })();
});
async function inkEnsureRevision(key,record){
  if(record.renderRevision||record.inkRevisionPending)return;record.inkRevisionPending=true;
  try{const cached=await window.appApi.cachedTranslation(state.storageKey,state.selected,state.selectedAttachment);// A record streamed from a finished job has no createdAt; it is the saved
  // translation when its pages are the same.
  if(key===targetKey()&&cached&&cached.sourceHash===record.sourceHash&&(record.createdAt?cached.createdAt===record.createdAt:JSON.stringify(cached.pages)===JSON.stringify(record.pages))){record.renderRevision=cached.renderRevision;record.createdAt||=cached.createdAt;refreshTranslationPane();inkLoadSurfaces(key).catch(()=>{});}}
  finally{record.inkRevisionPending=false;}
}

function inkRefresh(){
  if(state.screen!=='reader'){document.body.classList.remove('ink-active','ink-erasing');return;}
  const key=targetKey();
  if(inkState.key!==key){inkState.key=key;inkState.undo=[];inkState.redo=[];inkState.selection=null;if(inkStroke){inkStroke=null;}inkLoadSurfaces(key).catch(()=>{});}
  const toolbar=document.querySelector('.reader-mode-toolbar');
  if(toolbar&&!toolbar.querySelector('.ink-toolbar'))toolbar.insertAdjacentHTML('beforeend',inkToolbar());
  const original=document.querySelector('.original-pages');if(original)inkAttach(original,'original');
  const sourceTools=document.querySelector('.original-pane .source-tools');
  if(sourceTools&&!inkViewOnly()&&!sourceTools.querySelector('[data-action="ink-export-original"]'))sourceTools.insertAdjacentHTML('beforeend',translationTool('ink-export-original',tr('PDF 저장'),'download'));
  const translated=document.querySelector('.translated-pane .translated-pages');
  if(translated){
    const record=inkTranslationRecord(key);
    if(record&&!record.renderRevision)inkEnsureRevision(key,record).catch(()=>{});
    inkAttach(translated,record?.renderRevision&&!translated.classList.contains('reading-translation')?'t-'+record.renderRevision:null);
  }
  inkBaseSelector();inkToolbarState();
}
const inkRefreshBase=refreshTranslationPane;
refreshTranslationPane=function(){inkRefreshBase();inkRefresh();};

function inkExportDialog(target){
  const missing=target==='translation'&&typeof reviewSummary!=='undefined'?reviewSummary?.counts.missing||0:0;
  modal(tr('PDF 저장'),`<label class="ink-export-choice" data-export-target="${target}"><input type="checkbox" id="ink-export-include" ${inkState.includeInk?'checked':''}> ${tr('필기 포함')}</label>${missing?`<label class="ink-export-choice"><input type="checkbox" id="ink-export-missing"> ${tr('미번역 문단 {n}개는 원문으로 두고 저장 (마지막에 목록 페이지 추가)',{n:missing})}</label>`:''}<p class="small muted">${tr('필기 불포함으로 저장해도 앱에 저장한 필기는 그대로 남습니다. 저장할 때 번역이나 AI 요청을 다시 보내지 않습니다.')}</p>`,btn(tr('취소'),'close')+btn(tr('저장'),'ink-export-confirm','primary'));
}
let inkExportMissing=false;
async function inkExport(){
  const choice=document.querySelector('.ink-export-choice'),target=choice?.dataset.exportTarget,include=document.querySelector('#ink-export-include')?.checked===true;inkExportMissing=document.querySelector('#ink-export-missing')?.checked===true;
  if(!target)return;inkState.includeInk=include;persistInkPrefs();dialog.close();
  if(include)await inkFlushAll();
  if(target==='original'){
    const result=await window.appApi.exportOriginal(state.storageKey,state.selected,state.selectedAttachment,include,include?inkShownMarks():undefined);
    if(result)toast((result.inkStrokes?tr('필기 {n}개를 포함해 원문 PDF를 저장했습니다.',{n:result.inkStrokes}):tr('원문 PDF를 저장했습니다.'))+(result.marks?` ${tr('그림 상자·주석 밑줄 {n}개를 포함했습니다.',{n:result.marks})}`:''));
    return;
  }
  const key=targetKey(),record=inkTranslationRecord(key);
  // Only a kept base is named; otherwise the main process uses the saved cache.
  // Untranslated paragraphs print as their source only when asked for.
  const allowMissing=inkExportMissing;
  // Keeping missing paragraphs as source is for a stopped, partial translation;
  // while a job runs there is nothing settled to print.
  const source=allowMissing?record||(translationRecord?.key===key&&!(currentJob?.key===key&&['running','extracting'].includes(currentJob.state))?translationRecord:null):record;
  if(allowMissing&&!source?.pages){toast(tr('번역이 진행 중입니다. 번역이 끝나거나 멈춘 뒤 저장하세요.'));return;}
  const layoutRecord=allowMissing?{...source,pages:source.pages.map(page=>page&&{...page,blocks:page.blocks.map(b=>b.translation?.trim()&&!b.missingTranslation?b:{...b,translation:b.text,missingTranslation:false})})}:record;
  await saveGPTPdf({record:layoutRecord,includeInk:include,revision:inkBaseRecord(key)?record?.renderRevision:undefined,allowMissing});
}
Object.assign(actions,{'ink-export-original':()=>inkExportDialog('original'),'gpt-export':()=>inkExportDialog('translation'),'ink-export-confirm':runDesktop(inkExport)});

document.addEventListener('click',event=>{
  const tool=event.target.closest('[data-ink-tool]');if(tool){inkSetTool(tool.dataset.inkTool);return;}
  const color=event.target.closest('[data-ink-color]');if(color){inkUseColor(color.dataset.inkColor);return;}
  const add=event.target.closest('[data-ink-add-color]');if(add){inkColorPanelOpen(add);return;}
  if(event.target.closest('[data-ink-touch]')){inkState.touchWrites=!inkState.touchWrites;persistInkPrefs();inkSetTool(inkState.tool);return;}
  if(event.target.closest('[data-ink-undo]')){inkUndo();return;}
  if(event.target.closest('[data-ink-redo]')){inkRedo();return;}
  if(event.target.closest('[data-ink-retry]')){for(const doc of inkState.docs.values())if(doc.failed)inkFlush(doc).catch(()=>{});return;}
});
const inkColorKind=()=>inkState.tool==='highlighter'?'highlighter':'pen';
// Choosing a colour while reading, moving or erasing picks up the pen.
function inkUseColor(color){
  // With a lasso selection up, a colour recolours the selection instead.
  const sel=inkState.selection;if(sel&&['lasso','hand','read'].includes(inkState.tool)&&sel.container.isConnected){inkRecolorSelection(color);return;}
  const kind=inkColorKind();inkState.color[kind]=color;inkRemember(kind,color);if(inkNotWriting())inkState.tool=kind;persistInkPrefs();inkSetTool(inkState.tool);inkSelectionForTool(inkState.tool);}
// Colours used lately (newest first, a few per tool), offered again from the + button.
function inkRemember(kind,color){if(!inkHex(color)||!inkState.recent[kind])return;inkState.recent[kind]=[color,...inkState.recent[kind].filter(c=>c!==color)].slice(0,inkRecentMax);}
function inkRecolorSelection(color){
  const sel=inkState.selection,view=sel.container.pdfViewer?.getPageView(sel.page);if(!view)return;
  const removed=sel.ids.map(id=>sel.doc.strokes.get(id)).filter(s=>s&&s.color!==color);if(!removed.length)return;
  const added=removed.map(st=>({...st,id:inkId(),from:st.id,color,createdAt:new Date().toISOString()})),kept=sel.ids.filter(id=>!removed.some(r=>r.id===id));
  inkReplace(sel.doc,view,removed,added);inkState.selection={...sel,ids:[...kept,...added.map(a=>a.id)]};inkSelectionDraw(sel.container);
}
// + : the text box's colour panel, for this tool's colours (the pen's serve the shapes). Its rows are the text colours
// (the highlighter's, inkSwatchRows, are lighter); the last row holds the colours this tool used
// lately (not those of the text boxes), a right click taking one off. A colour chosen there or with the wheel joins the
// tool's row and is chosen (one already in the row is only chosen), and the panel closes.
// The highlighter's rows: the four it had before and a violet; its four and the example's orange; the text's last two
// rows with the example's violet in place of the dark teal.
const inkSwatchRows=kind=>kind==='highlighter'?[[...INK_HIGHLIGHTER_BEFORE,'#c4b5fd'],[...inkPalettes.highlighter,'#f1a118'],INK_TEXT_BRIGHT[0],INK_TEXT_BRIGHT[1].map(c=>c==='#134e4a'?'#1820e0':c)]:inkTextColorRows();
let inkColorPanel=null;
function closeInkColorPanel(focus=false){
  if(!inkColorPanel)return false;inkColorPanel.remove();inkColorPanel=null;
  if(focus)document.querySelector('.ink-toolbar [data-ink-add-color]')?.focus();return true;
}
function inkColorPanelOpen(button,{toggle=true}={}){
  if(closeInkColorPanel()&&toggle)return;
  const kind=inkColorKind(),rows=inkSwatchRows(kind),shown=new Set(rows.flat()),recent=inkState.recent[kind].filter(c=>!shown.has(c)).slice(0,4);
  const title=inkState.tool==='shape'?tr('도형 색'):kind==='highlighter'?tr('형광펜 색'):tr('펜 색');
  const el=document.createElement('div');el.className='ink-text-pop ink-color-panel';el.dataset.kind=kind;el.setAttribute('role','dialog');el.setAttribute('aria-label',title);
  el.innerHTML=inkSwatchPanelHtml({title,rows,rowTitle:kind==='highlighter'?tr('형광펜 색'):tr('펜 색'),added:recent,chosen:inkState.color[kind],attr:'data-ink-swatch',customAttr:'data-ink-swatch-custom',
    removable:{attr:'data-ink-recent',has:c=>recent.includes(c),title:tr('최근 쓴 색 · 오른쪽 클릭으로 지우기')},name:c=>inkColorNames[c]?(kind==='highlighter'?tr('형광펜 색 {name}',{name:inkColorNames[c]}):tr('펜 색 {name}',{name:inkColorNames[c]})):tr('색 {color}',{color:c})});
  document.body.append(el);inkColorPanel=el;
  // Under +, its tail pointing at it (above when there is no room below), as the text panel sits under its button.
  const r=button.getBoundingClientRect(),pw=el.offsetWidth,ph=el.offsetHeight,mid=r.left+r.width/2,left=Math.max(8,Math.min(mid-28,innerWidth-pw-8)),below=r.bottom+12+ph<=innerHeight-8||r.top-12-ph<8;
  Object.assign(el.style,{left:`${left}px`,top:`${below?r.bottom+12:r.top-12-ph}px`});el.style.setProperty('--tail',`${Math.max(14,Math.min(pw-14,mid-left))}px`);el.dataset.side=below?'below':'above';
  (el.querySelector('[data-ink-swatch][aria-pressed="true"]')||el.querySelector('[data-ink-swatch]')||el.querySelector('[data-ink-swatch-custom]')).focus();
}
function inkColorPanelPick(color){const kind=inkColorPanel?.dataset.kind||inkColorKind();closeInkColorPanel();inkAddColor(kind,color);document.querySelector('.ink-toolbar [data-ink-add-color]')?.focus();}
document.addEventListener('click',event=>{
  const swatch=event.target.closest?.('.ink-color-panel [data-ink-swatch]');if(swatch){inkColorPanelPick(swatch.dataset.inkSwatch);return;}
});
document.addEventListener('change',event=>{if(event.target.matches?.('.ink-color-panel [data-ink-swatch-custom]'))inkColorPanelPick(event.target.value);});
document.addEventListener('pointerdown',event=>{if(inkColorPanel&&!event.target.closest?.('.ink-color-panel,[data-ink-add-color]'))closeInkColorPanel();},true);
// A colour used lately is taken off the panel with a right click.
document.addEventListener('contextmenu',event=>{const b=event.target.closest?.('.ink-color-panel [data-ink-recent]');if(!b)return;event.preventDefault();const kind=inkColorPanel.dataset.kind;inkState.recent[kind]=inkState.recent[kind].filter(c=>c!==b.dataset.inkSwatch);persistInkPrefs();inkColorPanelOpen(document.querySelector('.ink-toolbar [data-ink-add-color]'),{toggle:false});});
// A colour panel's swatches by keyboard (this panel and the text box's): ← → in order, ↑ ↓ to the row above or below,
// Home and End to the first and the last (the colour wheel); Enter or Space chooses.
function inkSwatchMove(event,panel,selector){
  if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(event.key))return false;
  const rows=[...panel.querySelectorAll('.ink-text-row')].map(row=>[...row.querySelectorAll(selector)]).filter(r=>r.length),all=rows.flat();
  const at=all.indexOf(event.target);if(at<0)return false;event.preventDefault();event.stopPropagation();
  const row=rows.findIndex(r=>r.includes(event.target)),col=rows[row].indexOf(event.target);let next;
  if(event.key==='ArrowLeft')next=all[(at-1+all.length)%all.length];else if(event.key==='ArrowRight')next=all[(at+1)%all.length];
  else if(event.key==='Home')next=all[0];else if(event.key==='End')next=all.at(-1);
  else{const to=rows[(row+(event.key==='ArrowDown'?1:rows.length-1))%rows.length];next=to[Math.min(col,to.length-1)];}
  next.focus();return true;
}
// Esc closes the + panel and gives the focus back to +.
document.addEventListener('keydown',event=>{
  if(!inkColorPanel)return;
  if(event.key==='Escape'){event.preventDefault();event.stopPropagation();closeInkColorPanel(true);return;}
  if(inkColorPanel.contains(event.target))inkSwatchMove(event,inkColorPanel,'[data-ink-swatch],[data-ink-swatch-custom]');
},true);
function inkAddColor(kind,value){
  const color=String(value).toLowerCase(),list=inkState.custom[kind];if(!inkHex(color)||!list)return;
  if(!inkPalettes[kind].includes(color)&&!list.includes(color)){list.push(color);if(list.length>inkCustomMax){const gone=list.shift();if(inkState.color[kind]===gone)inkState.color[kind]=inkPalettes[kind][0];}}
  if(kind===inkColorKind())inkUseColor(color);else{inkState.color[kind]=color;inkRemember(kind,color);persistInkPrefs();inkSetTool(inkState.tool);}
}
function inkRemoveColor(color){
  const kind=inkColorKind(),list=inkState.custom[kind],at=list.indexOf(color);if(at<0)return;
  list.splice(at,1);inkRemember(kind,color);if(inkState.color[kind]===color)inkState.color[kind]=inkPalettes[kind][0];persistInkPrefs();inkSetTool(inkState.tool);
  document.querySelector('.ink-toolbar [data-ink-add-color]')?.focus();
}
// An added colour is removed with a right click, or Delete while focused
// (before a lasso selection would take that key).
document.addEventListener('contextmenu',event=>{const b=event.target.closest('.ink-toolbar [data-ink-custom]');if(!b)return;event.preventDefault();inkRemoveColor(b.dataset.inkColor);});
document.addEventListener('keydown',event=>{if(event.key!=='Delete'&&event.key!=='Backspace')return;const b=event.target.closest?.('.ink-toolbar [data-ink-custom]');if(!b)return;event.preventDefault();event.stopPropagation();inkRemoveColor(b.dataset.inkColor);},true);
// The slider adjusts the chosen preset in place; the bar stays open.
document.addEventListener('input',event=>{
  if(!event.target.matches('[data-ink-width]'))return;
  const kind=inkColorKind(),at=inkState.sizeIndex[kind],w=Number(event.target.value),group=event.target.closest('.ink-sizes');
  inkState.width[kind]=w;inkState.sizes[kind][at]=w;persistInkPrefs();
  if(group){group.querySelector('output').textContent=w;const button=group.querySelector(`[data-ink-size="${at}"]`);button.querySelector('.ink-dot').style.setProperty('--dot',inkSizeDot(kind,w)+'px');button.setAttribute('aria-label',`${inkSizeNames[at]} ${w}`);button.dataset.tip=tr('{size} · {value} (다시 누르면 조절)',{size:inkSizeNames[at],value:w});}
});
// Choosing a preset (while reading, moving or erasing, it picks up the pen;
// the shape tool keeps drawing with it); pressing the chosen one again
// opens or closes its slider.
const inkNotWriting=()=>['read','hand','eraser','laser'].includes(inkState.tool);
document.addEventListener('click',event=>{
  const size=event.target.closest('[data-ink-size]');if(!size)return;
  const kind=inkColorKind(),at=Number(size.dataset.inkSize);
  if(inkState.sizeIndex[kind]===at&&!inkNotWriting())inkState.sizeOpen=!inkState.sizeOpen;else{inkState.sizeIndex[kind]=at;inkState.width[kind]=inkState.sizes[kind][at];inkState.sizeOpen=false;}
  if(inkNotWriting())inkState.tool=kind;persistInkPrefs();inkSetTool(inkState.tool);inkSelectionForTool(inkState.tool);
});
document.addEventListener('pointerdown',event=>{if(inkState.sizeOpen&&!event.target.closest('.ink-sizes')){inkState.sizeOpen=false;document.querySelector('.ink-size-pop')?.remove();}},true);
document.addEventListener('keydown',event=>{
  if(state.screen!=='reader'||dialog.open||event.isComposing||event.target.closest?.('input,textarea,select,[contenteditable="true"]'))return;
  const key=event.key.toLowerCase();
  if((event.ctrlKey||event.metaKey)&&key==='z'){event.preventDefault();if(event.shiftKey)inkRedo();else inkUndo();}
  else if((event.ctrlKey||event.metaKey)&&key==='y'){event.preventDefault();inkRedo();}
  else if(key==='escape'&&inkState.sizeOpen){inkState.sizeOpen=false;document.querySelector('.ink-size-pop')?.remove();}
  else if(key==='escape'&&inkState.tool!=='read')inkSetTool('read');
});

// Everything marked on the source, in page order: file annotations, text
// highlights (with their quote), page memos and highlighter strokes (a
// count per page). Each line jumps to its page; "메모에 추가" appends them to
// the paper note as "(p. 3) "quote" — note", never replacing what is there.
// What a collected kind (kept in Korean: it is compared and written into the memo) is called on this screen.
const inkKindLabel=kind=>({'주석':tr('주석',null,'annotation body'),'밑줄':tr('밑줄'),'강조':tr('강조',null,'mark'),'텍스트 상자':tr('텍스트 상자'),'형광펜':tr('형광펜',null,'ink tool')})[kind]??kind; // i18n:keep — the kind values
async function inkCollectAnnotations(){
  const id=state.storageKey,paperId=state.selected,attachment=activeAttachment(selected()),key=targetKey();
  const view=await window.appApi.inkLoad(id,paperId,attachment?.id,'original').catch(()=>({strokes:[]}));if(key!==targetKey())return;
  const items=[];
  for(const a of itemAnnotations.filter(a=>a.paperId===paperId&&a.attachmentId===attachment?.id))items.push({page:a.page,text:`${a.quote?`"${a.quote}"`:''}${a.quote&&a.body?' — ':''}${a.body||''}`,kind:'주석'}); // i18n:keep — kind value, shown through inkKindLabel
  const marks=new Map();
  for(const s of view.stale?[]:view.strokes){
    if(s.tool==='mark')items.push({page:s.page+1,text:`"${s.quote||''}"`,kind:s.style==='underline'?'밑줄':'강조'}); // i18n:keep — kind values, shown through inkKindLabel
    else if(s.tool==='text')items.push({page:s.page+1,text:s.text,kind:'텍스트 상자'}); // i18n:keep — kind value, compared below and shown through inkKindLabel
    else if(s.tool==='highlighter')marks.set(s.page+1,(marks.get(s.page+1)||0)+1);
  }
  for(const [page,count] of marks)items.push({page,count,text:tr('형광펜 표시 {n}곳',{n:count}),kind:'형광펜'}); // i18n:keep — the kind value; the memo gets memo-labels highlights
  items.sort((a,b)=>a.page-b.page);inkCollected={key,items};
  modal(tr('주석 모아 보기'),items.length?`<ol class="annotation-collection">${items.map(item=>`<li><button type="button" class="secondary small" data-annotation-page="${item.page}">${tr('{n}쪽',{n:item.page})}</button> <span class="pill">${inkKindLabel(item.kind)}</span> ${esc(item.text)}</li>`).join('')}</ol>`:`<p>${tr('이 원문에 남긴 주석·강조·페이지 메모가 없습니다.')}</p>`,btn(tr('닫기'),'close')+(items.length?btn(tr('메모에 추가'),'collect-annotations-note','primary'):''));
}
let inkCollected=null;
function inkCollectedToNote(){
  if(!inkCollected||inkCollected.key!==targetKey())return;
  const noteKey=`${state.selected}-메모`,language=memoLanguage(),lines=inkCollected.items.map(item=>`(p. ${item.page}) ${item.kind==='텍스트 상자'?memoLabels().memoLabel('textBox',language):''}${item.kind==='형광펜'?memoLabels().memoLabel('highlights',language,{n:item.count}):item.text}`); // i18n:keep — stored memo key; the kind values
  const before=notes[noteKey]||'',added=`${before.trim()?'\n\n':''}${memoLabels().memoLabel('annotationDigest',language,{date:memoLabels().memoDate(Date.now(),language)})}\n${lines.join('\n')}`;
  notes[noteKey]=before+added;const area=document.querySelector(`#note[data-note="${noteKey}"]`);if(area)area.value=notes[noteKey];
  dialog.close();desktopNotes().then(()=>toast(tr('주석 {n}개를 메모에 추가했습니다.',{n:lines.length}))).catch(error=>toast(shownError(error)));
}
Object.assign(actions,{'collect-annotations':runDesktop(inkCollectAnnotations),'collect-annotations-note':inkCollectedToNote});

// Source memos: a new annotation starts from the visible page and the current
// text selection, and its page button moves the PDF.js viewer there.
let inkQuote='';
document.addEventListener('pointerdown',event=>{if(event.target.closest('[data-action="new-annotation"]'))inkQuote=String(window.getSelection()||'').trim().slice(0,10000);},true);
function inkVisiblePage(){const container=document.querySelector('.original-pages');return container?.pdfViewer?.currentPageNumber||1;}
const inkNewAnnotation=actions['new-annotation'];
actions['new-annotation']=async()=>{annotationAnchor=null;const quote=inkQuote,page=inkVisiblePage();inkQuote='';await inkNewAnnotation();const pageInput=document.querySelector('#annotation-page'),quoteInput=document.querySelector('#annotation-quote');if(pageInput)pageInput.value=Math.min(Number(pageInput.max)||page,page);if(quoteInput&&quote)quoteInput.value=quote;};
document.addEventListener('click',event=>{const button=event.target.closest('[data-annotation-page]');if(!button)return;const container=document.querySelector('.original-pages'),page=Number(button.dataset.annotationPage);if(button.closest('#dialog'))dialog.close();if(container?.pdfViewer&&page>=1&&page<=container.pdfViewer.pagesCount){if(typeof jumpFrom==='function')jumpFrom();container.pdfViewer.currentPageNumber=page;}});

// ---- Everyday writing: page memos, text highlights, shapes, lasso, partial eraser ----
inkState.shape='rect';inkState.eraser='stroke';inkState.pointer='read';inkState.textTool='text';inkState.flyout=null;inkState.selection=null;
const inkShapes=['rect','ellipse','triangle','line','arrow'];
try{const saved=JSON.parse(localStorage.getItem('app-ink-extra')||'null');if(inkShapes.includes(saved?.shape))inkState.shape=saved.shape;if(['stroke','partial'].includes(saved?.eraser))inkState.eraser=saved.eraser;}catch{}
function persistInkExtra(){try{localStorage.setItem('app-ink-extra',JSON.stringify({shape:inkState.shape,eraser:inkState.eraser}));}catch{}}
const inkPaintBase=inkPaint;
inkPaint=function(ctx,stroke,viewport,k){
  if(stroke.tool==='mark'&&stroke.style==='underline'){ctx.save();ctx.fillStyle=stroke.color;for(const r of stroke.rects){const t=Math.max(.6,Math.min(2,(r[3]-r[1])*.07)),a=viewport.convertToViewportPoint(r[0],r[1]),b=viewport.convertToViewportPoint(r[2],r[1]+t);ctx.fillRect(Math.min(a[0],b[0])*k,Math.min(a[1],b[1])*k,Math.max(1,Math.abs(b[0]-a[0])*k),Math.max(1,Math.abs(b[1]-a[1])*k));}ctx.restore();return;}
  // A highlight: one box per line, filled as one shape, so the colour is laid once where boxes meet (core/ink-marks.cjs).
  if(stroke.tool==='mark'){ctx.save();ctx.globalAlpha=.35;ctx.globalCompositeOperation='multiply';ctx.fillStyle=stroke.color;const shape=new Path2D();for(const r of globalThis.appInkMarks.highlightBoxes(stroke.rects)){const a=viewport.convertToViewportPoint(r[0],r[1]),b=viewport.convertToViewportPoint(r[2],r[3]);shape.rect(Math.min(a[0],b[0])*k,Math.min(a[1],b[1])*k,Math.abs(b[0]-a[0])*k,Math.abs(b[1]-a[1])*k);}ctx.fill(shape);ctx.restore();return;}
  if(stroke.tool==='text'){
    if(stroke.id===inkState.editingText)return; // the box being edited shows as its editor instead
    const [x,y]=viewport.convertToViewportPoint(stroke.points[0],stroke.points[1]),size=stroke.width*inkScale(viewport)*k,lines=stroke.text.split('\n');ctx.save();ctx.font=inkTextFont(stroke,size);ctx.textBaseline='top';
    const widths=lines.map(l=>ctx.measureText(l).width),w=inkTextWidth(stroke)*inkScale(viewport)*k;
    // The box's fill and border (none unless chosen) around the text, its padding and the border outside it (core/ink-marks.cjs).
    const {fill,border}=globalThis.appInkMarks.textLook(stroke);
    if(fill||border){const f=globalThis.appInkMarks.textBoxFrame({width:stroke.width,border}),u=inkScale(viewport)*k,out=f.out*u,b=f.border*u,bx=x*k-out,by=y*k-out,bw=w+2*out,bh=lines.length*size*1.3+2*out;
      if(fill){ctx.fillStyle=fill;ctx.fillRect(bx,by,bw,bh);}
      if(border){ctx.strokeStyle=border.color;ctx.lineWidth=b;ctx.lineJoin='miter';ctx.lineCap=border.style==='dotted'?'round':'butt';ctx.setLineDash(globalThis.appInkMarks.textBorderDash(border.style,b));ctx.strokeRect(bx+b/2,by+b/2,bw-b,bh-b);ctx.setLineDash([]);}}
    ctx.fillStyle=stroke.color;
    lines.forEach((line,i)=>{const lx=x*k+(stroke.align==='center'?(w-widths[i])/2:stroke.align==='right'?w-widths[i]:0),ly=y*k+i*size*1.3;ctx.fillText(line,lx,ly);if(stroke.underline&&widths[i])ctx.fillRect(lx,ly+size*1.12,widths[i],Math.max(1,size*.06));});
    ctx.restore();return;}
  inkPaintBase(ctx,stroke,viewport,k);
};
globalThis.appInk.paint=inkPaint;
// A text box's text width in page units, one rule for drawing it, pressing it and printing it (ink.cjs overlaySvg): the
// width kept with the box (measured when it was finished, scaled with it), else its longest line measured now.
const inkMeasure=document.createElement('canvas').getContext('2d');
function inkTextWidth(stroke){if(stroke.w)return stroke.w;inkMeasure.font=inkTextFont(stroke,stroke.width);return Math.max(...stroke.text.split('\n').map(l=>inkMeasure.measureText(l).width));}
// Viewport box of a stroke, for hit tests and the lasso.
function inkBox(stroke,viewport){
  const pts=stroke.tool==='mark'?stroke.rects.flatMap(r=>[[r[0],r[1]],[r[2],r[3]]]):stroke.tool==='text'?[[stroke.points[0],stroke.points[1]]]:Array.from({length:stroke.points.length/4},(_,i)=>[stroke.points[i*4],stroke.points[i*4+1]]);
  const v=pts.map(p=>viewport.convertToViewportPoint(p[0],p[1])),xs=v.map(p=>p[0]),ys=v.map(p=>p[1]);
  // A text box: its text, the padding around it and its border (as inkPaint draws it).
  if(stroke.tool==='text'){const u=inkScale(viewport),size=stroke.width*u,lines=stroke.text.split('\n').length,out=globalThis.appInkMarks.textBoxFrame({width:stroke.width,border:globalThis.appInkMarks.textLook(stroke).border}).out*u;return {x0:xs[0]-out,y0:ys[0]-out,x1:xs[0]+inkTextWidth(stroke)*u+out,y1:ys[0]+lines*size*1.3+out};}
  return {x0:Math.min(...xs),y0:Math.min(...ys),x1:Math.max(...xs),y1:Math.max(...ys)};
}
// Several operations as one saved batch and one undo step.
function inkQueueMany(doc,ops){doc.touched=true;doc.pending.push(...ops);inkState.pending.add(doc);inkFlush(doc).catch(()=>{});}
const inkGeometry=view=>({view:[...view.pdfPage.view],rotate:view.pdfPage.rotate,userUnit:view.pdfPage.userUnit||1});
// views: page index → page view, when added strokes sit on several pages;
// each stroke carries its own page's geometry.
function inkReplace(doc,view,removed,added,views){
  for(const s of removed)doc.strokes.delete(s.id);for(const s of added)doc.strokes.set(s.id,s);
  inkQueueMany(doc,[...added.map(stroke=>({type:'add',stroke,geometry:inkGeometry(views?.get(stroke.page)||view)})),...(removed.length?[{type:'delete',ids:removed.map(s=>s.id)}]:[])]);
  inkRecord({doc,type:'replace',removed,added});inkRedraw(doc,new Set([...removed,...added].map(s=>s.page)));
}
const inkReverseBase=inkReverse;
inkReverse=function(action,undo){
  if(action.type!=='replace')return inkReverseBase(action,undo);
  const {doc}=action,show=undo?action.removed:action.added,hide=undo?action.added:action.removed;
  for(const s of hide)doc.strokes.delete(s.id);for(const s of show)doc.strokes.set(s.id,s);
  inkQueueMany(doc,[...(hide.length?[{type:'delete',ids:hide.map(s=>s.id)}]:[]),...(show.length?[{type:'restore',ids:show.map(s=>s.id)}]:[])]);
  inkState.selection=null;document.querySelectorAll('.ink-selection').forEach(n=>n.remove());inkRedraw(doc,new Set([...hide,...show].map(s=>s.page)));
};
const inkPointerDownBase=inkPointerDown;
inkPointerDown=function(container,view,canvas,event){
  const tool=inkState.tool;
  if(tool==='memo'){
    if(event.button!==0||inkFingerPans(event))return inkPointerDownBase(container,view,canvas,event);event.preventDefault();
    if(!container.classList.contains('original-pages')){toast(tr('메모 핀은 원문이나 노트북 페이지에 꽂습니다.'));return;}
    const attachment=selected()&&activeAttachment(selected()),r=view.div.getBoundingClientRect();if(!attachment)return;
    inkPlaceMemoPin({attachmentId:attachment.id,page:view.id,x:Math.max(0,Math.min(1,(event.clientX-r.left)/r.width)),y:Math.max(0,Math.min(1,(event.clientY-r.top)/r.height))});
    globalThis.appInk.setTool?.('read');return;
  }
  if(tool==='laser'){if(event.button===0&&!(inkFingerPans(event)))inkLaser(view,canvas,event);else if(event.pointerType==='touch')inkPan(container,canvas,event);return;}
  if(!['text','shape','lasso','hand'].includes(tool)||!container.inkDoc||event.buttons&32||inkFingerPans(event))return inkPointerDownBase(container,view,canvas,event);
  inkEndStale(event);
  if(event.button!==0||inkStroke)return;const doc=container.inkDoc;if(doc.stale){toast(tr('원문 파일이 바뀌어 이 필기는 수정할 수 없습니다.'));return;}
  event.preventDefault();
  const rect=view.div.getBoundingClientRect(),at=e=>[(e.clientX-rect.left)*view.viewport.width/rect.width,(e.clientY-rect.top)*view.viewport.height/rect.height],start=at(event);
  if(tool==='text'){
    const hit=[...doc.strokes.values()].find(s=>s.page===view.id-1&&s.tool==='text'&&(b=>start[0]>=b.x0&&start[0]<=b.x1&&start[1]>=b.y0&&start[1]<=b.y1)(inkBox(s,view.viewport)));
    inkTextOpen(container,view,hit,view.viewport.convertToPdfPoint(start[0],start[1]));return;
  }
  const sel=inkState.selection,hand=tool==='hand',onPage=sel?.doc===doc&&sel.page===view.id-1;
  // The hand moves the selection from anywhere on its page; with nothing
  // selected there it moves the page instead.
  if(hand&&!onPage){inkPan(container,canvas,event);return;}
  const moving=onPage&&(hand||tool==='lasso'&&inkInSelection(doc,view,start));
  if(!moving&&tool==='lasso')inkState.selection=null;
  inkGesture(container,view,canvas,event,tool,moving?'move':tool);
};
// A gesture of the lasso, the hand, a shape or the select tool, followed on `canvas` (it takes the pointer) until the
// pointer lifts; positions are in the page view's space.
function inkGesture(container,view,canvas,event,tool,mode){
  // The page's place is read at every event: the pane may scroll (wheel) during the gesture.
  const at=e=>{const rect=view.div.getBoundingClientRect();return [(e.clientX-rect.left)*view.viewport.width/rect.width,(e.clientY-rect.top)*view.viewport.height/rect.height];},start=at(event);
  canvas.setPointerCapture(event.pointerId);
  document.body.classList.toggle('ink-grabbing',mode==='move');
  inkStroke={container,view,canvas,doc:container.inkDoc,tool,mode,pointerId:event.pointerId,device:event.pointerType,lastAt:event.timeStamp,startView:start,path:[start],client:[event.clientX,event.clientY],points:[],erased:new Map(),slop:tool==='read'?4:1};
  inkStroke.shift=event.shiftKey;
  const move=e=>{if(e.pointerId!==inkStroke?.pointerId)return;if(!e.buttons){detach();inkGestureEnd();return;}inkStroke.lastAt=e.timeStamp;inkStroke.shift=e.shiftKey;inkStroke.path.push(at(e));inkStroke.client=[e.clientX,e.clientY];(inkStroke.mode==='move'?inkMoveLive(inkStroke):inkLiveOf(inkStroke)).request();};
  const detach=()=>{for(const type of ['pointerup','pointercancel','lostpointercapture'])canvas.removeEventListener(type,up);canvas.removeEventListener('pointermove',move);};
  const up=e=>{if(e.pointerId!==inkStroke?.pointerId)return;detach();if(e.type==='pointerup'){inkStroke.shift=e.shiftKey;inkStroke.path.push(at(e));inkStroke.client=[e.clientX,e.clientY];}inkGestureEnd();};
  inkStroke.detach=detach;
  canvas.addEventListener('pointermove',move);for(const type of ['pointerup','pointercancel','lostpointercapture'])canvas.addEventListener(type,up);
}
// ---- Moving ink to where it is let go ----
// Where ink dragged on a PDF page lands: on the page under the pointer (the nearest drawn page of the pane when it is
// over none), taken there through the screen, its box kept inside that page (its top-left kept when it is larger), so
// what is moved never ends up off a page, where nothing shows it. box: the ink's box in the view space of its page;
// d: the drag there; client: the pointer. Returns the page's view, the box there, and map(), which takes a point of
// the first page's view space (not yet dragged) to the landing page's view space.
function inkDrop(container,view,box,[dx,dy],[cx,cy]){
  let target=view,best=Infinity;
  for(const v of inkPageViews(container)){const r=v.div.getBoundingClientRect(),d=Math.hypot(Math.max(r.left-cx,0,cx-r.right),Math.max(r.top-cy,0,cy-r.bottom));if(d<best){best=d;target=v;if(!d)break;}}
  const a=view.div.getBoundingClientRect(),b=target.div.getBoundingClientRect(),svp=view.viewport,tvp=target.viewport;
  const to=([x,y])=>[(a.left+(x+dx)*a.width/svp.width-b.left)*tvp.width/b.width,(a.top+(y+dy)*a.height/svp.height-b.top)*tvp.height/b.height];
  const [x0,y0]=to([box.x0,box.y0]),[x1,y1]=to([box.x1,box.y1]),w=x1-x0,h=y1-y0;
  const nx=w>=tvp.width?0:Math.min(Math.max(x0,0),tvp.width-w),ny=h>=tvp.height?0:Math.min(Math.max(y0,0),tvp.height-h);
  return {view:target,box:{x0:nx,y0:ny,x1:nx+w,y1:ny+h},map:v=>{const [x,y]=to(v);return [x+nx-x0,y+ny-y0];}};
}
// Strokes being moved are not drawn where they were (their copies are drawn where they will land).
function inkHide(doc,ids,view){if(inkState.hidden)return;inkState.hidden={doc,ids:new Set(ids),page:view.id-1};inkRedraw(doc,new Set([view.id-1]));}
function inkUnhide(){const hidden=inkState.hidden;if(!hidden)return;inkState.hidden=null;inkRedraw(hidden.doc,new Set([hidden.page]));}
// A selection being moved is drawn where it will land (inkDrop): its strokes and the dashed box, on that page's own
// gesture canvas, which moves to another page as the pointer does.
// A selection let go of mid-drag (Esc, undo) ends the move where it was. A press of the select tool moves nothing
// until the pointer has gone a few pixels (a tap selects).
const inkNoLive={request(){}};
function inkMoveLive(s){
  const sel=inkState.selection,last=s.path.at(-1),d=[last[0]-s.startView[0],last[1]-s.startView[1]];
  if(!sel){s.live?.end();s.live=null;inkUnhide();return inkNoLive;}
  if(!s.moved&&Math.hypot(d[0],d[1])<s.slop)return inkNoLive;
  s.moved=true;if(!inkState.hidden){inkHide(s.doc,sel.ids,s.view);document.querySelectorAll('.ink-selection').forEach(n=>n.hidden=true);}
  const plan=s.plan=inkDrop(s.container,s.view,sel.box,d,s.client);
  if(s.live?.view!==plan.view){s.live?.end();const v=plan.view;s.live=inkLivePreview(v.div,()=>v.viewport,(ctx,k)=>inkMovePaint(s,ctx,k));s.live.view=v;}
  return s.live;
}
function inkMovePaint(s,ctx,k){
  if(!inkState.selection)return;
  const plan=s.plan,strokes=inkState.selection.ids.map(id=>s.doc.strokes.get(id)).filter(Boolean);
  for(const st of inkMapped(strokes,s.view,plan.map,1,plan.view).sort((a,b)=>(a.tool==='highlighter'?0:1)-(b.tool==='highlighter'?0:1)))inkPaint(ctx,st,plan.view.viewport,k);
  const b=plan.box;ctx.setTransform(k,0,0,k,0,0);ctx.lineWidth=1.5;ctx.strokeStyle='#2563eb';ctx.setLineDash([5,4]);ctx.strokeRect(b.x0,b.y0,b.x1-b.x0,b.y1-b.y0);
}
// Whether a point (page view space) lies in the lasso selection on this page,
// where a lasso drag moves the selection instead of drawing a new loop.
function inkInSelection(doc,view,[x,y]){const sel=inkState.selection,b=sel?.box;return sel?.doc===doc&&sel.page===view.id-1&&x>=b.x0&&x<=b.x1&&y>=b.y0&&y<=b.y1;}
// Over the lasso selection the pointer becomes an open hand (a closed one
// while dragging), so the user can see the selection will move.
function inkHover(container,view,canvas,event){
  if(inkStroke)return;const over=inkState.tool==='lasso'&&!!inkState.selection&&!!container.inkDoc;
  if(!over){canvas.classList.remove('ink-over-selection');return;}
  const rect=view.div.getBoundingClientRect(),point=[(event.clientX-rect.left)*view.viewport.width/rect.width,(event.clientY-rect.top)*view.viewport.height/rect.height];
  canvas.classList.toggle('ink-over-selection',inkInSelection(container.inkDoc,view,point));
}
// Corner points of a shape dragged from a to b (any 2D space): the triangle's
// apex sits mid-way along the starting edge; the arrow's head is at b.
// Laser pointer: a glowing trail for showing a page to others. It is never
// stored and fades a moment after the pointer lifts.
function inkLaser(view,canvas,event){
  event.preventDefault();canvas.setPointerCapture(event.pointerId);
  const live=document.createElement('canvas');live.className='app-ink-laser';live.setAttribute('aria-hidden','true');view.div.append(live);
  const rect=view.div.getBoundingClientRect(),at=e=>[(e.clientX-rect.left)*view.viewport.width/rect.width,(e.clientY-rect.top)*view.viewport.height/rect.height],path=[at(event)];
  let frame=null;
  const draw=()=>{frame=null;const k=inkBacking(live,view),ctx=live.getContext('2d');ctx.setTransform(k,0,0,k,0,0);ctx.clearRect(0,0,live.width/k,live.height/k);ctx.lineCap=ctx.lineJoin='round';
    for(const [w,c] of [[10,'rgba(239,68,68,.22)'],[4,'#ef4444'],[1.4,'#fff1f1']]){ctx.lineWidth=w;ctx.strokeStyle=c;ctx.beginPath();path.forEach((p,i)=>i?ctx.lineTo(p[0],p[1]):ctx.moveTo(p[0],p[1]));if(path.length===1)ctx.lineTo(path[0][0]+.1,path[0][1]);ctx.stroke();}};
  draw();
  const move=e=>{if(e.pointerId!==event.pointerId)return;for(const c of e.getCoalescedEvents?.().length?e.getCoalescedEvents():[e])path.push(at(c));if(!frame)frame=requestAnimationFrame(draw);};
  const up=e=>{if(e.pointerId!==event.pointerId)return;canvas.removeEventListener('pointermove',move);for(const t of ['pointerup','pointercancel','lostpointercapture'])canvas.removeEventListener(t,up);live.classList.add('fading');setTimeout(()=>live.remove(),900);};
  canvas.addEventListener('pointermove',move);for(const t of ['pointerup','pointercancel','lostpointercapture'])canvas.addEventListener(t,up);
}
function shapePoints(kind,a,b){
  if(kind==='line')return [a,b];
  if(kind==='rect')return [a,[b[0],a[1]],b,[a[0],b[1]],a];
  if(kind==='triangle'){const apex=[(a[0]+b[0])/2,a[1]];return [apex,b,[a[0],b[1]],apex];}
  if(kind==='arrow'){const dx=b[0]-a[0],dy=b[1]-a[1],len=Math.hypot(dx,dy)||1,head=Math.min(len*.4,Math.max(len*.15,10)),angle=Math.atan2(dy,dx),wing=t=>[b[0]-head*Math.cos(angle+t),b[1]-head*Math.sin(angle+t)];return [a,b,wing(.45),b,wing(-.45)];}
  const cx=(a[0]+b[0])/2,cy=(a[1]+b[1])/2,rx=Math.abs(b[0]-a[0])/2,ry=Math.abs(b[1]-a[1])/2;
  return Array.from({length:49},(_,i)=>[cx+rx*Math.cos(i/48*Math.PI*2),cy+ry*Math.sin(i/48*Math.PI*2)]);
}
// With Shift held: a rectangle becomes a square, an ellipse a circle, a
// triangle equilateral, and a line or arrow keeps to 45-degree steps. Only
// the far corner moves; the drag direction is kept.
function inkConstrain(kind,a,b){
  const dx=b[0]-a[0],dy=b[1]-a[1],sx=Math.sign(dx)||1,sy=Math.sign(dy)||1;
  if(kind==='rect'||kind==='ellipse'){const side=Math.max(Math.abs(dx),Math.abs(dy));return [a[0]+sx*side,a[1]+sy*side];}
  if(kind==='triangle'){const width=Math.max(Math.abs(dx),Math.abs(dy)*2/Math.sqrt(3));return [a[0]+sx*width,a[1]+sy*width*Math.sqrt(3)/2];}
  const angle=Math.round(Math.atan2(dy,dx)/(Math.PI/4))*Math.PI/4,len=Math.hypot(dx,dy);return [a[0]+len*Math.cos(angle),a[1]+len*Math.sin(angle)];
}
// A pen or highlighter stroke with Shift held draws like a ruler: from where
// it began to where the pointer is, at the starting pressure. Once Shift was
// seen the stroke stays straight.
function inkRuler(points,x,y,t){
  if(points.length<4){points.push(x,y,.5,t);return;}
  points.length=4;points.push(x,y,points[2],t);
}
// Shape, lasso and move previews draw on the live canvas only.
function inkOverlayPaint(s,ctx,k){
  ctx.setTransform(k,0,0,k,0,0);
  const last=s.path.at(-1);ctx.lineWidth=1.5;ctx.strokeStyle='#2563eb';ctx.setLineDash([5,4]);
  if(s.mode==='shape'){ctx.setLineDash([]);ctx.strokeStyle=inkState.color.pen;ctx.lineWidth=inkState.width.pen*inkScale(s.view.viewport);ctx.beginPath();shapePoints(inkState.shape,s.startView,s.shift?inkConstrain(inkState.shape,s.startView,last):last).forEach((p,i)=>i?ctx.lineTo(p[0],p[1]):ctx.moveTo(p[0],p[1]));ctx.stroke();}
  else if(s.mode==='lasso'){ctx.beginPath();s.path.forEach((p,i)=>i?ctx.lineTo(p[0],p[1]):ctx.moveTo(p[0],p[1]));ctx.closePath();ctx.stroke();}
  else if(s.mode==='scale'&&inkState.selection){const b=inkState.selection.box,k=inkScaleFactor(b,s.startView,last);ctx.strokeRect(b.x0,b.y0,(b.x1-b.x0)*k,(b.y1-b.y0)*k);}
}
function inside(poly,[x,y]){let c=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){const [xi,yi]=poly[i],[xj,yj]=poly[j];if(yi>y!==yj>y&&x<(xj-xi)*(y-yi)/(yj-yi)+xi)c=!c;}return c;}
function inkGestureEnd(){
  const s=inkStroke;inkStroke=null;if(!s)return;document.body.classList.remove('ink-grabbing');s.live?.end();inkUnhide();
  const vp=s.view.viewport,last=s.path.at(-1),index=s.view.id-1;
  if(s.mode==='shape'){
    if(Math.hypot(last[0]-s.startView[0],last[1]-s.startView[1])<3)return;
    const points=shapePoints(inkState.shape,s.startView,s.shift?inkConstrain(inkState.shape,s.startView,last):last).flatMap(p=>{const [x,y]=vp.convertToPdfPoint(p[0],p[1]);return [Math.round(x*100)/100,Math.round(y*100)/100,.5,0];});
    inkReplace(s.doc,s.view,[],[{id:inkId(),page:index,tool:'pen',color:inkState.color.pen,width:inkState.width.pen,points,shape:inkState.shape,createdAt:new Date().toISOString()}]);return;
  }
  if(s.mode==='lasso'){
    if(s.path.length<3)return;
    const ids=[...s.doc.strokes.values()].filter(st=>st.page===index&&(b=>inside(s.path,[(b.x0+b.x1)/2,(b.y0+b.y1)/2]))(inkBox(st,vp))).map(st=>st.id);
    if(!ids.length){inkSelectionDraw(s.container);return;}
    const boxes=ids.map(id=>inkBox(s.doc.strokes.get(id),vp));
    inkSelectOnly('ink');inkState.selection={doc:s.doc,container:s.container,page:index,ids,box:{x0:Math.min(...boxes.map(b=>b.x0))-4,y0:Math.min(...boxes.map(b=>b.y0))-4,x1:Math.max(...boxes.map(b=>b.x1))+4,y1:Math.max(...boxes.map(b=>b.y1))+4}};
    inkSelectionDraw(s.container);toast(tr('{n}개를 선택했습니다. 끌어서 옮기고, 모서리로 크기를 바꾸고, 위의 막대로 복제·삭제합니다(Ctrl+D·Delete).',{n:ids.length}));return;
  }
  if((s.mode==='move'||s.mode==='scale')&&!inkState.selection){inkSelectionDraw(s.container);return;}
  if(s.mode==='move'){
    const sel=inkState.selection,dx=last[0]-s.startView[0],dy=last[1]-s.startView[1];if(!s.moved&&Math.hypot(dx,dy)<s.slop||Math.hypot(dx,dy)<1){inkSelectionDraw(s.container);return;}
    const plan=inkDrop(s.container,s.view,sel.box,[dx,dy],s.client);inkTransformSelection(s,plan.map,1,plan.box,plan.view);
  }
  if(s.mode==='scale'){
    const sel=inkState.selection,k=inkScaleFactor(sel.box,s.startView,last);if(Math.abs(k-1)<.01)return;
    inkTransformSelection(s,v=>[sel.box.x0+(v[0]-sel.box.x0)*k,sel.box.y0+(v[1]-sel.box.y0)*k],k,{x0:sel.box.x0,y0:sel.box.y0,x1:sel.box.x0+(sel.box.x1-sel.box.x0)*k,y1:sel.box.y0+(sel.box.y1-sel.box.y0)*k});
  }
}
// The selected strokes, mapped point by point in screen space and converted
// back on the page they land on (so page rotation is kept), replace the
// originals as one undo step; `k` scales line widths and memo text with the shape.
function inkScaleStart(container,view,event){
  const sel=inkState.selection;if(event.button!==0||!sel||sel.container!==container||inkStroke)return;event.preventDefault();event.stopPropagation();
  const handle=event.currentTarget,rect=view.div.getBoundingClientRect(),at=e=>[(e.clientX-rect.left)*view.viewport.width/rect.width,(e.clientY-rect.top)*view.viewport.height/rect.height],start=at(event);
  handle.setPointerCapture(event.pointerId);
  inkStroke={container,view,canvas:inkLayer(container,view),doc:sel.doc,tool:inkState.tool,mode:'scale',pointerId:event.pointerId,startView:start,path:[start],points:[],erased:new Map()};
  const move=e=>{if(e.pointerId!==inkStroke?.pointerId)return;inkStroke.path.push(at(e));inkLiveOf(inkStroke).request();};
  const up=e=>{if(e.pointerId!==inkStroke?.pointerId)return;for(const type of ['pointerup','pointercancel','lostpointercapture'])handle.removeEventListener(type,up);handle.removeEventListener('pointermove',move);if(e.type==='pointerup')inkStroke.path.push(at(e));inkGestureEnd();};
  handle.addEventListener('pointermove',move);for(const type of ['pointerup','pointercancel','lostpointercapture'])handle.addEventListener(type,up);
}
function inkTransformSelection(s,mapView,k,box,target=s.view){
  const sel=inkState.selection,removed=sel.ids.map(id=>s.doc.strokes.get(id)).filter(Boolean);
  const added=inkMapped(removed,s.view,mapView,k,target).map(copy=>({...copy,id:inkId(),from:copy.id,createdAt:new Date().toISOString()}));
  inkReplace(s.doc,s.view,removed,added,new Map([[s.view.id-1,s.view],[target.id-1,target]]));
  inkState.selection={...sel,page:target.id-1,ids:added.map(a=>a.id),box};inkSelectionDraw(s.container);
}
// Strokes of a page (view), mapped point by point in its screen space (mapView) and converted back on the page they
// land on (target; rotation kept), as copies with the old ids, to be given new ones.
function inkMapped(strokes,view,mapView,k,target=view){
  const vp=view.viewport,tvp=target.viewport,map=(x,y)=>tvp.convertToPdfPoint(...mapView(vp.convertToViewportPoint(x,y))).map(n=>Math.round(n*100)/100);
  return strokes.map(st=>{const copy={...st,page:target.id-1};
    if(k!==1)copy.width=Math.min(100,Math.max(.1,Math.round(st.width*k*100)/100));
    // A text box keeps a size the store accepts (6–72 pt); its width follows the scale.
    // Its text width and border follow the size it really gets (the rounded, kept-in-range one), so the box drawn, the
    // box pressed and the box printed stay one box around the text.
    if(k!==1&&st.tool==='text'){copy.width=Math.min(72,Math.max(6,Math.round(st.width*k)));const r=copy.width/st.width;if(st.w)copy.w=Math.round(st.w*r*10)/10;if(st.border)copy.border={...st.border,width:Math.min(6,Math.max(.5,Math.round(st.border.width*r*10)/10))};}
    if(st.tool==='mark')copy.rects=st.rects.map(r=>{const a=map(r[0],r[1]),b=map(r[2],r[3]);return [Math.min(a[0],b[0]),Math.min(a[1],b[1]),Math.max(a[0],b[0]),Math.max(a[1],b[1])];});
    else{copy.points=[...st.points];for(let i=0;i<copy.points.length;i+=4){const [x,y]=map(st.points[i],st.points[i+1]);copy.points[i]=x;copy.points[i+1]=y;}}
    return copy;});
}
// Dragging the corner handle scales the selection from its top-left corner,
// keeping its proportions (the drag projected on the box's diagonal).
function inkScaleFactor(box,start,last){
  const w=box.x1-box.x0,h=box.y1-box.y0,d=Math.hypot(w,h)||1,along=((last[0]-start[0])*w+(last[1]-start[1])*h)/d;
  return Math.max(.1,Math.min(10,(d+along)/d));
}
function inkSelectionDraw(container){
  // There is one selection: a box left in another pane (a selection made there before) would act on this one.
  document.querySelectorAll('.ink-selection').forEach(n=>n.remove());const sel=inkState.selection;if(!sel||sel.container!==container)return;
  const view=container.pdfViewer?.getPageView(sel.page);if(!view)return;const box=document.createElement('div');box.className='ink-selection';
  const f=view.div.clientWidth/view.viewport.width;Object.assign(box.style,{left:sel.box.x0*f+'px',top:sel.box.y0*f+'px',width:(sel.box.x1-sel.box.x0)*f+'px',height:(sel.box.y1-sel.box.y0)*f+'px'});
  const handle=document.createElement('span');handle.className='ink-handle';handle.title=tr('크기 조절');handle.addEventListener('pointerdown',event=>inkScaleStart(container,view,event));box.append(handle);
  // A small bar above the selection: duplicate or delete it (the palette recolours it).
  const bar=document.createElement('div');bar.className='ink-selection-actions';bar.setAttribute('role','toolbar');bar.setAttribute('aria-label',tr('선택한 필기'));
  bar.innerHTML=`<button type="button" data-ink-selection="duplicate">${tr('복제')}</button><button type="button" data-ink-selection="delete">${tr('삭제')}</button>`;
  box.append(bar);view.div.append(box);
}
function inkDeleteSelection(){
  const sel=inkState.selection;if(!sel)return;const view=sel.container.pdfViewer?.getPageView(sel.page);
  inkReplace(sel.doc,view,sel.ids.map(id=>sel.doc.strokes.get(id)).filter(Boolean),[]);inkState.selection=null;document.querySelectorAll('.ink-selection').forEach(n=>n.remove());
}
// A copy a little below and right of the selection, which becomes the selection.
function inkDuplicateSelection(){
  const sel=inkState.selection,view=sel?.container.pdfViewer?.getPageView(sel.page);if(!view)return;
  const vp=view.viewport,off=14,map=(x,y)=>{const v=vp.convertToViewportPoint(x,y);return vp.convertToPdfPoint(v[0]+off,v[1]+off).map(n=>Math.round(n*100)/100);};
  const added=sel.ids.map(id=>sel.doc.strokes.get(id)).filter(Boolean).map(st=>{
    const {from,...copy}=st;copy.id=inkId();copy.createdAt=new Date().toISOString();
    if(st.tool==='mark')copy.rects=st.rects.map(r=>{const a=map(r[0],r[1]),b=map(r[2],r[3]);return [Math.min(a[0],b[0]),Math.min(a[1],b[1]),Math.max(a[0],b[0]),Math.max(a[1],b[1])];});
    else{copy.points=[...st.points];for(let i=0;i<copy.points.length;i+=4){const [x,y]=map(st.points[i],st.points[i+1]);copy.points[i]=x;copy.points[i+1]=y;}}
    return copy;});
  if(!added.length)return;inkReplace(sel.doc,view,[],added);
  inkState.selection={...sel,ids:added.map(a=>a.id),box:{x0:sel.box.x0+off,y0:sel.box.y0+off,x1:sel.box.x1+off,y1:sel.box.y1+off}};inkSelectionDraw(sel.container);
}
document.addEventListener('click',event=>{const b=event.target.closest('[data-ink-selection]');if(!b)return;const sel=inkState.selection;if(!sel?.container.isConnected||sel.doc!==sel.container.inkDoc)return;if(b.dataset.inkSelection==='delete')inkDeleteSelection();else inkDuplicateSelection();});
// Partial eraser: points under the eraser are cut out; the rest stays as new
// strokes that name the stroke they came from.
const inkEraseBase=inkErase;
inkErase=function(s,x,y){
  if(inkState.eraser!=='partial')return inkEraseBase(s,x,y);
  const index=s.view.id-1,radius=8/inkScale(s.view.viewport);s.cut||=new Map();let hit=false;
  for(const stroke of s.doc.strokes.values()){
    if(stroke.page!==index)continue;
    if(['text','mark'].includes(stroke.tool)){const b=inkBox(stroke,s.view.viewport),v=s.view.viewport.convertToViewportPoint(x,y);if(v[0]>=b.x0&&v[0]<=b.x1&&v[1]>=b.y0&&v[1]<=b.y1){s.erased.set(stroke.id,stroke);hit=true;}continue;}
    const reach=radius+(stroke.tool==='highlighter'?stroke.width:inkPressureWidth(stroke.width,1))/2;
    if(!inkNear(stroke,x,y,reach))continue;
    for(let i=0;i<stroke.points.length;i+=4)if(Math.hypot(stroke.points[i]-x,stroke.points[i+1]-y)<=reach){let set=s.cut.get(stroke.id);if(!set){set=new Set();s.cut.set(stroke.id,set);}if(!set.has(i)){set.add(i);hit=true;}}
  }
  if(!hit||s.previewFrame)return;
  // Preview: draw the page as it will look after the cut, once per frame
  // however many pointer events arrive (a dense page takes tens of ms).
  s.previewFrame=requestAnimationFrame(()=>{s.previewFrame=null;if(inkStroke===s)inkErasePreview(s);});
};
function inkErasePreview(s){
  const index=s.view.id-1,view=s.view,canvas=inkLayer(s.container,view),k=inkBacking(canvas,view),ctx=canvas.getContext('2d');ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,canvas.width,canvas.height);
  for(const stroke of s.doc.strokes.values()){if(stroke.page!==index||s.erased.has(stroke.id))continue;for(const piece of inkPieces(stroke,s.cut.get(stroke.id)))inkPaint(ctx,piece,view.viewport,k);}
}
function inkPieces(stroke,cut){
  if(!cut?.size)return [stroke];const pieces=[];let current=[];
  for(let i=0;i<stroke.points.length;i+=4){if(cut.has(i)){if(current.length)pieces.push(current);current=[];}else current.push(...stroke.points.slice(i,i+4));}
  if(current.length)pieces.push(current);
  return pieces.map(points=>({...stroke,points}));
}
const inkFinishBase=inkFinish;
inkFinish=function(){
  const s=inkStroke;
  if(!s||s.tool!=='eraser'||inkState.eraser!=='partial')return inkFinishBase();
  inkStroke=null;
  const removed=[...s.erased.values()],added=[];
  for(const [id,cut] of s.cut||[]){const stroke=s.doc.strokes.get(id);if(!stroke||s.erased.has(id))continue;removed.push(stroke);for(const piece of inkPieces(stroke,cut))added.push({...piece,id:inkId(),from:stroke.id,createdAt:new Date().toISOString()});}
  if(!removed.length){inkDrawPage(s.container,s.view);return;}
  inkReplace(s.doc,s.view,removed,added);
};
// ---- Text boxes on the page, edited in place: the text tool places a box where
// it is pressed (or opens the box there) with a bar above it for colour, size, bold / italic /
// underline, alignment, lists (bullets or numbers) and delete. A press outside, Esc or ✓ finishes the box and
// the reading tool comes back. A box keeps its look (bold, italic, underline, align) and its width,
// so exports align it the same way.
// 텍스트 색상, row by row: greys; the app's own pen colours with a violet of the same family; warm colours (wine, coral,
// pale pink, apricot, brown); cool ones (teal, dark teal, olive, dark olive, pale lime). The last two rows are chosen so
// that no swatch looks like another of its panel, the highlighter's too (CIEDE2000 15 or more, tests/ink-color-smoke.cjs);
// strokes, boxes and colours added or used lately keep their colours. Colours added to the pen come last, beside the colour of one's own.
const INK_TEXT_GREYS=['#000000','#5f6368','#9aa0a6','#d0d3d6','#ffffff'],INK_TEXT_PEN=[...inkPalettes.pen,'#7c3aed'],INK_TEXT_BRIGHT=[['#9f1239','#ff8a65','#fecdd3','#fed7aa','#92400e'],['#0891b2','#134e4a','#808000','#365314','#ecfccb']];
const inkTextColorRows=()=>[INK_TEXT_GREYS,INK_TEXT_PEN,...INK_TEXT_BRIGHT];
// The last row: colours picked with the colour wheel (kept, newest first), then colours added to the pen; four at most.
const inkTextAdded=()=>[...new Set([...(inkState.textCustom||[]),...inkState.custom.pen])].filter(c=>!inkTextColorRows().flat().includes(c)).slice(0,4);
function inkTextKeepCustom(color){if(!inkHex(color)||inkTextColorRows().flat().includes(color))return;inkState.textCustom=[color,...(inkState.textCustom||[]).filter(c=>c!==color)].slice(0,4);persistInkPrefs();}
function inkTextForgetCustom(color){if(!(inkState.textCustom||[]).includes(color))return false;inkState.textCustom=inkState.textCustom.filter(c=>c!==color);persistInkPrefs();return true;}
const INK_TEXT_SIZE=24,INK_TEXT_ALIGNS=['left','center','right'];
const INK_ALIGN_PATHS={left:'M4 6h16 M4 12h10 M4 18h14',center:'M4 6h16 M7 12h10 M5 18h14',right:'M4 6h16 M10 12h10 M6 18h14'};
const inkTextFont=(s,px)=>`${s.italic?'italic ':''}${s.bold?'700 ':''}${px}px "Noto Sans KR", sans-serif`;
// The format bar belongs to the text box being edited: a box on a PDF page (inkTextEdit) or a notebook
// box. That box is the bar's target, which says how its look is applied and how it is deleted or finished.
let inkTextEdit=null,inkTextTarget=null,inkTextBar=null,inkTextPop=null;
// A new box starts in the text colour and size chosen last (24pt before any), with no fill and no border (those are
// never carried over).
// Colours and the look are taken only as checked (they go into the bar's and the panel's HTML; ink read from disk is not
// checked when read).
function inkTextStyleOf(stroke){const marks=globalThis.appInkMarks,look=marks.textLook(stroke);return {color:marks.hexColor(stroke?.color)||marks.hexColor(inkState.textColor)||'#000000',size:stroke?.width||inkState.textSize||INK_TEXT_SIZE,bold:Boolean(stroke?.bold),italic:Boolean(stroke?.italic),underline:Boolean(stroke?.underline),align:INK_TEXT_ALIGNS.includes(stroke?.align)?stroke.align:'left',fill:look.fill,border:look.border?{...look.border}:null};}
function inkTextOpen(container,view,existing,point){
  inkTextFinish();
  const doc=container.inkDoc,box=document.createElement('div'),area=document.createElement('textarea');
  box.className='ink-text-editor';area.className='ink-text-area';area.value=existing?.text||'';area.maxLength=2000;area.wrap='off';area.spellcheck=false;area.rows=1;area.setAttribute('aria-label',tr('텍스트 상자'));
  box.append(area);view.div.append(box);
  inkTextEdit={container,view,doc,existing,point:existing?[existing.points[0],existing.points[1]]:[Math.round(point[0]*100)/100,Math.round(point[1]*100)/100],style:inkTextStyleOf(existing),box,area};
  if(existing){inkState.editingText=existing.id;inkDrawPage(container,view);}
  const edit=inkTextEdit;
  inkTextBarOpen({box,area,style:edit.style,apply:()=>inkTextLayout(),remove:()=>inkTextDone({remove:true}),done:()=>inkTextDone(),lost:()=>{if(inkTextEdit===edit)inkTextFinish();},
    // A press outside finishes the box; on a page it does nothing else (no new box, no stroke).
    outside:event=>{const onPage=event.target.closest('.page');inkTextDone();if(onPage){event.preventDefault();event.stopPropagation();}}});
  inkTextLayout();area.focus({preventScroll:true});area.setSelectionRange(area.value.length,area.value.length);
  area.addEventListener('input',()=>inkTextPlace());
}
// The editor sits where the box is drawn, in the box's own font at the page's zoom.
function inkTextLayout(){
  const t=inkTextEdit;if(!t)return;const vp=t.view.viewport,[x,y]=vp.convertToViewportPoint(t.point[0],t.point[1]),css=(t.view.div.offsetWidth||vp.width)/vp.width,px=t.style.size*inkScale(vp)*css;
  // The editor is the box as drawn: its text at the box's point, the padding, border and fill around it (the blue line
  // that marks it as being edited is drawn outside, as an outline).
  const frame=globalThis.appInkMarks.textBoxFrame({width:t.style.size,border:t.style.border}),u=inkScale(vp)*css,pad=frame.pad*u,b=frame.border*u;
  Object.assign(t.box.style,{left:`${x/vp.width*100}%`,top:`${y/vp.height*100}%`,margin:`${-(pad+b)}px 0 0 ${-(pad+b)}px`,padding:`${pad}px`,border:t.style.border?`${b}px ${t.style.border.style} ${t.style.border.color}`:'0',background:t.style.fill||'transparent'});
  const font=inkTextFont(t.style,px),fit=inkTextFit(font),room=Math.ceil(px*.3);
  Object.assign(t.area.style,{font,lineHeight:'1.3',color:t.style.color,textAlign:t.style.align,textDecoration:t.style.underline?'underline':'none',position:'relative',top:`${-fit.shift}px`,wordSpacing:`${fit.space}px`,
    // A slanted last letter reaches past its advance, and a descender below its line box: room for them on the right and
    // below, which the box's size does not count (the editor clips its text to its own box).
    boxSizing:'content-box',paddingRight:t.style.italic?`${room}px`:'0',marginRight:t.style.italic?`${-room}px`:'0',paddingBottom:`${room}px`,marginBottom:`${-room}px`});
  inkTextPlace();
}
// The editor's letters where the drawn ones are. The page draws each line from its top (textBaseline top, a line every
// 1.3 sizes); the editor sets each line in a 1.3 line box, whose baseline sits lower by what the font's ascent and
// descent make of the leading; and the page's space is narrower than the editor's. Both are measured for the font (a
// line in a box as the editor sets it, against the canvas's own measure) and the editor's text is moved up and its
// spaces narrowed by that much: entering and leaving the editor moves no letter. Kept per font.
const inkTextFits=new Map();
function inkTextFit(font){
  let fit=inkTextFits.get(font);if(fit)return fit;
  const ctx=document.createElement('canvas').getContext('2d');ctx.font=font;ctx.textBaseline='top';const drawn=-ctx.measureText('x').alphabeticBaseline,canvasSpace=ctx.measureText(' ').width;
  const probe=document.createElement('div'),mark=document.createElement('span'),space=document.createElement('span');
  Object.assign(probe.style,{position:'absolute',left:'-10000px',top:'0',font,lineHeight:'1.3',whiteSpace:'pre',visibility:'hidden'});
  Object.assign(mark.style,{display:'inline-block',width:'0',height:'0',verticalAlign:'baseline'});space.textContent=' ';
  probe.append(mark,space);document.body.append(probe);
  const set=mark.getBoundingClientRect().top-probe.getBoundingClientRect().top,domSpace=space.getBoundingClientRect().width;probe.remove();
  fit={shift:set-drawn,space:canvasSpace-domSpace};
  // Measured only once the font is there (a font still loading measures the fallback's).
  if(document.fonts.check(font))inkTextFits.set(font,fit);else document.fonts.load(font).then(()=>{inkTextFits.delete(font);if(inkTextEdit)inkTextLayout();}).catch(()=>{});
  return fit;
}
// The bar stays just above the box (or below it near the top of the window); a panel it opens
// (colours, lists) sits on the far side of the bar with its tail pointing at the button pressed.
function inkTextPlace(){
  const t=inkTextTarget;if(!t||!inkTextBar)return;
  if(!t.box.isConnected){t.lost();inkTextBarClose();return;}
  const r=t.box.getBoundingClientRect(),h=inkTextBar.offsetHeight,w=inkTextBar.offsetWidth,above=r.top-h-12>=56;
  inkTextBar.style.left=`${Math.max(8,Math.min(r.left+r.width/2-w/2,innerWidth-w-8))}px`;inkTextBar.style.top=`${above?r.top-h-12:r.bottom+12}px`;inkTextBar.dataset.side=above?'above':'below';
  if(inkTextPop){
    const b=inkTextBar.getBoundingClientRect(),anchor=inkTextBar.querySelector(`[data-tb="${inkTextPop.dataset.kind}"]`)?.getBoundingClientRect()||b,pw=inkTextPop.offsetWidth,ph=inkTextPop.offsetHeight,mid=anchor.left+anchor.width/2;
    const left=Math.max(8,Math.min(mid-28,innerWidth-pw-8)),up=above?b.top-ph-12>=8:b.bottom+ph+12>innerHeight;
    Object.assign(inkTextPop.style,{left:`${left}px`,top:`${up?b.top-ph-12:b.bottom+12}px`});inkTextPop.style.setProperty('--tail',`${Math.max(14,Math.min(pw-14,mid-left))}px`);inkTextPop.dataset.side=up?'above':'below';
  }
}
const INK_CHEVRON='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 10l5 5 5-5"/></svg>';
// A mark on a colour (the chosen one, the bar's button) in white, or dark on light colours.
// A colour panel, as the text box's colour button and the writing tools' + open it: a title, rows of round swatches
// (the chosen one marked), a last row of one's own colours, and the colour wheel for any other.
function inkSwatchPanelHtml({title,rows,rowTitle,added,chosen,attr,customAttr,removable,name}){
  const swatch=c=>`<button type="button" ${attr}="${c}"${removable.has(c)?` ${removable.attr} title="${removable.title}"`:''} style="--c:${c};color:${inkTextOn(c)}" aria-pressed="${chosen===c}" aria-label="${name(c)}">${chosen===c?INK_CHEVRON:''}</button>`;
  return `<strong>${title}</strong><div class="ink-text-swatches">${rows.map((row,i)=>`<div class="ink-text-row${i===1?' pen':''}"${i===1?` title="${rowTitle}"`:''}>${row.map(swatch).join('')}</div>`).join('')}<div class="ink-text-row">${added.map(swatch).join('')}<label class="ink-text-custom${[...rows.flat(),...added].includes(chosen)?'':' chosen'}" title="${tr('다른 색')}"><input type="color" ${customAttr} value="${inkHex(chosen)?chosen:'#000000'}" aria-label="${tr('다른 색 고르기')}"></label></div></div>`;
}
const inkTextOn=c=>{const n=parseInt(c.slice(1),16),l=(.299*(n>>16)+.587*(n>>8&255)+.114*(n&255))/255;return l>.7?'#1f2937':'#ffffff';};
const INK_LIST_TYPES=[['bullet',tr('글머리 기호'),'M9 6h11 M9 12h11 M9 18h11 M4.5 6h.01 M4.5 12h.01 M4.5 18h.01'],['number',tr('번호 매기기'),'M10 6h10 M10 12h10 M10 18h10 M4 4.5h1.5v4 M4 8.5h3 M3.8 14.2a1.4 1.4 0 0 1 2.7.4c0 1-2.7 2-2.7 3.4h2.8'],['none',tr('목록 없음'),'M5 6h14 M5 12h14 M5 18h14']];
// 상자 모양: the box's fill (none, light colours, one's own), its border's colour (none, colours, one's own), width (pt)
// and line. Each choice shows at once on the box; the panel stays open.
const INK_BOX_FILLS=['#ffffff','#f1f3f5','#fff3bf','#d3f9d8','#d0ebff','#ffdeeb','#e5dbff'],INK_BOX_BORDERS=['#191f28','#868e96','#1b64da','#e03131','#2f9e44','#f08c00','#7048e8'];
const INK_BOX_LINES=[['solid',tr('실선')],['dashed',tr('파선')],['dotted',tr('점선')]];
function inkTextBoxHtml(s){
  const none=(kind,on)=>`<button type="button" class="ink-box-none" data-tb-look="${kind}" data-value="none" aria-pressed="${on}" title="${tr('없음',null,'box look')}" aria-label="${tr('없음',null,'box look')}"></button>`;
  const swatch=(kind,c,on)=>`<button type="button" data-tb-look="${kind}" data-value="${c}" style="--c:${c};color:${inkTextOn(c)}" aria-pressed="${on}" aria-label="${tr('색 {color}',{color:c})}">${on?INK_CHEVRON:''}</button>`;
  const custom=(kind,now,list)=>`<label class="ink-text-custom${now&&!list.includes(now)?' chosen':''}" title="${tr('다른 색')}"><input type="color" data-tb-look-custom="${kind}" value="${now||'#000000'}" aria-label="${tr('다른 색 고르기')}"></label>`;
  const fill=s.fill,line=s.border;
  return `<strong>${tr('상자 모양')}</strong><div class="ink-box-look">`+
    `<span>${tr('배경',null,'box look')}</span><div class="ink-box-row">${none('fill',!fill)}${INK_BOX_FILLS.map(c=>swatch('fill',c,fill===c)).join('')}${custom('fill',fill,INK_BOX_FILLS)}</div>`+
    `<span>${tr('테두리',null,'box look')}</span><div class="ink-box-row">${none('borderColor',!line)}${INK_BOX_BORDERS.map(c=>swatch('borderColor',c,line?.color===c)).join('')}${custom('borderColor',line?.color,INK_BOX_BORDERS)}</div>`+
    `<span>${tr('굵기',null,'box look')}</span><div class="ink-box-row ink-box-widths">${globalThis.appInkMarks.TEXT_BORDER_WIDTHS.map(n=>`<button type="button" data-tb-look="borderWidth" data-value="${n}" aria-pressed="${line?.width===n}" title="${tr('{n}pt',{n})}" aria-label="${tr('테두리 굵기 {n}pt',{n})}"><i style="height:${Math.max(1,Math.min(6,n))}px"></i>${n}</button>`).join('')}</div>`+
    `<span>${tr('선 모양',null,'box look')}</span><div class="ink-box-row ink-box-lines">${INK_BOX_LINES.map(([k,label])=>`<button type="button" data-tb-look="borderStyle" data-value="${k}" aria-pressed="${line?.style===k}" title="${label}" aria-label="${label}"><i style="border-top:3px ${k} currentColor"></i></button>`).join('')}</div>`+
    `</div>${line?'':`<p>${tr('굵기나 선 모양을 고르면 글자 색 테두리가 생깁니다.')}</p>`}`;
}
function inkTextBarHtml(s){
  const toggle=(k,label,title)=>`<button type="button" data-tb="${k}" aria-pressed="${s[k]}" title="${title}" aria-label="${title}">${label}</button>`,next=INK_TEXT_ALIGNS[(INK_TEXT_ALIGNS.indexOf(s.align)+1)%3];
  const open=k=>inkTextPop?.dataset.kind===k,list=inkTextTarget?inkListAt(inkTextTarget.area):null,listIcon=INK_LIST_TYPES.find(([k])=>k===(list?.type||'bullet'))[2];
  return `<button type="button" class="ink-tb-color" data-tb="color" aria-haspopup="true" aria-expanded="${open('color')}" title="${tr('텍스트 색상')}" aria-label="${tr('텍스트 색상 {color}',{color:s.color})}"><span style="--c:${s.color};color:${inkTextOn(s.color)}">${INK_CHEVRON}</span></button>`+
    `<select class="ink-tb-size" data-tb="size" title="${tr('글자 크기 (pt)')}" aria-label="${tr('글자 크기 (pt)')}">${[...new Set([...INK_TEXT_SIZE_CHOICES,Number(s.size)])].sort((a,b)=>a-b).map(n=>`<option value="${n}" ${n===Number(s.size)?'selected':''}>${n}</option>`).join('')}</select>`+
    toggle('bold','<b>B</b>',tr('굵게 (Ctrl+B)'))+toggle('italic','<i>I</i>',tr('기울임 (Ctrl+I)'))+toggle('underline','<u>U</u>',tr('밑줄 (Ctrl+U)'))+
    `<button type="button" data-tb="align" data-value="${next}" title="${tr('정렬: {now} (누르면 {next})',{now:({left:tr('왼쪽'),center:tr('가운데'),right:tr('오른쪽')})[s.align],next:({left:tr('왼쪽'),center:tr('가운데'),right:tr('오른쪽')})[next]})}" aria-label="${tr('정렬 바꾸기')}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="${INK_ALIGN_PATHS[s.align]}"/></svg></button>`+
    `<button type="button" data-tb="list" aria-haspopup="true" aria-expanded="${open('list')}" aria-pressed="${Boolean(list)}" title="${tr('목록',null,'text list')}" aria-label="${tr('목록',null,'text list')}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="${listIcon}"/></svg></button>`+
    `<button type="button" class="ink-tb-box" data-tb="box" aria-haspopup="true" aria-expanded="${open('box')}" title="${tr('상자 모양')}" aria-label="${tr('상자 모양')}"><span class="${s.fill||s.border?'':'none'}" style="${s.fill?`background:${s.fill};`:''}${s.border?`border:${Math.min(3,Math.max(1,s.border.width))}px ${s.border.style} ${s.border.color};`:''}"></span></button>`+
    `<span class="ink-tb-sep"></span><button type="button" data-tb="delete" title="${tr('텍스트 상자 삭제')}" aria-label="${tr('텍스트 상자 삭제')}">${icon('trash')}</button><button type="button" class="ink-tb-done" data-tb="done" title="${tr('완료 (Esc)')}" aria-label="${tr('완료')}">${tr('완료')}</button>`;
}
function inkTextBarOpen(target){
  if(inkTextTarget&&inkTextTarget!==target){const before=inkTextTarget;inkTextBarClose();before.lost();}
  inkTextTarget=target;inkTextBarShow();
}
function inkTextBarClose(){inkTextPop?.remove();inkTextPop=null;inkTextBar?.remove();inkTextBar=null;inkTextTarget=null;}
// The size menu's choices in points (a size set otherwise is added to the list).
const INK_TEXT_SIZE_CHOICES=[8,9,10,11,12,14,16,18,20,24,28,32,36,48,60,72];
function inkTextBarShow(){
  const t=inkTextTarget;if(!t)return;
  if(!inkTextBar){inkTextBar=document.createElement('div');inkTextBar.className='ink-text-bar';inkTextBar.setAttribute('role','toolbar');inkTextBar.setAttribute('aria-label',tr('텍스트 서식'));document.body.append(inkTextBar);}
  inkTextBar.innerHTML=inkTextBarHtml(t.style);inkTextPlace();
}
function inkTextPopClose(){if(!inkTextPop)return false;inkTextPop.remove();inkTextPop=null;inkTextBarShow();return true;}
// 텍스트 색상: fifteen colours and a colour of one's own; 목록: bullets, numbers or none.
function inkTextPopToggle(kind){
  const was=inkTextPop?.dataset.kind;inkTextPopClose();if(was===kind)return;
  const t=inkTextTarget;if(!t)return;inkTextPop=document.createElement('div');inkTextPop.className='ink-text-pop';inkTextPop.dataset.kind=kind;inkTextPop.setAttribute('role','dialog');
  if(kind==='color'){inkTextPop.setAttribute('aria-label',tr('텍스트 색상'));
    inkTextPop.innerHTML=inkSwatchPanelHtml({title:tr('텍스트 색상'),rows:inkTextColorRows(),rowTitle:tr('펜 색'),added:inkTextAdded(),chosen:t.style.color,attr:'data-tb-color',customAttr:'data-tb-custom',
      removable:{attr:'data-tb-added',has:c=>(inkState.textCustom||[]).includes(c),title:tr('고른 색 · 오른쪽 클릭으로 지우기')},name:c=>inkColorNames[c]?tr('펜 색 {name}',{name:inkColorNames[c]}):tr('색 {color}',{color:c})});}
  else if(kind==='box'){inkTextPop.setAttribute('aria-label',tr('상자 모양'));inkTextPop.innerHTML=inkTextBoxHtml(t.style);}
  else{inkTextPop.setAttribute('aria-label',tr('목록',null,'text list'));const now=inkListAt(t.area)?.type||'none';
    inkTextPop.innerHTML=`<strong>${tr('목록',null,'text list')}</strong><div class="ink-text-lists">${INK_LIST_TYPES.map(([k,label,d])=>`<button type="button" data-tb-list="${k}" aria-pressed="${now===k}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg><span>${label}</span></button>`).join('')}</div><p>${tr('Enter로 다음 항목 · 빈 항목에서 Enter로 끝내기 · Tab 들여쓰기')}</p>`;}
  document.body.append(inkTextPop);inkTextBarShow();
}
function inkTextFormat(kind,value,custom=false){
  const t=inkTextTarget;if(!t)return;const s=t.style;
  if(kind==='bold'||kind==='italic'||kind==='underline')s[kind]=!s[kind];
  else if(kind==='align')s.align=INK_TEXT_ALIGNS.includes(value)?value:'left';
  // A size chosen is kept on this computer, as the text colour is: new boxes (on pages and in notebooks) start in it.
  else if(kind==='size'){const n=Math.round(Number(value));if(Number.isFinite(n)){s.size=Math.min(72,Math.max(6,n));inkState.textSize=s.size;persistInkPrefs();}}
  else if(kind==='color'&&inkHex(value)){s.color=value;inkState.textColor=value;if(custom)inkTextKeepCustom(value);persistInkPrefs();t.onColor?.(value);if(inkTextPop){inkTextPop.remove();inkTextPop=null;}}
  else if(kind==='list'){inkListSet(t.area,value);if(inkTextPop){inkTextPop.remove();inkTextPop=null;}}
  // The box's fill and border. A width or line chosen while the box has no border gives it one in the text's colour.
  else if(kind==='fill')s.fill=inkHex(value)?value:null;
  else if(kind==='borderColor')s.border=inkHex(value)?{color:value,width:s.border?.width||1,style:s.border?.style||'solid'}:null;
  else if(kind==='borderWidth'&&globalThis.appInkMarks.TEXT_BORDER_WIDTHS.includes(Number(value)))s.border={color:s.border?.color||s.color,width:Number(value),style:s.border?.style||'solid'};
  else if(kind==='borderStyle'&&globalThis.appInkMarks.TEXT_BORDER_STYLES.includes(value))s.border={color:s.border?.color||s.color,width:s.border?.width||1,style:value};
  if(kind!=='list')t.apply();inkTextBarShow();
  // The box panel stays open while one tries looks; it closes with its button, a press outside or Esc.
  if(inkTextPop?.dataset.kind==='box'){inkTextPop.innerHTML=inkTextBoxHtml(s);inkTextPlace();}
}
// ---- Lists written in the box: "• " or "1. " after the line's indent (two spaces a level).
// Enter continues the list, Enter on an empty item ends it, Tab / Shift+Tab indent; numbers
// follow on by themselves. The text stays plain, so exports and other apps show the same list.
const INK_LIST_LINE=/^( *)(• |(\d{1,3})\. )/;
function inkListLine(line){const m=INK_LIST_LINE.exec(line);return m?{indent:m[1],marker:m[2],type:m[3]?'number':'bullet',rest:line.slice(m[0].length)}:null;}
const inkLineStart=(v,at)=>v.lastIndexOf('\n',at-1)+1;
function inkListAt(area){const v=area.value,a=inkLineStart(v,area.selectionStart),e=v.indexOf('\n',a);return inkListLine(v.slice(a,e<0?v.length:e));}
// Numbers count up within a run of items at one indent; any other line at that indent or less starts again.
function inkRenumber(value){
  const counts=[];return value.split('\n').map(line=>{const m=inkListLine(line),depth=(m?m.indent.length:line.match(/^ */)[0].length)>>1;
    if(!m||m.type!=='number'){counts.length=line.trim()?depth:0;if(m)counts.length=depth+1,counts[depth]=0;return line;}
    counts.length=depth+1;counts[depth]=(counts[depth]||0)+1;return m.indent+counts[depth]+'. '+m.rest;}).join('\n');
}
// A change made by hand goes through the editing commands, so Ctrl+Z still undoes it.
function inkAreaReplace(area,from,to,text){area.setSelectionRange(from,to);if(!(text?document.execCommand('insertText',false,text):from===to||document.execCommand('delete')))area.setRangeText(text,from,to,'end');}
function inkRenumberArea(area){
  const v=area.value,next=inkRenumber(v);if(next===v)return;
  const lines=v.split('\n'),after=next.split('\n'),at=area.selectionStart,line=v.slice(0,at).split('\n').length-1,col=at-inkLineStart(v,at);
  // Only the numbers change, so the cursor keeps its place on its line (moved by its own number's change).
  area.value=next;const start=after.slice(0,line).join('\n').length+(line?1:0),pos=start+Math.max(0,col+after[line].length-lines[line].length);area.setSelectionRange(pos,pos);
  // Set directly, so the box's owner (a notebook saving as one types) hears of it as of any edit.
  area.dispatchEvent(new Event('input',{bubbles:true}));
}
function inkListSet(area,type){
  const v=area.value,a=inkLineStart(v,area.selectionStart),endAt=v.indexOf('\n',area.selectionEnd),b=endAt<0?v.length:endAt;
  const lines=v.slice(a,b).split('\n').map(l=>{const m=inkListLine(l),indent=m?m.indent:l.match(/^ */)[0],rest=m?m.rest:l.slice(indent.length);return type==='bullet'?indent+'• '+rest:type==='number'?indent+'1. '+rest:indent+rest;});
  inkAreaReplace(area,a,b,lines.join('\n'));inkRenumberArea(area);inkTextPlace();
}
function inkListIndent(area,out){
  const v=area.value,a=inkLineStart(v,area.selectionStart),endAt=v.indexOf('\n',area.selectionEnd),b=endAt<0?v.length:endAt,caret=area.selectionStart;
  const lines=v.slice(a,b).split('\n'),next=lines.map(l=>out?l.replace(/^ {1,2}/,''):'  '+l).join('\n'),moved=next.split('\n')[0].length-lines[0].length;
  inkAreaReplace(area,a,b,next);area.setSelectionRange(Math.max(a,caret+moved),Math.max(a,caret+moved));inkRenumberArea(area);
}
// After a line break (typed, or from the Korean input method finishing a word), the list goes on.
function inkListAfterBreak(area){
  const v=area.value,at=area.selectionStart,prevEnd=at-1;if(v[prevEnd]!=='\n')return;
  const prevStart=inkLineStart(v,prevEnd),prev=inkListLine(v.slice(prevStart,prevEnd));if(!prev)return;
  if(!prev.rest.trim()){inkAreaReplace(area,prevStart,at,'');return;} // an empty item ends the list
  inkAreaReplace(area,at,at,prev.indent+(prev.type==='number'?'1. ':'• '));inkRenumberArea(area);
}
document.addEventListener('input',event=>{const area=inkTextTarget?.area;if(event.target!==area)return;if(event.inputType==='insertLineBreak'||event.inputType==='insertParagraph')inkListAfterBreak(area);else if(/^delete/.test(event.inputType||''))inkRenumberArea(area);inkTextBarShow();});
document.addEventListener('selectionchange',()=>{if(inkTextTarget&&document.activeElement===inkTextTarget.area&&!inkTextPop){const pressed=inkTextBar?.querySelector('[data-tb="list"]')?.getAttribute('aria-pressed'),now=String(Boolean(inkListAt(inkTextTarget.area)));if(pressed!==undefined&&pressed!==now)inkTextBarShow();}});
// Finishing saves the box (or removes it when emptied); nothing changed saves nothing.
function inkTextFinish({cancel=false,remove=false}={}){
  const t=inkTextEdit;if(!t)return false;inkTextEdit=null;inkState.editingText=null;
  if(inkTextTarget?.box===t.box)inkTextBarClose();
  const text=t.area.value.replace(/\s+$/,''),s=t.style,before=t.existing;t.box.remove();
  const same=before&&before.text===text&&before.color===s.color&&before.width===s.size&&Boolean(before.bold)===s.bold&&Boolean(before.italic)===s.italic&&Boolean(before.underline)===s.underline&&(before.align||'left')===s.align&&(before.fill||null)===(s.fill||null)&&inkSameBorder(before.border,s.border);
  if(t.doc.stale||cancel||same&&!remove||!before&&(remove||!text.trim())){inkDrawPage(t.container,t.view);return true;}
  if(remove||!text.trim()){inkReplace(t.doc,t.view,[before],[]);return true;}
  const ctx=document.createElement('canvas').getContext('2d');ctx.font=inkTextFont(s,s.size);const w=Math.round(Math.max(...text.split('\n').map(l=>ctx.measureText(l).width))*10)/10;
  const stroke={id:inkId(),page:t.view.id-1,tool:'text',color:s.color,width:s.size,points:[t.point[0],t.point[1],0,0],text,...(s.bold?{bold:true}:{}),...(s.italic?{italic:true}:{}),...(s.underline?{underline:true}:{}),...(s.align!=='left'?{align:s.align}:{}),...(w>0?{w}:{}),...(s.fill?{fill:s.fill}:{}),...(s.border?{border:{color:s.border.color,width:s.border.width,style:s.border.style}}:{}),...(before?{from:before.id}:{}),createdAt:new Date().toISOString()};
  inkReplace(t.doc,t.view,before?[before]:[],[stroke]);return true;
}
function inkTextDone(options){if(inkTextFinish(options))inkSetTool('read');}
const inkSameBorder=(a,b)=>!a&&!b||Boolean(a&&b)&&a.color===b.color&&a.width===b.width&&a.style===b.style;
// The bar's buttons act on pointerdown so the text keeps its focus and cursor.
const inkTextRefocus=()=>inkTextTarget?.area.focus({preventScroll:true});
document.addEventListener('pointerdown',event=>{
  const t=inkTextTarget;if(!t)return;
  // Only the main button acts on the bar and its panels; a right-click there (to take a colour off) keeps the text's focus.
  if(event.button!==0&&event.target.closest('.ink-text-bar,.ink-text-pop')){event.preventDefault();return;}
  const swatch=event.target.closest('.ink-text-pop [data-tb-color]');if(swatch){event.preventDefault();inkTextFormat('color',swatch.dataset.tbColor);inkTextRefocus();return;}
  const listType=event.target.closest('.ink-text-pop [data-tb-list]');if(listType){event.preventDefault();inkTextFormat('list',listType.dataset.tbList);inkTextRefocus();return;}
  const look=event.target.closest('.ink-text-pop [data-tb-look]');if(look){event.preventDefault();inkTextFormat(look.dataset.tbLook,look.dataset.value);inkTextRefocus();return;}
  if(event.target.closest('.ink-text-pop'))return;
  const b=event.target.closest('.ink-text-bar button[data-tb]');
  if(b){event.preventDefault();const kind=b.dataset.tb;if(kind==='color'||kind==='list'||kind==='box')inkTextPopToggle(kind);else if(kind==='delete')t.remove();else if(kind==='done')t.done();else{inkTextFormat(kind,b.dataset.value);inkTextRefocus();}return;}
  if(event.target.closest('.ink-text-bar')||t.box.contains(event.target))return;
  t.outside(event);
},true);
document.addEventListener('change',event=>{
  if(event.target.matches?.('.ink-text-bar [data-tb="size"]')){inkTextFormat('size',event.target.value);inkTextRefocus();}
  if(event.target.matches?.('.ink-text-pop [data-tb-custom]')){inkTextFormat('color',event.target.value,true);inkTextRefocus();}
  if(event.target.matches?.('.ink-text-pop [data-tb-look-custom]')){inkTextFormat(event.target.dataset.tbLookCustom,event.target.value);inkTextRefocus();}
});
document.addEventListener('keydown',event=>{
  const t=inkTextTarget;if(!t)return;
  if(event.target.matches?.('.ink-text-bar [data-tb="size"]')){if(event.key==='Enter'){event.preventDefault();inkTextFormat('size',event.target.value);inkTextRefocus();}else if(event.key==='Escape'){event.preventDefault();event.stopPropagation();inkTextRefocus();}return;}
  if(event.target!==t.area)return;
  if(event.key==='Escape'){event.preventDefault();event.stopPropagation();if(!inkTextPopClose())t.done();return;}
  if(event.key==='Tab'&&!event.ctrlKey&&!event.altKey&&!event.isComposing&&inkListAt(t.area)){event.preventDefault();inkListIndent(t.area,event.shiftKey);return;}
  if((event.ctrlKey||event.metaKey)&&!event.shiftKey&&!event.altKey){const kind={b:'bold',i:'italic',u:'underline'}[event.key.toLowerCase()];if(kind){event.preventDefault();inkTextFormat(kind);}}
},true);
// The text colour panel by keyboard, as the + panel: arrows, Home, End; Enter or Space chooses (the click a key makes);
// Esc closes it and gives the focus back to the text.
document.addEventListener('keydown',event=>{
  const pop=event.target.closest?.('.ink-text-pop[data-kind="color"]');if(!pop||!inkTextTarget)return;
  if(event.key==='Escape'){event.preventDefault();event.stopPropagation();inkTextPopClose();inkTextRefocus();return;}
  inkSwatchMove(event,pop,'[data-tb-color],[data-tb-custom]');
},true);
document.addEventListener('click',event=>{if(event.detail!==0||!inkTextTarget)return;const swatch=event.target.closest?.('.ink-text-pop [data-tb-color]');if(!swatch)return;event.preventDefault();inkTextFormat('color',swatch.dataset.tbColor);inkTextRefocus();});
document.addEventListener('scroll',()=>inkTextPlace(),true);window.addEventListener('resize',()=>inkTextPlace());
// A colour picked by hand is taken off the panel with a right-click (boxes keep their colour).
document.addEventListener('contextmenu',event=>{const b=event.target.closest?.('.ink-text-pop [data-tb-added]');if(!b)return;event.preventDefault();if(inkTextForgetCustom(b.dataset.tbColor)&&inkTextPop?.dataset.kind==='color'){inkTextPopToggle('color');inkTextPopToggle('color');}});
// With the reading tool a text box on a page is still the box: a click on it (not a drag selecting
// page text) opens it for editing, as the text tool does. Without this, a box finished (which
// brings the reading tool back) could only be reached again by choosing the text tool first.
function inkTextHit(event){
  const pageDiv=event.target.closest?.('.page'),container=pageDiv?.closest('.translated-pages');if(!container?.inkDoc||container.inkDoc.stale)return null;
  const view=inkPageViews(container).find(v=>v.div===pageDiv);if(!view)return null;
  const rect=view.div.getBoundingClientRect(),x=(event.clientX-rect.left)*view.viewport.width/rect.width,y=(event.clientY-rect.top)*view.viewport.height/rect.height;
  const hit=[...container.inkDoc.strokes.values()].find(s=>s.page===view.id-1&&s.tool==='text'&&(b=>x>=b.x0-2&&x<=b.x1+2&&y>=b.y0-2&&y<=b.y1+2)(inkBox(s,view.viewport)));
  return hit?{container,view,hit,point:view.viewport.convertToPdfPoint(x,y)}:null;
}
let inkTextPress=null,inkTextLast=null,inkTextLastPress={};
// A text box on a page works as in the notebook with the reading (select) tool: a press selects it (an
// outline with ×), a drag moves it (one undo step), a second press on it soon after (or a double click)
// edits it, and Delete or × removes it. The text tool still opens a box at once.
function inkTextSelectionDraw(){
  document.querySelectorAll('.ink-text-selected').forEach(n=>n.remove());
  const last=inkTextLast,stroke=last&&last.container.isConnected&&last.container.inkDoc?.strokes.get(last.id);if(!stroke)return;
  const vp=last.view.viewport,b=inkBox(stroke,vp),box=document.createElement('div');box.className='ink-text-selected';
  Object.assign(box.style,{left:`${b.x0/vp.width*100}%`,top:`${b.y0/vp.height*100}%`,width:`${(b.x1-b.x0)/vp.width*100}%`,height:`${(b.y1-b.y0)/vp.height*100}%`});
  box.innerHTML=`<button type="button" class="ink-text-remove" data-ink-text-remove title="${tr('텍스트 상자 삭제 (Delete)')}" aria-label="${tr('텍스트 상자 삭제')}">×</button>`;last.view.div.append(box);
}
// A text box found by search, outlined on its page for a moment (library.js openContentHit), its page's pane scrolled to it.
function inkFlashTextBox(view,stroke){const vp=view.viewport,b=inkBox(stroke,vp),box=document.createElement('div');box.className='ink-search-flash search-flash';
  Object.assign(box.style,{left:`${b.x0/vp.width*100}%`,top:`${b.y0/vp.height*100}%`,width:`${(b.x1-b.x0)/vp.width*100}%`,height:`${(b.y1-b.y0)/vp.height*100}%`});view.div.append(box);scrollWithin(box,{block:'center'});setTimeout(()=>box.remove(),1800);}
function inkTextSelect(at){if(at)inkSelectOnly('text');inkTextLast=at?{container:at.container,view:at.view,id:at.hit?.id??at.id}:null;inkTextSelectionDraw();}
function inkTextRemoveSelected(){
  const last=inkTextLast;if(!last)return false;const stroke=last.container.inkDoc?.strokes.get(last.id);inkTextSelect(null);
  if(!stroke||!last.container.isConnected||last.container.inkDoc.stale)return false;
  inkReplace(last.container.inkDoc,last.view,[stroke],[]);toast(tr('텍스트 상자를 지웠습니다. (Ctrl+Z로 되돌리기)'));return true;
}
// A text box dragged (reading and text tools) lands where it is let go, as a lasso selection does (inkDrop): drawn
// there while dragged, not where it was.
function inkTextDrag(at,event){
  const {container,view,hit}=at,doc=container.inkDoc,rect=view.div.getBoundingClientRect(),sx=view.viewport.width/rect.width,sy=view.viewport.height/rect.height,box=inkBox(hit,view.viewport);
  let moved=false,live=null,plan=null;
  // The drag is measured on the page, whose place is read again at every event (the pane may scroll meanwhile).
  const drop=e=>{const r=view.div.getBoundingClientRect();return inkDrop(container,view,box,[(e.clientX-r.left-(event.clientX-rect.left))*sx,(e.clientY-r.top-(event.clientY-rect.top))*sy],[e.clientX,e.clientY]);},placed=()=>inkMapped([hit],view,plan.map,1,plan.view)[0];
  const move=e=>{if(e.pointerId!==event.pointerId)return;if(!moved&&Math.hypot(e.clientX-event.clientX,e.clientY-event.clientY)<=4)return;
    if(!moved){document.querySelectorAll('.ink-text-selected').forEach(n=>n.remove());inkHide(doc,[hit.id],view);}moved=true;document.body.classList.add('ink-grabbing');
    plan=drop(e);if(live?.view!==plan.view){live?.end();const v=plan.view;live=inkLivePreview(v.div,()=>v.viewport,(ctx,k)=>inkPaint(ctx,placed(),v.viewport,k));live.view=v;}live.request();};
  const up=e=>{if(e.pointerId!==event.pointerId)return;removeEventListener('pointermove',move,true);removeEventListener('pointerup',up,true);removeEventListener('pointercancel',up,true);document.body.classList.remove('ink-grabbing');
    live?.end();inkUnhide();if(moved&&e.type==='pointerup')plan=drop(e);const next=moved&&e.type==='pointerup'&&!doc.stale?placed():null;
    if(!next||plan.view===view&&Math.hypot(next.points[0]-hit.points[0],next.points[1]-hit.points[1])<.5){inkTextSelectionDraw();return;}
    next.id=inkId();next.from=hit.id;inkReplace(doc,view,[hit],[next],new Map([[view.id-1,view],[plan.view.id-1,plan.view]]));inkTextSelect({container,view:plan.view,id:next.id});};
  addEventListener('pointermove',move,true);addEventListener('pointerup',up,true);addEventListener('pointercancel',up,true);
}
document.addEventListener('keydown',event=>{
  if(event.key==='Escape'&&inkTextLast&&!inkTextTarget){event.preventDefault();inkTextSelect(null);return;}
  if(!['Delete','Backspace'].includes(event.key)||event.defaultPrevented||!inkTextLast||inkTextTarget||dialog.open||event.target.closest?.('input,textarea,select,[contenteditable="true"],.cm-editor'))return;
  event.preventDefault();inkTextRemoveSelected();
});
document.addEventListener('pointerdown',event=>{
  if(event.target.closest?.('[data-ink-text-remove]')){event.preventDefault();event.stopPropagation();inkTextRemoveSelected();return;}
  const on=['read','text'].includes(inkState.tool)&&event.button===0&&state.screen==='reader'&&!inkTextTarget;
  const at=on?inkTextHit(event):null;inkTextPress=null;
  if(!at||inkFingerPans(event)){if(inkTextLast&&!event.target.closest?.('.ink-text-selected'))inkTextSelect(null);return;}
  const now=performance.now(),again=inkState.tool==='text'||inkTextLastPress.id===at.hit.id&&now-inkTextLastPress.at<450;inkTextLastPress={id:at.hit.id,at:now};
  event.preventDefault();event.stopPropagation();inkTextSelect(at);inkTextPress={x:event.clientX,y:event.clientY,at,again};inkTextDrag(at,event);
},true);
// ---- One selection at a time ----
// The PDF ink selection, a PDF text box, and a notebook selection or box: choosing one lets go of the others, so Delete,
// Ctrl+D and a colour act on what was chosen last, never also on something chosen before (perhaps out of view).
// kind: 'ink', 'text' or 'nb' (the one being chosen). The notebook hears of the others through appInk.onSelect.
function inkSelectOnly(kind){
  if(kind!=='ink'&&inkState.selection){inkState.selection=null;document.querySelectorAll('.ink-selection').forEach(n=>n.remove());}
  if(kind!=='text'&&inkTextLast)inkTextSelect(null);
  if(kind!=='nb')globalThis.appInk.onSelect?.();
}
// ---- The select tool moves pen strokes and shapes ----
// The pen stroke or shape drawn on top where a PDF page is pressed, within about 8 screen pixels of its line (as the
// eraser touches), or null. Highlighters and marks on sentences lie over the text, where the select tool picks text:
// they move with the lasso.
function inkGrabHit(event){
  if(inkViewOnly())return null;
  const pageDiv=event.target.closest?.('.page'),container=pageDiv?.closest('.translated-pages');if(!container?.inkDoc||container.inkDoc.stale)return null;
  const view=inkPageViews(container).find(v=>v.div===pageDiv);if(!view)return null;
  const [x,y]=inkPoint(view,event),index=view.id-1,radius=8/inkScale(view.viewport),strokes=[...container.inkDoc.strokes.values()];
  for(let i=strokes.length-1;i>=0;i--){const stroke=strokes[i];if(stroke.page===index&&stroke.tool==='pen'&&inkStrokeReach(stroke,x,y,radius))return {container,view,stroke};}
  return null;
}
// The pressed stroke is selected (the selection it is in, if any, stays as it is) and the same press drags it, as
// the lasso moves a selection; pressed without moving, it stays selected, its box and bar shown.
function inkGrab({container,view,stroke},event){
  inkSelectOnly('ink');const doc=container.inkDoc,sel=inkState.selection;
  if(!(sel?.doc===doc&&sel.container===container&&sel.page===view.id-1&&sel.ids.includes(stroke.id))){
    const b=inkBox(stroke,view.viewport);inkState.selection={doc,container,page:view.id-1,ids:[stroke.id],box:{x0:b.x0-4,y0:b.y0-4,x1:b.x1+4,y1:b.y1+4}};
  }
  getSelection()?.removeAllRanges();inkSelectionDraw(container);inkGesture(container,view,view.div,event,'read','move');
}
// With the select tool a press on a pen stroke grabs it (after text boxes, which come first); a press elsewhere on a
// page lets go of a selection and picks text as before.
document.addEventListener('pointerdown',event=>{
  if(event.defaultPrevented||inkState.tool!=='read'||state.screen!=='reader'||inkTextTarget||!event.target.closest?.('.translated-pages .page'))return;
  // Links, pins and the selection's own handle and bar keep their presses; a finger scrolls, keeping the selection.
  if(event.target.closest('.ink-selection,a,button,input,textarea,select,.annotation-pin')||event.button!==0||inkFingerPans(event))return;
  inkEndStale(event);const hit=inkStroke?null:inkGrabHit(event);
  if(hit){event.preventDefault();event.stopPropagation();inkGrab(hit,event);return;}
  inkState.selection=null;document.querySelectorAll('.ink-selection').forEach(n=>n.remove());
},true);
// Over a stroke the select tool can move, the pointer is an open hand.
let inkGrabHoverFrame=0,inkGrabHoverEvent=null;
document.addEventListener('pointermove',event=>{
  if(event.pointerType==='touch'||inkState.tool!=='read')return;inkGrabHoverEvent=event;if(inkGrabHoverFrame)return;
  inkGrabHoverFrame=requestAnimationFrame(()=>{inkGrabHoverFrame=0;const e=inkGrabHoverEvent,on=inkState.tool==='read'&&state.screen==='reader'&&!inkTextTarget&&!e.buttons&&!inkStroke&&Boolean(e.target.closest?.('.translated-pages .page'))&&!inkTextHit(e)&&Boolean(inkGrabHit(e));document.body.classList.toggle('ink-stroke-hover',on);});
},{passive:true});
document.documentElement.addEventListener('pointerleave',()=>document.body.classList.remove('ink-stroke-hover'));
// Over a text box (reading and text tools) the pointer is the move cursor, as on notebook boxes.
let inkTextHoverFrame=0,inkTextHoverEvent=null;
document.addEventListener('pointermove',event=>{
  if(event.pointerType==='touch')return;inkTextHoverEvent=event;if(inkTextHoverFrame)return;
  inkTextHoverFrame=requestAnimationFrame(()=>{inkTextHoverFrame=0;const e=inkTextHoverEvent,on=['read','text'].includes(inkState.tool)&&state.screen==='reader'&&!inkTextTarget&&!e.buttons&&Boolean(e.target.closest?.('.translated-pages .page'))&&Boolean(inkTextHit(e));document.body.classList.toggle('ink-text-hover',on);});
},{passive:true});
document.documentElement.addEventListener('pointerleave',()=>document.body.classList.remove('ink-text-hover'));
document.addEventListener('dblclick',event=>{const at=inkState.tool==='read'&&!inkTextTarget&&inkTextHit(event);if(!at)return;event.preventDefault();event.stopPropagation();inkTextSelect(null);inkSetTool('text');inkTextOpen(at.container,at.view,at.hit,at.point);},true);
document.addEventListener('click',event=>{
  const press=inkTextPress;inkTextPress=null;if(!press?.at||!press.again||!['read','text'].includes(inkState.tool)||Math.hypot(event.clientX-press.x,event.clientY-press.y)>4)return;
  event.preventDefault();event.stopPropagation();inkTextLastPress={};inkTextSelect(null);const {container,view,hit,point}=press.at;inkSetTool('text');inkTextOpen(container,view,hit,point);
},true);
// The pointer shows the text cursor over a text box while reading.
document.addEventListener('pointermove',event=>{if(inkState.tool!=='read'||event.buttons||state.screen!=='reader')return;const over=Boolean(event.target.closest?.('.page')&&inkTextHit(event));document.body.classList.toggle('ink-over-text',over);},{passive:true});
// Notebook text boxes use the same bar: open(target) with {box, area, style, apply, remove, done, outside, lost}.
globalThis.appInk.textBar={open:inkTextBarOpen,close:inkTextBarClose,show:inkTextBarShow,place:inkTextPlace,get target(){return inkTextTarget;},get color(){return inkState.textColor||null;},get size(){return inkState.textSize||null;}};
// A page drawn again (zoom, another paper) takes the editor away: the box is saved as it is.
document.addEventListener('app-pagerendered',()=>{const t=inkTextEdit;if(!t)return;if(!t.box.isConnected){if(t.view.div.isConnected){t.view.div.append(t.box);inkTextLayout();t.area.focus({preventScroll:true});}else inkTextFinish();}else inkTextLayout();},true);
// Highlight of the selected text: line boxes in PDF space plus the quote.
let inkMarkRange=null;
document.addEventListener('pointerdown',event=>{if(event.target.closest('[data-ink-mark]')){const sel=getSelection();inkMarkRange=sel&&!sel.isCollapsed?{range:sel.getRangeAt(0).cloneRange(),quote:String(sel).trim().slice(0,10000)}:null;}},true);
// The selected range's line boxes, per page view, in PDF points.
function inkRangeGroups(container,range){
  const groups=new Map();
  for(const r of range.getClientRects()){
    if(r.width<1||r.height<1)continue;
    for(const view of inkPageViews(container)){const d=view.div.getBoundingClientRect();if(r.left>=d.right||r.right<=d.left||r.top>=d.bottom||r.bottom<=d.top)continue;
      const f=view.viewport.width/d.width,a=view.viewport.convertToPdfPoint((Math.max(r.left,d.left)-d.left)*f,(Math.max(r.top,d.top)-d.top)*f),b=view.viewport.convertToPdfPoint((Math.min(r.right,d.right)-d.left)*f,(Math.min(r.bottom,d.bottom)-d.top)*f);
      const rect=[Math.min(a[0],b[0]),Math.min(a[1],b[1]),Math.max(a[0],b[0]),Math.max(a[1],b[1])].map(n=>Math.round(n*100)/100);
      if(!groups.has(view))groups.set(view,[]);groups.get(view).push(rect);break;}
  }
  return groups;
}
const inkRangeContainer=range=>{const node=range.commonAncestorContainer;return (node.nodeType===1?node:node.parentElement)?.closest?.('.translated-pages')||null;};
// style: undefined for a highlight, 'underline' for a line under the text.
function inkMarkSelection(picked=inkMarkRange,style){
  inkMarkRange=null;if(!picked){toast(style==='underline'?tr('밑줄을 그을 문장을 원문이나 번역에서 먼저 선택하세요.'):tr('강조할 문장을 원문이나 번역에서 먼저 선택하세요.'));return;}
  const container=inkRangeContainer(picked.range);
  if(!container?.inkDoc){toast(container?tr('번역이 끝난 원문 배치 화면에서 쓸 수 있습니다.'):tr('원문이나 번역 화면의 문장을 선택하세요.'));return;}
  const groups=inkRangeGroups(container,picked.range);
  if(!groups.size){toast(tr('선택한 문장의 위치를 찾지 못했습니다.'));return;}
  const color=style==='underline'?inkState.color.pen:inkState.color.highlighter;
  const doc=container.inkDoc,added=[...groups].map(([view,rects])=>({id:inkId(),page:view.id-1,tool:'mark',color,width:1,points:[],rects:rects.slice(0,200),quote:picked.quote,...(style?{style}:{}),createdAt:new Date().toISOString()}));
  const first=[...groups.keys()][0];inkReplace(doc,first,[],added,new Map([...groups.keys()].map(v=>[v.id-1,v])));getSelection().removeAllRanges();toast(style==='underline'?tr('선택한 문장에 밑줄을 그었습니다.'):tr('선택한 문장을 강조했습니다.'));
}
Object.assign(paths,{memoPin:'M12 21s-6-5.6-6-10a6 6 0 0 1 12 0c0 4.4-6 10-6 10z M9.5 10h5 M9.5 12.5h3.5',newWindow:'M14 4h6v6 M20 4l-8 8 M18 14v6H4V6h6',inkUnderline:'M7 4v7a5 5 0 0 0 10 0V4 M5 20h14',copy:'M9 9h11v11H9z M5 15H4V4h11v1'});
// ---- Right-click on selected text: underline, highlight, annotate (copy) ----
let inkTextMenu=null;
function closeInkTextMenu(){inkTextMenu?.remove();inkTextMenu=null;}
// The same actions as a right-click menu and as a small bar over a fresh selection, each with its key.
const INK_TEXT_ITEMS=[['underline',tr('밑줄 긋기'),'inkUnderline','U'],['highlight',tr('하이라이트'),'inkMark','H'],['annotate',tr('주석 추가'),'annotate','N'],['copy',tr('복사'),'copy','Ctrl+C']];
const INK_TEXT_KEYS={KeyU:'underline',KeyH:'highlight',KeyN:'annotate'};
// The selection on the source or translated pages, if there is one worth acting on.
function inkPickedSelection(target){
  const sel=getSelection();if(!sel||sel.isCollapsed||!sel.rangeCount)return null;
  const range=sel.getRangeAt(0),container=inkRangeContainer(range);if(!container)return null;
  if(target&&target.closest?.('.translated-pages')!==container)return null;
  const quote=String(sel).trim().slice(0,10000);if(!quote)return null;
  return {picked:{range:range.cloneRange(),quote},source:container.classList.contains('original-pages'),container};
}
function openInkTextMenu(found,x,y,bar){
  closeInkTextMenu();
  // Right-click or a selection: the same row of actions, side by side.
  inkTextMenu=document.createElement('div');inkTextMenu.className='ink-text-menu ink-select-bar';inkTextMenu.setAttribute('role','toolbar');inkTextMenu.setAttribute('aria-label',tr('선택한 문장'));
  inkTextMenu.innerHTML=INK_TEXT_ITEMS.filter(([id])=>id==='copy'||!inkViewOnly()).map(([id,label,symbol,key])=>`<button type="button" data-ink-text="${id}" title="${label} (${key})" aria-keyshortcuts="${key==='Ctrl+C'?'Control+C':key}">${icon(symbol)}<span>${label}</span><kbd>${key}</kbd></button>`).join('');
  document.body.append(inkTextMenu);
  const w=inkTextMenu.offsetWidth,h=inkTextMenu.offsetHeight;inkTextMenu.style.left=`${Math.max(8,Math.min(x,innerWidth-w-8))}px`;inkTextMenu.style.top=`${Math.max(8,Math.min(y,innerHeight-h-8))}px`;
  Object.assign(inkTextMenu,found,{bar:Boolean(bar)});if(!bar)inkTextMenu.querySelector('button').focus();
}
document.addEventListener('contextmenu',event=>{
  const found=inkPickedSelection(event.target);if(!found)return;
  event.preventDefault();openInkTextMenu(found,event.clientX,event.clientY,false);
});
// Selecting text with the reading tool shows the bar just above the selection's end; no right-click needed.
function inkShowTextBar(){
  if(state.screen!=='reader'||!['read','hand'].includes(inkState.tool)||dialog.open)return;
  const found=inkPickedSelection();if(!found){if(inkTextMenu?.bar)closeInkTextMenu();return;}
  if(inkTextMenu&&!inkTextMenu.bar)return;
  const rects=[...found.picked.range.getClientRects()].filter(r=>r.width>0&&r.height>0),last=rects.at(-1)||found.picked.range.getBoundingClientRect(),first=rects[0]||last;
  openInkTextMenu(found,last.right-160,first.top-44<60?last.bottom+8:first.top-44,true);
}
document.addEventListener('pointerup',event=>{if(event.button===0&&event.target.closest?.('.translated-pages'))setTimeout(inkShowTextBar);});
document.addEventListener('keyup',event=>{if(event.shiftKey&&event.key.startsWith('Arrow'))setTimeout(inkShowTextBar);});
document.addEventListener('selectionchange',()=>{if(inkTextMenu?.bar&&!inkPickedSelection())closeInkTextMenu();});
document.addEventListener('scroll',event=>{if(inkTextMenu?.bar&&!event.target.closest?.('.ink-text-menu'))closeInkTextMenu();},true);
// U · H · N act on the selection (by key position, so they work with a Korean keyboard layout too).
document.addEventListener('keydown',event=>{
  const action=INK_TEXT_KEYS[event.code];if(!action||event.ctrlKey||event.metaKey||event.altKey||event.shiftKey||event.repeat)return;
  if(state.screen!=='reader'||dialog.open||event.target.closest?.('input,textarea,select,[contenteditable="true"],.cm-content'))return;
  const found=inkPickedSelection();if(!found)return;event.preventDefault();closeInkTextMenu();inkTextAction(action,found);
});
function inkTextAction(choice,{picked,source,container}){
  if(choice!=='copy'&&inkViewOnly()){toast(tr('이 창은 보기 전용입니다. 밑줄·하이라이트·주석은 본 창에서 하세요.'));return;}
  if(choice==='underline')inkMarkSelection(picked,'underline');
  else if(choice==='highlight')inkMarkSelection(picked);
  else if(choice==='copy')navigator.clipboard?.writeText(picked.quote).then(()=>toast(tr('복사했습니다.'))).catch(()=>{});
  else runDesktop(()=>inkAnnotateSelection(picked,source?container:null))();
}
document.addEventListener('pointerdown',event=>{if(inkTextMenu&&!event.target.closest('.ink-text-menu'))closeInkTextMenu();},true);
document.addEventListener('keydown',event=>{
  if(!inkTextMenu)return;const buttons=[...inkTextMenu.querySelectorAll('button')],at=buttons.indexOf(document.activeElement);
  if(event.key==='Escape'){event.preventDefault();event.stopPropagation();closeInkTextMenu();}
  else if(['ArrowDown','ArrowUp','ArrowLeft','ArrowRight'].includes(event.key)&&at>=0){event.preventDefault();const next=event.key==='ArrowDown'||event.key==='ArrowRight';buttons[(at+(next?1:buttons.length-1))%buttons.length].focus();}
},true);
document.addEventListener('click',event=>{
  const item=event.target.closest('[data-ink-text]');if(!item||!inkTextMenu)return;
  const found={picked:inkTextMenu.picked,source:inkTextMenu.source,container:inkTextMenu.container},choice=item.dataset.inkText;closeInkTextMenu();inkTextAction(choice,found);
});
// An annotation from selected source text keeps the text's place on the page, so it can be marked there.
async function inkAnnotateSelection(picked,sourceContainer){
  const groups=sourceContainer?inkRangeGroups(sourceContainer,picked.range):new Map(),first=[...groups][0];
  const page=first?first[0].id:Number(picked.range.startContainer.parentElement?.closest?.('[data-page]')?.dataset.page)||inkVisiblePage();
  await inkNewAnnotation();
  const pageInput=document.querySelector('#annotation-page'),quoteInput=document.querySelector('#annotation-quote');
  if(pageInput)pageInput.value=Math.min(Number(pageInput.max)||page,page);if(quoteInput)quoteInput.value=picked.quote;
  annotationAnchor=first?{key:targetKey(),page,rects:first[1].slice(0,200)}:null;getSelection().removeAllRanges();
  setTimeout(()=>document.querySelector('#annotation-body')?.focus());
}
// ---- Marks for file annotations on the source pages ----
// A quoted annotation gets a pin at the end of its text (the text itself shows only while
// the pointer is on the pin);
// one without a place gets a pin at the page's top right. The pin shows the note
// and opens it in the 주석 tab.
// 그림 영역 상자·주석 밑줄 (beside 그림 설명 and 주석 추가 in the top bar): dashed lines on the original where figure
// explanations and annotated sentences lie, 1.5pt as a pen's default line, growing with the page's zoom. Off at first;
// what is chosen is kept on this computer only (never in the vault).
const MARKS_KEY='app-marks';
function marksShown(){try{const v=JSON.parse(localStorage.getItem(MARKS_KEY)||'null');return {figureBoxes:v?.figureBoxes===true,annotationUnderlines:v?.annotationUnderlines===true};}catch{return {figureBoxes:false,annotationUnderlines:false};}}
// An on/off slide switch in the 주석 tab, before 모아 보기 (notes.js): the icon of what it shows (그림 설명, 주석 추가) and a
// track whose knob slides right when it is on.
function markToggle(action,label,symbol,which){return `<button type="button" class="mark-toggle" data-action="${action}" aria-pressed="${marksShown()[which]}" aria-label="${label}" title="${label}">${icon(symbol)}<span class="mark-switch" aria-hidden="true"><span></span></span></button>`;}
function toggleMarks(which){
  const next={...marksShown(),[which]:!marksShown()[which]};try{localStorage.setItem(MARKS_KEY,JSON.stringify(next));}catch{}
  for(const [action,key] of [['toggle-figure-boxes','figureBoxes'],['toggle-annotation-underlines','annotationUnderlines']])document.querySelectorAll(`[data-action="${action}"]`).forEach(b=>b.setAttribute('aria-pressed',String(next[key])));
  inkRefreshAnnotationMarks();
}
Object.assign(actions,{'toggle-figure-boxes':()=>toggleMarks('figureBoxes'),'toggle-annotation-underlines':()=>toggleMarks('annotationUnderlines')});
const validBox=r=>r&&[r.x,r.y,r.width,r.height].every(Number.isFinite)&&r.width>0&&r.height>0;
// The boxes and underlines shown now, for a saved original with its ink (only those whose toggle is on): each with its
// page counted from 0, as ink strokes are, and the page's geometry as the viewer has it (the main process reads the
// page's own when a page was not laid out yet).
function inkShownMarks(){
  const shown=marksShown(),paper=selected(),attachment=paper&&activeAttachment(paper),out={boxes:[],underlines:[]};if(!attachment||(!shown.figureBoxes&&!shown.annotationUnderlines))return out;
  const viewer=document.querySelector('.original-pages')?.pdfViewer,geometryOf=page=>{const p=viewer?.getPageView?.(page-1)?.pdfPage;return p?{view:[...p.view],rotate:p.rotate,userUnit:p.userUnit||1}:undefined;};
  const mine=a=>a.paperId===paper.id&&a.attachmentId===attachment.id&&Number.isInteger(a.page)&&a.page>=1;
  if(shown.figureBoxes){
    for(let page=1;page<=(viewer?.pagesCount||0);page++)for(const f of inkFigureMemos(paper,attachment,page))if(validBox(f.rect))out.boxes.push({page:page-1,rect:{x:f.rect.x,y:f.rect.y,width:f.rect.width,height:f.rect.height},geometry:geometryOf(page)});
    for(const a of itemAnnotations)if(mine(a)&&a.kind==='figure'&&validBox(a.figure))out.boxes.push({page:a.page-1,rect:{x:a.figure.x,y:a.figure.y,width:a.figure.width,height:a.figure.height},geometry:geometryOf(a.page)});
  }
  if(shown.annotationUnderlines)for(const a of itemAnnotations)if(mine(a)&&a.kind!=='figure'&&Array.isArray(a.rects)&&a.rects.length)out.underlines.push({page:a.page-1,rects:a.rects,geometry:geometryOf(a.page)});
  return out;
}
function inkAnnotationMarks(container,view){
  view.div.querySelector(':scope>.annotation-marks')?.remove();
  const paper=selected(),attachment=paper&&activeAttachment(paper);if(!attachment||state.screen!=='reader')return;
  const list=itemAnnotations.filter(a=>a.paperId===paper.id&&a.attachmentId===attachment.id&&a.page===view.id),figures=inkFigureMemos(paper,attachment,view.id),pins=inkMemoPins(paper,attachment,view.id);if(!list.length&&!figures.length&&!pins.length)return;
  const layer=document.createElement('div');layer.className='annotation-marks';const vp=view.viewport;let corner=0;
  // The boxes and underlines go first, under the pins (which stay clickable); an item without a place draws none.
  const shown=marksShown(),stroke=`${1.5*inkScale(vp)}px`;
  if(shown.figureBoxes)for(const r of [...figures.map(f=>f.rect),...list.filter(a=>a.kind==='figure').map(a=>a.figure)].filter(validBox)){
    const box=document.createElement('div');box.className='figure-box';Object.assign(box.style,{left:`${r.x*vp.width}px`,top:`${r.y*vp.height}px`,width:`${r.width*vp.width}px`,height:`${r.height*vp.height}px`,borderWidth:stroke});layer.append(box);
  }
  // One underline per line as seen: the rects of one line are joined first, as a saved PDF joins them (core/ink-marks.cjs).
  if(shown.annotationUnderlines)for(const a of list)if(a.kind!=='figure'&&Array.isArray(a.rects))for(const b of globalThis.appInkMarks.joinLineBoxes(a.rects.map(r=>{const p=vp.convertToViewportPoint(r[0],r[1]),q=vp.convertToViewportPoint(r[2],r[3]);return [p[0],p[1],q[0],q[1]];}))){
    const under=document.createElement('div');under.className='annotation-underline';Object.assign(under.style,{left:`${b[0]}px`,top:`${b[3]-1.5*inkScale(vp)}px`,width:`${b[2]-b[0]}px`,borderBottomWidth:stroke});layer.append(under);
  }
  // A memo from 그림 설명: a pin at the figure's top right; it opens the memo.
  for(const f of figures){
    let pinX,pinY;
    if(f.rect){pinX=(f.rect.x+f.rect.width)*vp.width-22;pinY=f.rect.y*vp.height+2;}
    else{pinX=vp.width-26;pinY=8+corner++*24;}
    const pin=document.createElement('button');pin.type='button';pin.className='annotation-pin figure-pin';pin.dataset.figurePin=f.key;pin.title=tr('{title}\n클릭하면 메모를 엽니다',{title:f.title});pin.setAttribute('aria-label',tr('{title} 메모 열기',{title:f.title}));pin.innerHTML=icon('figure');
    Object.assign(pin.style,{left:`${Math.max(0,Math.min(vp.width-20,pinX))}px`,top:`${Math.max(0,Math.min(vp.height-20,pinY))}px`});layer.append(pin);
  }
  // A memo pinned where the reader clicked (메모 핀): drag to move, click to open the memo.
  for(const m of pins){
    const pin=document.createElement('button');pin.type='button';pin.className='annotation-pin memo-pin';pin.dataset.memoPinOpen=m.key;pin.title=tr('{title}\n{text}\n클릭하면 메모를 엽니다 · 끌어서 옮기기',{title:m.title,text:(notes[m.key]||'').slice(0,160)});pin.setAttribute('aria-label',tr('{title} 메모 열기',{title:m.title}));pin.innerHTML=icon('memoPin');
    Object.assign(pin.style,{left:`${Math.max(0,Math.min(vp.width-20,m.x*vp.width-10))}px`,top:`${Math.max(0,Math.min(vp.height-20,m.y*vp.height-10))}px`});layer.append(pin);
  }
  for(const a of list){
    // A 그림 설명 (a figure annotation): a figure pin at the figure's top right; it opens its card.
    if(a.kind==='figure'){
      const r=a.figure,title=ownAnnotationTitle(a)||`${headLabel('그림 설명')} · ${tr('{n}쪽',{n:a.page})}`,pin=document.createElement('button');pin.type='button';pin.className='annotation-pin figure-pin';pin.dataset.annotationPin=a.id;pin.title=tr('{title}\n클릭하면 주석 탭에서 엽니다',{title});pin.setAttribute('aria-label',tr('{name} 열기',{name:title}));pin.innerHTML=icon('figure'); // i18n:keep — the stored kind value headLabel() names
      const pinX=r?(r.x+r.width)*vp.width-22:vp.width-26,pinY=r?r.y*vp.height+2:8+corner++*24;
      Object.assign(pin.style,{left:`${Math.max(0,Math.min(vp.width-20,pinX))}px`,top:`${Math.max(0,Math.min(vp.height-20,pinY))}px`});layer.append(pin);continue;
    }
    const tip=`${a.quote?`“${a.quote.slice(0,120)}${a.quote.length>120?'…':''}”\n`:''}${a.body}`;
    let pinX,pinY;
    if(a.rects?.length){
      for(const r of a.rects){const p=vp.convertToViewportPoint(r[0],r[1]),q=vp.convertToViewportPoint(r[2],r[3]);const line=document.createElement('div');line.className='annotation-span';line.dataset.annotationMark=a.id;Object.assign(line.style,{left:`${Math.min(p[0],q[0])}px`,top:`${Math.min(p[1],q[1])}px`,width:`${Math.abs(q[0]-p[0])}px`,height:`${Math.abs(q[1]-p[1])}px`});layer.append(line);}
      const last=a.rects[a.rects.length-1],p=vp.convertToViewportPoint(last[2],last[3]);pinX=p[0]+2;pinY=p[1]-10;
    }else{pinX=vp.width-26;pinY=8+corner++*24;}
    const pin=document.createElement('button');pin.type='button';pin.className='annotation-pin';pin.dataset.annotationPin=a.id;pin.title=tip;pin.setAttribute('aria-label',tr('주석: {text}',{text:a.body.slice(0,80)}));pin.innerHTML=icon('annotate');
    Object.assign(pin.style,{left:`${Math.max(0,Math.min(vp.width-20,pinX))}px`,top:`${Math.max(0,Math.min(vp.height-20,pinY))}px`});layer.append(pin);
  }
  view.div.append(layer);
}
// The 그림 설명 memos of this paper that belong on this page of this file. A memo saved with the
// figure's box (`#figure`) is placed by it; an older one, known only by the file name and page in
// its header line, gets a pin at the page's top right.
function inkFigureMemos(paper,attachment,page){
  const out=[];
  memoKeysOf(paper.id).forEach((key,index)=>{
    // A memo saved with the figure's place is a figure memo whatever its first line has become.
    let place=null;try{place=JSON.parse(notes[key+FIGURE_PLACE]||'null');}catch{}
    if(!place&&sourceKind(notes[key])!=='그림 설명')return; // i18n:keep — the kind sourceKind() names a figure head by
    const rect=place?.rect,valid=rect&&[rect.x,rect.y,rect.width,rect.height].every(Number.isFinite),head=(notes[key]||'').trim();
    if(place?place.attachmentId!==attachment.id||Number(place.page)!==page:memoPage(key)!==page||!memoLabels().isFigureMemoFor(head,[attachment.name,noteHeadName(attachment.name)]))return;
    out.push({key,title:memoTitle(key,index),rect:valid?rect:null});
  });
  return out;
}
function inkMemoPins(paper,attachment,page){
  const out=[];
  memoKeysOf(paper.id).forEach((key,index)=>{let place=null;try{place=JSON.parse(notes[key+MEMO_PIN]||'null');}catch{}if(place&&place.attachmentId===attachment.id&&Number(place.page)===page&&Number.isFinite(place.x)&&Number.isFinite(place.y))out.push({key,title:memoTitle(key,index),x:place.x,y:place.y});});
  return out;
}
// 메모 핀: arm, then a click on an original page pins the memo there (a new memo when none is given).
let memoPinArmed=null;
// The tool row's 메모 추가 (data-memo-add) arms a pin for a new memo; it shows pressed while armed and a second press disarms.
const inkMemoAddPressed=on=>document.querySelectorAll('[data-memo-add]').forEach(b=>b.setAttribute('aria-pressed',String(on)));
function inkArmMemoPin(key=''){const paper=selected();if(!paper)return;memoPinArmed={key,paperId:paper.id};document.body.classList.add('memo-pin-arming');inkMemoAddPressed(!key);toast(document.querySelector('.original-pages,.notebook-pane .nb-page')?tr('원문이나 노트북 페이지에서 핀을 꽂을 곳을 누르세요. (Esc: 취소)'):tr('원문·동시보기·노트북으로 바꾼 뒤, 핀을 꽂을 곳을 누르세요. (Esc: 취소)'));}
function inkDisarmMemoPin(){memoPinArmed=null;document.body.classList.remove('memo-pin-arming');inkMemoAddPressed(false);}
// A new memo, pinned where the page is pressed next and opened to write in: made only then, so Esc leaves no empty memo.
actions['memo-pin-new']=()=>{if(memoPinArmed&&!memoPinArmed.key){inkDisarmMemoPin();return;}inkArmMemoPin('');};
function inkPinPlace(event){
  // A notebook page: the pin as the memo tool places it there (notebook.js nbPoint, a whiteboard's own scale).
  const nbEl=event.target.closest?.('.notebook-pane .nb-page[data-page-id]');
  if(nbEl&&typeof nbPoint==='function'&&nb.doc){const page=nbPage(nbEl.dataset.pageId);if(!page)return null;const [x,y]=nbPoint(nbEl,event);return {notebookId:nb.doc.id,pageId:page.id,x:nbClamp(x/page.width,0,1),y:nbClamp(nbPinStored(page,y/page.height),0,1)};}
  const pageDiv=event.target.closest?.('.original-pages .page[data-page-number]'),attachment=selected()&&activeAttachment(selected());if(!pageDiv||!attachment)return null;
  const r=pageDiv.getBoundingClientRect();return {attachmentId:attachment.id,page:Number(pageDiv.dataset.pageNumber),x:Math.max(0,Math.min(1,(event.clientX-r.left)/r.width)),y:Math.max(0,Math.min(1,(event.clientY-r.top)/r.height))};
}
// A pin set for a memo (a new one when none is given), which then opens to write in. A memo has one
// pin: on a source page ({attachmentId,page,x,y}) or a notebook page ({notebookId,pageId,x,y}).
function inkPlaceMemoPin(place,key=''){
  key=key||newMemo('',place.notebookId?nbPinTitle(place):tr('{page}쪽 메모',{page:place.page}));if(!key)return;
  notes[key+MEMO_PIN]=JSON.stringify(place);refreshMemos();inkRefreshAnnotationMarks();runDesktop(desktopNotes)();openMemo(key);setTimeout(focusNote,80);
}
document.addEventListener('click',event=>{
  const button=event.target.closest('[data-memo-pin]');
  if(button){event.preventDefault();event.stopPropagation();const key=button.dataset.memoPin;
    if(key&&notes[key+MEMO_PIN]){delete notes[key+MEMO_PIN];refreshMemos();inkRefreshAnnotationMarks();runDesktop(desktopNotes)();toast(tr('원문 핀을 제거했습니다.'));return;}
    inkArmMemoPin(key||'');return;}
  if(!memoPinArmed)return;
  if(selected()?.id!==memoPinArmed.paperId){inkDisarmMemoPin();return;}
  const place=inkPinPlace(event);if(!place)return;
  // The memo chosen for the pin was deleted meanwhile: say so and leave the click alone.
  if(memoPinArmed.key&&notes[memoPinArmed.key]===undefined){inkDisarmMemoPin();toast(tr('핀을 꽂으려던 메모가 지워졌습니다.'));return;}
  event.preventDefault();event.stopPropagation();
  const key=memoPinArmed.key;inkDisarmMemoPin();inkPlaceMemoPin(place,key);
},true);
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&memoPinArmed){event.stopPropagation();inkDisarmMemoPin();}},true);
// Dragging a memo pin moves it on its page; a press without moving opens the memo.
document.addEventListener('pointerdown',event=>{
  const pin=event.target.closest?.('[data-memo-pin-open]');if(!pin||event.button!==0)return;
  event.preventDefault();event.stopPropagation();const key=pin.dataset.memoPinOpen,page=pin.closest('.page,.nb-page'),start=[event.clientX,event.clientY],origin=[pin.offsetLeft,pin.offsetTop];let moved=false;
  pin.setPointerCapture(event.pointerId);
  const move=e=>{const dx=e.clientX-start[0],dy=e.clientY-start[1];if(!moved&&Math.hypot(dx,dy)<4)return;moved=true;pin.style.left=`${origin[0]+dx}px`;pin.style.top=`${origin[1]+dy}px`;};
  const up=e=>{pin.removeEventListener('pointermove',move);pin.removeEventListener('pointerup',up);pin.removeEventListener('pointercancel',up);
    if(!moved){openMemo(key);return;}
    let place=null;try{place=JSON.parse(notes[key+MEMO_PIN]||'null');}catch{}if(!place||!page)return;
    const r=page.getBoundingClientRect();place.x=Math.max(0,Math.min(1,(e.clientX-r.left)/r.width));place.y=Math.max(0,Math.min(1,(e.clientY-r.top)/r.height));
    // On a notebook whiteboard a pin's share down is of the longest board, so it stays put as the board grows (notebook.js).
    if(page.matches('.nb-page[data-board]')&&typeof nbPinStored==='function')place.y=Math.max(0,Math.min(1,nbPinStored(nbPage(page.dataset.pageId),place.y)));
    notes[key+MEMO_PIN]=JSON.stringify(place);inkRefreshAnnotationMarks();runDesktop(desktopNotes)();};
  pin.addEventListener('pointermove',move);pin.addEventListener('pointerup',up);pin.addEventListener('pointercancel',up);
},true);
// Pointer presses are handled above; Enter or Space on a focused pin (a click without a pointer) opens its memo.
document.addEventListener('click',event=>{const pin=event.target.closest?.('[data-memo-pin-open]');if(!pin)return;event.preventDefault();event.stopPropagation();if(event.detail===0)openMemo(pin.dataset.memoPinOpen);},true);
function inkRefreshAnnotationMarks(){for(const container of document.querySelectorAll('.original-pages'))for(const view of inkPageViews(container))inkAnnotationMarks(container,view);}
document.addEventListener('app-pagerendered',event=>{const container=event.target;if(container.classList?.contains('original-pages')&&event.detail?.pageView)inkAnnotationMarks(container,event.detail.pageView);},true);
// A new or removed annotation re-renders the panel; the marks follow on the next frame.
const inkMarksRender=render;render=function(...args){const result=inkMarksRender.apply(this,args);if(memoPinArmed&&(selected()?.id!==memoPinArmed.paperId||state.screen!=='reader'))inkDisarmMemoPin();requestAnimationFrame(inkRefreshAnnotationMarks);return result;};
// A figure pin opens its memo in the 메모 tab.
document.addEventListener('click',event=>{
  const pin=event.target.closest('[data-figure-pin]');if(!pin)return;event.preventDefault();event.stopPropagation();
  openMemo(pin.dataset.figurePin);
},true);
for(const type of ['pointerover','pointerout'])document.addEventListener(type,event=>{const pin=event.target.closest?.('[data-annotation-pin]');if(!pin)return;const layer=pin.closest('.annotation-marks');layer?.querySelectorAll(`[data-annotation-mark="${CSS.escape(pin.dataset.annotationPin)}"]`).forEach(n=>n.classList.toggle('show',type==='pointerover'));});
document.addEventListener('click',event=>{
  const pin=event.target.closest('[data-annotation-pin]');if(!pin)return;event.preventDefault();event.stopPropagation();
  globalThis.appShowAnnotation(pin.dataset.annotationPin);
},true);
// Shape and selection tools show the current choice; the other choices open
// in a small menu below the button (on choosing the tool, or pressing it again).
Object.assign(paths,{
  inkRect:'M4 5h16v14H4z',inkEllipse:'M3 12a9 7 0 1 0 18 0a9 7 0 1 0-18 0',inkLine:'M5 19L19 5',inkTriangle:'M12 4l9 16H3z',inkArrow:'M5 19L19 5 M10 5h9v9',
  inkEraserPart:'M7 16l-3.3-3.3a1 1 0 0 1 0-1.4l8-8a1 1 0 0 1 1.4 0l4.6 4.6a1 1 0 0 1 0 1.4L11 16z M8.5 7.5l4.5 4.5 M3 20.5h2.5 M9 20.5h2.5 M15 20.5h2.5',
  inkLaser:'M4 20l6.5-6.5 M15 9m-3.2 0a3.2 3.2 0 1 0 6.4 0a3.2 3.2 0 1 0-6.4 0 M15 2.5v1.8 M15 13.7v1.8 M21.5 9h-1.8 M10.3 9H8.5',
  inkHand:'M8 13V5.5a1.5 1.5 0 0 1 3 0V11 M11 11V4a1.5 1.5 0 0 1 3 0v7 M14 11V5.5a1.5 1.5 0 0 1 3 0V12 M17 12V8.5a1.5 1.5 0 0 1 3 0V15a7 7 0 0 1-7 7h-1a7 7 0 0 1-5.4-2.6L3.5 16a1.5 1.5 0 0 1 2.3-1.9L8 16.5V13'
});
// Tools that share a button: reading and the hand (each a tool of its own),
// the shapes and the two erasers (one tool, several kinds). Shapes open their
// menu when chosen; the others open it when their button is pressed again.
// A menu floats below its button, so choosing never widens the toolbar.
const inkChoices={
  pointer:{key:'pointer',label:tr('선택 방식'),tools:true,items:[['read',tr('선택 · 글자 고르기, 필기와 상자 옮기기'),'inkRead'],['hand',tr('손 · 올가미로 고른 필기를 옮기기(없으면 화면 이동)'),'inkHand'],['laser',tr('레이저 포인터 · 잠깐 보였다 사라지는 선'),'inkLaser']]},
  shape:{key:'shape',label:tr('도형 고르기'),opens:true,items:[['rect',tr('사각형'),'inkRect'],['ellipse',tr('타원'),'inkEllipse'],['triangle',tr('삼각형'),'inkTriangle'],['line',tr('직선'),'inkLine'],['arrow',tr('화살표'),'inkArrow']]},
  eraser:{key:'eraser',label:tr('지우개 방식'),items:[['stroke',tr('지우개 · 닿은 선 전체'),'inkEraser'],['partial',tr('부분 지우개 · 닿은 부분만'),'inkEraserPart']]},
  // Ctrl+7: a text box, or a memo — its pin set where the page is pressed, then the memo to write.
  text:{key:'textTool',label:tr('텍스트 방식'),tools:true,items:[['text',tr('텍스트 상자 · 페이지에 글 넣기'),'inkMemo'],['memo',tr('메모 · 누른 자리에 핀을 꽂고 메모 넣기'),'memoPin']]}
};
function inkChoice(group){
  const c=inkChoices[group],value=c.tools&&c.items.some(([v])=>v===inkState.tool)?inkState.tool:inkState[c.key];
  return c.items.find(([v])=>v===value);
}
function inkFlyout(group){
  const c=inkChoices[group],[current]=inkChoice(group);
  return `<div class="ink-flyout" role="group" aria-label="${c.label}" data-ink-flyout="${group}">${c.items.map(([v,name,ic])=>inkButton(`data-ink-pick="${group}" data-value="${v}" aria-pressed="${current===v}"`,current===v?'active':'',name.split(' · ')[0],ic,name)).join('')}</div>`;
}
function inkGroupButton(group,tip){
  const c=inkChoices[group],[value,name,ic]=inkChoice(group),tool=c.tools?value:group,on=inkState.tool===tool,open=on&&inkState.flyout===group,label=name.split(' · ')[0];
  return `<span class="ink-group">${inkButton(`data-ink-tool="${tool}" data-ink-group="${group}" aria-pressed="${on}" aria-haspopup="true" aria-expanded="${open}"`,on?'active':'',label,ic,tr('{tip} (다시 누르면 다른 방식)',{tip:tip?tip+' · '+label:name}))}${open?inkFlyout(group):''}</span>`;
}
const inkToolbarBase=inkToolbar;
inkToolbar=function(){
  const html=inkToolbarBase().replace(/<button type="button" data-ink-tool="read"[^]*?<\/button>/,()=>inkGroupButton('pointer')).replace(/<button type="button" data-ink-tool="eraser"[^]*?<\/button>/,()=>inkGroupButton('eraser')+inkGroupButton('shape',tr('도형'))+inkToolButton('lasso',tr('올가미'),'inkLasso',tr('올가미 · 둘러 선택해 옮기기'))+inkGroupButton('text'));
  return html.replace('<div class="ink-colors"',inkButton('data-ink-mark','secondary small',tr('선택 강조'),'inkMark',tr('선택한 문장 형광 강조 (H)'))+'<div class="ink-colors"');
};
// Runs before the toolbar's own click handler, while inkState.tool is still
// the previous tool: pressing a group's active button toggles its menu, and
// choosing the shapes opens theirs.
document.addEventListener('click',event=>{const b=event.target.closest('[data-ink-tool]');if(!b)return;const group=b.dataset.inkGroup,c=inkChoices[group];inkState.flyout=!c?null:inkState.tool===b.dataset.inkTool?(inkState.flyout===group?null:group):c.opens?group:null;},true);
function inkFlyoutClose(){if(!inkState.flyout)return;inkState.flyout=null;document.querySelector('.ink-flyout')?.remove();document.querySelector('[aria-expanded="true"][data-ink-tool]')?.setAttribute('aria-expanded','false');}
document.addEventListener('pointerdown',event=>{if(inkState.flyout&&!event.target.closest('.ink-group'))inkFlyoutClose();},true);
document.addEventListener('click',event=>{
  const pick=event.target.closest('[data-ink-pick]');
  if(pick){const group=pick.dataset.inkPick,c=inkChoices[group],value=pick.dataset.value;inkState[c.key]=value;persistInkExtra();inkState.flyout=null;inkSetTool(c.tools?value:group);inkSelectionForTool(inkState.tool);return;}
  if(event.target.closest('[data-ink-mark]'))inkMarkSelection(inkMarkRange);
  if(event.target.closest('[data-ink-tool]'))inkSelectionForTool(inkState.tool);
});
// The lasso, the hand (which moves what the lasso selected) and the select tool (which moves it by one of its pen
// strokes) keep a selection; the drawing tools let go of it.
function inkSelectionForTool(tool){
  if(['hand','lasso','read'].includes(tool))return;
  inkState.selection=null;document.querySelectorAll('.ink-selection').forEach(n=>n.remove());
}
// Shift pressed or let go mid-drag changes a shape's preview without moving the pointer.
for(const type of ['keydown','keyup'])document.addEventListener(type,event=>{const s=inkStroke;if(event.key!=='Shift'||s?.mode!=='shape')return;s.shift=type==='keydown';inkLiveOf(s).request();});
// Keyboard: Ctrl (Cmd) + 1–7 picks the tools in toolbar order, Shift + 1–9 the
// colours shown; the tips name the keys. Digits are read from the key's
// position (event.code), so Shift+1 works whatever character it types.
const inkToolbarKeys=inkToolbar;
inkToolbar=function(){let tool=0,color=0;return inkToolbarKeys().replace(/(data-ink-tool="[^"]*"[^>]*?data-tip=")([^"]*)/g,(_,head,tip)=>`${head}${tip} · Ctrl+${++tool}`).replace(/(data-ink-color="[^"]*"[^>]*?data-tip=")([^"]*)/g,(_,head,tip)=>`${head}${tip} · Shift+${++color}`);};
document.addEventListener('keydown',event=>{
  if(state.screen!=='reader'||dialog.open||event.isComposing||event.altKey||event.target.closest?.('input,textarea,select,[contenteditable="true"]'))return;
  const digit=Number(/^Digit([1-9])$/.exec(event.code)?.[1]),bar=document.querySelector('.ink-toolbar');if(!digit||!bar)return;
  const command=event.ctrlKey||event.metaKey;
  if(command&&!event.shiftKey){
    const button=bar.querySelectorAll('.ink-tools [data-ink-tool]')[digit-1];if(!button)return;event.preventDefault();
    let tool=button.dataset.inkTool;inkState.flyout=null;
    // Pressed again while its tool is in use, a group's key moves to its next
    // way (사각형 → 타원 → 삼각형 …), as a second click on the button offers.
    const c=inkChoices[button.dataset.inkGroup];
    if(c&&inkState.tool===tool){const at=c.items.findIndex(([v])=>v===(c.tools?tool:inkState[c.key])),[value,name]=c.items[(at+1)%c.items.length];inkState[c.key]=value;persistInkExtra();if(c.tools)tool=value;toast(name.split(' · ')[0]);}
    inkSelectionForTool(tool);
    inkSetTool(tool);
  }else if(event.shiftKey&&!command){const button=bar.querySelectorAll('.ink-colors [data-ink-color]')[digit-1];if(!button)return;event.preventDefault();inkUseColor(button.dataset.inkColor);}
});
document.addEventListener('keydown',event=>{
  const sel=inkState.selection;if(!sel||state.screen!=='reader'||dialog.open)return;
  // A selection belongs to the page view it was made on; once that view is gone (another paper, a redraw) it is dropped, never applied elsewhere.
  if(!sel.container.isConnected||sel.doc!==sel.container.inkDoc){inkState.selection=null;return;}
  // Esc lets go of it wherever the keyboard is (pressing a page leaves the focus in a field one typed in before); the
  // other keys act only outside text fields, which they would edit.
  if(event.key==='Escape'){if(!event.defaultPrevented){event.preventDefault();inkState.selection=null;document.querySelectorAll('.ink-selection').forEach(n=>n.remove());}return;}
  if(event.defaultPrevented||event.target.closest?.('input,textarea,select,[contenteditable="true"]'))return;
  if(event.key==='Delete'||event.key==='Backspace'){event.preventDefault();inkDeleteSelection();}
  if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='d'){event.preventDefault();inkDuplicateSelection();}
});

// ---- Shape recognition: draw, then hold the pen still to straighten it ----
// A pen stroke held still for about half a second before lifting becomes a
// clean line, rectangle or ellipse when it is close enough to one (stored as
// an ordinary shape stroke, one undo removes it); otherwise it stays as
// drawn. Points are in page space; the fit thresholds are relative to size.
function inkRecognizeShape(points){
  const pts=[];for(let i=0;i<points.length;i+=4)pts.push([points[i],points[i+1]]);if(pts.length<8)return null;
  const first=pts[0],last=pts.at(-1),dist=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
  let length=0;for(let i=1;i<pts.length;i++)length+=dist(pts[i-1],pts[i]);
  const xs=pts.map(p=>p[0]),ys=pts.map(p=>p[1]),x0=Math.min(...xs),x1=Math.max(...xs),y0=Math.min(...ys),y1=Math.max(...ys),diag=Math.hypot(x1-x0,y1-y0);
  if(diag<8)return null;
  const chord=dist(first,last);
  if(chord>=diag*.9&&length<=chord*1.08){
    const off=Math.max(...pts.map(p=>Math.abs((last[0]-first[0])*(first[1]-p[1])-(first[0]-p[0])*(last[1]-first[1]))/chord));
    return off<=Math.max(2,chord*.04)?{shape:'line',from:first,to:last}:null;
  }
  if(chord>diag*.2||x1-x0<6||y1-y0<6)return null;
  const w=x1-x0,h=y1-y0,cx=(x0+x1)/2,cy=(y0+y1)/2;
  const rect=pts.reduce((n,[x,y])=>n+Math.min(Math.abs(x-x0),Math.abs(x-x1),Math.abs(y-y0),Math.abs(y-y1))/Math.min(w,h),0)/pts.length;
  const ellipse=pts.reduce((n,[x,y])=>n+Math.abs(Math.hypot((x-cx)/(w/2),(y-cy)/(h/2))-1),0)/pts.length;
  if(rect<=.05&&rect<ellipse)return {shape:'rect',from:[x0,y0],to:[x1,y1]};
  const corners=inkTriangle(pts,diag);if(corners)return {shape:'triangle',corners};
  if(ellipse<=.09)return {shape:'ellipse',from:[x0,y0],to:[x1,y1]};
  return null;
}
// Distance from p to the segment a–b, and the corners of a path kept within
// eps of it (Ramer–Douglas–Peucker).
function inkSegmentDistance(p,a,b){const dx=b[0]-a[0],dy=b[1]-a[1],t=dx||dy?Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/(dx*dx+dy*dy))):0;return Math.hypot(a[0]+t*dx-p[0],a[1]+t*dy-p[1]);}
function inkCorners(pts,eps){
  if(pts.length<3)return pts;let far=0,at=0;
  for(let i=1;i<pts.length-1;i++){const d=inkSegmentDistance(pts[i],pts[0],pts.at(-1));if(d>far){far=d;at=i;}}
  return far<=eps?[pts[0],pts.at(-1)]:[...inkCorners(pts.slice(0,at+1),eps).slice(0,-1),...inkCorners(pts.slice(at),eps)];
}
// A closed path with three clear corners and every point near its sides.
// The pen may start mid-side: that point, on the line between its
// neighbours, is no corner.
function inkTriangle(points,diag){
  // About 300 points are plenty to find three corners, and keep a long
  // scribble held at its end quick to test.
  const step=Math.ceil(points.length/300),pts=points.filter((_,i)=>i%step===0||i===points.length-1);
  let v=inkCorners(pts,diag*.07);
  if(v.length>1&&Math.hypot(v[0][0]-v.at(-1)[0],v[0][1]-v.at(-1)[1])<diag*.25)v=v.slice(0,-1);
  if(v.length===4&&inkSegmentDistance(v[0],v[3],v[1])<=diag*.07)v=v.slice(1);
  if(v.length!==3)return null;
  const side=i=>[v[i],v[(i+1)%3]];
  if(Math.min(...[0,1,2].map(i=>Math.hypot(v[i][0]-v[(i+1)%3][0],v[i][1]-v[(i+1)%3][1])))<diag*.25)return null;
  const off=pts.reduce((n,p)=>n+Math.min(...[0,1,2].map(i=>inkSegmentDistance(p,...side(i)))),0)/pts.length;
  return off<=diag*.035?v:null;
}
// A highlighter stroke held still straightens to a line, level when it
// is within 6 degrees of level (a line of text), upright when near upright.
function inkStraighten(points){
  const pts=[];for(let i=0;i<points.length;i+=4)pts.push([points[i],points[i+1]]);
  const first=pts[0],last=[...pts.at(-1)],chord=Math.hypot(last[0]-first[0],last[1]-first[1]);if(chord<8)return null;
  if(Math.max(...pts.map(p=>inkSegmentDistance(p,first,last)))>Math.max(4,chord*.12))return null;
  const angle=Math.abs(Math.atan2(last[1]-first[1],last[0]-first[0]))*180/Math.PI;
  if(angle<6||angle>174)last[1]=first[1];else if(Math.abs(angle-90)<6)last[0]=first[0];
  return {shape:'line',from:first,to:last};
}
// Draw, then hold the pen (or highlighter) still for about half a second
// before lifting: the stroke becomes the shape it is close to. Shared by
// PDF pages and notebook pages (points in each one's own space).
function inkHeldShape(tool,points,start){
  if(!['pen','highlighter'].includes(tool)||points.length<32)return null;
  let still=points.length-4;while(still>=4&&Math.hypot(points[still-4]-points.at(-4),points[still-3]-points.at(-3))<=1.5)still-=4;
  if(performance.now()-(start+points[still+3])<450)return null;
  const found=tool==='pen'?inkRecognizeShape(points):inkStraighten(points);if(!found)return null;
  const corners=found.corners?[...found.corners,found.corners[0]]:shapePoints(found.shape,found.from,found.to);
  return {shape:found.shape,points:corners.flatMap(p=>[Math.round(p[0]*100)/100,Math.round(p[1]*100)/100,.5,0])};
}
const inkFinishShape=inkFinish;
inkFinish=function(){
  const s=inkStroke;
  // Held still: from the first of the closing points that stay within a
  // point and a half of where the pen lifted (lifting adds its own point).
  const held=s&&!s.doc?.stale&&inkHeldShape(s.tool,s.points,s.start);
  if(held){
    inkStroke=null;s.live?.end();
    inkReplace(s.doc,s.view,[],[{id:inkId(),page:s.view.id-1,tool:s.tool,color:inkState.color[s.tool],width:inkState.width[s.tool],points:held.points,shape:held.shape,...(s.device?{device:s.device}:{}),createdAt:new Date().toISOString()}]);
    return;
  }
  inkFinishShape();
};
// Getters are copied as getters (Object.assign would copy today's value).
const inkExpose=props=>Object.defineProperties(globalThis.appInk,Object.getOwnPropertyDescriptors(props));
inkExpose({recognizeShape:inkRecognizeShape,straighten:inkStraighten,heldShape:inkHeldShape,shapePoints,constrain:inkConstrain,ruler:inkRuler,get shape(){return inkState.shape;}});
// Notebook pages use the same laser, partial eraser and selection scaling;
// a selection made there clears the one on PDF pages.
inkExpose({livePreview:inkLivePreview,laser:inkLaser,pieces:inkPieces,inside,scaleFactor:inkScaleFactor,strokeReach:inkStrokeReach,get eraser(){return inkState.eraser;},clearSelection(){inkSelectOnly('nb');}});

// ---- Pen response measurement (K-02): input event → the frame that shows it ----
// event.timeStamp and performance.now() share a clock; the live frame records
// how long each point waited. A pen-tip-to-glass delay needs a camera.
const inkLatency={samples:new Float64Array(4000),count:0,queued:[]};
const inkMoveMeasure=inkMove;
inkMove=function(event){if(inkStroke&&inkStroke.tool!=='eraser')inkLatency.queued.push(event.timeStamp);inkMoveMeasure(event);};
const inkLiveMeasure=inkLivePaint;
inkLivePaint=function(...args){inkLiveMeasure(...args);const now=performance.now();for(const t of inkLatency.queued.splice(0)){inkLatency.samples[inkLatency.count%inkLatency.samples.length]=now-t;inkLatency.count++;}};
function inkLatencyStats(){
  const n=Math.min(inkLatency.count,inkLatency.samples.length);if(!n)return null;
  const sorted=Array.from(inkLatency.samples.slice(0,n)).sort((a,b)=>a-b),at=q=>sorted[Math.min(n-1,Math.floor(q*n))];
  return {count:n,p50:at(.5),p95:at(.95),max:sorted[n-1]};
}
globalThis.appInk.latency=inkLatencyStats;
const inkJobsBase=showGPTJobs;
showGPTJobs=function(){inkJobsBase();const stats=inkLatencyStats();if(stats)dialog.querySelector('.dialog-inner .actions')?.insertAdjacentHTML('beforebegin',`<p class="small">${tr('필기 반응 (이 기기, 최근 {n}점): 입력→화면 표시 중앙값 {p50}ms · p95 {p95}ms · 최대 {max}ms',{n:stats.count,p50:stats.p50.toFixed(1),p95:stats.p95.toFixed(1),max:stats.max.toFixed(1)})}<br><span class="muted">${tr('펜 끝에서 화면까지의 지연은 별도 촬영으로 측정해야 합니다.')}</span></p>`);};

// PDF.js removes a page's ink canvas when it re-renders that page; the
// capture loss then goes to the document, so the stroke is finished here.
window.addEventListener('pointerup',event=>{const s=inkStroke;if(s&&event.pointerId===s.pointerId&&!s.canvas.isConnected){if(['shape','lasso','move'].includes(s.mode))inkGestureEnd();else inkFinish();}},true);
// A translation arriving in dual view scrolls its pane, and paired scrolling
// would move the page under the pen. While a stroke is drawn, and briefly
// after it, the pane being written on keeps its place. The reader's own
// scrolling ends that at once, or the panes would stay apart: a wheel turn,
// a key, a finger moving the page (touch writing off), the hand, the laser,
// the scroll bar or the toolbar.
let inkWritingUntil=0,inkWritingPane=null;
const inkScrollPairedBase=scrollPairedTo;
scrollPairedTo=function(container,top){if(container.inkDoc&&(inkStroke?.container===container||container===inkWritingPane&&performance.now()<inkWritingUntil))return;inkScrollPairedBase(container,top);};
const inkHoldsPane=event=>!!event.target?.closest?.('.app-ink-layer')&&!['read','hand','laser'].includes(inkState.tool)&&!inkFingerPans(event);
const inkHoldPane=event=>{inkWritingUntil=performance.now()+1500;inkWritingPane=event.target.closest('.translated-pages');};
const inkReleasePane=()=>{if(!inkStroke)inkWritingUntil=0;};
document.addEventListener('pointerup',event=>{if(inkHoldsPane(event))inkHoldPane(event);},true);
document.addEventListener('pointerdown',event=>{if(inkHoldsPane(event))inkHoldPane(event);else inkReleasePane();},true);
document.addEventListener('wheel',inkReleasePane,{capture:true,passive:true});
document.addEventListener('keydown',inkReleasePane,true);
