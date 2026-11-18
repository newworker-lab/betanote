// The app had other names before its name now; both are in its name file (core/app-name.json: history, latest
// first). What an earlier version left on disk is taken over here, once, so nothing a user made is lost by the new
// name (<id> and <product> are the name file's, <old id> and <old product> each earlier name's):
//   - a vault's .<old id> folder                -> .<id>
//   - a sync folder's <old id>-sync folder       -> <id>-sync
//   - a full backup's <old id>-full-backup kind  -> read as it is, restored as .<id>
//   - the settings folder (userData) <old product> -> <product>
// An old folder is renamed (never copied) and never deleted or merged; when the new one is there
// already, the new one is used and the old one is left where it is. The old names are read from the
// name file only (here and in the page's one-time storage-key move).
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const {tr}=require('../core/i18n.js');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

// The earlier names, the one taken over first coming first.
// All of these are made from the app's name file (core/app-name.cjs): the current name and its history.
const appName = require('../core/app-name.cjs');
const VAULT_DIR = appName.vaultDir, OLD_VAULT_DIRS = [...appName.oldVaultDirs];
const SYNC_DIR = appName.syncDir, OLD_SYNC_DIRS = [...appName.oldSyncDirs];
const BACKUP_KIND = appName.backupKind, OLD_BACKUP_KINDS = [...appName.oldBackupKinds];
// The app that made each old vault folder, for telling the person which one to close.
const OLD_VAULT_APP = Object.fromEntries(appName.history.map(h => ['.' + h.id, h.name]));

const isDir = async dir => (await fs.stat(dir).catch(() => null))?.isDirectory() === true;
const alive = pid => { try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; } };
// When this computer last started, in seconds; a lease written before then belongs to a process that
// cannot be running, whatever now holds its pid (shared with vault-lock.cjs).
const bootTime = () => Math.round(Date.now() / 1000 - os.uptime());
// The first of the old names a folder holds.
async function oldIn(folder, names) { for (const name of names) if (await isDir(path.join(folder, name))) return name; return null; }
// Windows lets a cloud drive or an antivirus hold a folder for a moment (EPERM, EACCES, EBUSY): the rename
// is tried again for about two seconds. A rename still refused leaves the old folder as it was and says
// so; one that lost a race to another window that renamed it first is no failure.
const HELD = ['EPERM', 'EACCES', 'EBUSY'], RETRY_MS = [100, 200, 400, 600, 800];
const pause = ms => new Promise(done => setTimeout(done, ms));
async function renameOrSay(folder, old, name, say) {
  const next = path.join(folder, name);
  for (let attempt = 0; ; attempt++) {
    try { await fs.rename(path.join(folder, old), next); return true; }
    catch (error) {
      if (error.code === 'ENOENT' && await isDir(next)) return false;
      if (HELD.includes(error.code) && attempt < RETRY_MS.length) { await pause(RETRY_MS[attempt]); continue; }
      throw Object.assign(Error(say({ folder: old, next: name })), { code: 'APP_RENAME_FAILED', cause: error });
    }
  }
}
const vaultRenameFailed = values => tr('저장소 폴더 이름을 바꾸지 못했습니다({folder} → {next}). 이 폴더를 쓰는 다른 프로그램(동기화·백신)을 잠시 멈춘 뒤 다시 여세요.', values);
const syncRenameFailed = values => tr('동기화 폴더 이름을 바꾸지 못했습니다({folder} → {next}). 이 폴더를 쓰는 다른 프로그램(클라우드 동기화·백신)을 잠시 멈춘 뒤 다시 동기화하세요.', values);

