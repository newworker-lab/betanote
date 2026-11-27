// End-to-end check of K-07 in the real Electron app with a simulated model:
// confirm-before-send, checked evidence, jumping to the cited paragraph,
// adopting into notes without replacing them, and results kept across restart.
// Model quality (whether a claim is really supported) needs a real model and
// human review; this test only covers the app's side of the contract.
const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { PDFDocument, StandardFonts } = require('pdf-lib');
const appName = require('../core/app-name.cjs');
const root = path.resolve(__dirname, '..');
(async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), `${appName.id}-ai-e2e-`)), vault = path.join(temp, 'vault'); await fs.mkdir(vault);
  const doc = await PDFDocument.create(), font = await doc.embedFont(StandardFonts.Helvetica);
  for (const text of ['We study how layout affects reading speed.', 'Participants read two-column papers on tablets.', 'Reading speed rose by twelve percent with preserved layout.']) doc.addPage([600, 800]).drawText(text, { x: 40, y: 700, size: 12, font });
  await fs.writeFile(path.join(temp, 'study.pdf'), await doc.save());
  const doc2 = await PDFDocument.create(), font2 = await doc2.embedFont(StandardFonts.Helvetica); doc2.addPage([600, 800]).drawText('A second study found no difference in speed.', { x: 40, y: 700, size: 12, font: font2 });
  await fs.writeFile(path.join(temp, 'second.pdf'), await doc2.save());
  const executable = require('./app-executable.cjs')(root);
