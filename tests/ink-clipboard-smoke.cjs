// End-to-end check of copying and pasting ink (desktop/ink.js "Copy and paste", desktop/notebook.js). A shape pressed
// with the select tool and a text box chosen on a PDF page are copied with Ctrl+C and pasted with Ctrl+V under the
// pointer, the same shape, colour, text and size, the copy chosen, each paste one step to undo; the first stays. A
// text box's words are on the clipboard as plain text. Pasted over a notebook page it is that page's text box, and a
// notebook box copied and pasted over the PDF is a PDF text box. Words chosen on the page are still copied as words,
// and a paste while typing in a box goes into the box.
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
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), `${appName.id}-ink-clipboard-e2e-`)), vault = path.join(temp, 'vault'); await fs.mkdir(vault);
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
    await p.evaluate(() => { actions['close-left']?.(); actions['close-right']?.(); }); await p.waitForTimeout(300);
    const ink = () => p.evaluate(() => { const c = [...document.querySelectorAll('.original-pages')].find(c => c.inkDoc && c.offsetParent); return [...c.inkDoc.strokes.values()].map(s => ({ id: s.id, tool: s.tool, shape: s.shape, page: s.page, text: s.text, size: s.width, color: s.color, x: s.points[0], y: s.points[1], xs: s.tool === 'text' ? [] : s.points.filter((_, i) => i % 4 === 0), ys: s.tool === 'text' ? [] : s.points.filter((_, i) => i % 4 === 1) })); });
    const screen = id => p.evaluate(id => { const c = [...document.querySelectorAll('.original-pages')].find(c => c.inkDoc && c.offsetParent), s = c.inkDoc.strokes.get(id), view = c.pdfViewer.getPageView(s.page), r = view.div.getBoundingClientRect(), b = inkBox(s, view.viewport), f = r.width / view.viewport.width; return { left: r.left + b.x0 * f, top: r.top + b.y0 * f, right: r.left + b.x1 * f, bottom: r.top + b.y1 * f }; }, id);
    let o = await p.locator('.original-pages .page[data-page="1"]').first().boundingBox(); const at = (fx, fy) => [o.x + o.width * fx, o.y + o.height * fy];
    const tool = name => p.locator(`.ink-toolbar [data-ink-tool="${name}"]`).click();
    await tool('shape'); await p.mouse.move(...at(.15, .24)); await p.mouse.down(); await p.mouse.move(...at(.3, .3), { steps: 5 }); await p.mouse.up(); await p.waitForTimeout(250);
    await tool('text'); await p.mouse.click(...at(.15, .33)); await p.keyboard.type('Note'); await p.keyboard.press('Escape'); await p.waitForTimeout(250); await tool('read');
    const first = await ink(), rect = first.find(s => s.tool === 'pen'), note = first.find(s => s.tool === 'text'); assert.ok(rect && note, 'a rectangle and a text box');

    // A shape: pressed with the select tool, Ctrl+C, the pointer elsewhere on the page, Ctrl+V.
    { const b = await screen(rect.id); await p.mouse.click(b.left, (b.top + b.bottom) / 2); await p.waitForTimeout(250); }
    await p.keyboard.press('ControlOrMeta+c'); await p.waitForTimeout(250);
    await p.mouse.move(...at(.6, .26)); await p.keyboard.press('ControlOrMeta+v'); await p.waitForTimeout(400);
    let now = await ink(), pasted = now.filter(s => s.tool === 'pen' && s.id !== rect.id); assert.equal(pasted.length, 1, 'Ctrl+V adds a copy of the shape'); assert.ok(now.some(s => s.id === rect.id), 'the first one stays');
    assert.equal(pasted[0].shape + pasted[0].color, rect.shape + rect.color, 'the same shape and colour');
    { const w = xs => Math.max(...xs) - Math.min(...xs); assert.ok(Math.abs(w(pasted[0].xs) - w(rect.xs)) < 1 && Math.abs(w(pasted[0].ys) - w(rect.ys)) < 1, 'the same size'); }
    { const b = await screen(pasted[0].id), [x, y] = at(.6, .26); assert.ok(Math.abs((b.left + b.right) / 2 - x) < 6 && Math.abs((b.top + b.bottom) / 2 - y) < 6, 'under the pointer'); }
    assert.deepEqual(await p.evaluate(() => inkState.selection?.ids), [pasted[0].id], 'the copy is the one chosen');
    await p.keyboard.press('ControlOrMeta+v'); await p.waitForTimeout(400); assert.equal((await ink()).filter(s => s.tool === 'pen').length, 3, 'Ctrl+V again adds another');
    await p.keyboard.press('ControlOrMeta+z'); await p.waitForTimeout(300); await p.keyboard.press('ControlOrMeta+z'); await p.waitForTimeout(300);
    assert.deepEqual((await ink()).map(s => s.id).sort(), first.map(s => s.id).sort(), 'each paste is one step to undo');

    // A text box.
    { const b = await screen(note.id); await p.mouse.click(b.left + 6, (b.top + b.bottom) / 2); await p.waitForTimeout(250); }
    await p.keyboard.press('ControlOrMeta+c'); await p.waitForTimeout(250);
    assert.equal(await app.evaluate(({ clipboard }) => clipboard.readText()), 'Note', 'its text is on the clipboard for other programs');
    await p.mouse.move(...at(.6, .33)); await p.keyboard.press('ControlOrMeta+v'); await p.waitForTimeout(400);
    now = await ink(); const notes = now.filter(s => s.tool === 'text'); assert.equal(notes.length, 2, 'Ctrl+V adds a copy of the text box');
    const copy = notes.find(s => s.id !== note.id); assert.deepEqual([copy.text, copy.size, copy.color], [note.text, note.size, note.color], 'with its text, size and colour');
    { const a = await screen(note.id), b = await screen(copy.id); assert.ok(Math.abs((a.right - a.left) - (b.right - b.left)) < 2 && Math.abs((a.bottom - a.top) - (b.bottom - b.top)) < 2, 'as large as the first'); }
    // Text chosen on the page is copied as text, as before.
    await p.keyboard.press('Escape'); await p.locator('.original-pages .page[data-page="1"] .textLayer span').first().dblclick(); await p.waitForTimeout(250); await p.keyboard.press('ControlOrMeta+c'); await p.waitForTimeout(250);
    assert.match(await app.evaluate(({ clipboard }) => clipboard.readText()), /^[A-Za-z]+\s?$/, 'words chosen on the page are still copied as words'); await p.keyboard.press('Escape'); await p.mouse.click(...at(.45, .37));
    assert.deepEqual(errors, [], 'nothing thrown');

    // Onto a notebook page, and from it back onto the PDF.
    { const b = await screen(note.id); await p.mouse.click(b.left + 6, (b.top + b.bottom) / 2); await p.waitForTimeout(250); } await p.keyboard.press('ControlOrMeta+c'); await p.waitForTimeout(250);
    await p.locator('[data-mode="notebook"]').click(); await p.locator('[data-action="nb-new"]').first().click(); await p.locator('[data-action="nb-create"]').click(); await p.locator('.nb-page').first().waitFor(); await p.waitForTimeout(700);
    const book = () => p.evaluate(() => { const pg = nb.doc.pages[0]; return { width: pg.width, height: pg.height, strokes: pg.strokes.length, items: pg.items.map(i => ({ id: i.id, type: i.type, text: i.text, size: i.size, x: i.x, y: i.y, w: i.w, h: i.h })) }; });
    const n = await p.locator('.nb-page').first().boundingBox(); await p.mouse.click(n.x + n.width * .5, n.y + 300); await p.mouse.move(n.x + n.width * .5, n.y + 300); await p.keyboard.press('ControlOrMeta+v'); await p.waitForTimeout(400);
    let b = await book(); assert.deepEqual(b.items.map(i => [i.type, i.text, i.size]), [['text', 'Note', note.size]], 'pasted over a notebook page it is a text box of that page');
    assert.ok(b.items[0].x >= 0 && b.items[0].y >= 0 && b.items[0].x + b.items[0].w <= b.width, 'inside the page'); assert.equal(await p.locator('.nb-page .nb-text textarea').inputValue(), 'Note');
    await p.keyboard.press('ControlOrMeta+z'); await p.waitForTimeout(300); assert.equal((await book()).items.length, 0, 'one Ctrl+Z takes it off'); await p.keyboard.press('ControlOrMeta+y'); await p.waitForTimeout(300);
    // The notebook's box, chosen and copied, pasted on the PDF page.
    await p.keyboard.press('Escape'); const tb = await p.locator('.nb-page .nb-text').first().boundingBox(); await p.mouse.click(tb.x + 10, tb.y + 8); await p.waitForTimeout(250); await p.keyboard.press('ControlOrMeta+c'); await p.waitForTimeout(250);
    await p.waitForFunction(() => document.querySelector('.original-pages .page[data-page="1"]')?.dataset.ready === 'true'); o = await p.locator('.original-pages .page[data-page="1"]').first().boundingBox();
    const beforeTexts = (await ink()).filter(s => s.tool === 'text').length; await p.mouse.move(...at(.5, .4)); await p.keyboard.press('ControlOrMeta+v'); await p.waitForTimeout(400);
    assert.equal((await ink()).filter(s => s.tool === 'text').length, beforeTexts + 1, 'copied on the notebook and pasted over the PDF it is a PDF text box'); assert.equal((await book()).items.length, 1, 'the notebook keeps its own');
    // Typing in a box: Ctrl+V pastes text into it, not ink onto the page.
    await p.locator('[data-action="nb-text"]').first().click(); await p.waitForTimeout(400); const itemsBefore = (await book()).items.length; await app.evaluate(({ clipboard }) => clipboard.writeText('plain words')); await p.keyboard.press('ControlOrMeta+v'); await p.waitForTimeout(300); await p.keyboard.press('Escape'); await p.waitForTimeout(300);
    b = await book(); assert.equal(b.items.length, itemsBefore, 'a paste while typing adds no box'); assert.ok(b.items.some(i => i.text === 'plain words'), 'the words went into the box being typed in');
    assert.deepEqual(errors, [], 'nothing thrown');
    console.log('Ink clipboard smoke passed: Ctrl+C and Ctrl+V copy a shape and a text box on the PDF, onto a notebook page and back, each paste one undo; text is still copied as text.');
  } finally { await app.close(); await fs.rm(temp, { recursive: true, force: true }); }
})().catch(e => { console.error(e); process.exit(1); });
