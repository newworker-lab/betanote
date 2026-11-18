// End-to-end check of the memo tools in the real Electron app: the navigation peeking at its docked
// size, the reading place kept across view switches and saved annotations, memo pins on the
// original, rewriting a memo with AI (a stub model), memo/original/translation windows, a notebook
// page at the original's size, memo embeds and @mentions.
const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { PDFDocument, StandardFonts } = require('pdf-lib');
const appName = require('../core/app-name.cjs');
const toolShown = require('./tool-row.cjs'); // a tool a narrow pane keeps under ⋯ is brought out before it is used
const root = path.resolve(__dirname, '..');
(async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), `${appName.id}-memo-e2e-`)), vault = path.join(temp, 'vault'); await fs.mkdir(vault);
  const doc = await PDFDocument.create(), font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= 4; i++) doc.addPage([600, 800]).drawText(`A research paper connects ideas, page ${i}.`, { x: 40, y: 700, size: 14, font });
  await fs.writeFile(path.join(temp, 'paper [v2].pdf'), await doc.save());
  const executable = require('./app-executable.cjs')(root);
  const env = /utf-?8/i.test(process.env.LC_ALL || process.env.LANG || '') ? process.env : { ...process.env, LC_ALL: 'C.UTF-8', LANG: 'C.UTF-8' };
  const app = await electron.launch({ env, executablePath: executable, args: [...(process.env.APP_TEST_SOURCE === '1' ? [root] : []), '--no-sandbox', '--ozone-platform=headless', '--disable-gpu', `--user-data-dir=${path.join(temp, 'profile')}`], timeout: 20000 });
  const done = [];
  try {
    const p = await app.firstWindow(); p.setDefaultTimeout(15000); await p.setViewportSize({ width: 1400, height: 900 });
    p.on('pageerror', e => { console.error(e); process.exitCode = 1; }); p.on('console', m => { if (m.type() === 'error') { console.error('renderer:', m.text()); process.exitCode = 1; } });
    await app.evaluate(({ app, dialog }) => {
      globalThis.openQueue = []; dialog.showOpenDialog = async () => ({ canceled: false, filePaths: globalThis.openQueue.shift() });
      const { ChatGPT } = process.getBuiltinModule('module').createRequire(app.getAppPath() + '/package.json')('./desktop/chatgpt.cjs');
      ChatGPT.prototype.status = () => ({ connected: true, usable: true, email: 'fixture@example.test', persistent: false });
      ChatGPT.prototype.models = async () => [{ id: 'fixture-model', name: 'Fixture GPT' }];
      ChatGPT.prototype.explainFigure = async () => '가로축은 시간입니다.';
      globalThis.translateContexts = [];
      ChatGPT.prototype.translate = async (_model, blocks, _signal, context) => { globalThis.translateContexts.push(context); return blocks.map(b => ({ id: b.id, text: '연구 논문은 아이디어를 연결합니다.' })); };
      // The memo rewrite: a fenced reply; "wait" holds until the request is cancelled.
      globalThis.memoRequests = [];
      ChatGPT.prototype.respond = async (_m, input, _instructions, signal) => {
        const content = input[0].content, text = Array.isArray(content) ? content.find(c => c.type === 'input_text').text : content, body = JSON.parse(text); if (Array.isArray(content)) body.sentImages = content.filter(c => c.type === 'input_image').length; globalThis.memoRequests.push(body);
        if (body.instruction === 'wait' || body.question === 'wait') await new Promise((_, reject) => signal.addEventListener('abort', () => { globalThis.memoAborted = true; reject(Error('aborted')); }, { once: true }));
        return '```markdown\n다듬은 메모\n\n- 하나\n```';
      };
    });
    await app.evaluate((_, v) => globalThis.openQueue.push([v]), vault); await p.locator('[data-action="storage"]').first().click(); await p.locator('.library').waitFor();
    await app.evaluate((_, f) => globalThis.openQueue.push([f]), path.join(temp, 'paper [v2].pdf')); await p.locator('[data-action="add-files"]').first().click();
    await p.locator('.paper-item').click(); await p.locator('.original-pages .page[data-page="1"] canvas').first().waitFor();

    // 1. The collapsed sidebar peeks at its docked size (full height, same width).
    const docked = await p.locator('.shell > .sidebar').boundingBox();
    await p.locator('[data-action="close-left"]').first().click(); await p.waitForFunction(() => document.querySelector('.shell').classList.contains('left-collapsed'));
    await p.locator('[data-sidebar-edge="left"]').hover(); await p.waitForFunction(() => document.querySelector('.shell').classList.contains('left-peek'));
    const peek = await p.locator('.shell > .sidebar').boundingBox();
    assert.equal(Math.round(peek.width), Math.round(docked.width), 'peek width'); assert.equal(Math.round(peek.y), Math.round(docked.y), 'peek top'); assert.equal(Math.round(peek.height), Math.round(docked.height), 'peek height');
    const opener = await p.locator('[data-sidebar-open="left"]').boundingBox();
    assert.equal(await p.evaluate(({ x, y }) => !!document.elementFromPoint(x, y)?.closest('[data-sidebar-open="left"]'), { x: opener.x + opener.width / 2, y: opener.y + opener.height / 2 }), true, 'opener stays clickable over the peek');
    await p.locator('[data-sidebar-open="left"]').click();
    await p.waitForFunction(() => !document.querySelector('.shell').classList.contains('left-collapsed'));
    done.push('navigation peeks at its docked size');

    // 2. Switching view modes keeps the reading position.
    await p.waitForFunction(() => document.querySelector('.original-pages [data-page="3"]')?.getBoundingClientRect().height > 0); await p.waitForTimeout(1500);
    await p.evaluate(() => { const c = document.querySelector('.original-pages'), s = c.querySelector('[data-page="3"]'); c.scrollTop = pageTop(c, s) + s.getBoundingClientRect().height * .4; });
    await p.waitForFunction(() => readingPosition()?.page === '3');
    await p.waitForTimeout(300); const before = await p.evaluate(() => readingPosition()); assert.equal(before.page, '3', 'scrolled to p.3');
    for (let i = 0; i < 3; i++) { await p.locator('[data-mode="notebook"]').click(); await p.waitForTimeout(400); await p.locator('[data-mode="original"]').click(); await p.waitForTimeout(800); const again = await p.evaluate(() => readingPosition()); assert.equal(again.page, before.page, 'round trip ' + i); assert.ok(Math.abs(again.ratio - before.ratio) < .03, 'round trip ' + i + ': ' + again.ratio); }
    await p.locator('[data-mode="notebook"]').click(); await p.locator('.notebook-pane').waitFor(); await p.waitForTimeout(1200);
    const inNotebook = await p.evaluate(() => readingPosition());
    await p.locator('[data-mode="original"]').click(); await p.waitForTimeout(1500);
    const after = await p.evaluate(() => readingPosition());
    assert.equal(after.page, before.page, 'same page after switching back'); assert.ok(Math.abs(after.ratio - before.ratio) < .03, `same place in the page ${before.ratio} → ${after.ratio}`);
    done.push('view switch keeps the page');
    // A second switch made while the first is still settling goes back to the same place.
    await p.locator('[data-mode="notebook"]').click(); await p.waitForTimeout(60); await p.locator('[data-mode="original"]').click(); await p.waitForTimeout(1500);
    const quick = await p.evaluate(() => readingPosition()); assert.equal(quick.page, before.page, 'quick switch'); assert.ok(Math.abs(quick.ratio - before.ratio) < .03, 'quick switch: ' + quick.ratio);
    // A placed pane is free to scroll during the retries.
    await p.locator('[data-mode="notebook"]').click(); await p.waitForTimeout(150); await p.locator('[data-mode="original"]').click(); await p.waitForTimeout(150);
    const orig = await p.locator('.original-pages').boundingBox(); await p.mouse.move(orig.x + orig.width / 2, orig.y + orig.height / 2); await p.mouse.wheel(0, -1200); await p.waitForTimeout(1200);
    const wheeled = await p.evaluate(() => readingPosition()); assert.ok(wheeled.page !== before.page || wheeled.ratio < before.ratio - .1, 'the wheel is not pulled back ' + JSON.stringify(wheeled));

    // 3. Saving an annotation keeps the reading position.
    await p.evaluate(() => { const c = document.querySelector('.original-pages'), s = c.querySelector('[data-page="2"]'); c.scrollTop = pageTop(c, s) + s.getBoundingClientRect().height * .5; });
    await p.waitForTimeout(300); const beforeNote = await p.evaluate(() => readingPosition());
    await p.locator('[data-action="new-annotation"]').click(); await p.locator('#annotation-body').fill('위치 유지 주석'); await p.locator('[data-action="save-annotation"]').click(); await p.locator('.annotation').filter({ hasText: '위치 유지 주석' }).waitFor(); await p.waitForTimeout(1200);
    const afterNote = await p.evaluate(() => readingPosition());
    assert.equal(afterNote.page, beforeNote.page); assert.ok(Math.abs(afterNote.ratio - beforeNote.ratio) < .03, `annotation: ${beforeNote.ratio} → ${afterNote.ratio}`);
    done.push('saved annotation keeps the page');

    // 3b. An annotation has the memo's tools: its AI button opens the wide editor with the AI panel.
    // A question's answer is added under the text; a rewrite replaces it; both can be undone and are saved.
    {
      const annot = p.locator('.memo-card.annot').filter({ hasText: '위치 유지 주석' }); await annot.locator('[data-annot-ai]').click();
      await p.locator('.annotation-editor-dialog .md-toolbar [data-md="bold"]').waitFor(); await p.locator('.annotation-editor-dialog .note-ai:not([hidden]) #editor-ai-instruction').waitFor();
      assert.equal(await p.locator('.annotation-editor-dialog [data-md-view]').count(), 4, 'the same four views as a memo'); assert.equal(await p.locator('#annotation-edit').count(), 0, 'not the old plain box');
      await p.locator('#editor-ai-instruction').fill('이 주석을 설명해 줘'); await p.locator('[data-editor-ai-send]').click(); await p.locator('[data-editor-ai-take="append"]').click();
      await p.waitForFunction(() => itemAnnotations.some(a => /^위치 유지 주석\n\n\*\*Q\. 이 주석을 설명해 줘\*\*[\s\S]*다듬은 메모/.test(a.body)));
      let request = await app.evaluate(() => globalThis.memoRequests.at(-1)); assert.equal(request.note, '위치 유지 주석'); assert.match(request.section, /^주석/); assert.equal(request.question, '이 주석을 설명해 줘');
      await p.locator('[data-memo-ai-mode="edit"]').click(); await p.locator('#editor-ai-instruction').fill('짧게'); await p.locator('[data-editor-ai-send]').click(); await p.locator('[data-editor-ai-take="replace"]').click();
      await p.waitForFunction(() => itemAnnotations.some(a => a.body === '다듬은 메모\n\n- 하나'));
      request = await app.evaluate(() => globalThis.memoRequests.at(-1)); assert.match(request.memo, /^위치 유지 주석/); assert.equal(request.instruction, '짧게');
      // One undo puts the earlier text back; typing in the editor saves as well.
      await p.locator('.undo-toast button').click(); await p.waitForFunction(() => itemAnnotations.some(a => /^위치 유지 주석\n\n\*\*Q\./.test(a.body)));
      await p.locator('.annotation-editor-dialog [data-md-view="edit"]').click(); await p.locator('#note-editor').fill('직접 고친 주석'); await p.locator('#dialog [data-action="close"]').first().click();
      await p.locator('.memo-card.annot').filter({ hasText: '직접 고친 주석' }).waitFor();
      const saved = JSON.parse(await fs.readFile(path.join(vault, appName.vaultDir, 'library.json'), 'utf8')); assert.ok(saved.annotations.some(x => x.body === '직접 고친 주석'));
      // 넓게 편집 opens the same editor without the AI panel.
      await p.locator('.memo-card.annot').filter({ hasText: '직접 고친 주석' }).locator('[data-edit-annotation]').click(); await p.locator('.annotation-editor-dialog #note-editor').waitFor();
      assert.equal(await p.locator('.annotation-editor-dialog .note-ai').evaluate(n => n.hidden), true); await p.locator('.annotation-editor-dialog [data-md-view="live"]').click(); await p.locator('#dialog [data-action="close"]').first().click();
      done.push('an annotation opens in the wide editor with AI ask and rewrite, undo and save');
    }

    // 4. Memo pin from Ctrl+7: the text tool's second way pins a new memo where the original is pressed;
    // the pin opens it by click and by keyboard and moves by dragging. No separate pin button remains.
    assert.equal(await p.locator('[data-memo-pin-new]').count(), 0, 'no pin button in the original toolbar');
    await p.evaluate(() => document.activeElement?.blur());
    await p.keyboard.press('Control+7'); assert.equal(await p.evaluate(() => globalThis.appInk.tool), 'text');
    await p.keyboard.press('Control+7'); assert.equal(await p.evaluate(() => globalThis.appInk.tool), 'memo', 'Ctrl+7 again: the memo pin');
    assert.match(await p.locator('.ink-tools [data-ink-tool="memo"]').getAttribute('data-tip'), /^메모 · .*Ctrl\+7$/);
    await p.evaluate(() => goToPage(2)); await p.waitForTimeout(300);
    const page2 = p.locator('.original-pages .page[data-page-number="2"]'); const pb = await page2.boundingBox();
    await p.mouse.click(pb.x + pb.width * .3, pb.y + pb.height * .2);
    const pin = p.locator('.memo-pin').first(); await pin.waitFor();
    const key = await pin.getAttribute('data-memo-pin-open'); let place = await p.evaluate(k => JSON.parse(notes[k + '#pin']), key);
    assert.equal(place.page, 2); assert.ok(Math.abs(place.x - .3) < .02 && Math.abs(place.y - .2) < .02, JSON.stringify(place));
    await p.locator(`.memo-card.open[data-memo="${key}"]`).waitFor(); assert.equal(await p.evaluate(k => notes[k + '#title'], key), '2쪽 메모');
    assert.equal(await p.evaluate(() => globalThis.appInk.tool), 'read', 'the reading tool comes back after the pin');
    await p.evaluate(() => { openMemoKey = null; refreshMemos(); }); await pin.focus(); await p.keyboard.press('Enter'); await p.locator(`.memo-card.open[data-memo="${key}"]`).waitFor();
    const pinBox = await pin.boundingBox(); await p.mouse.move(pinBox.x + 10, pinBox.y + 10); await p.mouse.down(); await p.mouse.move(pinBox.x + 60, pinBox.y + 50, { steps: 5 }); await p.mouse.up(); await p.waitForTimeout(200);
    place = await p.evaluate(k => JSON.parse(notes[k + '#pin']), key); assert.ok(place.x > .33 && place.y > .22, 'moved ' + JSON.stringify(place));
    // The open memo's window and pin are icons in its title row.
    assert.equal(await p.locator(`.memo-card.open .memo-card-head [data-memo-window]`).count(), 1); assert.equal(await p.locator(`.memo-card.open .memo-card-head [data-memo-pin][aria-pressed="true"]`).count(), 1);
    assert.deepEqual(await p.locator('.memo-card.open .memo-actions button').evaluateAll(n => n.map(b => Object.keys(b.dataset)[0])), ['memoFold', 'memoAi', 'memoPin', 'memoWide', 'memoWindow', 'memoDelete'], 'AI · 핀 · 넓게 편집 · 새 창 · 휴지통');
    // A pinned memo has one link icon to its pin: from the translation view it shows the original and the pin flashes.
    const pinLink = p.locator(`.memo-card[data-memo="${key}"] [data-memo-pin-go]`); assert.equal(await pinLink.locator('svg').count(), 1); assert.equal(await pinLink.locator('path').getAttribute('d'), await p.evaluate(() => /d="([^"]+)"/.exec(LINK_ICON)[1]), 'a pin is reached by the link icon'); assert.match(await pinLink.getAttribute('title'), /핀으로 이동 · 원문 \d+쪽/);
    await p.evaluate(() => { state.mode = 'translated'; render(); }); await p.locator('.original-pages').waitFor({ state: 'detached' });
    await p.locator(`.memo-card[data-memo="${key}"] [data-memo-pin-go]`).click(); await p.waitForFunction(() => state.mode === 'original', null, { timeout: 5000 }); // no translation yet: the original alone
    await p.waitForFunction(k => { const pin = document.querySelector(`.original-pages [data-memo-pin-open="${k}"]`), box = pin?.closest('.original-pages')?.getBoundingClientRect(), r = pin?.getBoundingClientRect(); return r && r.top >= box.top && r.bottom <= box.bottom; }, key);
    assert.equal(await p.locator('.pin-flash').count(), 0, 'the pin is shown, not flashed');
    done.push('Ctrl+7 memo pin placed, opened, moved, reached from its memo');

    // 5. AI: a memo's AI button opens its wide editor with the AI panel. 질문하기 adds an answer (with the
    // passage selected in the original), 고치기 rewrites; closing while waiting cancels. The same for 요약.
    assert.equal(await p.locator('.memo-tab .insight-panel').count(), 0, 'the memo tab is not a copy of the AI tab');
    await p.evaluate(k => setNote(k, '원래 메모 내용'), key); await p.evaluate(() => refreshMemos());
    const aiButton = p.locator(`.memo-card.open .memo-card-head [data-memo-ai]`);
    await aiButton.click(); await p.locator('#dialog .note-ai #editor-ai-instruction').fill('wait'); await p.locator('[data-editor-ai-send]').click();
    await p.locator('.note-ai-result').filter({ hasText: '요청 중' }).waitFor(); await p.keyboard.press('Escape'); await p.waitForFunction(() => !dialog.open);
    await p.waitForTimeout(300); assert.equal(await app.evaluate(() => globalThis.memoAborted), true, 'request aborted on close');
    await p.evaluate(() => { const span = document.querySelector('.original-pages .page[data-page="1"] .textLayer span'), range = document.createRange(); range.selectNodeContents(span); getSelection().removeAllRanges(); getSelection().addRange(range); });
    await aiButton.click(); await p.locator('#editor-ai-selection').waitFor(); assert.equal(await p.locator('[data-memo-ai-mode="ask"]').getAttribute('aria-checked'), 'true', 'asking first');
    assert.equal(await p.locator('#dialog #note-editor').inputValue(), '원래 메모 내용', 'the memo beside the AI');
    if (process.env.APP_MEMO_AI_SCREENSHOT) await p.screenshot({ path: process.env.APP_MEMO_AI_SCREENSHOT });
    await p.locator('#editor-ai-instruction').fill('이 문장의 뜻은?'); await p.locator('[data-editor-ai-send]').click(); await p.locator('.memo-ai-preview').waitFor();
    let sent = await app.evaluate(() => globalThis.memoRequests.at(-1));
    assert.equal(sent.question, '이 문장의 뜻은?'); assert.equal(sent.note, '원래 메모 내용'); assert.match(sent.selection, /A research paper connects ideas/); assert.equal(sent.page, 1);
    await p.locator('[data-editor-ai-take="append"]').filter({ hasText: '메모에 추가' }).click();
    await p.waitForFunction(k => notes[k].startsWith('원래 메모 내용\n\n**Q. 이 문장의 뜻은?**\n\n> A research paper connects ideas') && notes[k].endsWith('(p. 1)\n\n다듬은 메모\n\n- 하나'), key);
    await p.waitForFunction(k => document.querySelector('#dialog #note-editor').value === notes[k], key);
    // The connection and model come first, above 질문하기 · 메모 고치기; a question can carry pictures.
    // 연결·모델 is one chip under the question box (no lists on show); a click lists the models, Esc closes the list only.
    assert.equal(await p.locator('#dialog .note-ai #editor-ai-model').isVisible(), false, 'no model lists on show');
    const chip = p.locator('#dialog .note-ai [data-editor-ai-chip]');
    assert.ok(await p.evaluate(() => { const box = document.querySelector('#dialog .note-ai-composer'), chip = document.querySelector('#dialog [data-editor-ai-chip]'); return Boolean(box.compareDocumentPosition(chip) & Node.DOCUMENT_POSITION_FOLLOWING); }), 'chip under the question box');
    assert.match(await chip.innerText(), /Fixture GPT\s*ChatGPT 웹 계정/);
    await chip.click(); await p.locator('#dialog .note-ai-menu [data-editor-ai-pick="gpt-web"][aria-checked="true"]').waitFor();
    await p.keyboard.press('Escape'); await p.locator('#dialog .note-ai-menu').waitFor({ state: 'detached' }); assert.equal(await p.evaluate(() => dialog.open), true, 'Esc closes the list, not the editor');
    await chip.click(); await p.locator('#dialog .note-ai-menu').waitFor(); if (process.env.APP_MEMO_AI_SCREENSHOT) await p.screenshot({ path: process.env.APP_MEMO_AI_SCREENSHOT.replace(/\.png$/, '-menu.png') });
    await p.locator('#dialog .note-ai-menu [data-model="fixture-model"]').click(); await p.locator('#dialog .note-ai-menu').waitFor({ state: 'detached' });
    assert.equal(await p.evaluate(() => editorAiChoice(noteEditor).model), 'fixture-model');
    const tinyPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
    await p.locator('#editor-ai-images').setInputFiles({ name: 'figure.png', mimeType: 'image/png', buffer: tinyPng }); await p.locator('.memo-ai-image-list .rules-image').waitFor();
    await p.locator('#editor-ai-instruction').fill('이 그림은?'); await p.locator('[data-editor-ai-send]').click(); await p.locator('.memo-ai-preview').waitFor();
    sent = await app.evaluate(() => globalThis.memoRequests.at(-1)); assert.equal(sent.images, 1); assert.equal(sent.sentImages, 1, 'the picture goes beside the question');
    await p.locator('[data-editor-ai-take="append"]').click(); await p.waitForFunction(k => /\*\*Q\. 이 그림은\?\*\*\n\n!\[질문 그림\]\(note-image:/.test(notes[k]), key);
    assert.equal(await p.locator('.memo-ai-image-list .rules-image').count(), 0, 'pictures clear after adding');
    await p.locator('[data-memo-ai-mode="edit"]').click(); await p.locator('[data-memo-ai-preset="핵심만 요약"]').click(); assert.equal(await p.locator('#editor-ai-instruction').inputValue(), '핵심만 요약');
    await p.locator('[data-editor-ai-send]').click(); await p.locator('.memo-ai-preview').waitFor();
    await p.locator('[data-editor-ai-take="replace"]').click(); await p.waitForFunction(k => notes[k] === '다듬은 메모\n\n- 하나', key);
    sent = await app.evaluate(() => globalThis.memoRequests.at(-1)); assert.match(sent.memo, /^원래 메모 내용\n\n\*\*Q\./); assert.equal(sent.instruction, '핵심만 요약');
    // The editor's own AI icon closes and opens the panel.
    await p.locator('#dialog [data-editor-ai]').click(); assert.equal(await p.locator('#dialog .note-ai').isHidden(), true);
    await p.locator('#dialog [data-editor-ai]').click(); await p.locator('#dialog .note-ai #editor-ai-instruction').waitFor();
    await p.keyboard.press('Escape'); await p.waitForFunction(() => !dialog.open);
    await p.waitForFunction(() => document.querySelector('#note')?.value === '다듬은 메모\n\n- 하나');
    // 요약: each of the four sections has the same button; an empty section can be asked about, then rewritten.
    await p.evaluate(() => getSelection().removeAllRanges());
    await p.locator('[data-tab="요약"]').click(); assert.equal(await p.locator('.summary-card [data-memo-ai]').count(), 4);
    const paperId = key.split('-')[0];
    await p.locator('.summary-card[data-summary="1"] [data-memo-ai]').click(); assert.equal(await p.locator('[data-memo-ai-mode="edit"]').isDisabled(), true, 'nothing to rewrite yet');
    await p.locator('#editor-ai-instruction').fill('이 연구의 방법을 정리해 줘'); await p.locator('[data-editor-ai-send]').click();
    await p.locator('[data-editor-ai-take="append"]').filter({ hasText: '섹션에 추가' }).click();
    await p.waitForFunction(id => notes[`${id}-summary-1`] === '**Q. 이 연구의 방법을 정리해 줘**\n\n다듬은 메모\n\n- 하나', paperId);
    sent = await app.evaluate(() => globalThis.memoRequests.at(-1)); assert.equal(sent.section, '방법'); assert.equal(sent.selection, undefined);
    assert.equal(await p.locator('[data-memo-ai-mode="edit"]').isDisabled(), false, 'something to rewrite now');
    await p.locator('[data-memo-ai-mode="edit"]').click(); await p.locator('#editor-ai-instruction').fill('목록으로');
    await p.locator('[data-editor-ai-send]').click(); await p.locator('[data-editor-ai-take="replace"]').click();
    await p.waitForFunction(id => notes[`${id}-summary-1`] === '다듬은 메모\n\n- 하나', paperId);
    await p.keyboard.press('Escape'); await p.waitForFunction(() => !dialog.open);
    await p.locator('[data-tab="메모"]').click(); await p.evaluate(k => openMemo(k), key); await p.locator(`.memo-card.open[data-memo="${key}"]`).waitFor();
    done.push('AI in the wide editor from memos and 요약 sections: ask with the selected passage, rewrite, cancel');

    // 6. The memo in its own window: the same wide editor (title, toolbar, live view with math, AI);
    // what is written there reaches the app's editors.
    const [child] = await Promise.all([app.waitForEvent('window'), p.locator(`.memo-card.open [data-memo-window]`).click()]);
    await child.locator('.md-live .cm-content').waitFor(); assert.equal(await child.locator('#note-editor').inputValue(), '다듬은 메모\n\n- 하나');
    assert.ok(await child.locator('.md-toolbar [data-md]').count() >= 15, 'the formatting tools'); assert.equal(await child.locator('.md-toolbar [data-editor-ai]').count(), 1); assert.equal(await child.locator('.editor-title').inputValue(), '2쪽 메모');
    await child.locator('.md-live .cm-content').click(); await child.keyboard.press('Control+A'); await child.keyboard.type('창에서 고친 메모 $x^2$ (p. 2)');
    await p.waitForFunction(k => notes[k] === '창에서 고친 메모 $x^2$ (p. 2)', key);
    await child.locator('.md-live .cm-math .katex').first().waitFor();
    // The app's editors take the text once typing pauses (not on every key).
    await p.waitForFunction(() => document.querySelector('#note').value === '창에서 고친 메모 $x^2$ (p. 2)' && liveFields.get(document.querySelector('#note')).getDoc() === '창에서 고친 메모 $x^2$ (p. 2)', null, { timeout: 3000 });
    await child.locator('.editor-title').fill('창 제목'); await p.waitForFunction(k => notes[k + '#title'] === '창 제목', key); assert.equal(await child.title(), '창 제목');
    await child.locator('.editor-title').fill('2쪽 메모');
    await child.locator('[data-editor-ai]').click(); await child.locator('#editor-ai-instruction').fill('창에서 묻기'); await child.locator('[data-editor-ai-send]').click();
    await child.locator('.memo-ai-preview').waitFor(); if (process.env.APP_MEMO_WINDOW_SCREENSHOT) await child.screenshot({ path: process.env.APP_MEMO_WINDOW_SCREENSHOT });
    await child.locator('[data-editor-ai-take="append"]').click();
    await p.waitForFunction(k => notes[k] === '창에서 고친 메모 $x^2$ (p. 2)\n\n**Q. 창에서 묻기**\n\n다듬은 메모\n\n- 하나', key);
    await child.waitForFunction(() => document.querySelector('#note-editor').value.endsWith('**Q. 창에서 묻기**\n\n다듬은 메모\n\n- 하나'));
    await child.close();
    done.push('memo window is the wide editor (live view, math, title, AI) and reaches the app');

    // 7. Notebook: a page at the original's size, a memo embed that follows the memo, an @mention.
    await p.locator('[data-mode="notebook"]').click(); await p.locator('.notebook-pane [data-action="nb-new"]').first().click();
    await p.locator('#nb-title').fill('노트'); await p.locator('#dialog [data-action="nb-create"]').click(); await p.locator('.nb-page').first().waitFor();
    await (await toolShown(p, '[data-nb-add]')).click(); await p.locator('.nb-add-menu .nb-size').selectOption('original'); await p.locator('.nb-add-menu [data-action="nb-add-page"]').click(); await p.waitForFunction(() => document.querySelectorAll('.nb-page').length === 2);
    assert.deepEqual(await p.locator('.nb-page').last().evaluate(n => [n.dataset.w, n.dataset.h]), ['600', '800']);
    done.push('notebook page at the original size 600×800 pt');
    await p.locator('.nb-page').first().scrollIntoViewIfNeeded(); await p.locator('.nb-page').first().click({ position: { x: 5, y: 5 } });
    // 메모 넣기 puts the memo as a card like the memo tab's: its title and one line, following the memo.
    // It opens beside its button as a small window (not a dialog): its title, the paper's memos and a line on what a
    // card does; Esc closes it and gives the button back its focus.
    const memoMenu = p.locator('.pop-menu.nb-memo-menu');
    await (await toolShown(p, '[data-action="nb-memo"]')).click(); await memoMenu.waitFor(); assert.equal(await p.locator('#dialog[open]').count(), 0, 'no dialog');
    assert.equal(await memoMenu.locator('.pop-menu-title').innerText(), '메모 넣기'); assert.match(await memoMenu.innerText(), /메모 내용이 그대로 보이고, 메모를 고치면 함께 바뀝니다\./);
    await p.keyboard.press('Escape'); await memoMenu.waitFor({ state: 'detached' }); assert.equal(await p.evaluate(() => document.activeElement?.dataset.action), 'nb-memo');
    await (await toolShown(p, '[data-action="nb-memo"]')).click(); await p.locator(`.pop-menu.nb-memo-menu [data-nb-embed="${key}"]`).click(); await memoMenu.waitFor({ state: 'detached' });
    const card = p.locator(`.nb-memo-card[data-nb-memo-key="${key}"]`); await card.waitFor();
    assert.equal(await card.locator('.nb-memo-head strong').innerText(), '2쪽 메모'); assert.match(await card.locator('.memo-line').innerText(), /창에서 고친 메모/);
    assert.equal(await p.locator('.nb-page .nb-pin').count(), 0, 'an embed is a card, not a pin');
    await p.evaluate(k => setNote(k, '노트북에서도 바뀌는 메모'), key); await p.waitForFunction(k => /노트북에서도 바뀌는 메모/.test(document.querySelector(`.nb-memo-card[data-nb-memo-key="${k}"] .memo-line`)?.textContent), key);
    // Pressed, it opens in place with the memo's live editor; typing there is the memo; Esc folds it.
    await p.evaluate(() => { openMemoKey = null; refreshMemos(); });
    { const b = await card.boundingBox(); await p.mouse.click(b.x + b.width * .4, b.y + b.height - 6); }
    const openCard = p.locator(`.nb-memo-card.open[data-nb-memo-key="${key}"]`); await openCard.locator('.field-live .cm-content').waitFor();
    assert.equal(await openCard.locator('.memo-title').inputValue(), '2쪽 메모'); assert.ok(await openCard.locator('[data-memo-wide]').count() && await openCard.locator('[data-memo-ai]').count() && await openCard.locator('[data-memo-window]').count() && await openCard.locator('[data-memo-pin]').count(), 'the memo tab\'s buttons');
    await p.waitForFunction(() => document.activeElement?.closest('.nb-memo-card.open .field-live')); await p.keyboard.type(' 추가');
    await p.waitForFunction(k => notes[k] === '노트북에서도 바뀌는 메모 추가', key); if (process.env.APP_MEMO_NB_SCREENSHOT) await p.screenshot({ path: process.env.APP_MEMO_NB_SCREENSHOT + '-open.png' });
    await p.keyboard.press('Backspace'); await p.waitForFunction(k => notes[k] === '노트북에서도 바뀌는 메모 추', key); assert.equal(await card.count(), 1, 'Backspace in the card edits the memo, never removes the card');
    await p.keyboard.press('Escape'); await p.locator(`.nb-memo-card:not(.open)[data-nb-memo-key="${key}"]`).waitFor(); assert.match(await card.locator('.memo-line').innerText(), /메모 추$/); if (process.env.APP_MEMO_NB_SCREENSHOT) await p.screenshot({ path: process.env.APP_MEMO_NB_SCREENSHOT + '-closed.png' });
    // Dragging the closed card moves it and does not open it; 넓게 편집 opens the wide editor.
    const cardX = await p.evaluate(k => nb.doc.pages.flatMap(pg => pg.items).find(i => i.key === k).x, key);
    { const b = await card.boundingBox(); await p.mouse.move(b.x + b.width / 2, b.y + b.height - 6); await p.mouse.down(); await p.mouse.move(b.x + b.width / 2 + 40, b.y + b.height - 6, { steps: 5 }); await p.mouse.up(); }
    assert.ok(await p.evaluate(([k, x]) => nb.doc.pages.flatMap(pg => pg.items).find(i => i.key === k).x > x + 10, [key, cardX]), 'moved'); assert.equal(await p.locator('.nb-memo-card.open').count(), 0, 'a drag does not open it');
    await card.locator('[data-memo-wide]').click(); await p.waitForFunction(k => dialog.open && noteEditor?.key === k, key); await p.keyboard.press('Escape'); await p.waitForFunction(() => !dialog.open);
    // The copy the export prints is brought up to date with the notebook's next save, not on every edit.
    await p.evaluate(() => { nbSave(true); return nbFlush(); });
    assert.equal(await p.evaluate(k => nb.doc.pages.flatMap(pg => pg.items).find(i => i.key === k).text, key), '노트북에서도 바뀌는 메모 추', 'saved copy follows');
    // A deleted memo stays on the page with its last text, marked as deleted.
    const gone = await p.evaluate(() => { const k = newMemo('지울 메모 내용', '지울 메모'); refreshMemos(); return k; });
    await (await toolShown(p, '[data-action="nb-memo"]')).click(); await p.locator(`.pop-menu.nb-memo-menu [data-nb-embed="${gone}"]`).click();
    await p.locator(`.nb-memo-card[data-nb-memo-key="${gone}"]`).filter({ hasText: '지울 메모 내용' }).waitFor();
    assert.ok(await p.evaluate(([a, b]) => { const r = k => document.querySelector(`.nb-memo-card[data-nb-memo-key="${k}"]`).getBoundingClientRect(), x = r(a), y = r(b); return y.top >= x.bottom || y.bottom <= x.top || y.left >= x.right || y.right <= x.left; }, [key, gone]), 'a new card does not cover the one there');
    await p.evaluate(k => deleteMemo(k), gone); await p.locator(`.nb-memo-card[data-nb-memo-key="${gone}"]`).filter({ hasText: '(지워짐)' }).waitFor();
    // With many memos the window stays on the screen and scrolls inside; a second press of the button closes it.
    const many = await p.evaluate(() => { const keys = Array.from({ length: 40 }, (_, i) => `${state.selected}-메모-many${i}`); keys.forEach((k, i) => setNote(k, `많은 메모 ${i}`)); refreshMemos(); return keys; });
    assert.ok(await p.evaluate(() => nbMemos().length >= 40));
    await (await toolShown(p, '[data-action="nb-memo"]')).click(); await memoMenu.waitFor();
    assert.deepEqual(await memoMenu.evaluate(el => { const r = el.getBoundingClientRect(); return [r.top >= 0 && r.bottom <= innerHeight, el.scrollHeight > el.clientHeight]; }), [true, true]);
    await (await toolShown(p, '[data-action="nb-memo"]')).click(); await memoMenu.waitFor({ state: 'detached' });
    await p.evaluate(keys => { keys.forEach(k => deleteMemo(k)); refreshMemos(); }, many);
    // Each memo shows its first line under its title (as its memo card does), on one line; an empty memo shows none.
    // (The picture is a real stored one: a missing file would be a failed load in the memo cards.)
    // A stored picture is shown through the app's own protocol (app://note-image/…).
    assert.deepEqual(await p.evaluate(async () => { const name = await window.appApi.saveNoteImage(state.storageKey, 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), img = new Image(); img.src = noteImageUrl(name); await img.decode(); return [img.src.split('/')[0], img.naturalWidth]; }), ['app:', 1]);
    const firstLines = await p.evaluate(async () => { const at = state.selected, picture = await window.appApi.saveNoteImage(state.storageKey, 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='); const make = [['first', '연구 질문 정리'], ['second', '방법: 생존 분석'], ['empty', ''], ['picture', `![](note-image:${picture})`], ['long', 'A first line long enough to need an ellipsis in the narrow menu, and then some more words to be sure. '.repeat(3)]];
      for (const [k, text] of make) setNote(`${at}-메모-line${k}`, text); refreshMemos(); return make.map(([k]) => `${at}-메모-line${k}`); });
    await (await toolShown(p, '[data-action="nb-memo"]')).click(); await memoMenu.waitFor();
    const items = await memoMenu.evaluate((menu, keys) => keys.map(k => { const b = menu.querySelector(`[data-nb-embed="${k}"]`), line = b.querySelector('.nb-memo-line'), box = document.createElement('div'), g = memoGlance(notes[k]), glance = g.line || (g.image ? tr('그림') : ''); box.innerHTML = g.line ? renderNote(g.line) : glance;
      return { title: b.querySelector('.nb-memo-title')?.textContent, line: line?.textContent ?? null, card: glance ? box.textContent : null, height: b.offsetHeight, cut: line ? line.scrollWidth > line.clientWidth : false, oneLine: line ? getComputedStyle(line).whiteSpace === 'nowrap' : null }; }), firstLines);
    assert.deepEqual(items.map(i => i.line), items.map(i => i.card)); assert.deepEqual(items.slice(0, 2).map(i => i.line), ['연구 질문 정리', '방법: 생존 분석']);
    assert.equal(items[2].line, null, 'an empty memo has no second line'); assert.ok(items.every(i => i.title));
    assert.equal(items[3].line, '그림', 'a memo of pictures only is named as its card names it');
    assert.ok(items[4].cut && items[4].oneLine && Math.abs(items[4].height - items[0].height) <= 1, JSON.stringify(items));
    await p.locator(`.pop-menu.nb-memo-menu [data-nb-embed="${firstLines[1]}"]`).click(); await p.locator(`.nb-memo-card[data-nb-memo-key="${firstLines[1]}"]`).waitFor();
    await p.evaluate(keys => { keys.forEach(k => deleteMemo(k)); refreshMemos(); }, firstLines);
    done.push('notebook memo card: title and line, opens in place to write, Esc, drag, wide editor, deletion');
    // On a notebook page the Ctrl+7 memo tool pins a new memo where the page is pressed (a pin, as on the source) and opens it.
    const cards = await p.locator('.nb-memo-card').count();
    await p.evaluate(() => document.activeElement?.blur()); await p.keyboard.press('Control+7'); if (await p.evaluate(() => globalThis.appInk.tool) !== 'memo') await p.keyboard.press('Control+7');
    assert.equal(await p.evaluate(() => globalThis.appInk.tool), 'memo');
    await p.locator('.nb-page').first().scrollIntoViewIfNeeded(); const nbPage = await p.locator('.nb-page').first().boundingBox(); await p.mouse.click(nbPage.x + nbPage.width * .6, nbPage.y + nbPage.height * .7);
    const nbPin = p.locator('.nb-page .nb-pin'); await nbPin.waitFor(); assert.equal(await p.locator('.nb-memo-card').count(), cards, 'no card added');
    const nbKey = await nbPin.getAttribute('data-memo-pin-open'), nbPlace = await p.evaluate(k => JSON.parse(notes[k + '#pin']), nbKey);
    assert.equal(nbPlace.notebookId, await p.evaluate(() => nb.doc.id)); assert.ok(Math.abs(nbPlace.x - .6) < .03 && Math.abs(nbPlace.y - .7) < .03, JSON.stringify(nbPlace));
    assert.equal(await p.evaluate(k => notes[k + '#title'], nbKey), '노트 1쪽 메모');
    await p.locator(`.memo-card.open[data-memo="${nbKey}"]`).waitFor(); assert.equal(await p.evaluate(() => globalThis.appInk.tool), 'read');
    await p.waitForFunction(() => document.activeElement?.closest('.memo-card.open'), null, { timeout: 3000 }); // ready to write in
    // The pin moves by dragging and opens its memo when pressed.
    { const b = await nbPin.boundingBox(); await p.mouse.move(b.x + 10, b.y + 10); await p.mouse.down(); await p.mouse.move(b.x - 30, b.y - 40, { steps: 5 }); await p.mouse.up(); }
    await p.waitForFunction(([k, y]) => JSON.parse(notes[k + '#pin']).y < y - .02, [nbKey, nbPlace.y]);
    await p.evaluate(() => { openMemoKey = null; refreshMemos(); }); await p.locator('.nb-page .nb-pin').click(); await p.locator(`.memo-card.open[data-memo="${nbKey}"]`).waitFor();
    if (process.env.APP_MEMO_NB_SCREENSHOT) await p.screenshot({ path: process.env.APP_MEMO_NB_SCREENSHOT + '-pin.png' });
    // Its link goes back to the notebook page from the original view.
    await p.locator('[data-mode="original"]').click(); await p.waitForFunction(() => state.mode === 'original');
    await p.locator(`.memo-card[data-memo="${nbKey}"] [data-memo-pin-go]`).click(); await p.waitForFunction(() => state.mode === 'notebook');
    await p.waitForFunction(k => { const pin = document.querySelector(`.nb-page [data-memo-pin-open="${k}"]`), box = pin?.closest('.nb-pages')?.getBoundingClientRect(), r = pin?.getBoundingClientRect(); return r && r.top >= box.top && r.bottom <= box.bottom; }, nbKey);
    done.push('Ctrl+7 memo pin on a notebook page, moved, opened and reached from its memo');
    // One pin per memo: the memo tools take the pin out, then put it on the source page; the notebook keeps none.
    const pinButton = p.locator(`.memo-card.open[data-memo="${nbKey}"] [data-memo-pin]`);
    assert.match(await pinButton.getAttribute('title'), /핀 빼기 \(노트북 ‘노트’ 1쪽\)/); await pinButton.click();
    await p.waitForFunction(k => notes[k + '#pin'] === undefined, nbKey); await p.waitForFunction(() => !document.querySelector('.nb-page .nb-pin'));
    await p.locator(`.memo-card.open[data-memo="${nbKey}"] [data-memo-pin]`).click();
    { const b = await p.locator('.original-pages .page[data-page="1"]').boundingBox(); await p.mouse.click(b.x + b.width * .8, b.y + b.height * .2); }
    await p.waitForFunction(k => JSON.parse(notes[k + '#pin'] || 'null')?.attachmentId, nbKey);
    await p.locator(`.original-pages [data-memo-pin-open="${nbKey}"]`).waitFor(); assert.equal(await p.locator('.nb-page .nb-pin').count(), 0);
    await p.locator(`.memo-card.open[data-memo="${nbKey}"] [data-memo-pin]`).click(); await p.waitForFunction(k => notes[k + '#pin'] === undefined, nbKey);
    done.push('one pin per memo, moved between the notebook and the source');
    await (await toolShown(p, '[data-action="nb-text"]')).click(); await p.waitForFunction(() => document.activeElement?.matches('.nb-text textarea'));
    await p.keyboard.type('참고 @2'); await p.locator('.nb-mention-menu [data-nb-mention-pick]').first().waitFor();
    await p.locator('.nb-mention-menu [data-nb-mention-pick]').first().click();
    assert.equal(await p.evaluate(() => document.activeElement?.matches('.nb-text.editing textarea')), true, 'still editing after a pick');
    assert.equal(await p.locator('.nb-text.editing .nb-mention').count(), 1, 'the chip shows right after the pick');
    await p.keyboard.type('끝');
    const textItem = await p.evaluate(() => nb.doc.pages.flatMap(pg => pg.items).filter(i => i.type === 'text').at(-1));
    assert.equal(textItem.text, '참고 @[2쪽 메모] 끝'); assert.deepEqual(textItem.mentions, [{ key, label: '2쪽 메모' }]);
    await p.locator('.nb-text .nb-mention').first().waitFor();
    // Moving the cursor off the name closes the menu; Enter is then a new line, nothing is replaced.
    await p.keyboard.type(' @'); await p.locator('.nb-mention-menu').waitFor(); await p.keyboard.press('ArrowLeft');
    assert.equal(await p.locator('.nb-mention-menu').count(), 0, 'menu closed by the cursor'); await p.keyboard.press('Enter');
    assert.equal(await p.evaluate(() => document.activeElement.value), '참고 @[2쪽 메모] 끝 \n@'); await p.keyboard.press('End');
    // Keyboard: ↓ and Enter choose from the menu.
    await p.keyboard.type(' @'); await p.locator('.nb-mention-menu').waitFor(); await p.keyboard.press('Enter');
    assert.match(await p.evaluate(() => document.activeElement.value), /@\[[^\]]+\] $/);
    await p.evaluate(() => document.activeElement.blur());
    await p.evaluate(k => { openMemoKey = null; refreshMemos(); }, key);
    await p.locator('.nb-text .nb-mention').first().click(); await p.locator(`.memo-card.open[data-memo="${key}"]`).waitFor();
    done.push('@mention keeps editing, stores the memo key, chip opens the memo');

    // Another paper's memo (a project notebook) opens in its own window; the notebook stays.
    const [other] = await Promise.all([app.waitForEvent('window'), p.evaluate(() => { notes['999-메모-x'] = '다른 자료의 메모'; openMemo('999-메모-x'); })]);
    await other.locator('#note-editor').waitFor({ state: 'attached' }); assert.equal(await other.locator('#note-editor').inputValue(), '다른 자료의 메모'); assert.equal(await p.evaluate(() => state.mode), 'notebook');
    await other.close(); await p.evaluate(() => { delete notes['999-메모-x']; });
    done.push("another paper's memo in a window");

    // 8. Pin removal from the memo tools.
    await p.locator('[data-mode="original"]').click(); await p.locator('.original-pages .page[data-page="1"] canvas').first().waitFor();
    await p.evaluate(k => openMemo(k), key); await p.locator(`.memo-card.open[data-memo="${key}"] [data-memo-pin]`).click();
    await p.waitForFunction(k => notes[k + '#pin'] === undefined, key); await p.waitForTimeout(200); assert.equal(await p.locator(`[data-memo-pin-open="${key}"]`).count(), 0);
    done.push('pin removed from the memo tools');

    // A figure explanation of a file whose name has brackets still gets its pin and its memo icon.
    await p.locator('[data-action="figure-open"]').click(); await p.locator('.figure-capture').waitFor();
    const fig = await p.locator('.original-pages .page[data-page="1"]').boundingBox(); await p.mouse.move(fig.x + fig.width * .15, fig.y + fig.height * .3); await p.mouse.down(); await p.mouse.move(fig.x + fig.width * .5, fig.y + fig.height * .5, { steps: 6 }); await p.mouse.up();
    await p.locator('[data-action="figure-send"]').click(); await p.locator('#figure-status').filter({ hasText: '설명 완료' }).waitFor();
    await p.locator('[data-action="figure-save"]').click(); await p.locator('#dialog').waitFor({ state: 'hidden' });
    // A 그림 설명 is an annotation now: a figure pin on the page and a card in the 주석 tab marked with the picture icon.
    await p.locator('.original-pages .figure-pin[data-annotation-pin]').waitFor(); assert.equal(await p.evaluate(() => itemAnnotations.filter(a => a.kind === 'figure' && a.page === 1).length), 1);
    const figureLink = p.locator('.memo-card.annot .annot-page[data-annotation-page="1"]').first(); await figureLink.waitFor();
    assert.equal(await figureLink.locator('svg').first().locator('path').first().getAttribute('d'), await p.evaluate(() => /d="([^"]+)"/.exec(FIGURE_ICON)[1]), 'the picture icon marks a 그림 설명');
    done.push('figure pin and 주석 card for a file name with brackets');

    // 9. The original and the translation in windows of their own.
    // Right after writing, the reader keeps still for a moment (ink.js); then the page is chosen.
    await p.waitForFunction(() => performance.now() > inkWritingUntil);
    await p.evaluate(() => goToPage(3)); await p.waitForTimeout(300);
    const [original] = await Promise.all([app.waitForEvent('window'), p.locator('[data-view-window="original"]').click()]);
    // The app's own reader with the original pane alone (not the browser's PDF viewer), at the page being read.
    await original.waitForLoadState(); assert.match(original.url(), /index\.html\?.*viewWindow=original.*page=3/);
    await original.locator('.original-pages .page .textLayer span').first().waitFor({ timeout: 30000 }); assert.equal(await original.evaluate(() => document.body.classList.contains('view-window')), true); done.push('original in a window');
    await original.close();
    await p.locator('[data-mode="dual"]').click(); await p.locator('#gpt-model').waitFor({ state: 'attached' });
    // A reference image for this translation (added, shown, taken off, added again) goes with each request.
    const png = { name: 'glossary.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64') };
    await p.locator('#translation-images').setInputFiles(png); await p.locator('.rules-image').waitFor({ state: 'attached' });
     await p.locator('[data-rules-image-remove="0"]').click(); assert.equal(await p.locator('.rules-image').count(), 0);
    await p.locator('#translation-images').setInputFiles(png); await p.locator('.rules-image').waitFor();
    await p.locator('[data-action="gpt-start"]').click();
    await p.locator('.translated-pane .translated-sheet').first().waitFor({ timeout: 30000 }); await p.waitForTimeout(1500);
    const sentContexts = await app.evaluate(() => globalThis.translateContexts.map(c => ({ images: c.images?.length || 0, hashes: c.referenceImages?.length || 0, image: c.images?.[0]?.slice(0, 22) })));
    assert.ok(sentContexts.length >= 1 && sentContexts.every(c => c.images === 1 && c.hashes === 1 && c.image === 'data:image/png;base64,'), JSON.stringify(sentContexts));
    done.push('translation with a reference image');
    const [translation] = await Promise.all([app.waitForEvent('window'), p.locator('[data-view-window="translation"]').click()]);
    // The app's own reader with the translated pane alone, showing the stored translation.
    await translation.waitForLoadState(); assert.match(translation.url(), /index\.html\?.*viewWindow=translation/);
    await translation.locator('.translated-pane .translation-layer[data-ready="true"]').first().waitFor({ timeout: 30000 });
    assert.equal(await translation.evaluate(() => document.body.classList.contains('view-window') && Boolean(document.querySelector('.translated-pane .translated-block'))), true);
    await translation.close(); done.push('translation in a window');
    // 10. A notebook in a window of its own puts a memo in the same way.
    await p.locator('[data-mode="notebook"]').click(); await p.locator('.notebook-pane .nb-page').first().waitFor();
    const [nbw] = await Promise.all([app.waitForEvent('window'), p.evaluate(() => actions['nb-window']())]);
    await nbw.waitForLoadState(); await nbw.locator('.nb-page').first().waitFor({ timeout: 30000 });
    await nbw.locator('.nb-page').first().click({ position: { x: 5, y: 5 } });
    const cardsBefore = await nbw.locator('.nb-memo-card').count();
    await (await toolShown(nbw, '[data-action="nb-memo"]')).click(); await nbw.locator('.pop-menu.nb-memo-menu').waitFor(); assert.equal(await nbw.locator('#dialog[open]').count(), 0);
    await nbw.locator(`.pop-menu.nb-memo-menu [data-nb-embed="${key}"]`).click(); await nbw.waitForFunction(n => document.querySelectorAll('.nb-memo-card').length === n + 1, cardsBefore);
    await nbw.close(); done.push('memo put in from a notebook window');

    console.log('Memo tools smoke passed: ' + done.join(', ') + '.');
  } finally { await app.close().catch(() => {}); await fs.rm(temp, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exit(1); });
