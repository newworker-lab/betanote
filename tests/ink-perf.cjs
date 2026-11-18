// K-02 measurement on this machine with synthetic pointer input (no pen):
//  1. 10,000 strokes on one page: reopen and page draw time.
//  2. Writing while a translation is running: no stroke lost, input→paint
//     latency from the app's own recorder, long main-thread tasks.
// Prints JSON. These are simulated-pointer numbers, not pen-device results.
const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { PDFDocument, StandardFonts } = require('pdf-lib');
const appName = require('../core/app-name.cjs');
const root = path.resolve(__dirname, '..');
(async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), `${appName.id}-perf-`)), vault = path.join(temp, 'vault'); await fs.mkdir(vault);
  const doc = await PDFDocument.create(), font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < 12; i++) doc.addPage([600, 800]).drawText(`Page ${i + 1} research text about layout and reading.`, { x: 40, y: 740, size: 12, font });
  await fs.writeFile(path.join(temp, 'paper.pdf'), await doc.save());
  const executable = require('./app-executable.cjs')(root);
// Memos are folded until chosen: the first one is opened when a step needs the memo field.
const openNote = async p => { await p.locator('#note, .memo-card[data-memo], .memo-tab [data-action="memo-new"]').first().waitFor(); if (!await p.locator('#note').count()) await (await p.locator('.memo-card[data-memo]').count() ? p.locator('.memo-card[data-memo]').first() : p.locator('.memo-tab [data-action="memo-new"]')).click(); await p.locator('#note').waitFor({ state: 'attached' }); return p.locator('#note'); };
  const env = /utf-?8/i.test(process.env.LC_ALL || process.env.LANG || '') ? process.env : { ...process.env, LC_ALL: 'C.UTF-8', LANG: 'C.UTF-8' };
  let app;
  async function launch() {
    app = await electron.launch({ env, executablePath: executable, args: [...(process.env.APP_TEST_SOURCE === '1' ? [root] : []), '--no-sandbox', '--ozone-platform=headless', '--disable-gpu', `--user-data-dir=${path.join(temp, 'profile')}`], timeout: 20000 });
    const p = await app.firstWindow(); p.setDefaultTimeout(30000); await p.setViewportSize({ width: 1300, height: 950 });
    await app.evaluate(({ app, dialog }) => {
      globalThis.openQueue = []; dialog.showOpenDialog = async () => ({ canceled: false, filePaths: globalThis.openQueue.shift() });
      const { ChatGPT } = process.getBuiltinModule('module').createRequire(app.getAppPath() + '/package.json')('./desktop/chatgpt.cjs');
      ChatGPT.prototype.status = () => ({ connected: true, usable: true, email: 'x@example.test', persistent: false });
      ChatGPT.prototype.models = async () => [{ id: 'm', name: 'Slow model' }];
      // Slow streaming translation keeps the job running while the pen writes.
      ChatGPT.prototype.translate = async (_m, blocks) => { await new Promise(r => setTimeout(r, 6000)); return blocks.map(b => ({ id: b.id, text: '번역된 문장입니다.' })); };
    });
    return p;
  }
  const result = { machine: { cpu: os.cpus()[0]?.model, cores: os.cpus().length, memoryGB: Math.round(os.totalmem() / 1e9), platform: `${os.platform()} ${os.release()}` }, input: 'Playwright mouse events (no pen, no palm, headless)' };
  try {
    let p = await launch();
    await app.evaluate((_, v) => globalThis.openQueue.push([v]), vault); await p.locator('[data-action="storage"]').first().click();
    await app.evaluate((_, f) => globalThis.openQueue.push([f]), path.join(temp, 'paper.pdf')); await p.locator('[data-action="add-files"]').first().click();
    await p.locator('.paper-item').click(); await p.locator('.original-pages .page[data-page="1"] canvas').first().waitFor();

    // 1. Load: 10,000 strokes (24 points each) on page 1, written through the store.
    const t0 = Date.now();
    await p.evaluate(async () => {
      const geometry = { view: [0, 0, 600, 800], rotate: 0, userUnit: 1 }, ops = [];
      for (let i = 0; i < 10000; i++) { const x = 20 + (i % 100) * 5.6, y = 40 + Math.floor(i / 100) * 7, points = []; for (let j = 0; j < 24; j++) points.push(x + j * .2, y + Math.sin(j) * 2, .5, j * 8); ops.push({ type: 'add', stroke: { id: 'load-' + String(i).padStart(6, '0'), page: 0, tool: 'pen', color: '#1d4ed8', width: 1, points }, geometry }); }
      for (let i = 0; i < ops.length; i += 200) await window.appApi.inkApply(state.storageKey, state.selected, state.selectedAttachment, 'original', ops.slice(i, i + 200));
    });
    result.load = { strokes: 10000, writeSeconds: (Date.now() - t0) / 1000 };
    await app.close(); p = await launch();
    const t1 = Date.now(); await (await openNote(p)).waitFor();
    await p.waitForFunction(() => document.querySelector('.original-pages')?.inkDoc?.strokes.size === 10000, null, { timeout: 60000 });
    result.load.reopenToLoadedSeconds = (Date.now() - t1) / 1000;
    await p.waitForFunction(() => { const c = document.querySelector('.original-pages'); return c?.pdfViewer?.getPageView(0)?.pdfPage && c.inkDoc?.strokes.size === 10000; }, null, { timeout: 60000 });
    result.load.pageDrawMs = await p.evaluate(() => { const c = document.querySelector('.original-pages'), view = c.pdfViewer.getPageView(0), runs = []; for (let i = 0; i < 5; i++) { const t = performance.now(); inkDrawPage(c, view); runs.push(performance.now() - t); } return runs.sort((a, b) => a - b)[2]; });
    result.load.otherPageDrawMs = await p.evaluate(() => { const c = document.querySelector('.original-pages'), view = c.pdfViewer.getPageView(1), t = performance.now(); inkDrawPage(c, view); return performance.now() - t; });

    // 2. Write 40 strokes on page 2 while a translation runs.
    await p.evaluate(() => { window.longTasks = []; try { new PerformanceObserver(list => window.longTasks.push(...list.getEntries().map(e => e.duration))).observe({ type: 'longtask', buffered: false }); } catch {} });
    await p.locator('[data-mode="dual"]').click(); await p.locator('#dialog [data-action="gpt-start"]').click();
    await p.waitForFunction(() => currentJob?.state === 'running');
    await p.evaluate(() => { document.querySelector('.original-pages').pdfViewer.currentPageNumber = 2; });
    await p.locator('.original-pages .page[data-page="2"] canvas').first().waitFor();
    await p.locator('[data-ink-tool="pen"]').click();
    const before = await p.evaluate(() => document.querySelector('.original-pages').inkDoc.strokes.size), runningAtStart = await p.evaluate(() => currentJob?.state);
    for (let s = 0; s < 40; s++) {
      const box = await p.locator('.original-pages .page[data-page="2"]').boundingBox(), y = box.y + Math.min(box.height * .9, 420) * (.1 + s * .02); await p.mouse.move(box.x + box.width * .1, y); await p.mouse.down();
      for (let i = 1; i <= 30; i++) await p.mouse.move(box.x + box.width * (.1 + i * .02), y + Math.sin(i / 3) * 4);
      await p.mouse.up();
    }
    const running = await p.evaluate(() => currentJob?.state);
    await p.waitForFunction(() => !document.querySelector('.original-pages').inkDoc.pending.length && !document.querySelector('.original-pages').inkDoc.saving, null, { timeout: 30000 });
    const after = await p.evaluate(() => document.querySelector('.original-pages').inkDoc.strokes.size);
    const stats = await p.evaluate(() => globalThis.appInk.latency());
    const longTasks = await p.evaluate(() => window.longTasks);
    result.writing = { strokes: 40, keptOnScreen: after - before, translationRunningWhenWritingStarted: runningAtStart === 'running', translationRunningWhenWritingEnded: running === 'running', inputToPaintMs: stats && { samples: stats.count, p50: +stats.p50.toFixed(1), p95: +stats.p95.toFixed(1), max: +stats.max.toFixed(1) }, longTasksOver50ms: longTasks.length, longestTaskMs: longTasks.length ? Math.round(Math.max(...longTasks)) : 0 };
    await app.close(); p = await launch();
    await (await openNote(p)).waitFor();
    await p.waitForFunction(() => document.querySelector('.original-pages')?.inkDoc?.strokes.size >= 10040, null, { timeout: 60000 });
    result.writing.savedAfterRestart = await p.evaluate(() => [...document.querySelector('.original-pages').inkDoc.strokes.values()].filter(s => s.page === 1).length);
    assert.equal(result.writing.keptOnScreen, 40); assert.equal(result.writing.savedAfterRestart, 40);
    await app.close(); app = null;
    console.log(JSON.stringify(result, null, 2));
  } finally { if (app) await app.close(); await fs.rm(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }).catch(error => console.warn(`임시 폴더를 다 지우지 못했습니다(${error.code}). 테스트 결과와는 무관합니다: ${temp}`)); }
})().catch(error => { console.error(error); process.exit(1); });
