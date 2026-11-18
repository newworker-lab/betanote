const {test}=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {LocalLLM,normalizeLocal,isLoopback}=require('../desktop/local-llm.cjs');
const {Library}=require('../desktop/storage.cjs');
const {TranslationJobs,source}=require('../desktop/translation.cjs');
const appName = require('../core/app-name.cjs');

// A model server on a real socket. routes: 'METHOD /path' => (body, res) => void.
async function server(t,routes){
 const requests=[];
 const s=http.createServer(async(req,res)=>{
  let raw='';for await(const chunk of req)raw+=chunk;const body=raw?JSON.parse(raw):null;requests.push({method:req.method,url:req.url,body});
  const route=routes[req.method+' '+req.url];if(!route){res.writeHead(404,{'Content-Type':'application/json'}).end(JSON.stringify({error:'not found'}));return;}
  await route(body,res);
 });
 await new Promise(r=>s.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>s.close(r)));
 return {url:`http://127.0.0.1:${s.address().port}`,requests};
}
const ndjson=(res,events)=>{res.writeHead(200,{'Content-Type':'application/x-ndjson'});for(const e of events)res.write(JSON.stringify(e)+'\n');res.end();};
const sse=(res,events)=>{res.writeHead(200,{'Content-Type':'text/event-stream'});for(const e of events)res.write('data: '+(typeof e==='string'?e:JSON.stringify(e))+'\n\n');res.end();};
const pieces=(text,size=7)=>Array.from({length:Math.ceil(text.length/size)},(_,i)=>text.slice(i*size,(i+1)*size));
const client=(url,extra={})=>new LocalLLM({fetch,settings:{enabled:true,url,...extra}});

test('settings: loopback only by default, remote needs confirmation, bad addresses refused',()=>{
 assert.deepEqual(normalizeLocal({}),{enabled:false,kind:'ollama',url:'http://127.0.0.1:11434',numCtx:16384,think:false,remoteConfirmed:false});
 assert.equal(normalizeLocal({think:true}).think,true);assert.equal(normalizeLocal({think:'yes'}).think,false,'only true turns reasoning on');
 assert.equal(normalizeLocal({kind:'openai'}).url,'http://127.0.0.1:1234/v1');
 assert.equal(normalizeLocal({url:' http://localhost:11434/ ',numCtx:1000}).url,'http://localhost:11434');
 assert.equal(normalizeLocal({numCtx:1000}).numCtx,8192);assert.equal(normalizeLocal({numCtx:10**7}).numCtx,131072);
 for(const url of ['http://localhost:1','http://127.0.0.1:1','http://127.8.9.10:1','http://[::1]:1'])assert.ok(isLoopback(url),url);
 for(const url of ['http://192.168.0.10:11434','http://gpu.example:11434','http://127.0.0.1.example:1'])assert.ok(!isLoopback(url),url);
 for(const url of ['ftp://127.0.0.1','http://user:pw@127.0.0.1:11434','not a url','http://127.0.0.1:11434/?x=1'])assert.throws(()=>normalizeLocal({url}),/주소/);
 const remote=new LocalLLM({fetch,settings:{enabled:true,url:'http://192.168.0.10:11434'}});
 assert.equal(remote.status().usable,false);assert.equal(remote.status().remote,true);
 remote.configure({enabled:true,url:'http://192.168.0.10:11434',remoteConfirmed:true});assert.equal(remote.status().usable,true);
 assert.equal(new LocalLLM({fetch,settings:{url:'http://127.0.0.1:11434'}}).status().usable,false,'off until enabled');
 assert.equal(new LocalLLM({fetch,settings:{enabled:true,url:'bad'}}).status().usable,false,'a stored bad address falls back to off');
 assert.equal(client('http://127.0.0.1:1',{numCtx:16384}).inputBudget,(16384-5120)*3);
});

