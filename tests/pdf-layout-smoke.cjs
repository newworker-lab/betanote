// Source-mode regression for publisher-style PDF geometry; inference is mocked.
const {_electron:electron}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const appName = require('../core/app-name.cjs');
const toolShown = require('./tool-row.cjs'); // a tool a narrow pane keeps under ⋯ is brought out before it is used
process.env.APP_UI_LANG||='ko'; // the Korean screen, whatever the system's language (tests/app-executable.cjs)
const root=path.resolve(__dirname,'..');
function fixturePdf(){
 const text=(x,top,size,value,font='F1')=>`BT /${font} ${size} Tf ${x} ${792-top} Td (${value.replace(/[\\()]/g,'\\$&')}) Tj ET`;
 const prose=(x,top,lines,font='F1')=>lines.map((line,i)=>text(x,top+i*12,9,line,font)).join('\n');
 const first=[text(40,30,13,'PLOS COMPUTATIONAL BIOLOGY','F2'),text(200,105,8,'RESEARCH ARTICLE'),text(200,130,16,'A Bayesian non-parametric mixed-effects'),text(200,150,16,'model of microbial growth curves'),text(200,180,9,'Jane Doe','F2'),text(246,176,6,'1,2'),text(263,180,9,'John Roe','F2'),text(307,176,6,'3'),text(200,204,8,'1 Department of Biological Sciences, University of Durham'),text(200,217,8,'2 Department of Mathematics, University of Cambridge'),text(200,260,12,'Abstract'),prose(200,282,[
 'Environmental changes alter microbial population growth and its response.',
 'Traditional models describe growth curves using population averages.',
 'The observed data contain variation across experiments and strains.',
 'We introduce a Bayesian model with several random effects to describe',
 'this heterogeneity and estimate growth under changing conditions.',
 'Our approach combines measurements from independent experiments.',
 'Posterior estimates quantify uncertainty in the estimated parameters.',
 'The model is evaluated using simulated and experimental growth data.',
 'This analysis improves prediction and interpretation of microbial growth.'
 ]),'0.94 g 200 214 375 150 re f 0 g',text(210,446,11,'Author summary'),prose(210,468,[
 'Predicting microbial growth is important for food safety and health.',
 'Growth curves often vary across experimental conditions and strains.',
 'A statistical model can describe this variation using random effects.',
 'We compare predictions with independent laboratory measurements.',
 'Our results quantify uncertainty and explain differences between strains.',
 'This method helps researchers interpret microbial growth experiments.'
 ],'F3'),prose(40,345,['OPEN ACCESS','Citation: Doe J, Roe J (2020).','A Bayesian model of growth.','Editor: Example University','Received: January 16, 2020','Accepted: August 30, 2020','Published: October 26, 2020']),text(200,755,8,'PLOS Computational Biology | Research article | 1 / 2')].join('\n');
 const second=[text(40,45,13,'Results and discussion','F2'),prose(40,75,['We observed consistent changes in growth.','The estimated effects vary across strains.','The model describes experimental variation.']),prose(325,75,['Posterior predictions agree with observations.','Uncertainty increases at low temperatures.','The results support further investigation.']),text(210,180,14,'E = mc2'),'0.8 g 325 450 200 100 re f 0 g',text(325,360,9,'Figure 1. Growth measurements and estimates.')].join('\n');
 const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R 8 0 R] /Count 2 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R /F2 5 0 R /F3 6 0 R >> >> /Contents 7 0 R /Annots [10 0 R 11 0 R] >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>','<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman >>',`<< /Length ${Buffer.byteLength(first)} >>\nstream\n${first}\nendstream`,'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R /F2 5 0 R /F3 6 0 R >> >> /Contents 9 0 R >>',`<< /Length ${Buffer.byteLength(second)} >>\nstream\n${second}\nendstream`,'<< /Type /Annot /Subtype /Link /Rect [200 560 500 580] /A << /S /URI /URI (https://example.org/) >> >>','<< /Type /Annot /Subtype /Link /Border [0 0 1] /C [1 0 0] /Rect [220 300 500 318] /A << /S /URI /URI (https://example.org/summary) >> >>'];
 let output='%PDF-1.4\n',offsets=[0];for(const [i,obj] of objects.entries()){offsets.push(Buffer.byteLength(output));output+=`${i+1} 0 obj\n${obj}\nendobj\n`;}
 const start=Buffer.byteLength(output);output+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`+offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')+`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`;return output;
}
(async()=>{
 const temp=await fs.mkdtemp(path.join(os.tmpdir(),`${appName.id}-layout-`)),vault=path.join(temp,'vault'),pdf=path.join(temp,'publisher-layout.pdf');await fs.mkdir(vault);if(process.env.APP_REAL_PDF)await fs.copyFile(process.env.APP_REAL_PDF,pdf);else await fs.writeFile(pdf,fixturePdf());let app;
 try{
  app=await electron.launch({executablePath:require('electron'),args:[root,'--no-sandbox','--ozone-platform=headless','--disable-gpu',`--user-data-dir=${path.join(temp,'profile')}`]});const p=await app.firstWindow();p.setDefaultTimeout(15000);await p.setViewportSize({width:1500,height:1000});
  const errors=[];p.on('pageerror',e=>errors.push(e.message));
  await app.evaluate(({app,dialog,shell})=>{shell.openExternal=async url=>{globalThis.clickedExternal=url;};dialog.showSaveDialog=async()=>({canceled:false,filePath:app.getPath('userData')+'/continuation.pdf'});globalThis.choices=[];dialog.showOpenDialog=async()=>({canceled:false,filePaths:globalThis.choices.shift()});const {ChatGPT}=process.getBuiltinModule('module').createRequire(app.getAppPath()+'/package.json')('./desktop/chatgpt.cjs');ChatGPT.prototype.status=()=>({connected:true,usable:true});ChatGPT.prototype.models=async()=>[{id:'fixture',name:'Fixture'}];ChatGPT.prototype.translate=async(_m,blocks)=>blocks.map(b=>({id:b.id,text:/^Abstract$/.test(b.text)?'초록':/^RESEARCH ARTICLE$/.test(b.text)?'연구 논문':/^Results and discussion$/.test(b.text)?'결과 및 고찰':b.text.startsWith('A Bayesian')?'미생물 성장 곡선의 베이지안 비모수 혼합효과 모형':b.text.startsWith('Author summary')?'연구 요약':b.text.startsWith('Environmental')?'환경 변화는 미생물 집단의 성장과 반응에 영향을 미칩니다. 기존 모형은 집단 평균을 이용하여 성장 곡선을 설명합니다. 실험과 균주에 따른 변이를 기술하기 위해 여러 무작위 효과를 포함하는 베이지안 모형을 도입했습니다. 독립적인 실험의 측정값을 결합하고 사후 추정으로 불확실성을 정량화합니다. 모의 자료와 실제 성장 자료를 이용해 예측 성능을 평가했습니다.':'측정 자료를 분석하여 미생물 성장 곡선의 변화를 추정합니다. '.repeat(Math.max(1,Math.round(b.text.length/100)))}));});
  await app.evaluate((_,files)=>globalThis.choices.push(files),[vault]);await p.locator('[data-action="storage"]').first().click();await p.locator('.library').waitFor();await app.evaluate((_,files)=>globalThis.choices.push(files),[pdf]);await p.locator('[data-action="add-files"]').first().click();await p.locator('.paper-item').click();
  if(process.env.APP_INSPECT_ONLY){
    await p.locator('.original-pages canvas').first().waitFor();await p.locator('.original-pages .textLayer span').first().waitFor();
    assert.equal(await p.evaluate(()=>document.querySelector('.original-pages').pdfViewer.pagesCount),Number(process.env.APP_EXPECTED_PAGES||41));
    const span=p.locator('.original-pages .textLayer span').first(),query=(await span.innerText()).trim().slice(0,2);await (await toolShown(p, '.pdf-find-input')).fill(query);await p.waitForFunction(()=>document.querySelector('.original-pages').pdfController.findController.pageMatches.some(m=>m?.length));
    assert.deepEqual(errors,[]);console.log('PASS uploaded PDF: native viewer, text layer and find; no inference');return;
  }
  await p.locator('[data-mode="dual"]').click();await p.locator('[data-action="gpt-start"]').click();await p.locator('[data-action="gpt-export"]').waitFor();
  // The source layout view opens first; the section view is opt-in.
  await p.locator('.translated-sheet[data-page="1"] .translation-layer .translated-block').first().waitFor();assert.equal(await p.locator('.translated-pages.reading-translation').count(),0);
  // At 너비 맞춤 every pane's page starts at the pane's left edge, in line with its header (original and translation alike).
  {const offsets=await p.evaluate(()=>[...document.querySelectorAll('.pdf-pane')].map(pane=>{const header=pane.querySelector('header'),page=pane.querySelector('.page, .translated-sheet, .nb-page');if(!header||!page)return null;return Math.round(page.getBoundingClientRect().left-header.getBoundingClientRect().left);}).filter(v=>v!==null));assert.ok(offsets.length>=1&&offsets.every(v=>Math.abs(v)<=1),'page left edge against the pane header\'s left edge: '+offsets);}
  await (await toolShown(p, '[data-action="toggle-translation-reading"]')).click();await p.locator('.translated-sheet[data-page="1"] .translated-block').first().waitFor();
  await p.locator('.translation-section .section-heading').first().waitFor();
  assert.equal(await p.locator('.translated-pane .block-expand').count(),0);
  assert.ok(await p.locator('.translation-section').count()>1);
  assert.equal(await p.locator('.section-paragraph').evaluateAll(nodes=>nodes.every(n=>Math.abs(parseFloat(getComputedStyle(n).fontSize)-parseFloat(n.style.getPropertyValue('--type-size')))<.02)),true);

  async function wheelAcrossPages(selector){
    const pane=p.locator(selector),bounds=await pane.boundingBox();
    await p.mouse.move(bounds.x+bounds.width/2,bounds.y+bounds.height/2);
    const visible=()=>pane.evaluate(c=>Number([...c.querySelectorAll('[data-page]')].find(n=>n.getBoundingClientRect().bottom>c.getBoundingClientRect().top+20)?.dataset.page));
    for(let i=0;i<30&&await visible()<2;i++){await p.mouse.wheel(0,240);await p.waitForTimeout(70);}
    await p.waitForTimeout(300);
    assert.ok(await visible()>=2,selector+' must scroll from page 1 to page 2');
    for(let i=0;i<30&&await visible()>1;i++){await p.mouse.wheel(0,-240);await p.waitForTimeout(70);}
    await p.waitForTimeout(300);
    assert.equal(await visible(),1,selector+' must scroll back to page 1');
    await pane.evaluate(c=>{c.scrollTop=0;});await p.waitForTimeout(200);
  }
  await wheelAcrossPages('.original-pages');
  await wheelAcrossPages('.translated-pane .translated-pages');

  if(process.env.APP_SECTION_SCREENSHOT)await p.screenshot({path:process.env.APP_SECTION_SCREENSHOT});
  await p.evaluate(()=>document.querySelector('.translated-pane').addEventListener('app-section-select',e=>window.selectedSection=e.detail,{once:true}));
  await p.locator('.section-heading').first().click();
  assert.ok(await p.evaluate(()=>Boolean(window.selectedSection?.sectionId&&window.selectedSection?.anchors.length)));
  const originalViewer=await p.evaluate(()=>{window.retainedOriginal=document.querySelector('.original-pages');return true;});
  await (await toolShown(p, '[data-action="toggle-translation-reading"]')).click();
  await p.locator('.translated-sheet canvas').first().waitFor();
  assert.equal(await p.evaluate(()=>window.retainedOriginal===document.querySelector('.original-pages')),originalViewer);
  assert.equal(await p.evaluate(()=>document.querySelector('.original-pages').pdfViewer.constructor.name),'PDFViewer');
  assert.equal(await p.locator('.flow-translation').count(),0);
  await wheelAcrossPages('.original-pages');
  await wheelAcrossPages('.translated-pane .translated-pages');
  const geometry=await p.evaluate(()=>{const source=document.querySelector('.pdf-source-sheet'),sheet=document.querySelector('.translated-sheet');return {source:source.getBoundingClientRect().toJSON(),translated:sheet.getBoundingClientRect().toJSON(),height:parseFloat(sheet.style.height),blocks:[...sheet.querySelectorAll('.translated-block')].map(n=>({text:n.dataset.sourceText,source:n.classList.contains('source-preserved'),background:getComputedStyle(n).backgroundColor,top:parseFloat(n.style.top),left:parseFloat(n.style.left),position:getComputedStyle(n).position}))};});
  // Prototype .page min-height must never stretch PDF.js canvas independently
  // of its viewport and the translation coordinate system, especially at zoom out.
  for(const width of [900,1600,1500]){
    await p.setViewportSize({width,height:1000});
    await p.waitForFunction(()=>[...document.querySelectorAll('.native-pdf')].every(container=>{
      const view=container.pdfViewer?.getPageView(0);if(!view?.canvas)return false;
      const sheet=view.div.getBoundingClientRect(),canvas=view.canvas.getBoundingClientRect();
      return Math.abs(sheet.height-view.viewport.height)<1&&Math.abs(canvas.height-view.viewport.height)<1&&Math.abs(canvas.width-view.viewport.width)<1;
    }));
  }
  await p.waitForFunction(()=>document.querySelector('.translated-sheet[data-page="1"] .translation-layer[data-ready="true"] .translated-block'));
  // A link over a translated paragraph has lost its words: no box on the translation, still there on the original.
  if(!process.env.APP_REAL_PDF){const summary='.annotationLayer a[href="https://example.org/summary"]';await p.waitForFunction(s=>document.querySelector('.translated-sheet[data-page="1"] '+s)?.closest('.link-unmatched'),summary);assert.equal(await p.locator('.translated-sheet[data-page="1"] '+summary).isVisible(),false);assert.equal(await p.locator('.original-pages '+summary).isVisible(),true);}
  // Resize replaces PDF.js layers asynchronously. Query and measure in one
  // browser evaluation so detached handles cannot report empty computed styles.
  const fonts=await p.evaluate(()=>[...document.querySelectorAll('.translation-layer .translated-block')].map(n=>({id:n.dataset.blockId,font:getComputedStyle(n).fontSize,expected:n.style.getPropertyValue('--type-size'),family:getComputedStyle(n).fontFamily,serif:n.dataset.serif==='true',align:n.dataset.align})));
  assert.ok(fonts.length>0);
  const mismatchedFonts=fonts.filter(n=>!n.family.includes(n.serif?'Noto Serif KR':'Noto Sans KR')||!Number.isFinite(parseFloat(n.font))||!Number.isFinite(parseFloat(n.expected))||Math.abs(parseFloat(n.font)-parseFloat(n.expected))>=.02);
  assert.deepEqual(mismatchedFonts,[]);
  if(process.env.APP_LAYOUT_SCREENSHOT)await p.screenshot({path:process.env.APP_LAYOUT_SCREENSHOT});
  assert.ok(geometry.height>0);assert.ok(Math.abs(geometry.source.height-geometry.translated.height)<1);assert.ok(geometry.blocks.every(b=>b.position==='absolute'));
  if(!process.env.APP_REAL_PDF){
  assert.ok(geometry.blocks.some(b=>b.text.includes('Jane Doe')&&b.text.includes('1,2')));
  assert.ok(!geometry.blocks.some(b=>b.text==='1,2'||b.text==='3'));
  assert.ok(geometry.blocks.some(b=>b.text.startsWith('Environmental')));
  assert.ok(geometry.blocks.some(b=>b.text.startsWith('Predicting microbial')),JSON.stringify(geometry.blocks));
  assert.equal(await p.evaluate(()=>[...document.querySelectorAll('.translation-section[data-role=summary],.translation-layer .translated-block')].some(n=>getComputedStyle(n).backgroundColor==='rgb(240, 240, 240)')),true);
  }
  await p.locator('.original-pages .textLayer span').first().waitFor();
  assert.ok(await p.locator('.original-pages .textLayer span').count()>10);
  const selected=await p.locator('.original-pages .textLayer span').first().evaluate(n=>{const r=document.createRange();r.selectNodeContents(n);const s=getSelection();s.removeAllRanges();s.addRange(r);return s.toString();});assert.ok(selected.length>0);
  await (await toolShown(p, '.pdf-find-input')).fill('growth');await p.waitForFunction(()=>document.querySelector('.original-pages').pdfController.findController.pageMatches.some(p=>p?.length));
  if(!process.env.APP_REAL_PDF){await p.locator('.original-pages .annotationLayer a[href="https://example.org/"]').click();for(let i=0;i<50&&!await app.evaluate(()=>globalThis.clickedExternal);i++)await new Promise(r=>setTimeout(r,20));assert.equal(await app.evaluate(()=>globalThis.clickedExternal),'https://example.org/');}
  if(process.env.APP_REAL_PDF){
    if(process.env.APP_REAL_EXPORT){
      await p.evaluate(()=>saveGPTPdf());
      // Read the saved file directly: serializing millions of byte-array entries
      // through Playwright's object protocol can exhaust the test runner heap.
      const saved=await app.evaluate(({app})=>app.getPath('userData')+'/continuation.pdf');
      await fs.copyFile(saved,process.env.APP_REAL_EXPORT);
      const pdfjs=await import('pdfjs-dist/legacy/build/pdf.mjs');
      const task=pdfjs.getDocument({data:new Uint8Array(await fs.readFile(saved)),standardFontDataUrl:path.join(root,'node_modules/pdfjs-dist/standard_fonts/')});
      const pdf=await task.promise;let text='';
      for(let n=1;n<=pdf.numPages;n++){const page=await pdf.getPage(n);text+=' '+(await page.getTextContent()).items.map(i=>i.str||'').join(' ');page.cleanup();}
      const result={pages:pdf.numPages,text};await task.destroy();
      assert.match(result.text,/[가-힣]/);assert.ok(result.pages>=await p.evaluate(()=>translationRecord.pages.length));
      const expected=await p.evaluate(()=>translationRecord.pages.flatMap(page=>globalThis.appPdfLayout.layoutBlocks(page).filter(b=>!b.sourceOnly).map(b=>b.translation)));
      const normalized=result.text.replace(/\s/g,'');
      for(const text of expected)assert.ok(normalized.includes(text.replace(/\s/g,'')),`missing saved translation: ${text.slice(0,80)}`);
      console.log(`PASS actual source export: ${result.pages} pages, Korean searchable text and every mocked translation retained`);
    }
    assert.deepEqual(errors,[]);console.log('PASS supplied source PDF: native canvas, text selection, find and fixed layout; mocked inference');return;
  }
  await (await toolShown(p, '.source-tools [data-reader-step="1"]')).click();await p.locator('.translated-sheet[data-page="2"] .source-preserved').filter({hasText:'E = mc2'}).waitFor();assert.equal(await p.locator('.flow-translation').count(),0);
  assert.equal(await p.locator('.translated-sheet[data-page="2"]>.translation-layer').count(),1);
  const cacheFile=path.join(vault,appName.vaultDir,(await fs.readdir(path.join(vault,appName.vaultDir))).find(n=>/^translation-.*\.json$/.test(n)&&!n.endsWith('.chunks.json'))),cacheBytes=await fs.readFile(cacheFile);
  const original=await p.evaluate(()=>structuredClone(translationRecord));await p.evaluate(()=>{const b=translationRecord.pages[0].blocks.find(b=>b.text.startsWith('Environmental'));b.translation='긴 번역문입니다. '.repeat(1000)+'TRANSLATION_END';const pane=document.querySelector('.translated-pane .translated-pages');pane.observer?.disconnect();pane.remove();refreshTranslationPane();});
  await (await toolShown(p, '.source-tools [data-reader-step="-1"]')).click();const overflow=p.locator('.translated-sheet[data-page="1"] .block-clipped').filter({hasText:'긴 번역문입니다.'});await overflow.waitFor();assert.equal(await p.locator('.flow-translation').count(),0);assert.equal(await p.locator('.translated-sheet').first().evaluate(n=>Math.round(parseFloat(n.style.height))),Math.round(geometry.height));
  assert.equal(await overflow.evaluate(n=>getComputedStyle(n).outlineStyle),'none');
  assert.equal(await overflow.evaluate(n=>Number(n.dataset.fitScale)),.5,'a translation far longer than its box shrinks to half size at most');
  // Nothing leaves the page: the paragraph stays in its box, cut there, and the whole translation opens in the note panel.
  assert.equal(await p.locator('.layout-flow-continuation').count(),0);assert.equal(await overflow.evaluate(n=>n.classList.contains('source-preserved')),false);
  assert.equal(await overflow.locator('.translation-content').evaluate(n=>getComputedStyle(n).overflowY),'hidden');
  assert.equal(await overflow.evaluate(n=>Math.round(parseFloat(n.style.height))===Math.round(n.getBoundingClientRect().height/(n.closest('.translation-layer').getBoundingClientRect().width/Number(n.closest('.translation-layer').dataset.sourceWidth)))),true,'the box keeps its size');
  // The panel opens when the paragraph is pointed at; a pointer event lost while the page settles is given again.
  const panel=p.locator('.translation-note-pop');
  for(let i=0;i<5;i++){await overflow.hover();await p.mouse.move(...await overflow.boundingBox().then(box=>[box.x+box.width/2+3,box.y+box.height/2+2]));if(await panel.waitFor({timeout:3000}).then(()=>true,()=>false))break;await p.mouse.move(2,2);await p.waitForTimeout(300);}
  await panel.waitFor();assert.match(await panel.textContent(),/TRANSLATION_END$/);
  assert.equal(await panel.evaluate(n=>{const b=n.getBoundingClientRect();return b.left>=0&&b.top>=0&&b.right<=innerWidth&&b.bottom<=innerHeight;}),true);
  // No browser tooltip over the note: no paragraph of the translated page, nor what is around or in it, has a title (a
  // paragraph's warnings once went there and covered the panel).
  assert.deepEqual(await p.evaluate(()=>[...document.querySelectorAll('.translated-block')].flatMap(b=>{const out=[];for(let e=b;e&&!e.classList.contains('translated-sheet');e=e.parentElement)if(e.title)out.push(e.className+': '+e.title);for(const e of b.querySelectorAll('[title]'))if(e.title)out.push(e.className+': '+e.title);return out;})),[],'no titles on the translated paragraphs');
  assert.ok(await overflow.evaluate(n=>!n.title),'the hovered paragraph has none');await p.mouse.move(2,2);
  // What left the page is kept on the layer; nothing is laid over the page to say so (a notice there covered the text).
  assert.equal(await p.locator('.translated-sheet[data-page="1"] .translation-layer').getAttribute('data-overflow'),'1');assert.equal(await p.locator('.layout-reading-notice').count(),0);
  // 이 페이지 다시 번역 is a small mark in the corner until it is pointed at itself.
  // It is on the page, outside the scaled layer: 22 px on the screen whatever the page's size or zoom.
  {const retry=p.locator('.translated-sheet[data-page="1"] .page-retranslate'),size=async()=>{const box=await retry.boundingBox();return [Math.round(box.width),Math.round(box.height)];};
    assert.deepEqual(await size(),[22,22],'a small mark');assert.equal(await retry.evaluate(n=>n.parentElement.classList.contains('translated-sheet')&&!n.closest('.translation-layer')),true);
    const scale=()=>p.evaluate(()=>{const layer=document.querySelector('.translated-sheet[data-page="1"] .translation-layer');return layer?.dataset.ready==='true'?new DOMMatrix(getComputedStyle(layer).transform).a:0;}),before=await scale();
    const zoomTo=async(step,test)=>{await p.evaluate(step=>document.querySelector(`.translated-pane [data-reader-zoom="${step}"]`).click(),step);for(let i=0;i<100&&!test(await scale());i++)await p.waitForTimeout(100);await retry.waitFor();};
    await zoomTo('.1',now=>now>before+.01);assert.ok(await scale()>before,'the page is shown larger');
    assert.deepEqual(await size(),[22,22],'the same size when the page is shown larger');await zoomTo('-.1',now=>now&&Math.abs(now-before)<.001);
    await retry.hover();assert.ok((await retry.boundingBox()).width>60,'opens into the button when pointed at');await p.mouse.move(2,2);}
  // Cross the next physical page with real wheel input in both directions.
  await p.evaluate(()=>{const c=document.querySelector('.translated-pane .translated-pages');c.scrollTop=pageTop(c,c.querySelector('.translated-sheet[data-page="2"]'))-180;});
  await p.waitForTimeout(200);
  await wheelAcrossPages('.translated-pane .translated-pages');
  await (await toolShown(p, '.translated-pane [data-action="toggle-translation-reading"]')).click();
  const full=p.locator('.section-paragraph').filter({hasText:'TRANSLATION_END'});await full.waitFor();
  assert.equal(await p.locator('.translated-pane .block-expand').count(),0);
  assert.equal(await full.evaluate(n=>n.scrollHeight<=n.clientHeight+1&&getComputedStyle(n).position==='static'),true);
  await fs.writeFile(cacheFile,JSON.stringify(await p.evaluate(()=>translationRecord)));
  await p.evaluate(()=>saveGPTPdf());
  const printed=await app.evaluate(async({app})=>Array.from(await process.getBuiltinModule('fs/promises').readFile(app.getPath('userData')+'/continuation.pdf')));
  const output=await p.evaluate(async bytes=>{const pdfjs=await import('./pdfjs/pdf.mjs'),task=pdfjs.getDocument({data:new Uint8Array(bytes)}),doc=await task.promise;let text='';for(let n=1;n<=doc.numPages;n++)text+=' '+(await(await doc.getPage(n)).getTextContent()).items.map(i=>i.str||'').join(' ');const pages=doc.numPages;await task.destroy();return {pages,text};},printed);
  assert.ok(output.pages>2);assert.match(output.text,/TRANSLATION_END/);assert.doesNotMatch(output.text,/번역 보충/);
  for(const width of [1600,900]){await p.setViewportSize({width,height:1000});assert.equal(await full.evaluate(n=>n.scrollHeight<=n.clientHeight+1&&n.getBoundingClientRect().right<=n.closest('.translated-pages').getBoundingClientRect().right),true);}
  await (await toolShown(p, '[data-action="toggle-translation-reading"]')).click();

  await fs.writeFile(cacheFile,cacheBytes);
  await p.evaluate(record=>{translationRecord=record;const pane=document.querySelector('.translated-pane .translated-pages');pane.observer?.disconnect();pane.remove();refreshTranslationPane();},original);
  for(const width of [1600,900]){await p.setViewportSize({width,height:1000});await p.waitForFunction(()=>{const a=document.querySelector('.pdf-source-sheet'),b=document.querySelector('.translated-sheet');return a&&b&&Math.abs(a.getBoundingClientRect().height-b.getBoundingClientRect().height)<1;});assert.equal(await p.locator('.flow-translation').count(),0);}
  assert.deepEqual(errors,[]);console.log('PASS sections: bidirectional wheel scrolling across pages and long continuations, full flowing text, stable section anchors, source navigation, PDF.js layers, fixed geometry, grey summary, formula preservation, layout-preserving continuation export and resize; mocked inference');
 }finally{await app?.close();await fs.rm(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }).catch(error => console.warn(`임시 폴더를 다 지우지 못했습니다(${error.code}). 테스트 결과와는 무관합니다: ${temp}`));}
})().catch(error=>{console.error(error);process.exitCode=1;});
