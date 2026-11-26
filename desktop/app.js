// The screen's base, under the desktop scripts (renderer.js and the rest draw the start screen, the library, the reader
// and the side panel): the screen state, icons, dialogs and notices, the sidebars (pin, peek, resize), the top bar,
// and the one place clicks, typing and keys are handed out (actions). Nothing is drawn here until renderer.js has the vault.
const app=document.querySelector('#app'),dialog=document.querySelector('#dialog');
// An error nothing caught goes to the local diagnostic record (main.cjs page-error): its message and
// stack only, never what is on the page. The same error is reported once.
{const told=new Set(),tell=(kind,error)=>{const message=String(error?.message??error??'').slice(0,2000),stack=String(error?.stack||'').split('\n').slice(1,9).join('\n'),key=kind+message;if(!message||told.has(key)||told.size>200)return;told.add(key);window.appApi?.reportError?.(kind,(error?.name&&error.name!=='Error'?error.name+': ':'')+message,stack);};
 // A failure a script goes on past (the picture of a question not saved, a snippet not read) is recorded the same way.
 globalThis.quietError=(kind,error)=>tell(kind,error);
 window.addEventListener('error',event=>tell('error',event.error||event.message));
 window.addEventListener('unhandledrejection',event=>tell('rejection',event.reason));}
