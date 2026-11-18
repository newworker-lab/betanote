// Copying and moving papers, with everything that belongs to them, to another vault on this computer
// (docs/DEVELOPMENT.md, "다른 저장소로 복사·이동"). Three steps, so that a bundle file sent to another computer can later use
// the same planning and writing:
//   1. collectBundle: what to send, read from the sending vault (records as JSON, files as a list to read from);
//   2. planTransfer: what each paper becomes in the receiving vault (new, merged, skipped, replaced; new ids; places);
//   3. applyTransfer: written into the receiving vault all or nothing, then checked; a move removes what arrived.
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Library, translationFileName, doiKey, citekeyAllocator, atomicJson, readJson } = require('./storage.cjs');
const { tr } = require('../core/i18n.js');
const { fileReason } = require('./file-error.cjs');
const appName = require('../core/app-name.cjs');
const { VAULT_DIR, OLD_VAULT_DIRS, isVaultDirName } = require('./legacy.cjs');

const BUNDLE_VERSION = 1;
const clone = value => JSON.parse(JSON.stringify(value));
// A file's SHA-256, read in pieces: a PDF is never held in memory whole.
function hashFile(file) {
  return new Promise((resolve, reject) => { const hash = crypto.createHash('sha256'); fsSync.createReadStream(file).on('error', reject).on('data', chunk => hash.update(chunk)).on('end', () => resolve(hash.digest('hex'))); });
}
// The ids and places a bundle may name. A bundle is data from elsewhere (a later bundle file can come from another
// computer), so whatever becomes a path in the receiving vault is checked against these first.
const NOTEBOOK_ID = /^[-a-f0-9]{36}$/, ATTACHMENT_ID = /^[-a-zA-Z0-9]{1,100}$/, LANGUAGE = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/, CACHE_KEY = /^[-a-zA-Z0-9]{0,100}$/;
const INTERNAL_PLACES = [/^ink\/[-a-zA-Z0-9]{1,100}\/(?!\.+$)[-\w.]{1,200}$/, /^(ai|corrections)\/[-a-zA-Z0-9]{1,100}\.json$/, /^translation-\d+(-[-a-zA-Z0-9]+)?(\.chunks)?\.json$/, /^notebooks\/[-a-f0-9]{36}\.json$/, /^notebooks\/assets\/[a-f0-9]{64}\.png$/, /^note-images\/[0-9a-f]{32}\.png$/];
// A place in the vault folder (internal) is one of the fixed forms; a place in the vault is a relative path of plain
// names that never enters a vault folder.
function placeAllowed(to, internal) {
  if (typeof to !== 'string' || !to || to.length > 1000 || to.includes('\\') || to.includes('\0') || to.startsWith('/') || /^[a-z]:/i.test(to)) return false;
  const parts = to.split('/');
  if (parts.some(part => !part || part === '.' || part === '..')) return false;
  return internal ? INTERNAL_PLACES.some(form => form.test(to)) : !parts.some(isVaultDirName);
}
const refusedBundle = what => Object.assign(Error(tr('보낼 자료의 기록이 올바르지 않습니다: {what}', { what })), { code: 'APP_TRANSFER_INVALID' });
// The folders a file goes into, made where missing; none of them may be a link or a file (a link would put the file
// outside the vault). The folders made are returned, deepest last, so a send that stops can take them away again.
async function placeFolders(base, parts) {
  const made = []; let current = base;
  for (let i = 0; i < parts.length; i++) {
    current = path.join(current, parts[i]);
    const info = await fs.lstat(current).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    if (!info) { await fs.mkdir(current); made.push(current); continue; }
    if (info.isSymbolicLink() || !info.isDirectory()) throw Object.assign(Error(tr('받는 저장소의 {name}이(가) 폴더가 아니거나 링크입니다.', { name: parts.slice(0, i + 1).join('/') })), { code: 'APP_TRANSFER_PLACE' });
  }
  return made;
}
// The pictures a memo, an annotation or a notebook names: note-image:<32 hex>.png.
function noteImageNames(text) { return [...new Set([...String(text ?? '').matchAll(/note-image:([0-9a-f]{32}\.png)/g)].map(m => m[1]))]; }
const exists = file => fs.lstat(file).then(info => info.isFile() && !info.isSymbolicLink(), () => false);

// What the given papers (all of the vault's, trashed ones and every notebook included, when paperIds is null) take
// with them: their records and the files that belong to them (docs/DEVELOPMENT.md has the table).
// except: papers the whole vault goes without (being translated), the rest of the whole vault's records going all the same.
async function collectBundle(library, paperIds, { except = [], signal } = {}) {
  const whole = paperIds === null, data = library.data, vault = path.join(library.root, VAULT_DIR), left = new Set(except.map(Number));
  const ids = new Set(whole ? data.papers.map(p => p.id).filter(id => !left.has(id)) : paperIds.map(Number));
  const papers = data.papers.filter(p => ids.has(p.id));
  if (!whole && papers.length !== ids.size) throw Error(tr('보낼 자료를 찾을 수 없습니다. 목록을 다시 보고 고르세요.'));
  const notes = Object.fromEntries(Object.entries(data.notes).filter(([key]) => ids.has(Number(key.split('-')[0])) && /^\d+-/.test(key)));
  const annotations = data.annotations.filter(a => ids.has(a.paperId));
  const files = [], seen = new Set();
  const add = async (entry, abs) => {
    const key = (entry.internal ? 'i:' : 'r:') + entry.path; if (seen.has(key)) return; seen.add(key);
    if (signal?.aborted) throw cancelled();
    const present = await exists(abs);
    if (!present && entry.kind !== 'pdf' && entry.kind !== 'translated-pdf') return;
    files.push({ ...entry, size: present ? (await fs.stat(abs)).size : 0, sha256: present ? await hashFile(abs) : null });
  };
  const inside = (...parts) => path.join(vault, ...parts);
  const vaultNames = await fs.readdir(vault).catch(() => []);
  for (const paper of papers) for (const a of paper.attachments) {
    // The PDF: where the attachment says (a translation PDF lives under translations/).
    const translated = a.role === 'translated';
    await add({ kind: translated ? 'translated-pdf' : 'pdf', path: a.path, internal: false, paperId: paper.id, attachmentId: a.id }, path.join(library.root, ...String(a.path).split('/')));
    if (!/^[-a-zA-Z0-9]+$/.test(a.id)) continue;
    // Its ink (one folder of logs and states), AI results and corrections.
    for (const name of (await fs.readdir(inside('ink', a.id)).catch(() => [])).filter(n => placeAllowed(`ink/${a.id}/${n}`, true))) await add({ kind: 'ink', path: `ink/${a.id}/${name}`, internal: true, paperId: paper.id, attachmentId: a.id }, inside('ink', a.id, name));
    await add({ kind: 'ai', path: `ai/${a.id}.json`, internal: true, paperId: paper.id, attachmentId: a.id }, inside('ai', a.id + '.json'));
    await add({ kind: 'corrections', path: `corrections/${a.id}.json`, internal: true, paperId: paper.id, attachmentId: a.id }, inside('corrections', a.id + '.json'));
    // Its translation records: the Korean one and those in other languages (-lang-<code>), each with its chunks.
    const name = translationFileName(paper.id, a); if (!name) continue;
    const stem = name.replace(/\.json$/, ''), languages = [['ko', name], ...vaultNames.filter(n => n.startsWith(stem + '-lang-') && n.endsWith('.json') && !n.endsWith('.chunks.json')).map(n => [n.slice(stem.length + 6, -5), n]).filter(([code]) => LANGUAGE.test(code))];
    for (const [language, file] of languages) {
      await add({ kind: 'translation', path: file, internal: true, paperId: paper.id, attachmentId: a.id, language }, inside(file));
      const chunks = file.replace(/\.json$/, '.chunks.json'); await add({ kind: 'chunks', path: chunks, internal: true, paperId: paper.id, attachmentId: a.id, language }, inside(chunks));
    }
  }
  // Notebooks: those of the papers (trashed ones too, so a move loses none), or every one for the whole vault (one of a
  // paper no longer there too: the app still shows it) but those of the papers left out. A notebook is the file of its
  // name: the id written inside it is not trusted for a place.
  const notebooks = [];
  for (const name of (await fs.readdir(inside('notebooks')).catch(() => [])).filter(n => /^[-a-f0-9]{36}\.json$/.test(n)).sort()) {
    let notebook; try { notebook = JSON.parse(await fs.readFile(inside('notebooks', name), 'utf8')); } catch { continue; }
    if (!notebook || typeof notebook !== 'object' || Array.isArray(notebook)) continue;
    if (whole ? left.has(notebook.paperId) : !ids.has(notebook.paperId)) continue;
    notebook.id = name.slice(0, 36);
    notebooks.push(notebook);
    for (const page of notebook.pages || []) for (const hash of [page.background, ...(page.items || []).map(i => i.type === 'image' && i.asset)].filter(h => typeof h === 'string' && /^[a-f0-9]{64}$/.test(h)))
      await add({ kind: 'notebook-asset', path: `notebooks/assets/${hash}.png`, internal: true }, inside('notebooks', 'assets', hash + '.png'));
  }
  // Pictures pasted into memos, annotations or notebook boxes.
  for (const name of noteImageNames(JSON.stringify([notes, annotations, notebooks]))) await add({ kind: 'note-image', path: `note-images/${name}`, internal: true }, inside('note-images', name));
  const tags = new Set(papers.flatMap(p => p.tags || [])), colors = data.tagColors || {};
  const tagColors = Object.fromEntries(Object.entries(colors).filter(([tag]) => whole || tags.has(tag)));
  // The collections the papers are in, with their ancestors (all of them for the whole vault).
  const byId = new Map((data.collections || []).map(c => [c.id, c])), wanted = new Set();
  for (const id of whole ? byId.keys() : papers.flatMap(p => p.collectionIds || [])) for (let at = id, guard = 0; at && byId.has(at) && guard < 100; at = byId.get(at).parentId, guard++) wanted.add(at);
  return {
    version: BUNDLE_VERSION, from: { vaultId: data.id, name: path.basename(library.root) }, whole,
    papers: clone(papers), notes: clone(notes), annotations: clone(annotations), notebooks: clone(notebooks), tagColors: clone(tagColors),
    collections: clone([...byId.values()].filter(c => wanted.has(c.id))),
    ...(whole ? { savedSearches: clone(data.savedSearches || []), glossary: clone(data.glossary || []), translationRules: data.translationRules || '', aiRules: data.aiRules || '' } : {}),
    files,
  };
}

