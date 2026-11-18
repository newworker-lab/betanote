const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {Library}=require('../desktop/storage.cjs');
const {TranslationJobs,source,validatePages,exportHtml}=require('../desktop/translation.cjs');
const appName = require('../core/app-name.cjs');
const pages=()=>[{width:600,height:800,blocks:[{id:'p1-b1',text:'Research',x:20,y:20,width:200,height:40,fontSize:12}]}];
async function fixture(t){const dir=await fs.mkdtemp(path.join(os.tmpdir(),`${appName.id}-translation-`));t.after(()=>fs.rm(dir,{recursive:true,force:true}));await fs.mkdir(path.join(dir,'vault'));const pdf=path.join(dir,'test.pdf');await fs.writeFile(pdf,'%PDF-1.4\nfixture');const library=await Library.open(path.join(dir,'vault'));await library.importFiles([pdf]);const paperId=library.data.papers[0].id;return {library,paperId,hash:(await source(library,paperId)).hash};}
async function finished(jobs,id){for(let i=0;i<100;i++){const job=jobs.jobs.get(id);if(job.state!=='running')return job;await new Promise(r=>setTimeout(r,10));}throw Error('timeout');}
test('translation is cached against the exact PDF hash and restores without importing a PDF',async t=>{const f=await fixture(t),auth={status:()=>({usable:true}),models:async()=>[{id:'model'}],translate:async(_model,blocks)=>blocks.map(b=>({id:b.id,text:'연구'}))},jobs=new TranslationJobs(auth);const job=await jobs.start(f.library,f.paperId,f.hash,pages(),'model');assert.equal((await finished(jobs,job.id)).state,'completed');const record=await jobs.cached(f.library,f.paperId);assert.equal(record.pages[0].blocks[0].translation,'연구');await fs.appendFile(await f.library.resolveFile(f.paperId,'original'),'changed');assert.equal(await jobs.cached(f.library,f.paperId),null)});
test('failed or cancelled inference never overwrites completed translation',async t=>{const f=await fixture(t);let fail=false;const auth={status:()=>({usable:true}),models:async()=>[{id:'model'}],translate:async(_model,blocks)=>{if(fail)throw Error('limit');return blocks.map(b=>({id:b.id,text:'기존 번역'}))}},jobs=new TranslationJobs(auth);const a=await jobs.start(f.library,f.paperId,f.hash,pages(),'model');await finished(jobs,a.id);fail=true;const b=await jobs.start(f.library,f.paperId,f.hash,pages(),'model');assert.equal((await finished(jobs,b.id)).state,'failed');assert.equal((await jobs.cached(f.library,f.paperId)).pages[0].blocks[0].translation,'기존 번역')});
test('empty text, duplicate IDs and invalid layout cannot be submitted',()=>{assert.throws(()=>validatePages([{width:600,height:800,blocks:[]}]),/텍스트/);const p=pages();p[0].blocks.push({...p[0].blocks[0]});assert.throws(()=>validatePages(p),/문단/);const q=pages();q[0].blocks[0].x=NaN;assert.throws(()=>validatePages(q),/문단/)});
test('export escapes translated text and rejects external page-image URLs',()=>{const p=pages();p[0].blocks[0].translation='<script>text</script>';assert.throws(()=>exportHtml(p,['https://example.com/image.png']),/이미지/);assert.match(exportHtml(p,['data:image/png;base64,aGVsbG8=']),/&lt;script&gt;/)});

const pageAt=n=>({width:600,height:800,blocks:[{id:`p${n}-b0`,text:`Page ${n} research.`,x:20,y:20,width:200,height:40,fontSize:12}]});
const translated=(blocks,text='번역')=>blocks.map(b=>({id:b.id,text}));
async function until(fn){for(let i=0;i<500;i++){if(await fn())return;await new Promise(r=>setTimeout(r,10));}throw Error('condition timeout');}
const authFor=translate=>({status:()=>({usable:true}),models:async()=>[{id:'model'},{id:'other-model'}],translate});
test('incremental input prioritizes requested pages, runs concurrent calls and exposes a page before completion',async t=>{
 const f=await fixture(t),calls=[],gates=new Map();let active=0,max=0;
 const jobs=new TranslationJobs(authFor(async(_model,blocks)=>{active++;max=Math.max(max,active);calls.push(blocks[0].id);await new Promise(resolve=>gates.set(blocks[0].id,resolve));active--;return translated(blocks);}));
 const job=await jobs.start(f.library,f.paperId,f.hash,[],'model',{incremental:true,totalPages:3,force:false});
 jobs.append(job.id,2,pageAt(2));await until(()=>calls.length===1);assert.match(calls[0],/^p2/);
 jobs.append(job.id,3,pageAt(3));jobs.append(job.id,1,pageAt(1));jobs.seal(job.id);await until(()=>calls.length===3);assert.equal(max,3);
 gates.get(calls[0])();await until(()=>jobs.jobs.get(job.id).readyPages===1);
 const partial=jobs.result(job.id);assert.equal(partial.state,'running');assert.equal(partial.record.partial,true);assert.equal(partial.record.pages[1].blocks[0].translation,'번역');assert.equal(partial.record.pages[0],null);assert.equal(jobs.result(job.id,partial.revision).record,null);assert.equal(await jobs.cached(f.library,f.paperId),null);
 await until(()=>calls.length===3);for(const release of gates.values())release();await until(()=>jobs.jobs.get(job.id).state==='completed');
 const delta=jobs.result(job.id,partial.revision).record;assert.equal(delta.pages,undefined);assert.deepEqual(delta.updates.map(u=>u.index).sort(),[0,2]);const done=jobs.result(job.id);assert.equal(max,3);assert.ok(done.metrics.firstPageMs>=0);assert.ok(done.metrics.totalMs>=done.metrics.firstPageMs);assert.deepEqual(done.record.pages.map(p=>p.blocks[0].id),['p1-b0','p2-b0','p3-b0']);
});
test('a new process resumes successful chunks and requests only failed chunks',async t=>{
 const f=await fixture(t);let fail=true,calls=[];
 const auth=authFor(async(_model,blocks)=>{calls.push(blocks[0].id);if(fail&&blocks[0].id.startsWith('p2'))throw Error('fixture failure');return translated(blocks);});
 let jobs=new TranslationJobs(auth),job=await jobs.start(f.library,f.paperId,f.hash,[pageAt(1),pageAt(2)],'model',{force:false});await until(()=>jobs.jobs.get(job.id).state==='failed');assert.equal(await jobs.cached(f.library,f.paperId),null);
 fail=false;calls=[];jobs=new TranslationJobs(auth);job=await jobs.start(f.library,f.paperId,f.hash,[pageAt(1),pageAt(2)],'model',{force:false});await until(()=>jobs.jobs.get(job.id).state==='completed');assert.deepEqual(calls,['p2-b0:s0']);assert.equal(jobs.result(job.id).metrics.cacheHits,1);
});
test('cache separates model and context, while explicit retranslation bypasses it',async t=>{
 const f=await fixture(t);let calls=0;const jobs=new TranslationJobs(authFor(async(_m,blocks)=>{calls++;return translated(blocks);}));
 async function run(model,force,title){const job=await jobs.start(f.library,f.paperId,f.hash,[],model,{incremental:true,totalPages:1,force});jobs.append(job.id,1,pageAt(1),{title});jobs.seal(job.id);await until(()=>jobs.jobs.get(job.id).state!=='running');assert.equal(jobs.result(job.id).state,'completed');}
 await run('model',false,'A');assert.equal(calls,1);await run('model',false,'A');assert.equal(calls,1);await run('model',false,'B');assert.equal(calls,2);await run('other-model',false,'B');assert.equal(calls,3);await run('other-model',true,'B');assert.equal(calls,4);
});
test('the vault translation requests travel as user preferences and are part of the cache key',async t=>{
 const f=await fixture(t),contexts=[];const jobs=new TranslationJobs(authFor(async(_m,blocks,_s,context)=>{contexts.push(context);return translated(blocks);}));
 async function run(rules){const job=await jobs.start(f.library,f.paperId,f.hash,[],'model',{incremental:true,totalPages:1,rules,force:false});jobs.append(job.id,1,pageAt(1),{title:'A'});jobs.seal(job.id);await until(()=>jobs.jobs.get(job.id).state!=='running');assert.equal(jobs.result(job.id).state,'completed');}
 await run('');assert.equal(contexts.length,1);assert.equal(contexts[0].userRules,undefined,'no requests, no change to the request');
 await run('');assert.equal(contexts.length,1,'same cache without requests');
 await run('  용어는 영어 병기  ');assert.equal(contexts.length,2,'new requests translate anew');assert.equal(contexts[1].userRules,'용어는 영어 병기');assert.match(contexts[1].userRulesNote,/do not change meaning/);
 await run('용어는 영어 병기');assert.equal(contexts.length,2,'the same requests reuse their cache');
 // The vault's requests and this translation's own together (each up to 2,000 characters) are capped.
 await run('x'.repeat(5000));assert.equal(contexts.at(-1).userRules.length,4200);
});
test('reference images of a translation go with each request, named in the context and its cache key',async t=>{
 const f=await fixture(t),calls=[];const jobs=new TranslationJobs(authFor(async(_m,blocks,_s,context)=>{calls.push(context);return translated(blocks);}));
 const png='data:image/png;base64,iVBORw0KGgo=',other='data:image/png;base64,iVBORw0KGgoA';
 async function run(images){const job=await jobs.start(f.library,f.paperId,f.hash,[],'model',{incremental:true,totalPages:1,images,force:false});jobs.append(job.id,1,pageAt(1),{title:'A'});jobs.seal(job.id);await until(()=>jobs.jobs.get(job.id).state!=='running');assert.equal(jobs.result(job.id).state,'completed');}
 await run([]);assert.equal(calls.length,1);assert.equal(calls[0].images,undefined);assert.equal(calls[0].referenceImages,undefined,'no images, no change to the request');
 await run([png,'https://example.test/x.png','data:image/svg+xml;base64,PHN2Zz4=']);assert.equal(calls.length,2,'images translate anew');
 assert.deepEqual(calls[1].images,[png],'only PNG data URLs are sent');assert.equal(calls[1].referenceImages.length,1);assert.match(calls[1].referenceImages[0],/^[0-9a-f]{64}$/);assert.match(calls[1].referenceImagesNote,/reference material/);
 await run([png]);assert.equal(calls.length,2,'the same images reuse their cache');
 await run([png,other]);assert.equal(calls.length,3);assert.equal(calls[2].images.length,2);
 // The images go beside the request's text, in each provider's own form; one without that form says so.
 const {translateBlocks}=require('../desktop/llm.cjs');const sent=[];
 const client={label:'X',imageMessage:(text,images)=>({role:'user',content:text,images}),respond:async(_m,messages)=>{sent.push(messages[0]);const body=JSON.parse(messages[0].content);return JSON.stringify({blocks:body.blocks.map(b=>({id:b.id,text:'번역'}))});}};
 await translateBlocks(client,'m',[{id:'a',text:'x'}],undefined,{title:'T',images:[png]});
 assert.deepEqual(sent[0].images,[png]);assert.equal(JSON.parse(sent[0].content).context.images,undefined,'not inside the text');assert.equal(JSON.parse(sent[0].content).context.title,'T');
 await assert.rejects(translateBlocks({...client,imageMessage:undefined},'m',[{id:'a',text:'x'}],undefined,{images:[png]}),/이미지를 함께 보낼 수 없습니다/);
 const {ChatGPT}=require('../desktop/chatgpt.cjs');assert.deepEqual(ChatGPT.prototype.imageMessage('t',[png]).content,[{type:'input_text',text:'t'},{type:'input_image',image_url:png,detail:'auto'}]);
});
test('page retranslation preserves all other pages and may use another model, recorded per page',async t=>{
 const f=await fixture(t);let value='기존';const jobs=new TranslationJobs(authFor(async(_m,blocks)=>translated(blocks,value)));
 await assert.rejects(jobs.start(f.library,f.paperId,f.hash,[],'model',{incremental:true,totalPages:2,pageNumbers:[2]}),/기존 번역이 있을 때만/);
 let job=await jobs.start(f.library,f.paperId,f.hash,[pageAt(1),pageAt(2)],'model');await until(()=>jobs.result(job.id).state==='completed');value='새 번역';
 job=await jobs.start(f.library,f.paperId,f.hash,[],'model',{incremental:true,totalPages:2,pageNumbers:[2]});jobs.append(job.id,2,pageAt(2));jobs.seal(job.id);await until(()=>jobs.result(job.id).state==='completed');
 assert.deepEqual((await jobs.cached(f.library,f.paperId)).pages.map(p=>p.blocks[0].translation),['기존','새 번역']);
 value='다른 모델 번역';job=await jobs.start(f.library,f.paperId,f.hash,[],'other-model',{incremental:true,totalPages:2,pageNumbers:[2]});jobs.append(job.id,2,pageAt(2));jobs.seal(job.id);await until(()=>jobs.result(job.id).state==='completed');
 const mixed=await jobs.cached(f.library,f.paperId);
 assert.deepEqual(mixed.pages.map(p=>p.blocks[0].translation),['기존','다른 모델 번역']);
 assert.deepEqual(mixed.pages.map(p=>p.translatedBy.model),['model','other-model']);assert.equal(mixed.model,'other-model','the record names the latest model');
});
test('rate limiting reduces concurrency and retries a chunk without losing progress',async t=>{
 const f=await fixture(t);let calls=0;const jobs=new TranslationJobs(authFor(async(_m,blocks)=>{if(++calls===1)throw Object.assign(Error('rate_limit'),{status:429,retryAfterMs:1});return translated(blocks);}));
 const job=await jobs.start(f.library,f.paperId,f.hash,[pageAt(1),pageAt(2),pageAt(3)],'model');await until(()=>jobs.result(job.id).state==='completed');assert.equal(jobs.jobs.get(job.id).concurrency,1);assert.equal(jobs.result(job.id).metrics.retries,1);assert.equal(calls,4);
});
test('cancelling a late response cannot overwrite completed translation or checkpoint',async t=>{
 const f=await fixture(t);let release;const jobs=new TranslationJobs(authFor(async(_m,blocks)=>translated(blocks,'기존')));let job=await jobs.start(f.library,f.paperId,f.hash,pages(),'model');await until(()=>jobs.result(job.id).state==='completed');
 jobs.auth=authFor(async(_m,blocks)=>{await new Promise(r=>release=r);return translated(blocks,'취소된 번역');});job=await jobs.start(f.library,f.paperId,f.hash,pages(),'model');await until(()=>release);jobs.cancel(job.id);release();await until(()=>jobs.jobs.get(job.id).active===0);assert.equal(jobs.result(job.id).state,'cancelled');assert.equal((await jobs.cached(f.library,f.paperId)).pages[0].blocks[0].translation,'기존');
 const checkpoint=JSON.parse(await fs.readFile(jobs.file(f.library,f.paperId).replace('.json','.chunks.json'),'utf8'));assert.ok(!JSON.stringify(checkpoint).includes('취소된 번역'));
});
test('blocks a reply keeps omitting are marked untranslated instead of stalling the page, and blank pages work alongside text pages',async t=>{
 const f=await fixture(t);let calls=0;const jobs=new TranslationJobs(authFor(async()=>{calls++;return [];}));let job=await jobs.start(f.library,f.paperId,f.hash,pages(),'model');await until(()=>jobs.result(job.id).state!=='running');
 assert.equal(calls,3);assert.equal(jobs.result(job.id).state,'completed');assert.match(jobs.result(job.id).message,/확인하지 못한 문단 1개/);
 const stored=(await jobs.cached(f.library,f.paperId)).pages[0].blocks[0];assert.equal(stored.translation,'');assert.equal(stored.missingTranslation,true);assert.match(stored.warnings[0],/다시 번역/);
 jobs.auth=authFor(async(_m,blocks)=>translated(blocks));job=await jobs.start(f.library,f.paperId,f.hash,[],'model',{incremental:true,totalPages:2});jobs.append(job.id,1,{width:600,height:800,blocks:[]});jobs.append(job.id,2,pageAt(2));jobs.seal(job.id);await until(()=>jobs.result(job.id).state==='completed');assert.equal(jobs.result(job.id).readyPages,2);
});
test('resume after failed forced retranslation never reuses the older completed chunk',async t=>{
 const f=await fixture(t);let fail=false,calls=[];const auth=authFor(async(_m,blocks)=>{calls.push(blocks[0].id);if(fail&&blocks[0].id.startsWith('p2'))throw Error('fixture failure');return translated(blocks,fail?'새 번역':'기존');});
 let jobs=new TranslationJobs(auth),job=await jobs.start(f.library,f.paperId,f.hash,[pageAt(1),pageAt(2)],'model');await until(()=>jobs.result(job.id).state==='completed');fail=true;
 job=await jobs.start(f.library,f.paperId,f.hash,[pageAt(1),pageAt(2)],'model');await until(()=>jobs.result(job.id).state==='failed');assert.equal((await jobs.cached(f.library,f.paperId)).pages[0].blocks[0].translation,'기존');
 fail=false;calls=[];jobs=new TranslationJobs(auth);job=await jobs.start(f.library,f.paperId,f.hash,[pageAt(1),pageAt(2)],'model',{force:false});await until(()=>jobs.result(job.id).state==='completed');assert.deepEqual(calls,['p2-b0:s0']);assert.equal((await jobs.cached(f.library,f.paperId)).pages[0].blocks[0].translation,'새 번역');
});
test('scroll priority changes only queued work, preserving the six in-flight calls',async t=>{
 const f=await fixture(t),calls=[],gates=[];const jobs=new TranslationJobs(authFor(async(_m,blocks)=>{calls.push(blocks[0].id);await new Promise(r=>gates.push(r));return translated(blocks);}));
 const job=await jobs.start(f.library,f.paperId,f.hash,[1,2,3,4,5,6,7,8].map(pageAt),'model');await until(()=>calls.length===6);await new Promise(r=>setTimeout(r,20));assert.equal(calls.length,6);jobs.prioritize(job.id,8);gates[0]();await until(()=>calls.length===7);assert.match(calls[6],/^p8/);gates[1]();await until(()=>calls.length===8);gates.forEach(r=>r());await until(()=>jobs.result(job.id).state==='completed');
});
test('long paragraph chunks reassemble in source order despite reversed completion',async t=>{
 const f=await fixture(t),input=pageAt(1);input.blocks[0].text=Array.from({length:200},(_,i)=>`Sentence ${i} with research details to translate. `).join('');
 const gates=[];const jobs=new TranslationJobs(authFor(async(_m,blocks)=>{await new Promise(r=>gates.push(r));return blocks.map(b=>({id:b.id,text:b.text.replace(/Sentence/g,'문장')}));}));
 const job=await jobs.start(f.library,f.paperId,f.hash,[input],'model');await until(()=>gates.length>=3);gates.reverse().forEach(release=>release());await until(()=>jobs.result(job.id).state==='completed');assert.equal(jobs.result(job.id).record.pages[0].blocks[0].translation.replace(/\s+/g,' ').trim(),input.blocks[0].text.replace(/Sentence/g,'문장').trim());
});
test('source changes during inference cannot publish a completed document',async t=>{
 const f=await fixture(t);let release;const jobs=new TranslationJobs(authFor(async(_m,blocks)=>{await new Promise(r=>release=r);return translated(blocks);}));const job=await jobs.start(f.library,f.paperId,f.hash,pages(),'model');await until(()=>release);await fs.appendFile(await f.library.resolveFile(f.paperId,'original'),'changed');release();await until(()=>jobs.result(job.id).state==='failed');assert.match(jobs.result(job.id).message,/원문/);assert.equal(await jobs.cached(f.library,f.paperId),null);assert.equal(await jobs.resume(f.library,f.paperId),null);
});
test('translation caches stay with attachments when changing primary and merging items',async t=>{
 const f=await fixture(t),other=path.join(f.library.root,'..','other.pdf');await fs.writeFile(other,'%PDF-1.4\nfixture');await f.library.importFiles([other]);const second=f.library.data.papers.find(p=>p.id!==f.paperId),firstAttachment=f.library.attachment(f.paperId).id,secondAttachment=second.primaryAttachmentId;let text='첫 파일 번역';const jobs=new TranslationJobs(authFor(async(_m,blocks)=>translated(blocks,text)));
 let job=await jobs.start(f.library,f.paperId,f.hash,pages(),'model',{attachmentId:firstAttachment});await until(()=>jobs.result(job.id).state==='completed');const firstFile=jobs.file(f.library,f.paperId,firstAttachment);assert.equal(await jobs.cached(f.library,second.id,secondAttachment),null);text='두 번째 파일 번역';job=await jobs.start(f.library,second.id,f.hash,pages(),'model',{attachmentId:secondAttachment});await until(()=>jobs.result(job.id).state==='completed');const secondFile=jobs.file(f.library,second.id,secondAttachment);assert.notEqual(firstFile,secondFile);
 await f.library.mergePapers(f.paperId,second.id);await f.library.setPrimary(f.paperId,secondAttachment);assert.equal(jobs.file(f.library,f.paperId,secondAttachment),secondFile);assert.equal((await jobs.cached(f.library,f.paperId)).pages[0].blocks[0].translation,'두 번째 파일 번역');assert.equal((await jobs.cached(f.library,f.paperId,firstAttachment)).pages[0].blocks[0].translation,'첫 파일 번역');
});
test('changing primary during inference cannot redirect the result to the new file',async t=>{
 const f=await fixture(t),other=path.join(f.library.root,'..','version.pdf');await fs.writeFile(other,'%PDF-1.4\nversion');const first=f.library.attachment(f.paperId).id;await f.library.importPDFs([other],{paperId:f.paperId,role:'version',folder:'papers'});const second=f.library.paper(f.paperId).attachments[1].id;let release;const jobs=new TranslationJobs(authFor(async(_m,blocks)=>{await new Promise(r=>release=r);return translated(blocks,'원래 파일 번역');}));const job=await jobs.start(f.library,f.paperId,f.hash,pages(),'model',{attachmentId:first});await until(()=>release);await f.library.setPrimary(f.paperId,second);release();await until(()=>jobs.result(job.id).state==='completed');assert.equal(await jobs.cached(f.library,f.paperId),null);assert.equal((await jobs.cached(f.library,f.paperId,first)).pages[0].blocks[0].translation,'원래 파일 번역');
});
test('legacy item migration keeps the existing completed translation cache readable',async t=>{
 const f=await fixture(t),jobs=new TranslationJobs(authFor(async(_m,blocks)=>translated(blocks,'기존 번역')));const job=await jobs.start(f.library,f.paperId,f.hash,pages(),'model');await until(()=>jobs.result(job.id).state==='completed');const p=f.library.paper(f.paperId);const legacy={version:1,id:f.library.data.id,papers:[{id:p.id,title:p.title,authors:p.authors,year:p.year,journal:p.journal,tags:p.tags,status:p.status,star:p.star,original:p.original}],notes:{[p.id+'-메모']:'기존 메모'}};await fs.writeFile(f.library.file,JSON.stringify(legacy));const migrated=await Library.open(f.library.root);assert.equal((await jobs.cached(migrated,p.id)).pages[0].blocks[0].translation,'기존 번역');assert.equal(migrated.data.notes[p.id+'-메모'],'기존 메모');assert.equal(jobs.file(migrated,p.id),jobs.file(f.library,p.id));
});

test('translation review flags missing numbers and inline equations without rejecting valid text',()=>{
 const {reviewTranslation}=require('../core/translation-quality.cjs');assert.deepEqual(reviewTranslation('Accuracy 95.2% [12] with $x+y$.','정확도 95.2% [12], $x+y$.'),[]);const warnings=reviewTranslation('Accuracy 95.2% [12] with $x+y$.','정확도 90%.');assert.ok(warnings.some(w=>w.includes('95.2%')));assert.ok(warnings.some(w=>w.includes('수식')));assert.deepEqual(reviewTranslation('The temperature is −10.','온도는 -10.'),[]);
});
test('reading PDF export flows complete text without page images or tiny fixed rectangles',()=>{
 const html=exportHtml([{width:600,height:800,blocks:[{translation:'긴 번역 <script>',warnings:['숫자 확인']}]}],[],'reading');assert.match(html,/긴 번역 &lt;script&gt;/);assert.match(html,/숫자 확인/);assert.doesNotMatch(html,/<img|position:absolute|class="block"/);assert.throws(()=>exportHtml([],[],'bad'));
});
test('omission warnings are persisted with the completed page and reloaded from cache',async t=>{
 const f=await fixture(t),input=pages();input[0].blocks[0].text='Accuracy 95.2% [12].';const jobs=new TranslationJobs(authFor(async(_m,blocks)=>translated(blocks,'정확도입니다.'))),job=await jobs.start(f.library,f.paperId,f.hash,input,'model');await until(()=>jobs.result(job.id).state==='completed');const cached=await jobs.cached(f.library,f.paperId);assert.match(cached.pages[0].blocks[0].warnings[0],/95.2%/);
});

test('local background sampling keeps shaded panels and joins wrapped prose',()=>{
 const {backgroundColor,normalizeParagraph}=require('../core/pdf-layout.js');
 const width=100,height=60,data=new Uint8ClampedArray(width*height*4);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){const i=(y*width+x)*4,shade=x<50?240:255;data.set([shade,shade,shade,255],i);}
 // Dark glyphs should not turn the grey panel into a white text mask.
 for(let x=10;x<40;x++)data.set([30,30,30,255],(20*width+x)*4);
 assert.equal(backgroundColor({data,width,height},{x:5,y:5,width:40,height:40}),'rgb(240, 240, 240)');
 assert.equal(backgroundColor({data,width,height},{x:55,y:5,width:40,height:40}),'rgb(255, 255, 255)');
 assert.equal(normalizeParagraph('A nonpara-\nmetric model\nuses data.'),'A nonparametric model uses data.');
});

test('layout export creates original source sheets for print-window continuation pagination',()=>{
 const input=[pageAt(1),pageAt(2)];input[0].blocks[0].translation='짧은 번역';input[1].blocks[0].translation='긴 번역 <script> '+ '본문 '.repeat(3000)+'OVERFLOWEND';
 const html=exportHtml(input,['data:image/png;base64,aGVsbG8=','data:image/png;base64,aGVsbG8='],'layout');
 assert.equal((html.match(/<section class="page"/g)||[]).length,2);assert.doesNotMatch(html,/flow-page|번역 보충/);assert.match(html,/OVERFLOWEND/);assert.match(html,/긴 번역 &lt;script&gt;/);assert.match(html,/overflow:hidden/);
});

test('column reading order, full-width headings and small footnotes keep stable paragraph IDs',()=>{
 const {paragraphs}=require('../core/pdf-layout.js');
 const line=(text,x,y,width=230,fontSize=12)=>({text,x,y,width,height:15,fontSize});
 const input=[line('Paper title',30,10,540,20),line('Left first.',30,60),line('Right first.',330,60),line('Left next paragraph.',30,110),line('Right next paragraph.',330,110),line('1 A footnote.',30,730,220,9)];
 const blocks=paragraphs(input,600,800,1);
 assert.deepEqual(blocks.map(b=>b.text),['Paper title','Left first.','Left next paragraph.','Right first.','Right next paragraph.','1 A footnote.']);
 assert.equal(blocks[0].kind,'heading');assert.equal(blocks[5].kind,'footnote');
 assert.deepEqual(paragraphs(input,600,800,1),blocks);assert.equal(new Set(blocks.map(b=>b.id)).size,6);
});
test('mixed backgrounds request source-preserving fallback, uniform grey stays in layout',()=>{
 const {backgroundSample}=require('../core/pdf-layout.js'),width=100,height=60,data=new Uint8ClampedArray(width*height*4);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++)data.set(x<50?[240,240,240,255]:[180,210,240,255],(y*width+x)*4);
 assert.deepEqual(backgroundSample({data,width,height},{x:0,y:0,width:40,height:50}),{color:'rgb(240, 240, 240)',safe:true});
 assert.equal(backgroundSample({data,width,height},{x:0,y:0,width:100,height:50}).safe,false);
});
test('link text in one colour is ink, not a second background; the Elsevier header line stays as printed',()=>{
 const {backgroundSample,layoutBlocks}=require('../core/pdf-layout.js'),width=120,height=20,data=new Uint8ClampedArray(width*height*4).fill(255);
 // Blue glyph strokes (dark core, pale edges) over a fifth of a white box.
 for(let y=6;y<14;y++)for(let x=0;x<width;x+=5){data.set([68,164,213,255],(y*width+x)*4);data.set([148,196,221,255],(y*width+x+1)*4);}
 assert.equal(backgroundSample({data,width,height},{x:0,y:0,width,height}).safe,true);
 const page={width:794,height:1059,blocks:[{id:'h',text:'journal homepage: www.elsevier.com/locate/engappai',x:261,y:158,width:276,height:14,fontSize:10.6,kind:'body'}]};
 assert.equal(layoutBlocks(page)[0].sourceOnly,true);
});
test('formula blocks retain source symbols without inference calls',async t=>{
 const f=await fixture(t),input=pages();input[0].blocks[0].kind='formula';input[0].blocks[0].text='x = y + 1';let sent;
 const jobs=new TranslationJobs(authFor(async(_m,blocks)=>{sent=blocks;return translated(blocks,'x = y + 1');}));
 const job=await jobs.start(f.library,f.paperId,f.hash,input,'model');await until(()=>jobs.result(job.id).state==='completed');
 assert.equal(sent,undefined);assert.equal((await jobs.cached(f.library,f.paperId)).pages[0].blocks[0].translation,'x = y + 1');assert.equal((await jobs.cached(f.library,f.paperId)).pages[0].blocks[0].kind,'formula');
});

test('mixed prose and mathematical blocks retain order while batching only prose',async t=>{
 const f=await fixture(t),input=pageAt(1),base=input.blocks[0];
 input.blocks=[{...base,text:'The following equation defines the model.'},{...base,id:'p1-b1',text:'E = mc²',y:80},{...base,id:'p1-b2',text:'We evaluate the resulting accuracy.',y:140}];
 const calls=[],jobs=new TranslationJobs(authFor(async(_m,blocks)=>{calls.push(blocks);return translated(blocks,'본문 번역');}));
 const job=await jobs.start(f.library,f.paperId,f.hash,[input],'model');await until(()=>jobs.result(job.id).state==='completed');
 assert.equal(calls.length,1);assert.equal(calls[0].length,2);assert.ok(calls[0].every(b=>!b.text.includes('mc²')));
 const record=await jobs.cached(f.library,f.paperId);assert.deepEqual(record.pages[0].blocks.map(b=>b.translation),['본문 번역','E = mc²','본문 번역']);
 const legacy=structuredClone(record.pages);legacy[0].blocks[1].translation='broken formula';
 assert.match(exportHtml(legacy,[],'reading'),/E = mc²/);assert.doesNotMatch(exportHtml(legacy,[],'reading'),/broken formula/);
});

test('author superscripts join their baseline without joining separate columns',()=>{
 const {textLines}=require('../core/pdf-layout.js');
 const run=(text,x,baseline,fontSize,width)=>({text,x,baseline,y:baseline-fontSize,fontSize,width,height:fontSize*1.25});
 const lines=textLines([run('Jane Doe',200,180,9,43),run('1,2',246,176,6,10),run('John Roe',263,180,9,43),run('3',307,176,6,4),run('Sidebar',40,180,9,40)]);
 assert.equal(lines.length,2);assert.equal(lines.find(l=>l.x===200).text,'Jane Doe 1,2 John Roe3');
});
test('affiliations are translated while standalone formulae and superscripts retain source',()=>{
 const {layoutBlocks}=require('../core/pdf-layout.js'),block=(text,y,fontSize=12)=>({id:text,text,x:200,y,width:350,height:20,fontSize});
 const blocks=[block('A sufficiently long research article title with several words',100,24),block('Jane Doe',150),block('1,2',145,8),block('Department of Biology',170),block('Abstract',220,14),block('The experimental data support the resulting model.',250),block('x = y + 1',300)];
 const result=layoutBlocks({blocks});assert.deepEqual(result.map(b=>b.sourceOnly),[false,false,true,false,false,false,true]);assert.deepEqual(result.map(b=>b.y),blocks.map(b=>b.y));
});

test('export accepts only a complete layout plan derived from the cached translation',()=>{
 const {applyLayoutPlan}=require('../desktop/translation.cjs'),page=pageAt(1);page.blocks[0].translation='저장된 번역';
 const block={...page.blocks[0],sourceIds:[page.blocks[0].id],translation:'주입된 번역',backgroundColor:'rgb(240, 240, 240)'};
 const planned=applyLayoutPlan([page],[{width:600,height:800,blocks:[block]}]);
 assert.equal(planned[0].blocks[0].translation,'저장된 번역');assert.match(exportHtml(planned,['data:image/png;base64,aA==']),/background-color:rgb\(240, 240, 240\)/);
 assert.throws(()=>applyLayoutPlan([page],[{width:600,height:800,blocks:[]}]),/누락/);
 assert.throws(()=>applyLayoutPlan([page],[{width:600,height:800,blocks:[{...block,sourceIds:[block.id,block.id]}]}]),/대응/);
});

