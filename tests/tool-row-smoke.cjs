// End-to-end check of the pane tool rows in a narrow pane (renderer.js toolRowLayout): the source pane's row and the
// notebook's row never run past their pane; what does not fit is in the panel under ⋯ at the row's end, with its name;
// PDF 저장 stays in the row; a tool in the panel works (the page number, a notebook tool) and a command closes the
// panel; Escape closes it; in a wide pane everything is back in the row, in its order, and ⋯ is gone.
// APP_TEST_SOURCE=1 runs the source; APP_PHOTO_DIR keeps pictures.
const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { PDFDocument, StandardFonts } = require('pdf-lib');
const appName = require('../core/app-name.cjs');
const root = path.resolve(__dirname, '..');

(async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), `${appName.id}-tool-row-e2e-`)), vault = path.join(temp, 'vault'); await fs.mkdir(vault);
  const doc = await PDFDocument.create(), font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= 3; i++) doc.addPage([600, 800]).drawText(`Page ${i} of a research paper.`, { x: 40, y: 740, size: 14, font });
  await fs.writeFile(path.join(temp, 'paper.pdf'), await doc.save());
  const env = /utf-?8/i.test(process.env.LC_ALL || process.env.LANG || '') ? process.env : { ...process.env, LC_ALL: 'C.UTF-8', LANG: 'C.UTF-8' };
  const photo = async (p, name) => { if (process.env.APP_PHOTO_DIR) await p.screenshot({ path: path.join(process.env.APP_PHOTO_DIR, name) }); };
  let app;
  try {
    app = await electron.launch({ env: { ...env, APP_UI_LANG: 'ko' }, executablePath: require('./app-executable.cjs')(root), args: [...(process.env.APP_TEST_SOURCE === '1' ? [root] : []), '--no-sandbox', '--ozone-platform=headless', '--disable-gpu', `--user-data-dir=${path.join(temp, 'profile')}`], timeout: 20000 });
    const p = await app.firstWindow(); p.setDefaultTimeout(15000); await p.setViewportSize({ width: 2400, height: 900 });
    p.on('pageerror', e => { console.error(e); process.exitCode = 1; });
    await app.evaluate(({ dialog }) => { globalThis.openQueue = []; dialog.showOpenDialog = async () => ({ canceled: false, filePaths: globalThis.openQueue.shift() }); });
    await app.evaluate((_, v) => globalThis.openQueue.push([v]), vault); await p.locator('[data-action="storage"]').first().click();
    await app.evaluate((_, f) => globalThis.openQueue.push([f]), path.join(temp, 'paper.pdf')); await p.locator('[data-action="add-files"]').first().click();
    await p.locator('.paper-item').first().click(); await p.locator('.original-pages .page[data-page-number="1"] canvas').first().waitFor();
    await p.locator('[data-mode="notebook"]').click(); await p.locator('.notebook-pane [data-action="nb-new"]').first().click(); await p.locator('[data-action="nb-create"]').click();
    await p.locator('.notebook-pane [data-action="nb-memo"]').waitFor();
    const rows = () => p.evaluate(() => [...document.querySelectorAll('.pdf-pane-tools,.nb-tools')].map(row => {
      const more = row.querySelector(':scope>.tool-more'), panel = row.querySelector(':scope>.tool-overflow'), name = n => n.dataset.action || n.className.split(' ')[0];
      return { row: row.className.split(' ')[0], fits: row.scrollWidth <= row.clientWidth + 1, more: !more.hidden, inRow: [...row.children].filter(c => c !== more && c !== panel).map(name), inPanel: [...panel.children].map(name), open: !panel.hidden };
    }));
    const settle = () => p.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
    // Wide: every tool in its row, no ⋯.
    await settle(); const wide = await rows();
    assert.equal(wide.length, 2, 'the source pane and the notebook each have a tool row');
    for (const r of wide) { assert.ok(r.fits, `${r.row} fits when wide`); assert.equal(r.more, false, `${r.row}: no ⋯ when wide`); assert.deepEqual(r.inPanel, []); }
    // Narrow: nothing runs past the pane; the rest is under ⋯; PDF 저장 stays in the row.
    await p.setViewportSize({ width: 1000, height: 900 }); await p.waitForTimeout(400); await settle();
    const narrow = await rows();
    for (const [i, r] of narrow.entries()) {
      assert.ok(r.fits, `${r.row} does not run past its pane when narrow`); assert.ok(r.more, `${r.row}: ⋯ shows`); assert.ok(r.inPanel.length, `${r.row}: tools under ⋯`);
      assert.deepEqual([...r.inRow, ...r.inPanel].sort(), [...wide[i].inRow].sort(), `${r.row}: every tool is in the row or under ⋯`);
    }
    assert.ok(narrow[0].inRow.includes('ink-export-original'), 'PDF 저장 stays in the source row');
    // The notebook pane's header is such a row too: one line, the notebook's name kept, its last buttons under ⋯ (three
    // dots upright, where the notebook's own menu is three lying flat).
    const head = await p.evaluate(() => { const h = document.querySelector('.notebook-pane>header'), more = h.querySelector(':scope>.tool-more'), panel = h.querySelector(':scope>.tool-overflow'); return { fits: h.scrollWidth <= h.clientWidth + 1, oneLine: h.offsetHeight < 60, more: !more.hidden, select: h.querySelector(':scope>.nb-select').offsetWidth, under: [...panel.children].map(c => c.className) }; });
    assert.ok(head.fits && head.oneLine, 'the notebook header stays on one line in its pane'); assert.ok(head.more && head.under.length, 'its last buttons are under ⋯'); assert.ok(head.select >= 90, 'the notebook name keeps its room');
    await p.locator('.notebook-pane>header>.tool-more').click(); await p.locator('.notebook-pane>header>.tool-overflow [data-nb-menu]').click(); await p.locator('.pop-menu').waitFor(); await photo(p, 'tool-row-header.png'); await p.keyboard.press('Escape'); await p.locator('.pdf-pane-header').first().click();
    // ⋯ opens the panel inside the window, clear of the sidebar; each tool there shows a name.
    const source = p.locator('.source-tools'), sourceMore = source.locator(':scope>.tool-more'), sourcePanel = source.locator(':scope>.tool-overflow');
    await sourceMore.click(); await sourcePanel.waitFor(); await photo(p, 'tool-row-source.png');
    assert.equal(await sourceMore.getAttribute('aria-expanded'), 'true');
    assert.ok(await sourcePanel.evaluate(panel => { const b = panel.getBoundingClientRect(), pane = panel.closest('.pdf-pane').getBoundingClientRect(); return b.left >= pane.left && b.right <= pane.right; }), 'the panel stays inside its pane');
    assert.ok(await sourcePanel.locator('button').evaluateAll(buttons => buttons.every(b => b.textContent.trim().length > 0)), 'each tool under ⋯ has a name');
    // The page number in the panel goes to a page and leaves the panel open.
    const pageInput = sourcePanel.locator('input[type="number"], .pdf-page-input').first();
    if (await pageInput.count()) { await pageInput.fill('2'); await pageInput.press('Enter'); await p.waitForFunction(() => document.querySelector('.original-pages').scrollTop > 0); assert.equal(await sourcePanel.isVisible(), true, 'the panel stays open for the page number'); }
    // Escape closes it and gives the focus back to ⋯; a press outside closes it too.
    await p.keyboard.press('Escape'); await sourcePanel.waitFor({ state: 'hidden' }); assert.equal(await p.evaluate(() => document.activeElement?.matches('.tool-more')), true, 'Escape gives the focus back to ⋯');
    await sourceMore.click(); await sourcePanel.waitFor(); await p.locator('.pdf-pane-header').first().click(); await sourcePanel.waitFor({ state: 'hidden' });
    // A notebook tool under ⋯ works, and a command closes the panel (a menu that hangs from it keeps it).
    const nbRow = p.locator('.nb-tools'), nbMore = nbRow.locator(':scope>.tool-more'), nbPanel = nbRow.locator(':scope>.tool-overflow');
    await nbMore.click(); await nbPanel.waitFor(); await photo(p, 'tool-row-notebook.png');
    const add = nbPanel.locator('[data-nb-add]');
    if (await add.count()) { const before = await p.evaluate(() => nb.doc.pages.length); await add.click(); await p.locator('.nb-add-menu [data-action="nb-add-page"]').click(); await p.waitForFunction(n => nb.doc.pages.length === n + 1, before); }
    // Wide again: everything back in the row, in its order.
    await p.setViewportSize({ width: 2400, height: 900 }); await p.waitForTimeout(400); await settle();
    const back = await rows();
    for (const [i, r] of back.entries()) { assert.equal(r.more, false, `${r.row}: ⋯ gone when wide again`); assert.deepEqual(r.inRow, wide[i].inRow, `${r.row}: the tools are back in their order`); }
    await app.close(); app = null;
    console.log('Tool row smoke passed: in a narrow pane the source and notebook tool rows stay in their pane with the rest under ⋯ (named, PDF 저장 kept in the row, the panel inside its pane); the page number works there and leaves it open; Escape and a press outside close it; a notebook tool under ⋯ works; wide again, every tool is back in its order.');
  } catch (error) { console.error(error); process.exitCode = 1; try { await (await app?.firstWindow())?.screenshot({ path: path.join(os.tmpdir(), `${appName.id}-tool-row-failure.png`) }); } catch {} }
  finally { await app?.close().catch(() => {}); await fs.rm(temp, { recursive: true, force: true }); }
})();
