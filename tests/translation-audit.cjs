// Translation audit over a folder of PDFs: translates each paper in the app
// and measures every translated page for overlaps, clipped text, displaced
// and untranslated paragraphs (with reasons), source-only prose suspects and
// paint time. Papers are read from APP_AUDIT_DIR and never copied into the
// repository; the report and the recorded replies go to APP_AUDIT_OUT.
//
// APP_AUDIT_MODE
//   real    the signed-in ChatGPT account of the user's own profile
//           (APP_AUDIT_PROFILE, else ~/.config/<id>-dev as `npm run dev`
//           uses, else ~/.config/<id>); every reply is recorded
//           (replies.jsonl). Close the <id> app first. settings.json is
//           restored afterwards (recent vaults, model).
//   replay  the recorded replies, no network: the same run again for free.
//           A request that was never recorded (batches or context changed
//           since) is answered paragraph by paragraph from recorded replies
//           to the same source text; a paragraph never recorded (its text
//           changed) gets a mock reply and is counted as a miss.
//   mock    Korean of APP_AUDIT_RATIO times the source length (default 0.6).
//   stored  APP_AUDIT_DIR is a vault translated in the app (its .<id>
//           folder kept): a copy is opened and every stored translation is
//           measured as drawn with the current code. No model is called.
// APP_AUDIT_ONLY  substring of the file names to include.
// APP_AUDIT_SKIP  substrings (a|b) of file names to leave out.
// APP_AUDIT_KEEP   a folder to copy the audited vault (with its translations) into.
// APP_AUDIT_SHOTS  translated pages to save as PNGs, e.g. "P19:17,23;P15:18".
const {_electron:electron}=require('playwright');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),dir=process.env.APP_AUDIT_DIR,mode=process.env.APP_AUDIT_MODE||'mock',ratio=Number(process.env.APP_AUDIT_RATIO||0.6);
const out=process.env.APP_AUDIT_OUT||path.join(os.tmpdir(),`${appName.id}-audit`),replies=path.join(out,'replies.jsonl');
const {measurePage}=require('./layout-measure.cjs');
const appName = require('../core/app-name.cjs');
if(!dir){console.error('APP_AUDIT_DIR is required');process.exit(2);}
if(!['real','replay','mock','stored'].includes(mode)){console.error('APP_AUDIT_MODE must be real, replay, mock or stored');process.exit(2);}

