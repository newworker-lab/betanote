'use strict';
// User themes and snippets: example on first use, manifest checks, CSS limits and clean-up.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os');
const { ThemeStore, sanitizeCss, checkManifest, MAX_CSS } = require('../desktop/themes.cjs');
const appName = require('../core/app-name.cjs');
const fixture = async t => { const dir = await fs.mkdtemp(path.join(os.tmpdir(), `${appName.id}-themes-`)); t.after(() => fs.rm(dir, { recursive: true, force: true })); return dir; };

test('the first use makes an example theme and snippet that pass the checks', async t => {
  const store = new ThemeStore(await fixture(t)); await store.ensure();
  const list = await store.list();
  assert.deepEqual(list.themes.map(x => [x.id, x.error, x.modes]), [['example-warm', '', ['light', 'dark']]]);
  assert.deepEqual(list.snippets.map(x => [x.name, x.error]), [['note-serif.css', '']]);
  assert.match((await store.themeCss('example-warm')).css, /--kn-background: #f6f1e7/); assert.match(await store.snippetCss('note-serif.css'), /--kn-font-notes/);
  await store.ensure(); assert.equal((await store.list()).themes.length, 1, 'not made again');
});
test('only CSS stays: @import and outside url() go, data: images stay', () => {
  const css = sanitizeCss('@import url("https://evil.test/a.css");\n@import "x.css";\n.a{background:url(https://evil.test/t.png)} .b{background:url( "../../secret.png" )} .c{background:url(data:image/png;base64,AAAA)}');
  assert.ok(!/@import\s+(url|")/.test(css)); assert.ok(!/evil\.test|secret/.test(css)); assert.match(css, /url\(data:image\/png;base64,AAAA\)/);
});
test('manifests are checked: id = folder, name, API version, modes and a CSS file in the folder', () => {
  const ok = { id: 'blue', name: '파랑', themeApiVersion: 1, modes: ['light'] };
  assert.equal(checkManifest(ok, 'blue'), '');
  for (const [bad, folder] of [[{ ...ok, id: 'other' }, 'blue'], [{ ...ok, id: 'Blue' }, 'Blue'], [{ ...ok, name: '' }, 'blue'], [{ ...ok, themeApiVersion: 2 }, 'blue'], [{ ...ok, modes: ['sepia'] }, 'blue'], [{ ...ok, modes: [] }, 'blue'], [{ ...ok, css: '../x.css' }, 'blue'], [{ ...ok, css: 'a/b.css' }, 'blue'], [{ ...ok, css: 'theme.js' }, 'blue'], [null, 'blue']])
    assert.notEqual(checkManifest(bad, folder), '', JSON.stringify(bad));
});
test('broken, oversized or linked themes are listed with the reason and never read', async t => {
  const dir = await fixture(t), store = new ThemeStore(dir); await store.ensure();
  const make = async (id, manifest, css) => { await fs.mkdir(path.join(store.themes, id)); if (manifest !== undefined) await fs.writeFile(path.join(store.themes, id, 'manifest.json'), typeof manifest === 'string' ? manifest : JSON.stringify(manifest)); if (css !== undefined) await fs.writeFile(path.join(store.themes, id, 'theme.css'), css); };
  await make('broken', '{not json', ''); await make('nocss', { id: 'nocss', name: 'x', themeApiVersion: 1, modes: ['light'] });
  await make('huge', { id: 'huge', name: 'x', themeApiVersion: 1, modes: ['light'] }, 'a'.repeat(MAX_CSS + 1));
  const outside = path.join(dir, 'outside.css'); await fs.writeFile(outside, '.x{}');
  // A file symlink needs developer mode on Windows: without it the linked case is left out and said so.
  let linked = true; await make('linked', { id: 'linked', name: 'x', themeApiVersion: 1, modes: ['light'] });
  try { await fs.symlink(outside, path.join(store.themes, 'linked', 'theme.css')); } catch (error) { if (process.platform !== 'win32' || error.code !== 'EPERM') throw error; linked = false; t.diagnostic('이 Windows 계정은 파일 심볼릭 링크를 만들 수 없어 연결된 테마 사례는 건너뜁니다.'); }
  await fs.writeFile(path.join(store.snippets, 'big.css'), 'b'.repeat(MAX_CSS + 1)); await fs.writeFile(path.join(store.snippets, 'notes.txt'), 'x');
  const list = await store.list(), error = id => list.themes.find(x => x.id === id).error;
  assert.match(error('broken'), /manifest/); assert.match(error('nocss'), /CSS 파일이 없습니다/); assert.match(error('huge'), /1MB/); if (linked) assert.match(error('linked'), /CSS 파일이 아닙니다/);
  assert.match(list.snippets.find(s => s.name === 'big.css').error, /1MB/); assert.ok(!list.snippets.some(s => s.name === 'notes.txt'));
  for (const id of ['broken', 'huge', ...(linked ? ['linked'] : []), '../x', 'Bad']) await assert.rejects(store.themeCss(id));
  for (const name of ['../x.css', 'a/b.css', 'notes.txt', 'big.css']) await assert.rejects(store.snippetCss(name));
});
