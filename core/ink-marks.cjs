// How the boxes of a text selection are painted, on the screen (desktop/ink.js) and in a saved or printed PDF
// (desktop/ink.cjs) alike: annotation underlines, one per line of text, and text highlights, each box once. A selection can
// give one line several boxes; they are joined or left out here, when drawing. The stored rects are never changed.
// Also the frame of a text box (its fill and border) and how its border's dashes are drawn.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api; else root.appInkMarks = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  // Boxes as seen ([x0, y0, x1, y1], y growing down); anything not four finite numbers is left out. Lines are told by the
  // boxes as given, never by boxes already joined: two are on one line when they share at least half of the taller one's
  // height (so a drop cap two lines high joins neither line) and lie within half the shorter one's height of each other
  // along it (overlapping or touching). A line runs under all its boxes, at the bottom of the line's letters: the deepest
  // of the boxes that cover half the line or more (a selection can give a line one box of the letters' cores and one of
  // the whole letters; the underline goes below p, y and g), or when none does, the bottom that most of the line's width
  // shares, the deeper on a tie. A narrow subscript, superscript or large symbol so never moves it. The result is
  // ordered from the top, then the left.
  function joinLineBoxes(boxes) {
    const list = (Array.isArray(boxes) ? boxes : []).filter(b => Array.isArray(b) && b.length === 4 && b.every(Number.isFinite))
      .map(b => [Math.min(b[0], b[2]), Math.min(b[1], b[3]), Math.max(b[0], b[2]), Math.max(b[1], b[3])]);
    const together = (a, b) => {
      const shared = Math.min(a[3], b[3]) - Math.max(a[1], b[1]), gap = Math.max(a[0], b[0]) - Math.min(a[2], b[2]);
      return shared >= Math.max(a[3] - a[1], b[3] - b[1]) / 2 && gap <= Math.min(a[3] - a[1], b[3] - b[1]) / 2;
    };
    const line = list.map((_, i) => i), find = i => (line[i] === i ? i : (line[i] = find(line[i])));
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) if (together(list[i], list[j])) line[find(j)] = find(i);
    const groups = new Map();
    list.forEach((b, i) => { const k = find(i); groups.set(k, [...(groups.get(k) || []), b]); });
    return [...groups.values()].map(group => {
      const x0 = Math.min(...group.map(b => b[0])), x1 = Math.max(...group.map(b => b[2])), width = b => b[2] - b[0];
      const deeper = (a, b) => (b[3] > a[3] ? b : a), wide = group.filter(b => width(b) >= (x1 - x0) / 2);
      let base;
      if (wide.length) base = wide.reduce(deeper);
      else {
        const shares = b => group.reduce((n, c) => n + (Math.abs(c[3] - b[3]) <= 0.05 * Math.min(b[3] - b[1], c[3] - c[1]) ? width(c) : 0), 0);
        base = group.map(b => [b, shares(b)]).reduce((a, b) => (b[1] > a[1] + 1e-9 || Math.abs(b[1] - a[1]) <= 1e-9 && b[0][3] > a[0][3] ? b : a))[0];
      }
      return [x0, base[1], x1, base[3]];
    }).sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  }
  // A text highlight's boxes as they are painted ([x0, y0, x1, y1] in any one space; anything not four finite numbers
  // left out). A selection gives a line wholly inside it twice (its element box and its text box), one within the
  // other: a box lying within another is left out, so one box is left per line. What remains is filled as one shape
  // (on the screen, in a saved PDF, in print), so where neighbouring lines meet the colour is laid once.
  function highlightBoxes(rects) {
    const list = (Array.isArray(rects) ? rects : []).filter(b => Array.isArray(b) && b.length === 4 && b.every(Number.isFinite))
      .map(b => [Math.min(b[0], b[2]), Math.min(b[1], b[3]), Math.max(b[0], b[2]), Math.max(b[1], b[3])]);
    const within = (a, b) => a[0] >= b[0] && a[1] >= b[1] && a[2] <= b[2] && a[3] <= b[3];
    return list.filter((a, i) => !list.some((b, j) => j !== i && within(a, b) && (!within(b, a) || j < i)));
  }
  // The lines an underline of selected text runs under, in PDF space ([x0, y0, x1, y1], y growing up): one box per line,
  // from the top line down. A selection gives a line wholly inside it two boxes (its element box and its text box);
  // drawn from every box, each such line had two underlines a fraction of a point apart. The line runs under the whole
  // letters, as joinLineBoxes finds it (which reads y growing down: the boxes are turned over for it and back).
  function underlineBoxes(rects) {
    return joinLineBoxes(highlightBoxes(rects).map(b => [b[0], -b[3], b[2], -b[1]])).map(b => [b[0], -b[3], b[2], -b[1]]);
  }
  // A text box's look beyond its letters (optional, on PDF pages and in notebooks alike): a fill ('#rrggbb', opaque) and a
  // border { color: '#rrggbb', width: points, style: 'solid' | 'dashed' | 'dotted' }. Without either the box has none.
  const TEXT_BORDER_WIDTHS = [0.5, 1, 1.5, 2, 3, 4, 6], TEXT_BORDER_STYLES = ['solid', 'dashed', 'dotted'];
  const hex = v => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);
  // A colour as it may go into HTML, SVG or a style: '#rrggbb', else null. Values read from disk are not checked when
  // read, so what draws them checks here.
  const hexColor = v => hex(v) ? v : null;
  // A box's fill and border as they may be drawn: both kept when the look is valid, neither when it is not.
  const textLook = item => item && validTextLook(item) ? { fill: item.fill || null, border: item.border || null } : { fill: null, border: null };
  function validTextLook(item) {
    if (item.fill !== undefined && !hex(item.fill)) return false;
    const b = item.border;
    return b === undefined || Boolean(b) && typeof b === 'object' && hex(b.color) && Number.isFinite(b.width) && b.width >= 0.5 && b.width <= 6 && TEXT_BORDER_STYLES.includes(b.style) && Object.keys(b).length === 3;
  }
  const cleanTextLook = item => ({ ...(item.fill ? { fill: item.fill.toLowerCase() } : {}), ...(item.border ? { border: { color: item.border.color.toLowerCase(), width: item.border.width, style: item.border.style } } : {}) });
  // A box on a PDF page, in page units (points): its text where it was written, the padding around it (a quarter of the
  // font size) and the border outside that, so neither ever moves or covers a letter.
  const textBoxFrame = stroke => { const pad = stroke.width * 0.25, border = stroke.border ? stroke.border.width : 0; return { pad, border, out: pad + border }; };
  // The dashes of a border of width w (lines with round ends draw the dots): dashed 3w on, 2w off; dotted a dot every 2w.
  const textBorderDash = (style, w) => style === 'dashed' ? [3 * w, 2 * w] : style === 'dotted' ? [0, 2 * w] : [];
  return { joinLineBoxes, highlightBoxes, underlineBoxes, TEXT_BORDER_WIDTHS, TEXT_BORDER_STYLES, validTextLook, cleanTextLook, hexColor, textLook, textBoxFrame, textBorderDash };
});
