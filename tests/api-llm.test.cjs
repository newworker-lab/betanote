const {test}=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {ApiKeyStore,OpenAIAPI,ClaudeAPI,GeminiAPI}=require('../desktop/api-llm.cjs');
const {Library}=require('../desktop/storage.cjs');
const {TranslationJobs,source}=require('../desktop/translation.cjs');
const appName = require('../core/app-name.cjs');

// A provider on a real socket. routes: 'METHOD /path' (query ignored) => (body, res, req) => void.
async function server(t,routes){
 const requests=[];
 const s=http.createServer(async(req,res)=>{
  let raw='';for await(const chunk of req)raw+=chunk;const url=new URL(req.url,'http://x'),body=raw?JSON.parse(raw):null;requests.push({method:req.method,url:req.url,path:url.pathname,headers:req.headers,body});
  const route=routes[req.method+' '+url.pathname];if(!route){res.writeHead(404,{'Content-Type':'application/json'}).end(JSON.stringify({error:{message:'not found'}}));return;}
  await route(body,res,req,url);
 });
 await new Promise(r=>s.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>{s.closeAllConnections?.();s.close(r);}));
 return {url:`http://127.0.0.1:${s.address().port}`,requests};
}
const json=(res,value,status=200,headers={})=>res.writeHead(status,{'Content-Type':'application/json',...headers}).end(JSON.stringify(value));
const sse=(res,events)=>{res.writeHead(200,{'Content-Type':'text/event-stream'});for(const e of events)res.write((e.event?`event: ${e.event}\n`:'')+'data: '+(typeof e.data==='string'?e.data:JSON.stringify(e.data))+'\n\n');res.end();};
const pieces=(text,size=7)=>Array.from({length:Math.ceil(text.length/size)},(_,i)=>text.slice(i*size,(i+1)*size));
const memoryKeys=(keys={})=>{const store=new ApiKeyStore({file:'/nonexistent',persistent:()=>false});for(const [id,key] of Object.entries(keys))store.keys.set(id,key);return store;};
const make=(Client,url,keys)=>{const client=new Client({fetch,keys:memoryKeys(keys)});client.baseURL=url;return client;};
const reply='{"blocks":[{"id":"a","text":"가"},{"id":"b","text":"나"}]}',blocks=[{id:'a',text:'A'},{id:'b',text:'B'}];

// Anthropic Messages API stream for the given text pieces.
function claudeStream(res,texts,stop='end_turn',extra=[]){
 sse(res,[{event:'message_start',data:{type:'message_start',message:{id:'msg_1',type:'message',role:'assistant',content:[],model:'m',stop_reason:null,stop_sequence:null,usage:{input_tokens:3,output_tokens:0}}}},
  {event:'content_block_start',data:{type:'content_block_start',index:0,content_block:{type:'text',text:''}}},
  ...texts.map(text=>({event:'content_block_delta',data:{type:'content_block_delta',index:0,delta:{type:'text_delta',text}}})),
  {event:'content_block_stop',data:{type:'content_block_stop',index:0}},...extra,
  {event:'message_delta',data:{type:'message_delta',delta:{stop_reason:stop,stop_sequence:null},usage:{output_tokens:9}}},{event:'message_stop',data:{type:'message_stop'}}]);
}

test('keys are encrypted at rest, restored, removed, and kept only in memory without secure storage',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),`${appName.id}-keys-`));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const file=path.join(dir,'llm-keys.json'),options={file,protect:s=>Buffer.from(s).reverse(),unprotect:b=>Buffer.from(b).reverse().toString(),persistent:()=>true};
 const store=new ApiKeyStore(options);await store.init();await store.set('claude-api','sk-ant-secret-1234');
 const raw=await fs.readFile(file,'utf8');assert.ok(!raw.includes('sk-ant-secret'),'no plaintext key on disk');assert.equal(JSON.parse(raw).version,1);
 const again=new ApiKeyStore(options);await again.init();assert.equal(again.get('claude-api'),'sk-ant-secret-1234');
 await again.remove('claude-api');const third=new ApiKeyStore(options);await third.init();assert.equal(third.get('claude-api'),'');
 const memory=new ApiKeyStore({...options,file:path.join(dir,'none.json'),persistent:()=>false});await memory.init();await memory.set('gpt-api','sk-memory-only');
 assert.equal(memory.get('gpt-api'),'sk-memory-only');await assert.rejects(fs.access(path.join(dir,'none.json')));
 const client=new OpenAIAPI({fetch,keys:memory});assert.deepEqual(client.status(),{usable:true,hasKey:true,hint:'…only',persistent:false});
});

