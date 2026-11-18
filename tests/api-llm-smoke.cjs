// End-to-end check of API key connections in the real Electron app against
// simulated provider servers on this machine: a wrong key is refused and not
// kept, an accepted key shows only its last four characters, the model list
// and the billing notice name the API connection, a translation goes to it
// with the key, and removing the key takes the connection away.
// Real provider behaviour and translation quality need real keys.
const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const os = require('node:os');
const { PDFDocument, StandardFonts } = require('pdf-lib');
const appName = require('../core/app-name.cjs');
const root = path.resolve(__dirname, '..');

function providers() {
  const requests = [];
  const json = (res, value, status = 200) => res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(value));
  const sse = (res, events) => { res.writeHead(200, { 'Content-Type': 'text/event-stream' }); for (const e of events) res.write(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`); res.end(); };
  const server = http.createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk; const url = new URL(req.url, 'http://x'), body = raw ? JSON.parse(raw) : null; requests.push({ path: url.pathname, headers: req.headers, body });
    if (url.pathname === '/compat/v1/models') return req.headers.authorization === 'Bearer compat-key-5678' ? json(res, { data: [{ id: 'mock-chat-1' }, { id: 'mock-embed', name: 'embedding' }] }) : json(res, { error: { message: 'Invalid API key' } }, 401);
    if (url.pathname === '/gemini/v1beta/models') return json(res, { error: { code: 400, message: 'API key not valid. Please pass a valid API key.', status: 'INVALID_ARGUMENT' } }, 400);
    if (url.pathname === '/claude/v1/models') return req.headers['x-api-key'] === 'sk-ant-good-1234' ? json(res, { data: [{ type: 'model', id: 'claude-haiku-5-5', display_name: 'Claude Haiku 5.5', created_at: '2026-09-01T00:00:00Z', max_tokens: 128000, capabilities: { image_input: { supported: true } } }], has_more: false }) : json(res, { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }, 401);
    if (url.pathname === '/claude/v1/messages') {
      const input = JSON.parse(body.messages[0].content).blocks, text = JSON.stringify({ blocks: input.map(b => ({ id: b.id, text: 'Claude API가 번역한 문단입니다.' })) });
      return sse(res, [{ type: 'message_start', message: { id: 'msg_1', type: 'message', role: 'assistant', content: [], model: body.model, stop_reason: null, stop_sequence: null, usage: { input_tokens: 5, output_tokens: 0 } } }, { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }, { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } }, { type: 'content_block_stop', index: 0 }, { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 20 } }, { type: 'message_stop' }]);
    }
    json(res, { error: { message: 'not found' } }, 404);
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({ server, requests, url: `http://127.0.0.1:${server.address().port}` })));
}

(async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), `${appName.id}-api-e2e-`)), vault = path.join(temp, 'vault'); await fs.mkdir(vault);
  const doc = await PDFDocument.create(), font = await doc.embedFont(StandardFonts.Helvetica);
  doc.addPage([600, 800]).drawText('We study how layout affects reading speed.', { x: 40, y: 700, size: 12, font });
  await fs.writeFile(path.join(temp, 'study.pdf'), await doc.save());
  const fake = await providers();
  const executable = require('./app-executable.cjs')(root);
  const env = /utf-?8/i.test(process.env.LC_ALL || process.env.LANG || '') ? process.env : { ...process.env, LC_ALL: 'C.UTF-8', LANG: 'C.UTF-8' };
  const app = await electron.launch({ env, executablePath: executable, args: [...(process.env.APP_TEST_SOURCE === '1' ? [root] : []), '--no-sandbox', '--ozone-platform=headless', '--disable-gpu', `--user-data-dir=${path.join(temp, 'profile')}`], timeout: 20000 });
  try {
    const p = await app.firstWindow(); p.setDefaultTimeout(15000);
    p.on('pageerror', e => { console.error(e); process.exitCode = 1; }); p.on('console', m => { if (m.type() === 'error') console.error('renderer:', m.text()); });
    await app.evaluate(({ app, dialog, shell }, base) => {
      globalThis.openQueue = []; dialog.showOpenDialog = async () => ({ canceled: false, filePaths: globalThis.openQueue.shift() }); shell.openExternal = async url => { globalThis.opened = url; };
      const load = file => process.getBuiltinModule('module').createRequire(app.getAppPath() + '/package.json')(file);
      load('./desktop/chatgpt.cjs').ChatGPT.prototype.status = () => ({ connected: false, usable: false, email: '', persistent: false });
      const { ClaudeAPI, GeminiAPI, OpenAIAPI } = load('./desktop/api-llm.cjs');
      ClaudeAPI.prototype.baseURL = base + '/claude'; GeminiAPI.prototype.baseURL = base + '/gemini/v1beta'; OpenAIAPI.prototype.baseURL = base + '/openai/v1';
    }, fake.url);
    await app.evaluate((_, v) => globalThis.openQueue.push([v]), vault); await p.locator('[data-action="storage"]').first().click();
    await app.evaluate((_, f) => globalThis.openQueue.push([f]), path.join(temp, 'study.pdf')); await p.locator('[data-action="add-files"]').first().click();
    await p.locator('.paper-item').click(); await p.locator('.original-pages .page[data-page="1"] .textLayer span').first().waitFor();

    await p.locator('[data-mode="dual"]').click(); await p.locator('#dialog').filter({ hasText: 'API 연결' }).waitFor();
    // One folding section per way of connecting: the one used last (here the ChatGPT account) starts open; the window is resizable.
    assert.deepEqual(await p.locator('[data-llm-section]').evaluateAll(list => list.map(d => [d.dataset.llmSection, d.open])), [['gpt', true], ['local', false], ['api', false], ['language', false], ['look', false], ['general', false]], 'only the connection used last is open; 언어, 모양 and 일반 start folded');
    assert.equal(await p.evaluate(() => getComputedStyle(dialog).resize), 'horizontal');
    await p.locator('[data-llm-section="api"] > summary').click(); await p.locator('#api-status-claude-api').waitFor();
    assert.equal(await p.locator('#api-status-claude-api').textContent(), '키 없음');
    await p.locator('[data-api-action="page"][data-api="claude-api"]').click();
    for (let i = 0; i < 100 && !(await app.evaluate(() => globalThis.opened)); i++) await new Promise(r => setTimeout(r, 50));
    assert.equal(await app.evaluate(() => globalThis.opened), 'https://console.anthropic.com/settings/keys', 'only the fixed key page opens');

    // A key the provider refuses is reported in place and not kept.
    await p.locator('#api-key-gemini-api').fill('AIza-wrong-key'); await p.locator('[data-api-action="save"][data-api="gemini-api"]').click();
    await p.locator('#api-status-gemini-api').filter({ hasText: 'Gemini API 키가 올바르지 않거나 권한이 없습니다' }).waitFor();

    await p.locator('#api-key-claude-api').fill('sk-ant-good-1234'); await p.locator('[data-api-action="save"][data-api="claude-api"]').click();
    await p.locator('#api-status-claude-api').filter({ hasText: '키 저장됨 · …1234' }).waitFor();
    assert.equal(await p.locator('#api-key-claude-api').inputValue(), '', 'the key is not shown again');
    assert.equal(await p.evaluate(() => document.body.innerHTML.includes('sk-ant-good-1234')), false);
    assert.equal(await p.locator('#api-status-gemini-api').textContent(), '키 없음');
    if (process.env.APP_API_SCREENSHOT) await p.screenshot({ path: process.env.APP_API_SCREENSHOT + '-settings.png' });
    await p.locator('#dialog [data-action="close"]').first().click();

    // The model list and the notice name the API connection; the request carries the key.
    await p.locator('[data-mode="dual"]').click(); await p.locator('#gpt-model').waitFor({ state: 'attached' });
    assert.deepEqual(await p.locator('#gpt-model option').evaluateAll(list => list.map(o => [o.dataset.connection, o.value, o.textContent])), [['claude-api', 'claude-haiku-5-5', 'Claude Haiku 5.5']]);
    assert.match(await p.locator('#gpt-model-notice').textContent(), /Claude API로 보냅니다\. 사용한 만큼 키의 계정에 요금이 청구됩니다/);
    if (process.env.APP_API_SCREENSHOT) await p.screenshot({ path: process.env.APP_API_SCREENSHOT + '-translate.png' });
    await p.locator('[data-action="gpt-start"]').click();
    await p.locator('.translated-block').filter({ hasText: 'Claude API가 번역한 문단입니다.' }).first().waitFor();
    const call = fake.requests.find(r => r.path === '/claude/v1/messages');
    assert.equal(call.headers['x-api-key'], 'sk-ant-good-1234'); assert.equal(call.body.model, 'claude-haiku-5-5'); assert.match(call.body.system, /Korean/);
    await p.locator('[data-action="gpt-export"]').waitFor();
    const [recordFile] = (await fs.readdir(path.join(vault, appName.vaultDir))).filter(f => /^translation-.*\.json$/.test(f) && !f.endsWith('.chunks.json'));
    assert.equal(JSON.parse(await fs.readFile(path.join(vault, appName.vaultDir, recordFile), 'utf8')).connection, 'claude-api');

    // Other providers: an OpenAI-compatible address of one's own; a wrong key is refused; the provider joins the model list.
    await p.locator('[data-action="settings"]').first().click(); await p.locator('[data-llm-section="api"][open]').waitFor();
    assert.equal(await p.locator('[data-llm-section="gpt"]').evaluate(d => d.open), false, 'the way used last (Claude API) is the open one');
    await p.locator('#provider-preset').selectOption(''); await p.locator('#provider-name').fill('Mock Compat'); await p.locator('#provider-url').fill(fake.url + '/compat/v1');
    await p.locator('#provider-key').fill('compat-wrong-0000'); await p.locator('[data-action="provider-add"]').click(); await p.locator('#provider-status').filter({ hasText: '키가 올바르지 않거나' }).waitFor();
    await p.locator('#provider-key').fill('compat-key-5678'); await p.locator('[data-action="provider-add"]').click(); await p.locator('#api-status-custom-1').filter({ hasText: '…5678' }).waitFor();
    assert.match(await p.locator('[data-api-row="custom-1"]').textContent(), new RegExp(fake.url.replace(/[.:/]/g, m => '\\' + m) + '/compat/v1'));
    await p.locator('#dialog [data-action="close"]').first().click();
    assert.deepEqual(await p.evaluate(async () => { const c = (await window.appApi.llmConnections()).find(x => x.id === 'custom-1'); return [c.label, c.kind, c.usable, (await window.appApi.llmModels('custom-1')).map(m => m.id)]; }), ['Mock Compat', 'api', true, ['mock-chat-1']], 'a usable API connection offering chat models only');
    await p.locator('[data-action="settings"]').first().click(); await p.locator('[data-api-action="remove-provider"][data-api="custom-1"]').click(); await p.locator('[data-api-row="custom-1"]').waitFor({ state: 'detached' }); await p.locator('#dialog [data-action="close"]').first().click();

    // Removing the key takes the connection away: AI help asks for a connection again.
    await p.locator('[data-action="settings"]').first().click(); await p.locator('[data-api-action="remove"][data-api="claude-api"]').click();
    await p.locator('#api-status-claude-api').filter({ hasText: '키 없음' }).waitFor(); await p.locator('#dialog [data-action="close"]').first().click();
    await p.locator('[data-tab="요약"]').click(); await p.locator('[data-action="ai-summary"]').click(); await p.locator('#dialog').filter({ hasText: 'LLM 연결' }).waitFor();
    assert.equal(fake.requests.filter(r => r.path === '/gemini/v1beta/models').length, 1, 'the refused key was never used again');
    console.log('API smoke passed: wrong key refused and not kept, key shown by its last four characters only, key page link, Claude API model list and billing notice, translation with the key, removal takes the connection away, folding settings sections, another OpenAI-compatible provider.');
  } finally { await app.close().catch(() => {}); fake.server.close(); await fs.rm(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }).catch(error => console.warn(`임시 폴더를 다 지우지 못했습니다(${error.code}). 테스트 결과와는 무관합니다: ${temp}`)); }
})().catch(error => { console.error(error); process.exit(1); });
