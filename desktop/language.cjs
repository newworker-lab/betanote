// The three language settings kept in settings.json as language: {ui, translation, ai}
// (docs/DEVELOPMENT.md, 언어 설정). null in translation or ai
// means "the same as the screen". What each setting resolves to is worked out here, once, for the
// main process and for the windows (language-sync).
const { LANGUAGES, languagesFor, matchLanguage } = require('../core/languages.cjs');
const {tr}=require('../core/i18n.js');
const UI_DEFAULT = 'ko';
const allowed = (value, kind) => typeof value === 'string' && Object.hasOwn(LANGUAGES, value) && LANGUAGES[value][kind] === true;
const objectOf = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
// Whatever a settings file holds (written by hand, by another version, damaged) becomes a value the app can start with.
function normalizeLanguage(value) {
  const v = objectOf(value);
  return { ui: allowed(v.ui, 'ui') ? v.ui : UI_DEFAULT, translation: allowed(v.translation, 'translation') ? v.translation : null, ai: allowed(v.ai, 'ai') ? v.ai : null };
}
// The first value: an install already in use (a settings file without language) keeps Korean;
// a new one takes Korean when the system's language is Korean, English otherwise.
function initialLanguage({ existingInstall, osLanguages }) {
  return { ui: existingInstall || matchLanguage(osLanguages, 'ui') === 'ko' ? 'ko' : 'en', translation: null, ai: null };
}
// APP_UI_LANG (ko or en) sets the screen for this run only, for tests and development.
function startupLanguage(settings, override) {
  const value = normalizeLanguage(settings);
  return allowed(override, 'ui') ? { ...value, ui: override } : value;
}
// A change from a window: only the named fields change, and each must be one the list offers for it.
function patchLanguage(settings, patch) {
  const bad = () => Object.assign(Error(tr('지원하지 않는 언어입니다.')), { code: 'APP_BAD_LANGUAGE' });
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw bad();
  const next = normalizeLanguage(settings);
  if (Object.hasOwn(patch, 'ui')) { if (!allowed(patch.ui, 'ui')) throw bad(); next.ui = patch.ui; }
  for (const kind of ['translation', 'ai']) if (Object.hasOwn(patch, kind)) { if (patch[kind] !== null && !allowed(patch[kind], kind)) throw bad(); next[kind] = patch[kind]; }
  return next;
}
// The AI answers in the chosen language, else in the screen's (DEVELOPMENT.md 언어 설정).
function aiLanguage(settings) { const value = normalizeLanguage(settings); return value.ai ?? value.ui; }
// The translation result (DEVELOPMENT.md 언어 설정): the chosen language; else the screen's; but under an English
// screen the system's language when it can be a result, and otherwise the user is asked once.
function translationLanguage(settings, osLanguages) {
  const value = normalizeLanguage(settings);
  if (value.translation) return { code: value.translation, ask: false };
  if (allowed(value.ui, 'translation')) return { code: value.ui, ask: false };
  const code = matchLanguage(osLanguages, 'translation');
  return code ? { code, ask: false } : { code: null, ask: true };
}
// The system's languages, most preferred first (Electron's app.getPreferredSystemLanguages, given as read: the same
// tags on Windows, macOS and Linux, such as "ko-KR"). APP_OS_LANGUAGES (comma-separated tags, may be empty) stands
// in for them, for tests and development, as APP_UI_LANG does for the screen.
function systemLanguagesFrom(env, read) {
  if (typeof env?.APP_OS_LANGUAGES === 'string') return env.APP_OS_LANGUAGES.split(',').map(tag => tag.trim()).filter(Boolean);
  try { const list = read(); return Array.isArray(list) ? list.filter(tag => typeof tag === 'string') : []; } catch { return []; }
}
// Keeps a language change in the settings. The settings with it are written first; a failed write throws and nothing
// changes. Only once kept is it merged into the settings as they are by then (another setting changed while the file
// was written, such as the sync time, is never lost), and the file is written again when it does not hold that.
// get/set are the settings in memory; write/read the file; late takes a failure of that second write.
async function keepLanguage(stored, { get, set, write, read, late }) {
  await write({ ...get(), language: stored });
  set({ ...get(), language: stored });
  try { if (JSON.stringify(await read()) !== JSON.stringify(get())) await write(get()); } catch (error) { late?.(error); }
}
const choices = kind => languagesFor(kind).map(({ code, name }) => ({ code, name }));
// What a window receives (preload appApi.language): the settings, what they resolve to, the
// system's languages and the lists to choose from (the page does not load core/languages.cjs).
function languageInfo(settings, osLanguages) {
  const value = normalizeLanguage(settings), os = Array.isArray(osLanguages) ? osLanguages.filter(tag => typeof tag === 'string') : [], translation = translationLanguage(value, os);
  // What the translation would be with no language chosen (the settings list's empty value), whatever is chosen now.
  const unchosen = translationLanguage({ ...value, translation: null }, os);
  return { ...value, aiResolved: aiLanguage(value), translationResolved: translation.code, translationAsk: translation.ask, translationUnchosen: unchosen, os, choices: { ui: choices('ui'), ai: choices('ai'), translation: choices('translation') } };
}
module.exports = { normalizeLanguage, initialLanguage, startupLanguage, patchLanguage, aiLanguage, translationLanguage, languageInfo, systemLanguagesFrom, keepLanguage };
