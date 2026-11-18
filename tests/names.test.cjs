// The app's earlier names (core/app-name.json: history) are gone from the repository, line by line, except where
// they are kept on purpose: the name file itself, the translation placeholder PAPINOTE_MATH_ (renaming it would ask
// for finished chunks again), the repository's address (the repository keeps its name), the sections that tell the
// history (the takeover section of docs/DEVELOPMENT.md, the name history, review record and sources of
// docs/BRANDING.md, the release notice of docs/RELEASE-READINESS.md), the name-change notes of the release
// (docs/release/name-change.md) and the past designs and plans. The code, scripts and tests are kept free of the
// app's present name as well (tests/app-name.test.cjs).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const appName = require('../core/app-name.cjs');

const root = path.join(__dirname, '..');
const escape = text => RegExp.escape(text);
// Each earlier name, product name and id (a name of two words also run together or joined by a hyphen), and its
// default citation key prefix before a number.
const OLD = new RegExp(appName.history.flatMap(h => [
  ...new Set([h.name, h.product].flatMap(n => [escape(n), n.split(/\s+/).map(escape).join('[ -]?')])), escape(h.id), escape(h.citekeyPrefix) + '(?=\\d)',
]).join('|'), 'i');
const repository = /github\.com\/([^/]+\/[^/.]+)/.exec(JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).repository.url)[1];
const KEPT_TEXT = [/PAPINOTE_MATH_/g, new RegExp(escape(repository) + '\\b', 'g')];
// Whole files kept as they are.
const KEPT_FILES = new Set(['core/app-name.json', 'docs/release/name-change.md', 'package-lock.json']);
// Document sections that tell the history: from the heading to the next heading of that level or higher.
const SECTIONS = {
  'docs/DEVELOPMENT.md': [/^### 이전 이름에서 넘겨받기/],
  'docs/BRANDING.md': [/^## 이름 이력/, /^## \d+\. /, /^## 출처/],
  'docs/RELEASE-READINESS.md': [/^### 이름이 바뀐 첫 판의 릴리스 안내/],
};

function sectionLines(file, lines) {
  const starts = SECTIONS[file] || [], kept = new Set(); let level = 0;
  lines.forEach((line, i) => {
    const heading = /^(#+) /.exec(line);
    if (level && heading && heading[1].length <= level) level = 0;
    if (heading && starts.some(start => start.test(line))) level = heading[1].length;
    if (level) kept.add(i);
  });
  return kept;
}

test('no earlier name of the app is left but where it is kept on purpose', () => {
  const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
  const left = [];
  for (const file of files) {
    if (KEPT_FILES.has(file) || /\.(png|ico|jpe?g|gif|woff2?|ttf|pdf)$/i.test(file)) continue;
    let text; try { text = fs.readFileSync(path.join(root, file), 'utf8'); } catch { continue; }
    if (text.includes('\0')) continue;
    const lines = text.split('\n'), history = sectionLines(file, lines);
    lines.forEach((line, i) => {
      if (history.has(i) || !OLD.test(KEPT_TEXT.reduce((rest, kept) => rest.replace(kept, ''), line))) return;
      left.push(`${file}:${i + 1}: ${line.trim().slice(0, 140)}`);
    });
  }
  assert.deepEqual(left, [], `earlier names left:\n${left.join('\n')}`);
});
test('the earlier names are the name file\'s history, the latest first', () => {
  assert.ok(appName.history.length > 0);
  for (const h of appName.history) assert.ok(OLD.test(h.name) && OLD.test(h.id) && OLD.test(h.citekeyPrefix + '1'), h.name);
  assert.ok(!OLD.test(appName.name) && !OLD.test(appName.id), 'the present name is not an earlier one');
});
