// End-to-end check of deleting a notebook (desktop/notebook.js ⋯ menu, renderer.js 저장소 관리 › 휴지통, notebook.cjs):
// of two notebooks of a paper, the one deleted leaves the list and the other opens; 되돌리기 brings it back; deleted again,
// it is in the trash, comes back from there, and once deleted for good is gone with the picture only it used; all of it
// holds after a restart. A memo's pin on a notebook in the trash says so. Renaming from the same menu is kept. The menu
// and the trash fit the English screen at 800px. APP_TEST_SOURCE=1 runs the source.
const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { PDFDocument, StandardFonts } = require('pdf-lib');
const appName = require('../core/app-name.cjs');
const toolShown = require('./tool-row.cjs'); // a tool a narrow pane keeps under ⋯ is brought out before it is used
const root = path.resolve(__dirname, '..');
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
(async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), `${appName.id}-nbdel-e2e-`)), vault = path.join(temp, 'vault'); await fs.mkdir(vault);
  const doc = await PDFDocument.create(), font = await doc.embedFont(StandardFonts.Helvetica); doc.addPage([600, 800]).drawText('A paper.', { x: 40, y: 700, size: 14, font });
  await fs.writeFile(path.join(temp, 'paper.pdf'), await doc.save());
  const env = /utf-?8/i.test(process.env.LC_ALL || process.env.LANG || '') ? process.env : { ...process.env, LC_ALL: 'C.UTF-8', LANG: 'C.UTF-8' };
  let app;
  const launch = async (lang = 'ko') => {
    app = await electron.launch({ env: { ...env, APP_UI_LANG: lang }, executablePath: require('./app-executable.cjs')(root), args: [...(process.env.APP_TEST_SOURCE === '1' ? [root] : []), '--no-sandbox', '--ozone-platform=headless', '--disable-gpu', `--user-data-dir=${path.join(temp, 'profile')}`], timeout: 20000 });
    const p = await app.firstWindow(); p.setDefaultTimeout(15000); await p.setViewportSize({ width: 1400, height: 950 });
    p.on('pageerror', e => { console.error(e); process.exitCode = 1; });
    await app.evaluate(({ dialog }) => { globalThis.openQueue = []; dialog.showOpenDialog = async () => ({ canceled: false, filePaths: globalThis.openQueue.shift() }); });
    return p;
  };
  const files = async () => (await fs.readdir(path.join(vault, appName.vaultDir, 'notebooks'))).filter(n => n.endsWith('.json')).length;
  const assets = async () => (await fs.readdir(path.join(vault, appName.vaultDir, 'notebooks', 'assets')).catch(() => [])).filter(n => n.endsWith('.png'));
  const options = p => p.evaluate(() => [...document.querySelectorAll('.nb-select option')].filter(o => o.value).map(o => o.textContent));
  const shown = p => p.evaluate(() => nb.doc?.title || null);
  const create = async (p, title) => { await p.locator('.notebook-pane [data-action="nb-new"]').first().click(); await p.locator('#nb-title').fill(title); await p.locator('#dialog [data-action="nb-create"]').click(); await p.waitForFunction(t => nb.doc?.title === t, title); };
  const menu = async (p, action) => { await (await toolShown(p, '[data-nb-menu]')).click(); await p.locator(`.pop-menu [data-action="${action}"]`).click(); };
  const toTrashTab = async p => { await p.locator('[data-action="vault-manager"]').first().click(); await p.locator('[data-vm-tab="trash"]').click(); await p.locator('[data-nb-trash]').waitFor(); };
  try {
    let p = await launch();
    await app.evaluate((_, v) => globalThis.openQueue.push([v]), vault); await p.locator('[data-action="storage"]').first().click();
    await app.evaluate((_, f) => globalThis.openQueue.push([f]), path.join(temp, 'paper.pdf')); await p.locator('[data-action="add-files"]').first().click();
    await p.locator('.paper-item').click(); await p.locator('.original-pages .page[data-page="1"] canvas').first().waitFor();
    await p.locator('[data-mode="notebook"]').click();
    await create(p, '남길 노트'); await create(p, '지울 노트');
    // The one to delete has a picture of its own and a memo pinned on it.
    await p.evaluate(async png => { const hash = await window.appApi.notebookAssetPut(state.storageKey, png); nbChange('그림', () => nb.doc.pages[0].items.push({ id: nbId(), type: 'image', x: 40, y: 40, w: 100, h: 60, asset: hash })); await nbFlush();
      const key = `${state.selected}-메모`; notes[key] = '핀 메모'; notes[key + '#pin'] = JSON.stringify({ notebookId: nb.doc.id, pageId: nb.doc.pages[0].id, x: .5, y: .5 }); await desktopNotes(); }, png);
    assert.equal((await assets()).length, 1);

    // Renaming, from the ⋯ menu, is kept.
    await menu(p, 'nb-rename'); await p.locator('#nb-rename-title').fill('지울 노트 2'); await p.locator('#dialog [data-action="nb-rename-go"]').click();
    await p.waitForFunction(() => nb.doc.title === '지울 노트 2'); assert.deepEqual((await options(p)).sort(), ['남길 노트', '지울 노트 2']);

    // 1. Deleted: the confirmation names it and its pages; it leaves the list and the other notebook opens.
    await menu(p, 'nb-delete'); const confirm = p.locator('#dialog'); await confirm.locator('[data-action="nb-delete-go"]').waitFor();
    assert.match(await confirm.textContent(), /지울 노트 2 · 1쪽/); assert.match(await confirm.textContent(), /저장소 관리의 휴지통에서 되살릴 수 있습니다/);
    await confirm.locator('[data-action="nb-delete-go"]').click();
    await p.waitForFunction(() => nb.doc?.title === '남길 노트'); assert.deepEqual(await options(p), ['남길 노트']);
    // 2. 되돌리기 on the notice brings it back, open.
    await p.locator('.undo-toast button').click(); await p.waitForFunction(() => nb.doc?.title === '지울 노트 2'); assert.equal((await options(p)).length, 2);
    // 3. Deleted again: in the trash. Its pin says the notebook is in the trash.
    await menu(p, 'nb-delete'); await p.locator('#dialog [data-action="nb-delete-go"]').click(); await p.waitForFunction(() => nb.doc?.title === '남길 노트');
    await p.evaluate(() => nbGoToPin(JSON.parse(notes[`${state.selected}-메모#pin`]), `${state.selected}-메모`));
    await p.locator('#toast').filter({ hasText: '핀이 꽂힌 노트북이 휴지통에 있습니다' }).waitFor();
    await toTrashTab(p); assert.match(await p.locator('[data-nb-trash]').textContent(), /지울 노트 2/);
    // 4. Back from the trash.
    await p.locator('[data-restore-notebook]').click(); await p.waitForFunction(() => !document.querySelector('[data-restore-notebook]') && document.querySelector('[data-nb-trash]'));
    await p.evaluate(() => dialog.close()); await p.waitForFunction(() => document.querySelectorAll('.nb-select option[value]:not([value=""])').length === 2);
    // 5. Deleted, then deleted for good (asked first): the file and its picture are gone.
    await p.locator('.nb-select').selectOption({ label: '지울 노트 2' }); await p.waitForFunction(() => nb.doc?.title === '지울 노트 2');
    await menu(p, 'nb-delete'); await p.locator('#dialog [data-action="nb-delete-go"]').click(); await p.waitForFunction(() => nb.doc?.title === '남길 노트');
    await toTrashTab(p); await p.locator('[data-purge-notebook]').click(); await p.locator('#dialog [data-action="nb-purge-go"]').click();
    await p.locator('#toast').filter({ hasText: '노트북을 완전히 삭제했습니다' }).waitFor(); await p.locator('[data-nb-trash]').filter({ hasText: '휴지통에 노트북이 없습니다' }).waitFor();
    assert.equal(await files(), 1); assert.deepEqual(await assets(), [], 'the picture only it used');
    await p.evaluate(() => dialog.close()); await app.close();

    // 6. After a restart: one notebook, an empty trash.
    p = await launch(); await p.locator('.shell').waitFor(); if (await p.evaluate(() => state.screen !== 'reader')) await p.locator('.paper-item').click();
    await p.locator('[data-mode="notebook"]').click(); await p.waitForFunction(() => nb.doc?.title === '남길 노트'); assert.deepEqual(await options(p), ['남길 노트']);
    await toTrashTab(p); assert.match(await p.locator('[data-nb-trash]').textContent(), /휴지통에 노트북이 없습니다/); await p.evaluate(() => dialog.close());
    await app.close(); app = null;

    // 7. English at 800px: the menu and the confirmation fit.
    p = await launch('en'); await p.setViewportSize({ width: 800, height: 600 }); await p.locator('.shell').waitFor(); if (await p.evaluate(() => state.screen !== 'reader')) await p.locator('.paper-item').click();
    await p.locator('[data-mode="notebook"]').click(); await p.waitForFunction(() => nb.doc);
    await (await toolShown(p, '[data-nb-menu]')).click(); const pop = p.locator('.pop-menu'); await pop.waitFor(); assert.match(await pop.textContent(), /Rename…/); assert.match(await pop.textContent(), /Delete notebook…/);
    const fits = await p.evaluate(() => { const r = document.querySelector('.pop-menu').getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight && [...document.querySelectorAll('.pop-menu button')].every(b => b.scrollWidth <= b.clientWidth + 1); });
    assert.ok(fits, 'the notebook menu fits at 800px');
    await p.locator('.pop-menu [data-action="nb-delete"]').click(); await p.locator('#dialog [data-action="nb-delete-go"]').waitFor();
    assert.match(await p.locator('#dialog').textContent(), /It goes to the trash/);
    assert.ok(await p.evaluate(() => { const r = document.querySelector('#dialog').getBoundingClientRect(); return r.right <= innerWidth && r.left >= 0; }), 'the confirmation fits');
    await app.close(); app = null;
    console.log('Notebook delete smoke passed: renamed, deleted (the other opened), brought back by 되돌리기, deleted again into the trash (its pin says so), restored from there, deleted for good with its own picture, kept after a restart; the menu fits in English at 800px.');
  } catch (error) { console.error(error); process.exitCode = 1; }
  finally { await app?.close().catch(() => {}); await fs.rm(temp, { recursive: true, force: true }); }
})();
