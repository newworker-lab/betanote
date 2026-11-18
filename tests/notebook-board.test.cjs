// Whiteboard pages of a notebook (desktop/notebook.cjs): a page of fixed width that grows downward. The stored form
// (board: true; height and item places beyond a normal page's only there), and its PDF export cut into sheets of the
// A4 proportion at the board's width, between items where it can.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validNotebook, notebookHtml, boardSheets, BOARD_MAX } = require('../desktop/notebook.cjs');

const id = n => `item-${String(n).padStart(8, '0')}`;
const text = (n, y, h = 40) => ({ id: id(n), type: 'text', x: 40, y, w: 200, h, text: `box ${n}` });
const stroke = (n, y0, y1) => ({ id: id(n), tool: 'pen', color: '#000000', width: 2, points: [50, y0, 0.5, 0, 60, y1, 0.5, 10] });
const notebook = pages => ({ id: '00000000-0000-4000-8000-000000000001', title: 'n', paperId: null, pages });
const page = (n, extra) => ({ id: `page-${String(n).padStart(8, '0')}`, template: 'lined', width: 595, height: 842, items: [], strokes: [], ...extra });

test('a whiteboard page takes a tall height and items far down; a normal page does not', () => {
  const board = page(1, { board: true, height: 40000, items: [text(1, 39000)], strokes: [stroke(2, 38000, 39500)] });
  const saved = validNotebook(notebook([board, page(2)]));
  assert.equal(saved.pages[0].board, true, 'kept as a whiteboard'); assert.equal(saved.pages[0].height, 40000);
  assert.equal(saved.pages[1].board, undefined, 'a normal page stays as it was');
  assert.throws(() => validNotebook(notebook([page(1, { height: 40000 })])), 'a normal page keeps its size limit');
  assert.throws(() => validNotebook(notebook([page(1, { items: [text(1, 39000)] })])), 'and its item places');
  assert.throws(() => validNotebook(notebook([page(1, { board: true, height: BOARD_MAX + 1 })])), 'a whiteboard has its own limit');
  assert.throws(() => validNotebook(notebook([page(1, { board: true, height: 5000, items: [text(1, 5000 + 2001)] })])), 'items stay near the board');
  assert.throws(() => validNotebook(notebook([page(1, { board: 'yes' })])), 'the mark is true or absent');
  assert.equal(BOARD_MAX, 84200, 'a hundred A4 sheets');
});

test('a whiteboard prints on sheets of the A4 proportion, cut between items where it can', () => {
  // Two boxes with a gap: the first sheet ends where the second box starts, not through it.
  assert.deepEqual(boardSheets(page(1, { board: true, height: 3368, items: [text(1, 100), text(2, 800, 200)] })), [{ top: 0, bottom: 800 }, { top: 800, bottom: 1642 }]);
  // A box taller than a sheet: cut at the sheet's height, through it.
  assert.deepEqual(boardSheets(page(1, { board: true, height: 3368, items: [text(1, 0, 2000)] })), [{ top: 0, bottom: 842 }, { top: 842, bottom: 1684 }, { top: 1684, bottom: 2526 }]);
  // A stroke counts as an item (with its width around it); the empty part under the last thing is not printed.
  assert.deepEqual(boardSheets(page(1, { board: true, height: 8420, strokes: [stroke(1, 600, 900)] })), [{ top: 0, bottom: 598.4 }, { top: 598.4, bottom: 1440.4 }]);
  assert.deepEqual(boardSheets(page(1, { board: true, height: 8420, items: [text(1, 100)] })), [{ top: 0, bottom: 842 }], 'one sheet when it all fits');
  assert.deepEqual(boardSheets(page(1, { board: true, height: 8420 })), [{ top: 0, bottom: 842 }], 'an empty board is one empty sheet');
  // The sheet keeps the A4 proportion at the board's width.
  assert.deepEqual(boardSheets(page(1, { board: true, width: 1190, height: 5000, items: [text(1, 100)] })), [{ top: 0, bottom: 1684 }]);
});

test('a normal page exports as it did: lined and grid lines over the whole page', async () => {
  const html = await notebookHtml(validNotebook(notebook([page(1, { template: 'grid' }), page(2)])), async () => 'data:,');
  const [grid, lined] = html.split('<section class="page"').slice(1);
  assert.match(grid, /viewBox="0 0 595 842"/); assert.match(grid, /<line x1="18" y1="0" x2="18" y2="842"\/>/); assert.match(grid, /<line x1="0" y1="18" x2="595" y2="18"\/>/);
  assert.match(lined, /<line x1="36" y1="72" x2="559" y2="72"\/>/); assert.doesNotMatch(html, /class="slice"/);
});
test('a sheet ends with the ink, a board of no width still ends, and the longest board is cut quickly', () => {
  // A shape is drawn at its width: a rectangle down to 840.6 (width 2) ends inside the first sheet, with no empty second.
  const rect = { id: id(9), tool: 'pen', shape: 'rect', color: '#000000', width: 2, points: [40, 300, .5, 0, 300, 840.6, .5, 5] };
  assert.deepEqual(boardSheets(page(1, { board: true, height: 3368, strokes: [rect] })), [{ top: 0, bottom: 842 }]);
  assert.deepEqual(boardSheets({ width: 0, height: 2000, items: [text(1, 1500)], strokes: [] }).length, 2, 'no width: A4 sheets, and it ends');
  // A hundred sheets of the most a page holds: 20,000 strokes and 2,000 boxes.
  const strokes = Array.from({ length: 20000 }, (_, i) => stroke(100000 + i, (i * 4.2) % 84000, (i * 4.2) % 84000 + 30)), items = Array.from({ length: 2000 }, (_, i) => text(200000 + i, i * 42));
  const big = page(1, { board: true, height: 84200, strokes, items }), t0 = Date.now(), sheets = boardSheets(big), ms = Date.now() - t0;
  assert.ok(sheets.length >= 100 && sheets.at(-1).bottom >= 84000, `${sheets.length} sheets`); assert.ok(ms < 1000, `cut in ${ms} ms`);
});
test('the export has one page per sheet, each of the sheet size, with what falls on it', async () => {
  const board = page(1, { board: true, height: 4210, items: [text(1, 100), text(2, 900), text(3, 1900)] });
  const html = await notebookHtml(validNotebook(notebook([page(2), board])), async () => 'data:,');
  const sections = html.match(/<section class="page"[^>]*>/g);
  assert.equal(sections.length, 1 + 3, 'the normal page and three sheets');
  for (const s of sections) assert.match(s, /width:595pt;height:842pt/);
  const sheets = html.split('<section class="page"').slice(2);
  assert.match(sheets[0], /box 1/); assert.doesNotMatch(sheets[0], /box 2/);
  assert.match(sheets[1], /box 2/); assert.match(sheets[2], /box 3/);
});
