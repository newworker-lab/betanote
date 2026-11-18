const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { Library } = require('../desktop/storage.cjs');
const { CorrectionStore } = require('../desktop/corrections.cjs');
const appName = require('../core/app-name.cjs');
const pdf = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n%%EOF');
test('corrections overlay the AI translation, keep history and flag a changed re-translation', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `${appName.id}-corr-`)); t.after(() => fs.rm(dir, { recursive: true, force: true }));
  await fs.mkdir(path.join(dir, 'vault')); await fs.writeFile(path.join(dir, 'a.pdf'), pdf);
  const library = await Library.open(path.join(dir, 'vault')), [{ paperId, attachmentId }] = await library.importFiles([path.join(dir, 'a.pdf')]);
  const hash = library.attachment(paperId, attachmentId).sourceHash, store = new CorrectionStore(library);
  const record = ai => ({ version: 1, sourceHash: hash, pages: [{ width: 1, height: 1, blocks: [{ id: 'p1-b1', text: 'Source', translation: ai, warnings: ['x'] }, { id: 'p1-b2', text: 'Other', translation: '다른 문단' }] }, null] });
  await store.set(paperId, attachmentId, 'p1-b1', { text: '사용자 교정', aiText: 'AI 번역', sourceHash: hash });
  await store.set(paperId, attachmentId, 'p1-b1', { text: '두 번째 교정', aiText: 'AI 번역', sourceHash: hash });
  const same = await store.apply(paperId, attachmentId, record('AI 번역'));
  assert.deepEqual([same.pages[0].blocks[0].translation, same.pages[0].blocks[0].aiTranslation, same.pages[0].blocks[0].corrected, same.pages[0].blocks[0].correctionStale, same.pages[0].blocks[0].warnings], ['두 번째 교정', 'AI 번역', true, undefined, []]);
  assert.equal(same.pages[0].blocks[1].corrected, undefined); assert.equal(same.pages[1], null);
  const original = record('AI 번역'); assert.equal(original.pages[0].blocks[0].translation, 'AI 번역', 'the AI record is not modified');
  const entry = (await store.read(paperId, attachmentId)).entries['p1-b1'];
  assert.deepEqual(entry.history.map(h => h.text), ['사용자 교정']);
  // A re-translation gives new AI text: the correction stays, flagged for comparison.
  const again = await store.apply(paperId, attachmentId, record('새 AI 번역'));
  assert.deepEqual([again.pages[0].blocks[0].translation, again.pages[0].blocks[0].correctionStale, again.corrections], ['두 번째 교정', true, { applied: 1, stale: 1 }]);
  // Corrections for another source version are not applied.
  assert.equal((await store.apply(paperId, attachmentId, { ...record('AI'), sourceHash: 'f'.repeat(64) })).pages[0].blocks[0].translation, 'AI');
  await store.remove(paperId, attachmentId, 'p1-b1');
  assert.equal((await store.apply(paperId, attachmentId, record('새 AI 번역'))).pages[0].blocks[0].translation, '새 AI 번역');
  assert.equal((await store.read(paperId, attachmentId)).removed[0].text, '두 번째 교정');
  await store.set(paperId, attachmentId, 'p1-b1', { text: '세 번째', aiText: '새 AI 번역', sourceHash: hash });
  assert.deepEqual((await store.read(paperId, attachmentId)).entries['p1-b1'].history.map(h => h.text), ['사용자 교정', '두 번째 교정'], 'reverted corrections stay in history');
  await assert.rejects(store.set(paperId, attachmentId, '../x', { text: 'a', aiText: '', sourceHash: hash }), /교정/);
});
