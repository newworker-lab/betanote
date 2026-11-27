/* Notes: several memos per paper, written in Markdown with LaTeX math, and a wide editor with a formatting bar and a live view.
   Storage stays the vault's `notes` map: the first memo is `<id>-메모` as before
   (AI results, collected annotations and exports still go there); more memos are
   `<id>-메모-<time>`. A memo's title is kept beside it as `<memo key>#title`, and a figure's
   place on its page as `<memo key>#figure`. */
paths.expand='M15 3h6v6 M9 21H3v-6 M21 3l-7 7 M3 21l7-7';
paths.noteAdd='M12 5v14 M5 12h14';
paths.chipDown='M7 10l5 5 5-5';
paths.composerSend='M20 5v7a3 3 0 0 1-3 3H5 M9 11l-4 4 4 4';
paths.memoFold='M6 15l6-6 6 6';
let openMemoKey=null;
const TITLE='#title';
// A memo from 그림 설명 keeps where the figure is (`<memo key>#figure`: attachment, page, box in page fractions).
const FIGURE_PLACE='#figure';
// A memo pinned on the original: {attachmentId,page,x,y}, x and y as fractions of the page.
const MEMO_PIN='#pin';
// The sparkle of AI memos (markdown.js AI_ICON) for the memo card's "AI로 다듬기".
paths.memoAi='M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z';
// The first memo is listed while it has a title or text, or when it is the only one.
// The first memo (<id>-메모, where AI results and collected annotations also write) is listed only while
// it has a title or text, or while it is the memo being written: a paper without memos shows none.
function memoKeysOf(paperId){const first=`${paperId}-메모`,more=Object.keys(notes).filter(k=>k.startsWith(`${paperId}-메모-`)&&!k.includes('#')).sort();return notes[first]?.trim()||notes[first+TITLE]?.trim()||openMemoKey===first?[first,...more]:more;} // i18n:keep — stored memo keys
const memoMade=key=>{const stamp=key.split('-메모-')[1]; // i18n:keep — stored memo keys
const t=stamp?parseInt(stamp,36):NaN;return Number.isFinite(t)&&t>1e12?new Date(t):null;};
// The memo heads and names the app writes (core/memo-labels.cjs): written in the AI answer language, read in any.
const memoLabels=()=>globalThis.appMemoLabels;
// The AI answer language as it is now: each window hears a change made in any window.
let aiLanguageNow=window.appApi?.language?.aiResolved||'ko';
window.appApi?.onLanguageChanged?.(info=>{if(info?.aiResolved)aiLanguageNow=info.aiResolved;});
{const now=window.appApi?.readLanguage?.();if(now?.aiResolved)aiLanguageNow=now.aiResolved;} // a change made before the line above listened
const memoLanguage=()=>aiLanguageNow;
const memoPage=key=>memoLabels().readMemoHead((notes[key]||'').split('\n').map(l=>l.trim()).find(Boolean)||'')?.page||null;
// What a memo head's kind (stored as written) is called on this screen.
const headLabel=kind=>kind==='AI 설명'?tr('AI 설명'):tr('그림 설명',null,'kind'); // i18n:keep — the stored kind
function memoTitle(key,index){const own=notes[key+TITLE]?.trim();if(own)return own;const kind=sourceKind(notes[key]),page=memoPage(key);return kind?`${headLabel(kind)}${page?` · ${tr('{n}쪽',{n:page})}`:''}`:tr('메모 {n}',{n:index+1});}
const noteImageUrl=name=>`app://note-image/${encodeURIComponent(state.storageKey)}/${name}`;
const renderNote=source=>renderMarkdown(source,{imageUrl:noteImageUrl});
// A field with its own corner: drag it to change the height; a click or double-click opens the wide editor.
// A field with its own corner: drag it to change the height; on a summary field a click or double-click
// opens the wide editor, on an open memo the corner only resizes (the ⤢ in its header opens the editor).
paths.resize='M21 15l-6 6 M21 9L9 21 M21 3L3 21';
function noteBox(key,attributes,label,resizeOnly=false){return `<div class="note-box${resizeOnly?' resize-only':''}" data-kn-part="note"><textarea data-note="${esc(key)}" ${attributes} aria-label="${esc(label)}">${esc(notes[key]||'')}</textarea><button type="button" class="note-grip" data-note-grip="${esc(key)}" data-note-label="${esc(label)}" ${resizeOnly?'data-resize-only':''} title="${resizeOnly?tr('끌어서 메모 높이 조절'):tr('끌어서 높이 조절 · 눌러서 넓게 편집')}" aria-label="${resizeOnly?tr('{name} 높이 조절',{name:esc(label)}):tr('{name} 넓게 편집',{name:esc(label)})}">${icon(resizeOnly?'resize':'expand')}</button></div>`;}
// Memo order: the order set by dragging (kept with the paper's notes as <id>-메모#order), the page
// (its pin on the original, the figure it explains, or the page in its source line), or when each
// was written. Which one is shown is this computer's view setting.
const MEMO_SORTS=[['custom',tr('직접 정렬')],['page',tr('페이지순')],['created',tr('작성일순 (오래된 것부터)')],['created-desc',tr('작성일순 (최근 것부터)')]];
const memoOrderKey=paperId=>`${paperId}-메모#order`; // i18n:keep — stored memo key
function memoSortChoice(){try{const saved=localStorage.getItem('app-memo-sort');return MEMO_SORTS.some(([id])=>id===saved)?saved:'custom';}catch{return 'custom';}}
function savedMemoOrder(paperId){try{const list=JSON.parse(notes[memoOrderKey(paperId)]||'[]');return Array.isArray(list)?list.filter(k=>typeof k==='string'):[];}catch{return [];}}
function memoSortPage(key){for(const suffix of [MEMO_PIN,FIGURE_PLACE]){try{const place=JSON.parse(notes[key+suffix]||'null');if(place&&!place.notebookId&&Number.isFinite(Number(place.page)))return Number(place.page);}catch{}}return memoPage(key);}
// The first memo has no time in its key; it counts as the oldest.
const memoTime=key=>memoMade(key)?.getTime()??0;
function sortMemoKeys(paperId,keys,sort=memoSortChoice()){
  const base=new Map(keys.map((k,i)=>[k,i]));
  if(sort==='page')return [...keys].sort((a,b)=>(memoSortPage(a)??Infinity)-(memoSortPage(b)??Infinity)||memoTime(a)-memoTime(b)||base.get(a)-base.get(b));
  if(sort==='created')return [...keys].sort((a,b)=>memoTime(a)-memoTime(b)||base.get(a)-base.get(b));
  if(sort==='created-desc')return [...keys].sort((a,b)=>memoTime(b)-memoTime(a)||base.get(a)-base.get(b));
  const order=savedMemoOrder(paperId).filter(k=>base.has(k));return [...order,...keys.filter(k=>!order.includes(k))];
}
// Dropping a memo before or after another sets the order and switches to 직접 정렬.
function moveMemo(paperId,key,target,after){
  const list=sortMemoKeys(paperId,memoKeysOf(paperId)).filter(k=>k!==key),at=list.indexOf(target);if(at<0)return;
  list.splice(after?at+1:at,0,key);notes[memoOrderKey(paperId)]=JSON.stringify(list);
  try{localStorage.setItem('app-memo-sort','custom');}catch{}
  refreshMemos();runDesktop(desktopNotes)();
}
document.addEventListener('change',event=>{const select=event.target.closest?.('.memo-sort');if(!select)return;try{localStorage.setItem('app-memo-sort',select.value);}catch{}refreshMemos();});
let memoDrag=null;
document.addEventListener('dragstart',event=>{const card=event.target.closest?.('.memo-tab:not(.summary-tab) .memo-card:not(.open)');if(!card)return;memoDrag=card.dataset.memo;event.dataTransfer.setData('application/x-app-memo',memoDrag);event.dataTransfer.effectAllowed='move';card.classList.add('dragging');});
const memoDropAt=event=>{const card=event.target.closest?.('.memo-tab:not(.summary-tab) .memo-list .memo-card');if(!card||!memoDrag||card.dataset.memo===memoDrag)return null;const box=card.getBoundingClientRect();return {card,after:event.clientY>box.top+box.height/2};};
const clearMemoDrop=()=>document.querySelectorAll('.memo-card.drop-before,.memo-card.drop-after').forEach(n=>n.classList.remove('drop-before','drop-after'));
document.addEventListener('dragover',event=>{if(!memoDrag)return;const at=memoDropAt(event);clearMemoDrop();if(!at)return;event.preventDefault();event.dataTransfer.dropEffect='move';at.card.classList.add(at.after?'drop-after':'drop-before');});
document.addEventListener('drop',event=>{if(!memoDrag)return;const at=memoDropAt(event),key=memoDrag;memoDrag=null;clearMemoDrop();if(!at)return;event.preventDefault();event.stopPropagation();moveMemo(state.selected,key,at.card.dataset.memo,at.after);});
document.addEventListener('dragend',()=>{memoDrag=null;document.querySelectorAll('.memo-card.dragging').forEach(n=>n.classList.remove('dragging'));clearMemoDrop();});
function memoTab(p){
  // Every memo shows as its title and one line until it is chosen; only the chosen one opens.
  const keys=memoKeysOf(p.id);if(openMemoKey&&!keys.includes(openMemoKey))openMemoKey=null;
  // The comments mark the tab for views that show something else in its place (the AI tab).
  const sort=memoSortChoice(),sorted=sortMemoKeys(p.id,keys,sort);
  return `<!--memo-tab--><div class="memo-tab"><div class="memo-head"><span class="small muted">${tr('메모 {n}개',{n:keys.length})}</span>${keys.length>1?`<select class="memo-sort" aria-label="${tr('메모 순서')}" title="${tr('메모 순서 — 메모를 끌어서 옮기면 직접 정렬이 됩니다')}">${MEMO_SORTS.map(([id,label])=>`<option value="${id}" ${id===sort?'selected':''}>${label}</option>`).join('')}</select>`:''}<button type="button" class="secondary small memo-new-icon" data-action="memo-new" title="${tr('새 메모')}" aria-label="${tr('새 메모')}">${icon('noteAdd')}</button></div><div class="memo-list">${sorted.map(key=>memoCard(key,keys.indexOf(key))).join('')||`<p class="small muted">${tr('메모가 없습니다.')}</p>`}</div></div><!--/memo-tab-->`;
}
// A memo made from 그림 설명 or AI 설명 shows its kind and a link back to the page it came from.
// One icon goes to where the memo belongs: its kind's icon (a picture, AI) to the page a 그림 설명 or AI
// 설명 memo came from, a link to the memo's pin (on a source page or a notebook page). A memo of that kind
// without a page shows its kind.
function memoSource(key){const kind=sourceKind(notes[key]);if(!kind)return memoPinLink(key);const page=memoPage(key),glyph=kind==='AI 설명'?AI_ICON:FIGURE_ICON; // i18n:keep — the stored kind
  return page?`<button type="button" class="memo-source" data-annotation-page="${page}" title="${tr('{kind} · {page}쪽 원문으로 이동',{kind:headLabel(kind),page})}" aria-label="${tr('{kind}, {page}쪽 원문으로 이동',{kind:headLabel(kind),page})}">${glyph}</button>`:`<span class="memo-source" title="${headLabel(kind)}">${glyph}</span>`;}
