// Folders made inside a vault (its records' folder and those under it). They are made only while the vault's own folder
// is there: when it was renamed or moved while open, making them would bring a folder back under the old name, empty,
// and the app would take it for the vault, changed by another program (storage.cjs gone, main.cjs vault-relocate).
const fs = require('node:fs/promises');
const { tr } = require('../core/i18n.js');
const goneError = () => Object.assign(Error(tr('저장소 폴더를 찾을 수 없습니다. 폴더 이름을 바꿨거나 옮겼다면 저장소를 다시 연결하세요.')), { code: 'APP_VAULT_GONE' });
// Makes directory (and what is missing above it, inside the vault) and returns it.
async function vaultDirectory(root, directory) {
  try { if (!(await fs.stat(root)).isDirectory()) throw goneError(); }
  catch (error) { if (error.code === 'ENOENT' || error.code === 'ENOTDIR') throw goneError(); throw error; }
  await fs.mkdir(directory, { recursive: true });
  return directory;
}
module.exports = { vaultDirectory };
