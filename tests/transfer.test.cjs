// Copying and moving papers to another vault (desktop/transfer.cjs): what is collected, planned and written.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const appName = require('../core/app-name.cjs');
const { Library, translationFileName } = require('../desktop/storage.cjs');
const { collectBundle, sourceReader, noteImageNames, planTransfer, sameOrNested, applyTransfer, verifyTransfer, runTransfer, vaultPlace, receivingFolders } = require('../desktop/transfer.cjs');
const { NotebookStore } = require('../desktop/notebook.cjs');

const pdf = (tag = '') => Buffer.from(`%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n% ${tag}\n%%EOF`);
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const picture = name => sha(Buffer.from(name)).slice(0, 32) + '.png';

// A vault with real records: papers imported through the library, the files under the vault folder written as the app
// writes them.
async function fixtureVault(t, name = 'from') {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `${appName.id}-transfer-`)); t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const root = path.join(dir, name); await fs.mkdir(root);
  const library = await Library.open(root);
  return { dir, root, library, vault: path.join(root, appName.vaultDir) };
}
async function writeFile(file, text) { await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, text); }
// A paper with an original, a trashed version, a translation PDF, memos of every kind, two annotations (one naming a
// pasted picture), ink, translation records (Korean and English), AI results, corrections and a notebook with a picture.
async function richPaper({ dir, root, library, vault }, tag) {
  const original = path.join(dir, `${tag}.pdf`), version = path.join(dir, `${tag}-v2.pdf`), translated = path.join(dir, `${tag}-ko.pdf`);
  await fs.writeFile(original, pdf(tag)); await fs.writeFile(version, pdf(tag + ' v2')); await fs.writeFile(translated, pdf(tag + ' ko'));
  const [first] = await library.importFiles([original]), id = first.paperId;
  await library.importPDFs([version], { paperId: id, role: 'version' }); await library.importPDFs([translated], { paperId: id, role: 'translated', internal: true });
  const paper = library.paper(id), att = paper.attachments[0], trashed = paper.attachments[1];
  trashed.trashedAt = new Date().toISOString(); await library.save();
  const memoPicture = picture(tag + 'm'), annotationPicture = picture(tag + 'a'), notebookAsset = sha(Buffer.from(tag + ' asset'));
  await library.saveNotes({ ...library.data.notes, [`${id}-메모`]: `메모 ![](note-image:${memoPicture})`, [`${id}-메모-x`]: '둘째', [`${id}-메모-x#title`]: '제목', [`${id}-메모#figure`]: JSON.stringify({ attachmentId: att.id, page: 1, rect: [0, 0, 1, 1] }), [`${id}-메모#pin`]: JSON.stringify({ attachmentId: att.id, page: 1 }), [`${id}-메모#order`]: JSON.stringify([`${id}-메모-x`, `${id}-메모`]), [`${id}-summary-0`]: '요약' });
  library.data.annotations.push({ id: crypto.randomUUID(), paperId: id, attachmentId: att.id, page: 1, quote: 'q', body: `주석 ![](note-image:${annotationPicture})`, createdAt: new Date().toISOString() }, { id: crypto.randomUUID(), paperId: id, attachmentId: att.id, page: 2, quote: 'r', body: '', createdAt: new Date().toISOString() });
  await library.save();
  await writeFile(path.join(vault, 'ink', att.id, 'original.log'), '{"seq":1}\n');
  const translation = translationFileName(id, att);
  await writeFile(path.join(vault, translation), JSON.stringify({ version: 1, pages: [{ page: 1, text: tag }] }));
  await writeFile(path.join(vault, translation.replace(/\.json$/, '.chunks.json')), '{}');
  await writeFile(path.join(vault, translationFileName(id, att, 'en')), JSON.stringify({ version: 1, pages: [{ page: 1, text: 'en' }] }));
  await writeFile(path.join(vault, 'ai', att.id + '.json'), '{"version":1,"results":[]}');
  await writeFile(path.join(vault, 'corrections', att.id + '.json'), '{}');
  const notebook = { id: crypto.randomUUID(), title: '노트', paperId: id, pages: [{ id: 'page-0001', template: 'blank', width: 595, height: 842, items: [{ id: 'image-0001', type: 'image', x: 0, y: 0, w: 10, h: 10, asset: notebookAsset }], strokes: [] }] };
  await writeFile(path.join(vault, 'notebooks', notebook.id + '.json'), JSON.stringify(notebook));
  await writeFile(path.join(vault, 'notebooks', 'assets', notebookAsset + '.png'), 'png');
  await writeFile(path.join(vault, 'note-images', memoPicture), 'memo png'); await writeFile(path.join(vault, 'note-images', annotationPicture), 'note png');
  return { id, att, trashed, notebook, memoPicture, annotationPicture, notebookAsset, translation };
}

test('collects every record of a paper', async t => {
  const v = await fixtureVault(t), one = await richPaper(v, 'one'), two = await richPaper(v, 'two');
  const bundle = await collectBundle(v.library, [one.id]);
  assert.equal(bundle.version, 1); assert.equal(bundle.whole, false); assert.deepEqual(bundle.papers.map(p => p.id), [one.id]);
  assert.deepEqual([...new Set(bundle.files.map(f => f.kind))].sort(), ['ai', 'chunks', 'corrections', 'ink', 'note-image', 'notebook-asset', 'pdf', 'translated-pdf', 'translation']);
  assert.ok(bundle.files.some(f => f.kind === 'pdf' && f.attachmentId === one.trashed.id && f.sha256), 'the trashed attachment\'s PDF too');
  assert.ok(bundle.files.some(f => f.kind === 'translation' && f.language === 'en'));
  assert.ok(bundle.files.some(f => f.kind === 'translation' && f.language === 'ko' && f.path === one.translation));
  assert.ok(Object.keys(bundle.notes).length === 7 && Object.keys(bundle.notes).every(k => k.startsWith(one.id + '-')));
  assert.equal(bundle.annotations.length, 2); assert.ok(bundle.annotations.every(a => a.paperId === one.id));
  assert.deepEqual(bundle.notebooks.map(n => n.id), [one.notebook.id]);
  assert.deepEqual(bundle.files.filter(f => f.kind === 'note-image').map(f => f.path).sort(), [`note-images/${one.annotationPicture}`, `note-images/${one.memoPicture}`].sort());
  assert.ok(!bundle.files.some(f => f.attachmentId === two.att.id || f.path.includes(two.memoPicture)), 'nothing of the other paper');
  for (const f of bundle.files) assert.equal(f.sha256, sha(await fs.readFile(f.internal ? path.join(v.vault, f.path) : path.join(v.root, f.path))), f.path);
  assert.ok(!bundle.files.some(f => /comparisons|writer\.lock|backups|sync/.test(f.path)));
  assert.equal(bundle.savedSearches, undefined, 'vault lists only for the whole vault');
});
test('a missing PDF is listed with no hash', async t => {
  const v = await fixtureVault(t), one = await richPaper(v, 'one');
  await fs.rm(path.join(v.root, one.att.path));
  const entry = (await collectBundle(v.library, [one.id])).files.find(f => f.attachmentId === one.att.id && f.kind === 'pdf');
  assert.deepEqual([entry.sha256, entry.size], [null, 0]);
});
test('the whole vault brings trash, notebooks of no paper and vault lists', async t => {
  const v = await fixtureVault(t), one = await richPaper(v, 'one'), two = await richPaper(v, 'two');
  await v.library.transaction(() => { v.library.paper(two.id).trashedAt = new Date().toISOString(); (v.library.data.savedSearches ||= []).push({ id: 'search-01', name: '찾기', query: 'x' }); v.library.data.glossary = [{ source: 'cell', target: '세포' }]; v.library.data.translationRules = '존댓말'; });
  const loose = { id: crypto.randomUUID(), title: '프로젝트', paperId: null, pages: [{ id: 'page-0002', template: 'blank', width: 595, height: 842, items: [], strokes: [] }] };
  await writeFile(path.join(v.vault, 'notebooks', loose.id + '.json'), JSON.stringify(loose));
  const bundle = await collectBundle(v.library, null);
  assert.equal(bundle.whole, true); assert.deepEqual(bundle.papers.map(p => p.id).sort(), [one.id, two.id].sort());
  assert.ok(bundle.papers.find(p => p.id === two.id).trashedAt);
  assert.deepEqual(bundle.notebooks.map(n => n.id).sort(), [one.notebook.id, two.notebook.id, loose.id].sort());
  assert.deepEqual([bundle.savedSearches.length, bundle.glossary.length, bundle.translationRules], [1, 1, '존댓말']);
});
test('the reader copies without overwriting and never leaves the vault', async t => {
  const v = await fixtureVault(t), one = await richPaper(v, 'one'), reader = sourceReader(v.root), entry = (await collectBundle(v.library, [one.id])).files.find(f => f.kind === 'pdf');
  const out = path.join(v.dir, 'copy.pdf'); await reader.copy(entry, out);
  assert.deepEqual(await fs.readFile(out), await fs.readFile(path.join(v.root, entry.path)));
  await assert.rejects(reader.copy(entry, out), { code: 'EEXIST' });
  await assert.rejects(reader.read({ path: '../outside.pdf', internal: false }), /저장소 밖/);
  await fs.writeFile(path.join(v.dir, 'secret.txt'), 'x'); await fs.symlink(path.join(v.dir, 'secret.txt'), path.join(v.root, 'link.pdf'));
  await assert.rejects(reader.read({ path: 'link.pdf', internal: false }), /저장소 밖/);
  assert.deepEqual(noteImageNames('a note-image:0123456789abcdef0123456789abcdef.png b note-image:0123456789abcdef0123456789abcdef.png'), ['0123456789abcdef0123456789abcdef.png']);
});

