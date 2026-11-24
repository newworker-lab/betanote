const { app, BrowserWindow, ipcMain, dialog, protocol, net, shell, safeStorage, clipboard, screen, Notification, Menu } = require('electron');
const fs = require('node:fs/promises');
const os = require('node:os');
const { VaultWatch } = require('./vault-watch.cjs');
const { watch } = require('node:fs');
const {backgroundSample,emphasis,MIN_FIT,MIN_FIT_LINE,TAIL_FIT,HARD_FIT}=require('../core/pdf-layout.js');
const {preparePrintDocument,printText}=require('../core/pdf-print.cjs');
const { ChatGPT } = require('./chatgpt.cjs');
const { Connections, withGlossary, notConnected, migrateSettings, rememberModel } = require('./llm.cjs');
const { readSettingsFile, settingsShape } = require('./settings-file.cjs');
const { isRawFileError, plainFileError } = require('./file-error.cjs');
// Settings files set aside at start because they could not be read (settings-file.cjs), told once in the window.
const startupNotices = [];
// A recent vault is named by a key made from its folder, not by its vault id: a folder and its copy hold one vault id
// and are two entries. Where it is (its parent folder, the home folder as ~) is shown beside its name.
const recentKey = root => require('node:crypto').createHash('sha256').update(String(root)).digest('hex').slice(0, 16);
const recentWhere = root => { const parent = path.dirname(String(root)), home = os.homedir(); return parent === home || parent.startsWith(home + path.sep) ? '~' + parent.slice(home.length) : parent; };
const recentList = () => config.recents.map(r => ({ id: r.id, key: recentKey(r.root), name: r.name, where: recentWhere(r.root), current: library?.root === r.root }));
const recentFor = key => config.recents.find(r => recentKey(r.root) === key) || config.recents.find(r => r.id === key);
const startupNotice = n => n.kind === 'chatgpt' ? tr('ChatGPT 연결 정보 파일({file})을 읽을 수 없어 {aside}(으)로 옮겨 두었습니다. 설정에서 다시 연결하세요.', n)
  : n.kind === 'keys' ? tr('API 키 파일({file})을 읽을 수 없어 {aside}(으)로 옮겨 두었습니다. 설정에서 키를 다시 넣으세요.', n)
  : tr('설정 파일({file})을 읽을 수 없어 {aside}(으)로 옮겨 두고 기본값으로 시작했습니다.', n);
const { features, setFeature, requireFeature } = require('./features.cjs');
const { LocalLLM, normalizeLocal, isLoopback } = require('./local-llm.cjs');
const { ApiKeyStore, OpenAIAPI, ClaudeAPI, GeminiAPI, CompatibleAPI, KEY_PAGES, MAX_PROVIDERS, normalizeProvider } = require('./api-llm.cjs');
const { TranslationJobs, source, exportHtml, applyLayoutPlan, applyFlow, repairPages } = require('./translation.cjs');
const { formulaOnly, escapeHtml } = require('../core/pdf-layout.js');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const {normalizeDOI,crossrefMetadata,dataciteMetadata,bestTitleMatch,pdfOwnMetadata,compareMetadata,fileNameFor,exportBibliography,referenceList,inTextCitation,parseBibliography}=require('./bibliography.cjs');
const {lockVault}=require('./vault-lock.cjs');
const appName=require('../core/app-name.cjs');
const {adoptUserData,adoptSyncFolder,oldSyncBeside,oldVaultBeside,VAULT_DIR}=require('./legacy.cjs');
const { Library, readJson, atomicJson, mergePendingNotes, readAiRecords, keepConflictCopy } = require('./storage.cjs');
const { InkStore, renderRevision, inkedOriginal, cleanMarks, inkedHtml } = require('./ink.cjs');
const { FullText } = require('./fulltext.cjs');
const { ContentIndex } = require('./content-index.cjs');
const { PageOcr } = require('./ocr.cjs');
const { DiagnosticLog } = require('./diagnostics.cjs');
const { createFullBackup, verifyBackup, restoreFullBackup } = require('./backup.cjs');
const insight = require('./insight.cjs');
const { CorrectionStore } = require('./corrections.cjs');
const { NotebookStore, notebookHtml, notesMarkdown } = require('./notebook.cjs');
const { ThemeStore } = require('./themes.cjs');
const { releaseFeed, latestRelease, due, noticeFor, UPDATE_EVERY, storedRelease } = require('./update-check.cjs');
const { normalizeLanguage, initialLanguage, languageAskAtStart, startupLanguage, patchLanguage, languageInfo, aiLanguage, translationLanguage, systemLanguagesFrom, keepLanguage } = require('./language.cjs');
const { setUiLanguage, tr, trIn } = require('../core/i18n.js');
const { LANGUAGES } = require('../core/languages.cjs');
require('../core/i18n-en.js'); // the English the main process's own text is looked up in
const { SyncEngine, resolveConflict, sharedVaults, syncBase, vaultFolders, writeFileRecord } = require('./sync.cjs');
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);
// The app plays no video: on Linux, video acceleration is left off so an older system libva does not make Chromium print
// "Installed VAAPI version is too old" at every start (DEVELOPMENT.md, 알려진 무해한 터미널 기록). Windows and macOS as they were.
if (process.platform === 'linux') { app.commandLine.appendSwitch('disable-accelerated-video-decode'); app.commandLine.appendSwitch('disable-accelerated-video-encode'); }
let contentChanged=()=>{};
let win, library, config, configFile, language, auth, connections, translations,releaseVault,figureController,fullText,insightController,syncVault;
let queue = Promise.resolve();
const development = process.env.APP_DEV_MODE === '1' && !app.isPackaged;
// Settings left by the app under an earlier name are taken over before anything reads them (legacy.cjs). A run
// that finds another taking them over quits quietly; one that could not take them over says why and quits without
// writing any settings, so the next start tries again.
adoptUserData(app,development?'-dev':'');
const takeoverStopped=adoptUserData.busy||Boolean(adoptUserData.failed);
// Folders an earlier stopped run left (see below), in the temporary folder or appData, once they are clearly not in use;
// one that cannot be removed does not keep the others.
{const fsSync=require('node:fs'),stopPrefix=`.${path.basename(app.getPath('userData'))}-stop-`;
  for(const [parent,prefix] of [[os.tmpdir(),appName.id+'-takeover-'],[app.getPath('appData'),stopPrefix]]){let names=[];try{names=fsSync.readdirSync(parent);}catch{/* nothing to clear */}
    for(const name of names)if(name.startsWith(prefix))try{const dir=path.join(parent,name);if(Date.now()-fsSync.statSync(dir).mtimeMs>10*60000)fsSync.rmSync(dir,{recursive:true,force:true});}catch{/* a leftover that stays is tried again at the next start */}}}
if(development&&!takeoverStopped)app.setPath('userData',app.getPath('userData')+'-dev');
const singleInstance=!takeoverStopped&&app.requestSingleInstanceLock();if(!takeoverStopped&&!singleInstance)app.quit();
if(adoptUserData.busy&&!adoptUserData.stuckLock)app.exit(0);
else if(takeoverStopped){
  // A run stopped by the takeover leaves the settings folders alone: Chromium writes what it needs into a folder of
  // its own, removed when the run ends (or by a later start, as Chromium may write in it while closing), so it never
  // writes into a folder another start has just taken over. Where even that folder cannot be made (a full disk), the
  // run still says why and ends.
  // Where the temporary folder cannot be used, a folder beside the settings in appData does; where neither can be made,
  // the run ends at once, before Chromium writes anything, without a word rather than in the settings folder.
  let scratch=null;
  for(const make of [()=>require('node:fs').mkdtempSync(path.join(os.tmpdir(),appName.id+'-takeover-')),()=>{const dir=path.join(app.getPath('appData'),`.${path.basename(app.getPath('userData'))}-stop-${process.pid}`);require('node:fs').mkdirSync(dir);return dir;}]){try{scratch=make();break;}catch{/* the next place is tried */}}
  if(scratch)app.setPath('userData',scratch);else app.exit(0);
  app.whenReady().then(()=>{
    const failed=adoptUserData.failed,name=failed?.name;
    // In the language the earlier app was set to (its settings are still where they were), else Korean.
    let earlier=null;try{if(name)earlier=JSON.parse(require('node:fs').readFileSync(path.join(app.getPath('appData'),name+(development?'-dev':''),'settings.json'),'utf8')).language;}catch{}
    setUiLanguage(startupLanguage(earlier??initialLanguage({existingInstall:true,osLanguages:[]}),process.env.APP_UI_LANG).ui);
    const message=!failed?tr('다른 {app}가 이전 앱의 설정을 옮기는 중이라 시작하지 않았습니다. 그 {app}가 없는데도 이 안내가 계속되면 {lock} 파일을 지운 뒤 다시 시작하세요.',{lock:adoptUserData.stuckLock})
      :failed.reason==='space'?tr('이전 앱({name})의 설정을 옮기지 못했습니다. 디스크 공간이 부족합니다. 공간을 비운 뒤 {app}를 다시 시작하세요.',{name})
        :failed.reason==='restore'?tr('앞서 치워 둔 설정 폴더({aside})를 되돌리지 못했습니다. {app}를 닫은 채로 그 폴더를 {folder} 자리로 옮긴 뒤 다시 시작하세요.',{aside:failed.aside,folder:failed.folder})
        :failed.reason==='running'?tr('이전 앱({name})이 실행 중일 수 있어 설정을 옮기지 않았습니다. 이전 앱을 닫은 뒤 {app}를 다시 시작하세요. 이전 앱이 닫혀 있다면 {lock} 파일을 지운 뒤 다시 시작하세요.',{name,lock:failed.lock})
          :failed.reason==='busy'?tr('이전 앱({name})의 설정을 옮기지 못했습니다. 이전 앱이 실행 중이거나 다른 프로그램이 그 설정 폴더를 쓰고 있습니다. 이전 앱을 닫은 뒤 {app}를 다시 시작하세요.',{name})
            :tr('이전 앱({name})의 설정을 옮기지 못했습니다. {app}를 다시 시작하면 다시 시도합니다.',{name});
    dialog.showMessageBoxSync({type:'warning',title:appName.name,buttons:[tr('확인')],message,...(failed&&failed.reason!=='restore'?{detail:tr('이전 앱의 설정은 그대로 있습니다. {app}는 설정을 옮긴 뒤에 시작합니다.')}:{})});
    if(scratch)try{require('node:fs').rmSync(scratch,{recursive:true,force:true});}catch{/* cleared at a later start (clearStaleScratch) */}
    app.exit(0);
  });
}
app.on('second-instance',()=>{win?.show();win?.focus();});

