/* Notebook beside the paper: A4 pages (blank, lined, grid) with handwriting,
   text boxes, figure excerpts and source cards that open the cited page.
   Every ink tool works here as on PDF pages (pen, highlighter, eraser,
   shapes, lasso, hand, laser, page memo); edits share the ink undo stack.
   Page coordinates are points (595×842). */
const NB_W=595,NB_H=842;
// A whiteboard page (board: true) keeps its width and grows downward a sheet at a time (a sheet is the A4 proportion at
// its width) when something comes within NB_BOARD_ROOM of its bottom, up to a hundred A4 sheets (desktop/notebook.cjs).
const NB_BOARD_MAX=100*NB_H,NB_BOARD_ROOM=200,nbSheet=w=>Math.round(w*NB_H/NB_W*100)/100;
// The notebook's box tools are icons (the name shows on hover); adding pages stays as worded buttons.
// nbMemo is the same sheet as 메모 추가 in the reader's tool row (renderer.js memoAdd): one picture for a memo.
Object.assign(paths,{nbText:'M5 5h14 M12 5v14 M9 19h6',nbCard:'M4 5h16v14H4z M8 10h8 M8 14h5',nbMemo:'M4 4h16v10l-6 6H4z M20 14h-6v6 M8 9h8 M8 13h4',
  // The notebook's own menu (이름 바꾸기 · 삭제): a gear, so that it is not taken for the ⋯ of a page's menu or the row's ⋮.
  nbMenu:'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z'});
const nbTool=(action,label,symbol)=>`<button type="button" class="pdf-tool nb-tool" data-action="${action}" title="${label}" aria-label="${label}">${icon(symbol)}</button>`;
const nbWindow=new URLSearchParams(location.search).get('notebookWindow')==='1',nbDetached=new Set();
const nb={id:null,doc:null,list:[],saving:null,dirty:false,timer:null,status:'',assets:new Map(),key:null,sel:null};
function nbId(){return crypto.randomUUID?.()||Array.from(crypto.getRandomValues(new Uint8Array(16)),b=>b.toString(16).padStart(2,'0')).join('');}
const baseViewModesNb=viewModes;
viewModes=function(){return baseViewModesNb().replace(/(<button data-mode="dual"[^>]*>[^<]*<\/button>)/,`$1<button data-mode="notebook" class="${state.mode==='notebook'?'active':''}">${tr('노트북')}</button>`);};
const baseReaderNb=reader;
reader=function(){
  if(state.mode!=='notebook')return baseReaderNb();
  state.mode='dual';let html;try{html=baseReaderNb();}finally{state.mode='notebook';}
  return html.replace(/<section class="pdf-pane translated-pane"[\s\S]*?<\/section>/,()=>`<section class="pdf-pane notebook-pane" aria-label="${tr('노트북')}"><header class="pdf-pane-header"><strong>${tr('노트북')}</strong></header><div class="nb-body"><p class="small muted">${tr('불러오는 중…')}</p></div></section>`);
};
// Opening the notebook never starts a translation.
window.addEventListener('click',event=>{const b=event.target.closest('[data-mode="notebook"]');if(!b)return;event.stopImmediatePropagation();if(nb.id&&nbDetached.has(nb.id)&&nb.key===state.storageKey+':'+state.selected){runDesktop(()=>window.appApi.notebookWindow(state.storageKey,state.selected,nb.id))();toast(tr('이 노트북은 새 창에서 열려 있습니다.'));return;}state.mode='notebook';render();},true);
// When the notebook's window closes, this window reads its saved pages again.
window.appApi?.onNotebookWindowClosed?.(id=>{nbDetached.delete(id);if(nb.doc?.id!==id)return;nb.doc=null;nb.id=id;const body=document.querySelector('.notebook-pane .nb-body');if(body){delete body.dataset.mounted;runDesktop(nbMount)();}});
// The notebook window: only the notebook and the ink tools, for the vault open in the main window.
// Memos live with the vault's notes, which only the main window saves, so embedded memos are read here.
globalThis.appNotebookWindow=async params=>{
  document.body.classList.add('notebook-window');
  state.storageKey=params.get('vault');applySnapshot(await window.appApi.windowSnapshot(state.storageKey));
  const paperId=Number(params.get('paper'));state.selected=papers.some(p=>p.id===paperId)?paperId:null;state.screen='reader';state.mode='notebook';
  nb.key=state.storageKey+':'+state.selected;nb.vault=state.storageKey;nb.id=params.get('notebook');
  document.addEventListener('focusin',event=>{const field=event.target.closest?.('.nb-memo-card textarea,.nb-memo-card input,.nb-memo-card .cm-content');if(!field)return;field.blur();toast(tr('노트북 창에서는 메모를 읽기만 합니다. 메모는 본 창에서 편집하세요.'));},true);
  render=function(){
    if(!document.querySelector('.notebook-window-main'))app.innerHTML=`<main class="main notebook-window-main"><div class="reader-mode-toolbar">${inkToolbar()}</div><section class="pdf-pane notebook-pane" aria-label="${tr('노트북')}"><header class="pdf-pane-header"><strong>${tr('노트북')}</strong></header><div class="nb-body"><p class="small muted">${tr('불러오는 중…')}</p></div></section></main>`;
    else nbRender();
    runDesktop(nbMount)();
  };
  render();
};
const nbBaseRefresh=refreshTranslationPane;
refreshTranslationPane=function(){nbBaseRefresh();if(state.screen==='reader'&&state.mode==='notebook')runDesktop(nbMount)();};
async function nbMount(){
  const body=document.querySelector('.notebook-pane .nb-body');if(!body||body.dataset.mounted)return;body.dataset.mounted='true';
  const key=state.storageKey+':'+state.selected;
  if(nb.key!==key){await nbFlush().catch(()=>{});nb.key=key;nb.id=null;nb.doc=null;}
  nb.vault=state.storageKey;
  nb.list=await window.appApi.notebookList(state.storageKey);
  if(!nb.id){let saved=null;try{saved=localStorage.getItem('app-notebook-'+key);}catch{}nb.id=nb.list.find(n=>n.id===saved)?.id||nb.list.find(n=>n.paperId===state.selected)?.id||null;}
  if(nb.id&&nb.doc?.id!==nb.id)nb.doc=await window.appApi.notebookGet(state.storageKey,nb.id);
  nbRender();
}
function nbRender(){
  const pane=document.querySelector('.notebook-pane');if(!pane)return;
  const own=nb.list.filter(n=>n.paperId===state.selected),other=nb.list.filter(n=>n.paperId!==state.selected);
  pane.querySelector('header').innerHTML=`<strong>${tr('노트북')}</strong><select class="nb-select" aria-label="${tr('노트북 선택')}"><option value="">${tr('노트북 선택…')}</option>${own.length?`<optgroup label="${tr('이 자료',null,'notebook group')}">${own.map(n=>`<option value="${esc(n.id)}" ${n.id===nb.id?'selected':''}>${esc(n.title)}</option>`).join('')}</optgroup>`:''}${other.length?`<optgroup label="${tr('다른 자료·프로젝트')}">${other.map(n=>`<option value="${esc(n.id)}" ${n.id===nb.id?'selected':''}>${n.paperId===null?tr('{title} (프로젝트)',{title:esc(n.title)}):esc(n.title)}</option>`).join('')}</optgroup>`:''}</select><span class="nb-status" role="status" aria-live="polite">${esc(nb.status)}</span><button type="button" class="pdf-tool nb-icon" data-action="nb-new" title="${tr('새 노트북')}" aria-label="${tr('새 노트북')}">${icon('noteAdd')}</button>${nb.doc||!nbWindow?`<button type="button" class="pdf-tool nb-icon nb-save-menu" data-nb-save-menu aria-haspopup="menu" aria-expanded="false" title="${tr('저장 (PDF · Markdown)')}" aria-label="${tr('저장')}">${icon('download')}<span class="nb-caret" aria-hidden="true">${icon('chipDown')}</span></button>`:''}${!nbWindow&&nb.doc?`<button type="button" class="pdf-tool nb-icon nb-more" data-nb-menu aria-haspopup="menu" aria-expanded="false" title="${tr('이 노트북: 이름 바꾸기 · 삭제')}" aria-label="${tr('노트북 메뉴')}">${icon('nbMenu')}</button>`+paneWindowButton('notebook',tr('노트북'),'data-action="nb-window"'):''}`;
  const body=pane.querySelector('.nb-body');
  if(!nb.doc){nb.sel=null;body.innerHTML=`<div class="pdf-empty"><h3>${tr('자료를 보면서 쓸 노트북을 만드세요')}</h3><button class="primary" data-action="nb-new">${tr('새 노트북')}</button></div>`;return;}
  const pins=nbPinIndex(),keptScroll=body.querySelector('.nb-pages')?.scrollTop||0,keptLeft=body.querySelector('.nb-pages')?.scrollLeft||0;
  body.innerHTML=`<div class="nb-tools" role="toolbar" aria-label="${tr('노트북 도구')}">${nbTool('nb-text',tr('텍스트 상자'),'nbText')}${nbTool('nb-card',tr('출처 카드 — 원문의 현재 쪽과 선택한 문장으로'),'nbCard')}${nbTool('nb-figure',tr('그림으로 넣기 — 원문에서 영역을 골라'),'figure')}${nbTool('nb-memo',tr('메모 넣기 — 이 논문의 메모를 페이지에 임베드'),'nbMemo')}<span class="nb-tools-sep" aria-hidden="true"></span><button type="button" class="pdf-tool nb-tool" data-nb-add aria-haspopup="menu" aria-expanded="false" title="${tr('페이지 추가 — 양식과 크기를 고르거나 PDF에서 가져오기')}" aria-label="${tr('페이지 추가')}">${icon('pagePlus')}</button><span class="nb-page-nav"><button type="button" class="pdf-tool" data-nb-step="-1" aria-label="${tr('이전 페이지')}">‹</button><input class="nb-page-input" inputmode="numeric" aria-label="${tr('현재 쪽 번호')}" value="1"><span class="nb-page-total">${tr('의 {total}',{total:nb.doc.pages.length})}</span><button type="button" class="pdf-tool" data-nb-step="1" aria-label="${tr('다음 페이지')}">›</button></span></div><div class="nb-pages" style="--nb-zoom:${nbZoom}">${nb.doc.pages.map((page,i)=>`<div class="nb-page-wrap"><button type="button" class="row-more nb-page-more" data-nb-page-menu="${esc(page.id)}" aria-haspopup="menu" aria-expanded="false" title="${page.board?tr('이 화이트보드: 양식 · 복제 · 순서 · 빈 아래쪽 잘라내기 · 삭제'):tr('이 페이지: 양식 · 복제 · 순서 · 삭제')}" aria-label="${tr('{n}쪽 메뉴',{n:i+1})}">⋯</button><div class="nb-page" data-template="${page.template}" data-page-id="${esc(page.id)}" data-w="${page.width}" data-h="${page.height}"${page.board?' data-board="1"':''} style="aspect-ratio:${page.width}/${page.height};--nb-w:${page.width}">${page.background?`<img class="nb-bg" data-asset="${esc(page.background)}" alt="" draggable="false">`:''}${page.items.map(item=>nbItemHtml(item,page)).join('')}<canvas class="nb-ink" aria-hidden="true"></canvas>${nbPinsHtml(pins.get(page.id),page)}</div></div>`).join('')}${nbAddSameHtml()}</div>`;
  // A redraw (a template change, a box added) keeps the place in the pages.
  const list=body.querySelector('.nb-pages');nbEndSpace(); // before the place is restored: the room under the last page is part of how far the list scrolls
  if(list&&keptScroll)list.scrollTop=keptScroll;if(list&&keptLeft)list.scrollLeft=keptLeft;
  for(const el of body.querySelectorAll('.nb-page'))nbBindPage(el);nbMarkFocus();
  if(list){let queued=false;list.addEventListener('scroll',()=>{if(queued)return;queued=true;requestAnimationFrame(()=>{queued=false;nbPageNav();nbBoardsFollow();});});}nbPageNav();
  // Each page is watched: the pane's width and the zoom both change a page's size, and its ink is redrawn sharp.
  nbResize.disconnect();for(const el of body.querySelectorAll('.nb-page'))nbResize.observe(el);
  // The view's own height can change without any page's (a taller window): a whiteboard's band follows it.
  nbListResize.disconnect();if(list)nbListResize.observe(list);
  requestAnimationFrame(()=>{for(const el of body.querySelectorAll('.nb-page'))nbDrawPage(el);nbLoadAssets(body);nbSelectionDraw();});
}
const pct=(v,total)=>(v/total*100).toFixed(3)+'%';
// A text box's look: size in points, weight, slant, underline, colour and alignment (the whole box), and its fill and
// border (points, at the page's scale as the text is; the box keeps its size: border-box).
// Colours and the look go into the style only as checked (a notebook read from disk is not checked when read).
const nbTextStyle=item=>{const marks=globalThis.appInkMarks,color=marks.hexColor(item.color),{fill,border}=marks.textLook(item),size=Number.isFinite(item.size)?item.size:12;
  return `--nb-size:${size};${item.bold?'font-weight:700;':''}${item.italic?'font-style:italic;':''}${item.underline?'text-decoration:underline;':''}${color?`color:${color};`:''}${['center','right'].includes(item.align)?`text-align:${item.align};`:''}${fill?`background-color:${fill};`:''}${border?`border:calc(${border.width} * 100cqw / var(--nb-w,595)) ${border.style} ${border.color};`:''}`;};
