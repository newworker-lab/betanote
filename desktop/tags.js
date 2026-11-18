// Tags: one list for the vault, each tag with an
// optional colour and its paper count. A tag made with + (or used once) stays,
// with no papers, until it is deleted. Its menu (right-click or ⋯) changes the
// colour, renames it (a name that exists merges the two) or deletes it from
// every paper; papers get tags by dragging them onto a tag or in the 태그 지정
// dialog, which shows a tag some of the chosen papers have as 일부.
let tagColors={},tagQuery='';
const baseApplyTags=applySnapshot;
applySnapshot=function(snapshot){tagColors=snapshot.tagColors||{};baseApplyTags(snapshot);};

// A colour is any #rrggbb; the palette only suggests. Chip text is darkened (lightened in the dark theme)
// until it reads against the chip, so a pale colour still gives legible text.
const TAG_PALETTE=[['#e5484d',tr('빨강')],['#f76b15',tr('주황')],['#d9a300',tr('노랑')],['#30a46c',tr('초록',null,'color')],['#12a594',tr('청록')],['#0588f0',tr('파랑')],['#8e4ec6',tr('보라')],['#d6409f',tr('분홍')],['#ad7f58',tr('갈색')],['#8b8d98',tr('회색')]];
const HEX_COLOR=/^#[0-9a-f]{6}$/;
function tagColor(tag){const color=Object.hasOwn(tagColors,tag)?String(tagColors[tag]).toLowerCase():'';return HEX_COLOR.test(color)?color:'';}
const tagInks=new Map();
function tagInk(color){
  if(tagInks.has(color))return tagInks.get(color);
  const rgb=[1,3,5].map(i=>parseInt(color.slice(i,i+2),16)),mix=(a,b,t)=>a.map((v,i)=>Math.round(v*t+b[i]*(1-t)));
  const lum=c=>{const [r,g,b]=c.map(v=>{v/=255;return v<=.03928?v/12.92:((v+.055)/1.055)**2.4;});return .2126*r+.7152*g+.0722*b;};
  const contrast=(a,b)=>{const [x,y]=[lum(a),lum(b)].sort((m,n)=>n-m);return (x+.05)/(y+.05);},hex=c=>'#'+c.map(v=>v.toString(16).padStart(2,'0')).join('');
  const ink=(surface,share,toward)=>{const bg=mix(rgb,surface,share);for(let t=1;t>0;t-=.05){const text=mix(rgb,toward,t);if(contrast(text,bg)>=4.5)return hex(text);}return hex(toward);};
  const inks={light:ink([255,255,255],.16,[0,0,0]),dark:ink([32,32,39],.3,[255,255,255])};tagInks.set(color,inks);return inks;
}
function tagStyle(color){if(!color)return '';const {light,dark}=tagInk(color);return ` style="--tag:${color};--tag-ink:${light};--tag-ink-dark:${dark}"`;}
// The tag's mark: a label shape in its colour (light grey with none).
const tagIcon=color=>`<svg class="tag-icon" data-color="${color}" viewBox="0 0 16 12" aria-hidden="true"${tagStyle(color)}><path d="M2.5 1h8.3L15 6l-4.2 5H2.5A1.5 1.5 0 0 1 1 9.5v-7A1.5 1.5 0 0 1 2.5 1z"/></svg>`;
function tagPill(tag,inner=esc(tag)){const color=tagColor(tag);return `<span class="pill ${color?'tag-pill':'gray'}" data-color="${color}"${tagStyle(color)}>${inner}</span>`;}
// A list row shows its first tags; the rest are one +N chip that opens 태그 지정.
function tagLine(paper,shown=3){const rest=paper.tags.slice(shown);return paper.tags.slice(0,shown).map(t=>tagPill(t)).join('')+(rest.length?`<button type="button" class="pill gray tag-more-pill" data-tag-assign="${paper.id}" title="${esc(rest.join(', '))}" aria-label="${tr('태그 {n}개 더 보기 · 태그 지정',{n:rest.length})}">+${rest.length}</button>`:'');}
function tagCounts(){const counts=new Map(Object.keys(tagColors).map(t=>[t,0]));for(const p of availablePapers())for(const t of p.tags)counts.set(t,(counts.get(t)||0)+1);return [...counts].sort((a,b)=>a[0].localeCompare(b[0],'ko'));}
const tagMatches=(tag,query)=>!query||tag.toLocaleLowerCase().includes(query.toLocaleLowerCase());
const sameTag=(a,b)=>a.trim().normalize('NFC')===b.trim().normalize('NFC');
const chosenPapers=()=>[...batchSelection].filter(id=>papers.some(p=>p.id===id));

