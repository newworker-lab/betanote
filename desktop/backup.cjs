// Full vault backup: every attached PDF plus the vault's records, ink,
// translation bases and caches, with a manifest of SHA-256 hashes. The
// manifest is written last, so a folder without one is an unfinished backup.
const fs = require('node:fs/promises');
const {tr}=require('../core/i18n.js');
const path = require('node:path');
const { VAULT_DIR, BACKUP_KIND, adoptBackupPath, isBackupKind } = require('./legacy.cjs');
const crypto = require('node:crypto');
const { constants } = require('node:fs');
const { atomicJson, readJson } = require('./storage.cjs');

const VERSION = 1;
const sha = async file => crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex');
// Vault records worth keeping. Per-device data (locks, temp files) and the
// metadata snapshots (already covered by library.json) stay out.
function keepInternal(relative) {
  if (!relative.startsWith(VAULT_DIR + '/')) return false;
  const inner = relative.slice(VAULT_DIR.length + 1);
  return inner === 'library.json' || /^translation-[-a-zA-Z0-9]+(\.chunks)?\.json$/.test(inner) || /^(ai|corrections)\/[-a-zA-Z0-9]+\.json$/.test(inner) || /^notebooks\/([-a-f0-9]{36}\.json|assets\/[a-f0-9]{64}\.png)$/.test(inner) || /^ink\/[-a-zA-Z0-9]+\/(original|t-[a-f0-9]{24}|base-[a-f0-9]{24})\.(json|log)$/.test(inner);
}
async function walk(root, relative = '') {
  const out = [];
  for (const entry of await fs.readdir(path.join(root, relative), { withFileTypes: true })) {
    const child = relative ? relative + '/' + entry.name : entry.name;
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) out.push(...await walk(root, child)); else if (entry.isFile()) out.push(child);
  }
  return out;
}
async function createFullBackup(library, parent) {
  await library.ink?.idle(); await library.notebooks?.idle();
  await library.assertUnchanged();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-'), name = tr('{vault}-전체백업-{stamp}',{vault:path.basename(library.root),stamp});
  const folder = path.join(parent, name), temp = folder + '.partial';
  await fs.mkdir(temp);
  try {
    const files = new Set();
    for (const paper of library.data.papers) for (const attachment of paper.attachments) {
      // resolvePath, not resolveFile: an attachment in the trash is still restorable, so its PDF is kept too.
      try { const file = await library.resolvePath(attachment.path, attachment.role === 'translated'); files.add(path.relative(library.root, file).split(path.sep).join('/')); } catch { /* A missing PDF is listed below. */ }
    }
    for (const relative of await walk(path.join(library.root, VAULT_DIR), '')) if (keepInternal(VAULT_DIR + '/' + relative)) files.add(VAULT_DIR + '/' + relative);
    const manifest = { version: VERSION, kind: BACKUP_KIND, createdAt: new Date().toISOString(), vaultId: library.data.id, vaultName: path.basename(library.root), files: [], missing: [] };
    for (const paper of library.data.papers) for (const attachment of paper.attachments) if (!files.has(attachment.path)) manifest.missing.push({ paperId: paper.id, attachmentId: attachment.id, path: attachment.path });
    for (const relative of [...files].sort()) {
      const source = path.join(library.root, ...relative.split('/')), target = path.join(temp, 'vault', ...relative.split('/'));
      await fs.mkdir(path.dirname(target), { recursive: true }); await fs.copyFile(source, target, constants.COPYFILE_EXCL);
      const [hash, info] = await Promise.all([sha(target), fs.stat(target)]);
      manifest.files.push({ path: relative, sha256: hash, size: info.size });
    }
    // The vault must not have changed while it was being copied.
    if (await library.diskHash() !== library.diskDigest) throw Error(tr('백업 중 저장소가 변경됐습니다. 다시 시도하세요.'));
    await atomicJson(path.join(temp, 'manifest.json'), manifest);
    await fs.rename(temp, folder);
    return { folder, files: manifest.files.length, bytes: manifest.files.reduce((n, f) => n + f.size, 0), missing: manifest.missing.length };
  } catch (error) { await fs.rm(temp, { recursive: true, force: true }); throw error; }
}
function safeRelative(value) {
  return typeof value === 'string' && value.length <= 1000 && !value.includes('\0') && !value.startsWith('/') && !/^[a-z]:/i.test(value) && !value.includes('\\') && value.split('/').every(part => part && part !== '.' && part !== '..');
}
// Every listed file must exist with its recorded hash; nothing else is read.
async function verifyBackup(folder) {
  const manifest = await readJson(path.join(folder, 'manifest.json'), null);
  // A backup made under an earlier name of the app is still a backup (legacy.cjs).
  if (!isBackupKind(manifest?.kind) || manifest.version !== VERSION || !Array.isArray(manifest.files)) throw Error(tr('{app} 전체 백업 폴더가 아닙니다.'));
  if (!manifest.files.some(f => adoptBackupPath(f.path) === VAULT_DIR + '/library.json')) throw Error(tr('백업에 저장소 기록이 없습니다.'));
  // Two listed files that land on one place in the new layout (copies of it under both of an earlier app's folder names) make no backup.
  const places = manifest.files.map(f => typeof f?.path === 'string' ? adoptBackupPath(f.path) : f?.path);
  if (new Set(places).size !== places.length) throw Error(tr('백업 목록이 손상됐습니다.'));
  const problems = [];
  for (const file of manifest.files) {
    if (!safeRelative(file.path) || !/^[a-f0-9]{64}$/.test(file.sha256)) throw Error(tr('백업 목록이 손상됐습니다.'));
    const source = path.join(folder, 'vault', ...file.path.split('/'));
    try { if ((await fs.lstat(source)).isSymbolicLink() || await sha(source) !== file.sha256) problems.push(file.path); } catch { problems.push(file.path); }
  }
  if (problems.length) throw Error(tr('백업 파일 {n}개가 없거나 손상됐습니다: {list}',{n:problems.length,list:problems.slice(0, 5).join(', ')}));
  return manifest;
}
// Restores into an empty folder as a separate vault; the source vault is untouched.
// `verified` is the manifest verifyBackup just returned (the restore dialog
// checks first); each copy is still hashed against it, so the backup is not
// read a third time. A failed restore leaves the chosen folder empty again.
async function restoreFullBackup(folder, target, verified = null) {
  const manifest = verified || await verifyBackup(folder);
  if ((await fs.readdir(target)).length) throw Error(tr('비어 있는 폴더를 선택하세요.'));
  try {
    // Written straight into the new layout: a backup an earlier app made lists its files under its own
    // folder name (legacy.cjs adoptBackupPath), so no rename is left to fail after the copy.
    for (const file of manifest.files) {
      const destination = path.join(target, ...adoptBackupPath(file.path).split('/'));
      await fs.mkdir(path.dirname(destination), { recursive: true });
      await fs.copyFile(path.join(folder, 'vault', ...file.path.split('/')), destination, constants.COPYFILE_EXCL);
      if (await sha(destination) !== file.sha256) throw Error(tr('복원한 파일의 해시가 다릅니다: {path}',{path:file.path}));
    }
  } catch (error) {
    // The folder was empty when the restore began, so everything in it now came from this restore.
    for (const entry of await fs.readdir(target).catch(() => [])) await fs.rm(path.join(target, entry), { recursive: true, force: true }).catch(() => {});
    throw error;
  }
  // A restored copy is a new vault, so it never shares an identity (recents,
  // metadata backups) with the vault it came from. Paper, attachment, ink and
  // translation identifiers are kept.
  const libraryFile = path.join(target, VAULT_DIR, 'library.json'), data = await readJson(libraryFile, null);
  data.id = crypto.randomUUID(); await atomicJson(libraryFile, data);
  return { files: manifest.files.length, missing: manifest.missing?.length || 0 };
}
module.exports = { createFullBackup, verifyBackup, restoreFullBackup };
