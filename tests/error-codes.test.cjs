const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const { PDFDocument } = require('pdf-lib');
const { Library } = require('../desktop/storage.cjs');
const { InkStore } = require('../desktop/ink.cjs');
const { TranslationJobs } = require('../desktop/translation.cjs');
const core = require('../core/translation-core.cjs');
const appName = require('../core/app-name.cjs');
const { checkReply, checkResult, restoreUnit, checkCachedMath, invalidKind } = core;

const pdf = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n%%EOF');
async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `${appName.id}-codes-`)); t.after(() => fs.rm(dir, { recursive: true, force: true }));
  await fs.mkdir(path.join(dir, 'vault')); return dir;
}
const english = 'We observed that the growth rate is high in every culture tested here.';

test('a reply error says its kind without its wording', () => {
  assert.throws(() => checkReply(english, english), e => e.code === 'APP_REPLY_INVALID' && invalidKind(e) === 'english');
  assert.throws(() => checkReply(english, ''), e => e.code === 'APP_REPLY_INVALID' && invalidKind(e) === 'missing');
  assert.throws(() => checkResult([{ id: 'a', text: english }], []), e => e.code === 'APP_REPLY_INVALID' && invalidKind(e) === 'missing');
});
test('a dropped formula marker is a math reply error', () => {
  const unit = { id: 'a', math: [{ token: 'PAPINOTE_MATH_X_0_END', text: '$x^2$' }] };
  assert.throws(() => restoreUnit(unit, '수식이 없습니다'), e => e.code === 'APP_REPLY_INVALID' && invalidKind(e) === 'math');
  assert.throws(() => checkCachedMath({ units: [{ id: 'a', math: [{ text: '$x$' }] }] }, [{ id: 'a', text: '수식 없음' }]), e => e.code === 'APP_REPLY_INVALID' && invalidKind(e) === 'math');
});
test('a malformed model reply is a reply error of kind format or missing', async () => {
  const { translateBlocks } = require('../desktop/llm.cjs');
  const blocks = [{ id: 'a', text: 'x' }, { id: 'b', text: 'y' }];
  const client = output => ({ label: 'T', respond: async () => output });
  await assert.rejects(translateBlocks(client('not json'), 'm', blocks), e => e.code === 'APP_REPLY_INVALID' && invalidKind(e) === 'format');
  await assert.rejects(translateBlocks(client('{"blocks":[{"id":"a","text":"가"}]}'), 'm', blocks), e => e.code === 'APP_REPLY_INVALID' && invalidKind(e) === 'missing' && e.replies.length === 1);
});
test('invalidKind falls back to format for an error without a kind', () => {
  assert.equal(invalidKind(Error('수식')), 'format');
  assert.equal(invalidKind(Object.assign(Error('x'), { kind: 'math' })), 'math');
});

test('a file name already taken is told by code', async t => {
  const dir = await fixture(t), source = path.join(dir, 'paper.pdf'); await fs.writeFile(source, pdf);
  const library = await Library.open(path.join(dir, 'vault'));
  const [first, second] = await library.importFiles([source, source]);
  assert.equal(first.ok, true); assert.equal(first.code, undefined);
  assert.equal(second.ok, false); assert.equal(second.code, 'APP_NAME_TAKEN');
});
test('an attachment path already registered is told by code', async t => {
  const dir = await fixture(t), a = path.join(dir, 'a.pdf'), b = path.join(dir, 'b.pdf');
  await fs.writeFile(a, pdf); await fs.writeFile(b, Buffer.concat([pdf, Buffer.from('\n% b')]));
  const library = await Library.open(path.join(dir, 'vault'));
  const [ra, rb] = await library.importFiles([a, b]);
  await assert.rejects(library.moveAttachment(rb.paperId, rb.attachmentId, 'papers', 'a.pdf'), e => e.code === 'APP_PATH_REGISTERED');
  assert.ok(ra.ok);
});
test('a vault that cannot be read is told by code', async t => {
  const dir = await fixture(t), root = path.join(dir, 'vault');
  await (await Library.open(root)).save();
  const file = path.join(root, appName.vaultDir, 'library.json');
  await fs.writeFile(file, '{');
  // The message names the file the vault keeps (never the folders above it), not the parser's words.
  await assert.rejects(Library.open(root), e => e.code === 'APP_VAULT_DAMAGED' && e.name === 'Error' && e.message.endsWith(`: .${appName.id}/library.json`) && !e.message.includes(dir) && !e.message.startsWith('⟦') && e.conflict === false);
  await fs.writeFile(file, JSON.stringify({ version: 2, id: 'x', papers: 1, notes: {} }));
  await assert.rejects(Library.open(root), e => e.code === 'APP_VAULT_DAMAGED');
  await fs.writeFile(file, JSON.stringify({ version: 9, id: 'x', papers: [], notes: {} }));
  await assert.rejects(Library.open(root), e => e.code === 'APP_NEWER_VAULT');
});

