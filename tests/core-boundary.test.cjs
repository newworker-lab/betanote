// core/ holds what a translation is made of and stays free of where it runs: no Node module, no
// Electron, nothing from desktop/. Another shell (a phone's web view) can then carry the same files.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');
const dir = path.join(__dirname, '..', 'core');
const files = fs.readdirSync(dir).filter(name => /\.(?:c?js|mjs)$/.test(name));
// What a core file may load: another core script, or a data file kept in core/ (the app's name, app-name.json).
const loadable = fs.readdirSync(dir).filter(name => /\.(?:c?js|mjs|json)$/.test(name));
const code = name => fs.readFileSync(path.join(dir, name), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('core files load only each other', () => {
  assert.ok(files.length >= 7);
  for (const name of files) {
    const text = code(name);
    // import('x') anywhere; a bare import 'x' where a statement starts (a line start, or after ; { }), so a
    // text that ends in "import" is not read as a load.
    for (const m of text.matchAll(/\brequire\(\s*(['"])([^'"]+)\1\s*\)|\bfrom\s+(['"])([^'"]+)\3|\bimport\s*\(\s*(['"])([^'"]+)\5|(?:^|[;{}])\s*import\s+(['"])([^'"]+)\7/gm)) {
      const target = m[2] || m[4] || m[6] || m[8];
      // The reader's script also loads PDF.js, which the build puts beside it.
      assert.ok(/^\.\/[\w.-]+$/.test(target) || (name === 'pdf-view.js' && target.startsWith('./pdfjs/')), `${name} loads ${target}`);
      if (!target.startsWith('./pdfjs/')) assert.ok(loadable.includes(target.slice(2)), `${name} loads ${target}, which is not in core/`);
    }
    assert.doesNotMatch(text, /\bprocess\.(?!env\b)|\b__dirname\b|\b__filename\b|\bBuffer\b|window\.appApi\b|\belectron\b/, name);
  }
});

test('the translation core runs where there is no Node', async () => {
  const esbuild = require('esbuild');
  // Bundled for a browser: a Node module anywhere behind it would fail here.
  const out = await esbuild.build({ entryPoints: [path.join(dir, 'translation-core.cjs')], bundle: true, platform: 'browser', format: 'iife', globalName: 'core', write: false, logLevel: 'silent' });
  const context = vm.createContext({ TextEncoder, Intl });
  vm.runInContext(out.outputFiles[0].text, context);
  const page = { width: 600, height: 800, blocks: [{ id: 'a', text: 'We measured the growth rate of each culture. It rose with temperature.', x: 50, y: 50, width: 400, height: 30, fontSize: 10, sectionId: 's', sectionTitle: 'Results' }] };
  const keys = vm.runInContext('(page=>core.pageChunks(core.validatePages([page])[0],{title:"T"},"m","h").map(c=>c.key))', context)(page);
  const here = require('../core/translation-core.cjs');
  assert.deepEqual([...keys], here.pageChunks(here.validatePages([page])[0], { title: 'T' }, 'm', 'h').map(c => c.key));
  assert.equal(keys.length, 1);
});

test('cache keys are the SHA-256 they always were', () => {
  const { sha256 } = require('../core/sha256.cjs'), { digest } = require('../core/translation-core.cjs');
  const node = text => crypto.createHash('sha256').update(text).digest('hex');
  const texts = ['', 'abc', '한글 수식 ∑ α→β 😀', ...[55, 56, 63, 64, 65, 119, 120, 4096].map(n => 'a'.repeat(n))];
  for (let i = 0; i < 200; i++) texts.push(Array.from({ length: (i * 7) % 300 }, (_, j) => String.fromCodePoint(32 + (i * 131 + j * 977) % 50000)).join('').toWellFormed());
  for (const text of texts) assert.equal(sha256(text), node(text));
  const value = { hash: 'h', model: 'm', prompt: 3, language: 'ko', context: { title: '제목' }, blocks: [{ id: 'a:s0', text: 'x \ud800 y' }] };
  assert.equal(digest(value), node(JSON.stringify(value)));
});

test('the reader asks its shell through one place', () => {
  const view = code('pdf-view.js');
  assert.match(view, /export function setHost\(/);
  for (const name of ['readOriginal', 'originalHash', 'ocrPage', 'openPdfLink']) assert.match(view, new RegExp('host\\(\\)\\.' + name + '\\b'), name);
});
