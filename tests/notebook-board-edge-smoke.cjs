// End-to-end check of a whiteboard's edges (desktop/notebook.js): growing keeps what is going on (a stroke begun right
// after, typing in a box placed near the bottom), a tall picture pasted on a long board is still saved, a page full of
// strokes says so instead of failing to save, a memo pin dragged on a board lands where it is let go, the ink is drawn
// where it was written at a zoom whose page width is not a whole pixel, trimming keeps a pin, new boxes on a long board
// come where it is seen, a new memo card grows the board, a taller window draws the ink it shows, and the laser keeps its
// sharpness on a long board. APP_TEST_SOURCE=1 runs the source.
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
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), `${appName.id}-board-edge-`)), vault = path.join(temp, 'vault'); await fs.mkdir(vault);
  const doc = await PDFDocument.create(), font = await doc.embedFont(StandardFonts.Helvetica); doc.addPage([600, 800]).drawText('A paper.', { x: 40, y: 700, size: 14, font });
  await fs.writeFile(path.join(temp, 'paper.pdf'), await doc.save());
  const env = /utf-?8/i.test(process.env.LC_ALL || process.env.LANG || '') ? process.env : { ...process.env, LC_ALL: 'C.UTF-8', LANG: 'C.UTF-8' };
  let app;
  try {
    app = await electron.launch({ env: { ...env, APP_UI_LANG: 'ko' }, executablePath: require('./app-executable.cjs')(root), args: [...(process.env.APP_TEST_SOURCE === '1' ? [root] : []), '--no-sandbox', '--ozone-platform=headless', '--disable-gpu', `--user-data-dir=${path.join(temp, 'profile')}`], timeout: 20000 });
    const p = await app.firstWindow(); p.setDefaultTimeout(15000); await p.setViewportSize({ width: 1400, height: 950 });
    p.on('pageerror', e => { console.error(e); process.exitCode = 1; });
    await app.evaluate(({ dialog }) => { globalThis.openQueue = []; dialog.showOpenDialog = async () => ({ canceled: false, filePaths: globalThis.openQueue.shift() }); });
    await app.evaluate((_, v) => globalThis.openQueue.push([v]), vault); await p.locator('[data-action="storage"]').first().click();
    await app.evaluate((_, f) => globalThis.openQueue.push([f]), path.join(temp, 'paper.pdf')); await p.locator('[data-action="add-files"]').first().click();
    await p.locator('.paper-item').click(); await p.locator('.original-pages .page[data-page="1"] canvas').first().waitFor();
    await p.locator('[data-mode="notebook"]').click(); await p.locator('.notebook-pane [data-action="nb-new"]').first().click();
    await p.locator('#nb-title').fill('보드 가장자리'); await p.locator('#dialog [data-action="nb-create"]').click(); await p.locator('.nb-page').first().waitFor();
    // A fresh whiteboard as the notebook's only page, `height` points long, with `strokes` pen strokes of 150 points spread down it.
    const freshBoard = (height = 842, strokes = 0) => p.evaluate(([height, strokes]) => {
      const page = { id: nbId(), template: 'blank', width: 595, height, board: true, items: [], strokes: [] };
      for (let i = 0; i < strokes; i++) { const pts = [], y0 = 20 + (i * 37) % Math.max(1, height - 260); for (let k = 0; k < 150; k++) pts.push(30 + k * 3, y0 + Math.sin(k / 9) * 8, .5, k); page.strokes.push({ id: nbId(), tool: 'pen', color: '#1d4ed8', width: 1.5, points: pts }); }
      nb.doc.pages = [page]; nb.sel = null; nbRender(); nbSave(true);
    }, [height, strokes]);
    const board = p.locator('.nb-page[data-board]');
    const toPoints = async () => { const r = await board.boundingBox(); return { r, s: r.width / 595 }; };
    // Scroll so that page point y is at the middle of the view.
    const showY = y => p.evaluate(y => { const el = document.querySelector('.nb-page[data-board]'), list = el.closest('.nb-pages'), s = el.getBoundingClientRect().width / 595; list.scrollTop += el.getBoundingClientRect().top - list.getBoundingClientRect().top + y * s - list.clientHeight / 2; }, y);
    const saved = () => p.waitForFunction(() => /저장됨/.test(document.querySelector('.nb-status')?.textContent || ''));
    // Each check runs on its own: one that fails is said and the next still runs (each begins on a fresh board).
    const failed = []; let r, s;
    const step = async (name, run) => { if (process.env.ONLY && !name.startsWith(process.env.ONLY)) return; try { await p.keyboard.press('Escape'); await p.evaluate(() => { document.querySelectorAll('dialog[open]').forEach(d => d.close()); nbSetZoom(1); }); await run(); console.log('ok', name); } catch (error) { failed.push(name); console.error('FAILED', name, String(error.message).split('\n')[0], (String(error.stack).match(/notebook-board-edge-smoke.cjs:(\d+)/) || [])[1]); } };

    await step('1 growth keeps a stroke and typing', async () => {
    // 1. A stroke begun right after one that grew the board is kept (a board with 1,500 long strokes on it).
    await freshBoard(842, 1500); await saved(); await showY(700); await p.waitForTimeout(200);
    await p.locator('[data-ink-tool="pen"]').click();
    ({ r, s } = await toPoints());
    // A slow frame (a board full of writing takes long to draw): what waits for the next frame comes 150 ms late, so the
    // second stroke begins before it.
    await p.evaluate(() => { globalThis.rafNow = requestAnimationFrame; requestAnimationFrame = cb => globalThis.rafNow(() => setTimeout(() => globalThis.rafNow(cb), 150)); });
    await p.mouse.move(r.x + 100 * s, r.y + 780 * s); await p.mouse.down(); await p.mouse.move(r.x + 160 * s, r.y + 790 * s, { steps: 4 }); await p.mouse.up();
    await p.mouse.move(r.x + 100 * s, r.y + 300 * s); await p.mouse.down(); await p.mouse.move(r.x + 160 * s, r.y + 310 * s, { steps: 4 }); await p.mouse.up();
    await p.waitForTimeout(600); await p.evaluate(() => { requestAnimationFrame = globalThis.rafNow; });
    assert.equal(await p.evaluate(() => nb.doc.pages[0].strokes.length), 1502, 'both strokes are kept');
    assert.equal(await p.evaluate(() => nb.doc.pages[0].height), 1684);
    // A box placed with the text tool near the bottom takes what is typed, though placing it grew the board.
    await freshBoard(842); await saved(); await showY(700); await p.waitForTimeout(200);
    await p.locator('[data-ink-tool="text"]').click(); ({ r, s } = await toPoints());
    await p.mouse.click(r.x + 100 * s, r.y + 742 * s); await p.waitForFunction(() => document.activeElement?.matches('.nb-text textarea'));
    await p.keyboard.type('low'); await p.locator('.ink-text-bar [data-tb="done"]').click();
    assert.deepEqual(await p.evaluate(() => [nb.doc.pages[0].height, nb.doc.pages[0].items.map(i => i.text)]), [1684, ['low']]);
    // A box being edited and resized into the bottom keeps editing: what is typed after goes in.
    await (await toolShown(p, '.nb-text')).dblclick(); await (await toolShown(p, '.nb-text.editing')).waitFor(); ({ r, s } = await toPoints());
    const handle = await p.locator('.nb-text .nb-resize').boundingBox();
    await p.mouse.move(handle.x + 3, handle.y + 3); await p.mouse.down(); await p.mouse.move(handle.x + 3, r.y + 1600 * s, { steps: 6 }); await p.mouse.up();
    await p.waitForFunction(() => nb.doc.pages[0].height > 1684);
    await (await toolShown(p, '.nb-text textarea')).click(); await p.keyboard.press('End'); await p.keyboard.type(' 더'); await p.locator('.ink-text-bar [data-tb="done"]').click();
    assert.deepEqual(await p.evaluate(() => nb.doc.pages[0].items.map(i => i.text)), ['low 더']);

    });
    await step('2 tall picture saves', async () => {
    // 2. A tall picture pasted on a long board is fitted to what a box can be, and the notebook is still saved.
    await freshBoard(5052); await saved(); await showY(1000);
    await p.evaluate(async () => { const c = document.createElement('canvas'); c.width = 200; c.height = 6000; c.getContext('2d').fillRect(0, 0, 200, 6000); const blob = await new Promise(r => c.toBlob(r, 'image/png')); const dt = new DataTransfer(); dt.items.add(new File([blob], 'tall.png', { type: 'image/png' })); document.querySelector('.nb-pages').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true })); });
    await p.locator('#toast').filter({ hasText: '그림을 노트북에 넣었습니다' }).waitFor();
    await saved(); assert.ok(await p.evaluate(() => nb.doc.pages[0].items.every(i => i.h <= 4000 && i.w <= 4000)));
    await p.evaluate(() => nbChange('필기', () => nb.doc.pages[0].strokes.push({ id: nbId(), tool: 'pen', color: '#000000', width: 2, points: [10, 10, .5, 0, 20, 20, .5, 5] }))); await saved();

    });
    await step('3 full page says so', async () => {
    // 3. A page with all the strokes it holds says so on one more, and nothing fails to save.
    await freshBoard(5052); await saved();
    await p.evaluate(() => { const page = nb.doc.pages[0]; page.strokes = Array.from({ length: 20000 }, (_, i) => ({ id: `fill-${String(i).padStart(8, '0')}`, tool: 'pen', color: '#000000', width: 1, points: [10 + i % 500, 30 + Math.floor(i / 500), .5, 0] })); nbRender(); nbSave(true); });
    await saved(); await showY(300); ({ r, s } = await toPoints());
    await p.locator('[data-ink-tool="pen"]').click(); await p.mouse.move(r.x + 200 * s, r.y + 300 * s); await p.mouse.down(); await p.mouse.move(r.x + 260 * s, r.y + 320 * s, { steps: 4 }); await p.mouse.up();
    await p.locator('#toast').filter({ hasText: '한 쪽에는 필기를 20,000개까지' }).waitFor();
    assert.equal(await p.evaluate(() => nb.doc.pages[0].strokes.length), 20000);
    await p.waitForTimeout(800); assert.doesNotMatch(await p.locator('.nb-status').textContent(), /실패/);

    });
    await step('4/6 pin drag and trim', async () => {
    // 4. A memo pin dragged on a board lands where it is let go; 6. trimming keeps it.
    await freshBoard(2526); await p.evaluate(() => nbChange('추가', () => nb.doc.pages[0].items.push({ id: nbId(), type: 'text', x: 40, y: 1500, w: 200, h: 40, text: '끝' }))); await saved();
    const pinAt = () => board.evaluate(el => { const pin = el.querySelector('.nb-pin'), s = el.getBoundingClientRect().width / 595; return Math.round((pin.getBoundingClientRect().top + 10 - el.getBoundingClientRect().top) / s); });
    await p.evaluate(() => { const key = `${state.selected}-메모`, page = nb.doc.pages[0]; notes[key] ||= '핀 메모'; notes[key + '#pin'] = JSON.stringify({ notebookId: nb.doc.id, pageId: page.id, x: .5, y: nbPinStored(page, 1000 / page.height) }); nbRefreshPins(); });
    await p.locator('[data-ink-tool="read"]').click(); await showY(1050); ({ r, s } = await toPoints());
    const pin = await p.locator('.nb-pin').boundingBox();
    await p.mouse.move(pin.x + 10, pin.y + 10); await p.mouse.down(); await p.mouse.move(pin.x + 10, pin.y + 10 + 100 * s, { steps: 6 }); await p.mouse.up();
    await p.waitForFunction(() => { const place = JSON.parse(notes[`${state.selected}-메모#pin`]); return Math.abs(nbPinDown(nb.doc.pages[0], place.y) * nb.doc.pages[0].height - 1100) < 3; });
    await p.evaluate(() => nbRefreshPins()); assert.ok(Math.abs(await pinAt() - 1100) <= 2, `the pin is at ${await pinAt()}`);
    await p.evaluate(() => { const page = nb.doc.pages[0], key = `${state.selected}-메모`; notes[key + '#pin'] = JSON.stringify({ notebookId: nb.doc.id, pageId: page.id, x: .5, y: nbPinStored(page, 2300 / page.height) }); nbRefreshPins(); });
    await board.evaluate(el => el.closest('.nb-page-wrap').scrollIntoView({ block: 'start' })); await board.evaluate(el => el.closest('.nb-page-wrap').querySelector('[data-nb-page-menu]').click());
    await p.locator('.nb-page-menu [data-nb-page="trim"]').click(); await p.waitForTimeout(300);
    assert.ok(await p.evaluate(() => nb.doc.pages[0].height) >= 2312, 'the board ends under the pin');

    });
    await step('5 fractional width', async () => {
    // 5. At a zoom whose page width is not a whole pixel, the ink far down a long board is drawn where it was written.
    await freshBoard(40000); await p.evaluate(() => { nbSetZoom(1.3); nbChange('필기', () => nb.doc.pages[0].strokes.push({ id: nbId(), tool: 'pen', color: '#dc2626', width: 3, points: [100, 20000, .5, 0, 400, 20000, .5, 9] })); }); await saved();
    await showY(20000); await p.waitForTimeout(400);
    const drift = await board.evaluate(el => { const c = el.querySelector('.nb-ink'), s = el.getBoundingClientRect().width / 595, k = c.width / el.getBoundingClientRect().width, d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let sum = 0, n = 0;
      for (let y = 0; y < c.height; y++) for (let x = Math.round(150 * s * k); x < Math.round(350 * s * k); x++) if (d[(y * c.width + x) * 4 + 3] > 128) { sum += y; n++; }
      return { width: el.getBoundingClientRect().width, off: (sum / n / k + parseFloat(c.style.top)) - 20000 * s }; });
    assert.ok(drift.width % 1 !== 0, `a page width that is not a whole pixel: ${drift.width}`); assert.ok(Math.abs(drift.off) <= 1, `the ink is ${drift.off.toFixed(1)} px from where it was written`);
    await p.evaluate(() => nbSetZoom(1));

    });
    await step('7 new box where seen', async () => {
    // 7. On a long board, a new text box comes where the board is seen, not at its top.
    await freshBoard(40000); await saved(); await showY(30000); await p.waitForTimeout(200);
    await p.locator('[data-ink-tool="read"]').click(); await (await toolShown(p, '[data-action="nb-text"]')).click(); await p.waitForFunction(() => document.activeElement?.matches('.nb-text textarea'));
    const placed = await p.evaluate(() => nb.doc.pages[0].items.at(-1).y); assert.ok(placed > 29000 && placed < 31000, `placed at ${placed}`);
    await p.keyboard.press('Escape');

    });
    await step('9 memo card grows', async () => {
    // 9. 새 메모 만들어 넣기 near the bottom grows the board (in the same step).
    await freshBoard(842); await p.evaluate(() => { for (let y = 80; y < 620; y += 60) nb.doc.pages[0].items.push({ id: nbId(), type: 'text', x: 40, y, w: 400, h: 50, text: String(y) }); nbRender(); nbSave(true); }); await saved(); await showY(400);
    await p.evaluate(() => nbMemoCreate()); await p.waitForFunction(() => nb.doc.pages[0].items.some(i => i.type === 'memo'));
    assert.equal(await p.evaluate(() => nb.doc.pages[0].height), 1684, 'the card near the bottom grew the board');

    });
    await step('window height', async () => {
    // A taller window: the ink in the newly seen part is drawn.
    await freshBoard(8420, 200); await saved(); await p.setViewportSize({ width: 1400, height: 420 }); await showY(4000); await p.waitForTimeout(400);
    await p.setViewportSize({ width: 1400, height: 1300 }); await p.waitForTimeout(500);
    const covered = await board.evaluate(el => { const c = el.querySelector('.nb-ink'), list = el.closest('.nb-pages'), r = el.getBoundingClientRect(), v = list.getBoundingClientRect(), top = parseFloat(c.style.top), h = parseFloat(c.style.height); return top <= Math.max(0, v.top - r.top) && top + h >= Math.min(el.clientHeight, v.bottom - r.top); });
    assert.ok(covered, 'the band covers the taller view');
    await p.setViewportSize({ width: 1400, height: 950 });

    });
    await step('longest keeps strokes', async () => {
    // At the longest board, a stroke moved below its end comes back up to it (it would otherwise be kept but never seen).
    await freshBoard(84200); await saved();
    const low = await p.evaluate(() => { nbChange('이동', () => nb.doc.pages[0].strokes.push({ id: nbId(), tool: 'pen', color: '#000000', width: 2, points: [50, 84500, .5, 0, 90, 84600, .5, 5] })); return nbStrokeBox(nb.doc.pages[0].strokes.at(-1)).y1; });
    assert.ok(low <= 84200, `the stroke ends at ${low}`);
    });
    await step('laser', async () => {
    // The laser on the longest board keeps a canvas pixel to a screen pixel.
    await freshBoard(84200); await saved(); await showY(60000); await p.waitForTimeout(300);
    await p.evaluate(() => globalThis.appInk.setTool?.('laser')); ({ r, s } = await toPoints());
    const vy = await p.evaluate(() => { const l = document.querySelector('.nb-pages').getBoundingClientRect(); return l.top + l.height / 2; });
    await p.mouse.move(r.x + 200, vy); await p.mouse.down(); await p.mouse.move(r.x + 300, vy + 20, { steps: 4 });
    const sharp = await p.evaluate(() => { const c = document.querySelector('.app-ink-laser'); return c ? c.width / c.getBoundingClientRect().width : 0; });
    await p.mouse.up(); assert.ok(sharp >= .99, `laser canvas pixels per screen pixel: ${sharp}`);

    });
    await app.close(); app = null;
    if (failed.length) throw Error(`failed: ${failed.join(', ')}`);
    console.log('Whiteboard edge smoke passed: growth keeps a stroke begun after it and typing in a box placed or resized near the bottom; a tall pasted picture saves; a full page says so; a dragged pin lands; ink is where it was written at a fractional width; trim keeps a pin; a new box comes where the board is seen; a new memo card grows it; a taller window draws its ink; the laser stays sharp.');
  } catch (error) { console.error(error); process.exitCode = 1; }
  finally { await app?.close().catch(() => {}); await fs.rm(temp, { recursive: true, force: true }); }
})();
