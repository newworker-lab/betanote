/* Everyday help around the main screens: reading a vault again after another program
   changed it, the shortcut list, and the general settings (알림·도움말). */

// ---- 저장소가 밖에서 바뀌었을 때 ----
// The main process refuses a save once library.json differs from what it last read or
// wrote. The page then offers to read the vault again; notes not yet saved go with the
// request and are merged (storage.cjs mergePendingNotes).
// When the vault's folder itself is gone (renamed, moved, its drive taken out: info.gone), there is nothing to read
// again where it was: the page asks where the folder is now instead (vault-relocate).
let outsideChange={asked:false,waiting:false,checkedAt:0,gone:false};
function askVaultReload(info){
  if(!state.storageKey||state.screen==='welcome')return;
  if(info)outsideChange.gone=info.gone===true;
  if(outsideChange.gone){
    if(dialog.open&&!dialog.querySelector('[data-action="vault-relocate"]')){
      if(!outsideChange.waiting){outsideChange.waiting=true;toast(tr('저장소 폴더를 찾을 수 없습니다. 이 창을 닫으면 다시 연결을 안내합니다.'));dialog.addEventListener('close',()=>{outsideChange.waiting=false;setTimeout(askVaultReload,0);},{once:true});}
      return;
    }
    if(dialog.open)return;
    outsideChange.asked=true;
    modal(tr('저장소 폴더를 찾을 수 없습니다'),`<p>${tr('저장소 폴더의 이름을 바꿨거나 다른 곳으로 옮겼거나, 드라이브가 빠졌습니다. 자료를 잃지 않도록 저장을 멈췄습니다.')}</p><p>${tr('<strong>폴더 다시 고르기</strong>로 그 폴더를 고르면 재시작 없이 이어서 씁니다. 아직 저장하지 못한 메모는 함께 보존합니다.')}</p><p class="small muted">${tr('드라이브가 빠진 것이라면 다시 연결한 뒤 같은 폴더를 고르세요.')}</p>`,btn(tr('나중에'),'close')+btn(tr('폴더 다시 고르기'),'vault-relocate','primary'));
    return;
  }
  if(dialog.open){
    // Another dialog is in use: say so now and ask once it closes.
    if(!outsideChange.waiting){outsideChange.waiting=true;toast(tr('저장소가 다른 프로그램에서 변경됐습니다. 이 창을 닫으면 다시 읽기를 안내합니다.'));dialog.addEventListener('close',()=>{outsideChange.waiting=false;setTimeout(askVaultReload,0);},{once:true});}
    return;
  }
  outsideChange.asked=true;
  modal(tr('저장소가 다른 프로그램에서 변경됐습니다'),`<p>${tr('동기화 도구나 다른 PC가 이 저장소의 서지·메모 파일을 바꿨습니다. 덮어쓰지 않도록 저장을 멈췄습니다.')}</p><p>${tr('<strong>다시 읽기</strong>를 누르면 바뀐 내용을 불러와 재시작 없이 이어서 씁니다. 아직 저장하지 못한 메모는 함께 보존합니다. 양쪽에서 같은 메모를 고쳤다면 두 내용을 모두 남깁니다.')}</p><p class="small muted">${tr('PDF 파일은 바꾸지 않습니다.')}</p>`,btn(tr('나중에'),'close')+btn(tr('다시 읽기'),'vault-reload','primary'));
}
async function reloadVaultFromDisk(){
  const id=state.storageKey;if(!id)return;
  clearTimeout(noteSaveTimer);await pendingNotes.catch(()=>{});
  const snapshot=await window.appApi.reloadVault(id,JSON.parse(JSON.stringify(notes)));
  if(state.storageKey!==id)return;
  if(dialog.open)dialog.close();
  outsideChange.asked=false;applyItemSnapshot(snapshot);
  const {kept=0,conflicts=0}=snapshot.reloaded||{};
  toast(conflicts?tr('저장소를 다시 읽었습니다. 양쪽에서 고친 메모 {n}개는 두 내용을 모두 남겼습니다.',{n:conflicts}):kept?tr('저장소를 다시 읽었습니다. 저장하지 못한 메모 {n}개를 보존했습니다.',{n:kept}):tr('저장소를 다시 읽었습니다.'));
}
async function relocateVault(){
  const id=state.storageKey;if(!id)return;
  clearTimeout(noteSaveTimer);await pendingNotes.catch(()=>{});
  const snapshot=await window.appApi.relocateVault(id,JSON.parse(JSON.stringify(notes)));
  if(!snapshot||state.storageKey!==id)return; // the folder dialog was closed: the question stays
  if(dialog.open)dialog.close();
  outsideChange.asked=false;outsideChange.gone=false;applyItemSnapshot(snapshot);
  const {kept=0,conflicts=0}=snapshot.reloaded||{};
  toast(conflicts?tr('저장소를 다시 연결했습니다. 양쪽에서 고친 메모 {n}개는 두 내용을 모두 남겼습니다.',{n:conflicts}):kept?tr('저장소를 다시 연결했습니다. 저장하지 못한 메모 {n}개를 보존했습니다.',{n:kept}):tr('저장소를 다시 연결했습니다.'));
}
window.appApi.onVaultChangedOutside?.(info=>askVaultReload(info));
// Coming back to the window is when an outside change is most likely: find it before the next save fails.
window.addEventListener('focus',()=>{
  const id=state.storageKey,now=Date.now();if(!id||outsideChange.asked||now-outsideChange.checkedAt<5000||!window.appApi.checkVault)return;
  outsideChange.checkedAt=now;
  window.appApi.checkVault(id).then(result=>{if((result?.changed||result?.gone)&&state.storageKey===id)askVaultReload(result);}).catch(()=>{});
});

