// Notebooks: pages in points (A4 unless another size or a PDF page was added) beside a paper or for a project,
// holding handwriting, text boxes, figure excerpts and source cards. Images
// are content-addressed assets so a page edit never rewrites them.
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const {tr,uiLanguage}=require('../core/i18n.js');
const { atomicJson, readJson, KeyedQueue } = require('./storage.cjs');
const { VAULT_DIR } = require('./legacy.cjs');
const { validTextLook, hexColor, textLook } = require('../core/ink-marks.cjs');

const TEMPLATES = ['blank', 'lined', 'grid'];
const A4 = { width: 595, height: 842 };
// A whiteboard page (board: true) keeps its width and grows downward, a sheet at a time: a sheet is the A4 proportion
// at the board's width (842 points under an A4 width). It goes up to a hundred A4 sheets, and prints a sheet a page.
const BOARD_MAX = 100 * A4.height;
const sheetHeight = width => Math.round(width * A4.height / A4.width * 100) / 100;
const num = (v, lo, hi) => Number.isFinite(v) && v >= lo && v <= hi;
const SHAPES = ['line', 'rect', 'ellipse', 'triangle', 'arrow'];
function validStroke(s) {
  return s && typeof s.id === 'string' && /^[-a-zA-Z0-9]{8,64}$/.test(s.id) && ['pen', 'highlighter'].includes(s.tool) && /^#[0-9a-f]{6}$/i.test(s.color) && num(s.width, 0.1, 100) && Array.isArray(s.points) && s.points.length && s.points.length % 4 === 0 && s.points.length <= 80000 && s.points.every(Number.isFinite) && (s.shape === undefined || SHAPES.includes(s.shape));
}
// On a whiteboard an item can be anywhere down the board (and as far below it as above a page); elsewhere as on a page.
function validItem(item, page) {
  if (!item || typeof item.id !== 'string' || !/^[-a-zA-Z0-9]{8,64}$/.test(item.id) || !num(item.x, -2000, 4000) || !num(item.y, -2000, page?.board ? page.height + 2000 : 4000) || !num(item.w, 1, 4000) || !num(item.h, 1, 4000)) return false;
  // A text box's look applies to the whole box: size, weight, slant, underline, colour, alignment, and its fill and
  // border (core/ink-marks.cjs; without them the box has none).
  if (item.type === 'text') return typeof item.text === 'string' && item.text.length <= 20000 && (item.size === undefined || num(item.size, 6, 72)) && ['bold', 'italic', 'underline'].every(k => item[k] === undefined || item[k] === true) && (item.color === undefined || /^#[0-9a-f]{6}$/i.test(item.color)) && (item.align === undefined || ['left', 'center', 'right'].includes(item.align)) && (item.mentions === undefined || validMentions(item.mentions)) && validTextLook(item);
  if (item.type === 'image') return typeof item.asset === 'string' && /^[a-f0-9]{64}$/.test(item.asset) && (item.source === undefined || validSource(item.source));
  if (item.type === 'source') return validSource(item.source) && typeof item.quote === 'string' && item.quote.length <= 4000;
  // An embedded memo: its key in the notes, with the title and text as of the last save (for export).
  if (item.type === 'memo') return typeof item.key === 'string' && item.key.length >= 1 && item.key.length <= 200 && typeof item.title === 'string' && item.title.length <= 200 && typeof item.text === 'string' && item.text.length <= 20000;
  return false;
}
// The memos a text box names with "@[이름]": the memo key for each name.
function validMentions(list) { return Array.isArray(list) && list.length >= 1 && list.length <= 50 && list.every(m => m && Object.keys(m).length === 2 && typeof m.key === 'string' && m.key.length >= 1 && m.key.length <= 200 && typeof m.label === 'string' && m.label.length >= 1 && m.label.length <= 200); }
function validSource(s) { return s && Number.isSafeInteger(s.paperId) && typeof s.attachmentId === 'string' && s.attachmentId.length <= 100 && Number.isInteger(s.page) && s.page >= 1 && s.page <= 500 && typeof s.title === 'string' && s.title.length <= 1000; }
// Pages are A4 by default; other paper sizes and pages taken from a PDF (its page size, drawn as the
// page's background picture) are any size from 2 to about 28 inches a side.
const validSize = v => Number.isFinite(v) && v >= 144 && v <= 2000;
function validNotebook(n) {
  if (!n || typeof n.id !== 'string' || !/^[-a-f0-9]{36}$/.test(n.id) || typeof n.title !== 'string' || !n.title.trim() || n.title.length > 200 || !(n.paperId === null || Number.isSafeInteger(n.paperId)) || !Array.isArray(n.pages) || !n.pages.length || n.pages.length > 500) throw Error(tr('노트북 형식을 확인하세요.'));
  const ids = new Set();
  for (const page of n.pages) {
    if (!page || typeof page.id !== 'string' || !/^[-a-zA-Z0-9]{8,64}$/.test(page.id) || ids.has(page.id) || !TEMPLATES.includes(page.template) || !validSize(page.width) || !(page.board === undefined || page.board === true) || !(page.board ? num(page.height, 144, BOARD_MAX) : validSize(page.height)) || page.board && page.background !== undefined || page.background !== undefined && !/^[0-9a-f]{64}$/.test(page.background) || !Array.isArray(page.items) || page.items.length > 2000 || !Array.isArray(page.strokes) || page.strokes.length > 20000) throw Error(tr('노트북 페이지를 확인하세요.'));
    ids.add(page.id);
    if (!page.items.every(item => validItem(item, page)) || !page.strokes.every(validStroke)) throw Error(tr('노트북 페이지 내용을 확인하세요.'));
  }
  return { id: n.id, title: n.title.trim(), paperId: n.paperId, createdAt: typeof n.createdAt === 'string' ? n.createdAt.slice(0, 40) : new Date().toISOString(), updatedAt: new Date().toISOString(), pages: n.pages.map(p => ({ id: p.id, template: p.template, width: p.width, height: p.height, ...(p.board ? { board: true } : {}), ...(p.background ? { background: p.background } : {}), items: p.items, strokes: p.strokes })) };
}
class NotebookStore extends KeyedQueue {
  constructor(library) { super(); this.library = library; }
  async dir(...parts) { const dir = path.join(this.library.root, VAULT_DIR, 'notebooks', ...parts); await vaultDirectory(this.library.root, dir); return dir; }
  async list() {
    const dir = await this.dir(), out = [];
    for (const name of await fs.readdir(dir)) {
      if (!/^[-a-f0-9]{36}\.json$/.test(name)) continue;
      // Titles come from a summary kept per file (size and time); a notebook with many strokes is parsed again only when it changed.
      const file = path.join(dir, name), info = await fs.stat(file).catch(() => null); if (!info) continue;
      let summary = (this.summaries ||= new Map()).get(name);
      if (!summary || summary.size !== info.size || summary.mtimeMs !== info.mtimeMs) { const n = await readJson(file, null); summary = { size: info.size, mtimeMs: info.mtimeMs, item: n && !n.trashedAt ? { id: n.id, title: n.title, paperId: n.paperId, pages: n.pages.length, updatedAt: n.updatedAt } : null }; this.summaries.set(name, summary); }
      if (summary.item) out.push({ ...summary.item });
    }
    return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  async get(id) { if (!/^[-a-f0-9]{36}$/.test(id)) throw Error(tr('노트북을 찾을 수 없습니다.')); const n = await readJson(path.join(await this.dir(), id + '.json'), null); if (!n || n.trashedAt) throw Error(tr('노트북을 찾을 수 없습니다.')); return n; }
  async create(title, paperId = null) {
    if (paperId !== null) this.library.paper(paperId);
    const notebook = validNotebook({ id: crypto.randomUUID(), title: String(title || '').trim() || tr('노트북'), paperId, pages: [{ id: crypto.randomUUID(), template: 'lined', ...A4, items: [], strokes: [] }] });
    await atomicJson(path.join(await this.dir(), notebook.id + '.json'), notebook); return notebook;
  }
  // Notebooks of a paper merged into another move with it.
  async reassign(fromId, toId) {
    const dir = await this.dir();
    for (const name of await fs.readdir(dir)) {
      if (!/^[-a-f0-9]{36}\.json$/.test(name)) continue;
      await this.serial(name.slice(0, 36), async () => { const file = path.join(dir, name), n = await readJson(file, null); if (n?.paperId === fromId) await atomicJson(file, { ...n, paperId: toId }); });
    }
  }
  async save(value) {
    const notebook = validNotebook(value);
    // A paper that is gone (merged or deleted elsewhere) leaves its notebook as a
    // project notebook rather than refusing every save of what is on screen.
    if (notebook.paperId !== null && !this.library.data.papers.some(p => p.id === notebook.paperId)) notebook.paperId = null;
    return this.serial(notebook.id, async () => { const file = path.join(await this.dir(), notebook.id + '.json'), text = await fs.readFile(file, 'utf8').catch(() => null);
      // The previous version only has to exist and not be in the trash; the full parse is needed only when a trash mark is present.
      if (text === null || text.includes('"trashedAt"') && JSON.parse(text).trashedAt) throw Error(tr('노트북을 찾을 수 없습니다.')); await atomicJson(file, notebook); return { updatedAt: notebook.updatedAt }; });
  }
  // Deleting keeps the file with a mark, like papers in the trash.
  remove(id) { return this.serial(id, async () => { const n = await this.get(id); n.trashedAt = new Date().toISOString(); await atomicJson(path.join(await this.dir(), id + '.json'), n); }); }
  // The trash: notebooks marked trashedAt (removed above), newest first; each comes back as it was, or is deleted for good.
  async trashed() {
    const dir = await this.dir(), out = [];
    for (const name of await fs.readdir(dir)) {
      if (!/^[-a-f0-9]{36}\.json$/.test(name)) continue;
      const n = await readJson(path.join(dir, name), null); if (!n?.trashedAt) continue;
      out.push({ id: n.id, title: n.title, paperId: n.paperId, pages: Array.isArray(n.pages) ? n.pages.length : 0, trashedAt: n.trashedAt });
    }
    return out.sort((a, b) => String(b.trashedAt).localeCompare(String(a.trashedAt)));
  }
  async trashedOne(id) { if (!/^[-a-f0-9]{36}$/.test(id)) throw Error(tr('노트북을 찾을 수 없습니다.')); const file = path.join(await this.dir(), id + '.json'), n = await readJson(file, null); if (!n?.trashedAt) throw Error(tr('휴지통에 그 노트북이 없습니다.')); return { n, file }; }
  restore(id) { return this.serial(id, async () => { const { n, file } = await this.trashedOne(id); delete n.trashedAt; n.updatedAt = new Date().toISOString(); await atomicJson(file, n); }); }
  // Deleted for good: the file, and the pictures it used that no other notebook (in the trash or not) uses.
  purge(id) {
    return this.serial(id, async () => {
      const { n, file } = await this.trashedOne(id), used = n => new Set((n?.pages || []).flatMap(p => [p.background, ...(p.items || []).map(i => i.asset)]).filter(h => typeof h === 'string' && /^[a-f0-9]{64}$/.test(h)));
      const mine = used(n); await fs.rm(file, { force: true });
      const dir = await this.dir();
      for (const name of await fs.readdir(dir)) if (/^[-a-f0-9]{36}\.json$/.test(name)) for (const hash of used(await readJson(path.join(dir, name), null))) mine.delete(hash);
      for (const hash of mine) await fs.rm(path.join(await this.dir('assets'), hash + '.png'), { force: true });
    });
  }
  async putAsset(dataUrl) {
    const match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(typeof dataUrl === 'string' && dataUrl.length <= 11e6 ? dataUrl : '');
    if (!match) throw Error(tr('PNG 이미지를 확인하세요.'));
    const bytes = Buffer.from(match[1], 'base64'), hash = crypto.createHash('sha256').update(bytes).digest('hex'), file = path.join(await this.dir('assets'), hash + '.png');
    try { await fs.writeFile(file, bytes, { flag: 'wx' }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
    return hash;
  }
  async asset(hash) { if (!/^[a-f0-9]{64}$/.test(hash)) throw Error(tr('이미지를 찾을 수 없습니다.')); return 'data:image/png;base64,' + (await fs.readFile(path.join(await this.dir('assets'), hash + '.png'))).toString('base64'); }
}

// Print HTML for a notebook: page templates, items and strokes in page points.
const { escapeHtml: esc } = require('../core/pdf-layout.js');
const { vaultDirectory } = require('./vault-folder.cjs');
const n3 = v => Math.round(v * 100) / 100;
// A slice (a whiteboard's sheet) draws the page's lines and strokes that fall in it, at their places on the page, so
// the lines run on from one sheet to the next; without one, the whole page.
function templateSvg(page, slice = { top: 0, bottom: page.height }) {
  if (page.template === 'blank') return '';
  const lines = [], { top, bottom } = slice, inside = y => y >= top && y <= bottom;
  if (page.template === 'lined') { for (let y = 72; y < page.height - 36; y += 24) if (inside(y)) lines.push(`<line x1="36" y1="${y}" x2="${page.width - 36}" y2="${y}"/>`); }
  else { for (let x = 18; x < page.width; x += 18) lines.push(`<line x1="${x}" y1="${top}" x2="${x}" y2="${bottom}"/>`); for (let y = 18; y < page.height; y += 18) if (inside(y)) lines.push(`<line x1="0" y1="${y}" x2="${page.width}" y2="${y}"/>`); }
  return `<svg class="tpl" viewBox="0 ${top} ${page.width} ${bottom - top}" stroke="#c7d2fe" stroke-width=".6">${lines.join('')}</svg>`;
}
function strokeSvg(strokes, page = A4, slice = { top: 0, bottom: page.height }) {
  const paths = [], { top, bottom } = slice, inSlice = s => { const [lo, hi] = strokeSpan(s); return hi > top && lo < bottom; };
  for (const s of [...strokes].filter(s => slice.top === 0 && slice.bottom === page.height || inSlice(s)).sort((a, b) => (a.tool === 'highlighter' ? 0 : 1) - (b.tool === 'highlighter' ? 0 : 1))) {
    const pts = []; for (let i = 0; i < s.points.length; i += 4) pts.push([s.points[i], s.points[i + 1], s.points[i + 2]]);
    if (s.tool === 'highlighter') { paths.push(`<path d="M${pts.map(p => n3(p[0]) + ' ' + n3(p[1])).join('L')}" stroke="${s.color}" stroke-width="${s.width}" stroke-opacity=".35" style="mix-blend-mode:multiply"/>`); continue; }
    if (pts.length === 1) pts.push(pts[0]);
    for (let i = 1; i < pts.length; i++) paths.push(`<path d="M${n3(pts[i - 1][0])} ${n3(pts[i - 1][1])}L${n3(pts[i][0])} ${n3(pts[i][1])}" stroke="${s.color}" stroke-width="${n3(s.width * (0.4 + 1.2 * (pts[i - 1][2] + pts[i][2]) / 2))}"/>`);
  }
  return paths.length ? `<svg class="ink" viewBox="0 ${top} ${page.width} ${bottom - top}" fill="none" stroke-linecap="round" stroke-linejoin="round">${paths.join('')}</svg>` : '';
}
// How far down a stroke's ink reaches: half its width around it, as drawn (a pen's line is up to 1.6 times its width,
// with the pressure; a highlighter's and a shape's are their width), as notebook.js nbStrokeBox measures it.
function strokeSpan(s) { let lo = Infinity, hi = -Infinity; for (let i = 1; i < s.points.length; i += 4) { lo = Math.min(lo, s.points[i]); hi = Math.max(hi, s.points[i]); } const pad = (s.tool === 'highlighter' || s.shape ? s.width : s.width * 1.6) / 2; return [lo - pad, hi + pad]; }
// The sheets a whiteboard prints on, top to bottom. A sheet ends where nothing (an item or a stroke) runs across,
// the lowest such place in its lower half; where every place there cuts through something (a box taller than a sheet,
// writing over the whole half), at the sheet's height. Sheets end with the last thing on the board: the empty part
// under it is not printed (an empty board is one empty sheet).
function boardSheets(page) {
  // A board of no width (not one the app writes) still prints on A4 sheets rather than never ending.
  const sheet = sheetHeight(page.width) > 0 ? sheetHeight(page.width) : A4.height, spans = [...page.items.map(i => [i.y, i.y + i.h]), ...page.strokes.map(strokeSpan)].sort((a, b) => a[0] - b[0]);
  const end = Math.min(page.height, spans.reduce((m, s) => Math.max(m, s[1]), 0)), out = [];
  let top = 0;
  do {
    // Only what reaches into the sheet's lower half can stand in the way of a cut there.
    const limit = n3(top + sheet), half = top + sheet / 2, near = spans.filter(([a, b]) => b > half && a < limit);
    const free = y => y > half && y <= limit && !near.some(([a, b]) => a < y && y < b);
    const places = end <= limit ? [] : [limit, ...near.flat()].filter(free), bottom = places.length ? n3(Math.max(...places)) : limit;
    out.push({ top, bottom }); top = bottom;
  } while (top < end);
  return out;
}
async function notebookHtml(notebook, asset) {
  const pages = [], sizes = new Map();
  for (const page of notebook.pages) {
    // A page's items, `dy` points higher (a whiteboard's sheet shows its part of the board).
    const itemsHtml = async (list, dy = 0) => { const items = [];
    for (const item of list) {
      const box = `left:${item.x}pt;top:${n3(item.y - dy)}pt;width:${item.w}pt;height:${item.h}pt`;
      // What goes into the style is checked here (a notebook read from disk or another device is not checked when read).
      if (item.type === 'text') { const color = hexColor(item.color), { fill, border } = textLook(item), size = Number.isFinite(item.size) ? item.size : 12, align = ['left', 'center', 'right'].includes(item.align) ? item.align : null;
        items.push(`<div class="text" style="${box};font-size:${size}pt${item.bold ? ';font-weight:700' : ''}${item.italic ? ';font-style:italic' : ''}${item.underline ? ';text-decoration:underline' : ''}${color ? `;color:${color}` : ''}${align ? `;text-align:${align}` : ''}${fill ? `;background-color:${fill}` : ''}${border ? `;border:${border.width}pt ${border.style} ${border.color};box-sizing:border-box` : ''}">${esc(item.text)}</div>`); }
      if (item.type === 'image') items.push(`<figure style="${box}"><img src="${await asset(item.asset)}">${item.source ? `<figcaption>${tr('{title} · {page}쪽',{title:esc(item.source.title),page:item.source.page})}</figcaption>` : ''}</figure>`);
      if (item.type === 'source') items.push(`<div class="source" style="${box}">${tr('<b>{title}</b> · {page}쪽',{title:esc(item.source.title),page:item.source.page})}${item.quote ? `<q>${esc(item.quote)}</q>` : ''}</div>`);
      if (item.type === 'memo') items.push(`<div class="source" style="${box}"><b>${esc(item.title)}</b><div class="text" style="position:static">${esc(item.text)}</div></div>`);
    }
    return items.join(''); };
    if (page.board) {
      // A whiteboard: a page per sheet, each the sheet's size, showing the board from its top to its cut.
      const height = sheetHeight(page.width), size = `s${Math.round(page.width * 100)}x${Math.round(height * 100)}`; sizes.set(size, { width: page.width, height });
      for (const slice of boardSheets(page)) {
        const items = page.items.filter(i => i.y < slice.bottom && i.y + i.h > slice.top);
        pages.push(`<section class="page" style="page:${size};width:${page.width}pt;height:${height}pt"><div class="slice" style="height:${n3(slice.bottom - slice.top)}pt">${templateSvg(page, slice)}${await itemsHtml(items, slice.top)}${strokeSvg(page.strokes, page, slice)}</div></section>`);
      }
      continue;
    }
    // Each paper size prints on a sheet of its own size (a named @page per size).
    const size = `s${Math.round(page.width * 100)}x${Math.round(page.height * 100)}`; sizes.set(size, page);
    const background = page.background ? `<img class="bg" src="${await asset(page.background)}" alt="">` : '';
    pages.push(`<section class="page" style="page:${size};width:${page.width}pt;height:${page.height}pt">${background}${templateSvg(page)}${await itemsHtml(page.items)}${strokeSvg(page.strokes, page)}</section>`);
  }
  return `<!doctype html><html lang="${uiLanguage()}"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; font-src file:; style-src 'unsafe-inline'"><style>@page{size:A4;margin:0}${[...sizes].map(([name, p]) => `@page ${name}{size:${p.width}pt ${p.height}pt;margin:0}`).join('')}body{margin:0;font-family:'Noto Sans KR',sans-serif;color:#111}.page{position:relative;overflow:hidden;break-after:page}.page:last-child{break-after:auto}.tpl,.ink,.bg{position:absolute;left:0;top:0;width:100%;height:100%}.slice{position:absolute;left:0;top:0;width:100%;overflow:hidden}.bg{object-fit:fill}.ink{z-index:2}.text,figure,.source{position:absolute;margin:0;overflow:hidden;white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.4}figure img{width:100%;height:calc(100% - 14pt);object-fit:contain}figcaption,.source{font-size:9pt;color:#334155}.source{border:1px solid #93c5fd;border-radius:4pt;padding:4pt;background:#eff6ff}.source q{display:block;margin-top:2pt}</style></head><body>${pages.join('')}</body></html>`;
}
// Paper notes as Markdown: bibliography, summary, memo and annotations with
// their pages, so the source stays identifiable outside the app.
function notesMarkdown(paper, notes, annotations, reference) {
  const lines = [`# ${paper.title}`, '', reference ? `> ${reference}` : '', ''];
  const meta = [[tr('저자'), paper.authors], [tr('연도'), paper.year], [tr('수록처'), paper.journal], ['DOI', paper.doi && `https://doi.org/${paper.doi}`], [tr('인용 키'), paper.citekey || require('../core/app-name.cjs').citekeyPrefix + paper.id]].filter(([, v]) => v && v !== '—' && v !== '저자 미입력'); // i18n:keep — the stored value for no author
  lines.push(...meta.map(([k, v]) => `- **${k}**: ${v}`), '');
  const summary = [tr('연구 질문'), tr('방법'), tr('결과'), tr('한계')].map((label, i) => [label, notes[`${paper.id}-summary-${i}`]]).filter(([, v]) => v?.trim());
  if (summary.length) { lines.push(`## ${tr('요약')}`, ''); for (const [label, v] of summary) lines.push(`### ${label}`, '', v.trim(), ''); }
  // The first memo, then the ones added after it (in the order they were made).
  // A memo's own title (<key>#title) becomes its heading.
  const memoKeys = [`${paper.id}-메모`, ...Object.keys(notes).filter(k => k.startsWith(`${paper.id}-메모-`) && !k.includes('#')).sort()].filter(k => notes[k]?.trim() || notes[k + '#title']?.trim()); // i18n:keep — stored memo keys
  if (memoKeys.length) lines.push(`## ${tr('메모')}`, '', memoKeys.map(k => `${notes[k + '#title']?.trim() ? `### ${notes[k + '#title'].trim()}\n\n` : ''}${(notes[k] || '').trim()}`).join('\n\n---\n\n'), '');
  const list = annotations.filter(a => a.paperId === paper.id);
  if (list.length) { lines.push(`## ${tr('주석')}`, ''); for (const a of list) lines.push(`- **${tr('{n}쪽',{n:a.page})}** — ${a.body.replace(/\n/g, ' ')}${a.quote ? `\n  > ${a.quote.replace(/\n/g, ' ')}` : ''}`); lines.push(''); }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n');
}
module.exports = { NotebookStore, notebookHtml, notesMarkdown, validNotebook, boardSheets, A4, BOARD_MAX, sheetHeight, TEMPLATES };
