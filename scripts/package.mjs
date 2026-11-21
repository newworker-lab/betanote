import { packager } from '@electron/packager';
import { fileURLToPath } from 'node:url';
import { readdir, readFile } from 'node:fs/promises';
import { initializeProxy } from '@electron/get';
if (process.env.HTTPS_PROXY || process.env.HTTP_PROXY) initializeProxy();
const platform = process.argv[2] || process.platform;
if (!['linux', 'win32'].includes(platform)) throw new Error('Supported targets: linux, win32');
// The app needs only these at its top level; everything else in the repository
// (tests, docs, scripts, CI settings, agent notes, README) stays out of the package.
const APP_ENTRIES = ['core', 'desktop', 'dist', 'node_modules', 'package.json'];
// The app's name file (core/app-name.json): the folder and executable are its id, the settings folder its product name
// (package.json productName, checked against the name file by tests/app-name.test.cjs), Windows' file details its name.
const appName = JSON.parse(await readFile(new URL('../core/app-name.json', import.meta.url), 'utf8'));
const outputs = await packager({
  dir: fileURLToPath(new URL('../', import.meta.url)),
  // No letter outside ASCII in a path: the id names the folder and the executable; the window, the menu and Windows'
  // file details show the name.
  name: appName.id, executableName: appName.id, icon: fileURLToPath(new URL(`../brand/${appName.id}`, import.meta.url)), platform, arch: 'x64', out: 'release', overwrite: true,
  win32metadata: { ProductName: appName.name, FileDescription: appName.name },
  ignore: [
    /^\/(release|tests|docs|scripts|brand|msix|\.git|\.github|\.claude|\.superpowers|\.vscode)(\/|$)/,
    /^\/[^/]+\.md$/,
    /^\/LICENSE$/, // the app's licence goes beside the executable (scripts/archive.py), not into app.asar
    /^\/\.(gitignore|gitattributes|editorconfig|npmrc|env[^/]*)$/,
    /^\/package-lock\.json$/,
  ],
  // OCR runs tesseract.js in a worker thread that loads its WASM core and
  // language data from disk; those cannot be read inside app.asar.
  prune: true, asar: { unpack: '**/node_modules/{tesseract.js,tesseract.js-core,@tesseract.js-data}/**' },
  // Checked before the app is sealed into app.asar, so a new repository file
  // never reaches a release unnoticed.
  afterPrune: [async ({ buildPath }) => {
    const extra = (await readdir(buildPath)).filter(name => !APP_ENTRIES.includes(name));
    if (extra.length) throw new Error(`Files not needed by the app would be packaged: ${extra.join(', ')}`);
  }],
});
console.log(outputs.join('\n'));