// Reads a bundle's files from the sending vault: a path that leaves the vault or passes a link is refused, a copy never
// overwrites, and a PDF is copied file to file (never read into memory).
function sourceReader(root) {
  const resolve = async entry => {
    const relative = String(entry.path);
    if (!relative || relative.startsWith('/') || relative.includes('\\') || relative.split('/').some(part => !part || part === '.' || part === '..')) throw Error(tr('보낼 파일의 자리가 저장소 밖을 가리킵니다: {name}', { name: relative }));
    const base = entry.internal ? path.join(root, VAULT_DIR) : root, file = path.join(base, ...relative.split('/'));
    const real = await fs.realpath(file), realBase = await fs.realpath(base);
    if (real !== path.join(realBase, ...relative.split('/'))) throw Error(tr('보낼 파일의 자리가 저장소 밖을 가리킵니다: {name}', { name: relative }));
    return file;
  };
  return {
    async copy(entry, destination) { await fs.copyFile(await resolve(entry), destination, fs.constants.COPYFILE_EXCL); },
    async read(entry) { return fs.readFile(await resolve(entry)); },
  };
}


// Whether a bundle's notebook goes with the papers sent: one of a paper sent; for the whole vault also one of no paper
// or of a paper no longer there (it arrives belonging to none).
function notebookOwned(bundle, n) { return n.paperId !== null && n.paperId !== undefined && bundle.papers.some(p => p.id === n.paperId); }
function notebookGoes(bundle, n, sent) { return notebookOwned(bundle, n) ? sent.has(n.paperId) : Boolean(bundle.whole); }

// A bundle's records, checked before anything is planned from them: the ids that become names and the places files go.
function checkBundle(bundle) {
  if (!bundle || bundle.version !== BUNDLE_VERSION || !Array.isArray(bundle.papers) || !Array.isArray(bundle.files) || !Array.isArray(bundle.notebooks) || !Array.isArray(bundle.annotations) || !Array.isArray(bundle.collections) || !bundle.notes || typeof bundle.notes !== 'object') throw refusedBundle('version');
  const owner = new Map(), paperIds = new Set();
  for (const p of bundle.papers) {
    if (!p || !Number.isSafeInteger(p.id) || p.id <= 0 || paperIds.has(p.id) || !Array.isArray(p.attachments)) throw refusedBundle(tr('자료'));
    paperIds.add(p.id);
    for (const a of p.attachments) {
      const cacheOwner = a?.cacheOwnerId;
      if (!a || !ATTACHMENT_ID.test(a.id) || owner.has(a.id) || !placeAllowed(a.path, false) || !CACHE_KEY.test(a.cacheKey ?? '') || (cacheOwner !== undefined && cacheOwner !== null && cacheOwner !== '' && !Number.isSafeInteger(Number(cacheOwner)))) throw refusedBundle(tr('첨부파일'));
      owner.set(a.id, p.id);
    }
  }
  for (const n of bundle.notebooks) if (!n || !NOTEBOOK_ID.test(n.id)) throw refusedBundle(tr('노트북'));
  for (const a of bundle.annotations) if (!a || typeof a.id !== 'string' || !paperIds.has(a.paperId) || owner.get(a.attachmentId) !== a.paperId) throw refusedBundle(tr('주석'));
  for (const f of bundle.files) {
    if (!f || !placeAllowed(f.path, Boolean(f.internal)) || (f.sha256 !== null && !/^[a-f0-9]{64}$/.test(f.sha256))) throw refusedBundle(String(f?.path));
    const own = owner.has(f.attachmentId) && owner.get(f.attachmentId) === f.paperId;
    const fits = {
      pdf: !f.internal && own, 'translated-pdf': !f.internal && own,
      ink: f.internal && own, ai: f.internal && own, corrections: f.internal && own,
      translation: f.internal && own && (f.language === 'ko' || LANGUAGE.test(f.language)), chunks: f.internal && own && (f.language === 'ko' || LANGUAGE.test(f.language)),
      'notebook-asset': f.internal && /^notebooks\/assets\/[a-f0-9]{64}\.png$/.test(f.path), 'note-image': f.internal && /^note-images\/[0-9a-f]{32}\.png$/.test(f.path),
    }[f.kind];
    if (!fits) throw refusedBundle(String(f.path));
  }
}

// A receiving folder can hold a vault: its vault folder name (or an earlier name's) is a folder there or free, never a
// file or a link (opening it would fail with a file error, or follow the link).
async function vaultPlace(root) {
  for (const name of [VAULT_DIR, ...OLD_VAULT_DIRS]) {
    const info = await fs.lstat(path.join(root, name)).catch(() => null);
    if (info && (info.isSymbolicLink() || !info.isDirectory())) throw Object.assign(Error(tr('이 폴더는 저장소로 쓸 수 없습니다: {name}이(가) 폴더가 아닙니다.', { name })), { code: 'APP_TRANSFER_PLACE' });
  }
}

// The receiving folder asked for: '' (the vault's top) or a path of folder names the vault could make (the rules a new
// folder has), never one of its own folders or translations.
function receivingFolder(folder) {
  if (folder === undefined || folder === null || folder === '') return '';
  const refused = () => Object.assign(Error(tr('이 폴더에는 받을 수 없습니다: {folder}', { folder: String(folder).slice(0, 120) })), { code: 'APP_TRANSFER_FOLDER' });
  if (typeof folder !== 'string' || folder.length > 500 || folder.includes('\\')) throw refused();
  const parts = folder.split('/');
  for (let i = 0; i < parts.length; i++) {
    try { Library.prototype.folderName(parts.slice(0, i).join('/'), parts[i]); } catch { throw refused(); }
    if (isVaultDirName(parts[i]) || (i === 0 && parts[i].toLowerCase() === 'translations')) throw refused();
  }
  if (!placeAllowed(folder, false)) throw refused();
  return folder;
}
// The receiving vault's folders, read only: plain folders (no links), not its own folders, hidden ones or translations,
// as POSIX paths in order, a folder before what is in it.
async function receivingFolders(root, { limit = 1000, depth = 8 } = {}) {
  const out = [];
  const walk = async (relative, level) => {
    if (level > depth || out.length >= limit) return;
    const entries = await fs.readdir(path.join(root, ...relative.split('/').filter(Boolean)), { withFileTypes: true }).catch(() => []);
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.isDirectory() || entry.name.startsWith('.') || isVaultDirName(entry.name) || (!relative && entry.name.toLowerCase() === 'translations')) continue;
      const next = relative ? `${relative}/${entry.name}` : entry.name; if (out.length >= limit) return; out.push(next); await walk(next, level + 1);
    }
  };
  await walk('', 1);
  return out;
}

