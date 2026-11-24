const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { PDFDocument, PDFName, PDFString, StandardFonts } = require('pdf-lib');
const { Library, atomicJson } = require('../desktop/storage.cjs');
const { TranslationJobs } = require('../desktop/translation.cjs');
const { InkStore, renderRevision, viewportTransform, inkedOriginal, inkedHtml, cleanMarks } = require('../desktop/ink.cjs');
const appName = require('../core/app-name.cjs');

// Any model call during ink work fails the test.
// PDF.js wants a trailing forward slash, on Windows too.
const fonts = path.join(__dirname, '..', 'node_modules', 'pdfjs-dist', 'standard_fonts').replace(/\\/g, '/') + '/';
const noModel = new Proxy({}, { get: (_t, name) => () => { throw Error('model called: ' + String(name)); } });
async function samplePdf({ rotate = 0, crop = null, userUnit = null } = {}) {
  const doc = await PDFDocument.create(), font = await doc.embedFont(StandardFonts.Helvetica);
  for (const angle of [rotate, (rotate + 90) % 360]) {
    const page = doc.addPage([600, 800]);
    page.drawText('A research paper connects ideas.', { x: 40, y: 740, size: 12, font });
    page.setRotation({ type: 'degrees', angle });
    if (crop) page.setCropBox(...crop);
    if (userUnit) page.node.set(PDFName.of('UserUnit'), doc.context.obj(userUnit));
  }
  return Buffer.from(await doc.save());
}
async function vault(t, bytes) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `${appName.id}-ink-`)); t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const root = path.join(dir, 'vault'); await fs.mkdir(root); const file = path.join(dir, 'paper.pdf'); await fs.writeFile(file, bytes);
  const library = await Library.open(root); const [result] = await library.importFiles([file]);
  return { dir, root, library, paperId: result.paperId, attachmentId: result.attachmentId };
}
const geometry = { view: [0, 0, 600, 800], rotate: 0, userUnit: 1 };
const stroke = (id, page = 0, extra = {}) => ({ id, page, tool: 'pen', color: '#1d4ed8', width: 1.5, points: [100, 700, 0.5, 0, 140, 690, 0.8, 16, 180, 700, 0.3, 32], device: 'pen', ...extra });
const id = n => `stroke-${String(n).padStart(4, '0')}`;

test('stores strokes in their own log, outside library.json, and restores them on reopen', async t => {
  const { root, library, paperId, attachmentId } = await vault(t, await samplePdf());
  const before = await fs.readFile(path.join(root, appName.vaultDir, 'library.json'));
  const ink = new InkStore(library);
  await ink.apply(paperId, attachmentId, 'original', [{ type: 'add', stroke: stroke(id(1)), geometry }]);
  await ink.apply(paperId, attachmentId, 'original', [{ type: 'add', stroke: stroke(id(2), 1, { tool: 'highlighter', color: '#facc15', width: 12 }), geometry }]);
  await ink.apply(paperId, attachmentId, 'original', [{ type: 'delete', ids: [id(1)] }]);
  assert.deepEqual(await fs.readFile(path.join(root, appName.vaultDir, 'library.json')), before);
  const reopened = new InkStore(await Library.open(root)), view = await reopened.load(paperId, attachmentId, 'original');
  assert.deepEqual(view.strokes.map(s => s.id), [id(2)]); assert.deepEqual(view.deleted, [id(1)]);
  assert.deepEqual(view.strokes[0].points, stroke(id(2)).points); assert.equal(view.strokes[0].tool, 'highlighter');
  // A deleted stroke stays recoverable: undo of an erase restores it.
  await reopened.apply(paperId, attachmentId, 'original', [{ type: 'restore', ids: [id(1)] }]);
  assert.deepEqual((await reopened.load(paperId, attachmentId, 'original')).strokes.map(s => s.id).sort(), [id(1), id(2)]);
});

test('drops a torn final log line and keeps every completed stroke', async t => {
  const { root, library, paperId, attachmentId } = await vault(t, await samplePdf());
  const ink = new InkStore(library);
  for (let n = 1; n <= 3; n++) await ink.apply(paperId, attachmentId, 'original', [{ type: 'add', stroke: stroke(id(n)), geometry }]);
  const log = path.join(root, appName.vaultDir, 'ink', attachmentId, 'original.log');
  await fs.appendFile(log, '{"seq":4,"at":"2026-10-24","hash":"x","ops":[{"type":"add","str');
  const recovered = new InkStore(library), view = await recovered.load(paperId, attachmentId, 'original');
  assert.deepEqual(view.strokes.map(s => s.id), [id(1), id(2), id(3)]);
  assert.equal(await fs.readFile(log, 'utf8'), '');
  await recovered.apply(paperId, attachmentId, 'original', [{ type: 'add', stroke: stroke(id(4)), geometry }]);
  assert.equal((await new InkStore(library).load(paperId, attachmentId, 'original')).strokes.length, 4);
});

test('a log entry replayed after compaction is applied once', async t => {
  const { root, library, paperId, attachmentId } = await vault(t, await samplePdf());
  const ink = new InkStore(library);
  await ink.apply(paperId, attachmentId, 'original', [{ type: 'add', stroke: stroke(id(1)), geometry }]);
  const log = path.join(root, appName.vaultDir, 'ink', attachmentId, 'original.log'), entry = await fs.readFile(log, 'utf8');
  await ink.compact(attachmentId, 'original', await ink.state(attachmentId, 'original'));
  await fs.writeFile(log, entry + entry); // a crash between snapshot and truncation
  const view = await new InkStore(library).load(paperId, attachmentId, 'original');
  assert.deepEqual(view.strokes.map(s => s.id), [id(1)]);
});

