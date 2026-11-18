const fs = require('node:fs/promises');
const path = require('node:path');
const {tr}=require('../core/i18n.js');
const {repairPages,applyFlow,structureTranslationPages,formulaLike,layoutBlocks}=require('../core/pdf-layout.js');
const {reviewTranslation}=require('../core/translation-quality.cjs');
const crypto = require('node:crypto');
const { atomicJson, readJson, translationFileName } = require('./storage.cjs');
const { VAULT_DIR } = require('./legacy.cjs');
// The parts of a translation that do not depend on where it runs (core/translation-core.cjs).
const {TARGET,referenceImages,MISSING_REASONS,replyError,invalidKind,checkResult,checkReply,restoreUnit,checkCachedMath,pageChunks:corePageChunks,validatePages,applyLayoutPlan,exportHtml}=require('../core/translation-core.cjs');
async function source(library, paperId, attachmentId) {
  const file = await library.resolveFile(paperId,attachmentId?'attachment-'+attachmentId:'original'), bytes = await fs.readFile(file);
  return { bytes, hash: crypto.createHash('sha256').update(bytes).digest('hex') };
}
// Only the hash, from the library's size/mtime-keyed cache when it has one.
async function sourceHash(library, paperId, attachmentId) {
  const file = await library.resolveFile(paperId,attachmentId?'attachment-'+attachmentId:'original');
  return library.hashFile ? library.hashFile(file) : crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex');
}
const {PROMPT_VERSION,USER_RULES_NOTE,REFERENCE_IMAGES_NOTE,PAGE_IMAGE_NOTE}=require('../core/translation-policy.cjs');
const {DEFAULT_CONNECTION,connectionOf,notConnected}=require('./llm.cjs');
// ChatGPT keys carry no connection, so caches written before connections existed still match.
const pageChunks=(page,context,model,hash,connection=DEFAULT_CONNECTION)=>corePageChunks(page,context,model,hash,connection===DEFAULT_CONNECTION?undefined:connection);
function pause(ms, signal) {
  return new Promise((resolve,reject)=>{signal.throwIfAborted();const abort=()=>{clearTimeout(timer);reject(signal.reason)};const timer=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve()},ms);signal.addEventListener('abort',abort,{once:true});});
}
class TranslationJobs {
  // clients: one client (kept as this.auth), or connection id => client.
  constructor(clients, commit = fn => fn()) { if(typeof clients==='function')this.clientFor=clients;else{this.auth=clients;this.clientFor=()=>this.auth;}this.writes=Promise.resolve();this.commit=fn=>{const task=this.writes.then(()=>commit(fn));this.writes=task.catch(()=>{});return task;};this.jobs=new Map(); }
  file(library,paperId,attachmentId){const name=translationFileName(paperId,library.attachment(paperId,attachmentId),TARGET.code);if(!name)throw Error(tr('번역 캐시 식별자가 올바르지 않습니다.'));return path.join(library.root,VAULT_DIR,name);}
  // The resume checkpoint holds every finished chunk, so writing it after each
  // chunk grew with the square of the paper. Writes are now merged: at most
  // one queued at a time and one a second, each with everything finished so
  // far; the final write below always records the end state.
  // A job stops after 30 minutes without a finished chunk (a stalled
  // connection), not 30 minutes after it started: long papers take longer.
  armIdle(job){clearTimeout(job.timer);job.timer=setTimeout(()=>this.cancel(job.id),30*60*1000);job.timer.unref?.();}
  saveCheckpoint(job,signal){
    if(job.checkpointQueued)return;
    const wait=Math.max(0,1000-(Date.now()-(job.checkpointAt||0)));
    job.checkpointQueued=new Promise(resolve=>setTimeout(resolve,wait)).then(()=>this.commit(async()=>{job.checkpointQueued=null;if(signal.aborted||job.checkpointDone)return;job.checkpointAt=Date.now();await atomicJson(this.file(job.library,job.paperId,job.attachmentId).replace('.json','.chunks.json'),this.checkpoint(job));})).catch(()=>{job.checkpointQueued=null;});
  }
  async resume(library,paperId,attachmentId){const checkpoint=await readJson(this.file(library,paperId,attachmentId).replace('.json','.chunks.json'),null),pending=checkpoint?.pending;if(!pending||pending.sourceHash!==await sourceHash(library,paperId,attachmentId))return null;return pending;}
  async cached(library,paperId,attachmentId){const record=await readJson(this.file(library,paperId,attachmentId),null);return record?.version===1&&record.sourceHash===await sourceHash(library,paperId,attachmentId)?{...record,resume:await this.resume(library,paperId,attachmentId)}:null;}
  checkpoint(job,complete=false){return {version:1,entries:job.cache,pending:complete?null:{sourceHash:job.hash,connection:job.connection,model:job.model,pageNumbers:[...job.targets],totalPages:job.totalPages}};}