test('a key is saved only after the provider accepts it',async t=>{
 const s=await server(t,{'GET /v1/models':(_b,res,req)=>req.headers.authorization==='Bearer sk-good-key-1'?json(res,{data:[{id:'gpt-5-mini',created:2}]}):json(res,{error:{message:'Incorrect API key provided'}},401)});
 const client=make(OpenAIAPI,s.url+'/v1');
 await assert.rejects(client.setKey('short'),/API 키를 확인/);
 await assert.rejects(client.setKey('sk-bad-key-1'),/OpenAI API 키가 올바르지 않거나 권한이 없습니다/);assert.equal(client.status().hasKey,false);
 const down=make(OpenAIAPI,'http://127.0.0.1:9/v1');await assert.rejects(down.setKey('sk-good-key-1'),e=>e.status===503&&/연결하지 못했습니다/.test(e.message));assert.equal(down.status().hasKey,false);
 assert.deepEqual(await client.setKey('  sk-good-key-1 '),{usable:true,hasKey:true,hint:'…ey-1',persistent:false});
 await client.models();await client.models();assert.equal(s.requests.filter(r=>r.path==='/v1/models').length,3,'the list is cached after the check');
 assert.equal((await client.removeKey()).hasKey,false);await assert.rejects(client.models(),/OpenAI API 연결을 먼저 확인하세요/);
});

test('OpenAI: chat models newest first, Responses stream with the key, cut and failed replies',async t=>{
 let mode='ok';
 const s=await server(t,{
  'GET /v1/models':(_b,res)=>json(res,{data:[{id:'gpt-4.1',created:1},{id:'text-embedding-3-large',created:9},{id:'gpt-5',created:5},{id:'gpt-4o-realtime-preview',created:8},{id:'o4-mini',created:3},{id:'dall-e-3',created:7},{id:'whisper-1',created:6}]}),
  'POST /v1/responses':(_b,res)=>{
   if(mode==='limit')return json(res,{error:{message:'Rate limit reached',code:'rate_limit_exceeded'}},429,{'retry-after':'3'});
   if(mode==='cut')return sse(res,[{data:{type:'response.output_text.delta',delta:'{"blocks":['}},{data:{type:'response.incomplete',response:{incomplete_details:{reason:'max_output_tokens'}}}}]);
   sse(res,[...pieces(reply).map(delta=>({event:'response.output_text.delta',data:{type:'response.output_text.delta',delta}})),{event:'response.completed',data:{type:'response.completed'}}]);
  }});
 const client=make(OpenAIAPI,s.url+'/v1',{'gpt-api':'sk-test-0001'}),seen=[];
 assert.deepEqual((await client.models()).map(m=>m.id),['gpt-5','o4-mini','gpt-4.1']);
 assert.deepEqual(await client.translate('gpt-5',blocks,undefined,{},(id,text)=>seen.push([id,text])),[{id:'a',text:'가'},{id:'b',text:'나'}]);assert.deepEqual(seen,[['a','가'],['b','나']]);
 const sent=s.requests.at(-1);assert.equal(sent.headers.authorization,'Bearer sk-test-0001');assert.equal(sent.body.store,false);assert.equal(sent.body.stream,true);assert.match(sent.body.instructions,/Korean/);
 await client.explainFigure('gpt-5','data:image/png;base64,QUJD',{page:1},undefined).catch(()=>{});
 const figureKo=JSON.stringify(s.requests.at(-1).body);assert.ok(figureKo.includes('Explain the selected research figure in Korean.'),'Korean by default');
 await client.explainFigure('gpt-5','data:image/png;base64,QUJD',{page:1},undefined,'fr').catch(()=>{});assert.ok(JSON.stringify(s.requests.at(-1).body).includes('Explain the selected research figure in French.'),'the answer language');
 assert.deepEqual(s.requests.at(-1).body.input[0].content[1],{type:'input_image',image_url:'data:image/png;base64,QUJD',detail:'high'});
 mode='cut';await assert.rejects(client.respond('gpt-5',[{role:'user',content:'x'}],'I'),/출력 길이 한도에서 잘렸습니다/);
 mode='limit';await assert.rejects(client.respond('gpt-5',[{role:'user',content:'x'}],'I'),e=>e.status===429&&e.retryAfterMs===3000&&/요청 한도/.test(e.message));
});

