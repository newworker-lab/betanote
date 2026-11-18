/* AI tab: source-linked summary, selection explanation and paper questions.
   Nothing is sent before the user confirms the model and the text range. */
const insightSections={question:'연구 질문',method:'방법',result:'결과',limitation:'한계',contribution:'기여',explanation:'설명',answer:'답변'}; // i18n:keep — the names in the text sent to the AI (insightText); the screen uses sectionLabel()
const sectionLabel=key=>({question:tr('연구 질문'),method:tr('방법'),result:tr('결과'),limitation:tr('한계'),contribution:tr('기여'),explanation:tr('설명',null,'section'),answer:tr('답변')})[key];
const kindLabel=kind=>({summary:tr('구조화 요약'),explain:tr('선택 설명'),ask:tr('질문')})[kind]??kind;
const insightState={results:new Map(),blocks:new Map(),busy:null,selection:null,error:'',open:null,heights:new Map()};
const INSIGHT_NOTE=tr('질문과 구조화 요약은 아래 AI 기록에 초안으로 따로 저장되고, 메모에는 “노트로 채택”을 누를 때만 들어갑니다. 문장에 대한 질문은 원문에서 글을 고른 뒤 주석 추가(N)를 누르고, 그 주석에서 AI에게 물으면 됩니다. 근거 쪽 번호를 누르면 원문 위치로 이동합니다.');
paths.info='M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M12 11v5.5 M11.3 7.8a.7.7 0 1 0 1.4 0a.7.7 0 1 0-1.4 0';
const basePanelInsight=panel;
panel=function(){
  if(state.tab==='AI')state.tab='요약'; // i18n:keep — tab values
  const html=basePanelInsight();if(state.tab!=='요약')return html; // i18n:keep — tab value
  return html.replace('<div class="memo-tab summary-tab">',()=>insightPanel()+'<div class="memo-tab summary-tab">').replace('<div class="saved" id="saved"',()=>insightResultsPanel()+'<div class="saved" id="saved"');
};
function insightPanel(){
  const key=targetKey(),results=insightState.results.get(key);
  // One load per paper at a time; a failed load shows once and waits for the next visit instead of retrying on every render.
  if(!results&&!insightState.loading?.has(key)){(insightState.loading||=new Set()).add(key);queueMicrotask(()=>runDesktop(loadInsights)());}
  const busy=insightState.busy?.key===key,blocked=recordsUnreadable();
  // In the 요약 tab: the question box and the one-click tools above the sections (their results, the AI
  // 기록, are listed under the sections by insightResultsPanel). 선택 설명 is saved in the 주석 tab.
  return `<section class="insight-panel"><form class="insight-ask note-ai-composer" data-insight-ask><input id="insight-question" maxlength="4000" title="${tr('쪽 번호(예: 3쪽, p. 5)를 적거나 원문 문장을 붙여 넣으면 그 쪽의 본문을 함께 보내 답합니다')}" placeholder="${tr('이 자료(원문)에 질문하기 · 쪽 번호나 원문 문장을 넣어도 됩니다')}" aria-label="${tr('이 자료에 질문')}" ${busy?'disabled':''}><button class="composer-icon composer-send" title="${blocked?tr('이 자료의 AI 기록 파일을 읽을 수 없어 AI 요청을 보내지 않습니다.'):tr('질문 보내기')}" aria-label="${tr('질문')}" ${busy||blocked?'disabled':''}>${icon('composerSend')}</button></form><div class="insight-actions"><button class="secondary small" data-action="ai-summary" ${busy||blocked?'disabled':''}${blocked?` title="${tr('이 자료의 AI 기록 파일을 읽을 수 없어 AI 요청을 보내지 않습니다.')}"`:''}>${tr('구조화 요약')}</button><span class="insight-info"><button type="button" class="insight-info-button" data-insight-info aria-label="${tr('AI 결과 안내')}" aria-expanded="false" aria-describedby="insight-info-tip">${icon('info')}</button><span class="insight-info-tip" id="insight-info-tip" role="tooltip">${INSIGHT_NOTE}</span></span></div>${busy?`<p class="insight-status" role="status">${esc(insightState.busy.message)} <button class="secondary small" data-action="ai-cancel">${tr('취소')}</button></p>`:''}${insightState.error?`<p class="insight-status error" role="alert">${esc(insightState.error)}</p>`:''}</section>`;
}
function insightResultsPanel(){
  const results=insightState.results.get(targetKey());
  return `<section class="insight-results-panel"><div class="memo-head"><span class="small muted">${results?.length?tr('AI 기록 {n}개',{n:results.length}):tr('AI 기록')}</span></div><div class="insight-results">${results?results.map(insightCard).join('')||`<p class="small muted">${tr('아직 AI 결과가 없습니다. 위에서 질문하거나 구조화 요약을 요청하세요.')}</p>`:insightState.unreadable?.has(targetKey())?`<p class="insight-status error" role="alert">${esc(insightState.unreadable.get(targetKey()))}</p>`:`<p class="small muted">${tr('불러오는 중…')}</p>`}</div></section>`;
}
// Like memos: every result shows as its title and one line until it is chosen; the chosen one opens,
// with a corner to change its height and ⤢ to read it large.
function insightTitle(r){const kind=kindLabel(r.kind);return r.kind==='explain'&&r.page?tr('{kind} · {page}쪽',{kind,page:r.page}):kind;}
function insightLine(r){return r.kind==='ask'?'Q. '+(r.question||''):r.kind==='explain'?(r.selection||r.translation||''):(Object.values(r.sections||{}).flat()[0]?.text||'');}
function insightBody(r){
  const cov=r.coverage||{},scope=r.kind==='ask'?(cov.focusPages?.length?(cov.quoted?tr('붙여 넣은 문장이 있는 {pages}쪽 본문 포함',{pages:cov.focusPages.join('·')}):tr('{pages}쪽 본문 포함',{pages:cov.focusPages.join('·')}))+' · ':'')+tr('문단 {n}개 (전체 {total}쪽 중)',{n:cov.blocks||0,total:cov.totalPages||'?'}):r.kind==='explain'?tr('{page}쪽 선택 + 인접 쪽',{page:r.page}):cov.partial?tr('일부만 처리: {done}/{total}쪽 · 전체 요약 아님',{done:cov.pages?.length||0,total:cov.totalPages}):tr('전체 {total}쪽',{n:cov.totalPages,total:cov.totalPages});
  const hash=insightState.hash?.key===targetKey()?insightState.hash.value:null,stale=hash&&r.sourceHash!==hash;
  const sections=Object.entries(r.sections||{}).filter(([,list])=>list.length).map(([key,list])=>`<h4>${esc(sectionLabel(key)||key)}</h4><ul>${list.map(c=>`<li class="${c.unsupported?'unsupported':''}"><span class="basis ${c.basis}">${c.basis==='model'?tr('모델 해석'):tr('원문 진술')}</span> ${esc(c.text)} ${c.evidence.map(e=>`<button class="evidence" data-evidence="${esc(r.id)}|${esc(e.blockId)}" title="${esc(e.quote)}">p.${e.page}</button>`).join('')}${c.unsupported?`<span class="pill amber">${tr('근거 부족')}</span>`:''}</li>`).join('')}</ul>`).join('');
  return `<p class="small muted">${esc(r.model)} · ${esc(scope)}${stale?` · <b>${tr('원문이 바뀌어 위치 확인 필요')}</b>`:''}</p>${r.question?`<p class="insight-q">Q. ${esc(r.question)}</p>`:''}${r.selection?`<blockquote>${esc(r.selection)}</blockquote>`:''}${r.translation?`<p><span class="basis paper">${tr('번역')}</span> ${esc(r.translation)}</p>`:''}${r.insufficient?`<p class="pill amber">${tr('이 자료의 내용으로는 답할 근거가 부족합니다.')}</p>`:''}${sections}${r.rejected?.length?`<p class="small muted">${tr('존재하지 않는 근거 {n}개는 제외했습니다.',{n:r.rejected.length})}</p>`:''}${r.followUps?.length?`<h4>${tr('이어서 물은 질문')}</h4>${r.followUps.map(f=>`<div class="insight-follow md">${renderNote(f.text)}</div>`).join('')}`:''}<footer><button class="secondary small" data-ai-adopt="${esc(r.id)}">${tr('노트로 채택')}${r.adoptions?.length?` (${r.adoptions.length})`:''}</button></footer>`;
}
function insightCard(r){
  const open=r.id===insightState.open,title=insightTitle(r),when=new Date(r.createdAt);
  // The memo cards' order: AI · 넓게 보기 · 새 창 · 휴지통 (a closed card: AI · 넓게 보기 · 휴지통).
  const tools=`<span class="memo-actions">${open?`<button type="button" class="row-more" data-insight-fold title="${tr('접기 (Esc)')}" aria-label="${tr('{name} 접기',{name:esc(title)})}">${icon('memoFold')}</button>`:''}<button type="button" class="row-more memo-ai-button" data-insight-ai="${esc(r.id)}" title="${tr('AI에게 이어서 묻기')}" aria-label="${tr('{name} AI에게 이어서 묻기',{name:esc(title)})}">${icon('memoAi')}</button><button type="button" class="row-more" data-insight-wide="${esc(r.id)}" title="${tr('넓게 보기')}" aria-label="${tr('{name} 넓게 보기',{name:esc(title)})}">${icon('expand')}</button>${open?`<button type="button" class="row-more" data-insight-window="${esc(r.id)}" title="${tr('새 창에서 보기')}" aria-label="${tr('{name} 새 창에서 보기',{name:esc(title)})}">${icon('newWindow')}</button>`:''}<button type="button" class="row-more" data-ai-remove="${esc(r.id)}" title="${tr('삭제')}" aria-label="${tr('{name} 삭제',{name:esc(title)})}">${icon('trash')}</button></span>`;
  const head=`<header class="memo-card-head"><strong>${esc(title)}</strong><small class="muted" title="${esc(when.toLocaleString(appI18n.uiLocale()))}">${esc(when.toLocaleDateString(appI18n.uiLocale()))}</small>${tools}</header>`;
  if(open){const h=insightState.heights.get(r.id);return `<article class="insight-card open" data-insight="${esc(r.id)}" tabindex="-1">${head}<div class="note-box resize-only insight-box"><div class="insight-body"${h?` style="height:${h}px;max-height:none"`:''}>${insightBody(r)}</div><button type="button" class="note-grip" data-insight-grip="${esc(r.id)}" data-resize-only title="${tr('끌어서 높이 조절')}" aria-label="${tr('{name} 높이 조절',{name:esc(title)})}">${icon('resize')}</button></div></article>`;}
  const line=insightLine(r);
  return `<article class="insight-card" data-insight="${esc(r.id)}" tabindex="0" role="button" aria-label="${tr('{name} 열기',{name:esc(title)})}">${head}<div class="memo-glance"><div class="memo-line">${line?esc(line):`<span class="muted">${tr('비어 있음')}</span>`}</div></div></article>`;
}
function refreshInsightPanel(){const node=document.querySelector('.insight-panel');if(node)node.outerHTML=insightPanel();const list=document.querySelector('.insight-results-panel');if(list)list.outerHTML=insightResultsPanel();}
// An AI 선택 설명 belongs to the sentence it explains, so it is kept as an annotation (주석 tab), with the
// selection as its quote and the explanation (claims and their cited pages) as Markdown.
// Written in the language of the result itself (Korean before results recorded one), not the setting now: an older
// Korean result added after the AI language changed keeps a Korean head over its Korean text.
const resultLanguage=r=>r?.language||'ko';
function explainMarkdown(r){
  const say=(name,values)=>memoLabels().memoLabel(name,resultLanguage(r),values);
  const claims=(r.sections?.explanation||[]).map(c=>`- ${c.basis==='model'?say('modelReading')+' ':''}${c.text}${c.evidence?.length?' '+c.evidence.map(e=>`(p.${e.page})`).join(' '):''}${c.unsupported?say('noEvidenceSuffix'):''}`).join('\n');
  return [r.translation?`${say('translationBold')}${r.translation}`:'',claims].filter(Boolean).join('\n\n')||say('noExplanation');
}
async function explainToAnnotation(vault,paperId,attachmentId,r){
  const snapshot=await window.appApi.addAnnotation(vault,paperId,attachmentId,{page:Number(r.page)||1,quote:String(r.selection||'').slice(0,10000),body:explainMarkdown(r).slice(0,20000),sourceHash:r.sourceHash,kind:'explain',model:r.model,...(r.createdAt?{createdAt:r.createdAt}:{})});
  await window.appApi.aiRemove(vault,paperId,attachmentId,r.id).catch(()=>{});return snapshot;
}
// Earlier 선택 설명 results move to the 주석 tab when their file is unchanged; the others stay in the list.
async function moveExplainResults(list){
  const vault=state.storageKey,paperId=state.selected,attachmentId=state.selectedAttachment,keep=[];let snapshot=null,moved=0;
  for(const r of list){if(r.kind!=='explain'){keep.push(r);continue;}try{snapshot=await explainToAnnotation(vault,paperId,attachmentId,r);moved++;}catch{keep.push(r);}}
  if(snapshot&&state.storageKey===vault&&state.selected===paperId){applyAnnotations(snapshot);toast(tr('AI 선택 설명 {n}개를 주석 탭으로 옮겼습니다.',{n:moved}));}
  return keep;
}
// An AI records file that cannot be read (left by git with conflict marks neither side of which reads) is said in the AI
// records' place instead of a notice; the rest of the 요약 tab works as before.
async function loadInsights(){const key=targetKey();try{let list;try{list=await window.appApi.aiList(state.storageKey,state.selected,state.selectedAttachment);}catch(error){if(errorCode(error)!=='APP_AI_RECORDS_UNREADABLE')throw error;(insightState.unreadable||=new Map()).set(key,plainError(error));if(key===targetKey())refreshInsightPanel();return;}insightState.unreadable?.delete(key);if(key!==targetKey())return;if(list.some(r=>r.kind==='explain'))list=await moveExplainResults(list);if(key!==targetKey())return;insightState.results.set(key,list);refreshInsightPanel();}finally{setTimeout(()=>insightState.loading?.delete(key),key===targetKey()&&!insightState.results.has(key)?30000:0);}}
// Paragraph blocks with stable IDs and page coordinates, read once per version.
async function insightBlocks(){
  const key=targetKey(),cached=insightState.blocks.get(key);
  const engine=await pdfEngine(),{pdf,hash}=await engine.documentFor(state.storageKey,state.selected,false,state.selectedAttachment);
  insightState.hash={key,value:hash};
  if(cached?.hash===hash)return cached;
  const structured=await engine.structuredPages(pdf,hash,(done,total)=>{insightState.busy={key,message:tr('문서 구조를 읽는 중 {done}/{total}쪽',{done:Math.min(done+1,total),total})};refreshInsightPanel();});
  const blocks=structured.flatMap((page,i)=>page.blocks.map(b=>({id:b.id,page:i+1,text:b.text,section:b.sectionTitle||'',x:b.x,y:b.y,width:b.width,height:b.height,pageWidth:page.width,pageHeight:page.height})));
  const value={hash,blocks,pages:pdf.numPages};insightState.blocks.set(key,value);return value;
}
// While this paper's AI records cannot be read, nothing is sent: the answer could not be kept and the use would be spent.
const recordsUnreadable=()=>insightState.unreadable?.has(targetKey());
async function insightConfirm(kind,extra={}){
  if(['summary','explain','ask'].includes(kind)&&recordsUnreadable()){toast(tr('이 자료의 AI 기록 파일을 읽을 수 없어 AI 요청을 보내지 않습니다.'));return;}
  const groups=await readyModelGroups({onRefresh:()=>refreshModelChoice('ai-model')});if(!groups)return;
  const key=targetKey();insightState.error='';
  let source;try{source=await insightBlocks();}finally{insightState.busy=null;refreshInsightPanel();}
  if(key!==targetKey())return;
  const chars=source.blocks.reduce((n,b)=>n+b.text.length,0);
  const scope=kind==='summary'?`${tr('이 자료 본문 {pages}쪽 (약 {chars}자)',{pages:source.pages,n:source.pages,chars:chars.toLocaleString(appI18n.uiLocale())})}<span data-budget-summary="${chars}"></span>`:kind==='explain'?tr('선택한 {chars}자와 {page}쪽 앞뒤 문단',{n:extra.selection.length,chars:extra.selection.length.toLocaleString(appI18n.uiLocale()),page:extra.page}):tr('질문과, 이 자료에서 관련된 문단 최대 12개 (질문어가 드물면 먼저 원문 언어의 검색어를 모델에 묻습니다). 질문에 쪽 번호가 있으면 그 쪽의 본문을, 원문 문장을 붙여 넣었으면 그 문장이 있는 쪽과 앞뒤 쪽의 본문');
  insightState.pending={key,kind,extra,source};
  modal(kindLabel(kind),`<p>${tr('{scope}을 보냅니다.',{scope:kind==='summary'?scope:esc(scope)})}</p>${kind==='explain'?`<blockquote>${esc(extra.selection.slice(0,400))}</blockquote>`:''}${kind==='ask'?`<p>Q. ${esc(extra.question)}</p>`:''}${modelField('ai-model',groups,preferredChoice(groups))}<p class="small muted">${tr('답변은 보낸 문단의 ID로만 근거를 달 수 있고, 앱이 각 근거를 확인합니다. 자동으로 다른 서비스로 바꾸지 않습니다.')}</p>`,btn(tr('취소'),'close')+btn(tr('보내기'),'ai-send','primary'));showModelNotice('ai-model');
}
async function insightSend(){
  const pending=insightState.pending,choice=chosenModel('ai-model'),model=choice?.model;if(!pending||!model)return;rememberChoice(choice);
  dialog.close();insightState.pending=null;insightState.busy={key:pending.key,message:tr('{kind} 요청 중…',{kind:kindLabel(pending.kind)})};insightState.error='';refreshInsightPanel();
  try{
    const vault=state.storageKey,paperId=state.selected,attachmentId=state.selectedAttachment;
    const result=await window.appApi.aiRun(vault,paperId,attachmentId,pending.kind,model,{sourceHash:pending.source.hash,blocks:pending.source.blocks,...pending.extra,connection:choice.connection});
    if(result.kind==='explain'){const snapshot=await explainToAnnotation(vault,paperId,attachmentId,result);if(state.storageKey===vault&&state.selected===paperId){insightState.busy=null;applyAnnotations(snapshot,'주석');const added=itemAnnotations.filter(a=>a.kind==='explain'&&a.paperId===paperId).sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)))[0];if(added)globalThis.appShowAnnotation?.(added.id);toast(tr('AI 선택 설명을 주석 탭에 추가했습니다.'));}return;} // i18n:keep — tab value
    const list=insightState.results.get(pending.key)||[];list.unshift(result);insightState.results.set(pending.key,list);insightState.open=result.id;
  }catch(error){insightState.error=plainError(error);}
  finally{insightState.busy=null;refreshInsightPanel();}
}
// Evidence opens the original at the cited paragraph and outlines it briefly.
function showEvidence(resultId,blockId){
  const r=insightState.results.get(targetKey())?.find(x=>x.id===resultId),e=r&&Object.values(r.sections).flat().flatMap(c=>c.evidence).find(x=>x.blockId===blockId);if(!e)return;
  const container=document.querySelector('.original-pages'),viewer=container?.pdfViewer;if(!viewer){toast(tr('원문 화면에서 근거를 확인하세요.'));return;}
  if(insightState.hash?.value&&r.sourceHash!==insightState.hash.value)toast(tr('원문이 바뀌어 위치가 다를 수 있습니다.'));
  viewer.currentPageNumber=e.page;
  if(!e.rect)return;
  // PDF.js clears a page's extra layers when it renders it, so mark after that.
  const place=()=>{
    const view=viewer.getPageView(e.page-1);if(!view)return;view.div.querySelector('.ai-evidence')?.remove();
    const scale=view.viewport.width/e.rect.pageWidth,mark=document.createElement('div');mark.className='ai-evidence';mark.style.cssText=`left:${e.rect.x*scale}px;top:${e.rect.y*scale}px;width:${e.rect.width*scale}px;height:${e.rect.height*scale}px`;view.div.append(mark);
    container.scrollTop+=mark.getBoundingClientRect().top-container.getBoundingClientRect().top-60;setTimeout(()=>mark.remove(),4000);
  };
  const view=viewer.getPageView(e.page-1);
  if(view?.renderingState===3)place();
  else{const once=event=>{if(event.detail.index!==e.page-1)return;container.removeEventListener('app-pagerendered',once);place();};container.addEventListener('app-pagerendered',once);setTimeout(()=>container.removeEventListener('app-pagerendered',once),5000);}
}
// Adopting appends to the user's notes with page markers; nothing is replaced.
async function adoptInsight(id){
  const r=insightState.results.get(targetKey())?.find(x=>x.id===id);if(!r)return;
  const language=resultLanguage(r),say=(name,values)=>memoLabels().memoLabel(name,language,values);
  const line=c=>`• ${c.text}${c.evidence.length?' ['+[...new Set(c.evidence.map(e=>'p.'+e.page))].join(', ')+']':''}${c.basis==='model'?' '+say('modelReading'):''}${c.unsupported?' '+say('noEvidence'):''}`;
  const tag=`[${say('resultHead',{kind:r.kind,model:r.model,date:memoLabels().memoDate(r.createdAt,language)})}]`;const added=[];
  const append=(noteKey,text)=>{if(!text)return;setNote(noteKey,(notes[noteKey]?notes[noteKey]+'\n\n':'')+text);added.push(text);};
  if(r.kind==='summary'){['question','method','result','limitation'].forEach((k,i)=>append(`${state.selected}-summary-${i}`,r.sections[k]?.length?tag+'\n'+r.sections[k].map(line).join('\n'):''));append(`${state.selected}-메모`,r.sections.contribution?.length?tag+say('contribution')+'\n'+r.sections.contribution.map(line).join('\n'):'');} // i18n:keep — stored memo key
  // A selection explanation becomes a memo of its own, linked back to its page.
  else if(r.kind==='explain'){const text=[`[${say('explainHead',{file:noteHeadName(activeAttachment()?.name),page:r.page||1,model:r.model})}]`,r.selection&&'> '+r.selection.replace(/\n/g,'\n> '),r.translation&&say('translationLine')+r.translation,...Object.values(r.sections).flat().map(line),r.insufficient&&say('noEvidence')].filter(Boolean).join('\n');newMemo(text,say('explainTitle',{page:r.page||1}));added.push(text);}
  else append(`${state.selected}-메모`,[tag,r.question&&'Q. '+r.question,r.selection&&'> '+r.selection,r.translation&&say('translationLine')+r.translation,...Object.values(r.sections).flat().map(line),r.insufficient&&say('noEvidence')].filter(Boolean).join('\n')); // i18n:keep — stored memo key
  await desktopNotes();const updated=await window.appApi.aiAdopt(state.storageKey,state.selected,state.selectedAttachment,id,added.join('\n\n'));
  const list=insightState.results.get(targetKey());list[list.findIndex(x=>x.id===id)]=updated;refreshInsightPanel();toast(r.kind==='summary'?tr('요약 탭의 각 항목 뒤에 추가했습니다.'):r.kind==='explain'?tr('선택 설명을 새 메모로 추가했습니다.'):tr('메모 끝에 추가했습니다.'));
}
Object.assign(actions,{
  'ai-summary':runDesktop(()=>insightConfirm('summary')),
  'ai-send':runDesktop(insightSend),
  'ai-cancel':runDesktop(()=>window.appApi.aiCancel())
});
document.addEventListener('submit',event=>{if(!event.target.matches('[data-insight-ask]'))return;event.preventDefault();const question=document.querySelector('#insight-question').value.trim();if(question)runDesktop(()=>insightConfirm('ask',{question}))();});
// ⓘ: the note shows on hover or focus; a click keeps it open until the next click elsewhere.
dialog.addEventListener('close',()=>{if(!dialog.open)dialog.classList.remove('insight-wide-dialog');}); // a late close (queued) leaves a dialog open again as it is
// A result read large (the dialog) or in a window of its own: the AI panel asks about it like a memo's
// 질문하기 (the result and its earlier follow-ups go along as context), and an answer taken is kept
// under the result. Each view knows the vault, paper and file it was opened for.
const insightWhere=()=>({vault:state.storageKey,paperId:state.selected,attachmentId:state.selectedAttachment,key:targetKey()});
const insightFind=(where,id)=>insightState.results.get(where.key)?.find(x=>x.id===id)||null;
const insightHere=where=>where.vault===state.storageKey&&where.key===targetKey();
// The result as text for the model: its question or passage, its claims, and what was asked after.
function insightText(r){return [r.question&&'Q. '+r.question,r.selection&&'선택: '+r.selection,r.translation&&'번역: '+r.translation,...Object.entries(r.sections||{}).flatMap(([k,list])=>list.map(c=>`${insightSections[k]||k}: ${c.text}`)),...(r.followUps||[]).map(f=>f.text)].filter(Boolean).join('\n');} // i18n:keep — the text sent to the AI as this result (labels unchanged)
const insightWideInner=r=>`<p class="small muted">${esc(new Date(r.createdAt).toLocaleString(appI18n.uiLocale()))}</p>${insightBody(r)}`;
function insightViewHtml(r,inWindow=false){return `<div class="insight-view"><div class="md-toolbar insight-view-tools" role="toolbar" aria-label="${tr('AI 결과')}"><button type="button" class="md-tool md-ai" data-editor-ai title="${tr('AI에게 이어서 묻기')}" aria-label="${tr('AI에게 이어서 묻기')}" aria-expanded="false">${icon('memoAi')}</button>${inWindow?'':`<button type="button" class="md-tool" data-insight-window="${esc(r.id)}" title="${tr('새 창에서 보기')}" aria-label="${tr('새 창에서 보기')}">${icon('newWindow')}</button>`}</div><div class="note-ai" hidden></div><div class="insight-wide" data-insight="${esc(r.id)}">${insightWideInner(r)}</div></div>`;}
let insightView=null;const insightWindows=new Set();
function insightMountAi(root,where,r,win){
  const ed={key:null,root,doc:root.ownerDocument,win,ai:null,inWindow:win!==window};
  ed.aiTarget={what:tr('이 결과'),text:()=>insightText(insightFind(where,r.id)||r),paperId:where.paperId,section:insightTitle(r),context:'ai-result',edit:false,addLabel:tr('결과에 추가'),take:text=>insightFollowUp(where,r.id,text,editorAiChoice(ed)?.model)};
  bindEditorAi(ed,{click:true});root.addEventListener('click',event=>{if(event.target.closest('[data-editor-ai]'))editorAiToggle(ed,null);});
  return ed;
}
function insightWide(id,{ai=false}={}){
  const where=insightWhere(),r=insightFind(where,id);if(!r)return;
  modal(esc(insightTitle(r)),insightViewHtml(r),btn(tr('닫기'),'close','primary'));dialog.classList.add('insight-wide-dialog');
  const root=dialog.querySelector('.insight-view'),ed=insightMountAi(root,where,r,window);insightView={ed,where,id,root};
  if(ai)editorAiToggle(ed,null);
}
dialog.addEventListener('close',()=>{if(insightView){editorAiClose(insightView.ed);insightView=null;}});
function openInsightWindow(id){
  const where=insightWhere(),r=insightFind(where,id);if(!r)return;if(dialog.open&&insightView?.id===id)dialog.close();
  openViewWindow(viewWindowName('insight',where.vault,where.key,id),`AI · ${insightTitle(r)}`,(child,main)=>{
    main.classList.add('note-window','insight-window');main.innerHTML=insightViewHtml(r,true);
    const root=main.querySelector('.insight-view'),ed=insightMountAi(root,where,r,child),view={ed,where,id,root};insightWindows.add(view);
    // Its evidence and 노트로 채택 act in the app (the app's own handlers do not hear this window).
    root.addEventListener('click',event=>{
      const evidence=event.target.closest('[data-evidence]'),adopt=event.target.closest('[data-ai-adopt]');if(!evidence&&!adopt)return;
      if(!insightHere(where)){toast(tr('이 결과의 자료를 다시 열어야 합니다.'));return;}
      if(evidence){const [rid,block]=evidence.dataset.evidence.split('|');window.focus();showEvidence(rid,block);}else runDesktop(()=>adoptInsight(adopt.dataset.aiAdopt))();
    });
    child.addEventListener('pagehide',()=>{editorAiClose(ed);insightWindows.delete(view);});
  });
}
// A follow-up taken from the AI panel: saved under the result, shown in the tab and in every open view of it.
async function insightFollowUp(where,id,text,model){
  if(where.vault!==state.storageKey){toast(tr('저장소가 바뀌어 이 결과에 추가할 수 없습니다.'));return false;}
  const updated=await window.appApi.aiFollowUp(where.vault,where.paperId,where.attachmentId,id,{text,model:model||''});
  const list=insightState.results.get(where.key),i=list?list.findIndex(x=>x.id===id):-1;if(i>=0)list[i]=updated;
  refreshInsightPanel();for(const v of [insightView,...insightWindows])if(v&&v.id===id&&v.where.key===where.key){const body=v.root.querySelector('.insight-wide');if(body)body.innerHTML=insightWideInner(updated);}
  toast(tr('결과 아래에 추가했습니다.'));return true;
}