// ---- Sidebar view (renderer.js): label · name · count rows, a search box once there are more than five ----
function tagRows(){
  const tags=tagCounts(),active=state.desktopTag;if(tags.length<=5)tagQuery='';const query=tagQuery.trim();
  const rows=tags.map(([t,n])=>`<div class="tag-row" data-tag-row="${esc(t)}" ${tagMatches(t,query)?'':'hidden'}><button class="nav-btn tag-item ${active===t?'active':''}" data-desktop-tag="${esc(t)}" data-tag-drop="${esc(t)}" title="${esc(t)} · ${tr('자료 {n}개',{n})}">${tagIcon(tagColor(t))}<span class="tag-name">${esc(t)}</span><span class="count">${n}</span></button><button type="button" class="tag-more" data-tag-menu="${esc(t)}" aria-label="${tr('{tag} 태그 메뉴',{tag:esc(t)})}" title="${tr('색 · 이름 변경 · 삭제')}">⋯</button></div>`).join('');
  return `${tags.length>5?`<input type="search" class="tag-search" id="tag-search" value="${esc(tagQuery)}" placeholder="${tr('태그 검색')}" aria-label="${tr('태그 검색')}" autocomplete="off">`:''}<div class="tag-list">${rows}${tags.length?`<p class="tag-empty small muted" ${tags.some(([t])=>tagMatches(t,query))?'hidden':''}>${tr('일치하는 태그가 없습니다.')}</p>`:`<p class="tag-empty small muted">${tr('+로 태그를 만들거나 자료에 태그를 추가하세요.')}</p>`}</div>`;
}
addSidebarView({id:'tags',title:tr('태그'),order:30,weight:1.2,
  badge:()=>`<span class="count">${tagCounts().length}</span>`,
  // Folded, the heading still names the tag being viewed.
  extra:open=>!open&&state.desktopTag?`<button type="button" class="tag-current" data-desktop-tag="${esc(state.desktopTag)}" title="${tr('보고 있는 태그')}">${tagIcon(tagColor(state.desktopTag))}${esc(state.desktopTag)}</button>`:'',
  actions:()=>`<button type="button" data-action="new-tag" aria-label="${tr('새 태그')}" title="${tr('새 태그')}">${icon('plus')}</button>`,
  body:tagRows,onOpen:()=>(document.querySelector('#tag-search')||document.querySelector('.tag-item'))?.focus()});
function filterTagList(){const query=tagQuery.trim();let shown=0;for(const row of document.querySelectorAll('[data-tag-row]')){const hit=tagMatches(row.dataset.tagRow,query);row.hidden=!hit;if(hit)shown++;}const empty=document.querySelector('.tag-empty');if(empty&&document.querySelector('[data-tag-row]'))empty.hidden=shown>0;}