// Memos are folded until chosen: the first one is opened when a step needs the memo field.
const openNote = async p => { await p.locator('#note, .memo-card[data-memo], .memo-tab [data-action="memo-new"]').first().waitFor(); if (!await p.locator('#note').count()) await (await p.locator('.memo-card[data-memo]').count() ? p.locator('.memo-card[data-memo]').first() : p.locator('.memo-tab [data-action="memo-new"]')).click(); await p.locator('#note').waitFor({ state: 'attached' }); return p.locator('#note'); };
  const env = /utf-?8/i.test(process.env.LC_ALL || process.env.LANG || '') ? process.env : { ...process.env, LC_ALL: 'C.UTF-8', LANG: 'C.UTF-8' };
  let app;
  async function launch() {
    app = await electron.launch({ env, executablePath: executable, args: [...(process.env.APP_TEST_SOURCE === '1' ? [root] : []), '--no-sandbox', '--ozone-platform=headless', '--disable-gpu', `--user-data-dir=${path.join(temp, 'profile')}`], timeout: 20000 });
    const p = await app.firstWindow(); p.setDefaultTimeout(15000);
    p.on('pageerror', e => { console.error(e); process.exitCode = 1; }); p.on('console', m => { if (m.type() === 'error') console.error('renderer:', m.text()); });
    await app.evaluate(({ app, dialog }) => {
      globalThis.openQueue = []; dialog.showOpenDialog = async () => ({ canceled: false, filePaths: globalThis.openQueue.shift() });
      const { ChatGPT } = process.getBuiltinModule('module').createRequire(app.getAppPath() + '/package.json')('./desktop/chatgpt.cjs');
      globalThis.requests = [];
      ChatGPT.prototype.status = () => ({ connected: true, usable: true, email: 'fixture@example.test', persistent: false });
      ChatGPT.prototype.models = async () => [{ id: 'fixture-model', name: 'Fixture GPT' }];
      // Cites the first block it was sent, plus one id that does not exist.
      ChatGPT.prototype.respond = async (_model, input, instructions) => {
        const body = JSON.parse(input[0].content);
        // A question asked about a result (the AI panel's 질문하기): a plain Markdown answer.
        if (/Answer the researcher/.test(instructions)) { globalThis.requests.push(body); return '이어서 답합니다: 12%는 평균입니다.'; } if (body.paperSample) { globalThis.requests.push(body); return JSON.stringify({ keywords: [] }); } const blocks = body.blocks || body.context || body.evidence || body.papers[0].blocks; globalThis.requests.push(body);
        const first = blocks[0].id, last = blocks.at(-1).id;
        if (/Compare the research papers/.test(instructions)) { const [a, b] = body.papers; return JSON.stringify({ rows: [{ aspect: '결과', cells: [{ paper: 'P1', text: '속도 증가', basis: 'paper', evidence: [a.blocks.at(-1).id] }, { paper: 'P2', text: '차이 없음', basis: 'paper', evidence: [b.blocks[0].id, a.blocks[0].id] }] }] }); }
        if (/Summarize/.test(instructions)) return JSON.stringify({ question: [{ text: '레이아웃이 읽기 속도에 미치는 영향', basis: 'paper', evidence: [first] }], result: [{ text: '읽기 속도 12% 증가', basis: 'paper', evidence: [last, 'p99-b9'] }, { text: '근거 없는 주장', basis: 'paper', evidence: [] }] });
        if (/selected passage/.test(instructions)) return JSON.stringify({ translation: '참가자는 태블릿에서 읽었다.', explanation: [{ text: '태블릿 환경입니다.', basis: 'paper', evidence: [first] }] });
        return JSON.stringify({ answer: [{ text: '12% 빨라졌습니다.', basis: 'paper', evidence: [last] }], insufficient: false });
      };
    });
    return p;
  }
  try {
    let p = await launch();
    await app.evaluate((_, v) => globalThis.openQueue.push([v]), vault); await p.locator('[data-action="storage"]').first().click();
    await app.evaluate((_, f) => globalThis.openQueue.push([f]), path.join(temp, 'study.pdf')); await p.locator('[data-action="add-files"]').first().click();
    await p.locator('.paper-item').click(); await p.locator('.original-pages .page[data-page="1"] .textLayer span').first().waitFor();
    await (await openNote(p)).fill('내가 쓴 메모'); await p.locator('#saved').filter({ hasText: '저장소에 저장됨' }).waitFor();
    await p.locator('[data-tab="요약"]').click(); await p.locator('.insight-panel').waitFor();

    // Summary: confirm shows the scope; nothing is sent before "보내기".
    await p.locator('[data-action="ai-summary"]').click(); await p.locator('#dialog').filter({ hasText: '본문 3쪽' }).waitFor();
    assert.equal(await app.evaluate(() => globalThis.requests.length), 0);
    await p.locator('#dialog [data-action="ai-send"]').click(); await p.locator('.insight-card').waitFor();
    const card = await p.locator('.insight-card').first().textContent();
    assert.match(card, /전체 3쪽/); assert.match(card, /근거 부족/); assert.match(card, /존재하지 않는 근거 1개는 제외/);
    assert.deepEqual(await p.locator('.insight-card .evidence').allTextContents(), ['p.1', 'p.3']);
    await p.locator('.insight-card .evidence').last().click(); await p.locator('.original-pages .page[data-page="3"] .ai-evidence').waitFor();
    // An AI summary goes into the tab's four summary parts as it comes when they are empty (they are here), and they
    // show it at once. Parts with writing are left alone (tests/language-smoke.cjs).
    await p.locator('#toast').filter({ hasText: '요약 칸' }).waitFor();
    assert.match(await p.locator('.summary-card[data-summary="0"] .memo-line').innerText(), /레이아웃이 읽기 속도에 미치는 영향/, 'the parts are filled and drawn again at once');
    assert.equal((await p.evaluate(() => notes[`${state.selected}-summary-0`])).match(/\[AI 요약/g).length, 1, 'once');
    assert.deepEqual(await p.locator('.insight-card.open footer button').allTextContents(), ['요약 칸에 넣기', '메모로 저장'], 'a summary can still be put in again, or saved as a memo');
    // 메모로 저장 always makes a memo of its own (the whole result, its parts named), and says where it went.
    const memosBefore = await p.evaluate(() => memoKeysOf(state.selected).length);
    await p.locator('.insight-card.open [data-ai-adopt]').click(); await p.locator('#toast').filter({ hasText: '새 메모로 저장했습니다' }).waitFor();
    assert.equal(await p.evaluate(() => memoKeysOf(state.selected).length), memosBefore + 1, 'one new memo');
    const saved = await p.evaluate(() => { const keys = memoKeysOf(state.selected); return { title: notes[keys.at(-1) + '#title'], text: notes[keys.at(-1)] }; });
    assert.equal(saved.title, 'AI 요약'); assert.match(saved.text, /\*\*연구 질문\*\*\n• 레이아웃이 읽기 속도에 미치는 영향 \[p\.1\]/); assert.match(saved.text, /\*\*결과\*\*/);
    await p.locator('#toast [data-open-memo]').click(); await p.locator('.reader-panel [data-tab="메모"].active').waitFor();
    await p.locator('[data-tab="요약"]').click();
    // The summary shows its four parts as cards; a card shows its first line (not the AI tag) and opens on a click.
    assert.equal(await p.locator('.summary-card').count(), 4); assert.equal(await p.locator('.summary-tab textarea').count(), 0, 'all folded');
    assert.match(await p.locator('.summary-card[data-summary="0"] .memo-line').innerText(), /레이아웃이 읽기 속도에 미치는 영향/);
    await p.locator('.summary-card[data-summary="0"]').click(); await p.locator('.summary-card.open[data-summary="0"] .field-live').waitFor();
    assert.match(await p.locator('#summary-0').inputValue(), /레이아웃이 읽기 속도에 미치는 영향 \[p\.1\]/);
    await p.locator('.summary-card[data-summary="2"]').click(); await p.locator('.summary-card.open[data-summary="2"]').waitFor(); assert.equal(await p.locator('.summary-card.open').count(), 1, 'one open at a time');
    assert.match(await p.locator('#summary-2').inputValue(), /\(근거 부족\)/);
    await p.keyboard.press('Escape'); await p.locator('.summary-card.open').waitFor({ state: 'detached' });
    await p.locator('[data-tab="메모"]').click(); assert.equal(await p.evaluate(() => notes[`${state.selected}-메모`]), '내가 쓴 메모', 'adoption never touches other notes');

    // A passage is asked about from its annotation: select, 주석 추가 (N), then AI에게 묻기 in the form.
    // There is no 선택 설명 button in the 요약 tab and no AI 설명 in the selection's bar any more.
    await p.locator('[data-tab="요약"]').click(); assert.equal(await p.locator('[data-action="ai-explain"]').count(), 0); assert.equal(await p.evaluate(() => INK_TEXT_ITEMS.some(item => item[0] === 'explain') || 'KeyE' in INK_TEXT_KEYS), false);
    await p.evaluate(() => { const span = document.querySelector('.original-pages .page[data-page="2"] .textLayer span'), range = document.createRange(); range.selectNodeContents(span); getSelection().removeAllRanges(); getSelection().addRange(range); });
    await p.evaluate(() => document.activeElement?.blur()); await p.keyboard.press('e'); await p.waitForTimeout(300); assert.equal(await p.evaluate(() => document.querySelector('#dialog').open), false, 'E does nothing now');
    await p.keyboard.press('n'); await p.locator('#annotation-quote').waitFor(); assert.match(await p.locator('#annotation-quote').inputValue(), /Participants read two-column/);
    await p.locator('#dialog [data-action="save-annotation-ask"]').click();
    // The annotation is saved with its passage (no text of its own yet) and opens in the wide editor with the AI panel.
    await p.locator('.annotation-editor-dialog .note-ai:not([hidden]) #editor-ai-instruction').waitFor();
    // The form's own close event may arrive after the editor opened (it is queued; how late depends on the machine): such
    // a late close of an earlier opening leaves the editor and its AI panel as they are.
    await p.evaluate(() => document.querySelector('#dialog').dispatchEvent(new Event('close'))); await p.waitForTimeout(150);
    assert.equal(await p.evaluate(() => document.querySelector('#dialog').open && document.querySelector('#dialog').classList.contains('annotation-editor-dialog')), true, 'a late close leaves the editor open');
    await p.locator('.annotation-editor-dialog .note-ai:not([hidden]) #editor-ai-instruction').waitFor({ timeout: 2000 });
    assert.equal(await p.locator('.annotation-editor-dialog #editor-ai-selection').isChecked(), true, 'the quoted passage goes with the question');
    await p.locator('#editor-ai-instruction').fill('이 문장을 설명해 줘'); await p.locator('[data-editor-ai-send]').click(); await p.locator('[data-editor-ai-take="append"]').click();
    const passageRequest = await app.evaluate(() => globalThis.requests.at(-1));
    assert.match(passageRequest.selection, /Participants read two-column/); assert.equal(passageRequest.page, 2); assert.equal(passageRequest.question, '이 문장을 설명해 줘');
    await p.waitForFunction(() => itemAnnotations.some(a => a.page === 2 && /Participants read/.test(a.quote) && /이어서 답합니다/.test(a.body)));
    await p.locator('.annotation-editor-dialog [data-md-view="live"]').click(); await p.locator('#dialog [data-action="close"]').first().click();
    await p.locator('.memo-card.annot').filter({ has: p.locator('[data-annotation-page="2"]') }).waitFor();
    await p.locator('[data-tab="요약"]').click();
    // A question with no matching passage asks only for search words, then is answered as unsupported without an answer call.
    const before = await app.evaluate(() => globalThis.requests.length);
    await p.locator('#insight-question').fill('quantum chromodynamics'); await p.locator('[data-insight-ask] button').click(); await p.locator('#dialog [data-action="ai-send"]').click();
    await p.locator('.insight-card').filter({ hasText: '답할 근거가 부족' }).waitFor();
    assert.equal(await app.evaluate(() => globalThis.requests.length), before + 1);
    await p.locator('#insight-question').fill('reading speed'); await p.locator('[data-insight-ask] button').click(); await p.locator('#dialog [data-action="ai-send"]').click();
    await p.locator('.insight-card').filter({ hasText: '12% 빨라졌습니다' }).waitFor();
    assert.ok((await app.evaluate(() => globalThis.requests.at(-1))).evidence.every(b => /reading speed/i.test(b.text)));
    // The AI tab: question box first, then AI 요약 · ⓘ (the note about results shows on hover and stays on click).
    assert.deepEqual(await p.locator('.insight-panel > form, .insight-panel > .insight-actions').evaluateAll(n => n.map(x => x.classList[0])), ['insight-ask', 'insight-actions']);
    assert.deepEqual(await p.locator('.insight-actions > *').evaluateAll(n => n.map(x => x.dataset.action || x.className)), ['ai-summary', 'insight-info']);
    assert.equal(await p.locator('.insight-panel > p.small.muted').count(), 0, 'the note is behind ⓘ, not a paragraph');
    const tip = p.locator('.insight-info-tip'); assert.equal(await tip.isVisible(), false);
    await p.locator('[data-insight-info]').hover(); await tip.waitFor(); assert.match(await tip.textContent(), /메모로 저장/); assert.match(await tip.textContent(), /논문 전체는 보내지 않습니다/);
    await p.locator('[data-insight-info]').click(); await p.locator('#insight-question').hover(); assert.equal(await tip.isVisible(), true, 'a click keeps the note open');
    await p.locator('.insight-ask').click({ position: { x: 2, y: 2 } }); await p.mouse.move(0, 0); await tip.waitFor({ state: 'hidden' });
    // Results are cards like memos: the new one open, the others its title and one line.
    assert.equal(await p.locator('.insight-card.open').count(), 1); assert.match(await p.locator('.insight-card.open').textContent(), /12% 빨라졌습니다/);
    const folded = p.locator('.insight-card:not(.open)');
    assert.equal(await folded.count(), 2); for (const h of await folded.evaluateAll(n => n.map(x => x.offsetHeight))) assert.ok(h < 64, `folded AI card is short (${h})`);
    assert.equal(await folded.first().locator('strong').textContent(), '질문'); assert.equal(await folded.first().locator('.memo-line').textContent(), 'Q. quantum chromodynamics');
    assert.equal(await folded.first().locator('[data-ai-adopt]').count(), 0);
    // Choosing one opens it (and folds the other); its corner changes the height; ▴ and Esc fold it.
    await folded.first().click(); await p.locator('.insight-card.open').filter({ hasText: '답할 근거가 부족' }).waitFor(); assert.equal(await p.locator('.insight-card.open').count(), 1);
    const body = p.locator('.insight-card.open .insight-body'), h0 = await body.evaluate(n => n.offsetHeight), grip = await p.locator('.insight-card.open [data-insight-grip]').boundingBox();
    await p.mouse.move(grip.x + 9, grip.y + 9); await p.mouse.down(); await p.mouse.move(grip.x + 9, grip.y + 129, { steps: 5 }); await p.mouse.up();
    assert.ok(await body.evaluate(n => n.offsetHeight) >= h0 + 100, 'the corner makes the open result taller');
    await p.locator('[data-insight-fold]').click(); assert.equal(await p.locator('.insight-card.open').count(), 0);
    await p.locator('.insight-card').first().click(); await p.locator('.insight-card.open').waitFor(); await p.locator('.insight-card.open').focus(); await p.keyboard.press('Escape'); assert.equal(await p.locator('.insight-card.open').count(), 0);
    // ⤢ reads a result large in a window of its own.
    await p.locator('.insight-card').filter({ hasText: 'AI 요약' }).locator('[data-insight-wide]').click();
    await p.locator('#dialog.insight-wide-dialog .insight-wide').filter({ hasText: '전체 3쪽' }).waitFor(); assert.ok((await p.locator('#dialog').boundingBox()).width > 600);
    await p.locator('#dialog [data-action="close"]').first().click(); await p.waitForFunction(() => !document.querySelector('#dialog').open && !document.querySelector('#dialog').classList.contains('insight-wide-dialog'));

    // Every card's tools in the memo cards' order: AI · 넓게 보기 · 새 창 · 휴지통 (the open one also folds).
    const asked = p.locator('.insight-card').filter({ hasText: 'Q. reading speed' }); await asked.click(); await p.locator('.insight-card.open').filter({ hasText: '12% 빨라졌습니다' }).waitFor();
    assert.deepEqual(await p.locator('.insight-card.open .memo-actions button').evaluateAll(n => n.map(b => Object.keys(b.dataset)[0])), ['insightFold', 'insightAi', 'insightWide', 'insightWindow', 'aiRemove']);
    assert.deepEqual(await p.locator('.insight-card:not(.open)').first().locator('.memo-actions button').evaluateAll(n => n.map(b => Object.keys(b.dataset)[0])), ['insightAi', 'insightWide', 'aiRemove']);
    // AI on a result: 질문하기 only (nothing to rewrite), with the result as context; the answer is kept under it.
    await p.locator('.insight-card.open [data-insight-ai]').click(); await p.locator('#dialog.insight-wide-dialog .note-ai #editor-ai-instruction').waitFor();
    assert.equal(await p.locator('#dialog [data-memo-ai-mode="edit"]').count(), 0, 'a result is asked about, not rewritten');
    assert.match(await p.locator('#dialog .memo-ai-hint').textContent(), /이 결과 끝에 추가/);
    // The question box: Shift+Enter breaks the line, an Enter that ends a syllable's composition sends nothing, Enter sends.
    const box = p.locator('#editor-ai-instruction'); await box.fill('평균인가요?'); await box.press('Shift+Enter');
    assert.equal(await box.inputValue(), '평균인가요?\n', 'Shift+Enter breaks the line'); await box.press('Backspace');
    await box.evaluate(node => node.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true, cancelable: true })));
    assert.equal(await box.inputValue(), '평균인가요?', 'an Enter of the input method sends nothing'); assert.equal(await box.isEditable(), true);
    await box.press('Enter');
    await p.locator('#dialog [data-editor-ai-take="append"]').filter({ hasText: '결과에 추가' }).click(); await p.locator('#toast').filter({ hasText: '결과 아래에 추가' }).waitFor();
    const follow = await app.evaluate(() => globalThis.requests.at(-1)); assert.equal(follow.question, '평균인가요?'); assert.match(follow.earlierResult, /Q\. reading speed[\s\S]*12% 빨라졌습니다/); assert.equal(follow.note, undefined);
    await p.locator('#dialog .insight-follow').filter({ hasText: '12%는 평균입니다' }).waitFor(); assert.match(await p.locator('#dialog .insight-follow').textContent(), /Q\. 평균인가요\?/);
    // The same result in a window of its own, with its follow-up; asking there is the same panel.
    const [resultWindow] = await Promise.all([app.waitForEvent('window'), p.locator('#dialog [data-insight-window]').click()]);
    await resultWindow.locator('.insight-window .insight-follow').filter({ hasText: '12%는 평균입니다' }).waitFor(); assert.equal(await p.evaluate(() => dialog.open), false, 'the dialog gives way to the window');
    await resultWindow.locator('[data-editor-ai]').click(); await resultWindow.locator('#editor-ai-instruction').fill('표본은?'); await resultWindow.locator('[data-editor-ai-send]').click();
    await resultWindow.locator('[data-editor-ai-take="append"]').click(); await resultWindow.locator('.insight-follow').nth(1).waitFor();
    assert.equal(await p.evaluate(() => insightState.results.get(targetKey()).find(r => r.question === 'reading speed').followUps.length), 2);
    await resultWindow.close();

    // A question that names a page takes that page's text along; one that pastes a passage takes its page and the pages beside it.
    await p.locator('[data-tab="요약"]').click(); const cardsBefore = await p.locator('.insight-card').count();
    await p.locator('#insight-question').fill('3쪽 내용을 설명해 줘'); await p.locator('[data-insight-ask] button').click();
    await p.locator('#dialog [data-action="ai-send"]').waitFor(); assert.match(await p.locator('#dialog').textContent(), /쪽 번호가 있으면 그 쪽의 본문/); await p.locator('#dialog [data-action="ai-send"]').click();
    await p.waitForFunction(n => document.querySelectorAll('.insight-card').length === n + 1, cardsBefore);
    let pageAsk = await app.evaluate(() => globalThis.requests.at(-1)); assert.deepEqual(pageAsk.pagesAsked, [3]); assert.ok(pageAsk.evidence.some(e => e.page === 3));
    assert.match(await p.locator('.insight-card.open').textContent(), /3쪽 본문 포함/);
    await p.locator('#insight-question').fill('이 문장을 설명해 줘: Participants read two-column papers on tablets.'); await p.locator('[data-insight-ask] button').click(); await p.locator('#dialog [data-action="ai-send"]').click();
    await p.waitForFunction(n => document.querySelectorAll('.insight-card').length === n + 2, cardsBefore);
    pageAsk = await app.evaluate(() => globalThis.requests.at(-1)); assert.equal(pageAsk.quotedBlocks.length, 1); assert.deepEqual([...new Set(pageAsk.evidence.map(e => e.page))].sort(), [1, 2, 3], 'the passage\'s page with the one cardsBefore and after');
    assert.match(await p.locator('.insight-card.open').textContent(), /붙여 넣은 문장이 있는 1·2·3쪽 본문 포함/);
    // An answer's page number still opens the cited place.
    assert.ok(await p.locator('.insight-card.open .evidence').count() >= 1);

    // Results and adoption history survive a restart.
    await app.close(); p = await launch();
    await (await openNote(p)).waitFor(); await p.locator('[data-tab="요약"]').click();
    await p.locator('.insight-card').nth(4).waitFor(); assert.equal(await p.locator('.insight-card').count(), 5); assert.equal(await p.evaluate(() => itemAnnotations.filter(a => /Participants read/.test(a.quote) && /이어서 답합니다/.test(a.body)).length), 1, 'the annotation and its AI answer are kept'); assert.equal(await p.locator('.insight-card.open').count(), 0, 'after a restart every result is folded');
    await p.locator('.insight-card').last().click(); assert.match(await p.locator('.insight-card.open [data-ai-adopt]').textContent(), /메모로 저장 \(1\)/);
    // Two papers side by side from the library selection.
    await p.locator('[data-action="back"]').click(); await app.evaluate((_, f) => globalThis.openQueue.push([f]), path.join(temp, 'second.pdf')); await p.locator('[data-action="add-files"]').first().click();
    await p.locator('[data-batch-paper]').nth(0).check(); await p.locator('[data-batch-paper]').nth(1).check();
    await p.locator('[data-action="ai-compare"]').click(); await p.locator('#compare-question').fill('결과'); await p.locator('[data-action="ai-compare-send"]').click();
    await p.locator('.compare-table').waitFor();
    assert.deepEqual(await p.locator('.compare-table td .evidence').allTextContents(), ['p.3', 'p.1']);
    assert.match(await p.locator('#dialog').textContent(), /다른 자료나 없는 문단을 가리킨 근거 1개는 제외/);
    await p.locator('[data-action="compare-adopt"]').click(); await p.locator('#toast').filter({ hasText: '각 자료의 메모' }).waitFor();
    await p.locator('.paper-item').filter({ hasText: 'second' }).click(); await (await openNote(p)).waitFor();
    assert.match(await (await openNote(p)).inputValue(), /결과: 차이 없음 \[p\.1\]/);
    await app.close(); app = null;
    console.log('AI smoke passed: confirm before send, checked evidence and jump, unsupported marking, partial-scope labels, adoption without replacing notes, results kept across restart.');
  } catch (error) { try { await (await app.firstWindow()).screenshot({ path: path.join(os.tmpdir(), `${appName.id}-ai-failure.png`) }); } catch {} throw error; }
  finally { if (app) await app.close(); await fs.rm(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }).catch(error => console.warn(`임시 폴더를 다 지우지 못했습니다(${error.code}). 테스트 결과와는 무관합니다: ${temp}`)); }
})().catch(error => { console.error(error); process.exit(1); });