// ---- Planning: what each paper becomes in the receiving vault, read only.
async function twoVaults(t) {
  const from = await fixtureVault(t, 'from'), toRoot = path.join(from.dir, 'to'); await fs.mkdir(toRoot);
  const to = { dir: from.dir, root: toRoot, library: await Library.open(toRoot), vault: path.join(toRoot, appName.vaultDir) };
  return { from, to };
}
// A plain paper from given bytes, in a folder of the vault.
async function plainPaper(v, name, bytes, folder) {
  const file = path.join(v.dir, `src-${crypto.randomUUID()}`, name); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, bytes);
  if (folder) await fs.mkdir(path.join(v.root, ...folder.split('/')), { recursive: true });
  const [result] = await v.library.importPDFs([file], { role: 'original', ...(folder ? { folder } : {}) }); return v.library.paper(result.paperId);
}
const plan = async (bundle, root, existing = 'skip') => planTransfer(bundle, await Library.peek(root), { existing });

test('a paper sent before is recognised by its attachment id', async t => {
  const { from, to } = await twoVaults(t), sent = await plainPaper(from, 'a.pdf', pdf('a')), copy = await plainPaper(to, 'other.pdf', pdf('other'));
  copy.attachments[0].id = sent.attachments[0].id; copy.primaryAttachmentId = sent.attachments[0].id; await to.library.save();
  const bundle = await collectBundle(from.library, [sent.id]);
  assert.deepEqual((await plan(bundle, to.root, 'skip')).papers.map(p => [p.action, p.into]), [['skip', copy.id]]);
  assert.deepEqual((await plan(bundle, to.root, 'replace')).papers.map(p => [p.action, p.into]), [['replace', copy.id]]);
});
test('the same PDF or DOI merges', async t => {
  const { from, to } = await twoVaults(t), same = await plainPaper(from, 'a.pdf', pdf('a')), byDoi = await plainPaper(from, 'b.pdf', pdf('b'));
  const there = await plainPaper(to, 'a.pdf', pdf('a')), doiThere = await plainPaper(to, 'c.pdf', pdf('c'));
  await from.library.transaction(() => { from.library.paper(byDoi.id).doi = '10.1000/ABC'; }); await to.library.transaction(() => { to.library.paper(doiThere.id).doi = 'https://doi.org/10.1000/abc'; });
  const result = await plan(await collectBundle(from.library, [same.id, byDoi.id]), to.root);
  assert.deepEqual(result.papers.map(p => [p.from, p.action, p.into]), [[same.id, 'merge', there.id], [byDoi.id, 'merge', doiThere.id]]);
  assert.equal(result.counts.merge, 2);
});
test('an identical PDF is not copied again when the kept side has no work', async t => {
  const { from, to } = await twoVaults(t), sent = await plainPaper(from, 'a.pdf', pdf('a')), there = await plainPaper(to, 'a.pdf', pdf('a'));
  await writeFile(path.join(from.vault, 'ink', sent.attachments[0].id, 'original.log'), 'ink');
  let result = await plan(await collectBundle(from.library, [sent.id]), to.root);
  assert.equal(result.files.find(f => f.entry.kind === 'pdf').reuse, true);
  assert.equal(result.files.find(f => f.entry.kind === 'ink').to, `ink/${there.attachments[0].id}/original.log`, 'the ink goes to the attachment already there');
  // Both sides with work: both stay, the file copied under a numbered name.
  await writeFile(path.join(to.vault, 'ink', there.attachments[0].id, 'original.log'), 'theirs');
  result = await plan(await collectBundle(from.library, [sent.id]), to.root);
  const placed = result.files.find(f => f.entry.kind === 'pdf');
  assert.deepEqual([placed.reuse, placed.to], [false, 'papers/a (2).pdf']);
  assert.notEqual(result.files.find(f => f.entry.kind === 'ink').to, `ink/${there.attachments[0].id}/original.log`);
});
test('clashing ids are renumbered everywhere', async t => {
  const { from, to } = await twoVaults(t), sent = await plainPaper(from, 'a.pdf', pdf('a')), other = await plainPaper(to, 'z.pdf', pdf('z')), kept = await plainPaper(from, 'k.pdf', pdf('k'));
  const legacy = `original-${sent.id}`, annotation = crypto.randomUUID(), collection = crypto.randomUUID(), notebook = crypto.randomUUID();
  await from.library.transaction(() => {
    const p = from.library.paper(sent.id); p.attachments[0].id = legacy; p.primaryAttachmentId = legacy; p.collectionIds = [collection];
    from.library.data.collections.push({ id: collection, name: '모음' });
    from.library.data.annotations.push({ id: annotation, paperId: sent.id, attachmentId: legacy, page: 1, quote: 'q', body: '', createdAt: new Date().toISOString() });
  });
  await writeFile(path.join(from.vault, 'notebooks', notebook + '.json'), JSON.stringify({ id: notebook, title: 'n', paperId: sent.id, pages: [] }));
  await to.library.transaction(() => {
    const p = to.library.paper(other.id); p.id = sent.id; p.attachments[0].id = legacy; p.primaryAttachmentId = legacy;
    to.library.data.collections.push({ id: collection, name: '다른 모음' });
    to.library.data.annotations.push({ id: annotation, paperId: sent.id, attachmentId: legacy, page: 1, quote: 'x', body: '', createdAt: new Date().toISOString() });
  });
  await writeFile(path.join(to.vault, 'notebooks', notebook + '.json'), JSON.stringify({ id: notebook, title: 'theirs', paperId: null, pages: [] }));
  // An attachment id of the old form (original-<paper id>) is shared by chance, not a sign of an earlier copy: renumbered.
  const again = await plan(await collectBundle(from.library, [sent.id, kept.id]), to.root), moved = again.papers.find(p => p.from === sent.id);
  assert.deepEqual([moved.action, moved.renumbered], ['new', true]); assert.notEqual(moved.to, sent.id); assert.equal(again.ids.papers.get(sent.id), moved.to);
  assert.ok(again.ids.attachments.get(legacy) && again.ids.attachments.get(legacy) !== legacy, 'the old-form attachment id is renumbered');
  assert.equal(again.ids.annotations.has(annotation) && again.ids.annotations.get(annotation) !== annotation, true);
  assert.equal(again.ids.notebooks.get(notebook) !== notebook, true);
  assert.equal(again.ids.collections.get(collection) !== collection, true, 'another collection under the same id');
  const keptRow = again.papers.find(p => p.from === kept.id); assert.deepEqual([keptRow.to, keptRow.renumbered], [kept.id, false], 'ids that do not clash stay');
  assert.equal(again.counts.renumbered, 1);
});
test('a renumbered paper keeps its old citation key', async t => {
  const { from, to } = await twoVaults(t), sent = await plainPaper(from, 'a.pdf', pdf('a')), named = await plainPaper(from, 'b.pdf', pdf('b')), there = await plainPaper(to, 'z.pdf', pdf('z'));
  await to.library.transaction(() => { const p = to.library.paper(there.id); p.id = sent.id; p.citekey = 'smith2020'; to.library.data.papers.push({ ...JSON.parse(JSON.stringify(p)), id: 7, citekey: appName.citekeyPrefix + sent.id, attachments: [], primaryAttachmentId: null }); });
  await from.library.transaction(() => { from.library.paper(named.id).citekey = 'smith2020'; });
  const result = await plan(await collectBundle(from.library, [sent.id, named.id]), to.root);
  assert.equal(result.papers.find(p => p.from === sent.id).citekey, appName.citekeyPrefix + sent.id + 'a', 'the old default key, with a letter as it is taken');
  assert.equal(result.papers.find(p => p.from === named.id).citekey, 'smith2020a');
});
test('PDF places keep the folder and never overwrite', async t => {
  const { from, to } = await twoVaults(t), folder = '연구/2024 (초안)', sent = await plainPaper(from, '논문 A.pdf', pdf('a'), folder), fresh = await plainPaper(from, 'b.pdf', pdf('b'), '새 폴더/아래');
  await writeFile(path.join(to.root, '연구', '2024 (초안)', '논문 A.pdf'), pdf('theirs'));
  const result = await plan(await collectBundle(from.library, [sent.id, fresh.id]), to.root), to_ = id => result.files.find(f => f.entry.kind === 'pdf' && f.entry.paperId === id).to;
  assert.equal(to_(sent.id), '연구/2024 (초안)/논문 A (2).pdf'); assert.equal(to_(fresh.id), '새 폴더/아래/b.pdf');
});
test('translation owners never clash', async t => {
  const { from, to } = await twoVaults(t), sent = await plainPaper(from, 'a.pdf', pdf('a')), there = await plainPaper(to, 'c.pdf', pdf('c'));
  await from.library.transaction(() => { const p = from.library.paper(sent.id); p.doi = '10.1/x'; p.attachments[0].cacheKey = ''; });
  await to.library.transaction(() => { const p = to.library.paper(there.id); p.doi = '10.1/x'; p.attachments[0].cacheKey = ''; p.attachments[0].cacheOwnerId = sent.id; });
  await writeFile(path.join(from.vault, `translation-${sent.id}.json`), '{"version":1,"pages":[]}');
  await writeFile(path.join(to.vault, `translation-${sent.id}.json`), '{"version":1,"pages":[]}');
  const result = await plan(await collectBundle(from.library, [sent.id]), to.root), placed = result.files.find(f => f.entry.kind === 'translation');
  assert.notEqual(placed.to, `translation-${sent.id}.json`); assert.match(placed.to, /^translation-\d+\.json$/);
  const owner = result.owners.get(result.ids.attachments.get(sent.attachments[0].id) || sent.attachments[0].id);
  assert.equal(placed.to, `translation-${owner}.json`);
});
test('collections match by name and place, tag colours only fill gaps', async t => {
  const { from, to } = await twoVaults(t), sent = await plainPaper(from, 'a.pdf', pdf('a')), parent = crypto.randomUUID(), child = crypto.randomUUID(), theirParent = crypto.randomUUID(), theirChild = crypto.randomUUID();
  await from.library.transaction(() => { from.library.data.collections.push({ id: parent, name: '연구' }, { id: child, name: '읽을 것', parentId: parent }, { id: 'lonely-01', name: '혼자' }); const p = from.library.paper(sent.id); p.collectionIds = [child, 'lonely-01']; p.tags = ['중요', '나중']; from.library.data.tagColors = { 중요: '#ff0000', 나중: '#00ff00' }; });
  await to.library.transaction(() => { to.library.data.collections.push({ id: theirParent, name: '연구' }, { id: theirChild, name: '읽을 것', parentId: theirParent }); to.library.data.tagColors = { 중요: '#0000ff' }; });
  const result = await plan(await collectBundle(from.library, [sent.id]), to.root);
  assert.deepEqual([result.ids.collections.get(parent), result.ids.collections.get(child), result.ids.collections.get('lonely-01')], [theirParent, theirChild, 'lonely-01']);
  assert.deepEqual(result.newCollections.map(c => c.id), ['lonely-01']);
  assert.deepEqual(result.tagColors, { 나중: '#00ff00' }, 'only the colours the receiving side lacks');
});
test('peek writes nothing', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `${appName.id}-peek-`)); t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const empty = path.join(dir, 'empty'), loose = path.join(dir, 'loose'); await fs.mkdir(empty); await writeFile(path.join(loose, 'a.pdf'), pdf('a')); await writeFile(path.join(loose, 'sub', 'b.pdf'), pdf('b'));
  for (const [root, count] of [[empty, 0], [loose, 2]]) {
    const before = (await fs.readdir(root, { recursive: true })).sort(), library = await Library.peek(root);
    assert.deepEqual([library.fresh, library.loosePdfs, library.data.papers.length], [true, count, 0]);
    assert.deepEqual((await fs.readdir(root, { recursive: true })).sort(), before);
  }
  const { to } = await twoVaults(t); await plainPaper(to, 'a.pdf', pdf('a'));
  const peeked = await Library.peek(to.root); assert.deepEqual([peeked.fresh, peeked.data.papers.length], [false, 1]);
  await fs.writeFile(path.join(to.vault, 'library.json'), '{broken'); await assert.rejects(Library.peek(to.root), { code: 'APP_VAULT_DAMAGED' });
  await fs.writeFile(path.join(to.vault, 'library.json'), JSON.stringify({ version: 3, id: 'x', papers: [], notes: {} })); await assert.rejects(Library.peek(to.root), { code: 'APP_NEWER_VAULT' });
});
test('same or nested folders', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `${appName.id}-nest-`)); t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const a = path.join(dir, 'a'), inner = path.join(a, 'in'), b = path.join(dir, 'b'), link = path.join(dir, 'link'); await fs.mkdir(inner, { recursive: true }); await fs.mkdir(b); await fs.mkdir(path.join(dir, 'a-b')); await fs.symlink(a, link);
  assert.deepEqual(await Promise.all([[a, a], [a, inner], [inner, a], [link, a], [a, b], [a, path.join(dir, 'a-b')]].map(([x, y]) => sameOrNested(x, y).catch(() => 'error'))), [true, true, true, true, false, false]);
});