test('ink refusals carry a code', async t => {
  const dir = await fixture(t), source = path.join(dir, 'paper.pdf'), doc = await PDFDocument.create(); doc.addPage([600, 800]);
  await fs.writeFile(source, Buffer.from(await doc.save()));
  const library = await Library.open(path.join(dir, 'vault')), [r] = await library.importFiles([source]);
  const ink = new InkStore(library), geometry = { view: [0, 0, 600, 800], rotate: 0, userUnit: 1 };
  const stroke = { id: 'stroke-0001', page: 0, tool: 'pen', color: '#1d4ed8', width: 1.5, points: [100, 700, 0.5, 0, 140, 690, 0.8, 16], device: 'pen' };
  await assert.rejects(ink.apply(r.paperId, r.attachmentId, 'original', []), e => e.code === 'APP_INK_REJECTED');
  // An unknown surface is not dropped by the page (it is retried), so it carries no code.
  await assert.rejects(ink.apply(r.paperId, r.attachmentId, 'bad', [{ type: 'add', stroke, geometry }]), e => e.code === undefined);
  await assert.rejects(ink.apply(r.paperId, r.attachmentId, 't-' + 'a'.repeat(24), [{ type: 'add', stroke, geometry }], async () => null), e => e.code === 'APP_INK_STALE');
  await ink.apply(r.paperId, r.attachmentId, 'original', [{ type: 'add', stroke, geometry }]);
  const changed = await PDFDocument.create(); changed.addPage([300, 300]);
  await fs.writeFile(await library.resolveFile(r.paperId, 'attachment-' + r.attachmentId), Buffer.from(await changed.save()));
  await assert.rejects(new InkStore(library).apply(r.paperId, r.attachmentId, 'original', [{ type: 'delete', ids: ['stroke-0001'] }]), e => e.code === 'APP_INK_STALE');
});

test('a usage limit is waited out by status, not by Korean wording', async t => {
  const dir = await fixture(t), source = path.join(dir, 'paper.pdf'); await fs.writeFile(source, pdf);
  const library = await Library.open(path.join(dir, 'vault')), [r] = await library.importFiles([source]);
  const { source: sourceOf } = require('../desktop/translation.cjs'), hash = (await sourceOf(library, r.paperId)).hash;
  const pages = [{ width: 600, height: 800, blocks: [{ id: 'p1-b1', text: 'Research', x: 20, y: 20, width: 200, height: 40, fontSize: 12 }] }];
  const run = async error => {
    let calls = 0;
    const jobs = new TranslationJobs({ status: () => ({ usable: true }), models: async () => [{ id: 'model' }], translate: async (_m, blocks) => { if (++calls === 1) throw error; return blocks.map(b => ({ id: b.id, text: '연구' })); } });
    const job = await jobs.start(library, r.paperId, hash, pages, 'model');
    for (let i = 0; i < 200 && jobs.jobs.get(job.id).state === 'running'; i++) await new Promise(res => setTimeout(res, 10));
    return { state: jobs.jobs.get(job.id).state, calls };
  };
  assert.deepEqual(await run(Object.assign(Error('요청 한도'), { status: 429, retryAfterMs: 1 })), { state: 'completed', calls: 2 });
  assert.deepEqual(await run(Object.assign(Error('rate_limit'), { retryAfterMs: 1 })), { state: 'completed', calls: 2 });
  assert.deepEqual(await run(Error('사용 한도에 도달했습니다')), { state: 'failed', calls: 1 });
});