test('Claude: models with output limits and image support, streamed reply through the SDK, refusal and cut replies',async t=>{
 let mode='ok';
 const s=await server(t,{
  'GET /v1/models':(_b,res,req)=>req.headers['x-api-key']==='sk-ant-good'?json(res,{data:[{type:'model',id:'claude-haiku-5-5',display_name:'Claude Haiku 5.5',created_at:'2026-09-01T00:00:00Z',max_tokens:128000,capabilities:{image_input:{supported:true}}},{type:'model',id:'claude-text',display_name:'Text only',created_at:'2026-01-01T00:00:00Z',max_tokens:4096,capabilities:{image_input:{supported:false}}}],has_more:false,first_id:'claude-haiku-5-5',last_id:'claude-text'}):json(res,{type:'error',error:{type:'authentication_error',message:'invalid x-api-key'}},401),
  'POST /v1/messages':(body,res)=>{
   if(mode==='limit')return json(res,{type:'error',error:{type:'rate_limit_error',message:'Number of request tokens has exceeded your per-minute rate limit'}},429,{'retry-after':'2'});
   if(mode==='refusal')return claudeStream(res,[],'refusal');
   if(mode==='cut')return claudeStream(res,['{"blocks":['],'max_tokens');
   if(mode==='fallback')return claudeStream(res,['{"blocks":[{"id":"a","text":"버린'],'end_turn',[{event:'content_block_start',data:{type:'content_block_start',index:1,content_block:{type:'fallback',from:{model:'claude-opus-5-5'},to:{model:'claude-opus-4-8'}}}},{event:'content_block_stop',data:{type:'content_block_stop',index:1}},{event:'content_block_start',data:{type:'content_block_start',index:2,content_block:{type:'text',text:''}}},{event:'content_block_delta',data:{type:'content_block_delta',index:2,delta:{type:'text_delta',text:reply}}},{event:'content_block_stop',data:{type:'content_block_stop',index:2}}]);
   claudeStream(res,pieces(reply));
  }});
 const client=make(ClaudeAPI,s.url);
 await assert.rejects(client.setKey('sk-ant-wrong'),/Claude API 키가 올바르지 않거나 권한이 없습니다/);
 await client.setKey('sk-ant-good');
 assert.deepEqual(await client.models(),[{id:'claude-haiku-5-5',name:'Claude Haiku 5.5',vision:true},{id:'claude-text',name:'Text only',vision:false}]);
 const seen=[];assert.deepEqual(await client.translate('claude-haiku-5-5',blocks,undefined,{},(id,text)=>seen.push(id)),[{id:'a',text:'가'},{id:'b',text:'나'}]);assert.deepEqual(seen,['a','b']);
 let sent=s.requests.at(-1);
 assert.equal(sent.headers['x-api-key'],'sk-ant-good');assert.ok(sent.headers['anthropic-version']);assert.equal(sent.path,'/v1/messages');assert.ok(!sent.url.includes('beta'));
 assert.equal(sent.body.model,'claude-haiku-5-5');assert.equal(sent.body.stream,true);assert.equal(sent.body.max_tokens,32000);assert.match(sent.body.system,/Korean/);assert.equal(sent.body.temperature,undefined);
 await client.respond('claude-text',[{role:'user',content:'x'}],'I');assert.equal(s.requests.at(-1).body.max_tokens,4096,'never above the model output limit');
 await client.explainFigure('claude-haiku-5-5','data:image/png;base64,QUJD',{page:1},undefined).catch(()=>{});
 const figureKo=JSON.stringify(s.requests.at(-1).body);assert.ok(figureKo.includes('Explain the selected research figure in Korean.'),'Korean by default');
 await client.explainFigure('claude-haiku-5-5','data:image/png;base64,QUJD',{page:1},undefined,'fr').catch(()=>{});assert.ok(JSON.stringify(s.requests.at(-1).body).includes('Explain the selected research figure in French.'),'the answer language');
 assert.deepEqual(s.requests.at(-1).body.messages[0].content[0],{type:'image',source:{type:'base64',media_type:'image/png',data:'QUJD'}});
 // Models with server-side fallback ask for it; after a fallback only the finishing model's text counts.
 mode='fallback';assert.equal(await client.respond('claude-opus-5-5',[{role:'user',content:'x'}],'I'),reply);
 sent=s.requests.at(-1);assert.ok(sent.url.includes('beta=true'));assert.equal(sent.body.fallbacks,'default');assert.match(sent.headers['anthropic-beta'],/server-side-fallback-2026-07-01/);
 // Every model with server-side fallback (platform.claude.com, Refusals and fallback): all with refusal classifiers but Haiku 5.5.
 for(const model of ['claude-fable-5-2','claude-mythos-5-2','claude-fable-5-1','claude-mythos-5-1','claude-fable-5','claude-opus-5','claude-sonnet-5-5']){await client.respond(model,[{role:'user',content:'x'}],'I');assert.equal(s.requests.at(-1).body.fallbacks,'default',model);}
 mode='ok';await client.respond('claude-haiku-5-5',[{role:'user',content:'x'}],'I');assert.equal(s.requests.at(-1).body.fallbacks,undefined,'Haiku 5.5 has no server-side fallback');
 mode='refusal';await assert.rejects(client.respond('claude-haiku-5-5',[{role:'user',content:'x'}],'I'),/안전 정책/);
 mode='cut';await assert.rejects(client.respond('claude-haiku-5-5',[{role:'user',content:'x'}],'I'),/출력 길이 한도/);
 mode='limit';await assert.rejects(client.respond('claude-haiku-5-5',[{role:'user',content:'x'}],'I'),e=>e.status===429&&e.retryAfterMs===2000);
});