function memoPinLink(key){const where=notes[key+MEMO_PIN]&&memoPinWhere(key);return where?`<button type="button" class="memo-source" data-memo-pin-go="${esc(key)}" title="${tr('핀으로 이동 · {place}',{place:esc(where)})}" aria-label="${tr('핀으로 이동, {place}',{place:esc(where)})}">${LINK_ICON}</button>`:'';}
function memoCard(key,index){
  const open=key===openMemoKey,made=memoMade(key),title=memoTitle(key,index),hasTitle=Boolean(notes[key+TITLE]?.trim());
  // Every card's tools in one order: AI · 핀 · 넓게 편집 · 새 창 · 휴지통 (a closed card: AI · 넓게 편집 · 휴지통).
  const wide=memoWideButton(key,title),trash=`<button type="button" class="row-more" data-memo-delete="${esc(key)}" title="${tr('메모 삭제')}" aria-label="${tr('{name} 삭제',{name:esc(title)})}">${icon('trash')}</button>`;
  if(open)return `<article class="memo-card open" data-memo="${esc(key)}"><header class="memo-card-head">${memoSource(key)}<input class="memo-title" data-note="${esc(key+TITLE)}" value="${esc(notes[key+TITLE]||'')}" placeholder="${esc(title)}" maxlength="200" aria-label="${tr('메모 제목')}"><span class="memo-actions"><button type="button" class="row-more" data-memo-fold title="${tr('접기 (Esc)')}" aria-label="${tr('{name} 접기',{name:esc(title)})}">${icon('memoFold')}</button>${aiButton(key,title)}${memoPinButton(key,title)}${wide}${memoWindowButton(key,title)}${trash}</span></header>${noteBox(key,`id="note" placeholder="${tr('본문 — Markdown과 $수식$을 쓸 수 있습니다')}"`,title,true)}</article>`;
  const actions=`<span class="memo-actions">${aiButton(key,title)}${wide}${trash}</span>`;
  const glance=memoGlance(notes[key]);
  return `<article class="memo-card" data-memo="${esc(key)}" tabindex="0" role="button" draggable="true" aria-label="${tr('{name} 열기 · 끌어서 순서 바꾸기',{name:esc(title)})}"><header class="memo-card-head">${memoSource(key)}<strong class="${hasTitle?'':'untitled'}">${esc(title)}</strong>${made?`<small class="muted">${made.toLocaleDateString(appI18n.uiLocale())}</small>`:''}${actions}</header><div class="memo-glance">${glance.image?`<img class="memo-thumb" src="${esc(noteImageUrl(glance.image))}" alt="" loading="lazy">`:''}<div class="memo-line md">${glance.line?renderNote(glance.line):`<p class="muted">${glance.image?tr('그림'):tr('비어 있음')}</p>`}</div></div></article>`;
}
// The AI button in a memo's or 요약 section's title row (질문하기 · 고치기).
const aiButton=(key,label)=>`<button type="button" class="row-more memo-ai-button" data-memo-ai="${esc(key)}" title="${tr('AI에게 묻기 · 고치기')}" aria-label="${tr('{name} AI에게 묻기 또는 고치기',{name:esc(label)})}">${icon('memoAi')}</button>`;
// The pin button: a memo has one pin, on a source page or a notebook page (a figure memo's pin is its figure's).
function memoPinWhere(key){let place=null;try{place=JSON.parse(notes[key+MEMO_PIN]||'null');}catch{}if(!place)return '';return place.notebookId?(typeof nbPlaceLabel==='function'?nbPlaceLabel(place):tr('노트북')):tr('원문 {page}쪽',{page:place.page});}
function memoPinButton(key,title){const pinned=Boolean(notes[key+MEMO_PIN]),pin=pinned?tr('핀 빼기 ({place})',{place:memoPinWhere(key)}):tr('핀 꽂기 — 원문이나 노트북 페이지에');return `${notes[key+FIGURE_PLACE]&&!pinned?'':`<button type="button" class="row-more${pinned?' active':''}" data-memo-pin="${esc(key)}" title="${esc(pin)}" aria-pressed="${pinned}" aria-label="${tr('{name} {action}',{name:esc(title),action:esc(pin)})}">${icon('memoPin')}</button>`}`;}
const memoWindowButton=(key,title)=>`<button type="button" class="row-more" data-memo-window="${esc(key)}" title="${tr('새 창에서 보기')}" aria-label="${tr('{label} 새 창에서 보기',{label:esc(title)})}">${icon('newWindow')}</button>`;
const memoWideButton=(key,title)=>`<button type="button" class="row-more" data-memo-wide="${esc(key)}" title="${tr('넓게 편집')}" aria-label="${tr('{name} 넓게 편집',{name:esc(title)})}">${icon('expand')}</button>`;
// A closed memo shows one line: its first line of text (not a source header or a picture), rendered;
// and the first picture as a thumbnail.
function memoGlance(text){return memoLabels().memoGlance(text);} // core/memo-labels.cjs
// 요약 shows its four parts as cards, like the memos: a title and one line until one is chosen and opens.
const SUMMARY_LABELS=[tr('연구 질문'),tr('방법'),tr('결과'),tr('한계')];
let openSummary=null;
function summaryFields(p){
  const keys=SUMMARY_LABELS.map((_,i)=>`${p.id}-summary-${i}`),written=keys.filter(k=>notes[k]?.trim()).length;
  return `<div class="memo-tab summary-tab"><div class="memo-head"><span class="small muted">${tr('요약 {written}/{total} 작성',{written,total:keys.length})}</span></div><div class="memo-list">${SUMMARY_LABELS.map((label,i)=>summaryCard(p,label,i)).join('')}</div></div>`;
}
function summaryCard(p,label,i){
  const key=`${p.id}-summary-${i}`,wide=`${aiButton(key,label)}<button type="button" class="row-more" data-summary-wide="${i}" title="${tr('넓게 편집')}" aria-label="${tr('{name} 넓게 편집',{name:label})}">${icon('expand')}</button>`;
  if(openSummary===i)return `<article class="memo-card open summary-card" data-summary="${i}"><header class="memo-card-head"><strong>${label}</strong><span class="memo-actions"><button type="button" class="row-more" data-summary-fold title="${tr('접기 (Esc)')}" aria-label="${tr('{name} 접기',{name:label})}">${icon('memoFold')}</button>${wide}${memoWindowButton(key,label)}</span></header>${noteBox(key,`id="summary-${i}" placeholder="${tr('{name} — Markdown과 $수식$을 쓸 수 있습니다',{name:label})}"`,label,true)}</article>`;
  // The tag line an adopted AI summary starts with is not the glance.
  const glance=memoGlance(String(notes[key]||'').split('\n').filter(l=>!memoLabels().isAiHead(l)).join('\n'));
  return `<article class="memo-card summary-card" data-summary="${i}" tabindex="0" role="button" aria-label="${tr('{name} 열기',{name:label})}"><header class="memo-card-head"><strong>${label}</strong><span class="memo-actions">${wide}</span></header><div class="memo-glance"><div class="memo-line md">${glance.line?renderNote(glance.line):`<p class="muted">${tr('비어 있음')}</p>`}</div></div></article>`;
}
function refreshSummary(){const tab=document.querySelector('.summary-tab'),p=selected();if(tab&&p){tab.outerHTML=summaryFields(p);syncLiveFields();}}
document.addEventListener('click',event=>{
  const wide=event.target.closest('[data-summary-wide]');if(wide){event.stopPropagation();const i=Number(wide.dataset.summaryWide);openSummary=i;openNoteEditor(`${state.selected}-summary-${i}`,SUMMARY_LABELS[i]);return;}
  const fold=event.target.closest('[data-summary-fold]'),open=event.target.closest('.summary-card.open');
  if(fold||open&&(event.target===open||event.target.classList.contains('memo-card-head'))){event.stopPropagation();openSummary=null;refreshSummary();return;}
  const card=event.target.closest('.summary-card:not(.open)');if(card&&!event.target.closest('a,input,button')){openSummary=Number(card.dataset.summary);refreshSummary();const area=document.querySelector(`#summary-${openSummary}`),editor=area&&liveFields.get(area);if(editor)editor.focusEnd();else area?.focus();}
});
document.addEventListener('keydown',event=>{if(event.key!=='Escape'||dialog.open)return;const card=event.target.closest?.('.summary-card.open');if(!card)return;event.preventDefault();openSummary=null;refreshSummary();card.isConnected||document.querySelector(`.summary-card[data-summary="${card.dataset.summary}"]`)?.focus();});
function refreshMemos(){const tab=document.querySelector('.memo-tab:not(.summary-tab):not(.annot-tab)'),p=selected();if(tab&&p)tab.outerHTML=memoTab(p);}
// With no memo yet, a new memo is the first one (<id>-메모); otherwise a memo of its own.
function newMemo(text='',title=''){const p=selected();if(!p)return null;const key=memoKeysOf(p.id).length?`${p.id}-메모-${Date.now().toString(36)}`:`${p.id}-메모`; // i18n:keep — stored memo keys
notes[key]=text;if(title)notes[key+TITLE]=title;if(text)noteIndexed(key,text);if(title)noteIndexed(key+TITLE,title);openMemoKey=key;return key;}
Object.assign(actions,{
  'memo-new':runDesktop(async()=>{newMemo();state.tab='메모'; // i18n:keep — tab value
refreshMemos();syncLiveFields();document.querySelector('.memo-card.open .memo-title')?.focus();await desktopNotes();}),
});
// Show a memo in the 메모 tab (from a pin, a notebook embed or an @mention). A memo of another paper
// (in a project notebook) opens in its own window, so the reader and the notebook stay as they are.
function openMemo(key){
  if(notes[key]===undefined){toast(tr('메모를 찾을 수 없습니다. 지워졌을 수 있습니다.'));return;}
  const paperId=Number(key.split('-')[0]);
  if(paperId!==state.selected){openMemoWindow(key);return;}
  openMemoKey=key;showPanelTab('메모'); // i18n:keep — tab value
setTimeout(()=>{const card=document.querySelector(`.memo-card[data-memo="${CSS.escape(key)}"]`);card?.scrollIntoView({block:'nearest'});card?.classList.add('flash');setTimeout(()=>card?.classList.remove('flash'),1600);},50);
}
// A memo's text set from outside its editors (the memo window, AI): every open editor of it shows
// the new text, and it is indexed and saved as typing is.
function setNote(key,value){notes[key]=value;syncNoteEditors(key);noteEdited(key,value);}
function syncNoteEditors(key,except=null){
  const value=notes[key]??'',selector=`[data-note="${CSS.escape(key)}"]`;
  for(const field of document.querySelectorAll(selector)){if(field.value===value)continue;field.value=value;liveFields.get(field)?.setDoc(value);}
  for(const ed of [noteEditor,...noteWindows]){if(!ed||ed===except)continue;if(ed.key===key)ed.setText(value);else for(const field of ed.root.querySelectorAll(selector))if(field.value!==value)field.value=value;}
}
// AI on one memo or 요약 section, in its wide editor (the AI button in a memo's or section's title
// opens the editor with it; the editor and a memo window have it in the toolbar). 질문하기 asks the
// model anything — the text written so far and a passage selected in the paper go along as context;
// the paper is not searched — and adds the answer; 고치기 rewrites what is written by an instruction.
// The result is shown first and changes the text only when the user takes it.
let memoAiSelection=null;
const MEMO_AI_PRESETS={ask:[tr('쉽게 풀어 설명해 줘'),tr('핵심 개념을 정리해 줘'),tr('관련 배경 지식을 알려 줘')],edit:[tr('문장 다듬기'),tr('핵심만 요약'),tr('목록으로 정리'),tr('영어로 번역'),tr('한국어로 번역')]};
const summaryIndex=key=>{const m=String(key).match(/-summary-(\d)$/);return m?Number(m[1]):null;};
function noteLabel(key){const i=summaryIndex(key);return i!==null?SUMMARY_LABELS[i]:memoTitle(key,memoKeysOf(Number(key.split('-')[0])).indexOf(key));}
// Text selected in the app's original or translation goes along, if wanted.
function readerSelection(){const sel=window.getSelection(),text=String(sel||'').trim(),sheet=sel?.anchorNode?.parentElement?.closest?.('.translated-pages [data-page]');return text&&sheet?{text:text.slice(0,4000),page:Number(sheet.dataset.page)||null}:null;}
document.addEventListener('pointerdown',event=>{if(event.target.closest?.('[data-memo-ai]'))memoAiSelection=readerSelection();},true);
document.addEventListener('click',event=>{
  const ai=event.target.closest('[data-memo-ai]');if(!ai)return;event.preventDefault();event.stopPropagation();
  const key=ai.dataset.memoAi,selection=memoAiSelection||readerSelection();memoAiSelection=null;openNoteEditor(key,noteLabel(key),undefined,{selection});
},true);
function memoAiShow(key){const i=summaryIndex(key);if(i!==null){openSummary=i;refreshSummary();}else{openMemoKey=key;refreshMemos();}}
// The result goes in: added below what is written, or in its place; one undo puts the text back.
function memoAiTake(key,label,text,append){
  if(notes[key]===undefined&&summaryIndex(key)===null){toast(tr('메모를 찾을 수 없습니다. 지워졌을 수 있습니다.'));return false;}
  const before=notes[key]||'';
  setNote(key,append&&before.trim()?`${before.replace(/\s+$/,'')}\n\n${text}`:text);memoAiShow(key);
  undoToast(append?tr('AI 결과를 {name}에 추가했습니다.',{name:label}):tr('AI 결과로 {name}을(를) 바꿨습니다.',{name:label}),()=>{if(notes[key]===undefined&&summaryIndex(key)===null)return;setNote(key,before);memoAiShow(key);});
  return true;
}
// What the AI panel works on: a memo or 요약 section (its text in notes), or another target an editor
// gives (an AI tab result: asked about only, its answers added under it).
function noteAiTarget(key){const section=summaryIndex(key)!==null;return {what:section?tr('이 섹션'):tr('이 메모'),text:()=>String(notes[key]??''),paperId:Number(key.split('-')[0]),section:section?noteLabel(key):'',edit:true,editLabel:section?tr('내용 고치기'):tr('메모 고치기'),addLabel:section?tr('섹션에 추가'):tr('메모에 추가'),take:(text,append)=>memoAiTake(key,noteLabel(key),text,append)};}
const aiTargetOf=ed=>ed.aiTarget||noteAiTarget(ed.key);
function editorAiToggle(ed,selection){if(ed.ai)editorAiClose(ed);else runDesktop(()=>editorAiOpen(ed,selection===undefined?(ed.aiTarget?.selection?.()??readerSelection()):selection))();}
async function editorAiOpen(ed,selection){
  const groups=await readyModelGroups({onRefresh:()=>editorAiModels(ed)});if(!groups||!ed.root.isConnected||ed.ai)return;
  const {root}=ed,target=aiTargetOf(ed),written=Boolean(target.text().trim()),panel=root.querySelector('.note-ai');
  ed.ai={mode:'ask',selection,sending:null,text:null,images:[]};panel.hidden=false;root.querySelector('[data-editor-ai]')?.setAttribute('aria-expanded','true');root.querySelector('[data-editor-ai]')?.classList.add('active');
  panel.innerHTML=`<div class="note-ai-model-fields" hidden>${modelField('editor-ai-model',groups,preferredChoice(groups))}</div><div class="note-ai-head"><div class="segmented memo-ai-mode" role="radiogroup" aria-label="${tr('AI 작업')}"><button type="button" role="radio" data-memo-ai-mode="ask">${tr('질문하기')}</button>${target.edit?`<button type="button" role="radio" data-memo-ai-mode="edit" ${written?'':`disabled title="${tr('고칠 내용이 아직 없습니다')}"`}>${target.editLabel}</button>`:''}</div><p class="small muted memo-ai-hint"></p><button type="button" class="row-more" data-editor-ai-close title="${tr('AI 닫기')}" aria-label="${tr('AI 닫기')}">×</button></div><div class="note-ai-composer"><div class="memo-ai-image-list"></div><textarea id="editor-ai-instruction" rows="2" maxlength="1000" aria-label="${tr('질문')}"></textarea><div class="note-ai-composer-bar"><button type="button" class="composer-icon" data-editor-ai-image-add title="${tr('그림 첨부 (질문 칸에 붙여 넣어도 됩니다)')}" aria-label="${tr('그림 첨부')}">${icon('plus')}</button><input type="file" id="editor-ai-images" accept="image/*" multiple hidden><button type="button" class="composer-icon composer-send" data-editor-ai-send title="${tr('보내기 (Enter · 줄바꿈은 Shift+Enter)')}" aria-label="${tr('보내기')}">${icon('composerSend')}</button></div></div><div class="note-ai-under"><div class="memo-ai-presets"></div><button type="button" class="note-ai-chip" data-editor-ai-chip aria-haspopup="menu" aria-expanded="false"><span class="note-ai-chip-model"></span><span class="note-ai-chip-connection"></span>${icon('chipDown')}</button></div>${selection?`<label class="memo-ai-check"><input type="checkbox" id="editor-ai-selection" checked> ${tr('원문에서 선택한 부분도 보내기')}${selection.page?` (${tr('{n}쪽',{n:selection.page})})`:''}</label><blockquote class="memo-ai-quote small">${esc(selection.text.slice(0,300))}${selection.text.length>300?'…':''}</blockquote>`:''}<div class="note-ai-result" aria-live="polite"></div>`;
  editorAiMode(ed,'ask');
}
function editorAiMode(ed,mode){
  const {root,ai}=ed;if(!ai||ai.sending)return;ai.mode=mode;const target=aiTargetOf(ed);
  const length=target.text().length,what=target.what;
  root.querySelectorAll('[data-memo-ai-mode]').forEach(b=>{const on=b.dataset.memoAiMode===mode;b.classList.toggle('active',on);b.setAttribute('aria-checked',String(on));});
  const content=length&&tr('{what} 내용({chars}자)',{what,n:length,chars:length.toLocaleString(appI18n.uiLocale())}),picked=ai.selection&&tr('선택한 원문'),context=content&&picked?tr('{a}과 {b}',{a:content,b:picked}):content||picked||'';
  root.querySelector('.memo-ai-hint').textContent=mode==='ask'?(context?tr('답을 {what} 끝에 추가합니다. {context}을 참고로 보내고, 논문 전체는 보내지 않습니다.',{what,context}):tr('답을 {what} 끝에 추가합니다. 논문 전체는 보내지 않습니다.',{what})):tr('{what} 전체({chars}자)를 요청대로 다시 씁니다. 결과를 보고 바꿀 때만 바뀝니다.',{what,n:length,chars:length.toLocaleString(appI18n.uiLocale())});
  const area=root.querySelector('#editor-ai-instruction');area.placeholder=mode==='ask'?tr('질문 — 예: 이 개념을 쉽게 설명해 줘'):tr('요청 — 예: 핵심만 세 줄로 정리, 영어로 번역');area.setAttribute('aria-label',mode==='ask'?tr('질문'):tr('요청'));
  root.querySelector('.memo-ai-presets').innerHTML=[...(mode==='ask'&&ai.selection?[tr('선택한 부분을 설명해 줘')]:[]),...MEMO_AI_PRESETS[mode]].map(t=>`<button type="button" class="secondary small" data-memo-ai-preset="${t}">${t}</button>`).join('');
  const attach=root.querySelector('[data-editor-ai-image-add]');if(attach)attach.hidden=mode!=='ask';const list=root.querySelector('.memo-ai-image-list');if(list)list.hidden=mode!=='ask';
  editorAiNotice(ed);area.focus();
}
// Pictures sent with a question (a figure, a formula, a screenshot): at most 3, added to the note with the answer.
const EDITOR_AI_IMAGE_MAX=3;
function editorAiImages(ed){
  const list=ed.root.querySelector('.memo-ai-image-list');if(!list||!ed.ai)return;
  list.innerHTML=ed.ai.images.map((image,i)=>`<figure class="rules-image"><img src="${image.dataUrl}" alt="${tr('질문 그림 {n}',{n:i+1})}"><button type="button" class="row-more" data-editor-ai-image-remove="${i}" title="${tr('빼기')}" aria-label="${tr('질문 그림 {n} 빼기',{n:i+1})}">×</button></figure>`).join('');
  const add=ed.root.querySelector('[data-editor-ai-image-add]');if(add)add.disabled=ed.ai.images.length>=EDITOR_AI_IMAGE_MAX;
}
async function editorAiAddImages(ed,files){
  for(const file of files){
    if(!ed.ai)return;if(ed.ai.images.length>=EDITOR_AI_IMAGE_MAX){toast(tr('질문 그림은 {n}장까지 넣을 수 있습니다.',{n:EDITOR_AI_IMAGE_MAX}));break;}
    if(!file?.type?.startsWith('image/'))continue;const png=await pngOf(file);if(png&&ed.ai)ed.ai.images.push(png);
  }
  editorAiImages(ed);
}
const editorAiChoice=ed=>{const option=ed.root.querySelector('#editor-ai-model')?.selectedOptions?.[0];return option?{connection:option.dataset.connection,model:option.value}:null;};
function editorAiNotice(ed){const notice=ed.root.querySelector('#editor-ai-model-notice');if(!notice||!ed.ai)return;const what=aiTargetOf(ed).what;notice.dataset.noticeWhat=ed.ai.mode==='ask'?tr('질문과 {what} 내용',{what}):tr('{what} 내용',{what});notice.textContent=modelNotice(editorAiChoice(ed),notice.dataset.noticeWhat)+aiRulesNotice('editor-ai-model');editorAiChip(ed);}
// 연결·모델: one small chip under the question box (model, then its connection); a click lists every
// connection's models to choose from. The two lists it sets stay in the panel, hidden, as the source.
function editorAiChip(ed){
  const chip=ed.root.querySelector('[data-editor-ai-chip]');if(!chip)return;const choice=editorAiChoice(ed),group=modelGroupsShown.find(g=>g.id===choice?.connection);
  const name=ed.root.querySelector('#editor-ai-model')?.selectedOptions?.[0]?.textContent||tr('모델 선택'),where=group?connectionLabel(group):'';
  chip.querySelector('.note-ai-chip-model').textContent=name;chip.querySelector('.note-ai-chip-connection').textContent=where;
  const notice=ed.root.querySelector('#editor-ai-model-notice')?.textContent||'';chip.title=`${where?`${where} · `:''}${name} — ${tr('눌러서 바꾸기')}${notice?`\n${notice}`:''}`;chip.setAttribute('aria-label',tr('연결 {where}, 모델 {name}. 눌러서 바꾸기',{where,name}));
}
function editorAiMenuClose(ed,focus=false){const menu=ed.root.querySelector('.note-ai-menu');if(!menu)return;menu.remove();const chip=ed.root.querySelector('[data-editor-ai-chip]');chip?.setAttribute('aria-expanded','false');if(focus)chip?.focus();}
function editorAiMenuOpen(ed){
  const chip=ed.root.querySelector('[data-editor-ai-chip]'),panel=ed.root.querySelector('.note-ai');if(!chip||!panel)return;editorAiMenuClose(ed);
  const choice=editorAiChoice(ed),check='<span class="note-ai-menu-check" aria-hidden="true">✓</span>',notice=ed.root.querySelector('#editor-ai-model-notice')?.textContent||'';
  const menu=ed.doc.createElement('div');menu.className='note-ai-menu';menu.setAttribute('role','menu');menu.setAttribute('aria-label',tr('연결과 모델'));
  menu.innerHTML=shownGroups(modelGroupsShown).map(g=>`<div class="note-ai-menu-group" role="presentation">${esc(connectionLabel(g))}</div>${g.models.map(m=>{const on=choice?.connection===g.id&&choice?.model===m.id;return `<button type="button" role="menuitemradio" aria-checked="${on}" class="${on?'active':''}" data-editor-ai-pick="${esc(g.id)}" data-model="${esc(m.id)}"><span>${esc(m.name)}</span>${on?check:''}</button>`;}).join('')}`).join('')+modelProblems(modelGroupsShown)+(notice?`<p class="note-ai-menu-notice">${esc(notice)}</p>`:'');
  panel.append(menu);chip.setAttribute('aria-expanded','true');
  // Fixed to the window, above the chip (below it when there is no room above); the measured offset
  // corrects for a dialog that is the fixed box's container.
  const win=ed.win,box=chip.getBoundingClientRect(),size=menu.getBoundingClientRect(),up=box.top-size.height-6>=8;
  const left=Math.max(8,Math.min(box.right-size.width,win.innerWidth-size.width-8)),top=up?box.top-size.height-6:Math.min(box.bottom+6,win.innerHeight-size.height-8);
  menu.style.left=`${left}px`;menu.style.top=`${top}px`;const placed=menu.getBoundingClientRect();menu.style.left=`${2*left-placed.left}px`;menu.style.top=`${2*top-placed.top}px`;
  (menu.querySelector('[aria-checked="true"]')||menu.querySelector('button'))?.focus();
}
function editorAiPick(ed,connection,model){
  const list=ed.root.querySelector('#editor-ai-model-connection'),select=ed.root.querySelector('#editor-ai-model');if(!select)return;
  if(list)list.innerHTML=connectionOptions(modelGroupsShown,{connection,model});select.innerHTML=modelOptions(modelGroupsShown,{connection,model});
  editorAiMenuClose(ed,true);editorAiNotice(ed);
}
// The model lists of the panel, in its own document (a memo window has no app handlers).
function editorAiModels(ed){
  const select=ed.root.querySelector('#editor-ai-model');if(!select)return;editorAiMenuClose(ed);const chosen=editorAiChoice(ed),group=modelGroupsShown.find(g=>g.id==='gpt-web');if(group)group.models=gptModels;
  const kept=chosen&&modelGroupsShown.some(g=>g.id===chosen.connection&&g.models.some(m=>m.id===chosen.model)),next=kept?chosen:preferredChoice(modelGroupsShown);
  const connection=ed.root.querySelector('#editor-ai-model-connection');if(connection)connection.innerHTML=connectionOptions(modelGroupsShown,next);select.innerHTML=modelOptions(modelGroupsShown,next);editorAiNotice(ed);
}
function editorAiChange(ed,event){
  if(!ed.ai)return;const connection=event.target.closest?.('#editor-ai-model-connection');
  if(connection){const models=ed.root.querySelector('#editor-ai-model');if(models)models.innerHTML=modelOptions(modelGroupsShown,{connection:connection.value});}
  if(connection||event.target.closest?.('#editor-ai-model'))editorAiNotice(ed);
  if(event.target.id==='editor-ai-images'){const files=[...event.target.files];event.target.value='';runDesktop(()=>editorAiAddImages(ed,files))();}
}
function editorAiClick(ed,event){
  const t=event.target;if(!ed.ai||!t.closest?.('.note-ai'))return;
  const mode=t.closest('[data-memo-ai-mode]');if(mode){if(!mode.disabled)editorAiMode(ed,mode.dataset.memoAiMode);return;}
  const preset=t.closest('[data-memo-ai-preset]');if(preset){const area=ed.root.querySelector('#editor-ai-instruction');area.value=preset.dataset.memoAiPreset;area.focus();return;}
  if(t.closest('[data-editor-ai-chip]')){if(ed.root.querySelector('.note-ai-menu'))editorAiMenuClose(ed);else editorAiMenuOpen(ed);return;}
  const pick=t.closest('[data-editor-ai-pick]');if(pick){editorAiPick(ed,pick.dataset.editorAiPick,pick.dataset.model);return;}
  if(t.closest('.note-ai-menu'))return;
  if(t.closest('[data-editor-ai-image-add]')){ed.root.querySelector('#editor-ai-images')?.click();return;}
  const drop=t.closest('[data-editor-ai-image-remove]');if(drop){ed.ai.images.splice(Number(drop.dataset.editorAiImageRemove),1);editorAiImages(ed);return;}
  if(t.closest('[data-editor-ai-send]')){runDesktop(()=>editorAiSend(ed))();return;}
  if(t.closest('[data-editor-ai-close]')){editorAiClose(ed);return;}
  if(t.closest('[data-editor-ai-cancel]')){editorAiCancel(ed);return;}
  const take=t.closest('[data-editor-ai-take]');if(take){const {text}=ed.ai;if(!text)return;const append=take.dataset.editorAiTake==='append';
    // A target may save its result elsewhere and answer later (an AI tab result); the panel resets once it is in.
    take.disabled=true;Promise.resolve(aiTargetOf(ed).take(text,append)).then(ok=>{if(!ok||!ed.ai){take.disabled=false;return;}ed.ai.text=null;const edit=ed.root.querySelector('[data-memo-ai-mode="edit"]');if(edit){edit.disabled=false;edit.removeAttribute('title');}ed.root.querySelector('.note-ai-result').innerHTML='';const area=ed.root.querySelector('#editor-ai-instruction');area.value='';ed.ai.images=[];editorAiImages(ed);editorAiMode(ed,ed.ai.mode);}).catch(error=>{take.disabled=false;toast(plainError(error));});return;}
  if(t.closest('[data-editor-ai-discard]')){ed.ai.text=null;ed.root.querySelector('.note-ai-result').innerHTML='';}
}
async function editorAiSend(ed){
  const {root,key,ai}=ed;if(!ai||ai.sending)return;const choice=editorAiChoice(ed),instruction=root.querySelector('#editor-ai-instruction')?.value.trim();if(!choice?.model)return;
  if(!instruction){toast(ai.mode==='ask'?tr('AI에게 물을 내용을 입력하세요.'):tr('AI에게 요청할 내용을 입력하세요.'));return;}
  const target=aiTargetOf(ed);if(ai.mode==='edit'&&!target.text().trim()){toast(tr('고칠 내용이 아직 없습니다.'));return;}
  const selection=ai.mode==='ask'&&ai.selection&&root.querySelector('#editor-ai-selection')?.checked?ai.selection:null,images=ai.mode==='ask'?ai.images.slice():[],mode=ai.mode,memo=target.text(),token={};
  rememberChoice(choice);ai.sending=token;ai.text=null;const out=root.querySelector('.note-ai-result'),send=root.querySelector('[data-editor-ai-send]');send.disabled=true;
  out.innerHTML=`<p class="small" role="status">${tr('요청 중…')} <button type="button" class="secondary small" data-editor-ai-cancel>${tr('취소')}</button></p>`;
  // A quick question sent as written is in the screen language; it is answered in the AI answer language when that differs.
  const quick=mode==='ask'&&[tr('선택한 부분을 설명해 줘'),...MEMO_AI_PRESETS.ask].includes(instruction)&&aiLanguageNow!==appI18n.uiLanguage();
  let result;try{result=await window.appApi.aiMemo(state.storageKey,target.paperId,choice.model,{mode,...(quick?{answerLanguage:aiLanguageNow}:{}),section:target.section,...(target.context?{context:target.context}:{}),memo,instruction,...(selection?{selection:selection.text,page:selection.page}:{}),...(images.length?{images:images.map(i=>i.dataUrl)}:{}),connection:choice.connection});}
  catch(error){if(ed.ai?.sending===token){ed.ai.sending=null;send.disabled=false;out.innerHTML=`<p class="error">${esc(plainError(error))}</p>`;}return;}
  // Cancelled or closed meanwhile: the request was aborted and nothing is shown.
  if(ed.ai?.sending!==token)return;ed.ai.sending=null;send.disabled=false;
  // An answer goes in under its question (with the pictures sent with it, and the passage it was about, with its page).
  let pictures='';if(images.length){try{const names=[];for(const i of images)names.push(await window.appApi.saveNoteImage(state.storageKey,i.dataUrl));pictures=names.map(n=>`![${memoLabels().memoLabel('questionPicture',memoLanguage())}](note-image:${n})`).join('\n');}catch(error){globalThis.quietError?.('question-picture',error);}}
  if(!ed.ai||ed.ai.sending)return; // closed or sent again while the pictures were saved
  const text=mode==='ask'?[`**Q. ${instruction.replace(/\s+/g,' ')}**`,pictures,selection&&`> ${selection.text.replace(/\s+/g,' ').slice(0,300)}${selection.text.length>300?'…':''}${selection.page?` (p. ${selection.page})`:''}`,result.text].filter(Boolean).join('\n\n'):result.text;
  ed.ai.text=text;const changed=mode==='edit'&&target.text()!==memo,add=target.addLabel;
  out.innerHTML=`<div class="memo-ai-preview md">${renderNote(text)}</div>${changed?`<p class="small muted">${tr('요청을 보낸 뒤 내용이 바뀌었습니다. “바꾸기”는 그 사이 고친 내용까지 바꿉니다.')}</p>`:''}<div class="note-ai-actions"><button type="button" class="secondary small" data-editor-ai-discard>${tr('버리기')}</button>${mode==='ask'?`<button type="button" class="primary small" data-editor-ai-take="append">${add}</button>`:`<button type="button" class="secondary small" data-editor-ai-take="append">${tr('아래에 덧붙이기')}</button><button type="button" class="primary small" data-editor-ai-take="replace">${tr('바꾸기',null,'replace')}</button>`}</div>`;
}
function editorAiCancel(ed){if(!ed.ai?.sending)return;ed.ai.sending=null;window.appApi.aiCancel().catch(()=>{});const send=ed.root.querySelector('[data-editor-ai-send]');if(send)send.disabled=false;const out=ed.root.querySelector('.note-ai-result');if(out)out.innerHTML=`<p class="small muted">${tr('요청을 취소했습니다.')}</p>`;}
// Closing the panel (or its editor) while waiting cancels the request.
function editorAiClose(ed){
  if(!ed.ai)return;if(ed.ai.sending)window.appApi.aiCancel().catch(()=>{});ed.ai=null;
  const panel=ed.root.querySelector('.note-ai');if(panel){panel.hidden=true;panel.innerHTML='';}
  const button=ed.root.querySelector('[data-editor-ai]');button?.setAttribute('aria-expanded','false');button?.classList.remove('active');
}
// A memo in its own window: the same wide editor as in the app (title, toolbar, views, live view, AI),
// saved as the memo tab saves. Edits made there show in the app's editors when typing pauses (or at
// once when the app is focused), and the app's edits show there when the window is focused. The
// window stays with the vault and memo it was opened for.
function openMemoWindow(key){
  if(notes[key]===undefined&&summaryIndex(key)===null)return;const vault=state.storageKey,memo=key.includes('-메모')&&!key.includes('#'); // i18n:keep — stored memo keys
  openViewWindow(viewWindowName('memo',vault,key),noteLabel(key),(child,main,header)=>{
    main.classList.add('note-window');main.innerHTML=noteEditorHtml(key,memo,savedNoteView(),true);
    const ed=mountNoteEditor(main,key,{memo,inWindow:true}),title=header.querySelector('strong');noteWindows.add(ed);
    const alive=()=>state.storageKey===vault&&(notes[key]!==undefined||summaryIndex(key)!==null);
    const lock=()=>{for(const field of main.querySelectorAll('textarea,input'))field.readOnly=true;ed.live?.view.contentDOM.setAttribute('contenteditable','false');if(header.querySelector('.memo-window-gone'))return;const note=child.document.createElement('span');note.className='memo-window-gone small muted';note.textContent=tr('메모가 지워졌거나 저장소가 바뀌어 여기서는 더 고칠 수 없습니다.');header.append(note);};
    const named=()=>{title.textContent=child.document.title=noteLabel(key);};
    // The window's own timers: the app's window behind it may have its timers slowed down.
    let save=null,sync=null;const changed=new Set();
    const syncNow=()=>{if(!sync)return;try{child.clearTimeout(sync);}catch{/* the window is closed and its timer with it */}sync=null;if(alive())for(const k of changed)syncNoteEditors(k,ed);changed.clear();};
    main.addEventListener('input',event=>{
      const field=event.target.closest?.('[data-note]');if(!field)return;if(!alive()){lock();return;}
      const k=field.dataset.note;notes[k]=field.value;noteEdited(k,field.value);if(k===key+TITLE)named();changed.add(k);
      child.clearTimeout(save);save=child.setTimeout(()=>{if(alive())runDesktop(desktopNotes)();},600);
      child.clearTimeout(sync);sync=child.setTimeout(syncNow,400);
    });
    window.addEventListener('focus',syncNow);
    child.addEventListener('focus',()=>{if(!alive()){lock();return;}const text=notes[key]??'';if(ed.area().value!==text)ed.setText(text);const own=main.querySelector('.memo-title');if(own&&own.value!==(notes[key+TITLE]||''))own.value=notes[key+TITLE]||'';named();});
    child.addEventListener('beforeunload',()=>{syncNow();window.removeEventListener('focus',syncNow);noteWindows.delete(ed);ed.destroy();if(!alive())return;runDesktop(desktopNotes)();if(!document.activeElement?.closest?.('.memo-tab'))refreshMemos();});
  });
}
document.addEventListener('click',event=>{const b=event.target.closest('[data-memo-window]');if(!b)return;event.preventDefault();event.stopPropagation();openMemoWindow(b.dataset.memoWindow);},true);
// Deleting the first memo empties it (its key stays for the features that write there).
function deleteMemo(key){
  const first=!key.includes('-메모-'), // i18n:keep — stored memo keys
before={text:notes[key],title:notes[key+TITLE],place:notes[key+FIGURE_PLACE],pin:notes[key+MEMO_PIN]};
  if(first)notes[key]='';else delete notes[key];delete notes[key+TITLE];delete notes[key+FIGURE_PLACE];delete notes[key+MEMO_PIN];noteIndexed(key,notes[key]);noteIndexed(key+TITLE,undefined);if(openMemoKey===key)openMemoKey=null;refreshMemos();inkRefreshAnnotationMarks();runDesktop(desktopNotes)();
  undoToast(tr('메모를 삭제했습니다.'),()=>{if(before.text!==undefined)notes[key]=before.text;if(before.title!==undefined)notes[key+TITLE]=before.title;if(before.place!==undefined)notes[key+FIGURE_PLACE]=before.place;if(before.pin!==undefined)notes[key+MEMO_PIN]=before.pin;noteIndexed(key,notes[key]);noteIndexed(key+TITLE,notes[key+TITLE]);openMemoKey=key;refreshMemos();inkRefreshAnnotationMarks();runDesktop(desktopNotes)();});
}
document.addEventListener('click',event=>{
  const wide=event.target.closest('[data-memo-wide]');if(wide){event.stopPropagation();const key=wide.dataset.memoWide;openMemoKey=key;openNoteEditor(key,memoTitle(key,memoKeysOf(state.selected).indexOf(key)),true);return;}
  const remove=event.target.closest('[data-memo-delete]');if(remove){event.stopPropagation();deleteMemo(remove.dataset.memoDelete);return;}
  // The fold button, or a click on the open memo's edge or header gap, folds it again.
  const fold=event.target.closest('[data-memo-fold]'),open=event.target.closest('.memo-card.open[data-memo]');
  if(fold||open&&(event.target===open||event.target.classList.contains('memo-card-head'))){event.stopPropagation();openMemoKey=null;refreshMemos();return;}
  const card=event.target.closest('.memo-card[data-memo]:not(.open)');if(card&&!event.target.closest('a,input,button')){openMemoKey=card.dataset.memo;refreshMemos();syncLiveFields();focusNote();}
});
// A new title shows in the card list right away (the input itself keeps its focus).
document.addEventListener('input',event=>{if(!event.target.matches?.('.memo-title[data-note]'))return;const key=event.target.dataset.note.slice(0,-TITLE.length),heading=document.querySelector('.note-editor-dialog .dialog-head h2');if(heading&&noteEditor?.key===key)heading.textContent=noteLabel(key);});
document.addEventListener('keydown',event=>{const card=event.target.closest?.('.memo-card:not(.open)');if(card&&event.target===card&&(event.key==='Enter'||event.key===' ')){event.preventDefault();card.click();}});
// Links in rendered notes open outside the app; (p. N) jumps to that page (handled by the annotation page link).
document.addEventListener('click',event=>{const link=event.target.closest('.md a[data-external-link]');if(!link)return;event.preventDefault();event.stopPropagation();window.appApi.openPdfLink(link.href).catch(error=>toast(plainError(error)));},true);

