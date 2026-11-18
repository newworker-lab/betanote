'use strict';
// What the search box finds beyond the library record (desktop/content-index.cjs): the text of text boxes on PDF pages
// and of notebooks (titles, text boxes, source cards), per paper; nothing of papers, attachments or notebooks in the
// trash, nor of a deleted text box; kept in a cache per device that a changed file makes stale.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Library } = require('../desktop/storage.cjs');
const { InkStore } = require('../desktop/ink.cjs');
const { NotebookStore } = require('../desktop/notebook.cjs');
const { ContentIndex, searchText } = require('../desktop/content-index.cjs');

const pdf = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n%%EOF');
const geometry = { view: [0, 0, 600, 800], rotate: 0, userUnit: 1 };
const textBox = (id, page, text) => ({ id, page, tool: 'text', color: '#1f2937', width: 16, points: [100, 700, 0, 0], text });
async function vault(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'content-index-')); t.after(() => fs.rm(dir, { recursive: true, force: true }));
  for (const name of ['one', 'two', 'gone']) await fs.writeFile(path.join(dir, name + '.pdf'), Buffer.concat([pdf, Buffer.from(name)]));
  const root = path.join(dir, 'vault'); await fs.mkdir(root);
  const library = await Library.open(root); library.ink = new InkStore(library); library.notebooks = new NotebookStore(library);
  const [one, two, gone] = await library.importFiles(['one', 'two', 'gone'].map(n => path.join(dir, n + '.pdf')));
  return { dir, library, one, two, gone, index: new ContentIndex(path.join(dir, 'cache')) };
}
const parts = async (v, only) => (await v.index.parts(v.library, v.library.ink, v.library.notebooks, only)).papers;

test('text boxes on PDF pages and notebooks\' text are found per paper, with where they are', async t => {
  const v = await vault(t);
  await v.library.ink.apply(v.one.paperId, v.one.attachmentId, 'original', [{ type: 'add', stroke: textBox('stroke-t0000001', 2, '상자에 쓴 단어'), geometry }]);
  const notebook = await v.library.notebooks.create('실험 노트', v.two.paperId);
  notebook.pages[0].items.push({ id: 'item-00000001', type: 'text', x: 40, y: 300, w: 200, h: 40, text: '노트북 상자의 글' });
  notebook.pages.push({ ...notebook.pages[0], id: 'page-00000002', items: [{ id: 'item-00000002', type: 'source', x: 40, y: 60, w: 300, h: 80, quote: '출처 카드 인용문', source: { paperId: v.two.paperId, attachmentId: v.two.attachmentId, page: 4, title: 'two' } }], strokes: [] });
  await v.library.notebooks.save(notebook);
  const found = await parts(v);
  assert.deepEqual(found[v.one.paperId], [{ kind: 'textbox', attachmentId: v.one.attachmentId, surface: 'original', page: 3, id: 'stroke-t0000001', text: '상자에 쓴 단어' }]);
  assert.deepEqual(found[v.two.paperId], [
    { kind: 'notebook', notebookId: notebook.id, notebookTitle: '실험 노트', text: '실험 노트' },
    { kind: 'notebook', notebookId: notebook.id, notebookTitle: '실험 노트', pageId: notebook.pages[0].id, page: 1, id: 'item-00000001', y: 300, text: '노트북 상자의 글' },
    { kind: 'notebook', notebookId: notebook.id, notebookTitle: '실험 노트', pageId: 'page-00000002', page: 2, id: 'item-00000002', y: 60, text: '출처 카드 인용문' },
  ]);
  assert.deepEqual(Object.keys(await parts(v, [v.one.paperId])), [String(v.one.paperId)], 'one paper asked for: that paper only');
});

test('nothing in the trash, nor a deleted text box', async t => {
  const v = await vault(t);
  await v.library.ink.apply(v.one.paperId, v.one.attachmentId, 'original', [{ type: 'add', stroke: textBox('stroke-t0000001', 0, '지운 상자'), geometry }, { type: 'delete', ids: ['stroke-t0000001'] }]);
  await v.library.ink.apply(v.gone.paperId, v.gone.attachmentId, 'original', [{ type: 'add', stroke: textBox('stroke-t0000002', 0, '휴지통 자료의 상자'), geometry }]);
  await v.library.trashPaper(v.gone.paperId);
  const binned = await v.library.notebooks.create('지운 노트북', v.two.paperId); await v.library.notebooks.remove(binned.id);
  const found = await parts(v);
  assert.equal(found[v.one.paperId], undefined, 'a deleted text box'); assert.equal(found[v.gone.paperId], undefined, 'a paper in the trash');
  assert.equal(found[v.two.paperId], undefined, 'a notebook in the trash');
});

test('the cache: unchanged files are not read again; a changed one is, at once', async t => {
  const v = await vault(t);
  await v.library.ink.apply(v.one.paperId, v.one.attachmentId, 'original', [{ type: 'add', stroke: textBox('stroke-t0000001', 0, '처음 글'), geometry }]);
  assert.equal((await parts(v))[v.one.paperId][0].text, '처음 글');
  // A new index (as after a restart) reads the stored cache: no ink state is read for an unchanged file.
  const fresh = new ContentIndex(path.join(v.dir, 'cache')); let reads = 0;
  const ink = Object.create(v.library.ink); ink.state = (...args) => { reads++; return v.library.ink.state(...args); };
  assert.equal((await fresh.parts(v.library, ink, v.library.notebooks)).papers[v.one.paperId][0].text, '처음 글'); assert.equal(reads, 0, 'read from the cache');
  await v.library.ink.apply(v.one.paperId, v.one.attachmentId, 'original', [{ type: 'add', stroke: textBox('stroke-t0000002', 0, '새로 쓴 글'), geometry }]);
  assert.deepEqual((await fresh.parts(v.library, ink, v.library.notebooks)).papers[v.one.paperId].map(p => p.text), ['처음 글', '새로 쓴 글']); assert.equal(reads, 1, 'the changed file read again');
  assert.ok(!(await fs.readdir(path.join(v.library.root, require('../core/app-name.cjs').vaultDir))).includes('content-index'), 'nothing in the vault');
});

test('search text is lower case and composed (NFC), so decomposed Korean is found', () => {
  assert.equal(searchText('Ｌayout 한글'.normalize('NFD')), 'ｌayout 한글');
  assert.ok(searchText('메모에 쓴 한글'.normalize('NFD')).includes(searchText('한글')));
});
