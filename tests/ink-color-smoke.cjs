// End-to-end check of the writing tools' + colour panel in the real app (desktop/ink.js): for the pen, the highlighter
// and the shape tool, + opens a panel built as the text box's colour panel is (its title, the same four rows of round
// swatches with the chosen one marked, the row of colours used lately, the colour wheel); a swatch adds its colour to
// that tool's row and chooses it, a colour already in the row is only chosen, the wheel adds its colour, Esc closes
// and gives the focus back to +, arrows move between swatches; what was added is there after a restart. Photos of
// both panels side by side go to the folder in APP_PHOTO_DIR when it is set. APP_TEST_SOURCE=1 runs the source.
const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { PDFDocument, StandardFonts } = require('pdf-lib');
// CIEDE2000 colour difference of two #rrggbb colours (sRGB, D65): how far apart two swatches look.
function deltaE(h1, h2) {
  const lab = hex => { const n = parseInt(hex.slice(1), 16); const [r, g, b] = [n >> 16, n >> 8 & 255, n & 255].map(v => { v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; });
    const f = t => t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116, x = f((r * .4124 + g * .3576 + b * .1805) / .95047), y = f(r * .2126 + g * .7152 + b * .0722), z = f((r * .0193 + g * .1192 + b * .9505) / 1.08883);
    return [116 * y - 16, 500 * (x - y), 200 * (y - z)]; };
  const [L1, a1, b1] = lab(h1), [L2, a2, b2] = lab(h2), rad = Math.PI / 180, Cb = (Math.hypot(a1, b1) + Math.hypot(a2, b2)) / 2, G = .5 * (1 - Math.sqrt(Cb ** 7 / (Cb ** 7 + 25 ** 7)));
  const ap1 = (1 + G) * a1, ap2 = (1 + G) * a2, Cp1 = Math.hypot(ap1, b1), Cp2 = Math.hypot(ap2, b2), hue = (b, a) => { const h = Math.atan2(b, a) / rad; return h < 0 ? h + 360 : h; }, hp1 = hue(b1, ap1), hp2 = hue(b2, ap2);
  let dh = 0; if (Cp1 * Cp2) { dh = hp2 - hp1; if (dh > 180) dh -= 360; else if (dh < -180) dh += 360; }
  const dL = L2 - L1, dC = Cp2 - Cp1, dH = 2 * Math.sqrt(Cp1 * Cp2) * Math.sin(dh * rad / 2), Lb = (L1 + L2) / 2, Cpb = (Cp1 + Cp2) / 2;
  let hb = hp1 + hp2; if (Cp1 * Cp2) { if (Math.abs(hp1 - hp2) > 180) hb += hb < 360 ? 360 : -360; hb /= 2; }
  const T = 1 - .17 * Math.cos((hb - 30) * rad) + .24 * Math.cos(2 * hb * rad) + .32 * Math.cos((3 * hb + 6) * rad) - .2 * Math.cos((4 * hb - 63) * rad), dt = 30 * Math.exp(-(((hb - 275) / 25) ** 2)), RC = 2 * Math.sqrt(Cpb ** 7 / (Cpb ** 7 + 25 ** 7));
  const SL = 1 + .015 * (Lb - 50) ** 2 / Math.sqrt(20 + (Lb - 50) ** 2), SC = 1 + .045 * Cpb, SH = 1 + .015 * Cpb * T, RT = -Math.sin(2 * dt * rad) * RC;
  return Math.sqrt((dL / SL) ** 2 + (dC / SC) ** 2 + (dH / SH) ** 2 + RT * (dC / SC) * (dH / SH));
}
// The two rows a panel starts with stay as they are (the bar's colours); every swatch of the other two rows is at least this far
// from every other swatch of the panel, so no two of them look alike.
const MIN_DELTA_E = 15;
const lookAlike = rows => { const all = rows.flat(), out = []; for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) { if (i < 10 && j < 10) continue; const d = deltaE(all[i], all[j]); if (d < MIN_DELTA_E) out.push(`${all[i]}/${all[j]} ${d.toFixed(1)}`); } return out; };
const appName = require('../core/app-name.cjs');
const root = path.resolve(__dirname, '..');
(async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), `${appName.id}-ink-color-e2e-`)), vault = path.join(temp, 'vault'); await fs.mkdir(vault);
  const doc = await PDFDocument.create(), font = await doc.embedFont(StandardFonts.Helvetica); doc.addPage([600, 800]).drawText('A research paper connects ideas.', { x: 40, y: 740, size: 14, font });
  await fs.writeFile(path.join(temp, 'paper.pdf'), await doc.save());
  const env = /utf-?8/i.test(process.env.LC_ALL || process.env.LANG || '') ? process.env : { ...process.env, LC_ALL: 'C.UTF-8', LANG: 'C.UTF-8' };
  const photos = process.env.APP_PHOTO_DIR || null;
  let app;
  const launch = async (lang = 'ko', width = 1300) => {
    app = await electron.launch({ env: { ...env, APP_UI_LANG: lang }, executablePath: require('./app-executable.cjs')(root), args: [...(process.env.APP_TEST_SOURCE === '1' ? [root] : []), '--no-sandbox', '--ozone-platform=headless', '--disable-gpu', `--user-data-dir=${path.join(temp, 'profile')}`], timeout: 20000 });
    const p = await app.firstWindow(); p.setDefaultTimeout(15000); await p.setViewportSize({ width, height: 900 });
    p.on('pageerror', e => { console.error(e); process.exitCode = 1; });
    await app.evaluate(({ dialog }) => { globalThis.openQueue = []; dialog.showOpenDialog = async () => ({ canceled: false, filePaths: globalThis.openQueue.shift() }); });
    return p;
  };
  const panel = p => p.locator('.ink-color-panel');
  const structure = (p, selector) => p.evaluate(s => { const pop = document.querySelector(s), rows = [...pop.querySelectorAll('.ink-text-swatches > .ink-text-row')];
    return { title: !!pop.querySelector('strong'), rows: rows.length, firstRows: rows.slice(0, 4).map(r => r.querySelectorAll('button').length), wheel: !!pop.querySelector('.ink-text-custom input[type="color"]'), pressed: pop.querySelectorAll('[aria-pressed="true"]').length, classes: pop.className.split(' ').includes('ink-text-pop') }; }, selector);
  try {
    let p = await launch();
    await app.evaluate((_, v) => globalThis.openQueue.push([v]), vault); await p.locator('[data-action="storage"]').first().click();
    await app.evaluate((_, f) => globalThis.openQueue.push([f]), path.join(temp, 'paper.pdf')); await p.locator('[data-action="add-files"]').first().click();
    await p.locator('.paper-item').click(); await p.locator('.original-pages .page[data-page="1"] .textLayer span').first().waitFor();
    const bar = p.locator('.ink-toolbar'), add = () => bar.locator('[data-ink-add-color]').click();
    const custom = kind => p.evaluate(k => JSON.parse(localStorage.getItem('app-ink')).custom[k], kind);
    // The text box's colour panel, for comparison: a box placed with the text tool, its colour button pressed.
    await bar.locator('[data-ink-tool="text"]').click();
    const box = await p.locator('.original-pages .page[data-page="1"]').boundingBox(); await p.mouse.click(box.x + 200, box.y + 300);
    await p.locator('.ink-text-bar [data-tb="color"]').waitFor(); await p.locator('.ink-text-bar [data-tb="color"]').dispatchEvent('pointerdown', { button: 0 });
    await p.locator('.ink-text-pop[data-kind="color"]').waitFor(); const textPanel = await structure(p, '.ink-text-pop[data-kind="color"]');
    if (photos) await p.screenshot({ path: path.join(photos, 'text-colour-panel.png') });
    // Its swatches by keyboard, as in the + panel: arrows, Home and End move; Enter chooses (the panel closes, the
    // text has the focus again).
    const textFocus = () => p.evaluate(() => document.activeElement?.closest('.ink-text-pop') ? document.activeElement.dataset.tbColor || 'custom' : null);
    await p.locator('.ink-text-pop [data-tb-color]').first().focus(); const start = await textFocus();
    await p.keyboard.press('ArrowRight'); const right = await textFocus(); assert.ok(right && right !== start, `text panel: → moves (${start} → ${right})`);
    await p.keyboard.press('ArrowDown'); const below = await textFocus(); assert.ok(below && below !== right, `text panel: ↓ moves (${right} → ${below})`);
    await p.keyboard.press('End'); assert.equal(await textFocus(), 'custom', 'text panel: End to the colour wheel');
    await p.keyboard.press('Home'); assert.equal(await textFocus(), start, 'text panel: Home to the first');
    await p.keyboard.press('ArrowRight'); const pick = await textFocus(); await p.keyboard.press('Enter');
    await p.locator('.ink-text-pop').waitFor({ state: 'detached' });
    assert.equal(await p.evaluate(() => globalThis.appInk.textBar.color), pick, 'text panel: Enter chooses');
    assert.equal(await p.evaluate(() => document.activeElement === globalThis.appInk.textBar.target?.area), true, 'text panel: the text has the focus again');
    await p.locator('.ink-text-bar [data-tb="color"]').dispatchEvent('pointerdown', { button: 0 }); await p.locator('.ink-text-pop[data-kind="color"]').waitFor();
    await p.keyboard.press('Escape'); await p.keyboard.press('Escape'); await p.locator('.ink-text-bar').waitFor({ state: 'detached' }).catch(() => {});
    for (const tool of ['pen', 'highlighter', 'shape']) {
      await bar.locator(`[data-ink-tool="${tool}"]`).click();
      const kind = tool === 'highlighter' ? 'highlighter' : 'pen';
      // + : the same panel as the text colour panel.
      await add(); await panel(p).waitFor();
      const inkPanel = await structure(p, '.ink-color-panel');
      assert.deepEqual({ ...inkPanel, rows: undefined }, { ...textPanel, rows: undefined }, `${tool}: built as the text colour panel`);
      assert.equal(inkPanel.rows, 5, `${tool}: four rows of swatches and the row of colours used lately`);
      const tail = await p.evaluate(() => { const pop = document.querySelector('.ink-color-panel').getBoundingClientRect(), plus = document.querySelector('.ink-toolbar [data-ink-add-color]').getBoundingClientRect(); return { below: pop.top >= plus.bottom, side: document.querySelector('.ink-color-panel').dataset.side }; });
      assert.deepEqual(tail, { below: true, side: 'below' }, `${tool}: under +`);
      if (photos && tool === 'pen') await p.screenshot({ path: path.join(photos, 'pen-colour-panel.png') });
      // The highlighter: its four colours in the bar are the pastel ones; its panel's first row is the four it had before
      // and a violet, its second row the four and an orange, and the violet of the example is in it too.
      if (tool === 'highlighter') {
        assert.deepEqual(await bar.locator('.ink-colors [data-ink-color]:not([data-ink-custom])').evaluateAll(b => b.map(x => x.dataset.inkColor)), ['#fffc00', '#00f600', '#cc00ee', '#00f4f6']);
        const rows = await panel(p).locator('.ink-text-row').evaluateAll(r => r.map(row => [...row.querySelectorAll('[data-ink-swatch]')].map(b => b.dataset.inkSwatch)));
        assert.deepEqual(rows[0], ['#fde047', '#4ade80', '#f472b6', '#60a5fa', '#c4b5fd'], 'the colours it had before, and a violet');
        assert.deepEqual(rows[1], ['#fffc00', '#00f600', '#cc00ee', '#00f4f6', '#f1a118'], 'the four and the orange');
        assert.ok(rows.flat().includes('#1820e0'), 'the violet of the example');
        assert.ok(rows.slice(0, 4).every(r => r.length === 5), 'five in each row');
        if (photos) { await p.screenshot({ path: path.join(photos, 'highlighter-colour-panel.png') }); await bar.screenshot({ path: path.join(photos, 'highlighter-bar.png') }); }
      }
      // Four rows of five; the first two as they were; no two swatches alike.
      { const rows = (await panel(p).locator('.ink-text-row').evaluateAll(r => r.map(row => [...row.querySelectorAll('[data-ink-swatch]')].map(b => b.dataset.inkSwatch)))).slice(0, 4);
        assert.ok(rows.every(r => r.length === 5), `${tool}: five in each row`);
        if (tool !== 'highlighter') assert.deepEqual(rows.slice(0, 2), [['#000000', '#5f6368', '#9aa0a6', '#d0d3d6', '#ffffff'], ['#1f2937', '#1d4ed8', '#dc2626', '#047857', '#7c3aed']], `${tool}: greys and the pen's colours as they were`);
        assert.deepEqual(lookAlike(rows), [], `${tool}: no two swatches look alike (CIEDE2000 under ${MIN_DELTA_E})`); }
      // A swatch not in the row: added and chosen; the panel closes.
      const fresh = tool === 'highlighter' ? '#fecdd3' : '#9f1239';
      await panel(p).locator(`[data-ink-swatch="${fresh}"]`).click(); await panel(p).waitFor({ state: 'detached' });
      await bar.locator(`[data-ink-custom][data-ink-color="${fresh}"][aria-pressed="true"]`).waitFor();
      assert.ok((await custom(kind)).includes(fresh), `${tool}: kept`);
      // A colour already in the row (a fixed one): only chosen, nothing added.
      const fixed = kind === 'pen' ? '#1d4ed8' : '#00f600', before = await custom(kind);
      await add(); await panel(p).waitFor();
      // The row of colours used lately repeats no swatch of the panel.
      { const rows = await panel(p).locator('.ink-text-row').evaluateAll(r => r.map(row => [...row.querySelectorAll('[data-ink-swatch]')].map(b => b.dataset.inkSwatch)));
        assert.deepEqual(rows.slice(4).flat().filter(c => rows.slice(0, 4).flat().includes(c)), [], `${tool}: no swatch again among the recent colours`); }
      await panel(p).locator(`[data-ink-swatch="${fixed}"]`).click();
      await bar.locator(`[data-ink-color="${fixed}"][aria-pressed="true"]`).waitFor(); assert.deepEqual(await custom(kind), before, `${tool}: nothing added for a colour in the row`);
      // The colour wheel adds its colour.
      const wheel = tool === 'pen' ? '#123456' : tool === 'highlighter' ? '#abcdef' : '#654321';
      await add(); await panel(p).waitFor();
      await panel(p).locator('[data-ink-swatch-custom]').evaluate((input, v) => { input.value = v; input.dispatchEvent(new Event('change', { bubbles: true })); }, wheel);
      await panel(p).waitFor({ state: 'detached' }); await bar.locator(`[data-ink-custom][data-ink-color="${wheel}"][aria-pressed="true"]`).waitFor();
      // Esc closes and gives the focus back to +; arrows move between swatches.
      await add(); await panel(p).waitFor();
      const first = await p.evaluate(() => document.activeElement?.closest('.ink-color-panel') ? document.activeElement.dataset.inkSwatch || 'custom' : null);
      assert.ok(first, `${tool}: the focus is in the panel`);
      const focused = () => p.evaluate(() => document.activeElement?.closest('.ink-color-panel') ? document.activeElement.dataset.inkSwatch || 'custom' : null);
      await p.keyboard.press('ArrowRight'); const moved = await focused(); assert.ok(moved && moved !== first, `${tool}: → moves (${first} → ${moved})`);
      await p.keyboard.press('ArrowDown'); const down = await focused(); assert.ok(down && down !== moved, `${tool}: ↓ moves (${moved} → ${down})`);
      await p.keyboard.press('Escape'); await panel(p).waitFor({ state: 'detached' });
      assert.equal(await p.evaluate(() => document.activeElement?.matches('[data-ink-add-color]')), true, `${tool}: the focus is on + again`);
      // A press outside closes it.
      await add(); await panel(p).waitFor(); await p.mouse.click(5, 890); await panel(p).waitFor({ state: 'detached' });
    }
    // The colours used lately, in the panel's last row (the pen's own, not the text box's).
    await bar.locator('[data-ink-tool="pen"]').click(); await add(); await panel(p).waitFor();
    assert.ok(await panel(p).locator('.ink-text-row:last-child [data-ink-swatch="#123456"]').count(), 'a colour used lately');
    await p.keyboard.press('Escape');
    // After a restart: what was added is still in each row.
    // A stroke drawn in a colour the highlighter had before keeps it; a choice of such a colour saved before this version
    // is read as the pastel colour of the same name.
    const page = await p.locator('.original-pages .page[data-page="1"]').boundingBox();
    await bar.locator('[data-ink-tool="highlighter"]').click(); await add(); await panel(p).locator('[data-ink-swatch="#4ade80"]').click();
    await p.mouse.move(page.x + 80, page.y + 400); await p.mouse.down(); await p.mouse.move(page.x + 300, page.y + 400, { steps: 6 }); await p.mouse.up();
    await p.locator('.ink-status[data-state="saved"]').waitFor({ state: 'attached' });
    const oldStroke = () => p.evaluate(() => [...document.querySelector('.original-pages').inkDoc.strokes.values()].filter(s => s.tool === 'highlighter').map(s => s.color));
    assert.deepEqual(await oldStroke(), ['#4ade80']);
    // The six colours of the example on white paper, laid as the highlighter lays them (multiply, the usual opacity): the
    // colour seen is the example's (each channel within 3).
    const seen = { '#fffc00': '#fffea6', '#00f600': '#a6fca6', '#cc00ee': '#eda6f9', '#00f4f6': '#a6fbfc', '#f1a118': '#fadeae', '#1820e0': '#aeb1f4' };
    const pixel = (x, y) => app.evaluate(async ({ BrowserWindow }, [px, py]) => { const w = BrowserWindow.getAllWindows().find(x => !x.isDestroyed()); const img = await w.webContents.capturePage({ x: Math.round(px), y: Math.round(py), width: 1, height: 1 }); const b = img.toBitmap(); return [b[2], b[1], b[0]]; }, [x, y]);
    const hex = rgb => '#' + rgb.map(v => v.toString(16).padStart(2, '0')).join('');
    for (const [i, c] of Object.keys(seen).entries()) {
      await p.evaluate(color => inkUseColor(color), c); const y = page.y + 120 + i * 34;
      await p.mouse.move(page.x + 80, y); await p.mouse.down(); await p.mouse.move(page.x + 380, y, { steps: 8 }); await p.mouse.up();
    }
    await p.locator('.ink-status[data-state="saved"]').waitFor({ state: 'attached' }); await p.waitForTimeout(300);
    for (const [i, c] of Object.keys(seen).entries()) {
      const got = await pixel(page.x + 230, page.y + 120 + i * 34), want = seen[c].slice(1).match(/../g).map(h => parseInt(h, 16));
      assert.ok(got.every((v, k) => Math.abs(v - want[k]) <= 3), `${c} looks ${hex(got)} on white paper, wanted ${seen[c]}`);
    }
    if (photos) await p.locator('.original-pages .page[data-page="1"]').screenshot({ path: path.join(photos, 'highlighter-six-colours.png') });
    // A text highlight (H) is laid in the same colour.
    await bar.locator('[data-ink-tool="highlighter"]').click(); await p.evaluate(() => inkUseColor('#fffc00')); await bar.locator('[data-ink-tool="read"]').click();
    const span = await p.locator('.original-pages .page[data-page="1"] .textLayer span').first().boundingBox();
    await p.mouse.move(span.x + 2, span.y + span.height / 2); await p.mouse.down(); await p.mouse.move(span.x + span.width - 2, span.y + span.height / 2, { steps: 6 }); await p.mouse.up();
    await p.keyboard.press('h'); await p.waitForFunction(() => [...document.querySelector('.original-pages').inkDoc.strokes.values()].some(s => s.tool === 'mark'));
    assert.equal(await p.evaluate(() => [...document.querySelector('.original-pages').inkDoc.strokes.values()].find(s => s.tool === 'mark').color), '#fffc00');
    await p.locator('.ink-status[data-state="saved"]').waitFor({ state: 'attached' }); await p.waitForTimeout(300);
    if (photos) await p.locator('.original-pages .page[data-page="1"]').screenshot({ path: path.join(photos, 'highlighter-text-mark.png') });
    await bar.locator('[data-ink-tool="read"]').click();
    await p.evaluate(() => { const saved = JSON.parse(localStorage.getItem('app-ink')); saved.color.highlighter = '#4ade80'; saved.custom.highlighter = saved.custom.highlighter.filter(c => c !== '#4ade80'); localStorage.setItem('app-ink', JSON.stringify(saved)); });
    const kept = { pen: await custom('pen'), highlighter: await custom('highlighter') };
    await app.close(); p = await launch();
    await p.locator('.original-pages .page[data-page="1"] .textLayer span').first().waitFor().catch(async () => { await p.locator('.paper-item').first().click(); await p.locator('.original-pages .page[data-page="1"] .textLayer span').first().waitFor(); });
    assert.equal(await p.evaluate(() => globalThis.appInk.color.highlighter), '#00f600', 'a choice of the old green is the new green');
    await p.waitForFunction(() => document.querySelector('.original-pages')?.inkDoc?.strokes.size > 0);
    assert.ok((await oldStroke()).includes('#4ade80'), 'the stroke keeps its colour');
    await p.locator('.paper-item').first().waitFor().catch(() => {});
    assert.deepEqual({ pen: await custom('pen'), highlighter: await custom('highlighter') }, kept, 'kept after a restart');
    await app.close();
    // English at 800px: the panel stays inside the window and shows no Korean.
    p = await launch('en', 800);
    await p.locator('.paper-item').first().click().catch(() => {}); await p.locator('.ink-toolbar [data-ink-add-color]').waitFor();
    await p.locator('.ink-toolbar [data-ink-tool="pen"]').click(); await p.locator('.ink-toolbar [data-ink-add-color]').click(); await panel(p).waitFor();
    const fit = await p.evaluate(() => { const r = document.querySelector('.ink-color-panel').getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight; });
    assert.ok(fit, 'inside the window at 800px');
    assert.doesNotMatch(await panel(p).evaluate(n => n.innerText + [...n.querySelectorAll('[aria-label],[title]')].map(x => (x.getAttribute('aria-label') || '') + (x.getAttribute('title') || '')).join(' ') + n.getAttribute('aria-label')), /[가-힣]/);
    if (photos) await p.screenshot({ path: path.join(photos, 'pen-colour-panel-en-800.png') });
    await app.close(); app = null;
    console.log('Ink colour smoke passed: + opens the text colour panel\'s build for the pen, highlighter and shape tool; swatches and the wheel add and choose, a colour in the row is only chosen; Esc, arrows, a press outside; kept after a restart; English at 800px.');
  } catch (error) { console.error(error); process.exitCode = 1; try { await (await app?.firstWindow())?.screenshot({ path: path.join(os.tmpdir(), `${appName.id}-ink-color-failure.png`) }); } catch {} }
  finally { await app?.close().catch(() => {}); await fs.rm(temp, { recursive: true, force: true }); }
})();
