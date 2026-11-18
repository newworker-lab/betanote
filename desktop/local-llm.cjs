// A model server on this computer (or one the user chose): Ollama's own API
// by default, or any OpenAI-compatible server (LM Studio, llama.cpp, ...).
// Ollama is sent the context length with every request; its default (4096
// tokens) is shorter than one translation request and would silently cut
// the instructions. An OpenAI-compatible server keeps its own setting.
const {figureInstructions,translateBlocks,streamLines}=require('./llm.cjs');
const {tr}=require('../core/i18n.js');

const DEFAULT_URLS={ollama:'http://127.0.0.1:11434',openai:'http://127.0.0.1:1234/v1'};
const MIN_CONTEXT=8192,MAX_CONTEXT=131072,DEFAULT_CONTEXT=16384;
const RESPONSE_LIMIT=2e6;

function isLoopback(url){const host=new URL(url).hostname.replace(/^\[|\]$/g,'').toLowerCase();return host==='localhost'||host==='::1'||/^127(?:\.\d{1,3}){3}$/.test(host);}
// Settings as stored in settings.json (llm.local). Throws on an address that
// is not a plain http(s) URL; the context length is kept within range.
function normalizeLocal(raw={}){
  const kind=raw?.kind==='openai'?'openai':'ollama';
  const text=typeof raw?.url==='string'&&raw.url.trim()?raw.url.trim():DEFAULT_URLS[kind];
  let parsed;try{parsed=new URL(text);}catch{throw Error(tr('로컬 LLM 서버 주소를 확인하세요. 예: {url}',{url:DEFAULT_URLS[kind]}));}
  if(!['http:','https:'].includes(parsed.protocol)||parsed.username||parsed.password||parsed.search||parsed.hash)throw Error(tr('로컬 LLM 서버 주소는 http:// 또는 https://로 시작하는 주소만 쓸 수 있습니다.'));
  const url=parsed.href.replace(/\/+$/,''),numCtx=Number.isInteger(raw?.numCtx)?Math.min(MAX_CONTEXT,Math.max(MIN_CONTEXT,raw.numCtx)):DEFAULT_CONTEXT;
  return {enabled:raw?.enabled===true,kind,url,numCtx,think:raw?.think===true,remoteConfirmed:raw?.remoteConfirmed===true&&!isLoopback(url)};
}
// A reasoning model may put its thinking first in <think> tags; only the answer counts.
const answer=text=>text.replace(/^\s*<think>[\s\S]*?(?:<\/think>\s*|$)/,'');

