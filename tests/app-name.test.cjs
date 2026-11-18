// The app's name lives in one file (core/app-name.json); everything named after it is made from it.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');

test('package.json and package-lock.json name the app as the name file does', () => {
  const appName = require('../core/app-name.cjs'), pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.equal(pkg.name, appName.id); assert.equal(pkg.productName, appName.product);
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
  assert.equal(lock.name, appName.id, 'package-lock.json name'); assert.equal(lock.packages[''].name, appName.id, 'package-lock.json packages[""].name');
});
test('the folders, marks and earlier names are made from the name file', () => {
  const appName = require('../core/app-name.cjs'), file = JSON.parse(fs.readFileSync(path.join(root, 'core', 'app-name.json'), 'utf8'));
  for (const key of ['name', 'product', 'id', 'citekeyPrefix']) assert.equal(appName[key], file[key], key);
  assert.deepEqual(appName.history, file.history);
  assert.equal(appName.vaultDir, '.' + appName.id); assert.equal(appName.syncDir, appName.id + '-sync');
  assert.equal(appName.backupKind, appName.id + '-full-backup'); assert.equal(appName.annotationPrefix, appName.id + '-');
  assert.deepEqual(appName.oldVaultDirs, file.history.map(h => '.' + h.id)); assert.deepEqual(appName.oldSyncDirs, file.history.map(h => h.id + '-sync'));
  assert.deepEqual(appName.oldBackupKinds, file.history.map(h => h.id + '-full-backup')); assert.deepEqual(appName.oldProducts, file.history.map(h => h.product));
  assert.deepEqual(appName.oldIds, file.history.map(h => h.id));
  // The takeover of what an earlier app left reads them from there.
  const legacy = require('../desktop/legacy.cjs');
  assert.equal(legacy.VAULT_DIR, appName.vaultDir); assert.equal(legacy.SYNC_DIR, appName.syncDir); assert.equal(legacy.BACKUP_KIND, appName.backupKind);
  assert.deepEqual(legacy.OLD_VAULT_DIRS, appName.oldVaultDirs); assert.deepEqual(legacy.OLD_SYNC_DIRS, appName.oldSyncDirs);
  assert.deepEqual(legacy.OLD_BACKUP_KINDS, appName.oldBackupKinds); assert.deepEqual(legacy.OLD_APP_NAMES, appName.oldProducts);
});
test('the screen gets the same name file: the built page loads it before anything that reads it', () => {
  const vm = require('node:vm'), context = vm.createContext({});
  // As scripts/build.mjs writes dist/app-name.js: the file's values, then core/app-name.cjs.
  vm.runInContext(`globalThis.appNameData=${fs.readFileSync(path.join(root, 'core', 'app-name.json'), 'utf8')};\n${fs.readFileSync(path.join(root, 'core', 'app-name.cjs'), 'utf8')}`, context);
  assert.equal(context.appName.name, require('../core/app-name.cjs').name); assert.deepEqual([...context.appName.oldIds], require('../core/app-name.cjs').oldIds);
});

// The screen strings that name the app, as they read before the name was taken from the name file (Korean key, then
// English with n = 2 and n = 1, filled with the sample values below), with the names written {{name}} (the app's name),
// {{id}}, {{product}} and {{before}}, {{beforeId}}, {{firstId}} (the earlier names'), filled from the name file. Each
// key now has {app} (the name) or {id} (the id, in a folder name) where the name was, and must read exactly as before.
const appNameNow = require('../core/app-name.cjs'), [nameBefore, nameFirst] = appNameNow.history;
const named = text => text.replaceAll('{{name}}', appNameNow.name).replaceAll('{{id}}', appNameNow.id).replaceAll('{{product}}', appNameNow.product)
  .replaceAll('{{before}}', nameBefore.name).replaceAll('{{beforeId}}', nameBefore.id).replaceAll('{{firstId}}', nameFirst.id);
