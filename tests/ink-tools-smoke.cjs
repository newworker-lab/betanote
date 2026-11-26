// End-to-end check of the everyday writing tools on a PDF page in the real
// app: page memo, highlight of selected text, shape, lasso move, partial
// eraser, one undo step each, export as standard annotations, and restart.
const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { PDFDocument, StandardFonts } = require('pdf-lib');
const appName = require('../core/app-name.cjs');
const root = path.resolve(__dirname, '..');
(async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), `${appName.id}-tools-e2e-`)), vault = path.join(temp, 'vault'); await fs.mkdir(vault);
  const doc = await PDFDocument.create(), font = await doc.embedFont(StandardFonts.Helvetica); doc.addPage([600, 800]).drawText('A research paper connects ideas.', { x: 40, y: 740, size: 14, font });
  await fs.writeFile(path.join(temp, 'paper.pdf'), await doc.save());
  const executable = require('./app-executable.cjs')(root);
// Memos are folded until chosen: the first one is opened when a step needs the memo field.
const openNote = async p => { await p.locator('#note, .memo-card[data-memo], .memo-tab [data-action="memo-new"]').first().waitFor(); if (!await p.locator('#note').count()) await (await p.locator('.memo-card[data-memo]').count() ? p.locator('.memo-card[data-memo]').first() : p.locator('.memo-tab [data-action="memo-new"]')).click(); await p.locator('#note').waitFor({ state: 'attached' }); return p.locator('#note'); };
  const env = /utf-?8/i.test(process.env.LC_ALL || process.env.LANG || '') ? process.env : { ...process.env, LC_ALL: 'C.UTF-8', LANG: 'C.UTF-8' };
  let app;
  async function launch() {
    app = await electron.launch({ env, executablePath: executable, args: [...(process.env.APP_TEST_SOURCE === '1' ? [root] : []), '--no-sandbox', '--ozone-platform=headless', '--disable-gpu', `--user-data-dir=${path.join(temp, 'profile')}`], timeout: 20000 });
    const p = await app.firstWindow(); p.setDefaultTimeout(15000); await p.setViewportSize({ width: 1300, height: 950 });
    p.on('pageerror', e => { console.error(e); process.exitCode = 1; }); p.on('console', m => { if (m.type() === 'error') console.error('renderer:', m.text()); });
    await app.evaluate(({ dialog }) => { globalThis.openQueue = []; globalThis.saveQueue = []; dialog.showOpenDialog = async () => ({ canceled: false, filePaths: globalThis.openQueue.shift() }); dialog.showSaveDialog = async () => ({ canceled: false, filePath: globalThis.saveQueue.shift() }); });
    return p;
  }
  const strokes = p => p.evaluate(() => [...document.querySelector('.original-pages').inkDoc.strokes.values()].map(s => ({ id: s.id, tool: s.tool, shape: s.shape, from: s.from, text: s.text, quote: s.quote, style: s.style, n: s.points.length, x: s.points[0] })));
  const saved = p => p.locator('.ink-status[data-state="saved"][data-touched]').waitFor({ state: 'attached' });
  try {
    let p = await launch();
    await app.evaluate((_, v) => globalThis.openQueue.push([v]), vault); await p.locator('[data-action="storage"]').first().click();
    await app.evaluate((_, f) => globalThis.openQueue.push([f]), path.join(temp, 'paper.pdf')); await p.locator('[data-action="add-files"]').first().click();
    await p.locator('.paper-item').click(); await p.locator('.original-pages .page[data-page="1"] .textLayer span').first().waitFor();
    const page = await p.locator('.original-pages .page[data-page="1"]').boundingBox(), at = (fx, fy) => [page.x + page.width * fx, page.y + page.height * fy];
    const drag = async (from, to, steps = 8) => { await p.mouse.move(...at(...from)); await p.mouse.down(); await p.mouse.move(...at(...to), { steps }); await p.mouse.up(); };

    // Toolbar: icon buttons named on hover, and each tool its own pointer.
    const bar = p.locator('.ink-toolbar');
    for (const tool of ['read', 'pen', 'highlighter', 'text', 'shape', 'lasso', 'eraser']) { const b = bar.locator(`[data-ink-tool="${tool}"]`); assert.ok(await b.getAttribute('aria-label'), tool); assert.equal((await b.textContent()).trim(), '', tool); assert.equal(await b.locator('svg').count(), 1, tool); }
    assert.equal(await p.locator('[data-ink-touch]').count(), 0, 'touch writing is hidden until a pen or touch screen is seen');
    await bar.locator('[data-ink-tool="pen"]').hover(); await p.locator('.ink-tip').filter({ hasText: /^펜 · Ctrl\+2$/ }).waitFor();
    await p.mouse.move(5, 940); await p.locator('.ink-tip').waitFor({ state: 'hidden' });
    const layer = p.locator('.original-pages .page[data-page="1"] .app-ink-layer'); await layer.waitFor({ state: 'attached' });
    const cursor = () => layer.evaluate(n => getComputedStyle(n).cursor);
    await bar.locator('[data-ink-tool="pen"]').click(); const pen = await cursor();
    await p.locator('[data-ink-color="#dc2626"]').click(); const red = await cursor();
    await bar.locator('[data-ink-tool="eraser"]').click(); const eraser = await cursor();
    assert.match(pen, /^url\("data:image\/svg\+xml/); assert.match(eraser, /^url\(/); assert.notEqual(pen, red, 'pen pointer follows the colour'); assert.notEqual(pen, eraser);
    await bar.locator('[data-ink-tool="read"]').click(); assert.doesNotMatch(await cursor(), /url\(/);
    // The view switch sits in the middle of the top bar, with search, 작업 and 저장소 연결 on its right;
    // below, the list button and the writing tools share one line.
    const topBar = await p.evaluate(() => { const r = s => document.querySelector(s).getBoundingClientRect(), bar = r('.topbar'), modes = r('.topbar .reader-view-modes'), search = r('.topbar .search'), jobs = r('.topbar [data-action="jobs"]'); const pages = r('.pdf-pane, .reader-main, .reader'); return { crumb: document.querySelectorAll('.topbar .crumb').length, offCentre: Math.abs(modes.left + modes.width / 2 - (pages.left + pages.width / 2)), order: modes.right < search.left && search.right < jobs.left && !document.querySelector('.topbar [data-action="storage"]'), rows: [modes, search, jobs].map(x => Math.round(x.top + x.height / 2)) }; });
    assert.ok(topBar.crumb === 0 && topBar.offCentre < 2 && topBar.order && Math.max(...topBar.rows) - Math.min(...topBar.rows) <= 2, JSON.stringify(topBar));
    assert.deepEqual(await bar.locator('.ink-tools [data-ink-tool]').evaluateAll(list => list.map(b => b.dataset.inkTool)), ['read', 'pen', 'highlighter', 'eraser', 'shape', 'lasso', 'text'], 'the eraser follows the highlighter; the page memo comes last');
    // The sidebar button stands at the top bar's left end (always there) and ← 라이브러리 right after it, on the view switch's line; the tool row starts at its own left edge.
    const row = await p.evaluate(() => { const r = s => document.querySelector(s).getBoundingClientRect(), back = r('.topbar [data-action="back"]'), modes = r('.topbar .reader-view-modes'), bar = document.querySelector('.reader-mode-toolbar'), tools = r('.reader-mode-toolbar .ink-toolbar'); return { inToolbar: bar.querySelectorAll('[data-action="back"]').length, gap: Math.round(back.left - r('.topbar [data-sidebar-open="left"]').right), first: Math.round(r('.topbar [data-sidebar-open="left"]').left - r('.topbar').left - parseFloat(getComputedStyle(document.querySelector('.topbar')).paddingLeft)), before: back.right <= modes.left, line: Math.round(Math.abs(back.top + back.height / 2 - (modes.top + modes.height / 2))), toolsLeft: Math.round(tools.left - bar.getBoundingClientRect().left - parseFloat(getComputedStyle(bar).paddingLeft)) }; });
    assert.ok(row.inToolbar === 0 && row.before && row.first >= 0 && row.first <= 2 && row.gap >= 0 && row.gap <= 16 && row.line <= 3 && row.toolsLeft <= 2, JSON.stringify(row));
    // An added colour joins the palette, is chosen (the pen is picked up), is kept with the other pen settings and goes with a right click.
    await bar.locator('[data-ink-add-color]').click(); await p.locator('.ink-color-panel').waitFor(); assert.equal(await p.locator('.ink-color-panel [data-ink-recent]').count(), 0, 'no colours used lately yet');
    await p.locator('.ink-color-panel [data-ink-swatch-custom]').evaluate(input => { input.value = '#7c3aed'; input.dispatchEvent(new Event('change', { bubbles: true })); });
    await p.locator('.ink-toolbar [data-ink-custom][data-ink-color="#7c3aed"][aria-pressed="true"]').waitFor();
    assert.equal(await p.evaluate(() => [globalThis.appInk.tool, globalThis.appInk.color.pen]).then(String), 'pen,#7c3aed');
    assert.deepEqual(await p.evaluate(() => JSON.parse(localStorage.getItem('app-ink')).custom), { pen: ['#7c3aed'], highlighter: [] });
    // A colour just picked is in the recent colours right away (not only once it leaves the bar).
    await bar.locator('[data-ink-add-color]').click(); await p.locator('.ink-color-panel [data-ink-swatch="#7c3aed"]').waitFor(); await p.keyboard.press('Escape'); await p.locator('.ink-color-panel').waitFor({ state: 'detached' });
    await p.locator('.ink-toolbar [data-ink-custom]').click({ button: 'right' }); await p.locator('.ink-toolbar [data-ink-custom]').waitFor({ state: 'detached' });
    assert.equal(await p.evaluate(() => globalThis.appInk.color.pen), '#1f2937', 'removing the chosen colour falls back to the first');
    // A colour used before comes back from + (recent colours, kept with the pen settings).
    await bar.locator('[data-ink-add-color]').click(); await p.locator('.ink-color-panel [data-ink-swatch="#7c3aed"]').click();
    await p.locator('.ink-toolbar [data-ink-custom][data-ink-color="#7c3aed"][aria-pressed="true"]').waitFor(); const recentPen = await p.evaluate(() => JSON.parse(localStorage.getItem('app-ink')).recent.pen); assert.equal(recentPen[0], '#7c3aed'); assert.ok(recentPen.length <= 6 && new Set(recentPen).size === recentPen.length);
    await p.locator('.ink-toolbar [data-ink-custom]').click({ button: 'right' }); await p.locator('.ink-toolbar [data-ink-custom]').waitFor({ state: 'detached' });
    assert.equal(await p.evaluate(() => globalThis.appInk.color.highlighter), '#fffc00', 'the pastel yellow');
    await p.locator('.ink-toolbar [data-ink-tool="read"]').click();

    // Highlight of selected text (selected in reading mode).
    await p.evaluate(() => { const span = document.querySelector('.original-pages .page[data-page="1"] .textLayer span'), range = document.createRange(); range.selectNodeContents(span); getSelection().removeAllRanges(); getSelection().addRange(range); });
    await p.locator('[data-ink-mark]').click(); await saved(p);
    assert.match((await strokes(p)).find(s => s.tool === 'mark').quote, /A research paper connects ideas/);
    // Right-click on selected text: underline, and an annotation that marks its place on the page.
    const pick = () => p.evaluate(() => { const span = document.querySelector('.original-pages .page[data-page="1"] .textLayer span'), range = document.createRange(); range.selectNodeContents(span); getSelection().removeAllRanges(); getSelection().addRange(range); });
    await pick(); await p.locator('.original-pages .page[data-page="1"] .textLayer span').first().click({ button: 'right' });
    assert.deepEqual(await p.locator('.ink-text-menu [data-ink-text] span:not(.icon)').allTextContents(), ['밑줄 긋기', '하이라이트', '주석 추가', '복사']);
    assert.deepEqual(await p.locator('.ink-text-menu [data-ink-text] kbd').allTextContents(), ['U', 'H', 'N', 'Ctrl+C'], 'each with its key');
    assert.equal(new Set(await p.locator('.ink-text-menu [data-ink-text]').evaluateAll(n => n.map(b => Math.round(b.getBoundingClientRect().top)))).size, 1, 'the right-click actions side by side');
    await p.locator('[data-ink-text="underline"]').click(); await saved(p);
    assert.equal((await strokes(p)).filter(s => s.tool === 'mark' && s.style === 'underline').length, 1);
    // Selecting with the mouse shows the same actions as a bar, no right-click needed; U · H · N act on the selection.
    const textLine = await p.locator('.original-pages .page[data-page="1"] .textLayer span').first().boundingBox();
    await p.mouse.move(textLine.x + 2, textLine.y + textLine.height / 2); await p.mouse.down(); await p.mouse.move(textLine.x + textLine.width - 2, textLine.y + textLine.height / 2, { steps: 6 }); await p.mouse.up();
    await p.locator('.ink-select-bar').waitFor(); assert.deepEqual(await p.locator('.ink-select-bar kbd').allTextContents(), ['U', 'H', 'N', 'Ctrl+C']);
    assert.equal(new Set(await p.locator('.ink-select-bar [data-ink-text]').evaluateAll(n => n.map(b => Math.round(b.getBoundingClientRect().top)))).size, 1, 'one row');
    // A colour dot beside 밑줄 긋기 and 하이라이트 shows the colour each will use; pressed, it offers that tool's colours, and
    // the one chosen marks the selection at once and becomes the tool's colour.
    assert.deepEqual(await p.locator('.ink-select-bar [data-ink-text-color]').evaluateAll(n => n.map(b => b.dataset.inkTextColor)), ['underline', 'highlight']);
    const markColours = async () => p.evaluate(() => ({ ...inkState.color })), wasColours = await markColours();
    await p.locator('.ink-select-bar [data-ink-text-color="highlight"]').click(); const swatches = p.locator('.ink-text-swatches [data-ink-text-swatch]');
    assert.ok(await swatches.count() >= 4, 'the highlighter colours'); assert.equal(await p.locator('.ink-text-swatches [aria-pressed="true"]').getAttribute('data-ink-text-swatch'), wasColours.highlighter);
    assert.ok(await p.evaluate(() => { const r = document.querySelector('.ink-text-swatches').getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight; }), 'the colours are in the window');
    const other = await swatches.evaluateAll((n, was) => n.map(b => b.dataset.inkTextSwatch).find(c => c !== was), wasColours.highlighter), marksBefore = (await strokes(p)).filter(s => s.tool === 'mark' && !s.style).length;
    await p.locator(`.ink-text-swatches [data-ink-text-swatch="${other}"]`).click(); await saved(p);
    const made = (await strokes(p)).filter(s => s.tool === 'mark' && !s.style); assert.equal(made.length, marksBefore + 1, 'the selection is highlighted'); assert.equal(await p.evaluate(() => [...document.querySelector('.original-pages').inkDoc.strokes.values()].filter(s => s.tool === 'mark' && !s.style).at(-1).color), other, 'in the colour chosen');
    assert.deepEqual(await markColours(), { ...wasColours, highlighter: other }, 'which is now the highlighter\'s colour; the pen keeps its own'); assert.equal(await p.locator('.ink-text-menu').count(), 0);
    await p.keyboard.press('Control+z'); await saved(p); await p.evaluate(was => { inkState.color.highlighter = was; persistInkPrefs(); inkToolbarState(); }, wasColours.highlighter);
    await p.mouse.move(textLine.x + 2, textLine.y + textLine.height / 2); await p.mouse.down(); await p.mouse.move(textLine.x + textLine.width - 2, textLine.y + textLine.height / 2, { steps: 6 }); await p.mouse.up(); await p.locator('.ink-select-bar').waitFor();
    const marks = async () => (await strokes(p)).filter(s => s.tool === 'mark').length, markCount = await marks();
    await p.keyboard.press('h'); await saved(p); assert.equal(await marks(), markCount + 1, 'H highlights'); await p.locator('.ink-select-bar').waitFor({ state: 'detached' });
    await p.keyboard.press('Control+z'); await saved(p); assert.equal(await marks(), markCount);
    await pick(); await p.keyboard.press('u'); await saved(p); assert.equal(await marks(), markCount + 1, 'U underlines');
    await p.keyboard.press('Control+z'); await saved(p);
    // The eraser (whole strokes) takes highlights and underlines too; one undo brings them back.
    await p.locator('[data-ink-tool="eraser"]').click(); await p.mouse.move(textLine.x + 4, textLine.y + textLine.height / 2); await p.mouse.down(); await p.mouse.move(textLine.x + 40, textLine.y + textLine.height / 2, { steps: 5 }); await p.mouse.up(); await saved(p);
    assert.equal(await marks(), 0, 'erased'); await p.keyboard.press('Control+z'); await saved(p); assert.equal(await marks(), markCount);
    await p.locator('.ink-toolbar [data-ink-tool="read"]').click();
    await pick(); await p.locator('.original-pages .page[data-page="1"] .textLayer span').first().click({ button: 'right' }); await p.locator('[data-ink-text="annotate"]').click();
    await p.locator('#annotation-body').waitFor(); assert.equal(await p.locator('#annotation-page').inputValue(), '1'); assert.match(await p.locator('#annotation-quote').inputValue(), /A research paper connects ideas/);
    await p.locator('#annotation-body').fill('여기 확인'); await p.locator('[data-action="save-annotation"]').click(); await p.locator('#toast').filter({ hasText: '1쪽에 주석을 저장했습니다' }).waitFor();
    await p.locator('.original-pages .page[data-page="1"] .annotation-pin').waitFor(); const span = p.locator('.original-pages .page[data-page="1"] .annotation-span').first(); assert.equal(await span.evaluate(n => getComputedStyle(n).opacity), '0', 'only the pin shows'); await p.locator('.original-pages .page[data-page="1"] .annotation-pin').hover(); await p.waitForFunction(() => getComputedStyle(document.querySelector('.annotation-span')).opacity === '1');
    assert.ok((await p.evaluate(() => itemAnnotations.at(-1).rects)).length >= 1);
    // Opening the note from its pin switches the side panel only: the pages stay where they were.
    const scrolled = await p.locator('.original-pages').evaluate(c => { c.scrollTop = 30; return c.scrollTop; });
    { const b = await p.locator('.original-pages .page[data-page="1"] .annotation-pin').boundingBox(); await p.mouse.click(b.x + b.width / 2, b.y + b.height / 2); } await p.locator('.annotation[data-annotation-card]').filter({ hasText: '여기 확인' }).waitFor();
    assert.equal(await p.locator('.original-pages').evaluate(c => c.scrollTop), scrolled, 'the pages keep their place'); await p.locator('.original-pages').evaluate(c => { c.scrollTop = 0; });
    // Page memo.
    // Text box: edited in place on the page (24 pt by default) with a format bar above it; a press outside finishes it.
    await p.locator('[data-ink-tool="text"]').click(); await p.mouse.click(...at(.5, .4));
    const textArea = p.locator('.original-pages .ink-text-editor textarea'); await textArea.waitFor(); assert.ok(await textArea.evaluate(n => n === document.activeElement), 'typing goes straight into the box');
    assert.equal(await p.locator('.ink-text-bar [data-tb="size"]').inputValue(), '24');
    const barBox = await p.locator('.ink-text-bar').boundingBox(), editorBox = await p.locator('.ink-text-editor').boundingBox(); assert.ok(barBox.y + barBox.height <= editorBox.y, 'the bar is above the box');
    await p.keyboard.type('확인할 부분'); await p.keyboard.press('Control+b');
    await p.locator('.ink-text-bar [data-tb="color"]').click(); await p.locator('.ink-text-pop').filter({ hasText: '텍스트 색상' }).waitFor(); assert.equal(await p.locator('.ink-text-pop .ink-text-row').first().locator('[data-tb-color]').count(), 5);
    assert.deepEqual(await p.locator('.ink-text-pop .ink-text-row').nth(1).locator('[data-tb-color]').evaluateAll(l => l.map(b => b.dataset.tbColor)), ['#1f2937', '#1d4ed8', '#dc2626', '#047857', '#7c3aed'], 'the second row: the pen colours and a violet, five like the others');
    // The colour panel sits above the bar with its tail at the colour button; the chosen colour is marked.
    { const pop = await p.locator('.ink-text-pop').boundingBox(), bar = await p.locator('.ink-text-bar').boundingBox(); assert.ok(pop.y + pop.height <= bar.y, 'the colour panel is above the bar'); }
    assert.equal(await p.locator('.ink-text-pop [aria-pressed="true"] svg').count(), 1, 'the chosen colour has its mark');
    // A colour picked with the colour wheel stays on the panel's last row (kept on this computer).
    await p.locator('.ink-text-pop [data-tb-custom]').fill('#8a4b3c'); await p.locator('.ink-text-pop').waitFor({ state: 'detached' });
    await p.locator('.ink-text-bar [data-tb="color"]').click(); await p.locator('.ink-text-pop [data-tb-added][data-tb-color="#8a4b3c"][aria-pressed="true"]').waitFor();
    await p.locator('.ink-text-pop [data-tb-color="#9f1239"]').click(); await p.locator('.ink-text-pop').waitFor({ state: 'detached' });
    assert.equal(await p.locator('.ink-text-bar [data-tb="color"] span').evaluate(n => getComputedStyle(n).backgroundColor), 'rgb(159, 18, 57)', 'the bar button shows the colour');
    await p.locator('.ink-text-bar [data-tb="align"]').click(); await p.locator('.ink-text-bar [data-tb="size"]').selectOption('32');
    assert.ok(await textArea.evaluate(n => n === document.activeElement), 'the text keeps its focus');
    if (process.env.APP_INK_SCREENSHOT) await p.screenshot({ path: process.env.APP_INK_SCREENSHOT + '-textbox.png' });
    await p.mouse.click(...at(.2, .85)); await saved(p); await p.locator('.ink-text-editor').waitFor({ state: 'detached' }); assert.equal(await p.locator('.ink-text-bar').count(), 0);
    { const box = (await p.evaluate(() => [...document.querySelector('.original-pages').inkDoc.strokes.values()])).find(s => s.tool === 'text');
      assert.deepEqual([box.text, box.width, box.color, box.bold, box.align, box.w > 0], ['확인할 부분', 32, '#9f1239', true, 'center', true]);
      assert.equal((await strokes(p)).filter(s => s.tool === 'text').length, 1, 'the press outside made no second box'); }
    assert.equal(await p.evaluate(() => globalThis.appInk.tool), 'read', 'after placing a text box the select tool comes back');
    // Shape: a rectangle as one pen stroke.
    await p.locator('[data-ink-tool="shape"]').click(); await drag([.2, .5], [.4, .6]); await saved(p);
    assert.equal((await strokes(p)).find(s => s.shape === 'rect').n, 20);
    // Other shapes are chosen in the menu below the shape button, not a side list.
    assert.equal(await p.locator('select[data-ink-shape]').count(), 0);
    await p.locator('[data-ink-tool="shape"]').click(); await p.locator('[data-ink-flyout="shape"]').waitFor();
    await p.locator('[data-ink-pick="shape"][data-value="ellipse"]').click(); await p.locator('[data-ink-flyout]').waitFor({ state: 'detached' });
    assert.equal(await p.locator('[data-ink-tool="shape"]').getAttribute('aria-label'), '타원');
    await drag([.6, .5], [.8, .6]); await saved(p);
    assert.ok((await strokes(p)).some(s => s.shape === 'ellipse'));
    await p.keyboard.press('Control+z'); await saved(p);
    // The rectangle runs corner to corner: its top-right corner is inked (the pen's smoothing used to round it into a "D").
    const corner = await p.evaluate(() => { const c = document.querySelector('.original-pages .page[data-page="1"] .app-ink-layer'), v = document.querySelector('.original-pages').pdfViewer.getPageView(0).viewport, s = [...document.querySelector('.original-pages').inkDoc.strokes.values()].find(s => s.shape === 'rect'), k = c.width / v.width, xs = [], ys = [];
      for (let i = 0; i < s.points.length; i += 4) { const [x, y] = v.convertToViewportPoint(s.points[i], s.points[i + 1]); xs.push(x); ys.push(y); }
      const d = c.getContext('2d').getImageData(Math.round(Math.max(...xs) * k) - 1, Math.round(Math.min(...ys) * k) - 1, 3, 3).data; let a = 0; for (let i = 3; i < d.length; i += 4) a = Math.max(a, d[i]); return a; });
    assert.ok(corner > 100, 'rectangle corner drawn: ' + corner);
    // Five shapes in the menu; a triangle and an arrow are drawn from it.
    await p.locator('[data-ink-tool="shape"]').click(); await p.locator('[data-ink-flyout="shape"]').waitFor();
    assert.deepEqual(await p.locator('[data-ink-pick="shape"]').evaluateAll(list => list.map(b => b.dataset.value)), ['rect', 'ellipse', 'triangle', 'line', 'arrow']);
    await p.locator('[data-ink-pick="shape"][data-value="triangle"]').click(); await drag([.6, .5], [.8, .6]); await saved(p);
    await p.locator('[data-ink-tool="shape"]').click(); await p.locator('[data-ink-pick="shape"][data-value="arrow"]').click(); await drag([.6, .62], [.8, .55]); await saved(p);
    assert.deepEqual((await strokes(p)).filter(s => ['triangle', 'arrow'].includes(s.shape)).map(s => [s.shape, s.n]), [['triangle', 16], ['arrow', 20]]);
    await p.keyboard.press('Control+z'); await saved(p); await p.keyboard.press('Control+z'); await saved(p);
    // Held-still recognition: a triangle (also begun mid-side), a rectangle; a highlighter line straightens and levels, a wavy one does not.
    const recognised = await p.evaluate(() => { const ink = globalThis.appInk, pts = list => { const out = []; for (let i = 0; i < list.length - 1; i++) for (let j = 0; j < 12; j++) { const t = j / 12; out.push(list[i][0] + (list[i + 1][0] - list[i][0]) * t, list[i][1] + (list[i + 1][1] - list[i][1]) * t, .5, 0); } out.push(...list.at(-1), .5, 0); return out; };
      return { triangle: ink.recognizeShape(pts([[50, 10], [90, 80], [10, 80], [50, 12]]))?.shape, midSide: ink.recognizeShape(pts([[30, 80], [10, 80], [50, 10], [90, 80], [32, 80]]))?.shape, rect: ink.recognizeShape(pts([[10, 10], [90, 10], [90, 70], [10, 70], [10, 12]]))?.shape, straight: JSON.stringify(ink.straighten(pts([[10, 50], [60, 52], [110, 51]]))), wavy: ink.straighten(pts([[10, 50], [40, 80], [70, 20], [110, 50]])) }; });
    assert.deepEqual(recognised, { triangle: 'triangle', midSide: 'triangle', rect: 'rect', straight: JSON.stringify({ shape: 'line', from: [10, 50], to: [110, 50] }), wavy: null });
    // Thickness presets: a dot per preset; the chosen one, pressed again, opens a slider that adjusts it (kept with the pen settings).
    await bar.locator('[data-ink-tool="pen"]').click(); await p.locator('[data-ink-size="2"]').click();
    assert.equal(await p.evaluate(() => globalThis.appInk.width.pen), 3);
    await p.locator('[data-ink-size="2"]').click(); await p.locator('.ink-size-pop input').waitFor();
    await p.evaluate(() => { const input = document.querySelector('.ink-size-pop input'); input.value = '4'; input.dispatchEvent(new Event('input', { bubbles: true })); });
    assert.equal(await p.evaluate(() => globalThis.appInk.width.pen), 4); assert.deepEqual(await p.evaluate(() => JSON.parse(localStorage.getItem('app-ink')).sizes.pen), [.75, 1.5, 4]);
    await p.mouse.click(5, 940); await p.locator('.ink-size-pop').waitFor({ state: 'detached' });
    await p.locator('[data-ink-size="1"]').click(); assert.equal(await p.evaluate(() => globalThis.appInk.width.pen), 1.5);
    // Lasso the rectangle and move it; one undo puts it back.
    await p.locator('[data-ink-tool="lasso"]').click();
    await p.mouse.move(...at(.15, .45)); await p.mouse.down(); for (const pt of [[.45, .45], [.45, .65], [.15, .65], [.15, .46]]) await p.mouse.move(...at(...pt), { steps: 4 }); await p.mouse.up();
    await p.locator('.ink-selection').waitFor();
    // Over the selection the pointer is a hand (closed while dragging); off it, the lasso again.
    await p.mouse.move(...at(.3, .55)); assert.equal(await layer.evaluate(n => getComputedStyle(n).cursor), 'grab', 'over the selection the pointer is a hand');
    await p.mouse.down(); await p.mouse.move(...at(.3, .56)); assert.equal(await layer.evaluate(n => getComputedStyle(n).cursor), 'grabbing'); await p.mouse.move(...at(.3, .55)); await p.mouse.up();
    await p.mouse.move(...at(.7, .55)); assert.match(await layer.evaluate(n => getComputedStyle(n).cursor), /^url\(/, 'off the selection the pointer is the lasso again');
    const before = (await strokes(p)).find(s => s.shape === 'rect');
    await drag([.3, .55], [.3, .68]); await saved(p);
    const moved = (await strokes(p)).find(s => s.shape === 'rect');
    assert.equal(moved.from, before.id); assert.notEqual(moved.id, before.id);
    await p.keyboard.press('Control+z'); await saved(p);
    assert.equal((await strokes(p)).find(s => s.shape === 'rect').id, before.id, 'undo restores the original as one step');
    // The bar above a selection duplicates it; one undo takes the copy away.
    await p.mouse.move(...at(.15, .45)); await p.mouse.down(); for (const pt of [[.45, .45], [.45, .65], [.15, .65], [.15, .46]]) await p.mouse.move(...at(...pt), { steps: 4 }); await p.mouse.up();
    await p.locator('.ink-selection-actions [data-ink-selection="duplicate"]').click(); await saved(p);
    assert.equal((await strokes(p)).filter(s => s.shape === 'rect').length, 2);
    await p.keyboard.press('Control+z'); await saved(p); assert.equal((await strokes(p)).filter(s => s.shape === 'rect').length, 1);
    // The hand sits under the reading button (pressed again, it offers the
    // hand); it moves the lasso selection from anywhere on the page.
    assert.equal(await p.locator('[data-ink-group="lasso"],[data-ink-pick="lasso"]').count(), 0, 'the lasso is a tool of its own');
    await p.mouse.move(...at(.15, .45)); await p.mouse.down(); for (const pt of [[.45, .45], [.45, .65], [.15, .65], [.15, .46]]) await p.mouse.move(...at(...pt), { steps: 4 }); await p.mouse.up();
    await p.locator('.ink-selection').waitFor();
    await p.locator('[data-ink-group="pointer"]').click(); assert.equal(await p.locator('[data-ink-flyout]').count(), 0, 'choosing reading opens no menu');
    await p.locator('[data-ink-group="pointer"]').click(); await p.locator('[data-ink-flyout="pointer"]').waitFor();
    await p.locator('[data-ink-pick="pointer"][data-value="hand"]').click();
    assert.equal(await p.locator('[data-ink-group="pointer"]').getAttribute('data-ink-tool'), 'hand');
    assert.equal(await layer.evaluate(n => getComputedStyle(n).cursor), 'grab');
    await drag([.7, .55], [.7, .65]); await saved(p);
    const handMoved = (await strokes(p)).find(s => s.shape === 'rect');
    assert.equal(handMoved.from, before.id, 'dragged outside the box, the hand still moves the selection');
    // Away and back: the reading button keeps offering the hand last chosen.
    await bar.locator('[data-ink-tool="pen"]').click(); assert.equal(await p.locator('[data-ink-group="pointer"]').getAttribute('data-ink-tool'), 'hand');
    await p.locator('[data-ink-group="pointer"]').click(); await p.locator('[data-ink-group="pointer"]').click(); await p.locator('[data-ink-pick="pointer"][data-value="read"]').click();
    assert.equal(await p.evaluate(() => globalThis.appInk.tool), 'read');
    // The laser pointer, also under the reading button, leaves a trail that fades and is never stored.
    const stored = (await strokes(p)).length;
    await p.locator('[data-ink-group="pointer"]').click(); await p.locator('[data-ink-pick="pointer"][data-value="laser"]').click();
    await p.mouse.move(...at(.2, .3)); await p.mouse.down(); await p.mouse.move(...at(.5, .35), { steps: 6 });
    assert.equal(await p.locator('.original-pages .app-ink-laser').count(), 1);
    await p.mouse.up(); await p.locator('.original-pages .app-ink-laser').waitFor({ state: 'detached' });
    assert.equal((await strokes(p)).length, stored, 'the laser stores nothing');
    await p.locator('[data-ink-group="pointer"]').click(); await p.locator('[data-ink-pick="pointer"][data-value="read"]').click();
    // A pen whose lift never arrives (a remote pen app such as EasyCanvas can drop it) does not
    // leave a stroke open that swallows every later press.
    {
      await p.locator('[data-ink-tool="pen"]').click(); const before = (await strokes(p)).length;
      await p.evaluate(() => { const c = document.querySelector('.original-pages .page[data-page="1"] .app-ink-layer'), r = c.getBoundingClientRect(); c.setPointerCapture = () => {}; c.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 41, pointerType: 'pen', isPrimary: true, button: 0, buttons: 1, pressure: .5, clientX: r.left + r.width * .2, clientY: r.top + r.height * .6 })); delete c.setPointerCapture; });
      await p.waitForTimeout(1700);
      await drag([.2, .7], [.6, .72], 12); await saved(p);
      assert.equal((await strokes(p)).length, before + 2, 'the press whose lift never came is kept as written and the next stroke is written too');
      for (let i = 0; i < 2; i++) { await p.locator('[data-ink-undo]').click(); await saved(p); }
      assert.equal((await strokes(p)).length, before);
    }
    // Partial eraser cuts a pen line in two pieces.
    await p.locator('[data-ink-tool="pen"]').click(); await drag([.1, .3], [.9, .3], 20); await saved(p);
    const line = (await strokes(p)).find(s => s.tool === 'pen' && !s.shape && s.n > 40);
    // The eraser's kinds are under its button (pressed again): choosing never reflows the toolbar, so the page stays put.
    const pageTop = async () => (await p.locator('.original-pages .page[data-page="1"]').boundingBox()).y, top = await pageTop();
    await p.locator('[data-ink-tool="eraser"]').click(); assert.equal(await p.locator('[data-ink-flyout]').count(), 0);
    await p.locator('[data-ink-tool="eraser"]').click(); await p.locator('[data-ink-pick="eraser"][data-value="partial"]').click();
    assert.equal(await pageTop(), top); assert.equal(await p.locator('[data-ink-tool="eraser"]').getAttribute('aria-label'), '부분 지우개');
    await drag([.5, .28], [.5, .32], 4); await saved(p);
    const pieces = (await strokes(p)).filter(s => s.from === line.id);
    assert.equal(pieces.length, 2, 'the line is cut in two'); assert.ok(!(await strokes(p)).some(s => s.id === line.id));
    await p.locator('[data-ink-tool="read"]').click();
    // A pen reaching the app offers touch writing.
    await p.evaluate(() => document.querySelector('.original-pages').dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerType: 'pen' })));
    await p.locator('[data-ink-touch]').waitFor();

    // Export: Ink, Highlight and Text annotations.
    await app.evaluate((_, f) => globalThis.saveQueue.push(f), path.join(temp, 'out.pdf'));
    await p.locator('[data-action="ink-export-original"]').click(); await p.locator('#dialog #ink-export-include').check(); await p.locator('#dialog [data-action="ink-export-confirm"]').click();
    for (let i = 0; i < 100 && !(await fs.stat(path.join(temp, 'out.pdf')).catch(() => null)); i++) await p.waitForTimeout(100);
    const types = await p.evaluate(async bytes => { const pdfjs = await import('./pdfjs/pdf.mjs'), task = pdfjs.getDocument({ data: new Uint8Array(bytes), isEvalSupported: false }), d = await task.promise, list = await (await d.getPage(1)).getAnnotations(); await task.destroy(); return list.map(a => a.subtype + (a.contentsObj?.str ? ':' + a.contentsObj.str : '')).sort(); }, Array.from(await fs.readFile(path.join(temp, 'out.pdf'))));
    assert.ok(types.includes('Text:확인할 부분') && types.some(t => t.startsWith('Highlight:A research paper')) && types.some(t => t.startsWith('Underline:A research paper')) && types.filter(t => t === 'Ink').length === 3, types.join(', '));

    // Restart: everything back; editing the memo replaces it.
    await app.close(); p = await launch();
    await (await openNote(p)).waitFor(); await p.locator('.original-pages .page[data-page="1"] .app-ink-layer').waitFor();
    await p.waitForFunction(() => document.querySelector('.original-pages').inkDoc?.strokes.size === 6);
    await p.locator('[data-ink-touch]').waitFor(); // still offered after restart
    // The tool row can differ after a restart (the touch toggle is offered now), so the page is measured again.
    { const box = await p.locator('.original-pages .page[data-page="1"]').boundingBox(); await p.locator('[data-ink-tool="text"]').click(); await p.mouse.click(box.x + box.width * .51, box.y + box.height * .41); }
    const again = p.locator('.original-pages .ink-text-editor textarea'); assert.equal(await again.inputValue(), '확인할 부분'); assert.equal(await p.locator('.ink-text-bar [data-tb="size"]').inputValue(), '32');
    // After the restart: the picked colour is still on the panel, the next box starts in the colour used last,
    // and a right-click takes a picked colour off (without choosing it).
    assert.equal(await p.evaluate(() => globalThis.appInk.textBar.color), '#9f1239', 'the colour used last is kept');
    await p.locator('.ink-text-bar [data-tb="color"]').click(); const picked = p.locator('.ink-text-pop [data-tb-added][data-tb-color="#8a4b3c"]'); await picked.waitFor();
    await picked.click({ button: 'right' }); await picked.waitFor({ state: 'detached' }); assert.equal(await p.locator('.ink-text-pop [data-tb-color="#9f1239"]').getAttribute('aria-pressed'), 'true', 'the right-click chose nothing');
    assert.ok(await again.evaluate(a => a === document.activeElement), 'the text keeps its focus'); await p.keyboard.press('Escape'); await p.locator('.ink-text-pop').waitFor({ state: 'detached' });
    // Lists: chosen from the list button; Enter goes on to the next item (numbers follow), Tab indents, Enter on an empty item ends the list.
    await again.fill('고친 메모'); await p.locator('.ink-text-bar [data-tb="list"]').click();
    assert.deepEqual(await p.locator('.ink-text-pop [data-tb-list]').evaluateAll(l => l.map(b => b.dataset.tbList)), ['bullet', 'number', 'none']);
    await p.locator('.ink-text-pop [data-tb-list="number"]').click(); await p.locator('.ink-text-pop').waitFor({ state: 'detached' });
    await p.keyboard.press('End'); await p.keyboard.press('Enter'); await p.keyboard.type('둘째'); await p.keyboard.press('Enter'); await p.keyboard.press('Tab'); await p.keyboard.type('안쪽');
    await p.keyboard.press('Enter'); await p.keyboard.press('Enter'); await p.keyboard.type('끝');
    assert.equal(await again.inputValue(), '1. 고친 메모\n2. 둘째\n  1. 안쪽\n끝');
    assert.equal(await p.locator('.ink-text-bar [data-tb="list"]').getAttribute('aria-pressed'), 'false', 'out of the list');
    await p.keyboard.press('Control+z'); assert.equal(await again.inputValue(), '1. 고친 메모\n2. 둘째\n  1. 안쪽\n', 'undo still works');
    await p.keyboard.type('끝');
    if (process.env.APP_INK_SCREENSHOT) await p.screenshot({ path: process.env.APP_INK_SCREENSHOT + '-list.png' });
    await p.keyboard.press('Escape'); await saved(p); assert.equal(await p.evaluate(() => globalThis.appInk.tool), 'read', 'Esc finishes the box');
    assert.deepEqual((await strokes(p)).filter(s => s.tool === 'text').map(s => s.text), ['1. 고친 메모\n2. 둘째\n  1. 안쪽\n끝']);
    // Finished, the box is reached again with the reading tool as in the notebook: a press selects it (outline and ×),
    // a double click opens it.
    { const b = await p.locator('.original-pages .page[data-page="1"]').boundingBox(); await p.mouse.click(b.x + b.width * .51, b.y + b.height * .41); await p.locator('.original-pages .ink-text-selected [data-ink-text-remove]').waitFor(); assert.equal(await p.locator('.original-pages .ink-text-editor').count(), 0, 'one press only selects');
      await p.mouse.dblclick(b.x + b.width * .51, b.y + b.height * .41); }
    await p.locator('.original-pages .ink-text-editor textarea').waitFor(); assert.equal(await p.locator('.original-pages .ink-text-editor textarea').inputValue(), '1. 고친 메모\n2. 둘째\n  1. 안쪽\n끝');
    await p.keyboard.press('Escape'); await p.locator('.ink-text-editor').waitFor({ state: 'detached' }); assert.equal(await p.evaluate(() => globalThis.appInk.tool), 'read');
    assert.equal((await strokes(p)).filter(s => s.tool === 'text').length, 1, 'opening and closing changes nothing');
    // Draw and hold: a rough rectangle held still becomes a clean one; a curve lifted at once stays as drawn.
    await p.locator('[data-ink-tool="pen"]').click();
    // The steps below draw between 45% and 70% of the page: that part is scrolled into view first, whatever the tool row's height.
    await p.evaluate(() => { const c = document.querySelector('.original-pages'), page = c.querySelector('.page[data-page="1"]'); c.scrollTop += page.getBoundingClientRect().top - c.getBoundingClientRect().top + page.offsetHeight * .38; }); await p.waitForTimeout(200);
    const box1 = await p.locator('.original-pages .page[data-page="1"]').boundingBox(), at1 = (fx, fy) => [box1.x + box1.width * fx, box1.y + box1.height * fy];
    await p.mouse.move(...at1(.6, .5)); await p.mouse.down();
    for (const [x, y] of [[.85, .501], [.851, .6], [.6, .599], [.601, .505]]) await p.mouse.move(...at1(x, y), { steps: 10 });
    await p.waitForTimeout(650); await p.mouse.up(); await saved(p);
    const snapped = (await strokes(p)).filter(s => s.shape === 'rect' && s.n === 20 && !s.from).at(-1); assert.ok(snapped, 'the held stroke became a rectangle');
    await p.mouse.move(...at1(.6, .68)); await p.mouse.down(); for (const [x, y] of [[.65, .64], [.7, .68], [.75, .64], [.8, .68]]) await p.mouse.move(...at1(x, y), { steps: 6 }); await p.mouse.up(); await saved(p);
    assert.ok((await strokes(p)).some(s => s.tool === 'pen' && !s.shape && s.x > 0 && s.n > 40), 'an unheld curve stays as drawn');
    // A highlighter stroke held still becomes a straight, level line.
    await p.locator('[data-ink-tool="highlighter"]').click(); await p.mouse.move(...at1(.1, .45)); await p.mouse.down();
    for (const [x, y] of [[.2, .453], [.3, .447], [.4, .451]]) await p.mouse.move(...at1(x, y), { steps: 10 });
    await p.waitForTimeout(650); await p.mouse.up(); await saved(p);
    const level = await p.evaluate(() => [...document.querySelector('.original-pages').inkDoc.strokes.values()].filter(s => s.tool === 'highlighter' && s.shape === 'line').map(s => s.points));
    assert.ok(level.length === 1 && level[0].length === 8 && level[0][1] === level[0][5], JSON.stringify(level));
    // The lasso selection's corner handle scales it; a colour recolours it (the pen keeps its colour).
    await p.locator('[data-ink-tool="lasso"]').click();
    await p.mouse.move(...at1(.57, .47)); await p.mouse.down(); for (const pt of [[.88, .47], [.88, .62], [.57, .62], [.57, .48]]) await p.mouse.move(...at1(...pt), { steps: 4 }); await p.mouse.up();
    const width = id => p.evaluate(id => { const s = [...document.querySelector('.original-pages').inkDoc.strokes.values()].find(s => s.id === id || s.from === id), xs = s.points.filter((_, i) => i % 4 === 0); return { id: s.id, w: Math.max(...xs) - Math.min(...xs) }; }, id);
    const unscaled = await width(snapped.id);
    const handle = await p.locator('.ink-selection .ink-handle').boundingBox(); await p.mouse.move(handle.x + 6, handle.y + 6); await p.mouse.down(); await p.mouse.move(handle.x + 66, handle.y + 36, { steps: 6 }); await p.mouse.up(); await saved(p);
    const after = await width(snapped.id);
    assert.notEqual(after.id, snapped.id, 'the scaled rectangle replaced the original'); assert.ok(after.w > unscaled.w * 1.15, `scaled ${unscaled.w} -> ${after.w}`);
    await p.locator('.ink-toolbar [data-ink-color="#047857"]').click(); await saved(p);
    const recoloured = await p.evaluate(id => [...document.querySelector('.original-pages').inkDoc.strokes.values()].find(s => s.from === id), after.id);
    assert.equal(recoloured.color, '#047857'); assert.equal(await p.evaluate(() => globalThis.appInk.color.pen), '#1f2937', 'the pen keeps its colour');
    await p.locator('[data-ink-tool="read"]').click();
    // Page thumbnails beside the original mark the current page.
    await p.locator('[data-action="reader-thumbs"]').click(); await p.locator('.page-thumbs [data-thumb-page="1"].current').waitFor();
    await p.locator('[data-action="reader-thumbs"]').click(); await p.locator('.page-thumbs').waitFor({ state: 'detached' });
    // Everything marked on the source, gathered in page order and appended to the paper note.
    await p.evaluate(() => { notes[`${state.selected}-메모`] = '기존 메모'; actions['collect-annotations'](); });
    await p.locator('#dialog .annotation-collection').waitFor();
    const gathered = await p.locator('#dialog .annotation-collection li').allTextContents();
    assert.ok(gathered.some(t => t.includes('A research paper connects ideas.')) && gathered.some(t => t.includes('고친 메모')), gathered.join(' / '));
    await p.locator('#dialog [data-action="collect-annotations-note"]').click(); await p.locator('#toast').filter({ hasText: '메모에 추가' }).waitFor();
    const note = await p.evaluate(() => notes[`${state.selected}-메모`]);
    assert.match(note, /^기존 메모\n\n— 주석 모음 .*—\n\(p\. 1\) "A research paper connects ideas\."/); assert.match(note, /\(p\. 1\) 텍스트 상자: 1\. 고친 메모/);
    await app.close(); app = null;
    console.log('Ink tools smoke passed: straight rectangle corners, triangle and arrow shapes, triangle recognition, held highlighter lines, thickness presets with a slider, lasso duplicate, laser pointer, draw-and-hold shapes, a hand over the lasso selection, lasso resize and recolour, page thumbnails, annotations gathered into the note, text highlight, page memo, shape, lasso move with one-step undo, partial eraser, standard annotations on export, restart; icon tools named on hover, shape menu, hand under the reading button, added colours, view switch in the top bar, one-line toolbar, tool-shaped pointers, touch writing offered once a pen is seen.');
  } catch (error) { try { await (await app.firstWindow()).screenshot({ path: path.join(os.tmpdir(), `${appName.id}-tools-failure.png`) }); } catch {} throw error; }
  finally { if (app) await app.close(); await fs.rm(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }).catch(error => console.warn(`임시 폴더를 다 지우지 못했습니다(${error.code}). 테스트 결과와는 무관합니다: ${temp}`)); }
})().catch(error => { console.error(error); process.exit(1); });