test('Ollama models: embedding-only models are left out, image support is shown, model details are cached',async t=>{
 const shows={'qwen2.5:14b':['completion','tools'],'gemma3:12b':['completion','vision'],'nomic-embed-text':['embedding']};
 const s=await server(t,{
  'GET /api/tags':(_b,res)=>res.end(JSON.stringify({models:[
   {name:'qwen2.5:14b',digest:'a',details:{parameter_size:'14.8B',quantization_level:'Q4_K_M'}},{name:'gemma3:12b',digest:'b',details:{}},{name:'nomic-embed-text',digest:'c'},{name:'old:7b',digest:'d'}]})),
  'POST /api/show':(body,res)=>shows[body.model]?res.end(JSON.stringify({capabilities:shows[body.model]})):res.end(JSON.stringify({})),
  'GET /api/version':(_b,res)=>res.end(JSON.stringify({version:'0.12.6'}))
 });
 const local=client(s.url);
 assert.deepEqual(await local.models(),[{id:'qwen2.5:14b',name:'qwen2.5:14b (14.8B Q4_K_M)',vision:false},{id:'gemma3:12b',name:'gemma3:12b',vision:true},{id:'old:7b',name:'old:7b'}]);
 const shown=s.requests.filter(r=>r.url==='/api/show').length;await local.models();
 assert.equal(s.requests.filter(r=>r.url==='/api/show').length,shown,'capabilities are asked once per model digest');
 const check=await local.check();assert.equal(check.version,'0.12.6');assert.equal(check.models,3);
});

test('Ollama chat: context length, system instructions and JSON format are sent; the reply streams and thinking is dropped',async t=>{
 const reply='<think>plan the answer {"id":"a","text":"wrong"}</think>{"blocks":[{"id":"a","text":"가"},{"id":"b","text":"나"}]}';
 const s=await server(t,{'POST /api/chat':(_b,res)=>ndjson(res,[...pieces(reply).map(c=>({message:{role:'assistant',content:c},done:false})),{message:{content:''},done:true,done_reason:'stop'}])});
 const local=client(s.url,{numCtx:20000}),seen=[];
 const result=await local.translate('qwen2.5:14b',[{id:'a',text:'A'},{id:'b',text:'B'}],undefined,{title:'T'},(id,text)=>seen.push([id,text]));
 assert.deepEqual(result,[{id:'a',text:'가'},{id:'b',text:'나'}]);assert.deepEqual(seen,[['a','가'],['b','나']]);
 const sent=s.requests.at(-1).body;
 assert.equal(sent.model,'qwen2.5:14b');assert.equal(sent.stream,true);assert.deepEqual(sent.options,{num_ctx:20000});assert.equal(sent.format,'json');
 assert.equal(sent.messages[0].role,'system');assert.match(sent.messages[0].content,/Korean/);assert.deepEqual(JSON.parse(sent.messages[1].content).blocks,[{id:'a',text:'A'},{id:'b',text:'B'}]);
 // Plain text answers (figure, AI help without JSON) do not ask for JSON.
 await local.respond('m',[{role:'user',content:'x'}],'I',undefined);assert.equal(s.requests.at(-1).body.format,undefined);
});

