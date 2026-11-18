/* Markdown for notes: a small, safe subset with LaTeX math (KaTeX), as research
   notes commonly use. Everything is escaped first; only the markup below becomes
   HTML. Links open outside the app and only http(s) addresses become links.
   Runs in the renderer (global `katex`) and in Node for tests. */
(function (root, factory) {
  // The page's tr() (core/i18n.js is loaded first); in Node the module itself.
  const translate = typeof module === 'object' && module.exports ? require('../core/i18n.js').tr : (...args) => root.tr(...args);
  // The memo heads the app writes, in every language (core/memo-labels.cjs, loaded before this in the page).
  const labels = typeof module === 'object' && module.exports ? (() => { const m = require('../core/memo-labels.cjs'); return () => m; })() : () => root.appMemoLabels;
  // Bold, italic, strike and highlight, found as the live view finds them (md-marks.js, loaded before this in the page).
  const marks = typeof module === 'object' && module.exports ? require('./md-marks.js') : root.appMdMarks;
  const api = factory(() => (typeof katex !== 'undefined' ? katex : root.katex || null), translate, labels, marks);
  if (typeof module === 'object' && module.exports) module.exports = api; else Object.assign(root, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (getKatex, tr, labels, { marksHtml }) {
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // The header line that 그림 설명 or an adopted AI 설명 writes at the top of its memo, in whichever language
  // wrote it: [AI 설명 · file · 3페이지 · model]. It shows as a chip, named in the screen language, with a link to that page.
  const head = line => labels().readMemoHead(line);
  const LINK_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1 M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/></svg>';
  const AI_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/></svg>';
  const FIGURE_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3h18v18H3z M3 16l6-6 5 5 3-3 4 4 M15 7h.01"/></svg>';
  let katexLib = null;
  function math(tex, display) {
    katexLib ||= typeof require === 'function' && typeof window === 'undefined' ? require('katex') : getKatex();
    if (!katexLib) return `<code class="md-math-source">${esc(tex)}</code>`;
    try { return katexLib.renderToString(tex, { displayMode: display, throwOnError: false, trust: false, strict: 'ignore', output: 'html', maxSize: 50, maxExpand: 500 }); }
    catch { return `<code class="md-math-error" title="${tr('수식을 읽지 못했습니다')}">${esc(tex)}</code>`; }
  }
  // Inline text: code and math are set aside first, so their contents are not read as markup.
  function inline(text) {
    const kept = [], keep = html => `\u0000${kept.push(html) - 1}\u0000`;
    let s = String(text)
      .replace(/`([^`\n]+)`/g, (m, code) => keep(`<code>${esc(code)}</code>`))
      .replace(/\\\$/g, () => keep('$'))
      .replace(/\$\$([^$]+?)\$\$/g, (m, tex) => keep(math(tex, true)))
      .replace(/\$(?=\S)([^$\n]+?)(?<=\S)\$(?!\d)/g, (m, tex) => keep(math(tex, false)))
      .replace(/\\\((.+?)\\\)/g, (m, tex) => keep(math(tex, false)))
      .replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, (m, label, url) => keep(`<a href="${esc(url)}" data-external-link title="${esc(url)}">${inlineMarks(esc(label))}</a>`))
      .replace(/(^|[\s(])(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])/g, (m, lead, url) => lead + keep(`<a href="${esc(url)}" data-external-link>${esc(url)}</a>`));
    s = inlineMarks(esc(s))
      // (p. 3) or (p.12): the page of the source PDF.
      .replace(/\(p\.\s?(\d{1,4})\)/g, (m, page) => `<a href="#" class="md-page" data-annotation-page="${page}" title="${tr('{page}쪽으로 이동',{ page })}">(p. ${page})</a>`);
    // A link keeps its label's code and math inside it, so a kept piece can hold kept pieces: restore those too.
    const restore = t => t.replace(/\u0000(\d+)\u0000/g, (m, i) => restore(kept[Number(i)]));
    return restore(s);
  }
  const inlineMarks = s => marksHtml(s);
  const LIST = /^(\s*)([-*+]|\d{1,3}[.)])\s+(.*)$/;
  function list(lines, i) {
    const indentOf = l => l.match(/^\s*/)[0].replace(/\t/g, '  ').length;
    const base = indentOf(lines[i]), ordered = /\d/.test(lines[i].match(LIST)[2]);
    const items = [];
    while (i < lines.length) {
      const line = lines[i], m = line.match(LIST);
      if (m && indentOf(line) === base && /\d/.test(m[2]) !== ordered) break;
      if (m && indentOf(line) === base) { items.push({ text: m[3], children: [] }); i++; continue; }
      if (items.length && (m && indentOf(line) > base || line.trim() && indentOf(line) > base)) { items.at(-1).children.push(line); i++; continue; }
      break;
    }
    const html = items.map(item => {
      const task = item.text.match(/^\[([ xX])\]\s+(.*)$/);
      const body = task ? `<input type="checkbox" disabled ${task[1] !== ' ' ? 'checked' : ''}> ${inline(task[2])}` : inline(item.text);
      const nested = item.children.length ? blocks(item.children.map(l => l.replace(new RegExp(`^\\s{0,${base + 4}}`), ''))) : '';
      return `<li${task ? ' class="md-task"' : ''}>${body}${nested}</li>`;
    }).join('');
    return { html: ordered ? `<ol>${html}</ol>` : `<ul>${html}</ul>`, next: i };
  }
  const cells = line => line.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
  function blocks(lines) {
    const out = []; let i = 0, para = [];
    const flush = () => { if (para.length) out.push(`<p>${para.map(inline).join('<br>')}</p>`); para = []; };
    while (i < lines.length) {
      const line = lines[i], trimmed = line.trim();
      if (!trimmed) { flush(); i++; continue; }
      const fence = trimmed.match(/^(```|~~~)(.*)$/);
      if (fence) { flush(); const body = []; i++; while (i < lines.length && !lines[i].trim().startsWith(fence[1])) body.push(lines[i++]); i++; out.push(`<pre><code>${esc(body.join('\n'))}</code></pre>`); continue; }
      if (trimmed.startsWith('$$')) {
        flush(); const one = trimmed.match(/^\$\$(.+)\$\$$/);
        if (one) { out.push(`<div class="md-math">${math(one[1], true)}</div>`); i++; continue; }
        const body = [trimmed.slice(2)]; i++; while (i < lines.length && !lines[i].trim().endsWith('$$')) body.push(lines[i++]);
        if (i < lines.length) body.push(lines[i++].trim().slice(0, -2));
        out.push(`<div class="md-math">${math(body.join('\n').trim(), true)}</div>`); continue;
      }
      const figure = head(trimmed);
      if (figure) { flush(); const page = figure.page; out.push(`<div class="md-figure">${figure.kind === 'explain' ? AI_ICON : FIGURE_ICON}<span>${esc(figure.kind === 'explain' ? tr('AI 설명') : tr('그림 설명', null, 'kind'))} · ${esc(figure.detail)}</span>${page ? `<a href="#" class="md-source-link" data-annotation-page="${page}" title="${tr('{page}쪽 원문으로 이동', { page })}" aria-label="${tr('{page}쪽 원문으로 이동', { page })}">${LINK_ICON}</a>` : ''}</div>`); i++; continue; }
      // ![설명](note-image:<name>): a picture saved with the memo.
      const image = trimmed.match(/^!\[([^\]\n]{0,200})\]\(note-image:([0-9a-f]{32}\.png)\)$/);
      if (image) { flush(); const src = options.imageUrl?.(image[2]); out.push(src ? `<figure class="md-image"><img src="${esc(src)}" alt="${esc(image[1])}" loading="lazy">${image[1] ? `<figcaption>${esc(image[1])}</figcaption>` : ''}</figure>` : `<p class="muted">${tr('[그림: {name}]', { name: esc(image[1] || image[2]) })}</p>`); i++; continue; }
      const heading = trimmed.match(/^(#{1,6})\s+(.*)$/);
      if (heading) { flush(); const n = Math.min(3, heading[1].length) + 1; out.push(`<h${n}>${inline(heading[2])}</h${n}>`); i++; continue; }
      if (/^([-*_])(\s*\1){2,}$/.test(trimmed)) { flush(); out.push('<hr>'); i++; continue; }
      if (trimmed.startsWith('>')) { flush(); const body = []; while (i < lines.length && lines[i].trim().startsWith('>')) body.push(lines[i++].trim().replace(/^>\s?/, '')); out.push(`<blockquote>${blocks(body)}</blockquote>`); continue; }
      if (LIST.test(line)) { flush(); const r = list(lines, i); out.push(r.html); i = r.next; continue; }
      if (trimmed.includes('|') && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(lines[i + 1])) {
        flush(); const head = cells(line); i += 2; const rows = [];
        while (i < lines.length && lines[i].includes('|') && lines[i].trim()) rows.push(cells(lines[i++]));
        out.push(`<table><thead><tr>${head.map(c => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${head.map((_, k) => `<td>${inline(r[k] ?? '')}</td>`).join('')}</tr>`).join('')}</tbody></table>`); continue;
      }
      para.push(trimmed); i++;
    }
    flush(); return out.join('');
  }
  let options = {};
  // options.imageUrl(name) gives the address of a memo picture (none: a placeholder).
  function renderMarkdown(source, opts = {}) { const before = options; options = opts; try { return blocks(String(source ?? '').replace(/\r\n?/g, '\n').split('\n')); } finally { options = before; } }
  // A note's title: its first non-empty line without markup.
  function noteTitle(source) {
    const first = String(source ?? '').split('\n').map(l => l.trim()).find(Boolean) || '';
    const figure = head(first);
    return (figure ? figure.label + ' · ' + figure.detail : first.replace(/^#{1,6}\s+/, '').replace(/^[-*+>]\s+/, '').replace(/[*_~=`$]/g, '')).slice(0, 120);
  }
  const isFigureNote = source => Boolean(head(String(source ?? '').split('\n').map(l => l.trim()).find(Boolean) || ''));
  // The kind of a memo's head, by the Korean name the code compares with whatever language wrote it.
  const sourceKind = source => ({ explain: 'AI 설명', figure: '그림 설명' })[head(String(source ?? '').split('\n').map(l => l.trim()).find(Boolean) || '')?.kind] || ''; // i18n:keep — internal kind values
  return { renderMarkdown, noteTitle, isFigureNote, sourceKind, FIGURE_ICON, AI_ICON, LINK_ICON };
});
