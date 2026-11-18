// What the app writes into memos: eight languages, written in the AI answer language and read back in any.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { MEMO_LANGUAGES, WORDS, READ_TOO, memoLabel, memoDate, readMemoHead, startsWithHead, readFigureMemoHead, isAiHead, isAutoTitle, pageIn, isFigureMemoFor, memoGlance } = require('../core/memo-labels.cjs');
const appName = require('../core/app-name.cjs');

test('Korean labels are the text the app has always written', () => {
  // Each against the template the code used before (desktop/insight.js, ink.js, notes.js, renderer.js, storage.cjs).
  const file = 'paper.pdf', page = 12, model = 'gpt-x', date = '2026. 11. 13.';
  assert.equal(memoLabel('explainHead', 'ko', { file, page, model }), `AI 설명 · ${file} · ${page}페이지 · ${model}`);
  assert.equal(memoLabel('explainTitle', 'ko', { page }), `AI 설명 · ${page}쪽`);
  assert.equal(memoLabel('figureHead', 'ko', { file, page, model }), `그림 설명 · ${file} · ${page}페이지 · ${model}`);
  for (const [kind, word] of [['summary', '구조화 요약'], ['explain', '선택 설명'], ['ask', '질문']]) assert.equal(memoLabel('resultHead', 'ko', { kind, model, date }), `AI ${word} · ${model} · ${date}`);
  assert.equal(memoLabel('compareHead', 'ko', { model, others: 'A, B' }), `AI 비교 · ${model} · 함께 비교: A, B`);
  assert.equal(memoLabel('contribution', 'ko'), ' 기여');
  assert.equal(memoLabel('translationLine', 'ko'), '번역: ');
  assert.equal(memoLabel('translationBold', 'ko'), '**번역** ');
  assert.equal(memoLabel('modelReading', 'ko'), '(모델 해석)');
  assert.equal(memoLabel('noEvidence', 'ko'), '(근거 부족)');
  assert.equal(memoLabel('noEvidenceSuffix', 'ko'), ' — 근거 부족');
  assert.equal(memoLabel('noExplanation', 'ko'), '(설명 없음)');
  assert.equal(memoLabel('annotationDigest', 'ko', { date }), `— 주석 모음 (${date}) —`);
  assert.equal(memoLabel('textBox', 'ko'), '텍스트 상자: ');
  assert.equal(memoLabel('highlights', 'ko', { n: 3 }), '형광펜 표시 3곳');
  assert.equal(memoLabel('conflictMark', 'ko'), '\n\n--- 이 PC에서 저장하지 못한 내용 ---\n');
  assert.equal(memoLabel('questionPicture', 'ko'), '질문 그림');
  assert.equal(memoLabel('pastedPicture', 'ko'), '붙여넣은 그림');
  assert.equal(memoLabel('figurePicture', 'ko', { page: 4 }), '그림 · 4쪽');
});

test('every language has every word, and a head written in any of them is read back', () => {
  assert.equal(MEMO_LANGUAGES.length, 8);
  const keys = Object.keys(WORDS.ko);
  for (const language of MEMO_LANGUAGES) {
    assert.deepEqual(Object.keys(WORDS[language]), keys, language);
    for (const value of Object.values(WORDS[language])) assert.ok(value.trim(), `${language} has every word`);
    for (const [name, kind] of [['explainHead', 'explain'], ['figureHead', 'figure']]) {
      const head = memoLabel(name, language, { file: 'a.pdf', page: 7, model: 'm' });
      assert.ok(!/[{}]/.test(head), `${language} ${name}`);
      const read = readMemoHead(`[${head}]`);
      assert.equal(read.kind, kind, `${language} ${name}`); assert.equal(read.page, 7); assert.equal(read.language, language);
    }
    assert.ok(isAiHead(`[${memoLabel('resultHead', language, { kind: 'summary', model: 'm', date: 'd' })}]`), language);
    assert.ok(isAiHead(`[${memoLabel('resultHead', language, { kind: 'summary', model: 'm', date: 'd' })}]${memoLabel('contribution', language)}`), language);
    assert.ok(isAiHead(`[${memoLabel('compareHead', language, { model: 'm', others: 'x' })}]`), language);
    assert.ok(isAutoTitle(memoLabel('explainTitle', language, { page: 3 })), language);
    assert.match(memoLabel('conflictMark', language), /^\n\n--- .+ --- *\n$/, language);
    assert.equal(pageIn(memoLabel('figurePicture', language, { page: 9 })), 9, language);
  }
  // No two languages share a source head word: the language a head was written in is known.
  const heads = MEMO_LANGUAGES.flatMap(l => [WORDS[l].figure, WORDS[l].explain]);
  assert.equal(new Set(heads).size, heads.length);
});