// ---- 단축키 ----
const SHORTCUT_GROUPS=[
  [tr('어디서나'),[['Ctrl+K',tr('검색 — 서지·메모·주석·텍스트 상자·노트북, 찾은 곳을 누르면 그 자리로')],['Ctrl+O',tr('저장소 열기')],['Ctrl+Shift+O',tr('파일 추가')],['Ctrl+S',tr('PDF로 저장')],['Ctrl+,',tr('설정')],['F5',tr('파일 목록 새로고침')],['?  또는  F1',tr('단축키 보기')],['Esc',tr('열린 창·메뉴 닫기, 진행 중인 선택 취소')]]], // i18n:keep — '?  또는  F1' is a key spec split by the separator pattern in showShortcuts
  [tr('라이브러리'),[['Enter',tr('고른 자료 열기')],['Ctrl+A',tr('목록·파일 트리 전체 선택')],[tr('Ctrl+클릭 · Shift+클릭'),tr('여러 자료 선택')],['F2',tr('파일·폴더 이름 바꾸기')],['Delete',tr('최근 저장소 목록에서 삭제(시작 화면)')],['PageUp · PageDown',tr('자료 목록 스크롤')]]],
  [tr('읽기',null,'shortcuts'),[['Ctrl+F',tr('본문에서 찾기')],['PageUp · PageDown · Space',tr('한 화면씩 스크롤 (Shift+Space는 위로)')],['↑ · ↓ · ← · →',tr('조금씩 스크롤 (←·→는 쪽이 창보다 넓을 때)')],['Home · End',tr('맨 위 · 맨 아래로')],[tr('Ctrl+휠'),tr('확대·축소')]]],
  [tr('필기'),[['Ctrl+1 ~ 9',tr('도구 고르기(도구 막대 순서). 같은 키를 다시 누르면 다음 모양')],['Shift+1 ~ 9',tr('색 고르기')],['Ctrl+Z · Ctrl+Y',tr('필기 실행 취소 · 다시 실행')],['Delete',tr('올가미로 고른 필기 삭제')],['Ctrl+D',tr('올가미로 고른 필기 복제')]]],
  [tr('문장을 선택한 뒤'),[['H',tr('형광펜')],['U',tr('밑줄')],['N',tr('주석 추가 (주석에서 AI에게 묻기)')]]],
  [tr('메모·텍스트 상자'),[['Ctrl+B · Ctrl+I',tr('굵게 · 기울임')],['Ctrl+U',tr('밑줄(텍스트 상자)')],['Ctrl+K',tr('링크(메모 편집)')],['Ctrl+Shift+M',tr('수식(메모 편집)')]]],
];
function showShortcuts(){
  modal(tr('단축키'),`<div class="shortcut-help">${SHORTCUT_GROUPS.map(([title,rows])=>`<section><h3>${esc(title)}</h3><dl>${rows.map(([keys,text])=>`<div><dt>${keys.split(/( · |  또는  | ~ )/).map(part=>/^( · |  또는  | ~ )$/.test(part)?`<span class="shortcut-sep">${esc(part.trim()==='또는'?tr('또는'):part.trim())}</span>`:`<kbd>${esc(part)}</kbd>`).join('')}</dt><dd>${esc(text)}</dd></div>`).join('')}</dl></section>`).join('')}</div><p class="small muted">${tr('macOS에서는 Ctrl 대신 ⌘를 씁니다. 도구 막대의 단추에 마우스를 올리면 그 단추의 단축키가 보입니다.')}</p>`,btn(tr('닫기'),'close')); // i18n:keep — '또는' is the separator token parsed from the key spec
}
document.addEventListener('keydown',event=>{
  if(event.isComposing||event.ctrlKey||event.metaKey||event.altKey||dialog.open)return;
  const typing=event.target.closest?.('input,textarea,select,[contenteditable="true"],.cm-editor');
  if(event.key==='F1'||(event.key==='?'&&!typing)){event.preventDefault();showShortcuts();}
});