let devUI=null;
const providers = { gpt: 'https://chatgpt.com/', claude: 'https://claude.ai/', gemini: 'https://gemini.google.com/' };
// A notebook opened in its own window reaches only these channels: it reads the open vault
// and edits notebooks, nothing that opens, closes or rewrites the vault.
const notebookWindows=new Set();
// What went wrong, kept on this computer for the reader to send when asking for help
// (desktop/diagnostics.cjs): nothing is sent, and paths, keys and text are left out.
let diagnosticLog=null,heldSecrets=()=>[];
function diagnostics(){
  if(!diagnosticLog){try{diagnosticLog=new DiagnosticLog({directory:path.join(app.getPath('userData'),'logs'),version:app.getVersion(),places:()=>[[library?.root,'<vault>'],[app.getPath('userData'),'<userData>'],[app.getAppPath(),'<app>']],secrets:()=>heldSecrets()});}catch{return null;}}
  return diagnosticLog;
}
const record=(kind,error,detail)=>diagnostics()?.write(kind,error,detail);
process.on('uncaughtException',error=>{record('uncaught',error);console.error(error);});
process.on('unhandledRejection',error=>{record('rejection',error);console.error(error);});
// A window whose page died or froze: recorded, and for the main window the reader is told that
// the papers are safe and offered the page again (after what was being written is written).
function watchWindow(target,name){
  target.webContents.on('render-process-gone',(_event,details)=>{
    if(['clean-exit','killed'].includes(details?.reason)&&target!==win)return;
    record('window-gone',Error(`${details?.reason||'unknown'} (${details?.exitCode??''})`),name);
    if(target!==win||quitting||target.isDestroyed())return;
    dialog.showMessageBox(target,{type:'error',title:appName.name,message:tr('화면에 문제가 생겨 다시 불러와야 합니다.'),detail:tr('저장된 자료는 그대로입니다. 방금 쓰던 메모의 마지막 몇 글자는 저장되지 않았을 수 있습니다.\n같은 문제가 반복되면 도움말 → 진단 정보 복사로 내용을 복사해 문의해 주세요.'),buttons:[tr('다시 불러오기'),tr('닫기')],defaultId:0,cancelId:1}).then(async choice=>{if(choice.response!==0||target.isDestroyed())return;await queue.catch(()=>{});await translations?.writes?.catch?.(()=>{});target.webContents.reload();}).catch(()=>{});
  });
  let frozen=false;
  target.on('unresponsive',()=>{
    if(frozen||target.isDestroyed())return;frozen=true;record('window-frozen',Error('unresponsive'),name);
    if(target!==win){frozen=false;return;}
    dialog.showMessageBox(target,{type:'warning',title:appName.name,message:tr('화면이 응답하지 않습니다.'),detail:tr('큰 PDF를 읽는 중이면 잠시 뒤 돌아올 수 있습니다. 저장된 자료는 그대로입니다.'),buttons:[tr('기다리기'),tr('다시 불러오기')],defaultId:0,cancelId:0}).then(async choice=>{frozen=false;if(choice.response!==1||target.isDestroyed())return;await translations?.writes?.catch?.(()=>{});target.webContents.reload();}).catch(()=>{frozen=false;});
  });
  target.on('responsive',()=>{frozen=false;});
}
let foundVaultFolders=new Set(),lastShared=null;
const NOTEBOOK_WINDOW_CHANNELS=new Set(['page-error','leave-full-screen','bootstrap','language-sync','window-snapshot','notebook-list','notebook-get','notebook-create','notebook-save','notebook-asset-put','notebook-asset-get','notebook-pdf-pick','notebook-export','themes-list','theme-css','snippet-css']);
// The original PDF or its translation in a window of its own (원문·번역 새 창) reads only: the vault
// as it is, the PDF, the stored translation, the marks and the look of the app. Nothing that writes reaches it.
const viewWindows=new Set();
const VIEW_WINDOW_CHANNELS=new Set(['page-error','leave-full-screen','bootstrap','language-sync','window-snapshot','themes-list','theme-css','snippet-css','original-hash','read-original','ink-load','ink-surfaces','translation-cached']);
// Closing the app or the vault closes notebook windows first (each saves before it goes), and the windows that only show an original.
const closeNotebookWindows=()=>Promise.all([...notebookWindows,...viewWindows].map(w=>w.isDestroyed()?null:new Promise(resolve=>{w.once('closed',resolve);w.close();})));
// Whether a request on this channel may come from the window that sent it: the main window's page
// asks anything, a notebook or view window only its own channels, any other frame nothing.
function allowedSender(event,name){
  const fromNotebook=[...notebookWindows].some(w=>!w.isDestroyed()&&event.sender===w.webContents&&event.senderFrame===w.webContents.mainFrame);
  const fromView=!fromNotebook&&[...viewWindows].some(w=>!w.isDestroyed()&&event.sender===w.webContents&&event.senderFrame===w.webContents.mainFrame);
  const allowed=fromNotebook ? NOTEBOOK_WINDOW_CHANNELS.has(name) : fromView ? VIEW_WINDOW_CHANNELS.has(name) : (event.sender === win?.webContents && event.senderFrame === win.webContents.mainFrame);
  if (!allowed && process.env.APP_DEBUG_IPC) console.warn('refused', name);
  return allowed;
}
// Whether a newer release is out: asked of GitHub once the window is up (not again within half an hour, so a few
// restarts ask once), every six hours while the app is open (APP_UPDATE_EVERY_MS, a test's shorter time), and at once
// from 지금 확인 in the settings. The newest release found is kept (updateLatest), so a notice put off (나중에) is told
// again at the next start even when GitHub is not asked then. Not asked by the Microsoft Store's package (the Store
// updates it), when switched off in the settings (features.updateCheck; 지금 확인 still asks), or with
// APP_UPDATE_FEED=off (the tests); another value of that variable is the address asked instead (a test's own server).
// A check that got no answer is not counted, so the next one asks again.
// Returns what 지금 확인 says: {store}, {off}, {failed}, or {current, latest, notice}.
let pendingUpdate=null;
const tellUpdate=()=>{if(pendingUpdate&&win&&!win.isDestroyed())win.webContents.send('update-available',pendingUpdate);};
async function checkForUpdate({every=UPDATE_EVERY.start,now=false}={}){
  const override=process.env.APP_UPDATE_FEED,current=app.getVersion();
  if(process.windowsStore)return {store:true};
  if(override==='off'||!now&&!features(config).updateCheck?.enabled)return {off:true};
  if(!now&&!due(config.updateCheckedAt,Date.now(),every)){pendingUpdate=noticeFor({current,release:storedRelease(config.updateLatest),skipped:config.updateSkipped});tellUpdate();return {current};}
  const release=await latestRelease({fetch:(...args)=>net.fetch(...args),feed:override||releaseFeed(require('../package.json').repository?.url)});
  if(!release){if(!now){pendingUpdate=noticeFor({current,release:storedRelease(config.updateLatest),skipped:config.updateSkipped});tellUpdate();}return {failed:true,current};}
  config={...config,updateCheckedAt:Date.now(),updateLatest:release};await atomicJson(configFile,config);
  // Asked for (지금 확인), a newer release is told even when it was skipped.
  pendingUpdate=noticeFor({current,release,skipped:now?undefined:config.updateSkipped});
  if(!now)tellUpdate();
  return {current,latest:release.version,notice:pendingUpdate};
}
// The open vault's folder is not where it was (storage.cjs gone); a folder that cannot be looked at counts as there.
const vaultGone=()=>Promise.resolve(library?.gone()).then(Boolean,()=>false);
function register(name, fn, serial = true) {
  ipcMain.handle(name, (event, ...args) => {
    if (!allowedSender(event, name)) throw Error(tr('허용되지 않은 요청입니다.'));
    const outside=error=>{
      // Node's own file errors name the call and the whole path; the window gets the reason and the code (the record keeps both).
      if(isRawFileError(error)){record('request',error,name);throw plainFileError(error);}
      // A save refused because the vault changed on disk: the page offers to read it again.
      if((error?.code==='APP_EXTERNAL_CHANGE'||error?.code==='APP_VAULT_GONE')&&win&&!win.isDestroyed())vaultGone().then(gone=>{if(win&&!win.isDestroyed())win.webContents.send('vault-changed-outside',{gone});});else if(error?.name!=='AbortError')record('request',error,name);
      // The window sees only the message, so a code travels in front of it as ⟦CODE⟧ (read by errorCode in renderer.js).
      if(typeof error?.code==='string'&&/^APP_[A-Z_]+$/.test(error.code)&&error.code!=='APP_EXTERNAL_CHANGE'&&error.code!=='APP_VAULT_GONE'&&!error.message.startsWith('⟦'))error.message='⟦'+error.code+'⟧'+error.message;throw error;};
    if (!serial) return Promise.resolve().then(() => fn(...args)).catch(outside);
    const job = queue.then(() => fn(...args)).catch(outside); queue = job.catch(() => {}); return job;
  });
}
const inkOf=target=>target.ink||=new InkStore(target);
// A hidden print window that never settles must not hold the serial queue
// (and so every later action and app exit) forever.
function within(promise,ms,message){let timer;return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(message)),ms);})]).finally(()=>clearTimeout(timer));}
// While a vault is being closed (switching vaults, quitting) it takes no new
// writes: they would land after its final backup or after its lock is released.
let closingVault=null;
// The earlier app's folders already told about in this run (legacy.cjs oldVaultBeside, oldSyncBeside).
const toldOld=new Set();
// Whether a translation job is running in this vault (for these papers, when given).
function translating(id,paperIds){return [...(translations?.jobs.values()||[])].some(job=>job.libraryId===id&&job.state==='running'&&(!paperIds||paperIds.includes(job.paperId)));}
const PRINT_TIMEOUT=()=>tr('PDF 출력이 응답하지 않아 중단했습니다. 다시 시도하세요.'); // read when a print stalls (the screen language can change)
// Font faces point at the bundled files so the hidden print window can load them.
async function inlineFonts(html){const fontDir=path.join(__dirname,'..','dist','fonts');const css=(await fs.readFile(path.join(fontDir,'font.css'),'utf8')).replace(/url\(\.\/files\/([^)]*)\)/g,(_match,name)=>`url("${pathToFileURL(path.join(fontDir,'files',name)).href}")`);return html.replace('</style>',()=>css+'</style>');}
// HTML to PDF bytes in a hidden sandboxed window (translation export, notebooks,
// notes). prepare runs in the page first; its result comes back with the bytes.
async function printPdf(html,{prepare,pageSize}={}){
  let printer,temp;
  try{
    temp=await fs.mkdtemp(path.join(os.tmpdir(),appName.id+'-print-'));const file=path.join(temp,'print.html');await fs.writeFile(file,html);
    printer=new BrowserWindow({show:false,webPreferences:{sandbox:true,nodeIntegration:false,contextIsolation:true}});
    await within(printer.loadFile(file),60000,PRINT_TIMEOUT());
    const prepared=await within(printer.webContents.executeJavaScript(prepare),180000,PRINT_TIMEOUT());
    const bytes=await within(printer.webContents.printToPDF({printBackground:true,preferCSSPageSize:true,...(pageSize?{pageSize}:{}),margins:{top:0,bottom:0,left:0,right:0}}),300000,PRINT_TIMEOUT());
    return {bytes,prepared};
  }finally{printer?.destroy();if(temp)await fs.rm(temp,{recursive:true,force:true});}
}
// The main window opens where it was closed. A position on a display that is gone is
// dropped (the size is kept), so the window can never open off screen.
function windowPlace(saved){
  const place={width:1440,height:1000};if(!saved||![saved.x,saved.y,saved.width,saved.height].every(Number.isFinite))return place;
  place.width=Math.max(800,Math.round(saved.width));place.height=Math.max(600,Math.round(saved.height));
  const visible=screen.getAllDisplays().some(({workArea:a})=>saved.x<a.x+a.width-120&&saved.x+place.width>a.x+120&&saved.y>=a.y-20&&saved.y<a.y+a.height-80);
  return visible?{...place,x:Math.round(saved.x),y:Math.round(saved.y)}:place;
}
// The application menu. Its commands are carried out by the page (desktop/help.js
// menuCommands), which presses the same controls the user would, so the menu and the
// screen can never disagree about what a command does. Shortcuts the page already
// handles itself (Ctrl+F, Ctrl+K) are shown here but not registered a second time.
// Reload and the developer tools are offered only in development: a reload stops running translations.
const diagnosticReport=()=>diagnostics()?.report({Electron:process.versions.electron,Chromium:process.versions.chrome})||`${appName.name} ${app.getVersion()}`;
function buildMenu(){
  const send=(command,arg)=>()=>{if(win&&!win.isDestroyed()){if(win.isMinimized())win.restore();win.focus();win.webContents.send('menu-command',command,arg);}};
  const item=(label,command,accelerator,extra={})=>({label,click:send(command,extra.arg),...(accelerator?{accelerator}:{}),...(extra.shown?{registerAccelerator:false}:{})});
  const line={type:'separator'},recents=(config?.recents||[]).slice(0,8);
  const template=[
    {label:tr('파일(&F)'),submenu:[
      item(tr('저장소 열기…'),'storage','CmdOrCtrl+O'),
      {label:tr('최근 저장소'),enabled:recents.length>0,submenu:recents.map(r=>({label:recents.filter(x=>x.name===r.name).length>1?`${r.name} — ${recentWhere(r.root)}`:r.name,click:send('open-recent',recentKey(r.root))}))},
      line,
      item(tr('파일 추가…'),'add-files','CmdOrCtrl+Shift+O'),item(tr('DOI로 추가…'),'add-by-doi'),item(tr('새 폴더…'),'new-folder'),
      line,
      item(tr('서지정보 가져오기 (RIS·BibTeX·CSL JSON)…'),'import-ris'),
      {label:tr('서지정보 내보내기'),submenu:[item('RIS…','export-ris'),item('BibTeX…','export-bib'),item('BibLaTeX…','export-biblatex'),item('CSL JSON…','export-csl')]},
      line,
      item(tr('PDF로 저장…'),'save-pdf','CmdOrCtrl+S'),
      line,
      item(tr('저장소 관리…'),'vault-manager'),item(tr('지금 백업'),'create-backup'),item(tr('전체 백업…'),'full-backup'),
      line,
      item(tr('설정…'),'settings','CmdOrCtrl+,'),
      line,
      {label:tr('끝내기'),role:'quit',accelerator:'CmdOrCtrl+Q'}]},
    {label:tr('편집(&E)'),submenu:[
      {label:tr('실행 취소'),role:'undo'},{label:tr('다시 실행'),role:'redo'},line,
      {label:tr('잘라내기'),role:'cut'},{label:tr('복사'),role:'copy'},{label:tr('붙여넣기'),role:'paste'},{label:tr('모두 선택'),role:'selectAll'},
      line,
      item(tr('자료 검색'),'search','CmdOrCtrl+K',{shown:true}),item(tr('본문에서 찾기'),'find','CmdOrCtrl+F',{shown:true})]},
    {label:tr('보기(&V)'),submenu:[
      item(tr('원문'),'mode',null,{arg:'original'}),item(tr('번역'),'mode',null,{arg:'translated'}),item(tr('동시보기'),'mode',null,{arg:'dual'}),item(tr('노트북'),'mode',null,{arg:'notebook'}),
      line,
      item(tr('확대'),'reader-zoom-in'),item(tr('축소'),'reader-zoom-out'),item(tr('너비 맞춤'),'reader-fit'),
      line,
      item(tr('목차'),'reader-outline'),item(tr('쪽 미리보기'),'reader-thumbs'),
      line,
      item(tr('왼쪽 사이드바 접기·펴기'),'toggle-left'),item(tr('오른쪽 사이드바 접기·펴기'),'toggle-right'),
      line,
      {label:tr('화면 크게'),role:'zoomIn',accelerator:'CmdOrCtrl+Plus'},{label:tr('화면 작게'),role:'zoomOut'},{label:tr('화면 원래 크기'),role:'resetZoom'},
      line,
      {label:tr('전체 화면'),role:'togglefullscreen'},
      ...(development?[line,{label:tr('새로 고침 (개발)'),role:'reload'},{label:tr('개발자 도구'),role:'toggleDevTools'}]:[])]},
    {label:tr('자료(&L)'),submenu:[
      item(tr('라이브러리로 돌아가기'),'back'),item(tr('파일 목록 새로고침'),'refresh-vault','F5'),
      line,
      item(tr('서지정보 편집…'),'edit-bibliography'),item(tr('서지정보 자동 채우기'),'autofill-paper'),item(tr('인용 복사…'),'cite-paper'),
      line,
      item(tr('새 태그…'),'new-tag'),item(tr('AI 태그 추천…'),'tag-ai'),
      line,
      item(tr('중복 자료 후보…'),'duplicates'),item(tr('휴지통으로 이동…'),'trash-paper'),item(tr('삭제 (PDF 파일 포함)…'),'delete-paper')]},
    {label:tr('도움말(&H)'),submenu:[
      item(tr('단축키'),'shortcuts','F1',{shown:true}),
      line,
      item(tr('테마 폴더 열기'),'themes-open'),
      {label:tr('설정·기록 폴더 열기'),click:()=>shell.openPath(app.getPath('userData'))},
      line,
      // For asking for help: the app, the system and the latest errors, as text to paste. Nothing is sent.
      {label:tr('진단 정보 복사'),click:()=>{clipboard.writeText(diagnosticReport());dialog.showMessageBox(win,{type:'info',title:tr('진단 정보 복사'),message:tr('진단 정보를 복사했습니다.'),detail:tr('문의할 때 붙여 넣어 주세요. 앱 버전, 운영체제, 최근 오류 기록이 들어 있습니다.\n논문 내용, 메모, 폴더 경로, 키는 들어 있지 않으며 어디로도 자동으로 보내지 않습니다.'),buttons:[tr('확인')]});}},
      {label:tr('로그 폴더 열기'),click:async()=>{const dir=path.join(app.getPath('userData'),'logs');await fs.mkdir(dir,{recursive:true}).catch(()=>{});shell.openPath(dir);}},
      line,
      {label:tr('{app} 정보'),click:()=>dialog.showMessageBox(win,{type:'info',title:tr('{app} 정보'),message:`${appName.name} ${app.getVersion()}`,detail:`Electron ${process.versions.electron} · Chromium ${process.versions.chrome}\n${process.platform} ${os.release()} (${process.arch})`,buttons:[tr('확인')]})}]},
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
let windowSaved=false;
async function saveWindowPlace(){
  if(windowSaved||!win||win.isDestroyed()||!configFile)return;windowSaved=true;
  try{config={...config,window:{...win.getNormalBounds(),maximized:win.isMaximized()}};await atomicJson(configFile,config);}catch(error){console.error('창 위치 저장 실패:',error.message);} // i18n:keep — a line in the log, not on screen
}
function current(id) { if (!library || library.data.id !== id || closingVault === id) throw Object.assign(Error(tr('저장소가 변경되었습니다. 다시 시도하세요.')), { code: 'APP_VAULT_CHANGED' }); return library; }
// Closing is held back here, so the page never gets beforeunload: ask it to
// send ink and notebook changes it is still holding, for at most a few seconds.
function flushPage(target){if(!target||target.isDestroyed())return Promise.resolve();return Promise.race([target.webContents.executeJavaScript('globalThis.appFlushAll?.()',true).catch(()=>{}),new Promise(resolve=>setTimeout(resolve,5000))]);}
async function flushRenderer(){await flushPage(win);}
// What reloading the windows would cut off: a running translation, or an AI or figure request
// waiting for its model (one at a time each, held in insightController and figureController).
// A translation being started counts too: it is running by the time the reload would come.
let translationsStarting=0;
const modelBusy=()=>Boolean(figureController||insightController||translationsStarting>0||[...(translations?.jobs.values()||[])].some(job=>job.state==='running'));
// A new screen language reaches the windows by loading their pages again. As when a window closes,
// each page first sends what it still holds (memos, ink, notebooks) and the writes are let finish.
async function reloadWindows(){
  const targets=[win,...notebookWindows,...viewWindows].filter(target=>target&&!target.isDestroyed());
  await Promise.all(targets.map(flushPage));
  await queue.catch(()=>{});await translations?.writes?.catch?.(()=>{});await library?.ink?.idle();await library?.notebooks?.idle();
  for(const target of targets)if(!target.isDestroyed())target.webContents.reload();
}
// From an accepted change of screen language until the pages are told to load again, no translation,
// AI or figure request starts (modelBusy is asked only when the change is made, and the reload would
// cut off one started while the pages save). languageHolding covers the change being written.
let windowReload=null,languageHolding=0;
function notWhileReloading(){if(windowReload||languageHolding>0)throw Object.assign(Error(tr('화면 언어를 바꾸는 중입니다. 창을 다시 불러온 뒤 시도하세요.')),{code:'APP_BUSY'});}
// A change made while a reload waits for the pages joins it: the pages load once, in the newest language.
function reloadWindowsOnce(){return windowReload||=reloadWindows().finally(()=>{windowReload=null;});}
// The open vault's folder is watched: a change made outside the app reaches the window, which reads
// the vault again when that does not interrupt the reader (vault-watch.cjs). A snapshot made by
// reading the folder in full (refresh) records the tree it saw; one that only answers an edit does
// not, so a change made outside just before it is never taken for seen.
const vaultWatch=new VaultWatch({onProblem:record,onChange:root=>{if(library?.root===root&&closingVault!==library.data.id&&win&&!win.isDestroyed())win.webContents.send('vault-files-changed',library.data.id);}});
function watchVault(target){const snapshot=target.snapshot.bind(target);target.snapshot=async(...args)=>{if(args[0]?.refresh===false||library!==target)return snapshot(...args);const seen=vaultWatch.reading(),result=await snapshot(...args);seen();return result;};vaultWatch.start(target.root);}
async function closeVault(){vaultWatch.stop();figureController?.abort();insightController?.abort();if(releaseVault)closingVault=library?.data.id??null;await translations?.writes;await library?.ink?.idle();await library?.notebooks?.idle();if(!releaseVault)return;try{if(!await vaultGone())await library?.backup(tr('종료 시 백업'));}catch(error){console.error('종료 백업 실패:',error.message);}try{await releaseVault();}catch(error){console.error('저장소 잠금 해제 실패:',error.message);}finally{releaseVault=null;}} // i18n:keep — lines in the log, not on screen
async function connect(root) {
  root=await fs.realpath(root);
  if(library?.root===root){await library.assertUnchanged();return library.snapshot();}
  let release;
  try{release=await lockVault(root);}catch(error){
    // A cloud drive (Google Drive, Dropbox) can carry another computer's lease, left after a crash, to this one.
    // A lease of this computer that cannot be told from the app (another window of it, or one left after a crash whose
    // process id another program now has) is offered to be released too.
    if(error.code==='APP_LOCKED_HERE'){
      const decision=await dialog.showMessageBox(win,{type:'warning',buttons:[tr('취소'),tr('잠금 해제 후 열기')],defaultId:0,cancelId:0,message:error.message,detail:tr('이 컴퓨터에서 {app}가 비정상 종료한 뒤 남은 잠금일 수 있습니다. 다른 {app} 창에서 이 저장소를 쓰고 있지 않다면 잠금을 해제하고 열 수 있습니다. 둘이 함께 쓰면 변경이 덮어써질 수 있습니다.')});
      if(decision.response!==1)throw error;
      release=await lockVault(root,{takeOver:true});
    }else{
    if(error.code!=='APP_LOCKED_ELSEWHERE')throw error;
    const decision=await dialog.showMessageBox(win,{type:'warning',buttons:[tr('취소'),tr('잠금 해제 후 열기')],defaultId:0,cancelId:0,message:error.message,detail:error.host?tr('Google Drive·Dropbox 같은 공유 폴더의 저장소는 다른 컴퓨터의 잠금 파일도 함께 동기화됩니다. {host}에서 {app}를 종료했거나 그 컴퓨터가 꺼져 있다면 잠금을 해제하고 열 수 있습니다. 두 컴퓨터에서 동시에 열면 변경이 덮어써질 수 있습니다.',{host:error.host}):tr('Google Drive·Dropbox 같은 공유 폴더의 저장소는 다른 컴퓨터의 잠금 파일도 함께 동기화됩니다. 그 컴퓨터에서 {app}를 종료했거나 그 컴퓨터가 꺼져 있다면 잠금을 해제하고 열 수 있습니다. 두 컴퓨터에서 동시에 열면 변경이 덮어써질 수 있습니다.')});
    if(decision.response!==1)throw error;
    release=await lockVault(root,{takeOver:true});
    }
  }
  try{
    let next;
    try{next=await Library.open(root);}catch(error){
      if(error.code!=='APP_VAULT_DAMAGED')throw error;
      const directory=path.join(root,VAULT_DIR,'backups');
      try{if(await fs.realpath(directory)!==directory)throw error;const entries=await fs.readdir(directory);if(!entries.some(id=>/^\d+-[a-f0-9-]+\.json$/.test(id)))throw error;}catch{throw error;}
      const decision=await dialog.showMessageBox(win,{type:'warning',buttons:[tr('취소'),tr('백업 선택')],defaultId:0,cancelId:0,message:tr('저장소 메타데이터를 열 수 없습니다.'),detail:(error.conflict?tr('library.json에 git 병합 충돌 표시가 남아 있습니다.')+' ':'')+tr('백업으로 복구할 수 있습니다. 현재 메타데이터는 별도 파일로 보존합니다. PDF는 변경하지 않습니다.')});
      if(decision.response!==1)throw error;
      const choice=await dialog.showOpenDialog(win,{title:tr('복구할 백업 선택'),defaultPath:directory,properties:['openFile'],filters:[{name:tr('백업'),extensions:['json']}]});
      if(choice.canceled)throw error;
      const selected=await fs.realpath(choice.filePaths[0]);if(path.dirname(selected)!==directory)throw Error(tr('이 저장소의 backups 폴더에서 선택하세요.'));
      next=await Library.recover(root,path.basename(selected));
    }
    // A vault linked to a sync folder takes in other devices' changes first.
    let syncReport=null;if(config.sync?.[next.data.id]&&syncVault){try{syncReport=await syncVault(next);}catch(error){syncReport={error:error.message};}}
    // 그림 설명 memos become figure annotations (once; a backup is made first).
    let movedFigures=0;try{movedFigures=await next.migrateFigureMemos();}catch(error){console.error('figure memo migration',error);}
    // An earlier app's folder beside the new one, holding items the new app does not see: told once a run.
    oldVaultBeside(next.root).then(old=>{if(!old||toldOld.has('vault:'+next.root)||!win||win.isDestroyed())return;toldOld.add('vault:'+next.root);dialog.showMessageBox(win,{type:'info',buttons:[tr('확인')],message:old.folders.length>1?tr('이 저장소에는 이전 앱이 만든 {folders} 폴더들도 있습니다(자료 {n}개). 이전 앱에서 더한 자료는 {app}에 보이지 않습니다. 이전 앱은 닫고 {app}만 쓰세요.',{folders:old.folders.join(', '),n:old.papers}):tr('이 저장소에는 이전 앱이 만든 {folder} 폴더도 있습니다(자료 {n}개). 이전 앱에서 더한 자료는 {app}에 보이지 않습니다. 이전 앱은 닫고 {app}만 쓰세요.',{folder:old.folders[0],n:old.papers})}).catch(()=>{});}).catch(()=>{});
    const snapshot={...await next.snapshot({refresh:false}),syncReport,movedFigures};
    const recent={id:next.data.id,name:path.basename(next.root),root:next.root};
    const updated={...config,recents:[recent,...config.recents.filter(r=>r.root!==next.root)].slice(0,8)};
    await atomicJson(configFile,updated);translations?.stopAll();await closeVault();
    config=updated;library=next;releaseVault=release;closingVault=null;watchVault(next);if(win)buildMenu();return snapshot;
  }catch(error){await release();throw error;}
}
if(singleInstance)app.whenReady().then(async () => {
  configFile = path.join(app.getPath('userData'), 'settings.json');
  // An install already in use is told by its settings file being there, not by what the file holds.
  const existingInstall = await fs.access(configFile).then(()=>true,()=>false);
  // A settings file that cannot be read is set aside and the app starts from the defaults, saying so (settings-file.cjs);
  // missing parts (the recent vaults) are filled in.
  config = settingsShape(await readSettingsFile(configFile, { recents: [], provider: 'gpt', mode: 'web' }, startupNotices, 'settings'));
  // The language settings (desktop/language.cjs): config.language is what is stored; language is what is
  // in effect, which APP_UI_LANG may set for this run only (it is never written by itself).
  const systemLanguages = () => systemLanguagesFrom(process.env, () => app.getPreferredSystemLanguages());
  config = { ...config, language: Object.hasOwn(config, 'language') ? normalizeLanguage(config.language) : initialLanguage({ existingInstall, osLanguages: systemLanguages() }) };
  // A new install is asked for its display language at the start screen (language.cjs languageAskAtStart): the key is
  // in the settings until it is answered, and goes into the file with whatever setting is written next.
  { const { languageAsk: _asked, ...rest } = config; config = languageAskAtStart({ existingInstall, stored: config.languageAsk, override: process.env.APP_UI_LANG }) ? { ...rest, languageAsk: true } : rest; }
  language = startupLanguage(config.language, process.env.APP_UI_LANG); setUiLanguage(language.ui);
  // Asked synchronously by the preload, so the page's scripts know the language before they run.
  ipcMain.on('language-sync', event => { event.returnValue = allowedSender(event, 'language-sync') ? languageInfo(language, systemLanguages(), config.languageAsk === true) : null; });
  // The OS secure storage, through its asynchronous calls (the synchronous ones are deprecated).
  // Whether it can be used is asked once: it does not change while the app runs. What the earlier
  // calls encrypted is read by decryptStringAsync as it is.
  const secure = await safeStorage.isAsyncEncryptionAvailable().catch(()=>false) && (process.platform!=='linux'||safeStorage.getSelectedStorageBackend()!=='basic_text');
  const protect = text=>safeStorage.encryptStringAsync(text), unprotect = bytes=>safeStorage.decryptStringAsync(bytes);
  auth = new ChatGPT({ directory:app.getPath('userData'), fetch:(...args)=>net.fetch(...args), openBrowser:url=>shell.openExternal(url), protect, unprotect, persistent:()=>secure, notices:startupNotices });
  await auth.init();
  connections = new Connections(); connections.register(auth);
  const local = connections.register(new LocalLLM({ fetch:(...args)=>net.fetch(...args), settings:config.llm.local }));
  // API keys are encrypted like the ChatGPT session; without secure storage they last for this run only.
  const apiKeys = new ApiKeyStore({ file:path.join(app.getPath('userData'),'llm-keys.json'), protect, unprotect, persistent:()=>secure, notices:startupNotices });
  // The keys and tokens in memory, for the diagnostic record to take out of whatever it writes.
  heldSecrets=()=>[...apiKeys.keys.values(),...['access_token','refresh_token','id_token'].map(k=>auth?.profile?.[k])].filter(v=>typeof v==='string'&&v);
  await apiKeys.init();
  for (const Client of [OpenAIAPI, ClaudeAPI, GeminiAPI]) connections.register(new Client({ fetch:(...args)=>net.fetch(...args), keys:apiKeys }));
  // Other OpenAI-compatible providers the user added (settings.json llm.providers), each its own connection.
  const providerList = () => (Array.isArray(config.llm.providers) ? config.llm.providers : []).flatMap(p => { try { return [normalizeProvider(p)]; } catch { return []; } }).filter(p => /^custom-\d+$/.test(p.id||'')).slice(0, MAX_PROVIDERS);
  for (const provider of providerList()) connections.register(new CompatibleAPI({ fetch:(...args)=>net.fetch(...args), keys:apiKeys, provider }));
  const apiClient = id => { const client=connections.clients.get(id); if (!Object.hasOwn(KEY_PAGES, id) && !(client instanceof CompatibleAPI)) throw Error(tr('연결 방식을 확인하세요.')); return connections.get(id); };
  // Translation cache writes keep their own order (TranslationJobs.writes) instead of the
  // app-wide queue, where a handler waiting on a file dialog stalled every running translation.
  // They only replace .<id>/translation-* files atomically; backup, sync and merge refuse
  // to run while a job is running, and closing a vault waits for them.
  translations = new TranslationJobs(id => withGlossary(connections.get(id), () => library?.data.glossary));
  protocol.handle('app', async request => {
    try {
      const url = new URL(request.url); const parts = url.pathname.split('/').filter(Boolean);
      // app://note-image/<vault>/<name>: a picture saved with a memo.
      if (url.hostname === 'note-image' && parts.length === 2 && ['GET', 'HEAD'].includes(request.method)) { const file = await current(parts[0]).noteImagePath(parts[1]); return net.fetch(pathToFileURL(file).href, { method: request.method }); }
      if (url.hostname !== 'pdf' || parts.length !== 3 || !['GET', 'HEAD'].includes(request.method)) return new Response('Not found', { status: 404 });
      const file = await current(parts[0]).resolveFile(parts[1], parts[2]);
      return net.fetch(pathToFileURL(file).href, { method: request.method, headers: request.headers });
    } catch { return new Response('PDF is unavailable', { status: 404 }); }
  });
  win = new BrowserWindow({ ...windowPlace(config.window), minWidth: 800, minHeight: 600, title: appName.name, icon: path.join(__dirname, '..', 'dist', 'icon.png'), webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, plugins: true } });
  if(config.window?.maximized)win.maximize();
  watchWindow(win,'main');
  buildMenu();
  // Translation progress on the taskbar, and a system notification when a translation
  // ends while the window is in the background (설정에서 끌 수 있다).
  {
    const seen=new Map();let shown=-1;
    const watch=setInterval(()=>{
      if(!win||win.isDestroyed())return;
      const jobs=[...translations.jobs.values()],running=jobs.filter(job=>job.state==='running');
      const total=running.reduce((n,job)=>n+(job.total||0),0),done=running.reduce((n,job)=>n+(job.done||0),0);
      const progress=!running.length?-1:total?Math.min(1,done/total):2;
      if(progress!==shown){shown=progress;try{win.setProgressBar(progress);}catch{/* the window is closing */}}
      for(const job of jobs){
        const before=seen.get(job.id);seen.set(job.id,job.state);
        if(before!=='running'||!['completed','failed'].includes(job.state)||win.isFocused()||!features(config).notifications.enabled||!Notification.isSupported())continue;
        let title='';try{title=job.library.paper(job.paperId).title;}catch{/* the paper was deleted meanwhile: notified without its title */}
        const note=new Notification({title:job.state==='completed'?tr('번역을 마쳤습니다'):tr('번역이 멈췄습니다'),body:[title,String(job.message||'')].filter(Boolean).join('\n').slice(0,300)});
        note.on('click',()=>{if(win&&!win.isDestroyed()){if(win.isMinimized())win.restore();win.show();win.focus();}});note.show();
      }
      for(const id of seen.keys())if(!translations.jobs.has(id))seen.delete(id);
    },1000);
    app.on('will-quit',()=>clearInterval(watch));
  }
  win.webContents.on('did-start-navigation',(_event,_url,_inPlace,isMainFrame)=>{if(isMainFrame){translations.stopAll();figureController?.abort();}});
  const allowedPage = pathToFileURL(path.join(__dirname, '..', 'dist', 'index.html')).href;
  win.webContents.on('will-navigate', (event, url) => { if (url !== allowedPage) event.preventDefault(); });
  // 새 창에서 보기: the renderer opens a blank same-origin window and fills it itself (a memo, the
  // translation as shown). The window gets no preload, so it cannot call the app, and goes nowhere
  // else. (The original PDF has a window of the app's own reader: view-window.)
  win.webContents.setWindowOpenHandler(({ url, frameName }) => url === 'about:blank' && /^app-view-[-\w]{1,80}$/.test(frameName) ? { action: 'allow', overrideBrowserWindowOptions: { width: 900, height: 1000, minWidth: 360, minHeight: 300, autoHideMenuBar: true, webPreferences: { preload: undefined, contextIsolation: true, nodeIntegration: false, sandbox: true } } } : { action: 'deny' });
  win.webContents.on('did-create-window', child => {
    child.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    child.webContents.on('will-navigate', event => event.preventDefault());
  });
  win.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  let closing = false;
  win.on('close', event => {
    if (closing) return;
    event.preventDefault(); closing = true;connections.cancelAll();translations.stopAll();figureController?.abort();
    closeNotebookWindows().then(flushRenderer).then(()=>queue).finally(async () => { await saveWindowPlace();await closeVault();win.destroy(); app.quit(); });
  });
  // Esc leaves full screen (F11) when the page had no use for it (desktop/app.js): the window that asked, if it is full screen.
  ipcMain.handle('leave-full-screen', event => { if (!allowedSender(event, 'leave-full-screen')) return false; const w = BrowserWindow.fromWebContents(event.sender); if (!w || w.isDestroyed() || !w.isFullScreen()) return false; w.setFullScreen(false); return true; });
  // An error the page itself caught (window.onerror, an unhandled rejection): recorded, at most 30 a minute.
  {let count=0,since=0;register('page-error',(kind,message,stack)=>{const now=Date.now();if(now-since>60000){since=now;count=0;}if(++count>30)return;const error=Error(String(message??'').slice(0,2000));error.stack=typeof stack==='string'?'Error\n'+stack.slice(0,4000):'';record('page',error,String(kind||'').slice(0,40));},false);}
  register('bootstrap', () => ({ startupNotices:startupNotices.map(startupNotice), recents: recentList(), provider: 'gpt', mode: 'oauth', connection:config.llm.connection, models:config.llm.models, model:config.chatgptModel || '', auth:auth.status(), features:features(config), development }));
  // A change of language from the settings. Only the fields named change, in what is in effect and in
  // what is stored (so a APP_UI_LANG screen is not stored unless ui itself was chosen). Like every
  // other setting it goes into config first and config is written whole, so a write made meanwhile
  // keeps it. A new screen language rebuilds the menu and reloads the windows; it waits while a model
  // is at work. Changes are taken one at a time (their own chain, not the app-wide queue, which the reload waits for).
  let languageChange = Promise.resolve();
  register('set-language', patch => {
    const change = languageChange.then(async () => {
      const next = patchLanguage(language, patch), uiChanged = next.ui !== language.ui;
      if (uiChanged && modelBusy()) throw Object.assign(Error(tr('번역이나 AI 요청이 진행 중입니다. 끝나거나 중단한 뒤 화면 언어를 바꾸세요.')), { code: 'APP_BUSY' });
      // Saved first: only a change that reached the settings file is used, so a failed write changes nothing (the window
      // shows the error) and no request sees a language that was not kept. Other settings changed meanwhile stay.
      const stored = patchLanguage(config.language, patch);
      // A display language chosen (even the one in effect) answers the first start's question: the key leaves the
      // settings in the same write, and comes back if that write fails.
      const asked = config.languageAsk === true && Object.hasOwn(patch, 'ui');
      if (asked) { const { languageAsk: _asked, ...rest } = config; config = rest; }
      if (uiChanged) languageHolding++;
      try { await keepLanguage(stored, { get: () => config, set: value => { config = value; language = next; }, write: value => atomicJson(configFile, value), read: () => readJson(configFile, null), late: error => record('language-save', error) }); }
      catch (error) { if (asked) config = { ...config, languageAsk: true }; throw error; }
      finally { if (uiChanged) languageHolding--; }
      const info = languageInfo(language, systemLanguages(), config.languageAsk === true);
      // The screen language reloads every window; the other settings reach every open window as they are.
      if (uiChanged) { setUiLanguage(language.ui); buildMenu(); reloadWindowsOnce().catch(error => record('language-reload', error)); }
      else for (const target of [win, ...notebookWindows, ...viewWindows]) if (target && !target.isDestroyed()) target.webContents.send('language-changed', info);
      return info;
    });
    languageChange = change.catch(() => {}); return change;
  }, false);
  register('feature-set', async (name, on) => { config = setFeature(config, name, on); await atomicJson(configFile, config); return features(config); });
  register('dev-state', async()=>development&&library?{snapshot:await library.snapshot(),ui:devUI}:null);
  register('chatgpt-status', ()=>auth.status(), false);
  register('chatgpt-connect', ()=>auth.signIn(), false);
  register('chatgpt-cancel', ()=>auth.cancel(), false);
  register('chatgpt-disconnect', async()=>{translations.stopAll(auth.id);figureController?.abort();return auth.disconnect();}, false);
  register('chatgpt-models', ()=>auth.models(), false);
  register('llm-connections', ()=>[...connections.clients.values()].map(client=>({ ...client.status(), id:client.id, label:client.label, kind:client.kind })), false);
  register('llm-models', connection=>connections.get(connection).models(), false);
  // Checks the address in the form before it is saved; only lists models, no paper text.
  // The key check is a network round trip; it does not hold the app-wide queue.
  register('llm-key-save', (id, key)=>apiClient(id).setKey(key), false);
  register('llm-key-remove', async id=>{ const client=apiClient(id); translations.stopAll(id); return client.removeKey(); }, false);
  register('llm-key-page', id=>{ const client=apiClient(id), page=KEY_PAGES[id]||client.keyPage; if(!page)throw Error(tr('이 공급자의 키 발급 페이지를 알 수 없습니다. 공급자 사이트에서 발급하세요.')); return shell.openExternal(page); }, false);
  // Adding or editing a provider keeps it only after its address accepted the key (by listing models).
  register('llm-provider-save', async(raw,key)=>{
    const list=providerList(),editing=raw?.id?list.find(p=>p.id===raw.id):null;if(raw?.id&&!editing)throw Error(tr('공급자를 찾을 수 없습니다.'));
    if(!editing&&list.length>=MAX_PROVIDERS)throw Error(tr('기타 공급자는 {n}개까지 추가할 수 있습니다.',{n:MAX_PROVIDERS}));
    const id=editing?.id||`custom-${Math.max(0,...list.map(p=>Number(p.id.slice(7))))+1}`,provider=normalizeProvider({...raw,id});
    if(list.some(p=>p.id!==id&&p.name===provider.name))throw Error(tr('같은 이름의 공급자가 있습니다.'));
    if(editing&&[...translations.jobs.values()].some(job=>job.state==='running'&&job.connection===id))throw Error(tr('이 공급자로 번역하는 중에는 바꿀 수 없습니다.'));
    const client=new CompatibleAPI({ fetch:(...args)=>net.fetch(...args), keys:apiKeys, provider }),value=String(key??'').trim();
    if(value)await client.setKey(value);else if(editing&&apiKeys.get(id))await client.listModels(apiKeys.get(id));else throw Error(tr('API 키를 입력하세요.'));
    config={...config,llm:{...config.llm,providers:[...list.filter(p=>p.id!==id),provider]}};await atomicJson(configFile,config);
    connections.register(client);return client.status();
  }, false);
  register('llm-provider-presets', ()=>Object.entries(require('./api-llm.cjs').COMPATIBLE_PRESETS).map(([id,p])=>({id,name:p.name,url:p.url})), false);
  register('llm-provider-remove', async id=>{
    const client=apiClient(id);if(!(client instanceof CompatibleAPI))throw Error(tr('기본 공급자는 삭제할 수 없습니다. 키만 삭제하세요.'));
    translations.stopAll(id);await client.removeKey();connections.clients.delete(id);
    config={...config,llm:{...config.llm,providers:providerList().filter(p=>p.id!==id)}};await atomicJson(configFile,config);
  }, false);
  register('llm-local-check', settings=>new LocalLLM({ fetch:(...args)=>net.fetch(...args), settings:{ ...normalizeLocal(settings&&typeof settings==='object'?settings:{}), enabled:true, remoteConfirmed:true } }).check(), false);
  // A remote address is used only after the user confirmed sending paper text
  // there; the confirmation stays while the address stays the same.
  register('llm-local-save', async(settings,confirmRemote)=>{
    if([...translations.jobs.values()].some(job=>job.state==='running'&&job.connection==='local'))throw Error(tr('로컬 모델로 번역하는 중에는 설정을 바꿀 수 없습니다. 번역을 중단한 뒤 변경하세요.'));
    const candidate=normalizeLocal(settings&&typeof settings==='object'?settings:{}),kept=local.settings.remoteConfirmed&&local.settings.url===candidate.url;
    const next=normalizeLocal({...candidate,remoteConfirmed:confirmRemote===true||kept});
    if(next.enabled&&!isLoopback(next.url)&&!next.remoteConfirmed)return { ...local.status(), needsConfirm:true, host:new URL(next.url).host };
    config={...config,llm:{...config.llm,local:next}};await atomicJson(configFile,config);return local.configure(next);
  });
  register('figure-cancel',()=>figureController?.abort(),false);
  register('figure-explain',async(id,paperId,attachmentId,hash,model,image,context)=>{
    notWhileReloading();
    const target=current(id),client=connections.get(context?.connection);
    if(!client.status().usable)throw notConnected(client);
    if(typeof image!=='string'||image.length>8e6||!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(image))throw Error(tr('선택 이미지 크기나 형식을 확인하세요.'));
    if(!context||!Number.isInteger(context.page)||context.page<1||context.page>500||typeof context.question!=='string'||context.question.length>2000||typeof context.caption!=='string'||context.caption.length>6000)throw Error(tr('그림 설명 요청을 확인하세요.'));
    if(figureController)throw Error(tr('현재 그림 설명을 완료하거나 취소하세요.'));
    const controller=new AbortController();figureController=controller;
    try{
      if(!(await client.models()).some(m=>m.id===model))throw Error(tr('사용할 수 있는 모델을 선택하세요.'));
      if((await source(target,paperId,attachmentId)).hash!==hash)throw Error(tr('원문이 변경됐습니다. 다시 선택하세요.'));
      const result=await insight.withAiRules(client,target.data.aiRules).explainFigure(model,image,{title:target.paper(paperId).title,page:context.page,caption:context.caption,question:context.question},AbortSignal.any([controller.signal,AbortSignal.timeout(client.requestTimeout||120000)]),aiLanguage(language));
      controller.signal.throwIfAborted();current(id);
      if((await source(target,paperId,attachmentId)).hash!==hash)throw Error(tr('설명 중 원문이 변경됐습니다. 다시 선택하세요.'));
      return result;
    }finally{if(figureController===controller)figureController=null;}
  },false);
  // AI help runs only on an explicit request, one at a time, on the paper
  // version the renderer extracted; results are stored as drafts.
  // What a write over AI records git left conflict marks in left out (a side that could not be read, results past the
  // limit) goes to the diagnostic record as counts and the file's vault name, never its text.
  const conflictReport=info=>record('ai-records-conflict',Error(`${info.file}: ${info.results} results joined${info.unreadable?`, the ${info.unreadable} side could not be read`:''}${info.cut?`, ${info.cut} past the limit left out`:''}`));
  const insightsOf=target=>target.insights||=new insight.InsightStore(target,conflictReport);
  register('ai-run',async(id,paperId,attachmentId,kind,model,payload)=>{
    notWhileReloading();
    const target=current(id);if(!['summary','explain','ask'].includes(kind)||!payload||typeof payload!=='object')throw Error(tr('AI 요청을 확인하세요.'));
    const client=connections.get(payload.connection);if(!client.status().usable)throw notConnected(client);if(insightController)throw Error(tr('진행 중인 AI 요청을 완료하거나 취소하세요.'));
    const controller=new AbortController();insightController=controller;
    try{
      if(!(await client.models()).some(m=>m.id===model))throw Error(tr('사용할 수 있는 모델을 선택하세요.'));
      const hash=(await source(target,paperId,attachmentId)).hash;if(hash!==payload.sourceHash)throw Error(tr('원문이 변경됐습니다. 다시 열어 주세요.'));
      // The answer is kept in this paper's AI records: one that cannot be read is refused before the model is asked.
      await insightsOf(current(id)).list(paperId,attachmentId);
      const signal=AbortSignal.any([controller.signal,AbortSignal.timeout(client.requestTimeout||180000)]),input={title:target.paper(paperId).title,blocks:payload.blocks,selection:payload.selection,page:payload.page,question:payload.question,language:aiLanguage(language)};
      const result=await (kind==='summary'?insight.summarize:kind==='explain'?insight.explain:insight.ask)(insight.withAiRules(client,target.data.aiRules),model,input,signal);
      controller.signal.throwIfAborted();return insightsOf(current(id)).add(paperId,attachmentId,result,{connection:client.id,model,sourceHash:hash});
    }finally{if(insightController===controller)insightController=null;}
  },false);
  // A comparison is kept in the vault, not under one paper.
  register('ai-compare',async(id,model,items,question,connection)=>{
    notWhileReloading();
    const target=current(id);if(!Array.isArray(items)||items.length<2||items.length>5)throw Error(tr('비교할 자료를 2~5개 선택하세요.'));
    const client=connections.get(connection);if(!client.status().usable)throw notConnected(client);if(insightController)throw Error(tr('진행 중인 AI 요청을 완료하거나 취소하세요.'));
    const controller=new AbortController();insightController=controller;
    try{
      if(!(await client.models()).some(m=>m.id===model))throw Error(tr('사용할 수 있는 모델을 선택하세요.'));
      const papers=[];for(const item of items){const hash=(await source(target,item.paperId,item.attachmentId)).hash;if(hash!==item.sourceHash)throw Error(tr('원문이 변경됐습니다. 다시 시도하세요.'));papers.push({paperId:item.paperId,attachmentId:item.attachmentId,title:target.paper(item.paperId).title,blocks:item.blocks});}
      await readAiRecords(path.join(target.root,VAULT_DIR,'ai','comparisons.json')); // refused before the model is asked, as for ai-run
      const result=await insight.compare(insight.withAiRules(client,target.data.aiRules),model,{papers,question,language:aiLanguage(language)},AbortSignal.any([controller.signal,AbortSignal.timeout(client.requestTimeout||240000)]));
      controller.signal.throwIfAborted();
      result.papers=result.papers.map((p,i)=>({...p,attachmentId:items[i].attachmentId,sourceHash:items[i].sourceHash}));
      const file=path.join(target.root,VAULT_DIR,'ai','comparisons.json'),read=await readAiRecords(file),data=read.data,saved={id:require('node:crypto').randomUUID(),createdAt:new Date().toISOString(),connection:client.id,model,...result};
      data.results.unshift(saved);const cut=Math.max(0,data.results.length-100);data.results=data.results.slice(0,100);if(read.conflicted!==undefined){await keepConflictCopy(target.root,file);if(read.joined.unreadable||cut)conflictReport({...read.joined,cut});}await atomicJson(file,data);return saved;
    }finally{if(insightController===controller)insightController=null;}
  },false);
  register('ai-memo',async(id,paperId,model,payload)=>{
    notWhileReloading();
    const target=current(id);if(!payload||typeof payload!=='object')throw Error(tr('AI 요청을 확인하세요.'));
    const client=connections.get(payload.connection);if(!client.status().usable)throw notConnected(client);if(insightController)throw Error(tr('진행 중인 AI 요청을 완료하거나 취소하세요.'));
    const controller=new AbortController();insightController=controller;
    try{
      if(!(await client.models()).some(m=>m.id===model))throw Error(tr('사용할 수 있는 모델을 선택하세요.'));
      const mode=payload.mode==='ask'?'ask':'edit';
      const result=await insight.memoAssist(insight.withAiRules(client,target.data.aiRules),model,{mode,title:target.paper(paperId)?.title||'',section:payload.section,memo:payload.memo,instruction:payload.instruction,selection:payload.selection,page:payload.page,images:payload.images,context:payload.context==='ai-result'?'ai-result':undefined,answerLanguage:typeof payload.answerLanguage==='string'?payload.answerLanguage:undefined},AbortSignal.any([controller.signal,AbortSignal.timeout(client.requestTimeout||180000)]));
      controller.signal.throwIfAborted();return result;
    }finally{if(insightController===controller)insightController=null;}
  },false);
  // AI 태그 추천: tags for one paper from its opening pages and the vault's own tags. Only
  // suggestions come back; the page adds the ones the user keeps (batch-update addTags).
  register('ai-tags',async(id,paperId,attachmentId,model,payload)=>{
    notWhileReloading();
    const target=current(id);if(!payload||typeof payload!=='object')throw Error(tr('AI 요청을 확인하세요.'));
    const client=connections.get(payload.connection);if(!client.status().usable)throw notConnected(client);if(insightController)throw Error(tr('진행 중인 AI 요청을 완료하거나 취소하세요.'));
    const controller=new AbortController();insightController=controller;
    try{
      if(!(await client.models()).some(m=>m.id===model))throw Error(tr('사용할 수 있는 모델을 선택하세요.'));
      if((await source(target,paperId,attachmentId)).hash!==payload.sourceHash)throw Error(tr('원문이 변경됐습니다. 다시 열어 주세요.'));
      const paper=target.paper(paperId),existing=[...new Set([...Object.keys(target.data.tagColors||{}),...target.data.papers.filter(p=>!p.trashedAt).flatMap(p=>p.tags||[])])];
      const result=await insight.suggestTags(client,model,{title:paper.title,blocks:payload.blocks,existing,current:paper.tags||[],language:aiLanguage(language)},AbortSignal.any([controller.signal,AbortSignal.timeout(client.requestTimeout||120000)]));
      controller.signal.throwIfAborted();current(id);return {...result,connection:client.id,model};
    }finally{if(insightController===controller)insightController=null;}
  },false);
  register('ai-cancel',()=>insightController?.abort(),false);
  register('ai-list',(id,paperId,attachmentId)=>insightsOf(current(id)).list(paperId,attachmentId),false);
  register('ai-adopt',(id,paperId,attachmentId,resultId,text)=>insightsOf(current(id)).adopt(paperId,attachmentId,resultId,text));
  register('ai-follow-up',(id,paperId,attachmentId,resultId,entry)=>insightsOf(current(id)).followUp(paperId,attachmentId,resultId,entry));
  register('ai-remove',(id,paperId,attachmentId,resultId)=>insightsOf(current(id)).remove(paperId,attachmentId,resultId));
  // A cheap check whether the PDF on disk is still the one the page has open.
  register('original-hash',async(id,paperId,attachmentId)=>{const target=current(id);return target.hashFile(await target.resolveFile(paperId,attachmentId?'attachment-'+attachmentId:'original'));},false);
  register('read-original', async(id,paperId,attachmentId)=>{const data=await source(current(id),paperId,attachmentId);return {bytes:new Uint8Array(data.bytes),hash:data.hash};});
  register('translation-resume', (id,paperId,attachmentId)=>translations.resume(current(id),paperId,attachmentId));
  const correctionsOf=target=>target.corrections||=new CorrectionStore(target);
  // The ink revision names the AI record; corrections are laid over it.
  // A stored translation's revision hashes its whole content; it is reused
  // while the cache file's size and modification time stay the same.
  const revisions=new Map();
  async function cachedTranslation(target,paperId,attachmentId){
    const file=translations.file(target,paperId,attachmentId),stamp=async()=>{const info=await fs.stat(file).catch(()=>null);return info&&info.size+':'+info.mtimeMs;};
    const before=await stamp(),record=await translations.cached(target,paperId,attachmentId);if(!record)return {record:null,revision:null};
    const known=revisions.get(file);if(before&&known?.stamp===before)return {record,revision:known.revision};
    const revision=renderRevision(record);if(before&&before===await stamp())revisions.set(file,{stamp:before,revision});return {record,revision};
  }
  register('translation-cached', async(id,paperId,attachmentId)=>{const target=current(id),{record,revision}=await cachedTranslation(target,paperId,attachmentId);return record&&{...await correctionsOf(target).apply(paperId,attachmentId,record),renderRevision:revision};});
  register('correction-get',async(id,paperId,attachmentId,blockId)=>(await correctionsOf(current(id)).read(paperId,attachmentId)).entries[blockId]||null,false);
  register('correction-set',(id,paperId,attachmentId,blockId,value)=>correctionsOf(current(id)).set(paperId,attachmentId,blockId,value));
  register('correction-remove',(id,paperId,attachmentId,blockId)=>correctionsOf(current(id)).remove(paperId,attachmentId,blockId));
  register('translation-start', async(id,paperId,hash,pages,model,options)=>{
    notWhileReloading();
    // Every translation starts here: none before the result language is known (asked once under an English screen, DEVELOPMENT.md 언어 설정).
    // The translation itself is still always into Korean (core/translation-core.cjs TARGET), the one language offered.
    if(translationLanguage(language,systemLanguages()).ask)throw Object.assign(Error(tr('번역 결과 언어를 먼저 고르세요.')),{code:'APP_TRANSLATION_LANGUAGE'});
    const target=current(id);
    // The vault's requests (저장소 관리, kept) and this translation's own (번역 창, never saved: they live in the job only).
    const once=typeof options?.extraRules==='string'?options.extraRules.trim().slice(0,2000):'',kept=target.data.translationRules||'';
    const rules=[kept,once&&(kept?'이번 번역에만: ':'')+once].filter(Boolean).join('\n'); // i18n:keep — part of the translation request sent to the model (left as written)
    // This translation's reference images (번역 창): checked in translations.start, kept in the job only.
    const images=Array.isArray(options?.extraImages)?options.extraImages:[];
    translationsStarting++;let job;
    try{job=await translations.start(target,paperId,hash,pages,model,{...options,extraRules:undefined,extraImages:undefined,rules,images});}finally{translationsStarting--;}
    config=rememberModel(config,job.connection,model);await atomicJson(configFile,config);return job;
  });
  register('translation-append', (id,pageNumber,page,context)=>{const job=translations.jobs.get(id);if(!job)throw Error(tr('번역 작업을 찾을 수 없습니다.'));current(job.libraryId);return translations.append(id,pageNumber,page,context);});
  register('translation-prioritize', (id,pageNumber)=>translations.prioritize(id,pageNumber),false);
  register('translation-seal', id=>translations.seal(id));
  register('translation-job', (id,revision)=>translations.result(id,revision),false);
  register('translation-cancel', id=>translations.cancel(id),false);
  register('translation-export', async(id,paperId,images,attachmentId,mode='layout',layoutPlan,options={})=>{
    if(translating(id,[paperId]))throw Error(tr('번역 완료 후 PDF를 저장하세요.'));
    const target=current(id);let {record:cached,revision:cachedRevision}=await cachedTranslation(target,paperId,attachmentId);
    // A translation that carries ink is exported from its kept base, never re-translated.
    const revision=typeof options?.revision==='string'?options.revision:cachedRevision;
    if(revision&&revision!==cachedRevision){const base=await inkOf(target).translationBase(target.attachment(paperId,attachmentId).id,revision);if(!base||base.sourceHash!==(await source(target,paperId,attachmentId)).hash)throw Error(tr('필기한 번역 바탕을 찾을 수 없습니다.'));cached=base;}
    if(!cached)throw Error(tr('저장할 번역이 없습니다. 먼저 앱에서 번역하세요.'));
    cached=await correctionsOf(target).apply(paperId,attachmentId,cached);
    // On request, untranslated paragraphs print as their source and are listed.
    const keptSource=[];
    if(options?.allowMissing===true)cached={...cached,pages:cached.pages.map((page,index)=>page&&{...page,blocks:page.blocks.map(b=>{if(b.translation?.trim()&&!b.missingTranslation)return b;if(!formulaOnly(b))keptSource.push({page:index+1,text:b.text});return {...b,translation:b.text,missingTranslation:false};})})};
    const flowed=repairPages(applyFlow(cached.pages)),outputPages=layoutPlan?applyLayoutPlan(flowed,layoutPlan):flowed;
    // The words the saved PDF carries are in the translation's language; its dialogs and errors in the screen's.
    const language=cached.language||'ko';
    let html=exportHtml(outputPages,images,mode,language);
    if(keptSource.length){html=html.replace('</body>',()=>`<section class="missing-list" style="break-before:page;page:missing;padding:40px;font:11pt/1.5 'Noto Sans KR',sans-serif"><style>@page missing{size:A4;margin:18mm}</style><h2>${escapeHtml(trIn(language,'번역되지 않은 문단 {n}개',{n:keptSource.length}))}</h2><p>${escapeHtml(trIn(language,'아래 문단은 이 PDF에 원문 그대로 실었습니다. 앱에서 해당 페이지를 다시 번역할 수 있습니다.'))}</p><ol>${keptSource.map(m=>`<li><b>${escapeHtml(trIn(language,'{n}쪽',{n:m.page}))}</b> ${escapeHtml(m.text.slice(0,300))}</li>`).join('')}</ol></section></body>`);}
    const ink=options?.includeInk===true&&mode==='layout'?await inkOf(target).snapshot(paperId,attachmentId,'t-'+revision):null;
    if(ink?.strokes.length)html=inkedHtml(html,outputPages,ink);
    html=await inlineFonts(html);
    const paper=target.data.papers.find(p=>p.id===paperId);
    const choice=await dialog.showSaveDialog(win,{title:tr('번역 PDF 저장'),defaultPath:paper.title.replace(/[<>:"/\\|?*]/g,'_')+'-'+(LANGUAGES[language]||LANGUAGES.ko).name+'.pdf',filters:[{name:'PDF',extensions:['pdf']}]});
    if(choice.canceled)return false;
    const prepare=`(${preparePrintDocument.toString()})(${backgroundSample.toString()},${emphasis.toString()},${JSON.stringify({body:MIN_FIT,line:MIN_FIT_LINE,tail:TAIL_FIT,hard:HARD_FIT})},${JSON.stringify(printText(language))})`;
    const {bytes,prepared:adjustments}=await printPdf(html,{prepare});
    await fs.writeFile(choice.filePath,bytes);return {saved:true,adjustedPages:adjustments.map(a=>a.page),addedPages:adjustments.reduce((n,a)=>n+a.addedPages,0),inkStrokes:ink?.strokes.length||0,keptSource:keptSource.length};
  });
  // Ink keeps its own write chain; it never queues behind translation or export.
  register('ink-load',(id,paperId,attachmentId,surface)=>inkOf(current(id)).load(paperId,attachmentId,surface),false);
  register('ink-apply',async(id,paperId,attachmentId,surface,ops)=>{await transferWait(id);const target=current(id);const result=await inkOf(target).apply(paperId,attachmentId,surface,ops,()=>translations.cached(target,paperId,attachmentId));if(ops?.some?.(op=>op?.stroke?.tool==='text'||op?.type!=='add'))contentChanged(target,[paperId]);return result;},false);
  register('ink-surfaces',(id,paperId,attachmentId)=>inkOf(current(id)).surfaces(paperId,attachmentId),false);
  register('ink-base',async(id,paperId,attachmentId,revision)=>{const target=current(id),base=await inkOf(target).translationBase(target.attachment(paperId,attachmentId).id,revision);if(!base||base.sourceHash!==(await source(target,paperId,attachmentId)).hash)return null;return {...base,renderRevision:revision};},false);
  register('ink-export-original',async(id,paperId,attachmentId,includeInk,shownMarks)=>{
    const target=current(id),data=await source(target,paperId,attachmentId),attachment=target.attachment(paperId,attachmentId);
    const ink=includeInk===true?await inkOf(target).snapshot(paperId,attachmentId,'original'):null;
    if(ink?.stale)throw Error(tr('원문 파일이 바뀌어 이전 필기를 합칠 수 없습니다.'));
    // The figure boxes and annotation underlines shown on the original go with its ink only (checked, odd ones left out).
    // Without ink the saved file is the source PDF byte for byte.
    // Named -필기 only when something went in (strokes or marks on pages the file has); otherwise the source byte for byte.
    const marks=ink?cleanMarks(shownMarks):{boxes:[],underlines:[]},wanted=(ink?.strokes.length||0)+marks.boxes.length+marks.underlines.length>0;
    const bytes=wanted?await inkedOriginal(data.bytes,ink,marks):data.bytes,added=bytes.added||{strokes:0,marks:0},inked=added.strokes+added.marks>0;
    const choice=await dialog.showSaveDialog(win,{title:tr('원문 PDF 저장'),defaultPath:attachment.name.replace(/\.pdf$/i,'').replace(/[<>:"/\\|?*]/g,'_')+(inked?tr('-필기',null,'file name'):'')+'.pdf',filters:[{name:'PDF',extensions:['pdf']}]});
    if(choice.canceled)return false;
    if(path.resolve(choice.filePath)===path.resolve(await target.resolveFile(paperId,'attachment-'+attachment.id)))throw Error(tr('원본 PDF를 덮어쓸 수 없습니다. 다른 이름으로 저장하세요.'));
    await fs.writeFile(choice.filePath,bytes);return {saved:true,inkStrokes:added.strokes,marks:added.marks};
  });
  register('choose-storage', async () => {
    const result = await dialog.showOpenDialog(win, { title: tr('저장소로 연결할 폴더'), properties: ['openDirectory', 'createDirectory'] });
    if (result.canceled) return null; return connect(result.filePaths[0]);
  });
  // Only the list entry goes; the vault folder is not touched.
  register('remove-recent', async key => { const gone = recentFor(key); config = { ...config, recents: config.recents.filter(r => r !== gone) }; await atomicJson(configFile, config); buildMenu(); return recentList(); }, false);
  // A vault folder or PDF in the system file manager, or its full path for copying (inside the vault only).
  register('reveal-path', async (id, target, copy) => {
    const vault = current(id); let place;
    if (target?.paperId !== undefined) place = await vault.resolveFile(target.paperId, 'attachment-' + target.attachmentId);
    else place = target?.folder ? await vault.directory(target.folder) : vault.root;
    if (copy) { clipboard.writeText(place); return place; }
    if (target?.paperId !== undefined) shell.showItemInFolder(place); else { const error = await shell.openPath(place); if (error) throw Error(error); }
    return place;
  }, false);
  register('open-recent', async key => {
    const recent = recentFor(key); if (!recent) throw Error(tr('최근 저장소가 없습니다.'));
    // A folder moved or on a drive taken out: said in words, with the way out (the list keeps it until it is taken off).
    await fs.stat(recent.root).catch(error => {
      if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') throw Object.assign(Error(tr("저장소 폴더를 찾을 수 없습니다: '{name}' ({where}). 폴더를 옮겼거나 드라이브가 빠졌다면 다시 연결한 뒤 여세요. 더 쓰지 않는 저장소라면 최근 목록에서 지우세요.", { name: recent.name, where: recentWhere(recent.root) })), { code: 'APP_RECENT_MISSING', cause: error });
    });
    return connect(recent.root);
  });
  register('import-files', async (id, translatedId, folder) => {
    const target = current(id);
    const result = await dialog.showOpenDialog(win, { title: translatedId ? tr('번역 PDF 가져오기') : tr('{vault}에 파일 추가',{vault:path.basename(target.root)}), properties: translatedId ? ['openFile'] : ['openFile', 'multiSelections'], filters: [{ name: 'PDF', extensions: ['pdf'] }] });
    if (result.canceled) return null;
    // PDFs the vault already has are held back and named, so the page can ask (open the item, or add anyway).
    const duplicates = translatedId ? [] : await target.knownCopies(result.filePaths), held = new Set(duplicates.map(d => d.file));
    return { results: await target.importFiles(result.filePaths.filter(file => !held.has(file)), translatedId, folder), snapshot: await target.snapshot({refresh:false}), duplicates };
  });
  register('import-dropped-files', async (id, files, folder, allowDuplicates) => {
    const target = current(id);
    if (!Array.isArray(files) || !files.length || files.length > 100 || files.some(file => typeof file !== 'string' || !path.isAbsolute(file))) throw Error(tr('한 번에 최대 100개의 파일을 추가할 수 있습니다.'));
    const duplicates = allowDuplicates === true ? [] : await target.knownCopies(files), held = new Set(duplicates.map(d => d.file));
    return { results: await target.importFiles(files.filter(file => !held.has(file)), null, folder), snapshot: await target.snapshot({refresh:false}), duplicates };
  });
  register('attach-dropped-files',async(id,paperId,files,folder)=>{const target=current(id);target.paper(paperId);if(!Array.isArray(files)||!files.length||files.length>100||files.some(file=>typeof file!=='string'||!path.isAbsolute(file)))throw Error(tr('한 번에 최대 100개의 파일을 첨부할 수 있습니다.'));return {results:await target.importPDFs(files,{paperId,role:'supplement',folder}),snapshot:await target.snapshot({refresh:false})};});
  register('attach-files',async(id,paperId,role,folder)=>{const target=current(id);target.paper(paperId);const choice=await dialog.showOpenDialog(win,{title:tr('자료에 PDF 첨부'),properties:['openFile','multiSelections'],filters:[{name:'PDF',extensions:['pdf']}]});if(choice.canceled)return null;return {results:await target.importPDFs(choice.filePaths,{paperId,role,folder}),snapshot:await target.snapshot({refresh:false})};});
  register('primary-attachment',async(id,paperId,attachmentId)=>{const target=current(id);await target.setPrimary(paperId,attachmentId);return target.snapshot({refresh:false});});
  register('create-collection',async(id,name,parentId=null)=>{requireFeature('collections');const target=current(id);await target.createCollection(name,parentId);return target.snapshot({refresh:false});});
  // Device-local and outside the vault, so indexing never blocks vault writes.
  const textIndex=()=>fullText ||= new FullText(path.join(app.getPath('userData'),'fulltext'));
  // What search finds in text boxes and notebooks (content-index.cjs): all of a vault's on request, and a paper's again,
  // pushed to the window, shortly after its ink or a notebook of it is saved (here, or in a notebook window).
  const contentIndex=new ContentIndex(path.join(app.getPath('userData'),'content-index')),contentWaiting=new Map();
  const contentParts=(target,only)=>contentIndex.parts(target,inkOf(target),notebooksOf(target),only);
  contentChanged=(target,paperIds)=>{const key=target.data.id,entry=contentWaiting.get(key)||{ids:new Set(),all:false};if(paperIds)for(const id of paperIds)entry.ids.add(Number(id));else entry.all=true;clearTimeout(entry.timer);
    entry.timer=setTimeout(async()=>{contentWaiting.delete(key);try{if(library?.data.id!==key)return;const ids=entry.all?null:[...entry.ids],{papers}=await contentParts(target,ids);if(win&&!win.isDestroyed())win.webContents.send('content-parts',key,papers,ids);}catch(error){console.error('content index',error);}},300);contentWaiting.set(key,entry);};
  register('content-parts',(id,paperIds)=>contentParts(current(id),Array.isArray(paperIds)?paperIds:null),false);
  register('fulltext-targets',id=>textIndex().targets(current(id)),false);
  register('fulltext-store',(hash,pages)=>textIndex().store(hash,pages),false);
  register('fulltext-search',(id,query)=>textIndex().search(current(id),query),false);
  register('move-collection',async(id,collectionId,parentId)=>{requireFeature('collections');const target=current(id);await target.moveCollection(collectionId,parentId||null);return target.snapshot({refresh:false});});
  register('tag-color',async(id,tag,color)=>{const target=current(id);await target.setTagColor(tag,color);return target.snapshot({refresh:false});});
  register('tag-create',async(id,name,color)=>{const target=current(id);await target.createTag(name,color);return target.snapshot({refresh:false});});
  register('tag-rename',async(id,from,to)=>{const target=current(id),result=await target.renameTag(from,to);return {result,snapshot:await target.snapshot({refresh:false})};});
  register('tag-delete',async(id,tag)=>{const target=current(id),result=await target.deleteTag(tag);return {result,snapshot:await target.snapshot({refresh:false})};});
  register('glossary-save',async(id,list)=>{const target=current(id);await target.setGlossary(list);return target.snapshot({refresh:false});});
  // A record made from a reviewed DOI lookup, with no PDF yet.
  register('create-paper',async(id,fields)=>{const target=current(id),[paperId]=await target.importBibliography(JSON.stringify([{id:'',type:fields?.type,title:fields?.title,author:fields?.creators,issued:fields?.date?{'date-parts':[String(fields.date).split('-').map(Number)]}:undefined,'container-title':fields?.journal,volume:fields?.volume,issue:fields?.issue,page:fields?.pages,publisher:fields?.publisher,ISBN:fields?.isbn,ISSN:fields?.issn,DOI:fields?.doi,URL:fields?.url,abstract:fields?.abstract}]),'doi.json');return {paperId,snapshot:await target.snapshot({refresh:false})};});
  register('save-search',async(id,search)=>{const target=current(id);await target.saveSearch(search);return target.snapshot({refresh:false});});
  register('delete-search',async(id,searchId)=>{const target=current(id);await target.deleteSearch(searchId);return target.snapshot({refresh:false});});
  register('batch-update',async(id,ids,patch)=>{if(patch?.addCollection!==undefined||patch?.removeCollection!==undefined)requireFeature('collections');const target=current(id);await target.batchUpdate(ids,patch||{});return target.snapshot({refresh:false});});
  register('duplicates',id=>current(id).duplicates());
  // Every group of duplicate candidates becomes one item (the one registered first), after one
  // backup. A group with a paper being translated, or one that fails, is left and counted.
  register('merge-all-duplicates',async id=>{
    const target=current(id),groups=await target.duplicateGroups(),report={groups:groups.length,merged:0,items:0,removed:0,keptBoth:0,skipped:0,failed:[]};
    if(groups.length)await target.backup(tr('중복 자료 전체 병합 전'));
    for(const group of groups){
      if(translating(id,[group.target,...group.sources])){report.skipped++;continue;}
      try{for(const source of group.sources){await target.mergePapers(group.target,source,{backup:false});await notebooksOf(target).reassign(Number(source),Number(group.target));report.items++;report.removed+=target.lastMerge?.removed||0;report.keptBoth+=target.lastMerge?.keptBoth||0;}report.merged++;}
      catch(error){report.failed.push(String(error?.message||error).slice(0,200));}
    }
    return {...await target.snapshot({refresh:false}),mergeAllReport:report};
  });
  register('merge-papers',async(id,targetId,sourceId)=>{if(translating(id,[Number(targetId),Number(sourceId)]))throw Error(tr('번역을 완료하거나 중단한 뒤 병합하세요.'));const target=current(id);await target.mergePapers(targetId,sourceId);await notebooksOf(target).reassign(Number(sourceId),Number(targetId));return {...await target.snapshot({refresh:false}),mergeReport:target.lastMerge||null};});
  register('add-annotation',async(id,paperId,attachmentId,value)=>{const target=current(id);await target.addAnnotation(paperId,attachmentId,value);return target.snapshot({refresh:false});});
  register('note-image-save',(id,dataUrl)=>current(id).saveNoteImage(dataUrl));
  register('translation-rules-save',async(id,text)=>{const target=current(id);await target.setTranslationRules(text);return target.snapshot({refresh:false});});
  register('ai-rules-save',async(id,text)=>{const target=current(id);await target.setAiRules(text);return target.snapshot({refresh:false});});
  register('rename-folder',async(id,folder,name)=>{const target=idleVault(id),next=await target.renameFolder(folder,name);return {folder:next,snapshot:await target.snapshot({refresh:false})};});
  register('create-folder',async(id,parent,name)=>{const target=current(id),folder=await target.createFolder(parent,name);return {folder,snapshot:await target.snapshot({refresh:false})};});
  register('refresh-storage',id=>current(id).snapshot());
  register('update-paper', async (id, paperId, patch) => { await current(id).update(paperId, patch); });
  const idleVault=id=>{const target=current(id);if(translating(id))throw Error(tr('번역을 완료하거나 중단한 뒤 변경하세요.'));return target;};
  // The lookup services ask a caller that comes too often to wait (429, often with Retry-After):
  // the request is made once more after that wait (2 to 15 seconds). A second refusal is an error,
  // and the page then leaves the remaining items for the next time the vault opens.
  const fetchJson=async(url,notFound,again=true)=>{const response=await net.fetch(url,{redirect:'error',signal:AbortSignal.timeout(20000),headers:{Accept:'application/json'}});if(response.status===404)throw Object.assign(Error(notFound),{notFound:true});
    if(response.status===429&&again){const asked=Number(response.headers.get('retry-after'));await new Promise(resolve=>setTimeout(resolve,Math.min(15,Math.max(2,Number.isFinite(asked)?asked:5))*1000));return fetchJson(url,notFound,false);}
    if(!response.ok)throw Object.assign(Error(tr('서지정보 조회 실패 ({status})',{status:response.status})),{status:response.status});return response.json();};
  const crossrefLookup=async doi=>crossrefMetadata((await fetchJson('https://api.crossref.org/works/'+encodeURIComponent(doi),tr('해당 DOI의 서지정보를 찾지 못했습니다.'))).message);
  const dataciteLookup=async doi=>dataciteMetadata({...(await fetchJson('https://api.datacite.org/dois/'+doi.split('/').map(encodeURIComponent).join('/'),tr('해당 DOI의 서지정보를 찾지 못했습니다.'))).data?.attributes,doi});
  // A DOI is looked up in Crossref, then DataCite (arXiv, Zenodo and other repositories).
  async function doiLookup(doi){try{return await crossrefLookup(doi);}catch(error){if(!error.notFound)throw error;return dataciteLookup(doi);}}
  // Without a DOI: Crossref's best match for the title (and first author), taken only for a near-identical title.
  async function titleSearch(clue){
    const first=(Array.isArray(clue.authors)?clue.authors[0]:String(clue.authors||'').split(';')[0])||'',query=`${clue.title} ${first}`.trim().slice(0,300);
    const best=bestTitleMatch((await fetchJson('https://api.crossref.org/works?rows=5&query.bibliographic='+encodeURIComponent(query),'')).message?.items,clue);
    return best?{...crossrefMetadata(best.item),doi:normalizeDOI(best.item.DOI)}:null;
  }
  register('lookup-doi',value=>doiLookup(normalizeDOI(value)),false);
  // Pages whose text is a picture are read by local OCR (desktop/ocr.cjs), off the serial queue.
  const ocr=new PageOcr({directory:app.getPath('userData')});ocrReader=ocr;
  register('ocr-page',(key,png)=>ocr.recognize(key,png instanceof Uint8Array?png:new Uint8Array(png||[])),false);
  // An item's empty fields (a title that is still the file's own name counts as
  // empty) are filled from the first that answers: its DOI (Crossref, then
  // DataCite), a Crossref title search, then the PDF's own information. Only
  // the DOI, or the title and first author, leave the computer.
  register('autofill-bibliography',async(id,paperId,input)=>{
    const clue=typeof input==='string'?{doi:input}:input&&typeof input==='object'?input:{},target=current(id),paper=target.data.papers.find(p=>p.id===paperId);if(!paper)throw Error(tr('항목을 찾을 수 없습니다.'));
    let doi=null;for(const value of [clue.doi,paper.doi])if(!doi&&value)try{doi=normalizeDOI(String(value));}catch{/* not a DOI: the next clue is tried */}
    let metadata=null,source='';
    if(doi)try{metadata={...await doiLookup(doi),doi};source='doi';}catch(error){if(!error.notFound)throw error;}
    if(!metadata&&typeof clue.title==='string'&&clue.title.trim().length>=10){const found=await titleSearch({...clue,title:clue.title.trim().slice(0,300)});if(found){metadata=found;source='title';}}
    if(!metadata){const own=pdfOwnMetadata(clue);if(Object.keys(own).length){metadata=own;source='pdf';}}
    if(!metadata)return {filled:[],conflicts:0,source:''};
    const named=paper.attachments.some(a=>a.name&&paper.title===a.name.replace(/\.pdf$/i,''));
    const {fill,conflicts}=compareMetadata({...paper,...(named?{title:''}:{})},metadata);
    if(Object.keys(fill).length)await target.update(paperId,fill);
    return {filled:Object.keys(fill),conflicts:conflicts.length,source};
  },false);
  // Each item's main PDF is renamed "Surname_Year_Title.pdf" in its folder
  // (through moveAttachment: backed up, copied, then swapped); a name in use
  // gets " (2)", " (3)" …
  // style 'title': the title alone (서지정보's 제목으로 파일 이름); otherwise Surname_Year_Title.
  register('rename-attachments',async(id,paperIds,style)=>{
    if(style!==undefined&&style!=='title')throw Error(tr('파일 이름 방식을 확인하세요.'));
    const target=idleVault(id),out={renamed:0,unchanged:0,failed:[]};
    for(const paperId of paperIds){
      const paper=target.data.papers.find(p=>p.id===paperId),attachment=paper?.attachments.find(a=>a.id===paper.primaryAttachmentId&&!a.trashedAt)||paper?.attachments.find(a=>a.role!=='translated'&&!a.trashedAt);
      const name=paper&&attachment&&fileNameFor(paper,style);if(!name){out.failed.push({paperId,error:style==='title'?tr('제목이 없습니다.'):tr('서지정보가 부족합니다.')});continue;}
      const folder=attachment.path.includes('/')?attachment.path.slice(0,attachment.path.lastIndexOf('/')):'';
      if(attachment.name===name){out.unchanged++;continue;}
      let result=tr('사용할 수 있는 이름이 없습니다.');
      for(let n=1;n<=20;n++){
        const candidate=n===1?name:name.replace(/\.pdf$/i,` (${n}).pdf`);
        if(attachment.name===candidate){result='unchanged';break;}
        try{await target.moveAttachment(paperId,attachment.id,folder,candidate);result='renamed';break;}
        catch(error){if(error.code==='APP_PATH_REGISTERED'||error.code==='EEXIST')continue;result=error.message;break;}
      }
      if(result==='renamed')out.renamed++;else if(result==='unchanged')out.unchanged++;else out.failed.push({paperId,error:result});
    }
    return {...out,snapshot:await target.snapshot({refresh:false})};
  });
  const bibliographyFormats={ris:['RIS','ris'],bib:['BibTeX','bib'],biblatex:['BibLaTeX','bib'],csl:['CSL JSON','json']};
  register('export-bibliography',async(id,format,paperIds)=>{const target=current(id);if(!Object.hasOwn(bibliographyFormats,format))throw Error(tr('내보내기 형식을 확인하세요.'));const papers=Array.isArray(paperIds)?target.data.papers.filter(p=>paperIds.includes(p.id)):target.data.papers,text=exportBibliography(papers,format),[name,extension]=bibliographyFormats[format],choice=await dialog.showSaveDialog(win,{title:tr('서지정보 내보내기'),defaultPath:`${path.basename(target.root)}.${extension}`,filters:[{name,extensions:[extension]}]});if(choice.canceled)return false;await fs.writeFile(choice.filePath,text,'utf8');return true;});
  register('import-bibliography',async id=>{const target=current(id),choice=await dialog.showOpenDialog(win,{title:tr('서지정보 가져오기 (RIS·BibTeX·CSL JSON)'),properties:['openFile'],filters:[{name:tr('서지정보'),extensions:['ris','bib','json','txt']}]});if(choice.canceled)return null;if((await fs.stat(choice.filePaths[0])).size>5e6)throw Error(tr('5MB 이하 파일을 선택하세요.'));const text=await fs.readFile(choice.filePaths[0],'utf8'),name=path.basename(choice.filePaths[0]);
    // A file that names PDFs: the reader chooses whether they come along.
    let attachmentsFrom=null;const links=parseBibliography(text,name).report.attachments;
    if(links){const answer=await dialog.showMessageBox(win,{type:'question',title:tr('서지정보 가져오기'),message:tr('이 파일에 첨부파일 링크가 {n}개 있습니다.',{n:links}),detail:tr('첨부파일 포함: 이 PC에서 찾을 수 있는 PDF를 저장소로 복사해 각 항목에 붙입니다. 원본 파일은 그대로 둡니다.\n서지정보만: 항목만 만들고 PDF는 가져오지 않습니다.'),buttons:[tr('첨부파일 포함'),tr('서지정보만'),tr('취소')],defaultId:0,cancelId:2,noLink:true});if(answer.response===2)return null;if(answer.response===0)attachmentsFrom=path.dirname(choice.filePaths[0]);}
    const {ids,report}=await target.importBibliography(text,name,{withReport:true,attachmentsFrom});return {snapshot:await target.snapshot({refresh:false}),imported:ids.length,report:{...report,withAttachments:Boolean(attachmentsFrom)}};});
  register('format-citation',(id,paperIds,style,locator)=>{const target=current(id);if(!Array.isArray(paperIds)||!paperIds.length||paperIds.length>1000||!['apa','vancouver'].includes(style)||typeof locator!=='string'||locator.length>100)throw Error(tr('인용 요청을 확인하세요.'));const papers=paperIds.map(n=>target.paper(n));const references=referenceList(papers,style),suffixes=new Map(references.map(r=>[r.id,r.suffix]));return {references,citation:inTextCitation(papers.map(p=>({...p,yearSuffix:suffixes.get(p.id)||''})),style,{locator})};},false);
  register('copy-text',(text,html)=>{if(typeof text!=='string'||text.length>2e6||html!==undefined&&(typeof html!=='string'||html.length>4e6))throw Error(tr('복사할 내용을 확인하세요.'));clipboard.write(html?{text,html}:{text});},false);
  register('full-backup',async id=>{const target=current(id);if(translating(id))throw Error(tr('번역을 완료하거나 중단한 뒤 백업하세요.'));const choice=await dialog.showOpenDialog(win,{title:tr('전체 백업을 만들 폴더'),properties:['openDirectory','createDirectory']});if(choice.canceled)return null;const parent=await fs.realpath(choice.filePaths[0]);if(parent===target.root||parent.startsWith(target.root+path.sep))throw Error(tr('저장소 밖의 폴더를 선택하세요.'));return createFullBackup(target,parent);});
  register('full-restore',async()=>{
    const source=await dialog.showOpenDialog(win,{title:tr('복원할 전체 백업 폴더'),properties:['openDirectory']});if(source.canceled)return null;
    const manifest=await verifyBackup(source.filePaths[0]);
    const target=await dialog.showOpenDialog(win,{title:tr('“{vault}” 백업을 복원할 빈 폴더',{vault:manifest.vaultName}),properties:['openDirectory','createDirectory']});if(target.canceled)return null;
    const result=await restoreFullBackup(source.filePaths[0],target.filePaths[0],manifest);return {...result,snapshot:await connect(target.filePaths[0])};
  });
  const notebooksOf=target=>target.notebooks||=new NotebookStore(target);
  // Notebook edits keep their own write chain, like ink.
  // The notebook in its own window (another screen beside the paper): the same page with only the
  // notebook. It saves before it closes; the main window then reads the notebook again.
  register('window-snapshot',async id=>current(id).snapshot({refresh:false}),false);
  register('notebook-window',async(id,paperId,notebookId)=>{
    current(id);if(typeof notebookId!=='string'||!/^[-a-f0-9]{36}$/.test(notebookId))throw Error(tr('노트북을 확인하세요.'));
    const open=[...notebookWindows].find(w=>!w.isDestroyed()&&w.appNotebook===notebookId);if(open){open.show();open.focus();return;}
    const child=new BrowserWindow({width:900,height:1000,minWidth:420,minHeight:400,title:tr('{app} 노트북'),autoHideMenuBar:true,webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
    child.appNotebook=notebookId;notebookWindows.add(child);watchWindow(child,'notebook');
    const page=pathToFileURL(path.join(__dirname,'..','dist','index.html')).href;
    child.webContents.on('will-navigate',(event,url)=>{if(url.split('?')[0]!==page)event.preventDefault();});
    child.webContents.setWindowOpenHandler(()=>({action:'deny'}));
    let saved=false;
    child.on('close',event=>{if(saved)return;event.preventDefault();saved=true;flushPage(child).finally(()=>{if(!child.isDestroyed())child.destroy();});});
    child.on('closed',()=>{notebookWindows.delete(child);if(win&&!win.isDestroyed())win.webContents.send('notebook-window-closed',notebookId);});
    await child.loadFile(path.join(__dirname,'..','dist','index.html'),{query:{notebookWindow:'1',vault:String(id),paper:String(paperId??''),notebook:notebookId}});
  },false);
  // 원문·번역 새 창: the app's own reader with that pane alone (its tools, search, outline and
  // marks), for a second screen. The same page with a view-window query; it only reads.
  register('view-window',async(id,paperId,attachmentId,page,kind='original')=>{
    if(!['original','translation'].includes(kind))throw Error(tr('창 종류를 확인하세요.'));
    const target=current(id);if(!target.data.papers.some(p=>p.id===paperId))throw Error(tr('자료를 찾을 수 없습니다.'));
    if(attachmentId!=null&&(typeof attachmentId!=='string'||!/^[-\w]{1,64}$/.test(attachmentId)))throw Error(tr('첨부를 확인하세요.'));
    const key=`${kind}:${id}:${paperId}:${attachmentId||''}`,open=[...viewWindows].find(w=>!w.isDestroyed()&&w.appView===key);if(open){open.show();open.focus();return;}
    const child=new BrowserWindow({width:1000,height:1100,minWidth:420,minHeight:400,title:kind==='translation'?tr('{app} 번역'):tr('{app} 원문'),icon:path.join(__dirname,'..','dist','icon.png'),autoHideMenuBar:true,webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
    child.appView=key;viewWindows.add(child);watchWindow(child,kind);child.on('closed',()=>viewWindows.delete(child));
    const index=pathToFileURL(path.join(__dirname,'..','dist','index.html')).href;
    child.webContents.on('will-navigate',(event,url)=>{if(url.split('?')[0]!==index)event.preventDefault();});
    child.webContents.setWindowOpenHandler(()=>({action:'deny'}));
    await child.loadFile(path.join(__dirname,'..','dist','index.html'),{query:{viewWindow:kind,vault:String(id),paper:String(paperId),attachment:String(attachmentId||''),page:String(Number.isInteger(page)&&page>0?page:1)}});
  },false);
  register('notebook-list',id=>notebooksOf(current(id)).list(),false);
  register('notebook-get',(id,notebookId)=>notebooksOf(current(id)).get(notebookId),false);
  register('notebook-create',async(id,title,paperId)=>{await transferWait(id);return notebooksOf(current(id)).create(title,paperId??null);},false);
  register('notebook-save',async(id,notebook)=>{await transferWait(id);const target=current(id),result=await notebooksOf(target).save(notebook);contentChanged(target,null);return result;},false);
  // A notebook moved to the trash closes its own window (the window saves what it holds first).
  register('notebook-remove',async(id,notebookId)=>{await transferWait(id);for(const w of [...notebookWindows])if(!w.isDestroyed()&&w.appNotebook===notebookId){await flushPage(w);await new Promise(resolve=>{w.once('closed',resolve);w.close();});}const target=current(id),result=await notebooksOf(target).remove(notebookId);contentChanged(target,null);return result;},false);
  register('notebook-trash',async id=>notebooksOf(current(id)).trashed(),false);
  register('notebook-restore',async(id,notebookId)=>{await transferWait(id);const target=current(id),result=await notebooksOf(target).restore(notebookId);contentChanged(target,null);return result;},false);
  register('notebook-purge',async(id,notebookId)=>{await transferWait(id);const target=current(id),result=await notebooksOf(target).purge(notebookId);contentChanged(target,null);return result;},false);
  register('notebook-asset-put',async(id,dataUrl)=>{await transferWait(id);return notebooksOf(current(id)).putAsset(dataUrl);},false);
  register('notebook-asset-get',(id,hash)=>notebooksOf(current(id)).asset(hash),false);
  async function printHtml(html,title,defaultPath,pageSize){
    html=await inlineFonts(html);
    const choice=await dialog.showSaveDialog(win,{title,defaultPath,filters:[{name:'PDF',extensions:['pdf']}]});if(choice.canceled)return false;
    const {bytes}=await printPdf(html,{prepare:'Promise.all([document.fonts.ready,...Array.from(document.images).map(i=>i.decode().catch(()=>{}))]).then(()=>true)',pageSize});
    await fs.writeFile(choice.filePath,bytes);return true;
  }

  // A PDF from anywhere, read for its pages to become notebook pages (the file itself is not kept).
  register('notebook-pdf-pick',async()=>{
    const choice=await dialog.showOpenDialog(win,{title:tr('노트북에 넣을 PDF'),properties:['openFile'],filters:[{name:'PDF',extensions:['pdf']}]});if(choice.canceled||!choice.filePaths[0])return null;
    const file=choice.filePaths[0],info=await fs.stat(file);if(info.size>200*1024*1024)throw Error(tr('200MB 이하 PDF만 넣을 수 있습니다.'));
    const bytes=await fs.readFile(file);if(bytes.subarray(0,5).toString('latin1')!=='%PDF-')throw Error(tr('PDF 파일이 아닙니다.'));
    return {name:path.basename(file),bytes};
  });
  register('notebook-export',async(id,notebookId)=>{const store=notebooksOf(current(id)),notebook=await store.get(notebookId);return printHtml(await notebookHtml(notebook,hash=>store.asset(hash)),tr('노트북 PDF 저장'),notebook.title.replace(/[<>:"/\\|?*]/g,'_')+'.pdf');});
  register('notes-export',async(id,paperId)=>{const target=current(id),paper=target.paper(paperId),[reference]=referenceList([paper],'apa'),text=notesMarkdown(paper,target.data.notes,target.data.annotations,reference?.text),choice=await dialog.showSaveDialog(win,{title:tr('노트 Markdown 저장'),defaultPath:paper.title.replace(/[<>:"/\\|?*]/g,'_')+'.md',filters:[{name:'Markdown',extensions:['md']}]});if(choice.canceled)return false;await fs.writeFile(choice.filePath,text,'utf8');return true;});
  // Device identity lives in this computer's settings, never in the vault.
  async function device(){if(!/^[-a-f0-9]{36}$/.test(config.deviceId||'')){config.deviceId=require('node:crypto').randomUUID();await atomicJson(configFile,config);}return {deviceId:config.deviceId,deviceName:os.hostname().slice(0,100)};}
  // A computer still on an earlier app writes to its old sync folder: told once a run for each folder.
  const tellOldSync=folder=>oldSyncBeside(folder).then(old=>{if(!old||toldOld.has('sync:'+folder)||!win||win.isDestroyed())return;toldOld.add('sync:'+folder);dialog.showMessageBox(win,{type:'info',buttons:[tr('확인')],message:old.length>1?tr('동기화 폴더에 이전 앱의 {folders} 폴더들도 있습니다. 모든 PC를 {app}로 바꾼 뒤 동기화하세요.',{folders:old.join(', ')}):tr('동기화 폴더에 이전 앱의 {folder} 폴더도 있습니다. 모든 PC를 {app}로 바꾼 뒤 동기화하세요.',{folder:old[0]})}).catch(()=>{});}).catch(()=>{});
  syncVault=async function(target){const folder=config.sync?.[target.data.id];if(!folder)throw Error(tr('동기화 폴더를 먼저 연결하세요.'));if(translating(target.data.id))throw Error(tr('번역을 완료하거나 중단한 뒤 동기화하세요.'));await adoptSyncFolder(folder);tellOldSync(folder);const report=await new SyncEngine({library:target,ink:inkOf(target),notebooks:notebooksOf(target),folder,onProblem:record,...await device()}).run();config.syncAt={...config.syncAt,[target.data.id]:new Date().toISOString()};await atomicJson(configFile,config);return report;};
  register('sync-status',async id=>{const target=current(id);return {folder:config.sync?.[target.data.id]||null,at:config.syncAt?.[target.data.id]||null,device:(await device()).deviceName};});
  register('sync-connect',async id=>{const target=current(id),choice=await dialog.showOpenDialog(win,{title:tr('동기화 폴더 (Dropbox·Google Drive 등 공유 폴더)'),properties:['openDirectory','createDirectory']});if(choice.canceled)return null;const folder=await syncBase(await fs.realpath(choice.filePaths[0]));if(folder===target.root||folder.startsWith(target.root+path.sep)||target.root.startsWith(folder+path.sep))throw Error(tr('저장소와 겹치지 않는 폴더를 선택하세요.'));config.sync={...config.sync,[target.data.id]:folder};await atomicJson(configFile,config);const report=await syncVault(target);return {report,snapshot:await target.snapshot()};});
  register('sync-disconnect',async id=>{const target=current(id);if(config.sync)delete config.sync[target.data.id];await atomicJson(configFile,config);});
  register('sync-run',async id=>{const target=current(id),report=await syncVault(target);return {report,snapshot:await target.snapshot()};});
  register('sync-shared',async()=>{const choice=await dialog.showOpenDialog(win,{title:tr('다른 기기와 공유하는 동기화 폴더'),properties:['openDirectory']});if(choice.canceled)return null;const picked=await fs.realpath(choice.filePaths[0]),folder=await syncBase(picked),vaults=await sharedVaults(folder);lastShared={folder,vaults};const direct=vaults.length?[]:await vaultFolders(picked);foundVaultFolders=new Set(direct);return {folder:vaults.length?folder:picked,vaults,direct:direct.map(root=>({root,name:path.basename(root)}))};});
  // A vault folder found by sync-shared (kept in a cloud drive) is opened as it is.
  register('open-found-vault',async root=>{if(typeof root!=='string'||!foundVaultFolders.has(root))throw Error(tr('저장소 폴더를 다시 고르세요.'));return connect(root);});
  register('sync-join',async(folder,vaultId)=>{
    // The vaults sync-shared just listed for this folder, not looked up again (a sync folder whose rename is refused waits
    // a moment each time it is looked into).
    if(typeof folder!=='string'||!/^[-a-f0-9]{36}$/.test(vaultId)||!(lastShared?.folder===folder?lastShared.vaults:await sharedVaults(folder)).some(v=>v.id===vaultId))throw Error(tr('동기화 폴더의 저장소를 확인하세요.'));
    const choice=await dialog.showOpenDialog(win,{title:tr('이 기기에 저장소를 만들 빈 폴더'),properties:['openDirectory','createDirectory']});if(choice.canceled)return null;
    const root=await fs.realpath(choice.filePaths[0]);if((await fs.readdir(root)).length)throw Error(tr('비어 있는 폴더를 선택하세요.'));
    await atomicJson(path.join(root,VAULT_DIR,'library.json'),{version:2,id:vaultId,papers:[],notes:{},collections:[],annotations:[]});
    config.sync={...config.sync,[vaultId]:folder};await atomicJson(configFile,config);
    const snapshot=await connect(root);return {report:snapshot.syncReport,snapshot};
  });
  // Choosing a version resolves the conflict on every device at the next sync.
  register('sync-resolve',async(id,conflictId,choice)=>{
    const target=current(id),conflict=(target.data.syncConflicts||[]).find(c=>c.id===conflictId);if(!conflict||!['local','remote','keep'].includes(choice))throw Error(tr('충돌 항목을 확인하세요.'));
    const colon=conflict.key.indexOf(':'),type=conflict.key.slice(0,colon),key=conflict.key.slice(colon+1);
    // The choice is written by the conflict's kind (sync.cjs resolveConflict); a kind this version does not know keeps the
    // conflict and says so.
    await target.transaction(()=>resolveConflict(target,conflict,choice));
    // Records kept in their own files (notebooks, corrections, AI results…):
    // the local copy is already on disk, so only the other device's is written.
    if(choice==='remote'&&['notebook','corrections','ai','translation','inkbase'].includes(type)){const write=()=>writeFileRecord(path.join(target.root,VAULT_DIR),inkOf(target),type,key,conflict.remote);await(type==='notebook'?notebooksOf(target).serial(key,write):write());}
    return target.snapshot({refresh:false});
  });
  register('vault-backups',id=>current(id).backups());
  register('vault-backup',async id=>{const target=current(id);await target.backup(tr('사용자 백업'));return target.backups();});
  register('vault-restore',async(id,backupId)=>{const target=idleVault(id);await target.restoreBackup(backupId);return target.snapshot();});
  register('move-attachment',async(id,paperId,attachmentId,folder,name)=>{const target=idleVault(id);await target.moveAttachment(paperId,attachmentId,folder,name);return target.snapshot({refresh:false});});
  register('relink-attachment',async(id,paperId,attachmentId)=>{const target=idleVault(id);const choice=await dialog.showOpenDialog(win,{title:tr('같은 내용의 PDF 다시 연결'),defaultPath:target.root,properties:['openFile'],filters:[{name:'PDF',extensions:['pdf']}]});if(choice.canceled)return null;const relative=path.relative(target.root,choice.filePaths[0]).split(path.sep).join('/');await target.relinkAttachment(paperId,attachmentId,relative);return target.snapshot({refresh:false});});
  register('trash-attachment',async(id,paperId,attachmentId,restore)=>{const target=idleVault(id);await target.trashAttachment(paperId,attachmentId,restore===true);return target.snapshot({refresh:false});});
  // 삭제: the item (or one attachment) and its PDF files leave the vault for good. The PDFs go
  // to the computer's own trash where there is one, so a mistake can still be undone there;
  // otherwise they are deleted. Notes, annotations, translation, ink and AI results are deleted.
  const discardFile=file=>shell.trashItem(file).catch(()=>fs.rm(file,{force:true}));
  const deleteFor=async(id,paperId,attachmentIds)=>{
    const target=idleVault(id);await translations.writes;await target.ink?.idle();await target.notebooks?.idle();
    const report=await target.deleteAttachments(Number(paperId),attachmentIds,discardFile);
    // Stores opened for the deleted attachments would write their files back.
    delete target.ink;delete target.corrections;delete target.insights;
    return {...await target.snapshot({refresh:false}),deleteReport:report};
  };
  register('delete-paper',(id,paperId)=>deleteFor(id,paperId,null));
  // A folder with what it holds: its PDFs and then the folder go to the computer's trash where there is one.
  register('delete-folder',async(id,folder)=>{
    const target=idleVault(id);await translations.writes;await target.ink?.idle();await target.notebooks?.idle();
    const report=await target.deleteFolder(folder,discardFile,dir=>shell.trashItem(dir).catch(()=>fs.rm(dir,{recursive:true,force:true})));
    delete target.ink;delete target.corrections;delete target.insights;
    return {...await target.snapshot({refresh:false}),deleteReport:report};
  });
  register('delete-attachment',(id,paperId,attachmentId)=>{if(typeof attachmentId!=='string')throw Error(tr('첨부파일이 없습니다.'));return deleteFor(id,paperId,[attachmentId]);});
  // ---- Sending papers to another vault on this computer (desktop/transfer.cjs). The screen names a receiving vault by a
  // key made here for its folder (a recent vault, or a folder picked); the path stays in the main process. Two recent
  // vaults of one id (a folder and its copy) are two keys.
  const transfer=require('./transfer.cjs'),transferPlaces=new Map(),transferBundles=new Map();let transferAbort=null,transferBusy=null;
  const transferSame=()=>Object.assign(Error(tr('지금 저장소와 같은 폴더이거나 그 안·바깥의 폴더는 고를 수 없습니다.')),{code:'APP_TRANSFER_SAME'});
  const transferKey=(kind,root)=>{const key=kind+':'+require('node:crypto').randomUUID();transferPlaces.set(key,root);return key;};
  const transferRoot=async(id,key)=>{const source=current(id),root=transferPlaces.get(key);
    if(!root)throw Error(tr('받는 저장소를 다시 고르세요.'));if(await transfer.sameOrNested(root,source.root).catch(()=>{throw Error(tr('받는 저장소 폴더를 찾을 수 없습니다.'));}))throw transferSame();return root;};
  // Where a vault is, beside its name: its parent folder, the home folder written as ~.
  const transferPlace=root=>{const parent=path.dirname(root),home=os.homedir();return {name:path.basename(root),where:parent===home||parent.startsWith(home+path.sep)?'~'+parent.slice(home.length):parent};};
  // The papers to send: those asked for (all, for the whole vault), less those being translated (told, not sent).
  const transferChoice=(source,paperIds)=>{const ids=paperIds===null?source.data.papers.map(p=>p.id):paperIds.map(Number),busy=ids.filter(pid=>translating(source.data.id,[pid]));
    return {ids:ids.filter(pid=>!busy.includes(pid)),translating:busy.map(pid=>({id:pid,title:source.data.papers.find(p=>p.id===pid)?.title||''}))};};
  const transferBundle=(source,paperIds,ids,busy,signal)=>paperIds===null?transfer.collectBundle(source,null,{except:busy.map(b=>b.id),signal}):transfer.collectBundle(source,ids,{signal});
  // While a send runs, the sending vault's own write requests (ink, notebooks) wait for it to end: one made meanwhile
  // would miss the send, and after a move would write for papers no longer there (those then fail as for a deleted one).
  function transferWait(id){const busy=transferBusy;return busy&&busy.id===id?busy.done:null;}
  register('transfer-targets',async id=>{const source=current(id);for(const key of [...transferPlaces.keys()])if(key.startsWith('recent:'))transferPlaces.delete(key);
    return config.recents.filter(r=>r.root!==source.root).map(r=>({key:transferKey('recent',r.root),...transferPlace(r.root)}));});
  register('transfer-pick',async id=>{
    const source=current(id),choice=await dialog.showOpenDialog(win,{title:tr('받을 저장소 폴더 선택'),properties:['openDirectory','createDirectory']});if(choice.canceled||!choice.filePaths?.[0])return null;
    const root=await fs.realpath(choice.filePaths[0]);if(await transfer.sameOrNested(root,source.root))throw transferSame();
    return {key:transferKey('pick',root),...transferPlace(root)};
  });
  // What a send would do, read only: the counts, the papers left out, how many were sent before, and what to tell. The
  // papers' records and file fingerprints are read once for a dialog (a minute), whichever vault or choice is looked at;
  // the send reads them again.
  // The receiving vault's folders, for its 받는 폴더 list (read only; a new folder is made by the send).
  register('transfer-folders',async(id,key)=>transfer.receivingFolders(await transferRoot(id,key)),false);
  register('transfer-preview',async(id,{paperIds=null,key,existing='skip',folder='',keepFolders=true}={})=>{
    const source=current(id),root=await transferRoot(id,key),{ids,translating:busy}=transferChoice(source,paperIds),cacheKey=id+'|'+JSON.stringify(paperIds);
    let cached=transferBundles.get(cacheKey);if(!cached||Date.now()-cached.at>60000){cached={at:Date.now(),bundle:transferBundle(source,paperIds,ids,busy)};transferBundles.set(cacheKey,cached);cached.bundle.catch(()=>transferBundles.delete(cacheKey));}
    const bundle=await cached.bundle,target=await Library.peek(root),plan=await transfer.planTransfer(bundle,target,{existing:existing==='replace'?'replace':'skip',folder,keepFolders:keepFolders!==false});
    return {counts:plan.counts,translating:busy,previous:plan.counts.skip+plan.counts.replace,fresh:plan.fresh,loosePdfs:plan.loosePdfs,sourceSynced:Boolean(config.sync?.[source.data.id]),...transferPlace(root)};
  },false);
  register('transfer-run',async(id,{paperIds=null,key,mode='copy',existing='skip',folder='',keepFolders=true}={})=>{
    // 취소 is heard from the first moment: every step before the receiving vault's save checks it.
    const controller=new AbortController(),stop=()=>{if(controller.signal.aborted)throw transfer.cancelled();};let ended;
    transferAbort=controller;transferBundles.clear();
    let result,receiving,release=null;
    try{
      const source=current(id),root=await transferRoot(id,key),{ids,translating:busy}=transferChoice(source,paperIds);
      // A move closes the notebook and view windows (they save as they close) and stops AI and figure requests, so
      // nothing is written for papers on their way out.
      if(mode==='move'){await closeNotebookWindows();figureController?.abort();insightController?.abort();}
      // What the screen and the stores still hold is written first, so the latest goes; from then on the vault's ink and
      // notebook writes wait for the send to end.
      await translations.writes;await source.ink?.idle();await source.notebooks?.idle();
      transferBusy={id,done:new Promise(resolve=>{ended=resolve;})};await source.ink?.idle();await source.notebooks?.idle();stop();
      const bundle=await transferBundle(source,paperIds,ids,busy,controller.signal);stop();
      // A folder that cannot hold a vault is refused in words; opening it is told without its path.
      await transfer.vaultPlace(root);
      try{release=await lockVault(root);stop();receiving=await Library.open(root);}catch(error){throw transfer.fileError(error);}stop();
      const plan=await transfer.planTransfer(bundle,receiving,{existing:existing==='replace'?'replace':'skip',folder,keepFolders:keepFolders!==false});
      result=await transfer.runTransfer({bundle,source,target:receiving,reader:transfer.sourceReader(source.root),plan,mode:mode==='move'?'move':'copy',discard:discardFile,notebooks:notebooksOf(source),signal:controller.signal,
        onProgress:(done,total)=>{if(win&&!win.isDestroyed())win.webContents.send('transfer-progress',{done,total});}});
      // Stores opened for papers moved away would write their files back.
      if(mode==='move'){delete source.ink;delete source.corrections;delete source.insights;}
      // The receiving vault joins the recent ones (it is not opened).
      const recent={id:receiving.data.id,name:path.basename(receiving.root),root:receiving.root};
      const self=config.recents.find(r=>r.root===source.root)||{id:source.data.id,name:path.basename(source.root),root:source.root};
      config={...config,recents:[self,recent,...config.recents.filter(r=>r.root!==source.root&&r.root!==recent.root)].slice(0,8)};
      await atomicJson(configFile,config);buildMenu();
      return {report:result.report,removed:result.removed||null,translating:busy,snapshot:await source.snapshot({refresh:false}),target:{key:transferKey('recent',recent.root),name:recent.name}};
    }finally{transferAbort=null;transferBusy=null;ended?.();if(release)await release();}
  });
  register('transfer-open',async(id,key)=>{current(id);return connect(await transferRoot(id,key));});
  register('transfer-cancel',()=>{transferAbort?.abort();return true;},false);
  register('trash-paper',async(id,paperId,restore)=>{const target=idleVault(id);await target.trashPaper(paperId,restore===true);return target.snapshot({refresh:false});});
  register('edit-collection',async(id,collectionId,name)=>{requireFeature('collections');const target=current(id);await target.editCollection(collectionId,name);return target.snapshot({refresh:false});});
  register('edit-annotation',async(id,annotationId,patch)=>{const target=current(id);await target.editAnnotation(annotationId,patch);return target.snapshot({refresh:false});});
  const noteWrites=new Map();
  register('save-notes',(id,notes)=>{
    const pending=noteWrites.get(id);if(pending){pending.notes=notes;return pending.task;}
    const entry={notes};entry.task=queue.then(async()=>{noteWrites.delete(id);await current(id).saveNotes(entry.notes);});
    noteWrites.set(id,entry);queue=entry.task.catch(()=>{});return entry.task;
  },false);
  // Whether library.json was changed by another program since this app read it (asked when the window comes back).
  register('vault-check',async id=>({changed:!(await current(id).unchanged()),gone:await vaultGone()}));
  // Reads the vault again from disk without a restart. Notes the page had not saved yet are
  // merged in (mergePendingNotes), so neither the outside change nor the unsaved text is lost.
  register('vault-reload',async(id,pending)=>{
    const target=current(id);if(translating(id))throw Error(tr('번역 중에는 다시 읽을 수 없습니다. 번역이 끝나거나 중단한 뒤 다시 시도하세요.'));
    await translations.writes;await target.ink?.idle();await target.notebooks?.idle();
    const next=await Library.open(target.root);if(next.data.id!==id)throw Error(tr('이 폴더가 다른 저장소로 바뀌었습니다. 저장소를 다시 연결하세요.'));
    const merged=mergePendingNotes(target.data.notes,next.data.notes,pending,aiLanguage(language));
    if(merged.kept.length||merged.conflicts.length)await next.saveNotes(merged.notes);
    // A note save still waiting in the queue carries the page's old copy of every note.
    const waiting=noteWrites.get(id);if(waiting)waiting.notes=next.data.notes;
    library=next;watchVault(next);return {...await next.snapshot(),reloaded:{kept:merged.kept.length,conflicts:merged.conflicts.length}};
  });
  // The vault's folder was renamed or moved while it was open: the person picks where it is now. The folder is looked at
  // before anything is made in it, and must hold this very vault. It is then connected like any vault (locked, opened,
  // kept in the recent vaults, the old place let go), and the notes the page had not saved are merged in as on a reload.
  register('vault-relocate',async(id,pending)=>{
    const target=current(id);if(translating(id))throw Error(tr('번역 중에는 다시 연결할 수 없습니다. 번역이 끝나거나 중단한 뒤 다시 시도하세요.'));
    const choice=await dialog.showOpenDialog(win,{title:tr('저장소 폴더 다시 고르기'),properties:['openDirectory']});if(choice.canceled||!choice.filePaths[0])return null;
    const root=await fs.realpath(choice.filePaths[0]),found=await readJson(path.join(root,VAULT_DIR,'library.json'),null).catch(()=>null);
    if(found?.id!==id)throw Error(tr('고른 폴더는 이 저장소의 폴더가 아닙니다. 이름을 바꾸거나 옮긴 그 폴더를 고르세요.'));
    const before=target.data.notes,old=target.root;
    await connect(root);
    const merged=mergePendingNotes(before,library.data.notes,pending,aiLanguage(language));
    if(merged.kept.length||merged.conflicts.length)await library.saveNotes(merged.notes);
    const waiting=noteWrites.get(id);if(waiting)waiting.notes=library.data.notes;
    if(old!==library.root&&config.recents.some(r=>r.root===old)){config={...config,recents:config.recents.filter(r=>r.root!==old)};await atomicJson(configFile,config);if(win)buildMenu();}
    return {...await library.snapshot(),reloaded:{kept:merged.kept.length,conflicts:merged.conflicts.length}};
  });
  // The new-version notice (update-check.cjs; docs/DEVELOPMENT.md 새 버전 알림). The page asks for what was found
  // (it may have loaded after the check) and is told when the check ends later. 내려받기 opens the release's page in
  // the browser; the app installs nothing itself. A skipped version is kept and not offered again.
  register('update-pending',()=>pendingUpdate,false);
  register('update-open',async()=>{if(pendingUpdate)await shell.openExternal(pendingUpdate.url);},false);
  register('update-check-now',()=>checkForUpdate({now:true}),false);
  register('update-skip',async()=>{if(!pendingUpdate)return;config={...config,updateSkipped:pendingUpdate.version};pendingUpdate=null;await atomicJson(configFile,config);});
  register('preferences', async values => {
    if (!Object.hasOwn(providers, values.provider) || !['web', 'api', 'local'].includes(values.mode)) throw Error(tr('지원하지 않는 번역 연결입니다.'));
    config.provider = values.provider; config.mode = values.mode; await atomicJson(configFile, config);
  });
  // User themes and CSS snippets (docs/DEVELOPMENT.md, 사용자 테마). The folders are watched while the app runs;
  // --disable-custom-styles starts with the plain look.
  const themes=new ThemeStore(app.getPath('userData'));await themes.ensure().catch(()=>{});
  themes.watch(()=>{if(win&&!win.isDestroyed())win.webContents.send('themes-changed');},record);
  register('themes-list',async()=>({...(await themes.list()),disabled:process.argv.includes('--disable-custom-styles')}),false);
  register('theme-css',id=>themes.themeCss(id),false);
  register('snippet-css',name=>themes.snippetCss(name),false);
  register('themes-open-folder',async()=>{await themes.ensure();const error=await shell.openPath(themes.root);if(error)throw Error(error);},false);
  register('pdf-open-link',async value=>{if(typeof value!=='string'||value.length>8192)throw Error(tr('PDF 링크를 확인하세요.'));const url=new URL(value);if(!['https:','http:','mailto:'].includes(url.protocol))throw Error(tr('지원하지 않는 PDF 링크입니다.'));await shell.openExternal(url.href);},false);
  register('reveal-original', async (id, paperId) => { shell.showItemInFolder(await current(id).resolveFile(paperId, 'original')); });
  await win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  checkForUpdate().catch(error=>record('update-check',error));
  {const every=Number(process.env.APP_UPDATE_EVERY_MS)>0?Number(process.env.APP_UPDATE_EVERY_MS):UPDATE_EVERY.open;
    setInterval(()=>checkForUpdate({every}).catch(error=>record('update-check',error)),every).unref?.();}
  if(development){
    const marker=path.join(__dirname,'..','dist','.dev-reload.json');
    let timer,busy=false;
    const watcher=watch(path.dirname(marker),(_event,file)=>{
      if(String(file)!=='.dev-reload.json')return;clearTimeout(timer);
      timer=setTimeout(async()=>{
        if(busy||win.isDestroyed())return;busy=true;
        try{
          const message=await readJson(marker,null);if(!['reload','quit'].includes(message?.action))return;
          await queue;
          devUI=await win.webContents.executeJavaScript(`typeof state==='undefined'?null:({screen:state.screen,selected:state.selected,selectedAttachment:state.selectedAttachment,collection:state.collection,mode:state.mode,nav:state.nav,query:state.query,filter:state.filter,desktopTag:state.desktopTag,folder:state.folder,split:state.split,leftCollapsed:state.leftCollapsed,rightCollapsed:state.rightCollapsed,libraryId:state.storageKey})`);
          if(message.action==='quit')app.quit();else win.webContents.reloadIgnoringCache();
        }catch(error){console.error('[dev] 화면 갱신 실패:',error.message);} // i18n:keep — a line in the log, not on screen
        finally{busy=false;}
      },100);
    });
    app.on('will-quit',()=>{clearTimeout(timer);watcher.close();});
  }
}).catch(error=>{
  // A start that fails before the window is up would leave a process with no window holding the single-instance lock
  // (a second start would only try to show that window): it says why and ends.
  record('startup',error);console.error('startup failed',error);
  try{dialog.showErrorBox(tr('앱을 시작하지 못했습니다'),tr('시작하는 중에 문제가 생겨 앱을 닫습니다. 다시 실행해 보세요.')+'\n\n'+String(error?.message||error));}catch{/* no screen to show it on; it is in the record above */}
  app.exit(1);
});
let ocrReader=null,quitting=false;app.on('before-quit',event=>{if(quitting)return;event.preventDefault();quitting=true;connections?.cancelAll();translations?.stopAll();ocrReader?.close();closeNotebookWindows().then(flushRenderer).then(()=>queue).finally(async()=>{await saveWindowPlace();await closeVault();app.quit();});});
app.on('window-all-closed', () => app.quit());