test('Ollama thinking models think only when reasoning is turned on; other models and an unknown Ollama are sent no flag',async t=>{
 const shows={'qwen3.5:4b':['completion','thinking'],'qwen2.5:14b':['completion','tools']};
 const s=await server(t,{
  'POST /api/show':(body,res)=>shows[body.model]?res.end(JSON.stringify({capabilities:shows[body.model]})):res.writeHead(404,{'Content-Type':'application/json'}).end(JSON.stringify({error:'not found'})),
  'POST /api/chat':(_b,res)=>ndjson(res,[{message:{content:'{"blocks":[{"id":"a","text":"가"}]}'},done:true,done_reason:'stop'}])
 });
 const local=client(s.url),chats=()=>s.requests.filter(r=>r.url==='/api/chat').map(r=>r.body);
 await local.translate('qwen3.5:4b',[{id:'a',text:'A'}],undefined,{title:'T'});
 assert.equal(chats().at(-1).think,false);assert.equal(chats().at(-1).format,'json');assert.deepEqual(chats().at(-1).options,{num_ctx:16384});
 await local.respond('qwen3.5:4b',[{role:'user',content:'x'}],'I',undefined);assert.equal(chats().at(-1).think,false,'AI help and figures too');
 assert.equal(s.requests.filter(r=>r.url==='/api/show').length,1,'model details are asked once');
 local.configure({enabled:true,url:s.url,think:true});assert.equal(local.status().think,true);
 await local.respond('qwen3.5:4b',[{role:'user',content:'x'}],'I',undefined);assert.equal(chats().at(-1).think,true,'reasoning on');
 await local.respond('qwen2.5:14b',[{role:'user',content:'x'}],'I',undefined);assert.ok(!('think' in chats().at(-1)),'a model without thinking is sent no flag even when on');
 local.configure({enabled:true,url:s.url});
 await local.respond('qwen2.5:14b',[{role:'user',content:'x'}],'I',undefined);assert.ok(!('think' in chats().at(-1)));
 await local.respond('unknown:1b',[{role:'user',content:'x'}],'I',undefined);assert.ok(!('think' in chats().at(-1)),'no model details: no flag');
 // OpenAI-compatible servers are never asked about thinking.
 const o=await server(t,{'POST /chat/completions':(_b,res)=>sse(res,[{choices:[{delta:{content:'가'},finish_reason:'stop'}]},'[DONE]'])});
 await client(o.url+'',{kind:'openai'}).respond('qwen3.5:4b',[{role:'user',content:'x'}],'I',undefined);
 assert.ok(!('think' in o.requests.at(-1).body));assert.equal(o.requests.length,1);
});

test('Ollama failures: cut by context length, stopped stream, server errors and a server that is not running',async t=>{
 let mode='length';
 const s=await server(t,{'POST /api/chat':(_b,res)=>{
  if(mode==='length')return ndjson(res,[{message:{content:'{"blocks":['},done:false},{done:true,done_reason:'length'}]);
  if(mode==='stopped')return ndjson(res,[{message:{content:'{"blocks":['},done:false}]);
  if(mode==='missing')return res.writeHead(404,{'Content-Type':'application/json'}).end(JSON.stringify({error:'model "nope" not found, try pulling it first'}));
  if(mode==='vision')return res.writeHead(500,{'Content-Type':'application/json'}).end(JSON.stringify({error:'this model is missing data required for image input'}));
  return ndjson(res,[{error:'out of memory'}]);
 }});
 const local=client(s.url),ask=()=>local.respond('m',[{role:'user',content:'x'}],'I',undefined);
 await assert.rejects(ask(),/문맥 길이에 걸려 응답이 잘렸습니다/);
 mode='stopped';await assert.rejects(ask(),/중단/);
 mode='missing';await assert.rejects(ask(),e=>e.status===404&&/not found, try pulling/.test(e.message));
 mode='vision';await assert.rejects(local.explainFigure('m','data:image/png;base64,AAAA',{page:1},undefined),/이미지를 지원하지 않습니다/);
 mode='error';await assert.rejects(ask(),/로컬 LLM 오류: out of memory/);
 const down=client('http://127.0.0.1:9');await assert.rejects(down.models(),e=>e.status===503&&/연결할 수 없습니다\. Ollama가 실행 중인지/.test(e.message));
});

test('Ollama figure explanation sends the image as base64 without the data URL prefix',async t=>{
 const s=await server(t,{'POST /api/chat':(_b,res)=>ndjson(res,[{message:{content:'가로축은 시간입니다.'},done:true,done_reason:'stop'}])});
 assert.equal(await client(s.url).explainFigure('gemma3:12b','data:image/png;base64,QUJD',{page:2,caption:'Fig. 1'},undefined),'가로축은 시간입니다.');
 const message=s.requests.at(-1).body.messages[1];assert.deepEqual(message.images,['QUJD']);assert.deepEqual(JSON.parse(message.content),{page:2,caption:'Fig. 1'});
});

