// Measures the wait after the translate button: from choosing the translated
// view to the model dialog (prepareMs), and from 번역 시작 to the first
// request reaching the model (startMs) and the first translated paragraph on
// screen (firstBlockMs); then the same for 다시 번역 of the finished paper
// (retranslate), and for 다시 번역 after restarting the app (afterRestart). A PAGES-page two-column paper (default 30) is
// generated; the model list answers after MODELS_MS (default 400, a network
// round trip) and THINK_MS (default 0) is how long the dialog stays open.
// Runs the app from source with the model stubbed; prints JSON.
const {_electron:electron}=require('playwright');
const {PDFDocument,StandardFonts}=require('pdf-lib');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const appName = require('../core/app-name.cjs');
const root=path.resolve(__dirname,'..'),PAGES=Number(process.env.PAGES||30),MODELS_MS=Number(process.env.MODELS_MS||400),THINK_MS=Number(process.env.THINK_MS||0);
async function paper(file){
  const doc=await PDFDocument.create(),serif=await doc.embedFont(StandardFonts.TimesRoman),bold=await doc.embedFont(StandardFonts.HelveticaBold);
  const words='the method measures how ideas connect across papers and reports results that readers compare with earlier work in this field'.split(' ');
  for(let n=1;n<=PAGES;n++){
    const page=doc.addPage([612,792]);page.drawText(`${n} Section ${n}`,{x:54,y:740,size:12,font:bold});
    for(let col=0;col<2;col++)for(let line=0;line<52;line++){
      if(line%13===12)continue;
      const text=Array.from({length:9},(_,i)=>words[(n*7+col*5+line*3+i)%words.length]).join(' ');
      page.drawText(text,{x:54+col*258,y:716-line*12.4,size:9.5,font:serif});
    }
    page.drawText(`Figure ${n}. Results of the experiment on page ${n}.`,{x:54,y:60,size:9,font:serif});
  }
  await fs.writeFile(file,await doc.save());
}
async function launch(profile){
  const app=await electron.launch({env:{...process.env,LC_ALL:'C.UTF-8'},executablePath:require('electron'),args:[root,'--no-sandbox','--ozone-platform=headless','--disable-gpu',`--user-data-dir=${profile}`]});
  const p=await app.firstWindow();p.setDefaultTimeout(60000);await p.setViewportSize({width:1400,height:900});p.on('pageerror',e=>{console.error(e);process.exitCode=1;});
  await app.evaluate(({app,dialog},delay)=>{
    globalThis.q=[];dialog.showOpenDialog=async()=>({canceled:false,filePaths:globalThis.q.shift()});
    const {ChatGPT}=process.getBuiltinModule('module').createRequire(app.getAppPath()+'/package.json')('./desktop/chatgpt.cjs');
    ChatGPT.prototype.status=()=>({connected:true,usable:true,email:'bench@example.test',persistent:false});
    // Only the network is stubbed, so the app's own model-list reuse is measured.
    ChatGPT.prototype.access=async()=>'bench-token';
    ChatGPT.prototype.json=async url=>{if(!String(url).endsWith('/models'))throw Error('unexpected request '+url);await new Promise(r=>setTimeout(r,delay));return {models:[{slug:'bench-model',display_name:'Bench nano',visibility:'list'}]};};
    globalThis.answer='연구 논문은 아이디어를 연결합니다.';ChatGPT.prototype.translate=async(_m,blocks)=>{globalThis.firstRequest??=Date.now();return blocks.map(b=>({id:b.id,text:globalThis.answer}));};
  },MODELS_MS);
  return {app,p};
}
// Timed in the page (Date.now shares the clock with the main process): the
// click that opens the dialog, the dialog itself, 번역 시작, and the first
// paragraph starting with `text`.
async function watch(p,text){
  await p.evaluate(text=>{document.querySelector('#gpt-model')?.remove();window.benchText=text;window.benchTimes={};if(window.benchWatching)return;window.benchWatching=true;const t=()=>window.benchTimes;window.addEventListener('click',e=>{const b=e.target.closest('[data-mode="translated"],[data-action="gpt-retranslate"],[data-action="gpt-start"]');if(b)t()[b.dataset.action==='gpt-start'?'start':'open']=Date.now();},true);new MutationObserver(()=>{if(!t().dialog&&document.querySelector('#gpt-model'))t().dialog=Date.now();if(!t().block&&[...document.querySelectorAll('.translated-block')].some(n=>n.textContent.startsWith(window.benchText)))t().block=Date.now();}).observe(document.body,{subtree:true,childList:true,characterData:true});},text);
}
async function run(app,p,open,text){
  await app.evaluate((_,text)=>{globalThis.firstRequest=null;globalThis.answer=text;},text);await watch(p,text.slice(0,2));
  await open();await p.locator('#gpt-model').waitFor({ state: 'attached' });
  if(THINK_MS)await p.waitForTimeout(THINK_MS);
  await p.locator('#dialog [data-action="gpt-start"]').click();
  let first;while(!(first=await app.evaluate(()=>globalThis.firstRequest)))await p.waitForTimeout(10);
  await p.waitForFunction(()=>window.benchTimes.block);const t=await p.evaluate(()=>window.benchTimes);
  await p.locator('[data-action="gpt-export"]').waitFor();
  return {prepareMs:t.dialog-t.open,startMs:first-t.start,firstBlockMs:t.block-t.start};
}
(async()=>{
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),`${appName.id}-start-bench-`)),vault=path.join(temp,'vault'),profile=path.join(temp,'profile');await fs.mkdir(vault);await paper(path.join(temp,'paper.pdf'));
  let {app,p}=await launch(profile);
  try{
    await app.evaluate((_,v)=>globalThis.q.push([v]),vault);await p.locator('[data-action="storage"]').first().click();
    await app.evaluate((_,f)=>globalThis.q.push([f]),path.join(temp,'paper.pdf'));await p.locator('[data-action="add-files"]').first().click();
    await p.locator('.paper-item').click();await p.locator('.original-pages .page[data-page="1"] .textLayer span').first().waitFor();
    const translate=await run(app,p,()=>p.locator('[data-mode="translated"]').click(),'연구 논문은 아이디어를 연결합니다.');
    const retranslate=await run(app,p,()=>p.locator('[data-action="gpt-retranslate"]').click(),'다시 번역한 문장입니다.');
    // After a restart: the app reopens the vault, the model list is not fetched yet.
    await app.close();({app,p}=await launch(profile));
    await p.locator('.paper-item').click();if(!await p.locator('[data-mode="translated"].active').count())await p.locator('[data-mode="translated"]').click();await p.locator('[data-action="gpt-retranslate"]').waitFor();
    const afterRestart=await run(app,p,()=>p.locator('[data-action="gpt-retranslate"]').click(),'재시작 후 번역한 문장입니다.');
    console.log(JSON.stringify({pages:PAGES,modelsMs:MODELS_MS,thinkMs:THINK_MS,translate,retranslate,afterRestart}));
  }finally{await app.close();await fs.rm(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }).catch(error => console.warn(`임시 폴더를 다 지우지 못했습니다(${error.code}). 테스트 결과와는 무관합니다: ${temp}`));}
})().catch(e=>{console.error(e);process.exit(1);});
