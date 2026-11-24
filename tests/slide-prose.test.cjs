// Lecture slides with light math and code beside prose (core/pdf-layout.js): the text runs are those of real slide pages
// (tests/fixtures/slide-runs.json: a Beamer handout on symbolic execution, read as core/pdf-view.js extractPage reads
// a page). A sentence with a simple relation in it ("(2, 9) reaches r = 1.") is prose: it joins its paragraph and is
// translated, not kept as a formula in the source language while the lines around it are translated.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { textLines, paragraphs, layoutBlocks, structureTranslationPages, formulaOnly, lightMath, mathDense } = require('../core/pdf-layout.js');
const fixtures = require('./fixtures/slide-runs.json');
// The page's blocks as the translation sees them: text and whether it is translated in place ('tr'), kept as the
// source with its translation aside ('keep'), or left as it is ('source').
function blocksOf(name) {
  const page = fixtures[name], runs = page.runs.map(([x, y, width, height, fontSize, baseline, text]) => ({ x, y, width, height, fontSize, baseline, text, fontName: 'sans-serif', heavy: false, serif: false }));
  const [structured] = structureTranslationPages([{ width: page.width, height: page.height, blocks: paragraphs(textLines(runs), page.width, page.height, 1) }], 'hash');
  return layoutBlocks(structured).map(b => ({ text: b.text, state: b.sourceOnly ? 'source' : b.preserveSource ? 'keep' : 'tr' }));
}
const find = (blocks, start) => blocks.find(b => b.text.startsWith(start));

test('a sentence that goes on over a line with a relation in it is one translated paragraph', () => {
  const guess = blocksOf('guess');
  assert.deepEqual(find(guess, '• Solve'), { text: '• Solve: the branch says α × 7 + 3 = 5001 for an unknown α. So α = 714, at once.', state: 'tr' });
  assert.deepEqual(find(guess, 'Which'), { text: 'Which x reaches r = 1?', state: 'tr' }, 'a question with a relation in it');
  const reach = blocksOf('reach');
  assert.deepEqual(find(reach, '• The solver'), { text: '• The solver picks one of them: (2, 9) reaches r = 1.', state: 'tr' });
  assert.deepEqual(find(reach, '• None'), { text: '• None lies in the red band. r = 2 never runs, and f never returns 2.', state: 'tr' });
  assert.deepEqual(find(reach, '• Interval'), { text: '• Interval analysis kept x ≤ 2 but lost z = x + y, so it said “maybe”.', state: 'tr' });
});
test('a heading with a relation in it is a heading, and takes no axis label of the plot under it', () => {
  const reach = blocksOf('reach');
  assert.deepEqual(find(reach, 'No Input'), { text: 'No Input Reaches r = 2', state: 'tr' });
  assert.ok(reach.some(b => b.text === 'y' && b.state === 'source'), 'the axis label stays where it is');
});
test('a few words with a symbol are translated in place, not kept aside', () => {
  const state = blocksOf('state');
  assert.equal(find(state, '(10 <').state, 'tr', '(10 < α + β, α < 3): their conjunction is Φ');
  assert.equal(lightMath('Φ at point 6'), true); assert.equal(mathDense('our facts_of'), false, 'an underscore in a name is no subscript');
  assert.equal(find(blocksOf('invariant'), 'runs that reach').state, 'tr', 'a table head with a relation');
});
test('a sentence set centred over two lines is one paragraph', () => {
  const tree = blocksOf('tree');
  assert.deepEqual(find(tree, 'Back to point 3'), { text: 'Back to point 3. Four paths, one infeasible: three inputs, one per path, and a proof that r = 2 never runs.', state: 'tr' });
  // Labels of a drawing that happen to share a middle are no sentence going on.
  assert.ok(tree.some(b => b.text === 'input (10,0): returns 0') && tree.some(b => b.text === 'input (3,8): returns 0'));
});
test('in a listing each comment and a docstring is a block of its own, apart from the code', () => {
  const state = blocksOf('state').map(b => b.text);
  for (const line of ['# ((name, z3 expr), ...) -- hashable', '# conjuncts of the path condition', '# get, set, at, assume', '"""One fresh symbol per parameter: the input is unknown."""', 'return SymState(g.entry, tuple((p, z3.Int(p)) for p in g.params), ())'])
    assert.ok(state.includes(line), `${line}: ${JSON.stringify(state)}`);
});
test('the cells of a table are no lines of the head over them', () => {
  const state = blocksOf('state');
  assert.deepEqual(find(state, 'the state'), { text: 'the state at point 6 of the execution tree', state: 'tr' });
  // Nor are they the head's paragraph going on in another column: head and cells are not translated as one text.
  const page = fixtures.state, runs = page.runs.map(([x, y, width, height, fontSize, baseline, text]) => ({ x, y, width, height, fontSize, baseline, text, fontName: 'sans-serif' }));
  const [structured] = structureTranslationPages([{ width: page.width, height: page.height, blocks: paragraphs(textLines(runs), page.width, page.height, 1) }], 'hash');
  assert.equal(structured.blocks.find(b => b.text.startsWith('the state')).flowIds, undefined);
  // Two rows' first cells are two cells.
  const review = blocksOf('review').map(b => b.text);
  assert.ok(review.includes('f returns') && review.includes('an input (x, y)'), JSON.stringify(review));
  const table = blocksOf('invariant');
  assert.deepEqual(find(table, 'runs that reach'), { text: 'runs that reach r = 1', state: 'tr' });
});
test('code, equations and their pieces stay as they are', () => {
  for (const code of ['r = 0 if x * 7 + 3 == 5001: r = 1', 'x = 2, y = 9', 'Φ = 10 < α + β ∧ α < 3', 'z 7→ α + β', 'stack = [(start(g), 0)]', 'st, d = stack.pop()', 'if d >= max_depth:', 'nxt = transfer(st, e)', 'sql = sql + tmp n = 0', "for (int i = 0; i <= 8; i++) buf[i] = 'A';", 'if row["role"] == "admin":', 'branchInfo = branches[id] = {trueCount: 0, falseCount: 0};', 'int *s = NULL; *s = 42; }', 'if ((err = SSLHashSHA1.update(&hashCtx, &signedParams)) != 0)', '>>> x, y = z3.Int("x"), z3.Int("y") >>> s = z3.Solver()', 'safe = True', 'tmp = uid', 'α + 1 (α + β) × 2 ¬(α < 3) α < 3 ∧ ¬(β < 8)'])
    assert.equal(formulaOnly({ text: code }), true, code);
  // Display equations of papers that carry a word or two are equations still.
  for (const equation of ['precision = TP / (TP + FP)', 'score = sim(Xtrain) − αDis(Xtest), (8)', 'loss = Lrec + λ Lreg.', 'y = Xβ + ε.', 'where μ = W4h + b4 and σ = W5h + b5'])
    assert.equal(formulaOnly({ text: equation }), true, equation);
  const guess = blocksOf('guess');
  assert.equal(find(guess, 'r = 0 if').state, 'source'); assert.equal(find(guess, 'def magic').text, 'def magic(x):');
});