test('dark serif glyphs do not mark a uniform shaded paragraph as a mixed background',()=>{
 const {backgroundSample}=require('../core/pdf-layout.js'),width=100,height=60,data=new Uint8ClampedArray(width*height*4);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++)data.set(x%3===0?[20,20,20,255]:[240,240,240,255],(y*width+x)*4);
 assert.deepEqual(backgroundSample({data,width,height},{x:0,y:0,width,height}),{color:'rgb(240, 240, 240)',safe:true});
});

test('legacy split title lines are not mistaken for author affiliations',()=>{
 const {layoutBlocks}=require('../core/pdf-layout.js');
 const block=(text,y,fontSize)=>({id:text,text,x:200,y,width:350,height:20,fontSize});
 const result=layoutBlocks({blocks:[block('A Bayesian non-parametric mixed-effects',100,24),block('model of microbial growth curves',125,24),block('Jane Doe 1,2',160,12),block('Abstract',220,14)]});
 assert.deepEqual(result.map(b=>b.sourceOnly),[false,false,false,false]);
});

test('legacy wrapped lines reconcile to a single masked paragraph with all cache IDs',()=>{
 const {reconcilePage,paragraphs}=require('../core/pdf-layout.js');
 const canonical=paragraphs([{text:'First line of a paragraph.',x:200,y:100,width:350,height:12,fontSize:12,baseline:110},{text:'Second line continues here.',x:200,y:115,width:340,height:12,fontSize:12,baseline:125}],800,1000,1);
 assert.equal(canonical.length,1);
 const cached={width:800,height:1000,blocks:[{id:'a',text:'First line of a paragraph.',translation:'첫째 줄',x:200,y:97,width:350,height:18,fontSize:12},{id:'b',text:'Second line continues here.',translation:'둘째 줄',x:200,y:112,width:340,height:18,fontSize:12}]};
 const result=reconcilePage(cached,{width:800,height:1000,blocks:canonical});assert.equal(result.blocks.length,1);assert.deepEqual(result.blocks[0].sourceIds,['a','b']);assert.equal(result.blocks[0].translation,'첫째 줄 둘째 줄');assert.equal(result.blocks[0].height,27);
});

test('paragraph masks include unindented continuation lines',()=>{
 const {paragraphs}=require('../core/pdf-layout.js');
 const blocks=paragraphs([{text:'An indented first line.',x:212,y:100,width:330,height:12,fontSize:12,baseline:110},{text:'The continuation starts at the column edge.',x:200,y:115,width:350,height:12,fontSize:12,baseline:125}],800,1000,1);
 assert.equal(blocks.length,1);assert.equal(blocks[0].x,200);assert.equal(blocks[0].width,350);assert.equal(blocks[0].height,27);
});

test('nearby publisher sidebar runs never merge into the main column',()=>{
 const {textLines}=require('../core/pdf-layout.js');
 const run=(text,x,width,fontSize)=>({text,x,width,fontSize,y:100,height:fontSize,baseline:110});
 const lines=textLines([run('Sidebar citation',48,200,12),run('Main abstract',267,500,14)]);
 assert.deepEqual(lines.map(l=>l.text).sort(),['Main abstract','Sidebar citation']);
 assert.ok(lines.every(l=>l.width<=500));
});
test('same-size section headings and bold subheadings stay separate from prose',()=>{
 const {paragraphs}=require('../core/pdf-layout.js');
 const line=(text,y,bold=false)=>({text,x:200,y,width:350,height:12,fontSize:12,baseline:y+10,bold});
 const result=paragraphs([line('Introduction',100),line('First paragraph begins here.',115),line('Experimental growth',155,true),line('The strains were grown in medium.',170)],800,1000,1);
 assert.deepEqual(result.map(b=>b.kind),['heading','body','heading','body']);
});
test('ambiguous legacy blocks keep their extent instead of shrinking into one paragraph',()=>{
 const {reconcilePage,layoutCollisions}=require('../core/pdf-layout.js');
 const a={id:'a',text:'Legacy source',translation:'기존 번역',x:200,y:100,width:350,height:60,fontSize:12};
 const result=reconcilePage({width:800,height:1000,blocks:[a,{...a,id:'b',y:135,height:25}]},{blocks:[{...a,id:'new1',height:20},{...a,id:'new2',y:135,height:25}]});
 assert.equal(result.blocks[0].height,60);assert.equal(result.blocks[0].mappingUncertain,true);
 assert.deepEqual([...layoutCollisions(result.blocks)].sort(),['a','b']);
});
test('sections continue across pages and IDs survive translation and index changes',()=>{
 const {sectionDocument}=require('../core/pdf-layout.js');
 const b=(id,text,y,kind='body',fontSize=12)=>({id,text,translation:text,x:200,y,width:350,height:20,fontSize,kind});
 const pages=[{width:800,height:1000,blocks:[b('a','Introduction',100,'heading',18),b('b','Paragraph one.',140)]},{width:800,height:1000,blocks:[b('c','Paragraph continues.',100),b('d','Methods',200,'heading',18),b('e','Experimental growth',240,'heading',14),b('f','Culture procedure.',280)]}];
 const first=sectionDocument(pages,'hash');assert.equal(first.sections.length,3);assert.deepEqual(first.sections[0].nodes.map(n=>n.page),[1,1,2]);assert.equal(first.sections[2].parentSectionId,first.sections[1].id);
 const changed=structuredClone(pages);for(const p of changed)for(const n of p.blocks){n.id+='changed';n.translation='새로운 번역';}
 assert.deepEqual(sectionDocument(changed,'hash').sections.map(s=>s.id),first.sections.map(s=>s.id));
 assert.notEqual(sectionDocument(pages,'different').sections[0].id,first.sections[0].id);
 assert.equal(first.nodes.length,6);
});
test('garbled extracted formula tokens are preserved instead of sent as prose',()=>{
 const {formulaLike}=require('../core/pdf-layout.js');
 assert.equal(formulaLike('Mbatch: yk;rðt; p; mÞ þ zfflfflfflffl'),true);
});

test('repeated text in short pages remains readable and is not discarded as a header',()=>{
 const {sectionDocument}=require('../core/pdf-layout.js');
 const block={id:'a',text:'A research paper connects ideas.',translation:'연구 논문은 아이디어를 연결합니다.',x:40,y:40,width:230,height:16,fontSize:16,kind:'body'};
 const model=sectionDocument([{width:800,height:1000,blocks:[block]},{width:800,height:1000,blocks:[{...block,id:'b'}]}],'hash');
 assert.equal(model.nodes.length,2);assert.equal(model.sections[0].nodes.length,2);
});
test('CSS line leading uses available space without crossing the next paragraph',()=>{
 const {layoutBlocks}=require('../core/pdf-layout.js');
 const b={id:'a',text:'A line of prose.',x:40,y:40,width:230,height:16,fontSize:16};
 const alone=layoutBlocks({width:800,height:1000,blocks:[b]});assert.equal(alone[0].height,20.8);
 const adjacent=layoutBlocks({width:800,height:1000,blocks:[b,{...b,id:'b',y:58}]});assert.equal(adjacent[0].height,18);
});

test('persistent gutters are identified before text assembly',()=>{
 const {columnGutters,textLines}=require('../core/pdf-layout.js');
 const runs=[0,1,2,3].flatMap(i=>[{text:'Sidebar information',x:40,y:100+i*15,baseline:110+i*15,width:160,height:12,fontSize:12},{text:'Main column of body text',x:220,y:100+i*15,baseline:110+i*15,width:330,height:12,fontSize:12}]);
 assert.equal(columnGutters(runs).length,1);assert.equal(textLines(runs).length,8);
});
test('short author names stay in main-column order instead of forming another column',()=>{
 const {sectionDocument}=require('../core/pdf-layout.js');
 const b=(id,text,x,y,width=350,kind='body')=>({id,text,translation:text,x,y,width,height:16,fontSize:12,kind});
 const model=sectionDocument([{width:800,height:1000,blocks:[b('a','Jane Doe',260,100,60),b('b','John Roe',350,100,60),b('c','Affiliations and departments',260,130),b('d','Abstract',260,180,120,'heading'),b('e','Body of the abstract',260,210)]}],'hash');
 assert.deepEqual(model.nodes.map(n=>n.id),['a','b','c','d','e']);
});

test('translation typography subtracts half a PDF point and retains role-specific leading',()=>{
 const {pageTypography,typographyCss}=require('../core/pdf-layout.js');
 const base={id:'b',text:'A body paragraph.',translation:'본문',x:40,y:40,width:300,height:100,fontSize:9,kind:'body'};
 const page={width:800,height:1000,blocks:[base,{...base,id:'b2',fontSize:20},{...base,id:'n',kind:'footnote'},{...base,id:'t',kind:'table'},{...base,id:'tc',kind:'caption',text:'Table 1. Measurements.'},{...base,id:'fc',kind:'caption',text:'Figure 1. Results.'},{...base,id:'a',kind:'annotation'}]};
 const styled=pageTypography(page);
 assert.equal(styled[0].fontSize,9-2/3);assert.equal(styled[1].fontSize,20-2/3);assert.equal(styled[0].lineHeight,1.55);
 assert.equal(styled[2].fontSize,9-2/3);assert.equal(styled[2].lineHeight,1.4);
 assert.equal(styled[3].fontSize,9-2/3);assert.equal(styled[4].typographyRole,'table-caption');assert.equal(styled[5].typographyRole,'figure-caption');assert.equal(styled[5].lineHeight,1.45);
 assert.equal(styled[6].fontSize,9-2/3);assert.match(typographyCss(),/data-typography="body"/);
});
test('print plan keeps unsafe backgrounds as source while retaining translation for continuation',()=>{
 const {applyLayoutPlan}=require('../desktop/translation.cjs'),page=pageAt(1);page.blocks[0].translation='뒤 페이지에 이어지는 번역';
 const block={...page.blocks[0],sourceIds:[page.blocks[0].id],preserveSource:true};
 const planned=applyLayoutPlan([page],[{...page,blocks:[block]}]);
 assert.equal(planned[0].blocks[0].preserveSource,true);
 const html=exportHtml(planned,['data:image/png;base64,aA==']);
 assert.match(html,/data-preserve-source="true"/);assert.match(html,/뒤 페이지에 이어지는 번역/);assert.match(html,/data-typography="body"/);assert.match(html,/--type-size:11\.333/);
});

test('mixed mathematical prose is translated while equations remain source-only',async t=>{
 const {layoutBlocks,paragraphs}=require('../core/pdf-layout.js');
 const input=pageAt(1),base=input.blocks[0];
 input.blocks=[
  {...base,text:'We set α to 0.05 and evaluate the model.'},
  {...base,id:'identifier',y:100,text:'The file model_name is used for evaluation.'},
  {...base,id:'equation',y:180,text:'x = y + 1',kind:'formula'}
 ];
 const plan=layoutBlocks(input);
 assert.deepEqual(plan.map(b=>b.sourceOnly),[false,false,true]);
 // Sparse inline symbols are translated in place; the source stays only for dense math.
 assert.deepEqual(plan.map(b=>b.preserveSource),[false,false,false]);
 // A sentence of eight or more words is translated with its inline math;
 // only near-formula text (a quarter of the letters are symbols) keeps the source.
 assert.equal(layoutBlocks({...input,blocks:[{...base,text:'We define the score as f(x)=α^2+β_1 where x=y and z=w for every sample.'}]})[0].preserveSource,false);
 assert.equal(layoutBlocks({...input,blocks:[{...base,text:'Let α=β^2+γ_1, δ=ε^2, θ=λ_1+μ_2, ν=ξ^3, ρ=σ_4 and τ=φ^2 with χ=ψ_5 where ω=π_6 for each case here.'}]})[0].preserveSource,true);
 const f=await fixture(t),sent=[],jobs=new TranslationJobs(authFor(async(_m,blocks)=>{sent.push(...blocks.map(b=>b.text));return translated(blocks,'모형을 평가하는 번역문입니다.');}));
 const job=await jobs.start(f.library,f.paperId,f.hash,[input],'model');await until(()=>jobs.result(job.id).state==='completed');
 assert.deepEqual(sent,input.blocks.slice(0,2).map(b=>b.text));
 const record=await jobs.cached(f.library,f.paperId);
 assert.equal(record.pages[0].blocks[0].translation,'모형을 평가하는 번역문입니다.');
 assert.equal(record.pages[0].blocks[0].preserveSource,false);
 assert.equal(record.pages[0].blocks[2].translation,'x = y + 1');
 const html=exportHtml(record.pages,['data:image/png;base64,aA==']);
 assert.match(html,/data-preserve-source="false"/);assert.match(html,/모형을 평가하는 번역문입니다/);
 assert.match(exportHtml(record.pages,[],'reading'),/모형을 평가하는 번역문입니다/);
 const extracted=paragraphs([{text:input.blocks[0].text,x:20,y:20,width:300,height:16,fontSize:12,baseline:32}],600,800,1);
 assert.equal(extracted[0].kind,'body');
});
test('missing cached abstract text cannot be saved as an empty translation mask',()=>{
 const page=pageAt(1);page.blocks[0].text='The abstract explains our research results.';page.blocks[0].translation='  ';
 for(const mode of ['layout','reading'])assert.throws(()=>exportHtml([page],['data:image/png;base64,aA=='],mode),/1페이지.*번역되지 않은 문단 1개/);
 page.blocks[0].text='x = y + 1';page.blocks[0].kind='formula';
 assert.doesNotThrow(()=>exportHtml([page],['data:image/png;base64,aA==']));
});


test('incomplete responses retry without publishing a partially translated page',async t=>{
 const f=await fixture(t);let calls=0;
 const jobs=new TranslationJobs(authFor(async(_m,blocks)=>++calls===1?[]:translated(blocks,'완전한 번역')));
 const job=await jobs.start(f.library,f.paperId,f.hash,pages(),'model');
 await until(()=>jobs.result(job.id).state!=='running');
 assert.equal(jobs.result(job.id).state,'completed');assert.equal(calls,2);
 assert.equal(jobs.result(job.id).metrics.retries,1);
 assert.equal((await jobs.cached(f.library,f.paperId)).pages[0].blocks[0].translation,'완전한 번역');
});
test('malformed GPT JSON retries through the existing provider',async t=>{
 const f=await fixture(t);let calls=0;
 const jobs=new TranslationJobs(authFor(async(_m,blocks)=>{if(++calls===1)throw Object.assign(Error('번역 결과 형식이 잘못됐습니다. 다시 시도하세요.'),{code:'APP_REPLY_INVALID',kind:'format'});return translated(blocks);}));
 const job=await jobs.start(f.library,f.paperId,f.hash,pages(),'model');await until(()=>jobs.result(job.id).state!=='running');
 assert.equal(jobs.result(job.id).state,'completed');assert.equal(calls,2);
});
test('long bold summary lines form prose and extraction ligatures normalize',()=>{
 const {paragraphs,normalizeParagraph,formulaOnly}=require('../core/pdf-layout.js');
 const lines=['Quantifying how microbes grow in response to stress is required', 'for effective treatment of microbial infections and food safety.'].map((text,i)=>({text,x:100,y:100+i*14,baseline:110+i*14,width:350,height:12,fontSize:12,bold:true}));
 const blocks=paragraphs(lines,600,800,1);assert.equal(blocks.length,1);assert.equal(blocks[0].kind,'body');
 assert.equal(normalizeParagraph('The ﬁtted ﬂuorescence model'), 'The fitted fluorescence model');
 assert.equal(formulaOnly({text:'The estimated growth rate � is consistent with our observations.'}),false);
 assert.equal(formulaOnly({text:'yk;rðt; p; mÞ þ zfflfflfflffl'}),true);
});

test('slightly larger summary prose is not promoted to headings by small sidebar text',()=>{
 const {paragraphs}=require('../core/pdf-layout.js');
 const line=(text,x,y,fontSize)=>({text,x,y,baseline:y+fontSize,width:300,height:fontSize,fontSize,bold:false});
 const result=paragraphs([
  ...[0,1,2].map(i=>line('Citation metadata.',10,50+i*20,10)),
  line('Quantifying how microbes grow in response to stress is required for treatment',200,200,13),
  line('of microbial infections and for understanding environmental changes.',200,217,13)
 ],600,800,1);
 const summary=result.find(b=>b.text.startsWith('Quantifying'));assert.equal(summary.kind,'body');assert.match(summary.text,/environmental changes/);
});


test('translation masks use blank column space without covering neighbours or figure rules',()=>{
 const {expandLayoutBlocks,layoutCollisions}=require('../core/pdf-layout.js');
 const width=600,height=800,data=new Uint8ClampedArray(width*height*4).fill(255);
 const block=(id,x,y,w,h,text='Text label')=>({id,text,x,y,width:w,height:h,fontSize:12,kind:'body'});
 const page={width,height,blocks:[block('label',40,40,50,14),block('next',40,110,180,20,'Long paragraph '.repeat(8)),block('other-column',240,40,280,40,'Other column '.repeat(8))]};
 const out=expandLayoutBlocks(page,{width,height,data});
 assert.equal(out[0].width,180);assert.ok(out[0].height>40);assert.ok(out[0].y+out[0].height<110);assert.equal(layoutCollisions(out).size,0);
 // Non-text graphics have no extracted block; their pixels still stop growth.
 for(let x=40;x<220;x++)data.set([0,0,0,255],(75*width+x)*4);
 const protectedOut=expandLayoutBlocks(page,{width,height,data});
 assert.ok(protectedOut[0].y+protectedOut[0].height<=75);
 assert.equal(page.blocks[0].width,50,'source cache geometry stays unchanged');
});
test('two grown boxes do not claim the same blank strip and keep each other in English',()=>{
 const {expandLayoutBlocks,layoutCollisions}=require('../core/pdf-layout.js');
 const width=600,height=400,data=new Uint8ClampedArray(width*height*4).fill(255);
 const block=(id,x,y,w,h,text,kind='body')=>({id,text,x,y,width:w,height:h,fontSize:10,kind});
 // A caption's centred last line, then the next section heading starting at the column edge.
 const page={width,height,blocks:[block('caption',40,40,360,48,'Table 1: Product formation is sensitive to the optical density '.repeat(3),'caption'),block('last-line',190,90,60,12,'interval.'),block('heading',40,116,70,14,'3. Evaluation','heading'),block('body',40,134,360,80,'The growth rate was estimated from the temperature shift. '.repeat(4))]};
 const out=expandLayoutBlocks(page,{width,height,data}),byId=Object.fromEntries(out.map(b=>[b.id,b]));
 assert.equal(layoutCollisions(out).size,0);
 assert.ok(byId['last-line'].y+byId['last-line'].height<=116,'the line stops above the heading');
 assert.ok(byId.heading.width>70,'the heading still grows into the blank column');
});
test('short runs of Unicode math letters are formulas; a symbol name in prose is not',()=>{
 const {formulaOnly}=require('../core/pdf-layout.js');
 assert.equal(formulaOnly({text:'𝐴3 − 𝑘𝑑𝐴3'}),true);
 assert.equal(formulaOnly({text:'1 𝜇max𝐾 + 𝑆 𝑋 + 𝐷(𝑆0 − 𝑆) 𝑌𝑋𝑆'}),true);
 assert.equal(formulaOnly({text:'Total biomass (𝑋biomass):'}),false);
 assert.equal(formulaOnly({text:'Estimating 𝜇max'}),false);
 assert.equal(formulaOnly({text:'and 𝑘𝑑𝐴3 respectively.'}),false);
 assert.equal(formulaOnly({text:'The adjusted estimate stayed below 0.05 while 𝑋biomass reached 4.2 g L−1 and 𝜇max = 0.31 h−1.'}),false);
});
test('shaded panel boundaries stop expansion and source font reduction has a positive floor',()=>{
 const {expandLayoutBlocks,translationFontSize}=require('../core/pdf-layout.js');
 const width=400,height=300,data=new Uint8ClampedArray(width*height*4).fill(255);
 for(let y=30;y<90;y++)for(let x=30;x<150;x++)data.set([240,240,240,255],(y*width+x)*4);
 const page={width,height,blocks:[{id:'a',text:'Summary',x:40,y:40,width:60,height:20,fontSize:12,kind:'heading'}]};
 const b=expandLayoutBlocks(page,{width,height,data})[0];
 assert.ok(b.width>60);assert.ok(b.x+b.width<=150);assert.ok(b.y+b.height<=90);
 assert.equal(translationFontSize(12),12-2/3);assert.ok(translationFontSize(.5)>0);
});

test('section structure is built before inference and chunks never mix different headings',async t=>{
 const f=await fixture(t),base=pageAt(1).blocks[0];
 const p1={width:600,height:800,blocks:[{...base,id:'h1',kind:'heading',text:'Introduction',y:40},{...base,id:'a',text:'We describe the experimental context of microbial growth.',y:110}]};
 const p2={width:600,height:800,blocks:[{...base,id:'b',text:'The same section continues on the following page.',y:40},{...base,id:'h2',kind:'subheading',text:'Results',y:160},{...base,id:'c',text:'Our results indicate a consistent response.',y:220}]};
 const calls=[],jobs=new TranslationJobs(authFor(async(_m,blocks,_s,context)=>{calls.push({blocks,context});return translated(blocks);}));
 const job=await jobs.start(f.library,f.paperId,f.hash,[p1,p2],'model');await until(()=>jobs.result(job.id).state!=='running');
 assert.equal(jobs.result(job.id).state,'completed');
 const continued=calls.find(c=>c.blocks.some(b=>b.id==='b:s0'));assert.equal(continued.context.sectionTitle,'Introduction');assert.match(continued.context.sectionText,/experimental context/);
 const results=calls.find(c=>c.blocks.some(b=>b.id==='c:s0'));assert.equal(results.context.sectionTitle,'Results');assert.ok(!results.blocks.some(b=>b.id==='b:s0'));assert.doesNotMatch(results.context.sectionText,/experimental context/);
});
test('display LaTeX bypasses inference and inline LaTeX survives byte-for-byte',async t=>{
 const f=await fixture(t),base=pageAt(1).blocks[0];
 const inline=String.raw`The model is defined by $y = \alpha x^2$ and \(z=\beta\).`;
 const equation=String.raw`\begin{align} y &= \frac{a}{b} \\ z &= \alpha \end{align}`;
 const input={width:600,height:800,blocks:[{...base,id:'inline',text:inline},{...base,id:'eq',text:equation,y:150}]};
 let calls=0,sent;
 const jobs=new TranslationJobs(authFor(async(_m,blocks)=>{calls++;sent=blocks;return blocks.map(b=>({id:b.id,text:'모형은 다음과 같이 정의됩니다. '+[...b.text.matchAll(/PAPINOTE_MATH_\w+_END/g)].map(m=>m[0]).join(' 및 ')}));}));
 const job=await jobs.start(f.library,f.paperId,f.hash,[input],'model');await until(()=>jobs.result(job.id).state!=='running');
 assert.equal(jobs.result(job.id).state,'completed');assert.equal(calls,1);assert.equal(sent.length,1);assert.doesNotMatch(sent[0].text,/\\alpha|\\beta/);
 const [a,b]=(await jobs.cached(f.library,f.paperId)).pages[0].blocks;
 assert.ok(a.translation.includes(String.raw`$y = \alpha x^2$`));assert.ok(a.translation.includes(String.raw`\(z=\beta\)`));assert.equal(b.translation,equation);assert.doesNotMatch(a.translation,/PAPINOTE_MATH_/);
});
test('missing inline formula tokens retry and cannot publish a corrupted equation',async t=>{
 const f=await fixture(t),p=pageAt(1);p.blocks[0].text=String.raw`The observed growth follows $x^2$ in our model.`;let calls=0;
 const jobs=new TranslationJobs(authFor(async(_m,blocks)=>{calls++;return translated(blocks,'수식이 누락된 번역');}));
 const job=await jobs.start(f.library,f.paperId,f.hash,[p],'model');await until(()=>jobs.result(job.id).state!=='running');
 // After three replies without the formula token the paragraph is stored as
 // untranslated; a corrupted equation is never published.
 assert.equal(jobs.result(job.id).state,'completed');assert.equal(calls,3);const stored=(await jobs.cached(f.library,f.paperId)).pages[0].blocks[0];assert.equal(stored.translation,'');assert.equal(stored.missingTranslation,true);
});
test('legacy missing sections remain visible in the canonical reading model',()=>{
 const {reconcilePage,layoutBlocks}=require('../core/pdf-layout.js'),page=pageAt(1),first=page.blocks[0];first.translation='기존 번역';
 const missing={...first,id:'missing-results',text:'Results',kind:'heading',y:200};
 const repaired=reconcilePage(page,{...page,blocks:[first,missing]});
 assert.equal(repaired.blocks.length,2);assert.ok(repaired.blocks[1].missingTranslation);assert.equal(repaired.blocks[1].translation,'');
 assert.equal(layoutBlocks(repaired)[1].sourceOnly,false);
});
test('Greek scientific headings and ordinary prose formerly marked formula remain translatable',()=>{
 const {formulaOnly,layoutBlocks,paragraphs}=require('../core/pdf-layout.js');
 assert.equal(formulaOnly({text:'β-glucosidase activity'}),false);
 assert.equal(formulaOnly({text:'We report the resulting growth rates in our experiments.',kind:'formula'}),false);
 const b={id:'p',text:'PLOS reports these experiments in the results section.',x:40,y:200,width:300,height:20,fontSize:12};
 assert.equal(layoutBlocks({width:600,height:800,blocks:[b]})[0].sourceOnly,false);
 const [h]=paragraphs([{...b,text:'2.3 Experimental setup',baseline:212}],600,800,1);assert.equal(h.kind,'heading');
 const [greek]=paragraphs([{...b,text:'β-glucosidase activity',baseline:212,bold:true}],600,800,1);assert.equal(greek.kind,'heading');
});
test('unchanged English prose retries instead of becoming a completed translation',async t=>{
 const f=await fixture(t),p=pageAt(1);p.blocks[0].text='We observed consistent growth rates across all of the experimental conditions.';let calls=0;
 const jobs=new TranslationJobs(authFor(async(_m,blocks)=>++calls===1?blocks:translated(blocks,'모든 실험 조건에서 일관된 성장률을 관찰했습니다.')));
 const job=await jobs.start(f.library,f.paperId,f.hash,[p],'model');await until(()=>jobs.result(job.id).state!=='running');
 assert.equal(jobs.result(job.id).state,'completed');assert.equal(calls,2);assert.equal(jobs.result(job.id).metrics.retries,1);
});
test('partial legacy paragraph translations remain flagged after reconciliation',()=>{
 const {reconcilePage}=require('../core/pdf-layout.js'),p=pageAt(1),first={...p.blocks[0],height:16,translation:'첫 문장 번역'},second={...p.blocks[0],id:'line2',y:38,height:16,text:'The missing second sentence.'};
 const canonical={...p,blocks:[{...first,height:34,text:first.text+' '+second.text}]};
 const repaired=reconcilePage({...p,blocks:[first,second]},canonical);
 assert.equal(repaired.blocks.length,1);assert.equal(repaired.blocks[0].missingTranslation,true);assert.match(repaired.blocks[0].translation,/첫 문장/);
 assert.throws(()=>exportHtml([repaired],[],'reading'),/번역되지 않은 문단/);
});
test('cached inline equations are verified before reuse',async t=>{
 const f=await fixture(t),p=pageAt(1);p.blocks[0].text=String.raw`The observed growth follows $x^2$ in our model.`;let calls=0;
 const jobs=new TranslationJobs(authFor(async(_m,blocks)=>{calls++;return blocks.map(b=>({id:b.id,text:'관측 성장은 '+b.text.match(/PAPINOTE_MATH_\w+_END/)[0]+'을 따릅니다.'}));}));
 async function run(){const job=await jobs.start(f.library,f.paperId,f.hash,[p],'model',{force:false});await until(()=>jobs.result(job.id).state!=='running');assert.equal(jobs.result(job.id).state,'completed');return jobs.result(job.id);}
 await run();assert.equal((await run()).metrics.cacheHits,1);assert.equal(calls,1);
 const file=jobs.file(f.library,f.paperId).replace('.json','.chunks.json'),cache=JSON.parse(await fs.readFile(file,'utf8'));
 for(const result of Object.values(cache.entries))result[0].text=result[0].text.replace('$x^2$','$x^3$');await fs.writeFile(file,JSON.stringify(cache));
 assert.equal((await run()).metrics.cacheHits,0);assert.equal(calls,2);assert.ok((await jobs.cached(f.library,f.paperId)).pages[0].blocks[0].translation.includes('$x^2$'));
});
test('short formula explanations translate while LaTeX environments remain opaque',()=>{
 const {formulaOnly,mathSpans}=require('../core/pdf-layout.js');
 for(const text of [String.raw`where $x>0$.`,String.raw`Model: \(y=x^2\)`])assert.equal(formulaOnly({text}),false,text);
 for(const name of ['equation*','alignat','cases','pmatrix']){const text=String.raw`\begin{${name}} x &= \frac{a}{b} \\ y &= \sqrt{c} \end{${name}}`;assert.equal(formulaOnly({text}),true);assert.deepEqual(mathSpans(text).map(m=>m.text),[text]);}
});

test('source paragraph style: bold field labels split, justified edges, serif class and line pitch',()=>{
 const {textLines,paragraphs,pageTypography,translationFontSize}=require('../core/pdf-layout.js');
 const run=(text,x,baseline,width,extra={})=>({text,x,baseline,y:baseline-9,fontSize:9,width,height:11,...extra});
 const lines=textLines([
  run('Citation:',40,400,30,{heavy:true}),run('Doe J, Roe J (2020) A model.',72,400,100),
  run('PLoS Comput Biol 16.',40,412,80),
  run('Received:',40,424,32,{heavy:true}),run('January 16, 2020',74,424,60),
  ...[0,1,2,3].map(i=>run(i<3?'Justified serif body text line number '+i:'Last line.',200,400+i*14,i<3?300:60,{serif:true}))
 ]);
 assert.equal(lines.find(l=>l.text.startsWith('Received')).bold,false);
 const blocks=paragraphs(lines,600,800,1),by=t=>blocks.find(b=>b.text.startsWith(t));
 assert.ok(by('Citation:').text.includes('PLoS Comput Biol'));
 assert.equal(by('Received:').text,'Received: January 16, 2020');assert.equal(by('Received:').label,'field');assert.notEqual(by('Received:').kind,'heading');
 const body=by('Justified');assert.equal(body.serif,true);assert.equal(body.align,'justify');assert.equal(body.linePitch,14);
 assert.equal(by('Citation:').serif,false);assert.equal(by('Citation:').align,'start');
 const styled=pageTypography({width:600,height:800,blocks:[{...body,fitScale:.9},{...body,id:'b',fitScale:.2}]});
 assert.ok(Math.abs(styled[0].lineHeight-14/translationFontSize(9))<1e-9);
 assert.ok(Math.abs(styled[0].fontSize-translationFontSize(9)*.9)<1e-9);assert.ok(Math.abs(styled[1].fontSize-translationFontSize(9)*.65)<1e-9);
});
test('layout plan and export keep source style, bold labels and escape label text',()=>{
 const {applyLayoutPlan}=require('../desktop/translation.cjs'),page=pageAt(1);page.blocks[0].translation='접수일<b>: 2020년';
 const block={...page.blocks[0],sourceIds:[page.blocks[0].id],serif:true,align:'justify',label:true,linePitch:14,fitScale:.9};
 const planned=applyLayoutPlan([page],[{width:600,height:800,blocks:[block]}]);
 assert.deepEqual([planned[0].blocks[0].serif,planned[0].blocks[0].align,planned[0].blocks[0].label,planned[0].blocks[0].linePitch],[true,'justify','field',14]);
 const html=exportHtml(planned,['data:image/png;base64,aA==']);
 assert.match(html,/data-serif="true" data-heavy="false" data-align="justify" data-label="field"/);assert.match(html,/<strong>접수일&lt;b&gt;:<\/strong> 2020년/);assert.match(html,/--type-leading:1\.\d+/);
 assert.equal(applyLayoutPlan([page],[{width:600,height:800,blocks:[{...block,align:'<x>',linePitch:'9'}]}])[0].blocks[0].align,'start');
});

