/* Desktop bridge: reuse reviewed layout; file authority stays in Electron main. */
let desktopPreferences = { recents: [], provider: 'gpt', mode: 'web' };
// The first screen is drawn before the later scripts (notes, editor, ink…) have run. Until they all
// have, it shows but takes no clicks or keys, so nothing opens a view those scripts draw
// (a slow disk or a virus scan can hold them back for a moment).
if(document.readyState==='loading'){
  const html=document.documentElement,hold=event=>{if(html.classList.contains('kn-booting')){event.preventDefault();event.stopImmediatePropagation();}};
  html.classList.add('kn-booting');document.addEventListener('keydown',hold,true);
  document.addEventListener('DOMContentLoaded',()=>{html.classList.remove('kn-booting');document.removeEventListener('keydown',hold,true);},{once:true});
}
let noteSaveTimer,noteRevision=0,pendingNotes=Promise.resolve();
const providerLabels = { gpt: 'GPT / ChatGPT', claude: 'Claude', gemini: 'Gemini' };
// Shows a tab of the side panel as a click on it does: only the panel is drawn again, so the PDF
// pages keep their place (drawing the whole screen again would open them at the top).
function showPanelTab(tab){
  if(state.rightCollapsed)actions['toggle-right']?.();
  const button=document.querySelector(`#notes-panel [data-tab="${tab}"]`);
  if(button)button.click();else{state.tab=tab;render();}
}
const runDesktop = fn => (...args) => Promise.resolve().then(() => fn(...args)).catch(error => toast(plainError(error)));
const baseRender = render;
function pdfPane(kind){if(kind==='translated')return `<section class="pdf-pane translated-pane" data-translation-pane="true"><header class="pdf-pane-header"><strong>${tr('번역 PDF')}</strong></header></section>`;const file=fullPdfs.get(selected()?.id)?.original;return `<section class="pdf-pane original-pane"><header class="pdf-pane-header"><strong>${tr('원문 PDF')}</strong><span class="pdf-pane-filename" title="${esc(file?.name||'')}">${esc(file?.name||'')}</span>${file?paneWindowButton('original',tr('원문')):''}</header>${file?`<div class="pdf-pane-tools source-tools" role="toolbar" aria-label="${tr('원문 도구')}">${pairedTools()}<input class="pdf-find-input" type="search" placeholder="${tr('원문 검색')}" aria-label="${tr('원문 검색')}"><button class="pdf-tool" data-pdf-find-next aria-label="${tr('다음 검색 결과')}">${tr('찾기')}</button><span class="pdf-find-status" aria-live="polite"></span></div><div class="translated-pages original-pages" data-source-url="${esc(file.url)}"></div>`:`<div class="pdf-empty">${tr('원문 파일을 찾을 수 없습니다.')}</div>`}</section>`;};

const attachmentRoles={original:tr('원문'),version:tr('다른 버전'),supplement:tr('보충자료'),translated:tr('번역 PDF')};
// Translated in the app, or a translated PDF attached: the library's "번역 있음".
function hasTranslation(paper){return Boolean(paper.hasTranslation||fullPdfs.get(paper.id)?.translated);}
let itemCollections=[],itemAnnotations=[],annotationTarget=null,annotationAnchor=null,vaultTrash=[],vaultBackups=[],vaultTrashAttachments=[];
// Only the annotations changed (a saved 그림 설명 or AI 선택 설명): the list is taken from the snapshot and
// the side panel and page marks are redrawn, without rebuilding the reader (the pages stay where they are).
function applyAnnotations(snapshot,tab){itemAnnotations=snapshot.annotations||[];if(tab)state.tab=tab;if(typeof showPanelTab==='function')showPanelTab(state.tab);if(typeof inkRefreshAnnotationMarks==='function')inkRefreshAnnotationMarks();}
function activeAttachment(paper=selected()){return paper?.attachments?.find(a=>a.id===state.selectedAttachment&&a.file)||paper?.attachments?.find(a=>a.id===paper.primaryAttachmentId&&a.file)||paper?.attachments?.find(a=>a.file)||paper?.attachments?.[0];}
function activateAttachment(paperId,attachmentId){const paper=papers.find(p=>p.id===paperId);if(!paper)return;const attachment=paper.attachments.find(a=>a.id===attachmentId&&a.file)||paper.attachments.find(a=>a.id===paper.primaryAttachmentId&&a.file)||paper.attachments.find(a=>a.file);state.selectedAttachment=attachment?.id;const files=fullPdfs.get(paperId)||{};files.original=attachment?.file;fullPdfs.set(paperId,files);}
// Attachments: one row per file (a click opens it), "다시 연결" when the file is
// missing, and the rest in the row's ⋯ menu. Paper-wide actions (merge, trash)
// live in the ⋯ beside the paper's title, not among its files.
function itemAttachments(paper){return `<section class="item-attachments"><div class="row between"><h3>${tr('첨부파일')} <span class="count">${paper.attachments.length}</span></h3><button class="secondary small" data-action="attach-pdf">${icon('plus')} ${tr('PDF 첨부')}</button></div><div class="attachment-list">${paper.attachments.map(a=>`<div class="attachment-row ${a.file?'':'missing'}"><button class="attachment-open" data-open-attachment="${esc(a.id)}" data-paper-id="${paper.id}" ${a.file?'':'disabled'} title="${a.file?tr('열기'):tr('파일을 찾을 수 없습니다')}">${icon('book')}<span><span class="attachment-name">${esc(a.name)}</span><small>${attachmentRoles[a.role]||tr('첨부',null,'attachment role')}${a.id===paper.primaryAttachmentId?` · ${tr('대표 원문')}`:''}${a.file?'':` · ${tr('파일 없음')}`}</small></span></button>${a.file?'':`<button class="secondary small" data-relink-attachment="${esc(a.id)}" data-paper-id="${paper.id}">${tr('다시 연결')}</button>`}<button type="button" class="row-more" data-attachment-menu="${esc(a.id)}" data-paper-id="${paper.id}" aria-haspopup="menu" aria-expanded="false" aria-label="${tr('{name} 메뉴',{name:esc(a.name)})}" title="${tr('대표 지정 · 이동·이름 · 제거')}">⋯</button></div>`).join('')}</div></section>`;}
function attachmentMenu(paper,a){
  const item=(attrs,label,cls='')=>`<button type="button" role="menuitem" class="${cls}" ${attrs}>${label}</button>`,ids=`data-paper-id="${paper.id}"`;
  return [a.file&&a.id!==paper.primaryAttachmentId&&a.role!=='translated'&&item(`data-set-primary="${esc(a.id)}" ${ids}`,tr('대표 원문으로 지정')),
    a.file&&item(`data-move-attachment="${esc(a.id)}" ${ids}`,tr('이동·이름 바꾸기…')),
    a.file&&a.id===paper.primaryAttachmentId&&item(`data-action="rename-files" title="${tr('첫 저자_연도_제목.pdf로 바꿉니다')}"`,tr('파일 이름 정리 (저자_연도_제목)')),
    item(`data-trash-attachment="${esc(a.id)}" ${ids}`,tr('첨부 제거…'),'danger')].filter(Boolean).join('');
}
const itemMenuButton=paper=>`<button type="button" class="row-more item-more" data-item-menu="${paper.id}" aria-haspopup="menu" aria-expanded="false" aria-label="${tr('자료 항목 메뉴')}" title="${tr('병합 · 휴지통 · 삭제')}">⋯</button>`;
function itemMenu(paper){return `${papers.length>1?`<button type="button" role="menuitem" data-action="merge-item">${tr('기존 자료 항목과 병합…')}</button>`:''}<button type="button" role="menuitem" class="danger" data-trash-paper="${paper.id}">${tr('휴지통으로 이동…')}</button><button type="button" role="menuitem" class="danger" data-delete-paper="${paper.id}">${tr('삭제 (PDF 파일 포함)…')}</button>`;}
// A small menu under its ⋯ button. Its items are the same buttons as before, so their handlers are unchanged.
let popMenu=null;
function closePopMenu(focus=false){if(!popMenu)return;const {el,anchor}=popMenu;popMenu=null;anchor.setAttribute('aria-expanded','false');el.remove();if(focus&&anchor.isConnected)anchor.focus();}
// The vault name in the sidebar opens the vaults used recently (the open one is marked),
// and under them the way to connect another folder.
function vaultSwitchMenu(){
  const recents=desktopPreferences.recents||[];
  return `<p class="pop-menu-title">${tr('최근 저장소')}</p>${recents.map(r=>{const current=r.current??r.id===state.storageKey;return `<button type="button" role="menuitemradio" aria-checked="${current}" class="vault-choice${current?' current':''}" ${current?'data-vault-current':`data-desktop-recent="${esc(r.key||r.id)}"`} title="${current?tr('지금 열려 있는 저장소'):tr('이 저장소 열기')}">${icon('vault')}<span class="vault-choice-name">${esc(r.name)}${r.where?`<small>${esc(r.where)}</small>`:''}</span>${current?`<span class="vault-choice-mark">${tr('열려 있음')}</span>`:''}</button>`;}).join('')||`<p class="small muted pop-menu-empty">${tr('최근에 연 저장소가 없습니다.')}</p>`}<hr><button type="button" role="menuitem" data-action="storage">${icon('plus')} ${tr('새 저장소 연결…')}</button>`;
}
// kind: a class for this menu's own look, put on before it is measured (a height limit changes where it opens).
function openPopMenu(anchor,html,label,kind=''){
  closePopMenu();const el=document.createElement('div');el.className=kind?`pop-menu ${kind}`:'pop-menu';el.setAttribute('role','menu');el.setAttribute('aria-label',label);el.innerHTML=html;document.body.append(el);
  anchor.setAttribute('aria-expanded','true');popMenu={el,anchor};
  const box=anchor.getBoundingClientRect(),menu=el.getBoundingClientRect();
  el.style.left=Math.max(8,Math.min(box.right-menu.width,innerWidth-menu.width-8))+'px';el.style.top=(box.bottom+menu.height+8>innerHeight?Math.max(8,box.top-menu.height-4):box.bottom+4)+'px';
  el.querySelector('button')?.focus();
}
document.addEventListener('click',event=>{
  const vault=event.target.closest('[data-vault-switch]');
  if(vault){if(popMenu?.anchor===vault){closePopMenu();return;}openPopMenu(vault,vaultSwitchMenu(),tr('저장소 바꾸기'));popMenu.el.classList.add('vault-menu');return;}
  const more=event.target.closest('[data-attachment-menu],[data-item-menu]');
  if(more){if(popMenu?.anchor===more){closePopMenu();return;}const paper=papers.find(p=>p.id===Number(more.dataset.paperId||more.dataset.itemMenu));if(!paper)return;
    if(more.dataset.itemMenu)openPopMenu(more,itemMenu(paper),tr('자료 항목'));else{const a=paper.attachments.find(x=>x.id===more.dataset.attachmentMenu);if(a)openPopMenu(more,attachmentMenu(paper,a),tr('{name} 메뉴',{name:a.name}));}return;}
  if(!popMenu)return;
  // A chosen item does its work first, then the menu goes.
  if(popMenu.el.contains(event.target)){if(event.target.closest('button'))setTimeout(()=>closePopMenu());}else closePopMenu();
});
document.addEventListener('keydown',event=>{
  if(!popMenu)return;
  if(event.key==='Escape'){event.preventDefault();event.stopPropagation();closePopMenu(true);return;}
  if(['ArrowDown','ArrowUp'].includes(event.key)&&popMenu.el.contains(event.target)){event.preventDefault();const items=[...popMenu.el.querySelectorAll('button')],at=items.indexOf(event.target);items[(at+(event.key==='ArrowDown'?1:items.length-1))%items.length]?.focus();}
},true);
function bibliography(paper){return `<div class="row between"><h3>${tr('서지정보')}</h3><button class="secondary small" data-action="edit-bibliography">${tr('편집')}</button></div><dl class="bibliography">${[['title',tr('제목')],['authors',tr('저자')],['year',tr('연도')],['journal',tr('학술지·학회')],['doi','DOI']].map(([key,label])=>`<dt>${label}</dt><dd>${esc(paper[key]||'—')}</dd>`).join('')}</dl>`;}
// Read status is one click: three buttons beside the paper, or the status pill in the list (cycles).
const readStatuses=['읽기 전','읽는 중','완독']; // i18n:keep — stored read-status values
function readStatusControl(paper){return `<div class="field read-status-field" data-status-paper="${paper.id}" data-status-for="${paper.id}"><label id="read-status-label">${tr('읽기 상태')}</label><div class="segmented read-status" role="radiogroup" aria-labelledby="read-status-label">${readStatuses.map(v=>`<button type="button" role="radio" aria-checked="${paper.status===v}" class="${paper.status===v?'active':''}" data-read-status="${v}">${valueLabel(v)}</button>`).join('')}</div></div>`;}
function nextReadStatus(status){return readStatuses[(readStatuses.indexOf(status)+1)%readStatuses.length];}
function statusPill(paper){const next=nextReadStatus(paper.status);return `<button type="button" class="pill status-pill" data-cycle-status="${paper.id}" data-status="${esc(paper.status)}" title="${tr('누르면 ‘{next}’(으)로 바꿉니다',{next:valueLabel(next)})}" aria-label="${tr('읽기 상태 {status}, 누르면 {next}',{status:esc(valueLabel(paper.status)),next:valueLabel(next)})}">${esc(valueLabel(paper.status))}</button>`;}
// Redraws every control showing this paper's status or collections in place.
function refreshItemControls(paper){for(const el of document.querySelectorAll(`[data-status-paper="${paper.id}"]`))el.outerHTML=readStatusControl(paper);for(const el of document.querySelectorAll(`[data-reader-status-paper="${paper.id}"]`)){el.outerHTML=readerStatusControl(paper);layoutReaderStatus();}for(const el of document.querySelectorAll(`[data-collection-paper="${paper.id}"]`))el.outerHTML=itemCollectionEditor(paper);if(state.screen==='library')refreshLibraryList();}
async function setReadStatus(paperId,status){const id=state.storageKey,paper=papers.find(p=>p.id===paperId);if(!paper||paper.status===status||!readStatuses.includes(status))return;const before=paper.status;paper.status=status;refreshItemControls(paper);try{await window.appApi.updatePaper(id,paperId,{status});}catch(error){if(state.storageKey===id){paper.status=before;refreshItemControls(paper);}throw error;}}

// Search text: lower case and composed (NFC), so Korean pasted decomposed is found; the query is made the same way.
const searchText=value=>String(value??'').normalize('NFC').toLowerCase();
// contentSearchParts: the text boxes on PDF pages and the notebooks' text of each paper (desktop/content-index.cjs), as
// the main process sends them: all of them once a vault is shown, a paper's again when its ink or a notebook is saved.
const paperSearchIndex=new Map(),noteSearchParts=new Map(),annotationSearchParts=new Map(),contentSearchParts=new Map();
function indexPaperSearch(paper){if(!paper)return;paperSearchIndex.set(paper.id,searchText(`${paper.title} ${paper.authors} ${paper.year} ${paper.journal} ${paper.doi} ${paper.attachments.map(a=>a.fileName+' '+a.folder).join(' ')} ${paper.tags.join(' ')} ${[...(noteSearchParts.get(paper.id)?.values()||[])].join(' ')} ${annotationSearchParts.get(paper.id)||''} ${(contentSearchParts.get(paper.id)||[]).map(p=>p.text).join(' ')}`));}
// The parts for some papers (or all), as sent; a search being shown is shown again with them.
function takeContentParts(vault,parts,ids){
  if(vault!==state.storageKey)return;if(!ids)contentSearchParts.clear();
  for(const id of ids||[])contentSearchParts.delete(Number(id));for(const [id,list] of Object.entries(parts||{}))contentSearchParts.set(Number(id),list);
  for(const paper of papers)if(!ids||ids.includes(paper.id))indexPaperSearch(paper);
  document.body.dataset.contentSearch='ready';if(state.query&&state.screen==='library'&&typeof refreshLibraryList==='function')refreshLibraryList();
}
let contentPartsTimer=0;
function loadContentParts(){const vault=state.storageKey;clearTimeout(contentPartsTimer);if(!vault||!window.appApi?.contentParts)return;contentPartsTimer=setTimeout(()=>window.appApi.contentParts(vault).then(r=>takeContentParts(vault,r.papers,null)).catch(()=>{}),250);}
window.appApi?.onContentParts?.(takeContentParts);
function rebuildPaperSearch(){paperSearchIndex.clear();noteSearchParts.clear();annotationSearchParts.clear();for(const [key,value]of Object.entries(notes)){const id=Number(key.split('-')[0]);if(!noteSearchParts.has(id))noteSearchParts.set(id,new Map());noteSearchParts.get(id).set(key,value);}for(const annotation of itemAnnotations)annotationSearchParts.set(annotation.paperId,(annotationSearchParts.get(annotation.paperId)||'')+' '+annotation.quote+' '+annotation.body);papers.forEach(indexPaperSearch);}

const annotationHashes=new Map();
function annotationsPanel(paper){const attachment=activeAttachment(paper),key=targetKey(),hash=annotationHashes.get(key),annotations=itemAnnotations.filter(a=>a.paperId===paper.id&&a.attachmentId===attachment?.id);return `<div class="row between"><h3>${tr('파일 주석')}</h3><button class="secondary small" data-action="collect-annotations">${tr('모아 보기')}</button></div><div class="annotation-list">${annotations.length?annotations.map(a=>`<article class="annotation" data-annotation-card="${esc(a.id)}"><div class="annotation-head"><button class="secondary small" data-annotation-page="${a.page}">${tr('{page}페이지 ↗',{page:a.page})}</button>${hash&&hash!==a.sourceHash?`<span class="pill amber">${tr('원문 변경 · 위치 확인 필요')}</span>`:''}<span class="memo-actions"><button type="button" class="row-more" data-edit-annotation="${esc(a.id)}" title="${tr('넓게 편집')}" aria-label="${tr('주석 넓게 편집')}">${icon('expand')}</button><button type="button" class="row-more" data-delete-annotation="${esc(a.id)}" title="${tr('삭제')}" aria-label="${tr('주석 삭제')}">${icon('trash')}</button></span></div>${a.quote?`<blockquote>${esc(a.quote)}</blockquote>`:''}<p>${esc(a.body)}</p></article>`).join(''):`<p class="small muted">${tr('주석이 없습니다. PDF 도구 줄의 <strong>주석 추가</strong>로 남길 수 있습니다.')}</p>`}</div>`;}
function panel(){const p=selected(),attachment=activeAttachment(p),tabs=['서지','첨부','요약','주석','메모','태그'];return `<aside class="reader-panel" id="notes-panel" data-sidebar="right">${sidebarButtons('right')}<div class="item-title"><h3>${esc(p.title)}</h3>${itemMenuButton(p)}</div>${p.attachments.length>1?`<select id="attachment-select" aria-label="${tr('읽을 첨부파일')}">${p.attachments.map(a=>`<option value="${esc(a.id)}" ${a.id===attachment?.id?'selected':''} ${a.file?'':'disabled'}>${esc(a.name)} · ${attachmentRoles[a.role]}</option>`).join('')}</select>`:''}<div class="tabs">${tabs.map(tab=>`<button data-tab="${tab}" class="${state.tab===tab?'active':''}">${valueLabel(tab)}</button>`).join('')}</div>${state.tab==='태그'?tagEditor(p):state.tab==='서지'?bibliography(p):state.tab==='첨부'?itemAttachments(p):state.tab==='주석'?annotationsPanel(p):state.tab==='요약'?summaryFields(p):memoTab(p)}${['메모','요약'].includes(state.tab)?`<div class="saved" id="saved" role="status">${tr('자동 저장')}</div>`:''}${itemCollectionEditor(p)}</aside>`;}; // i18n:keep — tab values
// The tab row is redrawn with the panel (a tab click redraws only the panel):
// each new row takes the previous row's scroll and keeps the chosen tab in
// view. Shift+wheel over the row scrolls it sideways.
let panelTabsScroll=0,panelTabsRow=null;
new MutationObserver(()=>{
  const tabs=document.querySelector('.reader-panel>.tabs');if(!tabs||tabs===panelTabsRow)return;panelTabsRow=tabs;
  tabs.scrollLeft=panelTabsScroll;const active=tabs.querySelector('.active');if(!active)return;
  const a=active.getBoundingClientRect(),t=tabs.getBoundingClientRect();
  if(a.left<t.left)tabs.scrollLeft-=t.left-a.left+8;else if(a.right>t.right)tabs.scrollLeft+=a.right-t.right+8;
  panelTabsScroll=tabs.scrollLeft;
}).observe(document.body,{childList:true,subtree:true});
document.addEventListener('scroll',event=>{if(event.target===panelTabsRow)panelTabsScroll=panelTabsRow.scrollLeft;},true);
document.addEventListener('wheel',event=>{const tabs=event.shiftKey&&event.target.closest?.('.reader-panel>.tabs');if(!tabs||tabs.scrollWidth<=tabs.clientWidth)return;event.preventDefault();tabs.scrollLeft+=event.deltaX||event.deltaY;},{passive:false});
function applyItemSnapshot(snapshot,{paperId=state.selected,attachmentId=state.selectedAttachment,screen=state.screen,tab=state.tab,mode=state.mode}={}){const view={folder:state.folder,collection:state.collection,desktopTag:state.desktopTag,query:state.query,filter:state.filter,nav:state.nav,savedSearch:state.savedSearch};applySnapshot(snapshot);Object.assign(state,view);if(state.savedSearch&&!(typeof savedSearches!=='undefined'&&savedSearches.some(s=>s.id===state.savedSearch)))Object.assign(state,{savedSearch:null,nav:'전체 자료',folder:null,collection:null,desktopTag:null,query:'',filter:'전체',fullText:false});if(state.collection&&!itemCollections.some(c=>c.id===state.collection))state.collection=null;state.selected=papers.some(p=>p.id===paperId)?paperId:state.selected;activateAttachment(state.selected,attachmentId);state.screen=screen;state.tab=tab;state.mode=mode;render();} // i18n:keep — navigation value
async function openItemFile(paperId,attachmentId){const storageId=state.storageKey;await desktopNotes();if(state.storageKey!==storageId)return;const paper=papers.find(p=>p.id===paperId);if(!paper)return;state.selected=paperId;activateAttachment(paperId,attachmentId);state.folder=activeAttachment(paper)?.folder||'';state.desktopTag=null;state.collection=null;state.savedSearch=null;showFolderParents(state.folder);persistTreeState();actions.read();}
function editBibliography(){const p=selected();modal(tr('서지정보 편집'),`<form id="bibliography-form"><div class="row"><button type="button" class="secondary small" data-action="extract-doi">${tr('PDF에서 DOI 찾기')}</button><button type="button" class="secondary small" data-action="lookup-doi">${tr('DOI로 조회')}</button></div><p class="small muted" id="doi-status" role="status"></p>${[['title',tr('제목')],['authors',tr('저자')],['year',tr('연도')],['journal',tr('학술지·학회')],['doi','DOI']].map(([key,label])=>`<div class="field"><label for="bib-${key}">${label}</label><input id="bib-${key}" name="${key}" value="${esc(p[key]||'')}" maxlength="1000" ${key==='title'?'required':''}></div>`).join('')}</form>`,btn(tr('취소'),'close')+btn(tr('저장'),'save-bibliography','primary'));}
async function saveBibliography(){const form=document.querySelector('#bibliography-form');if(!form.reportValidity())return;const id=state.storageKey,paperId=state.selected,patch=Object.fromEntries(new FormData(form));await desktopNotes();await window.appApi.updatePaper(id,paperId,patch);applyItemSnapshot(await window.appApi.refreshStorage(id));}
function chooseAttachmentRole(){modal(tr('자료에 PDF 첨부'),`<label for="attachment-role">${tr('종류')}</label><select id="attachment-role"><option value="version">${tr('다른 버전')}</option><option value="supplement">${tr('보충자료')}</option><option value="translated">${tr('번역 PDF')}</option></select>`,btn(tr('취소'),'close')+btn(tr('PDF 선택'),'choose-attachment','primary'));}
async function attachPDF(){const id=state.storageKey,paperId=state.selected,attachmentId=state.selectedAttachment,screen=state.screen,tab=state.tab,mode=state.mode,role=document.querySelector('#attachment-role').value,folder=state.folder||'';await desktopNotes();const result=await window.appApi.attachFiles(id,paperId,role,folder);if(!result)return;if(id!==state.storageKey)return;applyItemSnapshot(result.snapshot,{paperId,attachmentId,screen,tab,mode});const failed=result.results.filter(r=>!r.ok);if(failed.length)modal(tr('첨부 결과'),failed.map(r=>`<p>${esc(r.name)}: ${esc(r.error)}</p>`).join(''),btn(tr('닫기'),'close'));}
async function loadAnnotationHash(){const key=targetKey(),attachmentId=state.selectedAttachment,{hash}=await(await pdfEngine()).documentFor(state.storageKey,state.selected,true,attachmentId);if(key!==targetKey())return;annotationHashes.set(key,hash);const list=document.querySelector('.annotation-list');if(list)list.outerHTML=new DOMParser().parseFromString(annotationsPanel(selected()),'text/html').querySelector('.annotation-list').outerHTML;}
async function newAnnotation(){const id=state.storageKey,paperId=state.selected,attachmentId=state.selectedAttachment,key=targetKey(),{pdf,hash}=await(await pdfEngine()).documentFor(id,paperId,true,attachmentId);if(key!==targetKey())return;annotationTarget={id,paperId,attachmentId,hash};modal(tr('파일 주석'),`<div class="field"><label for="annotation-page">${tr('페이지')}</label><input id="annotation-page" type="number" min="1" max="${pdf.numPages}" value="1"></div><div class="field"><label for="annotation-quote">${tr('인용문')}</label><textarea id="annotation-quote" maxlength="10000"></textarea></div><div class="field"><label for="annotation-body">${tr('주석',null,'annotation body')}</label><textarea id="annotation-body" maxlength="20000" required></textarea></div>`,btn(tr('취소'),'close')+`<button class="secondary" data-action="save-annotation-ask" title="${tr('주석을 저장하고, 인용문에 대해 AI에게 묻습니다. 주석 내용은 비워 둘 수 있습니다.')}">${icon('memoAi')} ${tr('AI에게 묻기')}</button>`+btn(tr('저장'),'save-annotation','primary'));}
async function saveAnnotation(ask=false){const target=annotationTarget,page=document.querySelector('#annotation-page'),body=document.querySelector('#annotation-body'),quoted=Boolean(document.querySelector('#annotation-quote').value.trim());ask=ask===true;if(ask&&!quoted&&!body.value.trim()){toast(tr('AI에게 물을 인용문이나 주석 내용을 적어 주세요.'));return;}if(!page.reportValidity()||!(ask&&quoted)&&!body.reportValidity())return;const known=new Set(itemAnnotations.map(a=>a.id));await desktopNotes();const snapshot=await window.appApi.addAnnotation(target.id,target.paperId,target.attachmentId,{page:Number(page.value),quote:document.querySelector('#annotation-quote').value,body:body.value,sourceHash:target.hash,...(annotationAnchor?.key===targetKey()&&annotationAnchor.page===Number(page.value)?{rects:annotationAnchor.rects}:{})});if(state.storageKey===target.id){const pos=readingPosition();setTimeout(()=>restoreReadingPosition(pos),0);applyItemSnapshot(snapshot,{paperId:target.paperId,attachmentId:target.attachmentId,screen:'reader',tab:'주석'});toast(tr('{page}쪽에 주석을 저장했습니다.',{page:Number(page.value)}));const made=ask&&itemAnnotations.find(a=>!known.has(a.id));// The form's own close event is still on its way; the editor's close handler knows it for an earlier opening (notes.js). // i18n:keep — tab value
  if(made&&typeof openAnnotationEditor==='function'){globalThis.appShowAnnotation?.(made.id);if(state.storageKey===target.id&&itemAnnotations.some(a=>a.id===made.id))openAnnotationEditor(made.id,{});}}annotationAnchor=null;}
