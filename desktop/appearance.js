/* Appearance: a user theme and CSS snippets on top of the built-in look (docs/DEVELOPMENT.md, 사용자 테마).
   Choices are kept on this computer. A theme's public tokens (--kn-*) are read after
   its CSS applies and passed to the app's own variables; a theme that does not support
   the current mode is left out until the mode changes back. */
const KN_TOKENS={'--kn-background':['--bg'],'--kn-surface':['--surface'],'--kn-surface-secondary':['--soft'],'--kn-text':['--ink'],'--kn-text-muted':['--muted'],'--kn-border':['--line'],'--kn-accent':['--accent','--primary'],'--kn-accent-hover':['--primary-hover'],'--kn-selection':['--pale'],'--kn-hover':['--hover'],'--kn-reader-background':['--reader-bg']};
let themeInfo=null;
function appearancePrefs(){try{const v=JSON.parse(localStorage.getItem('app-appearance')||'{}');return {theme:typeof v.theme==='string'?v.theme:'',snippets:Array.isArray(v.snippets)?v.snippets.filter(x=>typeof x==='string'):[],off:v.off===true};}catch{return {theme:'',snippets:[],off:false};}}
function saveAppearancePrefs(prefs){try{localStorage.setItem('app-appearance',JSON.stringify(prefs));}catch{}}
async function loadThemeInfo(){themeInfo=await window.appApi.themesList().catch(()=>null);return themeInfo;}
function clearCustomStyles(){document.querySelectorAll('style[data-kn-custom]').forEach(n=>n.remove());for(const names of Object.values(KN_TOKENS))for(const name of names)document.body.style.removeProperty(name);document.body.style.removeProperty('font-family');document.documentElement.removeAttribute('data-kn-theme');}
function addStyle(css,kind,name){const node=document.createElement('style');node.dataset.knCustom=kind;node.dataset.knName=name;node.textContent=css;document.head.append(node);}
// The tokens a theme or snippet set for the current mode, passed on to the app's variables.
function bridgeTokens(){
  const root=getComputedStyle(document.documentElement);
  for(const [token,names] of Object.entries(KN_TOKENS)){const value=root.getPropertyValue(token).trim();for(const name of names)if(value)document.body.style.setProperty(name,value);else document.body.style.removeProperty(name);}
  const font=root.getPropertyValue('--kn-font-ui').trim();if(font)document.body.style.fontFamily=font;else document.body.style.removeProperty('font-family');
}
let styleRun=0;
// Only the latest call applies (a slower earlier one must not undo a newer choice).
function applyCustomStyles(){
  const run=++styleRun;return (async()=>{
    const info=themeInfo||await loadThemeInfo(),prefs=appearancePrefs(),mode=document.documentElement.dataset.knMode||'light';
    const parts=[];
    if(info&&!info.disabled&&!prefs.off){
      const theme=info.themes.find(t=>t.id===prefs.theme&&!t.error);
      if(theme&&theme.modes.includes(mode))try{parts.push(['theme',theme.id,(await window.appApi.themeCss(theme.id)).css]);}catch(error){toast(tr("테마 '{name}'을(를) 읽지 못해 기본 모양을 씁니다: {error}",{name:theme.name,error:plainError(error)}));}
      for(const name of prefs.snippets)if(info.snippets.some(s=>s.name===name&&!s.error))try{parts.push(['snippet',name,await window.appApi.snippetCss(name)]);}catch(error){globalThis.quietError?.('snippet',error);}
    }
    if(run!==styleRun)return;
    // Swap in one step so the page never shows a half-applied look.
    clearCustomStyles();for(const [kind,name,css] of parts)addStyle(css,kind,name);
    if(parts.some(p=>p[0]==='theme'))document.documentElement.dataset.knTheme=prefs.theme;
    bridgeTokens();
  })();
}
document.addEventListener('app-appearance',()=>{applyCustomStyles();});
window.appApi.onThemesChanged?.(()=>{themeInfo=null;applyCustomStyles().then(()=>{if(dialog.open&&document.querySelector('[data-llm-section="look"]'))refreshAppearanceSection();});});
applyCustomStyles();