function nbItemHtml(item,page={width:NB_W,height:NB_H}){
  const box=`left:${pct(item.x,page.width)};top:${pct(item.y,page.height)};width:${pct(item.w,page.width)};height:${pct(item.h,page.height)}`;
  const handle=`<span class="nb-resize" data-nb-resize aria-hidden="true"></span><button class="nb-remove" data-nb-remove aria-label="${tr('삭제')}" title="${tr('삭제 (Delete)')}">×</button>`;
  if(item.type==='text')return `<div class="nb-item nb-text" data-item-id="${esc(item.id)}" style="${box}" title="${tr('끌어서 옮기기 · 두 번 눌러 편집')}"><textarea aria-label="${tr('텍스트 상자')}" readonly tabindex="-1" style="${nbTextStyle(item)}">${esc(item.text)}</textarea>${nbMentionChips(item)}${handle}</div>`;
  if(item.type==='memo')return nbMemoCardHtml(item,page);
  if(item.type==='image')return `<figure class="nb-item nb-image" data-item-id="${esc(item.id)}" style="${box}"><img data-asset="${esc(item.asset)}" alt="${esc(item.source?tr('{title} {page}쪽 발췌',{title:item.source.title,page:item.source.page}):tr('그림 발췌'))}">${item.source?`<figcaption><button class="nb-source-link" data-nb-source="${item.source.page}" data-nb-paper="${item.source.paperId}" data-nb-attachment="${esc(item.source.attachmentId)}">${tr('{title} · {page}쪽 ↗',{title:esc(item.source.title),page:item.source.page})}</button></figcaption>`:''}${handle}</figure>`;
  return `<div class="nb-item nb-card" data-item-id="${esc(item.id)}" style="${box}"><button class="nb-source-link" data-nb-source="${item.source.page}" data-nb-paper="${item.source.paperId}" data-nb-attachment="${esc(item.source.attachmentId)}">${tr('<b>{title}</b> · {page}쪽 ↗',{title:esc(item.source.title),page:item.source.page})}</button>${item.quote?`<q>${esc(item.quote)}</q>`:''}${handle}</div>`;
}
async function nbLoadAssets(root){for(const img of root.querySelectorAll('img[data-asset]')){const hash=img.dataset.asset;if(!nb.assets.has(hash))nb.assets.set(hash,window.appApi.notebookAssetGet(state.storageKey,hash).catch(()=>''));img.src=await nb.assets.get(hash);}}
const nbPage=id=>nb.doc.pages.find(p=>p.id===id);
// Every change records the previous pages, so undo restores exactly.
function nbChange(label,mutate,extra){
  const before=JSON.stringify(nb.doc.pages);mutate();const grown=nb.doc.pages.filter(nbGrow),after=JSON.stringify(nb.doc.pages),id=nb.doc.id;
  if(before===after)return false;
  // A change past what a page holds (as many strokes or items as a notebook file takes) is not kept: it would make
  // every later save fail. It is said instead, and the page is as it was.
  const over=nb.doc.pages.find(p=>p.strokes.length>NB_MAX_STROKES||p.items.length>NB_MAX_ITEMS);
  if(over){const full=over.strokes.length>NB_MAX_STROKES;nb.doc.pages=JSON.parse(before);nbRender();toast(full?tr('한 쪽에는 필기를 {n}개까지 둘 수 있습니다. 다른 쪽에 이어 쓰세요.',{n:NB_MAX_STROKES.toLocaleString()}):tr('한 쪽에는 항목을 {n}개까지 둘 수 있습니다. 다른 쪽에 이어 넣으세요.',{n:NB_MAX_ITEMS.toLocaleString()}),6000);return false;}
  // A whiteboard that grew takes its new height where it is (its items, pins and band follow); nothing on it is drawn
  // again, so a stroke started or a box being edited since goes on. The growth is part of the change (one undo).
  for(const page of grown)nbBoardResized(page);
  // extra: what the same step did elsewhere (ink that left a PDF for this page), undone and done again with it.
  globalThis.appInk.record({custom:true,label,undo:()=>{if(nb.doc?.id!==id)return;extra?.undo();nb.sel=null;nb.doc.pages=JSON.parse(before);nbSave();nbRender();},redo:()=>{if(nb.doc?.id!==id)return;extra?.redo();nb.sel=null;nb.doc.pages=JSON.parse(after);nbSave();nbRender();}});
  nbSave();return true;
}
// What a page holds (desktop/notebook.cjs validNotebook): past it a save would be refused.
const NB_MAX_STROKES=20000,NB_MAX_ITEMS=2000;
// How far down a page's items, strokes and memo pins reach (points).
function nbContentBottom(page){let bottom=0;for(const item of page.items)bottom=Math.max(bottom,item.y+item.h);for(const st of page.strokes)bottom=Math.max(bottom,nbStrokeBox(st).y1);for(const pin of nbPinIndex().get(page.id)||[])bottom=Math.max(bottom,nbPinDown(page,pin.y)*page.height+12);return bottom;}
// A whiteboard's new height on screen, in place: the page keeps its element (and what is going on in it), its items and
// pins take their places at the new height, and its band is drawn again.
function nbBoardResized(page){
  const el=nbPageEl(page.id);if(!el)return;el.dataset.h=String(page.height);el.style.aspectRatio=`${page.width}/${page.height}`;
  for(const item of page.items){const node=el.querySelector(`:scope>[data-item-id="${CSS.escape(item.id)}"]`);if(!node)continue;node.style.top=pct(item.y,page.height);if(node.style.height)node.style.height=pct(item.type==='memo'?Math.max(item.h,90):item.h,page.height);}
  nbPaintPins(el,nbPinIndex());nbDrawPage(el);nbSelectionDraw();nbEndSpace();
}
// A whiteboard grows a sheet at a time until what is on it is NB_BOARD_ROOM above its bottom; at its longest it says so
// once, and an item cannot go below it.
function nbGrow(page){
  if(!page.board)return false;const bottom=nbContentBottom(page),sheet=nbSheet(page.width);let height=page.height;
  while(bottom>height-NB_BOARD_ROOM&&height<NB_BOARD_MAX)height=Math.min(NB_BOARD_MAX,Math.round((height+sheet)*100)/100);
  if(bottom>height-NB_BOARD_ROOM&&height>=NB_BOARD_MAX){for(const item of page.items)item.y=Math.min(item.y,NB_BOARD_MAX-item.h);page.strokes=page.strokes.map(st=>{const over=nbStrokeBox(st).y1-NB_BOARD_MAX;return over>0?nbMoved(st,([x,y])=>[x,y-over],1):st;});if(!nb.full?.has(page.id)){(nb.full||=new Set()).add(page.id);toast(tr('화이트보드가 가장 긴 길이(A4 100장)에 닿았습니다. 그 아래로는 늘어나지 않습니다.'),6000);}}
  if(height===page.height)return false;page.height=height;return true;
}
// 빈 아래쪽 잘라내기: the board ends NB_BOARD_ROOM under what is on it, a sheet at least.
function nbTrimBoard(page){const height=Math.max(nbSheet(page.width),Math.ceil(nbContentBottom(page)+NB_BOARD_ROOM));if(height>=page.height)return false;page.height=height;nb.full?.delete(page.id);return true;}
function nbSave(now=false){nb.dirty=true;nb.status=tr('저장 중…');nbStatus();clearTimeout(nb.timer);nb.timer=setTimeout(()=>nbFlush().catch(()=>{}),now?0:400);}
async function nbFlush(){
  clearTimeout(nb.timer);if(nb.saving)await nb.saving.catch(()=>{});if(!nb.dirty||!nb.doc)return;
  // Saved to the vault the notebook was opened from, even after another vault opened.
  nbSyncMemos();nb.dirty=false;const id=nb.vault||state.storageKey,doc=JSON.parse(JSON.stringify(nb.doc));
  nb.saving=window.appApi.notebookSave(id,doc).then(()=>{nb.status=nb.dirty?tr('저장 중…'):tr('✓ 노트북 저장됨');nbStatus();},error=>{if(id!==state.storageKey){nb.status=tr('이전 저장소가 닫혀 노트북 변경을 저장하지 못했습니다.');nbStatus();throw error;}nb.dirty=true;nb.status=tr('저장 실패: {error}',{error:shownError(error)});nbStatus();setTimeout(()=>nbFlush().catch(()=>{}),3000);throw error;}).finally(()=>{nb.saving=null;});
  return nb.saving;
}
function nbStatus(){const node=document.querySelector('.nb-status');if(node)node.textContent=nb.status;}
// A page's size in points (A4 unless it was added at another size or from a PDF).
const nbSize=el=>({w:Number(el?.dataset.w)||NB_W,h:Number(el?.dataset.h)||NB_H});
// The page's exact width (clientWidth is rounded: on a long whiteboard the rounding grows down the page).
function nbScale(el){return el.getBoundingClientRect().width/nbSize(el).w;}
// A page's drawing space; on a whiteboard, its band (below).
function nbViewport(el){const s=nbScale(el),b=el._band;return b?{width:el.clientWidth,height:b.height,transform:[s,0,0,s,0,-b.top],convertToViewportPoint:(x,y)=>[x*s,y*s-b.top]}:{width:el.clientWidth,height:el.clientHeight,transform:[s,0,0,s,0,0],convertToViewportPoint:(x,y)=>[x*s,y*s]};}
// A whiteboard's ink is drawn on a band around what is in view (the view's height above and below it, in CSS pixels
// of the page), not on one canvas the board's height: a canvas that tall is past what the browser draws, and its
// memory. The band moves, and is drawn again, when the view comes near its edge (nbBoardsFollow); a gesture's own
// preview is drawn on the band too (nbBandHost). Other pages draw whole, as before.
function nbBand(el){
  const list=el.closest('.nb-pages'),r=el.getBoundingClientRect(),v=list?list.getBoundingClientRect():{top:0,bottom:innerHeight},view=Math.max(1,v.bottom-v.top);
  const top=Math.max(0,Math.min(el.clientHeight-1,Math.floor(v.top-r.top-view))),bottom=Math.max(top+1,Math.min(el.clientHeight,Math.ceil(v.bottom-r.top+view)));
  return {top,height:bottom-top};
}
function nbBandHost(el){let host=el.querySelector(':scope>.nb-band');if(!host){host=document.createElement('div');host.className='nb-band';host.setAttribute('aria-hidden','true');el.append(host);}Object.assign(host.style,{top:el._band.top+'px',height:el._band.height+'px'});return host;}
function nbDrawPage(el){
  const page=nbPage(el.dataset.pageId);if(!page)return;const canvas=el.querySelector('.nb-ink'),dpr=Math.min(2,window.devicePixelRatio||1);
  if(page.board){el._band=nbBand(el);Object.assign(canvas.style,{top:el._band.top+'px',height:el._band.height+'px'});if(el.querySelector(':scope>.nb-band'))nbBandHost(el);}else el._band=null;
  canvas.width=Math.max(1,Math.round(el.clientWidth*dpr));canvas.height=Math.max(1,Math.round((el._band?.height??el.clientHeight)*dpr));
  nbPaint(el,page.strokes);
}
// On scrolling, a whiteboard whose band no longer holds the view with a margin (a quarter view) is drawn again.
function nbBoardsFollow(){
  for(const el of document.querySelectorAll('.notebook-pane .nb-page[data-board]')){
    const b=el._band;if(!b)continue;const want=nbBand(el),list=el.closest('.nb-pages'),margin=(list?.clientHeight||innerHeight)/4,r=el.getBoundingClientRect(),v=list?list.getBoundingClientRect():{top:0,bottom:innerHeight};
    const viewTop=Math.max(0,v.top-r.top),viewBottom=Math.min(el.clientHeight,v.bottom-r.top);if(viewBottom<=0||viewTop>=el.clientHeight)continue;
    if(viewTop-margin<b.top&&b.top>0||viewBottom+margin>b.top+b.height&&b.top+b.height<el.clientHeight||want.height>b.height*1.5)nbDrawPage(el);
  }
}
// Strokes drawn on a page's canvas (highlighters under the pen); `after` draws on top.
function nbPaint(el,strokes,after){
  const canvas=el.querySelector('.nb-ink'),dpr=canvas.width/Math.max(1,el.clientWidth),ctx=canvas.getContext('2d');ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,canvas.width,canvas.height);
  // On a whiteboard only the strokes that reach into the band (in page points, with their width) are drawn.
  const b=el._band,k=nbScale(el);if(b)strokes=strokes.filter(st=>{const box=nbStrokeBox(st);return box.y1*k>=b.top&&box.y0*k<=b.top+b.height;});
  for(const s of [...strokes].sort((a,b)=>(a.tool==='highlighter'?0:1)-(b.tool==='highlighter'?0:1)))globalThis.appInk.paint(ctx,s,nbViewport(el),dpr);
  after?.(ctx,dpr*nbScale(el));
}
// Page canvases follow the pane width (split handle, window size).
const nbResize=new ResizeObserver(entries=>{for(const e of entries)if(e.target.isConnected)nbDrawPage(e.target);nbSelectionDraw();nbPageNav();});
const nbListResize=new ResizeObserver(()=>nbBoardsFollow());
// ---- Zoom: Ctrl+wheel (or a trackpad pinch) around the pointer, Shift+wheel sideways; 50%–200%,
// where 100% is the pane's width. Pages, boxes and ink all scale with the page width; the zoom is
// kept on this computer. (No zoom buttons: the notebook's tool row stays as it was.)
let nbZoom=(()=>{try{const z=Number(localStorage.getItem('app-nb-zoom'));return z>=.5&&z<=2?z:1;}catch{return 1;}})();
function nbSetZoom(next,at){
  const list=document.querySelector('.notebook-pane .nb-pages');next=Math.round(Math.max(.5,Math.min(2,next))*100)/100;if(!list||next===nbZoom)return;
  const box=list.getBoundingClientRect(),x=at?at[0]-box.left:list.clientWidth/2,y=at?at[1]-box.top:list.clientHeight/2,fx=(list.scrollLeft+x)/list.scrollWidth,fy=(list.scrollTop+y)/list.scrollHeight;
  nbZoom=next;try{localStorage.setItem('app-nb-zoom',String(next));}catch{}
  list.style.setProperty('--nb-zoom',next);list.scrollLeft=fx*list.scrollWidth-x;list.scrollTop=fy*list.scrollHeight-y;
}
let nbWheel=null;
document.addEventListener('wheel',event=>{
  const list=event.target.closest?.('.notebook-pane .nb-pages');if(!list)return;
  if(event.shiftKey){event.preventDefault();list.scrollLeft+=event.deltaX||event.deltaY;return;}
  if(!event.ctrlKey&&!event.metaKey)return;event.preventDefault();
  // Several wheel events in one frame are applied once, around where the pointer is.
  nbWheel||={z:nbZoom,at:[event.clientX,event.clientY]};nbWheel.z*=Math.exp(-event.deltaY*(event.deltaMode===1?.05:.002));
  if(nbWheel.queued)return;nbWheel.queued=true;requestAnimationFrame(()=>{const w=nbWheel;nbWheel=null;nbSetZoom(w.z,w.at);});
},{passive:false});
let nbPointer=null,nbLastPress={},nbFocus=null;
// The box pressed last is marked (outline and corner) until a press elsewhere.
function nbMarkFocus(){document.querySelectorAll('.nb-item.nb-focused').forEach(n=>n.classList.remove('nb-focused'));if(nbFocus)document.querySelector(`.nb-item[data-item-id="${CSS.escape(nbFocus)}"]`)?.classList.add('nb-focused');}
// Delete (or Backspace) removes the box pressed last, unless a text is being typed or a lasso selection is up.
function nbRemoveItem(id){if(!nb.doc||!id)return;nbChange('삭제',()=>{for(const page of nb.doc.pages)page.items=page.items.filter(i=>i.id!==id);});if(nbFocus===id)nbFocus=null;nbRender();} // i18n:keep — the undo label (not shown)
document.addEventListener('keydown',event=>{if(!['Delete','Backspace'].includes(event.key)||event.defaultPrevented||!nbFocus||nb.sel||dialog.open||event.target.closest?.('input,textarea,select,[contenteditable="true"],.cm-editor'))return;if(!document.querySelector(`.nb-item[data-item-id="${CSS.escape(nbFocus)}"]`)){nbFocus=null;return;}event.preventDefault();nbRemoveItem(nbFocus);});
document.addEventListener('pointerdown',event=>{if(nbFocus&&!event.target.closest?.('.nb-item')){nbFocus=null;nbMarkFocus();}},true);
// A box pressed (to move, resize or delete it) is the one thing chosen: a selection here or on a PDF page is let go.
function nbFocusBox(id){nbFocus=id;if(nb.sel)nbSelect(null);globalThis.appInk.clearSelection();nbMarkFocus();}
// A selection or text box chosen on a PDF page lets go of the notebook's (desktop/ink.js inkSelectOnly).
globalThis.appInk.onSelect=()=>{if(nb.sel)nbSelect(null);if(nbFocus){nbFocus=null;nbMarkFocus();}};
// Ink dragged off a PDF page beside the notebook (desktop/ink.js inkDrop): the notebook page under the pointer, the ink
// shown there while it is dragged, and the ink taken onto the page when it is let go (with the PDF's side as one undo).
let nbGhost=null;
globalThis.appInk.nb={
  at(cx,cy){
    if(state.screen!=='reader'||state.mode!=='notebook'||!nb.doc)return null;
    const el=document.elementsFromPoint(cx,cy).map(n=>n.closest?.('.nb-page')).find(Boolean),page=el&&nbPage(el.dataset.pageId);
    return page?{el,pageId:page.id,width:page.width,height:page.height,rect:el.getBoundingClientRect()}:null;
  },
  preview(t,made){
    if(nbGhost&&nbGhost!==t?.el){if(nbGhost.isConnected){nbGhost.querySelectorAll(':scope>.nb-ghost').forEach(n=>n.remove());nbDrawPage(nbGhost);}nbGhost=null;}
    const page=t&&nb.doc&&nbPage(t.pageId);if(!page||!t.el.isConnected)return;
    nbGhost=t.el;nbPaint(t.el,[...page.strokes,...made.strokes]);t.el.querySelectorAll(':scope>.nb-ghost').forEach(n=>n.remove());
    t.el.insertAdjacentHTML('beforeend',made.items.map(item=>`<div class="nb-ghost" style="left:${pct(item.x,page.width)};top:${pct(item.y,page.height)};width:${pct(item.w,page.width)};height:${pct(item.h,page.height)}"></div>`).join(''));
  },
  take(t,strokes,items,extra){
    const page=nb.doc&&nbPage(t.pageId);if(!page||!strokes.length&&!items.length)return false;
    const kept=nbChange('옮기기',()=>{page.strokes.push(...strokes);page.items.push(...items);},extra)===true; // i18n:keep
    if(kept&&t.el.isConnected)nbRefreshPage(t.el);
    return kept;
  },
};
function nbPoint(el,event){const r=el.getBoundingClientRect(),{w,h}=nbSize(el);return [(event.clientX-r.left)/r.width*w,(event.clientY-r.top)/r.height*h];}
function nbBindPage(el){
  el.addEventListener('pointerdown',event=>{
    const ink=globalThis.appInk,tool=event.buttons&32?'eraser':ink.tool;
    // A box's grip and corner move and resize it with any tool, also while its text is being edited.
    const boxGrip=event.button===0&&event.target.closest('.nb-item [data-nb-resize]');
    if(boxGrip){const item=boxGrip.closest('.nb-item');event.preventDefault();event.stopPropagation();nbFocusBox(item.dataset.itemId);el.setPointerCapture(event.pointerId);nbPointer={kind:'resize',el,id:item.dataset.itemId,start:nbPoint(el,event),node:item,pointerId:event.pointerId};return;}
    if(event.target.closest('textarea,button,input,.note-box,.nb-memo-read'))return;
    if(event.pointerType==='touch'&&!ink.penLike(event)&&nbPointer)return;
    const at=nbPoint(el,event),sel=nb.sel?.pageId===el.dataset.pageId?nb.sel:null,touchPans=ink.fingerPans(event);
    // A lasso selection: its corner scales it, the hand moves it from
    // anywhere on its page and the lasso from inside it.
    const grip=sel&&event.button===0&&(event.target.closest('.ink-handle')?'scale':!touchPans&&(tool==='hand'||tool==='lasso'&&nbInBox(sel.box,at))?'shift':null);
    if(grip){event.preventDefault();el.setPointerCapture(event.pointerId);document.body.classList.add('ink-grabbing');nbPointer={kind:grip,el,start:at,last:at,client:[event.clientX,event.clientY],pointerId:event.pointerId};return;}
    // Select tool: a press on a pen stroke or shape (boxes come first) selects it, or keeps the selection it is in, and
    // the same press drags it, as on PDF pages; a press on nothing lets go of the selection.
    if(tool==='read'&&!event.target.closest('.nb-item')){
      if(event.button!==0||touchPans)return;const stroke=nbStrokeAt(el,nbPage(el.dataset.pageId),at);
      if(!stroke){if(nb.sel)nbSelect(null);return;}
      event.preventDefault();if(!sel?.strokes.includes(stroke.id))nbSelect({pageId:el.dataset.pageId,strokes:[stroke.id],items:[]});
      // A tap selects: nothing moves until the pointer has gone a few pixels.
      el.setPointerCapture(event.pointerId);document.body.classList.add('ink-grabbing');nbPointer={kind:'shift',el,start:at,last:at,client:[event.clientX,event.clientY],slop:4/nbScale(el),pointerId:event.pointerId};return;
    }
    // Select tool: drag a box (or its corner) to move or resize it.
    if(tool==='read'){const item=event.target.closest('.nb-item');if(!item||event.button!==0)return;nbFocusBox(item.dataset.itemId);
      // A second press on the same text box soon after the first edits it (the drag's pointer capture hides
      // the dblclick event, and a pointer event's detail does not count clicks).
      if(item.classList.contains('nb-text')){const now=performance.now(),again=nbLastPress.id===item.dataset.itemId&&now-nbLastPress.at<450;nbLastPress={id:item.dataset.itemId,at:now};if(again){event.preventDefault();nbLastPress={};nbEditText(item);return;}}event.preventDefault();el.setPointerCapture(event.pointerId);nbPointer={kind:event.target.closest('[data-nb-resize]')?'resize':'move',el,id:item.dataset.itemId,start:nbPoint(el,event),client:[event.clientX,event.clientY],node:item,pointerId:event.pointerId};return;}
    // A finger moves the pages unless touch writing is on; so does the hand.
    if(touchPans||tool==='hand'){const list=el.closest('.nb-pages');let y=event.clientY,x=event.clientX;el.setPointerCapture(event.pointerId);const move=e=>{if(e.pointerId!==event.pointerId)return;list.scrollBy(x-e.clientX,y-e.clientY);x=e.clientX;y=e.clientY;},up=e=>{if(e.pointerId!==event.pointerId)return;el.removeEventListener('pointermove',move);el.removeEventListener('pointerup',up);el.removeEventListener('pointercancel',up);};el.addEventListener('pointermove',move);el.addEventListener('pointerup',up);el.addEventListener('pointercancel',up);return;}
    if(event.button!==0&&!(event.buttons&32))return;
    // On a whiteboard the pointer's trail is drawn on its band, as its ink is.
    if(tool==='laser'){const host=el._band?nbBandHost(el):el;ink.laser({div:host,viewport:{width:host.clientWidth,height:host.clientHeight}},el,event);return;}
    // The page memo writes in a text box: the one under the pointer, or a new one there.
    if(tool==='text'){event.preventDefault();nbMemo(el,at);return;}
    // The memo tool puts a new memo of the paper here, embedded, and opens it to write.
    if(tool==='memo'){event.preventDefault();nbMemoAt(el,at);return;}
    if(!['pen','highlighter','eraser','shape','lasso'].includes(tool))return;
    event.preventDefault();el.setPointerCapture(event.pointerId);
    if(tool==='lasso'){nbSelect(null);nbPointer={kind:'lasso',el,path:[at],pointerId:event.pointerId};return;}
    if(tool==='shape'){nbPointer={kind:'shape',el,start:at,last:at,shift:event.shiftKey,pointerId:event.pointerId};return;}
    nbPointer={kind:tool==='eraser'?'erase':'draw',el,tool,partial:tool==='eraser'&&ink.eraser==='partial',start:event.timeStamp,points:[],erased:new Set(),cut:new Map(),pointerId:event.pointerId,device:['pen','mouse','touch'].includes(event.pointerType)?event.pointerType:undefined};nbMove(event);
  });
  el.addEventListener('pointermove',event=>{if(nbPointer?.pointerId===event.pointerId&&nbPointer.el===el)nbMove(event);else if(!nbPointer)nbHover(el,event);});
  el.addEventListener('pointerleave',()=>el.classList.remove('ink-over-selection'));
  for(const type of ['pointerup','pointercancel','lostpointercapture'])el.addEventListener(type,event=>{if(nbPointer?.pointerId===event.pointerId&&nbPointer.el===el){if(type==='pointerup')nbMove(event);nbEnd();}});
}
function nbMove(event){
  const p=nbPointer;if(!p)return;const page=nbPage(p.el.dataset.pageId);if(!page)return;
  if(p.kind==='move'){const [x,y]=nbPoint(p.el,event),item=page.items.find(i=>i.id===p.id);if(!item)return;p.dx=x-p.start[0];p.dy=y-p.start[1];p.client=[event.clientX,event.clientY];
    p.plan=nbDrop(p.el,nbItemBox(item),[p.dx,p.dy],p.client);nbPlaceNode(p.node,item,p.plan);return;}
  if(p.kind==='resize'){const [x,y]=nbPoint(p.el,event),item=page.items.find(i=>i.id===p.id);if(!item)return;p.dx=x-p.start[0];p.dy=y-p.start[1];
    const nx=item.x,ny=item.y,nw=Math.max(20,item.w+p.dx),nh=Math.max(16,item.h+p.dy);
    Object.assign(p.node.style,{left:pct(nx,page.width),top:pct(ny,page.height)},p.node.matches('.nb-memo-card:not(.open)')?{width:pct(nw,page.width)}:{width:pct(nw,page.width),height:pct(nh,page.height)});return;}
  if(p.kind==='shape'){p.last=nbPoint(p.el,event);p.shift=event.shiftKey;nbLive(p).request();return;}
  if(p.kind==='lasso'){p.path.push(nbPoint(p.el,event));nbLive(p).request();return;}
  if(p.kind==='shift'||p.kind==='scale'){p.last=nbPoint(p.el,event);p.client=[event.clientX,event.clientY];if(p.slop&&!p.moved){if(Math.hypot(p.last[0]-p.start[0],p.last[1]-p.start[1])<p.slop)return;p.moved=true;}if(!p.frame)p.frame=requestAnimationFrame(()=>{p.frame=null;nbSelectionPreview(p,page);});return;}
  for(const e of event.getCoalescedEvents?.().length?event.getCoalescedEvents():[event]){
    const [x,y]=nbPoint(p.el,e);
    // Shift draws pen and highlighter like a ruler, as on PDF pages.
    if(p.kind==='draw'&&e.shiftKey)p.ruler=true;
    if(p.ruler){globalThis.appInk.ruler(p.points,Math.round(x*100)/100,Math.round(y*100)/100,Math.max(0,Math.round(e.timeStamp-p.start)));continue;}
    // The partial eraser cuts out the points it touches; the rest stays.
    if(p.kind==='erase'){const r=8/nbScale(p.el);for(const s of page.strokes){if(p.erased.has(s.id))continue;const reach=r+(s.tool==='highlighter'?s.width:s.width*1.6)/2;for(let i=0;i<s.points.length;i+=4)if(Math.hypot(s.points[i]-x,s.points[i+1]-y)<=reach){if(!p.partial){p.erased.add(s.id);break;}let cut=p.cut.get(s.id);if(!cut)p.cut.set(s.id,cut=new Set());cut.add(i);}}continue;}
    p.points.push(Math.round(x*100)/100,Math.round(y*100)/100,Math.round((e.pointerType==='pen'&&e.pressure>0?Math.min(1,e.pressure):.5)*1000)/1000,Math.max(0,Math.round(e.timeStamp-p.start)));
  }
  if(p.kind==='erase'){if(p.erased.size||p.cut.size)nbDrawPreview(p,page);return;}
  nbLive(p).request();
}
// The stroke, shape or lasso loop in progress: drawn by the ink layer's shared live preview, as on PDF
// pages (its own canvas over the page, ended with the gesture); the page's saved strokes stay as drawn.
const nbLive=p=>p.live||=globalThis.appInk.livePreview(p.el._band?nbBandHost(p.el):p.el,()=>nbViewport(p.el),(ctx,k)=>nbLivePaint(p,ctx,k));
function nbLivePaint(p,ctx,k){
  const ink=globalThis.appInk,vp=nbViewport(p.el);
  if(p.kind==='draw'&&p.points.length)ink.paint(ctx,{tool:p.tool,color:ink.color[p.tool],width:ink.width[p.tool],points:p.points},vp,k);
  else if(p.kind==='shape')ink.paint(ctx,nbShape(p),vp,k);
  // The lasso loop, dashed.
  else if(p.kind==='lasso'){const s=nbScale(p.el),px=1/s;ctx.setTransform(k*s,0,0,k*s,0,-k*(p.el._band?.top||0));ctx.lineWidth=1.5*px;ctx.strokeStyle='#2563eb';ctx.setLineDash([5*px,4*px]);ctx.beginPath();p.path.forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));ctx.closePath();ctx.stroke();}
}
// The eraser shows the page without what it has taken so far (the page itself is redrawn).
function nbDrawPreview(p,page){
  if(nbPointer!==p)return; // the gesture has ended: its result is already drawn
  const ink=globalThis.appInk;nbPaint(p.el,page.strokes.filter(s=>!p.erased?.has(s.id)).flatMap(s=>p.cut?.has(s.id)?ink.pieces(s,p.cut.get(s.id)):[s]));
}
function nbEnd(){
  const p=nbPointer;nbPointer=null;if(!p)return;const pageId=p.el.dataset.pageId;
  // Whatever the gesture, its preview ends with it.
  p.live?.end();if(p.frame)cancelAnimationFrame(p.frame);
  if(p.kind==='move'||p.kind==='resize'){if(!p.dx&&!p.dy){if(p.kind==='move'&&p.node?.matches('.nb-memo-card:not(.open)'))nbMemoOpen(p.id);return;}
    // A box moved onto another page becomes that page's (one undo step for both pages).
    const plan=p.kind==='move'?p.plan:null,onto=plan&&plan.el!==p.el;
    nbChange(p.kind==='move'?'이동':'크기',()=>{const from=nbPage(pageId),item=from.items.find(i=>i.id===p.id);if(!item)return;if(plan){const to=plan.page,[x,y]=plan.map([item.x,item.y]);item.x=nbClamp(Math.round(x),0,Math.max(0,Math.floor(to.width-item.w)));item.y=nbClamp(Math.round(y),0,Math.max(0,Math.floor(to.height-item.h)));if(onto){from.items=from.items.filter(i=>i!==item);to.items.push(item);}}else{item.w=Math.round(Math.max(20,item.w+p.dx));item.h=Math.round(Math.max(16,item.h+p.dy));}}); // i18n:keep — the undo label (not shown)
    if(onto){nbRefreshPage(p.el);nbRefreshPage(plan.el);nbMarkFocus();}else nbSelectionDraw();return;}
  if(p.kind==='erase'){if(p.erased.size||p.cut.size)nbChange('지우기',()=>{const page=nbPage(pageId);page.strokes=page.strokes.flatMap(s=>p.erased.has(s.id)?[]:p.cut.has(s.id)?globalThis.appInk.pieces(s,p.cut.get(s.id)).map(piece=>({...piece,id:nbId()})):[s]);});nbSave(true);nbDrawPage(p.el);return;} // i18n:keep — the undo label (not shown)
  if(p.kind==='lasso'){
    nbDrawPage(p.el);const page=nbPage(pageId),inside=globalThis.appInk.inside,centre=b=>[(b.x0+b.x1)/2,(b.y0+b.y1)/2];if(!page||p.path.length<3)return;
    const strokes=page.strokes.filter(st=>inside(p.path,centre(nbStrokeBox(st)))).map(st=>st.id),items=page.items.filter(i=>inside(p.path,centre(nbItemBox(i)))).map(i=>i.id);
    if(!strokes.length&&!items.length)return;
    nbSelect({pageId,strokes,items});toast(tr('{n}개를 선택했습니다. 끌어서 옮기고, 모서리로 크기를 바꾸고, 위의 막대로 복제·삭제합니다(Ctrl+D·Delete).',{n:strokes.length+items.length}));return;
  }
  if(p.kind==='shift'||p.kind==='scale'){
    document.body.classList.remove('ink-grabbing');const sel=nb.sel;
    if(!sel){for(const el of new Set([p.el,p.shown].filter(Boolean)))if(el.isConnected)nbRefreshPage(el);return;}
    if(p.slop&&!p.moved){nbRefreshPage(p.el);return;}
    const plan=p.kind==='shift'?nbDrop(p.el,sel.box,[p.last[0]-p.start[0],p.last[1]-p.start[1]],p.client):null,{map,k}=plan?{map:plan.map,k:1}:nbSelMap(p);
    // Every page the drag drew on is drawn again from what it holds.
    const refresh=()=>{for(const el of new Set([p.el,p.shown,plan?.el].filter(Boolean)))nbRefreshPage(el);};
    if(p.kind==='shift'?Math.hypot(p.last[0]-p.start[0],p.last[1]-p.start[1])<1:Math.abs(k-1)<.01){refresh();return;}
    // Moved onto another page, the selection becomes that page's (one undo step for both pages).
    const onto=plan&&plan.el!==p.el?plan.page:null;
    nbChange(p.kind==='shift'?'이동':'크기',()=>{const page=nbPage(pageId),to=onto||page; // i18n:keep — the undo label (not shown)
      if(!onto){page.strokes=page.strokes.map(st=>sel.strokes.includes(st.id)?nbMoved(st,map,k):st);page.items=page.items.map(i=>sel.items.includes(i.id)?nbMovedItem(i,map,k,page):i);return;}
      to.strokes.push(...page.strokes.filter(st=>sel.strokes.includes(st.id)).map(st=>nbMoved(st,map,1)));to.items.push(...page.items.filter(i=>sel.items.includes(i.id)).map(i=>nbMovedItem(i,map,1,to)));
      page.strokes=page.strokes.filter(st=>!sel.strokes.includes(st.id));page.items=page.items.filter(i=>!sel.items.includes(i.id));});
    if(onto)nb.sel={...sel,pageId:onto.id};refresh();return;
  }
  if(p.kind==='shape'){if(Math.hypot(p.last[0]-p.start[0],p.last[1]-p.start[1])<3){nbDrawPage(p.el);return;}nbChange('도형',()=>nbPage(pageId).strokes.push({id:nbId(),...nbShape(p)}));nbSave(true);nbDrawPage(p.el);return;} // i18n:keep — the undo label (not shown)
  if(!p.points.length)return;const ink=globalThis.appInk;
  // Held still before lifting, a pen stroke becomes the shape it is close to
  // and a highlighter stroke a straight line, as on PDF pages.
  const held=ink.heldShape(p.tool,p.points,p.start);
  nbChange(held?'도형':'필기',()=>nbPage(pageId).strokes.push({id:nbId(),tool:p.tool,color:ink.color[p.tool],width:ink.width[p.tool],points:held?held.points:p.points,...(held?{shape:held.shape}:{}),...(p.device?{device:p.device}:{})}));nbSave(true);nbDrawPage(p.el); // i18n:keep — the undo label (not shown)
}
// A shape dragged on a notebook page: a pen stroke through its corners.
function nbShape(p){const ink=globalThis.appInk;return {tool:'pen',shape:ink.shape,color:ink.color.pen,width:ink.width.pen,points:ink.shapePoints(ink.shape,p.start,p.shift?ink.constrain(ink.shape,p.start,p.last):p.last).flatMap(q=>[Math.round(q[0]*100)/100,Math.round(q[1]*100)/100,.5,0])};}
// ---- Lasso selection on a page: strokes and boxes, moved, scaled,
// duplicated, deleted or recoloured as one undo step each ----
const nbPageEl=id=>document.querySelector(`.nb-page[data-page-id="${CSS.escape(id)}"]`);
const nbInBox=(b,[x,y])=>x>=b.x0&&x<=b.x1&&y>=b.y0&&y<=b.y1;
// A stroke's box in page points, its width around it; kept per stroke (an edit makes a new stroke), as a whiteboard asks for it on every redraw.
const nbBoxes=new WeakMap();
function nbStrokeBox(st){const kept=nbBoxes.get(st);if(kept)return kept;const box=nbStrokeBoxOf(st);nbBoxes.set(st,box);return box;}
function nbStrokeBoxOf(st){let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;for(let i=0;i<st.points.length;i+=4){x0=Math.min(x0,st.points[i]);x1=Math.max(x1,st.points[i]);y0=Math.min(y0,st.points[i+1]);y1=Math.max(y1,st.points[i+1]);}const pad=(st.tool==='highlighter'?st.width:st.width*1.6)/2;return {x0:x0-pad,y0:y0-pad,x1:x1+pad,y1:y1+pad};}
const nbItemBox=i=>({x0:i.x,y0:i.y,x1:i.x+i.w,y1:i.y+i.h});
function nbSelect(sel){nb.sel=sel;if(sel){globalThis.appInk.clearSelection();if(nbFocus){nbFocus=null;nbMarkFocus();}}nbSelectionDraw();}
// The selection box is measured from the page each time it is drawn, so an
// undo, a box moved with the reading tool or a redraw never leaves it stale.
function nbSelectionDraw(){
  document.querySelectorAll('.nb-selection').forEach(n=>n.remove());const sel=nb.sel;if(!sel)return;
  const el=nbPageEl(sel.pageId),page=nbPage(sel.pageId);if(!el||!page){nb.sel=null;return;}
  sel.strokes=sel.strokes.filter(id=>page.strokes.some(st=>st.id===id));sel.items=sel.items.filter(id=>page.items.some(i=>i.id===id));
  const boxes=[...page.strokes.filter(st=>sel.strokes.includes(st.id)).map(nbStrokeBox),...page.items.filter(i=>sel.items.includes(i.id)).map(nbItemBox)];if(!boxes.length){nb.sel=null;return;}
  const b=sel.box={x0:Math.min(...boxes.map(b=>b.x0))-4,y0:Math.min(...boxes.map(b=>b.y0))-4,x1:Math.max(...boxes.map(b=>b.x1))+4,y1:Math.max(...boxes.map(b=>b.y1))+4};
  const box=document.createElement('div');box.className='nb-selection';Object.assign(box.style,{left:pct(b.x0,page.width),top:pct(b.y0,page.height),width:pct(b.x1-b.x0,page.width),height:pct(b.y1-b.y0,page.height)});
  box.innerHTML=`<span class="ink-handle" title="${tr('크기 조절')}"></span><div class="ink-selection-actions${b.y0<40?' below':''}" role="toolbar" aria-label="${tr('선택한 필기')}"><button type="button" data-nb-selection="duplicate">${tr('복제')}</button><button type="button" data-nb-selection="delete">${tr('삭제')}</button></div>`;
  el.append(box);
}
// A drag maps page points: moved by the drag, or scaled from the top-left
// corner with the drag projected on the box's diagonal (as on PDF pages).
function nbSelMap(p){
  const b=nb.sel.box;if(p.kind==='shift'){const dx=p.last[0]-p.start[0],dy=p.last[1]-p.start[1];return {k:1,map:([x,y])=>[x+dx,y+dy]};}
  const k=globalThis.appInk.scaleFactor(b,p.start,p.last);return {k,map:([x,y])=>[b.x0+(x-b.x0)*k,b.y0+(y-b.y0)*k]};
}
const nbRound=n=>Math.round(n*100)/100,nbClamp=(n,lo,hi)=>Math.min(hi,Math.max(lo,n));
function nbMoved(st,map,k){const points=[...st.points];for(let i=0;i<points.length;i+=4){const [x,y]=map([points[i],points[i+1]]);points[i]=nbRound(x);points[i+1]=nbRound(y);}return {...st,points,...(k===1?{}:{width:nbClamp(nbRound(st.width*k),.1,100)})};}
function nbMovedItem(item,map,k,page){const [x,y]=map([item.x,item.y]);return {...item,x:nbClamp(Math.round(x),-2000,4000),y:nbClamp(Math.round(y),-2000,page?.board?NB_BOARD_MAX:4000),w:nbClamp(Math.round(item.w*k),1,4000),h:nbClamp(Math.round(item.h*k),1,4000),...(item.type==='text'&&k!==1?{size:nbClamp(Math.round((item.size||12)*k*10)/10,6,72),...(item.border?{border:{...item.border,width:nbClamp(Math.round(item.border.width*k*10)/10,.5,6)}}:{})}:{})};}
// Where something dragged on a notebook page lands: on the page under the pointer (the nearest page when it is over
// none), its box (points of the page it is on, moved by the drag d) taken there through the screen and kept inside that
// page (its top-left kept when it is larger), so what is moved never ends up off a page, where nothing shows it. What
// is moved keeps its size in points. Returns the page's element and data, the box there, and map() for points.
function nbDrop(el,box,[dx,dy],[cx,cy]){
  let target=el,best=Infinity;
  for(const other of el.closest('.nb-pages')?.querySelectorAll('.nb-page')||[]){const r=other.getBoundingClientRect(),d=Math.hypot(Math.max(r.left-cx,0,cx-r.right),Math.max(r.top-cy,0,cy-r.bottom));if(d<best&&nbPage(other.dataset.pageId)){best=d;target=other;if(!d)break;}}
  const page=nbPage(target.dataset.pageId),a=el.getBoundingClientRect(),b=target.getBoundingClientRect(),s=nbSize(el),w=box.x1-box.x0,h=box.y1-box.y0;
  const x0=(a.left+(box.x0+dx)/s.w*a.width-b.left)/b.width*page.width,y0=(a.top+(box.y0+dy)/s.h*a.height-b.top)/b.height*page.height;
  const nx=w>=page.width?0:nbClamp(x0,0,page.width-w),ny=h>=page.height?0:nbClamp(y0,0,page.height-h),ox=nx-box.x0,oy=ny-box.y0;
  return {el:target,page,box:{x0:nx,y0:ny,x1:nx+w,y1:ny+h},map:([x,y])=>[x+ox,y+oy]};
}
// A box's element put where a drag will land it (nbDrop), on that page; a folded memo card keeps its own height.
function nbPlaceNode(node,item,plan){
  if(!node)return;const m=nbMovedItem(item,plan.map,1,plan.page),page=plan.page;if(node.parentElement!==plan.el)plan.el.querySelector(':scope>.nb-ink').before(node);
  Object.assign(node.style,{left:pct(m.x,page.width),top:pct(m.y,page.height),width:pct(m.w,page.width)},node.matches('.nb-memo-card:not(.open)')?{}:{height:pct(m.h,page.height)});
}
function nbSelectionPreview(p,page){
  const sel=nb.sel;
  // The selection let go of mid-drag (Esc, undo): every page the drag drew on is drawn again from what it holds.
  if(!sel){for(const el of new Set([p.el,p.shown].filter(Boolean)))if(el.isConnected)nbRefreshPage(el);p.shown=null;return;}
  // A lasso selection being moved is drawn where it will land: its strokes on that page's canvas (not on the page
  // they were on), its boxes and the selection's box on that page.
  if(p.kind==='shift'){
    const plan=nbDrop(p.el,sel.box,[p.last[0]-p.start[0],p.last[1]-p.start[1]],p.client),list=p.el.closest('.nb-pages')||document;
    if(p.shown&&p.shown!==plan.el&&p.shown!==p.el)nbDrawPage(p.shown);p.shown=plan.el;
    if(plan.el===p.el)nbPaint(p.el,page.strokes.map(st=>sel.strokes.includes(st.id)?nbMoved(st,plan.map,1):st));
    else{nbPaint(p.el,page.strokes.filter(st=>!sel.strokes.includes(st.id)));nbPaint(plan.el,[...plan.page.strokes,...page.strokes.filter(st=>sel.strokes.includes(st.id)).map(st=>nbMoved(st,plan.map,1))]);}
    for(const item of page.items)if(sel.items.includes(item.id))nbPlaceNode(list.querySelector(`.nb-item[data-item-id="${CSS.escape(item.id)}"]`),item,plan);
    const box=list.querySelector('.nb-selection'),b=plan.box;if(box){if(box.parentElement!==plan.el)plan.el.append(box);Object.assign(box.style,{left:pct(b.x0,plan.page.width),top:pct(b.y0,plan.page.height),width:pct(b.x1-b.x0,plan.page.width),height:pct(b.y1-b.y0,plan.page.height)});}
    return;
  }
  const {map,k}=nbSelMap(p);
  nbPaint(p.el,page.strokes.map(st=>sel.strokes.includes(st.id)?nbMoved(st,map,k):st));
  for(const item of page.items)if(sel.items.includes(item.id)){const node=p.el.querySelector(`[data-item-id="${CSS.escape(item.id)}"]`),m=nbMovedItem(item,map,k,page);if(node)Object.assign(node.style,{left:pct(m.x,page.width),top:pct(m.y,page.height),width:pct(m.w,page.width),height:pct(m.h,page.height)});}
  const box=p.el.querySelector('.nb-selection'),b=sel.box,[x0,y0]=map([b.x0,b.y0]),[x1,y1]=map([b.x1,b.y1]);if(box)Object.assign(box.style,{left:pct(x0,page.width),top:pct(y0,page.height),width:pct(x1-x0,page.width),height:pct(y1-y0,page.height)});
}
// One page redrawn in place (its boxes, ink and selection), keeping the scroll position.
function nbRefreshPage(el){const page=nbPage(el.dataset.pageId);if(!page)return;nbPaintPins(el,nbPinIndex());el.querySelectorAll(':scope>.nb-item').forEach(n=>n.remove());el.querySelector('.nb-ink').insertAdjacentHTML('beforebegin',page.items.map(item=>nbItemHtml(item,page)).join(''));nbLoadAssets(el);nbDrawPage(el);nbSelectionDraw();}
function nbHover(el,event){const sel=nb.sel?.pageId===el.dataset.pageId?nb.sel:null,tool=globalThis.appInk.tool;el.classList.toggle('ink-over-selection',Boolean(sel?.box&&tool==='lasso'&&nbInBox(sel.box,nbPoint(el,event))));
  // With the select tool, over a stroke it can move: an open hand.
  el.classList.toggle('ink-over-stroke',tool==='read'&&event.pointerType!=='touch'&&!event.target.closest?.('.nb-item')&&Boolean(nbStrokeAt(el,nbPage(el.dataset.pageId),nbPoint(el,event))));}
