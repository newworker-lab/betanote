// End-to-end check of a text box's fill and border in the real app, on a PDF page and in a notebook: a new box has
// neither (nothing drawn around its text), the format bar's 상자 모양 panel sets a fill and a border (colour, width,
// line) and stays open while one chooses, one Ctrl+Z takes the change back and Ctrl+Shift+Z brings it again, and the
// look is kept after a restart. Opening a box to edit it and finishing it move none of its letters (PDF page and
// notebook, within a pixel). APP_TEST_SOURCE=1 runs the source.
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
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), `${appName.id}-textbox-e2e-`)), vault = path.join(temp, 'vault'); await fs.mkdir(vault);
  const doc = await PDFDocument.create(), font = await doc.embedFont(StandardFonts.Helvetica); doc.addPage([600, 800]).drawText('A research paper connects ideas.', { x: 40, y: 740, size: 14, font });
  await fs.writeFile(path.join(temp, 'paper.pdf'), await doc.save());
  const executable = require('./app-executable.cjs')(root);
  const env = /utf-?8/i.test(process.env.LC_ALL || process.env.LANG || '') ? process.env : { ...process.env, LC_ALL: 'C.UTF-8', LANG: 'C.UTF-8' };
  let app;
  async function launch() {
    app = await electron.launch({ env, executablePath: executable, args: [...(process.env.APP_TEST_SOURCE === '1' ? [root] : []), '--no-sandbox', '--ozone-platform=headless', '--disable-gpu', `--user-data-dir=${path.join(temp, 'profile')}`], timeout: 20000 });
    const p = await app.firstWindow(); p.setDefaultTimeout(15000); await p.setViewportSize({ width: 1300, height: 950 });
    p.on('pageerror', e => { console.error(e); process.exitCode = 1; }); p.on('console', m => { if (m.type() === 'error') { console.error('renderer:', m.text()); process.exitCode = 1; } });
    await app.evaluate(({ dialog }) => { globalThis.openQueue = []; dialog.showOpenDialog = async () => ({ canceled: false, filePaths: globalThis.openQueue.shift() }); });
    return p;
  }
  const saved = p => p.locator('.ink-status[data-state="saved"][data-touched]').waitFor({ state: 'attached' });
  const boxes = p => p.evaluate(() => [...document.querySelector('.original-pages').inkDoc.strokes.values()].filter(s => s.tool === 'text').map(s => ({ id: s.id, text: s.text, fill: s.fill, border: s.border })));
  // What the ink layer drew near the box ([r, g, b, a]): in its padding (half way from the text to the box's edge) or
  // just outside the box.
  const inkAt = (p, where) => p.evaluate(where => {
    const pane = document.querySelector('.original-pages'), view = pane.pdfViewer.getPageView(0), stroke = [...pane.inkDoc.strokes.values()].find(s => s.tool === 'text');
    const canvas = view.div.querySelector(':scope>.app-ink-layer'), k = canvas.width / view.viewport.width, [x, y] = view.viewport.convertToViewportPoint(stroke.points[0], stroke.points[1]);
    const frame = globalThis.appInkMarks.textBoxFrame(stroke), u = inkScale(view.viewport), d = where === 'padding' ? frame.pad / 2 * u : frame.out * u + 6;
    return [...canvas.getContext('2d').getImageData(Math.round((x - d) * k), Math.round((y - d) * k), 1, 1).data];
  }, where);
  // Where a box's red letters are in a screenshot (decoded in the page; pink edges count, as small text is mostly edge).
  const redBox = async (p, clip) => { const buf = await p.screenshot({ clip }); return p.evaluate(async b64 => {
    const img = await createImageBitmap(new Blob([Uint8Array.from(atob(b64), c => c.charCodeAt(0))], { type: 'image/png' })), c = new OffscreenCanvas(img.width, img.height), x = c.getContext('2d'); x.drawImage(img, 0, 0);
    const { data, width, height } = x.getImageData(0, 0, img.width, img.height); let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
    for (let y = 0; y < height; y++) for (let i = 0; i < width; i++) { const k = (y * width + i) * 4, r = data[k], g = data[k + 1], b = data[k + 2]; if (r > 150 && r - g > 45 && r - b > 45 && Math.abs(g - b) < 30) { x0 = Math.min(x0, i); x1 = Math.max(x1, i); y0 = Math.min(y0, y); y1 = Math.max(y1, y); } }
    return [x0, y0, x1, y1]; }, buf.toString('base64')); };
  const moved = (a, b) => Math.max(...a.map((v, i) => Math.abs(v - b[i])));
  try {
    let p = await launch();
    await app.evaluate((_, v) => globalThis.openQueue.push([v]), vault); await p.locator('[data-action="storage"]').first().click();
    await app.evaluate((_, f) => globalThis.openQueue.push([f]), path.join(temp, 'paper.pdf')); await p.locator('[data-action="add-files"]').first().click();
    await p.locator('.paper-item').click(); await p.locator('.original-pages .page[data-page="1"] .textLayer span').first().waitFor();
    const page = await p.locator('.original-pages .page[data-page="1"]').boundingBox(), at = (fx, fy) => [page.x + page.width * fx, page.y + page.height * fy];

    // ---- PDF page. A new box: its editor is see-through and has no border of its own; once finished nothing is drawn
    // around its text (the cream box under every text box is gone).
    await p.locator('[data-ink-tool="text"]').click(); await p.mouse.click(...at(.3, .4));
    const editor = p.locator('.original-pages .ink-text-editor'); await editor.locator('textarea').waitFor();
    assert.equal(await p.locator('.ink-text-bar [data-tb="size"]').inputValue(), '24', 'no size chosen yet: a new box starts at 24pt');
    assert.deepEqual(await editor.evaluate(n => { const s = getComputedStyle(n); return [s.backgroundColor, s.borderTopWidth, s.outlineStyle]; }), ['rgba(0, 0, 0, 0)', '0px', 'solid'], 'a new box: no fill, no border; the blue line is an outline');
    await p.keyboard.type('상자 확인'); await p.locator('.ink-text-bar [data-tb="done"]').click(); await saved(p);
    assert.deepEqual((await boxes(p)).map(b => [b.fill, b.border]), [[undefined, undefined]]);
    assert.equal((await inkAt(p, 'padding'))[3], 0, 'nothing drawn in the padding of a plain box');

    // The look: 상자 모양 opens a panel that stays open while choosing; each choice shows on the editor at once.
    await p.mouse.dblclick(...at(.31, .405)); await editor.locator('textarea').waitFor();
    await p.locator('.ink-text-bar [data-tb="box"]').click(); const panel = p.locator('.ink-text-pop[data-kind="box"]'); await panel.waitFor();
    assert.match(await panel.textContent(), /상자 모양[\s\S]*배경[\s\S]*테두리[\s\S]*굵기[\s\S]*선 모양/);
    await panel.locator('[data-tb-look="fill"][data-value="#fff3bf"]').click();
    await panel.locator('[data-tb-look="borderColor"][data-value="#1b64da"]').click();
    await panel.locator('[data-tb-look="borderWidth"][data-value="3"]').click();
    await panel.locator('[data-tb-look="borderStyle"][data-value="dashed"]').click();
    assert.equal(await panel.isVisible(), true, 'the panel stays open');
    assert.equal(await panel.locator('[aria-pressed="true"]').count(), 4, 'the fill, colour, width and line chosen are marked');
    assert.deepEqual(await editor.evaluate(n => { const s = getComputedStyle(n); return [s.backgroundColor, s.borderTopStyle, s.borderTopColor]; }), ['rgb(255, 243, 191)', 'dashed', 'rgb(27, 100, 218)']);
    assert.ok(await editor.evaluate(n => parseFloat(getComputedStyle(n).borderTopWidth)) > 2, 'the border at the page\'s scale');
    assert.match(await p.locator('.ink-text-bar [data-tb="box"] span').getAttribute('style'), /background:#fff3bf;border:3px dashed #1b64da/, 'the button shows the look');
    await p.locator('.ink-text-bar [data-tb="box"]').click(); await panel.waitFor({ state: 'detached' });
    await p.locator('.ink-text-bar [data-tb="done"]').click(); await saved(p);
    assert.deepEqual((await boxes(p)).map(b => [b.text, b.fill, b.border]), [['상자 확인', '#fff3bf', { color: '#1b64da', width: 3, style: 'dashed' }]]);
    assert.deepEqual((await inkAt(p, 'padding')).slice(0, 3), [255, 243, 191], 'the fill is drawn around the text');
    assert.equal((await inkAt(p, 'outside'))[3], 0, 'nothing outside the box');
    // One Ctrl+Z takes the look back, Ctrl+Shift+Z brings it again (as any other format change of the box).
    await p.keyboard.press('ControlOrMeta+z'); await saved(p); assert.deepEqual((await boxes(p)).map(b => [b.fill, b.border]), [[undefined, undefined]]);
    await p.keyboard.press('ControlOrMeta+Shift+z'); await saved(p); assert.deepEqual((await boxes(p)).map(b => b.fill), ['#fff3bf']);
    // A width or a line chosen on a box without a border gives it one in the text's colour; 없음 takes both away.
    await p.mouse.dblclick(...at(.31, .405)); await editor.locator('textarea').waitFor(); await p.locator('.ink-text-bar [data-tb="box"]').click(); await panel.waitFor();
    await panel.locator('[data-tb-look="borderColor"][data-value="none"]').click(); await panel.locator('[data-tb-look="fill"][data-value="none"]').click();
    assert.deepEqual(await editor.evaluate(n => { const s = getComputedStyle(n); return [s.backgroundColor, s.borderTopWidth]; }), ['rgba(0, 0, 0, 0)', '0px']);
    await panel.locator('[data-tb-look="borderStyle"][data-value="dotted"]').click();
    assert.deepEqual(await editor.evaluate(n => { const s = getComputedStyle(n); return [s.borderTopStyle, s.borderTopColor]; }), ['dotted', 'rgb(0, 0, 0)']);
    await panel.locator('[data-tb-look="fill"][data-value="#fff3bf"]').click(); await panel.locator('[data-tb-look="borderColor"][data-value="#1b64da"]').click(); await panel.locator('[data-tb-look="borderWidth"][data-value="3"]').click(); await panel.locator('[data-tb-look="borderStyle"][data-value="dashed"]').click();
    await p.keyboard.press('Escape'); await panel.waitFor({ state: 'detached' }); await p.keyboard.press('Escape'); await saved(p);
    // A box scaled down with the lasso: its size is kept in range (24pt x 0.2 is 6pt, not 4.8), and its text width and
    // border follow the size it got, so the box drawn, pressed and printed stays one box around its text.
    const scaled = await p.evaluate(() => {
      const container = document.querySelector('.original-pages'), view = container.pdfViewer.getPageView(0), doc = container.inkDoc, before = [...doc.strokes.values()].find(s => s.tool === 'text');
      const b = inkBox(before, view.viewport), k = .2; inkState.selection = { doc, container, page: 0, ids: [before.id], box: b };
      inkTransformSelection({ view, doc, container }, v => [b.x0 + (v[0] - b.x0) * k, b.y0 + (v[1] - b.y0) * k], k, { x0: b.x0, y0: b.y0, x1: b.x0 + (b.x1 - b.x0) * k, y1: b.y0 + (b.y1 - b.y0) * k });
      inkState.selection = null; inkSelectionDraw(container);
      const after = [...doc.strokes.values()].find(s => s.tool === 'text'), u = inkScale(view.viewport), box = inkBox(after, view.viewport), out = globalThis.appInkMarks.textBoxFrame(after).out * u;
      const measure = document.createElement('canvas').getContext('2d'); measure.font = inkTextFont(after, after.width);
      return { width: after.width, ratio: [before.w / before.width, after.w / after.width], border: [before.border.width, after.border.width], boxWidth: box.x1 - box.x0, textBox: (after.w * u) + 2 * out, measured: Math.max(...after.text.split('\n').map(l => measure.measureText(l).width)), w: after.w };
    });
    assert.equal(scaled.width, 6); assert.ok(Math.abs(scaled.ratio[0] - scaled.ratio[1]) < .02, JSON.stringify(scaled));
    assert.equal(scaled.border[1], Math.round(scaled.border[0] * 6 / 24 * 10) / 10, 'the border follows the size the text got');
    assert.ok(Math.abs(scaled.boxWidth - scaled.textBox) < .01 && Math.abs(scaled.measured - scaled.w) < 1, JSON.stringify(scaled));
    await saved(p); await p.keyboard.press('ControlOrMeta+z'); await saved(p);
    // A second new box starts plain again (the look is never carried over; the text colour is).
    await p.locator('[data-ink-tool="text"]').click(); await p.mouse.click(...at(.3, .7)); await editor.locator('textarea').waitFor();
    assert.deepEqual(await editor.evaluate(n => { const s = getComputedStyle(n); return [s.backgroundColor, s.borderTopWidth]; }), ['rgba(0, 0, 0, 0)', '0px']);
    await p.keyboard.press('Escape'); await editor.waitFor({ state: 'detached' });
    // A size chosen in the bar is kept on this computer: the next new box starts in it (on PDF pages and in notebooks,
    // also after a restart); opening a box does not change it.
    await p.locator('[data-ink-tool="text"]').click(); await p.mouse.click(...at(.15, .6)); await editor.locator('textarea').waitFor();
    await p.locator('.ink-text-bar [data-tb="size"]').selectOption('14'); await p.keyboard.type('작은 상자'); await p.locator('.ink-text-bar [data-tb="done"]').click(); await saved(p);
    await p.mouse.dblclick(...at(.31, .405)); await editor.locator('textarea').waitFor(); assert.equal(await p.locator('.ink-text-bar [data-tb="size"]').inputValue(), '24', 'a box keeps its own size');
    await p.keyboard.press('Escape'); await editor.waitFor({ state: 'detached' });
    await p.locator('[data-ink-tool="text"]').click(); await p.mouse.click(...at(.6, .6)); await editor.locator('textarea').waitFor();
    assert.equal(await p.locator('.ink-text-bar [data-tb="size"]').inputValue(), '14', 'a new box starts in the size chosen last, not that of the box opened last');
    await p.keyboard.press('Escape'); await editor.waitFor({ state: 'detached' });

    // Opening a box to edit it moves none of its letters, nor does finishing it, and an edit that changes nothing keeps
    // the box as it was: in several looks and sizes, at the page's own zoom and twice that (the drawn letters against the
    // editor's, edges of the red ink, within a pixel).
    await p.evaluate(async () => { for (const f of ['24px', '700 24px', 'italic 24px', '72px']) await document.fonts.load(`${f} "Noto Sans KR"`, 'Ag 가나 test 두 줄 g'); });
    const original = await p.evaluate(() => { const s = [...document.querySelector('.original-pages').inkDoc.strokes.values()].find(x => x.tool === 'text'); return { id: s.id, json: JSON.stringify(s) }; });
    for (const zoom of [1, 2]) {
      await p.evaluate(async z => { readerZoom = z; fitTranslatedPages(); await new Promise(r => setTimeout(r, 1200)); }, zoom);
      for (const [name, look] of [['plain', {}], ['72pt', { width: 72 }], ['italic', { italic: true }], ['bold, border 3', { bold: true, border: { width: 3, style: 'solid', color: '#00aa00' } }], ['two lines, right', { align: 'right', text: 'Ag 가나 test\n두 줄 g' }]]) {
        const place = await p.evaluate(look => { const c = document.querySelector('.original-pages'), d = c.inkDoc, s = [...d.strokes.values()].find(x => x.tool === 'text'), view = c.pdfViewer.getPageView(0);
          const next = { ...s, color: '#ff0000', width: 24, text: 'Ag 가나 test', ...look }; for (const k of ['fill', 'w']) delete next[k]; if (!look.border) delete next.border; if (!look.italic) delete next.italic; if (!look.bold) delete next.bold; if (!look.align) delete next.align;
          d.strokes.set(s.id, next); inkDrawPage(c, view); view.div.scrollIntoView({ block: 'nearest' });
          const [x, y] = view.viewport.convertToViewportPoint(next.points[0], next.points[1]), r = view.div.getBoundingClientRect(), k = r.width / view.viewport.width; return { x: r.left + x * k, y: r.top + y * k, id: s.id, saved: JSON.stringify(next) }; }, look);
        await p.locator('.original-pages').evaluate((pane, y) => { pane.scrollTop += y - pane.getBoundingClientRect().top - 150; }, place.y);
        const at = await p.evaluate(id => { const c = document.querySelector('.original-pages'), s = c.inkDoc.strokes.get(id), view = c.pdfViewer.getPageView(0), [x, y] = view.viewport.convertToViewportPoint(s.points[0], s.points[1]), r = view.div.getBoundingClientRect(), k = r.width / view.viewport.width; return { x: r.left + x * k, y: r.top + y * k }; }, place.id);
        const clip = { x: Math.max(0, at.x - 60), y: Math.max(0, at.y - 60), width: 900, height: 400 };
        await p.waitForTimeout(150); const drawn = await redBox(p, clip);
        await p.evaluate(id => { const c = document.querySelector('.original-pages'); inkTextOpen(c, c.pdfViewer.getPageView(0), c.inkDoc.strokes.get(id)); document.querySelector('.ink-text-area').style.caretColor = 'transparent'; for (const n of document.querySelectorAll('.ink-text-bar,.ink-text-pop')) n.style.visibility = 'hidden'; }, place.id);
        await p.waitForTimeout(150); const editing = await redBox(p, clip);
        await p.evaluate(() => inkTextDone()); await p.waitForTimeout(200); const done = await redBox(p, clip);
        assert.ok(moved(drawn, editing) <= 1, `${name} at ${zoom * 100}%: editing moves the letters ${JSON.stringify([drawn, editing])}`);
        assert.ok(moved(drawn, done) <= 1, `${name} at ${zoom * 100}%: finishing moves them ${JSON.stringify([drawn, done])}`);
        assert.equal(await p.evaluate(id => JSON.stringify(document.querySelector('.original-pages').inkDoc.strokes.get(id)), place.id), place.saved, `${name}: an edit that changes nothing keeps the box`);
      }
    }
    // The box as it was (only the page's copy was changed; nothing was saved).
    await p.evaluate(async o => { const c = document.querySelector('.original-pages'); c.inkDoc.strokes.set(o.id, JSON.parse(o.json)); readerZoom = 1; fitTranslatedPages(); await new Promise(r => setTimeout(r, 800)); inkDrawPage(c, c.pdfViewer.getPageView(0)); }, original);

    // ---- Notebook. A new box has no fill or border; being edited or pointed at shows as an outline.
    await p.locator('[data-mode="notebook"]').click(); await p.locator('.notebook-pane [data-action="nb-new"]').first().click();
    await p.locator('#nb-title').fill('상자 노트'); await p.locator('#dialog [data-action="nb-create"]').click(); await p.locator('.nb-page').first().waitFor();
    await (await toolShown(p, '[data-action="nb-text"]')).click(); await p.waitForFunction(() => document.activeElement?.matches('.nb-text textarea'));
    const area = p.locator('.nb-text textarea');
    assert.deepEqual(await area.evaluate(n => { const s = getComputedStyle(n); return [s.backgroundColor, s.borderTopWidth, s.outlineStyle]; }), ['rgba(0, 0, 0, 0)', '0px', 'solid'], 'editing: an outline, no fill or border');
    await p.keyboard.type('노트 상자'); await p.locator('.ink-text-bar [data-tb="done"]').click();
    assert.deepEqual(await area.evaluate(n => { const s = getComputedStyle(n); return [s.backgroundColor, s.borderTopWidth, s.outlineColor]; }), ['rgba(0, 0, 0, 0)', '0px', 'rgba(0, 0, 0, 0)'], 'a finished plain box shows nothing around its text');
    assert.equal(await p.evaluate(() => nb.doc.pages[0].items.find(x => x.type === 'text').size), 14, 'a new notebook box starts in the size chosen last');
    const item = () => p.evaluate(() => { const i = nb.doc.pages[0].items.find(x => x.type === 'text'); return { fill: i.fill, border: i.border, text: i.text }; });
    assert.deepEqual(await item(), { fill: undefined, border: undefined, text: '노트 상자' });
    await (await toolShown(p, '.nb-text')).dblclick(); await p.locator('.ink-text-bar').waitFor();
    await p.locator('.ink-text-bar [data-tb="box"]').click(); await panel.waitFor();
    await panel.locator('[data-tb-look="fill"][data-value="#d3f9d8"]').click(); await panel.locator('[data-tb-look="borderColor"][data-value="#e03131"]').click();
    await panel.locator('[data-tb-look="borderWidth"][data-value="1.5"]').click(); await panel.locator('[data-tb-look="borderStyle"][data-value="dotted"]').click();
    assert.deepEqual(await area.evaluate(n => { const s = getComputedStyle(n); return [s.backgroundColor, s.borderTopStyle, s.borderTopColor, s.boxSizing]; }), ['rgb(211, 249, 216)', 'dotted', 'rgb(224, 49, 49)', 'border-box']);
    await p.locator('.ink-text-bar [data-tb="done"]').click(); await panel.waitFor({ state: 'detached' });
    assert.deepEqual(await item(), { fill: '#d3f9d8', border: { color: '#e03131', width: 1.5, style: 'dotted' }, text: '노트 상자' });
    await p.keyboard.press('ControlOrMeta+z'); await p.waitForFunction(() => !nb.doc.pages[0].items.find(x => x.type === 'text').fill);
    await p.keyboard.press('ControlOrMeta+Shift+z'); await p.waitForFunction(() => nb.doc.pages[0].items.find(x => x.type === 'text').fill === '#d3f9d8');
    // A colour of one's own (the system's colour dialog takes the focus from the box while open) stays in the box's one
    // undo step, for the text, the fill and the border alike.
    const pickOwn = (selector, value) => p.locator(selector).evaluate((n, v) => { n.focus(); n.value = v; n.dispatchEvent(new Event('change', { bubbles: true })); }, value);
    const look = () => p.evaluate(() => { const i = nb.doc.pages[0].items.find(x => x.type === 'text'); return { color: i.color, fill: i.fill, border: i.border?.color }; });
    await (await toolShown(p, '.nb-text')).dblclick(); await p.locator('.ink-text-bar').waitFor();
    await p.locator('.ink-text-bar [data-tb="box"]').click(); await panel.waitFor();
    await panel.locator('[data-tb-look="fill"][data-value="#fff3bf"]').click(); await pickOwn('.ink-text-pop [data-tb-look-custom="borderColor"]', '#123456');
    await pickOwn('.ink-text-pop [data-tb-look-custom="fill"]', '#abcdef');
    await p.locator('.ink-text-bar [data-tb="color"]').click(); await pickOwn('.ink-text-pop [data-tb-custom]', '#654321');
    await p.locator('.ink-text-bar [data-tb="done"]').click();
    assert.deepEqual(await look(), { color: '#654321', fill: '#abcdef', border: '#123456' });
    await p.keyboard.press('ControlOrMeta+z'); await p.waitForFunction(() => nb.doc.pages[0].items.find(x => x.type === 'text').fill === '#d3f9d8');
    assert.deepEqual(await look(), { color: undefined, fill: '#d3f9d8', border: '#e03131' }, 'one undo takes the whole editing back');
    await p.keyboard.press('ControlOrMeta+Shift+z'); await p.waitForFunction(() => nb.doc.pages[0].items.find(x => x.type === 'text').fill === '#abcdef');
    assert.deepEqual(await look(), { color: '#654321', fill: '#abcdef', border: '#123456' }, 'and redo brings all of it again');
    // A notebook box edited and finished keeps its letters in place too (the same text area, read only or not), and its
    // text scrolled past its height stays where it was.
    for (const [name, look] of [['plain', { text: 'Ag 가나 test' }], ['past its height', { text: '1\n2\n3\n4\n5 끝', h: 40 }]]) {
      const kept = await p.evaluate(look => { const i = nb.doc.pages[0].items.find(x => x.type === 'text'), was = JSON.stringify(i); Object.assign(i, { color: '#ff0000', size: 24 }, look); nbRender(); return was; }, look);
      await p.waitForTimeout(300); const b = await p.locator('.nb-text').boundingBox(), clip = { x: b.x - 30, y: b.y - 30, width: b.width + 60, height: b.height + 60 }, drawn = await redBox(p, clip);
      await (await toolShown(p, '.nb-text')).dblclick(); await (await toolShown(p, '.nb-text.editing')).waitFor(); await p.evaluate(() => { document.querySelector('.nb-text textarea').style.caretColor = 'transparent'; for (const n of document.querySelectorAll('.ink-text-bar,.ink-text-pop')) n.style.visibility = 'hidden'; });
      await p.waitForTimeout(200); const editing = await redBox(p, clip); await p.keyboard.press('Escape'); await p.waitForTimeout(300); const done = await redBox(p, clip);
      assert.ok(moved(drawn, editing) <= 1 && moved(drawn, done) <= 1, `notebook, ${name}: ${JSON.stringify([drawn, editing, done])}`);
      await p.evaluate(was => { const page = nb.doc.pages[0], i = page.items.findIndex(x => x.type === 'text'); page.items[i] = JSON.parse(was); nbRender(); nbSave(true); }, kept);
    }
    // The lasso scales a notebook box's border with it, within 0.5 to 6 pt.
    assert.deepEqual(await p.evaluate(() => { const i = nb.doc.pages[0].items.find(x => x.type === 'text'); return [.5, .1, 3].map(k => nbMovedItem(i, xy => xy, k).border.width); }), [.8, .5, 4.5]);
    await p.waitForTimeout(1500);
    const notebookId = await p.evaluate(() => nb.doc.id);
    await app.close(); app = null;

    // ---- After a restart both boxes keep their look, as stored.
    const onDisk = JSON.parse(await fs.readFile(path.join(vault, appName.vaultDir, 'notebooks', notebookId + '.json'), 'utf8')).pages[0].items.find(i => i.type === 'text');
    assert.deepEqual([onDisk.color, onDisk.fill, onDisk.border], ['#654321', '#abcdef', { color: '#123456', width: 1.5, style: 'dotted' }]);
    p = await launch(); await p.locator('[data-mode="original"]').click(); // the reader opens again on the paper read last
    await p.locator('.original-pages .page[data-page="1"] .textLayer span').first().waitFor(); await p.waitForFunction(() => document.querySelector('.original-pages')?.inkDoc?.strokes.size > 0);
    assert.deepEqual((await boxes(p)).filter(b => b.text === '상자 확인').map(b => [b.fill, b.border]), [['#fff3bf', { color: '#1b64da', width: 3, style: 'dashed' }]]);
    await p.locator('[data-ink-tool="text"]').click(); await p.mouse.click(...at(.6, .6)); await p.locator('.original-pages .ink-text-editor textarea').waitFor();
    assert.equal(await p.locator('.ink-text-bar [data-tb="size"]').inputValue(), '14', 'the size chosen last is kept after a restart');
    await p.keyboard.press('Escape');
    await app.close(); app = null;
    console.log('Text box smoke passed: new boxes on PDF pages and in notebooks have no fill or border; the box panel sets fill, border colour, width and line, undoes in one step and is kept after a restart.');
  } catch (error) { console.error(error); process.exitCode = 1; try { await (await app?.firstWindow())?.screenshot({ path: path.join(os.tmpdir(), `${appName.id}-textbox-failure.png`) }); } catch {} }
  finally { await app?.close().catch(() => {}); await fs.rm(temp, { recursive: true, force: true }); }
})();
