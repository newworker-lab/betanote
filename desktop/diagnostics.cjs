// A local record of what went wrong, for the reader to send when asking for help. It stays on
// this computer: nothing here is sent anywhere, and nothing is shown while the app works.
//
// What a line holds: the time, the kind of failure (an uncaught error, a crashed or frozen
// window, a refused or failed request by its name) and the error's name, message and stack.
// What it never holds: a paper's text, a memo, a path with the user's name or a vault's
// folders, a key or a token. Messages are scrubbed of those before they are written
// (scrub), whatever raised them.
//
// Size: one file of at most 512 KB and the two before it, 1.5 MB in all; the oldest goes
// first. An error that repeats is written a few times and then counted, so one failing
// loop cannot push everything else out.
const fs = require('node:fs');
const {tr}=require('../core/i18n.js');
const path = require('node:path');
const os = require('node:os');
const appName = require('../core/app-name.cjs');

const MAX_FILE = 512 * 1024;
const KEPT_FILES = 3;
const MAX_ENTRY = 4000;
const REPEAT_LIMIT = 5;
const REPORT_ENTRIES = 30;

const escape = text => String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Paths give away a user name and what the reader keeps where; keys and tokens must never
// reach a file; a long quoted string may be a sentence of a paper or a memo.
function scrub(text, { home = os.homedir(), places = [], secrets = [] } = {}) {
  let out = String(text ?? '');
  // The keys and tokens the app itself holds are taken out letter for letter, whatever they look like.
  for (const secret of secrets) if (typeof secret === 'string' && secret.length >= 6) out = out.split(secret).join('<secret>');
  for (const [dir, name] of [...places.filter(p => p && p[0]).sort((a, b) => b[0].length - a[0].length), [home, '<home>']]) {
    if (!dir || dir.length < 3) continue;
    for (const form of new Set([dir, dir.replace(/\\/g, '/'), dir.replace(/\//g, '\\')])) out = out.replace(new RegExp(escape(form), process.platform === 'win32' ? 'gi' : 'g'), name);
  }
  // What follows a named place is the reader's own folders and file names: only the kind of file
  // stays ("<vault>/….json"). The app's own files keep their names (they say where it failed).
  const kind=last=>/\.(?:c?js|mjs)$/i.test(last)?last:/\.[A-Za-z0-9]{1,8}$/.test(last)?last.replace(/^.*(\.[A-Za-z0-9]{1,8})$/,'…$1'):'…';
  out = out.replace(/(<home>|<vault>|<userData>)[\\/](?:[^\s"'<>|:*?\\/]+[\\/])*(?:[^"'<>|:*?\\/\n]{0,80}?\.[A-Za-z0-9]{1,8}(?![A-Za-z0-9])|[^\s"'<>|:*?\\/]+)/g, (all, place) => `${place}/${kind(all.split(/[\\/]/).pop())}`);
  return out
    // Whatever other path is left: likewise.
    .replace(/(?:[A-Za-z]:\\|\\\\|\/(?:home|Users|mnt|media|Volumes|tmp|var|private|opt|usr)\/)(?:[^\s"'<>|:*?\\/]+[\\/]|[^"'<>|:*?\\/\n]{1,60}[\\/])*([^\\/\s"'<>|:*?]{1,80})/g, (_all, last) => '<path>/' + kind(last))
    // A value named as a secret, whatever its shape ("key=…", "api_key": "…", "refresh_token=…", "password: …").
    .replace(/((?:api[-_ ]?key|x-api-key|key|token|secret|password|passwd|authorization|credential)s?["']?\s*[=:]\s*["']?)(?!<)(?:Bearer\s+)?[^\s"'&,;<>]{4,}/gi, '$1<secret>')
    // Keys by their makers' prefixes: OpenAI and Anthropic "sk-…", Google "AIza…", GitHub "gh?_…", Google OAuth "ya29.…".
    .replace(/\b(?:sk|pk|rk|sess)[-_][A-Za-z0-9_-]{6,}/g, '<key>')
    .replace(/\bAIza[A-Za-z0-9_-]{20,}/g, '<key>')
    .replace(/\bgh[pousr]_[A-Za-z0-9]{20,}/g, '<key>')
    .replace(/\bya29\.[A-Za-z0-9._-]{10,}/g, '<token>')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, 'Bearer <token>')
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}\b/g, '<token>')
    // Any other long run of letters and digits (32 or more, a digit among them) may be one.
    .replace(/\b(?=[A-Za-z0-9+/_-]*\d)[A-Za-z0-9+/_-]{32,}={0,2}/g, '<long>')
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '<email>')
    .replace(/(["'“‘`])([^"'”’`\n]{80,})\1/g, (_all, quote, inside) => `${quote}<${tr('{n}자',{n:inside.length})}>${quote}`);
}

class DiagnosticLog {
  // places: () => [[folder, name], …] of folders to name instead of spelling out (the open vault).
  // secrets: () => the keys and tokens held in memory, to take out of every line exactly.
  constructor({ directory, version = '', places = () => [], secrets = () => [], now = () => new Date(), maxFile = MAX_FILE }) {
    this.directory = directory; this.version = version; this.places = places; this.secrets = secrets; this.now = now; this.maxFile = maxFile;
    this.file = path.join(directory, 'app.log');
    this.repeats = new Map();
    this.size = null;
  }
  clean(text) { let places = [], secrets = []; try { places = this.places() || []; } catch { /* a line is still written without the place names */ } try { secrets = this.secrets() || []; } catch { /* a line is still written; the patterns in scrub remain */ } return scrub(text, { places, secrets }); }
  // kind: what failed ('uncaught', 'rejection', 'window-gone', 'window-frozen', 'request', 'page', …);
  // detail: a short name with it (the request's name); error: an Error or anything thrown.
  write(kind, error, detail = '') {
    try {
      const name = error?.name && error.name !== 'Error' ? error.name + ': ' : '';
      const message = this.clean(error?.message ?? error ?? '').replace(/\s+/g, ' ').slice(0, 600);
      const key = `${kind}|${detail}|${name}${message}`, seen = (this.repeats.get(key) || 0) + 1;
      this.repeats.set(key, seen); if (this.repeats.size > 500) this.repeats.delete(this.repeats.keys().next().value);
      if (seen > REPEAT_LIMIT) { if (seen === REPEAT_LIMIT * 20) this.append(`${this.stamp()} ${kind}${detail ? ' ' + this.clean(detail).slice(0, 80) : ''} ${name}${message} ${tr('(같은 오류 {n}번)',{n:seen})}`); return; }
      const stack = error?.stack ? this.clean(String(error.stack).split('\n').slice(1, 9).map(line => line.trim()).join(' | ')) : '';
      this.append(`${this.stamp()} ${kind}${detail ? ' ' + this.clean(detail).slice(0, 80) : ''} ${name}${message}${seen === REPEAT_LIMIT ? ' ' + tr('(이후 같은 오류는 세기만 함)') : ''}${stack ? ' @ ' + stack : ''}`.slice(0, MAX_ENTRY));
    } catch { /* a log that cannot be written must never take the app down */ }
  }
  stamp() { return this.now().toISOString(); }
  append(line) {
    fs.mkdirSync(this.directory, { recursive: true });
    if (this.size === null) { try { this.size = fs.statSync(this.file).size; } catch { this.size = 0; } }
    const bytes = Buffer.byteLength(line) + 1;
    if (this.size + bytes > this.maxFile && this.size > 0) this.rotate();
    fs.appendFileSync(this.file, line + '\n');
    this.size += bytes;
  }
  old(i) { return path.join(this.directory, `app.${i}.log`); }
  rotate() {
    try { fs.rmSync(this.old(KEPT_FILES - 1), { force: true }); } catch { /* the log cannot record its own failure */ }
    for (let i = KEPT_FILES - 2; i >= 1; i--) { try { fs.renameSync(this.old(i), this.old(i + 1)); } catch { /* the log cannot record its own failure */ } }
    try { fs.renameSync(this.file, this.old(1)); } catch { /* the log cannot record its own failure */ }
    this.size = 0;
  }
  // The newest lines, oldest first.
  recent(count = REPORT_ENTRIES) {
    const lines = [];
    for (const file of [this.file, ...Array.from({ length: KEPT_FILES - 1 }, (_, i) => this.old(i + 1))]) {
      if (lines.length >= count) break;
      let text = ''; try { text = fs.readFileSync(file, 'utf8'); } catch { continue; }
      lines.unshift(...text.split('\n').filter(Boolean).slice(-(count - lines.length)));
    }
    return lines.slice(-count);
  }
  // What "진단 정보 복사" puts on the clipboard: the app, the system and the latest lines.
  report(extra = {}) {
    const lines = this.recent();
    return [`${appName.name} ${this.version}`, ...Object.entries(extra).map(([k, v]) => `${k}: ${v}`), `${process.platform} ${os.release()} (${process.arch})`, tr('기록 시각 {time}',{time:this.stamp()}), '',
      lines.length ? tr('최근 오류 {n}개',{n:lines.length}) : tr('기록된 오류가 없습니다.'), ...lines].join('\n');
  }
}

module.exports = { DiagnosticLog, scrub, MAX_FILE, KEPT_FILES };