// The pen stroke or shape drawn on top at a point of a page (points), within about 8 screen pixels of its line, as on
// PDF pages (desktop/ink.js inkStrokeReach); highlighters are moved with the lasso.
function nbStrokeAt(el,page,[x,y]){if(!page)return null;const reach=globalThis.appInk.strokeReach,radius=8/nbScale(el);for(let i=page.strokes.length-1;i>=0;i--){const st=page.strokes[i];if(st.tool==='pen'&&reach(st,x,y,radius))return st;}return null;}
// A copy a little below and right of the selection, which becomes the selection.
function nbSelDuplicate(){
  const sel=nb.sel,el=sel&&nbPageEl(sel.pageId);if(!el)return;const off=14,move=([x,y])=>[x+off,y+off],strokes=[],items=[];
  nbChange('복제',()=>{const page=nbPage(sel.pageId);for(const st of page.strokes.filter(st=>sel.strokes.includes(st.id))){const copy={...nbMoved(st,move,1),id:nbId()};strokes.push(copy.id);page.strokes.push(copy);}for(const i of page.items.filter(i=>sel.items.includes(i.id))){const copy={...nbMovedItem(i,move,1,page),id:nbId()};items.push(copy.id);page.items.push(copy);}}); // i18n:keep — the undo label (not shown)
  nb.sel={pageId:sel.pageId,strokes,items};nbRefreshPage(el);
}
function nbSelDelete(){const sel=nb.sel,el=sel&&nbPageEl(sel.pageId);if(!el)return;nbChange('삭제',()=>{const page=nbPage(sel.pageId);page.strokes=page.strokes.filter(st=>!sel.strokes.includes(st.id));page.items=page.items.filter(i=>!sel.items.includes(i.id));});nb.sel=null;nbRefreshPage(el);} // i18n:keep — the undo label (not shown)
// With a selection holding strokes, a palette colour recolours them.
const nbUseColorBase=inkUseColor;
inkUseColor=function(color){const sel=nb.sel,el=sel&&nbPageEl(sel.pageId);if(el&&sel.strokes.length&&['lasso','hand','read'].includes(globalThis.appInk.tool)){nbChange('색',()=>{for(const st of nbPage(sel.pageId).strokes)if(sel.strokes.includes(st.id))st.color=color;});nbDrawPage(el);return;}nbUseColorBase(color);}; // i18n:keep — the undo label (not shown)
// The page memo: typing goes into the text box under the pointer, or into a new one placed there.
// The memo tool (Ctrl+7) pins a new memo where the page is pressed, as on the source pages, and opens it.
function nbMemoAt(el,[x,y]){
  const page=nbPage(el.dataset.pageId);globalThis.appInk.setTool?.('read');if(!page||!nb.doc)return;
  if(!selected()){toast(tr('메모를 넣을 자료를 먼저 여세요.'));return;}
  inkPlaceMemoPin({notebookId:nb.doc.id,pageId:page.id,x:nbClamp(x/page.width,0,1),y:nbClamp(nbPinStored(page,y/page.height),0,1)});
}
function nbMemo(el,[x,y]){
  const page=nbPage(el.dataset.pageId);if(!page)return;
  let item=page.items.find(i=>i.type==='text'&&nbInBox(nbItemBox(i),[x,y]));
  if(!item){const left=Math.round(nbClamp(x,0,page.width-160));item={id:nbId(),type:'text',x:left,y:Math.round(nbClamp(y-10,0,page.height-60)),w:Math.min(240,page.width-left),h:60,text:'',...nbTextStart()};const added=item;nbChange('메모',()=>page.items.push(added));nbRefreshPage(el);} // i18n:keep — the undo label (not shown)
  // Once a box is placed the reading (select) tool comes back, so the next click selects or moves instead of adding.
  globalThis.appInk.setTool?.('read');
  const box=el.querySelector(`[data-item-id="${CSS.escape(item.id)}"]`);if(box)requestAnimationFrame(()=>nbEditText(box));
}
document.addEventListener('keydown',event=>{
  if(!nb.sel||state.screen!=='reader'||dialog.open)return;
  if(!nbPageEl(nb.sel.pageId)){nb.sel=null;return;}
  // Esc lets go of the selection wherever the keyboard is; the other keys act only outside text fields (as on PDF pages).
  if(event.key==='Escape'){if(!event.defaultPrevented){event.preventDefault();nbSelect(null);}return;}
  if(event.defaultPrevented||event.target.closest?.('input,textarea,select,[contenteditable="true"]'))return;
  if(event.key==='Delete'||event.key==='Backspace'){event.preventDefault();nbSelDelete();}
  if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='d'){event.preventDefault();nbSelDuplicate();}
});
// A lasso on a PDF page takes over from the notebook's selection.
document.addEventListener('pointerdown',event=>{if(nb.sel&&event.target.closest?.('.app-ink-layer'))nbSelect(null);},true);
// New pages: a paper size (kept as the next choice) or the pages of another PDF.
const NB_SIZES={a4:{label:'A4',w:595,h:842},a4l:{label:tr('A4 가로'),w:842,h:595},a5:{label:'A5',w:420,h:595},b5:{label:'B5',w:516,h:729},letter:{label:'Letter',w:612,h:792},original:{label:tr('원문 쪽 크기'),w:595,h:842},custom:{label:tr('사용자 지정…'),w:595,h:842}};
// 사용자 지정: width and height in millimetres (51–705 mm), remembered for the next page.
const NB_MM=72/25.4,nbMm=pt=>Math.round(pt/NB_MM),nbCustom=()=>{try{const v=JSON.parse(localStorage.getItem('app-nb-custom')||'null');if(v?.w>=144&&v?.h>=144&&v.w<=2000&&v.h<=2000)return v;}catch{}return {w:595,h:842};};
NB_SIZES.custom={...NB_SIZES.custom,...nbCustom()};
function nbAskCustomSize(){const c=nbCustom();modal(tr('사용자 지정 크기'),`<div class="row"><div class="field"><label for="nb-custom-w">${tr('너비 (mm)')}</label><input id="nb-custom-w" type="number" min="51" max="705" value="${nbMm(c.w)}"></div><div class="field"><label for="nb-custom-h">${tr('높이 (mm)')}</label><input id="nb-custom-h" type="number" min="51" max="705" value="${nbMm(c.h)}"></div></div><p class="small muted">${tr('참고: A4 210×297, A5 148×210, B5 182×257, Letter 216×279 mm')}</p>`,btn(tr('취소'),'close')+btn(tr('이 크기로 추가'),'nb-custom-add','primary'));setTimeout(()=>document.querySelector('#nb-custom-w')?.select());}
// 원문 쪽 크기: the size in points of the original PDF page being read (A4 when there is none), kept
// within the page sizes a notebook takes (2 to about 28 inches a side) as pages taken from a PDF are.
async function nbOriginalSize(){try{const engine=await pdfEngine(),{pdf}=await engine.documentFor(state.storageKey,state.selected,false,state.selectedAttachment),page=await pdf.getPage(Math.min(pdf.numPages,nbSourceNow().page||1)),v=page.getViewport({scale:1}),k=Math.min(1,2000/Math.max(v.width,v.height));return {w:Math.max(144,Math.round(v.width*k)),h:Math.max(144,Math.round(v.height*k))};}catch{return NB_SIZES.a4;}}
// A new page's form and size: what the 페이지 추가 popover shows now, else what was chosen last. Both are remembered.
const NB_TEMPLATES={lined:tr('줄'),grid:tr('격자'),blank:tr('빈')};
const nbTemplateChoice=()=>{try{const v=localStorage.getItem('app-nb-template');return NB_TEMPLATES[v]?v:'lined';}catch{return 'lined';}};
function nbNewPageChoice(){const template=document.querySelector('.nb-add-menu [name="nb-new-template"]:checked')?.value||nbTemplateChoice(),size=document.querySelector('.nb-add-menu .nb-size')?.value||nbSizeChoice(),boardBox=document.querySelector('.nb-add-menu [name="nb-new-board"]'),board=boardBox?boardBox.checked:nbBoardChoice();try{localStorage.setItem('app-nb-template',template);localStorage.setItem('app-nb-size',size);localStorage.setItem('app-nb-board',board?'1':'');}catch{}return {template,size,board};}
// Under the last page, a + for another like it (seen at the end of the list; a paragraph, not a page's div, so the
// pages stay the list's last divs): the same template and size, empty; after a page taken from a PDF, an empty page
// of its size; after a whiteboard, a new whiteboard of its width. Up to the 500 pages a notebook holds.
const NB_MAX_PAGES=500;
function nbAddSameHtml(){
  const last=nb.doc?.pages.at(-1);if(!last)return '';const full=nb.doc.pages.length>=NB_MAX_PAGES,label=last.board?tr('같은 폭의 새 화이트보드 추가'):tr('같은 양식의 페이지 추가');
  return `<p class="nb-add-more"><button type="button" class="round-button nb-add-same" data-action="nb-add-same" ${full?'disabled':''} title="${full?tr('노트북에는 {n}쪽까지 넣을 수 있습니다.',{n:NB_MAX_PAGES}):label}" aria-label="${label}">${icon('plus')}</button></p>`;
}
function nbSameAsLast(){const last=nb.doc.pages.at(-1);return last.board?nbNewPage(last.template,{w:last.width},true):last.background?nbNewPage('blank',{w:last.width,h:last.height},false):nbNewPage(last.template,{w:last.width,h:last.height},false);}
// A whiteboard or a page: what was chosen last.
const nbBoardChoice=()=>{try{return localStorage.getItem('app-nb-board')==='1';}catch{return false;}};
// A new page of the chosen size, or a whiteboard of its width a sheet long.
const nbNewPage=(template,size,board)=>board?{id:nbId(),template,width:size.w,height:nbSheet(size.w),board:true,items:[],strokes:[]}:{id:nbId(),template,width:size.w,height:size.h,items:[],strokes:[]};
const nbSizeChoice=()=>{try{const v=localStorage.getItem('app-nb-size');return NB_SIZES[v]?v:'a4';}catch{return 'a4';}};
// Another PDF's pages become notebook pages at their own size; each page is drawn as the page's
// background picture (stored with the notebook's pictures), so the notebook stays one file to sync and export.
let nbPdfImport=null;
async function nbAddPdf(){
  const picked=await window.appApi.notebookPdfPick();if(!picked)return;
  const engine=await pdfEngine(),pdf=await engine.openBytes(picked.bytes);nbPdfImport={pdf,name:picked.name};
  const max=Math.min(pdf.numPages,100);
  modal(tr('PDF에서 가져오기'),`<p>${tr('{name} · {n}쪽',{name:esc(picked.name),n:pdf.numPages})}</p><div class="field"><label for="nb-pdf-range">${tr('가져올 쪽')}</label><input id="nb-pdf-range" value="1-${max}" placeholder="${tr('예: 1-5, 8')}"></div><p class="small muted">${tr('한 번에 100쪽까지 넣습니다. 쪽마다 그림으로 바뀌어 노트북 페이지 배경이 되고, 그 위에 필기할 수 있습니다. 원본 PDF 파일은 저장소에 복사하지 않습니다.')}</p><p id="nb-pdf-status" class="small" role="status"></p>`,btn(tr('취소'),'close')+btn(tr('가져오기'),'nb-add-pdf-go','primary'));
}
function nbPageRange(text,count){const out=new Set();for(const part of String(text).split(/[,\s]+/).filter(Boolean)){const m=part.match(/^(\d+)(?:-(\d+))?$/);if(!m)throw Error(tr('쪽 범위를 "1-5, 8"처럼 적으세요.'));const a=Number(m[1]),b=Number(m[2]||m[1]);for(let n=Math.min(a,b);n<=Math.max(a,b);n++)if(n>=1&&n<=count)out.add(n);}if(!out.size)throw Error(tr('가져올 쪽을 고르세요.'));if(out.size>100)throw Error(tr('한 번에 100쪽까지 가져올 수 있습니다.'));return [...out].sort((a,b)=>a-b);}
async function nbAddPdfGo(){
  const job=nbPdfImport;if(!job||!nb.doc)return;const pages=nbPageRange(document.querySelector('#nb-pdf-range').value,job.pdf.numPages),status=document.querySelector('#nb-pdf-status'),engine=await pdfEngine(),added=[],vault=state.storageKey,docId=nb.doc.id;
  dialog.querySelectorAll('.actions button').forEach(b=>b.disabled=true);
  try{for(const [i,n] of pages.entries()){status.textContent=tr('{done}/{total}쪽 준비 중…',{done:i+1,total:pages.length});const bg=await engine.pageBackground(job.pdf,n),hash=await window.appApi.notebookAssetPut(vault,bg.dataUrl);
    const k=Math.min(1,2000/Math.max(bg.width,bg.height)),w=Math.max(144,Math.round(bg.width*k*100)/100),h=Math.max(144,Math.round(bg.height*k*100)/100);added.push({id:nbId(),template:'blank',width:w,height:h,background:hash,items:[],strokes:[]});}}
  finally{job.pdf.destroy?.();nbPdfImport=null;}
  if(nb.doc?.id!==docId)return;dialog.close();nbChange('PDF 쪽 추가',()=>nb.doc.pages.push(...added));nbRender();nbShowPage(document.querySelector(`[data-page-id="${CSS.escape(added[0].id)}"]`));toast(tr('{n}쪽을 노트북에 넣었습니다.',{n:added.length})); // i18n:keep — the undo label (not shown)
}
dialog.addEventListener('close',()=>{if(nbPdfImport){nbPdfImport.pdf.destroy?.();nbPdfImport=null;}});
// A visible page receives new boxes; new pages copy the chosen template.
function nbTargetPage(){const pages=[...document.querySelectorAll('.nb-page')],list=document.querySelector('.nb-pages');if(!pages.length)return null;const top=list.getBoundingClientRect().top;return (pages.find(el=>el.getBoundingClientRect().bottom>top+40)||pages[0]).dataset.pageId;}
// Memos of the open paper, for embedding (메모 넣기) and @mentions in text boxes.
function nbMemos(){const p=selected();return p?memoKeysOf(p.id).map((key,i)=>({key,title:memoTitle(key,i)})):[];}
// A memo put on a page (메모 넣기) is a card like those in the memo tab: its title and one line; pressed,
// it opens in place to write in (the memo's live editor), with the memo tab's AI, window, pin and
// wide-editor buttons. Open cards are this session's view only; the item keeps its box for the export.
const nbOpenMemos=new Set();
function nbMemoCardHtml(item,page){
  const key=item.key,gone=notes[key]===undefined,text=gone?item.text:notes[key],index=memoKeysOf(Number(key.split('-')[0])).indexOf(key);
  const title=gone?item.title:memoTitle(key,Math.max(0,index)),open=nbOpenMemos.has(item.id),id=esc(item.id);
  const box=`left:${pct(item.x,page.width)};top:${pct(item.y,page.height)};width:${pct(item.w,page.width)}${open?`;height:${pct(Math.max(item.h,90),page.height)}`:''}`;
  const handle=`<span class="nb-resize" data-nb-resize aria-hidden="true"></span><button class="nb-remove" data-nb-remove aria-label="${tr('페이지에서 빼기')}" title="${tr('페이지에서 빼기 (메모는 남습니다)')}">×</button>`;
  const wide=gone?'':`<button type="button" class="row-more" data-memo-wide="${esc(key)}" title="${tr('넓게 편집')}" aria-label="${tr('{name} 넓게 편집',{name:esc(title)})}">${icon('expand')}</button>`,ai=gone?'':aiButton(key,title);
  if(open){
    const head=gone?`<strong>${esc(title)} <span class="muted">${tr('(지워짐)')}</span></strong>`:`<input class="memo-title" data-note="${esc(key+TITLE)}" value="${esc(notes[key+TITLE]||'')}" placeholder="${esc(title)}" maxlength="200" aria-label="${tr('메모 제목')}">`;
    const tools=`<span class="memo-actions"><button type="button" class="row-more" data-nb-memo-fold="${id}" title="${tr('접기 (Esc)')}" aria-label="${tr('{name} 접기',{name:esc(title)})}">${icon('memoFold')}</button>${gone?'':ai+memoPinButton(key,title)+wide+memoWindowButton(key,title)}</span>`;
    const body=gone?`<div class="nb-memo-read md">${renderNote(text)}</div>`:noteBox(key,`placeholder="${tr('본문 — Markdown과 $수식$을 쓸 수 있습니다')}"`,title,true);
    return `<div class="nb-item nb-memo nb-memo-card open" data-item-id="${id}" data-nb-memo-key="${esc(key)}" style="${box}"><div class="nb-memo-head">${gone?'':memoSource(key)}${head}${tools}</div>${body}${handle}</div>`;
  }
  const glance=memoGlance(text);
  return `<div class="nb-item nb-memo nb-memo-card" data-item-id="${id}" data-nb-memo-key="${esc(key)}" style="${box}" tabindex="0" role="button" aria-label="${tr('{name} 펼치기',{name:esc(title)})}" title="${tr('누르면 펼칩니다 · 끌어서 옮기기')}"><div class="nb-memo-head">${gone?'':memoSource(key)}<strong class="${gone||notes[key+TITLE]?.trim()?'':'untitled'}">${esc(title)}${gone?` <span class="muted">${tr('(지워짐)')}</span>`:''}</strong><span class="memo-actions">${ai}${wide}</span></div><div class="memo-glance">${glance.image?`<img class="memo-thumb" src="${esc(noteImageUrl(glance.image))}" alt="" loading="lazy">`:''}<div class="memo-line md">${glance.line?renderNote(glance.line):`<p class="muted">${glance.image?tr('그림'):tr('비어 있음')}</p>`}</div></div>${handle}</div>`;
}
function nbMemoRedrawItem(id){
  for(const page of nb.doc?.pages||[]){const item=page.items.find(i=>i.id===id);if(!item)continue;const node=document.querySelector(`.nb-item[data-item-id="${CSS.escape(id)}"]`);if(node)node.outerHTML=nbMemoCardHtml(item,page);return document.querySelector(`.nb-item[data-item-id="${CSS.escape(id)}"]`);}
  return null;
}
// Opening mounts the memo's live editor (the side panel's field mounting does it) and puts the cursor at the end.
function nbMemoOpen(id){nbOpenMemos.add(id);const node=nbMemoRedrawItem(id);requestAnimationFrame(()=>{syncLiveFields();const area=node?.querySelector('.note-box textarea');const editor=area&&fieldEditorOf(area);if(editor)editor.focusEnd();else node?.focus();});}
function nbMemoFold(id){nbOpenMemos.delete(id);nbMemoRedrawItem(id)?.focus();}
document.addEventListener('click',event=>{const fold=event.target.closest?.('[data-nb-memo-fold]');if(fold){event.preventDefault();event.stopPropagation();nbMemoFold(fold.dataset.nbMemoFold);}});
document.addEventListener('keydown',event=>{
  const card=event.target.closest?.('.nb-memo-card');if(!card||dialog.open)return;
  if((event.key==='Enter'||event.key===' ')&&event.target===card&&!card.classList.contains('open')){event.preventDefault();nbMemoOpen(card.dataset.itemId);return;}
  if(event.key==='Escape'&&card.classList.contains('open')&&!event.target.closest('.memo-title')){event.preventDefault();event.stopPropagation();nbMemoFold(card.dataset.itemId);}
});
// Memo pins on notebook pages: the same `#pin` note as on the source pages, naming the notebook and its
// page instead of a file and page number. A memo has one pin wherever it is; placing it again moves it.
function nbPinIndex(){
  const out=new Map();if(!nb.doc)return out;
  for(const k of Object.keys(notes)){
    if(!k.endsWith(MEMO_PIN))continue;let place=null;try{place=JSON.parse(notes[k]);}catch{}
    if(place?.notebookId!==nb.doc.id||!Number.isFinite(place.x)||!Number.isFinite(place.y))continue;
    const key=k.slice(0,-MEMO_PIN.length);if(notes[key]===undefined)continue;
    const index=memoKeysOf(Number(key.split('-')[0])).indexOf(key);if(!out.has(place.pageId))out.set(place.pageId,[]);
    out.get(place.pageId).push({key,title:memoTitle(key,Math.max(0,index)),x:place.x,y:place.y});
  }
  return out;
}
// A pin's place is a share of the page across and down; on a whiteboard, down a board of the longest length, so a
// pin stays where it was as the board grows or is trimmed.
const nbPinDown=(page,y)=>page?.board?y*NB_BOARD_MAX/page.height:y,nbPinStored=(page,y)=>page?.board?y*page.height/NB_BOARD_MAX:y;
const nbPinsHtml=(list,page)=>(list||[]).map(m=>`<button type="button" class="annotation-pin memo-pin nb-pin" data-memo-pin-open="${esc(m.key)}" style="left:calc(${(m.x*100).toFixed(3)}% - 10px);top:calc(${(nbPinDown(page,m.y)*100).toFixed(3)}% - 10px)" title="${esc(tr('{title}\n{text}\n클릭하면 메모를 엽니다 · 끌어서 옮기기',{title:m.title,text:String(notes[m.key]||'').slice(0,160)}))}" aria-label="${tr('{title} 메모 열기',{title:esc(m.title)})}">${icon('memoPin')}</button>`).join('');
function nbPaintPins(el,index){el.querySelectorAll(':scope>.nb-pin').forEach(n=>n.remove());el.insertAdjacentHTML('beforeend',nbPinsHtml(index.get(el.dataset.pageId),nbPage(el.dataset.pageId)));}
function nbRefreshPins(){if(!nb.doc)return;const index=nbPinIndex();for(const el of document.querySelectorAll('.notebook-pane .nb-page'))nbPaintPins(el,index);}
// Pins change where the source pins are redrawn (placed, moved, removed, a memo deleted).
const nbMarksBase=inkRefreshAnnotationMarks;
inkRefreshAnnotationMarks=function(){nbMarksBase();nbRefreshPins();};
// A memo's pin (the memo tools' pin button) can be placed on a notebook page too.
const nbPinPlaceBase=inkPinPlace;
inkPinPlace=function(event){
  const el=event.target.closest?.('.notebook-pane .nb-page');if(!el||!nb.doc)return nbPinPlaceBase(event);
  const r=el.getBoundingClientRect();return {notebookId:nb.doc.id,pageId:el.dataset.pageId,x:nbClamp((event.clientX-r.left)/r.width,0,1),y:nbClamp(nbPinStored(nbPage(el.dataset.pageId),(event.clientY-r.top)/r.height),0,1)};
};
// To a memo's pin on a notebook page: the notebook view, that notebook, that page, the pin in view.
async function nbGoToPin(place,key){
  if(state.mode!=='notebook')document.querySelector('[data-mode="notebook"]')?.click();
  if(!await pinWait(()=>document.querySelector('.notebook-pane .nb-body[data-mounted]')&&nb.key===state.storageKey+':'+state.selected))return;
  if(nb.id!==place.notebookId){
    if(!nb.list.some(n=>n.id===place.notebookId)){const trashed=(await window.appApi.notebookTrash(state.storageKey).catch(()=>[])).some(n=>n.id===place.notebookId);toast(trashed?tr('핀이 꽂힌 노트북이 휴지통에 있습니다. 저장소 관리의 휴지통에서 되살릴 수 있습니다.'):tr('핀이 꽂힌 노트북을 찾을 수 없습니다.'));return;}
    await nbFlush();nb.id=place.notebookId;nb.doc=await window.appApi.notebookGet(state.storageKey,nb.id);try{localStorage.setItem('app-notebook-'+nb.key,nb.id);}catch{}nb.status='';nbRender();
  }
  const page=await pinWait(()=>nbPageEl(place.pageId));if(!page){toast(tr('핀이 꽂힌 노트북 쪽을 찾을 수 없습니다.'));return;}
  showPin(await pinWait(()=>page.querySelector(`[data-memo-pin-open="${CSS.escape(key)}"]`)));
}
// The title of a memo made by pinning it on a notebook page, and where a pin is, in words.
function nbPinTitle(place){const doc=nb.doc?.id===place.notebookId?nb.doc:null,n=doc?doc.pages.findIndex(p=>p.id===place.pageId)+1:0;const notebook=doc?.title||nb.list.find(x=>x.id===place.notebookId)?.title||tr('노트북');return n?tr('{notebook} {n}쪽 메모',{notebook,n}):tr('{notebook} 메모',{notebook});}
function nbPlaceLabel(place){const doc=nb.doc?.id===place.notebookId?nb.doc:null,n=doc?doc.pages.findIndex(p=>p.id===place.pageId)+1:0;const title=doc?.title||nb.list.find(x=>x.id===place.notebookId)?.title||'?';return n?tr('노트북 ‘{title}’ {n}쪽',{title,n}):tr('노트북 ‘{title}’',{title});}
// The saved title and text of an embedded memo are what the PDF export prints and what shows once it is deleted.
// The saved copy of every embedded memo (what the PDF export prints) follows the memo. It is brought
// up to date when the notebook is saved anyway, not with a save of its own on every memo edit.
function nbSyncMemos(){
  if(!nb.doc)return false;let changed=false;
  for(const page of nb.doc.pages)for(const item of page.items){if(item.type!=='memo'||notes[item.key]===undefined)continue;const text=String(notes[item.key]).slice(0,20000),title=(notes[item.key+TITLE]?.trim()||item.title).slice(0,200);if(item.text!==text||item.title!==title){item.text=text;item.title=title;changed=true;}}
  return changed;
}
// A memo edited or removed anywhere (memo tab, editor, memo window, AI) shows in its embeds.
const nbMemoRedraw=new Set();let nbMemoTimer=null;
document.addEventListener('app-note-edited',event=>{
  const key=event.detail.key.split('#')[0];if(!nb.doc?.pages.some(p=>p.items.some(i=>i.type==='memo'&&i.key===key)))return;
  nbMemoRedraw.add(key);clearTimeout(nbMemoTimer);nbMemoTimer=setTimeout(()=>{
    const keys=new Set(nbMemoRedraw);nbMemoRedraw.clear();if(!nb.doc)return;
    const typedHere=document.activeElement?.closest?.('.nb-memo-card');
    for(const page of nb.doc.pages)for(const item of page.items){
      if(item.type!=='memo'||!keys.has(item.key))continue;const node=document.querySelector(`.nb-memo[data-item-id="${CSS.escape(item.id)}"]`);if(!node)continue;
      // An open card keeps its editor: the text of another view goes into it unless it is being typed in.
      if(node.classList.contains('open')&&notes[item.key]!==undefined){
        if(!node.contains(document.activeElement)){const area=node.querySelector('.note-box textarea'),value=notes[item.key]??'';if(area&&area.value!==value){area.value=value;fieldEditorOf(area)?.setDoc(value);}const title=node.querySelector('.memo-title');if(title)title.value=notes[item.key+TITLE]||'';}
        continue;}
      node.outerHTML=nbMemoCardHtml(item,page);
    }
    // Written in a card on the page: the memo tab's closed card shows the new line too.
    if(typedHere&&!document.activeElement?.closest?.('.memo-tab')&&[...keys].some(k=>document.querySelector(`.memo-tab .memo-card:not(.open)[data-memo="${CSS.escape(k)}"]`)))refreshMemos();
  },300);
});
// "@[이름]" in a text box names a memo. The box keeps which memo each name stands for
// (item.mentions: [{key,label}], at most 50, the latest kept), so renaming, deleting or reordering
// memos never points it at another memo; a name typed by hand is looked up by memo title.
const NB_LABEL=200,nbMentionLabel=title=>String(title).replace(/[\]\n\r]/g,' ').trim().slice(0,NB_LABEL)||tr('메모');
function nbMentionChips(item,text=item.text){
  text=String(text);if(!text.includes('@['))return '';
  const memos=nbMemos(),seen=new Set(),chips=[];
  for(const m of text.matchAll(/@\[([^\]\n]{1,200})\]/g)){const label=m[1];if(seen.has(label))continue;seen.add(label);const key=item.mentions?.find(x=>x.label===label)?.key||memos.find(x=>x.title===label)?.key;if(key)chips.push({key,label});}
  return chips.length?`<span class="nb-mentions">${chips.map(c=>`<button class="nb-mention" data-nb-memo="${esc(c.key)}" title="${tr('메모 열기')}">@${esc(c.label)}</button>`).join('')}</span>`:'';
}
function nbRefreshChips(box,item,text){box.querySelector('.nb-mentions')?.remove();box.querySelector('.nb-resize')?.insertAdjacentHTML('beforebegin',nbMentionChips(item,text));}
// 메모 넣기 opens beside its button, as 새 페이지 does: the paper's memos (one chosen is put on the page), each with the
// first line its memo card shows (그림 for a memo of pictures only, as the card says; none for an empty memo), and a line on what
// a memo card does, or that the paper has none. It opens once this click is done (the click that asks for it would
// close it again); a second press of the button closes it.
function nbMemoPick(anchor=document.querySelector('[data-action="nb-memo"]')){
  if(!anchor)return;if(anchor.getAttribute('aria-expanded')==='true'){closePopMenu(true);return;}
  setTimeout(()=>{if(!anchor.isConnected)return;const memos=nbMemos();
    const why=nbMemoCreateReason();
    openPopMenu(anchor,`<p class="pop-menu-title">${tr('메모 넣기')}</p><button type="button" role="menuitem" class="nb-memo-create" data-action="nb-memo-create"${why?` disabled aria-disabled="true" title="${esc(why)}"`:` title="${tr('이 자료에 새 메모를 만들어 이 페이지에 넣습니다')}"`}>${tr('새 메모 만들어 넣기')}</button>${memos.length?memos.map(m=>{const glance=memoGlance(notes[m.key]),second=glance.line?renderNote(glance.line):glance.image?esc(tr('그림')):'';return `<button type="button" role="menuitem" data-nb-embed="${esc(m.key)}" title="${esc(m.title)}"><span class="nb-memo-title">${esc(m.title)}</span>${second?`<span class="nb-memo-line md">${second}</span>`:''}</button>`;}).join('')+`<p class="pop-menu-note small muted">${tr('메모 내용이 그대로 보이고, 메모를 고치면 함께 바뀝니다.')}</p>`:`<p class="pop-menu-note small muted">${tr('이 논문에 메모가 없습니다.')}</p>`}`,tr('메모 넣기'),'nb-memo-menu');});
}
// 새 메모 만들어 넣기: a memo of the open paper made as the 메모 tab makes one, its card put where 메모 넣기 puts one, open,
// the cursor in its text (Markdown and $math$ as in any memo). It needs the paper the notebook belongs to: not in a
// notebook of no paper or of another paper, nor in the notebook window (memos are not written there); why is told.
function nbMemoCreateReason(){
  if(nbWindow)return tr('노트북 새 창에서는 메모를 쓸 수 없습니다. 본 창에서 만드세요.');
  if(!nb.doc||nb.doc.paperId===null||nb.doc.paperId===undefined)return tr('어느 자료에도 속하지 않은 노트북이라 새 메모를 만들 자료가 없습니다.');
  const p=selected();if(!p||p.id!==nb.doc.paperId)return tr('다른 자료의 노트북입니다. 그 자료를 열고 만드세요.');
  return '';
}
function nbMemoCreate(){
  if(nbMemoCreateReason())return;
  const pageId=nbTargetPage();if(!pageId)return;
  const key=newMemo();if(!key)return;refreshMemos();
  const id=nbId(),docId=nb.doc.id,title=memoTitle(key,nbMemos().findIndex(m=>m.key===key));
  // A whiteboard grows with the card as with anything placed (nbGrow), in the same undo step.
  const before=JSON.stringify(nb.doc.pages);nbPage(pageId).items.push({id,type:'memo',x:50,y:nbFreeY(pageId,50,320,nbViewTop(pageId)+80),w:320,h:180,key,title:title.slice(0,200),text:''});nbGrow(nbPage(pageId));const after=JSON.stringify(nb.doc.pages);
  // One Ctrl+Z takes the card off. A memo still empty then goes too (nothing was written in it); one written in stays in
  // the 메모 tab, as 페이지에서 빼기 leaves it.
  const emptyMemo=()=>!String(notes[key]??'').trim()&&!String(notes[key+TITLE]??'').trim();
  const label='메모'; // i18n:keep — the undo label (not shown)
  globalThis.appInk.record({custom:true,label,undo:()=>{if(nb.doc?.id!==docId)return;nb.sel=null;nb.doc.pages=JSON.parse(before);nbSave();nbRender();
      if(emptyMemo()){delete notes[key];delete notes[key+TITLE];if(openMemoKey===key)openMemoKey=null;refreshMemos();desktopNotes().catch(()=>{});}},
    redo:()=>{if(nb.doc?.id!==docId)return;if(!(key in notes))notes[key]='';nb.sel=null;nb.doc.pages=JSON.parse(after);nbSave();nbRender();refreshMemos();}});
  nbSave();nbRender();nbMemoOpen(id);desktopNotes().catch(()=>{});
}
function nbEmbedMemo(key){const title=memoTitle(key,nbMemos().findIndex(m=>m.key===key)),pageId=nbTargetPage(),top=pageId?nbViewTop(pageId):0;nbAddItem({type:'memo',x:50,y:pageId?nbFreeY(pageId,50,320,top+80)-top:80,w:320,h:180,key,title:title.slice(0,200),text:String(notes[key]||'').slice(0,20000)});}
// A new card goes below whatever already lies at its spot (cards by their drawn height), so none is covered.
function nbFreeY(pageId,x,w,y0){
  const page=nbPage(pageId),el=nbPageEl(pageId);if(!page)return y0;const scale=el?.clientHeight?page.height/el.clientHeight:1,need=Math.max(40,60*scale);
  const boxes=page.items.map(i=>{const node=el?.querySelector(`:scope>.nb-item[data-item-id="${CSS.escape(i.id)}"]`);return {x0:i.x,x1:i.x+i.w,y0:i.y,y1:i.y+(node?node.offsetHeight*scale:i.h)};});
  for(let y=y0,n=0;n<200&&y+need<=page.height;n++){const hit=boxes.find(b=>b.x0<x+w&&b.x1>x&&b.y0<y+need&&b.y1>y);if(!hit)return Math.round(y);y=Math.ceil(hit.y1)+8;}
  return y0;
}
// Typing "@" in a text box offers the paper's memos (↑↓ to choose, Enter or Tab to put it in, Esc to close).
let nbMention=null;
function nbMentionClose(){document.querySelector('.nb-mention-menu')?.remove();nbMention=null;}
function nbMentionUpdate(area){
  const before=area.value.slice(0,area.selectionStart),m=before.match(/@([^\s@\[\]]{0,40})$/);
  if(!m){nbMentionClose();return;}
  const query=m[1].toLowerCase(),memos=nbMemos().filter(x=>x.title.toLowerCase().includes(query)).slice(0,8);
  if(!memos.length){nbMentionClose();return;}
  nbMention={area,start:area.selectionStart-m[0].length,memos,index:0};
  let menu=document.querySelector('.nb-mention-menu');if(!menu){menu=document.createElement('div');menu.className='nb-mention-menu';menu.setAttribute('role','listbox');menu.setAttribute('aria-label',tr('메모',null,'memo list'));document.body.append(menu);}
  const r=area.getBoundingClientRect();menu.style.left=Math.max(4,Math.min(innerWidth-200,r.left))+'px';menu.style.top=Math.min(innerHeight-40,r.bottom+4)+'px';
  nbMentionPaint();
}
function nbMentionPaint(){const menu=document.querySelector('.nb-mention-menu');if(menu&&nbMention)menu.innerHTML=nbMention.memos.map((x,i)=>`<button type="button" role="option" aria-selected="${i===nbMention.index}" class="${i===nbMention.index?'active':''}" data-nb-mention-pick="${i}">${esc(x.title)}</button>`).join('');}
function nbMentionPick(index){
  const {area,start,memos}=nbMention||{},memo=memos?.[index];nbMentionClose();if(!area||!memo)return;
  // Only the "@name" being typed is replaced; if the cursor has left it, nothing is.
  if(!/^@[^\s@\[\]]{0,40}$/.test(area.value.slice(start,area.selectionStart)))return;
  const item=nbItemOf(area.closest('[data-item-id]')?.dataset.itemId);if(!item)return;
  const base=nbMentionLabel(memo.title),mentions=item.mentions||[];let label=base,n=2;
  while(mentions.some(x=>x.label===label&&x.key!==memo.key)){const suffix=` (${n++})`;label=base.slice(0,NB_LABEL-suffix.length)+suffix;}
  const text=`@[${label}] `;area.value=area.value.slice(0,start)+text+area.value.slice(area.selectionStart);area.selectionStart=area.selectionEnd=start+text.length;
  item.mentions=[...mentions.filter(x=>x.label!==label),{key:memo.key,label}].slice(-50);
  area.dispatchEvent(new Event('input',{bubbles:true}));area.focus({preventScroll:true});
}
document.addEventListener('input',event=>{
  const area=event.target.closest?.('.nb-text textarea');if(!area||!nb.doc)return;
  const box=area.closest('[data-item-id]'),item=nbItemOf(box.dataset.itemId);
  // Names deleted from the text are forgotten. The chips follow the text being typed (this runs
  // before the handler that copies it into the item); a box that never named a memo is skipped.
  if(item?.mentions){item.mentions=item.mentions.filter(x=>area.value.includes(`@[${x.label}]`)).slice(-50);if(!item.mentions.length)delete item.mentions;}
  if(item&&(area.value.includes('@[')||box.querySelector('.nb-mentions')))nbRefreshChips(box,item,area.value);
  if(!area.readOnly&&(nbMention||area.value.includes('@')))nbMentionUpdate(area);
});
// Window capture runs before the text bar's outside-press check (ink.js), so choosing from the menu
// keeps the box in editing and its cursor where it was.
window.addEventListener('pointerdown',event=>{
  if(!nbMention)return;
  if(event.target.closest?.('.nb-mention-menu')){event.preventDefault();event.stopPropagation();return;}
  nbMentionClose();
},true);
window.addEventListener('click',event=>{const pick=event.target.closest?.('[data-nb-mention-pick]');if(!pick)return;event.preventDefault();event.stopPropagation();nbMentionPick(Number(pick.dataset.nbMentionPick));},true);
window.addEventListener('keydown',event=>{
  if(!nbMention)return;
  if(event.key==='Escape'){event.preventDefault();event.stopPropagation();nbMentionClose();return;}
  if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();event.stopPropagation();const n=nbMention.memos.length;nbMention.index=(nbMention.index+(event.key==='ArrowDown'?1:n-1))%n;nbMentionPaint();return;}
  if((event.key==='Enter'||event.key==='Tab')&&!event.isComposing){event.preventDefault();event.stopPropagation();nbMentionPick(nbMention.index);return;}
  // Moving the cursor leaves the name being typed: the menu closes and the keys work as usual.
  if(['ArrowLeft','ArrowRight','Home','End','PageUp','PageDown'].includes(event.key))nbMentionClose();
},true);
document.addEventListener('focusout',event=>{if(event.target.closest?.('.nb-text textarea'))setTimeout(()=>{if(nbMention&&document.activeElement!==nbMention.area)nbMentionClose();},0);});
document.addEventListener('click',event=>{
  const embed=event.target.closest('[data-nb-embed]');if(embed){nbEmbedMemo(embed.dataset.nbEmbed);return;} // the menu closes itself (renderer.js)
  const open=event.target.closest('[data-nb-memo]');if(open){event.preventDefault();event.stopPropagation();openMemo(open.dataset.nbMemo);}
});
// On a whiteboard a new thing goes where the board is seen (its y is from the top of the view), not at its top.
function nbViewTop(pageId){const page=nbPage(pageId),el=nbPageEl(pageId),list=el?.closest('.nb-pages');if(!page?.board||!el||!list)return 0;const top=(list.getBoundingClientRect().top-el.getBoundingClientRect().top)/nbScale(el);return Math.max(0,Math.min(page.height-NB_BOARD_ROOM,Math.round(top)));}
function nbAddItem(item){const pageId=nbTargetPage();if(!pageId)return;const page=nbPage(pageId),y=item.y+nbViewTop(pageId),h=Math.min(item.h,4000,page.board?Math.max(16,NB_BOARD_MAX-y):4000),w=item.type==='image'&&h<item.h?Math.max(20,Math.round(item.w*h/item.h)):item.w;nbChange('추가',()=>page.items.push({id:nbId(),...item,y,w,h}));nbRender();} // i18n:keep — the undo label (not shown)
const nbItemOf=id=>{for(const page of nb.doc?.pages||[]){const item=page.items.find(i=>i.id===id);if(item)return item;}return null;};
function nbSourceNow(){const container=document.querySelector('.original-pages'),page=container?.pdfViewer?.currentPageNumber||1,paper=selected();return {paperId:paper.id,attachmentId:activeAttachment(paper)?.id||'',page,title:paper.title.slice(0,1000)};}
async function nbFigure(){
  const engine=await pdfEngine(),{pdf}=await engine.documentFor(state.storageKey,state.selected,false,state.selectedAttachment),source=nbSourceNow();
  modal(tr('그림으로 넣기'),`<div class="figure-controls"><label>${tr('페이지')} <input id="nb-fig-page" type="number" min="1" max="${pdf.numPages}" value="${source.page}"></label><button class="secondary small" data-action="nb-fig-load">${tr('이동',null,'go to page')}</button></div><p class="small muted">${tr('노트북에 넣을 영역을 드래그하세요. 원문 페이지가 출처로 함께 저장됩니다.')}</p><div class="figure-scroll"><div class="figure-canvas"><img id="nb-fig-image" alt="${tr('발췌할 원문 페이지')}" draggable="false"><div class="figure-selection" hidden></div></div></div>`,btn(tr('취소'),'close')+btn(tr('노트북에 넣기'),'nb-fig-insert','primary'));
  dialog.classList.add('figure-dialog');nb.figure={pdf,rect:null};await nbFigureLoad();
}
async function nbFigureLoad(){
  const f=nb.figure,input=document.querySelector('#nb-fig-page');if(!f||!input.reportValidity())return;f.page=Number(input.value);f.rect=null;
  const img=document.querySelector('#nb-fig-image'),engine=await pdfEngine();img.src=await engine.imageFor(f.pdf,f.page);await img.decode();
  const surface=document.querySelector('.figure-canvas'),overlay=surface.querySelector('.figure-selection');overlay.hidden=true;let start=null;
  const point=e=>{const r=surface.getBoundingClientRect();return {x:Math.max(0,Math.min(1,(e.clientX-r.left)/r.width)),y:Math.max(0,Math.min(1,(e.clientY-r.top)/r.height))};};
  surface.onpointerdown=e=>{e.preventDefault();start=point(e);surface.setPointerCapture(e.pointerId);};
  surface.onpointermove=e=>{if(!start)return;const end=point(e);f.rect={x:Math.min(start.x,end.x),y:Math.min(start.y,end.y),width:Math.abs(end.x-start.x),height:Math.abs(end.y-start.y)};overlay.hidden=false;overlay.style.cssText=`left:${f.rect.x*100}%;top:${f.rect.y*100}%;width:${f.rect.width*100}%;height:${f.rect.height*100}%`;};
  surface.onpointerup=()=>{start=null;};
}
async function nbFigureInsert(){
  const f=nb.figure;if(!f?.rect||f.rect.width<.01||f.rect.height<.01){toast(tr('발췌할 영역을 드래그하세요.'));return;}
  const engine=await pdfEngine(),image=await engine.selectionImage(f.pdf,f.page,f.rect),hash=await window.appApi.notebookAssetPut(state.storageKey,image);
  // The box takes the crop's own proportions (plus its caption line), so no blank band shows around the picture.
  const target=nbPage(nbTargetPage())||{width:NB_W,height:NB_H},picture=new Image();picture.src=image;await picture.decode();
  const ratio=picture.naturalHeight/picture.naturalWidth,w=Math.min(480,target.width-60,Math.max(120,f.rect.width*target.width),(Math.min(target.height-120,4000-14))/ratio),source={...nbSourceNow(),page:f.page};
  dialog.close();nb.figure=null;nbAddItem({type:'image',x:50,y:80,w:Math.round(w),h:Math.round(w*ratio+14),asset:hash,source});
}
dialog.addEventListener('close',()=>{if(nb.figure){nb.figure=null;dialog.classList.remove('figure-dialog');}});
// In 그림으로 넣기, scrolling on past the end of the page turns to the next page (and back past the top).
let nbWheelAt=0;
dialog.addEventListener('wheel',event=>{
  const f=nb.figure,box=event.target.closest?.('.figure-scroll');if(!f||!box||event.ctrlKey)return;
  const down=event.deltaY>0,atEnd=down?box.scrollTop+box.clientHeight>=box.scrollHeight-2:box.scrollTop<=1,input=document.querySelector('#nb-fig-page');if(!atEnd||!input)return;
  const next=Number(input.value)+(down?1:-1);if(next<1||next>f.pdf.numPages)return;event.preventDefault();
  if(performance.now()-nbWheelAt<450)return;nbWheelAt=performance.now();input.value=next;
  runDesktop(async()=>{await nbFigureLoad();box.scrollTop=down?0:box.scrollHeight;})();
},{passive:false});
// A picture pasted into the notebook (not into a text box) goes on the page in view, fitted to it.
document.addEventListener('paste',event=>{
  if(state.screen!=='reader'||state.mode!=='notebook'||!nb.doc||dialog.open||event.target.closest?.('textarea,input,[contenteditable="true"]'))return;
  const file=[...(event.clipboardData?.items||[])].find(i=>i.kind==='file'&&i.type.startsWith('image/'))?.getAsFile();if(!file)return;event.preventDefault();
  const vault=state.storageKey;
  runDesktop(async()=>{
    const bitmap=await createImageBitmap(file),k=Math.min(1,2000/Math.max(bitmap.width,bitmap.height)),canvas=document.createElement('canvas');canvas.width=Math.round(bitmap.width*k);canvas.height=Math.round(bitmap.height*k);canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);
    const hash=await window.appApi.notebookAssetPut(vault,canvas.toDataURL('image/png'));if(state.storageKey!==vault)return;
    const page=nbPage(nbTargetPage())||{width:NB_W,height:NB_H},w=Math.min(page.width-80,Math.max(80,bitmap.width*.75)),h=w*bitmap.height/bitmap.width;
    const fit=Math.min(1,Math.min(page.board?4000:page.height-80,4000)/h);nbAddItem({type:'image',x:40,y:60,w:Math.round(w*fit),h:Math.round(h*fit),asset:hash});toast(tr('그림을 노트북에 넣었습니다.'));
  })();
});
let nbQuote='';document.addEventListener('pointerdown',event=>{if(event.target.closest('[data-action="nb-card"]'))nbQuote=String(window.getSelection()||'').trim().slice(0,4000);},true);
Object.assign(actions,{
  'nb-new':()=>{modal(tr('새 노트북'),`<label for="nb-title">${tr('이름')}</label><input id="nb-title" maxlength="200" value="${tr('{title} 노트',{title:esc(selected()?.title?.slice(0,80)||tr('노트북'))})}"><label class="collection-choice"><input type="checkbox" id="nb-project"> ${tr('프로젝트 노트북 (특정 자료에 묶지 않음)')}</label>`,btn(tr('취소'),'close')+btn(tr('만들기'),'nb-create','primary'));document.querySelector('#nb-title').select();},
  'nb-rename':()=>{if(!nb.doc)return;modal(tr('노트북 이름 바꾸기'),`<label for="nb-rename-title">${tr('이름')}</label><input id="nb-rename-title" maxlength="200" required value="${esc(nb.doc.title)}">`,btn(tr('취소'),'close')+btn(tr('바꾸기'),'nb-rename-go','primary'));const input=document.querySelector('#nb-rename-title');input.focus();input.select();},
  'nb-rename-go':()=>{const input=document.querySelector('#nb-rename-title'),title=input?.value.trim();if(!nb.doc||!input)return;if(!title){input.value='';input.reportValidity();return;}dialog.close();if(title===nb.doc.title)return;nb.doc.title=title;const item=nb.list.find(n=>n.id===nb.doc.id);if(item)item.title=title;nbSave(true);nbRender();},
  'nb-delete':()=>{if(!nb.doc)return;modal(tr('노트북 삭제'),`<p>${tr('<strong>{title}</strong> · {n}쪽',{title:esc(nb.doc.title),n:nb.doc.pages.length})}</p><p>${tr('휴지통으로 옮깁니다. 저장소 관리의 휴지통에서 되살릴 수 있습니다. 페이지에 넣은 메모는 메모 탭에 남습니다.')}</p>`,btn(tr('취소'),'close')+`<button class="danger" data-action="nb-delete-go">${tr('휴지통으로 옮기기')}</button>`);},
  'nb-delete-go':runDesktop(async()=>{
    if(!nb.doc)return;const vault=nb.vault||state.storageKey,id=nb.doc.id,title=nb.doc.title;dialog.close();
    nbSyncMemos();await nbFlush();await window.appApi.notebookRemove(vault,id);nbDetached.delete(id);await nbAfterList(vault);
    undoToast(tr('노트북 ‘{title}’을(를) 휴지통으로 옮겼습니다.',{title}),async()=>{await window.appApi.notebookRestore(vault,id);if(nb.vault!==vault)return;await nbFlush();nb.list=await window.appApi.notebookList(vault);nb.id=id;nb.doc=await window.appApi.notebookGet(vault,id);try{localStorage.setItem('app-notebook-'+nb.key,id);}catch{}nb.status='';nbRender();});
  }),
  'nb-create':runDesktop(async()=>{const title=document.querySelector('#nb-title').value.trim()||tr('노트북'),project=document.querySelector('#nb-project').checked;dialog.close();await nbFlush();const doc=await window.appApi.notebookCreate(state.storageKey,title,project?null:state.selected);nb.doc=doc;nb.id=doc.id;try{localStorage.setItem('app-notebook-'+nb.key,doc.id);}catch{}nb.list=await window.appApi.notebookList(state.storageKey);nb.status='';nbRender();}),
  // The notebook in its own window; this window goes back to 동시보기 so the two never edit it at once.
  'nb-window':runDesktop(async()=>{if(!nb.doc)return;nbSyncMemos();await nbFlush();const id=nb.doc.id;await window.appApi.notebookWindow(state.storageKey,state.selected,id);nbDetached.add(id);if(state.mode==='notebook'){state.mode='dual';render();}}),
  'nb-export':runDesktop(async()=>{if(nbSyncMemos())nbSave();await nbFlush();if(await window.appApi.notebookExport(state.storageKey,nb.doc.id))toast(tr('노트북 PDF를 저장했습니다.'));}),
  'nb-notes-md':runDesktop(async()=>{await desktopNotes();if(await window.appApi.notesExport(state.storageKey,state.selected))toast(tr('노트를 Markdown으로 저장했습니다.'));}),
  'nb-text':()=>{const id=nbId();nbAddItem({id,type:'text',x:50,y:80,w:300,h:90,text:'',...nbTextStart()});const box=document.querySelector(`.nb-text[data-item-id="${id}"]`);if(box)requestAnimationFrame(()=>nbEditText(box));},
  'nb-card':()=>{const quote=nbQuote;nbQuote='';nbAddItem({type:'source',x:50,y:80,w:320,h:quote?110:44,source:nbSourceNow(),quote});},
  'nb-memo':()=>nbMemoPick(document.querySelector('[data-action="nb-memo"]')),'nb-memo-create':()=>{closePopMenu();nbMemoCreate();},'nb-figure':runDesktop(nbFigure),'nb-fig-load':runDesktop(nbFigureLoad),'nb-fig-insert':runDesktop(nbFigureInsert),
  'nb-add-page':async()=>{const choice=nbNewPageChoice();if(choice.size==='custom'){nbAskCustomSize();return;}const size=choice.size==='original'?await nbOriginalSize():NB_SIZES[choice.size]||NB_SIZES.a4;nbChange('페이지 추가',()=>nb.doc.pages.push(nbNewPage(choice.template,size,choice.board)));nbRender();nbShowPage(document.querySelector('.nb-page-wrap:last-of-type'));}, // i18n:keep — the undo label (not shown)
  'nb-add-same':()=>{if(!nb.doc?.pages.length)return;if(nb.doc.pages.length>=NB_MAX_PAGES){toast(tr('노트북에는 {n}쪽까지 넣을 수 있습니다.',{n:NB_MAX_PAGES}));return;}nbChange('페이지 추가',()=>nb.doc.pages.push(nbSameAsLast()));nbRender();nbShowPage(document.querySelector('.nb-page-wrap:last-of-type'));document.querySelector('.nb-add-same')?.focus({preventScroll:true});}, // i18n:keep — the undo label (not shown)
  'nb-custom-add':()=>{const w=document.querySelector('#nb-custom-w'),h=document.querySelector('#nb-custom-h');if(!w.reportValidity()||!h.reportValidity())return;const size={w:Math.round(Number(w.value)*NB_MM*100)/100,h:Math.round(Number(h.value)*NB_MM*100)/100};try{localStorage.setItem('app-nb-custom',JSON.stringify(size));localStorage.setItem('app-nb-size','custom');}catch{}Object.assign(NB_SIZES.custom,size);dialog.close();const template=nbTemplateChoice();nbChange('페이지 추가',()=>nb.doc.pages.push(nbNewPage(template,size,nbBoardChoice())));nbRender();nbShowPage(document.querySelector('.nb-page-wrap:last-of-type'));}, // i18n:keep — the undo label (not shown)
  'nb-add-pdf':runDesktop(nbAddPdf),'nb-add-pdf-go':runDesktop(nbAddPdfGo)
});
document.addEventListener('change',event=>{
  if(event.target.matches('.nb-select'))runDesktop(async()=>{await nbFlush();nb.id=event.target.value||null;nb.doc=nb.id?await window.appApi.notebookGet(state.storageKey,nb.id):null;try{localStorage.setItem('app-notebook-'+nb.key,nb.id||'');}catch{}nb.status='';nbRender();})();
});
document.addEventListener('input',event=>{const area=event.target.closest('.nb-text textarea');if(!area||!nb.doc)return;const id=area.closest('[data-item-id]').dataset.itemId;for(const page of nb.doc.pages){const item=page.items.find(i=>i.id===id);if(item){item.text=area.value.slice(0,20000);nbSave();}}});
// Text edits are one undo step per focus, not one per keystroke.
// One editing of a box, from opening it to ending it, is one undo step: its text and every look chosen meanwhile, also
// a colour of one's own picked in the system's colour dialog (which takes the focus from the box while it is open).
let nbTextBefore=null;
function nbTextStepStart(){if(!nbTextBefore&&nb.doc)nbTextBefore={id:nb.doc.id,pages:JSON.stringify(nb.doc.pages)};}
function nbTextStepEnd(){const step=nbTextBefore;nbTextBefore=null;if(!step||nb.doc?.id!==step.id)return;const before=step.pages,after=JSON.stringify(nb.doc.pages),id=step.id;if(before!==after)globalThis.appInk.record({custom:true,label:'텍스트',undo:()=>{if(nb.doc?.id!==id)return;nb.doc.pages=JSON.parse(before);nbSave();nbRender();},redo:()=>{if(nb.doc?.id!==id)return;nb.doc.pages=JSON.parse(after);nbSave();nbRender();}});} // i18n:keep — the undo label (not shown)
document.addEventListener('click',event=>{
  const action=event.target.closest('[data-nb-selection]');if(action){if(action.dataset.nbSelection==='delete')nbSelDelete();else nbSelDuplicate();return;}
  // As on PDF pages: the lasso, the hand and the select tool keep a selection; the drawing tools let go of it.
  if(event.target.closest('[data-ink-tool],[data-ink-pick]')&&nb.sel&&!['hand','lasso','read'].includes(globalThis.appInk.tool))nbSelect(null);
  const remove=event.target.closest('.nb-item [data-nb-remove]');if(remove){nbRemoveItem(remove.closest('[data-item-id]').dataset.itemId);return;}
  const op=event.target.closest('[data-nb-page]');if(op){const id=op.dataset.pageId,pages=nb.doc.pages,i=pages.findIndex(p=>p.id===id);if(i<0)return;
    nbChange('페이지',()=>{if(op.dataset.nbPage==='dup')pages.splice(i+1,0,{...JSON.parse(JSON.stringify(pages[i])),id:nbId(),items:pages[i].items.map(it=>({...it,id:nbId()})),strokes:pages[i].strokes.map(s=>({...s,id:nbId()}))});if(op.dataset.nbPage==='up'&&i>0)[pages[i-1],pages[i]]=[pages[i],pages[i-1]];if(op.dataset.nbPage==='down'&&i<pages.length-1)[pages[i+1],pages[i]]=[pages[i],pages[i+1]];if(op.dataset.nbPage==='delete'&&pages.length>1)pages.splice(i,1);if(op.dataset.nbPage==='trim'&&!nbTrimBoard(pages[i]))toast(tr('잘라낼 빈 아래쪽이 없습니다.'));});nbRender();return;} // i18n:keep — the undo label (not shown)
  // A source card opens its paper's page; another paper opens in the reader.
  const link=event.target.closest('[data-nb-source]');if(link){const page=Number(link.dataset.nbSource),paperId=Number(link.dataset.nbPaper);
    if(paperId===state.selected){const viewer=document.querySelector('.original-pages')?.pdfViewer;if(viewer&&page<=viewer.pagesCount)viewer.currentPageNumber=page;}
    else runDesktop(async()=>{await nbFlush();await openItemFile(paperId,link.dataset.nbAttachment);const container=document.querySelector('.original-pages');if(container)container.restorePage=page;})();}
});
window.addEventListener('beforeunload',()=>{if(nb.dirty)nbFlush();});
globalThis.appNotebookFlush=()=>nb.dirty?nbFlush().catch(()=>{}):undefined;