async function showDuplicates(){const id=state.storageKey,candidates=await window.appApi.duplicates(id);if(id!==state.storageKey)return;modal(tr('중복 자료 후보'),candidates.length?candidates.map(pair=>`<div class="duplicate-candidate"><strong>${pair.paperIds.map(id=>esc(papers.find(p=>p.id===id)?.title||'')).join(' / ')}</strong><p>${pair.reasons.map(esc).join(', ')}</p><button class="secondary" data-merge-candidate="${pair.paperIds.join(',')}">${tr('병합 검토')}</button></div>`).join(''):`<p>${tr('중복 자료 후보가 없습니다.')}</p>`,btn(tr('닫기'),'close')+(candidates.length?btn(tr('전체 병합 ({n}쌍)',{n:candidates.length}),'merge-all-duplicates','primary'):''));duplicateCount=candidates.length;}
// 전체 병합: every group of candidates becomes one item. Asked once more, with what it does.
let duplicateCount=0;
function confirmMergeAll(){modal(tr('중복 자료 후보 전체 병합'),`<p>${tr('중복 자료 후보 {n}쌍을 모두 병합합니다.',{n:duplicateCount})}</p><ul><li>${tr('서로 이어진 후보는 한 묶음으로 보고, 묶음마다 <b>먼저 등록된 자료</b>를 남깁니다.')}</li><li>${tr('첨부파일·태그·컬렉션·메모를 합치고, 비어 있는 서지정보는 다른 쪽에서 채웁니다.')}</li><li>${tr('내용이 같은 PDF는 하나로 합칩니다. 양쪽 모두 번역·필기가 있으면 둘 다 남깁니다. PDF 파일은 옮기거나 지우지 않습니다.')}</li></ul><p class="small muted">${tr('‘동일 DOI’ 후보에는 본문과 부록처럼 따로 두려는 자료가 섞여 있을 수 있습니다. 그런 쌍이 있으면 취소하고 <b>병합 검토</b>로 하나씩 병합하세요. 병합 전 상태는 저장소 관리의 백업에 남습니다.')}</p>`,btn(tr('취소'),'duplicates')+btn(tr('전체 병합'),'confirm-merge-all','primary'));}
async function mergeAllDuplicates(){
  const id=state.storageKey;await desktopNotes();if(dialog.open)dialog.close();
  const snapshot=await window.appApi.mergeAllDuplicates(id);if(state.storageKey!==id)return;
  applyItemSnapshot(snapshot,{screen:'library'});
  const r=snapshot.mergeAllReport||{},notes=[r.keptBoth?tr('같은 PDF {n}개는 양쪽 모두 번역·필기가 있어 둘 다 남겼습니다',{n:r.keptBoth}):'',r.skipped?tr('번역 중인 자료가 든 {n}묶음은 건너뛰었습니다',{n:r.skipped}):'',r.failed?.length?tr('{n}묶음은 병합하지 못했습니다({error})',{n:r.failed.length,error:r.failed[0]}):''].filter(Boolean).join('. ');
  toast(`${r.merged?tr('중복 자료 {items}개를 {n}개 항목으로 병합했습니다.',{items:r.items,n:r.merged}):tr('병합한 자료가 없습니다.')}${notes?' '+notes+'.':''}`);
}
let mergeCandidates=[];
function reviewMerge(ids){mergeCandidates=ids;modal(tr('자료 항목 병합'),`<label for="merge-target">${tr('유지할 자료 항목')}</label><select id="merge-target">${ids.map(id=>`<option value="${id}">${esc(papers.find(p=>p.id===id).title)}</option>`).join('')}</select><p>${tr('첨부파일·태그·컬렉션·메모를 합칩니다. PDF 파일은 이동하거나 삭제하지 않습니다.')}</p>`,btn(tr('취소'),'close')+btn(tr('병합'),'confirm-merge','primary'));}
async function mergeItems(){const id=state.storageKey,target=Number(document.querySelector('#merge-target').value),source=mergeCandidates.find(value=>value!==target);await desktopNotes();const snapshot=await window.appApi.mergePapers(id,target,source);if(state.storageKey===id){applyItemSnapshot(snapshot,{paperId:target,attachmentId:null,screen:'library'});const {removed=0,keptBoth=0}=snapshot.mergeReport||{};if(keptBoth)toast(tr('병합했습니다. 같은 PDF {n}개는 양쪽 모두 번역·필기가 있어 둘 다 남겼습니다. 첨부 탭에서 확인하세요.',{n:keptBoth}));else if(removed)toast(tr('병합했습니다. 내용이 같은 PDF {n}개는 하나로 합쳤습니다(남은 사본은 저장소 관리의 제거한 첨부에 있습니다).',{n:removed}));}}
function desktopNotes() {
  clearTimeout(noteSaveTimer);
  if (!state.storageKey) return pendingNotes;
  const id = state.storageKey, value = JSON.parse(JSON.stringify(notes));
  const task=window.appApi.saveNotes(id,value),revision=noteRevision;
  // A save started early (leaving, closing) also settles the typing status.
  task.then(()=>{if(revision!==noteRevision)return;const node=document.querySelector('#saved');if(node?.textContent===tr('저장 중…'))node.textContent=tr('✓ 저장소에 저장됨');},()=>{});
  pendingNotes=Promise.all([pendingNotes.catch(()=>{}),task]).then(()=>{});
  return pendingNotes;
}
function applySnapshot(snapshot) {
  let previousFolder=state.storageKey===snapshot.id?state.folder:null;const previous=state.selected;
  if(state.storageKey!==snapshot.id){expandedFolders=new Set(['','papers']);try{const saved=JSON.parse(localStorage.getItem('app-tree-'+snapshot.id)||'null');if(saved){previousFolder=typeof saved.folder==='string'?saved.folder:null;if(Array.isArray(saved.expanded))expandedFolders=new Set(saved.expanded.filter(v=>typeof v==='string'));}}catch{}}

  vaultTrash=snapshot.trash||[];vaultTrashAttachments=snapshot.trashAttachments||[];vaultFolders=snapshot.folders||[];itemCollections=snapshot.collections||[];itemAnnotations=snapshot.annotations||[];
  papers.splice(0, papers.length, ...snapshot.papers.map(({ files, ...paper }) => paper));
  fullPdfs.clear();
  for (const paper of snapshot.papers) fullPdfs.set(paper.id, paper.files);
  notes = snapshot.notes;rebuildPaperSearch();
  state.storageKey = snapshot.id; state.name = snapshot.name;
  state.selected = snapshot.papers.find(p => p.id === previous && p.files.original)?.id || availablePapers()[0]?.id;
  activateAttachment(state.selected,state.selectedAttachment);
  state.collection=null;state.query = ''; state.filter = '전체';state.folder=previousFolder===''||vaultFolders.includes(previousFolder)?previousFolder:null;state.nav=state.folder===null?'전체 자료':folderLabel();state.savedSearch=null;showFolderParents(state.folder||''); // i18n:keep — filter and navigation values
  state.desktopTag = null;
  state.screen = 'library';
  dialog.close(); render();
}
// The screen language can be chosen before a vault is open (DEVELOPMENT.md 언어 설정): someone who cannot read
// the screen's language may not find the settings. Each language is named in itself.
paths.globe='M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M3 12h18 M12 3c2.4 2.5 3.6 5.5 3.6 9s-1.2 6.5-3.6 9 M12 3c-2.4 2.5-3.6 5.5-3.6 9s1.2 6.5 3.6 9';
const languageOptions=(list,chosen)=>list.map(c=>`<option value="${esc(c.code)}" ${c.code===chosen?'selected':''}>${esc(c.name)}</option>`).join('');
// The language settings as the page has them now (appearance.js languageNow once that script has run).
const languageState=()=>{try{return languageNow||window.appApi.language;}catch{return window.appApi.language;}};
// The start screen's switch: a button for each display language, the one in use pressed.
function welcomeLanguage(){
  const info=languageState();if(!info?.choices?.ui?.length)return '';
  return `<div class="welcome-language" role="group" aria-label="${esc(tr('화면 언어'))}" title="${esc(tr('화면 언어'))}">${icon('globe')}<span class="segmented">${info.choices.ui.map(c=>`<button type="button" class="${c.code===info.ui?'active':''}" data-welcome-language="${esc(c.code)}" aria-pressed="${c.code===info.ui}">${esc(c.name)}</button>`).join('')}</span></div>`;
}
// The first start of a new install (language.cjs languageAskAtStart): the display language is asked for before anything
// else is offered. The question is put in both languages, since the reader may know only one; each language is named in
// itself, with its name in the other below. The language the system gave is picked ahead and the focus is on 시작하기,
// so Enter alone goes on.
let firstLanguage=null;
function languageFirst(){
  const info=languageState(),chosen=firstLanguage||info.ui,inOther={ko:trIn('en','한국어'),en:trIn('ko','영어')};
  // Once the card is on the page the focus goes to 시작하기 (unless it is already in the card): this function only
  // returns the markup, and render is replaced further down this file, so the focus is set after the next frame.
  requestAnimationFrame(()=>{const go=document.querySelector('.language-first [data-action="first-language-go"]');if(go&&!document.activeElement?.closest?.('.language-first'))go.focus();});
  const title=trIn('ko','언어를 선택하세요'),titleSecond=trIn('en','언어를 선택하세요'),go=trIn('ko','시작하기'),goSecond=trIn('en','시작하기'),later=trIn('ko','나중에 설정에서 바꿀 수 있습니다.'),laterSecond=trIn('en','나중에 설정에서 바꿀 수 있습니다.');
  return `<main class="welcome language-first"><section class="language-first-card" aria-labelledby="language-first-title">${logo()}<h1 id="language-first-title">${esc(title)}</h1><p class="language-first-second">${esc(titleSecond)}</p><div class="language-first-pick" role="group" aria-labelledby="language-first-title">${info.choices.ui.map(c=>`<button type="button" class="${c.code===chosen?'active':''}" data-first-language="${esc(c.code)}" aria-pressed="${c.code===chosen}"><strong>${esc(c.name)}</strong><small>${esc(inOther[c.code]||'')}</small></button>`).join('')}</div><button type="button" class="primary" data-action="first-language-go">${esc(go)} · ${esc(goSecond)}</button><p class="small muted">${esc(later)}<br>${esc(laterSecond)}</p></section></main>`;
}
document.addEventListener('click',event=>{
  const pick=event.target.closest?.('[data-first-language]');
  if(pick){firstLanguage=pick.dataset.firstLanguage;document.querySelectorAll('[data-first-language]').forEach(b=>{const on=b===pick;b.classList.toggle('active',on);b.setAttribute('aria-pressed',String(on));});return;}
  const to=event.target.closest?.('[data-welcome-language]');if(to&&typeof chooseLanguage==='function')chooseLanguage({id:'welcome-language',value:to.dataset.welcomeLanguage});
});
// 시작하기: the choice is kept (and the question answered) by set-language. Another language than the one on screen loads
// the window again, so nothing is drawn here; the same one draws the start screen. A choice that could not be kept is
// told, and the start screen follows for this run (the question comes back at the next start).
actions['first-language-go']=async()=>{
  const now=languageState(),code=firstLanguage||now.ui;
  try{const info=await window.appApi.setLanguage({ui:code});if(code!==now.ui)return;languageNow=info;}
  catch(error){toast(plainError(error));languageNow={...now,askUi:false};}
  firstLanguage=null;render();
};
function welcome() {
  if(languageState()?.askUi)return languageFirst();
  return `<main class="welcome"><header>${logo()}${welcomeLanguage()}</header><section class="welcome-hero"><h1>${tr('저장소')}</h1><button class="primary open-folder" data-action="storage">${icon('vault')} ${tr('저장소 연결')} ${icon('arrow')}</button></section><section class="recent"><h3>${tr('최근 저장소')}</h3>${desktopPreferences.recents.length ? desktopPreferences.recents.map(r => `<div class="recent-row"><button class="recent-item" data-desktop-recent="${esc(r.key||r.id)}" title="${tr('열기 · Delete 키로 목록에서 삭제')}">${icon('vault')}<strong>${esc(r.name)}${r.where?`<small class="recent-where">${esc(r.where)}</small>`:''}</strong><span>${tr('바로 열기')} ${icon('arrow')}</span></button><button type="button" class="row-more recent-remove" data-recent-remove="${esc(r.key||r.id)}" title="${tr('최근 목록에서 삭제 (폴더는 그대로)')}" aria-label="${tr('{name} 최근 목록에서 삭제',{name:esc(r.name)})}">${icon('trash')}</button></div>`).join('') : `<p class="recent-empty">${tr('폴더를 연결하면 여기에 표시됩니다.')}</p>`}</section>${desktopPreferences.recents.length?'':welcomeGuide()}</main>`;
};
let vaultFolders=[],expandedFolders=new Set(['','papers']);
function parentFolder(folder){const parts=folder.split('/');parts.pop();return parts.join('/');}
function showFolderParents(folder){let current=folder;expandedFolders.add('');while(current){expandedFolders.add(current);current=parentFolder(current);}}
function folderLabel(){return state.folder||state.name;}
function vaultTree(){
  const children=new Map();for(const folder of vaultFolders){const parent=parentFolder(folder);if(!children.has(parent))children.set(parent,[]);children.get(parent).push(folder);}
  const files=new Map();for(const paper of availablePapers())for(const attachment of paper.attachments.filter(a=>a.file)){if(!files.has(attachment.folder))files.set(attachment.folder,[]);files.get(attachment.folder).push({...paper,attachmentId:attachment.id,fileName:attachment.fileName});}
  function branch(folder,depth){const expanded=expandedFolders.has(folder),name=folder?folder.split('/').pop():state.name;
    return `<div class="vault-folder"><div class="vault-row ${state.folder===folder?'selected':''}" style="--depth:${depth}" data-folder-drop="${esc(folder)}"><button class="folder-caret" data-folder-toggle="${esc(folder)}" aria-label="${expanded?tr('{name} 접기',{name:esc(name)}):tr('{name} 펼치기',{name:esc(name)})}" aria-expanded="${expanded}"><span class="section-caret" aria-hidden="true"></span></button><button class="folder-name" data-folder-select="${esc(folder)}" title="${esc(folder||name)}" aria-pressed="${state.folder===folder}">${icon(folder?'folder':'vault')}<span>${esc(name)}</span></button>${folder?`<button type="button" class="row-more folder-more" data-folder-menu="${esc(folder)}" aria-haspopup="menu" aria-expanded="false" aria-label="${tr('{name} 폴더 메뉴',{name:esc(name)})}" title="${tr('이름 바꾸기 · 새 하위 폴더')}">⋯</button>`:''}</div>${expanded?`<div class="vault-children">${(children.get(folder)||[]).map(child=>branch(child,depth+1)).join('')}${(files.get(folder)||[]).sort((a,b)=>a.fileName.localeCompare(b.fileName,'ko',{numeric:true})).map(p=>`<button class="vault-file ${p.id===state.selected&&p.attachmentId===state.selectedAttachment?'selected':''}" draggable="true" data-attachment-id="${esc(p.attachmentId)}" data-tree-file="${p.id}" style="--depth:${depth+1}" title="${esc(p.fileName)}" aria-current="${p.id===state.selected&&p.attachmentId===state.selectedAttachment?'true':'false'}">${icon('book')}<span>${esc(p.fileName)}</span></button>`).join('')}</div>`:''}</div>`;
  }
  return `<nav class="vault-tree" aria-label="${tr('저장소 파일')}">${branch('',0)}</nav>`;
}
function persistTreeState(){if(state.storageKey)try{localStorage.setItem('app-tree-'+state.storageKey,JSON.stringify({folder:state.folder,expanded:[...expandedFolders]}))}catch{}}
// Redrawing the sidebar keeps the place of each of its scrolling areas.
function keepSidebarScroll(update){
  const vault=state.storageKey,at=node=>node.dataset.viewBody||'panel',tops=new Map([...document.querySelectorAll('#navigation-panel,#navigation-panel [data-view-body]')].map(n=>[at(n),n.scrollTop]));
  update();if(state.storageKey!==vault)return;
  for(const [key,top] of tops){const node=key==='panel'?document.querySelector('#navigation-panel'):document.querySelector(`#navigation-panel [data-view-body="${key}"]`);if(node&&top)node.scrollTop=top;}
}
function refreshVaultSidebar(){persistTreeState();const node=document.querySelector('#navigation-panel');if(node)keepSidebarScroll(()=>{node.outerHTML=sidebar();});}
// The sidebar's middle is a stack of views, as in VS Code: the opened views
// share its height by weight (the handle between two opened views moves the
// line between them) and each scrolls on its own; a folded view is only its
// heading, at the bottom (컬렉션 always stays last). library.js adds 저장 검색
// and 컬렉션, tags.js 태그.
const sidebarViews=[],VIEW_MIN=64;
function addSidebarView(view){sidebarViews.push(view);sidebarViews.sort((a,b)=>a.order-b.order);}
const legacyViewKeys={files:'app-section-files',collections:'app-section-collections',tags:'app-tags-open'};
function viewOpen(id){try{const value=localStorage.getItem('app-view-'+id)??(legacyViewKeys[id]&&localStorage.getItem(legacyViewKeys[id]));if(value==='1'||value==='0')return value==='1';}catch{}return true;}
function setViewOpen(id,open){try{localStorage.setItem('app-view-'+id,open?'1':'0');}catch{}}
// Opened views share the height by weight, so each keeps its share as the window changes.
function viewWeight(id){let weight=0;try{weight=Number(localStorage.getItem('app-view-weight-'+id));}catch{}return weight>0&&weight<100?weight:sidebarViews.find(v=>v.id===id)?.weight||1;}
function sidebarViewsHtml(){
  // Opened views first, then folded ones; a view pinned to the bottom (컬렉션) stays last either way.
  const shown=sidebarViews.filter(v=>v.visible?.()!==false),loose=shown.filter(v=>!v.pinBottom);
  const sequence=[...loose.filter(v=>viewOpen(v.id)),...loose.filter(v=>!viewOpen(v.id)),...shown.filter(v=>v.pinBottom)];
  let previous=null,folded=0;
  return sequence.map(v=>{
    const on=viewOpen(v.id),first=!on&&!folded++,style=on?`flex:${viewWeight(v.id)} 1 0px`:'';
    const sash=on&&previous?`<div class="view-sash" role="separator" aria-orientation="horizontal" tabindex="0" data-sash="${previous.id}:${v.id}" aria-label="${tr('{a}·{b} 높이 조절',{a:esc(previous.title),b:esc(v.title)})}" title="${tr('끌어서 높이 조절 · 두 번 누르면 기본 높이')}"></div>`:'';
    if(on)previous=v;
    return `${sash}<section class="sidebar-view ${on?'open':first?'first-closed':''}" data-view="${v.id}" style="${style}"><div class="view-heading"><button type="button" class="section-toggle" data-section-toggle="${v.id}" aria-expanded="${on}"><span class="section-caret" aria-hidden="true"></span><span class="view-title">${esc(v.title)}</span>${v.badge?.()||''}</button>${v.extra?.(on)||''}<div class="view-actions">${v.actions?.()||''}</div></div>${on?`<div class="sidebar-view-body" data-view-body="${v.id}">${v.body()}</div>`:''}</section>`;
  }).join('');
}
addSidebarView({id:'files',title:tr('파일'),order:10,weight:2,actions:()=>`<button data-action="new-folder" aria-label="${tr('새 폴더')}" title="${tr('새 폴더')}">${icon('folderPlus')}</button><button data-action="add-files" aria-label="${tr('파일 추가')}" title="${tr('파일 추가')}">${icon('plus')}</button><button data-action="refresh-vault" aria-label="${tr('파일 목록 새로고침')}" title="${tr('파일 목록 새로고침')}">↻</button>`,body:()=>vaultTree()});
function sidebar() {
  return `<aside class="sidebar" id="navigation-panel" data-sidebar="left"><div class="sidebar-heading"><button class="logo-home" data-action="home" aria-label="${tr('{app} 시작 화면')}">${logo()}</button>${sidebarButtons('left')}</div><button class="storage" data-vault-switch aria-haspopup="menu" aria-expanded="false" title="${tr('저장소 바꾸기')}">${icon('vault')}<span><strong>${esc(state.name)}</strong></span><span class="section-caret storage-caret" aria-hidden="true"></span></button>${['전체 자료','즐겨찾기'].map((n,i)=>`<button class="nav-btn ${state.folder===null&&!state.collection&&!state.desktopTag&&!state.savedSearch&&state.nav===n?'active':''}" data-nav="${n}">${i?`<span class="icon nav-star" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="${paths.star}"/></svg></span>`:icon('grid')}${valueLabel(n)}<span class="count">${availablePapers().filter(p=>!i||p.star).length}</span></button>`).join('')}<div class="sidebar-views">${sidebarViewsHtml()}</div><div class="sidebar-bottom"><button class="nav-btn" data-action="vault-manager">${icon('vault')}${tr('저장소 관리')}</button><button class="nav-btn" data-action="settings">${icon('settings')}${tr('설정')}</button></div></aside>`; // i18n:keep — navigation values
};
// A heading folds or opens its view; a folded view goes to the bottom.
document.addEventListener('click',event=>{const toggle=event.target.closest('[data-section-toggle]');if(!toggle)return;const id=toggle.dataset.sectionToggle,open=!viewOpen(id);setViewOpen(id,open);refreshVaultSidebar();document.querySelector(`[data-section-toggle="${id}"]`)?.focus();if(open)sidebarViews.find(v=>v.id===id)?.onOpen?.();});
// The handle between two opened views: drag, ↑/↓, or a double click for the default heights.
// As in VS Code, moving it past a view's smallest height takes the room from the next view along.
function sashStart(sash){const views=[...document.querySelectorAll('.sidebar-views>.sidebar-view.open')],below=views.findIndex(v=>v.dataset.view===sash.dataset.sash.split(':')[1]);return {views,below,heights:views.map(v=>v.getBoundingClientRect().height)};}
function resizeViews({views,below,heights},delta){
  const next=[...heights],grow=delta<0?below:below-1;let need=Math.abs(delta);
  const order=delta<0?[...Array(below).keys()].reverse():[...Array(views.length-below).keys()].map(i=>below+i);
  for(const i of order){const take=Math.min(need,Math.max(0,next[i]-VIEW_MIN));next[i]-=take;next[grow]+=take;need-=take;if(!need)break;}
  views.forEach((view,i)=>{const weight=next[i]/100;view.style.flex=`${weight} 1 0px`;try{localStorage.setItem('app-view-weight-'+view.dataset.view,String(weight));}catch{}});
}
document.addEventListener('pointerdown',event=>{
  const sash=event.target.closest?.('.view-sash');if(!sash||event.button!==0)return;event.preventDefault();
  const start=sashStart(sash),y=event.clientY;sash.setPointerCapture(event.pointerId);sash.classList.add('dragging');
  const move=e=>resizeViews(start,e.clientY-y),end=()=>{sash.classList.remove('dragging');sash.removeEventListener('pointermove',move);};
  sash.addEventListener('pointermove',move);sash.addEventListener('pointerup',end,{once:true});sash.addEventListener('pointercancel',end,{once:true});
});
document.addEventListener('keydown',event=>{const sash=event.target.closest?.('.view-sash');if(!sash||!['ArrowUp','ArrowDown'].includes(event.key))return;event.preventDefault();resizeViews(sashStart(sash),event.key==='ArrowDown'?16:-16);});
document.addEventListener('dblclick',event=>{const sash=event.target.closest?.('.view-sash');if(!sash)return;for(const view of sidebarViews)try{localStorage.removeItem('app-view-weight-'+view.id);}catch{}refreshVaultSidebar();});
function filtered() {
  let list=availablePapers().filter(p=>(state.folder===null||!state.folder||p.attachments.some(a=>a.folder===state.folder||a.folder.startsWith(state.folder+'/')))&&(state.folder!==null||state.collection||state.desktopTag||state.savedSearch||state.nav!=='즐겨찾기'||p.star)&&(!state.collection||p.collectionIds.includes(state.collection))&&(!state.desktopTag||p.tags.includes(state.desktopTag))&&(state.filter==='전체'||(state.filter==='번역 있음'?hasTranslation(p):p.status===state.filter))&&(!state.query||(paperSearchIndex.get(p.id)||'').includes(searchText(state.query)))); // i18n:keep — navigation, filter and read-status values
  if(state.sort==='year')list.sort((a,b)=>b.year-a.year);if(state.sort==='title')list.sort((a,b)=>a.title.localeCompare(b.title,'ko'));return list;
};
// Only the exceptions are marked: no PDF at all, or PDFs that can no longer be found.
const fileFlag=p=>!p.attachments.length?`<span class="pill file-flag" title="${tr('PDF 없이 서지정보만 있는 항목')}">${tr('서지만')}</span> `:p.attachments.some(a=>a.file)?'':`<span class="pill amber file-flag" title="${tr('첨부한 PDF를 찾을 수 없습니다(옮겨졌거나 지워짐)')}">${tr('파일 없음')}</span> `;
function paperRows(){const list=filtered();return list.length?list.map(p=>`<article tabindex="0" role="button" aria-label="${tr('{title} 선택',{title:esc(p.title)})}" class="paper-item ${p.id===state.selected?'selected':''}" data-paper="${p.id}"><div><h3>${esc(p.title)}</h3><p>${fileFlag(p)}${tr('첨부 {n}개',{n:p.attachments.length})} · ${esc(p.fileName)}</p><div class="tags">${hasTranslation(p)?`<span class="pill">${tr('번역 있음')}</span>`:''}${statusPill(p)}${tagLine(p)}</div></div><button class="star" data-star="${p.id}" aria-label="${p.star?tr('즐겨찾기 해제'):tr('즐겨찾기 추가')}">${p.star?'★':'☆'}</button></article>`).join(''):`<div class="empty">${tr('표시할 PDF가 없습니다.')}</div>`;};
function details(){const p=filtered().find(p=>p.id===state.selected)||filtered()[0];return `<aside class="detail" id="notes-panel" data-sidebar="right">${sidebarButtons('right')}${p?`<div class="item-title"><h2>${esc(p.title)}</h2>${itemMenuButton(p)}</div>${p.attachments.some(a=>a.file)?`<button class="primary" data-tree-file="${p.id}">${tr('자료 열기')}</button>`:''}${readStatusControl(p)}${bibliography(p)}${itemAttachments(p)}${tagEditor(p)}${itemCollectionEditor(p)}`:`<h3>${tr('자료 정보')}</h3>`}</aside>`;};
function library(){const list=filtered();return `<div class="library-layout">${sidebarEdges('right')}<section class="library"><div class="library-title row between"><div><h1>${esc(state.folder===null?navLabel(state.nav):folderLabel())}</h1><span class="small muted">${tr('{n}개 자료',{n:list.length})}</span></div><div class="row"><button class="secondary" data-action="duplicates">${tr('중복 자료 후보')}</button><button class="primary" data-action="add-files">${icon('plus')} ${tr('파일 추가')}</button></div></div><div class="filters"><div class="segmented">${['전체','읽기 전','읽는 중','번역 있음'].map(f=>`<button data-filter="${f}" class="${state.filter===f?'active':''}">${valueLabel(f)}</button>`).join('')}</div><select id="sort" aria-label="${tr('정렬')}"><option value="recent">${tr('등록 순')}</option><option value="title" ${state.sort==='title'?'selected':''}>${tr('제목순')}</option></select></div><div class="paper-list" id="paper-list">${paperRows()}</div></section>${details()}</div>`;}; // i18n:keep — filter and read-status values
function selectVaultFolder(folder){state.collection=null;state.folder=folder;state.nav=folder||state.name;state.savedSearch=null;state.desktopTag=null;state.query='';state.filter='전체';state.screen='library';showFolderParents(folder);state.selected=filtered()[0]?.id;persistTreeState();render();} // i18n:keep — filter value
let creatingFolder=false;
// ---- Folder menu: ⋯ on the row, a right-click, or F2 to rename ----
const revealItems=attrs=>`<button type="button" role="menuitem" data-reveal="open" ${attrs}>${tr('폴더에서 보기')}</button><button type="button" role="menuitem" data-reveal="copy" ${attrs}>${tr('경로 복사')}</button>`;
const folderMenu=folder=>(folder?`<button type="button" role="menuitem" data-folder-rename="${esc(folder)}">${tr('이름 바꾸기')}</button><button type="button" role="menuitem" data-folder-new="${esc(folder)}">${tr('새 하위 폴더')}</button>`:'')+revealItems(`data-reveal-folder="${esc(folder)}"`)+(folder?`<button type="button" role="menuitem" class="danger" data-folder-delete="${esc(folder)}">${tr('폴더 삭제…')}</button>`:'');
// Deleting a folder: what it holds is counted from what the vault shows (PDFs under it, the items
// that would go whole, folders inside), so the reader sees what will be lost before agreeing.
let folderToDelete=null;
function deleteFolderDialog(folder){
  const under=file=>file===folder||String(file||'').startsWith(folder+'/'),inside=a=>!a.trashedAt&&a.role!=='translated'&&under(a.folder??String(a.path||'').split('/').slice(0,-1).join('/'));
  let files=0,whole=0;for(const paper of [...papers,...vaultTrash]){const own=(paper.attachments||[]).filter(a=>a.role!=='translated'),doomed=own.filter(inside);files+=doomed.length;if(doomed.length&&doomed.length===own.length)whole++;}
  const folders=vaultFolders.filter(f=>f.startsWith(folder+'/')).length;folderToDelete=folder;
  modal(tr('폴더 삭제'),`<p>${tr('<strong>{folder}</strong> 폴더를 삭제합니다.',{folder:esc(folder)})}</p>${files||folders?`<ul>${files?`<li>${tr('PDF {n}개를 지웁니다. 파일은 컴퓨터의 휴지통으로 보내며, 휴지통을 쓸 수 없는 환경에서는 바로 지워집니다.',{n:files})}</li>`:''}${whole?`<li>${tr('자료 {n}개가 목록에서 사라지고, 그 메모·주석·번역·필기·AI 기록을 지웁니다. 이 기록은 되살릴 수 없습니다.',{n:whole})}</li>`:''}${files>whole&&files?`<li>${tr('다른 폴더에도 PDF가 있는 자료는 이 폴더의 첨부만 지웁니다.')}</li>`:''}${folders?`<li>${tr('안의 폴더 {n}개도 함께 지웁니다.',{n:folders})}</li>`:''}</ul>`:`<p>${tr('이 폴더에는 등록된 PDF가 없습니다.')}</p>`}<p class="small muted">${tr('폴더에 PDF가 아닌 파일이 있으면 폴더와 함께 휴지통으로 갑니다. PDF를 남기려면 취소한 뒤 먼저 다른 폴더로 옮기세요.')}</p>`,btn(tr('취소'),'close')+btn(tr('삭제'),'confirm-folder-delete','primary danger'));
}
async function deleteVaultFolder(){
  const folder=folderToDelete,id=state.storageKey;if(!folder)return;folderToDelete=null;
  await desktopNotes();if(dialog.open)dialog.close();
  const snapshot=await window.appApi.deleteFolder(id,folder);if(state.storageKey!==id)return;
  await(await pdfEngine()).clearDocuments?.();
  for(const f of [...expandedFolders])if(f===folder||f.startsWith(folder+'/'))expandedFolders.delete(f);
  if(state.folder!==null&&(state.folder===folder||state.folder.startsWith(folder+'/'))){state.folder=folder.split('/').slice(0,-1).join('/');state.nav=state.folder?folderLabel():'전체 자료';state.savedSearch=null;if(!state.folder)state.folder=null;} // i18n:keep — navigation value
  applyItemSnapshot(snapshot,{screen:'library'});persistTreeState();
  const report=snapshot.deleteReport||{},failed=report.failed||[];
  toast(failed.length?tr('PDF {n}개를 지우지 못해 폴더를 남겼습니다({files}).',{n:failed.length,files:failed.slice(0,3).join(', ')}):report.folderRemoved?(report.files?tr('“{folder}” 폴더를 삭제했습니다. PDF {n}개를 지웠습니다.',{folder:folder.split('/').pop(),n:report.files}):tr('“{folder}” 폴더를 삭제했습니다.',{folder:folder.split('/').pop()})):tr('폴더를 지우지 못했습니다. 폴더 안의 파일을 확인하세요.'));
}
function renameFolderDialog(folder){const name=folder.split('/').pop();modal(tr('폴더 이름 바꾸기'),`<label for="folder-rename">${tr('새 이름')}</label><input id="folder-rename" data-folder="${esc(folder)}" value="${esc(name)}" maxlength="128" autocomplete="off"><p class="small muted">${tr('디스크의 실제 폴더 이름이 바뀌고, 안의 PDF·메모·번역 연결은 그대로 유지됩니다.')}</p>`,btn(tr('취소'),'close')+btn(tr('바꾸기'),'confirm-folder-rename','primary'));setTimeout(()=>{const input=document.querySelector('#folder-rename');input?.focus();input?.select();});}
async function renameVaultFolder(){
  const input=document.querySelector('#folder-rename'),folder=input?.dataset.folder,name=input?.value.trim();if(!folder||!name)return;
  if(name===folder.split('/').pop()){dialog.close();return;}
  const id=state.storageKey;await desktopNotes();const result=await window.appApi.renameFolder(id,folder,name);if(state.storageKey!==id)return;
  const moved=f=>f===folder||f.startsWith(folder+'/'),renamed=f=>result.folder+f.slice(folder.length);
  for(const f of [...expandedFolders])if(moved(f)){expandedFolders.delete(f);expandedFolders.add(renamed(f));}
  if(state.folder!==null&&moved(state.folder))state.folder=renamed(state.folder);if(state.nav&&moved(state.nav))state.nav=renamed(state.nav);
  dialog.close();applySnapshot(result.snapshot);persistTreeState();render();toast(tr("폴더 이름을 '{name}'(으)로 바꿨습니다.",{name}));
}
Object.assign(actions,{'confirm-folder-rename':runDesktop(renameVaultFolder),'confirm-folder-delete':runDesktop(deleteVaultFolder)});
document.addEventListener('click',event=>{
  const more=event.target.closest('[data-folder-menu]');if(more){event.stopPropagation();if(popMenu?.anchor===more){closePopMenu();return;}openPopMenu(more,folderMenu(more.dataset.folderMenu),tr('폴더 메뉴'));return;}
  const rename=event.target.closest('[data-folder-rename]');if(rename){renameFolderDialog(rename.dataset.folderRename);return;}
  const remove=event.target.closest('[data-folder-delete]');if(remove){deleteFolderDialog(remove.dataset.folderDelete);return;}
  const child=event.target.closest('[data-folder-new]');if(child){state.folder=child.dataset.folderNew;actions['new-folder']();}
},true);
// A PDF in the tree: right-click or F2 renames the file on disk (it stays in its folder).
const fileMenu=file=>`<button type="button" role="menuitem" data-file-rename="${esc(file.dataset.treeFile)}" data-attachment="${esc(file.dataset.attachmentId)}">${tr('이름 바꾸기')}</button><button type="button" role="menuitem" data-move-attachment="${esc(file.dataset.attachmentId)}" data-paper-id="${esc(file.dataset.treeFile)}">${tr('이동·이름 바꾸기…')}</button>`+revealItems(`data-reveal-paper="${esc(file.dataset.treeFile)}" data-reveal-attachment="${esc(file.dataset.attachmentId)}"`)+fileDeleteItem(file);
// 삭제… in a file's menu: the paper's only file deletes the paper (its records go with it); another file only itself.
// Both ask first and send the PDF to the computer's trash.
function fileDeleteItem(file){const paper=papers.find(p=>p.id===Number(file.dataset.treeFile)),only=(paper?.attachments||[]).filter(a=>!a.trashedAt).length<=1;return `<button type="button" role="menuitem" class="danger" ${only?`data-delete-paper="${esc(file.dataset.treeFile)}"`:`data-delete-attachment="${esc(file.dataset.attachmentId)}" data-paper-id="${esc(file.dataset.treeFile)}"`}>${tr('파일 삭제…')}</button>`;}
// 폴더에서 보기 opens the system file manager at the file (selected) or in the folder; 경로 복사 copies the full path.
document.addEventListener('click',event=>{const item=event.target.closest('[data-reveal]');if(!item)return;closePopMenu();runDesktop(async()=>{
  const id=state.storageKey,file=item.dataset.revealPaper!==undefined,copy=item.dataset.reveal==='copy';
  const where=file?await window.appApi.revealPath(id,{paperId:Number(item.dataset.revealPaper),attachmentId:item.dataset.revealAttachment},copy):await window.appApi.revealPath(id,{folder:item.dataset.revealFolder},copy);
  if(copy)toast(tr('경로를 복사했습니다: {path}',{path:where}));
})();},true);
let fileRenameTarget=null;
function renameFileDialog(paperId,attachmentId){
  const paper=papers.find(p=>p.id===paperId),attachment=paper?.attachments.find(a=>a.id===attachmentId);if(!attachment?.file)return;fileRenameTarget={paperId,attachmentId,folder:attachment.folder};
  modal(tr('파일 이름 바꾸기'),`<label for="file-rename">${tr('새 이름')}</label><div class="row"><input id="file-rename" value="${esc(attachment.fileName.replace(/\.pdf$/i,''))}" maxlength="196" autocomplete="off"><span class="muted">.pdf</span></div><p class="small muted">${tr('디스크의 PDF 파일 이름이 바뀌고, 메모·번역·필기 연결은 그대로 유지됩니다.')}</p>`,btn(tr('취소'),'close')+btn(tr('바꾸기'),'confirm-file-rename','primary'));
  setTimeout(()=>{const input=document.querySelector('#file-rename');input?.focus();input?.select();});
}
Object.assign(actions,{'confirm-file-rename':runDesktop(async()=>{
  const target=fileRenameTarget,name=document.querySelector('#file-rename')?.value.trim();if(!target||!name)return;
  const file=/\.pdf$/i.test(name)?name:name+'.pdf',id=state.storageKey;await desktopNotes();
  const snapshot=await window.appApi.moveAttachment(id,target.paperId,target.attachmentId,target.folder,file);if(state.storageKey!==id)return;
  dialog.close();applyItemSnapshot(snapshot);toast(tr("파일 이름을 '{name}'(으)로 바꿨습니다.",{name:file}));
})});
document.addEventListener('click',event=>{const rename=event.target.closest('[data-file-rename]');if(rename)renameFileDialog(Number(rename.dataset.fileRename),rename.dataset.attachment);},true);
document.addEventListener('contextmenu',event=>{const file=event.target.closest('.vault-file');if(!file)return;event.preventDefault();openPopMenu(file,fileMenu(file),tr('파일 메뉴'));});
document.addEventListener('keydown',event=>{
  if(event.key==='F2'){const file=event.target.closest?.('.vault-file');if(file){event.preventDefault();renameFileDialog(Number(file.dataset.treeFile),file.dataset.attachmentId);}}
  if(event.key==='Enter'&&!event.isComposing&&event.target.id==='file-rename'){event.preventDefault();actions['confirm-file-rename']();}
});
document.addEventListener('contextmenu',event=>{const row=event.target.closest('.vault-row');if(!row)return;const more=row.querySelector('[data-folder-menu]');event.preventDefault();if(more)openPopMenu(more,folderMenu(more.dataset.folderMenu),tr('폴더 메뉴'));else openPopMenu(row.querySelector('.folder-name')||row,folderMenu(row.dataset.folderDrop||''),tr('저장소 폴더 메뉴'));});
document.addEventListener('keydown',event=>{
  if(event.key==='F2'){const more=event.target.closest?.('.vault-row')?.querySelector('[data-folder-menu]');if(more){event.preventDefault();renameFolderDialog(more.dataset.folderMenu);}}
  if(event.key==='Enter'&&!event.isComposing&&event.target.id==='folder-rename'){event.preventDefault();actions['confirm-folder-rename']();}
});
async function createVaultFolder(){
  if(creatingFolder)return;
  const name=document.querySelector('#folder-name')?.value.trim();if(!name){document.querySelector('#folder-name')?.focus();return;}
  const id=state.storageKey,parent=document.querySelector('#folder-name').dataset.parent;
  creatingFolder=true;try{await desktopNotes();const result=await window.appApi.createFolder(id,parent,name);if(state.storageKey!==id)return;applySnapshot(result.snapshot);selectVaultFolder(result.folder);toast(tr('폴더를 만들었습니다.'));}finally{creatingFolder=false;}
}
render = function () {
  if(state.screen==='library'&&!filtered().some(p=>p.id===state.selected))state.selected=filtered()[0]?.id;
  const previousPages=[...document.querySelectorAll('.translated-pages')];
  pdfLayoutObserver.disconnect();baseRender();
  for(const pages of previousPages)if(!pages.isConnected)pages.observer?.disconnect();
  refreshTranslationPane();
  const empty = document.querySelector('.paper-list>.empty');
  if (empty && !availablePapers().length) empty.innerHTML = `${tr('아직 PDF가 없습니다.')}<br><button class="primary" data-action="add-files">${tr('파일 추가')}</button>`;
  document.querySelectorAll('.reader-panel .saved').forEach(node => { node.textContent = tr('자동 저장'); });
};
async function refreshPreferences() { desktopPreferences = await window.appApi.bootstrap(); }
// Removing a recent vault only takes it off the list; the folder and its contents stay.
async function forgetRecent(id) {
  const name = desktopPreferences.recents.find(r => (r.key || r.id) === id)?.name || tr('저장소'), at = [...document.querySelectorAll('[data-recent-remove]')].findIndex(b => b.dataset.recentRemove === id);
  desktopPreferences.recents = await window.appApi.removeRecent(id); if (state.screen === 'welcome') render();
  const rows = document.querySelectorAll('.recent-item'); (rows[Math.min(at, rows.length - 1)] || document.querySelector('.open-folder'))?.focus();
  toast(tr("'{name}'을(를) 최근 목록에서 지웠습니다. 폴더와 내용은 그대로입니다.",{name}));
}
document.addEventListener('keydown', event => { if (event.key !== 'Delete' || event.repeat) return; const item = event.target.closest?.('[data-desktop-recent]'); if (!item) return; event.preventDefault(); runDesktop(() => forgetRecent(item.dataset.desktopRecent))(); });
// Optional features (desktop/features.cjs): available to this licence and switched on by the user.
// First run (no vault opened yet): what a vault is and the three steps to a first translation.
function welcomeGuide(){
  return `<section class="welcome-guide" aria-label="${tr('처음 시작하기')}"><h3>${tr('처음 시작하기')}</h3><ol><li><strong>${tr('폴더를 저장소로 연결')}</strong><span>${tr('논문 PDF가 있는 폴더(또는 빈 폴더)를 고르세요. 폴더 안의 PDF를 그대로 목록에 올리고, PDF 파일은 옮기거나 바꾸지 않습니다. 서지·메모·번역·필기는 그 폴더의 <code>.{id}</code> 폴더에 저장됩니다.')}</span></li><li><strong>${tr('파일 추가')}</strong><span>${tr('파일을 창에 끌어다 놓거나 <em>파일 추가</em>를 누르세요. DOI가 있으면 서지정보를 자동으로 채웁니다.')}</span></li><li><strong>${tr('번역 연결')}</strong><span>${tr('번역과 AI 기능은 왼쪽 아래 <em>설정</em>에서 ChatGPT 계정, API 키, 로컬 모델 중 하나를 연결하면 쓸 수 있습니다. 연결하지 않아도 읽기·메모·필기·서지 관리는 모두 됩니다.')}</span></li></ol><p class="small muted">${tr('단축키는 <kbd>?</kbd> 또는 <kbd>F1</kbd>로 볼 수 있습니다. 여러 PC에서 쓰려면 저장소를 연 뒤 <em>저장소 관리</em>의 동기화 폴더를 이용하세요.')}</p></section>`;
}
function featureOn(name) { return desktopPreferences.features?.[name]?.enabled === true; }
function featureAvailable(name) { return desktopPreferences.features?.[name]?.available === true; }
async function chooseDesktopStorage() {
  await desktopNotes(); await globalThis.appFlushAll?.();
  const snapshot = await window.appApi.chooseStorage();
  if (snapshot) { applySnapshot(snapshot); await refreshPreferences(); }
}
async function importDesktopFiles(kind) {
  if (!state.storageKey) return chooseDesktopStorage();
  await desktopNotes();
  const id = state.selected, screen = state.screen,storageId=state.storageKey,folder=state.folder||'';
  const result = await window.appApi.importFiles(storageId, kind === 'translated' ? id : null,folder);
  if (!result) return;
  if(state.storageKey===storageId){applyImportFolder(folder);showImportResult(result, kind, id, screen);}
}
function applyImportFolder(folder){state.folder=folder;showFolderParents(folder);persistTreeState();}
// What a PDF says about itself, for filling its bibliography: a DOI (its XMP
// or document information, a doi.org link or the text of its first three
// pages), an arXiv number, a title to search for (its information's, else the
// largest type on page 1), and the title, authors and year its information
// states (the only ones ever written into the record without a match).
const doiIn=text=>{let doi=String(text||'').match(/10\.\d{4,9}\/[^\s<>"?#]+/i)?.[0]?.replace(/[.,;]+$/,'');if(doi&&doi.endsWith(')')&&!doi.includes('('))doi=doi.slice(0,-1);return doi||null;};
async function pdfClues(storageId,paperId,attachmentId){
  const {pdf}=await(await pdfEngine()).documentFor(storageId,paperId,false,attachmentId);
  const meta=await pdf.getMetadata().catch(()=>({})),info=meta?.info||{},xmp=meta?.metadata,raw=String(xmp?.getRaw?.()||'');
  const get=key=>{try{return xmp?.get(key)??'';}catch{return '';}},line=value=>Array.isArray(value)?value.join('; '):String(value||'').trim();
  const texts=[],links=[];let title='';
  for(let n=1;n<=Math.min(3,pdf.numPages);n++){
    const page=await pdf.getPage(n),content=await page.getTextContent();texts.push(content.items.map(item=>item.str||'').join(' '));
    if(n>1)continue;
    for(const a of await page.getAnnotations().catch(()=>[]))if(a.url)links.push(a.url);
    // The title: the largest type in the top half of page 1, in reading order.
    const height=page.view[3]-page.view[1],sized=content.items.filter(item=>(item.str||'').trim().length>1&&item.transform[5]>height*.4).map(item=>({item,size:Math.hypot(item.transform[2],item.transform[3])}));
    const top=Math.max(0,...sized.map(s=>s.size));
    if(top)title=sized.filter(s=>s.size>=top*.92).sort((a,b)=>b.item.transform[5]-a.item.transform[5]||a.item.transform[4]-b.item.transform[4]).map(s=>s.item.str.trim()).join(' ').replace(/\s+/g,' ').trim();
  }
  const xmpDOI=/(?:prism:doi|crossmark:doi|pdfx:doi)\s*(?:=\s*["']|>)\s*(?:doi:\s*)?([^<"']+)/i.exec(raw)?.[1];
  const doi=doiIn(xmpDOI)||doiIn(get('dc:identifier'))||doiIn(info.doi||info.DOI)||doiIn(info.Subject)||doiIn(info.Keywords)||doiIn(links.find(url=>/doi\.org\//i.test(url)))||doiIn(texts[0])||doiIn(texts.slice(1).join(' '));
  const arxiv=/arXiv:\s?(\d{4}\.\d{4,5}|[a-z-]+(?:\.[A-Z]{2})?\/\d{7})(?:v\d+)?/i.exec(texts[0]||'')?.[1]||null;
  const metaTitle=line(get('dc:title'))||line(info.Title),authors=get('dc:creator')||line(info.Author);
  const year=(/\b(19|20)\d{2}\b/.exec(line(get('prism:coverdate'))||line(get('prism:publicationdate')))||[''])[0];
  return {doi:doi||(arxiv&&/^\d{4}\./.test(arxiv)?`10.48550/arXiv.${arxiv}`:null),arxiv,title:metaTitle.split(/\s+/).length>=3&&!/^(untitled|microsoft|document\d*$)|\.(docx?|tex|dvi|pdf)$/i.test(metaTitle)?metaTitle:title,metaTitle,authors:Array.isArray(authors)?authors:line(authors),year,journal:line(get('prism:publicationname'))};
}
async function doiFromPdf(storageId,paperId,attachmentId){return (await pdfClues(storageId,paperId,attachmentId)).doi;}
// Bibliographies fill themselves in the background (empty fields only):
// new PDFs at once, and on opening a vault every item still missing its
// authors or year or still titled by its file name, once per item on this
// computer, unless this vault turned it off. After a network failure the
// rest wait for the next time the vault opens.
const autofillOn=id=>{try{return localStorage.getItem('app-autofill-'+id)!=='off';}catch{return true;}};
const autofillKey=paper=>`${paper.id}:${paper.primaryAttachmentId||paper.attachments[0]?.id||''}`;
function autofillTried(id){try{return new Set(JSON.parse(localStorage.getItem('app-autofill-tried-'+id)||'[]'));}catch{return new Set();}}
function markAutofillTried(id,paper){try{const tried=[...autofillTried(id),autofillKey(paper)].slice(-5000);localStorage.setItem('app-autofill-tried-'+id,JSON.stringify([...new Set(tried)]));}catch{}}
function needsBibliography(paper){
  const named=paper.attachments.some(a=>a.name&&paper.title===a.name.replace(/\.pdf$/i,''));
  return (named||!paper.authors||paper.authors==='저자 미입력'||!paper.year||paper.year==='—')&&paper.attachments.some(a=>a.file&&a.role!=='translated'&&!a.trashedAt); // i18n:keep — stored value for no author
}
let autofillQueue=Promise.resolve(),autofillTimer=0;const autofillPaused=new Set();
async function autofillPapers(storageId,paperIds,{announce=true,pace=0}={}){
  if(viewOnly)return; // a window that only reads fills in nothing
  const counts={doi:0,title:0,pdf:0},filled=new Set();let failed=null,unchanged=0;
  for(const paperId of paperIds){
    if(state.storageKey!==storageId)return null;
    const paper=papers.find(p=>p.id===paperId);if(!paper)continue;
    if(pace&&paperId!==paperIds[0])await new Promise(resolve=>setTimeout(resolve,pace));
    let clues={};try{clues=await pdfClues(storageId,paperId);}catch(error){globalThis.quietError?.('pdf-clues',error);}
    try{const result=await window.appApi.autofillBibliography(storageId,paperId,clues);markAutofillTried(storageId,paper);if(result.filled.length){filled.add(paperId);counts[result.source]++;}else unchanged++;}
    catch(error){failed=error;autofillPaused.add(storageId);break;}
  }
  if(filled.size&&state.storageKey===storageId){
    // The filled items are updated in place; nothing being typed is redrawn
    // (only the library list and an open bibliography).
    const snapshot=await window.appApi.refreshStorage(storageId);if(state.storageKey!==storageId)return null;
    for(const fresh of snapshot.papers){if(!filled.has(fresh.id))continue;const paper=papers.find(p=>p.id===fresh.id);if(paper){const {files,...fields}=fresh;Object.assign(paper,fields);indexPaperSearch(paper);}}
    if(state.screen==='library')globalThis.refreshLibraryList?.();
    const shown=document.querySelector('#notes-panel .bibliography');if(shown&&filled.has(state.selected)&&!dialog.open)document.querySelector('#notes-panel').outerHTML=state.screen==='reader'?panel():details();
  }
  const parts=[counts.doi&&tr('DOI로 {n}개 항목',{n:counts.doi}),counts.title&&tr('제목 검색으로 {n}개 항목',{n:counts.title}),counts.pdf&&tr('PDF 정보로 {n}개 항목',{n:counts.pdf})].filter(Boolean);
  if(announce&&parts.length)toast(`${tr('{parts}의 빈 서지정보를 채웠습니다.',{parts:parts.join(', ')})}${counts.title?` ${tr('제목 검색으로 찾은 항목은 확인해 주세요.')}`:''}`);
  return {filled:filled.size,counts,unchanged,failed};
}
function queueAutofill(storageId,pick,options){const run=autofillQueue.catch(()=>{}).then(()=>{if(state.storageKey!==storageId||!autofillOn(storageId))return null;const ids=pick();return ids.length?autofillPapers(storageId,ids,options):null;});autofillQueue=run;return run;}
function autofillImported(storageId,paperIds){return queueAutofill(storageId,()=>paperIds.filter(id=>papers.some(p=>p.id===id)));}
function autofillPending(storageId){
  if(autofillPaused.has(storageId))return;
  queueAutofill(storageId,()=>{const tried=autofillTried(storageId);return availablePapers().filter(p=>needsBibliography(p)&&!tried.has(autofillKey(p))).map(p=>p.id);},{pace:300}).catch(()=>{});
}
const baseApplyAutofill=applySnapshot;
applySnapshot=function(snapshot){baseApplyAutofill(snapshot);clearTimeout(autofillTimer);autofillTimer=setTimeout(()=>autofillPending(snapshot.id),1500);};
// By hand: one item (the button beside its bibliography) or the checked ones; tried again even if tried before.
async function autofillByHand(paperIds){
  const id=state.storageKey;if(!paperIds.length)return;autofillPaused.delete(id);
  toast(paperIds.length>1?tr('서지정보 {n}개를 찾는 중…',{n:paperIds.length}):tr('서지정보를 찾는 중…'));
  const result=await autofillPapers(id,paperIds);if(!result)return;
  if(result.failed)throw Error(tr('서지정보를 조회하지 못했습니다: {error}',{error:plainError(result.failed)}));
  if(!result.filled)toast(paperIds.length>1?tr('채울 수 있는 빈 서지정보를 찾지 못했습니다.'):tr('채울 빈 칸이 없거나, DOI·제목으로 서지정보를 찾지 못했습니다. 편집에서 DOI를 넣어 조회해 보세요.'));
}
Object.assign(actions,{'autofill-paper':runDesktop(()=>autofillByHand([state.selected]))});
function showImportResult(result, kind = 'original', id = state.selected, screen = state.screen) {
  if(kind==='original')autofillImported(state.storageKey,[...new Set(result.results.filter(r=>r.ok&&r.paperId).map(r=>r.paperId))])?.catch(()=>{});
  applySnapshot(result.snapshot);
  if (kind === 'translated' && screen === 'reader') { state.selected = id; state.screen = 'reader'; state.mode = 'dual'; render(); }
  const failed = result.results.filter(r => !r.ok);
  if (result.duplicates?.length) return askKnownCopies(result);
  if (failed.length) modal(tr('파일 추가 결과'), `<p>${tr('{n}개 추가',{n:result.results.filter(r => r.ok).length})}</p>${failed.map(r => `<p>${esc(r.name)}: ${esc(r.error)}</p>`).join('')}`, btn(tr('확인'), 'close', 'primary'));
  else toast(tr('{n}개 파일을 저장소에 보관했습니다.',{n:result.results.length}));
}
let dropOverlay, importingDrop = false;
function clearDropOverlay() { dropOverlay?.remove(); dropOverlay = null; }
// Files from the computer can be dropped anywhere in the window: on a folder in the sidebar (into
// that folder), on a paper's 첨부 tab (attached to that paper), or anywhere else (the current folder).
// Text fields and editors keep their own drops.
function dropZone(event){
  if(event.target.closest?.('input,textarea,[contenteditable="true"],.cm-editor'))return null;
  const node=event.target.closest?.('[data-folder-drop],.item-attachments,.shell');if(!node)return null;
  if(node.matches('.item-attachments')){if(state.screen!=='reader'||!selected())return null;node.dataset.attachDrop='';return node;}
  return node.matches('[data-folder-drop]')?node:document.querySelector('.library')||node;
}
function dropFolder(zone){return zone?.dataset.folderDrop!==undefined?zone.dataset.folderDrop:state.folder||'';}
function reportImport(result,verb){const failed=result.results.filter(r=>!r.ok),attached=verb==='첨부';if(failed.length)modal(tr('파일 추가 결과'),`<p>${attached?tr('{n}개 첨부',{n:result.results.filter(r=>r.ok).length}):tr('{n}개 추가',{n:result.results.filter(r=>r.ok).length})}</p>${failed.map(r=>`<p>${esc(r.name)}: ${esc(r.error)}</p>`).join('')}`,btn(tr('확인'),'close','primary'));else toast(attached?tr('{n}개 파일을 자료에 첨부했습니다.',{n:result.results.length}):tr('{n}개 파일을 저장소에 보관했습니다.',{n:result.results.length}));} // i18n:keep — '첨부' names the kind of import
function fileDrag(event) { return Array.from(event.dataTransfer?.types || []).includes('Files'); }
document.addEventListener('dragover', event => {
  if (!fileDrag(event)) return;
  event.preventDefault();
  const zone = dropZone(event);
  const allowed = zone && state.storageKey && !importingDrop && !dialog.open;
  event.dataTransfer.dropEffect = allowed ? 'copy' : 'none';
  if (!allowed) { clearDropOverlay(); return; }
  if (!dropOverlay) { dropOverlay = document.createElement('div'); dropOverlay.className = 'pdf-drop-overlay'; document.body.append(dropOverlay); }
  const bounds = zone.getBoundingClientRect();
  Object.assign(dropOverlay.style, { left: bounds.left + 8 + 'px', top: bounds.top + 8 + 'px', width: bounds.width - 16 + 'px', height: bounds.height - 16 + 'px' });
  dropOverlay.textContent = zone.dataset.attachDrop!==undefined?tr('PDF를 놓으면 “{title}”에 첨부합니다',{title:selected()?.title||tr('이 자료')}):tr('PDF를 놓으면 “{place}”에 추가합니다',{place:state.name+(dropFolder(zone)?'/'+dropFolder(zone):'')});
});
document.addEventListener('dragleave', event => { if (!event.relatedTarget) clearDropOverlay(); });
document.addEventListener('dragend', clearDropOverlay);
window.addEventListener('blur', clearDropOverlay);
document.addEventListener('drop', event => {
  clearDropOverlay();
  if (!fileDrag(event)) return;
  event.preventDefault();
  if (!state.storageKey) { toast(tr('저장소를 먼저 연결한 뒤 라이브러리에 PDF를 놓아 주세요.')); return; }
  const zone=dropZone(event);
  if (!zone || dialog.open || importingDrop) return;
  const files = Array.from(event.dataTransfer.files);
  if (!files.length) return;
  if (files.length > 100) { toast(tr('한 번에 최대 100개의 파일을 추가할 수 있습니다.')); return; }
  const targetId = state.storageKey,targetFolder=dropFolder(zone);
  if(zone.dataset.attachDrop!==undefined){
    const paperId=state.selected,attachmentId=state.selectedAttachment,screen=state.screen,tab=state.tab,mode=state.mode;importingDrop=true;
    runDesktop(async()=>{try{await desktopNotes();const result=await window.appApi.attachDroppedFiles(targetId,paperId,files,state.folder||'');if(state.storageKey!==targetId)return;const pos=readingPosition();setTimeout(()=>restoreReadingPosition(pos),0);applyItemSnapshot(result.snapshot,{paperId,attachmentId,screen,tab,mode});reportImport(result,'첨부');}finally{importingDrop=false;}})(); // i18n:keep — the kind of import
    return;
  }
  importingDrop = true;
  runDesktop(async () => {
    try {
      await desktopNotes();
      const result = await window.appApi.importDroppedFiles(targetId, files,targetFolder);
      // In the reader the paper stays open where it was; the new items wait in the library's folder.
      if (state.storageKey === targetId&&state.screen==='reader'){const paperId=state.selected,attachmentId=state.selectedAttachment,tab=state.tab,mode=state.mode,pos=readingPosition();autofillImported(targetId,[...new Set(result.results.filter(r=>r.ok&&r.paperId).map(r=>r.paperId))])?.catch(()=>{});setTimeout(()=>restoreReadingPosition(pos),0);applyItemSnapshot(result.snapshot,{paperId,attachmentId,screen:'reader',tab,mode});if(result.duplicates?.length)askKnownCopies(result,targetFolder);else reportImport(result,'추가');} // i18n:keep — the kind of import
      else if (state.storageKey === targetId){applyImportFolder(targetFolder);showImportResult(result);}
      else toast(tr('드롭한 대상 저장소에 파일을 추가했습니다.'));
    } finally { importingDrop = false; }
  })();
});
Object.assign(actions, {
  storage:runDesktop(chooseDesktopStorage),
  'new-folder':()=>{const parent=state.folder||'';modal(tr('새 폴더'),`<label for="folder-name">${tr('폴더 이름')}</label><input id="folder-name" data-parent="${esc(parent)}" aria-label="${tr('폴더 이름')}" maxlength="128" autocomplete="off">`,btn(tr('취소'),'close')+btn(tr('만들기'),'create-folder','primary'));document.querySelector('#folder-name').focus();},
  'create-folder':runDesktop(createVaultFolder),
  'refresh-vault':runDesktop(async()=>{const id=state.storageKey;await desktopNotes();const snapshot=await window.appApi.refreshStorage(id);if(state.storageKey===id)applySnapshot(snapshot);}),
  read:()=>{if(!activeAttachment()?.file){toast(tr('원문 파일이 없습니다. 파일 목록을 새로고침하세요.'));return;}activateAttachment(state.selected,state.selectedAttachment);state.screen='reader';state.tab='메모';state.mode='original';render();}, // i18n:keep — tab value
  'add-files':runDesktop(()=>importDesktopFiles('original')),
  settings:()=>openGPTSettings(),
  jobs:()=>showGPTJobs()
});
document.addEventListener('click', event => {
  const removeRecent = event.target.closest('[data-recent-remove]');
  if (removeRecent) { event.stopPropagation(); runDesktop(() => forgetRecent(removeRecent.dataset.recentRemove))(); return; }
  const recent = event.target.closest('[data-desktop-recent]');
  if (recent) runDesktop(async () => { await desktopNotes(); await globalThis.appFlushAll?.(); applySnapshot(await window.appApi.openRecent(recent.dataset.desktopRecent)); await refreshPreferences(); })();
  const tag = event.target.closest('[data-desktop-tag]');
  if (tag) { state.collection=null;state.folder=null;persistTreeState();state.desktopTag = tag.dataset.desktopTag; state.nav = tag.dataset.desktopTag; state.savedSearch = null; state.screen = 'library'; render(); }
  if (event.target.closest('[data-nav]')) { state.collection=null;state.folder=null;state.desktopTag = null;persistTreeState(); render(); }
  const star = event.target.closest('[data-star]');
  if (star) { const paper = papers.find(p => p.id === Number(star.dataset.star)); if (paper) runDesktop(() => window.appApi.updatePaper(state.storageKey, paper.id, { star: Boolean(paper.star) }))(); }
});
// Light, dark or the system's choice (kept on this computer). The select always shows the
// current mode, so choosing 밝게 after 어둡게 is a change the page hears.
const themeMode=()=>{try{const v=localStorage.getItem('app-theme');return ['light','dark','system'].includes(v)?v:'light';}catch{return 'light';}};
const systemDark=matchMedia('(prefers-color-scheme: dark)');
function applyAppearance(){const mode=themeMode(),dark=mode==='dark'||mode==='system'&&systemDark.matches;document.body.classList.toggle('dark',dark);document.documentElement.dataset.knMode=dark?'dark':'light';document.documentElement.dataset.knUi='';document.dispatchEvent(new CustomEvent('app-appearance'));}
systemDark.addEventListener('change',()=>{if(themeMode()==='system')applyAppearance();});
function themeModeField(){const mode=themeMode();return `<div class="field"><label for="theme">${tr('화면 모드')}</label><select id="theme">${[['light',tr('밝게')],['dark',tr('어둡게')],['system',tr('시스템 설정 따르기')]].map(([v,l])=>`<option value="${v}" ${v===mode?'selected':''}>${l}</option>`).join('')}</select></div>`;}
// Capture: the theme select is this script's alone.
document.addEventListener('change', event => { if (event.target.id !== 'theme') return; event.stopImmediatePropagation(); try { localStorage.setItem('app-theme', event.target.value); } catch {} applyAppearance(); }, true);
document.addEventListener('input', event => { if (event.target.dataset.note) noteEdited(event.target.dataset.note, event.target.value); });
// A memo or summary text changed or removed: search and the notebook's embeds follow it. Writers that
// save by themselves (deleting a memo, adopting AI results) call this; typing goes through noteEdited.
function noteIndexed(noteKey,value){
  document.dispatchEvent(new CustomEvent('app-note-edited',{detail:{key:noteKey}}));
  const paperId=Number(noteKey.split('-')[0]);if(!noteSearchParts.has(paperId))noteSearchParts.set(paperId,new Map());
  if(value===undefined)noteSearchParts.get(paperId).delete(noteKey);else noteSearchParts.get(paperId).set(noteKey,value);indexPaperSearch(papers.find(p=>p.id===paperId));
}
// A memo or summary text changed (typed, or set by the memo window or AI): index it for search and save.
function noteEdited(noteKey,value){
  clearTimeout(noteSaveTimer);noteIndexed(noteKey,value);
  // Saved once typing pauses (each save rewrites library.json); leaving the
  // paper, switching vaults and closing the window save at once (desktopNotes).
  const revision=++noteRevision,saved=document.querySelector('#saved');if(saved)saved.textContent=tr('저장 중…');
  noteSaveTimer=setTimeout(()=>desktopNotes().then(()=>{if(revision!==noteRevision)return;const node=document.querySelector('#saved');if(node)node.textContent=tr('✓ 저장소에 저장됨');}).catch(error=>{if(revision===noteRevision){const node=document.querySelector('#saved');if(node)node.innerHTML=`${tr('저장 실패')} <button class="secondary small" data-action="retry-notes">${tr('다시 시도')}</button>`;}toast(tr('메모 저장 실패: {error}',{error:shownError(error)}));}),300);
}
applyAppearance();
papers.splice(0); fullPdfs.clear(); notes = {};
runDesktop(async () => {
  // The scripts after this one (library, ink, notebook…) extend how a vault
  // is applied, so the first vault waits until they have all run.
  const loaded=document.readyState==='loading'?new Promise(resolve=>document.addEventListener('DOMContentLoaded',resolve,{once:true})):null;
  await Promise.all([refreshPreferences(),loaded]);
  const windowParams=new URLSearchParams(location.search);if(windowParams.get('notebookWindow')==='1'){await globalThis.appNotebookWindow(windowParams);return;}
  if(['original','translation'].includes(windowParams.get('viewWindow'))){await originalViewWindow(windowParams);return;}
  // Settings files set aside at start (they could not be read): said once, in the main window.
  if(desktopPreferences?.startupNotices?.length)setTimeout(()=>toast(desktopPreferences.startupNotices.join(' '),15000),400);
  // A saved API key or ChatGPT connection that could not be read (the secure storage's key changed, as on Linux when
  // the app's name changed) is told at start, and its place in the settings says so until it is connected again.
  window.appApi.llmConnections().then(list=>{if(list.some(c=>c.restoreFailed))setTimeout(()=>toast(window.appApi.platform==='linux'?tr('저장된 API 키(또는 ChatGPT 연결)를 읽지 못했습니다. 앱 이름이 바뀌어 Linux 보안 저장소의 키가 달라졌을 수 있습니다. 설정에서 다시 연결하세요.'):tr('저장된 API 키(또는 ChatGPT 연결)를 읽지 못했습니다. 설정에서 다시 연결하세요.'),12000),1500);}).catch(()=>{});
  // The start screen, with the recent vaults, is the first screen: it stays while the last vault opens.
  render();
  const restored=desktopPreferences.development?await window.appApi.devState():null;
  if(restored){applySnapshot(restored.snapshot);if(restored.ui?.libraryId===state.storageKey){const {libraryId,...ui}=restored.ui;Object.assign(state,ui);if(!papers.some(p=>p.id===state.selected))state.screen='library';}render();return;}
  // The app starts in the vault used last. If it cannot be opened (moved,
  // on a drive that is not attached, held by another app), the start screen
  // stays, with every recent vault and the reason. The PDF read last there
  // opens again, at its page and view.
  const last=desktopPreferences.recents[0];
  if(last){try{applySnapshot(await window.appApi.openRecent(last.key||last.id));await refreshPreferences();if(!await globalThis.appReopenLast?.().catch(()=>false))render();return;}catch(error){toast(errorCode(error)==='APP_RECENT_MISSING'?shownError(error):tr("최근 저장소 '{name}'를 열지 못했습니다: {error}",{name:last.name,error:shownError(error)}));}}
  render();
})();

let gptAccount={connected:false,usable:false},gptModels=[],translationRecord=null,currentJob=null,translationTarget=null,translationTimer,readingRecord=false,startingTranslation=false,extractionCancelled=false,stopExtraction=()=>{};
const pdfEngine=()=>import('./pdf-view.js');
function targetKey(){return state.storageKey+':'+state.selected+':'+(state.selectedAttachment||'primary')}
function accountDescription(){return gptAccount.connecting?tr('브라우저에서 ChatGPT 인증을 진행하세요.'):gptAccount.usable?tr('연결됨 · {account}',{account:esc(gptAccount.email||tr('ChatGPT 계정'))}):gptAccount.connected?tr('로그인됨 · 앱 사용량 권한 확인 필요'):tr('ChatGPT가 연결되지 않았습니다.')}
// Connection settings: the ChatGPT account and a local model server.
let localLLM=null,pendingLocal=null;
const LOCAL_URLS={ollama:'http://127.0.0.1:11434',openai:'http://127.0.0.1:1234/v1'};
const hostOf=url=>{try{return new URL(url).host;}catch{return url;}};
const localHint=kind=>kind==='openai'?tr('문맥 길이는 서버에서 설정합니다(16K 이상 권장). 여기 적은 값은 AI 도우미가 보낼 글자 수를 정하는 데만 씁니다.'):tr('Ollama에는 요청마다 이 문맥 길이를 보냅니다. 길수록 메모리를 더 씁니다. 번역에는 16384 이상을 권장합니다.');
function localStatusText(s){return !s.enabled?tr('꺼짐'):s.remote&&!s.remoteConfirmed?tr('원격 주소 전송 확인 필요'):s.remote?tr('켜짐 · 원격 서버 {host}',{host:hostOf(s.url)}):tr('켜짐 · 이 PC');}
function localSection(s){
  return `<p>${tr('Ollama 같은 로컬 LLM 서버로 번역·AI 도우미·그림 설명을 처리합니다. 사용량 과금이 없고, 이 PC의 주소를 쓰면 자료 본문이 외부로 나가지 않습니다.')}</p><label class="llm-check"><input type="checkbox" id="local-enabled" ${s.enabled?'checked':''}> ${tr('로컬 모델 사용')}</label><div class="llm-grid"><div class="field"><label for="local-kind">${tr('서버 종류')}</label><select id="local-kind"><option value="ollama" ${s.kind==='ollama'?'selected':''}>Ollama</option><option value="openai" ${s.kind==='openai'?'selected':''}>${tr('OpenAI 호환 (LM Studio, llama.cpp 등)')}</option></select></div><div class="field"><label for="local-ctx">${tr('문맥 길이(토큰)')}</label><input id="local-ctx" type="number" min="8192" max="131072" step="1024" value="${s.numCtx}"></div></div><div class="field"><label for="local-url">${tr('서버 주소')}</label><input id="local-url" value="${esc(s.url)}" spellcheck="false" autocomplete="off"></div><p class="small muted" id="local-hint">${localHint(s.kind)}</p><label class="llm-check"><input type="checkbox" id="local-think" ${s.think?'checked':''} ${s.kind==='openai'?'disabled':''}> ${tr('추론(생각) 사용')}</label><p class="small muted">${tr('Ollama의 추론 모델(Qwen3 등)에만 적용됩니다. 켜면 답하기 전에 생각하므로 품질이 나아질 수 있지만 훨씬 느려지고, 느린 PC에서는 요청 시간 제한(10분)을 넘길 수 있습니다.')}</p><p class="small" id="local-status" role="status">${esc(localStatusText(s))}</p><div class="row">${btn(tr('연결 확인'),'local-check')}${btn(tr('저장'),'local-save','primary')}</div>`;
}
// API keys: billed to the user's own account, kept encrypted in the main process; only the last four characters come back.
const API_KEY_FORMS={'gpt-api':'sk-…','claude-api':'sk-ant-…','gemini-api':'AIza…'};
const apiStatusText=c=>c.restoreFailed?tr('저장된 키를 읽지 못함 · 다시 입력하세요'):c.hasKey?`${tr('키 저장됨 · {hint}',{hint:c.hint})}${c.persistent?'':` · ${tr('이번 실행에만 유지')}`}`:tr('키 없음');
// An error from the main process carries Electron's "Error invoking remote method" prefix.
// A code the main process attached to an error arrives in front of its message as ⟦CODE⟧.
const plainError=error=>errorCode(error)==='APP_DROP_NOT_FILE'?tr('컴퓨터에 저장된 PDF 파일을 드래그해 주세요.'):String(error?.message||error).replace(/^Error invoking remote method '[^']+': (?:[A-Za-z]*Error: )?/,'').replace(/^⟦[A-Z_]+⟧/,'');
// What a screen shows of an IPC error: its message exactly as it arrived, minus only the ⟦CODE⟧ marker.
const shownError=error=>errorCode(error)==='APP_DROP_NOT_FILE'?tr('컴퓨터에 저장된 PDF 파일을 드래그해 주세요.'):String(error?.message).replace(/⟦[A-Z_]+⟧/,'');
const errorCode=error=>/(?:^|: )⟦([A-Z_]+)⟧/.exec(String(error?.message||error))?.[1]||'';
function apiRow(c){
  return `<div class="api-row" data-api-row="${esc(c.id)}"><div class="api-head"><strong>${esc(c.label)}</strong><small id="api-status-${esc(c.id)}" role="status">${esc(apiStatusText(c))}</small></div>${c.custom?`<p class="small muted api-url">${esc(c.url)}</p>`:''}<div class="api-key"><input type="password" id="api-key-${esc(c.id)}" placeholder="${esc(API_KEY_FORMS[c.id]||tr('API 키'))}" autocomplete="off" spellcheck="false" aria-label="${tr('{name} 키',{name:esc(c.label)})}"><button class="secondary small" data-api-action="save" data-api="${esc(c.id)}">${c.hasKey?tr('바꾸기',null,'api key'):tr('저장')}</button>${(c.hasKey||c.restoreFailed)&&!c.custom?`<button class="secondary small" data-api-action="remove" data-api="${esc(c.id)}">${tr('삭제')}</button>`:''}${!c.custom||c.keyPage?`<button class="secondary small" data-api-action="page" data-api="${esc(c.id)}">${tr('키 발급')}</button>`:''}${c.custom?`<button class="secondary small danger-text" data-api-action="remove-provider" data-api="${esc(c.id)}">${tr('공급자 삭제')}</button>`:''}</div>${c.id==='gemini-api'?`<p class="small muted">${tr('무료 등급 키는 Google 약관에 따라 입력 내용이 서비스 개선에 쓰일 수 있습니다. 자료를 보내기 전에 결제(유료 등급) 설정을 확인하세요.')}</p>`:''}</div>`;
}
let providerPresets=[];
// Other providers: any service that speaks the OpenAI Chat Completions API, from a preset or an address of the user's own.
function providerForm(count){
  if(count>=5)return `<p class="small muted">${tr('기타 공급자는 5개까지 추가할 수 있습니다.')}</p>`;
  return `<div class="provider-add"><strong>${tr('기타 공급자 추가')}</strong><p class="small muted">${tr('OpenAI 호환 API(Chat Completions)를 제공하는 공급자를 연결합니다. 주소는 보통 …/v1 로 끝납니다.')}</p><div class="llm-grid"><div class="field"><label for="provider-preset">${tr('공급자')}</label><select id="provider-preset">${providerPresets.map(p=>`<option value="${esc(p.id)}" data-url="${esc(p.url)}" data-name="${esc(p.name)}">${esc(p.name)}</option>`).join('')}<option value="">${tr('직접 입력')}</option></select></div><div class="field"><label for="provider-name">${tr('이름')}</label><input id="provider-name" maxlength="40" value="${esc(providerPresets[0]?.name||'')}" autocomplete="off"></div></div><div class="field"><label for="provider-url">${tr('API 주소')}</label><input id="provider-url" value="${esc(providerPresets[0]?.url||'')}" spellcheck="false" autocomplete="off" placeholder="https://api.example.com/v1"></div><div class="api-key"><input type="password" id="provider-key" placeholder="${tr('API 키')}" autocomplete="off" spellcheck="false" aria-label="${tr('새 공급자 API 키')}">${btn(tr('연결'),'provider-add','primary')}</div><p class="small" id="provider-status" role="status"></p></div>`;
}
function apiSummary(rows){const keyed=rows.filter(c=>c.hasKey).length;return keyed?tr('키 {n}개 연결됨',{n:keyed}):tr('연결 없음');}
function apiSection(connections){
  const rows=connections.filter(c=>c.kind==='api');
  return `<p>${tr('공급자에서 발급한 API 키로 연결합니다. 사용한 만큼 각 공급자 계정에 요금이 청구되며, 다른 연결로 자동 전환하지 않습니다. 키는 이 컴퓨터의 보안 저장소에 암호화해 보관하고 화면에는 끝 네 자리만 보여 줍니다.')}</p>${rows.map(apiRow).join('')}${providerForm(rows.filter(c=>c.custom).length)}`;
}
// The settings window: one folding section per way of connecting; the way used last starts open.
// It can be made wider or narrower from its corner (the width is kept on this computer).
let llmOpenSections=null;
function llmSectionOfConnection(id){return id==='gpt-web'?'gpt':id==='local'?'local':'api';}
function llmSection(id,title,summary,body){const open=llmOpenSections.has(id);return `<details class="llm-section" data-llm-section="${id}" ${open?'open':''}><summary><span class="section-caret" aria-hidden="true"></span><h3>${title}</h3><small>${esc(summary)}</small></summary><div class="llm-body">${body}</div></details>`;}
async function openGPTSettings(){modelListCache.clear();
  const connections=await window.appApi.llmConnections();if(!providerPresets.length)providerPresets=await window.appApi.providerPresets().catch(()=>[]);
  gptAccount=connections.find(c=>c.id==='gpt-web')||await window.appApi.authStatus();localLLM=connections.find(c=>c.id==='local')||null;
  const reopening=dialog.open&&dialog.classList.contains('llm-dialog');
  if(!reopening||!llmOpenSections)llmOpenSections=new Set([llmSectionOfConnection(desktopPreferences.connection||'gpt-web')]);
  const gptBody=`<p>${tr('처음 한 번 시스템 브라우저에서 ChatGPT에 로그인하고 {app}의 모델 사용 권한을 허용하세요. 이후 앱의 번역·동시보기 버튼으로 번역합니다.')}</p>${!gptAccount.persistent?`<p>${tr('이 컴퓨터의 보안 저장소를 사용할 수 없어 인증은 이번 실행 중에만 유지됩니다. Linux에서는 Secret Service를 설정하면 연결을 안전하게 보관할 수 있습니다.')}</p>`:''}${gptAccount.restoreFailed?`<p class="small">${window.appApi.platform==='linux'?tr('저장된 연결을 읽지 못했습니다. 앱 이름이 바뀌어 Linux 보안 저장소의 키가 달라졌을 수 있습니다. 다시 연결하세요.'):tr('저장된 연결을 읽지 못했습니다. 다시 연결하세요.')}</p>`:''}<div class="row">${btn(gptAccount.connecting?tr('인증 취소'):tr('연결 해제'),gptAccount.connecting?'gpt-auth-cancel':'gpt-disconnect')}${btn('Continue with ChatGPT','gpt-connect','primary')}</div>`;
  await loadThemeInfo();
  modal(tr('설정 · LLM 연결'),`${llmSection('gpt',tr('ChatGPT 계정'),accountDescription().replace(/<[^>]+>/g,''),gptBody)}${localLLM?llmSection('local',tr('로컬 모델'),localStatusText(localLLM),localSection(localLLM)):''}${llmSection('api',tr('API 연결'),apiSummary(connections.filter(c=>c.kind==='api')),apiSection(connections))}${llmSection('language',tr('언어'),languageSummary(),languageSection())}${llmSection('look',tr('모양'),appearanceSummary(),appearanceSection())}${llmSection('general',tr('알림·도움말'),generalSummary(),generalSection())}`,btn(tr('닫기'),'close'));
  dialog.classList.add('llm-dialog');let width=0;try{width=Number(localStorage.getItem('app-llm-dialog-width'));}catch{}if(width>=420)dialog.style.width=Math.min(width,innerWidth-40)+'px';
  if(!dialog.llmWatch){dialog.llmWatch=new ResizeObserver(()=>{if(dialog.classList.contains('llm-dialog')&&dialog.open)try{localStorage.setItem('app-llm-dialog-width',String(Math.round(dialog.getBoundingClientRect().width)));}catch{}});dialog.llmWatch.observe(dialog);dialog.addEventListener('close',()=>{dialog.classList.remove('llm-dialog');dialog.style.width='';});}
}
document.addEventListener('toggle',event=>{const section=event.target.closest?.('[data-llm-section]');if(!section||!llmOpenSections)return;if(section.open)llmOpenSections.add(section.dataset.llmSection);else llmOpenSections.delete(section.dataset.llmSection);},true);
document.addEventListener('change',event=>{if(event.target.id!=='provider-preset')return;const option=event.target.selectedOptions[0];document.querySelector('#provider-name').value=option.dataset.name||'';document.querySelector('#provider-url').value=option.dataset.url||'';(option.value?document.querySelector('#provider-key'):document.querySelector('#provider-name')).focus();});
actions['provider-add']=runDesktop(async()=>{
  const status=document.querySelector('#provider-status'),key=document.querySelector('#provider-key').value.trim();if(!key){document.querySelector('#provider-key').focus();return;}
  const provider={preset:document.querySelector('#provider-preset').value,name:document.querySelector('#provider-name').value,url:document.querySelector('#provider-url').value};
  status.textContent=tr('주소와 키를 확인하는 중…');
  try{await window.appApi.saveProvider(provider,key);toast(tr('{name}을(를) 연결했습니다. 번역·AI 창의 모델 목록에 나옵니다.',{name:provider.name.trim()}));await openGPTSettings();}
  catch(error){status.textContent=plainError(error);}
});
function localForm(){return {enabled:document.querySelector('#local-enabled').checked,kind:document.querySelector('#local-kind').value,url:document.querySelector('#local-url').value,numCtx:Number(document.querySelector('#local-ctx').value),think:document.querySelector('#local-think').checked};}
// Paper text goes to a server outside this computer only after the user agreed to it.
async function saveLocal(){
  if(!document.querySelector('#local-ctx').reportValidity())return;
  const form=localForm(),status=await window.appApi.saveLocalLLM(form,false);
  if(!status.needsConfirm){await localSaved(status);return;}
  pendingLocal=form;
  modal(tr('원격 서버로 전송'),`<p>${tr('로컬 모델 요청마다 자료 본문과 질문이 <strong>{host}</strong>로 전송됩니다. 이 컴퓨터 밖의 서버입니다.',{host:esc(status.host)})}${/^http:/i.test(form.url)?` ${tr('http 주소는 암호화되지 않아 같은 네트워크에서 내용을 볼 수 있습니다.')}`:''}</p><p>${tr('신뢰하는 서버일 때만 허용하세요.')}</p>`,btn(tr('취소'),'local-remote-cancel')+btn(tr('전송 허용'),'local-remote-confirm','primary'));
}
async function localSaved(status){localLLM=status;toast(status.enabled?tr('로컬 모델 설정을 저장했습니다.'):tr('로컬 모델 설정을 저장했습니다. 지금은 꺼져 있습니다.'));await openGPTSettings();}
function showGPTJobs(){const timing=translationTimings.get(currentJob?.id),seconds=ms=>ms==null?tr('측정 중'):tr('{n}초',{n:(ms/1000).toFixed(1)});modal(tr('번역 작업'),`<p>${esc(currentJob?.message||tr('실행 중인 번역이 없습니다.'))}</p>${timing?`<p>${tr('첫 번역 표시: {first}<br>전체 완료: {total}<br>캐시 재사용: {n}개 묶음',{first:seconds(timing.firstDisplayMs),total:seconds(timing.totalMs),n:currentJob.metrics?.cacheHits||0})}</p>`:''}`,btn(tr('닫기'),'close')+(currentJob?.state==='running'?btn(tr('번역 중단'),'gpt-stop'):''))}
async function connectGPT(){
  const pending=window.appApi.connectGPT();gptAccount.connecting=true;
  modal(tr('ChatGPT 인증 중'),`<p>${tr('시스템 브라우저에서 로그인과 앱 사용량 권한을 승인해 주세요. 완료되면 앱으로 돌아오세요.')}</p>`,btn(tr('인증 취소'),'gpt-auth-cancel'));
  try{gptAccount=await pending;if(!gptAccount.usable)throw Error(tr('로그인은 완료했지만 앱 사용량 권한이 없습니다. 다시 연결해 권한을 허용하세요.'));dialog.close();toast(tr('ChatGPT 연결 완료'));await loadGPTModels();if(state.screen==='reader'&&state.mode!=='original')await ensureTranslation();}
  catch(error){gptAccount=await window.appApi.authStatus();if(dialog.open)dialog.close();toast(plainError(error));}
}
async function loadGPTModels(){gptModels=await window.appApi.models();if(!gptModels.length)throw Error(tr('이 계정에서 사용할 수 있는 모델이 없습니다.'));try{localStorage.setItem('app-gpt-models',JSON.stringify({email:gptAccount.email||'',models:gptModels}));}catch{}}
// The model list last seen for this account (this run or an earlier one).
// The translation dialog shows it at once while a fresh list loads; starting
// is still checked against the fresh list by the main process.
function knownGPTModels(){
  try{const saved=JSON.parse(localStorage.getItem('app-gpt-models')||'null');if(saved?.email===(gptAccount.email||'')&&Array.isArray(saved.models))return saved.models.filter(m=>typeof m?.id==='string'&&typeof m.name==='string');}catch{}
  return [];
}
function preferredGPTModel(){return gptModels.find(m=>m.id===desktopPreferences.model)?.id||gptModels.find(m=>/mini|instant/i.test(m.id+' '+m.name))?.id||gptModels.find(m=>/nano|luna/i.test(m.id+' '+m.name))?.id||gptModels[0]?.id;}
// One model list for every connection that can be used now, grouped by
// connection. ChatGPT shows its saved list at once and refreshes it behind;
// a local server that does not answer says why instead of listing models.
let modelGroupsShown=[];
const modelListCache=new Map();
async function modelGroups({vision=false,onRefresh}={}){
  const connections=await window.appApi.llmConnections();gptAccount=connections.find(c=>c.id==='gpt-web')||gptAccount;
  return Promise.all(connections.filter(c=>c.usable).map(async c=>{
    try{
      if(c.id==='gpt-web'){const known=knownGPTModels(),fresh=loadGPTModels();if(known.length){gptModels=known;fresh.then(()=>onRefresh?.(),()=>{});}else await fresh;return {...c,models:gptModels};}
      // Other connections show the list seen last (this run) at once and refresh it behind, so a dialog
      // does not wait on a slow server each time it opens.
      const cached=modelListCache.get(c.id),fetch=()=>{const run=window.appApi.llmModels(c.id).then(list=>{modelListCache.set(c.id,{at:Date.now(),list});return list;});return run;};
      let list;if(cached){list=cached.list;if(Date.now()-cached.at>60000)fetch().then(()=>onRefresh?.(),()=>{});}else list=await fetch();
      return {...c,models:list.filter(m=>!vision||m.vision!==false)};
    }catch(error){return {...c,models:[],error:plainError(error)};}
  }));
}
// Opens the connection settings instead when no connection can be used.
async function readyModelGroups(options){
  const groups=await modelGroups(options);if(!groups.length){await openGPTSettings();return null;}
  if(!groups.some(g=>g.models.length))throw Error(groups.find(g=>g.error)?.error||tr('사용할 수 있는 모델이 없습니다.'));
  modelGroupsShown=groups;return groups;
}
// Two lists: the connection (ChatGPT web account, local model, each API provider) and that connection's models.
const connectionLabel=g=>g.id==='gpt-web'?tr('ChatGPT 웹 계정'):g.label;
const shownGroups=groups=>groups.filter(g=>g.models.length);
const groupFor=(groups,preferred)=>shownGroups(groups).find(g=>g.id===preferred?.connection)||shownGroups(groups)[0];
function modelOptions(groups,preferred){
  const group=groupFor(groups,preferred);if(!group)return '';
  const chosen=preferred?.connection===group.id&&group.models.some(m=>m.id===preferred.model)?preferred.model:rememberedModel(group);
  return group.models.map(m=>`<option value="${esc(m.id)}" data-connection="${esc(group.id)}" ${m.id===chosen?'selected':''}>${esc(m.name)}</option>`).join('');
}
function rememberedModel(group){const last=desktopPreferences.models?.[group.id]||(group.id==='gpt-web'?preferredGPTModel():'');return group.models.some(m=>m.id===last)?last:group.models[0]?.id;}
const connectionOptions=(groups,preferred)=>{const group=groupFor(groups,preferred);return shownGroups(groups).map(g=>`<option value="${esc(g.id)}" ${g===group?'selected':''}>${esc(connectionLabel(g))}</option>`).join('');};
const modelProblems=groups=>groups.filter(g=>g.error).map(g=>`<p class="small muted">${esc(g.label)}: ${esc(g.error)}</p>`).join('');
// 연결·모델 everywhere as in the memo AI: one small chip (model, then connection); a click lists every
// connection's models. The two lists stay, hidden, as the choice's source (chosenModel, change events);
// where the text goes is said in the list and the chip's tooltip.
function modelField(id,groups,preferred){const group=groupFor(groups,preferred),model=group&&(preferred?.connection===group.id&&group.models.some(m=>m.id===preferred.model)?preferred.model:rememberedModel(group)),name=group?.models.find(m=>m.id===model)?.name||tr('모델 선택');
  return `<div class="model-pair-fields" hidden><select id="${id}-connection" data-llm-connection="${id}" aria-label="${tr('연결',null,'connection')}">${connectionOptions(groups,preferred)}</select><select id="${id}" data-llm-select aria-label="${tr('모델')}">${modelOptions(groups,preferred)}</select></div>${modelProblems(groups)}<div class="model-chip-row"><button type="button" class="note-ai-chip" data-model-chip="${id}" aria-haspopup="menu" aria-expanded="false"><span class="note-ai-chip-model">${esc(name)}</span><span class="note-ai-chip-connection">${group?esc(connectionLabel(group)):''}</span>${typeof icon==='function'?icon('chipDown'):''}</button></div><p class="small muted model-chip-notice" id="${id}-notice" hidden></p>`;}
function chosenModel(id){const option=document.querySelector('#'+id)?.selectedOptions?.[0];return option?{connection:option.dataset.connection,model:option.value}:null;}
// Re-translation and resume name their model; otherwise the last one used, then the usual ChatGPT choice.
function preferredChoice(groups,named){
  const offered=c=>c&&groups.some(g=>g.id===c.connection&&g.models.some(m=>m.id===c.model));
  if(offered(named))return named;
  const connection=desktopPreferences.connection||'gpt-web',last={connection,model:desktopPreferences.models?.[connection]||(connection==='gpt-web'?desktopPreferences.model:'')};
  if(offered(last))return last;
  if(groups.some(g=>g.id==='gpt-web'&&g.models.length))return {connection:'gpt-web',model:preferredGPTModel()};
  const first=groups.find(g=>g.models.length);return first&&{connection:first.id,model:first.models[0].id};
}
function rememberChoice(choice){desktopPreferences.connection=choice.connection;desktopPreferences.models={...(desktopPreferences.models||{}),[choice.connection]:choice.model};if(choice.connection==='gpt-web')desktopPreferences.model=choice.model;}
const budgetOf=choice=>modelGroupsShown.find(g=>g.id===choice?.connection)?.inputBudget||120000;
// A Korean particle by the last syllable: 본문을/메모를, 본문이/메모가.
const josa=(word,withFinal,withoutFinal)=>{const c=word.charCodeAt(word.length-1);return word+(c>=0xac00&&c<=0xd7a3&&(c-0xac00)%28?withFinal:withoutFinal);};
// A Korean particle belongs to the Korean screen only: in English the word stands alone.
const withJosa=(word,withFinal,withoutFinal)=>appI18n.uiLanguage()==='ko'?josa(word,withFinal,withoutFinal):word;
// What is sent is the paper's text unless the dialog names something else (data-notice-what).
function modelNotice(choice,what=tr('자료 본문')){
  const g=modelGroupsShown.find(x=>x.id===choice?.connection);if(!g)return '';
  if(g.kind==='api')return `${tr('{object} {name}로 보냅니다. 사용한 만큼 키의 계정에 요금이 청구됩니다.',{object:withJosa(what,'을','를'),name:g.label})}${g.id==='gemini-api'?` ${tr('무료 등급 키는 입력 내용이 Google 서비스 개선에 쓰일 수 있습니다.')}`:''}`; // i18n:keep — Korean particles
  if(g.kind==='local')return g.remote?tr('{object} 원격 서버 {host}로 보냅니다. 이 컴퓨터 밖으로 전송됩니다.',{object:withJosa(what,'을','를'),host:hostOf(g.url)}):tr('이 PC의 로컬 모델로 처리합니다. {subject} 외부로 전송되지 않습니다.',{subject:withJosa(what,'이','가')}); // i18n:keep — Korean particles
  return gptAccount.email?tr('{object} ChatGPT({account})로 보냅니다. 계정의 사용량·한도가 적용됩니다.',{object:withJosa(what,'을','를'),account:gptAccount.email}):tr('{object} ChatGPT로 보냅니다. 계정의 사용량·한도가 적용됩니다.',{object:withJosa(what,'을','를')}); // i18n:keep — Korean particles
}
// The notice and the amount of text sent follow the chosen connection.
function showModelNotice(id){
  const choice=chosenModel(id),notice=document.querySelector('#'+id+'-notice');if(notice)notice.textContent=modelNotice(choice,notice.dataset?.noticeWhat||undefined)+aiRulesNotice(id);if(typeof modelChipUpdate==='function')modelChipUpdate(id);
  const budget=budgetOf(choice);
  document.querySelectorAll('[data-budget-summary]').forEach(el=>{const total=Number(el.dataset.budgetSummary);el.textContent=total>budget?` ${tr('중 앞부분 {chars}자까지',{n:budget,chars:budget.toLocaleString(appI18n.uiLocale())})}`:'';});
  document.querySelectorAll('[data-budget-compare]').forEach(el=>{el.textContent=Math.floor(budget/Number(el.dataset.budgetCompare)).toLocaleString();});
}
// A fresh list arriving after the dialog opened replaces its choices, keeping the chosen model when it is still offered.
function refreshModelChoice(id='gpt-model'){
  const select=document.querySelector('#'+id);if(!select)return;const chosen=chosenModel(id),group=modelGroupsShown.find(g=>g.id==='gpt-web');if(group)group.models=gptModels;
  const kept=chosen&&modelGroupsShown.some(g=>g.id===chosen.connection&&g.models.some(m=>m.id===chosen.model));
  const next=kept?chosen:preferredChoice(modelGroupsShown),connection=document.querySelector('#'+id+'-connection');if(connection)connection.innerHTML=connectionOptions(modelGroupsShown,next);select.innerHTML=modelOptions(modelGroupsShown,next);showModelNotice(id);
}
let translationOptions={},progressRecord=null;
// The 연결·모델 chip's list (see modelField).
function modelChipUpdate(id){
  const chip=document.querySelector(`[data-model-chip="${CSS.escape(id)}"]`);if(!chip)return;const option=document.querySelector('#'+id)?.selectedOptions?.[0],group=modelGroupsShown.find(g=>g.id===option?.dataset.connection);
  const name=option?.textContent||tr('모델 선택'),where=group?connectionLabel(group):'',notice=document.querySelector('#'+id+'-notice')?.textContent||'';
  chip.querySelector('.note-ai-chip-model').textContent=name;chip.querySelector('.note-ai-chip-connection').textContent=where;chip.title=`${where?where+' · ':''}${name} — ${tr('눌러서 바꾸기')}${notice?'\n'+notice:''}`;chip.setAttribute('aria-label',tr('연결 {where}, 모델 {name}. 눌러서 바꾸기',{where,name}));
}
let modelMenu=null;
function closeModelMenu(focus=false){if(!modelMenu)return;const {el,chip}=modelMenu;modelMenu=null;el.remove();chip.setAttribute('aria-expanded','false');if(focus)chip.focus();}
function openModelMenu(chip){
  closeModelMenu();const id=chip.dataset.modelChip,choice=chosenModel(id),notice=document.querySelector('#'+id+'-notice')?.textContent||'';
  const el=document.createElement('div');el.className='note-ai-menu';el.setAttribute('role','menu');el.setAttribute('aria-label',tr('연결과 모델'));
  el.innerHTML=shownGroups(modelGroupsShown).map(g=>`<div class="note-ai-menu-group" role="presentation">${esc(connectionLabel(g))}</div>${g.models.map(m=>{const on=choice?.connection===g.id&&choice?.model===m.id;return `<button type="button" role="menuitemradio" aria-checked="${on}" class="${on?'active':''}" data-model-pick="${esc(g.id)}" data-model="${esc(m.id)}"><span>${esc(m.name)}</span>${on?'<span class="note-ai-menu-check" aria-hidden="true">✓</span>':''}</button>`;}).join('')}`).join('')+modelProblems(modelGroupsShown)+(notice?`<p class="note-ai-menu-notice">${esc(notice)}</p>`:'');
  // In the dialog (the top layer) when the chip is in one; fixed above the chip, below it when there is no room.
  (chip.closest('dialog')||document.body).append(el);modelMenu={el,chip,id,at:chip.getBoundingClientRect()};chip.setAttribute('aria-expanded','true');
  const box=chip.getBoundingClientRect(),size=el.getBoundingClientRect(),up=box.top-size.height-6>=8,left=Math.max(8,Math.min(box.right-size.width,innerWidth-size.width-8)),top=up?box.top-size.height-6:Math.min(box.bottom+6,innerHeight-size.height-8);
  el.style.left=left+'px';el.style.top=top+'px';const placed=el.getBoundingClientRect();el.style.left=(2*left-placed.left)+'px';el.style.top=(2*top-placed.top)+'px';
  (el.querySelector('[aria-checked="true"]')||el.querySelector('button'))?.focus({preventScroll:true});
}
document.addEventListener('click',event=>{
  const chip=event.target.closest?.('[data-model-chip]');if(chip){event.preventDefault();if(modelMenu?.chip===chip)closeModelMenu();else openModelMenu(chip);return;}
  const pick=event.target.closest?.('[data-model-pick]');
  if(pick&&modelMenu){const {id}=modelMenu,connection=pick.dataset.modelPick,model=pick.dataset.model,list=document.querySelector('#'+id+'-connection'),select=document.querySelector('#'+id);
    if(list)list.innerHTML=connectionOptions(modelGroupsShown,{connection,model});if(select){select.innerHTML=modelOptions(modelGroupsShown,{connection,model});select.dispatchEvent(new Event('change',{bubbles:true}));}
    closeModelMenu(true);showModelNotice(id);return;}
  if(modelMenu&&!modelMenu.el.contains(event.target))closeModelMenu();
},true);
document.addEventListener('keydown',event=>{if(!modelMenu)return;
  if(event.key==='Escape'){event.preventDefault();event.stopPropagation();closeModelMenu(true);return;}
  if(['ArrowDown','ArrowUp'].includes(event.key)&&modelMenu.el.contains(event.target)){event.preventDefault();const items=[...modelMenu.el.querySelectorAll('button')],at=items.indexOf(event.target);items[(at+(event.key==='ArrowDown'?1:items.length-1))%items.length]?.focus();}
  if(event.key==='Tab')closeModelMenu();},true);
// A scroll closes the list only when it moves the chip (the list stays where it opened).
document.addEventListener('scroll',event=>{if(!modelMenu||modelMenu.el.contains(event.target))return;const box=modelMenu.chip.getBoundingClientRect(),at=modelMenu.at;if(!at||Math.abs(box.top-at.top)>1||Math.abs(box.left-at.left)>1)closeModelMenu();},true);
// Another connection shows its own models, starting with the one used last with it.
document.addEventListener('change',event=>{const select=event.target.closest?.('[data-llm-connection]');if(!select)return;const id=select.dataset.llmConnection,models=document.querySelector('#'+id);if(!models)return;models.innerHTML=modelOptions(modelGroupsShown,{connection:select.value});showModelNotice(id);});
const translationTimings=new Map(),translationPages=new Map();
let preparingTranslation=false;
// The translation window as last asked for (force, options), so it can be opened again just so: a resumed translation
// keeps its finished chunks.
let translationRequest=null;
async function ensureTranslation(force=false,options={}){
  if(typeof viewOnly!=='undefined'&&viewOnly){if(force)toast(tr('이 창은 보기 전용입니다. 번역은 본 창에서 하세요.'));return;}
  if(preparingTranslation)return;
  const key=targetKey();
  if((!force&&translationRecord?.key===key&&!translationRecord.resume)||currentJob?.key===key&&['running','extracting'].includes(currentJob.state)||startingTranslation)return;
  if(currentJob&&['running','extracting'].includes(currentJob.state)&&currentJob.key!==key){showGPTJobs();return;}
  preparingTranslation=true;translationRequest={force,options};
  modal(tr('번역'),`<p id="translation-preparing" role="status">${tr('번역 설정을 준비하고 있습니다…')}</p>`,btn(tr('취소'),'close'));
  const marker=document.querySelector('#translation-preparing');
  const active=()=>dialog.open&&marker.isConnected&&key===targetKey();
  try{await prepareTranslation(force,options,active);}
  finally{preparingTranslation=false;if(marker.isConnected&&dialog.open)dialog.close();}
}
// Under an English screen on a system with no language a translation can be in, the first translation asks for the
// result language (DEVELOPMENT.md 언어 설정); starting keeps the answer in the settings and later translations do not ask. Only Korean
// can be chosen for now. A Korean screen, or a language already known, shows nothing here.
function translationLanguageField(){
  const info=window.appApi.readLanguage?.()||window.appApi.language;if(!info?.translationAsk)return '';
  return `<div class="field"><label for="translation-language">${tr('번역 결과 언어')}</label><select id="translation-language" required><option value="">${tr('언어를 고르세요')}</option>${(info.choices?.translation||[]).map(c=>`<option value="${esc(c.code)}" lang="${esc(c.code)}">${esc(c.name)}</option>`).join('')}</select><p class="small muted">${tr('한 번 고르면 기억하며, 설정에서 바꿀 수 있습니다.')} ${tr('다른 언어는 준비 중입니다.')}</p></div>`;
}
async function prepareTranslation(force,options,active){
  const key=targetKey();
  const [cached,resume]=await Promise.all([window.appApi.cachedTranslation(state.storageKey,state.selected,state.selectedAttachment),window.appApi.resumableTranslation(state.storageKey,state.selected,state.selectedAttachment)]);if(!active())return;if(resume&&(!force||options.resume)){force=true;options={...options,resume:true,resumeInfo:resume};}
  if(cached&&!force){translationRecord={...cached,key};fullPdfs.get(state.selected).translated={generated:true};render();return;}
  // The paper is read and structured from here on, while the account, the
  // model list and the dialog wait; 번역 시작 then joins that work.
  const opening=(async()=>{const engine=await pdfEngine(),opened=await engine.documentFor(state.storageKey,state.selected,true,state.selectedAttachment);engine.structuredPages(opened.pdf,opened.hash).catch(()=>{});return opened;})();opening.catch(()=>{});
  const groups=await readyModelGroups({onRefresh:()=>refreshModelChoice('gpt-model')});if(!groups||!active())return;
  const document=await opening;if(!active())return;
  const first=Math.max(1,Math.min(document.pdf.numPages,options.firstPage||options.pageNumbers?.[0]||options.pageNumber||translationPages.get(key)||1));
  translationOptions={force:force&&!options.resume,pageNumbers:options.pageNumbers?.length?[...options.pageNumbers]:options.pageNumber?[options.pageNumber]:options.resume?(options.resumeInfo?.pageNumbers||currentJob?.pageNumbers):undefined};
  const resumed=options.resume&&(options.resumeInfo?.model||currentJob?.model)?{connection:options.resumeInfo?.connection||currentJob?.connection||'gpt-web',model:options.resumeInfo?.model||currentJob.model}:null;
  // A page re-translation starts from the model that translated that page; any other may be chosen.
  const pageModel=options.pageNumber&&cached?cached.pages?.[options.pageNumber-1]?.translatedBy||{connection:cached.connection||'gpt-web',model:cached.model}:null;
  const pageGroup=pageModel&&groups.find(g=>g.id===pageModel.connection),pageModelName=pageModel&&`${pageGroup?.label||pageModel.connection} · ${pageGroup?.models.find(m=>m.id===pageModel.model)?.name||pageModel.model}`;
  const preferred=preferredChoice(groups,resumed||pageModel);
  modal(options.pageNumbers?.length?tr('{n}개 페이지 다시 번역',{n:options.pageNumbers.length}):options.pageNumber?tr('{page}페이지 다시 번역',{page:options.pageNumber}):tr('번역'),`${translationLanguageField()}<p>${options.pageNumbers?.length?tr('{pages}쪽만 다시 번역합니다. 다른 쪽의 번역은 그대로 둡니다.',{pages:esc(options.pageNumbers.join(', '))}):tr('본문을 한국어로 번역합니다. 완료된 페이지부터 읽을 수 있습니다.')}</p>${pageModel?`<p class="small muted">${tr('지금 이 페이지는 {model}(으)로 번역돼 있습니다. 다른 모델을 고르면 이 페이지만 그 모델로 바뀝니다.',{model:esc(pageModelName)})}</p>`:''}${translationRulesField()}${modelField('gpt-model',groups,preferred)}<p class="small muted">${tr('요청 사항은 저장하지 않으며 번역이 끝나면 사라집니다. 모든 번역에 적용할 요청은 저장소 관리에 적으세요. 참고 이미지는 요청마다 함께 보내므로 이미지를 볼 수 있는 모델에서만 쓰이고 사용량이 늘어납니다.')}</p>${!options.pageNumber&&!options.pageNumbers?.length?`<div class="field"><label for="translation-first-page">${tr('먼저 번역할 페이지')}</label><input id="translation-first-page" type="number" min="1" max="${document.pdf.numPages}" value="${first}"></div>`:''}<p class="small muted">${options.resume?tr('완료된 청크는 재사용하고 실패·미완료 부분을 이어서 번역합니다.'):tr('빠른 번역에는 경량 모델을 권장합니다. 페이지 재번역은 다른 연결·모델을 골라도 됩니다.')}</p>`,btn(tr('취소'),'close')+btn(tr('번역 시작'),'gpt-start','primary'));
  showModelNotice('gpt-model');
}
// Translation requests: the vault's (저장소 관리, kept and applied to every translation) are shown here
// read-only; this window takes requests for this translation only, which are sent with it and never saved.
let vaultRules='';
// The vault's AI requests (저장소 관리 › AI): sent with the AI answers that take them (the fields below), never with
// translation or tag suggestions; their model notice says so while there are some.
let vaultAiRules='';
const AI_RULE_FIELDS=new Set(['ai-model','figure-model','editor-ai-model']);
const aiRulesNotice=id=>AI_RULE_FIELDS.has(id)&&vaultAiRules?` ${tr('저장소의 AI 요청 사항도 함께 보냅니다.')}`:'';
// Reference images for this translation only (a glossary, style examples): pasted or added in the
// translation window, sent beside each request to a model that can see images, never saved.
let translationImages=[];
const TRANSLATION_IMAGE_MAX=3;
function translationImagesHtml(){return translationImages.map((image,i)=>`<figure class="rules-image"><img src="${image.dataUrl}" alt="${tr('참고 이미지 {n}',{n:i+1})}"><button type="button" class="row-more" data-rules-image-remove="${i}" title="${tr('빼기')}" aria-label="${tr('참고 이미지 {n} 빼기',{n:i+1})}">×</button></figure>`).join('');}
function refreshTranslationImages(){const list=document.querySelector('.rules-image-list');if(list)list.innerHTML=translationImagesHtml();const add=document.querySelector('[data-rules-image-add]');if(add)add.disabled=translationImages.length>=TRANSLATION_IMAGE_MAX;const count=document.querySelector('.rules-image-count');if(count)count.textContent=translationImages.length?` · ${tr('이미지 {n}장',{n:translationImages.length})}`:'';}
async function addTranslationImages(files){
  for(const file of files){
    if(translationImages.length>=TRANSLATION_IMAGE_MAX){toast(tr('참고 이미지는 {n}장까지 넣을 수 있습니다.',{n:TRANSLATION_IMAGE_MAX}));break;}
    if(!file?.type?.startsWith('image/'))continue;const png=await pngOf(file);if(png)translationImages.push(png);
  }
  refreshTranslationImages();
}
function translationRulesField(){
  translationImages=[];
  const kept=vaultRules?`<div class="rules-kept"><span class="pill">${tr('저장소 요청 사항 적용 중')}</span><p>${esc(vaultRules.length>160?vaultRules.slice(0,160)+'…':vaultRules)}</p><button type="button" class="secondary small" data-action="vault-manager-rules">${tr('저장소 관리에서 고치기')}</button></div>`:'';
  // The requests as in the memo AI's question box: pictures on top, the text, + to attach (or paste) pictures.
  return `<div class="translation-rules"><div class="translation-rules-head"><strong>${tr('이번 번역 요청 사항')}</strong> <span class="small muted">${tr('(선택 · 이번 번역에만)')}</span></div>${kept}<div class="note-ai-composer"><div class="memo-ai-image-list rules-image-list"></div><textarea id="translation-rules" rows="2" maxlength="2000" aria-label="${tr('이번 번역 요청 사항')}" placeholder="${tr("예: 이 논문은 '~다' 체로 · 표 제목은 원문 유지 · 그림에 표시한 부분은 번역하지 않기")}"></textarea><div class="note-ai-composer-bar"><button type="button" class="composer-icon" data-rules-image-add title="${tr('참고 이미지 첨부 — 용어집, 문체 예시, 번역하지 않을 부분 표시 (붙여 넣어도 됩니다, 최대 {n}장)',{n:TRANSLATION_IMAGE_MAX})}" aria-label="${tr('참고 이미지 첨부')}">${typeof icon==='function'?icon('plus'):'+'}</button><input type="file" id="translation-images" accept="image/*" multiple hidden></div></div></div>`;
}
// Only the saved value is taken from the result; the rest of the page (and an open translation window) stays as it is.
async function saveRulesFrom(field){const text=field?.value.trim()??vaultRules;if(text===vaultRules)return;vaultRules=(await window.appApi.translationRulesSave(state.storageKey,text)).translationRules||'';}
// The translation window again, as it was asked for (the same force and options, the first page chosen in it), when the
// result language turned out to be still unknown.
function askTranslationLanguageAgain(firstPage){const request=translationRequest||{force:true,options:{}};return runDesktop(()=>ensureTranslation(request.force,{...request.options,...(firstPage?{firstPage}:{})}))();}
async function startGPTTranslation(){
  const extraRules=document.querySelector('#translation-rules')?.value.trim()||'',extraImages=translationImages.map(image=>image.dataUrl);
  const choice=chosenModel('gpt-model'),model=choice?.model;if(!model||startingTranslation)return;
  const firstInput=document.querySelector('#translation-first-page');if(firstInput&&!firstInput.reportValidity())return;
  // The result language asked for in this window (translationLanguageField) is kept before the translation starts.
  const asked=document.querySelector('#translation-language');
  if(asked){if(!asked.reportValidity())return;startingTranslation=true;try{await window.appApi.setLanguage({translation:asked.value});}catch(error){toast(plainError(error));return;}finally{startingTranslation=false;}
    if(!dialog.open||!asked.isConnected)return;} // this window closed (Esc, 취소) or replaced by another while the choice was being kept: the choice stays, nothing starts
  const first=translationOptions.pageNumbers?.[0]||Number(firstInput?.value||1),options={...translationOptions};
  // The language still to be asked (set back to "the screen's" in another window since this one opened): before the
  // paper is read, this window opens again with the question rather than failing after the reading.
  if(!asked&&window.appApi.readLanguage?.()?.translationAsk){dialog.close();askTranslationLanguageAgain(first);return;}
  const id=state.storageKey,paperId=state.selected,attachmentId=state.selectedAttachment,key=targetKey(),title=selected().title,startedAt=performance.now();startingTranslation=true;extractionCancelled=false;dialog.close();progressRecord=null;
  let jobId,askAgain=false;
  try{
    currentJob={key,state:'extracting',retranslating:translationRecord?.key===key,message:tr('PDF 페이지를 분석합니다.')};refreshTranslationPane();
    const engine=await pdfEngine(),{pdf,hash}=await engine.documentFor(id,paperId,true,attachmentId);
    if(extractionCancelled)throw Error(tr('번역을 중단했습니다.'));
    if(pdf.numPages>500)throw Error(tr('1~500페이지 PDF만 번역할 수 있습니다.'));
    const order=options.pageNumbers||[...Array.from({length:pdf.numPages-first+1},(_,i)=>first+i),...Array.from({length:first-1},(_,i)=>i+1)];
    // Usually already read while the dialog was open; stopping does not wait for the rest.
    const structured=await Promise.race([
      engine.structuredPages(pdf,hash,(done,total)=>{if(currentJob?.key!==key||currentJob.state!=='extracting')return;currentJob.message=tr('제목·문단 구조를 분석합니다. {done}/{total}페이지',{done,total});refreshTranslationPane();}),
      new Promise((_,reject)=>{stopExtraction=()=>reject(Error(tr('번역을 중단했습니다.')));})
    ]);
    const job=await window.appApi.startTranslation(id,paperId,hash,[],model,{...options,...(extraRules?{extraRules}:{}),...(extraImages.length?{extraImages}:{}),connection:choice.connection,attachmentId,incremental:true,totalPages:pdf.numPages});jobId=job.id;rememberChoice(choice);
    currentJob={...job,key,retranslating:currentJob.retranslating};translationTarget={id,paperId,key,first};translationTimings.set(job.id,{startedAt,firstDisplayMs:null});refreshTranslationPane();pollGPTTranslation();
    for(const number of order){
      if(extractionCancelled)throw Error(tr('번역을 중단했습니다.'));
      const value=structured[number-1];
      if(extractionCancelled)throw Error(tr('번역을 중단했습니다.'));
      // A page read by OCR goes with its picture, so the model reads what OCR got wrong (math, Greek letters).
      const image=value?.ocr?await engine.ocrPageImage(pdf,number).catch(()=>null):null;
      await window.appApi.appendTranslation(job.id,number,image?{...value,image}:value,{title});
    }
    await window.appApi.sealTranslation(job.id);
  }catch(error){
    // Refused by the main process for want of a translation language: not a failed translation, the question again.
    if(errorCode(error)==='APP_TRANSLATION_LANGUAGE'&&!jobId){currentJob=null;refreshTranslationPane();askAgain=true;}
    else{if(jobId)await window.appApi.cancelTranslation(jobId);clearTimeout(translationTimer);currentJob={...currentJob,key,state:extractionCancelled?'cancelled':'failed',message:plainError(error)};refreshTranslationPane();toast(plainError(error));}}
  finally{startingTranslation=false;stopExtraction=()=>{};}
  if(askAgain)askTranslationLanguageAgain(first);
}
// The translation window's reference images: added by the button or the file list, or pasted.
document.addEventListener('click',event=>{
  if(event.target.closest('[data-rules-image-add]')){document.querySelector('#translation-images')?.click();return;}
  const remove=event.target.closest('[data-rules-image-remove]');if(remove){translationImages.splice(Number(remove.dataset.rulesImageRemove),1);refreshTranslationImages();}
});
document.addEventListener('change',event=>{if(event.target.id!=='translation-images')return;const files=[...event.target.files];event.target.value='';runDesktop(()=>addTranslationImages(files))();});
// A picture pasted anywhere in the translation window's requests becomes a reference image.
document.addEventListener('paste',event=>{if(!event.target.closest?.('.translation-rules'))return;const files=[...(event.clipboardData?.items||[])].filter(i=>i.kind==='file'&&i.type.startsWith('image/')).map(i=>i.getAsFile()).filter(Boolean);if(!files.length)return;event.preventDefault();runDesktop(()=>addTranslationImages(files))();});
async function pollGPTTranslation(){
  clearTimeout(translationTimer);if(!currentJob?.id||currentJob.state!=='running')return;
  const id=currentJob.id,key=currentJob.key;
  try{
    const job=await window.appApi.translationJob(id,currentJob.revisionSeen??-1);if(currentJob?.id!==id)return;
    // The pane (and the quality counts under it) is rebuilt only when the job moved on.
    const before=currentJob,changed=Boolean(job.record)||job.revision!==before.revisionSeen||job.state!==before.state||job.message!==before.message||job.done!==before.done;
    currentJob={...job,key,revisionSeen:job.revision,retranslating:currentJob.retranslating};
    if(job.record){const pages=job.record.pages||progressRecord?.pages||Array(job.totalPages).fill(null);for(const update of job.record.updates||[])pages[update.index]=update.page;progressRecord={...job.record,pages,key,startPage:translationTarget.first};if(job.state==='completed'){translationRecord={...progressRecord,partial:false};progressRecord=null;}}
    if(changed&&targetKey()===key&&state.screen==='reader')refreshTranslationPane();
    // Asked more often until the first translated page is on screen.
    if(job.state==='running')translationTimer=setTimeout(pollGPTTranslation,progressRecord?.pages.some(Boolean)?250:100);else if(job.state==='completed'){translationTimings.get(id).totalMs=performance.now()-translationTimings.get(id).startedAt;const paper=state.storageKey===translationTarget?.id&&papers.find(p=>p.id===translationTarget.paperId);if(paper)paper.hasTranslation=true;toast(tr('번역을 완료했습니다.'));}else {const timing=translationTimings.get(id);if(timing)timing.totalMs=performance.now()-timing.startedAt;toast(job.message);}
  }catch(error){if(currentJob?.id!==id)return;currentJob={...currentJob,state:'failed',message:plainError(error)};refreshTranslationPane();toast(plainError(error));}
}
async function saveGPTPdf(options={}){
  const record=options.record||translationRecord;
  if(record?.key!==targetKey()||currentJob?.key===targetKey()&&currentJob.state==='running')return;
  const id=state.storageKey,paperId=state.selected,attachmentId=state.selectedAttachment,key=targetKey();toast(tr('번역 PDF를 준비합니다.'));const exportMode='layout',images=exportMode==='reading'?[]:await(await pdfEngine()).exportImages(id,paperId,attachmentId);
  if(key!==targetKey())throw Error(tr('선택한 자료가 변경됐습니다. 저장할 번역을 다시 선택하세요.'));
  const plan=await(await pdfEngine()).exportLayout(document.querySelector('.translated-pane .translated-pages'),record,id,paperId,attachmentId,images);
  const result=await window.appApi.exportTranslation(id,paperId,images,attachmentId,exportMode,plan,{includeInk:options.includeInk===true,revision:options.revision,allowMissing:options.allowMissing===true});
  if(result)toast((result.addedPages?tr('번역 PDF를 저장했습니다. 원문으로 둔 문단의 번역은 맨 끝 {n}쪽에 모았습니다.',{n:result.addedPages}):tr('현재 레이아웃으로 번역 PDF를 저장했습니다.'))+(result.inkStrokes?` ${tr('필기 {n}개를 포함했습니다.',{n:result.inkStrokes})}`:'')+(result.keptSource?` ${tr('미번역 문단 {n}개는 원문으로 두고 끝에 목록을 넣었습니다.',{n:result.keptSource})}`:''));
}
// 새 창 in every pane header (원문, 번역, 노트북): the memo's new-window icon right after the file name.
function paneWindowButton(kind,label,attr=`data-view-window="${kind}"`){return `<button type="button" class="pdf-tool pane-window" ${attr} title="${tr('{label} 새 창에서 보기',{label})}" aria-label="${tr('{label} 새 창에서 보기',{label})}">${icon('newWindow')}</button>`;}
function translationTool(action,label,symbol,attributes=''){return `<button type="button" class="pdf-tool" data-action="${action}" aria-label="${label}" title="${label}" ${attributes}>${icon(symbol)}<span class="pdf-tool-label">${label}</span></button>`}
function refreshTranslationPane(){
  if(state.screen!=='reader')return;
  const original=document.querySelector('.original-pages');
  if(original)pdfLayoutObserver.observe(original);
  if(original&&!original.dataset.started){original.dataset.started='true';pdfEngine().then(engine=>engine.paintOriginal(original,state.storageKey,state.selected,state.selectedAttachment)).then(()=>{fitTranslatedPages();bindPairedScroll(original);}).catch(error=>{original.textContent=shownError(error);});}
  document.querySelectorAll('.pdf-pane').forEach(node=>{
    if(!node.dataset.translationPane&&node.querySelector('header strong')?.textContent!==tr('번역 PDF'))return;
    node.dataset.translationPane='true';
    const key=targetKey(),job=currentJob?.key===key?currentJob:null,busy=job&&['running','extracting'].includes(job.state);
    const record=(!busy&&globalThis.appInk?.baseRecord(key))||(progressRecord?.key===key?progressRecord:!busy&&translationRecord?.key===key?translationRecord:null);
    const visible=record?.pages.some(Boolean),failed=job&&['failed','cancelled'].includes(job.state);
    let header=node.querySelector('header');if(!header){header=document.createElement('header');node.prepend(header);}
    header.classList.add('pdf-pane-header');
    const sourceName=activeAttachment()?.name||'';
    header.innerHTML=`<strong>${tr('번역 PDF')}</strong><span class="pdf-pane-filename" title="${esc(sourceName)}">${esc(sourceName)}</span>${visible&&!busy&&!failed?paneWindowButton('translation',tr('번역')):''}`; // while a job runs or failed, its status needs the room
    let tools=node.querySelector(':scope>.pdf-pane-tools');if(!tools){tools=document.createElement('div');tools.className='pdf-pane-tools';tools.setAttribute('role','toolbar');tools.setAttribute('aria-label',tr('번역 도구'));header.after(tools);}
    tools.innerHTML=`${state.mode==='dual'?pairedTools():visible?pageNav():''}${visible?translationTool('toggle-translation-reading',state.readingTranslation===true?tr('원문 배치'):tr('섹션 보기'),'book',`aria-pressed="${state.readingTranslation===true}"`):''}${busy?translationTool('gpt-stop',tr('번역 중단'),'stop'):failed?translationTool('gpt-retry',tr('실패 부분 재시도'),'refresh'):record&&!record.partial?`${record.resume?translationTool('gpt-retry',tr('이어서 번역'),'refresh'):''}${translationTool('gpt-retranslate',tr('다시 번역'),'refresh')}${translationTool('gpt-export',tr('PDF 저장'),'download')}`:''}`;
    updatePageNav();
    let status=node.querySelector('.translation-status');if(!status){status=document.createElement('div');status.className='translation-status';header.append(status);}
    {const win=header.querySelector('.pane-window');if(win)header.append(win);} // 새 창 stays at the right end, as in the original pane
    status.innerHTML=busy?`<strong>${job.retranslating?tr('다시 번역 중'):tr('한국어로 번역 중')}</strong><span class="translation-state" role="status" aria-live="polite">${esc(job.message)}</span>`:failed?`<span class="translation-state" role="status">${esc(job.message)}</span>`:'';
    header.querySelector('.pdf-pane-filename').hidden=Boolean(busy||failed);status.title=busy||failed?job.message:'';
    let container=node.querySelector('.translated-pages');
    if(visible){node.querySelector('.pdf-empty')?.remove();if(!container){container=document.createElement('div');container.className='translated-pages';node.append(container);pdfLayoutObserver.observe(container);}
      const stamp=key+':'+(job?.id||'cached')+':'+(job?.revision||record.createdAt||'');
      // The source layout view is the default; the section view is opt-in.
      container.classList.toggle('reading-translation',state.readingTranslation===true);if(container.dataset.revision!==stamp){container.dataset.revision=stamp;const target=container;pdfEngine().then(engine=>engine.paint(target,record,state.storageKey,state.selected,page=>{if(translationPages.get(key)!==page){translationPages.set(key,page);if(job?.state==='running')window.appApi.prioritizeTranslation(job.id,page).catch(()=>{});}},page=>{if(job?.pageNumbers&&!job.pageNumbers.includes(page))return;const timing=translationTimings.get(job?.id);if(timing&&timing.firstDisplayMs===null)timing.firstDisplayMs=performance.now()-timing.startedAt;},state.selectedAttachment)).then(fitTranslatedPages).catch(error=>{if(target.isConnected)target.textContent=shownError(error);});}
      pdfLayoutObserver.observe(container);bindPairedScroll(container);
      container.querySelectorAll('[data-retranslate-page]').forEach(button=>button.disabled=Boolean(busy));
    }else{container?.observer?.disconnect();if(container)pdfLayoutObserver.unobserve(container);container?.remove();let empty=node.querySelector('.pdf-empty');if(!empty){empty=document.createElement('div');empty.className='pdf-empty';node.append(empty);}empty.innerHTML=`<h3>${busy?(job.retranslating?tr('다시 번역 중'):tr('한국어로 번역 중')):failed?tr('번역을 이어서 진행할 수 있습니다'):tr('앱에서 번역하세요')}</h3>${!busy&&!failed?`<button class="primary" data-action="gpt-prepare">${tr('번역 시작')}</button>`:''}`;}
  });
  if(state.mode!=='original'&&translationRecord?.key!==targetKey()&&!readingRecord&&!(currentJob?.key===targetKey())){const key=targetKey();readingRecord=true;window.appApi.cachedTranslation(state.storageKey,state.selected,state.selectedAttachment).then(record=>{if(record&&key===targetKey()&&!(currentJob?.key===key)){translationRecord={...record,key};render();}}).catch(error=>toast(shownError(error))).finally(()=>{readingRecord=false;});}
}
document.addEventListener('click',event=>{
  const button=event.target.closest('[data-api-action]');if(!button)return;
  const id=button.dataset.api,action=button.dataset.apiAction;
  runDesktop(async()=>{
    if(action==='page'){await window.appApi.openApiKeyPage(id);return;}
    if(action==='remove'){await window.appApi.removeApiKey(id);toast(tr('API 키를 삭제했습니다.'));await openGPTSettings();return;}
    if(action==='remove-provider'){await window.appApi.removeProvider(id);toast(tr('공급자와 키를 삭제했습니다.'));await openGPTSettings();return;}
    const input=document.querySelector('#api-key-'+id),status=document.querySelector('#api-status-'+id),key=input.value.trim();if(!key){input.focus();return;}
    button.disabled=true;status.textContent=tr('키를 확인하는 중…');
    try{await window.appApi.saveApiKey(id,key);input.value='';toast(tr('API 키를 확인하고 저장했습니다.'));await openGPTSettings();}
    catch(error){status.textContent=plainError(error);button.disabled=false;}
  })();
});
document.addEventListener('change',event=>{
  if(event.target.matches?.('[data-llm-select]'))showModelNotice(event.target.id);
  // Switching the server type moves an untouched default address along with it.
  if(event.target.id==='local-kind'){const url=document.querySelector('#local-url');if(Object.values(LOCAL_URLS).includes(url.value.trim()))url.value=LOCAL_URLS[event.target.value];document.querySelector('#local-hint').textContent=localHint(event.target.value);document.querySelector('#local-think').disabled=event.target.value==='openai';}
});
Object.assign(actions,{
  'gpt-connect':runDesktop(connectGPT),
  'local-save':runDesktop(saveLocal),
  'local-remote-confirm':runDesktop(async()=>{const form=pendingLocal;pendingLocal=null;if(form)await localSaved(await window.appApi.saveLocalLLM(form,true));}),
  'local-remote-cancel':runDesktop(async()=>{pendingLocal=null;await openGPTSettings();}),
  'local-check':runDesktop(async()=>{
    const status=document.querySelector('#local-status');status.textContent=tr('확인 중…');
    try{const r=await window.appApi.checkLocalLLM(localForm());status.textContent=`${tr('응답함')}${r.version?' · Ollama '+r.version:''} · ${tr('모델 {n}개',{n:r.models})}${r.models?'':` · ${tr('터미널에서 ollama pull <모델>로 내려받으세요.')}`}`;}
    catch(error){status.textContent=plainError(error);}
  }),
  'gpt-auth-cancel':runDesktop(async()=>{await window.appApi.cancelGPT();dialog.close();}),
  'gpt-disconnect':runDesktop(async()=>{const status=await window.appApi.disconnectGPT();gptModels=[];try{localStorage.removeItem('app-gpt-models');}catch{}gptAccount=status;dialog.close();toast(status.revoked?tr('ChatGPT 연결을 해제했습니다.'):tr('이 기기의 연결을 해제했습니다. 원격 해제는 ChatGPT 설정에서 확인하세요.'));}),
  'gpt-prepare':runDesktop(()=>ensureTranslation()),
  'gpt-retry':runDesktop(()=>ensureTranslation(true,{resume:true})),
  'gpt-retranslate':runDesktop(()=>ensureTranslation(true)),
  'gpt-start':runDesktop(startGPTTranslation),
  'gpt-stop':runDesktop(async()=>{extractionCancelled=true;stopExtraction();if(currentJob?.id)await window.appApi.cancelTranslation(currentJob.id);}),
  'gpt-export':runDesktop(saveGPTPdf)
});
// The page under the top edge and how far into it, so a full render() (view
// mode switch, saved annotation) returns to the same place instead of the top.
function readingPosition(){
 const c=document.querySelector('.original-pages')||document.querySelector('.translated-pages'),s=c&&currentSheet(c);
 if(!s)return null;
 return {page:s.dataset.page,ratio:Math.max(0,(c.scrollTop-pageTop(c,s))/Math.max(1,s.getBoundingClientRect().height))};
}
// Pages arrive asynchronously, and the PDF viewer's first fit to the width puts back the place it
// last knew (the top), so every pane is kept at the place until it has stayed there for three checks
// (a pane still without the page stops holding it up after a second). One restore runs at a time.
// The user's own scrolling (wheel, a press on the reader, a key outside text fields) ends it at once,
// so a pane is never pulled back from under them; pressing a view button does not.
let readingRestore=null;
const readingKey=()=>`${state.storageKey}:${state.selected}:${state.selectedAttachment||''}`;
function readingInput(event){
 if(!readingRestore)return;
 if(event.type==='pointerdown'&&event.target.closest?.('[data-mode]'))return;
 if(event.type==='keydown'&&event.target.closest?.('input,textarea,select,[contenteditable="true"]'))return;
 readingRestore.touched=true;
}
for(const type of ['wheel','pointerdown','keydown'])window.addEventListener(type,readingInput,true);
function restoreReadingPosition(pos){if(!pos)return;readingRestore={pos,key:readingKey(),stable:0,tries:30,touched:false};readingStep(readingRestore);}
function readingStep(run){
 if(readingRestore!==run)return;
 if(run.touched||run.key!==readingKey()){readingRestore=null;return;}
 const containers=[...document.querySelectorAll('.translated-pages')];let settled=containers.length>0;
 for(const c of containers){
  const s=c.querySelector(`[data-page="${run.pos.page}"]`),h=s?.getBoundingClientRect().height;if(!h){if(run.tries>20)settled=false;continue;}
  const target=Math.min(pageTop(c,s)+run.pos.ratio*h,c.scrollHeight-c.clientHeight);
  if(Math.abs(c.scrollTop-target)>2){scrollPairedTo(c,target);settled=false;}
 }
 run.stable=settled?run.stable+1:0;run.tries--;
 if(run.stable<3&&run.tries>0)setTimeout(()=>readingStep(run),100);else readingRestore=null;
}
// Window capture runs before every mode handler (notebook.js listens there too). Only the user's own
// switch keeps the place: a mode chosen by code (restoring the last view) goes where that code says.
// A switch made while the last one is still settling goes to the same place, not to the top of the
// half-built view.
window.addEventListener('click',event=>{
 const button=event.target.closest('[data-mode]');if(!event.isTrusted||!button||button.dataset.mode===state.mode)return;
 const pending=readingRestore&&!readingRestore.touched&&readingRestore.key===readingKey()?readingRestore.pos:null;
 const pos=pending||readingPosition();if(pos)setTimeout(()=>restoreReadingPosition(pos),0);
},true);
// 새 창에서 보기: a blank window of this page's origin that this page fills and keeps
// (main.cjs allows only app-view-* names and gives it no preload). Reopening the same view
// brings its window forward.
const viewWindows=new Map();
// One window per view of one vault: a short name made from its parts.
function viewWindowName(kind,...parts){let h=0;for(const c of parts.join('\n'))h=Math.imul(h,31)+c.codePointAt(0)|0;return `${kind}-${(h>>>0).toString(36)}`;}
// Brings a node into view by scrolling only the boxes made to scroll around it (overflow auto or scroll). scrollIntoView
// also scrolls the reader's clipped boxes when the box that scrolls cannot go far enough, pushing the whole reader up.
function scrollWithin(node,{block='nearest',inline='nearest'}={}){
  if(!node)return;const view=node.ownerDocument.defaultView;
  const scrolls=(e,y)=>/auto|scroll/.test(view.getComputedStyle(e)[y?'overflowY':'overflowX'])&&(y?e.scrollHeight>e.clientHeight:e.scrollWidth>e.clientWidth);
  for(const [y,how] of [[true,block],[false,inline]]){
    let box=node.parentElement;while(box&&!scrolls(box,y))box=box.parentElement;if(!box)continue;
    const n=node.getBoundingClientRect(),b=box.getBoundingClientRect(),[lo,hi,a,z]=y?[n.top,n.bottom,b.top,b.top+box.clientHeight]:[n.left,n.right,b.left,b.left+box.clientWidth];
    const d=how==='start'?lo-a:how==='center'?(lo+hi-a-z)/2:lo<a?lo-a:hi>z?Math.min(hi-z,lo-a):0;
    if(y)box.scrollTop+=d;else box.scrollLeft+=d;
  }
}
// The reader's frame never scrolls (its boxes clip what overflows): if something scrolled one anyway (a focus, a
// scrollIntoView), it goes back at once, so no empty band is left under the panes.
document.addEventListener('scroll',event=>{const box=event.target;if(box instanceof Element&&box.matches('.main, .reader-layout, .pdf-pane')&&(box.scrollTop||box.scrollLeft)){box.scrollTop=0;box.scrollLeft=0;}},true);
function openViewWindow(name,title,fill){
  const existing=viewWindows.get(name);if(existing&&!existing.closed){existing.focus();return existing;}
  const child=window.open('about:blank','app-view-'+name);if(!child){toast(tr('새 창을 열 수 없습니다.'));return null;}
  viewWindows.set(name,child);const doc=child.document;
  doc.open();doc.write(`<!doctype html><html lang="ko" data-theme="${esc(document.documentElement.dataset.theme||'')}"><head><meta charset="utf-8"><title>${esc(title)}</title>${[...document.querySelectorAll('link[rel="stylesheet"],style')].map(n=>n.tagName==='LINK'?`<link rel="stylesheet" href="${esc(n.href)}">`:n.outerHTML).join('')}<style>html,body{height:100%;margin:0}body{background:var(--bg,#fff);color:var(--text,#111);overflow:auto}.view-window{display:flex;flex-direction:column;height:100%}.view-window>header{display:flex;align-items:center;gap:8px;padding:8px 14px;border-bottom:1px solid var(--line,#ddd);background:var(--surface,#fff);position:sticky;top:0;z-index:2}.view-window>header strong{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.view-window>main{flex:1;min-height:0;overflow:auto;padding:12px}</style></head><body><div class="view-window"><header><strong></strong></header><main></main></div></body></html>`);doc.close();
  for(const a of document.documentElement.attributes)if(a.name.startsWith('data-')||a.name==='style')doc.documentElement.setAttribute(a.name,a.value);
  doc.body.className=document.body.className;doc.querySelector('header strong').textContent=title;
  fill(child,doc.querySelector('main'),doc.querySelector('header'));return child;
}
// The original PDF in a window of its own: the app's reader with the original pane alone, at the
// page being read (main.cjs view-window). It reads only; marks are made in the main window.
function openOriginalWindow(){
  const paper=selected(),file=fullPdfs.get(paper?.id)?.original;if(!file){toast(tr('열 수 있는 원문 PDF가 없습니다.'));return;}
  const page=document.querySelector('.original-pages')?.pdfViewer?.currentPageNumber||1;
  runDesktop(()=>window.appApi.viewWindow(state.storageKey,paper.id,state.selectedAttachment||null,page))();
}
// The page of that window (index.html?viewWindow=original): the vault as the main window holds
// it, this paper's reader in 원문 view, and nothing around the pane.
const viewOnly=['original','translation'].includes(new URLSearchParams(location.search).get('viewWindow'));
async function originalViewWindow(params){
  document.body.classList.add('view-window');
  state.storageKey=params.get('vault');applySnapshot(await window.appApi.windowSnapshot(state.storageKey));
  const paperId=Number(params.get('paper')),paper=papers.find(p=>p.id===paperId);
  if(!paper){app.innerHTML=`<main class="main"><p class="pdf-empty">${tr('자료를 찾을 수 없습니다.')}</p></main>`;return;}
  state.selected=paperId;if(params.get('attachment'))state.selectedAttachment=params.get('attachment');
  const translation=params.get('viewWindow')==='translation',page=Number(params.get('page'))||1;
  state.screen='reader';state.mode=translation?'translated':'original';state.leftCollapsed=true;state.rightCollapsed=true;document.title=`${translation?tr('번역'):tr('원문')} · ${paper.title}`;
  if(translation){
    // The stored translation as it is; a translation still running shows once it is stored and the window is opened again.
    const cached=await window.appApi.cachedTranslation(state.storageKey,state.selected,state.selectedAttachment);
    if(!cached){app.innerHTML=`<main class="main"><p class="pdf-empty">${tr('저장된 번역이 없습니다. 본 창에서 번역한 뒤 다시 여세요.')}</p></main>`;return;}
    translationRecord={...cached,key:targetKey()};fullPdfs.get(state.selected).translated={generated:true};translationPages.set(targetKey(),page);
  }
  render();
  const container=document.querySelector('.original-pages');if(container&&page>1)container.restorePage=page;
  // The translated pane goes to the page once its pages are laid out.
  // (Asked again until it has held for three seconds: the pane is fitted again as its first pages are drawn, and starts over at the top.)
  let moved=false;for(const type of ['wheel','keydown','pointerdown'])window.addEventListener(type,()=>{moved=true;},{once:true,capture:true,passive:true}); // the reader's own move ends it
  if(translation&&page>1)for(let i=0,held=0;i<200&&held<30&&!moved;i++){const pane=document.querySelector('.translated-pane .translated-pages');if(pane?.querySelector(`[data-page="${page}"]`)&&pageCount(pane)>=page){if(Number(currentSheet(pane)?.dataset.page)===page)held++;else{held=0;goToPage(page);}}await new Promise(resolve=>setTimeout(resolve,100));}
}
// The translation in a window of its own: the app's reader with the translated pane alone, at
// the page being read. It shows the stored translation and only reads, like the original's window.
function openTranslationWindow(){
  const paper=selected();if(!paper||translationRecord?.key!==targetKey()||!document.querySelector('.translated-pane .translated-pages')){toast(tr('먼저 번역 화면을 여세요.'));return;}
  const container=document.querySelector('.translated-pane .translated-pages'),page=Number(currentSheet(container)?.dataset.page)||container.pdfViewer?.currentPageNumber||1;
  runDesktop(()=>window.appApi.viewWindow(state.storageKey,paper.id,state.selectedAttachment||null,page,'translation'))();
}
document.addEventListener('click',event=>{const b=event.target.closest('[data-view-window]');if(!b)return;event.preventDefault();event.stopPropagation();(b.dataset.viewWindow==='original'?openOriginalWindow:openTranslationWindow)();},true);
// Capture first, so translation mode can start authentication/translation in the same action.
document.addEventListener('click',event=>{
  const button=event.target.closest('[data-mode]');if(!button||button.dataset.mode==='original')return;
  event.stopImmediatePropagation();state.mode=button.dataset.mode;render();runDesktop(ensureTranslation)();
},true);

let readerZoom=1;
const pairedScrollTargets=new WeakMap();
function scrollPairedTo(container,top){
 if(!Number.isFinite(top))return;
 container.scrollTop=top;
 // Scroll events may arrive after the next animation frame. Remember the
 // actual (clamped) destination until its event, not a one-frame global lock.
 pairedScrollTargets.set(container,container.scrollTop);
}
function pairedTools(){return `<button class="pdf-tool" data-reader-zoom="-.1" aria-label="${tr('축소')}">−</button><button class="pdf-tool" data-reader-zoom=".1" aria-label="${tr('확대')}">+</button><button class="pdf-tool" data-reader-fit>${tr('너비 맞춤')}</button>`+pageNav();}
// Current page and page count of the pane, with a box to type a page.
function pageNav(){return `<span class="pdf-page-nav"><button class="pdf-tool" data-reader-step="-1" aria-label="${tr('이전 페이지')}">‹</button><input class="pdf-page-input" inputmode="numeric" aria-label="${tr('현재 쪽 번호')}" value="1"><span class="pdf-page-total">${tr('의 {total}',{total:'–'})}</span><button class="pdf-tool" data-reader-step="1" aria-label="${tr('다음 페이지')}">›</button></span>`;}
function currentSheet(container){const top=container.getBoundingClientRect().top;return [...container.querySelectorAll('[data-page]')].find(s=>s.getBoundingClientRect().bottom>top+2);}
function pageCount(container){return container.pdfViewer?.pagesCount||Math.max(0,...[...container.querySelectorAll('[data-page]')].map(n=>Number(n.dataset.page)||0));}
function updatePageNav(){
 for(const nav of document.querySelectorAll('.pdf-page-nav')){
  const container=nav.closest('.pdf-pane')?.querySelector('.translated-pages'),input=nav.querySelector('.pdf-page-input'),total=container?pageCount(container):0;
  nav.querySelector('.pdf-page-total').textContent=tr('의 {total}',{total:total||'–'});
  if(container&&document.activeElement!==input)input.value=currentSheet(container)?.dataset.page||(total?'1':'');
 }
}
// Every pane goes to the same page (the panes of the dual view move together).
function goToPage(page){
 // Going to a page (the page box, a page reference) ends a view switch's return to the last place.
 readingRestore=null;
 const containers=[...document.querySelectorAll('.translated-pages')],primary=containers.find(c=>c.classList.contains('original-pages'))||containers[0];if(!primary)return;
 page=Math.max(1,Math.min(pageCount(primary)||1,Math.round(page)||1));
 for(const c of containers){const sheet=c.querySelector(`[data-page="${page}"]`);if(sheet)scrollPairedTo(c,pageTop(c,sheet));}
}
let pageNavQueued=false;
document.addEventListener('scroll',event=>{if(!event.target.classList?.contains('translated-pages')||pageNavQueued)return;pageNavQueued=true;requestAnimationFrame(()=>{pageNavQueued=false;updatePageNav();});},true);
document.addEventListener('app-pagerendered',()=>updatePageNav());
document.addEventListener('keydown',event=>{const input=event.target.closest?.('.pdf-page-input');if(!input||event.key!=='Enter')return;event.preventDefault();goToPage(Number(input.value));input.blur();setTimeout(updatePageNav,0);});
document.addEventListener('focusout',event=>{if(event.target.classList?.contains('pdf-page-input'))setTimeout(updatePageNav,0);});
function pageTop(container,sheet){return sheet.getBoundingClientRect().top-container.getBoundingClientRect().top+container.scrollTop;}
function bindPairedScroll(container){
 if(container.dataset.paired)return;container.dataset.paired='true';
 // Measured once per frame however many scroll events arrive: each pass
 // reads the layout of every page (and paragraph in section view).
 let queued=false;
 container.addEventListener('scroll',()=>{if(queued)return;queued=true;requestAnimationFrame(()=>{queued=false;pairedScroll(container);});});
}
function pairedScroll(container){
  const expected=pairedScrollTargets.get(container);pairedScrollTargets.delete(container);
  if(expected!==undefined&&Math.abs(container.scrollTop-expected)<1)return;
  if(state.mode!=='dual')return;
  const other=document.querySelector(container.classList.contains('original-pages')?'.translated-pane .translated-pages':'.original-pages');if(!other)return;
  const top=container.getBoundingClientRect().top,sheets=[...container.querySelectorAll('[data-page]')],sheet=sheets.find(s=>s.getBoundingClientRect().bottom>top+2);if(!sheet)return;
  const target=[...other.querySelectorAll('[data-page]')].find(s=>s.dataset.page===sheet.dataset.page);if(!target)return;
  // Match the source page first. In flowing text, use the nearest paragraph's
  // source y coordinate rather than a ratio across the entire document.
  const translated=container.classList.contains('original-pages')?target:sheet;
  const source=container.classList.contains('original-pages')?sheet:target;
  let local=container.scrollTop-pageTop(container,sheet),destination;
  // In the gap above a page (local below zero) the other pane keeps the same distance from its page,
  // so the two do not jump apart by the gap's height while scrolling through it.
  if(local<2)destination=pageTop(other,target)+Math.min(0,local);
  else if(translated.closest('.reading-translation')){
   const all=[...translated.querySelectorAll('.section-paragraph')].filter(b=>b.dataset.kind!=='heading');
   const blocks=container.classList.contains('original-pages')?all.filter(b=>b.closest('.translation-section')?.dataset.role!=='metadata'):all;
   if(container.classList.contains('original-pages')){
    const y=local/source.getBoundingClientRect().height*parseFloat(source.style.height);
    const block=blocks.filter(b=>Number(b.dataset.sourceY)<=y).sort((a,b)=>Number(b.dataset.sourceY)-Number(a.dataset.sourceY))[0];
    const progress=block?Math.max(0,Math.min(1,(y-Number(block.dataset.sourceY))/Math.max(1,Number(block.dataset.sourceHeight)))):0;
    destination=block?block.getBoundingClientRect().top-other.getBoundingClientRect().top+other.scrollTop+progress*block.getBoundingClientRect().height:pageTop(other,target);
   }else{
    const block=blocks.find(b=>b.getBoundingClientRect().bottom>top+2);
    const progress=block?Math.max(0,Math.min(1,(top-block.getBoundingClientRect().top)/Math.max(1,block.getBoundingClientRect().height))):0;
    destination=pageTop(other,target)+(block?(Number(block.dataset.sourceY)+progress*Number(block.dataset.sourceHeight))/parseFloat(source.style.height)*source.getBoundingClientRect().height:Math.min(1,local/sheet.getBoundingClientRect().height)*source.getBoundingClientRect().height);
   }
  }else destination=pageTop(other,target)+local/sheet.getBoundingClientRect().height*target.getBoundingClientRect().height;
  scrollPairedTo(other,destination);
}
document.addEventListener('click',event=>{
 const step=event.target.closest('[data-reader-step]'),zoom=event.target.closest('[data-reader-zoom]'),fit=event.target.closest('[data-reader-fit]');
 if(step){const containers=[...document.querySelectorAll('.translated-pages')],primary=containers.find(c=>c.classList.contains('original-pages'))||containers[0];if(!primary)return;goToPage(Number(currentSheet(primary)?.dataset.page||1)+Number(step.dataset.readerStep));}
 if(zoom||fit){readerZoom=fit?1:Math.max(.5,Math.min(2,readerZoom+Number(zoom.dataset.readerZoom)));fitTranslatedPages();}
});
// Reader wheel: Ctrl (or Cmd, or a trackpad pinch) zooms the pages around the
// pointer within the zoom buttons' range; Shift, with or without Ctrl,
// scrolls sideways. Several wheel events in one frame are fitted once.
let wheelZoom=null;
document.addEventListener('wheel',event=>{
 if(state.screen!=='reader')return;const pane=event.target.closest?.('.translated-pages');if(!pane)return;
 if(event.shiftKey){event.preventDefault();pane.scrollLeft+=event.deltaX||event.deltaY;return;}
 if(!event.ctrlKey&&!event.metaKey)return;event.preventDefault();
 const next=Math.max(.5,Math.min(2,readerZoom*Math.exp(-event.deltaY*(event.deltaMode===1?.05:.002))));if(next===readerZoom)return;
 const box=pane.getBoundingClientRect(),x=event.clientX-box.left,y=event.clientY-box.top;
 wheelZoom||={pane,x,y,fx:(pane.scrollLeft+x)/pane.scrollWidth,fy:(pane.scrollTop+y)/pane.scrollHeight};readerZoom=next;
 if(wheelZoom.queued)return;wheelZoom.queued=true;
 requestAnimationFrame(()=>{const at=wheelZoom;wheelZoom=null;fitTranslatedPages();requestAnimationFrame(()=>{if(!at.pane.isConnected)return;at.pane.scrollLeft=at.fx*at.pane.scrollWidth-at.x;at.pane.scrollTop=at.fy*at.pane.scrollHeight-at.y;});});
},{passive:false});
// onlyChanged (after any click): skip a pane whose width, zoom and page count are as last fitted,
// instead of restyling every page view on each click.
function fitTranslatedPages(onlyChanged=false){for(const container of document.querySelectorAll('.translated-pages')){const style=getComputedStyle(container),width=container.clientWidth-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight),fitKey=[width,readerZoom,container.childElementCount,container.pdfController?.pagesCount,container.classList.contains('reading-translation')].join('|');if(onlyChanged===true&&container.fitKey===fitKey)continue;container.fitKey=fitKey;if(container.pdfController){container.pdfController.fit(readerZoom);continue;}if(container.classList.contains('reading-translation')){container.style.setProperty('--section-font-size',16*readerZoom+'px');container.style.setProperty('--section-scale',String(readerZoom));const last=container.lastElementChild;if(last)container.style.setProperty('--page-end-space',Math.max(0,container.clientHeight-last.getBoundingClientRect().height)+'px');continue;}for(const sheet of container.querySelectorAll('.translated-sheet,.pdf-source-sheet'))sheet.style.zoom=Math.max(.01,width/parseFloat(sheet.style.width))*(readerZoom||1);const last=container.lastElementChild;if(last)container.style.setProperty('--page-end-space',Math.max(0,container.clientHeight-last.getBoundingClientRect().height)+'px');}}
const pdfLayoutObserver=new ResizeObserver(fitTranslatedPages);
const originalSetSplit=setSplit;setSplit=value=>{originalSetSplit(value);fitTranslatedPages()};
window.addEventListener('resize',fitTranslatedPages);
document.addEventListener('click',()=>requestAnimationFrame(()=>fitTranslatedPages(true)));

persistTags=async(paper,tags,libraryId)=>{await window.appApi.updatePaper(libraryId,paper.id,{tags});paper.tags=tags;indexPaperSearch(paper);if(state.storageKey!==libraryId)return;const nav=document.querySelector('#navigation-panel');if(nav){const focused=nav.contains(document.activeElement);keepSidebarScroll(()=>{nav.outerHTML=sidebar();});if(focused)document.querySelector('[data-sidebar-toggle="left"]')?.focus()}};

document.addEventListener('click',event=>{const button=event.target.closest('[data-retranslate-pages]');if(button&&!button.disabled){const pageNumbers=button.dataset.retranslatePages.split(',').map(Number).filter(n=>Number.isInteger(n)&&n>0);if(pageNumbers.length)runDesktop(()=>ensureTranslation(true,{pageNumbers}))();}});
document.addEventListener('click',event=>{const button=event.target.closest('[data-retranslate-page]');if(button&&!button.disabled)runDesktop(()=>ensureTranslation(true,{pageNumber:Number(button.dataset.retranslatePage)}))();});

document.addEventListener('click',event=>{
  const toggle=event.target.closest('[data-folder-toggle]');if(toggle){const folder=toggle.dataset.folderToggle;if(expandedFolders.has(folder))expandedFolders.delete(folder);else expandedFolders.add(folder);refreshVaultSidebar();document.querySelectorAll('[data-folder-toggle]').forEach(button=>{if(button.dataset.folderToggle===folder)button.focus()});return;}
  const folder=event.target.closest('[data-folder-select]');if(folder){selectVaultFolder(folder.dataset.folderSelect);return;}
  const file=event.target.closest('[data-tree-file]');if(file)runDesktop(()=>openItemFile(Number(file.dataset.treeFile),file.dataset.attachmentId))();
});
document.addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.isComposing&&event.target.id==='folder-name'){event.preventDefault();actions['create-folder']();}});

Object.assign(actions,{'edit-bibliography':editBibliography,'save-bibliography':runDesktop(saveBibliography),'attach-pdf':chooseAttachmentRole,'choose-attachment':runDesktop(attachPDF),'new-annotation':runDesktop(newAnnotation),'save-annotation':runDesktop(()=>saveAnnotation(false)),'save-annotation-ask':runDesktop(()=>saveAnnotation(true)),duplicates:runDesktop(showDuplicates),'merge-all-duplicates':confirmMergeAll,'confirm-merge-all':runDesktop(mergeAllDuplicates),'merge-item':()=>modal(tr('기존 자료 항목 선택'),`<select id="merge-source">${papers.filter(p=>p.id!==state.selected).map(p=>`<option value="${p.id}">${esc(p.title)}</option>`).join('')}</select>`,btn(tr('취소'),'close')+btn(tr('병합 검토'),'review-item-merge','primary')),'review-item-merge':()=>reviewMerge([state.selected,Number(document.querySelector('#merge-source').value)]),'confirm-merge':runDesktop(mergeItems)});
document.addEventListener('click',event=>{
 const open=event.target.closest('[data-open-attachment]');if(open)runDesktop(()=>openItemFile(Number(open.dataset.paperId),open.dataset.openAttachment))();
 const primary=event.target.closest('[data-set-primary]');if(primary)runDesktop(async()=>{await desktopNotes();applyItemSnapshot(await window.appApi.setPrimary(state.storageKey,Number(primary.dataset.paperId),primary.dataset.setPrimary));})();
 const collection=event.target.closest('[data-item-collection]');if(collection){state.collection=collection.dataset.itemCollection;state.folder=null;state.desktopTag=null;state.nav=itemCollections.find(c=>c.id===state.collection).name;state.savedSearch=null;state.screen='library';state.query='';state.filter='전체';render();} // i18n:keep — filter value
 const merge=event.target.closest('[data-merge-candidate]');if(merge)reviewMerge(merge.dataset.mergeCandidate.split(',').map(Number));
 if(event.target.closest('[data-tab="주석"]'))runDesktop(loadAnnotationHash)(); // i18n:keep — tab value
});
document.addEventListener('change',event=>{if(event.target.id==='attachment-select')runDesktop(()=>openItemFile(state.selected,event.target.value))();});

document.addEventListener('submit',event=>{if(event.target.id==='bibliography-form'){event.preventDefault();actions['save-bibliography']();}});

document.addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.isComposing&&event.target.matches('#bibliography-form input')){event.preventDefault();actions['save-bibliography']();}});

