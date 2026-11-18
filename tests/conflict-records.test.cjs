// AI records left by git with conflict marks (a vault synced with git): read from both sides, written clean only when
// the app next writes, after a copy of the file as it was. Other files say which one cannot be read.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { readJson, atomicJson, readAiRecords, conflictSides } = require('../desktop/storage.cjs');
const { InsightStore } = require('../desktop/insight.cjs');
const appName = require('../core/app-name.cjs'), [nameBefore, nameFirst] = appName.history;

const result = (id, createdAt, question) => ({ id, createdAt, connection: 'gpt-web', model: 'm', sourceHash: 'h', kind: 'ask', question, sections: { answer: [] }, coverage: {}, rejected: [], adoptions: [] });
const lines = value => JSON.stringify(value, null, 2).split('\n');
// The shape of the file found in a user's vault: the head shared, one block in conflict, the end shared; the HEAD side
// still names the folder's earlier name (.<first id>).
function conflicted(ours, theirs, id) {
  const one = lines(ours).slice(3, -2), other = lines(theirs).slice(3, -2);
  return ['{', '  "version": 1,', '  "results": [', `<<<<<<< HEAD:.${nameFirst.id}/ai/${id}.json`, ...one, '=======', ...other, `>>>>>>> 716c02e5:.${appName.id}/ai/${id}.json`, '  ]', '}', ''].join('\n');
}
const older = result('236f77ad-1111-4111-8111-111111111111', '2026-10-29T01:02:03.000Z', 'What is the method?');
const newer = result('b1ae95a7-2222-4222-8222-222222222222', '2026-11-10T04:05:06.000Z', 'What are the limits?');
async function vault(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), `${appName.id}-conflict-`)); t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, appName.vaultDir, 'ai'), { recursive: true });
  const id = '8a5082fc-55c0-49a0-a941-8742abf4dfd9', file = path.join(root, appName.vaultDir, 'ai', id + '.json');
  return { root, id, file, store: new InsightStore({ root, attachment: () => ({ id }) }) };
}
const backups = async root => (await fs.readdir(path.join(root, appName.vaultDir, 'backups')).catch(() => [])).sort();

test('both sides read: the results of both, newest first, and reading writes nothing', async t => {
  const { root, id, file, store } = await vault(t), text = conflicted({ version: 1, results: [older] }, { version: 1, results: [newer] }, id);
  await fs.writeFile(file, text);
  assert.ok(conflictSides(text)); assert.throws(() => JSON.parse(text));
  assert.deepEqual((await store.list(1, id)).map(r => r.id), [newer.id, older.id]);
  assert.equal(await fs.readFile(file, 'utf8'), text, 'the file is as it was'); assert.deepEqual(await backups(root), []);
  // The same id on both sides: the later one.
  const edited = { ...older, updatedAt: '2026-11-12T00:00:00.000Z', adoptions: [{ at: 'x', text: 'kept' }] };
  await fs.writeFile(file, conflicted({ version: 1, results: [older] }, { version: 1, results: [edited, newer] }, id));
  const both = await store.list(1, id); assert.equal(both.length, 2); assert.deepEqual(both.find(r => r.id === older.id).adoptions, edited.adoptions);
});

test('one side that cannot be read is left out; neither: a coded error naming the file only', async t => {
  const { root, id, file, store } = await vault(t);
  const good = conflicted({ version: 1, results: [older] }, { version: 1, results: [newer] }, id).replace('"What are the limits?"', '"What are the limits?",,');
  await fs.writeFile(file, good);
  assert.deepEqual((await store.list(1, id)).map(r => r.id), [older.id]);
  const neither = good.replace('"What is the method?"', '"What is the method?",,');
  await fs.writeFile(file, neither);
  await assert.rejects(store.list(1, id), error => error.code === 'APP_AI_RECORDS_UNREADABLE' && error.message.endsWith(`: .${appName.id}/ai/${id}.json`) && !error.message.includes(root) && !error.message.includes('What is'));
  await fs.writeFile(file, '{"version":1,');
  await assert.rejects(store.list(1, id), { code: 'APP_AI_RECORDS_UNREADABLE' });
  assert.equal(await fs.readFile(file, 'utf8'), '{"version":1,', 'nothing written');
});