test('Gemini: paged model list, JSON replies on request, thinking left out, blocks and cut replies',async t=>{
 let mode='ok';
 const s=await server(t,{
  'GET /v1beta/models':(_b,res,req,url)=>{
   if(req.headers['x-goog-api-key']!=='AIza-good-key')return json(res,{error:{code:400,message:'API key not valid. Please pass a valid API key.',status:'INVALID_ARGUMENT'}},400);
   if(!url.searchParams.get('pageToken'))return json(res,{models:[{name:'models/gemini-2.5-flash',displayName:'Gemini 2.5 Flash',supportedGenerationMethods:['generateContent','countTokens']},{name:'models/text-embedding-004',supportedGenerationMethods:['embedContent']}],nextPageToken:'p2'});
   json(res,{models:[{name:'models/gemini-2.5-flash-preview-tts',supportedGenerationMethods:['generateContent']},{name:'models/gemini-3-pro',displayName:'Gemini 3 Pro',supportedGenerationMethods:['generateContent']},{name:'models/gemma-3-27b-it',supportedGenerationMethods:['generateContent']}]});
  },
  'POST /v1beta/models/gemini-2.5-flash:streamGenerateContent':(_b,res)=>{
   if(mode==='limit')return json(res,{error:{code:429,message:'Resource has been exhausted',status:'RESOURCE_EXHAUSTED',details:[{'@type':'type.googleapis.com/google.rpc.RetryInfo',retryDelay:'4s'}]}},429);
   if(mode==='blocked')return sse(res,[{data:{promptFeedback:{blockReason:'PROHIBITED_CONTENT'}}}]);
   if(mode==='safety')return sse(res,[{data:{candidates:[{content:{parts:[{text:'{"bl'}]},finishReason:'RECITATION'}]}}]);
   if(mode==='cut')return sse(res,[{data:{candidates:[{content:{parts:[{text:'{"bl'}]},finishReason:'MAX_TOKENS'}]}}]);
   sse(res,[{data:{candidates:[{content:{role:'model',parts:[{text:'reasoning {"id":"a","text":"wrong"}',thought:true}]}}]}},...pieces(reply).map(text=>({data:{candidates:[{content:{role:'model',parts:[{text}]}}]}})),{data:{candidates:[{content:{role:'model',parts:[{text:''}]},finishReason:'STOP'}],usageMetadata:{totalTokenCount:9}}}]);
  }});
 const client=make(GeminiAPI,s.url+'/v1beta');
 await assert.rejects(client.setKey('AIza-bad-key'),/Gemini API 키가 올바르지 않거나 권한이 없습니다/);
 await client.setKey('AIza-good-key');
 assert.deepEqual(await client.models(),[{id:'gemini-2.5-flash',name:'Gemini 2.5 Flash'},{id:'gemini-3-pro',name:'Gemini 3 Pro'}]);
 const seen=[];assert.deepEqual(await client.translate('gemini-2.5-flash',blocks,undefined,{},(id,text)=>seen.push([id,text])),[{id:'a',text:'가'},{id:'b',text:'나'}]);assert.deepEqual(seen,[['a','가'],['b','나']]);
 let sent=s.requests.at(-1);assert.equal(sent.headers['x-goog-api-key'],'AIza-good-key');assert.match(sent.url,/alt=sse/);assert.ok(!sent.url.includes('AIza'),'the key is not in the address');
 assert.deepEqual(sent.body.generationConfig,{responseMimeType:'application/json'});assert.match(sent.body.systemInstruction.parts[0].text,/Korean/);assert.deepEqual(JSON.parse(sent.body.contents[0].parts[0].text).blocks,blocks);
 await client.explainFigure('gemini-2.5-flash','data:image/png;base64,QUJD',{page:1},undefined).catch(()=>{});
 const figureKo=JSON.stringify(s.requests.at(-1).body);assert.ok(figureKo.includes('Explain the selected research figure in Korean.'),'Korean by default');
 await client.explainFigure('gemini-2.5-flash','data:image/png;base64,QUJD',{page:1},undefined,'fr').catch(()=>{});assert.ok(JSON.stringify(s.requests.at(-1).body).includes('Explain the selected research figure in French.'),'the answer language');
 sent=s.requests.at(-1);assert.deepEqual(sent.body.contents[0].parts[1],{inlineData:{mimeType:'image/png',data:'QUJD'}});assert.equal(sent.body.generationConfig,undefined);
 for(const [m,pattern] of [['blocked',/PROHIBITED_CONTENT/],['safety',/RECITATION/],['cut',/출력 길이 한도/]]){mode=m;await assert.rejects(client.respond('gemini-2.5-flash',[{role:'user',content:'x'}],'I'),pattern);}
 mode='limit';await assert.rejects(client.respond('gemini-2.5-flash',[{role:'user',content:'x'}],'I'),e=>e.status===429&&e.retryAfterMs===4000);
});