test('a line the reader wrote is not taken for a head', () => {
  assert.equal(readMemoHead('[내 메모 · 3쪽]'), null);
  assert.equal(readMemoHead('AI 설명 · 3쪽'), null);
  assert.equal(readMemoHead('[AI 설명]'), null);
  assert.equal(isAiHead('[Alice · notes]'), false);
  assert.equal(isAutoTitle('My figure · p. 3'), false);
  assert.equal(isAutoTitle('그림 설명 · 내 메모'), false);
});

test('Korean heads written before, as the app reads them now', () => {
  assert.deepEqual(readMemoHead('[그림 설명 · paper.pdf · 3페이지 · gpt]'), { kind: 'figure', language: 'ko', label: '그림 설명', detail: 'paper.pdf · 3페이지 · gpt', page: 3 });
  assert.equal(readMemoHead('[AI 설명 · a.pdf · 4페이지 · m]').page, 4);
  assert.ok(isAiHead('[AI 구조화 요약 · m · 2026. 11. 13.] 기여'));
  assert.ok(isAutoTitle('그림 설명 · 3 쪽'));
  assert.ok(isAutoTitle('AI 선택 설명 · 12쪽'));
  assert.ok(isAutoTitle('주석 · 2쪽'));
});

test('a sync conflict keeps both texts under the marker the app has always written, or the AI language one', () => {
  const { mergePendingNotes } = require('../desktop/storage.cjs');
  const base = { k: 'a' }, theirs = { k: 'b' }, mine = { k: 'c' };
  assert.equal(mergePendingNotes(base, theirs, mine).notes.k, 'b\n\n--- 이 PC에서 저장하지 못한 내용 ---\nc');
  const german = mergePendingNotes(base, theirs, mine, 'de').notes.k;
  assert.equal(german, `b${memoLabel('conflictMark', 'de')}c`);
  assert.ok(german.includes('--- auf diesem PC nicht gespeichert ---'));
});

