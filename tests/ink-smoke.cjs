// End-to-end handwriting check on the real Electron app (APP_TEST_SOURCE=1
// runs from source): write on the original and on a saved translation, quit,
// reopen offline-style with no model calls, and export with and without ink.
// Mouse pointer events stand in for a pen here; they do not measure pen feel,
// latency or palm rejection on a real device.
const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { PDFDocument, StandardFonts, PDFName } = require('pdf-lib');
const appName = require('../core/app-name.cjs');
const toolShown = require('./tool-row.cjs'); // a tool a narrow pane keeps under ⋯ is brought out before it is used
const root = path.resolve(__dirname, '..');
async function samplePdf(file) {
  const doc = await PDFDocument.create(), font = await doc.embedFont(StandardFonts.Helvetica);
  for (const angle of [0, 90]) {
    const page = doc.addPage([600, 800]);
    page.drawText('A research paper connects ideas.', { x: 40, y: 740, size: 12, font });
    page.drawText('Methods describe the experiment.', { x: 40, y: 600, size: 12, font });
    page.setRotation({ type: 'degrees', angle });
  }
  await fs.writeFile(file, await doc.save());
}
(async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), `${appName.id}-ink-e2e-`)), vault = path.join(temp, '연구 자료'), source = path.join(temp, 'ink-paper.pdf');
  await fs.mkdir(vault); await samplePdf(source);
  const executable = require('./app-executable.cjs')(root), sourceMode = process.env.APP_TEST_SOURCE === '1';
