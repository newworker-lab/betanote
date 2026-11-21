/* Library and citations: structured bibliographic editing, DOI lookups that
   never overwrite edits, citation copying and multi-format import/export. */
const bibTypes={'article-journal':tr('학술지 논문'),'paper-conference':tr('학회 논문'),'book':tr('책'),'chapter':tr('책의 장'),'thesis':tr('학위논문'),'report':tr('보고서'),'webpage':tr('웹페이지'),'preprint':tr('프리프린트'),'other':tr('기타')};
const containerLabel=type=>({'paper-conference':tr('학회·논문집'),'chapter':tr('책 제목'),'book':tr('총서'),'webpage':tr('웹사이트'),'preprint':tr('프리프린트 서버'),'thesis':tr('학위 과정'),'report':tr('보고서 번호·총서')}[type]||tr('학술지'));
const bibFieldLabels={title:tr('제목'),authors:tr('저자'),year:tr('연도'),date:tr('날짜'),journal:tr('수록처'),volume:tr('권'),issue:tr('호'),pages:tr('쪽'),publisher:tr('출판사·기관'),place:tr('출판지'),isbn:'ISBN',issn:'ISSN',doi:'DOI',url:'URL',accessed:tr('접근일'),abstract:tr('초록'),citekey:tr('인용 키'),type:tr('자료 유형')};
function creatorList(paper){if(Array.isArray(paper.creators)&&paper.creators.length)return paper.creators;const text=String(paper.authors||'').trim();return !text||text==='저자 미입력'?[]:text.split(';').map(s=>s.trim()).filter(Boolean).map(literal=>({literal}));} // i18n:keep — stored value for no author
function creatorLinesOf(paper){return creatorList(paper).map(c=>c.literal??(c.given?`${c.family}, ${c.given}`:c.family)).join('\n');}
// "Family, Given" lines are structured; any other line stays one name.
function parseCreatorText(text){return String(text||'').split(/\r?\n/).map(s=>s.trim()).filter(Boolean).map(line=>{const at=line.indexOf(',');return at>0&&line.slice(0,at).trim()&&line.slice(at+1).trim()?{family:line.slice(0,at).trim(),given:line.slice(at+1).trim()}:{literal:line};});}
const creatorDisplay=c=>c.literal??[c.given,c.family].filter(Boolean).join(' ');

// The item's main PDF is a file in the vault (not missing): its name can be changed.
const bibHasFile=paper=>{const a=paper.attachments?.find(x=>x.id===paper.primaryAttachmentId)||paper.attachments?.find(x=>x.role!=='translated');return !!a?.file;};
bibliography=function(paper){
  const type=paper.type||'article-journal',creators=creatorList(paper);
  const rows=[[tr('자료 유형'),bibTypes[type]],[tr('제목'),paper.title],[tr('저자'),creators.map(creatorDisplay).join('; ')],[tr('날짜'),paper.date||paper.year],[containerLabel(type),paper.journal],[tr('권·호'),[paper.volume,paper.issue&&`(${paper.issue})`].filter(Boolean).join(' ')],[tr('쪽'),paper.pages],[tr('출판사·기관'),paper.publisher],['DOI',paper.doi],['URL',paper.url],['ISBN',paper.isbn],[tr('인용 키'),paper.citekey||appName.citekeyPrefix+paper.id]];
  return `<div class="bib-head"><h3>${tr('서지정보')}</h3><div class="row"><button class="secondary small" data-action="autofill-paper" title="${tr('PDF의 DOI·제목으로 빈 칸을 채웁니다')}">${tr('자동 채우기')}</button><button class="secondary small" data-action="cite-paper">${tr('인용 복사')}</button><button class="secondary small" data-action="edit-bibliography">${tr('편집')}</button>${bibHasFile(paper)?`<button class="secondary small" data-action="rename-file-title" title="${tr('이 자료의 PDF 파일 이름을 제목.pdf로 바꿉니다. 메모·번역·필기 연결은 그대로입니다.')}">${tr('제목으로 파일 이름')}</button>`:''}</div></div><dl class="bibliography">${rows.filter(([,v])=>v&&String(v).trim()).map(([label,value])=>`<dt>${esc(label)}</dt><dd>${esc(value)}</dd>`).join('')||`<dt>${tr('제목')}</dt><dd>—</dd>`}</dl>${creators.some(c=>c.literal!==undefined)&&creators.length?`<p class="small muted">${tr('구조화되지 않은 저자 이름은 원래 문자열 그대로 인용합니다. 편집에서 “성, 이름”으로 나눌 수 있습니다.')}</p>`:''}`;
};
editBibliography=function(){
  const p=selected(),type=p.type||'article-journal',field=(key,label,attrs='')=>`<div class="field"><label for="bib-${key}">${label}</label><input id="bib-${key}" name="${key}" value="${esc(p[key]||'')}" maxlength="${key==='url'?2000:1000}" ${attrs}></div>`;
  modal(tr('서지정보 편집'),`<form id="bibliography-form" class="bibliography-form"><div class="row"><button type="button" class="secondary small" data-action="extract-doi">${tr('PDF에서 DOI 찾기')}</button><button type="button" class="secondary small" data-action="lookup-doi">${tr('DOI로 조회')}</button></div><p class="small muted" id="doi-status" role="status"></p><div id="doi-conflicts"></div>
  <div class="field"><label for="bib-type">${tr('자료 유형')}</label><select id="bib-type" name="type">${Object.entries(bibTypes).map(([v,l])=>`<option value="${v}" ${v===type?'selected':''}>${l}</option>`).join('')}</select></div>
  ${field('title',tr('제목'),'required')}
  <div class="field"><label for="bib-creators">${tr('저자 (한 줄에 한 명)')}</label><textarea id="bib-creators" name="creators" rows="3" placeholder="${tr('Doe, Jane&#10;세계보건기구')}">${esc(creatorLinesOf(p))}</textarea><small class="muted">${tr('“성, 이름”으로 쓰면 인용 형식에 맞춰 이름을 줄입니다. 쉼표가 없는 줄은 기관명·전체 이름으로 그대로 씁니다.')}</small></div>
  <div class="bib-grid">${field('date',tr('날짜 (YYYY[-MM[-DD]])'),'pattern="\\d{4}(-\\d{2}(-\\d{2})?)?"')}${field('journal',containerLabel(type))}${field('volume',tr('권'))}${field('issue',tr('호'))}${field('pages',tr('쪽'))}${field('publisher',tr('출판사·기관'))}${field('place',tr('출판지'))}${field('doi','DOI')}${field('isbn','ISBN')}${field('issn','ISSN')}${field('url','URL')}${field('accessed',tr('접근일 (YYYY-MM-DD)'),'pattern="\\d{4}(-\\d{2}(-\\d{2})?)?"')}${field('citekey',tr('인용 키'),'pattern="[A-Za-z0-9_:.\\-]{1,100}" placeholder="'+appName.citekeyPrefix+p.id+'"')}</div>
  <div class="field"><label for="bib-abstract">${tr('초록')}</label><textarea id="bib-abstract" name="abstract" rows="4" maxlength="20000">${esc(p.abstract||'')}</textarea></div></form>`,btn(tr('취소'),'close')+btn(tr('저장'),'save-bibliography','primary'));
  dialog.classList.add('bibliography-dialog');
};
async function saveStructuredBibliography(){
  const form=document.querySelector('#bibliography-form');if(!form.reportValidity())return;
  const id=state.storageKey,paperId=state.selected,data=Object.fromEntries(new FormData(form)),creators=parseCreatorText(data.creators);
  const patch={...data,creators,authors:creators.map(creatorDisplay).join('; ').slice(0,1000)||'저자 미입력',year:(/\d{4}/.exec(data.date)||[selected().year||'—'])[0]}; // i18n:keep — stored value for no author
  await desktopNotes();await window.appApi.updatePaper(id,paperId,patch);applyItemSnapshot(await window.appApi.refreshStorage(id));
}
// A lookup fills empty fields only; values that differ are listed to apply one by one.
async function lookupDOIWithReview(){
  const form=document.querySelector('#bibliography-form'),status=form.querySelector('#doi-status'),box=form.querySelector('#doi-conflicts');
  status.textContent=tr('Crossref에서 DOI 서지정보 조회 중…');box.innerHTML='';
  let metadata;try{metadata=await window.appApi.lookupDOI(form.querySelector('#bib-doi').value);}catch(error){if(status.isConnected)status.textContent=shownError(error);return;}
  if(!form.isConnected)return;
  const value=key=>key==='authors'?form.querySelector('#bib-creators').value.trim():key==='year'?(form.querySelector('#bib-date').value.match(/\d{4}/)||[''])[0]:(form.querySelector('#bib-'+key)?.value||'').trim();
  const candidate={...metadata,creators:metadata.creators?.map(c=>c.literal??(c.given?`${c.family}, ${c.given}`:c.family)).join('\n')};
  const filled=[],conflicts=[];
  for(const [key,raw] of Object.entries(candidate)){
    if(['authors','year'].includes(key)||raw===''||raw===undefined)continue;
    const target=key==='creators'?form.querySelector('#bib-creators'):form.querySelector('#bib-'+key);if(!target)continue;
    const current=key==='creators'?value('authors'):value(key);
    if(!current){target.value=raw;filled.push(bibFieldLabels[key]||tr('저자'));}
    else if(current!==String(raw).trim()&&!(key==='type'&&current===raw))conflicts.push({key,label:key==='creators'?tr('저자'):bibFieldLabels[key],current,raw});
  }
  status.textContent=conflicts.length?tr('빈 칸 {n}개를 채웠습니다. 입력값과 다른 조회값 {conflicts}개는 아래에서 확인하세요. 저장 전에 확인하세요.',{n:filled.length,conflicts:conflicts.length}):tr('빈 칸 {n}개를 채웠습니다. 저장 전에 확인하세요.',{n:filled.length});
  box.innerHTML=conflicts.map((c,i)=>`<div class="doi-conflict"><strong>${esc(c.label)}</strong><span>${tr('현재: {value}',{value:esc(c.current)})}</span><span>${tr('조회: {value}',{value:esc(c.raw)})}</span><button type="button" class="secondary small" data-doi-apply="${i}">${tr('조회값 적용')}</button></div>`).join('');
  box.conflicts=conflicts;
}
document.addEventListener('click',event=>{
  const apply=event.target.closest('[data-doi-apply]');if(!apply)return;
  const box=document.querySelector('#doi-conflicts'),c=box.conflicts?.[Number(apply.dataset.doiApply)];if(!c)return;
  const target=c.key==='creators'?document.querySelector('#bib-creators'):document.querySelector('#bib-'+c.key);target.value=c.raw;apply.closest('.doi-conflict').remove();
});

async function citeDialog(paperIds=[state.selected]){
  const style=localStorage.getItem('app-cite-style')==='vancouver'?'vancouver':'apa';
  modal(tr('인용 복사'),`<div class="row"><label>${tr('형식')} <select id="cite-style"><option value="apa" ${style==='apa'?'selected':''}>APA 7</option><option value="vancouver" ${style==='vancouver'?'selected':''}>Vancouver</option></select></label><label>${tr('위치 (쪽 등)')} <input id="cite-locator" maxlength="100" placeholder="${tr('예: 12 또는 12-14')}"></label></div><h3>${tr('참고문헌')}</h3><div id="cite-reference" class="cite-preview"></div><h3>${tr('본문 인용')}</h3><div id="cite-intext" class="cite-preview"></div><p class="small muted">${tr('위치는 이 인용에만 붙고 서지정보에는 저장하지 않습니다.')}</p>`,btn(tr('닫기'),'close')+btn(tr('본문 인용 복사'),'copy-intext')+btn(tr('참고문헌 복사'),'copy-reference','primary'));
  dialog.querySelector('#cite-style').dataset.ids=JSON.stringify(paperIds);await refreshCitation();
}
let lastCitation=null;
async function refreshCitation(){
  const select=document.querySelector('#cite-style');if(!select)return;
  const ids=JSON.parse(select.dataset.ids),result=await window.appApi.formatCitation(state.storageKey,ids,select.value,document.querySelector('#cite-locator').value);
  if(!document.querySelector('#cite-style'))return;lastCitation=result;
  document.querySelector('#cite-reference').innerHTML=result.references.map(r=>`<p>${r.html}</p>`).join('');document.querySelector('#cite-intext').textContent=result.citation;
}
document.addEventListener('input',event=>{if(event.target.id==='cite-locator')runDesktop(refreshCitation)();});
document.addEventListener('change',event=>{if(event.target.id==='cite-style'){try{localStorage.setItem('app-cite-style',event.target.value);}catch{}runDesktop(refreshCitation)();}});

// What became of the PDFs a bibliography file named: attached, left out by choice, or not found.
function attachmentReport(report){
  if(!report.attachments)return '';
  if(!report.withAttachments)return `<p>${tr('첨부파일 링크 {n}개는 가져오지 않았습니다(서지정보만 선택). PDF는 “PDF 첨부”로 각 항목에 추가할 수 있습니다.',{n:report.attachments})}</p>`;
  const failed=report.attachmentFailures||[],missing=report.attachments-(report.attached||0);
  return `<p>${report.attachmentFolder?tr('첨부파일 {n}개 중 {attached}개를 저장소의 <b>{folder}</b> 폴더로 복사해 붙였습니다.',{n:report.attachments,attached:report.attached||0,folder:esc(report.attachmentFolder)}):tr('첨부파일 {n}개 중 {attached}개를 저장소로 복사해 붙였습니다.',{n:report.attachments,attached:report.attached||0})}</p>${missing?`<p>${tr('붙이지 못한 첨부파일 {n}개:',{n:missing})}</p><ul class="small">${failed.slice(0,10).map(f=>`<li>${esc(f.name)} — ${esc(f.reason)} <span class="muted">(${esc(f.title)})</span></li>`).join('')}${missing>10?`<li class="muted">${tr('그 밖 {n}개',{n:missing-10})}</li>`:''}</ul>`:''}`;
}
function importReport(result){
  const unsupported=Object.entries(result.report.unsupported);
  modal(tr('서지정보 가져오기 결과'),`<p>${tr('{n}개 항목을 가져왔습니다.',{n:result.imported})}</p>${result.report.skipped.length?`<p>${tr('건너뛴 항목 {n}개: {list}',{n:result.report.skipped.length,list:result.report.skipped.slice(0,10).map(s=>tr('{index}번째({reason})',{index:s.index,reason:esc(s.reason)})).join(', ')})}</p>`:''}${unsupported.length?`<p>${tr('가져오지 않은 필드: {list}',{list:unsupported.map(([k,n])=>tr('{field} {n}개',{field:esc(k),n})).join(', ')})}</p>`:`<p>${tr('모든 필드를 가져왔습니다.')}</p>`}${attachmentReport(result.report)}<p class="small muted">${tr('컬렉션·메모·주석·필기는 서지 교환 파일로 옮겨지지 않습니다. 같은 DOI·PDF 중복 자료 후보는 “중복 자료 후보”에서 확인하세요.')}</p>`,btn(tr('닫기'),'close','primary'));
}
Object.assign(actions,{
  'edit-bibliography':editBibliography,
  'save-bibliography':runDesktop(saveStructuredBibliography),
  'lookup-doi':runDesktop(lookupDOIWithReview),
  'cite-paper':runDesktop(()=>citeDialog()),
  'copy-reference':runDesktop(async()=>{if(!lastCitation)return;await window.appApi.copyText(lastCitation.references.map(r=>r.text).join('\n'),lastCitation.references.map(r=>`<p>${r.html}</p>`).join(''));toast(tr('참고문헌을 복사했습니다.'));}),
  'copy-intext':runDesktop(async()=>{if(!lastCitation)return;await window.appApi.copyText(lastCitation.citation);toast(tr('본문 인용을 복사했습니다.'));}),
  'import-ris':runDesktop(async()=>{await desktopNotes();const result=await window.appApi.importBibliography(state.storageKey);if(!result)return;applyItemSnapshot(result.snapshot,{screen:'library'});importReport(result);}),
  'export-biblatex':runDesktop(async()=>{await desktopNotes();if(await window.appApi.exportBibliography(state.storageKey,'biblatex'))toast(tr('BibLaTeX를 저장했습니다.'));}),
  'export-csl':runDesktop(async()=>{await desktopNotes();if(await window.appApi.exportBibliography(state.storageKey,'csl'))toast(tr('CSL JSON을 저장했습니다.'));})
});
// The vault manager lists every exchange format next to RIS.
const baseVaultManager=showVaultManager;
showVaultManager=async function(){
  await baseVaultManager();
  const ris=dialog.querySelector('[data-action="import-ris"]');if(!ris||dialog.querySelector('[data-action="export-csl"]'))return;
  ris.textContent=tr('서지 가져오기 (RIS·BibTeX·CSL JSON)');
  dialog.querySelector('[data-action="export-bib"]').insertAdjacentHTML('afterend',`<button class="secondary small" data-action="export-biblatex">${tr('BibLaTeX 내보내기')}</button><button class="secondary small" data-action="export-csl">${tr('CSL JSON 내보내기')}</button>`);
};
actions['vault-manager']=runDesktop(showVaultManager);

