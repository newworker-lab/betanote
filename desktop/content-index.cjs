'use strict';
// What the search box (Ctrl+K) finds beyond the library record, which the window already has (memos, annotations):
// the text of text boxes on PDF pages (ink/<attachment>/<surface>, tool 'text') and of notebooks (title, text boxes,
// source cards' quotes), per paper, with where each one is, so a search can show the place and go there.
// Papers, attachments and notebooks in the trash give nothing, nor do deleted text boxes or the boxes of a surface
// drawn on a PDF that has changed since. The text is read once and kept in a cache per vault on this device
// (userData/content-index/<vault id>.json, never synced, sent or backed up); a file whose size or modification time
// changed is read again.
const fs = require('node:fs/promises');
const path = require('node:path');
const { VAULT_DIR } = require('./legacy.cjs');
const { readJson, atomicJson } = require('./storage.cjs');

const VERSION = 1;
// Search text: lower case and composed (Korean typed or pasted decomposed is found too).
const searchText = value => String(value ?? '').normalize('NFC').toLowerCase();
const signature = async files => { const out = []; for (const file of files) { const info = await fs.stat(file).catch(() => null); out.push(info ? `${info.size}:${Math.round(info.mtimeMs)}` : '-'); } return out.join('|'); };

class ContentIndex {
  constructor(directory) { this.directory = directory; this.caches = new Map(); }
  file(vaultId) { if (!/^[-a-zA-Z0-9]{1,100}$/.test(String(vaultId))) throw Error('vault id'); return path.join(this.directory, vaultId + '.json'); }
  async cache(vaultId) {
    if (this.caches.has(vaultId)) return this.caches.get(vaultId);
    const stored = await readJson(this.file(vaultId), null).catch(() => null);
    const cache = { entries: stored?.version === VERSION && stored.entries && typeof stored.entries === 'object' ? stored.entries : {}, dirty: false };
    this.caches.set(vaultId, cache); return cache;
  }
  // One cache entry: kept while the files it was read from are unchanged.
  async entry(cache, key, files, read) {
    const sig = await signature(files), old = cache.entries[key];
    if (old?.sig === sig && Array.isArray(old.parts)) return old.parts;
    const parts = await read(); cache.entries[key] = { sig, parts }; cache.dirty = true; return parts;
  }
  // { papers: { [paperId]: [part] } } for every paper outside the trash, or only those in `only`.
  //   text box: { kind: 'textbox', attachmentId, surface, page (from 1), id, text }
  //   notebook: { kind: 'notebook', notebookId, notebookTitle, text } (its title), or with pageId, page, id, y (an item)
  async parts(library, ink, notebooks, only = null) {
    const vault = path.join(library.root, VAULT_DIR), cache = await this.cache(library.data.id), papers = {}, seen = new Set();
    const wanted = only ? new Set(only.map(Number)) : null, add = (paperId, list) => { if (list.length) (papers[paperId] ||= []).push(...list); };
    const live = library.data.papers.filter(p => !p.trashedAt && (!wanted || wanted.has(p.id)));
    for (const paper of live) for (const attachment of paper.attachments.filter(a => !a.trashedAt)) {
      const folder = path.join(vault, 'ink', attachment.id), names = await fs.readdir(folder).catch(() => []);
      const surfaces = [...new Set(names.map(n => /^(original|t-[a-f0-9]{24})\.(json|log)$/.exec(n)?.[1]).filter(Boolean))].sort((a, b) => (a === 'original' ? -1 : b === 'original' ? 1 : a.localeCompare(b)));
      for (const surface of surfaces) {
        const key = `ink/${attachment.id}/${surface}`; seen.add(key);
        add(paper.id, await this.entry(cache, key, [path.join(folder, surface + '.json'), path.join(folder, surface + '.log')], async () => {
          const state = await ink.serial(attachment.id + '/' + surface, () => ink.state(attachment.id, surface));
          // Boxes drawn on a PDF that has changed since are not shown, so they are not found either.
          if (surface === 'original' && state.sourceHash && attachment.sourceHash && state.sourceHash !== attachment.sourceHash) return [];
          return state.strokes.filter(s => s.tool === 'text' && !s.deletedAt && typeof s.text === 'string' && s.text.trim())
            .map(s => ({ kind: 'textbox', attachmentId: attachment.id, surface, page: s.page + 1, id: s.id, text: s.text }));
        }));
      }
    }
    const ids = new Set(live.map(p => p.id)), dir = path.join(vault, 'notebooks');
    for (const name of await fs.readdir(dir).catch(() => [])) {
      if (!/^[-a-f0-9]{36}\.json$/.test(name)) continue;
      const key = 'notebooks/' + name; seen.add(key);
      const list = await this.entry(cache, key, [path.join(dir, name)], async () => {
        const n = await readJson(path.join(dir, name), null).catch(() => null);
        if (!n || n.trashedAt || !Number.isSafeInteger(n.paperId) || !Array.isArray(n.pages)) return [];
        const base = { kind: 'notebook', notebookId: n.id, notebookTitle: String(n.title || ''), paperId: n.paperId };
        const out = n.title ? [{ ...base, text: String(n.title) }] : [];
        n.pages.forEach((page, i) => { for (const item of page?.items || []) { const text = item.type === 'text' ? item.text : item.type === 'source' ? item.quote : null; if (typeof text === 'string' && text.trim()) out.push({ ...base, pageId: page.id, page: i + 1, id: item.id, y: item.y, text }); } });
        return out;
      });
      for (const { paperId, ...part } of list) if (ids.has(paperId)) add(paperId, [part]);
    }
    // Entries of files that are gone go too (only when every paper was looked at).
    if (!wanted) for (const key of Object.keys(cache.entries)) if (!seen.has(key)) { delete cache.entries[key]; cache.dirty = true; }
    if (cache.dirty) { cache.dirty = false; await fs.mkdir(this.directory, { recursive: true }); await atomicJson(this.file(library.data.id), { version: VERSION, entries: cache.entries }); }
    return { papers };
  }
}
module.exports = { ContentIndex, searchText };
