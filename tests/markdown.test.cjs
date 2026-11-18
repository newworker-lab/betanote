'use strict';
// Notes Markdown: escaping, the supported marks, KaTeX math, safe links and the 그림 설명 header.
const test = require('node:test'), assert = require('node:assert/strict');
const { renderMarkdown, noteTitle, isFigureNote, sourceKind } = require('../desktop/markdown.js');

test('escapes HTML so a note cannot run code or add elements', () => {
  const html = renderMarkdown('<img src=x onerror=alert(1)> <script>x</script> "q" & \'s\'');
  assert.ok(!/<img|<script/.test(html)); assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/); assert.match(html, /&quot;q&quot; &amp; &#39;s&#39;/);
  assert.ok(!/onerror="/.test(renderMarkdown('[a](https://x.y/"onerror="alert(1))')));
});
test('renders headings, emphasis, lists, quotes, code, tables and rules', () => {
  const html = renderMarkdown('# 제목\n**굵게** *기울임* ~~취소~~ ==형광== `a<b`\n\n- 하나\n  - 둘\n- [x] 끝\n\n1. 첫째\n2. 둘째\n\n> 인용\n\n```\n<raw>\n```\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n---');
  for (const part of ['<h2>제목</h2>', '<strong>굵게</strong>', '<em>기울임</em>', '<del>취소</del>', '<mark>형광</mark>', '<code>a&lt;b</code>', '<ul><li>하나<ul><li>둘</li></ul></li>', 'class="md-task"><input type="checkbox" disabled checked> 끝', '<ol><li>첫째</li><li>둘째</li></ol>', '<blockquote><p>인용</p></blockquote>', '<pre><code>&lt;raw&gt;</code></pre>', '<th>a</th>', '<td>2</td>', '<hr>'])
    assert.ok(html.includes(part), part);
});
test('typesets inline and display math with KaTeX; a bad formula stays readable', () => {
  const html = renderMarkdown('질량 $E=mc^2$ 와\n\n$$\n\\frac{a}{b}\n$$\n\n가격 \\$5 와 $5');
  assert.match(html, /<span class="katex">/); assert.match(html, /class="md-math"><span class="katex-display">/); assert.match(html, /mfrac/);
  assert.match(html, /가격 \$5 와 \$5/, 'a dollar sign that is not math stays text');
  const bad = renderMarkdown('$\\frac{$'); assert.ok(!/<script/.test(bad));
  const link = renderMarkdown('$\\href{javascript:alert(1)}{x}$'); assert.ok(!/<a\b|href="/.test(link), 'math makes no links');
});
test('only http(s) links become links, and (p. N) jumps to the page', () => {
  const html = renderMarkdown('[좋음](https://example.org/a) [나쁨](javascript:alert(1)) [파일](file:///etc/passwd) http://plain.test/x 참고 (p. 12)');
  assert.match(html, /<a href="https:\/\/example.org\/a" data-external-link/); assert.match(html, /<a href="http:\/\/plain.test\/x" data-external-link>/);
  assert.ok(!/href="javascript|href="file/.test(html)); assert.match(html, /data-annotation-page="12"/);
});
test('the 그림 설명 header becomes an icon chip and names the note', () => {
  const note = '[그림 설명 · paper.pdf · 3페이지 · model]\n가로축은 시간';
  assert.match(renderMarkdown(note), /class="md-figure"><svg[^>]*>.*<\/svg><span>그림 설명 · paper.pdf · 3페이지 · model<\/span>/);
  assert.equal(isFigureNote(note), true); assert.equal(isFigureNote('그냥 메모'), false);
  assert.equal(noteTitle(note), '그림 설명 · paper.pdf · 3페이지 · model');
  // A file name with brackets (memos saved before names were cleaned) is still the header.
  assert.match(renderMarkdown('[그림 설명 · paper [v2].pdf · 4페이지 · model]'), /<span>그림 설명 · paper \[v2\]\.pdf · 4페이지 · model<\/span><a href="#" class="md-source-link" data-annotation-page="4"/); assert.equal(noteTitle('\n## 실험 *설계*\n본문'), '실험 설계'); assert.equal(noteTitle(''), '');
});
test('AI 설명 headers link to their page; memo pictures show only through the given address', () => {
  const html = renderMarkdown('[AI 설명 · a.pdf · 4페이지 · m]\n![그림 · 4쪽](note-image:0123456789abcdef0123456789abcdef.png)', { imageUrl: n => 'app://note-image/v/' + n });
  assert.match(html, /class="md-figure"><svg[^]*<span>AI 설명 · a.pdf · 4페이지 · m<\/span><a href="#" class="md-source-link" data-annotation-page="4"/);
  assert.match(html, /<figure class="md-image"><img src="app:\/\/note-image\/v\/0123456789abcdef0123456789abcdef.png" alt="그림 · 4쪽"/);
  assert.doesNotMatch(renderMarkdown('![x](note-image:0123456789abcdef0123456789abcdef.png)'), /<img/, 'no address, no picture');
  assert.doesNotMatch(renderMarkdown('![x](https://evil.test/a.png) ![y](note-image:../../etc.png)', { imageUrl: n => n }), /<img/);
  assert.equal(sourceKind('[AI 설명 · a · 1페이지 · m]\nx'), 'AI 설명'); assert.equal(sourceKind('메모'), '');
});
test('code and math inside a link label show inside the link, not as set-aside marks', () => {
  for (const [text, inside] of [['[`code`](https://example.com/a)', /<a href="https:\/\/example\.com\/a"[^>]*><code>code<\/code><\/a>/], ['[$x^2$ here](https://e.com)', /<a href="https:\/\/e\.com"[^>]*><span class="katex">[\s\S]*<\/span> here<\/a>/], ['[**b** `c`](https://e.com)', /<a [^>]*><strong>b<\/strong> <code>c<\/code><\/a>/]]) {
    const html = renderMarkdown(text);
    assert.ok(!/\u0000/.test(html), `${text}: ${JSON.stringify(html)}`); assert.match(html, inside, text);
  }
});
test('bold, italic, highlight and strike nest, and *** is bold italic', () => {
  const inline = text => renderMarkdown(text).replace(/^<p>|<\/p>\n?$/g, '');
  assert.equal(inline('***굵은 기울임***은'), '<strong><em>굵은 기울임</em></strong>은');
  assert.equal(inline('**==형광 굵게==**'), '<strong><mark>형광 굵게</mark></strong>');
  assert.equal(inline('==**굵은 형광**== ~~*취소 기울임*~~'), '<mark><strong>굵은 형광</strong></mark> <del><em>취소 기울임</em></del>');
  assert.equal(inline('***a** b* ***c* d**'), '<em><strong>a</strong> b</em> <strong><em>c</em> d</strong>');
  assert.equal(inline('**굵게**는 *기울임*으로 ==형광==을 __밑줄__과 _기울임_은'), '<strong>굵게</strong>는 <em>기울임</em>으로 <mark>형광</mark>을 <strong>밑줄</strong>과 <em>기울임</em>은');
  assert.equal(inline('snake_case_name 2 * 3 * 4'), 'snake_case_name 2 * 3 * 4');
});