test('the renderer reads a code from a forwarded message', () => {
  const source = require('node:fs').readFileSync(path.join(__dirname, '..', 'desktop', 'renderer.js'), 'utf8');
  const lines = source.split('\n').filter(l => /^const (plainError|errorCode)=/.test(l));
  assert.equal(lines.length, 2);
  const sandbox = {}; vm.createContext(sandbox); vm.runInContext(lines.join('\n') + ';this.errorCode=errorCode;this.plainError=plainError;', sandbox);
  const wrapped = Error("Error invoking remote method 'ink-apply': Error: ⟦APP_INK_STALE⟧원문 파일이 바뀌어 이전 필기를 수정할 수 없습니다.");
  assert.equal(sandbox.errorCode(wrapped), 'APP_INK_STALE');
  assert.equal(sandbox.plainError(wrapped), '원문 파일이 바뀌어 이전 필기를 수정할 수 없습니다.');
  assert.equal(sandbox.errorCode(Error('그냥 오류')), '');
  assert.equal(sandbox.errorCode(null), '');
  assert.equal(sandbox.plainError(Error('그냥 오류')), '그냥 오류');
  // An error of another name forwarded with its code (a SyntaxError from an older main, a TypeError): the message alone.
  for (const name of ['SyntaxError', 'TypeError', 'RangeError']) {
    const forwarded = Error(`Error invoking remote method 'notebook-get': ${name}: ⟦APP_FILE_UNREADABLE⟧파일을 읽을 수 없습니다: .${appName.id}/notebooks/n.json`);
    assert.equal(sandbox.errorCode(forwarded), 'APP_FILE_UNREADABLE'); assert.equal(sandbox.plainError(forwarded), `파일을 읽을 수 없습니다: .${appName.id}/notebooks/n.json`, name);
  }
  assert.equal(sandbox.plainError(Error("Error invoking remote method 'x': SyntaxError: Unexpected token")), 'Unexpected token');
});

function rendererPieces() {
  const source = require('node:fs').readFileSync(path.join(__dirname, '..', 'desktop', 'renderer.js'), 'utf8');
  const sandbox = {}; vm.createContext(sandbox);
  vm.runInContext(source.split('\n').filter(l => /^const (plainError|errorCode|shownError)=/.test(l)).join('\n') + ';this.shownError=shownError;', sandbox);
  return sandbox;
}
test('what a screen shows of an error is its message minus only the marker', () => {
  const { shownError } = rendererPieces();
  const plain = '원문 파일이 바뀌어 이전 필기를 수정할 수 없습니다.', prefix = "Error invoking remote method 'ink-apply': Error: ";
  assert.equal(shownError(Error(prefix + '⟦APP_INK_STALE⟧' + plain)), prefix + plain);
  assert.equal(shownError(Error('⟦APP_VAULT_DAMAGED⟧' + plain)), plain);
  for (const m of [plain, prefix + plain, '', 'a ⟦ b']) assert.equal(shownError(Error(m)), m);
  assert.equal(shownError({}), 'undefined');
});
test('the ink layer drops a refused batch for the same errors as before', async () => {
  const source = require('node:fs').readFileSync(path.join(__dirname, '..', 'desktop', 'ink.js'), 'utf8');
  const start = source.indexOf('function inkFlush(doc){'), end = source.indexOf('async function inkFlushAll');
  assert.ok(start > 0 && end > start);
  const rend = rendererPieces();
  const run = async message => {
    const toasts = []; let calls = 0;
    const sandbox = { window: { appApi: { inkApply: () => (++calls === 1 ? Promise.reject(Error(message)) : Promise.resolve()) } }, toast: m => toasts.push(m), inkStatus() {}, inkState: { pending: new Set() }, setTimeout: () => 0, clearTimeout() {}, errorCode: rend.errorCode, plainError: rend.plainError, shownError: rend.shownError, tr: require('../core/i18n.js').tr, Promise };
    vm.createContext(sandbox);
    vm.runInContext(require('node:fs').readFileSync(path.join(__dirname, '..', 'desktop', 'renderer.js'), 'utf8').split('\n').filter(l => /^const (plainError|errorCode|shownError)=/.test(l)).join('\n'), sandbox);
    vm.runInContext(source.slice(start, end), sandbox);
    const doc = { pending: [1], saving: null, stale: false, failed: null, libraryId: 1, paperId: 1, attachmentId: 1, surface: 'original' };
    sandbox.doc = doc;
    const outcome = await vm.runInContext('inkFlush(doc).then(()=>"dropped",()=>"kept")', sandbox);
    return { outcome, stale: doc.stale, toasts };
  };
  const prefix = "Error invoking remote method 'ink-apply': Error: ";
  const dropped = await run(prefix + '⟦APP_VAULT_CHANGED⟧저장소가 변경되었습니다. 다시 시도하세요.');
  assert.deepEqual(dropped, { outcome: 'dropped', stale: false, toasts: ['필기 일부를 저장하지 못했습니다: 저장소가 변경되었습니다. 다시 시도하세요.'] });
  assert.equal((await run(prefix + '⟦APP_INK_STALE⟧원문 파일이 바뀌어 이전 필기를 수정할 수 없습니다.')).stale, true);
  assert.equal((await run(prefix + '⟦APP_INK_REJECTED⟧필기가 너무 많습니다.')).stale, false);
  const kept = await run(prefix + '필기 대상을 확인하세요.');
  assert.equal(kept.outcome, 'kept'); assert.deepEqual(kept.toasts, ['필기 저장 실패: ' + prefix + '필기 대상을 확인하세요.']);
});