test('methods prose with inline units and strain names translates in place',()=>{
 const {layoutBlocks,mathDense}=require('../core/pdf-layout.js');
 const text='H. salinarum NRC-1 Δura3 control strain were grown at 42°C to an optical density at 600 nm (OD600) ~1.8–2.0 in 3 mL of Complete Medium supplemented with uracil (50 μg/ml). These starter cultures were diluted to OD600 ~0.05 in 200 μl CM then transferred in triplicate into individual wells of a microplate.';
 assert.equal(mathDense(text),false);assert.equal(mathDense('Broken glyph \u0001 in text'),false);assert.equal(mathDense('Broken \u0001 glyph \u0002 text \u0003 here'),true);
 const [block]=layoutBlocks({width:600,height:800,blocks:[{id:'m',text,x:100,y:100,width:400,height:120,fontSize:13,kind:'body'}]});
 assert.equal(block.sourceOnly,false);assert.equal(block.preserveSource,false);
});
test('stray source-only glyph fragments inside a paragraph are not layout collisions',()=>{
 const {layoutBlocks,layoutCollisions}=require('../core/pdf-layout.js');
 const blocks=layoutBlocks({width:600,height:800,blocks:[
  {id:'p',text:'A GP is fully defined by a mean function and a covariance function for every input.',x:100,y:100,width:400,height:60,fontSize:13,kind:'body'},
  {id:'hat',text:'ˆ',x:300,y:118,width:6,height:6,fontSize:9,kind:'body'},
  {id:'q',text:'Another paragraph overlaps the first one by mistake in this layout.',x:100,y:120,width:400,height:40,fontSize:13,kind:'body'}]});
 assert.equal(blocks.find(b=>b.id==='hat').sourceOnly,true);
 assert.deepEqual([...layoutCollisions(blocks)].sort(),['p','q']);
 assert.deepEqual([...layoutCollisions(blocks.filter(b=>b.id!=='q'))],[]);
 // A few pixels of overlap (raised superscripts, descenders) is trimmed, not a collision.
 const near=layoutBlocks({width:600,height:800,blocks:[{id:'a',text:'The upper paragraph ends with a descender that reaches down.',x:100,y:100,width:400,height:60,fontSize:13,kind:'body'},{id:'b',text:'The lower paragraph starts with raised superscript citation markers.',x:100,y:154,width:400,height:40,fontSize:13,kind:'body'}]});
 assert.equal(near.find(b=>b.id==='a').height,54);assert.deepEqual([...layoutCollisions(near)],[]);
});

test('paragraphs broken by a column or page are translated once and shared back over their boxes',async t=>{
 const {structureTranslationPages,applyFlow,splitShares}=require('../core/pdf-layout.js');
 const f=await fixture(t),block=(id,text,x,y,extra={})=>({id,text,x,y,width:240,height:60,fontSize:12,kind:'body',...extra});
 const p1={width:600,height:800,blocks:[block('h','Methods',40,40,{kind:'heading',height:16}),block('a','Growth was measured every thirty minutes and optical density was log',40,600),block('c','Each experiment included replicates and the data were',320,80),block('d','normalised before analysis.',320,700)]};
 const p2={width:600,height:800,blocks:[block('b','transformed before the hierarchical model was fitted to every curve.',40,40),block('e','Results are shown below.',40,200),block('f','The model identified batch effects.',40,300)]};
 const structured=structureTranslationPages([p1,p2],'hash');
 const by=id=>structured.flatMap(p=>p.blocks).find(b=>b.id===id);
 // Column break (a → c? no: a ends mid-sentence but c starts upper case) and page break.
 assert.deepEqual(by('c').flowIds,['d']);assert.equal(by('d').flowHead,'c');
 assert.equal(by('a').flowIds,undefined);assert.equal(by('e').flowHead,undefined);assert.equal(by('f').flowHead,undefined);
 const sent=[],jobs=new TranslationJobs(authFor(async(_m,blocks)=>{sent.push(...blocks);return blocks.map(b=>({id:b.id,text:b.id.startsWith('c:')?'각 실험에는 반복이 포함되었으며 자료는 분석 전에 정규화되었습니다.':'번역된 문장입니다.'}));}));
 const job=await jobs.start(f.library,f.paperId,f.hash,[p1,p2],'model');await until(()=>jobs.result(job.id).state!=='running');
 assert.equal(jobs.result(job.id).state,'completed');
 assert.equal(sent.find(b=>b.id==='c:s0').text,'Each experiment included replicates and the data were normalised before analysis.');assert.ok(!sent.some(b=>b.id.startsWith('d:')));
 const raw=(await jobs.cached(f.library,f.paperId)).pages,flowed=applyFlow(raw),c=flowed[0].blocks.find(b=>b.id==='c'),d=flowed[0].blocks.find(b=>b.id==='d');
 assert.equal(raw[0].blocks.find(b=>b.id==='d').translation,'');assert.ok(c.translation&&d.translation);
 assert.equal((c.translation+d.translation).replace(/\s/g,''),'각실험에는반복이포함되었으며자료는분석전에정규화되었습니다.');
 // Re-applying (renderer after main) and a re-translated raw head never duplicate text.
 assert.deepEqual(applyFlow(flowed),flowed);
 const retranslated=flowed.map(p=>({...p,blocks:p.blocks.map(b=>b.id==='c'?{...b,translation:'새 번역 문장입니다 그리고 이어집니다.',flowFull:undefined}:b)}));
 assert.equal(applyFlow(retranslated)[0].blocks.filter(b=>['c','d'].includes(b.id)).map(b=>b.translation).join(' ').replace(/\s/g,''),'새번역문장입니다그리고이어집니다.');
 assert.doesNotThrow(()=>exportHtml(flowed,['data:image/png;base64,aA==','data:image/png;base64,aA==']));
 for(const text of ['가 나 다 라 마 바 사','하나의긴문장','a b']){const parts=splitShares(text,[3,1,2]);assert.equal(parts.length,3);assert.equal(parts.join('').replace(/\s/g,''),text.replace(/\s/g,''));}
});
test('page break continuation chains across pages; terminal punctuation and new sections end a chain',()=>{
 const {structureTranslationPages}=require('../core/pdf-layout.js'),block=(id,text,y,extra={})=>({id,text,x:40,y,width:500,height:60,fontSize:12,kind:'body',...extra});
 const p1={width:600,height:800,blocks:[block('a','The posterior distribution indicates that technical variation accounts for',600),block('n','12',780,{width:20,height:10,kind:'footnote'})]};
 const p2={width:600,height:800,blocks:[block('b','a substantial fraction of the observed differences.',60),block('c','Ends here.',200),block('x','continues with lower case after a full stop.',300),block('h','Discussion',400,{kind:'heading',height:16}),block('y','lower case after a heading starts a new section.',430)]};
 const [s1,s2]=structureTranslationPages([p1,p2],'hash');
 assert.deepEqual(s1.blocks.find(b=>b.id==='a').flowIds,['b']);assert.match(s1.blocks.find(b=>b.id==='a').flowText,/accounts for a substantial fraction/);
 assert.equal(s2.blocks.find(b=>b.id==='x').flowHead,undefined);assert.equal(s2.blocks.find(b=>b.id==='y').flowHead,undefined);
});
test('figure labels keep their source and captions keep a bold title',()=>{
 const {layoutBlocks,emphasis}=require('../core/pdf-layout.js'),block=(id,text,x,y,w=300,h=14)=>({id,text,x,y,width:w,height:h,fontSize:12,kind:'body'});
 const page={width:800,height:1000,blocks:[block('p','A long paragraph of prose that sits above the figure and explains the experiment in considerable detail for readers.',100,100,600,60),block('ax','Time (h)',380,560,60),block('ay','OD600',110,400,40),block('cap','Fig 2. Estimated growth curves under oxidative stress. Lines show posterior means.',100,600,600,30),block('wide','A short paragraph line',100,200,400)]};
 const out=layoutBlocks(page),src=id=>out.find(b=>b.id===id).sourceOnly;
 assert.equal(src('ax'),true);assert.equal(src('ay'),true);assert.equal(src('wide'),false);assert.equal(src('p'),false);assert.equal(src('cap'),false);
 assert.deepEqual(emphasis('그림 2. 산화 스트레스에서 추정한 성장 곡선. 선은 사후 평균입니다.','caption-sentence'),['그림 2. 산화 스트레스에서 추정한 성장 곡선.',' 선은 사후 평균입니다.']);
 assert.deepEqual(emphasis('그림 2. 성장 곡선','caption-prefix'),['그림 2.',' 성장 곡선']);
 assert.deepEqual(emphasis('접수일: 2020년 1월 16일',true),['접수일:',' 2020년 1월 16일']);
 assert.equal(emphasis('일반 문장입니다.','caption-sentence'),null);
});
test('page re-translation keeps a chain only when the stored pages agree with it',()=>{
 const jobs=new TranslationJobs(authFor(async()=>[]));
 // Old cache: head on page 1 has no chain, so a page-2 member is translated on its own.
 const member={width:600,height:800,blocks:[{id:'b',text:'transformed before fitting.',flowHead:'a'}]};
 jobs.keepChains({output:[{blocks:[{id:'a',translation:'이전 번역'}]},null],targets:new Set([2])},member);assert.equal(member.blocks[0].flowHead,undefined);
 // Old cache: member on page 2 has its own translation, so the page-1 head is not joined.
 const head={width:600,height:800,blocks:[{id:'a',text:'was log',flowIds:['b'],flowText:'was log transformed before fitting.'}]};
 jobs.keepChains({output:[null,{blocks:[{id:'b',translation:'변환했다.'}]}],targets:new Set([1])},head);assert.equal(head.blocks[0].flowIds,undefined);assert.equal(head.blocks[0].flowText,undefined);
 // Consistent stored chain, or every page in the job: the chain stays.
 const kept={width:600,height:800,blocks:[{id:'b',text:'transformed.',flowHead:'a'}]};
 jobs.keepChains({output:[{blocks:[{id:'a',flowIds:['b']}]},null],targets:new Set([2])},kept);assert.equal(kept.blocks[0].flowHead,'a');
 const full={width:600,height:800,blocks:[{id:'a',flowIds:['b'],flowText:'x'}]};
 jobs.keepChains({output:[null,null],targets:new Set([1,2])},full);assert.deepEqual(full.blocks[0].flowIds,['b']);
});
test('table cells, formula pieces and in-column headings are not treated as prose flow',()=>{
 const {structureTranslationPages,layoutBlocks,layoutCollisions,expandLayoutBlocks}=require('../core/pdf-layout.js');
 const cell=(id,text,x,y,w=110)=>({id,text,x,y,width:w,height:14,fontSize:12,kind:'body'});
 const table={width:800,height:1000,blocks:[cell('h1','model',100,100),cell('h2','likelihood',230,100),cell('h3','parameters',360,100),cell('r1','log-normal growth',100,120)]};
 assert.ok(structureTranslationPages([table],'hash')[0].blocks.every(b=>!b.flowIds&&!b.flowHead));
 const blocks=layoutBlocks({width:600,height:800,blocks:[{id:'p',text:'The likelihood of the observations follows the model defined below for every curve.',x:100,y:100,width:400,height:60,fontSize:13,kind:'body'},{id:'eq',text:'x = y + 1',x:250,y:120,width:60,height:14,fontSize:12,kind:'formula'}]});
 assert.equal(blocks.find(b=>b.id==='eq').sourceOnly,true);assert.deepEqual([...layoutCollisions(blocks)],['p'],'a formula piece inside a paragraph still keeps the source visible');
 const width=800,height=600,pixels={width,height,data:new Uint8ClampedArray(width*height*4).fill(255)},long='This column paragraph is long enough to define the left text column width for the page layout.';
 const page={width,height,blocks:[{id:'title',text:'Hierarchical models for growth curve analysis',x:60,y:40,width:440,height:24,fontSize:20,kind:'heading'},{id:'h',text:'2.1 Data analysis',x:60,y:100,width:120,height:16,fontSize:13,kind:'heading'},{id:'l',text:long,x:60,y:130,width:320,height:200,fontSize:12,kind:'body'},{id:'r',text:long,x:420,y:130,width:320,height:200,fontSize:12,kind:'body'}]};
 const out=expandLayoutBlocks(page,pixels),by=id=>out.find(b=>b.id===id);
 assert.ok(by('h').x+by('h').width<=380+1,'a left-column heading stays out of the gutter');
 assert.ok(by('title').x+by('title').width>500,'a spanning title widens over the text area');
});

test('translation masks cover source ink just outside the box but never rules or neighbours',()=>{
 const {maskPads,sameAsSource,backgroundSample}=require('../core/pdf-layout.js');
 const width=400,height=300,data=new Uint8ClampedArray(width*height*4).fill(255),dot=(x,y)=>data.set([20,20,20,255],(y*width+x)*4);
 for(let x=60;x<80;x++)dot(x,97);          // glyph tops 3px above the box
 for(let x=0;x<width;x++)dot(x,163);       // a full-width rule 3px below the box
 for(let y=110;y<120;y++)dot(42,y);        // overhang 2px left of the box
 const page={width,height,blocks:[{id:'p',text:'paragraph',x:44,y:100,width:200,height:60,fontSize:12},{id:'n',text:'neighbour',x:44,y:20,width:200,height:74,fontSize:12}]};
 const pad=maskPads(page,page.blocks,{width,height,data}).find(b=>b.id==='p').maskPad;
 assert.ok(pad.top>=3&&pad.top<6,'top reaches the glyph ink and stops before the masked neighbour');
 const formula={...page,blocks:[page.blocks[0],{...page.blocks[1],sourceOnly:true}]};
 assert.ok(maskPads(formula,formula.blocks,{width,height,data}).find(b=>b.id==='p').maskPad.top<=3,'a source-only neighbour keeps its half of the gap visible');
 assert.ok(pad.bottom<=1,'a rule line is not masked');assert.ok(pad.left>=2);assert.ok(pad.right<=1);
 assert.equal(sameAsSource('Peter D. Tonner1,2¤, Cynthia L. DarnellID2, Amy K. Schmid','Peter D. Tonner, Cynthia L. Darnell, Amy K. Schmid'),true);
 assert.equal(sameAsSource('Received: January 16, 2020','접수일: 2020년 1월 16일'),false);assert.equal(sameAsSource('A long English sentence here.','Short'),false);
 // Dense grey anti-aliasing over white is foreground, not a mixed background.
 const aa=new Uint8ClampedArray(64*32*4).fill(255);for(let i=0;i<64*32;i++){const v=i%5===0?40:i%5===1?140+(i%7)*12:255;aa.set([v,v,v,255],i*4);}
 assert.equal(backgroundSample({width:64,height:32,data:aa},{x:0,y:0,width:64,height:32}).safe,true);
 const photo=new Uint8ClampedArray(64*32*4);for(let i=0;i<64*32;i++)photo.set([180+(i*37)%70,160+(i*53)%90,150+(i*29)%100,255],i*4);
 assert.equal(backgroundSample({width:64,height:32,data:photo},{x:0,y:0,width:64,height:32}).safe,false);
});

test('publisher math-font glyphs are repaired so prose with inline math translates in place',()=>{
 const {repairGlyphs,mathDense,layoutBlocks,normalizeParagraph,textLines}=require('../core/pdf-layout.js');
 const gp='Gaussian processes. A Gaussian process (GP) defines a non-parametric distribution over functions f ðtÞ, defined by the property that any finite set of observations of f follow a multivariate normal distribution [53]. A GP is fully defined by a mean function ^f ðtÞ and a covariance function κðt; t0Þ (Eq (1)):';
 assert.equal(repairGlyphs('functions f ðtÞ and y ¼ a þ b with À1'),'functions f (t) and y = a + b with −1');
 assert.match(repairGlyphs(gp),/mean function f\u0302 \(t\)/);assert.doesNotMatch(repairGlyphs(gp),/[ðÞ]/);
 assert.equal(repairGlyphs('diluted to OD600 \uFFFD0.05 in 200 μl'),'diluted to OD600 ∼0.05 in 200 μl');
 assert.equal(repairGlyphs('Þórarinsson and Iceland are untouched without a pair'),'Þórarinsson and Iceland are untouched without a pair');
 assert.equal(repairGlyphs('the value x^2 stays'),'the value x^2 stays');
 assert.equal(mathDense(gp),false);assert.equal(normalizeParagraph('to OD600 \uFFFD1.8–2.0 in'),'to OD600 ∼1.8–2.0 in');
 const [block]=layoutBlocks({width:600,height:800,blocks:[{id:'g',text:gp,x:100,y:100,width:400,height:80,fontSize:13,kind:'body'}]});
 assert.equal(block.sourceOnly,false);assert.equal(block.preserveSource,false);
 // A larger, shifted math glyph no longer seeds its own line and splits the physical line.
 const run=(text,x,baseline,fontSize,width)=>({text,x,baseline,y:baseline-fontSize,fontSize,width,height:fontSize*1.2});
 const lines=textLines([run('supplemented with uracil (50 ',100,200,10,120),run('μ',220,201.5,12,6),run('g/ml). These starter cultures were diluted to OD',226,200,10,200),run('\uFFFD',428,198,13,8),run('0.05 in',437,200,10,30)]);
 assert.equal(lines.length,1);assert.match(lines[0].text,/uracil \(50 ?μ ?g\/ml\)\. These starter cultures/);
 // A paragraph's last line with mis-encoded inline math stays in the paragraph.
 const {paragraphs}=require('../core/pdf-layout.js'),line=(text,y)=>({text,x:100,y,width:400,height:12,fontSize:12,baseline:y+10});
 const merged=paragraphs([line('The posterior distribution of the batch variance indicates a substantial fraction of the',100),line('observed differences, with a mean function ^f ðtÞ estimated at \uFFFD0.05 per hour.',115)],600,800,1);
 const {repairPages}=require('../core/pdf-layout.js');assert.equal(repairPages([{width:1,height:1,blocks:[{id:'a',text:'x',translation:'평균 함수 ^f ðtÞ는 �0.05입니다.'}]},null])[0].blocks[0].translation,'평균 함수 f\u0302 (t)는 ∼0.05입니다.');
 assert.equal(merged.length,1);assert.equal(merged[0].kind,'body');assert.match(merged[0].text,/f\u0302 \(t\) estimated at ∼0\.05/);
});
test('nested math-font parentheses, operator tildes and encoded equations are classified correctly',()=>{
 const {repairGlyphs,repairMath,mathDense,formulaOnly,layoutBlocks}=require('../core/pdf-layout.js');
 const where='Where mðtÞ � GPð0; kmðt; t0ÞÞ provides a prior distribution over m, and km is an RBF kernel with hyperparameters fs2 m; ‘mg. Here rðtÞ � Nð0; s2 r IÞ is Gaussian white noise. The model then becomes (Eq (4)):';
 assert.match(repairGlyphs(where),/^Where m\(t\) ∼ GP\(0, km\(t, t′\)\) provides/);assert.match(repairGlyphs(where),/Here r\(t\) ∼ N\(0, s2 r I\) is/);
 // Math-font braces, bound chains and primes; translations that copied them are repaired too.
 assert.match(repairGlyphs(where),/hyperparameters \{s2 m, ‘m\}\. Here/);
 assert.equal(repairGlyphs('by modeling each replicate yrðtÞ for 1 \uFFFD r \uFFFD R as consisting of'),'by modeling each replicate yr(t) for 1 ≤ r ≤ R as consisting of');
 assert.equal(repairMath("여기서 δ(t) \uFFFD GP(0, κδ(t, t0)) 역시, κδ는 fs2d; 'dg를 갖고 yr(t)(1 \uFFFD r \uFFFD R)와 N(0; s2y I)를 쓴다.",true),"여기서 δ(t) ∼ GP(0, κδ(t, t0)) 역시, κδ는 {s2d, 'd}를 갖고 yr(t)(1 ≤ r ≤ R)와 N(0, s2y I)를 쓴다.");
 for(const text of ['(Smith 2010; Lee 2012) and for i; big dogs','see Fig 2; Table 1 for n; log n'])assert.equal(repairMath(text,true),text,text);
 // Extraction may drop the spaces around the lost sign; ε before a subscript ("\uFFFDk,r") stays.
 assert.equal(repairGlyphs('replicate yrðtÞ for 1\uFFFDr\uFFFDR and dðtÞ\uFFFDGPð0; kdðt; t0ÞÞ with error \uFFFDk,r here'),'replicate yr(t) for 1 ≤ r ≤ R and d(t) ∼ GP(0, kd(t, t′)) with error \uFFFDk,r here');
 assert.equal(mathDense(where),false);assert.equal(formulaOnly({text:where,kind:'body'}),false);
 assert.equal(repairGlyphs('a value � b without a math font context'),'a value � b without a math font context');
 for(const eq of ['yrðt; p; mÞ ¼ mðtÞ þ apðtÞ þ bcðtÞ þ ðabÞp;cðtÞ þ rðtÞ;','apðtÞ � GPð0; kaðt; t0ÞÞ','σ²batch = Var(βb) / (Var(βb) + σ²)','κ(t, t′) = σ² · exp(−|t − t′|²/ℓ)'])assert.equal(formulaOnly({text:eq,kind:'body'}),true,eq);
 assert.equal(formulaOnly({text:'function ^f ðtÞ estimated at �0.05 per hour.',kind:'body'}),false,'a short prose line with inline math is prose');
 // Math-heavy prose up to 8% symbols per letter is translated in place.
 const blocks=layoutBlocks({width:600,height:800,blocks:[{id:'m',text:'for pH p and molar acid concentration c, with αp(t) representing the main effect of pH, βc(t) the main effect of acid concentration, and (αβ)p,c(t) the interaction between them, where σ² is the variance.',x:100,y:100,width:400,height:60,fontSize:13,kind:'body'}]});
 assert.equal(blocks[0].preserveSource,false);assert.equal(mathDense('Let α = β^2 + γ_1 and δ = ε where x = y and z = w for all θ.'),true);
});
test('paragraph breaks follow first-line indents and bold run-in headings, and indents are kept',()=>{
 const {paragraphs,emphasis}=require('../core/pdf-layout.js');
 const line=(text,x,y,width=480,extra={})=>({text,x,y,width,height:12,fontSize:12,baseline:y+10,...extra});
 const blocks=paragraphs([
  line('similarly, with each fixed effect becoming a mean of a GP prior for each batch',100,100),
  line('effect.',100,115,40),
  line('Mfull develops the hierarchy one step deeper by adding replicate effects to Mbatch.',112,130,468),
  line('Specifically, the error model is now described by a GP with corresponding',100,145),
  line('hyperparameters, accounting for replicate-specific variability rather than simply',100,160),
  line('white noise.',100,175,60),
  line('Bayesian inference. The unknown functions, kernel hyperparameters for each group',112,190,468,{startsBold:true,boldPrefix:20}),
  line('of latent functions, and observation noise parameters are all estimated.',100,205),
  // A hanging indent (reference list) is one entry, not two paragraphs.
  line('1. Doe J, Roe R. A very long reference title that fills the whole line width.',100,260),
  line('PLoS Comput Biol. 2020; 16: e1008366.',112,275,300)
 ],800,1000,1);
 assert.deepEqual(blocks.map(b=>b.text.slice(0,18)),['similarly, with ea','Mfull develops the','Bayesian inference','1. Doe J, Roe R. A']);
 assert.ok(Math.abs(blocks[1].indent-12)<.01);assert.equal(blocks[0].indent,undefined);
 assert.equal(blocks[2].label,'runin');assert.deepEqual(emphasis('베이지안 추론. 미지 함수와 커널 초매개변수는','runin'),['베이지안 추론.',' 미지 함수와 커널 초매개변수는']);
 // "Table 1 summarises …" is prose; a caption carries label punctuation.
 const kinds=paragraphs([line('Table 1 summarises the comparison of all models across every batch.',100,100),line('Table 1. Predictive performance of growth models.',100,140)],800,1000,1).map(b=>b.kind);
 assert.deepEqual(kinds,['body','caption']);
});
test('streamed paragraphs are published before their request completes, then replaced by the validated result',async t=>{
 const f=await fixture(t),base=pageAt(1).blocks[0];let release;
 const input={width:600,height:800,blocks:[{...base,id:'a',text:'The first paragraph describes the experiment and its aims in detail.',y:40},{...base,id:'b',text:'The second paragraph reports the measured growth rates for each strain.',y:200}]};
 const jobs=new TranslationJobs(authFor(async(_m,blocks,_s,_c,onUnit)=>{onUnit(blocks[0].id,'첫 번째 문단 번역입니다.');await new Promise(r=>release=r);return blocks.map((b,i)=>({id:b.id,text:i?'두 번째 문단 번역입니다.':'첫 번째 문단의 최종 번역입니다.'}));}));
 const job=await jobs.start(f.library,f.paperId,f.hash,[input],'model');
 await until(()=>jobs.result(job.id).record?.pages?.[0]);
 const partial=jobs.result(job.id).record.pages[0];
 assert.equal(partial.partial,true);assert.equal(partial.blocks[0].translation,'첫 번째 문단 번역입니다.');assert.equal(partial.blocks[1].pending,true);assert.equal(partial.blocks[1].translation,'');
 assert.equal(jobs.jobs.get(job.id).readyPages,0);
 release();await until(()=>jobs.result(job.id).state==='completed');
 const done=jobs.result(job.id).record.pages[0];assert.equal(done.partial,undefined);assert.deepEqual(done.blocks.map(b=>b.translation),['첫 번째 문단의 최종 번역입니다.','두 번째 문단 번역입니다.']);assert.ok(done.blocks.every(b=>!b.pending));
});
test('a reply that keeps long prose in English is retried; references may stay English',async t=>{
 const f=await fixture(t),base=pageAt(1).blocks[0];let calls=0;
 const text='We grew the cultures in the plate reader and the growth of each strain was recorded for the whole experiment.';
 const jobs=new TranslationJobs(authFor(async(_m,blocks)=>{calls++;return blocks.map(b=>({id:b.id,text:calls<2?b.text.replace('We grew','we grew'):'배양물을 판독기에서 키우고 균주별 성장을 기록했습니다.'}));}));
 const job=await jobs.start(f.library,f.paperId,f.hash,[{width:600,height:800,blocks:[{...base,id:'a',text}]}],'model');await until(()=>jobs.result(job.id).state!=='running');
 assert.equal(jobs.result(job.id).state,'completed');assert.equal(calls,2);
 const {markSame}=require('../core/pdf-layout.js');
 const [english]=markSame([{id:'x',text,translation:text}]);assert.equal(english.englishOnly,true);assert.equal(english.sameAsSource,undefined);
 const [names]=markSame([{id:'y',text:'Peter D. Tonner, Cynthia L. Darnell',translation:'Peter D. Tonner, Cynthia L. Darnell'}]);assert.equal(names.sameAsSource,true);
});

test('a failing reply keeps its valid paragraphs and the ones streamed before it failed, and asks again only for the failed one',async t=>{
 const f=await fixture(t),base=pageAt(1).blocks[0];const asked=[];
 const input={width:600,height:800,blocks:[{...base,id:'a',text:'The first paragraph explains the culture conditions in the experiment.',y:40},{...base,id:'b',text:'The second paragraph is the one that the model keeps answering in plain English text for every request.',y:200},{...base,id:'c',text:'The third paragraph describes the statistical analysis used for growth.',y:360}]};
 // "c" only streams before the reply breaks; "b" always comes back in English.
 const jobs=new TranslationJobs(authFor(async(_m,blocks,_s,_c,onUnit)=>{asked.push(blocks.map(b=>b.id[0]).join(''));const out=[];for(const b of blocks){if(b.id.startsWith('c')){onUnit?.(b.id,'셋째 문단 번역입니다.');continue;}out.push({id:b.id,text:b.id.startsWith('a')?'첫째 문단 번역입니다.':b.text});}return out;}));
 const job=await jobs.start(f.library,f.paperId,f.hash,[input],'model');await until(()=>jobs.result(job.id).state!=='running');
 assert.deepEqual(asked,['abc','b','b'],'only the failed paragraph is asked again, twice');assert.equal(jobs.result(job.id).state,'completed');
 assert.deepEqual(jobs.result(job.id).metrics.invalid,{english:3});
 const blocks=(await jobs.cached(f.library,f.paperId)).pages[0].blocks;
 assert.deepEqual(blocks.map(b=>b.translation),['첫째 문단 번역입니다.','','셋째 문단 번역입니다.']);
 assert.equal(blocks[1].missingTranslation,true);assert.equal(blocks[1].missingReason,'english');assert.match(blocks[1].warnings[0],/영문 응답/);
});

test('a reply missing several paragraphs is asked again in halves, then one by one',async t=>{
 const f=await fixture(t),base=pageAt(1).blocks[0];const asked=[];
 const ids='abcdef'.split(''),input={width:600,height:800,blocks:ids.map((id,i)=>({...base,id,text:`Paragraph ${id} reports one more measurement of the culture in this experiment.`,y:40+i*110}))};
 // The first reply drops b, c and e; the "bc" half drops c again (asked alone
 // it comes back), and e is never answered.
 const jobs=new TranslationJobs(authFor(async(_m,blocks)=>{const got=blocks.map(b=>b.id[0]).join('');asked.push(got);return blocks.filter(b=>{const id=b.id[0];if(got==='abcdef')return !'bce'.includes(id);if(id==='e')return false;return !(id==='c'&&got==='bc');}).map(b=>({id:b.id,text:`문단 ${b.id[0]} 번역입니다.`}));}));
 const job=await jobs.start(f.library,f.paperId,f.hash,[input],'model');await until(()=>jobs.result(job.id).state!=='running');
 assert.deepEqual(asked,['abcdef','bc','e','c','e']);
 const blocks=(await jobs.cached(f.library,f.paperId)).pages[0].blocks;
 assert.deepEqual(blocks.map(b=>b.translation),['문단 a 번역입니다.','문단 b 번역입니다.','문단 c 번역입니다.','문단 d 번역입니다.','','문단 f 번역입니다.']);
 assert.equal(blocks[4].missingReason,'missing');
});

test('a dropped formula marker is accepted only when the formula itself came back once',()=>{
 const {restoreUnit}=require('../desktop/translation.cjs');const unit={math:[{token:'PAPINOTE_MATH_x_0_END',text:'x = y + 1'}]};
 assert.equal(restoreUnit(unit,'식 PAPINOTE_MATH_x_0_END 을 쓴다'),'식 x = y + 1 을 쓴다');
 assert.equal(restoreUnit(unit,'식 x = y + 1 을 쓴다'),'식 x = y + 1 을 쓴다');
 assert.throws(()=>restoreUnit(unit,'식을 쓴다'),/수식 식별자/);
 assert.throws(()=>restoreUnit(unit,'x = y + 1 와 x = y + 1'),/수식 식별자/);
 assert.throws(()=>restoreUnit(unit,'PAPINOTE_MATH_x_0_END PAPINOTE_MATH_x_0_END'),/수식 식별자/);
});