// ---- The tag editor beside a paper: label · name chips, a suggestion list styled like the sidebar, 태그 지정 ----
function tagEditor(p){return `<section class="field tag-editor" data-tag-editor="${p.id}"><div class="row between"><label>${tr('태그')}</label><span class="tag-editor-tools"><button type="button" class="secondary small" data-tag-ai="${p.id}" title="${tr('이 자료의 앞부분을 AI에 보내 태그를 추천받습니다. 보내기 전에 확인합니다.')}">${tr('AI 추천')}</button><button type="button" class="secondary small" data-tag-assign="${p.id}">${tr('태그 지정')}</button></span></div><div class="tag-edit">${p.tags.map(t=>{const color=tagColor(t);return `<span class="tag-chip" data-color="${color}">${tagIcon(color)}<span class="tag-name">${esc(t)}</span><button type="button" data-remove-tag="${esc(t)}" aria-label="${tr('{tag} 태그 삭제',{tag:esc(t)})}">×</button></span>`;}).join('')}</div><form data-tag-form class="tag-add"><input aria-label="${tr('새 태그')}" name="tag" placeholder="${tr('태그 추가')}" maxlength="60" required autocomplete="off" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="tag-suggest-${p.id}"><button type="submit" class="secondary">${tr('추가')}</button><div class="tag-suggest" id="tag-suggest-${p.id}" role="listbox" aria-label="${tr('태그 추천')}" hidden></div></form></section>`;};
// The suggestions: the vault's tags this paper does not have yet, narrowed as you type, and a new name.
function suggestTags(input){
  const editor=input.closest('[data-tag-editor]'),list=editor?.querySelector('.tag-suggest'),paper=papers.find(p=>String(p.id)===editor?.dataset.tagEditor);if(!list||!paper)return;
  const query=input.value.trim(),all=tagCounts(),offered=all.filter(([t])=>!paper.tags.includes(t)&&tagMatches(t,query)).slice(0,60);
  const exists=all.some(([t])=>sameTag(t,query)),options=offered.map(([t,n])=>`<div role="option" class="tag-suggest-item" id="tag-option-${paper.id}-${encodeURIComponent(t).replace(/%/g,'_')}" data-suggest-tag="${esc(t)}" aria-selected="false">${tagIcon(tagColor(t))}<span class="tag-name">${esc(t)}</span><span class="count">${n}</span></div>`);
  if(query&&!exists)options.push(`<div role="option" class="tag-suggest-item tag-suggest-new" id="tag-option-${paper.id}-new" data-suggest-tag="${esc(query)}" aria-selected="false">${icon('plus')}<span class="tag-name">${tr('“{tag}” 새 태그로 추가',{tag:esc(query)})}</span></div>`);
  list.innerHTML=options.join('');list.hidden=!options.length;input.setAttribute('aria-expanded',String(!list.hidden));input.removeAttribute('aria-activedescendant');
}
function closeSuggest(input){const list=input?.closest('[data-tag-editor]')?.querySelector('.tag-suggest');if(list){list.hidden=true;list.innerHTML='';}input?.setAttribute('aria-expanded','false');input?.removeAttribute('aria-activedescendant');}
function pickSuggestion(input,tag){
  const editor=input.closest('[data-tag-editor]'),id=editor.dataset.tagEditor;closeSuggest(input);input.value='';
  editTags(editor,tags=>tags.includes(tag)?tags:[...tags,tag]);
  // Adding one keeps the box ready for the next.
  tagWrite.then(()=>{const next=document.querySelector(`[data-tag-editor="${id}"] [name="tag"]`);next?.focus();});
}
document.addEventListener('focusin',event=>{if(event.target.matches?.('[data-tag-form] [name="tag"]'))suggestTags(event.target);});
document.addEventListener('focusout',event=>{if(event.target.matches?.('[data-tag-form] [name="tag"]')&&!event.relatedTarget?.closest?.('.tag-suggest'))closeSuggest(event.target);});
document.addEventListener('input',event=>{if(event.target.matches?.('[data-tag-form] [name="tag"]'))suggestTags(event.target);});
// A pointer press on a suggestion keeps the focus in the box.
document.addEventListener('mousedown',event=>{const option=event.target.closest('[data-suggest-tag]');if(!option)return;event.preventDefault();pickSuggestion(option.closest('[data-tag-form]').querySelector('[name="tag"]'),option.dataset.suggestTag);});
document.addEventListener('keydown',event=>{
  const input=event.target.closest?.('[data-tag-form] [name="tag"]');if(!input||event.isComposing)return;
  const list=input.closest('[data-tag-form]').querySelector('.tag-suggest'),options=[...list.querySelectorAll('[data-suggest-tag]')],active=options.findIndex(o=>o.id===input.getAttribute('aria-activedescendant'));
  if(['ArrowDown','ArrowUp'].includes(event.key)){
    event.preventDefault();if(list.hidden)suggestTags(input);const items=[...list.querySelectorAll('[data-suggest-tag]')];if(!items.length)return;
    const next=items[(active+(event.key==='ArrowDown'?1:items.length-1)+(active<0&&event.key==='ArrowUp'?1:0))%items.length];
    items.forEach(o=>o.setAttribute('aria-selected',String(o===next)));input.setAttribute('aria-activedescendant',next.id);next.scrollIntoView({block:'nearest'});
  }else if(event.key==='Enter'&&active>=0){event.preventDefault();event.stopImmediatePropagation();pickSuggestion(input,options[active].dataset.suggestTag);}
  else if(event.key==='Escape'&&!list.hidden){event.preventDefault();event.stopPropagation();closeSuggest(input);}
},true);
// Typing a tag's name with other spacing or Unicode form adds that tag, not a twin.
document.addEventListener('submit',event=>{const form=event.target.closest?.('[data-tag-form]');if(!form)return;const input=form.elements.tag,match=tagCounts().find(([t])=>sameTag(t,input.value));if(match)input.value=match[0];closeSuggest(input);const id=form.closest('[data-tag-editor]').dataset.tagEditor;setTimeout(()=>tagWrite.then(()=>document.querySelector(`[data-tag-editor="${id}"] [name="tag"]`)?.focus()));},true);

