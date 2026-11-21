// The three language settings (docs/DEVELOPMENT.md, 언어 설정):
// the screen, the translation result and the AI's answers, with what each falls back to.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { LANGUAGES, languagesFor, matchLanguage } = require('../core/languages.cjs');
const { normalizeLanguage, initialLanguage, aiLanguage, translationLanguage, patchLanguage, startupLanguage, languageInfo } = require('../desktop/language.cjs');

test('a new install follows the system; an install already in use stays Korean', () => {
  assert.equal(initialLanguage({ existingInstall: false, osLanguages: ['ko-KR'] }).ui, 'ko');
  assert.equal(initialLanguage({ existingInstall: false, osLanguages: ['ja-JP', 'en-US'] }).ui, 'en');
  assert.equal(initialLanguage({ existingInstall: true, osLanguages: ['en-US'] }).ui, 'ko');
  assert.deepEqual(initialLanguage({ existingInstall: false, osLanguages: [] }), { ui: 'en', translation: null, ai: null });
});
test('settings from elsewhere are made safe', () => {   // Review Focus 3
  assert.deepEqual(normalizeLanguage({ ui: 'fr', translation: 'xx', ai: 'ja' }), { ui: 'ko', translation: null, ai: 'ja' });
  assert.deepEqual(normalizeLanguage('en'), { ui: 'ko', translation: null, ai: null });
  assert.deepEqual(normalizeLanguage({ ui: 'en', translation: 'en' }), { ui: 'en', translation: null, ai: null }); // en은 번역 결과 언어가 아님
  assert.deepEqual(normalizeLanguage(null), { ui: 'ko', translation: null, ai: null });
  assert.deepEqual(normalizeLanguage({ ui: 'en', ai: 'toString' }), { ui: 'en', translation: null, ai: null });
});
test('the AI answers in the display language unless one was chosen', () => {
  assert.equal(aiLanguage({ ui: 'en', ai: null }), 'en'); assert.equal(aiLanguage({ ui: 'en', ai: 'zh-Hans' }), 'zh-Hans');
});
test('the translation language: chosen, else the display language, else the system, else asked', () => {
  assert.deepEqual(translationLanguage({ ui: 'ko', translation: null }, ['en-US']), { code: 'ko', ask: false });
  assert.deepEqual(translationLanguage({ ui: 'en', translation: 'ko' }, ['en-US']), { code: 'ko', ask: false });
  assert.deepEqual(translationLanguage({ ui: 'en', translation: null }, ['ko-KR']), { code: 'ko', ask: false });
  assert.deepEqual(translationLanguage({ ui: 'en', translation: null }, ['ja-JP']), { code: null, ask: true });
});
test('system language tags are matched to the list', () => {
  assert.equal(matchLanguage(['zh-CN'], 'ai'), 'zh-Hans'); assert.equal(matchLanguage(['zh-TW'], 'ai'), null);
  assert.equal(matchLanguage(['pt-BR', 'de-AT'], 'ai'), 'de'); assert.equal(matchLanguage(['ja'], 'ui'), null);
  assert.equal(matchLanguage(['zh-SG'], 'ai'), 'zh-Hans'); assert.equal(matchLanguage(['zh-Hans-CN'], 'ai'), 'zh-Hans'); assert.equal(matchLanguage(['zh-HK'], 'ai'), null);
  assert.equal(matchLanguage(['en_US'], 'ui'), 'en'); assert.equal(matchLanguage(['KO'], 'translation'), 'ko');
  assert.equal(matchLanguage(undefined, 'ui'), null); assert.equal(matchLanguage([null, 42, 'fr-CA'], 'ai'), 'fr');
});
test('the list holds the eight languages with what each is offered for', () => {
  assert.deepEqual(Object.keys(LANGUAGES), ['ko', 'en', 'zh-Hans', 'ja', 'fr', 'de', 'es', 'it']);
  assert.deepEqual(LANGUAGES.ko, { code: 'ko', name: '한국어', englishName: 'Korean', ui: true, ai: true, translation: true });
  assert.deepEqual(LANGUAGES['zh-Hans'], { code: 'zh-Hans', name: '中文(简体)', englishName: 'Simplified Chinese', ui: false, ai: true, translation: false });
  assert.deepEqual(languagesFor('ui').map(l => l.code), ['ko', 'en']);
  assert.deepEqual(languagesFor('translation').map(l => l.code), ['ko']);
  assert.equal(languagesFor('ai').length, 8);
  assert.deepEqual(languagesFor('nothing'), []);
});
test('a change is checked before it is kept, and only the fields named change', () => {
  assert.deepEqual(patchLanguage({ ui: 'ko', translation: null, ai: 'ja' }, { ui: 'en' }), { ui: 'en', translation: null, ai: 'ja' });
  assert.deepEqual(patchLanguage({ ui: 'en', translation: 'ko', ai: 'ja' }, { translation: null, ai: null }), { ui: 'en', translation: null, ai: null });
  for (const patch of [{ ui: 'fr' }, { translation: 'en' }, { ai: 'xx' }, { ui: null }, null, 'en', []]) assert.throws(() => patchLanguage({ ui: 'ko', translation: null, ai: null }, patch), error => error.code === 'APP_BAD_LANGUAGE', JSON.stringify(patch));
});
test('APP_UI_LANG sets the screen for this run only', () => {
  const stored = { ui: 'en', translation: null, ai: 'ja' };
  assert.deepEqual(startupLanguage(stored, 'ko'), { ui: 'ko', translation: null, ai: 'ja' });
  assert.deepEqual(startupLanguage(stored, 'fr'), stored); assert.deepEqual(startupLanguage(stored, undefined), stored);
  assert.deepEqual(stored, { ui: 'en', translation: null, ai: 'ja' });
});
test('the windows are handed the settings, what they resolve to and the lists to choose from', () => {
  const info = languageInfo({ ui: 'en', translation: null, ai: null }, ['ja-JP']);
  assert.deepEqual(info, { ui: 'en', translation: null, ai: null, askUi: false, aiResolved: 'en', translationResolved: null, translationAsk: true, translationUnchosen: { code: null, ask: true }, os: ['ja-JP'],
    choices: { ui: [{ code: 'ko', name: '한국어' }, { code: 'en', name: 'English' }], ai: languagesFor('ai').map(({ code, name }) => ({ code, name })), translation: [{ code: 'ko', name: '한국어' }] } });
  assert.equal(languageInfo({ ui: 'ko', translation: null, ai: 'fr' }, []).translationResolved, 'ko');
  assert.equal(languageInfo({ ui: 'ko', translation: null, ai: 'fr' }, []).aiResolved, 'fr');
  // What the translation would be with nothing chosen, beside what it is now (the settings list's empty value).
  assert.deepEqual(languageInfo({ ui: 'en', translation: 'ko' }, ['en-US']).translationUnchosen, { code: null, ask: true });
  assert.deepEqual(languageInfo({ ui: 'en', translation: 'ko' }, ['ko-KR']).translationUnchosen, { code: 'ko', ask: false });
  assert.deepEqual(languageInfo({ ui: 'ko', translation: 'ko' }, ['en-US']).translationUnchosen, { code: 'ko', ask: false });
});
test('the system languages: as Electron gives them, or APP_OS_LANGUAGES for a test', () => {
  const { systemLanguagesFrom } = require('../desktop/language.cjs');
  assert.deepEqual(systemLanguagesFrom({}, () => ['ko-KR', 'en-US']), ['ko-KR', 'en-US']); // Windows and macOS give region tags
  assert.deepEqual(systemLanguagesFrom({}, () => ['ko_KR']), ['ko_KR']); // read as ko by matchLanguage too
  assert.deepEqual(systemLanguagesFrom({}, () => { throw Error('no system'); }), []);
  assert.deepEqual(systemLanguagesFrom({}, () => null), []);
  assert.deepEqual(systemLanguagesFrom({ APP_OS_LANGUAGES: 'ja-JP, ko-KR' }, () => ['en-US']), ['ja-JP', 'ko-KR']);
  assert.deepEqual(systemLanguagesFrom({ APP_OS_LANGUAGES: '' }, () => ['ko-KR']), [], 'an empty value is a system with no languages');
  // What a translation would be in: never asked under a Korean screen; under English, the system's language or a question.
  for (const os of [['en-US'], [], ['ko-KR']]) assert.deepEqual(translationLanguage({ ui: 'ko' }, os), { code: 'ko', ask: false });
  assert.deepEqual(translationLanguage({ ui: 'en' }, ['ja-JP', 'ko_KR']), { code: 'ko', ask: false });
  assert.deepEqual(translationLanguage({ ui: 'en' }, ['en-US']), { code: null, ask: true });
  // English with a Korean region is English: the region names no language a translation can be in.
  for (const os of [['en-KR'], ['en_KR'], ['en-KR', 'ja-JP']]) assert.deepEqual(translationLanguage({ ui: 'en' }, os), { code: null, ask: true }, os.join());
  assert.equal(matchLanguage(['en-KR'], 'translation'), null);
  assert.deepEqual(translationLanguage({ ui: 'en', translation: 'ko' }, ['en-US']), { code: 'ko', ask: false });
});
test('a language change is kept first, and a setting changed meanwhile stays beside it', async () => {
  const { keepLanguage } = require('../desktop/language.cjs');
  const language = { ui: 'en', translation: 'ko', ai: null };
  // While the language is written, a sync records its time: it replaces the settings in memory and writes them
  // (with the language as it was), as main.cjs's sync handlers do.
  let memory = { recents: [], language: { ui: 'en', translation: null, ai: null } }, disk = { ...memory }, writes = 0;
  const io = { get: () => memory, set: value => { memory = value; },
    write: async value => { writes++; disk = JSON.parse(JSON.stringify(value)); if (writes === 1) { memory = { ...memory, syncAt: 5 }; disk = JSON.parse(JSON.stringify(memory)); } },
    read: async () => disk };
  await keepLanguage(language, io);
  assert.deepEqual(memory, { recents: [], language, syncAt: 5 }); assert.deepEqual(disk, memory, 'the file holds both');
  // A setting changed in place is kept too.
  memory = { recents: [], language: { ui: 'en', translation: null, ai: null } }; disk = { ...memory }; writes = 0;
  await keepLanguage(language, { ...io, write: async value => { writes++; disk = JSON.parse(JSON.stringify(value)); if (writes === 1) memory.syncFolder = 'x'; } });
  assert.equal(memory.syncFolder, 'x'); assert.deepEqual(memory.language, language); assert.deepEqual(disk, memory);
  // A write that fails changes nothing.
  memory = { recents: [], language: { ui: 'en', translation: null, ai: null } }; const before = memory;
  await assert.rejects(keepLanguage(language, { ...io, write: async () => { throw Error('disk full'); } }), /disk full/);
  assert.equal(memory, before);
  // The second write failing keeps the change and reports it.
  let late = null; writes = 0; disk = {};
  await keepLanguage(language, { ...io, read: async () => ({}), write: async value => { writes++; if (writes === 2) throw Error('late'); }, late: error => { late = error.message; } });
  assert.deepEqual(memory.language, language); assert.equal(late, 'late');
});
test('a new install is asked for its display language once; an install in use, or a run with APP_UI_LANG, is not', () => {
  const { languageAskAtStart, languageInfo } = require('../desktop/language.cjs');
  assert.equal(languageAskAtStart({ existingInstall: false, stored: undefined, override: undefined }), true);
  assert.equal(languageAskAtStart({ existingInstall: true, stored: undefined, override: undefined }), false, 'an install in use (1.0.0) is not asked');
  assert.equal(languageAskAtStart({ existingInstall: true, stored: true, override: undefined }), true, 'asked again until answered');
  assert.equal(languageAskAtStart({ existingInstall: true, stored: 'yes', override: undefined }), false, 'only true asks');
  assert.equal(languageAskAtStart({ existingInstall: false, stored: undefined, override: 'ko' }), false, 'a forced language is not asked about');
  assert.equal(languageAskAtStart({ existingInstall: false, stored: undefined, override: 'xx' }), true, 'an override that is no display language forces nothing');
  assert.equal(languageInfo({ ui: 'en' }, ['ja-JP'], true).askUi, true);
  assert.equal(languageInfo({ ui: 'en' }, ['ja-JP']).askUi, false);
  assert.equal(languageInfo({}, ['ja-JP'], true).ui, 'ko', 'normalizeLanguage is unchanged');
});