let fileMoveTarget=null,annotationEditId=null,collectionEditId=null;
let vaultNotebookTrash=[],notebookPurgeTarget=null;
async function showVaultManager(){
  if(!state.storageKey)return;await desktopNotes();vaultBackups=await window.appApi.backups(state.storageKey);vaultNotebookTrash=await window.appApi.notebookTrash(state.storageKey).catch(()=>[]);
  modal(tr('저장소 관리'),`<div class="row" data-vault-manager><button class="secondary small" data-action="import-ris">${tr('RIS 가져오기')}</button><button class="secondary small" data-action="export-ris">${tr('RIS 내보내기')}</button><button class="secondary small" data-action="export-bib">${tr('BibTeX 내보내기')}</button></div><div class="row"><button class="secondary" data-action="create-backup">${tr('지금 백업')}</button></div><h3 data-vm-kind="backup">${tr('메타데이터 백업')}</h3><p class="small muted" data-vm-kind="backup">${tr('서지정보·메모·주석·첨부 경로를 복원합니다. 최근 20개는 모두, 그 이전은 2주 동안 하루 하나씩, 이후 8주 동안 한 주 하나씩 보관합니다. PDF와 번역 캐시는 별도로 보관하세요. 복원하면 백업 이후 편집 내용이 바뀝니다.')}</p><div class="manager-list" data-vm-kind="backup">${vaultBackups.map(b=>`<div class="manager-row"><span>${esc(b.label)} · ${esc(new Date(b.createdAt).toLocaleString(appI18n.uiLocale()))} · ${tr('{n}개',{n:b.papers})}</span><button class="secondary small" data-restore-backup="${esc(b.id)}">${tr('복원')}</button></div>`).join('')||`<p>${tr('백업이 없습니다.')}</p>`}</div><h3 data-vm-kind="trash">${tr('휴지통')}</h3><div class="manager-list" data-vm-kind="trash">${vaultTrash.map(p=>`<div class="manager-row"><span>${esc(p.title)}</span><button class="secondary small" data-restore-paper="${p.id}">${tr('되살리기')}</button><button class="secondary small danger" data-delete-paper="${p.id}" data-from-trash>${tr('삭제')}</button></div>`).join('')||`<p>${tr('휴지통이 비어 있습니다.')}</p>`}</div><h3 data-vm-kind="trash">${tr('제거한 첨부')}</h3><div class="manager-list" data-vm-kind="trash">${vaultTrashAttachments.map(a=>`<div class="manager-row"><span>${esc(a.paperTitle)} · ${esc(a.name)}</span><button class="secondary small" data-restore-attachment="${esc(a.id)}" data-paper-id="${a.paperId}">${tr('되살리기')}</button><button class="secondary small danger" data-delete-attachment="${esc(a.id)}" data-paper-id="${a.paperId}" data-from-trash>${tr('삭제')}</button></div>`).join('')||`<p>${tr('제거한 첨부가 없습니다.')}</p>`}</div><h3 data-vm-kind="trash">${tr('노트북')}</h3><div class="manager-list" data-vm-kind="trash" data-nb-trash>${vaultNotebookTrash.map(n=>`<div class="manager-row"><span>${esc(n.title)} · ${esc(n.paperId===null?tr('프로젝트'):(papers.find(p=>p.id===n.paperId)||vaultTrash.find(p=>p.id===n.paperId))?.title||tr('지운 자료'))} · ${esc(new Date(n.trashedAt).toLocaleString(appI18n.uiLocale()))}</span><button class="secondary small" data-restore-notebook="${esc(n.id)}">${tr('되살리기')}</button><button class="secondary small danger" data-purge-notebook="${esc(n.id)}">${tr('완전히 삭제…')}</button></div>`).join('')||`<p>${tr('휴지통에 노트북이 없습니다.')}</p>`}</div><h3 data-vm-kind="collections">${tr('컬렉션')}</h3><div class="manager-list" data-vm-kind="collections">${itemCollections.map(c=>`<div class="manager-row"><span>${esc(c.name)}</span><button class="secondary small" data-edit-collection="${esc(c.id)}">${tr('편집')}</button><button class="secondary small" data-delete-collection="${esc(c.id)}">${tr('삭제')}</button></div>`).join('')||`<p>${tr('컬렉션이 없습니다.')}</p>`}</div>`,btn(tr('닫기'),'close'));
}
function moveAttachmentDialog(paperId,attachmentId){
 const paper=papers.find(p=>p.id===paperId),attachment=paper.attachments.find(a=>a.id===attachmentId);fileMoveTarget={paperId,attachmentId};
 modal(tr('파일 이동·이름 변경'),`<div class="field"><label for="move-folder">${tr('폴더')}</label><select id="move-folder">${['',...vaultFolders].map(folder=>`<option value="${esc(folder)}" ${folder===attachment.folder?'selected':''}>${esc(folder||state.name)}</option>`).join('')}</select></div><div class="field"><label for="move-name">${tr('파일 이름')}</label><input id="move-name" value="${esc(attachment.fileName)}" maxlength="200"></div>`,btn(tr('취소'),'close')+btn(tr('저장'),'save-file-move','primary'));
}
async function refreshManaged(snapshot){applyItemSnapshot(snapshot,{screen:'library'});await showVaultManager();}
Object.assign(actions,{
 'vault-manager':runDesktop(showVaultManager),
 'create-backup':runDesktop(async()=>{await desktopNotes();await window.appApi.backup(state.storageKey);await showVaultManager();}),
 'save-file-move':runDesktop(async()=>{const target=fileMoveTarget,folder=document.querySelector('#move-folder').value,name=document.querySelector('#move-name').value;await desktopNotes();applyItemSnapshot(await window.appApi.moveAttachment(state.storageKey,target.paperId,target.attachmentId,folder,name));}),
 'confirm-backup-restore':runDesktop(async()=>{const vaultId=state.storageKey,id=document.querySelector('[data-backup-id]').dataset.backupId;await desktopNotes();const snapshot=await window.appApi.restoreBackup(vaultId,id);translationRecord=null;progressRecord=null;currentJob=null;await(await pdfEngine()).clearDocuments();await refreshManaged(snapshot);}),
 'confirm-paper-trash':runDesktop(async()=>{const id=Number(document.querySelector('[data-trash-id]').dataset.trashId);await desktopNotes();applyItemSnapshot(await window.appApi.trashPaper(state.storageKey,id),{screen:'library'});}),
 'save-annotation-edit':runDesktop(async()=>{const body=document.querySelector('#annotation-edit');if(!body.reportValidity())return;await desktopNotes();const snapshot=await window.appApi.editAnnotation(state.storageKey,annotationEditId,{body:body.value}),pos=readingPosition();setTimeout(()=>restoreReadingPosition(pos),0);applyItemSnapshot(snapshot);}),
 'save-collection-edit':runDesktop(async()=>{const name=document.querySelector('#collection-edit').value;await desktopNotes();await refreshManaged(await window.appApi.editCollection(state.storageKey,collectionEditId,name));}),
 'confirm-annotation-delete':runDesktop(async()=>{await desktopNotes();const snapshot=await window.appApi.editAnnotation(state.storageKey,annotationEditId,null),pos=readingPosition();setTimeout(()=>restoreReadingPosition(pos),0);applyItemSnapshot(snapshot);}),
 'confirm-collection-delete':runDesktop(async()=>{await desktopNotes();await refreshManaged(await window.appApi.editCollection(state.storageKey,collectionEditId,null));})
});
document.addEventListener('click',event=>{
 const move=event.target.closest('[data-move-attachment]');if(move)moveAttachmentDialog(Number(move.dataset.paperId),move.dataset.moveAttachment);
 const relink=event.target.closest('[data-relink-attachment]');if(relink)runDesktop(async()=>{await desktopNotes();const snapshot=await window.appApi.relinkAttachment(state.storageKey,Number(relink.dataset.paperId),relink.dataset.relinkAttachment);if(snapshot){await(await pdfEngine()).clearDocuments();applyItemSnapshot(snapshot);}})();
 const restore=event.target.closest('[data-restore-backup]');if(restore)modal(tr('백업 복원'),`<p data-backup-id="${esc(restore.dataset.restoreBackup)}">${tr('선택한 백업으로 서지정보·메모·주석을 되돌립니다. 현재 상태도 복원 직전 백업으로 보관합니다. PDF 파일은 변경하지 않습니다.')}</p>`,btn(tr('취소'),'vault-manager')+btn(tr('복원'),'confirm-backup-restore','primary'));
 const trash=event.target.closest('[data-trash-paper]');if(trash)modal(tr('휴지통으로 이동'),`<p data-trash-id="${trash.dataset.trashPaper}">${tr('자료를 라이브러리에서 숨깁니다. 첨부파일과 기록은 유지하며 저장소 관리에서 되살릴 수 있습니다.')}</p>`,btn(tr('취소'),'close')+btn(tr('휴지통으로 이동'),'confirm-paper-trash','primary'));
 const recover=event.target.closest('[data-restore-paper]');if(recover)runDesktop(async()=>{await desktopNotes();await refreshManaged(await window.appApi.trashPaper(state.storageKey,Number(recover.dataset.restorePaper),true));})();
 const edit=typeof openAnnotationEditor==='function'?null:event.target.closest('[data-edit-annotation]');if(edit){annotationEditId=edit.dataset.editAnnotation;const annotation=itemAnnotations.find(a=>a.id===annotationEditId);modal(tr('주석 편집'),`<textarea id="annotation-edit" required maxlength="20000">${esc(annotation.body)}</textarea>`,btn(tr('취소'),'close')+btn(tr('저장'),'save-annotation-edit','primary'));}
 const remove=event.target.closest('[data-delete-annotation]');if(remove){annotationEditId=remove.dataset.deleteAnnotation;modal(tr('주석 삭제'),`<p>${tr('이 주석을 삭제할까요? 자동 백업에서 이전 기록을 확인할 수 있습니다.')}</p>`,btn(tr('취소'),'close')+btn(tr('삭제'),'confirm-annotation-delete','primary'));}
 const page=event.target.closest('[data-annotation-page]');if(page){const file=activeAttachment()?.file,iframe=document.querySelector('.pdf-pane iframe');if(file&&iframe)iframe.src=file.url+'#page='+Number(page.dataset.annotationPage)+'&view=FitH';}
 const collection=event.target.closest('[data-edit-collection]');if(collection){collectionEditId=collection.dataset.editCollection;modal(tr('컬렉션 편집'),`<input id="collection-edit" maxlength="100" value="${esc(itemCollections.find(c=>c.id===collectionEditId).name)}">`,btn(tr('취소'),'vault-manager')+btn(tr('저장'),'save-collection-edit','primary'));}
 const deleteCollection=event.target.closest('[data-delete-collection]');if(deleteCollection){collectionEditId=deleteCollection.dataset.deleteCollection;modal(tr('컬렉션 삭제'),`<p>${tr('컬렉션을 삭제합니다. 자료와 첨부파일은 유지됩니다.')}</p>`,btn(tr('취소'),'vault-manager')+btn(tr('삭제'),'confirm-collection-delete','primary'));}
});

