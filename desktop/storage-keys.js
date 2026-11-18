// The page's own settings in localStorage (theme, panel widths, reading place…) are kept under app-…, a name
// that does not follow the app's name. Earlier, they were kept under the app's id or an earlier name's (<id>-…,
// <old id>-…); they move to app- once, when the page starts, before anything reads them. A key already under the new
// name is kept and the old one dropped. The earlier ids come from the app's name file (core/app-name.json).
(function (root, factory) {
  const node = typeof module === 'object' && module.exports;
  const api = factory(node ? require('../core/app-name.cjs') : root.appName);
  if (node) module.exports = api; else root.appStorageKeys = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (appName) {
  // The earlier prefixes: the app's id and the earlier names' ids, from the app's name file, the latest first.
  const PREFIX = 'app-', OLD_PREFIXES = [appName.id, ...appName.oldIds].map(id => id + '-');
  // How many keys were moved (the old ones are gone either way).
  function adoptStorageKeys(storage) {
    let moved = 0;
    const keys = []; for (let i = 0; i < storage.length; i++) keys.push(storage.key(i));
    // The later app's keys first, so its value wins where more than one had one.
    for (const old of OLD_PREFIXES) for (const key of keys) {
      if (typeof key !== 'string' || !key.startsWith(old)) continue;
      const next = PREFIX + key.slice(old.length), value = storage.getItem(key);
      if (value !== null && storage.getItem(next) === null) { storage.setItem(next, value); moved++; }
      storage.removeItem(key);
    }
    return moved;
  }
  return { adoptStorageKeys, PREFIX, OLD_PREFIXES };
});
