// End-to-end check in the real Electron app (APP_TEST_SOURCE=1 runs the source): PDFs and
// folders changed outside the app appear in the list and the file tree by themselves; the view is
// kept; an open dialog or the reader is not interrupted and the change arrives afterwards; the
// app's own import asks for no extra reading; "파일 목록 새로고침" still works.
const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { PDFDocument, StandardFonts } = require('pdf-lib');
const appName = require('../core/app-name.cjs');
const root = path.resolve(__dirname, '..');
(async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), `${appName.id}-watch-e2e-`)), vault = path.join(temp, 'vault'), outside = path.join(temp, 'outside'); await fs.mkdir(vault); await fs.mkdir(outside);
  const make = async (file, text) => { const doc = await PDFDocument.create(), font = await doc.embedFont(StandardFonts.Helvetica); doc.addPage([600, 800]).drawText(text, { x: 40, y: 740, size: 12, font }); await fs.writeFile(file, await doc.save({ useObjectStreams: false })); };
  await make(path.join(vault, 'first.pdf'), 'The first paper.'); for (const name of ['dropped', 'busy', 'second', 'third', 'own']) await make(path.join(outside, name + '.pdf'), 'Paper ' + name + '.');
  const executable = require('./app-executable.cjs')(root);
  let app;
  try {
    app = await electron.launch({ executablePath: executable, args: [...(process.env.APP_TEST_SOURCE === '1' ? [root] : []), '--no-sandbox', '--ozone-platform=headless', '--disable-gpu', `--user-data-dir=${path.join(temp, 'profile')}`], timeout: 20000 });
    const p = await app.firstWindow(); p.setDefaultTimeout(15000);
    p.on('pageerror', e => { console.error(e); process.exitCode = 1; });
    await app.evaluate(({ dialog }) => { globalThis.openQueue = []; dialog.showOpenDialog = async () => ({ canceled: false, filePaths: globalThis.openQueue.shift() }); });
    const open = paths => app.evaluate((_, paths) => globalThis.openQueue.push(paths), paths);
    await open([vault]); await p.locator('[data-action="storage"]').first().click(); await p.locator('.paper-item').first().waitFor();
    // How often the main process tells the page that files changed.
    await app.evaluate(({ BrowserWindow }) => { globalThis.told = 0; const contents = BrowserWindow.getAllWindows()[0].webContents, send = contents.send.bind(contents); contents.send = (channel, ...args) => { if (channel === 'vault-files-changed') globalThis.told++; return send(channel, ...args); }; });
    const told = () => app.evaluate(() => globalThis.told);
    const titles = () => p.evaluate(() => papers.map(x => x.title).sort()), has = title => p.waitForFunction(title => papers.some(x => x.title === title), title);

    // A PDF copied in from outside appears by itself, in the list and in the file tree.
    await fs.copyFile(path.join(outside, 'dropped.pdf'), path.join(vault, 'dropped.pdf')); await has('dropped');
    await p.locator('.paper-item').filter({ hasText: 'dropped' }).waitFor(); await p.locator('.vault-file').filter({ hasText: 'dropped.pdf' }).waitFor();
    assert.equal(await p.evaluate(() => state.screen), 'library');

    // The reader goes on working right after the outside change (an edit that answers with a snapshot,
    // coming back to the window): the change still arrives.
    await fs.copyFile(path.join(outside, 'busy.pdf'), path.join(vault, 'busy.pdf'));
    await p.evaluate(async () => { const id = state.storageKey, paper = papers[0].id; for (let i = 0; i < 6; i++) { await window.appApi.batchUpdate(id, [paper], { status: i % 2 ? '읽기 전' : '읽는 중' }); await new Promise(r => setTimeout(r, 250)); } window.dispatchEvent(new Event('focus')); });
    await has('busy');

    // A folder made outside with a PDF in it; the search the reader typed stays.
    await p.evaluate(() => { state.query = 'first'; render(); });
    await fs.mkdir(path.join(vault, 'box')); await fs.copyFile(path.join(outside, 'second.pdf'), path.join(vault, 'box', 'second.pdf')); await has('second');
    assert.equal(await p.evaluate(() => state.query), 'first'); assert.ok(await p.evaluate(() => vaultFolders.includes('box')));
    await p.evaluate(() => { state.query = ''; render(); });

    // An open dialog is not closed: the change arrives once it is.
    await p.evaluate(() => modal('작업 중', '<p>dialog</p>', btn('닫기', 'close')));
    await fs.copyFile(path.join(outside, 'third.pdf'), path.join(vault, 'third.pdf')); await p.waitForTimeout(3500);
    assert.ok(await p.locator('dialog[open]').isVisible()); assert.ok(!(await titles()).includes('third'));
    await p.locator('dialog[open] button.secondary[data-action="close"]').click(); await has('third');

    // A file removed outside is no longer offered as readable.
    await fs.rm(path.join(vault, 'dropped.pdf')); await p.waitForFunction(() => !fullPdfs.get(papers.find(x => x.title === 'dropped')?.id)?.original);

    // The app's own import: the list is already right, so nothing is drawn again for it.
    await p.waitForTimeout(2500); assert.ok(await told() >= 5, 'each outside change was told');
    await open([path.join(outside, 'own.pdf')]); await p.locator('[data-action="add-files"]').first().click(); await has('own'); await p.locator('.paper-item').filter({ hasText: 'own' }).waitFor();
    await p.evaluate(() => { document.querySelector('#paper-list').dataset.kept = '1'; }); await p.waitForTimeout(4000);
    assert.equal(await p.evaluate(() => document.querySelector('#paper-list')?.dataset.kept), '1', 'the list was drawn again after the app\'s own import');

    // 파일 목록 새로고침 is still there and works.
    await p.locator('[data-action="refresh-vault"]').first().waitFor(); await p.evaluate(() => actions['refresh-vault']()); await p.locator('.paper-item').first().waitFor();
    console.log('vault watch smoke passed');
  } finally { await app?.close().catch(() => {}); await fs.rm(temp, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exit(1); });
