// Tells the app when the vault's folders or PDFs change outside it (a file copied in with the file
// manager, a sync tool, another program), so the list follows without "파일 목록 새로고침".
//
// The folder is watched; events are gathered for a moment, then the tree is read again (folders and
// PDFs with size and time, never their contents) and compared with the tree as it was when the app
// last read the folder in full (reading(): taken before that reading starts, so a change made while
// it runs is still reported). Only a difference is reported. The app's own imports, moves and
// deletions are reported too (nothing else tells them from an outside change without losing one made
// at the same moment); the window reads the vault again and redraws only if something differs.
// The app's own folder (.<id>) and other hidden names are not watched for.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const hidden = name => name.startsWith('.');
// Folders and PDFs under root as one hash. A vault too large to read quickly stops at 50,000 entries.
async function treeSignature(root) {
  const lines = [], pending = [''];
  while (pending.length && lines.length < 50000) {
    const folder = pending.pop(); let entries;
    try { entries = await fsp.readdir(path.join(root, folder), { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (hidden(entry.name)) continue;
      const relative = folder ? folder + '/' + entry.name : entry.name;
      if (entry.isDirectory()) { lines.push('d ' + relative); pending.push(relative); }
      else if (entry.isFile() && /\.pdf$/i.test(entry.name)) { try { const info = await fsp.stat(path.join(root, relative)); lines.push(`f ${relative} ${info.size} ${Math.round(info.mtimeMs)}`); } catch { /* removed between the listing and the look */ } }
    }
  }
  return crypto.createHash('sha1').update(lines.sort().join('\n')).digest('hex');
}

class VaultWatch {
  // onChange(root): the tree differs from what was last shown. delay: how long events are gathered.
  constructor({ onChange, onProblem, delay = 1200 }) { this.onChange = onChange; this.onProblem = onProblem; this.delay = delay; this.root = null; this.known = null; this.watchers = []; this.timer = null; this.work = Promise.resolve(); }
  start(root) {
    this.stop(); this.root = root; this.known = null; this.shown();
    const fire = (_event, file) => {
      // A change inside a hidden folder (.<id>: the app's own records) is none of the tree's.
      if (file && String(file).split(/[\\/]/).some(hidden)) return;
      clearTimeout(this.timer); this.timer = setTimeout(() => this.check(root), this.delay); this.timer.unref?.();
    };
    // Recursive watching is not there on every system: the top folder alone is watched then.
    try { this.watchers.push(fs.watch(root, { recursive: true }, fire)); }
    catch { try { this.watchers.push(fs.watch(root, fire)); } catch (error) { this.onProblem?.('vault-watch', error); } }
    for (const watcher of this.watchers) watcher.on('error', () => {});
  }
  stop() { clearTimeout(this.timer); for (const watcher of this.watchers) try { watcher.close(); } catch { /* already closed */ } this.watchers = []; this.root = null; }
  // The app is about to read the folder in full: the tree as it is now is what it will have seen.
  // Call the returned function once that reading has succeeded.
  reading() { const root = this.root, taken = root ? treeSignature(root).catch(() => null) : Promise.resolve(null); return () => this.work = this.work.then(async () => { const signature = await taken; if (signature && this.root === root) this.known = signature; }).catch(() => {}); }
  shown() { return this.reading()(); }
  check(root) { return this.work = this.work.then(async () => { if (this.root !== root) return; const signature = await treeSignature(root); if (this.root !== root || signature === this.known) return; this.known = signature; this.onChange(root); }).catch(() => {}); }
}
module.exports = { VaultWatch, treeSignature };
