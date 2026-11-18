// End-to-end check in the real Electron app (APP_TEST_SOURCE=1 runs the source) of the local
// diagnostic record: an error the page did not catch and a request that failed are written to
// userData/logs without paths or names; 도움말 → 진단 정보 복사 puts the app, the system and the latest
// lines on the clipboard; a page that dies is recorded, the reader is told and the page comes back.
const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { PDFDocument, StandardFonts } = require('pdf-lib');
const appName = require('../core/app-name.cjs');
const root = path.resolve(__dirname, '..');
(async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), `${appName.id}-diag-e2e-`)), vault = path.join(temp, 'my private vault'), profile = path.join(temp, 'profile'); await fs.mkdir(vault);
  const doc = await PDFDocument.create(), font = await doc.embedFont(StandardFonts.Helvetica); doc.addPage([600, 800]).drawText('A paper to read.', { x: 40, y: 740, size: 12, font });
  await fs.writeFile(path.join(vault, 'paper.pdf'), await doc.save({ useObjectStreams: false }));
  const executable = require('./app-executable.cjs')(root);
  let app;
  try {
    app = await electron.launch({ executablePath: executable, args: [...(process.env.APP_TEST_SOURCE === '1' ? [root] : []), '--no-sandbox', '--ozone-platform=headless', '--disable-gpu', `--user-data-dir=${profile}`], timeout: 20000 });
    let p = await app.firstWindow(); p.setDefaultTimeout(20000);
    await app.evaluate(({ dialog }, v) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [v] }); globalThis.boxes = []; dialog.showMessageBox = async (_w, options) => { globalThis.boxes.push(options.message); return { response: 0 }; }; }, vault);
    await p.locator('[data-action="storage"]').first().click(); await p.locator('.paper-item').waitFor();
    // An error nothing caught, with a path in its message; and a request that fails.
    await p.evaluate(v => { setTimeout(() => { throw new Error(`boom while reading ${v}/paper.pdf`); }, 0); }, vault);
    await p.evaluate(() => window.appApi.readOriginal(state.storageKey, 987654321, 'none').catch(() => {}));
    const file = path.join(profile, 'logs', 'app.log');
    let text = ''; for (let i = 0; i < 50 && !(/boom/.test(text) && /read-original/.test(text)); i++) { await p.waitForTimeout(100); text = await fs.readFile(file, 'utf8').catch(() => ''); }
    assert.match(text, /page error boom while reading <vault>\/….pdf/, text); assert.match(text, /request read-original /, text);
    assert.ok(!text.includes('my private vault') && !text.includes(temp), 'no folder of the reader is written: ' + text);
    // 도움말 → 진단 정보 복사, 로그 폴더 열기.
    const help = await app.evaluate(({ Menu }) => Menu.getApplicationMenu().items.find(i => i.label.startsWith('도움말')).submenu.items.map(i => i.label).filter(Boolean));
    assert.ok(help.includes('진단 정보 복사') && help.includes('로그 폴더 열기'), JSON.stringify(help));
    await app.evaluate(({ Menu }) => Menu.getApplicationMenu().items.find(i => i.label.startsWith('도움말')).submenu.items.find(i => i.label === '진단 정보 복사').click());
    const copied = await app.evaluate(({ clipboard }) => clipboard.readText());
    assert.match(copied, new RegExp('^' + RegExp.escape(appName.name) + ' \\d+\\.\\d+\\.\\d+\\nElectron: ')); assert.match(copied, /최근 오류 \d+개/); assert.match(copied, /boom while reading <vault>/); assert.ok(!copied.includes('my private vault'));
    assert.ok((await app.evaluate(() => globalThis.boxes)).includes('진단 정보를 복사했습니다.'));
    // The page dies: recorded, the reader is told, and choosing 다시 불러오기 brings the app back with its vault.
    const back = app.waitForEvent('window', { timeout: 5000 }).catch(() => null);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.forcefullyCrashRenderer());
    for (let i = 0; i < 80 && !(await app.evaluate(() => globalThis.boxes)).includes('화면에 문제가 생겨 다시 불러와야 합니다.'); i++) await new Promise(r => setTimeout(r, 100));
    assert.ok((await app.evaluate(() => globalThis.boxes)).includes('화면에 문제가 생겨 다시 불러와야 합니다.'));
    assert.match(await fs.readFile(file, 'utf8'), /window-gone main /);
    await back;
    let alive = false; for (let i = 0; i < 100 && !alive; i++) { await new Promise(r => setTimeout(r, 200)); alive = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.executeJavaScript('typeof papers!=="undefined"&&papers.length===1&&Boolean(document.querySelector(".paper-item"))').catch(() => false)); }
    assert.equal(alive, true, 'the page is back with the vault open');
    console.log('Diagnostics smoke passed: uncaught page errors and failed requests recorded without paths, copied from the help menu, a dead page recorded and brought back.');
  } finally { await app?.close().catch(() => {}); await fs.rm(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }).catch(() => {}); }
})().catch(error => { console.error(error); process.exit(1); });
