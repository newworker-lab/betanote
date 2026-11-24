// A text highlight over several lines is painted once everywhere, on the screen and in the saved original: a selection
// gives each line wholly inside it two boxes (and neighbouring lines meet), and the middle lines used to come out darker.
// Also a pen highlighter stroke that goes back over itself. APP_TEST_SOURCE=1 runs from source.
const { _electron: electron } = require('playwright');
const path = require('node:path'), fs = require('node:fs/promises'), os = require('node:os');
const assert = require('node:assert/strict'), root = path.resolve(__dirname, '..'), { PDFDocument, StandardFonts } = require('pdf-lib');
const appName = require('../core/app-name.cjs');
(async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), `${appName.id}-highlight-`)), out = temp, vault = path.join(temp, 'vault'), pdf = path.join(temp, 'lines.pdf'); await fs.mkdir(vault);
  const doc = await PDFDocument.create(), font = await doc.embedFont(StandardFonts.Helvetica), page = doc.addPage([600, 800]);
  const text = ['The first line of the passage reads.', 'The second line of the passage reads.', 'The third line of the passage reads.', 'The fourth line of the passage reads.', 'The fifth line of the passage reads.'];
  text.forEach((t, i) => page.drawText(t, { x: 72, y: 700 - i * 13, size: 12, font }));
  ['A short pair, line one here.', 'A short pair, line two here.'].forEach((t, i) => page.drawText(t, { x: 72, y: 500 - i * 13, size: 12, font }));
  await fs.writeFile(pdf, await doc.save());
  const app = await electron.launch({ env: { ...process.env, LC_ALL: 'C.UTF-8', APP_UI_LANG: 'ko' }, executablePath: require('./app-executable.cjs')(root), args: [...(process.env.APP_TEST_SOURCE === '1' ? [root] : []), '--no-sandbox', '--ozone-platform=headless', '--disable-gpu', `--user-data-dir=${path.join(temp, 'profile')}`], timeout: 30000 });
  const p = await app.firstWindow(); p.setDefaultTimeout(20000);
  await app.evaluate(({ dialog, BrowserWindow }) => { globalThis.openQueue = []; globalThis.saveQueue = []; dialog.showOpenDialog = async () => ({ canceled: false, filePaths: globalThis.openQueue.shift() }); dialog.showSaveDialog = async () => ({ canceled: false, filePath: globalThis.saveQueue.shift() }); BrowserWindow.getAllWindows()[0].setSize(1400, 1000); }, null);
  await app.evaluate((_, v) => globalThis.openQueue.push([v]), vault); await p.locator('[data-action="storage"]').first().click(); await p.locator('.library').waitFor();
  await app.evaluate((_, f) => globalThis.openQueue.push([f]), pdf); await p.locator('[data-action="add-files"]').first().click(); await p.locator('.paper-item').first().click();
  await p.locator('.original-pages .page[data-page="1"] .textLayer span').first().waitFor(); await p.locator('.ink-toolbar').waitFor(); await p.waitForTimeout(500);
  const select = (from, to) => p.evaluate(([from, to]) => { const spans = [...document.querySelectorAll('.original-pages .page[data-page="1"] .textLayer span')].filter(s => s.textContent.trim()); const range = document.createRange(); range.setStart(spans[from].firstChild, 0); range.setEnd(spans[to].firstChild, spans[to].firstChild.length); getSelection().removeAllRanges(); getSelection().addRange(range); }, [from, to]);
  const saved = () => p.locator('.ink-status[data-state="saved"]').waitFor({ state: 'attached' });
  await select(0, 4); await p.locator('[data-ink-mark]').click(); await saved();
  await select(5, 6); await p.locator('[data-ink-mark]').click(); await saved(); await p.waitForTimeout(400);
  // The pen highlighter: one stroke that goes over the same place three times (right, back, right again).
  const at = (x, y) => p.evaluate(([x, y]) => { const view = document.querySelector('.original-pages').pdfViewer.getPageView(0), d = view.div.getBoundingClientRect(), v = view.viewport.convertToViewportPoint(x, y), f = d.width / view.viewport.width; return [d.left + v[0] * f, d.top + v[1] * f]; }, [x, y]);
  await p.locator('[data-ink-tool="highlighter"]').click();
  const pts = [[330, 650], [450, 650], [330, 652], [450, 654]]; const first = await at(...pts[0]); await p.mouse.move(...first); await p.mouse.down();
  for (let i = 1; i < pts.length; i++) { const from = await at(...pts[i - 1]), to = await at(...pts[i]); for (let s = 1; s <= 12; s++) await p.mouse.move(from[0] + (to[0] - from[0]) * s / 12, from[1] + (to[1] - from[1]) * s / 12); }
  await p.mouse.up(); await saved(); await p.waitForTimeout(400);
  await p.locator('[data-ink-tool="read"]').click();
  // The canvas colour down one column (x at the text's start + 30pt), with the rects stored.
  const report = await p.evaluate(() => {
    const view = document.querySelector('.original-pages').pdfViewer.getPageView(0), vp = view.viewport, canvas = view.div.querySelector(':scope>.app-ink-layer'), k = canvas.width / vp.width, ctx = canvas.getContext('2d');
    const marks = [...(document.querySelector('.original-pages').inkDoc?.strokes?.values() || [])].filter(s => s.tool === 'mark').map(s => s.rects);
    const column = (pdfX, top, bottom) => { const x = Math.round(vp.convertToViewportPoint(pdfX, 0)[0] * k), y0 = Math.round(vp.convertToViewportPoint(0, top)[1] * k), y1 = Math.round(vp.convertToViewportPoint(0, bottom)[1] * k); const runs = []; for (let y = y0; y <= y1; y++) { const d = ctx.getImageData(x, y, 1, 1).data, c = d.join(','); if (!runs.length || runs.at(-1).c !== c) runs.push({ c, from: y, to: y }); else runs.at(-1).to = y; } return runs.map(r => `${r.c} ×${r.to - r.from + 1}`); };
    return { marks, five: column(102, 716, 640), two: column(102, 516, 480), pen: column(390, 662, 642) };
  });
  // Inside each highlight one colour from top to bottom (only its antialiased edges differ): the middle lines as the
  // first and last, five lines as two; the pen stroke laid once where it goes back over itself.
  const body = runs => runs.filter(r => !r.startsWith('0,0,0,0') && !/ ×1$/.test(r));
  for (const [name, runs] of Object.entries({ five: report.five, two: report.two, pen: report.pen })) assert.equal(body(runs).length, 1, `${name}: ${JSON.stringify(runs)}`);
  assert.equal(body(report.five)[0].split(' ')[0], body(report.two)[0].split(' ')[0], 'five lines as light as two');
  // The same five lines underlined: the selection gives the lines wholly inside it two boxes each, and one line is drawn under each line.
  await select(0, 4); await p.evaluate(() => { const sel = getSelection(); inkMarkSelection({ range: sel.getRangeAt(0).cloneRange(), quote: String(sel).trim() }, 'underline'); }); await saved();
  const underline = await p.evaluate(() => { const s = [...document.querySelector('.original-pages').inkDoc.strokes.values()].find(s => s.tool === 'mark' && s.style === 'underline'); return { boxes: s.rects.length, lines: globalThis.appInkMarks.underlineBoxes(s.rects).length }; });
  assert.ok(underline.boxes > 5, `the selection gave more boxes than lines: ${JSON.stringify(underline)}`); assert.equal(underline.lines, 5, 'one underline a line on the screen');
  // Saved original PDF with ink.
  const file = path.join(out, 'saved.pdf'); await fs.rm(file, { force: true }); await app.evaluate((_, f) => globalThis.saveQueue.push(f), file);
  await p.locator('[data-action="ink-export-original"]').click(); await p.locator('#dialog #ink-export-include').waitFor(); if (!await p.locator('#dialog #ink-export-include').isChecked()) await p.locator('#dialog #ink-export-include').click();
  await p.locator('#dialog [data-action="ink-export-confirm"]').click(); for (let i = 0; i < 100; i++) { try { if ((await fs.stat(file)).size) break; } catch {} await new Promise(r => setTimeout(r, 100)); }
  // Saved: one Highlight, one quad per line, its appearance filled once.
  const saved5 = await PDFDocument.load(await fs.readFile(file)), annots = saved5.getPage(0).node.lookup(require('pdf-lib').PDFName.of('Annots')).asArray().map(ref => saved5.context.lookup(ref));
  const highlights = annots.filter(a => a.get(require('pdf-lib').PDFName.of('Subtype')).toString() === '/Highlight').map(a => a.lookup(require('pdf-lib').PDFName.of('QuadPoints')).size() / 8).sort();
  assert.deepEqual(highlights, [2, 5]);
  // The underline too: one quad, and one bar in its appearance, per line.
  const under = annots.filter(a => a.get(require('pdf-lib').PDFName.of('Subtype')).toString() === '/Underline');
  assert.deepEqual(under.map(a => a.lookup(require('pdf-lib').PDFName.of('QuadPoints')).size() / 8), [5], 'one underline a line in the saved PDF');
  await app.close(); await fs.rm(temp, { recursive: true, force: true });
  console.log('Highlight smoke passed: a text highlight over five lines is one colour on every line on the screen and in the saved PDF; a pen highlighter stroke going back over itself is laid once; an underline over five lines is one line under each.');
})().catch(e => { console.error(e); process.exit(1); });
