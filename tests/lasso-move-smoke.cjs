// End-to-end check of moving a lasso selection onto another page (desktop/notebook.js, desktop/ink.js). In a notebook:
// a pen stroke and a text box lassoed on page 1 and dropped on page 2 become page 2's, inside it and drawn there, none
// left on page 1, and one Ctrl+Z puts them back where they were; dropped under the last page they go in at its bottom
// edge; while they are dragged over page 2 they are drawn there (on its canvas), at the new place, and not on page 1. On a PDF page (the original) the
// same: dropped on page 2 the stroke and the box are page 2's (`page` 1) and drawn on its canvas, drawn there while
// dragged; one Ctrl+Z puts them back; a move within a page is as before (a new id, `from` the old one). A box dragged
// with the select tool onto another page goes there too (notebook and PDF).
// APP_TEST_SOURCE=1 runs the source.
const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { PDFDocument, StandardFonts } = require('pdf-lib');
const appName = require('../core/app-name.cjs');
const root = path.resolve(__dirname, '..');
(async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), `${appName.id}-lasso-move-e2e-`)), vault = path.join(temp, 'vault'); await fs.mkdir(vault);
  const doc = await PDFDocument.create(), font = await doc.embedFont(StandardFonts.Helvetica);
  for (const text of ['Introduction text.', 'Methods describe the experiment.']) doc.addPage([600, 800]).drawText(text, { x: 40, y: 740, size: 14, font });
  await fs.writeFile(path.join(temp, 'paper.pdf'), await doc.save());
  const executable = require('./app-executable.cjs')(root);
  const env = /utf-?8/i.test(process.env.LC_ALL || process.env.LANG || '') ? process.env : { ...process.env, LC_ALL: 'C.UTF-8', LANG: 'C.UTF-8' };
  const app = await electron.launch({ env, executablePath: executable, args: [...(process.env.APP_TEST_SOURCE === '1' ? [root] : []), '--no-sandbox', '--ozone-platform=headless', '--disable-gpu', `--user-data-dir=${path.join(temp, 'profile')}`], timeout: 20000 });
  try {
    const p = await app.firstWindow(); p.setDefaultTimeout(15000); await p.setViewportSize({ width: 1400, height: 950 });
    p.on('pageerror', e => { console.error(e); process.exitCode = 1; }); p.on('console', m => { if (m.type() === 'error') console.error('renderer:', m.text()); });
    await app.evaluate(({ dialog }) => { globalThis.openQueue = []; dialog.showOpenDialog = async () => ({ canceled: false, filePaths: globalThis.openQueue.shift() }); });
    await app.evaluate((_, v) => globalThis.openQueue.push([v]), vault); await p.locator('[data-action="storage"]').first().click();
    await app.evaluate((_, f) => globalThis.openQueue.push([f]), path.join(temp, 'paper.pdf')); await p.locator('[data-action="add-files"]').first().click();
    await p.locator('.paper-item').click(); await p.locator('.original-pages .page[data-page="1"] canvas').first().waitFor();
    // Dark ink (the pen's and a text box's), not the blue dashed box, counted in a canvas, with where it is (fractions of the canvas).
    const darkIn = (pages, index, canvas) => p.evaluate(([pages, index, canvas]) => { const c = document.querySelectorAll(pages)[index]?.querySelector(canvas); if (!c) return { n: 0 }; const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0, x0 = 1, y0 = 1, x1 = 0, y1 = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 40 && d[i + 2] < 140 && d[i] < 140) { n++; const x = (i / 4 % c.width) / c.width, y = Math.floor(i / 4 / c.width) / c.height; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
      return { n, x0, y0, x1, y1 }; }, [pages, index, canvas]);
    // Any ink at all (a canvas's painted pixels).
    const anyInk = (pages, n) => p.evaluate(([pages, n]) => { const c = document.querySelectorAll(pages)[n].querySelector('.nb-ink, .app-ink-layer'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let k = 0; for (let i = 3; i < d.length; i += 4) if (d[i]) k++; return k; }, [pages, n]);
    const drag = async (points, { hold } = {}) => { await p.mouse.move(...points[0]); await p.mouse.down(); for (const q of points.slice(1)) await p.mouse.move(...q, { steps: 8 }); if (hold) await hold(); await p.mouse.up(); await p.waitForTimeout(300); };

    // ---- Notebook ----
    await p.locator('[data-mode="notebook"]').click(); await p.locator('.notebook-pane [data-action="nb-new"]').first().click();
    await p.locator('#dialog [data-action="nb-create"]').click(); await p.locator('.nb-page').first().waitFor();
    await p.evaluate(() => actions['nb-add-same']()); await p.waitForFunction(() => nb.doc.pages.length === 2 && document.querySelectorAll('.nb-page').length === 2);
    // Small pages, so both are in view at once.
    await p.evaluate(() => { nbSetZoom(.5); document.querySelector('.notebook-pane .nb-pages').scrollTop = 0; }); await p.waitForTimeout(400);
    const nbBox = async n => p.locator('.nb-page').nth(n).boundingBox(), at = (b, fx, fy) => [b.x + b.width * fx, b.y + b.height * fy];
    let b1 = await nbBox(0), b2 = await nbBox(1);
    assert.ok(b2.y + b2.height * .6 < 950, 'both notebook pages are in view');
    await p.evaluate(() => inkSetTool('pen')); await drag([at(b1, .2, .2), at(b1, .4, .23), at(b1, .3, .26)]);
    await p.evaluate(() => inkSetTool('text')); await p.mouse.click(...at(b1, .25, .32)); await p.keyboard.type('Moved box'); await p.keyboard.press('Escape'); await p.waitForTimeout(300);
    await p.evaluate(() => inkSetTool('read')); await p.mouse.click(...at(b1, .9, .9)); await p.waitForTimeout(200);
    const nbState = () => p.evaluate(() => nb.doc.pages.map(page => ({ height: page.height, width: page.width, strokes: page.strokes.map(s => ({ id: s.id, points: s.points.slice(0, 2) })), items: page.items.map(i => ({ id: i.id, x: i.x, y: i.y, w: i.w, h: i.h, text: i.text })) })));
    const before = await nbState();
    assert.equal(before[0].strokes.length, 1, 'a pen stroke on page 1'); assert.equal(before[0].items.length, 1, 'a text box on page 1');
    const lassoNb = async () => { b1 = await nbBox(0); b2 = await nbBox(1); await p.evaluate(() => inkSetTool('lasso')); await drag([at(b1, .1, .12), at(b1, .7, .12), at(b1, .7, .42), at(b1, .1, .42), at(b1, .1, .13)]); await p.waitForFunction(() => nb.sel?.strokes.length === 1 && nb.sel?.items.length === 1); };
    await lassoNb();
    // Dragged onto page 2: drawn there while dragged.
    let during = null;
    await drag([at(b1, .3, .24), at(b2, .3, .2), at(b2, .3, .3)], { hold: async () => { await p.waitForTimeout(200);
      during = await p.evaluate(() => { const page2 = document.querySelectorAll('.nb-page')[1], item = [...document.querySelectorAll('.nb-item.nb-text')].find(n => n.querySelector('textarea').value === 'Moved box');
        const r = page2.getBoundingClientRect(), ir = item?.getBoundingClientRect(); return { itemOnPage2: !!item && page2.contains(item), itemInside: !!ir && ir.top >= r.top && ir.bottom <= r.bottom }; });
      during.ink = await darkIn('.nb-page', 1, '.nb-ink'); during.left = await anyInk('.nb-page', 0); } });
    assert.ok(during.ink.n > 20, `the moved stroke is drawn on page 2 while dragged: ${JSON.stringify(during)}`);
    assert.equal(during.left, 0, 'and not on page 1');
    assert.ok(during.ink.y0 > .1 && during.ink.y1 < .45, `at the new place on page 2: ${JSON.stringify(during.ink)}`);
    assert.ok(during.itemOnPage2 && during.itemInside, `the text box shows on page 2 while dragged: ${JSON.stringify(during)}`);
    let after = await nbState();
    assert.equal(after[0].strokes.length + after[0].items.length, 0, `nothing left on page 1: ${JSON.stringify(after[0])}`);
    assert.equal(after[1].strokes.length, 1, 'the stroke is page 2\'s'); assert.equal(after[1].items.length, 1, 'the box is page 2\'s');
    const inside = page => page.items.every(i => i.x >= 0 && i.y >= 0 && i.x + i.w <= page.width && i.y + i.h <= page.height) && page.strokes.every(s => s.points[0] >= 0 && s.points[1] >= 0 && s.points[0] <= page.width && s.points[1] <= page.height);
    assert.ok(inside(after[1]), `inside page 2: ${JSON.stringify(after[1])}`);
    // About where it was dropped: the stroke started 4% of a page above where it was pressed.
    assert.ok(Math.abs(after[1].strokes[0].points[1] / after[1].height - .26) < .06, `dropped where let go: ${JSON.stringify(after[1].strokes[0])}`);
    await p.waitForFunction(() => { const item = document.querySelectorAll('.nb-page')[1].querySelector('.nb-item.nb-text'); return item?.querySelector('textarea').value === 'Moved box'; });
    assert.ok(await anyInk('.nb-page', 1) > 20, 'the stroke is drawn on page 2');
    assert.equal(await anyInk('.nb-page', 0), 0, 'page 1 has no ink left');
    assert.equal(await p.evaluate(() => document.querySelectorAll('.nb-page')[0].querySelectorAll('.nb-item').length), 0, 'page 1 has no box left');
    // One undo puts both back on page 1, where they were.
    await p.mouse.click(...at(b2, .9, .95)); await p.keyboard.press('Control+z');
    await p.waitForFunction(() => nb.doc.pages[0].strokes.length === 1 && nb.doc.pages[0].items.length === 1 && !nb.doc.pages[1].strokes.length && !nb.doc.pages[1].items.length);
    after = await nbState();
    assert.deepEqual(after[0].strokes.map(s => s.points), before[0].strokes.map(s => s.points), 'the stroke is back where it was');
    assert.deepEqual(after[0].items.map(i => [i.x, i.y]), before[0].items.map(i => [i.x, i.y]), 'the box is back where it was');
    // Dropped under the last page: in at its bottom edge.
    await lassoNb();
    const list = await p.locator('.notebook-pane .nb-pages').boundingBox();
    await drag([at(b1, .3, .24), at(b2, .3, .9), [b2.x + b2.width * .3, Math.min(list.y + list.height - 4, b2.y + b2.height + 40)]]);
    after = await nbState();
    assert.equal(after[1].strokes.length + after[1].items.length, 2, `under the last page it goes on the last page: ${JSON.stringify(after)}`);
    assert.ok(inside(after[1]), `inside the last page: ${JSON.stringify(after[1])}`);
    const bottom = Math.max(...after[1].items.map(i => i.y + i.h));
    assert.ok(after[1].height - bottom < 30, `at its bottom edge: ${bottom} of ${after[1].height}`);
    // A box dragged with the select tool onto another page becomes that page's too, inside it.
    await p.evaluate(() => { inkSetTool('read'); nbSelect(null); }); b1 = await nbBox(0);
    const boxNode = await p.locator('.nb-page').nth(1).locator('.nb-item.nb-text').boundingBox();
    await drag([[boxNode.x + 6, boxNode.y + boxNode.height / 2], at(b1, .5, .6), at(b1, .4, .5)]);
    after = await nbState();
    assert.equal(after[0].items.length, 1, `the box dragged onto page 1 is page 1's: ${JSON.stringify(after)}`); assert.equal(after[1].items.length, 0, 'and not page 2\'s');
    assert.ok(inside(after[0]), `inside page 1: ${JSON.stringify(after[0])}`);
    assert.equal(await p.locator('.nb-page').nth(0).locator('.nb-item.nb-text textarea').inputValue(), 'Moved box', 'shown on page 1');

    // ---- PDF (the original) ----
    await p.locator('[data-mode="original"]').click(); await p.locator('.original-pages .page[data-page="2"] canvas').first().waitFor({ state: 'attached' });
    // The bottom of page 1 and the top of page 2 in view (set again until the pane has its pages laid out and stays put).
    await p.waitForFunction(() => { const c = document.querySelector('.original-pages'), p2 = c.querySelector('.page[data-page="2"]'); if (!p2 || !c.querySelector('.page[data-page="1"]')) return false;
      const off = p2.getBoundingClientRect().top - c.getBoundingClientRect().top - c.clientHeight / 2; if (Math.abs(off) < 4) return true; c.scrollTop += off; return false; }, null, { polling: 200 });
    await p.waitForFunction(() => document.querySelector('.original-pages .page[data-page="2"]')?.dataset.ready === 'true' && document.querySelector('.original-pages .page[data-page="1"]')?.dataset.ready === 'true');
    await p.waitForTimeout(300);
    const pdfBox = async n => p.locator(`.original-pages .page[data-page="${n}"]`).boundingBox();
    let q1 = await pdfBox(1), q2 = await pdfBox(2);
    await p.evaluate(() => inkSetTool('pen')); await drag([at(q1, .2, .82), at(q1, .4, .85), at(q1, .3, .88)]);
    await p.evaluate(() => inkSetTool('text')); await p.mouse.click(...at(q1, .5, .84)); await p.keyboard.type('Boxed'); await p.keyboard.press('Escape'); await p.waitForTimeout(300);
    const pdfState = () => p.evaluate(() => [...document.querySelector('.original-pages').inkDoc.strokes.values()].map(s => ({ id: s.id, page: s.page, tool: s.tool, from: s.from, points: s.points.slice(0, 2) })));
    const pdfBefore = await pdfState();
    assert.deepEqual(pdfBefore.map(s => [s.page, s.tool]).sort(), [[0, 'pen'], [0, 'text']], `a stroke and a box on page 1: ${JSON.stringify(pdfBefore)}`);
    const lassoPdf = async (box, top, bottom) => { await p.evaluate(() => inkSetTool('lasso')); await drag([at(box, .1, top), at(box, .9, top), at(box, .9, bottom), at(box, .1, bottom), at(box, .1, top + .01)]); await p.waitForFunction(() => inkState.selection?.ids.length === 2); };
    await lassoPdf(q1, .78, .93);
    let pdfDuring = null;
    await drag([at(q1, .3, .85), at(q2, .3, .2), at(q2, .3, .25)], { hold: async () => { await p.waitForTimeout(200); pdfDuring = await darkIn('.original-pages .page', 1, '.app-ink-live'); } });
    assert.ok(pdfDuring.n > 20, `the moved ink is drawn on page 2 while dragged: ${JSON.stringify(pdfDuring)}`);
    assert.ok(pdfDuring.y0 > .1 && pdfDuring.y1 < .4, `at the new place on page 2: ${JSON.stringify(pdfDuring)}`);
    let pdfAfter = await pdfState();
    assert.deepEqual(pdfAfter.map(s => s.page), [1, 1], `both are page 2's: ${JSON.stringify(pdfAfter)}`);
    assert.ok(pdfAfter.every(s => pdfBefore.some(o => o.id === s.from)), 'each is a copy of what was moved (`from`)');
    assert.ok(await anyInk('.original-pages .page', 1) > 20, 'drawn on page 2');
    assert.equal(await anyInk('.original-pages .page', 0), 0, 'nothing left drawn on page 1');
    assert.ok(await p.evaluate(() => inkState.selection?.page === 1 && !!document.querySelector('.original-pages .page[data-page="2"] .ink-selection')), 'the selection moved with them');
    // One undo puts both back on page 1.
    await p.keyboard.press('Escape'); await p.keyboard.press('Control+z');
    await p.waitForFunction(() => [...document.querySelector('.original-pages').inkDoc.strokes.values()].every(s => s.page === 0));
    assert.deepEqual((await pdfState()).map(s => s.id).sort(), pdfBefore.map(s => s.id).sort(), 'the originals are back');
    // A move within a page is as before: a new id, `from` the old one, the same page.
    q1 = await pdfBox(1); await lassoPdf(q1, .78, .93);
    await drag([at(q1, .3, .85), at(q1, .35, .7)]);
    pdfAfter = await pdfState();
    assert.deepEqual(pdfAfter.map(s => s.page), [0, 0], 'still page 1\'s');
    assert.ok(pdfAfter.every(s => pdfBefore.some(o => o.id === s.from) && !pdfBefore.some(o => o.id === s.id)), 'new ids, `from` the old ones');
    const moved = pdfAfter.find(s => s.tool === 'pen'), was = pdfBefore.find(s => s.tool === 'pen');
    assert.ok(moved.points[1] > was.points[1] + 50, `moved up the page (PDF y grows upward): ${was.points[1]} → ${moved.points[1]}`);
    // A text box dragged with the select tool onto page 2 is page 2's.
    await p.evaluate(() => { inkSetTool('read'); inkState.selection = null; document.querySelectorAll('.ink-selection').forEach(n => n.remove()); });
    const textAt = await p.evaluate(() => { const c = document.querySelector('.original-pages'), view = c.pdfViewer.getPageView(0), stroke = [...c.inkDoc.strokes.values()].find(s => s.tool === 'text'), b = inkBox(stroke, view.viewport), r = view.div.getBoundingClientRect();
      return { id: stroke.id, x: r.left + (b.x0 + 6) * r.width / view.viewport.width, y: r.top + (b.y0 + b.y1) / 2 * r.height / view.viewport.height }; });
    q2 = await pdfBox(2); await drag([[textAt.x, textAt.y], at(q2, .4, .4), at(q2, .4, .35)]);
    const text = (await pdfState()).find(s => s.tool === 'text');
    assert.ok(text.page === 1 && text.from === textAt.id, `the text box is page 2's: ${JSON.stringify(text)}`);
    assert.ok(await p.evaluate(() => !!document.querySelector('.original-pages .page[data-page="2"] .ink-text-selected')), 'and chosen there');
    console.log('lasso move smoke: ok');
  } finally {
    await app.close().catch(() => {});
    await fs.rm(temp, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exit(1); });
