// End-to-end check of moving ink with the select (reading) tool on PDF pages (desktop/ink.js). On the original: a pen
// stroke drawn over the text, dragged with the select tool, moves (a new id, `from` the old one) and no text is picked
// up with it; one Ctrl+Z brings it back. A press on a shape without moving selects it (the box and its bar) and leaves
// it where it is; Esc lets go. Over a stroke the pointer is a hand. A drag over text with no stroke picks the text and
// leaves the ink alone, also over a highlighter stroke (highlighters are moved with the lasso only). Two strokes
// lassoed, then the select tool chosen: dragging one moves both. On the translation (the model's reply stubbed): a
// stroke dragged with the select tool moves. In a notebook the same (a pen stroke moves, a press selects it, Esc lets
// go, a highlighter is not taken, a text box still drags alone). The tool is named for what it does.
// APP_TEST_SOURCE=1 runs the source.
const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { PDFDocument, StandardFonts } = require('pdf-lib');
const appName = require('../core/app-name.cjs');
const toolShown = require('./tool-row.cjs');
const root = path.resolve(__dirname, '..');
(async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), `${appName.id}-ink-select-e2e-`)), vault = path.join(temp, 'vault'); await fs.mkdir(vault);
  // Lines of text from 60 to 366 points from the top of a 600×800 page (line l's baseline at 60 + 18 l); the lower half is empty.
  const doc = await PDFDocument.create(), font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < 2; i++) { const page = doc.addPage([600, 800]); for (let l = 0; l < 18; l++) page.drawText('A research paper connects ideas and methods across many fields.', { x: 50, y: 740 - l * 18, size: 12, font }); }
  await fs.writeFile(path.join(temp, 'paper.pdf'), await doc.save());
  const executable = require('./app-executable.cjs')(root);
  const env = /utf-?8/i.test(process.env.LC_ALL || process.env.LANG || '') ? process.env : { ...process.env, LC_ALL: 'C.UTF-8', LANG: 'C.UTF-8' };
  const app = await electron.launch({ env, executablePath: executable, args: [...(process.env.APP_TEST_SOURCE === '1' ? [root] : []), '--no-sandbox', '--ozone-platform=headless', '--disable-gpu', `--user-data-dir=${path.join(temp, 'profile')}`], timeout: 20000 });
  try {
    const p = await app.firstWindow(); p.setDefaultTimeout(20000); await p.setViewportSize({ width: 1400, height: 950 });
    const errors = []; p.on('pageerror', e => { console.error(e); errors.push(e.message); process.exitCode = 1; }); p.on('console', m => { if (m.type() === 'error') console.error('renderer:', m.text()); });
    await app.evaluate(({ app, dialog }) => {
      globalThis.openQueue = []; dialog.showOpenDialog = async () => ({ canceled: false, filePaths: globalThis.openQueue.shift() });
      const { ChatGPT } = process.getBuiltinModule('module').createRequire(app.getAppPath() + '/package.json')('./desktop/chatgpt.cjs');
      ChatGPT.prototype.status = function () { return { connected: true, usable: true, email: 'test@example.test', persistent: false }; }; ChatGPT.prototype.models = async () => [{ id: 'm', name: 'M' }];
      ChatGPT.prototype.translate = async (_m, blocks) => blocks.map(b => ({ id: b.id, text: '연구 논문은 여러 분야의 아이디어와 방법을 연결합니다.' }));
    });
    await app.evaluate((_, v) => globalThis.openQueue.push([v]), vault); await p.locator('[data-action="storage"]').first().click();
    await app.evaluate((_, f) => globalThis.openQueue.push([f]), path.join(temp, 'paper.pdf')); await p.locator('[data-action="add-files"]').first().click();
    await p.locator('.paper-item').click(); await p.locator('.original-pages .page[data-page="1"] .textLayer span').first().waitFor();
    await p.waitForFunction(() => document.querySelector('.original-pages .page[data-page="1"]')?.dataset.ready === 'true');
    const page = p.locator('.original-pages .page[data-page="1"]');
    let b = await page.boundingBox(); const at = (fx, fy) => [b.x + b.width * fx, b.y + b.height * fy];
    const drag = async (points, steps = 6) => { b = await page.boundingBox(); await p.mouse.move(...at(...points[0])); await p.mouse.down(); for (const q of points.slice(1)) await p.mouse.move(...at(...q), { steps }); await p.mouse.up(); await p.waitForTimeout(250); };
    const strokes = (selector = '.original-pages') => p.evaluate(selector => [...document.querySelector(selector).inkDoc.strokes.values()].map(s => ({ id: s.id, tool: s.tool, shape: s.shape, from: s.from, page: s.page, color: s.color, y: s.points[1] })), selector);
    // A point on a stroke of a PDF pane in the window (its middle point; a text box's left edge), the pane scrolled to show it.
    const onStroke = (pane, id) => p.evaluate(([pane, id]) => { const c = document.querySelector(pane), s = c.inkDoc.strokes.get(id), view = c.pdfViewer.getPageView(s.page), i = Math.floor(s.points.length / 8) * 4;
      let [vx, vy] = view.viewport.convertToViewportPoint(s.points[i], s.points[i + 1]); if (s.tool === 'text') { const bb = inkBox(s, view.viewport); vx = bb.x0 + 6; vy = (bb.y0 + bb.y1) / 2; }
      let r = view.div.getBoundingClientRect(); const cr = c.getBoundingClientRect(), y = r.top + vy * r.height / view.viewport.height; if (y < cr.top + 40 || y > cr.bottom - 40) { c.scrollTop += y - (cr.top + cr.height / 2); r = view.div.getBoundingClientRect(); }
      return [r.left + vx * r.width / view.viewport.width, r.top + vy * r.height / view.viewport.height]; }, [pane, id]);
    const plainPen = async (pane = '.original-pages') => (await strokes(pane)).find(s => s.tool === 'pen' && !s.shape);
    const tool = name => p.evaluate(name => inkSetTool(name), name);
    const picked = () => p.evaluate(() => String(getSelection()).trim());
    const choose = async () => { await (await toolShown(p, '[data-ink-group="pointer"]')).click(); assert.equal(await p.evaluate(() => globalThis.appInk.tool), 'read'); };

    // A pen stroke over line 2 (an underline by hand), a rectangle in the empty lower half, a highlighter over the start of line 6.
    await tool('pen'); await drag([[.12, .124], [.3, .124], [.5, .124]]);
    await p.evaluate(() => { inkState.shape = 'rect'; }); await tool('shape'); await drag([[.2, .6], [.4, .7]]);
    await tool('highlighter'); await drag([[.1, .205], [.2, .205], [.3, .205]]);
    await choose(); await p.mouse.click(...at(.9, .9)); await p.evaluate(() => getSelection().removeAllRanges());
    const before = await strokes(); const pen = before.find(s => s.tool === 'pen' && !s.shape), rect = before.find(s => s.shape === 'rect'), marker = before.find(s => s.tool === 'highlighter');
    assert.ok(pen && rect && marker, `three strokes: ${JSON.stringify(before)}`);

    // The tool says what it does.
    await (await toolShown(p, '[data-ink-group="pointer"]')).click(); await p.locator('[data-ink-flyout="pointer"]').waitFor();
    const readPick = p.locator('[data-ink-pick="pointer"][data-value="read"]');
    assert.equal(await readPick.getAttribute('aria-label'), '선택'); assert.match(await readPick.getAttribute('data-tip'), /필기와 상자 옮기기/);
    await p.locator('[data-ink-pick="pointer"][data-value="read"]').click(); assert.equal(await p.evaluate(() => globalThis.appInk.tool), 'read');

    // Over a stroke the pointer is a hand.
    b = await page.boundingBox(); await p.mouse.move(...at(.3, .124)); await p.waitForTimeout(150);
    assert.equal(await p.evaluate(([x, y]) => getComputedStyle(document.elementFromPoint(x, y)).cursor, at(.3, .124)), 'grab', 'a hand over the pen stroke');
    await p.mouse.move(...at(.3, .3)); await p.waitForTimeout(150);
    assert.notEqual(await p.evaluate(([x, y]) => getComputedStyle(document.elementFromPoint(x, y)).cursor, at(.3, .3)), 'grab', 'not over text alone');

    // The pen stroke dragged with the select tool moves, and no text is picked with it.
    await drag([[.3, .124], [.3, .3], [.3, .55]]);
    let now = await strokes(); const moved = now.find(s => s.from === pen.id);
    assert.ok(moved && !now.some(s => s.id === pen.id), `the stroke moved: ${JSON.stringify(now)}`);
    assert.ok(moved.y < pen.y - 200, `down the page (PDF y grows upward): ${pen.y} → ${moved.y}`);
    assert.equal(await picked(), '', 'no text picked while moving the stroke');
    assert.ok(now.some(s => s.id === rect.id) && now.some(s => s.id === marker.id), 'the others stay');
    await p.keyboard.press('Escape'); await p.keyboard.press('Control+z');
    await p.waitForFunction(id => [...document.querySelector('.original-pages').inkDoc.strokes.values()].some(s => s.id === id), pen.id);
    assert.ok(!(await strokes()).some(s => s.from === pen.id), 'one Ctrl+Z brings it back');

    // A press on the rectangle's edge without moving: selected, where it was; Esc lets go.
    await drag([[.3, .6]]);
    await p.locator('.original-pages .ink-selection .ink-selection-actions').waitFor();
    assert.ok((await strokes()).some(s => s.id === rect.id), 'the rectangle is where it was');
    await p.keyboard.press('Escape'); await p.locator('.original-pages .ink-selection').waitFor({ state: 'detached' });
    // A press on text away from the strokes lets go of a selection and picks text as before.
    await drag([[.3, .6]]); await p.locator('.original-pages .ink-selection').waitFor();
    await drag([[.1, .295], [.3, .296], [.5, .296]]);
    assert.equal(await p.locator('.original-pages .ink-selection').count(), 0, 'a press elsewhere lets go of the selection');
    assert.match(await picked(), /research|paper|connects|ideas/, 'a drag over text picks the text');
    assert.deepEqual((await strokes()).map(s => s.id).sort(), before.map(s => s.id).sort(), 'and leaves the ink alone');
    // Over the highlighter too: the text is picked and the highlighter stays.
    await p.evaluate(() => getSelection().removeAllRanges()); await drag([[.12, .203], [.25, .204], [.45, .204]]);
    assert.match(await picked(), /research|paper|connects|ideas/, 'a drag over highlighted text picks the text');
    assert.deepEqual((await strokes()).map(s => s.id).sort(), before.map(s => s.id).sort(), 'the highlighter is not moved by the select tool');
    await p.evaluate(() => getSelection().removeAllRanges());

    // Two strokes lassoed (not the highlighter), then the select tool: dragging one moves both.
    await tool('lasso'); await drag([[.25, .1], [.55, .1], [.55, .75], [.15, .75], [.15, .45], [.25, .45], [.25, .11]]);
    await p.waitForFunction(() => inkState.selection?.ids.length === 2);
    await choose(); assert.equal(await p.evaluate(() => inkState.selection?.ids.length), 2, 'the selection stays with the select tool');
    await drag([[.3, .124], [.6, .2], [.7, .2]]);
    now = await strokes();
    assert.deepEqual(now.filter(s => s.from).map(s => s.from).sort(), [pen.id, rect.id].sort(), `both moved: ${JSON.stringify(now)}`);
    assert.ok(now.some(s => s.id === marker.id), 'the highlighter stays');
    await p.keyboard.press('Escape');

    // An undone move leaves no selection box behind.
    let pen1 = await plainPen(), pt = await onStroke('.original-pages', pen1.id);
    await p.mouse.move(...pt); await p.mouse.down(); await p.mouse.move(pt[0] + 30, pt[1] + 20, { steps: 5 }); await p.mouse.up(); await p.waitForTimeout(200);
    await p.keyboard.press('Control+z'); await p.waitForFunction(id => [...document.querySelector('.original-pages').inkDoc.strokes.values()].some(s => s.id === id), pen1.id);
    assert.equal(await p.locator('.ink-selection').count(), 0, 'an undone move leaves no selection box');
    // A colour pressed with a stroke selected by the select tool recolours it; the tool stays.
    pt = await onStroke('.original-pages', pen1.id); await p.mouse.click(...pt); await p.locator('.original-pages .ink-selection').waitFor();
    await (await toolShown(p, '.ink-colors [data-ink-color="#1d4ed8"]')).click();
    const recoloured = (await strokes()).find(s => s.from === pen1.id);
    assert.ok(recoloured?.color === '#1d4ed8', `the selected stroke is recoloured: ${JSON.stringify(recoloured)}`);
    assert.equal(await p.evaluate(() => globalThis.appInk.tool), 'read', 'and the select tool stays');
    await p.keyboard.press('Escape');
    // A text box pressed after a stroke: only the box is chosen, and Delete removes it alone.
    await tool('text'); b = await page.boundingBox(); await p.mouse.click(...at(.62, .5)); await p.keyboard.type('Note'); await p.keyboard.press('Escape'); await p.waitForTimeout(250); await choose();
    const noteBox = (await strokes()).find(s => s.tool === 'text'), pen2 = await plainPen();
    pt = await onStroke('.original-pages', pen2.id); await p.mouse.click(...pt); await p.locator('.original-pages .ink-selection').waitFor();
    pt = await onStroke('.original-pages', noteBox.id); await p.mouse.click(...pt); await p.locator('.ink-text-selected').waitFor();
    assert.equal(await p.locator('.ink-selection').count(), 0, 'pressing a text box lets go of the stroke');
    await p.keyboard.press('Delete'); await p.waitForFunction(id => ![...document.querySelector('.original-pages').inkDoc.strokes.values()].some(s => s.id === id), noteBox.id);
    assert.ok((await strokes()).some(s => s.id === pen2.id), 'Delete removed the box only');
    // A stroke dragged with the select tool onto page 2, the pane scrolled on the way: page 2's, under the pointer.
    pt = await onStroke('.original-pages', pen2.id);
    await p.mouse.move(...pt); await p.mouse.down(); await p.mouse.move(pt[0] + 10, pt[1] + 10, { steps: 3 });
    await p.evaluate(() => { const c = document.querySelector('.original-pages'), p2 = c.querySelector('.page[data-page="2"]'); c.scrollTop += p2.getBoundingClientRect().top - c.getBoundingClientRect().top - 100; }); await p.waitForTimeout(250);
    const q2 = await p.locator('.original-pages .page[data-page="2"]').boundingBox(), dropAt = [q2.x + q2.width * .5, q2.y + q2.height * .3];
    await p.mouse.move(...dropAt, { steps: 6 }); await p.mouse.up(); await p.waitForTimeout(250);
    const landed = (await strokes()).find(s => s.from === pen2.id);
    assert.equal(landed?.page, 1, `dropped on page 2: ${JSON.stringify(landed)}`);
    const landedAt = await onStroke('.original-pages', landed.id);
    assert.ok(Math.hypot(landedAt[0] - dropAt[0], landedAt[1] - dropAt[1]) < 8, `under the pointer though the pane scrolled: ${landedAt} vs ${dropAt}`);
    await p.keyboard.press('Escape');
    // Esc during a drag cancels it: nothing thrown, the stroke where it was and drawn.
    pt = await onStroke('.original-pages', landed.id);
    await p.mouse.move(...pt); await p.mouse.down(); await p.mouse.move(pt[0] + 40, pt[1] + 30, { steps: 5 }); await p.keyboard.press('Escape'); await p.mouse.move(pt[0] + 60, pt[1] + 40, { steps: 3 }); await p.mouse.up(); await p.waitForTimeout(250);
    assert.deepEqual(errors, [], 'Esc during a drag throws nothing');
    assert.ok((await strokes()).some(s => s.id === landed.id), 'Esc during a drag cancels the move');
    assert.equal(await p.evaluate(() => Boolean(inkState.hidden) || Boolean(document.querySelector('.original-pages .app-ink-live'))), false, 'and the stroke shows where it was');

    // On the translation: a stroke dragged with the select tool moves.
    await p.locator('[data-mode="translated"]').click(); await p.locator('#dialog [data-action="gpt-start"]').click();
    await p.locator('.translated-pane .translated-pages .page[data-page="1"] .translation-layer[data-ready="true"]').waitFor(); await p.waitForTimeout(500);
    const tpage = p.locator('.translated-pane .translated-pages .page[data-page="1"]');
    let t = await tpage.boundingBox(); const tat = (fx, fy) => [t.x + t.width * fx, t.y + t.height * fy];
    await tool('pen'); await p.mouse.move(...tat(.2, .6)); await p.mouse.down(); await p.mouse.move(...tat(.5, .62), { steps: 6 }); await p.mouse.up(); await p.waitForTimeout(250);
    await choose(); const tBefore = await strokes('.translated-pane .translated-pages');
    t = await tpage.boundingBox(); await p.mouse.move(...tat(.35, .61)); await p.mouse.down(); await p.mouse.move(...tat(.35, .7), { steps: 6 }); await p.mouse.move(...tat(.4, .75), { steps: 4 }); await p.mouse.up(); await p.waitForTimeout(250);
    const tAfter = await strokes('.translated-pane .translated-pages');
    assert.ok(tBefore.length === 1 && tAfter.length === 1 && tAfter[0].from === tBefore[0].id, `the translation's stroke moved: ${JSON.stringify([tBefore, tAfter])}`);

    // In a notebook: a pen stroke dragged with the select tool moves (one undo brings it back); pressed, it is selected;
    // Esc lets go; a highlighter is not taken; a text box still drags on its own.
    await p.locator('[data-mode="notebook"]').click(); await p.locator('.notebook-pane [data-action="nb-new"]').first().click();
    await p.locator('#dialog [data-action="nb-create"]').click(); await p.locator('.nb-page').first().waitFor(); await p.waitForTimeout(300);
    const nbPage = p.locator('.nb-page').first(); let n = await nbPage.boundingBox(); const nat = (fx, fy) => [n.x + n.width * fx, n.y + n.height * fy];
    const nbDrag = async points => { n = await nbPage.boundingBox(); await p.mouse.move(...nat(...points[0])); await p.mouse.down(); for (const q of points.slice(1)) await p.mouse.move(...nat(...q), { steps: 6 }); await p.mouse.up(); await p.waitForTimeout(250); };
    const nbStrokes = () => p.evaluate(() => nb.doc.pages[0].strokes.map(s => ({ id: s.id, tool: s.tool, x: s.points[0], y: s.points[1] })));
    await tool('pen'); await nbDrag([[.2, .2], [.35, .21], [.5, .22]]);
    await tool('highlighter'); await nbDrag([[.2, .4], [.35, .4], [.5, .4]]);
    await tool('text'); n = await nbPage.boundingBox(); await p.mouse.click(...nat(.25, .6)); await p.keyboard.type('Box'); await p.keyboard.press('Escape'); await p.waitForTimeout(250);
    await choose(); await p.mouse.click(...nat(.9, .9));
    const nbBefore = await nbStrokes(), nbPen = nbBefore.find(s => s.tool === 'pen');
    n = await nbPage.boundingBox(); await p.mouse.move(...nat(.35, .21)); await p.waitForTimeout(100);
    assert.equal(await nbPage.evaluate(el => getComputedStyle(el).cursor), 'grab', 'a hand over the notebook stroke');
    await nbDrag([[.35, .21], [.4, .3], [.45, .32]]);
    let nbNow = await nbStrokes(); const nbMovedPen = nbNow.find(s => s.id === nbPen.id);
    assert.ok(nbMovedPen.x > nbPen.x + 20 && nbMovedPen.y > nbPen.y + 40, `the notebook stroke moved: ${JSON.stringify([nbPen, nbMovedPen])}`);
    assert.equal(nbNow.find(s => s.tool === 'highlighter').y, nbBefore.find(s => s.tool === 'highlighter').y, 'the highlighter stays');
    await p.keyboard.press('Escape'); await p.keyboard.press('Control+z'); await p.waitForFunction(([id, y]) => nb.doc.pages[0].strokes.find(s => s.id === id)?.points[1] === y, [nbPen.id, nbPen.y]);
    await nbDrag([[.35, .21]]); await p.locator('.nb-selection').waitFor();
    assert.equal((await nbStrokes()).find(s => s.id === nbPen.id).y, nbPen.y, 'pressed, it stays where it is');
    await p.keyboard.press('Escape'); await p.locator('.nb-selection').waitFor({ state: 'detached' });
    await nbDrag([[.35, .4]]); assert.equal(await p.locator('.nb-selection').count(), 0, 'a highlighter is not taken by the select tool');
    await nbDrag([[.35, .21]]); await p.locator('.nb-selection').waitFor(); await nbDrag([[.8, .8]]);
    assert.equal(await p.locator('.nb-selection').count(), 0, 'a press elsewhere lets go');
    const boxBefore = await p.evaluate(() => ({ ...nb.doc.pages[0].items[0] })), node = await p.locator('.nb-item.nb-text').boundingBox();
    await p.mouse.move(node.x + 5, node.y + node.height / 2); await p.mouse.down(); await p.mouse.move(node.x + 45, node.y + node.height / 2 + 40, { steps: 6 }); await p.mouse.up(); await p.waitForTimeout(250);
    const boxAfter = await p.evaluate(() => ({ ...nb.doc.pages[0].items[0] }));
    assert.ok(boxAfter.x > boxBefore.x && boxAfter.y > boxBefore.y, 'a text box drags on its own as before');
    assert.equal(await p.locator('.nb-selection').count(), 0, 'and selects no ink');
    // A box pressed after a stroke: Delete removes the box only.
    await nbDrag([[.35, .21]]); await p.locator('.nb-selection').waitFor();
    const node2 = await p.locator('.nb-item.nb-text').boundingBox(); await p.mouse.click(node2.x + 5, node2.y + node2.height / 2);
    assert.equal(await p.locator('.nb-selection').count(), 0, 'pressing a box lets go of the stroke');
    await p.keyboard.press('Delete'); await p.waitForFunction(() => !nb.doc.pages[0].items.length);
    assert.ok((await nbStrokes()).some(s => s.id === nbPen.id), 'Delete removed the box only');
    // A notebook stroke selected, then a stroke on the paper beside it: one selection, and Delete removes the paper's alone.
    await nbDrag([[.35, .21]]); await p.locator('.nb-selection').waitFor();
    const paperPen = await plainPen(); pt = await onStroke('.original-pages', paperPen.id); await p.mouse.click(...pt); await p.locator('.original-pages .ink-selection').waitFor();
    assert.deepEqual(await p.evaluate(() => [Boolean(nb.sel), document.querySelectorAll('.nb-selection').length]), [false, 0], 'the notebook selection is let go');
    await p.keyboard.press('Delete'); await p.waitForFunction(id => ![...document.querySelector('.original-pages').inkDoc.strokes.values()].some(s => s.id === id), paperPen.id);
    assert.ok((await nbStrokes()).some(s => s.id === nbPen.id), 'the notebook stroke stays');
    // Esc during a notebook drag cancels it.
    const nbStart = (await nbStrokes()).find(s => s.id === nbPen.id); n = await nbPage.boundingBox();
    await p.mouse.move(...nat(.35, .21)); await p.mouse.down(); await p.mouse.move(...nat(.45, .3), { steps: 5 }); await p.keyboard.press('Escape'); await p.mouse.move(...nat(.5, .35), { steps: 3 }); await p.mouse.up(); await p.waitForTimeout(250);
    assert.deepEqual(errors, [], 'Esc during a notebook drag throws nothing');
    assert.deepEqual((await nbStrokes()).find(s => s.id === nbPen.id), nbStart, 'Esc during a notebook drag cancels the move');
    console.log('Ink select smoke passed: the select tool moves a pen stroke (no text picked, one undo), selects a shape on a press, shows a hand over a stroke, picks text elsewhere and over a highlighter, moves a lasso selection by one of its strokes, moves a stroke on the translation, and moves a notebook stroke the same way; one selection at a time (Delete and colours act on it), none left by undo, a drop under the pointer after a scroll, Esc cancels a drag.');
  } finally {
    await app.close().catch(() => {});
    await fs.rm(temp, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exit(1); });