// The rules before memo-labels (4cb0791), kept here as they were: every Korean line they took is taken now with
// the same result (kind, accepted or not, page).
const OLD = {
  head: /^\[(그림 설명|AI 설명) · (.{1,300})\]$/, // markdown.js FIGURE_HEAD
  liveSource: /^\[(그림 설명|AI 설명) · ([^\]\n]{1,300})\]$/, // live-scan.js SOURCE
  livePage: detail => Number(detail.match(/ (\d{1,4})\s*(?:페이지|쪽)(?: ·|$)/)?.[1]) || null, // live-scan.js
  memoPage: line => OLD.head.test(line) ? Number(line.match(/ · (\d{1,4})\s*(?:페이지|쪽)(?: · |\])/)?.[1]) || null : null, // notes.js memoPage
  glanceSkip: line => /^\[(그림 설명|AI 설명) · /.test(line), // notes.js memoGlance
  aiHead: line => /^\[AI [^\]\n]*\]( 기여)?$/.test(line.trim()), // notes.js
  autoTitle: title => /^(그림 설명|AI 선택 설명|AI 설명|주석) · \d+\s*쪽$/.test(title), // notes.js ownAnnotationTitle
  pinHead: (text, name) => text.startsWith(`[그림 설명 · ${name} · `), // ink.js figure pins
  figureMemo: /^\[그림 설명 · (?:.*) · (\d{1,4})\s*(?:페이지|쪽) · ([^\]]*)\]\s*$/, // storage.cjs migrateFigureMemos
};
const SAMPLES = [
  '[AI 설명 · paper.pdf · 5페이지 · gpt]', '[AI 설명 · 12페이지 요약.pdf · 5페이지 · m]', '[AI 설명 · 3쪽 메모.pdf · 5쪽 · m]',
  '[그림 설명 · a.pdf · 3 페이지 · m]', '[그림 설명 · a.pdf · 3 쪽 · m]', '[AI 설명 · a.pdf · 12345페이지 · m]', '[그림 설명 · 파일 [v2].pdf · 7페이지 · m]',
  '[그림 설명 · a.pdf · 4페이지 · gpt · mini]', '[AI 설명 · a.pdf · m]', '[그림 설명 · 5페이지]', '[그림 설명 · ' + 'x'.repeat(320) + ' · 2쪽 · m]',
  '[내 메모 · 3쪽]', 'AI 설명 · 3쪽', '[AI 설명 · a.pdf · 5페이지 · m', '[AI 구조화 요약 · m · 2026. 11. 13.]', '[AI 구조화 요약 · m · 2026. 11. 13.] 기여',
];
test('every Korean head the earlier rules read is read now with the same result', () => {
  for (const line of SAMPLES) {
    const old = OLD.head.exec(line), now = readMemoHead(line);
    assert.equal(Boolean(now), Boolean(old), line);
    if (old) { assert.equal(now.label, old[1], line); assert.equal(now.detail, old[2], line); assert.equal(now.page ?? null, OLD.memoPage(line), line); }
    const live = OLD.liveSource.exec(line);
    if (live && OLD.livePage(live[2]) !== null) assert.equal(now.page, OLD.livePage(live[2]), line);
    assert.equal(startsWithHead(line), OLD.glanceSkip(line), line);
    assert.equal(isAiHead(line), OLD.aiHead(line), line);
  }
});
test('a memo with text under its head keeps its figure pin, as the earlier start check did (the check ink.js calls)', () => {
  const text = '[그림 설명 · paper.pdf · 3페이지 · gpt]\n\nThe horizontal axis is time.\nMore lines.';
  for (const sample of [text, ...SAMPLES]) for (const names of [['paper.pdf'], ['a.pdf', 'a'], ['파일 [v2].pdf'], ['x']])
    assert.equal(isFigureMemoFor(sample, names), names.some(name => OLD.pinHead(sample, name)), `${sample.slice(0, 40)} ${names}`);
  assert.ok(isFigureMemoFor(`[${memoLabel('figureHead', 'ja', { file: 'a.pdf', page: 3, model: 'm' })}]\nbody`, ['a.pdf']), 'a Japanese figure memo');
  assert.equal(isFigureMemoFor(text, ['other.pdf']), false);
});
test('a closed memo shows the line the earlier glance showed (the function notes.js calls)', () => {
  // notes.js memoGlance before memo-labels (4cb0791), kept here as it was.
  const oldGlance = text => { const lines = String(text || '').split('\n').map(l => l.trim()).filter(Boolean), image = lines.map(l => l.match(/^!\[[^\]]*\]\(note-image:([0-9a-f]{32}\.png)\)$/)?.[1]).find(Boolean) || '';
    const line = lines.find(l => !/^!\[[^\]]*\]\(note-image:/.test(l) && !OLD.glanceSkip(l) && !/^(```|~~~|\$\$|---|\|)/.test(l)) || '';
    return { line: line.replace(/^#{1,6}\s+/, '').replace(/^>\s?/, '').replace(/^([-*+]|\d+[.)])\s+(\[[ xX]\]\s+)?/, ''), image }; };
  const picture = '![](note-image:' + 'a'.repeat(32) + '.png)';
  for (const head of SAMPLES) for (const body of ['The answer.', '## Heading', '> quoted', '- [x] done', '1) first', picture + '\nText', '```\ncode\n```\nafter', '| a | b |\nrow', '---\nline', ''])
    assert.deepEqual(memoGlance(`${head}\n${body}`), oldGlance(`${head}\n${body}`), `${head} / ${body}`);
  assert.equal(memoGlance('[AI 解説 · a.pdf · 4ページ · m]\nThe answer.').line, 'The answer.', 'a head in another language is skipped too');
});
test('an older figure memo head is read as the earlier rule read it (readFigureMemoHead, any page number)', () => {
  for (const line of SAMPLES.filter(l => l.startsWith('[그림 설명')).concat(['[그림 설명 · a · 9 쪽 · m]  ', '[그림 설명 · ' + 'y'.repeat(500) + ' · 8페이지 · gpt · x]', '[그림 설명 · a.pdf · 600페이지 · m]', '[그림 설명 · a.pdf · 9999쪽 · m · x]'])) {
    const old = OLD.figureMemo.exec(line), now = readFigureMemoHead(line);
    assert.equal(Boolean(now), Boolean(old), line.slice(0, 60));
    if (old) { assert.equal(now.page, Number(old[1]), line.slice(0, 60)); assert.equal(now.model, old[2], line.slice(0, 60)); }
  }
});
test('a stored language the app does not know is read as Korean', () => {
  for (const language of ['__proto__', 'toString', 'constructor', 'xx', '', null, undefined, 42]) {
    assert.equal(memoLabel('resultHead', language, { kind: 'summary', model: 'm', date: 'd' }), 'AI 구조화 요약 · m · d', String(language));
    assert.equal(memoDate(Date.UTC(2026, 10, 13, 12), language), memoDate(Date.UTC(2026, 10, 13, 12), 'ko'), String(language));
  }
});
test('an older figure memo is moved into annotations as before (Library.migrateFigureMemos)', async () => {
  const fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path'), { Library } = require('../desktop/storage.cjs');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `${appName.id}-figure-memos-`));
  try {
    await fs.writeFile(path.join(dir, 'paper.pdf'), Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n%%EOF'));
    const root = path.join(dir, 'vault'); await fs.mkdir(root);
    const library = await Library.open(root), [{ paperId }] = await library.importFiles([path.join(dir, 'paper.pdf')]);
    const lines = SAMPLES.filter(l => l.startsWith('[그림 설명')).concat(['[그림 설명 · a · 9 쪽 · m]  ', '[그림 설명 · ' + 'y'.repeat(500) + ' · 8페이지 · gpt · x]', '[그림 설명 · a.pdf · 600페이지 · m]']);
    const keys = lines.map((line, i) => `${paperId}-메모-${(1e12 + i).toString(36)}`), notes = { ...library.data.notes };
    lines.forEach((line, i) => { notes[keys[i]] = `${line}\nThe body ${i}.`; });
    await library.saveNotes(notes);
    await library.migrateFigureMemos();
    lines.forEach((line, i) => {
      const old = OLD.figureMemo.exec(line), moved = old && Number(old[1]) >= 1 && Number(old[1]) <= 500;
      const annotation = library.data.annotations.find(a => a.body === `The body ${i}.`);
      assert.equal(Boolean(annotation), Boolean(moved), line.slice(0, 60));
      assert.equal(library.data.notes[keys[i]] === undefined, Boolean(moved), line.slice(0, 60));
      if (moved) { assert.equal(annotation.page, Number(old[1]), line.slice(0, 60)); assert.equal(annotation.model, old[2].trim(), line.slice(0, 60)); }
    });
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
test('every word kept in READ_TOO is still read where the app reads that word', () => {
  assert.deepEqual(READ_TOO, { es: { contribution: ['aportación'] } });
  for (const [language, keys] of Object.entries(READ_TOO)) for (const [key, words] of Object.entries(keys)) for (const word of words) {
    if (key === 'contribution') assert.ok(isAiHead(`[AI ${WORDS[language].summary} · m · d] ${word}`), word);
    else if (key === 'explain') assert.equal(readMemoHead(`[AI ${word} · a.pdf · m]`)?.language, language, word);
    else if (key === 'figure') assert.equal(readMemoHead(`[${word} · a.pdf · m]`)?.language, language, word);
    else if (key === 'selection') assert.ok(isAutoTitle(`AI ${word} · ${WORDS[language].pageShort.replace('{page}', '3')}`), word);
    else if (key === 'page' || key === 'pageShort') { assert.equal(pageIn(`a · ${word.replace('{page}', '7')}`), 7, word); if (key === 'pageShort') assert.ok(isAutoTitle(`${WORDS[language].figure} · ${word.replace('{page}', '3')}`), word); }
    else assert.fail(`${key} is not read back`);
  }
});
test('annotation titles the earlier rule took as the app\'s own are still taken', () => {
  for (const title of ['그림 설명 · 3쪽', '그림 설명 · 3 쪽', 'AI 선택 설명 · 12쪽', 'AI 설명 · 4쪽', '주석 · 2쪽', '그림 설명 · 12345쪽', '그림 설명 · 내 메모', 'My figure · p. 3', '주석'])
    assert.equal(isAutoTitle(title), OLD.autoTitle(title), title);
});
test('dates name the month in English and keep the Korean form', () => {
  const day = Date.UTC(2026, 10, 13, 12);
  assert.equal(memoDate(day, 'en'), 'Nov 13, 2026');
  assert.equal(memoDate(day, 'ko'), new Date(day).toLocaleDateString('ko-KR'));
});
