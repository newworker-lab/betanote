// End-to-end check of copying and moving papers to another vault in the real app (desktop/transfer.js and .cjs): two
// papers copied (a memo typed just before goes too) to an empty folder picked in the dialog, opened there with their memo,
// annotation, ink and notebook; sent again (both already there: skipped, nothing changes); one moved (gone from the
// first vault, in the other); the whole vault copied from the vault manager; a receiving vault in use elsewhere refused
// with nothing changed; the dialog in English at 800px. APP_TEST_SOURCE=1 runs the source.
const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { PDFDocument, StandardFonts } = require('pdf-lib');
const appName = require('../core/app-name.cjs');
const root = path.resolve(__dirname, '..');
(async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), `${appName.id}-transfer-e2e-`)), a = path.join(temp, 'A'), b = path.join(temp, 'B'); await fs.mkdir(a); await fs.mkdir(b);
  for (const [name, text] of [['first.pdf', 'The first paper.'], ['second.pdf', 'The second paper.'], ['third.pdf', 'The third paper.']]) {
    const doc = await PDFDocument.create(), font = await doc.embedFont(StandardFonts.Helvetica); doc.addPage([600, 800]).drawText(text, { x: 40, y: 740, size: 14, font });
    await fs.writeFile(path.join(a, name), await doc.save());
  }
  const env = /utf-?8/i.test(process.env.LC_ALL || process.env.LANG || '') ? process.env : { ...process.env, LC_ALL: 'C.UTF-8', LANG: 'C.UTF-8' };
  let app;
  const launch = async (lang = 'ko') => {
    app = await electron.launch({ env: { ...env, APP_UI_LANG: lang }, executablePath: require('./app-executable.cjs')(root), args: [...(process.env.APP_TEST_SOURCE === '1' ? [root] : []), '--no-sandbox', '--ozone-platform=headless', '--disable-gpu', `--user-data-dir=${path.join(temp, 'profile')}`], timeout: 20000 });
    const p = await app.firstWindow(); p.setDefaultTimeout(20000); await p.setViewportSize({ width: 1300, height: 950 });
    p.on('pageerror', e => { console.error(e); process.exitCode = 1; }); p.on('console', m => { if (m.type() === 'error') { console.error('renderer:', m.text()); process.exitCode = 1; } });
    await app.evaluate(({ dialog }) => { globalThis.openQueue = []; dialog.showOpenDialog = async () => ({ canceled: false, filePaths: globalThis.openQueue.shift() }); });
    return p;
  };
  // The receiving vault B in the list (its name, then where it is).
  const pickB = async page => { const value = await page.evaluate(() => [...document.querySelectorAll('#transfer-target option')].find(o => /^B \(/.test(o.textContent))?.value); assert.ok(value, 'B is in the list'); await page.locator('#transfer-target').selectOption(value); };
  const vaultOf = async folder => JSON.parse(await fs.readFile(path.join(folder, appName.vaultDir, 'library.json'), 'utf8'));
  const tree = async folder => { const out = {}; for (const name of (await fs.readdir(folder, { recursive: true })).sort()) { if (name.split(path.sep).includes('backups')) continue; const file = path.join(folder, name); if ((await fs.lstat(file)).isFile()) out[name] = crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex'); } return out; };
  try {
    let p = await launch();
    await app.evaluate((_, v) => globalThis.openQueue.push([v]), a); await p.locator('[data-action="storage"]').first().click();
    await p.locator('.paper-item').nth(2).waitFor();
    // Ink, an annotation-like memo and a notebook on the first paper; then a memo typed just before sending.
    const ids = await p.evaluate(() => papers.map(x => ({ id: x.id, title: x.title })).sort((x, y) => x.title.localeCompare(y.title)));
    const [first, second, third] = ids;
    await p.locator('.paper-item', { hasText: first.title }).click(); await p.locator('.original-pages .page[data-page="1"] .textLayer span').first().waitFor();
    const page = await p.locator('.original-pages .page[data-page="1"]').boundingBox();
    await p.locator('[data-ink-tool="pen"]').click(); await p.mouse.move(page.x + 100, page.y + 200); await p.mouse.down(); await p.mouse.move(page.x + 220, page.y + 260, { steps: 8 }); await p.mouse.up();
    await p.locator('.ink-status[data-state="saved"]').waitFor({ state: 'attached' }); await p.locator('[data-ink-tool="read"]').click();
    await p.locator('[data-mode="notebook"]').click(); await p.locator('.notebook-pane [data-action="nb-new"]').first().click();
    await p.locator('#nb-title').fill('보낼 노트'); await p.locator('#dialog [data-action="nb-create"]').click(); await p.locator('.nb-page').first().waitFor();
    await p.locator('[data-mode="original"]').click();
    await p.locator('[data-action="back"]').click(); await p.locator('.paper-item').nth(2).waitFor();
    const memo = '보내기 직전에 쓴 메모';
    await p.evaluate(async ([id, text]) => { notes[`${id}-메모`] = text; await desktopNotes(); }, [first.id, memo]);
    // 1. Two papers checked, 다른 저장소로… → 폴더 선택… → B, copy.
    for (const x of [first, second]) await p.locator(`[data-batch-paper="${x.id}"]`).check();
    await p.locator('.batch-bar [data-action="batch-transfer"]').click(); const box = p.locator('#dialog .transfer-form'); await box.waitFor();
    await app.evaluate((_, v) => globalThis.openQueue.push([v]), b); await p.locator('#transfer-target').selectOption('__pick');
    await p.locator('#transfer-summary').filter({ hasText: '자료 2편' }).waitFor();
    await p.locator('#dialog [data-action="transfer-run"]').click();
    await p.locator('#toast').filter({ hasText: /2편.*복사했습니다/ }).waitFor();
    let there = await vaultOf(b);
    assert.deepEqual(there.papers.map(x => x.id).sort(), [first.id, second.id].sort());
    assert.equal(there.notes[`${first.id}-메모`], memo, 'the memo typed just before went too');
    const att = there.papers.find(x => x.id === first.id).primaryAttachmentId; await fs.access(path.join(b, appName.vaultDir, 'ink', att));
    const notebooks = (await fs.readdir(path.join(b, appName.vaultDir, 'notebooks'))).filter(n => n.endsWith('.json')); assert.equal(notebooks.length, 1);
    // The notice's 열기 opens B: the two papers, the memo typed just before and the notebook are there; then back to A.
    const vaultA = await p.evaluate(() => state.storageKey);
    await p.locator('#toast [data-transfer-open]').click(); await p.waitForFunction(id => state.storageKey !== id && papers.length === 2, vaultA);
    assert.equal(await p.evaluate(id => notes[`${id}-메모`], first.id), memo);
    assert.deepEqual((await p.evaluate(() => window.appApi.notebookList(state.storageKey))).map(n => n.title), ['보낼 노트']);
    await p.evaluate(async id => applySnapshot(await window.appApi.openRecent(id)), vaultA); await p.waitForFunction(id => state.storageKey === id && papers.length === 3, vaultA);
    for (const x of [first, second]) if (!await p.locator(`[data-batch-paper="${x.id}"]`).isChecked()) await p.locator(`[data-batch-paper="${x.id}"]`).check();
    // 2. The same two again: both already there, skipped by default; B is as it was.
    const before = await tree(b);
    await p.locator('.batch-bar [data-action="batch-transfer"]').click(); await box.waitFor();
    await pickB(p); await p.locator('#transfer-existing').filter({ hasText: '2' }).waitFor();
    assert.equal(await p.locator('[name="transfer-existing"][value="skip"]').isChecked(), true);
    await p.locator('#dialog [data-action="transfer-run"]').click(); await p.locator('#toast').filter({ hasText: /이미 있어 건너뜀|건너뛰었습니다/ }).waitFor();
    assert.deepEqual(await tree(b), before);
    // 3. One moved: gone here, there.
    await p.locator('.batch-bar [data-action="batch-clear"]').click().catch(() => {});
    await p.locator(`[data-batch-paper="${third.id}"]`).check();
    await p.locator('.batch-bar [data-action="batch-transfer"]').click(); await box.waitFor();
    await pickB(p); await p.locator('[name="transfer-mode"][value="move"]').check();
    await p.locator('#transfer-notes').filter({ hasText: '휴지통' }).waitFor();
    await p.locator('#dialog [data-action="transfer-run"]').click(); await p.locator('#toast').filter({ hasText: /옮겼습니다/ }).waitFor();
    assert.equal(await p.locator('.paper-item', { hasText: third.title }).count(), 0);
    assert.ok((await vaultOf(b)).papers.some(x => x.id === third.id));
    // 4. The whole vault copied from the vault manager: everything there (two already were: skipped).
    await p.locator('[data-action="vault-manager"]').click(); await p.locator('[data-vm-tab="backup"]').click();
    await p.locator('[data-action="transfer-whole-copy"]').click(); await box.waitFor();
    await pickB(p); await p.locator('#transfer-summary').waitFor();
    await p.locator('#dialog [data-action="transfer-run"]').click(); await p.locator('#toast').filter({ hasText: /복사했습니다|건너뛰었습니다/ }).waitFor();
    assert.equal((await vaultOf(b)).papers.length, 3);
    // 5. B in use on another computer: refused, B unchanged.
    await fs.writeFile(path.join(b, appName.vaultDir, 'writer.lock'), JSON.stringify({ pid: 4242, host: 'other-desk', boot: 1, token: 'x' }));
    const locked = await tree(b);
    await p.locator(`[data-batch-paper="${first.id}"]`).check().catch(() => {});
    await p.locator('.batch-bar [data-action="batch-transfer"]').click(); await box.waitFor();
    await pickB(p); await p.locator('[name="transfer-existing"][value="replace"]').check().catch(() => {});
    await p.locator('#dialog [data-action="transfer-run"]').click(); await p.locator('#toast').filter({ hasText: /other-desk|사용 중/ }).waitFor();
    assert.deepEqual(await tree(b), locked);
    await fs.rm(path.join(b, appName.vaultDir, 'writer.lock'));
    // Opening B from the result: the memo and the papers are there.
    await app.close(); app = null;
    // 6. The dialog in English at 800px: nothing runs past its edge.
    p = await launch('en'); await p.setViewportSize({ width: 800, height: 700 });
    // The PDF read last opens again (the library shows for a moment before it): back to the library from it.
    await p.waitForFunction(() => state.screen === 'reader', null, { timeout: 15000 }).catch(() => {});
    if (await p.evaluate(() => state.screen === 'reader')) await p.locator('[data-action="back"]').first().click();
    await p.locator('.paper-item').first().waitFor();
    await p.locator(`[data-batch-paper="${first.id}"]`).check();
    await p.locator('.batch-bar [data-action="batch-transfer"]').click(); await p.locator('#dialog .transfer-form').waitFor();
    await pickB(p); await p.locator('[name="transfer-mode"][value="move"]').check(); await p.locator('#transfer-notes li').first().waitFor();
    const over = await p.evaluate(() => { const d = document.querySelector('#dialog'), r = d.getBoundingClientRect(); return [...d.querySelectorAll('*')].filter(n => { const b = n.getBoundingClientRect(); return b.width && (b.right > r.right + 1 || b.left < r.left - 1 || n.scrollWidth > n.clientWidth + 1 && getComputedStyle(n).overflowX === 'visible'); }).map(n => n.outerHTML.slice(0, 80)); });
    assert.deepEqual(over, [], 'nothing runs past the dialog at 800px in English');
    assert.doesNotMatch(await p.locator('#dialog').textContent(), /[가-힣]/, 'no Korean left in the English dialog');
    await app.close(); app = null;
    console.log('Transfer smoke passed: two papers copied with a memo typed just before, ink and notebook; sent again and skipped; one moved; the whole vault copied; a vault in use refused; the dialog fits at 800px in English.');
  } catch (error) { console.error(error); process.exitCode = 1; try { await (await app?.firstWindow())?.screenshot({ path: path.join(os.tmpdir(), `${appName.id}-transfer-failure.png`) }); } catch {} }
  finally { await app?.close().catch(() => {}); await fs.rm(temp, { recursive: true, force: true }); }
})();
