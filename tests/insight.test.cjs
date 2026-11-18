const { test } = require('node:test');
const assert = require('node:assert/strict');
const { summarize, explain, ask, retrieve, fitBudget, pagesNamed } = require('../desktop/insight.cjs');
const appName = require('../core/app-name.cjs');
const blocks = [
  { id: 'p1-b1', page: 1, text: 'We study how layout affects reading speed.', section: 'Introduction', x: 10, y: 20, width: 300, height: 40, pageWidth: 800, pageHeight: 1066 },
  { id: 'p2-b1', page: 2, text: 'Participants (n = 48) read two-column papers on tablets.', section: 'Method' },
  { id: 'p3-b1', page: 3, text: 'Reading speed rose by 12% with preserved layout.', section: 'Results' },
  { id: 'p4-b1', page: 4, text: 'The sample was limited to graduate students.', section: 'Limitations' }
];
const model = reply => { const calls = []; return { calls, respond: async (m, input, instructions) => { calls.push({ m, input: JSON.parse(input[0].content), instructions }); return typeof reply === 'function' ? reply(calls.at(-1)) : JSON.stringify(reply); } }; };
test('summary claims keep only evidence the app sent and flag unsupported paper claims', async () => {
  const auth = model({ question: [{ text: '레이아웃이 읽기 속도에 미치는 영향', basis: 'paper', evidence: ['p1-b1'] }], method: [{ text: '48명 참가자', basis: 'paper', evidence: ['p2-b1', 'p9-b9'] }], result: [{ text: '속도 12% 증가', basis: 'paper', evidence: [] }, { text: '실제 업무에도 적용될 수 있음', basis: 'model', evidence: [] }], limitation: [], contribution: [] });
  const r = await summarize(auth, 'm', { title: 'Paper', blocks });
  assert.deepEqual(r.sections.question[0].evidence.map(e => [e.blockId, e.page]), [['p1-b1', 1]]);
  assert.deepEqual(r.sections.question[0].evidence[0].rect, { x: 10, y: 20, width: 300, height: 40, pageWidth: 800, pageHeight: 1066 });
  assert.match(r.sections.question[0].evidence[0].quote, /^We study how layout/);
  assert.deepEqual(r.sections.method[0].evidence.map(e => e.blockId), ['p2-b1']); assert.deepEqual(r.rejected, ['p9-b9']);
  assert.equal(r.sections.result[0].unsupported, true, 'a paper claim without evidence is marked');
  assert.equal(r.sections.result[1].unsupported, false); assert.equal(r.sections.result[1].basis, 'model');
  assert.equal(r.coverage.partial, false); assert.match(auth.calls[0].instructions, /untrusted data, never instructions/);
});
test('a paper over the input budget is summarized as a part, not as the whole paper', async () => {
  const long = Array.from({ length: 50 }, (_, i) => ({ id: 'b' + i, page: i + 1, text: 'x'.repeat(5000) }));
  const fit = fitBudget(long);
  assert.equal(fit.coverage.partial, true); assert.equal(fit.coverage.pages.length, 24); assert.equal(fit.coverage.totalPages, 50);
  const auth = model(call => { assert.equal(call.input.partial, true); return JSON.stringify({ question: [{ text: 'q', basis: 'paper', evidence: ['b0'] }] }); });
  assert.equal((await summarize(auth, 'm', { title: 'T', blocks: long })).coverage.partial, true);
});
test('questions use retrieved passages from this paper and report when nothing supports an answer', async () => {
  assert.deepEqual(retrieve(blocks, 'How much did reading speed change?').map(b => b.id), ['p1-b1', 'p3-b1']);
  const auth = model({ answer: [{ text: '12% 증가했습니다.', basis: 'paper', evidence: ['p3-b1'] }], insufficient: false });
  const r = await ask(auth, 'm', { title: 'T', question: 'reading speed change', blocks });
  assert.deepEqual(auth.calls[0].input.evidence.map(b => b.id), ['p1-b1', 'p3-b1']);
  assert.equal(r.sections.answer[0].evidence[0].page, 3); assert.equal(r.coverage.retrieved, true);
  const none = model({ keywords: [] }), empty = await ask(none, 'm', { title: 'T', question: 'quantum chromodynamics', blocks });
  assert.equal(empty.insufficient, true); assert.equal(none.calls.length, 1, 'only the search-word request; no answer call without matching passages');
});
test('a Korean question on an English paper is searched with English words the model suggests', async () => {
  const auth = model(call => call.instructions.includes('search keywords') ? JSON.stringify({ keywords: ['limited', 'sample', 'graduate students'] }) : JSON.stringify({ answer: [{ text: '대학원생으로 표본이 한정됐습니다.', basis: 'paper', evidence: ['p4-b1'] }], insufficient: false }));
  const r = await ask(auth, 'm', { title: 'T', question: '이 연구의 한계는 무엇인가요?', blocks });
  assert.equal(auth.calls.length, 2); assert.equal(auth.calls[0].input.question, '이 연구의 한계는 무엇인가요?'); assert.match(auth.calls[0].input.paperSample, /reading speed/);
  assert.ok(auth.calls[1].input.evidence.some(b => b.id === 'p4-b1')); assert.equal(r.sections.answer[0].evidence[0].page, 4); assert.equal(r.insufficient, false);
  assert.deepEqual(retrieve([{ id: 'k', page: 1, text: '본 연구의 방법과 한계' }], '방법은 무엇인가').map(b => b.id), ['k'], 'a Korean word matches without its particle');
});
test('a question in neither Hangul nor Latin letters is searched with words the model suggests, as a Korean one', async () => {
  const cjk = [{ id: 'j1', page: 1, text: '方法 と 結果 を 述べる' }, { id: 'j2', page: 2, text: '方法 の 結果' }, { id: 'j3', page: 3, text: '制限 は 標本' }];
  const auth = model(call => call.instructions.includes('search keywords') ? JSON.stringify({ keywords: ['制限'] }) : JSON.stringify({ answer: [{ text: '標本が限られる。', basis: 'paper', evidence: ['j3'] }], insufficient: false }));
  await ask(auth, 'm', { title: 'T', question: '方法 結果', blocks: cjk, language: 'ja' });
  assert.equal(auth.calls.length, 2, 'two of its words matched, and the model was still asked for search words');
  assert.match(auth.calls[0].instructions, /search keywords/); assert.ok(auth.calls[1].input.evidence.some(b => b.id === 'j3'));
  const english = model({ answer: [], insufficient: true });
  await ask(english, 'm', { title: 'T', question: 'How much did reading speed change?', blocks });
  assert.equal(english.calls.length, 1, 'an English question that matches is asked at once, as before');
});
test('pages named in the other answer languages are read; Korean and English questions read as before', () => {
  // The rule before (e62691d), kept here as it was.
  const before = (question, lastPage) => {
    const pages = new Set(), add = (from, to = from) => { from = Number(from); to = Number(to); if (!Number.isInteger(from) || !Number.isInteger(to) || to < from || to - from > 5) to = from; for (let p = from; p <= to && pages.size < 6; p++) if (p >= 1 && p <= lastPage) pages.add(p); };
    for (const m of String(question).matchAll(/(\d{1,3})\s*(?:[-~–]\s*(\d{1,3})\s*)?(?:쪽|페이지|page\b|pages\b)/gi)) add(m[1], m[2] || m[1]);
    for (const m of String(question).matchAll(/\b(?:pp?\.|pages?)\s*(\d{1,3})(?:\s*[-~–]\s*(\d{1,3}))?/gi)) add(m[1], m[2] || m[1]);
    return [...pages].sort((a, b) => a - b);
  };
  const korean = ['3쪽 그림은?', '3~5쪽을 요약해 줘', '12페이지 표의 의미', '2 페이지와 4쪽', '48명의 참가자는 2024년에', '방법은 무엇인가요?', '1-3쪽, 7쪽', '표 S. 3은?', '그림 3 (p. 4)', '３쪽과 3〜5쪽', '웹사이트 Webseite 3'];
  const english = ['What does page 3 say?', 'Summarize pp. 3-5', 'See p. 7 and pages 9–10', 'Table 2 on 4 pages', 'The 48 readers in 2024', 'Page 30 of 12', 'Explain Fig. 3', 'p.2 vs p. 12', 'Smith et al. (2020), S. 3'];
  for (const q of [...korean, ...english]) assert.deepEqual(pagesNamed(q, 20), before(q, 20), q);
  assert.deepEqual(pagesNamed('第3页的图是什么？', 20), [3]); assert.deepEqual(pagesNamed('3-5ページの表', 20), [3, 4, 5]);
  assert.deepEqual(pagesNamed('Was zeigt Seite 4? Und Tabelle S. 7?', 20), [4], 'S. 7 names a supplementary table as often as a page'); assert.deepEqual(pagesNamed('¿Qué dice la página 2?', 20), [2]);
  assert.deepEqual(pagesNamed('Cosa dice la pagina 6?', 20), [6]); assert.deepEqual(pagesNamed('Que dit la page 5 ?', 20), [5]);
  // In the middle of a sentence, with ranges, full-width digits and plurals.
  for (const [q, pages] of [['这篇论文第3页说了什么？', [3]], ['论文的第3页', [3]], ['第10页到第12页', [10, 12]], ['第３页的表', [3]], ['この論文の3ページ目の図', [3]], ['3〜5ページ', [3, 4, 5]], ['3～5ページの表', [3, 4, 5]], ['３ページ', [3]],
    ['Was steht auf den Seiten 3-5?', [3, 4, 5]], ['¿Qué dicen las páginas 4?', [4]], ['Cosa dicono le pagine 2?', [2]], ['Webseite 3', []], ['Homepage 3', []], ['PDF第3页', [3]], ['GPT第3页的图', [3]], ['ABC3ページ', [3]]])
    assert.deepEqual(pagesNamed(q, 20), pages, q);
});
test('a selection explanation keeps the translation apart from the explanation', async () => {
  const auth = model({ translation: '참가자는 태블릿에서 읽었다.', explanation: [{ text: '표본 크기는 48명입니다.', basis: 'paper', evidence: ['p2-b1'] }, { text: '태블릿 화면은 작습니다.', basis: 'model' }] });
  const r = await explain(auth, 'm', { title: 'T', selection: 'Participants read on tablets.', page: 2, blocks });
  assert.deepEqual(auth.calls[0].input.context.map(b => b.page), [1, 2, 3], 'only nearby pages are sent');
  assert.equal(r.translation, '참가자는 태블릿에서 읽었다.'); assert.deepEqual(r.sections.explanation.map(c => c.basis), ['paper', 'model']);
  await assert.rejects(explain(auth, 'm', { selection: ' ', page: 1, blocks }), /선택/);
  await assert.rejects(summarize(model(() => 'not json'), 'm', { title: 'T', blocks }), /형식/);
  await assert.rejects(summarize(auth, 'm', { title: 'T', blocks: [{ id: '../x', page: 1, text: 'a' }] }), /문단/);
});
test('a comparison cell may only cite its own paper and each paper keeps its own coverage', async () => {
  const { compare } = require('../desktop/insight.cjs');
  const other = [{ id: 'p1-b1', page: 1, text: 'We compare scanning and reading.' }, { id: 'p2-b1', page: 2, text: 'Results show no difference.' }];
  const auth = model(call => { const [a, b] = call.input.papers; return JSON.stringify({ rows: [{ aspect: '결과', cells: [{ paper: 'P1', text: '12% 증가', basis: 'paper', evidence: [a.blocks[2].id, b.blocks[0].id] }, { paper: 'P2', text: '차이 없음', basis: 'paper', evidence: [b.blocks[1].id] }] }, { aspect: '한계', cells: [{ paper: 'P1', text: '대학원생만', basis: 'paper', evidence: [] }] }] }); });
  const r = await compare(auth, 'm', { papers: [{ paperId: 1, title: 'A', blocks }, { paperId: 2, title: 'B', blocks: other }], question: '결과 비교' });
  assert.deepEqual(r.rows[0].cells.map(c => c.evidence.map(e => [e.blockId, e.page])), [[['p3-b1', 3]], [['p2-b1', 2]]]);
  assert.deepEqual(r.rejected, ['P2:p1-b1'], 'citing the other paper is refused');
  assert.equal(r.rows[1].cells[0].unsupported, true); assert.equal(r.rows[1].cells[1].unsupported, true, 'a missing cell is marked');
  assert.deepEqual(r.papers.map(p => p.coverage.partial), [false, false]);
  await assert.rejects(compare(auth, 'm', { papers: [{ paperId: 1, title: 'A', blocks }] }), /2~5개/);
});
test('a connection with a shorter context sends less paper text and asks for JSON', async () => {
  const long = Array.from({ length: 50 }, (_, i) => ({ id: 'b' + i, page: i + 1, text: 'x'.repeat(5000) })), options = [];
  const auth = { inputBudget: 33792, respond: async (_m, input, _i, _s, _d, opts) => { options.push(opts); const sent = JSON.parse(input[0].content).blocks; assert.equal(sent.length, 6); return JSON.stringify({ question: [{ text: 'q', basis: 'paper', evidence: ['b0'] }] }); } };
  const r = await summarize(auth, 'm', { title: 'T', blocks: long });
  assert.equal(r.coverage.partial, true); assert.equal(r.coverage.chars, 30000); assert.deepEqual(options, [{ json: true }]);
});

