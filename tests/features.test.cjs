const { test } = require('node:test');
process.env.APP_SHOW_HIDDEN_FEATURES = '1'; // collections are hidden in the product but still tested
const assert = require('node:assert/strict');
const { FEATURES, available, features, setFeature, requireFeature } = require('../desktop/features.cjs');

test('collections start off, switch on and off, and keep other settings', () => {
  assert.deepEqual(features({}).collections, { label: '컬렉션', tier: 'free', available: true, enabled: false });
  const on = setFeature({ recents: [1] }, 'collections', true);
  assert.deepEqual(on, { recents: [1], features: { collections: true } });
  assert.equal(features(on).collections.enabled, true);
  assert.equal(features(setFeature(on, 'collections', false)).collections.enabled, false);
  assert.throws(() => setFeature({}, 'nothing', true), /알 수 없는 기능/);
  assert.throws(() => setFeature({}, 'collections', 'yes'), /알 수 없는 기능/);
  assert.doesNotThrow(() => requireFeature('collections'));
});

test('a paid feature is available only with a licence that lists its tier', t => {
  FEATURES.paidDemo = { label: '데모', tier: 'pro', defaultOn: true };
  t.after(() => { delete FEATURES.paidDemo; });
  assert.equal(available('paidDemo'), false);
  assert.deepEqual(features({ features: { paidDemo: true } }).paidDemo, { label: '데모', tier: 'pro', available: false, enabled: false }, 'switched on but not licensed stays off');
  assert.throws(() => setFeature({}, 'paidDemo', true), /데모 기능은 이 버전에서 사용할 수 없습니다/);
  assert.doesNotThrow(() => setFeature({}, 'paidDemo', false), 'switching off is always allowed');
  assert.throws(() => requireFeature('paidDemo'), /사용할 수 없습니다/);
  const licence = { tiers: ['pro'] };
  assert.equal(available('paidDemo', licence), true); assert.equal(features({}, licence).paidDemo.enabled, true);
  assert.doesNotThrow(() => requireFeature('paidDemo', licence));
});

test('a hidden feature is unavailable unless hidden features are shown', () => {
  const before = process.env.APP_SHOW_HIDDEN_FEATURES;
  try { delete process.env.APP_SHOW_HIDDEN_FEATURES; assert.deepEqual(features({ features: { collections: true } }).collections, { label: '컬렉션', tier: 'free', available: false, enabled: false }); assert.throws(() => requireFeature('collections')); }
  finally { process.env.APP_SHOW_HIDDEN_FEATURES = before; }
});
