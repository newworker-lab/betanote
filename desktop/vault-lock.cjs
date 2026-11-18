const fs = require('node:fs/promises');
const path = require('node:path');
const {tr}=require('../core/i18n.js');
const os = require('node:os');
const crypto = require('node:crypto');
// When this computer last started (bootTime): a lease written before then belongs to a process that
// cannot be running, whatever now holds its pid.
const { adoptVaultFolder, bootTime, VAULT_DIR } = require('./legacy.cjs');
// When a process of this computer started, in seconds since 1970, where the system tells (Linux: /proc); else null.
// A lease names its process's start (started), so a pid given again to another program after the app ended abruptly
// is told apart from the app itself.
const fsSync = require('node:fs');
function processStart(pid) {
  try {
    const stat = fsSync.readFileSync(`/proc/${pid}/stat`, 'utf8'), fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    const btime = Number(/^btime (\d+)$/m.exec(fsSync.readFileSync('/proc/stat', 'utf8'))?.[1]), ticks = Number(fields[19]);
    return Number.isFinite(btime) && Number.isFinite(ticks) ? btime + ticks / 100 : null;
  } catch { return null; }
}
// The leases this process holds: token → lease file. A lease naming this process that it does not hold at that file was
// copied with its vault folder (from a vault open here) and is left over.
const held = new Map();
// Never expire a lease by time: a sleeping computer can still own this vault.
// Cloud drives (Google Drive for desktop, OneDrive) can report another letter case or a
// \\?\ prefix for the same folder; those are the same place, not a link elsewhere.
const samePlace=(a,b)=>{const clean=p=>path.resolve(p.replace(/^\\\\\?\\/,''));const x=clean(a),y=clean(b);return x===y||(process.platform!=='linux'&&x.toLowerCase()===y.toLowerCase());};
// takeOver: the person confirmed that the computer named in the lease no longer uses the
// vault (a lease synced by a cloud drive from a computer that crashed or lost power).
async function lockVault(root,{takeOver=false}={}) {
  root=await fs.realpath(root);await adoptVaultFolder(root);const directory=path.join(root,VAULT_DIR);await fs.mkdir(directory,{recursive:true});
  if(!samePlace(await fs.realpath(directory),directory))throw Error(tr('설정 폴더의 심볼릭 링크는 지원하지 않습니다.'));
  // A vault kept in git: the lease is never committed, whatever the vault's own .gitignore says (that file is the
  // person's, and an older one names only the old folder). One already there is left as it is.
  await fs.writeFile(path.join(directory,'.gitignore'),'writer.lock\nwriter.lock.*\n',{flag:'wx'}).catch(()=>{});
  const file=path.join(directory,'writer.lock'),owner={pid:process.pid,host:os.hostname(),boot:bootTime(),started:Math.round(Date.now()/1000-process.uptime()),token:crypto.randomUUID()};
  for(let attempt=0;attempt<2;attempt++){
    try{await create(file,JSON.stringify(owner));held.set(owner.token,file);
      return async()=>{held.delete(owner.token);try{const current=JSON.parse(await fs.readFile(file,'utf8'));if(current.token===owner.token)await fs.unlink(file);}catch(error){if(error.code!=='ENOENT')throw error;}};
    }catch(error){
      if(error.code!=='EEXIST')throw error;
      const text=await fs.readFile(file,'utf8').catch(()=>null);let previous=null;try{previous=JSON.parse(text);}catch{}
      if(!previous){
        // A lease cut off while being written (only possible where hard links are unavailable) is left over once it is a minute old.
        const age=Date.now()-(await fs.stat(file).catch(()=>({mtimeMs:Date.now()}))).mtimeMs;
        if(age<60000)throw Error(tr('저장소 잠금 파일을 확인할 수 없습니다. 다른 앱이 종료됐는지 확인하세요.'));
        if(await fs.readFile(file,'utf8').catch(()=>null)!==text)continue;await fs.unlink(file).catch(()=>{});continue;
      }
      if(previous.host!==owner.host||!Number.isSafeInteger(previous.pid)||previous.pid<=0){
        if(!takeOver)throw Object.assign(Error(previous.host?tr('다른 컴퓨터 ({host})에서 사용 중인 저장소입니다. 먼저 사용 중인 앱을 종료하세요.',{host:previous.host}):tr('다른 컴퓨터에서 사용 중인 저장소입니다. 먼저 사용 중인 앱을 종료하세요.')),{code:'APP_LOCKED_ELSEWHERE',host:String(previous.host||'')});
        const current=JSON.parse(await fs.readFile(file,'utf8').catch(()=>'null'));if(current&&current.token!==previous.token)continue;
        await fs.unlink(file).catch(error=>{if(error.code!=='ENOENT')throw error;});continue;
      }
      const restarted=Number.isFinite(previous.boot)&&Math.abs(previous.boot-owner.boot)>120;
      if(!restarted){
        let alive=false;
        try{process.kill(previous.pid,0);alive=true;}
        catch(error){if(error.code==='EPERM')throw Error(tr('다른 사용자의 앱에서 사용 중인 저장소입니다. 먼저 해당 앱을 종료하세요.'));if(error.code!=='ESRCH')throw error;}
        if(alive){
          // This very app holds it: never taken. One naming this process that it does not hold was copied: left over.
          if(previous.pid===process.pid&&held.get(previous.token)===file)throw Error(tr('다른 앱에서 사용 중인 저장소입니다. 먼저 해당 앱을 종료하세요.'));
          // Its pid now another program's (it started at another time than the lease says): the lease is left over.
          const start=processStart(previous.pid),reused=previous.pid===process.pid||start!==null&&Number.isFinite(previous.started)&&Math.abs(start-previous.started)>3;
          // Otherwise it may be the app in another window or a lease left after a crash: opening asks to release it.
          if(!reused&&!takeOver)throw Object.assign(Error(tr('이 컴퓨터의 다른 {app} 또는 비정상 종료 뒤 남은 잠금이 이 저장소를 쓰고 있습니다.')),{code:'APP_LOCKED_HERE'});
        }
      }
      // Recheck ownership before reclaiming a dead local process's lease.
      const current=JSON.parse(await fs.readFile(file,'utf8'));if(current.token!==previous.token)continue;
      await fs.unlink(file);
    }
  }
  throw Error(tr('저장소 잠금을 얻지 못했습니다. 다시 연결하세요.'));
}
// The lease appears with its whole content: written to a private file, then
// hard-linked into place (which fails if a lease exists). File systems
// without hard links fall back to an exclusive create.
async function create(file,text){
  const temp=`${file}.${crypto.randomUUID()}.tmp`;
  // Some cloud drives refuse fsync or hard links (with varying error codes); the lease is still
  // written, and an exclusive create keeps it to one owner.
  const flush=handle=>handle.sync().catch(()=>{});
  const handle=await fs.open(temp,'wx',0o600);try{await handle.writeFile(text);await flush(handle);}finally{await handle.close();}
  try{await fs.link(temp,file);}
  catch(error){
    if(error.code==='EEXIST')throw error;
    const lock=await fs.open(file,'wx',0o600);try{await lock.writeFile(text);await flush(lock);}finally{await lock.close();}
  }finally{await fs.rm(temp,{force:true}).catch(()=>{});}
}
module.exports={lockVault};
