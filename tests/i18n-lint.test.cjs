// Two checks on the texts wrapped in tr(): every wrapped text has its English, and a file that was
// moved to tr() has no Korean text left outside it. tests/i18n-pending.json lists the files not
// moved yet; each later task removes its own files from it. The scanner is a small tokenizer
// (not line regexes) so comments, URLs inside strings, nested templates and regex literals are
// read correctly.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
// core/i18n.js is the mechanism and core/i18n-en.js is the table itself: they are outside every
// check here (not through the pending list).
const EXCLUDED = new Set(['core/i18n.js', 'core/i18n-en.js']);
const SCOPE_DIRS = { desktop: /\.(js|cjs|mjs)$/, core: /\.(js|cjs)$/ };
const HANGUL = /[ᄀ-ᇿㄱ-ㆎ가-힣]/;

function scopeFiles() {
  const out = [];
  for (const [dir, pattern] of Object.entries(SCOPE_DIRS)) {
    for (const name of fs.readdirSync(path.join(root, dir)).sort()) {
      const rel = `${dir}/${name}`;
      if (pattern.test(name) && !EXCLUDED.has(rel)) out.push(rel);
    }
  }
  return out.sort();
}

// ---- tokenizer -------------------------------------------------------------------------------
// Token types: str, tpl (a template chunk: part = full|head|mid|tail), regex, id, num, punct.
// Comments go to a separate list.
const REGEX_AFTER_WORD = new Set(['return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw', 'case', 'do', 'else', 'yield', 'await']);
const ESCAPES = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', v: '\v', 0: '\0' };

function cook(raw) {
  return raw.replace(/\\(u\{([0-9a-fA-F]+)\}|u([0-9a-fA-F]{4})|x([0-9a-fA-F]{2})|\r?\n|[\s\S])/g, (whole, body, braced, u4, x2) => {
    if (braced) return String.fromCodePoint(parseInt(braced, 16));
    if (u4) return String.fromCharCode(parseInt(u4, 16));
    if (x2) return String.fromCharCode(parseInt(x2, 16));
    if (body[0] === '\n' || body[0] === '\r') return '';
    return Object.hasOwn(ESCAPES, body) ? ESCAPES[body] : body;
  });
}

function tokenize(src) {
  const tokens = [], comments = [], braces = [];   // braces: 'b' for { , 't' for a template's ${
  const parens = [];   // for each open (: whether it follows if/while/for/with, after whose ) a regex may start
  let i = 0, line = 1;
  const n = src.length;
  const last = () => tokens[tokens.length - 1];
  function regexAllowed() {
    const t = last();
    if (!t) return true;
    if (t.type === 'num' || t.type === 'str' || t.type === 'regex') return false;
    if (t.type === 'tpl') return t.part !== 'full' && t.part !== 'tail';
    if (t.type === 'id') return REGEX_AFTER_WORD.has(t.value);
    if (t.value === ')') return t.control === true;
    return t.value !== ']';
  }
  function readTemplate() {   // i is just past the backtick or the closing brace of ${}
    let raw = '';
    while (i < n) {
      const c = src[i];
      if (c === '\\') { raw += c + (src[i + 1] ?? ''); if (src[i + 1] === '\n') line++; i += 2; continue; }
      if (c === '`') { i++; return { raw, end: 'tail' }; }
      if (c === '$' && src[i + 1] === '{') { i += 2; braces.push('t'); return { raw, end: 'expr' }; }
      if (c === '\n') line++;
      raw += c; i++;
    }
    return { raw, end: 'tail' };
  }
  function pushTemplate(res, resumed, startLine) {
    const part = !resumed ? (res.end === 'tail' ? 'full' : 'head') : (res.end === 'tail' ? 'tail' : 'mid');
    tokens.push({ type: 'tpl', part, value: cook(res.raw), line: startLine });
  }
  while (i < n) {
    const c = src[i];
    if (c === '\n') { line++; i++; continue; }
    if (/\s/.test(c)) { i++; continue; }
    if (c === '/' && src[i + 1] === '/') {
      const s = i; while (i < n && src[i] !== '\n') i++;
      comments.push({ line, text: src.slice(s, i) }); continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      const s = i, startLine = line; i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { if (src[i] === '\n') line++; i++; }
      i += 2; comments.push({ line: startLine, endLine: line, text: src.slice(s, i) }); continue;
    }
    if (c === '"' || c === "'") {
      const s = ++i, startLine = line;
      while (i < n && src[i] !== c && src[i] !== '\n') { if (src[i] === '\\') { if (src[i + 1] === '\n') line++; i++; } i++; }
      tokens.push({ type: 'str', value: cook(src.slice(s, i)), line: startLine }); i++; continue;
    }
    if (c === '`') {
      const startLine = line; i++;
      pushTemplate(readTemplate(), false, startLine); continue;
    }
    if (c === '}' && braces[braces.length - 1] === 't') {
      braces.pop(); const startLine = line; i++;
      pushTemplate(readTemplate(), true, startLine); continue;
    }
    if (c === '/' && regexAllowed()) {
      // A regex literal ends on the same line; if no closing slash is found it was a division.
      let j = i + 1, inClass = false, ok = false;
      while (j < n && src[j] !== '\n') {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === '[') inClass = true; else if (src[j] === ']') inClass = false;
        else if (src[j] === '/' && !inClass) { ok = true; break; }
        j++;
      }
      if (ok) {
        j++; while (j < n && /[a-z]/i.test(src[j])) j++;
        tokens.push({ type: 'regex', value: src.slice(i, j), line }); i = j; continue;
      }
    }
    if (/[A-Za-z_$\u0080-￿]/.test(c)) {
      const s = i; while (i < n && /[\w$\u0080-￿]/.test(src[i])) i++;
      tokens.push({ type: 'id', value: src.slice(s, i), line }); continue;
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] || ''))) {
      const s = i; while (i < n && /[\w.]/.test(src[i])) i++;
      tokens.push({ type: 'num', value: src.slice(s, i), line }); continue;
    }
    if (c === '{') braces.push('b'); else if (c === '}') braces.pop();
    const tok = { type: 'punct', value: c, line };
    if (c === '(') { const prev = last(); parens.push(Boolean(prev && prev.type === 'id' && /^(if|while|for|with)$/.test(prev.value))); }
    else if (c === ')') tok.control = parens.pop() === true;
    tokens.push(tok); i++;
  }
  return { tokens, comments };
}