// Runs in the main process: replies are recorded (real), played back (replay)
// or made up (mock) at ChatGPT.respond / translate, the app's own boundary.
function stub({app,dialog},{mode,ratio,replies,recorded}){
  globalThis.openQueue=[];dialog.showOpenDialog=async()=>({canceled:false,filePaths:globalThis.openQueue.shift()});
  const {ChatGPT}=process.getBuiltinModule('module').createRequire(app.getAppPath()+'/package.json')('./desktop/chatgpt.cjs');
  const fs=process.getBuiltinModule('fs'),crypto=process.getBuiltinModule('crypto'),key=input=>crypto.createHash('sha256').update(typeof input?.[0]?.content==='string'?input[0].content:JSON.stringify(input)).digest('hex');
  globalThis.audit={misses:0,blockHits:0,blockMisses:0};
  // A translation request's paragraphs. Formula markers are named after the
  // paragraph's id and text, so they are compared by position only.
  const sources=input=>{try{return typeof input?.[0]?.content==='string'?JSON.parse(input[0].content).blocks?.map(b=>({id:b.id,text:b.text}))||null:null;}catch{return null;}};
  const marker=/PAPINOTE_MATH_\w+?_(\d+)_END/g,plain=text=>String(text).replace(marker,'⟦$1⟧').replace(/\s+/g,' ').trim();
  const filler='미생물 성장 곡선의 변동을 추정하는 계층적 통계 모형을 비교하고 그 결과를 해석합니다. ';
  // Korean filler of `ratio` times the source length, keeping formula markers.
  const mock=(text,ratio)=>{const tokens=text.match(/PAPINOTE_MATH_\w+?_END/g)||[],length=Math.max(4,Math.round(text.length*ratio));return (filler.repeat(Math.ceil(length/filler.length)).slice(0,length)+' '+tokens.join(' ')).trim();};
  if(mode==='real'){
    const respond=ChatGPT.prototype.respond;
    ChatGPT.prototype.respond=async function(model,input,instructions,signal,onDelta){
      const started=Date.now();
      try{const output=await respond.call(this,model,input,instructions,signal,onDelta);fs.appendFileSync(replies,JSON.stringify({key:key(input),model,ms:Date.now()-started,blocks:sources(input)||undefined,output})+'\n');return output;}
      catch(error){if(!signal?.aborted)fs.appendFileSync(replies,JSON.stringify({key:key(input),model,ms:Date.now()-started,error:error.message,status:error.status})+'\n');throw error;}
    };
    return;
  }
  ChatGPT.prototype.status=()=>({connected:true,usable:true,email:'audit@example.test',persistent:false});
  if(mode==='replay'){
    // A key answered several times (a retry) plays its answers in order.
    const byKey=new Map();for(const line of recorded){if(!byKey.has(line.key))byKey.set(line.key,[]);byKey.get(line.key).push(line);}
    // Paragraph replies by source text, from recordings that kept their
    // paragraphs (older recordings did not, and match whole requests only).
    const bySource=new Map();
    for(const line of recorded){
      if(!line.blocks||typeof line.output!=='string')continue;
      let reply;try{reply=JSON.parse(line.output.trim().replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/i,'$1'));}catch{continue;}
      const texts=new Map((Array.isArray(reply?.blocks)?reply.blocks:[]).filter(b=>typeof b?.text==='string'&&b.text.trim()).map(b=>[b.id,b.text]));
      for(const b of line.blocks)if(texts.has(b.id)&&!bySource.has(plain(b.text)))bySource.set(plain(b.text),plain(texts.get(b.id)));
    }
    const models=[...new Set(recorded.map(r=>r.model))];ChatGPT.prototype.models=async()=>models.map(id=>({id,name:id}));
    ChatGPT.prototype.respond=async(_model,input,_instructions,_signal,onDelta)=>{
      const list=byKey.get(key(input));
      if(!list?.length){
        globalThis.audit.misses++;
        const blocks=sources(input)||[];
        const output=JSON.stringify({blocks:blocks.map(b=>{
          const found=bySource.get(plain(b.text)),prefix=b.text.match(/PAPINOTE_MATH_\w+?_(?=\d+_END)/)?.[0];
          if(found===undefined){globalThis.audit.blockMisses++;return {id:b.id,text:mock(b.text,.6)};}
          globalThis.audit.blockHits++;return {id:b.id,text:found.replace(/⟦(\d+)⟧/g,(_,i)=>prefix+i+'_END')};
        })});
        onDelta?.(output);return output;
      }
      const line=list.length>1?list.shift():list[0];if(line.error){const error=Error(line.error);error.status=line.status;throw error;}
      onDelta?.(line.output);return line.output;
    };
    return;
  }
  if(mode==='stored'){ChatGPT.prototype.respond=async()=>{globalThis.audit.misses++;throw Error('the stored audit calls no model');};return;}
  ChatGPT.prototype.models=async()=>[{id:'mock',name:'Mock'}];
  ChatGPT.prototype.translate=async(_m,blocks)=>blocks.map(b=>({id:b.id,text:mock(b.text,ratio)}));
}