// ---- Writing into the receiving vault.
// Every file under a folder with its hash (backups left out: a send keeps one before it writes, also when it fails).
async function snapshot(root) {
  const out = {};
  for (const name of (await fs.readdir(root, { recursive: true })).sort()) {
    if (name.split(path.sep).includes('backups')) continue;
    const file = path.join(root, name), info = await fs.lstat(file); if (info.isFile()) out[name.split(path.sep).join('/')] = sha(await fs.readFile(file));
  }
  return out;
}
async function send(from, toRoot, ids, { existing = 'skip', reader = sourceReader(from.root), folder, keepFolders, ...options } = {}) {
  const bundle = await collectBundle(from.library, ids), planned = await planTransfer(bundle, await Library.peek(toRoot), { existing, folder, keepFolders }), target = await Library.open(toRoot);
  const report = await applyTransfer(planned, bundle, target, reader, options);
  return { bundle, plan: planned, target, report };
}
const leftovers = async vault => (await fs.readdir(vault)).filter(n => n.startsWith('transfer-'));

test('two papers arrive with everything', async t => {
  const { from, to } = await twoVaults(t), one = await richPaper(from, 'one'), two = await richPaper(from, 'two'), before = await snapshot(from.root);
  const { report } = await send(from, to.root, [one.id, two.id]);
  assert.deepEqual(report.sent.sort(), [one.id, two.id].sort()); assert.equal(report.skipped.length, 0);
  const library = await Library.open(to.root), paper = library.paper(one.id), att = paper.attachments[0];
  assert.equal(paper.attachments.length, 3); assert.ok(paper.attachments.find(a => a.id === one.trashed.id).trashedAt);
  assert.equal(library.data.notes[`${one.id}-메모-x`], '둘째'); assert.equal(JSON.parse(library.data.notes[`${one.id}-메모#order`])[0], `${one.id}-메모-x`);
  assert.equal(library.data.annotations.filter(a => a.paperId === one.id).length, 2);
  const notebook = JSON.parse(await fs.readFile(path.join(to.vault, 'notebooks', one.notebook.id + '.json'), 'utf8')); assert.equal(notebook.paperId, one.id);
  for (const file of [`notebooks/assets/${one.notebookAsset}.png`, `note-images/${one.memoPicture}`, `note-images/${one.annotationPicture}`]) await fs.access(path.join(to.vault, file));
  assert.deepEqual(await fs.readFile(path.join(to.vault, 'ink', att.id, 'original.log')), await fs.readFile(path.join(from.vault, 'ink', att.id, 'original.log')));
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(to.vault, translationFileName(paper.id, att)), 'utf8')).pages, [{ page: 1, text: 'one' }]);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(to.vault, translationFileName(paper.id, att, 'en')), 'utf8')).pages, [{ page: 1, text: 'en' }]);
  for (const a of paper.attachments) assert.equal(sha(await fs.readFile(path.join(to.root, a.path))), a.sourceHash || sha(await fs.readFile(path.join(from.root, a.path))), a.path);
  assert.deepEqual(await snapshot(from.root), before, 'the sending vault is as it was');
  assert.deepEqual(await leftovers(to.vault), []);
});
test('a merge joins into the existing paper', async t => {
  const { from, to } = await twoVaults(t), one = await richPaper(from, 'one'), there = await plainPaper(to, 'one.pdf', pdf('one'));
  await to.library.saveNotes({ ...to.library.data.notes, [`${there.id}-메모`]: '받는 쪽 메모' });
  const { report } = await send(from, to.root, [one.id]);
  assert.equal(report.merged, 1);
  const library = await Library.open(to.root), merged = library.paper(there.id);
  assert.equal(library.data.papers.length, 1); assert.match(library.data.notes[`${there.id}-메모`], /받는 쪽 메모[\s\S]*\[one\.pdf\]|받는 쪽 메모[\s\S]*메모 !\[\]/);
  assert.ok(library.data.annotations.every(a => a.paperId === there.id) && library.data.annotations.length === 2);
  assert.deepEqual(JSON.parse(library.data.notes[`${there.id}-메모#order`]), [`${there.id}-메모-x`, `${there.id}-메모`]);
  assert.ok(Object.keys(library.data.notes).every(k => !k.startsWith(one.id + '-')));
  assert.equal(merged.attachments.filter(a => !a.trashedAt && a.role !== 'translated').length >= 1, true);
});
test('skip leaves the receiving copy untouched', async t => {
  const { from, to } = await twoVaults(t), one = await richPaper(from, 'one');
  await send(from, to.root, [one.id]); const before = await snapshot(to.root);
  const { report } = await send(from, to.root, [one.id]);
  assert.deepEqual(report.skipped.map(s => [s.id, s.reason]), [[one.id, 'exists']]); assert.deepEqual(report.sent, []);
  assert.deepEqual(await snapshot(to.root), before);
});
test('a failure undoes the whole send', async t => {
  for (const kind of ['ENOSPC', 'EACCES', 'save']) {
    const { from, to } = await twoVaults(t), one = await richPaper(from, 'one'), two = await richPaper(from, 'two');
    const base = sourceReader(from.root); let n = 0;
    const reader = { read: base.read, async copy(entry, out) {
      n++; if (kind === 'ENOSPC' && n === 3) throw Object.assign(Error('no space'), { code: 'ENOSPC' });
      if (kind === 'EACCES' && entry.kind === 'pdf') throw Object.assign(Error('denied'), { code: 'EACCES' });
      return base.copy(entry, out); } };
    const bundle = await collectBundle(from.library, [one.id, two.id]), planned = await planTransfer(bundle, await Library.peek(to.root)), target = await Library.open(to.root), before = await snapshot(to.root);
    if (kind === 'save') target.save = async () => { throw Error('cannot save'); };
    await assert.rejects(applyTransfer(planned, bundle, target, reader), kind === 'save' ? /cannot save/ : { code: kind }, kind);
    assert.deepEqual(await snapshot(to.root), before, kind); assert.deepEqual(await leftovers(to.vault), [], kind);
  }
});
test('cancelling before the save leaves nothing', async t => {
  const { from, to } = await twoVaults(t), one = await richPaper(from, 'one'), base = sourceReader(from.root), controller = new AbortController(); let n = 0;
  const reader = { read: base.read, async copy(entry, out) { await base.copy(entry, out); if (++n === 3) controller.abort(); } };
  const bundle = await collectBundle(from.library, [one.id]), planned = await planTransfer(bundle, await Library.peek(to.root)), target = await Library.open(to.root), before = await snapshot(to.root);
  await assert.rejects(applyTransfer(planned, bundle, target, reader, { signal: controller.signal }), { code: 'APP_TRANSFER_CANCELLED' });
  assert.deepEqual(await snapshot(to.root), before); assert.deepEqual(await leftovers(to.vault), []);
  // After the save a cancel is too late: the send goes to its end.
  const late = new AbortController(), again = await send(from, to.root, [one.id], { signal: late.signal, hooks: { afterSave: () => late.abort() } });
  assert.deepEqual(again.report.sent, [one.id]);
});
test('a whole copy adds vault lists, the receiving side wins', async t => {
  const { from, to } = await twoVaults(t); await richPaper(from, 'one');
  await from.library.transaction(() => { from.library.data.savedSearches = [{ id: 's-1', name: '내 검색', query: 'a' }, { id: 's-2', name: '같은 이름', query: 'b' }]; from.library.data.glossary = [{ term: 'cell', translation: '세포' }, { term: 'Gene', translation: '유전자' }]; from.library.data.translationRules = '존댓말'; });
  await to.library.transaction(() => { to.library.data.savedSearches = [{ id: 's-9', name: '같은 이름', query: 'z' }]; to.library.data.glossary = [{ term: 'gene', translation: '진' }]; });
  await send(from, to.root, null);
  const data = (await Library.open(to.root)).data;
  assert.deepEqual(data.savedSearches.map(s => [s.name, s.query]).sort(), [['같은 이름', 'z'], ['내 검색', 'a']]);
  assert.deepEqual(data.glossary.map(g => [g.term, g.translation]).sort(), [['cell', '세포'], ['gene', '진']]);
  assert.equal(data.translationRules, '존댓말', 'rules come when the receiving side has none');
  await from.library.transaction(() => { from.library.data.translationRules = '다른 규칙'; });
  const other = path.join(to.dir, 'other'); await fs.mkdir(other); await send(from, other, null);
  const third = path.join(to.dir, 'third'); await fs.mkdir(third); const thirdLib = await Library.open(third); await thirdLib.transaction(() => { thirdLib.data.translationRules = '받는 쪽 규칙'; });
  await send(from, third, null); assert.equal((await Library.open(third)).data.translationRules, '받는 쪽 규칙');
  // The AI requests: the same, apart from the translation requests.
  await from.library.setAiRules('수식은 LaTeX로');
  const fourth = path.join(to.dir, 'fourth'); await fs.mkdir(fourth); await send(from, fourth, null); assert.equal((await Library.open(fourth)).data.aiRules, '수식은 LaTeX로', 'AI requests come when the receiving side has none');
  const fifth = path.join(to.dir, 'fifth'); await fs.mkdir(fifth); const fifthLib = await Library.open(fifth); await fifthLib.setAiRules('받는 쪽 AI 요청');
  await send(from, fifth, null); assert.equal((await Library.open(fifth)).data.aiRules, '받는 쪽 AI 요청', 'the receiving side\'s stay');
});
test('an interrupted send is finished or undone on the next open', async t => {
  {
    const { from, to } = await twoVaults(t), one = await richPaper(from, 'one'), before = await snapshot(to.root), stop = stopAt(to.vault);
    await assert.rejects(send(from, to.root, [one.id], { hooks: { afterStage: stop.hook } }), /stopped/); await stop.restore();
    assert.ok((await leftovers(to.vault)).length > 0, 'the staged files and the journal are left as a crash leaves them');
    const library = await Library.open(to.root);
    assert.deepEqual(library.data.papers, []); assert.deepEqual(await leftovers(to.vault), []);
    const after = await snapshot(to.root); for (const name of Object.keys(after)) assert.ok(name in before || /library\.json$/.test(name), name);
  }
  {
    const { from, to } = await twoVaults(t), one = await richPaper(from, 'one'), stop = stopAt(to.vault);
    await assert.rejects(send(from, to.root, [one.id], { hooks: { afterSave: stop.hook } }), /stopped/);
    const library = await Library.open(to.root), att = library.paper(one.id).attachments[0];
    assert.equal(library.data.papers.length, 1, 'the PDF is registered once'); await fs.access(path.join(to.root, att.path));
    await fs.access(path.join(to.vault, 'ink', att.id, 'original.log')); assert.deepEqual(await leftovers(to.vault), []);
  }
});
test('a newer or damaged receiving vault is refused', async t => {
  for (const text of ['{broken', JSON.stringify({ version: 3, id: 'x', papers: [], notes: {} })]) {
    const { from, to } = await twoVaults(t); await richPaper(from, 'one'); await fs.writeFile(path.join(to.vault, 'library.json'), text);
    const before = await snapshot(to.root), code = text.startsWith('{b') ? 'APP_VAULT_DAMAGED' : 'APP_NEWER_VAULT';
    await assert.rejects(Library.peek(to.root), { code }); await assert.rejects(Library.open(to.root), { code });
    assert.deepEqual(await snapshot(to.root), before);
  }
});
test('missing and changed PDFs go as they are', async t => {
  const { from, to } = await twoVaults(t), gone = await plainPaper(from, 'gone.pdf', pdf('gone')), changed = await plainPaper(from, 'changed.pdf', pdf('changed'));
  await fs.rm(path.join(from.root, gone.attachments[0].path)); await fs.writeFile(path.join(from.root, changed.attachments[0].path), pdf('changed outside'));
  const { report } = await send(from, to.root, [gone.id, changed.id]);
  assert.deepEqual(report.sent.sort(), [gone.id, changed.id].sort());
  const library = await Library.open(to.root);
  await assert.rejects(fs.access(path.join(to.root, library.paper(gone.id).attachments[0].path)), 'no file for the missing PDF');
  const att = library.paper(changed.id).attachments[0]; assert.equal(att.sourceHash, changed.attachments[0].sourceHash, 'the stored fingerprint stays');
  assert.deepEqual(await fs.readFile(path.join(to.root, att.path)), pdf('changed outside'));
});