test('a translation job on Claude API keeps at most three requests running and records the connection',async t=>{
 let active=0,most=0;
 const s=await server(t,{
  'GET /v1/models':(_b,res)=>json(res,{data:[{type:'model',id:'claude-haiku-5-5',display_name:'Claude Haiku 5.5',created_at:'2026-09-01T00:00:00Z',max_tokens:128000}],has_more:false}),
  'POST /v1/messages':async(body,res)=>{active++;most=Math.max(most,active);await new Promise(r=>setTimeout(r,20));active--;const input=JSON.parse(body.messages[0].content).blocks;claudeStream(res,[JSON.stringify({blocks:input.map(b=>({id:b.id,text:'Claude 번역'}))})]);}
 });
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),`${appName.id}-api-`));t.after(()=>fs.rm(dir,{recursive:true,force:true}));await fs.mkdir(path.join(dir,'vault'));
 const pdf=path.join(dir,'test.pdf');await fs.writeFile(pdf,'%PDF-1.4\nfixture');const library=await Library.open(path.join(dir,'vault'));await library.importFiles([pdf]);
 const paperId=library.data.papers[0].id,hash=(await source(library,paperId)).hash,claude=make(ClaudeAPI,s.url,{'claude-api':'sk-ant-good'});
 const pageAt=n=>({width:600,height:800,blocks:[{id:`p${n}-b0`,text:`Page ${n} research.`,x:20,y:20,width:200,height:40,fontSize:12}]});
 const jobs=new TranslationJobs(id=>id==='claude-api'?claude:null);
 const job=await jobs.start(library,paperId,hash,Array.from({length:8},(_,i)=>pageAt(i+1)),'claude-haiku-5-5',{connection:'claude-api'});
 for(let i=0;i<300&&jobs.jobs.get(job.id).state==='running';i++)await new Promise(r=>setTimeout(r,10));
 assert.equal(jobs.result(job.id).state,'completed');assert.ok(most<=3&&most>1,`at most three at a time (saw ${most})`);
 const record=await jobs.cached(library,paperId);assert.equal(record.connection,'claude-api');assert.equal(record.pages[7].blocks[0].translation,'Claude 번역');
});

