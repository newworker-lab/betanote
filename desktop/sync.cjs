// Personal multi-device exchange through a shared folder (Dropbox, Drive for
// desktop, a USB drive…). Each device writes only its own state file; records
// carry a revision and its ancestry, never a wall-clock order. A record
// changed on one side fast-forwards the other; changed on both sides, it
// merges where that is safe (ink strokes, paper fields, tags) and otherwise
// keeps both versions as a conflict copy that syncs to every device.
const fs = require('node:fs/promises');
const path = require('node:path');
const {tr}=require('../core/i18n.js');
const crypto = require('node:crypto');
const { constants } = require('node:fs');
const { atomicJson, readJson, readAiRecords, keepConflictCopy, unreadableFile } = require('./storage.cjs');
const { VAULT_DIR, SYNC_DIR, adoptSyncFolder, syncDirIn, isSyncDirName, isVaultFolder } = require('./legacy.cjs');

const VERSION = 1, HISTORY = 200;
// The record kinds this app knows, named in its device file. A kind added later than the sync format (LATER_KINDS) is
// unknown to an older app, which drops it from its own records and so publishes it as deleted; such a removal from a
// device that does not name the kind is not taken.
const KINDS = ['paper', 'note', 'annotation', 'collection', 'search', 'conflict', 'glossary', 'rules', 'airules', 'tagcolor', 'ink', 'inkbase', 'translation', 'corrections', 'ai', 'notebook'], LATER_KINDS = ['airules'];
const sha = value => crypto.createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex');
const plainPaper = paper => JSON.parse(JSON.stringify(paper));

// The vault's records as one flat map. Device-local data (search index,
// window state, sign-in) is never part of it.
async function collect(library, stores) {
  const records = {}, data = library.data;
  for (const paper of data.papers) records['paper:' + paper.id] = plainPaper(paper);
  for (const [key, text] of Object.entries(data.notes)) records['note:' + key] = text;
  for (const a of data.annotations) records['annotation:' + a.id] = a;
  for (const c of data.collections) records['collection:' + c.id] = c;
  for (const s of data.savedSearches || []) records['search:' + s.id] = s;
  for (const c of data.syncConflicts || []) records['conflict:' + c.id] = c;
  if (data.glossary?.length) records['glossary:vault'] = data.glossary;
  if (data.translationRules) records['rules:vault'] = data.translationRules;
  if (data.aiRules) records['airules:vault'] = data.aiRules;
  for (const [tag, color] of Object.entries(data.tagColors || {})) records['tagcolor:' + tag] = color;
  const vault = path.join(library.root, VAULT_DIR);
  for (const attachment of await fs.readdir(path.join(vault, 'ink')).catch(() => [])) {
    for (const name of await fs.readdir(path.join(vault, 'ink', attachment)).catch(() => [])) {
      const surface = /^(original|t-[a-f0-9]{24})\.(json|log)$/.exec(name)?.[1], base = /^base-([a-f0-9]{24})\.json$/.exec(name)?.[1];
      if (surface && !records[`ink:${attachment}/${surface}`]) { const state = await stores.ink.serial(attachment + '/' + surface, () => stores.ink.state(attachment, surface)); records[`ink:${attachment}/${surface}`] = { sourceHash: state.sourceHash, pages: state.pages, strokes: state.strokes }; }
      if (base) records[`inkbase:${attachment}/${base}`] = await readJson(path.join(vault, 'ink', attachment, name), null);
    }
  }
  for (const name of await fs.readdir(vault).catch(() => [])) if (/^translation-[-a-zA-Z0-9]+\.json$/.test(name) && !name.endsWith('.chunks.json')) records['translation:' + name] = await readJson(path.join(vault, name), null);
  // An AI records file git left conflict marks in goes as both its sides joined (storage.cjs readAiRecords); one that
  // cannot be read stops the sync, named by its path (skipping it would spread as a deletion).
  for (const dir of ['corrections', 'ai']) for (const name of await fs.readdir(path.join(vault, dir)).catch(() => [])) if (/^[-a-zA-Z0-9]+\.json$/.test(name)) records[`${dir}:${name.slice(0, -5)}`] = dir === 'ai' ? (await readAiRecords(path.join(vault, dir, name), null).catch(error => { throw error.code === 'APP_AI_RECORDS_UNREADABLE' ? unreadableFile(error.file, error.conflict) : error; })).data : await readJson(path.join(vault, dir, name), null);
  for (const name of await fs.readdir(path.join(vault, 'notebooks')).catch(() => [])) if (/^[-a-f0-9]{36}\.json$/.test(name)) records['notebook:' + name.slice(0, -5)] = await readJson(path.join(vault, 'notebooks', name), null);
  return records;
}
// Three cases per record, decided by ancestry: same, one side ahead, or both changed.
function relation(local, remote) {
  if (!local) return 'remote';
  if (local.rev === remote.rev) return 'same';
  if (remote.history.includes(local.rev)) return 'remote';
  if (local.history.includes(remote.rev)) return 'local';
  return 'conflict';
}
function mergeInk(a, b) {
  const byId = new Map(), conflicts = [];
  for (const s of a.strokes) byId.set(s.id, { ...s });
  for (const s of b.strokes) {
    const mine = byId.get(s.id);
    if (!mine) { byId.set(s.id, { ...s }); continue; }
    // One side erased what the other kept or restored: keep it visible. A
    // deletion is only a mark, so nothing is lost either way.
    if (Boolean(mine.deletedAt) !== Boolean(s.deletedAt)) { delete mine.deletedAt; conflicts.push(s.id); }
  }
  return { value: { sourceHash: a.sourceHash || b.sourceHash, pages: { ...b.pages, ...a.pages }, strokes: [...byId.values()] }, conflicts };
}
function mergePaper(a, b) {
  const out = { ...a }, fields = [];
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (JSON.stringify(a[key]) === JSON.stringify(b[key])) continue;
    if (['tags', 'collectionIds'].includes(key)) { out[key] = [...new Set([...(a[key] || []), ...(b[key] || [])])]; continue; }
    if (key === 'attachments') { const ids = new Set((a.attachments || []).map(x => x.id)); out.attachments = [...(a.attachments || []), ...(b.attachments || []).filter(x => !ids.has(x.id))]; continue; }
    if (a[key] === undefined) { out[key] = b[key]; continue; }
    if (b[key] === undefined) continue;
    fields.push({ field: key, local: a[key], remote: b[key] });
  }
  return { value: out, fields };
}

