const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const {ChatGPT}=require('../desktop/chatgpt.cjs');
const appName = require('../core/app-name.cjs');
const issuer='https://auth.openai.com';
async function fixture(t,options={}){
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),`${appName.id}-auth-`));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
 const jose=await import('jose'),{privateKey,publicKey}=await jose.generateKeyPair('RS256'),jwk=await jose.exportJWK(publicKey);jwk.kid='test';
 let authUrl,exchanged=false;const requests=[];
 const auth=new ChatGPT({directory,persistent:()=>true,protect:s=>Buffer.from(s).reverse(),unprotect:b=>Buffer.from(b).reverse().toString(),timeout:2000,
 fetch:async(url,init={})=>{
  requests.push({url,init});
  if(url.endsWith('openid-configuration'))return Response.json({issuer,authorization_endpoint:issuer+'/api/accounts/authorize',token_endpoint:issuer+'/api/accounts/oauth/token',jwks_uri:issuer+'/.well-known/jwks.json',revocation_endpoint:issuer+'/oauth/revoke'});
  if(url.endsWith('jwks.json'))return Response.json({keys:[jwk]});
  if(url.endsWith('/oauth/token')){
   const params=init.body;assert.equal(params.get('client_id'),'oaiapp_fixture');assert.equal(params.get('resource'),'https://api.openai.com/v1');
   if(params.get('grant_type')==='refresh_token')return Response.json({access_token:'fixture-refreshed',refresh_token:'fixture-rotated',token_type:'Bearer',expires_in:3600});
   exchanged=true;assert.equal(crypto.createHash('sha256').update(params.get('code_verifier')).digest('base64url'),authUrl.searchParams.get('code_challenge'));assert.equal(params.get('redirect_uri'),authUrl.searchParams.get('redirect_uri'));
   const id=await new jose.SignJWT({email:'fixture@example.test',nonce:options.wrongNonce?'wrong':authUrl.searchParams.get('nonce')}).setProtectedHeader({alg:'RS256',kid:'test'}).setIssuer(issuer).setAudience('oaiapp_fixture').setSubject('fixture-user').setIssuedAt().setExpirationTime('5m').sign(privateKey);
   return Response.json({id_token:id,access_token:'fixture-access',refresh_token:'fixture-refresh',token_type:'Bearer',scope:options.noPermission?'openid email':'openid email resource.invoke chatgpt.tokens.use.direct',expires_in:3600});
  }
  if(url.endsWith('/models'))return Response.json({models:[{slug:'fixture-model',display_name:'Fixture',visibility:'list'},{slug:'hidden',visibility:'hidden'}]});
  if(url.endsWith('/oauth/revoke'))return new Response(null,{status:200});
  throw Error('unexpected URL');
 },openBrowser:async url=>{
   authUrl=new URL(url);assert.equal(authUrl.searchParams.get('client_id'),'dynamic_agent_client');assert.equal(authUrl.searchParams.get('agent_name_hint'),appName.name);
   const callback=new URL(authUrl.searchParams.get('redirect_uri'));
   callback.searchParams.set('state','incorrect');const wrong=await fetch(callback);assert.equal(wrong.status,400);
   callback.searchParams.set('state',authUrl.searchParams.get('state'));callback.searchParams.set('client_id','oaiapp_fixture');callback.searchParams.set('code','fixture-code');
   await fetch(callback);
 }});
 await auth.init();return {auth,directory,requests,exchanged:()=>exchanged};
}
test('official registration uses PKCE, rejects wrong state, validates signed ID and protects tokens',async t=>{
 const f=await fixture(t);const status=await f.auth.signIn();assert.equal(status.usable,true);assert.equal(f.exchanged(),true);assert.equal(status.email,'fixture@example.test');
 assert.deepEqual(await f.auth.models(),[{id:'fixture-model',name:'Fixture'}]);
 const saved=await fs.readFile(path.join(f.directory,'chatgpt-session.json'),'utf8');assert.ok(!saved.includes('fixture-access'));
 f.auth.profile.expires_at=0;assert.equal(await f.auth.access(),'fixture-refreshed');assert.equal(f.auth.profile.refresh_token,'fixture-rotated');
 assert.equal((await f.auth.disconnect()).revoked,true);assert.equal(f.auth.status().connected,false);
});
test('incorrect nonce cannot replace the active profile',async t=>{const f=await fixture(t,{wrongNonce:true});await assert.rejects(f.auth.signIn(),/검증/);assert.equal(f.auth.status().connected,false)});
test('identity-only grant is not marked usable',async t=>{const f=await fixture(t,{noPermission:true});assert.equal((await f.auth.signIn()).usable,false);await assert.rejects(f.auth.access(),/권한/)});
test('SSE output requires terminal success and exactly one translation per input block',async t=>{
 const f=await fixture(t);await f.auth.signIn();
 const events=[{type:'response.output_text.delta',delta:JSON.stringify({blocks:[{id:'p1',text:'연구 논문'}]})},{type:'response.completed'}];
 f.auth.fetch=async(url,init)=>{const body=JSON.parse(init.body);assert.equal(body.store,false);assert.equal(body.stream,true);assert.equal(url,'https://api.openai.com/v1/responses');const wire=events.map(e=>'data: '+JSON.stringify(e)+'\r\n\r\n').join('');return new Response(new ReadableStream({start(c){const bytes=new TextEncoder().encode(wire);for(let i=0;i<bytes.length;i+=13)c.enqueue(bytes.slice(i,i+13));c.close();}}));};
 assert.deepEqual(await f.auth.translate('fixture-model',[{id:'p1',text:'Research'}]),[{id:'p1',text:'연구 논문'}]);
 events.pop();await assert.rejects(f.auth.translate('fixture-model',[{id:'p1',text:'Research'}]),/중단/);
 events.push({type:'response.failed',response:{error:{code:'subscription_sharing_usage_limit_exceeded'}}});await assert.rejects(f.auth.translate('fixture-model',[{id:'p1',text:'Research'}]),/한도/);
});
test('cancel closes a pending loopback sign-in without changing credentials',async t=>{const f=await fixture(t);let opened;f.auth.openBrowser=async url=>{opened=url};const pending=f.auth.signIn();for(let i=0;i<100&&!opened;i++)await new Promise(r=>setTimeout(r,5));f.auth.cancel();await assert.rejects(pending,/취소/);assert.equal(f.auth.status().connected,false)});

