// End-to-end check of the vault's AI requests (저장소 관리 › AI, library.json aiRules) with a simulated model: written and
// saved in the vault manager, kept after a restart, and sent after the app's instructions with the memo AI, the summary,
// a question about the paper and 그림 설명, not with tag suggestions; the memo AI's notice says they go with it. In English
// at 800px the vault manager's tabs fit. APP_TEST_SOURCE=1 runs the source; APP_PHOTO_DIR keeps pictures.
const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { PDFDocument, StandardFonts } = require('pdf-lib');
const appName = require('../core/app-name.cjs');
const root = path.resolve(__dirname, '..');
const RULES = '수식은 LaTeX($…$)로 써 주세요.';
(async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), `${appName.id}-ai-rules-e2e-`)), vault = path.join(temp, 'vault'); await fs.mkdir(vault);
  const doc = await PDFDocument.create(), font = await doc.embedFont(StandardFonts.Helvetica);
  for (const text of ['We study how layout affects reading speed.', 'Reading speed rose by twelve percent.']) doc.addPage([600, 800]).drawText(text, { x: 40, y: 700, size: 12, font });
  await fs.writeFile(path.join(temp, 'study.pdf'), await doc.save());
  const env = /utf-?8/i.test(process.env.LC_ALL || process.env.LANG || '') ? process.env : { ...process.env, LC_ALL: 'C.UTF-8', LANG: 'C.UTF-8' };
  const photo = async (p, name) => { if (process.env.APP_PHOTO_DIR) await p.locator('#dialog').screenshot({ path: path.join(process.env.APP_PHOTO_DIR, name) }); };
  let app;
  const launch = async (lang = 'ko', width = 1300) => {
    app = await electron.launch({ env: { ...env, APP_UI_LANG: lang }, executablePath: require('./app-executable.cjs')(root), args: [...(process.env.APP_TEST_SOURCE === '1' ? [root] : []), '--no-sandbox', '--ozone-platform=headless', '--disable-gpu', `--user-data-dir=${path.join(temp, 'profile')}`], timeout: 20000 });
    const p = await app.firstWindow(); p.setDefaultTimeout(15000); await p.setViewportSize({ width, height: 900 });
    p.on('pageerror', e => { console.error(e); process.exitCode = 1; });
    await app.evaluate(({ app, dialog }) => {
      globalThis.openQueue = []; dialog.showOpenDialog = async () => ({ canceled: false, filePaths: globalThis.openQueue.shift() });
      const { ChatGPT } = process.getBuiltinModule('module').createRequire(app.getAppPath() + '/package.json')('./desktop/chatgpt.cjs');
      globalThis.sent = [];
      ChatGPT.prototype.status = () => ({ connected: true, usable: true, email: 'fixture@example.test', persistent: false });
      ChatGPT.prototype.models = async () => [{ id: 'fixture-model', name: 'Fixture GPT' }];
      // Keeps what each request was told; answers in the shape each one asks for.
      ChatGPT.prototype.respond = async (_model, input, instructions) => {
        const body = (() => { try { return JSON.parse(typeof input[0].content === 'string' ? input[0].content : input[0].content[0].text); } catch { return {}; } })();
        const kind = /Suggest tags/.test(instructions) ? 'tags' : /Explain the selected research figure/.test(instructions) ? 'figure' : /Summarize/.test(instructions) ? 'summary' : body.paperSample ? 'keywords' : body.evidence && body.question ? 'ask' : 'memo';
        globalThis.sent.push({ kind, instructions });
        const first = (body.blocks || body.evidence || [])[0]?.id;
        if (kind === 'tags') return JSON.stringify({ tags: [{ name: 'layout', reason: 'r' }] });
        if (kind === 'figure') return '그래프 설명';
        if (kind === 'summary') return JSON.stringify({ question: [{ text: '레이아웃', basis: 'paper', evidence: [first] }] });
        if (kind === 'keywords') return JSON.stringify({ keywords: ['layout'] });
        if (kind === 'ask') return JSON.stringify({ answer: [{ text: '12%', basis: 'paper', evidence: [first] }], insufficient: false });
        return '메모 답';
      };
    });
    return p;
  };
  try {
    let p = await launch();
    await app.evaluate((_, v) => globalThis.openQueue.push([v]), vault); await p.locator('[data-action="storage"]').first().click();
    await app.evaluate((_, f) => globalThis.openQueue.push([f]), path.join(temp, 'study.pdf')); await p.locator('[data-action="add-files"]').first().click();
    await p.locator('.paper-item').first().click(); await p.locator('.original-pages .page[data-page="1"] canvas').first().waitFor();
    // 1. Written and saved in 저장소 관리 › AI (its own tab, after 번역); the tab is marked while there are requests.
    await p.locator('[data-action="vault-manager"]').first().click(); await p.locator('[data-vm-tab="ai"]').click();
    assert.deepEqual(await p.locator('[data-vm-tab]').evaluateAll(tabs => tabs.slice(0, 2).map(t => t.dataset.vmTab)), ['translation', 'ai'], 'AI follows 번역');
    await p.locator('#ai-rules-text').fill(RULES); await p.locator('[data-action="ai-rules-save"]').click();
    await p.locator('#toast').filter({ hasText: 'AI 요청 사항을 저장했습니다' }).waitFor(); await p.locator('[data-vm-tab="ai"] .vm-dot').waitFor();
    await photo(p, 'ai-rules-vault-manager.png'); await p.evaluate(() => dialog.close());
    // 2. Kept after a restart.
    await app.close(); p = await launch(); await p.locator('.shell').waitFor(); if (await p.evaluate(() => state.screen !== 'reader')) await p.locator('.paper-item').first().click();
    await p.locator('.original-pages .page[data-page="1"] canvas').first().waitFor();
    await p.locator('[data-action="vault-manager"]').first().click(); await p.locator('[data-vm-tab="ai"]').click();
    assert.equal(await p.locator('#ai-rules-text').inputValue(), RULES, 'kept after a restart'); await p.evaluate(() => dialog.close());
    // 3. The memo AI's notice says the requests go with it.
    await p.locator('[data-tab="메모"]').first().click().catch(() => {}); await p.locator('.memo-tab [data-action="memo-new"]').first().click();
    await p.locator('.memo-card.open [data-memo-wide]').first().click(); await p.locator('.note-editor-body').waitFor(); await p.locator('[data-editor-ai]').first().click();
    await p.waitForFunction(() => /저장소의 AI 요청 사항도 함께 보냅니다/.test(document.querySelector('#editor-ai-model-notice')?.textContent || ''));
    await p.evaluate(() => dialog.close());
    // 4. Each request as the app sends it: the requests after the app's instructions, except for tag suggestions.
    const sent = await p.evaluate(async () => {
      const paper = selected(), at = activeAttachment(paper), hash = await window.appApi.originalHash(state.storageKey, paper.id, at.id);
      const blocks = [{ id: 'p1-b1', page: 1, text: 'We study how layout affects reading speed.' }, { id: 'p2-b1', page: 2, text: 'Reading speed rose by twelve percent.' }];
      const png = (() => { const c = document.createElement('canvas'); c.width = 20; c.height = 10; c.getContext('2d').fillRect(0, 0, 10, 10); return c.toDataURL('image/png'); })();
      await window.appApi.aiMemo(state.storageKey, paper.id, 'fixture-model', { connection: 'gpt-web', mode: 'ask', memo: '메모', instruction: '정리해 줘' });
      await window.appApi.aiRun(state.storageKey, paper.id, at.id, 'summary', 'fixture-model', { connection: 'gpt-web', sourceHash: hash, blocks });
      await window.appApi.aiRun(state.storageKey, paper.id, at.id, 'ask', 'fixture-model', { connection: 'gpt-web', sourceHash: hash, blocks, question: 'layout reading speed' });
      await window.appApi.explainFigure(state.storageKey, paper.id, at.id, hash, 'fixture-model', png, { connection: 'gpt-web', page: 1, question: '', caption: '' });
      await window.appApi.aiTags(state.storageKey, paper.id, at.id, 'fixture-model', { connection: 'gpt-web', sourceHash: hash, blocks });
      return true;
    }).then(() => app.evaluate(() => globalThis.sent));
    const kinds = sent.map(s => s.kind);
    for (const kind of ['memo', 'summary', 'ask', 'figure', 'tags']) assert.ok(kinds.includes(kind), `${kind} was asked (${kinds})`);
    for (const s of sent) {
      const has = s.instructions.includes(RULES); // keywords: the question's own search words, sent with it like the question
      assert.equal(has, s.kind !== 'tags', `${s.kind}: ${s.kind === 'tags' ? 'no requests' : 'the requests'} in what was sent`);
      if (has) assert.ok(s.instructions.indexOf(RULES) > s.instructions.indexOf('</reader requests>') - RULES.length - 2 && /come first when they disagree/.test(s.instructions), `${s.kind}: after the app's instructions, which win`);
    }
    await app.close(); app = null;
    // 5. English at 800px: the vault manager's tabs fit, the AI tab reads in English.
    p = await launch('en', 800); await p.locator('.shell').waitFor();
    await p.locator('[data-action="vault-manager"]').first().click(); await p.locator('[data-vm-tab="ai"]').click();
    const fit = await p.evaluate(() => { const nav = document.querySelector('.vm-tabs'), d = document.querySelector('#dialog').getBoundingClientRect(); return { inside: [...nav.querySelectorAll('[data-vm-tab]')].every(t => { const r = t.getBoundingClientRect(); return r.right <= d.right + 1 && r.left >= d.left - 1 && t.scrollWidth <= t.clientWidth + 1; }), wraps: nav.scrollWidth <= nav.clientWidth + 1, text: document.querySelector('.ai-rules-section h3').textContent }; });
    assert.deepEqual(fit, { inside: true, wraps: true, text: 'AI requests' }, 'the tabs fit in English at 800px');
    await photo(p, 'ai-rules-en-800.png');
    await app.close(); app = null;
    console.log('AI rules smoke passed: saved in 저장소 관리 › AI and kept after a restart; sent after the app\'s instructions with the memo AI, a summary, a question and 그림 설명, not with tag suggestions; the memo AI\'s notice says so; the tabs fit in English at 800px.');
  } catch (error) { console.error(error); process.exitCode = 1; try { await (await app?.firstWindow())?.screenshot({ path: path.join(os.tmpdir(), `${appName.id}-ai-rules-failure.png`) }); } catch {} }
  finally { await app?.close().catch(() => {}); await fs.rm(temp, { recursive: true, force: true }); }
})();