// Writes one synced record that is kept in its own file under .<id> (ink,
// translation bases and caches, corrections, AI results, notebooks).
async function writeFileRecord(vault, ink, type, id, value) {
  if (type === 'ink') { const [attachment, surface] = id.split('/'); if (!/^[-a-zA-Z0-9]+$/.test(attachment) || !/^(original|t-[a-f0-9]{24})$/.test(surface)) return; if (value) await ink.replaceState(attachment, surface, value); else await ink.removeState(attachment, surface); }
  else if (type === 'inkbase') { const [attachment, revision] = id.split('/'); if (/^[-a-zA-Z0-9]+$/.test(attachment) && /^[a-f0-9]{24}$/.test(revision) && value) { await fs.mkdir(path.join(vault, 'ink', attachment), { recursive: true }); await atomicJson(path.join(vault, 'ink', attachment, `base-${revision}.json`), value); } }
  else if (type === 'translation' && /^translation-[-a-zA-Z0-9]+\.json$/.test(id)) { if (value) await atomicJson(path.join(vault, id), value); else await fs.rm(path.join(vault, id), { force: true }); }
  else if (['corrections', 'ai'].includes(type) && /^[-a-zA-Z0-9]+$/.test(id)) { await fs.mkdir(path.join(vault, type), { recursive: true }); if (type === 'ai') await keepConflictCopy(path.dirname(vault), path.join(vault, type, id + '.json')); if (value) await atomicJson(path.join(vault, type, id + '.json'), value); else await fs.rm(path.join(vault, type, id + '.json'), { force: true }); }
  else if (type === 'notebook' && /^[-a-f0-9]{36}$/.test(id)) { await fs.mkdir(path.join(vault, 'notebooks'), { recursive: true }); if (value) await atomicJson(path.join(vault, 'notebooks', id + '.json'), value); else await fs.rm(path.join(vault, 'notebooks', id + '.json'), { force: true }); }
}
class SyncEngine {
  constructor({ library, ink, notebooks, folder, deviceId, deviceName, onProblem }) {
    this.onProblem = onProblem; // (kind, error): a failure the sync goes on past, for the diagnostic record
    if (!/^[-a-f0-9]{36}$/.test(deviceId)) throw Error(tr('기기 식별자를 확인하세요.'));
    Object.assign(this, { library, ink, notebooks, deviceId, deviceName: String(deviceName || '').slice(0, 100) });
    this.shared = path.join(folder, SYNC_DIR, library.data.id);
    this.stateFile = path.join(library.root, VAULT_DIR, 'sync', `state-${deviceId}.json`);
  }
  // Every device's published file except this one; damaged files are skipped and reported.
  async peers() {
    const out = [], skipped = [];
    for (const name of await fs.readdir(path.join(this.shared, 'devices')).catch(() => [])) {
      if (!/^[-a-f0-9]{36}\.json$/.test(name) || name === this.deviceId + '.json') continue;
      const file = await readJson(path.join(this.shared, 'devices', name), null).catch(() => null);
      if (file?.version === VERSION && file.vaultId === this.library.data.id && file.records && typeof file.records === 'object') out.push(file); else skipped.push(name);
    }
    return { peers: out, skipped };
  }
  async run() {
    await this.ink.idle(); await this.notebooks.idle(); await this.library.assertUnchanged();
    const state = await readJson(this.stateFile, { version: VERSION, records: {} });
    const local = await collect(this.library, this), stamp = () => crypto.randomUUID();
    // 1. Local changes since the last run become new revisions.
    for (const [key, value] of Object.entries(local)) {
      const entry = state.records[key], hash = sha(value);
      if (!entry) state.records[key] = { rev: stamp(), history: [], hash, device: this.deviceId };
      else if (entry.hash !== hash) state.records[key] = { rev: stamp(), history: [entry.rev, ...entry.history].slice(0, HISTORY), hash, device: this.deviceId };
    }
    for (const [key, entry] of Object.entries(state.records)) if (!(key in local) && !entry.deleted) state.records[key] = { rev: stamp(), history: [entry.rev, ...entry.history].slice(0, HISTORY), hash: null, deleted: true, device: this.deviceId };
    // 2. Merge every peer's published records.
    const { peers, skipped } = await this.peers(), changes = new Map(), report = { applied: 0, merged: 0, conflicts: 0, keptPapers: 0, restoredAttachments: 0, liftedCollections: 0, peers: peers.map(p => p.deviceName || p.deviceId), skipped, missingFiles: [] };
    const values = { ...local }, before = { ...local }, conflicts = [];
    for (const peer of peers) for (const [key, remote] of Object.entries(peer.records)) {
      if (!remote || typeof remote.rev !== 'string' || !Array.isArray(remote.history)) continue;
      // A device on an app from before a kind (its file names no such kind) drops that kind's records as deleted: not taken.
      const recordKind = key.slice(0, key.indexOf(':'));
      if (remote.deleted && LATER_KINDS.includes(recordKind) && !(Array.isArray(peer.kinds) && peer.kinds.includes(recordKind))) continue;
      const mine = state.records[key], kind = relation(mine, remote);
      if (kind === 'same' || kind === 'local') continue;
      if (kind === 'remote') {
        if (!mine && remote.deleted) { state.records[key] = { rev: remote.rev, history: remote.history, hash: null, deleted: true, device: remote.device }; continue; }
        state.records[key] = { rev: remote.rev, history: remote.history, hash: remote.hash, deleted: remote.deleted || undefined, device: remote.device };
        if (remote.deleted) { delete values[key]; changes.set(key, null); } else { values[key] = remote.value; changes.set(key, remote.value); }
        report.applied++; continue;
      }
      // Both changed: merge or keep both, and record a revision that descends from both.
      const ours = values[key], theirs = remote.deleted ? undefined : remote.value, type = key.split(':')[0];
      let merged = ours;
      if (ours === undefined && theirs !== undefined) merged = theirs; // deleted here, edited there: keep the edit
      else if (ours !== undefined && theirs !== undefined && sha(ours) !== sha(theirs)) {
        if (type === 'ink') { const m = mergeInk(ours, theirs); merged = m.value; if (m.conflicts.length) report.conflicts++; }
        else if (type === 'paper') { const m = mergePaper(ours, theirs); merged = m.value; for (const f of m.fields) conflicts.push({ key, field: f.field, local: f.local, remote: f.remote, device: peer.deviceName || peer.deviceId }); }
        else if (!['translation', 'inkbase', 'conflict', 'tagcolor'].includes(type)) conflicts.push({ key, local: ours, remote: theirs, device: peer.deviceName || peer.deviceId });
      }
      if (merged !== ours) { values[key] = merged; changes.set(key, merged); }
      state.records[key] = { rev: stamp(), history: [...new Set([...(mine ? [mine.rev, ...mine.history] : []), remote.rev, ...remote.history])].slice(0, HISTORY), hash: merged === undefined ? null : sha(merged), deleted: merged === undefined || undefined, device: this.deviceId };
      report.merged++;
    }
    // Conflict copies are records too, so every device keeps both versions.
    for (const c of conflicts) {
      const record = { id: crypto.randomUUID(), at: new Date().toISOString(), ...c };
      values['conflict:' + record.id] = record; changes.set('conflict:' + record.id, record);
      state.records['conflict:' + record.id] = { rev: stamp(), history: [], hash: sha(record), device: this.deviceId };
      report.conflicts++;
    }
    // A paper (or attachment) removed on another device while this one annotated it, or a collection removed there that
    // this one put a collection under: the annotations and the collection are kept, so the removal is not taken (the
    // paper and its annotated attachments stay, as a new revision the other devices take back) and the orphaned
    // collection moves to the top. Nothing is lost and the sync goes on.
    this.keepWhatIsAnnotated(changes, values, before, state, stamp, report);
    await this.apply(changes, values, report);
    await this.fetchMissingPdfs(changes, report);
    // 3. Publish this device's state and the PDFs it has.
    await this.publishFiles();
    for (const [key, entry] of Object.entries(state.records)) if (!entry.deleted && key in values) entry.hash = sha(values[key]);
    const records = {};
    for (const [key, entry] of Object.entries(state.records)) records[key] = { rev: entry.rev, history: entry.history, hash: entry.hash, device: entry.device, ...(entry.deleted ? { deleted: true } : { value: values[key] }) };
    await fs.mkdir(path.join(this.shared, 'devices'), { recursive: true });
    await atomicJson(path.join(this.shared, 'devices', this.deviceId + '.json'), { version: VERSION, kinds: KINDS, vaultId: this.library.data.id, vaultName: path.basename(this.library.root), deviceId: this.deviceId, deviceName: this.deviceName, publishedAt: new Date().toISOString(), records });
    await atomicJson(this.stateFile, state);
    return report;
  }
  keepWhatIsAnnotated(changes, values, before, state, stamp, report) {
    const renew = (key, value) => { const entry = state.records[key]; values[key] = value; changes.set(key, value); state.records[key] = { rev: stamp(), history: entry ? [entry.rev, ...entry.history].slice(0, HISTORY) : [], hash: sha(value), device: this.deviceId }; };
    const annotated = new Map();
    for (const [key, value] of Object.entries(values)) if (key.startsWith('annotation:') && value && value.paperId !== undefined) { const id = String(value.paperId); if (!annotated.has(id)) annotated.set(id, new Set()); annotated.get(id).add(value.attachmentId); }
    for (const [key, value] of [...changes]) {
      if (!key.startsWith('paper:')) continue;
      const old = before[key], need = annotated.get(key.slice(6)); if (!old || !need) continue;
      if (value === null) {
        // Kept whole: with its memos, ink, AI results, corrections, translation records and notebooks.
        renew(key, old); report.keptPapers++;
        const pid = key.slice(6), atts = new Set((old.attachments || []).map(a => a.id)), owners = new Set((old.attachments || []).map(a => String(a.cacheOwnerId || pid)));
        for (const [k, v] of [...changes]) {
          if (v !== null || before[k] === undefined) continue;
          const [type, id] = [k.slice(0, k.indexOf(':')), k.slice(k.indexOf(':') + 1)];
          const own = (type === 'note' && id.startsWith(pid + '-')) || (['ink', 'inkbase'].includes(type) && atts.has(id.split('/')[0])) || (['corrections', 'ai'].includes(type) && atts.has(id))
            || (type === 'translation' && [...owners].some(o => id.startsWith(`translation-${o}-`) || id === `translation-${o}.json`)) || (type === 'notebook' && String(before[k]?.paperId) === pid);
          if (own) renew(k, before[k]);
        }
        continue;
      }
      const missing = (old.attachments || []).filter(a => need.has(a.id) && !(value.attachments || []).some(b => b.id === a.id));
      if (missing.length) { renew(key, { ...value, attachments: [...(value.attachments || []), ...missing] }); report.restoredAttachments += missing.length; }
    }
    const collections = new Set(Object.entries(values).filter(([key, value]) => key.startsWith('collection:') && value).map(([key]) => key.slice(11)));
    for (const [key, value] of Object.entries(values)) if (key.startsWith('collection:') && value?.parentId && !collections.has(String(value.parentId))) { const { parentId, ...top } = value; renew(key, top); report.liftedCollections++; }
  }
  async apply(changes, values, report) {
    if (!changes.size) return;
    const vault = path.join(this.library.root, VAULT_DIR), lib = this.library;
    // Library records in one transaction.
    const libraryKeys = [...changes.keys()].filter(k => /^(paper|note|annotation|collection|search|conflict|glossary|rules|airules|tagcolor):/.test(k));
    if (libraryKeys.length) await lib.transaction(async () => {
      const data = lib.data;
      for (const key of libraryKeys) {
        const [type, id] = [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)], value = changes.get(key);
        if (type === 'note') { if (value === null) delete data.notes[id]; else data.notes[id] = value; continue; }
        if (type === 'glossary') { data.glossary = value || []; continue; }
        if (type === 'rules') { if (typeof value === 'string' && value) data.translationRules = value.slice(0, 2000); else delete data.translationRules; continue; }
        if (type === 'airules') { if (typeof value === 'string' && value) data.aiRules = value.slice(0, 2000); else delete data.aiRules; continue; }
        if (type === 'tagcolor') { if (value === null) { if (data.tagColors) delete data.tagColors[id]; } else if (id !== '__proto__') (data.tagColors ||= {})[id] = value; continue; }
        const list = { paper: data.papers, annotation: data.annotations, collection: data.collections, search: data.savedSearches ||= [], conflict: data.syncConflicts ||= [] }[type];
        const at = list.findIndex(x => String(x.id) === id);
        if (value === null) { if (at >= 0) list.splice(at, 1); continue; }
        const item = type === 'paper' ? lib.preparePaper(JSON.parse(JSON.stringify(value))) : value;
        if (at >= 0) list[at] = item; else list.push(item);
      }
      lib.validateData(data);
    });
    for (const [key, value] of changes) {
      const type = key.slice(0, key.indexOf(':')), id = key.slice(key.indexOf(':') + 1);
      await writeFileRecord(vault, this.ink, type, id, value);
    }
    await this.copyAssets();
  }
  // PDFs this device's records name but it does not have: fetched from the sync folder by their fingerprint, on every
  // sync (a cloud drive can bring a PDF later than the record that names it). One still not there is told when the
  // record came in this sync.
  async fetchMissingPdfs(changes, report) {
    const lib = this.library, arrived = new Set([...changes].filter(([key, value]) => key.startsWith('paper:') && value).map(([key]) => key.slice(6)));
    for (const paper of lib.data.papers) for (const attachment of paper.attachments || []) {
      try { await lib.resolvePath(attachment.path, attachment.role === 'translated'); continue; } catch { /* missing here: fetched below */ }
      if (!attachment.sourceHash) continue;
      const source = path.join(this.shared, 'files', attachment.sourceHash + '.pdf'), target = path.join(lib.root, ...attachment.path.split('/'));
      try { await fs.access(source); } catch { if (arrived.has(String(paper.id))) report.missingFiles.push(attachment.name); continue; }
      try { await fs.mkdir(path.dirname(target), { recursive: true }); await fs.copyFile(source, target, constants.COPYFILE_EXCL); if (sha(await fs.readFile(target)) !== attachment.sourceHash) { await fs.rm(target); throw Error('hash'); } }
      catch { report.missingFiles.push(attachment.name); }
    }
  }
  // PDFs and notebook images are shared once by content hash.
  async publishFiles() {
    const files = path.join(this.shared, 'files'); await fs.mkdir(files, { recursive: true });
    for (const paper of this.library.data.papers) for (const attachment of paper.attachments) {
      if (!attachment.sourceHash) continue;
      const target = path.join(files, attachment.sourceHash + '.pdf');
      try { await fs.access(target); continue; } catch { /* not shared yet: copied below */ }
      let source; try { source = await this.library.resolvePath(attachment.path, attachment.role === 'translated'); } catch { continue; } // missing on this device too: nothing to share
      // A PDF that could not be shared is tried again at the next sync; why it failed goes to the diagnostic record.
      const temp = target + '.' + crypto.randomUUID() + '.tmp';
      try { await fs.copyFile(source, temp); await fs.rename(temp, target); } catch (error) { await fs.rm(temp, { force: true }).catch(() => {}); this.onProblem?.('sync-publish', error); }
    }
    const assets = path.join(this.library.root, VAULT_DIR, 'notebooks', 'assets'), shared = path.join(this.shared, 'assets'); await fs.mkdir(shared, { recursive: true });
    for (const name of await fs.readdir(assets).catch(() => [])) if (/^[a-f0-9]{64}\.png$/.test(name)) await fs.copyFile(path.join(assets, name), path.join(shared, name), constants.COPYFILE_EXCL).catch(() => {});
  }
  async copyAssets() {
    const assets = path.join(this.library.root, VAULT_DIR, 'notebooks', 'assets'), shared = path.join(this.shared, 'assets'); await fs.mkdir(assets, { recursive: true });
    for (const name of await fs.readdir(shared).catch(() => [])) if (/^[a-f0-9]{64}\.png$/.test(name)) await fs.copyFile(path.join(shared, name), path.join(assets, name), constants.COPYFILE_EXCL).catch(() => {});
  }
}
// A sync conflict resolved (sync-resolve): local, remote or keep (both stay, the conflict goes). The records the library
// holds take the chosen value here; records kept in their own files are written by the caller. A kind this version does
// not know keeps the conflict and throws, rather than dropping it with nothing written.
const FILE_KINDS = ['notebook', 'corrections', 'ai', 'translation', 'inkbase'];
function resolveConflict(library, conflict, choice) {
  const data = library.data, colon = conflict.key.indexOf(':'), type = conflict.key.slice(0, colon), key = conflict.key.slice(colon + 1);
  const value = choice === 'remote' ? conflict.remote : conflict.local;
  if (choice !== 'keep') {
    if (type === 'note') data.notes[key] = value;
    else if (type === 'paper' && conflict.field) { const paper = library.paper(key); paper[conflict.field] = value; library.preparePaper(paper); }
    else if (type === 'annotation') { const at = data.annotations.findIndex(a => a.id === key); if (at >= 0) data.annotations[at] = value; else data.annotations.push(value); }
    else if (type === 'collection') { const at = data.collections.findIndex(c => c.id === key); if (at >= 0) data.collections[at] = value; }
    else if (type === 'search') { const list = data.savedSearches ||= [], at = list.findIndex(x => x.id === key); if (value === null) { if (at >= 0) list.splice(at, 1); } else if (at >= 0) list[at] = value; else list.push(value); }
    else if (type === 'glossary') data.glossary = value;
    else if (type === 'rules') { if (typeof value === 'string' && value) data.translationRules = value.slice(0, 2000); else delete data.translationRules; }
    else if (type === 'airules') { if (typeof value === 'string' && value) data.aiRules = value.slice(0, 2000); else delete data.aiRules; }
    else if (!FILE_KINDS.includes(type)) throw Object.assign(Error(tr('이 앱이 모르는 종류의 충돌이라 고를 수 없습니다: {kind}', { kind: type })), { code: 'APP_SYNC_UNKNOWN_CONFLICT' });
  }
  data.syncConflicts = (data.syncConflicts || []).filter(c => c.id !== conflict.id);
}
// The folder that holds <id>-sync, from whichever folder was picked: that folder, <id>-sync
// itself, a vault folder inside it, or a parent one level up (e.g. "My Drive" holding the folder).
async function syncBase(folder) {
  const isDir = async dir => (await fs.stat(dir).catch(() => null))?.isDirectory() === true;
  if (isSyncDirName(path.basename(folder))) return path.dirname(folder);
  if (isSyncDirName(path.basename(path.dirname(folder))) && /^[-a-f0-9]{36}$/.test(path.basename(folder))) return path.dirname(path.dirname(folder));
  if (await syncDirIn(folder)) return folder;
  // Up to three folders down (e.g. 내 드라이브/연구/<name>/<id>-sync), skipping vault folders and hidden ones.
  let level = [folder];
  for (let depth = 0; depth < 3 && level.length; depth++) {
    const next = [];
    for (const dir of level) for (const entry of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      const child = path.join(dir, entry.name);
      if (await syncDirIn(child)) return child;
      if (next.length < 400) next.push(child);
    }
    level = next;
  }
  return folder;
}
// Vaults (folders with .<id>/library.json) in the picked folder or up to two folders down:
// a vault kept in Google Drive or Dropbox itself, opened directly instead of through a sync folder.
async function vaultFolders(folder) {
  const out = [], isVault = isVaultFolder;
  let level = [folder];
  for (let depth = 0; depth < 3 && level.length && out.length < 20; depth++) {
    const next = [];
    for (const dir of level) {
      if (await isVault(dir)) { out.push(dir); continue; }
      if (depth < 2) for (const entry of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) if (entry.isDirectory() && !entry.name.startsWith('.') && !isSyncDirName(entry.name) && next.length < 400) next.push(path.join(dir, entry.name));
    }
    level = next;
  }
  return out;
}
// Vaults published in a sync folder, for joining from another device.
async function sharedVaults(folder) {
  // A sync folder still under an earlier name of the app is taken over when it is looked into; one whose
  // rename is refused is read under its old name, so its vaults are still shown.
  await adoptSyncFolder(folder).catch(() => {});
  const out = [], dir = await syncDirIn(folder) || SYNC_DIR;
  for (const id of await fs.readdir(path.join(folder, dir)).catch(() => [])) {
    if (!/^[-a-f0-9]{36}$/.test(id)) continue;
    const devices = [];
    for (const name of await fs.readdir(path.join(folder, dir, id, 'devices')).catch(() => [])) { const file = await readJson(path.join(folder, dir, id, 'devices', name), null).catch(() => null); if (file?.vaultId === id) devices.push({ name: file.deviceName, at: file.publishedAt, vaultName: file.vaultName }); }
    // A device file not downloaded yet (an online-only cloud file) still shows the vault.
    if (!devices.length && (await fs.readdir(path.join(folder, dir, id, 'devices')).catch(() => [])).some(name => /^[-a-f0-9]{36}\.json$/.test(name))) devices.push({ name: tr('알 수 없는 기기'), at: null, vaultName: tr('{app} 저장소') });
    if (devices.length) out.push({ id, name: devices[0].vaultName || tr('{app} 저장소'), devices });
  }
  return out;
}
module.exports = { SyncEngine, resolveConflict, sharedVaults, syncBase, vaultFolders, relation, mergeInk, mergePaper, writeFileRecord };
