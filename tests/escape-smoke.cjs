// End-to-end check of letting go with Esc and the select tool in the real app: a lasso selection (on a PDF page and in a
// notebook) goes with Esc, also when the keyboard is still in a text field, and when the reading (select) tool is
// chosen; Esc leaves full screen (F11) once nothing on the page has used it, so one press does one thing.
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
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), `${appName.id}-escape-e2e-`)), vault = path.join(temp, 'vault'); await fs.mkdir(vault);
  const doc = await PDFDocument.create(), font = await doc.embedFont(StandardFonts.Helvetica); doc.addPage([600, 800]).drawText('A research paper connects ideas.', { x: 40, y: 740, size: 14, font });
  await fs.writeFile(path.join(temp, 'paper.pdf'), await doc.save());
  const env = /utf-?8/i.test(process.env.LC_ALL || process.env.LANG || '') ? process.env : { ...process.env, LC_ALL: 'C.UTF-8', LANG: 'C.UTF-8' };
  let app;
  try {
    app = await electron.launch({ env, executablePath: require('./app-executable.cjs')(root), args: [...(process.env.APP_TEST_SOURCE === '1' ? [root] : []), '--no-sandbox', '--ozone-platform=headless', '--disable-gpu', `--user-data-dir=${path.join(temp, 'profile')}`], timeout: 20000 });
    const p = await app.firstWindow(); p.setDefaultTimeout(15000); await p.setViewportSize({ width: 1300, height: 950 });
    p.on('pageerror', e => { console.error(e); process.exitCode = 1; }); p.on('console', m => { if (m.type() === 'error') { console.error('renderer:', m.text()); process.exitCode = 1; } });
    await app.evaluate(({ dialog }) => { globalThis.openQueue = []; dialog.showOpenDialog = async () => ({ canceled: false, filePaths: globalThis.openQueue.shift() }); });
    await app.evaluate((_, v) => globalThis.openQueue.push([v]), vault); await p.locator('[data-action="storage"]').first().click();
    await app.evaluate((_, f) => globalThis.openQueue.push([f]), path.join(temp, 'paper.pdf')); await p.locator('[data-action="add-files"]').first().click();
    await p.locator('.paper-item').click(); await p.locator('.original-pages .page[data-page="1"] .textLayer span').first().waitFor();
    const page = await p.locator('.original-pages .page[data-page="1"]').boundingBox(), at = (fx, fy) => [page.x + page.width * fx, page.y + page.height * fy];
    // The window's full-screen state stands in for the real one (a headless window here never goes full screen): what is
    // checked is that the page asks the window to leave it, and when.
    await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; let full = false; w.isFullScreen = () => full; w.setFullScreen = value => { full = Boolean(value); }; });
    const fullScreen = value => app.evaluate(({ BrowserWindow }, value) => { const w = BrowserWindow.getAllWindows()[0]; if (value !== undefined) w.setFullScreen(value); return w.isFullScreen(); }, value);
    const waitFull = async want => { for (let i = 0; i < 50 && await fullScreen() !== want; i++) await p.waitForTimeout(100); return fullScreen(); };
    const selected = () => p.evaluate(() => [Boolean(inkState.selection), document.querySelectorAll('.ink-selection').length]);
    await p.locator('[data-ink-tool="pen"]').click(); await p.mouse.move(...at(.3, .5)); await p.mouse.down(); await p.mouse.move(...at(.5, .55), { steps: 8 }); await p.mouse.up();
    await p.locator('.ink-status[data-state="saved"]').waitFor({ state: 'attached' });
    const lasso = async (point, box) => { await p.locator('[data-ink-tool="lasso"]').click(); await p.mouse.move(...point(box[0], box[1])); await p.mouse.down(); for (const pt of [[box[2], box[1]], [box[2], box[3]], [box[0], box[3]], [box[0], box[1] + .01]]) await p.mouse.move(...point(...pt), { steps: 4 }); await p.mouse.up(); };

    // ---- PDF page. Esc lets go of the selection, also with the keyboard still in the search field; the select tool
    // lets go of it too, while the hand keeps it to move.
    await lasso(at, [.25, .45, .55, .6]); await p.locator('.ink-selection').waitFor(); assert.deepEqual(await selected(), [true, 1]);
    await p.locator('#search').evaluate(n => n.focus()); await p.keyboard.press('Escape'); assert.deepEqual(await selected(), [false, 0], 'Esc lets go (focus in a text field)');
    await lasso(at, [.25, .45, .55, .6]); await p.locator('.ink-selection').waitFor();
    await p.locator('[data-ink-tool="read"]').click(); assert.deepEqual(await selected(), [false, 0], 'the select tool lets go');
    assert.equal(await p.evaluate(() => globalThis.appInk.tool), 'read');
    // The hand, reached through the reading button's menu, takes back the selection reading let go of, to move it; a
    // press on the page in between forgets it.
    const pickPointer = async value => { await p.locator('[data-ink-group="pointer"]').click(); if (!await p.locator('[data-ink-flyout="pointer"]').count()) await p.locator('[data-ink-group="pointer"]').click(); await p.locator(`[data-ink-pick="pointer"][data-value="${value}"]`).click(); };
    await lasso(at, [.25, .45, .55, .6]); await p.locator('.ink-selection').waitFor(); await p.locator('[data-ink-tool="read"]').click(); assert.deepEqual(await selected(), [false, 0]);
    await pickPointer('hand'); assert.deepEqual(await selected(), [true, 1], 'the hand takes the selection back');
    await pickPointer('read'); assert.deepEqual(await selected(), [false, 0]); await p.mouse.click(...at(.8, .9)); await pickPointer('hand'); assert.deepEqual(await selected(), [false, 0], 'not after a press on the page');
    await pickPointer('read');

    // ---- Full screen. One Esc does one thing: first it lets go of the selection, the next leaves full screen.
    await fullScreen(true); assert.equal(await waitFull(true), true, 'the window went full screen');
    await lasso(at, [.25, .45, .55, .6]); await p.locator('.ink-selection').waitFor();
    await p.keyboard.press('Escape'); assert.deepEqual(await selected(), [false, 0]); await p.waitForTimeout(400); assert.equal(await fullScreen(), true, 'the selection used that Esc');
    await p.locator('[data-ink-tool="read"]').click(); await p.keyboard.press('Escape'); assert.equal(await waitFull(false), false, 'Esc leaves full screen');
    // An open dialog takes Esc for itself.
    await fullScreen(true); await waitFull(true); await p.keyboard.press('Shift+Slash'); await p.locator('#dialog[open]').waitFor();
    await p.keyboard.press('Escape'); await p.locator('#dialog[open]').waitFor({ state: 'detached' }).catch(() => {}); await p.waitForTimeout(400);
    assert.equal(await p.evaluate(() => document.querySelector('#dialog').open), false); assert.equal(await fullScreen(), true, 'closing the dialog kept full screen');
    await p.keyboard.press('Escape'); assert.equal(await waitFull(false), false);

    // ---- Notebook: the same.
    await p.locator('[data-mode="notebook"]').click(); await p.locator('.notebook-pane [data-action="nb-new"]').first().click();
    await p.locator('#nb-title').fill('노트'); await p.locator('#dialog [data-action="nb-create"]').click(); await p.locator('.nb-page').first().waitFor();
    const sheet = await p.locator('.nb-page').first().boundingBox(), on = (fx, fy) => [sheet.x + sheet.width * fx, sheet.y + sheet.height * fy];
    await p.locator('[data-ink-tool="pen"]').click(); await p.mouse.move(...on(.3, .2)); await p.mouse.down(); await p.mouse.move(...on(.5, .25), { steps: 8 }); await p.mouse.up(); await p.waitForTimeout(300);
    const nbSelected = () => p.evaluate(() => [Boolean(nb.sel), document.querySelectorAll('.nb-selection').length]);
    await lasso(on, [.25, .15, .55, .3]); await p.locator('.nb-selection').waitFor(); assert.deepEqual(await nbSelected(), [true, 1]);
    await p.locator('#search').evaluate(n => n.focus()); await p.keyboard.press('Escape'); assert.deepEqual(await nbSelected(), [false, 0], 'Esc lets go in a notebook');
    await lasso(on, [.25, .15, .55, .3]); await p.locator('.nb-selection').waitFor();
    await p.locator('[data-ink-tool="read"]').click(); assert.deepEqual(await nbSelected(), [false, 0], 'the select tool lets go in a notebook');
    console.log('Escape smoke passed: Esc and the select tool let go of a lasso selection on PDF pages and in notebooks; Esc leaves full screen once nothing else used it.');
  } catch (error) { console.error(error); process.exitCode = 1; }
  finally { await app?.close().catch(() => {}); await fs.rm(temp, { recursive: true, force: true }); }
})();