test('the next write keeps a copy of the file as it was, then writes the joined records clean', async t => {
  const { root, id, file, store } = await vault(t), text = conflicted({ version: 1, results: [older] }, { version: 1, results: [newer] }, id);
  await fs.writeFile(file, text);
  await store.adopt(1, id, older.id, 'added to the memo');
  const data = JSON.parse(await fs.readFile(file, 'utf8'));
  assert.deepEqual(data.results.map(r => r.id), [newer.id, older.id]); assert.equal(data.version, 1);
  assert.deepEqual(data.results.find(r => r.id === older.id).adoptions.map(a => a.text), ['added to the memo']);
  const copies = await backups(root); assert.equal(copies.length, 1); assert.match(copies[0], /^conflict-ai_8a5082fc-55c0-49a0-a941-8742abf4dfd9_json-\d+\.txt$/);
  assert.equal(await fs.readFile(path.join(root, appName.vaultDir, 'backups', copies[0]), 'utf8'), text, 'the copy is the file as git left it');
  // Clean from then on: the next write copies nothing more.
  await store.remove(1, id, newer.id); assert.equal((await backups(root)).length, 1);
  assert.deepEqual((await store.list(1, id)).map(r => r.id), [older.id]);
});

test('a file without conflict marks is read and written as before, byte for byte', async t => {
  const { root, id, file, store } = await vault(t), data = { version: 1, results: [newer, older], extra: { kept: true } };
  await atomicJson(file, data); const before = await fs.readFile(file, 'utf8');
  assert.deepEqual(await readAiRecords(file), { data }); assert.deepEqual(await store.list(1, id), data.results);
  await store.remove(1, id, 'no-such-result');
  // The earlier code: readJson, then atomicJson of what was read.
  const expected = path.join(root, 'expected.json'); await atomicJson(expected, JSON.parse(before));
  assert.equal(await fs.readFile(file, 'utf8'), await fs.readFile(expected, 'utf8')); assert.equal(await fs.readFile(file, 'utf8'), before);
  assert.deepEqual(await backups(root), []);
  assert.deepEqual(await readAiRecords(path.join(root, 'missing.json')), { data: { version: 1, results: [] } });
});

test('another file that cannot be read says which, and whether git left conflict marks in it', async t => {
  const { root } = await vault(t), notebook = path.join(root, appName.vaultDir, 'notebooks', 'n.json');
  await fs.mkdir(path.dirname(notebook), { recursive: true });
  await fs.writeFile(notebook, '{\n<<<<<<< HEAD\n  "title": "a"\n=======\n  "title": "b"\n>>>>>>> x\n}\n');
  await assert.rejects(readJson(notebook, null), error => error.name === 'Error' && error.code === 'APP_FILE_UNREADABLE' && error.conflict === true && error.file === `.${appName.id}/notebooks/n.json` && /git/.test(error.message) && !error.message.includes(root));
  await fs.writeFile(notebook, '{');
  await assert.rejects(readJson(notebook, null), error => error.code === 'APP_FILE_UNREADABLE' && error.conflict === false);
  assert.equal(await readJson(path.join(root, 'none.json'), 7), 7);
  // A diff3 conflict (with the base between) and marks that are not whole.
  assert.deepEqual(conflictSides('a\n<<<<<<< ours\nb\n||||||| base\nc\n=======\nd\n>>>>>>> theirs\ne'), { ours: 'a\nb\ne', theirs: 'a\nd\ne' });
  assert.equal(conflictSides('a\n<<<<<<< ours\nb\n=======\nc'), null); assert.equal(conflictSides('{"a":1}'), null);
});

test('sync takes an AI records file left with conflict marks as its joined records, and copies it before writing over it', async t => {
  const { root, id, file } = await vault(t), text = conflicted({ version: 1, results: [older] }, { version: 1, results: [newer] }, id);
  await fs.writeFile(file, text);
  const { writeFileRecord } = require('../desktop/sync.cjs');
  await writeFileRecord(path.join(root, appName.vaultDir), null, 'ai', id, { version: 1, results: [older] });
  assert.equal((await backups(root)).length, 1); assert.deepEqual(JSON.parse(await fs.readFile(file, 'utf8')).results.map(r => r.id), [older.id]);
});

test('one id on both sides keeps the adoptions and follow-ups of both, the follow-ups at most 50', async t => {
  const { id, file, store } = await vault(t);
  // As the app writes them: no updatedAt, the same createdAt on both sides.
  const ours = { ...older, adoptions: [{ at: '2026-11-01T00:00:00.000Z', text: 'ours' }], followUps: [{ at: '2026-11-02T00:00:00.000Z', model: 'm', text: 'ours asked' }] };
  const theirs = { ...older, adoptions: [{ at: '2026-11-03T00:00:00.000Z', text: 'theirs' }, ours.adoptions[0]], followUps: [{ at: '2026-11-04T00:00:00.000Z', model: 'm', text: 'theirs asked' }] };
  await fs.writeFile(file, conflicted({ version: 1, results: [ours] }, { version: 1, results: [theirs] }, id));
  const [joined] = await store.list(1, id);
  assert.deepEqual(joined.adoptions.map(a => a.text), ['ours', 'theirs'], 'each once, by time');
  assert.deepEqual(joined.followUps.map(f => f.text), ['ours asked', 'theirs asked']);
  await store.adopt(1, id, older.id, 'third'); assert.deepEqual((await store.list(1, id))[0].adoptions.map(a => a.text), ['ours', 'theirs', 'third']);
  const many = side => Array.from({ length: 40 }, (_, i) => ({ at: `2026-11-${String(1 + (i % 28)).padStart(2, '0')}T${String(i).padStart(2, '0')}:${side}:00.000Z`, model: 'm', text: `${side} ${i}` }));
  await fs.writeFile(file, conflicted({ version: 1, results: [{ ...older, followUps: many('01') }] }, { version: 1, results: [{ ...older, followUps: many('02') }] }, id));
  const followUps = (await store.list(1, id))[0].followUps; assert.equal(followUps.length, 50, 'the newest 50');
  assert.ok(followUps.every((f, i) => i === 0 || followUps[i - 1].at <= f.at));
  // A result on one side only keeps its fields as they were (no follow-ups added).
  await fs.writeFile(file, conflicted({ version: 1, results: [older] }, { version: 1, results: [newer] }, id));
  assert.equal('followUps' in (await store.list(1, id))[0], false);
});

