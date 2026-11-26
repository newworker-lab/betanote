// End-to-end check, in the real Electron app (APP_TEST_SOURCE=1 runs from source), of selecting
// several papers or files as in a file manager and moving them: Ctrl+click, Shift+click, Ctrl+A and
// Esc in the list and in the file tree, the list's 폴더로 이동…, dragging several selected files,
// the tree's right-click move, and undo.
const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { PDFDocument, StandardFonts } = require('pdf-lib');
const appName = require('../core/app-name.cjs');
const root = path.resolve(__dirname, '..');
async function samplePdf(file, text) { const doc = await PDFDocument.create(), font = await doc.embedFont(StandardFonts.Helvetica); doc.addPage([600, 800]).drawText(text, { x: 40, y: 740, size: 12, font }); await fs.writeFile(file, await doc.save()); }
(async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), `${appName.id}-multi-select-`)), vault = path.join(temp, 'vault'), names = ['a', 'b', 'c', 'd'];
  await fs.mkdir(vault);
  for (const name of names) await samplePdf(path.join(temp, name + '.pdf'), 'Paper ' + name);
  const executable = require('./app-executable.cjs')(root);
  const env = /utf-?8/i.test(process.env.LC_ALL || process.env.LANG || '') ? process.env : { ...process.env, LC_ALL: 'C.UTF-8', LANG: 'C.UTF-8' };
  const app = await electron.launch({ env, executablePath: executable, args: [...(process.env.APP_TEST_SOURCE === '1' ? [root] : []), '--no-sandbox', '--ozone-platform=headless', '--disable-gpu', `--user-data-dir=${path.join(temp, 'profile')}`], timeout: 20000 });
  try {
    const p = await app.firstWindow(); p.setDefaultTimeout(15000);
    p.on('pageerror', e => { console.error(e); process.exitCode = 1; }); p.on('console', m => { if (m.type() === 'error') { console.error('renderer:', m.text()); process.exitCode = 1; } });
    await app.evaluate(({ dialog, BrowserWindow }) => { globalThis.openQueue = []; dialog.showOpenDialog = async () => ({ canceled: false, filePaths: globalThis.openQueue.shift() }); BrowserWindow.getAllWindows()[0].setSize(1280, 900); });
    const open = paths => app.evaluate((_, paths) => globalThis.openQueue.push(paths), paths);
    await open([vault]); await p.locator('[data-action="storage"]').first().click(); await p.locator('.library').waitFor();
    await open(names.map(n => path.join(temp, n + '.pdf'))); await p.locator('[data-action="add-files"]').first().click();
    await p.waitForFunction(() => papers.length === 4);
    await fs.mkdir(path.join(vault, 'box')); await p.locator('[data-action="refresh-vault"]').first().click(); await p.locator('[data-folder-drop="box"]').waitFor();
    const rows = p.locator('#paper-list .paper-item'), selection = () => p.evaluate(() => [...batchSelection].sort((a, b) => a - b));
    const rowIds = await rows.evaluateAll(list => list.map(el => Number(el.dataset.paper)));
    const onDisk = async folder => (await fs.readdir(path.join(vault, folder))).filter(f => f.endsWith('.pdf')).sort();

    // List: Ctrl+click selects without opening; Shift+click selects the range from the last one.
    await rows.nth(0).click({ modifiers: ['Control'] }); await rows.nth(2).click({ modifiers: ['Control'] });
    assert.equal(await p.evaluate(() => state.screen), 'library');
    assert.deepEqual(await selection(), [rowIds[0], rowIds[2]].sort((a, b) => a - b));
    await p.locator('.batch-bar').filter({ hasText: '2개 선택' }).waitFor();
    assert.equal(await p.locator('[data-batch-paper]:checked').count(), 2);
    await rows.nth(2).click({ modifiers: ['Control'] }); assert.deepEqual(await selection(), [rowIds[0]]);
    // The anchor is the last Ctrl+clicked row (here the one just unselected), as in a file manager.
    await rows.nth(3).click({ modifiers: ['Shift'] }); assert.deepEqual(await selection(), rowIds.slice(2, 4).sort((a, b) => a - b), 'Shift+click replaces the selection with the range');
    await rows.nth(0).click({ modifiers: ['Control', 'Shift'] }); assert.deepEqual(await selection(), [...rowIds].sort((a, b) => a - b), 'Ctrl+Shift+click adds the range');
    // Esc clears it; Ctrl+A selects the whole list.
    await rows.nth(1).focus(); await p.keyboard.press('Escape'); assert.deepEqual(await selection(), []);
    assert.equal(await p.locator('.batch-bar:not([hidden])').count(), 0);
    await rows.nth(0).focus(); await p.keyboard.press('ControlOrMeta+a'); assert.equal((await selection()).length, 4);

    // 폴더로 이동… moves every selected paper's PDF; undo puts them back.
    await rows.nth(3).click({ modifiers: ['Control'] }); await rows.nth(2).click({ modifiers: ['Control'] });
    await p.locator('.batch-bar [data-action="batch-move"]').click();
    await p.locator('#batch-move-folder').selectOption('box'); await p.locator('#dialog [data-action="confirm-batch-move"]').click();
    await p.locator('.undo-toast').filter({ hasText: '파일 2개를 “box”로 옮겼습니다' }).waitFor();
    assert.equal(await onDisk('box').then(list => list.length), 2); assert.equal(await onDisk('.').then(list => list.length), 2);
    await p.locator('.undo-toast button').click(); await p.locator('#toast').filter({ hasText: '원래 폴더로 되돌렸습니다' }).waitFor();
    assert.deepEqual(await onDisk('box'), []); assert.equal(await onDisk('.').then(list => list.length), 4);
    await p.locator('.batch-bar [data-action="batch-clear"]').click();

    // File tree: Ctrl+click marks files without opening them; dragging one of them moves all.
    const files = p.locator('.vault-file[data-tree-file]');
    await files.nth(0).click({ modifiers: ['Control'] }); await files.nth(1).click({ modifiers: ['Control'] });
    assert.equal(await p.evaluate(() => state.screen), 'library');
    assert.equal(await p.locator('.vault-file.multi-selected[aria-selected="true"]').count(), 2);
    await files.nth(1).dragTo(p.locator('[data-folder-drop="box"]'));
    await p.locator('.undo-toast').filter({ hasText: '파일 2개를 “box”로 옮겼습니다' }).waitFor();
    assert.equal(await onDisk('box').then(list => list.length), 2);
    // The marks survive the redrawn tree; Esc clears them.
    await p.locator('.vault-file.multi-selected').first().waitFor(); assert.equal(await p.locator('.vault-file.multi-selected').count(), 2);
    await p.locator('.vault-file.multi-selected').first().focus(); await p.keyboard.press('Escape');
    assert.equal(await p.locator('.vault-file.multi-selected').count(), 0);

    // Shift+click selects a range of the tree; the right-click menu moves the selection.
    const ordered = () => p.locator('.vault-file[data-tree-file]');
    await ordered().nth(0).click({ modifiers: ['Control'] }); await ordered().nth(3).click({ modifiers: ['Shift'] });
    assert.equal(await p.locator('.vault-file.multi-selected').count(), 4);
    await ordered().nth(2).click({ button: 'right' }); await p.locator('.pop-menu [data-action="tree-move"]').filter({ hasText: '선택한 파일 4개 이동' }).click();
    await p.locator('#batch-move-folder').selectOption(''); await p.locator('#dialog [data-action="confirm-batch-move"]').click();
    await p.locator('.undo-toast').filter({ hasText: '파일 2개를 저장소 맨 위로 옮겼습니다' }).waitFor();
    assert.deepEqual(await onDisk('box'), []); assert.equal(await onDisk('.').then(list => list.length), 4);
    // With one file selected the right-click menu is the file's own.
    await ordered().nth(0).click(); await ordered().nth(0).click({ button: 'right' });
    await p.locator('.pop-menu [data-move-attachment]').waitFor(); assert.equal(await p.locator('.pop-menu [data-action="tree-move"]').count(), 0);
    await p.keyboard.press('Escape');

    // A plain click still opens the paper.
    await p.locator('[data-nav="전체 자료"]').click(); await rows.nth(0).click();
    await p.waitForFunction(() => state.screen === 'reader');

    // 삭제…: the selected items go to the vault's trash (files stay) or are deleted with their files.
    await p.locator('.reader-back, [data-nav="전체 자료"]').first().click().catch(() => {}); await p.evaluate(() => { if (state.screen !== 'library') actions.library?.(); });
    await p.locator('[data-nav="전체 자료"]').click(); await rows.first().waitFor();
    await app.evaluate(({ shell }) => { shell.trashItem = async file => process.getBuiltinModule('node:fs/promises').rm(file); });
    const total = await p.evaluate(() => papers.length), pdfs = async () => (await fs.readdir(vault, { recursive: true })).filter(f => /\.pdf$/i.test(f)).length, before = await pdfs();
    await p.locator('[data-batch-paper]').nth(0).check(); await p.locator('[data-batch-paper]').nth(1).check();
    assert.deepEqual(await p.locator('.batch-bar .batch-group').evaluateAll(list => list.map(g => g.getAttribute('aria-label')).filter(Boolean)), ['파일', '분류', '서지', 'AI']);
    await p.locator('.batch-bar [data-action="batch-delete"]').click(); await p.locator('#dialog h2').filter({ hasText: '자료 2개 삭제' }).waitFor();
    await p.locator('#dialog [data-action="confirm-batch-trash"]').click(); await p.locator('#toast').filter({ hasText: '2개 자료를 휴지통으로 옮겼습니다' }).waitFor();
    assert.equal(await p.evaluate(() => papers.length), total - 2); assert.equal(await pdfs(), before); assert.equal(await p.locator('.batch-bar:not([hidden])').count(), 0);
    await p.locator('[data-batch-paper]').nth(0).check();
    await p.locator('.batch-bar [data-action="batch-delete"]').click(); await p.locator('#dialog [data-action="confirm-batch-delete"]').click();
    await p.locator('#toast').filter({ hasText: '1개 자료를 삭제했습니다' }).waitFor();
    assert.equal(await p.evaluate(() => papers.length), total - 3); assert.equal(await pdfs(), before - 1);
    console.log('PASS multi-select: 삭제… (휴지통으로 이동 / 파일까지 삭제), Ctrl/Shift+click, Ctrl+A and Esc in the list and the file tree, 폴더로 이동…, multi-file drag, tree right-click move, undo, plain click opens');
  } finally {
    await app.close().catch(() => {});
    await fs.rm(temp, { recursive: true, force: true, maxRetries: 5 }).catch(error => console.warn('임시 폴더를 지우지 못했습니다:', error.message));
  }
})().catch(error => { console.error(error); process.exit(1); });