const paths={vault:'M3 4h18v5H3z M5 9v11h14V9 M10 13h4',star:'M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8L3.5 9.7l5.9-.9z',panelLeft:'M3 4h18v16H3z M9 4v16',panelRight:'M3 4h18v16H3z M15 4v16',folder:'M3 6h6l2 2h10v12H3z',folderPlus:'M3 6h6l2 2h10v12H3z M12 11v6 M9 14h6',pagePlus:'M6 3h9l4 4v14H6z M15 3v4h4 M12 11v6 M9 14h6',book:'M3 4h7l2 2 2-2h7v16h-7l-2 2-2-2H3z M12 6v16',search:'M20 20l-5-5 M16 9a7 7 0 1 1-14 0 7 7 0 0 1 14 0',grid:'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',settings:'M4 7h16 M4 17h16 M8 4v6 M16 14v6',arrow:'M5 12h14 M13 6l6 6-6 6',back:'M19 12H5 M11 6l-6 6 6 6',plus:'M12 4v16 M4 12h16',trash:'M3 6h18 M9 6V3h6v3 M6 6l1 15h10l1-15',refresh:'M20 7v5h-5 M4 17v-5h5 M6 7a7 7 0 0 1 12-2l2 3 M4 16l2 3a7 7 0 0 0 12-2',download:'M12 3v12 M7 10l5 5 5-5 M4 16v5h16v-5',stop:'M6 6h12v12H6z',activity:'M2 12h5l3-8 4 16 3-8h5'};
const icon=n=>`<span class="icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="${paths[n]||paths.book}"/></svg></span>`;
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
// The open vault's papers (renderer.js applySnapshot fills it).
const papers=[];
let state={leftCollapsed:false,rightCollapsed:false,split:50,screen:'welcome',storageKey:null,name:'',selected:null,nav:'전체 자료',filter:'전체',query:'',sort:'recent',mode:'original',tab:'메모'}; // i18n:keep — initial navigation, filter and tab values
// What is shown for a value the code keeps and compares in Korean (read status, navigation, filter, tab): the value stays, the label follows the display language.
// Only for these fixed values: never for a reader's own tag or collection names, which are shown as written (a tag named '메모' or '전체' stays so).
// The heading of a view: the app's own views (all items, recently read, favorites) in the display language; any other view is named by the reader (a folder, collection, tag or saved search) and keeps its name.
function navLabel(nav){return !state.collection&&!state.desktopTag&&!state.savedSearch&&['전체 자료','최근 읽은 자료','즐겨찾기'].includes(nav)?valueLabel(nav):nav;} // i18n:keep — the app's own view values; a collection, tag or saved search keeps its own name
function valueLabel(value){return ({'읽기 전':tr('읽기 전'),'읽는 중':tr('읽는 중'),'완독':tr('완독'),'전체 자료':tr('전체 자료'),'최근 읽은 자료':tr('최근 읽은 자료'),'즐겨찾기':tr('즐겨찾기'),'전체':tr('전체'),'번역 있음':tr('번역 있음'),'서지':tr('서지'),'첨부':tr('첨부'),'요약':tr('요약'),'주석':tr('주석'),'메모':tr('메모'),'태그':tr('태그')})[value]??value;} // i18n:keep — the keys are those values
// Keys the page kept under the app's earlier names move to the new prefix once, before any is read (desktop/storage-keys.js).
try{appStorageKeys.adoptStorageKeys(localStorage);}catch{}
// Memo and summary texts of the open vault, by key (renderer.js fills and saves them).
let notes={};
// One render asks for the visible papers many times; the list is kept until
// the current task ends (or the paper list or vault changes), not refiltered each time.
let availableMemo=null;
const availablePapers=()=>{if(availableMemo&&availableMemo.length===papers.length&&availableMemo.key===state.storageKey)return availableMemo.list;const list=papers.filter(p=>(p.attachments?!p.trashedAt:fullPdfs.get(p.id)?.original)&&p.storageKey===state.storageKey);if(!availableMemo)queueMicrotask(()=>{availableMemo=null;});availableMemo={list,length:papers.length,key:state.storageKey};return list;};
const selected=()=>{const list=availablePapers();return list.find(p=>p.id===state.selected)||list[0]||papers.find(p=>p.id===state.selected)||papers[0];};
// The logo: the app icon and the word mark, drawn from brand/<id>-mark.svg and brand/<id>-wordmark.svg (scripts/build.mjs
// gives them as appLogo), not set in a font. The word mark's dark ink follows the screen's text colour and its lighter
// part (.logo-word-note in app.css) is lighter still; the yellow stays the same on light and dark screens.
const logo=()=>'<div class="logo" aria-label="'+esc(appName.name)+'">'+(globalThis.appLogo?.mark||'')+(globalThis.appLogo?.word||'')+'<span hidden></span></div>';
const btn=(label,action,cls='secondary')=>`<button class="${cls}" data-action="${action}">${label}</button>`;
// ms: how long it stays; a notice of two sentences is given longer to be read.
function toast(msg,ms){ms=typeof ms==='number'&&ms>0?ms:3200;const t=document.querySelector('#toast');t.textContent=msg;t.classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>t.classList.remove('show'),ms)}
function modal(title,body,actions=''){dialog.innerHTML=`<div class="dialog-inner"><div class="dialog-head"><h2>${title}</h2><button class="close" data-action="close" aria-label="${tr('닫기')}">×</button></div>${body}${actions?`<div class="actions">${actions}</div>`:''}</div>`;dialog.showModal()}
function sidebarButtons(side){return `<div class="sidebar-buttons" data-sidebar-buttons="${side}">${sidebarToggle(side)}</div>`}
function sidebarEdges(side){return `<div class="sidebar-edge ${side}-edge" data-sidebar-edge="${side}" aria-hidden="true"></div>`+(side==='right'?panelResizeHandle():'')}
// The top bar's sidebar buttons are always there, one at each end: pressed, the sidebar on that side opens or closes
// (a closed one also peeks while the button is pointed at). Its name says which it will do.
const sidebarOpenerLabel=side=>{const label=side==='left'?tr('탐색'):tr('메모·정보');return state[side+'Collapsed']?tr('{label} 사이드바 열기',{label}):tr('{label} 사이드바 닫기',{label});};
function sidebarOpener(side){const name=sidebarOpenerLabel(side);return `<button class="round-button sidebar-opener" data-sidebar-open="${side}" data-action="toggle-${side}" aria-controls="${side==='left'?'navigation-panel':'notes-panel'}" aria-expanded="${!state[side+'Collapsed']}" aria-label="${name}" title="${name}">${icon(side==='left'?'panelLeft':'panelRight')}</button>`}
function sidebarToggle(side){const label=side==='left'?tr('탐색'):tr('메모·정보'),collapsed=state[side+'Collapsed'];return `<button class="round-button sidebar-toggle close-sidebar" data-sidebar-toggle="${side}" data-action="${collapsed?'pin':'close'}-${side}" aria-controls="${side==='left'?'navigation-panel':'notes-panel'}" aria-expanded="${!collapsed}" aria-label="${collapsed?tr('{label} 사이드바 고정',{label}):tr('{label} 사이드바 닫기',{label})}" title="${collapsed?tr('{label} 사이드바 고정',{label}):tr('{label} 사이드바 닫기',{label})}"><span class="sidebar-close-icon">${icon(side==='left'?'back':'arrow')}</span><span class="sidebar-pin-icon">${icon(side==='left'?'panelLeft':'panelRight')}</span></button>`}