test('rejects malformed strokes and unknown surfaces before writing', async t => {
  const { root, library, paperId, attachmentId } = await vault(t, await samplePdf());
  const ink = new InkStore(library);
  for (const bad of [{ ...stroke(id(1)), points: [1, 2, 3] }, { ...stroke(id(1)), color: 'red' }, { ...stroke(id(1)), tool: 'script' }, { ...stroke(id(1)), points: [1, 2, 5, 0] }])
    await assert.rejects(ink.apply(paperId, attachmentId, 'original', [{ type: 'add', stroke: bad, geometry }]), /필기 변경/);
  await assert.rejects(ink.apply(paperId, attachmentId, '../library', [{ type: 'delete', ids: [id(1)] }]), /필기 대상/);
  await assert.rejects(ink.load(paperId, attachmentId, 't-zz'), /필기 대상/);
  await assert.rejects(fs.stat(path.join(root, appName.vaultDir, 'ink', attachmentId, 'original.log')), { code: 'ENOENT' });
});

test('ink on a translation keeps that translation as a base after a re-translation, without any model call', async t => {
  const { root, library, paperId, attachmentId } = await vault(t, await samplePdf());
  const translations = new TranslationJobs(noModel), cacheFile = translations.file(library, paperId, attachmentId);
  const sourceHash = library.attachment(paperId, attachmentId).sourceHash;
  const page = { width: 800, height: 1066.67, blocks: [{ id: 'p1-b1', text: 'A research paper connects ideas.', translation: '연구 논문은 아이디어를 연결합니다.', x: 53, y: 70, width: 400, height: 20, fontSize: 16 }] };
  const first = { version: 1, sourceHash, model: 'fixture', promptVersion: 'v', language: 'ko', createdAt: '2026-10-24T00:00:00.000Z', pages: [page, page] };
  await atomicJson(cacheFile, first);
  const cached = () => translations.cached(library, paperId, attachmentId);
  const revision = renderRevision(await cached()); assert.equal(revision, renderRevision(first));
  const ink = new InkStore(library);
  await ink.apply(paperId, attachmentId, 't-' + revision, [{ type: 'add', stroke: stroke(id(1)), geometry }], cached);
  const cacheBytes = await fs.readFile(cacheFile);
  await ink.apply(paperId, attachmentId, 't-' + revision, [{ type: 'add', stroke: stroke(id(2), 1), geometry }, { type: 'delete', ids: [id(2)] }, { type: 'restore', ids: [id(2)] }], cached);
  assert.deepEqual(await fs.readFile(cacheFile), cacheBytes, 'ink never rewrites the translation cache');
  // The user re-translates: the cache now holds a different record.
  const second = { ...first, createdAt: '2026-10-25T00:00:00.000Z', pages: [{ ...page, blocks: [{ ...page.blocks[0], translation: '다른 번역' }] }, page] };
  await atomicJson(cacheFile, second);
  const reopened = new InkStore(await Library.open(root));
  assert.deepEqual((await reopened.load(paperId, attachmentId, 't-' + revision)).strokes.map(s => s.id), [id(1), id(2)]);
  const base = await reopened.translationBase(attachmentId, revision);
  assert.equal(base.pages[0].blocks[0].translation, '연구 논문은 아이디어를 연결합니다.'); assert.equal(renderRevision(base), revision);
  assert.deepEqual((await reopened.surfaces(paperId, attachmentId)).map(s => [s.revision, s.strokes]), [[revision, 2]]);
  // Writing on a translation that is neither kept nor current is refused.
  await assert.rejects(reopened.apply(paperId, attachmentId, 't-' + 'a'.repeat(24), [{ type: 'add', stroke: stroke(id(3)), geometry }], cached), /번역이 바뀌었습니다/);
});

test('ink written before the source PDF changed is kept but not shown or edited', async t => {
  const { root, library, paperId, attachmentId } = await vault(t, await samplePdf());
  const ink = new InkStore(library);
  await ink.apply(paperId, attachmentId, 'original', [{ type: 'add', stroke: stroke(id(1)), geometry }]);
  const file = await library.resolveFile(paperId, 'attachment-' + attachmentId);
  await fs.writeFile(file, await samplePdf({ rotate: 90 }));
  const fresh = new InkStore(library), view = await fresh.load(paperId, attachmentId, 'original');
  assert.equal(view.stale, true); assert.deepEqual(view.strokes, []);
  await assert.rejects(fresh.apply(paperId, attachmentId, 'original', [{ type: 'delete', ids: [id(1)] }]), /원문 파일이 바뀌어/);
  assert.match(await fs.readFile(path.join(root, appName.vaultDir, 'ink', attachmentId, 'original.log'), 'utf8'), new RegExp(id(1)));
});

test('the export transform matches PDF.js for rotation, CropBox and UserUnit within 0.5pt', async () => {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  for (const options of [{ rotate: 0 }, { rotate: 90, crop: [30, 40, 500, 700] }, { rotate: 180, crop: [10, 20, 580, 760] }, { rotate: 270, userUnit: 2 }]) {
    const pdf = await pdfjs.getDocument({ data: new Uint8Array(await samplePdf(options)), isEvalSupported: false, standardFontDataUrl: fonts }).promise;
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n), g = { view: page.view, rotate: page.rotate, userUnit: page.userUnit };
      for (const zoom of [0.5, 1, 2, 4]) {
        const reference = page.getViewport({ scale: zoom * 4 / 3 }), mine = viewportTransform(g, zoom * 4 / 3);
        mine.transform.forEach((v, i) => assert.ok(Math.abs(v - reference.transform[i]) < 1e-9, `transform ${options.rotate}° ${zoom}`));
        assert.ok(Math.abs(mine.width - reference.width) < 1e-9 && Math.abs(mine.height - reference.height) < 1e-9);
        // Screen point → stored PDF point → screen point.
        for (const [x, y] of [[10, 10], [reference.width / 2, reference.height / 3], [reference.width - 5, reference.height - 5]]) {
          const [px, py] = reference.convertToPdfPoint(x, y), back = reference.convertToViewportPoint(Math.round(px * 100) / 100, Math.round(py * 100) / 100);
          assert.ok(Math.hypot(back[0] - x, back[1] - y) / (zoom * 4 / 3) < 0.5, 'round trip within 0.5pt');
        }
      }
    }
    await pdf.loadingTask.destroy();
  }
});