const isLiteral = (t) => t && (t.type === 'str' || (t.type === 'tpl' && t.part === 'full'));
const isEnd = (t) => t && t.type === 'punct' && (t.value === ',' || t.value === ')');

// Finds every tr( call, and every trIn(code, text, …) call by its second argument. Returns { calls: [{line, text, context}], problems: [{line, message}], argTokens }.
function scanCalls(tokens) {
  const calls = [], problems = [], firstArgs = new Set();
  for (let k = 0; k < tokens.length; k++) {
    const t = tokens[k];
    if (t.type !== 'id' || (t.value !== 'tr' && t.value !== 'trIn') || tokens[k + 1]?.value !== '(' || tokens[k + 1].type !== 'punct') continue;
    const before = tokens[k - 1];
    if (before && ((before.type === 'punct' && before.value === '.') || (before.type === 'id' && before.value === 'function'))) continue;
    // trIn: the text follows the language code (skipped, balanced).
    let at = k + 2;
    if (t.value === 'trIn') { let depth = 0; for (; at < tokens.length; at++) { const u = tokens[at]; if (u.type === 'tpl') { if (u.part === 'head') depth++; else if (u.part === 'tail') depth--; continue; } if (u.type !== 'punct') continue; if ('([{'.includes(u.value)) depth++; else if (')]}'.includes(u.value)) { if (depth === 0) break; depth--; } else if (u.value === ',' && depth === 0) break; } at++; }
    const first = tokens[at];
    if (!(isLiteral(first) && isEnd(tokens[at + 1]))) {
      problems.push({ line: t.line, message: `${t.value}() needs a single string literal as its text argument` });
      continue;
    }
    firstArgs.add(first);
    let context;
    if (tokens[at + 1].value === ',') {
      // Skip the values argument (balanced), then read the optional context.
      let depth = 0, m = at + 2;
      for (; m < tokens.length; m++) {
        const u = tokens[m];
        if (u.type === 'tpl') { if (u.part === 'head') depth++; else if (u.part === 'tail') depth--; continue; }
        if (u.type !== 'punct') continue;
        if ('([{'.includes(u.value)) depth++;
        else if (')]}'.includes(u.value)) { if (depth === 0) break; depth--; }
        else if (u.value === ',' && depth === 0) break;
      }
      if (tokens[m]?.value === ',' && tokens[m].type === 'punct') {
        const ctx = tokens[m + 1];
        if (ctx && ctx.type === 'punct' && ctx.value === ')') { /* trailing comma */ }
        else if (isLiteral(ctx) && isEnd(tokens[m + 2])) context = ctx.value;
        else problems.push({ line: t.line, message: 'the context argument of tr() must be a string literal' });
      }
    }
    calls.push({ line: t.line, text: first.value, context });
  }
  return { calls, problems, firstArgs };
}