// ---- Text boxes: a box moves like a picture (drag it anywhere); a double click edits its text with
// the same format bar as a text box on a PDF page (colour panel, size, bold / italic / underline,
// alignment, lists, delete, 완료). Esc or 완료 ends editing and goes back to the reading tool.
// A box keeps its look in its own fields (size, bold, italic, underline, colour, align, fill, border); a new box has no
// fill or border.
function nbEditText(box){
  const area=box?.querySelector('textarea'),item=box&&nbItemOf(box.dataset.itemId);if(!area||!item||!nb.doc)return;
  document.querySelectorAll('.nb-text.editing').forEach(b=>{if(b!==box)nbEndText(b);});
  nbTextStepStart();
  box.classList.add('editing');area.readOnly=false;area.tabIndex=0;area.focus({preventScroll:true});area.setSelectionRange(area.value.length,area.value.length);
  const look=globalThis.appInkMarks.textLook(item),style={color:globalThis.appInkMarks.hexColor(item.color)||'#000000',size:item.size||12,bold:Boolean(item.bold),italic:Boolean(item.italic),underline:Boolean(item.underline),align:['center','right'].includes(item.align)?item.align:'left',fill:look.fill,border:look.border?{...look.border}:null};
  globalThis.appInk.textBar.open({box,area,style,
    apply(){const it=nbItemOf(box.dataset.itemId);if(!it)return;it.size=style.size;
      for(const k of ['bold','italic','underline'])if(style[k])it[k]=true;else delete it[k];
      // An untouched box keeps its default colour (no field); a colour chosen is kept.
      if(style.color!==(it.color||'#000000'))it.color=style.color;
      if(style.align==='left')delete it.align;else it.align=style.align;
      if(style.fill)it.fill=style.fill;else delete it.fill;
      if(style.border)it.border={color:style.border.color,width:style.border.width,style:style.border.style};else delete it.border;
      area.setAttribute('style',nbTextStyle(it));nbSave();},
    remove(){const id=box.dataset.itemId;nbEndText(box);nbChange('삭제',()=>{for(const page of nb.doc.pages)page.items=page.items.filter(i=>i.id!==id);});nbRender();globalThis.appInk.setTool?.('read');}, // i18n:keep — the undo label (not shown)
    done(){area.blur();nbEndText(box);globalThis.appInk.setTool?.('read');},
    outside(){nbEndText(box);},
    lost(){nbEndText(box);}});
}
// A new box starts in the text colour and size chosen last (kept on this computer), as on PDF pages; 24pt before any.
const nbTextStart=()=>{const c=globalThis.appInk.textBar.color,size=globalThis.appInk.textBar.size;return {size:size||24,...(c?{color:c}:{})};};
function nbEndText(box){
  if(!box)return;const was=box.classList.contains('editing');box.classList.remove('editing');const area=box.querySelector('textarea');if(area){area.readOnly=true;area.tabIndex=-1;}
  const bar=globalThis.appInk.textBar;if(bar.target?.box===box)bar.close();
  if(was)nbTextStepEnd();
}
// Double click a box (with the reading tool) to edit it.
document.addEventListener('dblclick',event=>{const box=event.target.closest('.nb-text');if(!box||box.classList.contains('editing'))return;event.preventDefault();nbEditText(box);});
// Leaving the text (except for its format bar and panels) ends editing, so the box moves again when dragged.
document.addEventListener('focusout',event=>{const box=event.target.closest?.('.nb-text.editing');if(!box||event.target.tagName!=='TEXTAREA')return;const bar='.ink-text-bar,.ink-text-pop';if(event.relatedTarget?.closest?.(bar)||box.contains(event.relatedTarget))return;setTimeout(()=>{if(!box.contains(document.activeElement)&&!document.activeElement?.closest?.(bar))nbEndText(box);});});