async function auditPaper(app,p,file,number){
  const before=await p.locator('.paper-item').count();
  await app.evaluate((_,f)=>globalThis.openQueue.push([f]),file);await p.locator('[data-action="add-files"]').first().click();
  try{await p.waitForFunction(n=>document.querySelectorAll('.paper-item').length>n,before,{timeout:20000});}catch{return {number,skipped:'not added (duplicate?)'};}
  await p.locator('.paper-item').last().click();await p.locator('.original-pages .page[data-page="1"]').waitFor({timeout:60000});
  if(!await p.locator('[data-mode="translated"].active').count())await p.locator('[data-mode="translated"]').click();
  await p.locator('#dialog [data-action="gpt-start"]').click({timeout:120000});
  const started=Date.now();
  await p.waitForFunction(()=>currentJob&&['completed','failed','cancelled'].includes(currentJob.state),null,{timeout:45*60000,polling:1000});
  const job=await p.evaluate(()=>({state:currentJob.state,message:currentJob.message,metrics:currentJob.metrics,timing:translationTimings.get(currentJob.id)||null,pages:currentJob.totalPages}));
  job.wallMs=Date.now()-started;
  if(job.state!=='completed')return {number,job};
  const count=await p.evaluate(()=>document.querySelector('.translated-pane .translated-pages').pdfViewer.pagesCount),pages=[];
  for(let i=1;i<=count;i++){pages.push(await measurePage(p,i));await shot(p,number,i);}
  return {number,job,pages};
}

// A paper of the opened vault with its stored translation, as drawn now.
// APP_AUDIT_SHOTS="P19:17,23;P15:18" saves those translated pages as PNGs in APP_AUDIT_OUT.
const shots=new Map((process.env.APP_AUDIT_SHOTS||'').split(';').filter(Boolean).map(s=>{const [n,list]=s.split(':');return [n,new Set(String(list||'').split(',').map(Number))];}));
async function shot(p,number,i){if(!shots.get(number)?.has(i))return;const sheet=p.locator(`.translated-sheet[data-page="${i}"]`);await sheet.scrollIntoViewIfNeeded();await p.waitForFunction(i=>{const s=document.querySelector(`.translated-sheet[data-page="${i}"]`);return s?.querySelector('canvas')?.width>0&&s.querySelector('.translation-layer[data-ready="true"]')&&!s.querySelector('.loadingIcon:not(.notVisible)');},i,{timeout:60000});await p.waitForTimeout(300);const size=p.viewportSize();await p.setViewportSize({width:size.width,height:2600});await sheet.scrollIntoViewIfNeeded();await p.waitForTimeout(800);await sheet.screenshot({path:path.join(out,`${number}-p${i}.png`)});await p.setViewportSize(size);}
async function storedPaper(p,id,number){
  await p.locator(`.paper-item[data-paper="${id}"]`).click();await p.locator('.original-pages .page[data-page="1"]').waitFor({timeout:60000});
  if(!await p.locator('[data-mode="translated"].active').count())await p.locator('[data-mode="translated"]').click();
  await p.waitForFunction(()=>document.querySelector('.translated-pane .translated-pages')?.pdfViewer?.pagesCount>0,null,{timeout:120000});
  const count=await p.evaluate(()=>document.querySelector('.translated-pane .translated-pages').pdfViewer.pagesCount),pages=[];
  for(let i=1;i<=count;i++){pages.push(await measurePage(p,i));await shot(p,number,i);}
  return {number,job:{state:'stored'},pages};
}

function summarize(paper){
  const sum=key=>paper.pages.reduce((n,pg)=>n+(typeof pg[key]==='number'?pg[key]:pg[key]?.length||0),0),reasons={};
  for(const pg of paper.pages)for(const m of pg.displaced)reasons[m.reason]=(reasons[m.reason]||0)+1;
  return {pages:paper.pages.length,translatable:sum('translatable'),inPlace:sum('inPlace'),displaced:sum('displaced'),reasons,untranslated:sum('untranslated'),english:sum('english'),overlaps:sum('overlaps'),clipped:sum('clipped'),maskOverGraphic:sum('maskOverGraphic'),sourceOnlyProse:sum('sourceOnlyProse'),squeezedHeadings:sum('squeezedHeadings'),paintMsMax:Math.max(0,...paper.pages.map(pg=>pg.paintMs)),paintMsAvg:Math.round(paper.pages.reduce((n,pg)=>n+pg.paintMs,0)/Math.max(1,paper.pages.length))};
}

