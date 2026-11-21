const fs = require('node:fs/promises');
const path = require('node:path');
const {tr}=require('../core/i18n.js');
const { memoLabel, readFigureMemoHead, isAutoTitle } = require('../core/memo-labels.cjs');
const crypto = require('node:crypto');
const { adoptVaultFolder, isVaultDirName, VAULT_DIR, OLD_VAULT_DIRS } = require('./legacy.cjs');
const { constants } = require('node:fs');
const appName = require('../core/app-name.cjs');
const { vaultDirectory } = require('./vault-folder.cjs');
const MAX_BYTES = 100 * 1024 * 1024;
const validTag = tag => typeof tag === 'string' && Boolean(tag.trim()) && tag.length <= 60 && tag !== '__proto__';
function cleanTag(name) { const tag = typeof name === 'string' ? name.trim().normalize('NFC') : ''; if (!validTag(tag)) throw Error(tr('태그 이름은 1–60자로 입력하세요.')); return tag; }
function tagColor(color) { const value = color == null ? '' : String(color).toLowerCase(); if (value && !/^#[0-9a-f]{6}$/.test(value)) throw Error(tr('태그 색을 확인하세요.')); return value; }

// Git leaves a file it could not merge (a vault synced with git) with conflict marks around the two sides:
// "<<<<<<< ours", "=======", ">>>>>>> theirs" (and "||||||| base" with diff3). The text of each side, or null when
// the marks are not there or not whole.
function conflictSides(text) {
  const lines = String(text).split(/\r?\n/); if (!lines.some(line => /^<{7}(?: |$)/.test(line))) return null;
  const ours = [], theirs = []; let part = 'both';
  for (const line of lines) {
    if (/^<{7}(?: |$)/.test(line)) { if (part !== 'both') return null; part = 'ours'; continue; }
    if (part === 'ours' && /^\|{7}(?: |$)/.test(line)) { part = 'base'; continue; }
    if ((part === 'ours' || part === 'base') && /^={7}$/.test(line)) { part = 'theirs'; continue; }
    if (part === 'theirs' && /^>{7}(?: |$)/.test(line)) { part = 'both'; continue; }
    if (part === 'both' || part === 'ours') ours.push(line);
    if (part === 'both' || part === 'theirs') theirs.push(line);
  }
  return part === 'both' ? { ours: ours.join('\n'), theirs: theirs.join('\n') } : null;
}
// A file named as the vault names it (.<id>/ai/<id>.json), never with the folders above it.
const vaultRelativeName = file => { const parts = String(file).split(/[\\/]/), at = parts.findLastIndex(isVaultDirName); return at >= 0 ? parts.slice(at).join('/') : parts.at(-1); };
// A JSON file that cannot be read says which one, and whether git left conflict marks in it (the message never holds
// its text). A plain Error with its code, so a window is shown the message alone (not "SyntaxError: …").
function unreadableFile(name, conflict) {
  return Object.assign(Error(conflict ? tr('파일을 읽을 수 없습니다(git 병합 충돌 표시가 남아 있습니다): {file}', { file: name }) : tr('파일을 읽을 수 없습니다: {file}', { file: name })), { code: 'APP_FILE_UNREADABLE', file: name, conflict });
}
const unreadableJson = (file, text) => unreadableFile(vaultRelativeName(file), Boolean(conflictSides(text)));
async function readJson(file, fallback) {
  let text;
  try { text = await fs.readFile(file, 'utf8'); } catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
  try { return JSON.parse(text); } catch { throw unreadableJson(file, text); }
}
// An AI records file ({version, results}, .<id>/ai/*.json). One git could not merge is read from both sides: each
// side is read on its own and their results joined by id. Of one id on both sides the later (updatedAt, else
// createdAt) gives the fields, and its adoptions and follow-ups are those of both (each once, by time and text; the
// follow-ups at most 50, the newest kept), as the app never marks an edit with updatedAt. A side that cannot be read
// is left out. Reading writes nothing: conflicted holds the file's text until the app next writes it (keepConflictCopy
// first) and joined says how many results were joined and which side, if any, could not be read. Neither side
// readable: APP_AI_RECORDS_UNREADABLE, naming the file only.
const FOLLOW_UPS = 50;
function joinEntries(a, b, limit) {
  if (!Array.isArray(a) && !Array.isArray(b)) return undefined;
  const seen = new Set(), out = [];
  for (const entry of [...(Array.isArray(a) ? a : []), ...(Array.isArray(b) ? b : [])]) { const key = JSON.stringify([entry?.at ?? null, entry?.text ?? null]); if (!seen.has(key)) { seen.add(key); out.push(entry); } }
  out.sort((x, y) => String(x?.at ?? '').localeCompare(String(y?.at ?? '')));
  return limit ? out.slice(-limit) : out;
}
async function readAiRecords(file, fallback = { version: 1, results: [] }) {
  let text;
  try { text = await fs.readFile(file, 'utf8'); } catch (error) { if (error.code === 'ENOENT') return { data: fallback }; throw error; }
  try { return { data: JSON.parse(text) }; } catch {}
  const sides = conflictSides(text), side = value => { try { const data = JSON.parse(value); return data && typeof data === 'object' && Array.isArray(data.results) ? data : null; } catch { return null; } };
  const ours = sides && side(sides.ours), theirs = sides && side(sides.theirs), name = vaultRelativeName(file);
  if (!ours && !theirs) throw Object.assign(Error(sides ? tr('이 자료의 AI 기록 파일을 읽을 수 없습니다(git 병합 충돌 표시가 남아 있습니다): {file}', { file: name }) : tr('이 자료의 AI 기록 파일을 읽을 수 없습니다: {file}', { file: name })), { code: 'APP_AI_RECORDS_UNREADABLE', file: name, conflict: Boolean(sides) });
  const time = result => Date.parse(result?.updatedAt || result?.createdAt || '') || 0, byId = new Map(), loose = [];
  for (const result of [...(ours?.results || []), ...(theirs?.results || [])]) {
    if (!result || typeof result.id !== 'string') { if (result) loose.push(result); continue; }
    const was = byId.get(result.id);
    if (!was) { byId.set(result.id, result); continue; }
    const kept = time(result) > time(was) ? result : was, joined = { ...kept };
    const adoptions = joinEntries(was.adoptions, result.adoptions), followUps = joinEntries(was.followUps, result.followUps, FOLLOW_UPS);
    if (adoptions) joined.adoptions = adoptions; if (followUps) joined.followUps = followUps;
    byId.set(result.id, joined);
  }
  const results = [...[...byId.values()].sort((a, b) => time(b) - time(a)), ...loose];
  return { data: { ...(theirs || {}), ...(ours || {}), results }, conflicted: text, joined: { file: name, results: results.length, unreadable: !ours ? 'ours' : !theirs ? 'theirs' : null } };
}
// Before the app writes over a file git left conflict marks in, the file is copied as it is into .<id>/backups
// (conflict-<file>-<time>.txt: not a metadata backup's name nor a .json, so never listed for restore, offered in the
// restore dialog or pruned; the full backup does not take the backups folder). Nothing to do for any other file.
async function keepConflictCopy(root, file) {
  let text;
  try { text = await fs.readFile(file, 'utf8'); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  if (!conflictSides(text)) return null;
  const directory = path.join(root, VAULT_DIR, 'backups'); await fs.mkdir(directory, { recursive: true });
  if (await fs.realpath(directory) !== directory) throw Error(tr('백업 폴더의 심볼릭 링크는 지원하지 않습니다.'));
  // Copied byte for byte; a name taken in the same millisecond gets a number, so the write that follows never stops here.
  const base = `conflict-${vaultRelativeName(file).replace(/^[^/]+\//, '').replace(/[^-a-zA-Z0-9]+/g, '_')}-${Date.now()}`;
  for (let n = 0; ; n++) {
    const copy = path.join(directory, `${base}${n ? '-' + n : ''}.txt`);
    try { await fs.copyFile(file, copy, constants.COPYFILE_EXCL); return copy; } catch (error) { if (error.code !== 'EEXIST' || n >= 99) throw error; }
  }
}
// A vault whose metadata cannot be read is told apart by this code, not by the message.
const damaged = message => Object.assign(Error(message), { code: 'APP_VAULT_DAMAGED' });
// A save is written to a temporary file and renamed over the old one. Windows lets a cloud drive or an antivirus hold
// the file for a moment (EPERM, EACCES, EBUSY): the rename is tried again for about two seconds, as folder renames are
// (legacy.cjs). One still refused leaves the file as it was and says so in words (the code stays), not with its path.
const HELD_CODES = ['EPERM', 'EACCES', 'EBUSY'], HELD_RETRY_MS = [100, 200, 400, 600, 800];
async function atomicText(file, text) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${crypto.randomUUID()}.tmp`;
  try {
    const handle=await fs.open(temp,'wx',0o600);try{await handle.writeFile(text);await handle.sync();}finally{await handle.close();}
    for (let attempt = 0; ; attempt++) {
      try { await fs.rename(temp, file); break; }
      catch (error) {
        if (!HELD_CODES.includes(error.code)) throw error;
        if (attempt < HELD_RETRY_MS.length) { await new Promise(done => setTimeout(done, HELD_RETRY_MS[attempt])); continue; }
        throw Object.assign(Error(tr('다른 프로그램(클라우드 동기화나 백신)이 파일을 잡고 있어 저장하지 못했습니다. 잠시 뒤 다시 하세요: {file}', { file: path.basename(file) })), { code: error.code, cause: error });
      }
    }
  }
  finally { await fs.rm(temp, { force: true }); }
}
// Which metadata backups to delete. The newest twenty stay as before (they cover the
// last hours of work); older ones thin out to the newest of each day for two weeks and
// the newest of each week for eight more, so a mistake noticed days later can be undone.
// A backup's id starts with the time it was made (ms).
const BACKUP_RECENT = 20, BACKUP_DAYS = 14, BACKUP_WEEKS = 8, DAY_MS = 86400000;
function expiredBackups(backups, now = Date.now()) {
  const sorted = [...backups].sort((a, b) => b.id.localeCompare(a.id)), days = new Set(), weeks = new Set(), expired = [];
  sorted.forEach((backup, index) => {
    const time = Number(/^\d+/.exec(backup.id)?.[0]), age = now - time;
    if (index < BACKUP_RECENT || !Number.isFinite(time)) return;
    const day = Math.floor(time / DAY_MS), week = Math.floor(time / (7 * DAY_MS));
    if (age < BACKUP_DAYS * DAY_MS && !days.has(day)) { days.add(day); weeks.add(week); return; }
    if (age < (BACKUP_DAYS + 7 * BACKUP_WEEKS) * DAY_MS && !weeks.has(week)) { weeks.add(week); return; }
    expired.push(backup);
  });
  return expired;
}
// Notes the page still held when the vault was read again from disk. base is what this
// app last saved, theirs what is on disk now, mine what the page has. A note only the
// page changed is kept; one changed on both sides keeps the disk text and gets the
// page's text appended under a marker, so neither is lost.
// The marker is written in the AI answer language (core/memo-labels.cjs; Korean when none is given).
function mergePendingNotes(base, theirs, mine, language = 'ko') {
  const mark = memoLabel('conflictMark', language);
  const notes = { ...theirs }, kept = [], conflicts = [];
  if (!mine || typeof mine !== 'object' || Array.isArray(mine)) return { notes, kept, conflicts };
  for (const [key, value] of Object.entries(mine)) {
    if (typeof value !== 'string' || value === (base?.[key] ?? '') || value === (theirs[key] ?? '')) continue;
    if ((theirs[key] ?? '') === (base?.[key] ?? '')) { notes[key] = value; kept.push(key); }
    else { notes[key] = (theirs[key] ?? '') + mark + value; conflicts.push(key); }
  }
  return { notes, kept, conflicts };
}
const atomicJson = (file, value) => atomicText(file, JSON.stringify(value, null, 2));
// An attachment's in-app translation lives in .<id>/translation-<owner>[-<key>].json
// (null when the stored identifiers are not safe to use as a file name).
// Korean, the first language, keeps the plain name (every existing vault). Another target
// language adds -lang-<code>, so translations of one paper into two languages never
// overwrite each other; the name still matches what backup and sync carry.
// A DOI as two items are compared by it: lower case, without a doi.org link or a doi: prefix.
const doiKey = doi => String(doi ?? '').trim().toLowerCase().replace(/^https?:\/\/(?:dx\.)?doi\.org\//, '').replace(/^doi:\s*/, '');
// Citation keys handed out against those in use: a key already taken gets a letter (smith2020 → smith2020a), as BibTeX
// tools do. Returns the function that hands one out (and keeps it as used).
function citekeyAllocator(keys) { return key => { if (!key || !keys.has(key)) { if (key) keys.add(key); return key; } for (let i = 0; ; i++) { const next = key + (i < 26 ? String.fromCharCode(97 + i) : '-' + i); if (!keys.has(next)) { keys.add(next); return next; } } }; }
function translationFileName(paperId, attachment, language = 'ko') {
  const owner = Number(attachment.cacheOwnerId || paperId), key = attachment.cacheKey ?? attachment.id;
  if (!/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/.test(language)) return null;
  return Number.isSafeInteger(owner) && /^[-a-zA-Z0-9]*$/.test(key) ? `translation-${owner}${key ? '-' + key : ''}${language === 'ko' ? '' : '-lang-' + language}.json` : null;
}
async function pdfFile(file) {
  const info = await fs.lstat(file);
  if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_BYTES || info.size < 5) throw Error(tr('100MB 이하의 일반 PDF 파일을 선택하세요.'));
  const handle = await fs.open(file, 'r');
  try { const bytes = Buffer.alloc(1024); const result = await handle.read(bytes, 0, 1024, 0); if (!bytes.subarray(0, result.bytesRead).includes(Buffer.from('%PDF-'))) throw Error(tr('PDF 형식을 확인할 수 없습니다.')); }
  finally { await handle.close(); }
}
// The optional fields of an annotation, checked; anything else is left out.
function annotationExtra({kind,title,model,figure,createdAt}={}){
  const out={};
  if(kind!==undefined){if(!['figure','explain'].includes(kind))throw Error(tr('주석 종류를 확인하세요.'));out.kind=kind;}
  if(title!==undefined&&title!==null){if(typeof title!=='string'||title.length>200)throw Error(tr('주석 제목을 확인하세요.'));if(title.trim())out.title=title.trim();}
  if(model!==undefined&&model!==null&&model!==''){if(typeof model!=='string'||model.length>200)throw Error(tr('모델 이름을 확인하세요.'));out.model=model;}
  if(figure!==undefined&&figure!==null){const v=[figure.x,figure.y,figure.width,figure.height];if(!v.every(n=>Number.isFinite(n)&&n>=-0.01&&n<=1.01))throw Error(tr('그림 위치를 확인하세요.'));out.figure={x:+figure.x.toFixed(4),y:+figure.y.toFixed(4),width:+figure.width.toFixed(4),height:+figure.height.toFixed(4)};}
  if(createdAt!==undefined){if(typeof createdAt!=='string'||Number.isNaN(Date.parse(createdAt)))throw Error(tr('작성 시각을 확인하세요.'));out.createdAt=new Date(createdAt).toISOString();}
  return out;
}
// Where a PDF link of a bibliography file points: a file:// address, a full path, EndNote's
// internal-pdf:// (the library's "<name>.Data/PDF" folder beside the file) or a path from the
// exchange file's own folder. Web addresses and anything but a PDF give null.
function attachmentFile(link,folder,name=''){
  let value=String(link).trim();
  if(/^https?:/i.test(value))return null;
  if(/^file:/i.test(value)){try{value=require('node:url').fileURLToPath(value);}catch{return null;}}
  else if(/^internal-pdf:\/\//i.test(value))value=path.join(folder,name.replace(/\.[^.]+$/,'')+'.Data','PDF',decodeURIComponent(value.replace(/^internal-pdf:\/\//i,'')));
  else if(/^[a-z][a-z0-9+.-]{2,}:/i.test(value))return null;
  if(!/\.pdf$/i.test(value))return null;
  if(process.platform!=='win32')value=value.replace(/\\/g,'/');
  return path.resolve(folder,value);
}
class Library {
  constructor(root) { this.root = root; this.file = path.join(root, VAULT_DIR, 'library.json'); this.data = null; this.diskDigest = null; this.lastBackupAt = 0; }
  // The vault in a folder as it is, read only: nothing is taken over, scanned, saved or backed up. A folder that is not a
  // vault yet gives an empty one (fresh), with the number of PDFs in it (loosePdfs: opening it would list them). A vault
  // of a later app or a damaged one is refused as opening it would be.
  static async peek(root) {
    root = await fs.realpath(root);
    if (!(await fs.stat(root)).isDirectory()) throw Error(tr('폴더를 선택하세요.'));
    const library = new Library(root);
    let folder = null; for (const name of [VAULT_DIR, ...OLD_VAULT_DIRS]) if (await fs.stat(path.join(root, name, 'library.json')).then(s => s.isFile(), () => false)) { folder = name; break; }
    if (!folder) {
      library.data = { version: 2, id: crypto.randomUUID(), papers: [], notes: {}, collections: [], annotations: [] }; library.fresh = true;
      let count = 0; const pending = [''];
      while (pending.length) { const folder = pending.pop(); for (const entry of await fs.readdir(path.join(root, ...folder.split('/').filter(Boolean)), { withFileTypes: true }).catch(() => [])) {
        if (entry.name.startsWith('.') || entry.isSymbolicLink() || (!folder && entry.name.toLowerCase() === 'translations')) continue;
        if (entry.isDirectory()) pending.push(folder ? folder + '/' + entry.name : entry.name); else if (entry.isFile() && /\.pdf$/i.test(entry.name)) count++; } }
      library.loosePdfs = count; return library;
    }
    library.file = path.join(root, folder, 'library.json'); library.vaultFolder = folder; library.fresh = false; library.loosePdfs = 0;
    library.data = await readJson(library.file, null).catch(error => { throw error instanceof SyntaxError || error?.code === 'APP_FILE_UNREADABLE' ? Object.assign(error, { code: 'APP_VAULT_DAMAGED' }) : error; });
    if (Number.isInteger(library.data?.version) && library.data.version > 2) throw Object.assign(Error(tr('이 저장소는 더 새로운 버전의 앱에서 만들었습니다. 자료는 그대로 있습니다. 앱을 업데이트한 뒤 다시 여세요.')), { code: 'APP_NEWER_VAULT' });
    if (!library.data || ![1, 2].includes(library.data.version) || !Array.isArray(library.data.papers) || typeof library.data.notes !== 'object') throw damaged(tr('지원하지 않는 저장소 형식입니다.'));
    library.data.version = 2; library.data.collections ||= []; library.data.annotations ||= [];
    library.validateData(library.data);
    return library;
  }
  static async open(root) {
    root = await fs.realpath(root);
    if (!(await fs.stat(root)).isDirectory()) throw Error(tr('폴더를 선택하세요.'));
    await adoptVaultFolder(root);
    await fs.mkdir(path.join(root, VAULT_DIR), { recursive: true });
    if ((await fs.realpath(path.join(root, VAULT_DIR))) !== path.join(root, VAULT_DIR)) throw Error(tr('{folder} 폴더의 심볼릭 링크는 지원하지 않습니다.',{folder:VAULT_DIR}));
    const library = new Library(root);
    library.diskDigest = await library.diskHash();
    library.data = await readJson(library.file, { version: 2, id: crypto.randomUUID(), papers: [], notes: {},collections:[],annotations:[] }).catch(error => { throw error instanceof SyntaxError || error?.code === 'APP_FILE_UNREADABLE' ? Object.assign(error, { code: 'APP_VAULT_DAMAGED' }) : error; });
    // A vault written by a later app is not damaged: it must not be offered a restore from an old backup.
    if (Number.isInteger(library.data?.version) && library.data.version > 2) throw Object.assign(Error(tr('이 저장소는 더 새로운 버전의 앱에서 만들었습니다. 자료는 그대로 있습니다. 앱을 업데이트한 뒤 다시 여세요.')), { code: 'APP_NEWER_VAULT' });
    if (!library.data || ![1,2].includes(library.data.version) || !Array.isArray(library.data.papers) || typeof library.data.notes !== 'object') throw damaged(tr('지원하지 않는 저장소 형식입니다.'));
    if(library.data.version===1){try{await fs.copyFile(library.file,path.join(root,VAULT_DIR,'library.v1.backup.json'),constants.COPYFILE_EXCL);}catch(error){if(error.code!=='EEXIST')throw error;}library.data.version=2;}
    library.data.collections ||= [];library.data.annotations ||= [];
    if(!Array.isArray(library.data.collections)||!Array.isArray(library.data.annotations)||!library.data.notes||Array.isArray(library.data.notes))throw damaged(tr('지원하지 않는 저장소 형식입니다.'));
    library.validateData(library.data);
    // A send to this vault the app stopped in is finished or undone before anything is scanned (desktop/transfer.cjs).
    await require('./transfer.cjs').recoverTransfers(library);
    await library.scan();
    await library.save(); return library;
  }
  validateData(data){
    if(!data||data.version!==2||typeof data.id!=='string'||!Array.isArray(data.papers)||!data.notes||typeof data.notes!=='object'||Array.isArray(data.notes)||Object.values(data.notes).some(n=>typeof n!=='string')||!Array.isArray(data.collections)||!Array.isArray(data.annotations))throw damaged(tr('백업 형식이 올바르지 않습니다.'));
    // An item that has files but names none of them as the one to open (a merge into an item that
    // had no PDF once left this) is given one, so the vault opens instead of asking for a backup.
    for(const p of data.papers)if(p&&Array.isArray(p.attachments)){const live=p.attachments.filter(a=>a&&!a.trashedAt);if(live.length&&!live.some(a=>a.id===p.primaryAttachmentId))p.primaryAttachmentId=(live.find(a=>a.role!=='translated')||live[0]).id;}
    data.papers.forEach(p=>this.preparePaper(p));
    const attachments=data.papers.flatMap(p=>p.attachments);
    if(new Set(data.papers.map(p=>p.id)).size!==data.papers.length||new Set(attachments.map(a=>a.id)).size!==attachments.length)throw damaged(tr('백업 식별자가 중복됩니다.'));
    if(new Set(data.collections.map(c=>c?.id)).size!==data.collections.length||new Set(data.annotations.map(a=>a?.id)).size!==data.annotations.length)throw damaged(tr('백업 식별자가 중복됩니다.'));
    // Two devices can each move a collection under the other; the merge then
    // holds a parent loop. Break it where it closes so walks up the tree end.
    for(const c of data.collections){const seen=new Set([c?.id]);for(let at=c?.parentId;at;at=data.collections.find(p=>p?.id===at)?.parentId){if(seen.has(at)){delete c.parentId;break;}seen.add(at);}}
    // A colour this version cannot read (from a newer one) is kept and shown without colour.
    if(data.tagColors!==undefined&&(!data.tagColors||typeof data.tagColors!=='object'||Array.isArray(data.tagColors)||Object.values(data.tagColors).some(c=>typeof c!=='string')))throw damaged(tr('태그 색 형식을 확인하세요.'));
    if(data.savedSearches!==undefined&&(!Array.isArray(data.savedSearches)||data.savedSearches.some(s=>!s||typeof s.id!=='string'||typeof s.name!=='string')))throw damaged(tr('저장 검색 형식을 확인하세요.'));
    // Sets, not nested scans: a vault can hold thousands of papers and annotations.
    const owners=new Set(data.papers.flatMap(p=>p.attachments.map(f=>p.id+'/'+f.id))),collectionIds=new Set(data.collections.map(c=>c?.id));
    if(data.collections.some(c=>!c||typeof c.id!=='string'||typeof c.name!=='string'||c.parentId!==undefined&&!collectionIds.has(c.parentId))||data.annotations.some(a=>!a||typeof a.id!=='string'||typeof a.body!=='string'||!Number.isInteger(a.page)||!owners.has(a.paperId+'/'+a.attachmentId)))throw Error(tr('백업의 컬렉션·주석 연결을 확인하세요.'));
    return data;
  }
  static async recover(root,id){
    const probe=new Library(await fs.realpath(root));
    if(!/^\d+-[a-f0-9-]+\.json$/.test(id))throw Error(tr('백업을 선택하세요.'));
    const directory=await probe.backupDirectory(),file=path.join(directory,id);
    if((await fs.lstat(file)).isSymbolicLink())throw Error(tr('일반 백업 파일을 선택하세요.'));
    const record=await readJson(file,null);if(record?.version!==1)throw damaged(tr('백업 형식이 올바르지 않습니다.'));
    probe.validateData(record.data);
    await fs.copyFile(probe.file,path.join(root,VAULT_DIR,`library.corrupt-${crypto.randomUUID()}.json`),constants.COPYFILE_EXCL);
    await atomicJson(probe.file,record.data);return Library.open(root);
  }
  preparePaper(paper) {
    if(!paper||!Number.isSafeInteger(paper.id)||paper.id<=0||typeof paper.title!=='string'||!Array.isArray(paper.tags)||paper.tags.some(t=>typeof t!=='string'))throw damaged(tr('자료 항목 형식이 올바르지 않습니다.'));
    if(!Array.isArray(paper.attachments)){
      paper.attachments=[];
      for(const role of ['original','translated'])if(paper[role])paper.attachments.push({id:`${role}-${paper.id}`,path:this.relative(paper[role]),name:path.posix.basename(this.relative(paper[role])),role,cacheOwnerId:paper.id,cacheKey:role==='original'?'':`${role}-${paper.id}`});
      paper.primaryAttachmentId=paper.attachments.find(a=>a.role==='original')?.id||paper.attachments[0]?.id;
    }
    paper.collectionIds ||= [];paper.doi ||= '';
    if(!Array.isArray(paper.collectionIds)||paper.attachments.some(a=>!a||typeof a.id!=='string'||!/^[-a-zA-Z0-9]{1,100}$/.test(a.id)||typeof a.name!=='string'||!['original','version','supplement','translated'].includes(a.role)))throw damaged(tr('첨부파일 형식이 올바르지 않습니다.'));
    for(const attachment of paper.attachments)attachment.path=this.relative(attachment.path);
    if(paper.attachments.some(a=>!a.trashedAt)&&!paper.attachments.some(a=>a.id===paper.primaryAttachmentId&&!a.trashedAt))throw damaged(tr('대표 첨부파일이 없습니다.'));
    delete paper.original;delete paper.translated;
    for(const role of ['original','translated'])Object.defineProperty(paper,role,{configurable:true,get(){const attachment=role==='original'?paper.attachments.find(a=>a.id===paper.primaryAttachmentId):paper.attachments.findLast(a=>a.role==='translated'&&!a.trashedAt);return attachment?.path;},set(value){let attachment=role==='original'?paper.attachments.find(a=>a.id===paper.primaryAttachmentId):paper.attachments.findLast(a=>a.role==='translated'&&!a.trashedAt);if(attachment)attachment.path=value;}});
    return paper;
  }
  paper(id){const paper=this.data.papers.find(p=>p.id===Number(id));if(!paper)throw Error(tr('자료 항목이 없습니다.'));return paper;}
  attachment(paperId,attachmentId){const paper=this.paper(paperId),id=attachmentId||paper.primaryAttachmentId;const attachment=paper.attachments?.find(a=>a.id===id&&!a.trashedAt);if(!attachment)throw Error(tr('이 자료의 첨부파일이 없습니다.'));return attachment;}
  // SHA-256 of a file, reused while its size and modification time are unchanged:
  // several features check the same large PDF against its stored hash.
  async hashFile(file){const info=await fs.stat(file),known=(this.hashes||=new Map()).get(file);if(known&&known.size===info.size&&known.mtimeMs===info.mtimeMs)return known.hash;const hash=crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex');this.hashes.set(file,{size:info.size,mtimeMs:info.mtimeMs,hash});return hash;}
  async fingerprint(relative,internal=false){try{return await this.hashFile(await this.resolvePath(relative,internal));}catch{return null;}}
  async resolvePath(value,internal=false){const relative=this.relative(value);await this.directory(path.posix.dirname(relative)==='.'?'':path.posix.dirname(relative),internal);const file=path.join(this.root,...relative.split('/'));await pdfFile(file);if(await fs.realpath(file)!==file)throw Error(tr('첨부파일 경로가 변경됐습니다.'));return file;}
  async transaction(change){const before=JSON.stringify(this.data);try{const result=await change();await this.save();return result;}catch(error){this.data=JSON.parse(before);this.data.papers.forEach(p=>this.preparePaper(p));throw error;}}
  relative(value) {
    if(typeof value!=='string'||path.isAbsolute(value)||/^[a-z]:/i.test(value)||value.includes('\0'))throw Error(tr('저장소 안의 경로를 선택하세요.'));
    const normalized=value.replace(/\\/g,'/');
    if(normalized.startsWith('/')||normalized.split('/').some(part=>part==='.'||part==='..'||isVaultDirName(part)))throw Error(tr('저장소 밖이나 내부 설정 폴더에는 접근할 수 없습니다.'));
    return normalized;
  }
  async directory(relative='',internal=false) {
    relative=this.relative(relative);
    if(!internal&&relative.split('/')[0].toLowerCase()==='translations')throw Error(tr('번역 첨부 폴더는 직접 수정할 수 없습니다.'));
    let current=this.root;
    for(const part of relative.split('/').filter(Boolean)){
      current=path.join(current,part);const info=await fs.lstat(current);
      if(info.isSymbolicLink()||!info.isDirectory())throw Error(tr('일반 저장소 폴더를 선택하세요. 심볼릭 링크는 지원하지 않습니다.'));
    }
    if(await fs.realpath(current)!==current)throw Error(tr('저장소 폴더 경로가 변경됐습니다.'));
    return current;
  }
  async scan() {
    const folders=[],pending=[''],known=new Set(this.data.papers.flatMap(p=>p.attachments.map(a=>this.relative(a.path)))),translated=new Set();
    let added=false;const discovered=[];
    while(pending.length){
      const folder=pending.pop();let entries;
      try{entries=await fs.readdir(await this.directory(folder),{withFileTypes:true});}catch(error){if(error.code==='ENOENT')continue;throw error;}
      for(const entry of entries){
        if(entry.name.startsWith('.')||entry.isSymbolicLink()||(!folder&&entry.name.toLowerCase()==='translations'))continue;
        const relative=folder?folder+'/'+entry.name:entry.name;
        if(entry.isDirectory()){folders.push(relative);pending.push(relative);}
        else if(entry.isFile()&&/\.pdf$/i.test(entry.name)&&!known.has(relative)&&!translated.has(relative)){
          try{await pdfFile(path.join(this.root,...relative.split('/')));discovered.push({name:entry.name,path:relative,hash:await this.fingerprint(relative)});}catch{/* Ignore incomplete or invalid external PDFs. */}
        }
      }
    }
    // Match only an unambiguous missing attachment to identical bytes. Copies remain independent.
    const missing=[],archivedMissing=[];
    for(const paper of this.data.papers)for(const attachment of paper.attachments){
      try{await this.resolvePath(attachment.path,attachment.role==='translated');
        if(!attachment.sourceHash){attachment.sourceHash=await this.fingerprint(attachment.path,attachment.role==='translated');added=true;}
      }catch{if(attachment.sourceHash)(paper.trashedAt||attachment.trashedAt?archivedMissing:missing).push(attachment);}
    }
    const deferred=new Set(),relinked=new Set();
    // Lookups by hash, built once: a first open of a large folder compared every new PDF with every other.
    const group=(list,key)=>{const map=new Map();for(const item of list){const k=key(item);if(!map.has(k))map.set(k,[]);map.get(k).push(item);}return map;};
    const moved=new Set((this.data.movedCopies||[]).map(move=>move.path+'\n'+move.hash)),archived=new Set(archivedMissing.map(a=>a.sourceHash)),missingByHash=group(missing,a=>a.sourceHash),filesByHash=group(discovered,f=>f.hash);
    for(const candidate of discovered){
      const matches=missingByHash.get(candidate.hash)||[];
      // A copy left behind by an earlier move is passed over, unless the attachment it was
      // left for is itself gone now: then this file is that attachment again (moved back).
      const leftOver=moved.has(candidate.path+'\n'+candidate.hash);
      if((leftOver&&!matches.length)||archived.has(candidate.hash))continue;
      if(leftOver){this.data.movedCopies=this.data.movedCopies.filter(move=>!(move.path===candidate.path&&move.hash===candidate.hash));added=true;}
      const files=filesByHash.get(candidate.hash)||[];
      if(matches.length===1&&files.length===1){matches[0].path=candidate.path;matches[0].name=candidate.name;relinked.add(matches[0]);added=true;}
      else if(matches.length){deferred.add(candidate.path);}
      else {this.data.papers.push(this.newPaper(candidate.name,candidate.path,candidate.hash));added=true;}
    }
    // A missing attachment whose identical file is already registered under another record:
    // the file was copied to its new place, registered there as new, and the old place then
    // removed (or the two items were merged). The record that carries the work (translation,
    // ink, corrections, AI results, annotations) takes the file; the other, empty record goes.
    const pristine=paper=>paper.attachments.length===1&&!paper.trashedAt&&!paper.star&&!(paper.tags||[]).length&&!(paper.collectionIds||[]).length&&!paper.mergedFrom&&(!paper.status||paper.status==='읽기 전')&&!paper.doi&&!Object.keys(this.data.notes).some(key=>key.startsWith(paper.id+'-')&&this.data.notes[key])&&!this.data.annotations.some(a=>a.paperId===paper.id); // i18n:keep — stored values
    const firstLive=paper=>paper.attachments.find(a=>!a.trashedAt&&a.role!=='translated')?.id||paper.attachments.find(a=>!a.trashedAt)?.id||paper.attachments[0]?.id||null;
    for(const [hash,gone] of missingByHash){
      const lost=gone.filter(a=>!relinked.has(a)&&a.role!=='translated');if(lost.length!==1)continue;
      const dead=lost[0],owner=this.data.papers.find(p=>p.attachments.includes(dead)),twins=[];
      for(const paper of this.data.papers)if(!paper.trashedAt)for(const a of paper.attachments)if(a!==dead&&!a.trashedAt&&a.role!=='translated'&&a.sourceHash===hash&&!missing.includes(a))twins.push([paper,a]);
      if(twins.length!==1)continue;
      const [home,live]=twins[0],deadWork=await this.attachmentWork(owner.id,dead),liveWork=await this.attachmentWork(home.id,live);
      if(home===owner){
        if(!liveWork){dead.path=live.path;dead.name=live.name;owner.attachments=owner.attachments.filter(a=>a!==live);if(owner.primaryAttachmentId===live.id)owner.primaryAttachmentId=dead.id;}
        else if(!deadWork){owner.attachments=owner.attachments.filter(a=>a!==dead);if(owner.primaryAttachmentId===dead.id)owner.primaryAttachmentId=live.id;}
        else if(owner.primaryAttachmentId===dead.id)owner.primaryAttachmentId=live.id; // both carry work: both stay, the one that opens is the file that exists
        else continue;
        added=true;
      }else if(!liveWork&&pristine(home)){
        // The file was registered as a new, untouched item: that item goes and the file returns to its record.
        dead.path=live.path;dead.name=live.name;this.data.papers=this.data.papers.filter(p=>p!==home);added=true;
      }
      if(!owner.attachments.some(a=>a.id===owner.primaryAttachmentId&&!a.trashedAt))owner.primaryAttachmentId=firstLive(owner);
    }
    this.relinkCandidates=[...deferred];
    this.folders=folders.sort((a,b)=>a.localeCompare(b,'ko',{numeric:true}));return added;
  }
  // A folder name that every OS accepts (no separators, reserved device names or trailing dots).
  folderName(parent,name){if(typeof name!=='string'||!name.trim()||name!==name.trim()||name.length>128||name.startsWith('.')||/[<>:"/\\|?*\x00-\x1f]/.test(name)||/[. ]$/.test(name)||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)||(!parent&&name.toLowerCase()==='translations'))throw Error(tr('사용할 수 없는 폴더 이름입니다.'));}
  async createFolder(parent,name) {
    parent=this.relative(parent);this.folderName(parent,name);
    const destination=path.join(await this.directory(parent),name);
    try{await fs.mkdir(destination);}catch(error){if(error.code==='EEXIST')throw Error(tr('같은 이름의 폴더 또는 파일이 있습니다.'));throw error;}
    await this.scan();return parent?parent+'/'+name:name;
  }
  // Renames a folder on disk and moves every attachment path under it (trashed ones too).
  // The disk rename is undone if the library cannot be saved.
  async renameFolder(folder,name){
    folder=this.relative(folder);if(!folder)throw Error(tr('저장소 폴더 자체는 이름을 바꿀 수 없습니다.'));
    const parent=path.posix.dirname(folder)==='.'?'':path.posix.dirname(folder);this.folderName(parent,name);
    const source=await this.directory(folder),next=parent?parent+'/'+name:name;if(next===folder)return folder;
    const destination=path.join(await this.directory(parent),name);
    if(next.toLowerCase()!==folder.toLowerCase())try{await fs.access(destination);throw Error(tr('같은 이름의 폴더 또는 파일이 있습니다.'));}catch(error){if(error.code!=='ENOENT')throw error;}
    await this.backup(tr('폴더 이름 변경 전'));
    await fs.rename(source,destination);
    const prefix=folder+'/',moved=p=>p===folder||p.startsWith(prefix);
    try{await this.transaction(()=>{for(const paper of this.data.papers)for(const attachment of paper.attachments)if(moved(attachment.path))attachment.path=next+attachment.path.slice(folder.length);
      for(const copy of this.data.movedCopies||[])if(moved(copy.path))copy.path=next+copy.path.slice(folder.length);});}
    catch(error){await fs.rename(destination,source).catch(()=>{});throw error;}
    this.hashes=new Map();await this.scan();return next;
  }
  // A time-based id that no paper in this vault uses yet.
  newPaperId(){const used=new Set(this.data.papers.map(p=>p.id));let id;do{id=Date.now()*1000+crypto.randomInt(1000);}while(used.has(id));return id;}
  newPaper(name, original,hash=null) {
    const id=this.newPaperId();
    const attachment={id:crypto.randomUUID(),path:original,name,role:'original',sourceHash:hash,cacheOwnerId:id,cacheKey:''};
    return this.preparePaper({id,title:name.replace(/\.pdf$/i,''),authors:'저자 미입력',year:'—',journal:'',doi:'',tags:[],collectionIds:[],status:'읽기 전',star:false,attachments:[attachment],primaryAttachmentId:attachment.id}); // i18n:keep — stored values
  }
  async diskHash(){try{return crypto.createHash('sha256').update(await fs.readFile(this.file)).digest('hex');}catch(error){if(error.code==='ENOENT')return null;throw error;}}
  async assertUnchanged(){if(await this.diskHash()!==this.diskDigest)throw Object.assign(Error(tr('저장소가 다른 프로그램에서 변경됐습니다. ‘다시 읽기’를 누르면 재시작 없이 이어서 쓸 수 있습니다.')),{code:'APP_EXTERNAL_CHANGE'});}
  // The vault's folder itself is not there any more: renamed, moved, or on a drive taken out. (Its records are then
  // not "changed by another program": there is nothing to read again where it was.)
  // A folder that is there under that name but without the records this app read or wrote (made again by a sync tool or
  // by hand) is not the vault either.
  async gone(){
    try{if(!(await fs.stat(this.root)).isDirectory())return true;}catch(error){if(error.code==='ENOENT'||error.code==='ENOTDIR')return true;throw error;}
    return this.diskDigest!==null&&await this.diskHash()===null;
  }
  // Whether library.json on disk is still what this app last read or wrote.
  async unchanged(){return await this.diskHash()===this.diskDigest;}
  async backupDirectory(){const directory=path.join(this.root,VAULT_DIR,'backups');await vaultDirectory(this.root,directory);if(await fs.realpath(directory)!==directory)throw Error(tr('백업 폴더의 심볼릭 링크는 지원하지 않습니다.'));return directory;}
  async backup(label=tr('자동 백업')){
    await this.assertUnchanged();if(this.diskDigest===null)return null;
    const directory=await this.backupDirectory(),id=`${Date.now()}-${crypto.randomUUID()}.json`;
    const data=await readJson(this.file,null);
    await atomicJson(path.join(directory,id),{version:1,createdAt:new Date().toISOString(),label,data});
    this.lastBackupAt=Date.now();const backups=await this.backups();
    for(const old of expiredBackups(backups))await fs.rm(path.join(directory,old.id));return id;
  }
  // Each backup file is a whole library copy and is never rewritten, so its
  // summary is read once and kept (keyed by size and time); every save that
  // made a backup used to parse all twenty-odd copies again.
  async backups(){const directory=await this.backupDirectory(),items=[],known=this.backupInfo||=new Map(),seen=new Set();for(const id of await fs.readdir(directory)){if(!/^\d+-[a-f0-9-]+\.json$/.test(id))continue;try{const file=path.join(directory,id),info=await fs.lstat(file);if(info.isSymbolicLink())continue;seen.add(id);let summary=known.get(id);if(!summary||summary.size!==info.size||summary.mtimeMs!==info.mtimeMs){const record=await readJson(file,null);summary={size:info.size,mtimeMs:info.mtimeMs,valid:record?.version===1,vaultId:record?.data?.id,label:record?.label,createdAt:record?.createdAt,papers:record?.data?.papers?.length};known.set(id,summary);}if(summary.valid&&summary.vaultId===this.data?.id)items.push({id,label:summary.label,createdAt:summary.createdAt,papers:summary.papers});}catch{/* a backup that cannot be read is not offered */}}for(const id of known.keys())if(!seen.has(id))known.delete(id);return items.sort((a,b)=>b.id.localeCompare(a.id));}
  async restoreBackup(id){
    if(!(await this.backups()).some(b=>b.id===id))throw Error(tr('백업을 찾을 수 없습니다.'));
    const record=await readJson(path.join(await this.backupDirectory(),id),null),probe=new Library(this.root);probe.data=record.data;
    probe.validateData(probe.data);
    await this.backup(tr('복원 직전'));await this.transaction(()=>{this.data=probe.data;});
  }
  // One read of library.json to detect outside changes (backup() checks it
  // itself) and one serialisation for both the digest and the write.
  async save() {
    if(this.diskDigest!==null&&Date.now()-this.lastBackupAt>5*60*1000)await this.backup();else await this.assertUnchanged();
    const text=JSON.stringify(this.data,null,2),digest=crypto.createHash('sha256').update(text).digest('hex');await atomicText(this.file,text);this.diskDigest=digest;
  }
  async moveAttachment(paperId,attachmentId,folder,name){
    const attachment=this.attachment(paperId,attachmentId),source=await this.resolveFile(paperId,'attachment-'+attachmentId);
    if(typeof name!=='string'||!name.trim()||name!==name.trim()||name.length>200||!/^.+\.pdf$/i.test(name)||/[<>:"/\\|?*\x00-\x1f]/.test(name)||name.startsWith('.')||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])\./i.test(name))throw Error(tr('사용할 수 없는 PDF 이름입니다.'));
    const destination=path.join(await this.directory(folder),name),relative=folder?folder+'/'+name:name;
    if(source===destination)return;
    if(this.data.papers.some(p=>p.attachments.some(a=>a.path.toLowerCase()===relative.toLowerCase())))throw Object.assign(Error(tr('이미 등록된 경로입니다.')),{code:'APP_PATH_REGISTERED'});
    await this.backup(tr('파일 이동 전'));
    const sourceHash=crypto.createHash('sha256').update(await fs.readFile(source)).digest('hex'),oldPath=attachment.path;
    await fs.copyFile(source,destination,constants.COPYFILE_EXCL);
    try{await this.transaction(()=>{attachment.path=relative;attachment.name=name;(this.data.movedCopies||=[]).push({path:oldPath,hash:sourceHash});});}
    catch(error){await fs.rm(destination,{force:true});throw error;}
    // A failed unlink leaves a harmless copy; never remove the new registered attachment.
    try{await fs.unlink(source);}catch{throw Error(tr('이동은 저장됐지만 이전 파일을 지우지 못했습니다. 이전 경로의 복사본을 확인하세요.'));}
  }
  async relinkAttachment(paperId,attachmentId,relative){
    const attachment=this.attachment(paperId,attachmentId);if(await this.fingerprint(attachment.path,attachment.role==='translated'))throw Error(tr('현재 파일이 존재합니다. 이동 기능을 사용하세요.'));
    const hash=await this.fingerprint(relative,attachment.role==='translated');if(!hash||attachment.sourceHash&&hash!==attachment.sourceHash)throw Error(tr('기존 첨부파일과 같은 내용의 PDF를 선택하세요.'));
    if(this.data.papers.some(p=>p.attachments.some(a=>a!==attachment&&a.path===relative)))throw Error(tr('이미 다른 첨부파일로 등록돼 있습니다.'));
    await this.transaction(()=>{attachment.path=this.relative(relative);attachment.name=path.posix.basename(relative);attachment.sourceHash=hash;});
  }
  async trashAttachment(paperId,attachmentId,restore=false){
    const paper=this.paper(paperId),attachment=paper.attachments.find(a=>a.id===attachmentId);if(!attachment)throw Error(tr('첨부파일이 없습니다.'));
    await this.backup(restore?tr('첨부 복원 전'):tr('첨부 휴지통 이동 전'));
    await this.transaction(()=>{if(restore)delete attachment.trashedAt;else attachment.trashedAt=new Date().toISOString();
      if(!paper.attachments.some(a=>a.id===paper.primaryAttachmentId&&!a.trashedAt))paper.primaryAttachmentId=paper.attachments.find(a=>!a.trashedAt&&a.role!=='translated')?.id||paper.attachments.find(a=>!a.trashedAt)?.id||null;
    });
  }
  async trashPaper(id,restore=false){await this.backup(restore?tr('휴지통 복원 전'):tr('휴지통 이동 전'));await this.transaction(()=>{const paper=this.paper(id);if(restore)delete paper.trashedAt;else paper.trashedAt=new Date().toISOString();});}
  // Deleting a collection keeps its papers and moves its children up a level.
  async editCollection(id,name){if(name===null)await this.backup(tr('컬렉션 삭제 전'));await this.transaction(()=>{const collection=this.data.collections.find(c=>c.id===id);if(!collection)throw Error(tr('컬렉션이 없습니다.',null,'missing'));if(name===null){this.data.collections=this.data.collections.filter(c=>c.id!==id);for(const child of this.data.collections)if(child.parentId===id){if(collection.parentId)child.parentId=collection.parentId;else delete child.parentId;}for(const paper of this.data.papers)paper.collectionIds=paper.collectionIds.filter(value=>value!==id);this.data.savedSearches=(this.data.savedSearches||[]).map(s=>s.collectionId===id?{...s,collectionId:null}:s);}else{if(typeof name!=='string'||!name.trim()||name.length>100||this.siblingName(collection.parentId,name.trim(),id))throw Error(tr('다른 컬렉션 이름을 입력하세요.'));collection.name=name.trim();}});}
  siblingName(parentId,name,except=null){return this.data.collections.some(c=>c.id!==except&&(c.parentId||null)===(parentId||null)&&c.name===name);}
  async moveCollection(id,parentId){
    await this.transaction(()=>{const collection=this.data.collections.find(c=>c.id===id);if(!collection)throw Error(tr('컬렉션이 없습니다.',null,'missing'));
      if(parentId){if(!this.data.collections.some(c=>c.id===parentId))throw Error(tr('상위 컬렉션이 없습니다.'));for(let at=parentId;at;at=this.data.collections.find(c=>c.id===at)?.parentId)if(at===id)throw Error(tr('컬렉션을 자기 하위로 옮길 수 없습니다.'));}
      if(this.siblingName(parentId,collection.name,id))throw Error(tr('옮길 위치에 같은 이름의 컬렉션이 있습니다.'));
      if(parentId)collection.parentId=parentId;else delete collection.parentId;});
  }
  async editAnnotation(id,patch){if(patch===null)await this.backup(tr('주석 삭제 전'));await this.transaction(()=>{const annotation=this.data.annotations.find(a=>a.id===id);if(!annotation)throw Error(tr('주석이 없습니다.',null,'missing'));if(patch===null){this.data.annotations=this.data.annotations.filter(a=>a.id!==id);return;}if(patch.body!==undefined&&(typeof patch.body!=='string'||!patch.body.trim()||patch.body.length>20000)||patch.title!==undefined&&(typeof patch.title!=='string'||patch.title.length>200)||patch.body===undefined&&patch.title===undefined)throw Error(tr('주석 내용을 확인하세요.'));if(patch.body!==undefined)annotation.body=patch.body;if(patch.title!==undefined){if(patch.title.trim())annotation.title=patch.title.trim();else delete annotation.title;}annotation.updatedAt=new Date().toISOString();});}
  // 그림 설명 used to be memos (notes "<id>-메모-…" whose first line is "[그림 설명 · 파일 · N페이지 · 모델]",
  // with "#figure" for the box on the page). Each one whose file can be read becomes a figure annotation
  // and its memo keys are removed, once, in one transaction after a backup. A memo that cannot be placed
  // (paper or file gone) stays a memo.
  async migrateFigureMemos(){
    // The head an older figure memo starts with, in whichever language wrote it: [그림 설명 · file · N페이지 · model].
    const head=line=>{const read=readFigureMemoHead(line);return read?[line,String(read.page),read.model]:null;};
    const notes=this.data.notes,plan=[],hashes=new Map();
    for(const key of Object.keys(notes)){
      const m=key.match(/^(\d+)-메모(?:-([0-9a-z]+))?$/);if(!m)continue; // i18n:keep — stored memo keys
      const lines=String(notes[key]||'').split('\n'),first=lines.findIndex(l=>l.trim()),h=first>=0?head(lines[first].trim()):null;
      let place=null;try{place=JSON.parse(notes[key+'#figure']||'null');}catch{}
      if(!h&&!place)continue;
      const paper=this.data.papers.find(p=>p.id===Number(m[1])&&!p.trashedAt);if(!paper)continue;
      const attachment=paper.attachments.find(a=>a.id===place?.attachmentId&&!a.trashedAt)||paper.attachments.find(a=>a.id===paper.primaryAttachmentId&&!a.trashedAt);if(!attachment)continue;
      if(!hashes.has(attachment.id))hashes.set(attachment.id,await this.fingerprint(attachment.path,attachment.role==='translated'));
      const sourceHash=hashes.get(attachment.id),page=Number(place?.page)||Number(h?.[1]);if(!sourceHash||!Number.isInteger(page)||page<1||page>500)continue;
      const body=(h?lines.slice(first+1):lines).join('\n').trim();if(!body)continue;
      const stamp=m[2]?parseInt(m[2],36):NaN,r=place?.rect;
      plan.push({key,annotation:{id:crypto.randomUUID(),paperId:paper.id,attachmentId:attachment.id,page,quote:'',body:body.slice(0,20000),sourceHash,createdAt:Number.isFinite(stamp)&&stamp>1e12?new Date(stamp).toISOString():new Date().toISOString(),
        ...annotationExtra({kind:'figure',title:isAutoTitle(notes[key+'#title']?.trim()||'')?undefined:notes[key+'#title']?.trim(),model:h?.[2]?.trim(),figure:r&&{x:r.x,y:r.y,width:r.width,height:r.height}})}});
    }
    if(!plan.length)return 0;
    await this.backup(tr('그림 설명을 주석으로 옮기기 전'));
    await this.transaction(()=>{for(const {key,annotation} of plan){this.data.annotations.push(annotation);if(/-메모$/.test(key))this.data.notes[key]='';else delete this.data.notes[key];for(const s of ['#title','#figure','#pin'])delete this.data.notes[key+s];}}); // i18n:keep — stored memo keys
    return plan.length;
  }

  async resolveFile(id, kind) {
    const paper=this.paper(id);let relative,internal=false;
    if(kind==='original')relative=paper.original;
    else if(kind==='translated'){relative=paper.translated;internal=true;}
    else if(typeof kind==='string'&&kind.startsWith('attachment-')){const attachment=this.attachment(id,kind.slice(11));relative=attachment.path;internal=attachment.role==='translated';}
    else throw Error(tr('지원하지 않는 파일 종류입니다.'));
    if(!relative)throw Error(tr('파일이 없습니다.'));return this.resolvePath(relative,internal);
  }
  async snapshot({refresh=true}={}) {
    if(refresh){const before=JSON.stringify(this.data);try{if(await this.scan())await this.save();}catch(error){this.data=JSON.parse(before);this.data.papers.forEach(p=>this.preparePaper(p));throw error;}}
    // Most snapshots answer an edit (refresh:false); a PDF found readable in the
    // last ten seconds is not walked and opened again for each of them.
    const checked=this.fileChecks||=new Map(),now=Date.now();if(refresh)checked.clear();
    const present=async(paper,attachment)=>{const key=paper.id+'/'+attachment.id+'/'+attachment.path,hit=checked.get(key);if(hit&&now-hit<10000)return true;try{await this.resolveFile(paper.id,'attachment-'+attachment.id);checked.set(key,now);return true;}catch{checked.delete(key);return false;}};
    const papers = [], translations = new Set(await fs.readdir(path.join(this.root, VAULT_DIR)).catch(() => []));
    for (const paper of this.data.papers.filter(p=>!p.trashedAt)) {
      const files = {};
      const attachments=[];for(const attachment of paper.attachments.filter(a=>!a.trashedAt)){let file;if(await present(paper,attachment))file={name:attachment.name,url:`app://pdf/${this.data.id}/${paper.id}/attachment-${attachment.id}`};attachments.push({...attachment,path:undefined,folder:path.posix.dirname(attachment.path)==='.'?'':path.posix.dirname(attachment.path),fileName:path.posix.basename(attachment.path),file});}
      const original=attachments.find(a=>a.id===paper.primaryAttachmentId),translated=attachments.findLast(a=>a.role==='translated'&&!a.trashedAt);
      for(const [kind,attachment]of [['original',original],['translated',translated]])if(attachment?.file)files[kind]={name:attachment.fileName,url:`app://pdf/${this.data.id}/${paper.id}/${kind}`};
      const relative=this.relative(paper.original||'');
      // hasTranslation: an attachment was translated in the app (the library's "번역 있음").
      const hasTranslation = paper.attachments.some(a => !a.trashedAt && translations.has(translationFileName(paper.id, a)));
      papers.push({ ...paper,attachments, hasTranslation, original: undefined, translated: undefined, folder:path.posix.dirname(relative)==='.'?'':path.posix.dirname(relative),fileName:path.posix.basename(relative),storageKey: this.data.id, files });
    }
    return { id: this.data.id, name: path.basename(this.root), papers,folders:this.folders,trashAttachments:this.data.papers.filter(p=>!p.trashedAt).flatMap(p=>p.attachments.filter(a=>a.trashedAt).map(a=>({paperId:p.id,paperTitle:p.title,id:a.id,name:a.name}))),relinkCandidates:this.relinkCandidates||[],trash:this.data.papers.filter(p=>p.trashedAt).map(p=>({id:p.id,title:p.title,trashedAt:p.trashedAt})),collections:this.data.collections,savedSearches:this.data.savedSearches||[],tagColors:this.data.tagColors||{},glossary:this.data.glossary||[],translationRules:this.data.translationRules||'',aiRules:this.data.aiRules||'',syncConflicts:this.data.syncConflicts||[],annotations:this.data.annotations, notes: this.data.notes };
  }
  async importFiles(files, translatedId, targetFolder) {
    return this.importPDFs(files,{paperId:translatedId,role:translatedId?'translated':'original',folder:translatedId?'translations':targetFolder,internal:Boolean(translatedId)});
  }
  async importPDFs(files,{paperId=null,role='supplement',folder,internal=false}={}) {
    if(!['original','version','supplement','translated'].includes(role))throw Error(tr('첨부파일 종류를 확인하세요.'));
    if(paperId)this.paper(paperId);
    const relativeFolder=this.relative(folder===undefined?'papers':folder);
    if(folder===undefined||internal){try{await fs.mkdir(path.join(this.root,relativeFolder));}catch(error){if(error.code!=='EEXIST')throw error;}}
    const destination=await this.directory(relativeFolder,internal),results=[];
    // Each file is saved on its own, so earlier ones stay recorded if a later one fails;
    // a failure undoes only what that file added (no whole-library copy per file).
    for(const file of files){let target,created=false,undo=()=>{};
      try{
        if(!/\.pdf$/i.test(file))throw Error(tr('PDF 파일만 추가할 수 있습니다.'));await pdfFile(file);
        const name=path.basename(file),targetName=internal?`${paperId}-translated-${crypto.randomUUID()}.pdf`:name;
        const relative=relativeFolder?relativeFolder+'/'+targetName:targetName;
        let attachment, paper=paperId?this.paper(paperId):null;
        // An existing vault PDF can be attached without copying or moving it.
        const internalSource=path.resolve(file)===path.join(destination,targetName);
        const owner=this.data.papers.find(p=>p.attachments.some(a=>a.path===relative));
        if(internalSource){if(owner)throw Error(tr('이미 등록된 파일입니다. 자료 항목 병합을 사용하세요.'));}
        else {target=path.join(destination,targetName);await fs.copyFile(file,target,constants.COPYFILE_EXCL);created=true;await pdfFile(target);}
        const hash=crypto.createHash('sha256').update(await fs.readFile(internalSource?file:target)).digest('hex');
        if(paper){const owner=paper,primary=owner.primaryAttachmentId;attachment={id:crypto.randomUUID(),path:relative,name,role,sourceHash:hash,cacheOwnerId:paper.id};attachment.cacheKey=attachment.id;paper.attachments.push(attachment);if(!paper.primaryAttachmentId)paper.primaryAttachmentId=attachment.id;const added=attachment;undo=()=>{owner.attachments=owner.attachments.filter(a=>a!==added);owner.primaryAttachmentId=primary;};}
        else {paper=this.newPaper(name,relative,hash);this.data.papers.push(paper);attachment=paper.attachments[0];const added=paper;undo=()=>{this.data.papers=this.data.papers.filter(p=>p!==added);};}
        await this.save();results.push({name,ok:true,paperId:paper.id,attachmentId:attachment.id});
      }catch(error){undo();if(created)await fs.rm(target,{force:true});results.push({name:path.basename(file),ok:false,error:error.code==='EEXIST'?tr('같은 이름의 파일이 있습니다. 기존 파일을 유지합니다.'):error.message,...(error.code==='EEXIST'?{code:'APP_NAME_TAKEN'}:{})});}
    }
    return results;
  }
  // RIS, BibTeX or CSL JSON. An entry may name its PDFs (RIS L1, BibTeX file): with attachmentsFrom
  // (the folder of the exchange file) they are copied into the vault, into a folder named after
  // the exchange file, and attached to their item,
  // the first as its original. Without it only the bibliography comes in. The report says which
  // fields were not carried over and which PDFs could not be attached. Notes and ink never travel.
  async importBibliography(text,name='',{withReport=false,attachmentsFrom=null}={}){
    const {parseBibliography}=require('./bibliography.cjs');const {records,report}=parseBibliography(text,name);
    await this.backup(tr('서지정보 가져오기 전'));
    // An imported key already in use gets a letter (smith2020 → smith2020a), as BibTeX tools do.
    const unique=citekeyAllocator(new Set(this.data.papers.map(p=>p.citekey).filter(Boolean)));
    const links=records.map(entry=>entry.files||[]);
    const ids=await this.transaction(()=>records.map(({files,...entry})=>{if(entry.citekey)entry={...entry,citekey:unique(entry.citekey)};const id=this.newPaperId();const paper=this.preparePaper({id,...entry,status:'읽기 전',star:false,collectionIds:[],attachments:[],primaryAttachmentId:null});this.data.papers.push(paper);return id;})); // i18n:keep — stored values
    report.attached=0;report.attachmentFailures=[];
    if(attachmentsFrom){
      // The PDFs go into a folder named after the exchange file ("refs.bib" → "refs"), made when the
      // first PDF is found and used again if it is there; a name no folder may have falls back to "papers".
      let folder;const place=async()=>{
        if(folder!==undefined)return folder;
        let stem=String(name).replace(/\.[^.]+$/,'').replace(/[<>:"/\\|?*\x00-\x1f]/g,' ').replace(/\s+/g,' ').trim().replace(/[. ]+$/,'').slice(0,100).trim();
        try{this.folderName('',stem);const target=path.join(this.root,stem);try{await fs.mkdir(target);}catch(error){if(error.code!=='EEXIST'||!(await fs.lstat(target)).isDirectory())throw error;}await this.directory(stem);folder=stem;}
        catch{folder='papers';try{await fs.mkdir(path.join(this.root,folder));}catch(error){if(error.code!=='EEXIST')throw error;}}
        report.attachmentFolder=folder;return folder;
      };
      const fail=(index,link,reason)=>{if(report.attachmentFailures.length<50)report.attachmentFailures.push({title:String(records[index].title||'').slice(0,80),name:String(link).split(/[\\/]/).pop().slice(0,120),reason});};
      for(const [index,list] of links.entries())for(const link of list){
        const file=attachmentFile(link,attachmentsFrom,name);
        if(!file){fail(index,link,/^https?:/i.test(link)?tr('웹 주소'):tr('PDF가 아님'));continue;}
        try{await fs.access(file);}catch{fail(index,link,tr('파일 없음'));continue;}
        const first=!this.paper(ids[index]).attachments.length;
        let [result]=await this.importPDFs([file],{paperId:ids[index],role:first?'original':'supplement',folder:await place()}),temp=null;
        // Reference managers often give several PDFs one name ("Full Text PDF.pdf"): a copy under
        // a numbered name is attached instead.
        try{
          for(let n=2;!result.ok&&result.code==='APP_NAME_TAKEN'&&n<=20;n++){
            temp||=await fs.mkdtemp(path.join(require('node:os').tmpdir(),appName.id+'-import-'));
            const copy=path.join(temp,`${path.basename(file).replace(/\.pdf$/i,'')} (${n}).pdf`);await fs.copyFile(file,copy);
            [result]=await this.importPDFs([copy],{paperId:ids[index],role:first?'original':'supplement',folder:await place()});
          }
        }finally{if(temp)await fs.rm(temp,{recursive:true,force:true});}
        if(result.ok)report.attached++;else fail(index,link,result.error);
      }
    }
    return withReport?{ids,report}:ids;
  }
  async setPrimary(paperId,attachmentId){const attachment=this.attachment(paperId,attachmentId);if(attachment.role==='translated')throw Error(tr('번역 PDF는 대표 원문으로 지정할 수 없습니다.'));await this.transaction(()=>{this.paper(paperId).primaryAttachmentId=attachment.id;});}
  async createCollection(name,parentId=null){if(typeof name!=='string'||!name.trim()||name.length>100)throw Error(tr('컬렉션 이름을 입력하세요.'));name=name.trim();if(parentId!==null&&!this.data.collections.some(c=>c.id===parentId))throw Error(tr('상위 컬렉션이 없습니다.'));if(this.siblingName(parentId,name))throw Error(tr('같은 이름의 컬렉션이 있습니다.'));return this.transaction(()=>{const collection={id:crypto.randomUUID(),name,...(parentId?{parentId}:{})};this.data.collections.push(collection);return collection;});}
  // A saved search stores the library view, not its results.
  async saveSearch(search){
    const clean={name:String(search?.name||'').trim(),query:String(search?.query||''),filter:String(search?.filter||'전체'),collectionId:search?.collectionId||null,tag:search?.tag||null,fullText:search?.fullText===true}; // i18n:keep — stored filter value
    if(!clean.name||clean.name.length>100||clean.query.length>500||!['전체','읽기 전','읽는 중','완독','번역 있음'].includes(clean.filter)||clean.collectionId!==null&&!this.data.collections.some(c=>c.id===clean.collectionId)||clean.tag!==null&&(typeof clean.tag!=='string'||clean.tag.length>60))throw Error(tr('저장할 검색을 확인하세요.')); // i18n:keep — stored filter and status values
    return this.transaction(()=>{const list=this.data.savedSearches||=[];if(list.length>=200)throw Error(tr('저장 검색은 200개까지 만들 수 있습니다.'));const saved={id:crypto.randomUUID(),...clean};list.push(saved);return saved;});
  }
  // Required term renderings for translation, shared by the whole vault.
  // The vault's tags, one list for the vault: every tag on a paper, plus each
  // tag made or used here, which stays (with no papers) until it is deleted.
  // tagColors maps such a tag to its colour, #rrggbb or '' for none.
  tagNames(){return new Set([...Object.keys(this.data.tagColors||{}),...this.data.papers.flatMap(p=>p.tags)]);}
  registerTags(tags){const colors=this.data.tagColors||={};for(const t of tags)if(!Object.hasOwn(colors,t))colors[t]='';}
  async setTagColor(tag,color){
    const value=tagColor(color);if(!validTag(tag))throw Error(tr('태그 색을 확인하세요.'));
    await this.transaction(()=>{(this.data.tagColors||={})[tag]=value;});
  }
  async createTag(name,color=null){
    const tag=cleanTag(name),value=tagColor(color),same=[...this.tagNames()].find(t=>t.normalize('NFC')===tag);
    if(same!==undefined)throw Error(tr('이미 있는 태그입니다: {tag}',{tag:same}));
    await this.transaction(()=>{(this.data.tagColors||={})[tag]=value;});
  }
  // A new name that another tag already has merges the two: the papers of both keep one tag.
  async renameTag(from,name){
    const to=cleanTag(name),names=this.tagNames();if(!names.has(from))throw Error(tr('태그가 없습니다.'));
    const into=[...names].find(t=>t!==from&&t.normalize('NFC')===to),target=into??to;
    if(target===from)return {merged:false,papers:0};
    if(into!==undefined)await this.backup(tr('태그 병합 전'));
    return this.transaction(()=>{
      let papers=0;for(const p of this.data.papers)if(p.tags.includes(from)){p.tags=[...new Set(p.tags.map(t=>t===from?target:t))];papers++;}
      const colors=this.data.tagColors||={},color=Object.hasOwn(colors,from)?colors[from]:'';delete colors[from];if(!colors[target])colors[target]=color;
      for(const search of this.data.savedSearches||[])if(search.tag===from)search.tag=target;
      return {merged:into!==undefined,papers,name:target};
    });
  }
  // Deleting a tag takes it off every paper (papers, PDFs and notes stay) after a backup.
  async deleteTag(tag){
    if(!this.tagNames().has(tag))throw Error(tr('태그가 없습니다.'));
    await this.backup(tr('태그 삭제 전'));
    return this.transaction(()=>{let papers=0;for(const p of this.data.papers)if(p.tags.includes(tag)){p.tags=p.tags.filter(t=>t!==tag);papers++;}if(this.data.tagColors){delete this.data.tagColors[tag];if(!Object.keys(this.data.tagColors).length)delete this.data.tagColors;}return {papers};});
  }
  async setGlossary(list){
    if(!Array.isArray(list)||list.length>2000||list.some(e=>!e||typeof e.term!=='string'||!e.term.trim()||e.term.length>100||typeof e.translation!=='string'||!e.translation.trim()||e.translation.length>100||e.note!==undefined&&(typeof e.note!=='string'||e.note.length>300)))throw Error(tr('용어집 항목을 확인하세요.'));
    const seen=new Set();for(const e of list){const key=e.term.trim().toLowerCase();if(seen.has(key))throw Error(tr('용어 “{term}”가 두 번 들어 있습니다.',{term:e.term.trim()}));seen.add(key);}
    await this.transaction(()=>{this.data.glossary=list.map(e=>({term:e.term.trim(),translation:e.translation.trim(),...(e.note?.trim()?{note:e.note.trim()}:{})}));});
  }
  // The vault's translation requests (style, terms, format) sent with each translation as user preferences.
  async setTranslationRules(text){
    if(typeof text!=='string'||text.length>2000)throw Error(tr('번역 요청 사항은 2,000자까지 적을 수 있습니다.'));
    const clean=text.replace(/\r\n?/g,'\n').trim();if((this.data.translationRules||'')===clean)return;
    await this.transaction(()=>{if(clean)this.data.translationRules=clean;else delete this.data.translationRules;});
  }
  // The vault's requests for AI answers (memo AI, 선택 설명, 그림 설명, comparisons…), sent after the app's own instructions.
  async setAiRules(text){
    if(typeof text!=='string'||text.length>2000)throw Error(tr('AI 요청 사항은 2,000자까지 적을 수 있습니다.'));
    const clean=text.replace(/\r\n?/g,'\n').trim();if((this.data.aiRules||'')===clean)return;
    await this.transaction(()=>{if(clean)this.data.aiRules=clean;else delete this.data.aiRules;});
  }
  async deleteSearch(id){await this.transaction(()=>{const list=this.data.savedSearches||[];if(!list.some(s=>s.id===id))throw Error(tr('저장 검색이 없습니다.'));this.data.savedSearches=list.filter(s=>s.id!==id);});}
  // One transaction for every selected paper: all change or none do.
  async batchUpdate(ids,patch){
    if(!Array.isArray(ids)||!ids.length||ids.length>5000)throw Error(tr('편집할 자료를 선택하세요.'));
    const tag=t=>typeof t==='string'&&t.trim()&&t.length<=60;
    if(patch.addTags!==undefined&&(!Array.isArray(patch.addTags)||!patch.addTags.every(tag))||patch.removeTags!==undefined&&(!Array.isArray(patch.removeTags)||!patch.removeTags.every(tag))||patch.status!==undefined&&!['읽기 전','읽는 중','완독'].includes(patch.status)||patch.addCollection!==undefined&&!this.data.collections.some(c=>c.id===patch.addCollection)||patch.removeCollection!==undefined&&!this.data.collections.some(c=>c.id===patch.removeCollection)||patch.star!==undefined&&typeof patch.star!=='boolean'||patch.type!==undefined&&!Object.hasOwn(require('./bibliography.cjs').TYPES,patch.type))throw Error(tr('일괄 편집 내용을 확인하세요.')); // i18n:keep — stored status values
    await this.transaction(()=>{for(const id of ids){const paper=this.paper(id);
      if(patch.addTags)paper.tags=[...new Set([...paper.tags,...patch.addTags.map(t=>t.trim())])].slice(0,100);
      if(patch.addTags)this.registerTags(patch.addTags.map(t=>t.trim()).filter(validTag));
      if(patch.removeTags)paper.tags=paper.tags.filter(t=>!patch.removeTags.includes(t));
      if(patch.status)paper.status=patch.status;if(patch.star!==undefined)paper.star=patch.star;if(patch.type)paper.type=patch.type;
      if(patch.addCollection&&!paper.collectionIds.includes(patch.addCollection))paper.collectionIds.push(patch.addCollection);
      if(patch.removeCollection)paper.collectionIds=paper.collectionIds.filter(c=>c!==patch.removeCollection);}});
  }
  // rects (optional): the quoted text's line boxes on that page, in PDF points, so the page can mark them.
  // kind (optional): 'figure' (a 그림 설명, with figure: the box on the page as fractions {x,y,width,height})
  // or 'explain' (an AI 선택 설명); title and model are shown on the card. createdAt is kept when a record
  // moves here from elsewhere (a figure memo, an AI result).
  async addAnnotation(paperId,attachmentId,{page,quote='',body='',sourceHash,rects,kind,title,model,figure,createdAt}){
    this.attachment(paperId,attachmentId);if(!Number.isInteger(page)||page<1||page>500||typeof quote!=='string'||quote.length>10000||typeof body!=='string'||(!body.trim()&&!quote.trim())||body.length>20000)throw Error(tr('페이지와 주석 내용을 확인하세요.'));
    const extra=annotationExtra({kind,title,model,figure,createdAt});
    if(rects!==undefined&&!(Array.isArray(rects)&&rects.length>=1&&rects.length<=200&&rects.every(r=>Array.isArray(r)&&r.length===4&&r.every(v=>Number.isFinite(v)&&Math.abs(v)<=1e6))))throw Error(tr('주석 위치를 확인하세요.'));
    const attachment=this.attachment(paperId,attachmentId),hash=await this.fingerprint(attachment.path,attachment.role==='translated');if(!hash||hash!==sourceHash)throw Error(tr('원문 파일이 변경됐습니다. 다시 열고 주석을 작성하세요.'));
    return this.transaction(()=>{const annotation={id:crypto.randomUUID(),paperId:Number(paperId),attachmentId,page,quote,body,sourceHash:hash,...(rects?{rects:rects.map(r=>r.map(v=>Math.round(v*100)/100))}:{}),createdAt:new Date().toISOString(),...extra};this.data.annotations.push(annotation);return annotation;});
  }
  // Files about to be added whose content the vault already has (as an original, a version
  // or a supplement). Each is named with the item that has it, so the page can offer to
  // open that item instead of adding a second copy.
  async knownCopies(files){
    const byHash=new Map();
    for(const paper of this.data.papers)for(const a of paper.attachments){
      if(a.role==='translated'||!a.sourceHash)continue;const trashed=Boolean(paper.trashedAt||a.trashedAt);
      // An item in the library is named before one in the trash.
      if(!byHash.has(a.sourceHash)||(byHash.get(a.sourceHash).trashed&&!trashed))byHash.set(a.sourceHash,{paperId:paper.id,attachmentId:a.id,title:paper.title,trashed});
    }
    const found=[];
    for(const file of files){try{if(!/\.pdf$/i.test(file))continue;await pdfFile(file);const known=byHash.get(crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex'));if(known)found.push({file,name:path.basename(file),...known});}catch{/* a file that is not a readable PDF is no duplicate */}}
    return found;
  }
  // What the user made on one attachment: a translation, ink, corrections, AI results, annotations.
  // A translation in any language counts; the vault folder is the one this vault has (a peeked vault can still have an
  // earlier name's).
  async attachmentWork(paperId,attachment){
    const vault=path.join(this.root,this.vaultFolder||VAULT_DIR),exists=file=>fs.access(file).then(()=>true,()=>false),name=translationFileName(paperId,attachment),stem=name&&name.slice(0,-5);
    return (stem&&(await fs.readdir(vault).catch(()=>[])).some(n=>n===name||(n.startsWith(stem+'-lang-')&&n.endsWith('.json')&&!n.endsWith('.chunks.json'))))||(await fs.readdir(path.join(vault,'ink',attachment.id)).catch(()=>[])).length>0||await exists(path.join(vault,'corrections',attachment.id+'.json'))||await exists(path.join(vault,'ai',attachment.id+'.json'))||this.data.annotations.some(a=>a.attachmentId===attachment.id);
  }
  // Removes an item (or one attachment) for good: its PDF files leave the vault folder and
  // its notes, annotations, translation, ink, corrections and AI results are deleted.
  // discard(file) takes each PDF away (the app sends it to the computer's own trash).
  // A metadata backup is made first; the files themselves are not in that backup.
  // A folder is deleted with what it holds. Each item whose PDFs all sit under it goes whole (notes,
  // annotations, translation, ink and AI records with it); an item that also has a PDF elsewhere
  // loses only the attachments under the folder. The folder itself, with whatever else is in it,
  // is then handed to discardFolder. One backup is made first. PDFs that could not be removed are
  // named, and the folder then stays.
  async deleteFolder(folder,discard=file=>fs.rm(file,{force:true}),discardFolder=dir=>fs.rm(dir,{recursive:true,force:true})){
    folder=this.relative(folder);if(!folder)throw Error(tr('저장소 폴더 자체는 삭제할 수 없습니다.'));
    const directory=await this.directory(folder),inside=a=>a.role!=='translated'&&(this.relative(a.path)+'/').startsWith(folder+'/');
    const work=this.data.papers.map(paper=>{const own=paper.attachments.filter(a=>a.role!=='translated'),doomed=own.filter(inside);return doomed.length?{id:paper.id,ids:doomed.length===own.length?null:doomed.map(a=>a.id)}:null;}).filter(Boolean);
    await this.backup(tr('폴더 삭제 전'));
    const report={papers:0,attachments:0,files:0,failed:[],folderRemoved:false};
    for(const {id,ids} of work){const result=await this.deleteAttachments(id,ids,discard,{backup:false});if(ids===null)report.papers++;else report.attachments+=ids.length;report.files+=result.files;report.failed.push(...result.failed);}
    if(!report.failed.length){try{await discardFolder(directory);report.folderRemoved=!(await fs.access(directory).then(()=>true,()=>false));}catch{/* folderRemoved stays false and is told */}}
    await this.scan();await this.save();
    return report;
  }
  async deleteAttachments(paperId,attachmentIds,discard=file=>fs.rm(file,{force:true}),{backup=true}={}){
    const paper=this.paper(paperId),whole=attachmentIds===null,doomed=paper.attachments.filter(a=>whole||attachmentIds.includes(a.id));
    if(!whole&&doomed.length!==attachmentIds.length)throw Error(tr('첨부파일이 없습니다.'));
    if(backup)await this.backup(whole?tr('자료 삭제 전'):tr('첨부 삭제 전'));
    const vault=path.join(this.root,VAULT_DIR),files=[],extras=[];
    for(const a of doomed){
      const internal=a.role==='translated';
      try{files.push(await this.resolvePath(a.path,internal));}catch{/* a file already gone needs no removing */}
      const name=translationFileName(paper.id,a),shared=name&&this.data.papers.some(p=>p.attachments.some(b=>!doomed.includes(b)&&translationFileName(p.id,b)===name));
      if(name&&!shared)extras.push(path.join(vault,name),path.join(vault,name.replace(/\.json$/,'.chunks.json')));
      if(/^[-a-zA-Z0-9]+$/.test(a.id))extras.push(path.join(vault,'ink',a.id),path.join(vault,'corrections',a.id+'.json'),path.join(vault,'ai',a.id+'.json'));
    }
    // The record goes first: if a file cannot be removed afterwards it is only a leftover
    // on disk (listed in movedCopies so it is not registered again), never a broken item.
    await this.transaction(()=>{
      const ids=new Set(doomed.map(a=>a.id));
      this.data.annotations=this.data.annotations.filter(x=>!(x.paperId===paper.id&&(whole||ids.has(x.attachmentId))));
      for(const a of doomed)if(a.sourceHash)(this.data.movedCopies||=[]).push({path:a.path,hash:a.sourceHash});
      if(whole){this.data.papers=this.data.papers.filter(p=>p!==paper);for(const key of Object.keys(this.data.notes))if(key.startsWith(paper.id+'-'))delete this.data.notes[key];}
      else{paper.attachments=paper.attachments.filter(a=>!ids.has(a.id));if(ids.has(paper.primaryAttachmentId))paper.primaryAttachmentId=paper.attachments.find(a=>!a.trashedAt&&a.role!=='translated')?.id||paper.attachments.find(a=>!a.trashedAt)?.id||paper.attachments[0]?.id||null;}
    });
    const failed=[];
    for(const file of files){try{if(await fs.access(file).then(()=>true,()=>false))await discard(file);}catch(error){failed.push(path.basename(file));}}
    for(const extra of extras)await fs.rm(extra,{recursive:true,force:true}).catch(()=>{});
    // Gone from disk: nothing to keep out of the next scan.
    const gone=new Set();for(const a of doomed)if(!failed.includes(path.basename(a.path)))gone.add(a.path+'\n'+a.sourceHash);
    if(gone.size)await this.transaction(()=>{this.data.movedCopies=(this.data.movedCopies||[]).filter(m=>!gone.has(m.path+'\n'+m.hash));if(!this.data.movedCopies.length)delete this.data.movedCopies;});
    return {files:files.length-failed.length,failed};
  }
  async duplicates(){
    const candidates=[];const hashes=new Map();for(const paper of this.data.papers.filter(p=>!p.trashedAt))for(const attachment of paper.attachments.filter(a=>a.role!=='translated'&&!a.trashedAt)){const hash=attachment.sourceHash||await this.fingerprint(attachment.path);if(hash){if(!hashes.has(hash))hashes.set(hash,new Set());hashes.get(hash).add(paper.id);}}
    const pairs=new Map(),add=(a,b,reason)=>{if(a===b)return;const ids=[a,b].sort((x,y)=>x-y),key=ids.join(':');const pair=pairs.get(key)||{paperIds:ids,reasons:[]};if(!pair.reasons.includes(reason))pair.reasons.push(reason);pairs.set(key,pair);};
    for(const ids of hashes.values()){const list=[...ids];for(let i=0;i<list.length;i++)for(let j=i+1;j<list.length;j++)add(list[i],list[j],tr('동일 PDF'));}
    const dois=new Map();for(const p of this.data.papers.filter(p=>!p.trashedAt)){const doi=doiKey(p.doi);if(doi){for(const id of dois.get(doi)||[])add(id,p.id,tr('동일 DOI'));dois.set(doi,[...(dois.get(doi)||[]),p.id]);}}
    candidates.push(...pairs.values());return candidates;
  }
  // The duplicate candidates as groups: items joined by any chain of candidates (A–B and B–C make
  // one group of three). Each group names the item to keep, the one registered first.
  async duplicateGroups(){
    const parent=new Map(),find=id=>{while(parent.get(id)!==id){parent.set(id,parent.get(parent.get(id)));id=parent.get(id);}return id;};
    for(const {paperIds:[a,b]} of await this.duplicates()){for(const id of [a,b])if(!parent.has(id))parent.set(id,id);const x=find(a),y=find(b);if(x!==y)parent.set(Math.max(x,y),Math.min(x,y));}
    const groups=new Map();for(const id of parent.keys()){const root=find(id);if(!groups.has(root))groups.set(root,[]);groups.get(root).push(id);}
    const order=new Map(this.data.papers.map((p,i)=>[p.id,i]));
    return [...groups.values()].map(ids=>ids.sort((a,b)=>order.get(a)-order.get(b))).map(ids=>({target:ids[0],sources:ids.slice(1)}));
  }
  async mergePapers(targetId,sourceId,{backup=true}={}){
    if(Number(targetId)===Number(sourceId))throw Error(tr('서로 다른 자료를 선택하세요.'));this.paper(targetId);this.paper(sourceId);
    if(this.paper(targetId).trashedAt||this.paper(sourceId).trashedAt)throw Error(tr('휴지통의 자료는 되살린 뒤 병합하세요.'));
    if(backup)await this.backup(tr('자료 병합 전'));
    // The same PDF on both sides becomes one attachment. The copy that carries work (a
    // translation, ink, corrections, AI results, annotations) stays; when both carry work,
    // both stay and the caller is told. A copy left out goes to 제거한 첨부, where it can be
    // brought back or deleted; no file is touched here.
    const report={removed:0,keptBoth:0},drop=new Set();let primary=null;
    {
      const t=this.paper(targetId),s=this.paper(sourceId),live=p=>p.attachments.filter(a=>!a.trashedAt&&a.role!=='translated'&&a.sourceHash);
      for(const hash of new Set(live(s).map(a=>a.sourceHash))){
        const mine=live(t).filter(a=>a.sourceHash===hash);if(!mine.length)continue;
        const group=[...mine.map(a=>[t,a]),...live(s).filter(a=>a.sourceHash===hash).map(a=>[s,a])],worked=[];
        for(const [p,a] of group)if(await this.attachmentWork(p.id,a))worked.push(a);
        const keep=worked.length?worked:[mine.find(a=>a.id===t.primaryAttachmentId)||mine[0]];
        for(const [,a] of group)if(!keep.includes(a)){drop.add(a.id);report.removed++;}
        if(worked.length>1)report.keptBoth++;
        if(drop.has(t.primaryAttachmentId))primary=keep[0].id;
      }
    }
    this.lastMerge=report;
    return this.transaction(()=>this.mergeRecords(targetId,sourceId,{drop,primary}));
  }
  // The records of one item merged into another, in this.data only (no save, no backup: the caller's transaction does
  // that): attachments (those in drop go to 제거한 첨부, primary becomes the opened one), tags, collections, reading
  // status, empty bibliography fields, mergedFrom, notes and annotations. Returns the kept item's id.
  mergeRecords(targetId,sourceId,{drop=new Set(),primary=null}={}){
    {
      const target=this.paper(targetId),source=this.paper(sourceId);target.attachments.push(...source.attachments);target.tags=[...new Set([...target.tags,...source.tags])];target.collectionIds=[...new Set([...target.collectionIds,...source.collectionIds])];target.star=target.star||source.star;
      // The reading status follows whichever side is further along.
      {const order=['읽기 전','읽는 중','완독'];if(order.indexOf(source.status)>order.indexOf(target.status))target.status=source.status;} // i18n:keep — stored values
      {const now=new Date().toISOString();for(const a of target.attachments)if(drop.has(a.id))a.trashedAt=now;if(primary)target.primaryAttachmentId=primary;}
      // An item that had no PDF takes the one the other side opened; an item always names a file it still has.
      {const live=target.attachments.filter(a=>!a.trashedAt);if(live.length&&!live.some(a=>a.id===target.primaryAttachmentId))target.primaryAttachmentId=(live.find(a=>a.id===source.primaryAttachmentId)||live.find(a=>a.role!=='translated')||live[0]).id;}
      for(const field of ['authors','year','journal','doi','type','creators',...require('./bibliography.cjs').FIELDS.filter(f=>f!=='citekey')])if(source[field]!==undefined&&(!target[field]||['—','저자 미입력'].includes(target[field])||Array.isArray(target[field])&&!target[field].length))target[field]=source[field]; // i18n:keep — stored values
      target.mergedFrom=[...(target.mergedFrom||[]),{id:source.id,title:source.title,authors:source.authors,year:source.year,journal:source.journal,doi:source.doi,status:source.status},...(source.mergedFrom||[])];
      // Texts that meet are joined; a side key (#title, #figure, #pin: one value each) keeps the target's. A memo order
      // (#order, a list of memo keys) names the kept item's keys: the target's order first, then the other's keys not in it.
      const rename=key=>typeof key==='string'&&key.startsWith(source.id+'-')?target.id+key.slice(String(source.id).length):key;
      const order=text=>{try{const list=JSON.parse(text);return Array.isArray(list)?list.filter(k=>typeof k==='string'):null;}catch{return null;}};
      for(const [key,value]of Object.entries(this.data.notes)){if(key.startsWith(source.id+'-')){const next=rename(key);
        if(value&&next.endsWith('#order')&&order(value)){const mine=order(this.data.notes[next]||'')||[];this.data.notes[next]=JSON.stringify([...new Set([...mine,...order(value).map(rename)])]);}
        else if(value)this.data.notes[next]=!this.data.notes[next]?value:next.includes('#')?this.data.notes[next]:this.data.notes[next]+`\n\n[${source.title}]\n`+value;delete this.data.notes[key];}}
      for(const annotation of this.data.annotations)if(annotation.paperId===source.id)annotation.paperId=target.id;
      this.data.papers=this.data.papers.filter(p=>p!==source);return target.id;
    }
  }
  async update(id, patch) {
    const paper = this.data.papers.find(p => p.id === Number(id)); if (!paper) throw Error(tr('자료가 없습니다.'));
    await this.transaction(()=>{
      if(typeof patch.star==='boolean')paper.star=patch.star;
      if(['읽기 전','읽는 중','완독'].includes(patch.status))paper.status=patch.status; // i18n:keep — stored values
      if(Array.isArray(patch.tags)&&patch.tags.length<=100&&patch.tags.every(t=>typeof t==='string'&&t.length<=60)){paper.tags=patch.tags;this.registerTags(patch.tags.filter(validTag));}
      const authorsBefore=paper.authors;
      for(const key of ['title','authors','year','journal','doi'])if(Object.hasOwn(patch,key)){if(typeof patch[key]!=='string'||patch[key].length>1000||(key==='title'&&!patch[key].trim()))throw Error(tr('서지정보를 확인하세요.'));paper[key]=patch[key].trim();}
      const fields=require('./bibliography.cjs').bibliographyPatch(patch);
      if(fields.citekey&&fields.citekey!==paper.citekey&&this.data.papers.some(p=>p!==paper&&p.citekey===fields.citekey))throw Error(tr('다른 자료가 같은 인용 키를 사용합니다.'));
      // The first edit of the author list keeps the original author string.
      if(fields.creators&&authorsBefore&&authorsBefore!=='저자 미입력')paper.authorsOriginal ||= authorsBefore; // i18n:keep — stored value
      Object.assign(paper,fields);
      if(Object.hasOwn(patch,'collectionIds')){if(!Array.isArray(patch.collectionIds)||patch.collectionIds.some(id=>!this.data.collections.some(c=>c.id===id)))throw Error(tr('컬렉션을 확인하세요.'));paper.collectionIds=[...new Set(patch.collectionIds)];}
    });
  }

  // Pictures in notes (a figure a memo explains) live in .<id>/note-images, named by content.
  async saveNoteImage(dataUrl){
    const match=typeof dataUrl==='string'&&dataUrl.match(/^data:image\/png;base64,([A-Za-z0-9+/=]+)$/);if(!match)throw Error(tr('메모 그림은 PNG여야 합니다.'));
    const bytes=Buffer.from(match[1],'base64');if(bytes.length<8||bytes.length>8*1024*1024||bytes.readUInt32BE(0)!==0x89504e47)throw Error(tr('메모 그림을 확인하세요(8MB 이하 PNG).'));
    const name=crypto.createHash('sha256').update(bytes).digest('hex').slice(0,32)+'.png',directory=path.join(this.root,VAULT_DIR,'note-images');
    await vaultDirectory(this.root,directory);if(await fs.realpath(directory)!==directory)throw Error(tr('메모 그림 폴더의 심볼릭 링크는 지원하지 않습니다.'));
    const file=path.join(directory,name);try{await fs.writeFile(file,bytes,{flag:'wx'});}catch(error){if(error.code!=='EEXIST')throw error;}
    return name;
  }
  async noteImagePath(name){
    if(typeof name!=='string'||!/^[0-9a-f]{32}\.png$/.test(name))throw Error(tr('메모 그림을 찾을 수 없습니다.'));
    const directory=path.join(this.root,VAULT_DIR,'note-images'),file=path.join(directory,name);
    if(await fs.realpath(directory)!==directory||(await fs.lstat(file)).isSymbolicLink())throw Error(tr('메모 그림을 찾을 수 없습니다.'));
    return file;
  }
  async saveNotes(notes) {
    if (!notes || typeof notes !== 'object' || Array.isArray(notes) || Object.values(notes).some(v => typeof v !== 'string') || JSON.stringify(notes).length > 5e6) throw Error(tr('메모 형식을 확인하세요.'));
    await this.assertUnchanged();if(JSON.stringify(this.data.notes)===JSON.stringify(notes))return;
    await this.transaction(()=>{this.data.notes=notes;});
  }
}
// One promise chain per key: writes to the same document run in order, other
// documents in parallel. A key is forgotten once its chain is idle.
class KeyedQueue {
  constructor() { this.chains = new Map(); }
  serial(key, fn) { const task = (this.chains.get(key) || Promise.resolve()).then(fn), settled = task.catch(() => {}); this.chains.set(key, settled); settled.then(() => { if (this.chains.get(key) === settled) this.chains.delete(key); }); return task; }
  idle() { return Promise.all([...this.chains.values()]); }
}
module.exports = { expiredBackups, mergePendingNotes, Library, readJson, atomicJson, KeyedQueue, translationFileName, doiKey, citekeyAllocator, conflictSides, readAiRecords, keepConflictCopy, unreadableFile };
