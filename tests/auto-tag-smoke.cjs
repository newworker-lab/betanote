// End-to-end check of AI 태그 추천 in the real Electron app (APP_TEST_SOURCE=1 runs the source):
// nothing is sent before the confirmation, the vault's tags are offered first, and only the
// tags the user keeps are added. The model is a stand-in; this says nothing about real tag quality.
const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { PDFDocument, StandardFonts } = require('pdf-lib');
const appName = require('../core/app-name.cjs');
const root = path.resolve(__dirname, '..');
(async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), `${appName.id}-tag-e2e-`)), vault = path.join(temp, 'vault'); await fs.mkdir(vault);
  for (const [name, text] of [['fault.pdf', 'Unsupervised fault detection with LSTM autoencoders in batch processes.'], ['other.pdf', 'A study of reading layouts.']]) {
    const doc = await PDFDocument.create(), font = await doc.embedFont(StandardFonts.Helvetica); doc.addPage([600, 800]).drawText(text, { x: 40, y: 740, size: 12, font });
    await fs.writeFile(path.join(vault, name), await doc.save());
  }
  const executable = require('./app-executable.cjs')(root);
  let app;
  try {
    app = await electron.launch({ executablePath: executable, args: [...(process.env.APP_TEST_SOURCE === '1' ? [root] : []), '--no-sandbox', '--ozone-platform=headless', '--disable-gpu', `--user-data-dir=${path.join(temp, 'profile')}`], timeout: 20000 });
    const p = await app.firstWindow(); p.setDefaultTimeout(15000);
    p.on('pageerror', e => { console.error(e); process.exitCode = 1; }); p.on('console', m => { if (m.type() === 'error') console.error('renderer:', m.text()); });
    await app.evaluate(({ app, dialog }, folder) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] });
      const { ChatGPT } = process.getBuiltinModule('module').createRequire(app.getAppPath() + '/package.json')('./desktop/chatgpt.cjs');
      globalThis.requests = [];
      ChatGPT.prototype.status = () => ({ connected: true, usable: true, email: 'fixture@example.test', persistent: false });
      ChatGPT.prototype.models = async () => [{ id: 'fixture-model', name: 'Fixture GPT' }];
      ChatGPT.prototype.respond = async (_model, input, instructions) => { globalThis.requests.push({ body: JSON.parse(input[0].content), instructions });
        return JSON.stringify({ tags: [{ name: 'LSTM', reason: '모델 계열' }, { name: 'fault detection', reason: '저장소의 기존 주제' }, { name: '배치 공정', reason: '적용 분야' }, { name: 'reading', reason: '이미 있는 태그' }] }); };
    }, vault);
    await p.locator('[data-action="storage"]').first().click(); await p.locator('.paper-item').first().waitFor();
    // The vault already has "Fault Detection" (on the other paper) and this paper already has "reading".
    const ids = await p.evaluate(() => Object.fromEntries(papers.map(paper => [paper.title, paper.id])));
    const faultId = ids.fault, otherId = ids.other; assert.ok(faultId && otherId, JSON.stringify(ids));
    await p.evaluate(async ([a, b]) => { const id = state.storageKey; await window.appApi.batchUpdate(id, [b], { addTags: ['Fault Detection'] }); applyItemSnapshot(await window.appApi.batchUpdate(id, [a], { addTags: ['reading'] })); }, [faultId, otherId]);
    await p.locator(`.paper-item[data-paper="${faultId}"]`).click();
    await p.locator('.side-tabs button, [data-tab]').filter({ hasText: '태그' }).first().click();
    await p.locator(`[data-tag-ai="${faultId}"]`).click();
    // Confirmation first: nothing has been sent yet.
    await p.locator('#dialog h2').filter({ hasText: 'AI 태그 추천' }).waitFor(); await p.locator('#dialog [data-action="tag-ai-send"]').waitFor();
    assert.match(await p.locator('#dialog').textContent(), /앞부분 약 [\d,]+자/);
    assert.equal(await app.evaluate(() => globalThis.requests.length), 0);
    await p.locator('#dialog [data-action="tag-ai-send"]').click();
    await p.locator('.tag-ai-item').first().waitFor();
    const request = (await app.evaluate(() => globalThis.requests))[0];
    assert.deepEqual(request.body.existingTags.sort(), ['Fault Detection', 'reading']); assert.deepEqual(request.body.currentTags, ['reading']); assert.match(request.body.text, /LSTM autoencoders/);
    // The vault's own spelling comes first and is marked; the tag the paper has is not offered.
    const offered = await p.locator('.tag-ai-item').evaluateAll(nodes => nodes.map(n => [n.querySelector('.tag-name').textContent, n.querySelector('.pill').textContent]));
    assert.deepEqual(offered, [['Fault Detection', '기존 태그'], ['LSTM', '새 태그'], ['배치 공정', '새 태그']]);
    // Nothing is added until the user says so; an unticked suggestion stays out.
    assert.deepEqual(await p.evaluate(id => papers.find(x => x.id === id).tags, faultId), ['reading']);
    await p.locator('.tag-ai-item').filter({ hasText: '배치 공정' }).locator('input').uncheck();
    await p.locator('#dialog [data-action="tag-ai-apply"]').click();
    await p.waitForFunction(id => papers.find(x => x.id === id).tags.length === 3, faultId);
    assert.deepEqual((await p.evaluate(id => papers.find(x => x.id === id).tags, faultId)).sort(), ['Fault Detection', 'LSTM', 'reading']);
    const saved = JSON.parse(await fs.readFile(path.join(vault, appName.vaultDir, 'library.json'), 'utf8'));
    assert.deepEqual(saved.papers.find(x => x.id === faultId).tags.sort(), ['Fault Detection', 'LSTM', 'reading']);
    console.log('Auto-tag smoke passed: confirm before send, vault tags first, chosen tags only.');
  } finally { await app?.close().catch(() => {}); await fs.rm(temp, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exit(1); });
