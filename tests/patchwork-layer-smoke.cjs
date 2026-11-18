// End-to-end check, in the real Electron app (APP_TEST_SOURCE=1 runs from source), of a scan
// whose text layer is a patchwork (hidden text in pieces behind many small pictures, as old
// capture tools wrote): the layer's pieces are joined line by line, without OCR, and the page
// is marked for translation with its picture. A searchable image (one page picture, hidden
// text) is read as before. A translation stored from the raw layer is still checked against it.
const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { PDFDocument, StandardFonts, setTextRenderingMode, TextRenderingMode } = require('pdf-lib');
const appName = require('../core/app-name.cjs');
const root = path.resolve(__dirname, '..');
const LINES = ['The purpose of quantitative measurements is to predict', 'some useful information from the instrument response.', 'A mathematical formula is needed for this prediction', 'and its parameters are found by calibration against', 'samples whose concentrations are already known well.', 'Several different measurements remove interferences.'];
(async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), `${appName.id}-reread-e2e-`)), profile = path.join(temp, 'profile');
  const executable = require('./app-executable.cjs')(root);
  const app = await electron.launch({ executablePath: executable, args: [...(process.env.APP_TEST_SOURCE === '1' ? [root] : []), '--no-sandbox', '--ozone-platform=headless', '--disable-gpu', `--user-data-dir=${profile}`], env: { ...process.env, LC_ALL: 'C.UTF-8' }, timeout: 60000 });
  try {
    const p = await app.firstWindow(); p.setDefaultTimeout(120000); await p.waitForLoadState();
    p.on('pageerror', e => { console.error(e); process.exitCode = 1; });
    // The scanned page as a picture, whole and cut into 4 x 3 tiles.
    const { whole, tiles } = await p.evaluate(lines => {
      const c = document.createElement('canvas'); c.width = 1600; c.height = 900; const g = c.getContext('2d');
      g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.fillStyle = '#111'; g.font = '40px "DejaVu Serif", Georgia, serif';
      lines.forEach((t, i) => g.fillText(t, 80, 150 + i * 110));
      const tiles = [];
      for (let r = 0; r < 3; r++) for (let k = 0; k < 4; k++) { const t = document.createElement('canvas'); t.width = 400; t.height = 300; t.getContext('2d').drawImage(c, k * 400, r * 300, 400, 300, 0, 0, 400, 300); tiles.push(t.toDataURL('image/png')); }
      return { whole: c.toDataURL('image/png'), tiles };
    }, LINES);
    const png = url => Buffer.from(url.split(',')[1], 'base64');
    const doc = await PDFDocument.create(), font = await doc.embedFont(StandardFonts.TimesRoman);
    // The capture tool's reading, in pieces, with its misreadings ("rneasurernents").
    // Each line is set justified, with its last word after a gap of 1.5em: down the lines these gaps line up
    // like the gap between two columns.
    const hidden = page => {
      const size = 16, rows = LINES.map(t => t.replace(/m/g, 'rn').split(' ')), wide = words => words.reduce((n, w) => n + font.widthOfTextAtSize(w, size), 0), edge = 40 + Math.max(...rows.map(words => wide(words.slice(0, -1)) + (words.length - 2) * 4));
      page.pushOperators(setTextRenderingMode(TextRenderingMode.Invisible));
      rows.forEach((words, i) => { const y = 450 - (150 + i * 110) / 2, head = words.slice(0, -1), gap = (edge - 40 - wide(head)) / (head.length - 1); head.reduce((x, word) => { page.drawText(word, { x, y, size, font }); return x + font.widthOfTextAtSize(word, size) + gap; }, 40); page.drawText(words.at(-1), { x: edge + size * 1.5, y, size, font }); });
      // The bar over a letter of the second line, read by the tool as a line of its own between two lines.
      page.drawText('- -1', { x: 200, y: 450 - (150 + 110) / 2 + 9, size, font });
      page.pushOperators(setTextRenderingMode(TextRenderingMode.Fill));
    };
    const patch = doc.addPage([800, 450]);
    for (let i = 0; i < tiles.length; i++) patch.drawImage(await doc.embedPng(png(tiles[i])), { x: (i % 4) * 200, y: 450 - (Math.floor(i / 4) + 1) * 150, width: 200, height: 150 });
    hidden(patch);
    const searchable = doc.addPage([800, 450]); searchable.drawImage(await doc.embedPng(png(whole)), { x: 0, y: 0, width: 800, height: 450 }); hidden(searchable);
    const bytes = [...await doc.save()];
    const r = await p.evaluate(async bytes => {
      const view = await import('./pdf-view.js'), pdfjs = await import('./pdfjs/pdf.mjs');
      pdfjs.GlobalWorkerOptions.workerSrc = new URL('./pdfjs/pdf.worker.mjs', location.href).href;
      const pdf = await pdfjs.getDocument({ data: new Uint8Array(bytes), cMapUrl: new URL('./pdfjs/cmaps/', location.href).href, cMapPacked: true, standardFontDataUrl: new URL('./pdfjs/standard_fonts/', location.href).href }).promise;
      const one = await view.extractPage(pdf, 1), layer = await view.extractPage(pdf, 1, true), two = await view.extractPage(pdf, 2);
      const text = q => q.blocks.map(b => b.text).join(' | '), old = await view.canonicalFor(pdf, 1, { blocks: layer.blocks }), fresh = await view.canonicalFor(pdf, 1, { blocks: one.blocks });
      return { one: text(one), layer: text(layer), two: text(two), counts: [one.blocks.length, layer.blocks.length], flags: [one.joined === true, one.ocr === true, layer.joined === true, layer.ocr === true, two.joined === true, two.ocr === true], old: [old.joined === true, text(old)], fresh: fresh.joined === true };
    }, bytes);
    assert.deepEqual(r.flags, [true, true, false, false, false, false], 'only the patchwork page is joined, and marked for its picture: ' + JSON.stringify(r.flags));
    assert.equal(r.one, LINES.join(' | ').replace(/m/g, 'rn'), 'each line of the layer whole, in order (the fixture sets its lines far apart)');
    assert.match(r.layer, /- -1/, 'the raw layer holds the accent read as a line'); assert.ok(!/- -1/.test(r.one), 'joined, it is dropped: ' + r.one);
    assert.ok(r.counts[1] > r.counts[0], 'the raw layer falls into more pieces: ' + r.layer);
    assert.equal(r.old[0], false, 'a translation stored from the raw layer is checked against it'); assert.equal(r.old[1], r.layer);
    assert.equal(r.fresh, true, 'a translation made from the joined lines is checked against them');
    assert.equal((await fs.readdir(path.join(profile, 'ocr')).catch(() => [])).filter(f => f.endsWith('.json')).length, 0, 'no page is sent to OCR');
    console.log('PASS patchwork layer: its pieces joined line by line without OCR, a searchable image read as before, a stored translation kept with the reading it came from');
  } finally {
    await app.close().catch(() => {});
    await fs.rm(temp, { recursive: true, force: true, maxRetries: 5 }).catch(() => {});
  }
})().catch(error => { console.error(error); process.exit(1); });
