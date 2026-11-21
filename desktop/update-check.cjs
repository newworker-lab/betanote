// Whether a newer release is out (docs/DEVELOPMENT.md, 새 버전 알림). The app asks GitHub for the repository's latest
// release, once a day at most, and tells the person when its version is newer than the one running; it installs
// nothing. Only that one public address is asked: nothing about the person, the vault or the papers is sent.
// Everything here is free of Electron: main.cjs gives it the fetch and the settings.
const DAY = 24 * 60 * 60 * 1000;
// "v1.2.3" or "1.2.3"; a pre-release or anything else is no version to compare.
function parseVersion(text) {
  const match = typeof text === 'string' && /^v?(\d+)\.(\d+)\.(\d+)$/.exec(text);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}
function isNewer(latest, current) {
  const a = parseVersion(latest), b = parseVersion(current); if (!a || !b) return false;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}
// The address of the latest release of the repository package.json names (GitHub only).
function releaseFeed(repositoryUrl) {
  const match = typeof repositoryUrl === 'string' && /github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?$/.exec(repositoryUrl);
  return match ? `https://api.github.com/repos/${match[1]}/${match[2]}/releases/latest` : null;
}
// The latest release as {version, url}, or null: a draft, a pre-release, an answer that cannot be read, a page that is
// not on github.com, no network. It never throws, and gives up a request that does not answer.
async function latestRelease({ fetch, feed, timeoutMs = 8000 }) {
  if (!feed) return null;
  const stop = new AbortController(), timer = setTimeout(() => stop.abort(), timeoutMs);
  try {
    const response = await fetch(feed, { signal: stop.signal, headers: { Accept: 'application/vnd.github+json' }, redirect: 'error' });
    if (!response?.ok) return null;
    const body = await response.json();
    if (!body || typeof body !== 'object' || Array.isArray(body) || body.draft === true || body.prerelease === true) return null;
    const version = parseVersion(body.tag_name), url = typeof body.html_url === 'string' ? body.html_url : '';
    if (!version || !/^https:\/\/github\.com\/[^\s]+$/.test(url) || url.length > 300) return null;
    return { version: version.join('.'), url };
  } catch { return null; /* no network, a refusal, an answer that is not JSON: asked again another day */ }
  finally { clearTimeout(timer); }
}
// Asked once a day at most. A time that is no number, or lies in the future (a clock set back), does not hold it off.
function due(lastAt, now, every = DAY) { return !(Number.isFinite(lastAt) && lastAt > 0 && lastAt <= now && now - lastAt < every); }
// What the person is told: a release newer than the app running, unless it is the one they chose to skip.
function noticeFor({ current, release, skipped }) {
  if (!release || !isNewer(release.version, current) || release.version === skipped) return null;
  return { version: release.version, url: release.url, current };
}
module.exports = { parseVersion, isNewer, releaseFeed, latestRelease, due, noticeFor };
