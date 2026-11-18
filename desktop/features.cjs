const { tr } = require('../core/i18n.js');
// Optional features, decided in one place. `tier` says who may use a feature:
// 'free' is everyone; any other tier (e.g. 'pro') needs a licence that lists it.
// There is no licence yet, so only free features are available. A feature the
// user has switched off keeps its data; switching it on shows it again.
const FEATURES = {
  // Hidden in this version: every collection control is gone and the collections kept in a vault stay
  // there for a later update. APP_SHOW_HIDDEN_FEATURES=1 shows hidden features (the tests use it).
  collections: { get label() { return tr('컬렉션'); }, tier: 'free', defaultOn: false, hidden: true },
  // A system notification when a translation ends while the window is in the background.
  notifications: { get label() { return tr('번역 완료 알림'); }, tier: 'free', defaultOn: true }
};

function available(name, licence = null) {
  const feature = FEATURES[name];
  if (feature?.hidden && process.env.APP_SHOW_HIDDEN_FEATURES !== '1') return false;
  return Boolean(feature) && (feature.tier === 'free' || Boolean(licence?.tiers?.includes(feature.tier)));
}
function features(config, licence = null) {
  return Object.fromEntries(Object.entries(FEATURES).map(([name, feature]) => {
    const ok = available(name, licence), chosen = config.features?.[name];
    return [name, { label: feature.label, tier: feature.tier, available: ok, enabled: ok && (typeof chosen === 'boolean' ? chosen : feature.defaultOn) }];
  }));
}
function setFeature(config, name, on, licence = null) {
  if (!Object.hasOwn(FEATURES, name) || typeof on !== 'boolean') throw Error(tr('알 수 없는 기능입니다.'));
  if (on && !available(name, licence)) throw Error(tr('{feature} 기능은 이 버전에서 사용할 수 없습니다.', { feature: FEATURES[name].label }));
  return { ...config, features: { ...(config.features || {}), [name]: on } };
}
// Main-process guard for an action that changes a feature's data.
function requireFeature(name, licence = null) {
  if (!available(name, licence)) throw Error(tr('{feature} 기능은 이 버전에서 사용할 수 없습니다.', { feature: FEATURES[name]?.label || name }));
}

module.exports = { FEATURES, available, features, setFeature, requireFeature };
