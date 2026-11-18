// End-to-end check of the recent vaults when two folders hold one vault (a folder and its copy, the same vault id):
// each is its own entry (its own key, where it is shown beside its name), opening one opens that folder, and taking one
// off the list leaves the other. APP_TEST_SOURCE=1 runs the source.
const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { PDFDocument, StandardFonts } = require('pdf-lib');
const appName = require('../core/app-name.cjs');
const root = path.resolve(__dirname, '..');
(async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), `${appName.id}-recents-e2e-`)), a = path.join(temp, 'here', 'V'), b = path.join(temp, 'there', 'V');
  await fs.mkdir(a, { recursive: true }); await fs.mkdir(path.dirname(b), { recursive: true });
  const doc = await PDFDocument.create(), font = await doc.embedFont(StandardFonts.Helvetica); doc.addPage([600, 800]).drawText('One paper.', { x: 40, y: 740, size: 14, font });
  await fs.writeFile(path.join(a, 'one.pdf'), await doc.save());
  const env = /utf-?8/i.test(process.env.LC_ALL || process.env.LANG || '') ? process.env : { ...process.env, LC_ALL: 'C.UTF-8', LANG: 'C.UTF-8' };
  let app;
  try {
    app = await electron.launch({ env: { ...env, APP_UI_LANG: 'ko' }, executablePath: require('./app-executable.cjs')(root), args: [...(process.env.APP_TEST_SOURCE === '1' ? [root] : []), '--no-sandbox', '--ozone-platform=headless', '--disable-gpu', `--user-data-dir=${path.join(temp, 'profile')}`], timeout: 20000 });
    const p = await app.firstWindow(); p.setDefaultTimeout(15000); p.on('pageerror', e => { console.error(e); process.exitCode = 1; });
    await app.evaluate(({ dialog }) => { globalThis.openQueue = []; dialog.showOpenDialog = async () => ({ canceled: false, filePaths: globalThis.openQueue.shift() }); });
    await app.evaluate((_, v) => globalThis.openQueue.push([v]), a); await p.locator('[data-action="storage"]').first().click(); await p.locator('.paper-item').first().waitFor();
    // The copy, with one more file, opened too.
    await fs.cp(a, b, { recursive: true }); await fs.writeFile(path.join(b, 'two.pdf'), await fs.readFile(path.join(a, 'one.pdf')).then(x => Buffer.concat([x, Buffer.from('\n% copy\n')])));
    await app.evaluate((_, v) => globalThis.openQueue.push([v]), b); await p.evaluate(() => chooseDesktopStorage()); await p.waitForFunction(() => papers.length === 2).catch(async e => { console.log('DBG', await p.evaluate(() => [papers.length, state.storageKey])); throw e; });
    const recents = await p.evaluate(async () => (await window.appApi.bootstrap()).recents);
    assert.equal(recents.length, 2); assert.equal(recents[0].id, recents[1].id, 'one vault id');
    assert.ok(recents[0].key && recents[1].key && recents[0].key !== recents[1].key, 'each its own key');
    assert.notEqual(recents[0].where, recents[1].where, 'told apart by where they are');
    // Opening the older entry opens that folder (one paper), not the newer (two).
    const older = recents.find(r => /[\/]here$/.test(r.where));
    await p.evaluate(async key => { applySnapshot(await window.appApi.openRecent(key)); await refreshPreferences(); }, older.key); await p.waitForFunction(() => papers.length === 1);
    // The menus name each entry by its key.
    const keys = await p.evaluate(() => { document.body.insertAdjacentHTML('beforeend', `<div id="probe">${vaultSwitchMenu()}</div>`); const out = [...document.querySelectorAll('#probe [data-desktop-recent]')].map(n => n.dataset.desktopRecent); document.querySelector('#probe').remove(); return out; });
    assert.deepEqual(keys, [recents.find(r => r !== older).key], 'the other entry, by its key');
    // Taking the newer off the list leaves the older.
    const left = await p.evaluate(async key => window.appApi.removeRecent(key), recents.find(r => r !== older).key);
    assert.deepEqual(left.map(r => r.key), [older.key]);
    // A recent vault whose folder is gone (moved, drive taken out) is said so in words, not as a raw file error.
    await fs.rename(path.dirname(a), path.join(temp, 'moved'));
    const missing = await p.evaluate(async key => window.appApi.openRecent(key).then(() => 'opened', e => e.message), older.key);
    assert.ok(!/ENOENT|realpath|no such file/.test(missing), missing); assert.match(missing, /저장소 폴더를 찾을 수 없습니다/); assert.match(missing, /최근 목록/);
    assert.ok(missing.includes(older.where), 'the place, as the list shows it');
    await app.close(); app = null;
    console.log('Recent vaults smoke passed: a folder and its copy are two entries with their own keys and places; each opens its own folder; one taken off leaves the other; a missing folder is said in words.');
  } catch (error) { console.error(error); process.exitCode = 1; }
  finally { await app?.close().catch(() => {}); await fs.rm(temp, { recursive: true, force: true }); }
})();