// ---- The corner: drag to resize, click or double-click to open the wide editor ----
document.addEventListener('pointerdown',event=>{
  const grip=event.target.closest('[data-note-grip]');if(!grip||event.button!==0)return;event.preventDefault();
  const area=grip.closest('.note-box').querySelector('.field-live')||grip.closest('.note-box').querySelector('textarea'),startY=event.clientY,startH=area.offsetHeight;let moved=false;
  grip.setPointerCapture(event.pointerId);
  const move=e=>{const dy=e.clientY-startY;if(Math.abs(dy)>3)moved=true;if(moved)area.style.height=Math.max(60,startH+dy)+'px';};
  const up=()=>{grip.removeEventListener('pointermove',move);grip.removeEventListener('pointerup',up);grip.removeEventListener('pointercancel',up);if(!moved&&!grip.hasAttribute('data-resize-only'))openNoteEditor(grip.dataset.noteGrip,grip.dataset.noteLabel);};
  grip.addEventListener('pointermove',move);grip.addEventListener('pointerup',up);grip.addEventListener('pointercancel',up);
});
document.addEventListener('dblclick',event=>{const box=event.target.closest('.note-box:not(.resize-only)');if(!box)return;const area=box.querySelector('textarea'),r=(box.querySelector('.field-live')||area).getBoundingClientRect();if(event.clientX>r.right-24&&event.clientY>r.bottom-24)openNoteEditor(area.dataset.note,area.getAttribute('aria-label'));});