// The page number in the tool row (as the PDF pane has it): the page at the top of the view, of how
// many; ‹ › and a number typed there go to a page.
function nbCurrentPage(){const list=document.querySelector('.nb-pages');if(!list)return 1;const top=list.getBoundingClientRect().top,pages=[...list.querySelectorAll('.nb-page')];const i=pages.findIndex(el=>el.getBoundingClientRect().bottom>top+2);return i<0?pages.length||1:i+1;}
// Room under the last page, so that it too can be scrolled to the top of the view (and so counted as
// the page being looked at), however short it is beside the pane.
function nbEndSpace(){const list=document.querySelector('.nb-pages'),last=list?.querySelector('.nb-page-wrap:last-of-type');if(!last)return;const space=Math.max(0,list.clientHeight-last.offsetHeight-2-40)+'px'; /* 2: the list's top padding; 40: the +'s own strip (library.css) */if(list.style.getPropertyValue('--nb-end-space')!==space)list.style.setProperty('--nb-end-space',space);}
// The + under the last page shows only with the list at its end (library.css .nb-at-end).
function nbAtEnd(){const list=document.querySelector('.nb-pages');if(list)list.classList.toggle('nb-at-end',list.scrollTop+list.clientHeight>=list.scrollHeight-4);}
function nbPageNav(){nbEndSpace();nbAtEnd();const input=document.querySelector('.nb-page-input');if(!input||!nb.doc)return;if(document.activeElement!==input)input.value=String(nbCurrentPage());const total=document.querySelector('.nb-page-total');if(total)total.textContent=tr('의 {total}',{total:nb.doc.pages.length});}
// A page (or what is on it) brought to the top of the notebook pane by scrolling the pane alone: scrollIntoView would also
// scroll the hidden boxes around it (the reader, the window's main area) when the pane cannot go far enough, which
// pushes the whole reader up and leaves an empty band under it.
function nbShowPage(node){const list=document.querySelector('.nb-pages');if(!list||!node)return;list.scrollTop+=node.getBoundingClientRect().top-list.getBoundingClientRect().top;nbPageNav();}
function nbGoToPage(number){const list=document.querySelector('.nb-pages'),pages=list?[...list.querySelectorAll('.nb-page-wrap')]:[];if(!pages.length||!Number.isFinite(number))return;nbShowPage(pages[Math.max(1,Math.min(pages.length,Math.round(number)))-1]);}
document.addEventListener('click',event=>{const step=event.target.closest('[data-nb-step]');if(step)nbGoToPage(nbCurrentPage()+Number(step.dataset.nbStep));});
document.addEventListener('keydown',event=>{const input=event.target.closest?.('.nb-page-input');if(!input||event.key!=='Enter')return;event.preventDefault();nbGoToPage(Number(input.value));input.blur();});
document.addEventListener('focusout',event=>{if(event.target.classList?.contains('nb-page-input'))setTimeout(nbPageNav,0);});
// 페이지 추가 (the + in the tool row): the new page's form and size, then 추가; or pages from a PDF.
// A page's own ⋯ (at its top right corner): its form, a copy, its place, removal.
document.addEventListener('click',event=>{
  const add=event.target.closest('[data-nb-add]'),more=event.target.closest('[data-nb-page-menu]');if(!add&&!more||!nb.doc)return;event.preventDefault();event.stopPropagation();
  const anchor=add||more;if(anchor.getAttribute('aria-expanded')==='true'){closePopMenu(true);return;}
  if(add){
    const template=nbTemplateChoice(),size=nbSizeChoice();
    openPopMenu(add,`<p class="pop-menu-title">${tr('새 페이지')}</p><div class="nb-new-templates" role="radiogroup" aria-label="${tr('양식')}">${Object.entries(NB_TEMPLATES).map(([id,label])=>`<label class="nb-new-template"><input type="radio" name="nb-new-template" value="${id}" ${id===template?'checked':''}><span class="nb-swatch" data-template="${id}" aria-hidden="true"></span><span>${label}</span></label>`).join('')}</div><label class="nb-new-size"><span>${tr('크기')}</span><select class="nb-size" aria-label="${tr('새 페이지 크기')}">${Object.entries(NB_SIZES).map(([id,s])=>`<option value="${id}" ${id===size?'selected':''}>${s.label}</option>`).join('')}</select></label><label class="nb-new-board" title="${tr('폭은 고른 크기를 따르고, 아래에 쓰면 그만큼 계속 늘어납니다. PDF로는 같은 폭의 A4 비율 쪽들로 나뉩니다.')}"><input type="checkbox" name="nb-new-board" ${nbBoardChoice()?'checked':''}> ${tr('화이트보드 — 아래로 계속 늘어남')}</label><button type="button" class="nb-new-go" role="menuitem" data-action="nb-add-page">${tr('페이지 추가')}</button><hr><button type="button" role="menuitem" data-action="nb-add-pdf" title="${tr('다른 PDF의 쪽을 노트북 페이지로 넣습니다')}">${tr('PDF에서 가져오기…')}</button>`,tr('페이지 추가'));
    popMenu.el.classList.add('nb-add-menu');return;
  }
  const id=more.dataset.nbPageMenu,pages=nb.doc.pages,i=pages.findIndex(p=>p.id===id);if(i<0)return;
  openPopMenu(more,`<p class="pop-menu-title">${tr('{n}쪽 양식',{n:i+1})}</p>${Object.entries(NB_TEMPLATES).map(([t,label])=>`<button type="button" role="menuitemradio" aria-checked="${pages[i].template===t}" data-nb-set-template="${t}" data-page-id="${esc(id)}"><span class="nb-swatch" data-template="${t}" aria-hidden="true"></span>${label}</button>`).join('')}<hr><button type="button" role="menuitem" data-nb-page="dup" data-page-id="${esc(id)}">${tr('복제')}</button><button type="button" role="menuitem" data-nb-page="up" data-page-id="${esc(id)}" ${i?'':'disabled'}>${tr('위로 옮기기')}</button><button type="button" role="menuitem" data-nb-page="down" data-page-id="${esc(id)}" ${i<pages.length-1?'':'disabled'}>${tr('아래로 옮기기')}</button>${pages[i].board?`<button type="button" role="menuitem" data-nb-page="trim" data-page-id="${esc(id)}">${tr('빈 아래쪽 잘라내기')}</button>`:''}<button type="button" role="menuitem" class="danger" data-nb-page="delete" data-page-id="${esc(id)}" ${pages.length>1?'':'disabled'}>${tr('삭제')}</button>`,tr('{n}쪽 메뉴',{n:i+1}));
  popMenu.el.classList.add('nb-page-menu');
},true);
document.addEventListener('click',event=>{const set=event.target.closest('[data-nb-set-template]');if(!set||!nb.doc)return;const page=nbPage(set.dataset.pageId);if(!page||page.template===set.dataset.nbSetTemplate)return;nbChange('양식',()=>{page.template=set.dataset.nbSetTemplate;});nbRender();}); // i18n:keep — the undo label (not shown)

