// End-to-end check of bold, italic, highlight and strike in the memo's live editor (desktop/live-editor.mjs, live-scan.js,
// md-marks.js): with the cursor on another line each shows styled (bold of weight 600 or more, italic, a highlight
// background, a line through) and its markers hidden, also next to Korean particles, in a list or heading line and
// one inside another (***굵은 기울임***, **==형광 굵게==**); with the cursor inside, its markers show (all of them, for
// marks one inside another). Ctrl+B and Ctrl+I and the wide editor's format bar style the text at once. The memo tab,
// the wide editor, the memo's own window and a notebook's memo card are checked; folded, the memo reads with the same
// <strong>, <em> and <mark>. APP_TEST_SOURCE=1 runs the source; APP_PHOTO_DIR keeps pictures.
const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { PDFDocument, StandardFonts } = require('pdf-lib');
const appName = require('../core/app-name.cjs');
const toolShown = require('./tool-row.cjs'); // a tool a narrow pane keeps under ⋯ is brought out before it is used
const root = path.resolve(__dirname, '..');
const TEXT = '커서 줄\n**굵게**는 *기울임*으로 ==형광==을 ~~취소~~\n***굵은 기울임***과 **==형광 굵게==**\n- 목록 __진하게__ _비스듬히_\n# 제목 ==칠함==';
// What each line shows with the cursor elsewhere, and how each word is styled.
const SHOWN = ['커서 줄', '굵게는 기울임으로 형광을 취소', '굵은 기울임과 형광 굵게', '목록 진하게 비스듬히', '제목 칠함'];
const STYLES = { 굵게: ['bold'], 기울임: ['italic'], 형광: ['mark'], 취소: ['strike'], '굵은 기울임': ['bold', 'italic'], '형광 굵게': ['bold', 'mark'], 진하게: ['bold'], 비스듬히: ['italic'], 칠함: ['bold', 'mark'] }; // a heading is bold itself
// In the page: the styles of the text node holding a word (background and line-through from any mark around it).
const styleOf = ([scope, word]) => {
  const host = document.querySelector(scope), walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT); let n;
  while ((n = walker.nextNode())) if (n.data.includes(word)) break;
  if (!n) return null;
  const own = getComputedStyle(n.parentElement), got = [];
  if (Number(own.fontWeight) >= 600) got.push('bold'); if (own.fontStyle === 'italic') got.push('italic');
  for (let e = n.parentElement; e && !e.classList.contains('cm-line'); e = e.parentElement) {
    const s = getComputedStyle(e); if (!/rgba\(0, 0, 0, 0\)|transparent/.test(s.backgroundColor) && !got.includes('mark')) got.push('mark');
    if (s.textDecorationLine.includes('line-through') && !got.includes('strike')) got.push('strike');
  }
  return got.sort();
};
(async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), `${appName.id}-memo-emphasis-e2e-`)), vault = path.join(temp, 'vault'); await fs.mkdir(vault);
  const doc = await PDFDocument.create(), font = await doc.embedFont(StandardFonts.Helvetica); doc.addPage([600, 800]).drawText('A research paper.', { x: 40, y: 740, size: 14, font });
  await fs.writeFile(path.join(temp, 'paper.pdf'), await doc.save());
  const env = /utf-?8/i.test(process.env.LC_ALL || process.env.LANG || '') ? process.env : { ...process.env, LC_ALL: 'C.UTF-8', LANG: 'C.UTF-8' };
  const photo = async (locator, name) => { if (process.env.APP_PHOTO_DIR) await locator.screenshot({ path: path.join(process.env.APP_PHOTO_DIR, name) }); };
  let app;
  try {
    app = await electron.launch({ env: { ...env, APP_UI_LANG: 'ko' }, executablePath: require('./app-executable.cjs')(root), args: [...(process.env.APP_TEST_SOURCE === '1' ? [root] : []), '--no-sandbox', '--ozone-platform=headless', '--disable-gpu', `--user-data-dir=${path.join(temp, 'profile')}`], timeout: 20000 });
    const p = await app.firstWindow(); p.setDefaultTimeout(15000); await p.setViewportSize({ width: 1300, height: 950 });
    p.on('pageerror', e => { console.error(e); process.exitCode = 1; });
    await app.evaluate(({ dialog }) => { globalThis.openQueue = []; dialog.showOpenDialog = async () => ({ canceled: false, filePaths: globalThis.openQueue.shift() }); });
    await app.evaluate((_, v) => globalThis.openQueue.push([v]), vault); await p.locator('[data-action="storage"]').first().click();
    await app.evaluate((_, f) => globalThis.openQueue.push([f]), path.join(temp, 'paper.pdf')); await p.locator('[data-action="add-files"]').first().click();
    await p.locator('.paper-item').first().click();
    await p.locator('[data-tab="메모"]').first().click().catch(() => {});
    await p.locator('.memo-tab [data-action="memo-new"]').first().click(); await p.locator('.memo-card.open .field-live .cm-content').waitFor();

    // page: the window; view: page code returning its EditorView; scope: the editor's box.
    const run = (page, view, code, arg) => page.evaluate(([v, c, a]) => new Function('view', 'arg', c)(new Function(`return ${v}`)(), a), [view, code, arg]);
    const put = (page, view, text, anchor, head) => run(page, view, 'view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: arg[0] }, selection: { anchor: arg[1], head: arg[2] ?? arg[1] } }); view.focus();', [text, anchor, head]);
    const lineTexts = (page, scope) => page.locator(`${scope} .cm-line`).evaluateAll(list => list.map(l => [...l.childNodes].filter(n => !n.classList?.contains('cm-list-mark')).map(n => n.textContent).join('').trim()));
    // The editor is driven from `at` (the main window, where the memo window's editor lives) and looked at in `page`.
    const check = async (page, view, scope, label, at = page) => {
      await put(at, view, TEXT, 0); await page.waitForTimeout(50);
      assert.deepEqual(await lineTexts(page, scope), SHOWN, `${label}: the markers hide, the cursor elsewhere`);
      for (const [word, want] of Object.entries(STYLES)) { const got = await page.evaluate(styleOf, [scope, word]); assert.deepEqual(got, [...want].sort(), `${label}: ${word} (${got})`); }
      // The cursor inside 굵게: its markers show and it stays bold; inside 굵은 기울임: all its stars show.
      await run(at, view, 'view.dispatch({ selection: { anchor: view.state.doc.line(2).from + 3 } });');
      let shown = await lineTexts(page, scope); assert.ok(shown[1].startsWith('**굵게**는 기울임'), `${label}: markers show with the cursor in the mark (${shown[1]})`);
      assert.deepEqual(await page.evaluate(styleOf, [scope, '굵게']), ['bold'], `${label}: still bold with its markers showing`);
      await run(at, view, 'view.dispatch({ selection: { anchor: view.state.doc.line(3).from + 5 } });');
      shown = await lineTexts(page, scope); assert.ok(shown[2].startsWith('***굵은 기울임***과 형광'), `${label}: all the stars of marks one inside another (${shown[2]})`);
    };
    const memoView = 'fieldEditorOf(document.querySelector(".memo-card.open .note-box textarea")).view';
    await check(p, memoView, '.memo-card.open .field-live', 'memo tab');
    await run(p, memoView, 'view.dispatch({ selection: { anchor: 0 } });'); await photo(p.locator('.memo-card.open'), 'memo-emphasis.png');
    await run(p, memoView, 'view.dispatch({ selection: { anchor: view.state.doc.line(3).from + 5 } });'); await photo(p.locator('.memo-card.open'), 'memo-emphasis-cursor.png');

    // Ctrl+B and Ctrl+I on a selected word: styled at once, bold italic together; the cursor gone, the markers hide.
    await put(p, memoView, 'abc 단어 끝', 4, 6); await p.keyboard.press('ControlOrMeta+b');
    assert.equal(await run(p, memoView, 'return view.state.doc.toString();'), 'abc **단어** 끝');
    assert.deepEqual(await p.evaluate(styleOf, ['.memo-card.open .field-live', '단어']), ['bold'], 'Ctrl+B: bold at once');
    await p.keyboard.press('ControlOrMeta+i'); assert.equal(await run(p, memoView, 'return view.state.doc.toString();'), 'abc ***단어*** 끝');
    assert.deepEqual(await p.evaluate(styleOf, ['.memo-card.open .field-live', '단어']), ['bold', 'italic'], 'Ctrl+I after Ctrl+B: bold italic at once');
    await run(p, memoView, 'view.dispatch({ selection: { anchor: view.state.doc.length } });');
    assert.deepEqual(await lineTexts(p, '.memo-card.open .field-live'), ['abc 단어 끝'], 'the cursor at the end of the line: no stars');
    // A word picked with a space beside it and made bold: the space stays outside the stars; pressed again, it comes off.
    const A = '.memo-card.open .field-live', doc = () => run(p, memoView, 'return view.state.doc.toString();');
    await put(p, memoView, 'abc test def', 3, 8); await p.keyboard.press('ControlOrMeta+b'); assert.equal(await doc(), 'abc **test** def', 'Ctrl+B on " test": the space stays outside');
    assert.deepEqual(await p.evaluate(styleOf, [A, 'test']), ['bold'], 'and it is bold');
    await p.keyboard.press('ControlOrMeta+b'); assert.equal(await doc(), 'abc test def', 'Ctrl+B again takes it off');
    await put(p, memoView, 'abc test def', 4, 9); await p.keyboard.press('ControlOrMeta+i'); assert.equal(await doc(), 'abc *test* def', 'Ctrl+I on "test ": the space stays outside');
    // The lines of the report as they were saved: ** test** shows bold too (a space just inside ** is still bold).
    await put(p, memoView, '커서\n==test==\n** test**\n*test*', 0);
    assert.deepEqual(await lineTexts(p, A), ['커서', 'test', 'test', 'test'], 'no markers left showing');
    const kinds = await p.evaluate(sel => [...document.querySelectorAll(`${sel} .cm-line`)].slice(1).map(l => l.querySelector('.cm-mark,.cm-strong,.cm-em')?.className), A);
    assert.deepEqual(kinds, ['cm-mark', 'cm-strong', 'cm-em'], 'highlight, bold and italic');
    // A bold line with math in it (the memo of the report): bold, the math drawn, no stars.
    await put(p, memoView, '커서\n**-> 생존함수(Survival function)는 시점 $t$ 까지 이벤트가 발생하지 않을 확률**', 0);
    const line = await p.evaluate(sel => { const l = document.querySelectorAll(`${sel} .cm-line`)[1]; return { text: l.textContent, math: !!l.querySelector('.cm-strong .katex, .cm-strong .cm-math'), }; }, A);
    assert.ok(!line.text.includes('**') && line.math, `the bold line with $t$: ${JSON.stringify(line)}`);
    assert.deepEqual(await p.evaluate(styleOf, [A, '생존함수']), ['bold'], 'its words are bold');

    // The wide editor (live view) and its format bar: highlight, then bold, on one word.
    await put(p, memoView, TEXT, 0);
    await p.locator('.memo-card.open [data-memo-wide]').first().click(); await p.locator('.note-editor-body').waitFor();
    if (await p.locator('.note-editor-body').getAttribute('data-view') !== 'live') await p.locator('[data-md-view="live"]').first().click();
    await p.locator('.note-editor-body .md-live .cm-content').waitFor();
    await check(p, 'noteEditor.live.view', '.note-editor-body .md-live', 'wide editor');
    await put(p, 'noteEditor.live.view', 'xyz 낱말 끝', 4, 6);
    await p.locator('.md-toolbar [data-md="mark"]').click(); await p.locator('.md-toolbar [data-md="bold"]').click();
    assert.equal(await run(p, 'noteEditor.live.view', 'return view.state.doc.toString();'), 'xyz ==**낱말**== 끝');
    assert.deepEqual(await p.evaluate(styleOf, ['.note-editor-body .md-live', '낱말']), ['bold', 'mark'], 'format bar: highlight and bold at once');
    await run(p, 'noteEditor.live.view', 'view.dispatch({ selection: { anchor: view.state.doc.length } });');
    assert.deepEqual(await lineTexts(p, '.note-editor-body .md-live'), ['xyz 낱말 끝'], 'format bar: the markers hide when the cursor leaves');
    await put(p, 'noteEditor.live.view', 'xyz 낱말 끝', 4, 7); await p.locator('.md-toolbar [data-md="bold"]').click();
    assert.equal(await run(p, 'noteEditor.live.view', 'return view.state.doc.toString();'), 'xyz **낱말** 끝', 'format bar on "낱말 ": the space stays outside');
    await p.locator('.md-toolbar [data-md="bold"]').click();
    assert.equal(await run(p, 'noteEditor.live.view', 'return view.state.doc.toString();'), 'xyz 낱말 끝', 'pressed again, the bold comes off');
    await put(p, 'noteEditor.live.view', TEXT, 0); await photo(p.locator('.note-editor-body'), 'memo-emphasis-wide.png');

    // The memo's own window.
    const [child] = await Promise.all([app.waitForEvent('window'), p.locator('[data-editor-window]').first().click()]);
    await child.locator('.md-live .cm-content').waitFor();
    await check(child, '[...noteWindows][0].live.view', '.md-live', 'memo window', p);
    await child.close();
    await p.evaluate(() => dialog.close());

    // Folded: the same marks as <strong>, <em>, <mark>, <del>, one inside another as written.
    await put(p, memoView, TEXT, 0); await p.evaluate(() => desktopNotes());
    const html = await p.evaluate(() => renderMarkdown(notes[Object.keys(notes).find(k => /-메모/.test(k) && !k.includes('#'))]));
    for (const piece of ['<strong>굵게</strong>는', '<em>기울임</em>으로', '<mark>형광</mark>을', '<del>취소</del>', '<strong><em>굵은 기울임</em></strong>과', '<strong><mark>형광 굵게</mark></strong>', '<strong>진하게</strong>', '<em>비스듬히</em>', '<mark>칠함</mark>'])
      assert.ok(html.includes(piece), `folded: ${piece} in ${html}`);

    // A notebook's memo card: the same editor; folded, the same marks, the highlight with its background.
    await p.locator('[data-mode="notebook"]').click(); await p.locator('.notebook-pane [data-action="nb-new"]').first().click();
    await p.locator('#nb-title').fill('강조 노트'); await p.locator('#dialog [data-action="nb-create"]').click(); await p.locator('.nb-page').first().waitFor();
    await (await toolShown(p, '.notebook-pane [data-action="nb-memo"]')).click(); await p.locator('.nb-memo-menu [data-action="nb-memo-create"]').click();
    await p.locator('.nb-memo-card.open .field-live .cm-content').waitFor();
    const cardView = 'fieldEditorOf(document.querySelector(".nb-memo-card.open .note-box textarea")).view';
    await check(p, cardView, '.nb-memo-card.open .field-live', 'notebook card');
    await put(p, cardView, TEXT, 0); await photo(p.locator('.nb-memo-card.open'), 'memo-emphasis-notebook.png');
    await put(p, cardView, '***굵은 기울임***과 **==형광 굵게==**', 0); // folded, a card shows its first line
    await p.keyboard.press('Escape'); const folded = p.locator('.nb-memo-card:not(.open)'); await folded.waitFor();
    assert.equal(await folded.locator('strong em').filter({ hasText: '굵은 기울임' }).count(), 1, 'folded card: bold italic');
    assert.ok(await folded.locator('strong mark').filter({ hasText: '형광 굵게' }).evaluate(m => !/rgba\(0, 0, 0, 0\)/.test(getComputedStyle(m).backgroundColor)), 'folded card: the highlight has its background');
    await app.close(); app = null;
    console.log('Memo emphasis smoke passed: bold, italic, highlight and strike styled with their markers hidden (next to Korean, in list and heading lines, one inside another), markers shown with the cursor inside; Ctrl+B/Ctrl+I and the format bar style at once; in the memo tab, the wide editor, the memo window and a notebook card; folded, the same <strong>, <em>, <mark>.');
  } catch (error) { console.error(error); process.exitCode = 1; try { await (await app?.firstWindow())?.screenshot({ path: path.join(os.tmpdir(), `${appName.id}-memo-emphasis-failure.png`) }); } catch {} }
  finally { await app?.close().catch(() => {}); await fs.rm(temp, { recursive: true, force: true }); }
})();
