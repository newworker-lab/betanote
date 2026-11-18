const {_electron:electron}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const appName = require('../core/app-name.cjs');
process.env.APP_UI_LANG||='ko'; // the Korean screen, whatever the system's language (tests/app-executable.cjs)
const root=path.resolve(__dirname,'..');
(async()=>{
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),`${appName.id}-print-`));let app;
  const b=(id,text,x,y,width,height,kind='body',fontSize=12)=>({id,text:kind==='caption'?(id==='table-caption'?'Table 1. Measurements.':'Figure 1. Results.'):'Original '+id,translation:text,x,y,width,height,fontSize,kind});
  const story=Array.from({length:220},(_,i)=>`문장${String(i).padStart(3,'0')} 미생물의 성장 곡선을 분석합니다. `).join('');
  const pages=[
    {width:816,height:1056,blocks:[b('title','베이지안 모형에 관한 연구 제목',60,90,690,60,'heading',24),b('left','FIRST_START '+story+' FIRST_END',60,180,300,160),{...b('right','SECOND_START Growth curves of Halobacterium salinarum NRC-1 '+story.slice(0,600)+' SECOND_END',450,180,300,160),heavy:true},{...b('caption','그림 1. Growth curves of Halobacterium salinarum NRC-1 under oxidative stress with model fits and posterior means. '+story.slice(0,900)+' CAPTION_END',60,820,690,50,'caption'),label:'caption-sentence'},b('note','NOTE_END 이 연구에서 사용한 자료의 주석입니다.',60,950,300,50,'footnote')]},
    {width:900,height:650,blocks:[b('short','NEXT_SOURCE_PAGE 정상 길이의 본문입니다.',100,100,700,200)]},
    {width:816,height:1056,blocks:[b('summary','SUMMARY_START '+story+' SUMMARY_END',267,140,500,240),b('metadata','문서의 부가 정보입니다.',48,140,180,100,'metadata')]},
    {width:816,height:1056,blocks:[b('table','측정 항목\t실험값\n조건 A\t12.4\n조건 B\t15.6',60,100,300,150,'table'),b('table-caption','표 1. 측정 조건별 결과입니다.',60,280,300,80,'caption'),b('annotation','ANNOTATION_END 실험 결과에 관한 주석입니다.',60,400,300,80,'annotation')]},
    {width:816,height:1056,blocks:[{...b('mixed','MIXED_START 유의 수준을 설정하고 모형을 평가합니다. MIXED_END',60,150,500,90),text:'Let α=β^2+γ_1, δ=ε^2, θ=λ_1+μ_2, ν=ξ^3, ρ=σ_4 and τ=φ^2 with χ=ψ_5 where ω=π_6 for each case here.'}]},
    {width:816,height:1056,blocks:[b('narrow','NARROW_START 아주 좁은 표 항목도 잘리지 않고 표시합니다. NARROW_END',620,150,6,90)]},
    {width:816,height:1056,blocks:[b('overflow-section','SECTION_START '+story+' SECTION_END',60,100,680,100),b('independent-heading','독립적인 다음 절',60,400,680,50,'heading',18),b('independent-body','다음 절의 짧은 본문은 원래 위치에 표시합니다.',60,470,680,100)]},
    {width:816,height:1056,blocks:[b('scripts','SCRIPT_START '+Array.from({length:120},(_,i)=>`분산 σ<sup>2</sup><sub>m${i}</sub>과 OD<sub>600</sub> 값${i}을 기록합니다. `).join('')+'SCRIPT_END',60,100,300,120)]}
  ];
  try{
    app=await electron.launch({executablePath:require('electron'),args:[root,'--no-sandbox','--ozone-platform=headless','--disable-gpu',`--user-data-dir=${path.join(temp,'profile')}`]});
    const ui=await app.firstWindow();
    const images=await ui.evaluate(pages=>pages.map((p,i)=>{const c=document.createElement('canvas');c.width=p.width;c.height=p.height;const x=c.getContext('2d');x.fillStyle='#fff';x.fillRect(0,0,c.width,c.height);if(i===2){x.fillStyle='#f0f0f0';x.fillRect(267,120,500,300);}return c.toDataURL('image/png');}),pages);
    const output=await app.evaluate(async({app,BrowserWindow},{pages,images,temp})=>{
      const require=process.getBuiltinModule('module').createRequire(app.getAppPath()+'/package.json'),fs=require('node:fs/promises'),path=require('node:path'),{pathToFileURL}=require('node:url');
      const {exportHtml}=require('./desktop/translation.cjs'),{preparePrintDocument,printText}=require('./core/pdf-print.cjs'),{backgroundSample,emphasis,MIN_FIT,MIN_FIT_LINE}=require('./core/pdf-layout.js');
      const fontDir=path.join(app.getAppPath(),'dist/fonts');
      const fontCss=(await fs.readFile(path.join(fontDir,'font.css'),'utf8')).replace(/url\(\.\/files\/([^)]*)\)/g,(_,name)=>`url("${pathToFileURL(path.join(fontDir,'files',name)).href}")`);
      const html=exportHtml(pages,images).replace('</style>',fontCss+'</style>');await fs.writeFile(path.join(temp,'print.html'),html);
      const printer=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});
      try{
        await printer.loadFile(path.join(temp,'print.html'));
        const adjustments=await printer.webContents.executeJavaScript(`(${preparePrintDocument.toString()})(${backgroundSample.toString()},${emphasis.toString()},${JSON.stringify({body:MIN_FIT,line:MIN_FIT_LINE})},${JSON.stringify(printText())})`);
        const layout=await printer.webContents.executeJavaScript(`Array.from(document.querySelectorAll('.page')).map(p=>({source:p.dataset.sourcePage,continuation:p.dataset.continuationFor,index:p.dataset.continuationIndex,emptyMasks:Array.from(p.querySelectorAll('.block')).filter(b=>!b.textContent.trim()).length,width:parseFloat(p.style.width),height:parseFloat(p.style.height),blocks:Array.from(p.querySelectorAll('.block')).filter(b=>b.textContent).map(b=>({id:b.dataset.blockId,role:b.dataset.typography,text:b.textContent,strong:b.querySelector('strong')?.textContent||'',x:parseFloat(b.style.left),y:parseFloat(b.style.top),width:parseFloat(b.style.width),height:parseFloat(b.style.height),font:parseFloat(getComputedStyle(b).fontSize),leading:parseFloat(getComputedStyle(b).lineHeight),weight:getComputedStyle(b).fontWeight,background:getComputedStyle(b).backgroundColor,overflow:b.scrollHeight>b.clientHeight+1||b.scrollWidth>b.clientWidth+1,subs:b.querySelectorAll('sub').length,sups:b.querySelectorAll('sup').length}))}))`);
        const bytes=await printer.webContents.printToPDF({printBackground:true,preferCSSPageSize:true,margins:{top:0,bottom:0,left:0,right:0}});await fs.writeFile(path.join(temp,'output.pdf'),bytes);
        return {adjustments,layout,bytes:Array.from(bytes)};
      }finally{printer.destroy();}
    },{pages,images,temp});
    const {layout}=output;
    assert.ok(output.adjustments.some(a=>a.page===1&&a.addedPages>=2));assert.ok(output.adjustments.some(a=>a.page===3&&a.addedPages>=1));
    assert.deepEqual(layout.filter(p=>p.source).map(p=>Number(p.source)),[1,2,3,4,5,6,7,8]);
    assert.ok(layout.find(p=>p.source==='7').blocks.some(b=>b.id==='independent-body'),'overflow must not displace the next section');
    assert.ok(layout.some(p=>p.continuation==='7'&&p.blocks.some(b=>b.id==='overflow-section')));
    for(const source of [1,3]){
      const start=layout.findIndex(p=>Number(p.source)===source),next=layout.findIndex(p=>Number(p.source)===source+1);
      assert.ok(layout.slice(start+1,next).every(p=>Number(p.continuation)===source));
    }
    for(const page of layout){
      assert.equal(page.emptyMasks,0,'empty translation masks must not cover source text');
      const original=pages[Number(page.source||page.continuation)-1];assert.equal(page.width,original.width);assert.equal(page.height,original.height);
      assert.ok(page.blocks.every(b=>!b.overflow&&b.x>=0&&b.x+b.width<=page.width+1&&b.y+b.height<=page.height));
      if(page.continuation)for(let i=0;i<page.blocks.length;i++)for(let j=i+1;j<page.blocks.length;j++){
        const a=page.blocks[i],b=page.blocks[j];assert.ok(Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x)<1||Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y)<1,'overlapping continuation blocks');
      }
    }
    const all=layout.flatMap(p=>p.blocks);
    // Script tags are markup: the printed text is the translation without them.
    for(const page of pages)for(const block of page.blocks)assert.equal(all.filter(b=>b.id===block.id).map(b=>b.text).join(''),block.translation.replace(/<\/?su[bp]>/g,''),`missing or repeated text: ${block.id}`);
    // Marked scripts print as real subscripts and superscripts, a split never cuts one, and no tag is printed as text.
    const scripted=all.filter(b=>b.id==='scripts');assert.ok(scripted.length>1,'the scripted paragraph continues on another page');
    assert.equal(scripted.reduce((n,b)=>n+b.subs,0),240);assert.equal(scripted.reduce((n,b)=>n+b.sups,0),120);
    const firstContinuations=layout.filter(p=>p.continuation==='1');assert.ok(firstContinuations.some(p=>p.blocks.some(b=>b.x===60)&&p.blocks.some(b=>b.x===450)));
    for(const page of pages)for(const block of page.blocks)assert.ok(all.filter(b=>b.id===block.id).every(b=>b.font>=(block.fontSize-2/3)*.65-.01&&b.font<=block.fontSize-2/3+.01),'source font size: '+block.id);
    assert.ok(all.some(b=>b.id==='left'&&Math.abs(b.font-(12-2/3)*.8)<.01),'long prose keeps the minimum fit size before continuing');
    const body=all.filter(b=>b.role==='body');assert.ok(body.every(b=>b.font>=(12-2/3)*.8-.01&&b.font<=12-2/3+.01&&Math.abs(b.leading-b.font*1.55)<.02));
    assert.ok(all.filter(b=>b.role==='footnote'||b.role==='annotation').every(b=>Math.abs(b.font-(12-2/3))<.01));
    assert.equal(all.find(b=>b.id==='caption').role,'figure-caption');assert.equal(all.find(b=>b.id==='table-caption').role,'table-caption');assert.ok(Math.abs(all.find(b=>b.id==='table').font-(12-2/3))<.01);
    assert.ok(all.filter(b=>b.id==='summary').every(b=>b.x===267&&b.width===500&&b.background==='rgb(240, 240, 240)'));
    const parsed=await ui.evaluate(async bytes=>{
      const pdfjs=await import('./pdfjs/pdf.mjs');pdfjs.GlobalWorkerOptions.workerSrc=new URL('./pdfjs/pdf.worker.mjs',location.href).href;const task=pdfjs.getDocument({data:new Uint8Array(bytes)}),pdf=await task.promise;const pages=[];
      for(let n=1;n<=pdf.numPages;n++){const p=await pdf.getPage(n),t=await p.getTextContent();pages.push({width:p.view[2],height:p.view[3],text:t.items.map(i=>i.str||'').join(' '),items:t.items.filter(i=>i.str).map(i=>({text:i.str,size:Math.hypot(i.transform[2],i.transform[3]),x:i.transform[4],y:i.transform[5]}))});}
      const p=await pdf.getPage(2),v=p.getViewport({scale:4/3}),c=document.createElement('canvas');c.width=v.width;c.height=v.height;await p.render({canvasContext:c.getContext('2d'),viewport:v}).promise;const image=c.toDataURL('image/png');await task.destroy();return {pages,image};
    },output.bytes);
    assert.equal(parsed.pages.length,layout.length);const text=parsed.pages.map(p=>p.text).join(' ');assert.match(text,/FIRST_END/);assert.match(text,/SUMMARY_END/);assert.match(text,/ANNOTATION_END/);assert.match(text,/MIXED_END/);assert.match(text.replace(/\s/g,''),/NARROW_END/);assert.ok(all.filter(b=>b.id==='narrow').every(b=>b.width>=21.3));assert.match(text.replace(/\s/g,''),/유의/);
    assert.doesNotMatch(text,/<\/?su[bp]>|&lt;su[bp]/,'no script tag is printed as text');const compact=text.replace(/\s/g,'');assert.match(compact,/SCRIPT_START분산σ2m0과OD600값0을기록합니다\./);assert.match(compact,/분산σ2m119과OD600값119을기록합니다\.SCRIPT_END/);
    const mixedSource=layout.find(p=>p.source==='5');assert.ok(!mixedSource.blocks.some(b=>b.id==='mixed'));assert.ok(layout.some(p=>p.continuation==='5'&&p.blocks.some(b=>b.id==='mixed')));
    // No section-wide cascade: the neighbour that starts in place stays on the source page.
    assert.match(parsed.pages[0].text,/FIRST_START/);assert.match(parsed.pages[0].text,/SECOND_START/);assert.ok(text.indexOf('FIRST_END')<text.indexOf('NEXT_SOURCE_PAGE'));
    // Bold caption titles and all-bold blocks are measured as drawn: the split caption keeps its bold title in place and nothing overflows.
    assert.match(text,/CAPTION_END/);assert.equal(layout.find(p=>p.source==='1').blocks.find(b=>b.id==='caption').strong,'그림 1. Growth curves of Halobacterium salinarum NRC-1 under oxidative stress with model fits and posterior means.');assert.ok(text.indexOf('SECOND_END')<text.indexOf('NEXT_SOURCE_PAGE'));
    assert.ok(parsed.pages.flatMap(p=>p.items).filter(i=>i.text.includes('문장')).every(i=>i.size>=6.4-.05&&i.size<=8+.05));
    if(process.env.APP_PRINT_PDF)await fs.writeFile(process.env.APP_PRINT_PDF,Buffer.from(output.bytes));
    if(process.env.APP_PRINT_SCREENSHOT)await fs.writeFile(process.env.APP_PRINT_SCREENSHOT,Buffer.from(parsed.image.split(',')[1],'base64'));
    console.log(`PASS printed ${layout.length} pages: adjacent continuations, two columns, inherited widths, grey summary, typography roles, mixed paper sizes, no overlap, exact text conservation and rendered PDF tail`);
  }finally{await app?.close();await fs.rm(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }).catch(error => console.warn(`임시 폴더를 다 지우지 못했습니다(${error.code}). 테스트 결과와는 무관합니다: ${temp}`));}
})().catch(e=>{console.error(e);process.exitCode=1});
