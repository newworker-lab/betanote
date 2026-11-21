// The new-version notice (desktop/update-check.cjs): which release counts as newer, what is read from GitHub's answer,
// how often it is asked, and when a notice is due.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseVersion, isNewer, releaseFeed, latestRelease, due, noticeFor } = require('../desktop/update-check.cjs');

test('versions are three numbers, with or without a v; anything else is no version', () => {
  assert.deepEqual(parseVersion('v1.2.3'), [1, 2, 3]); assert.deepEqual(parseVersion('1.10.0'), [1, 10, 0]);
  for (const bad of ['', 'v1.2', '1.2.3-beta', 'latest', null, undefined, 'v1.2.3.4', ' v1.2.3']) assert.equal(parseVersion(bad), null, String(bad));
});
test('a release is newer by its numbers, not by its text', () => {
  assert.equal(isNewer('v1.10.0', '1.9.9'), true); assert.equal(isNewer('1.1.1', '1.1.0'), true); assert.equal(isNewer('2.0.0', '1.9.9'), true);
  assert.equal(isNewer('1.1.0', '1.1.0'), false); assert.equal(isNewer('1.0.9', '1.1.0'), false); assert.equal(isNewer('nonsense', '1.1.0'), false); assert.equal(isNewer('1.2.0', 'nonsense'), false);
});
test('the feed is the repository’s latest release on GitHub', () => {
  assert.equal(releaseFeed('https://github.com/some-owner/some-repo.git'), 'https://api.github.com/repos/some-owner/some-repo/releases/latest');
  assert.equal(releaseFeed('git+https://github.com/some-owner/some-repo'), 'https://api.github.com/repos/some-owner/some-repo/releases/latest');
  for (const bad of ['', null, 'https://example.com/a/b.git', 'https://github.com/only-owner']) assert.equal(releaseFeed(bad), null, String(bad));
});
test('the latest release is read from the answer; drafts, pre-releases, odd addresses and failures give none', async () => {
  const answer = (body, ok = true) => async () => ({ ok, json: async () => body });
  const page = 'https://github.com/some-owner/some-repo/releases/tag/v1.2.0';
  assert.deepEqual(await latestRelease({ fetch: answer({ tag_name: 'v1.2.0', html_url: page }), feed: 'x' }), { version: '1.2.0', url: page });
  assert.equal(await latestRelease({ fetch: answer({ tag_name: 'v1.2.0', html_url: page, draft: true }), feed: 'x' }), null);
  assert.equal(await latestRelease({ fetch: answer({ tag_name: 'v1.2.0', html_url: page, prerelease: true }), feed: 'x' }), null);
  assert.equal(await latestRelease({ fetch: answer({ tag_name: 'v1.2.0', html_url: 'https://example.com/get' }), feed: 'x' }), null, 'only a page on github.com is offered');
  assert.equal(await latestRelease({ fetch: answer({ tag_name: 'nightly', html_url: page }), feed: 'x' }), null);
  assert.equal(await latestRelease({ fetch: answer({ tag_name: 'v1.2.0', html_url: page }, false), feed: 'x' }), null, 'an answer that is not ok');
  assert.equal(await latestRelease({ fetch: async () => { throw Error('offline'); }, feed: 'x' }), null, 'no network');
  assert.equal(await latestRelease({ fetch: async () => ({ ok: true, json: async () => { throw SyntaxError('not json'); } }), feed: 'x' }), null);
  assert.equal(await latestRelease({ fetch: answer([1, 2]), feed: 'x' }), null); assert.equal(await latestRelease({ fetch: answer(null), feed: 'x' }), null);
  assert.equal(await latestRelease({ fetch: answer({ tag_name: 'v1.2.0', html_url: page }), feed: null }), null, 'no feed, no request');
  // A request that never answers is given up.
  const never = (_url, options) => new Promise((_resolve, reject) => { options.signal.addEventListener('abort', () => reject(Error('aborted'))); });
  assert.equal(await latestRelease({ fetch: never, feed: 'x', timeoutMs: 20 }), null);
});
test('it is asked once a day at most', () => {
  const day = 24 * 60 * 60 * 1000, now = 10 * day;
  assert.equal(due(undefined, now), true); assert.equal(due(0, now), true); assert.equal(due(now - day - 1, now), true);
  assert.equal(due(now - day + 1000, now), false); assert.equal(due(now + 5 * day, now), true, 'a time in the future (a clock set back) does not stop the check');
  assert.equal(due('yesterday', now), true);
});
test('a notice is due for a newer release that was not skipped', () => {
  const release = { version: '1.2.0', url: 'https://github.com/o/r/releases/tag/v1.2.0' };
  assert.deepEqual(noticeFor({ current: '1.1.0', release, skipped: undefined }), { ...release, current: '1.1.0' });
  assert.equal(noticeFor({ current: '1.2.0', release, skipped: undefined }), null); assert.equal(noticeFor({ current: '1.3.0', release }), null);
  assert.equal(noticeFor({ current: '1.1.0', release, skipped: '1.2.0' }), null, 'the version the person chose to skip');
  assert.deepEqual(noticeFor({ current: '1.1.0', release, skipped: '1.1.5' }), { ...release, current: '1.1.0' }, 'an older skip does not hide a newer release');
  assert.equal(noticeFor({ current: '1.1.0', release: null }), null);
});
