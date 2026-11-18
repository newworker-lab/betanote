/* Live view scanner: where the math, pictures, source headers, list items and inline marks of a
   memo are, as text offsets. The live editor renders each one in place unless the
   cursor is inside it (then its source shows). Code is skipped.
   Runs in the renderer bundle and in Node for tests. */
(function (root, factory) {
  // The memo heads the app writes, in every language (core/memo-labels.cjs, loaded before this in the page).
  const labels = typeof module === 'object' && module.exports ? (() => { const m = require('../core/memo-labels.cjs'); return () => m; })() : () => root.appMemoLabels;
  // Bold, italic, strike and highlight, found as the reading view finds them (md-marks.js).
  const marks = typeof module === 'object' && module.exports ? require('./md-marks.js') : root.appMdMarks;
  const api = factory(labels, marks);
  if (typeof module === 'object' && module.exports) module.exports = api; else root.appLiveScan = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (labels, { marks }) {
  const IMAGE = /^!\[([^\]\n]{0,200})\]\(note-image:([0-9a-f]{32}\.png)\)$/;
  // A head the app wrote, in whichever language wrote it; its label is the Korean kind name the editor compares with.
  const source = t => { const head = labels().readMemoHead(t); return head && !/[\]\n]/.test(head.detail) ? { label: head.kind === 'explain' ? 'AI 설명' : '그림 설명', detail: head.detail, page: head.page || null } : null; }; // i18n:keep — internal kind values
  function scan(text) {
    const out = [], lines = text.split('\n'), starts = [];
    let at = 0; for (const line of lines) { starts.push(at); at += line.length + 1; }
    let fence = null;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i], t = line.trim(), start = starts[i];
      if (fence) { if (t.startsWith(fence)) fence = null; continue; }
      if (/^(```|~~~)/.test(t)) { fence = t.slice(0, 3); continue; }
      // $$ … $$ over several lines: one block from the opening line to the closing one.
      if (t.startsWith('$$') && !(t.length > 4 && t.endsWith('$$'))) {
        let j = i + 1; while (j < lines.length && !lines[j].trim().endsWith('$$')) j++;
        if (j < lines.length) {
          const body = [t.slice(2), ...lines.slice(i + 1, j), lines[j].trim().slice(0, -2)].join('\n').trim();
          out.push({ kind: 'mathBlock', from: start, to: starts[j] + lines[j].length, tex: body }); i = j; continue;
        }
      }
      const image = t.match(IMAGE); if (image) { const lead = line.indexOf(t); out.push({ kind: 'image', from: start + lead, to: start + lead + t.length, alt: image[1], name: image[2] }); continue; }
      const head = source(t); if (head) { const lead = line.indexOf(t); out.push({ kind: 'source', from: start + lead, to: start + lead + t.length, ...head }); continue; }
      const heading = line.match(/^(#{1,6})\s+/); if (heading) out.push({ kind: 'heading', from: start, to: start + line.length, level: Math.min(3, heading[1].length), marker: heading[0].length });
      // A list item ("- ", "* ", "+ ", "1. ", "1) ", a to-do "- [ ] "), wherever it stands (right under a paragraph too, as
      // the reading view takes it): its marker, how deep it is (two spaces a level), its number or its box.
      const item = line.match(/^(\s*)([-*+]|(\d{1,3})[.)])\s+(\[([ xX])\]\s+)?/);
      if (item) out.push({ kind: 'list', from: start, to: start + line.length, marker: item[0].length, ordered: Boolean(item[3]), label: item[3] ? item[2] : null, depth: Math.floor(item[1].replace(/\t/g, '  ').length / 2), task: item[5] ? item[5].toLowerCase() : null });
      inline(line, start, out);
    }
    return out.sort((a, b) => a.from - b.from || b.to - a.to);
  }
  function inline(line, start, out) {
    const taken = []; // ranges already used (code, math) where no other mark starts
    const free = (a, b) => !taken.some(([x, y]) => a < y && b > x);
    // Code spans.
    for (let k = 0; k < line.length; k++) {
      if (line[k] !== '`') continue; const end = line.indexOf('`', k + 1); if (end < 0) break;
      out.push({ kind: 'code', from: start + k, to: start + end + 1, open: 1, close: 1 }); taken.push([k, end + 1]); k = end;
    }
    // $$x$$ on one line (display), then $x$.
    for (let k = 0; k < line.length; k++) {
      if (!free(k, k + 1)) continue;
      if (line[k] === '\\') { k++; continue; }
      if (line[k] !== '$') continue;
      if (line[k + 1] === '$') { const end = line.indexOf('$$', k + 2); if (end > k + 2 && free(k, end + 2)) { out.push({ kind: 'math', display: true, from: start + k, to: start + end + 2, tex: line.slice(k + 2, end) }); taken.push([k, end + 2]); k = end + 1; } else k++; continue; }
      if (/\s/.test(line[k + 1] || ' ')) continue;
      let end = -1; for (let m = k + 1; m < line.length; m++) { if (line[m] === '\\') { m++; continue; } if (line[m] === '$') { if (line[m + 1] !== '$' && !/\s/.test(line[m - 1]) && !/\d/.test(line[m + 1] || '')) end = m; break; } }
      if (end > k + 1 && free(k, end + 1)) { out.push({ kind: 'math', display: false, from: start + k, to: start + end + 1, tex: line.slice(k + 1, end) }); taken.push([k, end + 1]); k = end; }
    }
    // Bold, italic, strike and highlight, one inside another where they nest; no marker inside code or math.
    for (const m of marks(line, k => !free(k, k + 1))) out.push({ ...m, from: start + m.from, to: start + m.to });
  }
  return { scan };
});