// ---- The tag menu: colour, rename, give to the checked papers, delete ----
let tagMenu=null;
function closeTagMenu(){tagMenu?.remove();tagMenu=null;}
function swatch(color,label,current,attr='data-set-tag-color'){return `<button type="button" role="menuitemradio" aria-checked="${current===color}" class="tag-swatch" ${attr}="${color}" data-color="${color}"${tagStyle(color)} aria-label="${esc(label)}" title="${esc(label)}"></button>`;}
function usedColors(){const palette=new Set(TAG_PALETTE.map(([c])=>c));return [...new Set(Object.keys(tagColors).map(tagColor).filter(c=>c&&!palette.has(c)))].slice(0,10);}
function colorPicker(current,attr){const used=usedColors();return `<div class="tag-menu-colors">${TAG_PALETTE.map(([c,label])=>swatch(c,label,current,attr)).join('')}</div>${used.length?`<p class="tag-menu-label">${tr('사용 중인 색')}</p><div class="tag-menu-colors">${used.map(c=>swatch(c,c,current,attr)).join('')}</div>`:''}<div class="tag-menu-custom"><input type="color" class="tag-color-picker" value="${current||'#0588f0'}" aria-label="${tr('색 직접 고르기')}" title="${tr('색 직접 고르기')}"><input class="tag-color-hex" value="${current}" placeholder="#RRGGBB" maxlength="7" spellcheck="false" aria-label="${tr('HEX 색 코드')}"><button type="button" class="secondary small" data-apply-tag-hex>${tr('적용')}</button></div>`;}
function openTagMenu(tag,anchor){
  closeTagMenu();const current=tagColor(tag),chosen=chosenPapers();
  tagMenu=document.createElement('div');tagMenu.className='tag-color-menu';tagMenu.setAttribute('role','menu');tagMenu.setAttribute('aria-label',tr('{tag} 태그',{tag}));tagMenu.dataset.tag=tag;
  tagMenu.innerHTML=`<p class="tag-menu-title">${esc(tag)}</p>${colorPicker(current,'data-set-tag-color')}<button type="button" role="menuitemradio" aria-checked="${!current}" class="tag-menu-clear" data-set-tag-color="">${tr('색 없음')}</button><div class="tag-menu-actions">${chosen.length?`<button type="button" role="menuitem" data-tag-action="give">${tr('선택한 자료 {n}개에 지정',{n:chosen.length})}</button>`:''}<button type="button" role="menuitem" data-tag-action="rename">${tr('이름 변경…')}</button><button type="button" role="menuitem" class="danger" data-tag-action="delete">${tr('태그 삭제…')}</button></div>`;
  document.body.append(tagMenu);
  const box=anchor.getBoundingClientRect(),menu=tagMenu.getBoundingClientRect();
  tagMenu.style.left=Math.max(8,Math.min(box.left,innerWidth-menu.width-8))+'px';tagMenu.style.top=(box.bottom+menu.height+8>innerHeight?Math.max(8,box.top-menu.height-4):box.bottom+4)+'px';
  tagMenu.querySelector('[aria-checked="true"]')?.focus();
}
function hexColor(text){let value=String(text||'').trim().toLowerCase();if(!value.startsWith('#'))value='#'+value;if(/^#[0-9a-f]{3}$/.test(value))value='#'+[...value.slice(1)].map(c=>c+c).join('');return HEX_COLOR.test(value)?value:null;}
function readHex(root){const input=root.querySelector('.tag-color-hex'),color=hexColor(input.value);if(!color){input.setAttribute('aria-invalid','true');toast(tr('색 코드는 #RRGGBB 형식으로 입력하세요. 예: #1b64da'));input.focus();}return color;}
async function setTagColor(tag,color){const id=state.storageKey,snapshot=await window.appApi.tagColor(id,tag,color||null);if(state.storageKey!==id)return;await desktopNotes();applyItemSnapshot(snapshot);document.querySelector(`[data-tag-menu="${CSS.escape(tag)}"]`)?.focus();}
async function giveTag(tag,ids){const id=state.storageKey;ids=ids.filter(x=>papers.some(p=>p.id===x));if(!ids.length)return;await desktopNotes();const snapshot=await window.appApi.batchUpdate(id,ids,{addTags:[tag]});if(state.storageKey!==id)return;applyItemSnapshot(snapshot);toast(ids.length>1?tr('자료 {n}개에 “{tag}” 태그를 지정했습니다.',{n:ids.length,tag}):tr('자료에 “{tag}” 태그를 지정했습니다.',{tag}));}

// ---- Dialogs: new tag, rename (or merge), delete with the papers it touches and an undo ----
function newTagDialog(){
  const chosen=chosenPapers();
  modal(tr('새 태그'),`<div class="field"><label for="new-tag-name">${tr('이름')}</label><input id="new-tag-name" maxlength="60" autocomplete="off"></div><div class="field"><label>${tr('색')}</label><div class="new-tag-colors">${swatch('',tr('색 없음'),'','data-new-tag-color')}${colorPicker('','data-new-tag-color')}</div></div>${chosen.length?`<label class="collection-choice"><input type="checkbox" id="new-tag-give" checked> ${tr('선택한 자료 {n}개에 지정',{n:chosen.length})}</label>`:''}`,btn(tr('취소'),'close')+btn(tr('만들기'),'create-tag','primary'));
  dialog.newTagColor='';document.querySelector('#new-tag-name').focus();
}
async function createTag(){
  const input=document.querySelector('#new-tag-name'),name=input.value.trim();if(!name){input.focus();return;}
  const existing=tagCounts().find(([t])=>sameTag(t,name));if(existing){toast(tr('이미 있는 태그입니다: {tag}',{tag:existing[0]}));input.select();return;}
  const id=state.storageKey,give=document.querySelector('#new-tag-give')?.checked?chosenPapers():[];
  await desktopNotes();let snapshot=await window.appApi.tagCreate(id,name,dialog.newTagColor||null);
  if(give.length)snapshot=await window.appApi.batchUpdate(id,give,{addTags:[name.normalize('NFC')]});
  if(state.storageKey!==id)return;dialog.close();setViewOpen('tags',true);
  applyItemSnapshot(snapshot);document.querySelector(`[data-tag-row="${CSS.escape(name.normalize('NFC'))}"]`)?.scrollIntoView({block:'nearest'});
  toast(give.length?tr('“{tag}” 태그를 만들었습니다 · 자료 {n}개에 지정.',{tag:name,n:give.length}):tr('“{tag}” 태그를 만들었습니다.',{tag:name}));
}
function renameTagDialog(tag){modal(tr('태그 이름 변경'),`<div class="field"><label for="tag-rename">${tr('이름')}</label><input id="tag-rename" maxlength="60" value="${esc(tag)}" autocomplete="off"></div><p class="small muted">${tr('이 태그가 붙은 모든 자료에 바로 적용됩니다. 이미 있는 이름으로 바꾸면 두 태그를 합칩니다.')}</p>`,btn(tr('취소'),'close')+btn(tr('바꾸기'),'rename-tag','primary'));dialog.tagTarget=tag;const input=document.querySelector('#tag-rename');input.focus();input.select();}
async function renameTag(confirmed=false){
  const from=dialog.tagTarget,to=(confirmed?dialog.tagMergeInto:document.querySelector('#tag-rename')?.value||'').trim();if(!from||!to)return;
  if(to===from){dialog.close();return;}
  const into=tagCounts().find(([t])=>t!==from&&sameTag(t,to));
  if(into&&!confirmed){const counts=new Map(tagCounts());dialog.tagMergeInto=into[0];modal(tr('태그 합치기'),`<p>${tr('“{from}”를 “{into}”에 합칩니다.',{from:esc(from),into:esc(into[0])})}</p><p class="small muted">${tr('“{from}” 자료 {n}개가 “{into}”로 옮겨지고 “{from}”는 없어집니다. 두 태그가 다 붙은 자료에는 하나만 남습니다. 합치기 전에 백업을 만듭니다(저장소 관리에서 복원).',{from:esc(from),into:esc(into[0]),n:counts.get(from)||0})}</p>`,btn(tr('취소'),'close')+btn(tr('합치기'),'confirm-tag-merge','primary'));dialog.tagTarget=from;dialog.tagMergeInto=into[0];return;}
  const id=state.storageKey;await desktopNotes();const {result,snapshot}=await window.appApi.tagRename(id,from,to);if(state.storageKey!==id)return;
  if(state.desktopTag===from){state.desktopTag=result.name;state.nav=result.name;}
  dialog.close();applyItemSnapshot(snapshot);toast(result.merged?tr('“{from}”를 “{into}”에 합쳤습니다 (자료 {n}개).',{from,into:result.name,n:result.papers}):tr('태그 이름을 “{name}”(으)로 바꿨습니다 (자료 {n}개).',{name:result.name,n:result.papers}));
}
function deleteTagDialog(tag){const count=new Map(tagCounts()).get(tag)||0;modal(tr('태그 삭제'),`<p>${tr('“{tag}” 태그를 저장소에서 삭제합니다. 자료 {n}개에서 이 태그가 빠집니다.',{tag:esc(tag),n:count})}</p><p class="small muted">${tr('자료·PDF·메모는 그대로입니다. 삭제 전에 백업을 만들고, 삭제 후 알림의 ‘되돌리기’로 바로 되살릴 수 있습니다. 이 자료에서만 빼려면 자료 정보의 태그 ×를 누르세요.')}</p>`,btn(tr('취소'),'close')+btn(tr('삭제'),'confirm-tag-delete','primary danger'));dialog.tagTarget=tag;}
async function deleteTag(){
  const tag=dialog.tagTarget,id=state.storageKey,color=tagColor(tag),had=papers.filter(p=>p.tags.includes(tag)).map(p=>p.id);if(!tag)return;
  await desktopNotes();const {result,snapshot}=await window.appApi.tagDelete(id,tag);if(state.storageKey!==id)return;
  if(state.desktopTag===tag){state.desktopTag=null;state.nav='전체 자료';state.savedSearch=null;} // i18n:keep — navigation value
  dialog.close();applyItemSnapshot(snapshot);
  undoToast(tr('“{tag}” 태그를 삭제했습니다 (자료 {n}개).',{tag,n:result.papers}),async()=>{if(state.storageKey!==id)return;let next=await window.appApi.tagCreate(id,tag,color||null);const ids=had.filter(x=>papers.some(p=>p.id===x));if(ids.length)next=await window.appApi.batchUpdate(id,ids,{addTags:[tag]});applyItemSnapshot(next);toast(tr('“{tag}” 태그를 되살렸습니다.',{tag}));});
}
// A short notice with one button; it goes away by itself.
function undoToast(message,undo){
  document.querySelector('.undo-toast')?.remove();
  const bar=document.createElement('div');bar.className='undo-toast';bar.setAttribute('role','status');bar.innerHTML=`<span>${esc(message)}</span><button type="button">${tr('되돌리기')}</button>`;
  const timer=setTimeout(()=>bar.remove(),10000);bar.querySelector('button').addEventListener('click',()=>{clearTimeout(timer);bar.remove();runDesktop(undo)();});
  // Over an open dialog (the wide editor) the notice sits in the dialog, where it can be pressed.
  (dialog.open?dialog:document.body).append(bar);
}

// ---- 태그 지정: every tag with a check box for the chosen papers (일부 = some of them have it) ----
function assignRow(tag,mark){return `<label class="tag-assign-row" data-assign-row="${esc(tag)}"><input type="checkbox" data-assign-tag="${esc(tag)}" data-state="${mark}" ${mark==='on'||mark==='new'?'checked':''}>${tagIcon(tagColor(tag))}<span class="tag-name">${esc(tag)}</span>${mark==='mixed'?`<span class="tag-partial">${tr('일부')}</span>`:mark==='new'?`<span class="tag-partial">${tr('새 태그')}</span>`:''}</label>`;}
function tagAssignDialog(ids){
  ids=ids.filter(id=>papers.some(p=>p.id===id));if(!ids.length)return;
  const chosen=papers.filter(p=>ids.includes(p.id)),rows=tagCounts().map(([t])=>{const have=chosen.filter(p=>p.tags.includes(t)).length;return assignRow(t,have===chosen.length?'on':have?'mixed':'off');}).join('');
  modal(tr('태그 지정'),`<p class="small muted">${tr('{target} · 체크하면 넣고 체크를 끄면 뺍니다. ‘일부’는 건드리지 않으면 그대로 둡니다.',{target:ids.length>1?tr('자료 {n}개',{n:ids.length}):esc(chosen[0].title)})}</p><input type="search" id="tag-assign-search" placeholder="${tr('태그 검색 또는 새 태그 이름')}" aria-label="${tr('태그 검색 또는 새 태그 이름')}" autocomplete="off" maxlength="60"><button type="button" class="tag-assign-create" id="tag-assign-create" hidden></button><div class="tag-assign-list" id="tag-assign-list">${rows||`<p class="small muted">${tr('아직 태그가 없습니다. 위에 이름을 입력해 만드세요.')}</p>`}</div>`,btn(tr('취소'),'close')+btn(tr('적용'),'apply-tag-assign','primary'));
  dialog.tagAssign=ids;for(const box of dialog.querySelectorAll('[data-state="mixed"]'))box.indeterminate=true;
  document.querySelector('#tag-assign-search').focus();
}
function filterAssign(){
  const input=document.querySelector('#tag-assign-search'),query=input.value.trim(),create=document.querySelector('#tag-assign-create');
  for(const row of document.querySelectorAll('[data-assign-row]'))row.hidden=!tagMatches(row.dataset.assignRow,query);
  const exists=[...document.querySelectorAll('[data-assign-row]')].some(row=>sameTag(row.dataset.assignRow,query));
  create.hidden=!query||exists;create.textContent=tr('“{tag}” 새 태그로 추가',{tag:query});
}
function addAssignTag(){
  const input=document.querySelector('#tag-assign-search'),name=input.value.trim().normalize('NFC');if(!name)return;
  const row=[...document.querySelectorAll('[data-assign-row]')].find(r=>sameTag(r.dataset.assignRow,name));
  if(row){const box=row.querySelector('input');box.indeterminate=false;box.checked=true;}
  else document.querySelector('#tag-assign-list').insertAdjacentHTML('afterbegin',assignRow(name,'new'));
  input.value='';filterAssign();input.focus();
}
async function applyTagAssign(){
  const ids=dialog.tagAssign,id=state.storageKey,add=[],remove=[];if(!ids)return;
  for(const box of dialog.querySelectorAll('[data-assign-tag]')){if(box.indeterminate)continue;const tag=box.dataset.assignTag,was=box.dataset.state;if(box.checked&&was!=='on')add.push(tag);if(!box.checked&&was!=='off'&&was!=='new')remove.push(tag);}
  if(!add.length&&!remove.length){dialog.close();return;}
  await desktopNotes();const snapshot=await window.appApi.batchUpdate(id,ids,{...(add.length?{addTags:add}:{}),...(remove.length?{removeTags:remove}:{})});if(state.storageKey!==id)return;
  dialog.close();applyItemSnapshot(snapshot);toast(`${ids.length>1?tr('자료 {n}개의 태그를 바꿨습니다',{n:ids.length}):tr('태그를 바꿨습니다')}${add.length?` · ${tr('추가 {n}',{n:add.length})}`:''}${remove.length?` · ${tr('제거 {n}',{n:remove.length})}`:''}.`);
}

// ---- Events ----
Object.assign(actions,{
  'new-tag':newTagDialog,'create-tag':runDesktop(createTag),
  'rename-tag':runDesktop(()=>renameTag(false)),'confirm-tag-merge':runDesktop(()=>renameTag(true)),
  'confirm-tag-delete':runDesktop(deleteTag),
  'batch-tag':()=>tagAssignDialog(chosenPapers()),'apply-tag-assign':runDesktop(applyTagAssign)
});
document.addEventListener('click',event=>{
  const more=event.target.closest('[data-tag-menu]');if(more){if(tagMenu?.dataset.tag===more.dataset.tagMenu)closeTagMenu();else openTagMenu(more.dataset.tagMenu,more);return;}
  if(tagMenu){
    const choice=event.target.closest('[data-set-tag-color]'),act=event.target.closest('[data-tag-action]'),tag=tagMenu.dataset.tag;
    if(choice){closeTagMenu();runDesktop(()=>setTagColor(tag,choice.dataset.setTagColor))();return;}
    if(event.target.closest('[data-apply-tag-hex]')){const color=readHex(tagMenu);if(color){closeTagMenu();runDesktop(()=>setTagColor(tag,color))();}return;}
    if(act){closeTagMenu();if(act.dataset.tagAction==='rename')renameTagDialog(tag);else if(act.dataset.tagAction==='delete')deleteTagDialog(tag);else runDesktop(()=>giveTag(tag,chosenPapers()))();return;}
    if(!event.target.closest('.tag-color-menu'))closeTagMenu();
  }
  // The new-tag dialog's colour choice.
  const pick=event.target.closest('[data-new-tag-color]');
  if(pick&&dialog.open){dialog.newTagColor=pick.dataset.newTagColor;for(const b of dialog.querySelectorAll('[data-new-tag-color]'))b.setAttribute('aria-checked',String(b===pick));const hex=dialog.querySelector('.tag-color-hex');if(hex)hex.value=pick.dataset.newTagColor;return;}
  if(event.target.closest('[data-apply-tag-hex]')&&dialog.open){const color=readHex(dialog);if(color){dialog.newTagColor=color;for(const b of dialog.querySelectorAll('[data-new-tag-color]'))b.setAttribute('aria-checked',String(b.dataset.newTagColor===color));}return;}
  if(event.target.closest('#tag-assign-create'))addAssignTag();
});
// The +N chip and the 태그 지정 button work without opening the paper (window capture runs first).
window.addEventListener('click',event=>{const assign=event.target.closest('[data-tag-assign]');if(!assign)return;event.stopImmediatePropagation();tagAssignDialog([Number(assign.dataset.tagAssign)]);},true);
// The colour picker shows its colour in the code box as it moves and applies when it closes.
document.addEventListener('input',event=>{
  if(event.target.id==='tag-search'){tagQuery=event.target.value;filterTagList();return;}
  if(event.target.id==='tag-assign-search'){filterAssign();return;}
  if(event.target.matches?.('.tag-color-picker')){const root=event.target.closest('.tag-color-menu,dialog'),hex=root?.querySelector('.tag-color-hex');if(hex){hex.value=event.target.value;hex.removeAttribute('aria-invalid');}}
});
document.addEventListener('change',event=>{
  if(!event.target.matches?.('.tag-color-picker'))return;const color=hexColor(event.target.value);if(!color)return;
  if(tagMenu&&tagMenu.contains(event.target)){const tag=tagMenu.dataset.tag;closeTagMenu();runDesktop(()=>setTagColor(tag,color))();}
  else if(dialog.open){dialog.newTagColor=color;for(const b of dialog.querySelectorAll('[data-new-tag-color]'))b.setAttribute('aria-checked',String(b.dataset.newTagColor===color));}
});
document.addEventListener('contextmenu',event=>{const row=event.target.closest('[data-tag-row]');if(!row)return;event.preventDefault();openTagMenu(row.dataset.tagRow,row.querySelector('[data-tag-menu]'));});
document.addEventListener('keydown',event=>{
  if(tagMenu&&event.key==='Escape'){event.preventDefault();event.stopPropagation();const tag=tagMenu.dataset.tag;closeTagMenu();document.querySelector(`[data-tag-menu="${CSS.escape(tag)}"]`)?.focus();return;}
  if(event.isComposing)return;
  if(event.key==='Enter'&&event.target.matches?.('.tag-color-hex')){event.preventDefault();event.target.closest('.tag-color-menu,dialog')?.querySelector('[data-apply-tag-hex]')?.click();return;}
  if(tagMenu&&['ArrowLeft','ArrowRight'].includes(event.key)&&event.target.matches('.tag-color-menu .tag-swatch')){event.preventDefault();const items=[...tagMenu.querySelectorAll('.tag-swatch')],at=items.indexOf(event.target);items[(at+(event.key==='ArrowRight'?1:items.length-1))%items.length]?.focus();return;}
  if(event.key==='Enter'&&event.target.id==='new-tag-name'){event.preventDefault();actions['create-tag']();return;}
  if(event.key==='Enter'&&event.target.id==='tag-rename'){event.preventDefault();actions['rename-tag']();return;}
  // Enter checks the tag named in the box, or adds it as a new one.
  if(event.key==='Enter'&&event.target.id==='tag-assign-search'){event.preventDefault();if(event.target.value.trim())addAssignTag();return;}
  if(event.target.id!=='tag-search')return;
  if(event.key==='Enter'){event.preventDefault();document.querySelector('[data-tag-row]:not([hidden]) [data-desktop-tag]')?.click();}
  if(event.key==='Escape'&&tagQuery){event.preventDefault();event.stopPropagation();event.target.value='';tagQuery='';filterTagList();}
},true);

// ---- AI 태그 추천 ----
// The paper's opening pages and the vault's tag names go to the model the user picks (after
// the same confirmation as the other AI tools); the reply is only a list to choose from.
// Tags the vault already has come first and are marked, so the model's words do not
// quietly replace the user's own.
let tagAi=null;
async function tagAiConfirm(paperId){
  const paper=papers.find(p=>p.id===paperId);if(!paper||!state.storageKey)return;
  if(state.selected!==paperId){toast(tr('태그를 추천받을 자료를 먼저 여세요.'));return;}
  const groups=await readyModelGroups({onRefresh:()=>refreshModelChoice('tag-ai-model')});if(!groups)return;
  const key=targetKey();let source;
  try{toast(tr('문서 구조를 읽는 중…'));source=await insightBlocks();}finally{insightState.busy=null;refreshInsightPanel();}
  if(key!==targetKey())return;
  let chars=0,count=0;for(const b of source.blocks){if(chars+b.text.length>12000)break;chars+=b.text.length;count++;}
  tagAi={key,paperId,source};
  modal(tr('AI 태그 추천'),`<p>${tr('이 자료의 제목과 앞부분 약 {chars}자(문단 {count}개), 그리고 저장소의 태그 이름 {tags}개를 보냅니다.',{chars:chars.toLocaleString(appI18n.uiLocale()),count,n:count,tags:tagCounts().length})}</p>${modelField('tag-ai-model',groups,preferredChoice(groups))}<p class="small muted">${tr('추천만 받아 옵니다. 고른 태그만 자료에 추가되고, 저장소에 이미 있는 태그를 먼저 씁니다. 자동으로 다른 서비스로 바꾸지 않습니다.')}</p>`,btn(tr('취소'),'close')+btn(tr('보내기'),'tag-ai-send','primary'));showModelNotice('tag-ai-model');
}
async function tagAiSend(){
  const pending=tagAi,choice=chosenModel('tag-ai-model'),model=choice?.model;if(!pending?.source||!model)return;rememberChoice(choice);
  const vault=state.storageKey,attachmentId=state.selectedAttachment;
  modal(tr('AI 태그 추천'),`<p role="status">${tr('태그를 추천받는 중…')}</p>`,btn(tr('취소'),'tag-ai-cancel'));
  let result;
  try{result=await window.appApi.aiTags(vault,pending.paperId,attachmentId,model,{sourceHash:pending.source.hash,blocks:pending.source.blocks,connection:choice.connection});}
  catch(error){if(tagAi===pending&&dialog.open)modal(tr('AI 태그 추천'),`<p>${esc(plainError(error))}</p>`,btn(tr('닫기'),'close'));return;}
  if(tagAi!==pending||state.storageKey!==vault||pending.key!==targetKey())return;
  const paper=papers.find(p=>p.id===pending.paperId),tags=result.tags.filter(t=>!paper?.tags.includes(t.name)).sort((a,b)=>Number(b.existing)-Number(a.existing));
  if(!tags.length){modal(tr('AI 태그 추천'),`<p>${tr('추가할 새 태그가 없습니다.')}</p>`,btn(tr('닫기'),'close'));return;}
  tagAi={...pending,tags,source:null};
  modal(tr('AI 태그 추천'),`<p class="small muted">${esc(result.model)} · ${tr('추가할 태그를 고르세요.')}</p><div class="tag-ai-list">${tags.map((t,i)=>`<label class="tag-ai-item"><input type="checkbox" data-tag-ai-pick="${i}" checked><span class="tag-chip" data-color="${t.existing?tagColor(t.name):''}">${tagIcon(t.existing?tagColor(t.name):'')}<span class="tag-name">${esc(t.name)}</span></span><span class="pill ${t.existing?'':'amber'}">${t.existing?tr('기존 태그'):tr('새 태그')}</span>${t.reason?`<small class="muted">${esc(t.reason)}</small>`:''}</label>`).join('')}</div>`,btn(tr('취소'),'close')+btn(tr('선택한 태그 추가'),'tag-ai-apply','primary'));
}
async function tagAiApply(){
  const pending=tagAi;if(!pending?.tags)return;
  const names=[...document.querySelectorAll('[data-tag-ai-pick]:checked')].map(box=>pending.tags[Number(box.dataset.tagAiPick)]?.name).filter(Boolean);
  const id=state.storageKey;dialog.close();tagAi=null;if(!names.length)return;
  await desktopNotes();const snapshot=await window.appApi.batchUpdate(id,[pending.paperId],{addTags:names});
  if(state.storageKey!==id)return;applyItemSnapshot(snapshot);toast(tr('태그 {n}개를 추가했습니다.',{n:names.length}));
}
document.addEventListener('click',event=>{const button=event.target.closest?.('[data-tag-ai]');if(button){event.preventDefault();runDesktop(tagAiConfirm)(Number(button.dataset.tagAi));}});
Object.assign(actions,{
  'tag-ai-send':runDesktop(tagAiSend),
  'tag-ai-apply':runDesktop(tagAiApply),
  'tag-ai-cancel':runDesktop(async()=>{tagAi=null;dialog.close();await window.appApi.aiCancel();}),
});
