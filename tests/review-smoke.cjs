// End-to-end check of K-06 in the real Electron app with a simulated model:
// result quality counted apart from job state, corrections kept beside the
// AI translation, carried into PDF export, compared after a re-translation,
// and kept across restart.
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
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), `${appName.id}-review-e2e-`)), vault = path.join(temp, 'vault'); await fs.mkdir(vault);
  const doc = await PDFDocument.create(), font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([600, 800]); page.drawText('A research paper connects ideas.', { x: 40, y: 700, size: 12, font }); page.drawText('E = mc2', { x: 40, y: 600, size: 12, font }); page.drawText('Second paragraph sits apart from the first.', { x: 40, y: 400, size: 12, font });
  await fs.writeFile(path.join(temp, 'paper.pdf'), await doc.save());
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
      globalThis.openQueue = []; globalThis.saveQueue = [];
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: globalThis.openQueue.shift() });
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: globalThis.saveQueue.shift() });
      const { ChatGPT } = process.getBuiltinModule('module').createRequire(app.getAppPath() + '/package.json')('./desktop/chatgpt.cjs');
      ChatGPT.prototype.status = () => ({ connected: true, usable: true, email: 'fixture@example.test', persistent: false });
      ChatGPT.prototype.models = async () => [{ id: 'fixture-model', name: 'Fixture GPT' }];
      globalThis.contexts = [];
      ChatGPT.prototype.translate = async (_m, blocks, _signal, context) => { globalThis.contexts.push(context); return blocks.filter(b => !(globalThis.dropSecond && /Second paragraph/.test(b.text))).map(b => ({ id: b.id, text: /Second paragraph/.test(b.text) ? '두 번째 문단입니다.' : globalThis.translationText || '연구 논문은 아이디어를 연결합니다.' })); };
    });
    return p;
  }
  const block = p => p.locator('.translated-pane .translation-layer .translated-block').filter({ hasText: /연구|교정|새로/ }).first();
  try {
    let p = await launch();
    await app.evaluate((_, v) => globalThis.openQueue.push([v]), vault); await p.locator('[data-action="storage"]').first().click();
    await app.evaluate((_, f) => globalThis.openQueue.push([f]), path.join(temp, 'paper.pdf')); await p.locator('[data-action="add-files"]').first().click();
    // A glossary term goes with the request and is checked in the result.
    await p.locator('[data-action="vault-manager"]').click(); await p.locator('[data-vm-tab="translation"]').click(); await p.locator('#glossary-text').fill('ideas = 발상\nquantum = 양자'); await p.locator('[data-action="glossary-save"]').click(); await p.locator('#toast').filter({ hasText: '용어 2개' }).waitFor(); await p.locator('#dialog [data-action="close"]').last().click();
    await p.locator('.paper-item').click(); await p.locator('[data-mode="translated"]').click(); await p.locator('#dialog [data-action="gpt-start"]').click(); await p.locator('[data-action="gpt-export"]').waitFor();
    assert.deepEqual((await app.evaluate(() => globalThis.contexts.find(c => c.glossary))).glossary, [{ term: 'ideas', translation: '발상' }], 'only terms in the paragraph are sent');
    await p.locator('.translation-quality').filter({ hasText: '검토 필요 1' }).waitFor();
    await (await toolShown(p, '.translation-quality')).click(); await p.locator('#dialog').filter({ hasText: '용어집: ideas → 발상' }).waitFor(); await p.locator('#dialog [data-action="close"]').last().click();
    assert.match(await p.locator('.translation-quality').textContent(), /원문 유지 1/, 'the formula is counted as an intentional source keep');

    // Correct a paragraph: shown, counted, exported; the AI text stays recorded.
    await block(p).dblclick(); await p.locator('#correction-text').fill('사용자가 교정한 문장입니다.'); await p.locator('[data-action="correction-save"]').click();
    await p.locator('.translated-pane .translated-block').filter({ hasText: '사용자가 교정한' }).waitFor();
    await p.locator('.translation-quality').filter({ hasText: '교정 1' }).waitFor();
    const cache = (await fs.readdir(path.join(vault, appName.vaultDir))).find(f => /^translation-\d+(-[-a-z0-9]+)?\.json$/.test(f));
    assert.doesNotMatch(await fs.readFile(path.join(vault, appName.vaultDir, cache), 'utf8'), /사용자가 교정한/, 'the AI cache is not rewritten');
    await app.evaluate((_, f) => globalThis.saveQueue.push(f), path.join(temp, 'out.pdf'));
    await p.locator('[data-action="gpt-export"]').click(); await p.locator('#dialog [data-action="ink-export-confirm"]').click();
    for (let i = 0; i < 100 && !(await fs.stat(path.join(temp, 'out.pdf')).catch(() => null)); i++) await p.waitForTimeout(100);
    const text = await p.evaluate(async bytes => { const pdfjs = await import('./pdfjs/pdf.mjs'), task = pdfjs.getDocument({ data: new Uint8Array(bytes), isEvalSupported: false }), doc = await task.promise, content = await (await doc.getPage(1)).getTextContent(); await task.destroy(); return content.items.map(i => i.str).join(''); }, Array.from(await fs.readFile(path.join(temp, 'out.pdf'))));
    assert.match(text.replace(/\s/g, ''), /사용자가교정한문장입니다/);

    // Re-translate: the correction stays and the new AI text is offered for comparison.
    await app.evaluate(() => { globalThis.translationText = '새로 번역한 문장입니다.'; });
    await (await toolShown(p, '[data-action="gpt-retranslate"]')).click(); await p.locator('#dialog [data-action="gpt-start"]').click(); await p.locator('[data-action="gpt-export"]').waitFor();
    await p.locator('.translated-pane .translated-block').filter({ hasText: '사용자가 교정한' }).waitFor();
    await (await toolShown(p, '.translation-quality')).click(); await p.locator('#dialog').filter({ hasText: '교정 후 재번역됨' }).waitFor(); await p.locator('#dialog [data-action="close"]').last().click();
    await block(p).dblclick(); await p.locator('#dialog').filter({ hasText: '새로 번역한 문장입니다.' }).waitFor();
    await p.locator('[data-action="correction-revert"]').filter({ hasText: '새 AI 번역 채택' }).click();
    await p.locator('.translated-pane .translated-block').filter({ hasText: '새로 번역한' }).waitFor();
    // Correct again and check it survives a restart.
    await block(p).dblclick(); await p.locator('#correction-text').fill('재시작 후에도 남는 교정'); await p.locator('[data-action="correction-save"]').click();
    await app.close(); p = await launch();
    await (await openNote(p)).waitFor(); await p.locator('[data-mode="translated"]').click();
    await p.locator('.translated-pane .translated-block').filter({ hasText: '재시작 후에도 남는 교정' }).waitFor();
    await block(p).dblclick(); await p.locator('#dialog details').filter({ hasText: '이전 교정 1개' }).waitFor();
    await p.locator('#dialog [data-action="close"]').last().click();
    // Copying in the translated view takes translated words, not the hidden source layer.
    assert.equal(await p.evaluate(() => getComputedStyle(document.querySelector('.translated-pane .textLayer')).userSelect), 'none');
    // An incomplete translation can still be saved, with the source kept and listed.
    await app.evaluate(() => { globalThis.dropSecond = true; });
    await (await toolShown(p, '[data-action="gpt-retranslate"]')).click(); await p.locator('#dialog [data-action="gpt-start"]').click(); await p.locator('[data-action="gpt-export"]').waitFor({ timeout: 60000 });
    await p.locator('.translation-quality').filter({ hasText: '미번역 1' }).waitFor();
    await app.evaluate((_, f) => globalThis.saveQueue.push(f), path.join(temp, 'partial.pdf'));
    await p.locator('[data-action="gpt-export"]').click(); await p.locator('#ink-export-missing').check(); await p.locator('#dialog [data-action="ink-export-confirm"]').click();
    for (let i = 0; i < 150 && !(await fs.stat(path.join(temp, 'partial.pdf')).catch(() => null)); i++) await p.waitForTimeout(100);
    const partial = await p.evaluate(async bytes => { const pdfjs = await import('./pdfjs/pdf.mjs'), task = pdfjs.getDocument({ data: new Uint8Array(bytes), isEvalSupported: false }), doc = await task.promise, last = await (await doc.getPage(doc.numPages)).getTextContent(); await task.destroy(); return last.items.map(i => i.str).join(''); }, Array.from(await fs.readFile(path.join(temp, 'partial.pdf'))));
    assert.match(partial.replace(/\s/g, ''), /번역되지않은문단1개/); assert.match(partial, /Second paragraph/);
    // The dialog names the pages only a new translation puts right, and one button translates just those again.
    await (await toolShown(p, '.translation-quality')).click();
    const again = p.locator('#dialog [data-retranslate-pages]'); await again.waitFor({ timeout: 30000 });
    assert.match(await p.locator('#dialog .quality-problems').textContent(), /다시 번역이 필요한 쪽 1[\s\S]*미번역 문단이 있는 쪽: 1\./);
    assert.equal(await again.getAttribute('data-retranslate-pages'), '1');
    await app.evaluate(() => { globalThis.dropSecond = false; });
    await again.click(); await p.locator('#dialog').filter({ hasText: '1개 페이지 다시 번역' }).waitFor(); assert.equal(await p.locator('#translation-first-page').count(), 0, 'no first-page choice for chosen pages');
    await p.locator('#dialog [data-action="gpt-start"]').click();
    await p.waitForFunction(() => { const t = document.querySelector('.translation-quality')?.textContent || ''; return t && !/미번역/.test(t); }, null, { timeout: 60000 });
    await (await toolShown(p, '.translation-quality')).click(); await p.locator('#dialog .quality-problems').filter({ hasText: '다시 번역이 필요한 쪽은 없습니다' }).waitFor({ timeout: 30000 }); await p.locator('#dialog [data-action="close"]').last().click();
    await app.close(); app = null;
    console.log('Review smoke passed: quality counts apart from job state, corrections kept beside AI text, exported, compared after re-translation, kept across restart, the pages in need translated again with one button.');
  } catch (error) { try { await (await app.firstWindow()).screenshot({ path: path.join(os.tmpdir(), `${appName.id}-review-failure.png`) }); } catch {} throw error; }
  finally { if (app) await app.close(); await fs.rm(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }).catch(error => console.warn(`임시 폴더를 다 지우지 못했습니다(${error.code}). 테스트 결과와는 무관합니다: ${temp}`)); }
})().catch(error => { console.error(error); process.exit(1); });
