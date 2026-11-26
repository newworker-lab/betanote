// End-to-end check of whiteboard pages in a notebook (desktop/notebook.js, notebook.cjs): a whiteboard is added from
// 페이지 추가; writing near its bottom makes it longer, a sheet at a time, and it stays so after a restart; 빈 아래쪽
// 잘라내기 takes the empty bottom off; it moves among normal pages; its PDF has a page per sheet of the A4 proportion;
// a long board (40,000 points) scrolls and takes a stroke quickly, drawing a band of it, not one canvas its height; the
// English screen at 800px holds the new choice. APP_TEST_SOURCE=1 runs the source.
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
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), `${appName.id}-board-e2e-`)), vault = path.join(temp, 'vault'); await fs.mkdir(vault);
  const doc = await PDFDocument.create(), font = await doc.embedFont(StandardFonts.Helvetica); doc.addPage([600, 800]).drawText('A paper.', { x: 40, y: 700, size: 14, font });
  await fs.writeFile(path.join(temp, 'paper.pdf'), await doc.save());
  const env = /utf-?8/i.test(process.env.LC_ALL || process.env.LANG || '') ? process.env : { ...process.env, LC_ALL: 'C.UTF-8', LANG: 'C.UTF-8' };
  let app;
  const launch = async (lang = 'ko') => {
    app = await electron.launch({ env: { ...env, APP_UI_LANG: lang }, executablePath: require('./app-executable.cjs')(root), args: [...(process.env.APP_TEST_SOURCE === '1' ? [root] : []), '--no-sandbox', '--ozone-platform=headless', '--disable-gpu', `--user-data-dir=${path.join(temp, 'profile')}`], timeout: 20000 });
    const p = await app.firstWindow(); p.setDefaultTimeout(15000); await p.setViewportSize({ width: 1400, height: 950 });
    p.on('pageerror', e => { console.error(e); process.exitCode = 1; });
    await app.evaluate(({ dialog }) => { globalThis.openQueue = []; globalThis.saveQueue = []; dialog.showOpenDialog = async () => ({ canceled: false, filePaths: globalThis.openQueue.shift() }); dialog.showSaveDialog = async () => ({ canceled: false, filePath: globalThis.saveQueue.shift() }); });
    return p;
  };
  const board = p => p.locator('.nb-page[data-board]').first();
  const boardHeight = p => board(p).evaluate(el => Number(el.dataset.h));
  const saved = async () => { const dir = path.join(vault, appName.vaultDir, 'notebooks'); const name = (await fs.readdir(dir)).find(n => n.endsWith('.json')); return JSON.parse(await fs.readFile(path.join(dir, name), 'utf8')); };
  const settle = p => p.waitForFunction(() => document.querySelector('.nb-status')?.dataset.state === 'saved' || document.querySelector('.nb-status')?.textContent.includes('saved'));
  // The board's ⋯ menu, its top in view first.
  const boardMenu = async p => { await board(p).evaluate(el => el.closest('.nb-page-wrap').scrollIntoView({ block: 'start' })); await board(p).evaluate(el => el.closest('.nb-page-wrap').querySelector('[data-nb-page-menu]').click()); await p.locator('.nb-page-menu').waitFor(); };
  // A pen stroke at page points (x, y) to (x + 60, y + 10) on the whiteboard, scrolled into view first.
  const pen = async (p, x, y) => {
    await p.evaluate(([y]) => { const el = document.querySelector('.nb-page[data-board]'), list = el.closest('.nb-pages'), s = el.clientWidth / Number(el.dataset.w); list.scrollTop += el.getBoundingClientRect().top - list.getBoundingClientRect().top + y * s - list.clientHeight / 2; }, [y]);
    await p.waitForTimeout(100);
    const r = await board(p).boundingBox(), s = r.width / Number(await board(p).getAttribute('data-w'));
    await p.mouse.move(r.x + x * s, r.y + y * s); await p.mouse.down(); await p.mouse.move(r.x + (x + 60) * s, r.y + (y + 10) * s, { steps: 6 }); await p.mouse.up();
  };
  try {
    let p = await launch();
    await app.evaluate((_, v) => globalThis.openQueue.push([v]), vault); await p.locator('[data-action="storage"]').first().click();
    await app.evaluate((_, f) => globalThis.openQueue.push([f]), path.join(temp, 'paper.pdf')); await p.locator('[data-action="add-files"]').first().click();
    await p.locator('.paper-item').click(); await p.locator('.original-pages .page[data-page="1"] canvas').first().waitFor();
    await p.locator('[data-mode="notebook"]').click(); await p.locator('.notebook-pane [data-action="nb-new"]').first().click();
    await p.locator('#nb-title').fill('보드 노트'); await p.locator('#dialog [data-action="nb-create"]').click(); await p.locator('.nb-page').first().waitFor();

    // 1. A whiteboard from 페이지 추가: the width of the chosen size, a sheet long.
    await (await toolShown(p, '[data-nb-add]')).click(); await p.locator('.nb-add-menu [name="nb-new-board"]').check(); await p.locator('.nb-add-menu [data-action="nb-add-page"]').click();
    await board(p).waitFor(); assert.equal(await boardHeight(p), 842); assert.equal(await board(p).getAttribute('data-w'), '595');
    // 2. Writing near its bottom makes it a sheet longer; writing near the new bottom, another.
    await p.locator('[data-ink-tool="pen"]').click();
    await pen(p, 100, 760); await p.waitForFunction(() => Number(document.querySelector('.nb-page[data-board]').dataset.h) === 1684);
    await pen(p, 100, 1600); await p.waitForFunction(() => Number(document.querySelector('.nb-page[data-board]').dataset.h) === 2526);
    // Writing high up does not.
    await pen(p, 100, 300); await p.waitForTimeout(300); assert.equal(await boardHeight(p), 2526);
    // A text box moved near the bottom grows it too (as any item).
    await p.evaluate(() => { const page = nb.doc.pages.find(x => x.board); nbChange('이동', () => page.items.push({ id: nbId(), type: 'text', x: 60, y: 2450, w: 200, h: 40, text: '아래 상자' })); nbRender(); });
    await p.waitForFunction(() => Number(document.querySelector('.nb-page[data-board]').dataset.h) === 3368);
    // One undo takes the box and the growth back.
    await p.keyboard.press('ControlOrMeta+z'); await p.waitForFunction(() => Number(document.querySelector('.nb-page[data-board]').dataset.h) === 2526);
    await p.keyboard.press('ControlOrMeta+y'); await p.waitForFunction(() => Number(document.querySelector('.nb-page[data-board]').dataset.h) === 3368);
    await settle(p);
    let stored = (await saved()).pages.find(x => x.board); assert.equal(stored.height, 3368); assert.equal(stored.strokes.length, 3);

    // 3. Kept across a restart.
    await app.close(); p = await launch();
    await p.locator('.shell').waitFor(); if (await p.evaluate(() => state.screen !== 'reader')) { await p.locator('.paper-item').click(); }
    await p.locator('[data-mode="notebook"]').click(); await board(p).waitFor(); assert.equal(await boardHeight(p), 3368);

    // A memo's pin on the board, 1,000 points down: it stays there when the board's length changes (below).
    const pinAt = () => board(p).evaluate(el => { const pin = el.querySelector('.nb-pin'), s = el.clientWidth / Number(el.dataset.w); return Math.round((pin.offsetTop + 10) / s); });
    await p.evaluate(() => { const key = `${state.selected}-메모`, page = nb.doc.pages.find(x => x.board); notes[key] ||= '핀 메모'; notes[key + '#pin'] = JSON.stringify({ notebookId: nb.doc.id, pageId: page.id, x: 0.5, y: nbPinStored(page, 1000 / page.height) }); nbRefreshPins(); });
    assert.ok(Math.abs(await pinAt() - 1000) <= 1, `the pin at 1,000 points: ${await pinAt()}`);
    // 4. 빈 아래쪽 잘라내기: the board ends 200 points under its lowest item (the box at 2450–2490).
    await boardMenu(p);
    await p.locator('.nb-page-menu [data-nb-page="trim"]').click(); await p.waitForFunction(() => Number(document.querySelector('.nb-page[data-board]').dataset.h) === 2690);
    assert.ok(Math.abs(await pinAt() - 1000) <= 1, `the pin stays at 1,000 points after the trim: ${await pinAt()}`);
    // Nothing to trim the second time.
    await boardMenu(p); await p.locator('.nb-page-menu [data-nb-page="trim"]').click();
    await p.locator('#toast').filter({ hasText: '잘라낼 빈 아래쪽이 없습니다' }).waitFor();

    // 5. Among normal pages: a normal page after it, then the board moved below it.
    await (await toolShown(p, '[data-nb-add]')).click(); await p.locator('.nb-add-menu [name="nb-new-board"]').uncheck(); await p.locator('.nb-add-menu [data-action="nb-add-page"]').click();
    await p.waitForFunction(() => document.querySelectorAll('.nb-page').length === 3);
    await boardMenu(p); await p.locator('.nb-page-menu [data-nb-page="down"]').click();
    await p.waitForFunction(() => [...document.querySelectorAll('.nb-page')].map(el => el.dataset.board ? 'B' : 'P').join('') === 'PPB');
    await settle(p);
    assert.deepEqual((await saved()).pages.map(x => x.board ? 'B' : 'P'), ['P', 'P', 'B']);
    // The + under the last page, after a whiteboard: a new whiteboard of its width, a sheet long (one Ctrl+Z takes it back).
    await p.locator('.nb-pages').evaluate(n => { n.scrollTop = n.scrollHeight; }); const plus = p.locator('.nb-add-same'); await plus.waitFor();
    assert.equal(await plus.getAttribute('aria-label'), '같은 폭의 새 화이트보드 추가');
    await plus.click(); await p.waitForFunction(() => nb.doc.pages.length === 4);
    assert.deepEqual(await p.evaluate(() => { const pg = nb.doc.pages.at(-1); return [pg.board, pg.width, pg.height, pg.items.length + pg.strokes.length]; }), [true, 595, 842, 0]);
    await p.keyboard.press('ControlOrMeta+z'); await p.waitForFunction(() => nb.doc.pages.length === 3);
    // At the 500 pages a notebook holds, the + is off and says why.
    assert.match(await p.evaluate(() => { const pages = nb.doc.pages; nb.doc.pages = Array.from({ length: 500 }, () => pages[0]); const html = nbAddSameHtml(); nb.doc.pages = pages; return html; }), /disabled title="노트북에는 500쪽까지 넣을 수 있습니다\."/);
    await settle(p);

    // 6. The PDF: the two pages, then the board on A4 sheets (595×842) as far as its last item (2490 points: 3 sheets).
    const pdfFile = path.join(temp, 'board.pdf');
    await app.evaluate((_, f) => globalThis.saveQueue.push(f), pdfFile); await (await toolShown(p, '[data-nb-save-menu]')).click(); await p.locator('.pop-menu [data-action="nb-export"]').click();
    let bytes = null; for (let i = 0; i < 200 && !bytes; i++) { try { const b = await fs.readFile(pdfFile); if (b.length) bytes = b; } catch {} if (!bytes) await new Promise(r => setTimeout(r, 100)); }
    const out = await PDFDocument.load(bytes); assert.equal(out.getPageCount(), 2 + 3);
    for (const page of out.getPages()) { const { width, height } = page.getSize(); assert.ok(Math.abs(width - 595) < 1 && Math.abs(height - 842) < 1, `${width}×${height}`); }

    // 7. A long board: 40,000 points with writing all down it. It scrolls to its end and takes a stroke there quickly,
    // and draws a band of itself (a canvas the height of a few views, not of the board).
    await p.evaluate(() => { const page = nb.doc.pages.find(x => x.board); nbChange('필기', () => { page.height = 40000; for (let y = 100; y < 39800; y += 50) page.strokes.push({ id: nbId(), tool: 'pen', color: '#1d4ed8', width: 2, points: [80, y, .5, 0, 300, y + 20, .5, 8] }); }); nbRender(); });
    await p.waitForFunction(() => Number(document.querySelector('.nb-page[data-board]').dataset.h) === 40000);
    const timing = await p.evaluate(async () => {
      const el = document.querySelector('.nb-page[data-board]'), list = el.closest('.nb-pages'), frames = [];
      let last = performance.now();
      for (let i = 0; i < 40; i++) { list.scrollTop += list.clientHeight * 0.9; await new Promise(r => requestAnimationFrame(r)); const now = performance.now(); frames.push(now - last); last = now; }
      const canvas = el.querySelector('.nb-ink');
      return { worst: Math.max(...frames.slice(1)), canvasHeight: canvas.height, boardHeight: el.clientHeight };
    });
    assert.ok(timing.canvasHeight < timing.boardHeight / 4, `the ink is drawn on a band: ${timing.canvasHeight} of ${timing.boardHeight}`);
    assert.ok(timing.worst < 250, `scrolling the long board: worst frame ${Math.round(timing.worst)} ms`);
    await p.locator('[data-ink-tool="pen"]').click();
    const t0 = Date.now(); await pen(p, 350, 39500); await p.waitForFunction(() => nb.doc.pages.find(x => x.board).strokes.some(s => s.points[0] > 340 && s.points[1] > 39400)); const strokeMs = Date.now() - t0;
    assert.ok(strokeMs < 3000, `a stroke at the end of the long board: ${strokeMs} ms`);
    console.log(`long board: band ${timing.canvasHeight} of ${timing.boardHeight} px, worst scroll frame ${Math.round(timing.worst)} ms, stroke ${strokeMs} ms`);
    // The stroke shows on the band where it was written.
    const inked = await board(p).evaluate(el => { const c = el.querySelector('.nb-ink'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let k = 0; for (let i = 3; i < d.length; i += 4) if (d[i]) k++; return k; });
    assert.ok(inked > 0, 'the band shows the writing around the view');
    await settle(p);
    await app.close(); app = null;

    // 8. English at 800px: the new page choice fits in its menu.
    p = await launch('en'); await p.setViewportSize({ width: 800, height: 600 });
    await p.locator('.shell').waitFor(); if (await p.evaluate(() => state.screen !== 'reader')) await p.locator('.paper-item').click();
    await p.locator('[data-mode="notebook"]').click(); await board(p).waitFor();
    await (await toolShown(p, '[data-nb-add]')).click(); const choice = p.locator('.nb-add-menu .nb-new-board'); await choice.waitFor();
    assert.match(await choice.textContent(), /Whiteboard/);
    const fits = await p.evaluate(() => { const menu = document.querySelector('.nb-add-menu').getBoundingClientRect(), label = document.querySelector('.nb-add-menu .nb-new-board').getBoundingClientRect(); return label.right <= menu.right + 1 && menu.right <= innerWidth && menu.left >= 0 && label.bottom <= menu.bottom + 1; });
    assert.ok(fits, 'the whiteboard choice fits its menu at 800px');
    await p.keyboard.press('Escape'); await p.locator('.nb-pages').evaluate(n => { n.scrollTop = n.scrollHeight; });
    assert.equal(await p.locator('.nb-add-same').getAttribute('aria-label'), 'Add a new whiteboard of this width');
    assert.ok(await p.locator('.nb-add-same').evaluate(b => { const r = b.getBoundingClientRect(), l = b.closest('.nb-pages').getBoundingClientRect(); return r.left >= l.left && r.right <= l.right; }), 'the + sits in the list at 800px');
    await app.close(); app = null;
    console.log('Notebook whiteboard smoke passed: added from 페이지 추가, grown a sheet at a time by writing near its bottom (one undo with it), kept across a restart, trimmed, moved among pages, printed on A4 sheets, a 40,000-point board scrolls and takes a stroke on a band, the English menu fits at 800px.');
  } catch (error) { console.error(error); process.exitCode = 1; }
  finally { await app?.close().catch(() => {}); await fs.rm(temp, { recursive: true, force: true }); }
})();
