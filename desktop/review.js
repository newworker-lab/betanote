/* Translation review: result quality apart from job state, and user
   corrections kept beside (never inside) the AI translation. */
const reviewLabels={translated:tr('번역됨'),corrected:tr('교정',null,'review status'),review:tr('검토 필요'),source:tr('원문 유지'),missing:tr('미번역'),pending:tr('대기',null,'review status')};
function reviewRecord(){
  const key=targetKey(),job=currentJob?.key===key?currentJob:null,busy=job&&['running','extracting'].includes(job.state);
  return (!busy&&globalThis.appInk?.baseRecord(key))||(progressRecord?.key===key?progressRecord:!busy&&translationRecord?.key===key?translationRecord:null);
}
// A translated page's blocks, classified once per page object: a running job
// publishes a new object for each changed page, so unchanged pages are reused.
const reviewLayouts=new WeakMap();
function reviewLayout(page){let blocks=reviewLayouts.get(page);if(!blocks){blocks=globalThis.appPdfLayout.layoutBlocks(page);reviewLayouts.set(page,blocks);}return blocks;}
// Every block lands in exactly one bucket; intentional source keeps are not failures.
function reviewCounts(record){
  const counts={translated:0,corrected:0,review:0,source:0,missing:0,pending:0},missing=[],review=[];
  record.pages.forEach((page,index)=>{
    if(!page){counts.pending++;return;}
    for(const b of reviewLayout(page)){
      if(b.pending){counts.pending++;continue;}
      if(b.sourceOnly){counts.source++;continue;}
      if(b.missingTranslation||!String(b.translation||'').trim()){counts.missing++;missing.push({page:index+1,id:b.id,text:b.text,...(b.warnings?.length?{warnings:b.warnings}:{})});continue;}
      if(b.corrected){counts.corrected++;if(b.correctionStale)review.push({page:index+1,id:b.id,text:b.text,stale:true});continue;}
      if(b.warnings?.length){counts.review++;review.push({page:index+1,id:b.id,text:b.text,warnings:b.warnings});continue;}
      counts.translated++;
    }
  });
  return {counts,missing,review};
}
let reviewSummary=null;
let reviewWaiting=false;
function reviewRefresh(){
  // Job state stays in the header; result quality sits in the tool row.
  const pane=document.querySelector('.translated-pane'),tools=pane?.querySelector(':scope>.pdf-pane-tools');if(!tools)return;
  // The block layout comes with the PDF engine, loaded on first use: a translation reopened as the
  // app starts can be drawn before it. The quality shows once the engine is there.
  if(!globalThis.appPdfLayout){if(!reviewWaiting){reviewWaiting=true;pdfEngine().catch(()=>{}).then(()=>{reviewWaiting=false;if(globalThis.appPdfLayout)reviewRefresh();});}return;}
  tools.querySelector('.translation-quality')?.remove();
  const record=reviewRecord();if(!record?.pages?.some(Boolean)){reviewSummary=null;return;}
  // A record straight from a finished job has no correction layer yet.
  if(record===translationRecord&&!record.partial&&!record.corrections&&!record.correctionReload){record.correctionReload=true;runDesktop(reloadCorrected)();}
  reviewSummary=reviewCounts(record);const {counts}=reviewSummary;
  const parts=Object.entries(counts).filter(([,n])=>n).map(([k,n])=>`<span class="quality-${k}">${k==='pending'?tr('{label} {n}쪽',{label:reviewLabels[k],n}):`${reviewLabels[k]} ${n}`}</span>`);
  tools.insertAdjacentHTML('beforeend',`<button type="button" class="translation-quality" data-action="translation-quality" title="${tr('번역 결과 상태: 작업 상태와 별개로 문단별 결과를 셉니다')}">${parts.join(' · ')}</button>`);
}
const reviewBaseRefresh=refreshTranslationPane;
refreshTranslationPane=function(){reviewBaseRefresh();reviewRefresh();};
function qualityDialog(){
  if(!reviewSummary)return;const {counts,missing,review}=reviewSummary;
  const row=item=>`<li><button type="button" class="secondary small" data-review-jump="${item.page}">${tr('{n}쪽',{n:item.page})}</button> ${esc(item.text.slice(0,120))}${item.stale?` <span class="pill amber">${tr('교정 후 재번역됨 · 비교 필요')}</span>`:''}${item.warnings?` <small class="muted">${esc(item.warnings.map(w=>globalThis.appPdfLayout.warningText(w)).join(' · '))}</small>`:''}</li>`;
  const pages=[...new Set(missing.map(m=>m.page))];
  modal(tr('번역 결과 상태'),`<p>${Object.entries(counts).map(([k,n])=>`${reviewLabels[k]} ${n}`).join(' · ')}</p><p class="small muted">${tr('“원문 유지”는 수식·참고문헌 등 의도적으로 원문을 보존한 문단입니다. 작업이 끝났어도 미번역 문단이 있으면 그 페이지를 다시 번역하세요. 문단을 두 번 누르면 번역을 교정할 수 있습니다.')}</p>${missing.length?`<h3>${tr('미번역 {n}',{n:missing.length})}</h3><ul class="quality-list">${missing.slice(0,200).map(row).join('')}</ul>${pages.length?`<div class="row">${pages.slice(0,20).map(n=>`<button type="button" class="secondary small" data-retranslate-page="${n}">${tr('{n}쪽 다시 번역',{n})}</button>`).join('')}</div>`:''}`:''}${review.length?`<h3>${tr('검토 필요 {n}',{n:review.length})}</h3><ul class="quality-list">${review.slice(0,200).map(row).join('')}</ul>`:''}`,btn(tr('닫기'),'close','primary'));
  qualityProblemPages();
}
// The pages only a new translation puts right, checked against today's paragraphs (the counts
// above are of the stored record alone): one button translates just those pages again.
async function qualityProblemPages(){
  const key=targetKey(),record=reviewRecord(),list=dialog.querySelector('.dialog-inner');if(!record||!list||record.partial)return;
  const slot=document.createElement('div');slot.className='quality-problems small muted';slot.textContent=tr('다시 번역이 필요한 쪽을 확인하는 중…');list.insertBefore(slot,list.querySelector(':scope>.actions'));
  let found;try{found=await(await pdfEngine()).problemPages(record,state.storageKey,state.selected,state.selectedAttachment);}catch{found=null;}
  if(!slot.isConnected||key!==targetKey())return;
  const pages=found?[...new Set([...found.missing,...found.mapping])].sort((a,b)=>a-b):[];
  if(!pages.length){slot.textContent=found?tr('지금의 문단 구조와 비교해도 다시 번역이 필요한 쪽은 없습니다.'):'';return;}
  const busy=currentJob?.key===key&&['running','extracting'].includes(currentJob.state),name=list=>list.length>12?tr('{pages} 외 {n}쪽',{pages:list.slice(0,12).join(', '),n:list.length-12}):list.join(', ');
  slot.classList.remove('muted');
  slot.innerHTML=`<h3>${tr('다시 번역이 필요한 쪽 {n}',{n:pages.length})}</h3><p>${found.missing.length?`${tr('미번역 문단이 있는 쪽: {pages}.',{pages:esc(name(found.missing))})} `:''}${found.mapping.length?tr('번역한 뒤 문단 구조가 달라진 쪽: {pages}.',{pages:esc(name(found.mapping))}):''}</p><p class="muted">${tr('번역할 때 읽지 못한 문단(그림으로 된 슬라이드 글)이나 응답이 빠진 문단, 그리고 문단을 나누는 방식이 바뀌어 옛 번역과 맞지 않는 쪽입니다. 이 쪽들만 다시 번역하고 나머지는 그대로 둡니다.')}</p><div class="row"><button type="button" class="primary small" data-retranslate-pages="${pages.join(',')}"${busy?' disabled':''}>${tr('이 {n}쪽만 다시 번역',{n:pages.length})}</button></div>`;
}

