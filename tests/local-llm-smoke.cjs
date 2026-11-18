// End-to-end check of the local model connection in the real Electron app,
// against a simulated Ollama server on this machine: turning it on in the
// settings (address check, remote-address confirmation), translating with it
// while ChatGPT is not connected, one grouped model list once both can be
// used, AI help and figure explanation (image models only) sent to it.
// Translation quality needs a real model; this covers the app's side only.
const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const os = require('node:os');
const { PDFDocument, StandardFonts } = require('pdf-lib');
const appName = require('../core/app-name.cjs');
const root = path.resolve(__dirname, '..');

function ollama() {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk; const body = raw ? JSON.parse(raw) : null; requests.push({ url: req.url, body });
    const json = value => res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(value));
    if (req.url === '/api/version') return json({ version: '0.12.6' });
    if (req.url === '/api/tags') return json({ models: [{ name: 'qwen2.5:14b', digest: 'q', details: { parameter_size: '14.8B', quantization_level: 'Q4_K_M' } }, { name: 'gemma3:12b', digest: 'g', details: {} }, { name: 'nomic-embed-text', digest: 'n' }] });
    if (req.url === '/api/show') return json({ capabilities: { 'qwen2.5:14b': ['completion'], 'gemma3:12b': ['completion', 'vision'], 'nomic-embed-text': ['embedding'] }[body.model] });
    if (req.url !== '/api/chat') return res.writeHead(404).end();
    const [system, user] = body.messages, input = user.images ? null : JSON.parse(user.content); let content;
    if (/Translate research-paper/.test(system.content)) content = JSON.stringify({ blocks: input.blocks.map(b => ({ id: b.id, text: '로컬 모델이 번역한 문단입니다.' })) });
    else if (/Summarize/.test(system.content)) content = JSON.stringify({ question: [{ text: '로컬 요약 결과', basis: 'paper', evidence: [input.blocks[0].id] }] });
    else content = '로컬 모델의 그림 설명입니다.';
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
    for (let i = 0; i < content.length; i += 9) res.write(JSON.stringify({ message: { role: 'assistant', content: content.slice(i, i + 9) }, done: false }) + '\n');
    res.end(JSON.stringify({ message: { content: '' }, done: true, done_reason: 'stop' }) + '\n');
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({ server, requests, url: `http://127.0.0.1:${server.address().port}` })));
}