test('a memo rewrite sends the memo and the instruction and returns the revised Markdown', async () => {
  const auth = { calls: [], respond: async (m, input, instructions) => { auth.calls.push({ input: JSON.parse(input[0].content), instructions }); return '```markdown\n- 핵심 1\n- 핵심 2\n```'; } };
  const { editMemo } = require('../desktop/insight.cjs');
  const out = await editMemo(auth, 'm', { title: 'Paper', memo: '긴 메모 $x^2$', instruction: '핵심만' });
  assert.deepEqual(out, { text: '- 핵심 1\n- 핵심 2' });
  assert.deepEqual(auth.calls[0].input, { paperTitle: 'Paper', memo: '긴 메모 $x^2$', instruction: '핵심만' });
  await assert.rejects(editMemo(auth, 'm', { memo: 'x', instruction: ' ' }), /요청할 내용/);
  await assert.rejects(editMemo(auth, 'm', { memo: ' ', instruction: '핵심만' }), /메모 내용이 없습니다/);
  // A memo is sent whole or not at all: one over the connection's budget is refused, not cut.
  await assert.rejects(editMemo({ ...auth, inputBudget: 10 }, 'm', { memo: 'x'.repeat(11), instruction: '핵심만' }), /11자/);
  // Only a reply wrapped in one fence is unwrapped; a memo that starts and ends with code keeps its fences.
  const kept = '```\na=1\n```\n\n본문\n\n```\nb=2\n```';
  assert.equal((await editMemo({ respond: async () => kept }, 'm', { memo: 'x', instruction: 'y' })).text, kept);
  // A ```markdown wrapper is taken off even when the memo inside has code blocks.
  const wrapped = '```markdown\n# 메모\n\n```python\nx=1\n```\n\n본문\n```';
  assert.equal((await editMemo({ respond: async () => wrapped }, 'm', { memo: 'x', instruction: 'y' })).text, '# 메모\n\n```python\nx=1\n```\n\n본문');
});

