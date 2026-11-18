// End-to-end check of K-05 in the real Electron app (APP_TEST_SOURCE=1 runs
process.env.APP_SHOW_HIDDEN_FEATURES = '1'; // collections are hidden in the product but still tested
// from source): BibTeX import with a report, structured editing, DOI lookup
// without overwriting, citation copying, nested collections, saved searches,
// batch edits, PDF full-text search, and the restored reading position.
const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { PDFDocument, StandardFonts } = require('pdf-lib');
const appName = require('../core/app-name.cjs');
const toolShown = require('./tool-row.cjs'); // a tool a narrow pane keeps under ⋯ is brought out before it is used
const root = path.resolve(__dirname, '..');
async function samplePdf(file, texts) { const doc = await PDFDocument.create(), font = await doc.embedFont(StandardFonts.Helvetica); for (const text of texts) doc.addPage([600, 800]).drawText(text, { x: 40, y: 740, size: 12, font }); await fs.writeFile(file, await doc.save()); }
(async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), `${appName.id}-library-e2e-`)), vault = path.join(temp, 'vault');
  await fs.mkdir(vault);
  // A paper citing [2], with its reference list on page 2.
  { const doc = await PDFDocument.create(), font = await doc.embedFont(StandardFonts.Helvetica), bold = await doc.embedFont(StandardFonts.HelveticaBold), lines = (page, list, y = 740) => list.forEach((t, i) => page.drawText(t, { x: 50, y: y - i * 14, size: 10, font }));
    const one = doc.addPage([600, 800]); one.drawText('Introduction', { x: 50, y: 760, size: 14, font: bold }); lines(one, ['Microbial growth curves vary between batches of the same culture.', 'Growth follows the earlier model [2] closely in all of our runs.', 'We compare both models on the same data in the next section.']);
    const two = doc.addPage([600, 800]); two.drawText('References', { x: 50, y: 760, size: 14, font: bold }); lines(two, ['[1] Lee J. First study of microbial cultures. J Proc Control. 2019.'], 740); lines(two, ['[2] Kim H. Second study on growth curves. Biotechnol J. 2020.'], 712);
    await fs.writeFile(path.join(temp, 'cited.pdf'), await doc.save()); }
  await samplePdf(path.join(temp, 'doi-paper.pdf'), ['Fed-batch monitoring study. https://doi.org/10.5555/auto.1']);
  // Without a printed DOI: one in the document information, a large-type title only, an arXiv stamp, and a title and authors in the metadata.
  async function described(file, { lines = [], big, info = {} }) { const doc = await PDFDocument.create(), font = await doc.embedFont(StandardFonts.Helvetica), page = doc.addPage([600, 800]); if (big) page.drawText(big, { x: 50, y: 720, size: 22, font }); lines.forEach((t, i) => page.drawText(t, { x: 50, y: 660 - i * 14, size: 10, font })); if (info.subject) doc.setSubject(info.subject); if (info.title) doc.setTitle(info.title); if (info.author) doc.setAuthor(info.author); await fs.writeFile(file, await doc.save()); }
  await described(path.join(temp, 'meta-doi.pdf'), { lines: ['A study whose DOI is only in its information.'], info: { subject: 'Journal of Reading, doi:10.5555/meta.1' } });
  await described(path.join(temp, 'title-only.pdf'), { big: 'Growth curves of fed-batch cultures', lines: ['Min Park, Bioprocess Lab', 'Abstract. We fit curves.'] });
  await described(path.join(temp, 'arxiv-paper.pdf'), { big: 'An arXiv preprint on layouts', lines: ['arXiv:2101.01234v2 [cs.CL] 3 Jan 2021'] });
  await described(path.join(temp, 'own-meta.pdf'), { big: 'Reading layouts', lines: ['No identifiers here.'], info: { title: 'A study of reading layouts in papers', author: 'Kim Minjun; Lee Jiwon' } });
  await samplePdf(path.join(temp, 'layout.pdf'), Array.from({ length: 6 }, (_, i) => i === 3 ? 'Page four mentions quantum annealing.' : `Plain page ${i + 1}.`));
  await fs.writeFile(path.join(temp, 'refs.bib'), `@article{doe2024,
  author = {Doe, Jane Ann and Kim, Min-Jun},
  title = {Learning layouts from papers},
  journal = {Journal of Reading}, volume = {12}, number = {3}, pages = {45--67}, year = {2024},
  doi = {10.1234/abc}, file = {files/1/a.pdf}, mendeley-tags = {x}
}
@book{who2020, author = {{World Health Organization}}, title = {Research methods}, publisher = {WHO Press}, year = {2020}}`);
  const executable = require('./app-executable.cjs')(root);
  const env = /utf-?8/i.test(process.env.LC_ALL || process.env.LANG || '') ? process.env : { ...process.env, LC_ALL: 'C.UTF-8', LANG: 'C.UTF-8' };
  let app;
  async function launch() {
    app = await electron.launch({ env, executablePath: executable, args: [...(process.env.APP_TEST_SOURCE === '1' ? [root] : []), '--no-sandbox', '--ozone-platform=headless', '--disable-gpu', `--user-data-dir=${path.join(temp, 'profile')}`], timeout: 20000 });
    const p = await app.firstWindow(); p.setDefaultTimeout(15000);
    p.on('pageerror', e => { console.error(e); process.exitCode = 1; }); p.on('console', m => { if (m.type() === 'error') console.error('renderer:', m.text()); });
    await app.evaluate(({ dialog, net, clipboard }) => {
      // The headless clipboard is a stub; record what the app writes to it.
      globalThis.copied = []; clipboard.write = data => globalThis.copied.push(data);
      globalThis.openQueue = []; globalThis.saveQueue = [];
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: globalThis.openQueue.shift() });
      // A bibliography file that names PDFs asks whether they come along: here, the bibliography only
      // (tests/bibliography-import-smoke.cjs covers the other answers).
      const ask = dialog.showMessageBox; dialog.showMessageBox = async (win, options) => options?.buttons?.includes('서지정보만') ? { response: 1 } : ask(win, options);
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: globalThis.saveQueue.shift() });
      const original = net.fetch.bind(net);
      // Crossref and DataCite stand-ins: a DOI record (arXiv DOIs are DataCite's), a title search, a DataCite record.
      const json = (body, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));
      globalThis.lookups = [];
      net.fetch = (url, options) => {
        const href = String(url); if (/^https:\/\/api\.(crossref|datacite)\.org\//.test(href)) globalThis.lookups.push(decodeURIComponent(href));
        if (href.startsWith('https://api.crossref.org/works/')) {
          const doi = decodeURIComponent(href.split('/works/')[1]); if (doi.startsWith('10.48550/')) return json({ status: 'error' }, 404);
          const meta = doi.startsWith('10.5555/meta.');
          return json({ message: { DOI: doi, type: 'journal-article', title: [meta ? `Metadata record ${doi.slice(-1)}` : 'Crossref title differs'], author: [{ given: 'Jane', family: 'Doe' }], published: { 'date-parts': [[2024, 5]] }, 'container-title': ['Journal of Reading'], volume: '12', issue: '3', page: '45-67', publisher: 'Crossref Publisher' } });
        }
        if (href.startsWith('https://api.crossref.org/works?')) {
          const query = new URL(href).searchParams.get('query.bibliographic') || '';
          // The first title search is told to wait (429): the app asks once more and the search still fills the item.
          if (!globalThis.refusedOnce) { globalThis.refusedOnce = true; return Promise.resolve(new Response('{}', { status: 429, headers: { 'Retry-After': '1' } })); }
          return json({ message: { items: /growth curves of fed-batch/i.test(query) ? [{ DOI: '10.5555/search.1', type: 'journal-article', title: ['Growth Curves of Fed-Batch Cultures'], author: [{ given: 'Min', family: 'Park' }], published: { 'date-parts': [[2021]] }, 'container-title': ['Bioprocess Journal'] }, { DOI: '10.5555/other', title: ['Growth curves of batch cultures in milk'], published: { 'date-parts': [[2010]] } }] : [] } });
        }
        if (href.startsWith('https://api.datacite.org/dois/')) return json({ data: { attributes: { titles: [{ title: 'An arXiv preprint on layouts' }], creators: [{ name: 'Choi, Ara', givenName: 'Ara', familyName: 'Choi' }], publicationYear: 2021, publisher: 'arXiv', types: { resourceTypeGeneral: 'Preprint' }, url: 'https://arxiv.org/abs/2101.01234' } } });
        return original(url, options);
      };
    });
    return p;
  }
  const open = paths => app.evaluate((_, paths) => globalThis.openQueue.push(paths), paths);
  try {
    let p = await launch();
    await open([vault]); await p.locator('[data-action="storage"]').first().click(); await p.locator('.library').waitFor();
    await open([path.join(temp, 'layout.pdf')]); await p.locator('[data-action="add-files"]').first().click(); await p.locator('.paper-item').waitFor();

    // Import BibTeX: report names what was not carried over.
    await p.locator('[data-action="vault-manager"]').click(); await p.locator('[data-vm-tab="bib"]').click(); await open([path.join(temp, 'refs.bib')]);
    await p.locator('[data-action="import-ris"]').click(); await p.locator('#dialog h2').filter({ hasText: '가져오기 결과' }).waitFor();
    const report = await p.locator('#dialog').textContent();
    assert.match(report, /2개 항목을 가져왔습니다/); assert.match(report, /BibTeX mendeley-tags 1개/); assert.match(report, /첨부파일 링크 1개/);
    await p.locator('#dialog [data-action="close"]').last().click();
    assert.equal(await p.locator('.paper-item').count(), 3);
    // The batch checkbox has its own column: the title keeps the wide text column.
    const row = await p.locator('.paper-item').first().evaluate(item => ({ columns: getComputedStyle(item).gridTemplateColumns.split(' ').length, title: item.querySelector('h3').getBoundingClientRect().width, row: item.getBoundingClientRect().width, height: item.getBoundingClientRect().height, star: item.querySelector('.star').getBoundingClientRect().top - item.getBoundingClientRect().top }));
    assert.equal(row.columns, 4); assert.ok(row.title > row.row * .5, JSON.stringify(row)); assert.ok(row.height < 200 && row.star < 60, JSON.stringify(row));

    // Structured record and citation copy.
    await p.locator('.paper-item').filter({ hasText: 'Learning layouts' }).click();
    assert.match(await p.locator('.detail .bibliography').textContent(), /Jane Ann Doe; Min-Jun Kim.*Journal of Reading.*12 \(3\).*45–67/s);
    await p.locator('.detail [data-action="cite-paper"]').click(); await p.locator('#cite-reference p').waitFor();
    assert.equal(await p.locator('#cite-reference').textContent(), 'Doe, J. A., & Kim, M.-J. (2024). Learning layouts from papers. Journal of Reading, 12(3), 45–67. https://doi.org/10.1234/abc');
    await p.locator('#cite-locator').fill('50'); await p.locator('#cite-intext').filter({ hasText: '(Doe & Kim, 2024, p. 50)' }).waitFor();
    await p.locator('[data-action="copy-reference"]').click(); await p.locator('#toast').filter({ hasText: '참고문헌을 복사했습니다' }).waitFor();
    const copied = await app.evaluate(() => globalThis.copied.at(-1)); assert.match(copied.html, /<i>Journal of Reading<\/i>/); assert.match(copied.text, /^Doe, J\. A\./);
    await p.locator('#cite-style').selectOption('vancouver'); await p.locator('#cite-reference').filter({ hasText: '1. Doe JA, Kim MJ.' }).waitFor();
    await p.locator('#dialog [data-action="close"]').last().click();

    // DOI lookup fills blanks and lists differences without overwriting.
    await p.locator('.detail [data-action="edit-bibliography"]').click();
    await p.locator('#bib-publisher').fill(''); await p.locator('[data-action="lookup-doi"]').click(); await p.locator('.doi-conflict').first().waitFor();
    assert.equal(await p.locator('#bib-title').inputValue(), 'Learning layouts from papers');
    assert.equal(await p.locator('#bib-publisher').inputValue(), 'Crossref Publisher');
    assert.match(await p.locator('#doi-conflicts').textContent(), /제목.*Crossref title differs/);
    await p.locator('#bib-creators').fill('Doe, Jane Ann\nKim, Min-Jun\n세계보건기구'); await p.locator('#bib-citekey').fill('doe-layouts');
    await p.locator('#dialog [data-action="save-bibliography"]').click(); await p.locator('#dialog').waitFor({ state: 'hidden' });
    assert.match(await p.locator('.detail .bibliography').textContent(), /세계보건기구.*doe-layouts/s);

    // Nested collections: a parent shows its child's papers.
    await p.locator('[data-action="toggle-collections"]').click(); await p.locator('[data-section-toggle="collections"]').waitFor();
    for (const [name, parent] of [['연구', ''], ['방법', '연구']]) {
      await p.locator('[data-action="new-collection"]').click(); await p.locator('#collection-name').fill(name);
      if (parent) await p.locator('#collection-parent').selectOption({ label: parent });
      await p.locator('#dialog [data-action="create-collection"]').click(); await p.locator(`[data-item-collection]`).filter({ hasText: name }).waitFor();
    }
    await p.locator('[data-nav="전체 자료"]').click();
    await p.locator('[data-batch-paper]').nth(1).check(); await p.locator('[data-batch-paper]').nth(2).check(); await p.locator('.batch-bar').filter({ hasText: '2개 선택' }).waitFor();
    await p.locator('#batch-collection').selectOption({ label: '연구 / 방법' }); await p.locator('#toast').filter({ hasText: '컬렉션에 추가' }).waitFor();
    await p.locator('#batch-status').selectOption('완독'); await p.locator('#toast').filter({ hasText: '읽기 상태' }).waitFor();
    await p.locator('[data-item-collection]').filter({ hasText: '연구' }).first().click();
    assert.equal(await p.locator('.paper-item').count(), 2, 'the parent collection lists its sub-collection papers');

    // Typing lists results under the box without changing the list; Esc closes it, Enter applies.
    await p.locator('[data-nav="전체 자료"]').click(); const listed = await p.locator(".paper-item").count();
    await p.locator('#search').fill('methods'); await p.locator('#search-pop [data-search-hit]').filter({ hasText: 'Research methods' }).waitFor();
    assert.equal(await p.locator('.paper-item').count(), listed, 'typing alone does not filter the list');
    assert.match(await p.locator('#search-pop [data-search-all=""]').textContent(), /전체 검색/);
    await p.keyboard.press('Escape'); await p.locator('#search-pop').waitFor({ state: 'detached' });
    await p.locator('#search').fill('methodsx'); await p.locator('#search-pop .search-none').waitFor(); await p.locator('#search').fill('');
    await p.locator('#search').fill('methods'); await p.locator('#search-pop [data-search-all=""]').click(); await p.locator('.search-banner').filter({ hasText: 'methods' }).waitFor();
    assert.deepEqual(await p.locator('.paper-item h3').allTextContents(), ['Research methods']);
    await p.locator('[data-action="clear-search"]').click(); await p.locator('.search-banner').waitFor({ state: 'detached' }); assert.equal(await p.locator(".paper-item").count(), listed);
    // Saved search, then PDF full-text search by page.
    await p.locator('[data-nav="전체 자료"]').click(); await p.locator('#search').fill('methods');await p.locator('#search').press('Enter'); await p.locator('[data-action="save-search"]').click();
    await p.locator('#search-name').fill('WHO 자료'); await p.locator('[data-action="confirm-save-search"]').click(); await p.locator('[data-saved-search]').waitFor();
    await p.locator('#search').fill(''); await p.locator('[data-nav="전체 자료"]').click(); await p.locator('[data-saved-search]').click();
    assert.deepEqual(await p.locator('.paper-item h3').allTextContents(), ['Research methods']);
    // A saved search named like the app's own view (즐겨찾기) shows its own items, not the starred ones, and does not light up that view.
    await p.evaluate(async () => { applyItemSnapshot(await window.appApi.saveSearch(state.storageKey, { name: '즐겨찾기', query: '', filter: '전체', collectionId: null, tag: null, fullText: false }), { screen: 'library' }); });
    await p.locator('[data-saved-search]').filter({ hasText: '즐겨찾기' }).click(); await p.waitForFunction(() => state.savedSearch);
    assert.equal(await p.locator('.library h1').textContent(), '즐겨찾기'); assert.equal(await p.locator('.paper-item').count(), listed, 'every item, not the starred ones');
    assert.equal(await p.locator('[data-nav="즐겨찾기"].active').count(), 0, 'the Favorites view is not lit');
    // Deleting the saved search that is open leaves it for 전체 자료.
    const openSearch = await p.evaluate(() => state.savedSearch); await p.locator(`[data-delete-search="${openSearch}"]`).click();
    await p.waitForFunction(() => !savedSearches.some(x => x.name === '즐겨찾기')); assert.equal(await p.evaluate(() => state.savedSearch), null);
    assert.equal(await p.locator('.library h1').textContent(), '전체 자료'); assert.equal(await p.locator('.paper-item').count(), listed);
    // A saved search with a tag in it, deleted while open, leaves no part of its filter behind.
    const tagged = '검색태그'; await p.evaluate(async tag => { applyItemSnapshot(await window.appApi.batchUpdate(state.storageKey, [papers[0].id], { addTags: [tag] }), { screen: 'library' }); }, tagged);
    await p.evaluate(async tag => { applyItemSnapshot(await window.appApi.saveSearch(state.storageKey, { name: '태그 검색 저장', query: '', filter: '전체', collectionId: null, tag, fullText: false }), { screen: 'library' }); }, tagged);
    await p.locator('[data-saved-search]').filter({ hasText: '태그 검색 저장' }).click(); await p.waitForFunction(() => state.savedSearch && state.desktopTag);
    assert.ok(await p.locator('.paper-item').count() < listed || await p.evaluate(() => papers.every(x => x.tags.length)), 'the tag filters the list');
    await p.locator(`[data-delete-search="${await p.evaluate(() => state.savedSearch)}"]`).click(); await p.waitForFunction(() => !state.savedSearch);
    assert.deepEqual(await p.evaluate(() => [state.desktopTag, state.collection, state.query, state.filter, state.fullText]), [null, null, '', '전체', false]);
    assert.equal(await p.locator('.library h1').textContent(), '전체 자료'); assert.equal(await p.locator('.paper-item').count(), listed);
    await p.evaluate(async tag => { applyItemSnapshot((await window.appApi.tagDelete(state.storageKey, tag)).snapshot, { screen: 'library' }); }, tagged);
    await p.locator('[data-nav="전체 자료"]').click(); await p.locator('#fulltext-toggle').check(); await p.locator('#search').fill('quantum annealing');await p.locator('#search').press('Enter');
    await p.locator('.fulltext-hit').filter({ hasText: 'p.4' }).waitFor();
    assert.deepEqual(await p.locator('.paper-item h3').allTextContents(), ['layout']);
    await p.locator('#fulltext-toggle').uncheck(); await p.locator('#search').fill('');

    // The sidebar's views, as in VS Code: 파일, 태그, 컬렉션 in that order; folded ones go down (컬렉션 always last);
    // the handle between two opened views changes their heights, which stay; each view scrolls on its own.
    // Tags, one list for the vault: label · name · count rows, a menu for colour, rename (merge) and
    // delete (with undo), + to make one, papers dragged onto a tag, and 태그 지정 with 일부.
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1280, 900)); await p.waitForFunction(() => innerHeight > 800);
    await p.locator('.paper-item').filter({ hasText: 'Research methods' }).click();
    const newTags = ['RAG', '검색 증강', '실험 설계', '통계', '미생물', '배양', '발효', '단백질', '대사공학', '합성생물학', '항생제', '바이오리액터'];
    for (const tag of newTags) { await p.locator('.detail [data-tag-form] input').fill(tag); await p.locator('.detail [data-tag-form] input').press('Enter'); await p.locator(`.detail [data-remove-tag="${tag}"]`).waitFor(); }
    // Adding a tag beside the paper: the suggestions look like the sidebar (label · name · count), narrow as you type,
    // take ↓/Enter, offer a new name, and keep the box ready for the next tag.
    await p.locator('.paper-item').filter({ hasText: 'Learning layouts' }).click();
    const box = p.locator('.detail [data-tag-form] [name="tag"]'); await box.click(); await p.locator('.detail .tag-suggest:not([hidden])').waitFor();
    assert.ok(await p.locator('.detail .tag-suggest-item .tag-icon').count() >= newTags.length);
    assert.equal(await p.locator('.detail .tag-suggest').evaluate(n => getComputedStyle(n).fontFamily), await p.locator('.sidebar .nav-btn').first().evaluate(n => getComputedStyle(n).fontFamily), 'the app font, not the system list');
    await box.fill('생물'); assert.deepEqual(await p.locator('.detail .tag-suggest-item .tag-name').allTextContents(), ['미생물', '합성생물학', '“생물” 새 태그로 추가']);
    await box.press('ArrowDown'); await box.press('Enter'); await p.locator('.detail .tag-chip').filter({ hasText: '미생물' }).waitFor();
    await p.waitForFunction(() => document.activeElement?.matches('.detail [data-tag-form] [name="tag"]')); assert.equal(await box.inputValue(), '');
    await box.fill('  배양 '); await box.press('Enter'); await p.locator('.detail .tag-chip').filter({ hasText: '배양' }).waitFor();
    assert.deepEqual(await p.evaluate(() => papers.find(x => x.title.startsWith('Learning layouts')).tags.slice(-2)), ['미생물', '배양'], 'an existing name, not a twin');
    await p.locator('.detail [data-remove-tag="미생물"]').click(); await p.locator('.detail [data-remove-tag="배양"]').click(); await p.waitForFunction(() => !document.querySelector('.detail .tag-chip'));
    await p.locator('.paper-item').filter({ hasText: 'Research methods' }).click();
    const views = () => p.locator('.sidebar-views > .sidebar-view').evaluateAll(list => list.map(n => n.dataset.view + (n.classList.contains('open') ? '' : '(접힘)')));
    assert.deepEqual((await views()).filter(v => !v.startsWith('searches')), ['files', 'tags', 'collections']);
    const y = view => p.locator(`[data-view="${view}"]`).evaluate(n => n.getBoundingClientRect().top);
    await p.locator('[data-section-toggle="tags"]').click(); await p.locator('[data-view="tags"]:not(.open)').waitFor();
    assert.deepEqual((await views()).filter(v => !v.startsWith('searches')), ['files', 'tags(접힘)', 'collections'], 'a folded view goes down, above 컬렉션, which always stays last');
    assert.equal(await p.locator('[data-tag-row]').count(), 0); assert.ok(await y('tags') > await y('files') && await y('tags') < await y('collections'));
    const bottomOf = async view => { const b = await p.locator(`[data-view="${view}"]`).boundingBox(); return b.y + b.height; }, managerTop = async () => (await p.locator('#navigation-panel .sidebar-bottom').boundingBox()).y;
    assert.ok(Math.abs(await bottomOf('collections') - await managerTop()) < 2, '컬렉션 right above 저장소 관리');
    await p.locator('[data-section-toggle="files"]').click(); assert.deepEqual((await views()).filter(v => !v.startsWith('searches')), ['files(접힘)', 'tags(접힘)', 'collections']);
    await p.locator('[data-section-toggle="collections"]').click(); assert.ok(Math.abs(await bottomOf('collections') - await managerTop()) < 2, 'all folded: the headings sit at the bottom, 컬렉션 last');
    await p.locator('[data-section-toggle="collections"]').click(); await p.locator('[data-section-toggle="files"]').click(); await p.locator('[data-view="files"].open').waitFor();
    const filesTop = () => p.locator('[data-section-toggle="files"]').evaluate(n => n.getBoundingClientRect().top + document.querySelector('#navigation-panel').scrollTop), before = await filesTop();
    await p.locator('[data-section-toggle="tags"]').click(); await p.locator('#tag-search').waitFor();
    assert.equal(await filesTop(), before, 'opening a view moves nothing above it');
    assert.equal(await p.evaluate(() => document.activeElement.id), 'tag-search');
    const searchBox = await p.locator('#tag-search').boundingBox(), tagView = await p.locator('[data-view-body="tags"]').boundingBox();
    assert.ok(searchBox.x >= tagView.x && searchBox.x + searchBox.width <= tagView.x + tagView.width && await p.locator('#tag-search').evaluate(n => getComputedStyle(n).outlineStyle) === 'none', 'the focused search box stays inside the margins');
    assert.ok((await p.locator('[data-tag-row]').first().boundingBox()).height <= 26, 'compact tag rows');
    assert.deepEqual(await p.locator('[data-tag-row] .tag-name').allTextContents(), [...newTags].sort((a, b) => a.localeCompare(b, 'ko')));
    const icon = await p.locator('[data-tag-row] .tag-icon').first().boundingBox(); assert.ok(icon.width >= 13 && icon.width <= 16 && icon.height <= 12, 'a small label icon');
    // The handle above 태그 gives the tag view more room; the heights stay after a redraw.
    const tagsHeight = () => p.locator('[data-view="tags"]').evaluate(n => Math.round(n.getBoundingClientRect().height));
    const sash = await p.locator('.view-sash[data-sash$=":tags"]').boundingBox(), shortTags = await tagsHeight();
    await p.mouse.move(sash.x + 40, sash.y + 3); await p.mouse.down(); await p.mouse.move(sash.x + 40, sash.y - 60, { steps: 4 }); await p.mouse.up();
    const tallTags = await tagsHeight(); assert.ok(tallTags >= shortTags + 50, `${shortTags} → ${tallTags}`);
    await p.locator('[data-nav="즐겨찾기"]').click(); assert.ok(Math.abs(await tagsHeight() - tallTags) <= 2, 'kept after a redraw');
    await p.locator('.view-sash[data-sash$=":tags"]').focus(); await p.keyboard.press('ArrowDown'); assert.ok(await tagsHeight() < tallTags, 'the keyboard moves it too');
    await p.locator('[data-nav="전체 자료"]').click();
    // The tag view scrolls on its own and keeps its place when a tag is chosen or added.
    const tagBody = p.locator('[data-view-body="tags"]');
    assert.ok(await tagBody.evaluate(n => n.scrollHeight > n.clientHeight), 'many tags scroll inside the tag view');
    await tagBody.evaluate(n => { n.scrollTop = n.scrollHeight; });
    const bottom = await tagBody.evaluate(n => n.scrollTop); assert.ok(bottom > 0);
    await p.locator('[data-desktop-tag="항생제"]').click(); await p.locator('.library h1').filter({ hasText: '항생제' }).waitFor();
    assert.equal(await tagBody.evaluate(n => n.scrollTop), bottom, 'a tag click keeps the list where it was');
    await p.locator('[data-nav="전체 자료"]').click(); await p.locator('.paper-item').filter({ hasText: 'Research methods' }).click();
    await tagBody.evaluate(n => { n.scrollTop = 40; });
    await p.locator('.detail [data-tag-form] input').fill('후속 연구'); await p.locator('.detail [data-tag-form] input').press('Enter'); await p.locator('[data-tag-row="후속 연구"]').waitFor();
    assert.equal(await tagBody.evaluate(n => n.scrollTop), 40, 'adding a tag keeps the list where it was');
    // Search: typing narrows the list, Enter opens the first match, Escape clears.
    await p.locator('#tag-search').fill('생물'); assert.deepEqual(await p.locator('[data-tag-row]:visible .tag-name').allTextContents(), ['미생물', '합성생물학']);
    await p.locator('#tag-search').fill('없는 태그'); await p.locator('.tag-empty').waitFor();
    await p.locator('#tag-search').fill('생물'); await p.locator('#tag-search').press('Enter'); await p.locator('.library h1').filter({ hasText: '미생물' }).waitFor();
    assert.equal(await p.locator('#tag-search').inputValue(), '생물', 'the search stays after choosing');
    await p.locator('#tag-search').press('Escape'); assert.equal(await p.locator('[data-tag-row]:visible').count(), newTags.length + 1);
    // Colour from the ⋯ menu or a right-click: a palette, any #RRGGBB, colours in use, none.
    await p.locator('[data-tag-row="미생물"]').hover(); await p.locator('[data-tag-menu="미생물"]').click(); await p.locator('.tag-color-menu [data-set-tag-color="#30a46c"]').click();
    await p.locator('#notes-panel .tag-chip[data-color="#30a46c"]').filter({ hasText: '미생물' }).waitFor();
    await p.locator('[data-tag-row="발효"]').click({ button: 'right' }); await p.locator('.tag-color-menu').waitFor(); await p.keyboard.press('Escape'); assert.equal(await p.locator('.tag-color-menu').count(), 0);
    await p.locator('[data-tag-row="발효"]').click({ button: 'right' }); await p.locator('.tag-color-hex').fill('zzz'); await p.locator('.tag-color-hex').press('Enter');
    await p.locator('.tag-color-hex[aria-invalid="true"]').waitFor(); await p.locator('.tag-color-hex').fill('ff0'); await p.locator('[data-apply-tag-hex]').click();
    await p.locator('[data-tag-row="발효"] .tag-icon[data-color="#ffff00"]').waitFor();
    // A pale colour still gets readable chip text in both themes.
    // (a list-row chip of that tag, as the list draws it)
    const ink = await p.evaluate(() => { const box = document.createElement('div'); box.className = 'paper-item'; box.innerHTML = tagPill('발효'); document.body.append(box); const n = box.firstElementChild, s = n.getAttribute('style'), out = { color: n.dataset.color, light: /--tag-ink:(#[0-9a-f]{6})/.exec(s)[1], dark: /--tag-ink-dark:(#[0-9a-f]{6})/.exec(s)[1], shown: getComputedStyle(n).color }; box.remove(); return out; }); assert.equal(ink.color, '#ffff00');
    const lum = hex => { const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4); return .2126 * r + .7152 * g + .0722 * b; };
    const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + .05) / (y + .05); };
    assert.ok(ratio(ink.light, '#ffffd6') >= 4.5 && ratio(ink.dark, '#63631b') >= 4.5, JSON.stringify(ink)); assert.equal(ink.shown, 'rgb(' + [1, 3, 5].map(i => parseInt(ink.light.slice(i, i + 2), 16)).join(', ') + ')');
    await p.locator('[data-tag-row="통계"]').click({ button: 'right' }); await p.locator('.tag-menu-label').filter({ hasText: '사용 중인 색' }).waitFor();
    // The palette: two rows of five, brown 9th and grey last; a colour from outside it stays in the row of colours in use.
    const [palette, inUse] = await p.evaluate(() => [...document.querySelectorAll('.tag-color-menu .tag-menu-colors')].map(row => [...row.querySelectorAll('.tag-swatch')].map(b => [b.dataset.color, b.getAttribute('aria-label'), b.title])));
    assert.equal(palette.length, 10); assert.deepEqual(palette[8], ['#ad7f58', '갈색', '갈색']); assert.equal(palette[9][0], '#8b8d98');
    assert.deepEqual(palette.slice(5, 10).map(([c]) => c), ['#0588f0', '#8e4ec6', '#d6409f', '#ad7f58', '#8b8d98']);
    assert.ok(inUse.some(([c]) => c === '#ffff00') && !inUse.some(([c]) => c === '#ad7f58'), JSON.stringify(inUse));
    await p.locator('.tag-color-menu [data-set-tag-color="#ffff00"]').click();
    await p.locator('[data-tag-row="통계"] .tag-icon[data-color="#ffff00"]').waitFor();
    // Rename follows the tag being viewed; a name that exists merges after confirming.
    await p.locator('[data-tag-row="미생물"]').click({ button: 'right' }); await p.locator('[data-tag-action="rename"]').click();
    await p.locator('#tag-rename').fill('미생물학'); await p.locator('#tag-rename').press('Enter'); await p.locator('[data-tag-row="미생물학"] .tag-icon[data-color="#30a46c"]').waitFor();
    assert.equal(await p.locator('[data-tag-row="미생물"]').count(), 0); await p.locator('.library h1').filter({ hasText: '미생물학' }).waitFor();
    await p.locator('[data-tag-row="발효"]').click({ button: 'right' }); await p.locator('[data-tag-action="rename"]').click(); await p.locator('#tag-rename').fill('배양'); await p.locator('[data-action="rename-tag"]').click();
    await p.locator('#dialog h2').filter({ hasText: '태그 합치기' }).waitFor(); await p.locator('[data-action="confirm-tag-merge"]').click(); await p.locator('#toast').filter({ hasText: '“발효”를 “배양”에 합쳤습니다' }).waitFor();
    assert.equal(await p.locator('[data-tag-row="발효"]').count(), 0);
    // Delete tells how many papers lose it; the notice brings it back with its colour.
    await p.locator('[data-tag-row="통계"]').click({ button: 'right' }); await p.locator('[data-tag-action="delete"]').click();
    assert.match(await p.locator('#dialog').textContent(), /자료 1개에서 이 태그가 빠집니다/);
    await p.locator('[data-action="confirm-tag-delete"]').click(); await p.locator('.undo-toast').waitFor(); assert.equal(await p.locator('[data-tag-row="통계"]').count(), 0);
    await p.locator('.undo-toast button').click(); await p.locator('[data-tag-row="통계"] .tag-icon[data-color="#ffff00"]').waitFor();
    assert.ok((await p.evaluate(() => papers.find(x => x.title === 'Research methods').tags)).includes('통계'));
    // + makes a tag with no papers yet; dragging a paper onto it gives it the tag.
    if (await p.locator('[data-action="batch-clear"]').count()) await p.locator('[data-action="batch-clear"]').click();
    await p.locator('[data-action="new-tag"]').click(); await p.locator('#new-tag-name').fill('빈 태그'); await p.locator('#dialog [data-new-tag-color="#0588f0"]').click(); await p.locator('#new-tag-name').press('Enter');
    await p.waitForFunction(() => document.querySelector('[data-tag-row="빈 태그"] .count')?.textContent === '0');
    await p.locator('[data-action="new-tag"]').click(); await p.locator('#new-tag-name').fill(' 빈 태그 '); await p.locator('[data-action="create-tag"]').click(); await p.locator('#toast').filter({ hasText: '이미 있는 태그입니다: 빈 태그' }).waitFor(); await p.locator('#dialog [data-action="close"]').last().click();
    await p.locator('[data-nav="전체 자료"]').click();
    await p.locator('.paper-item').filter({ hasText: 'Learning layouts' }).dragTo(p.locator('[data-tag-drop="빈 태그"]')); await p.locator('#toast').filter({ hasText: '“빈 태그” 태그를 지정했습니다' }).waitFor();
    await p.waitForFunction(() => document.querySelector('[data-tag-row="빈 태그"] .count')?.textContent === '1');
    // A row shows three tags and +N; +N opens 태그 지정 without opening the paper.
    const more = p.locator('.paper-item').filter({ hasText: 'Research methods' }).locator('.tag-more-pill'); assert.match(await more.textContent(), /^\+\d+$/);
    await more.click(); await p.locator('#tag-assign-list').waitFor(); assert.equal(await p.evaluate(() => state.screen), 'library'); await p.locator('#dialog [data-action="close"]').last().click();
    // 태그 지정 for two checked papers: 일부 stays unless touched; checked adds, unchecked removes, a new name is made.
    for (const title of ['Research methods', 'Learning layouts']) await p.locator('.paper-item').filter({ hasText: title }).locator('[data-batch-paper]').check();
    await p.locator('.batch-bar [data-action="batch-tag"]').click(); await p.locator('#tag-assign-list').waitFor();
    assert.equal(await p.locator('[data-assign-tag="빈 태그"]').evaluate(n => n.indeterminate), true, 'a tag one of them has shows 일부');
    assert.equal(await p.locator('[data-assign-tag="통계"]').evaluate(n => n.indeterminate), true);
    await p.locator('[data-assign-tag="빈 태그"]').click(); await p.locator('[data-assign-tag="RAG"]').evaluate(n => n.indeterminate) || await p.locator('[data-assign-tag="RAG"]').click();
    await p.locator('#tag-assign-search').fill('공동 연구'); await p.locator('#tag-assign-create').filter({ hasText: '“공동 연구” 새 태그로 추가' }).click();
    await p.locator('[data-assign-tag="공동 연구"]:checked').waitFor(); await p.locator('[data-action="apply-tag-assign"]').click(); await p.locator('#toast').filter({ hasText: '자료 2개의 태그를 바꿨습니다' }).waitFor();
    const tagsOf = title => p.evaluate(t => papers.find(x => x.title.startsWith(t)).tags, title);
    assert.ok((await tagsOf('Learning layouts')).includes('빈 태그') && (await tagsOf('Research methods')).includes('빈 태그'), 'checking 일부 gives it to both');
    assert.ok((await tagsOf('Learning layouts')).includes('공동 연구') && (await tagsOf('Research methods')).includes('공동 연구'));
    assert.ok((await tagsOf('Research methods')).includes('통계') && !(await tagsOf('Learning layouts')).includes('통계'), 'an untouched 일부 stays as it was');
    await p.locator('[data-action="batch-clear"]').click();
    assert.deepEqual(await p.evaluate(async () => { const c = (await window.appApi.refreshStorage(state.storageKey)).tagColors; return [c.미생물학, c.통계, c['빈 태그']]; }), ['#30a46c', '#ffff00', '#0588f0']);
    // Folding leaves the heading with the tag being viewed.
    await p.locator('[data-desktop-tag="미생물학"]').click(); await p.locator('[data-section-toggle="tags"]').click(); assert.equal(await p.locator('[data-tag-row]').count(), 0);
    assert.equal(await p.locator('.tag-current').textContent(), '미생물학');
    await p.locator('[data-nav="전체 자료"]').click();

    // Reading position, zoom and outline/back survive a restart.
    await p.locator('.paper-item').filter({ has: p.locator('h3', { hasText: /^layout$/ }) }).click(); await p.locator('.original-pages .page[data-page="1"] canvas').first().waitFor();
    // The original's tool row: 뒤로·목차·쪽 with an icon and a word, as the translation's tools; back is off with nowhere to go back to.
    const toolsOf = () => p.evaluate(() => ['reader-back', 'reader-outline', 'reader-thumbs'].map(action => { const b = document.querySelector(`.original-pane [data-action="${action}"]`), label = b.querySelector('.pdf-tool-label'); return { svg: Boolean(b.querySelector('.icon svg')), label: label?.textContent, shown: label ? getComputedStyle(label).display !== 'none' : false, title: b.title, aria: b.getAttribute('aria-label'), disabled: b.disabled, pressed: b.getAttribute('aria-pressed') }; }));
    const wide = await toolsOf();
    assert.deepEqual(wide.map(t => [t.svg, t.label, t.shown, t.title]), [[true, '뒤로', true, '이전 위치로 돌아가기'], [true, '목차', true, '목차'], [true, '쪽', true, '쪽 썸네일 보기']]);
    assert.equal(wide[0].aria, '이전 위치로 돌아가기'); assert.equal(wide[0].disabled, true); assert.ok(['true', 'false'].includes(wide[2].pressed));
    // In a pane 400px wide or less only the icons show, and the three stay inside the tool row.
    await p.evaluate(() => { const pane = document.querySelector('.original-pane'); pane.dataset.testWidth = pane.style.cssText; pane.style.flex = '0 0 360px'; pane.style.width = '360px'; pane.style.maxWidth = '360px'; });
    await p.waitForFunction(() => document.querySelector('.original-pane').getBoundingClientRect().width <= 400);
    const narrow = await toolsOf(); assert.deepEqual(narrow.map(t => [t.svg, t.shown]), [[true, false], [true, false], [true, false]]);
    assert.ok(await p.evaluate(() => { const row = document.querySelector('.original-pane .source-tools'), box = row.getBoundingClientRect(); return ['reader-back', 'reader-outline', 'reader-thumbs'].every(a => { const r = row.querySelector(`[data-action="${a}"]`).getBoundingClientRect(); return r.left >= box.left - 1 && r.right <= box.right + 1 && r.width <= 30; }); }), 'icons only, inside the row');
    await p.evaluate(() => { const pane = document.querySelector('.original-pane'); pane.style.cssText = pane.dataset.testWidth; delete pane.dataset.testWidth; });
    await p.locator('[data-action="reader-outline"]').click(); await p.locator('#dialog').filter({ hasText: '목차(북마크)가 없습니다' }).waitFor(); await p.locator('#dialog [data-action="close"]').last().click();
    await (await toolShown(p, '.original-pane [data-reader-zoom=".1"]')).click();
    // Reading past the first page moves 읽기 전 to 읽는 중 by itself.
    await p.evaluate(async () => { const paper = selected(); if (paper.status !== '읽기 전') await setReadStatus(paper.id, '읽기 전'); });
    await p.locator('[data-status-menu][data-status="읽기 전"]').waitFor();
    await p.evaluate(() => { document.querySelector('.original-pages').pdfViewer.currentPageNumber = 5; });
    await p.waitForTimeout(800);
    await p.locator('[data-status-menu][data-status="읽는 중"]').waitFor();
    // The app starts in the vault used last, without the start screen, with the PDF read last open at its page.
    await app.close(); p = await launch();
    await p.waitForFunction(() => document.querySelector('.original-pages')?.pdfViewer?.currentPageNumber === 5); assert.equal(await p.locator('.welcome').count(), 0);
    // The last page makes it 완독, and the list shows the progress left of the star.
    assert.match(await p.evaluate(() => progressBadge(selected())), /5\/|width:\d+%/);
    await p.evaluate(() => { const v = document.querySelector('.original-pages').pdfViewer; v.currentPageNumber = v.pagesCount; });
    await p.locator('[data-status-menu][data-status="완독"]').waitFor(); await p.locator('#toast').filter({ hasText: '완독' }).waitFor();
    assert.match(await p.evaluate(() => progressBadge(selected())), /100%/);
    assert.equal(await p.evaluate(() => selected().title), 'layout');
    assert.ok(Math.abs(await p.evaluate(() => readerZoom) - 1.1) < 1e-9);
    assert.match(await p.locator('[data-saved-search]').textContent(), /WHO 자료/);
    assert.equal(await p.locator('[data-tag-row]').count(), 0, 'the tag view stays folded after a restart');
    assert.equal(await p.evaluate(() => tagColors.미생물학), '#30a46c');
    // Add by DOI: a known DOI is refused as a duplicate, a new one is added after review.
    await p.locator('[data-action="back"]').click(); await p.locator('[data-action="add-by-doi"]').click(); await p.locator('#add-doi').fill('10.1234/abc'); await p.locator('[data-action="add-doi-lookup"]').click();
    await p.locator('#add-doi-status').filter({ hasText: '이미 있습니다' }).waitFor(); assert.equal(await p.locator('[data-action="add-doi-confirm"]').isDisabled(), true);
    await p.locator('#add-doi').fill('https://doi.org/10.5555/new'); await p.locator('[data-action="add-doi-lookup"]').click(); await p.locator('#add-doi-preview dd').first().waitFor();
    await p.locator('[data-action="add-doi-confirm"]').click(); await p.locator('#toast').filter({ hasText: '서지 항목을 추가' }).waitFor();
    assert.match(await p.locator('.detail .bibliography').textContent(), /10\.5555\/new/);
    // Pointing at a citation shows its reference entry; the card jumps there and ↩ comes back.
    await open([path.join(temp, 'cited.pdf')]); await p.locator('[data-action="add-files"]').first().click();
    await p.locator('.paper-item').filter({ hasText: 'cited' }).click(); await p.locator('.original-pages .page[data-page="1"] .textLayer span').first().waitFor();
    const at = await p.evaluate(() => { for (const span of document.querySelectorAll('.original-pages .page[data-page="1"] .textLayer span')) { const node = span.firstChild, i = node?.data?.indexOf('[2]'); if (i >= 0) { const range = document.createRange(); range.setStart(node, i + 1); range.setEnd(node, i + 2); const r = range.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; } } return null; });
    assert.ok(at, 'the citation is in the text layer'); await p.mouse.move(at[0] - 20, at[1]); await p.mouse.move(...at, { steps: 3 });
    await p.locator('.cite-card').filter({ hasText: 'Kim H. Second study' }).waitFor();
    await p.locator('.cite-card [data-cite-page="2"]').click(); await p.waitForFunction(() => document.querySelector('.original-pages').pdfViewer.currentPageNumber === 2);
    await p.locator('[data-action="reader-back"]').click(); await p.waitForFunction(() => document.querySelector('.original-pages').pdfViewer.currentPageNumber === 1);
    // A PDF printing its DOI gets its empty bibliography on import (its file
    // name was only a placeholder title); its file is then named from it.
    await open([path.join(temp, 'doi-paper.pdf')]); await p.locator('[data-action="add-files"]').first().click();
    await p.locator('#toast').filter({ hasText: 'DOI로 1개 항목' }).waitFor();
    const filled = await p.evaluate(() => { const paper = papers.find(p => p.doi === '10.5555/auto.1'); return paper && { title: paper.title, authors: paper.authors, year: paper.year, id: paper.id }; });
    assert.deepEqual({ ...filled, id: undefined }, { title: 'Crossref title differs', authors: 'Jane Doe', year: '2024', id: undefined });
    assert.ok(await p.evaluate(id => { const paper = papers.find(p => p.id === id); return attachmentMenu(paper, paper.attachments.find(a => a.id === paper.primaryAttachmentId)).includes('data-action="rename-files"'); }, filled.id), 'the main PDF’s ⋯ menu offers the automatic name');
    await p.evaluate(id => { state.selected = id; return actions['rename-files'](); }, filled.id); await p.locator('#toast').filter({ hasText: '파일 이름 정리: 1개 변경' }).waitFor();
    const renamed = await p.evaluate(id => papers.find(p => p.id === id).attachments[0], filled.id);
    assert.equal(renamed.name, 'Doe_2024_Crossref title differs.pdf'); assert.equal(renamed.fileName, renamed.name); await fs.access(path.join(vault, renamed.folder, renamed.fileName));
    // Without a printed DOI the record still fills: a DOI in the document information, a near-identical
    // title in Crossref, an arXiv number (DataCite), else the PDF's own title and authors; never a guess from the layout.
    const byFile = name => p.evaluate(n => { const x = papers.find(q => q.attachments.some(a => a.name === n || a.fileName === n)); return x && { title: x.title, authors: x.authors, year: x.year, doi: x.doi || '', journal: x.journal || '', type: x.type, id: x.id }; }, name);
    await open(['meta-doi.pdf', 'title-only.pdf', 'arxiv-paper.pdf', 'own-meta.pdf'].map(f => path.join(temp, f))); await p.locator('[data-action="add-files"]').first().click();
    await p.locator('#toast').filter({ hasText: '제목 검색으로 1개 항목' }).waitFor();
    assert.match(await p.locator('#toast').textContent(), /DOI로 2개 항목, 제목 검색으로 1개 항목, PDF 정보로 1개 항목의 빈 서지정보를 채웠습니다\. 제목 검색으로 찾은 항목은 확인해 주세요\./);
    assert.deepEqual(await byFile('meta-doi.pdf').then(x => [x.title, x.authors, x.doi]), ['Metadata record 1', 'Jane Doe', '10.5555/meta.1']);
    assert.deepEqual(await byFile('title-only.pdf').then(x => [x.title, x.authors, x.year, x.doi, x.journal]), ['Growth Curves of Fed-Batch Cultures', 'Min Park', '2021', '10.5555/search.1', 'Bioprocess Journal']);
    assert.deepEqual(await byFile('arxiv-paper.pdf').then(x => [x.title, x.authors, x.year, x.doi, x.journal, x.type]), ['An arXiv preprint on layouts', 'Ara Choi', '2021', '10.48550/arXiv.2101.01234', 'arXiv', 'preprint']);
    assert.deepEqual(await byFile('own-meta.pdf').then(x => [x.title, x.authors, x.doi]), ['A study of reading layouts in papers', 'Kim Minjun; Lee Jiwon', '']);
    assert.ok(await app.evaluate(() => globalThis.lookups.some(u => u.includes('query.bibliographic=Growth curves of fed-batch cultures'))), 'the large-type title went to the search');
    // PDFs already in the vault folder are filled in the background once they are found.
    await samplePdf(path.join(vault, 'found-later.pdf'), ['Placed in the folder by hand.']); await described(path.join(vault, 'found-later.pdf'), { lines: ['Placed in the folder by hand.'], info: { subject: 'doi:10.5555/meta.2' } });
    await p.locator('[data-action="refresh-vault"]').first().click();
    await p.waitForFunction(() => papers.some(q => q.doi === '10.5555/meta.2' && q.authors === 'Jane Doe' && q.title === 'Metadata record 2'), null, { timeout: 20000 });
    // The sidebar's marks: the vault is a box (not a folder), 즐겨찾기 the list's star, folders open with the headings' triangle.
    assert.deepEqual(await p.evaluate(() => [document.querySelector('.sidebar .storage .icon path').getAttribute('d'), document.querySelector('[data-action="vault-manager"] .icon path').getAttribute('d'), document.querySelector('.vault-row[data-folder-drop=""] .folder-name .icon path').getAttribute('d')]), await p.evaluate(() => [paths.vault, paths.vault, paths.vault]));
    assert.equal(await p.locator('[data-nav="즐겨찾기"] .nav-star').count(), 1); assert.equal(await p.locator('.vault-row .folder-caret .section-caret').count() > 0, true);
    // Moving in the sidebar: a file dragged onto a folder of the tree moves there on disk; the notice moves it back.
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1280, 900)); await p.evaluate(() => { for (const v of sidebarViews) localStorage.removeItem('app-view-weight-' + v.id); setViewOpen('tags', false); refreshVaultSidebar(); });
    await fs.mkdir(path.join(vault, '정리함')); await p.locator('[data-action="refresh-vault"]').first().click(); await p.locator('[data-folder-drop="정리함"]').waitFor();
    await p.locator('.vault-file').filter({ hasText: 'found-later.pdf' }).dragTo(p.locator('[data-folder-drop="정리함"]'));
    await p.locator('.undo-toast').filter({ hasText: '“found-later.pdf”을 “정리함”로 옮겼습니다' }).waitFor();
    await fs.access(path.join(vault, '정리함', 'found-later.pdf')); await assert.rejects(fs.access(path.join(vault, 'found-later.pdf')));
    await p.locator('.undo-toast button').click(); await p.locator('#toast').filter({ hasText: '원래 폴더로 되돌렸습니다' }).waitFor(); await fs.access(path.join(vault, 'found-later.pdf'));
    // A paper dragged from the list onto a folder moves its main PDF.
    await p.locator('[data-nav="전체 자료"]').click();
    await p.locator('.paper-item').filter({ hasText: 'Metadata record 2' }).dragTo(p.locator('[data-folder-drop="정리함"]'));
    await p.locator('.undo-toast').filter({ hasText: '정리함' }).waitFor(); await fs.access(path.join(vault, '정리함', 'found-later.pdf'));
    assert.equal(await p.evaluate(() => papers.find(q => q.title === 'Metadata record 2').attachments[0].folder), '정리함');
    // Renaming the folder from its ⋯ menu renames it on disk; the paper stays linked and the right-click opens the same menu.
    await p.locator('.vault-row[data-folder-drop="정리함"]').click({ button: 'right' }); await p.locator('.pop-menu [data-folder-rename]').click();
    await p.locator('#folder-rename').fill('보관함'); await p.locator('#folder-rename').press('Enter'); await p.locator('#toast').filter({ hasText: '보관함' }).waitFor();
    await fs.access(path.join(vault, '보관함', 'found-later.pdf')); await assert.rejects(fs.access(path.join(vault, '정리함')));
    await p.locator('[data-folder-drop="보관함"]').waitFor(); assert.equal(await p.evaluate(() => papers.find(q => q.title === 'Metadata record 2').attachments[0].folder), '보관함');
    assert.ok(await p.evaluate(() => Boolean(papers.find(q => q.title === 'Metadata record 2').attachments[0].file)), 'the PDF is still found');
    // A PDF in the tree is renamed the same way (right-click or F2); the paper keeps it.
    await p.locator('.vault-file').filter({ hasText: 'found-later.pdf' }).click({ button: 'right' }); await p.locator('.pop-menu [data-file-rename]').click();
    assert.equal(await p.locator('#file-rename').inputValue(), 'found-later'); await p.locator('#file-rename').fill('이름 바꾼 논문'); await p.locator('#file-rename').press('Enter');
    await p.locator('#toast').filter({ hasText: '이름 바꾼 논문.pdf' }).waitFor(); await fs.access(path.join(vault, '보관함', '이름 바꾼 논문.pdf')); await assert.rejects(fs.access(path.join(vault, '보관함', 'found-later.pdf')));
    assert.equal(await p.evaluate(() => papers.find(q => q.title === 'Metadata record 2').attachments[0].fileName), '이름 바꾼 논문.pdf');
    await p.locator('.vault-file').filter({ hasText: '이름 바꾼 논문.pdf' }).focus(); await p.keyboard.press('F2'); await p.locator('#file-rename').waitFor(); await p.keyboard.press('Escape');
    // The same menus show where a file or folder is on disk: 폴더에서 보기 (the system file manager) and 경로 복사.
    await app.evaluate(({ shell, clipboard }) => { globalThis.revealed = []; shell.showItemInFolder = file => globalThis.revealed.push(['file', file]); shell.openPath = async folder => { globalThis.revealed.push(['folder', folder]); return ''; }; clipboard.writeText(''); });
    await p.locator('.vault-file').filter({ hasText: '이름 바꾼 논문.pdf' }).click({ button: 'right' }); await p.locator('.pop-menu [data-reveal="open"]').click();
    await p.locator('.vault-file').filter({ hasText: '이름 바꾼 논문.pdf' }).click({ button: 'right' }); await p.locator('.pop-menu [data-reveal="copy"]').click(); await p.locator('#toast').filter({ hasText: '경로를 복사했습니다' }).waitFor();
    assert.equal(await app.evaluate(({ clipboard }) => clipboard.readText()), path.join(vault, '보관함', '이름 바꾼 논문.pdf'));
    await p.locator('.vault-row[data-folder-drop="보관함"]').click({ button: 'right' }); await p.locator('.pop-menu [data-reveal="open"]').click();
    // The vault's own row has no ⋯, but a right-click still offers the two.
    await p.locator('.vault-row[data-folder-drop=""]').click({ button: 'right' }); assert.deepEqual(await p.locator('.pop-menu button').allTextContents(), ['폴더에서 보기', '경로 복사']); await p.locator('.pop-menu [data-reveal="open"]').click();
    await p.waitForFunction(() => document.querySelectorAll('.pop-menu').length === 0);
    assert.deepEqual(await app.evaluate(() => globalThis.revealed), [['file', path.join(vault, '보관함', '이름 바꾼 논문.pdf')], ['folder', path.join(vault, '보관함')], ['folder', vault]]);
    // By hand: the button beside the bibliography, and 자동 채우기 for checked papers; a paper with nothing to find says so.
    const lookupsBefore = await app.evaluate(() => globalThis.lookups.length);
    await p.evaluate(() => { state.selected = papers.find(q => q.title === 'layout').id; state.screen = 'library'; render(); }); await p.locator('.detail [data-action="autofill-paper"]').click();
    await p.locator('#toast').filter({ hasText: '채울 빈 칸이 없거나' }).waitFor(); assert.ok(await app.evaluate((_, n) => globalThis.lookups.length > n, lookupsBefore), 'tried again by hand');
    for (const title of [/^layout$/, /^cited$/]) await p.locator('.paper-item').filter({ has: p.locator('h3', { hasText: title }) }).locator('[data-batch-paper]').check();
    await p.locator('.batch-bar [data-action="batch-autofill"]').click(); await p.locator('#toast').filter({ hasText: '채울 수 있는 빈 서지정보를 찾지 못했습니다' }).waitFor(); await p.locator('[data-action="batch-clear"]').click();
    // A last vault that is gone leaves the start screen up, saying why.
    await app.close(); await fs.rename(vault, vault + '-moved'); p = await launch();
    await p.locator('.welcome').waitFor(); await p.locator('#toast').filter({ hasText: '저장소 폴더를 찾을 수 없습니다' }).filter({ hasText: '최근 목록에서 지우세요' }).waitFor(); assert.equal(await p.locator('[data-desktop-recent]').count(), 1);
    // A recent vault can be taken off the list (its trash button, or Delete on the row); the folder is not touched.
    await p.locator('[data-recent-remove]').click(); await p.locator('#toast').filter({ hasText: '최근 목록에서 지웠습니다' }).waitFor();
    assert.equal(await p.locator('[data-desktop-recent]').count(), 0); await p.locator('.recent-empty').waitFor();
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(temp, 'profile', 'settings.json'), 'utf8')).recents, []);
    await app.close(); app = null; await fs.rename(vault + '-moved', vault);
    console.log('Library smoke passed: BibTeX import report, structured edit, DOI review, APA/Vancouver copy, nested collections, batch edit, saved and full-text search, reading position, starting in the last vault (or the start screen when it is gone, where it can be taken off the recent list), 폴더에서 보기 and 경로 복사 for files and folders, citation cards with a jump to the reference, bibliography from the DOI on import and file names from it, sidebar views (order, folding to the bottom, resizable heights) and vault-wide tags.');
  } catch (error) { try { await (await app.firstWindow()).screenshot({ path: path.join(os.tmpdir(), `${appName.id}-library-failure.png`) }); } catch {} throw error; }
  finally { if (app) await app.close(); await fs.rm(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }).catch(error => console.warn(`임시 폴더를 다 지우지 못했습니다(${error.code}). 테스트 결과와는 무관합니다: ${temp}`)); }
})().catch(error => { console.error(error); process.exit(1); });
