// The settings of the app under its earlier name (the name file's history) taken over by a real start of the app: the
// folder is renamed to <product> before anything reads it, and the page's keys move from <earlier id>-* to app-*. Linux only (the settings
// folder is found through XDG_CONFIG_HOME). APP_TEST_SOURCE=1 runs from source.
const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const appName = require('../core/app-name.cjs'), [nameBefore, nameFirst] = appName.history;
const root = path.resolve(__dirname, '..');
(async () => {
  if (process.platform !== 'linux') { console.log('Takeover smoke skipped: Linux only.'); return; }
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), `${appName.id}-takeover-`)), config = path.join(temp, 'config'), old = path.join(config, nameBefore.product), next = path.join(config, appName.product);
  const executable = require('./app-executable.cjs')(root), sourceMode = process.env.APP_TEST_SOURCE === '1';
  const env = { ...process.env, XDG_CONFIG_HOME: config, ...(/utf-?8/i.test(process.env.LC_ALL || process.env.LANG || '') ? {} : { LC_ALL: 'C.UTF-8', LANG: 'C.UTF-8' }) };
  const args = extra => [...(sourceMode ? [root] : []), '--no-sandbox', '--ozone-platform=headless', '--disable-gpu', ...extra];
  let app;
  try {
    // The earlier app's settings folder: settings and the page's storage under the old key, as the earlier app left them.
    app = await electron.launch({ env, executablePath: executable, args: args([`--user-data-dir=${old}`]), timeout: 30000 });
    let p = await app.firstWindow(); p.setDefaultTimeout(20000); await p.locator('.welcome').waitFor();
    await p.evaluate(oldKey => { localStorage.removeItem('app-theme'); localStorage.setItem(oldKey, 'dark'); }, `${nameBefore.id}-theme`);
    await app.close();
    await fs.writeFile(path.join(old, 'settings.json'), JSON.stringify({ recents: [], provider: 'gpt', mode: 'web', language: { ui: 'ko', translation: null, ai: null } }));
    await fs.writeFile(path.join(old, 'marker.txt'), `from ${nameBefore.product}`);

    // the app started as it is installed (no --user-data-dir): the folder is renamed whole, the page key moved to app-.
    app = await electron.launch({ env, executablePath: executable, args: args([]), timeout: 30000 });
    p = await app.firstWindow(); p.setDefaultTimeout(20000);
    p.on('pageerror', e => { console.error(e); process.exitCode = 1; });
    await p.locator('.welcome').waitFor();
    assert.equal(await app.evaluate(({ app }) => app.getPath('userData')), next);
    assert.equal(await fs.readFile(path.join(next, 'marker.txt'), 'utf8'), `from ${nameBefore.product}`);
    await assert.rejects(fs.access(old), 'the old folder is renamed, not copied');
    assert.deepEqual(await p.evaluate(oldKey => [localStorage.getItem('app-theme'), localStorage.getItem(oldKey), document.body.classList.contains('dark')], `${nameBefore.id}-theme`), ['dark', null, true]);
    await app.close(); app = null;
    assert.deepEqual((await fs.readdir(config)).filter(name => name.startsWith('.')), [], 'no lock, marker, copy or moved-aside folder left');
    console.log(`Takeover smoke passed: the ${nameBefore.product} settings folder became ${appName.product} at a real start, and the page's ${nameBefore.id}- keys moved to app-.`);
  } catch (error) { console.error(error); process.exitCode = 1; }
  finally { await app?.close().catch(() => {}); await fs.rm(temp, { recursive: true, force: true }); }
})();