test('a question on a memo or summary section sends the question with the section and the chosen passage as context', async () => {
  const { memoAssist } = require('../desktop/insight.cjs');
  const auth = { calls: [], respond: async (m, input, instructions) => { auth.calls.push({ input: JSON.parse(input[0].content), instructions }); return '```markdown\n답: $x$\n```'; } };
  const out = await memoAssist(auth, 'm', { mode: 'ask', title: 'Paper', section: '방법', memo: '지금까지 쓴 내용', instruction: '이 방법을 쉽게 설명해 줘', selection: 'We use a transformer.', page: 3 });
  assert.deepEqual(out, { text: '답: $x$' });
  assert.deepEqual(auth.calls[0].input, { paperTitle: 'Paper', section: '방법', note: '지금까지 쓴 내용', selection: 'We use a transformer.', page: 3, question: '이 방법을 쉽게 설명해 줘' });
  assert.match(auth.calls[0].instructions, /context only/);
  // An empty section may be asked about; only the question is needed.
  await memoAssist(auth, 'm', { mode: 'ask', title: 'Paper', memo: '', instruction: '배경 지식' });
  assert.deepEqual(auth.calls[1].input, { paperTitle: 'Paper', question: '배경 지식' });
  await assert.rejects(memoAssist(auth, 'm', { mode: 'ask', memo: 'x', instruction: ' ' }), /물을 내용/);
  // A long section goes as context by its latest part, within the connection's budget.
  await memoAssist({ ...auth, inputBudget: 10 }, 'm', { mode: 'ask', memo: 'x'.repeat(5) + 'abcdefghij', instruction: 'q' });
  assert.equal(auth.calls[2].input.note, 'abcdefghij');
});