class LocalLLM {
  // Read each time it is shown: the screen language can change while the app runs.
  get label(){return tr('로컬 모델');}
  constructor({fetch,settings}={}){
    Object.assign(this,{fetch,id:'local',kind:'local',concurrency:1,requestTimeout:600000});
    this.capabilityCache=new Map();this.configure(settings);
  }
  configure(settings){
    let next;try{next=normalizeLocal(settings);}catch{next=normalizeLocal({enabled:false});}
    if(next.url!==this.settings?.url||next.kind!==this.settings?.kind)this.capabilityCache.clear();
    this.settings=next;
    // Characters of paper text for AI help: the context less room for the instructions and the answer.
    this.inputBudget=Math.max(8000,(next.numCtx-5120)*3);
    return this.status();
  }
  status(){
    const {enabled,kind,url,numCtx,think,remoteConfirmed}=this.settings,remote=!isLoopback(url);
    return {usable:enabled&&(!remote||remoteConfirmed),enabled,kind,url,numCtx,think,remote,remoteConfirmed,inputBudget:this.inputBudget};
  }
  serverName(){return this.settings.kind==='ollama'?'Ollama':tr('서버',null,'local llm');}
  async request(path,init={},timeout=this.requestTimeout){
    const signal=init.signal?AbortSignal.any([init.signal,AbortSignal.timeout(timeout)]):AbortSignal.timeout(timeout);
    let response;
    try{response=await this.fetch(this.settings.url+path,{...init,redirect:'error',signal});}
    catch(error){
      if(init.signal?.aborted)throw error;
      if(error?.name==='TimeoutError')throw Object.assign(Error(tr('로컬 LLM 서버({url})가 응답하지 않습니다. 모델이 너무 크거나 느리면 더 작은 모델을 선택하세요.',{url:this.settings.url})),{name:'TimeoutError'});
      throw Object.assign(Error(tr('로컬 LLM 서버({url})에 연결할 수 없습니다. {server}가 실행 중인지 확인하세요.',{url:this.settings.url,server:this.serverName()})),{status:503});
    }
    if(!response.ok){
      let message='';try{const body=await response.json();message=typeof body?.error==='string'?body.error:String(body?.error?.message||'');}catch{}
      if(/image|vision/i.test(message))throw Object.assign(Error(tr('이 모델은 이미지를 지원하지 않습니다. 비전 모델을 선택하세요.')),{status:response.status});
      throw Object.assign(Error(tr('로컬 LLM 서버 오류 ({detail})',{detail:`${response.status}${message?': '+message.slice(0,200):''}`})),{status:response.status});
    }
    return response;
  }
  async json(path,init,timeout){try{return await (await this.request(path,init,timeout)).json();}catch(error){if(error instanceof SyntaxError)throw Error(tr('로컬 LLM 서버 응답 형식이 잘못됐습니다. 서버 종류와 주소를 확인하세요.'));throw error;}}
  // Ollama reports what each model can do; embedding-only models are left out
  // and image support is shown. Unknown (an older Ollama) counts as text.
  async capabilities(model){
    const key=model.digest||model.name;if(this.capabilityCache.has(key))return this.capabilityCache.get(key);
    try{const data=await this.json('/api/show',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model:model.name})},5000);const value=Array.isArray(data?.capabilities)?data.capabilities:null;this.capabilityCache.set(key,value);return value;}
    catch{return null;}
  }
  async models(){
    if(this.settings.kind==='openai'){
      const data=await this.json('/models',{},5000);
      return (Array.isArray(data?.data)?data.data:[]).filter(m=>typeof m?.id==='string'&&!/embed/i.test(m.id)).map(m=>({id:m.id,name:m.id}));
    }
    const data=await this.json('/api/tags',{},5000),list=(Array.isArray(data?.models)?data.models:[]).filter(m=>typeof m?.name==='string');
    const capabilities=await Promise.all(list.map(m=>this.capabilities(m)));
    return list.flatMap((m,i)=>{
      const caps=capabilities[i];if(caps&&!caps.includes('completion'))return [];
      const extra=[m.details?.parameter_size,m.details?.quantization_level].filter(v=>typeof v==='string'&&v).join(' ');
      return [{id:m.name,name:extra?`${m.name} (${extra})`:m.name,...(caps?{vision:caps.includes('vision')}:{})}];
    });
  }
  async check(){
    const version=this.settings.kind==='ollama'?(await this.json('/api/version',{},5000))?.version||'':'';
    return {...this.status(),version:String(version).slice(0,40),models:(await this.models()).length};
  }
  translate(model,blocks,signal,context={},onUnit){return translateBlocks(this,model,blocks,signal,context,onUnit);}
  imageMessage(text,images){return this.settings.kind==='ollama'?{role:'user',content:text,images:images.map(url=>String(url).replace(/^data:image\/png;base64,/,''))}:{role:'user',content:[{type:'text',text},...images.map(url=>({type:'image_url',image_url:{url}}))]};}
  explainFigure(model,image,context,signal,language){
    const base64=String(image).replace(/^data:image\/png;base64,/,'');
    const content=this.settings.kind==='ollama'?{content:JSON.stringify(context),images:[base64]}:{content:[{type:'text',text:JSON.stringify(context)},{type:'image_url',image_url:{url:image}}]};
    return this.respond(model,[{role:'user',...content}],figureInstructions(language),signal);
  }
  async respond(model,messages,instructions,signal,onDelta,options={}){
    const ollama=this.settings.kind==='ollama',all=[{role:'system',content:instructions},...messages];
    // A thinking model (Qwen3 and the like) thinks first only when the user turned reasoning on:
    // on a slow PC its thinking alone can outlast the request time limit. Only models that
    // report thinking get the flag.
    const think=ollama&&(await this.capabilities({name:model}))?.includes('thinking')?{think:this.settings.think}:{};
    const body=ollama?{model,messages:all,stream:true,...think,options:{num_ctx:this.settings.numCtx},...(options.json?{format:'json'}:{})}:{model,messages:all,stream:true};
    const response=await this.request(ollama?'/api/chat':'/chat/completions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal});
    let output='',done=false,reason='';
    const add=text=>{if(!text)return;output+=text;if(output.length>RESPONSE_LIMIT)throw Error(tr('번역 응답이 허용 크기를 초과했습니다.'));onDelta?.(answer(output));};
    const parse=data=>{try{return JSON.parse(data);}catch{throw Object.assign(Error(tr('로컬 LLM 응답 스트림이 손상됐습니다. 다시 시도합니다.')),{status:502});}};
    // Ollama streams one JSON object a line; OpenAI-compatible servers stream server-sent events.
    const line=raw=>{
      let data=raw.trim();
      if(!ollama){if(!data.startsWith('data:'))return;data=data.slice(5).trim();if(data==='[DONE]'){done=true;return;}}
      if(!data)return;
      const event=parse(data);
      if(event.error)throw Error(tr('로컬 LLM 오류: {detail}',{detail:String(event.error?.message||event.error).slice(0,200)}));
      if(ollama){add(event.message?.content);if(event.done){done=true;reason=event.done_reason||'';}}
      else{const choice=event.choices?.[0];add(choice?.delta?.content);if(choice?.finish_reason){reason=choice.finish_reason;if(reason!=='length')done=true;}}
    };
    await streamLines(response,line,RESPONSE_LIMIT);
    if(reason==='length')throw Error(tr('문맥 길이에 걸려 응답이 잘렸습니다. 설정에서 문맥 길이를 늘리거나 더 작은 범위로 요청하세요.'));
    if(!done)throw Error(tr('번역 응답이 중단됐습니다. 완료된 번역으로 저장하지 않았습니다.'));
    const text=answer(output);
    if(!text.trim())throw Error(tr('모델이 설명이나 번역 텍스트를 반환하지 않았습니다. 다른 모델을 선택하세요.'));
    return text;
  }
  cancel(){}
  disconnect(){return this.configure({...this.settings,enabled:false});}
}
module.exports={LocalLLM,normalizeLocal,isLoopback,DEFAULT_URLS,answer};