// ---- Organization: nested collections, saved searches, batch edits ----
// A collection's mark (also the top-bar switch): stacked layers, so it is not taken for the vault's folder.
paths.collections='M12 3l9 5-9 5-9-5z M3 13l9 5 9-5';
let savedSearches=[],fullTextResults=null,fullTextTimer,fullTextQuery='';const batchSelection=new Set(),treeSelection=new Set();let batchAnchor=null,treeAnchor=null,pendingMove=null;
const baseApplySnapshot=applySnapshot;
applySnapshot=function(snapshot){savedSearches=snapshot.savedSearches||[];const other=state.storageKey!==snapshot.id;if(other){batchSelection.clear();treeSelection.clear();fullTextResults=null;contentSearchParts.clear();}baseApplySnapshot(snapshot);loadContentParts();};
function collectionChildren(parentId){return itemCollections.filter(c=>(c.parentId||null)===parentId).sort((a,b)=>a.name.localeCompare(b.name,'ko'));}
function collectionDescendants(id){const out=new Set([id]);let added=true;while(added){added=false;for(const c of itemCollections)if(c.parentId&&out.has(c.parentId)&&!out.has(c.id)){out.add(c.id);added=true;}}return out;}
function collectionPath(id){const names=[],seen=new Set();for(let c=itemCollections.find(x=>x.id===id);c&&!seen.has(c);c=itemCollections.find(x=>x.id===c.parentId)){seen.add(c);names.unshift(c.name);}return names.join(' / ');}
function collectionTree(parentId=null,depth=0){return collectionChildren(parentId).map(c=>`<button class="nav-btn collection-node ${state.collection===c.id?'active':''}" data-item-collection="${esc(c.id)}" style="--depth:${depth}" title="${esc(collectionPath(c.id))}">${icon('collections')}${esc(c.name)}</button>${collectionTree(c.id,depth+1)}`).join('');}
// ---- Collections of a paper: a footer pinned to the bottom of the right panel (like 저장소 관리·설정
// on the left) shows the ones it is in, each with ×; 지정 opens a picker where a click puts it in or
// takes it out, with a search and a box that makes a new one and puts the paper in it.
function collectionOrder(parentId=null){return collectionChildren(parentId).flatMap(c=>[c,...collectionOrder(c.id)]);}
function itemCollectionEditor(paper){
  if(!featureOn('collections'))return '';
  const mine=collectionOrder().filter(c=>paper.collectionIds.includes(c.id));
  return `<section class="collection-footer" data-collection-paper="${paper.id}"><div class="collection-footer-head">${icon('collections')}<strong>${tr('컬렉션')}</strong><span class="count">${mine.length}</span><button type="button" class="secondary small" data-collection-picker="${paper.id}" aria-haspopup="dialog" aria-expanded="false">${tr('지정')}</button></div><div class="collection-footer-chips">${mine.map(c=>`<span class="collection-chip" title="${esc(collectionPath(c.id))}">${c.parentId?`<span class="collection-parent">${esc(collectionPath(c.parentId))} / </span>`:''}${esc(c.name)}<button type="button" data-toggle-collection="${esc(c.id)}" aria-label="${tr('{collection}에서 빼기',{collection:esc(collectionPath(c.id))})}">×</button></span>`).join('')||`<span class="small muted">${tr('아직 없습니다. 지정을 누르거나, 라이브러리의 자료를 왼쪽 컬렉션으로 끌어다 놓으세요.')}</span>`}</div></section>`;
}
let collectionPicker=null;
function pickerRows(paper,query=''){
  const rows=collectionOrder().filter(c=>!query||collectionPath(c.id).toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  return rows.map(c=>{const on=paper.collectionIds.includes(c.id);return `<button type="button" role="menuitemcheckbox" aria-checked="${on}" class="picker-row" data-toggle-collection="${esc(c.id)}" style="--depth:${collectionPath(c.id).split(' / ').length-1}" title="${esc(collectionPath(c.id))}"><span class="picker-check" aria-hidden="true">${on?'✓':''}</span>${icon('collections')}<span class="picker-name">${esc(c.name)}</span></button>`;}).join('')||`<p class="small muted picker-empty">${itemCollections.length?tr('일치하는 컬렉션이 없습니다. 아래에 이름을 넣어 만드세요.'):tr('아직 컬렉션이 없습니다. 아래에 이름을 넣어 만드세요.')}</p>`;
}
function closeCollectionPicker(focus=false){if(!collectionPicker)return;const {el,paperId}=collectionPicker;collectionPicker=null;el.remove();const button=document.querySelector(`[data-collection-picker="${paperId}"]`);button?.setAttribute('aria-expanded','false');if(focus)button?.focus();}
function openCollectionPicker(button){
  closeCollectionPicker();const paperId=Number(button.dataset.collectionPicker),paper=papers.find(p=>p.id===paperId);if(!paper)return;
  const el=document.createElement('div');el.className='collection-picker';el.setAttribute('role','dialog');el.setAttribute('aria-label',tr('컬렉션 지정'));el.dataset.collectionPickerFor=paperId;
  el.innerHTML=`<input type="search" class="picker-search" placeholder="${tr('컬렉션 검색')}" aria-label="${tr('컬렉션 검색')}" autocomplete="off"><div class="picker-list" role="menu" aria-label="${tr('컬렉션')}">${pickerRows(paper)}</div><input class="collection-quick" data-quick-collection="${paperId}" maxlength="100" placeholder="${tr('새 컬렉션 이름 + Enter')}" aria-label="${tr('새 컬렉션을 만들어 이 자료 넣기')}">`;
  document.body.append(el);button.setAttribute('aria-expanded','true');collectionPicker={el,paperId};
  const box=button.getBoundingClientRect(),size=el.getBoundingClientRect();
  el.style.left=Math.max(8,Math.min(box.right-size.width,innerWidth-size.width-8))+'px';el.style.top=Math.max(8,box.top-size.height-6)+'px';
  el.querySelector('.picker-search').focus();
}
function refreshCollectionPicker(){if(!collectionPicker)return;const paper=papers.find(p=>p.id===collectionPicker.paperId),list=collectionPicker.el.querySelector('.picker-list');if(paper&&list)list.innerHTML=pickerRows(paper,collectionPicker.el.querySelector('.picker-search').value.trim());}
async function toggleItemCollection(paperId,collectionId){
  const id=state.storageKey,paper=papers.find(p=>p.id===paperId);if(!paper)return;
  const on=paper.collectionIds.includes(collectionId);
  await window.appApi.batchUpdate(id,[paperId],on?{removeCollection:collectionId}:{addCollection:collectionId});
  if(state.storageKey!==id)return;
  paper.collectionIds=on?paper.collectionIds.filter(c=>c!==collectionId):[...paper.collectionIds,collectionId];
  refreshItemControls(paper);refreshCollectionPicker();
  (collectionPicker?.el.querySelector(`[data-toggle-collection="${CSS.escape(collectionId)}"]`)||document.querySelector(`[data-collection-picker="${paperId}"]`))?.focus();
}
async function quickCollection(input){
  const name=input.value.trim(),paperId=Number(input.dataset.quickCollection),id=state.storageKey,paper=papers.find(p=>p.id===paperId);if(!name||!paper)return;
  const existing=itemCollections.find(c=>!c.parentId&&c.name===name);
  if(existing&&paper.collectionIds.includes(existing.id)){input.value='';toast(tr('이미 “{collection}”에 들어 있습니다.',{collection:name}));return;}
  input.disabled=true;
  try{
    await desktopNotes();
    let collectionId=existing?.id;
    if(!collectionId){const before=new Set(itemCollections.map(c=>c.id)),created=await window.appApi.createCollection(id,name,null);collectionId=created.collections.find(c=>!before.has(c.id))?.id;}
    if(!collectionId||state.storageKey!==id)return;
    const snapshot=await window.appApi.batchUpdate(id,[paperId],{addCollection:collectionId});if(state.storageKey!==id)return;
    closeCollectionPicker();applyItemSnapshot(snapshot);toast(existing?tr('“{collection}”에 넣었습니다.',{collection:name}):tr('“{collection}” 컬렉션을 만들고 넣었습니다.',{collection:name}));document.querySelector(`[data-collection-picker="${paperId}"]`)?.focus();
  }finally{if(input.isConnected)input.disabled=false;}
}
document.addEventListener('click',event=>{
  const opener=event.target.closest('[data-collection-picker]');if(opener){if(collectionPicker?.paperId===Number(opener.dataset.collectionPicker))closeCollectionPicker();else openCollectionPicker(opener);return;}
  const chip=event.target.closest('[data-toggle-collection]');
  if(chip){const host=chip.closest('[data-collection-paper],[data-collection-picker-for]'),paperId=Number(host.dataset.collectionPaper||host.dataset.collectionPickerFor);runDesktop(()=>toggleItemCollection(paperId,chip.dataset.toggleCollection))();return;}
  if(collectionPicker&&!collectionPicker.el.contains(event.target))closeCollectionPicker();
});
document.addEventListener('input',event=>{if(event.target.matches?.('.picker-search'))refreshCollectionPicker();});
document.addEventListener('keydown',event=>{
  if(event.key==='Enter'&&!event.isComposing&&event.target.matches?.('[data-quick-collection]')){event.preventDefault();runDesktop(()=>quickCollection(event.target))();return;}
  if(!collectionPicker||!collectionPicker.el.contains(event.target))return;
  if(event.key==='Escape'){event.preventDefault();event.stopPropagation();closeCollectionPicker(true);return;}
  if(['ArrowDown','ArrowUp'].includes(event.key)){event.preventDefault();const items=[...collectionPicker.el.querySelectorAll('.picker-search,.picker-row,.collection-quick')],at=items.indexOf(event.target);items[(at+(event.key==='ArrowDown'?1:items.length-1))%items.length]?.focus();}
  if(event.key==='Enter'&&event.target.matches('.picker-search')){event.preventDefault();const first=collectionPicker.el.querySelector('.picker-row');if(first)first.click();else{const quick=collectionPicker.el.querySelector('.collection-quick');quick.value=event.target.value;quick.focus();}}
},true);
// Papers dragged from the list onto a sidebar collection or tag join it (the checked ones, when the
// dragged paper is checked). Dropped on a folder of the file tree, their main PDFs move there; a file
// dragged inside the tree moves itself (a notice offers to move it back).
const PAPER_DRAG='application/x-app-papers',FILE_DRAG='application/x-app-files';
const paperDrag=event=>Array.from(event.dataTransfer?.types||[]).includes(PAPER_DRAG);
const dropTarget=event=>event.target.closest?.('[data-item-collection],[data-tag-drop],[data-folder-drop]');
function dragLabel(event,text){const label=document.createElement('div');label.className='paper-drag-label';label.textContent=text;document.body.append(label);event.dataTransfer.setDragImage(label,12,12);setTimeout(()=>label.remove(),0);}
document.addEventListener('dragstart',event=>{
  const file=event.target.closest?.('.vault-file[data-tree-file]'),row=event.target.closest?.('.paper-item[data-paper]');if(!file&&!row)return;
  if(file){
    const paperId=Number(file.dataset.treeFile),attachmentId=file.dataset.attachmentId,picked=treeSelection.has(treeKey(paperId,attachmentId))?selectedTreeFiles():[],list=picked.length>1?picked:[{paperId,attachmentId}];
    event.dataTransfer.setData(PAPER_DRAG,JSON.stringify([...new Set(list.map(f=>f.paperId))]));event.dataTransfer.setData(FILE_DRAG,JSON.stringify(list));
    event.dataTransfer.setData('text/plain',file.textContent.trim());event.dataTransfer.effectAllowed='copyMove';dragLabel(event,list.length>1?tr('파일 {n}개',{n:list.length}):file.textContent.trim());
  }else{
    const id=Number(row.dataset.paper),ids=batchSelection.has(id)?[...batchSelection].filter(x=>papers.some(p=>p.id===x)):[id];
    event.dataTransfer.setData(PAPER_DRAG,JSON.stringify(ids));event.dataTransfer.setData('text/plain',ids.map(x=>papers.find(p=>p.id===x)?.title||'').join('\n'));event.dataTransfer.effectAllowed='copyMove';
    dragLabel(event,ids.length>1?tr('자료 {n}개',{n:ids.length}):papers.find(p=>p.id===id)?.title||tr('자료'));
  }
  document.body.classList.add('dragging-papers');
});
document.addEventListener('dragend',()=>{document.body.classList.remove('dragging-papers');document.querySelectorAll('.drop-target').forEach(el=>el.classList.remove('drop-target'));});
document.addEventListener('dragover',event=>{const target=dropTarget(event);if(!target||!paperDrag(event))return;event.preventDefault();event.dataTransfer.dropEffect=target.dataset.folderDrop!==undefined?'move':'copy';document.querySelectorAll('.drop-target').forEach(el=>el!==target&&el.classList.remove('drop-target'));target.classList.add('drop-target');});
document.addEventListener('dragleave',event=>{const target=dropTarget(event);if(target&&!target.contains(event.relatedTarget))target.classList.remove('drop-target');});
document.addEventListener('drop',event=>{
  const target=dropTarget(event);if(!target||!paperDrag(event))return;event.preventDefault();target.classList.remove('drop-target');document.body.classList.remove('dragging-papers');
  let ids=[],files=null;try{ids=JSON.parse(event.dataTransfer.getData(PAPER_DRAG)).filter(x=>papers.some(p=>p.id===x));files=JSON.parse(event.dataTransfer.getData(FILE_DRAG)||'null');}catch{}
  if(!ids.length)return;
  if(target.dataset.folderDrop!==undefined){runDesktop(()=>moveToFolder(target.dataset.folderDrop,files||mainFiles(ids)))();return;}
  if(target.dataset.tagDrop!==undefined){runDesktop(()=>giveTag(target.dataset.tagDrop,ids))();return;}
  const collectionId=target.dataset.itemCollection,id=state.storageKey;
  runDesktop(async()=>{await desktopNotes();const snapshot=await window.appApi.batchUpdate(id,ids,{addCollection:collectionId});if(state.storageKey!==id)return;applyItemSnapshot(snapshot,{screen:'library'});toast(ids.length>1?tr('자료 {n}개를 “{collection}”에 넣었습니다.',{n:ids.length,collection:collectionPath(collectionId)}):tr('자료를 “{collection}”에 넣었습니다.',{collection:collectionPath(collectionId)}));})();
});
// The main PDF of each paper (the primary attachment, else its first original file).
function mainFiles(ids){return ids.map(paperId=>{const p=papers.find(x=>x.id===paperId);if(!p)return null;const a=p.attachments.find(x=>x.id===p.primaryAttachmentId&&x.file)||p.attachments.find(x=>x.file&&x.role!=='translated');return a&&{paperId,attachmentId:a.id};}).filter(Boolean);}
// Moves PDFs into a folder of the vault, keeping their names; ones already there are left as they are.
async function moveToFolder(folder,files,{undo=true}={}){
  const id=state.storageKey,moves=[],failed=[];let snapshot=null;
  for(const {paperId,attachmentId} of files){
    const a=papers.find(p=>p.id===paperId)?.attachments.find(x=>x.id===attachmentId);if(!a||!a.file||(a.folder||'')===folder)continue;
    try{snapshot=await window.appApi.moveAttachment(id,paperId,attachmentId,folder,a.fileName||a.name);moves.push({paperId,attachmentId,from:a.folder||'',name:a.fileName||a.name});}
    catch(error){failed.push(`${a.fileName||a.name}: ${plainError(error)}`);}
    if(state.storageKey!==id)return;
  }
  if(snapshot){await desktopNotes();expandedFolders.add(folder);applyItemSnapshot(snapshot);}
  const place=folder?`“${folder}”`:tr('저장소 맨 위');
  if(failed.length)modal(tr('파일 이동'),`<p>${moves.length?`${tr('{n}개를 {place}로 옮겼습니다.',{n:moves.length,place:esc(place)})} `:''}${tr('옮기지 못한 파일:')}</p>${failed.map(f=>`<p class="small">${esc(f)}</p>`).join('')}`,btn(tr('닫기'),'close'));
  else if(!moves.length)toast(folder?tr('이미 {place}에 있습니다.',{place}):tr('이미 저장소 맨 위에 있습니다.'));
  else if(undo)undoToast(moves.length>1?tr('파일 {n}개를 {place}로 옮겼습니다.',{n:moves.length,place}):tr('“{name}”을 {place}로 옮겼습니다.',{name:moves[0].name,place}),async()=>{for(const m of moves)await moveToFolder(m.from,[{paperId:m.paperId,attachmentId:m.attachmentId}],{undo:false});toast(tr('파일을 원래 폴더로 되돌렸습니다.'));});
}
// A click on a tag, a collection or a folder redraws the screen; the sidebar stays where it was.
const baseRenderTags=render;
render=function(){closeCollectionPicker();keepSidebarScroll(baseRenderTags);};
// Sidebar views (renderer.js): saved searches, and collections when the feature is on.
addSidebarView({id:'searches',title:tr('저장 검색'),order:20,weight:.6,visible:()=>savedSearches.length>0,body:()=>`<div class="saved-search-list">${savedSearches.map(s=>`<div class="saved-search-row"><button class="nav-btn" data-saved-search="${esc(s.id)}" title="${esc(s.query||tr('검색어 없음'))}">${icon('search')}${esc(s.name)}</button><button class="saved-search-delete" data-delete-search="${esc(s.id)}" aria-label="${tr('{name} 저장 검색 삭제',{name:esc(s.name)})}">×</button></div>`).join('')}</div>`});
addSidebarView({id:'collections',title:tr('컬렉션'),order:40,weight:1,pinBottom:true,visible:()=>featureOn('collections'),actions:()=>`<button data-action="new-collection" aria-label="${tr('새 컬렉션')}" title="${tr('새 컬렉션')}">${icon('plus')}</button>`,body:()=>`<div class="collection-tree">${collectionTree()||`<p class="small muted section-empty">${tr('+로 컬렉션을 만드세요.')}</p>`}</div>`});
// A collection shows its sub-collections' papers too; full-text mode lists PDF matches.
const baseFiltered=filtered;
filtered=function(){
  const collection=featureOn('collections')?state.collection:null,query=state.query,fullText=state.fullText&&query.trim();
  const kept=state.collection,nav=state.nav;state.collection=null;if(kept)state.nav='';if(fullText)state.query='';
  let list;try{list=baseFiltered();}finally{state.collection=kept;state.nav=nav;state.query=query;}
  if(collection){const ids=collectionDescendants(collection);list=list.filter(p=>p.collectionIds.some(id=>ids.has(id)));}
  if(fullText)list=fullTextResults?.query===query.trim()?list.filter(p=>fullTextResults.byPaper.has(p.id)):[];
  return list;
};
const basePaperRows=paperRows;
paperRows=function(){
  if(state.fullText&&state.query.trim()&&fullTextResults?.query!==state.query.trim())return `<div class="empty">${tr('PDF 본문을 검색하는 중입니다. 처음 검색할 때는 PDF마다 텍스트 색인을 만듭니다.')}</div>`;
  return basePaperRows().replace(/<article tabindex="0" role="button" aria-label="([^"]*)" class="paper-item([^"]*)" data-paper="(\d+)">/g,(m,label,cls,id)=>`<article tabindex="0" role="button" aria-label="${label}" class="paper-item${cls}" data-paper="${id}" data-kn-part="paper-row" draggable="true"><input type="checkbox" class="batch-check" data-batch-paper="${id}" aria-label="${tr('{label} 일괄 편집 선택',{label})}" ${batchSelection.has(Number(id))?'checked':''}>`)
    .replace(/<button class="star" data-star="(\d+)"/g,(m,id)=>{const hit=state.fullText&&fullTextResults?.byPaper.get(Number(id)),paper=papers.find(p=>p.id===Number(id));return (paper?progressBadge(paper):'')+contentHitsHtml(Number(id))+(hit?`<p class="fulltext-hit">${hit.map(r=>tr('{name} · {n}쪽 일치 · p.{page} “{snippet}”',{name:esc(r.name),n:r.count,page:r.hits[0].page,snippet:esc(r.hits[0].snippet)})).join('<br>')}</p>`:'')+m;});
};
// 전체 선택 (the box at the start of the filter row) follows the selection: checked when every item
// the list shows is selected, half-set when some are.
function syncSelectAll(){const box=document.querySelector('#select-all');if(!box)return;const list=filtered(),n=list.filter(p=>batchSelection.has(p.id)).length;box.checked=list.length>0&&n===list.length;box.indeterminate=n>0&&n<list.length;box.disabled=!list.length;}
const baseLibrary=library;
library=function(){
  queueMicrotask(syncSelectAll); // once this markup is on the page: the half-selected state cannot be written in HTML
  const html=baseLibrary().replace('<button class="secondary" data-action="duplicates">',`<button class="secondary" data-action="save-search">${tr('검색 저장')}</button><button class="secondary" data-action="duplicates">`)
    .replace('<div class="filters">',`${state.query.trim()?`<div class="search-banner" role="status">${icon('search')}<span>${tr('전체 자료에서 “<b>{query}</b>” 검색',{query:esc(state.query.trim())})}${state.fullText?` · ${tr('PDF 본문 포함')}`:` · ${tr('{n}개',{n:filtered().length})}`}</span><button type="button" class="secondary small" data-action="clear-search">${tr('검색 지우기')}</button></div>`:''}<div class="filters"><label class="select-all" title="${tr('목록에 보이는 자료를 모두 선택하거나 선택을 풉니다')}"><input type="checkbox" id="select-all" ${filtered().length&&filtered().every(p=>batchSelection.has(p.id))?'checked':''} ${filtered().length?'':'disabled'}> ${tr('전체 선택')}</label>`)
    // PDF 본문 검색 is a switch, beside the sort order at the row's end.
    .replace('<select id="sort"',`<span class="filters-end"><label class="fulltext-toggle"><span>${tr('PDF 본문 검색')}</span><input type="checkbox" role="switch" class="switch" id="fulltext-toggle" ${state.fullText?'checked':''}></label><select id="sort"`).replace('</select></div><div class="paper-list"','</select></span></div><div class="paper-list"');
  return html.replace('<div class="paper-list" id="paper-list">',`${batchBar()}<div class="paper-list" id="paper-list">`);
};
// The selected items go to the vault's trash, or are deleted with their files, one after another:
// one that fails is counted and the rest go on.
async function removeSelected(withFiles){
  const vault=state.storageKey,ids=[...batchSelection].filter(id=>papers.some(p=>p.id===id));if(!ids.length)return;
  await desktopNotes();if(dialog.open)dialog.close();
  let snapshot=null,done=0;const failed=[],files=[];
  for(const paperId of ids){
    try{snapshot=withFiles?await window.appApi.deletePaper(vault,paperId):await window.appApi.trashPaper(vault,paperId);done++;batchSelection.delete(paperId);files.push(...(snapshot.deleteReport?.failed||[]));}
    catch(error){failed.push(error);}
    if(state.storageKey!==vault)return;
  }
  if(withFiles)await(await pdfEngine()).clearDocuments?.();
  if(snapshot)applyItemSnapshot(snapshot,{screen:'library'});
  const notes=[failed.length?tr('{n}개는 처리하지 못했습니다({error})',{n:failed.length,error:String(failed[0]?.message&&shownError(failed[0])||failed[0]).slice(0,80)}):'',files.length?tr('파일 {n}개는 지우지 못해 저장소 폴더에 남았습니다',{n:files.length}):''].filter(Boolean).join('. ');
  toast(`${withFiles?tr('{n}개 자료를 삭제했습니다.',{n:done}):tr('{n}개 자료를 휴지통으로 옮겼습니다.',{n:done})}${notes?' '+notes+'.':''}`);
}
function batchBar(){
  const ids=[...batchSelection].filter(id=>papers.some(p=>p.id===id));
  // Grouped by what they act on: the files, how items are sorted, their bibliography; removal stands
  // apart at the end. Three columns: the count, the groups (which wrap among themselves, so a second
  // row starts under the first group), and removal. <!--batch-file--> and <!--batch-ai--> are where later scripts add their buttons.
  if(!ids.length)return '';
  const pick=(id,label,first,options)=>`<span class="batch-pick-wrap"><select id="${id}" class="batch-pick" aria-label="${label}"><option value="">${first}</option>${options}</select></span>`;
  return `<div class="batch-bar" role="toolbar" aria-label="${tr('선택한 자료 일괄 편집')}"><span class="batch-count"><strong>${tr('{n}개 선택',{n:ids.length})}</strong><button type="button" class="batch-clear" data-action="batch-clear">${tr('선택 해제')}</button></span><span class="batch-groups">`
    +`<span class="batch-group" role="group" aria-label="${tr('파일')}">${mainFiles(ids).length?`<button class="secondary small" data-action="batch-move" title="${tr('선택한 자료의 PDF를 한 폴더로 옮깁니다')}">${tr('폴더로 이동…')}</button>`:''}<!--batch-file--></span>`
    +`<span class="batch-group" role="group" aria-label="${tr('분류')}"><button class="secondary small" data-action="batch-tag">${tr('태그 지정')}</button>${pick('batch-status',tr('읽기 상태 일괄 변경'),tr('읽기 상태'),['읽기 전','읽는 중','완독'].map(v=>`<option value="${v}">${valueLabel(v)}</option>`).join(''))}${featureOn('collections')&&itemCollections.length?pick('batch-collection',tr('컬렉션에 일괄 추가'),tr('컬렉션에 추가'),itemCollections.map(c=>`<option value="${esc(c.id)}">${esc(collectionPath(c.id))}</option>`).join('')):''}</span>` // i18n:keep — read-status values
    +`<span class="batch-group" role="group" aria-label="${tr('서지')}"><button class="secondary small" data-action="batch-autofill" title="${tr('PDF의 DOI·제목으로 빈 서지정보를 채웁니다')}">${tr('자동 채우기')}</button><button class="secondary small" data-action="batch-cite">${tr('인용 복사')}</button>${pick('batch-export',tr('선택 항목 내보내기'),tr('내보내기'),'<option value="ris">RIS</option><option value="bib">BibTeX</option><option value="biblatex">BibLaTeX</option><option value="csl">CSL JSON</option>')}</span>`
    +`<!--batch-ai--></span><span class="batch-end"><button class="secondary small danger" data-action="batch-delete" title="${tr('선택한 자료를 휴지통으로 옮기거나 삭제합니다')}">${tr('삭제…')}</button></span></div>`;
}
function refreshLibraryList(){const list=document.querySelector('#paper-list');if(!list)return;const bar=document.querySelector('.batch-bar'),html=batchBar();if(bar)bar.outerHTML=html||'<span hidden class="batch-bar"></span>';else if(html)list.insertAdjacentHTML('beforebegin',html);list.innerHTML=paperRows();syncSelectAll();}
// PDFs not yet indexed are read once by the PDF.js worker, one at a time.
let indexing=null;
async function indexFullText(id){
  const missing=(await window.appApi.fullTextTargets(id)).filter(t=>!t.indexed);if(!missing.length)return;
  const pdfjs=await import('./pdfjs/pdf.mjs');pdfjs.GlobalWorkerOptions.workerSrc||=new URL('./pdfjs/pdf.worker.mjs',location.href).href;
  for(const [i,target] of missing.entries()){
    if(id!==state.storageKey)return;
    const list=document.querySelector('#paper-list');if(list&&state.fullText)list.innerHTML=`<div class="empty" role="status">${tr('PDF 본문 색인 중 {n}/{total} · {name}',{n:i+1,total:missing.length,name:esc(target.name)})}</div>`;
    const pages=[];let task;
    // Only a PDF that PDF.js cannot read is stored as empty (shown as excluded);
    // a failed read (vault switching, file busy) is retried on the next search.
    let data;try{data=await window.appApi.readOriginal(id,target.paperId,target.attachmentId);}catch{continue;}
    try{task=pdfjs.getDocument({data:new Uint8Array(data.bytes),isEvalSupported:false,cMapUrl:new URL('./pdfjs/cmaps/',location.href).href,cMapPacked:true,standardFontDataUrl:new URL('./pdfjs/standard_fonts/',location.href).href});const pdf=await task.promise;for(let n=1;n<=pdf.numPages;n++){const page=await pdf.getPage(n),content=await page.getTextContent();pages.push(content.items.map(item=>(item.str||'')+(item.hasEOL?'\n':' ')).join('').replace(/[ \t]+/g,' ').trim());page.cleanup();}}
    catch{pages.length=0;}finally{await task?.destroy();}
    await window.appApi.fullTextStore(target.hash,pages);
  }
}
async function runFullText(){
  const query=state.query.trim(),id=state.storageKey;if(!state.fullText||!query)return;
  indexing||=indexFullText(id).finally(()=>{indexing=null;});await indexing;
  if(id!==state.storageKey||query!==state.query.trim()||!state.fullText)return;
  const result=await window.appApi.fullTextSearch(id,query);if(id!==state.storageKey||query!==state.query.trim()||!state.fullText)return;
  const byPaper=new Map();for(const r of result.results)byPaper.set(r.paperId,[...(byPaper.get(r.paperId)||[]),r]);
  fullTextResults={query,byPaper,unreadable:result.unreadable};refreshLibraryList();
  if(result.unreadable.length||result.missing.length)toast(tr('텍스트를 읽을 수 없는 PDF {n}개는 제외했습니다(스캔·암호화·손상 PDF).',{n:result.unreadable.length+result.missing.length}));
}
// ---- Top search: typing shows a short result list under the box; nothing changes until a choice ----
// Enter or `전체 검색` opens the whole-library results in the list (with the PDF body option);
// a result row opens that paper. The list filters only by what was applied (state.query).
const SEARCH_POP_LIMIT=8;let searchPop=null,searchPick=-1;
function searchMatches(text){
  const q=searchText(text.trim());if(!q)return [];
  const hits=availablePapers().filter(p=>(paperSearchIndex.get(p.id)||'').includes(q));
  const rank=p=>p.title.toLowerCase().includes(q)?0:`${p.authors} ${p.tags.join(' ')}`.toLowerCase().includes(q)?1:2;
  return hits.sort((a,b)=>rank(a)-rank(b)||(b.year||0)-(a.year||0));
}
function markQuery(text,q){const at=text.toLowerCase().indexOf(q.toLowerCase());return at<0||!q?esc(text):`${esc(text.slice(0,at))}<mark>${esc(text.slice(at,at+q.length))}</mark>${esc(text.slice(at+q.length))}`;}
function closeSearchPop(){searchPop?.remove();searchPop=null;searchPick=-1;document.querySelector('#search')?.setAttribute('aria-expanded','false');}
function drawSearchPop(){
  const input=document.querySelector('#search'),text=input?.value||'';if(!input||!text.trim()){closeSearchPop();return;}
  const all=searchMatches(text),shown=all.slice(0,SEARCH_POP_LIMIT),q=text.trim();
  if(!searchPop){searchPop=document.createElement('div');searchPop.className='search-pop';searchPop.id='search-pop';searchPop.setAttribute('role','listbox');searchPop.setAttribute('aria-label',tr('검색 결과'));document.body.append(searchPop);}
  searchPick=Math.min(searchPick,shown.length-1);
  const meta=p=>[String(p.authors||'').split(/[,;]| and /)[0].trim(),p.year,p.journal].filter(Boolean).join(' · ');
  searchPop.innerHTML=`${shown.length?shown.map((p,i)=>`<button type="button" role="option" class="search-hit${i===searchPick?' active':''}" aria-selected="${i===searchPick}" data-search-hit="${p.id}"><span class="search-hit-title">${markQuery(p.title,q)}</span><span class="search-hit-meta">${esc(meta(p))}${p.tags.length?` <span class="search-hit-tags">${p.tags.slice(0,3).map(t=>'#'+esc(t)).join(' ')}</span>`:''}</span></button>`).join(''):`<p class="search-none">${tr('제목·저자·태그·메모·주석에서 찾지 못했습니다.')}</p>`}<div class="search-pop-foot"><button type="button" class="search-all" data-search-all="">${icon('search')}<span>${tr('전체 검색')}${all.length>shown.length?` · ${tr('{n}개 모두 보기',{n:all.length})}`:all.length?` · ${tr('{n}개',{n:all.length})}`:''}</span><kbd>Enter</kbd></button><button type="button" class="search-all" data-search-all="fulltext">${tr('PDF 본문까지 검색')}</button></div>`;
  const box=input.closest('.search')||input,r=box.getBoundingClientRect(),width=Math.max(r.width,360);
  Object.assign(searchPop.style,{top:`${r.bottom+6}px`,left:`${Math.max(8,Math.min(r.left,innerWidth-width-8))}px`,width:`${width}px`});
  input.setAttribute('aria-expanded','true');input.setAttribute('aria-controls','search-pop');
}
function applySearch(text,fullText=false){
  const query=text.trim();closeSearchPop();
  Object.assign(state,{screen:'library',query,folder:null,collection:null,desktopTag:null,savedSearch:null,nav:'전체 자료',filter:'전체',fullText:Boolean(fullText&&query)||(state.fullText&&Boolean(query))}); // i18n:keep — navigation and filter values
  fullTextResults=null;persistTreeState();render();runDesktop(runFullText)();
}
function openSearchHit(paperId){
  closeSearchPop();const paper=papers.find(p=>p.id===paperId);if(!paper)return;
  const input=document.querySelector('#search');if(input)input.value=state.query;
  if(paper.attachments.some(a=>a.file)){runDesktop(()=>openItemFile(paperId))();return;}
  Object.assign(state,{screen:'library',query:'',folder:null,collection:null,desktopTag:null,savedSearch:null,nav:'전체 자료',filter:'전체',selected:paperId});render(); // i18n:keep — navigation and filter values
}
// ---- Where a search found something in a paper (memos, summaries, annotations, text boxes, notebooks) ----
// Under the paper's row: the first places, each with its kind, its page and the words around what was found; "외 n곳"
// shows the rest. A place opens the paper there: the memo or summary opened with the words chosen, the annotation and
// its page, the text box's page with the box outlined, the notebook at that page and item.
const CONTENT_HITS_SHOWN=3,contentHitsOpen=new Set(),contentHitsOf=new Map();
function contentSnippet(text,q){
  const plain=String(text??'').normalize('NFC').replace(/\s+/g,' '),at=plain.toLowerCase().indexOf(q);if(at<0)return null;
  const from=Math.max(0,at-30),to=Math.min(plain.length,at+q.length+50);
  return `${from>0?'…':''}${esc(plain.slice(from,at))}<mark>${esc(plain.slice(at,at+q.length))}</mark>${esc(plain.slice(at+q.length,to))}${to<plain.length?'…':''}`;
}
function contentHits(paper,query){
  const q=searchText(query.trim());if(!q)return [];const hits=[],memoKeys=memoKeysOf(paper.id);
  const add=(hit,text)=>{const snippet=contentSnippet(text,q);if(snippet)hits.push({...hit,snippet});};
  for(const [key,value] of noteSearchParts.get(paper.id)||[]){
    const base=key.endsWith('#title')?key.slice(0,-6):key;if(base.includes('#'))continue;
    const summary=summaryIndex(base);if(summary!==null){add({kind:'summary',key:base,index:summary,label:tr('요약')},value);continue;}
    if(memoKeys.includes(base))add({kind:'memo',key:base,label:tr('메모 · {title}',{title:memoTitle(base,memoKeys.indexOf(base))})},value);
  }
  for(const a of itemAnnotations.filter(a=>a.paperId===paper.id))add({kind:'annotation',id:a.id,attachmentId:a.attachmentId,page:a.page,label:tr('주석 {page}쪽',{page:a.page})},`${a.title||''} ${a.quote||''} ${a.body||''}`);
  for(const part of contentSearchParts.get(paper.id)||[]){
    if(part.kind==='textbox')add({...part,label:part.surface==='original'?tr('텍스트 상자 {page}쪽',{page:part.page}):tr('번역 {page}쪽 텍스트 상자',{page:part.page})},part.text);
    else add({...part,label:part.page?tr('노트북 ‘{title}’ {page}쪽',{title:part.notebookTitle,page:part.page}):tr('노트북 ‘{title}’',{title:part.notebookTitle})},part.text);
  }
  return hits;
}
function contentHitsHtml(paperId){
  const paper=papers.find(p=>p.id===paperId);if(!paper||!state.query.trim())return '';
  const hits=contentHits(paper,state.query);contentHitsOf.set(paperId,hits);if(!hits.length)return '';
  const open=contentHitsOpen.has(paperId),shown=open?hits:hits.slice(0,CONTENT_HITS_SHOWN),rest=hits.length-shown.length;
  return `<div class="content-hits" data-kn-part="search-hits">${shown.map((h,i)=>`<button type="button" class="content-hit" data-content-hit="${paperId}:${i}"><span class="content-hit-kind">${esc(h.label)}</span> <span class="content-hit-text">${h.snippet}</span></button>`).join('')}${rest?`<button type="button" class="content-hits-more" data-content-more="${paperId}">${tr('외 {n}곳',{n:rest})}</button>`:open&&hits.length>CONTENT_HITS_SHOWN?`<button type="button" class="content-hits-more" data-content-more="${paperId}">${tr('접기')}</button>`:''}</div>`;
}
document.addEventListener('click',event=>{
  const more=event.target.closest?.('[data-content-more]');
  if(more){event.preventDefault();event.stopPropagation();const id=Number(more.dataset.contentMore);if(contentHitsOpen.has(id))contentHitsOpen.delete(id);else contentHitsOpen.add(id);refreshLibraryList();return;}
  const button=event.target.closest?.('[data-content-hit]');if(!button)return;event.preventDefault();event.stopPropagation();
  const [id,i]=button.dataset.contentHit.split(':').map(Number),hit=contentHitsOf.get(id)?.[i];if(hit)runDesktop(()=>openContentHit(id,hit))();
},true);
// The words of a memo or summary found, chosen in its editor (when its text is as it was searched).
function chooseFound(area,q){const editor=area&&fieldEditorOf(area);if(!editor)return;const doc=editor.view.state.doc.toString();if(doc.normalize('NFC')!==doc)return;const at=doc.toLowerCase().indexOf(q);if(at<0)return;
  editor.view.dispatch({selection:{anchor:at,head:at+q.length},scrollIntoView:true});editor.view.focus();}
// A place outlined for a moment.
function flashFound(node){if(!node)return;node.classList.add('search-flash');setTimeout(()=>node.classList.remove('search-flash'),1800);}
async function openContentHit(paperId,hit){
  const paper=papers.find(p=>p.id===paperId);if(!paper)return;const q=searchText(state.query.trim());
  if(!paper.attachments.some(a=>a.file)){openSearchHit(paperId);return;}
  const attachment=hit.attachmentId&&paper.attachments.some(a=>a.id===hit.attachmentId&&a.file)?hit.attachmentId:undefined;
  await openItemFile(paperId,attachment);if(state.selected!==paperId)return;
  const mode=m=>{if(state.mode!==m)document.querySelector(`[data-mode="${m}"]`)?.click();};
  if(hit.kind==='memo'||hit.kind==='summary'){
    if(hit.kind==='memo'){openMemoKey=hit.key;showPanelTab('메모');} // i18n:keep — tab value
    else{openSummary=hit.index;showPanelTab('요약');} // i18n:keep — tab value
    const area=await pinWait(()=>{syncLiveFields();return document.querySelector(hit.kind==='memo'?`.memo-card.open[data-memo="${CSS.escape(hit.key)}"] .note-box textarea`:`.summary-card.open[data-summary="${hit.index}"] textarea`);});
    flashFound(area?.closest('.memo-card'));scrollWithin(area?.closest('.memo-card'),{block:'nearest'});setTimeout(()=>chooseFound(area,q),60);return;
  }
  if(hit.kind==='annotation'){if(!['original','dual'].includes(state.mode))mode('original');globalThis.appShowAnnotation?.(hit.id);await pinWait(()=>document.querySelector('.original-pages .page'));goToPage(hit.page);return;}
  if(hit.kind==='textbox'){
    mode(hit.surface==='original'?(state.mode==='dual'?'dual':'original'):'translated');
    const container=await pinWait(()=>{const c=document.querySelector(hit.surface==='original'?'.original-pages':'.translated-pane .translated-pages');return c?.inkDoc&&c.inkSurface===hit.surface?c:null;},8000);
    if(!container){goToPage(hit.page);toast(tr('그 텍스트 상자는 지금 보이는 번역에 없습니다.'));return;}
    goToPage(hit.page);await container.inkDoc.loaded;const view=await pinWait(()=>{const v=container.pdfViewer?.getPageView(hit.page-1);return v?.div?.dataset.ready?v:null;});const stroke=container.inkDoc.strokes.get(hit.id);
    if(view&&stroke)globalThis.appInk?.flashTextBox?.(view,stroke);return;
  }
  if(hit.kind==='notebook'){
    mode('notebook');if(!await pinWait(()=>document.querySelector('.notebook-pane .nb-body[data-mounted]')&&nb.key===state.storageKey+':'+state.selected))return;
    if(nb.id!==hit.notebookId){await nbFlush();nb.id=hit.notebookId;nb.doc=await window.appApi.notebookGet(state.storageKey,nb.id);try{localStorage.setItem('app-notebook-'+nb.key,nb.id);}catch{}nb.status='';nbRender();}
    if(!hit.pageId)return;const page=await pinWait(()=>nbPageEl(hit.pageId));if(!page)return;nbShowPage(page);
    const item=page.querySelector(`[data-item-id="${CSS.escape(hit.id)}"]`);if(item){scrollWithin(item,{block:'center'});flashFound(item);}
    else{const list=document.querySelector('.nb-pages'),p=nb.doc.pages.find(x=>x.id===hit.pageId);if(list&&p)list.scrollTop+=(Number(hit.y)||0)/p.height*page.getBoundingClientRect().height-list.clientHeight/3;}
  }
}
// Capture runs before the base UI's handler (app.js), which would switch screens and filter as you type.
document.addEventListener('input',event=>{
  if(event.target.id!=='search')return;event.stopImmediatePropagation();
  // Emptying the box (or its ✕) drops an applied search.
  if(!event.target.value.trim()&&state.query){state.query='';fullTextResults=null;closeSearchPop();if(state.screen==='library')refreshLibraryList();return;}
  searchPick=-1;drawSearchPop();
},true);
document.addEventListener('keydown',event=>{
  if(event.target.id!=='search'||event.isComposing)return;
  const hits=searchPop?[...searchPop.querySelectorAll('[data-search-hit]')]:[];
  if(event.key==='ArrowDown'||event.key==='ArrowUp'){if(!searchPop){drawSearchPop();return;}event.preventDefault();if(!hits.length)return;searchPick=event.key==='ArrowDown'?(searchPick+1)%hits.length:(searchPick<=0?hits.length:searchPick)-1;drawSearchPop();searchPop?.querySelector('.search-hit.active')?.scrollIntoView({block:'nearest'});}
  else if(event.key==='Enter'){event.preventDefault();if(searchPick>=0&&hits[searchPick])openSearchHit(Number(hits[searchPick].dataset.searchHit));else applySearch(event.target.value);}
  else if(event.key==='Escape'&&searchPop){event.preventDefault();event.stopPropagation();closeSearchPop();}
},true);
document.addEventListener('focusin',event=>{if(event.target.id==='search'&&event.target.value.trim()&&event.target.value.trim()!==state.query)drawSearchPop();});
// A row is chosen on pointerdown so the box losing focus does not close the list first.
document.addEventListener('pointerdown',event=>{
  if(!searchPop)return;const hit=event.target.closest('[data-search-hit]'),all=event.target.closest('[data-search-all]');
  if(hit||all){event.preventDefault();if(hit)openSearchHit(Number(hit.dataset.searchHit));else applySearch(document.querySelector('#search')?.value||'',all.dataset.searchAll==='fulltext');return;}
  if(!event.target.closest('#search-pop,#search'))closeSearchPop();
},true);
window.addEventListener('resize',()=>{if(searchPop)drawSearchPop();});
const searchBaseRender=render;render=function(...args){closeSearchPop();return searchBaseRender.apply(this,args);};
document.addEventListener('change',event=>{
  if(event.target.id==='select-all'){if(event.target.checked)for(const p of filtered())batchSelection.add(p.id);else for(const p of filtered())batchSelection.delete(p.id);syncChecks();return;}
  if(event.target.id==='fulltext-toggle'){state.fullText=event.target.checked;fullTextResults=null;refreshLibraryList();runDesktop(runFullText)();}
  const id=state.storageKey,ids=[...batchSelection];
  if(event.target.id==='batch-status'&&event.target.value)runDesktop(async()=>{await desktopNotes();applyItemSnapshot(await window.appApi.batchUpdate(id,ids,{status:event.target.value}),{screen:'library'});toast(tr('{n}개 자료의 읽기 상태를 바꿨습니다.',{n:ids.length}));})();
  if(event.target.id==='batch-collection'&&event.target.value)runDesktop(async()=>{await desktopNotes();applyItemSnapshot(await window.appApi.batchUpdate(id,ids,{addCollection:event.target.value}),{screen:'library'});toast(tr('{n}개 자료를 컬렉션에 추가했습니다.',{n:ids.length}));})();
  if(event.target.id==='batch-export'&&event.target.value)runDesktop(async()=>{const format=event.target.value;event.target.value='';if(await window.appApi.exportBibliography(id,format,ids))toast(tr('선택한 자료의 서지정보를 저장했습니다.'));})();
});
// The checkbox selects without opening the paper (window capture runs first).
window.addEventListener('click',event=>{const check=event.target.closest('[data-batch-paper]');if(!check)return;event.stopImmediatePropagation();const id=Number(check.dataset.batchPaper);if(check.checked)batchSelection.add(id);else batchSelection.delete(id);const bar=document.querySelector('.batch-bar'),html=batchBar();if(bar)bar.outerHTML=html||'<span hidden class="batch-bar"></span>';else if(html)document.querySelector('#paper-list').insertAdjacentHTML('beforebegin',html);syncSelectAll();},true);
window.addEventListener('keydown',event=>{if(event.target.matches?.('[data-batch-paper]')&&event.key==='Enter')event.stopImmediatePropagation();},true);
document.addEventListener('click',event=>{
  const saved=event.target.closest('[data-saved-search]');
  if(saved){const s=savedSearches.find(x=>x.id===saved.dataset.savedSearch);if(!s)return;Object.assign(state,{screen:'library',folder:null,desktopTag:s.tag,collection:s.collectionId,query:s.query,filter:s.filter,fullText:s.fullText,nav:s.name,savedSearch:s.id});fullTextResults=null;render();runDesktop(runFullText)();}
  const remove=event.target.closest('[data-delete-search]');
  if(remove){event.stopImmediatePropagation();runDesktop(async()=>{const id=state.storageKey;applyItemSnapshot(await window.appApi.deleteSearch(id,remove.dataset.deleteSearch),{screen:'library'});})();}
});
Object.assign(actions,{
  'clear-search':()=>{state.query='';state.fullText=false;fullTextResults=null;render();},
  'save-search':()=>{modal(tr('검색 저장'),`<p class="small muted">${tr('현재 조건을 저장합니다: {conditions}',{conditions:esc([state.query&&tr('검색어 “{query}”',{query:state.query}),state.fullText&&tr('PDF 본문'),state.filter!=='전체'&&valueLabel(state.filter),state.collection&&collectionPath(state.collection),state.desktopTag&&'#'+state.desktopTag].filter(Boolean).join(' · ')||tr('전체 자료'))})}</p><label for="search-name">${tr('이름')}</label><input id="search-name" maxlength="100" value="${esc(state.query||(state.folder===null?navLabel(state.nav):state.nav)||'')}">`,btn(tr('취소'),'close')+btn(tr('저장'),'confirm-save-search','primary'));document.querySelector('#search-name').focus();}, // i18n:keep — filter value
  'confirm-save-search':runDesktop(async()=>{const name=document.querySelector('#search-name').value.trim();if(!name)return;const id=state.storageKey;const view={folder:state.folder,collection:state.collection,desktopTag:state.desktopTag,query:state.query,filter:state.filter,nav:state.nav,savedSearch:state.savedSearch};const snapshot=await window.appApi.saveSearch(id,{name,query:state.query,filter:state.filter,collectionId:state.collection,tag:state.desktopTag,fullText:Boolean(state.fullText)});applyItemSnapshot(snapshot,{screen:'library'});Object.assign(state,view);render();toast(tr('검색을 저장했습니다.'));}),
  'new-collection':()=>{modal(tr('새 컬렉션'),`<label for="collection-name">${tr('이름')}</label><input id="collection-name" maxlength="100"><label for="collection-parent">${tr('위치')}</label><select id="collection-parent"><option value="">${tr('최상위')}</option>${itemCollections.map(c=>`<option value="${esc(c.id)}" ${c.id===state.collection?'selected':''}>${esc(collectionPath(c.id))}</option>`).join('')}</select>`,btn(tr('취소'),'close')+btn(tr('만들기'),'create-collection','primary'));document.querySelector('#collection-name').focus();},
  'create-collection':runDesktop(async()=>{const name=document.querySelector('#collection-name').value.trim(),parent=document.querySelector('#collection-parent')?.value||null;if(!name)return;const id=state.storageKey;await desktopNotes();applyItemSnapshot(await window.appApi.createCollection(id,name,parent));}),
  'batch-tag':()=>{modal(tr('태그 일괄 추가'),`<label for="batch-tags">${tr('태그 (쉼표로 구분)')}</label><input id="batch-tags" maxlength="600">`,btn(tr('취소'),'close')+btn(tr('추가'),'confirm-batch-tag','primary'));document.querySelector('#batch-tags').focus();},
  'confirm-batch-tag':runDesktop(async()=>{const tags=document.querySelector('#batch-tags').value.split(',').map(t=>t.trim()).filter(Boolean);if(!tags.length)return;const id=state.storageKey,ids=[...batchSelection];await desktopNotes();applyItemSnapshot(await window.appApi.batchUpdate(id,ids,{addTags:tags}),{screen:'library'});toast(tr('{n}개 자료에 태그를 추가했습니다.',{n:ids.length}));}),
  'batch-cite':runDesktop(()=>citeDialog([...batchSelection])),
  'batch-autofill':runDesktop(()=>autofillByHand([...batchSelection].filter(id=>papers.some(p=>p.id===id)))),
  'batch-clear':()=>{batchSelection.clear();refreshLibraryList();},
  // Everything the list shows now (the folder, search and filter in force), as Ctrl+A in the list does.
  'batch-all':()=>{for(const p of filtered())batchSelection.add(p.id);syncChecks();},
  // Several items at once: to the vault's trash (they can be brought back) or deleted with their files.
  'batch-delete':()=>{const ids=[...batchSelection].filter(id=>papers.some(p=>p.id===id));if(!ids.length)return;const names=ids.slice(0,5).map(id=>`<li>${esc(papers.find(p=>p.id===id).title)}</li>`).join('')+(ids.length>5?`<li class="muted">${tr('그 밖 {n}개',{n:ids.length-5})}</li>`:'');
    modal(tr('자료 {n}개 삭제',{n:ids.length}),`<ul class="small">${names}</ul><p>${tr('<b>휴지통으로 이동</b>: 목록에서 숨깁니다. PDF와 기록은 그대로 두며 저장소 관리의 휴지통에서 되살릴 수 있습니다.')}</p><p>${tr('<b>파일까지 삭제</b>: PDF 파일을 저장소 폴더에서 지우고(컴퓨터의 휴지통으로 보내며, 쓸 수 없는 환경에서는 바로 지워집니다) 메모·주석·번역·필기·AI 기록을 지웁니다. 이 기록은 되살릴 수 없습니다.')}</p>`,btn(tr('취소'),'close')+btn(tr('파일까지 삭제'),'confirm-batch-delete','secondary danger')+btn(tr('휴지통으로 이동'),'confirm-batch-trash','primary'));},
  'confirm-batch-trash':runDesktop(()=>removeSelected(false)),
  'confirm-batch-delete':runDesktop(()=>removeSelected(true))
});
// Collections move under another from the vault manager.
const baseManager2=showVaultManager;
showVaultManager=async function(){
  await baseManager2();
  for(const button of dialog.querySelectorAll('[data-edit-collection]')){const id=button.dataset.editCollection,c=itemCollections.find(x=>x.id===id);if(!c)continue;button.closest('.manager-row').querySelector('span').textContent=collectionPath(id);button.insertAdjacentHTML('beforebegin',`<select data-move-collection="${esc(id)}" aria-label="${tr('{collection} 위치',{collection:esc(c.name)})}"><option value="">${tr('최상위')}</option>${itemCollections.filter(x=>!collectionDescendants(id).has(x.id)).map(x=>`<option value="${esc(x.id)}" ${x.id===c.parentId?'selected':''}>${esc(collectionPath(x.id))}</option>`).join('')}</select>`);}
};
actions['vault-manager']=runDesktop(showVaultManager);
document.addEventListener('change',event=>{const select=event.target.closest('[data-move-collection]');if(select)runDesktop(async()=>{const snapshot=await window.appApi.moveCollection(state.storageKey,select.dataset.moveCollection,select.value||null);applyItemSnapshot(snapshot,{screen:'library'});await showVaultManager();})();});

// ---- Reading: last position, view and zoom; outline; back after a jump ----
const readKey=()=>'app-read-'+targetKey();
// The PDF open last in each vault opens again when the app starts there.
const lastReadKey=()=>'app-last-read-'+state.storageKey;
const baseRenderLast=render;
render=function(){baseRenderLast();if(state.screen==='reader'&&state.storageKey&&state.selected)try{localStorage.setItem(lastReadKey(),JSON.stringify({paperId:state.selected,attachmentId:state.selectedAttachment||null}));}catch{}};
globalThis.appReopenLast=async()=>{let last=null;try{last=JSON.parse(localStorage.getItem(lastReadKey())||'null');}catch{}if(!last||!papers.some(p=>p.id===last.paperId))return false;await openItemFile(last.paperId,last.attachmentId||undefined);return state.screen==='reader';};
// The reading record (this device): where to resume, and the furthest page reached out of how many.
// The furthest page moves the read status forward by itself: past the first page → 읽는 중,
// the last page → 완독. It only reacts when the furthest page grows, so a status set by hand stays.
function readRecord(key){try{return JSON.parse(localStorage.getItem(key)||'null');}catch{return null;}}
function rememberReading(){
  // A window that only shows the original (원문 새 창) leaves the place read last as the main window set it.
  if(document.body.classList.contains('view-window'))return;
  const container=document.querySelector('.original-pages'),viewer=container?.pdfViewer,page=viewer?.currentPageNumber;if(!page||state.screen!=='reader')return;
  const key=readKey(),before=readRecord(key),pages=viewer.pagesCount||before?.pages||0,furthest=Math.max(page,Number(before?.furthest)||0);
  try{localStorage.setItem(key,JSON.stringify({page,mode:state.mode,zoom:readerZoom,pages,furthest}));}catch{}
  readingIndex=null;
  const grew=furthest>(Number(before?.furthest)||0),paper=selected();if(!grew||!paper)return;
  const next=pages>1&&furthest>=pages&&paper.status!=='완독'?'완독':furthest>1&&paper.status==='읽기 전'?'읽는 중':null; // i18n:keep — read-status values
  if(next)runDesktop(async()=>{await setReadStatus(paper.id,next);toast(next==='완독'?tr('마지막 쪽까지 읽어 완독으로 바꿨습니다.'):tr('읽기 상태를 읽는 중으로 바꿨습니다.'));})(); // i18n:keep — read-status value
}
// Progress per paper for the list: the best record among its PDFs on this device (shown once
// reading has gone past the first page).
let readingIndex=null;
function readingProgress(paperId){
  if(!readingIndex){readingIndex=new Map();const prefix='app-read-'+state.storageKey+':';
    try{for(let i=0;i<localStorage.length;i++){const key=localStorage.key(i);if(!key?.startsWith(prefix))continue;const id=Number(key.slice(prefix.length).split(':')[0]),r=readRecord(key);if(!r?.pages||!(r.furthest>1))continue;const ratio=Math.min(1,r.furthest/r.pages),best=readingIndex.get(id);if(!best||ratio>best.ratio)readingIndex.set(id,{ratio,furthest:r.furthest,pages:r.pages});}}catch{}}
  return readingIndex.get(paperId)||null;
}
function progressBadge(paper){
  const r=readingProgress(paper.id);if(!r)return '';const percent=Math.round(r.ratio*100);
  return `<span class="read-progress${percent>=100?' done':''}" title="${tr('{pages}쪽 중 {n}쪽까지 읽음 (이 기기)',{pages:r.pages,n:r.furthest})}" aria-label="${tr('읽기 진행 {percent}%',{percent})}"><span class="bar"><i style="width:${percent}%"></i></span>${percent}%</span>`;
}
// Setting 읽기 전 by hand starts the progress over from the page in view.
document.addEventListener('click',event=>{const choice=event.target.closest('[data-read-status="읽기 전"]');if(!choice)return;const paperId=choice.closest('[data-status-for]')?.dataset.statusFor;if(!paperId)return; // i18n:keep — read-status value
  const prefix='app-read-'+state.storageKey+':'+paperId+':';try{for(let i=localStorage.length-1;i>=0;i--){const key=localStorage.key(i);if(!key?.startsWith(prefix))continue;const r=readRecord(key);if(r){r.furthest=r.page||0;localStorage.setItem(key,JSON.stringify(r));}}}catch{}readingIndex=null;},true);
let readingTimer;document.addEventListener('scroll',event=>{if(event.target.classList?.contains('original-pages')){clearTimeout(readingTimer);readingTimer=setTimeout(rememberReading,300);}},true);
const baseRead=actions.read;
actions.read=()=>{let saved=null;try{saved=JSON.parse(localStorage.getItem('app-read-'+state.storageKey+':'+state.selected+':'+(state.selectedAttachment||'primary'))||'null');}catch{}
  if(saved&&Number(saved.zoom)>=.5&&Number(saved.zoom)<=2)readerZoom=Number(saved.zoom);baseRead();if(state.screen!=='reader'||!saved)return;
  const container=document.querySelector('.original-pages');if(container&&Number.isInteger(saved.page)&&saved.page>1)container.restorePage=saved.page;
  if(['translated','dual'].includes(saved.mode))document.querySelector(`[data-mode="${saved.mode}"]`)?.click();};
document.addEventListener('app-pagerendered',event=>{const container=event.target;if(!container.classList?.contains('original-pages')||!container.restorePage)return;const page=container.restorePage;container.restorePage=null;if(page<=container.pdfViewer.pagesCount)container.pdfViewer.currentPageNumber=page;},true);
document.addEventListener('click',event=>{if(event.target.closest('[data-reader-zoom],[data-reader-fit],[data-mode]'))setTimeout(rememberReading,0);});
const readerBack=[];
function jumpFrom(){const viewer=document.querySelector('.original-pages')?.pdfViewer;if(viewer){readerBack.push(viewer.currentPageNumber);if(readerBack.length>50)readerBack.shift();refreshBack();}}
function refreshBack(){const button=document.querySelector('[data-action="reader-back"]');if(button)button.disabled=!readerBack.length;}
document.addEventListener('click',event=>{const link=event.target.closest('.original-pages .annotationLayer a');if(link&&!/^(https?|mailto):/i.test(link.getAttribute('href')||''))jumpFrom();},true);
async function showOutline(){
  const container=document.querySelector('.original-pages'),viewer=container?.pdfViewer;if(!viewer?.pdfDocument)return;
  const outline=await viewer.pdfDocument.getOutline(),items=[];
  const walk=(nodes,depth)=>{for(const node of nodes||[]){if(items.length>=1000)return;items.push({node,depth});walk(node.items,depth+1);}};walk(outline,0);
  modal(tr('목차'),items.length?`<nav class="outline-list">${items.map((item,i)=>`<button type="button" class="outline-item" data-outline="${i}" style="--depth:${item.depth}">${esc(item.node.title||tr('(제목 없음)'))}</button>`).join('')}</nav>`:`<p>${tr('이 PDF에는 목차(북마크)가 없습니다.')}</p>`,btn(tr('닫기'),'close'));
  dialog.outlineItems=items;
}
document.addEventListener('click',event=>{const entry=event.target.closest('[data-outline]');if(!entry)return;const item=dialog.outlineItems?.[Number(entry.dataset.outline)],container=document.querySelector('.original-pages');if(!item||!container?.pdfController)return;jumpFrom();if(item.node.dest)container.pdfController.linkService.goToDestination(item.node.dest);dialog.close();});
Object.assign(actions,{'reader-outline':runDesktop(showOutline),'reader-back':()=>{const page=readerBack.pop(),viewer=document.querySelector('.original-pages')?.pdfViewer;if(page&&viewer)viewer.currentPageNumber=page;refreshBack();}});
const baseRefreshPane=refreshTranslationPane;
refreshTranslationPane=function(){baseRefreshPane();const tools=document.querySelector('.original-pane .source-tools');if(tools&&!tools.querySelector('[data-action="reader-outline"]')){tools.insertAdjacentHTML('afterbegin',`<button class="pdf-tool" data-action="reader-back" aria-label="${tr('이전 위치로 돌아가기')}" title="${tr('이전 위치로 돌아가기')}">${icon('back')}<span class="pdf-tool-label">${tr('뒤로')}</span></button><button class="pdf-tool" data-action="reader-outline" title="${tr('목차')}">${icon('book')}<span class="pdf-tool-label">${tr('목차')}</span></button><button class="pdf-tool" data-action="reader-thumbs" aria-pressed="false" title="${tr('쪽 썸네일 보기')}">${icon('grid')}<span class="pdf-tool-label">${tr('쪽')}</span></button>`);refreshBack();}}; // icon and word as the translation's tools (renderer.js translationTool); a narrow pane shows the icons (style.css)

// ---- Citations: point at "[12]" or "(Kim et al., 2020)" to read the entry ----
// The reference list is read from the paper's own pages the first time the
// pointer rests on something shaped like a citation (original or
// translation); the card names the entry and jumps to it (↩ comes back).
const citationIndexes=new Map();
function citationIndexFor(){
  const key=targetKey();
  if(!citationIndexes.has(key)){
    const pending=(async()=>{const engine=await pdfEngine(),{pdf,hash}=await engine.documentFor(state.storageKey,state.selected,false,state.selectedAttachment);return globalThis.appPdfLayout.citationIndex(await engine.structuredPages(pdf,hash));})();
    citationIndexes.set(key,pending);pending.catch(()=>citationIndexes.delete(key));
  }
  return citationIndexes.get(key);
}
let citeCard=null,citeShown=null,citeHide=0,citeFrame=0;
function citeClose(){clearTimeout(citeHide);citeShown=null;citeCard?.remove();citeCard=null;}
function citeLater(){clearTimeout(citeHide);if(citeCard)citeHide=setTimeout(citeClose,350);}
async function citeProbe(x,y){
  const range=document.caretRangeFromPoint?.(x,y),node=range?.startContainer;
  if(node?.nodeType!==Node.TEXT_NODE||!node.parentElement.closest('.textLayer,.translation-content')){citeLater();return;}
  const offset=range.startOffset,cite=globalThis.appPdfLayout.citationsIn(node.data).find(c=>offset>=c.start&&offset<=c.end);
  if(!cite){citeLater();return;}
  clearTimeout(citeHide);const shown=node.data.slice(cite.start,cite.end);if(citeShown?.node===node&&citeShown.text===shown)return;
  const pane=node.parentElement.closest('.original-pages,.translated-pages'),key=targetKey(),index=await citationIndexFor().catch(()=>null);
  if(!index||key!==targetKey()||!node.isConnected)return;
  const entries=globalThis.appPdfLayout.resolveCitation(index,cite);if(!entries.length){citeLater();return;}
  citeClose();citeShown={node,text:shown,pane};
  citeCard=document.createElement('div');citeCard.className='cite-card';citeCard.setAttribute('role','dialog');citeCard.setAttribute('aria-label',tr('참고문헌'));
  citeCard.innerHTML=entries.slice(0,4).map(e=>`<div class="cite-entry"><p>${esc(e.text.slice(0,400))}</p><button type="button" class="secondary small" data-cite-page="${e.page}" data-cite-x="${e.x}" data-cite-y="${e.y}">${tr('{page}쪽 참고문헌으로 이동',{page:e.page})}</button></div>`).join('')+(entries.length>4?`<p class="small muted">${tr('외 {n}개',{n:entries.length-4})}</p>`:'');
  document.body.append(citeCard);
  const box=citeCard.getBoundingClientRect();citeCard.style.left=Math.max(8,Math.min(innerWidth-box.width-8,x+12))+'px';citeCard.style.top=(y+18+box.height>innerHeight-8?Math.max(8,y-box.height-12):y+18)+'px';
}
document.addEventListener('pointermove',event=>{
  if(event.pointerType!=='mouse'||state.screen!=='reader'||document.body.classList.contains('ink-active'))return;
  if(event.target.closest?.('.cite-card')){clearTimeout(citeHide);return;}
  cancelAnimationFrame(citeFrame);const {clientX:x,clientY:y}=event;citeFrame=requestAnimationFrame(()=>citeProbe(x,y).catch(()=>{}));
},{passive:true});
document.addEventListener('scroll',event=>{if(citeCard&&!event.target.closest?.('.cite-card'))citeClose();},true);
document.addEventListener('keydown',event=>{if(event.key==='Escape')citeClose();});
document.addEventListener('click',event=>{
  const button=event.target.closest('[data-cite-page]');if(!button)return;
  // The pane it was read in, unless that is the section view (no pages to scroll).
  const container=citeShown?.pane?.isConnected&&citeShown.pane.pdfViewer&&!citeShown.pane.classList.contains('reading-translation')?citeShown.pane:document.querySelector('.original-pages'),viewer=container?.pdfViewer,page=Number(button.dataset.citePage);citeClose();
  if(!viewer?.pdfDocument||page<1||page>viewer.pagesCount)return;
  if(container.classList.contains('original-pages'))jumpFrom();
  // Block positions are in the 4/3-scaled page (as extracted); PDF.js wants PDF points.
  viewer.pdfDocument.getPage(page).then(pdfPage=>{const [px,py]=pdfPage.getViewport({scale:4/3}).convertToPdfPoint(Number(button.dataset.citeX),Math.max(0,Number(button.dataset.citeY)-12));viewer.scrollPageIntoView({pageNumber:page,destArray:[null,{name:'XYZ'},px,py,null]});}).catch(()=>{viewer.currentPageNumber=page;});
});

// ---- File names from the bibliography (Surname_Year_Title.pdf) ----
// With style 'title' (서지정보's 제목으로 파일 이름) the name is the title alone, and what is told is about the one file.
async function renameFiles(paperIds,style){
  const id=state.storageKey;if(!paperIds.length)return;await desktopNotes();await globalThis.appFlushAll?.();
  const result=await window.appApi.renameAttachments(id,paperIds,style);if(state.storageKey!==id)return;
  applyItemSnapshot(result.snapshot);
  if(style==='title'){toast(result.renamed?tr('파일 이름을 제목으로 바꿨습니다.'):result.unchanged?tr('파일 이름이 이미 제목과 같습니다.'):tr('파일 이름을 바꾸지 못했습니다: {error}',{error:result.failed[0]?.error||''}));return;}
  toast(`${tr('파일 이름 정리: {n}개 변경',{n:result.renamed})}${result.unchanged?`, ${tr('{n}개는 이미 정리됨',{n:result.unchanged})}`:''}${result.failed.length?`, ${tr('{n}개 실패({error})',{n:result.failed.length,error:result.failed[0].error})}`:''}`);
}
Object.assign(actions,{'rename-files':runDesktop(()=>renameFiles([state.selected])),'rename-file-title':runDesktop(()=>renameFiles([state.selected],'title')),'batch-rename-files':runDesktop(()=>renameFiles([...batchSelection].filter(id=>papers.some(p=>p.id===id))))});
const baseRenameBar=batchBar;
batchBar=function(){return baseRenameBar().replace('<!--batch-file-->',`<button class="secondary small" data-action="batch-rename-files" title="${tr('저자_연도_제목.pdf로 이름을 바꿉니다')}">${tr('파일 이름 정리')}</button><!--batch-file-->`);};
// The vault manager switches automatic bibliography on import (per vault, this device).
const baseManagerAutofill=showVaultManager;
showVaultManager=async function(){
  await baseManagerAutofill();
  const id=state.storageKey,place=dialog.querySelector('.dialog-inner .actions');if(!place||dialog.querySelector('#autofill-toggle'))return;
  let on=true;try{on=localStorage.getItem('app-autofill-'+id)!=='off';}catch{}
  place.insertAdjacentHTML('beforebegin',`<label class="collection-choice"><input type="checkbox" id="autofill-toggle" ${on?'checked':''}> <span class="autofill-title">${tr('빈 서지정보 자동 채우기')}:</span> ${tr('새 PDF와, 저자·연도가 비어 있는 항목을 PDF의 DOI(Crossref·DataCite)로, DOI가 없으면 제목 검색(Crossref)으로 채웁니다. DOI 또는 제목·첫 저자만 보냅니다.')}</label>`);
};
document.addEventListener('change',event=>{if(event.target.id!=='autofill-toggle')return;try{localStorage.setItem('app-autofill-'+state.storageKey,event.target.checked?'on':'off');}catch{}if(event.target.checked)autofillPending(state.storageKey);});
actions['vault-manager']=runDesktop(showVaultManager);

// ---- Page thumbnails: a strip beside the original, drawn as it scrolls ----
// Each thumbnail is drawn when it comes into view; the current page is
// marked; a click jumps there (↩ comes back). Open or closed is remembered.
let thumbsOpen=false;try{thumbsOpen=localStorage.getItem('app-thumbs')==='open';}catch{}
function thumbsMark(strip,page){for(const b of strip.querySelectorAll('[data-thumb-page]')){const on=Number(b.dataset.thumbPage)===page;b.classList.toggle('current',on);if(on)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');}}
async function thumbsShow(){
  const pane=document.querySelector('.original-pane'),container=pane?.querySelector('.original-pages'),viewer=container?.pdfViewer;
  pane?.querySelector('.page-thumbs')?.remove();document.querySelector('[data-action="reader-thumbs"]')?.setAttribute('aria-pressed',String(thumbsOpen));
  if(!thumbsOpen||!viewer?.pdfDocument)return;
  const pdf=viewer.pdfDocument,first=(await pdf.getPage(1)).getViewport({scale:1}),ratio=first.height/first.width;
  if(!container.isConnected||pane.querySelector('.page-thumbs'))return;
  const strip=document.createElement('nav');strip.className='page-thumbs';strip.setAttribute('aria-label',tr('쪽 썸네일'));
  strip.innerHTML=Array.from({length:pdf.numPages},(_,i)=>`<button type="button" data-thumb-page="${i+1}" aria-label="${tr('{n}쪽',{n:i+1},'thumbnail')}"><canvas width="100" height="${Math.round(100*ratio)}"></canvas><span>${i+1}</span></button>`).join('');
  strip.style.top=container.offsetTop+'px';pane.append(strip);thumbsMark(strip,viewer.currentPageNumber);
  const seen=new IntersectionObserver(entries=>{for(const entry of entries){if(!entry.isIntersecting)continue;seen.unobserve(entry.target);const n=Number(entry.target.dataset.thumbPage),canvas=entry.target.querySelector('canvas');
    pdf.getPage(n).then(page=>{const base=page.getViewport({scale:1}),viewport=page.getViewport({scale:canvas.width/base.width});canvas.height=Math.round(viewport.height);return page.render({canvasContext:canvas.getContext('2d'),viewport}).promise;}).catch(()=>{});}},{root:strip,rootMargin:'200px'});
  for(const button of strip.children)seen.observe(button);
  container.pdfController?.eventBus.on('pagechanging',event=>{if(strip.isConnected)thumbsMark(strip,event.pageNumber);});
}
document.addEventListener('click',event=>{const b=event.target.closest('[data-thumb-page]');if(!b)return;const viewer=document.querySelector('.original-pages')?.pdfViewer,page=Number(b.dataset.thumbPage);if(!viewer||page===viewer.currentPageNumber)return;jumpFrom();viewer.currentPageNumber=page;});
actions['reader-thumbs']=()=>{thumbsOpen=!thumbsOpen;try{localStorage.setItem('app-thumbs',thumbsOpen?'open':'closed');}catch{}thumbsShow().catch(()=>{});};
document.addEventListener('app-pagerendered',event=>{if(thumbsOpen&&event.target.classList?.contains('original-pages')&&!event.target.closest('.original-pane')?.querySelector('.page-thumbs'))thumbsShow().catch(()=>{});},true);

// ---- Full backup: PDFs, records, ink and translations, verified by hash ----
const baseManager3=showVaultManager;
showVaultManager=async function(){
  await baseManager3();
  const backup=dialog.querySelector('[data-action="create-backup"]');if(!backup||dialog.querySelector('[data-action="full-backup"]'))return;
  backup.textContent=tr('메타데이터 백업');
  backup.insertAdjacentHTML('afterend',`<button class="secondary" data-action="full-backup">${tr('전체 백업 (PDF·필기·번역 포함)')}</button><button class="secondary" data-action="full-restore">${tr('전체 백업에서 복원')}</button>`);
  backup.closest('.row').insertAdjacentHTML('afterend',`<p class="small muted" data-vm-kind="backup">${tr('전체 백업은 PDF, 서지·메모·주석, 필기, 번역과 필기한 번역 바탕을 해시 목록과 함께 새 폴더에 복사합니다. 복원은 빈 폴더에 별도 저장소로 만들고 모든 파일의 해시를 확인합니다.')}</p>`);
};
actions['vault-manager']=runDesktop(showVaultManager);
Object.assign(actions,{
  'full-backup':runDesktop(async()=>{const id=state.storageKey;await desktopNotes();toast(tr('전체 백업을 만드는 중입니다.'));const result=await window.appApi.fullBackup(id);if(result)modal(tr('전체 백업 완료'),`<p>${tr('{n}개 파일 ({size}MB)을 복사하고 해시를 기록했습니다.',{n:result.files,size:(result.bytes/1048576).toFixed(1)})}</p>${result.missing?`<p>${tr('찾을 수 없는 첨부 PDF {n}개는 목록에만 기록했습니다.',{n:result.missing})}</p>`:''}<p class="small muted">${esc(result.folder)}</p>`,btn(tr('닫기'),'close','primary'));}),
  'full-restore':runDesktop(async()=>{await desktopNotes();await globalThis.appFlushAll?.();const result=await window.appApi.fullRestore();if(!result)return;applySnapshot(result.snapshot);await refreshPreferences();modal(tr('전체 백업 복원 완료'),`<p>${tr('{n}개 파일의 해시를 확인하고 새 저장소로 복원했습니다.',{n:result.files})}</p>${result.missing?`<p>${tr('백업 당시 없던 첨부 PDF {n}개는 “다시 연결”로 찾아 주세요.',{n:result.missing})}</p>`:''}`,btn(tr('닫기'),'close','primary'));})
});

// ---- Personal devices: a shared folder, one state file per device ----
let syncConflicts=[];
const baseApplySync=applySnapshot;
applySnapshot=function(snapshot){syncConflicts=snapshot.syncConflicts||[];baseApplySync(snapshot);if(snapshot.syncReport)syncReportToast(snapshot.syncReport);if(snapshot.movedFigures)toast(tr('그림 설명 {n}개를 메모에서 주석 탭으로 옮겼습니다. (옮기기 전 백업이 있습니다)',{n:snapshot.movedFigures}));};
function syncReportToast(r){if(r.error){toast(tr('동기화하지 못했습니다: {error}',{error:r.error}));return;}const parts=[r.applied&&tr('받은 변경 {n}',{n:r.applied}),r.merged&&tr('병합 {n}',{n:r.merged}),r.conflicts&&tr('충돌 보존 {n}',{n:r.conflicts}),r.missingFiles?.length&&tr('아직 없는 PDF {n}',{n:r.missingFiles.length}),r.keptPapers&&tr('다른 기기에서 지운 자료 {n}편은 이 PC의 주석 때문에 남김',{n:r.keptPapers}),r.restoredAttachments&&tr('다른 기기에서 지운 첨부 {n}개는 이 PC의 주석 때문에 남김',{n:r.restoredAttachments}),r.liftedCollections&&tr('상위가 지워진 컬렉션 {n}개는 맨 위로 옮김',{n:r.liftedCollections})].filter(Boolean);
// What a removal made elsewhere did not take here is said for longer: it is read, not glanced at.
toast(parts.length?tr('동기화: {parts}',{parts:parts.join(' · ')}):tr('동기화: 다른 기기의 새 변경이 없습니다.'),r.keptPapers||r.restoredAttachments||r.liftedCollections?9000:undefined);}
const conflictLabel=c=>{const [type,key]=[c.key.slice(0,c.key.indexOf(':')),c.key.slice(c.key.indexOf(':')+1)];if(type==='note'){const [paperId,...rest]=key.split('-');return `${papers.find(p=>String(p.id)===paperId)?.title||tr('자료')} · ${rest.join('-').replace(/^summary-(\d)$/,(m,i)=>[tr('연구 질문'),tr('방법'),tr('결과'),tr('한계')][i])}`;}if(type==='paper')return `${papers.find(p=>String(p.id)===key)?.title||tr('자료')} · ${c.field}`;return {annotation:tr('주석'),collection:tr('컬렉션'),notebook:tr('노트북'),search:tr('저장 검색'),corrections:tr('번역 교정'),rules:tr('번역 요청 사항'),ai:tr('AI 결과')}[type]||type;};
const show=v=>typeof v==='string'?v:JSON.stringify(v)?.slice(0,300);
const baseManager4=showVaultManager;
showVaultManager=async function(){
  await baseManager4();
  const anchor=dialog.querySelector('.manager-list');if(!anchor||dialog.querySelector('.sync-section'))return;
  const status=await window.appApi.syncStatus(state.storageKey);
  const conflicts=syncConflicts.map(c=>`<div class="sync-conflict"><strong>${esc(conflictLabel(c))}</strong><small>${tr('{device}와 동시에 고침 · {date}',{device:esc(c.device),date:esc(new Date(c.at).toLocaleString(appI18n.uiLocale()))})}</small><div class="sync-versions"><div><b>${tr('이 기기')}</b><p>${esc(show(c.local))}</p><button class="secondary small" data-sync-resolve="${esc(c.id)}" data-choice="local">${tr('이 버전 사용')}</button></div><div><b>${esc(c.device)}</b><p>${esc(show(c.remote))}</p><button class="secondary small" data-sync-resolve="${esc(c.id)}" data-choice="remote">${tr('이 버전 사용')}</button></div></div><button class="secondary small" data-sync-resolve="${esc(c.id)}" data-choice="keep">${tr('현재 상태 유지')}</button></div>`).join('');
  anchor.previousElementSibling.insertAdjacentHTML('beforebegin',`<section class="sync-section"><h3>${tr('기기 간 동기화')}</h3>${status.folder?`<p class="small">${tr('동기화 폴더: {folder}<br>이 기기: {device} · 마지막 동기화: {at}',{folder:esc(status.folder),device:esc(status.device),at:status.at?esc(new Date(status.at).toLocaleString(appI18n.uiLocale())):tr('없음',null,'last sync')})}</p><div class="row"><button class="primary" data-action="sync-run">${tr('지금 동기화')}</button><button class="secondary" data-action="sync-disconnect">${tr('연결 해제')}</button></div>`:`<p class="small muted">${tr('Dropbox·Google Drive 데스크톱 폴더 같은 공유 폴더를 연결하면 각 기기가 자기 파일만 써서 변경을 주고받습니다. 저장소를 열 때와 “지금 동기화”를 누를 때 동기화합니다. 같은 기록을 두 기기에서 동시에 고치면 두 버전을 모두 보존합니다.')}</p><button class="secondary" data-action="sync-connect">${tr('동기화 폴더 연결')}</button>`}${syncConflicts.length?`<h4>${tr('충돌 {n}개',{n:syncConflicts.length})}</h4>${conflicts}`:''}</section>`);
};
actions['vault-manager']=runDesktop(showVaultManager);
async function afterSync(result){if(!result)return;applyItemSnapshot(result.snapshot,{screen:'library'});syncReportToast(result.report);await showVaultManager();}
Object.assign(actions,{
  'sync-connect':runDesktop(async()=>{await desktopNotes();await afterSync(await window.appApi.syncConnect(state.storageKey));}),
  'sync-run':runDesktop(async()=>{await desktopNotes();toast(tr('동기화 중입니다.'));await afterSync(await window.appApi.syncRun(state.storageKey));}),
  'sync-disconnect':runDesktop(async()=>{await window.appApi.syncDisconnect(state.storageKey);await showVaultManager();toast(tr('이 기기에서 동기화 연결을 해제했습니다. 저장소 내용은 그대로입니다.'));}),
  'sync-join':runDesktop(async()=>{const shared=await window.appApi.syncShared();if(!shared)return;if(!shared.vaults.length&&shared.direct?.length){modal(tr('이 폴더의 {app} 저장소'),`<p>${tr('동기화 폴더({id}-sync)는 없고, 클라우드 폴더에 둔 저장소가 있습니다. 바로 열 수 있습니다.')}</p><p class="small muted">${tr('두 기기에서 동시에 열지 마세요. 다른 기기에서 열려 있으면 잠금 안내가 나옵니다.')}</p>${shared.direct.map(v=>`<div class="manager-row"><span title="${esc(v.root)}">${esc(v.name)} <small class="muted">${esc(v.root)}</small></span><button class="secondary small" data-open-found-vault="${esc(v.root)}">${tr('열기')}</button></div>`).join('')}`,btn(tr('닫기'),'close'));return;}
if(!shared.vaults.length){modal(tr('공유된 저장소를 찾지 못했습니다'),`<p>${tr('고른 폴더와 그 아래 세 단계 안에 <code>{id}-sync</code> 폴더도, {app} 저장소도 없습니다.')}</p><p class="small muted">${tr('먼저 저장소가 있는 기기에서 <strong>저장소 관리 → 동기화 폴더 연결</strong>로 Google Drive·Dropbox 폴더를 연결하고 한 번 동기화하세요. 그다음 이 기기에서 그 클라우드 폴더가 모두 내려받아졌는지(온라인 전용이 아닌지) 확인하고 다시 고르세요.')}</p><p class="small muted">${tr('고른 폴더: {folder}',{folder:esc(shared.folder)})}</p>`,btn(tr('닫기'),'close','primary'));return;}modal(tr('동기화 폴더에서 저장소 가져오기'),`<p>${tr('이 기기에 빈 폴더를 골라 아래 저장소를 받아 옵니다. PDF·메모·필기·번역이 함께 옵니다.')}</p>${shared.vaults.map(v=>`<div class="manager-row"><span>${esc(v.name)} · ${tr('기기 {n}대 ({names})',{n:v.devices.length,names:v.devices.map(d=>esc(d.name)).join(', ')})}</span><button class="secondary small" data-sync-join="${esc(v.id)}" data-folder="${esc(shared.folder)}">${tr('가져오기')}</button></div>`).join('')}`,btn(tr('닫기'),'close'));})
});
document.addEventListener('click',event=>{
  const resolve=event.target.closest('[data-sync-resolve]');if(resolve)runDesktop(async()=>{await desktopNotes();applyItemSnapshot(await window.appApi.syncResolve(state.storageKey,resolve.dataset.syncResolve,resolve.dataset.choice),{screen:'library'});await showVaultManager();})();
  const found=event.target.closest('[data-open-found-vault]');if(found){runDesktop(async()=>{dialog.close();await desktopNotes();await globalThis.appFlushAll?.();applySnapshot(await window.appApi.openFoundVault(found.dataset.openFoundVault));await refreshPreferences();render();})();return;}
  const join=event.target.closest('[data-sync-join]');if(join)runDesktop(async()=>{dialog.close();await desktopNotes();await globalThis.appFlushAll?.();const result=await window.appApi.syncJoin(join.dataset.folder,join.dataset.syncJoin);if(!result)return;applySnapshot(result.snapshot);await refreshPreferences();})();
});
const baseWelcome=welcome;
welcome=function(){return baseWelcome().replace('</section><section class="recent">',`<button class="secondary sync-join" data-action="sync-join">${tr('다른 기기의 저장소 가져오기 (동기화 폴더)')}</button></section><section class="recent">`);};
// The first screen can render before this script loads; show the button then too.
if(state.screen==='welcome'&&document.querySelector('.welcome'))render();

// ---- Translation glossary: one "term = 번역" per line ----
let vaultGlossary=[];
const baseApplyGlossary=applySnapshot;
applySnapshot=function(snapshot){vaultGlossary=snapshot.glossary||[];vaultRules=snapshot.translationRules||'';vaultAiRules=snapshot.aiRules||'';baseApplyGlossary(snapshot);};
const baseManager5=showVaultManager;
showVaultManager=async function(){
  await baseManager5();
  const anchor=dialog.querySelector('.sync-section');if(!anchor||dialog.querySelector('.glossary-section'))return;
  anchor.insertAdjacentHTML('afterend',`<section class="rules-section"><h3>${tr('번역 요청 사항')}</h3><p class="small muted">${tr('문체·용어·표기 선호를 적으면 이 저장소의 모든 번역에 함께 보냅니다. 번역 창에서는 이번 번역에만 적용할 요청을 따로 적을 수 있고, 그 내용은 저장되지 않습니다.')}</p><textarea id="rules-text" rows="3" maxlength="2000" aria-label="${tr('번역 요청 사항')}">${esc(vaultRules)}</textarea><div class="row">${btn(tr('요청 사항 저장'),'rules-save','primary')}</div></section><section class="glossary-section"><h3>${tr('번역 용어집')}</h3><p class="small muted">${tr('한 줄에 “영문 용어 = 한국어 번역”으로 씁니다. 번역할 문단에 나오는 용어만 요청에 함께 보내고, 번역 결과에 정한 번역어가 없으면 “검토 필요”로 표시합니다. 이미 번역한 페이지는 다시 번역해야 반영됩니다.')}</p><textarea id="glossary-text" rows="5" aria-label="${tr('번역 용어집')}">${esc(vaultGlossary.map(e=>`${e.term} = ${e.translation}`).join('\n'))}</textarea><button class="secondary small" data-action="glossary-save">${tr('용어집 저장')}</button></section>`);
  dialog.querySelector('.glossary-section')?.insertAdjacentHTML('afterend',aiRulesSection());
};
actions['vault-manager']=runDesktop(showVaultManager);
actions['rules-save']=runDesktop(async()=>{await saveRulesFrom(document.querySelector('#rules-text'));toast(tr('번역 요청 사항을 저장했습니다.'));});
// 저장소 관리 › AI: the vault's requests for AI answers, a card of its own.
const AI_RULES_EXAMPLE=tr('예: 수식은 LaTeX($…$, $$…$$)로 써 주세요 · 용어는 처음에 영어를 괄호로 함께 · 답은 짧게');
const aiRulesSection=()=>`<section class="ai-rules-section" data-vm-kind="ai"><h3>${tr('AI 요청 사항')}</h3><p class="small muted">${tr('답변 방식·표기 선호를 적으면 이 저장소의 AI 답변에 함께 보냅니다: 메모·주석·요약 섹션의 AI(질문하기·고치기), 구조화 요약, 원문 질문, AI 비교, 그림 설명. 앱의 지침(근거 표시, 답의 형식과 언어)이 먼저이고, 태그 추천과 번역에는 보내지 않습니다(번역은 번역 탭의 요청 사항).')}</p><textarea id="ai-rules-text" rows="4" maxlength="2000" aria-label="${tr('AI 요청 사항')}" placeholder="${esc(AI_RULES_EXAMPLE)}">${esc(vaultAiRules)}</textarea><div class="row">${btn(tr('요청 사항 저장'),'ai-rules-save','primary')}</div></section>`;
actions['ai-rules-save']=runDesktop(async()=>{const field=document.querySelector('#ai-rules-text'),text=field?.value.trim()??'';vaultAiRules=(await window.appApi.aiRulesSave(state.storageKey,text)).aiRules||'';if(field)field.value=vaultAiRules;
  const dot=document.querySelector('[data-vm-tab="ai"] .vm-dot');if(vaultAiRules&&!dot)document.querySelector('[data-vm-tab="ai"]')?.insertAdjacentHTML('beforeend',` <span class="vm-dot" title="${tr('저장소 AI 요청 사항 적용 중')}"></span>`);else if(!vaultAiRules)dot?.remove();
  toast(vaultAiRules?tr('AI 요청 사항을 저장했습니다.'):tr('AI 요청 사항을 지웠습니다.'));});
actions['glossary-save']=runDesktop(async()=>{
  const lines=document.querySelector('#glossary-text').value.split(/\r?\n/).map(l=>l.trim()).filter(l=>l&&!l.startsWith('#'));
  const list=lines.map((line,i)=>{const at=line.indexOf('=');if(at<1||!line.slice(at+1).trim())throw Error(tr('{n}번째 줄을 “용어 = 번역”으로 고쳐 주세요.',{n:i+1}));return {term:line.slice(0,at).trim(),translation:line.slice(at+1).trim()};});
  const snapshot=await window.appApi.glossarySave(state.storageKey,list);vaultGlossary=snapshot.glossary||[];toast(tr('용어 {n}개를 저장했습니다.',{n:list.length}));
});

// ---- Add a paper from a DOI, after reviewing the looked-up record ----
let doiCandidate=null;
async function addByDOI(){modal(tr('DOI로 추가'),`<label for="add-doi">DOI</label><input id="add-doi" placeholder="10.xxxx/…" maxlength="300"><p class="small muted" id="add-doi-status" role="status">${tr('Crossref에서 서지정보를 찾아 보여 드립니다. 확인한 뒤 추가하세요.')}</p><div id="add-doi-preview"></div>`,btn(tr('취소'),'close')+btn(tr('조회'),'add-doi-lookup')+btn(tr('추가'),'add-doi-confirm','primary'));dialog.querySelector('[data-action="add-doi-confirm"]').disabled=true;document.querySelector('#add-doi').focus();}
Object.assign(actions,{
  'add-by-doi':addByDOI,
  'add-doi-lookup':runDesktop(async()=>{const status=document.querySelector('#add-doi-status');status.textContent=tr('조회 중…');doiCandidate=null;try{doiCandidate=await window.appApi.lookupDOI(document.querySelector('#add-doi').value);}catch(error){status.textContent=shownError(error);return;}
    const duplicate=papers.find(p=>p.doi&&p.doi.toLowerCase()===doiCandidate.doi.toLowerCase());
    document.querySelector('#add-doi-preview').innerHTML=`<dl class="bibliography">${[[tr('자료 유형'),bibTypes[doiCandidate.type]],[tr('제목'),doiCandidate.title],[tr('저자'),doiCandidate.authors],[tr('날짜'),doiCandidate.date||doiCandidate.year],[tr('수록처'),doiCandidate.journal],[tr('권·호·쪽'),[doiCandidate.volume,doiCandidate.issue&&`(${doiCandidate.issue})`,doiCandidate.pages].filter(Boolean).join(' ')]].filter(([,v])=>v).map(([k,v])=>`<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>`;
    status.textContent=duplicate?tr('같은 DOI의 자료가 이미 있습니다: {title}',{title:duplicate.title}):tr('확인한 뒤 추가하세요. PDF는 나중에 첨부할 수 있습니다.');dialog.querySelector('[data-action="add-doi-confirm"]').disabled=Boolean(duplicate);}),
  'add-doi-confirm':runDesktop(async()=>{if(!doiCandidate)return;const id=state.storageKey,result=await window.appApi.createPaper(id,doiCandidate);doiCandidate=null;applyItemSnapshot(result.snapshot,{paperId:result.paperId,screen:'library'});toast(tr('서지 항목을 추가했습니다. “PDF 첨부”로 원문을 연결하세요.'));})
});
document.addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.isComposing&&event.target.id==='add-doi'){event.preventDefault();actions['add-doi-lookup']();}});
const baseLibraryDOI=library;
library=function(){return baseLibraryDOI().replace('<button class="primary" data-action="add-files">',`<button class="secondary" data-action="add-by-doi">${tr('DOI로 추가')}</button><button class="primary" data-action="add-files">`);};

// ---- Collections are an optional feature (desktop/features.cjs) ----
// The top-bar button beside 작업 switches it on and off. Off
// hides every collection control; the collections and each paper's
// membership stay in the vault and come back when it is switched on.
const baseTopbarFeatures=topbar;
topbar=function(){
  const html=baseTopbarFeatures();if(!featureAvailable('collections'))return html;
  const on=featureOn('collections');
  return html.replace(/(<button class="round-button" data-action="jobs"[^>]*>[\s\S]*?<\/button>)/,m=>`${m}<button class="round-button feature-toggle" data-action="toggle-collections" aria-pressed="${on}" title="${on?tr('컬렉션 끄기 (만든 컬렉션은 보관됩니다)'):tr('컬렉션 켜기')}" aria-label="${on?tr('컬렉션 끄기'):tr('컬렉션 켜기')}">${icon('collections')}</button>`);
};
actions['toggle-collections']=runDesktop(async()=>{
  const on=!featureOn('collections');desktopPreferences.features=await window.appApi.featureSet('collections',on);
  if(!on&&state.collection){state.collection=null;state.nav='전체 자료';state.savedSearch=null;} // i18n:keep — navigation value
  render();
  if(on){setViewOpen('collections',true);refreshVaultSidebar();}
  toast(on?tr('컬렉션을 켰습니다. 왼쪽 컬렉션의 +로 만들고, 자료 정보에서 넣고 뺍니다.'):tr('컬렉션을 껐습니다. 만든 컬렉션과 지정 내용은 그대로 보관됩니다.'));
});
const baseManagerFeatures=showVaultManager;
showVaultManager=async function(){
  await baseManagerFeatures();if(featureOn('collections'))return;
  const heading=dialog.querySelector('h3[data-vm-kind="collections"]');if(!heading)return;
  if(heading.nextElementSibling?.classList.contains('manager-list'))heading.nextElementSibling.remove();heading.remove();
};
actions['vault-manager']=runDesktop(showVaultManager);

// ---- 저장소 관리, arranged: the sections the layers above add are moved, as they are (their buttons
// keep their actions), into tabs: 번역 · 서지 · 백업 · 동기화 · 휴지통 (and 컬렉션 when that feature is
// on). Each tab holds cards with a title, a line on what it does and its controls. The tab chosen
// last opens again, also when an action redraws the window.
const VM_TABS=[['translation',tr('번역')],['ai','AI'],['bib',tr('서지')],['backup',tr('백업')],['sync',tr('동기화')],['trash',tr('휴지통')],['collections',tr('컬렉션')],['other',tr('기타')]];
let vmTab='translation';
// Each part of the vault manager says which tab it belongs to (data-vm-kind); the rest is told apart by its controls.
const vmKind=n=>{
  if(n.dataset?.vmKind)return n.dataset.vmKind;
  if(n.matches('.rules-section,.glossary-section'))return 'translation';
  if(n.matches('.sync-section'))return 'sync';
  if(n.querySelector?.('[data-action="import-ris"],[data-action^="export-"],#autofill-toggle'))return 'bib';
  if(n.querySelector?.('[data-restore-paper],[data-restore-attachment]'))return 'trash';
  if(n.querySelector?.('[data-edit-collection],[data-move-collection]'))return 'collections';
  if(n.querySelector?.('[data-action="create-backup"],[data-action="full-backup"],[data-restore-backup]'))return 'backup';
  return 'other';
};
const vmCard=(title,note,...nodes)=>{const card=document.createElement('section');card.className='vm-card';card.innerHTML=`<h3>${esc(title)}</h3>${note?`<p class="small muted">${note}</p>`:''}`;for(const n of nodes)if(n)card.append(n);return card;};
const vmButtons=(...buttons)=>{const row=document.createElement('div');row.className='vm-buttons';for(const b of buttons)if(b){b.classList.remove('small');row.append(b);}return row;};
function vmArrange(inner){
  const groups=Object.fromEntries(VM_TABS.map(([k])=>[k,[]]));
  for(const n of [...inner.children])if(!n.matches('.dialog-head,.actions'))groups[vmKind(n)].push(n);
  const take=(group,test)=>{const i=groups[group].findIndex(test);return i<0?null:groups[group].splice(i,1)[0];};
  const panels={};
  // 번역: the vault's requests and glossary, each a card.
  panels.translation=groups.translation.map(n=>{n.classList.add('vm-card');return n;});
  // AI: the vault's requests for AI answers.
  panels.ai=groups.ai.map(n=>{n.classList.add('vm-card');return n;});
  // 서지: import, export, automatic lookup.
  {const q=sel=>groups.bib.map(n=>n.matches(sel)?n:n.querySelector(sel)).find(Boolean);
    const imp=q('[data-action="import-ris"]'),exps=['export-ris','export-bib','export-biblatex','export-csl'].map(a=>q(`[data-action="${a}"]`)),auto=take('bib',n=>n.querySelector?.('#autofill-toggle')||n.matches('label'));
    if(imp)imp.textContent=tr('서지 파일 가져오기');
    // The card's title says what the switch is; its note keeps only the rest.
    if(auto)auto.querySelector('.autofill-title')?.remove();
    const names={'export-ris':'RIS','export-bib':'BibTeX','export-biblatex':'BibLaTeX','export-csl':'CSL JSON'};exps.forEach(b=>{if(b)b.textContent=names[b.dataset.action];});
    panels.bib=[vmCard(tr('가져오기'),tr('RIS · BibTeX · CSL JSON 파일의 서지를 가져옵니다. 가져오기 전에 결과를 확인합니다.'),vmButtons(imp)),vmCard(tr('내보내기'),tr('저장소 전체 서지를 선택한 형식의 파일로 저장합니다.'),vmButtons(...exps)),...(auto?[vmCard(tr('빈 서지정보 자동 채우기'),'',auto)]:[])];
}
  // 백업: make one, restore one.
  {const q=sel=>groups.backup.map(n=>n.matches?.(sel)?n:n.querySelector?.(sel)).find(Boolean);
    const meta=q('[data-action="create-backup"]'),full=q('[data-action="full-backup"]'),restoreFull=q('[data-action="full-restore"]'),list=take('backup',n=>n.matches('.manager-list'));
    if(meta)meta.textContent=tr('메타데이터 백업');if(full)full.textContent=tr('전체 백업');if(restoreFull)restoreFull.textContent=tr('전체 백업에서 복원…');
    if(full)full.classList.replace('secondary','primary');
    panels.backup=[
      vmCard(tr('백업 만들기'),tr('<b>전체 백업</b>은 PDF·서지·메모·주석·필기·번역을 해시 목록과 함께 새 폴더에 복사합니다. <b>메타데이터 백업</b>은 서지·메모·주석·첨부 경로만 저장소 안에 저장합니다(최근 20개 보관).'),vmButtons(full,meta)),
      vmCard(tr('전체 백업에서 복원'),tr('빈 폴더에 별도 저장소로 만들고, 모든 파일의 해시를 확인합니다. 지금 저장소는 바뀌지 않습니다.'),vmButtons(restoreFull)),
      vmCard(tr('메타데이터 백업 목록'),tr('복원하면 백업한 뒤의 서지·메모·주석 편집이 그 시점으로 돌아갑니다. PDF와 번역은 바뀌지 않습니다.'),list)];}
  // What the cards above did not take: headings and notes they replace go; anything with a control
  // (a button added later) is kept in a card of its own tab.
  for(const key of ['bib','backup']){const rest=groups[key].filter(n=>n.isConnected&&n.querySelector?.('button,input,select'));groups[key].forEach(n=>{if(!rest.includes(n))n.remove();});if(rest.length)panels[key].push(vmCard(tr('그 밖의 기능'),'',...rest));}
  // 동기화: the section as it is.
  panels.sync=groups.sync.map(n=>{n.classList.add('vm-card');return n;});
  // 휴지통 and 컬렉션: each heading with its list, as a card.
  for(const key of ['trash','collections','other']){
    const cards=[];let card=null;
    for(const n of groups[key]){if(n.tagName==='H3'||!card){card=document.createElement('section');card.className='vm-card';cards.push(card);}card.append(n);}
    panels[key]=cards;
  }
  return panels;
}
const baseManagerLayout=showVaultManager;
showVaultManager=async function(){
  await baseManagerLayout();
  const inner=dialog.querySelector('.dialog-inner');if(!inner||inner.querySelector('.vm-tabs')||!dialog.querySelector('[data-vault-manager]'))return;
  const panels=vmArrange(inner),tabs=VM_TABS.filter(([k])=>panels[k]?.length);if(!tabs.some(([k])=>k===vmTab))vmTab=tabs[0][0];
  const trashCount=(vaultTrash?.length||0)+(vaultTrashAttachments?.length||0);
  const badge=k=>k==='trash'&&trashCount?` <span class="vm-count">${trashCount}</span>`:k==='translation'&&vaultRules?` <span class="vm-dot" title="${tr('저장소 요청 사항 적용 중')}"></span>`:k==='ai'&&vaultAiRules?` <span class="vm-dot" title="${tr('저장소 AI 요청 사항 적용 중')}"></span>`:k==='sync'&&dialog.querySelector('[data-action="sync-run"]')?` <span class="vm-dot" title="${tr('동기화 연결됨')}"></span>`:'';
  const nav=document.createElement('div');nav.className='vm-tabs';nav.setAttribute('role','tablist');nav.setAttribute('aria-label',tr('저장소 관리'));
  nav.innerHTML=tabs.map(([k,label])=>`<button type="button" role="tab" id="vm-tab-${k}" data-vm-tab="${k}" aria-controls="vm-panel-${k}" aria-selected="${k===vmTab}" tabindex="${k===vmTab?0:-1}">${label}${badge(k)}</button>`).join('');
  const body=document.createElement('div');body.className='vm-body';
  for(const [k] of tabs){const panel=document.createElement('div');panel.className='vm-panel';panel.id=`vm-panel-${k}`;panel.setAttribute('role','tabpanel');panel.setAttribute('aria-labelledby',`vm-tab-${k}`);panel.hidden=k!==vmTab;panel.append(...panels[k]);body.append(panel);}
  inner.querySelector('.dialog-head').after(nav,body);dialog.classList.add('vault-manager');
};
function vmShow(tab){
  vmTab=tab;for(const b of dialog.querySelectorAll('[data-vm-tab]')){const on=b.dataset.vmTab===tab;b.setAttribute('aria-selected',String(on));b.tabIndex=on?0:-1;}
  for(const p of dialog.querySelectorAll('.vm-panel'))p.hidden=p.id!==`vm-panel-${tab}`;
  dialog.querySelector('.vm-body')?.scrollTo(0,0);
}
document.addEventListener('click',event=>{const b=event.target.closest('[data-vm-tab]');if(b)vmShow(b.dataset.vmTab);});
document.addEventListener('keydown',event=>{const b=event.target.closest?.('[data-vm-tab]');if(!b||!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const all=[...dialog.querySelectorAll('[data-vm-tab]')],i=all.indexOf(b),next=event.key==='Home'?0:event.key==='End'?all.length-1:(i+(event.key==='ArrowRight'?1:all.length-1))%all.length;all[next].focus();vmShow(all[next].dataset.vmTab);});
// The 'close' event is queued: one from the dialog closed just before can come after the vault manager is already open in
// it (settings closed, vault manager opened), and must not take back its width (its tabs then scroll in a narrow dialog).
dialog.addEventListener('close',()=>{if(!dialog.open)dialog.classList.remove('vault-manager');});
actions['vault-manager']=runDesktop(showVaultManager);
// From the translation window: 저장소 관리, opened on the translation requests.
actions['vault-manager-rules']=runDesktop(async()=>{vmTab='translation';await showVaultManager();document.querySelector('#rules-text')?.focus();});
// Selecting several papers or files as in a file manager: Ctrl(⌘)+click adds or removes one,
// Shift+click selects the range from the last clicked one, Ctrl+A selects the whole list and Esc
// clears it. A plain click still opens the paper or file. The list's selection is the checkboxes'.
const treeKey=(paperId,attachmentId)=>paperId+':'+attachmentId;
function selectedTreeFiles(){return [...treeSelection].map(key=>{const at=key.indexOf(':'),paperId=Number(key.slice(0,at)),attachmentId=key.slice(at+1);return papers.find(p=>p.id===paperId)?.attachments.some(a=>a.id===attachmentId&&a.file)?{paperId,attachmentId}:null;}).filter(Boolean);}
function paintTreeSelection(){document.querySelectorAll('.vault-file[data-tree-file]').forEach(el=>{const on=treeSelection.has(treeKey(el.dataset.treeFile,el.dataset.attachmentId));el.classList.toggle('multi-selected',on);el.setAttribute('aria-selected',String(on));});}
const baseVaultTree=vaultTree;
vaultTree=function(){return baseVaultTree().replace(/<nav class="vault-tree"([^>]*)>/,'<nav class="vault-tree"$1 aria-multiselectable="true">').replace(/class="vault-file ([^"]*)" draggable="true" data-attachment-id="([^"]*)" data-tree-file="(\d+)"/g,(m,cls,attachmentId,paperId)=>{const on=treeSelection.has(treeKey(paperId,attachmentId.replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>')));return `class="vault-file ${cls}${on?' multi-selected':''}" aria-selected="${on}" draggable="true" data-attachment-id="${attachmentId}" data-tree-file="${paperId}"`;});};
function rangeOf(order,from,to){const a=order.indexOf(from),b=order.indexOf(to);if(a<0||b<0)return [to];return order.slice(Math.min(a,b),Math.max(a,b)+1);}
function refreshBatchBar(){const bar=document.querySelector('.batch-bar'),html=batchBar();if(bar)bar.outerHTML=html||'<span hidden class="batch-bar"></span>';else if(html)document.querySelector('#paper-list')?.insertAdjacentHTML('beforebegin',html);syncSelectAll();}
function syncChecks(){document.querySelectorAll('[data-batch-paper]').forEach(box=>{box.checked=batchSelection.has(Number(box.dataset.batchPaper));});refreshBatchBar();}
const modified=event=>event.ctrlKey||event.metaKey||event.shiftKey;
// Shift+click would also select the rows' text.
window.addEventListener('mousedown',event=>{if(event.shiftKey&&event.target.closest?.('.paper-item[data-paper],.vault-file[data-tree-file]'))event.preventDefault();},true);
window.addEventListener('click',event=>{
  const row=event.target.closest?.('.paper-item[data-paper]');
  if(row&&!event.target.closest('[data-star],[data-batch-paper]')){
    const id=Number(row.dataset.paper);
    if(!modified(event)){batchAnchor=id;return;}
    event.preventDefault();event.stopImmediatePropagation();
    if(event.shiftKey){const order=[...document.querySelectorAll('#paper-list .paper-item[data-paper]')].map(el=>Number(el.dataset.paper)),from=batchAnchor??state.selected??id;if(!(event.ctrlKey||event.metaKey))batchSelection.clear();for(const x of rangeOf(order,from,id))batchSelection.add(x);}
    else{if(batchSelection.has(id))batchSelection.delete(id);else batchSelection.add(id);batchAnchor=id;}
    syncChecks();row.focus();return;
  }
  const file=event.target.closest?.('.vault-file[data-tree-file]');
  if(file){
    const key=treeKey(file.dataset.treeFile,file.dataset.attachmentId);
    if(!modified(event)){treeSelection.clear();treeAnchor=key;paintTreeSelection();return;}
    event.preventDefault();event.stopImmediatePropagation();
    if(event.shiftKey){const order=[...document.querySelectorAll('.vault-file[data-tree-file]')].map(el=>treeKey(el.dataset.treeFile,el.dataset.attachmentId)),from=treeAnchor??key;if(!(event.ctrlKey||event.metaKey))treeSelection.clear();for(const x of rangeOf(order,from,key))treeSelection.add(x);}
    else{if(treeSelection.has(key))treeSelection.delete(key);else treeSelection.add(key);treeAnchor=key;}
    paintTreeSelection();file.focus();
  }
},true);
window.addEventListener('keydown',event=>{
  if(event.isComposing||dialog.open||event.target.closest?.('input,textarea,select,[contenteditable="true"]'))return;
  const inList=event.target.closest?.('#paper-list'),inTree=event.target.closest?.('.vault-tree');
  if((event.ctrlKey||event.metaKey)&&!event.shiftKey&&!event.altKey&&event.key.toLowerCase()==='a'&&(inList||inTree)){
    event.preventDefault();event.stopImmediatePropagation();
    if(inList){for(const p of filtered())batchSelection.add(p.id);syncChecks();}
    else{document.querySelectorAll('.vault-file[data-tree-file]').forEach(el=>treeSelection.add(treeKey(el.dataset.treeFile,el.dataset.attachmentId)));paintTreeSelection();}
    return;
  }
  if(event.key==='Escape'&&(inList&&batchSelection.size||inTree&&treeSelection.size)){event.preventDefault();event.stopImmediatePropagation();if(inList){batchSelection.clear();syncChecks();}else{treeSelection.clear();paintTreeSelection();}}
},true);
// Right-click on one of several selected files: move them all.
window.addEventListener('contextmenu',event=>{
  const file=event.target.closest?.('.vault-file[data-tree-file]');if(!file)return;
  const files=selectedTreeFiles();if(files.length<2||!treeSelection.has(treeKey(file.dataset.treeFile,file.dataset.attachmentId)))return;
  event.preventDefault();event.stopImmediatePropagation();
  openPopMenu(file,`<button type="button" role="menuitem" data-action="tree-move">${tr('선택한 파일 {n}개 이동…',{n:files.length})}</button><button type="button" role="menuitem" data-action="tree-clear">${tr('선택 해제')}</button>`,tr('선택한 파일 메뉴'));
},true);
function moveDialog(files){
  pendingMove=files;const here=new Set(files.map(f=>papers.find(p=>p.id===f.paperId)?.attachments.find(a=>a.id===f.attachmentId)?.folder||''));
  const current=here.size===1?[...here][0]:null;
  modal(tr('폴더로 이동'),`<p class="small">${tr('파일 {n}개를 옮깁니다. 파일 이름은 그대로 두며, 이미 그 폴더에 있는 파일은 건너뜁니다.',{n:files.length})}</p><div class="field"><label for="batch-move-folder">${tr('폴더')}</label><select id="batch-move-folder">${['',...vaultFolders].map(folder=>`<option value="${esc(folder)}" ${folder===current?'selected':''}>${esc(folder||state.name)}</option>`).join('')}</select></div>`,btn(tr('취소'),'close')+btn(tr('이동'),'confirm-batch-move','primary'));
  document.querySelector('#batch-move-folder').focus();
}
Object.assign(actions,{
  'batch-move':()=>{const files=mainFiles([...batchSelection]);if(files.length)moveDialog(files);else toast(tr('선택한 자료에 옮길 PDF가 없습니다.'));},
  'tree-move':()=>{closePopMenu();const files=selectedTreeFiles();if(files.length)moveDialog(files);},
  'tree-clear':()=>{closePopMenu();treeSelection.clear();paintTreeSelection();},
  'confirm-batch-move':runDesktop(async()=>{const files=pendingMove,folder=document.querySelector('#batch-move-folder')?.value;if(!files||folder===undefined)return;pendingMove=null;dialog.close();await moveToFolder(folder,files);paintTreeSelection();})
});

