// Measures page-classification work (layoutBlocks) while a translation streams
// in: 6 pages of 40 paragraphs, one paragraph every GAP ms (default 150).
// OLD=1 drops the per-page reuse to show the earlier cost. Prints JSON.
const root=require('node:path').resolve(__dirname,'..');
const layout=require(root+'/core/pdf-layout.js');
let calls=0,ms=0;const original=layout.layoutBlocks;
layout.layoutBlocks=(...a)=>{calls++;const t=performance.now();try{return original(...a);}finally{ms+=performance.now()-t;}};
const {TranslationJobs}=require(root+'/desktop/translation.cjs');
const {Library}=require(root+'/desktop/storage.cjs');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const appName = require('../core/app-name.cjs');
(async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),`${appName.id}-bench-`));await fs.mkdir(path.join(dir,'vault'));
  const pdf=path.join(dir,'p.pdf');await fs.writeFile(pdf,'%PDF-1.4\nbench');const library=await Library.open(path.join(dir,'vault'));
  const [r]=await library.importFiles([pdf]);const paperId=r.paper?.id??library.data.papers[0].id,hash=library.data.papers[0].attachments[0].sourceHash;
  const page=n=>({width:600,height:800,blocks:Array.from({length:40},(_,i)=>({id:`p${n}-b${i}`,text:`Paragraph ${i} on page ${n} describes the experiment and its results in some detail for the reader.`,x:40,y:20+i*19,width:520,height:16,fontSize:11}))});
  const pages=Array.from({length:6},(_,i)=>page(i+1));
  let publishes=0;const pub=TranslationJobs.prototype.publishPartial;TranslationJobs.prototype.publishPartial=function(...a){publishes++;if(process.env.OLD)a[1].layout=null;return pub.apply(this,a);};
  // Streams one paragraph every 40 ms, like a model writing its answer.
  const auth={status:()=>({usable:true}),models:async()=>[{id:'m'}],translate:async(_m,blocks,_s,_c,onUnit)=>{for(const b of blocks){await new Promise(r=>setTimeout(r,Number(process.env.GAP||150)));onUnit?.(b.id,'번역 '+b.id);}return blocks.map(b=>({id:b.id,text:'번역 '+b.id}));}};
  const jobs=new TranslationJobs(auth);calls=0;ms=0;
  const t0=performance.now();const job=await jobs.start(library,paperId,hash,pages,'m');
  while(jobs.result(job.id).state==='running')await new Promise(r=>setTimeout(r,20));
  const total=performance.now()-t0;
  console.log(JSON.stringify({state:jobs.result(job.id).state,pages:pages.length,blocksPerPage:40,publishes,layoutCalls:calls,layoutMs:+ms.toFixed(1),perCallMs:+(ms/Math.max(1,calls)).toFixed(2),jobMs:Math.round(total)}));
  await fs.rm(dir,{recursive:true,force:true});
})().catch(e=>{console.error(e);process.exit(1);});
