// End-to-end check that what scrolls the notebook pane scrolls only it (desktop/notebook.js, notes.js showPin): with the
// original, the notebook and a long memo open beside them, the + under the last page (mouse and Enter), 페이지 추가,
// a whiteboard growing, End and PageDown in the pane, going to a memo's pin and a new memo card leave the reader where it
// is: no hidden box around the pane is scrolled (no empty band under the panes), the panes end where they ended, and
// the new page or the pin is in view in the pane. At 2000×1060 and 1300×900. APP_TEST_SOURCE=1 runs the source;
// APP_PHOTO_DIR keeps pictures.
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
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), `${appName.id}-nb-scroll-e2e-`)), vault = path.join(temp, 'vault'); await fs.mkdir(vault);
  const doc = await PDFDocument.create(), font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < 3; i++) doc.addPage([600, 800]).drawText(`Page ${i + 1} of a research paper.`, { x: 40, y: 740, size: 14, font });
  await fs.writeFile(path.join(temp, 'paper.pdf'), await doc.save());
  const env = /utf-?8/i.test(process.env.LC_ALL || process.env.LANG || '') ? process.env : { ...process.env, LC_ALL: 'C.UTF-8', LANG: 'C.UTF-8' };
  let app;
  try {
    app = await electron.launch({ env: { ...env, APP_UI_LANG: 'ko' }, executablePath: require('./app-executable.cjs')(root), args: [...(process.env.APP_TEST_SOURCE === '1' ? [root] : []), '--no-sandbox', '--ozone-platform=headless', '--disable-gpu', `--user-data-dir=${path.join(temp, 'profile')}`], timeout: 20000 });
    const p = await app.firstWindow(); p.setDefaultTimeout(15000); await p.setViewportSize({ width: 2000, height: 1060 });
    p.on('pageerror', e => { console.error(e); process.exitCode = 1; });
    await app.evaluate(({ dialog }) => { globalThis.openQueue = []; dialog.showOpenDialog = async () => ({ canceled: false, filePaths: globalThis.openQueue.shift() }); });
    await app.evaluate((_, v) => globalThis.openQueue.push([v]), vault); await p.locator('[data-action="storage"]').first().click();
    await app.evaluate((_, f) => globalThis.openQueue.push([f]), path.join(temp, 'paper.pdf')); await p.locator('[data-action="add-files"]').first().click();
    await p.locator('.paper-item').first().click(); await p.locator('.original-pages .page[data-page="1"] canvas').first().waitFor();
    // A long memo open in the panel, as in the report.
    await p.locator('[data-tab="메모"]').first().click().catch(() => {});
    await p.locator('.memo-tab [data-action="memo-new"]').first().click(); await p.locator('.memo-card.open .field-live .cm-content').waitFor();
    await p.evaluate(() => { const ed = fieldEditorOf(document.querySelector('.memo-card.open .note-box textarea')); ed.view.dispatch({ changes: { from: 0, insert: Array.from({ length: 80 }, (_, i) => `생존함수 메모 ${i + 1}줄`).join('\n') } }); });
    await p.locator('[data-mode="notebook"]').click(); await p.locator('.notebook-pane [data-action="nb-new"]').first().click();
    await p.locator('#nb-title').fill('스크롤 노트'); await p.locator('#dialog [data-action="nb-create"]').click(); await p.locator('.nb-page').first().waitFor();

    // The boxes from the pane up to the page: none scrolled but the pane's page list; where the panes end.
    const layout = () => p.evaluate(() => {
      const list = document.querySelector('.nb-pages'), moved = [];
      for (let e = list.parentElement; e; e = e.parentElement) if (e.scrollTop || e.scrollLeft) moved.push(`${e.tagName.toLowerCase()}.${[...e.classList].join('.')} ${e.scrollTop}/${e.scrollLeft}`);
      if (document.scrollingElement.scrollTop) moved.push(`page ${document.scrollingElement.scrollTop}`);
      const bottom = s => Math.round(document.querySelector(s).getBoundingClientRect().bottom);
      return { moved, ends: { notebook: bottom('.notebook-pane'), original: bottom('.pdf-pane:not(.notebook-pane)'), panel: bottom('.reader-panel'), reader: bottom('.reader-layout') } };
    });
    const inView = selector => p.evaluate(s => { const list = document.querySelector('.nb-pages').getBoundingClientRect(), r = document.querySelector(s)?.getBoundingClientRect(); return !!r && r.top >= list.top - 1 && r.top < list.bottom - 10; }, selector);
    let base;
    const same = async label => {
      await p.waitForTimeout(250); const now = await layout();
      assert.deepEqual(now.moved, [], `${label}: no box around the pane is scrolled`);
      assert.deepEqual(now.ends, base.ends, `${label}: the panes end where they did`);
    };
    const photo = async name => { if (process.env.APP_PHOTO_DIR) await p.screenshot({ path: path.join(process.env.APP_PHOTO_DIR, name) }); };
    const pages = () => p.evaluate(() => nb.doc.pages.length);
    const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null;
    for (const [w, h] of [[2000, 1060], [1300, 900]]) {
      await p.setViewportSize({ width: w, height: h }); await p.waitForTimeout(300); base = await layout();
      assert.deepEqual(base.moved, [], `${w}×${h}: nothing scrolled to start with`);
      const step = async (name, run) => { if (ONLY && !ONLY.includes(name)) return; await run(); };
      await step('plus', async () => {
        const n = await pages(); await p.locator('.nb-add-same').click(); assert.equal(await pages(), n + 1);
        await photo(`notebook-plus-${w}.png`); await same(`${w}×${h} + (mouse)`); assert.ok(await inView('.nb-page-wrap:last-of-type'), 'the new page is in view in the pane');
        await p.locator('.nb-add-same').focus(); await p.keyboard.press('Enter'); assert.equal(await pages(), n + 2);
        await same(`${w}×${h} + (Enter)`); assert.ok(await inView('.nb-page-wrap:last-of-type'), 'the new page is in view (Enter)');
      });
      await step('menu', async () => {
        await (await toolShown(p, '[data-nb-add]')).click(); await p.locator('.nb-add-menu [data-action="nb-add-page"]').click();
        await same(`${w}×${h} 페이지 추가`); assert.ok(await inView('.nb-page-wrap:last-of-type'), 'the page added from the menu is in view');
      });
      await step('board', async () => {
        await (await toolShown(p, '[data-nb-add]')).click(); await p.locator('.nb-add-menu [name="nb-new-board"]').check(); await p.locator('.nb-add-menu [data-action="nb-add-page"]').click();
        await p.locator('.nb-add-menu [name="nb-new-board"]').uncheck().catch(() => {}); await p.keyboard.press('Escape').catch(() => {});
        await same(`${w}×${h} 화이트보드 추가`);
        const grown = await p.evaluate(() => { const page = nb.doc.pages.at(-1), before = page.height; nbChange('그리기', () => page.strokes.push({ id: nbId(), tool: 'pen', color: '#000000', width: 2, points: [60, before - 30, .5, 0, 200, before - 20, .5, 10] })); return nb.doc.pages.at(-1).height > before; }); // i18n:keep — the undo label
        assert.ok(grown, 'the whiteboard grew'); await same(`${w}×${h} 화이트보드가 늘어남`);
      });
      await step('keys', async () => {
        await p.evaluate(() => { document.querySelector('.nb-pages').scrollTop = 0; }); await p.locator('.nb-pages').focus();
        await p.keyboard.press('End'); await same(`${w}×${h} End`); await p.keyboard.press('PageUp'); await p.keyboard.press('PageDown'); await same(`${w}×${h} PageDown`);
      });
      await step('pin', async () => {
        const key = await p.evaluate(() => Object.keys(notes).find(k => /-메모/.test(k) && !k.includes('#')));
        await p.evaluate(async key => { nbChange('페이지 추가', () => nb.doc.pages.push(nbNewPage('lined', { w: 595, h: 842 }, false))); const page = nb.doc.pages.at(-1); // i18n:keep — the undo label
          notes[key + '#pin'] = JSON.stringify({ notebookId: nb.doc.id, pageId: page.id, x: .9, y: .985 }); await desktopNotes(); document.querySelector('.nb-pages').scrollTop = 0; nbRender(); }, key);
        await p.evaluate(key => nbGoToPin(JSON.parse(notes[key + '#pin']), key), key);
        await same(`${w}×${h} 핀으로 이동`); assert.ok(await inView(`[data-memo-pin-open="${key}"]`), `the pin is in view in the pane ${await p.evaluate(k => { const l = document.querySelector('.nb-pages'), r = document.querySelector(`[data-memo-pin-open="${k}"]`)?.getBoundingClientRect(); return JSON.stringify({ pin: r && [r.top, r.bottom], list: [l.getBoundingClientRect().top, l.getBoundingClientRect().bottom], st: l.scrollTop, sh: l.scrollHeight, ch: l.clientHeight }); }, key)}`);
      });
      await step('memo', async () => {
        await p.evaluate(() => { document.querySelector('.nb-pages').scrollTop = document.querySelector('.nb-pages').scrollHeight; });
        await (await toolShown(p, '.notebook-pane [data-action="nb-memo"]')).click(); await p.locator('.nb-memo-menu [data-action="nb-memo-create"]').click(); await p.locator('.nb-memo-card.open').waitFor();
        await same(`${w}×${h} 새 메모 만들어 넣기`); await p.keyboard.press('Escape');
      });
    }
    await app.close(); app = null;
    console.log('Notebook scroll smoke passed: +, 페이지 추가, a growing whiteboard, End/PageDown, a pin and a new memo card scroll only the notebook pane, at 2000×1060 and 1300×900.');
  } catch (error) { console.error(error); process.exitCode = 1; try { await (await app?.firstWindow())?.screenshot({ path: path.join(os.tmpdir(), `${appName.id}-nb-scroll-failure.png`) }); } catch {} }
  finally { await app?.close().catch(() => {}); await fs.rm(temp, { recursive: true, force: true }); }
})();