Object.assign(actions,{'toggle-translation-reading':()=>{state.readingTranslation=state.readingTranslation!==true;const pane=document.querySelector('.translated-pane .translated-pages');pane?.observer?.disconnect();if(pane)pdfLayoutObserver.unobserve(pane);pane?.remove();refreshTranslationPane();}});
document.addEventListener('click',event=>{const row=event.target.closest('[data-paper]');if(row&&!event.target.closest('[data-star]')){const paper=papers.find(p=>p.id===Number(row.dataset.paper));if(paper&&!paper.attachments.some(a=>a.file)){event.stopImmediatePropagation();state.selected=paper.id;document.querySelectorAll('.paper-item').forEach(item=>item.classList.toggle('selected',Number(item.dataset.paper)===paper.id));document.querySelector('.detail').outerHTML=details();}}},true);

Object.assign(actions,{
 'lookup-doi':runDesktop(async()=>{const form=document.querySelector('#bibliography-form'),input=form.querySelector('#bib-doi'),status=form.querySelector('#doi-status');status.textContent=tr('Crossref에서 DOI 서지정보 조회 중…');try{const metadata=await window.appApi.lookupDOI(input.value);if(!form.isConnected)return;for(const [key,value]of Object.entries(metadata))if(value)form.querySelector('#bib-'+key).value=value;status.textContent=tr('조회 내용을 확인한 뒤 저장하세요.');}catch(error){if(status.isConnected)status.textContent=shownError(error);}}),
 'extract-doi':runDesktop(async()=>{const form=document.querySelector('#bibliography-form'),status=form.querySelector('#doi-status');status.textContent=tr('PDF에서 DOI를 찾는 중…');const doi=await doiFromPdf(state.storageKey,state.selected,state.selectedAttachment);if(!form.isConnected)return;if(doi){form.querySelector('#bib-doi').value=doi;status.textContent=tr('찾은 DOI를 확인한 뒤 조회하세요.');}else status.textContent=tr('첫 3페이지에서 DOI를 찾지 못했습니다. 직접 입력하세요.');}),
 'export-ris':runDesktop(async()=>{await desktopNotes();if(await window.appApi.exportBibliography(state.storageKey,'ris'))toast(tr('RIS를 저장했습니다.'));}),
 'export-bib':runDesktop(async()=>{await desktopNotes();if(await window.appApi.exportBibliography(state.storageKey,'bib'))toast(tr('BibTeX를 저장했습니다.'));}),
 'import-ris':runDesktop(async()=>{await desktopNotes();const snapshot=await window.appApi.importBibliography(state.storageKey);if(snapshot)applyItemSnapshot(snapshot,{screen:'library'});})
});

