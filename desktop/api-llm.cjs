// Connections through the user's own API keys: OpenAI (Responses API),
// Claude (Anthropic SDK) and Gemini. Every request is billed to the key's
// account; nothing falls back to another connection. Keys stay in the main
// process, encrypted with the OS secure storage when it is available.
const { figureInstructions, translateBlocks, streamLines, notConnected } = require('./llm.cjs');
const {tr}=require('../core/i18n.js');
const { atomicJson, readJson } = require('./storage.cjs');
const { answer } = require('./local-llm.cjs');

const KEY_PAGES = { 'gpt-api': 'https://platform.openai.com/api-keys', 'claude-api': 'https://console.anthropic.com/settings/keys', 'gemini-api': 'https://aistudio.google.com/apikey' };
const RESPONSE_LIMIT = 2e6;

class ApiKeyStore {
  // unreadable: the connections whose saved key could not be read (the secure storage's key changed, as on Linux
  // when the app's name changed, or its keyring was not ready), with what was saved. Their screen asks to connect
  // again until a key is entered or removed, and what was saved stays in the file meanwhile (another key saved
  // does not drop it), so a keyring that answers again later still finds it.
  constructor({ file, protect, unprotect, persistent = () => true, notices = null }) { Object.assign(this, { file, protect, unprotect, persistent, notices }); this.keys = new Map(); this.unreadable = new Map(); }
  async init() {
    if (!this.persistent()) return;
    // A key file that cannot be read is set aside (settings-file.cjs); its connections ask for their keys again.
    const saved = await require('./settings-file.cjs').readSettingsFile(this.file, null, this.notices, 'keys');
    // protect and unprotect may answer later (the OS secure storage does). unprotect gives the key, or
    // { result, shouldReEncrypt } when the storage's key changed: the file is then written again.
    let stale = false;
    for (const [id, cipher] of Object.entries(saved?.keys || {})) { try { const plain = await this.unprotect(Buffer.from(cipher, 'base64')), key = typeof plain === 'string' ? plain : plain.result; if (typeof key !== 'string') throw Error('key'); if (plain?.shouldReEncrypt === true) stale = true; this.keys.set(id, key); } catch { this.restoreFailed = true; this.unreadable.set(id, cipher); } }
    // Only when every key was read: a file with a key that could not be read is left as it is.
    if (stale && !this.restoreFailed) await this.save().catch(() => {});
  }
  get(id) { return this.keys.get(id) || ''; }
  async set(id, key) { this.keys.set(id, key); this.unreadable.delete(id); await this.save(); }
  async remove(id) { this.keys.delete(id); this.unreadable.delete(id); await this.save(); }
  // Without secure storage a key lives only in memory for this run.
  async save() {
    if (!this.persistent()) return;
    const keys = {}; for (const [id, key] of [...this.keys]) keys[id] = Buffer.from(await this.protect(key)).toString('base64');
    for (const [id, cipher] of this.unreadable) if (!(id in keys)) keys[id] = cipher;
    await atomicJson(this.file, { version: 1, keys });
  }
}

