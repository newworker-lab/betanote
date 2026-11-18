// The words a saved translated PDF carries follow the translation's language (they are part of that
// document); the print errors follow the screen.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const i18n = require('../core/i18n.js');
require('../core/i18n-en.js');
const { printText, preparePrintDocument } = require('../core/pdf-print.cjs');
const appName = require('../core/app-name.cjs');

test('an English screen saves a Korean translation with Korean labels, and its errors in English', () => {
  i18n.setUiLanguage('en');
  try {
    const ko = printText('ko');
    assert.equal(ko.continued, '원문 {page} · 계속 {count}');
    assert.equal(ko.sourceAt, '[{page}쪽] {text}');
    assert.equal(ko.keptFooter, '원문으로 둔 문단의 번역 · {count}');
    assert.doesNotMatch(ko.tooSmall + ko.unfinished, /[가-힣]/);
  } finally { i18n.setUiLanguage('ko'); }
});

test('a translation language without a table of its own gets the English labels, not the Korean', () => {
  for (const ui of ['ko', 'en']) {
    i18n.setUiLanguage(ui);
    try {
      const ja = printText('ja'), en = printText('en');
      for (const name of ['continued', 'sourceAt', 'keptFooter']) { assert.equal(ja[name], en[name]); assert.doesNotMatch(ja[name], /[가-힣]/); }
    } finally { i18n.setUiLanguage('ko'); }
  }
});

test('the print function given no text uses what printText("ko") gives', () => {
  const m = /text=text\|\|(\{[^;]*\});/.exec(preparePrintDocument.toString());
  assert.ok(m, 'the default is in the function');
  assert.deepEqual(Function(`return ${m[1]}`)(), printText('ko'));
});

test('the reading-mode PDF names its pages in the translation language, whatever the screen', () => {
  const { exportHtml } = require('../core/translation-core.cjs');
  const page = [{ width: 600, height: 800, blocks: [{ translation: '번역문' }] }];
  i18n.setUiLanguage('en');
  try {
    assert.match(exportHtml(page, [], 'reading', 'ko'), /<h2>1페이지 번역<\/h2>/);
    assert.match(exportHtml(page, [], 'reading', 'ja'), /<h2>Translation of page 1<\/h2>/);
  } finally { i18n.setUiLanguage('ko'); }
});

// The warnings a translation saves stay Korean whatever the screen: the record (and the hash ink reads from it)
// is the same, and only the screen and a saved PDF name them.
test('a translation made under an English screen saves the same record as under a Korean one', async t => {
  const fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path');
  const { Library } = require('../desktop/storage.cjs'), { TranslationJobs, source } = require('../desktop/translation.cjs');
  const { warningText } = require('../core/pdf-layout.js');
  const run = async ui => {
    i18n.setUiLanguage(ui);
    try {
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), `${appName.id}-warnings-`)); t.after(() => fs.rm(dir, { recursive: true, force: true }));
      await fs.mkdir(path.join(dir, 'vault')); const pdf = path.join(dir, 'test.pdf'); await fs.writeFile(pdf, '%PDF-1.4\nfixture');
      const library = await Library.open(path.join(dir, 'vault')); await library.importFiles([pdf]); const paperId = library.data.papers[0].id, { hash } = await source(library, paperId);
      const pages = [{ width: 600, height: 800, blocks: [{ id: 'p1-b1', text: 'Accuracy rose to 95.2% [12] with $x+y$ in each run.', x: 20, y: 20, width: 400, height: 40, fontSize: 12 }] }];
      const jobs = new TranslationJobs({ status: () => ({ usable: true }), models: async () => [{ id: 'model' }], translate: async (_m, blocks) => blocks.map(b => ({ id: b.id, text: '정확도가 올랐다.' })) });
      const job = await jobs.start(library, paperId, hash, pages, 'model');
      for (let i = 0; i < 200 && jobs.jobs.get(job.id).state === 'running'; i++) await new Promise(r => setTimeout(r, 10));
      const record = await jobs.cached(library, paperId); delete record.createdAt; return record;
    } finally { i18n.setUiLanguage('ko'); }
  };
  const ko = await run('ko'), en = await run('en'), warnings = ko.pages[0].blocks[0].warnings;
  assert.ok(warnings.length, 'the reply left out numbers and a formula');
  assert.equal(JSON.stringify(en), JSON.stringify(ko));
  assert.ok(warnings.every(w => /[가-힣]/.test(w)), 'saved in Korean');
  i18n.setUiLanguage('en');
  try { assert.ok(warnings.map(w => warningText(w)).every(w => !/[가-힣]/.test(w)), 'named in English on an English screen'); }
  finally { i18n.setUiLanguage('ko'); }
  assert.deepEqual(warnings.map(w => warningText(w, 'en')), warnings.map(w => warningText(w, 'ja')));
  assert.deepEqual(warnings.map(w => warningText(w, 'ko')), warnings);
});
