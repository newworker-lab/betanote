const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { Library } = require('../desktop/storage.cjs');
const { NotebookStore, notebookHtml, notesMarkdown } = require('../desktop/notebook.cjs');
const appName = require('../core/app-name.cjs');
const pdf = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n%%EOF');
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
test('notebooks keep pages, items, strokes and source cards; images are stored once', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `${appName.id}-nb-`)); t.after(() => fs.rm(dir, { recursive: true, force: true }));
  await fs.mkdir(path.join(dir, 'vault')); await fs.writeFile(path.join(dir, 'a.pdf'), pdf);
  const library = await Library.open(path.join(dir, 'vault')), [{ paperId, attachmentId }] = await library.importFiles([path.join(dir, 'a.pdf')]);
  const store = new NotebookStore(library), notebook = await store.create('연구 노트', paperId);
  const hash = await store.putAsset(png); assert.equal(await store.putAsset(png), hash);
  const source = { paperId, attachmentId, page: 3, title: 'a' };
  notebook.pages[0].items.push({ id: 'text-0001', type: 'text', x: 40, y: 60, w: 300, h: 80, text: '가설 <정리>' }, { id: 'image-001', type: 'image', x: 40, y: 200, w: 200, h: 150, asset: hash, source }, { id: 'card-0001', type: 'source', x: 40, y: 400, w: 300, h: 60, source, quote: 'Methods' });
  notebook.pages[0].strokes.push({ id: 'stroke-01', tool: 'pen', color: '#1d4ed8', width: 1.5, points: [10, 10, .5, 0, 50, 60, .7, 10] });
  notebook.pages.push({ id: 'page-0002', template: 'grid', width: 595, height: 842, items: [], strokes: [] });
  await store.save(notebook);
  const reopened = await new NotebookStore(await Library.open(path.join(dir, 'vault'))).get(notebook.id);
  assert.deepEqual(reopened.pages.map(p => [p.template, p.items.length, p.strokes.length]), [['lined', 3, 1], ['grid', 0, 0]]);
  assert.deepEqual((await store.list()).map(n => [n.title, n.paperId, n.pages]), [['연구 노트', paperId, 2]]);
  const html = await notebookHtml(reopened, h => store.asset(h));
  assert.match(html, /가설 &lt;정리&gt;/); assert.match(html, /a · 3쪽/); assert.equal((html.match(/class="page"/g) || []).length, 2);
  assert.match(html, /<svg class="ink"/); assert.match(html, /data:image\/png;base64,iVBOR/);
  await assert.rejects(store.save({ ...reopened, pages: [{ ...reopened.pages[0], items: [{ id: 'bad-00001', type: 'script', x: 0, y: 0, w: 1, h: 1 }] }] }), /내용/);
  await assert.rejects(store.save({ ...reopened, pages: [{ ...reopened.pages[0], width: 100 }] }), /페이지/);
  // A text box's look: size, weight, slant, underline, colour, alignment; anything else is refused.
  const styledText = { id: 'text-style-01', type: 'text', x: 10, y: 10, w: 100, h: 40, text: '서식', size: 20, bold: true, italic: true, underline: true, color: '#dc2626', align: 'center' };
  await store.save({ ...reopened, pages: [{ ...reopened.pages[0], items: [styledText] }] });
  assert.match(await notebookHtml(await store.get(reopened.id), h => store.asset(h)), /font-size:20pt;font-weight:700;font-style:italic;text-decoration:underline;color:#dc2626;text-align:center">서식/);
  for (const bad of [{ color: 'red' }, { align: 'justify' }, { bold: 'yes' }, { color: '#fff;background:url(x)' }]) await assert.rejects(store.save({ ...reopened, pages: [{ ...reopened.pages[0], items: [{ ...styledText, ...bad }] }] }), /내용/);
  // A box's fill and border (none unless chosen) are kept and printed at the box's size (border-box); a wrong one is refused.
  const framed = { ...styledText, id: 'text-frame-01', fill: '#fff3bf', border: { color: '#1b64da', width: 1.5, style: 'dashed' } };
  await store.save({ ...reopened, pages: [{ ...reopened.pages[0], items: [framed] }] });
  assert.deepEqual((await store.get(reopened.id)).pages[0].items[0], framed);
  assert.match(await notebookHtml(await store.get(reopened.id), h => store.asset(h)), /text-align:center;background-color:#fff3bf;border:1\.5pt dashed #1b64da;box-sizing:border-box">서식/);
  assert.doesNotMatch(await notebookHtml({ ...reopened, pages: [{ ...reopened.pages[0], items: [styledText] }] }, h => store.asset(h)), /class="text" style="[^"]*(background-color|border:)/, 'a box without them prints none');
  for (const bad of [{ fill: 'yellow' }, { fill: '#fff;x' }, { border: null }, { border: { color: '#000000', width: 0.4, style: 'solid' } }, { border: { color: '#000000', width: 7, style: 'solid' } }, { border: { color: '#000000', width: 1, style: 'double' } }, { border: { color: 'red', width: 1, style: 'solid' } }, { border: { color: '#000000', width: 1, style: 'solid', radius: 2 } }])
    await assert.rejects(store.save({ ...reopened, pages: [{ ...reopened.pages[0], items: [{ ...framed, ...bad }] }] }), /내용/, JSON.stringify(bad));
  // A notebook read from disk is not checked when read: what goes into the export's style is checked there.
  const unchecked = { ...styledText, id: 'text-raw-01', color: '#000;x:url(a)', fill: '#fff"><b>', border: { color: '#000000', width: 9, style: 'solid' }, align: 'center;x:y', size: '20pt;x:y' };
  const raw = await notebookHtml({ ...reopened, pages: [{ ...reopened.pages[0], items: [unchecked] }] }, h => store.asset(h));
  assert.match(raw, /<div class="text" style="left:10pt;top:10pt;width:100pt;height:40pt;font-size:12pt;font-weight:700;font-style:italic;text-decoration:underline">서식/);
  // An embedded memo keeps its key with the title and text as last saved, and prints that text.
  const memo = { id: 'memo-item-01', type: 'memo', x: 10, y: 10, w: 200, h: 120, key: `${paperId}-메모-abc`, title: '메모 <1>', text: '요약 & 메모' };
  await store.save({ ...reopened, pages: [{ ...reopened.pages[0], items: [memo] }] });
  assert.deepEqual((await store.get(reopened.id)).pages[0].items, [memo]);
  assert.match(await notebookHtml(await store.get(reopened.id), h => store.asset(h)), /<b>메모 &lt;1&gt;<\/b><div class="text" style="position:static">요약 &amp; 메모/);
  // A text box keeps which memo each "@[이름]" names.
  const named = { ...styledText, id: 'text-named-01', text: '@[메모 1] 참고', mentions: [{ key: `${paperId}-메모`, label: '메모 1' }] };
  await store.save({ ...reopened, pages: [{ ...reopened.pages[0], items: [named] }] });
  assert.deepEqual((await store.get(reopened.id)).pages[0].items[0].mentions, named.mentions);
  for (const mentions of [[], [{ key: 'a' }], [{ key: 'a', label: 'b', x: 1 }], 'a']) await assert.rejects(store.save({ ...reopened, pages: [{ ...reopened.pages[0], items: [{ ...named, mentions }] }] }), /내용/);
  for (const bad of [{ key: 1 }, { text: 'x'.repeat(20001) }, { title: undefined }]) await assert.rejects(store.save({ ...reopened, pages: [{ ...reopened.pages[0], items: [{ ...memo, ...bad }] }] }), /내용/);
  await store.save(reopened);
  await assert.rejects(store.save({ ...reopened, pages: [{ ...reopened.pages[0], background: '../x.png' }] }), /페이지/);
  // Other paper sizes and pages taken from a PDF (a background picture) are kept and print at their own size.
  const bg = await store.putAsset(png);
  await store.save({ ...reopened, pages: [...reopened.pages, { id: 'page-a5-0001', template: 'lined', width: 420, height: 595, items: [], strokes: [] }, { id: 'page-pdf-0001', template: 'blank', width: 612, height: 792, background: bg, items: [], strokes: [] }] });
  const sized = await store.get(reopened.id);
  assert.deepEqual(sized.pages.slice(-2).map(p => [p.width, p.height, p.background]), [[420, 595, undefined], [612, 792, bg]]);
  const sizedHtml = await notebookHtml(sized, h => store.asset(h));
  assert.match(sizedHtml, /@page s42000x59500\{size:420pt 595pt;margin:0\}/); assert.match(sizedHtml, /page:s61200x79200;width:612pt;height:792pt"><img class="bg" src="data:image\/png;base64,/);
  await assert.rejects(store.putAsset('data:text/html,<script>'), /PNG/);
  await store.remove(notebook.id); assert.deepEqual(await store.list(), []);
  await assert.rejects(store.save(reopened), /찾을 수 없습니다/);
});
test('notes export as Markdown with bibliography and page references', () => {
  const paper = { id: 7, title: 'Paper', authors: 'Jane Doe', year: '2024', journal: 'J', doi: '10.1/x', tags: [] };
  const md = notesMarkdown(paper, { '7-summary-0': '질문 [p.1]', '7-메모': '메모 내용' }, [{ paperId: 7, page: 4, body: '주석', quote: 'quoted' }, { paperId: 8, page: 1, body: 'other' }], 'Doe, J. (2024). Paper. J.');
  assert.match(md, /^# Paper\n\n> Doe, J\. \(2024\)/); assert.match(md, /DOI\*\*: https:\/\/doi\.org\/10\.1\/x/);
  assert.match(md, /### 연구 질문\n\n질문 \[p\.1\]/); assert.match(md, /- \*\*4쪽\*\* — 주석\n  > quoted/); assert.doesNotMatch(md, /other/);
});

test('a notebook moved to the trash is listed there, comes back whole, or is deleted with the pictures only it used', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `${appName.id}-nb-trash-`)); t.after(() => fs.rm(dir, { recursive: true, force: true }));
  await fs.mkdir(path.join(dir, 'vault')); await fs.writeFile(path.join(dir, 'a.pdf'), pdf);
  const library = await Library.open(path.join(dir, 'vault')), [{ paperId }] = await library.importFiles([path.join(dir, 'a.pdf')]);
  const store = new NotebookStore(library), kept = await store.create('남는 노트', paperId), gone = await store.create('지울 노트', null);
  // A picture both use, and one only the notebook to delete uses.
  const shared = await store.putAsset(png), own = await store.putAsset(png.slice(0, -4) + 'gA==');
  kept.pages[0].items.push({ id: 'image-0001', type: 'image', x: 0, y: 0, w: 10, h: 10, asset: shared }); await store.save(kept);
  gone.pages[0].items.push({ id: 'image-0002', type: 'image', x: 0, y: 0, w: 10, h: 10, asset: shared }, { id: 'image-0003', type: 'image', x: 0, y: 20, w: 10, h: 10, asset: own }); await store.save(gone);
  await store.remove(gone.id);
  assert.deepEqual((await store.list()).map(n => n.title), ['남는 노트'], 'gone from the list');
  const trash = await store.trashed();
  assert.deepEqual(trash.map(n => [n.id, n.title, n.paperId, n.pages]), [[gone.id, '지울 노트', null, 1]]); assert.ok(Date.parse(trash[0].trashedAt));
  await assert.rejects(store.get(gone.id), /찾을 수 없습니다/);
  // Back from the trash: as it was.
  await store.restore(gone.id);
  assert.deepEqual((await store.get(gone.id)).pages[0].items.map(i => i.asset), [shared, own]); assert.deepEqual(await store.trashed(), []);
  await assert.rejects(store.restore(gone.id), /휴지통/, 'only a notebook in the trash comes back');
  // Deleted for good: only from the trash; its file goes, and the picture only it used, not the shared one.
  await assert.rejects(store.purge(gone.id), /휴지통/);
  await store.remove(gone.id); await store.purge(gone.id);
  await assert.rejects(fs.access(path.join(dir, 'vault', appName.vaultDir, 'notebooks', gone.id + '.json')));
  assert.deepEqual(await store.trashed(), []);
  await fs.access(path.join(dir, 'vault', appName.vaultDir, 'notebooks', 'assets', shared + '.png'));
  await assert.rejects(fs.access(path.join(dir, 'vault', appName.vaultDir, 'notebooks', 'assets', own + '.png')), 'the picture only it used');
  // A picture another notebook in the trash still uses stays too.
  const other = await store.create('또 다른 노트', null), third = await store.create('셋째 노트', null), extra = await store.putAsset(png.slice(0, -4) + 'gQ==');
  for (const n of [other, third]) { n.pages[0].items.push({ id: 'image-0004', type: 'image', x: 0, y: 0, w: 10, h: 10, asset: extra }); await store.save(n); }
  await store.remove(other.id); await store.remove(third.id); await store.purge(third.id);
  await fs.access(path.join(dir, 'vault', appName.vaultDir, 'notebooks', 'assets', extra + '.png'));
});