test('with ink the original PDF gains standard Ink annotations; its text stays', async () => {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs'), source = await samplePdf({ rotate: 90, crop: [30, 40, 500, 700] });
  const ink = { strokes: [stroke(id(1)), stroke(id(2), 1, { tool: 'highlighter', color: '#facc15', width: 12 })], pages: { 0: geometry, 1: geometry } };
  const output = await inkedOriginal(source, ink);
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(output), isEvalSupported: false, standardFontDataUrl: fonts }).promise;
  assert.equal(pdf.numPages, 2);
  for (let n = 1; n <= 2; n++) {
    const page = await pdf.getPage(n), [annotation] = await page.getAnnotations();
    assert.equal(annotation.subtype, 'Ink'); assert.equal(annotation.titleObj?.str ?? annotation.title, appName.name);
    const [x0, y0, x1, y1] = annotation.rect;
    assert.ok(x0 < 100 && x1 > 180 && y0 < 690 && y1 > 700, 'rect covers the stroke in PDF user space');
    assert.equal(annotation.hasAppearance, true);
    assert.match((await page.getTextContent()).items.map(i => i.str).join(''), /A research paper connects ideas\./);
  }
  await pdf.loadingTask.destroy();
  // Each annotation is named <id>-<stroke id> and written by the app.
  const saved = await PDFDocument.load(output), names = saved.getPages().flatMap(page => page.node.lookup(PDFName.of('Annots')).asArray().map(ref => saved.context.lookup(ref)));
  assert.deepEqual(names.map(a => a.get(PDFName.of('NM')).decodeText()), [`${appName.id}-` + id(1), `${appName.id}-` + id(2)]); assert.ok(names.every(a => a.get(PDFName.of('T')).decodeText() === appName.name));
  // Without strokes nothing is added.
  const untouched = await PDFDocument.load(await inkedOriginal(source, { strokes: [], pages: {} })), annots = untouched.getPages()[0].node.lookup(PDFName.of('Annots'));
  assert.ok(!annots || annots.size() === 0);
});