test('replace makes the receiving copy equal to the sending side', async t => {
  const { from, to } = await twoVaults(t), one = await richPaper(from, 'one');
  await send(from, to.root, [one.id]);
  // The receiving side changes its copy: a memo, an annotation, a PDF of its own, the PDF moved to another folder.
  let there = await Library.open(to.root);
  await there.saveNotes({ ...there.data.notes, [`${one.id}-메모-x`]: '받는 쪽에서 고침', [`${one.id}-메모-y`]: '받는 쪽에만' });
  await there.transaction(() => { there.data.annotations.push({ id: crypto.randomUUID(), paperId: one.id, attachmentId: one.att.id, page: 3, quote: 'mine', body: '', createdAt: new Date().toISOString() }); });
  const extra = path.join(to.dir, 'extra.pdf'); await fs.writeFile(extra, pdf('extra')); const [added] = await there.importPDFs([extra], { paperId: one.id, role: 'supplement' });
  await writeFile(path.join(to.vault, 'ai', added.attachmentId + '.json'), '{"version":1,"results":[]}');
  await fs.mkdir(path.join(to.root, 'moved')); await there.moveAttachment(one.id, one.att.id, 'moved', 'one.pdf');
  await writeFile(path.join(to.vault, 'ink', one.att.id, 'stray.log'), 'theirs');
  // The sending side changes: a memo, more ink, the PDF itself (outside the app).
  await from.library.saveNotes({ ...from.library.data.notes, [`${one.id}-메모-x`]: '보낸 쪽에서 고침' });
  await writeFile(path.join(from.vault, 'ink', one.att.id, 'original.json'), '{"strokes":[]}');
  await fs.writeFile(path.join(from.root, one.att.path), pdf('one, changed'));
  const labels = async () => { const dir = path.join(to.vault, 'backups'), out = []; for (const name of await fs.readdir(dir).catch(() => [])) out.push(JSON.parse(await fs.readFile(path.join(dir, name), 'utf8')).label); return out; };
  const receivedBefore = (await labels()).filter(l => l === '다른 저장소에서 받기 전').length;
  const discarded = [];
  const { report } = await send(from, to.root, [one.id], { existing: 'replace', discard: async file => { discarded.push(path.relative(to.root, file)); await fs.rm(file); } });
  assert.deepEqual([report.replaced, report.sent], [1, [one.id]]);
  there = await Library.open(to.root); const paper = there.paper(one.id), mine = k => Object.keys(there.data.notes).filter(x => x.startsWith(k + '-')).sort();
  assert.deepEqual(mine(one.id), Object.keys(from.library.data.notes).filter(x => x.startsWith(one.id + '-')).sort(), 'the memos are the sending side\'s, no more');
  assert.equal(there.data.notes[`${one.id}-메모-x`], '보낸 쪽에서 고침');
  assert.equal(there.data.annotations.filter(a => a.paperId === one.id).length, 2, 'the annotations are the sending side\'s');
  const original = paper.attachments.find(a => a.id === one.att.id);
  assert.equal(original.path, 'moved/one.pdf', 'the folder it was moved to is kept'); assert.deepEqual(await fs.readFile(path.join(to.root, 'moved', 'one.pdf')), pdf('one, changed'));
  assert.deepEqual(discarded, [path.join('moved', 'one.pdf')], 'the old file went to the trash');
  assert.deepEqual((await fs.readdir(path.join(to.vault, 'ink', one.att.id))).sort(), ['original.json', 'original.log'], 'the ink is the sending side\'s');
  assert.ok(paper.attachments.some(a => a.id === added.attachmentId), 'the receiving side\'s own PDF stays'); await fs.access(path.join(to.vault, 'ai', added.attachmentId + '.json'));
  assert.equal((await fs.readdir(path.join(to.vault, 'notebooks'))).filter(n => n.endsWith('.json')).length, 1, 'one notebook, not two');
  assert.equal((await labels()).filter(l => l === '다른 저장소에서 받기 전').length, receivedBefore + 1, 'a backup before receiving');
  assert.deepEqual(await leftovers(to.vault), []);
});

