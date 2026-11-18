const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {Library}=require('../desktop/storage.cjs');
const {TranslationJobs,source}=require('../desktop/translation.cjs');
const {connectionOf,translateBlocks,withGlossary,Connections,migrateSettings,rememberModel}=require('../desktop/llm.cjs');
const appName = require('../core/app-name.cjs');
async function fixture(t){const dir=await fs.mkdtemp(path.join(os.tmpdir(),`${appName.id}-llm-`));t.after(()=>fs.rm(dir,{recursive:true,force:true}));await fs.mkdir(path.join(dir,'vault'));const pdf=path.join(dir,'test.pdf');await fs.writeFile(pdf,'%PDF-1.4\nfixture');const library=await Library.open(path.join(dir,'vault'));await library.importFiles([pdf]);const paperId=library.data.papers[0].id;return {library,paperId,hash:(await source(library,paperId)).hash};}
const pageAt=n=>({width:600,height:800,blocks:[{id:`p${n}-b0`,text:`Page ${n} research.`,x:20,y:20,width:200,height:40,fontSize:12}]});
async function until(fn){for(let i=0;i<500;i++){if(await fn())return;await new Promise(r=>setTimeout(r,10));}throw Error('condition timeout');}
const client=(id,text,calls=[])=>({id,label:id,status:()=>({usable:true}),models:async()=>[{id:'model'}],translate:async(_m,blocks)=>{calls.push(blocks[0].id);return blocks.map(b=>({id:b.id,text}));}});
const checkpointOf=async(jobs,f)=>JSON.parse(await fs.readFile(jobs.file(f.library,f.paperId).replace('.json','.chunks.json'),'utf8'));

test('any client that answers respond() gets the same streaming and validated translation',async()=>{
 const full='```json\n{"blocks":[{"id":"a","text":"가"},{"id":"b","text":"나"}]}\n```',seen=[];
 const local={respond:async(_m,messages,_i,_s,onDelta)=>{assert.equal(typeof messages[0].content,'string');for(let i=9;i<=full.length;i+=9)onDelta(full.slice(0,i));return full;}};
 assert.deepEqual(await translateBlocks(local,'m',[{id:'a',text:'A'},{id:'b',text:'B'}],undefined,{},(id,text)=>seen.push([id,text])),[{id:'a',text:'가'},{id:'b',text:'나'}]);
 assert.deepEqual(seen,[['a','가'],['b','나']]);
 local.respond=async()=>'{"blocks":[{"id":"a","text":"가"}]}';
 const error=await translateBlocks(local,'m',[{id:'a',text:'A'},{id:'b',text:'B'}]).catch(e=>e);
 assert.match(error.message,/누락 또는 중복/);assert.deepEqual(error.replies,[{id:'a',text:'가'}]);
});

test('connections resolve by id, default to the ChatGPT account and refuse unknown ids',()=>{
 const connections=new Connections(),gpt=connections.register({id:'gpt-web',cancel(){this.cancelled=true;}});
 assert.equal(connections.get(),gpt);assert.equal(connections.get('gpt-web'),gpt);
 assert.throws(()=>connections.get('local'),/연결 방식/);
 connections.cancelAll();assert.ok(gpt.cancelled);
 assert.equal(connectionOf({model:'m'}),'gpt-web');assert.equal(connectionOf(null),'gpt-web');assert.equal(connectionOf({connection:'local'}),'local');
});

test('the glossary is added only for terms in the request, read at request time',async()=>{
 let glossary=[{term:'Kalman filter',translation:'칼만 필터'}],sent;const base={id:'x',label:'X',translate:async(_m,_b,_s,context)=>{sent=context;return [];},status(){return {usable:this.id==='x'};}};
 const wrapped=withGlossary(base,()=>glossary);
 await wrapped.translate('m',[{id:'a',text:'A Kalman filter.'}],undefined,{title:'T'});
 assert.deepEqual(sent.glossary,[{term:'Kalman filter',translation:'칼만 필터'}]);assert.equal(sent.title,'T');
 await wrapped.translate('m',[{id:'a',text:'No terms.'}],undefined,{title:'T'});assert.deepEqual(sent,{title:'T'});
 glossary=[{term:'terms',translation:'용어'}];await wrapped.translate('m',[{id:'a',text:'No terms.'}],undefined,null);assert.equal(sent.glossary[0].translation,'용어');
 assert.equal(wrapped.id,'x');assert.deepEqual(wrapped.status(),{usable:true});
});

