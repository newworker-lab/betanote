'use strict';
// User themes and CSS snippets (docs/DEVELOPMENT.md, 사용자 테마). A theme is a folder with manifest.json and
// a CSS file; a snippet is one .css file. Only CSS is read: no scripts, @import or
// outside resources (url() keeps data: only; the page's CSP also blocks requests).
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const { tr } = require('../core/i18n.js');

const MAX_CSS = 1024 * 1024, ID = /^[a-z0-9][a-z0-9_-]{0,63}$/, SNIPPET = /^[^/\\<>:"|?*\x00-\x1f]{1,80}\.css$/i;
// Written once, in the display language of that moment (like backup names).
const exampleTheme = () => ({
  manifest: { id: 'example-warm', name: tr('따뜻한 종이 (예시)'), version: '1.0.0', author: require('../core/app-name.cjs').name, themeApiVersion: 1, modes: ['light', 'dark'], css: 'theme.css' },
  css: `/* ${tr('예시 테마: 이 파일을 고치고 저장하면 바로 반영됩니다. 공개 변수는 개발 문서의 사용자 테마 절을 보세요.')} */
[data-kn-ui][data-kn-mode="light"] {
  --kn-background: #f6f1e7;
  --kn-surface: #fffdf8;
  --kn-surface-secondary: #f9f4ea;
  --kn-text: #2b2620;
  --kn-text-muted: #7a6f60;
  --kn-border: #e6dccb;
  --kn-accent: #b4552d;
  --kn-accent-hover: #9a4423;
  --kn-selection: #f6e3d6;
  --kn-hover: #f1e9db;
  --kn-reader-background: #e9e1d2;
}
[data-kn-ui][data-kn-mode="dark"] {
  --kn-background: #1c1916;
  --kn-surface: #24201c;
  --kn-surface-secondary: #2a2520;
  --kn-text: #f1e9dd;
  --kn-text-muted: #bfb2a0;
  --kn-border: #3a332c;
  --kn-accent: #e39a72;
  --kn-selection: #4a3326;
  --kn-hover: #302a24;
  --kn-reader-background: #151311;
}
`,
});
const exampleSnippet = () => `/* ${tr('예시 스니펫: 설정 → 모양에서 켜면 메모 글꼴을 바꿉니다.')} */
[data-kn-ui] {
  --kn-font-notes: "Noto Serif KR", Georgia, serif;
}
`;
// Keeps the CSS rules; drops @import and every url() that is not a data: URI.
function sanitizeCss(css) {
  return String(css)
    .replace(/@import\b[^;]*;?/gi, '/* @import 제거 */') // i18n:keep — a CSS comment inside the served CSS, never shown
    .replace(/url\(\s*(['"]?)(.*?)\1\s*\)/gi, (m, q, value) => /^data:/i.test(value.trim()) ? m : 'none');
}
function checkManifest(manifest, folder) {
  if (!manifest || typeof manifest !== 'object') return tr('manifest.json을 읽을 수 없습니다.');
  if (manifest.id !== folder || !ID.test(folder)) return tr('id가 폴더 이름({folder})과 같아야 합니다(영문 소문자·숫자·-·_).', { folder });
  if (typeof manifest.name !== 'string' || !manifest.name.trim() || manifest.name.length > 80) return tr('이름(name)을 1–80자로 적으세요.');
  if (manifest.themeApiVersion !== 1) return tr('themeApiVersion은 1이어야 합니다.');
  if (!Array.isArray(manifest.modes) || !manifest.modes.length || !manifest.modes.every(m => m === 'light' || m === 'dark')) return tr('modes는 "light"·"dark" 중에서 적으세요.');
  const css = manifest.css ?? 'theme.css';
  if (typeof css !== 'string' || !/^[\w.-]{1,80}\.css$/i.test(css)) return tr('css는 테마 폴더 안의 .css 파일 이름이어야 합니다.');
  return '';
}
async function readCss(file) {
  const info = await fs.lstat(file);
  if (!info.isFile()) throw Error(tr('CSS 파일이 아닙니다.'));
  if (info.size > MAX_CSS) throw Error(tr('CSS 파일은 1MB 이하여야 합니다.'));
  return sanitizeCss(await fs.readFile(file, 'utf8'));
}
class ThemeStore {
  constructor(root) { this.root = root; this.themes = path.join(root, 'themes'); this.snippets = path.join(root, 'snippets'); }
  // The folders, with an example theme and snippet the first time.
  async ensure() {
    await fs.mkdir(this.themes, { recursive: true }); await fs.mkdir(this.snippets, { recursive: true });
    if (!(await fs.readdir(this.themes)).length) {
      const example = exampleTheme(), dir = path.join(this.themes, example.manifest.id); await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, 'manifest.json'), JSON.stringify(example.manifest, null, 2) + '\n'); await fs.writeFile(path.join(dir, 'theme.css'), example.css);
    }
    if (!(await fs.readdir(this.snippets)).length) await fs.writeFile(path.join(this.snippets, 'note-serif.css'), exampleSnippet());
  }
  async list() {
    const themes = [], snippets = [];
    for (const entry of await fs.readdir(this.themes, { withFileTypes: true }).catch(() => [])) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      let manifest = null, error = '';
      try { manifest = JSON.parse(await fs.readFile(path.join(this.themes, entry.name, 'manifest.json'), 'utf8')); } catch { error = tr('manifest.json을 읽을 수 없습니다.'); }
      error ||= checkManifest(manifest, entry.name);
      if (!error) try { await readCss(path.join(this.themes, entry.name, manifest.css ?? 'theme.css')); } catch (e) { error = e.code === 'ENOENT' ? tr('CSS 파일이 없습니다.') : e.message; }
      themes.push({ id: entry.name, name: manifest?.name && typeof manifest.name === 'string' ? manifest.name.slice(0, 80) : entry.name, version: typeof manifest?.version === 'string' ? manifest.version.slice(0, 20) : '', modes: Array.isArray(manifest?.modes) ? manifest.modes.filter(m => m === 'light' || m === 'dark') : [], error });
    }
    for (const entry of await fs.readdir(this.snippets, { withFileTypes: true }).catch(() => [])) {
      if (!entry.isFile() || !SNIPPET.test(entry.name) || entry.name.startsWith('.')) continue;
      let error = ''; try { await readCss(path.join(this.snippets, entry.name)); } catch (e) { error = e.message; }
      snippets.push({ name: entry.name, error });
    }
    const order = (a, b) => (a.name || a.id).localeCompare(b.name || b.id, 'ko');
    return { root: this.root, themes: themes.sort(order), snippets: snippets.sort(order) };
  }
  async themeCss(id) {
    if (typeof id !== 'string' || !ID.test(id)) throw Error(tr('테마를 확인하세요.'));
    const dir = path.join(this.themes, id); if (!(await fs.lstat(dir)).isDirectory()) throw Error(tr('테마 폴더를 확인하세요.'));
    const manifest = JSON.parse(await fs.readFile(path.join(dir, 'manifest.json'), 'utf8')), error = checkManifest(manifest, id);
    if (error) throw Error(error);
    return { css: await readCss(path.join(dir, manifest.css ?? 'theme.css')), modes: manifest.modes };
  }
  async snippetCss(name) {
    if (typeof name !== 'string' || !SNIPPET.test(name) || name.startsWith('.')) throw Error(tr('스니펫을 확인하세요.'));
    return readCss(path.join(this.snippets, name));
  }
  // Saving a file fires several events; they are gathered into one call.
  watch(onChange, onProblem) {
    let timer = null; const fire = () => { clearTimeout(timer); timer = setTimeout(onChange, 300); };
    const watchers = [];
    for (const dir of [this.themes, this.snippets]) try { watchers.push(fsSync.watch(dir, { recursive: true }, fire)); } catch { try { watchers.push(fsSync.watch(dir, fire)); } catch (error) { onProblem?.('theme-watch', error); } }
    return () => { clearTimeout(timer); watchers.forEach(w => w.close()); };
  }
}
module.exports = { ThemeStore, sanitizeCss, checkManifest, MAX_CSS };
