import { spawn } from 'node:child_process';
import { watch } from 'node:fs';
import { mkdir, writeFile, stat, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
let electron;
try { electron = require('electron'); }
catch { console.error('Electron 실행 파일이 없습니다. npm ci로 의존성을 설치하세요.'); process.exit(1); }
const marker = join(root, 'dist', '.dev-reload.json');
let child, updating = false, pending = false, restart = false, full = false, stopping = false, timer;
const watchers = [];
async function build(all) {
  await new Promise((resolve,reject) => {
    const task=spawn(process.execPath,['scripts/build.mjs',...(all?[]:['--ui-only'])],{cwd:root,stdio:'inherit'});
    task.on('error',reject); task.on('exit',code=>code===0?resolve():reject(Error('화면 자산 갱신에 실패했습니다.')));
  });
}
function launch() {
  // Korean file paths need a UTF-8 locale in Chromium; minimal shells may have none.
  const locale=/utf-?8/i.test(process.env.LC_ALL||process.env.LC_CTYPE||process.env.LANG||'')?{}:{LC_ALL:'C.UTF-8',LANG:'C.UTF-8'};
  child=spawn(electron,[root,...process.argv.slice(2)],{cwd:root,stdio:'inherit',env:{...process.env,...locale,APP_DEV_MODE:'1'}});
  child.on('error',error=>console.error('[dev]',error.message));
  child.on('exit',()=>{child=null;if(!stopping)console.log('[dev] 앱이 닫혔습니다. 코드를 저장하면 다시 실행합니다.');});
  console.log('[dev] 개발 앱 실행 — Ctrl+C로 종료');
}
async function signal(action) { await writeFile(marker,JSON.stringify({action,revision:Date.now()})); }
async function stopChild() {
  const active=child;if(!active)return;
  await signal('quit');
  await new Promise(resolve=>{const timeout=setTimeout(()=>{active.kill();resolve();},8000);active.once('exit',()=>{clearTimeout(timeout);resolve();});});
}
async function update() {
  if(updating||stopping)return;updating=true;
  try {
    while(pending&&!stopping){
      const shouldRestart=restart||!child,all=full;pending=false;restart=false;full=false;
      try {
        await build(all);
        if(shouldRestart){await stopChild();if(!stopping){await signal('ready');launch();console.log('[dev] 앱 내부 코드 반영: 재시작');}}
        else{await signal('reload');console.log('[dev] 화면 코드 반영: 새로고침');}
      }catch(error){console.error('[dev]',error.message,'다음 저장 시 다시 시도합니다.');}
    }
  }finally{updating=false;}
}
// Windows reports a file that was only read (its last-access time) as changed, so starting the
// app would restart it. Only a file whose modified time or size moved counts as saved.
const seen=new Map();
async function signature(file){try{const s=await stat(file);return s.mtimeMs+':'+s.size;}catch{return 'gone';}}
async function remember(dir){for(const name of await readdir(dir).catch(()=>[]))seen.set(join(dir,name),await signature(join(dir,name)));}
function onSave(dir,name,act){if(!name)return;const file=join(dir,name);signature(file).then(now=>{if(seen.get(file)===now)return;seen.set(file,now);act();});}
function schedule(needsRestart=false,all=false){pending=true;restart ||= needsRestart;full ||= all;clearTimeout(timer);timer=setTimeout(update,150);}
await mkdir(join(root,'dist'),{recursive:true});
for(const dir of [join(root,'core'),join(root,'desktop'),join(root,'scripts')])await remember(dir);seen.set(join(root,'package.json'),await signature(join(root,'package.json')));
await build(true);await signal('ready');launch();
// core/: what the main process also loads restarts the app; the reader's own script reloads the page.
watchers.push(watch(join(root,'core'),(_event,file)=>{const name=String(file||'');if(name==='pdf-view.js')onSave(join(root,'core'),name,()=>schedule());else if(/\.(?:c?js)$/.test(name))onSave(join(root,'core'),name,()=>schedule(true));}));
watchers.push(watch(join(root,'desktop'),(_event,file)=>{const name=String(file||'');if(name.endsWith('.cjs'))onSave(join(root,'desktop'),name,()=>schedule(true));else if(['index.html','app.js','app.css','renderer.js','ink.js','ink.css','library.js','library.css','tags.js','insight.js','review.js','notebook.js','style.css'].includes(name))onSave(join(root,'desktop'),name,()=>schedule());}));
watchers.push(watch(join(root,'scripts'),(_event,file)=>{if(String(file)==='build.mjs')onSave(join(root,'scripts'),'build.mjs',()=>schedule(false,true));}));
watchers.push(watch(root,(_event,file)=>{if(String(file)==='package.json')onSave(root,'package.json',()=>schedule(true,true));}));
async function close(){if(stopping)return;stopping=true;clearTimeout(timer);watchers.forEach(w=>w.close());await stopChild();process.exit(0);}
process.on('SIGINT',close);process.on('SIGTERM',close);
