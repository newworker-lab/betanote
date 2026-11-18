'use strict';
// File errors in words (desktop/file-error.cjs): what reaches the screen names the reason and code, never the
// folders in Node's message; errors that are not raw file errors pass unchanged.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os');
const { fileReason, isRawFileError, plainFileError } = require('../desktop/file-error.cjs');

test('a raw file error becomes its reason and code, without the path', async () => {
  const where = path.join(os.tmpdir(), 'no-such-folder-' + process.pid, 'V');
  const raw = await fs.realpath(where).catch(e => e);
  assert.ok(isRawFileError(raw));
  const plain = plainFileError(raw);
  assert.equal(plain.code, 'ENOENT'); assert.equal(plain.cause, raw);
  assert.equal(plain.message, '파일이나 폴더를 찾을 수 없습니다. (ENOENT)');
  assert.ok(!plain.message.includes(where) && !/realpath|no such file/.test(plain.message));
  assert.equal(fileReason({ code: 'EACCES' }), '파일에 쓸 권한이 없습니다.');
  assert.equal(fileReason({ code: 'EWHATEVER' }), '파일을 읽거나 쓰지 못했습니다.');
});
test('other errors are left as they are', () => {
  const app = Object.assign(Error('잠김'), { code: 'APP_LOCKED' }), plain = Error('x');
  assert.equal(isRawFileError(app), false); assert.equal(plainFileError(app), app);
  assert.equal(isRawFileError(plain), false); assert.equal(plainFileError(plain), plain);
  assert.equal(isRawFileError(Object.assign(Error('EBUSY'), { code: 'EBUSY' })), false, 'only errors Node made for a file call (with a syscall)');
});