// ---- Wide editor ----
const MD_TOOLS=[
  ['heading',tr('제목',null,'heading'),'M5 4v16 M19 4v16 M5 12h14'],['bold',tr('굵게 (Ctrl+B)'),'M7 5h6a3.5 3.5 0 0 1 0 7H7z M7 12h7a3.5 3.5 0 0 1 0 7H7z'],['italic',tr('기울임 (Ctrl+I)'),'M14 5h-4 M14 19h-4 M14 5l-4 14'],
  ['strike',tr('취소선'),'M5 12h14 M16 7a4 3 0 0 0-8 0c0 4 8 3 8 7a4 3 0 0 1-8 0'],['mark',tr('형광'),'M9 11l-6 6v3h9l3-3 M22 12l-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4'],
  null,['bullet',tr('글머리 목록'),'M9 6h11 M9 12h11 M9 18h11 M4 6h.01 M4 12h.01 M4 18h.01'],['number',tr('번호 목록'),'M10 6h10 M10 12h10 M10 18h10 M4 5l1-1v4 M4 14h2l-2 3h2'],['task',tr('체크 목록'),'M4 5h4v4H4z M4 15h4v4H4z M11 7h9 M11 17h9'],['quote',tr('인용'),'M6 8h4v5c0 2-1 3-3 3 M14 8h4v5c0 2-1 3-3 3'],
  null,['code',tr('코드'),'M8 8l-4 4 4 4 M16 8l4 4-4 4'],['link',tr('링크 (Ctrl+K)'),'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1 M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1'],
  ['math',tr('수식 $…$ (Ctrl+Shift+M)'),'M5 19l4-14 4 14 M6.5 13h5 M15 9l5 6 M20 9l-5 6'],['mathBlock',tr('수식 블록 $$'),'M4 6h16 M4 18h16 M8 9l3 3-3 3 M13 15h3'],['table',tr('표'),'M3 5h18v14H3z M3 10h18 M3 15h18 M9 5v14 M15 5v14'],['rule',tr('구분선'),'M4 12h16'],
];
const NOTE_VIEWS=[['live',tr('라이브')],['edit',tr('편집')],['split',tr('나란히')],['preview',tr('미리보기')]];
const mathHtml=(tex,display)=>{try{return katex.renderToString(tex,{displayMode:display,throwOnError:false,trust:false,strict:'ignore',maxSize:50,maxExpand:500});}catch{return esc(tex);}};
// A wide editor of a memo or 요약 section: in the app's dialog, or in a memo window (a document of its
// own, see openMemoWindow) — the same title, toolbar, views, live view and AI. Its text is notes[key].
// The live view is one editable text: math, pictures and marks are rendered in place, and only the
// one the cursor is in shows its source; the source textarea stays the one that is saved.
let noteEditor=null;const noteWindows=new Set();
const savedNoteView=()=>{try{const v=localStorage.getItem('app-note-view');if(NOTE_VIEWS.some(x=>x[0]===v))return v;}catch{}return 'live';};
function noteEditorHtml(key,memo,view,inWindow=false){
  return `${memo?`<input class="memo-title editor-title" data-note="${esc(key+TITLE)}" value="${esc(notes[key+TITLE]||'')}" placeholder="${tr('제목')}" maxlength="200" aria-label="${tr('메모 제목')}">`:''}<div class="md-toolbar" role="toolbar" aria-label="${tr('서식')}">${MD_TOOLS.map(t=>t?`<button type="button" class="md-tool" data-md="${t[0]}" title="${t[1]}" aria-label="${t[1]}"><span class="icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="${t[2]}"/></svg></span></button>`:'<span class="md-sep"></span>').join('')}<span class="md-sep"></span><button type="button" class="md-tool md-ai" data-editor-ai aria-expanded="false" title="${tr('AI에게 묻기 · 고치기')}" aria-label="${tr('AI에게 묻기 또는 고치기')}">${icon('memoAi')}</button>${inWindow?'':`<button type="button" class="md-tool" data-editor-window title="${tr('새 창에서 보기')}" aria-label="${tr('새 창에서 보기')}">${icon('newWindow')}</button>`}<span class="md-view segmented" role="radiogroup" aria-label="${tr('보기')}">${NOTE_VIEWS.map(([v,l])=>`<button type="button" role="radio" data-md-view="${v}" aria-checked="${v===view}" class="${v===view?'active':''}">${l}</button>`).join('')}</span></div><div class="note-ai" hidden></div><div class="note-editor-body" data-view="${view}"><textarea id="note-editor" data-note="${esc(key)}" spellcheck="false" placeholder="${tr('**굵게**, *기울임*, ==형광==, $E=mc^2$, - 목록, > 인용')}">${esc(notes[key]||'')}</textarea><div class="note-editor-preview md" aria-live="off"></div><div class="md-live md" aria-label="${tr('라이브 편집')}"></div></div>`;
}
// The AI panel's own listeners, on the editor's root (a dialog, a memo window, an AI result's view).
function bindEditorAi(ed,{click=false}={}){
  const root=ed.root;
  if(click)root.addEventListener('click',event=>editorAiClick(ed,event));
  root.addEventListener('change',event=>editorAiChange(ed,event));
  root.addEventListener('scroll',event=>{const menu=root.querySelector('.note-ai-menu');if(menu&&!menu.contains(event.target))editorAiMenuClose(ed);},true);
  root.addEventListener('pointerdown',event=>{const menu=root.querySelector('.note-ai-menu');if(menu&&!menu.contains(event.target)&&!event.target.closest?.('[data-editor-ai-chip]'))editorAiMenuClose(ed);},true);
  root.addEventListener('keydown',event=>{const menu=root.querySelector('.note-ai-menu');if(!menu)return;
    if(event.key==='Escape'){event.preventDefault();event.stopPropagation();editorAiMenuClose(ed,true);return;}
    if(['ArrowDown','ArrowUp'].includes(event.key)&&menu.contains(event.target)){event.preventDefault();const items=[...menu.querySelectorAll('button')],at=items.indexOf(event.target);items[(at+(event.key==='ArrowDown'?1:items.length-1))%items.length]?.focus();}
    if(event.key==='Tab')editorAiMenuClose(ed);},true);
  root.addEventListener('keydown',event=>{if(event.target.id==='editor-ai-instruction'&&aiSendKey(event)&&ed.ai){event.preventDefault();runDesktop(()=>editorAiSend(ed))();}});
  // A picture pasted into the AI question goes with the question.
  root.addEventListener('paste',event=>{if(event.target.id!=='editor-ai-instruction'||!ed.ai||ed.ai.mode!=='ask')return;const files=[...(event.clipboardData?.items||[])].filter(i=>i.kind==='file'&&i.type.startsWith('image/')).map(i=>i.getAsFile()).filter(Boolean);if(!files.length)return;event.preventDefault();runDesktop(()=>editorAiAddImages(ed,files))();});
}
function mountNoteEditor(root,key,{memo=false,inWindow=false}={}){
  const doc=root.ownerDocument,win=doc.defaultView,ed={key,root,memo,inWindow,doc,win,live:null,ai:null};
  ed.area=()=>root.querySelector('#note-editor');
  ed.preview=()=>{const area=ed.area(),out=root.querySelector('.note-editor-preview');if(area&&out)out.innerHTML=area.value.trim()?renderNote(area.value):`<p class="muted">${tr('미리보기')}</p>`;};
  ed.startLive=()=>{
    ed.stopLive();const area=ed.area(),box=root.querySelector('.md-live');if(!area||!box||!globalThis.appLiveEditor)return;
    const keys=['bold','italic','link','math'].map(name=>({key:name==='math'?'Mod-Shift-m':{bold:'Mod-b',italic:'Mod-i',link:'Mod-k'}[name],run:()=>{ed.live.apply(MD_ACTIONS[name]);return true;}}));
    ed.live=appLiveEditor.create(box,{doc:area.value,renderMath:mathHtml,imageUrl:noteImageUrl,icons:{figure:FIGURE_ICON,ai:AI_ICON,link:LINK_ICON},keys,
      onChange:text=>{area.value=text;area.dispatchEvent(new win.Event('input',{bubbles:true}));},onCursor:view=>win.requestAnimationFrame(()=>peekLive(view))});
    // An empty memo is ready to type in; otherwise the cursor goes where the user clicks (all rendered until then).
    if(!area.value.trim())ed.live.focusEnd();
  };
  ed.stopLive=()=>{ed.live?.destroy();ed.live=null;const box=root.querySelector('.md-live');if(box)box.textContent='';};
  ed.edit=change=>{
    if(ed.live&&root.querySelector('.note-editor-body')?.dataset.view==='live'){ed.live.apply(change);return;}
    const area=ed.area();if(!area)return;const {selectionStart:a,selectionEnd:b,value}=area,picked=value.slice(a,b);
    const r=change(value,a,b,picked);area.focus();area.setRangeText(r.text,r.from??a,r.to??b,'end');if(r.select)area.setSelectionRange(r.select[0],r.select[1]);
    area.dispatchEvent(new win.Event('input',{bubbles:true}));
  };
  // Text changed elsewhere (the side panel, another window, AI) shows here.
  ed.setText=value=>{const area=ed.area();if(area&&area.value!==value)area.value=value;if(ed.live&&ed.live.getDoc()!==value)ed.live.setDoc(value);ed.preview();};
  ed.setView=view=>{
    const body=root.querySelector('.note-editor-body');body.dataset.view=view;if(view==='live')ed.startLive();else{ed.stopLive();ed.preview();}
    for(const b of root.querySelectorAll('[data-md-view]')){const on=b.dataset.mdView===view;b.classList.toggle('active',on);b.setAttribute('aria-checked',String(on));}
    try{localStorage.setItem('app-note-view',view);}catch{}
  };
  ed.destroy=()=>{editorAiClose(ed);ed.stopLive();hideMathPeek();};
  let previewTimer=null;
  root.addEventListener('click',event=>{
    const tool=event.target.closest('[data-md]');if(tool){ed.edit(MD_ACTIONS[tool.dataset.md]);return;}
    const view=event.target.closest('[data-md-view]');if(view){ed.setView(view.dataset.mdView);return;}
    if(event.target.closest('[data-editor-ai]')){editorAiToggle(ed);return;}
    if(event.target.closest('[data-editor-window]')){const k=ed.key;dialog.close();openMemoWindow(k);return;}
    editorAiClick(ed,event);
    // In a window the app's link handlers do not hear the rendering's links: web links open outside,
    // page references move the reader.
    const link=ed.inWindow&&event.target.closest('a');if(link){event.preventDefault();
      if(link.dataset.externalLink!==undefined){window.appApi.openPdfLink(link.href).catch(error=>toast(plainError(error)));return;}
      const page=Number(link.dataset.annotationPage);if(page&&Number(ed.key.split('-')[0])===state.selected){window.focus();goToPage(page);}}
  });
  root.addEventListener('keydown',event=>{
    if(event.target.id!=='note-editor'||!(event.ctrlKey||event.metaKey))return;const k=event.key.toLowerCase();
    const name=event.shiftKey&&k==='m'?'math':!event.shiftKey&&{b:'bold',i:'italic',k:'link'}[k];if(!name)return;event.preventDefault();ed.edit(MD_ACTIONS[name]);
  });
  root.addEventListener('input',event=>{if(event.target.id==='note-editor'){win.clearTimeout(previewTimer);previewTimer=win.setTimeout(ed.preview,120);}});
  bindEditorAi(ed);
  root.addEventListener('paste',event=>{const host=event.target.closest?.('.md-live,#note-editor');if(host)pasteNoteImage(event,ed.live&&host.closest('.md-live')?ed.live:null,host.closest('textarea'));},true);
  // The formula under the cursor, rendered below it, while typing in the source or the live view.
  for(const type of ['input','click','keyup'])root.addEventListener(type,event=>{if(event.target.id==='note-editor')showMathPeek(event.target);});
  for(const type of ['keyup','pointerup'])root.addEventListener(type,event=>{if(ed.live&&event.target.closest?.('.md-live'))win.requestAnimationFrame(()=>peekLive(ed.live.view));});
  root.addEventListener('focusout',()=>win.setTimeout(()=>{if(!root.contains(doc.activeElement))hideMathPeek();}));
  ed.preview();
  if(root.querySelector('.note-editor-body').dataset.view==='live')ed.startLive();else{const area=ed.area();area.focus();area.setSelectionRange(area.value.length,area.value.length);}
  return ed;
}
// The wide editor in the app's dialog; a memo (not a summary field) also gets its title field.
function openNoteEditor(key,label,memo=key.includes('-메모')&&!key.includes('#'),ai=null){ // i18n:keep — stored memo keys
  if(!key)return;if(memo)label=memoTitle(key,Math.max(0,memoKeysOf(Number(key.split('-')[0])).indexOf(key)));
  modal(esc(label||tr('메모')),noteEditorHtml(key,memo,savedNoteView()),btn(tr('닫기'),'close','primary'));
  dialog.classList.add('note-editor-dialog');
  try{const size=JSON.parse(localStorage.getItem('app-note-editor-size')||'null');if(size?.w>=480)dialog.style.width=Math.min(size.w,innerWidth-24)+'px';if(size?.h>=320)dialog.style.height=Math.min(size.h,innerHeight-24)+'px';}catch{}
  if(!dialog.noteEditorWatch){dialog.noteEditorWatch=new ResizeObserver(()=>{if(noteEditor&&dialog.open)try{const r=dialog.getBoundingClientRect();localStorage.setItem('app-note-editor-size',JSON.stringify({w:Math.round(r.width),h:Math.round(r.height)}));}catch{}});dialog.noteEditorWatch.observe(dialog);}
  noteEditor=mountNoteEditor(dialog.querySelector('.dialog-inner'),key,{memo});
  if(ai)editorAiToggle(noteEditor,ai.selection??null);
}
dialog.addEventListener('close',()=>{if(!noteEditor)return;const ed=noteEditor,{key}=ed;noteEditor=null;ed.destroy();dialog.classList.remove('note-editor-dialog');dialog.style.height='';dialog.style.width='';
  // The sidebar shows what was written in the wide editor.
  for(const area of document.querySelectorAll('.note-box textarea'))if(area.dataset.note===key){area.value=notes[key]||'';liveFields.get(area)?.setDoc(area.value);}refreshMemos();runDesktop(desktopNotes)();});