// ---- Moving: what arrived is removed from the sending vault, after the receiving one is checked.
async function move(from, toRoot, ids, { existing = 'skip', reader = sourceReader(from.root), discard } = {}) {
  const bundle = await collectBundle(from.library, ids), planned = await planTransfer(bundle, await Library.peek(toRoot), { existing }), target = await Library.open(toRoot);
  return runTransfer({ bundle, source: from.library, target, reader, plan: planned, mode: 'move', discard, notebooks: new NotebookStore(from.library) });
}
test('a move removes only what arrived', async t => {
  const { from, to } = await twoVaults(t), a = await richPaper(from, 'a'), b = await richPaper(from, 'b'), c = await richPaper(from, 'c');
  // c was sent before (skipped now); it also shows a's memo picture, which therefore stays.
  await send(from, to.root, [c.id]);
  await from.library.saveNotes({ ...from.library.data.notes, [`${c.id}-메모-shared`]: `![](note-image:${a.memoPicture})` });
  const discarded = [], { report, removed } = await move(from, to.root, [a.id, b.id, c.id], { discard: async file => { discarded.push(path.relative(from.root, file).split(path.sep).join('/')); await fs.rm(file); } });
  assert.deepEqual(report.sent.sort(), [a.id, b.id].sort()); assert.deepEqual(report.skipped.map(s => s.id), [c.id]); assert.deepEqual(removed.failed, []);
  const library = await Library.open(from.root);
  assert.deepEqual(library.data.papers.map(p => p.id), [c.id], 'the skipped paper stays');
  assert.ok(Object.keys(library.data.notes).every(k => k.startsWith(c.id + '-'))); assert.ok(library.data.annotations.every(x => x.paperId === c.id));
  for (const gone of [a, b]) {
    for (const file of [`ink/${gone.att.id}`, `ai/${gone.att.id}.json`, `corrections/${gone.att.id}.json`, gone.translation, `notebooks/${gone.notebook.id}.json`, `note-images/${gone.annotationPicture}`, `notebooks/assets/${gone.notebookAsset}.png`]) await assert.rejects(fs.access(path.join(from.vault, file)), file);
  }
  await fs.access(path.join(from.vault, 'note-images', a.memoPicture)); await fs.access(path.join(from.vault, 'notebooks', c.notebook.id + '.json'));
  assert.equal(discarded.length, 6, 'each moved paper\'s three PDFs went to the trash'); assert.ok(discarded.every(f => /\.pdf$/.test(f)));
  const labels = []; for (const name of await fs.readdir(path.join(from.vault, 'backups'))) labels.push(JSON.parse(await fs.readFile(path.join(from.vault, 'backups', name), 'utf8')).label);
  assert.ok(labels.includes('다른 저장소로 옮기기 전'));
  const there = await Library.open(to.root); assert.deepEqual(there.data.papers.map(p => p.id).sort(), [a.id, b.id, c.id].sort());
});
test('a whole move leaves an empty vault', async t => {
  const { from, to } = await twoVaults(t); await richPaper(from, 'a'); await richPaper(from, 'b');
  await writeFile(path.join(from.vault, 'ai', 'comparisons.json'), '{"version":1}'); await writeFile(path.join(from.root, 'readme.txt'), 'mine');
  const loose = crypto.randomUUID(); await writeFile(path.join(from.vault, 'notebooks', loose + '.json'), JSON.stringify({ id: loose, title: 'p', paperId: null, pages: [] }));
  const { removed } = await move(from, to.root, null);
  const library = await Library.open(from.root);
  assert.deepEqual([library.data.papers.length, Object.keys(library.data.notes).length, library.data.annotations.length], [0, 0, 0]);
  assert.deepEqual((await fs.readdir(path.join(from.vault, 'notebooks')).catch(() => [])).filter(n => n.endsWith('.json')), []);
  await fs.access(path.join(from.vault, 'ai', 'comparisons.json')); await fs.access(path.join(from.root, 'readme.txt')); assert.ok((await fs.readdir(path.join(from.vault, 'backups'))).length > 0);
  assert.equal(removed.removed, 2);
  assert.equal((await Library.open(to.root)).data.papers.length, 2);
  await fs.access(path.join(to.vault, 'notebooks', loose + '.json'));
});
test('nothing is removed when the send failed', async t => {
  for (const kind of ['copy', 'verify']) {
    const { from, to } = await twoVaults(t), a = await richPaper(from, 'a'), base = sourceReader(from.root), before = await snapshot(from.root);
    const reader = { read: base.read, async copy(entry, out) { if (kind === 'copy' && entry.kind === 'ink') throw Object.assign(Error('no space'), { code: 'ENOSPC' }); await base.copy(entry, out); if (kind === 'verify' && entry.kind === 'ai') await fs.appendFile(out, ' '); } };
    await assert.rejects(move(from, to.root, [a.id], { reader }), kind);
    assert.deepEqual(await snapshot(from.root), before, kind);
  }
});

// ---- Review fixes: every case below failed before its fix.
// What an app stopped in leaves: the staging folder and the journal as they were when the hook ran (a send that fails
// clears them; one the app stops in cannot), put back after the failure.
function stopAt(vault) {
  const keep = path.join(path.dirname(path.dirname(vault)), `stopped-${crypto.randomUUID()}`);
  return {
    hook: async () => { await fs.mkdir(keep, { recursive: true }); for (const name of (await fs.readdir(vault)).filter(n => n.startsWith('transfer-'))) await fs.cp(path.join(vault, name), path.join(keep, name), { recursive: true }); throw Error('the app stopped'); },
    async restore() { for (const name of await fs.readdir(keep)) await fs.cp(path.join(keep, name), path.join(vault, name), { recursive: true }); },
  };
}
const live = paper => paper.attachments.filter(a => !a.trashedAt && a.role !== 'translated');
const onDisk = async (root, a) => fs.readFile(path.join(root, a.path)).then(sha, () => null);

