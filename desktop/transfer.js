// Sending papers, or the whole vault, to another vault on this computer (desktop/transfer.cjs does the work in the main
// process; docs/DEVELOPMENT.md, "다른 저장소로 복사·이동"). The dialog: the receiving vault (a recent one, or a folder
// picked), copy or move, what to do with papers sent before, a summary of what will happen, then the send.
let transferForm=null;
// A vault in the list: its name and, beside it, where it is (two vaults can have one name).
const transferOption=t=>`<option value="${esc(t.key)}" title="${esc(t.where)}">${esc(t.name)} (${esc(t.where)})</option>`;
const transferBytes=n=>n>=1e9?`${(n/1e9).toFixed(1)} GB`:n>=1e6?`${(n/1e6).toFixed(1)} MB`:`${Math.max(1,Math.round(n/1e3))} KB`;
async function openTransferDialog({paperIds=null,mode='copy'}={}){
  const targets=await window.appApi.transferTargets(state.storageKey);
  transferForm={paperIds,mode,key:'',existing:'skip',folder:'',keepFolders:transferKeepFolders(),targets,preview:null,running:false,turn:0};
  const whole=paperIds===null;
  modal(whole?tr('저장소 전체 보내기'):tr('다른 저장소로 보내기'),
    `<div class="transfer-form">
      <p class="small muted">${whole?tr('이 저장소의 모든 자료와 노트북을 다른 저장소로 보냅니다.'):tr('선택한 자료 {n}편을 메모·주석·필기·번역·노트북과 함께 다른 저장소로 보냅니다.',{n:paperIds.length})}</p>
      <label class="transfer-field"><span>${tr('받는 저장소')}</span><select id="transfer-target"><option value="">${tr('고르세요')}</option>${targets.map(transferOption).join('')}<option value="__pick">${tr('폴더 선택…')}</option></select></label>
      <label class="transfer-field"><span>${tr('받는 폴더')}</span><select id="transfer-folder" disabled>${transferFolderOptions([])}</select></label>
      <label class="transfer-field" id="transfer-new-folder" hidden><span>${tr('새 폴더 이름')}</span><input id="transfer-folder-name" maxlength="128" placeholder="${tr('예: 받은 자료')}"></label>
      <label class="transfer-check"><input type="checkbox" id="transfer-keep" ${transferForm.keepFolders?'checked':''}> ${tr('보낸 쪽 폴더 구조 유지')}</label>
      <div class="transfer-modes" role="radiogroup" aria-label="${tr('보내는 방법')}"><label><input type="radio" name="transfer-mode" value="copy" ${mode==='copy'?'checked':''}> ${tr('복사')}</label><label><input type="radio" name="transfer-mode" value="move" ${mode==='move'?'checked':''}> ${tr('이동')}</label></div>
      <div id="transfer-existing" hidden></div>
      <p id="transfer-summary" class="small" aria-live="polite"></p>
      <ul id="transfer-notes" class="small"></ul>
      <p id="transfer-progress" class="small muted" hidden></p>
    </div>`,
    `<button class="secondary" data-action="transfer-close">${tr('취소')}</button><button class="primary" data-action="transfer-run" disabled>${tr('보내기')}</button>`);
  dialog.classList.add('transfer-dialog');
}
// The receiving folder: the vault's top, one of its folders (indented by depth), or a new one named here. Keeping the
// sending side's folders (or putting the PDFs straight in the receiving folder) is remembered on this computer.
function transferKeepFolders(){try{return localStorage.getItem('app-transfer-keep-folders')!=='0';}catch{return true;}}
function transferFolderOptions(folders){return `<option value="">${tr('저장소 맨 위',null,'receiving folder')}</option>${folders.map(f=>{const parts=f.split('/');return `<option value="${esc(f)}" title="${esc(f)}">${'\u00a0\u00a0'.repeat(parts.length-1)}${esc(parts.at(-1))}</option>`;}).join('')}<option value="__new">${tr('새 폴더…')}</option>`;}
async function transferFolders(){
  const f=transferForm,select=dialog.querySelector('#transfer-folder');if(!f||!select)return;f.folder='';dialog.querySelector('#transfer-new-folder').hidden=true;
  select.innerHTML=transferFolderOptions([]);select.disabled=!f.key;if(!f.key)return;
  const key=f.key,folders=await window.appApi.transferFolders(state.storageKey,key).catch(()=>[]);if(transferForm!==f||f.key!==key)return;
  select.innerHTML=transferFolderOptions(folders);select.value='';
}
const transferFolderLabel=f=>f.folder?f.folder:tr('저장소 맨 위',null,'receiving folder');
// What the chosen send would do, asked again whenever a choice changes (a later answer replaces an earlier one).
async function transferPreview(){
  const f=transferForm;if(!f)return;const turn=++f.turn,run=dialog.querySelector('[data-action="transfer-run"]'),summary=dialog.querySelector('#transfer-summary');
  if(!f.key){f.preview=null;if(run)run.disabled=true;summary.textContent='';transferNotes();return;}
  summary.textContent=tr('살펴보는 중…');if(run)run.disabled=true;
  try{
    const preview=await window.appApi.transferPreview(state.storageKey,{paperIds:f.paperIds,key:f.key,existing:f.existing,folder:f.folder,keepFolders:f.keepFolders});if(turn!==f.turn||transferForm!==f)return;
    f.preview=preview;const c=preview.counts;
    const lines=[tr('자료 {n}편 · PDF {pdfs}개 · {size}',{n:c.papers,pdfs:c.pdfs,size:transferBytes(c.bytes)})];
    if(c.merge)lines.push(tr('받는 쪽에서 합칠 자료 {n}편',{n:c.merge}));
    if(preview.translating.length)lines.push(tr('번역 중이라 뺄 자료 {n}편',{n:preview.translating.length}));
    if(c.missingPdf)lines.push(tr('PDF 파일이 없는 첨부 {n}개(기록만 갑니다)',{n:c.missingPdf}));
    summary.textContent=lines.join(' · ')+'\n'+tr('받는 폴더: {folder}',{folder:transferFolderLabel(f)})+(f.keepFolders?'':' · '+tr('폴더 구조 없이'));
    const existing=dialog.querySelector('#transfer-existing');existing.hidden=!preview.previous;
    if(preview.previous)existing.innerHTML=`<p class="small">${tr('받는 저장소에 이미 보낸 자료 {n}편이 있습니다.',{n:preview.previous})}</p><div class="transfer-modes" role="radiogroup" aria-label="${tr('이미 보낸 자료')}"><label><input type="radio" name="transfer-existing" value="skip" ${f.existing==='skip'?'checked':''}> ${tr('건너뛰기')}</label><label><input type="radio" name="transfer-existing" value="replace" ${f.existing==='replace'?'checked':''}> ${tr('보낸 쪽 내용으로 바꾸기')}</label></div>`;
    if(run)run.disabled=!c.papers&&!c.skip;
  }catch(error){if(turn!==f.turn)return;f.preview=null;summary.textContent=plainError(error);if(run)run.disabled=true;}
  transferNotes();
}
// One line for each thing a person should know before sending.
function transferNotes(){
  const f=transferForm,list=dialog.querySelector('#transfer-notes');if(!f||!list)return;const p=f.preview,notes=[];
  if(f.mode==='move')notes.push(tr('보낸 저장소에서 지워집니다(PDF는 컴퓨터의 휴지통으로).'));
  if(f.mode==='move'&&p?.sourceSynced)notes.push(tr('동기화하는 다른 PC에는 지워진 것으로 전해집니다.'));
  if(f.existing==='replace'&&p?.previous)notes.push(tr('받는 쪽에서 고친 내용이 사라집니다.'));
  if(p?.fresh)notes.push(p.loosePdfs?tr('그 폴더에 새 저장소를 만들고, 폴더 안의 PDF {n}개도 자료로 등록합니다.',{n:p.loosePdfs}):tr('그 폴더에 새 저장소를 만듭니다.'));
  list.innerHTML=notes.map(n=>`<li>${esc(n)}</li>`).join('');
}
// While a send runs its dialog stays (Esc and × do nothing; 취소 asks it to stop) and the page under it cannot be used.
function transferRunning(on){
  const f=transferForm;if(f)f.running=on;dialog.classList.toggle('transfer-running',on);
  const close=dialog.querySelector('.dialog-head .close');if(close)close.hidden=on;
  for(const n of dialog.querySelectorAll('.transfer-form select,.transfer-form input'))n.disabled=on;
  const progress=dialog.querySelector('#transfer-progress');if(progress){progress.hidden=!on;if(on)progress.textContent=tr('보내는 중…');}
}
async function transferRun(){
  const f=transferForm;if(!f||f.running||!f.key)return;f.cancelled=false;transferRunning(true);
  const run=dialog.querySelector('[data-action="transfer-run"]');if(run)run.disabled=true;
  // What the screen still holds (memos being typed, ink not yet saved) is saved first, so the latest goes. A memo that
  // cannot be saved stops the send: it would be in neither vault.
  try{if(typeof desktopNotes==='function')await desktopNotes();}
  catch(error){transferRunning(false);if(run)run.disabled=false;toast(tr('메모를 저장하지 못해 보내지 않았습니다: {reason}',{reason:plainError(error)}),9000);return;}
  await globalThis.appFlushAll?.().catch?.(()=>{});
  if(f.cancelled){transferRunning(false);if(run)run.disabled=false;toast(tr('보내기를 취소했습니다.'));return;}
  try{
    const result=await window.appApi.transferRun(state.storageKey,{paperIds:f.paperIds,key:f.key,mode:f.mode,existing:f.existing,folder:f.folder,keepFolders:f.keepFolders});
    transferRunning(false);transferForm=null;dialog.close();
    if(f.mode==='move'){for(const id of result.report.sent)batchSelection.delete(id);}
    applyItemSnapshot(result.snapshot,{screen:state.screen==='reader'&&f.mode==='move'&&result.report.sent.includes(state.selected)?'library':state.screen});
    const r=result.report,parts=[];
    if(r.sent.length)parts.push(f.mode==='move'?tr('자료 {n}편을 \'{name}\'(으)로 옮겼습니다.',{n:r.sent.length,name:result.target.name}):tr('자료 {n}편을 \'{name}\'(으)로 복사했습니다.',{n:r.sent.length,name:result.target.name}));
    if(r.skipped.length&&!r.sent.length)parts.push(tr('모두 받는 저장소에 이미 있어 건너뛰었습니다.'));
    // The papers skipped, by name and why; how many were given new numbers there.
    const exists=r.skipped.filter(s=>s.reason!=='joined'),joined=r.skipped.filter(s=>s.reason==='joined');
    if(exists.length)parts.push(tr('이미 있어 건너뜀: {titles}',{titles:transferTitles(exists)}));
    if(joined.length)parts.push(tr('받는 쪽에서 합쳐 둔 자료라 건너뜀: {titles}',{titles:transferTitles(joined)}));
    if(r.renumbered)parts.push(tr('받는 쪽 번호와 겹쳐 번호를 바꾼 자료 {n}편',{n:r.renumbered}));
    if(result.translating.length)parts.push(tr('번역 중이라 뺀 자료 {n}편',{n:result.translating.length}));
    if(result.removed?.failed?.length)parts.push(tr('보낸 저장소에서 지우지 못한 것: {names}',{names:result.removed.failed.join(', ')}));
    toast(parts.join(' '),9000);transferOpenButton(result.target.key);
  }catch(error){
    transferRunning(false);
    if(errorCode(error)==='APP_TRANSFER_CANCELLED'){toast(tr('보내기를 취소했습니다.'));transferPreview();return;}
    transferForm=null;dialog.close();toast(plainError(error),9000);
  }
}
// The result's notice offers to open the receiving vault.
function transferOpenButton(key){
  const t=document.querySelector('#toast');if(!t)return;
  t.insertAdjacentHTML('beforeend',` <button type="button" class="toast-action" data-transfer-open="${esc(key)}">${tr('열기')}</button>`);
}
const transferTitles=list=>list.slice(0,5).map(s=>s.title||String(s.id)).join(', ')+(list.length>5?tr(' 외 {n}편',{n:list.length-5}):'');
// 열기 saves what the screen holds first, as every switch to another vault does.
document.addEventListener('click',event=>{const b=event.target.closest('[data-transfer-open]');if(!b)return;runDesktop(async()=>{await desktopNotes();await globalThis.appFlushAll?.();const snapshot=await window.appApi.transferOpen(state.storageKey,b.dataset.transferOpen);applySnapshot(snapshot);document.querySelector('#toast')?.classList.remove('show');})();});
window.appApi?.onTransferProgress?.(({done,total})=>{const p=document.querySelector('#transfer-progress');if(p&&transferForm?.running)p.textContent=tr('보내는 중… {done}/{total}',{done,total});});
// A new folder's name is asked about as it is typed (the main process checks it as a folder name).
let transferNameTimer=null;
document.addEventListener('input',event=>{if(event.target.id!=='transfer-folder-name'||!transferForm)return;clearTimeout(transferNameTimer);transferNameTimer=setTimeout(()=>{if(!transferForm)return;transferForm.folder=event.target.value.trim();transferPreview();},300);});
document.addEventListener('change',event=>{
  if(!transferForm||!event.target.closest?.('.transfer-form'))return;const f=transferForm;
  if(event.target.id==='transfer-target'){
    const select=event.target;
    // A folder refused (or none picked) leaves the vault chosen before.
    if(select.value==='__pick')runDesktop(async()=>{let picked;try{picked=await window.appApi.transferPick(state.storageKey);}catch(error){select.value=f.key;throw error;}if(!picked){select.value=f.key;return;}
      if(!select.querySelector(`option[value="${CSS.escape(picked.key)}"]`))select.querySelector('option[value="__pick"]').insertAdjacentHTML('beforebegin',transferOption(picked));
      select.value=picked.key;f.key=picked.key;f.existing='skip';await transferFolders();transferPreview();})();
    else runDesktop(async()=>{f.key=select.value;f.existing='skip';await transferFolders();transferPreview();})();
    return;
  }
  if(event.target.id==='transfer-folder'){
    const create=event.target.value==='__new',box=dialog.querySelector('#transfer-new-folder');box.hidden=!create;
    if(create){f.folder=dialog.querySelector('#transfer-folder-name').value.trim();dialog.querySelector('#transfer-folder-name').focus();}else f.folder=event.target.value;
    transferPreview();return;
  }
  if(event.target.id==='transfer-keep'){f.keepFolders=event.target.checked;try{localStorage.setItem('app-transfer-keep-folders',f.keepFolders?'1':'0');}catch{}transferPreview();return;}
  if(event.target.name==='transfer-mode'){f.mode=event.target.value;transferNotes();return;}
  if(event.target.name==='transfer-existing'){f.existing=event.target.value;transferPreview();}
});
Object.assign(actions,{
  'batch-transfer':runDesktop(()=>openTransferDialog({paperIds:[...batchSelection].filter(id=>papers.some(p=>p.id===id))})),
  'transfer-item':runDesktop(()=>openTransferDialog({paperIds:[state.selected]})),
  'transfer-whole-copy':runDesktop(()=>openTransferDialog({paperIds:null,mode:'copy'})),
  'transfer-whole-move':runDesktop(()=>openTransferDialog({paperIds:null,mode:'move'})),
  'transfer-run':runDesktop(transferRun),
  // While sending, 취소 stops a send that has not reached the receiving vault's save; otherwise it closes the dialog.
  'transfer-close':runDesktop(async()=>{if(transferForm?.running){transferForm.cancelled=true;await window.appApi.transferCancel(state.storageKey);return;}transferForm=null;dialog.close();}),
});
// Esc, × and a click beside the dialog do not close a send that runs.
dialog.addEventListener('cancel',event=>{if(transferForm?.running)event.preventDefault();});
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&transferForm?.running&&dialog.open){event.preventDefault();event.stopImmediatePropagation();}},true);
document.addEventListener('click',event=>{if(!transferForm?.running||!dialog.open)return;if(event.target===dialog||event.target.closest?.('[data-action="close"]')){event.preventDefault();event.stopImmediatePropagation();}},true);
// Where the sends start: the selection bar's file group, the item's ⋯ menu, the vault manager's backup tab.
const baseTransferBar=batchBar;
batchBar=function(){return baseTransferBar().replace('<!--batch-file-->',`<button class="secondary small" data-action="batch-transfer" title="${tr('선택한 자료를 다른 저장소로 복사하거나 옮깁니다')}">${tr('다른 저장소로…')}</button><!--batch-file-->`);};
const baseTransferMenu=itemMenu;
itemMenu=function(paper){return baseTransferMenu(paper).replace(/(<button type="button" role="menuitem" class="danger" data-trash-paper)/,`<button type="button" role="menuitem" data-action="transfer-item">${tr('다른 저장소로…')}</button>$1`);};
const baseTransferManager=showVaultManager;
showVaultManager=async function(){
  await baseTransferManager();
  const panel=dialog.querySelector('#vm-panel-backup');if(!panel||panel.querySelector('[data-action="transfer-whole-copy"]'))return;
  const card=document.createElement('section');card.className='vm-card';
  card.innerHTML=`<h3>${tr('다른 저장소로 보내기')}</h3><p class="small muted">${tr('이 저장소의 모든 자료와 노트북을 이 PC의 다른 저장소로 복사하거나 옮깁니다. 받는 저장소에 합쳐집니다.')}</p><div class="vm-buttons"><button class="secondary" data-action="transfer-whole-copy">${tr('전체 복사…')}</button><button class="secondary" data-action="transfer-whole-move">${tr('전체 이동…')}</button></div>`;
  panel.append(card);
};
actions['vault-manager']=runDesktop(showVaultManager);
