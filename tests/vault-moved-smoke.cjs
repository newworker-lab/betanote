// End-to-end check of a vault whose folder is renamed (or moved, or on a drive taken out) while it is open
// (storage.cjs gone, main.cjs vault-relocate, help.js askVaultReload): the app says the folder cannot be found, not that
// another program changed the vault; 폴더 다시 고르기 with another folder is refused and nothing is made there; with the
// renamed folder the vault goes on without a restart, a memo not saved yet is kept, later changes are written in the
// new place, and the old name is not made again. APP_TEST_SOURCE=1 runs the source.
const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { PDFDocument, StandardFonts } = require('pdf-lib');
const appName = require('../core/app-name.cjs');
const root = path.resolve(__dirname, '..');
const executable = require('./app-executable.cjs')(root); // also gives the run its language (APP_UI_LANG), before env is read

(async () => {
  const temp = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), `${appName.id}-vault-moved-e2e-`))), vault = path.join(temp, 'papers'), renamed = path.join(temp, 'papers 2026'), other = path.join(temp, 'other'); await fs.mkdir(vault); await fs.mkdir(other);
  const doc = await PDFDocument.create(), font = await doc.embedFont(StandardFonts.Helvetica); doc.addPage([600, 800]).drawText('Page 1 of a research paper.', { x: 40, y: 740, size: 14, font });
  await fs.writeFile(path.join(temp, 'paper.pdf'), await doc.save());
  const env = /utf-?8/i.test(process.env.LC_ALL || process.env.LANG || '') ? process.env : { ...process.env, LC_ALL: 'C.UTF-8', LANG: 'C.UTF-8' };
  const exists = file => fs.access(file).then(() => true, () => false);
  let app;
  try {
    app = await electron.launch({ env, executablePath: executable, args: [...(process.env.APP_TEST_SOURCE === '1' ? [root] : []), '--no-sandbox', '--ozone-platform=headless', '--disable-gpu', `--user-data-dir=${path.join(temp, 'profile')}`], timeout: 20000 });
    const p = await app.firstWindow(); p.setDefaultTimeout(15000);
    p.on('pageerror', e => { console.error(e); process.exitCode = 1; });
    await app.evaluate(({ dialog }) => { globalThis.openQueue = []; dialog.showOpenDialog = async () => { const next = globalThis.openQueue.shift(); return next ? { canceled: false, filePaths: next } : { canceled: true, filePaths: [] }; }; });
    await app.evaluate((_, v) => globalThis.openQueue.push([v]), vault); await p.locator('[data-action="storage"]').first().click();
    await app.evaluate((_, f) => globalThis.openQueue.push([f]), path.join(temp, 'paper.pdf')); await p.locator('[data-action="add-files"]').first().click();
    await p.locator('.paper-item').first().waitFor();
    const id = await p.evaluate(() => state.storageKey), paperId = await p.evaluate(() => papers[0].id);
    // The folder is renamed outside the app, and a memo is written that cannot be saved any more.
    await fs.rename(vault, renamed);
    await p.evaluate(paperId => { setNote(`${paperId}-메모`, 'written after the folder was renamed'); }, paperId);
    // What the app itself asks of the vault meanwhile (the notebooks' list, a pasted picture) must not make the old
    // folder again: a folder made again under the old name would pass for the vault, changed by another program.
    await p.evaluate(async id => { await window.appApi.notebookList(id).catch(() => {}); await window.appApi.saveNoteImage(id, 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==').catch(() => {}); }, id);
    assert.equal(await exists(vault), false, 'the app’s own requests do not make the old folder again');
    await p.evaluate(() => { outsideChange.checkedAt = 0; window.dispatchEvent(new Event('focus')); });
    const gone = p.locator('#dialog[open]').filter({ hasText: '저장소 폴더를 찾을 수 없습니다' }); await gone.waitFor();
    assert.equal(await p.locator('#dialog[open]').filter({ hasText: '다른 프로그램에서 변경' }).count(), 0, 'it is not called a change by another program');
    assert.equal(await exists(vault), false, 'the old name is not made again');
    // Another folder is refused, and nothing is made in it.
    await app.evaluate((_, f) => globalThis.openQueue.push([f]), other); await gone.locator('[data-action="vault-relocate"]').click();
    await p.locator('#toast').filter({ hasText: '이 저장소의 폴더가 아닙니다' }).waitFor(); assert.deepEqual(await fs.readdir(other), [], 'nothing is made in a folder that is not the vault');
    await gone.waitFor();
    // Cancelling the folder dialog leaves the question open.
    await gone.locator('[data-action="vault-relocate"]').click(); await p.waitForTimeout(300); await gone.waitFor();
    // The renamed folder: the vault goes on, with the memo.
    await app.evaluate((_, f) => globalThis.openQueue.push([f]), renamed); await gone.locator('[data-action="vault-relocate"]').click();
    await p.locator('#toast').filter({ hasText: '저장소를 다시 연결했습니다' }).waitFor(); await p.locator('#dialog[open]').waitFor({ state: 'detached' }).catch(() => {});
    assert.equal(await p.locator('#dialog[open]').count(), 0); assert.equal(await p.evaluate(() => state.storageKey), id, 'the same vault'); assert.equal(await p.evaluate(() => papers.length), 1);
    const read = async () => JSON.parse(await fs.readFile(path.join(renamed, appName.vaultDir, 'library.json'), 'utf8'));
    for (let i = 0; i < 100 && (await read()).notes[`${paperId}-메모`] !== 'written after the folder was renamed'; i++) await new Promise(r => setTimeout(r, 50));
    assert.equal((await read()).notes[`${paperId}-메모`], 'written after the folder was renamed', 'the memo written meanwhile is kept, in the new place');
    // A later change is written in the new place.
await p.evaluate(async id => { const result = await window.appApi.createFolder(id, '', 'after'); applySnapshot(result.snapshot); }, id);
    assert.equal(await exists(path.join(renamed, 'after')), true, 'a folder made afterwards is in the renamed vault'); assert.equal(await exists(vault), false, 'the old name is still not there');
    await app.close(); app = null;
    assert.equal(await exists(vault), false, 'closing the app does not make the old folder again');
    // A folder made again under the old name by something else (a sync tool, a person) is still not the vault: the
    // records are not there, so it is told as not found, not as changed by another program.
    {
      const { Library } = require('../desktop/storage.cjs'), again = path.join(temp, 'again'), moved = path.join(temp, 'again moved'); await fs.mkdir(again);
      const library = await Library.open(again); await library.saveNotes({ 'x-메모': 'kept' });
      await fs.rename(again, moved); assert.equal(await library.gone(), true);
      await fs.mkdir(path.join(again, appName.vaultDir, 'notebooks'), { recursive: true });
      assert.equal(await library.gone(), true, 'a folder of that name without the vault’s records is not the vault');
      await fs.rm(again, { recursive: true }); await fs.rename(moved, again); assert.equal(await library.gone(), false, 'back in its place it is there again');
    }
    const settings = JSON.parse(await fs.readFile(path.join(temp, 'profile', 'settings.json'), 'utf8'));
    assert.equal(settings.recents[0].root, renamed, 'the recent vaults name the new place'); assert.equal(settings.recents.some(r => r.root === vault), false, 'and no longer the old one');
    console.log('Vault moved smoke passed: a renamed vault folder is told as not found (not as changed by another program); another folder is refused and left untouched; the renamed folder is taken without a restart with the unsaved memo kept; later changes go to the new place; the old name is not made again; the recent vaults name the new place.');
  } catch (error) { console.error(error); process.exitCode = 1; try { await (await app?.firstWindow())?.screenshot({ path: path.join(os.tmpdir(), `${appName.id}-vault-moved-failure.png`) }); } catch { /* no window to picture */ } }
  finally { await app?.close().catch(() => {}); await fs.rm(temp, { recursive: true, force: true }); }
})();