test('OpenAI-compatible servers: model list, streamed chat, image parts and a cut reply',async t=>{
 let cut=false;const reply='{"blocks":[{"id":"a","text":"가"}]}';
 const s=await server(t,{
  'GET /v1/models':(_b,res)=>res.end(JSON.stringify({data:[{id:'qwen2.5-7b-instruct'},{id:'text-embedding-nomic-embed-text-v1.5'}]})),
  'POST /v1/chat/completions':(_b,res)=>sse(res,cut?[{choices:[{delta:{content:'{"bl'}}]},{choices:[{delta:{},finish_reason:'length'}]},'[DONE]']:[...pieces(reply).map(c=>({choices:[{delta:{content:c}}]})),{choices:[{delta:{},finish_reason:'stop'}]},'[DONE]'])
 });
 const local=client(s.url+'/v1',{kind:'openai'});
 assert.deepEqual(await local.models(),[{id:'qwen2.5-7b-instruct',name:'qwen2.5-7b-instruct'}]);
 assert.deepEqual(await local.translate('qwen2.5-7b-instruct',[{id:'a',text:'A'}],undefined,{}),[{id:'a',text:'가'}]);
 const sent=s.requests.at(-1).body;assert.equal(sent.stream,true);assert.equal(sent.messages[0].role,'system');assert.equal(sent.options,undefined);assert.equal(sent.response_format,undefined);
 await local.explainFigure('m','data:image/png;base64,QUJD',{page:1},undefined);
 assert.deepEqual(s.requests.at(-1).body.messages[1].content[1],{type:'image_url',image_url:{url:'data:image/png;base64,QUJD'}});
 cut=true;await assert.rejects(local.respond('m',[{role:'user',content:'x'}],'I',undefined),/문맥 길이/);
 assert.equal((await local.check()).models,1);
});

test('a translation job on a local server runs one request at a time and records the local connection',async t=>{
 let active=0,most=0;
 const s=await server(t,{'POST /api/chat':async(body,res)=>{
  active++;most=Math.max(most,active);await new Promise(r=>setTimeout(r,15));
  const blocks=JSON.parse(body.messages[1].content).blocks;active--;
  ndjson(res,[{message:{content:JSON.stringify({blocks:blocks.map(b=>({id:b.id,text:'로컬 번역'}))})},done:true,done_reason:'stop'}]);
 },'GET /api/tags':(_b,res)=>res.end(JSON.stringify({models:[{name:'qwen2.5:14b'}]}))});
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),`${appName.id}-local-`));t.after(()=>fs.rm(dir,{recursive:true,force:true}));await fs.mkdir(path.join(dir,'vault'));
 const pdf=path.join(dir,'test.pdf');await fs.writeFile(pdf,'%PDF-1.4\nfixture');const library=await Library.open(path.join(dir,'vault'));await library.importFiles([pdf]);
 const paperId=library.data.papers[0].id,hash=(await source(library,paperId)).hash,local=client(s.url);
 const pageAt=n=>({width:600,height:800,blocks:[{id:`p${n}-b0`,text:`Page ${n} research.`,x:20,y:20,width:200,height:40,fontSize:12}]});
 const jobs=new TranslationJobs(id=>id==='local'?local:null);
 const job=await jobs.start(library,paperId,hash,[pageAt(1),pageAt(2),pageAt(3)],'qwen2.5:14b',{connection:'local'});
 for(let i=0;i<300&&jobs.jobs.get(job.id).state==='running';i++)await new Promise(r=>setTimeout(r,10));
 assert.equal(jobs.result(job.id).state,'completed');assert.equal(most,1);
 const record=await jobs.cached(library,paperId);assert.equal(record.connection,'local');assert.equal(record.pages[2].blocks[0].translation,'로컬 번역');
});
