// File errors in words. Node's own message names the call and the whole path ("ENOENT: no such file or
// directory, realpath '/…'"); the screen gets the reason and the code instead, and the error kept as its
// cause (and in the diagnostic record) still has both. Used by every request (main.cjs register) and by
// the transfer between vaults (transfer.cjs fileError).
const { tr } = require('../core/i18n.js');

const FILE_REASONS = {
  ENOSPC: () => tr('디스크 공간이 부족합니다.'), EDQUOT: () => tr('디스크 공간이 부족합니다.'), EACCES: () => tr('파일에 쓸 권한이 없습니다.'), EPERM: () => tr('파일에 쓸 권한이 없습니다.'),
  EBUSY: () => tr('다른 프로그램이 파일을 쓰고 있습니다.'), ENOENT: () => tr('파일이나 폴더를 찾을 수 없습니다.'), EEXIST: () => tr('같은 이름의 파일이나 폴더가 이미 있습니다.'),
  ENAMETOOLONG: () => tr('파일 이름이 너무 깁니다.'), ENOTDIR: () => tr('폴더가 있어야 할 자리에 파일이 있습니다.'), EROFS: () => tr('읽기 전용 디스크입니다.'), EIO: () => tr('디스크를 읽거나 쓰지 못했습니다.'),
};
const fileReason = error => FILE_REASONS[error?.code]?.() || tr('파일을 읽거나 쓰지 못했습니다.');
// An error Node made for a file call: an E… code and the call it came from.
const isRawFileError = error => Boolean(error && typeof error.code === 'string' && /^E[A-Z]+$/.test(error.code) && typeof error.syscall === 'string');
function plainFileError(error) {
  if (!isRawFileError(error)) return error;
  return Object.assign(Error(`${fileReason(error)} (${error.code})`), { code: error.code, cause: error });
}
module.exports = { fileReason, isRawFileError, plainFileError };