document.addEventListener('click',event=>{
  const info=event.target.closest('[data-insight-info]');
  document.querySelectorAll('.insight-info.open').forEach(node=>{if(!info||!node.contains(info)){node.classList.remove('open');node.querySelector('[data-insight-info]')?.setAttribute('aria-expanded','false');}});
  if(info){const box=info.closest('.insight-info'),on=!box.classList.contains('open');box.classList.toggle('open',on);info.setAttribute('aria-expanded',String(on));return;}
  const wide=event.target.closest('[data-insight-wide]');if(wide){event.stopPropagation();insightWide(wide.dataset.insightWide);return;}
  const ai=event.target.closest('[data-insight-ai]');if(ai){event.stopPropagation();insightWide(ai.dataset.insightAi,{ai:true});return;}
  const win=event.target.closest('[data-insight-window]');if(win){event.stopPropagation();openInsightWindow(win.dataset.insightWindow);return;}
  const card=event.target.closest('.insight-results-panel .insight-card');
  if(card){
    if(event.target.closest('[data-insight-fold]')||card.classList.contains('open')&&(event.target===card||event.target.classList.contains('memo-card-head'))){insightState.open=null;refreshInsightPanel();return;}
    if(!card.classList.contains('open')&&!event.target.closest('button,a,input')){insightState.open=card.dataset.insight;refreshInsightPanel();document.querySelector('.insight-card.open')?.focus?.();return;}
  }
  const evidence=event.target.closest('[data-evidence]');if(evidence){if(evidence.closest('dialog'))dialog.close();const [id,block]=evidence.dataset.evidence.split('|');showEvidence(id,block);}
  const adopt=event.target.closest('[data-ai-adopt]');if(adopt)runDesktop(()=>adoptInsight(adopt.dataset.aiAdopt))();
  const remove=event.target.closest('[data-ai-remove]');if(remove)runDesktop(async()=>{await window.appApi.aiRemove(state.storageKey,state.selected,state.selectedAttachment,remove.dataset.aiRemove);const list=insightState.results.get(targetKey())||[];insightState.results.set(targetKey(),list.filter(r=>r.id!==remove.dataset.aiRemove));refreshInsightPanel();})();
});

