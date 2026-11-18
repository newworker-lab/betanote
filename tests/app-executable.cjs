// Which app a smoke test starts. APP_TEST_EXECUTABLE names one; APP_TEST_SOURCE=1 runs the
// source with Electron; otherwise the packaged app of this platform under release/, and, where
// there is none (a checkout that was never packaged, or packaged for another system), the source.
// Running the source is recorded in APP_TEST_SOURCE, which the tests read for the app's path.
const fs = require('node:fs');
// The smokes read the Korean screen: a new profile would otherwise take the system's language
// (desktop/language.cjs). A test that wants another language sets APP_UI_LANG itself.
process.env.APP_UI_LANG ||= 'ko';
const path = require('node:path');
const appName = require('../core/app-name.cjs');
module.exports = function appExecutable(root) {
  if (process.env.APP_TEST_EXECUTABLE) return process.env.APP_TEST_EXECUTABLE;
  if (process.env.APP_TEST_SOURCE !== '1') {
    const packaged = process.platform === 'win32' ? path.join(root, 'release', `${appName.id}-win32-x64`, `${appName.id}.exe`)
      : process.platform === 'darwin' ? path.join(root, 'release', `${appName.id}-darwin-${process.arch}`, `${appName.id}.app`, 'Contents', 'MacOS', appName.id)
      : path.join(root, 'release', `${appName.id}-linux-x64`, appName.id);
    if (fs.existsSync(packaged)) return packaged;
    console.log(`패키지된 앱이 없어 소스로 실행합니다 (${path.relative(root, packaged)} 없음).`);
    process.env.APP_TEST_SOURCE = '1';
  }
  return require('electron');
};