// Which earlier vault folder to take over: one holding library.json before one that does not (a link
// among them is chosen, then refused, rather than an empty folder taken), a real folder before a link,
// then the later app's folder before the earlier one's. Told by the folder entry itself, so a link is seen as one.
async function oldVaultIn(root) {
  const there = [];
  for (const name of OLD_VAULT_DIRS) {
    const entry = await fs.lstat(path.join(root, name)).catch(() => null); if (!entry || !(entry.isDirectory() || entry.isSymbolicLink())) continue;
    const records = (await fs.stat(path.join(root, name, 'library.json')).catch(() => null))?.isFile() === true;
    there.push({ name, rank: (records ? 0 : 2) + (entry.isSymbolicLink() ? 1 : 0) });
  }
  return there.sort((a, b) => a.rank - b.rank)[0]?.name || null;
}
// An earlier app's lease that still holds: the vault is open there. A lease from another computer
// holds until it is removed; on this computer one holds while its process runs, whatever the boot time
// says (a clock that jumped would otherwise move the folder from under a running app; a pid used again
// after a restart is released by deleting the lease, which the message names), and one cut off while
// being written holds for a minute.
async function heldLease(old, name) {
  const lock = path.join(old, 'writer.lock'), text = await fs.readFile(lock, 'utf8').catch(() => null);
  if (text === null) return { text };
  const where = `${name}/writer.lock`;
  let owner = null; try { owner = JSON.parse(text); } catch {}
  const object = owner && typeof owner === 'object' && !Array.isArray(owner);
  if (object && owner.host && owner.host !== os.hostname()) throw Error(tr('이 저장소는 다른 컴퓨터({host})의 이전 버전 앱에서 열려 있습니다. 그 컴퓨터에서 앱을 닫은 뒤 다시 여세요. 이미 닫혀 있다면 저장소의 {lock} 파일을 지우고 다시 여세요.',{host:String(owner.host),lock:where}));
  // Not a lease this app could have written (half written, or a pid that is not a number): held for a minute, then left over.
  if (!object || !Number.isSafeInteger(owner.pid) || owner.pid <= 0) {
    const age = Date.now() - ((await fs.stat(lock).catch(() => null))?.mtimeMs ?? 0);
    if (age < 60000) throw Error(tr('저장소 잠금 파일을 확인할 수 없습니다. 다른 앱이 종료됐는지 확인하세요.'));
    return { text };
  }
  if (owner.pid !== process.pid && alive(owner.pid)) throw Error(tr('이 저장소는 이전 버전 앱({name})에서 열려 있습니다. 그 앱을 닫은 뒤 다시 여세요. 이미 닫혀 있다면 저장소의 {lock} 파일을 지우고 다시 여세요.',{name:OLD_VAULT_APP[name],lock:where}));
  return { text };
}

