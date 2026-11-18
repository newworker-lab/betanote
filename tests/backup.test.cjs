const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { Library, atomicJson } = require('../desktop/storage.cjs');
const { TranslationJobs } = require('../desktop/translation.cjs');
const { InkStore, renderRevision } = require('../desktop/ink.cjs');
const { createFullBackup, verifyBackup, restoreFullBackup } = require('../desktop/backup.cjs');
const appName = require('../core/app-name.cjs'), [nameBefore, nameFirst] = appName.history;
const pdf = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n%%EOF');
const geometry = { view: [0, 0, 600, 800], rotate: 0, userUnit: 1 };
const stroke = id => ({ id, page: 0, tool: 'pen', color: '#1d4ed8', width: 1.5, points: [100, 700, 0.5, 0, 140, 690, 0.8, 16] });
test('a full backup restores PDFs, records, ink and translations into a new vault with matching hashes', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `${appName.id}-backup-`)); t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const root = path.join(dir, 'vault'), backups = path.join(dir, 'backups'), restored = path.join(dir, 'restored');
  await Promise.all([fs.mkdir(root), fs.mkdir(backups), fs.mkdir(restored)]);
  await fs.writeFile(path.join(dir, 'paper.pdf'), pdf);
  const library = await Library.open(root), [{ paperId, attachmentId }] = await library.importFiles([path.join(dir, 'paper.pdf')]);
  await library.saveNotes({ [`${paperId}-메모`]: '출처 메모' });
  await library.addAnnotation(paperId, attachmentId, { page: 1, quote: '인용', body: '주석', sourceHash: library.attachment(paperId, attachmentId).sourceHash });
  const translations = new TranslationJobs({}), record = { version: 1, sourceHash: library.attachment(paperId, attachmentId).sourceHash, model: 'm', createdAt: '2026-10-25T00:00:00Z', pages: [{ width: 800, height: 1066, blocks: [] }] };
  await atomicJson(translations.file(library, paperId, attachmentId), record);
  library.ink = new InkStore(library); const revision = renderRevision(record);
  await library.ink.apply(paperId, attachmentId, 'original', [{ type: 'add', stroke: stroke('stroke-0001'), geometry }]);
  await library.ink.apply(paperId, attachmentId, 't-' + revision, [{ type: 'add', stroke: stroke('stroke-0002'), geometry }], () => translations.cached(library, paperId, attachmentId));
  const made = await createFullBackup(library, backups);
  assert.equal(made.missing, 0); assert.ok(made.files >= 6);
  const manifest = await verifyBackup(made.folder);
  assert.ok(manifest.files.some(f => f.path.startsWith('papers/')) && manifest.files.some(f => f.path === `.${appName.id}/ink/${attachmentId}/base-${revision}.json`));
  await restoreFullBackup(made.folder, restored);
  const copy = await Library.open(restored);
  assert.notEqual(copy.data.id, library.data.id, 'the restored copy is a separate vault');
  assert.equal(copy.data.notes[`${paperId}-메모`], '출처 메모'); assert.equal(copy.data.annotations[0].body, '주석');
  assert.deepEqual(await fs.readFile(await copy.resolveFile(paperId, 'attachment-' + attachmentId)), pdf);
  assert.equal(renderRevision(await translations.cached(copy, paperId, attachmentId)), revision);
  const ink = new InkStore(copy);
  assert.deepEqual((await ink.load(paperId, attachmentId, 'original')).strokes.map(s => s.id), ['stroke-0001']);
  assert.deepEqual((await ink.load(paperId, attachmentId, 't-' + revision)).strokes.map(s => s.id), ['stroke-0002']);
  // Restoring needs an empty folder, and a damaged backup is refused.
  await assert.rejects(restoreFullBackup(made.folder, restored), /비어 있는 폴더/);
  const damaged = path.join(made.folder, 'vault', ...manifest.files.find(f => f.path.startsWith('papers/')).path.split('/'));
  await fs.appendFile(damaged, 'x'); await assert.rejects(verifyBackup(made.folder), /손상/);
  // A file damaged after the check is caught while copying, and the target folder is emptied again.
  const second = path.join(dir, 'restored-2'); await fs.mkdir(second);
  await assert.rejects(restoreFullBackup(made.folder, second, manifest), /해시가 다릅니다/);
  assert.deepEqual(await fs.readdir(second), []);
  await assert.rejects(verifyBackup(dir), /전체 백업 폴더가 아닙니다/);
});

for (const [kind, old] of [[`${nameBefore.id}-full-backup`, `.${nameBefore.id}`], [`${nameFirst.id}-full-backup`, `.${nameFirst.id}`]]) test(`a full backup written as ${kind} restores into the new layout`, async t => {
  const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os');
  const { createFullBackup, verifyBackup, restoreFullBackup } = require('../desktop/backup.cjs'), { Library } = require('../desktop/storage.cjs');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `${appName.id}-oldbackup-`)); t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const source = path.join(dir, 'vault'), parent = path.join(dir, 'backups'), target = path.join(dir, 'restored'); for (const folder of [source, parent, target]) await fs.mkdir(folder);
  const library = await Library.open(source); await library.saveNotes({ 'k-메모': '백업한 메모' });
  const { folder } = await createFullBackup(library, parent);
  // A new backup is of the new kind, its files under .<id>/.
  const manifest = JSON.parse(await fs.readFile(path.join(folder, 'manifest.json'), 'utf8'));
  assert.equal(manifest.kind, appName.backupKind); assert.ok(manifest.files.some(f => f.path === `.${appName.id}/library.json`));
  // Rewrite it as the earlier app wrote it: its kind and its files under its folder name.
  await fs.rename(path.join(folder, 'vault', appName.vaultDir), path.join(folder, 'vault', old));
  manifest.kind = kind; manifest.files = manifest.files.map(f => ({ ...f, path: f.path.replace(new RegExp('^' + RegExp.escape(appName.vaultDir) + '/'), old + '/') }));
  await fs.writeFile(path.join(folder, 'manifest.json'), JSON.stringify(manifest));
  await verifyBackup(folder);
  // Restored straight into .<id> under a new id: no rename is left that could fail and leave the copy
  // under the old name with the source vault's id.
  const fsp = require('node:fs/promises'), rename = fsp.rename; fsp.rename = async (from, to) => { if ([`.${nameBefore.id}`, `.${nameFirst.id}`].includes(path.basename(from))) throw Object.assign(Error('EPERM: operation not permitted'), { code: 'EPERM' }); return rename(from, to); };
  try { await restoreFullBackup(folder, target); } finally { fsp.rename = rename; }
  const restored = JSON.parse(await fs.readFile(path.join(target, appName.vaultDir, 'library.json'), 'utf8'));
  assert.equal(restored.notes['k-메모'], '백업한 메모'); assert.notEqual(restored.id, library.data.id); assert.deepEqual(await fs.readdir(target), [appName.vaultDir]);
  // A list naming one file twice once the names are made new (.<earlier id>/ and .<first id>/ copies): not a backup, said in words.
  const twice = { ...manifest, files: [...manifest.files, ...manifest.files.map(f => ({ ...f, path: f.path.replace(old + '/', (old === `.${nameBefore.id}` ? `.${nameFirst.id}` : `.${nameBefore.id}`) + '/') }))] };
  await fs.writeFile(path.join(folder, 'manifest.json'), JSON.stringify(twice)); await assert.rejects(verifyBackup(folder), /백업 목록이 손상됐습니다/);
});