const sidebarTimers={};
function sidebarNode(side){return document.querySelector(side==='left'?'#navigation-panel':'#notes-panel')}
function syncSidebarControl(side){const collapsed=state[side+'Collapsed'],part=side==='left'?tr('탐색'):tr('메모·정보'),label=collapsed?tr('{label} 사이드바 고정',{label:part}):tr('{label} 사이드바 닫기',{label:part}),button=document.querySelector(`[data-sidebar-toggle="${side}"]`);if(button){button.dataset.action=(collapsed?'pin-':'close-')+side;button.title=label;button.setAttribute('aria-label',label);button.setAttribute('aria-expanded',String(!collapsed||document.querySelector('.shell')?.classList.contains(side+'-peek')))}const opener=document.querySelector(`[data-sidebar-open="${side}"]`);if(opener){opener.setAttribute('aria-expanded',String(!collapsed||document.querySelector('.shell')?.classList.contains(side+'-peek')));const name=sidebarOpenerLabel(side);opener.title=name;opener.setAttribute('aria-label',name);}}
function peekSidebar(side,open=true){clearTimeout(sidebarTimers[side]);if(!state[side+'Collapsed'])return;document.querySelector('.shell')?.classList.toggle(side+'-peek',open);syncSidebarControl(side)}
function setSidebarPinned(side,pinned){clearTimeout(sidebarTimers[side]);state[side+'Collapsed']=!pinned;const shell=document.querySelector('.shell');shell?.classList.toggle(side+'-collapsed',!pinned);shell?.classList.remove(side+'-peek');syncSidebarControl(side);const opener=document.querySelector(`[data-sidebar-open="${side}"]`);if(document.activeElement===opener)return;if(pinned)sidebarNode(side)?.querySelector('.sidebar-toggle')?.focus();else opener?.focus()}

