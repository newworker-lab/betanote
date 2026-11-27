// Run after npm run package. Exercises the packaged application, not an HTML mock.
process.env.APP_SHOW_HIDDEN_FEATURES = '1'; // collections are hidden in the product but still tested
const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const appName = require('../core/app-name.cjs');
const toolShown = require('./tool-row.cjs'); // a tool a narrow pane keeps under ⋯ is brought out before it is used
const root = path.resolve(__dirname, '..');
async function pdf(file,paperText='A research paper connects ideas.') {
  const stream='0.94 g 35 700 500 70 re f 0 g BT /F1 12 Tf 40 740 Td ('+paperText+') Tj ET';
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R 6 0 R] /Count 2 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', '<< /Length '+stream.length+' >>\nstream\n'+stream+'\nendstream','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>'];
  let text = '%PDF-1.4\n', offsets = [0];
  for (let i=0;i<objects.length;i++) { offsets.push(Buffer.byteLength(text)); text += `${i+1} 0 obj\n${objects[i]}\nendobj\n`; }
  const xref=Buffer.byteLength(text); text += 'xref\n0 7\n0000000000 65535 f \n'+offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')+`trailer\n<< /Size 7 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  await fs.writeFile(file,text);
}
(async()=>{
 const temp=await fs.mkdtemp(path.join(os.tmpdir(),`${appName.id}-e2e-`)), vault=path.join(temp,'연구 자료'), second=path.join(temp,'두 번째 저장소');
 await fs.mkdir(vault); await fs.mkdir(second); await pdf(path.join(temp,'원문.pdf')); await pdf(path.join(temp,'번역.pdf'));
 const executable=require('./app-executable.cjs')(root),sourceMode=process.env.APP_TEST_SOURCE==='1';
// Memos are folded until chosen: the first one is opened when a step needs the memo field.
const openNote = async p => { await p.locator('#note, .memo-card[data-memo], .memo-tab [data-action="memo-new"]').first().waitFor(); if (!await p.locator('#note').count()) await (await p.locator('.memo-card[data-memo]').count() ? p.locator('.memo-card[data-memo]').first() : p.locator('.memo-tab [data-action="memo-new"]')).click(); await p.locator('#note').waitFor({ state: 'attached' }); return p.locator('#note'); };
 let app;
 const utf8Env=()=>/utf-?8/i.test(process.env.LC_ALL||process.env.LC_CTYPE||process.env.LANG||'')?process.env:{...process.env,LC_ALL:'C.UTF-8',LANG:'C.UTF-8'};
 async function launch(){
  // Chromium converts native file paths with the process locale; without a
  // UTF-8 locale (POSIX in containers) Korean file names never reach the input.
  app=await electron.launch({env:utf8Env(),executablePath:executable,args:[...(sourceMode?[root]:[]),'--no-sandbox','--ozone-platform=headless','--disable-gpu',`--user-data-dir=${path.join(temp,'profile')}`],timeout:20000});
  const p=await app.firstWindow();p.setDefaultTimeout(10000);
  p.on('pageerror',e=>{console.error(e);process.exitCode=1});p.on('console',m=>{if(m.type()==='error')console.error('renderer:',m.text());});
  // On Linux the app leaves video acceleration off (main.cjs; no video, and no VAAPI line from an older libva); elsewhere it does not.
  assert.deepEqual(await app.evaluate(({app})=>['disable-accelerated-video-decode','disable-accelerated-video-encode'].map(name=>app.commandLine.hasSwitch(name))),process.platform==='linux'?[true,true]:[false,false]);
  await app.evaluate(({dialog,shell})=>{globalThis.dialogQueue=[];dialog.showOpenDialog=async()=>({canceled:false,filePaths:globalThis.dialogQueue.shift()});shell.openExternal=async url=>{globalThis.openedProvider=url}});
  await app.evaluate(({app,dialog,net},out)=>{
    const originalFetch=net.fetch.bind(net);net.fetch=(url,options)=>String(url).startsWith('https://api.crossref.org/works/')?Promise.resolve(new Response(JSON.stringify({message:{DOI:decodeURIComponent(String(url).split('/works/')[1]),title:['복구검증'],author:[{given:'API',family:'연구자'}],published:{'date-parts':[[2026]]},'container-title':['Fixture Journal']}}),{headers:{'Content-Type':'application/json'}})):originalFetch(url,options);
    dialog.showSaveDialog=async()=>{globalThis.exportDialogOpened=true;return {canceled:false,filePath:out}};
    const {ChatGPT}=process.getBuiltinModule('module').createRequire(app.getAppPath()+'/package.json')('./desktop/chatgpt.cjs');
    ChatGPT.prototype.status=function(){return {connected:true,usable:true,email:'fixture@example.test',persistent:false}};
    ChatGPT.prototype.models=async()=>[{id:'slow-model',name:'Slow'},{id:'fixture-model',name:'Fixture GPT nano'}];globalThis.inferenceCalls=[];
    ChatGPT.prototype.explainFigure=async(model,image,context,signal)=>{globalThis.figureRequest={model,image,context};if(context.question==='cancel')await new Promise((resolve,reject)=>signal.addEventListener('abort',()=>{globalThis.figureAborted=true;reject(Error('cancelled'))},{once:true}));return '가로축은 시간이고 세로축은 성장률입니다. <script>실행하지 않음</script>';};
    ChatGPT.prototype.translate=async(_model,blocks)=>{globalThis.inferenceCalls.push(blocks[0].id);return blocks.map(b=>({id:b.id,text:'연구 논문은 아이디어를 연결합니다.'}))};
  },path.join(temp,'export.pdf'));
  return p;
 }
 async function choose(paths){await app.evaluate((_,paths)=>globalThis.dialogQueue.push(paths),paths)}
 try {
  let p=await launch();await choose([vault]);await p.locator('[data-action="storage"]').first().click();await p.locator('.library').waitFor();
  await choose([path.join(temp,'원문.pdf')]);await p.locator('[data-action="add-files"]').first().click();await p.locator('.paper-item').waitFor();
  await p.locator('.paper-item').click();await (await openNote(p)).fill('재시작 후에도 남는 메모');await p.locator('#saved').filter({hasText:'저장소에 저장됨'}).waitFor();
  assert.equal(await p.locator('.pdf-review-notice').count(),0);
  assert.deepEqual(await p.locator('.reader-panel .tabs [data-tab]').allTextContents(),['서지','첨부','AI','주석','메모','태그']);
  // Tabs that do not fit (a narrower row than the narrowest panel, e.g. with large text) stay on one line: a thin bar and Shift+wheel scroll them, and a chosen tab stays in view.
  const tabRow=await p.evaluate(async()=>{const shell=document.querySelector('.shell'),width=shell.style.getPropertyValue('--panel-width');shell.style.setProperty('--panel-width','220px');document.head.insertAdjacentHTML('beforeend','<style id="tab-narrow">.reader-panel>.tabs{max-width:150px}</style>');await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));const t=document.querySelector('.reader-panel>.tabs'),overflow=t.scrollWidth>t.clientWidth;t.dispatchEvent(new WheelEvent('wheel',{deltaY:60,shiftKey:true,bubbles:true,cancelable:true}));const moved=t.scrollLeft===Math.min(60,t.scrollWidth-t.clientWidth)&&t.scrollLeft>0;document.querySelector('.reader-panel [data-tab="태그"]').click();await new Promise(r=>setTimeout(r,50));const n=document.querySelector('.reader-panel>.tabs'),a=n.querySelector('.active').getBoundingClientRect(),r=n.getBoundingClientRect(),rows=new Set([...n.children].map(b=>Math.round(b.getBoundingClientRect().top))).size;document.querySelector('.reader-panel [data-tab="메모"]').click();shell.style.setProperty('--panel-width',width);return {overflow,moved,rows,visible:a.left>=r.left&&a.right<=r.right};});
  await p.evaluate(()=>document.querySelector('#tab-narrow')?.remove());
  assert.deepEqual(tabRow,{overflow:true,moved:true,rows:1,visible:true});assert.equal(await p.locator('.reader-panel [data-tag-editor]').count(),0);
  await p.evaluate(()=>{window.pdfBefore=document.querySelector('.original-pages')});await p.locator('[data-tab="태그"]').click();
  await p.getByRole('combobox',{name:'새 태그',exact:true}).fill('보존할 태그');await p.locator('[data-tag-form] button').click();
  await p.locator('[data-remove-tag="보존할 태그"]').waitFor();
  await p.getByRole('combobox',{name:'새 태그',exact:true}).fill('삭제할 태그');await p.locator('[data-tag-form] button').click();
  await p.locator('[data-remove-tag="삭제할 태그"]').click();await p.waitForFunction(()=>!document.querySelector('[data-remove-tag="삭제할 태그"]'));
  assert.equal(await p.evaluate(()=>window.pdfBefore===document.querySelector('.original-pages')),true);await p.locator('[data-tab="메모"]').click();assert.equal(await (await openNote(p)).inputValue(),'재시작 후에도 남는 메모');assert.equal(await p.locator('.reader-panel [data-tag-editor]').count(),0);
  const originalUrl=await p.locator('.original-pages').getAttribute('data-source-url');
  const response=await app.evaluate(async({net},url)=>{const r=await net.fetch(url);return {status:r.status,start:(await r.text()).slice(0,5)}},originalUrl);
  assert.equal(response.status,200);assert.equal(response.start,'%PDF-');
  assert.equal(await p.locator('[data-action="translation"]').count(),0);
  await p.locator('[data-mode="dual"]').click();await p.locator('#gpt-model').waitFor({ state: 'attached' });assert.equal(await p.locator('#gpt-model').inputValue(),'fixture-model');await p.locator('[data-action="gpt-start"]').click();
  await p.locator('.translated-sheet canvas').first().waitFor();assert.equal(await p.locator('.translated-pages.reading-translation').count(),0);assert.equal(await p.locator('.translated-pane .block-expand').count(),0);
  await p.locator('.translated-sheet').first().waitFor();await p.locator('.translated-sheet canvas').first().waitFor();
  assert.match(await p.locator('.translated-block').first().innerText(),/연구 논문/);
  assert.equal(await p.locator('.original-pages').count(),1);await p.locator('.original-pages canvas').first().waitFor();
  await p.locator('[data-action="gpt-export"]').waitFor();

  await p.locator('.translated-block').first().waitFor();assert.equal(await p.locator('.translated-block[title]').count(),0,'no source-text tooltip over translations');assert.equal(await p.locator('.translated-block').first().evaluate(node=>getComputedStyle(node).backgroundColor),'rgb(240, 240, 240)');
  await p.locator('[data-action="figure-open"]').click();await p.locator('.figure-capture-hint').waitFor();await p.locator('[data-figure-capture="dialog"]').click();await p.locator('#figure-status').filter({hasText:'그림 영역을 선택하세요.'}).waitFor();
  assert.equal(await p.locator('[data-action="figure-send"]').isDisabled(),true);
  const invalidFigure=await p.evaluate(async()=>{const s=figureSession;try{await window.appApi.explainFigure(s.id,s.paperId,s.attachmentId,s.hash,'fixture-model','https://invalid.test/image.png',{page:1,caption:'',question:''});return '';}catch(e){return e.message;}});assert.match(invalidFigure,/이미지/);
  const staleFigure=await p.evaluate(async()=>{const s=figureSession;try{await window.appApi.explainFigure(s.id,s.paperId,s.attachmentId,'stale','fixture-model','data:image/png;base64,aGVsbG8=',{page:1,caption:'',question:''});return '';}catch(e){return e.message;}});assert.match(staleFigure,/원문이 변경/);

  const figureBounds=await p.locator('.figure-canvas').boundingBox();await p.mouse.move(figureBounds.x+30,figureBounds.y+20);await p.mouse.down();await p.mouse.move(figureBounds.x+250,figureBounds.y+120,{steps:8});await p.mouse.up();
  assert.equal(await app.evaluate(()=>globalThis.figureRequest),undefined);
  await p.locator('#figure-question').fill('축과 결과를 설명해주세요');await p.locator('[data-action="figure-send"]').click();await p.locator('#figure-status').filter({hasText:'설명 완료'}).waitFor();
  assert.match(await p.locator('#figure-result').innerText(),/가로축은 시간/);assert.equal(await p.locator('#figure-result script').count(),0);
  if(process.env.APP_FIGURE_SCREENSHOT)await p.screenshot({path:process.env.APP_FIGURE_SCREENSHOT});
  const figureRequest=await app.evaluate(()=>globalThis.figureRequest);assert.match(figureRequest.image,/^data:image\/png;base64,/);assert.equal(figureRequest.context.page,1);assert.match(figureRequest.context.caption,/research paper/);
  const cropSize=await p.evaluate(async src=>{const image=new Image();image.src=src;await image.decode();return {width:image.naturalWidth,height:image.naturalHeight}},figureRequest.image);assert.ok(cropSize.width<1200&&cropSize.height<400);
  await p.locator('[data-action="figure-save"]').click();await p.locator('#dialog').waitFor({state:'hidden'});
  // 그림 설명 is tied to its place in the paper: a card of its own in the 주석 tab, with its picture, a title and its page.
  await p.locator('.memo-card.annot.open .annot-page[data-annotation-page="1"]').waitFor();
  assert.equal(await p.locator('.memo-card.annot.open .annot-title').inputValue(),'','the kind is the icon, not a title');assert.equal(await p.locator('.memo-card.annot.open .annot-page svg').count(),1,'one icon');
  const figureNote=await p.evaluate(()=>itemAnnotations.find(a=>a.kind==='figure')?.body||'');const picture=figureNote.match(/note-image:([0-9a-f]{32}\.png)/)?.[1];assert.ok(picture,'the picture is in the annotation');
  assert.equal(await p.evaluate(()=>Object.values(notes).some(v=>v.includes('note-image:'))),false,'not a memo');
  await fs.access(path.join(vault,appName.vaultDir,'note-images',picture));
  // A closed card is its title and one line; its picture shows as a thumbnail.
  await p.locator('.memo-card.annot.open [data-annot-fold]').click();
  await p.locator('.memo-card.annot:not(.open) .memo-thumb').evaluate(img=>img.decode());
  assert.ok(await p.locator('.memo-card.annot:not(.open) .memo-thumb').evaluate(img=>img.naturalWidth>0),'the picture shows in the card');
  await p.locator('[data-tab="메모"]').click();await p.locator('[data-action="memo-new"]').click();assert.equal(await p.locator('.memo-card').count(),2);
  assert.ok((await p.locator('.memo-card:not(.open)').first().boundingBox()).height<80,'a closed memo is two short lines');
  // A title of its own; the body does not become the title.
  await p.locator('.memo-card.open .memo-title').fill('실험 메모');await (await openNote(p)).fill('질량 $E=mc^2$');
  // The side panel's memo field renders the formula in place too; with the cursor in it, the source shows.
  await p.locator('.memo-card.open .field-live .cm-math .katex').waitFor();
  const sideLine=await p.locator('.memo-card.open .field-live .cm-line').first().boundingBox();await p.mouse.click(sideLine.x+2,sideLine.y+sideLine.height/2);
  await p.keyboard.press('End');await p.locator('.memo-card.open .field-live .cm-math-source').waitFor();await p.locator('.math-peek .katex').waitFor();
  await p.keyboard.type(' 끝');await p.locator('.memo-card.open .field-live .cm-math .katex').waitFor();assert.equal(await (await openNote(p)).inputValue(),'질량 $E=mc^2$ 끝');
  await p.keyboard.press('Backspace');await p.keyboard.press('Backspace');await p.waitForFunction(()=>document.querySelector('#note').value==='질량 $E=mc^2$');
  // The wide editor opens in the live view: the formula in the line renders in place;
  // with the cursor in it, its source shows (and its rendering just below); typing goes on in the same line.
  // The corner of an open memo only resizes it; ⤢ in its header opens the wide editor.
  const field=p.locator('.memo-card.open .field-live'),fieldH=(await field.boundingBox()).height,corner=await p.locator('.memo-card.open .note-grip').boundingBox();
  await p.mouse.move(corner.x+9,corner.y+9);await p.mouse.down();await p.mouse.move(corner.x+9,corner.y+89,{steps:4});await p.mouse.up();
  assert.ok((await field.boundingBox()).height>fieldH+60,'dragged taller');assert.equal(await p.locator('#dialog[open]').count(),0,'no editor from the corner');
  await p.locator('.memo-card.open .note-grip').click();assert.equal(await p.locator('#dialog[open]').count(),0);
  await p.locator('.memo-card.open [data-memo-wide]').click();await p.locator('#dialog .md-live .cm-math .katex').waitFor();
  assert.equal(await p.locator('#dialog .dialog-head h2').textContent(),'실험 메모');assert.equal(await p.locator('.editor-title').inputValue(),'실험 메모');
  assert.equal(await p.locator('#dialog .md-live .cm-line').first().evaluate(n=>n.firstChild.textContent),'질량 ','text before the formula stays text');
  const line=await p.locator('#dialog .md-live .cm-line').first().boundingBox();await p.mouse.click(line.x+2,line.y+line.height/2);await p.locator('#dialog .md-live .cm-math .katex').waitFor();
  await p.keyboard.press('End');await p.locator('#dialog .md-live .cm-math-source').waitFor();await p.locator('.math-peek .katex').waitFor();
  await p.keyboard.press('Enter');await p.keyboard.press('Enter');await p.keyboard.type('두 번째 문단');await p.locator('#dialog .md-live .cm-math .katex').waitFor();assert.equal(await p.locator('.math-peek').count(),0);
  assert.equal(await p.locator('#note-editor').inputValue(),'질량 $E=mc^2$\n\n두 번째 문단');
  await p.keyboard.type(' $a^2+b^2$');await p.locator('#dialog .md-live .cm-math-source').waitFor();await p.keyboard.type(' 끝');await p.waitForFunction(()=>document.querySelectorAll('#dialog .md-live .cm-math .katex').length===2);
  await p.keyboard.press('ControlOrMeta+z');await p.keyboard.press('ControlOrMeta+z');await p.keyboard.press('ControlOrMeta+z');
  await p.locator('#note-editor').evaluate(a=>{a.value='질량 $E=mc^2$\n\n두 번째 문단';a.dispatchEvent(new Event('input',{bubbles:true}));});
  await p.locator('[data-md-view="split"]').click();await p.locator('.note-editor-preview .katex').waitFor();assert.equal(await p.locator('#note-editor').inputValue(),'질량 $E=mc^2$\n\n두 번째 문단');
  await p.locator('#note-editor').evaluate(a=>a.setSelectionRange(0,0));await p.locator('[data-md="bullet"]').click();
  await p.locator('#note-editor').evaluate(a=>a.setSelectionRange(a.value.length,a.value.length));await p.keyboard.type(' ');await p.keyboard.press('ControlOrMeta+b');
  assert.equal(await p.locator('#note-editor').inputValue(),'- 질량 $E=mc^2$\n\n두 번째 문단 **굵게**');await p.locator('.note-editor-preview strong').waitFor();
  await p.locator('[data-md-view="live"]').click();await p.locator('#dialog [data-action="close"]').last().click();
  await p.waitForFunction(()=>document.querySelector('#note')?.value==='- 질량 $E=mc^2$\n\n두 번째 문단 **굵게**');assert.equal(await p.locator('.memo-card.open .memo-title').inputValue(),'실험 메모');
  await p.locator('.memo-card.open [data-memo-delete]').click();assert.equal(await p.locator('.memo-card').count(),1);
  await p.locator('.undo-toast button').click();await p.locator('.memo-card.open .memo-title').waitFor();assert.equal(await p.locator('.memo-card.open .memo-title').inputValue(),'실험 메모');
  // A picture pasted into a memo is saved in the vault and shown in place.
  await p.locator('.memo-card.open .field-live .cm-content').click();await p.keyboard.press((process.platform === 'darwin' ? 'Meta+ArrowDown' : 'Control+End'));
  await p.evaluate(async()=>{const c=document.createElement('canvas');c.width=30;c.height=20;c.getContext('2d').fillRect(0,0,30,20);const blob=await new Promise(r=>c.toBlob(r,'image/png'));const dt=new DataTransfer();dt.items.add(new File([blob],'x.png',{type:'image/png'}));document.querySelector('.memo-card.open .field-live .cm-content').dispatchEvent(new ClipboardEvent('paste',{clipboardData:dt,bubbles:true,cancelable:true}));});
  await p.locator('#toast').filter({hasText:'그림을 메모에 넣었습니다'}).waitFor();const pasted=(await (await openNote(p)).inputValue()).match(/!\[붙여넣은 그림\]\(note-image:([0-9a-f]{32}\.png)\)/)?.[1];assert.ok(pasted,'the picture line is in the memo');
  await fs.access(path.join(vault,appName.vaultDir,'note-images',pasted));await p.locator('.memo-card.open .field-live .cm-image img').first().evaluate(img=>img.decode());
  // Only the chosen memo opens: its header (or Esc) folds it, and with none chosen every memo is a title and one line.
  await p.locator('.memo-card.open [data-memo-fold]').click();await p.locator('.memo-card.open').waitFor({state:'detached'});
  assert.ok((await p.locator('.memo-card').evaluateAll(cards=>cards.map(c=>c.getBoundingClientRect().height))).every(h=>h<80),'all folded');
  await p.locator('.memo-card').nth(1).click();assert.equal(await p.locator('.memo-card.open').count(),1);await p.locator('.memo-card.open .field-live .cm-content').click();await p.keyboard.press('Escape');await p.locator('.memo-card.open').waitFor({state:'detached'});
  await p.locator('[data-tab="서지"]').click();await p.locator('[data-tab="메모"]').click();assert.equal(await p.locator('.memo-card.open').count(),0,'nothing opens by itself');
  // The memo written first can be deleted too (and brought back).
  const firstText=await p.evaluate(()=>notes[`${state.selected}-메모`]);
  await p.locator('.memo-card').first().locator('[data-memo-delete]').click();await p.waitForFunction(()=>!notes[`${state.selected}-메모`]);assert.equal(await p.locator('.memo-card').count(),1);
  await p.locator('.undo-toast button').click();await p.waitForFunction(t=>notes[`${state.selected}-메모`]===t,firstText);assert.equal(await p.locator('.memo-card').count(),2);
  await p.waitForFunction(async()=>{const n=(await window.appApi.refreshStorage(state.storageKey)).notes;return Object.keys(n).filter(k=>k.includes('-메모-')&&!k.includes('#')).length===2&&Object.values(n).includes('실험 메모');});
  assert.ok((await p.locator('#saved').boundingBox()).width<=1,'no 자동 저장 label on screen');
  // On-screen capture: a box dragged over a visible page opens the dialog with that page and box.
  await p.locator('[data-action="figure-open"]').click();await p.locator('.figure-capture').waitFor();
  const sheet=await p.evaluate(()=>{const el=figureSheets()[0],r=el.getBoundingClientRect(),top=Math.max(r.top,el.closest('.translated-pages').getBoundingClientRect().top);return {x:r.left,y:top,w:r.width,page:Number(el.dataset.page)};});
  await p.mouse.move(sheet.x+sheet.w*.2,sheet.y+30);await p.mouse.down();await p.mouse.move(sheet.x+sheet.w*.6,sheet.y+150,{steps:6});await p.mouse.up();
  await p.locator('#figure-status').filter({hasText:'선택한 영역을 설명할 준비가 됐습니다.'}).waitFor();assert.equal(await p.evaluate(()=>figureSession.page),sheet.page);assert.equal(await p.locator('.figure-capture').count(),0);
  assert.equal(await p.locator('#figure-image').count(),0,'no page to choose again');assert.ok(await p.locator('#figure-crop-image').evaluate(img=>img.naturalWidth>0),'just the chosen figure');
  const captured=await p.evaluate(()=>figureSession.rect);assert.ok(captured.x>.15&&captured.x<.25&&captured.width>.35&&captured.width<.45,JSON.stringify(captured));
  await p.locator('#figure-question').fill('cancel');await p.locator('[data-action="figure-send"]').click();await p.locator('#figure-status').filter({hasText:'분석하고'}).waitFor();for(let i=0;i<100&&!(await app.evaluate(()=>globalThis.figureRequest?.context.question==='cancel'));i++)await new Promise(r=>setTimeout(r,20));assert.equal(await app.evaluate(()=>globalThis.figureRequest?.context.question),'cancel');await p.locator('#dialog .close').click();for(let i=0;i<100&&!(await app.evaluate(()=>globalThis.figureAborted));i++)await new Promise(r=>setTimeout(r,20));assert.equal(await app.evaluate(()=>globalThis.figureAborted),true);
  await p.evaluate(()=>{window.balancedPdf=document.querySelector('.original-pages');window.balancedNote=document.querySelector('#note')});
  const readerViewport=p.viewportSize()||await p.evaluate(()=>({width:innerWidth,height:innerHeight}));
  for(const width of [1600,800]){
    await p.setViewportSize({width,height:800});
    await p.waitForFunction(()=>{const original=document.querySelector('.original-pane'),translated=document.querySelector('.translated-pane'),pages=translated.querySelector('.translated-pages'),sheet=pages.querySelector('.translated-sheet'),style=getComputedStyle(pages),a=original.querySelector('header').getBoundingClientRect(),b=translated.querySelector('header').getBoundingClientRect(),left=original.querySelector('.original-pages').getBoundingClientRect(),right=pages.getBoundingClientRect();return Math.abs(original.getBoundingClientRect().width-translated.getBoundingClientRect().width)<1&&a.height===42&&b.height===42&&Math.abs(a.top-b.top)<1&&Math.abs(left.top-right.top)<1&&Math.abs(left.height-right.height)<1&&sheet.getBoundingClientRect().width<=pages.clientWidth-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight)+1;});
    assert.equal(await p.locator('.pdf-pane .pdf-tool-label').first().isVisible(),width===1600);
    assert.deepEqual(await p.locator('.translated-pane .pdf-pane-tools .pdf-tool[data-action]').evaluateAll(nodes=>nodes.map(node=>node.getAttribute('aria-label').split(':')[0]).sort()),['섹션 보기','다시 번역','PDF 저장','번역 결과 상태'].sort()); // in a narrow pane some are under ⋯, still in the row's element
    if(process.env.APP_READER_LAYOUT_SCREENSHOT)await p.screenshot({path:process.env.APP_READER_LAYOUT_SCREENSHOT+'-'+width+'.png'});
  }
  await p.setViewportSize(readerViewport);
  assert.equal(await p.evaluate(()=>window.balancedPdf===document.querySelector('.original-pages')&&window.balancedNote===document.querySelector('#note')),true);
  await p.locator('[data-action="gpt-export"]').click();await p.locator('#dialog #ink-export-include').waitFor();await p.locator('#dialog [data-action="ink-export-confirm"]').click();
  for(let i=0;i<100;i++){try{await fs.stat(path.join(temp,'export.pdf'));break;}catch{await new Promise(r=>setTimeout(r,100));}}
  assert.equal((await fs.readFile(path.join(temp,'export.pdf'))).subarray(0,5).toString(),'%PDF-');
  const exportPixels=await p.evaluate(async bytes=>{const pdfjs=await import('./pdfjs/pdf.mjs'),task=pdfjs.getDocument({data:new Uint8Array(bytes),isEvalSupported:false}),doc=await task.promise,page=await doc.getPage(1),viewport=page.getViewport({scale:4/3}),canvas=document.createElement('canvas');canvas.width=viewport.width;canvas.height=viewport.height;await page.render({canvasContext:canvas.getContext('2d'),viewport}).promise;const value=Array.from(canvas.getContext('2d').getImageData(60,67,1,1).data);await task.destroy();return value;},Array.from(await fs.readFile(path.join(temp,'export.pdf'))));assert.deepEqual(exportPixels,[240,240,240,255]);
  // Shared geometry, page navigation and safe source mapping in dual view.
  assert.equal(await p.locator('.translated-block').first().getAttribute('data-source-text'),'A research paper connects ideas.');
  assert.match(await p.locator('.translated-block').first().getAttribute('data-block-id'),/^p1-b/);
  await (await toolShown(p, '.source-tools [data-reader-zoom=".1"]')).click();
  await p.waitForFunction(()=>{const a=document.querySelector('.pdf-source-sheet'),b=document.querySelector('.translated-sheet');return Math.abs(a.getBoundingClientRect().width-b.getBoundingClientRect().width)<1;});
  await (await toolShown(p, '.source-tools [data-reader-fit]')).click();
  await (await toolShown(p, '.source-tools [data-reader-step="1"]')).click();
  await p.waitForFunction(()=>{const a=document.querySelector('.original-pages'),b=document.querySelector('.translated-pane .translated-pages');return a.scrollTop>0&&Math.abs(a.scrollTop-b.scrollTop)<2;});
  await (await toolShown(p, '.source-tools [data-reader-step="-1"]')).click();
  await p.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  await p.evaluate(()=>{const a=document.querySelector('.original-pages');a.scrollTop=80;});
  await p.waitForFunction(()=>Math.abs(document.querySelector('.original-pages').scrollTop-document.querySelector('.translated-pane .translated-pages').scrollTop)<2);
  await p.evaluate(()=>{document.querySelector('.original-pages').scrollTop=0;});

  // Layout export retains the exact source page count, without appendices.
  const cacheFile=path.join(vault,appName.vaultDir,(await fs.readdir(path.join(vault,appName.vaultDir))).find(name=>/^translation-.*\.json$/.test(name)&&!name.endsWith('.chunks.json'))),cacheBytes=await fs.readFile(cacheFile),overflowRecord=JSON.parse(cacheBytes);
  overflowRecord.pages[1].blocks[0].translation='OVERFLOWSTART '+ '긴 문단의 번역이 잘리지 않고 다음 페이지로 이어집니다. '.repeat(600)+' OVERFLOWEND';
  try{
    await fs.writeFile(cacheFile,JSON.stringify(overflowRecord));
    await p.evaluate(record=>{translationRecord={...record,key:targetKey()};const pane=document.querySelector('.translated-pane .translated-pages');pane?.observer?.disconnect();pane?.remove();refreshTranslationPane();},overflowRecord);
    await p.locator('.translated-sheet[data-page="2"]').scrollIntoViewIfNeeded();
    // Nothing leaves the page: a translation far longer than its box stays there at half size, cut at the box, with the whole text in its note.
    await p.locator('.translated-sheet[data-page="2"] .block-clipped').filter({hasText:'OVERFLOWSTART'}).waitFor();
    const longBlock=p.locator('.translated-sheet[data-page="2"] .block-clipped');
    assert.equal(await p.locator('.layout-flow-continuation').count(),0);
    assert.ok(await longBlock.evaluate(n=>Math.abs(parseFloat(getComputedStyle(n).fontSize)-Number(n.dataset.baseSize)*.5)<.02));assert.equal(await p.locator('.flow-translation').count(),0);
    assert.match(await longBlock.locator(':scope>.translation-note').evaluate(n=>n.textContent),/OVERFLOWEND/);assert.equal(await p.locator('.block-expand').count(),0);
    assert.equal(await p.locator('.translation-overflow').count(),0);
    await p.evaluate(()=>saveGPTPdf());
    const printed=await p.evaluate(async bytes=>{const pdfjs=await import('./pdfjs/pdf.mjs'),task=pdfjs.getDocument({data:new Uint8Array(bytes)}),doc=await task.promise;let text='';for(let n=1;n<=doc.numPages;n++)text+=' '+(await(await doc.getPage(n)).getTextContent()).items.map(i=>i.str||'').join(' ');const pages=doc.numPages;await task.destroy();return {pages,text};},Array.from(await fs.readFile(path.join(temp,'export.pdf'))));
    assert.ok(printed.pages>2);assert.match(printed.text,/OVERFLOWSTART/);assert.match(printed.text,/OVERFLOWEND/);assert.doesNotMatch(printed.text,/번역 보충/);
    await (await toolShown(p, '[data-action="toggle-translation-reading"]')).click();await p.locator('.section-paragraph').filter({hasText:'OVERFLOWEND'}).waitFor();
    assert.equal(await p.locator('.translated-pane .block-expand').count(),0);
    assert.equal(await p.locator('.section-paragraph').filter({hasText:'OVERFLOWEND'}).evaluate(n=>n.scrollHeight<=n.clientHeight+1),true);
    await (await toolShown(p, '[data-action="toggle-translation-reading"]')).click();
  }finally{await fs.writeFile(cacheFile,cacheBytes);await p.evaluate(record=>{translationRecord={...record,key:targetKey()};const pane=document.querySelector('.translated-pane .translated-pages');pane?.observer?.disconnect();pane?.remove();refreshTranslationPane();},JSON.parse(cacheBytes));}

