// End-to-end check of making a new memo right on a notebook page (desktop/notebook.js): 메모 넣기 → 새 메모 만들어
// 넣기 makes a memo of the open paper and puts its card on the page, open, the cursor in its text; Markdown and $math$
// typed there show when the card is folded; the memo is in the 메모 tab; it is there after a restart; Ctrl+Z takes the
// card off (an empty memo goes with it, one with text stays); a notebook of no paper offers no such item and says why;
// the menu in English at 800px. APP_TEST_SOURCE=1 runs the source.
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
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), `${appName.id}-nb-memo-e2e-`)), vault = path.join(temp, 'vault'); await fs.mkdir(vault);
  const doc = await PDFDocument.create(), font = await doc.embedFont(StandardFonts.Helvetica); doc.addPage([600, 800]).drawText('A research paper connects ideas.', { x: 40, y: 740, size: 14, font });
  await fs.writeFile(path.join(temp, 'paper.pdf'), await doc.save());
  const env = /utf-?8/i.test(process.env.LC_ALL || process.env.LANG || '') ? process.env : { ...process.env, LC_ALL: 'C.UTF-8', LANG: 'C.UTF-8' };
  let app;
  const launch = async (lang = 'ko', width = 1300) => {
    app = await electron.launch({ env: { ...env, APP_UI_LANG: lang }, executablePath: require('./app-executable.cjs')(root), args: [...(process.env.APP_TEST_SOURCE === '1' ? [root] : []), '--no-sandbox', '--ozone-platform=headless', '--disable-gpu', `--user-data-dir=${path.join(temp, 'profile')}`], timeout: 20000 });
    const p = await app.firstWindow(); p.setDefaultTimeout(15000); await p.setViewportSize({ width, height: 900 });
    p.on('pageerror', e => { console.error(e); process.exitCode = 1; });
    await app.evaluate(({ dialog }) => { globalThis.openQueue = []; dialog.showOpenDialog = async () => ({ canceled: false, filePaths: globalThis.openQueue.shift() }); });
    return p;
  };
  const vaultNotes = async () => JSON.parse(await fs.readFile(path.join(vault, appName.vaultDir, 'library.json'), 'utf8')).notes;
  // After a restart the app opens where it was (the reader, or the list).
  const openNotebook = async p => { await p.locator('.paper-item, [data-mode="notebook"]').first().waitFor(); if (!await p.locator('[data-mode="notebook"]').count()) await p.locator('.paper-item').first().click(); await p.locator('[data-mode="notebook"]').click(); await p.locator('.nb-page').first().waitFor(); };
  const create = async p => { await (await toolShown(p, '.notebook-pane [data-action="nb-memo"]')).click(); await p.locator('.nb-memo-menu [data-action="nb-memo-create"]').click(); await p.locator('.nb-memo-card.open').waitFor(); };
  const cards = p => p.locator('.nb-page .nb-memo-card');
  try {
    let p = await launch();
    await app.evaluate((_, v) => globalThis.openQueue.push([v]), vault); await p.locator('[data-action="storage"]').first().click();
    await app.evaluate((_, f) => globalThis.openQueue.push([f]), path.join(temp, 'paper.pdf')); await p.locator('[data-action="add-files"]').first().click();
    await p.locator('.paper-item').first().click(); await p.locator('[data-mode="notebook"]').click(); await p.locator('.notebook-pane [data-action="nb-new"]').first().click();
    await p.locator('#nb-title').fill('메모 노트'); await p.locator('#dialog [data-action="nb-create"]').click(); await p.locator('.nb-page').first().waitFor();
    // 1. A new memo made on the page: its card open, the cursor in its text.
    await create(p);
    assert.equal(await p.evaluate(() => !!document.activeElement?.closest('.nb-memo-card.open')), true, 'the cursor is in the new card');
    await p.keyboard.type('**굵은 말** 과 $x^2$');
    const key = await p.locator('.nb-memo-card.open').getAttribute('data-nb-memo-key');
    assert.match(key, /^\d+-메모/);
    // Folded, the Markdown and the math show.
    await p.keyboard.press('Escape'); await p.locator('.nb-memo-card:not(.open)').waitFor();
    assert.equal(await p.locator('.nb-memo-card:not(.open) strong').filter({ hasText: '굵은 말' }).count(), 1, 'bold shows');
    assert.ok(await p.locator('.nb-memo-card:not(.open) .katex').count() > 0, 'math shows');
    // It is the paper's memo: in the 메모 tab and saved.
    await p.evaluate(() => desktopNotes());
    assert.match((await vaultNotes())[key], /\*\*굵은 말\*\*/);
    assert.ok(await p.evaluate(k => memoKeysOf(selected().id).includes(k), key), 'listed with the paper\'s memos');
    // 2. Ctrl+Z: an empty new memo's card goes and the memo with it.
    await create(p); const empty = await p.locator('.nb-memo-card.open').getAttribute('data-nb-memo-key');
    await p.keyboard.press('Escape'); await p.evaluate(() => document.activeElement?.blur());
    assert.equal(await cards(p).count(), 2);
    await p.keyboard.press('Control+z'); await p.waitForFunction(() => document.querySelectorAll('.nb-page .nb-memo-card').length === 1);
    assert.equal(await p.evaluate(k => k in notes, empty), false, 'the empty memo went with its card');
    // A memo with text stays when its card is taken off.
    await create(p); const kept = await p.locator('.nb-memo-card.open').getAttribute('data-nb-memo-key'); await p.keyboard.type('남길 메모');
    await p.keyboard.press('Escape'); await p.evaluate(() => document.activeElement?.blur());
    await p.keyboard.press('Control+z'); await p.waitForFunction(() => document.querySelectorAll('.nb-page .nb-memo-card').length === 1);
    assert.equal(await p.evaluate(k => notes[k], kept), '남길 메모', 'the memo stays in the 메모 tab');
    await p.evaluate(() => desktopNotes()); await p.waitForTimeout(800);
    // 3. A notebook of no paper: no new memo to make there, and why.
    await p.locator('.notebook-pane [data-action="nb-new"]').first().click(); await p.locator('#nb-title').fill('프로젝트'); await p.locator('#nb-project').check();
    await p.locator('#dialog [data-action="nb-create"]').click(); await p.waitForFunction(() => nb.doc?.title === '프로젝트' && nb.doc.paperId === null); await p.locator('.nb-page').first().waitFor();
    await (await toolShown(p, '.notebook-pane [data-action="nb-memo"]')).click(); await p.locator('.nb-memo-menu').waitFor();
    const item = p.locator('.nb-memo-menu [data-action="nb-memo-create"]');
    assert.ok(!await item.count() || (await item.isDisabled() && /[가-힣]/.test(await item.getAttribute('title'))), 'not offered in a notebook of no paper, with why');
    await p.keyboard.press('Escape');
    await app.close();
    // 4. After a restart: the card is on the page, folded, the memo shown.
    p = await launch(); await openNotebook(p);
    const notebooks = await p.evaluate(() => window.appApi.notebookList(state.storageKey));
    const own = notebooks.find(n => n.title === '메모 노트'); await p.locator('.notebook-pane .nb-select').selectOption(own.id).catch(() => {}); await p.locator('.nb-page').first().waitFor();
    await p.locator(`.nb-memo-card[data-nb-memo-key="${key}"] strong`).filter({ hasText: '굵은 말' }).waitFor();
    await app.close();
    // 5. English at 800px: the item is in English and the menu inside the window.
    p = await launch('en', 800); await openNotebook(p);
    await p.locator('.notebook-pane .nb-select').selectOption(own.id).catch(() => {}); await p.locator('.nb-page').first().waitFor();
    await (await toolShown(p, '.notebook-pane [data-action="nb-memo"]')).click(); await p.locator('.nb-memo-menu [data-action="nb-memo-create"]').waitFor();
    const text = await p.locator('.nb-memo-menu [data-action="nb-memo-create"]').evaluate(n => n.textContent + (n.title || ''));
    assert.doesNotMatch(text, /[가-힣]/, 'in English');
    assert.ok(await p.locator('.nb-memo-menu').evaluate(n => { const r = n.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth; }), 'inside the window');
    await app.close(); app = null;
    console.log('Notebook memo smoke passed: a new memo made on the page opens with the cursor in it, its Markdown and math show folded, it is the paper\'s memo, Ctrl+Z takes the card off (an empty memo with it), none in a notebook of no paper, kept after a restart, English at 800px.');
  } catch (error) { console.error(error); process.exitCode = 1; try { await (await app?.firstWindow())?.screenshot({ path: path.join(os.tmpdir(), `${appName.id}-nb-memo-failure.png`) }); } catch {} }
  finally { await app?.close().catch(() => {}); await fs.rm(temp, { recursive: true, force: true }); }
})();