document.addEventListener('click',event=>{
  const jump=event.target.closest('[data-review-jump]');if(!jump)return;dialog.close();
  for(const container of document.querySelectorAll('.translated-pages')){const sheet=container.querySelector(`[data-page="${jump.dataset.reviewJump}"]`);if(sheet)container.scrollTop+=sheet.getBoundingClientRect().top-container.getBoundingClientRect().top;}
});
// The retranslate buttons inside the dialog close it first.
document.addEventListener('click',event=>{if(event.target.closest('#dialog [data-retranslate-page]')&&dialog.querySelector('.quality-list')||event.target.closest('#dialog [data-retranslate-pages]'))dialog.close();},true);

// ---- Corrections ----
let correctionTarget=null;
function findBlock(record,id){for(const [i,page] of record.pages.entries())for(const b of page?.blocks||[])if(b.id===id)return {block:b,page:i+1};return null;}
async function openCorrection(blockId){
  const key=targetKey(),record=reviewRecord();
  if(!record||record.partial||!translationRecord||record!==translationRecord){toast(globalThis.appInk?.baseRecord(key)?tr('필기한 이전 번역은 교정할 수 없습니다. 현재 번역에서 교정하세요.'):tr('번역이 끝난 뒤 교정할 수 있습니다.'));return;}
  const found=findBlock(record,blockId);if(!found)return;
  const {block,page}=found,entry=await window.appApi.correctionGet(state.storageKey,state.selected,state.selectedAttachment,blockId);if(key!==targetKey())return;
  const ai=block.corrected?block.aiTranslation:block.translation||'';
  correctionTarget={key,blockId,ai,sourceHash:record.sourceHash};
  modal(tr('{page}쪽 번역 교정',{page}),`<h3>${tr('원문')}</h3><blockquote class="correction-source">${esc(block.text)}</blockquote><h3>${block.correctionStale?tr('AI 번역 (교정 후 다시 번역된 새 결과)'):tr('AI 번역')}</h3><p class="correction-ai">${esc(ai||tr('(번역 없음)'))}</p>${block.correctionStale?`<p class="pill amber">${tr('교정할 때의 AI 번역: {text}',{text:esc(entry?.aiText||'')})}</p>`:''}<label for="correction-text">${tr('교정한 번역')}</label><textarea id="correction-text" rows="6" maxlength="24000">${esc(block.corrected?block.translation:ai)}</textarea><p class="small muted">${tr('교정은 AI 번역과 따로 저장됩니다. 다시 번역해도 교정은 유지되고, 새 AI 번역과 비교할 수 있습니다.')}</p>${entry?.history?.length?`<details><summary>${tr('이전 교정 {n}개',{n:entry.history.length})}</summary><ul>${entry.history.slice().reverse().map(h=>`<li><small>${esc(new Date(h.at).toLocaleString(appI18n.uiLocale()))}</small> ${esc(h.text)}</li>`).join('')}</ul></details>`:''}`,btn(tr('취소'),'close')+(block.corrected?btn(block.correctionStale?tr('새 AI 번역 채택'):tr('AI 번역으로 되돌리기'),'correction-revert'):'')+btn(tr('교정 저장'),'correction-save','primary'));
}
async function reloadCorrected(){
  const key=targetKey(),cached=await window.appApi.cachedTranslation(state.storageKey,state.selected,state.selectedAttachment);if(key!==targetKey()||!cached)return;
  translationRecord={...cached,key,renderRevision:cached.renderRevision};const container=document.querySelector('.translated-pane .translated-pages');if(container)container.dataset.revision='';refreshTranslationPane();
}
Object.assign(actions,{
  'translation-quality':qualityDialog,
  'correction-save':runDesktop(async()=>{const t=correctionTarget,text=document.querySelector('#correction-text').value;if(!t||t.key!==targetKey()||!text.trim())return;await window.appApi.correctionSet(state.storageKey,state.selected,state.selectedAttachment,t.blockId,{text,aiText:t.ai,sourceHash:t.sourceHash});dialog.close();await reloadCorrected();toast(tr('번역 교정을 저장했습니다.'));}),
  'correction-revert':runDesktop(async()=>{const t=correctionTarget;if(!t||t.key!==targetKey())return;await window.appApi.correctionRemove(state.storageKey,state.selected,state.selectedAttachment,t.blockId);dialog.close();await reloadCorrected();toast(tr('AI 번역을 표시합니다. 이전 교정은 기록에 남겼습니다.'));})
});
document.addEventListener('dblclick',event=>{
  if(document.body.classList.contains('ink-active')||document.body.classList.contains('view-window'))return; // a window that only reads corrects nothing
  const block=event.target.closest('.translated-pane .translated-block[data-block-id]');if(!block)return;
  event.preventDefault();runDesktop(()=>openCorrection(block.dataset.blockId))();
});

// A paragraph whose source has a glossary term but whose translation lacks
// the chosen rendering is counted as needing review.
const baseReviewCounts=reviewCounts;
reviewCounts=function(record){
  const result=baseReviewCounts(record);if(!vaultGlossary.length)return result;
  record.pages.forEach((page,index)=>{if(!page)return;for(const b of reviewLayout(page)){
    if(b.sourceOnly||b.pending||!String(b.translation||'').trim()||b.corrected)continue;
    const misses=vaultGlossary.filter(e=>b.text.toLowerCase().includes(e.term.toLowerCase())&&!b.translation.includes(e.translation));
    if(!misses.length)continue;
    if(!result.review.some(r=>r.id===b.id)){result.counts.review++;if(!b.warnings?.length)result.counts.translated--;}
    result.review.push({page:index+1,id:b.id,text:b.text,warnings:misses.map(e=>tr('용어집: {term} → {translation}',{term:e.term,translation:e.translation}))});
  }});
  return result;
};
