// End-to-end check of what keeps a send safe in the real app (desktop/transfer.js, main.cjs): while a move runs its
// dialog does not close (Esc, ×) and the notebook windows are saved and closed; 취소 pressed right after 보내기 is
// heard before anything is sent; a memo that cannot be saved stops the send; two recent vaults with one vault id (a
// folder and its copy) each get what is sent to them, told apart by where they are; a refused folder leaves the dialog
// on the vault chosen before; 열기 saves the memo just typed before switching; the result names what was skipped.
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
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), `${appName.id}-transfer-guard-e2e-`)), a = path.join(temp, 'A'), b = path.join(temp, 'B'), b2 = path.join(temp, 'B2');
  await fs.mkdir(a); await fs.mkdir(b);
  const names = ['one', 'two', 'three', 'four', 'five'];
  for (const name of names) {
    const doc = await PDFDocument.create(), font = await doc.embedFont(StandardFonts.Helvetica); doc.addPage([600, 800]).drawText(`The ${name} paper.`, { x: 40, y: 740, size: 14, font });
    await fs.writeFile(path.join(a, name + '.pdf'), await doc.save());
  }
  const env = /utf-?8/i.test(process.env.LC_ALL || process.env.LANG || '') ? process.env : { ...process.env, LC_ALL: 'C.UTF-8', LANG: 'C.UTF-8' };
  let app;
  try {
    app = await electron.launch({ env: { ...env, APP_UI_LANG: 'ko' }, executablePath: require('./app-executable.cjs')(root), args: [...(process.env.APP_TEST_SOURCE === '1' ? [root] : []), '--no-sandbox', '--ozone-platform=headless', '--disable-gpu', `--user-data-dir=${path.join(temp, 'profile')}`], timeout: 20000 });
    const p = await app.firstWindow(); p.setDefaultTimeout(20000); await p.setViewportSize({ width: 1300, height: 950 });
    p.on('pageerror', e => { console.error(e); process.exitCode = 1; });
    // Folders picked, and gates the test opens to hold a send at its start or before its writing.
    await app.evaluate(({ app, dialog }) => {
      globalThis.openQueue = []; dialog.showOpenDialog = async () => ({ canceled: false, filePaths: globalThis.openQueue.shift() });
      const t = process.getBuiltinModule('module').createRequire(app.getAppPath() + '/package.json')('./desktop/transfer.cjs'), run = t.runTransfer, collect = t.collectBundle;
      globalThis.hold = name => { let release; const promise = new Promise(r => { release = r; }); globalThis[name] = { promise, release }; };
      t.runTransfer = async (...args) => { if (globalThis.runGate) await globalThis.runGate.promise; return run(...args); };
      t.collectBundle = async (...args) => { if (globalThis.collectGate) await globalThis.collectGate.promise; return collect(...args); };
    });
    const release = name => app.evaluate((_, n) => { globalThis[n]?.release(); globalThis[n] = null; }, name);
    const vaultOf = async folder => JSON.parse(await fs.readFile(path.join(folder, appName.vaultDir, 'library.json'), 'utf8'));
    await app.evaluate((_, v) => globalThis.openQueue.push([v]), a); await p.locator('[data-action="storage"]').first().click();
    await p.locator('.paper-item').nth(4).waitFor();
    const paper = Object.fromEntries((await p.evaluate(() => papers.map(x => [x.title, x.id]))).map(([title, id]) => [names.find(n => title.includes(n)), id]));
    const vaultA = await p.evaluate(() => state.storageKey);
    const box = p.locator('#dialog .transfer-form');
    const openFor = async name => { await p.evaluate(() => { const t = document.querySelector('#toast'); if (t) { t.textContent = ''; t.classList.remove('show'); } }); await p.locator('.batch-bar [data-action="batch-clear"]').click().catch(() => {}); await p.locator(`[data-batch-paper="${paper[name]}"]`).check(); await p.locator('.batch-bar [data-action="batch-transfer"]').click(); await box.waitFor(); };
    const choose = async pattern => { const value = await p.evaluate(source => { const re = new RegExp(source), o = [...document.querySelectorAll('#transfer-target option')].find(x => re.test(x.textContent)); return o?.value; }, pattern.source); assert.ok(value, `an option ${pattern}`); await p.locator('#transfer-target').selectOption(value); await p.locator('#dialog [data-action="transfer-run"]:not([disabled])').waitFor(); return value; };
    const backToA = async () => { await p.evaluate(async id => applySnapshot(await window.appApi.openRecent(id)), vaultA); await p.waitForFunction(id => state.storageKey === id, vaultA); await p.locator('.paper-item').first().waitFor(); };

    // 1. "one" copied to B through a picked folder; then B copied to B2 and B2 opened once: two recent vaults, one id.
    await openFor('one'); await app.evaluate((_, v) => globalThis.openQueue.push([v]), b); await p.locator('#transfer-target').selectOption('__pick');
    await p.locator('#dialog [data-action="transfer-run"]:not([disabled])').click(); await p.locator('#toast').filter({ hasText: /복사했습니다/ }).waitFor();
    await fs.cp(b, b2, { recursive: true });
    await app.evaluate((_, v) => globalThis.openQueue.push([v]), b2); await p.evaluate(() => chooseDesktopStorage()); await p.waitForFunction(id => state.storageKey !== id, vaultA);
    await backToA();
    // 2. "two" to B (not B2): each recent vault is its own choice, told apart by where it is.
    await openFor('two');
    const texts = await p.locator('#transfer-target option').allTextContents();
    assert.ok(texts.some(t => /^B\b.*\S/.test(t) && t !== 'B') && texts.some(t => /^B2\b/.test(t)), `where each vault is, beside its name: ${texts.join(' | ')}`);
    await choose(/^B(?!2)/); await p.locator('#dialog [data-action="transfer-run"]').click(); await p.locator('#toast').filter({ hasText: /복사했습니다/ }).waitFor();
    assert.ok((await vaultOf(b)).papers.some(x => x.id === paper.two), 'B got it'); assert.ok(!(await vaultOf(b2)).papers.some(x => x.id === paper.two), 'B2 did not');
    // 3. Sent again: the notice names the paper skipped.
    await openFor('two'); await choose(/^B(?!2)/); await p.locator('#dialog [data-action="transfer-run"]').click();
    const title = await p.evaluate(id => papers.find(x => x.id === id).title, paper.two);
    await p.locator('#toast').filter({ hasText: title }).waitFor();
    // 4. A folder refused (this vault itself) leaves the dialog on the vault chosen before.
    await openFor('three'); const chosen = await choose(/^B(?!2)/);
    await app.evaluate((_, v) => globalThis.openQueue.push([v]), a); await p.locator('#transfer-target').selectOption('__pick');
    await p.waitForFunction(v => document.querySelector('#transfer-target').value === v, chosen);
    // 5. A move held before writing: Esc and × do not close it; a notebook window open on the vault is saved and closed.
    const notebook = await p.evaluate(async id => (await window.appApi.notebookCreate(state.storageKey, '창 노트', id)).id, paper.one);
    await p.evaluate(async ([id, nb]) => window.appApi.notebookWindow(state.storageKey, id, nb), [paper.one, notebook]);
    await p.waitForFunction(() => true); for (let i = 0; i < 50 && app.windows().length < 2; i++) await p.waitForTimeout(100);
    assert.equal(app.windows().length, 2, 'the notebook window is open');
    await app.evaluate(() => globalThis.hold('runGate'));
    await p.locator('[name="transfer-mode"][value="move"]').check(); await p.locator('#dialog [data-action="transfer-run"]').click(); await p.locator('#transfer-progress:not([hidden])').waitFor();
    await p.keyboard.press('Escape'); await p.waitForTimeout(300); assert.equal(await p.evaluate(() => dialog.open), true, 'Esc does not close a running send');
    await p.locator('#dialog [data-action="close"]').click({ force: true }).catch(() => {}); await p.waitForTimeout(300); assert.equal(await p.evaluate(() => dialog.open), true, '× does not close a running send');
    for (let i = 0; i < 50 && app.windows().length > 1; i++) await p.waitForTimeout(100);
    assert.equal(app.windows().length, 1, 'the notebook window was closed for the move');
    await release('runGate'); await p.locator('#toast').filter({ hasText: /옮겼습니다/ }).waitFor();
    assert.ok(!(await vaultOf(a)).papers.some(x => x.id === paper.three));
    // 6. 취소 right after 보내기, while the papers are still being read: nothing is sent or removed.
    await openFor('four'); await choose(/^B(?!2)/); await p.locator('[name="transfer-mode"][value="move"]').check();
    await app.evaluate(() => globalThis.hold('collectGate'));
    await p.locator('#dialog [data-action="transfer-run"]').click(); await p.locator('#dialog [data-action="transfer-close"]').click();
    await p.waitForTimeout(300); await release('collectGate');
    await p.locator('#toast').filter({ hasText: /취소/ }).waitFor();
    assert.ok((await vaultOf(a)).papers.some(x => x.id === paper.four), 'still here'); assert.ok(!(await vaultOf(b)).papers.some(x => x.id === paper.four), 'not there');
    await p.locator('#dialog [data-action="transfer-close"]').click().catch(() => {});
    // 7. A memo that cannot be saved stops the send.
    await p.evaluate(() => { globalThis.keptNotes = desktopNotes; desktopNotes = () => Promise.reject(Error('memo save failed')); });
    await openFor('five'); await choose(/^B(?!2)/); await p.locator('[name="transfer-mode"][value="move"]').check(); await p.locator('#dialog [data-action="transfer-run"]').click();
    await p.locator('#toast').filter({ hasText: /memo save failed|메모/ }).waitFor();
    assert.ok((await vaultOf(a)).papers.some(x => x.id === paper.five)); assert.ok(!(await vaultOf(b)).papers.some(x => x.id === paper.five));
    await p.evaluate(() => { desktopNotes = globalThis.keptNotes; }); await p.locator('#dialog [data-action="transfer-close"]').click().catch(() => {});
    // 8. 열기 right after a memo is typed: the memo is saved in this vault before the other opens.
    await openFor('four'); await choose(/^B(?!2)/); await p.locator('#dialog [data-action="transfer-run"]').click(); await p.locator('#toast [data-transfer-open]').waitFor();
    await p.evaluate(id => { const key = `${id}-메모`; notes[key] = '열기 직전 메모'; noteEdited(key, notes[key]); }, paper.five);
    await p.locator('#toast [data-transfer-open]').click(); await p.waitForFunction(id => state.storageKey !== id, vaultA);
    assert.equal((await vaultOf(a)).notes[`${paper.five}-메모`], '열기 직전 메모');
    console.log('Transfer guard smoke passed: two vaults of one id told apart and each sent to, skipped papers named, a refused folder leaves the choice, a running move cannot be closed and closes notebook windows, 취소 heard at once, a memo that cannot be saved stops the send, 열기 saves first.');
  } catch (error) { console.error(error); process.exitCode = 1; try { await (await app?.firstWindow())?.screenshot({ path: path.join(os.tmpdir(), `${appName.id}-transfer-guard-failure.png`) }); } catch {} }
  finally { await app?.close().catch(() => {}); await fs.rm(temp, { recursive: true, force: true }); }
})();