// The open notebook's ⋯ menu: rename it, or move it to the trash (저장소 관리 › 휴지통 brings it back).
document.addEventListener('click',event=>{
  const b=event.target.closest('[data-nb-menu]');if(!b||!nb.doc)return;event.preventDefault();event.stopPropagation();
  if(b.getAttribute('aria-expanded')==='true'){closePopMenu(true);return;}
  openPopMenu(b,`<button type="button" role="menuitem" data-action="nb-rename">${tr('이름 바꾸기…')}</button><button type="button" role="menuitem" class="danger" data-action="nb-delete">${tr('노트북 삭제…')}</button>`,tr('노트북 메뉴'));
},true);
// A notebook back from the trash (저장소 관리) shows in the list at once.
globalThis.appNotebookListChanged=async()=>{if(!nb.vault||nb.vault!==state.storageKey)return;nb.list=await window.appApi.notebookList(nb.vault);nbRender();};
// After a notebook leaves the list: another of the paper's, else none (노트북 선택…).
async function nbAfterList(vault){nb.list=await window.appApi.notebookList(vault);if(nb.vault!==vault)return;const next=nb.list.find(n=>n.paperId===state.selected)||null;nb.id=next?.id||null;nb.doc=next?await window.appApi.notebookGet(vault,next.id):null;try{localStorage.setItem('app-notebook-'+nb.key,nb.id||'');}catch{}nb.sel=null;nb.status='';nbRender();}
// The notebook's 저장 menu: the notebook as PDF, and the paper's notes as Markdown.
document.addEventListener('click',event=>{
  const b=event.target.closest('[data-nb-save-menu]');if(!b)return;event.preventDefault();event.stopPropagation();
  if(b.getAttribute('aria-expanded')==='true'){closePopMenu(true);return;}
  openPopMenu(b,`${nb.doc?`<button type="button" role="menuitem" data-action="nb-export">${tr('노트북 PDF 저장')}</button>`:''}${nbWindow?'':`<button type="button" role="menuitem" data-action="nb-notes-md" title="${tr('이 자료의 서지·요약·메모·주석을 Markdown으로 저장')}">${tr('노트 Markdown 저장')}</button>`}`,tr('노트북 저장'));
},true);
