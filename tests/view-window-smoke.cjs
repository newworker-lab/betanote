// End-to-end check in the real Electron app (APP_TEST_SOURCE=1 runs the source): 원문 새 창 (and
// 번역 새 창, with a stub model's translation) opens the app's own reader with that pane alone (its tools, search and pages, at the
// page being read), not the browser's PDF viewer. The window only reads: nothing that writes the
// vault reaches it, its selection menu offers copying only, and the place read last stays as
// the main window set it. Asking again brings the same window forward.
const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { PDFDocument, StandardFonts } = require('pdf-lib');
const appName = require('../core/app-name.cjs');
const toolShown = require('./tool-row.cjs'); // a tool a narrow pane keeps under ⋯ is brought out before it is used
const root = path.resolve(__dirname, '..');
(async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), `${appName.id}-view-e2e-`)), vault = path.join(temp, 'vault'); await fs.mkdir(vault);
  const doc = await PDFDocument.create(), font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= 4; i++) doc.addPage([600, 800]).drawText(`Page ${i} of the paper holds a sentence to read and to search for, word${i}.`, { x: 40, y: 740, size: 12, font });
  await fs.writeFile(path.join(vault, 'paper.pdf'), await doc.save({ useObjectStreams: false }));
  const executable = require('./app-executable.cjs')(root);
  let app;
  try {
    app = await electron.launch({ executablePath: executable, args: [...(process.env.APP_TEST_SOURCE === '1' ? [root] : []), '--no-sandbox', '--ozone-platform=headless', '--disable-gpu', `--user-data-dir=${path.join(temp, 'profile')}`], timeout: 20000 });
    const p = await app.firstWindow(); p.setDefaultTimeout(20000);
    p.on('pageerror', e => { console.error(e); process.exitCode = 1; });
    await app.evaluate(({ app, dialog }, v) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [v] });
      const { ChatGPT } = process.getBuiltinModule('module').createRequire(app.getAppPath() + '/package.json')('./desktop/chatgpt.cjs');
      ChatGPT.prototype.status = () => ({ connected: true, usable: true, email: 'fixture@example.test', persistent: false });
      ChatGPT.prototype.models = async () => [{ id: 'fixture-model', name: 'Fixture GPT' }];
      ChatGPT.prototype.translate = async (_m, blocks) => blocks.map(b => ({ id: b.id, text: '번역된 문장입니다.' }));
    }, vault);
    await p.locator('[data-action="storage"]').first().click(); await p.locator('.paper-item').click();
    await p.locator('.original-pages .page[data-page-number="1"] .textLayer span').first().waitFor();
    await p.evaluate(() => { document.querySelector('.original-pages').pdfViewer.currentPageNumber = 3; }); await p.waitForTimeout(600);
    const place = await p.evaluate(() => JSON.stringify(Object.entries(localStorage).filter(([k]) => /read/i.test(k))));
    const problems = [], watch = w => { w.on('pageerror', e => problems.push(String(e.message))); w.on('console', m => { if (/허용되지 않은/.test(m.text())) problems.push(m.text()); }); };
    app.on('window', watch);
    const [child] = await Promise.all([app.waitForEvent('window'), p.locator('.original-pane .pane-window').click()]);
    await child.waitForLoadState(); await child.setViewportSize({ width: 1000, height: 1000 }).catch(() => {});
    await child.locator('.original-pages .page .textLayer span').first().waitFor({ timeout: 30000 }); await child.waitForTimeout(1500);
    const info = await child.evaluate(() => ({ url: location.href.split('?')[0].split('/').pop(), viewOnly: document.body.classList.contains('view-window'), title: document.title, page: document.querySelector('.original-pages').pdfViewer.currentPageNumber, pages: document.querySelector('.original-pages').pdfViewer.pagesCount,
      tools: Boolean(document.querySelector('.source-tools .pdf-find-input') && document.querySelector('.source-tools [data-reader-fit]') && document.querySelector('.source-tools .pdf-page-input')),
      hidden: ['.sidebar', '#notes-panel', '.reader-mode-toolbar', '.pane-window', '.topbar', '.reader-view-modes'].map(s => { const n = document.querySelector(s); return !n || getComputedStyle(n).display === 'none'; }),
      height: document.querySelector('.original-pages').getBoundingClientRect().height }));
    assert.equal(info.url, 'index.html', 'the app\'s own page, not the PDF file in the browser\'s viewer'); assert.equal(info.viewOnly, true); assert.match(info.title, /^원문 · paper/);
    assert.equal(info.page, 3, 'at the page being read'); assert.equal(info.pages, 4); assert.equal(info.tools, true, 'the pane\'s tools are there');
    assert.deepEqual(info.hidden, [true, true, true, true, true, true], 'nothing around the pane'); assert.ok(info.height > 600, 'the pages fill the window: ' + info.height);
    // Search works there as in the main window.
    await (await toolShown(child, '.pdf-find-input')).fill('word4'); await (await toolShown(child, '.pdf-find-input')).press('Enter');
    await child.waitForFunction(() => document.querySelector('.original-pages').pdfViewer.currentPageNumber === 4, null, { timeout: 15000 });
    // It only reads: a write is refused by the app, the selection menu offers copying only, no writing tool is taken up.
    const refused = await child.evaluate(async () => { try { await window.appApi.addAnnotation(state.storageKey, state.selected, state.selectedAttachment, { page: 1, quote: 'x', body: 'y', sourceHash: 'z' }); return 'written'; } catch (e) { return String(e.message); } });
    assert.match(refused, /허용되지 않은 요청/);
    const menu = await child.evaluate(() => { const span = document.querySelector('.original-pages .page[data-page-number="4"] .textLayer span'), range = document.createRange(); range.selectNodeContents(span); const s = getSelection(); s.removeAllRanges(); s.addRange(range); inkShowTextBar(); inkSetTool('pen'); return { items: [...document.querySelectorAll('.ink-text-menu [data-ink-text]')].map(b => b.dataset.inkText), tool: inkState.tool }; });
    assert.deepEqual(menu.items, ['copy']); assert.equal(menu.tool, 'read');
    // The main window's place is as it was, and the same window comes forward when asked again.
    assert.equal(await p.evaluate(() => JSON.stringify(Object.entries(localStorage).filter(([k]) => /read/i.test(k)))), place);
    await p.locator('.original-pane .pane-window').click(); await p.waitForTimeout(800); assert.equal(app.windows().length, 2);
    assert.deepEqual(problems, [], 'no error in the window, and no request of its own was refused');
    // The translation opens the same way: the app's reader with the translated pane alone, read-only.
    await p.locator('[data-mode="translated"]').click(); await p.locator('#gpt-model').waitFor({ state: 'attached' }); await p.locator('[data-action="gpt-start"]').click();
    await p.locator('[data-action="gpt-export"]').waitFor({ timeout: 60000 }); await p.locator('.translated-pane .translation-layer[data-ready="true"]').first().waitFor();
    await p.evaluate(() => goToPage(3)); await p.waitForTimeout(500);
    const [second] = await Promise.all([app.waitForEvent('window'), p.locator('[data-view-window="translation"]').click()]);
    await second.waitForLoadState(); await second.setViewportSize({ width: 1000, height: 1000 }).catch(() => {});
    assert.match(second.url(), /index\.html\?.*viewWindow=translation.*page=3/);
    await second.locator('.translated-pane .translation-layer[data-ready="true"]').first().waitFor({ timeout: 30000 });
    await second.waitForFunction(() => Number(currentSheet(document.querySelector('.translated-pane .translated-pages'))?.dataset.page) === 3, null, { timeout: 15000 });
    const shown = await second.evaluate(() => ({ title: document.title, text: document.querySelector('.translated-pane .translated-block .translation-content')?.textContent || '',
      hidden: ['[data-action="gpt-retranslate"]', '[data-action="gpt-export"]', '.translation-quality', '.sidebar', '#notes-panel', '.pane-window'].map(s => { const n = document.querySelector(s); return !n || getComputedStyle(n).display === 'none'; }),
      nav: Boolean(document.querySelector('.translated-pane .pdf-page-input')) }));
    assert.match(shown.title, /^번역 · paper/); assert.match(shown.text, /번역된 문장/); assert.deepEqual(shown.hidden, [true, true, true, true, true, true]); assert.equal(shown.nav, true);
    const denied = await second.evaluate(async () => { try { await window.appApi.startTranslation(state.storageKey, state.selected, 'h', [], 'fixture-model', {}); return 'started'; } catch (e) { return String(e.message); } });
    assert.match(denied, /허용되지 않은 요청/);
    assert.equal(await second.evaluate(async () => { await ensureTranslation(true); return /보기 전용/.test(document.querySelector('#toast').textContent) && !dialog.open; }), true, 'asking to translate there says the window only reads');
    assert.deepEqual(problems, [], 'no error in either window, and no request of their own was refused');
    console.log('View window smoke passed: the original and the translation open in the app\'s own reader at the page being read, with their tools, read-only, one window each.');
  } finally { await app?.close().catch(() => {}); await fs.rm(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }).catch(() => {}); }
})().catch(error => { console.error(error); process.exit(1); });
