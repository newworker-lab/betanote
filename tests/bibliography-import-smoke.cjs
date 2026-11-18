// End-to-end check in the real Electron app (APP_TEST_SOURCE=1 runs the source): a bibliography
// file that names PDFs asks whether they come along; "첨부파일 포함" copies them into the vault and
// attaches them, "서지정보만" brings the items alone, "취소" changes nothing.
const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { PDFDocument, StandardFonts } = require('pdf-lib');
const appName = require('../core/app-name.cjs');
const root = path.resolve(__dirname, '..');
(async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), `${appName.id}-bib-e2e-`)), vault = path.join(temp, 'vault'), from = path.join(temp, 'export'); await fs.mkdir(vault); await fs.mkdir(path.join(from, 'files'), { recursive: true });
  const make = async (file, text) => { const doc = await PDFDocument.create(), font = await doc.embedFont(StandardFonts.Helvetica); doc.addPage([600, 800]).drawText(text, { x: 40, y: 740, size: 12, font }); await fs.writeFile(file, await doc.save({ useObjectStreams: false })); };
  await make(path.join(vault, 'seed.pdf'), 'A paper already here.'); await make(path.join(from, 'files', 'Kim 2020.pdf'), 'The attached paper.');
  const bib = path.join(from, 'refs.bib'); await fs.writeFile(bib, '@article{kim2020, title={Attached paper}, author={Kim, A.}, year={2020}, file={Full Text PDF:files/Kim 2020.pdf:application/pdf;:files/missing.pdf:PDF}}\n@article{lee2021, title={No file}, author={Lee, B.}, year={2021}}\n');
  const executable = require('./app-executable.cjs')(root);
  let app;
  try {
    app = await electron.launch({ executablePath: executable, args: [...(process.env.APP_TEST_SOURCE === '1' ? [root] : []), '--no-sandbox', '--ozone-platform=headless', '--disable-gpu', `--user-data-dir=${path.join(temp, 'profile')}`], timeout: 20000 });
    const p = await app.firstWindow(); p.setDefaultTimeout(15000);
    p.on('pageerror', e => { console.error(e); process.exitCode = 1; }); p.on('console', m => { if (m.type() === 'error') console.error('renderer:', m.text()); });
    await app.evaluate(({ dialog }) => {
      globalThis.openQueue = []; dialog.showOpenDialog = async () => ({ canceled: false, filePaths: globalThis.openQueue.shift() });
      globalThis.asked = []; globalThis.answer = 0; dialog.showMessageBox = async (_win, options) => { globalThis.asked.push({ message: options.message, buttons: options.buttons }); return { response: globalThis.answer }; };
    });
    const open = paths => app.evaluate((_, paths) => globalThis.openQueue.push(paths), paths);
    const bring = async answer => { await app.evaluate((_, answer) => { globalThis.answer = answer; }, answer); await open([bib]); return p.evaluate(() => actions['import-ris']()); };
    const items = title => p.evaluate(title => papers.filter(x => x.title === title).map(x => x.attachments.filter(a => a.file).length), title);
    await open([vault]); await p.locator('[data-action="storage"]').first().click(); await p.locator('.paper-item').first().waitFor();

    // 취소: nothing is added.
    await bring(2); assert.deepEqual(await items('Attached paper'), []);
    const asked = await app.evaluate(() => globalThis.asked);
    assert.match(asked[0].message, /첨부파일 링크가 2개/); assert.deepEqual(asked[0].buttons, ['첨부파일 포함', '서지정보만', '취소']);

    // 서지정보만: the items come in without a PDF, and the report says the links were left out.
    await bring(1); await p.locator('dialog[open]').waitFor();
    assert.deepEqual(await items('Attached paper'), [0]); assert.match(await p.locator('dialog[open]').innerText(), /2개 항목을 가져왔습니다[\s\S]*첨부파일 링크 2개는 가져오지 않았습니다/);
    await p.locator('dialog[open] button.primary[data-action="close"]').click();

    // 첨부파일 포함: the PDF found is copied into the vault and attached; the one not found is named.
    await bring(0); await p.locator('dialog[open]').waitFor();
    const text = await p.locator('dialog[open]').innerText();
    assert.match(text, /첨부파일 2개 중 1개를 저장소의 refs 폴더로 복사해 붙였습니다/); assert.match(text, /missing\.pdf — 파일 없음/); assert.ok(!text.includes(temp));
    assert.deepEqual((await items('Attached paper')).sort(), [0, 1]);
    assert.match(text, /refs 폴더/); assert.ok((await fs.readdir(path.join(vault, 'refs'))).includes('Kim 2020.pdf')); await assert.rejects(fs.access(path.join(vault, 'papers'))); await fs.access(path.join(from, 'files', 'Kim 2020.pdf'));
    await p.locator('dialog[open] button.primary[data-action="close"]').click();

    // A file that names no PDF is not asked about.
    const plain = path.join(from, 'plain.ris'); await fs.writeFile(plain, 'TY  - JOUR\nTI  - Plain entry\nER  -\n');
    const before = (await app.evaluate(() => globalThis.asked)).length; await open([plain]); await p.evaluate(() => actions['import-ris']()); await p.locator('dialog[open]').waitFor();
    assert.equal((await app.evaluate(() => globalThis.asked)).length, before); assert.deepEqual(await items('Plain entry'), [0]);

    // 전체 선택: the box at the start of the filter row selects every item the list shows and follows the selection.
    await p.locator('dialog[open] button.primary[data-action="close"]').click();
    const shown = await p.locator('.paper-item').count(); assert.ok(shown >= 4);
    const all = p.locator('#select-all'), boxState = () => all.evaluate(b => [b.checked, b.indeterminate]);
    assert.deepEqual(await boxState(), [false, false]);
    await all.check(); await p.locator('.batch-bar').filter({ hasText: `${shown}개 선택` }).waitFor();
    assert.equal(await p.locator('[data-batch-paper]:checked').count(), shown); assert.deepEqual(await boxState(), [true, false]);
    // One taken out: half-set; checking the box again selects the rest. The bar has no second 전체 선택.
    await p.locator('[data-batch-paper]').first().uncheck(); assert.deepEqual(await boxState(), [false, true]); assert.equal(await p.locator('.batch-bar [data-action="batch-all"]').count(), 0);
    await all.check(); await p.locator('.batch-bar').filter({ hasText: `${shown}개 선택` }).waitFor(); assert.deepEqual(await boxState(), [true, false]);
    // Unchecking clears the selection, and no empty bar is left where the bar was.
    await all.uncheck(); assert.equal(await p.locator('[data-batch-paper]:checked').count(), 0); assert.deepEqual(await boxState(), [false, false]);
    assert.equal(await p.locator('.batch-bar').evaluateAll(list => list.filter(b => b.getBoundingClientRect().height > 0).length), 0, 'an empty selection bar is showing');
    await p.locator('[data-batch-paper]').first().check(); await p.locator('.batch-bar [data-action="batch-clear"]').click();
    assert.equal(await p.locator('.batch-bar').evaluateAll(list => list.filter(b => b.getBoundingClientRect().height > 0).length), 0, 'an empty selection bar is showing');
    // With a search in force only what the list shows is selected.
    await p.evaluate(() => { state.query = 'Plain'; render(); }); await p.locator('#select-all').check(); await p.locator('.batch-bar').filter({ hasText: '1개 선택' }).waitFor();
    await p.evaluate(() => { batchSelection.clear(); state.query = ''; render(); });
    // PDF 본문 검색 is a switch at the end of the row.
    assert.equal(await p.locator('.filters-end #fulltext-toggle').getAttribute('role'), 'switch'); await p.locator('#fulltext-toggle').check(); assert.equal(await p.evaluate(() => state.fullText), true); await p.locator('#fulltext-toggle').uncheck();

    // 중복 자료 후보 → 전체 병합: the same entries brought in twice (same DOI) become one item each.
    const dup = path.join(from, 'dup.bib'); await fs.writeFile(dup, '@article{x1, title={Twin one}, doi={10.1234/twin.one}}\n@article{x2, title={Twin two}, doi={10.1234/twin.two}, keywords={second}}\n');
    for (let i = 0; i < 2; i++) { await open([dup]); await p.evaluate(() => actions['import-ris']()); await p.locator('dialog[open] h2').filter({ hasText: '가져오기 결과' }).waitFor(); await p.locator('dialog[open] button.primary[data-action="close"]').click(); }
    await open([dup]); await p.evaluate(() => actions['import-ris']()); await p.locator('dialog[open] h2').filter({ hasText: '가져오기 결과' }).waitFor(); await p.locator('dialog[open] button.primary[data-action="close"]').click();
    const total = await p.evaluate(() => papers.length); assert.equal(await p.evaluate(() => papers.filter(x => x.title === 'Twin one').length), 3);
    await p.locator('.library-title [data-action="duplicates"]').click(); await p.locator('dialog[open] h2').filter({ hasText: '중복 자료 후보' }).waitFor();
    await p.locator('dialog[open] [data-action="merge-all-duplicates"]').filter({ hasText: '전체 병합 (6쌍)' }).click();
    await p.locator('dialog[open] h2').filter({ hasText: '중복 자료 후보 전체 병합' }).waitFor(); assert.match(await p.locator('dialog[open]').innerText(), /6쌍을 모두 병합[\s\S]*먼저 등록된 자료/);
    // 취소 goes back to the candidates with nothing merged.
    await p.locator('dialog[open] button.secondary[data-action="duplicates"]').click(); await p.locator('dialog[open] h2').filter({ hasText: '중복 자료 후보' }).waitFor(); assert.equal(await p.evaluate(() => papers.length), total);
    await p.locator('dialog[open] [data-action="merge-all-duplicates"]').click(); await p.locator('dialog[open] [data-action="confirm-merge-all"]').click();
    await p.locator('#toast').filter({ hasText: '중복 자료 4개를 2개 항목으로 병합했습니다' }).waitFor();
    assert.equal(await p.evaluate(() => papers.length), total - 4); assert.deepEqual(await p.evaluate(() => papers.filter(x => /^Twin/.test(x.title)).map(x => [x.title, x.tags.join()]).sort()), [['Twin one', ''], ['Twin two', 'second']]);
    await p.locator('.library-title [data-action="duplicates"]').click(); await p.locator('dialog[open]').filter({ hasText: '중복 자료 후보가 없습니다' }).waitFor(); assert.equal(await p.locator('dialog[open] [data-action="merge-all-duplicates"]').count(), 0);
    console.log('bibliography import smoke passed');
  } finally { await app?.close().catch(() => {}); await fs.rm(temp, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exit(1); });