// A mark put around the selection (Ctrl+B, Ctrl+I, the format bar), as one undo step:
// - the spaces at the selection's ends stay outside the markers (a word picked with the space after it reads **word** , not **word **);
// - a selection over several lines is marked line by line (a mark does not cross lines);
// - pressed again on marked text (the markers just outside the selection, or the selection's own ends) it comes off;
// - nothing picked, or only spaces: the markers with a hint between them, the hint selected to type over.
// A * or _ is taken as italic only where its run is odd (*, ***), so italic on **bold** adds one and bold on ***x*** takes two.
const wrap=(left,right=left,hint='')=>(v,a,b,picked)=>{
  const c=left[0],paired=left===right&&/^[*_]+$/.test(left);
  const holds=n=>paired?n>=left.length&&(left.length===2||n%2===1):n===left.length;
  const runIn=(t,back)=>{let n=0;while(n<t.length&&t[back?t.length-1-n:n]===c)n++;return n;};
  const marked=t=>paired?(L=>{const R=runIn(t,true);return L+R<t.length&&holds(L)&&holds(R);})(runIn(t,false)):t.length>left.length+right.length&&t.startsWith(left)&&t.endsWith(right);
  const unmark=t=>t.slice(left.length,t.length-right.length);
  const ends=t=>{const m=t.match(/^(\s*)([\s\S]*?)(\s*)$/);return [m[1],m[2],m[3]];};
  if(picked.includes('\n')&&left!=='`'){
    const lines=picked.split('\n').map(ends),on=lines.some(l=>l[1])&&lines.filter(l=>l[1]).every(l=>marked(l[1]));
    const text=lines.map(([l,t,r])=>t?l+(on?unmark(t):left+t+right)+r:l+r).join('\n');
    return {text,select:[a,a+text.length]};
  }
  const [lead,core,trail]=ends(picked),at=a+lead.length,to=at+core.length;
  if(!core)return {text:picked+left+hint+right,select:[b+left.length,b+left.length+hint.length]};
  const before=paired?runIn(v.slice(0,at),true):v.slice(at-left.length,at)===left?left.length:0,after=paired?runIn(v.slice(to),false):v.slice(to,to+right.length)===right?right.length:0;
  if(!lead&&!trail&&holds(before)&&holds(after))return {text:core,from:at-left.length,to:to+right.length,select:[at-left.length,at-left.length+core.length]};
  if(marked(core)){const inner=unmark(core);return {text:lead+inner+trail,select:[at,at+inner.length]};}
  return {text:lead+left+core+right+trail,select:[at+left.length,at+left.length+core.length]};
};
// Line marks act on every line of the selection (or the line the cursor is in).
const lines=prefix=>(v,a,b)=>{const from=v.lastIndexOf('\n',a-1)+1,toEnd=v.indexOf('\n',b),to=toEnd<0?v.length:toEnd,block=v.slice(from,to);
  const all=block.split('\n'),on=all.every(l=>l.startsWith(typeof prefix==='function'?prefix(0):prefix));
  const text=all.map((l,i)=>{const p=typeof prefix==='function'?prefix(i):prefix;return on?l.slice(p.length):p+l;}).join('\n');return {text,from,to,select:[from,from+text.length]};};
