// End-to-end check of K-08 in the real Electron app: a notebook beside the
// paper with handwriting, a text box, a source card and a figure excerpt;
// page templates, duplication and order; undo; source jumps; PDF and
// Markdown export; everything kept across restart. No model is used.
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
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), `${appName.id}-nb-e2e-`)), vault = path.join(temp, 'vault'); await fs.mkdir(vault);
  const doc = await PDFDocument.create(), font = await doc.embedFont(StandardFonts.Helvetica);
  for (const text of ['Introduction text.', 'Methods describe the experiment.', 'Results are here.']) { const page = doc.addPage([600, 800]); page.drawText(text, { x: 40, y: 700, size: 14, font }); page.drawRectangle({ x: 100, y: 300, width: 200, height: 150, borderWidth: 3 }); }
  await fs.writeFile(path.join(temp, 'paper.pdf'), await doc.save());
  const executable = require('./app-executable.cjs')(root);
// Memos are folded until chosen: the first one is opened when a step needs the memo field.
const openNote = async p => { await p.locator('#note, .memo-card[data-memo], .memo-tab [data-action="memo-new"]').first().waitFor(); if (!await p.locator('#note').count()) await (await p.locator('.memo-card[data-memo]').count() ? p.locator('.memo-card[data-memo]').first() : p.locator('.memo-tab [data-action="memo-new"]')).click(); await p.locator('#note').waitFor({ state: 'attached' }); return p.locator('#note'); };
  const env = /utf-?8/i.test(process.env.LC_ALL || process.env.LANG || '') ? process.env : { ...process.env, LC_ALL: 'C.UTF-8', LANG: 'C.UTF-8' };
  let app;
  async function launch() {
    app = await electron.launch({ env, executablePath: executable, args: [...(process.env.APP_TEST_SOURCE === '1' ? [root] : []), '--no-sandbox', '--ozone-platform=headless', '--disable-gpu', `--user-data-dir=${path.join(temp, 'profile')}`], timeout: 20000 });
    const p = await app.firstWindow(); p.setDefaultTimeout(15000); await p.setViewportSize({ width: 1400, height: 950 });
    p.on('pageerror', e => { console.error(e); process.exitCode = 1; }); p.on('console', m => { if (m.type() === 'error') console.error('renderer:', m.text()); });
    await app.evaluate(({ app, dialog }) => {
      globalThis.openQueue = []; globalThis.saveQueue = []; globalThis.modelCalls = 0;
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: globalThis.openQueue.shift() });
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: globalThis.saveQueue.shift() });
      const { ChatGPT } = process.getBuiltinModule('module').createRequire(app.getAppPath() + '/package.json')('./desktop/chatgpt.cjs');
      for (const name of ['translate', 'respond', 'explainFigure']) ChatGPT.prototype[name] = async () => { globalThis.modelCalls++; throw Error('no model in this test'); };
    });
    return p;
  }
  const drawn = (p, n) => p.waitForFunction(n => { const c = document.querySelectorAll('.nb-page .nb-ink')[n]; if (!c) return false; const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let k = 0; for (let i = 3; i < d.length; i += 4) if (d[i]) k++; return k > 30; }, n);
  const inked = (p, n) => p.evaluate(n => { const c = document.querySelectorAll('.nb-page .nb-ink')[n]; const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let k = 0; for (let i = 3; i < d.length; i += 4) if (d[i]) k++; return k; }, n);
  async function waitFile(file) { for (let i = 0; i < 200; i++) { try { if ((await fs.stat(file)).size) return fs.readFile(file); } catch {} await new Promise(r => setTimeout(r, 100)); } throw Error('not saved: ' + file); }
  try {
    let p = await launch();
    await app.evaluate((_, v) => globalThis.openQueue.push([v]), vault); await p.locator('[data-action="storage"]').first().click();
    await app.evaluate((_, f) => globalThis.openQueue.push([f]), path.join(temp, 'paper.pdf')); await p.locator('[data-action="add-files"]').first().click();
    await p.locator('.paper-item').click(); await p.locator('.original-pages .page[data-page="1"] canvas').first().waitFor();
    await p.locator('[data-mode="notebook"]').click(); await p.locator('.notebook-pane [data-action="nb-new"]').first().click();
    await p.locator('#nb-title').fill('실험 노트'); await p.locator('#dialog [data-action="nb-create"]').click(); await p.locator('.nb-page').first().waitFor();
    // The notebook page starts at the pane's left edge, in line with its header, like a PDF page.
    { const offsets = await p.evaluate(()=>[...document.querySelectorAll('.pdf-pane')].map(pane=>{const header=pane.querySelector('header'),page=pane.querySelector('.page, .translated-sheet, .nb-page');if(!header||!page)return null;return Math.round(page.getBoundingClientRect().left-header.getBoundingClientRect().left);}).filter(v=>v!==null)); assert.ok(offsets.length >= 1 && offsets.every(v => Math.abs(v) <= 1), 'page left edge against the pane header\'s left edge: ' + offsets); }
    assert.equal(await p.locator('#dialog[open]').count(), 0, 'no translation dialog');

    // Handwriting with the shared pen; undo and redo through the ink toolbar.
    await p.locator('[data-ink-tool="pen"]').click();
    const page = p.locator('.nb-page').first(), box = await page.boundingBox();
    await p.mouse.move(box.x + box.width * .2, box.y + box.height * .3); await p.mouse.down();
    for (let i = 1; i <= 10; i++) await p.mouse.move(box.x + box.width * (.2 + .04 * i), box.y + box.height * .32);
    await p.mouse.up(); await p.locator('.nb-status[data-state="saved"]').waitFor({ state: 'attached' });
    await drawn(p, 0);
    await p.locator('[data-ink-undo]').click(); await p.waitForFunction(() => { const c = document.querySelector('.nb-page .nb-ink'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; for (let i = 3; i < d.length; i += 4) if (d[i]) return false; return true; });
    await p.locator('[data-ink-redo]').click(); await drawn(p, 0);
    // A highlighter stroke is painted once when lifted: no leftover preview frame paints it again (twice as dark).
    await p.locator('[data-ink-tool="highlighter"]').click(); await p.mouse.move(box.x + box.width * .2, box.y + box.height * .6); await p.mouse.down();
    for (let i = 1; i <= 10; i++) await p.mouse.move(box.x + box.width * (.2 + .04 * i), box.y + box.height * .6);
    await p.mouse.up(); await p.locator('.nb-status[data-state="saved"]').waitFor({ state: 'attached' }); await p.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
    const alpha = await p.evaluate(() => { const c = document.querySelector('.nb-page .nb-ink'), y = Math.round(c.height * .6), d = c.getContext('2d').getImageData(0, y, c.width, 1).data; let m = 0; for (let i = 3; i < d.length; i += 4) m = Math.max(m, d[i]); return m; });
    assert.ok(alpha > 60 && alpha < 110, 'one layer of highlighter, alpha ' + alpha);
    await p.locator('[data-ink-undo]').click(); await p.locator('[data-ink-tool="pen"]').click();
    // The live preview is the ink layer's shared one: a canvas over the page while drawing, gone when lifted.
    await p.mouse.move(box.x + box.width * .2, box.y + box.height * .7); await p.mouse.down(); await p.mouse.move(box.x + box.width * .4, box.y + box.height * .72, { steps: 5 });
    await p.locator('.nb-page .app-ink-live').waitFor({ state: 'attached' }); await p.mouse.up(); assert.equal(await p.locator('.nb-page .app-ink-live').count(), 0, 'the preview ends with the stroke');
    await p.locator('[data-ink-undo]').click();
    // Zoom with Ctrl+wheel only (no zoom buttons in the tool row); ink drawn when zoomed lands on the same page spot.
    assert.equal(await p.locator('.nb-tools [data-nb-zoom], .nb-tools [data-nb-zoom-fit]').count(), 0, 'no zoom buttons');
    // 100% is the pane's width (up to 820px), whatever the scroll bar takes; the page is that times the zoom.
    const zoomOf = () => page.evaluate(n => { const l = n.closest('.nb-pages'), cs = getComputedStyle(l), fit = Math.min(820, l.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)); return n.getBoundingClientRect().width / fit; });
    { const zb = await p.locator('.nb-pages').boundingBox(); await p.mouse.move(zb.x + zb.width / 2, zb.y + zb.height / 2); await p.keyboard.down('Control'); await p.mouse.wheel(0, -100); await p.keyboard.up('Control');
      await p.waitForFunction(() => nbZoom > 1.1); assert.ok(Math.abs(await zoomOf() - await p.evaluate(() => nbZoom)) < .01, 'pages follow the zoom'); }
    await p.waitForFunction(() => { const pg = document.querySelector('.nb-page'), c = pg.querySelector('.nb-ink'); return Math.abs(c.width / Math.min(2, devicePixelRatio || 1) - pg.clientWidth) <= 1; });
    { await p.locator('.nb-pages').evaluate(n => { n.scrollTop = 0; n.scrollLeft = 0; }); const zb = await page.boundingBox();
      await p.mouse.move(zb.x + zb.width * .1, zb.y + zb.height * .1); await p.mouse.down(); await p.mouse.move(zb.x + zb.width * .3, zb.y + zb.height * .1, { steps: 5 }); await p.mouse.up();
      const pts = await p.evaluate(() => { const st = nb.doc.pages[0].strokes.at(-1), w = nb.doc.pages[0].width; return [st.points[0] / w, st.points.at(-4) / w]; });
      assert.ok(Math.abs(pts[0] - .1) < .02 && Math.abs(pts[1] - .3) < .02, 'a stroke drawn zoomed is stored in page points: ' + pts);
      await p.locator('[data-ink-undo]').click(); }
    { const zb = await p.locator('.nb-pages').boundingBox(); await p.mouse.move(zb.x + zb.width / 2, zb.y + zb.height / 2); await p.keyboard.down('Control'); for (let i = 0; i < 6; i++) await p.mouse.wheel(0, 300); await p.keyboard.up('Control');
      await p.waitForFunction(() => nbZoom === .5); }
    await p.evaluate(() => nbSetZoom(1)); assert.ok(Math.abs(await zoomOf() - 1) < .01, 'back to the pane width');
    // The shape tool draws on notebook pages too (a pen stroke through the corners); one undo takes it away.
    await p.locator('[data-ink-tool="shape"]').click(); await p.mouse.move(box.x + box.width * .3, box.y + box.height * .6); await p.mouse.down(); await p.mouse.move(box.x + box.width * .5, box.y + box.height * .7, { steps: 4 }); await p.mouse.up();
    await p.locator('.nb-status[data-state="saved"]').waitFor({ state: 'attached' });
    assert.deepEqual(await p.evaluate(() => nb.doc.pages[0].strokes.filter(s => s.shape).map(s => [s.tool, s.shape, s.points.length / 4])), [['pen', 'rect', 5]]);
    await p.locator('[data-ink-undo]').click(); await p.waitForFunction(() => !nb.doc.pages[0].strokes.some(s => s.shape));
    // The shape chosen in the menu is the one drawn (the notebook read the first choice before).
    await p.locator('[data-ink-tool="shape"]').click(); await p.locator('[data-ink-pick="shape"][data-value="ellipse"]').click();
    await p.mouse.move(box.x + box.width * .3, box.y + box.height * .6); await p.mouse.down(); await p.mouse.move(box.x + box.width * .5, box.y + box.height * .7, { steps: 4 }); await p.mouse.up();
    await p.waitForFunction(() => nb.doc.pages[0].strokes.some(s => s.shape === 'ellipse'));
    await p.locator('[data-ink-undo]').click(); await p.waitForFunction(() => !nb.doc.pages[0].strokes.some(s => s.shape));
    // Shift makes the ellipse a circle and the pen a ruler line, as on PDF pages.
    const extent = () => p.evaluate(() => { const st = nb.doc.pages[0].strokes.at(-1), xs = st.points.filter((_, i) => i % 4 === 0), ys = st.points.filter((_, i) => i % 4 === 1); return { shape: st.shape, n: st.points.length / 4, w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) }; });
    await p.keyboard.down('Shift'); await p.mouse.move(box.x + box.width * .3, box.y + box.height * .6); await p.mouse.down(); await p.mouse.move(box.x + box.width * .5, box.y + box.height * .7, { steps: 4 }); await p.mouse.up(); await p.keyboard.up('Shift');
    await p.waitForFunction(() => nb.doc.pages[0].strokes.some(s => s.shape === 'ellipse')); let regular = await extent(); assert.ok(Math.abs(regular.w - regular.h) <= regular.w * .02 + .5, 'circle: ' + JSON.stringify(regular));
    await p.locator('[data-ink-undo]').click(); await p.waitForFunction(() => !nb.doc.pages[0].strokes.some(s => s.shape));
    await p.locator('[data-ink-tool="pen"]').click(); const before = await p.evaluate(() => nb.doc.pages[0].strokes.length);
    await p.keyboard.down('Shift'); await p.mouse.move(box.x + box.width * .2, box.y + box.height * .8); await p.mouse.down(); await p.mouse.move(box.x + box.width * .4, box.y + box.height * .85, { steps: 5 }); await p.mouse.move(box.x + box.width * .6, box.y + box.height * .78, { steps: 5 }); await p.mouse.up(); await p.keyboard.up('Shift');
    await p.waitForFunction(n => nb.doc.pages[0].strokes.length > n, before); regular = await extent(); assert.equal(regular.n, 2, 'a ruler line: start and end only');
    await p.locator('[data-ink-undo]').click(); await p.waitForFunction(n => nb.doc.pages[0].strokes.length === n, before);
    // Every PDF ink tool works on notebook pages. The lasso selects the pen line; it moves, takes a
    // palette colour, scales from its corner, duplicates and deletes, each one undo step.
    const at = (x, y) => [box.x + box.width * x, box.y + box.height * y], saved = () => p.locator('.nb-status[data-state="saved"]').waitFor({ state: 'attached' });
    const nbStrokes = () => p.evaluate(() => nb.doc.pages[0].strokes.map(s => { let y0 = Infinity; for (let i = 1; i < s.points.length; i += 4) y0 = Math.min(y0, s.points[i]); return { id: s.id, color: s.color, width: s.width, y0, n: s.points.length / 4 }; }));
    const loop = async (y0, y1) => { await p.mouse.move(...at(.12, y0)); await p.mouse.down(); for (const pt of [[.75, y0], [.75, y1], [.12, y1], [.12, y0 + .01]]) await p.mouse.move(...at(...pt), { steps: 4 }); await p.mouse.up(); await p.locator('.nb-selection').waitFor(); };
    await p.locator('[data-ink-tool="lasso"]').click(); await loop(.22, .42);
    assert.deepEqual(await p.evaluate(() => [nb.sel.strokes.length, nb.sel.items.length]), [1, 0]);
    const [line] = await nbStrokes();
    await p.mouse.move(...at(.4, .31)); assert.equal(await page.evaluate(n => getComputedStyle(n).cursor), 'grab', 'a hand over the selection');
    await p.mouse.down(); await p.mouse.move(...at(.4, .41), { steps: 5 }); await p.mouse.up(); await saved();
    const [moved] = await nbStrokes(); assert.equal(moved.id, line.id); assert.ok(Math.abs(moved.y0 - line.y0 - 84.2) < 3, `moved a tenth of the page: ${moved.y0 - line.y0}`);
    const swatch = p.locator('.ink-colors .ink-color').nth(2), color = await swatch.getAttribute('data-ink-color'), pen = await p.evaluate(() => globalThis.appInk.color.pen);
    await swatch.click(); await saved(); assert.equal((await nbStrokes())[0].color, color); assert.equal(await p.evaluate(() => globalThis.appInk.color.pen), pen, 'the pen keeps its colour');
    const handle = await p.locator('.nb-selection .ink-handle').boundingBox();
    await p.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2); await p.mouse.down(); await p.mouse.move(handle.x + 80, handle.y + 10, { steps: 5 }); await p.mouse.up(); await saved();
    assert.ok((await nbStrokes())[0].width > line.width, 'the corner scales the line and its width');
    await p.locator('.nb-selection [data-nb-selection="duplicate"]').click(); await saved(); assert.equal((await nbStrokes()).length, 2);
    await p.locator('[data-ink-undo]').click(); await p.waitForFunction(() => nb.doc.pages[0].strokes.length === 1);
    await loop(.2, .6); await p.keyboard.press('Delete'); await p.waitForFunction(() => !nb.doc.pages[0].strokes.length);
    await p.locator('[data-ink-undo]').click(); await p.waitForFunction(() => nb.doc.pages[0].strokes.length === 1);
    // Escape drops the selection and, as on PDF pages, returns to reading.
    await loop(.2, .6); await p.keyboard.press('Escape'); assert.equal(await p.locator('.nb-selection').count(), 0); assert.equal(await p.evaluate(() => globalThis.appInk.tool), 'read');
    // The laser leaves a fading trail and stores nothing.
    await p.locator('[data-ink-group="pointer"]').click(); await p.locator('[data-ink-pick="pointer"][data-value="laser"]').click();
    await p.mouse.move(...at(.2, .7)); await p.mouse.down(); await p.mouse.move(...at(.5, .75), { steps: 6 });
    assert.equal(await p.locator('.nb-page .app-ink-laser').count(), 1);
    await p.mouse.up(); await p.locator('.nb-page .app-ink-laser').waitFor({ state: 'detached' }); assert.equal((await nbStrokes()).length, 1);
    await p.locator('[data-ink-group="pointer"]').click(); await p.locator('[data-ink-pick="pointer"][data-value="read"]').click();
    // The page memo writes in a new text box where it is clicked; two undos take the text and the box away.
    await p.locator('[data-ink-tool="text"]').click(); await p.mouse.click(...at(.3, .8));
    await p.waitForFunction(() => document.activeElement?.matches('.nb-text textarea')); assert.equal(await p.evaluate(() => globalThis.appInk.tool), 'read', 'the select tool after placing a box'); await p.keyboard.type('메모 상자'); await p.evaluate(() => document.activeElement.blur());
    assert.deepEqual(await p.evaluate(() => nb.doc.pages[0].items.map(i => [i.type, i.text, Math.round(i.y / 842 * 100)])), [['text', '메모 상자', 79]]);
    await p.locator('[data-ink-undo]').click(); await p.locator('[data-ink-undo]').click(); await p.waitForFunction(() => !nb.doc.pages[0].items.length);
    // The partial eraser cuts a pen line in two.
    await p.locator('[data-ink-tool="pen"]').click(); await p.mouse.move(...at(.2, .7)); await p.mouse.down(); await p.mouse.move(...at(.8, .7), { steps: 20 }); await p.mouse.up(); await saved();
    const cut = (await nbStrokes()).find(s => s.n > 10 && s.id !== line.id);
    await p.locator('[data-ink-tool="eraser"]').click(); await p.locator('[data-ink-tool="eraser"]').click(); await p.locator('[data-ink-pick="eraser"][data-value="partial"]').click();
    await p.mouse.move(...at(.5, .68)); await p.mouse.down(); await p.mouse.move(...at(.5, .72), { steps: 4 }); await p.mouse.up(); await saved();
    const after = await nbStrokes(); assert.equal(after.length, 3, 'the line is cut in two'); assert.ok(!after.some(s => s.id === cut.id));
    assert.doesNotMatch(await p.locator('.nb-status').textContent(), /실패/);
    await p.locator('[data-ink-tool="read"]').click();

    // Text box, source card from the visible page and selection, figure excerpt.
    await (await toolShown(p, '[data-action="nb-text"]')).click(); await (await toolShown(p, '.nb-text textarea')).fill('가설: 레이아웃이 속도를 높인다'); await p.locator('.nb-text textarea').blur();
    await p.evaluate(() => { document.querySelector('.original-pages').pdfViewer.currentPageNumber = 2; });
    await p.locator('.original-pages .page[data-page="2"] .textLayer span').first().waitFor();
    await p.evaluate(() => { const span = document.querySelector('.original-pages .page[data-page="2"] .textLayer span'), range = document.createRange(); range.selectNodeContents(span); getSelection().removeAllRanges(); getSelection().addRange(range); });
    await (await toolShown(p, '[data-action="nb-card"]')).click(); await p.locator('.nb-card').filter({ hasText: '2쪽' }).waitFor();
    assert.match(await p.locator('.nb-card q').textContent(), /Methods describe/);
    assert.match(await p.locator('[data-action="nb-figure"]').getAttribute('title'), /^그림으로 넣기/); assert.equal(await p.locator('.nb-tools .nb-tool:not([data-nb-add])').count(), 4, 'the box tools are icons'); assert.match(await p.locator('[data-action="nb-memo"]').getAttribute('title'), /^메모 넣기/); assert.equal(await p.locator('.nb-tools [data-nb-add]').getAttribute('aria-label'), '페이지 추가'); assert.equal((await p.locator('.nb-tools [data-nb-add]').textContent()).trim(), '', 'adding a page is an icon too'); assert.equal((await p.locator('.nb-tools [data-action="nb-text"]').textContent()).trim(), ''); assert.equal(await p.locator('.nb-tools').filter({ hasText: '위 필기 도구' }).count(), 0);
    await (await toolShown(p, '[data-action="nb-figure"]')).click(); await p.locator('#nb-fig-image').waitFor();
    // Scrolling on past the end of the page turns to the next one.
    const figStart = Number(await p.locator('#nb-fig-page').inputValue()); await p.locator('#nb-fig-page').fill(String(Math.min(figStart, 2))); await p.locator('[data-action="nb-fig-load"]').click(); await p.waitForTimeout(300);
    const figFrom = Number(await p.locator('#nb-fig-page').inputValue()); await p.locator('.figure-scroll').evaluate(b => { b.scrollTop = b.scrollHeight; });
    await p.locator('.figure-scroll').hover(); await p.mouse.wheel(0, 400); await p.waitForFunction(n => Number(document.querySelector('#nb-fig-page').value) === n + 1, figFrom);
    await p.locator('#nb-fig-page').fill('3'); await p.locator('[data-action="nb-fig-load"]').click(); await p.waitForTimeout(300);
    const fig = await p.locator('.figure-canvas').boundingBox();
    await p.mouse.move(fig.x + fig.width * .15, fig.y + fig.height * .1); await p.mouse.down(); await p.mouse.move(fig.x + fig.width * .55, fig.y + fig.height * .3, { steps: 4 }); await p.mouse.up();
    await p.locator('[data-action="nb-fig-insert"]').click(); await p.locator('.nb-image img[src^="data:image/png"]').waitFor();
    assert.match(await p.locator('.nb-image figcaption').textContent(), /3쪽/);
    // The box takes the picture's proportions: no blank band around it.
    const fit = await p.locator('.nb-image img[src^="data:image/png"]').first().evaluate(img => { const r = img.getBoundingClientRect(); return Math.abs(r.width / r.height - img.naturalWidth / img.naturalHeight); }); assert.ok(fit < .06, 'picture fills its box: ' + fit);
    // Move the text box; the source card opens its page.
    const text = await p.locator('.nb-text').boundingBox();
    await p.mouse.move(text.x + text.width - 30, text.y + 3); await p.mouse.down(); await p.mouse.move(text.x + text.width - 30, text.y + 120, { steps: 5 }); await p.mouse.up();
    // A text box moves from anywhere inside it (like a picture); a double click edits it with a format bar; Esc ends editing and picks the reading tool.
    await p.evaluate(() => { nbChange('추가', () => nb.doc.pages[0].items.push({ id: 'move-test-box', type: 'text', x: 300, y: 620, w: 200, h: 70, text: '옮길 상자' })); nbRender(); });
    const textItem = () => p.evaluate(() => nb.doc.pages.flatMap(pg => pg.items).find(i => i.id === 'move-test-box'));
    const beforeMove = await textItem(), mid = await p.locator(`.nb-text[data-item-id="${beforeMove.id}"]`).boundingBox();
    await p.mouse.move(mid.x + mid.width / 2, mid.y + mid.height / 2); await p.mouse.down(); await p.mouse.move(mid.x + mid.width / 2 + 40, mid.y + mid.height / 2 + 30, { steps: 5 }); await p.mouse.up();
    const afterMove = await textItem(); assert.ok(afterMove.x > beforeMove.x + 20 && afterMove.y > beforeMove.y + 15, 'moved from its middle'); assert.equal(afterMove.text, beforeMove.text, 'moving does not edit');
    // The same format bar as on PDF pages: colour panel, size, B / I / U, alignment, lists.
    const boxNode = p.locator(`.nb-text[data-item-id="${afterMove.id}"]`); await boxNode.dblclick(); await p.locator('.ink-text-bar').waitFor(); assert.equal(await boxNode.evaluate(n => n.classList.contains('editing')), true);
    assert.equal(await p.locator('.nb-text-bar').count(), 0, 'no separate notebook bar');
    await p.locator('.ink-text-bar [data-tb="bold"]').click(); await p.locator('.ink-text-bar [data-tb="size"]').selectOption('20');
    await p.locator('.ink-text-bar [data-tb="color"]').click(); await p.locator('.ink-text-pop').filter({ hasText: '텍스트 색상' }).waitFor(); assert.equal(await p.locator('.ink-text-pop .ink-text-row.pen [data-tb-color]').count() >= 4, true, 'pen colours in the notebook panel too'); await p.locator('.ink-text-pop [data-tb-color="#9f1239"]').click(); await p.locator('.ink-text-pop').waitFor({ state: 'detached' });
    await p.locator('.ink-text-bar [data-tb="align"]').click(); assert.ok(await boxNode.locator('textarea').evaluate(a => a === document.activeElement), 'the text keeps its focus');
    await p.keyboard.press('ControlOrMeta+i');
    const styled = await textItem(); assert.deepEqual([styled.bold, styled.italic, styled.size, styled.color, styled.align], [true, true, 20, '#9f1239', 'center']);
    assert.equal(await boxNode.locator('textarea').evaluate(a => [getComputedStyle(a).fontWeight, getComputedStyle(a).fontStyle, getComputedStyle(a).textAlign].join()), '700,italic,center');
    // Lists as on PDF pages; numbers set by the list are saved with the box.
    const textBefore = styled.text; await p.keyboard.press((process.platform === 'darwin' ? 'Meta+ArrowDown' : 'Control+End')); await p.keyboard.press('Enter'); await p.locator('.ink-text-bar [data-tb="list"]').click(); await p.locator('.ink-text-pop [data-tb-list="number"]').click();
    await p.keyboard.type('하나'); await p.keyboard.press('Enter'); await p.keyboard.type('둘');
    assert.equal((await textItem()).text, textBefore + '\n1. 하나\n2. 둘', 'the list is saved as typed');
    await p.evaluate(() => globalThis.appInk.setTool('pen')); await boxNode.locator('textarea').focus(); await p.keyboard.press('Escape');
    await p.locator('.ink-text-bar').waitFor({ state: 'detached' }); assert.equal(await boxNode.evaluate(n => n.classList.contains('editing')), false); assert.equal(await p.evaluate(() => globalThis.appInk.tool), 'read', 'Esc goes back to reading');
    // A new box starts in the text colour used last, as on PDF pages; one undo takes it away again.
    const boxes = await p.evaluate(() => nb.doc.pages.flatMap(pg => pg.items).filter(i => i.type === 'text').length);
    await (await toolShown(p, '[data-action="nb-text"]')).click(); await p.locator('.ink-text-bar').waitFor();
    assert.equal(await p.evaluate(() => nb.doc.pages.flatMap(pg => pg.items).filter(i => i.type === 'text').at(-1).color), '#9f1239');
    await p.keyboard.press('Escape'); await p.locator('.ink-text-bar').waitFor({ state: 'detached' }); await p.locator('[data-ink-undo]').click();
    await p.waitForFunction(n => nb.doc.pages.flatMap(pg => pg.items).filter(i => i.type === 'text').length === n, boxes);
    await p.evaluate(() => { document.querySelector('.original-pages').pdfViewer.currentPageNumber = 1; });
    await (await toolShown(p, '.nb-card .nb-source-link')).click(); await p.waitForFunction(() => document.querySelector('.original-pages').pdfViewer.currentPageNumber === 2);

    // Pages: grid page added, first page duplicated and moved down.
    // 페이지 추가 (the + in the tool row) asks for the form and size; a page's own ⋯ holds 복제 · 순서 · 삭제.
    assert.equal(await p.locator('.nb-page-tools, .nb-tools select').count(), 0, 'no row of controls over a page, no select in the tool row');
    // The page number is in the tool row, as in the PDF pane, and the two panes' rows are one size.
    { const count = await p.locator('.nb-page').count(); assert.equal(await p.locator('.nb-page-input').inputValue(), '1'); assert.equal(await p.locator('.nb-page-total').innerText(), '의 ' + count); assert.equal(await p.locator('.nb-page-foot').count(), 0);
      const rows = await p.evaluate(() => [...document.querySelectorAll('.pdf-pane')].map(pane => { const top = pane.getBoundingClientRect().top; return ['header', '.pdf-pane-tools,.nb-tools', '.translated-pages,.nb-pages'].map(s => { const r = pane.querySelector(s).getBoundingClientRect(); return [Math.round(r.top - top), s.includes('pages') ? 0 : Math.round(r.height)]; }); }));
      if (rows.length === 2) assert.deepEqual(rows[1], rows[0], 'header, tool row and first page line up across the panes'); }
    await (await toolShown(p, '[data-nb-add]')).click(); await p.locator('.nb-add-menu .nb-new-template').filter({ hasText: '격자' }).click(); await p.locator('.nb-add-menu [data-action="nb-add-page"]').click();
    // ‹ › and a typed number go to a page; the gap between pages is the PDF pages' gap.
    // (Adding a page leaves the view on it: start from the first.)
    await (await toolShown(p, '.nb-page-input')).fill('1'); await (await toolShown(p, '.nb-page-input')).press('Enter'); await p.waitForFunction(() => document.querySelector('.nb-page-input').value === '1' && document.querySelector('.nb-pages').scrollTop < 3);
    await (await toolShown(p, '[data-nb-step="1"]')).click(); await p.waitForFunction(() => document.querySelector('.nb-page-input').value === '2'); await (await toolShown(p, '[data-nb-step="-1"]')).click(); await p.waitForFunction(() => document.querySelector('.nb-page-input').value === '1');
    assert.equal(await p.evaluate(() => { const a = document.querySelectorAll('.nb-page'); return Math.round(a[1].getBoundingClientRect().top - a[0].getBoundingClientRect().bottom); }), 12);
    await p.locator('[data-nb-page-menu]').first().click(); assert.deepEqual(await p.locator('.nb-page-menu [role^="menuitem"]').allInnerTexts(), ['줄', '격자', '빈', '복제', '위로 옮기기', '아래로 옮기기', '삭제']); assert.equal(await p.locator('.nb-page-menu [data-nb-page="up"]').isDisabled(), true);
    await p.locator('.nb-page-menu [data-nb-page="dup"]').click(); await p.locator('[data-nb-page-menu]').first().click(); await p.locator('.nb-page-menu [data-nb-page="down"]').click();
    assert.deepEqual(await p.locator('.nb-page').evaluateAll(n => n.map(e => e.dataset.template)), ['lined', 'lined', 'grid']);
    await p.locator('.nb-status[data-state="saved"]').waitFor({ state: 'attached' });

    // Exports: notebook PDF with three pages, notes as Markdown.
    await app.evaluate((_, f) => globalThis.saveQueue.push(f), path.join(temp, 'notebook.pdf')); await (await toolShown(p, '[data-nb-save-menu]')).click(); await p.locator('.pop-menu [data-action="nb-export"]').click();
    assert.equal((await PDFDocument.load(await waitFile(path.join(temp, 'notebook.pdf')))).getPageCount(), 3);
    await p.locator('[data-tab="메모"]').click(); await (await openNote(p)).fill('메모 내용'); await p.locator('#saved').filter({ hasText: '저장소에 저장됨' }).waitFor();
    await app.evaluate((_, f) => globalThis.saveQueue.push(f), path.join(temp, 'notes.md')); await (await toolShown(p, '[data-nb-save-menu]')).click(); await p.locator('.pop-menu [data-action="nb-notes-md"]').click();
    const md = String(await waitFile(path.join(temp, 'notes.md'))); assert.match(md, /^# paper/); assert.match(md, /## 메모\n\n메모 내용/);

    // An edit still waiting for its save delay is kept when the window is closed right away.
    await p.evaluate(() => nbEditText(document.querySelector('.nb-text'))); await p.locator('.nb-text textarea').first().fill('가설: 레이아웃이 속도를 높인다 (닫기 직전)');
    const exited = new Promise(resolve => app.process().once('exit', resolve));
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close()); await exited;

    // Everything survives a restart.
    p = await launch();
    await (await openNote(p)).waitFor(); await p.locator('[data-mode="notebook"]').click();
    await p.locator('.nb-page').nth(2).waitFor();
    assert.equal(await p.locator('.nb-select').evaluate(s => s.selectedOptions[0].textContent), '실험 노트');
    assert.equal(await p.locator('.nb-text textarea').first().inputValue(), '가설: 레이아웃이 속도를 높인다 (닫기 직전)');
    await p.waitForFunction(() => document.querySelector('.nb-image img')?.src.startsWith('data:image/png'));
    await drawn(p, 0); await drawn(p, 1);
    assert.equal(await app.evaluate(() => globalThis.modelCalls), 0);
    // Other paper sizes, pages of another PDF (as page backgrounds) and a picture from the clipboard.
    await (await toolShown(p, '[data-nb-add]')).click(); assert.equal(await p.locator('.nb-add-menu [name="nb-new-template"]:checked').inputValue(), 'grid', 'the form chosen last is offered again'); await p.locator('.nb-add-menu .nb-size').selectOption('a5'); await p.locator('.nb-add-menu [data-action="nb-add-page"]').click(); await p.locator('.nb-page[data-w="420"][data-h="595"]').waitFor();
    // 사용자 지정: millimetres, remembered for next time.
    await (await toolShown(p, '[data-nb-add]')).click(); await p.locator('.nb-add-menu .nb-size').selectOption('custom'); await p.locator('.nb-add-menu [data-action="nb-add-page"]').click(); await p.locator('#nb-custom-w').fill('100'); await p.locator('#nb-custom-h').fill('150'); await p.locator('[data-action="nb-custom-add"]').click();
    await p.locator('.nb-page[data-w="283.46"][data-h="425.2"]').waitFor(); await (await toolShown(p, '[data-nb-add]')).click(); assert.equal(await p.locator('.nb-add-menu .nb-size').inputValue(), 'custom'); await p.keyboard.press('Escape');
    // Changing a later page's template keeps the view on that page.
    const last = p.locator('.nb-page-wrap').last(); await last.scrollIntoViewIfNeeded(); const scrolled = await p.locator('.nb-pages').evaluate(n => n.scrollTop); assert.ok(scrolled > 200);
    await p.evaluate(() => { const page = nb.doc.pages.at(-1); if (page.template === 'grid') { page.template = 'lined'; nbRender(); } }); await p.locator('.nb-page[data-w="283.46"][data-template="lined"]').waitFor();
    await last.locator('[data-nb-page-menu]').click(); await p.locator('.nb-page-menu [data-nb-set-template="grid"]').click(); await p.locator('.nb-page[data-w="283.46"][data-template="grid"]').waitFor();
    assert.ok(Math.abs(await p.locator('.nb-pages').evaluate(n => n.scrollTop) - scrolled) < 5, 'still on that page');
    await app.evaluate((_, f) => globalThis.openQueue.push([f]), path.join(temp, 'paper.pdf')); await (await toolShown(p, '[data-nb-add]')).click(); await p.locator('.nb-add-menu [data-action="nb-add-pdf"]').click();
    await p.locator('#nb-pdf-range').fill('2-3'); await p.locator('[data-action="nb-add-pdf-go"]').click(); await p.locator('#toast').filter({ hasText: '2쪽을 노트북에 넣었습니다' }).waitFor();
    assert.equal(await p.locator('.nb-page[data-w="600"][data-h="800"] img.nb-bg').count(), 2); await p.waitForFunction(() => [...document.querySelectorAll('.nb-bg')].every(i => i.src.startsWith('data:image/png')));
    const items = await p.locator('.nb-item').count();
    await p.evaluate(async () => { const c = document.createElement('canvas'); c.width = 40; c.height = 20; c.getContext('2d').fillRect(0, 0, 40, 20); const blob = await new Promise(r => c.toBlob(r, 'image/png')); const dt = new DataTransfer(); dt.items.add(new File([blob], 'x.png', { type: 'image/png' })); document.querySelector('.nb-pages').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true })); });
    await p.locator('#toast').filter({ hasText: '그림을 노트북에 넣었습니다' }).waitFor(); assert.equal(await p.locator('.nb-item').count(), items + 1);
    await p.locator('.nb-status[data-state="saved"]').waitFor({ state: 'attached' });
    await app.evaluate((_, f) => globalThis.saveQueue.push(f), path.join(temp, 'notebook-sizes.pdf')); await (await toolShown(p, '[data-nb-save-menu]')).click(); await p.locator('.pop-menu [data-action="nb-export"]').click();
    const sizes = (await PDFDocument.load(await waitFile(path.join(temp, 'notebook-sizes.pdf')))).getPages().map(pg => pg.getSize()).map(s => `${Math.round(s.width)}x${Math.round(s.height)}`);
    assert.deepEqual(sizes, ['595x842', '595x842', '595x842', '420x595', '283x425', '600x800', '600x800'], 'each page prints at its own size');
    // The + under the last page (seen at the end of the list): after a page taken from a PDF, an empty page of its size
    // without the picture; one Ctrl+Z takes it back.
    const pageList = () => p.evaluate(() => nb.doc.pages.map(pg => `${pg.template} ${pg.width}x${pg.height}${pg.background ? ' bg' : ''} ${pg.items.length + pg.strokes.length}`));
    const plus = p.locator('.nb-add-same'); await p.locator('.nb-pages').evaluate(n => { n.scrollTop = n.scrollHeight; }); await plus.waitFor();
    assert.ok(await plus.evaluate(b => { const r = b.getBoundingClientRect(), l = b.closest('.nb-pages').getBoundingClientRect(); return r.top >= l.top && r.bottom <= l.bottom; }), 'the + shows at the end of the list');
    assert.equal(await plus.getAttribute('aria-label'), '같은 양식의 페이지 추가');
    const pagesBefore = await pageList(); await plus.click(); await p.waitForFunction(n => nb.doc.pages.length === n + 1, pagesBefore.length);
    assert.equal((await pageList()).at(-1), 'blank 600x800 0', 'after a page from a PDF: an empty page of its size');
    await p.keyboard.press('ControlOrMeta+z'); await p.waitForFunction(n => nb.doc.pages.length === n, pagesBefore.length);
    // After a lined A5 page: another lined A5 page, empty (the one before keeps what is on it), in view.
    await (await toolShown(p, '[data-nb-add]')).click(); await p.locator('.nb-add-menu [name="nb-new-template"][value="lined"]').check(); await p.locator('.nb-add-menu .nb-size').selectOption('a5'); await p.locator('.nb-add-menu [data-action="nb-add-page"]').click();
    await p.waitForFunction(n => nb.doc.pages.length === n + 1, pagesBefore.length);
    await p.evaluate(() => nbChange('필기', () => nb.doc.pages.at(-1).strokes.push({ id: nbId(), tool: 'pen', color: '#000000', width: 2, points: [20, 20, .5, 0, 60, 40, .5, 5] })));
    await p.locator('.nb-pages').evaluate(n => { n.scrollTop = n.scrollHeight; }); await plus.click(); await p.waitForFunction(n => nb.doc.pages.length === n + 2, pagesBefore.length);
    assert.deepEqual((await pageList()).slice(-2), ['lined 420x595 1', 'lined 420x595 0']);
    assert.ok(await p.evaluate(() => { const r = document.querySelector('.nb-page-wrap:last-of-type').getBoundingClientRect(), l = document.querySelector('.nb-pages').getBoundingClientRect(); return r.top < l.bottom && r.bottom > l.top; }), 'the new page is in view');
    // By keys: Tab reaches the + after the last page's menu, and Enter adds one.
    await p.locator('.nb-page-wrap').last().locator('[data-nb-page-menu]').focus();
    for (let i = 0; i < 40 && !await p.evaluate(() => document.activeElement?.matches('.nb-add-same')); i++) await p.keyboard.press('Tab');
    assert.equal(await p.evaluate(() => document.activeElement?.matches('.nb-add-same')), true, 'Tab reaches the +');
    await p.keyboard.press('Enter'); await p.waitForFunction(n => nb.doc.pages.length === n + 3, pagesBefore.length);
    await p.locator('.nb-status[data-state="saved"]').waitFor({ state: 'attached' });
    const added = await pageList();
    await app.close(); app = null;
    // Kept after a restart.
    p = await launch(); await p.locator('.shell').waitFor(); if (await p.evaluate(() => state.screen !== 'reader')) await p.locator('.paper-item').click();
    await p.locator('[data-mode="notebook"]').click(); await p.waitForFunction(n => nb.doc?.pages.length === n, added.length); assert.deepEqual(await pageList(), added);
    await app.close(); app = null;
    console.log('Notebook smoke passed: pages beside the paper, pen with undo, shapes, lasso move/recolour/scale/duplicate/delete, laser, page memo, partial eraser, text box, source card and figure excerpt with jumps, page templates/order, PDF and Markdown export, an unsaved edit kept on window close, restart.');
  } catch (error) { try { await (await app.firstWindow()).screenshot({ path: path.join(os.tmpdir(), `${appName.id}-nb-failure.png`) }); } catch {} throw error; }
  finally { if (app) await app.close(); await fs.rm(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }).catch(error => console.warn(`임시 폴더를 다 지우지 못했습니다(${error.code}). 테스트 결과와는 무관합니다: ${temp}`)); }
})().catch(error => { console.error(error); process.exit(1); });