test('the copy is the file byte for byte, and a second copy in the same millisecond gets a number', async t => {
  const { root, id, file } = await vault(t), { keepConflictCopy } = require('../desktop/storage.cjs');
  const text = Buffer.concat([Buffer.from(conflicted({ version: 1, results: [older] }, { version: 1, results: [newer] }, id).replace(/\n/g, '\r\n')), Buffer.from([0xef, 0xbb])]);
  await fs.writeFile(file, text);
  const now = Date.now; Date.now = () => 1700000000000; t.after(() => { Date.now = now; });
  const first = await keepConflictCopy(root, file), second = await keepConflictCopy(root, file);
  assert.deepEqual(await fs.readFile(first), text, 'the bytes as they were (CRLF and a broken last character too)');
  assert.match(path.basename(first), /-1700000000000\.txt$/); assert.match(path.basename(second), /-1700000000000-1\.txt$/);
  assert.equal(await keepConflictCopy(root, path.join(root, 'none.json')), null);
});

test('the messages say git conflict marks only when they are there; sync names the file alone', async t => {
  const { root, id, file, store } = await vault(t);
  await fs.writeFile(file, '{"version":1,');
  await assert.rejects(store.list(1, id), error => error.conflict === false && !/git/.test(error.message) && error.message.endsWith(`: .${appName.id}/ai/${id}.json`));
  await fs.writeFile(file, '<<<<<<< a\n{,\n=======\n{,\n>>>>>>> b\n');
  await assert.rejects(store.list(1, id), error => error.conflict === true && /git/.test(error.message));
  const { SyncEngine } = require('../desktop/sync.cjs'), { Library } = require('../desktop/storage.cjs');
  const library = await Library.open(root), shared = path.join(root, '..', path.basename(root) + '-shared'); await fs.mkdir(shared); t.after(() => fs.rm(shared, { recursive: true, force: true }));
  library.ink = new (require('../desktop/ink.cjs').InkStore)(library); library.notebooks = new (require('../desktop/notebook.cjs').NotebookStore)(library);
  await assert.rejects(new SyncEngine({ library, ink: library.ink, notebooks: library.notebooks, folder: shared, deviceId: require('node:crypto').randomUUID(), deviceName: 'A' }).run(),
    error => error.code === 'APP_FILE_UNREADABLE' && error.message.endsWith(`: .${appName.id}/ai/${id}.json`) && !/이 자료/.test(error.message));
});

test('a write that left something out reports counts and the file name only', async t => {
  const { id, file } = await vault(t), reports = [];
  const store = new InsightStore({ root: path.dirname(path.dirname(path.dirname(file))), attachment: () => ({ id }) }, info => reports.push(info));
  const text = conflicted({ version: 1, results: [older] }, { version: 1, results: [newer] }, id).replace('"What are the limits?"', '"What are the limits?",,');
  await fs.writeFile(file, text);
  await store.remove(1, id, 'none');
  assert.deepEqual(reports, [{ file: `.${appName.id}/ai/${id}.json`, results: 1, unreadable: 'theirs', cut: 0 }]);
  const both = conflicted({ version: 1, results: Array.from({ length: 150 }, (_, i) => result(`a${i}`, '2026-10-01T00:00:00.000Z', 'q')) }, { version: 1, results: Array.from({ length: 150 }, (_, i) => result(`b${i}`, '2026-10-02T00:00:00.000Z', 'q')) }, id);
  await fs.writeFile(file, both); reports.length = 0;
  await store.add(1, id, { kind: 'ask', question: 'q', sections: { answer: [] } }, { connection: 'c', model: 'm', sourceHash: 'h' });
  assert.deepEqual(reports, [{ file: `.${appName.id}/ai/${id}.json`, results: 300, unreadable: null, cut: 101 }]);
  assert.equal(JSON.parse(await fs.readFile(file, 'utf8')).results.length, 200);
});