document.addEventListener('keydown',event=>{
  const card=event.target.closest?.('.insight-results-panel .insight-card');if(!card)return;
  if(!card.classList.contains('open')&&event.target===card&&(event.key==='Enter'||event.key===' ')){event.preventDefault();card.click();}
  else if(card.classList.contains('open')&&event.key==='Escape'&&!dialog.open){event.preventDefault();insightState.open=null;refreshInsightPanel();}
});
// The open result's corner: drag to change the height (kept while the app runs).
document.addEventListener('pointerdown',event=>{
  const grip=event.target.closest('[data-insight-grip]');if(!grip||event.button!==0)return;event.preventDefault();
  const body=grip.closest('.insight-box').querySelector('.insight-body'),startY=event.clientY,startH=body.offsetHeight;grip.setPointerCapture(event.pointerId);
  const move=e=>{const h=Math.max(80,Math.round(startH+e.clientY-startY));body.style.height=h+'px';body.style.maxHeight='none';insightState.heights.set(grip.dataset.insightGrip,h);};
  const up=()=>{grip.removeEventListener('pointermove',move);grip.removeEventListener('pointerup',up);grip.removeEventListener('pointercancel',up);};
  grip.addEventListener('pointermove',move);grip.addEventListener('pointerup',up);grip.addEventListener('pointercancel',up);
});

