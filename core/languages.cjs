// The languages the app knows, and what each can be chosen for: the screen (ui), the AI's answers (ai)
// and the translation result (translation). Each is named in its own language for the lists the
// user picks from. Stage 1 offers the screen in Korean and English, the translation in Korean only.
const entry=(code,name,englishName,ui,ai,translation)=>Object.freeze({code,name,englishName,ui,ai,translation});
const LANGUAGES=Object.freeze({
  ko:entry('ko','한국어','Korean',true,true,true), // i18n:keep — the language's own name
  en:entry('en','English','English',true,true,false),
  'zh-Hans':entry('zh-Hans','中文(简体)','Simplified Chinese',false,true,false),
  ja:entry('ja','日本語','Japanese',false,true,false),
  fr:entry('fr','Français','French',false,true,false),
  de:entry('de','Deutsch','German',false,true,false),
  es:entry('es','Español','Spanish',false,true,false),
  it:entry('it','Italiano','Italian',false,true,false)
});
function languagesFor(kind){return Object.values(LANGUAGES).filter(language=>language[kind]===true);}
// The code a system language tag ('ja-JP', 'en_US', 'zh-Hans-CN') stands for in this list, or null.
// Chinese is told apart by script: Simplified for zh-Hans, zh-CN and zh-SG; Traditional (zh-TW,
// zh-HK, zh-Hant) and a bare zh match nothing yet.
function codeOf(tag){
  if(typeof tag!=='string')return null;
  const parts=tag.trim().replace(/_/g,'-').toLowerCase().split('-');
  if(parts[0]==='zh')return parts[1]==='hans'||parts[1]==='cn'||parts[1]==='sg'?'zh-Hans':null;
  return Object.hasOwn(LANGUAGES,parts[0])?parts[0]:null;
}
// The first of the system's languages (most preferred first) that can be chosen for kind.
function matchLanguage(tags,kind){
  for(const tag of Array.isArray(tags)?tags:[]){const code=codeOf(tag);if(code&&LANGUAGES[code][kind]===true)return code;}
  return null;
}
module.exports={LANGUAGES,languagesFor,matchLanguage};
