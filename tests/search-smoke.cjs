// End-to-end check of the search box over what is written in papers (renderer.js/library.js search, desktop/content-index.cjs):
// two papers, each with its own words in a memo, an annotation, a text box on a PDF page and a notebook's text box; each
// word finds its paper alone, with the place under the row (its kind, page and the words around it); a place opens the
// paper there (the memo opened with the word chosen, the annotation, the text box's page with the box outlined in view,
// the notebook at that page with the box in view); a text box changed is found by its new words at once, also after a
// restart; a paper in the trash is not found. Opening a vault of 300 papers is timed against SEARCH_OPEN_MS.
// APP_TEST_SOURCE=1 runs the source; APP_PHOTO_DIR keeps pictures.
const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { PDFDocument, StandardFonts } = require('pdf-lib');
const appName = require('../core/app-name.cjs');
const root = path.resolve(__dirname, '..');
const geometry = { view: [0, 0, 600, 800], rotate: 0, userUnit: 1 };
(async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), `${appName.id}-search-e2e-`)), vault = path.join(temp, 'vault'); await fs.mkdir(vault);
  for (const [name, pages] of [['alpha', 6], ['beta', 3]]) { const doc = await PDFDocument.create(), font = await doc.embedFont(StandardFonts.Helvetica); for (let i = 1; i <= pages; i++) doc.addPage([600, 800]).drawText(`${name} page ${i}`, { x: 40, y: 740, size: 14, font }); await fs.writeFile(path.join(vault, name + '.pdf'), await doc.save()); }
  const env = /utf-?8/i.test(process.env.LC_ALL || process.env.LANG || '') ? process.env : { ...process.env, LC_ALL: 'C.UTF-8', LANG: 'C.UTF-8' };
  const photo = async (p, name) => { if (process.env.APP_PHOTO_DIR) await p.screenshot({ path: path.join(process.env.APP_PHOTO_DIR, name) }); };
  let app;
  const launch = async (lang = 'ko', width = 1400, profile = 'profile') => {
    app = await electron.launch({ env: { ...env, APP_UI_LANG: lang }, executablePath: require('./app-executable.cjs')(root), args: [...(process.env.APP_TEST_SOURCE === '1' ? [root] : []), '--no-sandbox', '--ozone-platform=headless', '--disable-gpu', `--user-data-dir=${path.join(temp, profile)}`], timeout: 20000 });
    const p = await app.firstWindow(); p.setDefaultTimeout(15000); await p.setViewportSize({ width, height: 900 });
    p.on('pageerror', e => { console.error(e); process.exitCode = 1; });
    await app.evaluate(({ dialog }) => { globalThis.openQueue = []; dialog.showOpenDialog = async () => ({ canceled: false, filePaths: globalThis.openQueue.shift() }); });
    return p;
  };
  const search = async (p, word) => { await p.evaluate(() => { if (state.screen !== 'library') { state.screen = 'library'; render(); } }); await p.locator('#search').fill(word); await p.keyboard.press('Enter'); await p.waitForFunction(w => state.query === w, word); };
  const titles = p => p.locator('#paper-list .paper-item h3').allTextContents();
  const hitLines = p => p.locator('#paper-list .content-hit').evaluateAll(list => list.map(b => ({ kind: b.querySelector('.content-hit-kind').textContent, text: b.querySelector('.content-hit-text').textContent, mark: b.querySelector('mark')?.textContent })));
  try {
    let p = await launch();
    await app.evaluate((_, v) => globalThis.openQueue.push([v]), vault); await p.locator('[data-action="storage"]').first().click();
    await p.locator('.paper-item').nth(1).waitFor();
    // Each paper's own words: a memo, an annotation, a text box on a page, a notebook's text box.
    const ids = await p.evaluate(async geometry => {
      const by = n => papers.find(x => x.title.includes(n)), out = {};
      for (const [name, words] of [['alpha', { memo: '메모낱말', note: '주석낱말', box: '상자낱말', nb: '노트낱말', page: 3 }], ['beta', { memo: '베타메모', note: '베타주석', box: '다른상자', nb: '베타노트', page: 2 }]]) {
        const paper = by(name), a = paper.attachments[0], vault = state.storageKey, hash = await window.appApi.originalHash(vault, paper.id, a.id);
        notes[`${paper.id}-메모`] = `앞의 글 ${words.memo} 뒤의 글`; await desktopNotes();
        await window.appApi.addAnnotation(vault, paper.id, a.id, { page: 2, body: `주석 앞 ${words.note} 주석 뒤`, sourceHash: hash });
        await window.appApi.inkApply(vault, paper.id, a.id, 'original', [{ type: 'add', stroke: { id: 'stroke-' + name.padEnd(8, '0'), page: words.page - 1, tool: 'text', color: '#1f2937', width: 16, points: [100, 400, 0, 0], text: `상자 앞 ${words.box} 상자 뒤` }, geometry }]);
        const notebook = await window.appApi.notebookCreate(vault, `${name} 노트`, paper.id);
        notebook.pages.push({ ...notebook.pages[0], id: 'page-' + name.padEnd(8, '0').slice(0, 8), items: [{ id: 'item-' + name.padEnd(8, '0').slice(0, 8), type: 'text', x: 60, y: 500, w: 240, h: 40, text: `노트 앞 ${words.nb} 노트 뒤` }], strokes: [] });
        await window.appApi.notebookSave(vault, notebook);
        out[name] = { id: paper.id, attachmentId: a.id, notebookId: notebook.id };
      }
      applySnapshot(await window.appApi.refreshStorage(state.storageKey)); render(); return out;
    }, geometry);
    await p.waitForFunction(() => [...contentSearchParts.values()].flat().length >= 4);
    // 1. Each word: its paper alone, with the place.
    const expect = { 메모낱말: '메모 · ', 주석낱말: '주석 2쪽', 상자낱말: '텍스트 상자 3쪽', 노트낱말: '노트북 ‘alpha 노트’ 2쪽' };
    for (const [word, kind] of Object.entries(expect)) {
      await search(p, word); assert.deepEqual(await titles(p), ['alpha'], `${word}: alpha alone`);
      const lines = await hitLines(p); assert.equal(lines.length, 1, `${word}: one place`); assert.ok(lines[0].kind.startsWith(kind), `${word}: ${lines[0].kind}`);
      assert.equal(lines[0].mark, word); assert.ok(/앞 .*뒤|앞의 글/.test(lines[0].text), `${word}: the words around it (${lines[0].text})`);
    }
    await search(p, '다른상자'); assert.deepEqual(await titles(p), ['beta']);
    await search(p, '상자낱말'.normalize('NFD')); assert.deepEqual(await titles(p), ['alpha'], 'a decomposed query is found');
    await search(p, '낱말'); assert.equal((await hitLines(p)).length, 3, 'three shown'); assert.match(await p.locator('.content-hits-more').textContent(), /외 1곳/);
    await photo(p, 'search-hits.png');
    await p.locator('.content-hits-more').click(); assert.equal((await hitLines(p)).length, 4, 'all four when opened');
    // 2. A place opens the paper there.
    const open = async (word, kind) => { await search(p, word); await p.locator('#paper-list .content-hit').filter({ hasText: kind }).first().click(); };
    await open('메모낱말', '메모');
    await p.waitForFunction(() => { const ed = fieldEditorOf(document.querySelector('.memo-card.open .note-box textarea')); return ed && ed.view.state.sliceDoc(ed.view.state.selection.main.from, ed.view.state.selection.main.to) === '메모낱말'; });
    assert.ok(await p.evaluate(() => state.screen === 'reader' && state.tab === '메모'), 'the memo tab of the paper'); // i18n:keep — tab value
    await photo(p, 'search-open-memo.png');
    await open('주석낱말', '주석'); await p.waitForFunction(() => document.querySelector('.annotation.open') && state.tab === '주석'); // i18n:keep — tab value
    await p.waitForFunction(() => Number(document.querySelector('.original-pane .page-input, .original-pane input[type="number"]')?.value || 0) === 2 || document.querySelector('.original-pages [data-page-number="2"]'));
    await open('상자낱말', '텍스트 상자');
    const flash = p.locator('.original-pages .page[data-page-number="3"] .ink-search-flash'); await flash.waitFor();
    await p.waitForFunction(() => { const n = document.querySelector('.original-pages .ink-search-flash'); if (!n) return false; const r = n.getBoundingClientRect(), pane = n.closest('.original-pages').getBoundingClientRect(); return r.top >= pane.top && r.bottom <= pane.bottom; }, null, { timeout: 4000 }); // the box is in view in its pane
    assert.deepEqual(await p.evaluate(() => [...document.querySelectorAll('.main, .reader-layout, .pdf-pane')].filter(n => n.scrollTop || n.scrollLeft).length), 0, 'only the pane scrolled');
    await photo(p, 'search-open-textbox.png');
    await open('노트낱말', '노트북');
    const item = p.locator(`.nb-page [data-item-id="item-alpha000"]`); await item.waitFor();
    await p.waitForFunction(id => nb.doc?.id === id, ids.alpha.notebookId);
    await p.waitForFunction(() => { const n = document.querySelector('.nb-page [data-item-id="item-alpha000"]'); if (!n) return false; const r = n.getBoundingClientRect(), pane = n.closest('.nb-pages').getBoundingClientRect(); return r.top >= pane.top && r.bottom <= pane.bottom; }, null, { timeout: 4000 }); // the notebook box comes into view
    await photo(p, 'search-open-notebook.png');
    // 3. A text box changed: found by its new words at once.
    await p.evaluate(async ({ id, attachmentId }) => { await window.appApi.inkApply(state.storageKey, id, attachmentId, 'original', [{ type: 'delete', ids: ['stroke-alpha000'] }, { type: 'add', stroke: { id: 'stroke-alpha001', page: 2, tool: 'text', color: '#1f2937', width: 16, points: [100, 400, 0, 0], text: '고친상자 글' }, geometry: { view: [0, 0, 600, 800], rotate: 0, userUnit: 1 } }]); }, ids.alpha);
    await p.waitForFunction(id => (contentSearchParts.get(id) || []).some(x => x.text === '고친상자 글'), ids.alpha.id, { timeout: 3000 });
    await search(p, '고친상자'); assert.deepEqual(await titles(p), ['alpha']); await search(p, '상자낱말'); assert.deepEqual(await titles(p), [], 'the old words are gone');
    // Search parts arriving while the vault manager is open, with words typed in it: nothing there is drawn again.
    await p.evaluate(() => showVaultManager()); await p.locator('#dialog[open] .vm-tabs').waitFor(); await p.locator('[data-vm-tab="ai"]').click();
    await p.locator('#ai-rules-text').fill('쓰는 중인 요청');
    await p.evaluate(async ({ id, attachmentId }) => { const before = contentSearchParts.get(id); await window.appApi.inkApply(state.storageKey, id, attachmentId, 'original', [{ type: 'add', stroke: { id: 'stroke-alpha002', page: 1, tool: 'text', color: '#1f2937', width: 16, points: [100, 300, 0, 0], text: '열린창상자' }, geometry: { view: [0, 0, 600, 800], rotate: 0, userUnit: 1 } }]); }, ids.alpha);
    await p.waitForFunction(id => (contentSearchParts.get(id) || []).some(x => x.text === '열린창상자'), ids.alpha.id, { timeout: 3000 });
    assert.deepEqual(await p.evaluate(() => ({ open: dialog.open, wide: dialog.classList.contains('vault-manager'), tab: document.querySelector('[data-vm-tab][aria-selected="true"]')?.dataset.vmTab, text: document.querySelector('#ai-rules-text')?.value, focus: document.activeElement?.id })), { open: true, wide: true, tab: 'ai', text: '쓰는 중인 요청', focus: 'ai-rules-text' }, 'the vault manager stays as it was');
    await p.evaluate(() => dialog.close());
    // 4. A paper in the trash: not found.
    await p.evaluate(id => window.appApi.trashPaper(state.storageKey, id), ids.beta.id);
    await app.close();
    // 5. After a restart.
    p = await launch(); await p.locator('.shell').waitFor(); await p.waitForFunction(() => document.body.dataset.contentSearch === 'ready');
    await search(p, '고친상자'); assert.deepEqual(await titles(p), ['alpha'], 'after a restart');
    await search(p, '노트낱말'); assert.deepEqual(await titles(p), ['alpha']);
    await search(p, '다른상자'); assert.deepEqual(await titles(p), [], 'a paper in the trash is not found');
    await app.close(); app = null;
    // 6. English at 800px: the places fit the row.
    p = await launch('en', 800); await p.locator('.shell').waitFor(); await p.waitForFunction(() => document.body.dataset.contentSearch === 'ready');
    await search(p, '노트낱말'); const line = p.locator('#paper-list .content-hit').first(); await line.waitFor();
    assert.match(await line.locator('.content-hit-kind').textContent(), /^Notebook ‘alpha 노트’ p\. 2$/);
    assert.ok(await line.evaluate(n => n.getBoundingClientRect().right <= n.closest('.paper-item').getBoundingClientRect().right + 1), 'fits the row at 800px');
    await photo(p, 'search-hits-en-800.png');
    await app.close(); app = null;
    // 7. A vault of 300 papers (100 with a text box, 50 with a notebook): the list shows as quickly as before the search
    // parts (about 0.3 s here before and after), and the parts follow within SEARCH_OPEN_MS.
    const big = path.join(temp, 'big'), src = path.join(temp, 'big-src'); await fs.mkdir(big); await fs.mkdir(src);
    { const { Library } = require('../desktop/storage.cjs'), { InkStore } = require('../desktop/ink.cjs'), { NotebookStore } = require('../desktop/notebook.cjs');
      const base = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n%%EOF'), files = [];
      for (let i = 0; i < 300; i++) { const f = path.join(src, `paper-${i}.pdf`); await fs.writeFile(f, Buffer.concat([base, Buffer.from(String(i))])); files.push(f); }
      const lib = await Library.open(big); lib.ink = new InkStore(lib); lib.notebooks = new NotebookStore(lib); const made = await lib.importFiles(files);
      for (let i = 0; i < 100; i++) await lib.ink.apply(made[i].paperId, made[i].attachmentId, 'original', [{ type: 'add', stroke: { id: 'stroke-' + String(i).padStart(8, '0'), page: 0, tool: 'text', color: '#1f2937', width: 16, points: [100, 700, 0, 0], text: '큰상자 ' + i }, geometry }]);
      for (let i = 0; i < 50; i++) { const n = await lib.notebooks.create('노트 ' + i, made[i].paperId); n.pages[0].items.push({ id: 'item-' + String(i).padStart(8, '0'), type: 'text', x: 40, y: 100, w: 200, h: 40, text: '큰노트 ' + i }); await lib.notebooks.save(n); } }
    const SEARCH_OPEN_MS = Number(process.env.SEARCH_OPEN_MS || 3000);
    p = await launch('ko', 1400, 'profile-big'); await app.evaluate((_, v) => globalThis.openQueue.push([v]), big); await p.locator('[data-action="storage"]').first().waitFor();
    const t0 = Date.now(); await p.locator('[data-action="storage"]').first().click();
    await p.waitForFunction(() => papers.length === 300 && document.querySelectorAll('.paper-item').length > 0, null, { timeout: 30000 }); const listMs = Date.now() - t0;
    await p.waitForFunction(() => document.body.dataset.contentSearch === 'ready' && [...contentSearchParts.values()].flat().length === 200, null, { timeout: 30000 }); const partsMs = Date.now() - t0;
    console.log(`300 papers: list ${listMs} ms, search parts ${partsMs} ms`);
    assert.ok(listMs < SEARCH_OPEN_MS && partsMs < SEARCH_OPEN_MS, `opening 300 papers (list ${listMs} ms, parts ${partsMs} ms) within ${SEARCH_OPEN_MS} ms`);
    await search(p, '큰노트 49'); assert.equal((await titles(p)).length, 1);
    await app.close(); app = null;
    console.log('Search smoke passed: a memo, an annotation, a PDF text box and a notebook box found by their words (their paper alone, the place with its kind, page and words around it; three shown, the rest on 외 n곳; decomposed Korean too); each place opened there (memo with the words chosen, annotation, text box outlined in view, notebook box in view; only the pane scrolled); a changed box found at once and after a restart; the places fit in English at 800px.');
  } catch (error) { console.error(error); process.exitCode = 1; try { await (await app?.firstWindow())?.screenshot({ path: path.join(os.tmpdir(), `${appName.id}-search-failure.png`) }); } catch {} }
  finally { await app?.close().catch(() => {}); await fs.rm(temp, { recursive: true, force: true }); }
})();