// Read as a limit by the translation retry (status 429), as its wording always was.
const truncated = client => Object.assign(Error(tr('{name} 응답이 출력 길이 한도에서 잘렸습니다. 완료된 번역으로 저장하지 않았습니다.',{name:client.label})), { status: 429 });
const finished = output => { if (!output.trim()) throw Error(tr('모델이 설명이나 번역 텍스트를 반환하지 않았습니다. 다른 모델을 선택하세요.')); return output; };
// Turns a provider's error into one the translation queue understands:
// status 429 and 5xx are retried (retryAfterMs up to a minute); an error no
// retry can fix is marked fatal, and the job stops instead of sending the
// rest of the paper into the same refusal.
function failure(client, status, message, retryAfter, { code = '', details = [] } = {}) {
  const keyProblem = status === 401 || status === 403 || /api key not valid|invalid.{0,10}api.?key|incorrect api key/i.test(message);
  // Gemini names the quota that ran out: per minute (wait) or per day, or a limit of 0 when the key's tier has no access to the model.
  const quotas = details.flatMap(d => Array.isArray(d?.violations) ? d.violations : []);
  const noAccess = quotas.some(v => String(v?.quotaValue) === '0') || /limit: 0\b/.test(message), daily = quotas.some(v => /PerDay/i.test(String(v?.quotaId)));
  const noCredit = code === 'insufficient_quota' || /credit balance is too low/i.test(message);
  const name = client.label, detail = message ? message.slice(0, 160) : '';
  const text = keyProblem ? tr('{name} 키가 올바르지 않거나 권한이 없습니다. 설정에서 키를 확인하세요.', { name })
    : noAccess ? tr('{name} 키의 요금 등급에서는 이 모델을 쓸 수 없습니다(한도 0). 다른 모델을 고르거나 결제를 연결하세요.', { name })
      : daily ? tr('{name} 일일 사용 한도를 모두 썼습니다. 내일 다시 시도하거나 요금 등급을 올리세요.', { name })
        : noCredit ? tr('{name} 크레딧이나 사용 한도가 부족합니다. 공급자 콘솔에서 결제 상태를 확인하세요.', { name })
          : status === 404 ? (detail ? tr('{name}에서 모델을 찾을 수 없습니다 ({detail}). 다른 모델을 고르세요.', { name, detail }) : tr('{name}에서 모델을 찾을 수 없습니다. 다른 모델을 고르세요.', { name }))
            : status === 429 ? (detail ? tr('{name} 요청 한도에 걸렸습니다 ({detail}). 잠시 후 다시 시도합니다.', { name, detail }) : tr('{name} 요청 한도에 걸렸습니다. 잠시 후 다시 시도합니다.', { name }))
              : tr('{name} 요청에 실패했습니다 ({detail}).', { name, detail: `${status}${message ? ': ' + message.slice(0, 200) : ''}` });
  const error = Object.assign(Error(text), { status: noAccess || daily || noCredit ? 429 : status, fatal: keyProblem || noAccess || daily || noCredit || status === 402 || status === 404 });
  if (Number.isFinite(retryAfter) && retryAfter > 0) error.retryAfterMs = Math.min(60000, retryAfter * 1000);
  return error;
}
async function httpFailure(client, response) {
  let body = null; try { body = await response.json(); } catch {}
  const message = String(body?.error?.message || (typeof body?.error === 'string' ? body.error : '') || ''), details = Array.isArray(body?.error?.details) ? body.error.details : [];
  // Gemini says when to retry in the error details instead of a header.
  const delay = details.find(d => typeof d?.retryDelay === 'string')?.retryDelay;
  return failure(client, response.status, message, Number(response.headers.get('retry-after')) || parseFloat(delay), { code: String(body?.error?.code || ''), details });
}
const parseEvent = (client, data) => { try { return JSON.parse(data); } catch { throw Object.assign(Error(tr('{name} 응답 스트림이 손상됐습니다. 다시 시도합니다.', { name: client.label })), { status: 502 }); } };

class ApiClient {
  constructor({ fetch, keys }) { Object.assign(this, { fetch, keys, kind: 'api', concurrency: 3 }); this.modelCache = null; }
  key() { return this.keys.get(this.id); }
  status() { const key = this.key(); return { usable: Boolean(key), hasKey: Boolean(key), hint: key ? '…' + key.slice(-4) : '', persistent: this.keys.persistent(), ...(!key && this.keys.unreadable?.has(this.id) ? { restoreFailed: true } : {}) }; }
  // A key is kept only after the provider accepted it by listing its models.
  async setKey(value) {
    const key = String(value ?? '').trim();
    if (!/^[\x21-\x7e]{8,512}$/.test(key)) throw Error(tr('API 키를 확인하세요.'));
    await this.listModels(key);
    await this.keys.set(this.id, key); this.modelCache = null; return this.status();
  }
  async removeKey() { await this.keys.remove(this.id); this.modelCache = null; return this.status(); }
  async models() {
    const key = this.key(); if (!key) throw notConnected(this);
    if (this.modelCache?.key === key && this.modelCache.expires > Date.now()) return this.modelCache.value.map(m => ({ ...m }));
    const value = await this.listModels(key); this.modelCache = { key, value, expires: Date.now() + 600000 }; return value.map(m => ({ ...m }));
  }
  async request(path, init = {}, timeout) {
    const signal = timeout ? (init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(timeout)]) : AbortSignal.timeout(timeout)) : init.signal;
    let response;
    try { response = await this.fetch(this.baseURL + path, { ...init, redirect: 'error', signal }); }
    catch (error) { if (init.signal?.aborted || error?.name === 'TimeoutError') throw error; throw Object.assign(Error(tr('{name}에 연결하지 못했습니다. 네트워크를 확인하세요.', { name: this.label })), { status: 503 }); }
    if (!response.ok) throw await httpFailure(this, response);
    return response;
  }
  translate(model, blocks, signal, context = {}, onUnit) { return translateBlocks(this, model, blocks, signal, context, onUnit); }
  cancel() {}
  disconnect() { return this.removeKey(); }
}