// Two folders that are the same, or one inside the other, by their real paths (a link to a folder is that folder).
async function sameOrNested(a, b) {
  const [x, y] = await Promise.all([fs.realpath(a), fs.realpath(b)]), within = (inner, outer) => inner === outer || inner.startsWith(outer.endsWith(path.sep) ? outer : outer + path.sep);
  return within(x, y) || within(y, x);
}

// An attachment id of the old form names its item's number (original-<id>, translated-<id>): two vaults can share one by
// chance, so it is no sign of an earlier copy and is renumbered when the receiving vault has it.
const OLD_FORM_ID = /^(original|translated)-\d+$/;
// Such an id arrives as a UUID made from the sending vault's id and itself, the same on every send, so a paper sent
// again is known by it (no other trace is written).
function arrivingId(bundle, id) {
  if (!OLD_FORM_ID.test(id)) return id;
  if (typeof bundle.from?.vaultId !== 'string' || !bundle.from.vaultId) return null;
  const h = crypto.createHash('sha256').update(`${bundle.from.vaultId}\n${id}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
// A file error in words, without the folders it names (the code stays for the screen and the record).
function fileError(error) {
  if (!error || typeof error.code !== 'string' || !/^E[A-Z]+$/.test(error.code)) return error;
  const reason = fileReason(error);
  return Object.assign(Error(tr('보내기를 마치지 못했습니다. {reason} ({code})', { reason, code: error.code })), { code: error.code, cause: error });
}
// A free name for a file: the name asked for, else "name (2).ext", "name (3).ext" … in the same folder.
function freeName(wanted, taken) {
  if (!taken(wanted)) return wanted;
  const slash = wanted.lastIndexOf('/'), folder = wanted.slice(0, slash + 1), name = wanted.slice(slash + 1), dot = name.lastIndexOf('.'), base = dot > 0 ? name.slice(0, dot) : name, ext = dot > 0 ? name.slice(dot) : '';
  for (let n = 2; ; n++) { const next = `${folder}${base} (${n})${ext}`; if (!taken(next)) return next; }
}

// What the bundle's papers become in the receiving vault, read only (docs/DEVELOPMENT.md has the rules):
//   - an earlier copy (the receiving side has one of the paper's attachment ids) is skipped or replaced, as chosen;
//   - the same paper (same PDF fingerprint or DOI as a live paper there) is merged into it;
//   - otherwise it is new, renumbered only when its number is taken (with every id that refers to it).
// Files get their places: PDFs keep their folders and never overwrite; a PDF the receiving paper already has is not copied
// again unless both copies carry work; translation records get names no other attachment uses.
async function planTransfer(bundle, target, { existing = 'skip', folder = '', keepFolders = true } = {}) {
  checkBundle(bundle); await vaultPlace(target.root);
  // New PDFs go under the receiving folder: with the sending side's folders (the top and the folders kept: as before),
  // or by their file names alone. A translation PDF stays under translations/.
  const receiving = receivingFolder(folder), keep = keepFolders !== false;
  const newPlace = entry => { if (entry.kind === 'translated-pdf') return entry.path; const name = keep ? entry.path : entry.path.split('/').pop(); return receiving ? `${receiving}/${name}` : name; };
  const data = target.data, vault = path.join(target.root, target.vaultFolder || VAULT_DIR);
  const vaultNames = new Set(await fs.readdir(vault).catch(() => []));
  const there = (...parts) => fs.access(path.join(vault, ...parts)).then(() => true, () => false);
  // The receiving side's PDFs by what they hold now (read in pieces; a missing file or a link holds nothing).
  const contents = new Map();
  const content = async relative => {
    if (!contents.has(relative)) { const file = path.join(target.root, ...String(relative).split('/')); contents.set(relative, await fs.lstat(file).then(info => info.isFile() ? hashFile(file) : null, () => null).catch(() => null)); }
    return contents.get(relative);
  };
  const usedPapers = new Set(data.papers.map(p => p.id)), attachmentOwner = new Map(), joinedBefore = new Map();
  for (const p of data.papers) {
    for (const a of p.attachments) attachmentOwner.set(a.id, p);
    // The attachments of a paper merged in by an earlier send (their records joined attachments of this one).
    for (const m of p.mergedFrom || []) for (const id of Array.isArray(m?.attachments) ? m.attachments : []) if (typeof id === 'string') joinedBefore.set(id, p);
  }
  const usedAnnotations = new Set(data.annotations.map(a => a.id)), usedNotebooks = new Set();
  for (const name of await fs.readdir(path.join(vault, 'notebooks')).catch(() => [])) if (/^[-a-f0-9]{36}\.json$/.test(name)) usedNotebooks.add(name.slice(0, 36));
  const live = p => p.attachments.filter(a => !a.trashedAt && a.role !== 'translated');
  const pdfEntry = new Map(bundle.files.filter(f => f.kind === 'pdf' || f.kind === 'translated-pdf').map(f => [f.attachmentId, f]));
  // The receiving side's live papers by PDF fingerprint (the one recorded and the file's) and by DOI.
  const byHash = new Map(), byDoi = new Map();
  for (const p of data.papers.filter(p => !p.trashedAt)) {
    // The fingerprint recorded, else the file's; a file is read only for the papers a sent one may join (below).
    for (const a of live(p)) { const hash = a.sourceHash || await content(a.path); if (hash && !byHash.has(hash)) byHash.set(hash, p); }
    const doi = doiKey(p.doi); if (doi && !byDoi.has(doi)) byDoi.set(doi, p);
  }
  const freshPaperId = () => { let id; do { id = Date.now() * 1000 + crypto.randomInt(1000); } while (usedPapers.has(id)); usedPapers.add(id); return id; };
  // Citation keys in use there: the ones written and the default key of each paper without one.
  const citekey = citekeyAllocator(new Set(data.papers.map(p => p.citekey || appName.citekeyPrefix + p.id)));
  const ids = { papers: new Map(), attachments: new Map(), notebooks: new Map(), annotations: new Map(), collections: new Map(), searches: new Map() };
  const papers = [], reuse = new Map(), owners = new Map(), cacheKeys = new Map();
  for (const p of bundle.papers) {
    const earlier = p.attachments.map(a => { const id = arrivingId(bundle, a.id); return id && attachmentOwner.get(id); }).find(Boolean);
    if (earlier) { papers.push({ from: p.id, to: earlier.id, action: existing === 'replace' ? 'replace' : 'skip', into: earlier.id, renumbered: false }); continue; }
    // Merged into a paper there by an earlier send: that paper is partly the receiving side's own, so it is never replaced.
    const joined = p.attachments.map(a => { const id = arrivingId(bundle, a.id); return id && joinedBefore.get(id); }).find(Boolean);
    if (joined) { papers.push({ from: p.id, to: joined.id, action: 'skip', into: joined.id, renumbered: false, reason: 'joined' }); continue; }
    const hashes = live(p).flatMap(a => [pdfEntry.get(a.id)?.sha256, a.sourceHash]).filter(Boolean);
    const same = p.trashedAt ? null : hashes.map(h => byHash.get(h)).find(Boolean) || (doiKey(p.doi) && byDoi.get(doiKey(p.doi))) || null;
    const to = usedPapers.has(p.id) ? freshPaperId() : (usedPapers.add(p.id), p.id), renumbered = to !== p.id;
    ids.papers.set(p.id, to);
    const row = { from: p.id, to, action: same ? 'merge' : 'new', renumbered, ...(same ? { into: same.id } : {}) };
    // A new paper keeps its citation key (a letter added when taken); one renumbered without a key of its own keeps the
    // default key it had (prefix + its old number), so citations in a manuscript still find it; one keeping its number
    // and no key of its own keeps its default key, which no other paper may then take. A merged one takes the receiving
    // paper's key (its own is kept in mergedFrom).
    if (!same) { const key = p.citekey || (renumbered ? appName.citekeyPrefix + p.id : ''); if (key) row.citekey = citekey(key); else { const own = appName.citekeyPrefix + to, given = citekey(own); if (given !== own) row.citekey = given; } }
    papers.push(row);
  }
  // Earlier copies the receiving side merged into one paper: replacing would write one over the other, so none of them is
  // replaced (and a move leaves them where they are).
  const replacing = new Map(); for (const r of papers) if (r.action === 'replace') replacing.set(r.into, (replacing.get(r.into) || 0) + 1);
  for (const r of papers) if (r.action === 'replace' && replacing.get(r.into) > 1) { r.action = 'skip'; r.reason = 'joined'; }
  const sent = new Map(papers.filter(r => r.action !== 'skip').map(r => [r.from, r])), sentIds = new Set(sent.keys());
  // A replaced paper: its attachments the receiving copy has keep their ids and places there (replacedAttachment).
  const replacedAttachment = new Map(), into = row => data.papers.find(q => q.id === row.into);
  for (const row of papers.filter(r => r.action === 'replace')) { ids.papers.set(row.from, row.into); const q = into(row); for (const a of bundle.papers.find(x => x.id === row.from).attachments) { const b = q.attachments.find(x => x.id === arrivingId(bundle, a.id)); if (b) { replacedAttachment.set(a.id, b); ids.attachments.set(a.id, b.id); } } }
  const renewed = new Set(papers.filter(r => r.action === 'replace').map(r => r.into));
  const work = new Set([...bundle.files.filter(f => ['ink', 'translation', 'chunks', 'ai', 'corrections'].includes(f.kind)).map(f => f.attachmentId), ...bundle.annotations.map(a => a.attachmentId)]);
  // Attachments: renumbered when the receiving side has the id (only the old form can) or files under it. A PDF the
  // receiving paper holds now, byte for byte, is used again (its records joining that attachment) unless both carry work
  // or another attachment sent already joined it; a PDF only recorded there, or different, is copied.
  const joinedTargets = new Set();
  for (const p of bundle.papers) {
    const row = sent.get(p.id); if (!row) continue;
    const kept = row.action === 'merge' ? data.papers.find(q => q.id === row.into) : null;
    for (const a of p.attachments) {
      if (replacedAttachment.has(a.id)) continue;
      const hash = pdfEntry.get(a.id)?.sha256;
      let same = null;
      if (kept && hash && !a.trashedAt && a.role !== 'translated') for (const b of live(kept)) if (!joinedTargets.has(b.id) && await content(b.path) === hash) { same = b; break; }
      if (same && !(work.has(a.id) && await target.attachmentWork(kept.id, same))) { reuse.set(a.id, same); joinedTargets.add(same.id); ids.attachments.set(a.id, same.id); continue; }
      const taken = attachmentOwner.has(a.id) || [...ids.attachments.entries()].some(([from, to]) => to === a.id && from !== a.id) || await there('ink', a.id) || await there('ai', a.id + '.json') || await there('corrections', a.id + '.json');
      const arriving = arrivingId(bundle, a.id);
      ids.attachments.set(a.id, arriving && arriving !== a.id && !attachmentOwner.has(arriving) ? arriving : taken ? crypto.randomUUID() : a.id);
    }
  }
  // Translation records: every attachment that arrives gets an owner number and a key no attachment of the receiving
  // side (nor another one received) uses, whether or not it has a record yet, so no record is ever written over another.
  const stems = new Set(); for (const p of data.papers) for (const a of p.attachments) { const name = translationFileName(p.id, a); if (name) stems.add(name.slice(0, -5)); }
  const stemTaken = stem => stems.has(stem) || [...vaultNames].some(n => n === stem + '.json' || n.startsWith(stem + '-lang-') || n === stem + '.chunks.json');
  const stemOf = new Map();
  for (const p of bundle.papers) {
    const row = sent.get(p.id); if (!row) continue;
    for (const a of p.attachments) {
      const to = ids.attachments.get(a.id);
      if (replacedAttachment.has(a.id)) { const name = translationFileName(row.into, replacedAttachment.get(a.id)); if (name) stemOf.set(a.id, name.slice(0, -5)); continue; }
      if (reuse.has(a.id)) { const name = translationFileName(row.into, reuse.get(a.id)); if (name) stemOf.set(a.id, name.slice(0, -5)); continue; }
      const key = a.cacheKey ?? a.id; let owner = Number(a.cacheOwnerId || p.id);
      const stem = n => `translation-${n}${key ? '-' + key : ''}`;
      while (!Number.isSafeInteger(owner) || owner <= 0 || stemTaken(stem(owner))) owner = freshPaperId();
      stems.add(stem(owner)); stemOf.set(a.id, stem(owner)); owners.set(to, owner); cacheKeys.set(to, key);
    }
  }
  // Files and their places.
  const placedPaths = new Set(data.papers.flatMap(p => p.attachments.map(a => a.path))), files = [], images = new Map();
  const rootTaken = relative => placedPaths.has(relative) || fsSync.existsSync(path.join(target.root, ...relative.split('/')));
  for (const entry of bundle.files) {
    const row = entry.paperId !== undefined ? sent.get(entry.paperId) : null;
    if (entry.paperId !== undefined && !row) continue; // a skipped paper's files
    const attachment = entry.attachmentId && ids.attachments.get(entry.attachmentId);
    if (entry.kind === 'pdf' || entry.kind === 'translated-pdf') {
      // A PDF the receiving copy has stays where it was put there; its file is replaced only when the content differs.
      if (replacedAttachment.has(entry.attachmentId)) {
        const b = replacedAttachment.get(entry.attachmentId);
        if (!entry.sha256) continue;
        const now = await content(b.path);
        files.push({ entry, to: b.path, internal: false, reuse: now === entry.sha256, replace: now !== entry.sha256 && fsSync.existsSync(path.join(target.root, ...String(b.path).split('/'))) }); continue;
      }
      if (reuse.has(entry.attachmentId)) { files.push({ entry, to: reuse.get(entry.attachmentId).path, internal: false, reuse: true }); continue; }
      const to = freeName(newPlace(entry), rootTaken); placedPaths.add(to); files.push({ entry, to, internal: false, reuse: false }); continue;
    }
    const replacing = replacedAttachment.has(entry.attachmentId);
    if (entry.kind === 'ink') { const to = `ink/${attachment}/${entry.path.split('/').pop()}`; files.push({ entry, to, internal: true, reuse: false, replace: replacing && await there(...to.split('/')) }); continue; }
    if (entry.kind === 'ai' || entry.kind === 'corrections') { const to = `${entry.kind}/${attachment}.json`; files.push({ entry, to, internal: true, reuse: false, replace: replacing && await there(...to.split('/')) }); continue; }
    if (entry.kind === 'translation' || entry.kind === 'chunks') {
      const stem = stemOf.get(entry.attachmentId); if (!stem) continue;
      const name = stem + (entry.language === 'ko' ? '' : '-lang-' + entry.language) + (entry.kind === 'chunks' ? '.chunks.json' : '.json');
      files.push({ entry, to: name, internal: true, reuse: false, replace: replacing && vaultNames.has(name) }); continue;
    }
    // Pictures are named by their content: one already there is the same picture (a pasted picture under a name taken by
    // other content gets a new name, and what names it is changed).
    if (entry.kind === 'notebook-asset') { const file = path.join(vault, ...entry.path.split('/')); files.push({ entry, to: entry.path, internal: true, reuse: await fs.lstat(file).then(i => i.isFile(), () => false) && await hashFile(file).catch(() => null) === entry.sha256 }); continue; }
    if (entry.kind === 'note-image') {
      const file = path.join(vault, ...entry.path.split('/'));
      if (!fsSync.existsSync(file)) { files.push({ entry, to: entry.path, internal: true, reuse: false }); continue; }
      if (await hashFile(file).catch(() => null) === entry.sha256) { files.push({ entry, to: entry.path, internal: true, reuse: true }); continue; }
      const name = crypto.randomBytes(16).toString('hex') + '.png'; images.set(entry.path.split('/').pop(), name); files.push({ entry, to: `note-images/${name}`, internal: true, reuse: false });
    }
  }
  // Every place is checked, and no two files go to one place (two would silently become one).
  const places = new Set();
  for (const f of files) {
    if (!placeAllowed(f.to, f.internal)) throw refusedBundle(f.to);
    const key = (f.internal ? 'i:' : 'r:') + f.to; if (places.has(key)) throw refusedBundle(f.to); places.add(key);
  }
  // Notebooks of the papers sent (and, for the whole vault, those of no paper there), annotations: renumbered on a clash.
  // A replaced paper's notebooks and annotations take the place of the receiving copy's (whose ids they keep); a notebook
  // only the receiving side has stays, as an attachment only it has does. A notebook of no paper already there
  // was sent before: skipped, or replaced as the papers are when it is still one of no paper there.
  const notebookPaper = new Map();
  for (const id of usedNotebooks) { const n = await readJson(path.join(vault, 'notebooks', id + '.json'), null).catch(() => null); notebookPaper.set(id, n?.paperId ?? null); }
  const replacedAnnotations = new Set(data.annotations.filter(a => renewed.has(a.paperId) && replacedAttachment.has(a.attachmentId)).map(a => a.id));
  for (const n of bundle.notebooks) {
    if (!notebookGoes(bundle, n, sentIds)) continue;
    if (!notebookOwned(bundle, n) && usedNotebooks.has(n.id)) {
      const theirs = notebookPaper.get(n.id);
      if (existing === 'replace' && !data.papers.some(p => p.id === theirs)) ids.notebooks.set(n.id, n.id);
      continue;
    }
    const own = renewed.has(notebookPaper.get(n.id)) && sent.get(n.paperId)?.action === 'replace';
    ids.notebooks.set(n.id, usedNotebooks.has(n.id) && !own ? crypto.randomUUID() : n.id);
  }
  for (const a of bundle.annotations) if (sent.has(a.paperId)) ids.annotations.set(a.id, usedAnnotations.has(a.id) && !replacedAnnotations.has(a.id) ? crypto.randomUUID() : a.id);
  const removals = [], overwritten = new Set(files.filter(f => f.replace).map(f => (f.internal ? 'i:' : 'r:') + f.to));
  const remove = (to, internal = true) => { if (!overwritten.has((internal ? 'i:' : 'r:') + to) && !removals.some(r => r.to === to)) removals.push({ to, internal }); };
  for (const b of replacedAttachment.values()) {
    const id = b.id;
    for (const name of await fs.readdir(path.join(vault, 'ink', id)).catch(() => [])) if (placeAllowed(`ink/${id}/${name}`, true) && !files.some(f => f.internal && f.to === `ink/${id}/${name}`)) remove(`ink/${id}/${name}`);
    for (const dir of ['ai', 'corrections']) if (await there(dir, id + '.json') && !files.some(f => f.internal && f.to === `${dir}/${id}.json`)) remove(`${dir}/${id}.json`);
    const owner = data.papers.find(q => q.attachments.includes(b)), name = owner && translationFileName(owner.id, b), stem = name && name.slice(0, -5);
    if (stem) for (const n of vaultNames) if ((n === stem + '.json' || n === stem + '.chunks.json' || n.startsWith(stem + '-lang-')) && placeAllowed(n, true) && !files.some(f => f.internal && f.to === n)) remove(n);
  }
  // Collections: one of the same name under the same parent is that collection; another is made (a new id if taken).
  // Those whose parent never comes (a loop) are made at the top rather than left out.
  const collections = data.collections, usedCollections = new Set(collections.map(c => c.id)), newCollections = [];
  const place = (c, top) => {
    const parentId = !top && c.parentId ? ids.collections.get(c.parentId) : undefined;
    const match = [...collections, ...newCollections].find(x => x.name === c.name && (x.parentId || undefined) === parentId);
    if (match) { ids.collections.set(c.id, match.id); return; }
    const id = usedCollections.has(c.id) || typeof c.id !== 'string' ? crypto.randomUUID() : c.id; usedCollections.add(id); ids.collections.set(c.id, id);
    const made = { ...c, id }; if (parentId) made.parentId = parentId; else delete made.parentId; newCollections.push(made);
  };
  let pending = bundle.collections.filter(c => c && typeof c.name === 'string');
  while (pending.length) {
    const waiting = pending.filter(c => c.parentId && pending.some(x => x !== c && x.id === c.parentId) && !ids.collections.has(c.parentId));
    if (waiting.length === pending.length) { for (const c of waiting) place(c, true); break; }
    for (const c of pending) if (!waiting.includes(c)) place(c, false);
    pending = waiting;
  }
  // Tag colours fill only what the receiving side lacks; saved searches (whole vault) only those of a new name, naming the
  // collection they arrive with.
  const theirColors = data.tagColors || {}, tagColors = Object.fromEntries(Object.entries(bundle.tagColors || {}).filter(([tag, color]) => typeof color === 'string' && color && !theirColors[tag]));
  const newSearches = [];
  for (const s of bundle.savedSearches || []) {
    if (!s || typeof s.id !== 'string' || typeof s.name !== 'string') continue;
    const same = (data.savedSearches || []).find(x => x.name === s.name); if (same) { ids.searches.set(s.id, same.id); continue; }
    const id = (data.savedSearches || []).some(x => x.id === s.id) ? crypto.randomUUID() : s.id; ids.searches.set(s.id, id);
    const search = { ...s, id }; if (s.collectionId) search.collectionId = ids.collections.get(s.collectionId) || null;
    newSearches.push(search);
  }
  const copied = files.filter(f => !f.reuse && f.entry.sha256);
  const counts = {
    papers: papers.filter(r => r.action !== 'skip').length, pdfs: copied.filter(f => f.entry.kind === 'pdf' || f.entry.kind === 'translated-pdf').length, bytes: copied.reduce((n, f) => n + f.entry.size, 0),
    merge: papers.filter(r => r.action === 'merge').length, skip: papers.filter(r => r.action === 'skip').length, replace: papers.filter(r => r.action === 'replace').length,
    renumbered: papers.filter(r => r.renumbered).length, missingPdf: files.filter(f => (f.entry.kind === 'pdf' || f.entry.kind === 'translated-pdf') && !f.entry.sha256).length,
  };
  return { papers, ids, owners, cacheKeys, reuse: new Map([...reuse].map(([id, b]) => [id, b.id])), replacedAttachments: new Set(replacedAttachment.keys()), replacedAnnotations, removals, notebookReplaced: new Set([...ids.notebooks.values()].filter(id => usedNotebooks.has(id))), images, files, newCollections, tagColors, newSearches, counts, fresh: Boolean(target.fresh), loosePdfs: target.loosePdfs || 0 };
}

function cancelled() { return Object.assign(Error(tr('보내기를 취소했습니다.')), { code: 'APP_TRANSFER_CANCELLED' }); }
const isFile = file => fs.lstat(file).then(() => true, () => false);
const textHash = text => crypto.createHash('sha256').update(text).digest('hex');
// Moves a send's staged files into their places (only those still staged, never over a file) and removes the staging
// folder and the journal: the last step of a send, or of one the app stopped in after the receiving vault was saved.
// A replaced paper's old files go first: a PDF to the computer's trash (discard, when given), the others aside into the
// staging folder, removed with it.
// A journal is read from a vault folder others can write to (a shared or synced one): its staged names are numbers and
// its places are ones a send can make, or nothing in it is done.
function journalFits(journal) {
  const fits = m => m && typeof m === 'object' && placeAllowed(m.to, Boolean(m.internal));
  return Array.isArray(journal.moves) && journal.moves.every(m => fits(m) && /^\d{1,9}$/.test(String(m.staged))) && (journal.removals === undefined || (Array.isArray(journal.removals) && journal.removals.every(fits)));
}
// An existing file's place, through folders that are folders (not links); none when a folder on the way is missing or
// not a plain folder.
async function placeThere(base, to) {
  const parts = to.split('/'); let current = base;
  for (const part of parts.slice(0, -1)) { current = path.join(current, part); const info = await fs.lstat(current).catch(() => null); if (!info || info.isSymbolicLink() || !info.isDirectory()) return null; }
  return path.join(base, ...parts);
}
async function finishMoves(root, journal, discard = null) {
  if (!journalFits(journal)) throw refusedBundle('journal');
  const vault = path.join(root, VAULT_DIR), stage = path.join(vault, `transfer-${journal.id}`), baseOf = m => m.internal ? vault : root;
  let aside = 0; const putAside = async (file, internal) => { if (!internal && discard) { try { await discard(file); if (!await isFile(file)) return; } catch { /* no recycle bin: put aside below */ } } await fs.rename(file, path.join(stage, `old-${journal.id.slice(0, 8)}-${++aside}`)); };
  await fs.mkdir(stage, { recursive: true });
  for (const removal of journal.removals || []) { const file = await placeThere(baseOf(removal), removal.to); if (file && await isFile(file)) await putAside(file, removal.internal); }
  for (const move of journal.moves) {
    const staged = path.join(stage, String(move.staged));
    if (!await isFile(staged)) continue;
    const parts = move.to.split('/'); await placeFolders(baseOf(move), parts.slice(0, -1));
    const to = path.join(baseOf(move), ...parts);
    if (await isFile(to)) { if (!move.replace) continue; await putAside(to, move.internal); }
    await fs.rename(staged, to);
  }
  await fs.rm(stage, { recursive: true, force: true }); await fs.rm(path.join(vault, `transfer-${journal.id}.json`), { force: true });
}

// Writes the planned papers into the receiving vault (opened and locked by the caller), all or nothing:
//   1. a backup of its records; 2. every file copied into a staging folder inside its vault folder (out of the vault's
//   scan), with a journal of what goes where; 3. its library.json saved once; 4. the files moved into place; 5. checked.
// Anything failing before the save leaves the vault as it was (the staging folder and the journal removed); after the
// save, a send the app stopped in is finished when the vault is next opened (recoverTransfers).
async function applyTransfer(plan, bundle, target, reader, { onProgress, signal, hooks = {}, discard = file => fs.rm(file, { force: true }) } = {}) {
  const vault = path.join(target.root, VAULT_DIR), id = crypto.randomUUID(), stage = path.join(vault, `transfer-${id}`), journalFile = path.join(vault, `transfer-${id}.json`);
  const rows = plan.papers, sent = rows.filter(r => r.action !== 'skip'), sentFrom = new Set(sent.map(r => r.from));
  const attachmentTo = id => plan.ids.attachments.get(id) ?? id, finalPaper = from => { const row = sent.find(r => r.from === from); return row ? (row.action === 'merge' ? row.into : row.to) : undefined; };
  const picture = text => typeof text === 'string' && plan.images.size ? text.replace(/note-image:([0-9a-f]{32}\.png)/g, (whole, name) => plan.images.has(name) ? 'note-image:' + plan.images.get(name) : whole) : text;
  // A memo key under the number its paper gets here (final: the paper merged into, for what is written outside library.json).
  const keyTo = (key, final = false) => { const m = /^(\d+)-([\s\S]*)$/.exec(String(key)); if (!m || !sentFrom.has(Number(m[1]))) return key; return `${final ? finalPaper(Number(m[1])) : plan.ids.papers.get(Number(m[1]))}-${m[2]}`; };
  const notebookTo = id => plan.ids.notebooks.get(id) ?? id;
  const notebooks = bundle.notebooks.filter(n => plan.ids.notebooks.has(n.id)).map(original => {
    const n = clone(original); n.id = notebookTo(n.id); n.paperId = notebookOwned(bundle, original) ? finalPaper(original.paperId) ?? null : null; n.title = picture(n.title);
    for (const page of n.pages || []) for (const item of page.items || []) {
      if (item.source) { if (sentFrom.has(item.source.paperId)) item.source.paperId = finalPaper(item.source.paperId); if (item.source.attachmentId) item.source.attachmentId = attachmentTo(item.source.attachmentId); }
      if (item.type === 'memo' && item.key) item.key = keyTo(item.key, true);
      if (Array.isArray(item.mentions)) for (const m of item.mentions) if (m?.key) m.key = keyTo(m.key, true);
      if (typeof item.text === 'string') item.text = picture(item.text);
    }
    return n;
  });
  let staged = 0; const moves = [];
  for (const f of plan.files) if (!f.reuse && f.entry.sha256) moves.push({ staged: String(++staged), to: f.to, internal: f.internal, replace: Boolean(f.replace), entry: f.entry });
  for (const n of notebooks) moves.push({ staged: String(++staged), to: `notebooks/${n.id}.json`, internal: true, replace: plan.notebookReplaced.has(n.id), notebook: n });
  const baseOf = move => move.internal ? vault : target.root, placeOf = move => path.join(baseOf(move), ...move.to.split('/'));
  for (const move of moves) if (!placeAllowed(move.to, move.internal)) throw refusedBundle(move.to);
  const newAttachments = sent.flatMap(r => bundle.papers.find(p => p.id === r.from).attachments.filter(a => !plan.reuse.has(a.id) && !plan.replacedAttachments.has(a.id)).map(a => attachmentTo(a.id)));
  const newAnnotations = bundle.annotations.filter(a => sentFrom.has(a.paperId)).map(a => plan.ids.annotations.get(a.id) ?? a.id).filter(id => !plan.replacedAnnotations.has(id));
  await target.backup(tr('다른 저장소에서 받기 전'));
  const journal = { version: 1, id, before: textHash(await fs.readFile(target.file, 'utf8').catch(() => '')), papers: sent.filter(r => r.action === 'new').map(r => r.to), attachments: newAttachments, annotations: newAnnotations, moves: moves.map(({ staged, to, internal, replace }) => ({ staged, to, internal, replace })), removals: plan.removals };
  const copied = new Map(), made = []; let saved = false, written = new Map();
  try {
    await fs.mkdir(stage, { recursive: true }); await atomicJson(journalFile, journal);
    let done = 0;
    for (const move of moves) {
      if (signal?.aborted) throw cancelled();
      const out = path.join(stage, move.staged);
      if (move.notebook) await fs.writeFile(out, JSON.stringify(move.notebook, null, 2), { flag: 'wx' });
      else {
        // The file as it was collected: one changed since stops the send here, before anything is changed.
        await reader.copy(move.entry, out); const hash = await hashFile(out);
        if (hash !== move.entry.sha256) throw Error(tr('보내는 동안 파일이 바뀌었습니다. 다시 보내세요: {name}', { name: move.entry.path }));
        copied.set((move.internal ? 'i:' : 'r:') + move.to, hash);
      }
      onProgress?.(++done, moves.length);
    }
    if (signal?.aborted) throw cancelled();
    // Every place can be had before anything is saved: its folders are made (none a link or a file), it is still free
    // (nothing else writes a locked vault) and its name can be made on this disk (length, characters).
    for (const move of moves) {
      made.push(...await placeFolders(baseOf(move), move.to.split('/').slice(0, -1)));
      if (move.replace) continue;
      if (await isFile(placeOf(move))) throw Error(tr('받는 저장소에 같은 이름의 파일이 생겼습니다. 다시 보내세요.'));
      try { await (await fs.open(placeOf(move), 'wx')).close(); await fs.rm(placeOf(move)); }
      catch (error) { throw Object.assign(Error(tr('받는 저장소에 이 이름의 파일을 만들 수 없습니다: {name}', { name: move.to })), { code: 'APP_TRANSFER_PLACE', cause: error }); }
    }
    await hooks.afterStage?.();
    // The records pass the checks the vault is opened with before they are saved.
    await target.transaction(() => { written = writeRecords(plan, bundle, target, { sent, attachmentTo, picture, keyTo, notebookTo }); target.validateData(clone(target.data)); });
    saved = true;
    // Marked at once, so a send stopped from here on is finished on the next open even when its records look as before
    // (a replace that changes only files).
    await atomicJson(journalFile, { ...journal, saved: true }).catch(() => {});
    await hooks.afterSave?.();
    await finishMoves(target.root, journal, discard);
  } catch (error) {
    if (!saved) { await fs.rm(stage, { recursive: true, force: true }); await fs.rm(journalFile, { force: true }); for (const folder of made.reverse()) await fs.rmdir(folder).catch(() => {}); }
    // The receiving vault's records changed while the files were copied: that vault is as it was (not the one open here).
    if (error?.code === 'APP_EXTERNAL_CHANGE') throw Object.assign(Error(tr('보내는 동안 받는 저장소의 기록이 다른 곳에서 바뀌었습니다. 받는 저장소는 그대로입니다. 다시 보내세요.')), { code: 'APP_TRANSFER_TARGET_CHANGED' });
    throw fileError(error);
  }
  await verifyTransfer(target, plan, bundle, copied, written);
  return {
    vaultId: target.data.id, name: path.basename(target.root), sent: sent.map(r => r.from),
    skipped: rows.filter(r => r.action === 'skip').map(r => ({ id: r.from, title: bundle.papers.find(p => p.id === r.from)?.title || '', reason: r.reason || 'exists' })),
    merged: sent.filter(r => r.action === 'merge').length, replaced: sent.filter(r => r.action === 'replace').length, renumbered: sent.filter(r => r.renumbered).length,
    notebooks: [...plan.ids.notebooks.keys()],
  };
}
// The receiving vault's records, changed in its data only (the caller's transaction saves them once).
function writeRecords(plan, bundle, target, { sent, attachmentTo, picture, keyTo, notebookTo }) {
  const data = target.data, sentFrom = new Set(sent.map(r => r.from)), written = new Map();
  const received = a => {
    const to = attachmentTo(a.id), placed = plan.files.find(f => (f.entry.kind === 'pdf' || f.entry.kind === 'translated-pdf') && f.entry.attachmentId === a.id && !f.reuse);
    const next = { ...a, id: to, ...(placed ? { path: placed.to } : {}) };
    // Its translation record is named by the owner and key planned for it, whatever number the paper ends with.
    if (plan.owners.has(to)) next.cacheOwnerId = plan.owners.get(to); if (plan.cacheKeys.has(to)) next.cacheKey = plan.cacheKeys.get(to);
    return next;
  };
  // A replaced paper becomes the sending side's: its fields, memos and annotations; its attachments the receiving copy has
  // keep their places and record names there; one only the receiving copy has stays with what belongs to it.
  for (const row of sent.filter(r => r.action === 'replace')) {
    const q = target.paper(row.into), p = clone(bundle.papers.find(x => x.id === row.from)), kept = new Set(['id', 'attachments', 'primaryAttachmentId', 'collectionIds']), keyThere = q.citekey;
    for (const key of Object.keys(q)) if (!kept.has(key) && !(key in p)) delete q[key];
    for (const [key, value] of Object.entries(p)) if (!kept.has(key)) q[key] = value;
    // A copy that was given its old default key when it was renumbered keeps it while the sending side has none of its own.
    if (!p.citekey && keyThere) q.citekey = keyThere;
    if (q.citekey && data.papers.some(x => x !== q && x.citekey === q.citekey)) q.citekey = citekeyAllocator(new Set(data.papers.filter(x => x !== q).map(x => x.citekey).filter(Boolean)))(q.citekey);
    const mine = new Set(q.attachments.map(b => b.id)), sentAs = a => attachmentTo(a.id);
    q.attachments = [...q.attachments.map(b => { const a = p.attachments.find(x => sentAs(x) === b.id && plan.replacedAttachments.has(x.id)); if (!a) return b; const next = { ...a, id: b.id, path: b.path }; for (const k of ['cacheOwnerId', 'cacheKey']) { if (b[k] === undefined) delete next[k]; else next[k] = b[k]; } return next; }), ...p.attachments.filter(a => !plan.replacedAttachments.has(a.id) || !mine.has(sentAs(a))).map(received)];
    const primary = attachmentTo(p.primaryAttachmentId), live = q.attachments.filter(a => !a.trashedAt);
    q.primaryAttachmentId = live.some(a => a.id === primary) ? primary : live.some(a => a.id === q.primaryAttachmentId) ? q.primaryAttachmentId : (live.find(a => a.role !== 'translated') || live[0] || q.attachments[0])?.id || null;
    q.collectionIds = (p.collectionIds || []).map(c => plan.ids.collections.get(c)).filter(Boolean);
    target.preparePaper(q); target.registerTags(q.tags || []);
    for (const key of Object.keys(data.notes)) if (key.startsWith(q.id + '-')) delete data.notes[key];
    data.annotations = data.annotations.filter(a => !plan.replacedAnnotations.has(a.id));
  }
  for (const row of sent.filter(r => r.action !== 'replace')) {
    const p = clone(bundle.papers.find(x => x.id === row.from)), paper = { ...p, id: row.to };
    if (row.citekey) paper.citekey = row.citekey;
    paper.attachments = p.attachments.filter(a => !plan.reuse.has(a.id)).map(received);
    const primary = attachmentTo(p.primaryAttachmentId);
    paper.primaryAttachmentId = paper.attachments.some(a => a.id === primary) ? primary : (paper.attachments.find(a => !a.trashedAt && a.role !== 'translated') || paper.attachments.find(a => !a.trashedAt) || paper.attachments[0])?.id || null;
    paper.collectionIds = (p.collectionIds || []).map(c => plan.ids.collections.get(c)).filter(Boolean);
    data.papers.push(target.preparePaper(paper));
    target.registerTags(paper.tags || []);
  }
  // Memos under the papers' numbers; the ids their values name (the memo order, a figure's attachment, a pin's attachment
  // or notebook) and the pictures they show follow.
  for (const [key, value] of Object.entries(bundle.notes)) {
    const m = /^(\d+)-/.exec(key); if (!m || !sentFrom.has(Number(m[1]))) continue;
    let next = picture(value); const row = sent.find(r => r.from === Number(m[1]));
    if (key.endsWith('#order')) { try { next = JSON.stringify(JSON.parse(value).map(k => keyTo(k))); } catch { next = value; } }
    else if (key.endsWith('#figure')) { try { const figure = JSON.parse(value); if (figure?.attachmentId) { figure.attachmentId = attachmentTo(figure.attachmentId); next = JSON.stringify(figure); } } catch { next = attachmentTo(value); } }
    else if (key.endsWith('#pin')) { try { const pin = JSON.parse(value); if (pin?.attachmentId) pin.attachmentId = attachmentTo(pin.attachmentId); if (pin?.notebookId) pin.notebookId = notebookTo(pin.notebookId); next = JSON.stringify(pin); } catch { next = value; } }
    data.notes[keyTo(key)] = next; if (row?.action !== 'merge') written.set(keyTo(key), next);
  }
  for (const a of bundle.annotations) if (sentFrom.has(a.paperId)) data.annotations.push({ ...clone(a), id: plan.ids.annotations.get(a.id) ?? a.id, paperId: plan.ids.papers.get(a.paperId), attachmentId: attachmentTo(a.attachmentId), ...(typeof a.body === 'string' ? { body: picture(a.body) } : {}) });
  data.collections.push(...clone(plan.newCollections));
  if (Object.keys(plan.tagColors).length) Object.assign(data.tagColors ||= {}, plan.tagColors);
  if (bundle.whole) {
    if (plan.newSearches.length) (data.savedSearches ||= []).push(...clone(plan.newSearches));
    const terms = new Set((data.glossary || []).map(g => String(g.term).trim().toLowerCase())), added = (bundle.glossary || []).filter(g => !terms.has(String(g.term).trim().toLowerCase()));
    if (added.length) data.glossary = [...(data.glossary || []), ...clone(added)];
    if (!data.translationRules && bundle.translationRules) data.translationRules = bundle.translationRules;
    if (!data.aiRules && typeof bundle.aiRules === 'string' && bundle.aiRules) data.aiRules = bundle.aiRules.slice(0, 2000);
  }
  // A paper found already there is merged into it by the merge rules (the received one was added first).
  // Its attachments are written down with it, so a later send knows the paper as one sent before even when its records
  // joined attachments already there.
  for (const row of sent) if (row.action === 'merge') {
    target.mergeRecords(row.into, row.to, {});
    const entry = (target.paper(row.into).mergedFrom || []).find(m => m && m.id === row.to && !m.attachments);
    if (entry) entry.attachments = bundle.papers.find(p => p.id === row.from).attachments.map(a => arrivingId(bundle, a.id)).filter(Boolean);
  }
  return written;
}

// After a send: the receiving vault's library.json as saved passes the checks a vault is opened with, every file put in
// place is the file that was sent (by the fingerprint read when it was copied), and every paper and annotation is there.
async function verifyTransfer(target, plan, bundle, copied, written = new Map()) {
  const data = await readJson(target.file, null); if (!data) throw Error(tr('받는 저장소를 다시 읽지 못했습니다.'));
  target.validateData(clone(data));
  const vault = path.join(target.root, VAULT_DIR);
  for (const [key, hash] of copied) {
    const internal = key.startsWith('i:'), to = key.slice(2), entry = plan.files.find(f => f.internal === internal && f.to === to)?.entry;
    const file = internal ? path.join(vault, ...to.split('/')) : path.join(target.root, ...to.split('/'));
    const actual = await hashFile(file).catch(() => null);
    if (actual !== hash || (entry && entry.sha256 !== hash)) throw Error(tr('받는 저장소에 놓은 파일을 확인하지 못했습니다: {name}', { name: to }));
  }
  // A file used again from the receiving side is the file that was sent too.
  for (const f of plan.files) if (f.reuse && f.entry.sha256) {
    const file = f.internal ? path.join(vault, ...f.to.split('/')) : path.join(target.root, ...f.to.split('/'));
    if (await hashFile(file).catch(() => null) !== f.entry.sha256) throw Error(tr('받는 저장소에 놓은 파일을 확인하지 못했습니다: {name}', { name: f.to }));
  }
  const ids = new Set(data.papers.map(p => p.id)), annotations = new Set(data.annotations.map(a => a.id));
  for (const row of plan.papers) if ((row.action === 'new' && !ids.has(row.to)) || (row.action === 'merge' && (!ids.has(row.into) || ids.has(row.to))) || (row.action === 'replace' && !ids.has(row.into))) throw Error(tr('받는 저장소에 자료가 모두 들어가지 않았습니다.'));
  for (const a of bundle.annotations) if (plan.ids.annotations.has(a.id) && !annotations.has(plan.ids.annotations.get(a.id))) throw Error(tr('받는 저장소에 자료가 모두 들어가지 않았습니다.'));
  // Every memo written is there as written (a merge joins memos by its own rules and is checked by its papers).
  for (const [key, value] of written) if (data.notes[key] !== value) throw Error(tr('받는 저장소에 자료가 모두 들어가지 않았습니다.'));
}

// A send the app stopped in, found when the receiving vault is opened (Library.open, before its scan): finished when its
// library.json was saved (the papers, attachments or annotations it added are there, or it changed since), undone
// otherwise; the staging folder and the journal go either way.
async function recoverTransfers(library) {
  const vault = path.join(library.root, VAULT_DIR), result = { finished: 0, rolledBack: 0, left: 0 };
  const names = await fs.readdir(vault).catch(() => []);
  for (const name of names) {
    const m = /^transfer-([-a-f0-9]{36})\.json$/.exec(name); if (!m) continue;
    const journal = await readJson(path.join(vault, name), null).catch(() => null), stage = path.join(vault, `transfer-${m[1]}`);
    // A journal of a later app's send is left for that app.
    if (journal && typeof journal === 'object' && journal.version !== 1) { result.left++; continue; }
    // Finishing is tried again on every open until it works; the vault opens either way (its records are already whole).
    try {
      const list = key => Array.isArray(journal?.[key]) ? journal[key] : [];
      if (!journal || typeof journal !== 'object' || !journalFits(journal)) throw Object.assign(Error('journal'), { undo: true });
      const papers = new Set(library.data.papers.map(p => p.id)), attachments = new Set(library.data.papers.flatMap(p => p.attachments.map(a => a.id))), annotations = new Set(library.data.annotations.map(a => a.id));
      const named = [...list('papers'), ...list('attachments'), ...list('annotations')].length;
      const saved = journal.saved === true || (named
        ? list('papers').some(id => papers.has(id)) || list('attachments').some(id => attachments.has(id)) || list('annotations').some(id => annotations.has(id))
        : textHash(await fs.readFile(library.file, 'utf8').catch(() => '')) !== journal.before);
      if (!saved) throw Object.assign(Error('not saved'), { undo: true });
      await finishMoves(library.root, { ...journal, id: m[1] }); result.finished++;
    } catch (error) {
      if (!error?.undo) { result.left++; continue; }
      await fs.rm(stage, { recursive: true, force: true }); await fs.rm(path.join(vault, name), { force: true }); result.rolledBack++;
    }
  }
  // A staging folder without its journal is what a removed journal left: nothing points to it.
  for (const name of names) if (/^transfer-[-a-f0-9]{36}$/.test(name) && !names.includes(name + '.json')) await fs.rm(path.join(vault, name), { recursive: true, force: true });
  return result;
}

// A move, once the receiving vault is checked: what arrived is removed from the sending vault as deleting a paper with
// its files does (PDFs to the computer's trash through discard, its translation records, ink, AI results, corrections,
// memos and annotations), with its notebooks and the pictures nothing left there shows. A paper skipped stays. The
// vault folder, its backups, its comparisons and files that are not PDFs stay. What could not be removed is told.
async function removeSent(source, report, bundle, { discard, notebooks }) {
  const failed = []; let removed = 0;
  // Every removal is its own: one that fails is told by name and the rest go on (the receiving vault is already whole).
  const removeFile = async (file, name) => { try { await fs.rm(file, { force: true }); } catch { failed.push(name); } };
  await source.backup(tr('다른 저장소로 옮기기 전'));
  const sent = new Set(report.sent), vault = path.join(source.root, VAULT_DIR);
  for (const id of report.sent) {
    if (!source.data.papers.some(p => p.id === id)) continue;
    try { const result = await source.deleteAttachments(id, null, discard, { backup: false }); failed.push(...result.failed); removed++; }
    catch (error) { failed.push(bundle.papers.find(p => p.id === id)?.title || String(id)); }
  }
  // Translation records in other languages (deleting a paper leaves them).
  for (const entry of bundle.files) if ((entry.kind === 'translation' || entry.kind === 'chunks') && sent.has(entry.paperId) && placeAllowed(entry.path, true)) await removeFile(path.join(vault, entry.path), entry.path);
  // The notebooks that went (a notebook found there from an earlier send was not sent, and stays).
  const folder = await notebooks.dir().catch(() => null), went = new Set(report.notebooks || []);
  if (!folder) { if (went.size) failed.push(tr('노트북')); return { removed, failed }; }
  for (const n of bundle.notebooks) if (went.has(n.id) && NOTEBOOK_ID.test(n.id)) await removeFile(path.join(folder, n.id + '.json'), n.title || n.id);
  // Pictures that went and that nothing left shows any more (memos, annotations, the notebooks still there).
  const left = []; for (const name of await fs.readdir(folder).catch(() => [])) if (/^[-a-f0-9]{36}\.json$/.test(name)) left.push(await fs.readFile(path.join(folder, name), 'utf8').catch(() => ''));
  const shown = new Set(noteImageNames(JSON.stringify([source.data.notes, source.data.annotations]) + left.join('\n'))), assets = new Set(left.join('\n').match(/[a-f0-9]{64}/g) || []);
  for (const entry of bundle.files) {
    const name = entry.path.split('/').pop();
    if (entry.kind === 'note-image' && !shown.has(name)) await removeFile(path.join(vault, ...entry.path.split('/')), name);
    if (entry.kind === 'notebook-asset' && !assets.has(name.slice(0, 64))) await removeFile(path.join(vault, ...entry.path.split('/')), name);
  }
  return { removed, failed };
}

// A send from start to end: written and checked in the receiving vault; for a move, then removed from the sending one.
// Nothing is removed when anything before failed.
async function runTransfer({ bundle, source, target, reader, plan, mode, discard, notebooks, onProgress, signal, hooks }) {
  const report = await applyTransfer(plan, bundle, target, reader, { onProgress, signal, hooks, discard });
  if (mode !== 'move') return { report };
  // The receiving vault is whole by now: what could not be removed here is told, the send stands.
  try { return { report, removed: await removeSent(source, report, bundle, { discard: discard || (file => fs.rm(file, { force: true })), notebooks }) }; }
  catch (error) { return { report, removed: { removed: 0, failed: [fileError(error).message] } }; }
}

module.exports = { BUNDLE_VERSION, cancelled, fileError, vaultPlace, receivingFolder, receivingFolders, placeAllowed, collectBundle, sourceReader, noteImageNames, hashFile, planTransfer, sameOrNested, freeName, applyTransfer, verifyTransfer, recoverTransfers, removeSent, runTransfer };
