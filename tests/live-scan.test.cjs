'use strict';
// Live view scanner: math, pictures, source headers and marks found in place; code skipped.
const test = require('node:test'), assert = require('node:assert/strict');
const { scan } = require('../desktop/live-scan.js');
const found = text => scan(text).map(m => [m.kind, text.slice(m.from, m.to)]);

test('inline math is found inside the line; the text around it stays text', () => {
  assert.deepEqual(found('질량 $E=mc^2$ 과 $$\\int f$$ 끝'), [['math', '$E=mc^2$'], ['math', '$$\\int f$$']]);
  assert.equal(scan('$x$').length, 1); assert.equal(scan('가격 $5 와 $5').length, 0, 'a price is not math'); assert.equal(scan('\\$x\\$').length, 0, 'escaped dollars');
  assert.equal(scan('$ x$').length, 0); assert.equal(scan('$x $').length, 0);
});
test('a $$ block over several lines is one range; code is never scanned', () => {
  const text = '앞\n$$\n\\frac{a}{b}\n$$\n뒤\n```\n$x$ **y**\n```\n`$z$`';
  const marks = scan(text);
  assert.deepEqual(marks.map(m => m.kind), ['mathBlock', 'code']); assert.equal(marks[0].tex, '\\frac{a}{b}'); assert.equal(text.slice(marks[0].from, marks[0].to), '$$\n\\frac{a}{b}\n$$');
});
test('pictures, source headers, headings and inline marks', () => {
  const text = '# 제목\n![그림](note-image:0123456789abcdef0123456789abcdef.png)\n[AI 설명 · a.pdf · 7페이지 · m]\n**굵게** *기울임* ~~취소~~ ==형광== `코드`';
  assert.deepEqual(scan(text).map(m => m.kind), ['heading', 'image', 'source', 'strong', 'em', 'strike', 'mark', 'code']);
  const source = scan(text).find(m => m.kind === 'source'); assert.equal(source.page, 7); assert.equal(source.label, 'AI 설명');
  assert.equal(scan('**$x$**').filter(m => m.kind === 'math').length, 1, 'math inside bold is still math');
});
test('list lines: bullets and numbers right after a paragraph, after a blank line, nested, and to-do items', () => {
  const text = '지난 주 배운 터널링과  로라와 비슷한 부분이 있나요?\n- 컴퓨터 사이언스 기본론은 유사하지만 크게 관계가 있는 부분은 아님.\n\n### 질문\n$x$\n\n* 별표\n+ 더하기\n  - 들여쓴 **굵게**\n1. 첫째\n12) 열둘\n- [ ] 할 일\n- [x] 한 일\n-붙은 하이픈\n```\n- 코드 안\n```';
  const lists = scan(text).filter(m => m.kind === 'list').map(m => [text.slice(m.from, m.to), text.slice(m.from, m.from + m.marker), m.ordered, m.depth, m.task]);
  assert.deepEqual(lists, [
    ['- 컴퓨터 사이언스 기본론은 유사하지만 크게 관계가 있는 부분은 아님.', '- ', false, 0, null],
    ['* 별표', '* ', false, 0, null], ['+ 더하기', '+ ', false, 0, null], ['  - 들여쓴 **굵게**', '  - ', false, 1, null],
    ['1. 첫째', '1. ', true, 0, null], ['12) 열둘', '12) ', true, 0, null],
    ['- [ ] 할 일', '- [ ] ', false, 0, ' '], ['- [x] 한 일', '- [x] ', false, 0, 'x'],
  ]);
  assert.equal(scan(text).find(m => m.kind === 'list' && m.ordered).label, '1.');
  assert.ok(scan('- **b**').some(m => m.kind === 'strong'), 'marks in a list line are found as well');
});
test('math and code inside a link label are found like anywhere else (the live view shows the link as text)', () => {
  const text = '[$x^2$ here](https://e.com) [`code`](https://example.com/a)';
  assert.deepEqual(scan(text).map(m => [m.kind, text.slice(m.from, m.to)]), [['math', '$x^2$'], ['code', '`code`']]);
});
// Bold, italic, highlight and strike in the live view: the same marks the reading view (markdown.js) makes, wherever
// they stand: next to Korean particles, in a list, a heading or a link label, several on a line, and one inside another
// (the format bar and Ctrl+B / Ctrl+I put one around the other). Each mark with what it covers, outer marks first.
const marks = text => scan(text).filter(m => ['strong', 'em', 'mark', 'strike', 'code'].includes(m.kind)).map(m => [m.kind, text.slice(m.from + m.open, m.to - m.close)]);
const CASES = [
  ['**굵게**', [['strong', '굵게']]], ['__굵게__', [['strong', '굵게']]], ['*기울임*', [['em', '기울임']]], ['_기울임_', [['em', '기울임']]],
  ['==하이라이트==', [['mark', '하이라이트']]], ['~~취소선~~', [['strike', '취소선']]], ['`코드`', [['code', '코드']]],
  ['**굵게**는', [['strong', '굵게']]], ['는**굵게**', [['strong', '굵게']]], ['*기울임*으로 ==형광==을', [['em', '기울임'], ['mark', '형광']]],
  ['**정의:**다음 **핵심(key)**은', [['strong', '정의:'], ['strong', '핵심(key)']]],
  ['bold **word** here', [['strong', 'word']]], ['이것은 **굵게** 입니다', [['strong', '굵게']]],
  ['- 항목 **굵게** 끝', [['strong', '굵게']]], ['# 제목 *기울임*', [['em', '기울임']]], ['[**굵게** 링크](https://e.com)', [['strong', '굵게']]],
  ['**하나** *둘* ==셋== ~~넷~~', [['strong', '하나'], ['em', '둘'], ['mark', '셋'], ['strike', '넷']]],
  // One inside another.
  ['***굵은 기울임***', [['strong', '*굵은 기울임*'], ['em', '굵은 기울임']]], ['***굵은 기울임***은', [['strong', '*굵은 기울임*'], ['em', '굵은 기울임']]],
  ['**==형광 굵게==**', [['strong', '==형광 굵게=='], ['mark', '형광 굵게']]], ['==**굵은 형광**==', [['mark', '**굵은 형광**'], ['strong', '굵은 형광']]],
  ['~~**취소 굵게**~~', [['strike', '**취소 굵게**'], ['strong', '취소 굵게']]], ['_**굵기**_', [['em', '**굵기**'], ['strong', '굵기']]],
  ['**굵게 *기울임* 끝**', [['strong', '굵게 *기울임* 끝'], ['em', '기울임']]], ['*기울임 **굵게** 끝*', [['em', '기울임 **굵게** 끝'], ['strong', '굵게']]],
  ['==*형광 기울임*==', [['mark', '*형광 기울임*'], ['em', '형광 기울임']]],
  ['***a** b*', [['em', '**a** b'], ['strong', 'a']]], ['***a* b**', [['strong', '*a* b'], ['em', 'a']]],
  ['**$x$ 굵게**', [['strong', '$x$ 굵게']]],
  // Math, code and a link inside a mark (the memo in the report: the bold went over $t$).
  ['**-> 생존함수(Survival function)는 시점 $t$ 까지 이벤트가 발생하지 않을 확률**', [['strong', '-> 생존함수(Survival function)는 시점 $t$ 까지 이벤트가 발생하지 않을 확률']]],
  ['*기울임 $t$ 안* ==형광 $t$ 안== **코드 `x` 안**', [['em', '기울임 $t$ 안'], ['mark', '형광 $t$ 안'], ['strong', '코드 `x` 안'], ['code', 'x']]],
  // A space just inside **, == or ~~ (a selection with a space around it, made bold): still the mark. Not when the
  // markers stand free between spaces on both ends (2 ** 3 ** 4), and never for a single * or _.
  ['** test**', [['strong', ' test']]], ['**test **', [['strong', 'test ']]], ['== test ==', [['mark', ' test ']]], ['~~ test~~', [['strike', ' test']]],
  ['앞** test** 뒤', [['strong', ' test']]], ['앞 **test ** 뒤 **굵게**', [['strong', 'test '], ['strong', '굵게']]],
  ['a ** b ** c', []], ['2 ** 3 ** 4 **굵게**', [['strong', '굵게']]], ['x * test * y', []], ['_ 기울임_', []], ['** **', []],
  // Not marks, as in the reading view.
  ['snake_case_name', []], ['2 * 3 * 4', []], ['`**코드 안**`', [['code', '**코드 안**']]],
];
test('bold, italic, highlight and strike: the reading view\'s marks, also next to Korean and one inside another', () => {
  for (const [text, want] of CASES) assert.deepEqual(marks(text), want, text);
});
test('the live view marks what the reading view renders, for the same text', () => {
  const { renderMarkdown } = require('../desktop/markdown.js');
  const TAG = { strong: 'strong', em: 'em', mark: 'mark', strike: 'del', code: 'code' };
  for (const [text] of CASES) {
    const html = renderMarkdown(text).replace(/<span class="katex">[\s\S]*?<\/math><\/span>/g, ''), tags = [...html.matchAll(/<(strong|em|mark|del|code)>/g)].map(m => m[1]);
    assert.deepEqual(tags, marks(text).map(([kind]) => TAG[kind]), `${text} → ${html}`);
  }
});
