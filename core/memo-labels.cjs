// What the app writes into memos and annotations (heads, labels, picture names), in the eight languages
// an AI answer can be in, and how those heads are read back whichever language wrote them.
// Text is written in the AI answer language (appApi.language.aiResolved) and kept as written: a memo
// made in Korean keeps its Korean head on every screen, and a device that writes English heads into a
// synced vault is read the same way. The Korean values are the text the app has always written.
// The separators (" · ", brackets, colons) are the same in every language.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api; else root.appMemoLabels = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  // The words, per language. {page} and {n} are filled in; "AI " in front of an AI head is the same everywhere.
  // A word used for reading back (explain, figure, selection, contribution, page, pageShort) must not simply be
  // changed once memos were written with it: they would no longer be recognized. When one changes, keep the old word
  // in READ_TOO below so it is still read. The other words are only written (summary was 구조화 요약 before 1.1.2, and
  // the like in the other languages; a head written with it is still an AI head: isAiHead reads any [AI … ]).
  const WORDS = Object.freeze({
    ko: { explain: '설명', figure: '그림 설명', page: '{page}페이지', pageShort: '{page}쪽', summary: '요약', selection: '선택 설명', question: '질문', compare: '비교', comparedWith: '함께 비교', contribution: '기여', translation: '번역', modelReading: '모델 해석', noEvidence: '근거 부족', noExplanation: '설명 없음', digest: '주석 모음', textBox: '텍스트 상자', highlights: '형광펜 표시 {n}곳', conflict: '이 PC에서 저장하지 못한 내용', questionPicture: '질문 그림', pastedPicture: '붙여넣은 그림', picture: '그림' }, // i18n:keep — the Korean the app has always written (tests/memo-labels.test.cjs)
    en: { explain: 'explanation', figure: 'Figure explanation', page: 'page {page}', pageShort: 'p. {page}', summary: 'summary', selection: 'selection explanation', question: 'question', compare: 'comparison', comparedWith: 'compared with', contribution: 'contribution', translation: 'Translation', modelReading: 'model interpretation', noEvidence: 'insufficient evidence', noExplanation: 'no explanation', digest: 'Annotations', textBox: 'Text box', highlights: 'highlights: {n}', conflict: 'not saved on this PC', questionPicture: 'attached picture', pastedPicture: 'pasted picture', picture: 'Figure' },
    'zh-Hans': { explain: '解释', figure: '图表说明', page: '第{page}页', pageShort: '第{page}页', summary: '摘要', selection: '选段解释', question: '提问', compare: '比较', comparedWith: '对比对象', contribution: '贡献', translation: '译文', modelReading: '模型解读', noEvidence: '依据不足', noExplanation: '无解释', digest: '批注汇总', textBox: '文本框', highlights: '荧光笔标记 {n} 处', conflict: '此电脑未能保存的内容', questionPicture: '提问图片', pastedPicture: '粘贴的图片', picture: '图' },
    ja: { explain: '解説', figure: '図の説明', page: '{page}ページ', pageShort: '{page}ページ', summary: '要約', selection: '選択部分の解説', question: '質問', compare: '比較', comparedWith: '比較対象', contribution: '貢献', translation: '訳文', modelReading: 'モデルの解釈', noEvidence: '根拠不足', noExplanation: '解説なし', digest: '注釈のまとめ', textBox: 'テキストボックス', highlights: 'ハイライト {n} 箇所', conflict: 'このPCで保存できなかった内容', questionPicture: '質問の画像', pastedPicture: '貼り付けた画像', picture: '図' },
    fr: { explain: 'explication', figure: 'Explication de la figure', page: 'page {page}', pageShort: 'p. {page}', summary: 'résumé', selection: 'explication de la sélection', question: 'question', compare: 'comparaison', comparedWith: 'comparé à', contribution: 'contribution', translation: 'Traduction', modelReading: 'interprétation du modèle', noEvidence: 'preuves insuffisantes', noExplanation: 'sans explication', digest: 'Annotations', textBox: 'Zone de texte', highlights: 'surlignages : {n}', conflict: 'non enregistré sur ce PC', questionPicture: 'image de la question', pastedPicture: 'image collée', picture: 'Figure' },
    de: { explain: 'Erklärung', figure: 'Abbildungserklärung', page: 'Seite {page}', pageShort: 'S. {page}', summary: 'Zusammenfassung', selection: 'Erklärung der Auswahl', question: 'Frage', compare: 'Vergleich', comparedWith: 'verglichen mit', contribution: 'Beitrag', translation: 'Übersetzung', modelReading: 'Interpretation des Modells', noEvidence: 'unzureichende Belege', noExplanation: 'keine Erklärung', digest: 'Anmerkungen', textBox: 'Textfeld', highlights: 'Markierungen: {n}', conflict: 'auf diesem PC nicht gespeichert', questionPicture: 'Bild zur Frage', pastedPicture: 'eingefügtes Bild', picture: 'Abbildung' },
    es: { explain: 'explicación', figure: 'Explicación de figura', page: 'página {page}', pageShort: 'p. {page}', summary: 'resumen', selection: 'explicación de la selección', question: 'pregunta', compare: 'comparación', comparedWith: 'comparado con', contribution: 'contribución', translation: 'Traducción', modelReading: 'interpretación del modelo', noEvidence: 'evidencia insuficiente', noExplanation: 'sin explicación', digest: 'Anotaciones', textBox: 'Cuadro de texto', highlights: 'resaltados: {n}', conflict: 'no guardado en este PC', questionPicture: 'imagen de la pregunta', pastedPicture: 'imagen pegada', picture: 'Figura' },
    it: { explain: 'spiegazione', figure: 'Spiegazione della figura', page: 'pagina {page}', pageShort: 'p. {page}', summary: 'riassunto', selection: 'spiegazione della selezione', question: 'domanda', compare: 'confronto', comparedWith: 'confrontato con', contribution: 'contributo', translation: 'Traduzione', modelReading: 'interpretazione del modello', noEvidence: 'prove insufficienti', noExplanation: 'nessuna spiegazione', digest: 'Annotazioni', textBox: 'Casella di testo', highlights: 'evidenziazioni: {n}', conflict: 'non salvato su questo PC', questionPicture: 'immagine della domanda', pastedPicture: 'immagine incollata', picture: 'Figura' },
  });
  const MEMO_LANGUAGES = Object.freeze(Object.keys(WORDS));
  // A date written into a memo, in that language's way; English names the month (11/13/2026 reads two ways).
  const LOCALES = Object.freeze({ ko: 'ko-KR', en: 'en-US', 'zh-Hans': 'zh-CN', ja: 'ja-JP', fr: 'fr-FR', de: 'de-DE', es: 'es-ES', it: 'it-IT' });
  // A language read from a stored result is any string: only the eight are taken, else Korean ('__proto__' too).
  const known = language => typeof language === 'string' && Object.hasOwn(WORDS, language) ? language : 'ko';
  const memoDate = (date, language) => new Date(date).toLocaleDateString(LOCALES[known(language)], language === 'en' ? { month: 'short', day: 'numeric', year: 'numeric' } : undefined);
  const wordsOf = language => WORDS[known(language)];
  const fill = (text, values = {}) => text.replace(/\{(\w+)\}/g, (whole, name) => Object.hasOwn(values, name) ? String(values[name]) : whole);
  const escape = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // The whole of each thing the app writes. A head's own brackets are added by the writer.
  const BUILD = {
    explainHead: (w, v) => `AI ${w.explain} · ${v.file} · ${fill(w.page, v)} · ${v.model}`,
    explainTitle: (w, v) => `AI ${w.explain} · ${fill(w.pageShort, v)}`,
    figureHead: (w, v) => `${w.figure} · ${v.file} · ${fill(w.page, v)} · ${v.model}`,
    resultHead: (w, v) => `AI ${w[{ summary: 'summary', explain: 'selection', ask: 'question' }[v.kind]] || v.kind} · ${v.model} · ${v.date}`,
    compareHead: (w, v) => `AI ${w.compare} · ${v.model} · ${w.comparedWith}: ${v.others}`,
    contribution: w => ` ${w.contribution}`,
    translationLine: w => `${w.translation}: `,
    translationBold: w => `**${w.translation}** `,
    modelReading: w => `(${w.modelReading})`,
    noEvidence: w => `(${w.noEvidence})`,
    noEvidenceSuffix: w => ` — ${w.noEvidence}`,
    noExplanation: w => `(${w.noExplanation})`,
    annotationDigest: (w, v) => `— ${w.digest} (${v.date}) —`,
    textBox: w => `${w.textBox}: `,
    highlights: (w, v) => fill(w.highlights, v),
    conflictMark: w => `\n\n--- ${w.conflict} ---\n`,
    questionPicture: w => w.questionPicture,
    pastedPicture: w => w.pastedPicture,
    figurePicture: (w, v) => `${w.picture} · ${fill(w.pageShort, v)}`,
  };
  function memoLabel(name, language, values) {
    const build = BUILD[name];
    if (!build) throw Error(`unknown memo label: ${name}`);
    return build(wordsOf(language), values || {});
  }

  // Reading back, in any of the languages: the source heads a memo or note starts with. Every Korean form the
  // earlier rules took is still taken, with the same result (tests/memo-labels.test.cjs keeps those rules).
  // A word changed after memos were written with it: { language: { key: [old words] } }.
  const READ_TOO = Object.freeze({ es: Object.freeze({ contribution: Object.freeze(['aportación']) }) });
  const all = key => MEMO_LANGUAGES.flatMap(code => [[code, WORDS[code][key]], ...(READ_TOO[code]?.[key] || []).map(w => [code, w])]);
  const forms = key => [...new Set(all(key).map(([, w]) => w))];
  const SOURCE_LABELS = Object.freeze({ explain: all('explain').map(([, w]) => `AI ${w}`), figure: all('figure').map(([, w]) => w) });
  // A page segment, whole: "5페이지", "5 쪽", "page 5", "S. 5" … (never part of a file name such as "12페이지 요약.pdf").
  const pageForms = [...new Set([...forms('page'), ...forms('pageShort')])]
    .map(form => escape(form).replace('\\{page\\}', '(\\d{1,4})\\s*'));
  const PAGE_SEGMENT = new RegExp(`^(?:${pageForms.join('|')})$`);
  const pageOf = segment => { const m = PAGE_SEGMENT.exec(segment); return m ? Number(m.slice(1).find(Boolean)) : null; };
  // The first segment of a head's detail that is a page (as memoPage and the live editor read it before).
  const pageIn = detail => { for (const segment of String(detail ?? '').split(' · ')) { const page = pageOf(segment); if (page !== null) return page; } return null; };
  const SOURCE = new RegExp(`^\\[(${[...SOURCE_LABELS.explain, ...SOURCE_LABELS.figure].map(escape).join('|')}) · (.{1,300})\\]$`);
  // A source head (one line): [AI 설명 · file · 3페이지 · model] or the earlier [그림 설명 · …], in any language. The
  // file name may itself hold brackets (older memos kept them), so only the last ] closes it.
  // kind is 'explain' or 'figure'; page is the page the detail names, if any.
  function readMemoHead(line) {
    const m = SOURCE.exec(String(line ?? '').trim());
    if (!m) return null;
    const explain = all('explain').find(([, w]) => `AI ${w}` === m[1]), figure = all('figure').find(([, w]) => w === m[1]);
    const page = pageIn(m[2]);
    return { kind: explain ? 'explain' : 'figure', language: (explain || figure)[0], label: m[1], detail: m[2], ...(page ? { page } : {}) };
  }
  // A line that begins as a source head does ("[AI 설명 · …"), closed or not: the memo preview skips it.
  const HEAD_START = new RegExp(`^\\[(?:${[...SOURCE_LABELS.explain, ...SOURCE_LABELS.figure].map(escape).join('|')}) · `);
  const startsWithHead = line => HEAD_START.test(String(line ?? ''));
  // An older figure memo's first line, as the move into annotations reads it: [그림 설명 · … · N페이지 · model],
  // with no limit on its length and a model name that may hold " · ". Returns { page, model } or null.
  const FIGURE_MEMO = new RegExp(`^\\[(?:${SOURCE_LABELS.figure.map(escape).join('|')}) · (?:.*) · ((?:${pageForms.join('|')})) · ([^\\]]*)\\]\\s*$`);
  const readFigureMemoHead = line => { const m = FIGURE_MEMO.exec(String(line ?? '')); return m ? { page: Number(/\d{1,4}/.exec(m[1])[0]), model: m[m.length - 1] } : null; };
  // The head of an AI result added to a memo ([AI … · model · date], with " 기여" after it for a contribution).
  const AI_HEAD = new RegExp(`^\\[AI [^\\]\\n]*\\](?: (?:${all('contribution').map(([, w]) => escape(w)).join('|')}))?$`);
  const isAiHead = line => AI_HEAD.test(String(line ?? '').trim());
  // An annotation title the app made rather than the reader: "<kind> · <page>" in any language.
  const titleKinds = [...all('figure').map(([, w]) => w), ...all('explain').map(([, w]) => `AI ${w}`), ...all('selection').map(([, w]) => `AI ${w}`), '주석']; // i18n:keep — 주석 is the Korean kind the app wrote
  const titlePages = [...forms('pageShort').map(form => escape(form).replace('\\{page\\}', '\\d{1,4}')), '\\d+\\s*쪽']; // i18n:keep — the Korean page the app wrote
  const AUTO_TITLE = new RegExp(`^(?:${titleKinds.map(escape).join('|')}) · (?:${titlePages.join('|')})$`);
  const isAutoTitle = title => AUTO_TITLE.test(String(title ?? '').trim());
  // A figure memo for a file: it starts with a figure head naming one of the file's names ([그림 설명 · paper.pdf · …),
  // whatever follows the head. The figure pins on a page are found so (desktop/ink.js).
  const isFigureMemoFor = (text, names) => { const value = String(text ?? ''); return names.some(name => SOURCE_LABELS.figure.some(label => value.startsWith(`[${label} · ${name} · `))); };
  // What a closed memo shows: its first line of text (not a source head, a picture, a fence, a rule or a table),
  // without Markdown marks, and its first picture.
  function memoGlance(text) {
    const lines = String(text || '').split('\n').map(l => l.trim()).filter(Boolean), image = lines.map(l => l.match(/^!\[[^\]]*\]\(note-image:([0-9a-f]{32}\.png)\)$/)?.[1]).find(Boolean) || '';
    const line = lines.find(l => !/^!\[[^\]]*\]\(note-image:/.test(l) && !startsWithHead(l) && !/^(```|~~~|\$\$|---|\|)/.test(l)) || '';
    return { line: line.replace(/^#{1,6}\s+/, '').replace(/^>\s?/, '').replace(/^([-*+]|\d+[.)])\s+(\[[ xX]\]\s+)?/, ''), image };
  }
  return { MEMO_LANGUAGES, WORDS, READ_TOO, LOCALES, memoDate, memoLabel, readMemoHead, startsWithHead, readFigureMemoHead, SOURCE_LABELS, isAiHead, isAutoTitle, pageIn, isFigureMemoFor, memoGlance };
});