// Memos are folded until chosen: the first one is opened when a step needs the memo field.
const openNote = async p => { await p.locator('#note, .memo-card[data-memo], .memo-tab [data-action="memo-new"]').first().waitFor(); if (!await p.locator('#note').count()) await (await p.locator('.memo-card[data-memo]').count() ? p.locator('.memo-card[data-memo]').first() : p.locator('.memo-tab [data-action="memo-new"]')).click(); await p.locator('#note').waitFor({ state: 'attached' }); return p.locator('#note'); };
  const env = /utf-?8/i.test(process.env.LC_ALL || process.env.LC_CTYPE || process.env.LANG || '') ? process.env : { ...process.env, LC_ALL: 'C.UTF-8', LANG: 'C.UTF-8' };
  let app;
  async function launch({ usable = true } = {}) {
    app = await electron.launch({ env, executablePath: executable, args: [...(sourceMode ? [root] : []), '--no-sandbox', '--ozone-platform=headless', '--disable-gpu', `--user-data-dir=${path.join(temp, 'profile')}`], timeout: 20000 });
    const p = await app.firstWindow(); p.setDefaultTimeout(15000);
    p.on('pageerror', e => { console.error(e); process.exitCode = 1; }); p.on('console', m => { if (m.type() === 'error') console.error('renderer:', m.text()); });
    await app.evaluate(({ app, dialog }, usable) => {
      globalThis.openQueue = []; globalThis.saveQueue = [];
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: globalThis.openQueue.shift() });
      dialog.showSaveDialog = async (_window, options) => { (globalThis.saveNames ||= []).push(options?.defaultPath); return { canceled: false, filePath: globalThis.saveQueue.shift() }; };
      const { ChatGPT } = process.getBuiltinModule('module').createRequire(app.getAppPath() + '/package.json')('./desktop/chatgpt.cjs');
      globalThis.inferenceCalls = 0;
      ChatGPT.prototype.status = function () { return { connected: usable, usable, email: 'fixture@example.test', persistent: false }; };
      ChatGPT.prototype.models = async () => { globalThis.inferenceCalls++; return [{ id: 'fixture-model', name: 'Fixture GPT nano' }]; };
      ChatGPT.prototype.translate = async (_model, blocks) => { globalThis.inferenceCalls++; return blocks.map(b => ({ id: b.id, text: (globalThis.translationText || '연구 논문은 아이디어를 연결합니다.') })); };
      ChatGPT.prototype.explainFigure = async () => { globalThis.inferenceCalls++; return ''; };
    }, usable);
    return p;
  }
  const calls = () => app.evaluate(() => globalThis.inferenceCalls);
  const save = file => app.evaluate((_, file) => globalThis.saveQueue.push(file), file);
  async function waitFile(file) { for (let i = 0; i < 200; i++) { try { if ((await fs.stat(file)).size) return fs.readFile(file); } catch {} await new Promise(r => setTimeout(r, 100)); } throw Error('not saved: ' + file); }
  async function draw(p, sheet, from, to) {
    await sheet.scrollIntoViewIfNeeded(); const box = await sheet.boundingBox();
    await p.mouse.move(box.x + box.width * from[0], box.y + box.height * from[1]); await p.mouse.down();
    for (let i = 1; i <= 12; i++) await p.mouse.move(box.x + box.width * (from[0] + (to[0] - from[0]) * i / 12), box.y + box.height * (from[1] + (to[1] - from[1]) * i / 12));
    await p.mouse.up();
  }
  const saved = p => p.locator('.ink-status[data-state="saved"][data-touched]').waitFor({ state: 'attached' });
  // Painted ink pixels on one page's ink canvas.
  const inked = (p, selector) => p.evaluate(selector => { const canvas = document.querySelector(selector); if (!canvas) return 0; const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data; let n = 0; for (let i = 3; i < data.length; i += 4) if (data[i]) n++; return n; }, selector);
  const originalPage = n => `.original-pages .page[data-page="${n}"]`, translatedPage = n => `.translated-pane .translated-pages .page[data-page="${n}"]`;
  try {
    let p = await launch();
    await app.evaluate((_, vault) => globalThis.openQueue.push([vault]), vault); await p.locator('[data-action="storage"]').first().click(); await p.locator('.library').waitFor();
    await app.evaluate((_, file) => globalThis.openQueue.push([file]), source); await p.locator('[data-action="add-files"]').first().click(); await p.locator('.paper-item').click();
    await p.locator(originalPage(1) + ' canvas').first().waitFor(); await p.locator('.ink-toolbar').waitFor();

    // 그림 영역 상자·주석 밑줄: off at first; on, a dashed box where a figure explanation lies and a dashed line under
    // each line of an annotated sentence, 1.5pt growing with the zoom; kept on this computer. The first line is given as two
    // overlapping boxes (as a selection can give it): they are joined, one underline under the whole line.
    await p.evaluate(async () => {
      const id = state.storageKey, paperId = state.selected, attachmentId = state.selectedAttachment, sourceHash = await window.appApi.originalHash(id, paperId, attachmentId);
      await window.appApi.addAnnotation(id, paperId, attachmentId, { page: 1, body: 'The axes', sourceHash, kind: 'figure', figure: { x: .1, y: .1, width: .3, height: .2 } });
      applyAnnotations(await window.appApi.addAnnotation(id, paperId, attachmentId, { page: 1, quote: 'two lines', body: 'A note', sourceHash, rects: [[72, 700, 200, 712], [190, 700.5, 300, 711.5], [72, 686, 250, 698]] }), '주석');
      inkRefreshAnnotationMarks();
    });
    // The toggles are in the 주석 tab, beside 모아 보기 (not on the reader's toolbar).
    const annotationTab = async () => { await p.locator('.reader-panel [data-tab="주석"]').click(); await p.locator('.annot-tab .annot-tools [data-action="toggle-figure-boxes"]').waitFor(); };
    const toggles = () => p.evaluate(() => ['toggle-figure-boxes', 'toggle-annotation-underlines'].map(a => document.querySelector(`[data-action="${a}"]`)?.getAttribute('aria-pressed')));
    const marks = () => p.evaluate(selector => {
      const page = document.querySelector(selector), container = page.closest('.original-pages'), view = container.pdfViewer.getPageView(0), vp = view.viewport, scale = Math.hypot(vp.transform[0], vp.transform[1]);
      const boxes = [...page.querySelectorAll('.annotation-marks .figure-box')].map(b => { const cs = getComputedStyle(b); return { left: b.offsetLeft, top: b.offsetTop, width: b.offsetWidth, height: b.offsetHeight, style: cs.borderTopStyle, line: parseFloat(cs.borderTopWidth) }; });
      const lines = [...page.querySelectorAll('.annotation-marks .annotation-underline')].map(u => { const cs = getComputedStyle(u); return { left: u.offsetLeft, right: u.offsetLeft + u.offsetWidth, bottom: u.offsetTop + u.offsetHeight, style: cs.borderBottomStyle, line: parseFloat(cs.borderBottomWidth) }; });
      const bottoms = [[72, 700, 300, 712], [72, 686, 250, 698]].map(r => Math.max(vp.convertToViewportPoint(r[0], r[1])[1], vp.convertToViewportPoint(r[2], r[3])[1]));
      const spans = [[72, 700, 300, 712], [72, 686, 250, 698]].map(r => [vp.convertToViewportPoint(r[0], r[1])[0], vp.convertToViewportPoint(r[2], r[3])[0]]);
      return { boxes, lines, bottoms, spans, scale, w: vp.width, h: vp.height };
    }, originalPage(1));
    assert.equal(await p.locator('.reader-annotate [data-action^="toggle-"]').count(), 0, 'no longer on the toolbar'); await annotationTab();
    assert.deepEqual(await toggles(), ['false', 'false']); assert.deepEqual([(await marks()).boxes.length, (await marks()).lines.length], [0, 0]);
    await p.locator('[data-action="toggle-figure-boxes"]').click(); await p.locator(originalPage(1) + ' .figure-box').waitFor();
    let m = await marks(); assert.equal(m.boxes.length, 1); const [b] = m.boxes;
    for (const [got, want] of [[b.left, .1 * m.w], [b.top, .1 * m.h], [b.width, .3 * m.w], [b.height, .2 * m.h]]) assert.ok(Math.abs(got - want) <= 1, JSON.stringify({ b, m }));
    assert.equal(b.style, 'dashed'); assert.ok(Math.abs(b.line - 1.5 * m.scale) <= .5, JSON.stringify(b)); assert.equal(m.lines.length, 0);
    await p.locator('[data-action="toggle-annotation-underlines"]').click(); await p.locator(originalPage(1) + ' .annotation-underline').first().waitFor();
    m = await marks(); assert.equal(m.lines.length, 2, 'one line under each line of the sentence');
    m.lines.forEach((l, i) => { assert.equal(l.style, 'dashed'); assert.ok(Math.abs(l.bottom - m.bottoms[i]) <= 1 && Math.abs(l.left - m.spans[i][0]) <= 1 && Math.abs(l.right - m.spans[i][1]) <= 1, JSON.stringify(m)); assert.ok(Math.abs(l.line - 1.5 * m.scale) <= .5); });
    assert.deepEqual(await toggles(), ['true', 'true']);
    // Zoomed in, the lines grow with the page and are drawn once.
    const scaleBefore = m.scale; await (await toolShown(p, '.original-pane [data-reader-zoom=".1"]')).click();
    await p.waitForFunction(([selector, s]) => { const v = document.querySelector(selector).closest('.original-pages').pdfViewer.getPageView(0).viewport; return Math.hypot(v.transform[0], v.transform[1]) > s + .01 && document.querySelector(selector + ' .figure-box'); }, [originalPage(1), scaleBefore]);
    m = await marks(); assert.deepEqual([m.boxes.length, m.lines.length], [1, 2]); assert.ok(m.scale > scaleBefore && Math.abs(m.boxes[0].line - 1.5 * m.scale) <= .5, JSON.stringify(m));
    await (await toolShown(p, '.original-pane [data-reader-zoom="-.1"]')).click();
    // Saved with "필기 포함" while shown and before any ink: the original gets the box and the underlines alone, named -필기;
    // without "필기 포함" it stays the source byte for byte.
    const marksOut = name => path.join(temp, name), lastName = () => app.evaluate(() => globalThis.saveNames.at(-1));
    for (const [name, include] of [['marks-only.pdf', true], ['marks-plain.pdf', false]]) {
      await save(marksOut(name)); await p.locator('[data-action="ink-export-original"]').click(); await p.locator('#dialog #ink-export-include').waitFor();
      if (await p.locator('#dialog #ink-export-include').isChecked() !== include) await p.locator('#dialog #ink-export-include').click();
      await p.locator('#dialog [data-action="ink-export-confirm"]').click(); await waitFile(marksOut(name));
      assert.equal(/-필기\.pdf$/.test(await lastName()), include, await lastName());
      // The message tells what went in: the box and the two underlines, or nothing beside the original.
      await p.locator('#toast').filter({ hasText: include ? '원문 PDF를 저장했습니다. 그림 상자·주석 밑줄 3개를 포함했습니다.' : /^원문 PDF를 저장했습니다\.$/ }).waitFor();
    }
    assert.deepEqual(await fs.readFile(marksOut('marks-plain.pdf')), await fs.readFile(source), 'without 필기 포함, the source byte for byte');
    const subtypesOf = async file => (await PDFDocument.load(await fs.readFile(file))).getPages().map(page => (page.node.lookup(PDFName.of('Annots'))?.asArray() || []).map(ref => page.doc.context.lookup(ref).get(PDFName.of('Subtype')).toString()));
    assert.deepEqual((await subtypesOf(marksOut('marks-only.pdf')))[0], ['/Square', '/Line', '/Line']);
    await p.waitForFunction(([selector, s]) => { const v = document.querySelector(selector).closest('.original-pages').pdfViewer.getPageView(0).viewport; return Math.abs(Math.hypot(v.transform[0], v.transform[1]) - s) < .01 && document.querySelector(selector + ' .app-ink-layer'); }, [originalPage(1), scaleBefore]);

    // Reading mode leaves text selection to PDF.js; the pen writes.
    assert.equal(await p.evaluate(() => getComputedStyle(document.querySelector('.app-ink-layer') || document.body).pointerEvents === 'auto'), false);
    await p.locator('[data-ink-tool="pen"]').click();
    await draw(p, p.locator(originalPage(1)), [.2, .3], [.6, .35]); await saved(p);
    await p.locator('[data-ink-tool="highlighter"]').click();
    await draw(p, p.locator(originalPage(1)), [.1, .5], [.7, .5]); await saved(p);
    await p.locator('[data-ink-tool="pen"]').click();
    await draw(p, p.locator(originalPage(2)), [.3, .3], [.5, .6]); await saved(p);
    assert.ok(await inked(p, originalPage(1) + ' .app-ink-layer') > 50 && await inked(p, originalPage(2) + ' .app-ink-layer') > 20);
    // Undo/redo and the stroke eraser are user actions that persist.
    await p.locator('[data-ink-undo]').click(); await saved(p); assert.equal(await inked(p, originalPage(2) + ' .app-ink-layer'), 0);
    await p.locator('[data-ink-redo]').click(); await saved(p); assert.ok(await inked(p, originalPage(2) + ' .app-ink-layer') > 20);
    await p.locator('[data-ink-tool="pen"]').click(); await draw(p, p.locator(originalPage(2)), [.6, .7], [.8, .8]); await saved(p);
    await p.locator('[data-ink-tool="eraser"]').click(); await draw(p, p.locator(originalPage(2)), [.6, .7], [.8, .8]); await saved(p);
    await p.keyboard.press('ControlOrMeta+z'); await saved(p); await p.keyboard.press('ControlOrMeta+Shift+z'); await saved(p);
    const attachment = (await fs.readdir(path.join(vault, appName.vaultDir, 'ink')))[0];
    assert.match(await fs.readFile(path.join(vault, appName.vaultDir, 'ink', attachment, 'original.log'), 'utf8'), /"type":"add"/);
    assert.doesNotMatch(await fs.readFile(path.join(vault, appName.vaultDir, 'library.json'), 'utf8'), /"points"/);

    // Translate once (the only model use in this test), then write on it.
    await p.locator('[data-mode="dual"]').click(); await p.locator('#dialog [data-action="gpt-start"]').click(); await p.locator('[data-action="gpt-export"]').waitFor();
    await p.waitForFunction(() => document.querySelector('.translated-pane .translated-pages')?.inkSurface?.startsWith('t-'));
    await p.locator(translatedPage(1) + ' .translation-layer[data-ready="true"]').waitFor();
    await p.locator('[data-ink-tool="pen"]').click(); await draw(p, p.locator(translatedPage(1)), [.25, .2], [.55, .25]); await saved(p);
    assert.ok(await inked(p, translatedPage(1) + ' .app-ink-layer') > 50);
    // A finger moving the page with a writing tool chosen (touch writing off) still scrolls the
    // other pane with it; only writing holds the pane.
    {
      const tops = () => p.evaluate(() => [document.querySelector('.original-pages').scrollTop, document.querySelector('.translated-pane .translated-pages').scrollTop].map(Math.round));
      const cdp = await p.context().newCDPSession(p);
      // A point on the page that shows in the pane (the middle of a pane can fall between pages).
      const center = async selector => p.evaluate(selector => { const pane = document.querySelector(selector).getBoundingClientRect(), sheets = [...document.querySelector(selector).querySelectorAll('.app-ink-layer')].map(c => c.getBoundingClientRect()), r = sheets.find(r => Math.min(r.bottom, pane.bottom) - Math.max(r.top, pane.top) > 80); return [r.left + r.width / 2, Math.max(r.top, pane.top) + 40]; }, selector);
      const touchPan = async (selector, dy) => {
        const [x, y0] = await center(selector), y = dy > 0 ? y0 + 130 : y0, point = v => [{ x, y: y - v, id: 1, radiusX: 25, radiusY: 25, force: .5 }];
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: point(0) });
        for (let i = 1; i <= 15; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: point(dy * i / 15) }); await p.waitForTimeout(16); }
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      };
      for (const tool of ['pen', 'eraser']) {
        await p.locator(`[data-ink-tool="${tool}"]`).click();
        await p.evaluate(() => { document.querySelector('.original-pages').scrollTop = 0; }); await p.waitForFunction(() => document.querySelector('.translated-pane .translated-pages').scrollTop < 3);
        await touchPan('.original-pages', 120);
        await p.waitForFunction(() => { const a = document.querySelector('.original-pages').scrollTop, b = document.querySelector('.translated-pane .translated-pages').scrollTop; return a > 60 && Math.abs(a - b) < 3; }).catch(async () => assert.fail(`${tool}: the translation stays at ${await tops()} while a finger moves the original`));
        await touchPan('.translated-pane .translated-pages', -60);
        await p.waitForFunction(() => { const a = document.querySelector('.original-pages').scrollTop, b = document.querySelector('.translated-pane .translated-pages').scrollTop; return b < 80 && Math.abs(a - b) < 3; }).catch(async () => assert.fail(`${tool}: the original stays at ${await tops()} while a finger moves the translation`));
      }
      // Writing holds only the pane written on, and only until the reader scrolls: a wheel turn
      // right after a stroke moves both panes.
      const aligned = (min, message) => p.waitForFunction(min => { const a = document.querySelector('.original-pages').scrollTop, b = document.querySelector('.translated-pane .translated-pages').scrollTop; return a > min && Math.abs(a - b) < 3; }, min).catch(async () => assert.fail(`${message}: ${await tops()}`));
      for (const [written, scrolled] of [['.original-pages', '.original-pages'], ['.original-pages', '.translated-pane .translated-pages'], ['.translated-pane .translated-pages', '.original-pages']]) {
        await p.locator('[data-ink-tool="pen"]').click();
        await p.evaluate(() => { document.querySelector('.original-pages').scrollTop = 0; }); await p.waitForFunction(() => document.querySelector('.translated-pane .translated-pages').scrollTop < 3);
        const [x, y] = await center(written); await p.mouse.move(x - 30, y); await p.mouse.down(); await p.mouse.move(x + 30, y + 4, { steps: 6 }); await p.mouse.up();
        await p.mouse.move(...await center(scrolled)); await p.mouse.wheel(0, 90);
        await aligned(60, `a wheel turn on ${scrolled} right after writing on ${written} leaves the panes apart`);
        await saved(p); await p.keyboard.press('ControlOrMeta+z'); await saved(p);
      }
      // A stroke whose lift was lost ends when its pointer is seen moving with nothing pressed, so it does not hold its pane.
      {
        await p.evaluate(() => { document.querySelector('.original-pages').scrollTop = 0; }); await p.waitForFunction(() => document.querySelector('.translated-pane .translated-pages').scrollTop < 3);
        const [x, y] = await center('.original-pages');
        await p.evaluate(([x, y]) => { const c = document.elementFromPoint(x, y), init = (dx, buttons) => ({ bubbles: true, cancelable: true, pointerId: 43, pointerType: 'pen', isPrimary: true, button: buttons ? 0 : -1, buttons, pressure: buttons ? .5 : 0, clientX: x + dx, clientY: y }); c.setPointerCapture = () => {}; c.dispatchEvent(new PointerEvent('pointerdown', init(0, 1))); delete c.setPointerCapture; c.dispatchEvent(new PointerEvent('pointermove', init(20, 1))); c.dispatchEvent(new PointerEvent('pointermove', init(40, 0))); }, [x, y]);
        await saved(p); await p.waitForTimeout(1600);
        await p.mouse.move(...await center('.translated-pane .translated-pages')); await p.mouse.wheel(0, 90);
        await aligned(60, 'a stroke whose lift was lost keeps holding the original');
        await p.keyboard.press('ControlOrMeta+z'); await saved(p);
      }
      await cdp.detach(); await p.evaluate(() => { document.querySelector('.original-pages').scrollTop = 0; });
      await p.locator('[data-ink-tool="pen"]').click();
    }
    const surface = await p.evaluate(() => document.querySelector('.translated-pane .translated-pages').inkSurface);
    const cacheFile = (await fs.readdir(path.join(vault, appName.vaultDir))).find(f => /^translation-\d+(-[-a-z0-9]+)?\.json$/.test(f));
    const cacheBytes = await fs.readFile(path.join(vault, appName.vaultDir, cacheFile));
    const translated = await calls(); assert.ok(translated > 0);

    // Export: four files from the same saved state, no model call.
    const out = name => path.join(temp, name);
    for (const [action, include, name] of [['ink-export-original', true, 'original-ink.pdf'], ['ink-export-original', false, 'original-plain.pdf'], ['gpt-export', true, 'translation-ink.pdf'], ['gpt-export', false, 'translation-plain.pdf']]) {
      await save(out(name)); await p.locator(`[data-action="${action}"]`).first().click(); await p.locator('#dialog #ink-export-include').waitFor();
      if (await p.locator('#dialog #ink-export-include').isChecked() !== include) await p.locator('#dialog #ink-export-include').click();
      await p.locator('#dialog [data-action="ink-export-confirm"]').click(); await waitFile(out(name));
    }
    assert.deepEqual(await fs.readFile(out('original-plain.pdf')), await fs.readFile(source), 'without ink the original is the source file byte for byte');
    const inkedPdf = await PDFDocument.load(await fs.readFile(out('original-ink.pdf')));
    const annots = inkedPdf.getPages().map(page => page.node.lookup(PDFName.of('Annots'))?.size() || 0);
    assert.deepEqual(annots, [5, 1], 'one Ink annotation per remaining stroke, on its own page, and the shown box and underlines on the first');
    assert.deepEqual((await subtypesOf(out('original-ink.pdf')))[0].sort(), ['/Ink', '/Ink', '/Line', '/Line', '/Square']);
    const pages = async name => (await PDFDocument.load(await fs.readFile(out(name)))).getPageCount();
    assert.equal(await pages('translation-ink.pdf'), await pages('translation-plain.pdf'));
    const pathOps = await p.evaluate(async files => { const pdfjs = await import('./pdfjs/pdf.mjs'), result = []; for (const bytes of files) { const task = pdfjs.getDocument({ data: new Uint8Array(bytes), isEvalSupported: false }), doc = await task.promise, list = await (await doc.getPage(1)).getOperatorList(); result.push(list.fnArray.filter(fn => fn === pdfjs.OPS.constructPath).length); await task.destroy(); } return result; }, [Array.from(await fs.readFile(out('translation-ink.pdf'))), Array.from(await fs.readFile(out('translation-plain.pdf')))]);
    assert.ok(pathOps[0] > pathOps[1], `ink adds vector paths to the translated page (${pathOps})`);
    assert.equal(await calls(), translated, 'exports call no model');
    assert.deepEqual(await fs.readFile(path.join(vault, appName.vaultDir, cacheFile)), cacheBytes, 'ink and export leave the translation cache untouched');
    // Exporting without ink did not remove it from the app.
    assert.ok(await inked(p, translatedPage(1) + ' .app-ink-layer') > 50);

    // Quit and reopen without a usable model connection: everything comes back.
    await app.close(); p = await launch({ usable: false });
    await (await openNote(p)).waitFor();
    // The boxes and underlines asked for are still on after the restart; switched off, they go.
    await p.locator(originalPage(1) + ' .figure-box').waitFor(); await annotationTab(); assert.deepEqual(await toggles(), ['true', 'true']); assert.equal(await p.locator(originalPage(1) + ' .annotation-underline').count(), 2);
    await p.locator('[data-action="toggle-figure-boxes"]').click(); await p.locator('[data-action="toggle-annotation-underlines"]').click();
    await p.waitForFunction(selector => !document.querySelector(`${selector} .figure-box, ${selector} .annotation-underline`), originalPage(1)); assert.deepEqual(await toggles(), ['false', 'false']);
    await p.locator('[data-mode="dual"]').click();
    await p.locator(translatedPage(1) + ' .translation-layer[data-ready="true"]').waitFor();
    await p.waitForFunction(selector => { const c = document.querySelector(selector); if (!c) return false; const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; for (let i = 3; i < d.length; i += 4) if (d[i]) return true; return false; }, translatedPage(1) + ' .app-ink-layer');
    await p.waitForFunction(selector => !!document.querySelector(selector), originalPage(1) + ' .app-ink-layer');
    assert.ok(await inked(p, originalPage(1) + ' .app-ink-layer') > 50);
    assert.equal(await p.locator('#dialog[open]').count(), 0, 'no translation or sign-in dialog on reopen');
    assert.equal(await p.evaluate(() => document.querySelector('.translated-pane .translated-pages').inkSurface), surface);
    assert.equal(await calls(), 0, 'reopening ink calls no model');
    // The dialog remembers the last choice (without ink); switch it back on.
    await save(out('reopened-ink.pdf')); await p.locator('[data-action="ink-export-original"]').click(); assert.equal(await p.locator('#dialog #ink-export-include').isChecked(), false); await p.locator('#dialog #ink-export-include').check(); await p.locator('#dialog [data-action="ink-export-confirm"]').click();
    assert.deepEqual((await PDFDocument.load(await waitFile(out('reopened-ink.pdf')))).getPages().map(page => page.node.lookup(PDFName.of('Annots'))?.size() || 0), [2, 1]);
    assert.equal(await calls(), 0);

    // Re-translating replaces the cache but keeps the inked translation as a base.
    await app.close(); p = await launch();
    await app.evaluate(() => { globalThis.translationText = '다시 번역한 문장입니다.'; });
    await (await openNote(p)).waitFor(); await p.locator('[data-mode="dual"]').click();
    await (await toolShown(p, '[data-action="gpt-retranslate"]')).click(); await p.locator('#dialog [data-action="gpt-start"]').click(); await p.locator('[data-action="gpt-export"]').waitFor();
    await p.locator(translatedPage(1) + ' .translated-block').filter({ hasText: '다시 번역한' }).first().waitFor();
    await (await toolShown(p, '.ink-base-select')).waitFor();
    assert.equal(await inked(p, translatedPage(1) + ' .app-ink-layer'), 0, 'the new translation starts without ink');
    await (await toolShown(p, '.ink-base-select')).selectOption(surface.slice(2));
    await p.locator(translatedPage(1) + ' .translated-block').filter({ hasText: '연구 논문은' }).first().waitFor();
    await p.waitForFunction(s => document.querySelector('.translated-pane .translated-pages').inkSurface === s, surface);
    await p.waitForFunction(selector => { const c = document.querySelector(selector); if (!c) return false; const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; for (let i = 3; i < d.length; i += 4) if (d[i]) return true; return false; }, translatedPage(1) + ' .app-ink-layer');
    const before = await calls();
    await save(out('base-ink.pdf')); await p.locator('[data-action="gpt-export"]').click(); await p.locator('#dialog #ink-export-include').check(); await p.locator('#dialog [data-action="ink-export-confirm"]').click(); await waitFile(out('base-ink.pdf'));
    assert.equal(await calls(), before, 'exporting the kept base calls no model');
    // Full backup and restore into a new vault keep the ink and both translations.
    const backups = path.join(temp, 'backups'), restored = path.join(temp, 'restored'); await fs.mkdir(backups); await fs.mkdir(restored);
    await p.locator('[data-action="back"]').click(); await p.locator('[data-action="vault-manager"]').click(); await p.locator('[data-vm-tab="backup"]').click();
    await app.evaluate((_, dir) => globalThis.openQueue.push([dir]), backups); await p.locator('[data-action="full-backup"]').click(); await p.locator('#dialog h2').filter({ hasText: '전체 백업 완료' }).waitFor();
    const backupFolder = path.join(backups, (await fs.readdir(backups))[0]);
    await p.locator('#dialog [data-action="close"]').last().click(); await p.locator('[data-action="vault-manager"]').click(); await p.locator('[data-vm-tab="backup"]').click();
    await app.evaluate((_, dirs) => globalThis.openQueue.push(...dirs.map(d => [d])), [backupFolder, restored]); await p.locator('[data-action="full-restore"]').click(); await p.locator('#dialog h2').filter({ hasText: '복원 완료' }).waitFor();
    await p.locator('#dialog [data-action="close"]').last().click();
    assert.equal(await p.evaluate(() => state.name), 'restored');
    await p.locator('.paper-item').click(); await p.locator('[data-mode="dual"]').click();
    await (await toolShown(p, '.ink-base-select')).waitFor(); await (await toolShown(p, '.ink-base-select')).selectOption(surface.slice(2));
    await p.waitForFunction(selector => { const c = document.querySelector(selector); if (!c) return false; const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; for (let i = 3; i < d.length; i += 4) if (d[i]) return true; return false; }, translatedPage(1) + ' .app-ink-layer');
    assert.ok(await inked(p, originalPage(1) + ' .app-ink-layer') > 50);
    assert.equal(await calls(), before, 'restoring calls no model');
    await app.close(); app = null;
    console.log('Ink smoke passed: original and translation ink saved, restored without model calls, exported with and without ink, base kept after re-translation, full backup restored into a new vault.');
  } catch (error) { try { await (await app.firstWindow()).screenshot({ path: path.join(os.tmpdir(), `${appName.id}-ink-failure.png`) }); } catch {} throw error; }
  finally { if (app) await app.close(); await fs.rm(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }).catch(error => console.warn(`임시 폴더를 다 지우지 못했습니다(${error.code}). 테스트 결과와는 무관합니다: ${temp}`)); }
})().catch(error => { console.error(error); process.exit(1); });
