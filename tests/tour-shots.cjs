// Screenshots of the app as it runs on this machine, for looking at a platform nobody here can sit at (the macOS build:
// .github/workflows/mac.yml keeps them as the run's artifact). Not a check: it asserts nothing and is in no test list.
// A small paper is made and translated by a stand-in model (fixed Korean sentences), then the main screens are saved
// as PNGs into the folder named by the first argument: the start screen, the library, the original, both side by
// side, ink on the page, the notebook, the settings and the shortcut list. On macOS the whole screen is captured once
// too (the window with its title bar and the menu bar), when the system allows it.
const { _electron: electron } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const appName = require('../core/app-name.cjs');
const root = path.resolve(__dirname, '..'), out = path.resolve(process.argv[2] || 'tour-shots');
(async () => {
  await fs.mkdir(out, { recursive: true });
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), `${appName.id}-tour-`)), vault = path.join(temp, 'papers'); await fs.mkdir(vault);
  const doc = await PDFDocument.create(), font = await doc.embedFont(StandardFonts.TimesRoman), bold = await doc.embedFont(StandardFonts.TimesRomanBold);
  const lines = ['Reading a paper in a second language takes time that the reader would', 'rather spend on its ideas. A reader that keeps the page as it is and', 'changes only its words lets the eye stay where it was: the figure, the', 'equation and the paragraph beside them do not move.'];
  for (let n = 0; n < 2; n++) { const page = doc.addPage([595, 842]); page.drawText(n ? '2. Method' : 'Reading in place: a study of layout and attention', { x: 60, y: 770, size: n ? 14 : 16, font: bold });
    for (let b = 0; b < 4; b++) lines.forEach((line, i) => page.drawText(line, { x: 60, y: 730 - b * 80 - i * 15, size: 11, font })); page.drawRectangle({ x: 60, y: 300, width: 220, height: 90, borderWidth: 1, color: rgb(.9, .94, 1), borderColor: rgb(.3, .4, .6) }); page.drawText('Figure 1. Attention by layout.', { x: 60, y: 284, size: 9, font }); }
  await fs.writeFile(path.join(temp, 'Reading in place.pdf'), await doc.save());
  const executable = require('./app-executable.cjs')(root);
  const env = /utf-?8/i.test(process.env.LC_ALL || process.env.LANG || '') ? process.env : { ...process.env, LC_ALL: 'C.UTF-8', LANG: 'C.UTF-8' };
  const app = await electron.launch({ env, executablePath: executable, args: [...(process.env.APP_TEST_SOURCE === '1' ? [root] : []), '--no-sandbox', ...(process.platform === 'linux' ? ['--ozone-platform=headless', '--disable-gpu'] : []), `--user-data-dir=${path.join(temp, 'profile')}`], timeout: 30000 });
  let n = 0; const notes = [];
  try {
    const p = await app.firstWindow(); p.setDefaultTimeout(20000); await p.setViewportSize({ width: 1440, height: 900 });
    const shot = async name => { const file = path.join(out, `${String(++n).padStart(2, '0')}-${name}.png`); await p.waitForTimeout(500); await p.screenshot({ path: file }); notes.push(`${path.basename(file)} ${(await fs.stat(file)).size}`); };
    const step = async (name, run) => { try { await run(); await shot(name); } catch (error) { notes.push(`${name}: not taken (${String(error.message).split('\n')[0].slice(0, 160)})`); } };
    await app.evaluate(({ app, dialog }) => {
      globalThis.openQueue = []; dialog.showOpenDialog = async () => ({ canceled: false, filePaths: globalThis.openQueue.shift() });
      const { ChatGPT } = process.getBuiltinModule('module').createRequire(app.getAppPath() + '/package.json')('./desktop/chatgpt.cjs');
      ChatGPT.prototype.status = function () { return { connected: true, usable: true, email: '', persistent: false }; }; ChatGPT.prototype.models = async () => [{ id: 'stand-in', name: 'stand-in' }];
      ChatGPT.prototype.translate = async (_m, blocks) => blocks.map(b => ({ id: b.id, text: b.text.length < 60 ? '제자리에서 읽기: 배치와 주의에 관한 연구' : '외국어로 된 논문을 읽는 데 드는 시간은 독자가 그 생각에 쓰고 싶어 하는 시간이다. 쪽을 그대로 두고 글만 바꾸는 독서 도구는 눈이 있던 자리에 머물게 한다. 그림과 수식, 그 옆의 문단은 움직이지 않는다.' }));
    });
    await step('start', async () => {});
    await app.evaluate((_, v) => globalThis.openQueue.push([v]), vault); await p.locator('[data-action="storage"]').first().click();
    await app.evaluate((_, f) => globalThis.openQueue.push([f]), path.join(temp, 'Reading in place.pdf')); await p.locator('[data-action="add-files"]').first().click(); await p.locator('.paper-item').first().waitFor();
    await step('library', async () => {});
    if (process.platform === 'darwin') { try { execFileSync('screencapture', ['-x', path.join(out, '00-whole-screen.png')], { timeout: 15000 }); notes.push(`00-whole-screen.png ${(await fs.stat(path.join(out, '00-whole-screen.png'))).size}`); } catch (error) { notes.push(`whole screen: not taken (${String(error.message).split('\n')[0].slice(0, 120)})`); } }
    await step('original', async () => { await p.locator('.paper-item').first().click(); await p.locator('.original-pages .page[data-page="1"] .textLayer span').first().waitFor(); });
    await step('side-by-side', async () => { await p.evaluate(() => { actions['close-left']?.(); actions['close-right']?.(); }); await p.locator('[data-mode="dual"]').click(); await p.locator('#dialog [data-action="gpt-start"]').click(); await p.locator('.translated-pane .translated-pages .page[data-page="1"] .translation-layer[data-ready="true"]').waitFor({ timeout: 60000 }); });
    await step('ink', async () => { const o = await p.locator('.original-pages .page[data-page="1"]').first().boundingBox(), at = (fx, fy) => [o.x + o.width * fx, o.y + o.height * fy];
      await p.locator('.ink-toolbar [data-ink-tool="pen"]').click(); await p.mouse.move(...at(.15, .5)); await p.mouse.down(); for (let i = 1; i <= 20; i++) await p.mouse.move(...at(.15 + i * .02, .5 + Math.sin(i / 3) * .02)); await p.mouse.up();
      await p.locator('.ink-toolbar [data-ink-tool="text"]').click(); await p.mouse.click(...at(.6, .55)); await p.keyboard.insertText('한글 메모 test'); await p.keyboard.press('Escape'); await p.locator('.ink-toolbar [data-ink-tool="read"]').click(); });
    await step('selection-bar', async () => { await p.locator('.original-pages .page[data-page="1"] .textLayer span').nth(1).dblclick(); await p.locator('.ink-select-bar').waitFor(); });
    await step('notebook', async () => { await p.keyboard.press('Escape'); await p.locator('[data-mode="notebook"]').click(); await p.locator('[data-action="nb-new"]').first().click(); await p.locator('[data-action="nb-create"]').click(); await p.locator('.nb-page').first().waitFor(); await p.locator('[data-action="nb-text"]').first().click(); await p.waitForTimeout(300); await p.keyboard.insertText('노트북 메모\n- 첫째\n- 둘째'); await p.keyboard.press('Escape'); });
    await step('settings', async () => { await p.evaluate(() => openGPTSettings()); await p.locator('dialog.llm-dialog').waitFor(); });
    await step('shortcuts', async () => { await p.locator('dialog[open] [data-action="close"]').last().click(); await p.keyboard.press('F1'); await p.locator('dialog[open]').waitFor(); });
    await step('dark', async () => { await p.locator('dialog[open] [data-action="close"]').last().click(); await p.locator('[data-mode="dual"]').click(); await p.evaluate(() => { document.documentElement.dataset.theme = 'dark'; }); });
  } finally { await app.close().catch(() => {}); await fs.rm(temp, { recursive: true, force: true }).catch(() => {}); }
  console.log(`${process.platform} ${os.release()} ${process.arch}\n` + notes.join('\n'));
})().catch(e => { console.error(e); process.exit(1); });