let trashAttachmentTarget=null;
Object.assign(actions,{'confirm-attachment-trash':runDesktop(async()=>{await desktopNotes();applyItemSnapshot(await window.appApi.trashAttachment(state.storageKey,trashAttachmentTarget.paperId,trashAttachmentTarget.id),{screen:'library'});})});
document.addEventListener('click',event=>{
 const remove=event.target.closest('[data-trash-attachment]');if(remove){trashAttachmentTarget={paperId:Number(remove.dataset.paperId),id:remove.dataset.trashAttachment};modal(tr('첨부 제거'),`<p>${tr('자료에서 이 첨부를 숨깁니다. 파일·주석·번역은 보관하며 저장소 관리에서 되살릴 수 있습니다.')}</p><p class="small muted">${tr('PDF 파일까지 지우려면 <b>파일까지 삭제</b>를 누르세요.')}</p>`,btn(tr('취소'),'close')+`<button class="secondary danger" data-delete-attachment="${esc(remove.dataset.trashAttachment)}" data-paper-id="${Number(remove.dataset.paperId)}">${tr('파일까지 삭제…')}</button>`+btn(tr('첨부 제거'),'confirm-attachment-trash','primary'));}
 // A notebook in the trash: back to the list (the notebook pane hears of it), or deleted for good after asking.
 const nbBack=event.target.closest('[data-restore-notebook]');if(nbBack)runDesktop(async()=>{await window.appApi.notebookRestore(state.storageKey,nbBack.dataset.restoreNotebook);await globalThis.appNotebookListChanged?.();await showVaultManager();})();
 const nbGone=event.target.closest('[data-purge-notebook]');if(nbGone){const n=vaultNotebookTrash.find(x=>x.id===nbGone.dataset.purgeNotebook);if(n){notebookPurgeTarget=n.id;modal(tr('노트북 완전히 삭제'),`<p>${tr('<strong>{title}</strong>을(를) 완전히 지웁니다. 되살릴 수 없습니다.',{title:esc(n.title)})}</p><p class="small muted">${tr('이 노트북만 쓰던 그림도 지웁니다. 다른 노트북이 쓰는 그림과 메모 탭의 메모는 그대로입니다.')}</p>`,btn(tr('취소'),'vault-manager')+`<button class="danger" data-action="nb-purge-go">${tr('완전히 삭제')}</button>`);}}
 const restore=event.target.closest('[data-restore-attachment]');if(restore)runDesktop(async()=>{await desktopNotes();await refreshManaged(await window.appApi.trashAttachment(state.storageKey,Number(restore.dataset.paperId),restore.dataset.restoreAttachment,true));})();
});

