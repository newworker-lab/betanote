// End-to-end check of the new-version notice (desktop/update-check.cjs, main.cjs checkForUpdate, help.js): with a
// newer release in the feed the start screen says so, with the running version beside it; 내려받기 opens the release
// page in the browser; 이 버전 건너뛰기 is kept and that version is not offered again; a release that is not newer, a
// feed that cannot be reached and a check switched off in the settings show nothing, and switched off nothing is asked.
// The feed is a server of this test (APP_UPDATE_FEED): GitHub is not asked. APP_TEST_SOURCE=1 runs the source.
const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const os = require('node:os');
const appName = require('../core/app-name.cjs');
const root = path.resolve(__dirname, '..');
const executable = require('./app-executable.cjs')(root); // also gives the run its language before env is read
const current = require('../package.json').version;

(async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), `${appName.id}-update-e2e-`));
  let answer = null, asked = 0;
  const server = http.createServer((_request, response) => { asked++; if (!answer) { response.statusCode = 500; response.end('no'); return; } response.setHeader('content-type', 'application/json'); response.end(JSON.stringify(answer)); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const feed = `http://127.0.0.1:${server.address().port}/latest`, page = version => `https://github.com/example/example/releases/tag/v${version}`;
  const settingsOf = async profile => JSON.parse(await fs.readFile(path.join(profile, 'settings.json'), 'utf8'));
  let app;
  const launch = async (profile, env = {}) => {
    app = await electron.launch({ env: { ...process.env, LC_ALL: 'C.UTF-8', LANG: 'C.UTF-8', APP_UPDATE_FEED: feed, ...env }, executablePath: executable, args: [...(process.env.APP_TEST_SOURCE === '1' ? [root] : []), '--no-sandbox', '--ozone-platform=headless', '--disable-gpu', `--user-data-dir=${profile}`], timeout: 20000 });
    const p = await app.firstWindow(); p.setDefaultTimeout(15000); p.on('pageerror', e => { console.error(e); process.exitCode = 1; });
    await p.locator('[data-action="storage"]').first().waitFor();
    return p;
  };
  const checked = async profile => { for (let i = 0; i < 100; i++) { const at = (await settingsOf(profile).catch(() => ({}))).updateCheckedAt; if (at) return at; await new Promise(r => setTimeout(r, 100)); } throw Error('the check was not recorded'); };
  const notice = p => p.locator('#dialog[open]').filter({ hasText: '새 버전이 있습니다' });
  try {
    // A newer release: told once the window is up, with both versions.
    const profile = path.join(temp, 'profile'); answer = { tag_name: 'v99.1.0', html_url: page('99.1.0') };
    let p = await launch(profile); await notice(p).waitFor();
    const text = await notice(p).textContent(); assert.match(text, /99\.1\.0/); assert.ok(text.includes(current), 'the running version is named');
    assert.equal(asked, 1); await checked(profile);
    // 내려받기 opens the release page in the browser, and nothing else.
    await app.evaluate(({ shell }) => { globalThis.opened = []; shell.openExternal = async url => { globalThis.opened.push(url); }; });
    await notice(p).locator('[data-action="update-open"]').click(); await notice(p).waitFor({ state: 'hidden' });
    assert.deepEqual(await app.evaluate(() => globalThis.opened), [page('99.1.0')]);
    await app.close(); app = null;
    // The same day: not asked again.
    p = await launch(profile); await p.waitForTimeout(800); assert.equal(asked, 1, 'asked once a day at most'); assert.equal(await notice(p).count(), 0);
    await app.close(); app = null;
    // A day later: told again; 이 버전 건너뛰기 is kept.
    const aDayAgo = async () => { const s = await settingsOf(profile); s.updateCheckedAt = Date.now() - 25 * 60 * 60 * 1000; await fs.writeFile(path.join(profile, 'settings.json'), JSON.stringify(s)); };
    await aDayAgo(); p = await launch(profile); await notice(p).waitFor(); assert.equal(asked, 2);
    await notice(p).locator('[data-action="update-skip"]').click(); await notice(p).waitFor({ state: 'hidden' });
    for (let i = 0; i < 50 && (await settingsOf(profile)).updateSkipped !== '99.1.0'; i++) await new Promise(r => setTimeout(r, 100));
    assert.equal((await settingsOf(profile)).updateSkipped, '99.1.0');
    await app.close(); app = null;
    // The skipped version is not offered again; a newer one is.
    await aDayAgo(); p = await launch(profile); const before = (await settingsOf(profile)).updateCheckedAt; for (let i = 0; i < 50 && asked < 3; i++) await new Promise(r => setTimeout(r, 100));
    assert.equal(asked, 3); await p.waitForTimeout(500); assert.equal(await notice(p).count(), 0, 'the skipped version is not offered'); void before;
    await app.close(); app = null;
    await aDayAgo(); answer = { tag_name: 'v99.2.0', html_url: page('99.2.0') }; p = await launch(profile); await notice(p).waitFor(); assert.match(await notice(p).textContent(), /99\.2\.0/);
    await notice(p).locator('[data-action="close"]').first().click();
    // Switched off in the settings: kept, and nothing is asked at the next start.
    await p.evaluate(() => actions.settings()); await p.locator('#dialog[open] [data-llm-section="general"] summary').click(); // the start screen has no sidebar: the settings are opened as the menu does
    const box = p.locator('#kn-update'); assert.equal(await box.isChecked(), true); await box.uncheck();
    for (let i = 0; i < 50 && (await settingsOf(profile)).features?.updateCheck !== false; i++) await new Promise(r => setTimeout(r, 100));
    assert.equal((await settingsOf(profile)).features.updateCheck, false);
    await app.close(); app = null;
    await aDayAgo(); const askedBefore = asked; p = await launch(profile); await p.waitForTimeout(800);
    assert.equal(asked, askedBefore, 'switched off, nothing is asked'); assert.equal(await notice(p).count(), 0);
    await app.close(); app = null;
    // Not newer, and a feed that fails: nothing is shown and nothing breaks.
    for (const [name, body] of [['same', { tag_name: 'v' + current, html_url: page(current) }], ['older', { tag_name: 'v0.0.1', html_url: page('0.0.1') }], ['failing', null], ['pre-release', { tag_name: 'v99.9.0', html_url: page('99.9.0'), prerelease: true }], ['elsewhere', { tag_name: 'v99.9.0', html_url: 'https://example.com/get' }]]) {
      answer = body; const other = path.join(temp, name), was = asked; p = await launch(other); for (let i = 0; i < 50 && asked === was; i++) await new Promise(r => setTimeout(r, 100));
      assert.equal(asked, was + 1, `${name}: asked`); await p.waitForTimeout(500); assert.equal(await notice(p).count(), 0, `${name}: nothing is shown`);
      await app.close(); app = null;
    }
    // APP_UPDATE_FEED=off (what every other smoke runs with): nothing is asked.
    { const was = asked; p = await launch(path.join(temp, 'off'), { APP_UPDATE_FEED: 'off' }); await p.waitForTimeout(800); assert.equal(asked, was); await app.close(); app = null; }
    console.log('Update smoke passed: a newer release is told with both versions; 내려받기 opens the release page; asked once a day at most; a skipped version is not offered again and a newer one is; switched off in the settings nothing is asked; a release that is not newer, a pre-release, a page elsewhere and a failing feed show nothing.');
  } catch (error) { console.error(error); process.exitCode = 1; try { await (await app?.firstWindow())?.screenshot({ path: path.join(os.tmpdir(), `${appName.id}-update-failure.png`) }); } catch { /* no window to picture */ } }
  finally { await app?.close().catch(() => {}); server.close(); await fs.rm(temp, { recursive: true, force: true }); }
})();
