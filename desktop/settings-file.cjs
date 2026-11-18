// This computer's settings files (settings.json, the ChatGPT host and session, the API keys). One that cannot be read
// (broken JSON, or not an object) is set aside beside itself as <name>.broken-<time> and the app goes on with the
// defaults, noting what it did (notices) so the window can say so. Nothing is deleted.
const fs = require('node:fs/promises');
const path = require('node:path');
const { readJson } = require('./storage.cjs');
const { migrateSettings } = require('./llm.cjs');

async function readSettingsFile(file, fallback, notices = null, kind = 'settings') {
  let value;
  try { value = await readJson(file, fallback); }
  catch (error) { if (error?.code !== 'APP_FILE_UNREADABLE') throw error; return setAside(file, fallback, notices, kind); }
  if (value === fallback || (value && typeof value === 'object' && !Array.isArray(value))) return value;
  return setAside(file, fallback, notices, kind);
}
async function setAside(file, fallback, notices, kind) {
  const aside = `${file}.broken-${Date.now()}`;
  await fs.rename(file, aside).catch(() => {});
  notices?.push({ kind, file: path.basename(file), aside: path.basename(aside) });
  return fallback;
}
// settings.json as the app reads it: the recent vaults a list of {id, name, root} (odd entries left out), the
// connection settings filled in.
function settingsShape(raw) {
  const config = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const recents = (Array.isArray(config.recents) ? config.recents : []).filter(r => r && typeof r.id === 'string' && typeof r.root === 'string' && r.root).map(r => ({ ...r, name: typeof r.name === 'string' ? r.name : path.basename(r.root) }));
  return migrateSettings({ provider: 'gpt', mode: 'web', ...config, recents });
}
module.exports = { readSettingsFile, settingsShape };