test('pictures sent with a memo question go beside it in the connection\'s image message', async () => {
  const { memoAssist } = require('../desktop/insight.cjs');
  const png = 'data:image/png;base64,iVBORw0KGgo=', calls = [];
  const auth = { label: '시험 연결', imageMessage: (text, images) => ({ role: 'user', content: text, images }), respond: async (m, input) => { calls.push(input[0]); return '그림 답'; } };
  assert.deepEqual(await memoAssist(auth, 'm', { mode: 'ask', title: 'P', memo: '', instruction: '이 그림은?', images: [png, 'not an image', png, png, png] }), { text: '그림 답' });
  assert.deepEqual(calls[0].images, [png, png, png], 'only PNG data URLs, at most 3');
  assert.equal(JSON.parse(calls[0].content).images, 3);
  // A connection that cannot take images says so instead of dropping them.
  await assert.rejects(memoAssist({ label: '텍스트 연결', respond: auth.respond }, 'm', { mode: 'ask', memo: '', instruction: 'q', images: [png] }), /그림을 함께 보낼 수 없습니다/);
});

test('a question about an AI tab result sends that result as the earlier result, not as the note', async () => {
  const { memoAssist } = require('../desktop/insight.cjs');
  const calls = [], auth = { respond: async (m, input, instructions) => { calls.push({ body: JSON.parse(input[0].content), instructions }); return '답'; } };
  await memoAssist(auth, 'm', { mode: 'ask', title: 'P', section: '질문', memo: 'Q. 속도는?\n답변: 12%', instruction: '평균인가요?', context: 'ai-result' });
  assert.equal(calls[0].body.earlierResult, 'Q. 속도는?\n답변: 12%'); assert.equal(calls[0].body.note, undefined); assert.match(calls[0].instructions, /earlierResult is an earlier AI result/);
});

