// End-to-end check of list lines in the memo's live editor (desktop/live-editor.mjs, live-scan.js): with the cursor on
// another line, "- ", "* ", "1. ", an indented item and a to-do item show as a bullet, a number or a box, a list right
// under a paragraph too; with the cursor on the line its source shows; folded, the memo reads as <ul><li>. The memo tab
// and a notebook's memo card use the same editor. APP_TEST_SOURCE=1 runs the source.
const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { PDFDocument, StandardFonts } = require('pdf-lib');
const appName = require('../core/app-name.cjs');
const toolShown = require('./tool-row.cjs'); // a tool a narrow pane keeps under ⋯ is brought out before it is used
const root = path.resolve(__dirname, '..');
const TEXT = '지난 주 배운 터널링과  로라와 비슷한 부분이 있나요?\n- 컴퓨터 사이언스 기본론은 유사하지만 크게 관계가 있는 부분은 아님.\n\n### 질문\n$x$\n\n1. 첫째\n  - 들여쓴 항목\n- [ ] 할 일';
(async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), `${appName.id}-memo-list-e2e-`)), vault = path.join(temp, 'vault'); await fs.mkdir(vault);
  const doc = await PDFDocument.create(), font = await doc.embedFont(StandardFonts.Helvetica); doc.addPage([600, 800]).drawText('A research paper.', { x: 40, y: 740, size: 14, font });
  await fs.writeFile(path.join(temp, 'paper.pdf'), await doc.save());
  const env = /utf-?8/i.test(process.env.LC_ALL || process.env.LANG || '') ? process.env : { ...process.env, LC_ALL: 'C.UTF-8', LANG: 'C.UTF-8' };
  let app;
  try {
    app = await electron.launch({ env: { ...env, APP_UI_LANG: 'ko' }, executablePath: require('./app-executable.cjs')(root), args: [...(process.env.APP_TEST_SOURCE === '1' ? [root] : []), '--no-sandbox', '--ozone-platform=headless', '--disable-gpu', `--user-data-dir=${path.join(temp, 'profile')}`], timeout: 20000 });
    const p = await app.firstWindow(); p.setDefaultTimeout(15000); await p.setViewportSize({ width: 1300, height: 950 });
    p.on('pageerror', e => { console.error(e); process.exitCode = 1; });
    await app.evaluate(({ dialog }) => { globalThis.openQueue = []; dialog.showOpenDialog = async () => ({ canceled: false, filePaths: globalThis.openQueue.shift() }); });
    await app.evaluate((_, v) => globalThis.openQueue.push([v]), vault); await p.locator('[data-action="storage"]').first().click();
    await app.evaluate((_, f) => globalThis.openQueue.push([f]), path.join(temp, 'paper.pdf')); await p.locator('[data-action="add-files"]').first().click();
    await p.locator('.paper-item').first().click();
    // A memo with the text, the cursor at the start of its first line.
    await p.locator('[data-tab="메모"]').first().click().catch(() => {});
    await p.locator('.memo-tab [data-action="memo-new"]').first().click(); await p.locator('.memo-card.open .field-live .cm-content').waitFor();
    const set = (selector, at) => p.evaluate(([s, text, a]) => { const ed = fieldEditorOf(document.querySelector(s)); ed.view.dispatch({ changes: { from: 0, to: ed.view.state.doc.length, insert: text }, selection: { anchor: a } }); }, [selector, TEXT, at]);
    // The cursor put on a line of the editor, as a click there would (in the editor, which has the focus: an editor nobody is in shows no source).
    const cursorAt = (selector, line) => p.evaluate(([s, n]) => { const ed = fieldEditorOf(document.querySelector(s)); ed.view.dispatch({ selection: { anchor: ed.view.state.doc.line(n).from + 2 } }); ed.view.focus(); }, [selector, line]).then(() => p.waitForTimeout(80)); // the editor takes the focus change a moment later
    const lines = scope => p.locator(`${scope} .cm-line`).evaluateAll(list => list.map(l => ({ text: l.textContent, mark: l.querySelector('.cm-list-mark')?.textContent ?? null, box: !!l.querySelector('.cm-list-mark input[type="checkbox"]') })));
    const check = async (scope, area, label) => {
      await set(area, 0);
      let shown = await lines(scope);
      const at = start => shown.find(l => l.text.includes(start));
      assert.equal(at('컴퓨터').mark, '•', `${label}: a list right under a paragraph shows a bullet`); assert.ok(!at('컴퓨터').text.startsWith('- '), `${label}: no hyphen shown`);
      assert.equal(at('첫째').mark, '1.', `${label}: a number`); assert.equal(at('들여쓴').mark, '◦', `${label}: an indented item`);
      assert.equal(at('할 일').box, true, `${label}: a to-do item's box`); assert.ok(!at('할 일').text.includes('[ ]'), `${label}: no [ ] shown`);
      assert.ok(shown.some(l => l.text === '질문'), `${label}: the heading as before`);
      // The cursor on the line: its source shows.
      await cursorAt(area, 2); shown = await lines(scope);
      assert.ok(shown.find(l => l.text.includes('컴퓨터')).text.startsWith('- '), `${label}: the source with the cursor on the line`);
    };
    await check('.memo-card.open .field-live', '.memo-card.open .note-box textarea', 'memo tab');
    if (process.env.APP_PHOTO_DIR) { await p.evaluate(() => { const ed = fieldEditorOf(document.querySelector('.memo-card.open .note-box textarea')); ed.view.dispatch({ selection: { anchor: 0 } }); }); await p.locator('.memo-card.open').screenshot({ path: path.join(process.env.APP_PHOTO_DIR, 'memo-list.png') }); }
    // The marker sits close to its text (as in the reading view), and a long item's next lines start under its first
    // letter, with or without the cursor on it.
    const A = '.memo-card.open .note-box textarea', ed = code => p.evaluate(([s, c]) => { const e = fieldEditorOf(document.querySelector(s)); return new Function('e', c)(e); }, [A, code]);
    const doc = () => ed('return e.view.state.doc.toString();');
    const put = (text, at) => p.evaluate(([s, t, a]) => { const e = fieldEditorOf(document.querySelector(s)); e.view.dispatch({ changes: { from: 0, to: e.view.state.doc.length, insert: t }, selection: { anchor: a ?? t.length } }); e.view.focus(); }, [A, text, at]);
    const LONG = '긴 항목은 줄이 넘어가도 둘째 줄이 글머리 뒤 첫 글자에 맞춰 들여 써져야 합니다 '.repeat(3).trim();
    await put('x\n- 가나다\n- ' + LONG, 0);
    const geometry = () => p.evaluate(() => {
      const lines = [...document.querySelectorAll('.memo-card.open .field-live .cm-line')], short = lines.find(l => l.textContent.includes('가나다')), long = lines.find(l => l.textContent.includes('긴 항목'));
      const textAfter = line => { const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT); let n; while ((n = walker.nextNode())) { if (n.parentElement.closest('.cm-list-mark')) continue; const i = n.data.search(/[^\s\-*+\[\]x0-9.)]/); if (i >= 0) return [n, i]; } return null; };
      const rect = (node, i, j = i + 1) => { const r = document.createRange(); r.setStart(node, i); r.setEnd(node, j); return r; };
      const mark = short.querySelector('.cm-list-mark'), markRight = mark ? rect(mark.firstChild, 0, mark.firstChild.length).getBoundingClientRect().right : null;
      const [sn, si] = textAfter(short), [ln, li] = textAfter(long), whole = rect(ln, li, ln.data.length).getClientRects();
      return { gap: markRight === null ? null : rect(sn, si).getBoundingClientRect().left - markRight, first: rect(ln, li).getBoundingClientRect().left, second: whole.length > 1 ? whole[whole.length - 1].left : null, rows: whole.length };
    });
    let g = await geometry();
    if (process.env.APP_PHOTO_DIR) await p.locator('.memo-card.open').screenshot({ path: path.join(process.env.APP_PHOTO_DIR, 'memo-list-wrapped.png') });
    assert.ok(g.gap !== null && g.gap <= 8, `the bullet sits close to its text (${g.gap}px)`);
    assert.ok(g.rows > 1 && Math.abs(g.second - g.first) <= 2, `a long item's next line starts under its first letter (${g.first} / ${g.second})`);
    await p.evaluate(s => { const e = fieldEditorOf(document.querySelector(s)); e.view.dispatch({ selection: { anchor: e.view.state.doc.length } }); }, A);
    const g2 = await geometry();
    if (process.env.APP_PHOTO_DIR) await p.locator('.memo-card.open').screenshot({ path: path.join(process.env.APP_PHOTO_DIR, 'memo-list-wrapped-source.png') });
    assert.ok(Math.abs(g2.second - g2.first) <= 2 && Math.abs(g2.first - g.first) <= 2, `with the cursor on it, the same places (${g2.first} / ${g2.second}, before ${g.first})`);
    // Enter in a list item: the next line starts as the same kind of item.
    const enter = async (text, at, expected, label) => { await put(text, at); await p.keyboard.press('Enter'); assert.equal(await doc(), expected, label); };
    await enter('- 가', null, '- 가\n- ', 'a bullet goes on'); await p.keyboard.type('나'); assert.equal(await doc(), '- 가\n- 나');
    await p.keyboard.press('Enter'); await p.keyboard.press('Enter'); assert.equal(await doc(), '- 가\n- 나\n', 'Enter on an empty item ends the list');
    await enter('1. 가', null, '1. 가\n2. ', 'the next number'); await enter('3) 가', null, '3) 가\n4) ', 'the same kind of number');
    await enter('- [x] 가', null, '- [x] 가\n- [ ] ', 'a to-do item, not done'); await enter('* 가', null, '* 가\n* ', 'the same bullet');
    await enter('  - 가', null, '  - 가\n  - ', 'an indented item keeps its indent'); await p.keyboard.press('Enter'); assert.equal(await doc(), '  - 가\n- ', 'an empty indented item comes out a level');
    await enter('- 가나', 3, '- 가\n- 나', 'Enter in the middle: the rest is the next item');
    await enter('1. 가\n2. 나', 4, '1. 가\n2. \n3. 나', 'the numbers after follow on');
    await enter('- 가', null, '- 가\n- ', 'again'); await p.keyboard.press('ControlOrMeta+z'); assert.equal(await doc(), '- 가', 'one Ctrl+Z undoes one Enter');
    await enter('보통 글', null, '보통 글\n', 'a plain line is a plain line');
    // With the cursor on a list line its source marker sits right before the text: one space apart, at the line's depth.
    const spacing = word => p.evaluate(w => {
      const line = [...document.querySelectorAll('.memo-card.open .field-live .cm-line')].find(l => l.textContent.includes(w));
      const chars = []; const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT); let n;
      while ((n = walker.nextNode())) for (let i = 0; i < n.data.length; i++) { const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + 1); chars.push({ c: n.data[i], rect: r.getBoundingClientRect() }); }
      const at = chars.findIndex((x, i) => line.textContent.slice(i).startsWith(w)); let last = at - 1; while (last >= 0 && /\s/.test(chars[last].c)) last--;
      const space = chars.slice(last + 1, at).find(x => x.c === ' ');
      return { gap: chars[at].rect.left - chars[last].rect.right, space: space ? space.rect.width : 0, marker: chars[last].rect.left, text: chars[at].rect.left };
    }, word);
    const SAMPLE = '- 가가\n  - 나나\n    - 다다\n1. 라라\n- [ ] 마마';
    for (const [n, word] of [[1, '가가'], [2, '나나'], [3, '다다'], [4, '라라'], [5, '마마']]) {
      await put(SAMPLE, 0); await p.evaluate(([s, k]) => { const e = fieldEditorOf(document.querySelector(s)); e.view.dispatch({ selection: { anchor: e.view.state.doc.line(k).to } }); }, [A, n]);
      const sp = await spacing(word); assert.ok(sp.gap <= sp.space + 2, `${word}: the marker sits one space before the text (${sp.gap}px, a space ${sp.space}px)`);
      if (n === 2) { await p.evaluate(s => { const e = fieldEditorOf(document.querySelector(s)); e.view.dispatch({ selection: { anchor: e.view.state.doc.line(2).to } }); }, A); const top = await spacing('가가'), own = await spacing('나나'); assert.ok(own.marker >= top.text - 2, `an indented item's marker is not left of the item above's text (${own.marker} / ${top.text})`); }
    }
    // A new item made with Enter and typed in at once: the same.
    await put('  - 가', null); await p.keyboard.press('Enter'); await p.keyboard.type('qwer');
    const typed = await spacing('qwer'); assert.ok(typed.gap <= typed.space + 2, `a new item typed in: one space (${typed.gap}px)`);
    if (process.env.APP_PHOTO_DIR) { await put(SAMPLE, 0); await p.evaluate(s => { const e = fieldEditorOf(document.querySelector(s)); e.view.dispatch({ selection: { anchor: e.view.state.doc.line(2).to } }); }, A); await p.locator('.memo-card.open').screenshot({ path: path.join(process.env.APP_PHOTO_DIR, 'memo-list-cursor-depth1.png') }); }
    await put('- 가', null); await p.keyboard.press('Tab'); assert.equal(await doc(), '  - 가', 'Tab: a level in'); await p.keyboard.press('Shift+Tab'); assert.equal(await doc(), '- 가', 'Shift+Tab: a level out');
    // A letter being composed (Korean) and then Enter: one marker, the letter whole.
    await put('- 가', null); const cdp = await p.context().newCDPSession(p);
    await cdp.send('Input.imeSetComposition', { text: '다', selectionStart: 1, selectionEnd: 1 }); await cdp.send('Input.insertText', { text: '다' });
    await p.keyboard.press('Enter'); assert.equal(await doc(), '- 가다\n- ', 'composition then Enter');
    // Folded: the memo reads as a list.
    await set('.memo-card.open .note-box textarea', 0); await p.evaluate(() => desktopNotes());
    const html = await p.evaluate(() => renderMarkdown(notes[Object.keys(notes).find(k => /-메모/.test(k) && !k.includes('#'))]));
    assert.match(html, /<ul><li>컴퓨터 사이언스/); assert.match(html, /<ol><li>첫째<ul><li>들여쓴 항목/);
    // A notebook's memo card: the same editor, the same lists.
    await p.locator('[data-mode="notebook"]').click(); await p.locator('.notebook-pane [data-action="nb-new"]').first().click();
    await p.locator('#nb-title').fill('목록 노트'); await p.locator('#dialog [data-action="nb-create"]').click(); await p.locator('.nb-page').first().waitFor();
    await (await toolShown(p, '.notebook-pane [data-action="nb-memo"]')).click(); await p.locator('.nb-memo-menu [data-action="nb-memo-create"]').click();
    await p.locator('.nb-memo-card.open .field-live .cm-content').waitFor();
    await check('.nb-memo-card.open .field-live', '.nb-memo-card.open .note-box textarea', 'notebook card');
    await app.close(); app = null;
    console.log('Memo list smoke passed: bullets right under a paragraph, numbers, indented and to-do items show as marks unless the cursor is on the line, in the memo tab and a notebook card; folded, a <ul><li>.');
  } catch (error) { console.error(error); process.exitCode = 1; try { await (await app?.firstWindow())?.screenshot({ path: path.join(os.tmpdir(), `${appName.id}-memo-list-failure.png`) }); } catch {} }
  finally { await app?.close().catch(() => {}); await fs.rm(temp, { recursive: true, force: true }); }
})();