// A vault made by an earlier app keeps everything in .<old id>. It is renamed in place
// (no copy, nothing rewritten). An earlier app that still has the vault open would write into a
// folder that is gone, so the rename waits until that app is closed.
async function adoptVaultFolder(root) {
  if (await isDir(path.join(root, VAULT_DIR))) return false;
  const name = await oldVaultIn(root); if (!name) return false;
  const old = path.join(root, name);
  // Taking over a link would leave the new folder pointing elsewhere: refused as for the vault's own folder.
  if ((await fs.lstat(old)).isSymbolicLink()) throw Error(tr('{folder} 폴더의 심볼릭 링크는 지원하지 않습니다.',{folder:name}));
  const { text } = await heldLease(old, name);
  const moved = await renameOrSay(root, name, VAULT_DIR, vaultRenameFailed);
  // The earlier app's lease went with the folder; it was stale (checked above), so it goes, unless
  // another window has taken the vault in the meantime.
  if (moved && text !== null) { const lock = path.join(root, VAULT_DIR, 'writer.lock'); if (await fs.readFile(lock, 'utf8').catch(() => null) === text) await fs.unlink(lock).catch(() => {}); }
  return moved;
}
// Old vault folders beside the new one (an earlier app opened the vault again after it was taken over,
// or one was copied in): the new one is used, and the person is told once when an old one holds items
// (not counting those in the trash), which the new app does not see. Those folders and their items.
async function oldVaultBeside(root) {
  if (!(await isDir(path.join(root, VAULT_DIR)))) return null;
  const folders = []; let papers = 0;
  for (const folder of OLD_VAULT_DIRS) {
    let data = null; try { data = JSON.parse(await fs.readFile(path.join(root, folder, 'library.json'), 'utf8')); } catch {}
    const live = Array.isArray(data?.papers) ? data.papers.filter(p => p && !p.trashedAt).length : 0;
    if (live) { folders.push(folder); papers += live; }
  }
  return folders.length ? { folders, papers } : null;
}
// The shared folder of a vault synced between computers. Every computer must use the new app
// from here on: an earlier app looks for its own name and would start an empty one.
async function adoptSyncFolder(folder) {
  if (await isDir(path.join(folder, SYNC_DIR))) return false;
  const name = await oldIn(folder, OLD_SYNC_DIRS);
  return name ? renameOrSay(folder, name, SYNC_DIR, syncRenameFailed) : false;
}
// Old sync folders beside the new one holding a vault (a computer still on an earlier app writes there).
async function oldSyncBeside(folder) {
  if (!(await isDir(path.join(folder, SYNC_DIR)))) return null;
  const found = [];
  for (const name of OLD_SYNC_DIRS) {
    const entries = await fs.readdir(path.join(folder, name), { withFileTypes: true }).catch(() => []);
    if (entries.some(entry => entry.isDirectory() && /^[-a-f0-9]{36}$/.test(entry.name))) found.push(name);
  }
  return found.length ? found : null;
}
// Which of the names a folder holds for its sync data (the new one once it exists).
async function syncDirIn(folder) {
  if (await isDir(path.join(folder, SYNC_DIR))) return SYNC_DIR;
  return oldIn(folder, OLD_SYNC_DIRS);
}
const isSyncDirName = name => [SYNC_DIR, ...OLD_SYNC_DIRS].includes(String(name).toLowerCase());
// The vault's own folder under any of its names (kept out of reach of paths given from outside).
const isVaultDirName = name => [VAULT_DIR, ...OLD_VAULT_DIRS].includes(String(name).toLowerCase());
// Whether a folder is a vault under any of the names (for finding vaults in a cloud folder).
async function isVaultFolder(dir) {
  for (const name of [VAULT_DIR, ...OLD_VAULT_DIRS]) if ((await fs.stat(path.join(dir, name, 'library.json')).catch(() => null))?.isFile()) return true;
  return false;
}
// A full backup written by an earlier app has its own kind and lists its files under its folder name.
const isBackupKind = kind => [BACKUP_KIND, ...OLD_BACKUP_KINDS].includes(kind);
const adoptBackupPath = relative => { const old = OLD_VAULT_DIRS.find(name => relative.startsWith(name + '/')); return old ? VAULT_DIR + relative.slice(old.length) : relative; };

