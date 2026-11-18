const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { Library } = require('../desktop/storage.cjs');
const { FullText } = require('../desktop/fulltext.cjs');
const appName = require('../core/app-name.cjs');
const pdf = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n%%EOF');
test('searches stored PDF text by page, separately from metadata, from a rebuildable device index', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `${appName.id}-fulltext-`)); t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const root = path.join(dir, 'vault'), index = path.join(dir, 'index'); await fs.mkdir(root);
  await fs.writeFile(path.join(dir, 'a.pdf'), pdf); await fs.writeFile(path.join(dir, 'b.pdf'), Buffer.concat([pdf, Buffer.from(' ')]));
  const library = await Library.open(root); await library.importFiles([path.join(dir, 'a.pdf'), path.join(dir, 'b.pdf')]);
  const search = new FullText(index), targets = await search.targets(library);
  assert.deepEqual(targets.map(x => [x.name, x.indexed]), [['a.pdf', false], ['b.pdf', false]]);
  const before = await search.search(library, 'attention');
  assert.deepEqual([before.results, before.missing.sort()], [[], ['a.pdf', 'b.pdf']]);
  await search.store(targets[0].hash, ['Introduction to layout', 'Transformer attention improves translation']);
  await search.store(targets[1].hash, ['Attention is mentioned', 'but translation is elsewhere']);
  const found = await search.search(library, 'ATTENTION translation');
  assert.deepEqual(found.results.map(r => [r.name, r.hits[0].page]), [['a.pdf', 2]]);
  assert.match(found.results[0].hits[0].snippet, /Transformer attention improves/);
  assert.deepEqual((await search.search(library, 'attention')).results.map(r => r.name), ['a.pdf', 'b.pdf']);
  // A scanned PDF has no text and is reported, not silently skipped.
  await search.store(targets[1].hash, ['', '']);
  assert.deepEqual((await search.search(library, 'attention')).unreadable, ['b.pdf']);
  await assert.rejects(search.search(library, '   '), /검색어/);
  await assert.rejects(search.store('../x', []), /해시/);
  await assert.rejects(search.store(targets[0].hash, [1]), /색인/);
});
test('a parsed index is kept in memory, refreshed by store, and the oldest is dropped past the limit', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `${appName.id}-fulltext-`)); t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const index = new FullText(dir), a = 'a'.repeat(64), b = 'b'.repeat(64);
  await index.store(a, ['first']); await fs.rm(index.file(a));
  assert.deepEqual(await index.cached(a), ['first'], 'served from memory, no re-read');
  assert.equal(await index.has(a), true); assert.equal(await index.has(b), false);
  await index.store(a, ['second']); assert.deepEqual(await index.cached(a), ['second']);
  index.memoryChars = 6e7; await index.store(b, ['x']); // over the limit: the least recently used entry goes
  assert.equal(index.memory.has(a), false); assert.equal(index.memory.has(b), true);
});