(async()=>{
  await fs.mkdir(out,{recursive:true});
  // Numbers follow the whole folder, so a partial run keeps each paper's number.
  const all=(await fs.readdir(dir)).filter(f=>/\.pdf$/i.test(f)).sort(),skip=(process.env.APP_AUDIT_SKIP||'').split('|').filter(Boolean);
  const files=all.filter(f=>(!process.env.APP_AUDIT_ONLY||f.includes(process.env.APP_AUDIT_ONLY))&&!skip.some(s=>f.includes(s)));
  const recorded=mode==='replay'?(await fs.readFile(replies,'utf8')).split('\n').filter(Boolean).map(l=>JSON.parse(l)):[];
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),`${appName.id}-audit-`)),vault=path.join(temp,'vault');
  // The stored audit works on a copy: opening a vault writes to it.
  const stored=new Map();
  if(mode==='stored'){
    await fs.cp(dir,vault,{recursive:true,filter:f=>path.basename(f)!=='.git'});
    // A writer lease committed with a vault (another computer's app) does not hold the copy.
    await fs.rm(path.join(vault,appName.vaultDir,'writer.lock'),{force:true});
    const library=JSON.parse(await fs.readFile(path.join(vault,appName.vaultDir,'library.json'),'utf8'));
    for(const paper of library.papers)for(const a of paper.attachments||[])if(a.role==='original'&&await fs.access(path.join(vault,appName.vaultDir,`translation-${paper.id}.json`)).then(()=>true,()=>false))stored.set(a.path,paper.id);
  }else await fs.mkdir(vault);
  // The real account lives in the user's own profile; everything else in a throwaway one.
  const own=async()=>{for(const name of [`${appName.product}-dev`,appName.product]){const candidate=path.join(os.homedir(),'.config',name);if(await fs.access(path.join(candidate,'chatgpt-session.json')).then(()=>true,()=>false))return candidate;}throw Error(`No ${appName.product} profile with a ChatGPT connection; set APP_AUDIT_PROFILE.`);};
  const profile=mode==='real'?process.env.APP_AUDIT_PROFILE||await own():path.join(temp,'profile'),settings=path.join(profile,'settings.json');
  const savedSettings=mode==='real'?await fs.readFile(settings,'utf8').catch(()=>null):null;
  let app;const report={mode,ratio:mode==='mock'?ratio:undefined,at:new Date().toISOString(),papers:[]};
  try{
    app=await electron.launch({env:{...process.env,LC_ALL:'C.UTF-8'},executablePath:require('electron'),args:[root,'--no-sandbox','--ozone-platform=headless','--disable-gpu',`--user-data-dir=${profile}`],timeout:60000});
    const p=await app.firstWindow();p.setDefaultTimeout(60000);await p.setViewportSize({width:1500,height:1100});
    p.on('pageerror',e=>console.error('pageerror:',e.message));
    await app.evaluate(stub,{mode,ratio,replies,recorded});
    if(mode==='real'&&!(await p.evaluate(()=>window.appApi.authStatus())).usable)throw Error(`ChatGPT is not connected in the ${appName.id} profile; connect it in the app first.`);
    await app.evaluate((_,v)=>globalThis.openQueue.push([v]),vault);
    // The app may have opened the user's last vault; the audit uses its own.
    if(await p.locator('.welcome').count())await p.locator('[data-action="storage"]').first().click();else await p.evaluate(()=>actions.storage());
    await p.locator('.storage strong').filter({hasText:'vault'}).waitFor();
    for(const f of mode==='stored'?files.filter(f=>stored.has(f)):files){
      const number='P'+String(all.indexOf(f)+1).padStart(2,'0');console.log(`${number} ${f}`);
      let paper;try{paper=mode==='stored'?await storedPaper(p,stored.get(f),number):await auditPaper(app,p,path.join(dir,f),number);}catch(error){paper={number,error:error.message};}
      paper.file=f;if(paper.pages)paper.summary=summarize(paper);report.papers.push(paper);
      console.log('   ',JSON.stringify(paper.summary||paper.job||paper.error||paper.skipped));
      await fs.writeFile(path.join(out,`report-${mode}.json`),JSON.stringify(report,null,1));
      if(await p.locator('[data-action="back"]').count())await p.locator('[data-action="back"]').click();
    }
    if(mode==='stored')report.modelCalls=await app.evaluate(()=>globalThis.audit.misses);
    if(mode==='replay')Object.assign(report,await app.evaluate(()=>({replayMisses:globalThis.audit.misses,replayParagraphs:{hits:globalThis.audit.blockHits,misses:globalThis.audit.blockMisses}})));
  }finally{
    if(app)await app.close().catch(()=>{});
    if(savedSettings!==null)await fs.writeFile(settings,savedSettings);
    if(process.env.APP_AUDIT_KEEP){await fs.cp(vault,process.env.APP_AUDIT_KEEP,{recursive:true});console.log('vault kept at',process.env.APP_AUDIT_KEEP);}
    await fs.rm(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }).catch(error => console.warn(`임시 폴더를 다 지우지 못했습니다(${error.code}). 테스트 결과와는 무관합니다: ${temp}`));
  }
  const done=report.papers.filter(p=>p.summary),total={};
  for(const key of ['pages','translatable','inPlace','displaced','untranslated','english','overlaps','clipped','maskOverGraphic','sourceOnlyProse','squeezedHeadings'])total[key]=done.reduce((n,p)=>n+p.summary[key],0);
  const reasons={};for(const p of done)for(const [k,n] of Object.entries(p.summary.reasons))reasons[k]=(reasons[k]||0)+n;
  const invalid={};for(const p of report.papers)for(const [k,n] of Object.entries(p.job?.metrics?.invalid||{}))invalid[k]=(invalid[k]||0)+n;
  report.total={...total,reasons,invalid};
  await fs.writeFile(path.join(out,`report-${mode}.json`),JSON.stringify(report,null,1));
  const rows=report.papers.map(p=>p.summary?`| ${p.number} | ${p.summary.pages} | ${p.summary.translatable} | ${p.summary.inPlace} | ${p.summary.displaced} ${JSON.stringify(p.summary.reasons)} | ${p.summary.untranslated} | ${p.summary.english} | ${p.summary.overlaps} | ${p.summary.clipped} | ${p.summary.maskOverGraphic} | ${p.summary.sourceOnlyProse} | ${p.summary.squeezedHeadings} | ${p.summary.paintMsAvg}/${p.summary.paintMsMax} | ${p.job.timing?.firstDisplayMs?Math.round(p.job.timing.firstDisplayMs):''} | ${JSON.stringify(p.job.metrics?.invalid||{})} |`:`| ${p.number} | ${p.job?.state||p.error||p.skipped} |`);
  const md=`# Translation audit (${mode})\n\n| paper | pages | translatable | in place | displaced (reasons) | untranslated | english | overlaps | clipped | mask over graphic | source-only prose | squeezed headings | paint ms avg/max | first ms | invalid replies |\n|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|\n${rows.join('\n')}\n\nTotal: ${JSON.stringify(report.total)}\n${mode==='replay'?`\nReplay: ${report.replayMisses} requests not recorded as sent; their paragraphs ${JSON.stringify(report.replayParagraphs)} (hits answered from recorded paragraphs, misses mocked)\n`:''}`;
  await fs.writeFile(path.join(out,`report-${mode}.md`),md);console.log(md);
})().catch(error=>{console.error(error);process.exit(1);});