test('figure explanation sends a selected image and context through authenticated responses',async t=>{
 const f=await fixture(t);await f.auth.signIn();
 f.auth.fetch=async(url,init)=>{const body=JSON.parse(init.body);assert.equal(body.store,false);assert.equal(init.headers.Authorization,'Bearer fixture-access');assert.equal(body.input[0].content[1].type,'input_image');assert.equal(body.input[0].content[1].image_url,'data:image/png;base64,aGVsbG8=');assert.match(body.input[0].content[0].text,/caption/);return new Response([{type:'response.output_text.delta',delta:'가로축은 시간입니다.'},{type:'response.completed'}].map(e=>'data: '+JSON.stringify(e)+'\n\n').join(''));};
 assert.equal(await f.auth.explainFigure('fixture-model','data:image/png;base64,aGVsbG8=',{caption:'Time',page:1},new AbortController().signal),'가로축은 시간입니다.');
 const plain=f.auth.fetch,asked=[];f.auth.fetch=async(url,init)=>{asked.push(JSON.parse(init.body).instructions);return plain(url,init);};
 await f.auth.explainFigure('fixture-model','data:image/png;base64,aGVsbG8=',{caption:'Time',page:1},new AbortController().signal,'es');assert.match(asked[0],/^Explain the selected research figure in Spanish\./);
});
test('translate hands out each completed block while the response streams',async()=>{
 const {ChatGPT}=require('../desktop/chatgpt.cjs');const client=Object.create(ChatGPT.prototype),seen=[];
 const full=JSON.stringify({blocks:[{id:'a:s0',text:'첫 "인용" 문단\n번역'},{id:'b:s0',text:'둘째 문단'}]});
 client.respond=async(_m,_i,_x,_s,onDelta)=>{for(let i=7;i<=full.length;i+=7)onDelta(full.slice(0,i));onDelta(full);return full;};
 const result=await client.translate('m',[{id:'a:s0',text:'A'},{id:'b:s0',text:'B'}],undefined,{},(id,text)=>seen.push([id,text]));
 assert.deepEqual(seen,[['a:s0','첫 "인용" 문단\n번역'],['b:s0','둘째 문단']]);assert.equal(result.length,2);
});

