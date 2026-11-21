// The language settings in the real Electron app (APP_TEST_SOURCE=1 runs the source): the
// first screen language of a new install and of one already in use, APP_UI_LANG holding for one
// run without being stored, and a new screen language reloading the windows after the memos are saved.
const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { PDFDocument, StandardFonts } = require('pdf-lib');
const { matchLanguage } = require('../core/languages.cjs');
const root = path.resolve(__dirname, '..');
const executable = require('./app-executable.cjs')(root);
const appName = require('../core/app-name.cjs'), [nameBefore, nameFirst] = appName.history;
const toolShown = require('./tool-row.cjs'); // a tool a narrow pane keeps under ⋯ is brought out before it is used
// Each case names its own APP_UI_LANG; none inherits the Korean the other smokes are given. The system's languages
// are set too (APP_OS_LANGUAGES, English unless a case names others), so no case depends on the machine.
const envWith = lang => { const env = { ...process.env, APP_OS_LANGUAGES: 'en-US' }; delete env.APP_UI_LANG; if (lang) env.APP_UI_LANG = lang; return env; };
const readSettings = async profile => JSON.parse(await fs.readFile(path.join(profile, 'settings.json'), 'utf8'));
(async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), `${appName.id}-language-e2e-`)), vault = path.join(temp, 'vault'); await fs.mkdir(vault);
  const doc = await PDFDocument.create(), font = await doc.embedFont(StandardFonts.Helvetica); doc.addPage([600, 800]).drawText('A research paper connects ideas.', { x: 40, y: 740, size: 14, font });
  await fs.writeFile(path.join(vault, 'paper.pdf'), await doc.save());
  let app;
  const launch = async (profile, lang, extraEnv = {}) => {
    app = await electron.launch({ env: { ...envWith(lang), ...extraEnv }, executablePath: executable, args: [...(process.env.APP_TEST_SOURCE === '1' ? [root] : []), '--no-sandbox', '--ozone-platform=headless', '--disable-gpu', `--user-data-dir=${profile}`], timeout: 20000 });
    const p = await app.firstWindow(); p.setDefaultTimeout(15000);
    p.on('pageerror', e => { console.error(e); process.exitCode = 1; }); p.on('console', m => { if (m.type() === 'error') console.error('renderer:', m.text()); });
    await p.waitForFunction(() => typeof showShortcuts === 'function'); // the last script has loaded
    return p;
  };
  // An English screen shows no Korean, but for what a test put there (written in English here).
  const hangul = /[가-힣]/;
  const noKorean = (text, where) => { assert.ok(text.trim(), `${where}: something is shown`); assert.doesNotMatch(text, hangul, `${where}: ${text.match(new RegExp(`.{0,30}${hangul.source}.{0,30}`))?.[0]}`); };
  // What a reader sees in the nodes a selector finds: their text and their labels, titles and placeholders.
  // Language names are written in their own language on purpose, so the language pickers are left out.
  const shownIn = (p, selector, leaveOut = '.welcome-language, .language-first [data-first-language], #language-ui, #language-translation, #language-ai, #translation-language') => p.evaluate(([selector, leaveOut]) => {
    const out = [...document.querySelectorAll(leaveOut)], was = out.map(node => node.hidden); out.forEach(node => { node.hidden = true; });
    try { return [...document.querySelectorAll(selector)].map(node => [node.innerText, ...[node, ...node.querySelectorAll('*')].filter(element => !out.some(o => o.contains(element))).flatMap(element => ['aria-label', 'title', 'placeholder'].map(name => element.getAttribute(name) || ''))].join('\n')).join('\n'); }
    finally { out.forEach((node, i) => { node.hidden = was[i]; }); }
  }, [selector, leaveOut]);
  // The same for markup a function returns, with the parts made by files not moved yet left out.
  const shownHtml = (p, html, leaveOut = '') => p.evaluate(([html, leaveOut]) => { const box = document.createElement('div'); box.innerHTML = html; if (leaveOut) box.querySelectorAll(leaveOut).forEach(node => node.remove()); return [box.textContent, ...[...box.querySelectorAll('*')].flatMap(element => ['aria-label', 'title', 'placeholder'].map(name => element.getAttribute(name) || ''))].join('\n'); }, [html, leaveOut]);
  // What on the top layer (an open dialog, else the page) is cut off, covered, outside the window, overlapping, or
  // scrolls sideways (but the PDF and notebook tool rows, made to scroll, and the PDF pages themselves: a page wider
  // than its pane scrolls by design, in Korean too, and right after the window is resized it does until fit-width runs
  // again, which made the check fail now and then). Text that is the reader's own (file names, titles, a memo's one
  // line) may end in an ellipsis.
  const unfitAt = (p, where, { cut = true } = {}) => p.evaluate(({ cut }) => {
    const top = document.querySelector('dialog[open]') || document.body, W = innerWidth, H = innerHeight, out = [];
    const shown = el => { if (el.closest('[hidden],[aria-hidden="true"]')) return false; const r = el.getBoundingClientRect(), cs = getComputedStyle(el); return r.width >= 1 && r.height >= 1 && cs.visibility !== 'hidden' && Number(cs.opacity) > .05; };
    const label = el => `${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]} “${(el.getAttribute('aria-label') || el.innerText || '').trim().slice(0, 30)}”`;
    const up = (el, test) => { for (let a = el.parentElement; a && a !== document.documentElement; a = a.parentElement) { const cs = getComputedStyle(a); if (test(cs)) return a; } return null; };
    const scroller = el => up(el, cs => /auto|scroll/.test(cs.overflowX + cs.overflowY));
    const own = el => el.closest('.pdf-pane-filename,.attachment-name,.paper-item h3,.vault-file,.library h1~*,.nb-select,.memo-line') || /A long paper title/.test(el.innerText);
    for (const el of [...top.querySelectorAll('button,a,label,h1,h2,h3,strong,span,small,p,li,summary,[role="tab"]')].filter(e => shown(e) && e.innerText?.trim())) {
      const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
      if (cut && !own(el) && el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0 && /hidden|clip/.test(cs.overflowX)) out.push('cut ' + label(el));
      const clip = up(el, cs => cs.overflowX !== 'visible' || cs.overflowY !== 'visible');
      if (clip && !scroller(el)) { const c = clip.getBoundingClientRect(); if (r.right > c.right + 2 || r.left < c.left - 2) out.push('clipped ' + label(el)); }
      if (!scroller(el) && (r.right > W + 1 || r.left < -1)) out.push('outside ' + label(el));
    }
    for (const el of top.querySelectorAll('*')) if (shown(el) && /auto|scroll/.test(getComputedStyle(el).overflowX) && el.scrollWidth > el.clientWidth + 1 && !el.matches('.pdf-pane-tools,.nb-tools,.translated-pages')) out.push('scrolls ' + label(el));
    const controls = [...top.querySelectorAll('button,a,select,input,[role="tab"]')].filter(shown);
    for (const c of controls) for (const d of controls) if (c !== d && c.parentElement === d.parentElement && c.compareDocumentPosition(d) & 4) { const a = c.getBoundingClientRect(), b = d.getBoundingClientRect(); if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 2 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 2) out.push('overlap ' + label(c) + ' × ' + label(d)); }
    for (const c of controls) { const r = c.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2; if (x < 0 || x >= W || y < 0 || y >= H || scroller(c)) continue; const hit = document.elementFromPoint(x, y); if (hit && !c.contains(hit) && !hit.contains(c) && top.contains(hit) && !hit.closest('.pop-menu,.ink-flyout,.toast')) out.push('covered ' + label(c) + ' by ' + label(hit)); }
    return [...new Set(out)];
  }, { cut }).then(list => assert.deepEqual(list, [], `${where} at 800px`));
  try {
    // A new install: the screen follows the system's language (Korean only when the system is Korean).
    for (const [system, expected] of [['en-US', 'en'], ['ko-KR,en-US', 'ko']]) {
      const profile = path.join(temp, 'new-' + expected), p = await launch(profile, undefined, { APP_OS_LANGUAGES: system });
      const info = await p.evaluate(() => window.appApi.language);
      assert.deepEqual(info.os, system.split(',')); assert.equal(matchLanguage(info.os, 'ui') === 'ko' ? 'ko' : 'en', expected);
      assert.equal(info.ui, expected); assert.equal(await p.evaluate(() => appI18n.uiLanguage()), expected);
      assert.deepEqual(info.choices.ui, [{ code: 'ko', name: '한국어' }, { code: 'en', name: 'English' }]);
      assert.deepEqual(info.choices.translation, [{ code: 'ko', name: '한국어' }]); assert.equal(info.choices.ai.length, 8);
      assert.equal(info.aiResolved, expected); assert.equal(info.translation, null); assert.equal(info.ai, null);
      assert.equal(info.translationAsk, expected === 'en', 'an English system has no translation language yet');
      assert.equal(info.askUi, true, 'a new install is asked for its display language');
      await app.close(); app = null;
      // The choice made for the new install is kept with the next write of the settings, so it does not change with the system later.
      assert.equal((await readSettings(profile)).language.ui, expected);
    }
    // The first start of a new install asks for the display language (renderer.js languageFirst), once.
    {
      const loaded = (p, ui) => p.waitForFunction(ui => window.appApi?.language?.ui === ui && document.documentElement.lang === ui && typeof showShortcuts === 'function', ui);
      // A system in Japanese: English is picked ahead, nothing else can be pressed, and Korean on a press starts in Korean.
      let profile = path.join(temp, 'first-ja'), p = await launch(profile, undefined, { APP_OS_LANGUAGES: 'ja-JP' });
      await p.locator('.language-first').waitFor();
      assert.equal(await p.locator('[data-action="storage"]').count(), 0, 'nothing else to press before a language is chosen');
      assert.deepEqual(await p.locator('[data-first-language]').evaluateAll(list => list.map(b => [b.dataset.firstLanguage, b.getAttribute('aria-pressed')])), [['ko', 'false'], ['en', 'true']]);
      assert.match(await p.locator('.language-first').textContent(), /언어를 선택하세요[\s\S]*Choose your language/, 'the question is put in both languages');
      assert.equal(await p.evaluate(() => document.activeElement?.dataset.action), 'first-language-go', 'the focus is on the button that goes on');
      await p.setViewportSize({ width: 800, height: 600 }); await unfitAt(p, 'the language question');
      await p.locator('[data-first-language="ko"]').click(); assert.equal(await p.locator('[data-first-language="ko"]').getAttribute('aria-pressed'), 'true');
      await p.locator('[data-action="first-language-go"]').click(); await loaded(p, 'ko');
      await p.locator('[data-action="storage"]').first().waitFor(); assert.equal(await p.locator('.language-first').count(), 0);
      let kept = await readSettings(profile); assert.equal(kept.language.ui, 'ko'); assert.equal('languageAsk' in kept, false, 'answered: the key is gone');
      await app.close(); app = null;
      p = await launch(profile, undefined, { APP_OS_LANGUAGES: 'ja-JP' }); await p.locator('[data-action="storage"]').first().waitFor();
      assert.equal(await p.locator('.language-first').count(), 0, 'the next start does not ask'); assert.equal(await p.evaluate(() => document.documentElement.lang), 'ko');
      await app.close(); app = null;
      // The language picked ahead kept as it is: Enter alone goes on, with no reload.
      profile = path.join(temp, 'first-ko'); p = await launch(profile, undefined, { APP_OS_LANGUAGES: 'ko-KR' }); await p.locator('.language-first').waitFor();
      assert.equal(await p.locator('[data-first-language="ko"]').getAttribute('aria-pressed'), 'true');
      let loads = 0; p.on('load', () => { loads++; });
      await p.keyboard.press('Enter'); await p.locator('[data-action="storage"]').first().waitFor();
      kept = await readSettings(profile); assert.equal(kept.language.ui, 'ko'); assert.equal('languageAsk' in kept, false); assert.equal(loads, 0, 'the same language loads nothing again');
      await app.close(); app = null;
      // Closed without an answer: asked again at the next start.
      profile = path.join(temp, 'first-unanswered'); p = await launch(profile, undefined, { APP_OS_LANGUAGES: 'en-US' }); await p.locator('.language-first').waitFor();
      await app.close(); app = null;
      p = await launch(profile, undefined, { APP_OS_LANGUAGES: 'en-US' }); await p.locator('.language-first').waitFor();
      // The settings cannot be written: it is told, and the start screen follows for this run.
      await app.evaluate(() => { const fs = process.mainModule.require('node:fs/promises'), rename = fs.rename; fs.rename = async (from, to) => { if (String(to).endsWith('settings.json')) throw Object.assign(Error('EACCES: permission denied'), { code: 'EACCES' }); return rename(from, to); }; });
      await p.locator('[data-action="first-language-go"]').click(); await p.locator('#toast').waitFor(); await p.locator('[data-action="storage"]').first().waitFor();
      assert.equal(await p.locator('.language-first').count(), 0);
      await app.close(); app = null;
      // An install in use (a settings file as 1.0.0 left it, without the key) is not asked.
      profile = path.join(temp, 'first-in-use'); await fs.mkdir(profile); await fs.writeFile(path.join(profile, 'settings.json'), JSON.stringify({ recents: [] }));
      p = await launch(profile, undefined, { APP_OS_LANGUAGES: 'en-US' }); await p.locator('[data-action="storage"]').first().waitFor();
      assert.equal(await p.locator('.language-first').count(), 0); assert.equal(await p.evaluate(() => document.documentElement.lang), 'ko');
      await app.close(); app = null;
    }
    // An English screen on a system with a language a translation can be in takes that language without asking (DEVELOPMENT.md 언어 설정).
    {
      const profile = path.join(temp, 'english-korean-system'), p = await launch(profile, 'en', { APP_OS_LANGUAGES: 'ja-JP,ko-KR' });
      const info = await p.evaluate(() => window.appApi.language);
      assert.equal(info.ui, 'en'); assert.equal(info.translationResolved, 'ko'); assert.equal(info.translationAsk, false);
      const translationDefault = () => p.evaluate(() => { const box = document.createElement('div'); box.innerHTML = languageSection(); return box.querySelector('#language-translation option').textContent; });
      assert.equal(await translationDefault(), 'Automatic (한국어)', 'the settings say what the default does under an English screen');
      // A change the settings file does not take changes nothing, and the window is told why.
      const settingsFile = path.join(profile, 'settings.json'); await fs.rm(settingsFile, { force: true }); await fs.mkdir(path.join(settingsFile, 'blocked'), { recursive: true });
      assert.notEqual(await p.evaluate(() => window.appApi.setLanguage({ ai: 'ja' }).then(() => 'kept', error => error.message)), 'kept');
      assert.deepEqual(await p.evaluate(() => [window.appApi.readLanguage().ai, window.appApi.readLanguage().aiResolved, aiLanguageNow]), [null, 'en', 'en']);
      await fs.rm(settingsFile, { recursive: true, force: true });
      const kept = await p.evaluate(() => window.appApi.setLanguage({ ai: 'ja' })); assert.equal(kept.aiResolved, 'ja'); assert.equal((await readSettings(profile)).language.ai, 'ja');
      await app.close(); app = null;
    }
    // An install already in use: a settings file without language keeps Korean; a damaged value is made safe.
    for (const [name, settings] of [['used', { recents: [] }], ['damaged', { recents: [], language: { ui: 'fr', translation: 'en', ai: 42 } }]]) {
      const profile = path.join(temp, name); await fs.mkdir(profile); await fs.writeFile(path.join(profile, 'settings.json'), JSON.stringify(settings));
      const p = await launch(profile), info = await p.evaluate(() => window.appApi.language);
      assert.equal(info.ui, 'ko', name); assert.equal(info.translation, null, name); assert.equal(info.ai, null, name); assert.equal(info.translationResolved, 'ko', name);
      assert.equal(info.translationAsk, false, `${name}: a Korean screen never asks for the translation language`);
      await p.locator('.welcome-guide').waitFor(); assert.match(await p.locator('.welcome-guide').textContent(), /폴더를 저장소로 연결/);
      await app.close(); app = null;
      assert.deepEqual((await readSettings(profile)).language, { ui: 'ko', translation: null, ai: null }, name);
    }
    // APP_UI_LANG holds for this run only: a change of another setting stores what was stored, not the override.
    {
      const profile = path.join(temp, 'override'); await fs.mkdir(profile); await fs.writeFile(path.join(profile, 'settings.json'), JSON.stringify({ recents: [], language: { ui: 'ko', translation: null, ai: null } }));
      let p = await launch(profile, 'en');
      assert.equal(await p.evaluate(() => window.appApi.language.ui), 'en'); assert.equal(await p.evaluate(() => appI18n.uiLanguage()), 'en');
      const changed = await p.evaluate(() => window.appApi.setLanguage({ ai: 'ja' }));
      assert.equal(changed.ui, 'en'); assert.equal(changed.ai, 'ja'); assert.equal(changed.aiResolved, 'ja');
      assert.deepEqual((await readSettings(profile)).language, { ui: 'ko', translation: null, ai: 'ja' });
      // A language the list does not offer is refused, with its code in front of the message.
      assert.match(await p.evaluate(() => window.appApi.setLanguage({ ui: 'fr' }).then(() => 'kept', error => error.message)), /⟦APP_BAD_LANGUAGE⟧/);
      await app.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }); }, vault);
      await p.locator('[data-action="storage"]').first().click(); await p.locator('.paper-item').waitFor();
      const paperId = await p.evaluate(() => papers[0].id), vaultId = await p.evaluate(() => state.storageKey);
      // While an AI request waits for its model the screen language stays; the other two settings change.
      await app.evaluate(({ app }) => {
        const { ChatGPT } = process.getBuiltinModule('module').createRequire(app.getAppPath() + '/package.json')('./desktop/chatgpt.cjs');
        ChatGPT.prototype.status = () => ({ connected: true, usable: true, persistent: false });
        ChatGPT.prototype.models = () => new Promise(resolve => { globalThis.releaseModels = () => resolve([]); });
      });
      const asking = p.evaluate(([id, paperId]) => window.appApi.aiMemo(id, paperId, 'fixture-model', { mode: 'ask' }).then(() => 'answered', error => error.message), [vaultId, paperId]); asking.catch(() => {});
      await app.evaluate(async () => { for (let i = 0; i < 100 && !globalThis.releaseModels; i++) await new Promise(r => setTimeout(r, 20)); });
      assert.match(await p.evaluate(() => window.appApi.setLanguage({ ui: 'ko' }).then(() => 'changed', error => error.message)), /⟦APP_BUSY⟧/);
      assert.equal((await p.evaluate(() => window.appApi.setLanguage({ ai: 'fr' }))).ai, 'fr');
      assert.equal(await p.evaluate(() => window.appApi.language.ui), 'en', 'no reload while refused');
      await app.evaluate(() => globalThis.releaseModels()); assert.match(await asking, /Choose a model/); // the main process answers in the screen language
      assert.equal((await p.evaluate(() => window.appApi.setLanguage({ ai: 'ja' }))).ai, 'ja');
      // A window opened later (a view window) is handed the same settings.
      const opened = app.waitForEvent('window'); await p.evaluate(([id, paperId]) => window.appApi.viewWindow(id, paperId, null, 1, 'original'), [vaultId, paperId]);
      const view = await opened; await view.waitForLoadState();
      assert.deepEqual(await view.evaluate(() => [window.appApi.language.ui, window.appApi.language.ai, typeof window.appApi.setLanguage]), ['en', 'ja', 'function']);
      assert.match(await view.evaluate(() => window.appApi.setLanguage({ ai: null }).then(() => 'kept', error => error.message)), /That request is not allowed/);
      // An AI language set in the main window reaches the other windows as they are (no reload).
      await view.evaluate(() => { window.appApi.onLanguageChanged(info => { window.heardAi = info.ai; }); });
      await p.evaluate(() => window.appApi.setLanguage({ ai: 'fr' })); await view.waitForFunction(() => window.heardAi === 'fr');
      await p.evaluate(() => window.appApi.setLanguage({ ai: 'ja' })); await view.waitForFunction(() => window.heardAi === 'ja');
      // A new screen language: the memo the page has not saved yet is saved, then the windows load again in the new language.
      await p.evaluate(id => { notes[`${id}-메모`] = 'typed just before the switch'; window.beforeSwitch = true; }, paperId);
      const viewReloaded = view.waitForEvent('load');
      await p.evaluate(() => { window.appApi.setLanguage({ ui: 'ko' }).catch(() => {}); });
      await p.waitForFunction(() => !window.beforeSwitch && window.appApi?.language?.ui === 'ko' && typeof showShortcuts === 'function');
      await viewReloaded; assert.equal(await view.evaluate(() => window.appApi.language.ui), 'ko');
      assert.equal(await p.evaluate(() => appI18n.uiLanguage()), 'ko');
      const library = JSON.parse(await fs.readFile(path.join(vault, appName.vaultDir, 'library.json'), 'utf8'));
      assert.equal(library.notes[`${paperId}-메모`], 'typed just before the switch');
      assert.deepEqual((await readSettings(profile)).language, { ui: 'ko', translation: null, ai: 'ja' });
      // The page opens again on the vault and the paper it had open, with the memo.
      await p.waitForFunction(([id, paperId]) => state.storageKey === id && state.selected === paperId && notes[`${paperId}-메모`] === 'typed just before the switch', [vaultId, paperId]);
      await app.close(); app = null;
    }
    // Choosing the languages on screen (DEVELOPMENT.md 언어 설정): the screen language on the start screen, the three in the settings.
    {
      const profile = path.join(temp, 'choose'), folder = path.join(temp, 'vault-choose'); await fs.mkdir(profile); await fs.mkdir(folder);
      await fs.copyFile(path.join(vault, 'paper.pdf'), path.join(folder, 'paper.pdf'));
      await fs.writeFile(path.join(profile, 'settings.json'), JSON.stringify({ recents: [], language: { ui: 'ko', translation: null, ai: null } }));
      const p = await launch(profile); let loads = 0; p.on('load', () => { loads++; });
      const options = selector => p.locator(selector).locator('option').evaluateAll(list => list.map(o => [o.value, o.textContent]));
      const loaded = ui => p.waitForFunction(ui => window.appApi?.language?.ui === ui && document.documentElement.lang === ui && typeof showShortcuts === 'function', ui);
      const stored = async (key, value) => { for (let i = 0; i < 100 && (await readSettings(profile)).language[key] !== value; i++) await new Promise(r => setTimeout(r, 50)); assert.equal((await readSettings(profile)).language[key], value, key); };
      assert.equal(await p.evaluate(() => document.documentElement.lang), 'ko');
      // The start screen: each language named in itself; a choice loads the window again in that language.
      await p.locator('.welcome-language [data-welcome-language]').first().waitFor();
      assert.deepEqual(await p.locator('.welcome-language [data-welcome-language]').evaluateAll(list => list.map(b => [b.dataset.welcomeLanguage, b.textContent.trim(), b.getAttribute('aria-pressed')])), [['ko', '한국어', 'true'], ['en', 'English', 'false']]);
      assert.equal(await p.locator('#welcome-language').count(), 0, 'the list box is gone');
      await p.locator('[data-welcome-language="en"]').click(); await loaded('en');
      assert.equal(await p.evaluate(() => appI18n.uiLanguage()), 'en'); assert.equal(await p.locator('[data-welcome-language="en"]').getAttribute('aria-pressed'), 'true');
      assert.equal((await readSettings(profile)).language.ui, 'en');
      await p.locator('[data-welcome-language="ko"]').click(); await loaded('ko');
      assert.match(await p.locator('.welcome-guide').textContent(), /폴더를 저장소로 연결/); assert.equal((await readSettings(profile)).language.ui, 'ko');
      // The settings: a 언어 group above 모양, with the three lists.
      await app.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }); }, folder);
      await p.locator('[data-action="storage"]').first().click(); await p.locator('.paper-item').waitFor();
      const paperId = await p.evaluate(() => papers[0].id), vaultId = await p.evaluate(() => state.storageKey), memoKey = `${paperId}-메모`;
      const openLanguage = async () => { await p.locator('[data-action="settings"]').first().click(); await p.locator('#dialog[open] [data-llm-section="language"] summary').click(); await p.locator('#language-ui').waitFor(); };
      await openLanguage();
      const sections = await p.evaluate(() => [...document.querySelectorAll('#dialog [data-llm-section]')].map(s => s.dataset.llmSection));
      assert.equal(sections.indexOf('language') + 1, sections.indexOf('look'), sections.join());
      assert.equal(await p.locator('[data-llm-section="language"] summary h3').textContent(), '언어');
      assert.deepEqual(await p.evaluate(() => ['ui', 'translation', 'ai'].map(k => document.querySelector(`label[for="language-${k}"]`).textContent)), ['화면 언어', '번역 결과 언어', 'AI 답변 언어']);
      const choices = await p.evaluate(() => window.appApi.language.choices), same = ['', '화면 언어와 같게'];
      assert.deepEqual(await options('#language-ui'), [['ko', '한국어'], ['en', 'English']]);
      assert.deepEqual(await options('#language-translation'), [same, ...choices.translation.map(c => [c.code, c.name])]);
      assert.deepEqual(await options('#language-ai'), [same, ...choices.ai.map(c => [c.code, c.name])]); assert.equal(choices.ai.length, 8);
      assert.deepEqual(await p.evaluate(() => ['ui', 'translation', 'ai'].map(k => document.querySelector(`#language-${k}`).value)), ['ko', '', '']);
      // The answer and result languages change at once, without loading the window again.
      await p.evaluate(() => { window.stay = true; });
      await p.locator('#language-ai').selectOption('ja'); await stored('ai', 'ja');
      await p.locator('#language-translation').selectOption('ko'); await stored('translation', 'ko');
      await p.locator('#language-translation').selectOption(''); await stored('translation', null);
      await p.locator('#language-ai').selectOption(''); await stored('ai', null);
      assert.equal(await p.evaluate(() => window.stay), true, 'no reload for the answer and result languages');
      // While an AI request waits for its model the screen language stays, the list shows it again and a notice says why.
      await app.evaluate(({ app }) => {
        const { ChatGPT } = process.getBuiltinModule('module').createRequire(app.getAppPath() + '/package.json')('./desktop/chatgpt.cjs');
        ChatGPT.prototype.status = () => ({ connected: true, usable: true, persistent: false });
        globalThis.releaseModels = null; ChatGPT.prototype.models = () => new Promise(resolve => { globalThis.releaseModels = () => resolve([]); });
      });
      const asking = p.evaluate(([id, paperId]) => window.appApi.aiMemo(id, paperId, 'fixture-model', { mode: 'ask' }).then(() => 'answered', error => error.message), [vaultId, paperId]); asking.catch(() => {});
      await app.evaluate(async () => { for (let i = 0; i < 100 && !globalThis.releaseModels; i++) await new Promise(r => setTimeout(r, 20)); });
      await p.locator('#language-ui').selectOption('en');
      await p.waitForFunction(() => document.querySelector('#toast.show')?.textContent === '번역이나 AI 요청이 끝난 뒤 화면 언어를 바꾸세요.');
      await p.waitForFunction(() => document.querySelector('#language-ui').value === 'ko');
      assert.equal(await p.evaluate(() => window.stay && window.appApi.language.ui), 'ko'); assert.equal((await readSettings(profile)).language.ui, 'ko');
      await app.evaluate(() => globalThis.releaseModels()); assert.match(await asking, /모델/);
      // A memo typed but not saved yet when the screen language changes is there after the window loads again.
      const before = loads;
      await p.evaluate(key => { notes[key] = 'typed in the memo, then the language'; noteEdited(key, notes[key]); const list = document.querySelector('#language-ui'); list.value = 'en'; list.dispatchEvent(new Event('change', { bubbles: true })); }, memoKey);
      await loaded('en'); assert.equal(loads, before + 1);
      assert.equal(await p.evaluate(() => [window.stay, appI18n.uiLanguage()].join()), ',en');
      await p.waitForFunction(([id, key]) => state.storageKey === id && notes[key] === 'typed in the memo, then the language', [vaultId, memoKey]);
      assert.equal(JSON.parse(await fs.readFile(path.join(folder, appName.vaultDir, 'library.json'), 'utf8')).notes[memoKey], 'typed in the memo, then the language');
      assert.equal((await readSettings(profile)).language.ui, 'en');
      // While the windows save before loading again, no model request starts, and quick changes (en → ko → en → ko) load them once.
      await openLanguage(); assert.equal(await p.locator('#language-ui').inputValue(), 'en');
      await p.evaluate(() => { const flush = globalThis.appFlushAll, held = []; window.flushes = 0; window.releaseFlush = () => held.forEach(resolve => resolve()); globalThis.appFlushAll = async () => { window.flushes++; await new Promise(resolve => held.push(resolve)); await flush?.(); }; });
      const reloads = loads; await p.locator('#language-ui').selectOption('ko'); await p.waitForFunction(() => window.flushes === 1);
      await app.evaluate(({ app }) => { const { ChatGPT } = process.getBuiltinModule('module').createRequire(app.getAppPath() + '/package.json')('./desktop/chatgpt.cjs'); ChatGPT.prototype.models = async () => [{ id: 'fixture-model', name: 'Fixture' }]; });
      assert.match(await p.evaluate(([id, paperId]) => window.appApi.aiMemo(id, paperId, 'fixture-model', { mode: 'ask' }).then(() => 'answered', error => error.message), [vaultId, paperId]), /⟦APP_BUSY⟧/);
      assert.match(await p.evaluate(([id, paperId]) => window.appApi.startTranslation(id, paperId, 'hash', [], 'fixture-model', {}).then(() => 'started', error => error.message), [vaultId, paperId]), /⟦APP_BUSY⟧/);
      assert.equal((await p.evaluate(() => window.appApi.setLanguage({ ui: 'en' }))).ui, 'en');
      assert.equal((await p.evaluate(() => window.appApi.setLanguage({ ui: 'ko' }))).ui, 'ko');
      await p.waitForTimeout(300); assert.equal(await p.evaluate(() => window.flushes), 1, 'the later changes join the reload that waits');
      await p.evaluate(() => window.releaseFlush()); await loaded('ko'); await p.waitForTimeout(1500);
      assert.equal(loads, reloads + 1, 'one reload for quick changes');
      assert.equal((await readSettings(profile)).language.ui, 'ko'); assert.equal(await p.evaluate(() => appI18n.uiLanguage()), 'ko');
      await p.waitForFunction(id => state.storageKey === id, vaultId);
      await app.close(); app = null;
    }
    // The English screen for the text of the screen base, settings › look and general, help and the main-process
    // feature names and themes (desktop/app.js, appearance.js, help.js, features.cjs, themes.cjs): no Korean is shown.
    {
      const profile = path.join(temp, 'english-base'), folder = path.join(temp, 'vault-english'); await fs.mkdir(profile); await fs.mkdir(folder);
      await fs.copyFile(path.join(vault, 'paper.pdf'), path.join(folder, 'paper.pdf'));
      const p = await launch(profile, 'en'), shown = selector => shownIn(p, selector);
      // The main process answers in English: feature names and refusals, the example theme it writes, a theme's error.
      const features = await p.evaluate(() => window.appApi.featureSet('notifications', true));
      assert.equal(features.notifications.label, 'Translation-finished notifications');
      assert.equal(await p.evaluate(() => window.appApi.featureSet('no-such-feature', true).then(() => 'set', error => plainError(error))), 'Unknown feature.');
      const themes = await p.evaluate(() => window.appApi.themesList());
      assert.equal(themes.themes.find(t => t.id === 'example-warm')?.name, 'Warm paper (example)');
      noKorean(await fs.readFile(path.join(themes.root, 'themes', 'example-warm', 'theme.css'), 'utf8'), 'example theme file');
      noKorean(await fs.readFile(path.join(themes.root, 'snippets', 'note-serif.css'), 'utf8'), 'example snippet file');
      await fs.mkdir(path.join(themes.root, 'themes', 'bad-theme')); await fs.writeFile(path.join(themes.root, 'themes', 'bad-theme', 'manifest.json'), JSON.stringify({ id: 'other', name: 'Bad' }));
      assert.match((await p.evaluate(() => window.appApi.themesList())).themes.find(t => t.id === 'bad-theme').error, /^The id must match the folder name \(bad-theme\)/);
      // A menu command before a vault is open, the shortcuts, and settings › look and general.
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('menu-command', 'tag-ai'));
      await p.waitForFunction(() => document.querySelector('#toast')?.textContent); noKorean(await p.locator('#toast').textContent(), 'menu notice');
      await p.evaluate(() => showShortcuts()); await p.locator('#dialog[open] .shortcut-help').waitFor();
      noKorean(await shown('#dialog[open] .shortcut-help, #dialog[open] .shortcut-help ~ p, #dialog[open] .actions'), 'shortcuts');
      assert.match(await p.locator('#dialog[open] .shortcut-sep').allTextContents().then(parts => parts.join(' ')), /\bor\b/);
      await p.evaluate(() => dialog.close());
      await p.evaluate(() => { themeInfo = null; return openGPTSettings(); }); await p.locator('#dialog[open] [data-llm-section="look"]').waitFor();
      await p.evaluate(() => document.querySelectorAll('#dialog[open] [data-llm-section="look"], #dialog[open] [data-llm-section="general"]').forEach(section => { section.open = true; }));
      await p.locator('#dialog[open] [data-llm-section="look"] #kn-theme-select').waitFor();
      noKorean(await shown('#dialog[open] [data-llm-section="look"] .llm-body, #dialog[open] [data-llm-section="look"] summary small'), 'settings › look');
      noKorean(await shown('#dialog[open] [data-llm-section="general"] .llm-body, #dialog[open] [data-llm-section="general"] summary small'), 'settings › general');
      await p.evaluate(() => dialog.close());
      // The notice that the vault was changed by another program.
      await app.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }); }, folder);
      await p.locator('[data-action="storage"]').first().click(); await p.locator('.paper-item').waitFor();
      await p.evaluate(() => askVaultReload()); await p.locator('#dialog[open] [data-action="vault-reload"]').waitFor();
      noKorean(await shown('#dialog[open] .dialog-head h2, #dialog[open] .dialog-inner > p, #dialog[open] .actions'), 'outside change notice');
      await app.close(); app = null;
    }
    // The English screen for the library area (desktop/library.js, tags.js, review.js): the bibliography, the batch bar,
    // the tags list, the dialogs for bibliography, citation, tags, DOI and saved searches, and the vault manager's own parts.
    {
      const profile = path.join(temp, 'english-library'), folder = path.join(temp, 'vault-english-library'); await fs.mkdir(profile); await fs.mkdir(folder);
      await fs.copyFile(path.join(vault, 'paper.pdf'), path.join(folder, 'paper.pdf'));
      const p = await launch(profile, 'en'), shown = selector => shownIn(p, selector);
      await app.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }); }, folder);
      await p.locator('[data-action="storage"]').first().click(); await p.locator('.paper-item').waitFor();
      noKorean(await shownHtml(p, await p.evaluate(() => bibliography(papers[0]))), 'bibliography');
      noKorean(await shown('.tag-list'), 'tags list');
      // The batch bar; its AI group is insight.js's (not moved yet). A read status chosen there is stored as the Korean value.
      const bar = await p.evaluate(() => { batchSelection.add(papers[0].id); return batchBar(); });
      noKorean(await shownHtml(p, bar, '.batch-group:has([data-action^="ai-"])'), 'batch bar');
      assert.deepEqual(await p.evaluate(bar => { const box = document.createElement('div'); box.innerHTML = bar; return [...box.querySelectorAll('#batch-status option')].filter(o => o.value).map(o => [o.value, o.textContent]); }, bar), [['읽기 전', 'To read'], ['읽는 중', 'Reading'], ['완독', 'Read']]);
      await p.evaluate(() => batchSelection.clear());
      const dialogs = [['edit bibliography', () => editBibliography()], ['citation', () => citeDialog()], ['new tag', () => newTagDialog()], ['assign tags', () => tagAssignDialog([papers[0].id])], ['add by DOI', () => addByDOI()], ['save search', () => actions['save-search']()]];
      for (const [where, open] of dialogs) {
        await p.evaluate(open); await p.locator('#dialog[open] .dialog-inner').waitFor();
        noKorean(await shown('#dialog[open] .dialog-head h2, #dialog[open] .dialog-inner > :not(.dialog-head)'), where);
        await p.evaluate(() => dialog.close());
      }
      // The vault manager: its tabs and the sections library.js adds.
      await p.evaluate(() => showVaultManager()); await p.locator('#dialog[open] .vm-tabs').waitFor();
      // The 'close' of the dialog closed just before can come after the vault manager is open (it is queued): it must not
      // take back the vault manager's width, or its tabs scroll at 800px (it did now and then, after the settings above).
      await p.evaluate(() => dialog.dispatchEvent(new Event('close'))); assert.ok(await p.evaluate(() => dialog.open && dialog.classList.contains('vault-manager')), 'a late close leaves the open vault manager as it is');
      noKorean(await shown('#dialog[open] .vm-tabs, #dialog[open] .sync-section, #dialog[open] .rules-section, #dialog[open] .glossary-section'), 'vault manager');
      await p.evaluate(() => dialog.close());
      await app.close(); app = null;
    }
    // The English screen for renderer.js: the start screen, the library with its sidebar and item details, the settings
    // with their section titles, the vault manager with its tabs, and the collections section shown or hidden.
    {
      const profile = path.join(temp, 'english-desktop'), folder = path.join(temp, 'vault-english-desktop'); await fs.mkdir(profile); await fs.mkdir(folder);
      await fs.copyFile(path.join(vault, 'paper.pdf'), path.join(folder, 'paper.pdf'));
      const p = await launch(profile, 'en', { APP_SHOW_HIDDEN_FEATURES: '1' }), shown = selector => shownIn(p, selector);
      noKorean(await shown('main.welcome'), 'start screen');
      await app.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }); }, folder);
      await p.locator('[data-action="storage"]').first().click(); await p.locator('.paper-item').waitFor();
      noKorean(await shown('#navigation-panel'), 'sidebar');
      noKorean(await shown('.library'), 'library');
      noKorean(await shown('#notes-panel'), 'item details');
      await p.evaluate(() => openGPTSettings()); await p.locator('#dialog[open] [data-llm-section="look"]').waitFor();
      await p.evaluate(() => document.querySelectorAll('#dialog[open] [data-llm-section]').forEach(section => { section.open = true; }));
      await p.locator('#dialog[open] #kn-theme-select').waitFor();
      noKorean(await shown('#dialog[open] .dialog-inner'), 'settings');
      assert.deepEqual(await p.evaluate(() => [...document.querySelectorAll('#dialog[open] [data-llm-section] summary h3')].map(h => h.textContent)), ['ChatGPT account', 'Local model', 'API connections', 'Language', 'Look', 'Notifications · help']);
      await p.evaluate(() => dialog.close());
      // The vault manager's tabs come from its parts' marks, not their wording; collections join only when turned on.
      const managerTabs = async () => { await p.evaluate(() => showVaultManager()); await p.locator('#dialog[open] .vm-tabs').waitFor(); const tabs = await p.evaluate(() => [...document.querySelectorAll('#dialog[open] .vm-tabs [role="tab"]')].map(t => t.textContent.trim())); noKorean(await shown('#dialog[open] .dialog-inner'), 'vault manager'); await p.evaluate(() => dialog.close()); return tabs; };
      assert.deepEqual(await managerTabs(), ['Translation', 'AI', 'Bibliography', 'Backup', 'Sync', 'Trash']);
      await p.evaluate(async () => { desktopPreferences.features = await window.appApi.featureSet('collections', true); });
      assert.deepEqual(await managerTabs(), ['Translation', 'AI', 'Bibliography', 'Backup', 'Sync', 'Trash', 'Collections']);
      await p.evaluate(async () => { desktopPreferences.features = await window.appApi.featureSet('collections', false); });
      assert.deepEqual(await managerTabs(), ['Translation', 'AI', 'Bibliography', 'Backup', 'Sync', 'Trash']);
      // The reader: the original pane's header and the item tabs (tools from files not moved yet are left out).
      await p.locator('.paper-item').first().click(); await p.evaluate(() => actions.read()); await p.locator('.original-pane .pdf-pane-header').waitFor();
      noKorean(await shown('.original-pane .pdf-pane-header, .reader-panel .tabs'), 'reader');
      assert.ok(await p.locator('.reader-view-modes [data-mode="notebook"]').count(), 'the notebook button is there in English');
      // A view the reader named keeps its name, even one that reads like the app's own (a saved search or a collection named 메모).
      const vaultId = await p.evaluate(() => state.storageKey);
      await p.evaluate(async id => { applyItemSnapshot(await window.appApi.saveSearch(id, { name: '메모', query: '', filter: '전체', collectionId: null, tag: null, fullText: false }), { screen: 'library' }); }, vaultId);
      await p.locator('[data-saved-search]').first().click(); await p.waitForFunction(() => document.querySelector('.library h1')?.textContent);
      assert.equal(await p.locator('.library h1').textContent(), '메모');
      await p.evaluate(async id => { applyItemSnapshot(await window.appApi.createCollection(id, '메모'), { screen: 'library' }); }, vaultId);
      await p.evaluate(() => { const c = itemCollections.find(x => x.name === '메모'); Object.assign(state, { screen: 'library', folder: null, desktopTag: null, collection: c.id, nav: c.name, query: '', filter: '전체' }); render(); });
      assert.equal(await p.locator('.library h1').textContent(), '메모');
      // Even one named like the app's own views: a saved search named 즐겨찾기, a collection named 전체 자료.
      // The app's own view of that name is still in English.
      await p.evaluate(async id => { applyItemSnapshot(await window.appApi.saveSearch(id, { name: '즐겨찾기', query: '', filter: '전체', collectionId: null, tag: null, fullText: false }), { screen: 'library' }); }, vaultId);
      await p.locator('[data-saved-search]').nth(1).click(); await p.waitForFunction(() => state.savedSearch);
      assert.equal(await p.locator('.library h1').textContent(), '즐겨찾기');
      // The name stays after the vault sends a new snapshot (a star is clicked).
      await p.locator('.paper-item [data-star]').first().click(); await p.waitForFunction(() => papers.some(x => x.star));
      assert.equal(await p.locator('.library h1').textContent(), '즐겨찾기'); assert.ok(await p.evaluate(() => state.savedSearch));
      await p.locator('.paper-item [data-star]').first().click(); await p.waitForFunction(() => !papers.some(x => x.star));
      await p.locator('[data-nav="즐겨찾기"]').click(); await p.waitForFunction(() => !state.savedSearch);
      assert.equal(await p.locator('.library h1').textContent(), 'Favorites');
      await p.evaluate(async id => { applyItemSnapshot(await window.appApi.createCollection(id, '전체 자료'), { screen: 'library' }); }, vaultId);
      await p.evaluate(() => { const c = itemCollections.find(x => x.name === '전체 자료'); Object.assign(state, { screen: 'library', folder: null, desktopTag: null, collection: c.id, nav: c.name, query: '', filter: '전체' }); render(); });
      assert.equal(await p.locator('.library h1').textContent(), '전체 자료');
      await app.close(); app = null;
    }
    // The English screen for memos, summaries, annotations and the memo editor (desktop/notes.js, markdown.js,
    // live-editor.mjs), and what the AI notice says is sent from a memo.
    {
      const profile = path.join(temp, 'english-memo'), folder = path.join(temp, 'vault-english-memo'); await fs.mkdir(profile); await fs.mkdir(folder);
      await fs.copyFile(path.join(vault, 'paper.pdf'), path.join(folder, 'paper.pdf'));
      const p = await launch(profile, 'en'), shown = selector => shownIn(p, selector);
      await app.evaluate(({ app, dialog }, folder) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] });
        // A ChatGPT account that answers at once, so the memo AI panel can be seen with its results.
        const { ChatGPT } = process.getBuiltinModule('module').createRequire(app.getAppPath() + '/package.json')('./desktop/chatgpt.cjs');
        ChatGPT.prototype.status = () => ({ connected: true, usable: true, email: 'fixture@example.test', persistent: false });
        ChatGPT.prototype.models = async () => [{ id: 'fixture-model', name: 'Fixture GPT' }];
        globalThis.memoInstructions = []; ChatGPT.prototype.respond = async (_model, _input, instructions) => { globalThis.memoInstructions.push(instructions); return '```markdown\nA tidier memo\n```'; };
      }, folder);
      await p.locator('[data-action="storage"]').first().click(); await p.locator('.paper-item').waitFor();
      await p.locator('.paper-item').first().click(); await p.evaluate(() => actions.read()); await p.locator('.reader-panel').waitFor();
      await p.locator('.reader-panel [data-tab="메모"]').click(); await p.locator('.memo-tab').waitFor();
      noKorean(await shown('.memo-tab'), 'memo tab, empty');
      await p.locator('[data-action="memo-new"]').click(); await p.locator('.memo-card.open').waitFor();
      noKorean(await shown('.memo-tab'), 'memo tab, a new memo');
      await p.locator('.memo-card.open [data-memo-wide]').click(); await p.locator('#dialog[open] .md-toolbar').waitFor();
      noKorean(await shown('#dialog[open] .dialog-inner'), 'memo editor');
      assert.equal(await p.evaluate(() => { modelGroupsShown = [{ id: 'gpt-web', kind: 'web', label: 'ChatGPT', models: [] }]; return modelNotice({ connection: 'gpt-web' }, tr('질문과 {what} 내용', { what: tr('이 메모') })); }), 'Sends your question and the text of this memo to ChatGPT. The account\'s usage and limits apply.');
      await p.evaluate(() => dialog.close());
      await p.locator('.reader-panel [data-tab="요약"]').click(); await p.locator('.summary-tab').waitFor();
      noKorean(await shown('.summary-tab'), 'summary tab');
      await p.locator('.reader-panel [data-tab="주석"]').click(); await p.locator('.annot-tab').waitFor();
      noKorean(await shown('.annot-tab'), 'annotations tab');
      noKorean(await shownHtml(p, await p.evaluate(() => renderMarkdown('$\\frac{1$ (p. 3)\n\n![](note-image:' + '0'.repeat(32) + '.png)'))), 'Markdown notices');
      // A memo head the app wrote is stored in Korean and named in the display language.
      assert.equal(await p.evaluate(() => { const box = document.createElement('div'); box.innerHTML = renderMarkdown('[그림 설명 · Fixture GPT]\n\nText'); return box.querySelector('.md-figure span').textContent; }), 'Figure explanation · Fixture GPT');
      // The memo AI panel: its hint, presets, model chip and the buttons under a result, asking and revising.
      await p.locator('.reader-panel [data-tab="메모"]').click(); await p.locator('.memo-card.open').waitFor();
      const key = await p.locator('.memo-card.open').getAttribute('data-memo');
      await p.evaluate(k => setNote(k, 'My memo about the opening line.'), key);
      await p.locator('.memo-card.open .memo-card-head [data-memo-ai]').click(); await p.locator('#dialog[open] .note-ai #editor-ai-instruction').waitFor();
      assert.equal(await p.locator('#dialog[open] .md-toolbar [data-md="heading"]').getAttribute('title'), 'Heading');
      noKorean(await shown('#dialog[open] .note-ai'), 'memo AI panel, asking');
      await p.locator('#editor-ai-instruction').fill('What does it mean?'); await p.locator('[data-editor-ai-send]').click(); await p.locator('.memo-ai-preview').waitFor();
      noKorean(await shown('#dialog[open] .note-ai'), 'memo AI panel, an answer');
      assert.deepEqual(await p.locator('#dialog[open] .note-ai-result button').allTextContents(), ['Discard', 'Add to the memo']);
      await p.locator('[data-editor-ai-discard]').click();
      // Quick requests are in the screen language: sent as written while the AI answers in Japanese, they ask for a
      // Japanese answer; a question the reader wrote, or a quick one they changed, is answered in its own language.
      const lastSent = () => app.evaluate(() => globalThis.memoInstructions.at(-1));
      const ask = async (fill) => { await fill(); await p.locator('[data-editor-ai-send]').click(); await p.locator('.memo-ai-preview').waitFor(); const sent = await lastSent(); await p.locator('[data-editor-ai-discard]').click(); return sent; };
      const preset = () => p.locator('#dialog[open] [data-memo-ai-preset]').first().click();
      assert.doesNotMatch(await ask(preset), /answer in [^.]+ instead/, 'the AI answers in the screen language: nothing to name');
      await p.evaluate(() => window.appApi.setLanguage({ ai: 'ja' })); await p.waitForFunction(() => aiLanguageNow === 'ja');
      assert.equal(await p.evaluate(() => window.appApi.readLanguage().aiResolved), 'ja', 'a page that starts listening late reads the change');
      assert.match(await ask(preset), / For this request, answer in Japanese instead\.$/);
      assert.doesNotMatch(await ask(async () => { await preset(); await p.locator('#editor-ai-instruction').press('End'); await p.locator('#editor-ai-instruction').pressSequentially(' in two lines'); }), /answer in [^.]+ instead/, 'a changed quick request');
      assert.doesNotMatch(await ask(() => p.locator('#editor-ai-instruction').fill('What does it mean?')), /answer in [^.]+ instead/, 'a written question');
      await p.evaluate(() => window.appApi.setLanguage({ ai: null })); await p.waitForFunction(() => aiLanguageNow === 'en');
      await p.locator('[data-memo-ai-mode="edit"]').click(); await p.locator('[data-memo-ai-preset]').first().waitFor();
      noKorean(await shown('#dialog[open] .note-ai'), 'memo AI panel, revising');
      await p.locator('#editor-ai-instruction').fill('Tidy it'); await p.locator('[data-editor-ai-send]').click(); await p.locator('.memo-ai-preview').waitFor();
      noKorean(await shown('#dialog[open] .note-ai'), 'memo AI panel, a rewrite');
      assert.deepEqual(await p.locator('#dialog[open] .note-ai-result button').allTextContents(), ['Discard', 'Add below', 'Replace']);
      await p.evaluate(() => dialog.close());
      // A memo with a figure head and a pin: its title and the pin's place are in English; the head itself stays as stored.
      await p.evaluate(k => { setNote(k, '[그림 설명 · 2쪽]\n\nThe horizontal axis is time.'); notes[k + '#pin'] = JSON.stringify({ page: 2, x: .3, y: .2 }); openMemoKey = null; refreshMemos(); }, key);
      noKorean(await shown('.memo-tab'), 'memo tab, a figure memo with a pin');
      assert.match(await shown(`.memo-card[data-memo="${key}"]`), /Figure explanation · p\. 2/);
      await p.evaluate(k => { openMemoKey = k; refreshMemos(); }, key); await p.locator(`.memo-card.open[data-memo="${key}"]`).waitFor();
      assert.equal(await p.locator(`.memo-card.open [data-memo-pin]`).getAttribute('title'), 'Remove pin (original, page 2)');
      // Annotation cards: a figure explanation and a plain annotation.
      await p.evaluate(async () => {
        const id = state.storageKey, paperId = state.selected, attachmentId = state.selectedAttachment, sourceHash = await window.appApi.originalHash(id, paperId, attachmentId);
        await window.appApi.addAnnotation(id, paperId, attachmentId, { page: 1, body: 'The horizontal axis is time.', sourceHash, kind: 'figure', model: 'Fixture GPT' });
        applyAnnotations(await window.appApi.addAnnotation(id, paperId, attachmentId, { page: 1, quote: 'A research paper', body: 'A note on the opening line.', sourceHash }), '주석');
      });
      await p.locator('.annot-tab .memo-card').nth(1).waitFor();
      const annotations = await shown('.annot-tab'); noKorean(annotations, 'annotations tab, two cards');
      assert.match(annotations, /Figure explanation/);
      await app.close(); app = null;
    }
    // The English screen for ink and notebooks (desktop/ink.js, desktop/notebook.js).
    {
      const profile = path.join(temp, 'english-ink'), folder = path.join(temp, 'vault-english-ink'); await fs.mkdir(profile); await fs.mkdir(folder);
      await fs.copyFile(path.join(vault, 'paper.pdf'), path.join(folder, 'paper.pdf'));
      const p = await launch(profile, 'en'), shown = selector => shownIn(p, selector), dialogShown = () => shown('#dialog[open] .dialog-inner');
      await p.setViewportSize({ width: 1400, height: 950 }); // as the notebook smoke; the 800px width has its own case below
      await app.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }); }, folder);
      await p.locator('[data-action="storage"]').first().click(); await p.locator('.paper-item').waitFor();
      await p.locator('.paper-item').first().click(); await p.evaluate(() => actions.read()); await p.locator('.ink-toolbar').waitFor();
      // The toolbar, each tool's choices, the text box bar, the color pop-up and the PDF save dialog.
      noKorean(await shown('.ink-toolbar'), 'ink toolbar');
      for (const group of ['pointer', 'shape', 'eraser', 'text']) noKorean(await shownHtml(p, await p.evaluate(g => inkFlyout(g), group)), `ink ${group} choices`);
      noKorean(await shownHtml(p, await p.evaluate(() => inkTextBarHtml(inkTextStyleOf(null)))), 'text box bar');
      await p.locator('.ink-toolbar [data-ink-add-color]').click(); await p.locator('.ink-color-panel').waitFor();
      noKorean(await shown('.ink-color-panel'), 'color panel'); await p.keyboard.press('Escape');
      await p.evaluate(() => inkExportDialog('original')); await p.locator('#dialog[open] #ink-export-include').waitFor();
      noKorean(await dialogShown(), 'PDF save'); await p.evaluate(() => dialog.close());
      // Collected annotations: an annotation's kind and the page are in English.
      await p.evaluate(async () => {
        const id = state.storageKey, paperId = state.selected, attachmentId = state.selectedAttachment, sourceHash = await window.appApi.originalHash(id, paperId, attachmentId);
        applyAnnotations(await window.appApi.addAnnotation(id, paperId, attachmentId, { page: 1, quote: 'A research paper', body: 'A note on the opening line.', sourceHash }));
      });
      await p.evaluate(() => actions['collect-annotations']()); await p.locator('#dialog[open] .annotation-collection').waitFor();
      const collected = await dialogShown(); noKorean(collected, 'collected annotations'); assert.match(collected, /p\. 1\s+Annotation\s+"A research paper"/);
      await p.evaluate(() => dialog.close());
      // A notebook: the empty pane, the new notebook dialog, the pane with a page, its menus and the memo picker.
      await p.locator('.reader-view-modes [data-mode="notebook"]').click(); await p.locator('.notebook-pane [data-action="nb-new"]').first().waitFor();
      noKorean(await shown('.notebook-pane'), 'notebook pane, empty');
      await p.locator('.notebook-pane .pdf-empty [data-action="nb-new"]').click(); await p.locator('#dialog[open] #nb-title').waitFor();
      noKorean(await dialogShown(), 'new notebook'); assert.equal(await p.locator('#nb-title').inputValue(), 'paper notes');
      await p.locator('#dialog[open] [data-action="nb-create"]').click(); await p.locator('.notebook-pane .nb-page').waitFor();
      noKorean(await shown('.notebook-pane'), 'notebook pane, a page');
      for (const [button, where] of [['[data-nb-add]', 'add page menu'], ['[data-nb-page-menu]', 'page menu'], ['[data-nb-save-menu]', 'save menu']]) {
        await p.locator(`.notebook-pane ${button}`).first().click(); await p.locator('.pop-menu').waitFor();
        noKorean(await shown('.pop-menu'), where); await p.evaluate(() => closePopMenu());
      }
      // 메모 넣기 is a small window beside its button; a paper with no memo says so there.
      assert.equal(await p.evaluate(() => nbMemos().length), 0, 'this paper has no memo yet');
      await (await toolShown(p, '.notebook-pane [data-action="nb-memo"]')).click(); await p.locator('.pop-menu.nb-memo-menu').waitFor();
      const memoMenu = await shown('.pop-menu.nb-memo-menu'); noKorean(memoMenu, 'memo insert window'); assert.equal(await p.locator('#dialog[open]').count(), 0);
      assert.match(memoMenu, /Insert a memo/); assert.ok(memoMenu.includes(await p.evaluate(() => tr('이 논문에 메모가 없습니다.'))), memoMenu);
      await p.evaluate(() => closePopMenu());
      // A pin on a notebook page: where it is, and the title a memo pinned there gets.
      assert.deepEqual(await p.evaluate(() => { const place = { notebookId: nb.doc.id, pageId: nb.doc.pages[0].id }; return [nbPlaceLabel(place), nbPinTitle(place)]; }), ['notebook ‘paper notes’, page 1', 'Memo on paper notes, p. 1']);
      await app.close(); app = null;
    }
    // The library head in Korean at the narrowest window: its longer names (중복 자료 후보) fit as well.
    {
      const profile = path.join(temp, 'korean-narrow'), folder = path.join(temp, 'vault-korean-narrow'); await fs.mkdir(profile); await fs.mkdir(folder);
      await fs.copyFile(path.join(vault, 'paper.pdf'), path.join(folder, 'A long paper title about research methods.pdf')); await fs.copyFile(path.join(vault, 'paper.pdf'), path.join(folder, 'second.pdf'));
      const p = await launch(profile, 'ko'); await p.setViewportSize({ width: 800, height: 600 });
      await app.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }); }, folder);
      await p.locator('[data-action="storage"]').first().click(); await p.locator('.paper-item').nth(1).waitFor();
      assert.equal((await p.locator('.library-title [data-action="duplicates"]').innerText()).trim(), '중복 자료 후보');
      await unfitAt(p, 'library in Korean');
      await app.close(); app = null;
    }
    // The English screen at the narrowest window (800px wide): nothing is cut off, covered, outside the
    // window or overlapping, and nothing scrolls sideways but the tool rows made to scroll. Text that
    // is the reader's own (a long file name) may end in an ellipsis.
    {
      const profile = path.join(temp, 'english-narrow'), folder = path.join(temp, 'vault-english-narrow'); await fs.mkdir(profile); await fs.mkdir(folder);
      await fs.copyFile(path.join(vault, 'paper.pdf'), path.join(folder, 'A long paper title about research methods.pdf')); await fs.copyFile(path.join(vault, 'paper.pdf'), path.join(folder, 'second.pdf'));
      const p = await launch(profile, 'en', { APP_SHOW_HIDDEN_FEATURES: '1' }); await p.setViewportSize({ width: 800, height: 600 });
      await app.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }); }, folder);
      const unfit = (where, options) => unfitAt(p, where, options);
      await p.locator('[data-action="storage"]').first().click(); await p.locator('.paper-item').nth(1).waitFor();
      await unfit('library');
      assert.equal((await p.locator('.library-title [data-action="duplicates"]').innerText()).trim() + '…', 'Possible duplicates…', 'the library head names it as the menu does');
      await p.evaluate(() => document.querySelectorAll('[data-batch-paper]').forEach(b => b.click())); await p.locator('.batch-group').first().waitFor(); await unfit('library with the batch bar');
      await p.keyboard.press('Escape'); await p.evaluate(() => { batchSelection.clear(); state.selected = papers[0].id; render(); });
      await p.evaluate(() => openGPTSettings()); await p.locator('#dialog[open] [data-llm-section]').first().waitFor(); await p.evaluate(() => document.querySelectorAll('#dialog[open] [data-llm-section]').forEach(s => { s.open = true; }));
      await unfit('settings'); await p.evaluate(() => dialog.close());
      await p.evaluate(() => showVaultManager()); await p.locator('#dialog[open] .vm-tabs').waitFor();
      for (let i = 0; i < await p.locator('#dialog[open] .vm-tabs [role="tab"]').count(); i++) { await p.locator('#dialog[open] .vm-tabs [role="tab"]').nth(i).click(); await unfit(`vault manager tab ${i + 1}`); }
      await p.evaluate(() => dialog.close());
      await p.evaluate(() => actions.read()); await p.locator('.ink-toolbar').waitFor(); await p.waitForTimeout(300);
      // The figure box and underline toggles in the 주석 tab beside 모아 보기, named in English (the reader at 800px is checked below).
      await p.locator('.reader-panel [data-tab="주석"]').click(); await p.locator('.annot-tab [data-action="toggle-figure-boxes"]').waitFor();
      assert.deepEqual(await p.evaluate(() => ['toggle-figure-boxes', 'toggle-annotation-underlines'].map(a => [document.querySelector(`[data-action="${a}"]`)?.getAttribute('aria-label'), document.querySelector(`[data-action="${a}"]`)?.title])), [['Show figure boxes', 'Show figure boxes'], ['Show annotation underlines', 'Show annotation underlines']]);
      for (const tab of ['서지', '첨부', '요약', '주석', '메모', '태그']) { await p.locator(`.reader-panel [data-tab="${tab}"]`).click(); await unfit(`reader, ${tab} tab`); }
      for (const group of ['pointer', 'shape', 'eraser', 'text']) { await p.locator(`.ink-toolbar [data-ink-group="${group}"]`).click(); if (!await p.locator('.ink-flyout').count()) await p.locator(`.ink-toolbar [data-ink-group="${group}"]`).click(); await unfit(`ink ${group} choices`); }
      await p.locator('.reader-view-modes [data-mode="notebook"]').click(); await p.locator('.notebook-pane .pdf-empty').waitFor();
      await p.locator('.notebook-pane .pdf-empty [data-action="nb-new"]').click(); await p.locator('#dialog[open] [data-action="nb-create"]').click(); await p.locator('.notebook-pane .nb-page').waitFor();
      // Three panes share 800px here, so a pane's label may end in an ellipsis; nothing may be covered or overlap.
      await unfit('notebook', { cut: false });
      // 메모 넣기 beside its button, with memos, at 800px.
      await p.evaluate(() => { for (let i = 0; i < 12; i++) setNote(`${state.selected}-메모-m${i}`, `A memo about the method, number ${i + 1}`); refreshMemos(); }); assert.equal(await p.evaluate(() => nbMemos().length), 12);
      await (await toolShown(p, '.notebook-pane [data-action="nb-memo"]')).click(); await p.locator('.pop-menu.nb-memo-menu').waitFor();
      noKorean(await shownIn(p, '.pop-menu.nb-memo-menu'), 'memo insert window with memos'); await unfit('memo insert window'); await p.evaluate(() => closePopMenu());
      await app.close(); app = null;
    }
    // The English screen for AI results and the translation reader (desktop/insight.js, core/pdf-view.js),
    // at a usual size and at the 800px minimum.
    {
      const profile = path.join(temp, 'english-ai'), folder = path.join(temp, 'vault-english-ai'); await fs.mkdir(profile); await fs.mkdir(folder);
      await fs.copyFile(path.join(vault, 'paper.pdf'), path.join(folder, 'paper.pdf'));
      const other = await PDFDocument.create(), otherFont = await other.embedFont(StandardFonts.Helvetica); other.addPage([600, 800]).drawText('Another study compares reading speed.', { x: 40, y: 740, size: 14, font: otherFont });
      await fs.writeFile(path.join(folder, 'other.pdf'), await other.save());
      const p = await launch(profile, 'en'), shown = selector => shownIn(p, selector), dialogShown = () => shown('#dialog[open] .dialog-inner');
      await p.setViewportSize({ width: 1400, height: 950 });
      await app.evaluate(({ app, dialog }, folder) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] });
        // A ChatGPT account that answers at once in English: summaries, questions, comparisons and translations.
        const { ChatGPT } = process.getBuiltinModule('module').createRequire(app.getAppPath() + '/package.json')('./desktop/chatgpt.cjs');
        ChatGPT.prototype.status = () => ({ connected: true, usable: true, email: 'fixture@example.test', persistent: false });
        ChatGPT.prototype.models = async () => [{ id: 'fixture-model', name: 'Fixture GPT' }];
        ChatGPT.prototype.translate = async (_model, blocks) => blocks.map(b => ({ id: b.id, text: 'A research paper connects ideas.' }));
        globalThis.aiCalls = 0; ChatGPT.prototype.respond = async (_model, input, instructions) => { globalThis.aiCalls++;
          const body = JSON.parse(input[0].content); if (body.paperSample) return JSON.stringify({ keywords: [] });
          if (/Compare the research papers/.test(instructions)) { const [a, b] = body.papers; return JSON.stringify({ rows: [{ aspect: 'Result', cells: [{ paper: 'P1', text: 'Faster reading', basis: 'paper', evidence: [a.blocks[0].id] }, { paper: 'P2', text: 'No difference', basis: 'model', evidence: [b.blocks[0].id, a.blocks[0].id] }] }] }); }
          const blocks = body.blocks || body.context || body.evidence, first = blocks[0].id;
          if (/Summarize/.test(instructions)) return JSON.stringify({ question: [{ text: 'How layout affects reading', basis: 'paper', evidence: [first] }], result: [{ text: 'A model reading', basis: 'model', evidence: [first, 'p99-b9'] }, { text: 'A claim without a source', basis: 'paper', evidence: [] }] });
          return JSON.stringify({ answer: [{ text: 'It connects ideas.', basis: 'paper', evidence: [first] }], insufficient: false });
        };
      }, folder);
      await p.locator('[data-action="storage"]').first().click(); await p.locator('.paper-item').nth(1).waitFor();
      await p.locator('.paper-item').filter({ hasText: 'paper' }).first().click(); await p.evaluate(() => actions.read()); await p.locator('.original-pages .page[data-page="1"] .textLayer span').first().waitFor();
      // AI records left by git with conflict marks (a vault synced with git): with both sides readable the tab shows the
      // records of both, with no notice; with neither, it says which file cannot be read, in English, and the rest works.
      const aiFile = path.join(folder, appName.vaultDir, 'ai', await p.evaluate(() => state.selectedAttachment) + '.json');
      const record = (id, createdAt) => `    {\n      "id": "${id}",\n      "createdAt": "${createdAt}",\n      "connection": "gpt-web",\n      "model": "fixture-model",\n      "kind": "ask",\n      "question": "Q ${id}",\n      "sections": { "answer": [{ "text": "An answer", "basis": "paper", "evidence": [] }] },\n      "coverage": {},\n      "rejected": [],\n      "adoptions": []\n    }`;
      const conflicted = (ours, theirs) => `{\n  "version": 1,\n  "results": [\n<<<<<<< HEAD:.${nameFirst.id}/ai/x.json\n${ours}\n=======\n${theirs}\n>>>>>>> 716c02e:.${appName.id}/ai/x.json\n  ]\n}\n`;
      const openSummary = async () => { await p.evaluate(() => { const key = targetKey(); insightState.results.delete(key); insightState.loading?.delete(key); insightState.unreadable?.delete(key); document.querySelector('#toast').textContent = ''; }); await p.locator('.reader-panel [data-tab="메모"]').click(); await p.locator('.reader-panel [data-tab="요약"]').click(); await p.locator('.insight-panel').waitFor(); };
      await fs.mkdir(path.dirname(aiFile), { recursive: true }); await fs.writeFile(aiFile, conflicted(record('aaaa', '2026-10-29T01:00:00.000Z'), record('bbbb', '2026-11-10T01:00:00.000Z')));
      await openSummary(); await p.locator('.insight-card').nth(1).waitFor();
      assert.equal(await p.locator('.insight-card').count(), 2); assert.equal(await p.evaluate(() => document.querySelector('#toast').textContent), '', 'no notice');
      await fs.writeFile(aiFile, conflicted(record('aaaa', '2026-10-29T01:00:00.000Z') + ',,', record('bbbb', '2026-11-10T01:00:00.000Z') + ',,'));
      await openSummary(); await p.locator('.insight-results-panel .error').waitFor();
      const unreadable = await shown('.insight-results-panel'); noKorean(unreadable, 'AI records that cannot be read');
      assert.match(unreadable, new RegExp('cannot be read \\(git merge conflict markers are left in it\\): ' + RegExp.escape(appName.vaultDir) + '/ai/[-a-z0-9]+\\.json')); assert.ok(!unreadable.includes(folder), 'no folder of the computer');
      assert.equal(await p.evaluate(() => document.querySelector('#toast').textContent), '', 'no notice'); assert.equal(await p.locator('#insight-question').isEnabled(), true, 'the question box still works');
      // Nothing is sent while the records cannot be read: the buttons say why, and the main process refuses before the model.
      assert.equal(await p.locator('.insight-panel .composer-send').isDisabled(), true); assert.equal(await p.locator('[data-action="ai-summary"]').isDisabled(), true);
      assert.match(await p.locator('[data-action="ai-summary"]').getAttribute('title'), /cannot be read, so no AI request is sent/);
      const calls = await app.evaluate(() => globalThis.aiCalls);
      assert.match(await p.evaluate(async () => { const hash = await window.appApi.originalHash(state.storageKey, state.selected, state.selectedAttachment); return window.appApi.aiRun(state.storageKey, state.selected, state.selectedAttachment, 'ask', 'fixture-model', { connection: 'gpt-web', sourceHash: hash, question: 'q', blocks: [{ id: 'p1-b1', page: 1, text: 'A research paper connects ideas.' }] }).then(() => 'sent', error => error.message); }), /⟦APP_AI_RECORDS_UNREADABLE⟧/);
      assert.equal(await app.evaluate(() => globalThis.aiCalls), calls, 'the model was not asked');
      await fs.rm(aiFile); await openSummary();
      noKorean(await shown('.insight-panel, .insight-results-panel'), 'AI panel, no results');
      // A structured summary: the dialog, then its card closed and open (sources, a model's reading, one without a source).
      await p.locator('[data-action="ai-summary"]').click(); await p.locator('#dialog[open] [data-action="ai-send"]').waitFor();
      noKorean(await dialogShown(), 'summary dialog');
      await p.locator('#dialog[open] [data-action="ai-send"]').click(); await p.locator('.insight-card').waitFor();
      noKorean(await shown('.insight-results-panel'), 'AI records, a summary');
      await p.locator('.insight-card').first().click(); await p.locator('.insight-card.open').waitFor();
      const card = await shown('.insight-results-panel'); noKorean(card, 'AI records, the summary open');
      assert.match(card, /Structured summary/); assert.match(card, /Model's interpretation/); assert.match(card, /Insufficient evidence/);
      // A question about the item.
      await p.locator('#insight-question').fill('What does it connect?'); await p.locator('[data-insight-ask] button').click(); await p.locator('#dialog[open] [data-action="ai-send"]').waitFor();
      noKorean(await dialogShown(), 'question dialog');
      await p.locator('#dialog[open] [data-action="ai-send"]').click(); await p.locator('.insight-card').nth(1).waitFor();
      noKorean(await shown('.insight-results-panel'), 'AI records, a question');
      // What the app writes into a memo is in the language of the result it comes from (here English, then Japanese);
      // a head written in any language, and the Korean ones written before, show as chips named in the screen language.
      await p.evaluate(() => window.appApi.setLanguage({ ai: 'ja' })); await p.waitForFunction(() => aiLanguageNow === 'ja');
      const results = () => p.evaluate(() => insightState.results.get(targetKey()).map(r => ({ id: r.id, kind: r.kind, language: r.language })));
      const summaryCard = await p.evaluate(() => [...document.querySelectorAll('[data-ai-adopt]')].map(b => b.dataset.aiAdopt).at(-1)); assert.ok(summaryCard, 'a result card offers to add it');
      const asked = (await results()).find(r => r.kind === 'summary'); assert.equal(asked.language, 'en', 'asked before the change');
      await p.evaluate(id => adoptInsight(id), asked.id);
      const adopted = () => p.evaluate(() => notes[`${state.selected}-summary-0`] || '');
      assert.match(await adopted(), /^\[AI structured summary · fixture-model · [A-Z][a-z]{2} \d{1,2}, \d{4}\]\n/, 'an English result keeps an English head after the change');
      const before = (await results()).length;
      await p.locator('[data-action="ai-summary"]').click(); await p.locator('#dialog[open] [data-action="ai-send"]').click();
      await p.waitForFunction(n => insightState.results.get(targetKey()).length > n, before);
      const japanese = (await results()).find(r => r.kind === 'summary'); assert.equal(japanese.language, 'ja');
      await p.evaluate(id => adoptInsight(id), japanese.id);
      assert.match(await adopted(), /\n\n\[AI 構造化要約 · fixture-model · \d{4}\/\d{1,2}\/\d{1,2}\]\n/, 'a Japanese result gets a Japanese head');
      // A result saved before results recorded a language is Korean.
      assert.deepEqual(await p.evaluate(() => [{ translation: 't', sections: { explanation: [{ text: 'x', basis: 'model', evidence: [] }] } }, { language: 'ja', translation: 't', sections: { explanation: [{ text: 'x', basis: 'model', evidence: [] }] } }].map(explainMarkdown)),
        ['**번역** t\n\n- (모델 해석) x', '**訳文** t\n\n- (モデルの解釈) x']);
      const chip = source => p.evaluate(text => { const box = document.createElement('div'); box.innerHTML = renderMarkdown(text); const head = box.querySelector('.md-figure'); return [head?.querySelector('span').textContent, head?.querySelector('[data-annotation-page]')?.dataset.annotationPage]; }, source);
      assert.deepEqual(await chip('[AI 解説 · a.pdf · 4ページ · Fixture GPT]\n\nText'), ['AI explanation · a.pdf · 4ページ · Fixture GPT', '4']);
      assert.deepEqual(await chip('[AI 설명 · a.pdf · 4페이지 · Fixture GPT]\n\nText'), ['AI explanation · a.pdf · 4페이지 · Fixture GPT', '4']);
      assert.deepEqual(await chip('[그림 설명 · a.pdf · 2페이지 · Fixture GPT]'), ['Figure explanation · a.pdf · 2페이지 · Fixture GPT', '2']);
      assert.equal(await p.evaluate(() => memoGlance('[AI 解説 · a.pdf · 4ページ · m]\nThe answer.').line), 'The answer.');
      await p.evaluate(() => window.appApi.setLanguage({ ai: null })); await p.waitForFunction(() => aiLanguageNow === 'en'); // follows the English screen again
      await p.setViewportSize({ width: 800, height: 600 }); await unfitAt(p, 'AI results'); await p.setViewportSize({ width: 1400, height: 950 });
      // The translation. An English screen on an English system has no translation language yet (only Korean can be
      // one): the first translation asks, with the note that others are coming. Cancelling keeps nothing, and the
      // main process starts no translation before one is chosen.
      assert.equal(await p.evaluate(() => window.appApi.readLanguage().translationAsk), true);
      assert.equal(await p.evaluate(() => { const box = document.createElement('div'); box.innerHTML = languageSection(); return box.querySelector('#language-translation option').textContent; }), 'Ask when translating');
      await p.locator('.reader-view-modes [data-mode="dual"]').click(); await p.locator('#dialog[open] #translation-language').waitFor();
      assert.deepEqual(await p.locator('#translation-language option').evaluateAll(list => list.map(o => [o.value, o.textContent])), [['', 'Choose a language'], ['ko', '한국어']]);
      const asking = await dialogShown(); noKorean(asking, 'translation dialog asking for the language'); assert.match(asking, /More languages are coming\./);
      await p.setViewportSize({ width: 800, height: 600 }); await unfitAt(p, 'translation dialog asking for the language'); await p.setViewportSize({ width: 1400, height: 950 });
      await p.locator('#dialog[open] [data-action="gpt-start"]').click(); assert.equal(await p.evaluate(() => dialog.open && !document.querySelector('#translation-language').validity.valid), true, 'not started without a language');
      await p.locator('#dialog[open] button.secondary[data-action="close"]').click(); await p.waitForFunction(() => !dialog.open);
      assert.equal((await readSettings(profile)).language.translation, null, 'cancelling keeps nothing');
      assert.match(await p.evaluate(() => window.appApi.startTranslation(state.storageKey, state.selected, 'x', [], 'fixture-model', {}).then(() => 'started', error => error.message)), /⟦APP_TRANSLATION_LANGUAGE⟧Choose the translation language first\./);
      await p.evaluate(() => ensureTranslation(true)); await p.locator('#dialog[open] #translation-language').selectOption('ko');
      await p.locator('#dialog[open] [data-action="gpt-start"]').click();
      await p.locator('.translated-block').first().waitFor();
      noKorean(await shown('.translated-pane'), 'translated pages');
      await (await toolShown(p, '[data-action="toggle-translation-reading"]')).click(); await p.locator('.section-page-label').first().waitFor();
      const sections = await shown('.translated-pane'); noKorean(sections, 'section view'); assert.match(sections, /Original page 1/);
      // Korean is kept, and the next translation does not ask.
      assert.equal((await readSettings(profile)).language.translation, 'ko'); assert.equal(await p.evaluate(() => window.appApi.readLanguage().translationAsk), false);
      // Korean chosen on an English system: the settings' empty value still says what choosing it would do (ask again).
      assert.equal(await p.evaluate(() => { const box = document.createElement('div'); box.innerHTML = languageSection(); return box.querySelector('#language-translation option').textContent; }), 'Ask when translating');
      await p.evaluate(() => ensureTranslation(true)); await p.locator('#dialog[open] [data-action="gpt-start"]').waitFor();
      assert.equal(await p.locator('#dialog[open] #translation-language').count(), 0); await p.locator('#dialog[open] button.secondary[data-action="close"]').click();
      // Set back to the screen's language while a translation window is open: starting asks again, before the paper is
      // read, in the window as it was asked for (a resumed translation stays a resume, keeping its finished chunks).
      await p.evaluate(() => ensureTranslation(true, { resume: true })); await p.locator('#dialog[open] [data-action="gpt-start"]').waitFor();
      assert.equal(await p.evaluate(() => translationOptions.force), false, 'a resume reuses what is done');
      await p.evaluate(() => window.appApi.setLanguage({ translation: null }));
      await p.locator('#dialog[open] [data-action="gpt-start"]').click(); await p.locator('#dialog[open] #translation-language').waitFor();
      assert.equal(await p.evaluate(() => currentJob?.state === 'failed'), false, 'no failed translation');
      assert.deepEqual(await p.evaluate(() => [translationRequest.force, translationRequest.options.resume, translationRequest.options.firstPage, translationOptions.force]), [true, true, 1, false], 'asked again as it was asked for');
      // Closed while the choice is being kept: the choice stays, and no translation starts.
      const jobs = await p.evaluate(() => currentJob?.id ?? null);
      await p.evaluate(() => { document.querySelector('#translation-language').value = 'ko'; startGPTTranslation(); dialog.close(); });
      await p.waitForFunction(() => window.appApi.readLanguage().translation === 'ko');
      assert.equal(await p.evaluate(() => currentJob?.id ?? null), jobs, 'nothing started');
      // Another window put in its place meanwhile: the same.
      await p.evaluate(() => window.appApi.setLanguage({ translation: null })); await p.evaluate(() => ensureTranslation(true)); await p.locator('#dialog[open] #translation-language').waitFor();
      await p.evaluate(() => { document.querySelector('#translation-language').value = 'ko'; startGPTTranslation(); modal('Other', '<p id="other-window">Other</p>'); });
      await p.waitForFunction(() => window.appApi.readLanguage().translation === 'ko');
      assert.equal(await p.evaluate(() => currentJob?.id ?? null), jobs, 'nothing started under another window'); assert.equal(await p.locator('#dialog[open] #other-window').count(), 1);
      await p.evaluate(() => dialog.close());
      await p.setViewportSize({ width: 800, height: 600 }); await unfitAt(p, 'section view'); await p.setViewportSize({ width: 1400, height: 950 });
      await (await toolShown(p, '[data-action="toggle-translation-reading"]')).click();
      // A comparison of two items from the batch bar.
      await p.evaluate(() => { state.screen = 'library'; state.mode = 'original'; render(); }); await p.locator('.paper-item').nth(1).waitFor();
      await p.evaluate(() => document.querySelectorAll('[data-batch-paper]').forEach(b => b.click())); await p.locator('[data-action="ai-compare"]').waitFor();
      noKorean(await shown('.batch-group'), 'batch bar');
      await p.locator('[data-action="ai-compare"]').click(); await p.locator('#dialog[open] [data-action="ai-compare-send"]').waitFor();
      noKorean(await dialogShown(), 'compare dialog');
      await p.setViewportSize({ width: 800, height: 600 }); await unfitAt(p, 'compare dialog');
      await p.locator('#dialog[open] [data-action="ai-compare-send"]').click(); await p.locator('#dialog[open] .compare-table').waitFor();
      noKorean(await dialogShown(), 'comparison'); await unfitAt(p, 'comparison');
      await p.evaluate(() => dialog.close());
      // The main process in English: every menu label, an error it sends, and the error the sandboxed preload codes.
      const menuLabels = await app.evaluate(({ Menu }) => { const out = []; const walk = items => items.forEach(i => { if (i.label) out.push(i.label); if (i.submenu) walk(i.submenu.items); }); walk(Menu.getApplicationMenu().items); return out; });
      assert.ok(menuLabels.includes('&File') && menuLabels.includes('Copy diagnostic information'), menuLabels.join(', '));
      noKorean(menuLabels.join('\n'), 'menus');
      // One name for each action: the menu's, the library head's and the shortcut list's.
      for (const label of ['Add files…', 'Refresh file list', 'Possible duplicates…', 'Autofill bibliography']) assert.ok(menuLabels.includes(label), label);
      for (const old of ['Add PDF…', 'Refresh folders']) assert.ok(!menuLabels.includes(old), old);
      assert.equal(await p.evaluate(async () => window.appApi.deleteSearch(state.storageKey, 'no-such-search').then(() => 'deleted', error => plainError(error))), 'The saved search does not exist.');
      assert.equal(await p.evaluate(() => shownError(Error('⟦APP_DROP_NOT_FILE⟧x'))), 'Drag a PDF file saved on your computer.');
      await app.close(); app = null;
    }
    console.log('language smoke passed');
  } finally {
    await app?.close().catch(() => {});
    await fs.rm(temp, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exit(1); });