// ---- 설정 → 알림·도움말 ----
function generalSummary(){return featureOn('notifications')?tr('번역 완료 알림 켬'):tr('번역 완료 알림 끔');}
function generalSection(){
  return `<label class="llm-check"><input type="checkbox" id="kn-notify" ${featureOn('notifications')?'checked':''}> ${tr('번역이 끝나면 알림 보내기')}</label><p class="small muted">${tr('창이 뒤에 있을 때만 시스템 알림을 보냅니다. 번역 진행률은 작업 표시줄의 앱 아이콘에도 표시됩니다.')}</p><label class="llm-check"><input type="checkbox" id="kn-update" ${featureOn('updateCheck')?'checked':''}> ${tr('시작할 때 새 버전 확인')}</label><p class="small muted">${tr('하루에 한 번까지 GitHub의 공개 릴리스 정보만 확인합니다. 자료나 사용 기록은 보내지 않으며, 새 버전이 있으면 알리기만 하고 설치하지 않습니다.')}</p><div class="row">${btn(tr('단축키 보기'),'shortcuts')}</div>`;
}
document.addEventListener('change',event=>{
  const feature={'kn-notify':'notifications','kn-update':'updateCheck'}[event.target.id];if(!feature)return;
  const box=event.target,on=box.checked;
  window.appApi.featureSet(feature,on).then(features=>{desktopPreferences.features=features;const summary=document.querySelector('[data-llm-section="general"] summary small');if(summary)summary.textContent=generalSummary();},error=>{box.checked=!on;toast(plainError(error));});
});
Object.assign(actions,{
  'vault-reload':runDesktop(reloadVaultFromDisk),
  'vault-relocate':runDesktop(relocateVault),
  'shortcuts':runDesktop(async()=>{showShortcuts();}),
});

// ---- 메뉴 막대 ----
// A menu command (main.cjs buildMenu) presses the control the screen already has for it,
// or runs the same action. A command with no control on the current screen says so.
const MENU_NEEDS_PAPER=new Set(['edit-bibliography','autofill-paper','cite-paper','tag-ai','trash-paper','delete-paper','gpt-prepare','gpt-stop','ai-summary','figure','memo-new','save-pdf','mode','reader-zoom-in','reader-zoom-out','reader-fit','reader-outline','reader-thumbs','find']);
const MENU_FREE=new Set(['storage','open-recent','settings','shortcuts','themes-open']);
function menuPress(...selectors){for(const selector of selectors){const node=[...document.querySelectorAll(selector)].find(n=>n.offsetParent!==null&&!n.disabled);if(node){node.click();return true;}}return false;}
function menuReader(){if(state.screen==='reader')return true;if(!selected())return false;actions.read();return true;}
const menuCommands={
  'open-recent':id=>runDesktop(async()=>{await desktopNotes();await globalThis.appFlushAll?.();applySnapshot(await window.appApi.openRecent(id));await refreshPreferences();})(),
  search:()=>document.querySelector('#search')?.focus(),
  find:()=>{if(!menuReader())return false;setTimeout(()=>{const input=document.querySelector('.pdf-find-input');if(input){input.focus();input.select();}else menuPress('[data-action="reader-find"]','.pdf-find-toggle');},state.screen==='reader'?0:400);},
  mode:mode=>{if(!menuReader())return false;setTimeout(()=>menuPress(`[data-mode="${mode}"]`),0);},
  'reader-zoom-in':()=>menuPress('[data-reader-zoom=".1"]'),
  'reader-zoom-out':()=>menuPress('[data-reader-zoom="-.1"]'),
  'reader-fit':()=>menuPress('[data-reader-fit]'),
  'save-pdf':()=>menuPress('[data-action="gpt-export"]','[data-action="ink-export-original"]','[data-action="nb-export"]'),
  'tag-ai':()=>{const paper=selected();if(!paper)return false;runDesktop(tagAiConfirm)(paper.id);},
  'trash-paper':()=>{const paper=selected();if(!paper)return false;const button=document.createElement('button');button.dataset.trashPaper=paper.id;button.hidden=true;document.body.append(button);button.click();button.remove();},
  'delete-paper':()=>{const paper=selected();if(!paper)return false;const button=document.createElement('button');button.dataset.deletePaper=paper.id;button.hidden=true;document.body.append(button);button.click();button.remove();},
  back:()=>{if(state.screen==='reader')actions.back?.();},
};
window.appApi.onMenuCommand?.((command,arg)=>{
  // An open dialog is answered first; the menu does not start something else behind it.
  if(dialog.open&&!['shortcuts','settings'].includes(command)){toast(tr('열려 있는 창을 먼저 닫아 주세요.'));return;}
  if(!MENU_FREE.has(command)&&!state.storageKey){toast(tr('먼저 저장소를 연결하세요. (파일 › 저장소 열기)'));return;}
  if(MENU_NEEDS_PAPER.has(command)&&!selected()){toast(tr('먼저 자료를 고르세요.'));return;}
  const run=menuCommands[command];let done;
  if(run)done=run(arg);
  else if(!menuPress(`[data-action="${command}"]`)){if(typeof actions[command]==='function')actions[command]();else done=false;}
  if(done===false)toast(tr('지금 화면에서는 쓸 수 없는 메뉴입니다.'));
});

