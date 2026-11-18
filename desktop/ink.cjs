// Handwriting store and export. Ink is the app's own layer: the source PDF and
// the translation cache are never rewritten, and nothing here calls a model.
const { escapeHtml } = require('../core/pdf-layout.js');
const {tr}=require('../core/i18n.js');
const fs = require('node:fs/promises');
const path = require('node:path');
const appName = require('../core/app-name.cjs');
const crypto = require('node:crypto');
const { atomicJson, readJson, KeyedQueue } = require('./storage.cjs');
const { VAULT_DIR } = require('./legacy.cjs');
const { joinLineBoxes, highlightBoxes, validTextLook, cleanTextLook, hexColor, textLook, textBoxFrame, textBorderDash } = require('../core/ink-marks.cjs');

// pen/highlighter: free strokes; text: a page memo at a point; mark: a
// highlight anchored to selected text (its line boxes and quote), or with
// style 'underline' a line under each box.
const TOOLS = ['pen', 'highlighter', 'text', 'mark'];
const HIGHLIGHT_OPACITY = 0.35;
const MAX_POINTS = 20000, MAX_STROKES = 100000, MAX_OPS = 200, COMPACT_AFTER = 400;
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
// A stored translation is identified by its content, so a later re-translation
// (a new record) never silently takes over ink written on the earlier one.
function renderRevision(record) {
  if (!record || !Array.isArray(record.pages)) return null;
  const { sourceHash, model, promptVersion, language, createdAt, pages } = record;
  return sha(JSON.stringify({ sourceHash, model, promptVersion, language, createdAt, pages })).slice(0, 24);
}
// A refusal is told by its code: the page reads the code, never the wording.
const inkError = (message, code) => Object.assign(Error(message), { code });
function surfaceName(value) {
  if (value === 'original' || /^t-[a-f0-9]{24}$/.test(value)) return value;
  throw Error(tr('필기 대상을 확인하세요.'));
}
// PDF.js PageViewport, so export maps stored PDF user-space points exactly as
// the viewer did: CropBox origin, /Rotate and /UserUnit included.
function viewportTransform({ view, rotate = 0, userUnit = 1 }, scale = 1) {
  const s = scale * userUnit, cx = (view[2] + view[0]) / 2, cy = (view[3] + view[1]) / 2;
  const r = ((rotate % 360) + 360) % 360;
  const [a, b, c, d] = { 0: [1, 0, 0, -1], 90: [0, 1, 1, 0], 180: [-1, 0, 0, 1], 270: [0, -1, -1, 0] }[r];
  let ox, oy, width, height;
  if (a === 0) { ox = Math.abs(cy - view[1]) * s; oy = Math.abs(cx - view[0]) * s; width = (view[3] - view[1]) * s; height = (view[2] - view[0]) * s; }
  else { ox = Math.abs(cx - view[0]) * s; oy = Math.abs(cy - view[1]) * s; width = (view[2] - view[0]) * s; height = (view[3] - view[1]) * s; }
  return { transform: [a * s, b * s, c * s, d * s, ox - a * s * cx - c * s * cy, oy - b * s * cx - d * s * cy], width, height };
}
const apply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
// The renderer and the PDF both use this width curve, so pressure looks the same.
const pressureWidth = (width, p) => width * (0.4 + 1.2 * p);