test('model discovery coalesces requests, refreshes behind a stale list and isolates tokens',async()=>{
 const auth=Object.create(ChatGPT.prototype);let token='first',calls=0,fail=false;
 auth.access=async()=>token;
 auth.json=async()=>{calls++;await new Promise(resolve=>setTimeout(resolve,5));if(fail)throw Error('offline');return {models:[{slug:token,visibility:'list'}]};};
 const [a,b]=await Promise.all([auth.models(),auth.models()]);assert.equal(calls,1);a[0].id='changed';assert.equal(b[0].id,'first');
 await auth.models();assert.equal(calls,1);
 // Past a minute the list still answers at once while a fresh copy is fetched behind it.
 auth.modelList.expires=0;let answered=false;const stale=auth.models().then(()=>answered=true);await new Promise(r=>setImmediate(r));assert.ok(answered);assert.equal(calls,2);await stale;await auth.modelRequest?.promise;
 await auth.models();assert.equal(calls,2);
 // Past an hour it is fetched again before answering.
 auth.modelList.expires=0;auth.modelList.stale=0;await auth.models();assert.equal(calls,3);
 token='second';assert.equal((await auth.models())[0].id,'second');assert.equal(calls,4);
 token='third';fail=true;await assert.rejects(auth.models(),/offline/);fail=false;await auth.models();assert.equal(calls,6);
});

// The renderer's model-list helpers and translation preparation, run with stubs.
const i18n=require('../core/i18n.js'); // the page's tr() and the screen language (Korean here)
const preparationCode=source=>source.slice(source.indexOf('// One model list for every connection'),source.indexOf('let translationOptions={},progressRecord=null;'))+source.slice(source.indexOf('let preparingTranslation=false;'),source.indexOf('async function startGPTTranslation()'));
const gptConnection={id:'gpt-web',label:'ChatGPT',kind:'web',usable:true,connected:true,email:''};
test('translation preparation displays immediately, loads models/PDF together, starts reading the paper and respects cancellation',async()=>{
 const vm=require('node:vm');
 const source=await fs.readFile(path.join(__dirname,'../desktop/renderer.js'),'utf8');
 const code=preparationCode(source);
 let releaseModels,releasePdf,modelsStarted=false,pdfStarted=false,shown=0,structuring=null;
 const marker={isConnected:true},dialog={open:false,close(){this.open=false;}};
 const context={dialog,document:{querySelector:()=>marker,querySelectorAll:()=>[]},tr:i18n.tr,appI18n:i18n,targetKey:()=> 'paper',translationRecord:null,currentJob:null,startingTranslation:false,state:{storageKey:'vault',selected:1,selectedAttachment:'file'},
 modal(){shown++;dialog.open=true;},btn:()=>'',esc:x=>x,desktopPreferences:{},preferredGPTModel:()=>'m',window:{appApi:{cachedTranslation:async()=>null,resumableTranslation:async()=>null,llmConnections:async()=>[gptConnection]}},
 gptModels:[],knownGPTModels:()=>[],loadGPTModels:()=>{modelsStarted=true;return new Promise(r=>releaseModels=r).then(()=>{context.gptModels=[{id:'m',name:'M'}];});},pdfEngine:async()=>({documentFor:()=>{pdfStarted=true;return new Promise(r=>releasePdf=r);},structuredPages:(pdf,hash)=>{structuring=[pdf,hash];return new Promise(()=>{});}})};
 vm.createContext(context);vm.runInContext(code,context);
 const pending=context.ensureTranslation();assert.equal(shown,1);
 await new Promise(r=>setImmediate(r));assert.ok(modelsStarted&&pdfStarted);
 await context.ensureTranslation();assert.equal(shown,1);
 // The paper starts being read while the model list is still on its way.
 const pdf={numPages:1};releasePdf({pdf,hash:'h'});await new Promise(r=>setImmediate(r));assert.deepEqual(structuring,[pdf,'h']);
 dialog.close();releaseModels();await pending;
 assert.equal(shown,1);assert.equal(dialog.open,false);
});