// ---- Files changed outside the app ----
// The main process watches the vault folder and says when its folders or PDFs differ from what is
// shown (vault-watch.cjs). The vault is then read again as "파일 목록 새로고침" (F5) does, but only when
// that interrupts nothing: on the library screen, with no dialog or menu open and no text being
// typed. Otherwise it waits and tries again; opening a paper keeps the reader as it is until the
// reader goes back to the library. The view (folder, search, filter, selection, scroll) is kept.
const vaultFiles={pending:false,busy:false,timer:null};
function quietForVaultFiles(){
  const active=document.activeElement,typing=active&&(active.isContentEditable||active.tagName==='TEXTAREA'||active.tagName==='INPUT'&&!['checkbox','radio','button','range'].includes(active.type));
  return state.screen==='library'&&!dialog.open&&!typing&&!document.querySelector('.pop-menu,.dragging');
}
async function followVaultFiles(){
  clearTimeout(vaultFiles.timer);
  if(!vaultFiles.pending||vaultFiles.busy)return;
  if(!state.storageKey||state.screen==='welcome'){vaultFiles.pending=false;return;}
  if(!quietForVaultFiles()){vaultFiles.timer=setTimeout(followVaultFiles,2000);return;}
  vaultFiles.busy=true;vaultFiles.pending=false;
  try{
    const id=state.storageKey;await desktopNotes();
    const snapshot=await window.appApi.refreshStorage(id);
    if(state.storageKey!==id)return;
    if(!quietForVaultFiles()){vaultFiles.pending=true;return;}
    // The app's own imports and moves are reported as well: nothing is redrawn when the vault reads the same.
    // (Each paper lists its attachments and whether their files are there, so folders and papers say it all.)
    const view=(folders,list)=>JSON.stringify([folders,list]);
    if(view(vaultFolders,papers)===view(snapshot.folders||[],snapshot.papers.map(({files,...paper})=>paper)))return;
    const top=document.querySelector('.library')?.scrollTop||0;
    applyItemSnapshot(snapshot);
    const list=document.querySelector('.library');if(list)list.scrollTop=top;
  }catch(error){console.error('vault files',error);}
  finally{vaultFiles.busy=false;if(vaultFiles.pending)vaultFiles.timer=setTimeout(followVaultFiles,2000);}
}
window.appApi.onVaultFilesChanged?.(id=>{if(id!==state.storageKey)return;vaultFiles.pending=true;followVaultFiles();});

// The new-version notice (main.cjs checkForUpdate): told once a run, after any dialog in use and after the first start's
// language question. 내려받기 opens the release's page in the browser; nothing is installed from here.
let updateTold=false;
function showUpdate(info){
  if(!info||updateTold)return;
  if(dialog.open||document.querySelector('.language-first')){setTimeout(()=>showUpdate(info),1500);return;}
  updateTold=true;
  modal(tr('새 버전이 있습니다'),`<p>${tr('{app} {version}이(가) 나왔습니다. 지금 쓰는 버전은 {current}입니다.',{app:esc(appName.name),version:esc(info.version),current:esc(info.current)})}</p><p class="small muted">${tr('내려받기를 누르면 브라우저에서 릴리스 페이지가 열립니다. 새 판으로 바꿔도 저장소의 자료와 설정은 그대로입니다.')}</p>`,btn(tr('나중에'),'close')+btn(tr('이 버전 건너뛰기'),'update-skip')+btn(tr('내려받기'),'update-open','primary'));
}
Object.assign(actions,{'update-open':runDesktop(async()=>{await window.appApi.openUpdate();dialog.close();}),'update-skip':runDesktop(async()=>{await window.appApi.skipUpdate();dialog.close();})});
window.appApi.onUpdateAvailable?.(showUpdate);
window.appApi.pendingUpdate?.().then(showUpdate,()=>{});