test('follow-ups are kept under their result, oldest first, at most 50', async () => {
  const fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path');
  const { InsightStore } = require('../desktop/insight.cjs');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), `${appName.id}-follow-`));
  try {
    const library = { root, attachment: () => ({ id: 'att-1' }) }, store = new InsightStore(library);
    const saved = await store.add(1, 'att-1', { kind: 'ask', question: 'q', sections: {} }, { connection: 'c', model: 'm', sourceHash: 'h' });
    for (let i = 0; i < 52; i++) await store.followUp(1, 'att-1', saved.id, { text: `**Q. ${i}**\n\n답 ${i}`, model: 'm' });
    const [r] = await store.list(1, 'att-1'); assert.equal(r.followUps.length, 50); assert.match(r.followUps[0].text, /Q\. 2\*\*/); assert.match(r.followUps.at(-1).text, /답 51/);
    await assert.rejects(store.followUp(1, 'att-1', saved.id, { text: '  ' }), /추가할 답이 없습니다/);
    await assert.rejects(store.followUp(1, 'att-1', 'missing', { text: 'x' }), /찾을 수 없습니다/);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('tag suggestions reuse the vault\'s own tags, skip what the paper has, and drop what is not a tag', async () => {
  const { suggestTags, cleanTagNames } = require('../desktop/insight.cjs');
  let sent, instructions;
  const auth = { respond: async (_model, input, text) => { sent = JSON.parse(input[0].content); instructions = text; return JSON.stringify({ tags: [
    { name: 'deep learning', reason: '기존 태그와 같은 주제' }, { name: 'Fault-Detection', reason: '이미 있음' }, { name: '#LSTM 오토인코더.', reason: '모델' },
    { name: 'This paper proposes a new method for detecting faults in pharmaceutical processes' }, { name: 'a, b' }, { name: 'LSTM  오토인코더' }, 'batch process', { name: '' }, { name: '__proto__' }] }); } };
  const blocks = Array.from({ length: 40 }, (_, i) => ({ id: `p1-b${i}`, page: 1, text: 'Unsupervised fault detection with LSTM autoencoders. '.repeat(12) }));
  const result = await suggestTags(auth, 'm', { title: 'Fault detection', blocks, existing: ['Deep Learning', 'fault detection', '공정'], current: ['fault detection'] });
  assert.deepEqual(result.tags.map(t => [t.name, t.existing]), [['Deep Learning', true], ['LSTM 오토인코더', false], ['batch process', false]]);
  assert.equal(result.tags[0].reason, '기존 태그와 같은 주제');
  assert.deepEqual(sent.existingTags, ['Deep Learning', 'fault detection', '공정']); assert.deepEqual(sent.currentTags, ['fault detection']);
  assert.ok(sent.text.length <= 12000 && result.coverage.partial, 'only the opening of the paper is sent');
  assert.match(instructions, /untrusted data/); assert.match(instructions, /existingTags/);
  assert.equal(cleanTagNames(Array.from({ length: 20 }, (_, i) => `tag ${i}`), [], []).length, 8);
  await assert.rejects(suggestTags({ respond: async () => JSON.stringify({ tags: [{ name: 'fault detection' }] }) }, 'm', { title: 't', blocks, existing: [], current: ['fault detection'] }), /추가할 태그를 찾지 못했습니다/);
});

test('a question that names pages or pastes a passage takes those pages along, as 선택 설명 did', async () => {
  const { pagesNamed, passagesQuoted } = require('../desktop/insight.cjs');
  assert.deepEqual(pagesNamed('3쪽의 식을 설명해 줘', 10), [3]); assert.deepEqual(pagesNamed('p. 5와 7페이지를 비교해 줘', 10), [5, 7]);
  assert.deepEqual(pagesNamed('pp. 2-4 요약', 10), [2, 3, 4]); assert.deepEqual(pagesNamed('What does page 9 say? and 12쪽', 10), [9], 'a page the paper does not have is left out');
  assert.deepEqual(pagesNamed('3~5쪽', 10), [3, 4, 5]); assert.deepEqual(pagesNamed('2020년에 48명이 참가했나요?', 10), [], 'years and counts are not pages');
  assert.deepEqual(pagesNamed('1-9쪽', 10), [1], 'a long range is not taken whole');
  const paper = [];
  for (let page = 1; page <= 6; page++) for (let i = 0; i < 3; i++) paper.push({ id: `p${page}-b${i}`, page, text: `Page ${page} paragraph ${i} discusses the fermentation batch ${page * 10 + i} in detail with enough words to be a real paragraph of the paper.` });
  paper[10].text = 'The residual   spectrum is projected onto the loading matrix and the squared prediction error is computed for every batch.'; // p4-b1
  assert.deepEqual(passagesQuoted(paper, '다음 문장을 설명해 줘: "the residual spectrum is projected onto the loading matrix and the squared prediction error"').map(b => b.id), ['p4-b1'], 'whitespace and case do not matter');
  assert.deepEqual(passagesQuoted(paper, 'What is the squared prediction error?'), [], 'shared words are not a pasted passage');
  // A named page: all of that page goes, with no search-word round first.
  let auth = model({ answer: [{ text: '2쪽은 배치 20을 다룹니다.', basis: 'paper', evidence: ['p2-b0', 'p9-b9'] }], insufficient: false });
  let r = await ask(auth, 'm', { title: 'T', question: '2쪽 내용을 설명해 줘', blocks: paper });
  assert.equal(auth.calls.length, 1); assert.deepEqual(auth.calls[0].input.pagesAsked, [2]);
  assert.deepEqual(auth.calls[0].input.evidence.filter(e => e.page === 2).map(e => e.id), ['p2-b0', 'p2-b1', 'p2-b2']);
  assert.deepEqual(r.coverage.focusPages, [2]); assert.deepEqual(r.sections.answer[0].evidence.map(e => [e.blockId, e.page]), [['p2-b0', 2]]); assert.deepEqual(r.rejected, ['p9-b9'], 'evidence is still checked');
  // A pasted passage: its page and the pages before and after it.
  auth = model({ answer: [{ text: '잔차를 적재 행렬에 투영해 SPE를 계산한다는 뜻입니다.', basis: 'paper', evidence: ['p4-b1'] }], insufficient: false });
  r = await ask(auth, 'm', { title: 'T', question: '이 문장이 무슨 뜻인가요? The residual spectrum is projected onto the loading matrix and the squared prediction error is computed for every batch.', blocks: paper });
  assert.deepEqual(auth.calls[0].input.quotedBlocks, ['p4-b1']); assert.deepEqual([...new Set(auth.calls[0].input.evidence.map(e => e.page))].filter(p => [3, 4, 5].includes(p)), [3, 4, 5]);
  assert.equal(auth.calls[0].input.evidence.filter(e => [3, 4, 5].includes(e.page)).length, 9, 'the three pages whole'); assert.deepEqual(r.coverage.focusPages, [3, 4, 5]); assert.equal(r.coverage.quoted, 1);
  assert.match(auth.calls[0].instructions, /quotedBlocks/);
  // A long pasted passage is not cut at the old 1,000 characters.
  const long = 'x '.repeat(900) + paper[10].text;
  auth = model({ answer: [], insufficient: true }); r = await ask(auth, 'm', { title: 'T', question: long, blocks: paper }); assert.deepEqual(auth.calls[0].input.quotedBlocks, ['p4-b1']);
});