test('settings keep the ChatGPT model for older versions and remember a model per connection',()=>{
 const old={recents:[{id:'v'}],provider:'gpt',mode:'web',chatgptModel:'gpt-mini'};
 const migrated=migrateSettings(old);
 assert.deepEqual(migrated.llm,{connection:'gpt-web',models:{'gpt-web':'gpt-mini'}});assert.equal(migrated.chatgptModel,'gpt-mini');assert.deepEqual(migrated.recents,old.recents);
 assert.deepEqual(migrateSettings(migrated),migrated);
 assert.deepEqual(migrateSettings({recents:[]}).llm,{connection:'gpt-web',models:{}});
 assert.deepEqual(migrateSettings({llm:{connection:'local',models:{local:'gemma',bad:3}}}).llm,{connection:'local',models:{local:'gemma'}});
 const local=rememberModel(migrated,'local','gemma');
 assert.deepEqual(local.llm,{connection:'local',models:{'gpt-web':'gpt-mini',local:'gemma'}});assert.equal(local.chatgptModel,'gpt-mini');
 assert.equal(rememberModel(local,'gpt-web','gpt-5').chatgptModel,'gpt-5');
 // Settings of a connection (the local server) survive migration and model changes.
 const withLocal={...migrated,llm:{...migrated.llm,local:{enabled:true,url:'http://127.0.0.1:11434'}}};
 assert.deepEqual(migrateSettings(withLocal).llm.local,withLocal.llm.local);assert.deepEqual(rememberModel(withLocal,'local','gemma').llm.local,withLocal.llm.local);
});

test('a job uses the chosen connection, records it, and keeps ChatGPT cache keys apart from other connections',async t=>{
 const f=await fixture(t),gptCalls=[],localCalls=[],clients={'gpt-web':client('gpt-web','지피티',gptCalls),local:client('local','로컬',localCalls)};
 const jobs=new TranslationJobs(id=>{if(!clients[id])throw Error('연결 방식을 확인하세요.');return clients[id];});
 let job=await jobs.start(f.library,f.paperId,f.hash,[pageAt(1),pageAt(2)],'model',{force:false});await until(()=>jobs.result(job.id).state==='completed');
 assert.equal(job.connection,'gpt-web');assert.equal(gptCalls.length,2);
 const record=await jobs.cached(f.library,f.paperId);assert.equal(record.connection,'gpt-web');
 const gptKeys=Object.keys((await checkpointOf(jobs,f)).entries).sort();
 // An explicit gpt-web job reuses every cached chunk: its keys are the ones written without a connection.
 job=await jobs.start(f.library,f.paperId,f.hash,[pageAt(1),pageAt(2)],'model',{force:false,connection:'gpt-web'});await until(()=>jobs.result(job.id).state==='completed');
 assert.equal(gptCalls.length,2);
 // Another connection never takes ChatGPT's cached text for the same model name.
 job=await jobs.start(f.library,f.paperId,f.hash,[pageAt(1),pageAt(2)],'model',{force:false,connection:'local'});await until(()=>jobs.result(job.id).state==='completed');
 assert.equal(localCalls.length,2);assert.equal(job.connection,'local');
 const saved=await jobs.cached(f.library,f.paperId);assert.equal(saved.connection,'local');assert.equal(saved.pages[0].blocks[0].translation,'로컬');
 const localKeys=Object.keys((await checkpointOf(jobs,f)).entries).filter(k=>!gptKeys.includes(k));assert.equal(localKeys.length,2);
 await assert.rejects(jobs.start(f.library,f.paperId,f.hash,[pageAt(1)],'model',{connection:'gemini-api'}),/연결 방식/);
});