// ---- Settings → 모양 ----
function appearanceSummary(){const prefs=appearancePrefs(),theme=themeInfo?.themes.find(t=>t.id===prefs.theme);return [{light:tr('밝게'),dark:tr('어둡게'),system:tr('시스템')}[themeMode()],prefs.off||themeInfo?.disabled?tr('사용자 스타일 꺼짐'):theme?theme.name:tr('기본 테마'),prefs.snippets.length?tr('스니펫 {n}개',{n:prefs.snippets.length}):''].filter(Boolean).join(' · ');}
function appearanceSection(){
  const prefs=appearancePrefs(),info=themeInfo;
  if(!info)return `${themeModeField()}<p class="small muted">${tr('테마 폴더를 읽지 못했습니다.')}</p>`;
  const themes=`<div class="field"><label for="kn-theme-select">${tr('테마')}</label><select id="kn-theme-select" ${prefs.off||info.disabled?'disabled':''}><option value="">${tr('기본 (블루)')}</option>${info.themes.map(t=>`<option value="${esc(t.id)}" ${t.id===prefs.theme?'selected':''} ${t.error?'disabled':''}>${esc(t.name)}${t.version?` ${esc(t.version)}`:''}${t.modes.length===1?` · ${t.modes[0]==='dark'?tr('어둡게 전용'):tr('밝게 전용')}`:''}${t.error?` — ${tr('오류: {error}',{error:esc(t.error)})}`:''}</option>`).join('')}</select></div>`;
  const snippets=info.snippets.length?`<fieldset class="kn-snippets"><legend>${tr('CSS 스니펫')}</legend>${info.snippets.map(s=>`<label class="llm-check"><input type="checkbox" data-kn-snippet="${esc(s.name)}" ${prefs.snippets.includes(s.name)?'checked':''} ${s.error||prefs.off||info.disabled?'disabled':''}> ${esc(s.name)}${s.error?` <span class="small muted">— ${esc(s.error)}</span>`:''}</label>`).join('')}</fieldset>`:`<p class="small muted">${tr('스니펫이 없습니다. 폴더의 snippets에 .css 파일을 넣으세요.')}</p>`;
  return `<div class="kn-appearance">${themeModeField()}${themes}${snippets}<label class="llm-check"><input type="checkbox" id="kn-styles-off" ${prefs.off?'checked':''} ${info.disabled?'disabled':''}> ${tr('사용자 스타일 모두 끄기')}</label>${info.disabled?`<p class="small muted">${tr('--disable-custom-styles로 실행해 사용자 스타일이 꺼져 있습니다.')}</p>`:''}<p class="small muted">${tr('테마는 themes/&lt;id&gt;/manifest.json과 CSS, 스니펫은 snippets/*.css입니다. 파일을 저장하면 바로 반영됩니다. CSS만 읽고, @import와 외부 주소는 쓰지 않습니다.')}</p><div class="row">${btn(tr('테마 폴더 열기'),'themes-open')}${btn(tr('다시 읽기'),'themes-reload')}</div></div>`;
}
function refreshAppearanceSection(){const body=document.querySelector('[data-llm-section="look"] .llm-body'),summary=document.querySelector('[data-llm-section="look"] summary small');if(body)body.innerHTML=appearanceSection();if(summary)summary.textContent=appearanceSummary();}
document.addEventListener('change',event=>{
  const prefs=appearancePrefs();
  if(event.target.id==='kn-theme-select')prefs.theme=event.target.value;
  else if(event.target.id==='kn-styles-off')prefs.off=event.target.checked;
  else if(event.target.dataset?.knSnippet){const name=event.target.dataset.knSnippet;prefs.snippets=event.target.checked?[...new Set([...prefs.snippets,name])]:prefs.snippets.filter(n=>n!==name);}
  else{if(event.target.id==='theme')setTimeout(refreshAppearanceSection);return;}
  saveAppearancePrefs(prefs);applyCustomStyles().then(refreshAppearanceSection);
});
Object.assign(actions,{
  'themes-open':runDesktop(async()=>{await window.appApi.openThemesFolder();}),
  'themes-reload':runDesktop(async()=>{themeInfo=null;await applyCustomStyles();refreshAppearanceSection();toast(tr('테마와 스니펫을 다시 읽었습니다.'));}),
});

