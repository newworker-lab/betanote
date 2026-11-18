const {figureInstructions,translateBlocks}=require('./llm.cjs');
const {tr}=require('../core/i18n.js');
const crypto = require('node:crypto');
const http = require('node:http');
const fs = require('node:fs/promises');
const { atomicJson, readJson } = require('./storage.cjs');
const ISSUER = 'https://auth.openai.com';
const RESOURCE = 'https://api.openai.com/v1';
const SCOPES = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
const random = () => crypto.randomBytes(32).toString('base64url');
function oauthError(status, code) {
  const messages = {
    access_denied: tr('ChatGPT 연결을 취소했거나 사용 권한을 허용하지 않았습니다.'),
    invalid_grant: tr('ChatGPT 인증이 만료됐습니다. 다시 연결하세요.'),
    subscription_sharing_usage_limit_exceeded: tr('ChatGPT 사용량 한도에 도달했습니다. 한도를 확인한 뒤 다시 시도하세요.'),
    subscription_sharing_usage_unavailable: tr('이 계정에서 ChatGPT 앱 사용량을 이용할 수 없습니다.'),
    subscription_sharing_invalid_user: tr('ChatGPT 계정 연결이 해제됐습니다. 다시 연결하세요.')
  };
  return Object.assign(Error(messages[code] || tr('ChatGPT 요청에 실패했습니다 ({detail}).',{detail:`${status}${/^[a-z_]{1,90}$/.test(code || '') ? ', ' + code : ''}`})),{status:code === 'subscription_sharing_usage_limit_exceeded' ? 429 : status,code});
}
class ChatGPT {
  constructor({ directory, fetch, openBrowser, protect, unprotect, persistent = () => true, timeout = 180000, notices = null }) {
    this.notices = notices;
    Object.assign(this, { directory, fetch, openBrowser, protect, unprotect, persistent, timeout, id: 'gpt-web', label: 'ChatGPT', kind: 'web' });
    this.profileFile = require('node:path').join(directory, 'chatgpt-session.json');
    this.hostFile = require('node:path').join(directory, 'chatgpt-host.json');
  }
  async init() {
    // A host or session file that cannot be read is set aside (settings-file.cjs); the session then asks to connect again.
    const { readSettingsFile } = require('./settings-file.cjs');
    const savedHost = await readSettingsFile(this.hostFile, null, this.notices, 'chatgpt');
    this.host = savedHost?.id || 'urn:uuid:' + crypto.randomUUID();
    if (!savedHost) await atomicJson(this.hostFile, { id: this.host });
    if (this.persistent()) {
      const saved = await readSettingsFile(this.profileFile, null, this.notices, 'chatgpt');
      // protect and unprotect may answer later (the OS secure storage does). unprotect gives the text,
      // or { result, shouldReEncrypt } when the storage's key changed: the profile is then written again.
      if (saved?.ciphertext) { try { const plain = await this.unprotect(Buffer.from(saved.ciphertext, 'base64')), stale = typeof plain === 'object' && plain?.shouldReEncrypt === true; this.profile = JSON.parse(typeof plain === 'string' ? plain : plain.result); if (stale) await this.save(this.profile).catch(() => {}); } catch { this.restoreFailed = true; } }
    }
    return this.status();
  }
  status() {
    const scopes = this.profile?.scopes || [];
    return { connected: Boolean(this.profile?.access_token), usable: Boolean(this.profile?.access_token && scopes.includes('chatgpt.tokens.use.direct') && scopes.includes('resource.invoke')), email: this.profile?.email || '', persistent: this.persistent(), connecting: Boolean(this.pending), restoreFailed: !this.profile?.access_token && Boolean(this.restoreFailed) };
  }
  async metadata() {
    if (this.discovery) return this.discovery;
    const d = await this.json(ISSUER + '/.well-known/openid-configuration');
    if (d.issuer !== ISSUER) throw Error(tr('ChatGPT 인증 발급자를 확인할 수 없습니다.'));
    for (const key of ['authorization_endpoint', 'token_endpoint', 'jwks_uri', 'revocation_endpoint']) {
      if (!d[key] && key === 'revocation_endpoint') continue;
      const url = new URL(d[key]); if (url.origin !== ISSUER) throw Error(tr('ChatGPT 인증 주소를 확인할 수 없습니다.'));
    }
    this.discovery = d; return d;
  }
  async json(url, options = {}) {
    const response = await this.fetch(url, { ...options, redirect: 'error', signal: options.signal || AbortSignal.timeout(30000) });
    if (!response.ok) { let code; try { const data = await response.json(); code = typeof data.error === 'string' ? data.error : data.error?.code; } catch {} const error=oauthError(response.status, code);const retry=Number(response.headers.get('retry-after'));if(Number.isFinite(retry)&&retry>0)error.retryAfterMs=Math.min(10000,retry*1000);throw error; }
    return response.json();
  }
  async verify(idToken, clientId, nonce) {
    const jose = await import('jose');
    const d = await this.metadata();
    // Fetch via Electron net so system proxy/CA handling matches every OAuth request.
    const jwks = jose.createLocalJWKSet(await this.json(d.jwks_uri));
    const { payload } = await jose.jwtVerify(idToken, jwks, { issuer: ISSUER, audience: clientId, algorithms: ['RS256'], requiredClaims: ['sub', 'exp', 'iat'], clockTolerance: 5 });
    if (!payload.sub || (nonce && payload.nonce !== nonce)) throw Error(tr('ChatGPT 인증 응답을 검증하지 못했습니다.'));
    return payload;
  }
  async save(profile) {
    if (this.persistent()) await atomicJson(this.profileFile, { ciphertext: Buffer.from(await this.protect(JSON.stringify(profile))).toString('base64') });
    this.profile = profile; this.restoreFailed = false;
  }
  async signIn() {
    if (this.pending || this.starting) throw Error(tr('이미 ChatGPT 인증을 진행 중입니다.'));
    this.starting=true;this.cancelledStart=false;
    let d;
    try { d=await this.metadata(); if(this.cancelledStart)throw Error(tr('ChatGPT 인증을 취소했습니다.')); }
    finally { this.starting=false; }
    const previous = this.profile;
    const registration = previous?.client_id;
    const state = random(), nonce = random(), verifier = random();
    let timeout, server, finished = false;
    return new Promise((resolve, reject) => {
      const finish = (error, result) => { if (finished) return; finished = true; clearTimeout(timeout); this.pending = null; server?.close(); server?.closeIdleConnections(); if (error) reject(error); else resolve(result); };
      server = http.createServer(async (req, res) => {
        res.setHeader('Cache-Control', 'no-store'); res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        const callback = new URL(req.url, 'http://127.0.0.1');
        if (req.method !== 'GET' || callback.pathname !== '/auth/callback') { res.writeHead(404).end(); return; }
        if (callback.searchParams.get('state') !== state) { res.writeHead(400).end('Invalid state'); return; }
        // A late or repeated callback (after finish() cleared pending) gets an answer instead of a crash.
        if (!this.pending || this.pending.consumed) { res.writeHead(409).end(); return; }
        this.pending.consumed = true;
        try {
          if (callback.searchParams.has('error')) throw oauthError(400, callback.searchParams.get('error'));
          const clientId = callback.searchParams.get('client_id') || registration;
          if (!clientId || clientId === 'dynamic_agent_client' || (registration && clientId !== registration)) throw Error(tr('ChatGPT 앱 등록 결과를 확인할 수 없습니다.'));
          const code = callback.searchParams.get('code'); if (!code) throw Error(tr('ChatGPT 인증 코드가 없습니다.'));
          const token = await this.json(d.token_endpoint, { method: 'POST', body: new URLSearchParams({ grant_type: 'authorization_code', client_id: clientId, code, code_verifier: verifier, redirect_uri: this.pending.redirect, resource: RESOURCE }) });
          const identity = await this.verify(token.id_token, clientId, nonce);
          if (registration && previous.subject !== identity.sub) throw Error(tr('연결된 ChatGPT 계정과 인증한 계정이 다릅니다. 연결을 해제한 뒤 새 계정으로 로그인하세요.'));
          if (finished) throw Error(tr('ChatGPT 인증이 취소됐습니다.'));
          if (!token.access_token || token.token_type?.toLowerCase() !== 'bearer') throw Error(tr('ChatGPT 모델 호출 권한이 없습니다.'));
          await this.save({ client_id: clientId, subject: identity.sub, email: identity.email || '', id_token: token.id_token, access_token: token.access_token, refresh_token: token.refresh_token, scopes: String(token.scope || '').split(/\s+/), expires_at: Date.now() + Number(token.expires_in || 3600) * 1000 });
          res.end(tr('ChatGPT 연결을 완료했습니다. {app} 앱으로 돌아가세요.')); finish(null, this.status());
        } catch (error) { res.writeHead(400).end(tr('ChatGPT 연결을 완료하지 못했습니다. 앱의 안내를 확인하세요.')); finish(error); }
      });
      server.on('error', () => finish(Error(tr('ChatGPT 인증 콜백을 열지 못했습니다. 다시 시도하세요.'))));
      this.pending = { cancel: () => finish(Error(tr('ChatGPT 인증을 취소했습니다.'))), consumed: false };
      timeout = setTimeout(() => finish(Error(tr('ChatGPT 인증 대기 시간이 지났습니다. 다시 연결하세요.'))), this.timeout);
      server.listen(0, '127.0.0.1', async () => {
        if (finished) return;
        const redirect = `http://127.0.0.1:${server.address().port}/auth/callback`; this.pending.redirect = redirect;
        const url = new URL(d.authorization_endpoint);
        const params = { client_id: registration || 'dynamic_agent_client', ext_agent_host_id: this.host, response_type: 'code', redirect_uri: redirect, scope: SCOPES, resource: RESOURCE, state, nonce, code_challenge_method: 'S256', code_challenge: crypto.createHash('sha256').update(verifier).digest('base64url') };
        if (!registration) params.agent_name_hint = require('../core/app-name.cjs').name;
        else if (previous.id_token) params.id_token_hint = previous.id_token;
        Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
        try { await this.openBrowser(url.href); } catch { finish(Error(tr('시스템 브라우저에서 ChatGPT 인증 페이지를 열지 못했습니다.'))); }
      });
    });
  }
  cancel() { this.cancelledStart=true;this.pending?.cancel(); }
  async access() {
    if (!this.status().usable) throw Error(tr('먼저 ChatGPT를 연결하고 앱 사용량 권한을 허용하세요.'));
    if (this.profile.expires_at > Date.now() + 60000) return this.profile.access_token;
    if (!this.refreshing) this.refreshing = this.refresh().finally(() => { this.refreshing = null; });
    return this.refreshing;
  }
  async refresh() {
    const old = this.profile; if (!old.refresh_token) throw Error(tr('ChatGPT를 다시 연결하세요.'));
    const d = await this.metadata();
    const tokens = await this.json(d.token_endpoint, { method: 'POST', body: new URLSearchParams({ grant_type: 'refresh_token', client_id: old.client_id, refresh_token: old.refresh_token, resource: RESOURCE }) });
    if (!tokens.access_token || tokens.token_type?.toLowerCase() !== 'bearer') throw Error(tr('ChatGPT 인증을 갱신하지 못했습니다.'));
    if (tokens.id_token) { const identity = await this.verify(tokens.id_token, old.client_id); if (identity.sub !== old.subject) throw Error(tr('ChatGPT 갱신 계정이 일치하지 않습니다.')); }
    const next = { ...old, ...tokens, scopes: tokens.scope ? tokens.scope.split(/\s+/) : old.scopes, expires_at: Date.now() + Number(tokens.expires_in || 3600) * 1000 };
    if (this.profile !== old) throw Error(tr('ChatGPT 연결이 변경됐습니다.'));
    await this.save(next); if(!this.status().usable)throw Error(tr('ChatGPT 앱 사용량 권한이 해제됐습니다. 다시 연결하세요.')); return next.access_token;
  }
  async disconnect() {
    this.restoreFailed = false; // a connection that could not be read is gone with the rest
    this.modelList=null;this.modelRequest=null;
    this.cancel(); if (this.refreshing) await this.refreshing.catch(() => {});
    const old = this.profile; this.profile = null;
    let revoked = !old?.refresh_token;
    try { if (old?.refresh_token) { const d = await this.metadata(); if (d.revocation_endpoint) { const response = await this.fetch(d.revocation_endpoint, { method: 'POST', redirect: 'error', body: new URLSearchParams({ token: old.refresh_token, token_type_hint: 'refresh_token', client_id: old.client_id }), signal: AbortSignal.timeout(10000) }); revoked = response.ok; } } } catch { /* revoking is a courtesy: the local tokens are removed either way */ }
    await fs.rm(this.profileFile, { force: true }); return { ...this.status(), revoked };
  }
  // The model list is asked for before every translation and AI request; it
  // is reused per signed-in account instead of a round trip each time. After
  // a minute it is still answered at once, for up to an hour, while a fresh
  // copy is fetched behind it, so a dialog left open never makes the start wait.
  async models() {
    const token=await this.access(),now=Date.now(),list=this.modelList?.token===token?this.modelList:null;
    if(list&&list.stale>now){if(list.expires<=now)this.fetchModels(token).catch(()=>{});return list.value.map(m=>({...m}));}
    return (await this.fetchModels(token)).map(m=>({...m}));
  }
  fetchModels(token) {
    if(this.modelRequest?.token===token)return this.modelRequest.promise;
    const request={token};
    request.promise=(async()=>{
      try{
        const data=await this.json(RESOURCE+'/models',{headers:{Authorization:'Bearer '+token}});
        const value=(data.models||[]).filter(m=>m.visibility==='list'&&typeof m.slug==='string').map(m=>({id:m.slug,name:m.display_name||m.slug}));
        if(this.modelRequest===request)this.modelList={token,value,expires:Date.now()+60000,stale:Date.now()+3600000};
        return value;
      }finally{if(this.modelRequest===request)this.modelRequest=null;}
    })();
    this.modelRequest=request;return request.promise;
  }
  translate(model, blocks, signal, context = {}, onUnit) { return translateBlocks(this, model, blocks, signal, context, onUnit); }
  imageMessage(text, images) { return { role: 'user', content: [{ type: 'input_text', text }, ...images.map(url => ({ type: 'input_image', image_url: url, detail: 'auto' }))] }; }
  async explainFigure(model,image,context,signal,language){
    return this.respond(model,[{role:'user',content:[{type:'input_text',text:JSON.stringify(context)},{type:'input_image',image_url:image,detail:'high'}]}],
      figureInstructions(language),signal);
  }
  async respond(model,input,instructions,signal,onDelta){
    const token=await this.access();
    const response=await this.fetch(RESOURCE+'/responses',{method:'POST',redirect:'error',signal,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({model,store:false,stream:true,instructions,input})});
    if (!response.ok) { let code; try { code = (await response.json()).error?.code; } catch {} const error=oauthError(response.status, code);const retry=Number(response.headers.get('retry-after'));if(Number.isFinite(retry)&&retry>0)error.retryAfterMs=Math.min(10000,retry*1000);throw error; }
    let buffer = '', output = '', completed = false;
    const consume = raw => {
      for (const line of raw.split('\n')) {
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim(); if (!data || data === '[DONE]') continue;
        // A garbled event is a server-side fault: report it as retryable (5xx).
        let event; try { event = JSON.parse(data); } catch { const error = Error(tr('ChatGPT 응답 스트림이 손상됐습니다. 다시 시도합니다.')); error.status = 502; throw error; }
        if (event.type === 'response.output_text.delta') { output += event.delta || ''; onDelta?.(output); }
        if (output.length > 2e6) throw Error(tr('번역 응답이 허용 크기를 초과했습니다.'));
        if (event.type === 'response.completed') completed = true;
        if (['response.failed', 'response.incomplete', 'error'].includes(event.type)) throw oauthError(400, event.response?.error?.code || event.error?.code || event.code);
      }
    };
    for await (const chunk of response.body.pipeThrough(new TextDecoderStream())) {
      buffer = (buffer + chunk).replace(/\r\n/g, '\n'); let index;
      while ((index = buffer.indexOf('\n\n')) >= 0) { consume(buffer.slice(0, index)); buffer = buffer.slice(index + 2); }
      if (buffer.length > 2e6) throw Error(tr('번역 스트림이 허용 크기를 초과했습니다.'));
    }
    if (buffer.trim()) consume(buffer);
    if (!completed) throw Error(tr('번역 응답이 중단됐습니다. 완료된 번역으로 저장하지 않았습니다.'));
    if(!output.trim())throw Error(tr('모델이 설명이나 번역 텍스트를 반환하지 않았습니다. 다른 모델을 선택하세요.'));
    return output;
  }
}
module.exports = { ChatGPT, oauthError };