const insertBlock=block=>(v,a)=>{const before=a&&v[a-1]!=='\n'?'\n\n':'',text=before+block+'\n';return {text,select:[a+before.length+block.length,a+before.length+block.length]};};
const MD_ACTIONS={
  heading:lines('## '),bold:wrap('**','**',tr('굵게')),italic:wrap('*','*',tr('기울임')),strike:wrap('~~','~~',tr('취소',null,'strikethrough')),mark:wrap('==','==',tr('형광')),
  bullet:lines('- '),number:lines(i=>`${i+1}. `),task:lines('- [ ] '),quote:lines('> '),
  code:(v,a,b,picked)=>picked.includes('\n')?{text:'```\n'+picked+'\n```'}:wrap('`','`',tr('코드'))(v,a,b,picked),
  link:(v,a,b,picked)=>{const label=picked||tr('링크'),text=`[${label}](https://)`;return {text,select:[a+label.length+3,a+label.length+11]};},
  math:wrap('$','$','x^2'),mathBlock:(v,a,b,picked)=>{const inner=picked||'\\frac{a}{b}',before=a&&v[a-1]!=='\n'?'\n':'';return {text:`${before}$$\n${inner}\n$$\n`,select:[a+before.length+3,a+before.length+3+inner.length]};},
  table:insertBlock(tr('| 항목 | 내용 |')+'\n| --- | --- |\n|  |  |'),rule:insertBlock('---'),
};
// ---- Math preview while typing: the formula under the cursor, rendered below it ----
function mathAt(value,pos){
  // A $$ block around the cursor.
  let open=-1;for(let at=value.indexOf('$$');at>=0&&at<pos;at=value.indexOf('$$',at+2))open=open<0?at:-1;
  if(open>=0){const close=value.indexOf('$$',Math.max(pos,open+2));return {tex:value.slice(open+2,close<0?value.length:close).trim(),display:true};}
  const from=value.lastIndexOf('\n',pos-1)+1,toEnd=value.indexOf('\n',pos),line=value.slice(from,toEnd<0?value.length:toEnd),at=pos-from;
  let start=-1;for(let k=0;k<line.length;k++){if(line[k]==='\\'){k++;continue;}if(line[k]!=='$'||line[k+1]==='$'||line[k-1]==='$')continue;if(start<0){if(k<at)start=k;else break;}else{if(k>=at-1)return k>start+1?{tex:line.slice(start+1,k),display:false}:null;start=-1;}}
  return start>=0&&at>start?{tex:line.slice(start+1),display:false}:null;
}
// Where the cursor is on screen: a hidden copy of the field with the same wrapping.
function caretPoint(area,pos){
  const doc=area.ownerDocument,style=doc.defaultView.getComputedStyle(area),copy=doc.createElement('div');
  for(const p of ['boxSizing','width','fontFamily','fontSize','fontWeight','lineHeight','letterSpacing','paddingTop','paddingRight','paddingBottom','paddingLeft','borderTopWidth','borderRightWidth','borderBottomWidth','borderLeftWidth','tabSize','wordSpacing'])copy.style[p]=style[p];
  Object.assign(copy.style,{position:'absolute',visibility:'hidden',whiteSpace:'pre-wrap',overflowWrap:'break-word',top:'0',left:'-9999px'});
  copy.textContent=area.value.slice(0,pos);const mark=doc.createElement('span');mark.textContent='​';copy.append(mark);doc.body.append(copy);
  const r=area.getBoundingClientRect(),top=r.top+mark.offsetTop-area.scrollTop,left=r.left+mark.offsetLeft-area.scrollLeft,height=parseFloat(style.lineHeight)||parseFloat(style.fontSize)*1.4;copy.remove();
  return {left:Math.max(r.left,Math.min(left,r.right)),top:Math.min(top,r.bottom-height),height};
}
let mathPeek=null;
function hideMathPeek(){mathPeek?.remove();mathPeek=null;}
function showMathPeek(area){
  if(area.selectionStart!==area.selectionEnd){hideMathPeek();return;}peekAgain={host:area,run:()=>showMathPeek(area)};
  peekMath(area.value,area.selectionStart,area,()=>caretPoint(area,area.selectionStart));
}
// The live view: the same preview under the cursor while it is in a formula's source.
function peekLive(view,tries=0){
  const {from,to}=view.state.selection.main;if(from!==to){hideMathPeek();return;}
  // Right after a click the editor may not have the focus yet: look again shortly (leaving it closes the preview anyway).
  if(!view.hasFocus){if(tries<3)setTimeout(()=>peekLive(view,tries+1),60);return;}
  peekAgain={host:view.dom,run:()=>peekLive(view)};
  // The position is read in the editor's own measure step (right after a move it may not be laid out yet; then once more).
  view.requestMeasure({key:'app-math-peek',read:()=>from<=view.state.doc.length&&view.state.selection.main.from===from?view.coordsAtPos(from):null,write:c=>{if(view.state.selection.main.from!==from)return;if(!c&&tries<3){setTimeout(()=>peekLive(view,tries+1),60);return;}peekMath(view.state.doc.toString(),from,view.dom,()=>c?{left:c.left,top:c.top,height:c.bottom-c.top}:null);}});
}
function peekMath(value,pos,host,where){
  if(typeof katex==='undefined'){hideMathPeek();return;}
  const found=mathAt(value,pos);if(!found?.tex.trim()){hideMathPeek();return;}
  const doc=host.ownerDocument;if(mathPeek&&mathPeek.ownerDocument!==doc)hideMathPeek();
  mathPeek||=Object.assign(doc.createElement('div'),{className:'math-peek'});mathPeek.setAttribute('role','status');if(!mathPeek.isConnected)(host.closest('dialog')||doc.body).append(mathPeek);
  try{mathPeek.innerHTML=katex.renderToString(found.tex,{displayMode:found.display,throwOnError:false,trust:false,strict:'ignore',maxSize:50,maxExpand:500});}catch{mathPeek.textContent=found.tex;}
  const at=where();if(!at){hideMathPeek();return;}const w=mathPeek.offsetWidth;
  Object.assign(mathPeek.style,{left:`${Math.max(8,Math.min(at.left,doc.defaultView.innerWidth-w-8))}px`,top:`${at.top+at.height+4}px`});
}
const MATH_FIELDS='.note-box textarea';
for(const type of ['input','click','keyup'])document.addEventListener(type,event=>{if(event.target.matches?.(MATH_FIELDS))showMathPeek(event.target);});
document.addEventListener('focusout',event=>{if(event.target.matches?.(MATH_FIELDS))setTimeout(()=>{if(!document.activeElement?.matches?.(MATH_FIELDS))hideMathPeek();});});
// While the field being typed in keeps the focus, a scroll (of it or the panel around it) moves the preview with it.
let peekAgain=null;
document.addEventListener('scroll',()=>{if(mathPeek&&peekAgain?.host.isConnected&&peekAgain.host.contains(document.activeElement))requestAnimationFrame(peekAgain.run);else hideMathPeek();},true);
document.addEventListener('focusout',event=>{if(event.target.closest?.('.md-live'))setTimeout(()=>{if(!document.activeElement?.closest?.('.md-live'))hideMathPeek();});});