if(process.env.APP_EXPORT_TEST_PATH)await fs.copyFile(path.join(temp,'export.pdf'),process.env.APP_EXPORT_TEST_PATH);
  assert.equal(await p.locator('.layout-controls').count(),0);
  await p.locator('.split-handle').focus();await p.keyboard.press('ArrowRight');assert.equal(await p.locator('.split-handle').getAttribute('aria-valuenow'),'52');
  // Hold the second inference so an old cached result cannot hide the busy UI.
  await app.evaluate(({app})=>{
    const {ChatGPT}=process.getBuiltinModule('module').createRequire(app.getAppPath()+'/package.json')('./desktop/chatgpt.cjs');
    globalThis.secondInference=false;globalThis.inferenceGates={};
    ChatGPT.prototype.translate=async(_model,blocks)=>{globalThis.secondInference=true;await new Promise(resolve=>{globalThis.inferenceGates[blocks[0].id]=resolve});return blocks.map(b=>({id:b.id,text:'새롭게 다시 번역한 한국어 결과입니다.'}))};
  });
  await (await toolShown(p, '[data-action="gpt-retranslate"]')).click();await p.locator('#dialog [data-action="gpt-start"]').click();
  await p.getByRole('heading',{name:'다시 번역 중',exact:true}).waitFor();assert.equal(await p.locator('.translated-sheet').count(),0);
  await p.locator('[data-mode="translated"]').click();await p.getByRole('heading',{name:'다시 번역 중',exact:true}).waitFor();
  assert.equal(await p.locator('.translated-sheet').count(),0);assert.equal(await p.locator('[data-action="gpt-export"]').count(),0);
  for(let i=0;i<100&&!await app.evaluate(()=>globalThis.secondInference);i++)await new Promise(resolve=>setTimeout(resolve,50));
  assert.equal(await app.evaluate(()=>globalThis.secondInference),true);
  for(let i=0;i<100&&await app.evaluate(()=>Object.keys(globalThis.inferenceGates).length)<2;i++)await new Promise(resolve=>setTimeout(resolve,50));
  await p.locator('[data-mode="dual"]').click();assert.equal(await p.locator('.original-pages').count(),1);await p.locator('.original-pages canvas').first().waitFor();
  await p.evaluate(()=>{window.progressNote=document.querySelector('#note');window.progressPdf=document.querySelector('.original-pages')});
  await app.evaluate(()=>Object.entries(globalThis.inferenceGates).find(([id])=>id.startsWith('p1-'))[1]());
  await p.locator('.translated-block').first().filter({hasText:'새롭게 다시 번역한'}).waitFor();
  assert.equal(await p.locator('[data-action="gpt-stop"]').count(),1);assert.equal(await p.locator('[data-action="gpt-export"]').count(),0);
  assert.equal(await p.evaluate(()=>window.progressNote===document.querySelector('#note')&&window.progressPdf===document.querySelector('.original-pages')),true);
  await app.evaluate(()=>Object.values(globalThis.inferenceGates).forEach(release=>release()));await p.locator('[data-action="gpt-export"]').waitFor();
  await p.locator('[data-mode="dual"]').click();

  await app.evaluate(({app})=>{globalThis.pageCalls=[];const {ChatGPT}=process.getBuiltinModule('module').createRequire(app.getAppPath()+'/package.json')('./desktop/chatgpt.cjs');ChatGPT.prototype.translate=async(_m,blocks,_s,context)=>{globalThis.pageCalls.push(blocks[0].id);globalThis.pageContext=context;return blocks.map(b=>({id:b.id,text:'선택한 페이지만 다시 번역했습니다.'}))};});
  const pageRetry=p.locator('[data-retranslate-page="2"]');await pageRetry.hover();await pageRetry.click();
  // 이번 번역 요청 사항: written in the translation window, sent with this translation only and never saved.
  await p.locator('#translation-rules').fill('용어는 처음에 영어를 괄호로 함께 적기');await p.locator('#dialog [data-action="gpt-start"]').click();await p.locator('[data-action="gpt-export"]').waitFor();
  await p.locator('[data-page="2"] .translated-block').filter({hasText:'선택한 페이지만'}).waitFor();assert.equal((await app.evaluate(()=>globalThis.pageCalls)).length,1);assert.match((await app.evaluate(()=>globalThis.pageCalls))[0],/^p2-/);
  assert.equal(await app.evaluate(()=>globalThis.pageContext.userRules),'용어는 처음에 영어를 괄호로 함께 적기');assert.equal((await p.evaluate(async()=>(await window.appApi.refreshStorage(state.storageKey)).translationRules))||'','','not kept in the vault');
  // The vault's requests (저장소 관리) are kept and shown read-only; the next translation starts with an empty field and sends both.
  await p.evaluate(async()=>{vaultRules=(await window.appApi.translationRulesSave(state.storageKey,'~다 체로 번역')).translationRules;});
  await pageRetry.hover();await pageRetry.click();assert.match(await p.locator('.rules-kept').innerText(),/~다 체로 번역/);assert.equal(await p.locator('#translation-rules').inputValue(),'','the last request is gone');
  await p.locator('#translation-rules').fill('표 제목은 원문 유지');await p.locator('#dialog [data-action="gpt-start"]').click();await app.evaluate(()=>new Promise(r=>{const t=setInterval(()=>{if(globalThis.pageCalls.length>=2){clearInterval(t);r();}},50);}));
  assert.equal(await app.evaluate(()=>globalThis.pageContext.userRules),'~다 체로 번역\n이번 번역에만: 표 제목은 원문 유지');assert.equal((await p.evaluate(async()=>(await window.appApi.refreshStorage(state.storageKey)).translationRules)),'~다 체로 번역','only the vault request is kept');
  await p.locator('[data-action="gpt-export"]').waitFor();await p.evaluate(async()=>{vaultRules=(await window.appApi.translationRulesSave(state.storageKey,'')).translationRules||'';});
  await p.locator('.translated-sheet[data-page="1"]').scrollIntoViewIfNeeded();await p.locator('[data-page="1"] .translated-block').filter({hasText:'새롭게 다시 번역한'}).waitFor();
  await p.locator('[data-action="jobs"]').click();assert.match(await p.locator('#dialog').innerText(),/첫 번역 표시: [0-9.]+초/);await p.locator('#dialog [data-action="close"]').first().click();
  assert.equal(await p.locator('.topbar [data-sidebar-toggle]').count(),0);
  await p.evaluate(()=>{window.resizeNote=document.querySelector('#note');window.resizePdf=document.querySelector('.original-pages')});
  const resize=p.locator('.navigation-resize'),beforeWidth=(await p.locator('#navigation-panel').boundingBox()).width,grip=await resize.boundingBox();await p.mouse.move(grip.x+grip.width/2,grip.y+100);await p.mouse.down();await p.mouse.move(grip.x+grip.width/2+64,grip.y+100,{steps:8});await p.mouse.up();assert.ok(Math.abs((await p.locator('#navigation-panel').boundingBox()).width-beforeWidth-64)<2);assert.equal(await p.evaluate(()=>window.resizeNote===document.querySelector('#note')&&window.resizePdf===document.querySelector('.original-pages')),true);await p.waitForFunction(()=>{const pages=document.querySelector('.translated-pages'),style=getComputedStyle(pages);return pages.querySelector('.translated-sheet,.pdf-source-sheet').getBoundingClientRect().width<=pages.clientWidth-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight)+1;});
  await resize.focus();await resize.press('Home');assert.equal(await resize.getAttribute('aria-valuenow'),'180');await resize.press('End');assert.equal(await resize.getAttribute('aria-valuenow'),String(await p.evaluate(()=>Math.max(180,Math.min(480,Math.floor(innerWidth*.45))))),'the widest the window allows');await resize.dblclick();assert.equal(await resize.getAttribute('aria-valuenow'),'220');await resize.press('ArrowRight');assert.equal(await resize.getAttribute('aria-valuenow'),'230');assert.equal(await p.evaluate(()=>localStorage.getItem('app-navigation-width')),'230');
  // The right panel resizes like the navigation (a wide window shows it as a side column).
  await p.setViewportSize({width:1400,height:900});
  const panelResize=p.locator('.panel-resize').first(),panelBefore=(await p.locator('#notes-panel').boundingBox()).width,panelGrip=await panelResize.boundingBox();
  await p.mouse.move(panelGrip.x+panelGrip.width/2,panelGrip.y+100);await p.mouse.down();await p.mouse.move(panelGrip.x+panelGrip.width/2-60,panelGrip.y+100,{steps:8});await p.mouse.up();
  assert.ok(Math.abs((await p.locator('#notes-panel').boundingBox()).width-panelBefore-60)<2,'dragging the panel edge left widens the panel');
  assert.equal(await p.evaluate(()=>window.resizeNote===document.querySelector('#note')&&window.resizePdf===document.querySelector('.original-pages')),true);
  await p.waitForFunction(()=>{const pages=document.querySelector('.translated-pages'),style=getComputedStyle(pages);return pages.querySelector('.translated-sheet,.pdf-source-sheet').getBoundingClientRect().width<=pages.clientWidth-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight)+1;});
  await panelResize.focus();await panelResize.press('Home');assert.equal(await panelResize.getAttribute('aria-valuenow'),'240');await panelResize.press('End');assert.equal(await panelResize.getAttribute('aria-valuenow'),'630');
  await panelResize.dblclick();assert.equal(await panelResize.getAttribute('aria-valuenow'),'300');await panelResize.press('ArrowLeft');assert.equal(await panelResize.getAttribute('aria-valuenow'),'310');
  assert.equal(await p.evaluate(()=>localStorage.getItem('app-panel-width')),'310');assert.ok(Math.abs((await p.locator('#notes-panel').boundingBox()).width-310)<2);
  await p.setViewportSize(readerViewport);
  for(const side of ['left','right']){await p.locator(`[data-action="close-${side}"]`).click();await p.locator(`[data-sidebar-open="${side}"]`).waitFor({state:'visible'});assert.equal(await p.locator(`.${side}-edge .icon`).count(),0);await p.locator(`.${side}-edge`).hover();await p.locator(`[data-sidebar="${side}"]`).waitFor({state:"visible"});const box=await p.locator(`[data-sidebar="${side}"]`).boundingBox();const top=await p.locator(".topbar").boundingBox();if(side==="left"){assert.equal(Math.round(box.y),0,"the navigation peeks at its docked size, full height");assert.equal(Math.round(box.height),Math.round(p.viewportSize().height));}else assert.ok(box.y>=top.y+top.height);if(side==="left")assert.ok(Math.abs(box.width-230)<2);assert.equal(await p.locator(`[data-sidebar-toggle="${side}"] .sidebar-pin-icon`).isVisible(),true);assert.equal(await p.locator(`[data-sidebar-toggle="${side}"] .sidebar-close-icon`).isVisible(),false);await p.mouse.move(450,30);await p.locator(`[data-sidebar="${side}"]`).waitFor({state:'hidden'});await p.locator(`[data-sidebar-open="${side}"]`).focus();await p.locator(`[data-sidebar-open="${side}"]`).press('Enter');await p.waitForFunction(side=>!document.querySelector('.shell').classList.contains(side+'-collapsed'),side);assert.equal(await p.locator(`[data-sidebar-toggle="${side}"] .sidebar-close-icon`).isVisible(),true)}
  // Hovering the navigation opener must never cover the button before the click.
  await p.locator('[data-action="close-left"]').click();const leftEdge=await p.locator('.left-edge').boundingBox(),topBounds=await p.locator('.topbar').boundingBox();assert.equal(leftEdge.width,14);assert.ok(leftEdge.y>=topBounds.y+topBounds.height);await p.locator('[data-sidebar-open="left"]').hover();await p.locator('#navigation-panel').waitFor({state:'visible'});assert.equal(await p.locator('[data-sidebar-open="left"]').evaluate(button=>{const box=button.getBoundingClientRect();return document.elementFromPoint(box.x+box.width/2,box.y+box.height/2)?.closest('[data-sidebar-open="left"]')===button}),true);await p.locator('[data-sidebar-open="left"]').click();await p.waitForFunction(()=>!document.querySelector('.shell').classList.contains('left-collapsed'));
  // The top bar's sidebar buttons stay where they are with the sidebars open: each says what it will do and closes and opens its side.
  for(const side of ['left','right']){const button=p.locator(`.topbar [data-sidebar-open="${side}"]`);if(await p.evaluate(side=>document.querySelector('.shell').classList.contains(side+'-collapsed'),side))await button.click();
    assert.equal(await button.isVisible(),true,`${side}: shown with the sidebar open`);assert.equal(await button.getAttribute('aria-expanded'),'true');assert.match(await button.getAttribute('aria-label'),/사이드바 닫기/);const place=await button.boundingBox();
    await button.click();assert.equal(await p.evaluate(side=>document.querySelector('.shell').classList.contains(side+'-collapsed'),side),true,`${side}: closes`);assert.match(await button.getAttribute('aria-label'),/사이드바 열기/);await p.mouse.move(600,400);
    await button.click();assert.equal(await p.evaluate(side=>document.querySelector('.shell').classList.contains(side+'-collapsed'),side),false,`${side}: opens again`);if(side==='right')assert.ok(Math.abs((await button.boundingBox()).y-place.y)<1);}
  await p.locator('[data-action="close-right"]').click();await p.locator('[data-sidebar-open="right"]').hover();await p.locator('[data-action="pin-right"][data-sidebar-toggle]').click();await p.waitForFunction(()=>!document.querySelector('.shell').classList.contains('right-collapsed'));
  const panel=await p.locator('#notes-panel').boundingBox(),toolbar=await p.locator('.topbar').boundingBox();assert.ok(panel.y>=toolbar.y+toolbar.height);
  await app.close();p=await launch();await (await openNote(p)).waitFor();assert.ok(Math.abs((await p.locator('#navigation-panel').boundingBox()).width-230)<2);assert.equal(await (await openNote(p)).inputValue(),'재시작 후에도 남는 메모');await p.locator('[data-tab="태그"]').click();assert.equal(await p.locator('[data-remove-tag="보존할 태그"]').count(),1);assert.equal(await p.locator('[data-remove-tag="삭제할 태그"]').count(),0);await p.locator('[data-tab="메모"]').click();
  await p.locator('[data-mode="dual"]').click();await p.locator('.translated-sheet').first().waitFor();assert.equal(await p.locator('.original-pages').count(),1);await p.locator('.original-pages canvas').first().waitFor();assert.match(await p.locator('.translated-block').first().innerText(),/새롭게 다시 번역한/);
  // A failed forced retranslation must resume after an actual process restart.
  await app.evaluate(({app})=>{const {ChatGPT}=process.getBuiltinModule('module').createRequire(app.getAppPath()+'/package.json')('./desktop/chatgpt.cjs');ChatGPT.prototype.translate=async(_m,blocks)=>{if(blocks[0].id.startsWith('p2-'))throw Error('fixture page failure');return blocks.map(b=>({id:b.id,text:'중간 저장 번역입니다.'}))};});
  await (await toolShown(p, '[data-action="gpt-retranslate"]')).click();await p.locator('#dialog [data-action="gpt-start"]').click();await p.locator('.translation-state').filter({hasText:'fixture page failure'}).waitFor();
  await app.close();p=await launch();await p.locator('#note, .memo-card').first().waitFor();
  // The paper reopens in the view it was last read in (dual here), which asks to resume at once.
  if(!await p.locator('[data-mode="dual"].active').count())await p.locator('[data-mode="dual"]').click();await p.locator('#dialog [data-action="gpt-start"]').click();await p.locator('[data-action="gpt-export"]').waitFor();
  await p.locator('[data-page="1"] .translated-block').filter({hasText:'중간 저장 번역'}).waitFor();const resumedCalls=await app.evaluate(()=>globalThis.inferenceCalls);assert.equal(resumedCalls.length,1);assert.match(resumedCalls[0],/^p2-/);
  assert.equal(await p.locator('.sidebar-bottom [data-action="home"]').count(),0);await p.getByRole('button',{name:`${appName.name} 시작 화면`,exact:true}).click();await p.locator('.welcome').waitFor();await p.locator('[data-desktop-recent]').click();
  // The vault name lists the recent vaults (the open one marked) with 새 저장소 연결 under them.
  await p.locator('[data-vault-switch]').click();assert.equal(await p.locator('.vault-menu [data-vault-current]').count(),1);assert.equal(await p.locator('.vault-menu [data-desktop-recent]').count(),0);await choose([second]);await p.locator('.vault-menu [data-action="storage"]').click();await p.locator('.storage strong').filter({hasText:'두 번째 저장소'}).waitFor();
  // Now both are listed, and the first is one click away (checked again below after the import).
  await p.locator('[data-vault-switch]').click();assert.equal(await p.locator('.vault-menu [data-desktop-recent]').count(),1);assert.equal(await p.locator('.vault-menu [data-vault-current]').textContent().then(text=>/두 번째 저장소/.test(text)),true);await p.keyboard.press('Escape');assert.equal(await p.locator('.vault-menu').count(),0);assert.equal(await p.locator('.paper-item').count(),0);
  assert.equal(await p.locator('.demo-bar,.avatar,.cover,.bottom-hint').count(),0);
  await p.locator('[data-action="new-folder"]').click();await p.getByRole('textbox',{name:'폴더 이름',exact:true}).fill('연구');await p.locator('[data-action="create-folder"]').click();await p.locator('.library h1').filter({hasText:'연구'}).waitFor();
  await p.locator('[data-action="new-folder"]').click();await p.getByRole('textbox',{name:'폴더 이름',exact:true}).fill('세부');await p.getByRole('textbox',{name:'폴더 이름',exact:true}).press('Enter');await p.locator('[data-folder-select="연구/세부"]').waitFor();
  assert.ok((await fs.stat(path.join(second,'연구','세부'))).isDirectory());const secondId=await p.evaluate(()=>state.storageKey);
  // Real File objects from Chromium preserve the native path used by webUtils.
  const invalid=path.join(temp,'자료.txt');await fs.writeFile(invalid,'not a PDF');
  await p.evaluate(()=>{const input=document.createElement('input');input.id='drop-test-files';input.type='file';input.multiple=true;input.hidden=true;document.body.append(input)});
  async function dropFiles(paths){
    await p.locator('#drop-test-files').setInputFiles(paths);
    return p.evaluate(()=>{const dt=new DataTransfer();for(const file of document.querySelector('#drop-test-files').files)dt.items.add(file);const zone=document.querySelector('.library');zone.dispatchEvent(new DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer:dt}));const label=document.querySelector('.pdf-drop-overlay')?.textContent;zone.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:dt}));return label});
  }
  assert.match(await dropFiles([path.join(temp,'원문.pdf'),path.join(temp,'번역.pdf'),invalid]),/두 번째 저장소/);
  await p.waitForFunction(()=>document.querySelectorAll('.paper-item').length===2);
  await p.locator('#dialog').filter({hasText:'PDF 파일만'}).waitFor();await p.locator('#dialog [data-action="close"]').first().click();
  assert.equal(await p.locator('.pdf-drop-overlay').count(),0);
  await dropFiles([path.join(temp,'원문.pdf')]);await p.locator('#dialog').filter({hasText:'이미 있는 자료입니다'}).waitFor();
  assert.equal(await p.locator('.paper-item').count(),2);
  await p.locator('#dialog [data-action="close"]').first().click();
  if(process.env.APP_SCREENSHOT_PATH)await p.screenshot({path:process.env.APP_SCREENSHOT_PATH});
  assert.ok(await fs.stat(path.join(second,'연구','세부','원문.pdf')));assert.ok(await fs.stat(path.join(second,'연구','세부','번역.pdf')));
  await p.locator('.vault-file').filter({hasText:'원문.pdf'}).click();await (await openNote(p)).fill('폴더 파일의 메모');await p.locator('#saved').filter({hasText:'저장소에 저장됨'}).waitFor();
  await p.locator('[data-tab="요약"]').click();assert.doesNotMatch(await p.locator('body').innerText(),/시안|예시|후속 구현|오늘의 읽기/);await p.locator('[data-tab="메모"]').click();
  await app.close();p=await launch();await p.locator('.storage strong').filter({hasText:'두 번째 저장소'}).waitFor();await (await openNote(p)).waitFor();assert.equal(await (await openNote(p)).inputValue(),'폴더 파일의 메모');
  await p.locator('[data-action="back"]').click();await p.locator('.library h1').filter({hasText:'연구/세부'}).waitFor();
  await fs.mkdir(path.join(second,'외부자료','빈 폴더'),{recursive:true});await fs.copyFile(path.join(temp,'원문.pdf'),path.join(second,'외부자료','외부.pdf'));
  await p.locator('[data-action="refresh-vault"]').click();await p.locator('[data-folder-select="외부자료"]').click();await p.locator('[data-folder-select="외부자료/빈 폴더"]').waitFor();await p.locator('.vault-file').filter({hasText:'외부.pdf'}).click();await (await openNote(p)).waitFor();
  assert.equal(await p.locator('.demo-bar,.avatar,.cover,.bottom-hint').count(),0);
  // One item owns metadata and notes; each PDF owns its annotation and translation.
  const itemId=await p.evaluate(()=>state.selected),originalAttachment=await p.evaluate(()=>state.selectedAttachment);
  await (await openNote(p)).fill('논문 공통 메모');await p.locator('#saved').filter({hasText:'저장소에 저장됨'}).waitFor();
  await p.locator('[data-tab="서지"]').click();await p.locator('[data-action="edit-bibliography"]').click();await p.locator('#bib-title').fill('첨부 논문');await p.locator('#bib-creators').fill('연구자');await p.locator('#bib-doi').fill(`10.1234/${appName.id}`);await p.locator('#bib-doi').press('Enter');await p.locator('.reader-panel h3').filter({hasText:'첨부 논문'}).waitFor();
  // Collections are off until the top-bar switch turns them on; off again hides them and keeps the data.
  assert.equal(await p.locator('.sidebar [data-action="new-collection"]').count(),0);assert.equal(await p.locator('.reader-panel [data-quick-collection]').count(),0);
  await p.locator('[data-action="toggle-collections"][aria-pressed="false"]').click();await p.locator('[data-action="toggle-collections"][aria-pressed="true"]').waitFor();
  for(const name of ['RAG 연구','학위논문']){await p.locator('.sidebar [data-action="new-collection"]').click();await p.locator('#collection-name').fill(name);await p.locator('[data-action="create-collection"]').click();await p.locator('[data-item-collection]').filter({hasText:name}).waitFor();}
  // Collections sit in a footer pinned to the bottom of the right panel: the ones the paper is in (× takes it out),
  // and 지정 opens a picker where a click puts it in or takes it out, with a search and a box that makes a new one.
  const footer=p.locator('.reader-panel .collection-footer'),picker=()=>p.locator('.collection-picker'),row=name=>picker().locator('.picker-row').filter({hasText:name});
  {const panelBox=await p.locator('.reader-panel').boundingBox(),footBox=await footer.boundingBox();assert.ok(Math.abs(panelBox.y+panelBox.height-(footBox.y+footBox.height))<2,'pinned to the bottom of the panel');}
  await footer.locator('[data-collection-picker]').click();await picker().locator('.picker-search').waitFor();
  await row('RAG 연구').click();await picker().locator('.picker-row[aria-checked="true"]').filter({hasText:'RAG 연구'}).waitFor();await row('학위논문').click();await picker().locator('.picker-row[aria-checked="true"]').filter({hasText:'학위논문'}).waitFor();
  await footer.locator('.collection-chip').filter({hasText:'학위논문'}).waitFor();assert.equal(await footer.locator('.count').textContent(),'2');
  await picker().locator('.picker-search').fill('학위');assert.deepEqual(await picker().locator('.picker-row .picker-name').allTextContents(),['학위논문']);await picker().locator('.picker-search').fill('');
  await picker().locator('[data-quick-collection]').fill('빠른 분류');await picker().locator('[data-quick-collection]').press('Enter');await footer.locator('.collection-chip').filter({hasText:'빠른 분류'}).waitFor();await p.locator('.sidebar [data-item-collection]').filter({hasText:'빠른 분류'}).waitFor();assert.equal(await picker().count(),0,'a new collection closes the picker');
  await footer.locator('.collection-chip').filter({hasText:'빠른 분류'}).locator('[data-toggle-collection]').click();await p.waitForFunction(()=>![...document.querySelectorAll('.reader-panel .collection-chip')].some(n=>n.textContent.includes('빠른 분류')));
  await footer.locator('[data-collection-picker]').click();await picker().locator('.picker-row[aria-checked="false"]').filter({hasText:'빠른 분류'}).waitFor();await p.keyboard.press('Escape');assert.equal(await picker().count(),0);
  // Read status sits at the right end of the PDF tool row (three buttons, or one with a menu when the row is short).
  await p.locator('.reader-mode-toolbar [data-status-menu]').click();await p.locator('.status-menu [data-read-status="읽는 중"]').click();await p.locator('.reader-mode-toolbar [data-status-menu][data-status="읽는 중"]').waitFor();assert.equal(await p.locator('.reader-panel [data-read-status]').count(),0);
  {const stored=(await p.evaluate(id=>window.appApi.refreshStorage(id),await p.evaluate(()=>state.storageKey))).papers.find(x=>x.id===itemId);assert.equal(stored.status,'읽는 중');assert.equal(stored.collectionIds.length,2);}
  const versionPath=path.join(temp,'추가버전.pdf');await pdf(versionPath,'Alternative edition for tests.');await p.locator('[data-tab="첨부"]').click();await p.locator('[data-action="attach-pdf"]').click();await p.locator('#attachment-role').selectOption('version');await choose([versionPath]);await p.locator('[data-action="choose-attachment"]').click();await p.locator('[data-open-attachment]').filter({hasText:'추가버전.pdf'}).waitFor();
  assert.equal(await p.locator('.reader-panel .attachment-row').count(),2);const versionAttachment=await p.locator('[data-open-attachment]').filter({hasText:'추가버전.pdf'}).getAttribute('data-open-attachment');await p.locator('[data-open-attachment]').filter({hasText:'추가버전.pdf'}).click();await p.waitForFunction(id=>state.selectedAttachment===id,versionAttachment);assert.equal(await (await openNote(p)).inputValue(),'논문 공통 메모');
  await p.locator('[data-tab="주석"]').click();await p.locator('[data-action="new-annotation"]').click();await p.locator('#annotation-page').fill('2');await p.locator('#annotation-quote').fill('Alternative edition');await p.locator('#annotation-body').fill('버전 파일 주석');await p.locator('[data-action="save-annotation"]').click();await p.locator('.annotation').filter({hasText:'버전 파일 주석'}).waitFor();
  await p.locator('#attachment-select').selectOption(originalAttachment);await p.locator('[data-tab="주석"]').click();assert.equal(await p.locator('.annotation').count(),0);await p.locator('[data-action="new-annotation"]').click();await p.locator('#annotation-body').fill('원문 파일 주석');await p.locator('[data-action="save-annotation"]').click();await p.locator('.annotation').filter({hasText:'원문 파일 주석'}).waitFor();
  await app.evaluate(({app})=>{const {ChatGPT}=process.getBuiltinModule('module').createRequire(app.getAppPath()+'/package.json')('./desktop/chatgpt.cjs');ChatGPT.prototype.translate=async(_m,blocks)=>blocks.map(b=>({id:b.id,text:b.text.includes('Alternative')?'버전 번역 결과입니다.':'원문 번역 결과입니다.'}));});
  await p.locator('[data-mode="translated"]').click();await p.locator('#dialog [data-action="gpt-start"]').click();await p.locator('[data-action="gpt-export"]').waitFor();await p.locator('.translated-block').first().filter({hasText:'원문 번역 결과'}).waitFor();
  await p.locator('#attachment-select').selectOption(versionAttachment);await p.locator('[data-mode="translated"]').click();await p.locator('#dialog [data-action="gpt-start"]').waitFor();assert.equal(await p.locator('.translated-block').count(),0);await p.locator('#dialog [data-action="gpt-start"]').click();await p.locator('[data-action="gpt-export"]').waitFor();await p.locator('.translated-block').first().filter({hasText:'버전 번역 결과'}).waitFor();
  await p.locator('[data-tab="주석"]').click();await p.locator('.annotation').filter({hasText:'버전 파일 주석'}).waitFor();assert.equal(await p.locator('.annotation').filter({hasText:'원문 파일 주석'}).count(),0);
  await p.locator('[data-tab="첨부"]').click();
  // Each attachment is one row (a click opens it) with a ⋯ menu; paper-wide actions are not among the files.
  assert.deepEqual(await p.locator('.reader-panel .attachment-row').first().locator('button').evaluateAll(list=>list.map(b=>b.className||b.dataset.action||'')),['attachment-open','row-more']);assert.equal(await p.locator('.reader-panel .item-attachments :is([data-trash-paper],[data-action="merge-item"])').count(),0);
  await p.locator(`[data-attachment-menu="${versionAttachment}"]`).click();await p.locator(`.pop-menu [data-set-primary="${versionAttachment}"]`).click();await p.waitForFunction(id=>selected().primaryAttachmentId===id,versionAttachment);assert.equal(await p.locator('.pop-menu').count(),0,'the menu closes after a choice');
  await p.locator('[data-action="back"]').click();await p.locator('[data-item-collection]').filter({hasText:'RAG 연구'}).click();assert.equal(await p.locator('.paper-item').count(),1);await p.locator('[data-item-collection]').filter({hasText:'학위논문'}).click();assert.equal(await p.locator('.paper-item').count(),1);
  // The list's status pill cycles without opening the paper; a row dropped on a sidebar collection joins it.
  await p.locator(`[data-cycle-status="${itemId}"]`).filter({hasText:'읽는 중'}).click();await p.locator(`[data-cycle-status="${itemId}"][data-status="완독"]`).waitFor();assert.equal(await p.evaluate(()=>state.screen),'library');await p.locator('#notes-panel [data-read-status="완독"][aria-checked="true"]').waitFor();
  await p.locator(`.paper-item[data-paper="${itemId}"]`).dragTo(p.locator('.sidebar [data-item-collection]').filter({hasText:'빠른 분류'}));await p.locator('#toast').filter({hasText:'빠른 분류'}).waitFor();await p.locator('[data-item-collection]').filter({hasText:'빠른 분류'}).click();assert.equal(await p.locator('.paper-item').count(),1);
  {const stored=(await p.evaluate(id=>window.appApi.refreshStorage(id),await p.evaluate(()=>state.storageKey))).papers.find(x=>x.id===itemId);assert.equal(stored.status,'완독');assert.equal(stored.collectionIds.length,3);}
  await p.locator('[data-action="toggle-collections"]').click();await p.locator('[data-action="toggle-collections"][aria-pressed="false"]').waitFor();
  assert.equal(await p.locator('[data-item-collection]').count(),0);assert.equal(await p.locator('#notes-panel [data-toggle-collection]').count(),0);
  {const stored=(await p.evaluate(id=>window.appApi.refreshStorage(id),await p.evaluate(()=>state.storageKey))).papers.find(x=>x.id===itemId);assert.equal(stored.collectionIds.length,3,'switching collections off keeps the memberships');}
  await p.locator('[data-action="toggle-collections"]').click();await p.locator('[data-item-collection]').filter({hasText:'빠른 분류'}).waitFor();
  // A duplicate is added only when asked for; merging it leaves one attachment for the same PDF and never removes disk files.
  const duplicatePath=path.join(temp,'중복후보.pdf');await fs.copyFile(path.join(temp,'원문.pdf'),duplicatePath);await choose([duplicatePath]);await p.locator('.library [data-action="add-files"]').click();await p.locator('#dialog h2').filter({hasText:'이미 있는 자료입니다'}).waitFor();assert.equal(await p.locator('.paper-item').filter({hasText:'중복후보'}).count(),0);await p.locator('#dialog [data-action="known-copies-add"]').click();await p.locator('.paper-item').filter({hasText:'중복후보'}).waitFor();const duplicateId=Number(await p.locator('.paper-item').filter({hasText:'중복후보'}).getAttribute('data-paper'));await p.locator('.paper-item').filter({hasText:'중복후보'}).click();await (await openNote(p)).fill('병합할 메모');await p.locator('#saved').filter({hasText:'저장소에 저장됨'}).waitFor();await p.locator('[data-action="back"]').click();
  await p.locator('[data-action="duplicates"]').click();const pair=[itemId,duplicateId].sort((a,b)=>a-b).join(',');await p.locator(`[data-merge-candidate="${pair}"]`).click();await p.locator('#merge-target').selectOption(String(itemId));await p.locator('[data-action="confirm-merge"]').click();await p.locator(`[data-paper="${duplicateId}"]`).waitFor({state:'detached'});await p.locator('.paper-item').filter({hasText:'첨부 논문'}).waitFor();assert.equal(await p.locator('.paper-item').filter({hasText:'중복후보'}).count(),0);
  await p.locator('.paper-item').filter({hasText:'첨부 논문'}).click();assert.match(await (await openNote(p)).inputValue(),/논문 공통 메모/);assert.match(await (await openNote(p)).inputValue(),/병합할 메모/);assert.equal(await p.locator('#attachment-select option').count(),2);assert.ok(await fs.stat(path.join(second,'중복후보.pdf')));
  await app.close();p=await launch();await p.locator('.storage strong').filter({hasText:'두 번째 저장소'}).waitFor();await p.locator('[data-nav="전체 자료"]').click();await p.locator('.paper-item').filter({hasText:'첨부 논문'}).click();assert.equal(await p.locator('#attachment-select').inputValue(),versionAttachment);assert.match(await (await openNote(p)).inputValue(),/병합할 메모/);await p.locator('[data-mode="translated"]').click();await p.locator('.translated-block').first().filter({hasText:'버전 번역 결과'}).waitFor();await p.locator('[data-tab="주석"]').click();await p.locator('.annotation').filter({hasText:'버전 파일 주석'}).waitFor();
  // Reading mode remains legible; PDF save still uses the fixed page layout.
  if(!await p.locator('.reading-translation').count())await (await toolShown(p, '[data-action="toggle-translation-reading"]')).click();await p.locator('.reading-translation .translated-block').first().waitFor();assert.equal(await p.locator('.reading-translation .translated-block').first().evaluate(node=>getComputedStyle(node).fontSize),'15.3333px');await p.evaluate(()=>saveGPTPdf());assert.equal((await fs.readFile(path.join(temp,'export.pdf'))).subarray(0,5).toString(),'%PDF-');
  assert.equal(await p.evaluate(async bytes=>{const pdfjs=await import('./pdfjs/pdf.mjs'),task=pdfjs.getDocument({data:new Uint8Array(bytes)}),doc=await task.promise;const count=doc.numPages;await task.destroy();return count;},Array.from(await fs.readFile(path.join(temp,'export.pdf'))))>=2,true);
  await (await toolShown(p, '[data-action="toggle-translation-reading"]')).click();await p.waitForFunction(()=>!document.querySelector('.reading-translation'));
  // 넓게 편집 opens the memo's wide editor on the annotation (toolbar, views, AI), and closing it saves.
  await p.locator('[data-edit-annotation]').click();await p.locator('.annotation-editor-dialog .md-toolbar [data-editor-ai]').waitFor();await p.locator('.annotation-editor-dialog [data-md-view="edit"]').click();await p.locator('#note-editor').fill('수정된 버전 파일 주석');await p.locator('#dialog [data-action="close"]').first().click();await p.locator('.annotation').filter({hasText:'수정된 버전 파일 주석'}).waitFor();
  await p.locator('[data-tab="첨부"]').click();await p.locator(`[data-attachment-menu="${versionAttachment}"]`).click();await p.locator(`.pop-menu [data-move-attachment="${versionAttachment}"]`).click();await p.locator('#move-folder').selectOption('연구/세부');await p.locator('#move-name').fill('이동한버전.pdf');await p.locator('[data-action="save-file-move"]').click();await p.locator('[data-open-attachment]').filter({hasText:'이동한버전.pdf'}).waitFor();assert.ok(await fs.stat(path.join(second,'연구','세부','이동한버전.pdf')));
  await fs.rename(path.join(second,'연구','세부','이동한버전.pdf'),path.join(second,'연구','세부','외부이름변경.pdf'));await p.locator('[data-action="refresh-vault"]').click();await p.locator('[data-nav="전체 자료"]').click();await p.locator('.paper-item').filter({hasText:'첨부 논문'}).click();assert.equal(await p.locator('#attachment-select').inputValue(),versionAttachment);assert.match(await (await openNote(p)).inputValue(),/병합할 메모/);await p.locator('[data-mode="translated"]').click();await p.locator('.translated-block').first().filter({hasText:'버전 번역 결과'}).waitFor();
  // Missing files remain visible and can be reconnected through the native chooser.
  await p.locator('[data-action="back"]').click();await p.locator('[data-nav="전체 자료"]').click();const lone=path.join(temp,'복구검증.pdf');await pdf(lone,'Recovery fixture DOI: 10.9876/recovery');
  // This vault checks the manual DOI flow, so filling on import is off here (library smoke covers it).
  await p.evaluate(()=>localStorage.setItem('app-autofill-'+state.storageKey,'off'));await choose([lone]);await p.locator('.library [data-action="add-files"]').click();await p.locator('.paper-item').filter({hasText:'복구검증'}).click();const loneId=await p.evaluate(()=>state.selected),loneAttachment=await p.evaluate(()=>state.selectedAttachment);await (await openNote(p)).fill('복원할 기록');await p.locator('#saved').filter({hasText:'저장소에 저장됨'}).waitFor();await fs.unlink(path.join(second,'복구검증.pdf'));await p.locator('[data-action="refresh-vault"]').click();await p.locator('.paper-item').filter({hasText:'복구검증'}).click();await p.locator(`[data-relink-attachment="${loneAttachment}"]`).waitFor();await fs.copyFile(lone,path.join(second,'재연결.pdf'));await choose([path.join(second,'재연결.pdf')]);await p.locator(`[data-relink-attachment="${loneAttachment}"]`).click();await p.locator('.paper-item').filter({hasText:'복구검증'}).click();assert.equal(await (await openNote(p)).inputValue(),'복원할 기록');
  // Explicit backups restore notes; trash restores the same paper without copying PDFs.
  await p.locator('[data-action="vault-manager"]').click(); await p.locator('[data-vm-tab="backup"]').click();await p.locator('[data-action="create-backup"]').click();await p.locator('.manager-row').filter({hasText:'사용자 백업'}).first().waitFor();const backupId=await p.evaluate(async()=>(await window.appApi.backups(state.storageKey)).find(b=>b.label==='사용자 백업').id);await p.locator('#dialog [data-action="close"]').first().click();await (await openNote(p)).fill('백업 이후 편집');await p.locator('#saved').filter({hasText:'저장소에 저장됨'}).waitFor();await p.locator('[data-action="vault-manager"]').click(); await p.locator('[data-vm-tab="backup"]').click();await p.locator(`[data-restore-backup="${backupId}"]`).click();await p.locator('[data-action="confirm-backup-restore"]').click();await p.locator('#dialog h2').filter({hasText:'저장소 관리'}).waitFor();await p.locator('#dialog [data-action="close"]').first().click();await p.locator('.paper-item').filter({hasText:'복구검증'}).click();assert.equal(await (await openNote(p)).inputValue(),'복원할 기록');await p.locator('[data-tab="첨부"]').click();await p.locator('#notes-panel [data-item-menu]').click();await p.locator(`.pop-menu [data-trash-paper="${loneId}"]`).click();await p.locator('[data-action="confirm-paper-trash"]').click();await p.locator(`[data-paper="${loneId}"]`).waitFor({state:'detached'});await p.locator('[data-action="vault-manager"]').click(); await p.locator('[data-vm-tab="trash"]').click();await p.locator(`[data-restore-paper="${loneId}"]`).click();await p.locator(`[data-restore-paper="${loneId}"]`).waitFor({state:'detached'});await p.locator('#dialog [data-action="close"]').first().click();await p.locator('.paper-item').filter({hasText:'복구검증'}).click();assert.equal(await (await openNote(p)).inputValue(),'복원할 기록');assert.ok(await fs.stat(path.join(second,'재연결.pdf')));
  await p.locator('[data-tab="서지"]').click();await p.locator('[data-action="edit-bibliography"]').click();await p.locator('[data-action="extract-doi"]').click();await p.waitForFunction(()=>document.querySelector('#bib-doi')?.value==='10.9876/recovery');await p.locator('[data-action="lookup-doi"]').click();await p.waitForFunction(()=>document.querySelector('#bib-creators')?.value==='연구자, API');assert.equal(await p.evaluate(()=>selected().authors),'저자 미입력');await p.locator('[data-action="save-bibliography"]').click();await p.locator('.bibliography').filter({hasText:'Fixture Journal'}).waitFor();
  await p.locator('[data-tab="첨부"]').click();await p.locator(`[data-attachment-menu="${loneAttachment}"]`).click();await p.keyboard.press('Escape');assert.equal(await p.locator('.pop-menu').count(),0);await p.locator(`[data-attachment-menu="${loneAttachment}"]`).click();await p.locator(`.pop-menu [data-trash-attachment="${loneAttachment}"]`).click();await p.locator('[data-action="confirm-attachment-trash"]').click();await p.locator('.paper-item').filter({hasText:'복구검증'}).click();await p.locator('.detail [data-action="attach-pdf"]').waitFor();await p.locator('[data-action="vault-manager"]').click(); await p.locator('[data-vm-tab="trash"]').click();await p.locator(`[data-restore-attachment="${loneAttachment}"]`).click();await p.locator(`[data-restore-attachment="${loneAttachment}"]`).waitFor({state:'detached'});await p.locator('#dialog [data-action="close"]').first().click();await p.locator('.paper-item').filter({hasText:'복구검증'}).click();assert.equal(await (await openNote(p)).inputValue(),'복원할 기록');
  await p.locator('[data-action="vault-manager"]').click(); await p.locator('[data-vm-tab="collections"]').click();await p.locator('[data-edit-collection]').first().click();await p.locator('#collection-edit').fill('이름 변경 컬렉션');await p.locator('[data-action="save-collection-edit"]').click();await p.locator('[data-item-collection]').filter({hasText:'이름 변경 컬렉션'}).waitFor();await p.locator('[data-delete-collection]').first().click();await p.locator('[data-action="confirm-collection-delete"]').click();await p.waitForFunction(()=>!Array.from(document.querySelectorAll('[data-item-collection]')).some(n=>n.textContent.includes('이름 변경 컬렉션')));
  await p.evaluate(()=>actions['export-ris']());assert.match(await fs.readFile(path.join(temp,'export.pdf'),'utf8'),/TY  - JOUR/);await p.evaluate(()=>actions['export-bib']());assert.match(await fs.readFile(path.join(temp,'export.pdf'),'utf8'),/@article/);
  const ris=path.join(temp,'references.ris');await fs.writeFile(ris,'TY  - JOUR\nTI  - 서지만 있는 연구\nAU  - RIS Author\nER  -\n');await choose([ris]);await p.locator('[data-vm-tab="bib"]').click();await p.locator('[data-action="import-ris"]').click();await p.locator('#dialog h2').filter({hasText:'가져오기 결과'}).waitFor();assert.match(await p.locator('#dialog').textContent(),/1개 항목을 가져왔습니다/);await p.locator('#dialog [data-action="close"]').last().click();await p.locator('[data-nav="전체 자료"]').click();await p.locator('.paper-item').filter({hasText:'서지만 있는 연구'}).click();await p.locator('.detail h2').filter({hasText:'서지만 있는 연구'}).waitFor();assert.equal(await p.locator('.detail [data-action="attach-pdf"]').count(),1);
  if(process.env.APP_SCREENSHOT_PATH)await p.screenshot({path:process.env.APP_SCREENSHOT_PATH});
  await p.locator('#search').fill(`10.1234/${appName.id}`);await p.locator('#search').press('Enter');assert.equal(await p.locator('.paper-item').count(),1);await p.locator('#search').fill('수정된 버전 파일 주석');await p.locator('#search').press('Enter');assert.equal(await p.locator('.paper-item').count(),1);await p.locator('#search').fill('복원할 기록');await p.locator('#search').press('Enter');assert.equal(await p.locator('.paper-item').count(),1);
  // Appearance: dark, then light again (the select shows the current mode), then a user theme from the themes folder.
  const bg=()=>p.evaluate(()=>getComputedStyle(document.body).getPropertyValue('--bg').trim());
  await p.locator('[data-action="settings"]').first().click();await p.locator('[data-llm-section="look"] summary').click();
  await p.locator('#theme').selectOption('dark');await p.waitForFunction(()=>document.body.classList.contains('dark'));
  assert.equal(await p.locator('#theme').inputValue(),'dark');await p.locator('#theme').selectOption('light');await p.waitForFunction(()=>!document.body.classList.contains('dark'));
  await p.locator('#dialog [data-action="close"]').last().click();await p.locator('[data-action="settings"]').first().click();
  await p.locator('#dialog[open] [data-llm-section="look"]').waitFor({state:'attached'});await p.evaluate(()=>{document.querySelector('[data-llm-section="look"]').open=true;});await p.locator('#theme').waitFor();assert.equal(await p.locator('#theme').inputValue(),'light','reopened, it shows 밝게');
  const userData=await app.evaluate(({app})=>app.getPath('userData')),themeDir=path.join(userData,'themes','smoke-test');
  await fs.mkdir(themeDir,{recursive:true});await fs.writeFile(path.join(themeDir,'manifest.json'),JSON.stringify({id:'smoke-test',name:'시험 테마',themeApiVersion:1,modes:['light']}));
  await fs.writeFile(path.join(themeDir,'theme.css'),'@import url("https://evil.test/x.css");[data-kn-ui][data-kn-mode="light"]{--kn-background:#123456}');
  await p.waitForTimeout(100);await p.locator('[data-action="themes-reload"]').click();await p.locator('#kn-theme-select option[value="smoke-test"]').waitFor({state:'attached'});
  await p.locator('#kn-theme-select').selectOption('smoke-test');await p.waitForFunction(()=>getComputedStyle(document.body).getPropertyValue('--bg').trim()==='#123456');
  assert.ok(!(await p.evaluate(()=>[...document.querySelectorAll('style[data-kn-custom]')].map(n=>n.textContent).join(''))).includes('evil.test'),'no @import');
  await fs.writeFile(path.join(themeDir,'theme.css'),'[data-kn-ui][data-kn-mode="light"]{--kn-background:#654321}');await p.waitForFunction(()=>getComputedStyle(document.body).getPropertyValue('--bg').trim()==='#654321',null,{timeout:10000});
  await p.locator('#theme').selectOption('dark');await p.waitForFunction(()=>document.body.classList.contains('dark'));assert.equal(await bg(),'#17171c','a light-only theme sits out in dark mode');
  await p.locator('#theme').selectOption('light');await p.waitForFunction(()=>getComputedStyle(document.body).getPropertyValue('--bg').trim()==='#654321');
  await p.locator('#kn-styles-off').check();await p.waitForFunction(()=>getComputedStyle(document.body).getPropertyValue('--bg').trim()==='#f2f4f6');
  await p.locator('#kn-styles-off').uncheck();await p.locator('#kn-theme-select').selectOption('');await p.locator('#dialog [data-action="close"]').last().click();
  await app.close();app=null;
  const data=JSON.parse(await fs.readFile(path.join(vault,appName.vaultDir,'library.json'),'utf8'));assert.equal(data.papers.length,1);assert.ok(await fs.stat(path.join(vault,appName.vaultDir,`translation-${data.papers[0].id}.json`)));
  assert.equal(JSON.parse(await fs.readFile(path.join(second,appName.vaultDir,'library.json'),'utf8')).papers.length,5);
  console.log('PASS Electron: native vault/import, PDF protocol, notes across restart, incremental parallel GPT translation, page retranslation, failure resume across restart, simulated GPT inference, PDF export, split and sidebars, nested folder creation, selected-folder import, tree selection, external refresh, folder and notes across restart, item metadata, multiple attachments, per-file translations and annotations, multi-collection membership, duplicate merge and restart, vault isolation, real-file drag/drop, mixed invalid files, duplicate drop, readable translation PDF, annotation editing, native file move, external rename, missing-file reconnect, backup restore, trash restore');
 } catch(error){try{await (await app.firstWindow()).screenshot({path:`/tmp/${appName.id}-smoke-failure.png`});}catch{}throw error;} finally {if(app)await app.close();await fs.rm(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }).catch(error => console.warn(`임시 폴더를 다 지우지 못했습니다(${error.code}). 테스트 결과와는 무관합니다: ${temp}`))}
})().catch(e=>{console.error(e);process.exit(1)});
