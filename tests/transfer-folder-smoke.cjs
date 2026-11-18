// End-to-end check of choosing where sent papers go in the receiving vault (desktop/transfer.js, transfer.cjs): two
// papers copied into a new folder "받은 자료" without the sending side's folders, seen in the receiving vault's file
// tree with their memo; then one into a folder already there with the folders kept, its sub-folders made.
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
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), `${appName.id}-transfer-folder-e2e-`)), a = path.join(temp, 'A'), b = path.join(temp, 'B');
  await fs.mkdir(path.join(a, '연구', '2024'), { recursive: true }); await fs.mkdir(b);
  for (const [file, text] of [['연구/2024/first.pdf', 'The first paper.'], ['연구/second.pdf', 'The second paper.'], ['연구/2024/third.pdf', 'The third paper.']]) {
    const doc = await PDFDocument.create(), font = await doc.embedFont(StandardFonts.Helvetica); doc.addPage([600, 800]).drawText(text, { x: 40, y: 740, size: 14, font });
    await fs.writeFile(path.join(a, ...file.split('/')), await doc.save());
  }
  const env = /utf-?8/i.test(process.env.LC_ALL || process.env.LANG || '') ? process.env : { ...process.env, LC_ALL: 'C.UTF-8', LANG: 'C.UTF-8' };
  let app;
  try {
    app = await electron.launch({ env: { ...env, APP_UI_LANG: 'ko' }, executablePath: require('./app-executable.cjs')(root), args: [...(process.env.APP_TEST_SOURCE === '1' ? [root] : []), '--no-sandbox', '--ozone-platform=headless', '--disable-gpu', `--user-data-dir=${path.join(temp, 'profile')}`], timeout: 20000 });
    const p = await app.firstWindow(); p.setDefaultTimeout(20000); await p.setViewportSize({ width: 1300, height: 950 });
    p.on('pageerror', e => { console.error(e); process.exitCode = 1; });
    await app.evaluate(({ dialog }) => { globalThis.openQueue = []; dialog.showOpenDialog = async () => ({ canceled: false, filePaths: globalThis.openQueue.shift() }); });
    const vaultOf = async folder => JSON.parse(await fs.readFile(path.join(folder, appName.vaultDir, 'library.json'), 'utf8'));
    await app.evaluate((_, v) => globalThis.openQueue.push([v]), a); await p.locator('[data-action="storage"]').first().click();
    await p.locator('.paper-item').nth(2).waitFor();
    const paper = Object.fromEntries((await p.evaluate(() => papers.map(x => [x.title, x.id]))).map(([title, id]) => [['first', 'second', 'third'].find(n => title.includes(n)), id]));
    const vaultA = await p.evaluate(() => state.storageKey);
    await p.evaluate(async id => { notes[`${id}-메모`] = '폴더로 보낸 메모'; await desktopNotes(); }, paper.first);
    const box = p.locator('#dialog .transfer-form'), toast = () => p.evaluate(() => { const t = document.querySelector('#toast'); if (t) { t.textContent = ''; t.classList.remove('show'); } });
    // 1. Two papers into a new folder, without the sending side's folders.
    for (const id of [paper.first, paper.second]) await p.locator(`[data-batch-paper="${id}"]`).check();
    await p.locator('.batch-bar [data-action="batch-transfer"]').click(); await box.waitFor();
    await app.evaluate((_, v) => globalThis.openQueue.push([v]), b); await p.locator('#transfer-target').selectOption('__pick');
    await p.locator('#transfer-folder:not([disabled])').waitFor();
    assert.deepEqual(await p.locator('#transfer-folder option').evaluateAll(o => o.map(x => x.value)), ['', '__new'], 'an empty folder: the top and a new folder');
    await p.locator('#transfer-folder').selectOption('__new'); await p.locator('#transfer-folder-name').fill('받은 자료');
    await p.locator('#transfer-keep').uncheck();
    await p.locator('#transfer-summary').filter({ hasText: '받은 자료' }).waitFor();
    await toast(); await p.locator('#dialog [data-action="transfer-run"]:not([disabled])').click(); await p.locator('#toast').filter({ hasText: /복사했습니다/ }).waitFor();
    let there = await vaultOf(b);
    assert.deepEqual(there.papers.map(x => x.attachments[0].path).sort(), ['받은 자료/first.pdf', '받은 자료/second.pdf']);
    for (const name of ['first.pdf', 'second.pdf']) await fs.access(path.join(b, '받은 자료', name));
    // Opened, the receiving vault shows the folder, its two PDFs and the memo.
    await p.locator('#toast [data-transfer-open]').click(); await p.waitForFunction(id => state.storageKey !== id && papers.length === 2, vaultA);
    await p.locator('.vault-row').filter({ hasText: '받은 자료' }).first().click(); await p.locator('.vault-file').filter({ hasText: 'first' }).first().waitFor();
    assert.equal(await p.locator('.vault-file').filter({ hasText: /first|second/ }).count(), 2, 'the two PDFs in the file tree');
    assert.equal(await p.evaluate(id => notes[`${id}-메모`], paper.first), '폴더로 보낸 메모');
    await p.evaluate(async id => applySnapshot(await window.appApi.openRecent(id)), vaultA); await p.waitForFunction(id => state.storageKey === id && papers.length === 3, vaultA);
    // 2. One into a folder already there, the sending side's folders kept: its sub-folders are made.
    await fs.mkdir(path.join(b, '기존'));
    await p.locator('.batch-bar [data-action="batch-clear"]').click().catch(() => {});
    await p.locator(`[data-batch-paper="${paper.third}"]`).check(); await p.locator('.batch-bar [data-action="batch-transfer"]').click(); await box.waitFor();
    const bValue = await p.evaluate(() => [...document.querySelectorAll('#transfer-target option')].find(o => /^B \(/.test(o.textContent))?.value); await p.locator('#transfer-target').selectOption(bValue);
    await p.waitForFunction(() => [...document.querySelectorAll('#transfer-folder option')].some(o => o.value === '기존'));
    assert.ok((await p.locator('#transfer-folder option').evaluateAll(o => o.map(x => x.value))).includes('받은 자료'), 'the folder made before is listed');
    await p.locator('#transfer-folder').selectOption('기존'); await p.locator('#transfer-keep').check();
    await p.locator('#transfer-summary').filter({ hasText: '기존' }).waitFor();
    await toast(); await p.locator('#dialog [data-action="transfer-run"]:not([disabled])').click(); await p.locator('#toast').filter({ hasText: /복사했습니다/ }).waitFor();
    there = await vaultOf(b);
    assert.equal(there.papers.find(x => x.id === paper.third).attachments[0].path, '기존/연구/2024/third.pdf');
    await fs.access(path.join(b, '기존', '연구', '2024', 'third.pdf'));
    await app.close(); app = null;
    console.log('Transfer folder smoke passed: two papers into a new folder without the sending folders, seen in the receiving vault with their memo; one into a folder there with its folders kept.');
  } catch (error) { console.error(error); process.exitCode = 1; try { await (await app?.firstWindow())?.screenshot({ path: path.join(os.tmpdir(), `${appName.id}-transfer-folder-failure.png`) }); } catch {} }
  finally { await app?.close().catch(() => {}); await fs.rm(temp, { recursive: true, force: true }); }
})();