function validGeometry(g) {
  return g && Array.isArray(g.view) && g.view.length === 4 && g.view.every(Number.isFinite) && g.view[2] > g.view[0] && g.view[3] > g.view[1] &&
    [0, 90, 180, 270].includes(((g.rotate % 360) + 360) % 360) && Number.isFinite(g.userUnit) && g.userUnit > 0 && g.userUnit <= 75000;
}
// Shapes drawn with the shape tool or straightened by holding the pen still.
const SHAPES = ['line', 'rect', 'ellipse', 'triangle', 'arrow'];
// An underline is a thin bar along the bottom of a line box (PDF y grows upward).
function underlineBar(r) { const t = Math.max(0.6, Math.min(2, (r[3] - r[1]) * 0.07)); return [r[0], r[1], r[2], r[1] + t]; }
function validStroke(s) {
  if (!s || typeof s.id !== 'string' || !/^[-a-zA-Z0-9]{8,64}$/.test(s.id) || !Number.isInteger(s.page) || s.page < 0 || s.page > 9999) return false;
  if (!TOOLS.includes(s.tool) || typeof s.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(s.color) || !Number.isFinite(s.width) || s.width < 0.1 || s.width > 100) return false;
  if (s.from !== undefined && (typeof s.from !== 'string' || !/^[-a-zA-Z0-9]{8,64}$/.test(s.from)) || s.shape !== undefined && !SHAPES.includes(s.shape)) return false;
  if (s.tool === 'mark') return (s.style === undefined || s.style === 'underline') && Array.isArray(s.rects) && s.rects.length >= 1 && s.rects.length <= 200 && s.rects.every(r => Array.isArray(r) && r.length === 4 && r.every(v => Number.isFinite(v) && Math.abs(v) <= 1e6)) && typeof s.quote === 'string' && s.quote.length <= 10000 && Array.isArray(s.points) && !s.points.length;
  if (s.tool === 'text' && (typeof s.text !== 'string' || !s.text.trim() || s.text.length > 2000 || s.points?.length !== 4 || s.width < 6 || s.width > 72)) return false;
  // A text box's look (optional): bold, italic, underline, alignment, its text's width in PDF units (for alignment and
  // the box's size), and a fill and a border (core/ink-marks.cjs).
  if (s.tool === 'text' && (['bold', 'italic', 'underline'].some(k => s[k] !== undefined && s[k] !== true) || s.align !== undefined && !['center', 'right'].includes(s.align) || s.w !== undefined && !(Number.isFinite(s.w) && s.w > 0 && s.w <= 1e4) || !validTextLook(s))) return false;
  if (!Array.isArray(s.points) || !s.points.length || s.points.length % 4 || s.points.length > MAX_POINTS * 4) return false;
  for (let i = 0; i < s.points.length; i += 4) {
    const [x, y, p, t] = s.points.slice(i, i + 4);
    if (![x, y, p, t].every(Number.isFinite) || Math.abs(x) > 1e6 || Math.abs(y) > 1e6 || p < 0 || p > 1 || t < 0) return false;
  }
  return s.device === undefined || ['pen', 'mouse', 'touch'].includes(s.device);
}
function cleanStroke(s) { return { id: s.id, page: s.page, tool: s.tool, color: s.color.toLowerCase(), width: s.width, points: [...s.points], ...(s.device ? { device: s.device } : {}), ...(s.tool === 'text' ? { text: s.text, ...(s.bold ? { bold: true } : {}), ...(s.italic ? { italic: true } : {}), ...(s.underline ? { underline: true } : {}), ...(s.align ? { align: s.align } : {}), ...(s.w ? { w: s.w } : {}), ...cleanTextLook(s) } : {}), ...(s.tool === 'mark' ? { rects: s.rects.map(r => [...r]), quote: s.quote, ...(s.style ? { style: s.style } : {}) } : {}), ...(s.shape ? { shape: s.shape } : {}), ...(s.from ? { from: s.from } : {}), createdAt: typeof s.createdAt === 'string' ? s.createdAt.slice(0, 40) : new Date().toISOString() }; }
function validOps(ops) {
  if (!Array.isArray(ops) || !ops.length || ops.length > MAX_OPS) throw inkError(tr('필기 변경 내용을 확인하세요.'), 'APP_INK_REJECTED');
  return ops.map(op => {
    if (op?.type === 'add' && validStroke(op.stroke) && validGeometry(op.geometry)) return { type: 'add', stroke: cleanStroke(op.stroke), geometry: { view: [...op.geometry.view], rotate: op.geometry.rotate, userUnit: op.geometry.userUnit } };
    if (['delete', 'restore'].includes(op?.type) && Array.isArray(op.ids) && op.ids.length && op.ids.length <= 10000 && op.ids.every(id => typeof id === 'string' && /^[-a-zA-Z0-9]{8,64}$/.test(id))) return { type: op.type, ids: [...op.ids] };
    throw inkError(tr('필기 변경 내용을 확인하세요.'), 'APP_INK_REJECTED');
  });
}
// Replaying an operation twice gives the same state, so a log entry written
// just before a crash and replayed again is harmless.
// Strokes by id for each stroke list. Strokes are only appended here, and a
// replaced state brings a new array, so the index follows the array it was
// built for. Without it every add and delete scanned the whole list.
const strokeIndexes = new WeakMap();
function strokeIndex(strokes) {
  let index = strokeIndexes.get(strokes);
  if (!index) { index = new Map(strokes.map(s => [s.id, s])); strokeIndexes.set(strokes, index); }
  return index;
}
function applyOps(state, ops, at = new Date().toISOString()) {
  const byId = strokeIndex(state.strokes);
  for (const op of ops) {
    if (op.type === 'add') {
      if (!byId.has(op.stroke.id)) { if (state.strokes.length >= MAX_STROKES) throw inkError(tr('필기가 너무 많습니다.'), 'APP_INK_REJECTED'); state.strokes.push(op.stroke); byId.set(op.stroke.id, op.stroke); }
      state.pages[op.stroke.page] ||= op.geometry;
    } else for (const id of new Set(op.ids)) { const stroke = byId.get(id); if (!stroke) continue; if (op.type === 'delete') stroke.deletedAt ||= at; else delete stroke.deletedAt; }
  }
}
const logSum = (seq, ops, hash) => sha(JSON.stringify([seq, ops, hash])).slice(0, 16);

