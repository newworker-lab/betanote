// Pure PDF text and mathematical notation helpers, shared by screen and export.
(function(root){
  const SCRIPT_TAG=/(<\/?(?:sub|sup)>)/;
  function scriptTokens(text){
    const out=[],stack=[];
    for(const piece of String(text??'').split(SCRIPT_TAG)){
      const tag=/^<(\/?)(sub|sup)>$/.exec(piece);
      if(!tag){if(piece)out.push({text:piece,tags:[...stack]});continue;}
      if(!tag[1]){if(stack.length<2)stack.push(tag[2]);}
      else if(stack.at(-1)===tag[2])stack.pop();
    }
    return out;
  }
  function plainScripts(text){return String(text??'').replace(/<\/?(?:sub|sup)>/g,'');}
  // The one HTML text/attribute escaper for the renderer and main-process exports.
  const escapeHtml=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  // Math drawn as graphics travels as ⟦g:page:x:y:width:height⟧; HTML gets a
  // span the page's own pixels fill (screen and print).
  const GRAPHIC_PART=/(⟦g:\d+:\d+:\d+:\d+:\d+⟧)/;
  function richHtml(text){
    return String(text??'').split(GRAPHIC_PART).map(part=>{const g=/^⟦g:([\d:]+)⟧$/.exec(part);return g?`<span class="graphic-math" data-graphic="${g[1]}">[수식]</span>`:scriptTokens(part).map(t=>t.tags.map(tag=>`<${tag}>`).join('')+escapeHtml(t.text)+[...t.tags].reverse().map(tag=>`</${tag}>`).join('')).join('');}).join(''); // i18n:keep — inside the translated text (the translation's language), until its picture is drawn
  }
  // Cut positions never fall inside a tag or a marked script.
  function scriptCut(text,index){
    for(const m of String(text??'').matchAll(/<(sub|sup)>[\s\S]*?<\/\1>|<\/?(?:sub|sup)>|⟦g:[\d:]+⟧/g))if(index>m.index&&index<m.index+m[0].length)return false;
    return true;
  }
  // Narrow patterns that read the same anywhere, including translations that
  // copied them: a bound chain "1 � r � R" is 1 ≤ r ≤ R; "x � GP(…)" is a
  // distribution (∼); ";" between short arguments of a function is a comma;
  // with `braces`, "fs2 m; 'mg" (a digit or the ℓ quote inside) is the brace
  // pair {s2 m, 'm}.
  const distribution=/(?:GP|N|MVN|Normal|Gamma|Beta|Uniform|U|Exp|Poisson|Bernoulli|Binomial|Cauchy|Dirichlet|Student|Inv-?Gamma|Half-?Normal|Half-?Cauchy|Log-?Normal)\s?\(/;
  function repairMath(text,braces=false){
    // Elsevier's math fonts also set "≤" as "6": "Δtmin 6 Δt 6 Δtmax", "(0 6 d 6 1)".
    let t=String(text).replace(/(^|[\s(])(\d+|[A-Za-z]) ?\uFFFD ?([A-Za-z]{1,3}) ?\uFFFD ?(?=[\p{L}\p{N}])/gu,'$1$2 ≤ $3 ≤ ')
      .replace(/(^|[\s(])([^\s()]{1,12}) 6 ((?:<\/?su[bp]>)*\p{L}[^\s()]{0,11}) 6 (?=[^\s)])/gu,'$1$2 ≤ $3 ≤ ')
      .replace(new RegExp('(\\S) ?\\uFFFD ?(?='+distribution.source+')','g'),'$1 ∼ ');
    // An argument is up to three words of up to eight visible characters, with
    // any script tags among them. Words split only at a space, so each text has
    // one parse: adjacent short tokens made '(a1; a2; … a8, x)' backtrack for
    // minutes on a paragraph that never closed the list.
    const word="(?:<\\/?su[bp]>)*(?:[\\p{L}\\p{N}'‘’′](?:<\\/?su[bp]>)*){1,8}",group=`${word}(?: ${word}){0,2}`;
    for(let i=0;i<3;i++){const next=t.replace(new RegExp(`([\\p{L}\\p{N}>])\\(( ?${group}(?: ?; ?${group})+)\\)`,'gu'),(_,f,args)=>f+'('+args.replace(/ ?; ?/g,', ')+')');if(next===t)break;t=next;}
    if(braces)t=t.replace(new RegExp(`(^|[\\s(=])f(${group} ?; ?${group} ?)g(?=$|[\\s.,;:)\\]]|[가-힣])`,'gu'),(m,pre,inner)=>/[\d'‘’′]/.test(inner)?pre+'{'+inner.trim().replace(/ ?; ?/g,', ')+'}':m); // i18n:keep — reads Korean in the text
    return t;
  }
  function repairGlyphs(text){
    let t=String(text);
    if(/ð[^ðÞ\n]{0,90}?Þ/.test(t)){
      // Nested pairs ("GPð0; kmðt; t0ÞÞ") resolve from the inside out; inside
      // the math font's brackets ";" is the comma.
      for(let i=0;i<6;i++){const next=t.replace(/ð([^ðÞ\n]{0,90}?)Þ/g,(_,inner)=>'('+inner.replace(/ ?; ?/g,', ')+')');if(next===t)break;t=next;}
      // The same fonts set a prime as a raised "0": a kernel's (t, t0) is (t, t′).
      t=t.replace(/<sup>00<\/sup>/g,'″').replace(/<sup>0<\/sup>/g,'′').replace(/\(([a-z]), \1 ?0\)/g,'($1, $1′)');
      t=t.replace(/(\S) ?þ ?(?=[\p{L}\p{N}([])/gu,'$1 + ').replace(/ ¼ /g,' = ').replace(/(^|[\s(=])À(?=[\p{N}\p{L}(])/gu,'$1−');
      t=repairMath(t,true);
      // The same fonts lose "∼" between operands ("m(t) � GP(0, …)").
      t=t.replace(/(\S) [\uFFFD\uE000-\uF8FF] (?=\S)/gu,'$1 ∼ ');
    }else t=repairMath(t);
    t=t.replace(/\uFFFD(?=\s?[\d.])/g,'∼');
    // "¼" between a short operand and a value is the shifted "=" even without
    // a bracket pair in the same line ("yl ¼ fs2l"); "¼ of" stays a quarter.
    t=t.replace(/(^|[\s(])((?:<\/?su[bp]>)*(?:[\p{L}\p{N}′')\]](?:<\/?su[bp]>)*){1,4}) ¼ (?!(?:of|the|a|an|and|or|to|in|cups?|miles?|inch(?:es)?|hours?)\b)(?=\S)/gu,'$1$2 = ');
    // A circumflex extracted before its base letter: "^f(t)" is f̂(t); after a
    // single capital it is the same hat ("R^ < 1.1" is R̂ < 1.1).
    return t.replace(/(^|[\s(])[\^ˆ] ?(\p{L})(?=[\s(,.)<]|$)/gu,'$1$2\u0302').replace(/(^|[\s(])(\p{Lu}) ?[\^ˆ](?=[\s<>=≤≥(),.;:]|$)/gu,'$1$2\u0302');
  }
  const graphemes=new Intl.Segmenter('ko',{granularity:'grapheme'});
  // Scan script spans once, instead of rescanning the entire paragraph at
  // every grapheme while fitting long model responses.
  function splitPoints(value){
    const text=String(value??''),points=[0];
    const spans=[...text.matchAll(/<(sub|sup)>[\s\S]*?<\/\1>|<\/?(?:sub|sup)>/g)];
    let span=0;
    for(const part of graphemes.segment(text)){
      const end=part.index+part.segment.length;
      while(span<spans.length&&end>=spans[span].index+spans[span][0].length)span++;
      if(span===spans.length||end<=spans[span].index)points.push(end);
    }
    return points;
  }
  const api={escapeHtml,splitPoints,scriptTokens,plainScripts,richHtml,scriptCut,repairMath,repairGlyphs};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.appPdfText=api;
})(globalThis);