test('translation export draws ink only on its page, in that page\'s pixel space', () => {
  const html = '<style>body{}</style><section class="page" data-source-page="1" style="width:800px;height:1066.667px"><img src="data:image/png;base64,AA=="></section><section class="page" data-source-page="2" style="width:1066.667px;height:800px"><img src="data:image/png;base64,AA=="></section>';
  const pages = [{ width: 800, height: 1066.667 }, { width: 1066.667, height: 800 }];
  assert.equal(inkedHtml(html, pages, { strokes: [], pages: {} }).includes('<svg'), false);
  const rotated = { view: [0, 0, 600, 800], rotate: 90, userUnit: 1 };
  const out = inkedHtml(html, pages, { strokes: [stroke(id(1), 1)], pages: { 1: rotated } });
  const first = out.indexOf('data-source-page="1"'), second = out.indexOf('data-source-page="2"'), svg = out.indexOf('<svg class="app-ink"');
  assert.ok(svg > second && svg < out.lastIndexOf('</section>'));
  assert.equal(out.slice(first, second).includes('<svg'), false);
  // PDF (100,700) on a 90° page at 4/3: x = 700·4/3, y = 100·4/3.
  assert.match(out, /M933\.33\d 133\.33\d/);
});
test('text highlights and page memos export as standard Highlight and Text annotations and print on translations', async () => {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const mark = { id: 'mark-00001', page: 0, tool: 'mark', color: '#facc15', width: 1, points: [], rects: [[40, 735, 260, 750], [40, 720, 200, 735]], quote: 'A research paper connects ideas.' };
  const memo = { id: 'memo-00001', page: 0, tool: 'text', color: '#dc2626', width: 12, points: [300, 600, 0, 0], text: '확인 필요\n두 번째 줄' };
  const shape = { ...stroke('shape-0001'), shape: 'rect', from: 'stroke-0001' };
  const output = await inkedOriginal(await samplePdf(), { strokes: [mark, memo, shape], pages: { 0: geometry } });
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(output), isEvalSupported: false, standardFontDataUrl: fonts }).promise;
  const annotations = await (await pdf.getPage(1)).getAnnotations(), byType = Object.fromEntries(annotations.map(a => [a.subtype, a]));
  assert.deepEqual(Object.keys(byType).sort(), ['Highlight', 'Ink', 'Text']);
  assert.equal(byType.Highlight.contentsObj.str, 'A research paper connects ideas.');
  assert.equal(byType.Highlight.quadPoints.length, 16);
  assert.equal(byType.Text.contentsObj.str, '확인 필요\n두 번째 줄');
  await pdf.loadingTask.destroy();
  const svg = inkedHtml('<style></style><section class="page" data-source-page="1" style=""></section>', [{ width: 800, height: 1066.667 }], { strokes: [mark, memo], pages: { 0: geometry } });
  assert.match(svg, /<path d="M53\.33\d* (?:6[0-9]|7[0-9])\.\d+h293\.33\d*v/);
  assert.match(svg, /<tspan x="400" dy="0">확인 필요<\/tspan><tspan x="400" dy="20\.8">두 번째 줄<\/tspan>/);
  // A styled box: bold, italic, underline, and centred on its kept width.
  const styled = { ...memo, id: 'memo-00004', width: 24, bold: true, italic: true, underline: true, align: 'center', w: 60 };
  const look = inkedHtml('<style></style><section class="page" data-source-page="1" style=""></section>', [{ width: 800, height: 1066.667 }], { strokes: [styled], pages: { 0: geometry } });
  assert.match(look, /<text x="440" [^>]*text-anchor="middle" font-weight="700" font-style="italic" text-decoration="underline"><tspan x="440" dy="0">확인 필요/);
});
// The figure boxes and annotation underlines shown on the original, saved with its ink.
const marksOf = doc => doc.getPages().map(page => (page.node.lookup(PDFName.of('Annots'))?.asArray() || []).map(ref => {
  const a = doc.context.lookup(ref), ap = a.lookup(PDFName.of('AP')).lookup(PDFName.of('N'));
  return { subtype: a.get(PDFName.of('Subtype')).toString(), rect: a.lookup(PDFName.of('Rect')).asArray().map(n => n.asNumber()), line: a.lookup(PDFName.of('L'))?.asArray().map(n => n.asNumber()), flags: a.get(PDFName.of('F'))?.asNumber(), stream: Buffer.from(ap.getContents()).toString() };
}));
test('shown figure boxes and annotation underlines go into the original as dashed 1.5pt annotations', async () => {
  const marks = { boxes: [{ page: 0, rect: { x: .1, y: .2, width: .3, height: .25 } }], underlines: [{ page: 0, rects: [[72, 700, 300, 712], [72, 686, 250, 698]] }] };
  const doc = await PDFDocument.load(await inkedOriginal(await samplePdf(), { strokes: [], pages: {} }, marks)), [first, second] = marksOf(doc);
  assert.equal(second.length, 0, 'the other page has none');
  assert.deepEqual(first.map(m => m.subtype), ['/Square', '/Line', '/Line']); assert.ok(first.every(m => m.flags === 4 && /\[4 3\] 0 d/.test(m.stream) && /1\.5 w/.test(m.stream)));
  assert.match(first[0].stream, /0\.106 0\.392 0\.855 RG/); assert.ok(first.slice(1).every(m => /1 0\.69 0\.125 RG/.test(m.stream)));
  // The box: x 0.1–0.4 of 600, y 0.2–0.45 of 800 from the top (PDF y up: 440–640).
  assert.deepEqual(first[0].rect, [60, 440, 240, 640]); assert.match(first[0].stream, /60\.75 440\.75 178\.5 198\.5 re S/);
  // Each underline along its rect's lower edge (as seen), inside it by half the line.
  assert.deepEqual(first[1].line, [72, 700.75, 300, 700.75]); assert.deepEqual(first[2].line, [72, 686.75, 250, 686.75]);
});
test('on a turned, cropped page a box sits where it is seen, as ink does', async () => {
  const source = await samplePdf({ rotate: 90, crop: [30, 40, 500, 700] }), geometry = { view: [30, 40, 530, 740], rotate: 90, userUnit: 1 }, rect = { x: .1, y: .2, width: .3, height: .25 }; // setCropBox(x, y, width, height)
  for (const box of [{ page: 0, rect }, { page: 0, rect, geometry }]) {
    const [[square]] = marksOf(await PDFDocument.load(await inkedOriginal(source, { strokes: [], pages: {} }, { boxes: [box], underlines: [] })));
    const { transform: m, width, height } = viewportTransform(geometry, 1), at = (x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
    const [x0, y0, x1, y1] = square.rect, corners = [at(x0, y0), at(x1, y1)];
    const seen = { x: Math.min(...corners.map(c => c[0])) / width, y: Math.min(...corners.map(c => c[1])) / height, width: Math.abs(corners[0][0] - corners[1][0]) / width, height: Math.abs(corners[0][1] - corners[1][1]) / height };
    for (const k of Object.keys(rect)) assert.ok(Math.abs(seen[k] - rect[k]) < 0.002, JSON.stringify({ box, seen }));
  }
  // An underline on that page lies under the line as seen (the viewer's bottom edge), not along the PDF's own bottom.
  const [[line]] = marksOf(await PDFDocument.load(await inkedOriginal(source, { strokes: [], pages: {} }, { boxes: [], underlines: [{ page: 0, rects: [[100, 300, 112, 500]] }] })));
  const { transform: m } = viewportTransform(geometry, 1), at = (x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]], [s, e] = [at(line.line[0], line.line[1]), at(line.line[2], line.line[3])];
  const p = at(100, 300), q = at(112, 500);
  assert.ok(Math.abs(s[1] - e[1]) < 1e-6 && Math.abs(s[1] - (Math.max(p[1], q[1]) - .75)) < .01, JSON.stringify({ s, e, p, q }));
});
test('nothing to add leaves the original byte for byte; odd marks are left out', async () => {
  const source = await samplePdf();
  assert.deepEqual(await inkedOriginal(source, { strokes: [], pages: {} }, { boxes: [], underlines: [] }), source);
  assert.deepEqual(await inkedOriginal(source, null, { boxes: [], underlines: [] }), source);
  const good = { page: 0, rect: { x: .1, y: .1, width: .2, height: .2 } };
  const cleaned = cleanMarks({ boxes: [good, { page: -1, rect: good.rect }, { page: 0, rect: { x: 2, y: 0, width: .1, height: .1 } }, { page: 0, rect: { x: 0, y: 0, width: 0, height: .1 } }, { page: 0, rect: good.rect, geometry: { view: [0, 0], rotate: 45 } }, null],
    underlines: [{ page: 1, rects: [[1, 2, 3, 4]] }, { page: 0, rects: [] }, { page: 0, rects: [[1, 2, 3]] }, { page: 1.5, rects: [[1, 2, 3, 4]] }, { page: 0, rects: Array(201).fill([1, 2, 3, 4]) }] });
  assert.deepEqual(cleaned, { boxes: [good], underlines: [{ page: 1, rects: [[1, 2, 3, 4]] }] });
  assert.deepEqual(cleanMarks(undefined), { boxes: [], underlines: [] }); assert.deepEqual(cleanMarks('x'), { boxes: [], underlines: [] });
  assert.equal(cleanMarks({ boxes: Array(2500).fill(good) }).boxes.length, 2000);
  // A page past the end is drawn nowhere.
  assert.deepEqual(marksOf(await PDFDocument.load(await inkedOriginal(source, { strokes: [], pages: {} }, { boxes: [{ ...good, page: 9 }], underlines: [] }))).flat(), []);
});
// A one-page PDF whose page dictionary is set by hand (values pdf-lib's own setters refuse).
async function oddPage(set) {
  const doc = await PDFDocument.create(), page = doc.addPage([600, 800]); set(page, doc);
  return Buffer.from(await doc.save());
}
const finiteStreams = doc => marksOf(doc).flat().every(m => !/NaN|Infinity/.test(m.stream) && m.rect.every(Number.isFinite));
test('a page laid out by PDF.js rules when none was sent: odd /Rotate, turned or apart boxes, a bad UserUnit', async () => {
  const box = { page: 0, rect: { x: .1, y: .2, width: .3, height: .25 } }, nothing = { strokes: [], pages: {} };
  // /Rotate 45 is read as 0, as PDF.js does: the box where an upright page has it (it threw before, failing the whole save).
  const turned = await oddPage((page, doc) => page.node.set(PDFName.of('Rotate'), doc.context.obj(45)));
  assert.deepEqual(marksOf(await PDFDocument.load(await inkedOriginal(turned, nothing, { boxes: [box], underlines: [] })))[0][0].rect, [60, 440, 240, 640]);
  // A CropBox given the wrong way round is put right; one that does not meet the MediaBox gives way to it.
  for (const [crop, want] of [[[600, 800, -600, -800], [60, 440, 240, 640]], [[700, 900, 100, 100], [60, 440, 240, 640]]]) {
    const pdf = await oddPage((page, doc) => page.node.set(PDFName.of('CropBox'), doc.context.obj([crop[0], crop[1], crop[0] + crop[2], crop[1] + crop[3]])));
    const [[square]] = marksOf(await PDFDocument.load(await inkedOriginal(pdf, nothing, { boxes: [box], underlines: [] })));
    assert.deepEqual(square.rect, want, JSON.stringify(crop)); assert.ok(square.rect.every(v => v >= 0 && v <= 800), 'on the page');
  }
  // A UserUnit of zero is read as 1.
  const unit = await oddPage((page, doc) => page.node.set(PDFName.of('UserUnit'), doc.context.obj(0)));
  assert.deepEqual(marksOf(await PDFDocument.load(await inkedOriginal(unit, nothing, { boxes: [box], underlines: [] })))[0][0].rect, [60, 440, 240, 640]);
});
test('a page dictionary pdf-lib would refuse is read as PDF.js reads it, and never fails the save', async () => {
  const box = { page: 0, rect: { x: .1, y: .2, width: .3, height: .25 } }, upright = [60, 440, 240, 640];
  // Two pages: page 0 set by hand, page 1 inked. Saved, the ink on page 1 is there and the box on page 0 where PDF.js shows it.
  const twoPages = async set => { const doc = await PDFDocument.create(); set(doc.addPage([600, 800]), doc); doc.addPage([600, 800]); return Buffer.from(await doc.save()); };
  const cases = [
    ['/UserUnit /Two', (page, doc) => page.node.set(PDFName.of('UserUnit'), PDFName.of('Two')), upright],
    ['/UserUnit (2)', (page, doc) => page.node.set(PDFName.of('UserUnit'), PDFString.of('2')), upright],
    ['/Rotate /Foo', (page, doc) => page.node.set(PDFName.of('Rotate'), PDFName.of('Foo')), upright],
    ['a CropBox of three numbers', (page, doc) => page.node.set(PDFName.of('CropBox'), doc.context.obj([0, 0, 300])), upright],
    ['a CropBox holding a name', (page, doc) => page.node.set(PDFName.of('CropBox'), doc.context.obj([0, 0, PDFName.of('Wide'), 400])), upright],
    ['a MediaBox holding a name', (page, doc) => page.node.set(PDFName.of('MediaBox'), doc.context.obj([0, 0, PDFName.of('Wide'), 800])), [61.2, 435.6, 244.8, 633.6]],
    ['an empty MediaBox', (page, doc) => page.node.set(PDFName.of('MediaBox'), doc.context.obj([0, 0, 0, 800])), [61.2, 435.6, 244.8, 633.6]],
    ['no MediaBox (US Letter, as PDF.js)', page => page.node.delete(PDFName.of('MediaBox')), [61.2, 435.6, 244.8, 633.6]],
    ['a MediaBox given by reference', (page, doc) => page.node.set(PDFName.of('MediaBox'), doc.context.register(doc.context.obj([0, 0, 600, 800]))), upright],
  ];
  for (const [name, set, want] of cases) {
    const out = await inkedOriginal(await twoPages(set), { strokes: [stroke(id(1), 1)], pages: {} }, cleanMarks({ boxes: [box], underlines: [] }));
    assert.deepEqual(out.added, { strokes: 1, marks: 1 }, name);
    const [[square], [pen]] = marksOf(await PDFDocument.load(out));
    assert.deepEqual(square.rect.map(v => Math.round(v * 10) / 10), want, name); assert.equal(pen.subtype, '/Ink', name);
  }
  // A page geometry from the renderer that is not of that shape is not used: the page is read instead.
  const bad = await inkedOriginal(await samplePdf(), { strokes: [], pages: { 0: { view: [0, 0], rotate: 45, userUnit: 1 } } }, { boxes: [box], underlines: [] });
  assert.deepEqual(marksOf(await PDFDocument.load(bad))[0][0].rect, upright);
});
test('a mark whose numbers come out not finite or past 1e6 is left out alone; with nothing left the source stays as it is', async () => {
  const source = await samplePdf(), nothing = { strokes: [], pages: {} }, box = { x: .1, y: .2, width: .3, height: .25 };
  for (const geometry of [{ view: [0, 0, 600, 800], rotate: 0, userUnit: 5e-324 }, { view: [0, 0, 1e308, 1e308], rotate: 0, userUnit: 1 }]) {
    const out = await inkedOriginal(source, nothing, { boxes: [{ page: 0, rect: box, geometry }], underlines: [{ page: 0, rects: [[72, 700, 300, 712]], geometry }] });
    assert.deepEqual(out, source, JSON.stringify(geometry)); assert.deepEqual(out.added, { strokes: 0, marks: 0 });
  }
  // Beside a good one, only the bad one is left out, and nothing not finite is written.
  const mixed = await inkedOriginal(source, nothing, { boxes: [{ page: 0, rect: box, geometry: { view: [0, 0, 1e308, 1e308], rotate: 0, userUnit: 1 } }, { page: 0, rect: box }], underlines: [] });
  assert.deepEqual(mixed.added, { strokes: 0, marks: 1 }); const doc = await PDFDocument.load(mixed); assert.equal(marksOf(doc)[0].length, 1); assert.ok(finiteStreams(doc));
  // Marks only on pages the file does not have: nothing goes in, the bytes are the source's.
  const away = await inkedOriginal(source, nothing, { boxes: [{ page: 5, rect: box }], underlines: [{ page: 7, rects: [[1, 2, 3, 4]] }] });
  assert.deepEqual(away, source); assert.deepEqual(away.added, { strokes: 0, marks: 0 });
});
test('one underline per line: boxes of one line joined, at the screen\'s height whatever the UserUnit', async () => {
  const nothing = { strokes: [], pages: {} };
  // A selection that gave one line two overlapping boxes, and one that touches: one line each; the next line apart.
  const lines = marksOf(await PDFDocument.load(await inkedOriginal(await samplePdf(), nothing, { boxes: [], underlines: [{ page: 0, rects: [[72, 700, 200, 712], [190, 700.5, 300, 711.5], [72, 686, 150, 698], [150.5, 686, 250, 698]] }] })))[0];
  assert.deepEqual(lines.map(l => l.line), [[72, 700.75, 300, 700.75], [72, 686.75, 250, 686.75]]);
  // Saved selections from a real paper: a line given a box of the letters' cores and one of the whole letters, the same
  // width. The underline goes under the whole letters (below p, y, g), as on a line given one box.
  const real = [[[37.5, 611.5, 477.5, 631.2], [37.5, 596.7, 445.4, 610.2], [37.5, 594.3, 445.4, 613.9], [37.5, 577.1, 286.6, 596.7]], [[37.5, 294.3, 288.6, 302.3], [37.5, 293.5, 288.6, 304.2], [37.5, 283.9, 288.6, 291.9], [37.5, 283.1, 288.6, 293.8]]];
  const realLines = marksOf(await PDFDocument.load(await inkedOriginal(await samplePdf(), nothing, { boxes: [], underlines: real.map(rects => ({ page: 0, rects })) })))[0];
  assert.deepEqual(realLines.map(l => l.line.map(n => Math.round(n * 100) / 100)), [[37.5, 612.25, 477.5, 612.25], [37.5, 595.05, 445.4, 595.05], [37.5, 577.85, 286.6, 577.85], [37.5, 294.25, 288.6, 294.25], [37.5, 283.85, 288.6, 283.85]]);
  // On a page of UserUnit 2 the screen draws 1.5 × 2 px, its middle 1.5 px above the bottom: 0.75 of the page's units.
  const big = await oddPage((page, doc) => page.node.set(PDFName.of('UserUnit'), doc.context.obj(2)));
  const [[line]] = marksOf(await PDFDocument.load(await inkedOriginal(big, nothing, { boxes: [], underlines: [{ page: 0, rects: [[72, 700, 300, 712]] }] })));
  assert.deepEqual(line.line, [72, 700.75, 300, 700.75]);
  // The 1e6 bound is on the page's own units: a page of UserUnit 2000 (seen 1.2 million pixels wide) keeps its marks.
  const huge = await oddPage((page, doc) => page.node.set(PDFName.of('UserUnit'), doc.context.obj(2000)));
  const [[square, hugeLine]] = marksOf(await PDFDocument.load(await inkedOriginal(huge, nothing, { boxes: [{ page: 0, rect: { x: .1, y: .2, width: .3, height: .25 } }], underlines: [{ page: 0, rects: [[72, 700, 300, 712]] }] })));
  assert.deepEqual([square.rect, hugeLine.line], [[60, 440, 240, 640], [72, 700.75, 300, 700.75]]);
  // The same joining as the screen's (core/ink-marks.cjs).
  const { joinLineBoxes } = require('../core/ink-marks.cjs');
  // A line's underline runs under all its boxes, under the deepest of those that cover half the line or more.
  assert.deepEqual(joinLineBoxes([[10, 10, 50, 22], [45, 10.5, 90, 21.5], [10, 30, 40, 42], [200, 10, 220, 22]]), [[10, 10, 90, 22], [200, 10, 220, 22], [10, 30, 40, 42]]);
  // Words in boxes of their own, none half the line: the bottom most of the line's width shares, the deeper on a tie.
  assert.deepEqual(joinLineBoxes([[0, 0, 40, 12], [42, 0, 80, 12], [82, 1, 90, 13], [92, 0, 130, 12]]), [[0, 0, 130, 12]]);
  assert.deepEqual(joinLineBoxes([[0, 0, 40, 12], [42, 2, 82, 14]]), [[0, 2, 82, 14]]);
  assert.deepEqual(joinLineBoxes([]), []); assert.deepEqual(joinLineBoxes([[5, 22, 1, 10]]), [[1, 10, 5, 22]]);
  // Lines are told by the boxes as given, not by boxes already joined: a drop cap two lines high joins neither line,
  // and each line keeps its own underline.
  assert.deepEqual(joinLineBoxes([[0, 0, 30, 26], [30, 0, 300, 12], [30, 14, 300, 26]]), [[0, 0, 30, 26], [30, 0, 300, 12], [30, 14, 300, 26]]);
  // A subscript joins its line without pulling the underline down into the next line.
  assert.deepEqual(joinLineBoxes([[30, 0, 300, 12], [100, 3, 106, 15], [30, 14, 300, 26]]), [[30, 0, 300, 12], [30, 14, 300, 26]]);
  // What is not four finite numbers is left out.
  assert.deepEqual(joinLineBoxes([null, 'x', [1, 2, 3], [1, 2, NaN, 4], [0, Infinity, 1, 2], [0, 0, 10, 10]]), [[0, 0, 10, 10]]);
  assert.deepEqual(joinLineBoxes(null), []);
});
test('underline boxes are capped at 5000 in all', () => {
  const rects = Array(200).fill([1, 2, 3, 4]), many = cleanMarks({ underlines: Array(40).fill({ page: 0, rects }) });
  assert.equal(many.underlines.reduce((n, u) => n + u.rects.length, 0), 5000); assert.equal(many.underlines.length, 25);
});
test('malformed highlights and memos are refused', async t => {
  const { library, paperId, attachmentId } = await vault(t, await samplePdf());
  const ink = new InkStore(library);
  const bad = [{ id: 'mark-00002', page: 0, tool: 'mark', color: '#facc15', width: 1, points: [], rects: [], quote: '' }, { id: 'memo-00002', page: 0, tool: 'text', color: '#dc2626', width: 12, points: [1, 2, 0, 0], text: '  ' }, { ...stroke('shape-0002'), shape: 'star' }];
  for (const s of bad) await assert.rejects(ink.apply(paperId, attachmentId, 'original', [{ type: 'add', stroke: s, geometry }]), /필기 변경/);
  const memo = { id: 'memo-00002', page: 0, tool: 'text', color: '#dc2626', width: 12, points: [1, 2, 0, 0], text: '메모' };
  for (const look of [{ bold: 'yes' }, { align: 'justify' }, { w: -1 }, { width: 80 }]) await assert.rejects(ink.apply(paperId, attachmentId, 'original', [{ type: 'add', stroke: { ...memo, ...look }, geometry }]), /필기 변경/);
  await ink.apply(paperId, attachmentId, 'original', [{ type: 'add', stroke: { ...memo, id: 'memo-00003' }, geometry }, { type: 'add', stroke: { ...memo, id: 'memo-00005', width: 24, bold: true, italic: true, underline: true, align: 'right', w: 31.5 }, geometry }]);
  const kept = (await new InkStore(library).load(paperId, attachmentId, 'original')).strokes;
  assert.equal(kept[0].text, '메모');
  assert.deepEqual([kept[1].bold, kept[1].italic, kept[1].underline, kept[1].align, kept[1].w, kept[1].width], [true, true, true, 'right', 31.5, 24], 'a box keeps its look');
  // Triangles, arrows and straightened highlighter lines are stored with their shape.
  await ink.apply(paperId, attachmentId, 'original', [{ type: 'add', stroke: { ...stroke('shape-0003'), shape: 'triangle' }, geometry }, { type: 'add', stroke: { ...stroke('shape-0004'), shape: 'arrow' }, geometry }, { type: 'add', stroke: { ...stroke('shape-0005'), tool: 'highlighter', width: 12, shape: 'line' }, geometry }]);
  assert.deepEqual((await new InkStore(library).load(paperId, attachmentId, 'original')).strokes.filter(s => s.shape).map(s => s.tool + ':' + s.shape), ['pen:triangle', 'pen:arrow', 'highlighter:line']);
});
test('a text box keeps its fill and border; a wrong one is refused', async t => {
  const { library, paperId, attachmentId } = await vault(t, await samplePdf());
  const ink = new InkStore(library), memo = { id: 'memo-00010', page: 0, tool: 'text', color: '#dc2626', width: 12, points: [1, 2, 0, 0], text: '메모', w: 24 };
  for (const look of [{ fill: 'yellow' }, { fill: '#fff' }, { border: null }, { border: { color: '#000000', width: 0.4, style: 'solid' } }, { border: { color: '#000000', width: 6.5, style: 'solid' } }, { border: { color: '#000000', width: 1, style: 'double' } }, { border: { width: 1, style: 'solid' } }, { border: { color: '#000000', width: 1, style: 'solid', radius: 3 } }])
    await assert.rejects(ink.apply(paperId, attachmentId, 'original', [{ type: 'add', stroke: { ...memo, ...look }, geometry }]), /필기 변경/, JSON.stringify(look));
  const framed = { ...memo, id: 'memo-00011', fill: '#FFF3BF', border: { color: '#1B64DA', width: 1.5, style: 'dashed' } };
  await ink.apply(paperId, attachmentId, 'original', [{ type: 'add', stroke: memo, geometry }, { type: 'add', stroke: framed, geometry }]);
  const [plain, kept] = (await new InkStore(library).load(paperId, attachmentId, 'original')).strokes;
  assert.equal('fill' in plain || 'border' in plain, false, 'a box without them has none');
  assert.deepEqual([kept.fill, kept.border], ['#fff3bf', { color: '#1b64da', width: 1.5, style: 'dashed' }]);
  // A state merged from another device keeps them as well.
  await ink.replaceState(attachmentId, 'original', { strokes: [kept], pages: { 0: geometry } });
  assert.deepEqual((await new InkStore(library).load(paperId, attachmentId, 'original')).strokes[0].border, kept.border);
});
test('a printed text box draws its fill and border around its text, padding and border', () => {
  const page = '<style></style><section class="page" data-source-page="1" style=""></section>', size = [{ width: 800, height: 1066.667 }];
  const memo = { id: 'memo-00012', page: 0, tool: 'text', color: '#dc2626', width: 12, points: [300, 600, 0, 0], text: '확인 필요\n두 번째 줄', w: 60 };
  assert.doesNotMatch(inkedHtml(page, size, { strokes: [memo], pages: { 0: geometry } }), /<rect/, 'no fill or border, nothing around the text');
  // At 4/3 px a point: the text at (400, 266.667), 80 wide, two lines of 12pt (41.6 high); padding 3pt and a 1.5pt
  // border outside it (6px in all), the border's line along its middle.
  const svg = inkedHtml(page, size, { strokes: [{ ...memo, fill: '#fff3bf', border: { color: '#1b64da', width: 1.5, style: 'dashed' } }], pages: { 0: geometry } });
  assert.match(svg, /<rect x="394" y="260\.667" width="92" height="53\.6" fill="#fff3bf" stroke="none"\/><rect x="395" y="261\.667" width="90" height="51\.6" fill="none" stroke="#1b64da" stroke-width="2" stroke-linecap="butt" stroke-linejoin="miter" stroke-dasharray="6 4"\/><text /);
  const dotted = inkedHtml(page, size, { strokes: [{ ...memo, border: { color: '#000000', width: 3, style: 'dotted' } }], pages: { 0: geometry } });
  assert.match(dotted, /<rect x="394" y="260\.667" width="92" height="53\.6" fill="none" stroke="#000000" stroke-width="4" stroke-linecap="round" stroke-linejoin="miter" stroke-dasharray="0 8"\/>/);
  assert.doesNotMatch(dotted, /<rect[^>]*fill="#/, 'a border alone: no fill');
  assert.doesNotMatch(inkedHtml(page, size, { strokes: [{ ...memo, border: { color: '#000000', width: 1, style: 'solid' } }], pages: { 0: geometry } }), /dasharray/, 'a solid line has no dashes');
});
test('printed ink keeps the screen\'s order: highlighter first, then everything as it was made', () => {
  const page = '<style></style><section class="page" data-source-page="1" style=""></section>', size = [{ width: 800, height: 1066.667 }];
  const box = { id: 'memo-00020', page: 0, tool: 'text', color: '#dc2626', width: 12, points: [300, 600, 0, 0], text: '상자', w: 30, fill: '#fff3bf' };
  const line = { ...stroke('stroke-0020'), points: [290, 610, 0.5, 0, 340, 590, 0.5, 16] }, marker = { ...stroke('stroke-0021'), tool: 'highlighter', color: '#facc15', width: 12 };
  const svg = inkedHtml(page, size, { strokes: [box, line, marker], pages: { 0: geometry } });
  const at = s => svg.indexOf(s), rect = at('<rect'), pen = at('stroke="#1d4ed8"'), mark = at('stroke="#facc15"');
  assert.ok(mark >= 0 && rect > mark && pen > rect, 'the highlighter under all, the line drawn after the box over its fill');
});
test('colours read from disk go into the print only as #rrggbb', () => {
  const page = '<style></style><section class="page" data-source-page="1" style=""></section>', size = [{ width: 800, height: 1066.667 }];
  const box = { id: 'memo-00021', page: 0, tool: 'text', color: '#dc2626"><script>x</script>', width: 12, points: [300, 600, 0, 0], text: '상자', w: 30, fill: '#fff"/><script>y</script>', border: { color: '#000000', width: 1, style: 'solid' } };
  const svg = inkedHtml(page, size, { strokes: [box], pages: { 0: geometry } });
  assert.doesNotMatch(svg, /script/); assert.doesNotMatch(svg, /<rect/, 'a look that is not valid is not drawn'); assert.match(svg, /<text [^>]*fill="#000000"/);
});
// A highlight over several lines, as a selection gives it: for every line wholly inside the selection both the line's
// element box and its text box, and the boxes of neighbouring lines meeting by a fraction of a point.
const selected = [[71.99, 697.66, 255.96, 711.31], [71.99, 684.84, 275.29, 696.84], [71.99, 684.63, 275.29, 698.28], [71.99, 671.88, 259.96, 683.88], [71.99, 671.67, 259.96, 685.32], [71.99, 658.85, 267.29, 670.85], [71.99, 658.63, 267.29, 672.29], [71.99, 645.68, 255.97, 659.33]];
test('an underline of several lines is one line under each: the two boxes a selection gives a whole line are one', () => {
  const { underlineBoxes } = require('../core/ink-marks.cjs');
  // Drawn from every box, each line but the first and the last had two underlines a fifth of a point apart.
  const lines = underlineBoxes(selected);
  assert.equal(lines.length, 5, JSON.stringify(lines));
  assert.deepEqual(lines.map(b => [b[0], b[2]]), [[71.99, 255.96], [71.99, 275.29], [71.99, 259.96], [71.99, 267.29], [71.99, 255.97]], 'each as wide as its line, from the top line down');
  assert.deepEqual(lines.map(b => b[1]), [697.66, 684.63, 671.67, 658.63, 645.68], 'under the whole letters (the lower of a line\'s two boxes)');
  assert.deepEqual(underlineBoxes([[10, 100, 60, 112], [70, 100, 120, 112]]), [[10, 100, 60, 112], [70, 100, 120, 112]], 'two columns on one row keep their own lines');
  assert.deepEqual(underlineBoxes([null, [1, 2, NaN, 4]]), []);
});
test('a highlight of several lines is painted once everywhere: one box per line, filled as one shape', async () => {
  const { highlightBoxes } = require('../core/ink-marks.cjs');
  // The boxes that lie within another are left out; what is left is one box per line.
  assert.deepEqual(highlightBoxes(selected), [[71.99, 697.66, 255.96, 711.31], [71.99, 684.63, 275.29, 698.28], [71.99, 671.67, 259.96, 685.32], [71.99, 658.63, 267.29, 672.29], [71.99, 645.68, 255.97, 659.33]]);
  assert.deepEqual(highlightBoxes([[1, 2, 3, 4], [1, 2, 3, 4], [3, 4, 1, 2]]), [[1, 2, 3, 4]], 'the same box given twice (or the wrong way round) is one');
  assert.deepEqual(highlightBoxes([null, [1, 2, NaN, 4], [0, 0, 5, 5]]), [[0, 0, 5, 5]]);
  // Saved: one Highlight with one quad per line, its appearance one shape filled once (all boxes, then a single f).
  const mark = { id: 'mark-00009', page: 0, tool: 'mark', color: '#facc15', width: 1, points: [], rects: selected, quote: 'five lines' };
  const doc = await PDFDocument.load(await inkedOriginal(await samplePdf(), { strokes: [mark], pages: {} }));
  const [annotation] = doc.getPage(0).node.lookup(PDFName.of('Annots')).asArray().map(ref => doc.context.lookup(ref));
  assert.equal(annotation.lookup(PDFName.of('QuadPoints')).size(), 5 * 8);
  const stream = Buffer.from(annotation.lookup(PDFName.of('AP')).lookup(PDFName.of('N')).getContents()).toString();
  assert.equal((stream.match(/ re\b/g) || []).length, 5); assert.equal((stream.match(/\bf\b/g) || []).length, 1, stream);
  // Printed over a translation: one path for the highlight, so its translucency is laid once where boxes meet.
  const svg = inkedHtml('<style></style><section class="page" data-source-page="1" style=""></section>', [{ width: 800, height: 1066.667 }], { strokes: [mark], pages: { 0: geometry } });
  assert.equal((svg.match(/fill-opacity/g) || []).length, 1, svg); assert.match(svg, /<path d="M[^"]*Z[^"]*Z[^"]*Z[^"]*Z[^"]*Z" fill="#facc15" fill-opacity="0\.35"/);
  // The same rule on the screen (desktop/ink.js) is checked by the pixels in tests/highlight-smoke.cjs.
});