test('page re-translation may switch connection; each page records who translated it, and old records count as ChatGPT',async t=>{
 const f=await fixture(t),clients={'gpt-web':client('gpt-web','새 번역'),local:client('local','로컬')};
 const jobs=new TranslationJobs(id=>clients[id]);
 let job=await jobs.start(f.library,f.paperId,f.hash,[pageAt(1),pageAt(2)],'model');await until(()=>jobs.result(job.id).state==='completed');
 // A record written before connections existed has no connection field.
 const file=jobs.file(f.library,f.paperId),stored=JSON.parse(await fs.readFile(file,'utf8'));delete stored.connection;await fs.writeFile(file,JSON.stringify(stored));
 job=await jobs.start(f.library,f.paperId,f.hash,[],'model',{connection:'local',incremental:true,totalPages:2,pageNumbers:[2]});
 await jobs.writes;assert.equal((await checkpointOf(jobs,f)).pending.connection,'local');
 jobs.append(job.id,2,pageAt(2));jobs.seal(job.id);await until(()=>jobs.result(job.id).state==='completed');
 const record=await jobs.cached(f.library,f.paperId);
 assert.deepEqual(record.pages.map(p=>p.translatedBy),[{connection:'gpt-web',model:'model'},{connection:'local',model:'model'}]);
 assert.deepEqual(record.pages.map(p=>p.blocks[0].translation),['새 번역','로컬']);assert.equal(record.connection,'local');
 // Back to ChatGPT for page 1: page 2 keeps its local translation and attribution.
 job=await jobs.start(f.library,f.paperId,f.hash,[],'model',{incremental:true,totalPages:2,pageNumbers:[1]});jobs.append(job.id,1,pageAt(1));jobs.seal(job.id);await until(()=>jobs.result(job.id).state==='completed');
 assert.deepEqual((await jobs.cached(f.library,f.paperId)).pages.map(p=>p.translatedBy.connection),['gpt-web','local']);
});

test('a connection that is not ready says which one to check',async t=>{
 const f=await fixture(t),jobs=new TranslationJobs({id:'local',label:'로컬 모델',status:()=>({usable:false}),models:async()=>[]});
 await assert.rejects(jobs.start(f.library,f.paperId,f.hash,[pageAt(1)],'model'),/로컬 모델 연결을 먼저 확인하세요/);
});

test('stopping one connection leaves jobs on another running',async t=>{
 const f=await fixture(t);let release;const gate=new Promise(r=>release=r);
 const slow=id=>({id,label:id,status:()=>({usable:true}),models:async()=>[{id:'model'}],translate:async(_m,blocks)=>{await gate;return blocks.map(b=>({id:b.id,text:'번역'}));}});
 const clients={'gpt-web':slow('gpt-web'),local:slow('local')},jobs=new TranslationJobs(id=>clients[id]);
 const local=await jobs.start(f.library,f.paperId,f.hash,[pageAt(1)],'model',{connection:'local'});
 jobs.stopAll('gpt-web');assert.equal(jobs.result(local.id).state,'running');
 jobs.stopAll();assert.equal(jobs.result(local.id).state,'cancelled');release();
 // The cancelled request finishes before the folder is removed.
 await until(()=>jobs.jobs.get(local.id).active===0);await jobs.writes;
});

test('a fatal error stops the job instead of sending the rest of the paper; retries show their cause',async t=>{
 const f=await fixture(t);let calls=0;
 const refusing={id:'gemini-api',label:'Gemini API',concurrency:1,status:()=>({usable:true}),models:async()=>[{id:'model'}],translate:async()=>{calls++;throw Object.assign(Error('Gemini API 일일 사용 한도를 모두 썼습니다.'),{status:429,fatal:true});}};
 let jobs=new TranslationJobs(refusing),job=await jobs.start(f.library,f.paperId,f.hash,Array.from({length:6},(_,i)=>pageAt(i+1)),'model');
 await until(()=>jobs.result(job.id).state!=='running');
 assert.equal(calls,1,'no request after the first fatal error, and no retry of it');
 assert.equal(jobs.result(job.id).state,'failed');assert.match(jobs.result(job.id).message,/번역을 멈췄습니다: Gemini API 일일 사용 한도를 모두 썼습니다\. .*실패 부분 재시도/);
 let seen='';const flaky={id:'gemini-api',label:'Gemini API',status:()=>({usable:true}),models:async()=>[{id:'model'}],translate:async(_m,blocks)=>{if(!seen){seen='waiting';throw Object.assign(Error('Gemini API 요청에 실패했습니다 (503: The model is overloaded.).'),{status:503,retryAfterMs:200});}return blocks.map(b=>({id:b.id,text:'번역'}));}};
 jobs=new TranslationJobs(flaky);job=await jobs.start(f.library,f.paperId,f.hash,[pageAt(1)],'model');
 await until(()=>/다시 시도합니다: .*overloaded/.test(jobs.result(job.id).message)&&(seen='shown'));
 await until(()=>jobs.result(job.id).state==='completed');assert.equal(seen,'shown');
});
