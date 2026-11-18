// The early design prototype is gone from the app: its sample papers, demo translation server, example folders
// ("Google Drive" folder picker), "UI 시안" dialogs and sample reader. Its words are looked for in the app's code
// (desktop/, core/, scripts/) and, when it has been built, in dist/. Google Drive itself stays: the sync folder can be
// one (desktop/sync.cjs).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const WORDS = ['UI 시안', '시안', '예시 폴더', '예시 저장소', '예시 데이터', '서지 예시', '체험', 'app-prototype', '/api/sample', '/api/jobs', 'BabelDOC', '로컬 번역 서버', 'design-sample', 'connect-drive', 'drive-connect', 'folder-picker', 'sampleReader', 'Attention Is All You Need']; // i18n:keep — the prototype's words, looked for

function files(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return ['pdfjs', 'katex', 'fonts', 'node_modules'].includes(entry.name) ? [] : files(full);
    return /\.(js|mjs|cjs|html|css|py|json)$/.test(entry.name) ? [full] : [];
  });
}

test('no word of the early prototype is left in the app or its build', () => {
  const left = [];
  for (const file of ['desktop', 'core', 'scripts', 'dist'].flatMap(dir => files(path.join(root, dir)))) {
    fs.readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
      for (const word of WORDS) if (line.includes(word)) left.push(`${path.relative(root, file)}:${i + 1}: ${word}`);
    });
  }
  assert.deepEqual(left, [], `prototype words left:\n${left.join('\n')}`);
});