test('M1: a PDF recorded on the receiving side but missing there is copied, and a move keeps it', async t => {
  const { from, to } = await twoVaults(t), sent = await plainPaper(from, 'a.pdf', pdf('a')), there = await plainPaper(to, 'a.pdf', pdf('a'));
  await fs.rm(path.join(to.root, there.attachments[0].path));
  const { report } = await move(from, to.root, [sent.id]);
  assert.equal(report.merged, 1);
  const kept = (await Library.open(to.root)).paper(there.id), found = [];
  for (const a of live(kept)) found.push(await onDisk(to.root, a));
  assert.ok(found.includes(sha(pdf('a'))), 'the PDF is in the receiving vault');
});
test('M1: a PDF changed outside the app goes as it is, also when the receiving side has the old one', async t => {
  const { from, to } = await twoVaults(t), sent = await plainPaper(from, 'a.pdf', pdf('a')), there = await plainPaper(to, 'a.pdf', pdf('a'));
  await fs.writeFile(path.join(from.root, sent.attachments[0].path), pdf('a, changed'));
  const planned = await plan(await collectBundle(from.library, [sent.id]), to.root);
  assert.equal(planned.files.find(f => f.entry.kind === 'pdf').reuse, false, 'not the same file as the one there');
  await move(from, to.root, [sent.id]);
  const kept = (await Library.open(to.root)).paper(there.id), found = [];
  for (const a of kept.attachments) found.push(await onDisk(to.root, a));
  assert.ok(found.includes(sha(pdf('a, changed'))), 'the changed PDF arrived');
});
test('M2: a place that cannot be made stops the send before the receiving vault is saved', async t => {
  for (const kind of ['file in the way', 'name too long']) {
    const { from, to } = await twoVaults(t);
    let sent;
    if (kind === 'file in the way') { sent = await plainPaper(from, 'a.pdf', pdf('a'), '연구'); await fs.writeFile(path.join(to.root, '연구'), 'a file named like the folder'); }
    else { const name = 'x'.repeat(250) + '.pdf'; sent = await plainPaper(from, name, pdf('a')); await writeFile(path.join(to.root, 'papers', name), 'taken'); }
    const before = await snapshot(to.root);
    await assert.rejects(send(from, to.root, [sent.id]), kind);
    assert.deepEqual(await snapshot(to.root), before, kind); assert.deepEqual(await leftovers(to.vault), [], kind);
    await Library.open(to.root);
  }
});
test('M2: a move into place failing on the next open does not keep the vault from opening', async t => {
  const { from, to } = await twoVaults(t), sent = await plainPaper(from, 'a.pdf', pdf('a'), '연구'), stop = stopAt(to.vault);
  await assert.rejects(send(from, to.root, [sent.id], { hooks: { afterSave: stop.hook } }), /stopped/);
  await fs.rm(path.join(to.root, '연구'), { recursive: true, force: true }); await fs.writeFile(path.join(to.root, '연구'), 'in the way');
  const library = await Library.open(to.root);
  assert.equal(library.data.papers.length, 1);
});
test('M3: a journal planted in a vault moves nothing in or out of it', async t => {
  const { to } = await twoVaults(t), outside = path.join(to.dir, 'secret.txt'); await fs.writeFile(outside, 'secret');
  const id = crypto.randomUUID(), stage = path.join(to.vault, `transfer-${id}`); await fs.mkdir(stage); await fs.writeFile(path.join(stage, '1'), 'planted');
  await fs.writeFile(path.join(to.vault, `transfer-${id}.json`), JSON.stringify({ version: 1, id, before: 'x', papers: [], attachments: [], annotations: [], removals: [{ to: '../../secret.txt', internal: false }],
    moves: [{ staged: '../../../secret.txt', to: 'stolen.txt', internal: false }, { staged: '1', to: '../planted-outside.txt', internal: false }, { staged: '1', to: '../../planted-too.txt', internal: true }] }));
  await Library.open(to.root);
  assert.equal(await fs.readFile(outside, 'utf8'), 'secret');
  for (const file of [path.join(to.root, 'stolen.txt'), path.join(to.dir, 'planted-outside.txt'), path.join(to.dir, 'planted-too.txt')]) await assert.rejects(fs.access(file), file);
});
test('M4: the whole vault takes a notebook whose paper is gone, and a whole move removes it', async t => {
  const { from, to } = await twoVaults(t); await richPaper(from, 'a');
  const orphan = crypto.randomUUID(); await writeFile(path.join(from.vault, 'notebooks', orphan + '.json'), JSON.stringify({ id: orphan, title: '남은 노트', paperId: 999999, pages: [] }));
  await move(from, to.root, null);
  const arrived = JSON.parse(await fs.readFile(path.join(to.vault, 'notebooks', orphan + '.json'), 'utf8'));
  assert.equal(arrived.paperId, null, 'no paper there, none named');
  await assert.rejects(fs.access(path.join(from.vault, 'notebooks', orphan + '.json')));
});
test('S1: a notebook names its place by its file, not by what is written in it', async t => {
  const { from, to } = await twoVaults(t), sent = await plainPaper(from, 'a.pdf', pdf('a')), id = crypto.randomUUID();
  await writeFile(path.join(from.vault, 'notebooks', id + '.json'), JSON.stringify({ id: '../../../escaped-notebook', title: 'n', paperId: sent.id, pages: [] }));
  await send(from, to.root, [sent.id]);
  await fs.access(path.join(to.vault, 'notebooks', id + '.json'));
  assert.ok(!(await fs.readdir(to.dir, { recursive: true })).some(n => n.includes('escaped-notebook')));
});
test('S1: a bundle naming places outside the vault or records that do not fit is refused before anything is written', async t => {
  const { from, to } = await twoVaults(t), sent = await plainPaper(from, 'a.pdf', pdf('a'));
  await writeFile(path.join(from.vault, `translation-${sent.id}.json`), '{"version":1,"pages":[]}');
  const spoil = {
    'a PDF of no attachment': b => b.files.push({ kind: 'pdf', path: '../outside.pdf', internal: false, size: 1, sha256: sha(pdf('a')) }),
    'a picture path': b => b.files.push({ kind: 'note-image', path: 'note-images/../../escaped.png', internal: true, size: 1, sha256: sha(pdf('a')) }),
    'a language': b => { b.files.find(f => f.kind === 'translation').language = '../../escaped'; },
    'a cache key': b => { b.papers[0].attachments[0].cacheKey = '../escaped'; },
    'an annotation of no attachment': b => b.annotations.push({ id: crypto.randomUUID(), paperId: sent.id, attachmentId: 'missing', page: 1, quote: '', body: '', createdAt: '' }),
  };
  for (const [what, change] of Object.entries(spoil)) {
    const bundle = await collectBundle(from.library, [sent.id]); change(bundle);
    const before = await snapshot(to.root);
    await assert.rejects((async () => { const planned = await planTransfer(bundle, await Library.peek(to.root)); await applyTransfer(planned, bundle, await Library.open(to.root), sourceReader(from.root)); })(), what);
    assert.deepEqual(await snapshot(to.root), before, what); assert.ok(!(await fs.readdir(to.dir, { recursive: true })).some(n => n.includes('escaped')), what);
    await Library.open(to.root);
  }
});
test('S2: sending again adds nothing, also after a merge that reused the PDF there and for notebooks of no paper', async t => {
  const { from, to } = await twoVaults(t), sent = await plainPaper(from, 'a.pdf', pdf('a')), there = await plainPaper(to, 'a.pdf', pdf('a'));
  await from.library.saveNotes({ ...from.library.data.notes, [`${sent.id}-메모`]: '보낸 메모' });
  const loose = crypto.randomUUID(); await writeFile(path.join(from.vault, 'notebooks', loose + '.json'), JSON.stringify({ id: loose, title: '프로젝트', paperId: null, pages: [] }));
  await send(from, to.root, null); const once = await snapshot(to.root);
  const { report } = await send(from, to.root, null);
  assert.deepEqual(report.sent, []); assert.deepEqual(report.skipped.map(s => s.id), [sent.id]);
  const twice = await snapshot(to.root);
  assert.deepEqual(Object.keys(twice).filter(n => !/library\.json$/.test(n)).sort(), Object.keys(once).filter(n => !/library\.json$/.test(n)).sort());
  const data = (await Library.open(to.root)).data;
  assert.equal((data.notes[`${there.id}-메모`].match(/보낸 메모/g) || []).length, 1, 'the memo joined once');
  assert.equal((await fs.readdir(path.join(to.vault, 'notebooks'))).filter(n => n.endsWith('.json')).length, 1);
});
test('S3: two papers sent onto one PDF there keep both their records', async t => {
  const { from, to } = await twoVaults(t), one = await plainPaper(from, 'a.pdf', pdf('a')), two = await plainPaper(from, 'b.pdf', pdf('a')); await plainPaper(to, 'a.pdf', pdf('a'));
  for (const [p, text] of [[one, 'first'], [two, 'second']]) {
    await writeFile(path.join(from.vault, 'ink', p.attachments[0].id, 'original.log'), text);
    await writeFile(path.join(from.vault, `translation-${p.id}.json`), JSON.stringify({ version: 1, pages: [{ page: 1, text }] }));
  }
  await send(from, to.root, [one.id, two.id]);
  const library = await Library.open(to.root), inks = [], translations = [];
  for (const paper of library.data.papers) for (const a of paper.attachments) {
    inks.push(await fs.readFile(path.join(to.vault, 'ink', a.id, 'original.log'), 'utf8').catch(() => null));
    translations.push(await fs.readFile(path.join(to.vault, translationFileName(paper.id, a)), 'utf8').then(t => JSON.parse(t).pages[0].text, () => null));
  }
  assert.deepEqual(inks.filter(Boolean).sort(), ['first', 'second']); assert.deepEqual(translations.filter(Boolean).sort(), ['first', 'second']);
});
test('S4: a folder of the receiving vault that is a link is not followed', async t => {
  const { from, to } = await twoVaults(t), sent = await plainPaper(from, 'a.pdf', pdf('a'), '연구'), elsewhere = path.join(to.dir, 'elsewhere'); await fs.mkdir(elsewhere);
  await fs.symlink(elsewhere, path.join(to.root, '연구'));
  await assert.rejects(send(from, to.root, [sent.id]));
  assert.deepEqual(await fs.readdir(elsewhere), []); assert.deepEqual(await leftovers(to.vault), []);
});
test('S5: no two attachments share a translation record name after a send', async t => {
  const { from, to } = await twoVaults(t), sent = await plainPaper(from, 'a.pdf', pdf('a')), there = await plainPaper(to, 'z.pdf', pdf('z'));
  await to.library.transaction(() => { const a = to.library.paper(there.id).attachments[0]; a.cacheOwnerId = sent.id; a.cacheKey = ''; });
  await from.library.transaction(() => { const a = from.library.paper(sent.id).attachments[0]; a.cacheOwnerId = sent.id; a.cacheKey = ''; });
  await send(from, to.root, [sent.id]);
  const library = await Library.open(to.root), names = library.data.papers.flatMap(p => p.attachments.map(a => translationFileName(p.id, a)));
  assert.equal(new Set(names).size, names.length, names.join(' '));
});
test('S6: a translation in another language is work, so both copies stay', async t => {
  const { from, to } = await twoVaults(t), sent = await plainPaper(from, 'a.pdf', pdf('a')), there = await plainPaper(to, 'a.pdf', pdf('a'));
  await writeFile(path.join(from.vault, translationFileName(sent.id, sent.attachments[0], 'en')), '{"version":1,"pages":[{"page":1,"text":"mine"}]}');
  await writeFile(path.join(to.vault, translationFileName(there.id, there.attachments[0], 'en')), '{"version":1,"pages":[{"page":1,"text":"theirs"}]}');
  assert.equal(await to.library.attachmentWork(there.id, there.attachments[0]), true);
  const { report } = await send(from, to.root, [sent.id]);
  assert.equal(report.merged, 1);
});
test('S7: a memo figure and pin follow a renumbered attachment', async t => {
  const { from, to } = await twoVaults(t), sent = await plainPaper(from, 'a.pdf', pdf('a')), other = await plainPaper(to, 'z.pdf', pdf('z')), legacy = `original-${sent.id}`;
  await from.library.transaction(() => { const p = from.library.paper(sent.id); p.attachments[0].id = legacy; p.primaryAttachmentId = legacy; });
  await to.library.transaction(() => { const p = to.library.paper(other.id); p.attachments[0].id = legacy; p.primaryAttachmentId = legacy; });
  await from.library.saveNotes({ ...from.library.data.notes, [`${sent.id}-메모`]: '그림', [`${sent.id}-메모#figure`]: JSON.stringify({ attachmentId: legacy, page: 2, rect: [0, 0, 1, 1] }), [`${sent.id}-메모#pin`]: JSON.stringify({ attachmentId: legacy, page: 1 }) });
  await send(from, to.root, [sent.id]);
  const library = await Library.open(to.root), paper = library.data.papers.find(p => p.title === sent.title && p.attachments[0].id !== legacy), id = paper.attachments[0].id;
  assert.equal(JSON.parse(library.data.notes[`${paper.id}-메모#figure`]).attachmentId, id);
  assert.equal(JSON.parse(library.data.notes[`${paper.id}-메모#pin`]).attachmentId, id);
});
test('S8: a renumbered paper\'s citation key is no other paper\'s, default keys included', async t => {
  const { from, to } = await twoVaults(t), sent = await plainPaper(from, 'a.pdf', pdf('a')), there = await plainPaper(to, 'z.pdf', pdf('z'));
  await to.library.transaction(() => { to.library.paper(there.id).id = sent.id; });
  await send(from, to.root, [sent.id]);
  const keys = (await Library.open(to.root)).data.papers.map(p => p.citekey || appName.citekeyPrefix + p.id);
  assert.equal(new Set(keys).size, keys.length, keys.join(' '));
});
test('S9: a PDF changed between collecting and copying stops the send before the save', async t => {
  const { from, to } = await twoVaults(t), sent = await plainPaper(from, 'a.pdf', pdf('a'));
  const bundle = await collectBundle(from.library, [sent.id]), planned = await planTransfer(bundle, await Library.peek(to.root)), target = await Library.open(to.root), before = await snapshot(to.root);
  await fs.writeFile(path.join(from.root, sent.attachments[0].path), pdf('a, changed meanwhile'));
  await assert.rejects(applyTransfer(planned, bundle, target, sourceReader(from.root)));
  assert.deepEqual(await snapshot(to.root), before); assert.deepEqual(await leftovers(to.vault), []);
});
test('S10: a vault in an earlier name\'s folder is planned from that folder', async t => {
  const { from, to } = await twoVaults(t), sent = await plainPaper(from, 'a.pdf', pdf('a')), there = await plainPaper(to, 'a.pdf', pdf('a'));
  await writeFile(path.join(from.vault, 'ink', sent.attachments[0].id, 'original.log'), 'mine');
  await writeFile(path.join(to.vault, 'ink', there.attachments[0].id, 'original.log'), 'theirs');
  await fs.rename(to.vault, path.join(to.root, appName.oldVaultDirs[0]));
  const planned = await plan(await collectBundle(from.library, [sent.id]), to.root);
  assert.equal(planned.files.find(f => f.entry.kind === 'pdf').reuse, false, 'both carry work');
});
test('saved searches name the collections they arrive with; collections whose parent never comes are kept at the top', async t => {
  const { from, to } = await twoVaults(t); await plainPaper(from, 'a.pdf', pdf('a'));
  await from.library.transaction(() => { from.library.data.collections.push({ id: 'col-a', name: '모음' }); });
  await from.library.saveSearch({ name: '검색', query: 'x', collectionId: 'col-a' }); await from.library.saveSearch({ name: '모음 없이', query: 'y' });
  await to.library.transaction(() => { to.library.data.collections.push({ id: 'col-a', name: '전혀 다른 모음' }); });
  const bundle = await collectBundle(from.library, null);
  bundle.collections.push({ id: 'loop-1', name: '고리 1', parentId: 'loop-2' }, { id: 'loop-2', name: '고리 2', parentId: 'loop-1' });
  const planned = await plan(bundle, to.root);
  assert.ok(planned.ids.collections.has('loop-1') && planned.ids.collections.has('loop-2'), 'none dropped');
  await send(from, to.root, null);
  const data = (await Library.open(to.root)).data, search = data.savedSearches.find(s => s.name === '검색');
  assert.equal(data.collections.find(c => c.id === search.collectionId)?.name, '모음', 'the search names the collection it came with');
  assert.equal(data.savedSearches.find(s => s.name === '모음 없이').collectionId, null);
});
test('planning and sending never read a PDF whole', async t => {
  const { from, to } = await twoVaults(t), one = await richPaper(from, 'one'), there = await plainPaper(to, 'one.pdf', pdf('one'));
  await to.library.transaction(() => { delete to.library.paper(there.id).attachments[0].sourceHash; });
  const read = fs.readFile, pdfs = [];
  fs.readFile = function (file, ...rest) { if (/\.pdf$/i.test(String(file))) pdfs.push(String(file)); return read.call(this, file, ...rest); };
  t.after(() => { fs.readFile = read; });
  const bundle = await collectBundle(from.library, [one.id]), planned = await planTransfer(bundle, await Library.peek(to.root));
  assert.deepEqual(pdfs, [], 'planning');
  const target = await Library.open(to.root); pdfs.length = 0; // opening a vault fingerprints its PDFs as it always has
  await applyTransfer(planned, bundle, target, sourceReader(from.root));
  fs.readFile = read;
  assert.deepEqual(pdfs, [], 'sending');
});
test('a send stopped while its files were being put in place is finished on the next open', async t => {
  const { from, to } = await twoVaults(t), one = await richPaper(from, 'one'), stop = stopAt(to.vault);
  await assert.rejects(send(from, to.root, [one.id], { hooks: { afterSave: stop.hook } }), /stopped/);
  // Some files had already been moved when it stopped.
  const [journalName] = (await leftovers(to.vault)).filter(n => n.endsWith('.json')), journal = JSON.parse(await fs.readFile(path.join(to.vault, journalName), 'utf8'));
  const first = journal.moves.find(m => !m.internal), place = path.join(to.root, ...first.to.split('/'));
  await fs.mkdir(path.dirname(place), { recursive: true }); await fs.rename(path.join(to.vault, journalName.slice(0, -5), first.staged), place);
  const library = await Library.open(to.root), att = library.paper(one.id).attachments[0];
  await fs.access(path.join(to.root, att.path)); await fs.access(path.join(to.vault, 'ink', att.id, 'original.log'));
  assert.deepEqual(await leftovers(to.vault), []);
});
test('a journal naming no ids (a replace) is finished or undone by the saved records', async t => {
  for (const at of ['afterStage', 'afterSave']) {
    const { from, to } = await twoVaults(t), one = await richPaper(from, 'one');
    await send(from, to.root, [one.id]);
    await from.library.saveNotes({ ...from.library.data.notes, [`${one.id}-메모-x`]: '바꾼 메모' });
    await writeFile(path.join(from.vault, 'ink', one.att.id, 'original.log'), '{"seq":2}\n');
    const stop = stopAt(to.vault);
    await assert.rejects(send(from, to.root, [one.id], { existing: 'replace', hooks: { [at]: stop.hook } }), /stopped/, at);
    if (at === 'afterStage') await stop.restore();
    const journal = JSON.parse(await fs.readFile(path.join(to.vault, (await leftovers(to.vault)).find(n => n.endsWith('.json'))), 'utf8'));
    assert.equal([...journal.papers, ...journal.attachments, ...journal.annotations].length, 0, at);
    const library = await Library.open(to.root);
    assert.equal(library.data.notes[`${one.id}-메모-x`], at === 'afterSave' ? '바꾼 메모' : '둘째', at);
    assert.equal(await fs.readFile(path.join(to.vault, 'ink', one.att.id, 'original.log'), 'utf8'), at === 'afterSave' ? '{"seq":2}\n' : '{"seq":1}\n', at);
    assert.deepEqual(await leftovers(to.vault), [], at);
  }
});
test('a journal of an unknown version is left for the app that wrote it', async t => {
  const { to } = await twoVaults(t), id = crypto.randomUUID();
  await fs.mkdir(path.join(to.vault, `transfer-${id}`)); await fs.writeFile(path.join(to.vault, `transfer-${id}.json`), JSON.stringify({ version: 2, id, moves: [] }));
  await Library.open(to.root);
  assert.deepEqual((await leftovers(to.vault)).sort(), [`transfer-${id}`, `transfer-${id}.json`]);
});