// Settings, API keys, the ChatGPT session, search and OCR indexes, themes and the page's own
// storage live in userData, whose place follows the app's product name (<product>; <product>-dev for a
// development run). Before anything reads it, an earlier app's folder (the latest earlier name's first, with
// the same suffix) becomes the new one. Run synchronously, first thing at start-up, before the
// single-instance lock, and only for the default location: a folder given on the command line is
// left alone. The rule is kept simple so that nothing in use is ever replaced:
//   - The new folder is in use once it holds anything the app makes (APP_ITEMS). One in use is never
//     replaced: not when an earlier app's folder comes back, not when settings.json alone is removed.
//   - Not in use (absent, or holding only what Chromium made before the app's code ran) and an earlier
//     app's folder with settings.json there, not running: what the new folder holds is moved aside,
//     the old folder is renamed into its place whole, and what was moved aside is removed (a removal
//     that fails is left for later; the takeover is done). Only where the rename cannot be done (another
//     drive) is the old folder copied whole beside it, checked, and put in place in one rename.
//   - Any error while a takeover is needed is a failure (adoptUserData.failed = { name, reason }: space,
//     busy or other): what was moved aside is put back and the app quits without a window, so it makes
//     nothing in the new folder and the next start tries again. Nothing of the old folder changes until
//     it is renamed.
//   - One run at a time: a lock file in appData. A run that finds it held does nothing (adoptUserData.busy)
//     and the app quits quietly. Copies a run left are removed; folders it moved aside are removed only when
//     they hold nothing the app makes (otherwise put back if the new folder is gone, else kept).
const OLD_APP_NAMES = [...appName.oldProducts];
// What the app makes in its settings folder (desktop/main.cjs, chatgpt.cjs, api-llm.cjs, themes.cjs,
// fulltext.cjs, ocr.cjs; the page's storage). Logs are left out: a run that only failed may have written one.
const APP_ITEMS = ['settings.json', 'llm-keys.json', 'chatgpt-session.json', 'chatgpt-host.json', 'themes', 'snippets', 'fulltext', 'ocr', 'Local Storage', 'IndexedDB'];
const present = file => fsSync.lstatSync(file, { throwIfNoEntry: false }) !== undefined;
const inUse = dir => APP_ITEMS.some(name => present(path.join(dir, name)));
const pauseSync = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
// A rename tried again while another program holds the folder for a moment (as renameOrSay).
function renameSyncHeld(from, to) {
  for (let attempt = 0; ; attempt++) {
    try { return fsSync.renameSync(from, to); }
    catch (error) { if (HELD.includes(error.code) && attempt < RETRY_MS.length) { pauseSync(RETRY_MS[attempt]); continue; } throw error; }
  }
}
// Whether an earlier app runs from that folder: 'yes', 'no', or the link left in doubt ('maybe'); both 'yes' and
// 'maybe' count as running and are told with the link's path (so the person can remove one that is stale). As
// Chromium judges it: a SingletonLock (host-pid) of another host is in doubt, whatever else is there (a settings folder
// shared between computers, its socket on that computer); on this host the socket the SingletonSocket link points to
// answers while the app runs (refused or missing: gone), and without a socket a live pid counts as running.
const SOCKET_CHECK = "const s=require('net').connect(process.argv[1]);s.on('connect',()=>process.exit(10));s.on('error',e=>process.exit(['ECONNREFUSED','ENOENT','ENOTSOCK'].includes(e.code)?11:12));setTimeout(()=>process.exit(12),1500)";
function runningFrom(dir) {
  const link = path.join(dir, 'SingletonLock');
  let target; try { target = fsSync.readlinkSync(link); } catch (error) { return error.code === 'ENOENT' ? 'no' : 'maybe'; }
  const [, host, pid] = /^(.*)-(\d+)$/.exec(target) || [];
  if (host !== os.hostname()) return 'maybe';
  const socketLink = path.join(dir, 'SingletonSocket');
  if (present(socketLink)) {
    // The socket itself (in a temporary folder), not the link in the settings folder: its path may be too long to connect to.
    let socket = socketLink; try { socket = path.resolve(dir, fsSync.readlinkSync(socketLink)); } catch { /* not a link: the name itself is the socket */ }
    const { NODE_OPTIONS, ...env } = process.env;
    const answer = require('node:child_process').spawnSync(process.execPath, ['-e', SOCKET_CHECK, socket], { env: { ...env, ELECTRON_RUN_AS_NODE: '1' }, timeout: 4000, stdio: 'ignore' });
    return answer.status === 10 ? 'yes' : answer.status === 11 ? 'no' : 'maybe';
  }
  return alive(Number(pid)) ? 'yes' : 'no';
}
// This start of the computer, where the system tells it (Linux); elsewhere none, and the lock is judged by its pid alone.
function bootId() { try { return fsSync.readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim() || null; } catch { return null; } }
// The lock of a takeover, or null when another run holds it. A lock names its process, this start of the computer
// (bootId, where known) and a value of its own: it is held while that process runs in this start (one of this run's own
// pid, or of another start, is left over), and one unreadable or not of this app's making is held for a minute. A
// left-over lock is removed only under a short breaker lock, and only if it still reads exactly as when it was judged
// left over, so a lock another run has just made is never removed; a breaker left by a run that is gone is removed the
// same way. Whether a held lock has been there over a minute is kept in adoptUserData.stuckLock, so a start blocked by
// it says so instead of ending without a word.
function takeoverLock(file) {
  const boot = bootId(), mine = JSON.stringify({ pid: process.pid, host: os.hostname(), ...(boot ? { boot } : {}), nonce: crypto.randomUUID() }), breaker = `${file}.break`;
  const age = target => Date.now() - (fsSync.statSync(target, { throwIfNoEntry: false })?.mtimeMs ?? Date.now());
  const read = target => { try { return fsSync.readFileSync(target, 'utf8'); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } };
  const leftOver = text => {
    let owner = null; try { owner = JSON.parse(text); } catch {}
    const known = owner && typeof owner === 'object' && !Array.isArray(owner) && Number.isSafeInteger(owner.pid) && owner.pid > 0 && owner.host === os.hostname();
    if (!known) return age(file) >= 60000;
    return (typeof owner.boot === 'string' && boot !== null && owner.boot !== boot) || owner.pid === process.pid || !alive(owner.pid);
  };
  // A file made whole or not at all; one that cannot be written leaves nothing behind.
  const make = (target, text) => {
    const fd = fsSync.openSync(target, 'wx');
    try { fsSync.writeSync(fd, text); fsSync.closeSync(fd); }
    catch (error) { try { fsSync.closeSync(fd); } catch { /* the error that follows is the one to tell */ } fsSync.rmSync(target, { force: true }); throw error; }
  };
  const removeIf = (target, text) => { if (read(target) === text) fsSync.rmSync(target, { force: true }); };
  for (let attempt = 0; attempt < 50; attempt++) {
    try { make(file, mine); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const text = read(file); if (text === null) continue;
      if (!leftOver(text)) { if (age(file) > 60000) adoptUserData.stuckLock = file; return null; }
      const ticket = crypto.randomUUID();
      try { make(breaker, ticket); }
      catch (breakError) {
        if (breakError.code !== 'EEXIST') throw breakError;
        const held = read(breaker); if (held !== null && age(breaker) > 10000) removeIf(breaker, held);
        pauseSync(20); continue;
      }
      try { removeIf(file, text); } finally { removeIf(breaker, ticket); }
      continue;
    }
    if (read(file) !== mine) return null;
    return () => { try { removeIf(file, mine); } catch { /* a lock left behind is reclaimed by its dead pid */ } };
  }
  return null;
}
const reasonOf = error => error?.code === 'ENOSPC' || error?.code === 'EDQUOT' ? 'space' : HELD.includes(error?.code) ? 'busy' : 'other';
function adoptUserData(app, suffix = '') {
  adoptUserData.failed = null; adoptUserData.busy = false; adoptUserData.stuckLock = null;
  let appData, next, base;
  try {
    // The folder in use, not the switches given: Chromium ignores some forms of --user-data-dir (with a space).
    appData = app.getPath('appData'); const current = app.getPath('userData');
    if (path.dirname(current) !== appData || path.basename(current) !== app.getName()) return false;
    next = current + suffix; base = path.basename(next);
  } catch { return false; }
  const oldName = () => OLD_APP_NAMES.find(n => present(path.join(appData, n + suffix, 'settings.json')));
  const leftovers = () => { try { return fsSync.readdirSync(appData).filter(n => n.startsWith(`.${base}-from-`) || n.startsWith(`.${base}-before-`)); } catch { return []; } };
  // Copies are removed; a folder moved aside is removed only when it holds nothing the app makes, else put back
  // where the new folder is gone, else kept.
  // A folder moved aside that holds what the app makes goes back where the new folder is not in use (Electron makes an
  // empty one before the app's code runs): that one is moved aside in turn (or removed when empty). Removals that fail
  // are let be; a folder that cannot be put back is an error (the takeover must not go on over it).
  const tidy = () => {
    for (const n of leftovers()) {
      const dir = path.join(appData, n);
      if (n.startsWith(`.${base}-from-`) || !inUse(dir)) { try { fsSync.rmSync(dir, { recursive: true, force: true }); } catch { /* a leftover that stays is tried again at the next start */ } continue; }
      if (inUse(next)) continue;
      try {
        if (present(next)) { try { fsSync.rmdirSync(next); } catch { renameSyncHeld(next, path.join(appData, `.${base}-before-${process.pid}-${crypto.randomUUID().slice(0, 8)}`)); } }
        renameSyncHeld(dir, next);
      } catch (error) { throw Object.assign(error, { restore: dir }); }
    }
  };
  // A folder that could not be put back is told with its place, whatever else this start was doing: a start that went on
  // would make the new folder in use, and the folder moved aside would never come back.
  const restoreFailed = error => { adoptUserData.failed = { name: oldName() || null, reason: 'restore', aside: error.restore, folder: next }; return false; };
  const lockFile = path.join(appData, `.${base}-adopt.lock`);
  let name = oldName();
  if (!name || inUse(next)) {
    // No takeover to do: leftovers are tidied when no other run is at it, and any error there is let be.
    if (leftovers().length) { let release = null; try { release = takeoverLock(lockFile); if (release) tidy(); } catch (error) { if (error.restore) return restoreFailed(error); } finally { release?.(); } }
    return false;
  }
  let release = null, aside = null;
  try {
    release = takeoverLock(lockFile);
    if (!release) { adoptUserData.busy = true; return false; }
    // Looked at again under the lock: another run may have done it in the meantime.
    name = oldName();
    if (!name || inUse(next)) { try { tidy(); } catch (error) { if (error.restore) return restoreFailed(error); } return false; }
    // A folder put back by tidy() makes the new one in use: looked at once more.
    tidy();
    name = oldName();
    if (!name || inUse(next)) return false;
    const old = path.join(appData, name + suffix), running = runningFrom(old);
    if (running !== 'no') throw Object.assign(Error('the earlier app is running'), { code: 'APP_EARLIER_APP_RUNNING', lock: path.join(old, 'SingletonLock') });
    if (present(next)) { try { fsSync.rmdirSync(next); } catch { aside = path.join(appData, `.${base}-before-${process.pid}`); renameSyncHeld(next, aside); } }
    try { renameSyncHeld(old, next); }
    catch (error) {
      if (HELD.includes(error.code)) throw error; // a folder another program holds is not copied either
      console.error('이전 설정 폴더 이름을 바꾸지 못해 복사합니다:', error.message); // i18n:keep — a line in the log, not on screen
      const temp = path.join(appData, `.${base}-from-${process.pid}`);
      try {
        fsSync.cpSync(old, temp, { recursive: true, verbatimSymlinks: true });
        // Every entry copied, a link as a link (Chromium's Singleton* links point nowhere once the app is closed).
        const missing = fsSync.readdirSync(old).filter(n => !present(path.join(temp, n)));
        if (missing.length) throw Error('not copied: ' + missing.join(', '));
        renameSyncHeld(temp, next);
      } catch (copyError) { try { fsSync.rmSync(temp, { recursive: true, force: true }); } catch { /* the copy error that follows is the one to tell */ } throw copyError; }
    }
    // What was moved aside goes only if it holds nothing the app makes (it may have become so since).
    if (aside && !inUse(aside)) { try { fsSync.rmSync(aside, { recursive: true, force: true }); } catch { /* a leftover that stays is tried again at the next start */ } }
    return true;
  } catch (error) {
    console.error('이전 설정 폴더를 옮기지 못했습니다:', error.message); // i18n:keep — a line in the log, not on screen
    if (aside && present(aside) && !present(next)) { try { renameSyncHeld(aside, next); } catch { /* the failure is told just below (restoreFailed or the notice) */ } }
    if (error.restore) return restoreFailed(error);
    adoptUserData.failed = { name, reason: error.code === 'APP_EARLIER_APP_RUNNING' ? 'running' : reasonOf(error), ...(error.lock ? { lock: error.lock } : {}) };
    return false;
  } finally { release?.(); }
}
adoptUserData.failed = null; adoptUserData.busy = false; adoptUserData.stuckLock = null;

module.exports = { OLD_APP_NAMES, bootTime, VAULT_DIR, SYNC_DIR, BACKUP_KIND, OLD_VAULT_DIRS, OLD_SYNC_DIRS, OLD_BACKUP_KINDS, adoptVaultFolder, oldVaultBeside, adoptSyncFolder, oldSyncBeside, syncDirIn, isSyncDirName, isVaultDirName, isVaultFolder, isBackupKind, adoptBackupPath, adoptUserData };