test('without the Anthropic package installed the module still loads and only Claude API says to run npm install',()=>{
 // A fresh process where resolving @anthropic-ai/sdk fails, as in a checkout whose packages were not reinstalled.
 const script=`const Module=require('node:module'),resolve=Module._resolveFilename;
Module._resolveFilename=function(request,...rest){if(request==='@anthropic-ai/sdk'){const e=new Error("Cannot find module '@anthropic-ai/sdk'");e.code='MODULE_NOT_FOUND';throw e;}return resolve.call(this,request,...rest);};
const {ApiKeyStore,ClaudeAPI,OpenAIAPI}=require(${JSON.stringify(require.resolve('../desktop/api-llm.cjs'))});
const keys=new ApiKeyStore({file:'/nonexistent',persistent:()=>false});
new OpenAIAPI({fetch,keys});
new ClaudeAPI({fetch,keys}).setKey('sk-ant-good-1234').then(()=>process.exit(2),e=>{console.log(e.message);process.exit(0);});`;
 const result=require('node:child_process').spawnSync(process.execPath,['-e',script],{encoding:'utf8'});
 assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/@anthropic-ai\/sdk\)이 설치되지 않았습니다\. 프로젝트 폴더에서 npm install/);
});

test('errors no retry can fix are marked fatal; rate limits wait as long as the provider asks, up to a minute',async t=>{
 let reply;
 const s=await server(t,{'POST /v1beta/models/gemini-3-pro:streamGenerateContent':(_b,res)=>json(res,...reply),'POST /v1/responses':(_b,res)=>json(res,...reply)});
 const gemini=make(GeminiAPI,s.url+'/v1beta',{'gemini-api':'AIza-good-key'}),openai=make(OpenAIAPI,s.url+'/v1',{'gpt-api':'sk-test-0001'});
 const ask=client=>client.respond(client===gemini?'gemini-3-pro':'gpt-5',[{role:'user',content:'x'}],'I').then(()=>null,e=>e);
 const quota=(quotaId,quotaValue,retryDelay)=>[{error:{code:429,status:'RESOURCE_EXHAUSTED',message:`You exceeded your current quota, please check your plan and billing details. Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: ${quotaValue}, model: gemini-3-pro`,details:[{'@type':'type.googleapis.com/google.rpc.QuotaFailure',violations:[{quotaMetric:'generativelanguage.googleapis.com/generate_content_free_tier_requests',quotaId,quotaValue}]},...(retryDelay?[{'@type':'type.googleapis.com/google.rpc.RetryInfo',retryDelay}]:[])]}},429];
 // A per-minute quota is waited out, even when Google asks for longer than ten seconds.
 reply=quota('GenerateRequestsPerMinutePerProjectPerModel-FreeTier','10','37s');let e=await ask(gemini);
 assert.equal(e.fatal,false);assert.equal(e.retryAfterMs,37000);assert.match(e.message,/요청 한도에 걸렸습니다/);
 reply=quota('GenerateRequestsPerMinutePerProjectPerModel-FreeTier','10','300s');assert.equal((await ask(gemini)).retryAfterMs,60000);
 reply=quota('GenerateRequestsPerDayPerProjectPerModel-FreeTier','250','5s');e=await ask(gemini);assert.equal(e.fatal,true);assert.match(e.message,/일일 사용 한도를 모두 썼습니다/);
 reply=quota('GenerateRequestsPerMinutePerProjectPerModel-FreeTier','0','5s');e=await ask(gemini);assert.equal(e.fatal,true);assert.match(e.message,/요금 등급에서는 이 모델을 쓸 수 없습니다/);
 reply=[{error:{code:404,message:'models/gemini-3-pro is not found for API version v1beta',status:'NOT_FOUND'}},404];e=await ask(gemini);assert.equal(e.fatal,true);assert.match(e.message,/모델을 찾을 수 없습니다/);
 reply=[{error:{code:503,message:'The model is overloaded. Please try again later.',status:'UNAVAILABLE'}},503];e=await ask(gemini);assert.equal(e.fatal,false);assert.equal(e.status,503);assert.match(e.message,/overloaded/);
 reply=[{error:{message:'You exceeded your current quota, please check your plan and billing details.',type:'insufficient_quota',code:'insufficient_quota'}},429];e=await ask(openai);assert.equal(e.fatal,true);assert.match(e.message,/크레딧이나 사용 한도가 부족합니다/);
 reply=[{error:{message:'Rate limit reached for gpt-5',code:'rate_limit_exceeded'}},429];e=await ask(openai);assert.equal(e.fatal,false);
 reply=[{error:{message:'Incorrect API key provided'}},401];e=await ask(openai);assert.equal(e.fatal,true);
});
test('other OpenAI-compatible providers: address rules, model list, chat stream, cut-off and refusal',async t=>{
 const {CompatibleAPI,normalizeProvider}=require('../desktop/api-llm.cjs');
 assert.deepEqual(normalizeProvider({preset:'deepseek'}),{preset:'deepseek',name:'DeepSeek',url:'https://api.deepseek.com/v1'});
 assert.equal(normalizeProvider({name:' My  host ',url:'https://llm.example.org/v1/'}).url,'https://llm.example.org/v1');
 assert.equal(normalizeProvider({name:'Here',url:'http://127.0.0.1:8080/v1'}).url,'http://127.0.0.1:8080/v1','http only for this computer');
 for(const url of ['http://llm.example.org/v1','https://user:pw@llm.example.org/v1','https://llm.example.org/v1?key=1','ftp://x'])assert.throws(()=>normalizeProvider({name:'X',url}),/https/);
 assert.throws(()=>normalizeProvider({name:'',url:'https://a.b/v1'}),/이름/);
 let mode='ok';
 const {url,requests}=await server(t,{
  'GET /v1/models':(_b,res,req)=>req.headers.authorization==='Bearer good-key-123'?json(res,{data:[{id:'solar-pro'},{id:'text-embedding-3'},{id:'deepseek-chat',name:'DeepSeek Chat'}]}):json(res,{error:{message:'Invalid API key'}},401),
  'POST /v1/chat/completions':(body,res)=>{
   if(mode==='length')return sse(res,[{data:{choices:[{delta:{content:'{"blocks":['}}]}},{data:{choices:[{delta:{},finish_reason:'length'}]}}]);
   if(mode==='filter')return sse(res,[{data:{choices:[{delta:{},finish_reason:'content_filter'}]}}]);
   sse(res,[...pieces('<think>hmm</think>'+reply).map(p=>({data:{choices:[{delta:{content:p}}]}})),{data:{choices:[{delta:{},finish_reason:'stop'}]}},{data:'[DONE]'}]);
  }});
 const client=new CompatibleAPI({fetch,keys:memoryKeys(),provider:{id:'custom-1',preset:'',name:'Mine',url:url+'/v1'}});
 await assert.rejects(client.setKey('bad-key-1234'),/Mine 키가 올바르지 않거나/);assert.equal(client.status().hasKey,false);
 const status=await client.setKey('good-key-123');assert.deepEqual([status.hasKey,status.custom,status.url,status.keyPage],[true,true,url+'/v1',false]);
 assert.deepEqual(await client.models(),[{id:'deepseek-chat',name:'DeepSeek Chat'},{id:'solar-pro',name:'solar-pro'}],'no embedding models');
 assert.deepEqual(await client.translate('solar-pro',blocks),[{id:'a',text:'가'},{id:'b',text:'나'}],'a reasoning model’s <think> part is dropped');
 const sent=requests.find(r=>r.path==='/v1/chat/completions').body;assert.equal(sent.model,'solar-pro');assert.equal(sent.stream,true);assert.equal(sent.messages[0].role,'system');
 mode='length';await assert.rejects(client.respond('solar-pro',[{role:'user',content:'x'}],'i'),/잘렸습니다/);
 mode='filter';await assert.rejects(client.respond('solar-pro',[{role:'user',content:'x'}],'i'),/정책/);
});

