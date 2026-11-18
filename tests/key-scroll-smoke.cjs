// End-to-end check of scrolling with the keyboard in the real app (renderer.js): on the source pages PageDown/PageUp,
// Space, ↓/↑ and Home/End move the pane, →/← move it sideways only once the pages are wider than it; nothing moves while
// a text field has the focus; the translation beside it and the notebook pages scroll the same way when pointed at; the
// library list scrolls with PageDown. APP_TEST_SOURCE=1 runs the source.
const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { PDFDocument, StandardFonts } = require('pdf-lib');
const appName = require('../core/app-name.cjs');
const root = path.resolve(__dirname, '..');
(async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), `${appName.id}-key-scroll-e2e-`)), vault = path.join(temp, 'vault'); await fs.mkdir(vault);
  const files = [];
  for (let n = 0; n < 16; n++) {
    const doc = await PDFDocument.create(), font = await doc.embedFont(StandardFonts.Helvetica), pages = n === 0 ? 6 : 1;
    for (let i = 0; i < pages; i++) doc.addPage([600, 800]).drawText(`${n === 0 ? 'Long paper' : `Short paper ${n}`}, page ${i + 1}.`, { x: 40, y: 740, size: 14, font });
    const file = path.join(temp, n === 0 ? 'long.pdf' : `short-${String(n).padStart(2, '0')}.pdf`); await fs.writeFile(file, await doc.save()); files.push(file);
  }
  const env = /utf-?8/i.test(process.env.LC_ALL || process.env.LANG || '') ? process.env : { ...process.env, LC_ALL: 'C.UTF-8', LANG: 'C.UTF-8' };
  let app;
  try {
    app = await electron.launch({ env: { ...env, APP_UI_LANG: 'ko' }, executablePath: require('./app-executable.cjs')(root), args: [...(process.env.APP_TEST_SOURCE === '1' ? [root] : []), '--no-sandbox', '--ozone-platform=headless', '--disable-gpu', `--user-data-dir=${path.join(temp, 'profile')}`], timeout: 20000 });
    const p = await app.firstWindow(); p.setDefaultTimeout(20000); await p.setViewportSize({ width: 1300, height: 950 });
    p.on('pageerror', e => { console.error(e); process.exitCode = 1; }); p.on('console', m => { if (m.type() === 'error') { console.error('renderer:', m.text()); process.exitCode = 1; } });
    await app.evaluate(({ app, dialog }) => {
      globalThis.openQueue = []; dialog.showOpenDialog = async () => ({ canceled: false, filePaths: globalThis.openQueue.shift() });
      const { ChatGPT } = process.getBuiltinModule('module').createRequire(app.getAppPath() + '/package.json')('./desktop/chatgpt.cjs');
      ChatGPT.prototype.status = () => ({ connected: true, usable: true, email: 'fixture@example.test', persistent: false });
      ChatGPT.prototype.models = async () => [{ id: 'fixture-model', name: 'Fixture GPT' }];
      ChatGPT.prototype.translate = async (_m, blocks) => blocks.map(b => ({ id: b.id, text: '긴 논문의 한 쪽입니다.' }));
    });
    await app.evaluate((_, v) => globalThis.openQueue.push([v]), vault); await p.locator('[data-action="storage"]').first().click();
    await app.evaluate((_, f) => globalThis.openQueue.push(f), files); await p.locator('[data-action="add-files"]').first().click();
    await p.locator('.paper-item').nth(15).waitFor();
    const top = selector => p.evaluate(s => Math.round(document.querySelector(s).scrollTop), selector);
    const left = selector => p.evaluate(s => Math.round(document.querySelector(s).scrollLeft), selector);
    const press = async key => { await p.keyboard.press(key); await p.waitForTimeout(150); };
    const blur = () => p.evaluate(() => document.activeElement?.blur?.());

    // The library list: PageDown moves it down, Home back to the top.
    await blur(); const list = await p.evaluate(() => { let l = document.querySelector('#paper-list').parentElement; while (!/auto|scroll/.test(getComputedStyle(l).overflowY)) l = l.parentElement; l.dataset.keyScrollTest = '1'; return l.scrollHeight > l.clientHeight; });
    assert.ok(list, 'sixteen papers make the library list taller than the window');
    await press('PageDown'); assert.ok(await top('[data-key-scroll-test]') > 100, 'PageDown scrolls the library list');
    await press('Home'); assert.equal(await top('[data-key-scroll-test]'), 0);

    // The source pages.
    await p.locator('.paper-item', { hasText: 'long' }).click(); await p.locator('.original-pages .page[data-page="1"] .textLayer span').first().waitFor();
    await p.waitForFunction(() => { const c = document.querySelector('.original-pages'); return c.scrollHeight > c.clientHeight * 2; });
    await blur(); const src = '.original-pages', height = await p.evaluate(() => document.querySelector('.original-pages').clientHeight);
    await press('PageDown'); const paged = await top(src); assert.ok(Math.abs(paged - Math.round(height * .9)) <= 2, `PageDown moves about nine tenths of the pane (${paged} of ${height})`);
    // Pages drawn as they come into view can settle a pixel or two (the browser keeps the place), hence `near`.
    const near = async (want, what) => { const got = await top(src); assert.ok(Math.abs(got - want) <= 3, `${what} (${got}, wanted ${want})`); };
    await press('PageUp'); await near(0, 'PageUp back');
    await press('Space'); await near(paged, 'Space as PageDown'); await press('Shift+Space'); await near(0, 'Shift+Space as PageUp');
    await press('Home'); await press('ArrowDown'); await near(60, '↓ a step'); await press('ArrowDown'); await near(120, '↓ again'); await press('ArrowUp'); await near(60, '↑ a step back');
    await press('End'); assert.equal(await top(src), await p.evaluate(() => { const c = document.querySelector('.original-pages'); return c.scrollHeight - c.clientHeight; }), 'End to the bottom');
    await press('Home'); assert.equal(await top(src), 0, 'Home to the top');
    // The pane itself holding the focus (the browser would scroll it too): one step, not two.
    await p.evaluate(s => { const c = document.querySelector(s); c.tabIndex = -1; c.focus(); }, src); await press('ArrowDown'); await near(60, 'a focused pane moves once'); await press('PageDown'); await near(60 + Math.round(height * .9), 'PageDown once in a focused pane');
    await press('Home'); await blur();
    // Not wider than the pane: →/← do nothing. Zoomed in: they move it sideways.
    await press('ArrowRight'); assert.equal(await left(src), 0, '→ does nothing while the page fits');
    for (let i = 0; i < 25 && !await p.evaluate(() => { const c = document.querySelector('.original-pages'); return c.scrollWidth > c.clientWidth + 150; }); i++) { await p.locator('[data-reader-zoom=".1"]').first().click(); await p.waitForTimeout(150); }
    await blur(); await press('ArrowRight'); assert.equal(await left(src), 60, '→ a step sideways'); await press('ArrowRight'); await press('ArrowLeft'); assert.equal(await left(src), 60, '← a step back');
    // A text field keeps its keys.
    const before = [await top(src), await left(src)];
    await p.locator('#search').focus(); for (const key of ['PageDown', 'ArrowDown', 'End', 'ArrowRight', 'Space']) await press(key);
    assert.deepEqual([await top(src), await left(src)], before, 'nothing moves while the search field has the focus');
    await p.locator('#search').fill(''); await blur();

    // The translation beside it, pointed at: it scrolls (and the source follows as with the wheel).
    await p.locator('[data-mode="dual"]').click(); await p.locator('#gpt-model').waitFor({ state: 'attached' }); await p.locator('[data-action="gpt-start"]').click();
    await p.locator('.translated-block').filter({ hasText: '긴 논문의 한 쪽입니다.' }).first().waitFor({ state: 'attached' }); await p.locator('[data-action="gpt-export"]').waitFor();
    const tr = '.translated-pane .translated-pages';
    await p.waitForFunction(s => { const c = document.querySelector(s); return c && c.scrollHeight > c.clientHeight * 1.5; }, tr);
    await p.evaluate(s => { document.querySelector(s).scrollTop = 0; }, tr); await p.waitForTimeout(200);
    const pane = await p.locator(tr).boundingBox(); await p.mouse.move(pane.x + pane.width / 2, pane.y + 200); await blur();
    await press('PageDown'); assert.ok(await top(tr) > 200, 'PageDown scrolls the translation pointed at');
    await press('Home'); assert.equal(await top(tr), 0);

    // The notebook pages, pointed at.
    await p.locator('[data-mode="notebook"]').click(); await p.locator('.notebook-pane [data-action="nb-new"]').first().click();
    await p.locator('#nb-title').fill('스크롤 노트'); await p.locator('#dialog [data-action="nb-create"]').click(); await p.locator('.nb-page').first().waitFor();
    for (let i = 0; i < 2; i++) await p.evaluate(() => actions['nb-add-page']());
    await p.waitForFunction(() => { const c = document.querySelector('.nb-pages'); return c && c.scrollHeight > c.clientHeight * 1.5; });
    await p.evaluate(() => { document.querySelector('.nb-pages').scrollTop = 0; }); await p.waitForTimeout(200); const nbBox = await p.locator('.nb-pages').boundingBox(); await p.mouse.move(nbBox.x + nbBox.width / 2, nbBox.y + 200); await blur();
    await press('ArrowDown'); assert.equal(await top('.nb-pages'), 60, '↓ scrolls the notebook pages');
    await press('PageDown'); assert.ok(await top('.nb-pages') > 200, 'PageDown scrolls the notebook pages');
    await press('Home'); assert.equal(await top('.nb-pages'), 0);

    // The shortcut list names the keys.
    await p.keyboard.press('F1'); await p.locator('.shortcut-help').waitFor();
    assert.match(await p.locator('.shortcut-help').textContent(), /PageDown[\s\S]*Home/);
    console.log('Key scroll smoke passed: library list, source pages (PageDown/PageUp, Space, ↑/↓, Home/End, →/← when wider), a text field keeps its keys, the translation and the notebook pages when pointed at, the shortcut list.');
  } catch (error) { console.error(error); process.exitCode = 1; try { await (await app?.firstWindow())?.screenshot({ path: path.join(os.tmpdir(), `${appName.id}-key-scroll-failure.png`) }); } catch {} }
  finally { await app?.close().catch(() => {}); await fs.rm(temp, { recursive: true, force: true }); }
})();
