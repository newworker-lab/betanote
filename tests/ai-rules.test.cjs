'use strict';
// The vault's AI requests (library.json aiRules, 저장소 관리 › AI): kept per vault like the translation requests, and sent
// after the app's own instructions with every AI request that answers in words (summary, 선택 설명, questions, comparisons,
// memo and annotation AI, 그림 설명 on every kind of connection); not with tag suggestions or translation. With none set, the
// requests are sent exactly as before.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const insight = require('../desktop/insight.cjs');
const { Library } = require('../desktop/storage.cjs');
const { OpenAIAPI, ClaudeAPI, GeminiAPI, CompatibleAPI } = require('../desktop/api-llm.cjs');
const { LocalLLM } = require('../desktop/local-llm.cjs');
const { ChatGPT } = require('../desktop/chatgpt.cjs');

const RULES = '수식은 LaTeX($…$)로 써 주세요.\n답은 짧게.';
const blocks = [{ id: 'p1-b1', page: 1, text: 'We study how layout affects reading speed.' }, { id: 'p2-b1', page: 2, text: 'Reading speed rose by 12%.' }];
const claim = { text: '읽기 속도', basis: 'paper', evidence: ['p1-b1'] };
// A model that answers every request and keeps the instructions it was given.
const model = () => {
  const sent = [];
  return { sent, respond: async (m, input, instructions) => { sent.push(instructions); const asked = JSON.parse(input[0].content);
    if (asked.paperSample) return JSON.stringify({ keywords: ['layout'] });
    if (asked.papers) return JSON.stringify({ rows: [{ aspect: '방법', cells: asked.papers.map(p => ({ paper: p.paper, text: '같음', basis: 'model', evidence: [] })) }] });
    return JSON.stringify({ question: [claim], explanation: [claim], answer: [claim], translation: '번역', tags: [{ name: 'layout' }], text: '고친 메모' }); } };
};
const requests = {
  summary: c => insight.summarize(c, 'm', { title: 'T', blocks }),
  explain: c => insight.explain(c, 'm', { title: 'T', selection: 'layout affects reading', page: 1, blocks }),
  ask: c => insight.ask(c, 'm', { title: 'T', question: 'layout reading speed', blocks }),
  compare: c => insight.compare(c, 'm', { papers: [{ title: 'A', blocks }, { title: 'B', blocks }], question: 'layout' }),
  memo: c => insight.memoAssist(c, 'm', { mode: 'ask', title: 'T', memo: '메모', instruction: '정리해 줘' }),
  memoEdit: c => insight.memoAssist(c, 'm', { mode: 'edit', title: 'T', memo: '메모', instruction: '다듬어 줘' }),
};

test('the vault\'s AI requests are kept per vault, trimmed, limited to 2,000 letters and removable', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-rules-')); t.after(() => fs.rm(dir, { recursive: true, force: true }));
  let library = await Library.open(dir);
  await library.setAiRules('  수식은 LaTeX로\r\n답은 짧게  '); library = await Library.open(dir);
  assert.equal((await library.snapshot()).aiRules, '수식은 LaTeX로\n답은 짧게');
  assert.equal((await library.snapshot()).translationRules, '', 'apart from the translation requests');
  await assert.rejects(library.setAiRules('x'.repeat(2001))); await assert.rejects(library.setAiRules(null));
  await library.setAiRules('  '); assert.equal((await library.snapshot()).aiRules, ''); assert.equal('aiRules' in library.data, false);
});

test('every AI request that answers in words gets the requests after the app\'s instructions; without them, nothing changes', async () => {
  for (const [name, run] of Object.entries(requests)) {
    const plain = model(); await run(plain);
    const asked = model(); await run(insight.withAiRules(asked, RULES));
    assert.equal(asked.sent.length, plain.sent.length, name);
    asked.sent.forEach((instructions, i) => {
      assert.ok(instructions.startsWith(plain.sent[i]), `${name}: the app's instructions first, unchanged`);
      const added = instructions.slice(plain.sent[i].length);
      assert.match(added, /come first when they disagree/, `${name}: the app's instructions win`);
      assert.ok(added.includes(RULES), `${name}: the requests as written`);
    });
    const none = model(); await run(insight.withAiRules(none, '   ')); assert.deepEqual(none.sent, plain.sent, `${name}: no requests, the same request as before`);
  }
});

test('그림 설명 on every kind of connection gets the requests; the client itself is unchanged', async () => {
  const kinds = { OpenAIAPI, ClaudeAPI, GeminiAPI, CompatibleAPI, LocalLLM, ChatGPT };
  for (const [name, Kind] of Object.entries(kinds)) {
    const client = Object.create(Kind.prototype), sent = [];
    client.settings = { kind: 'openai' };
    client.respond = async (m, input, instructions) => { sent.push(instructions); return 'r'; };
    client.generate = async (m, contents, instructions) => { sent.push(instructions); return 'g'; };
    await insight.withAiRules(client, RULES).explainFigure('m', 'data:image/png;base64,AAAA', { page: 1, caption: '', question: '' }, undefined, 'ko');
    assert.equal(sent.length, 1, `${name}: one request`); assert.ok(sent[0].endsWith(`${RULES}\n</reader requests>`), `${name}: the requests at the end`);
    await client.explainFigure('m', 'data:image/png;base64,AAAA', { page: 1, caption: '', question: '' }, undefined, 'ko');
    assert.ok(!sent[1].includes(RULES), `${name}: the client itself sends no requests`);
  }
});

test('tag suggestions are not sent the requests (their answer is a list)', async () => {
  const asked = model(); await insight.suggestTags(asked, 'm', { title: 'T', blocks });
  assert.ok(!asked.sent[0].includes('reader requests'));
});
