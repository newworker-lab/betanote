const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { Library, atomicJson } = require('../desktop/storage.cjs');
const { InkStore } = require('../desktop/ink.cjs');
const { NotebookStore } = require('../desktop/notebook.cjs');
const { SyncEngine, writeFileRecord } = require('../desktop/sync.cjs');
const appName = require('../core/app-name.cjs'), [nameBefore, nameFirst] = appName.history;
const pdf = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n%%EOF');
const geometry = { view: [0, 0, 600, 800], rotate: 0, userUnit: 1 };
const stroke = id => ({ id, page: 0, tool: 'pen', color: '#1d4ed8', width: 1.5, points: [100, 700, 0.5, 0, 140, 690, 0.8, 16] });
// One device: its own vault folder, its own id, the shared exchange folder.
async function device(dir, name, shared, vaultId) {
  const root = path.join(dir, name); await fs.mkdir(root);
  if (vaultId) await atomicJson(path.join(root, appName.vaultDir, 'library.json'), { version: 2, id: vaultId, papers: [], notes: {}, collections: [], annotations: [] });
  const library = await Library.open(root), id = crypto.randomUUID();
  library.ink = new InkStore(library); library.notebooks = new NotebookStore(library);
  const sync = async () => { const engine = new SyncEngine({ library, ink: library.ink, notebooks: library.notebooks, folder: shared, deviceId: id, deviceName: name }); return engine.run(); };
  return { root, library, sync, id };
}
async function setup(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `${appName.id}-sync-`)); t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const shared = path.join(dir, 'Dropbox'); await fs.mkdir(shared); await fs.writeFile(path.join(dir, 'paper.pdf'), pdf);
  const a = await device(dir, 'A', shared), [{ paperId, attachmentId }] = await a.library.importFiles([path.join(dir, 'paper.pdf')]);
  await a.library.saveNotes({ [`${paperId}-메모`]: 'A의 메모' });
  await a.library.ink.apply(paperId, attachmentId, 'original', [{ type: 'add', stroke: stroke('stroke-a001'), geometry }]);
  await a.sync();
  const b = await device(dir, 'B', shared, a.library.data.id); await b.sync();
  return { dir, shared, a, b, paperId, attachmentId };
}
test('a second device receives papers, PDFs, notes and ink; repeated runs change nothing', async t => {
  const { a, b, paperId, attachmentId } = await setup(t);
  assert.equal(b.library.data.notes[`${paperId}-메모`], 'A의 메모');
  assert.deepEqual(await fs.readFile(await b.library.resolveFile(paperId, 'attachment-' + attachmentId)), pdf, 'the PDF arrives by hash');
  assert.deepEqual((await b.library.ink.load(paperId, attachmentId, 'original')).strokes.map(s => s.id), ['stroke-a001']);
  // Duplicate delivery and runs in any order are no-ops.
  const before = JSON.stringify(b.library.data);
  for (const run of [b.sync, a.sync, b.sync, b.sync]) { const r = await run(); assert.equal(r.conflicts, 0); }
  assert.equal(JSON.stringify(b.library.data), before);
});
test('changes to different records merge; ink added on both devices is united', async t => {
  const { a, b, paperId, attachmentId } = await setup(t);
  await a.library.saveNotes({ ...a.library.data.notes, [`${paperId}-summary-0`]: 'A의 연구 질문' });
  await b.library.update(paperId, { tags: ['B 태그'] });
  await a.library.ink.apply(paperId, attachmentId, 'original', [{ type: 'add', stroke: stroke('stroke-a002'), geometry }]);
  await b.library.ink.apply(paperId, attachmentId, 'original', [{ type: 'add', stroke: stroke('stroke-b001'), geometry }]);
  await a.library.setGlossary([{ term: 'layout', translation: '배치' }]);
  await a.sync(); await b.sync(); await a.sync();
  assert.deepEqual(b.library.data.glossary, [{ term: 'layout', translation: '배치' }]);
  await b.library.setTranslationRules('용어는 영어 병기'); await b.sync(); await a.sync(); assert.equal(a.library.data.translationRules, '용어는 영어 병기', 'translation requests travel too');
  await a.library.setTranslationRules(''); await a.sync(); await b.sync(); assert.equal(b.library.data.translationRules, undefined, 'and their removal');
  for (const d of [a, b]) {
    assert.equal(d.library.data.notes[`${paperId}-summary-0`], 'A의 연구 질문');
    assert.deepEqual(d.library.paper(paperId).tags, ['B 태그']);
    assert.deepEqual((await d.library.ink.load(paperId, attachmentId, 'original')).strokes.map(s => s.id).sort(), ['stroke-a001', 'stroke-a002', 'stroke-b001']);
  }
});
test('the same note edited on both devices keeps both versions on every device', async t => {
  const { a, b, paperId } = await setup(t), key = `${paperId}-메모`;
  await a.library.saveNotes({ ...a.library.data.notes, [key]: 'A가 고친 메모' });
  await b.library.saveNotes({ ...b.library.data.notes, [key]: 'B가 고친 메모' });
  await b.sync(); const report = await a.sync(); await b.sync();
  assert.equal(report.conflicts, 1);
  for (const d of [a, b]) {
    const conflicts = d.library.data.syncConflicts;
    assert.equal(conflicts.length, 1);
    const versions = [d.library.data.notes[key], conflicts[0].local, conflicts[0].remote];
    assert.ok(versions.includes('A가 고친 메모') && versions.includes('B가 고친 메모'), 'neither edit is lost');
  }
  assert.equal(a.library.data.notes[key], b.library.data.notes[key], 'both devices show the same note afterwards');
  // A later edit after the conflict fast-forwards without a new conflict.
  await b.library.saveNotes({ ...b.library.data.notes, [key]: '정리한 메모' });
  await b.sync(); assert.equal((await a.sync()).conflicts, 0); assert.equal(a.library.data.notes[key], '정리한 메모');
});
test('a deletion on one device and an edit on the other keep the edit; a long offline device still merges', async t => {
  const { a, b, paperId } = await setup(t), key = `${paperId}-메모`;
  const annotation = await a.library.addAnnotation(paperId, a.library.data.papers[0].attachments[0].id, { page: 1, body: '주석', sourceHash: a.library.data.papers[0].attachments[0].sourceHash });
  await a.sync(); await b.sync();
  await a.library.editAnnotation(annotation.id, null);
  await b.library.editAnnotation(annotation.id, { body: 'B가 고친 주석' });
  await a.sync(); await b.sync(); await a.sync();
  for (const d of [a, b]) assert.equal(d.library.data.annotations.find(x => x.id === annotation.id)?.body, 'B가 고친 주석');
  // B is offline for many edits on A; it still fast-forwards with no conflict.
  for (let i = 0; i < 30; i++) { await a.library.saveNotes({ ...a.library.data.notes, [key]: 'A 편집 ' + i }); await a.sync(); }
  assert.equal((await b.sync()).conflicts, 0); assert.equal(b.library.data.notes[key], 'A 편집 29');
});
test('paper fields changed on both devices merge when they differ by field and keep both values when they clash', async t => {
  const { a, b, paperId } = await setup(t);
  await a.library.update(paperId, { title: 'A 제목', tags: ['a'] });
  await b.library.update(paperId, { title: 'B 제목', journal: 'B 학술지', tags: ['b'] });
  await a.sync(); await b.sync(); await a.sync();
  for (const d of [a, b]) {
    const paper = d.library.paper(paperId);
    assert.equal(paper.journal, 'B 학술지'); assert.deepEqual(paper.tags.sort(), ['a', 'b']);
    const clash = d.library.data.syncConflicts.find(c => c.field === 'title');
    assert.ok(clash && [paper.title, clash.local, clash.remote].includes('A 제목') && [paper.title, clash.local, clash.remote].includes('B 제목'));
  }
});
test('a chosen remote version of a file-kept record is written, and unknown names are ignored', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `${appName.id}-sync-file-`)); t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const id = crypto.randomUUID();
  await writeFileRecord(dir, null, 'notebook', id, { id, title: '원격' });
  assert.equal(JSON.parse(await fs.readFile(path.join(dir, 'notebooks', id + '.json'), 'utf8')).title, '원격');
  await writeFileRecord(dir, null, 'corrections', 'att-1', { blocks: {} });
  assert.ok(await fs.stat(path.join(dir, 'corrections', 'att-1.json')));
  await writeFileRecord(dir, null, 'notebook', '../escape', { id: 'x' });
  await assert.rejects(fs.stat(path.join(dir, 'escape.json')));
});
test('tag colours travel per tag; a colour changed on both devices keeps one without a conflict copy', async t => {
  const { a, b } = await setup(t);
  await a.library.setTagColor('RAG', '#0588f0'); await b.library.setTagColor('통계', '#30a46c');
  await a.sync(); await b.sync(); await a.sync();
  for (const d of [a, b]) assert.deepEqual(d.library.data.tagColors, { RAG: '#0588f0', 통계: '#30a46c' });
  await a.library.setTagColor('RAG', '#e5484d'); await b.library.setTagColor('RAG', '#8e4ec6'); await b.library.deleteTag('통계');
  await a.sync(); await b.sync(); await a.sync();
  assert.equal(a.library.data.tagColors.통계, undefined); assert.equal(b.library.data.tagColors?.통계, undefined);
  assert.ok(['#e5484d', '#8e4ec6'].includes(b.library.data.tagColors.RAG)); assert.equal(a.library.data.tagColors.RAG, b.library.data.tagColors.RAG, 'both devices settle on one colour');
  assert.equal((b.library.data.syncConflicts || []).length, 0);
  // A rename on one device moves the papers and the colour on the other.
  const paperId = a.library.data.papers[0].id;
  await a.library.update(paperId, { tags: ['RAG'] }); await a.sync(); await b.sync();
  await b.library.renameTag('RAG', '검색 증강'); await b.sync(); await a.sync();
  assert.deepEqual(a.library.paper(paperId).tags, ['검색 증강']); assert.equal(a.library.data.tagColors.RAG, undefined);
  assert.equal(a.library.data.tagColors['검색 증강'], b.library.data.tagColors['검색 증강']);
});

