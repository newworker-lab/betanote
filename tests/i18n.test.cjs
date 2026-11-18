const { test } = require('node:test');
const assert = require('node:assert/strict');
const { tr, setUiLanguage, addMessages, uiLanguage, uiLocale } = require('../core/i18n.js');
test('Korean returns the text itself with its places filled', () => {
  setUiLanguage('ko');
  assert.equal(tr('{n}개 선택', { n: 3 }), '3개 선택');
  assert.equal(tr('삭제', null, 'title'), '삭제');
});
test('English looks the text up, by context when given, and falls back to the Korean', () => {
  addMessages('en', { '{n}개 선택': '{n} selected', '삭제': 'Delete', ['삭제\u0004title']: 'Delete item', '{n}개 자료': { one: '{n} item', other: '{n} items' } });
  setUiLanguage('en');
  assert.equal(tr('{n}개 선택', { n: 3 }), '3 selected');
  assert.equal(tr('삭제', null, 'title'), 'Delete item');
  assert.equal(tr('{n}개 자료', { n: 1 }), '1 item'); assert.equal(tr('{n}개 자료', { n: 2 }), '2 items');
  assert.equal(tr('없는 문구'), '없는 문구');
  assert.equal(uiLocale(), 'en-US');
});
test('a value that looks like a place is not filled again', () => {   // Review Focus 1
  setUiLanguage('en'); addMessages('en', { '“{title}” 삭제': 'Delete “{title}”' });
  assert.equal(tr('“{title}” 삭제', { title: '{n} and {title}' }), 'Delete “{n} and {title}”');
  assert.equal(tr('{a} → {b}', { a: '{b}', b: 'x' }), '{b} → x');
});
test('an unknown language is Korean', () => { setUiLanguage('fr'); assert.equal(uiLanguage(), 'ko'); });