Object.assign(actions,{'nb-purge-go':runDesktop(async()=>{const id=notebookPurgeTarget;notebookPurgeTarget=null;if(!id)return;await window.appApi.notebookPurge(state.storageKey,id);await showVaultManager();toast(tr('노트북을 완전히 삭제했습니다.'));})});
Object.assign(actions,{'retry-notes':runDesktop(async()=>{await desktopNotes();const node=document.querySelector('#saved');if(node)node.textContent=tr('✓ 저장소에 저장됨');})});

// Figure selection uses the original PDF raster, independently of translation.
paths.figure='M4 4h16v16H4z M4 15.5l5-5 4.5 4.5 2.5-2.5 4 4 M15.5 8.5h.01';
let figureSession=null;
// 그림 설명 asks in the same box as the memo and AI tab (question, send icon inside, model chip
// under it) and shows the answer as the AI tab's card.
// A question box sends on Enter (Ctrl+Enter too) and breaks the line on Shift+Enter. An Enter that only ends the
// composition of a Korean, Japanese or Chinese syllable (isComposing, key code 229) is the input method's, not a send.
function aiSendKey(event){return event.key==='Enter'&&!event.shiftKey&&!event.altKey&&!event.isComposing&&event.keyCode!==229;}
function figureComposer(groups){return `<div class="note-ai-composer figure-composer"><textarea id="figure-question" rows="2" maxlength="2000" aria-label="${tr('그림에 질문')}" placeholder="${tr('이 그림에 질문하기 — 비우고 보내면 축·범례·주요 결과를 설명합니다')}"></textarea><div class="note-ai-composer-bar"><span></span><button type="button" class="composer-icon composer-send" data-action="figure-send" title="${tr('보내기 (Enter · 줄바꿈은 Shift+Enter)')}" aria-label="${tr('설명 요청')}">${icon('composerSend')}</button></div></div><div class="note-ai-under figure-under">${modelField('figure-model',groups,preferredChoice(groups))}</div>`;}
function figureAnswer(text,model,question){
  let body='';try{body=renderMarkdown(text);}catch(error){globalThis.quietError?.('figure-answer',error);}
  const asked=String(question||'').trim();
  return `<article class="insight-card open figure-answer"><header class="memo-card-head"><strong>${asked?tr('그림 질문'):tr('그림 설명',null,'kind')}</strong>${model?`<small class="muted">${esc(model)}</small>`:''}</header>${asked?`<blockquote class="small muted">${esc(asked)}</blockquote>`:''}<div class="insight-body md">${body||`<p>${esc(text)}</p>`}</div></article>`;
}
document.addEventListener('keydown',event=>{if(event.target.id==='figure-question'&&aiSendKey(event)){event.preventDefault();actions['figure-send']?.();}});
async function openFigure(preset){
  const session={id:state.storageKey,paperId:state.selected,attachmentId:state.selectedAttachment,key:targetKey(),page:preset?.page||translationPages.get(targetKey())||1,revision:0};
  // The PDF is the one open on screen (no re-read of the file; the save checks it), loaded while the model list comes.
  const docPending=pdfEngine().then(engine=>engine.documentFor(session.id,session.paperId,false,session.attachmentId));docPending.catch(()=>{});
  const groups=await readyModelGroups({vision:true,onRefresh:()=>refreshModelChoice('figure-model')});if(!groups)return;
  const doc=await docPending;
  if(session.key!==targetKey())return;
  figureSession={...session,...doc};
  if(preset?.rect)return openFigureCrop(groups,preset);
  modal(tr('사진·그래프 설명'),`<div class="figure-controls"><label>${tr('페이지')} <input id="figure-page" type="number" min="1" max="${doc.pdf.numPages}" value="${Math.min(session.page,doc.pdf.numPages)}"></label><button class="secondary small" data-action="figure-page">${tr('이동',null,'go to page')}</button><button class="secondary small" data-action="figure-all">${tr('페이지 전체 선택')}</button></div><p class="small muted">${tr('그림 영역을 드래그하세요. 고른 그림과 주변 본문을 아래에서 고른 모델로 보냅니다.')} <span id="figure-model-notice"></span></p><div class="figure-scroll"><div class="figure-canvas"><img id="figure-image" alt="${tr('영역을 선택할 원문 페이지')}" draggable="false"><div class="figure-selection" hidden></div></div></div>${figureComposer(groups)}<p id="figure-status" role="status" aria-live="polite"></p><div id="figure-result"></div>`,btn(tr('닫기'),'close')+btn(tr('주석에 추가'),'figure-save','primary'));
  const inner=dialog.querySelector('.dialog-inner'),body=document.createElement('div');body.className='figure-body';for(const child of [...inner.children])if(!child.matches('.dialog-head,.actions'))body.append(child);inner.querySelector('.actions').before(body);
  dialog.classList.add('figure-dialog');showModelNotice('figure-model');dialog.querySelector('[data-action="figure-save"]').disabled=true;dialog.querySelector('[data-action="figure-send"]').disabled=true;
  await showFigurePage();
  if(preset?.rect&&figureSession?.key===session.key&&figureSession.page===preset.page){setFigureRect(preset.rect);document.querySelector('#figure-question')?.focus();}
}
// A box chosen on screen: the dialog shows just that figure (no page to choose again).
async function openFigureCrop(groups,preset){
  const session=figureSession;session.page=preset.page;session.rect=preset.rect;session.sourcePage=null;
  modal(tr('그림 설명'),`<div class="figure-controls"><span class="pill">${tr('{n}쪽',{n:preset.page})}</span><button class="secondary small" data-action="figure-recapture">${tr('다시 고르기')}</button></div><p class="small muted">${tr('고른 그림과 주변 본문을 아래에서 고른 모델로 보냅니다.')} <span id="figure-model-notice"></span></p><div class="figure-crop"><img id="figure-crop-image" alt="${tr('고른 그림')}" draggable="false"></div>${figureComposer(groups)}<p id="figure-status" role="status" aria-live="polite">${tr('그림을 준비하는 중…')}</p><div id="figure-result"></div>`,btn(tr('닫기'),'close')+btn(tr('주석에 추가'),'figure-save','primary'));
  dialog.classList.add('figure-dialog','figure-crop-dialog');showModelNotice('figure-model');dialog.querySelector('[data-action="figure-save"]').disabled=true;dialog.querySelector('[data-action="figure-send"]').disabled=true;
  document.querySelector('#figure-question')?.focus();
  const engine=await pdfEngine(),[src,page]=await Promise.all([engine.selectionImage(session.pdf,session.page,session.rect),engine.extractPage(session.pdf,session.page)]);
  if(figureSession!==session)return;
  const img=document.querySelector('#figure-crop-image');img.src=src;session.sourcePage=page;
  document.querySelector('#figure-status').textContent=tr('선택한 영역을 설명할 준비가 됐습니다.');dialog.querySelector('[data-action="figure-send"]').disabled=false;
}
// ---- 그림 설명 from the pages on screen: drag over a figure (a click takes the whole page) ----
// Original and translated pages in page layout share each page's geometry, so a box on
// either maps to the same part of the source page. Section view has no page geometry and
// falls back to the page picker in the dialog.
let figureCapture=null;
const figureSheets=()=>state.screen!=='reader'?[]:[...document.querySelectorAll('.translated-pages [data-page]:not(.section-sheet)')].filter(sheet=>sheet.offsetParent&&sheet.getClientRects().length);
function sheetAt(x,y){return document.elementsFromPoint(x,y).map(el=>el.closest?.('.translated-pages [data-page]:not(.section-sheet)')).find(Boolean)||null;}
function endFigureCapture(){if(!figureCapture)return;figureCapture.layer.remove();figureCapture.hint.remove();document.removeEventListener('keydown',figureCapture.key,true);figureCapture=null;}
async function startFigureCapture(){
  if(figureCapture){endFigureCapture();return;}
  if(!figureSheets().length)return openFigure();
  const groups=await readyModelGroups({vision:true});if(!groups)return;
  const key=targetKey(),layer=document.createElement('div'),hint=document.createElement('div'),box=document.createElement('div');
  layer.className='figure-capture';box.className='figure-capture-box';box.hidden=true;layer.append(box);
  hint.className='figure-capture-hint';hint.setAttribute('role','status');hint.innerHTML=`<span>${tr('설명할 그림을 드래그하세요 · 클릭하면 그 쪽 전체 · Esc 취소')}</span><button type="button" class="secondary small" data-figure-capture="dialog">${tr('쪽 골라서 열기')}</button><button type="button" class="secondary small" data-figure-capture="cancel">${tr('취소')}</button>`;
  const areas=[...new Set(figureSheets().map(sheet=>sheet.closest('.translated-pages')))].map(c=>c.getBoundingClientRect()),r={left:Math.min(...areas.map(a=>a.left)),top:Math.min(...areas.map(a=>a.top)),right:Math.max(...areas.map(a=>a.right)),bottom:Math.max(...areas.map(a=>a.bottom))};r.width=r.right-r.left;r.height=r.bottom-r.top;
  Object.assign(layer.style,{left:`${r.left}px`,top:`${r.top}px`,width:`${r.width}px`,height:`${r.height}px`});
  // The hint sits just above the pages (over the pane's tool row) so it never covers a figure.
  Object.assign(hint.style,{left:`${r.left+r.width/2}px`,top:`${Math.max(8,r.top-50)}px`});
  document.body.append(layer,hint);
  let start=null,sheet=null;
  const local=(x,y)=>({x:x-r.left,y:y-r.top});
  layer.addEventListener('pointerdown',event=>{if(event.button!==0)return;sheet=sheetAt(event.clientX,event.clientY);if(!sheet)return;event.preventDefault();start={x:event.clientX,y:event.clientY};layer.setPointerCapture(event.pointerId);});
  layer.addEventListener('pointermove',event=>{if(!start)return;const s=sheet.getBoundingClientRect(),x=Math.max(s.left,r.left,Math.min(s.right,r.right,event.clientX)),y=Math.max(s.top,r.top,Math.min(s.bottom,r.bottom,event.clientY)),a=local(Math.min(start.x,x),Math.min(start.y,y));box.hidden=false;layer.classList.add('dragging');Object.assign(box.style,{left:`${a.x}px`,top:`${a.y}px`,width:`${Math.abs(x-start.x)}px`,height:`${Math.abs(y-start.y)}px`});});
  layer.addEventListener('pointerup',event=>{
    if(!start)return;const s=sheet.getBoundingClientRect(),x=Math.max(s.left,r.left,Math.min(s.right,r.right,event.clientX)),y=Math.max(s.top,r.top,Math.min(s.bottom,r.bottom,event.clientY));
    const small=Math.abs(x-start.x)<6||Math.abs(y-start.y)<6,rect=small?{x:0,y:0,width:1,height:1}:{x:(Math.min(start.x,x)-s.left)/s.width,y:(Math.min(start.y,y)-s.top)/s.height,width:Math.abs(x-start.x)/s.width,height:Math.abs(y-start.y)/s.height};
    const page=Number(sheet.dataset.page);start=null;endFigureCapture();if(key!==targetKey())return;runDesktop(()=>openFigure({page,rect}))();
  });
  // The layer sits over the pages; the wheel still scrolls the pages under it.
  layer.addEventListener('wheel',event=>{layer.style.pointerEvents='none';const target=document.elementFromPoint(event.clientX,event.clientY)?.closest('.translated-pages');layer.style.pointerEvents='';if(target){event.preventDefault();target.scrollBy({left:event.deltaX,top:event.deltaY});}},{passive:false});
  hint.addEventListener('click',event=>{const b=event.target.closest('[data-figure-capture]');if(!b)return;endFigureCapture();if(b.dataset.figureCapture==='dialog')runDesktop(openFigure)();});
  const keyHandler=event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();endFigureCapture();}};
  document.addEventListener('keydown',keyHandler,true);figureCapture={layer,hint,key:keyHandler};
}
async function showFigurePage(){
  const session=figureSession,input=document.querySelector('#figure-page');if(!session||session.busy||!input.reportValidity())return;
  const revision=++session.revision;session.page=Number(input.value);session.rect=null;session.result=null;session.sourcePage=null;
  dialog.querySelector('[data-action="figure-send"]').disabled=true;dialog.querySelector('[data-action="figure-save"]').disabled=true;
  document.querySelector('.figure-selection').hidden=true;document.querySelector('#figure-result').textContent='';document.querySelector('#figure-status').textContent=tr('페이지 준비 중…');
  const img=document.querySelector('#figure-image');img.removeAttribute('src');
  const engine=await pdfEngine(),[src,page]=await Promise.all([engine.imageFor(session.pdf,session.page),engine.extractPage(session.pdf,session.page)]);
  if(figureSession!==session||revision!==session.revision)return;
  img.src=src;await img.decode();if(figureSession!==session||revision!==session.revision)return;session.sourcePage=page;
  document.querySelector('#figure-status').textContent=tr('그림 영역을 선택하세요.');
  const surface=document.querySelector('.figure-canvas');let start=null;
  const point=event=>{const r=surface.getBoundingClientRect();return {x:Math.max(0,Math.min(1,(event.clientX-r.left)/r.width)),y:Math.max(0,Math.min(1,(event.clientY-r.top)/r.height))}};
  surface.onpointerdown=event=>{if(event.button!==0||session.busy)return;event.preventDefault();start=point(event);surface.setPointerCapture(event.pointerId);};
  surface.onpointermove=event=>{if(!start)return;const end=point(event);setFigureRect({x:Math.min(start.x,end.x),y:Math.min(start.y,end.y),width:Math.abs(end.x-start.x),height:Math.abs(end.y-start.y)});};
  surface.onpointerup=event=>{if(!start)return;surface.onpointermove(event);start=null;if(surface.hasPointerCapture(event.pointerId))surface.releasePointerCapture(event.pointerId);};
  surface.onpointercancel=()=>{start=null;};
}
function setFigureRect(rect){
  const session=figureSession;if(!session||session.busy||!session.sourcePage)return;
  session.rect=rect;session.result=null;const overlay=document.querySelector('.figure-selection');overlay.hidden=false;
  overlay.style.cssText=`left:${rect.x*100}%;top:${rect.y*100}%;width:${rect.width*100}%;height:${rect.height*100}%`;
  const valid=rect.width>=.01&&rect.height>=.01;dialog.querySelector('[data-action="figure-send"]').disabled=!valid;dialog.querySelector('[data-action="figure-save"]').disabled=true;
  document.querySelector('#figure-result').textContent='';document.querySelector('#figure-status').textContent=valid?tr('선택한 영역을 설명할 준비가 됐습니다.'):tr('조금 더 넓게 선택하세요.');
}
async function sendFigure(){
  const session=figureSession;if(!session?.rect||session.busy)return;
  session.busy=true;session.result=null;const choice=chosenModel('figure-model'),model=choice.model,question=document.querySelector('#figure-question').value;
  dialog.querySelectorAll('.figure-controls input,.figure-controls button,.figure-controls select,.figure-under button,#figure-question,[data-action="figure-send"],[data-action="figure-save"]').forEach(el=>el.disabled=true);
  document.querySelector('#figure-status').textContent=tr('그림을 분석하고 있습니다…');document.querySelector('#figure-result').textContent='';document.querySelector('#figure-status').scrollIntoView({block:'nearest'});
  try{
    const engine=await pdfEngine(),image=await engine.selectionImage(session.pdf,session.page,session.rect);session.image=image;
    if(figureSession!==session)return;
    const page=session.sourcePage,rect=session.rect,center=(rect.y+rect.height/2)*page.height;
    const caption=[...page.blocks].sort((a,b)=>Math.abs(a.y-center)-Math.abs(b.y-center)).map(b=>b.text).join(' ').slice(0,6000);
    const result=await window.appApi.explainFigure(session.id,session.paperId,session.attachmentId,session.hash,model,image,{page:session.page,caption,question,connection:choice.connection});
    if(figureSession!==session)return;
    session.result=result;session.model=model;document.querySelector('#figure-result').innerHTML=figureAnswer(result,model,question);document.querySelector('#figure-status').textContent=tr('설명 완료');document.querySelector('#figure-result').scrollIntoView({block:'nearest'});
  }catch(error){if(figureSession===session)document.querySelector('#figure-status').textContent=plainError(error);}
  finally{if(figureSession===session){session.busy=false;dialog.querySelectorAll('.figure-controls input,.figure-controls button,.figure-controls select,.figure-under button,#figure-question,[data-action="figure-send"]').forEach(el=>el.disabled=false);dialog.querySelector('[data-action="figure-save"]').disabled=!session.result;}}
}
Object.assign(actions,{
  'figure-open':runDesktop(startFigureCapture),'figure-page':runDesktop(showFigurePage),'figure-send':runDesktop(sendFigure),
  'figure-all':()=>setFigureRect({x:0,y:0,width:1,height:1}),
  'figure-recapture':()=>{if(figureSession?.busy)return;dialog.close();runDesktop(startFigureCapture)();},
  // The explanation becomes a memo of its own; its header line shows as a figure icon.
  'figure-save':runDesktop(async()=>{const session=figureSession;if(!session?.result||session.key!==targetKey())return;
    // The picture is saved in the vault (.<id>/note-images) and shown in the memo.
    let picture='';if(session.image)try{picture=`![${memoLabels().memoLabel('figurePicture',memoLanguage(),{page:session.page})}](note-image:${await window.appApi.saveNoteImage(session.id,session.image)})\n\n`;}catch(error){toast(tr('그림을 저장하지 못해 설명만 추가합니다: {error}',{error:plainError(error)}));}
    // A 그림 설명 is tied to its place in the paper, so it is kept as an annotation (주석 tab) with the figure's box.
    const r=session.rect,figure=r&&[r.x,r.y,r.width,r.height].every(Number.isFinite)?{x:r.x,y:r.y,width:r.width,height:r.height}:undefined;
    const sourceHash=await window.appApi.originalHash(session.id,session.paperId,session.attachmentId);
    const snapshot=await window.appApi.addAnnotation(session.id,session.paperId,session.attachmentId,{page:session.page,body:`${picture}${session.result}`,sourceHash,kind:'figure',model:session.model,figure});
    dialog.close();if(state.storageKey!==session.id)return;
    if(state.selected!==session.paperId)return;applyAnnotations(snapshot,'주석'); // i18n:keep — tab value
    const added=itemAnnotations.filter(a=>a.kind==='figure'&&a.paperId===session.paperId).sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)))[0];if(added)globalThis.appShowAnnotation?.(added.id,{focus:true});
    inkRefreshAnnotationMarks();toast(tr('그림 설명을 그림과 함께 주석 탭에 추가했습니다.'));})
});
dialog.addEventListener('close',()=>{if(!figureSession)return;figureSession=null;dialog.classList.remove('figure-dialog','figure-crop-dialog');window.appApi.cancelFigure().catch(()=>{});});