// The codes the language work added or now relies on: each is told by its code, and the wording follows the
// screen (English here) without changing the code.
const i18n = require('../core/i18n.js'); require('../core/i18n-en.js');
const inEnglish = async fn => { i18n.setUiLanguage('en'); try { return await fn(); } finally { i18n.setUiLanguage('ko'); } };

test('a language the list does not offer is APP_BAD_LANGUAGE, in either screen language', async () => {
  const { patchLanguage } = require('../desktop/language.cjs');
  for (const words of [() => patchLanguage({}, { ui: 'fr' }), () => inEnglish(() => patchLanguage({}, { ui: 'fr' }))]) {
    await assert.rejects(async () => words(), error => error.code === 'APP_BAD_LANGUAGE');
  }
  await assert.rejects(async () => inEnglish(() => patchLanguage({}, { translation: 'xx' })), { code: 'APP_BAD_LANGUAGE', message: 'That language is not supported.' });
});

test('a vault locked on another computer is APP_LOCKED_ELSEWHERE with its host, in either screen language', async t => {
  const { lockVault } = require('../desktop/vault-lock.cjs');
  const root = path.join(await fixture(t), 'vault'); await fs.mkdir(path.join(root, appName.vaultDir), { recursive: true });
  await fs.writeFile(path.join(root, appName.vaultDir, 'writer.lock'), JSON.stringify({ pid: 4242, host: 'other-desk', boot: 1, token: 'x' }));
  await assert.rejects(lockVault(root), error => error.code === 'APP_LOCKED_ELSEWHERE' && error.host === 'other-desk' && /other-desk/.test(error.message));
  await assert.rejects(inEnglish(() => lockVault(root)), { code: 'APP_LOCKED_ELSEWHERE', message: 'This vault is in use on another computer (other-desk). Quit the app there first.' });
});

test('a display language change refused while a model is busy carries APP_BUSY', () => {
  // main.cjs cannot run under node --test; its refusal is read from the source (tests/language-smoke.cjs checks it running).
  const main = require('node:fs').readFileSync(path.join(__dirname, '..', 'desktop', 'main.cjs'), 'utf8');
  assert.match(main, /if \(uiChanged && modelBusy\(\)\) throw Object\.assign\(Error\(tr\('[^']+'\)\), \{ code: 'APP_BUSY' \}\)/);
});

test('a dropped file that is not on the computer is APP_DROP_NOT_FILE, named by the screen', async () => {
  const preload = require('node:fs').readFileSync(path.join(__dirname, '..', 'desktop', 'preload.cjs'), 'utf8');
  assert.equal((preload.match(/Promise\.reject\(Error\('⟦APP_DROP_NOT_FILE⟧/g) || []).length, 2);
  const source = require('node:fs').readFileSync(path.join(__dirname, '..', 'desktop', 'renderer.js'), 'utf8');
  const sandbox = { tr: i18n.tr }; vm.createContext(sandbox);
  vm.runInContext(source.split('\n').filter(l => /^const (plainError|errorCode|shownError)=/.test(l)).join('\n') + ';this.shownError=shownError;this.plainError=plainError;this.errorCode=errorCode;', sandbox);
  const dropped = Error('⟦APP_DROP_NOT_FILE⟧컴퓨터에 저장된 PDF 파일을 드래그해 주세요.');
  assert.equal(sandbox.errorCode(dropped), 'APP_DROP_NOT_FILE');
  assert.equal(sandbox.shownError(dropped), '컴퓨터에 저장된 PDF 파일을 드래그해 주세요.');
  assert.equal(await inEnglish(() => sandbox.plainError(dropped)), 'Drag a PDF file saved on your computer.');
  assert.equal(await inEnglish(() => sandbox.shownError(dropped)), 'Drag a PDF file saved on your computer.');
});
