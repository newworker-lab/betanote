// What is said about the app outside its code matches it: the release notes do not call shipped features unsupported,
// the build info says what was checked as the release step was told, and the documents name files that exist.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
test('the release notes do not call the local OCR unsupported, and name what is not done as it is', t => {
  if (spawnSync('python3', ['--version']).status !== 0) return t.skip('python3 is not available');
  const notes = JSON.parse(execFileSync('python3', ['scripts/archive.py', '--dry-run'], { cwd: root, encoding: 'utf8' })).notes;
  assert.ok(fs.existsSync(path.join(root, 'desktop', 'ocr.cjs')), 'the app has its local OCR');
  assert.doesNotMatch(notes, /OCR[^.\n]*아직 지원하지 않습니다/, 'the OCR is not called unsupported');
  assert.match(notes, /OCR/, 'the OCR is named with what it reads');
  assert.match(notes, /다른 저장소/, 'copying and moving papers between vaults is in the changes');
});
test('the documents name source files that exist', () => {
  const files = ['README.md', 'CONTRIBUTING.md', 'AGENTS.md', 'docs/DEVELOPMENT.md', 'docs/RELEASE-READINESS.md', 'docs/BRANDING.md'].filter(f => fs.existsSync(path.join(root, f)));
  const missing = [];
  for (const file of files) for (const [, name] of fs.readFileSync(path.join(root, file), 'utf8').matchAll(/`((?:desktop|core|scripts|tests)\/[\w./-]+\.(?:cjs|mjs|js|py|json|css|html))`/g)) if (!fs.existsSync(path.join(root, name))) missing.push(`${file}: ${name}`);
  assert.deepEqual([...new Set(missing)], []);
});