function koreanOutsideTr(tokens, comments, firstArgs) {
  const keepLines = new Set();
  for (const c of comments) {
    if (/i18n:keep-next\b/.test(c.text)) keepLines.add((c.endLine ?? c.line) + 1);
    else if (/i18n:keep\b/.test(c.text)) keepLines.add(c.line);
  }
  const found = [];
  for (const t of tokens) {
    // Korean in a regex literal usually means the code tells screen text apart by its wording, which the
    // English screen breaks; a regex that reads the reader's own text or a paper carries i18n:keep.
    if ((t.type !== 'str' && t.type !== 'tpl' && t.type !== 'regex') || firstArgs.has(t) || !HANGUL.test(t.value)) continue;
    if (keepLines.has(t.line)) continue;
    found.push({ line: t.line, text: t.value, regex: t.type === 'regex' });
  }
  return found;
}

const cache = new Map();
function scanFile(rel) {
  if (!cache.has(rel)) {
    const { tokens, comments } = tokenize(fs.readFileSync(path.join(root, rel), 'utf8'));
    const { calls, problems, firstArgs } = scanCalls(tokens);
    cache.set(rel, { calls, problems, korean: koreanOutsideTr(tokens, comments, firstArgs) });
  }
  return cache.get(rel);
}

function loadPending() {
  return JSON.parse(fs.readFileSync(path.join(__dirname, 'i18n-pending.json'), 'utf8'));
}

// The English table: i18n-en.js registers it through addMessages, so catch what it passes.
let englishTable;
function loadEnglish() {
  if (englishTable) return englishTable;
  const i18n = require('../core/i18n.js');
  const real = i18n.addMessages, caught = {};
  i18n.addMessages = (code, table) => { if (code === 'en') Object.assign(caught, table); return real(code, table); };
  try { require('../core/i18n-en.js'); } finally { i18n.addMessages = real; }
  return (englishTable = caught);
}

const places = (text) => new Set([...String(text).matchAll(/\{(\w+)\}/g)].map((m) => m[1]));
const sameSet = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));
const show = (s) => JSON.stringify(s);
const label = (key) => show(key.replace('\u0004', ' [context: ') + (key.includes('\u0004') ? ']' : ''));

test('every tr() call has a single string literal as its first argument', () => {
  const failures = [];
  for (const rel of scopeFiles()) for (const p of scanFile(rel).problems) failures.push(`${rel}:${p.line} ${p.message}`);
  assert.deepEqual(failures, [], '\n' + failures.join('\n'));
});

test('the pending list names only files that exist and are in scope', () => {
  const pending = loadPending(), scope = new Set(scopeFiles());
  assert.deepEqual([...pending].sort(), pending, 'tests/i18n-pending.json must stay sorted');
  const stale = pending.filter((f) => !scope.has(f));
  assert.deepEqual(stale, [], `not in scope: ${stale.join(', ')}`);
});

test('every wrapped text has its English', () => {
  const pending = new Set(loadPending()), english = loadEnglish(), failures = [];
  for (const rel of scopeFiles()) {
    if (pending.has(rel)) continue;
    for (const call of scanFile(rel).calls) {
      const key = require('../core/i18n.js').messageKey(call.text, call.context);
      const entry = english[key];
      if (entry === undefined) { failures.push(`${rel}:${call.line} no English for ${label(key)}`); continue; }
      const want = places(call.text);
      const have = typeof entry === 'object' && entry !== null
        ? new Set([...places(entry.one), ...places(entry.other)])
        : places(entry);
      if (!sameSet(want, have)) failures.push(`${rel}:${call.line} placeholders differ for ${label(key)}: code {${[...want]}} vs English {${[...have]}}`);
    }
  }
  assert.deepEqual(failures, [], '\n' + failures.join('\n'));
});

test('nothing unused is left in the English table', () => {
  const { messageKey } = require('../core/i18n.js');
  const used = new Set();
  for (const rel of scopeFiles()) for (const call of scanFile(rel).calls) used.add(messageKey(call.text, call.context));
  const unused = Object.keys(loadEnglish()).filter((key) => !used.has(key)).map((key) => `unused English entry ${label(key)}`);
  assert.deepEqual(unused, [], '\n' + unused.join('\n'));
});

test('no Korean text is left outside tr() in a file that was moved', () => {
  const pending = new Set(loadPending()), failures = [];
  for (const rel of scopeFiles()) {
    if (pending.has(rel)) continue;
    for (const f of scanFile(rel).korean) failures.push(`${rel}:${f.line} ${f.regex ? 'Korean in a regex' : 'Korean outside tr()'}: ${show(f.text.length > 60 ? f.text.slice(0, 60) + '…' : f.text)}`);
  }
  assert.deepEqual(failures, [], '\n' + failures.join('\n'));
});

module.exports = { scopeFiles, scanFile, tokenize };