// ---- Review of the screen and the move (Tasks 5–7): every case below failed before its fix.
test('replacing two earlier copies the receiving side merged into one skips both, and a move keeps them', async t => {
  const { from, to } = await twoVaults(t), x = await plainPaper(from, 'x.pdf', pdf('x')), y = await plainPaper(from, 'y.pdf', pdf('y'));
  await from.library.saveNotes({ ...from.library.data.notes, [`${x.id}-메모`]: 'X의 메모', [`${x.id}-summary-0`]: 'X 요약', [`${y.id}-메모`]: 'Y의 메모' });
  await send(from, to.root, [x.id, y.id]);
  const there = await Library.open(to.root); await there.mergePapers(x.id, y.id);
  const { report } = await move(from, to.root, [x.id, y.id], { existing: 'replace' });
  assert.deepEqual(report.sent, []); assert.deepEqual(report.skipped.map(s => s.id).sort(), [x.id, y.id].sort());
  assert.ok(report.skipped.every(s => s.reason === 'joined'), 'told why');
  const left = await Library.open(from.root);
  assert.deepEqual(left.data.papers.map(p => p.id).sort(), [x.id, y.id].sort(), 'nothing removed from the sending side');
  assert.equal(left.data.notes[`${x.id}-메모`], 'X의 메모');
});
test('the check after a send compares the memos written', async t => {
  const { from, to } = await twoVaults(t), one = await plainPaper(from, 'a.pdf', pdf('a'));
  await from.library.saveNotes({ ...from.library.data.notes, [`${one.id}-메모`]: '보낸 메모' });
  const bundle = await collectBundle(from.library, [one.id]), planned = await planTransfer(bundle, await Library.peek(to.root)), target = await Library.open(to.root);
  const transaction = target.transaction.bind(target);
  target.transaction = change => transaction(async () => { await change(); delete target.data.notes[`${one.id}-메모`]; });
  await assert.rejects(applyTransfer(planned, bundle, target, sourceReader(from.root)));
});
test('a leftover that cannot be removed after a move is told, and the move stands', async t => {
  const { from, to } = await twoVaults(t), one = await richPaper(from, 'one');
  const rm = fs.rm; fs.rm = function (file, ...rest) { if (String(file).startsWith(from.vault) && String(file).includes('note-images')) return Promise.reject(Object.assign(Error(`EBUSY: resource busy or locked, unlink '${file}'`), { code: 'EBUSY' })); return rm.call(this, file, ...rest); };
  t.after(() => { fs.rm = rm; });
  const result = await move(from, to.root, [one.id]); fs.rm = rm;
  assert.deepEqual(result.report.sent, [one.id]); assert.ok(result.removed.failed.length > 0, 'what was left is told');
  assert.ok(!result.removed.failed.some(f => String(f).includes(from.root)), 'by name, not by path');
  assert.deepEqual((await Library.open(from.root)).data.papers, []);
});
test('a replace that changes only files is finished after the app stopped while moving them', async t => {
  const { from, to } = await twoVaults(t), one = await richPaper(from, 'one');
  await send(from, to.root, [one.id]);
  await writeFile(path.join(from.vault, 'ink', one.att.id, 'original.json'), '{"strokes":[1]}');
  await writeFile(path.join(from.vault, 'ink', one.att.id, 'original.log'), '{"seq":9}\n');
  const stop = stopAt(to.vault);
  await assert.rejects(send(from, to.root, [one.id], { existing: 'replace', hooks: { afterSave: stop.hook } }), /stopped/);
  const [journalName] = (await leftovers(to.vault)).filter(n => n.endsWith('.json')), journal = JSON.parse(await fs.readFile(path.join(to.vault, journalName), 'utf8'));
  const first = journal.moves.find(m => m.to.endsWith('original.json')), place = path.join(to.vault, ...first.to.split('/'));
  await fs.rename(path.join(to.vault, journalName.slice(0, -5), first.staged), place);
  await Library.open(to.root);
  assert.equal(await fs.readFile(path.join(to.vault, 'ink', one.att.id, 'original.log'), 'utf8'), '{"seq":9}\n', 'the rest was moved in, not rolled back');
  assert.deepEqual(await leftovers(to.vault), []);
});
test('a paper with an attachment id of the old form is known when sent again', async t => {
  for (const clash of [false, true]) {
    const { from, to } = await twoVaults(t), sent = await plainPaper(from, 'old.pdf', pdf('old')), legacy = `original-${sent.id}`;
    await from.library.transaction(() => { const p = from.library.paper(sent.id); p.attachments[0].id = legacy; p.primaryAttachmentId = legacy; });
    await from.library.saveNotes({ ...from.library.data.notes, [`${sent.id}-메모`]: '메모' });
    if (clash) { const other = await plainPaper(to, 'z.pdf', pdf('z')); await to.library.transaction(() => { to.library.paper(other.id).id = sent.id; }); }
    await send(from, to.root, [sent.id]); const once = await snapshot(to.root);
    for (const existing of ['skip', 'replace']) {
      const { report } = await send(from, to.root, [sent.id], { existing });
      assert.equal(report.merged, 0, `${clash} ${existing}`);
      const files = Object.keys(await snapshot(to.root)).filter(n => n.endsWith('.pdf'));
      assert.deepEqual(files.sort(), Object.keys(once).filter(n => n.endsWith('.pdf')).sort(), `no second copy (${clash} ${existing})`);
    }
    const data = (await Library.open(to.root)).data;
    assert.equal(Object.values(data.notes).filter(v => v === '메모').length, 1);
  }
});
test('replace keeps the citation key a renumbered copy was given', async t => {
  const { from, to } = await twoVaults(t), sent = await plainPaper(from, 'a.pdf', pdf('a')), other = await plainPaper(to, 'z.pdf', pdf('z'));
  await to.library.transaction(() => { to.library.paper(other.id).id = sent.id; });
  await send(from, to.root, [sent.id]);
  const copy = (await Library.open(to.root)).data.papers.find(p => p.citekey === appName.citekeyPrefix + sent.id + 'a' || p.citekey === appName.citekeyPrefix + sent.id);
  assert.ok(copy, 'the first send wrote the old default key');
  await send(from, to.root, [sent.id], { existing: 'replace' });
  assert.equal((await Library.open(to.root)).paper(copy.id).citekey, copy.citekey);
});
test('replace keeps a notebook the receiving side made for the paper', async t => {
  const { from, to } = await twoVaults(t), one = await richPaper(from, 'one');
  await send(from, to.root, [one.id]);
  const theirs = crypto.randomUUID(); await writeFile(path.join(to.vault, 'notebooks', theirs + '.json'), JSON.stringify({ id: theirs, title: '받는 쪽 노트', paperId: one.id, pages: [] }));
  await send(from, to.root, [one.id], { existing: 'replace' });
  await fs.access(path.join(to.vault, 'notebooks', theirs + '.json'));
});
test('a move removes the translation records in every language', async t => {
  const { from, to } = await twoVaults(t), one = await richPaper(from, 'one');
  await move(from, to.root, [one.id]);
  assert.deepEqual((await fs.readdir(from.vault)).filter(n => n.startsWith('translation-')), []);
});
test('file errors are told in words, without the folders they name', async t => {
  const { from, to } = await twoVaults(t), one = await plainPaper(from, 'a.pdf', pdf('a')), base = sourceReader(from.root);
  const reader = { read: base.read, async copy() { throw Object.assign(Error(`ENOENT: no such file or directory, copyfile '${from.root}/papers/a.pdf'`), { code: 'ENOENT' }); } };
  await assert.rejects(send(from, to.root, [one.id], { reader }), error => error.code === 'ENOENT' && !error.message.includes(from.root) && /[가-힣]/.test(error.message));
  await assert.rejects(collectBundle(from.library, [424242]), error => /[가-힣]/.test(error.message));
});
test('a folder whose vault folder name is taken by a file is refused in words before anything is written', async t => {
  const { from } = await twoVaults(t), one = await plainPaper(from, 'a.pdf', pdf('a'));
  for (const name of [appName.vaultDir, appName.oldVaultDirs[0]]) {
    const root = path.join(from.dir, `taken-${name}`); await fs.mkdir(root); await fs.writeFile(path.join(root, name), 'a file');
    const before = await snapshot(root);
    await assert.rejects(planTransfer(await collectBundle(from.library, [one.id]), await Library.peek(root)), error => error.code === 'APP_TRANSFER_PLACE' && /[가-힣]/.test(error.message) && !error.message.includes(from.dir), name);
    await assert.rejects(vaultPlace(root), { code: 'APP_TRANSFER_PLACE' }, name);
    assert.deepEqual(await snapshot(root), before, name);
  }
});