// ---- Several papers side by side (selected in the library) ----
const baseBatchBar=batchBar;
batchBar=function(){return baseBatchBar().replace('<!--batch-ai-->',`<span class="batch-group" role="group" aria-label="AI"><button class="secondary small" data-action="ai-compare">${tr('AI 비교')}</button></span><!--batch-ai-->`);};
let comparePending=null,lastComparison=null;
async function blocksFor(paperId){
  const paper=papers.find(p=>p.id===paperId),attachment=paper?.attachments.find(a=>a.id===paper.primaryAttachmentId&&a.file)||paper?.attachments.find(a=>a.file&&a.role!=='translated');
  if(!attachment)return null;
  const engine=await pdfEngine(),{pdf,hash}=await engine.documentFor(state.storageKey,paperId,false,attachment.id),structured=await engine.structuredPages(pdf,hash);
  return {paperId,attachmentId:attachment.id,sourceHash:hash,title:paper.title,blocks:structured.flatMap((page,i)=>page.blocks.map(b=>({id:b.id,page:i+1,text:b.text,section:b.sectionTitle||'',x:b.x,y:b.y,width:b.width,height:b.height,pageWidth:page.width,pageHeight:page.height})))};
}
async function compareConfirm(){
  const ids=[...batchSelection].filter(id=>papers.some(p=>p.id===id));
  if(ids.length<2||ids.length>5){toast(tr('비교할 자료를 2~5개 선택하세요.'));return;}
  const groups=await readyModelGroups({onRefresh:()=>refreshModelChoice('ai-model')});if(!groups)return;
  toast(tr('선택한 자료의 본문을 읽는 중입니다.'));const items=[];
  for(const id of ids){const item=await blocksFor(id);if(!item){toast(tr('“{title}”에 PDF가 없어 비교할 수 없습니다.',{title:papers.find(p=>p.id===id)?.title}));return;}items.push(item);}
  comparePending=items;const chars=items.map(i=>i.blocks.reduce((n,b)=>n+b.text.length,0));
  modal(tr('자료 비교'),`<p>${items.map((item,i)=>tr('{title} ({chars}자)',{title:esc(item.title),n:chars[i],chars:chars[i].toLocaleString(appI18n.uiLocale())})).join('<br>')}</p><p class="small muted">${tr('자료마다 최대 {budget}자까지 앞부분부터 보냅니다. 넘는 자료는 결과에 “일부만 처리”로 표시합니다. 각 칸은 자기 자료의 문단만 근거로 달 수 있습니다.',{budget:`<span data-budget-compare="${items.length}"></span>`})}</p><label for="compare-question">${tr('비교 관점 (선택)')}</label><input id="compare-question" maxlength="1000" placeholder="${tr('예: 실험 설계와 표본 크기')}">${modelField('ai-model',groups,preferredChoice(groups))}`,btn(tr('취소'),'close')+btn(tr('보내기'),'ai-compare-send','primary'));showModelNotice('ai-model');
}
function compareTable(r){
  return `<p class="small muted">${esc(r.model)} · ${esc(new Date(r.createdAt).toLocaleString(appI18n.uiLocale()))}${r.question?` · ${tr('관점: {question}',{question:esc(r.question)})}`:''}</p><div class="compare-scroll"><table class="compare-table"><thead><tr><th></th>${r.papers.map(p=>`<th>${esc(p.title)}${p.coverage.partial?`<br><small class="pill amber">${tr('일부만 처리: {done}/{total}쪽',{done:p.coverage.pages.length,total:p.coverage.totalPages})}</small>`:''}</th>`).join('')}</tr></thead><tbody>${r.rows.map(row=>`<tr><th>${esc(row.aspect)}</th>${row.cells.map(c=>`<td class="${c.unsupported?'unsupported':''}">${c.text?`<span class="basis ${c.basis}">${c.basis==='model'?tr('모델 해석'):tr('원문 진술')}</span> ${esc(c.text)} ${c.evidence.map(e=>`<button class="evidence" data-compare-paper="${c.paperId}" data-compare-page="${e.page}" title="${esc(e.quote)}">p.${e.page}</button>`).join('')}`:'—'}${c.unsupported&&c.text?` <span class="pill amber">${tr('근거 부족')}</span>`:''}</td>`).join('')}</tr>`).join('')}</tbody></table></div>${r.rejected?.length?`<p class="small muted">${tr('다른 자료나 없는 문단을 가리킨 근거 {n}개는 제외했습니다.',{n:r.rejected.length})}</p>`:''}`;
}
Object.assign(actions,{
  'ai-compare':runDesktop(compareConfirm),
  'ai-compare-send':runDesktop(async()=>{const items=comparePending,choice=chosenModel('ai-model'),model=choice?.model,question=document.querySelector('#compare-question')?.value||'';if(!items||!model)return;rememberChoice(choice);comparePending=null;dialog.close();toast(tr('자료를 비교하는 중입니다.'));
    lastComparison=await window.appApi.aiCompare(state.storageKey,model,items,question,choice.connection);modal(tr('자료 비교 결과'),compareTable(lastComparison),btn(tr('메모에 추가'),'compare-adopt')+btn(tr('닫기'),'close','primary'));dialog.classList.add('compare-dialog');}),
  // Adopting writes the table, with pages, into each compared paper's memo.
  'compare-adopt':runDesktop(async()=>{const r=lastComparison;if(!r)return;for(const [i,p] of r.papers.entries()){const lines=r.rows.map(row=>{const c=row.cells[i];return c.text?`• ${row.aspect}: ${c.text}${c.evidence.length?' ['+[...new Set(c.evidence.map(e=>'p.'+e.page))].join(', ')+']':''}`:'';}).filter(Boolean);const others=r.papers.filter((_,j)=>j!==i).map(o=>o.title).join(', ');const key=`${p.paperId}-메모`;notes[key]=(notes[key]?notes[key]+'\n\n':'')+`[${memoLabels().memoLabel('compareHead',resultLanguage(r),{model:r.model,others})}]\n`+lines.join('\n');}await desktopNotes();dialog.close();toast(tr('비교 결과를 각 자료의 메모 끝에 추가했습니다.'));}) // i18n:keep — stored memo key
});
document.addEventListener('click',event=>{const chip=event.target.closest('[data-compare-paper]');if(!chip)return;const paperId=Number(chip.dataset.comparePaper),page=Number(chip.dataset.comparePage);dialog.close();runDesktop(async()=>{await openItemFile(paperId);const container=document.querySelector('.original-pages');if(container)container.restorePage=page;})();});
