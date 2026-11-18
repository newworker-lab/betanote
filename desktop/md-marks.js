/* Bold, italic, strike and highlight in a line of a memo: where each one is, as text offsets, one inside another
   where they nest. The reading view (markdown.js) makes its <strong>, <em>, <del> and <mark> from these, and the
   live view (live-scan.js) styles the same ranges, so the two always agree.
     **b** __b__ bold, *i* _i_ italic, ~~s~~ strike, ==h== highlight, ***bi*** bold italic.
   A mark opens before a letter and closes after one (not a space), so it can sit right against Korean
   particles (**굵게**는). **, == and ~~ also take a space just inside (** test**, from a selection made bold with the
   space at its end), unless the markers stand free between spaces (2 ** 3 ** 4). A single * or _ does not open after a letter or digit of the Latin alphabet, and _ does not
   close before one either (snake_case_name, 2*3*4 stay text). Code and math are left out by the caller.
   Runs in the renderer (global appMdMarks) and in Node for tests and the live editor's bundle. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api; else root.appMdMarks = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const PAIRS = { '~': 'strike', '=': 'mark' };
  const word = c => /[A-Za-z0-9_]/.test(c || '');
  const space = c => c === undefined || /\s/.test(c);
  const blank = c => c !== undefined && /\s/.test(c); // a space or tab (the line's ends are not)
  // marks(text, skip?) → [{ kind, from, to, open, close }], outer marks before the ones inside them. skip(i) is true
  // where no marker may stand (inside code or math).
  function marks(text, skip = () => false) {
    const out = [];
    const run = (i, c) => { let n = 0; while (text[i + n] === c) n++; return n; };
    const runStart = (i, c) => { while (i > 0 && text[i - 1] === c) i--; return i; };
    // Where `size` markers of c close a mark opened at `from`, searching [from, hi): the first run of c that is
    // preceded by a letter, with the closing markers taken from the run's end. A single * or _ closes only on a
    // run of one (or on the end of a longer run that closes the one around it), skipping ** inside.
    function closer(c, size, after, hi, single) {
      for (let i = after; i < hi; i++) {
        if (text[i] !== c || skip(i)) continue;
        const n = Math.min(run(i, c), hi - i), end = i + n;
        if (space(text[i - 1]) || n < size) { i = end - 1; continue; }
        if (c === '_' && size === 1 && word(text[end])) { i = end - 1; continue; }
        if (single && n !== 1) { i = end - 1; continue; }
        return end - size;
      }
      return -1;
    }
    // **, == and ~~ close at the next run of two (or, for **, more), with a space just inside either marker
    // allowed: a selection taken with a space at its end and made bold reads ** test** or **test **. A marker standing
    // free (a space on both sides, as in 2 ** 3 ** 4) makes a mark only with the other marker right against the text.
    function loosePair(c, k, hi) {
      const exact = c !== '*';
      for (let i = k + 2; i < hi; i++) {
        if (text[i] !== c || skip(i)) continue;
        const n = Math.min(run(i, c), hi - i), end = i + n;
        if (n < 2 || (exact && n !== 2)) { i = end - 1; continue; }
        const from = end - 2, inner = text.slice(k + 2, from);
        if (!/\S/.test(inner)) return null;
        const openTight = !blank(text[k + 2]), closeTight = !blank(text[from - 1]);
        const openFree = !openTight && blank(text[k - 1]), closeFree = !closeTight && blank(text[end]);
        if ((openFree && !closeTight) || (closeFree && !openTight)) return null;
        return { kind: c === '*' ? 'strong' : PAIRS[c], from: k, to: end, open: 2, close: 2 };
      }
      return null;
    }
    function scan(lo, hi) {
      for (let k = lo; k < hi; k++) {
        const c = text[k];
        if (skip(k) || !'*_~='.includes(c)) continue;
        const n = Math.min(run(k, c), hi - k);
        if (n === 2 && c !== '_' && text[k + 2] !== undefined) {
          const found = loosePair(c, k, hi);
          if (found) { out.push(found); scan(found.from + 2, found.to - 2); k = found.to - 1; } else k += n - 1;
          continue;
        }
        if (space(text[k + n])) { k += n - 1; continue; }
        let found = null;
        if (n === 2) {
          const end = closer(c, 2, k + 3, hi, false); if (end >= 0) found = [{ kind: 'strong', from: k, to: end + 2, open: 2, close: 2 }];
        } else if (n === 1) {
          if (!word(text[k - 1])) { const end = closer(c, 1, k + 2, hi, true); if (end >= 0) found = [{ kind: 'em', from: k, to: end + 1, open: 1, close: 1 }]; }
        } else if (n === 3 && !word(text[k - 1])) {
          // ***: bold and italic closed together, or one closed first and the other later; the one that closes later is outside.
          const both = closer(c, 3, k + 4, hi, false);
          if (both >= 0 && run(runStart(both, c), c) === 3) found = [{ kind: 'strong', from: k, to: both + 3, open: 2, close: 2 }, { kind: 'em', from: k + 2, to: both + 1, open: 1, close: 1 }];
          else {
            const em = closer(c, 1, k + 1, hi, true), strong = closer(c, 2, k + 3, hi, false);
            if (em >= 0 && em > strong) found = [{ kind: 'em', from: k, to: em + 1, open: 1, close: 1 }];
            else if (strong >= 0) found = [{ kind: 'strong', from: k, to: strong + 2, open: 2, close: 2 }];
          }
        }
        if (!found) { k += n - 1; continue; }
        out.push(...found);
        const inner = found.at(-1); scan(inner.from + inner.open, inner.to - inner.close);
        k = found[0].to - 1;
      }
    }
    scan(0, text.length);
    return out;
  }
  // The text with each mark made into its HTML tag (the text is escaped HTML already; the markers are not touched by escaping).
  const TAGS = { strong: 'strong', em: 'em', strike: 'del', mark: 'mark' };
  function marksHtml(text) {
    const found = marks(text);
    if (!found.length) return text;
    const opens = new Map(), closes = new Map(), drop = new Uint8Array(text.length);
    for (const m of found) {
      opens.set(m.from, (opens.get(m.from) || '') + `<${TAGS[m.kind]}>`);
      closes.set(m.to, `</${TAGS[m.kind]}>` + (closes.get(m.to) || ''));
      drop.fill(1, m.from, m.from + m.open); drop.fill(1, m.to - m.close, m.to);
    }
    let html = '';
    for (let i = 0; i <= text.length; i++) { html += (closes.get(i) || '') + (opens.get(i) || ''); if (i < text.length && !drop[i]) html += text[i]; }
    return html;
  }
  return { marks, marksHtml };
});
