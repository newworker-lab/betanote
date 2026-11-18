// Local OCR for pages whose text is a picture (a slide deck exported as images,
// a scan without a text layer). Runs tesseract.js in worker threads of the main process, a few
// at once (see PageOcr), created on first use. Results are cached per
// page under userData/ocr, keyed by the PDF's fingerprint, the page and the
// rendered size, so a page is read once.
const fs = require('node:fs/promises');
const path = require('node:path');
const {tr}=require('../core/i18n.js');

const KEY = /^[A-Za-z0-9_-]{1,80}$/;
const MAX_PNG = 40 * 1024 * 1024;

// Inside a packaged app the language data and the WASM core live in
// app.asar.unpacked (a worker thread cannot read from the archive).
function unpacked(file) { return file.replace(/app\.asar([\\/])/, 'app.asar.unpacked$1'); }

class PageOcr {
  // `workers`: how many pages are read at once. Each is a tesseract worker thread of its own
  // (about 100 MB while it holds a page), started only when a page waits and none is free,
  // so one slide costs one worker and a long scan is read on several cores.
  constructor({ directory, createWorker = () => require('tesseract.js').createWorker, workers = Math.max(1, Math.min(3, require('node:os').availableParallelism() - 1)) }) {
    this.directory = directory;
    this.createWorker = createWorker;
    this.size = workers;
    this.pool = [];      // { worker: Promise, busy }
    this.waiting = [];   // resolvers of requests waiting for a free worker
    this.pending = new Map();
    this.data = null;
  }
  // The language data, put where tesseract.js looks first; once for all workers.
  async language() {
    if (!this.data) this.data = (async () => {
      const langPath = unpacked(path.join(path.dirname(require.resolve('@tesseract.js-data/eng/package.json')), '4.0.0_best_int'));
      const cachePath = path.join(this.directory, 'ocr', 'data');
      await fs.mkdir(cachePath, { recursive: true });
      // Under Electron tesseract.js treats a local langPath as a URL and fetches
      // it; it reads its cache first, so the bundled data is put there.
      const cached = path.join(cachePath, 'eng.traineddata');
      try { await fs.access(cached); } catch {
        const data = require('node:zlib').gunzipSync(await fs.readFile(path.join(langPath, 'eng.traineddata.gz')));
        await fs.writeFile(cached + '.tmp', data); await fs.rename(cached + '.tmp', cached);
      }
      return { langPath, cachePath };
    })().catch(error => { this.data = null; throw error; });
    return this.data;
  }
  async start() {
    const { langPath, cachePath } = await this.language();
    // A failure inside the worker rejects that request; it never takes the app down.
    return this.createWorker()('eng', 1, { langPath, gzip: true, cachePath, errorHandler: error => console.error('OCR', error) });
  }
  // A free worker, a new one while fewer than `size` run, or the next one freed.
  async acquire() {
    let slot = this.pool.find(s => !s.busy);
    if (!slot && this.pool.length < this.size) { slot = { worker: this.start(), busy: false }; this.pool.push(slot); }
    if (!slot) slot = await new Promise(resolve => this.waiting.push(resolve));
    slot.busy = true;
    try { return { slot, worker: await slot.worker }; }
    catch (error) { this.pool = this.pool.filter(s => s !== slot); this.release(null); throw error; }
  }
  release(slot) {
    if (slot) slot.busy = false;
    const next = this.waiting.shift();
    if (!next) return;
    if (slot) { slot.busy = true; next(slot); }
    else { const made = { worker: this.start(), busy: true }; this.pool.push(made); next(made); }
  }
  // `key` names the page (fingerprint, page number, size); `png` is the page as drawn.
  recognize(key, png) {
    if (typeof key !== 'string' || !KEY.test(key)) return Promise.reject(Error(tr('OCR 페이지를 확인할 수 없습니다.')));
    if (!(png instanceof Uint8Array) || png.byteLength < 8 || png.byteLength > MAX_PNG || png[0] !== 0x89 || png[1] !== 0x50) return Promise.reject(Error(tr('OCR 이미지가 올바르지 않습니다.')));
    // The same page asked twice at once is read once.
    if (!this.pending.has(key)) { const run = this.read(key, png).finally(() => { if (this.pending.get(key) === run) this.pending.delete(key); }); this.pending.set(key, run); }
    return this.pending.get(key);
  }
  async read(key, png) {
    const file = path.join(this.directory, 'ocr', key + '.json');
    try { const cached = JSON.parse(await fs.readFile(file, 'utf8')); if (cached?.version === 1) return cached; } catch {}
    const { slot, worker } = await this.acquire();
    let data;
    try { ({ data } = await worker.recognize(Buffer.from(png), {}, { blocks: true, text: false, hocr: false, tsv: false })); }
    finally { this.release(slot); }
    const result = { version: 1, lines: linesOf(data) };
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file + '.tmp', JSON.stringify(result));
    await fs.rename(file + '.tmp', file);
    return result;
  }
  async close() {
    const pool = this.pool; this.pool = [];
    for (const waiting of this.waiting.splice(0)) waiting({ worker: Promise.reject(Error(tr('OCR을 닫았습니다.'))), busy: false });
    await Promise.all(pool.map(async s => (await s.worker.catch(() => null))?.terminate().catch(() => {})));
  }
}

// Lines of words with their boxes (image pixels), baseline and confidence:
// all the layout needs, nothing of tesseract's own structure.
function linesOf(data) {
  const lines = [];
  for (const block of data?.blocks || []) for (const paragraph of block.paragraphs || []) for (const line of paragraph.lines || []) {
    const words = (line.words || []).filter(w => String(w.text || '').trim()).map(w => ({ text: String(w.text).trim(), x0: w.bbox.x0, y0: w.bbox.y0, x1: w.bbox.x1, y1: w.bbox.y1, confidence: Math.round(w.confidence) }));
    if (!words.length) continue;
    const base = line.baseline || {}, row = line.rowAttributes || {};
    lines.push({ words, baseline: Number.isFinite(base.y0) && Number.isFinite(base.y1) ? [base.x0, base.y0, base.x1, base.y1] : null, rowHeight: Number(row.row_height) || null, confidence: Math.round(line.confidence) });
  }
  return lines;
}

module.exports = { PageOcr, linesOf, unpacked };
