// User corrections to a stored translation, kept apart from the AI result.
// Each entry remembers the AI text it replaced, so a later re-translation of
// the same paragraph is shown for comparison instead of silently winning or
// silently losing. The translation cache itself is never rewritten.
const fs = require('node:fs/promises');
const path = require('node:path');
const {tr}=require('../core/i18n.js');
const { atomicJson, readJson } = require('./storage.cjs');
const { VAULT_DIR } = require('./legacy.cjs');

class CorrectionStore {
  constructor(library) { this.library = library; this.chain = Promise.resolve(); }
  async file(attachmentId) { const dir = path.join(this.library.root, VAULT_DIR, 'corrections'); await fs.mkdir(dir, { recursive: true }); return path.join(dir, attachmentId + '.json'); }
  async read(paperId, attachmentId) { const a = this.library.attachment(paperId, attachmentId); return readJson(await this.file(a.id), { version: 1, entries: {} }); }
  // Corrections from another source version are kept but not applied.
  async apply(paperId, attachmentId, record) {
    if (!record) return record;
    const { entries } = await this.read(paperId, attachmentId), pages = [];
    let applied = 0, stale = 0;
    for (const page of record.pages) {
      if (!page) { pages.push(page); continue; }
      pages.push({ ...page, blocks: page.blocks.map(block => {
        const entry = entries[block.id];
        if (!entry || entry.sourceHash !== record.sourceHash) return block;
        applied++; const changed = entry.aiText !== (block.translation || ''); if (changed) stale++;
        return { ...block, translation: entry.text, corrected: true, aiTranslation: block.translation || '', ...(changed ? { correctionStale: true } : {}), warnings: [], missingTranslation: false };
      }) });
    }
    return { ...record, pages, corrections: { applied, stale } };
  }
  set(paperId, attachmentId, blockId, value) {
    const task = this.chain.then(async () => {
      if (typeof blockId !== 'string' || !/^[-\w:.]{1,100}$/.test(blockId) || !value || typeof value.text !== 'string' || !value.text.trim() || value.text.length > 24000 || typeof value.aiText !== 'string' || value.aiText.length > 24000 || !/^[a-f0-9]{64}$/.test(value.sourceHash)) throw Error(tr('번역 교정 내용을 확인하세요.'));
      const a = this.library.attachment(paperId, attachmentId), file = await this.file(a.id), data = await readJson(file, { version: 1, entries: {} }), old = data.entries[blockId];
      // History includes corrections that were reverted for this paragraph.
      const reverted = old ? [] : (data.removed || []).filter(r => r.blockId === blockId).flatMap(r => [...(r.history || []), { text: r.text, aiText: r.aiText, at: r.at }]);
      const at = new Date().toISOString(), history = [...reverted, ...(old?.history || []), ...(old ? [{ text: old.text, aiText: old.aiText, at: old.at }] : [])].slice(-20);
      data.entries[blockId] = { text: value.text.trim(), aiText: value.aiText, sourceHash: value.sourceHash, at, history };
      await atomicJson(file, data); return data.entries[blockId];
    });
    this.chain = task.catch(() => {}); return task;
  }
  // Going back to the AI text keeps the removed correction in history.
  remove(paperId, attachmentId, blockId) {
    const task = this.chain.then(async () => {
      const a = this.library.attachment(paperId, attachmentId), file = await this.file(a.id), data = await readJson(file, { version: 1, entries: {} }), old = data.entries[blockId];
      if (!old) return;
      (data.removed ||= []).push({ blockId, ...old, removedAt: new Date().toISOString() }); data.removed = data.removed.slice(-200);
      delete data.entries[blockId]; await atomicJson(file, data);
    });
    this.chain = task.catch(() => {}); return task;
  }
}
module.exports = { CorrectionStore };
