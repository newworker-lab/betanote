const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DiagnosticLog, scrub, MAX_FILE, KEPT_FILES } = require('../desktop/diagnostics.cjs');
const appName = require('../core/app-name.cjs');

test('the diagnostic record leaves out paths, keys, tokens, addresses and long quoted text', () => {
  const home = process.platform === 'win32' ? 'C:\\Users\\Hong Gildong' : '/home/hong', vault = path.join(home, 'Research', 'Papers');
  const line = scrub(`ENOENT: no such file, open '${path.join(vault, appName.vaultDir, 'library.json')}' while reading ${path.join(home, 'Downloads', 'secret paper.pdf')}`, { home, places: [[vault, '<vault>']] });
  assert.ok(!/hong|Hong|Gildong|Research|Downloads|secret paper/.test(line), line); assert.match(line, /<vault>\/….json/); assert.match(line, /<home>\/….pdf/);
  assert.equal(scrub('401 with key sk-proj-abcdefghijklmnop1234 and Bearer abc.def-ghi_jkl123456'), '401 with key <key> and Bearer <token>');
  assert.equal(scrub('token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U seen'), 'token <token> seen');
  assert.equal(scrub('account hong.gildong@example.com refused'), 'account <email> refused');
  // Keys and tokens as providers and libraries print them: none of the secret's characters is left.
  for (const [text, secret] of [['Incorrect API key provided: sk-proj-AbCdEfGhIjKlMnOpQrStUvWx1234. You can find', 'AbCdEf'], ['invalid x-api-key sk-ant-api03-AbCdEfGhIjKlMnOp_QrStUvWx-12345678', 'AbCdEf'], ['API key not valid: AIzaSyA1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q', 'SyA1b2'],
    ['fetch failed https://generativelanguage.googleapis.com/v1beta/models?key=AIzaSyA1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q', 'SyA1b2'], ['Authorization: Bearer abcDEF123456789.xyz', 'abcDEF'], ['refresh_token=v1.MjAyNi0xMS0xMg-abcdef123456 expired', 'MjAyNi'],
    ['token: gho_16C7e42F292c6912E7710c838347Ae178B4a', '16C7e4'], ['api_key="1234567890abcdef1234567890abcdef"', '123456'], ['password=hunter2secret', 'hunter'], ['key sk-abc123 short', 'abc123'], ['"access_token":"ya29.a0AfH6SMBx-abc_DEF123456789"', 'a0AfH6'],
    ['hex 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08 seen', '9f86d0']]) assert.ok(!scrub(text).includes(secret), `${text} -> ${scrub(text)}`);
  // A key the app holds is taken out exactly, even one that looks like nothing.
  assert.equal(scrub('provider said: bad credential my-odd.key!42 for user', { secrets: ['my-odd.key!42'] }), 'provider said: bad credential <secret> for user');
  // What is no secret stays readable.
  assert.equal(scrub('TypeError: Cannot read properties of undefined (reading \'pages\')'), 'TypeError: Cannot read properties of undefined (reading \'pages\')');
  assert.equal(scrub('request translation-cached 원문이 변경됐습니다. 다시 번역하세요.'), 'request translation-cached 원문이 변경됐습니다. 다시 번역하세요.');
  assert.match(scrub('at TranslationJobs.pageReady (desktop/translation.cjs:254:11)'), /TranslationJobs\.pageReady \(desktop\/translation\.cjs:254:11\)/);
  assert.ok(!/attention layer/.test(scrub('reply was "The attention layer discussed so far takes a set of N vectors each of length D and maps them into another set."')));
  assert.match(scrub(`at Object.open (/opt/${appName.id}/resources/app.asar/desktop/storage.cjs:54:11)`), /storage\.cjs:54:11/);
  assert.ok(!/someone/.test(scrub('failed at /Users/someone/Library/Application Support/thing.json')));
  assert.ok(!/someone/.test(scrub('failed at D:\\Work\\someone\\notes\\thing.json now')));
});

test('the diagnostic record is written, bounded in size, and counts an error that repeats', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), `${appName.id}-log-`));
  try {
    let tick = 0; const log = new DiagnosticLog({ directory, version: '0.3.0', maxFile: 4000, now: () => new Date(Date.UTC(2026, 10, 12, 0, 0, tick++)) });
    const error = new TypeError('Cannot read properties of undefined'); log.write('uncaught', error); log.write('request', Error('원문 파일이 없습니다.'), 'read-original');
    const text = fs.readFileSync(path.join(directory, 'app.log'), 'utf8').trim().split('\n');
    assert.equal(text.length, 2); assert.match(text[0], /^2026-11-12T00:00:00\.000Z uncaught TypeError: Cannot read properties of undefined @ /); assert.match(text[1], /request read-original 원문 파일이 없습니다\. @ at /);
    // The same error over and over: five lines, then a count.
    for (let i = 0; i < 200; i++) log.write('page', Error('loop failed'), 'error');
    const loop = fs.readFileSync(path.join(directory, 'app.log'), 'utf8').split('\n').filter(l => /loop failed/.test(l));
    assert.equal(loop.length, 6); assert.match(loop[4], /이후 같은 오류는 세기만 함/); assert.match(loop[5], /같은 오류 100번/);
    // Many different errors: the files turn over and the whole stays within the limit.
    for (let i = 0; i < 400; i++) log.write('request', Error(`failure number ${i} with some words to fill the line up`), 'some-request');
    const files = fs.readdirSync(directory).sort(); assert.deepEqual(files, ['app.1.log', 'app.2.log', 'app.log']);
    assert.ok(files.every(f => fs.statSync(path.join(directory, f)).size <= 4000 + 200));
    const recent = log.recent(10); assert.equal(recent.length, 10); assert.match(recent.at(-1), /failure number 399/); assert.match(recent[0], /failure number 390/);
    const report = log.report({ Electron: '45' }); assert.match(report, new RegExp('^' + RegExp.escape(appName.name) + ' 0\\.3\\.0\\nElectron: 45\\n')); assert.match(report, /최근 오류 \d+개/); assert.match(report, /failure number 399/);
    assert.equal(MAX_FILE * KEPT_FILES, 1536 * 1024, 'at most 1.5 MB on disk');
    assert.match(new DiagnosticLog({ directory: path.join(directory, 'empty'), version: '1' }).report(), /기록된 오류가 없습니다/);
    // A record that cannot be written never throws.
    const blocked = new DiagnosticLog({ directory: path.join(directory, 'app.log', 'under-a-file') }); assert.doesNotThrow(() => blocked.write('uncaught', Error('x')));
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