const sample = { n: 2, folder: named('.{{beforeId}}'), folders: named('.{{beforeId}}, .{{firstId}}'), name: named('{{before}}'), lock: '/x/SingletonLock', aside: named('/a/.{{product}}-before-1'), host: 'host-a' };
const BEFORE = [
  ["{{name}} 시작 화면", "{{name}} start screen", "{{name}} start screen"],
  ["동기화 폴더({{id}}-sync)는 없고, 클라우드 폴더에 둔 저장소가 있습니다. 바로 열 수 있습니다.", "There is no sync folder ({{id}}-sync), but there is a vault kept in the cloud folder. You can open it directly.", "There is no sync folder ({{id}}-sync), but there is a vault kept in the cloud folder. You can open it directly."],
  ["이 폴더의 {{name}} 저장소", "{{name}} vaults in this folder", "{{name}} vaults in this folder"],
  ["고른 폴더와 그 아래 세 단계 안에 <code>{{id}}-sync</code> 폴더도, {{name}} 저장소도 없습니다.", "There is no <code>{{id}}-sync</code> folder and no {{name}} vault in the chosen folder or three levels below it.", "There is no <code>{{id}}-sync</code> folder and no {{name}} vault in the chosen folder or three levels below it."],
  ["논문 PDF가 있는 폴더(또는 빈 폴더)를 고르세요. 폴더 안의 PDF를 그대로 목록에 올리고, PDF 파일은 옮기거나 바꾸지 않습니다. 서지·메모·번역·필기는 그 폴더의 <code>.{{id}}</code> 폴더에 저장됩니다.", "Choose a folder with paper PDFs (or an empty folder). Its PDFs are listed as they are and are never moved or changed. Bibliography, memos, translations and ink are kept in the folder's <code>.{{id}}</code> folder.", "Choose a folder with paper PDFs (or an empty folder). Its PDFs are listed as they are and are never moved or changed. Bibliography, memos, translations and ink are kept in the folder's <code>.{{id}}</code> folder."],
  ["처음 한 번 시스템 브라우저에서 ChatGPT에 로그인하고 {{name}}의 모델 사용 권한을 허용하세요. 이후 앱의 번역·동시보기 버튼으로 번역합니다.", "Sign in to ChatGPT once in your system browser and allow {{name}} to use its models. Then translate with the app's Translation or Side by side button.", "Sign in to ChatGPT once in your system browser and allow {{name}} to use its models. Then translate with the app's Translation or Side by side button."],
  ["{{name}} 전체 백업 폴더가 아닙니다.", "This is not a {{name}} full backup folder.", "This is not a {{name}} full backup folder."],
  ["ChatGPT 연결을 완료했습니다. {{name}} 앱으로 돌아가세요.", "ChatGPT is connected. Go back to {{name}}.", "ChatGPT is connected. Go back to {{name}}."],
  ["이 저장소에는 이전 앱이 만든 {folder} 폴더도 있습니다(자료 {n}개). 이전 앱에서 더한 자료는 {{name}}에 보이지 않습니다. 이전 앱은 닫고 {{name}}만 쓰세요.", "This vault also has the earlier app's .{{beforeId}} folder (2 items). Items added in the earlier app are not shown in {{name}}. Close the earlier app and use {{name}} only.", "This vault also has the earlier app's .{{beforeId}} folder (1 item). Items added in the earlier app are not shown in {{name}}. Close the earlier app and use {{name}} only."],
  ["이 저장소에는 이전 앱이 만든 {folders} 폴더들도 있습니다(자료 {n}개). 이전 앱에서 더한 자료는 {{name}}에 보이지 않습니다. 이전 앱은 닫고 {{name}}만 쓰세요.", "This vault also has the earlier apps' .{{beforeId}}, .{{firstId}} folders (2 items). Items added in the earlier apps are not shown in {{name}}. Close the earlier apps and use {{name}} only.", "This vault also has the earlier apps' .{{beforeId}}, .{{firstId}} folders (1 item). Items added in the earlier apps are not shown in {{name}}. Close the earlier apps and use {{name}} only."],
  ["동기화 폴더에 이전 앱의 {folder} 폴더도 있습니다. 모든 PC를 {{name}}로 바꾼 뒤 동기화하세요.", "The sync folder also has the earlier app's .{{beforeId}} folder. Switch every computer to {{name}}, then sync.", "The sync folder also has the earlier app's .{{beforeId}} folder. Switch every computer to {{name}}, then sync."],
  ["동기화 폴더에 이전 앱의 {folders} 폴더들도 있습니다. 모든 PC를 {{name}}로 바꾼 뒤 동기화하세요.", "The sync folder also has the earlier apps' .{{beforeId}}, .{{firstId}} folders. Switch every computer to {{name}}, then sync.", "The sync folder also has the earlier apps' .{{beforeId}}, .{{firstId}} folders. Switch every computer to {{name}}, then sync."],
  ["이전 앱({name})의 설정을 옮기지 못했습니다. 디스크 공간이 부족합니다. 공간을 비운 뒤 {{name}}를 다시 시작하세요.", "Could not take over the settings of the earlier app ({{before}}): the disk is full. Free some space, then start {{name}} again.", "Could not take over the settings of the earlier app ({{before}}): the disk is full. Free some space, then start {{name}} again."],
  ["이전 앱({name})의 설정을 옮기지 못했습니다. 이전 앱이 실행 중이거나 다른 프로그램이 그 설정 폴더를 쓰고 있습니다. 이전 앱을 닫은 뒤 {{name}}를 다시 시작하세요.", "Could not take over the settings of the earlier app ({{before}}): it is running, or another program is using its settings folder. Close the earlier app, then start {{name}} again.", "Could not take over the settings of the earlier app ({{before}}): it is running, or another program is using its settings folder. Close the earlier app, then start {{name}} again."],
  ["이전 앱({name})의 설정을 옮기지 못했습니다. {{name}}를 다시 시작하면 다시 시도합니다.", "Could not take over the settings of the earlier app ({{before}}). Start {{name}} again to try once more.", "Could not take over the settings of the earlier app ({{before}}). Start {{name}} again to try once more."],
  ["다른 {{name}}가 이전 앱의 설정을 옮기는 중이라 시작하지 않았습니다. 그 {{name}}가 없는데도 이 안내가 계속되면 {lock} 파일을 지운 뒤 다시 시작하세요.", "{{name}} did not start: another {{name}} is taking over the earlier app's settings. If there is no other {{name}} and this keeps appearing, delete /x/SingletonLock, then start again.", "{{name}} did not start: another {{name}} is taking over the earlier app's settings. If there is no other {{name}} and this keeps appearing, delete /x/SingletonLock, then start again."],
  ["이전 앱({name})이 실행 중일 수 있어 설정을 옮기지 않았습니다. 이전 앱을 닫은 뒤 {{name}}를 다시 시작하세요. 이전 앱이 닫혀 있다면 {lock} 파일을 지운 뒤 다시 시작하세요.", "The settings were not taken over: the earlier app ({{before}}) may be running. Close it, then start {{name}} again. If it is already closed, delete /x/SingletonLock, then start again.", "The settings were not taken over: the earlier app ({{before}}) may be running. Close it, then start {{name}} again. If it is already closed, delete /x/SingletonLock, then start again."],
  ["앞서 치워 둔 설정 폴더({aside})를 되돌리지 못했습니다. {{name}}를 닫은 채로 그 폴더를 {folder} 자리로 옮긴 뒤 다시 시작하세요.", "Could not put back the settings folder moved aside earlier (/a/.{{product}}-before-1). With {{name}} closed, move that folder to .{{beforeId}}, then start again.", "Could not put back the settings folder moved aside earlier (/a/.{{product}}-before-1). With {{name}} closed, move that folder to .{{beforeId}}, then start again."],
  ["이전 앱의 설정은 그대로 있습니다. {{name}}는 설정을 옮긴 뒤에 시작합니다.", "The earlier app's settings are left as they were. {{name}} starts once they are taken over.", "The earlier app's settings are left as they were. {{name}} starts once they are taken over."],
  ["{{name}} 정보", "About {{name}}", "About {{name}}"],
  ["Google Drive·Dropbox 같은 공유 폴더의 저장소는 다른 컴퓨터의 잠금 파일도 함께 동기화됩니다. {host}에서 {{name}}를 종료했거나 그 컴퓨터가 꺼져 있다면 잠금을 해제하고 열 수 있습니다. 두 컴퓨터에서 동시에 열면 변경이 덮어써질 수 있습니다.", "A vault in a shared folder such as Google Drive or Dropbox syncs the other computer's lock file too. If {{name}} is closed on host-a, or that computer is off, you can unlock and open it. Opening it on both computers at once can overwrite changes.", "A vault in a shared folder such as Google Drive or Dropbox syncs the other computer's lock file too. If {{name}} is closed on host-a, or that computer is off, you can unlock and open it. Opening it on both computers at once can overwrite changes."],
  ["Google Drive·Dropbox 같은 공유 폴더의 저장소는 다른 컴퓨터의 잠금 파일도 함께 동기화됩니다. 그 컴퓨터에서 {{name}}를 종료했거나 그 컴퓨터가 꺼져 있다면 잠금을 해제하고 열 수 있습니다. 두 컴퓨터에서 동시에 열면 변경이 덮어써질 수 있습니다.", "A vault in a shared folder such as Google Drive or Dropbox syncs the other computer's lock file too. If {{name}} is closed on that computer, or it is off, you can unlock and open it. Opening it on both computers at once can overwrite changes.", "A vault in a shared folder such as Google Drive or Dropbox syncs the other computer's lock file too. If {{name}} is closed on that computer, or it is off, you can unlock and open it. Opening it on both computers at once can overwrite changes."],
  ["{{name}} 노트북", "{{name}} notebook", "{{name}} notebook"],
  ["{{name}} 번역", "{{name}} translation", "{{name}} translation"],
  ["{{name}} 원문", "{{name}} original", "{{name}} original"],
  ["{{name}} 저장소", "{{name}} vault", "{{name}} vault"]
];
test('the strings that name the app read as before, filled from the name file', () => {
  const i18n = require('../core/i18n.js'); require('../core/i18n-en.js');
  const appName = require('../core/app-name.cjs'), src = fs.readFileSync(path.join(root, 'core', 'i18n-en.js'), 'utf8');
  const keys = [...src.matchAll(/^\s*'((?:[^'\\]|\\.)*)':/gm)].map(m => m[1].replace(/\\'/g, "'"));
  assert.equal(keys.filter(k => [appName.name, appName.id, appName.product].some(name => k.includes(name))).length, 0, 'no key names the app');
  for (const [ko, en2, en1] of BEFORE.map(row => row.map(named))) {
    const key = ko.replaceAll(appName.name, '{app}').replaceAll(appName.id, '{id}');
    assert.ok(keys.includes(key), `no entry for ${key}`);
    i18n.setUiLanguage('ko'); assert.equal(i18n.tr(key, sample), ko.replace(/\{(\w+)\}/g, (whole, k) => Object.hasOwn(sample, k) ? String(sample[k]) : whole), key);
    i18n.setUiLanguage('en'); assert.equal(i18n.tr(key, sample), en2, key); assert.equal(i18n.tr(key, { ...sample, n: 1 }), en1, key);
  }
  i18n.setUiLanguage('ko');
  // A value the caller gives wins over the name file's.
  assert.equal(i18n.tr('{app} 정보', { app: 'X' }), 'X 정보');
});
test('what names the app outside the strings comes from the name file', () => {
  const appName = require('../core/app-name.cjs'), { citekeyOf } = require('../desktop/bibliography.cjs');
  assert.equal(citekeyOf({ id: 12 }), appName.citekeyPrefix + '12'); assert.equal(citekeyOf({ id: 12, citekey: 'mine' }), 'mine');
  for (const file of ['desktop/main.cjs', 'desktop/chatgpt.cjs', 'desktop/diagnostics.cjs', 'desktop/themes.cjs', 'desktop/ink.cjs', 'desktop/bibliography.cjs', 'desktop/notebook.cjs', 'desktop/library.js', 'desktop/app.js', 'desktop/index.html'])
    assert.doesNotMatch(fs.readFileSync(path.join(root, file), 'utf8'), new RegExp(`${appName.name}|'${appName.citekeyPrefix}'`), file);
});

