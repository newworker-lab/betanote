// End-to-end check of K-09 with two real app instances (separate profiles,
// separate vault folders, one shared folder) standing in for two computers.
// A real cloud client's delays and partial uploads are not exercised here;
// the merge rules themselves are covered by tests/sync.test.cjs.
const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { PDFDocument, StandardFonts } = require('pdf-lib');
const appName = require('../core/app-name.cjs');
const root = path.resolve(__dirname, '..');
(async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), `${appName.id}-sync-e2e-`)), shared = path.join(temp, 'Dropbox');
  for (const dir of ['A-vault', 'B-vault', 'Dropbox']) await fs.mkdir(path.join(temp, dir));
  const doc = await PDFDocument.create(), font = await doc.embedFont(StandardFonts.Helvetica); doc.addPage([600, 800]).drawText('Shared paper text.', { x: 40, y: 700, size: 14, font });
  await fs.writeFile(path.join(temp, 'paper.pdf'), await doc.save());
  const executable = require('./app-executable.cjs')(root);
// Memos are folded until chosen: the first one is opened when a step needs the memo field.
const openNote = async p => { await p.locator('#note, .memo-card[data-memo], .memo-tab [data-action="memo-new"]').first().waitFor(); if (!await p.locator('#note').count()) await (await p.locator('.memo-card[data-memo]').count() ? p.locator('.memo-card[data-memo]').first() : p.locator('.memo-tab [data-action="memo-new"]')).click(); await p.locator('#note').waitFor({ state: 'attached' }); return p.locator('#note'); };
  const env = /utf-?8/i.test(process.env.LC_ALL || process.env.LANG || '') ? process.env : { ...process.env, LC_ALL: 'C.UTF-8', LANG: 'C.UTF-8' };
  const apps = [];
  async function launch(name) {
    const app = await electron.launch({ env, executablePath: executable, args: [...(process.env.APP_TEST_SOURCE === '1' ? [root] : []), '--no-sandbox', '--ozone-platform=headless', '--disable-gpu', `--user-data-dir=${path.join(temp, 'profile-' + name)}`], timeout: 20000 });
    apps.push(app); const p = await app.firstWindow(); p.setDefaultTimeout(15000);
    p.on('pageerror', e => { console.error(name, e); process.exitCode = 1; }); p.on('console', m => { if (m.type() === 'error') console.error(name, 'renderer:', m.text()); });
    await app.evaluate(({ dialog }) => { globalThis.openQueue = []; dialog.showOpenDialog = async () => ({ canceled: false, filePaths: globalThis.openQueue.shift() }); });
    return { app, p, open: paths => app.evaluate((_, paths) => globalThis.openQueue.push(...paths.map(x => [x])), paths) };
  }
  async function draw(p) { const box = await p.locator('.original-pages .page[data-page="1"]').boundingBox(); await p.mouse.move(box.x + box.width * .2, box.y + box.height * .3); await p.mouse.down(); for (let i = 1; i <= 8; i++) await p.mouse.move(box.x + box.width * (.2 + .05 * i), box.y + box.height * .32); await p.mouse.up(); }
  try {
    // Device A: vault with a PDF, a memo and ink, linked to the shared folder.
    const A = await launch('A');
    await A.open([path.join(temp, 'A-vault')]); await A.p.locator('[data-action="storage"]').first().click();
    await A.open([path.join(temp, 'paper.pdf')]); await A.p.locator('[data-action="add-files"]').first().click();
    await A.p.locator('.paper-item').click(); await (await openNote(A.p)).fill('A에서 쓴 메모'); await A.p.locator('#saved').filter({ hasText: '저장소에 저장됨' }).waitFor();
    await A.p.locator('.original-pages .page[data-page="1"] canvas').first().waitFor(); await A.p.locator('[data-ink-tool="pen"]').click(); await draw(A.p);
    await A.p.locator('.ink-status[data-state="saved"][data-touched]').waitFor({ state: 'attached' }); await A.p.locator('[data-ink-tool="read"]').click();
    await A.p.locator('[data-action="back"]').click(); await A.p.locator('[data-action="vault-manager"]').click(); await A.p.locator('[data-vm-tab="sync"]').click();
    await A.open([shared]); await A.p.locator('[data-action="sync-connect"]').click(); await A.p.locator('[data-action="sync-run"]').waitFor();
    assert.equal((await fs.readdir(path.join(shared, appName.syncDir))).length, 1);

    // Device B joins from the welcome screen and gets everything.
    const B = await launch('B');
    await B.open([shared, path.join(temp, 'B-vault')]); await B.p.locator('[data-action="sync-join"]').click(); await B.p.locator('[data-sync-join]').click();
    await B.p.locator('.paper-item').waitFor(); await B.p.locator('.paper-item').click();
    assert.equal(await (await openNote(B.p)).inputValue(), 'A에서 쓴 메모');
    await B.p.waitForFunction(() => { const c = document.querySelector('.original-pages .page[data-page="1"] .app-ink-layer'); if (!c) return false; const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; for (let i = 3; i < d.length; i += 4) if (d[i]) return true; return false; });

    // Both edit the same memo: the second device to sync sees both versions.
    await A.p.locator('#dialog [data-action="close"]').last().click();
    await A.p.locator('.paper-item').click(); await (await openNote(A.p)).fill('A가 고친 메모'); await A.p.locator('#saved').filter({ hasText: '저장소에 저장됨' }).waitFor();
    await (await openNote(B.p)).fill('B가 고친 메모'); await B.p.locator('#saved').filter({ hasText: '저장소에 저장됨' }).waitFor();
    for (const d of [A, B]) { await d.p.locator('[data-action="back"]').click(); await d.p.locator('[data-action="vault-manager"]').click(); await d.p.locator('[data-vm-tab="sync"]').click(); await d.p.locator('[data-action="sync-run"]').click(); await d.p.locator('#toast').filter({ hasText: '동기화:' }).waitFor(); }
    await B.p.locator('.sync-conflict').waitFor();
    const versions = await B.p.locator('.sync-versions p').allTextContents();
    assert.deepEqual(versions.sort(), ['A가 고친 메모', 'B가 고친 메모']);
    await B.p.locator('[data-sync-resolve][data-choice="remote"]').click(); await B.p.locator('.sync-conflict').waitFor({ state: 'detached' });
    await B.p.locator('[data-action="sync-run"]').click(); await B.p.locator('#toast').filter({ hasText: '동기화:' }).waitFor();
    await A.p.locator('[data-action="sync-run"]').click(); await A.p.locator('#toast').filter({ hasText: '동기화:' }).waitFor();
    for (const d of [A, B]) { await d.p.locator('#dialog [data-action="close"]').last().click(); await d.p.locator('.paper-item').click(); assert.equal(await (await openNote(d.p)).inputValue(), 'A가 고친 메모'); }
    assert.equal(await A.p.locator('.sync-conflict').count(), 0);
    for (const app of apps.splice(0)) await app.close();
    console.log('Sync smoke passed: two app instances exchange a PDF, memo and ink through a shared folder, keep both versions of a concurrent edit, and resolve it on both devices.');
  } catch (error) { for (const [i, app] of apps.entries()) try { await (await app.firstWindow()).screenshot({ path: path.join(os.tmpdir(), `${appName.id}-sync-failure-${i}.png`) }); } catch {} throw error; }
  finally { for (const app of apps) await app.close().catch(() => {}); await fs.rm(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }).catch(error => console.warn(`임시 폴더를 다 지우지 못했습니다(${error.code}). 테스트 결과와는 무관합니다: ${temp}`)); }
})().catch(error => { console.error(error); process.exit(1); });