test('a numbered list item is not a section heading; an old block over several new paragraphs shows as one',()=>{
 const {paragraphs,reconcilePage}=require('../core/pdf-layout.js');
 const line=(text,x,y,width=334)=>({text,x,y,baseline:y+10,width,height:10.6,fontSize:10.6,bold:false});
 const blocks=paragraphs([
  line('2. The spatial relationships between process variables are complex and',411,196),
  line('predominantly nonlinear, with coupling effects. For example, the',425,210,320),
  line('rate of sugar addition largely influences the total sugar content.',425,224,320),
  line('3. In erythromycin fermentation, numerous known metabolic reaction',411,238),
  line('mechanisms exist, yet data-driven methods struggle to use this prior.',425,252,320),
  line('2.2. Transformer for time series model',50,300,180)],800,1000,2);
 assert.equal(blocks.find(b=>b.text.startsWith('2. The spatial')).kind,'body');assert.match(blocks.find(b=>b.text.startsWith('2. The spatial')).text,/total sugar content\.$/);
 assert.ok(blocks.some(b=>b.text.startsWith('3. In erythromycin')));assert.equal(blocks.find(b=>b.text.startsWith('2.2.')).kind,'heading');
 // Translated when the item's first line was a heading: the old second block also covers item 3.
 const b=(id,x,y,width,height,text,translation)=>({id,x,y,width,height,fontSize:10.6,kind:'body',text,translation});
 const cached={width:800,height:1000,blocks:[b('h',411,196,334,14,'2. The spatial relationships between process variables are complex and','2. 공정 변수 간 공간적 관계는 복잡하고'),b('rest',411,210,334,70,'predominantly nonlinear … 3. In erythromycin fermentation …','대체로 비선형적이며 … 3. 에리트로마이신 발효에는 …')]};
 const now={width:800,height:1000,blocks:[b('i2',411,196,334,38.5,'2. The spatial … content.'),b('i3',411,238,334,38.5,'3. In erythromycin …')]};
 const result=reconcilePage(cached,now);
 assert.equal(result.blocks.length,1);assert.equal(result.blocks[0].translation,'2. 공정 변수 간 공간적 관계는 복잡하고 대체로 비선형적이며 … 3. 에리트로마이신 발효에는 …');
 assert.equal(result.blocks[0].missingTranslation,false);assert.ok(result.blocks[0].height>=80);
});
test('inline math drawn apart from its line goes back into the line text',()=>{
 const {textLines,paragraphs}=require('../core/pdf-layout.js');
 const run=(text,x,baseline,width,fontSize=10.6)=>({text,x,y:baseline-fontSize*.8,width,height:fontSize,fontSize,baseline});
 // DSGraphformer p3: the radical and its bar are set higher than "dk".
 const runs=[run('represents the correlation scores between T time steps within the vari-',408.8,425.2,335.8),
  run('able, and',408.8,441.4,43.8),run('√',454.2,435,11.6),run('\u0305\u0305\u0305\u0305\u0305',464.8,435,1),run('dk',464.8,441.4,10.4),run('is a scaling factor designed to mitigate',477.6,441.4,158),
  run('large magnitudes of dot products in long sequences of the input.',408.8,457.4,227),
  // A sidebar note in small type just past the column end stays apart, and so does an equation number.
  run('Physics',646,447.2,30,7.4),run('(1)',371,457.4,14)];
 const lines=textLines(runs);
 assert.ok(lines.some(l=>l.text==='able, and √dk is a scaling factor designed to mitigate'),JSON.stringify(lines.map(l=>l.text)));
 assert.ok(lines.some(l=>l.text==='Physics')&&lines.some(l=>l.text==='(1)'));
 const blocks=paragraphs(lines,816,1056,3);assert.ok(!blocks.some(b=>/^√/.test(b.text)),'no separate radical block');
});
test('table cells stay untranslated; the caption and nearby prose are translated',()=>{
 const {tableCellIds,layoutBlocks}=require('../core/pdf-layout.js');
 const b=(id,x,y,width,height,text,extra={})=>({id,text,x,y,width,height,fontSize:10.6,kind:'body',...extra});
 const prose='The proposed model was compared with the baselines and the results are shown in the table below for each of the datasets used.';
 const page={width:816,height:1056,blocks:[
  b('before',50,100,336,60,prose),
  b('cap',50,170,300,24,'Table 2. Results of the methods on three datasets.',{kind:'caption'}),
  b('h1',58,200,40,9,'Method',{fontSize:8.5}),b('h2',180,200,40,9,'MAE',{fontSize:8.5,kind:'heading'}),b('h3',260,200,40,9,'R2',{fontSize:8.5}),
  b('c1',58,215,60,40,'Ours MSGNet FourierGNN',{fontSize:8.5}),b('c2',180,215,30,40,'0.12 0.18 0.21',{fontSize:8.5}),b('c3',260,215,30,40,'0.91 0.88 0.85',{fontSize:8.5}),
  b('after',50,280,336,60,prose),
  b('other-column',409,200,336,40,prose),
  b('mention',50,350,336,40,'Table 2 shows that the proposed model is the most accurate on every dataset we used here.')]};
 const ids=tableCellIds(page);
 assert.deepEqual([...ids].sort(),['c1','c2','c3','h1','h2','h3']);
 const out=Object.fromEntries(layoutBlocks(page).map(x=>[x.id,x.sourceOnly]));
 assert.equal(out.c2,true);assert.equal(out.cap,false);assert.equal(out.after,false);assert.equal(out['other-column'],false);assert.equal(out.mention,false);
 // A caption below its table (ConvNeXt, Lancet) finds the cells above it.
 const below={width:816,height:1056,blocks:[b('h',58,100,40,9,'model',{fontSize:9.3}),b('v',180,100,30,60,'82.9 84.3 85.7',{fontSize:9.3}),b('cap',50,170,300,24,'Table 1. Classification accuracy on ImageNet-1K.',{kind:'caption'}),b('after',50,210,336,60,prose)]};
 assert.deepEqual([...tableCellIds(below)].sort(),['h','v']);
 // Stored with its source as translation, a cell of prose is kept source, not an English reply.
 const {markSame}=require('../core/pdf-layout.js');
 const kept=markSame(page.blocks.map(x=>x.id==='c1'?{...x,text:prose,translation:prose}:x),page.width).find(x=>x.id==='c1');
 assert.equal(kept.sameAsSource,true);assert.equal(kept.englishOnly,undefined);
});
test('algorithm listings stay as printed; math pieces inside a paragraph do not keep it in English',()=>{
 const {tableCellIds,layoutBlocks,layoutCollisions}=require('../core/pdf-layout.js');
 const b=(id,x,y,width,height,text,extra={})=>({id,text,x,y,width,height,fontSize:10.6,kind:'body',...extra});
 const algorithm={width:816,height:1056,blocks:[b('cap',417,289,241,9,'Algorithm 1:Roll-Q Self-Attention for Dynamic Graph',{fontSize:8.5}),b('l1',425,307,100,50,'1: XTraw = Transpose(Xraw) 2: Q = Wq⋅Xraw + bq',{fontSize:8.5,kind:'formula'}),b('l2',425,358,205,46,'5: for l = 1, 2, …T|2 do//Only need to roll T|2 times.',{fontSize:8.5}),b('next',409,551,251,11,'3.2. Knowledge graph mutual attention',{kind:'heading'})]};
 assert.deepEqual([...tableCellIds(algorithm)].sort(),['l1','l2']);
 const prose='where Q⋅KT is a key step in self-attention calculation, Scores represents the correlation scores between T time steps within the variable, and dk is a scaling factor.';
 const page={width:816,height:1056,blocks:[
  b('p',408,401,336,59,prose),b('root',454,426,11.6,10.6,'√̅̅̅̅̅',{kind:'formula'}),b('sub',680,420,60,8,'hdv dmodel is',{fontSize:7.4}),
  b('eq',408,356,336,31,') SelfAttention(Q,K,V) =softmax V. (6) √̅̅̅̅̅ dk',{kind:'formula'}),b('frag',559,356,37,15,'( Scores'),
  b('ref',426,520,318,38,'ndey, C.; Ertunc, S.; Cinar, A. Online batch/fed-batch process performance monitoring, quality prediction.'),b('U',424,520,9,11,'U')]};
 const out=layoutBlocks(page),by=Object.fromEntries(out.map(x=>[x.id,x]));
 assert.equal(by.sub.sourceOnly,true,'a subscript-size phrase inside the paragraph is part of it');assert.equal(by.frag.sourceOnly,true,'words inside an equation box are part of the equation');
 const collisions=layoutCollisions(out);
 assert.equal(collisions.has('p'),false,'an operator drawn apart inside the paragraph does not keep it in English');assert.equal(collisions.has('ref'),false,'a split accented initial belongs to its entry');
});
test('paragraphs spanning their column are justified so the gutter stays even',()=>{
 const {pageTypography}=require('../core/pdf-layout.js');
 const b=(id,x,width,text,extra={})=>({id,text,translation:'번역',x,y:100,width,height:30,fontSize:10.6,kind:'body',align:'start',...extra});
 const long='A long paragraph of prose that fills the column from margin to margin. '.repeat(3);
 const styled=pageTypography({width:800,height:1000,blocks:[b('wide',50,336,long,{align:'justify'}),b('two-lines',50,336,'A two-line paragraph whose source was set flush on its first line only.'),b('short',50,150,'A short label line in the column'),b('right',409,336,long),b('field',50,336,'Received: 12 March 2024, accepted after two rounds of review by the editor.',{label:'field'}),b('head',50,336,'2. Methods and the data',{kind:'heading'})]});
 const align=Object.fromEntries(styled.map(x=>[x.id,x.align]));
 assert.deepEqual(align,{wide:'justify','two-lines':'justify',short:'start',right:'justify',field:'start',head:'start'});
});
test('a first line indented by more than an em stays with its paragraph',()=>{
 const {paragraphs}=require('../core/pdf-layout.js');
 const line=(text,x,y,width)=>({text,x,y,baseline:y+10,width,height:13.8,fontSize:10.6,bold:false});
 // Elsevier: 16 pt (1.5 em) first-line indent, justified lines at the margin.
 const blocks=paragraphs([
  line('In batch processes, prior knowledge such as expert experience and',66,155,320),
  line('control strategies are often used to describe relationships between',50,169,336),
  line('variables that do not change from sample to sample.',50,183,250),
  line('A one-line indented paragraph ends here.',66,197,200),
  line('Next paragraph set at the margin continues on this line',50,211,336)
 ],800,1000,4);
 assert.match(blocks[0].text,/^In batch processes.*control strategies.*sample\.$/);
 assert.ok(blocks.some(b=>b.text==='A one-line indented paragraph ends here.'),'a finished one-line paragraph is not joined');
});
test('body lines beside many small table cells are not headings',()=>{
 const {paragraphs}=require('../core/pdf-layout.js');
 const line=(text,x,y,fontSize,width=286)=>({text,x,y,baseline:y+fontSize,width,height:fontSize,fontSize,bold:false});
 const cells=[];for(let r=0;r<12;r++)for(let c=0;c<4;c++)cells.push(line(String(r*4+c),470+c*40,200+r*12,9.3,20));
 const blocks=paragraphs([...cells,
  line('The c-index for predicting prostate cancer-specific',168,900,12,277),
  line('mortality was consistently high in training, validation',159,915,12),
  line('and testing sets (0·829, 95% CI 0·820–0·838), with',159,930,12),
  line('ResNet-200 / Swin-B regimes. The ImageNet-1K top-1 ac-',159,945,12)
 ],800,1100,4);
 const prose=blocks.find(b=>b.text.startsWith('The c-index'));
 assert.equal(prose.kind,'body');assert.match(prose.text,/cancer-specific mortality was.*with ResNet-200.*top-1 ac-$/);
 assert.ok(!blocks.some(b=>b.kind==='heading'));
});
test('a column gutter interrupted by rows of single words still separates the columns',()=>{
 const {columnGutters,textLines}=require('../core/pdf-layout.js');
 const run=(text,x,baseline,width)=>({text,x,y:baseline-12,width,height:12,fontSize:12,baseline});
 const runs=[];
 // Long runs on both sides: the gutter is measured.
 for(let i=0;i<4;i++)runs.push(run('left column prose line set as one run',49,680+i*14.7,286),run('right column prose line set as one run',350,680+i*14.7,286));
 // A justified line set word by word on the left: short runs, equal gaps.
 for(let i=0;i<4;i++){const y=740+i*14.7;['All','three','multivariable','models','showed','good'].forEach((w,j)=>runs.push(run(w,58+j*46,y,34)));runs.push(run('multivariable models, MSKCC provided',350,y,286));}
 for(let i=0;i<4;i++)runs.push(run('left column prose line set as one run',49,800+i*14.7,286),run('right column prose line set as one run',350,800+i*14.7,286));
 assert.equal(columnGutters(runs).length,1);
 assert.ok(textLines(runs).every(l=>l.x+l.width<345||l.x>=349),'no line crosses the gutter');
});
test('older translations: one paragraph translated twice is shown once, and margin stamps are dropped',()=>{
 const {reconcilePage}=require('../core/pdf-layout.js');
 const b=(id,x,y,width,height,text,translation)=>({id,x,y,width,height,fontSize:10.6,text,translation,kind:'body'});
 const whole='배치 공정에서는 전문가 경험과 제어 전략 같은 사전 지식을 쓴다.';
 const cached={width:800,height:1000,blocks:[b('a',66,155,320,14,'In batch processes, prior knowledge such as expert experience and',whole),b('b',50,169,336,166,'control strategies are often used to describe relationships',whole),b('stamp',796,18,20,9,'15206033, 2008, 3, Downloaded from https://aiche.onlinelibrary.wiley.com','다운로드 표시')]};
 const canonical={width:800,height:1000,blocks:[b('p',50,155,336,180,'In batch processes, prior knowledge such as expert experience and control strategies are often used to describe relationships')],rotatedMarks:[{x:796,y:18,width:20,height:9}]};
 const result=reconcilePage(cached,canonical);
 assert.equal(result.blocks.length,1);assert.equal(result.blocks[0].translation,whole);
});
test('pieces of tall braces mark formula lines',()=>{
 const {formulaOnly}=require('../core/pdf-layout.js');
 assert.equal(formulaOnly({text:'⎧'}),true);assert.equal(formulaOnly({text:'⎪⎪dX'}),true);assert.equal(formulaOnly({text:'⎪⎪ dt'}),true);
 assert.equal(formulaOnly({text:'Such causal relationships are typically composed of known meta-'}),false);
});

test('reference lists split into numbered entries with a hanging indent and keep their numbers',()=>{
 const {paragraphs,repairPages,markSame}=require('../core/pdf-layout.js');
 const line=(text,x,y,width=480)=>({text,x,y,width,height:11,fontSize:10.7,baseline:y+9});
 const blocks=paragraphs([line('1. Tonner PD, Darnell CL, Engelhardt BE, Schmid AK. Detecting differential growth of microbial populations',264,135),line('with Gaussian process regression. Genome Res. 2017; 27(2):320–333.',283,150,400),line('2. Zwietering MH, Jongenburger I, Rombouts FM, van t Riet K. Modeling of the bacterial growth curve.',264,164),line('Appl Environ Microbiol. 1990; 56(6):1875–1881.',283,179,300)],800,1000,1);
 assert.equal(blocks.length,2);assert.ok(blocks.every(b=>Math.abs(b.hang-19)<.01));assert.match(blocks[1].text,/^2\. Zwietering.*1875–1881\.$/);
 const [page]=repairPages([{width:800,height:1000,blocks:[{...blocks[0],translation:'Tonner PD 외. 가우스 과정 회귀를 이용한 미생물 개체군 성장 차이 검출. Genome Res. 2017.'}]}]);
 assert.match(page.blocks[0].translation,/^1\. Tonner PD 외\./);
 assert.equal(markSame([{...blocks[0],translation:blocks[0].text}])[0].sameAsSource,true,'an English reference entry is a normal result');
});

test('bare reference numbers in their own column (Lancet) open one entry each and stay on the translation',()=>{
 const {textLines,paragraphs,repairPages}=require('../core/pdf-layout.js');
 const run=(text,x,baseline,width)=>({text,x,y:baseline-8,width,height:9.3,fontSize:9.3,baseline});
 const lines=textLines([run('1',349.6,706,4.8),run('Taitt HE. Global trends and prostate cancer: a review of incidence,',368.5,706,258.9),run('detection, and mortality as influenced by race, ethnicity, and',368.5,716.6,235.9),
  run('2',349.6,740,5.7),run('Donovan JL, Hamdy FC, Lane JA, et al. Patient-reported outcomes',368.5,740,259.7),run('N Engl J Med 2016; 375: 1425–37.',368.5,750.6,127.8),
  // Line numbers beside prose (a preprint margin) never join.
  run('12',20,800,10),run('the growth rate was estimated from replicate cultures',60,800,250)]);
 const blocks=paragraphs(lines,816,1056,7);
 assert.ok(blocks.some(b=>/^1 Taitt HE\..*ethnicity, and$/.test(b.text)),JSON.stringify(blocks.map(b=>b.text)));
 assert.ok(blocks.some(b=>/^2 Donovan JL,.*1425–37\.$/.test(b.text)));assert.ok(blocks.some(b=>b.text==='12'));
 const [page]=repairPages([{width:816,height:1056,blocks:[{...blocks.find(b=>b.text.startsWith('2 Donovan')),translation:'Donovan JL 외. 환자 보고 결과. N Engl J Med 2016.'}]}]);
 assert.match(page.blocks[0].translation,/^2 Donovan/);
});
test('reference numbers set in their own column open one entry each',()=>{
 const {textLines,paragraphs}=require('../core/pdf-layout.js');
 const run=(text,x,baseline,width)=>({text,x,y:baseline-9,width,height:10.7,fontSize:10.7,baseline});
 const runs=[run('1.',270,140,8),run('Tonner PD, Darnell CL, Engelhardt BE, Schmid AK. Detecting differential growth of microbial',290,140,470),run('populations with Gaussian process regression. Genome Res. 2017; 27(2):320–333.',290,154,360),
  run('2.',270,170,8),run('Zwietering MH, Jongenburger I, Rombouts FM, van t Riet K. Modeling of the bacterial growth curve.',290,170,470),run('Appl Environ Microbiol. 1990; 56(6):1875–1881.',290,184,220),
  run('10.',264.6,200,13.4),run('Darnell CL, Tonner PD, Gulli JG, Schmidler SC, Schmid AK. Systematic discovery of archaeal',290,200,470),run('transcription factor functions in regulatory networks. mSystems. 2017; 2(3):e00032–17.',290,214,400)];
 const blocks=paragraphs(textLines(runs),800,1000,0);
 assert.deepEqual(blocks.map(b=>b.text.slice(0,4)),['1. T','2. Z','10. ']);
 assert.deepEqual(blocks.map(b=>Math.round(b.hang)),[20,20,25]);
 assert.match(blocks[0].text,/microbial populations with Gaussian/);
});
test('a stretched justified line with even word gaps stays one line; uneven cells and columns stay apart',()=>{
 const {textLines,paragraphs}=require('../core/pdf-layout.js');
 const run=(text,x,width,baseline,size=10.6)=>({text,x,y:baseline-size*.8,width,height:size,fontSize:size,baseline});
 // Gaps of 8.8 px (0.83 em) everywhere on the second line, as in a justified column.
 const words=[['description',408.8,56.1],['of',473.7,10.6],['AE-NNs',493.1,38.8],['model',540.7,31.9],['are',581.5,16.3],['introduced',606.6,54.6],['in',670,10.7],['Section',689.5,36.9],['2.',735.2,9.7]];
 const runs=[run('ground of process monitoring with MPCA, MPLS and a brief',408.8,336,503.6),...words.map(([t,x,w])=>run(t,x,w,517.6)),run('of the method follows in the next part of this section here.',408.8,336,531.5)];
 const lines=textLines(runs);
 assert.equal(lines.length,3);assert.equal(lines[1].text,'description of AE-NNs model are introduced in Section 2.');
 const [block]=paragraphs(lines,800,1000,1);assert.match(block.text,/a brief description of AE-NNs model are introduced in Section 2\. of the method/);
 // Table cells with unequal gaps keep their cells.
 const cells=textLines([run('Batch',50,30,300),run('12.5',100,20,300),run('0.31',170,20,300),run('yes',260,18,300)]);
 assert.equal(cells.length,4);
});

test('a translated block\'s mask never covers another block\'s box; its own script fragments are exempt',()=>{
 const {settleMasks}=require('../core/pdf-layout.js');
 const box=(id,x,y,width,height,extra={})=>({id,text:'Paragraph text that is long enough to be prose here.',x,y,width,height,fontSize:10,...extra});
 // A caption up and to the right: the mask's top and right pads would reach it at the corner.
 const a=box('a',100,200,200,60,{maskPad:{top:6,right:8,bottom:4,left:4}}),caption=box('c',305,180,120,16,{preserveSource:false});
 const prime=box('p',150,210,4,6,{text:'′',sourceOnly:true,fontSize:6});
 const below=box('b',100,262,200,40,{sourceOnly:true});
 const [settled]=settleMasks([a,caption,prime,below]);
 const r={x:settled.x-settled.maskPad.left,y:settled.y-settled.maskPad.top,w:settled.width+settled.maskPad.left+settled.maskPad.right,h:settled.height+settled.maskPad.top+settled.maskPad.bottom};
 for(const n of [caption,below])assert.ok(Math.min(r.x+r.w,n.x+n.width)-Math.max(r.x,n.x)<=.5||Math.min(r.y+r.h,n.y+n.height)-Math.max(r.y,n.y)<=.5,'mask clears '+n.id);
 assert.equal(settled.maskPad.left,4,'untouched sides keep their pad');
 // Nothing to settle: the same object back.
 const lone=box('l',100,200,200,60,{maskPad:{top:2,right:2,bottom:2,left:2}});assert.equal(settleMasks([lone])[0],lone);
});

test('citations in the text resolve to entries of the reference list, numbered or author-year',()=>{
 const {citationIndex,citationsIn,resolveCitation}=require('../core/pdf-layout.js');
 const block=(id,text,sectionTitle,y=100)=>({id,text,sectionTitle,x:50,y,width:300,height:20,fontSize:10});
 const pages=[{blocks:[block('a','We follow [2] and [1–3] as in Kim et al. (2020).','Introduction')]},{blocks:[block('h','References','References'),block('r1','[1] Lee J, Park S. A study. J Proc Control. 2019;12:1–9.','References',120),block('r2','[2] Choi H. Another study. 2020.','References',150),block('r3','3. Jackson, J.E., Mudholkar, G.S., 1979. Control procedures. Technometrics.','References',180),block('k','Kim, H., Lee, J., 2020. Deep monitoring. Comput Chem Eng.','References',210),block('x','van der Berg, J., 2018. Spectra. Anal Chem.','References',240)]}];
 const index=citationIndex(pages);
 assert.equal(index.entries.length,5,'the heading is not an entry');
 const cites=citationsIn(pages[0].blocks[0].text);
 assert.deepEqual(cites.map(c=>resolveCitation(index,c).map(e=>e.id)),[['r2'],['r1','r2','r3'],['k']]);
 assert.equal(resolveCitation(index,citationsIn('(van der Berg, 2018)')[0])[0].id,'x');
 assert.equal(resolveCitation(index,citationsIn('Smith (2021)')[0]).length,0,'an unknown citation resolves to nothing');
 assert.equal(citationsIn('In 2020 the plant ran; Table 2019').length,0);
 assert.equal(index.byNumber.get(2).page,2);
});

test('a prose line split inside its paragraph is rejoined, two columns stay apart',()=>{
 const {textLines,columnGutters}=require('../core/pdf-layout.js');
 const run=(text,x,baseline,width,fontSize=12)=>({text,x,y:baseline-10,width,height:fontSize,fontSize,baseline});
 const lines=textLines([run('H. salinarum strains were grown in Complete Medium supplemented',100,100,480),run('with uracil (50',100,115,90),run('μg/ml). These starter cultures were diluted to OD600 of',200,115,380),run('∼0.05 in 200 μl CM then transferred in triplicate into the wells',100,130,470)]);
 assert.equal(lines.length,3);assert.match(lines[1].text,/^with uracil \(50 μg\/ml\)\. These starter/);
 // Several split lines on one page: a line joined earlier never breaks the next lookup.
 const twice=textLines([run('H. salinarum strains were grown in Complete Medium supplemented',100,100,480),run('with uracil (50',100,115,90),run('μg/ml). These starter cultures were diluted to OD600 of',200,115,380),run('∼0.05 in 200 μl CM then',100,130,200),run('transferred in triplicate into the wells of the plate',310,130,270),run('and grown at 42 °C with shaking in the plate reader for three days',100,145,480)]);
 assert.equal(twice.length,4);assert.match(twice[2].text,/^∼0\.05 in 200 μl CM then transferred in triplicate/);
 const rows=[0,1,2,3,4].flatMap(i=>[run('Left column body text of the article',60,100+i*15,230),run('Right column body text of the article',310,100+i*15,230)]);
 assert.equal(textLines(rows).length,10);assert.equal(columnGutters(rows).length,1);
 // Word spaces that line up above and below a full line are not a gutter.
 const aligned=[run('Words of a first line',100,100,200),run('with a wide space',315,100,200),run('Words of a second line',100,115,200),run('with a wide space',315,115,200),run('A full prose line runs straight across the whole text measure here',100,130,415),run('Words of a fourth line',100,145,200),run('with a wide space',315,145,200),run('Words of a fifth line',100,160,200),run('with a wide space',315,160,200)];
 assert.equal(columnGutters(aligned).length,0);
});
test('a line finishing a hyphenated word stays in its paragraph despite inline math',()=>{
 const {paragraphs,formulaOnly,repairGlyphs}=require('../core/pdf-layout.js');
 const line=(text,y,width=480)=>({text,x:100,y,width,height:13,fontSize:13,baseline:y+10});
 const blocks=paragraphs([line('Each model was sampled with four chains and all parameters con-',100),line('verged within R^ < 1:1 as recommended [56].',115,230)],800,1000,5);
 assert.equal(blocks.length,1);assert.equal(blocks[0].kind,'body');assert.match(blocks[0].text,/parameters converged within R̂ < 1:1 as recommended \[56\]\.$/);
 assert.equal(formulaOnly({text:'verged within R^ < 1:1 as recommended [56].'}),false);
 assert.equal(repairGlyphs('where yl ¼ fs2l ; \'lg are the kernel parameters'),'where yl = fs2l ; \'lg are the kernel parameters');
 assert.equal(repairGlyphs('about ¼ of the cells'),'about ¼ of the cells');
});
test('prose with several lost math glyphs is translated in place',()=>{
 const {mathDense,layoutBlocks}=require('../core/pdf-layout.js');
 const text='In Mfull, the function shared with Mnull is modelled with batch effects, and the error model �k,r is replaced by �k,r � GP(0, κy(t, t0)) so that correlated noise within each replicate curve is captured (Eq (8)).';
 assert.equal(mathDense(text),false);
 const [block]=layoutBlocks({width:600,height:800,blocks:[{id:'m',text,x:100,y:100,width:400,height:80,fontSize:13,kind:'body'}]});
 assert.equal(block.sourceOnly,false);assert.equal(block.preserveSource,false);
});
test('display equation pieces form one formula block with their number',()=>{
 const {paragraphs}=require('../core/pdf-layout.js');
 const line=(text,x,y,width,fontSize=12)=>({text,x,y,width,height:fontSize,fontSize,baseline:y+fontSize*.8});
 const blocks=paragraphs([line('where the covariance of the latent function is given by the kernel',100,80,420),line('κ(t, t′) = σ² exp',200,110,120),line('−|t − t′|',330,103,50,10),line('2ℓ',345,118,15,10),line('(2)',520,110,18),line('Here ℓ is the lengthscale of the kernel and σ² the amplitude.',100,140,400)],800,1000,3);
 assert.deepEqual(blocks.map(b=>b.kind),['body','formula','body']);
 const eq=blocks[1];assert.match(eq.text,/κ/);assert.match(eq.text,/\(2\)/);assert.match(eq.text,/2ℓ/);assert.equal(eq.x,200);assert.equal(eq.x+eq.width,538);
});
test('an equation box reaching into a paragraph edge and subscript pieces are not collisions',()=>{
 const {layoutBlocks,layoutCollisions}=require('../core/pdf-layout.js');
 const p={id:'p',text:'The function shared with the null model is defined below for every strain.',x:100,y:100,width:400,height:60,fontSize:13,kind:'body'};
 const blocks=layoutBlocks({width:600,height:800,blocks:[p,{id:'eq',text:'f(t) = g(t) + h(t)',x:200,y:150,width:200,height:40,fontSize:20,kind:'formula'}]});
 assert.deepEqual([...layoutCollisions(blocks)],[]);assert.equal(blocks.find(b=>b.id==='eq').y,160);assert.equal(blocks.find(b=>b.id==='p').height,60);
 const sub=layoutBlocks({width:600,height:800,blocks:[p,{id:'s',text:'k,r',x:300,y:130,width:10,height:8,fontSize:9,kind:'body'}]});
 assert.equal(sub.find(b=>b.id==='s').sourceOnly,true);assert.deepEqual([...layoutCollisions(sub)],[]);
});
test('a bold reference number a hair below its text and a wrapped "6. https" line stay with their entry',()=>{
 const {textLines,paragraphs}=require('../core/pdf-layout.js');
 const run=(text,x,baseline,width)=>({text,x,y:baseline-9,width,height:10.7,fontSize:10.7,baseline});
 const runs=[run('9.',333,260.01,10),run('Egli T. Microbial growth and physiology: a call for better craftsmanship. Frontiers in Microbiology. 2015;',358,260,460),run('6. https://doi.org/10.3389/fmicb.2015.00287 PMID: 25926822',358,275,300),
  run('10.',325,290.02,18),run('Neidhardt FC. Apples, oranges and unknown fruit. Nature Reviews Microbiology. 2006; 4(12):876–876.',358,290,460),run('https://doi.org/10.1038/nrmicro1554 PMID: 17120340',358,305,260)];
 const blocks=paragraphs(textLines(runs),800,1000,17);
 assert.deepEqual(blocks.map(b=>b.text.slice(0,9)),['9. Egli T','10. Neidh']);
 assert.match(blocks[0].text,/2015; 6\. https:\/\/doi\.org\/10\.3389\/fmicb\.2015\.00287 PMID: 25926822$/);
});

