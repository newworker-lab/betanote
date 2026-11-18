// End-to-end check of the everyday help in the real Electron app (APP_TEST_SOURCE=1 runs the
// source): first-run guide, shortcut list, reading a vault again after an outside change
// without a restart, and the window reopening with its size.
const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { PDFDocument, StandardFonts } = require('pdf-lib');
const appName = require('../core/app-name.cjs');
const root = path.resolve(__dirname, '..');
(async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), `${appName.id}-help-e2e-`)), vault = path.join(temp, 'vault'); await fs.mkdir(vault);
  const doc = await PDFDocument.create(), font = await doc.embedFont(StandardFonts.Helvetica); doc.addPage([600, 800]).drawText('A research paper connects ideas.', { x: 40, y: 740, size: 14, font });
  await fs.writeFile(path.join(vault, 'paper.pdf'), await doc.save());
  const executable = require('./app-executable.cjs')(root);
  let app;
  const launch = async () => {
    app = await electron.launch({ executablePath: executable, args: [...(process.env.APP_TEST_SOURCE === '1' ? [root] : []), '--no-sandbox', '--ozone-platform=headless', '--disable-gpu', `--user-data-dir=${path.join(temp, 'profile')}`], timeout: 20000 });
    const p = await app.firstWindow(); p.setDefaultTimeout(15000);
    p.on('pageerror', e => { console.error(e); process.exitCode = 1; }); p.on('console', m => { if (m.type() === 'error') console.error('renderer:', m.text()); });
    await app.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }); }, vault);
    return p;
  };
  try {
    let p = await launch();
    // First run: the guide explains the vault and the three steps; it leaves once a vault was opened.
    await p.locator('.welcome-guide').waitFor();
    assert.match(await p.locator('.welcome-guide').textContent(), /폴더를 저장소로 연결[\s\S]*파일 추가[\s\S]*번역 연결/);
    // Shortcut list: ? and F1 open it, typing a ? into a field does not.
    await p.waitForFunction(() => typeof showShortcuts === 'function'); // the last script has loaded
    await p.keyboard.press('?'); await p.locator('.shortcut-help').waitFor();
    assert.match(await p.locator('.shortcut-help').textContent(), /Ctrl\+K[\s\S]*Ctrl\+F[\s\S]*Ctrl\+Z/);
    await p.keyboard.press('Escape'); await p.locator('.shortcut-help').waitFor({ state: 'detached' }).catch(() => {});
    assert.equal(await p.evaluate(() => document.querySelector('#dialog').open), false);

    await p.locator('[data-action="storage"]').first().click(); await p.locator('.paper-item').waitFor();
    await p.locator('#search').fill('?'); assert.equal(await p.evaluate(() => document.querySelector('#dialog').open), false, 'a ? typed in the search field is text');
    await p.locator('#search').fill(''); await p.keyboard.press('F1'); await p.locator('.shortcut-help').waitFor(); await p.locator('#dialog [data-action="close"]').first().click();

    // Another program changes library.json. Coming back to the window offers to read it again.
    const file = path.join(vault, appName.vaultDir, 'library.json'), data = JSON.parse(await fs.readFile(file, 'utf8')), paperId = data.papers[0].id;
    data.papers[0].title = 'Renamed on the other PC'; data.notes[`${paperId}-메모`] = 'written on the other PC';
    await fs.writeFile(file, JSON.stringify(data, null, 2));
    // The page holds a memo it has not saved yet (same key: both sides must survive) and one only it has.
    await p.evaluate(id => { notes[`${id}-메모`] = 'typed here, not saved'; notes[`${id}-summary-0`] = 'only here'; }, paperId);
    await p.evaluate(() => window.dispatchEvent(new Event('focus')));
    await p.locator('#dialog h2').filter({ hasText: '다른 프로그램에서 변경' }).waitFor();
    await p.locator('#dialog [data-action="vault-reload"]').click();
    await p.locator('.paper-item').filter({ hasText: 'Renamed on the other PC' }).waitFor();
    const saved = JSON.parse(await fs.readFile(file, 'utf8'));
    assert.match(saved.notes[`${paperId}-메모`], /^written on the other PC[\s\S]*저장하지 못한 내용[\s\S]*typed here, not saved$/);
    assert.equal(saved.notes[`${paperId}-summary-0`], 'only here');
    assert.equal(await p.evaluate(id => notes[`${id}-summary-0`], paperId), 'only here');
    // Saving works again, with no restart.
    await p.evaluate(id => { notes[`${id}-summary-0`] = 'saved after reading again'; return desktopNotes(); }, paperId);
    assert.equal(JSON.parse(await fs.readFile(file, 'utf8')).notes[`${paperId}-summary-0`], 'saved after reading again');
    // A refused save (no focus check in between) also brings the offer.
    data.papers[0].title = 'Renamed twice'; data.notes = JSON.parse(await fs.readFile(file, 'utf8')).notes; await fs.writeFile(file, JSON.stringify(data, null, 2));
    await p.evaluate(id => { notes[`${id}-summary-0`] = 'again'; return desktopNotes().catch(() => {}); }, paperId);
    await p.locator('#dialog [data-action="vault-reload"]').click(); await p.locator('.paper-item').filter({ hasText: 'Renamed twice' }).waitFor();
    assert.equal(JSON.parse(await fs.readFile(file, 'utf8')).notes[`${paperId}-summary-0`], 'again');

    // Menu bar: the app's own menus, no reload or developer tools outside development, and each command acts on the page.
    const menu = () => app.evaluate(({ Menu }) => Menu.getApplicationMenu().items.map(top => [top.label, top.submenu.items.filter(i => i.type !== 'separator').map(i => i.label)]));
    const press = (top, label, sub) => app.evaluate(({ Menu }, [top, label, sub]) => { let item = Menu.getApplicationMenu().items.find(i => i.label.startsWith(top)).submenu.items.find(i => i.label === label); if (sub) item = item.submenu.items.find(i => i.label === sub); item.click(); }, [top, label, sub]);
    const tops = await menu(); assert.deepEqual(tops.map(t => t[0]), ['파일(&F)', '편집(&E)', '보기(&V)', '자료(&L)', '도움말(&H)'], 'no 번역·AI menu in this version');
    assert.ok(!tops.flatMap(t => t[1]).some(label => /새로 고침 \(개발\)|개발자 도구/.test(label)), 'no reload or developer tools in a normal run');
    assert.deepEqual(await app.evaluate(({ Menu }) => Menu.getApplicationMenu().items[0].submenu.items.find(i => i.label === '최근 저장소').submenu.items.map(i => i.label)), ['vault']);
    await press('도움말', '단축키'); await p.locator('.shortcut-help').waitFor(); await p.locator('#dialog [data-action="close"]').first().click();
    await press('파일', '저장소 관리…'); await p.locator('#dialog h2').filter({ hasText: '저장소 관리' }).waitFor(); await p.locator('#dialog [data-action="close"]').first().click();
    await press('자료', '중복 자료 후보…'); await p.locator('#dialog h2').filter({ hasText: '중복 자료 후보' }).waitFor();
    // With a dialog open, another command waits instead of starting behind it.
    await press('파일', '저장소 관리…'); await p.locator('#toast.show').filter({ hasText: '먼저 닫아' }).waitFor(); await p.locator('#dialog [data-action="close"]').first().click();
    // Without a connected model the translated view opens the connection settings, as the screen's own button does.
    const closeDialog = async () => { await p.waitForTimeout(300); if (await p.evaluate(() => document.querySelector('#dialog').open)) await p.locator('#dialog [data-action="close"]').first().click(); };
    await press('보기', '번역'); await p.waitForFunction(() => state.screen === 'reader' && state.mode === 'translated'); await closeDialog();
    await press('보기', '원문'); await p.waitForFunction(() => state.mode === 'original'); await closeDialog();
    const zoom = () => p.evaluate(() => readerZoom); const before = await zoom(); await press('보기', '확대'); await p.waitForFunction(z => readerZoom > z, before);
    await press('자료', '서지정보 편집…'); await p.locator('#bibliography-form').waitFor(); await p.locator('#dialog [data-action="close"]').first().click();
    await press('자료', '삭제 (PDF 파일 포함)…'); await p.locator('#dialog h2').filter({ hasText: '자료 삭제' }).waitFor(); await p.locator('#dialog [data-action="close"]').first().click();
    await press('자료', '라이브러리로 돌아가기'); await p.waitForFunction(() => state.screen === 'library');
    await press('편집', '자료 검색'); await p.waitForFunction(() => document.activeElement?.id === 'search');
    await press('보기', '왼쪽 사이드바 접기·펴기'); await p.waitForFunction(() => state.leftCollapsed === true); await press('보기', '왼쪽 사이드바 접기·펴기'); await p.waitForFunction(() => state.leftCollapsed === false);

    // Settings: the notification switch is on by default and is remembered.
    await p.locator('[data-action="settings"]').click(); await p.locator('[data-llm-section="general"] summary').click();
    assert.equal(await p.locator('#kn-notify').isChecked(), true); await p.locator('#kn-notify').uncheck();
    await p.waitForFunction(() => document.querySelector('[data-llm-section="general"] summary small').textContent.includes('끔'));
    await p.locator('#dialog [data-action="close"]').first().click();

    // The window's place is saved on closing; the guide is gone now that a vault is known.
    const window = await app.browserWindow(p); await window.evaluate(w => w.setBounds({ x: 40, y: 30, width: 1111, height: 777 }));
    await app.close();
    const settings = JSON.parse(await fs.readFile(path.join(temp, 'profile', 'settings.json'), 'utf8'));
    assert.equal(settings.window.width, 1111); assert.equal(settings.window.height, 777); assert.equal(settings.features.notifications, false);
    // The last vault opens again; its start screen lists it, without the first-run guide.
    p = await launch(); await p.locator('.shell').waitFor(); await p.locator('.logo-home').first().click(); await p.locator('.recent-item').first().waitFor();
    assert.equal(await p.locator('.welcome-guide').count(), 0);
    // The headless display is 1×1 and pins every window to 800×600, so the reopened size itself is checked on a real display only.
    console.log('help smoke passed');
  } finally { await app?.close().catch(() => {}); await fs.rm(temp, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exit(1); });