function navigationLimits(){return {min:180,max:Math.max(180,Math.min(480,Math.floor(innerWidth*.45)))}}
function navigationWidth(){const {min,max}=navigationLimits();return Math.max(min,Math.min(max,Number(state.navigationWidth)||220))}
try{const width=Number(localStorage.getItem('app-navigation-width'));if(Number.isFinite(width)&&width>=180&&width<=480)state.navigationWidth=width}catch{}
function navigationResizeHandle(){const {min,max}=navigationLimits();return `<div class="navigation-resize" role="separator" tabindex="0" aria-label="${tr('탐색 사이드바 너비 조절')}" aria-controls="navigation-panel" aria-orientation="vertical" aria-valuemin="${min}" aria-valuemax="${max}" aria-valuenow="${navigationWidth()}" title="${tr('드래그 또는 방향키로 너비 조절 · 더블클릭으로 초기화')}"></div>`}
function setNavigationWidth(value,persist=true){const {min,max}=navigationLimits();state.navigationWidth=Math.max(min,Math.min(max,Math.round(value)));document.querySelector('.shell')?.style.setProperty('--navigation-width',state.navigationWidth+'px');const handle=document.querySelector('.navigation-resize');handle?.setAttribute('aria-valuenow',state.navigationWidth);handle?.setAttribute('aria-valuemax',max);if(persist)try{localStorage.setItem('app-navigation-width',String(state.navigationWidth))}catch{}}
window.addEventListener('resize',()=>setNavigationWidth(navigationWidth(),false));
// The right panel (bibliography, notes) resizes like the navigation; its handle sits on the panel's left edge.
function panelLimits(){return {min:240,max:Math.max(240,Math.min(640,Math.floor(innerWidth*.45)))}}
function panelDefault(){return 300}
function panelWidth(){const {min,max}=panelLimits();return Math.max(min,Math.min(max,Number(state.panelWidth)||panelDefault()))}
try{const width=Number(localStorage.getItem('app-panel-width'));if(Number.isFinite(width)&&width>=240&&width<=640)state.panelWidth=width}catch{}
function panelResizeHandle(){const {min,max}=panelLimits();return `<div class="panel-resize" role="separator" tabindex="0" aria-label="${tr('오른쪽 패널 너비 조절')}" aria-controls="notes-panel" aria-orientation="vertical" aria-valuemin="${min}" aria-valuemax="${max}" aria-valuenow="${panelWidth()}" title="${tr('드래그 또는 방향키로 너비 조절 · 더블클릭으로 초기화')}"></div>`}
function applyPanelWidth(width){const {max}=panelLimits();document.querySelector('.shell')?.style.setProperty('--panel-width',width+'px');for(const handle of document.querySelectorAll('.panel-resize')){handle.setAttribute('aria-valuenow',width);handle.setAttribute('aria-valuemax',max)}}
function setPanelWidth(value,persist=true){const {min,max}=panelLimits();state.panelWidth=Math.max(min,Math.min(max,Math.round(value)));applyPanelWidth(state.panelWidth);if(persist)try{localStorage.setItem('app-panel-width',String(state.panelWidth))}catch{}}
// A window resize re-clamps the width on screen only; it never stores a width the user did not choose.
window.addEventListener('resize',()=>applyPanelWidth(panelWidth()));
function splitHandle(){return `<div class="split-handle" role="separator" tabindex="0" aria-label="${tr('좌우 문서 크기 조절')}" aria-orientation="vertical" aria-valuemin="20" aria-valuemax="80" aria-valuenow="${state.split}" title="${tr('드래그 또는 방향키로 조절 · 더블클릭으로 반반')}"><span>⋮</span></div>`}
function setSplit(value){state.split=Math.max(20,Math.min(80,Math.round(value)));const shell=document.querySelector('.shell');shell?.style.setProperty('--split-left',state.split+'fr');shell?.style.setProperty('--split-right',(100-state.split)+'fr');document.querySelector('.split-handle')?.setAttribute('aria-valuenow',state.split)}
// Path on the left, the reader's view switch in the middle, search with the job and vault buttons on the right.
function topbar(){return `<header class="topbar"><div class="topbar-leading">${sidebarOpener('left')}${state.screen==='reader'?`<button class="row small topbar-back" data-action="back" title="${tr('라이브러리로 돌아가기')}">${icon('back')}<span class="back-label">${tr('라이브러리')}</span></button>`:''}</div><div class="topbar-center">${state.screen==='reader'?viewModes():''}</div><div class="topbar-trailing"><label class="search">${icon('search')}<input id="search" aria-label="${tr('현재 저장소 검색')}" placeholder="${tr('제목, 저자, 태그 검색')}" value="${esc(state.query)}"><kbd>Ctrl K</kbd></label><button class="round-button" data-action="jobs" title="${tr('작업')}" aria-label="${tr('작업')}">${icon('activity')}</button>${sidebarOpener('right')}</div></header>`}
function viewModes(){return `<div class="segmented reader-view-modes" role="group" aria-label="${tr('문서 보기')}">${[['original',tr('원문')],['translated',tr('번역')],['dual',tr('동시보기')]].map(([m,n])=>`<button data-mode="${m}" class="${state.mode===m?'active':''}">${n}</button>`).join('')}</div>`}
// The files of each paper the reader can open (renderer.js activateAttachment), by paper id.
const fullPdfs=new Map();
function reader(){
 return `<div class="reader-toolbar reader-mode-toolbar"></div><div class="reader-layout">${sidebarEdges('right')}<div class="pdf-comparison ${state.mode==='dual'?'dual':''}">${state.mode==='dual'?pdfPane('original')+splitHandle()+pdfPane('translated'):pdfPane(state.mode==='translated'?'translated':'original')}</div>${panel()}</div>`;
}
function render(){app.innerHTML=state.screen==='welcome'?welcome():`<div class="shell ${state.leftCollapsed?'left-collapsed':''} ${state.rightCollapsed?'right-collapsed':''}" style="--navigation-width:${navigationWidth()}px;--panel-width:${panelWidth()}px;--split-left:${state.split}fr;--split-right:${100-state.split}fr">${sidebar()}${navigationResizeHandle()}${sidebarEdges('left')}<main class="main">${topbar()}${state.screen==='reader'?reader():library()}</main></div>`}
// The buttons' actions (data-action); the later scripts add theirs (Object.assign(actions,…)).
const actions={
close:()=>dialog.close(),
'toggle-left':()=>setSidebarPinned('left',state.leftCollapsed),'toggle-right':()=>setSidebarPinned('right',state.rightCollapsed),'close-left':()=>setSidebarPinned('left',false),'close-right':()=>setSidebarPinned('right',false),'pin-left':()=>setSidebarPinned('left',true),'pin-right':()=>setSidebarPinned('right',true),
home:()=>{state.screen='welcome';render()},back:()=>{state.screen='library';render()}
};
document.addEventListener('click',e=>{let b=e.target.closest('[data-action]');if(b){actions[b.dataset.action]?.();return}let star=e.target.closest('[data-star]');if(star){papers.find(p=>p.id===Number(star.dataset.star)).star^=1;render();return}let p=e.target.closest('[data-paper]');if(p){state.selected=Number(p.dataset.paper);document.querySelectorAll('.paper-item').forEach(item=>item.classList.toggle('selected',Number(item.dataset.paper)===state.selected));document.querySelector('.detail').outerHTML=details();if(fullPdfs.get(state.selected)?.original)actions.read();return}let n=e.target.closest('[data-nav]');if(n){state.nav=n.dataset.nav;state.savedSearch=null;state.screen='library';state.query='';state.filter='전체';render();return}let f=e.target.closest('[data-filter]');if(f){state.filter=f.dataset.filter;render();return}let m=e.target.closest('[data-mode]');if(m){state.mode=m.dataset.mode;render();return}let t=e.target.closest('[data-tab]');if(t){state.tab=t.dataset.tab;document.querySelector('.reader-panel').outerHTML=panel()}}); // i18n:keep — filter value
document.addEventListener('dblclick',e=>{if(e.target.closest('[data-paper]')&&!e.target.closest('[data-star]'))actions.read()});
document.addEventListener('input',e=>{if(e.target.id==='search'){state.query=e.target.value;if(state.screen==='reader'){state.screen='library';render();const input=document.querySelector('#search');input.focus();input.setSelectionRange(input.value.length,input.value.length)}else document.querySelector('#paper-list').innerHTML=paperRows()}if(e.target.dataset.note)notes[e.target.dataset.note]=e.target.value;});
document.addEventListener('change',e=>{if(e.target.id==='sort'){state.sort=e.target.value;document.querySelector('#paper-list').innerHTML=paperRows()}});
document.addEventListener('keydown',e=>{if(e.isComposing)return;if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'&&!dialog.open){e.preventDefault();document.querySelector('#search')?.focus()}if(e.key==='Enter'&&e.target.matches('[data-paper]')){state.selected=Number(e.target.dataset.paper);actions.read()}});
document.addEventListener('keydown',e=>{if(!e.target.matches('.split-handle'))return;const values={ArrowLeft:state.split-2,ArrowRight:state.split+2,Home:20,End:80};if(e.key in values){e.preventDefault();setSplit(values[e.key])}});
document.addEventListener('dblclick',e=>{if(e.target.closest('.split-handle'))setSplit(50)});
document.addEventListener('pointerdown',e=>{
 const handle=e.target.closest('.split-handle');if(!handle||e.button!==0)return;
 e.preventDefault();handle.focus();const box=handle.parentElement.getBoundingClientRect();handle.setPointerCapture(e.pointerId);document.body.classList.add('resizing-pdfs');
 const move=event=>setSplit((event.clientX-box.left)/box.width*100);
 const stop=()=>{document.body.classList.remove('resizing-pdfs');handle.removeEventListener('pointermove',move);handle.removeEventListener('pointerup',stop);handle.removeEventListener('pointercancel',stop);handle.removeEventListener('lostpointercapture',stop)};
 handle.addEventListener('pointermove',move);handle.addEventListener('pointerup',stop);handle.addEventListener('pointercancel',stop);handle.addEventListener('lostpointercapture',stop);
});

// Hover previews stay open while interacting with the panel; click works on touch.
function sidebarTarget(target){return target?.closest?.('[data-sidebar],[data-sidebar-edge],[data-sidebar-open]')}
function deferSidebarClose(side){clearTimeout(sidebarTimers[side]);sidebarTimers[side]=setTimeout(()=>{const panel=sidebarNode(side),edge=document.querySelector(`[data-sidebar-edge="${side}"]`);if(panel?.matches(':hover')||edge?.matches(':hover')||document.querySelector(`[data-sidebar-open="${side}"]`)?.matches(':hover')||panel?.contains(document.activeElement))return;peekSidebar(side,false)},180)}
document.addEventListener('pointerover',e=>{if(e.pointerType==='touch')return;const el=sidebarTarget(e.target);if(!el)return;const side=el.dataset.sidebar||el.dataset.sidebarEdge||el.dataset.sidebarOpen;if(el.dataset.sidebarEdge||el.dataset.sidebarOpen){clearTimeout(sidebarTimers[side]);sidebarTimers[side]=setTimeout(()=>peekSidebar(side),250)}else peekSidebar(side)});
document.addEventListener('pointerout',e=>{const el=sidebarTarget(e.target);if(!el)return;const side=el.dataset.sidebar||el.dataset.sidebarEdge||el.dataset.sidebarOpen;const next=sidebarTarget(e.relatedTarget);if(next&&(next.dataset.sidebar||next.dataset.sidebarEdge||next.dataset.sidebarOpen)===side)return;deferSidebarClose(side)});
document.addEventListener('focusout',e=>{const el=sidebarTarget(e.target);if(el)deferSidebarClose(el.dataset.sidebar||el.dataset.sidebarEdge||el.dataset.sidebarOpen)});
document.addEventListener('click',e=>{if(sidebarTarget(e.target))return;for(const side of ['left','right'])peekSidebar(side,false)});
document.addEventListener('keydown',e=>{if(e.key!=='Escape'||dialog.open)return;for(const side of ['left','right']){if(document.querySelector('.shell')?.classList.contains(side+'-peek')){e.preventDefault();peekSidebar(side,false);document.querySelector(`[data-sidebar-open="${side}"]`)?.focus()}}});
// Esc leaves full screen (F11) once nothing on the page has used it: whatever closes, ends or lets go on Esc (a menu, a
// text box, a selection, a peeking sidebar) marks the key as used, and an open dialog takes it. On the window, so it
// comes after every handler on the page.
window.addEventListener('keydown',e=>{if(e.key!=='Escape'||e.defaultPrevented||e.isComposing||e.repeat||dialog.open||document.querySelector('dialog[open]'))return;window.appApi?.leaveFullScreen?.();});
// How a paper's tags are saved (renderer.js sets it: to the vault).
let persistTags;
let tagWrite=Promise.resolve();
function editTags(editor,change){const paper=papers.find(p=>String(p.id)===editor.dataset.tagEditor);if(!paper)return;const libraryId=state.storageKey;tagWrite=tagWrite.catch(()=>{}).then(async()=>{const tags=change(paper.tags);await persistTags(paper,tags,libraryId);if(state.storageKey!==libraryId)return;document.querySelectorAll('[data-tag-editor]').forEach(node=>{if(node.dataset.tagEditor===String(paper.id))node.outerHTML=tagEditor(paper)})}).catch(error=>toast(tr('태그 저장 실패: {error}',{error:shownError(error)})))}
document.addEventListener('submit',e=>{const form=e.target.closest('[data-tag-form]');if(!form)return;e.preventDefault();const tag=form.elements.tag.value.trim();if(tag)editTags(form.closest('[data-tag-editor]'),tags=>tags.includes(tag)?tags:[...tags,tag])});
document.addEventListener('click',e=>{const button=e.target.closest('[data-remove-tag]');if(button)editTags(button.closest('[data-tag-editor]'),tags=>tags.filter(t=>t!==button.dataset.removeTag))});

// Resize the right panel the same way: dragging its left edge leftwards widens it.
document.addEventListener('keydown',event=>{if(!event.target.matches('.panel-resize'))return;const {min,max}=panelLimits(),values={ArrowLeft:panelWidth()+10,ArrowRight:panelWidth()-10,Home:min,End:max};if(event.key in values){event.preventDefault();setPanelWidth(values[event.key])}});
document.addEventListener('dblclick',event=>{if(!event.target.closest('.panel-resize'))return;state.panelWidth=0;try{localStorage.removeItem('app-panel-width')}catch{}applyPanelWidth(panelWidth())});
document.addEventListener('pointerdown',event=>{
 const handle=event.target.closest('.panel-resize');if(!handle||event.button!==0)return;
 event.preventDefault();handle.focus();const start=event.clientX,width=panelWidth();handle.setPointerCapture(event.pointerId);document.body.classList.add('resizing-panel');
 const move=next=>setPanelWidth(width-(next.clientX-start),false);
 const stop=()=>{document.body.classList.remove('resizing-panel');setPanelWidth(panelWidth());handle.removeEventListener('pointermove',move);for(const type of ['pointerup','pointercancel','lostpointercapture'])handle.removeEventListener(type,stop);if(handle.hasPointerCapture(event.pointerId))handle.releasePointerCapture(event.pointerId)};
 handle.addEventListener('pointermove',move);for(const type of ['pointerup','pointercancel','lostpointercapture'])handle.addEventListener(type,stop);
});
// Resize the navigation without remounting the document or note editor.
document.addEventListener('keydown',event=>{if(!event.target.matches('.navigation-resize'))return;const {min,max}=navigationLimits(),values={ArrowLeft:navigationWidth()-10,ArrowRight:navigationWidth()+10,Home:min,End:max};if(event.key in values){event.preventDefault();setNavigationWidth(values[event.key])}});
document.addEventListener('dblclick',event=>{if(event.target.closest('.navigation-resize'))setNavigationWidth(220)});
document.addEventListener('pointerdown',event=>{
 const handle=event.target.closest('.navigation-resize');if(!handle||event.button!==0)return;
 event.preventDefault();handle.focus();const start=event.clientX,width=navigationWidth();handle.setPointerCapture(event.pointerId);document.body.classList.add('resizing-navigation');
 const move=next=>setNavigationWidth(width+next.clientX-start,false);
 const stop=()=>{document.body.classList.remove('resizing-navigation');setNavigationWidth(navigationWidth());handle.removeEventListener('pointermove',move);for(const type of ['pointerup','pointercancel','lostpointercapture'])handle.removeEventListener(type,stop);if(handle.hasPointerCapture(event.pointerId))handle.releasePointerCapture(event.pointerId)};
 handle.addEventListener('pointermove',move);for(const type of ['pointerup','pointercancel','lostpointercapture'])handle.addEventListener(type,stop);
});