// ---- The side panel's fields are live too: the memo and summary fields render math, pictures and
// marks in place (the same editor as the wide one). Each keeps its textarea, hidden, as the saved
// source, so saving and the features that add text to a memo work as before.
const liveFields=new Map();
let fieldSync=false;
function liveKeys(get){const key=name=>({key:name==='math'?'Mod-Shift-m':{bold:'Mod-b',italic:'Mod-i',link:'Mod-k'}[name],run:()=>{get().apply(MD_ACTIONS[name]);return true;}});return ['bold','italic','link','math'].map(key);}
function mountLiveField(area){
  if(!globalThis.appLiveEditor)return;
  const host=document.createElement('div');host.className='md-live field-live';if(area.style.height)host.style.height=area.style.height;area.after(host);
  area.classList.add('live-source');area.tabIndex=-1;area.setAttribute('aria-hidden','true');
  let editor=null;
  editor=appLiveEditor.create(host,{doc:area.value,placeholder:area.getAttribute('placeholder')||'',renderMath:mathHtml,imageUrl:noteImageUrl,icons:{figure:FIGURE_ICON,ai:AI_ICON,link:LINK_ICON},keys:liveKeys(()=>editor),
    onChange:text=>{fieldSync=true;try{area.value=text;area.dispatchEvent(new Event('input',{bubbles:true}));}finally{fieldSync=false;}},onCursor:view=>requestAnimationFrame(()=>peekLive(view))});
  editor.view.contentDOM.setAttribute('aria-label',area.getAttribute('aria-label')||tr('메모'));
  liveFields.set(area,editor);
}
function syncLiveFields(){
  for(const [area,editor] of liveFields)if(!area.isConnected){editor.destroy();liveFields.delete(area);}
  for(const area of document.querySelectorAll('.note-box textarea:not(.live-source)'))mountLiveField(area);
}
new MutationObserver(()=>queueMicrotask(syncLiveFields)).observe(document.body,{childList:true,subtree:true});
// Text set on the textarea by something else (another view, a test, a restored memo) shows in its editor.
document.addEventListener('input',event=>{const editor=liveFields.get(event.target);if(editor&&!fieldSync)editor.setDoc(event.target.value);});
// Before typing, the editor takes in anything added to the memo meanwhile (AI results, collected annotations).
document.addEventListener('focusin',event=>{const host=event.target.closest?.('.field-live');if(!host)return;const area=host.previousElementSibling,editor=liveFields.get(area);if(!editor)return;if(area.dataset.note===undefined)return;const fresh=notes[area.dataset.note]??'';if(fresh!==editor.getDoc()){area.value=fresh;editor.setDoc(fresh);}});
const fieldEditorOf=area=>liveFields.get(area);
function focusNote(){const area=document.querySelector('#note');const editor=area&&liveFields.get(area);if(editor)editor.focusEnd();else area?.focus();}
// Keys and clicks in a live editor also refresh the formula preview (the cursor may land in a formula).
const liveViewOf=node=>{const host=node.closest?.('.field-live');return host?liveFields.get(host.previousElementSibling)?.view||null:null;};
for(const type of ['keyup','pointerup'])document.addEventListener(type,event=>{const view=liveViewOf(event.target);if(view)requestAnimationFrame(()=>peekLive(view));});

// ---- Pictures from the clipboard: a pasted image is saved in the vault (.<id>/note-images,
// named by its content, so pasting the same picture twice keeps one file) and added to the memo.
// Any picture format becomes PNG, at most 2000 px on its longer side.
// The clipboard is readable only while the paste event runs: the file is taken then, converted after.
const clipboardImageFile=event=>[...(event.clipboardData?.items||[])].find(i=>i.kind==='file'&&i.type.startsWith('image/'))?.getAsFile()||null;
async function pngOf(file){
  if(!file)return null;
  const bitmap=await createImageBitmap(file),k=Math.min(1,2000/Math.max(bitmap.width,bitmap.height)),canvas=document.createElement('canvas');
  canvas.width=Math.max(1,Math.round(bitmap.width*k));canvas.height=Math.max(1,Math.round(bitmap.height*k));canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close?.();
  return {dataUrl:canvas.toDataURL('image/png'),width:canvas.width,height:canvas.height};
}
const pictureLine=(v,a)=>name=>({text:`${a&&v[a-1]!=='\n'?'\n':''}![${memoLabels().memoLabel('pastedPicture',memoLanguage())}](note-image:${name})\n`});
// A picture pasted into a live editor (or a source textarea) goes in where the cursor is.
function pasteNoteImage(event,editor,field){
  const file=clipboardImageFile(event);if(!file)return;event.preventDefault();event.stopPropagation();const id=state.storageKey;
  runDesktop(async()=>{
    const png=await pngOf(file);if(!png)return;const name=await window.appApi.saveNoteImage(id,png.dataUrl);if(state.storageKey!==id)return;
    if(editor)editor.apply((v,a)=>pictureLine(v,a)(name));
    else if(field){const a=field.selectionStart,r=pictureLine(field.value,a)(name);field.setRangeText(r.text,a,field.selectionEnd,'end');field.dispatchEvent(new field.ownerDocument.defaultView.Event('input',{bubbles:true}));}
    toast(tr('그림을 메모에 넣었습니다.'));
  })();
}
// The side panel's fields; the wide editors listen for themselves.
document.addEventListener('paste',event=>{
  const host=event.target.closest?.('.field-live,.note-box textarea');if(!host)return;
  const view=liveViewOf(event.target);pasteNoteImage(event,view&&[...liveFields.values()].find(e=>e.view===view),view?null:event.target.closest('textarea'));
},true);
// Esc in an open memo folds it.
document.addEventListener('keydown',event=>{if(event.key!=='Escape'||dialog.open)return;const card=event.target.closest?.('.memo-card.open[data-memo]');if(!card||event.target.closest('.memo-title'))return;event.preventDefault();openMemoKey=null;refreshMemos();});

// The pin link: to the memo's pin, on its file's page (the original shown) or its notebook's page, with the pin in view.
const pinWait=(test,ms=6000)=>new Promise(resolve=>{const start=performance.now();const look=()=>{const found=test();if(found||performance.now()-start>ms)resolve(found||null);else setTimeout(look,80);};look();});
function showPin(pin){scrollWithin(pin,{block:'center'});}
async function goToMemoPin(key){
  let place=null;try{place=JSON.parse(notes[key+MEMO_PIN]||'null');}catch{}if(!place){toast(tr('이 메모에는 핀이 없습니다.'));return;}
  const paperId=Number(key.split('-')[0]),vault=state.storageKey;
  if(place.notebookId){if(paperId!==state.selected)await openItemFile(paperId,state.selectedAttachment);if(state.storageKey===vault)await nbGoToPin(place,key);return;}
  const paper=papers.find(p=>p.id===paperId);if(!paper?.attachments.some(a=>a.id===place.attachmentId)){toast(tr('핀이 꽂힌 파일을 찾을 수 없습니다.'));return;}
  if(paperId!==state.selected||place.attachmentId!==state.selectedAttachment)await openItemFile(paperId,place.attachmentId);
  if(state.storageKey!==vault)return;
  // The pin is on the original: a view that hides it shows both.
  if(state.screen==='reader'&&state.mode==='translated'){state.mode=translationRecord?.key===targetKey()?'dual':'original';render();}
  const viewer=await pinWait(()=>{const c=document.querySelector('.original-pages');return c?.pdfViewer?.pagesCount>=place.page?c:null;});if(!viewer)return;
  goToPage(place.page);showPin(await pinWait(()=>document.querySelector(`.original-pages [data-memo-pin-open="${CSS.escape(key)}"]`)));
}
document.addEventListener('click',event=>{const go=event.target.closest?.('[data-memo-pin-go]');if(!go)return;event.preventDefault();event.stopPropagation();runDesktop(()=>goToMemoPin(go.dataset.memoPinGo))();},true);

