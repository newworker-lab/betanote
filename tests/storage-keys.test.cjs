const { test } = require('node:test');
const assert = require('node:assert/strict');
const appName = require('../core/app-name.cjs');
const { adoptStorageKeys, PREFIX, OLD_PREFIXES } = require('../desktop/storage-keys.js');

// A stand-in for the page's localStorage (the Storage interface the function uses).
function storage(entries) {
  const map = new Map(Object.entries(entries));
  return { get length() { return map.size; }, key: i => [...map.keys()][i] ?? null, getItem: k => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)), removeItem: k => map.delete(k), entries: () => Object.fromEntries(map) };
}
// The keys an earlier app left, written from the name file's ids (the app's id now, then the earlier names').
const [now, later, earlier] = [appName.id, ...appName.oldIds].map(id => id + '-');

test('the page keys are app-…; the earlier prefixes are the app\'s id and the earlier ids, from the name file', () => {
  assert.equal(PREFIX, 'app-');
  assert.deepEqual(OLD_PREFIXES, [appName.id + '-', ...appName.oldIds.map(id => id + '-')]);
});
test('the keys under the app\'s id and the earlier ids move to app- once; a new key already there is kept', () => {
  const s = storage({ [now + 'theme']: 'dark', [later + 'marks']: '1', [earlier + 'panel-width']: '200', 'app-theme': 'light', 'other': 'x' });
  assert.equal(adoptStorageKeys(s), 2);
  assert.deepEqual(s.entries(), { 'app-theme': 'light', 'app-marks': '1', 'app-panel-width': '200', 'other': 'x' });
  assert.equal(adoptStorageKeys(s), 0, 'a second time moves nothing');
});
test('where more than one earlier app kept a key, the latest app\'s is the one kept', () => {
  const s = storage({ [earlier + 'panel-width']: '200', [later + 'panel-width']: '310', [now + 'panel-width']: '420', [later + 'read-v1']: '{"a":1}' });
  assert.equal(adoptStorageKeys(s), 2);
  assert.deepEqual(s.entries(), { 'app-panel-width': '420', 'app-read-v1': '{"a":1}' });
});