  public(job){return {id:job.id,libraryId:job.libraryId,paperId:job.paperId,attachmentId:job.attachmentId,state:job.state,done:job.done,total:job.total,readyPages:job.readyPages,receivedPages:job.received.size,totalPages:job.totalPages,message:job.message,revision:job.revision,connection:job.connection,model:job.model,pageNumbers:[...job.targets],metrics:{...job.metrics,invalid:{...job.metrics.invalid}}};}
  result(id,revision=-1){
    const job=this.jobs.get(id);if(!job)throw Error(tr('번역 작업을 찾을 수 없습니다.'));
    const full=!Number.isInteger(revision)||revision<0||revision>job.revision;
    const record=revision===job.revision?null:{version:1,sourceHash:job.hash,connection:job.connection,model:job.model,partial:job.state!=='completed',...(full?{pages:job.output}:{updates:[...job.pageRevisions].filter(([,changed])=>changed>revision).map(([index])=>({index,page:job.output[index]}))})};
    return {...this.public(job),record};
  }

  async start(library,paperId,hash,pages,model,options={}) {
    const attachmentId=library.attachment(paperId,options.attachmentId).id;
    const active=[...this.jobs.values()].find(j=>j.state==='running');
    if(active){if(active.libraryId===library.data.id&&active.paperId===paperId&&active.attachmentId===attachmentId)return this.public(active);throw Error(tr('진행 중인 번역을 완료하거나 중단한 뒤 시작하세요.'));}
    const connection=options.connection||DEFAULT_CONNECTION,client=this.clientFor(connection);
    if(!client.status().usable)throw notConnected(client);
    // The PDF is read and hashed in full (never from a cache) while the model is checked.
    const models=client.models(),original=source(library,paperId,attachmentId);original.catch(()=>{});
    if(!(await models).some(m=>m.id===model))throw Error(tr('연결된 계정에서 사용할 수 있는 모델을 선택하세요.'));
    if((await original).hash!==hash)throw Error(tr('원문 PDF가 변경됐습니다. 다시 열어 주세요.'));
    const incremental=options.incremental===true,totalPages=incremental?options.totalPages:pages.length;
    if(!Number.isInteger(totalPages)||totalPages<1||totalPages>500)throw Error(tr('1~500페이지 PDF만 번역할 수 있습니다.'));
    const targets=options.pageNumbers||Array.from({length:totalPages},(_,i)=>i+1);
    if(!Array.isArray(targets)||!targets.length||new Set(targets).size!==targets.length||targets.some(n=>!Number.isInteger(n)||n<1||n>totalPages))throw Error(tr('번역할 페이지를 확인하세요.'));
    const previous=await this.cached(library,paperId,attachmentId);
    // A page re-translation may use another connection or model: each page
    // records which one translated it, and the other pages stay as they were.
    if(targets.length!==totalPages&&(!previous||previous.pages.length!==totalPages))throw Error(tr('페이지 재번역은 기존 번역이 있을 때만 쓸 수 있습니다. 먼저 전체를 번역하세요.'));
    const kept=page=>page&&!page.translatedBy?{...page,translatedBy:{connection:connectionOf(previous),model:previous.model}}:page;
    const checkpoint=await readJson(this.file(library,paperId,attachmentId).replace('.json','.chunks.json'),{version:1,entries:{}});
    // The vault's translation requests (from storage, not from the page), as user preferences.
    const rules=typeof options.rules==='string'?options.rules.trim().slice(0,4200):''; // the vault's requests and this translation's own
    const images=referenceImages(options.images); // this translation's reference images (never saved)
    const job={id:crypto.randomUUID(),libraryId:library.data.id,paperId,attachmentId,rules,images,imageHashes:images.map(v=>crypto.createHash('sha256').update(v).digest('hex')),state:'running',done:0,total:0,readyPages:0,totalPages,received:new Set(),targets:new Set(targets),blockIds:new Set(),textLength:0,revision:0,pageRevisions:new Map(),output:Array.from({length:totalPages},(_,i)=>targets.includes(i+1)?null:kept(previous.pages[i])),message:tr('PDF 페이지를 분석합니다.'),controller:new AbortController(),library,hash,connection,client,model,force:options.force!==false,queue:[],active:0,concurrency:client.concurrency||6,sealed:false,failed:[],cache:checkpoint?.version===1&&checkpoint.entries&&typeof checkpoint.entries==='object'&&!Array.isArray(checkpoint.entries)?checkpoint.entries:{},metrics:{startedAt:Date.now(),firstPageMs:null,totalMs:null,cacheHits:0,requests:0,retries:0,invalid:{}}};
    for(const [id,old] of this.jobs){if(this.jobs.size<4)break;if(old.state!=='running'&&!old.active)this.jobs.delete(id);}this.jobs.set(job.id,job);
    if(job.force&&targets.length===totalPages)job.cache={};
    job.invalidation=job.force?this.commit(()=>atomicJson(this.file(library,paperId,attachmentId).replace('.json','.chunks.json'),this.checkpoint(job))):Promise.resolve();
    job.invalidation.catch(()=>{});
    this.armIdle(job);
    if(!incremental){try{const structured=structureTranslationPages(validatePages(pages),hash);for(let i=0;i<structured.length;i++)this.addPage(job,i+1,structured[i],{});this.seal(job.id);}catch(error){this.cancel(job.id);throw error;}}
    return this.public(job);
  }
  addPage(job,pageNumber,input,context={}) {
    if(job.state!=='running'||job.sealed)throw Error(tr('번역 입력이 종료됐습니다.'));
    if(!job.targets.has(pageNumber)||job.received.has(pageNumber))throw Error(tr('중복되거나 잘못된 페이지입니다.'));
    // A page read by OCR may bring its picture: sent with its requests (to a connection that takes
    // images), named by hash in the context and so in the cache keys, and never saved.
    const image=job.client.imageMessage?referenceImages([input?.image])[0]||null:null;
    const [page]=validatePages([input],true);this.keepChains(job,page);
    const length=page.blocks.reduce((n,b)=>n+b.text.length,0);for(const block of page.blocks)if(job.blockIds.has(block.id))throw Error(tr('중복 문단입니다.'));
    if(job.textLength+length>1500000)throw Error(tr('자료 본문이 번역 가능한 크기를 초과했습니다.'));
    job.textLength+=length;for(const block of page.blocks)job.blockIds.add(block.id);job.received.add(pageNumber);
    const safeContext={title:String(context.title||'').slice(0,250),previous:String(context.previous||'').slice(-600),next:String(context.next||'').slice(0,600),...(job.rules?{userRules:job.rules,userRulesNote:USER_RULES_NOTE}:{}),...(job.images.length?{referenceImages:job.imageHashes,referenceImagesNote:REFERENCE_IMAGES_NOTE}:{}),...(image?{pageImage:crypto.createHash('sha256').update(image).digest('hex'),pageImageNote:PAGE_IMAGE_NOTE}:{})};
    const chunks=pageChunks(page,safeContext,job.model,job.hash,job.connection),entry={page,pageNumber,image,remaining:chunks.length,translated:new Map(),partial:new Map(),unitCounts:new Map(),missingUnits:new Set(),missingReasons:new Map()};
    for(const chunk of chunks)for(const unit of chunk.units)entry.unitCounts.set(unit.blockId,(entry.unitCounts.get(unit.blockId)||0)+1);
    job.total+=chunks.length;
    if(job.force&&job.targets.size!==job.totalPages){for(const chunk of chunks)delete job.cache[chunk.key];job.invalidation=this.commit(()=>atomicJson(this.file(job.library,job.paperId,job.attachmentId).replace('.json','.chunks.json'),this.checkpoint(job)));job.invalidation.catch(()=>{});}
    if(!chunks.length){this.pageReady(job,entry);return;}
    for(const chunk of chunks)job.queue.push({...chunk,entry});
    this.pump(job);
  }
  // A page re-translation keeps a chain only when the stored translation of
  // the pages outside this job agrees with it. Otherwise each block is
  // translated on its own, so no box is left empty or shown twice.
  keepChains(job,page){
    const stored=id=>{for(let i=0;i<job.output.length;i++){if(job.targets.has(i+1))continue;const block=job.output[i]?.blocks?.find(b=>b.id===id);if(block)return block;}return null;};
    for(const block of page.blocks){
      if(block.flowHead){const head=stored(block.flowHead);if(head&&!(head.flowIds||[]).includes(block.id))delete block.flowHead;}
      if(block.flowIds&&block.flowIds.some(id=>{const member=stored(id);return member&&member.flowHead!==block.id;})){delete block.flowIds;delete block.flowText;}
    }
  }
  append(id,pageNumber,page,context){const job=this.jobs.get(id);if(!job)throw Error(tr('번역 작업을 찾을 수 없습니다.'));this.addPage(job,pageNumber,page,context);return this.public(job);}
  prioritize(id,pageNumber){const job=this.jobs.get(id);if(!job||job.state!=='running'||!Number.isInteger(pageNumber)||pageNumber<1||pageNumber>job.totalPages)return;const rank=n=>(n-pageNumber+job.totalPages)%job.totalPages;job.queue.sort((a,b)=>rank(a.entry.pageNumber)-rank(b.entry.pageNumber));}
  seal(id){const job=this.jobs.get(id);if(!job||job.state!=='running')throw Error(tr('번역 작업이 종료됐습니다.'));if(job.received.size!==job.targets.size)throw Error(tr('분석하지 못한 페이지가 있습니다.'));job.sealed=true;this.pump(job);return this.public(job);}
  // Streamed units: a page is published with every paragraph whose units
  // have all arrived; the rest stay pending (source shown) until pageReady.
  partialUnit(job,task,id,text){
    const entry=task.entry;if(job.state!=='running'||entry.ready)return;
    const unit=task.units.find(u=>u.id===id);if(!unit)return;
    try{text=restoreUnit(unit,text);}catch{return;}
    let parts=entry.partial.get(unit.blockId);if(!parts){parts=[];entry.partial.set(unit.blockId,parts);}
    parts[Number(unit.id.slice(unit.id.lastIndexOf(':s')+2))]=text;
    // A page's first finished paragraph is shown at once; later ones are gathered for 300 ms.
    if(!entry.shown&&this.publishPartial(job,entry)){entry.shown=true;return;}
    if(!entry.publishTimer){entry.publishTimer=setTimeout(()=>{entry.publishTimer=null;this.publishPartial(job,entry);},300);entry.publishTimer.unref?.();}
  }
  publishPartial(job,entry){
    if(job.state!=='running'||entry.ready||job.controller.signal.aborted)return false;
    let any=false;
    // The page's blocks are classified once and reused by each 300 ms publish (the source page does not change).
    const blocks=(entry.layout||=layoutBlocks(entry.page)).map(block=>{
      const count=entry.unitCounts.get(block.id)||0,parts=Array.from({length:count},(_,i)=>entry.translated.get(block.id)?.[i]??entry.partial.get(block.id)?.[i]);
      const ready=!block.sourceOnly&&count>0&&parts.every(p=>typeof p==='string');if(ready)any=true;
      const out={...block,translation:block.sourceOnly?block.text:ready?parts.join(' '):'',warnings:[],...(block.sourceOnly||ready?{}:{pending:true})};
      delete out.sourceOnly;delete out.sectionContext;delete out.flowText;return out;
    });
    if(!any)return false;
    job.output[entry.pageNumber-1]={...entry.page,blocks,partial:true};job.revision++;job.pageRevisions.set(entry.pageNumber-1,job.revision);
    return true;
  }
  pageReady(job,entry){if(job.state!=='running'||job.controller.signal.aborted)return;entry.ready=true;entry.layout=null;clearTimeout(entry.publishTimer);for(const [index,block] of layoutBlocks(entry.page).entries()){const count=entry.unitCounts.get(block.id)||0,parts=entry.translated.get(block.id)||[],incomplete=!block.sourceOnly&&count>0&&Array.from({length:count},(_,i)=>parts[i]).some(p=>typeof p!=='string'||!p.trim());block.translation=block.sourceOnly?block.text:incomplete?'':parts.join(' ');if(incomplete){block.missingTranslation=true;block.missingReason=entry.missingReasons.get(block.id)||'missing';}block.warnings=block.sourceOnly?(formulaLike(block.text)?['수식 포함 영역은 원문으로 보존했습니다.']:[]):block.flowHead?[]:[...(block.preserveSource?['수식이 포함된 문단입니다. 원문을 보존하고 번역은 섹션 보기와 PDF 연속 페이지에 표시합니다.']:[]),...reviewTranslation(block.flowText||block.text,block.translation)];if(incomplete)block.warnings=[`번역 응답을 확인하지 못한 문단입니다(${MISSING_REASONS[block.missingReason]||MISSING_REASONS.missing}). 이 페이지를 다시 번역하세요.`];delete block.sourceOnly;delete block.sectionContext;delete block.flowText;entry.page.blocks[index]=block;}entry.page.translatedBy={connection:job.connection,model:job.model};job.output[entry.pageNumber-1]=entry.page;job.readyPages++;job.revision++;job.pageRevisions.set(entry.pageNumber-1,job.revision);if(job.metrics.firstPageMs===null&&entry.page.blocks.length)job.metrics.firstPageMs=Date.now()-job.metrics.startedAt;} // i18n:keep — the warning saved with the translation is Korean whatever the screen (pdf-layout warningText names it)
  pump(job){
    if(job.state!=='running')return;
    // An error no retry can fix (a refused key, a used-up quota) stops sending the rest of the paper.
    if(job.fatal)job.queue=[];
    while(job.active<job.concurrency&&job.queue.length){const task=job.queue.shift();job.active++;this.work(job,task).catch(error=>{if(job.controller.signal.aborted)return;job.failed.push({page:task.entry.pageNumber,message:error.message});if(error.fatal&&!job.fatal){job.fatal=error;job.queue=[];job.message=error.message;}}).finally(()=>{job.active--;this.pump(job);});}
    if(job.sealed&&!job.queue.length&&!job.active&&!job.finalizing){job.finalizing=true;this.finish(job).catch(error=>{if(job.state==='running'){job.state='failed';job.message=error.message;job.metrics.totalMs=Date.now()-job.metrics.startedAt;clearTimeout(job.timer);}});}
  }
  async work(job,task){
    const signal=job.controller.signal;await job.invalidation;signal.throwIfAborted();let result;
    if(!job.force&&job.cache?.[task.key]){try{result=checkCachedMath(task,checkResult(task.blocks,job.cache[task.key],task.context));job.metrics.cacheHits++;}catch{/* a cached result that no longer passes is translated again */}}
    if(!result){
      const {texts,missing}=await this.translateUnits(job,task,task.units,0);signal.throwIfAborted();
      result=task.units.filter(u=>texts.has(u.id)).map(u=>({id:u.id,text:texts.get(u.id)}));
      // Only a chunk with every paragraph translated is reused later.
      if(!missing.size){job.cache[task.key]=result;const keys=Object.keys(job.cache);for(const key of keys.slice(0,Math.max(0,keys.length-2000)))delete job.cache[key];this.saveCheckpoint(job,signal);}
      for(const [id,kind] of missing){const unit=task.units.find(u=>u.id===id);task.entry.missingUnits.add(id);task.entry.missingReasons.set(unit.blockId,kind);job.missingUnits=(job.missingUnits||0)+1;}
      this.armIdle(job);
    }
    signal.throwIfAborted();
    const byId=new Map(result.map(b=>[b.id,b.text]));
    for(const unit of task.units){let parts=task.entry.translated.get(unit.blockId);if(!parts){parts=[];task.entry.translated.set(unit.blockId,parts);}parts[Number(unit.id.slice(unit.id.lastIndexOf(':s')+2))]=byId.get(unit.id);}
    job.done++;task.entry.remaining--;if(!task.entry.remaining)this.pageReady(job,task.entry);
    job.message=tr('{ready}/{pages}페이지 완료 · 문단 묶음 {done}/{total}',{ready:job.readyPages,pages:job.targets.size,done:job.done,total:job.total});
  }
  // Asks for some units of one chunk and returns each paragraph that passed
  // its checks. A reply is judged paragraph by paragraph: the good ones are
  // kept at once and only the failed ones are asked again, first in halves,
  // then each on its own; what still fails is left untranslated with the
  // reason. Network errors and limits are retried as the same request.
  async translateUnits(job,task,units,round){
    const signal=job.controller.signal,request=units===task.units?task:{...task,units,blocks:units.map(({id,text})=>({id,text}))};
    let replies=null;
    for(let attempt=0;;attempt++){
      signal.throwIfAborted();
      try{job.metrics.requests++;replies=await job.client.translate(job.model,request.blocks,AbortSignal.any([signal,AbortSignal.timeout(job.client.requestTimeout||180000)]),job.images.length||task.entry.image?{...request.context,images:[...job.images,...(task.entry.image?[task.entry.image]:[])]}:request.context,(id,text)=>this.partialUnit(job,request,id,text));break;}
      catch(error){
        if(signal.aborted)throw error;
        // A malformed reply is not asked again whole: what it holds (or what
        // streamed before it broke) is checked paragraph by paragraph below.
        if(error.code==='APP_REPLY_INVALID'){replies=error.replies||[];break;}
        const limited=error.status===429||/usage_limit|rate_limit/.test(error.message),transient=limited||error.status>=500||error.name==='TimeoutError'||error.name==='TypeError';if(limited)job.concurrency=1;
        if(error.fatal||!transient||attempt>=2)throw error;job.metrics.retries++;
        // The cause stays visible while waiting; a rate limit may ask for up to a minute.
        job.message=tr('요청 오류로 잠시 기다린 뒤 다시 시도합니다: {reason}',{reason:error.name==='TimeoutError'?tr('응답 시간이 초과됐습니다.'):error.message});await pause(Math.min(limited?60000:10000,error.retryAfterMs||1000*2**attempt),signal);
      }
    }
    const byId=new Map((Array.isArray(replies)?replies:[]).filter(b=>b&&typeof b.text==='string').map(b=>[b.id,b.text])),texts=new Map(),failed=[],reasons=new Map();
    for(const unit of units){
      const index=Number(unit.id.slice(unit.id.lastIndexOf(':s')+2)),streamed=task.entry.partial.get(unit.blockId)?.[index];
      try{
        if(byId.has(unit.id)){const text=byId.get(unit.id);checkReply(unit.text,text,request.context);texts.set(unit.id,restoreUnit(unit,text));}
        // A paragraph that streamed complete (formulas already restored) before the reply broke.
        else if(typeof streamed==='string'&&streamed.trim()){checkReply(unit.text,streamed,request.context);texts.set(unit.id,streamed);}
        else throw replyError(tr('번역 결과에 누락 또는 중복 문단이 있습니다.'),'missing');
      }catch(error){const kind=invalidKind(error);job.metrics.invalid[kind]=(job.metrics.invalid[kind]||0)+1;failed.push(unit);reasons.set(unit.id,kind);}
    }
    if(!failed.length||round>=2)return {texts,missing:reasons};
    job.metrics.retries++;job.message=tr('번역 응답에서 확인하지 못한 문단만 다시 요청합니다.');
    const half=Math.ceil(failed.length/2),groups=round===0&&failed.length>1?[failed.slice(0,half),failed.slice(half)]:failed.map(unit=>[unit]);
    const missing=new Map();
    for(const result of await Promise.all(groups.map(group=>this.translateUnits(job,task,group,round+1)))){for(const [id,text] of result.texts)texts.set(id,text);for(const [id,kind] of result.missing)missing.set(id,kind);}
    return {texts,missing};
  }
  async finish(job){
    const signal=job.controller.signal;signal.throwIfAborted();
    if(job.fatal){job.state='failed';job.message=tr('번역을 멈췄습니다: {reason} 문제를 해결한 뒤 실패 부분 재시도로 이어서 번역하세요.',{reason:job.fatal.message});}
    else if(job.failed.length){job.state='failed';job.message=tr('{n}개 묶음 번역 실패. 실패 부분 재시도로 이어서 번역하세요. ({reason})',{n:job.failed.length,reason:job.failed[0].message});}
    else if(!job.textLength){job.state='failed';job.message=tr('텍스트를 추출하지 못했습니다.');}
    else {
      if((await source(job.library,job.paperId,job.attachmentId)).hash!==job.hash)throw Error(tr('번역 중 원문이 변경됐습니다.'));
      const result={version:1,sourceHash:job.hash,connection:job.connection,model:job.model,promptVersion:PROMPT_VERSION,language:TARGET.code,createdAt:new Date().toISOString(),pages:job.output};
      await this.commit(async()=>{signal.throwIfAborted();await atomicJson(this.file(job.library,job.paperId,job.attachmentId),result);job.checkpointDone=true;await atomicJson(this.file(job.library,job.paperId,job.attachmentId).replace('.json','.chunks.json'),this.checkpoint(job,true));});
      signal.throwIfAborted();job.state='completed';job.message=job.missingUnits?tr('번역을 완료했습니다. 확인하지 못한 문단 {n}개는 원문으로 표시합니다. 해당 페이지를 다시 번역하세요.',{n:job.missingUnits}):tr('번역을 완료했습니다.');job.revision++;
    }
    job.metrics.totalMs=Date.now()-job.metrics.startedAt;clearTimeout(job.timer);
  }
  cancel(id){const job=this.jobs.get(id);if(job?.state==='running'){job.controller.abort();job.queue=[];job.state='cancelled';job.message=tr('번역을 중단했습니다. 완료한 청크는 이어서 번역할 때 재사용합니다.');job.metrics.totalMs=Date.now()-job.metrics.startedAt;clearTimeout(job.timer);}}
  stopAll(connection){for(const job of this.jobs.values())if(!connection||job.connection===connection)this.cancel(job.id);}
}
module.exports={checkReply,TranslationJobs,source,validatePages,exportHtml,applyLayoutPlan,applyFlow,repairPages,restoreUnit};