test('smaller raised or lowered runs are marked as superscripts and subscripts in the rich text',()=>{
 const {textLines,paragraphs,scriptTokens,plainScripts,richHtml,scriptCut,splitShares,repairGlyphs,sameAsSource}=require('../core/pdf-layout.js');
 const run=(text,x,baseline,width,fontSize=12)=>({text,x,y:baseline-10,width,height:fontSize,fontSize,baseline});
 const lines=textLines([run('diluted to OD',100,100,80),run('600',180,103,14,8),run('of 0.05 and the variance',196,100,150),run('σ',350,100,7),run('2',357,95.5,5,8),run('m',357,103,6,8),run('was estimated.',366,100,90),run('^',100,124,5),run('f(t) is the mean function',106,130,160)]);
 assert.equal(lines[0].text,'diluted to OD600 of 0.05 and the variance σ2m was estimated.','the plain text used by every layout rule is unchanged');
 assert.equal(lines[0].rich,'diluted to OD<sub>600</sub> of 0.05 and the variance σ<sup>2</sup><sub>m</sub> was estimated.');
 assert.equal(lines[1].rich,undefined,'an accent is never a script');
 const [block,hat]=paragraphs(lines,800,1000,0);
 assert.equal(block.text,lines[0].text);assert.equal(block.rich,lines[0].rich);assert.equal(hat.rich,undefined);assert.match(hat.text,/^f̂\(t\)/);
 // Only the exact tags are markup; unbalanced tags are closed or dropped.
 assert.deepEqual(scriptTokens('a<sub>r</sub>(t) < b'),[{text:'a',tags:[]},{text:'r',tags:['sub']},{text:'(t) < b',tags:[]}]);
 assert.equal(richHtml('x</sub>y<sup>z & <b>'),'xy<sup>z &amp; &lt;b&gt;</sup>');assert.equal(plainScripts('σ<sup>2</sup><sub>m</sub>'),'σ2m');
 const text='분산 σ<sup>2</sup><sub>m</sub>과 길이 척도 ℓ<sub>m</sub>을 함께 추정한다';
 for(let i=0;i<=text.length;i++)if(!scriptCut(text,i))assert.ok(i>text.indexOf('σ')+1&&i<text.indexOf('과')||i>text.indexOf('ℓ')+1&&i<text.indexOf('을'),String(i));
 // Shares of a joined translation never split a marked script.
 for(const weights of [[1,1],[3,1],[1,3],[1,1,1]])for(const part of splitShares(text,weights))for(const tag of ['sub','sup'])assert.equal((part.match(new RegExp(`<${tag}>`,'g'))||[]).length,(part.match(new RegExp(`</${tag}>`,'g'))||[]).length,part);
 // Math-font repairs read through the tags: a raised 0 is a prime, braces and commas.
 assert.equal(repairGlyphs('kernel kðt; t<sup>0</sup>Þ with fs<sup>2</sup> <sub>m</sub>; ‘<sub>m</sub>g and y<sub>l</sub> ¼ 3'),'kernel k(t, t′) with {s<sup>2</sup> <sub>m</sub>, ‘<sub>m</sub>} and y<sub>l</sub> = 3');
 assert.equal(sameAsSource('Peter D. Tonner1,2','Peter D. Tonner<sup>1,2</sup>'),true);
});
test('marked scripts reach the model, survive validation and render as scripts in exports',async t=>{
 const f=await fixture(t),sent=[];
 const block={id:'p1-b0',text:'Cultures were diluted to OD600 of 0.05 and the variance σ2m was estimated from the data.',rich:'Cultures were diluted to OD<sub>600</sub> of 0.05 and the variance σ<sup>2</sup><sub>m</sub> was estimated from the data.',x:20,y:20,width:400,height:40,fontSize:12};
 const reply='배양액을 OD<sub>600</sub> 0.05로 희석하고 분산 σ<sup>2</sup><sub>m</sub>을 데이터에서 추정했다.';
 const jobs=new TranslationJobs(authFor(async(_m,blocks)=>{sent.push(...blocks.map(b=>b.text));return blocks.map(b=>({id:b.id,text:reply}));}));
 const job=await jobs.start(f.library,f.paperId,f.hash,[{width:600,height:800,blocks:[block]}],'model');await until(()=>jobs.result(job.id).state!=='running');
 assert.equal(jobs.result(job.id).state,'completed');assert.equal(sent[0],block.rich);
 const [page]=(await jobs.cached(f.library,f.paperId)).pages;
 assert.equal(page.blocks[0].translation,reply);assert.deepEqual(page.blocks[0].warnings,[],'OD600 is not reported as a missing number');
 const reading=exportHtml([page],[],'reading');assert.match(reading,/OD<sub>600<\/sub> 0\.05로 희석하고 분산 σ<sup>2<\/sup><sub>m<\/sub>을/);assert.doesNotMatch(reading,/&lt;su[bp]&gt;/);
 const layout=exportHtml([page],['data:image/png;base64,AAAA'],'layout');assert.match(layout,/>배양액을 OD<sub>600<\/sub> 0\.05로/);assert.match(layout,/data-text="배양액을 OD&lt;sub&gt;600&lt;\/sub&gt;/);assert.match(layout,/\.block sub,\.block sup\{font-size:\.72em;line-height:0/);
});
test('math-font overbraces and encoded equations are formulas, and a rewritten equation reply keeps the source',()=>{
 const {formulaOnly,layoutBlocks,markSame,paragraphs}=require('../core/pdf-layout.js');
 const lig='z'+'\uFB04'.repeat(12)+'}|'+'\uFB04'.repeat(12)+'{';
 for(const text of [lig,lig.normalize('NFKC'),lig.normalize('NFKC')+' yk,r(t, p, m) = m(t) + ap(t) + bc(t) + (ab)p,c(t) + m(k)(t) + a(k)p(t) + (ab)(k)p,c(t) + b(k)c(t) + εk,r(t)','yk,r(t, p, m) = m(t) + ap(t) + bc(t) + (ab)p,c(t) + m(k)(t) + a(k)p(t) + (ab)(k)p,c(t) + b(k)c(t) + �k,r(t) (7)'])assert.equal(formulaOnly({text,kind:'body'}),true,text.slice(0,40));
 // Real prose stays prose, even with an "ffl" word.
 assert.equal(formulaOnly({text:'The affluent cultures were shuffled and the plates were refilled each day.',kind:'formula'}),false);
 // The brace line and its equation form one source-only formula block.
 const line=(text,y,x=268,width=500)=>({text,x,y,width,height:13,fontSize:13,baseline:y+10});
 const blocks=layoutBlocks({width:800,height:1000,blocks:paragraphs([line('Mfull adds replicate effects to the batch model in the hierarchy of this study.',100,264,505),line(lig+'   '+lig,133,330,440),line('yk;rðt; p; mÞ ¼ mðtÞ þ apðtÞ þ bcðtÞ þ ðabÞp;cðtÞ þ mðkÞðtÞ þ aðkÞpðtÞ þ bðkÞcðtÞ (7)',145)],800,1000,5)});
 assert.deepEqual(blocks.map(b=>[b.kind,b.sourceOnly]),[['body',false],['formula',true]]);
 // A model that answers a symbol-only block by writing out the equation did not translate it.
 const [rewritten]=markSame([{id:'b',text:lig,translation:'yk,r(t, p, m) = μ(t) + αp(t) + βc(t) + εk,r(t)'}]);assert.equal(rewritten.sourceOnly,true);assert.equal(rewritten.sameAsSource,true);
 const [short]=markSame([{id:'c',text:'Growth curves',translation:'Growth curves of cells'}]);assert.equal(short.sourceOnly,undefined,'two real words are a phrase, not symbols');
});
test('a long argument list that never closes is repaired quickly, and short lists still become commas', () => {
  const { normalizeParagraph } = require('../core/pdf-layout.js');
  const list = n => 'strains(' + Array.from({ length: n }, (_, i) => 'ura' + i).join('; ') + ', and others)';
  const started = Date.now(); for (const n of [8, 12, 40]) normalizeParagraph(list(n));
  assert.ok(Date.now() - started < 500, 'took ' + (Date.now() - started) + ' ms');
  assert.equal(normalizeParagraph('f(x; y) and g(ab cd; e)'), 'f(x, y) and g(ab cd, e)');
});


test('split points preserve graphemes and scripts for long translated paragraphs',()=>{
 const {splitPoints,scriptCut}=require('../core/pdf-text.js');
 const text=('긴 번역 👩‍🔬 e\u0301 x<sub>ij</sub> y<sup>2</sup> ').repeat(100);
 const expected=[0,...Array.from(new Intl.Segmenter('ko',{granularity:'grapheme'}).segment(text),p=>p.index+p.segment.length).filter(i=>scriptCut(text,i))];
 assert.deepEqual(splitPoints(text),expected);
 assert.deepEqual(splitPoints(''),[0]);
});

test('extensible equation braces and their small labels stay source-only',()=>{
 const {formulaOnly,layoutBlocks,layoutCollisions}=require('../core/pdf-layout.js');
 const text='z'+'ffl'.repeat(36)+'}|'+ 'ffl'.repeat(36)+'{ y(t) = m(t) + a(t) + b(t)';
 const equation={id:'equation',text,kind:'formula',x:400,y:132,width:260,height:56,fontSize:13.33};
 const label={id:'label',text:'Mnull',kind:'body',x:565,y:127,width:19,height:10,fontSize:6.66};
 const prose={id:'prose',text:'We describe the functions and their shared prior distributions in the following paragraph.',kind:'body',x:265,y:203,width:500,height:55,fontSize:13.33};
 assert.equal(formulaOnly(equation),true);
 assert.equal(formulaOnly({...prose,text:prose.text+' '+text}),false,'real prose around a brace is not suppressed');
 const blocks=layoutBlocks({width:800,height:1050,blocks:[equation,label,prose]});
 assert.equal(blocks.find(b=>b.id==='equation').sourceOnly,true);
 assert.equal(blocks.find(b=>b.id==='label').sourceOnly,true);
 assert.equal(blocks.find(b=>b.id==='prose').sourceOnly,false);
 assert.deepEqual([...layoutCollisions(blocks)],[]);
 const ordinary=layoutBlocks({width:800,height:1050,blocks:[equation,{...label,fontSize:13.33}]});
 assert.equal(ordinary[1].sourceOnly,false,'normal-sized prose is not a small equation label');
});

test('standalone distribution fragments preserve equations without suppressing surrounding prose',()=>{
 const {formulaOnly}=require('../core/pdf-layout.js');
 for(const text of ['GP(0, kβ(t, t′))','GP(0, kb, batch(t, t )) GP(0, kab, batch(t, t′));','Gamma(α, β)','N(0, σ2 I)'])assert.equal(formulaOnly({text}),true,text);
 for(const text of ['GP(0, k(t, t′)) describes the prior distribution of the function.','We assign a Gamma(10, 10) prior to the variance.','GP(0, k(t, t′)'])assert.equal(formulaOnly({text}),false,text);
});

test('cached GP fragments overlapping the rest of an equation do not create continuation conflicts',()=>{
 const {layoutBlocks,layoutCollisions}=require('../core/pdf-layout.js');
 const page={width:800,height:1050,blocks:[
  {id:'left',kind:'formula',text:'a(t) ∼ b(t) ∼ (ab)(t) =',x:429,y:745,width:159,height:62,fontSize:13.33},
  {id:'right',kind:'body',text:'GP(0, kb(t, t′)) GP(0, kab(t, t′))',translation:'GP(0, kβ(t, t′)) GP(0, kαβ(t, t′))',x:505,y:767,width:85,height:41,fontSize:13.33}
 ]};
 const blocks=layoutBlocks(page);
 assert.ok(blocks.every(b=>b.sourceOnly));
 assert.deepEqual([...layoutCollisions(blocks)],[]);
});
test('a drop capital opens its paragraph without joining the other column',()=>{
 const {textLines,paragraphs}=require('../core/pdf-layout.js');
 const run=(text,x,baseline,width,fontSize=13.3)=>({text,x,y:baseline-fontSize*.75,width,height:fontSize,fontSize,baseline});
 // Dynamic-DeepHit p1: the abstract in 12 px, the introduction's "S" three lines tall beside it.
 const runs=[run('marking and joint modeling. Our approach, which we call',56.2,361,335.8,12),run('Dynamic-DeepHit, flexibly incorporates the available lon-',56.2,374.2,335.8,12),
  run('gitudinal data comprising various repeated measurements',56.2,387.5,335.8,12),
  run('S',406.8,382.7,23.2,39.9),run('URVIVAL analysis informs our understanding of the rela-',431.7,362.3,310.9),
  run('tionships between the (distribution of) first hitting times.',431.7,378.3,310.9),run('events of interest (such as death, onset of a certain disease, etc.)',406.8,394.2,335.7),
  run('and the covariates, and enables us to issue corresponding risk',406.8,410.1,335.8)];
 const lines=textLines(runs);
 assert.ok(lines.some(l=>l.text==='Dynamic-DeepHit, flexibly incorporates the available lon-'&&l.width<340),JSON.stringify(lines.map(l=>[l.text,l.x,l.width])));
 assert.ok(lines.some(l=>l.text.startsWith('SURVIVAL analysis')&&l.x===406.8));
 const blocks=paragraphs(lines,816,1056,1),intro=blocks.find(b=>b.text.startsWith('SURVIVAL'));
 assert.ok(intro&&/corresponding risk$/.test(intro.text),JSON.stringify(blocks.map(b=>b.text.slice(0,30))));
 assert.ok(blocks.every(b=>b.x+b.width<=400||b.x>=400),'no block crosses the gutter');
});
test('line pieces join in any order, and a subscript run carrying the rest of the line takes the body size',()=>{
 const {textLines,paragraphs}=require('../core/pdf-layout.js');
 const run=(text,x,baseline,width,fontSize=13.3)=>({text,x,y:baseline-fontSize*.75,width,height:fontSize,fontSize,baseline});
 // "times is denoted as T = {0, 1" + ", . . . , T" + "max} where …": the middle piece arrives last.
 const pieces=[run('times is denoted as',406.8,543.6,103.8),run('T',513.7,543.6,8.2),run('=',528,543.6,11.3),run('{',542,543.6,7.6),run('0',548.7,543.6,7.6),run(',',555.3,543.6,4.7),run('1',561.2,543.6,7.6),
  run(', . . . , T',567.8,543.6,38.3),run('max',605.1,545.6,17,9.3),run('}',621.8,543.6,7.6),run('where',632.5,543.6,33.4),run('T',668.9,543.6,8.8),run('max is a pre-',676.7,545.6,65.9,9.3)];
 assert.deepEqual(textLines(pieces).map(l=>l.text),['times is denoted as T = {0, 1, . . . , Tmax} where Tmax is a pre-']);
 // "L" then "total that is specifically …" as one 9.3 px item, as wide per letter as the body text.
 const body=t=>t.length*5.2;
 const text=['To train Dynamic-DeepHit, we minimize a total loss function','surements and right-censoring. The total loss function is the sum','of three terms that are explained one after another below.','The first term is the log-likelihood of the joint distribution of','the first hitting time and the competing event of each subject.'];
 const resized=[run(text[0],420.1,406.1,body(text[0])),run('L',406.8,422.1,10.2),run('total that is specifically designed to handle longitudinal mea-',416,424.1,326.6,9.3),
  ...text.slice(1).map((t,i)=>run(t,406.8,438+16*i,body(t)))];
 const lines=textLines(resized),second=lines.find(l=>l.text.startsWith('Ltotal'));
 assert.equal(second.fontSize,13.3);
 assert.equal(paragraphs(lines,816,1056,5).filter(b=>/train|Ltotal|surements/.test(b.text)).length,1);
});
test('a caption label set apart joins its caption, and a fraction set in small type rejoins its prose line',()=>{
 const {textLines}=require('../core/pdf-layout.js');
 const run=(text,x,baseline,width,fontSize=10.6)=>({text,x,y:baseline-fontSize*.75,width,height:fontSize,fontSize,baseline});
 const caption=textLines([run('Fig. 2.',56.2,330.5,30.6),run('An illustration of (a) the network architecture of Dynamic-DeepHit with',98.4,330.5,329.6)]);
 assert.deepEqual(caption.map(l=>l.text),['Fig. 2. An illustration of (a) the network architecture of Dynamic-DeepHit with']);
 // "where aj = [exp(ej) / ∑ exp(eℓ)] represents the importance of the j-"
 const fraction=textLines([run('where',56.2,387.8,33.4,13.3),run('aj',94,387.8,11.9,13.3),run('=',110.4,387.8,11.3,13.3),run('exp(',140.2,381,20.8,9.3),run('e j',160.5,381,8.8,9.3),run(')',170.5,381,4.6,9.3),
  run('∑',126,387.2,10.8,9.3),run('J',137.1,389.8,4.7,6.6),run('−',142.9,389.8,6.2,6.6),run('1',148.1,389.8,4.3,6.6),run('= 1 ',141.1,396.9,14.7,6.6),run('exp(',154.8,394.2,20.8,9.3),run('e ',175.1,394.2,8.8,9.3),run(')',184.8,394.2,4.6,9.3),
  run('represents the importance of the',196,387.8,179.8,13.3),run('j',380.3,387.8,6.5,13.3),run('-',386.5,387.8,5.4,13.3)]);
 assert.equal(fraction.length,1,JSON.stringify(fraction.map(l=>l.text)));
 assert.ok(/^where aj = .*exp\(.*represents the importance of the j-$/.test(fraction[0].text));
});
test('word spaces: tight justified words, OCR word boxes; kerned pairs and symbols before brackets stay closed',()=>{
 const {textLines}=require('../core/pdf-layout.js');
 // Run boxes carry the 1px slack extractPage adds.
 const run=(text,x,width,fontSize=10.63)=>({text,x,y:930,width:width+1,height:fontSize,fontSize,baseline:938});
 const words=(...parts)=>{let x=416;return parts.map(([t,w,gap])=>{const r=run(t,x,w);x+=w+gap;return r;});};
 assert.equal(textLines(words(['Where',34.4,1.7],['the',16.6,1.7],['diagonal',43.6,1.7],['matrix',34.1,1.7],['of',9.9,1.7],['covariance',54.7,1.7])).map(l=>l.text)[0],'Where the diagonal matrix of covariance');
 // A scanned page's text layer: each word box runs into the next one.
 assert.equal(textLines(words(['The',18.8,1.7],['problem',43,-6],['of',10,-4],['using',30,0])).map(l=>l.text)[0],'The problem of using');
 // Kerning ("V|AE-GAN") and an italic letter before its bracket ("P(T") are no word gaps.
 assert.equal(textLines(words(['LSTM-Based V',80,-2],['AE-GAN',45,2])).map(l=>l.text)[0],'LSTM-Based VAE-GAN');
 assert.equal(textLines(words(['given by P',60,.5],['(T',12,0],['< τ)',20,0])).map(l=>l.text)[0],'given by P(T< τ)');
});
test('equation rows gather operator names, brace glyphs and words beside a numbered formula; a number across a line stays apart',()=>{
 const {paragraphs,formulaOnly,publisherMark}=require('../core/pdf-layout.js');
 const line=(text,x,y,width,fontSize=10.6)=>({text,x,y,baseline:y+fontSize*.8,width,height:fontSize,fontSize,bold:false});
 // Multivariate batch p4 (17): "min" over "Δu" (extracted as U+0003) and a large "[" beside the formula.
 const eq=paragraphs([line('[1',438.3,240,15.3,13.3),line('\u0003uTH\u0003u + f T \u0003u',454.2,253.1,91.3),line('min',416.3,256.3,21.3),line('(17)',730.7,256.3,22),line('2',446.2,263.9,7.4),line('\u0003u',420,267,13.7,8)],816,1056,4);
 assert.equal(eq.length,1,JSON.stringify(eq.map(b=>b.text)));assert.equal(eq[0].kind,'formula');
 // LSTM-VAE-GAN (8): "anomaly | score = (1 − α)|X − X̂| | − αDis(X), | (8)".
 const row=paragraphs([line('score = (1 − α)∣∣∣Xtest − Xˆtest∣∣∣',304.9,652.4,150.7,13.8),line('anomaly',258.4,663.6,47.4,13.3),line('− αDis(Xtest),',457.1,662.5,79.1,13.3),line('(8)',676.2,663.6,16.5,13.3)],816,1056,5);
 assert.equal(row.length,1,JSON.stringify(row.map(b=>b.text)));assert.ok(formulaOnly(row[0]),'a numbered display row is a formula');
 // A table cell formula in the left column never takes the right column's equation number.
 const apart=paragraphs([line('0.0 ≤ and ≤ 0.6',312.8,365.6,64.1,8.5),line('Where ¯uT = diag(stdu) ˆuT + meanuT',416.3,360.1,173.4),line('(23)',730.7,362.4,22)],816,1056,6);
 assert.ok(apart.some(b=>b.text==='(23)'),JSON.stringify(apart.map(b=>b.text)));
 // Mixed-case index names are no words; brace pieces without a function word are a formula.
 assert.equal(formulaOnly({text:'⎧ ⎪⎨H = Vuf Q T QV ufT + M f T = (ηVQ T − ysp)QV ufT s.t. ⎪⎩ lb ≤ un + Δu ≤ ub',kind:'formula'}),true);
 assert.equal(formulaOnly({text:'yˆ = [xp un [xp un ](Pp TPp)−1Pp TPfT ]VQ T ︸ ︷︷ ︸',kind:'body'}),true);
 assert.equal(formulaOnly({text:'Where the score validity indicator Jt and the residuals validity indicator Je for batch k must be less than their limits.',kind:'body'}),false);
 // Elsevier's header band, also when its letters are set apart with spaces.
 assert.equal(publisherMark({text:'jo u rn al h om ep age : w w w . e l s e v i e r . c o m / l o c a t e / j p r o c o n t',y:158.7},{height:1056}),true);
});
test('figure legends and two-line labels, tiny drawing text and algorithm steps keep their source; table notes are translated',()=>{
 const {layoutBlocks,tableCellIds}=require('../core/pdf-layout.js');
 const b=(id,x,y,width,height,text,extra={})=>({id,text,x,y,width,height,fontSize:12,kind:'body',...extra});
 const prose='The proposed model was compared with the baselines and the results are shown in the figure below for each of the datasets.';
 // Lancet p6: a legend list and "0·2 / Threshold probability" inside the plot above "Figure 3:".
 const figure={width:794,height:1123,blocks:[b('above',158.7,300,286.4,60,prose),b('legend',378.2,385.3,59,50.3,'Treat no men Treat all men Survival Quilts PREDICT Prostate',{fontSize:8.7}),
  b('axis',282,592.4,71.9,21.9,'0·2 Threshold probability',{fontSize:8.7}),b('gru',130.5,411.5,21.3,12.3,'Update gate (ut)',{fontSize:5.6}),
  b('cap',158.7,625.8,280.1,56,'Figure 3: Decision curve analysis The clinical net benefit for each model is shown.',{fontSize:9.3,kind:'caption'}),b('after',158.7,697.6,286.4,60,prose)]};
 const out=Object.fromEntries(layoutBlocks(figure).map(x=>[x.id,x.sourceOnly]));
 assert.deepEqual(out,{above:false,legend:true,axis:true,gru:true,cap:false,after:false});
 // LSTM-VAE-GAN p6: an algorithm whose steps read like prose, to the next section heading.
 const steps='Generate X̂ from generator X̂ = Enc(Ẑ) Update parameters of encoder according to gradient and update the parameters of the generator according to the gradient';
 const algorithm={width:816,height:1056,blocks:[b('cap',110,125,407.7,12,'Algorithm 1. Anomaly detection algorithm used the LSTM-based VAE-GAN.'),b('s1',110,147.9,230.7,45.3,'Input: training data Xtrain, testing data Xtest Output: anomaly or no anomaly'),
  b('s2',169.8,295.8,327.5,125.8,steps),b('s3',110,425.7,151.8,12,'At anomaly detection stage:'),b('s4',157.8,525.1,83.1,12,'return anomaly'),b('s5',133.9,541.7,24,12,'else:'),b('s6',157.8,558.2,99.6,12,'return no anomaly'),
  b('head',102,593.5,60.6,13.3,'3. Results',{fontSize:13.3,kind:'heading'}),b('next',102,620,590,60,prose,{fontSize:13.3})]};
 algorithm.blocks.splice(2,0,b('s1b',133.9,197.7,121.6,28.5,'Initialize Enc, Gen, Dis In each iteration:'),b('s1c',157.8,230.8,295.9,46,'Generate random mini-batch X from training data Xtrain Generate Z from encoder'));
 algorithm.blocks.splice(5,0,b('s3b',133.9,432.1,526.2,88.4,'Calculate reconstruction difference: Re and the discrimination results and the anomaly score for each point'));
 assert.deepEqual([...tableCellIds(algorithm)].sort(),['s1','s1b','s1c','s2','s3','s3b','s4','s5','s6']);
 // DSGraphformer p9: notes under the table rows are translated; a page number below them changes nothing.
 const table={width:794,height:1123,blocks:[b('cap',50.1,699.2,355.9,25.2,'Table 3 Results of three types of spatiotemporal modeling prediction tasks.',{fontSize:9.6}),
  b('h',58.1,730.5,29.8,8.5,'Method',{fontSize:8.5}),b('m',177,730.5,18.8,8.5,'Ours',{fontSize:8.5}),b('v',177,765.6,28.7,191.3,'0.030 0.025 0.026 0.018 0.025',{fontSize:8.5}),b('r',58.1,765.6,52.8,8.5,'Point forecast',{fontSize:8.5}),
  b('n1',50.1,966.2,371.5,9.6,'[1] The best results are highlighted in bold, and the second-best results are underlined.',{fontSize:9.6}),b('n2',50.1,978.9,278.8,9.6,'[2] Avg denotes the average value of each method in the subtask.',{fontSize:9.6}),b('page',380,1004,10,12,'9',{fontSize:9.6})]};
 const cells=tableCellIds(table);assert.ok(['h','m','v','r'].every(id=>cells.has(id)));assert.ok(!cells.has('n1')&&!cells.has('n2'),JSON.stringify([...cells]));
});
test('columns of one run per word stay apart, and author-year references with a hanging indent split per entry',()=>{
 const {textLines,paragraphs,columnGutters}=require('../core/pdf-layout.js');
 const run=(text,x,baseline,width,fontSize=13.3)=>({text,x,y:baseline-fontSize*.75,width,height:fontSize,fontSize,baseline});
 // A scanned page's text layer: every word a run; one left-column line ends 0.74 em before the right column.
 const words=(line,x,baseline)=>line.split(' ').map((w,i,a)=>run(w,x+(i?a.slice(0,i).join(' ').length+1:0)*6.5,baseline,w.length*6.5));
 const rows=[];for(let i=0;i<8;i++){const y=820+i*16;rows.push(...words(i===4?'moreusefulthan univariate methods.By interrogating':'important todiagnose the event tofind',60.6,y),...words('systematic manner andreturned totheir meantrajectories',395,y));}
 assert.ok(columnGutters(rows).some(g=>g.left<=395&&g.right>=385),JSON.stringify(columnGutters(rows)));
 assert.ok(textLines(rows).every(l=>l.x+l.width<=390||l.x>=394),'no line crosses the gutter');
 // Biotech. Prog. references: first line at the margin, the rest indented by 1.1 em.
 const line=(text,x,y,width)=>({text,x,y,baseline:y+9,width,height:11.3,fontSize:11.3,bold:false});
 const refs=paragraphs([line('Shimizu, H.; Yasuoka, K.; Uchiyama, K.; Shioya, S. Bioprocess fault',424,334.2,320.3),line('detection by nonlinear multivariate analysis: application of an',436.6,346.8,307.7),
  line('Biotechnol. Prog. 1998, 14, 79-87.',436.6,359.4,167.2),line('Umetrics AB. SIMCA-P and SIMCA-P+ 11 User Guide and Tutorial,',424,372.1,320.3),line('Version 11.0., 2005, Umea, Sweden.',436.6,384.7,171.2),
  line('Wold, S.; Sjostrom, M.; Eriksson, L. PLS-regression: a basic tool of',424,397.3,320.3),line('chemometrics. Chemom. Intell. Lab. Syst. 2001, 58, 109-130.',436.6,409.9,300)],816,1056,7);
 assert.deepEqual(refs.map(b=>b.text.slice(0,8)),['Shimizu,','Umetrics','Wold, S.']);
 // Lancet: a bare number beside a corporate or two-word author opens the entry.
 const lancet=textLines([run('23',459.2,235.5,10.3,9.3),run('National Cancer Institute Surveillance, Epidemiology, and End',478.1,235.5,245.4,9.3),run('29',459.2,492.2,10.3,9.3),run('Van Calster B, Wynants L, Verbeek JFM, et al. Reporting and',478.1,492.2,238.1,9.3)]);
 assert.deepEqual(lancet.map(l=>l.text.slice(0,6)),['23 Nat','29 Van']);
});
test('column boxes never grow into the gutter; a running head across the page is no column peer',()=>{
 const {expandLayoutBlocks}=require('../core/pdf-layout.js');
 const width=794,height=1056,data=new Uint8ClampedArray(width*height*4).fill(255);
 const prose='The proposed method updates the survival predictions whenever a new measurement is recorded. '.repeat(3);
 const b=(id,x,y,w,h,text=prose,kind='body')=>({id,text,x,y,width:w,height:h,fontSize:13.3,kind});
 // Dynamic-DeepHit, even pages: "LEE et al.: DYNAMIC-DEEPHIT …" runs from the left margin past the centre.
 const page={width,height,blocks:[b('head',50.5,45,441.3,12,'LEE et al.: DYNAMIC-DEEPHIT: A DEEP LEARNING APPROACH FOR DYNAMIC SURVIVAL ANALYSIS'),
  b('l1',50.5,88,335.7,190),b('l2',50.5,280,335.7,280),b('note',63,600,250,14,'(3) A short list item in the left column.'),b('h',50.5,640,150,20,'B. Training','heading'),
  b('r1',401.2,88,335.8,300),b('r2',401.2,400,335.8,300),b('r3',401.2,720,200,40)]};
 const out=Object.fromEntries(expandLayoutBlocks(page,{width,height,data}).map(x=>[x.id,x]));
 for(const id of ['l1','l2','note','h'])assert.ok(out[id].x+out[id].width<=386.3,id+' '+(out[id].x+out[id].width));
 assert.ok(out.r3.x+out.r3.width<=737.1,'the right column stops at its own edge');
 // One long block per column (a figure page, entries cut short) still marks the gutter.
 const sparse={width,height,blocks:[b('l',72.7,763,320.5,250),b('cap',72.8,726,671.5,15,'Figure 4. Variable importance for the projection (VIP) plot showing results.','caption'),b('r',424,763,320.4,73),b('n',424,850,40,12,'[35]')]};
 const grown=Object.fromEntries(expandLayoutBlocks(sparse,{width,height,data}).map(x=>[x.id,x]));
 assert.ok(grown.l.x+grown.l.width<=393.3,String(grown.l.x+grown.l.width));
});
test('a dark one-colour panel is masked in its colour with light ink; a photo is not',()=>{
 const {backgroundSample}=require('../core/pdf-layout.js');
 const width=200,height=40,panel=new Uint8ClampedArray(width*height*4);
 for(let i=0;i<width*height;i++)panel.set([112,48,160,255],i*4);
 for(let y=10;y<30;y++)for(let x=20;x<180;x+=4)panel.set([255,255,255,255],(y*width+x)*4);
 const sample=backgroundSample({width,height,data:panel},{x:0,y:0,width,height});
 assert.equal(sample.safe,true);assert.equal(sample.ink,'rgb(255, 255, 255)');assert.equal(sample.color,'rgb(112, 48, 160)');
 const photo=new Uint8ClampedArray(panel);for(let y=0;y<height;y++)for(let x=100;x<200;x++)photo.set([20,90,30,255],(y*width+x)*4);
 assert.equal(backgroundSample({width,height,data:photo},{x:0,y:0,width,height}).safe,false);
 const white=new Uint8ClampedArray(width*height*4).fill(255);assert.equal(backgroundSample({width,height,data:white},{x:0,y:0,width,height}).ink,undefined);
});
test('bullet items set apart from their text are one paragraph each with a hanging indent',()=>{
 const {textLines,paragraphs}=require('../core/pdf-layout.js');
 const run=(text,x,baseline,width)=>({text,x,y:baseline-10,width,height:13.3,fontSize:13.3,baseline});
 const lines=textLines([run('•',102,880,7.9),run('A novel anomaly detection method based on VAE-GAN is proposed to detect anomalies in times',129.8,880,562.9),run('series data from sensors.',129.8,898,145),
  run('•',102,917.4,7.9),run('Our method jointly trains the encoder, the generator and the discriminator, which takes',129.8,917.5,562.9),run('discriminator simultaneously.',129.8,935.5,175.9),
  run('•',102,972.7,7.9),run('The anomaly score consists of the reconstruction difference of the VAE part and the',129.8,971.7,562.9)]);
 const blocks=paragraphs(lines,816,1056,2);
 assert.deepEqual(blocks.map(x=>x.text.slice(0,5)),['• A n','• Our','• The'],JSON.stringify(blocks.map(x=>x.text)));
});
test('a numbered line that breaks a word is a list item, not a heading; a scanned frame read as text joins no prose',()=>{
 const {textLines,paragraphs}=require('../core/pdf-layout.js');
 // Nomikos & MacGregor p10: scanned text without its spaces, so the first line has few "words".
 const line=(text,x,y,width)=>({text,x,y,baseline:y+12,width,height:16,fontSize:13.3,bold:false});
 const blocks=paragraphs([line('2. A secondapproach is toassumethat thefuture de-',415,833,288),line('viations from themean trajectories willremain for the rest',398,850,309),line('ofthebatch duration attheir current valuesattime interval',398,867,316),line('4.1 Results',398,920,90)],816,1056,10);
 const item=blocks.find(b=>b.text.startsWith('2. A second'));
 assert.equal(item.kind,'body');assert.match(item.text,/future deviations from .* interval$/);assert.equal(blocks.find(b=>b.text==='4.1 Results').kind,'heading');
 // p7: the figure's frame "|~~~~" spreads over the gutter into the right column's line.
 const run=(text,x,baseline,width,fontSize=13.3)=>({text,x,y:baseline-fontSize*.8,width,height:fontSize,fontSize,baseline});
 const lines=textLines([run('measurements',404,319,93),run('are',485,319,17),run('typical of a successful batch and still',505,319,208),run('|~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~',354,324,230,14.7)]);
 assert.deepEqual(lines.map(l=>l.text),['measurements are typical of a successful batch and still']);assert.equal(Math.round(lines[0].x),404);
});
test('an old block that reached over a scanned frame maps into today\'s paragraph; one over another paragraph does not',()=>{
 const {reconcilePage}=require('../core/pdf-layout.js');
 const b=(id,x,y,width,height,text,translation)=>({id,x,y,width,height,fontSize:13.3,kind:'body',text,translation});
 // Nomikos & MacGregor p7: the line was translated glued to the figure's frame "|~~~~".
 const cached={width:816,height:1056,blocks:[b('a',404,179,318,127,'A second MPCA analysis … nothing','두 번째 MPCA 분석은 … 없다'),b('frame',354,307,360,17,'|~~~~ measurements are typical of a successful batch and still','측정값은 성공적인 배치의 전형이지만'),b('c',403,322,317,237,'the product may not meet …','제품이 기준을 충족하지 못할 수 있다 …')]};
 const now={width:816,height:1056,blocks:[b('fig',177,323,138,1,'* x l w l |'),b('p',403,179,319,381,'A second MPCA analysis … the product may not meet …')]};
 const result=reconcilePage(cached,now),p=result.blocks.find(x=>x.sourceIds?.includes('a'));
 assert.deepEqual(p.sourceIds,['a','frame','c']);assert.equal(p.translation,'두 번째 MPCA 분석은 … 없다 측정값은 성공적인 배치의 전형이지만 제품이 기준을 충족하지 못할 수 있다 …');assert.ok(!p.mappingUncertain);
 // The part outside today's paragraph lies on the left column's text: that old block is ambiguous.
 const busy={...now,blocks:[...now.blocks,b('left',68,300,321,40,'left column prose')]};
 assert.ok(reconcilePage(cached,busy).blocks.some(x=>x.id==='frame'&&x.mappingUncertain));
});
test('equations with index words, braces and Elsevier "6" stay source; a nomenclature is kept like a table',()=>{
 const {formulaOnly,layoutBlocks,tableCellIds,repairMath}=require('../core/pdf-layout.js');
 // Flores-Cerrillo & MacGregor p5: subscripts "sp" and "present" are indices, not words.
 const eq={kind:'formula',text:'(ŷ − ysp)TQ1(ŷ − ysp) + ΔtTQ2Δt |{z}min Δt(θi) ŷT = (Δt + t̂present) Q st Δtmin ≤ Δt ≤ Δtmax',rich:'(ŷ − y<sub>sp</sub>)<sup>T</sup>Q<sub>1</sub>(ŷ − y<sub>sp</sub>) + Δt<sup>T</sup>Q<sub>2</sub>Δt |{z}min Δt(θ<sub>i</sub>) ŷ<sup>T</sup> = (Δt + t̂<sub>present</sub>) Q st Δtmin ≤ Δt ≤ Δtmax'};
 assert.equal(formulaOnly(eq),true);
 assert.equal(formulaOnly({text:'1 T Δt HΔt + fTΔt |{z}min 2 Δt(θi)'}),true,'a narrow underbrace is drawn, not prose');
 // Prose stays prose: a lead word, a scripted span that swallowed words, an ordinary sentence.
 assert.equal(formulaOnly({text:'Substituting xT2 = (tT + aT)PT2 in (19):',rich:'Substituting x<sup>T</sup><sub>2</sub> = (t<sup>T</sup> + a<sup>T</sup>)P<sup>T</sup><sub>2</sub> in (19):'}),false);
 assert.equal(formulaOnly({text:'(xm;measured) available up to time θi (0 ≤ θ ≤ θi); unmea-',rich:'(x<sub>m;measured) available up to time</sub> θ<sub>i</sub> (0 ≤ θ ≤ θ<sub>i</sub>); unmea-'}),false);
 assert.equal(repairMath('Δtmin 6 Δt 6 Δtmax and (0 6 d 6 1), but 6 patients'),'Δtmin ≤ Δt ≤ Δtmax and (0 ≤ d ≤ 1), but 6 patients');
 // p6 (12): "ΔtᵀΔt" over "min" and "st" beside the equation are part of it; "and" between equations is a word.
 const b=(id,x,y,width,height,text,extra={})=>({id,x,y,width,height,fontSize:13.3,kind:'body',text,...extra});
 const page={width:816,height:1056,blocks:[b('min',419,268,25,30,'|{z}min Δt(θi)',{kind:'formula'}),b('obj',458,265,34,16,'ΔtTΔt'),b('st',418,312,11,13,'st'),b('con',462,309,129,19,'yTsp = (Δt + t̂present)TQ',{kind:'formula'}),b('and',418,330,25,13,'and'),
  b('where',57,657,304,19,'where uT = b1 + b2(Δt + t̂present)T + b3(ΔtT + t̂presentT)2.',{rich:'where u<sup>T</sup> = b<sub>1</sub> + b<sub>2</sub>(Δt + t̂<sub>present</sub>)<sup>T</sup> + b<sub>3</sub>(Δt<sup>T</sup> + t̂<sub>present</sub><sup>T</sup>)<sup>2</sup>.'}),
  b('prose',57,700,320,60,'where Q1 is a diagonal weighting matrix defining the relative importance of the variables and Q2 a movement suppression matrix.')]};
 const out=Object.fromEntries(layoutBlocks(page).map(x=>[x.id,x.sourceOnly]));
 assert.deepEqual(out,{min:true,obj:true,st:true,con:true,and:false,where:true,prose:false});
 // p2: symbols beside their meanings under "Nomenclature", down to the first paragraph of sentences.
 const nom={width:816,height:1056,blocks:[b('title',81,108,79,13,'Nomenclature'),b('sym',81,140,10,45,'A E f'),b('mean',129,139,259,60,'number of principal components residual matrix number of on-line measurements'),
  b('greek',418,402,83,93,'Greek symbols k h d a b'),b('next',68,636,320,157,'strategies are difficult to implement because they are computationally intensive. Recently, Bonvin and co-workers proposed a method.'),b('right',418,636,320,316,'to be taken. The approach often used in these cases is to segment the MVTs into a small number of intervals.')]};
 assert.deepEqual([...tableCellIds(nom)].sort(),['greek','mean','sym']);
});
test('a heading grows past display equations on a single-column page; "where" beside an equation and equation lines keep their source; a short sentence with symbols is translated',()=>{
 const {expandLayoutBlocks,layoutBlocks,formulaOnly}=require('../core/pdf-layout.js');
 const b=(id,x,y,width,height,text,extra={})=>({id,x,y,width,height,fontSize:13.3,kind:'body',text,...extra});
 // Auto-Encoding Variational Bayes p12: "F  Full VB" with equation (13) indented further down.
 const white={width:816,height:1056,data:new Uint8ClampedArray(816*1056*4).fill(255)};
 const page={width:816,height:1056,blocks:[b('f',144,665,11,16,'F',{kind:'heading',fontSize:15.9}),b('h',170,665,55,16,'Full VB',{kind:'heading',fontSize:15.9}),
  b('p',144,698,529,60,'As written in the paper, it is possible to perform variational inference on both the parameters θ and the latent variables z.'),
  b('eq',275,770,390,16,'log pα(X) = DKL(qφ(θ)||pα(θ|X)) + L(φ; X) (13)',{kind:'formula'})]};
 assert.ok(expandLayoutBlocks(page,white).find(x=>x.id==='h').width>300,'the heading may take the line');
 // p12 and p14: "where" set beside its equation is part of it.
 const beside={width:816,height:1056,blocks:[b('w',445,422,33,13,'where'),b('z',495,419,93,17,'z(l) ∼ pθ(z|x(i))',{kind:'formula'}),b('ww',483,356,35,32,'where where'),b('n',532,355,69,33,'ζ ∼ N(0, I) ε ∼ N(0, I)',{kind:'formula'})]};
 assert.deepEqual(layoutBlocks(beside).filter(x=>['w','ww'].includes(x.id)).map(x=>x.sourceOnly),[true,true]);
 // Equation lines: Greek symbols and operators only; a numbered equation with "where" in it.
 assert.equal(formulaOnly({text:'1 + log((σθ,j)2) − (μθ,j)2 − (σθ,j)2'}),true);
 assert.equal(formulaOnly({text:'log p(x|z) = log N(x; μ, σ2I) where μ = W4h + b4 log σ2 = W5h + b5 h = tanh(W3z + b3) (12)'}),true);
 assert.equal(formulaOnly({text:'Let Xi = (Xi, Mi, Δi) where Xi = {xi1, . . . , xiJi} which is a sequence'}),false,'an unnumbered line with "where" is prose');
 assert.equal(formulaOnly({text:'α-synuclein aggregation in neurons'}),false);
 // p14: a sentence with a few symbols is translated in place, not moved below the page.
 const sentence={width:816,height:1056,blocks:[b('s',148,342,365,18,'μj and σj(i) simply denote the j-th element of vectors μ(i) and σ(i).')]};
 assert.equal(layoutBlocks(sentence)[0].preserveSource,false);
});
test('a heading that runs on into a lower-case line is a paragraph or a wrapped title; a caption keeps its legend but not the table header row',()=>{
 const {textLines,paragraphs}=require('../core/pdf-layout.js');
 const line=(text,x,y,width,fontSize=13.3)=>({text,x,y,baseline:y+fontSize*.8,width,height:fontSize,fontSize,bold:false});
 const body=['The reference distribution is built from the normal batches in the database and the','control limits follow from it, and each new batch is then compared with these limits','at every time interval of the batch, so that a fault is seen while the batch is running','and its operation can still be corrected by the operators before the batch is finished.'].map((t,i)=>line(t,64,400+17*i,320));
 // Multivariate SPC p12 (scan): "3. Thelastapproach … tohandle" / "missing data. …" is an item's first line.
 const item=paragraphs([line('3. Thelastapproach usestheability ofPCA tohandle',81,115,294),line('missing data.Theunknown future observations canberegarded as',64,132,320),...body],816,1056,12);
 assert.equal(item[0].kind,'body');assert.match(item[0].text,/tohandle missing data/);
 // DSGraphformer p8: a section heading wrapped onto a short line stays a heading.
 const wrapped=paragraphs([line('4.3. Construction of the erythromycin fermentation process knowledge',50,300,330),line('graph',50,317,32),...body],816,1056,8);
 assert.equal(wrapped[0].kind,'heading');assert.match(wrapped[0].text,/knowledge graph$/);
 // A title over three lines is one heading.
 const title=paragraphs([line('Deep learning-guided discovery of an antibiotic targeting',60,120,600,26),line('acinetobacter baumannii in the laboratory',60,152,420,26),line('and in mice',60,184,140,26),...body],816,1056,1);
 assert.equal(title[0].kind,'heading');assert.equal(title[0].text,'Deep learning-guided discovery of an antibiotic targeting acinetobacter baumannii in the laboratory and in mice');
 // Data fusion p5: the caption ends; "Data type   Num. of variables   Pre-processing …" is the table's header row.
 const run=(text,x,baseline,width,fontSize=10.6)=>({text,x,y:baseline-fontSize*.8,width,height:fontSize,fontSize,baseline});
 const table=paragraphs(textLines([run('Table 2',154,82,30),run('Overview of pre-processing steps before and after DF of the IndPenSim',188,82,280),run('data set.',154,95,34),run('Data type',158,108,40),run('Num. of variables',264,108,70),run('Pre-processing before fusion',374,108,109)]),816,1056,5);
 assert.deepEqual(table.map(b=>b.text),['Table 2 Overview of pre-processing steps before and after DF of the IndPenSim data set.','Data type','Num. of variables','Pre-processing before fusion']);
 // Control of batch p8: a legend's line samples are a few ems apart and stay in the caption.
 const legend=paragraphs(textLines([run('Fig. 3. Predictions of the missing measurements made at the first de-',418,632,320),run('cision point (35 min) using different missing data imputation methods:',418,645,320),run('(-·-)',418,658,21),run('expectation-maximisation',448,658,118),run('(EM),',575,658,29),run('(-h-)',613,658,24),run('iterative-imputation',647,658,92)]),816,1056,8);
 assert.equal(legend.length,1,JSON.stringify(legend.map(b=>b.text)));
});
test('author-year references run on in indented lines; an old translation is not repeated, and cells kept as source today stay source',()=>{
 const {paragraphs,reconcilePage,layoutBlocks}=require('../core/pdf-layout.js');
 const line=(text,x,y,width,fontSize=8.5)=>({text,x,y,baseline:y+fontSize*.8,width,height:fontSize,fontSize,bold:false});
 // Data fusion p15 and DSGraphformer p12: entries with hanging lines, and one-line entries in a row.
 const refs=paragraphs([line('Azcarate, S.M., Ríos-Reina, R., Amigo, J.M., Goicoechea, H.C., 2021. Data handling',50,171,336),line('in data fusion: Methodologies and applications. TRAC Trends Anal. Chem. 143,',66,183,320),line('116355.',66,194,32),
  line('Babmoradi, H., van den Berg, F., Rinnan, A., 2016. Confidence limits for contribution',50,206,336),line('plots in multivariate statistical process control. Anal. Chim. Acta 908, 75–84.',66,217,320),
  line('Vaswani, A., et al., 2017. Attention is all you need. Adv. Neural Inf. Process. Syst. 30.',50,240,328),line('Wang, Q., Zhu, Y., Sun, Z., Li, D., Ma, Y., 2025. A multi-scale patch mixer network for',50,251,331),line('time series anomaly detection. Eng. Appl. Artif. Intell. 140, 109687.',66,262,300)],816,1056,15);
 assert.deepEqual(refs.map(b=>b.text.slice(0,9)),['Azcarate,','Babmoradi','Vaswani, ','Wang, Q.,']);assert.match(refs[0].text,/116355\.$/);
 // A first line once translated as the whole entry, its rest again: shown once.
 const b=(id,x,y,width,height,text,translation,extra={})=>({id,x,y,width,height,fontSize:8.5,kind:'body',text,translation,...extra});
 const cached={width:816,height:1056,blocks:[b('a',50,171,336,9,'Azcarate, S.M., …, 2021. Data handling','Azcarate, S.M., …, 2021. 데이터 융합에서의 데이터 처리: 방법론 및 응용. TRAC Trends Anal. Chem. 143, 116355.'),b('r',66,183,320,20,'in data fusion: Methodologies … 116355.','데이터 융합에서의 데이터 처리: 방법론 및 응용. TRAC Trends Anal. Chem. 143, 116355.')]};
 const merged=reconcilePage(cached,{width:816,height:1056,blocks:[b('e',50,171,336,34,'Azcarate, S.M., …, 2021. Data handling in data fusion: … 116355.')]});
 assert.equal(merged.blocks[0].translation,'Azcarate, S.M., …, 2021. 데이터 융합에서의 데이터 처리: 방법론 및 응용. TRAC Trends Anal. Chem. 143, 116355.');
 // Data fusion p5: header cells translated under a caption that took the header row stay source today.
 const old={width:816,height:1056,blocks:[b('c',154,74,315,37,'Table 2 Overview of pre-processing steps before and after DF of the IndPenSim data set. Data type','표 2 IndPenSim 데이터 세트의 전처리 단계 개요. 데이터 유형'),b('n',264,100,70,11,'Num. of variables','변수 수'),b('p',374,100,109,11,'Pre-processing before fusion','융합 전 전처리'),b('v',264,116,20,43,'22 2167 2189 23','22 2167 2189 23')]};
 const today={width:816,height:1056,blocks:[b('c',154,74,315,20,'Table 2 Overview of pre-processing steps before and after DF of the IndPenSim data set.'),b('d',158,100,38,9,'Data type'),b('n',264,100,70,9,'Num. of variables'),b('p',374,100,109,9,'Pre-processing before fusion'),b('v',264,116,20,43,'22 2167 2189 23')]};
 const shown=layoutBlocks(reconcilePage(old,today));
 assert.deepEqual(shown.filter(x=>['n','p'].includes(x.id)).map(x=>x.sourceOnly),[true,true]);
 assert.ok(shown.find(x=>x.text.startsWith('Table 2')).height<30,'the caption no longer covers the header row');
});
test('a slide panel in a soft gradient is masked in its average colour; a line split by math drawn as graphics stays one paragraph in its source',()=>{
 const {backgroundSample,paragraphs,layoutBlocks}=require('../core/pdf-layout.js');
 // [확률과통계] Week 2 p2: a pale blue-grey panel from 229,233,239 to 233,236,241 under black text.
 const width=400,height=100,data=new Uint8ClampedArray(width*height*4);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){const i=(y*width+x)*4,t=x/width,ink=y%20<6&&x%9<4;data.set(ink?[20,20,20,255]:[229+Math.round(4*t),233+Math.round(3*t),239+Math.round(2*t),255],i);}
 const sample=backgroundSample({data,width,height},{x:0,y:0,width,height});
 assert.equal(sample.safe,true);assert.match(sample.color,/^rgb\(23[01], 23[45], 24[01]\)$/);
 // Two pale panels apart in tone stay unsafe.
 for(let y=0;y<height;y++)for(let x=200;x<width;x++)data.set(y%20<6&&x%9<4?[20,20,20,255]:[200,215,235,255],(y*width+x)*4);
 assert.equal(backgroundSample({data,width,height},{x:0,y:0,width,height}).safe,false);
 // p2: "for every subset  [B = [a, b] drawn]  in the domain of data space. This can be" / "interpreted as …".
 const line=(text,x,y,width,fontSize=26.7)=>({text,x,y,baseline:y+fontSize*.8,width,height:fontSize,fontSize,bold:false});
 const slide=paragraphs([line('Random Variable',467,37,347,42.7),line('for every subset',51,564,257),line('in the domain of data space. This can be',467,564,641),line('interpreted as the integrated area under the graph of the PDF.',51,600,993)],1280,720,2);
 const p=slide.find(b=>b.text.startsWith('for every'));
 assert.equal(p.text,'for every subset ⟦g:2:308:564:159:27⟧ in the domain of data space. This can be interpreted as the integrated area under the graph of the PDF.');
 // The gap carries a placeholder for the drawing, so the paragraph is translated in place.
 assert.equal(layoutBlocks({width:1280,height:720,blocks:slide}).find(b=>b.id===p.id).preserveSource,false,'the math drawn in the gap goes into the translation as a picture');
 // A footnote line and a piece across a column gutter are not joined.
 const page=paragraphs([line('Sensors 2020, 20, 3738; doi:10.3390/s20133738',50,1000,300,9),line('www.mdpi.com/journal/sensors here and there',560,1000,200,9),
  line('In the left column the text runs on past',50,300,320,10.6),line('et al., a reference entry in the right column runs on here',450,300,300,10.6),line('and the left column ends its line just there.',50,313,320,10.6)],816,1056,1);
 assert.ok(page.some(b=>b.text.startsWith('www.mdpi')),JSON.stringify(page.map(b=>b.text)));assert.ok(page.some(b=>b.text.startsWith('et al.')));
});
test('a box grows only when its translation needs room, stops short of ink below it, and its mask does not reach over that ink',()=>{
 const {expandLayoutBlocks,maskPads}=require('../core/pdf-layout.js');
 // A white slide with an equation drawn as graphics (a black bar) 60 units under a paragraph.
 const width=800,height=600,data=new Uint8ClampedArray(width*height*4).fill(255);
 for(let y=300;y<330;y++)for(let x=100;x<500;x++)data.set([0,0,0,255],(y*width+x)*4);
 const pixels={width,height,data},b=(id,translation)=>({id,x:100,y:200,width:400,height:40,fontSize:16,linePitch:20,kind:'body',text:'For this reason, including and excluding the endpoints of an interval has no effect on probability:',translation});
 // Short Korean in two lines' room: the box keeps its size.
 const short=expandLayoutBlocks({width,height,blocks:[b('s','따라서 구간의 끝점은 확률에 영향을 미치지 않는다.')]},pixels)[0];
 assert.ok(short.width===400&&short.height<46&&!short.grown,JSON.stringify(short));
 // A long one grows down, stops two units before the bar and pads nothing over it.
 const long=expandLayoutBlocks({width,height,blocks:[b('l','따라서 구간의 끝점을 포함하는지 여부는 확률에 영향을 미치지 않으며, 이는 연속 확률변수에서 한 점의 확률이 0이기 때문이다. 이 성질은 이후의 모든 계산에서 쓰인다.')]},pixels)[0];
 assert.ok(long.y+long.height<=298&&long.height>40,JSON.stringify(long));
 const padded=maskPads({width,height},[long],pixels)[0];
 assert.ok(long.y+long.height+(padded.maskPad?.bottom||0)<300,'the mask stops short of the equation');
});
test('the library snapshot marks papers translated in the app; cache names stay safe',async t=>{
 const f=await fixture(t);assert.equal((await f.library.snapshot()).papers[0].hasTranslation,false);
 const jobs=new TranslationJobs(authFor(async(_m,blocks)=>translated(blocks)));const job=await jobs.start(f.library,f.paperId,f.hash,[pageAt(1)],'model');await until(()=>jobs.result(job.id).state==='completed');
 const snapshot=await f.library.snapshot();assert.equal(snapshot.papers[0].hasTranslation,true);assert.equal(snapshot.papers[0].translated,undefined);
 const {translationFileName}=require('../desktop/storage.cjs');
 assert.equal(path.basename(jobs.file(f.library,f.paperId)),translationFileName(f.paperId,f.library.attachment(f.paperId)),'one name for the cache and the library');
 assert.equal(translationFileName(1,{id:'../x'}),null);assert.equal(translationFileName('x',{id:'a'}),null);
});
test('a full-width table above two-column prose keeps only its cells (Nature Chem. Biol. p.5)',()=>{
 const {tableCellIds}=require('../core/pdf-layout.js');
 const b=(id,x,y,width,height,text,extra={})=>({id,text,x,y,width,height,fontSize:8.5,kind:'body',...extra});
 const prose='ciprofloxacin at their respective MIC concentrations in A. baumannii ATCC 17978 (Extended Data Fig. 2a). As expected, ampicillin and ciprofloxacin displayed antibacterial activity across a wide range of commensal isolates, whereas abaucin largely avoided growth inhibition of commensal species.';
 const blocks=[b('cap',40,40,520,10,'Table 1 | Growth inhibition by abaucin and analogues',{kind:'caption',fontSize:7.5})];
 for(let r=0;r<4;r++){blocks.push(b('s'+r,60,60+r*60,30,8,String(r+1),{fontSize:6}));for(let c=0;c<4;c++)blocks.push(b(`c${r}${c}`,240+c*80,60+r*60,50,7,'>128 μg ml−1',{fontSize:6}));}
 blocks.push(b('note',40,300,520,18,'Growth inhibition of bacterial species by abaucin and analogs thereof. Cells were grown in LB in the presence of varying concentrations of each molecule at 37 °C and the MIC of each was determined.',{fontSize:5.5}));
 blocks.push(b('left',40,330,250,130,prose),b('right',310,330,250,130,prose),b('head',40,470,200,10,'Abaucin inhibits lipoprotein trafficking in A. baumannii',{kind:'subheading'}),b('left2',40,485,250,130,prose));
 const ids=tableCellIds({width:600,height:800,blocks});
 for(const id of ['left','right','note','left2','cap'])assert.ok(!ids.has(id),id+' is translated');
 assert.equal([...ids].filter(id=>/^c\d\d$/.test(id)).length,16);
});
test('a unit after μ is no formula, and a number after a Korean prefix counts as kept',()=>{
 const {mathDense}=require('../core/pdf-layout.js'),{reviewTranslation}=require('../core/translation-quality.cjs');
 for(const label of ['Cell width (μm)','Concentration (μg ml−1)','Dose (μM)'])assert.equal(mathDense(label),false,label);
 for(const math of ['x ∼ N(μ, σ)','α + β = γ'])assert.equal(mathDense(math),true,math);
 assert.deepEqual(reviewTranslation('Nature Chemical Biology | Volume 19 | November 2023 | 1342–1350','네이처 케미컬 바이올로지 | 제19권 | 2023년 11월 | 1342–1350'),[]);
 assert.deepEqual(reviewTranslation('About 5-fold higher in 53 isolates.','53개 분리주에서 약5배 높았다.'),[]);
 assert.deepEqual(reviewTranslation('The A362T variant appeared in 4 mutants.','A362T 변이가 돌연변이에서 나타났다.'),['숫자·인용 확인: 4'],'a number really left out is still reported');
});
test('a box short of room after growing right and down grows left, then up, into blank space only',()=>{
 const {expandLayoutBlocks,layoutCollisions,maskPads}=require('../core/pdf-layout.js');
 const width=612,height=792,data=new Uint8ClampedArray(width*height*4).fill(255);
 const block=(id,x,y,w,h,text,extra={})=>({id,text,x,y,width:w,height:h,fontSize:9,kind:'body',...extra});
 // A centred notice right above the title, over the page's prose column.
 const notice=block('notice',150,60,312,22,'Provided the source is credited, the authors permit copying the tables and figures for teaching only.',{translation:'출처를 밝히는 경우에 한하여 저자는 이 원고의 표와 그림을 교육이나 보도 목적으로만 복제하는 것을 허락하며 그 밖의 목적으로 사용하려면 별도의 허락을 받아야 한다.'});
 const title=block('title',180,86,250,20,'A Study of Attention Layers',{fontSize:17,kind:'title'});
 const prose=block('body',108,140,396,120,'The proposed encoder maps each token to a learned representation of fixed size. '.repeat(4));
 const page={width,height,blocks:[notice,title,prose]};
 const out=expandLayoutBlocks(page,{width,height,data}),n=out.find(b=>b.id==='notice');
 assert.ok(n.x<notice.x&&n.x>=prose.x,'grows left, not past the text area: '+n.x);
 assert.ok(n.y<notice.y&&n.y>=12,'grows up within the top margin: '+n.y);
 assert.ok(n.y+n.height<=title.y,'never into the title below');
 assert.equal(n.grown.left,true);assert.equal(n.grown.top,true);
 assert.equal(layoutCollisions(out).size,0);
 const padded=maskPads(page,out,{width,height,data}).find(b=>b.id==='notice');
 assert.ok(!padded.maskPad||padded.maskPad.top<=1&&padded.maskPad.left<=1,'a side grown into blank space ends in it');
 // Ink above (a rule, a running head drawn as graphics) stops the growth.
 const ruled=new Uint8ClampedArray(data);for(let x=100;x<520;x++)ruled.set([0,0,0,255],(50*width+x)*4);
 assert.ok(expandLayoutBlocks(page,{width,height,data:ruled}).find(b=>b.id==='notice').y>50);
 // A translation that fits keeps its box where it is.
 const short=expandLayoutBlocks({...page,blocks:[{...notice,translation:'짧은 안내문.'},title,prose]},{width,height,data}).find(b=>b.id==='notice');
 assert.equal(short.x,notice.x);assert.equal(short.y,notice.y);
 // Growing up never takes a strip a block above has grown into.
 const above=block('above',150,20,312,12,'An upper line of the same width that grows down into the gap.',{translation:'위쪽 줄의 번역이 길어서 아래 빈 공간으로 넓어져야 하는 경우를 흉내 내는 아주 긴 한국어 문장입니다.'});
 const both=expandLayoutBlocks({...page,blocks:[above,notice,title,prose]},{width,height,data});
 assert.equal(layoutCollisions(both).size,0);
});
test('layout collisions name what each block met',()=>{
 const {layoutBlocks,layoutCollisions}=require('../core/pdf-layout.js');
 const blocks=layoutBlocks({width:600,height:800,blocks:[
  {id:'p',text:'A GP is fully defined by a mean function and a covariance function for every input.',x:100,y:100,width:400,height:60,fontSize:13,kind:'body'},
  {id:'q',text:'Another paragraph overlaps the first one by mistake in this layout.',x:100,y:120,width:400,height:40,fontSize:13,kind:'body'}]});
 const collisions=layoutCollisions(blocks),met=collisions.partners.get('p');
 assert.equal(met.length,1);assert.equal(met[0].id,'q');assert.ok(met[0].overlap[1]>2);assert.equal(met[0].with.length,4);
});
test('a run-in heading over one closing line keeps the rest of its first line',()=>{
 const {textLines,paragraphs}=require('../core/pdf-layout.js');
 const run=(x,baseline,width,text,size=13.3)=>({x,y:baseline-size*.7,width,height:size,fontSize:size,baseline,text,fontName:'serif'});
 const runs=[
  run(144,300,529,'An earlier paragraph of the same column fills the whole measure of its lines here.'),
  run(144,314.6,529,'Its second line also runs from the left margin all the way to the right margin.'),
  // "Label Smoothing" | "During training … with a script ϵls … This" | "hurts perplexity …"
  run(144,451.9,100.3,'Label Smoothing'),run(256.6,451.9,303.7,'During training, we used smoothing of value'),run(562.9,451.9,6.4,'ϵ'),run(568.3,453.9,9.4,'ls',9.3),run(581.7,451.9,90,'= 0.1 [36]. This'),
  run(144,466.4,512.6,'raises perplexity, as the model learns to be less certain, but improves the score.')];
 const blocks=paragraphs(textLines(runs),816,1056,0),joined=blocks.find(b=>/^Label Smoothing During training/.test(b.text));
 assert.ok(joined,JSON.stringify(blocks.map(b=>b.text)));
 assert.match(joined.text,/This\s+raises perplexity/);
 assert.equal(blocks.filter(b=>/During training/.test(b.text)).length,1);
 // A piece across the gutter (the other column on that baseline) is not this line's.
 const two=[run(60,300,330,'Left column prose runs across its whole measure in this example line.'),run(60,314.6,330,'The left column continues here with another line of the same width.'),
  run(60,451.9,90,'Label Smoothing'),run(160,451.9,230,'During training we smooth the labels and this'),run(60,466.4,200,'closes the paragraph here.'),
  run(420,451.9,330,'Right column prose starts on the same baseline in the other column.'),run(420,466.4,330,'and the right column continues on the next line of the page too.')];
 const out=paragraphs(textLines(two),816,1056,0);
 assert.ok(!out.some(b=>/this Right column/.test(b.text.replace(/\n/g,' '))),JSON.stringify(out.map(b=>b.text)));
 // Nor the next column's heading, when a full-width block (an abstract) makes the left column look as wide as the page.
 const wide=[run(60,200,690,'A full-width abstract line runs across both columns of the page at the very top here.'),run(60,214.6,690,'The abstract continues across both columns for a second line before the columns start.'),
  run(60,300,330,'Left column prose runs across its whole measure in this example line.'),run(60,314.6,330,'The left column continues with the importance of the measure here and'),
  run(420,314.6,170,'B. Training the Model'),run(420,340,330,'To train the model we minimise a total loss that is defined below here.'),run(420,354.6,330,'and the right column continues on the next line of the page as well.')];
 const cols=paragraphs(textLines(wide),816,1056,0);
 assert.ok(cols.some(b=>/^B\. Training the Model/.test(b.text)),JSON.stringify(cols.map(b=>b.text)));
 // Table cells on one baseline stay apart, even beside prose of the full measure.
 const table=[run(60,300,690,'Prose of the full measure runs across the page above the table in this example.'),run(60,330,22,'Num.'),run(96,330,60,'Category'),run(200,330,40,'Value')];
 const cells=paragraphs(textLines(table),816,1056,0);
 assert.ok(!cells.some(b=>/Num\.\s+Category/.test(b.text)),JSON.stringify(cells.map(b=>b.text)));
});
test('a single glyph inside a paragraph (a math font\'s ∑ read as "P") is part of it',()=>{
 const {layoutBlocks,layoutCollisions}=require('../core/pdf-layout.js');
 const note={id:'n',text:'4To see why the products grow, assume the entries are independent with mean 0 and variance 1. Then their product, q · k = di=1k qiki, has mean 0.',x:143.7,y:934.4,width:529.3,height:31.7,fontSize:12,kind:'body'};
 const blocks=layoutBlocks({width:816,height:1056,blocks:[note,{id:'sum',text:'P',x:478.5,y:943.9,width:14,height:12,fontSize:12,kind:'body'}]});
 assert.equal(blocks.find(b=>b.id==='sum').sourceOnly,true);
 assert.deepEqual([...layoutCollisions(blocks)],[]);
 // A wide piece or one reaching out of the paragraph still keeps the source.
 const outside=layoutBlocks({width:816,height:1056,blocks:[note,{id:'wide',text:'∑ki',x:478.5,y:955,width:60,height:20,fontSize:12,kind:'body'}]});
 assert.deepEqual([...layoutCollisions(outside)],['n']);
});
test('a reference entry opening with a year keeps its number',()=>{
 const {textLines,paragraphs}=require('../core/pdf-layout.js');
 const run=(x,baseline,width,text,size=10.7)=>({x,y:baseline-size,width,height:size,fontSize:size,baseline,text,fontName:'sans'});
 const runs=[run(52.9,231.7,7.9,'1.'),run(75.6,231.7,315,'Lee, A. & Kim, B. A study of growing cultures in fed-batch reactors.'),run(75.6,246,220,'Biotechnol. J. 71, 292–301 (2014).'),
  run(52.9,260.4,9.7,'2.'),run(75.6,260.4,314.5,'2020 Antibacterial Agents in Clinical and Preclinical Development:'),run(75.6,274.7,290,'An Overview and Analysis (World Health Organization, 2021);'),
  run(52.9,303.4,10.1,'3.'),run(75.6,303.4,300,'Park, C. Where will new antibiotics come from? Nat. Rev. 1, 65 (2003).')];
 const blocks=paragraphs(textLines(runs),816,1056,0);
 assert.ok(blocks.some(b=>/^2\. 2020 Antibacterial/.test(b.text)),JSON.stringify(blocks.map(b=>b.text)));
 assert.ok(!blocks.some(b=>b.text.trim()==='2.'));
 assert.ok(!blocks.some(b=>/2014\)\.\s+2020/.test(b.text)),'entry 2 is not part of entry 1');
});
test('a piece set after a wandering line\'s end follows that end\'s baseline',()=>{
 const {textLines,paragraphs}=require('../core/pdf-layout.js');
 const run=(x,baseline,width,text,size=13.3)=>({x,y:baseline-size,width,height:size,fontSize:size,baseline,text,fontName:'sans'});
 // An OCR line climbs from 590.9 to 593; "gXh2" after its end sits 7 below its start.
 const runs=[run(399,580,314.5,'Let x be an observation vector from a population and the eigenvalues of S.'),
  run(399.7,590.9,160,'significance level are given by'),run(560,592,78,'(Box 1954)'),run(638,592.1,33,'Qa ='),run(671.5,597.9,34.8,'gXh2'),
  run(399.4,606.6,300,'and the approximation that follows holds for all of the levels.')];
 const blocks=paragraphs(textLines(runs),816,1056,0);
 assert.ok(!blocks.some(b=>b.text.trim()==='gXh2'),JSON.stringify(blocks.map(b=>b.text)));
});
test('text in the blank corner of a several-row source block is not covered by it',()=>{
 const {layoutBlocks,layoutCollisions}=require('../core/pdf-layout.js');
 // Two code rows, the second short; its comment sits right of it, inside the rows' bounding box.
 const code={id:'code',text:'d = {"user": request.args["id"], "role": "guest"} os.system("ls " + d["role"])',x:14.5,y:245.9,width:342.7,height:29.2,fontSize:13.3,kind:'formula',keepSource:true,rows:[[14.5,245.9,342.7,13.3],[14.5,261.8,196.3,13.3]]};
 const comment={id:'c',text:'# field-insensitive: alarm',x:244.6,y:261.8,width:182.3,height:13.3,fontSize:13.3,kind:'body'};
 const blocks=layoutBlocks({width:960,height:540,blocks:[code,comment]});
 assert.equal(blocks.find(b=>b.id==='code').sourceOnly,true);
 assert.deepEqual([...layoutCollisions(blocks)],[]);
 // Text over one of the rows still keeps the source.
 const over=layoutBlocks({width:960,height:540,blocks:[code,{...comment,x:150}]});
 assert.deepEqual([...layoutCollisions(over)],['c']);
});
test('the leading allowance under a box stops above a drawn rule, and a paragraph at its column edge does not grow left',()=>{
 const {expandLayoutBlocks,layoutCollisions}=require('../core/pdf-layout.js');
 const width=600,height=400,data=new Uint8ClampedArray(width*height*4).fill(255);
 // A code panel's bottom border 2 units under a comment line (no block there).
 for(let x=10;x<480;x++)data.set([0,0,0,255],(277*width+x)*4);
 const comment={id:'c',text:'# field-insensitive: alarm',translation:'# 필드 비민감: 경고',x:244.6,y:261.8,width:182.3,height:13.3,fontSize:13.3,kind:'body'};
 const out=expandLayoutBlocks({width,height,blocks:[comment]},{width,height,data}).find(b=>b.id==='c');
 assert.ok(out.y+out.height<277,'stops above the rule: '+(out.y+out.height));assert.ok(out.height>=13.3);
 // A right-column paragraph with blank space to its left (the gutter of a scan where none was found).
 const blank=new Uint8ClampedArray(width*height*4).fill(255);
 const para={id:'p',text:'Let x be an observation vector from a population and its eigenvalues. '.repeat(3),translation:'관측 벡터와 고윳값에 대한 아주 긴 한국어 번역 문장이 원래 상자보다 훨씬 많은 자리를 필요로 하는 경우입니다. '.repeat(4),x:320,y:100,width:260,height:60,fontSize:12,kind:'body'};
 const left={id:'l',text:'The left column paragraph runs down beside the right column for many lines. '.repeat(3),x:20,y:100,width:280,height:200,fontSize:12,kind:'body'};
 const below={id:'b',text:'The right column continues below with another paragraph at the same edge. '.repeat(3),x:320,y:170,width:260,height:80,fontSize:12,kind:'body'};
 const grown=expandLayoutBlocks({width,height,blocks:[left,para,below]},{width,height,data:blank});
 assert.equal(grown.find(b=>b.id==='p').x,320,'a paragraph at its column edge keeps that edge');
 assert.equal(layoutCollisions(grown).size,0);
});
test('a display fraction keeps its left side apart from the numerator, so both rows stay in place',()=>{
 const {textLines,paragraphs,layoutBlocks,layoutCollisions}=require('../core/pdf-layout.js');
 const run=(x,baseline,width,text,size=10.6)=>({x,y:baseline-size,width,height:size,fontSize:size,baseline,text,fontName:'sans'});
 const runs=[run(408.8,555.4,6.8,'ri'),run(418.2,555.4,9.2,'='),run(434.6,548.2,179.9,'number of reference data points in bin i'),run(452.4,562.7,144.4,'number of reference data points')];
 const blocks=paragraphs(textLines(runs),816,1056,0);
 assert.ok(blocks.some(b=>b.text==='number of reference data points in bin i'),JSON.stringify(blocks.map(b=>b.text)));
 assert.deepEqual([...layoutCollisions(layoutBlocks({width:816,height:1056,blocks}))],[]);
});
test('a field label joins its value set in a second column',()=>{
 const {textLines,paragraphs}=require('../core/pdf-layout.js');
 const run=(x,baseline,width,text,size=12)=>({x,y:baseline-size,width,height:size,fontSize:size,baseline,text,fontName:'sans'});
 const runs=[run(420.6,916.5,47.7,'Received:'),run(478.6,916.5,75.5,'March 27, 2023'),run(420.6,931.1,41.8,'Revised:'),run(478.6,931.1,66,'May 27, 2023'),run(420.6,945.8,48.8,'Accepted:'),run(478.6,945.8,60.7,'June 1, 2023')];
 const blocks=paragraphs(textLines(runs),816,1056,0);
 assert.equal(blocks.length,1,JSON.stringify(blocks.map(b=>b.text)));
 assert.match(blocks[0].text,/^Received: March 27, 2023 Revised: May 27, 2023/);
});
test('a brace drawn from a math font\'s extension pieces is no text; pieces with their own code points stay',()=>{
 const {textLines}=require('../core/pdf-layout.js');
 const run=(x,baseline,text,size=13.3)=>({x,y:baseline-size,width:8.4,height:size,fontSize:size,baseline,text,fontName:'sans'});
 const brace=[run(83.8,168.1,'l'),...Array.from({length:16},(_,i)=>run(83.8,172.4+i*3.6,'o')),run(83.8,230.5,'m')];
 const prose={x:92.3,y:171.4,width:200,height:13.3,fontSize:13.3,baseline:184.7,text:'F M( k) = G one formula line',fontName:'sans'};
 assert.ok(!textLines([...brace,prose]).some(l=>/^[lomn ]+$/.test(l.text.trim())||/oo/.test(l.text)),'the pieces leave the text');
 const unicode=[...Array.from({length:6},(_,i)=>run(50,290+i*3.6,'⎪'))];
 assert.ok(textLines([...unicode,prose]).some(l=>l.text.includes('⎪')),'⎪ pieces stay');
});
test('a table of contents keeps each number, letter and title in its own row',()=>{
 const {textLines,paragraphs,layoutBlocks,layoutCollisions}=require('../core/pdf-layout.js');
 const run=(x,baseline,width,text,size=13.3)=>({x,y:baseline-size,width,height:size,fontSize:size,baseline,text,fontName:'serif'});
 const runs=[run(143.5,208.5,10.6,'A'),run(166.4,208.5,151.5,'EXPERIMENT DETAILS'),run(167.2,229.9,20.6,'A.1'),run(200.1,229.9,145.5,'Gaussian kernel smoothing'),
  run(167.2,257.7,20.6,'A.2'),run(200.1,257.7,65.7,'DATASETS'),run(144,633.8,9.9,'E'),run(166,633.8,177,'Coarse To Fine Reconstruction'),run(144,655,9.1,'F'),run(166,655,120,'GC-TSG Generation')];
 const blocks=paragraphs(textLines(runs),816,1056,0);
 assert.ok(!blocks.some(b=>/DETAILS\s+A\.1/.test(b.text)),JSON.stringify(blocks.map(b=>b.text)));
 assert.ok(!blocks.some(b=>/Reconstruction\s+F\b/.test(b.text)),JSON.stringify(blocks.map(b=>b.text)));
 assert.deepEqual([...layoutCollisions(layoutBlocks({width:816,height:1056,blocks}))],[]);
 // A decimal in a table is no section number: a value under its column head stays with it.
 const cells=paragraphs(textLines([run(300,400,40,'Top-1 acc.'),run(300,418,25,'82.1')]),816,1056,0);
 assert.equal(cells.length,1,JSON.stringify(cells.map(b=>b.text)));
});
test('a tall glyph over this line\'s words does not stretch its box into the next line',()=>{
 const {textLines}=require('../core/pdf-layout.js');
 const run=(x,baseline,width,text,size=13.3,top)=>({x,y:top??baseline-size*.7,width,height:size,fontSize:size,baseline,text,fontName:'sans'});
 const lines=textLines([run(140,192.7,533,'The resulting token sequence is decoded back to the representation at'),run(346.3,198.8,7.1,'\u0000',13.3,190.8),
  run(159.9,209.6,165,'granularity level j, i.e., x = DEC'),run(352.4,209.6,100,'Q1:ni and more')]);
 const first=lines.find(l=>/resulting/.test(l.text)),second=lines.find(l=>/granularity/.test(l.text));
 assert.ok(first.y+first.height<=second.y+2,JSON.stringify([first.y,first.height,second.y]));
 assert.ok(first.text.includes('\u0000')||second.text.includes('\u0000')||lines.some(l=>l.text.includes('\u0000')),'the glyph stays in the text');
});
test('equation pieces without a word stay source; a lone connective and short names are still translated',()=>{
 const {layoutBlocks}=require('../core/pdf-layout.js');
 const b=(id,text,extra={})=>({id,x:100,y:100+Number(id.length)*40,width:120,height:13,fontSize:13.3,kind:'body',text,...extra});
 const page={width:816,height:1056,blocks:[b('a','exp'),b('bb','xi2 2 2'),b('ccc','FhT'),b('dddd','if Hk b, 2 > Hk, 2 or SPEk b, > SPEk,'),b('eeeee','log bottomP',{rich:'log P<sub>bottom</sub>'}),
  b('ffffff','and'),b('ggggggg','Li Xu'),b('hhhhhhhh','Results'),b('iiiiiiiii','ON-LINE MONITORING 2'),b('jjjjjjjjjj','확률과 통계 AAI104')]};
 const out=Object.fromEntries(layoutBlocks(page).map(x=>[x.text,x.sourceOnly]));
 assert.deepEqual(out,{'exp':true,'xi2 2 2':true,'FhT':true,'if Hk b, 2 > Hk, 2 or SPEk b, > SPEk,':true,'log bottomP':true,'and':false,'Li Xu':false,'Results':false,'ON-LINE MONITORING 2':false,'확률과 통계 AAI104':false});
});
test('a small dark badge with light bold letters is a panel however many blended edge tones the renderer draws',()=>{
 const {backgroundSample}=require('../core/pdf-layout.js');
 const width=64,height=24,panel=[0,69,125];
 // Panel 55%, white letters 20%, edges blended panel→white 25%; then the same edges in another hue.
 const make=edge=>{const data=new Uint8ClampedArray(width*height*4);for(let y=0;y<height;y++)for(let x=0;x<width;x++){const i=(y*width+x)*4,k=(x*7+y*13)%20;const c=k<11?panel:k<15?[255,255,255]:edge(k);data.set([...c,255],i);}return {width,height,data};};
 const blend=k=>{const t=(k-14)*.09;return panel.map(v=>Math.round(v+(255-v)*t));};
 const s=backgroundSample(make(blend),{x:0,y:0,width,height});
 assert.equal(s.safe,true);assert.equal(s.ink,'rgb(255, 255, 255)');assert.equal(s.color,'rgb(0, 69, 125)');
 const red=backgroundSample(make(k=>[200,40+k*4,40]),{x:0,y:0,width,height});
 assert.equal(red.safe,false,'tones of another hue (a photo, a chart) are no letter edges');
});
test('OCR lines become runs: one run per line, low-confidence lines and words over PDF text left out, bullets restored',()=>{
 const {ocrRuns,textLines,paragraphs}=require('../core/pdf-layout.js');
 const word=(text,x0,x1,confidence=90,y0=200,y1=230)=>({text,x0,x1,y0,y1,confidence});
 const lines=[
  {words:[word('e',60,70),word('A',100,118),word('generative',140,330),word('model',360,460),word('turns',490,580)],baseline:[60,226,580,226],rowHeight:36,confidence:88},
  {words:[word('noise',100,190,90,260,290),word('into',220,290,90,260,290),word('data',320,400,90,260,290)],baseline:[100,286,400,286],rowHeight:36,confidence:85},
  {words:[word('Bird',700,780,92,260,290)],baseline:[700,286,780,286],rowHeight:36,confidence:92},
  {words:[word('A(0,7)',100,200,30,320,350)],baseline:[100,346,200,346],rowHeight:36,confidence:40},
  {words:[word('Generative',600,900,95,60,100),word('Models',920,1100,95,60,100)],baseline:[600,96,1100,96],rowHeight:40,confidence:95}];
 const title={x:400,y:40,width:340,height:30,fontSize:30,baseline:65,text:'Generative Models'};
 const runs=ocrRuns(lines,1.5,[title]);
 assert.deepEqual(runs.map(r=>r.text),['•','A generative model turns','noise into data'],'a figure label ("Bird") stays drawn');
 assert.ok(runs.every(r=>r.ocr&&r.fontSize===24));
 assert.ok(runs[1].y<=200/1.5&&runs[1].y+runs[1].height>=230/1.5,'the box covers the ink');
 const blocks=paragraphs(textLines([title,...runs]),1280,720,2);
 assert.ok(blocks.some(b=>/^• A generative model turns noise into data$/.test(b.text)),JSON.stringify(blocks.map(b=>b.text)));
 assert.deepEqual(ocrRuns(lines,0),[]);assert.deepEqual(ocrRuns(null,1.5),[]);
});
test('a graphic placeholder is protected text: parsed, never cut, rendered as a span',()=>{
 const {graphicToken,graphicSpans,scriptCut,richHtml}=require('../core/pdf-layout.js');
 const token=graphicToken(2,308.4,564.2,158.6,26.7),text=`for every subset ${token} in the domain`;
 assert.equal(token,'⟦g:2:308:564:159:27⟧');
 assert.deepEqual(graphicSpans(text).map(g=>[g.page,g.x,g.y,g.width,g.height]),[[2,308,564,159,27]]);
 const inside=text.indexOf(token)+5;assert.equal(scriptCut(text,inside),false);assert.equal(scriptCut(text,text.indexOf(token)),true);
 assert.match(richHtml(text),/^for every subset <span class="graphic-math" data-graphic="2:308:564:159:27">\[수식\]<\/span> in the domain$/);
});
test('page OCR validates its input, reads each page once and caches the result',async()=>{
 const {PageOcr,linesOf}=require('../desktop/ocr.cjs');
 const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),`${appName.id}-ocr-`));let calls=0;
 const data={blocks:[{paragraphs:[{lines:[{words:[{text:'Hello',bbox:{x0:1,y0:2,x1:30,y1:12},confidence:91.4},{text:' ',bbox:{x0:0,y0:0,x1:0,y1:0},confidence:0}],baseline:{x0:1,y0:11,x1:30,y1:11},rowAttributes:{row_height:12},confidence:90.2}]}]}]};
 const ocr=new PageOcr({directory,createWorker:()=>async()=>({recognize:async()=>{calls++;return {data};},terminate:async()=>{}})});
 const lang=path.join(path.dirname(require.resolve('@tesseract.js-data/eng/package.json')),'4.0.0_best_int');await fs.access(path.join(lang,'eng.traineddata.gz'));
 const png=new Uint8Array([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,0,0]);
 await assert.rejects(ocr.recognize('../x',png));await assert.rejects(ocr.recognize('ok-1',new Uint8Array([1,2,3,4,5,6,7,8,9])));
 const first=await ocr.recognize('doc-1-150',png),second=await ocr.recognize('doc-1-150',png);
 assert.equal(calls,1);assert.deepEqual(first,second);
 assert.deepEqual(first.lines,[{words:[{text:'Hello',x0:1,y0:2,x1:30,y1:12,confidence:91}],baseline:[1,11,30,11],rowHeight:12,confidence:90}]);
 assert.deepEqual(linesOf({}),[]);
 await fs.access(path.join(directory,'ocr','data','eng.traineddata'));
 await ocr.close();await fs.rm(directory,{recursive:true,force:true});
});
test('page OCR reads several pages at once on a few workers, started only as pages wait',async()=>{
 const {PageOcr}=require('../desktop/ocr.cjs');
 const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),`${appName.id}-ocr-pool-`));let made=0,running=0,peak=0,calls=0;
 const worker=async()=>{made++;return {recognize:async()=>{calls++;running++;peak=Math.max(peak,running);await new Promise(r=>setTimeout(r,20));running--;return {data:{blocks:[]}};},terminate:async()=>{}};};
 const ocr=new PageOcr({directory,workers:3,createWorker:()=>worker}),png=new Uint8Array([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,0,0]);
 await ocr.recognize('one-1',png);assert.equal(made,1,'one page, one worker');
 const twice=[ocr.recognize('same-1',png),ocr.recognize('same-1',png)];assert.equal(twice[0],twice[1],'a page asked twice at once is read once');await twice[0];
 await Promise.all(Array.from({length:8},(_,i)=>ocr.recognize(`many-${i}`,png)));
 assert.equal(made,3);assert.equal(peak,3);assert.equal(calls,10);
 let fail=true;const flaky=new PageOcr({directory,workers:1,createWorker:()=>async()=>{if(fail){fail=false;throw Error('no worker');}return {recognize:async()=>({data:{blocks:[]}}),terminate:async()=>{}};}});
 await assert.rejects(flaky.recognize('flaky-1',png),/no worker/);assert.deepEqual((await flaky.recognize('flaky-1',png)).lines,[],'a worker that failed to start is replaced');
 await ocr.close();await flaky.close();await fs.rm(directory,{recursive:true,force:true});
});
test('an OCR paragraph keeps its short wrapped last line; a picture label under a label stays drawn',()=>{
 const {ocrRuns}=require('../core/pdf-layout.js');
 const word=(text,x0,x1,y0,y1)=>({text,x0,x1,y0,y1,confidence:90}),line=(words,y)=>({words,baseline:[words[0].x0,y+28,words.at(-1).x1,y+28],rowHeight:36,confidence:88});
 const lines=[
  line([word('oe',60,74,200,230),word('Assume',100,220,200,230),word('each',240,320,200,230),word('data',340,420,200,230),word('point',440,530,200,230),word('is',550,580,200,230),word('generated',600,760,200,230),word('in',780,810,200,230),word('two',830,900,200,230)],200),
  {...line([word('steps:',100,200,244,268)],240),rowHeight:28,baseline:[100,300,200,300]},
  line([word('pose,',1000,1080,200,230)],200),line([word('size,',1000,1070,240,270)],240)];
 assert.deepEqual(ocrRuns(lines,1.5).map(r=>r.text),['•','Assume each data point is generated in two','steps:'],'"steps:" ends the paragraph; "pose," and "size," stay in the picture');
 const {textLines,paragraphs}=require('../core/pdf-layout.js'),more=[0,1,2].map(i=>line([word('Another',100,230,330+i*60,360+i*60),word('bullet',250,350,330+i*60,360+i*60),word('line',370,440,330+i*60,360+i*60),word('of',460,490,330+i*60,360+i*60),word('slide',510,600,330+i*60,360+i*60),word('text',620,700,330+i*60,360+i*60)],330+i*60));
 assert.ok(paragraphs(textLines(ocrRuns([...lines,...more],1.5)),1280,720,2).some(b=>b.text==='• Assume each data point is generated in two steps:'),'and joins it');
});
test('a paragraph never flows back up into a block above it on the same page, unless that block is the next column',()=>{
 const {structureTranslationPages}=require('../core/pdf-layout.js');
 const b=(id,text,x,y,width)=>({id,text,x,y,width,height:30,fontSize:24,kind:'body'});
 const slide={width:1280,height:720,blocks:[{...b('p1-b0','Two Approaches to Generation',300,30,600),kind:'heading'},b('p1-b1','learn a score, then find high scores',692,272,480),b('p1-b2','• generating then needs a search or sampling algorithm, for example',107,513,1090)]};
 const [page]=structureTranslationPages([slide],'h');
 assert.ok(page.blocks.every(x=>!x.flowIds&&!x.flowHead),JSON.stringify(page.blocks.map(x=>[x.id,x.flowIds,x.flowHead])));
 const columns={width:1200,height:1600,blocks:[b('p1-b0','A long paragraph of the first column continues into the second column of the page without',60,1400,520),b('p1-b1','stopping at the column break, as text in two columns does.',640,100,520)]};
 const [two]=structureTranslationPages([columns],'h');assert.deepEqual(two.blocks[0].flowIds,['p1-b1'],'the next column still continues it');
});
test('a bullet alone is no heading, so it names no section',()=>{
 const {textLines,paragraphs}=require('../core/pdf-layout.js');
 const run=(text,x,y,fontSize)=>({x,y,width:text.length*fontSize*.5,height:fontSize*1.2,fontSize,baseline:y+fontSize,text});
 const blocks=paragraphs(textLines([run('•',0,44,40),run('Generative Models',450,36,42),run('A generative model turns random noise into new data and more',62,152,24),run('Sampling feeds fresh noise through the generator to make data',62,204,24),run('A condition such as the class chooses what to generate here',62,256,24),run('Training learns the parameters from the data set in batches',62,308,24),run('The model is then used to draw new samples on demand today',62,360,24)]),1280,720,2);
 assert.equal(blocks.find(x=>x.text==='•')?.kind,'body',JSON.stringify(blocks.map(x=>[x.text,x.kind])));
 assert.equal(blocks.find(x=>x.text==='Generative Models')?.kind,'heading');
});
test('a page read by OCR is translated with its picture when the connection takes images; the picture is never saved',async t=>{
 const f=await fixture(t),calls=[],png='data:image/png;base64,iVBORw0KGgoP';
 const client={...authFor(async(_m,blocks,_s,context)=>{calls.push(context);return translated(blocks);}),imageMessage:()=>({})};
 async function run(c,page){const jobs=new TranslationJobs(c),job=await jobs.start(f.library,f.paperId,f.hash,[],'model',{incremental:true,totalPages:1,force:true});jobs.append(job.id,1,page,{title:'A'});jobs.seal(job.id);await until(()=>jobs.jobs.get(job.id).state!=='running');assert.equal(jobs.result(job.id).state,'completed');return jobs.result(job.id);}
 const result=await run(client,{...pageAt(1),ocr:true,image:png});
 assert.deepEqual(calls[0].images,[png]);assert.match(calls[0].pageImage,/^[0-9a-f]{64}$/);assert.match(calls[0].pageImageNote,/read from by OCR/);
 assert.ok(!JSON.stringify(result).includes('iVBORw0KGgoP'),'not in the result');
 const saved=await require('node:fs/promises').readFile(f.library.root+`/.${appName.id}/translation-`+f.paperId+'.json','utf8').catch(()=>'');assert.ok(!saved.includes('iVBORw0KGgoP'),'not in the saved translation');
 await run(authFor(async(_m,blocks,_s,context)=>{calls.push(context);return translated(blocks);}),{...pageAt(1),ocr:true,image:png});
 assert.equal(calls.at(-1).images,undefined,'a text-only connection gets the text');assert.equal(calls.at(-1).pageImage,undefined);
});
test('lines of program code stay as printed and never join a paragraph; prose with code words is translated',()=>{
 const {layoutBlocks}=require('../core/pdf-layout.js');
 const b=(id,text,y)=>({id,text,x:60,y,width:700,height:28,fontSize:20,kind:'body'});
 const code=['def decode(self, z):','return nn.Sequential(','nn.Linear (HIDDEN, HIDDEN), nn.ReLU(),','sq_err = torch.sum((x - x_prime) ** 2) / batch','for epoch in range(1, EPOCHS + 1):','@torch.no_grad()','4 optimizer = torch.optim.Adam(model.parameters(), lr=LR)'];
 const prose=['# image -> HIDDEN features','• The decoder returns the mean of a Gaussian for every pixel','Training then updates the weights with the gradient of the loss','return to the previous slide for the definition of the ELBO and the KL term'];
 const out=layoutBlocks({width:1280,height:720,blocks:[...code.map((t,i)=>b('c'+i,t,40*i)),...prose.map((t,i)=>b('p'+i,t,400+40*i))]});
 assert.deepEqual(out.filter(x=>x.sourceOnly).map(x=>x.id),code.map((_,i)=>'c'+i));
});
test('a table read by OCR (rows of cells far apart, columns lined up) stays as drawn; bullets with a label beside them do not make one',()=>{
 const {ocrRuns}=require('../core/pdf-layout.js');
 const row=(y,cells)=>({words:cells.flatMap(([x,text])=>text.split(' ').map((t,i)=>({text:t,x0:x+i*90,x1:x+i*90+80,y0:y,y1:y+26,confidence:92}))),baseline:null,rowHeight:28,confidence:92});
 const table=[row(358,[[82,'step'],[325,'code'],[693,'what it does'],[1433,'recap slide']]),row(415,[[82,'0 Setup'],[327,'import torch'],[695,'libraries, GPU or CPU']]),row(467,[[83,'1 Settings'],[325,'ARCH, SIGMA0'],[695,'network kind of the decoder'],[1431,'Reconstruction Term']]),row(518,[[82,'2 Data'],[326,'DataLoader'],[694,'minibatches of 128 images']]),row(570,[[82,'5 Generation model decode'],[695,'decode new images']])];
 const prose={words:'Gaussian decoder with a fixed sigma picks the networks'.split(' ').map((t,i)=>({text:t,x0:142+i*110,x1:142+i*110+100,y0:849,y1:880,confidence:90})),baseline:null,rowHeight:37,confidence:90};
 const runs=ocrRuns([...table,prose],2);
 assert.deepEqual(runs.map(r=>r.text),['Gaussian decoder with a fixed sigma picks the networks'],JSON.stringify(runs.map(r=>r.text)));
 // A slide's bullets with a picture's labels at the same heights: two cells each, no table.
 const bullets=[0,1,2].map(i=>({words:[{text:'e',x0:92,x1:106,y0:238+i*60,y1:252+i*60,confidence:90},...'Direct one pass through the generator'.split(' ').map((t,j)=>({text:t,x0:143+j*100,x1:143+j*100+90,y0:229+i*60,y1:265+i*60,confidence:90})),{text:'label',x0:1500,x1:1600,y0:229+i*60,y1:265+i*60,confidence:90}],baseline:null,rowHeight:37,confidence:90}));
 assert.equal(ocrRuns(bullets,2).filter(r=>/Direct/.test(r.text)).length,3);
 // A small table with bulleted sentences beside it, read into the same lines (OCR lines overlapping in
 // height, a monospaced row read as fewer cells): the cells go, the sentences stay, joined.
 const ws=(t,x,y,c=90)=>t.split(' ').map((s,i)=>({text:s,x0:x+i*60,x1:x+i*60+50,y0:y,y1:y+26,confidence:c}));
 const mixed=[
  {words:[...ws('e',900,540),...ws('Line 9: the same loss on test images, a',1000,540)],baseline:null,rowHeight:30,confidence:90},
  {words:[...ws('ours, per image',176,560),...ws('recon',504,560),...ws('KL',630,560),...ws('total',760,560)],baseline:null,rowHeight:26,confidence:90},
  {words:[...ws('_—',176,580,35),...ws('little higher than on training images',1000,580)],baseline:null,rowHeight:30,confidence:90},
  {words:[...ws('training, epoch 20',176,610),...ws('-840.4',504,610),...ws('58.8',630,610),...ws('-781.6',760,610)],baseline:null,rowHeight:26,confidence:90},
  {words:[...ws('test set',176,640),...ws('-817.1',504,640),...ws('59.9',630,640),...ws('eo',900,640),...ws('Negative is fine for continuous pixels.',1000,640)],baseline:null,rowHeight:30,confidence:90}];
 const kept=require('../core/pdf-layout.js').paragraphs(require('../core/pdf-layout.js').textLines(ocrRuns(mixed,2)),960,540,20).map(b=>b.text);
 assert.ok(kept.includes('• Line 9: the same loss on test images, a little higher than on training images')&&kept.includes('• Negative is fine for continuous pixels.'),JSON.stringify(kept));
 assert.ok(!kept.some(t=>/ours|training, epoch|test set|recon|840/.test(t)),JSON.stringify(kept));
 // A first row read as fewer cells ("Epoch | 1/20 loss …") joins the table found below it.
 const log=[0,1,2,3].map(i=>({words:[...ws('Epoch',94,300+i*32),...ws(`${i+1}/20 loss 6${i}0.3 reconstruction`,200,300+i*32),...(i?ws(String(60-i*10),1467,300+i*32):[]),...(i?ws('test',1700,300+i*32):[])],baseline:null,rowHeight:22,confidence:90}));
 assert.deepEqual(ocrRuns(log,2),[],JSON.stringify(ocrRuns(log,2).map(r=>r.text)));
 // Two code rows with a comment column, then sentences: no table reaches over the sentences, and a
 // monospaced sentence (words starting everywhere) never joins one.
 const mono=(t,x,y)=>t.split(' ').map((s,i)=>({text:s,x0:x+i*55,x1:x+i*55+45,y0:y,y1:y+26,confidence:95}));
 const page=[
  {words:[...mono('185',100,700),...mono('sq_err = torch.sum(x) / batch',260,700),...mono('per image',1500,700)],baseline:null,rowHeight:28,confidence:90},
  {words:[...mono('186',100,730),...mono('recon = sq_err / 2',260,730),...mono('pixels',1500,730)],baseline:null,rowHeight:28,confidence:90},
  {words:[...mono('e',100,790),...mono('Each squared error counts fifty times here',150,790)],baseline:null,rowHeight:30,confidence:90},
  {words:[...mono('e',100,850),...mono('The constant is the same for every theta',150,850)],baseline:null,rowHeight:30,confidence:90},
  {words:[...mono('A density can exceed one so the whole loss can be negative',100,910)],baseline:null,rowHeight:30,confidence:90}];
 assert.ok(ocrRuns(page,2).some(r=>/A density can exceed one/.test(r.text)),JSON.stringify(ocrRuns(page,2).map(r=>r.text)));
});
test('math read by OCR stays as drawn: a placeholder in a sentence, a formula line left to the picture, code and prose untouched',()=>{
 const {ocrRuns,graphicSpans}=require('../core/pdf-layout.js');
 const ws=(t,x,y,c=95)=>t.split(' ').map((s,i)=>({text:s,x0:x+i*70,x1:x+i*70+60,y0:y,y1:y+30,confidence:c}));
 const line=(words)=>({words,baseline:null,rowHeight:37,confidence:80});
 const encoder=line([...ws('2. Encoder:',100,300),{text:'pu',x0:240,x1:280,y0:300,y1:330,confidence:40},{text:'=',x0:290,x1:300,y0:310,y1:320,confidence:79},{text:'py(z?)',x0:310,x1:400,y0:300,y1:336,confidence:0},...ws('and',420,300),{text:'ol)',x0:490,x1:530,y0:300,y1:330,confidence:35},{text:'=',x0:540,x1:550,y0:310,y1:320,confidence:88},{text:'oy(z1)',x0:560,x1:650,y0:300,y1:336,confidence:0}]);
 const formula=line([{text:'Los(x)',x0:100,x1:200,y0:400,y1:440,confidence:22},{text:'~',x0:210,x1:230,y0:410,y1:420,confidence:88},{text:'lz',x0:240,x1:270,y0:400,y1:440,confidence:65},{text:'+',x0:280,x1:300,y0:410,y1:430,confidence:90},{text:'oF',x0:310,x1:340,y0:400,y1:440,confidence:52},{text:'+',x0:350,x1:370,y0:410,y1:430,confidence:80},{text:'const',x0:380,x1:460,y0:400,y1:440,confidence:80}]);
 const code=line(ws('self.fc_mu = nn.Linear(HIDDEN, LATENT)',100,500));
 const pipe=line(ws('|ast layer of the decoder is a sigmoid here',100,700));
 const prose=line([...ws('Gaussian decoder (the default), a',100,600),{text:'z',x0:450,x1:465,y0:600,y1:630,confidence:70},...ws('so it is fine',475,600)]);
 const runs=ocrRuns([encoder,formula,code,prose,pipe],2,[],7),texts=runs.map(r=>r.text);
 assert.ok(texts.includes('last layer of the decoder is a sigmoid here'),'"|ast" is "last": '+JSON.stringify(texts));
 const enc=texts.find(t=>t.startsWith('2. Encoder:'));assert.ok(enc,JSON.stringify(texts));
 assert.equal(enc.replace(/⟦g:[\d:]+⟧/g,'[g]'),'2. Encoder: [g] and [g]');
 const [first]=graphicSpans(enc);assert.equal(first.page,7);assert.deepEqual([first.x,first.y,first.width,first.height],[120,150,87,18],'the placeholder covers the math as drawn, up to just short of the next word');
 const last=graphicSpans(enc).at(-1),encRun=runs.find(r=>r.text===enc);assert.equal(last.x+last.width,325+37,'math ending the run reaches two ems on (glyphs OCR left unread)');assert.equal(encRun.x+encRun.width,last.x+last.width,'and the run covers it');
 assert.ok(!texts.some(t=>/const|Los/.test(t)),'a formula line is left to the picture: '+JSON.stringify(texts));
 assert.ok(texts.includes('self.fc_mu = nn.Linear(HIDDEN, LATENT)'),'code keeps its text');
 const p=texts.find(t=>t.startsWith('Gaussian'));assert.equal(p.replace(/⟦g:[\d:]+⟧/g,'[g]'),'Gaussian decoder (the default), a [g] so it is fine','prose parentheses stay text, a lone variable is math');
 assert.deepEqual(ocrRuns([encoder],2).map(r=>r.text).filter(t=>/⟦g/.test(t)),[],'without a page number no placeholder is made');
});
test('a bullet set apart from its item joins it whatever the item starts with',()=>{
 const {textLines,paragraphs}=require('../core/pdf-layout.js');
 const run=(text,x,y,size=16)=>({x,y,width:text.length*size*.5,height:size,fontSize:size,baseline:y+size*.8,text});
 const blocks=paragraphs(textLines([run('•',46,456),run('3x3 filters with padding 1 keep the shape, so the two can be added',70.5,456),run('•',46,486),run('The shortcut passes the input and its gradient unchanged to the output',71,486)]),960,540,27);
 assert.deepEqual(blocks.map(b=>b.text),['• 3x3 filters with padding 1 keep the shape, so the two can be added','• The shortcut passes the input and its gradient unchanged to the output']);
});
test('a block the reader asked to leave untranslated may come back as its source; otherwise English given back is refused',()=>{
 const {checkReply}=require('../desktop/translation.cjs'),{USER_RULES_NOTE,REFERENCE_IMAGES_NOTE}=require('../core/translation-policy.cjs');
 const prose='We observed that the proposed model is faster than the baseline in every setting we tried.';
 assert.throws(()=>checkReply(prose,prose,{}),/번역 결과 형식이 잘못/);
 assert.doesNotThrow(()=>checkReply(prose,prose,{userRules:'표와 그림 설명은 번역하지 않기'}));
 assert.doesNotThrow(()=>checkReply(prose,prose,{referenceImages:['h']}));
 assert.match(USER_RULES_NOTE,/leave some text untranslated[\s\S]*source text unchanged/);assert.match(REFERENCE_IMAGES_NOTE,/which parts userRules refer to/);
});
test('line numbers down the margin of a consultation draft are no text of the page',()=>{
 const {textLines,paragraphs}=require('../core/pdf-layout.js');
 const run=(text,x,baseline,width,fontSize=11)=>({text,x,y:baseline-fontSize*.8,width,height:fontSize,fontSize,baseline});
 const words=['This annex applies to all types of computerised systems used in the manufacturing of medicinal','products and active substances, where Artificial Intelligence models are used in critical ones','with direct impact on patient safety, product quality or data integrity, for example to predict','or classify data. The document provides additional guidance to the main text on such systems','and applies to machine learning models which have obtained their functionality by training.','It does not apply to models that are explicitly programmed with rules by their developers.'];
 const runs=words.flatMap((t,i)=>[run(t,96,160+i*14,520),run(String(5+i),i<5?66:60,160+i*14,i<5?6:12,12)]);
 const blocks=paragraphs(textLines(runs),700,900,2);
 assert.equal(blocks.length,1,JSON.stringify(blocks.map(b=>b.text.slice(0,30))));assert.equal(blocks[0].text,words.join(' '));assert.ok(blocks[0].x>=95);
 // Numbers that do not count up (a table column, years) stay.
 const table=[run('Year',96,160,30),...[1990,1987,2003,1999,2011,1975].map((n,i)=>run(String(n),60,174+i*14,24)),...['alpha beta gamma','delta epsilon','zeta eta theta','iota kappa','lambda mu nu','xi omicron pi'].map((t,i)=>run(t,96,174+i*14,120))];
 assert.ok(paragraphs(textLines(table),700,900,2).some(b=>/1990/.test(b.text)),'a column of years is kept');
});
test('a section number set apart joins its wrapped heading; a tall glyph does not make two paragraphs overlap',()=>{
 const {textLines,paragraphs,layoutBlocks,layoutCollisions}=require('../core/pdf-layout.js');
 const run=(text,x,baseline,width,fontSize=11,height=fontSize)=>({text,x,y:baseline-height*.8,width,height,fontSize,baseline});
 const body=(y,n)=>Array.from({length:n},(_,i)=>run('This is a projection method for obtaining all the score estimates at',60,y+i*14,300));
 const page=paragraphs(textLines([...body(100,4),run('3.3.',60,190,20,13),run('Projection to the model plane method',96,190,240,13),run('(PMP)',60,206,40,13),...body(236,4)]),700,900,3);
 const heading=page.find(b=>/Projection/.test(b.text));
 assert.equal(heading.text,'3.3. Projection to the model plane method (PMP)',JSON.stringify(page.map(b=>b.text.slice(0,40))));
 assert.ok(!page.some(b=>b.text==='3.3.'));assert.equal(layoutCollisions(layoutBlocks({width:700,height:900,blocks:page})).size,0);
 // The last line of a paragraph holds a tall bracket reaching into the next paragraph's first line.
 const tall=paragraphs(textLines([...body(100,3),run('Let X be the data set, where each object is an',60,142,230),run('{',292,142,6,11,24),run('x1 , x2',300,142,40),run('N-dimensional data as described above. The algorithm needs to find a set',60,170,300),...body(184,2)]),700,900,3);
 for(const a of tall)for(const b of tall)if(a!==b&&b.y>a.y&&Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x)>10)assert.ok(a.y+a.height<=b.y+.01,`${a.text.slice(0,20)} ends at ${a.y+a.height}, ${b.text.slice(0,20)} starts at ${b.y}`);
});
test('OCR lines of one type size take one size, whatever row height each was measured at',()=>{
 const {ocrRuns}=require('../core/pdf-layout.js');
 const text='mapping numerical features to vectors was also employed in many other models for the problem';
 const line=(y,row)=>{let x=200;const words=text.split(' ').map(t=>{const w={text:t,x0:x,x1:x+t.length*9,y0:y,y1:y+18,confidence:95};x=w.x1+8;return w;});return {words,baseline:[200,y+15,x,y+15],rowHeight:row,confidence:95};};
 const rows=[18,18,24.8,25.3,18.8,18,18,17.4,18,18],sizes=ocrRuns(rows.map((r,i)=>line(1000+i*22,r)),1.5,[],1).map(r=>+r.fontSize.toFixed(2));
 assert.equal(new Set(sizes).size,1,JSON.stringify(sizes));assert.equal(sizes[0],12);
 // A larger line (a slide's title) keeps its own size.
 const title={words:[{text:'Generative',x0:200,x1:420,y0:900,y1:940,confidence:95},{text:'Models',x0:440,x1:600,y0:900,y1:940,confidence:95},{text:'Today',x0:620,x1:760,y0:900,y1:940,confidence:95}],baseline:[200,934,760,934],rowHeight:52,confidence:95};
 assert.ok(ocrRuns([title,...rows.map((r,i)=>line(1000+i*22,r))],1.5,[],1).some(r=>r.fontSize>30));
});
test('a piece inside another paragraph joins it; a stray short piece does not keep a paragraph as source',()=>{
 const {textLines,paragraphs,layoutBlocks,layoutCollisions}=require('../core/pdf-layout.js');
 const run=(text,x,baseline,width,fontSize=9)=>({text,x,y:baseline-fontSize*.8,width,height:fontSize,fontSize,baseline});
 // A caption whose second line an inline legend mark splits into pieces set apart.
 const caption=paragraphs(textLines([run('Fig. 4. Prediction capability of the simulation for four batches, showing the measured substrate feed rate as',40,500,640),run('a line',40,511,30),run(', the soybean oil feed rate as',130,511,130),run(', and the off-line penicillin measurements as',300,511,200),run('a cross. The simulated results follow the measured ones closely over the whole batch time.',40,522,560)]),720,900,4);
 assert.equal(caption.length,1,JSON.stringify(caption.map(b=>b.text.slice(0,40))));
 assert.match(caption[0].text.replace(/\s+/g,' '),/as a line , the soybean oil feed rate as , and the off-line penicillin measurements as a cross\./);
 // "(8)" kept as drawn inside a paragraph's box; an equation there still keeps the source visible.
 const para={id:'p',text:'The balance of the substrate in the vessel is written with the feed rates of every stream entering it.',x:40,y:100,width:330,height:60,fontSize:11,kind:'body'};
 const stray=layoutBlocks({width:700,height:900,blocks:[para,{id:'n',text:'(8)',x:350,y:122,width:18,height:11,fontSize:11,kind:'body'}]});
 assert.equal(stray.find(x=>x.id==='n').sourceOnly,true);assert.deepEqual([...layoutCollisions(stray)],[]);
 const eq=layoutBlocks({width:700,height:900,blocks:[para,{id:'e',text:'F = a + b',x:150,y:122,width:60,height:11,fontSize:11,kind:'body'}]});
 assert.deepEqual([...layoutCollisions(eq)],['p']);
});
test('entries of the reference list are kept as their source and not sent; prose after the list is',async()=>{
 const {structureTranslationPages,layoutBlocks,bibliographyEntry}=require('../core/pdf-layout.js');
 for(const t of ['[12] P. Geladi and B.R. Kowalski, Anal. Chim. Acta, 185 (1986) 1.','1. Jackson JE. A User Guide to Principal Components. Wiley: New York, 1991.','Agarwal, P., Gonzalez, J. I. M., Elkamel, A., Budman,','[Mohammadi Foumani et al., 2024] Navid Mohammadi Foumani, Lynn Miller. Deep learning for time series.','(1) Jiang, Q.; Yan, X.; Huang, B. Review and Perspectives. IEEE Trans. Ind. Informat. 2020, 16, 3721.'])assert.equal(bibliographyEntry(t),true,t);
 for(const t of ['This appendix gives the proof of the second theorem for the general case of several responses.','The data were collected in 2019 from an industrial plant and cover fifty batches in all.','Copyright 2003 John Wiley & Sons, Ltd.'])assert.equal(bibliographyEntry(t),false,t);
 const b=(id,text,y,kind='body',fontSize=10)=>({id,text,x:60,y,width:480,height:kind==='heading'?16:24,fontSize,kind});
 const page={width:600,height:800,blocks:[b('p1-b0','1. Introduction',60,'heading',14),b('p1-b1','Batch processes play an important role in the chemical industry because of their flexibility in making products.',90),b('p1-b2','References',200,'heading',14),b('p1-b3','[1] R. Iserman, Automatica, 20 (1984) 387.',230),b('p1-b4','[2] G.J. Birky and T.J. McAvoy, Comput. Chem. Eng., 14 (1990) 241.',260),b('p1-b5','The proof of the theorem follows from the properties of the projection given in the main text.',320)]};
 const [structured]=structureTranslationPages([page],'hash'),flags=Object.fromEntries(structured.blocks.map(x=>[x.id,Boolean(x.keepSource)]));
 assert.deepEqual(flags,{'p1-b0':false,'p1-b1':false,'p1-b2':false,'p1-b3':true,'p1-b4':true,'p1-b5':false});
 const laid=layoutBlocks(structured);assert.ok(laid.find(x=>x.id==='p1-b3').sourceOnly&&!laid.find(x=>x.id==='p1-b5').sourceOnly&&!laid.find(x=>x.id==='p1-b2').sourceOnly);
 const {chunksFor}=require('../desktop/translation.cjs');
 if(typeof chunksFor==='function'){const sent=chunksFor([structured],{hash:'hash',model:'m',context:{title:'t'}}).flatMap(c=>c.blocks.map(x=>x.id)).join(' ');assert.ok(!/p1-b3|p1-b4/.test(sent)&&/p1-b5/.test(sent),sent);}
});
test('a paragraph meeting another block is set around it where room can be made',()=>{
 const {layoutBlocks,layoutCollisions,collisionHoles,holeFloats,holeClip}=require('../core/pdf-layout.js');
 const prose='The carbon evolution rate is taken here as directly related to the biomass and is used to follow the batch as it runs.';
 const para=(id,y,height=120)=>({id,text:prose,x:40,y,width:330,height,fontSize:10,kind:'body'});
 // A display equation between the paragraph's lines: its rows are left open over the whole width.
 const eq=layoutBlocks({width:700,height:900,blocks:[para('p',100),{id:'e',text:'F = (a + b)/(c − d) (31)',x:80,y:150,width:280,height:14,fontSize:10,kind:'formula'}]}),ce=layoutCollisions(eq),he=collisionHoles(eq,ce);
 assert.deepEqual([...ce],['p']);assert.equal(he.get('p').length,1);
 assert.deepEqual([he.get('p')[0].x,Math.round(he.get('p')[0].width)],[0,330]);assert.ok(he.get('p')[0].y>40&&he.get('p')[0].height<20);
 assert.deepEqual(holeFloats(he.get('p'),330).map(f=>[f.side,f.width]),[['left',330]]);
 // At the paragraph's top, the equation takes the rows above it as well (its own left side).
 const top=layoutBlocks({width:700,height:900,blocks:[para('p',100),{id:'e',text:'= (a + b)/(c − d) (31)',x:90,y:106,width:270,height:14,fontSize:10,kind:'formula'}]}),ht=collisionHoles(top,layoutCollisions(top)).get('p');
 assert.equal(ht[0].y,0);assert.ok(ht[0].height>20&&ht[0].height<40);
 // A short piece of inline math keeps the paragraph as its source; so does an equation taking over half of it.
 const inline=layoutBlocks({width:700,height:900,blocks:[para('p',100),{id:'e',text:'e = z − ẑ',x:290,y:130,width:70,height:24,fontSize:10,kind:'formula'}]});
 assert.equal(collisionHoles(inline,layoutCollisions(inline)).has('p'),false);
 const big=layoutBlocks({width:700,height:900,blocks:[para('p',100,40),{id:'e',text:'F = (a + b)/(c − d) (31)',x:80,y:104,width:280,height:30,fontSize:10,kind:'formula'}]});
 assert.equal(collisionHoles(big,layoutCollisions(big)).has('p'),false);
 // Two translated paragraphs: the larger makes room, the smaller stays whole.
 const pair=layoutBlocks({width:700,height:900,blocks:[para('a',100),{id:'b',text:'A label of several words set at the corner of it.',x:250,y:100,width:140,height:14,fontSize:10,kind:'body'}]}),hp=collisionHoles(pair,layoutCollisions(pair));
 assert.deepEqual([hp.get('a').length,hp.get('b').length],[1,0]);assert.equal(holeFloats(hp.get('a'),330)[0].side,'right');
 // The mask with the openings cut out; single quotes, so it can stand in a style attribute.
 const clip=holeClip([{x:0,y:50,width:330,height:16}],330,120,{top:1,right:2,bottom:0,left:1});
 assert.equal(clip,"path(evenodd,'M-1 -1H332V120H-1ZM0 50H330V66H0Z')");
 const {exportHtml,applyLayoutPlan}=require('../desktop/translation.cjs');
 const stored=[{width:700,height:900,blocks:[{id:'p',text:prose,translation:'탄소 발생률은 여기서 바이오매스와 직접 관련된 것으로 본다.',x:40,y:100,width:330,height:120,fontSize:10,kind:'body',sectionId:'s',sectionTitle:''}]}];
 const plan=[{width:700,height:900,blocks:[{id:'p',sourceIds:['p'],x:40,y:100,width:330,height:120,fontSize:10,kind:'body',backgroundColor:'rgb(255, 255, 255)',holes:[{x:0,y:50,width:330,height:16}]}]}];
 const html=exportHtml(applyLayoutPlan(stored,plan),['data:image/png;base64,AAAA'],'layout'),tag=/<div class="block"[^>]*data-block-id="p"[^>]*>/.exec(html)[0];
 assert.match(tag,/clip-path:path\(evenodd,'M[^"]*'\);left:40px;top:100px/);assert.match(tag,/data-holes="\[\{&quot;side&quot;:&quot;left&quot;/);
 assert.match(html,/<span style="float:left;clear:both;width:0;height:50px"><\/span><span style="float:left;clear:left;width:330px;height:16px"><\/span>탄소/);
 // An opening outside the block's box is refused, and the block is exported without one.
 const bad=applyLayoutPlan(stored,[{...plan[0],blocks:[{...plan[0].blocks[0],holes:[{x:0,y:50,width:900,height:16}]}]}]);assert.equal(bad[0].blocks[0].holes,undefined);
});
test('the cut-off end of a line goes back into its line; fraction parts go to their equation',()=>{
 const {textLines,paragraphs}=require('../core/pdf-layout.js');
 const run=(text,x,baseline,width,fontSize=12)=>({text,x,y:baseline-fontSize*.8,width,height:fontSize,fontSize,baseline});
 // Two justified lines cut by a wide gap near their ends; the ends, one under the other, read as a formula.
 const cut=paragraphs(textLines([run('Given a new individual z, its first A co-ordinates in the',417,622,319),run('projected space would be t = Pz, and from Equation (6)',417,638,319),run('these co-ordinates could be reconstructed',417,654,287),run('as',725,654,11),run('the product of the loadings and the scores, so that',417,670,215),run('the error of it',654,670,82),run('in the model plane is the residual of the prediction for it',417,686,319),run('error). Note that the matrix is idempotent and',417,702,319),run('symmetric. From this it follows that the sum of the squared',417,718,319)]),816,1056,4);
 assert.equal(cut.length,1,JSON.stringify(cut.map(b=>b.text.slice(0,30))));
 assert.match(cut[0].text.replace(/\s+/g,' '),/could be reconstructed as the product of the loadings and the scores, so that the error of it in the model plane/);
 // A heading of the next column on the same baseline is no line end.
 const two=paragraphs(textLines([run('Left column prose runs across its whole measure in this line of',60,300,330),run('the example and goes on to a second line that ends the paragraph',60,315,330),run('B. Training the Model',430,315,140),run('To train the model we minimise a total loss that is defined here',430,345,330),run('and the right column continues on the next line of the page.',430,360,310)]),816,1056,4);
 assert.ok(two.some(b=>b.text.trim()==='B. Training the Model'),JSON.stringify(two.map(b=>b.text.slice(0,30))));
 // dP/dt = r_P − r_h − F_in P / V   (27), then a line of text.
 const eq=[run('dP',410,836,13,11.3),run('dt',411,852,10,11.3),run('= r − r −',428,844,57,11.3),run('F P',488,836,18,11.3),run('V',493,852,7,11.3),run('(27)',723,844,21,11.3),run('Substrate consumption (S):',409,869,135,10.6),run('The substrate is consumed by growth and by the formation of product in the vessel.',409,890,335,10.6)];
 const blocks=paragraphs(textLines(eq),816,1056,6),text=blocks.find(b=>/^Substrate consumption/.test(b.text)),formula=blocks.find(b=>/=/.test(b.text));
 assert.ok(text&&!/dP|dt/.test(text.text),JSON.stringify(blocks.map(b=>b.text)));assert.ok(formula&&/dP/.test(formula.text)&&/dt/.test(formula.text)&&/V/.test(formula.text),formula?.text);
 assert.ok(formula.y+formula.height<=text.y+1,'the equation ends above the text');
});
test('a bracket hanging from a math font stays in its sentence; a section ornament is no text; a number takes its wrapped heading',()=>{
 const {textLines,paragraphs}=require('../core/pdf-layout.js');
 const run=(text,x,baseline,width,fontSize=10.6)=>({text,x,y:baseline-fontSize*.8,width,height:fontSize,fontSize,baseline});
 const lines=textLines([run('of X, Y and their corresponding one-hot encoded class labels, rep-',50,901,336),run('resented as D =',50,915,79),run('{(',135,906,11),run('X , Y , C',146,915,44),run(')',190,906,5),run(', … , where the labels are given',196,915,190),run('for the regression model of the batch, which serves as the output',50,930,336)]);
 assert.equal(lines.length,3,JSON.stringify(lines.map(l=>l.text)));assert.match(lines[1].text,/resented as D = ?\{\( ?X , Y , C ?\) ?, … , where/);
 // In a display equation the brackets of each row stay where they are.
 const display=textLines([run('J = n',420,470,60),run('(',484,462,5),run('T − T',492,470,40),run(')',536,462,5)]);
 assert.ok(display.some(l=>/\(/.test(l.text)));
 const marked=paragraphs(textLines([run('to further improve the prediction performance of the model in use.',69,693,300,13.3),run('■',69,726,14,42.7),run('APPENDIX',91,721,63,14),run('The BPTT algorithm is described as',69,740,190,13.3),run('L = ∑ (y − y) / 2N',85,774,110,13.3),run('(19)',367,774,21,12)]),816,1056,11);
 assert.ok(!marked.some(b=>/■/.test(b.text)),JSON.stringify(marked.map(b=>b.text)));assert.ok(marked.some(b=>b.text.trim()==='APPENDIX')&&marked.some(b=>/^The BPTT/.test(b.text)));
 const heading=paragraphs(textLines([run('Earlier prose of the section fills the measure of the column in this line',68,400,320,12),run('and ends here in a second line that is shorter.',68,415,220,12),run('3.6.',68,463,22,14.6),run('The asymmetric role of SPE and T2',104,463,230,14.6),run('in process monitoring',68,478,147,14.6),run('Although both SPE and T2 are used for process monitoring, it is necessary',68,500,320,12),run('to point out that they measure variations of different kinds in the data.',68,515,320,12)]),816,1056,6);
 assert.ok(heading.some(b=>b.text.replace(/\s+/g,' ')==='3.6. The asymmetric role of SPE and T2 in process monitoring'),JSON.stringify(heading.map(b=>b.text)));
});
test('rows of figures are not sent; an equation takes its operator from the sentence before; a fraction at a slide line\'s edge is left open',()=>{
 const {textLines,paragraphs,layoutBlocks,layoutCollisions,collisionHoles,reconcilePage}=require('../core/pdf-layout.js');
 const rows=layoutBlocks({width:816,height:1056,blocks:[{id:'t',text:'FID ↓ FID ↓ ACC ↑ F1 ↑ FID ↓ MSE ↓ – – 0.982±0.008 0.982±0.008 – 0.033±0.000 – 0.095±0.001 0.220±0.047 0.895±0.014',x:210,y:258,width:451,height:76,fontSize:9.4,kind:'body'},{id:'p',text:'We report 12 runs of 3 seeds each for the 5 datasets and 2 tasks in Table 4 below here.',x:144,y:411,width:532,height:30,fontSize:13.3,kind:'body'}]});
 assert.equal(rows.find(b=>b.id==='t').sourceOnly,true);assert.equal(rows.find(b=>b.id==='p').sourceOnly,false,'a sentence with numbers is still translated');
 // "It is shown in the Appendix that" | a large sum and its limits, set lower, over "tr(SU) = 2 + …".
 const run=(text,x,baseline,width,fontSize=12)=>({text,x,y:baseline-fontSize*.8,width,height:fontSize,fontSize,baseline});
 const blocks=paragraphs(textLines([run('The combined index is defined in the section above for the two statistics used here.',60,965,320),run('It is shown in the Appendix that',60,995,175),run('∑',238,1002,13,12.6),run('m',252,1006,7,8.8),run('i=l+1',252,1015,25,8.8),run('tr(SU) = 2 + λ',151,1021,90,12.6),run('(39)',356,1021,23,12.6)]),816,1056,5);
 const lead=blocks.find(b=>/^It is shown/.test(b.text)),eq=blocks.find(b=>/tr\(SU\)/.test(b.text));
 assert.equal(lead.text.trim(),'It is shown in the Appendix that',JSON.stringify(blocks.map(b=>b.text)));assert.match(eq.text,/∑/);assert.ok(lead.x+lead.width<240,'the sentence ends before the operator');
 // "– Note." with a fraction drawn beside it, its box a little into the fraction.
 const slide=layoutBlocks({width:1280,height:720,blocks:[{id:'n',text:'– Note. This ratio of the two hazards is the same',x:736,y:272,width:400,height:38,fontSize:29.3,kind:'body'},{id:'f',text:'𝜆 𝑡 𝜆2(𝑡)',x:1090,y:265,width:53,height:57,fontSize:21.4,kind:'formula'}]}),cs=layoutCollisions(slide),hs=collisionHoles(slide,cs);
 assert.deepEqual([...cs],['n']);assert.equal(hs.get('n').length,1);assert.ok(hs.get('n')[0].x>340);
 // An old translation's box is not reused where it runs into one of today's equations.
 const old={width:816,height:1056,blocks:[{id:'p6-b30',text:'dP dt Substrate consumption (S):',translation:'dP dt 기질 소비(S):',x:409,y:827,width:136,height:51,fontSize:11.3,kind:'body'}]};
 const today={width:816,height:1056,blocks:[{id:'p6-b21',text:'= rP − rh − FinP dP dt V (27)',x:410,y:827,width:334,height:27,fontSize:11.3,kind:'formula'},{id:'p6-b22',text:'Substrate consumption (S):',x:409,y:861,width:136,height:11,fontSize:10.6,kind:'body'}]};
 const shown=reconcilePage(old,today).blocks.find(b=>b.translation==='dP dt 기질 소비(S):');
 assert.ok(shown&&shown.y>=860,JSON.stringify(reconcilePage(old,today).blocks.map(b=>[b.id,b.y,b.height,b.translation])));
});
test('an old block of the reference list set over today\'s entries gives way to the entries, kept as their source',()=>{
 const {reconcilePage,layoutBlocks}=require('../core/pdf-layout.js');
 const entry=(id,n,y)=>({id,text:`[${n}] A. Author and B. Writer, J. Things, ${10+n} (199${n}) 1${n}.`,x:60,y,width:300,height:24,fontSize:9,kind:'body'});
 const today={width:600,height:800,blocks:[{id:'p1-b0',text:'References',x:60,y:60,width:80,height:14,fontSize:12,kind:'heading'},entry('p1-b1',1,90),entry('p1-b2',2,118),entry('p1-b3',3,146)]};
 const old={width:600,height:800,blocks:[{id:'p1-b0',text:'References',translation:'참고문헌',x:60,y:60,width:80,height:14,fontSize:12,kind:'heading'},{id:'p1-b1',text:'A. Author and B. Writer, J. Things, 11 (1991) 11. A. Author and B. Writer, J. Things, 12 (1992) 12. A. Author, 13 (1993) 13.',translation:'A. Author와 B. Writer, 사물 저널, 11 (1991) 11. …',x:80,y:90,width:280,height:80,fontSize:9,kind:'body'}]};
 const page=reconcilePage(old,today),laid=layoutBlocks(page);
 assert.ok(!page.blocks.some(b=>b.mappingUncertain),JSON.stringify(page.blocks.map(b=>[b.id,b.mappingUncertain,b.keepSource])));
 assert.equal(laid.filter(b=>/^\[\d\]/.test(b.text)&&b.sourceOnly).length,3);assert.equal(page.blocks.find(b=>b.text==='References').translation,'참고문헌');
 // A prose paragraph out of place is still named as such.
 const prose=reconcilePage({width:600,height:800,blocks:[{id:'p1-b0',text:'A long paragraph of prose that was once read across two of the paragraphs of today on this page.',translation:'오늘의 두 문단에 걸쳐 읽혔던 긴 문단.',x:60,y:90,width:480,height:80,fontSize:10,kind:'body'}]},{width:600,height:800,blocks:[{id:'p1-b0',text:'A long paragraph of prose that was once read',x:60,y:90,width:230,height:80,fontSize:10,kind:'body'},{id:'p1-b1',text:'across two of the paragraphs of today on this page.',x:310,y:90,width:230,height:80,fontSize:10,kind:'body'}]});
 assert.ok(prose.blocks.some(b=>b.mappingUncertain));
});
test('a bullet glyph opens an item wherever it stands; stored translations break at the bullets left inside them',()=>{
 const {textLines,paragraphs,repairPages,reconcilePage}=require('../core/pdf-layout.js');
 const run=(text,x,baseline,width,fontSize=14.5)=>({text,x,y:baseline-fontSize*.8,width,height:fontSize,fontSize,baseline});
 const slide=paragraphs(textLines([run('▶ Thus, the inputs and outputs each have overall dimensionality N D.',19,168,400),run('▶ If we had used a standard fully connected NN to map the input',19,188,390),run('values to the output values, it would have many independent',37,206,380),run('parameters.',37,224,70),
  run('▶ An ideal positional encoding should:',19,260,237),run('▶ it should be bounded,',49,278,139,13.3),run('▶ it should generalize to longer sequences, and',49,294,266,13.3),run('’The food was bad, not good at all.’',132,330,221),run('contain the same tokens but they have very different meanings.',38,360,384),run('▶ Clearly token order is crucial for most sequential processing tasks;',19,380,416)]),484,420,59).map(b=>b.text.replace(/\s+/g,' '));
 assert.deepEqual(slide,['▶ Thus, the inputs and outputs each have overall dimensionality N D.','▶ If we had used a standard fully connected NN to map the input values to the output values, it would have many independent parameters.','▶ An ideal positional encoding should:','▶ it should be bounded,','▶ it should generalize to longer sequences, and','’The food was bad, not good at all.’','contain the same tokens but they have very different meanings.','▶ Clearly token order is crucial for most sequential processing tasks;']);
 // A numbered entry's wrapped line may start with a number (a year): that is no new item.
 const refs=paragraphs(textLines([run('12. A. Author and B. Writer, A long title of a paper that wraps to the next line in',60,100,400,10),run('2019. Journal of Things 12, 34–56.',78,112,200,10),run('13. C. Third, Another title. Journal of Things 13, 1–9.',60,124,330,10)]),600,800,9);
 assert.equal(refs.length,2,JSON.stringify(refs.map(b=>b.text)));
 const b=(id,text,translation,y,height)=>({id,text,translation,x:19,y,width:420,height,fontSize:14.5,kind:'body'});
 const stored={width:484,height:363,blocks:[b('p59-b2','▶ Thus, the inputs and outputs each have overall dimensionality N D. ▶ If we had used a standard fully connected NN to map the input','▶ 따라서 전체 차원은 ND이다. ▶ 완전 연결 신경망을 사용하여 입력값을',155,39),b('p59-b3','values to the output values, it would have many independent parameters. ▶ Likewise the cost of one forward pass would be large.','출력값으로 매핑했다면 매개변수가 많았을 것이다. ▶ 마찬가지로 순전파 비용도 클 것이다.',194,80)]};
 const [fixed]=repairPages([stored]);
 assert.equal(fixed.blocks[0].translation,'▶ 따라서 전체 차원은 ND이다.\n▶ 완전 연결 신경망을 사용하여 입력값을');assert.equal(fixed.blocks[1].translation,'출력값으로 매핑했다면 매개변수가 많았을 것이다.\n▶ 마찬가지로 순전파 비용도 클 것이다.');
 assert.equal(repairPages([{width:484,height:363,blocks:[b('x','A plain sentence about the mark ▶ in it, here.','문장 속의 ▶ 표시.',10,20)]}])[0].blocks[0].translation,'문장 속의\n▶ 표시.'.replace('\n',' ').replace(' ▶','\n▶'),'(a bullet inside the source text breaks there)');
 // Today the three items are read apart: the two old blocks share one box over them, in order, and nothing is named as missing.
 const today={width:484,height:363,blocks:[b('p59-b2','▶ Thus, the inputs and outputs each have overall dimensionality N D.','',155,21),b('p59-b3','▶ If we had used a standard fully connected NN to map the input values to the output values, it would have many independent parameters.','',177,56),b('p59-b4','▶ Likewise the cost of one forward pass would be large.','',235,39)]};
 const page=reconcilePage(fixed,today),shown=page.blocks.filter(x=>x.translation);
 assert.equal(shown.length,1,JSON.stringify(page.blocks.map(x=>[x.id,x.y,x.height,x.mappingUncertain,x.translation.slice(0,12)])));assert.ok(!page.blocks.some(x=>x.missingTranslation||x.mappingUncertain));
 assert.deepEqual([shown[0].y,shown[0].y+shown[0].height],[155,274]);assert.match(shown[0].translation,/^▶ 따라서[\s\S]*\n▶ 완전 연결[\s\S]*출력값으로[\s\S]*\n▶ 마찬가지로/);
});
test('a bulleted item carries its hanging indent, stays ragged and keeps its left edge; a box of several items names their places',()=>{
 const {textLines,paragraphs,reconcilePage,pageTypography,repairPages}=require('../core/pdf-layout.js');
 const run=(text,x,baseline,width,fontSize=14.5)=>({text,x,y:baseline-fontSize*.8,width,height:fontSize,fontSize,baseline});
 // "▶" and its text are two pieces: a one-line item hangs by where its text starts; a wrapped one by its wrapped lines.
 const blocks=paragraphs(textLines([run('▶',19,100,8),run('The scaling hypothesis:',37,100,150),run('▶',19,120,8),run('simply by increasing the scale of the model and training on a large',37,120,380),run('data set, significant improvements in performance can be achieved',39,138,380),run('with no change at all.',39,156,120),run('▶',49,176,7,13.3),run('Even with no architectural changes.',66,176,200,13.3)]),484,363,6);
 assert.deepEqual(blocks.map(b=>[b.bullet,Math.round(b.hang),b.align,b.indent]),[[true,18,'start',undefined],[true,20,'start',undefined],[true,17,'start',undefined]]);
 assert.ok(pageTypography({width:484,height:363,blocks:blocks.map(b=>({...b,translation:'▶ 번역',width:420}))}).every(b=>b.align!=='justify'),'a list item is not justified');
 // An old paragraph of two items, shown over today's two items: the box names each item's place.
 const stored=repairPages([{width:484,height:363,blocks:[{id:'p6-b1',text:'▶ The scaling hypothesis: ▶ simply by increasing the scale of the model and training on a large data set, significant improvements in performance can be achieved with no change at all.',translation:'▶ 스케일링 가설: ▶ 모델의 규모를 늘리는 것만으로도 성능을 크게 향상할 수 있다.',x:19,y:88,width:400,height:70,fontSize:14.5,kind:'body'}]}])[0];
 const page=reconcilePage(stored,{width:484,height:363,blocks:blocks.slice(0,2)}),box=page.blocks.find(b=>b.translation);
 assert.equal(box.translation,'▶ 스케일링 가설:\n▶ 모델의 규모를 늘리는 것만으로도 성능을 크게 향상할 수 있다.');
 assert.equal(box.bullet,true);assert.deepEqual(box.items.map(t=>[t.dx,t.bullet,Math.round(t.hang)]),[[0,true,18],[0,true,20]]);assert.ok(box.items[1].gap>=0&&box.items[1].gap<10);
 // The export plan carries the list to the saved PDF.
 const {applyLayoutPlan,exportHtml}=require('../desktop/translation.cjs');
 const record=[{width:484,height:363,blocks:[{...stored.blocks[0],sectionId:'s',sectionTitle:''}]}];
 const html=exportHtml(applyLayoutPlan(record,[{width:484,height:363,blocks:[{...box,sourceIds:['p6-b1'],backgroundColor:'rgb(255, 255, 255)'}]}]),['data:image/png;base64,AAAA'],'layout');
 assert.match(html,/data-list="\{&quot;hang&quot;:[\d.]+,&quot;size&quot;:[\d.]+,&quot;items&quot;:\[\{&quot;dx&quot;:0/);assert.match(html,/\.tl-bullet\{display:inline-block/);
});
