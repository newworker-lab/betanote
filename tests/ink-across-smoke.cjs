// End-to-end check of moving ink to the pane beside it (desktop/ink.js inkDrop, inkTransfer, inkSendToNotebook;
// desktop/notebook.js appInk.nb). In 동시보기 a shape and a text box of the original, dragged with the select tool and
// let go over the translation, leave the original's ink and are the translation's (same kind, on the page they were
// dropped on, inside it); one Ctrl+Z each puts them back, Ctrl+Y moves them again. Beside a notebook the same drag
// onto a notebook page makes the shape a stroke of that page and the box a text item with its text and size, both
// inside the page, gone from the PDF; they are shown on the notebook page while dragged; one Ctrl+Z undoes both sides.
// A drag let go over the same pane stays that pane's (a move within it, as before).
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
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), `${appName.id}-ink-across-e2e-`)), vault = path.join(temp, 'vault'); await fs.mkdir(vault);
  const doc = await PDFDocument.create(), font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < 2; i++) { const page = doc.addPage([600, 800]); for (let l = 0; l < 6; l++) page.drawText('A research paper connects ideas and methods across many fields.', { x: 50, y: 740 - l * 18, size: 12, font }); }
  await fs.writeFile(path.join(temp, 'paper.pdf'), await doc.save());
  const executable = require('./app-executable.cjs')(root);
  const env = /utf-?8/i.test(process.env.LC_ALL || process.env.LANG || '') ? process.env : { ...process.env, LC_ALL: 'C.UTF-8', LANG: 'C.UTF-8' };
  const app = await electron.launch({ env, executablePath: executable, args: [...(process.env.APP_TEST_SOURCE === '1' ? [root] : []), '--no-sandbox', '--ozone-platform=headless', '--disable-gpu', `--user-data-dir=${path.join(temp, 'profile')}`], timeout: 20000 });
  try {
    const p = await app.firstWindow(); p.setDefaultTimeout(20000); await p.setViewportSize({ width: 1500, height: 950 });
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
    await p.evaluate(() => { actions['close-left']?.(); actions['close-right']?.(); });
    await p.locator('[data-mode="dual"]').click(); await p.locator('#dialog [data-action="gpt-start"]').click();
    const O = '.original-pane .original-pages, .original-pages:not(.translated-pane .translated-pages)', T = '.translated-pane .translated-pages';
    await p.locator(`${T} .page[data-page="1"] .translation-layer[data-ready="true"]`).waitFor(); await p.waitForTimeout(600);
    const pane = sel => sel === 'T' ? T : '.original-pages';
    const ink = which => p.evaluate(sel => { const c = [...document.querySelectorAll(sel)].find(c => c.inkDoc && c.offsetParent && (sel !== '.original-pages' || !c.closest('.translated-pane'))); return [...c.inkDoc.strokes.values()].map(s => ({ id: s.id, tool: s.tool, shape: s.shape, page: s.page, text: s.text, x: s.points[0], y: s.points[1] })); }, pane(which));
    const box = async (sel, n = 1) => p.locator(`${sel} .page[data-page="${n}"]`).first().boundingBox();
    let o = await box('.original-pages'), t = await box(T); assert.ok(t.x > o.x + o.width * .5, 'the translation is beside the original');
    const at = (b, fx, fy) => [b.x + b.width * fx, b.y + b.height * fy];
    const tool = name => p.locator(`.ink-toolbar [data-ink-tool="${name}"]`).click();
    const dragTo = async (from, to) => { await p.mouse.move(...from); await p.mouse.down(); await p.mouse.move(from[0] + 30, from[1] + 5, { steps: 4 }); await p.mouse.move(...to, { steps: 10 }); };
    const drop = async () => { await p.mouse.up(); await p.waitForTimeout(350); };

    // A rectangle and a text box on the original's lower half.
    await tool('shape'); await p.mouse.move(...at(o, .2, .3)); await p.mouse.down(); await p.mouse.move(...at(o, .5, .42), { steps: 5 }); await p.mouse.up(); await p.waitForTimeout(250);
    await tool('text'); await p.mouse.click(...at(o, .2, .5)); await p.keyboard.type('Note'); await p.keyboard.press('Escape'); await p.waitForTimeout(250);
    let before = await ink('O'); assert.deepEqual(before.map(s => s.tool + (s.shape || '')).sort(), ['penrect', 'text'], 'a rectangle and a text box on the original');
    assert.equal((await ink('T')).length, 0, 'none on the translation');
    await tool('read');

    // The rectangle, pressed on its edge and let go over the translation. Finding the pane under the pointer at every
    // move must stay cheap: it does not walk the elements under the pointer (that took most of a frame per move).
    await p.evaluate(() => { window.hitTests = 0; const e = document.elementsFromPoint.bind(document); document.elementsFromPoint = (...a) => { window.hitTests++; return e(...a); }; });
    await dragTo(at(o, .2, .36), at(t, .5, .4)); await drop();
    assert.equal(await p.evaluate(() => window.hitTests), 0, 'a drag asks for no element hit test');
    assert.deepEqual((await ink('O')).map(s => s.tool), ['text'], 'the rectangle left the original');
    let moved = await ink('T'); assert.deepEqual(moved.map(s => s.tool + (s.shape || '') + s.page), ['penrect0'], 'and is the translation’s, on the page it was dropped on');
    assert.ok(!before.some(s => s.id === moved[0].id), 'as a new stroke');
    assert.ok(await p.evaluate(sel => { const sel2 = inkState.selection; return !!sel2 && sel2.container === [...document.querySelectorAll(sel)].find(c => c.offsetParent); }, T), 'it stays chosen, in the translation');
    await p.keyboard.press('Escape');
    // The text box.
    await dragTo(at(o, .22, .512), at(t, .4, .55)); await drop();
    assert.equal((await ink('O')).length, 0, 'the text box left the original');
    moved = await ink('T'); assert.deepEqual(moved.map(s => s.tool).sort(), ['pen', 'text'], 'and is the translation’s'); assert.equal(moved.find(s => s.tool === 'text').text, 'Note', 'with its text');
    // One undo each; redo.
    await p.keyboard.press('Escape'); await p.keyboard.press('Control+z'); await p.waitForTimeout(300);
    assert.deepEqual([(await ink('O')).map(s => s.tool), (await ink('T')).map(s => s.tool)], [['text'], ['pen']], 'one Ctrl+Z puts the box back');
    await p.keyboard.press('Control+z'); await p.waitForTimeout(300);
    assert.deepEqual([(await ink('O')).map(s => s.id).sort(), (await ink('T')).length], [before.map(s => s.id).sort(), 0], 'another puts the rectangle back: the original holds what it held');
    await p.keyboard.press('Control+y'); await p.waitForTimeout(300);
    assert.deepEqual([(await ink('O')).map(s => s.tool), (await ink('T')).map(s => s.tool)], [['text'], ['pen']], 'Ctrl+Y moves it again');
    await p.keyboard.press('Control+z'); await p.waitForTimeout(300);
    // Let go over the same pane: a move within it.
    await dragTo(at(o, .2, .36), at(o, .3, .4)); await drop();
    const within = await ink('O'); assert.equal(within.length, 2, 'a drag inside the original stays the original’s'); assert.equal((await ink('T')).length, 0);
    await p.keyboard.press('Escape'); await p.keyboard.press('Control+z'); await p.waitForTimeout(300);
    // What was saved: after the moves and the undos the original's ink file holds both, the translation's none.
    assert.deepEqual(errors, [], 'nothing thrown');

    // Beside a notebook.
    await p.locator('[data-mode="notebook"]').click(); await p.locator('[data-action="nb-new"]').first().click(); await p.locator('[data-action="nb-create"]').click(); await p.locator('.nb-page').first().waitFor(); await p.waitForTimeout(700);
    const nbState = () => p.evaluate(() => { const pg = nb.doc.pages[0]; return { width: pg.width, height: pg.height, strokes: pg.strokes.map(s => ({ tool: s.tool, shape: s.shape, keys: Object.keys(s).sort().join(), xs: s.points.filter((_, i) => i % 4 === 0), ys: s.points.filter((_, i) => i % 4 === 1) })), items: pg.items.map(i => ({ type: i.type, text: i.text, size: i.size, x: i.x, y: i.y, w: i.w, h: i.h })) }; });
    await p.waitForFunction(() => document.querySelector('.original-pages .page[data-page="1"]')?.dataset.ready === 'true'); await p.waitForTimeout(400);
    o = await box('.original-pages'); const n = await p.locator('.nb-page').first().boundingBox();
    before = await ink('O'); assert.equal(before.length, 2, 'the original still holds the rectangle and the box');
    const pdfShape = before.find(s => s.tool === 'pen'), edge = await p.evaluate(id => { const c = [...document.querySelectorAll('.original-pages')].find(c => c.inkDoc && c.offsetParent), s = c.inkDoc.strokes.get(id), view = c.pdfViewer.getPageView(s.page), r = view.div.getBoundingClientRect(), [x0, y0] = view.viewport.convertToViewportPoint(s.points[0], s.points[1]), [, y1] = view.viewport.convertToViewportPoint(s.points[8], s.points[9]), f = r.width / view.viewport.width; return [r.left + x0 * f, r.top + (y0 + y1) / 2 * f]; }, pdfShape.id);
    await dragTo(edge, [n.x + n.width * .5, n.y + n.height * .3]); await p.waitForTimeout(250);
    assert.ok(await p.evaluate(() => { const c = document.querySelector('.nb-page .nb-ink'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; for (let i = 3; i < d.length; i += 4) if (d[i]) return true; return false; }), 'while dragged it is drawn on the notebook page');
    await drop();
    let book = await nbState(); assert.equal(book.strokes.length, 1, 'the rectangle is a stroke of the notebook page'); assert.equal(book.strokes[0].tool + book.strokes[0].shape, 'penrect'); assert.equal(book.strokes[0].keys, 'color,id,points,shape,tool,width', 'holding only what a notebook stroke holds');
    assert.ok(Math.min(...book.strokes[0].xs) >= 0 && Math.max(...book.strokes[0].xs) <= book.width && Math.min(...book.strokes[0].ys) >= 0 && Math.max(...book.strokes[0].ys) <= book.height, 'inside the page');
    { const w = Math.max(...book.strokes[0].xs) - Math.min(...book.strokes[0].xs); assert.ok(Math.abs(w - 180) < 4, `as wide in points as it was (${w})`); }
    assert.deepEqual((await ink('O')).map(s => s.tool), ['text'], 'and gone from the PDF');
    const textEdge = await p.evaluate(id => { const c = [...document.querySelectorAll('.original-pages')].find(c => c.inkDoc && c.offsetParent), s = c.inkDoc.strokes.get(id), view = c.pdfViewer.getPageView(s.page), r = view.div.getBoundingClientRect(), [x, y] = view.viewport.convertToViewportPoint(s.points[0], s.points[1]), f = r.width / view.viewport.width; return [r.left + x * f + 8, r.top + y * f + 8]; }, before.find(s => s.tool === 'text').id);
    await dragTo(textEdge, [n.x + n.width * .4, n.y + n.height * .6]); await p.waitForTimeout(200);
    assert.equal(await p.locator('.nb-page .nb-ghost').count(), 1, 'a text box dragged over the notebook shows where it will land');
    await drop();
    book = await nbState(); assert.equal(await p.locator('.nb-page .nb-ghost').count(), 0);
    assert.deepEqual(book.items.map(i => [i.type, i.text]), [['text', 'Note']], 'the box is a text item of the page, with its text'); assert.ok(book.items[0].size >= 6 && book.items[0].x >= 0 && book.items[0].y >= 0 && book.items[0].x + book.items[0].w <= book.width && book.items[0].y + book.items[0].h <= book.height, 'inside the page');
    assert.equal(await p.locator('.nb-page .nb-text textarea').inputValue(), 'Note', 'and shown on it');
    assert.equal((await ink('O')).length, 0, 'the PDF holds neither');
    await p.keyboard.press('Control+z'); await p.waitForTimeout(400);
    assert.deepEqual([(await nbState()).items.length, (await ink('O')).map(s => s.tool)], [0, ['text']], 'one Ctrl+Z: the box is back on the PDF and off the notebook');
    await p.keyboard.press('Control+z'); await p.waitForTimeout(400);
    assert.deepEqual([(await nbState()).strokes.length, (await ink('O')).map(s => s.id).sort()], [0, before.map(s => s.id).sort()], 'another: the rectangle too');
    await p.keyboard.press('Control+y'); await p.waitForTimeout(400);
    assert.deepEqual([(await nbState()).strokes.length, (await ink('O')).map(s => s.tool)], [1, ['text']], 'Ctrl+Y moves it onto the notebook again');
    assert.equal(await p.evaluate(() => window.hitTests), 0, 'nor does a drag onto the notebook');
    assert.deepEqual(errors, [], 'nothing thrown');
    console.log('Ink across smoke passed: a shape and a text box of the original go to the translation and to a notebook page where they are let go, one undo each.');
  } finally { await app.close(); await fs.rm(temp, { recursive: true, force: true }); }
})().catch(e => { console.error(e); process.exit(1); });
