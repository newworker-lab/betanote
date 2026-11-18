// A catch that does nothing says why, or is one of two plain cases: a screen preference kept in localStorage
// (the default is used) and an optional value read as JSON (absent is the same as unreadable). Anything else
// either records the failure (docs/DEVELOPMENT.md, "진단 기록과 오류 안내") or carries its reason in the braces.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
test('an empty catch is a preference or optional-JSON read, or gives its reason', () => {
  const unexplained = [];
  for (const dir of ['core', 'desktop']) for (const name of fs.readdirSync(path.join(root, dir))) {
    if (!/\.(cjs|mjs|js)$/.test(name)) continue;
    fs.readFileSync(path.join(root, dir, name), 'utf8').split('\n').forEach((line, index) => {
      for (const match of line.matchAll(/catch\s*(\([^)]*\))?\s*\{\s*\}/g)) {
        const start = line.lastIndexOf('try', match.index), tried = start < 0 ? '' : line.slice(start, match.index);
        if (!/localStorage|JSON\.parse|\.json\(\)/.test(tried)) unexplained.push(`${dir}/${name}:${index + 1}`);
      }
    });
  }
  assert.deepEqual(unexplained, []);
});