(async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), `${appName.id}-local-e2e-`)), vault = path.join(temp, 'vault'); await fs.mkdir(vault);
  const doc = await PDFDocument.create(), font = await doc.embedFont(StandardFonts.Helvetica);
  for (const text of ['We study how layout affects reading speed.', 'Reading speed rose by twelve percent with preserved layout.']) { const page = doc.addPage([600, 800]); page.drawText(text, { x: 40, y: 700, size: 12, font }); page.drawRectangle({ x: 60, y: 300, width: 300, height: 200, color: { type: 'RGB', red: 0.2, green: 0.4, blue: 0.8 } }); }
  await fs.writeFile(path.join(temp, 'study.pdf'), await doc.save());
  const fake = await ollama();
  const executable = require('./app-executable.cjs')(root);
  const env = /utf-?8/i.test(process.env.LC_ALL || process.env.LANG || '') ? process.env : { ...process.env, LC_ALL: 'C.UTF-8', LANG: 'C.UTF-8' };
  const app = await electron.launch({ env, executablePath: executable, args: [...(process.env.APP_TEST_SOURCE === '1' ? [root] : []), '--no-sandbox', '--ozone-platform=headless', '--disable-gpu', `--user-data-dir=${path.join(temp, 'profile')}`], timeout: 20000 });
  try {
    const p = await app.firstWindow(); p.setDefaultTimeout(15000);
    p.on('pageerror', e => { console.error(e); process.exitCode = 1; }); p.on('console', m => { if (m.type() === 'error') console.error('renderer:', m.text()); });
    await app.evaluate(({ app, dialog }) => {
      globalThis.openQueue = []; dialog.showOpenDialog = async () => ({ canceled: false, filePaths: globalThis.openQueue.shift() });
      const { ChatGPT } = process.getBuiltinModule('module').createRequire(app.getAppPath() + '/package.json')('./desktop/chatgpt.cjs');
      ChatGPT.prototype.status = () => ({ connected: false, usable: false, email: '', persistent: false });
    });
    await app.evaluate((_, v) => globalThis.openQueue.push([v]), vault); await p.locator('[data-action="storage"]').first().click();
    await app.evaluate((_, f) => globalThis.openQueue.push([f]), path.join(temp, 'study.pdf')); await p.locator('[data-action="add-files"]').first().click();
    await p.locator('.paper-item').click(); await p.locator('.original-pages .page[data-page="1"] .textLayer span').first().waitFor();

    // Nothing can be used yet: translating opens the connection settings.
    await p.locator('[data-mode="dual"]').click(); await p.locator('#dialog').filter({ hasText: 'LLM 연결' }).waitFor();
    // The settings sections fold; the ChatGPT one (used last) is open, the local one is opened here.
    assert.equal(await p.locator('[data-llm-section="local"]').evaluate(d => d.open), false); await p.locator('[data-llm-section="local"] > summary').click();
    assert.equal(await p.locator('#local-enabled').isChecked(), false, 'the local connection starts off');
    assert.equal(fake.requests.length, 0, 'nothing is sent to a local server that is off');
    // Reasoning starts off and only applies to Ollama.
    assert.equal(await p.locator('#local-think').isChecked(), false, 'reasoning starts off');
    await p.locator('#local-kind').selectOption('openai'); assert.equal(await p.locator('#local-think').isDisabled(), true, 'an OpenAI-compatible server sets reasoning itself');
    await p.locator('#local-kind').selectOption('ollama'); assert.equal(await p.locator('#local-think').isDisabled(), false);
    await p.locator('#local-enabled').check(); await p.locator('#local-url').fill(fake.url);
    await p.locator('[data-action="local-check"]').click(); await p.locator('#local-status').filter({ hasText: 'Ollama 0.12.6 · 모델 2개' }).waitFor();
    if (process.env.APP_LOCAL_SCREENSHOT) await p.screenshot({ path: process.env.APP_LOCAL_SCREENSHOT + '-settings.png' });

    // A remote address asks before paper text goes there; cancelling keeps the old settings.
    await p.locator('#local-url').fill('http://192.0.2.10:11434'); await p.locator('[data-action="local-save"]').click();
    await p.locator('#dialog').filter({ hasText: '192.0.2.10:11434' }).filter({ hasText: '암호화되지 않아' }).waitFor();
    await p.locator('[data-action="local-remote-cancel"]').click(); await p.locator('#local-status').filter({ hasText: '꺼짐' }).waitFor();
    await p.locator('#local-enabled').check(); await p.locator('#local-url').fill('http://192.0.2.10:11434'); await p.locator('[data-action="local-save"]').click();
    await p.locator('[data-action="local-remote-confirm"]').click(); await p.locator('#local-status').filter({ hasText: '원격 서버 192.0.2.10:11434' }).waitFor();
    await p.locator('#local-url').fill(fake.url); await p.locator('[data-action="local-save"]').click(); await p.locator('#local-status').filter({ hasText: '켜짐 · 이 PC' }).waitFor();
    const settings = JSON.parse(await fs.readFile(path.join(temp, 'profile', 'settings.json'), 'utf8'));
    assert.deepEqual(settings.llm.local, { enabled: true, kind: 'ollama', url: fake.url, numCtx: 16384, think: false, remoteConfirmed: false });
    await p.locator('#dialog [data-action="close"]').first().click();

    // Translating with the local model while ChatGPT is not connected.
    await p.locator('[data-mode="dual"]').click(); await p.locator('#gpt-model').waitFor({ state: 'attached' });
    assert.deepEqual(await p.locator('#gpt-model option').evaluateAll(list => list.map(o => [o.dataset.connection, o.value])), [['local', 'qwen2.5:14b'], ['local', 'gemma3:12b']]);
    assert.deepEqual(await p.locator('#gpt-model-connection option').evaluateAll(list => list.map(o => [o.value, o.textContent])), [['local', '로컬 모델']], 'the connection list on the left, its models on the right');
    assert.match(await p.locator('#gpt-model-notice').textContent(), /외부로 전송되지 않습니다/);
    await p.locator('[data-action="gpt-start"]').click();
    await p.locator('.translated-block').filter({ hasText: '로컬 모델이 번역한 문단입니다.' }).first().waitFor();
    const chat = fake.requests.find(r => r.url === '/api/chat').body;
    assert.equal(chat.model, 'qwen2.5:14b'); assert.deepEqual(chat.options, { num_ctx: 16384 }); assert.equal(chat.format, 'json');
    await p.locator('[data-action="gpt-export"]').waitFor();
    const [recordFile] = (await fs.readdir(path.join(vault, appName.vaultDir))).filter(f => /^translation-.*\.json$/.test(f) && !f.endsWith('.chunks.json'));
    const record = JSON.parse(await fs.readFile(path.join(vault, appName.vaultDir, recordFile), 'utf8'));
    assert.equal(record.connection, 'local'); assert.equal(record.model, 'qwen2.5:14b');
    assert.equal(JSON.parse(await fs.readFile(path.join(temp, 'profile', 'settings.json'), 'utf8')).llm.connection, 'local');

    // Once ChatGPT is usable too, one list shows both, grouped; AI help goes to the chosen one.
    await app.evaluate(({ app }) => {
      const { ChatGPT } = process.getBuiltinModule('module').createRequire(app.getAppPath() + '/package.json')('./desktop/chatgpt.cjs');
      ChatGPT.prototype.status = () => ({ connected: true, usable: true, email: 'fixture@example.test', persistent: false });
      ChatGPT.prototype.models = async () => [{ id: 'fixture-model', name: 'Fixture GPT' }];
      ChatGPT.prototype.respond = async () => { globalThis.gptCalled = true; throw Error('ChatGPT must not be called'); };
    });
    await p.locator('[data-tab="요약"]').click(); await p.locator('[data-action="ai-summary"]').click(); await p.locator('#ai-model').waitFor({ state: 'attached' });
    assert.deepEqual(await p.locator('#ai-model-connection option').evaluateAll(list => list.map(o => o.textContent)), ['ChatGPT 웹 계정', '로컬 모델']);
    assert.equal(await p.locator('#ai-model-connection').inputValue(), 'local');
    assert.equal(await p.locator('#ai-model').inputValue(), 'qwen2.5:14b', 'the last connection and model used are chosen');
    if (process.env.APP_LOCAL_SCREENSHOT) await p.screenshot({ path: process.env.APP_LOCAL_SCREENSHOT + '-models.png' });
    // 연결·모델 is a chip, as in the memo AI: its list groups the models by connection.
    const pick = async (id, connection, model) => { await p.locator(`[data-model-chip="${id}"]`).click(); await p.locator(`.note-ai-menu [data-model-pick="${connection}"]${model ? `[data-model="${model}"]` : ''}`).first().click(); };
    assert.match(await p.locator('[data-model-chip="ai-model"]').innerText(), /qwen2\.5:14b[\s\S]*로컬 모델/);
    await pick('ai-model', 'gpt-web'); assert.deepEqual(await p.locator('#ai-model option').evaluateAll(list => list.map(o => o.value)), ['fixture-model'], 'another connection shows only its models'); assert.match(await p.locator('#ai-model-notice').textContent(), /ChatGPT\(fixture@example\.test\)로 보냅니다/);
    assert.match(await p.locator('[data-model-chip="ai-model"]').innerText(), /Fixture GPT[\s\S]*ChatGPT 웹 계정/);
    await pick('ai-model', 'local', 'qwen2.5:14b'); assert.equal(await p.locator('#ai-model').inputValue(), 'qwen2.5:14b'); assert.match(await p.locator('#ai-model-notice').textContent(), /외부로 전송되지 않습니다/);
    await p.locator('#dialog [data-action="ai-send"]').click(); await p.locator('.insight-card').filter({ hasText: '로컬 요약 결과' }).waitFor();
    assert.equal(await app.evaluate(() => globalThis.gptCalled), undefined);

    // Figure explanation offers only models that take images.
    await p.locator('[data-action="figure-open"]').click(); await p.locator('[data-figure-capture="dialog"]').click(); await p.locator('#figure-status').filter({ hasText: '그림 영역을 선택하세요.' }).waitFor();
    await pick('figure-model', 'local'); assert.deepEqual(await p.locator('#figure-model option').evaluateAll(list => list.map(o => [o.dataset.connection, o.value])), [['local', 'gemma3:12b']]);
    // The model chip sits under the question box, so choosing it can scroll the dialog: bring the page back.
    await p.locator('.figure-scroll').evaluate(n => n.scrollIntoView({ block: 'start' })); const box = await p.locator('.figure-canvas').boundingBox(); await p.mouse.move(box.x + 30, box.y + 20); await p.mouse.down(); await p.mouse.move(box.x + 250, box.y + 160, { steps: 8 }); await p.mouse.up();
    await p.locator('[data-action="figure-send"]').click(); await p.locator('#figure-status').filter({ hasText: '설명 완료' }).waitFor();
    assert.match(await p.locator('#figure-result').innerText(), /로컬 모델의 그림 설명/);
    const figure = fake.requests.filter(r => r.url === '/api/chat').at(-1).body;
    assert.equal(figure.model, 'gemma3:12b'); assert.match(figure.messages[1].images[0], /^iVBOR/, 'a PNG image without the data URL prefix');
    // Saved as an annotation (주석 tab): its card opens with the live editor, and the source page gets a
    // figure pin at the box that opens the card.
    const before = await p.locator('.original-pages').evaluate(c => { c.scrollTop = 120; return c.scrollTop; });
    await p.locator('#dialog [data-action="figure-save"]').click(); await p.locator('.memo-card.annot.open .field-live').waitFor();
    assert.equal(await p.locator('.original-pages').evaluate(c => c.scrollTop), before, 'saving keeps the pages where they were');
    const figurePin = p.locator('.original-pages .figure-pin[data-annotation-pin]'); await figurePin.waitFor();
    assert.equal(await figurePin.count(), 1, 'one pin for the saved figure');
    const annotationId = await figurePin.getAttribute('data-annotation-pin');
    const saved = await p.evaluate(id => itemAnnotations.find(a => a.id === id), annotationId);
    assert.equal(saved.kind, 'figure'); assert.equal(saved.page, 1); assert.equal(saved.model, 'gemma3:12b'); assert.ok(saved.figure.width > 0.05 && saved.figure.height > 0.05, 'the figure box is kept with the annotation');
    assert.equal(await p.evaluate(() => Object.keys(notes).some(k => k.endsWith('#figure'))), false, 'no figure memo');
    assert.equal(await p.locator('.original-pages .figure-area').count(), 0, 'figure pins draw no dashed box');
    await p.locator('[data-tab="요약"]').click(); // Pressed with the mouse where it is (a locator click would first scroll it into view itself).
    const atPin = await p.locator('.original-pages').evaluate(c => { c.scrollTop = 8; return c.scrollTop; }); { const b = await figurePin.boundingBox(); await p.mouse.click(b.x + b.width / 2, b.y + b.height / 2); }
    await p.locator(`.memo-card.annot[data-annotation-card="${annotationId}"].open`).waitFor();
    assert.equal(await p.locator('.original-pages').evaluate(c => c.scrollTop), atPin, 'the figure pin opens its card without moving the pages');
    if (process.env.APP_LOCAL_SCREENSHOT) await p.screenshot({ path: process.env.APP_LOCAL_SCREENSHOT + '-figure-memo.png' });
    // Deleting the annotation removes its pin.
    await p.locator(`.memo-card.annot.open [data-delete-annotation="${annotationId}"]`).click(); await p.locator('#dialog [data-action="confirm-annotation-delete"]').click(); await figurePin.waitFor({ state: 'detached' });
    // A page the local model translated can be re-translated with ChatGPT; the dialog names the page's current model.
    await app.evaluate(({ app }) => { process.getBuiltinModule('module').createRequire(app.getAppPath() + '/package.json')('./desktop/chatgpt.cjs').ChatGPT.prototype.translate = async (_m, blocks) => blocks.map(b => ({ id: b.id, text: 'ChatGPT로 다시 번역한 문단입니다.' })); });
    const pageRetry = p.locator('[data-retranslate-page="1"]'); await pageRetry.hover(); await pageRetry.click();
    await p.locator('#dialog').filter({ hasText: '지금 이 페이지는 로컬 모델 · qwen2.5:14b (14.8B Q4_K_M)(으)로 번역돼 있습니다' }).waitFor();
    assert.equal(await p.locator('#gpt-model').inputValue(), 'qwen2.5:14b', 'the page model is chosen first');
    await pick('gpt-model', 'gpt-web'); await p.locator('#dialog [data-action="gpt-start"]').click();
    await p.locator('[data-page="1"] .translated-block').filter({ hasText: 'ChatGPT로 다시 번역한 문단입니다.' }).first().waitFor(); await p.locator('[data-action="gpt-export"]').waitFor();
    const mixed = JSON.parse(await fs.readFile(path.join(vault, appName.vaultDir, recordFile), 'utf8'));
    assert.deepEqual(mixed.pages.map(page => page.translatedBy), [{ connection: 'gpt-web', model: 'fixture-model' }, { connection: 'local', model: 'qwen2.5:14b' }]);
    assert.match(mixed.pages[1].blocks.find(b => b.translation).translation, /로컬 모델이 번역한/, 'the other page keeps its local translation');
    console.log('Local LLM smoke passed: off by default, address check, remote confirmation, translation without ChatGPT, grouped model list, AI help, image-only figure models, figure memo chip icons and source-page figure pins, and page re-translation with another model on a simulated Ollama server.');
  } finally { await app.close().catch(() => {}); fake.server.close(); await fs.rm(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }).catch(error => console.warn(`임시 폴더를 다 지우지 못했습니다(${error.code}). 테스트 결과와는 무관합니다: ${temp}`)); }
})().catch(error => { console.error(error); process.exit(1); });