// Find uses PDF.js's native text index/highlight controller.
document.addEventListener('input',event=>{if(event.target.matches('.pdf-find-input')){const container=event.target.closest('.pdf-pane').querySelector('.original-pages');container.pdfController?.find(event.target.value);}});
document.addEventListener('keydown',event=>{if(event.target.matches('.pdf-find-input')&&event.key==='Enter'){event.preventDefault();event.target.closest('.pdf-pane').querySelector('.original-pages').pdfController?.find(event.target.value,true,event.shiftKey);}});
document.addEventListener('click',event=>{if(event.target.closest('[data-pdf-find-next]')){const pane=event.target.closest('.pdf-pane');pane.querySelector('.original-pages').pdfController?.find(pane.querySelector('.pdf-find-input').value,true);}});
document.addEventListener('keydown',event=>{if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='f'&&state.screen==='reader'){const input=document.querySelector('.pdf-find-input');if(input){event.preventDefault();input.focus();input.select();}}});
document.addEventListener('click',event=>{const choice=event.target.closest('[data-read-status]');if(!choice)return;const paperId=Number(choice.closest('[data-status-for]').dataset.statusFor),status=choice.dataset.readStatus,fromMenu=Boolean(choice.closest('.status-menu'));closeStatusMenu();runDesktop(async()=>{await setReadStatus(paperId,status);const again=[...document.querySelectorAll(`[data-status-for="${paperId}"] [data-read-status="${status}"]`)].find(b=>b.offsetParent);(fromMenu||!again?document.querySelector(`[data-status-menu="${paperId}"]`):again)?.focus();})();});
document.addEventListener('keydown',event=>{const choice=event.target.closest?.('[data-read-status]');if(!choice||!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))return;event.preventDefault();const items=[...choice.closest('[data-status-for]').querySelectorAll('[data-read-status]')],step=['ArrowRight','ArrowDown'].includes(event.key)?1:items.length-1,next=items[(items.indexOf(choice)+step)%items.length];if(choice.closest('.status-menu'))next.focus();else next.click();});
// The status pill changes the status without opening the paper (window capture runs first).
window.addEventListener('click',event=>{const pill=event.target.closest('[data-cycle-status]');if(!pill)return;event.stopImmediatePropagation();const paperId=Number(pill.dataset.cycleStatus),paper=papers.find(p=>p.id===paperId);if(paper)runDesktop(async()=>{await setReadStatus(paperId,nextReadStatus(paper.status));document.querySelector(`[data-cycle-status="${paperId}"]`)?.focus();})();},true);

