// K-03 recovery in the real app: a stroke shown as saved survives SIGKILL,
// and a write failure is shown, keeps the input, and saves once fixed.
const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { PDFDocument, StandardFonts } = require('pdf-lib');
const appName = require('../core/app-name.cjs');
const root = path.resolve(__dirname, '..');
(async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), `${appName.id}-recovery-`)), vault = path.join(temp, 'vault'); await fs.mkdir(vault);
  const doc = await PDFDocument.create(), font = await doc.embedFont(StandardFonts.Helvetica); doc.addPage([600, 800]).drawText('Recovery test.', { x: 40, y: 740, size: 14, font });
  await fs.writeFile(path.join(temp, 'paper.pdf'), await doc.save());
  const executable = require('./app-executable.cjs')(root);
// Memos are folded until chosen: the first one is opened when a step needs the memo field.
const openNote = async p => { await p.locator('#note, .memo-card[data-memo], .memo-tab [data-action="memo-new"]').first().waitFor(); if (!await p.locator('#note').count()) await (await p.locator('.memo-card[data-memo]').count() ? p.locator('.memo-card[data-memo]').first() : p.locator('.memo-tab [data-action="memo-new"]')).click(); await p.locator('#note').waitFor({ state: 'attached' }); return p.locator('#note'); };
  const env = /utf-?8/i.test(process.env.LC_ALL || process.env.LANG || '') ? process.env : { ...process.env, LC_ALL: 'C.UTF-8', LANG: 'C.UTF-8' };
  let app, inkDir;
  async function launch() {
    app = await electron.launch({ env, executablePath: executable, args: [...(process.env.APP_TEST_SOURCE === '1' ? [root] : []), '--no-sandbox', '--ozone-platform=headless', '--disable-gpu', `--user-data-dir=${path.join(temp, 'profile')}`], timeout: 20000 });
    const p = await app.firstWindow(); p.setDefaultTimeout(15000); await p.setViewportSize({ width: 1300, height: 950 });
    await app.evaluate(({ dialog }) => { globalThis.openQueue = []; dialog.showOpenDialog = async () => ({ canceled: false, filePaths: globalThis.openQueue.shift() }); });
    return p;
  }
  async function draw(p, fy) { const box = await p.locator('.original-pages .page[data-page="1"]').boundingBox(); await p.mouse.move(box.x + box.width * .2, box.y + box.height * fy); await p.mouse.down(); for (let i = 1; i <= 10; i++) await p.mouse.move(box.x + box.width * (.2 + .05 * i), box.y + box.height * fy); await p.mouse.up(); }
  const count = p => p.evaluate(() => document.querySelector('.original-pages').inkDoc?.strokes.size);
  try {
    let p = await launch();
    await app.evaluate((_, v) => globalThis.openQueue.push([v]), vault); await p.locator('[data-action="storage"]').first().click();
    await app.evaluate((_, f) => globalThis.openQueue.push([f]), path.join(temp, 'paper.pdf')); await p.locator('[data-action="add-files"]').first().click();
    await p.locator('.paper-item').click(); await p.locator('.original-pages .page[data-page="1"] canvas').first().waitFor();
    await p.locator('[data-ink-tool="pen"]').click(); await draw(p, .2);
    await p.locator('.ink-status[data-state="saved"][data-touched]').waitFor({ state: 'attached' });
    // Force kill right after "saved": no close handlers, no backup, no unlock.
    // On Windows the renderer and GPU processes outlive a killed main process for a moment (holding the
    // single-instance lock), so the whole process tree goes, and the next start is retried until the old one is gone.
    const pid = app.process().pid;
    if (process.platform === 'win32') require('node:child_process').spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' }); else app.process().kill('SIGKILL');
    await new Promise(r => setTimeout(r, 500));
    // The writer lock of the killed process is reclaimed because its pid is gone; the reader may reopen by itself.
    for (let attempt = 1; ; attempt++) { try { p = await launch(); break; } catch (error) { if (attempt >= 10) throw error; await new Promise(r => setTimeout(r, 1000)); } } await p.locator('#note, .paper-item').first().waitFor(); if (!await p.locator('#note').count()) await p.locator('.paper-item').click();
    await p.waitForFunction(() => document.querySelector('.original-pages')?.inkDoc?.strokes.size === 1, null, { timeout: 20000 });

    // A failed write is visible, the stroke stays on screen, and retry saves it.
    inkDir = path.join(vault, appName.vaultDir, 'ink', (await fs.readdir(path.join(vault, appName.vaultDir, 'ink')))[0]);
    // Appending needs the log to be writable; read-only stands in for a failing disk.
    await fs.chmod(path.join(inkDir, 'original.log'), 0o400); await fs.chmod(inkDir, 0o500);
    await p.locator('.original-pages .page[data-page="1"] canvas').first().waitFor(); await p.locator('[data-ink-tool="pen"]').click(); await draw(p, .4);
    await p.locator('.ink-status[data-state="failed"]').waitFor();
    assert.equal(await count(p), 2, 'the unsaved stroke stays on screen');
    await fs.chmod(inkDir, 0o700); await fs.chmod(path.join(inkDir, 'original.log'), 0o600);
    await p.locator('[data-ink-retry]').click(); await p.locator('.ink-status[data-state="saved"]').waitFor({ state: 'attached' });
    await app.close(); p = await launch(); await (await openNote(p)).waitFor();
    await p.waitForFunction(() => document.querySelector('.original-pages')?.inkDoc?.strokes.size === 2, null, { timeout: 20000 });
    await app.close(); app = null;
    console.log('Ink recovery smoke passed: saved stroke survives SIGKILL; a failed write is shown, kept on screen and saved on retry.');
  } finally { if (inkDir) { await fs.chmod(inkDir, 0o700).catch(() => {}); await fs.chmod(path.join(inkDir, 'original.log'), 0o600).catch(() => {}); } if (app) await app.close().catch(() => {}); await fs.rm(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }).catch(error => console.warn(`임시 폴더를 다 지우지 못했습니다(${error.code}). 테스트 결과와는 무관합니다: ${temp}`)); }
})().catch(error => { console.error(error); process.exit(1); });
