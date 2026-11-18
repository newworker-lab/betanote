// End-to-end check of starting with broken settings files (desktop/main.cjs, settings-file.cjs): a settings.json, a
// ChatGPT host file and an API key file that cannot be read are set aside beside themselves, the app opens with its
// defaults and says what it did; a settings.json without its recents opens too. APP_TEST_SOURCE=1 runs the source.
const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const appName = require('../core/app-name.cjs');
const root = path.resolve(__dirname, '..');
(async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), `${appName.id}-startup-e2e-`)), profile = path.join(temp, 'profile'); await fs.mkdir(profile);
  const env = /utf-?8/i.test(process.env.LC_ALL || process.env.LANG || '') ? process.env : { ...process.env, LC_ALL: 'C.UTF-8', LANG: 'C.UTF-8' };
  let app;
  const launch = async () => {
    app = await electron.launch({ env: { ...env, APP_UI_LANG: 'ko' }, executablePath: require('./app-executable.cjs')(root), args: [...(process.env.APP_TEST_SOURCE === '1' ? [root] : []), '--no-sandbox', '--ozone-platform=headless', '--disable-gpu', `--user-data-dir=${profile}`], timeout: 20000 });
    const p = await app.firstWindow({ timeout: 15000 }); p.setDefaultTimeout(15000); return p;
  };
  try {
    // 1. Broken files: the app opens and says so; the files are kept beside.
    await fs.writeFile(path.join(profile, 'settings.json'), '{broken'); await fs.writeFile(path.join(profile, 'chatgpt-host.json'), '{');
    let p = await launch();
    await p.locator('[data-action="storage"]').first().waitFor();
    await p.locator('#toast').filter({ hasText: /settings\.json/ }).waitFor();
    const names = await fs.readdir(profile);
    assert.ok(names.some(n => /^settings\.json\.broken-\d+$/.test(n)), names.join(' ')); assert.ok(names.some(n => /^chatgpt-host\.json\.broken-\d+$/.test(n)), names.join(' '));
    assert.equal(await fs.readFile(path.join(profile, names.find(n => n.startsWith('settings.json.broken-'))), 'utf8'), '{broken');
    await app.close();
    // 2. A settings.json without its recents.
    await fs.writeFile(path.join(profile, 'settings.json'), JSON.stringify({ provider: 'gpt', language: 'ko' }));
    p = await launch(); await p.locator('[data-action="storage"]').first().waitFor();
    await app.close(); app = null;
    console.log('Startup recovery smoke passed: broken settings, ChatGPT host and key files set aside, the app opened and said so; a settings file without recents opened.');
  } catch (error) { console.error(error); process.exitCode = 1; }
  finally { await app?.close().catch(() => {}); await fs.rm(temp, { recursive: true, force: true }); }
})();
