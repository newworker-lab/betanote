// End-to-end check of pictures in a memo's live editor (desktop/live-editor.mjs, notes.js, renderer.js 그림 설명):
// a memo that starts with a picture shows the picture, not its ![…](note-image:…) source, wherever it is opened (the memo
// tab, the wide editor, the memo's own window, a notebook card, the 주석 tab) even before anyone clicks in it; a memo that
// is only a picture opens with the cursor under it, typing goes in under it, and closed without typing it is saved as it
// was; a pasted picture and a 그림 설명 saved with its picture show at once with the cursor under them; the cursor moved
// onto the picture's line shows its source to edit. APP_TEST_SOURCE=1 runs the source; APP_PHOTO_DIR keeps pictures.
const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { PDFDocument, StandardFonts } = require('pdf-lib');
const appName = require('../core/app-name.cjs');
const root = path.resolve(__dirname, '..');
(async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), `${appName.id}-memo-picture-e2e-`)), vault = path.join(temp, 'vault'); await fs.mkdir(vault);
  const doc = await PDFDocument.create(), font = await doc.embedFont(StandardFonts.Helvetica); doc.addPage([600, 800]).drawText('A research paper.', { x: 40, y: 740, size: 14, font });
  await fs.writeFile(path.join(temp, 'paper.pdf'), await doc.save());
  const env = /utf-?8/i.test(process.env.LC_ALL || process.env.LANG || '') ? process.env : { ...process.env, LC_ALL: 'C.UTF-8', LANG: 'C.UTF-8' };
  const photo = async (locator, name) => { if (process.env.APP_PHOTO_DIR) await locator.screenshot({ path: path.join(process.env.APP_PHOTO_DIR, name) }); };
  let app;
  try {
    app = await electron.launch({ env: { ...env, APP_UI_LANG: 'ko' }, executablePath: require('./app-executable.cjs')(root), args: [...(process.env.APP_TEST_SOURCE === '1' ? [root] : []), '--no-sandbox', '--ozone-platform=headless', '--disable-gpu', `--user-data-dir=${path.join(temp, 'profile')}`], timeout: 20000 });
    const p = await app.firstWindow(); p.setDefaultTimeout(15000); await p.setViewportSize({ width: 1400, height: 950 });
    p.on('pageerror', e => { console.error(e); process.exitCode = 1; });
    await app.evaluate(({ dialog }) => { globalThis.openQueue = []; dialog.showOpenDialog = async () => ({ canceled: false, filePaths: globalThis.openQueue.shift() }); });
    await app.evaluate((_, v) => globalThis.openQueue.push([v]), vault); await p.locator('[data-action="storage"]').first().click();
    await app.evaluate((_, f) => globalThis.openQueue.push([f]), path.join(temp, 'paper.pdf')); await p.locator('[data-action="add-files"]').first().click();
    await p.locator('.paper-item').first().click(); await p.locator('.original-pages .page[data-page="1"] canvas').first().waitFor();
    // A 160×80 picture of two colours, made in the page.
    const PNG = await p.evaluate(() => { const c = document.createElement('canvas'); c.width = 160; c.height = 80; const g = c.getContext('2d'); g.fillStyle = '#1b64da'; g.fillRect(0, 0, 160, 80); g.fillStyle = '#ffd400'; g.fillRect(20, 20, 60, 40); return c.toDataURL('image/png').split(',')[1]; });
    const name = await p.evaluate(png => window.appApi.saveNoteImage(state.storageKey, `data:image/png;base64,${png}`), PNG);
    const PICTURE = `![그림](note-image:${name})`, WITH_TEXT = `${PICTURE}\n\n그림 아래 글`;
    // In a window: is the picture drawn (and loaded), is its source showing, where is the cursor.
    const look = (page, scope) => page.evaluate(s => {
      const host = document.querySelector(s); if (!host) return null; const img = host.querySelector('.cm-image img');
      return { img: !!img && img.complete && img.naturalWidth > 0, source: [...host.querySelectorAll('.cm-line')].some(l => l.textContent.includes('![')) };
    }, scope);
    const shows = async (page, scope, label) => { await page.waitForFunction(s => document.querySelector(`${s} .cm-content`), scope); await page.waitForTimeout(150); assert.deepEqual(await look(page, scope), { img: true, source: false }, `${label}: the picture shows, not its source`); };
    const memoKey = () => p.evaluate(() => document.querySelector('.memo-card.open')?.dataset.memo);
    const tab = '.memo-card.open .field-live', editorOf = 'fieldEditorOf(document.querySelector(".memo-card.open .note-box textarea"))';
    const docOf = (page, ed) => page.evaluate(e => new Function(`return ${e}`)().view.state.doc.toString(), ed);

    // 1. The memo tab: a memo starting with a picture, its card open but not clicked in (it was open when its text came).
    await p.locator('[data-tab="메모"]').first().click().catch(() => {});
    await p.locator('.memo-tab [data-action="memo-new"]').first().click(); await p.locator(`${tab} .cm-content`).waitFor();
    const key = await memoKey();
    await p.evaluate(([k, t]) => { notes[k] = t; refreshMemos(); }, [key, WITH_TEXT]); await p.evaluate(() => document.activeElement?.blur());
    await shows(p, tab, 'memo tab, open card');
    // Opened by a click on the card.
    await p.evaluate(() => { openMemoKey = null; refreshMemos(); }); await p.locator(`.memo-card[data-memo="${key}"]`).click(); await shows(p, tab, 'memo tab, opened');
    await photo(p.locator('.memo-card.open'), 'memo-picture-tab.png');

    // 2. A memo that is only a picture: opened, the cursor is under it; typing goes there; closed untouched, it is kept as it was.
    await p.evaluate(([k, t]) => { notes[k] = t; openMemoKey = null; refreshMemos(); }, [key, PICTURE]); await p.locator(`.memo-card[data-memo="${key}"]`).click();
    await shows(p, tab, 'picture-only memo, opened');
    await p.evaluate(() => { openMemoKey = null; refreshMemos(); }); await p.waitForTimeout(900);
    assert.equal(await p.evaluate(k => notes[k], key), PICTURE, 'opened and closed without typing: saved as it was');
    await p.locator(`.memo-card[data-memo="${key}"]`).click(); await shows(p, tab, 'picture-only memo, opened again');
    await p.keyboard.type('아래 글'); await shows(p, tab, 'typing under the picture');
    assert.equal(await docOf(p, editorOf), `${PICTURE}\n아래 글`, 'what is typed goes in under the picture');
    // The cursor taken onto the picture's line (arrow up): its source shows, to edit.
    await p.keyboard.press('ArrowUp'); await p.waitForTimeout(100);
    assert.equal((await look(p, tab)).source, true, 'the cursor on the picture line shows its source');
    await p.keyboard.press('Control+End'); await shows(p, tab, 'the cursor back under it');

    // 3. The wide editor and the memo's own window, opened on a memo starting with a picture.
    await p.evaluate(([k, t]) => { notes[k] = t; fieldEditorOf(document.querySelector('.memo-card.open .note-box textarea')).setDoc(t); }, [key, WITH_TEXT]);
    await p.locator('.memo-card.open [data-memo-wide]').first().click(); await p.locator('.note-editor-body').waitFor();
    if (await p.locator('.note-editor-body').getAttribute('data-view') !== 'live') await p.locator('[data-md-view="live"]').first().click();
    await shows(p, '.note-editor-body .md-live', 'wide editor'); await photo(p.locator('.note-editor-body'), 'memo-picture-wide.png');
    const [child] = await Promise.all([app.waitForEvent('window'), p.locator('[data-editor-window]').first().click()]);
    await shows(child, '.md-live', 'memo window'); await child.close(); await p.evaluate(() => dialog.close());

    // 4. A picture pasted into an empty memo: shown at once, the cursor under it.
    await p.locator('.memo-tab [data-action="memo-new"]').first().click(); await p.locator(`${tab} .cm-content`).waitFor(); await p.locator(`${tab} .cm-content`).click();
    await p.evaluate(png => { const bytes = Uint8Array.from(atob(png), c => c.charCodeAt(0)), data = new DataTransfer(); data.items.add(new File([bytes], 'p.png', { type: 'image/png' }));
      document.querySelector('.memo-card.open .field-live .cm-content').dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true })); }, PNG);
    await p.waitForFunction(s => document.querySelector(`${s} .cm-image img`)?.complete, tab); await shows(p, tab, 'pasted picture');
    await p.keyboard.type('붙인 그림 설명'); assert.match(await docOf(p, editorOf), /^!\[[^\]]*\]\(note-image:[0-9a-f]{32}\.png\)\n붙인 그림 설명$/, 'typed under the pasted picture');

    // 5. A 그림 설명 saved with its picture (an annotation): shown in the 주석 tab with the cursor at its end.
    const id = await p.evaluate(async t => {
      const paper = selected(), at = activeAttachment(paper), hash = await window.appApi.originalHash(state.storageKey, paper.id, at?.id);
      const snapshot = await window.appApi.addAnnotation(state.storageKey, paper.id, at?.id, { page: 1, body: t, sourceHash: hash, kind: 'figure', model: 'm', figure: { x: .1, y: .1, width: .3, height: .2 } });
      applyAnnotations(snapshot, '주석'); // i18n:keep — tab value
      const added = itemAnnotations.find(a => a.kind === 'figure'); globalThis.appShowAnnotation(added.id, { focus: true }); return added.id; // as 그림 설명 saves it
    }, `![그림 1](note-image:${name})\n\n그림 설명 글`);
    const card = `[data-annotation-card="${id}"] .field-live`;
    await shows(p, card, '그림 설명 in the 주석 tab'); await photo(p.locator(`[data-annotation-card="${id}"]`), 'memo-picture-annotation.png');
    assert.ok(await p.evaluate(s => document.querySelector(s).contains(document.activeElement), card), 'the 그림 설명 is ready to type in');

    // 6. A notebook card of the memo.
    await p.locator('[data-mode="notebook"]').click(); await p.locator('.notebook-pane [data-action="nb-new"]').first().click();
    await p.locator('#nb-title').fill('그림 노트'); await p.locator('#dialog [data-action="nb-create"]').click(); await p.locator('.nb-page').first().waitFor();
    await p.evaluate(k => { nbChange('메모 넣기', () => nb.doc.pages[0].items.push({ id: nbId(), type: 'memo', x: 40, y: 40, w: 320, h: 240, key: k, title: '' })); nbRender(); }, key); // i18n:keep — the undo label
    await p.locator('.nb-memo-card').first().click(); await shows(p, '.nb-memo-card.open .field-live', 'notebook card');
    await app.close(); app = null;
    console.log('Memo picture smoke passed: a memo starting with a picture shows it (memo tab open and opened, wide editor, memo window, notebook card, 주석 tab); a picture-only memo opens with the cursor under it and closed untouched is kept as it was; typing and a pasted picture go in under the picture; the picture line shows its source with the cursor on it.');
  } catch (error) { console.error(error); process.exitCode = 1; try { await (await app?.firstWindow())?.screenshot({ path: path.join(os.tmpdir(), `${appName.id}-memo-picture-failure.png`) }); } catch {} }
  finally { await app?.close().catch(() => {}); await fs.rm(temp, { recursive: true, force: true }); }
})();
