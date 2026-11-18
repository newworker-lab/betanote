// The live view of the wide memo editor: one editable text where math,
// pictures, source headers, list markers and inline marks are rendered in place, and the one the cursor
// is in shows its source. Built on CodeMirror 6; bundled by scripts/build.mjs into
// dist/live-editor.js (window.appLiveEditor).
import { EditorState, StateField, StateEffect, EditorSelection, Transaction } from '@codemirror/state';
import { EditorView, Decoration, WidgetType, keymap, drawSelection, placeholder } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import liveScan from './live-scan.js';

const { scan } = liveScan;
class MathWidget extends WidgetType {
  constructor(tex, display, render) { super(); this.tex = tex; this.display = display; this.render = render; }
  eq(other) { return other.tex === this.tex && other.display === this.display; }
  toDOM() { const node = document.createElement(this.display ? 'div' : 'span'); node.className = this.display ? 'cm-math cm-math-block' : 'cm-math'; node.innerHTML = this.render(this.tex, this.display); node.title = this.tex; return node; }
  ignoreEvent() { return false; }
}
class ImageWidget extends WidgetType {
  constructor(name, alt, url) { super(); this.name = name; this.alt = alt; this.url = url; }
  eq(other) { return other.name === this.name && other.alt === this.alt; }
  // Loaded later than drawn: the editor measures its lines again once the picture has its height.
  toDOM(view) { const box = document.createElement('span'); box.className = 'cm-image'; const img = document.createElement('img'); img.addEventListener('load', () => view.requestMeasure(), { once: true }); img.src = this.url(this.name); img.alt = this.alt; box.append(img); return box; }
  ignoreEvent() { return false; }
}
class SourceWidget extends WidgetType {
  constructor(mark, icons) { super(); this.mark = mark; this.icons = icons; }
  eq(other) { return other.mark.label === this.mark.label && other.mark.detail === this.mark.detail; }
  toDOM() {
    const chip = document.createElement('span'); chip.className = 'cm-source md-figure';
    chip.innerHTML = `${this.mark.label === 'AI 설명' ? this.icons.ai : this.icons.figure}<span></span>`; chip.querySelector('span').textContent = `${this.mark.label === 'AI 설명' ? tr('AI 설명') : tr('그림 설명', null, 'kind')} · ${this.mark.detail}`; // i18n:keep — the kind live-scan names a head by
    if (this.mark.page) { const link = document.createElement('a'); link.href = '#'; link.className = 'md-source-link'; link.dataset.annotationPage = String(this.mark.page); link.title = tr('{page}쪽 원문으로 이동', { page: this.mark.page }); link.innerHTML = this.icons.link; chip.append(link); }
    return chip;
  }
  // The page link is a click for the app, not a place for the cursor.
  ignoreEvent(event) { return Boolean(event.target.closest?.('.md-source-link')); }
}
// A list item's marker shown: a bullet by depth, its number, or its box (ticked when done).
class ListWidget extends WidgetType {
  constructor(item) { super(); this.ordered = item.ordered; this.label = item.label; this.depth = item.depth; this.task = item.task; }
  eq(other) { return other.ordered === this.ordered && other.label === this.label && other.depth === this.depth && other.task === this.task; }
  toDOM() {
    const mark = document.createElement('span'); mark.className = 'cm-list-mark';
    if (this.task !== null) { const box = document.createElement('input'); box.type = 'checkbox'; box.disabled = true; box.checked = this.task === 'x'; box.tabIndex = -1; mark.append(box); }
    else mark.textContent = this.ordered ? this.label : ['•', '◦', '▪'][this.depth % 3];
    return mark;
  }
  ignoreEvent() { return false; }
}
const hidden = Decoration.replace({});
// Enter in a list item starts the next item: the same indent and bullet, the next number (those after follow on), an
// open box for a to-do. On an empty item it ends the list (an indented one comes out a level). One transaction, so one
// Ctrl+Z undoes it. A letter still being composed is left to the input method; a line break it makes at the end of an
// item is given the marker by listAfterBreak.
const ITEM = /^(\s*)([-*+]|(\d{1,3})([.)]))(\s+)(\[[ xX]\]\s+)?/;
const width = text => text.replace(/\t/g, '  ').length;
const nextMarker = m => m[1] + (m[3] ? `${Number(m[3]) + 1}${m[4]}` : m[2]) + ' ' + (m[6] ? '[ ] ' : '');
function renumbered(doc, lineNo, m, number) {
  const changes = [], base = width(m[1]);
  for (let n = lineNo + 1; n <= doc.lines; n++) {
    const line = doc.line(n), mm = line.text.match(ITEM);
    if (!mm) { if (!line.text.trim() || width(line.text.match(/^\s*/)[0]) <= base) break; continue; }
    const depth = width(mm[1]); if (depth > base) continue; if (depth < base || !mm[3]) break;
    number++; if (Number(mm[3]) !== number) changes.push({ from: line.from + mm[1].length, to: line.from + mm[1].length + mm[3].length, insert: String(number) });
  }
  return changes;
}
function listEnter(view) {
  const { state } = view; if (view.composing || state.selection.ranges.length > 1 || !state.selection.main.empty) return false;
  const head = state.selection.main.head, line = state.doc.lineAt(head), m = line.text.match(ITEM);
  if (!m || head < line.from + m[0].length) return false;
  if (!line.text.slice(m[0].length).trim()) {
    const indent = m[1].replace(/\t/g, '  '), insert = indent.length >= 2 ? indent.slice(2) + line.text.slice(m[1].length) : '';
    view.dispatch({ changes: { from: line.from, to: line.to, insert }, selection: { anchor: line.from + insert.length }, userEvent: 'input.list', scrollIntoView: true });
    return true;
  }
  const marker = nextMarker(m), changes = [{ from: head, insert: '\n' + marker }, ...(m[3] ? renumbered(state.doc, line.number, m, Number(m[3]) + 1) : [])];
  view.dispatch({ changes, selection: { anchor: head + 1 + marker.length }, userEvent: 'input.list', scrollIntoView: true });
  return true;
}
const listAfterBreak = EditorState.transactionFilter.of(tr => {
  if (!tr.docChanged || tr.isUserEvent('input.list') || !tr.isUserEvent('input')) return tr;
  const edits = []; tr.changes.iterChanges((fromA, toA, fromB, toB, inserted) => edits.push({ fromA, toA, fromB, text: inserted.toString() }));
  if (edits.length !== 1 || edits[0].text !== '\n' || edits[0].fromA !== edits[0].toA) return tr;
  const { fromA, fromB } = edits[0], line = tr.startState.doc.lineAt(fromA), m = line.text.match(ITEM);
  if (!m || fromA !== line.to || !line.text.slice(m[0].length).trim()) return tr;
  const marker = nextMarker(m);
  return [tr, { changes: { from: fromB + 1, insert: marker }, selection: { anchor: fromB + 1 + marker.length }, sequential: true }];
});
// Whether the editor has the focus. An editor nobody is typing in has no cursor to show sources for: its selection
// (at the start until someone clicks) would otherwise show the first line's picture, math or marks as source.
const focusSet = StateEffect.define();
const focusField = StateField.define({ create: () => false, update: (value, tr) => { for (const e of tr.effects) if (e.is(focusSet)) value = e.value; return value; } });
// A picture, a source head or a $$ block at the very end: a cursor put at the end would sit on it and show its source.
const endsInBlock = state => scan(state.doc.toString()).some(m => ['image', 'source', 'mathBlock'].includes(m.kind) && m.to === state.doc.length);
function decorations(state, options) {
  const focused = state.field(focusField, false), ranges = [], cursorIn = (from, to) => focused && state.selection.ranges.some(r => r.from <= to && r.to >= from);
  let group = null; // the outermost of marks inside one another (**==x==**, ***x***): their markers show together
  for (const m of scan(state.doc.toString())) {
    const active = cursorIn(m.from, m.to);
    if (m.kind === 'math') ranges.push(active ? Decoration.mark({ class: 'cm-math-source' }).range(m.from, m.to) : Decoration.replace({ widget: new MathWidget(m.tex, m.display, options.renderMath) }).range(m.from, m.to));
    else if (m.kind === 'mathBlock') {
      if (active) { for (let pos = m.from; pos <= m.to;) { const line = state.doc.lineAt(pos); ranges.push(Decoration.line({ class: 'cm-math-source-line' }).range(line.from)); pos = line.to + 1; } }
      else ranges.push(Decoration.replace({ widget: new MathWidget(m.tex, true, options.renderMath), block: true }).range(m.from, m.to));
    }
    else if (m.kind === 'image') { if (!active) ranges.push(Decoration.replace({ widget: new ImageWidget(m.name, m.alt, options.imageUrl) }).range(m.from, m.to)); }
    else if (m.kind === 'source') { if (!active) ranges.push(Decoration.replace({ widget: new SourceWidget(m, options.icons) }).range(m.from, m.to)); }
    // A list line: its marker shows as a bullet, a number or a box unless the cursor is on the line. The line hangs: a
    // wrapped line starts under the item's first letter, and the source marker (cursor on the line) takes the same room.
    else if (m.kind === 'list') {
      const indent = m.depth * 1.5, room = m.task !== null ? 1.6 : m.ordered ? 0.6 * m.label.length + 0.45 : 1;
      ranges.push(Decoration.line({ class: 'cm-li', attributes: { style: `--li-indent:${indent}em;--li-mark:${room}em` } }).range(m.from));
      ranges.push(active ? Decoration.mark({ class: 'cm-list-src' }).range(m.from, m.from + m.marker) : Decoration.replace({ widget: new ListWidget(m) }).range(m.from, m.from + m.marker));
    }
    else if (m.kind === 'heading') { ranges.push(Decoration.line({ class: `cm-h${m.level}` }).range(m.from)); if (!active) ranges.push(hidden.range(m.from, m.from + m.marker)); }
    else {
      // Bold, italic, strike, highlight, code: styled; the markers hide unless the cursor is there (in the outermost
      // of marks one inside another, so ***x*** shows all its stars, not some).
      if (m.kind !== 'code' && !(group && m.from < group.to)) group = m;
      ranges.push(Decoration.mark({ class: `cm-${m.kind}` }).range(m.from, m.to));
      if (!(m.kind === 'code' ? active : cursorIn(group.from, group.to))) { ranges.push(hidden.range(m.from, m.from + m.open)); ranges.push(hidden.range(m.to - m.close, m.to)); }
    }
  }
  return Decoration.set(ranges, true);
}
function create(parent, options) {
  const field = StateField.define({
    create: state => decorations(state, options),
    update: (value, tr) => tr.docChanged || tr.selection || tr.effects.some(e => e.is(focusSet)) ? decorations(tr.state, options) : value,
    provide: f => EditorView.decorations.from(f),
  });
  let external = false;
  // A line put under a picture at the end so the cursor has somewhere to be (focusEnd): the editor's own until something
  // is typed; leaving without typing takes it away again, so the memo is saved as it was.
  let padded = false;
  const quiet = spec => { external = true; try { view.dispatch({ ...spec, annotations: Transaction.addToHistory.of(false) }); } finally { external = false; } };
  const unpad = () => { if (!padded) return; padded = false; const doc = view.state.doc; if (doc.length && doc.sliceString(doc.length - 1) === '\n') quiet({ changes: { from: doc.length - 1, to: doc.length } }); };
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: options.doc || '',
      extensions: [
        history(), drawSelection(), EditorView.lineWrapping, focusField, EditorView.focusChangeEffect.of((state, focusing) => focusSet.of(focusing)), field, ...(options.placeholder ? [placeholder(options.placeholder)] : []),
        keymap.of([{ key: 'Enter', run: listEnter }, ...(options.keys || []), ...defaultKeymap, ...historyKeymap, indentWithTab]), listAfterBreak,
        EditorView.updateListener.of(update => { if (update.docChanged && !external) { padded = false; options.onChange?.(update.state.doc.toString()); } if (update.focusChanged && !update.view.hasFocus && padded) queueMicrotask(unpad); if (update.selectionSet || update.docChanged) options.onCursor?.(view); }),
        EditorView.contentAttributes.of({ 'aria-label': tr('메모 라이브 편집'), spellcheck: 'false' }),
      ],
    }),
  });
  return {
    view,
    getDoc: () => view.state.doc.toString(),
    // An edit as a pure function of (text, from, to, picked) → {text, from?, to?, select?}, the same as the plain editor's.
    apply(change) {
      const { from: a, to: b } = view.state.selection.main, value = view.state.doc.toString(), r = change(value, a, b, value.slice(a, b));
      const from = r.from ?? a, to = r.to ?? b, end = from + r.text.length;
      view.dispatch({ changes: { from, to, insert: r.text }, selection: r.select ? EditorSelection.range(r.select[0], r.select[1]) : EditorSelection.cursor(end), scrollIntoView: true });
      view.focus();
    },
    // Text changed elsewhere (another view, an AI result added to the memo): taken in without echoing back.
    // Text set from elsewhere (another view, the memo window, AI) is not this editor's own undo step.
    setDoc(text) { if (padded && text + '\n' === view.state.doc.toString()) return; padded = false; if (text === view.state.doc.toString()) return; external = true; try { view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text }, annotations: Transaction.addToHistory.of(false) }); } finally { external = false; } },
    focus() { view.focus(); },
    // The cursor at the end, ready to type; under a picture (or source head, or $$ block) that ends the memo, on a line of its own.
    focusEnd() {
      if (!padded && endsInBlock(view.state)) { padded = true; quiet({ changes: { from: view.state.doc.length, insert: '\n' } }); }
      view.dispatch({ selection: EditorSelection.cursor(view.state.doc.length) }); view.focus();
    },
    destroy() { view.destroy(); },
    get padded() { return padded; },
  };
}
globalThis.appLiveEditor = { create };
