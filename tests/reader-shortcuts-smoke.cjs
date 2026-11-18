// End-to-end check of the reader's keyboard and wheel conveniences in the real
// app: Ctrl+wheel zooms the pages, Shift (and Ctrl+Shift) + wheel scrolls
// sideways, Ctrl+1–7 picks the writing tools (again: the next way of that
// tool), Shift+1… the colours, Shift while drawing makes ruler lines and
// regular shapes, the page
// memo is called a text box, and a paper translated in the app is marked
// "번역 있음" in the library, also after a restart.
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
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), `${appName.id}-keys-e2e-`)), vault = path.join(temp, 'vault'); await fs.mkdir(vault);
  for (const [name, text] of [['translated.pdf', 'A research paper connects ideas.'], ['untouched.pdf', 'Another study stays in English.']]) {
    const doc = await PDFDocument.create(), font = await doc.embedFont(StandardFonts.Helvetica); doc.addPage([600, 800]).drawText(text, { x: 40, y: 740, size: 14, font });
    await fs.writeFile(path.join(temp, name), await doc.save());
  }
  const executable = require('./app-executable.cjs')(root);
// Memos are folded until chosen: the first one is opened when a step needs the memo field.
const openNote = async p => { await p.locator('#note, .memo-card[data-memo], .memo-tab [data-action="memo-new"]').first().waitFor(); if (!await p.locator('#note').count()) await (await p.locator('.memo-card[data-memo]').count() ? p.locator('.memo-card[data-memo]').first() : p.locator('.memo-tab [data-action="memo-new"]')).click(); await p.locator('#note').waitFor({ state: 'attached' }); return p.locator('#note'); };
  const env = /utf-?8/i.test(process.env.LC_ALL || process.env.LANG || '') ? process.env : { ...process.env, LC_ALL: 'C.UTF-8', LANG: 'C.UTF-8' };
  let app;
  async function launch() {
    app = await electron.launch({ env, executablePath: executable, args: [...(process.env.APP_TEST_SOURCE === '1' ? [root] : []), '--no-sandbox', '--ozone-platform=headless', '--disable-gpu', `--user-data-dir=${path.join(temp, 'profile')}`], timeout: 20000 });
    const p = await app.firstWindow(); p.setDefaultTimeout(15000); await p.setViewportSize({ width: 1300, height: 950 });
    p.on('pageerror', e => { console.error(e); process.exitCode = 1; }); p.on('console', m => { if (m.type() === 'error') console.error('renderer:', m.text()); });
    await app.evaluate(({ app, dialog }) => {
      globalThis.openQueue = []; dialog.showOpenDialog = async () => ({ canceled: false, filePaths: globalThis.openQueue.shift() });
      const { ChatGPT } = process.getBuiltinModule('module').createRequire(app.getAppPath() + '/package.json')('./desktop/chatgpt.cjs');
      ChatGPT.prototype.status = () => ({ connected: true, usable: true, email: 'fixture@example.test', persistent: false });
      ChatGPT.prototype.models = async () => [{ id: 'fixture-model', name: 'Fixture GPT' }];
      ChatGPT.prototype.translate = async (_m, blocks) => blocks.map(b => ({ id: b.id, text: '연구 논문은 생각을 잇습니다.' }));
    });
    return p;
  }
  try {
    let p = await launch();
    await app.evaluate((_, v) => globalThis.openQueue.push([v]), vault); await p.locator('[data-action="storage"]').first().click();
    await app.evaluate((_, f) => globalThis.openQueue.push(f), [path.join(temp, 'translated.pdf'), path.join(temp, 'untouched.pdf')]); await p.locator('[data-action="add-files"]').first().click();
    await p.locator('.paper-item').nth(1).waitFor();
    const item = name => p.locator('.paper-item').filter({ hasText: name });
    await item('translated').click(); await p.locator('.original-pages .page[data-page="1"] .textLayer span').first().waitFor();

    // Ctrl+1–7: the tools in toolbar order; the tips name the keys; the page memo is a text box.
    const tool = () => p.evaluate(() => globalThis.appInk.tool), color = () => p.evaluate(() => globalThis.appInk.color);
    const bar = p.locator('.ink-toolbar');
    assert.deepEqual(await bar.locator('.ink-tools [data-ink-tool]').evaluateAll(list => list.map(b => b.dataset.tip.split(' · ').at(-1))), ['Ctrl+1', 'Ctrl+2', 'Ctrl+3', 'Ctrl+4', 'Ctrl+5', 'Ctrl+6', 'Ctrl+7']);
    for (const [key, expected] of [['2', 'pen'], ['3', 'highlighter'], ['4', 'eraser'], ['6', 'lasso'], ['7', 'text'], ['1', 'read']]) { await p.keyboard.press('Control+' + key); assert.equal(await tool(), expected, 'Ctrl+' + key); }
    assert.equal(await bar.locator('[data-ink-tool="text"]').getAttribute('aria-label'), '텍스트 상자');
    await p.keyboard.press('Control+5'); assert.equal(await tool(), 'shape');
    assert.equal(await p.locator('.ink-flyout').count(), 0, 'a shortcut does not open a tool menu');
    // Pressed again, a group's key moves to its next way (사각형 → 타원 → 삼각형 …, 지우개 → 부분 지우개, 읽기 → 손 → 레이저).
    const shape = () => p.evaluate(() => globalThis.appInk.shape), eraser = () => p.evaluate(() => globalThis.appInk.eraser);
    assert.equal(await shape(), 'rect');
    await p.keyboard.press('Control+5'); assert.equal(await shape(), 'ellipse'); assert.equal(await tool(), 'shape'); await p.locator('#toast').filter({ hasText: '타원' }).waitFor();
    await p.keyboard.press('Control+5'); assert.equal(await shape(), 'triangle');
    await p.keyboard.press('Control+4'); assert.equal(await eraser(), 'stroke', 'the first press only picks the tool');
    await p.keyboard.press('Control+4'); assert.equal(await eraser(), 'partial'); await p.keyboard.press('Control+4'); assert.equal(await eraser(), 'stroke');
    await p.keyboard.press('Control+1'); assert.equal(await tool(), 'read');
    for (const expected of ['hand', 'laser', 'read']) { await p.keyboard.press('Control+1'); assert.equal(await tool(), expected); }
    assert.equal(await p.locator('.ink-flyout').count(), 0, 'cycling does not open a menu');
    // Shift+1…: the colours shown for the current tool (pen, then highlighter).
    await p.keyboard.press('Control+2'); await p.keyboard.press('Shift+Digit3'); assert.equal((await color()).pen, '#dc2626');
    assert.deepEqual(await bar.locator('.ink-colors [data-ink-color]').evaluateAll(list => list.map(b => b.dataset.tip.split(' · ').at(-1))), ['Shift+1', 'Shift+2', 'Shift+3', 'Shift+4']);
    await p.keyboard.press('Control+3'); await p.keyboard.press('Shift+Digit2'); assert.equal((await color()).highlighter, '#00f600'); assert.equal(await tool(), 'highlighter');
    // Typing in a field is not a shortcut.
    await p.locator('[data-tab="메모"]').click(); await openNote(p); await p.locator('.memo-card.open .field-live .cm-content').click(); await p.keyboard.press('Control+2'); assert.equal(await tool(), 'highlighter');
    await p.keyboard.press('Shift+Digit1'); assert.equal((await color()).highlighter, '#00f600'); assert.equal(await (await openNote(p)).inputValue(), '!');
    await (await openNote(p)).fill(''); await p.evaluate(() => document.activeElement.blur()); await p.keyboard.press('Control+1'); assert.equal(await tool(), 'read');

    // Ctrl+wheel zooms the pages (Cmd on a Mac, or a trackpad pinch); Shift or Ctrl+Shift + wheel scrolls sideways.
    const pages = p.locator('.original-pages'), width = () => p.locator('.original-pages .page[data-page="1"]').evaluate(n => n.getBoundingClientRect().width);
    const before = await width(), box = await pages.boundingBox(); await p.mouse.move(box.x + box.width / 2, box.y + 200);
    await p.keyboard.down('Control'); await p.mouse.wheel(0, -300); await p.keyboard.up('Control');
    await p.waitForFunction(w => document.querySelector('.original-pages .page[data-page="1"]').getBoundingClientRect().width > w * 1.5, before);
    assert.ok(await pages.evaluate(n => n.scrollWidth > n.clientWidth + 50), 'zoomed pages are wider than the pane');
    await p.keyboard.down('Shift'); await p.mouse.wheel(0, 200); await p.keyboard.up('Shift');
    await p.waitForFunction(() => document.querySelector('.original-pages').scrollLeft > 0);
    const left = await pages.evaluate(n => n.scrollLeft);
    await p.keyboard.down('Control'); await p.keyboard.down('Shift'); await p.mouse.wheel(0, 100); await p.keyboard.up('Shift'); await p.keyboard.up('Control');
    await p.waitForFunction(x => document.querySelector('.original-pages').scrollLeft > x, left);
    assert.ok((await width()) > before * 1.5, 'Ctrl+Shift+wheel scrolls; it does not zoom');
    for (let i = 0; i < 6; i++) { await p.keyboard.down('Control'); await p.mouse.wheel(0, 400); await p.keyboard.up('Control'); }
    await p.waitForFunction(w => Math.abs(document.querySelector('.original-pages .page[data-page="1"]').getBoundingClientRect().width - w * .5) < 2, before);
    await p.locator('[data-reader-fit]').first().click();

    // Shift draws pen and highlighter like a ruler, and makes shapes regular: square, circle, equilateral triangle, lines in 45-degree steps.
    const last = () => p.evaluate(() => { const s = [...document.querySelector('.original-pages').inkDoc.strokes.values()].at(-1), xs = [], ys = []; for (let i = 0; i < s.points.length; i += 4) { xs.push(s.points[i]); ys.push(s.points[i + 1]); } return { tool: s.tool, shape: s.shape, n: s.points.length / 4, xs, ys, w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) }; });
    await p.evaluate(() => { document.querySelector('.original-pages').scrollTop = 0; });
    const sheet = await p.locator('.original-pages .page[data-page="1"]').boundingBox(), top = Math.max(sheet.y, 150) + 60, x0 = sheet.x + 60;
    const draw = async (y, dx, dy, shift) => { if (shift) await p.keyboard.down('Shift'); await p.mouse.move(x0, y); await p.mouse.down(); await p.mouse.move(x0 + dx * .4, y + dy * .9 + 15, { steps: 6 }); await p.mouse.move(x0 + dx, y + dy, { steps: 6 }); await p.mouse.up(); if (shift) await p.keyboard.up('Shift'); };
    await p.keyboard.press('Control+2'); await draw(top, 180, 30, false); assert.ok((await last()).n > 2, 'without Shift the pen stays freehand');
    await draw(top + 50, 180, 30, true); let st = await last(); assert.equal(st.tool, 'pen'); assert.equal(st.n, 2, 'a ruler line: start and end only');
    await p.keyboard.press('Control+3'); await draw(top + 100, 180, -20, true); st = await last(); assert.equal(st.tool, 'highlighter'); assert.equal(st.n, 2);
    const near = (a, b, what) => assert.ok(Math.abs(a - b) <= Math.max(a, b) * .02 + .5, `${what}: ${a} vs ${b}`);
    await p.keyboard.press('Control+5'); assert.equal(await shape(), 'triangle'); await draw(top + 150, 160, 40, true); st = await last();
    const corner = i => [st.xs[i], st.ys[i]], side = (i, j) => Math.hypot(corner(i)[0] - corner(j)[0], corner(i)[1] - corner(j)[1]);
    assert.equal(st.shape, 'triangle'); near(side(0, 1), side(1, 2), 'equilateral'); near(side(1, 2), side(2, 0), 'equilateral');
    await p.keyboard.press('Control+5'); assert.equal(await shape(), 'line'); await draw(top + 230, 160, 25, true); st = await last(); near(st.ys[0], st.ys[1], 'a nearly flat line is level');
    await p.keyboard.press('Control+5'); await p.keyboard.press('Control+5'); assert.equal(await shape(), 'rect');
    await draw(top + 260, 160, 40, false); st = await last(); assert.ok(st.w > st.h * 2, 'without Shift the rectangle follows the drag');
    await draw(top + 260, 160, 40, true); st = await last(); assert.equal(st.shape, 'rect'); near(st.w, st.h, 'square');
    await p.keyboard.press('Control+5'); assert.equal(await shape(), 'ellipse'); await draw(top + 260, 60, 150, true); st = await last(); near(st.w, st.h, 'circle');
    await p.keyboard.press('Control+1');

    // Read status at the right end of the PDF tool row: one button that shows the status (a click opens a menu),
    // after 그림 설명·주석 추가. A shorter row shows those two as icons; when the tools wrap, the group takes the line above them.
    const resize = width => p.setViewportSize({ width, height: 950 });
    const layout = () => p.evaluate(() => document.querySelector('.reader-mode-toolbar').dataset.statusLayout);
    const rowTop = selector => p.locator(selector).first().evaluate(n => Math.round(n.getBoundingClientRect().top));
    const choose = async status => { await p.locator('[data-status-menu]').click(); await p.locator(`.status-menu [data-read-status="${status}"]`).click(); await p.locator(`[data-status-menu][data-status="${status}"]`).waitFor(); };
    assert.equal(await p.locator('.reader-status [data-read-status]').count(), 0, 'no row of three buttons');
    // Shrink the window step by step: the layouts come in order and never go back.
    const seen = [], widths = {};
    for (let w = 1900; w >= 700; w -= 50) { await resize(w); await p.waitForTimeout(60); const now = await layout(); if (seen.at(-1) !== now) { seen.push(now); widths[now] = w; } }
    assert.deepEqual(seen.filter(x => x !== 'top-compact'), ['inline', 'inline-compact', 'top'], JSON.stringify(widths));
    await resize(widths.inline); await p.waitForFunction(() => document.querySelector('.reader-mode-toolbar').dataset.statusLayout === 'inline');
    assert.ok(Math.abs(await rowTop('[data-status-menu]') - await rowTop('.ink-toolbar')) < 12, 'one line with the tools');
    assert.ok((await p.locator('.reader-status').boundingBox()).x > (await p.locator('.ink-toolbar [data-ink-redo]').boundingBox()).x, 'after the tools, at the right');
    assert.equal(await p.locator('.reader-annotate .pdf-tool-label').first().isVisible(), true);
    await choose('읽는 중'); assert.equal(await p.locator('[data-status-menu]').textContent(), '읽는 중'); assert.ok((await p.locator('[data-status-menu] .status-caret').boundingBox()).width >= 11, 'a caret large enough to see');
    { await p.locator('[data-status-menu]').click(); const colors = await p.evaluate(() => { const pill = getComputedStyle(document.querySelector('[data-status-menu]')), item = getComputedStyle(document.querySelector('.status-menu [aria-checked="true"]')); return [pill.color, item.color, pill.backgroundColor, item.backgroundColor]; }); assert.equal(colors[1], colors[0], 'the chosen item in the button\'s text colour'); assert.equal(colors[3], colors[2], 'and its background'); await p.keyboard.press('Escape'); }
    await resize(widths['inline-compact']); await p.waitForFunction(() => document.querySelector('.reader-mode-toolbar').dataset.statusLayout === 'inline-compact');
    assert.equal(await p.locator('.reader-annotate .pdf-tool-label').first().isVisible(), false, 'the two tools as icons');
    await p.locator('[data-status-menu]').click(); await p.locator('.status-menu [aria-checked="true"]').filter({ hasText: '읽는 중' }).waitFor();
    await p.keyboard.press('ArrowDown'); await p.keyboard.press('Enter'); await p.locator('[data-status-menu][data-status="완독"]').waitFor(); assert.equal(await p.locator('.status-menu').count(), 0);
    // The status just chosen is a shorter word, so the row turns to this layout a little narrower than before: look for it.
    for (let w = widths.top; w >= 600; w -= 10) { await resize(w); await p.waitForTimeout(60); if (await layout() === 'top') break; }
    assert.equal(await layout(), 'top');
    assert.equal(await p.locator('.reader-mode-toolbar [data-action="back"]').count(), 0, '← 라이브러리 is in the top bar, not in the tool row');
    assert.ok(await rowTop('.ink-toolbar') > await rowTop('[data-status-menu]'), 'the tools take the next line');
    await choose('읽기 전');
    assert.equal((await p.evaluate(async () => (await window.appApi.refreshStorage(state.storageKey)).papers.find(x => x.id === state.selected).status)), '읽기 전');
    // The narrowest row (a narrow window with both sidebars open) keeps the status group on the line above the tools.
    await p.evaluate(() => { document.querySelector('.reader-mode-toolbar').style.width = '250px'; }); await p.waitForFunction(() => document.querySelector('.reader-mode-toolbar').dataset.statusLayout === 'top-compact');
    assert.ok(await rowTop('.ink-toolbar') > await rowTop('[data-status-menu]'), 'the status group keeps the line above the tools');
    await p.evaluate(() => { document.querySelector('.reader-mode-toolbar').style.width = ''; });
    await resize(1300);

    // A paper translated in the app is "번역 있음" in the library, before and after a restart.
    await p.locator('[data-mode="dual"]').click(); await p.locator('#gpt-model').waitFor({ state: 'attached' }); await p.locator('[data-action="gpt-start"]').click();
    await p.locator('.translated-block').filter({ hasText: '연구 논문은 생각을 잇습니다.' }).first().waitFor(); await p.locator('[data-action="gpt-export"]').waitFor();
    await p.locator('[data-action="back"]').click(); await p.locator('[data-filter="번역 있음"]').click();
    assert.deepEqual(await p.locator('.paper-item h3').allTextContents(), ['translated']);
    assert.equal(await item('translated').locator('.pill').first().textContent(), '번역 있음');
    // The app reopens the paper read last; the library is one step back.
    // Reopened as the app starts, with its translation beside it, the tool row keeps its read status and the
    // translation quality shows once the PDF engine is there (drawing it earlier once broke off the row).
    await item('translated').dblclick(); await p.locator('[data-mode="dual"]').click(); await (await toolShown(p, '.translated-pane .translation-quality')).waitFor(); await p.waitForTimeout(500);
    await app.close(); p = await launch(); await (await toolShown(p, '.translated-pane .translation-quality')).waitFor();
    assert.equal(await p.locator('.reader-mode-toolbar > .reader-status [data-status-menu]').count(), 1, 'the read status is in the tool row');
    assert.doesNotMatch(await p.locator('#toast').textContent(), /layoutBlocks|undefined/, 'no error while reopening');
    await p.locator('[data-action="back"]').click(); await p.locator('.paper-item').nth(1).waitFor();
    assert.equal(await item('translated').locator('.pill', { hasText: '번역 있음' }).count(), 1, 'known from the stored translation after a restart');
    assert.equal(await item('untouched').locator('.pill', { hasText: '번역 있음' }).count(), 0);
    await p.locator('[data-filter="번역 있음"]').click(); assert.deepEqual(await p.locator('.paper-item h3').allTextContents(), ['translated']);
    console.log('Reader shortcuts smoke passed: Ctrl+wheel zoom, Shift and Ctrl+Shift+wheel sideways scroll, Ctrl+1–7 tools and repeated presses, Shift+digit colours, Shift ruler lines and regular shapes, text box name, read status in the tool row at four widths (and when the last paper reopens with its translation), 번역 있음 in the library across restart.');
  } finally { await app?.close().catch(() => {}); await fs.rm(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }).catch(error => console.warn(`임시 폴더를 다 지우지 못했습니다(${error.code}). 테스트 결과와는 무관합니다: ${temp}`)); }
})().catch(error => { console.error(error); process.exit(1); });
