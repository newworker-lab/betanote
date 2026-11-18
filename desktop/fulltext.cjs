// Full-text search across every PDF in a vault. The index is device data:
// one text file per source hash under the app's user-data folder, filled by
// the renderer's PDF.js worker and rebuilt whenever it is missing, so it
// never needs syncing or backup.
const fs = require('node:fs/promises');
const path = require('node:path');
const {tr}=require('../core/i18n.js');
const { readJson, atomicJson } = require('./storage.cjs');

const VERSION = 1, MEMORY_CHARS = 6e7;
// Parsed indexes stay in memory (least recently used dropped past ~60M
// characters), so a query does not re-read and re-parse every file; an index
// only changes through store(), which updates the copy here.
class FullText {
  constructor(directory) { this.directory = directory; this.memory = new Map(); this.memoryChars = 0; }
  file(hash) { if (typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash)) throw Error(tr('PDF 해시를 확인하세요.')); return path.join(this.directory, hash + '.json'); }
  remember(hash, pages) {
    const old = this.memory.get(hash); if (old) { this.memory.delete(hash); this.memoryChars -= old.chars; }
    const chars = pages.reduce((n, p) => n + p.length, 0); this.memory.set(hash, { pages, chars }); this.memoryChars += chars;
    for (const [key, entry] of this.memory) { if (this.memoryChars <= MEMORY_CHARS || this.memory.size <= 1) break; this.memory.delete(key); this.memoryChars -= entry.chars; }
  }
  async cached(hash) {
    const hit = this.memory.get(hash); if (hit) { this.remember(hash, hit.pages); return hit.pages; }
    const stored = await readJson(this.file(hash), null), pages = stored?.version === VERSION && Array.isArray(stored.pages) ? stored.pages : null;
    if (pages) this.remember(hash, pages); return pages;
  }
  async has(hash) { if (this.memory.has(hash)) return true; try { await fs.access(this.file(hash)); return true; } catch { return false; } }
  // Original PDFs (not translation attachments) of papers outside the trash.
  async targets(library) {
    const out = [];
    for (const paper of library.data.papers.filter(p => !p.trashedAt)) for (const attachment of paper.attachments.filter(a => !a.trashedAt && a.role !== 'translated')) {
      let hash;
      try { await library.resolveFile(paper.id, 'attachment-' + attachment.id); hash = attachment.sourceHash || await library.fingerprint(attachment.path); } catch { continue; }
      if (hash) out.push({ paperId: paper.id, attachmentId: attachment.id, name: attachment.name, hash, indexed: await this.has(hash) });
    }
    return out;
  }
  async store(hash, pages) {
    if (!Array.isArray(pages) || pages.length > 5000 || pages.some(p => typeof p !== 'string') || pages.reduce((n, p) => n + p.length, 0) > 2e7) throw Error(tr('PDF 본문 색인을 확인하세요.'));
    await atomicJson(this.file(hash), { version: VERSION, pages }); this.remember(hash, pages);
  }
  // Every term must appear on the same page (case and spacing ignored).
  async search(library, query, { limit = 200 } = {}) {
    const terms = String(query || '').toLowerCase().split(/\s+/).filter(Boolean).slice(0, 10);
    if (!terms.length || terms.some(t => t.length > 200)) throw Error(tr('검색어를 입력하세요.'));
    const results = [], missing = [], unreadable = [], targets = await this.targets(library);
    for (const target of targets) {
      const pages = await this.cached(target.hash);
      if (!pages) { missing.push(target.name); continue; }
      if (!pages.some(p => p.trim())) { unreadable.push(target.name); continue; }
      const hits = [];
      pages.forEach((text, i) => { const lower = text.toLowerCase(); if (terms.every(t => lower.includes(t))) { const at = lower.indexOf(terms[0]); hits.push({ page: i + 1, snippet: text.slice(Math.max(0, at - 60), at + terms[0].length + 80).replace(/\s+/g, ' ').trim() }); } });
      if (hits.length) results.push({ paperId: target.paperId, attachmentId: target.attachmentId, name: target.name, count: hits.length, hits: hits.slice(0, 5) });
      if (results.length >= limit) break;
    }
    return { results, searched: targets.length, missing, unreadable };
  }
}
module.exports = { FullText };