// A copy of what the build and the release script read, with the name file changed to another name (and the brand
// files named after the new id): what they write must follow, with no code changed.
function renamedCopy(t) {
  const { execFileSync } = require('node:child_process'), os = require('node:os');
  const appName = require('../core/app-name.cjs'), dir = fs.mkdtempSync(path.join(os.tmpdir(), appName.id + '-rename-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const file of execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', 'core', 'desktop', 'scripts', 'brand', 'docs/release', 'package.json'], { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean)) {
    const to = path.join(dir, file.split('/').map(part => part.startsWith(appName.id + '-') || part.startsWith(appName.id + '.') ? 'zetanote' + part.slice(appName.id.length) : part).join('/'));
    if (!fs.existsSync(path.join(root, file))) continue; // renamed or removed and not yet committed
    fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(path.join(root, file), to);
  }
  fs.symlinkSync(path.join(root, 'node_modules'), path.join(dir, 'node_modules'), 'dir');
  const file = JSON.parse(fs.readFileSync(path.join(root, 'core', 'app-name.json'), 'utf8'));
  const renamed = { name: 'ζnote', product: 'ZetaNote', id: 'zetanote', citekeyPrefix: 'zeta', history: [{ name: file.name, product: file.product, id: file.id, citekeyPrefix: file.citekeyPrefix }, ...file.history] };
  fs.writeFileSync(path.join(dir, 'core', 'app-name.json'), JSON.stringify(renamed, null, 2) + '\n');
  return { dir, renamed, file };
}
test('the build takes the page title, the icon and the logo from the name file and brand/', t => {
  const { execFileSync } = require('node:child_process'), vm = require('node:vm'), { dir, renamed } = renamedCopy(t);
  execFileSync(process.execPath, ['scripts/build.mjs', '--ui-only'], { cwd: dir, stdio: 'pipe' });
  const dist = name => path.join(dir, 'dist', name);
  assert.match(fs.readFileSync(dist('index.html'), 'utf8'), /<title>ζnote<\/title>/);
  assert.ok(fs.readFileSync(dist('icon.png')).equals(fs.readFileSync(path.join(dir, 'brand', 'png', 'zetanote-icon-256.png'))));
  const context = vm.createContext({}); vm.runInContext(fs.readFileSync(dist('app-name.js'), 'utf8') + '\n' + fs.readFileSync(dist('app-logo.js'), 'utf8'), context);
  assert.deepEqual([context.appName.name, context.appName.id, [...context.appName.oldIds]], [renamed.name, renamed.id, renamed.history.map(h => h.id)]);
  // The logo is the brand files' drawing: the icon as it is, the word mark in the screen's text colour, its margin left out.
  const mark = fs.readFileSync(path.join(dir, 'brand', 'zetanote-mark.svg'), 'utf8'), word = fs.readFileSync(path.join(dir, 'brand', 'zetanote-wordmark.svg'), 'utf8');
  assert.equal(context.appLogo.mark, mark.trim().replace(/^<svg [^>]*>/, '<svg class="mark" viewBox="0 0 64 64" aria-hidden="true">'));
  assert.match(context.appLogo.word, /^<svg class="logo-word" viewBox="6 12 214 78" aria-hidden="true">/);
  assert.equal(context.appLogo.word.replace(/^<svg [^>]*>/, ''), word.trim().replace(/^<svg [^>]*>/, '').replaceAll('#191f28', 'currentColor'));
  assert.match(context.appLogo.word, /class="logo-word-note"/);
  // The screen's own code draws no logo of its own.
  assert.doesNotMatch(fs.readFileSync(path.join(root, 'desktop', 'app.js'), 'utf8'), /<svg class="(mark|logo-word)"|viewBox="0 0 64 64"|M22 54V21/);
});
test('the release script names the packages and writes the notes from the name file', t => {
  const { execFileSync, spawnSync } = require('node:child_process'), { dir, renamed, file } = renamedCopy(t);
  if (spawnSync('python3', ['--version']).status !== 0) return t.skip('python3 is not available');
  const dry = () => JSON.parse(execFileSync('python3', ['scripts/archive.py', '--dry-run'], { cwd: dir, encoding: 'utf8' }));
  const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version, out = dry();
  assert.deepEqual(out.targets, ['zetanote-win32-x64', 'zetanote-linux-x64']);
  assert.equal(out.windows, `zetanote-${version}-windows-x64.zip`); assert.equal(out.linux, `zetanote-${version}-linux-x64.tar.gz`);
  assert.deepEqual(out.executables, { windows: 'zetanote.exe', linux: 'zetanote' }); assert.equal(out.licence, 'LICENSE-ZETANOTE.txt');
  assert.match(out.notes, new RegExp(`^ζnote ${version} · source \``));
  // The section about the name change is the text file's, filled from the name file; without the file there is none.
  const previous = [file.name, ...file.history.map(h => h.name)].join(', ');
  assert.ok(out.notes.includes(`## 이름이 ζnote로 바뀌었습니다\n\n- 이전 이름(${previous})으로`), out.notes.slice(0, 600));
  assert.ok(out.notes.includes('**기본 인용 키가 `zeta<번호>`로**')); assert.doesNotMatch(out.notes, /\{(name|previous|citekeyPrefix)\}|<!--/);
  for (const name of [file.name, file.product, file.id]) assert.ok(!out.notes.replace(`이전 이름(${previous})`, '').includes(name), name);
  fs.rmSync(path.join(dir, 'docs', 'release', 'name-change.md'));
  const after = dry().notes; assert.doesNotMatch(after, /이름이 .*바뀌었습니다/); assert.match(after, /## 다운로드 및 실행[\s\S]*## 주요 변경/);
  void renamed;
});

// The brand is written in one place: the code, scripts, CI and tests name the app only through the name file. The
// names checked are the app's name, product name and id, its citation key prefix before a number, and the same for
// every earlier name. Kept: the name file itself, the translation placeholder PAPINOTE_MATH_ (renaming it would ask
// for finished chunks again) and the repository's address on GitHub (the repository keeps its name).
function brandPattern(appName) {
  const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), every = [appName, ...appName.history];
  const words = [...new Set(every.flatMap(n => [n.name, n.product, n.id]))].map(escape);
  return new RegExp([...words, ...every.map(n => escape(n.citekeyPrefix) + '(?=\\d)')].join('|'), 'i');
}
// The repository's address as package.json gives it (owner/name).
const repository = /github\.com\/([^/]+\/[^/.]+)/.exec(JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).repository.url)[1];
const KEPT = [/PAPINOTE_MATH_/g, new RegExp(RegExp.escape(repository) + '\\b', 'g')];
test('the code, scripts, CI and tests name the app only through the name file', () => {
  const { execFileSync } = require('node:child_process'), appName = require('../core/app-name.cjs'), brand = brandPattern(appName), left = [];
  const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z', 'desktop', 'core', 'scripts', '.github', 'tests'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
  for (const file of files) {
    if (file === 'core/app-name.json' || /\.(png|ico|jpe?g|gif|pdf|woff2?|ttf)$/i.test(file)) continue;
    let text; try { text = fs.readFileSync(path.join(root, file), 'utf8'); } catch { continue; }
    if (text.includes('\0')) continue;
    text.split('\n').forEach((line, i) => { if (brand.test(KEPT.reduce((rest, kept) => rest.replace(kept, ''), line))) left.push(`${file}:${i + 1}: ${line.trim().slice(0, 140)}`); });
  }
  assert.deepEqual(left, [], `the brand written out:\n${left.join('\n')}`);
});