// Chat models only: the list also holds audio, image, embedding and moderation models.
const OPENAI_CHAT = /^(gpt-|chatgpt-|o\d)/, OPENAI_OTHER = /audio|realtime|transcribe|tts|search|image|embedding|moderation|instruct|codex|computer-use|dall-e|whisper/i;
class OpenAIAPI extends ApiClient {
  constructor(options) { super(options); Object.assign(this, { id: 'gpt-api', label: 'OpenAI API' }); }
  headers(key) { return { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' }; }
  async listModels(key) {
    const data = await (await this.request('/models', { headers: this.headers(key) }, 15000)).json();
    return (Array.isArray(data?.data) ? data.data : []).filter(m => typeof m?.id === 'string' && OPENAI_CHAT.test(m.id) && !OPENAI_OTHER.test(m.id))
      .sort((a, b) => (b.created || 0) - (a.created || 0)).map(m => ({ id: m.id, name: m.id }));
  }
  imageMessage(text, images) { return { role: 'user', content: [{ type: 'input_text', text }, ...images.map(url => ({ type: 'input_image', image_url: url, detail: 'auto' }))] }; }
  explainFigure(model, image, context, signal, language) {
    return this.respond(model, [{ role: 'user', content: [{ type: 'input_text', text: JSON.stringify(context) }, { type: 'input_image', image_url: image, detail: 'high' }] }], figureInstructions(language), signal);
  }
  // The same Responses API stream the ChatGPT account uses; nothing is stored at OpenAI.
  async respond(model, input, instructions, signal, onDelta) {
    const key = this.key(); if (!key) throw notConnected(this);
    const response = await this.request('/responses', { method: 'POST', headers: this.headers(key), body: JSON.stringify({ model, store: false, stream: true, instructions, input }), signal });
    let output = '', completed = false;
    await streamLines(response, raw => {
      if (!raw.startsWith('data:')) return; const data = raw.slice(5).trim(); if (!data || data === '[DONE]') return;
      const event = parseEvent(this, data);
      if (event.type === 'response.output_text.delta') { output += event.delta || ''; if (output.length > RESPONSE_LIMIT) throw Error(tr('번역 응답이 허용 크기를 초과했습니다.')); onDelta?.(output); }
      if (event.type === 'response.completed') completed = true;
      if (event.type === 'response.incomplete') { const reason = event.response?.incomplete_details?.reason; throw reason === 'max_output_tokens' ? truncated(this) : Error(tr('{name} 응답이 완료되지 않았습니다 ({reason}).', { name: this.label, reason: reason || tr('알 수 없음') })); }
      if (event.type === 'response.failed' || event.type === 'error') { const error = event.response?.error || event.error || event; throw failure(this, error.code === 'rate_limit_exceeded' ? 429 : 400, String(error.message || error.code || ''), NaN, { code: String(error.code || '') }); }
    }, RESPONSE_LIMIT);
    if (!completed) throw Error(tr('번역 응답이 중단됐습니다. 완료된 번역으로 저장하지 않았습니다.'));
    return finished(output);
  }
}
OpenAIAPI.prototype.baseURL = 'https://api.openai.com/v1';

// Models that can hand a declined request to another model on the server
// (billed at that model's rates) instead of stopping with a refusal: every model with refusal
// classifiers but Claude Haiku 5.5, which has no server-side fallback (platform.claude.com,
// "Refusals and fallback"). Settings offer whatever the account's model list holds, so a model
// missing here simply stops on a refusal; one listed that the API does not take would fail.
const CLAUDE_FALLBACK = new Set(['claude-fable-5-2', 'claude-mythos-5-2', 'claude-fable-5-1', 'claude-mythos-5-1', 'claude-fable-5', 'claude-opus-5-5', 'claude-opus-5', 'claude-sonnet-5-5']);
// The SDK is loaded on first use: a checkout whose packages were not
// reinstalled still starts, and only Claude API says what is missing.
let anthropicSdk = null;
function anthropic() {
  try { return anthropicSdk ||= require('@anthropic-ai/sdk'); }
  catch (error) { if (error?.code === 'MODULE_NOT_FOUND') throw Error(tr('Claude API 모듈(@anthropic-ai/sdk)이 설치되지 않았습니다. 프로젝트 폴더에서 npm install을 실행한 뒤 앱을 다시 시작하세요.')); throw error; }
}
class ClaudeAPI extends ApiClient {
  constructor(options) { super(options); Object.assign(this, { id: 'claude-api', label: 'Claude API' }); this.limits = new Map(); }
  sdk(key) {
    if (this.client?.key !== key || this.client.baseURL !== this.baseURL) this.client = { key, baseURL: this.baseURL, api: new (anthropic().Anthropic)({ apiKey: key, baseURL: this.baseURL, fetch: this.fetch, maxRetries: 0, timeout: 600000 }) };
    return this.client.api;
  }
  failed(error, signal) {
    const sdk = anthropicSdk;
    if (signal?.aborted || !sdk) return error;
    if (error instanceof sdk.APIConnectionTimeoutError) return Object.assign(Error(tr('{name}가 응답하지 않습니다. 다시 시도합니다.', { name: this.label })), { name: 'TimeoutError' });
    if (error instanceof sdk.APIConnectionError) return Object.assign(Error(tr('{name}에 연결하지 못했습니다. 네트워크를 확인하세요.', { name: this.label })), { status: 503 });
    if (error instanceof sdk.APIError && error.status) return failure(this, error.status, String(error.error?.error?.message || ''), Number(error.headers?.get?.('retry-after')), { code: String(error.error?.error?.type || '') });
    return error;
  }
  async listModels(key) {
    const list = [];
    try { for await (const m of this.sdk(key).models.list({ limit: 100 })) list.push(m); } catch (error) { throw this.failed(error); }
    for (const m of list) if (m.max_tokens) this.limits.set(m.id, m.max_tokens);
    return list.map(m => ({ id: m.id, name: m.display_name || m.id, ...(m.capabilities ? { vision: m.capabilities.image_input?.supported === true } : {}) }));
  }
  imageMessage(text, images) { return { role: 'user', content: [...images.map(url => ({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: String(url).replace(/^data:image\/png;base64,/, '') } })), { type: 'text', text }] }; }
  explainFigure(model, image, context, signal, language) {
    const data = String(image).replace(/^data:image\/png;base64,/, '');
    return this.respond(model, [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data } }, { type: 'text', text: JSON.stringify(context) }] }], figureInstructions(language), signal);
  }
  async respond(model, messages, instructions, signal, onDelta) {
    const key = this.key(); if (!key) throw notConnected(this);
    const api = this.sdk(key), params = { model, max_tokens: Math.min(32000, this.limits.get(model) || 16000), system: instructions, messages: messages.map(m => ({ role: m.role, content: m.content })) };
    let streamed = '', message;
    try {
      const stream = CLAUDE_FALLBACK.has(model) ? api.beta.messages.stream({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' }, { signal }) : api.messages.stream(params, { signal });
      stream.on('text', delta => { streamed += delta; if (streamed.length > RESPONSE_LIMIT) stream.abort(); else onDelta?.(streamed); });
      message = await stream.finalMessage();
    } catch (error) { throw this.failed(error, signal); }
    if (message.stop_reason === 'max_tokens') throw truncated(this);
    if (message.stop_reason === 'refusal') throw Error(tr('{name}가 이 요청을 처리하지 않았습니다(안전 정책). 다른 모델을 선택하거나 범위를 바꿔 보세요.', { name: this.label }));
    // After a server-side fallback only the text of the model that finished counts.
    const blocks = message.content, last = blocks.map(b => b.type).lastIndexOf('fallback');
    return finished(blocks.slice(last + 1).filter(b => b.type === 'text').map(b => b.text).join(''));
  }
}
ClaudeAPI.prototype.baseURL = 'https://api.anthropic.com';

const GEMINI_OTHER = /embedding|tts|image|live|audio|robotics|computer-use/i;
class GeminiAPI extends ApiClient {
  constructor(options) { super(options); Object.assign(this, { id: 'gemini-api', label: 'Gemini API' }); }
  headers(key) { return { 'x-goog-api-key': key, 'Content-Type': 'application/json' }; }
  async listModels(key) {
    const list = []; let token = '';
    for (let page = 0; page < 10; page++) {
      const data = await (await this.request('/models?pageSize=1000' + (token ? '&pageToken=' + encodeURIComponent(token) : ''), { headers: this.headers(key) }, 15000)).json();
      list.push(...(Array.isArray(data?.models) ? data.models : [])); token = data?.nextPageToken; if (!token) break;
    }
    return list.filter(m => typeof m?.name === 'string' && /^models\/gemini/.test(m.name) && m.supportedGenerationMethods?.includes('generateContent') && !GEMINI_OTHER.test(m.name))
      .map(m => ({ id: m.name.slice(7), name: m.displayName || m.name.slice(7) }));
  }
  imageMessage(text, images) { return { role: 'user', content: text, parts: [{ text }, ...images.map(url => ({ inlineData: { mimeType: 'image/png', data: String(url).replace(/^data:image\/png;base64,/, '') } }))] }; }
  explainFigure(model, image, context, signal, language) {
    return this.generate(model, [{ role: 'user', parts: [{ text: JSON.stringify(context) }, { inlineData: { mimeType: 'image/png', data: String(image).replace(/^data:image\/png;base64,/, '') } }] }], figureInstructions(language), signal);
  }
  respond(model, messages, instructions, signal, onDelta, options = {}) {
    return this.generate(model, messages.map(m => ({ role: 'user', parts: m.parts || [{ text: m.content }] })), instructions, signal, onDelta, options);
  }
  async generate(model, contents, instructions, signal, onDelta, options = {}) {
    const key = this.key(); if (!key) throw notConnected(this);
    const body = { systemInstruction: { parts: [{ text: instructions }] }, contents, ...(options.json ? { generationConfig: { responseMimeType: 'application/json' } } : {}) };
    const response = await this.request(`/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`, { method: 'POST', headers: this.headers(key), body: JSON.stringify(body), signal });
    let output = '', reason = '';
    await streamLines(response, raw => {
      if (!raw.startsWith('data:')) return; const data = raw.slice(5).trim(); if (!data) return;
      const event = parseEvent(this, data);
      if (event.error) throw failure(this, event.error.code || 500, String(event.error.message || ''), NaN, { details: Array.isArray(event.error.details) ? event.error.details : [] });
      if (event.promptFeedback?.blockReason) throw Error(tr('Gemini가 응답을 중단했습니다 ({reason}). 안전 정책에 걸린 요청입니다.', { reason: event.promptFeedback.blockReason }));
      const candidate = event.candidates?.[0];
      // Thinking parts (thought: true) are not part of the answer.
      for (const part of candidate?.content?.parts || []) if (!part.thought && typeof part.text === 'string') { output += part.text; if (output.length > RESPONSE_LIMIT) throw Error(tr('번역 응답이 허용 크기를 초과했습니다.')); onDelta?.(output); }
      if (candidate?.finishReason) reason = candidate.finishReason;
    }, RESPONSE_LIMIT);
    if (reason === 'MAX_TOKENS') throw truncated(this);
    if (reason && reason !== 'STOP') throw Error(tr('Gemini가 응답을 중단했습니다 ({reason}). 안전 정책이나 인용 검사에 걸렸을 수 있습니다.', { reason }));
    if (!reason) throw Error(tr('번역 응답이 중단됐습니다. 완료된 번역으로 저장하지 않았습니다.'));
    return finished(output);
  }
}
GeminiAPI.prototype.baseURL = 'https://generativelanguage.googleapis.com/v1beta';


// Other providers that speak the OpenAI Chat Completions API. The user adds
// them (a preset or an address of their own, at most five); each keeps its
// key in the same encrypted store and appears as its own connection.
const COMPATIBLE_PRESETS = {
  openrouter: { name: 'OpenRouter', url: 'https://openrouter.ai/api/v1', keys: 'https://openrouter.ai/keys' },
  deepseek: { name: 'DeepSeek', url: 'https://api.deepseek.com/v1', keys: 'https://platform.deepseek.com/api_keys' },
  mistral: { name: 'Mistral', url: 'https://api.mistral.ai/v1', keys: 'https://console.mistral.ai/api-keys' },
  groq: { name: 'Groq', url: 'https://api.groq.com/openai/v1', keys: 'https://console.groq.com/keys' },
  upstage: { name: 'Upstage Solar', url: 'https://api.upstage.ai/v1', keys: 'https://console.upstage.ai/api-keys' },
  xai: { name: 'xAI Grok', url: 'https://api.x.ai/v1', keys: 'https://console.x.ai' },
  together: { name: 'Together AI', url: 'https://api.together.xyz/v1', keys: 'https://api.together.ai/settings/api-keys' }
};
const MAX_PROVIDERS = 5;
// https only (a key must not travel in clear text); http is allowed for this computer, as for local models.
function normalizeProvider(raw) {
  const preset = Object.hasOwn(COMPATIBLE_PRESETS, raw?.preset) ? raw.preset : '';
  const name = String(raw?.name ?? (preset ? COMPATIBLE_PRESETS[preset].name : '')).replace(/\s+/g, ' ').trim();
  if (!name || name.length > 40) throw Error(tr('공급자 이름을 1–40자로 입력하세요.'));
  let url;
  try { url = new URL(String(raw?.url ?? (preset ? COMPATIBLE_PRESETS[preset].url : '')).trim()); } catch { throw Error(tr('API 주소를 확인하세요. 예: https://api.example.com/v1')); }
  const loopback = /^(localhost|127(\.\d+){3}|\[::1\])$/i.test(url.hostname);
  if (!(url.protocol === 'https:' || url.protocol === 'http:' && loopback) || url.username || url.password || url.search || url.hash) throw Error(tr('API 주소는 https:// 로 시작해야 합니다(계정·검색어 없이).'));
  return { ...(raw?.id ? { id: String(raw.id) } : {}), preset, name, url: url.href.replace(/\/+$/, '') };
}
const COMPATIBLE_OTHER = /embed|tts|whisper|transcri|speech|audio|image|dall-e|moderation|rerank|guard/i;
class CompatibleAPI extends ApiClient {
  constructor({ fetch, keys, provider }) { super({ fetch, keys }); this.configure(provider); }
  configure(provider) { Object.assign(this, { id: provider.id, provider, label: provider.name, baseURL: provider.url, keyPage: COMPATIBLE_PRESETS[provider.preset]?.keys || null }); this.modelCache = null; }
  status() { return { ...super.status(), custom: true, url: this.baseURL, preset: this.provider.preset, keyPage: Boolean(this.keyPage) }; }
  headers(key) { return { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' }; }
  async listModels(key) {
    let data;
    try { data = await (await this.request('/models', { headers: this.headers(key) }, 15000)).json(); }
    catch (error) { if (error instanceof SyntaxError) throw Error(tr('{name} 주소가 OpenAI 호환 API가 아닌 것 같습니다. 주소(…/v1)를 확인하세요.', { name: this.label })); throw error; }
    const list = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
    return list.filter(m => typeof m?.id === 'string' && !COMPATIBLE_OTHER.test(m.id)).map(m => ({ id: m.id, name: m.name && typeof m.name === 'string' ? m.name : m.id })).sort((a, b) => a.name.localeCompare(b.name));
  }
  imageMessage(text, images) { return { role: 'user', content: [{ type: 'text', text }, ...images.map(url => ({ type: 'image_url', image_url: { url } }))] }; }
  explainFigure(model, image, context, signal, language) {
    return this.respond(model, [{ role: 'user', content: [{ type: 'text', text: JSON.stringify(context) }, { type: 'image_url', image_url: { url: image } }] }], figureInstructions(language), signal);
  }
  async respond(model, messages, instructions, signal, onDelta) {
    const key = this.key(); if (!key) throw notConnected(this);
    const response = await this.request('/chat/completions', { method: 'POST', headers: this.headers(key), body: JSON.stringify({ model, stream: true, messages: [{ role: 'system', content: instructions }, ...messages] }), signal });
    let output = '', done = false, reason = '';
    await streamLines(response, raw => {
      if (!raw.startsWith('data:')) return; const data = raw.slice(5).trim(); if (!data) return; if (data === '[DONE]') { done = true; return; }
      const event = parseEvent(this, data);
      if (event.error) { const error = event.error; throw failure(this, Number(error.code) || 400, String(error.message || error), NaN, { code: String(error.code || '') }); }
      const choice = event.choices?.[0], text = choice?.delta?.content;
      if (typeof text === 'string' && text) { output += text; if (output.length > RESPONSE_LIMIT) throw Error(tr('번역 응답이 허용 크기를 초과했습니다.')); onDelta?.(answer(output)); }
      if (choice?.finish_reason) { reason = choice.finish_reason; done = true; }
    }, RESPONSE_LIMIT);
    if (reason === 'length') throw truncated(this);
    if (reason === 'content_filter') throw Object.assign(Error(tr('{name}가 내용 정책으로 응답을 막았습니다. 다른 모델을 고르세요.', { name: this.label })), { fatal: true });
    if (!done) throw Error(tr('번역 응답이 중단됐습니다. 완료된 번역으로 저장하지 않았습니다.'));
    return finished(answer(output));
  }
}

module.exports = { ApiKeyStore, OpenAIAPI, ClaudeAPI, GeminiAPI, CompatibleAPI, KEY_PAGES, COMPATIBLE_PRESETS, MAX_PROVIDERS, normalizeProvider };