// ---- Settings → 언어 (DEVELOPMENT.md 언어 설정) ----
// The three language settings as they are now: the page was handed them when it loaded, and a change
// of the result or answer language comes back from the main process without loading the page again.
// A new screen language loads every window again (main saves what the pages hold first).
let languageNow=window.appApi.language;
window.appApi.onLanguageChanged?.(info=>{languageNow=info;});
{const now=window.appApi.readLanguage?.();if(now)languageNow=now;} // a change made before the line above listened
const LANGUAGE_LISTS={'welcome-language':'ui','language-ui':'ui','language-translation':'translation','language-ai':'ai'};
function languageName(kind,code){return languageNow?.choices?.[kind]?.find(c=>c.code===code)?.name||code||'';}
function languageSummary(){
  const info=languageNow;if(!info?.choices)return '';
  return [languageName('ui',info.ui),info.translationResolved?tr('번역 {language}',{language:languageName('translation',info.translationResolved)}):'',tr('AI 답변 {language}',{language:languageName('ai',info.aiResolved)})].filter(Boolean).join(' · ');
}
function languageSection(){
  const info=languageNow;if(!info?.choices)return `<p class="small muted">${esc(tr('언어 설정을 읽지 못했습니다.'))}</p>`;
  // "화면 언어와 같게" is the empty value (null in the settings); the language names are each in their own language.
  const same=value=>`<option value="" ${value==null?'selected':''}>${esc(tr('화면 언어와 같게'))}</option>`;
  // A screen language that cannot be a translation result (English) does not give the translation its language: the
  // empty value then says what choosing it does (DEVELOPMENT.md 언어 설정), the system's language or a question at the
  // next translation, whatever is chosen now (translationUnchosen).
  const translationDefault=value=>{const unchosen=info.translationUnchosen||{code:info.translationResolved,ask:info.translationAsk};
    return info.choices.translation.some(c=>c.code===info.ui)?same(value):`<option value="" ${value==null?'selected':''}>${esc(unchosen.ask||!unchosen.code?tr('번역할 때 묻기'):tr('자동({language})',{language:languageName('translation',unchosen.code)}))}</option>`;};
  return `<div class="field"><label for="language-ui">${esc(tr('화면 언어'))}</label><select id="language-ui">${languageOptions(info.choices.ui,info.ui)}</select></div>`
    +`<div class="field"><label for="language-translation">${esc(tr('번역 결과 언어'))}</label><select id="language-translation">${translationDefault(info.translation)}${languageOptions(info.choices.translation,info.translation)}</select></div>`
    +`<div class="field"><label for="language-ai">${esc(tr('AI 답변 언어'))}</label><select id="language-ai">${same(info.ai)}${languageOptions(info.choices.ai,info.ai)}</select></div>`
    +`<p class="small muted">${esc(tr('화면 언어를 바꾸면 메모를 저장한 뒤 창을 다시 불러옵니다. 번역 결과 언어와 AI 답변 언어는 다음 요청부터 적용됩니다.'))}</p>`;
}
async function chooseLanguage(list){
  const kind=LANGUAGE_LISTS[list.id],value=list.value||null,putBack=()=>{list.value=languageNow?.[kind]??'';};
  if(kind==='ui'){
    if(value===languageNow?.ui)return;
    // The memos the page holds are saved before the windows load again.
    try{await desktopNotes();}catch(error){putBack();toast(tr('메모를 저장하지 못해 화면 언어를 바꾸지 않았습니다: {error}',{error:shownError(error)}));return;}
  }
  try{
    languageNow=await window.appApi.setLanguage({[kind]:value});
    const summary=document.querySelector('[data-llm-section="language"] summary small');if(summary)summary.textContent=languageSummary();
  }catch(error){putBack();toast(errorCode(error)==='APP_BUSY'?tr('번역이나 AI 요청이 끝난 뒤 화면 언어를 바꾸세요.'):plainError(error));}
}
document.addEventListener('change',event=>{if(Object.hasOwn(LANGUAGE_LISTS,event.target.id))chooseLanguage(event.target);});