class InkStore extends KeyedQueue {
  constructor(library) { super(); this.library = library; this.states = new Map(); this.hashes = new Map(); this.keptBases = new Set(); }
  async folder(attachmentId) {
    const base = path.join(this.library.root, VAULT_DIR, 'ink');
    await fs.mkdir(path.join(base, attachmentId), { recursive: true });
    const folder = path.join(base, attachmentId);
    if (await fs.realpath(folder) !== folder) throw Error(tr('필기 폴더의 심볼릭 링크는 지원하지 않습니다.'));
    return folder;
  }
  // Hash once per file version; strokes arrive often and PDFs can be 100MB.
  async sourceHash(paperId, attachmentId) {
    const attachment = this.library.attachment(paperId, attachmentId), file = await this.library.resolveFile(paperId, 'attachment-' + attachment.id), info = await fs.stat(file);
    const cached = this.hashes.get(file);
    if (cached && cached.size === info.size && cached.mtimeMs === info.mtimeMs) return cached.hash;
    const hash = sha(await fs.readFile(file)); this.hashes.set(file, { size: info.size, mtimeMs: info.mtimeMs, hash }); return hash;
  }
  // One write chain per document: a stroke never waits behind a translation export.
  // Closing the vault waits for strokes already sent by the renderer.
  async state(attachmentId, surface) {
    const key = attachmentId + '/' + surface;
    if (this.states.has(key)) return this.states.get(key);
    const folder = await this.folder(attachmentId), file = path.join(folder, surface + '.json');
    const snapshot = await readJson(file, null);
    const state = snapshot?.version === 1 && Array.isArray(snapshot.strokes) ? snapshot : { version: 1, surface, sourceHash: null, seq: 0, pages: {}, strokes: [] };
    state.recovered = 0;
    let text = '';
    try { text = await fs.readFile(path.join(folder, surface + '.log'), 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    let lines = 0, torn = false;
    for (const line of text.split('\n')) {
      if (!line) continue;
      let entry; try { entry = JSON.parse(line); } catch { torn = true; break; }
      if (!Number.isInteger(entry?.seq) || entry.sum !== logSum(entry.seq, entry.ops, entry.hash)) { torn = true; break; }
      lines++;
      if (entry.seq <= state.seq) continue;
      applyOps(state, entry.ops, entry.at); state.seq = entry.seq; state.sourceHash ||= entry.hash; state.recovered++;
    }
    state.logLines = lines;
    this.states.set(key, state);
    // An interrupted final line is dropped by rewriting the replayed state.
    if (torn) await this.compact(attachmentId, surface, state);
    return state;
  }
  async compact(attachmentId, surface, state) {
    const folder = await this.folder(attachmentId), { recovered, logLines, ...stored } = state;
    await atomicJson(path.join(folder, surface + '.json'), { ...stored, updatedAt: new Date().toISOString() });
    const log = path.join(folder, surface + '.log'), temp = `${log}.${crypto.randomUUID()}.tmp`;
    try { await fs.writeFile(temp, ''); await fs.rename(temp, log); } finally { await fs.rm(temp, { force: true }); }
    state.logLines = 0;
  }
  async translationBase(attachmentId, revision) {
    const record = await readJson(path.join(await this.folder(attachmentId), `base-${revision}.json`), null);
    return record && renderRevision(record) === revision ? record : null;
  }
  // The translation a page of ink was written on is kept as its own file;
  // re-translating replaces the cache, never this base.
  async keepTranslationBase(paperId, attachmentId, revision, current) {
    // Bases are never removed, so one verified read is enough; without this
    // every batch on a translated page re-read and re-hashed the whole base.
    const kept = attachmentId + '/' + revision; if (this.keptBases.has(kept)) return;
    const folder = await this.folder(attachmentId), file = path.join(folder, `base-${revision}.json`);
    if (await this.translationBase(attachmentId, revision)) { this.keptBases.add(kept); return; }
    const record = await current();
    if (!record || renderRevision(record) !== revision) throw inkError(tr('번역이 바뀌었습니다. 번역 화면을 다시 연 뒤 필기하세요.'), 'APP_INK_STALE');
    const { resume, renderRevision: _, ...stored } = record;
    await atomicJson(file, stored); this.keptBases.add(kept);
  }
  async load(paperId, attachmentId, surface) {
    surface = surfaceName(surface); const attachment = this.library.attachment(paperId, attachmentId);
    return this.serial(attachment.id + '/' + surface, async () => {
      const state = await this.state(attachment.id, surface), hash = await this.sourceHash(paperId, attachment.id);
      const stale = Boolean(state.sourceHash && state.sourceHash !== hash);
      return { surface, sourceHash: state.sourceHash, stale, seq: state.seq, recovered: state.recovered, strokes: stale ? [] : state.strokes.filter(s => !s.deletedAt), deleted: stale ? [] : state.strokes.filter(s => s.deletedAt).map(s => s.id) };
    });
  }
  async apply(paperId, attachmentId, surface, ops, current) {
    surface = surfaceName(surface); ops = validOps(ops); const attachment = this.library.attachment(paperId, attachmentId);
    return this.serial(attachment.id + '/' + surface, async () => {
      const state = await this.state(attachment.id, surface), hash = await this.sourceHash(paperId, attachment.id);
      if (state.sourceHash && state.sourceHash !== hash) throw inkError(tr('원문 파일이 바뀌어 이전 필기를 수정할 수 없습니다.'), 'APP_INK_STALE');
      if (surface !== 'original') await this.keepTranslationBase(paperId, attachment.id, surface.slice(2), current);
      // Memory changes only after the log entry is on disk.
      const known = strokeIndex(state.strokes), added = new Set(ops.filter(op => op.type === 'add' && !known.has(op.stroke.id)).map(op => op.stroke.id));
      if (state.strokes.length + added.size > MAX_STROKES) throw inkError(tr('필기가 너무 많습니다.'), 'APP_INK_REJECTED');
      const at = new Date().toISOString(), seq = state.seq + 1, folder = await this.folder(attachment.id);
      const handle = await fs.open(path.join(folder, surface + '.log'), 'a', 0o600);
      // Each entry names the source version it was written on.
      try { await handle.writeFile(JSON.stringify({ seq, at, hash, ops, sum: logSum(seq, ops, hash) }) + '\n'); await handle.sync(); } finally { await handle.close(); }
      applyOps(state, ops, at); state.seq = seq; state.sourceHash ||= hash; state.logLines++;
      if (state.logLines >= COMPACT_AFTER) await this.compact(attachment.id, surface, state);
      return { seq };
    });
  }
  // A surface removed on another device (its paper or attachment deleted there): its files go, in its write chain.
  async removeState(attachmentId, surface) {
    surface = surfaceName(surface);
    return this.serial(attachmentId + '/' + surface, async () => {
      const folder = path.join(this.library.root, VAULT_DIR, 'ink', attachmentId);
      for (const ext of ['json', 'log']) await fs.rm(path.join(folder, `${surface}.${ext}`), { force: true });
      this.states.delete(attachmentId + '/' + surface);
    });
  }
  // A merged state from another device replaces this surface in one step.
  async replaceState(attachmentId, surface, value) {
    surface = surfaceName(surface);
    if (!value || !Array.isArray(value.strokes) || value.strokes.length > MAX_STROKES || !value.strokes.every(s => validStroke(s) && (s.deletedAt === undefined || typeof s.deletedAt === 'string')) || !value.pages || typeof value.pages !== 'object') throw Error(tr('필기 동기화 내용을 확인하세요.'));
    return this.serial(attachmentId + '/' + surface, async () => {
      const state = await this.state(attachmentId, surface);
      Object.assign(state, { strokes: value.strokes.map(s => ({ ...cleanStroke(s), ...(s.deletedAt ? { deletedAt: s.deletedAt } : {}) })), pages: value.pages, sourceHash: value.sourceHash || state.sourceHash, seq: state.seq + 1 });
      await this.compact(attachmentId, surface, state);
    });
  }
  // Translations that carry ink, for the reader's base selector.
  async surfaces(paperId, attachmentId) {
    const attachment = this.library.attachment(paperId, attachmentId), folder = await this.folder(attachment.id), list = [];
    for (const name of await fs.readdir(folder)) {
      const match = /^base-([a-f0-9]{24})\.json$/.exec(name); if (!match) continue;
      const state = await this.serial(attachment.id + '/t-' + match[1], () => this.state(attachment.id, 't-' + match[1]));
      const record = await readJson(path.join(folder, name), null);
      list.push({ revision: match[1], createdAt: record?.createdAt || '', model: record?.model || '', strokes: state.strokes.filter(s => !s.deletedAt).length });
    }
    return list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  // Export reads the stored state at this moment, never the renderer's copy.
  async snapshot(paperId, attachmentId, surface) {
    const view = await this.load(paperId, attachmentId, surface);
    const state = this.states.get(this.library.attachment(paperId, attachmentId).id + '/' + surfaceName(surface));
    return { strokes: view.strokes.map(s => structuredClone(s)), pages: structuredClone(state.pages), stale: view.stale };
  }
}

function rgb(color) { return [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16) / 255); }
const num = n => (Math.round(n * 1000) / 1000).toString();
// Pen widths follow pressure segment by segment; a highlighter is one path.
function strokeOps(stroke, map = (x, y) => [x, y], scale = 1) {
  const pts = []; for (let i = 0; i < stroke.points.length; i += 4) pts.push([...map(stroke.points[i], stroke.points[i + 1]), stroke.points[i + 2]]);
  if (stroke.tool === 'highlighter' || pts.length === 1) {
    const width = stroke.tool === 'highlighter' ? stroke.width : pressureWidth(stroke.width, pts[0][2]);
    return [{ width: width * scale, points: pts.length === 1 ? [pts[0], pts[0]] : pts }];
  }
  const out = [];
  for (let i = 1; i < pts.length; i++) {
    const width = Math.round(pressureWidth(stroke.width, (pts[i - 1][2] + pts[i][2]) / 2) * scale * 20) / 20, last = out.at(-1);
    if (last && last.width === width) last.points.push(pts[i]); else out.push({ width, points: [pts[i - 1], pts[i]] });
  }
  return out;
}
const TEXT_ICON = 18;
function bounds(stroke) {
  if (stroke.tool === 'mark') return [Math.min(...stroke.rects.map(r => r[0])), Math.min(...stroke.rects.map(r => r[1])), Math.max(...stroke.rects.map(r => r[2])), Math.max(...stroke.rects.map(r => r[3]))];
  if (stroke.tool === 'text') return [stroke.points[0], stroke.points[1] - TEXT_ICON, stroke.points[0] + TEXT_ICON, stroke.points[1]];
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < stroke.points.length; i += 4) { const x = stroke.points[i], y = stroke.points[i + 1]; x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  const pad = (stroke.tool === 'highlighter' ? stroke.width : pressureWidth(stroke.width, 1)) / 2 + 1;
  return [x0 - pad, y0 - pad, x1 + pad, y1 + pad];
}
// Standard /Ink annotations with their own appearance stream: the original
// text and vectors stay, and other viewers can show, hide or delete the ink.
// The figure boxes and annotation underlines shown on the original (desktop/ink.js inkShownMarks), for a saved original
// with its ink: { boxes: [{ page, rect: {x,y,width,height} as page fractions from the top left, geometry? }],
// underlines: [{ page, rects: [[x1,y1,x2,y2] in PDF points], geometry? }] }, page counted from 0 as ink strokes are.
// Anything not of that shape is left out; at most 2000 of each.
const MARK_LIMIT = 2000;
// Underline boxes are capped in all (a page of text has a few hundred lines): more would hold the main process long.
const UNDERLINE_RECT_LIMIT = 5000;
function cleanMarks(marks) {
  const out = { boxes: [], underlines: [] }, page = p => Number.isInteger(p) && p >= 0 && p < 100000;
  const geometry = g => (g === undefined || g === null ? undefined : validGeometry(g) ? { view: [...g.view], rotate: g.rotate, userUnit: g.userUnit } : null);
  if (!marks || typeof marks !== 'object') return out;
  for (const box of Array.isArray(marks.boxes) ? marks.boxes.slice(0, MARK_LIMIT) : []) {
    const r = box?.rect, g = geometry(box?.geometry);
    if (!page(box?.page) || g === null || !r || ![r.x, r.y, r.width, r.height].every(n => Number.isFinite(n) && n >= -0.01 && n <= 1.01) || r.width <= 0 || r.height <= 0) continue;
    out.boxes.push({ page: box.page, rect: { x: r.x, y: r.y, width: r.width, height: r.height }, ...(g ? { geometry: g } : {}) });
  }
  let rects = 0;
  for (const line of Array.isArray(marks.underlines) ? marks.underlines.slice(0, MARK_LIMIT) : []) {
    const g = geometry(line?.geometry);
    if (!page(line?.page) || g === null || !Array.isArray(line.rects) || !line.rects.length || line.rects.length > 200 || !line.rects.every(r => Array.isArray(r) && r.length === 4 && r.every(v => Number.isFinite(v) && Math.abs(v) <= 1e6))) continue;
    const room = UNDERLINE_RECT_LIMIT - rects; if (room <= 0) break;
    const kept = line.rects.slice(0, room).map(r => [...r]); rects += kept.length;
    out.underlines.push({ page: line.page, rects: kept, ...(g ? { geometry: g } : {}) });
  }
  return out;
}
// The page as the viewer lays it out, for a page whose geometry was not sent (one not drawn yet), by PDF.js's rules and
// without throwing where pdf-lib's own getters would: a box is four numbers the right way round with room in it (the
// MediaBox US Letter otherwise, the CropBox the MediaBox otherwise), the CropBox within the MediaBox (the MediaBox when
// they do not meet), /Rotate in quarter turns (0 otherwise) and a /UserUnit that is a positive number (1 otherwise).
const LETTER = [0, 0, 612, 792];
function pageGeometry(page) {
  const { PDFName, PDFNumber, PDFArray } = require('pdf-lib'), node = page.node, context = node.context;
  const look = value => { try { return context.lookup(value); } catch { return undefined; } };
  const number = value => { const v = look(value); return v instanceof PDFNumber ? v.asNumber() : NaN; };
  const inherited = name => { try { return look(node.getInheritableAttribute(PDFName.of(name))); } catch { return undefined; } };
  const box = name => {
    const a = inherited(name); if (!(a instanceof PDFArray) || a.size() !== 4) return null;
    const n = a.asArray().map(number); if (!n.every(Number.isFinite)) return null;
    const b = [Math.min(n[0], n[2]), Math.min(n[1], n[3]), Math.max(n[0], n[2]), Math.max(n[1], n[3])];
    return b[2] > b[0] && b[3] > b[1] ? b : null;
  };
  const media = box('MediaBox') || LETTER, crop = box('CropBox') || media, x0 = Math.max(crop[0], media[0]), y0 = Math.max(crop[1], media[1]), x1 = Math.min(crop[2], media[2]), y1 = Math.min(crop[3], media[3]);
  const angle = number(inherited('Rotate')), unit = number(node.get(PDFName.of('UserUnit')));
  return { view: x1 > x0 && y1 > y0 ? [x0, y0, x1, y1] : media, rotate: Number.isFinite(angle) && angle % 90 === 0 ? ((angle % 360) + 360) % 360 : 0, userUnit: Number.isFinite(unit) && unit > 0 ? unit : 1 };
}
// From the viewer's page (scale 1) back to PDF user space: the inverse of viewportTransform, the rule ink is drawn by.
function fromViewport(geometry) {
  const { transform: m, width, height } = viewportTransform(geometry, 1), det = m[0] * m[3] - m[1] * m[2];
  return { width, height, unit: geometry.userUnit, point: (x, y) => [(m[3] * (x - m[4]) - m[2] * (y - m[5])) / det, (-m[1] * (x - m[4]) + m[0] * (y - m[5])) / det], to: (x, y) => apply(m, x, y) };
}
// Boxes in the figure pin's blue, underlines in the annotation pin's orange: dashed [4 3], 1.5pt, printed (F 4).
const MARK_COLORS = { box: [27 / 255, 100 / 255, 218 / 255], underline: [1, 176 / 255, 32 / 255] }, MARK_WIDTH = 1.5, MARK_DASH = [4, 3];
// The returned PDF tells what went into it (added: { strokes, marks }); when nothing could be put in, it is the input
// byte for byte.
async function inkedOriginal(bytes, ink, marks = { boxes: [], underlines: [] }) {
  const unchanged = () => Object.defineProperty(Buffer.from(bytes), 'added', { value: { strokes: 0, marks: 0 } });
  if (!ink?.strokes?.length && !marks.boxes.length && !marks.underlines.length) return unchanged();
  const { PDFDocument, PDFName, PDFString, PDFHexString, PDFArray } = require('pdf-lib');
  let doc;
  try { doc = await PDFDocument.load(bytes, { updateMetadata: false }); }
  catch (error) { throw Error(/encrypt/i.test(error.message) ? tr('암호화된 PDF에는 필기를 합칠 수 없습니다. 필기 불포함으로 저장하세요.') : tr('PDF 구조를 읽지 못해 필기를 합칠 수 없습니다. 필기 불포함으로 저장하세요.')); }
  const pages = doc.getPages(), context = doc.context, added = { strokes: 0, marks: 0 };
  const add = (page, annotation, stroke) => {
    annotation.set(PDFName.of('NM'), PDFString.of(appName.annotationPrefix + stroke.id)); annotation.set(PDFName.of('T'), PDFHexString.fromText(appName.name)); annotation.set(PDFName.of('P'), page.ref);
    const ref = context.register(annotation), annots = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray);
    if (annots) annots.push(ref); else page.node.set(PDFName.of('Annots'), context.obj([ref]));
  };
  // The shown boxes and underlines, laid by the same rule as the ink (the page's geometry as the viewer had it). A mark
  // whose page cannot be laid out, or whose numbers (in the PDF, or as seen in the page's units) come out not finite or
  // past 1e6, is left out alone.
  // The geometry sent with the mark, else the page's as the renderer had it, else the page read here; one not of that
  // shape is passed over, and a page that still cannot be read leaves its marks out (never the whole save).
  const geometryFor = (mark, page) => {
    for (const g of [mark.geometry, ink?.pages?.[mark.page]]) if (validGeometry(g)) return g;
    try { const g = pageGeometry(page); return validGeometry(g) ? g : null; } catch { return null; }
  };
  const style = color => `${color.map(num).join(' ')} RG ${num(MARK_WIDTH)} w [${MARK_DASH.join(' ')}] 0 d`, sane = values => values.every(v => Number.isFinite(v) && Math.abs(v) <= 1e6);
  const markAnnotation = (page, rect, subtype, color, numbers, ops, extra, id) => {
    if (!sane([...rect, ...numbers])) return;
    const appearance = context.register(context.stream(`q ${style(color)}\n${ops}\nQ`, { Type: 'XObject', Subtype: 'Form', BBox: rect }));
    add(page, context.obj({ Type: 'Annot', Subtype: subtype, Rect: rect, C: color, BS: { W: MARK_WIDTH, S: 'D', D: MARK_DASH }, F: 4, ...extra, AP: { N: appearance } }), { id }); added.marks++;
  };
  marks.boxes.forEach((box, i) => {
    const page = pages[box.page], g = page && geometryFor(box, page); if (!g) return;
    const v = fromViewport(g), r = box.rect, a = v.point(r.x * v.width, r.y * v.height), b = v.point((r.x + r.width) * v.width, (r.y + r.height) * v.height), half = MARK_WIDTH / 2;
    const x0 = Math.min(a[0], b[0]), y0 = Math.min(a[1], b[1]), x1 = Math.max(a[0], b[0]), y1 = Math.max(a[1], b[1]), inner = [x0 + half, y0 + half, x1 - x0 - MARK_WIDTH, y1 - y0 - MARK_WIDTH];
    markAnnotation(page, [x0, y0, x1, y1].map(num).map(Number), 'Square', MARK_COLORS.box, [...inner, v.width / v.unit, v.height / v.unit], `${inner.map(num).join(' ')} re S`, {}, `box-${i}`);
  });
  marks.underlines.forEach((line, i) => {
    const page = pages[line.page], g = page && geometryFor(line, page); if (!g) return;
    // Under each line as it is seen (the rects of one line joined, core/ink-marks.cjs), whatever way the page turns: the
    // line's bottom edge less half the line, 1.5pt as on the screen (where a point is the page's UserUnit in pixels).
    const v = fromViewport(g), seen = line.rects.map(r => { const p = v.to(r[0], r[1]), q = v.to(r[2], r[3]); return [p[0], p[1], q[0], q[1]]; });
    joinLineBoxes(seen).forEach((b, j) => {
      const y = b[3] - MARK_WIDTH * v.unit / 2, s = v.point(b[0], y), e = v.point(b[2], y), pad = MARK_WIDTH, ends = [s[0], s[1], e[0], e[1]];
      markAnnotation(page, [Math.min(s[0], e[0]) - pad, Math.min(s[1], e[1]) - pad, Math.max(s[0], e[0]) + pad, Math.max(s[1], e[1]) + pad].map(num).map(Number), 'Line', MARK_COLORS.underline, [...ends, ...b.map(n => n / v.unit)], `${num(s[0])} ${num(s[1])} m ${num(e[0])} ${num(e[1])} l S`, { L: ends.map(num).map(Number) }, `underline-${i}-${j}`);
    });
  });
  for (const stroke of ink?.strokes || []) {
    const page = pages[stroke.page]; if (!page) continue; added.strokes++;
    const rect = bounds(stroke), color = rgb(stroke.color), highlighter = stroke.tool === 'highlighter';
    // Text highlights become /Highlight with QuadPoints; page memos become /Text notes.
    if (stroke.tool === 'mark' && stroke.style === 'underline') {
      const bars = stroke.rects.map(underlineBar), fill = bars.map(r => `${num(r[0])} ${num(r[1])} ${num(r[2] - r[0])} ${num(r[3] - r[1])} re`).join('\n');
      const appearance = context.register(context.stream(`q ${color.map(num).join(' ')} rg\n${fill}\nf Q`, { Type: 'XObject', Subtype: 'Form', BBox: rect }));
      const annotation = context.obj({ Type: 'Annot', Subtype: 'Underline', Rect: rect, QuadPoints: stroke.rects.flatMap(r => [r[0], r[3], r[2], r[3], r[0], r[1], r[2], r[1]]), C: color, F: 4, AP: { N: appearance } });
      if (stroke.quote) annotation.set(PDFName.of('Contents'), PDFHexString.fromText(stroke.quote));
      add(page, annotation, stroke); continue;
    }
    if (stroke.tool === 'mark') {
      // One box per line, all filled by a single f, so the translucent colour is laid once (core/ink-marks.cjs).
      const boxes = highlightBoxes(stroke.rects), fill = boxes.map(r => `${num(r[0])} ${num(r[1])} ${num(r[2] - r[0])} ${num(r[3] - r[1])} re`).join('\n');
      const appearance = context.register(context.stream(`q /GS0 gs ${color.map(num).join(' ')} rg\n${fill}\nf Q`, { Type: 'XObject', Subtype: 'Form', BBox: rect, Resources: { ExtGState: { GS0: { Type: 'ExtGState', ca: HIGHLIGHT_OPACITY, BM: 'Multiply' } } } }));
      const annotation = context.obj({ Type: 'Annot', Subtype: 'Highlight', Rect: rect, QuadPoints: boxes.flatMap(r => [r[0], r[3], r[2], r[3], r[0], r[1], r[2], r[1]]), C: color, CA: HIGHLIGHT_OPACITY, F: 4, AP: { N: appearance } });
      if (stroke.quote) annotation.set(PDFName.of('Contents'), PDFHexString.fromText(stroke.quote));
      add(page, annotation, stroke); continue;
    }
    if (stroke.tool === 'text') {
      const annotation = context.obj({ Type: 'Annot', Subtype: 'Text', Rect: rect, C: color, F: 4, Name: 'Comment', Open: false });
      annotation.set(PDFName.of('Contents'), PDFHexString.fromText(stroke.text));
      add(page, annotation, stroke); continue;
    }
    const content = ['q', '1 J 1 j', ...(highlighter ? ['/GS0 gs'] : []), `${color.map(num).join(' ')} RG`];
    for (const part of strokeOps(stroke)) content.push(`${num(part.width)} w`, `${num(part.points[0][0])} ${num(part.points[0][1])} m`, ...part.points.slice(1).map(p => `${num(p[0])} ${num(p[1])} l`), 'S');
    content.push('Q');
    const appearance = context.register(context.stream(content.join('\n'), { Type: 'XObject', Subtype: 'Form', BBox: rect, ...(highlighter ? { Resources: { ExtGState: { GS0: { Type: 'ExtGState', CA: HIGHLIGHT_OPACITY, BM: 'Multiply' } } } } : {}) }));
    const inkList = []; for (let i = 0; i < stroke.points.length; i += 4) inkList.push(stroke.points[i], stroke.points[i + 1]);
    const annotation = context.obj({ Type: 'Annot', Subtype: 'Ink', Rect: rect, InkList: [inkList], C: color, BS: { W: highlighter ? stroke.width : pressureWidth(stroke.width, 0.5) }, F: 4, ...(highlighter ? { CA: HIGHLIGHT_OPACITY } : {}), AP: { N: appearance } });
    add(page, annotation, stroke);
  }
  if (!added.strokes && !added.marks) return unchanged(); // all on pages the file does not have, or left out
  return Object.defineProperty(Buffer.from(await doc.save({ updateFieldAppearances: false })), 'added', { value: added });
}
// Inline SVG over each printed translation page, in that page's pixel space.
function overlaySvg(ink, index, page) {
  const strokes = ink.strokes.filter(s => s.page === index), geometry = ink.pages[index];
  if (!strokes.length || !geometry) return '';
  const base = viewportTransform(geometry, 1), scale = page.width / base.width, { transform } = viewportTransform(geometry, scale);
  const paths = [];
  // In the screen's order (desktop/ink.js inkDrawPage): highlighter strokes first, then everything else as it was made,
  // so a line drawn over a filled text box after it stays on top of the box.
  const scale1 = Math.hypot(transform[0], transform[1]), order = t => t === 'highlighter' ? 0 : 1;
  for (const stroke of [...strokes].sort((a, b) => order(a.tool) - order(b.tool))) {
    // Colours read from disk go into the SVG only as '#rrggbb' (core/ink-marks.cjs hexColor, textLook).
    const color = hexColor(stroke.color) || '#000000', highlighter = stroke.tool === 'highlighter';
    if (stroke.tool === 'mark' && stroke.style === 'underline') { for (const bar of stroke.rects.map(underlineBar)) { const a = apply(transform, bar[0], bar[1]), b = apply(transform, bar[2], bar[3]); paths.push(`<rect x="${num(Math.min(a[0], b[0]))}" y="${num(Math.min(a[1], b[1]))}" width="${num(Math.abs(b[0] - a[0]))}" height="${num(Math.abs(b[1] - a[1]))}" fill="${color}" stroke="none"/>`); } continue; }
    // A highlight is one path of its line boxes, so its translucency is laid once where boxes meet (core/ink-marks.cjs).
    if (stroke.tool === 'mark') {
      const d = highlightBoxes(stroke.rects).map(r => { const a = apply(transform, r[0], r[1]), b = apply(transform, r[2], r[3]), x = Math.min(a[0], b[0]), y = Math.min(a[1], b[1]); return `M${num(x)} ${num(y)}h${num(Math.abs(b[0] - a[0]))}v${num(Math.abs(b[1] - a[1]))}h${num(-Math.abs(b[0] - a[0]))}Z`; }).join('');
      if (d) paths.push(`<path d="${d}" fill="${color}" fill-opacity="${HIGHLIGHT_OPACITY}" stroke="none" style="mix-blend-mode:multiply"/>`);
      continue;
    }
    if (stroke.tool === 'text') {
      // Aligned lines anchor on the box's middle or right edge (its width is kept with the box).
      const [x, y] = apply(transform, stroke.points[0], stroke.points[1]), size = stroke.width * scale1, esc = escapeHtml, w = (stroke.w || 0) * scale1, align = w ? stroke.align : undefined;
      const ax = align === 'center' ? x + w / 2 : align === 'right' ? x + w : x, anchor = align === 'center' ? ' text-anchor="middle"' : align === 'right' ? ' text-anchor="end"' : '';
      const look = `${stroke.bold ? ' font-weight="700"' : ''}${stroke.italic ? ' font-style="italic"' : ''}${stroke.underline ? ' text-decoration="underline"' : ''}`;
      // The box's fill and border, drawn as on the screen: around the text's width (kept with the box when it was
      // saved; estimated for a box saved before), its lines, the padding and the border (core/ink-marks.cjs).
      const { fill, border } = textLook(stroke);
      if (fill || border) {
        const lines = stroke.text.split('\n'), frame = textBoxFrame({ width: stroke.width, border }), out = frame.out * scale1, b = frame.border * scale1;
        // The text's width as the screen takes it (desktop/ink.js inkTextWidth): the kept w, else an estimate (a box
        // without w is one saved before boxes had a fill or border).
        const tw = (stroke.w || Math.max(...lines.map(l => l.length)) * stroke.width * 0.62) * scale1, th = lines.length * size * 1.3;
        if (fill) paths.push(`<rect x="${num(x - out)}" y="${num(y - out)}" width="${num(tw + 2 * out)}" height="${num(th + 2 * out)}" fill="${fill}" stroke="none"/>`);
        if (border) {
          const dash = textBorderDash(border.style, b);
          paths.push(`<rect x="${num(x - out + b / 2)}" y="${num(y - out + b / 2)}" width="${num(tw + 2 * out - b)}" height="${num(th + 2 * out - b)}" fill="none" stroke="${border.color}" stroke-width="${num(b)}" stroke-linecap="${border.style === 'dotted' ? 'round' : 'butt'}" stroke-linejoin="miter"${dash.length ? ` stroke-dasharray="${dash.map(num).join(' ')}"` : ''}/>`);
        }
      }
      paths.push(`<text x="${num(ax)}" y="${num(y)}" font-size="${num(size)}" fill="${color}" stroke="none" font-family="Noto Sans KR, sans-serif" dominant-baseline="hanging"${anchor}${look}>${stroke.text.split('\n').map((line, i) => `<tspan x="${num(ax)}" dy="${i ? num(size * 1.3) : 0}">${esc(line)}</tspan>`).join('')}</text>`); continue;
    }
    for (const part of strokeOps(stroke, (x, y) => apply(transform, x, y), Math.hypot(transform[0], transform[1])))
      paths.push(`<path d="M${part.points.map(p => num(p[0]) + ' ' + num(p[1])).join('L')}" stroke="${color}" stroke-width="${num(part.width)}"${highlighter ? ` stroke-opacity="${HIGHLIGHT_OPACITY}" style="mix-blend-mode:multiply"` : ''}/>`);
  }
  return `<svg class="app-ink" viewBox="0 0 ${num(page.width)} ${num(page.height)}" fill="none" stroke-linecap="round" stroke-linejoin="round">${paths.join('')}</svg>`;
}
function inkedHtml(html, pages, ink) {
  const style = '.app-ink{position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;z-index:3;overflow:visible}';
  let out = html.replace('</style>', style + '</style>');
  pages.forEach((page, index) => {
    const svg = overlaySvg(ink, index, page); if (!svg) return;
    const start = out.indexOf(`<section class="page" data-source-page="${index + 1}"`), end = start < 0 ? -1 : out.indexOf('</section>', start);
    if (end < 0) throw Error(tr('번역 PDF에 필기를 합칠 페이지를 찾지 못했습니다.'));
    out = out.slice(0, end) + svg + out.slice(end);
  });
  return out;
}
module.exports = { InkStore, renderRevision, viewportTransform, pressureWidth, inkedOriginal, inkedHtml, overlaySvg, HIGHLIGHT_OPACITY, cleanMarks };
