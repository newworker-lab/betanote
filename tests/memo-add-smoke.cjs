// End-to-end check of 메모 추가 in the reader's tool row (renderer.js readerStatusControl, ink.js inkArmMemoPin): it sits
// left of 그림 설명; pressed, the pages wait for a pin (pressed button, crosshair, a hint); Esc stops that and leaves no
// memo; pressed again and a source page clicked, a new memo is pinned there and opens in the memo tab (the panel opened)
// with the cursor in it, and what is typed is saved; on a notebook page the same; after a restart the pin and the memo
// are there. In English at 800px the tool row fits. APP_TEST_SOURCE=1 runs the source; APP_PHOTO_DIR keeps pictures.
const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { PDFDocument, StandardFonts } = require('pdf-lib');
const appName = require('../core/app-name.cjs');
const root = path.resolve(__dirname, '..');
(async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), `${appName.id}-memo-add-e2e-`)), vault = path.join(temp, 'vault'); await fs.mkdir(vault);
  const doc = await PDFDocument.create(), font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= 2; i++) doc.addPage([600, 800]).drawText(`Page ${i} of a research paper.`, { x: 40, y: 740, size: 14, font });
  await fs.writeFile(path.join(temp, 'paper.pdf'), await doc.save());
  const env = /utf-?8/i.test(process.env.LC_ALL || process.env.LANG || '') ? process.env : { ...process.env, LC_ALL: 'C.UTF-8', LANG: 'C.UTF-8' };
  const photo = async (p, name) => { if (process.env.APP_PHOTO_DIR) await p.screenshot({ path: path.join(process.env.APP_PHOTO_DIR, name) }); };
  let app;
  const launch = async (lang = 'ko', width = 1400) => {
    app = await electron.launch({ env: { ...env, APP_UI_LANG: lang }, executablePath: require('./app-executable.cjs')(root), args: [...(process.env.APP_TEST_SOURCE === '1' ? [root] : []), '--no-sandbox', '--ozone-platform=headless', '--disable-gpu', `--user-data-dir=${path.join(temp, 'profile')}`], timeout: 20000 });
    const p = await app.firstWindow(); p.setDefaultTimeout(15000); await p.setViewportSize({ width, height: 900 });
    p.on('pageerror', e => { console.error(e); process.exitCode = 1; });
    await app.evaluate(({ dialog }) => { globalThis.openQueue = []; dialog.showOpenDialog = async () => ({ canceled: false, filePaths: globalThis.openQueue.shift() }); });
    return p;
  };
  const memos = p => p.evaluate(() => memoKeysOf(state.selected).length);
  const reader = async p => { await p.locator('.shell').waitFor(); if (await p.evaluate(() => state.screen !== 'reader')) await p.locator('.paper-item').first().click(); await p.locator('.original-pages .page[data-page-number="1"] canvas').first().waitFor(); };
  try {
    let p = await launch();
    await app.evaluate((_, v) => globalThis.openQueue.push([v]), vault); await p.locator('[data-action="storage"]').first().click();
    await app.evaluate((_, f) => globalThis.openQueue.push([f]), path.join(temp, 'paper.pdf')); await p.locator('[data-action="add-files"]').first().click();
    await p.locator('.paper-item').first().click(); await reader(p);
    // Its place: right before 그림 설명.
    assert.deepEqual(await p.locator('.reader-annotate .pdf-tool').evaluateAll(list => list.map(b => b.dataset.action)), ['memo-pin-new', 'figure-open', 'new-annotation']);
    const add = p.locator('.reader-annotate [data-action="memo-pin-new"]');
    assert.equal(await add.textContent(), '메모 추가');
    await p.evaluate(() => { state.rightCollapsed = true; render(); }); await reader(p);
    const before = await memos(p);
    // 1. Pressed: waiting for a pin. Esc: no memo is left.
    await add.click(); assert.equal(await add.getAttribute('aria-pressed'), 'true');
    assert.ok(await p.evaluate(() => document.body.classList.contains('memo-pin-arming')), 'the pages wait for a pin');
    await p.locator('#toast').filter({ hasText: '핀을 꽂을 곳을 누르세요' }).waitFor();
    assert.equal(await p.locator('.original-pages .page[data-page-number="1"]').evaluate(n => getComputedStyle(n).cursor), 'crosshair');
    await photo(p, 'memo-add-armed.png');
    await p.keyboard.press('Escape');
    assert.equal(await add.getAttribute('aria-pressed'), 'false'); assert.equal(await memos(p), before, 'Esc: no memo left');
    // A second press stops waiting as well.
    await add.click(); await add.click(); assert.equal(await p.evaluate(() => document.body.classList.contains('memo-pin-arming')), false);
    // 2. Pressed and a page clicked: a memo pinned there, open in the memo tab with the cursor in it.
    await add.click(); const page1 = p.locator('.original-pages .page[data-page-number="1"]'), box = await page1.boundingBox();
    await p.mouse.click(box.x + box.width * .3, box.y + box.height * .4);
    await p.locator('.memo-card.open .field-live .cm-content').waitFor();
    const key = await p.evaluate(() => document.querySelector('.memo-card.open').dataset.memo), place = await p.evaluate(k => JSON.parse(notes[k + '#pin']), key);
    assert.equal(await memos(p), before + 1); assert.equal(place.page, 1); assert.ok(Math.abs(place.x - .3) < .02 && Math.abs(place.y - .4) < .02, `pinned where clicked (${place.x}, ${place.y})`);
    assert.ok(await p.evaluate(() => !state.rightCollapsed && state.tab === '메모' && !!document.querySelector('.reader-panel .memo-card.open')), 'the panel opened on the memo tab'); // i18n:keep — tab value
    await p.waitForFunction(() => !!document.activeElement?.closest('.memo-card.open .field-live'));
    await p.keyboard.type('핀으로 만든 메모'); await p.waitForFunction(k => notes[k] === '핀으로 만든 메모', key);
    await p.locator(`.original-pages [data-memo-pin-open="${key}"]`).waitFor(); await photo(p, 'memo-add-pinned.png');
    // 3. On a notebook page: the same.
    await p.locator('[data-mode="notebook"]').click(); await p.locator('.notebook-pane [data-action="nb-new"]').first().click();
    await p.locator('#nb-title').fill('핀 노트'); await p.locator('#dialog [data-action="nb-create"]').click(); await p.locator('.nb-page').first().waitFor();
    await add.click(); const nbBox = await p.locator('.nb-page').first().boundingBox(); await p.mouse.click(nbBox.x + nbBox.width * .5, nbBox.y + 120);
    await p.locator('.memo-card.open .field-live .cm-content').waitFor();
    const nbKey = await p.evaluate(() => document.querySelector('.memo-card.open').dataset.memo);
    assert.notEqual(nbKey, key); assert.equal(await p.evaluate(k => JSON.parse(notes[k + '#pin']).notebookId, nbKey), await p.evaluate(() => nb.doc.id), 'pinned on the notebook page');
    await p.waitForFunction(() => !!document.activeElement?.closest('.memo-card.open .field-live'));
    await p.keyboard.type('노트북 핀 메모'); await p.waitForFunction(k => notes[k] === '노트북 핀 메모', nbKey);
    await p.evaluate(() => desktopNotes()); await app.close();
    // 4. After a restart: the pin and the memo.
    p = await launch(); await reader(p);
    await p.locator('[data-mode="original"]').click().catch(() => {});
    await p.locator(`.original-pages [data-memo-pin-open="${key}"]`).waitFor(); assert.equal(await p.evaluate(k => notes[k], key), '핀으로 만든 메모');
    await app.close(); app = null;
    // 5. English at 800px: the tool row fits.
    p = await launch('en', 800); await reader(p);
    const fit = await p.evaluate(() => { const bar = document.querySelector('.reader-mode-toolbar'), b = bar.getBoundingClientRect(); return { label: document.querySelector('[data-action="memo-pin-new"]').getAttribute('aria-label'), inside: [...bar.querySelectorAll('.reader-annotate .pdf-tool')].every(t => { const r = t.getBoundingClientRect(); return r.right <= b.right + 1 && r.left >= b.left - 1; }), over: bar.scrollWidth - bar.clientWidth }; });
    assert.deepEqual(fit, { label: 'Add memo', inside: true, over: 0 }, 'fits in English at 800px');
    await photo(p, 'memo-add-en-800.png');
    await app.close(); app = null;
    console.log('Memo add smoke passed: 메모 추가 left of 그림 설명; pressed, a pin is awaited and Esc leaves no memo; a click on a source or notebook page pins a new memo there, opened in the memo tab with the cursor in it, and the text is saved; kept after a restart; the tool row fits in English at 800px.');
  } catch (error) { console.error(error); process.exitCode = 1; try { await (await app?.firstWindow())?.screenshot({ path: path.join(os.tmpdir(), `${appName.id}-memo-add-failure.png`) }); } catch {} }
  finally { await app?.close().catch(() => {}); await fs.rm(temp, { recursive: true, force: true }); }
})();
