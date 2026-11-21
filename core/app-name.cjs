// The app's name, kept in one place (app-name.json), and what is named after it. To rename the app, change that
// file (the current name goes to the front of history) and package.json's name and productName; nothing in the code
// names it (docs/DEVELOPMENT.md, 이름 바꾸기 절차).
//   name: what the screen shows; product: the settings folder (userData) and Windows' file details;
//   id: what is kept on disk and shipped (the vault's .<id>, <id>-sync, <id>-full-backup, the executable, PDF ink marks);
//   citekeyPrefix: an item's default citation key, <prefix><number>;
//   history: the earlier names, the latest first, whose folders and marks an earlier app left are taken over.
//   store: the identity the Microsoft Store gave the app (scripts/msix.mjs reads it from the file; the app does not use it).
// In Node it reads the file; on the screen the build puts the file's values in globalThis.appNameData first
// (scripts/build.mjs, dist/app-name.js) and this sets globalThis.appName.
(function (root, factory) {
  const node = typeof module === 'object' && module.exports;
  const api = factory(node ? require('./app-name.json') : root.appNameData);
  if (node) module.exports = api; else root.appName = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (data) {
  if (!data || typeof data.name !== 'string' || typeof data.id !== 'string') throw Error('The app name file is missing or damaged (core/app-name.json).');
  const history = (Array.isArray(data.history) ? data.history : []).map(h => Object.freeze({ name: h.name, product: h.product, id: h.id, citekeyPrefix: h.citekeyPrefix }));
  return Object.freeze({
    name: data.name, product: data.product, id: data.id, citekeyPrefix: data.citekeyPrefix, history: Object.freeze(history),
    vaultDir: '.' + data.id, syncDir: data.id + '-sync', backupKind: data.id + '-full-backup', annotationPrefix: data.id + '-',
    oldVaultDirs: Object.freeze(history.map(h => '.' + h.id)), oldSyncDirs: Object.freeze(history.map(h => h.id + '-sync')),
    oldBackupKinds: Object.freeze(history.map(h => h.id + '-full-backup')), oldProducts: Object.freeze(history.map(h => h.product)),
    oldIds: Object.freeze(history.map(h => h.id)), oldNames: Object.freeze(history.map(h => h.name)),
  });
});