// ---- 주석 tab: records tied to a place in the paper (annotations, 그림 설명, AI 선택 설명), shown and
// written like memos: a card with its title and one line until chosen; the chosen one opens with a title
// field and the same live Markdown editor. They are saved as annotations (library.json), not as notes:
// a typing pause saves the text, and leaving the field or the app saves at once.
let openAnnotationId=null;
const annotationSaves=new Map();
const ANNOT_KINDS={figure:[tr('그림 설명',null,'kind'),FIGURE_ICON],explain:[tr('AI 선택 설명'),AI_ICON]};
// A title of the reader's own; the kind shows as the card's icon, so a stored title that only repeats
// the kind and page ("그림 설명 · 3쪽", as earlier saves wrote it) counts as none.
const ownAnnotationTitle=a=>{const t=a.title?.trim()||'';return memoLabels().isAutoTitle(t)?'':t;};
function annotationTitle(a){return ownAnnotationTitle(a)||tr('{n}쪽',{n:a.page});}
function annotationCard(a,stale){
  const open=a.id===openAnnotationId,title=annotationTitle(a),[kind,glyph]=ANNOT_KINDS[a.kind]||[tr('주석',null,'annotation body'),''];
  // One icon: the kind (그림 설명 · AI 선택 설명 · 주석), which is also the way to its page.
  const page=`<button type="button" class="memo-source annot-page" data-annotation-page="${a.page}" title="${tr('{kind} · {page}쪽으로 이동',{kind:esc(kind),page:a.page})}" aria-label="${tr('{kind}, {page}쪽으로 이동',{kind:esc(kind),page:a.page})}">${glyph||icon('annotate')}</button>`;
  const trash=`<button type="button" class="row-more" data-delete-annotation="${esc(a.id)}" title="${tr('삭제')}" aria-label="${tr('{name} 삭제',{name:esc(title)})}">${icon('trash')}</button>`,wide=`<button type="button" class="row-more" data-edit-annotation="${esc(a.id)}" title="${tr('넓게 편집')}" aria-label="${tr('{name} 넓게 편집',{name:esc(title)})}">${icon('expand')}</button>`,ai=`<button type="button" class="row-more memo-ai-button" data-annot-ai="${esc(a.id)}" title="${tr('AI에게 묻기 · 고치기')}" aria-label="${tr('{name} AI에게 묻기 또는 고치기',{name:esc(title)})}">${icon('memoAi')}</button>`;
  const warn=stale?`<span class="pill amber" title="${tr('주석을 단 뒤 원문 파일이 바뀌었습니다')}">${tr('위치 확인 필요')}</span>`:'';
  const made=a.createdAt?new Date(a.createdAt):null,date=made?`<small class="muted" title="${esc(made.toLocaleString(appI18n.uiLocale()))}${a.model?' · '+esc(a.model):''}">${made.toLocaleDateString(appI18n.uiLocale())}</small>`:'';
  const quote=a.quote?`<blockquote class="annot-quote">${esc(a.quote)}</blockquote>`:'';
  if(open)return `<article class="memo-card annot annotation open" data-annotation-card="${esc(a.id)}"><header class="memo-card-head">${page}<input class="memo-title annot-title" data-annot-title="${esc(a.id)}" value="${esc(ownAnnotationTitle(a))}" placeholder="${tr('{name} — 제목',{name:esc(title)})}" maxlength="200" aria-label="${tr('주석 제목')}">${warn}<span class="memo-actions"><button type="button" class="row-more" data-annot-fold title="${tr('접기 (Esc)')}" aria-label="${tr('{name} 접기',{name:esc(title)})}">${icon('memoFold')}</button>${ai}${wide}${trash}</span></header>${quote}<div class="note-box resize-only" data-kn-part="note"><textarea data-annot-body="${esc(a.id)}" placeholder="${tr('본문 — Markdown과 $수식$을 쓸 수 있습니다')}" aria-label="${esc(title)}">${esc(a.body)}</textarea></div><p class="small muted annot-status" role="status" aria-live="polite"></p></article>`;
  const glance=memoGlance(a.body),line=glance.line?renderNote(glance.line):'';
  return `<article class="memo-card annot annotation" data-annotation-card="${esc(a.id)}" tabindex="0" role="button" aria-label="${tr('{name} 열기',{name:esc(title)})}"${a.quote?` title="“${esc(a.quote.slice(0,300))}”"`:''}><header class="memo-card-head">${page}<strong class="${ownAnnotationTitle(a)?'':'untitled'}">${esc(title)}</strong>${warn}${date}<span class="memo-actions">${ai}${wide}${trash}</span></header><div class="memo-glance">${glance.image?`<img class="memo-thumb" src="${esc(noteImageUrl(glance.image))}" alt="" loading="lazy">`:''}<div class="memo-line md">${line||`<p class="muted">${glance.image?tr('그림'):tr('비어 있음')}</p>`}</div></div></article>`;
}
annotationsPanel=function(paper){
  const attachment=activeAttachment(paper),hash=annotationHashes.get(targetKey());
  const list=itemAnnotations.filter(a=>a.paperId===paper.id&&a.attachmentId===attachment?.id).sort((a,b)=>a.page-b.page||String(a.createdAt).localeCompare(String(b.createdAt)));
  if(openAnnotationId&&!list.some(a=>a.id===openAnnotationId))openAnnotationId=null;
  const counts=['figure','explain'].map(k=>[k,list.filter(a=>a.kind===k).length]).filter(([,n])=>n).map(([k,n])=>`${ANNOT_KINDS[k][0]} ${n}`).join(' · ');
  return `<div class="memo-tab annot-tab"><div class="memo-head"><span class="small muted" title="${tr('본문의 자리에 연결된 기록: 주석, 그림 설명, AI 선택 설명')}">${tr('주석 {n}개',{n:list.length})}${counts?` <span class="annot-counts">(${counts})</span>`:''}</span><span class="annot-tools">${markToggle('toggle-figure-boxes',tr('그림 영역 상자 표시'),'figure','figureBoxes')}${markToggle('toggle-annotation-underlines',tr('주석 밑줄 표시'),'annotate','annotationUnderlines')}<button class="secondary small" data-action="collect-annotations" title="${tr('이 자료의 주석을 메모 하나에 모읍니다')}">${tr('모아 보기')}</button></span></div><div class="memo-list">${list.length?list.map(a=>annotationCard(a,hash&&hash!==a.sourceHash)).join(''):`<p class="small muted">${tr('주석이 없습니다. 원문에서 글을 골라 <strong>주석 추가</strong>를 누르거나, 그림 설명·AI 선택 설명을 하면 여기에 남습니다.')}</p>`}</div></div>`;
};
function refreshAnnotations(){const tab=document.querySelector('.annot-tab'),p=selected();if(tab&&p)tab.outerHTML=annotationsPanel(p);}
function annotationStatus(id,text){const node=document.querySelector(`[data-annotation-card="${CSS.escape(id)}"] .annot-status`);if(node)node.textContent=text;}
// One pending save per annotation: the latest text and title wait for a pause in typing.
function queueAnnotationSave(id,patch,now=false){
  const entry=annotationSaves.get(id)||{patch:{}};Object.assign(entry.patch,patch);clearTimeout(entry.timer);annotationSaves.set(id,entry);
  entry.vault=state.storageKey;entry.timer=setTimeout(()=>flushAnnotation(id).catch(()=>{}),now?0:700);annotationStatus(id,tr('저장 중…'));
}
async function flushAnnotation(id){
  const entry=annotationSaves.get(id);if(!entry)return;clearTimeout(entry.timer);annotationSaves.delete(id);
  const patch={...entry.patch};if(patch.body!==undefined&&!patch.body.trim()){delete patch.body;annotationStatus(id,tr('본문이 비어 있으면 저장하지 않습니다. 지우려면 휴지통을 누르세요.'));}
  if(patch.body===undefined&&patch.title===undefined)return;
  try{await window.appApi.editAnnotation(entry.vault,id,patch);const a=itemAnnotations.find(x=>x.id===id);if(a&&entry.vault===state.storageKey){if(patch.body!==undefined)a.body=patch.body;if(patch.title!==undefined){if(patch.title.trim())a.title=patch.title.trim();else delete a.title;}}annotationStatus(id,tr('✓ 저장됨'));}
  catch(error){annotationStatus(id,tr('저장 실패: {error}',{error:plainError(error)}));throw error;}
}
const flushAnnotations=()=>Promise.all([...annotationSaves.keys()].map(id=>flushAnnotation(id).catch(()=>{})));
{const before=globalThis.appFlushAll;globalThis.appFlushAll=async()=>{await flushAnnotations();await before?.();};}
document.addEventListener('input',event=>{
  const body=event.target.closest?.('[data-annot-body]');if(body){queueAnnotationSave(body.dataset.annotBody,{body:body.value});return;}
  const title=event.target.closest?.('[data-annot-title]');if(title)queueAnnotationSave(title.dataset.annotTitle,{title:title.value});
});
document.addEventListener('focusout',event=>{const field=event.target.closest?.('[data-annotation-card]');if(field&&annotationSaves.has(field.dataset.annotationCard)&&!field.contains(event.relatedTarget))flushAnnotation(field.dataset.annotationCard).catch(()=>{});});
function openAnnotation(id){
  if(openAnnotationId&&openAnnotationId!==id)flushAnnotation(openAnnotationId).catch(()=>{});
  openAnnotationId=id;refreshAnnotations();
  if(id)requestAnimationFrame(()=>{const card=document.querySelector(`[data-annotation-card="${CSS.escape(id)}"]`);card?.scrollIntoView({block:'nearest'});syncLiveFields();const area=card?.querySelector('[data-annot-body]');const editor=area&&fieldEditorOf(area);if(editor)editor.focusEnd();else area?.focus();});
}
document.addEventListener('click',event=>{
  if(event.target.closest('[data-annot-fold]')){event.stopPropagation();openAnnotation(null);return;}
  const card=event.target.closest('.memo-card.annot:not(.open)');if(card&&!event.target.closest('a,input,button')){openAnnotation(card.dataset.annotationCard);return;}
});
document.addEventListener('keydown',event=>{
  if(event.key!=='Escape'||dialog.open)return;const card=event.target.closest?.('.memo-card.annot.open');if(!card||event.target.closest('.annot-title'))return;event.preventDefault();openAnnotation(null);
});
// ---- 주석의 넓게 편집과 AI ----
// An annotation opens in the memo's wide editor (title, toolbar, 소스·미리보기·라이브 views, AI
// 질문하기·고치기). The editor's field is pointed at the annotation, so typing saves as the card's
// own field does, and an AI answer is added under the text or replaces it, with one undo.
const ANNOT_EDITOR_KEY='annotation-editor'; // names the editor only; never a key in notes
let annotationEditor=null,annotAiSelection=null;
function setAnnotationBody(id,value){
  value=String(value).slice(0,20000);
  if(annotationEditor?.id===id)annotationEditor.ed.setText(value);
  for(const area of document.querySelectorAll('.note-box [data-annot-body]'))if(area.dataset.annotBody===id){area.value=value;liveFields.get(area)?.setDoc(value);}
  queueAnnotationSave(id,{body:value},true);
}
function annotationAiTarget(id,ed){
  const find=()=>itemAnnotations.find(a=>a.id===id),body=()=>ed.area()?.value??find()?.body??'';
  // The passage the annotation is on goes along with a question (as a selected passage does for a memo).
  const passage=()=>{const a=find(),quote=String(a?.quote||'').trim();return quote?{text:quote.slice(0,4000),page:a.page}:null;};
  return {what:tr('이 주석'),text:body,selection:passage,paperId:find()?.paperId??state.selected,section:(()=>{const a=find();return a?tr('주석 · {title}',{title:annotationTitle(a)}):tr('주석',null,'annotation body');})(),edit:true,editLabel:tr('주석 고치기'),addLabel:tr('주석에 추가',null,'this annotation'),
    take:(text,append)=>{
      if(!find()){toast(tr('주석을 찾을 수 없습니다. 지워졌을 수 있습니다.'));return false;}
      const before=body();setAnnotationBody(id,append&&before.trim()?`${before.replace(/\s+$/,'')}\n\n${text}`:text);
      undoToast(append?tr('AI 결과를 주석에 추가했습니다.'):tr('AI 결과로 주석을 바꿨습니다.'),()=>{if(find())setAnnotationBody(id,before);});
      return true;
    }};
}
function openAnnotationEditor(id,ai=null){
  const a=itemAnnotations.find(x=>x.id===id);if(!a)return;
  modal(esc(annotationTitle(a)),`<input class="memo-title editor-title" data-annot-title="${esc(id)}" value="${esc(ownAnnotationTitle(a))}" placeholder="${tr('제목')}" maxlength="200" aria-label="${tr('주석 제목')}">${a.quote?`<blockquote class="annot-quote">${esc(a.quote)}</blockquote>`:''}${noteEditorHtml(ANNOT_EDITOR_KEY,false,savedNoteView(),true)}`,btn(tr('닫기'),'close','primary'));
  dialog.classList.add('note-editor-dialog','annotation-editor-dialog');
  try{const size=JSON.parse(localStorage.getItem('app-note-editor-size')||'null');if(size?.w>=480)dialog.style.width=Math.min(size.w,innerWidth-24)+'px';if(size?.h>=320)dialog.style.height=Math.min(size.h,innerHeight-24)+'px';}catch{}
  // The pending text of the card's own field goes first, then the editor shows what is saved or typed.
  const pending=annotationSaves.get(id)?.patch.body,root=dialog.querySelector('.dialog-inner'),area=root.querySelector('#note-editor');
  area.removeAttribute('data-note');area.dataset.annotBody=id;area.maxLength=20000;area.value=pending??a.body??'';
  const ed=mountNoteEditor(root,ANNOT_EDITOR_KEY,{memo:false});ed.aiTarget=annotationAiTarget(id,ed);annotationEditor={id,ed,root};
  if(ai)editorAiToggle(ed,ed.aiTarget.selection()||ai.selection||null);
}
dialog.addEventListener('close',()=>{
  // Chromium fires close with the next frame: one that comes while the open dialog still shows this editor
  // belongs to the modal before it (modal() always replaces the dialog's content).
  if(!annotationEditor||dialog.open&&dialog.contains(annotationEditor.root))return;const {id,ed}=annotationEditor;annotationEditor=null;ed.destroy();
  dialog.classList.remove('note-editor-dialog','annotation-editor-dialog');dialog.style.height='';dialog.style.width='';
  // The card shows what was written in the wide editor.
  flushAnnotation(id).catch(()=>{}).finally(()=>refreshAnnotations());
});
document.addEventListener('pointerdown',event=>{if(event.target.closest?.('[data-annot-ai]'))annotAiSelection=readerSelection();},true);
document.addEventListener('click',event=>{
  const ai=event.target.closest('[data-annot-ai]');
  if(ai){event.preventDefault();event.stopPropagation();const selection=annotAiSelection||readerSelection();annotAiSelection=null;openAnnotationEditor(ai.dataset.annotAi,{selection});return;}
  const wide=event.target.closest('[data-edit-annotation]');if(wide){event.preventDefault();event.stopPropagation();openAnnotationEditor(wide.dataset.editAnnotation);}
},true);
// Another way into an annotation (a pin on the page, a new 그림 설명) opens its card in the 주석 tab.
// {focus:true} (a 그림 설명 just saved): the cursor at its end, ready to type (under its picture, not on it).
globalThis.appShowAnnotation=(id,{focus=false}={})=>{openAnnotationId=id;showPanelTab('주석'); // i18n:keep — tab value
requestAnimationFrame(()=>{const card=document.querySelector(`[data-annotation-card="${CSS.escape(id)}"]`);card?.scrollIntoView({block:'nearest'});card?.classList.add('flash');setTimeout(()=>card?.classList.remove('flash'),1600);
  if(focus){syncLiveFields();const area=card?.querySelector('[data-annot-body]');fieldEditorOf(area)?.focusEnd();}});};