test('a translation\'s reference images go in each provider\'s own image form', () => {
  const { CompatibleAPI } = require('../desktop/api-llm.cjs'), { LocalLLM } = require('../desktop/local-llm.cjs');
  const png = 'data:image/png;base64,iVBORw0KGgo=', data = 'iVBORw0KGgo=';
  assert.deepEqual(OpenAIAPI.prototype.imageMessage('t', [png]).content, [{ type: 'input_text', text: 't' }, { type: 'input_image', image_url: png, detail: 'auto' }]);
  assert.deepEqual(ClaudeAPI.prototype.imageMessage('t', [png]).content, [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data } }, { type: 'text', text: 't' }]);
  assert.deepEqual(GeminiAPI.prototype.imageMessage('t', [png]).parts, [{ text: 't' }, { inlineData: { mimeType: 'image/png', data } }]);
  assert.deepEqual(CompatibleAPI.prototype.imageMessage('t', [png]).content, [{ type: 'text', text: 't' }, { type: 'image_url', image_url: { url: png } }]);
  assert.deepEqual(LocalLLM.prototype.imageMessage.call({ settings: { kind: 'ollama' } }, 't', [png]), { role: 'user', content: 't', images: [data] });
  assert.deepEqual(LocalLLM.prototype.imageMessage.call({ settings: { kind: 'openai' } }, 't', [png]).content[1], { type: 'image_url', image_url: { url: png } });
});