// ---- Reader: the read status at the right end of the PDF tool row ----
// A file name as the header line of a 그림 설명 / AI 설명 memo names it: brackets would end the header early.
const noteHeadName=name=>String(name||'PDF').replace(/\[/g,'(').replace(/\]/g,')').replace(/\s+/g,' ').trim().slice(0,200)||'PDF';
// The row is: 목록 · writing tools · [그림 설명 · 주석 추가 | status]. The status is one button
// that shows where reading has got to (it changes by itself as pages are read; a click opens
// a menu to set it). As the window narrows:
//   1. everything fits on one line → labelled buttons at the right end;
//   2. a little short → 그림 설명·주석 추가 as icons;
//   3. the tools wrap to a second line anyway → the group on the first line, right of 목록;
//   4. very narrow → that group as icons.
paths.annotate='M4 4h16v12h-8l-5 4v-4H4z M12 7.5v5 M9.5 10h5';
// 메모 추가: a sheet with a folded corner and two lines of writing, drawn as large as the writing tools beside it.
// (The pin, memoPin, stays the mark of a memo that is pinned to a page.)
paths.memoAdd='M4 4h16v10l-6 6H4z M20 14h-6v6 M8 9h8 M8 13h4';
function readerStatusControl(paper){return `<div class="reader-status" data-reader-status-paper="${paper.id}" data-status-for="${paper.id}">${activeAttachment(paper)?.file?`<div class="reader-annotate">${translationTool('memo-pin-new',tr('메모 추가'),'memoAdd','data-memo-add aria-pressed="false"')}${translationTool('figure-open',tr('그림 설명'),'figure')}${translationTool('new-annotation',tr('주석 추가'),'annotate')}</div>`:''}<button type="button" class="pill status-pill reader-status-compact" data-status-menu="${paper.id}" data-status="${esc(paper.status)}" aria-haspopup="menu" aria-expanded="false" title="${tr('읽은 쪽에 따라 자동으로 바뀝니다. 눌러서 직접 바꾸기')}" aria-label="${tr('읽기 상태 {status}, 바꾸기',{status:esc(valueLabel(paper.status))})}">${esc(valueLabel(paper.status))}<svg class="status-caret" viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 4.5L6 8l3.5-3.5"/></svg></button></div>`;}
let readerStatusObservers=[];
function placeReaderStatus(){
  readerStatusObservers.forEach(o=>o.disconnect());readerStatusObservers=[];
  const bar=document.querySelector('.reader-mode-toolbar'),paper=selected();if(state.screen!=='reader'||!bar||!paper)return;
  if(!bar.querySelector('.reader-status'))bar.insertAdjacentHTML('afterbegin',readerStatusControl(paper)); // its place in the row is set by CSS order, after the tools
  // Only a change of width matters; the row's height changes with the layout it gets.
  let width=-1;const resize=new ResizeObserver(([entry])=>{if(entry.contentRect.width!==width){width=entry.contentRect.width;layoutReaderStatus();}}),children=new MutationObserver(()=>layoutReaderStatus());
  resize.observe(bar);children.observe(bar,{childList:true});readerStatusObservers=[resize,children];layoutReaderStatus();
}
function layoutReaderStatus(){
  const bar=document.querySelector('.reader-mode-toolbar'),status=bar?.querySelector('.reader-status');if(!status)return;
  const back=bar.querySelector('[data-action="back"]'),ink=bar.querySelector('.ink-toolbar'),style=getComputedStyle(bar),gap=parseFloat(style.columnGap)||0;
  const room=bar.clientWidth-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight);
  bar.dataset.statusLayout='measure';
  const annotate=status.querySelector('.reader-annotate'),gapAfter=parseFloat(getComputedStyle(status).columnGap||0),extra=annotate?annotate.offsetWidth+gapAfter:0;
  let iconExtra=0;if(annotate){annotate.classList.add('icon-only');iconExtra=annotate.offsetWidth+gapAfter;annotate.classList.remove('icon-only');}
  const pill=status.querySelector('.reader-status-compact').offsetWidth,full=pill+extra,compact=pill+iconExtra,backWidth=back?.offsetWidth||0;
  let tools=0;if(ink){const flex=ink.style.flex,width=ink.style.width;ink.style.flex='none';ink.style.width='max-content';tools=ink.offsetWidth;ink.style.flex=flex;ink.style.width=width;}
  const line=width=>backWidth+(ink?tools+gap:0)+gap+width<=room;
  bar.dataset.statusLayout=line(full)?'inline':line(compact)?'inline-compact':backWidth+gap+full<=room?'top':'top-compact';
}
let statusMenu=null;
function closeStatusMenu(){if(!statusMenu)return;document.querySelector(`[data-status-menu="${statusMenu.dataset.statusFor}"]`)?.setAttribute('aria-expanded','false');statusMenu.remove();statusMenu=null;}
function openStatusMenu(button){
  closeStatusMenu();const paperId=Number(button.dataset.statusMenu),paper=papers.find(p=>p.id===paperId);if(!paper)return;
  statusMenu=document.createElement('div');statusMenu.className='status-menu';statusMenu.setAttribute('role','menu');statusMenu.setAttribute('aria-label',tr('읽기 상태'));statusMenu.dataset.statusFor=paperId;
  statusMenu.innerHTML=readStatuses.map(v=>`<button type="button" role="menuitemradio" aria-checked="${paper.status===v}" data-read-status="${v}" data-status="${v}"><span class="status-dot"></span>${v}</button>`).join('');
  document.body.append(statusMenu);button.setAttribute('aria-expanded','true');
  const box=button.getBoundingClientRect(),menu=statusMenu.getBoundingClientRect();
  statusMenu.style.left=Math.max(8,Math.min(box.right-menu.width,innerWidth-menu.width-8))+'px';statusMenu.style.top=(box.bottom+4)+'px';
  statusMenu.querySelector('[aria-checked="true"]')?.focus();
}
document.addEventListener('click',event=>{const button=event.target.closest('[data-status-menu]');if(button){if(statusMenu)closeStatusMenu();else openStatusMenu(button);return;}if(statusMenu&&!event.target.closest('.status-menu'))closeStatusMenu();});
document.addEventListener('keydown',event=>{if(statusMenu&&event.key==='Escape'){event.preventDefault();event.stopPropagation();const id=statusMenu.dataset.statusFor;closeStatusMenu();document.querySelector(`[data-status-menu="${id}"]`)?.focus();}},true);
const baseRenderStatus=render;
// The read status is placed even when a step of drawing fails, so the tool row keeps its controls.
render=function(){closeStatusMenu();closePopMenu();try{baseRenderStatus();}finally{placeReaderStatus();}};

// ---- 이미 있는 자료 ----
// A PDF whose content the vault already has is held back when files are added. The user
// opens the item that has it, or adds the copy anyway.
let knownCopies=null;
function askKnownCopies(result,folder=state.folder||''){
  const added=result.results.filter(r=>r.ok).length,failed=result.results.filter(r=>!r.ok);
  knownCopies={vault:state.storageKey,folder,files:result.duplicates.map(d=>d.file)};
  modal(tr('이미 있는 자료입니다'),`<p>${tr('내용이 같은 PDF가 저장소에 있어 추가하지 않았습니다.')}${added?` ${tr('나머지 {n}개는 추가했습니다.',{n:added})}`:''}</p><div class="manager-list known-copies">${result.duplicates.map(d=>`<div class="manager-row"><span><strong>${esc(d.name)}</strong><small class="muted">${d.trashed?tr('휴지통에 있는 자료'):tr('기존 자료')}: ${esc(d.title)}</small></span>${d.trashed?`<span class="small muted">${tr('저장소 관리 · 휴지통에서 되살리기')}</span>`:`<button type="button" class="secondary small" data-open-known="${d.paperId}" data-attachment-id="${esc(d.attachmentId)}">${tr('기존 자료 열기')}</button>`}</div>`).join('')}</div>${failed.map(r=>`<p>${esc(r.name)}: ${esc(r.error)}</p>`).join('')}<p class="small muted">${tr('같은 논문을 따로 관리하려면 <b>그래도 추가</b>를 누르세요. 나중에 중복 자료 후보에서 병합할 수 있습니다.')}</p>`,btn(tr('추가하지 않음'),'close')+btn(tr('그래도 추가'),'known-copies-add'));
}
// ---- 삭제 (PDF 파일 포함) ----
let deleteTarget=null;
document.addEventListener('click',event=>{
  const known=event.target.closest?.('[data-open-known]');
  if(known){dialog.close();knownCopies=null;runDesktop(()=>openItemFile(Number(known.dataset.openKnown),known.dataset.attachmentId))();return;}
  const paperButton=event.target.closest?.('[data-delete-paper]'),fileButton=event.target.closest?.('[data-delete-attachment]');if(!paperButton&&!fileButton)return;
  if(paperButton){
    const id=Number(paperButton.dataset.deletePaper),paper=papers.find(p=>p.id===id)||vaultTrash.find(p=>p.id===id);deleteTarget={paperId:id,managed:paperButton.dataset.fromTrash!==undefined};
    const count=paper?.attachments?.length;
    modal(tr('자료 삭제'),`<p>${tr('<strong>{title}</strong>을(를) 삭제합니다.',{title:esc(paper?.title||tr('이 자료'))})}</p><ul><li>${count?tr('PDF 파일 {n}개를 저장소 폴더에서 지웁니다. 파일은 컴퓨터의 휴지통으로 보내며, 휴지통을 쓸 수 없는 환경에서는 바로 지워집니다.',{n:count}):tr('PDF 파일을 저장소 폴더에서 지웁니다. 파일은 컴퓨터의 휴지통으로 보내며, 휴지통을 쓸 수 없는 환경에서는 바로 지워집니다.')}</li><li>${tr('이 자료의 메모·주석·번역·필기·AI 기록을 지웁니다. 이 기록은 되살릴 수 없습니다.')}</li></ul><p class="small muted">${tr('목록에서만 숨기려면 취소한 뒤 <b>휴지통으로 이동</b>을 쓰세요.')}</p>`,btn(tr('취소'),deleteTarget.managed?'vault-manager':'close')+btn(tr('삭제'),'confirm-delete','primary danger'));
  }else{
    deleteTarget={paperId:Number(fileButton.dataset.paperId),attachmentId:fileButton.dataset.deleteAttachment,managed:fileButton.dataset.fromTrash!==undefined};
    modal(tr('첨부 삭제'),`<p>${tr('이 첨부의 PDF 파일을 저장소 폴더에서 지웁니다. 파일은 컴퓨터의 휴지통으로 보내며, 휴지통을 쓸 수 없는 환경에서는 바로 지워집니다.')}</p><p>${tr('이 첨부의 주석·번역·필기·AI 기록도 지웁니다. 이 기록은 되살릴 수 없습니다.')}</p>`,btn(tr('취소'),deleteTarget.managed?'vault-manager':'close')+btn(tr('삭제'),'confirm-delete','primary danger'));
  }
});
Object.assign(actions,{
  'known-copies-add':runDesktop(async()=>{
    const pending=knownCopies;if(!pending)return;knownCopies=null;dialog.close();
    const result=await window.appApi.importKnownCopies(pending.vault,pending.files,pending.folder);
    if(state.storageKey!==pending.vault)return;
    if(state.screen==='reader'){applyItemSnapshot(result.snapshot);reportImport(result,'추가');}else showImportResult(result); // i18n:keep — the kind of import
  }),
  'confirm-delete':runDesktop(async()=>{
    const target=deleteTarget,id=state.storageKey;if(!target)return;deleteTarget=null;
    await desktopNotes();if(dialog.open)dialog.close();
    const snapshot=target.attachmentId?await window.appApi.deleteAttachment(id,target.paperId,target.attachmentId):await window.appApi.deletePaper(id,target.paperId);
    if(state.storageKey!==id)return;
    await(await pdfEngine()).clearDocuments?.();
    if(target.managed)await refreshManaged(snapshot);else applyItemSnapshot(snapshot,{screen:'library'});
    const failed=snapshot.deleteReport?.failed||[];
    toast(failed.length?tr('삭제했지만 파일 {n}개는 지우지 못했습니다: {files}',{n:failed.length,files:failed.join(', ')}):tr('삭제했습니다.'));
  }),
});

// ---- Scrolling with the keyboard ----
// PageDown/PageUp and Space/Shift+Space move about nine tenths of what is shown, ↓/↑ a step, →/← a step sideways (only when
// the pages are wider than the pane), Home/End to the top and the bottom. The pane is the reading area last pressed or
// pointed at (source pages, translation, notebook pages, the library list); without one, the first of them shown. A key a
// field, a control, a dialog or a menu uses stays theirs (their handlers run first and hold it back). The browser's own
// scrolling is held back for the keys handled here, so a pane that has the focus does not move twice; the paired view
// follows through its scroll event as with the wheel.
const KEY_SCROLL_STEP=60,KEY_SCROLL_PANES=['.original-pages','.translated-pages','.nb-pages'];
let keyScrollPane=null;
function keyScrollShown(el){return Boolean(el?.isConnected&&el.getClientRects().length);}
function keyScrollLibrary(){const list=document.querySelector('#paper-list');for(let el=list?.parentElement;el&&el!==document.body;el=el.parentElement)if(/auto|scroll/.test(getComputedStyle(el).overflowY))return el;return null;}
function keyScrollPaneAt(node){return node?.closest?.(KEY_SCROLL_PANES.join(','))||(node?.closest?.('.library')?keyScrollLibrary():null);}
function keyScrollTarget(){
  if(keyScrollShown(keyScrollPane))return keyScrollPane;
  for(const selector of KEY_SCROLL_PANES){const pane=[...document.querySelectorAll(selector)].find(keyScrollShown);if(pane)return pane;}
  const list=keyScrollLibrary();return keyScrollShown(list)?list:null;
}
for(const type of ['pointerdown','pointerover'])document.addEventListener(type,event=>{const pane=keyScrollPaneAt(event.target);if(pane)keyScrollPane=pane;},true);
window.addEventListener('keydown',event=>{
  const key=event.key,space=key===' ';
  if(!['PageDown','PageUp','ArrowDown','ArrowUp','ArrowLeft','ArrowRight','Home','End',' '].includes(key))return;
  if(event.defaultPrevented||event.isComposing||event.ctrlKey||event.metaKey||event.altKey||(event.shiftKey&&!space)||dialog.open)return;
  const target=event.target;
  if(target.closest?.('input,textarea,select,[contenteditable]:not([contenteditable="false"]),.cm-editor,[role="menu"],[role="listbox"],[role="tablist"],[role="radiogroup"],[role="slider"],[role="tree"]'))return;
  if(space&&target!==document.body&&target.closest?.('button,a[href],summary,label,[role="button"],[role="menuitem"],[role="checkbox"],[role="switch"],[role="tab"],[role="option"],[tabindex]:not(.translated-pages):not(.nb-pages)'))return;
  if([...document.querySelectorAll('.pop-menu,[role="menu"],[role="listbox"],.search-pop,.note-ai-menu,.ink-text-menu,.tag-suggest')].some(keyScrollShown))return;
  const pane=keyScrollTarget();if(!pane)return;
  const page=Math.max(KEY_SCROLL_STEP,Math.round(pane.clientHeight*.9));let left=0,top=0;
  if(key==='PageDown'||space&&!event.shiftKey)top=page;
  else if(key==='PageUp'||space)top=-page;
  else if(key==='ArrowDown')top=KEY_SCROLL_STEP;
  else if(key==='ArrowUp')top=-KEY_SCROLL_STEP;
  else if(key==='Home')top=-pane.scrollTop;
  else if(key==='End')top=pane.scrollHeight;
  else{if(pane.scrollWidth<=pane.clientWidth+1)return;left=key==='ArrowRight'?KEY_SCROLL_STEP:-KEY_SCROLL_STEP;}
  event.preventDefault();pane.scrollBy({left,top,behavior:'instant'});
});

// A pane's tool row (.pdf-pane-tools of the source and translation panes, .nb-tools of the notebook, and the notebook
// pane's header with its buttons beside the notebook's name) in a pane too
// narrow for it: the tools that do not fit go, from the row's end, into a panel under a ⋯ button at the end of the
// row. The tools themselves are moved, not copied, and the panel is inside the row, so each keeps its place in the
// document for the code that looks for it (`.nb-tools .nb-tool`, the page number, the search box) and works as it did.
// The row is laid out again when its width or its tools change; the panel closes on a press outside it, on Escape, and
// after a command chosen in it.
paths.toolMore='M12 5h.01 M12 12h.01 M12 19h.01'; // three dots upright; a page's own menu is three lying flat, the notebook's a gear
const toolRows=new Map(),TOOL_ROWS='.pdf-pane-tools,.nb-tools,.notebook-pane>.pdf-pane-header',TOOL_ROW_KEPT='[data-action="gpt-export"],[data-action="ink-export-original"],.translation-quality,.pdf-pane-header>strong,.nb-select,.nb-status';
// Which row's panel the person has open, by where the row is (the source or translation pane, the notebook's tools or
// its header), not by the element: the app draws a row again when its tools change (a translation ending, a page
// turning), and the new row's panel opens as the old one was. It is forgotten when the person closes the panel, and when
// that row is no longer on the screen (another view), so a row that comes back later starts closed.
let toolOpenKey=null;
function toolRowKey(row){
  const pane=row.closest('.translated-pane,.notebook-pane,.pdf-pane');
  return (pane?.classList.contains('translated-pane')?'translated':pane?.classList.contains('notebook-pane')?'notebook':'source')+':'+(row.matches('.pdf-pane-header')?'header':'tools');
}
function toolRowLayout(row){
  const info=toolRows.get(row);if(!info||!row.isConnected)return;
  // What has the focus in the row (the page number, the search box) is moved below and so loses it: it gets it back.
  const focused=row.contains(document.activeElement)?document.activeElement:null;
  let more=row.querySelector(':scope>.tool-more'),panel=row.querySelector(':scope>.tool-overflow');
  if(!more){
    row.insertAdjacentHTML('beforeend',`<button type="button" class="pdf-tool tool-more" aria-haspopup="true" aria-expanded="false" title="${tr('도구 더 보기')}" aria-label="${tr('도구 더 보기')}" hidden>${icon('toolMore')}</button><div class="tool-overflow" role="group" aria-label="${tr('도구 더 보기')}" hidden></div>`);
    more=row.querySelector(':scope>.tool-more');panel=row.querySelector(':scope>.tool-overflow');
  }
  // Everything back in the row, each before the tool it stood before; then, while the row is too long, the last tool
  // that may go (saving the PDF and the translation's result count always stay in the row) goes to the head of the panel.
  for(const item of [...panel.children]){item.querySelector(':scope>.tool-overflow-label')?.remove();row.insertBefore(item,item.toolNext?.parentElement===row?item.toolNext:more);item.toolNext=null;}
  const wasOpen=!panel.hidden||toolOpenKey===toolRowKey(row); // open stays open through a new layout or a new row, while it holds something
  row.append(more,panel);panel.hidden=true;more.hidden=true;more.setAttribute('aria-expanded','false');
  const justify=row.style.justifyContent;row.style.justifyContent='flex-start';
  const tooLong=()=>row.scrollWidth>row.clientWidth+1;
  if(tooLong()){
    more.hidden=false;
    const last=()=>[...row.children].filter(c=>c!==more&&c!==panel&&!c.matches(TOOL_ROW_KEPT)).at(-1);
    for(let item=last();item&&tooLong();item=last()){
      if(item.matches('button')&&!item.querySelector('.pdf-tool-label')&&item.textContent.trim().length<=1&&item.getAttribute('aria-label'))item.insertAdjacentHTML('beforeend',`<span class="tool-overflow-label">${esc(item.getAttribute('aria-label').split(' — ')[0])}</span>`);
      item.toolNext=item.nextElementSibling;panel.prepend(item);
    }
    if(!panel.children.length)more.hidden=true;else if(wasOpen){panel.hidden=false;more.setAttribute('aria-expanded','true');}
  }
  row.style.justifyContent=justify;info.changes.takeRecords();
  if(focused?.isConnected&&document.activeElement!==focused&&!focused.closest('[hidden]'))focused.focus({preventScroll:true});
}
function toolRowsScan(){
  for(const [row,info] of toolRows)if(!row.isConnected){info.resize.disconnect();info.changes.disconnect();toolRows.delete(row);}
  for(const row of document.querySelectorAll(TOOL_ROWS)){
    if(toolRows.has(row))continue;
    let width=-1;const info={resize:new ResizeObserver(([entry])=>{if(entry.contentRect.width!==width){width=entry.contentRect.width;toolRowLayout(row);}}),changes:new MutationObserver(()=>toolRowLayout(row))};
    toolRows.set(row,info);row.classList.add('tool-row');info.resize.observe(row);info.changes.observe(row,{childList:true});toolRowLayout(row);
  }
  if(toolOpenKey&&![...toolRows.keys()].some(row=>toolRowKey(row)===toolOpenKey))toolOpenKey=null;
}
{let queued=false;new MutationObserver(()=>{if(queued)return;queued=true;requestAnimationFrame(()=>{queued=false;toolRowsScan();});}).observe(document.querySelector('#app'),{childList:true,subtree:true});toolRowsScan();}
function toolPanelClose(except){toolOpenKey=null;document.querySelectorAll('.tool-overflow:not([hidden])').forEach(panel=>{if(panel===except)return;panel.hidden=true;panel.parentElement.querySelector(':scope>.tool-more')?.setAttribute('aria-expanded','false');});}
document.addEventListener('click',event=>{
  const more=event.target.closest?.('.tool-more');
  if(more){const panel=more.parentElement.querySelector(':scope>.tool-overflow'),open=panel.hidden;toolPanelClose();panel.hidden=!open;more.setAttribute('aria-expanded',String(open));if(open)toolOpenKey=toolRowKey(more.parentElement);return;}
  if(!event.target.closest?.('.tool-overflow')){toolPanelClose();return;}
  // A command chosen in the panel closes it, unless it opened a menu that hangs from it; the page number, the search
  // box and the zoom steps (no data-action) are used again and again and leave it open.
  if(event.target.closest('button[data-action]'))setTimeout(()=>{if(!document.querySelector('.pop-menu'))toolPanelClose();},80);
});
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&document.querySelector('.tool-overflow:not([hidden])')){const more=document.querySelector('.tool-overflow:not([hidden])').parentElement.querySelector(':scope>.tool-more');toolPanelClose();more?.focus();}});