// ---- The receiving folder and keeping the sending side's folders.
const placeOf = (planned, id, kind = 'pdf') => planned.files.find(f => f.entry.kind === kind && f.entry.paperId === id)?.to;
test('PDFs go under the receiving folder, with or without the sending folders', async t => {
  const { from, to } = await twoVaults(t), a = await plainPaper(from, '논문A.pdf', pdf('a'), '연구/2024'), b = await plainPaper(from, 'b.pdf', pdf('b'));
  const bundle = await collectBundle(from.library, [a.id, b.id]), plain = await plan(bundle, to.root);
  const at = async options => planTransfer(bundle, await Library.peek(to.root), options);
  const top = await at({ folder: '', keepFolders: true });
  assert.deepEqual([placeOf(top, a.id), placeOf(top, b.id)], [placeOf(plain, a.id), placeOf(plain, b.id)], 'the top and the folders kept: as before');
  const kept = await at({ folder: '받은 자료', keepFolders: true });
  assert.deepEqual([placeOf(kept, a.id), placeOf(kept, b.id)], ['받은 자료/연구/2024/논문A.pdf', `받은 자료/${b.attachments[0].path}`]);
  const flat = await at({ folder: '받은 자료', keepFolders: false });
  assert.deepEqual([placeOf(flat, a.id), placeOf(flat, b.id)], ['받은 자료/논문A.pdf', '받은 자료/b.pdf']);
  const nested = await at({ folder: '받은 자료/2025', keepFolders: false });
  assert.equal(placeOf(nested, a.id), '받은 자료/2025/논문A.pdf');
  // A name already there is numbered.
  await writeFile(path.join(to.root, '받은 자료', '논문A.pdf'), 'theirs');
  assert.equal(placeOf(await at({ folder: '받은 자료', keepFolders: false }), a.id), '받은 자료/논문A (2).pdf');
  // Sent: the records name the places and the files are there.
  const { report } = await send(from, to.root, [a.id, b.id], { folder: '받은 자료', keepFolders: false });
  assert.deepEqual(report.sent.sort(), [a.id, b.id].sort());
  const library = await Library.open(to.root);
  for (const id of [a.id, b.id]) { const att = library.paper(id).attachments[0]; assert.match(att.path, /^받은 자료\/[^/]+$/); await fs.access(path.join(to.root, att.path)); }
});
test('a translation PDF stays under translations; a PDF used again or replaced keeps its place there', async t => {
  const { from, to } = await twoVaults(t), one = await richPaper(from, 'one');
  const bundle = await collectBundle(from.library, [one.id]), planned = await planTransfer(bundle, await Library.peek(to.root), { folder: '받은 자료', keepFolders: false });
  assert.equal(placeOf(planned, one.id, 'translated-pdf'), bundle.files.find(f => f.kind === 'translated-pdf').path, 'not under the receiving folder');
  // Replace: the receiving copy's places stay.
  await send(from, to.root, [one.id]);
  const before = (await Library.open(to.root)).paper(one.id).attachments.map(a => a.path);
  await fs.writeFile(path.join(from.root, one.att.path), pdf('one, changed'));
  await send(from, to.root, [one.id], { existing: 'replace', folder: '받은 자료', keepFolders: false });
  assert.deepEqual((await Library.open(to.root)).paper(one.id).attachments.map(a => a.path), before);
  // Used again: the receiving side's file stays where it is.
  const { from: f2, to: t2 } = await twoVaults(t), sent = await plainPaper(f2, 'a.pdf', pdf('a')), there = await plainPaper(t2, 'a.pdf', pdf('a'));
  const reused = await planTransfer(await collectBundle(f2.library, [sent.id]), await Library.peek(t2.root), { folder: '받은 자료', keepFolders: false });
  assert.equal(placeOf(reused, sent.id), there.attachments[0].path);
});
test('a receiving folder outside the vault, in its own folders or of a name a folder cannot have is refused', async t => {
  const { from, to } = await twoVaults(t), a = await plainPaper(from, 'a.pdf', pdf('a')), bundle = await collectBundle(from.library, [a.id]);
  for (const folder of ['../x', '/abs', 'a/../b', `${appName.vaultDir}/x`, 'translations', 'Translations/x', 'a:b', 'con', 'a/', ' a', '.hidden', 'a\\b']) {
    await assert.rejects(planTransfer(bundle, await Library.peek(to.root), { folder }), { code: 'APP_TRANSFER_FOLDER' }, folder);
  }
});
test('a file where the receiving folder goes is refused, and folders made for a send that stops are taken away', async t => {
  const { from, to } = await twoVaults(t), a = await plainPaper(from, 'a.pdf', pdf('a'), '연구'), bundle = await collectBundle(from.library, [a.id]);
  await fs.writeFile(path.join(to.root, '받은 자료'), 'a file');
  let before = await snapshot(to.root);
  await assert.rejects((async () => applyTransfer(await planTransfer(bundle, await Library.peek(to.root), { folder: '받은 자료' }), bundle, await Library.open(to.root), sourceReader(from.root)))(), { code: 'APP_TRANSFER_PLACE' });
  assert.deepEqual(await snapshot(to.root), before);
  await fs.rm(path.join(to.root, '받은 자료')); before = await snapshot(to.root);
  await assert.rejects((async () => applyTransfer(await planTransfer(bundle, await Library.peek(to.root), { folder: '새 폴더/아래' }), bundle, await Library.open(to.root), sourceReader(from.root), { hooks: { afterStage: () => { throw Error('stop'); } } }))(), /stop/);
  await assert.rejects(fs.access(path.join(to.root, '새 폴더')), 'the folders made are gone');
  assert.deepEqual(await snapshot(to.root), before);
});
test('the receiving vault\'s folders are listed, read only: plain folders, not its own or translations', async t => {
  const { to } = await twoVaults(t);
  for (const dir of ['받은 자료/2024', '연구', 'translations/x', '.hidden']) await fs.mkdir(path.join(to.root, ...dir.split('/')), { recursive: true });
  await fs.symlink(path.join(to.dir), path.join(to.root, 'link'));
  const before = await snapshot(to.root);
  assert.deepEqual(await receivingFolders(to.root), ['papers', '받은 자료', '받은 자료/2024', '연구'].filter(f => f !== 'papers' || require('node:fs').existsSync(path.join(to.root, 'papers'))));
  assert.deepEqual(await snapshot(to.root), before);
});