test('a sync folder under an earlier name is taken over; beside the new one it is left and told of', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `${appName.id}-oldsync-`)); t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const legacy = require('../desktop/legacy.cjs'), { sharedVaults } = require('../desktop/sync.cjs'), id = crypto.randomUUID();
  const made = async (folder, name) => { const devices = path.join(folder, name, id, 'devices'); await fs.mkdir(devices, { recursive: true }); await fs.writeFile(path.join(devices, crypto.randomUUID() + '.json'), JSON.stringify({ vaultId: id, deviceName: name, publishedAt: '2026-01-01T00:00:00.000Z', vaultName: 'V' })); };
  for (const old of [`${nameBefore.id}-sync`, `${nameFirst.id}-sync`]) {
    const folder = path.join(dir, old); await made(folder, old);
    assert.equal(await legacy.syncDirIn(folder), old);
    assert.equal(await legacy.adoptSyncFolder(folder), true); assert.equal(await legacy.syncDirIn(folder), appName.syncDir);
    assert.deepEqual(await fs.readdir(folder), [appName.syncDir]); assert.equal(await legacy.adoptSyncFolder(folder), false, 'taken over once');
    assert.equal(await legacy.oldSyncBeside(folder), null);
  }
  // Both earlier names: <earlier id>-sync is taken over, <first id>-sync left.
  const both = path.join(dir, 'both'); await made(both, `${nameBefore.id}-sync`); await made(both, `${nameFirst.id}-sync`);
  assert.equal(await legacy.adoptSyncFolder(both), true); assert.deepEqual((await fs.readdir(both)).sort(), [appName.syncDir, `${nameFirst.id}-sync`].sort());
  assert.deepEqual(await legacy.oldSyncBeside(both), [`${nameFirst.id}-sync`]);
  // The new one there already: left as they are, the old one told of.
  const beside = path.join(dir, 'beside'); await made(beside, appName.syncDir); await made(beside, `${nameBefore.id}-sync`);
  assert.equal(await legacy.adoptSyncFolder(beside), false); assert.deepEqual((await fs.readdir(beside)).sort(), [appName.syncDir, `${nameBefore.id}-sync`].sort());
  assert.deepEqual(await legacy.oldSyncBeside(beside), [`${nameBefore.id}-sync`]);
  // Both earlier names beside it, each holding a vault: both are told of.
  await made(beside, `${nameFirst.id}-sync`); assert.deepEqual(await legacy.oldSyncBeside(beside), [`${nameBefore.id}-sync`, `${nameFirst.id}-sync`]);
  // Looked into from another device, an old-named one is taken over and its vault found.
  const join = path.join(dir, 'join'); await made(join, `${nameBefore.id}-sync`);
  assert.deepEqual((await sharedVaults(join)).map(v => v.id), [id]); assert.deepEqual(await fs.readdir(join), [appName.syncDir]);
  // An old sync folder with no vault in it is not told of.
  const empty = path.join(dir, 'empty'); await made(empty, appName.syncDir); await fs.mkdir(path.join(empty, `${nameBefore.id}-sync`));
  assert.equal(await legacy.oldSyncBeside(empty), null);
  // A rename another program refuses: syncing stops with a message about the sync folder; looking in still shows its vaults.
  const held = path.join(dir, 'held'); await made(held, `${nameBefore.id}-sync`); const fsp = require('node:fs/promises'), rename = fsp.rename;
  fsp.rename = async () => { throw Object.assign(Error('EPERM: operation not permitted'), { code: 'EPERM' }); };
  try {
    await assert.rejects(legacy.adoptSyncFolder(held), error => error.code === 'APP_RENAME_FAILED' && error.message.includes(`동기화 폴더 이름을 바꾸지 못했습니다(${nameBefore.id}-sync → ${appName.syncDir})`));
    assert.deepEqual((await sharedVaults(held)).map(v => v.id), [id]);
  } finally { fsp.rename = rename; }
  assert.deepEqual(await fs.readdir(held), [`${nameBefore.id}-sync`]);
});
test('a PDF not yet in the sync folder when its record came is fetched on a later sync', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `${appName.id}-sync-`)); t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const shared = path.join(dir, 'Dropbox'); await fs.mkdir(shared); await fs.writeFile(path.join(dir, 'paper.pdf'), pdf);
  const a = await device(dir, 'A', shared), [{ paperId, attachmentId }] = await a.library.importFiles([path.join(dir, 'paper.pdf')]);
  await a.sync();
  // The PDF had not arrived in the shared folder yet (a cloud drive still uploading it).
  const files = path.join(shared, appName.syncDir, a.library.data.id, 'files'); const [name] = await fs.readdir(files); await fs.rename(path.join(files, name), path.join(dir, 'held.pdf'));
  const b = await device(dir, 'B', shared, a.library.data.id); const first = await b.sync();
  assert.equal(first.missingFiles.length, 1, 'told missing the first time');
  await fs.rename(path.join(dir, 'held.pdf'), path.join(files, name));
  await b.sync();
  assert.deepEqual(await fs.readFile(await b.library.resolveFile(paperId, 'attachment-' + attachmentId)), pdf, 'fetched once it is there');
});
test('a paper removed on another device while this one annotated it, or a collection under one removed there, keeps syncing', async t => {
  const { a, b, paperId, attachmentId } = await setup(t);
  const parent = crypto.randomUUID();
  await a.library.transaction(() => { a.library.data.collections.push({ id: parent, name: '위' }); }); await a.sync(); await b.sync();
  // A removes the paper and the collection; B, meanwhile, annotates the paper and makes a collection under the other.
  await a.library.deleteAttachments(paperId, null, file => fs.rm(file, { force: true })); await a.library.transaction(() => { a.library.data.collections = a.library.data.collections.filter(c => c.id !== parent); }); await a.sync();
  await b.library.transaction(() => { b.library.data.annotations.push({ id: crypto.randomUUID(), paperId, attachmentId, page: 1, quote: 'q', body: 'B의 주석', createdAt: new Date().toISOString() }); b.library.data.collections.push({ id: crypto.randomUUID(), name: '아래', parentId: parent }); });
  const reports = []; for (let i = 0; i < 2; i++) reports.push(await b.sync());
  // The sync says what it kept, once: the paper (not each of its records) and the collection moved to the top.
  assert.equal(reports[0].keptPapers, 1); assert.equal(reports[0].liftedCollections, 1); assert.equal(reports[0].restoredAttachments, 0);
  assert.equal(reports[1].keptPapers, 0); assert.equal(reports[1].liftedCollections, 0);
  assert.ok(b.library.data.papers.some(p => p.id === paperId), 'the annotated paper stays');
  assert.ok(b.library.data.annotations.some(x => x.body === 'B의 주석'), 'with its annotation');
  const child = b.library.data.collections.find(c => c.name === '아래'); assert.ok(child, 'the collection stays'); assert.equal(child.parentId, undefined, 'at the top now');
  assert.deepEqual((await b.library.ink.load(paperId, attachmentId, 'original')).strokes.map(s => s.id), ['stroke-a001'], 'and its ink');
  await a.sync(); assert.ok(a.library.data.annotations.some(x => x.body === 'B의 주석'), 'the other device gets the annotation and its paper back');
});
test('a paper with ink removed on another device is removed here, its ink too', async t => {
  const { a, b, paperId, attachmentId } = await setup(t);
  await a.library.deleteAttachments(paperId, null, file => fs.rm(file, { force: true })); await a.sync();
  await b.sync();
  assert.ok(!b.library.data.papers.some(p => p.id === paperId));
  assert.deepEqual(await fs.readdir(path.join(b.root, appName.vaultDir, 'ink', attachmentId)).catch(() => []), []);
});
test('translation rules changed on both devices: a conflict whose chosen version is written', async t => {
  const { a, b } = await setup(t);
  await a.library.transaction(() => { a.library.data.translationRules = 'A의 규칙'; }); await b.library.transaction(() => { b.library.data.translationRules = 'B의 규칙'; });
  await a.sync(); await b.sync();
  const conflict = (b.library.data.syncConflicts || []).find(c => c.key === 'rules:vault');
  assert.ok(conflict, 'recorded as rules:vault');
  const { resolveConflict } = require('../desktop/sync.cjs');
  await b.library.transaction(() => resolveConflict(b.library, conflict, 'remote'));
  assert.equal(b.library.data.translationRules, conflict.remote, 'the other device\'s rules written');
  assert.ok(!(b.library.data.syncConflicts || []).some(c => c.id === conflict.id), 'the conflict gone');
  // A kind this version does not know: the conflict stays and it says so.
  const odd = { id: crypto.randomUUID(), key: 'future:x', local: 1, remote: 2 }; b.library.data.syncConflicts.push(odd);
  assert.throws(() => resolveConflict(b.library, odd, 'remote')); assert.ok(b.library.data.syncConflicts.some(c => c.id === odd.id));
});
test('the vault\'s AI requests travel as their own record, conflicts are resolved, and an older app does not wipe them', async t => {
  const { shared, a, b } = await setup(t);
  await b.library.setAiRules('수식은 LaTeX로'); await b.sync(); await a.sync();
  assert.equal(a.library.data.aiRules, '수식은 LaTeX로', 'AI requests travel'); assert.equal(a.library.data.translationRules, undefined, 'not as translation requests');
  await a.library.setAiRules(''); await a.sync(); await b.sync(); assert.equal(b.library.data.aiRules, undefined, 'and their removal');
  // Changed on both devices: a conflict on airules:vault whose chosen side is written.
  await a.library.setAiRules('A의 요청'); await b.library.setAiRules('B의 요청'); await a.sync(); await b.sync();
  const conflict = (b.library.data.syncConflicts || []).find(c => c.key === 'airules:vault'); assert.ok(conflict, 'recorded as airules:vault');
  const { resolveConflict } = require('../desktop/sync.cjs');
  await b.library.transaction(() => resolveConflict(b.library, conflict, 'remote')); assert.equal(b.library.data.aiRules, conflict.remote);
  await b.sync(); await a.sync(); await b.sync(); assert.equal(a.library.data.aiRules, b.library.data.aiRules);
  // An app from before AI requests (its device file names no kinds) drops the record it does not know as deleted: not taken.
  const file = path.join(shared, require('../desktop/legacy.cjs').SYNC_DIR, a.library.data.id, 'devices', b.id + '.json'), published = JSON.parse(await fs.readFile(file, 'utf8'));
  assert.ok(published.kinds.includes('airules'), 'this app names the kinds it knows');
  const mine = published.records['airules:vault']; delete published.kinds;
  published.records['airules:vault'] = { rev: crypto.randomUUID(), history: [mine.rev, ...mine.history], hash: null, deleted: true, device: b.id };
  await fs.writeFile(file, JSON.stringify(published));
  const kept = a.library.data.aiRules; await a.sync(); assert.equal(a.library.data.aiRules, kept, 'kept against an older app\'s removal');
});
