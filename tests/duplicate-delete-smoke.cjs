// End-to-end check in the real Electron app (APP_TEST_SOURCE=1 runs the source): adding a PDF
// the vault already has asks first; merging two items with the same PDF leaves one attachment
// and the further reading status; deleting an item removes its PDF from the vault folder.
const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { PDFDocument, StandardFonts } = require('pdf-lib');
const appName = require('../core/app-name.cjs');
const root = path.resolve(__dirname, '..');
(async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), `${appName.id}-dup-e2e-`)), vault = path.join(temp, 'vault'), outside = path.join(temp, 'outside'); await fs.mkdir(vault); await fs.mkdir(outside);
  const make = async (file, text) => { const doc = await PDFDocument.create(), font = await doc.embedFont(StandardFonts.Helvetica); doc.addPage([600, 800]).drawText(text, { x: 40, y: 740, size: 12, font }); await fs.writeFile(file, await doc.save({ useObjectStreams: false })); };
  await make(path.join(vault, 'first.pdf'), 'The first paper.'); await make(path.join(outside, 'new.pdf'), 'A new paper.');
  await fs.copyFile(path.join(vault, 'first.pdf'), path.join(outside, 'first-again.pdf'));
  const executable = require('./app-executable.cjs')(root);
  let app;
  try {
    app = await electron.launch({ executablePath: executable, args: [...(process.env.APP_TEST_SOURCE === '1' ? [root] : []), '--no-sandbox', '--ozone-platform=headless', '--disable-gpu', `--user-data-dir=${path.join(temp, 'profile')}`], timeout: 20000 });
    const p = await app.firstWindow(); p.setDefaultTimeout(15000);
    p.on('pageerror', e => { console.error(e); process.exitCode = 1; }); p.on('console', m => { if (m.type() === 'error') console.error('renderer:', m.text()); });
    await app.evaluate(({ dialog, shell }) => {
      globalThis.openQueue = []; dialog.showOpenDialog = async () => ({ canceled: false, filePaths: globalThis.openQueue.shift() });
      // The computer's trash is recorded, then the file is removed as the trash would.
      globalThis.trashed = []; shell.trashItem = async file => { globalThis.trashed.push(file); await process.getBuiltinModule('node:fs/promises').rm(file); };
    });
    const open = paths => app.evaluate((_, paths) => globalThis.openQueue.push(paths), paths);
    const titles = () => p.evaluate(() => papers.map(x => x.title).sort());
    await open([vault]); await p.locator('[data-action="storage"]').first().click(); await p.locator('.paper-item').waitFor();

    // Adding a new file and a copy of one the vault has: the new one is added, the copy is asked about.
    await open([path.join(outside, 'new.pdf'), path.join(outside, 'first-again.pdf')]); await p.locator('[data-action="add-files"]').first().click();
    await p.locator('#dialog h2').filter({ hasText: '이미 있는 자료입니다' }).waitFor();
    assert.match(await p.locator('#dialog').textContent(), /나머지 1개는 추가했습니다[\s\S]*first-again\.pdf[\s\S]*기존 자료: first/);
    assert.deepEqual(await titles(), ['first', 'new']);
    // 기존 자료 열기 goes to the item that has it and adds nothing.
    await p.locator('#dialog [data-open-known]').click(); await p.waitForFunction(() => state.screen === 'reader' && selected()?.title === 'first');
    assert.deepEqual(await titles(), ['first', 'new']);
    await p.locator('[data-action="back"]').first().click(); await p.locator('.paper-item').first().waitFor();
    // 그래도 추가 adds the copy as its own item.
    await open([path.join(outside, 'first-again.pdf')]); await p.locator('[data-action="add-files"]').first().click();
    await p.locator('#dialog [data-action="known-copies-add"]').click(); await p.waitForFunction(() => papers.length === 3);
    assert.deepEqual(await titles(), ['first', 'first-again', 'new']);

    // Merge the two items that hold the same PDF: one attachment stays, and the status follows the further side.
    const ids = await p.evaluate(() => Object.fromEntries(papers.map(x => [x.title, x.id])));
    await p.evaluate(async id => { applyItemSnapshot(await window.appApi.updatePaper(state.storageKey, id, { status: '완독' }) || await window.appApi.refreshStorage(state.storageKey)); }, ids['first-again']);
    const merged = await p.evaluate(async ([a, b]) => { const snapshot = await window.appApi.mergePapers(state.storageKey, a, b); applyItemSnapshot(snapshot, { paperId: a, screen: 'library' }); return { report: snapshot.mergeReport, paper: snapshot.papers.find(x => x.id === a), removed: snapshot.trashAttachments.length }; }, [ids.first, ids['first-again']]);
    assert.deepEqual(merged.report, { removed: 1, keptBoth: 0 }); assert.equal(merged.paper.status, '완독'); assert.equal(merged.paper.attachments.length, 1); assert.equal(merged.removed, 1);

    // The copy left out waits in 제거한 첨부; deleting it there removes its file.
    await p.locator('[data-action="vault-manager"]').click(); await p.locator('#dialog [data-delete-attachment]').first().waitFor({ state: 'attached' });
    await p.evaluate(() => document.querySelector('#dialog [data-delete-attachment]').click());
    await p.locator('#dialog h2').filter({ hasText: '첨부 삭제' }).waitFor(); await p.locator('#dialog [data-action="confirm-delete"]').click();
    await p.waitForFunction(() => vaultTrashAttachments.length === 0);
    const names = async () => (await fs.readdir(vault, { recursive: true })).filter(n => /\.pdf$/.test(n)).map(n => path.basename(n)).sort();
    assert.deepEqual(await names(), ['first.pdf', 'new.pdf']);
    // The manager comes back with the list as it now is; close it before going on.
    await p.locator('#dialog h2').filter({ hasText: '저장소 관리' }).waitFor(); await p.locator('#toast.show').filter({ hasText: '삭제했습니다' }).waitFor();
    await p.locator('#dialog [data-action="close"]').first().click(); await p.waitForFunction(() => !document.querySelector('#dialog').open);

    // Delete an item from its menu: the dialog says what goes, and the PDF leaves the folder.
    await p.locator(`.paper-item[data-paper="${ids.new}"]`).click(); await p.locator(`[data-item-menu="${ids.new}"]`).first().click(); await p.locator(`[data-delete-paper="${ids.new}"]`).click();
    await p.locator('#dialog h2').filter({ hasText: '자료 삭제' }).waitFor();
    assert.match(await p.locator('#dialog').textContent(), /new[\s\S]*PDF 파일[\s\S]*휴지통[\s\S]*되살릴 수 없습니다/);
    assert.deepEqual(await names(), ['first.pdf', 'new.pdf'], 'nothing is removed before the confirmation');
    await p.locator('#dialog [data-action="confirm-delete"]').click(); await p.waitForFunction(() => papers.length === 1);
    assert.deepEqual(await names(), ['first.pdf']); assert.deepEqual(await titles(), ['first']);
    assert.equal((await app.evaluate(() => globalThis.trashed)).length, 2, 'both PDFs went to the computer\'s trash');
    // After a refresh (a new scan of the folder) nothing comes back.
    await p.evaluate(async () => applyItemSnapshot(await window.appApi.refreshStorage(state.storageKey))); assert.deepEqual(await titles(), ['first']);

    // 폴더 삭제…: a folder with a PDF and a folder inside goes with what it holds; the rest stays.
    await fs.mkdir(path.join(vault, 'box', 'inner'), { recursive: true }); await make(path.join(vault, 'box', 'boxed.pdf'), 'A boxed paper.'); await make(path.join(vault, 'box', 'inner', 'deep.pdf'), 'A deep paper.');
    await p.evaluate(async () => applyItemSnapshot(await window.appApi.refreshStorage(state.storageKey))); assert.deepEqual(await titles(), ['boxed', 'deep', 'first']);
    await p.locator('[data-folder-menu="box"]').click(); assert.deepEqual(await p.locator('.pop-menu [role="menuitem"]').allInnerTexts().then(list => list.slice(0, 2).concat(list.at(-1))), ['이름 바꾸기', '새 하위 폴더', '폴더 삭제…']);
    await p.locator('.pop-menu [data-folder-delete="box"]').click(); await p.locator('#dialog h2').filter({ hasText: '폴더 삭제' }).waitFor();
    assert.match(await p.locator('#dialog').innerText(), /box 폴더를 삭제합니다[\s\S]*PDF 2개를 지웁니다[\s\S]*자료 2개가 목록에서 사라지고[\s\S]*안의 폴더 1개도 함께/);
    // 취소 changes nothing.
    await p.locator('#dialog button.secondary[data-action="close"]').click(); assert.deepEqual(await titles(), ['boxed', 'deep', 'first']); await fs.access(path.join(vault, 'box', 'boxed.pdf'));
    await p.locator('[data-folder-menu="box"]').click(); await p.locator('.pop-menu [data-folder-delete="box"]').click(); await p.locator('#dialog [data-action="confirm-folder-delete"]').click();
    await p.locator('#toast').filter({ hasText: '“box” 폴더를 삭제했습니다. PDF 2개를 지웠습니다.' }).waitFor();
    assert.deepEqual(await titles(), ['first']); await assert.rejects(fs.access(path.join(vault, 'box'))); assert.equal(await p.locator('[data-folder-menu="box"]').count(), 0); assert.deepEqual(await names(), ['first.pdf']);
    // The vault's own top folder offers no deletion.
    assert.equal(await p.evaluate(() => folderMenu('').includes('data-folder-delete')), false);
    console.log('Duplicate and delete smoke passed: known copy asked about, open existing, add anyway, merge to one attachment with the further status, delete with files, folder deletion.');
  } catch (error) { try { await (await app.firstWindow()).screenshot({ path: path.join(os.tmpdir(), `${appName.id}-dup-failure.png`) }); } catch {} throw error; }
  finally { await app?.close().catch(() => {}); await fs.rm(temp, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exit(1); });
