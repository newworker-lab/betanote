// tr(): the Korean text is the key. Korean returns it as written; English looks it up in the table
// that core/i18n-en.js fills, and falls back to the Korean when an entry is missing.
(function(root){
  const SEPARATOR='\u0004',tables={en:Object.create(null)},warned=new Set();
  let language='ko';
  function setUiLanguage(code){language=code==='en'?'en':'ko';}
  function uiLanguage(){return language;}
  function uiLocale(){return language==='en'?'en-US':'ko-KR';}
  function addMessages(code,table){
    const into=tables[code]||(tables[code]=Object.create(null));
    Object.assign(into,table);
  }
  function messageKey(text,context){return context?text+SEPARATOR+context:text;}
  // {app} and {id} are the app's name and id from its name file (core/app-name.cjs), unless the caller gives them.
  const named=()=>{const n=typeof module!=='undefined'&&module.exports?require('./app-name.cjs'):root.appName;return n?{app:n.name,id:n.id}:{};};
  // One pass over the template, so a value that looks like a place is not filled a second time.
  function fill(template,values){
    const given=values||{},own=named();
    return template.replace(/\{(\w+)\}/g,(whole,name)=>Object.hasOwn(given,name)?String(given[name]):Object.hasOwn(own,name)?String(own[name]):whole);
  }
  function lookup(code,text,values,context){
    const source=String(text);
    if(code==='ko')return fill(source,values);
    const key=messageKey(source,context),entry=tables[code][key];
    if(entry===undefined){
      // No development flag exists inside core, so each missing key is reported once, in English only.
      if(!warned.has(key)){warned.add(key);try{console.warn('[i18n] missing English entry:',JSON.stringify(key));}catch{/* no console to warn on */}}
      return fill(source,values);
    }
    if(typeof entry==='object'&&entry!==null)return fill(values&&values.n===1?entry.one:entry.other,values);
    return fill(entry,values);
  }
  function tr(text,values,context){return lookup(language==='en'?'en':'ko',text,values,context);}
  // Text that belongs to a document in its own language, not the screen's (a saved translated PDF): Korean
  // is the text itself, a language with a table reads it, and any other language reads the English.
  function trIn(code,text,values,context){return lookup(code==='ko'?'ko':Object.hasOwn(tables,code)?code:'en',text,values,context);}
  const api={tr,trIn,setUiLanguage,uiLanguage,addMessages,messageKey,uiLocale};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  else{
    root.appI18n=api;root.tr=tr;root.trIn=trIn;
    setUiLanguage(root.appApi?.language?.ui);
    // The page says which language it is in (screen readers, fonts, hyphenation).
    if(typeof document!=='undefined'&&document.documentElement)document.documentElement.lang=language;
  }
})(globalThis);