test('keys go through a secure storage that answers later, and are written again when its key has changed',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),`${appName.id}-keys-`));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const file=path.join(dir,'llm-keys.json'),later=value=>new Promise(resolve=>setTimeout(()=>resolve(value),1));
 // The old storage key reversed the bytes; the new one also puts a mark in front.
 const oldKey={file,protect:s=>later(Buffer.from(s).reverse()),unprotect:b=>later({result:Buffer.from(b).reverse().toString(),shouldReEncrypt:false}),persistent:()=>true};
 const store=new ApiKeyStore(oldKey);await store.init();await store.set('gpt-api','sk-first-0001');await store.set('claude-api','sk-ant-second-0002');
 const written=await fs.readFile(file,'utf8');assert.ok(!written.includes('sk-first')&&!written.includes('sk-ant-second'));
 const again=new ApiKeyStore(oldKey);await again.init();assert.deepEqual([again.get('gpt-api'),again.get('claude-api'),again.restoreFailed],['sk-first-0001','sk-ant-second-0002',undefined]);
 assert.equal(await fs.readFile(file,'utf8'),written,'nothing is rewritten while the storage key is the same');
 const rotated={file,protect:s=>later(Buffer.concat([Buffer.from('N'),Buffer.from(s).reverse()])),unprotect:b=>later(b[0]===78?{result:Buffer.from(b.subarray(1)).reverse().toString(),shouldReEncrypt:false}:{result:Buffer.from(b).reverse().toString(),shouldReEncrypt:true}),persistent:()=>true};
 const moved=new ApiKeyStore(rotated);await moved.init();assert.equal(moved.get('gpt-api'),'sk-first-0001');
 const rewritten=JSON.parse(await fs.readFile(file,'utf8'));assert.ok(Object.values(rewritten.keys).every(c=>Buffer.from(c,'base64')[0]===78),'both keys are stored under the new storage key');
 const last=new ApiKeyStore(rotated);await last.init();assert.equal(last.get('claude-api'),'sk-ant-second-0002');
 // A key that cannot be read leaves the file as it is.
 const broken=new ApiKeyStore({...rotated,unprotect:async b=>{if(Buffer.from(b).includes(Buffer.from('1000')))throw Error('unreadable');return {result:'x',shouldReEncrypt:true};}});const before=await fs.readFile(file,'utf8');await broken.init();
 assert.equal(broken.restoreFailed,true);assert.equal(await fs.readFile(file,'utf8'),before);
 // The connection whose key could not be read asks to connect again until a key is entered; the others do not.
 const unread=Object.keys(JSON.parse(before).keys).filter(id=>Buffer.from(JSON.parse(before).keys[id],'base64').includes(Buffer.from('1000')));
 assert.deepEqual(unread,['gpt-api']);const gpt=new OpenAIAPI({fetch:async()=>{throw Error('no network');},keys:broken}),claude=new ClaudeAPI({fetch:async()=>{throw Error('no network');},keys:broken});
 assert.deepEqual([gpt.status().restoreFailed,claude.status().restoreFailed],[true,undefined]);
 // Another key saved meanwhile keeps what could not be read in the file (a keyring that answers again later still finds it).
 const unreadCipher=JSON.parse(before).keys['gpt-api'];await broken.set('claude-api','sk-ant-new-0004');
 assert.equal(JSON.parse(await fs.readFile(file,'utf8')).keys['gpt-api'],unreadCipher);assert.equal(gpt.status().restoreFailed,true);
 // Removed, it is gone from the file; entered again, it is saved anew.
 await broken.remove('gpt-api');assert.equal(JSON.parse(await fs.readFile(file,'utf8')).keys['gpt-api'],undefined);assert.equal(gpt.status().restoreFailed,undefined);
 const again2=new ApiKeyStore({...rotated,unprotect:async b=>{if(Buffer.from(b).includes(Buffer.from('1000')))throw Error('unreadable');return {result:'x',shouldReEncrypt:false};}});
 await fs.writeFile(file,before);await again2.init();again2.persistent=()=>false;await again2.set('gpt-api','sk-new-0003');assert.equal(again2.unreadable.has('gpt-api'),false);
});