test('translation preparation opens the model dialog with the list last seen and applies the fresh one when it comes',async()=>{
 const vm=require('node:vm');
 const source=await fs.readFile(path.join(__dirname,'../desktop/renderer.js'),'utf8');
 const code=preparationCode(source);
 let releaseModels;const html=[];
 const marker={isConnected:true},dialog={open:false,close(){this.open=false;}};
 const context={dialog,document:{querySelector:()=>marker,querySelectorAll:()=>[]},tr:i18n.tr,appI18n:i18n,targetKey:()=> 'paper',translationRecord:null,currentJob:null,startingTranslation:false,state:{storageKey:'vault',selected:1,selectedAttachment:'file'},
 modal(_title,body){html.push(body);dialog.open=true;},btn:()=>'',esc:x=>x,desktopPreferences:{},preferredGPTModel:()=>'old-model',translationPages:new Map(),
 window:{appApi:{cachedTranslation:async()=>null,resumableTranslation:async()=>null,llmConnections:async()=>[gptConnection]}},
 gptModels:[],knownGPTModels:()=>[{id:'old-model',name:'Old'}],loadGPTModels:()=>new Promise(r=>releaseModels=r).then(()=>{context.gptModels=[{id:'new-model',name:'New'}];}),
 pdfEngine:async()=>({documentFor:async()=>({pdf:{numPages:3},hash:'h'}),structuredPages:()=>new Promise(()=>{})})};
 vm.createContext(context);vm.runInContext(code,context);
 await context.ensureTranslation();
 assert.equal(html.length,2);assert.match(html[1],/id="gpt-model"[\s\S]*value="old-model" data-connection="gpt-web" selected/,'the dialog did not wait for the network');assert.equal(marker.innerHTML,undefined);
 releaseModels();await new Promise(r=>setImmediate(r));assert.match(marker.innerHTML,/value="new-model" data-connection="gpt-web"/,'the fresh list replaces the choices');
});

test('model JSON wrappers are accepted without accepting commentary or invalid blocks',async()=>{
 const auth=Object.create(ChatGPT.prototype),blocks=[{id:'a',text:'Research'}];
 const payload=JSON.stringify({blocks:[{id:'a',text:'연구'}]});
 for(const value of [payload,'```json\n'+payload+'\n```','```\n'+payload+'\n```']){
  auth.respond=async()=>value;assert.deepEqual(await auth.translate('model',blocks),[{id:'a',text:'연구'}]);
 }
 for(const value of ['null','{"blocks":[null]}','Answer: '+payload,payload+' extra','{"blocks":[{"id":"wrong","text":"연구"}]}']){
  auth.respond=async()=>value;await assert.rejects(auth.translate('model',blocks),/번역 결과/);
 }
});

test('the saved session goes through a secure storage that answers later, and is written again when its key has changed',async t=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),`${appName.id}-session-`));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
 const later=value=>new Promise(resolve=>setTimeout(()=>resolve(value),1)),profile={access_token:'access-token-value',refresh_token:'refresh-token-value',email:'reader@example.org',scope:'openid'};
 const base={directory,fetch:async()=>{throw Error('no network');},openBrowser:()=>{},persistent:()=>true};
 const first=new ChatGPT({...base,protect:s=>later(Buffer.from(s).reverse()),unprotect:b=>later({result:Buffer.from(b).reverse().toString(),shouldReEncrypt:false})});
 await first.init();await first.save(profile);
 const file=path.join(directory,(await fs.readdir(directory)).find(name=>name!==path.basename(first.hostFile))),written=await fs.readFile(file,'utf8');
 assert.ok(!written.includes('access-token-value')&&!written.includes('reader@example.org'));
 // What a storage that answers at once wrote before is still read.
 const sync=new ChatGPT({...base,protect:s=>Buffer.from(s).reverse(),unprotect:b=>Buffer.from(b).reverse().toString()});await sync.init();assert.equal(sync.profile.refresh_token,'refresh-token-value');
 assert.equal(await fs.readFile(file,'utf8'),written);
 const rotated=new ChatGPT({...base,protect:s=>later(Buffer.concat([Buffer.from('N'),Buffer.from(s).reverse()])),unprotect:b=>later(b[0]===78?{result:Buffer.from(b.subarray(1)).reverse().toString(),shouldReEncrypt:false}:{result:Buffer.from(b).reverse().toString(),shouldReEncrypt:true})});
 await rotated.init();assert.equal(rotated.profile.access_token,'access-token-value');assert.notEqual(rotated.restoreFailed,true);
 assert.equal(Buffer.from(JSON.parse(await fs.readFile(file,'utf8')).ciphertext,'base64')[0],78);
 assert.equal(rotated.status().restoreFailed,false);
 // A connection the secure storage can no longer read (its key changed, as on Linux when the app's name changed): the
 // status asks to connect again; the file is left as it is.
 const lost=new ChatGPT({...base,protect:s=>later(Buffer.from(s)),unprotect:async()=>{throw Error('Error while decrypting the ciphertext provided to safeStorage.decryptString.');}}),kept=await fs.readFile(file,'utf8');
 const status=await lost.init();assert.deepEqual([status.connected,status.restoreFailed],[false,true]);assert.equal(await fs.readFile(file,'utf8'),kept);
 // Disconnected, nothing is left to connect again.
 await lost.disconnect();assert.equal(lost.status().restoreFailed,false);
});
