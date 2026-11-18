// End-to-end check, in the real Electron app (APP_TEST_SOURCE=1 runs from source), of local
// OCR for a slide whose body is a picture: the title is PDF text, the bullets are an image.
// extractPage reads the picture through the main process (desktop/ocr.cjs, tesseract.js) and
// the words join the page's blocks; the title is not read twice; a page with enough text is
// not sent to OCR; the result is cached under userData/ocr.
const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { PDFDocument, StandardFonts } = require('pdf-lib');
const appName = require('../core/app-name.cjs');
const root = path.resolve(__dirname, '..');
(async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), `${appName.id}-ocr-e2e-`)), profile = path.join(temp, 'profile');
  const executable = require('./app-executable.cjs')(root);
  const app = await electron.launch({ executablePath: executable, args: [...(process.env.APP_TEST_SOURCE === '1' ? [root] : []), '--no-sandbox', '--ozone-platform=headless', '--disable-gpu', `--user-data-dir=${profile}`], env: { ...process.env, LC_ALL: 'C.UTF-8' }, timeout: 60000 });
  try {
    const p = await app.firstWindow(); p.setDefaultTimeout(60000); await p.waitForLoadState();
    p.on('pageerror', e => { console.error(e); process.exitCode = 1; });
    // The slide body as a picture: black bullet text on white, drawn by the renderer.
    const body = await p.evaluate(() => {
      const c = document.createElement('canvas'); c.width = 1800; c.height = 600; const g = c.getContext('2d');
      g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.fillStyle = '#111'; g.font = '44px "DejaVu Sans", Arial, sans-serif';
      ['• A generative model turns random noise into new data', '• A condition chooses what to generate'].forEach((t, i) => g.fillText(t, 40, 120 + i * 110));
      return c.toDataURL('image/png');
    });
    const doc = await PDFDocument.create(), font = await doc.embedFont(StandardFonts.HelveticaBold), page = doc.addPage([960, 540]);
    page.drawText('Generative Models', { x: 330, y: 480, size: 32, font });
    page.drawImage(await doc.embedPng(Buffer.from(body.split(',')[1], 'base64')), { x: 30, y: 120, width: 900, height: 300 });
    const text = doc.addPage([960, 540]), regular = await doc.embedFont(StandardFonts.Helvetica);
    text.drawText('A page with its own text layer is never sent to OCR: its words are read from the PDF.', { x: 40, y: 420, size: 16, font: regular });
    text.drawText('Its figure keeps its labels as drawn, as on any page of a paper.', { x: 40, y: 395, size: 16, font: regular });
    text.drawImage(await doc.embedPng(Buffer.from(body.split(',')[1], 'base64')), { x: 30, y: 60, width: 600, height: 200 });
    const bytes = [...await doc.save()];
    const pages = await p.evaluate(async bytes => {
      const view = await import('./pdf-view.js'), pdfjs = await import('./pdfjs/pdf.mjs');
      pdfjs.GlobalWorkerOptions.workerSrc = new URL('./pdfjs/pdf.worker.mjs', location.href).href;
      const pdf = await pdfjs.getDocument({ data: new Uint8Array(bytes), cMapUrl: new URL('./pdfjs/cmaps/', location.href).href, cMapPacked: true, standardFontDataUrl: new URL('./pdfjs/standard_fonts/', location.href).href }).promise;
      const one = await view.extractPage(pdf, 1), two = await view.extractPage(pdf, 2), image = await view.ocrPageImage(pdf, 1), size = await new Promise(r => { const i = new Image(); i.onload = () => r([i.width, i.height]); i.src = image; });
      return [one.blocks.map(b => b.text), two.blocks.map(b => b.text), one.ocr === true, two.ocr === true, image.slice(0, 22), size];
    }, bytes);
    const [slide, prose, slideOcr, proseOcr, imageHead, imageSize] = pages, joined = slide.join(' ');
    assert.equal(slideOcr, true, 'the picture slide is marked as read by OCR'); assert.equal(proseOcr, false);
    assert.equal(imageHead, 'data:image/png;base64,'); assert.deepEqual(imageSize, [1600, 900], 'its picture for the model, 1600 px wide');
    assert.ok(slide.includes('Generative Models'), JSON.stringify(slide));
    assert.equal(slide.filter(t => /Generative Models/.test(t)).length, 1, 'the title is not read twice: ' + JSON.stringify(slide));
    assert.match(joined, /generative model turns random noise into new data/i, JSON.stringify(slide));
    assert.match(joined, /condition chooses what to generate/i, JSON.stringify(slide));
    assert.ok(!/random noise/.test(prose.join(' ')), 'a page with text is not read by OCR: ' + JSON.stringify(prose));
    const cached = (await fs.readdir(path.join(profile, 'ocr'))).filter(f => f.endsWith('.json'));
    assert.equal(cached.length, 1, 'one page read and cached: ' + JSON.stringify(cached));
    // Translated, the slide's requests carry its picture (for what OCR misread); the text page's do not.
    const vault = path.join(temp, 'vault'); await fs.mkdir(vault); await fs.writeFile(path.join(temp, 'slides.pdf'), Buffer.from(bytes));
    await app.evaluate(({ app, dialog }) => {
      globalThis.openQueue = []; dialog.showOpenDialog = async () => ({ canceled: false, filePaths: globalThis.openQueue.shift() });
      const { ChatGPT } = process.getBuiltinModule('module').createRequire(app.getAppPath() + '/package.json')('./desktop/chatgpt.cjs');
      ChatGPT.prototype.status = () => ({ connected: true, usable: true, email: 'fixture@example.test', persistent: false });
      ChatGPT.prototype.models = async () => [{ id: 'fixture-model', name: 'Fixture GPT' }];
      globalThis.contexts = []; ChatGPT.prototype.translate = async (_m, blocks, _s, context) => { globalThis.contexts.push({ ids: blocks.map(b => b.id), images: context.images?.length || 0, pageImage: Boolean(context.pageImage), note: context.pageImageNote || '' }); return blocks.map(b => ({ id: b.id, text: '번역된 문장입니다.' })); };
    });
    await app.evaluate((_, v) => globalThis.openQueue.push([v]), vault); await p.locator('[data-action="storage"]').first().click(); await p.locator('.library').waitFor();
    await app.evaluate((_, f) => globalThis.openQueue.push([f]), path.join(temp, 'slides.pdf')); await p.locator('[data-action="add-files"]').first().click();
    await p.locator('.paper-item').click(); await p.locator('[data-mode="dual"]').click(); await p.locator('#gpt-model').waitFor({ state: 'attached' }); await p.locator('[data-action="gpt-start"]').click();
    await p.waitForFunction(() => document.querySelectorAll('.translated-pane .translated-sheet').length === 2, null, { timeout: 60000 });
    const sent = await app.evaluate(() => globalThis.contexts);
    const slideCalls = sent.filter(c => c.ids.some(id => id.startsWith('p1-'))), textCalls = sent.filter(c => c.ids.some(id => id.startsWith('p2-')));
    assert.ok(slideCalls.length && slideCalls.every(c => c.images === 1 && c.pageImage && /read from by OCR/.test(c.note)), JSON.stringify(sent));
    assert.ok(textCalls.length && textCalls.every(c => c.images === 0 && !c.pageImage), JSON.stringify(sent));
    console.log('PASS OCR: a picture slide read by local OCR into its blocks, the title kept once, a text page left alone, the result cached, the slide translated with its picture');
  } finally {
    await app.close().catch(() => {});
    await fs.rm(temp, { recursive: true, force: true, maxRetries: 5 }).catch(() => {});
  }
})().catch(error => { console.error(error); process.exit(1); });
