// Shared by the PDF renderer and the print window. Sample the dominant local
// colour so text masks retain shaded boxes instead of painting white patches.
(function(root){
  // core/i18n.js: the page's copy in the page, the module under Node (the main process sets its language).
  const i18n=()=>typeof module!=='undefined'&&module.exports?require('./i18n.js'):root.appI18n;
  const tr=(...args)=>i18n().tr(...args),trIn=(...args)=>i18n().trIn(...args);
  // Extracted font sizes already use CSS pixels (PDF points * 96 / 72).
  // Translate at source size minus 1pt; never shrink further to fit a box.
  const typography={
    body:{pt:10.5,lineHeight:1.55,weight:400,gap:.6},
    title:{pt:16,lineHeight:1.3,weight:600,gap:.75},
    heading:{pt:12,lineHeight:1.4,weight:600,gap:.65},
    subheading:{pt:11,lineHeight:1.4,weight:600,gap:.6},
    footnote:{pt:8.5,lineHeight:1.4,weight:400,gap:.4},
    annotation:{pt:8.5,lineHeight:1.4,weight:400,gap:.4},
    table:{pt:9,lineHeight:1.4,weight:400,gap:.4},
    'table-caption':{pt:9,lineHeight:1.4,weight:400,gap:.5},
    'figure-caption':{pt:9,lineHeight:1.45,weight:400,gap:.5},
    metadata:{pt:8.5,lineHeight:1.4,weight:400,gap:.4}
  };
  function typographyRole(block,page){
    if(Object.hasOwn(typography,block.kind))return block.kind;
    if(block.kind==='caption')return /^(?:table\b|표(?:\s|\d|[.:]))/i.test(block.text)?'table-caption':'figure-caption'; // i18n:keep — reads a Korean caption
    if(block.kind==='formula')return 'body';
    return 'body';
  }
  // Half a point (2/3 px) under the source: Hangul fills the em box that
  // Latin lower case only half fills, so the same size reads larger.
  function translationFontSize(size){
    return Math.max(2/3,(Number.isFinite(size)&&size>0?size:14)-2/3);
  }
  // A translation longer than its box shrinks by at most 20%; any remainder
  // continues below the page while the fitting part stays in place.
  const MIN_FIT=.8;
  // Headings and single lines (running heads, labels) cannot split sensibly,
  // so they may shrink further before leaving their box.
  const MIN_FIT_LINE=.65;
  // A paragraph short of room by no more than two and a half lines stays
  // whole: its leading tightens to 1.2 and its type may shrink to 72%,
  // rather than sending a line or two to the continuation below the page.
  const TAIL_FIT={lines:2.5,scale:.72,leading:1.2};
  // Nothing leaves its page. A translation that still does not fit after the
  // steps above shrinks further, to half size at most; past that it keeps its
  // place and its box grows downwards. A paragraph whose source must stay
  // visible (dense math, a picture behind it, colliding boxes) shows its
  // translation beside it on demand, on screen, and at the end of an exported PDF.
  const HARD_FIT=.5;
  function fitScale(b){return Number.isFinite(b.fitScale)?Math.min(1,Math.max(MIN_FIT_LINE,b.fitScale)):1;}
  function pageTypography(page){
    const sizes=page.blocks.filter(b=>b.kind==='body').map(b=>b.fontSize).sort((a,b)=>a-b),base=sizes[Math.floor(sizes.length/2)]||14;
    // A body paragraph that spans its column is set justified whatever its
    // source line count, so the columns keep straight edges and an even
    // gutter (a 2-line paragraph translated into 3 lines would be ragged).
    const prose=page.blocks.filter(b=>b.kind==='body'&&String(b.text).length>80&&b.width>(page.width||0)*.2);
    const spans=b=>{const peers=prose.filter(n=>Math.abs(n.x-b.x)<Math.max(8,b.fontSize)&&n.width<=Math.max(b.width,(page.width||0)*.5)*1.15);return peers.length>0&&b.width>(page.width||0)*.2&&b.x+b.width>=Math.max(...peers.map(n=>n.x+n.width))-b.fontSize*1.5;};
    return page.blocks.map(b=>{
      let role=typographyRole(b,page);
      if(b.kind==='heading')role=b.fontSize>base*1.5&&b.text.length>30?'title':b.fontSize<base*1.15?'subheading':'heading';
      const rule=typography[role],fontSize=translationFontSize(b.fontSize)*fitScale(b);
      // Keep the source line rhythm so translated paragraphs fill the same box.
      const lineHeight=b.linePitch>0&&!sectionHeading({kind:role})?Math.min(1.9,Math.max(1.2,b.linePitch/translationFontSize(b.fontSize))):rule.lineHeight;
      return {...b,typographyRole:role,fontSize,lineHeight,fontWeight:rule.weight,...(role==='body'&&!b.label&&!b.bullet&&b.align!=='justify'&&spans(b)?{align:'justify'}:{})};
    });
  }
  // Korean lines break between words (eojeol), never inside one, on the
  // page, in its continuation and in the exported PDF alike; a word longer
  // than its line still wraps (overflow-wrap: anywhere).
  function typographyCss(){
    return '[data-typography]{word-break:keep-all}'+Object.entries(typography).map(([role,r])=>`[data-typography="${role}"]{--type-size:${r.pt*4/3}px;--type-leading:${r.lineHeight};--type-weight:${r.weight};--type-gap:${r.gap}em}`).join('');
  }
  function backgroundSample(pixels,box){
    const {data,width,height}=pixels,buckets=new Map();
    const left=Math.max(0,box.x),top=Math.max(0,box.y),right=Math.min(width,box.x+box.width),bottom=Math.min(height,box.y+box.height);
    for(let row=0;row<24;row++)for(let col=0;col<32;col++){
      const x=Math.min(width-1,Math.floor(left+(right-left)*(col+.5)/32)),y=Math.min(height-1,Math.floor(top+(bottom-top)*(row+.5)/24));
      const i=(y*width+x)*4;if(data[i+3]<240)continue;
      const r=data[i],g=data[i+1],b=data[i+2],key=(r>>3)<<10|(g>>3)<<5|b>>3;
      const bucket=buckets.get(key)||[0,0,0,0];bucket[0]++;bucket[1]+=r;bucket[2]+=g;bucket[3]+=b;buckets.set(key,bucket);
    }
    const best=[...buckets.values()].sort((a,b)=>b[0]-a[0])[0];
    const total=[...buckets.values()].reduce((n,b)=>n+b[0],0),luma=b=>(b[1]+b[2]+b[3])/(3*b[0]);
    // Dark glyphs are foreground, not competing background colours. Requiring
    // a majority light area still rejects images and mixed coloured regions.
    const light=[...buckets.values()].filter(b=>luma(b)>=150);
    // Neutral grey darker than the background is glyph anti-aliasing (dense or
    // bold text), also foreground; so are darker pixels that all share one hue
    // (a link set in blue). Several hues (a chart, a photo) count against safety.
    const hue=b=>{const [r,g,c]=b.slice(1).map(n=>n/b[0]),max=Math.max(r,g,c),min=Math.min(r,g,c);if(max-min<=20)return null;const h=max===r?(g-c)/(max-min):max===g?2+(c-r)/(max-min):4+(r-g)/(max-min);return (h*60+360)%360;};
    const darker=best?[...buckets.values()].filter(b=>b!==best&&luma(b)<luma(best)-8):[],hues=darker.map(hue).filter(h=>h!==null);
    // Glyph strokes are a minority of the box and dark at their core; a pale
    // panel of one colour is neither.
    const tinted=darker.filter(b=>hue(b)!==null),ink=hues.length>0&&hues.every(h=>Math.min(Math.abs(h-hues[0]),360-Math.abs(h-hues[0]))<=30)&&tinted.reduce((n,b)=>n+b[0],0)<=total*.35&&tinted.some(b=>luma(b)<190);
    const edge=b=>best&&b!==best&&luma(b)<luma(best)-8&&(hue(b)===null||ink);
    const lightAll=light.reduce((n,b)=>n+b[0],0),lightBackground=light.filter(b=>!edge(b)).reduce((n,b)=>n+b[0],0);
    // A soft gradient (a slide's pale panel, 229–241) spreads one background
    // over neighbouring colour buckets: those within eight levels of the
    // commonest count with it, and the mask takes their average.
    const close=b=>best&&[1,2,3].every(k=>Math.abs(b[k]/b[0]-best[k]/best[0])<=8),field=light.filter(close);
    // A dark panel of one colour (a repository banner) with light letters:
    // the mask takes the panel colour and the translation is set in white.
    // Other colours beside it (a photo, a chart, a second panel) are not
    // glyphs: only light ink and a few anti-aliased tones between may be.
    const count=list=>list.reduce((n,b)=>n+b[0],0),others=best?[...buckets.values()].filter(b=>b!==best):[];
    const glyphs=count(others.filter(b=>luma(b)>=170)),toneList=others.filter(b=>luma(b)<170&&luma(b)>luma(best)+8),tones=count(toneList);
    // Anti-aliased edges of light letters blend the panel colour with white:
    // they lie on that line of colours. Small bold type (a journal's "Article"
    // badge) is mostly edges, and how many depends on the renderer, so blended
    // tones may reach twice the letters; other tones keep the tighter cap.
    const blended=b=>{if(!best)return false;const p=best.slice(1).map(n=>n/best[0]),c=b.slice(1).map(n=>n/b[0]),d=p.map(v=>255-v),len=d.reduce((n,v)=>n+v*v,0)||1,t=Math.max(0,Math.min(1,c.reduce((n,v,i)=>n+(v-p[i])*d[i],0)/len));return Math.hypot(...c.map((v,i)=>v-(p[i]+t*d[i])))<=24;};
    const blend=count(toneList.filter(blended)),stray=tones-blend;
    const panel=Boolean(best&&luma(best)<110&&best[0]>=total*.4&&glyphs>0&&blend<=Math.max(glyphs*2,total*.02)&&stray<=Math.min(total*.15,Math.max(glyphs*2,total*.02))&&total-best[0]-glyphs-tones<=total*.08);
    const safe=Boolean(best&&lightAll/total>=.5&&luma(best)>=150&&count(field)/lightBackground>=.72)||panel;
    const mean=list=>[1,2,3].map(k=>Math.round(list.reduce((n,b)=>n+b[k],0)/Math.max(1,count(list))));
    return {color:best?'rgb('+(safe&&!panel?mean(field):best.slice(1).map(n=>Math.round(n/best[0]))).join(', ')+')':'rgb(255, 255, 255)',safe,...(panel?{ink:'rgb(255, 255, 255)'}:{})};
  }
  function backgroundColor(pixels,box){return backgroundSample(pixels,box).color;}
  // LaTeX spans are opaque document data. Their contents are never translated.
  // A placeholder for math drawn as graphics inside a sentence: the page
  // number (as extractPage numbers pages, from 1) and the box in page units,
  // ⟦g:page:x:y:width:height⟧.
  const GRAPHIC=/⟦g:(\d+):(\d+):(\d+):(\d+):(\d+)⟧/g;
  function graphicToken(page,x,y,width,height){return '⟦g:'+[page,x,y,width,height].map(v=>Math.max(0,Math.round(v))).join(':')+'⟧';}
  function graphicSpans(text){return [...String(text).matchAll(GRAPHIC)].map(m=>({index:m.index,text:m[0],page:Number(m[1]),x:Number(m[2]),y:Number(m[3]),width:Number(m[4]),height:Number(m[5])}));}
  function mathSpans(text){
    return [...String(text).matchAll(/\\begin\{(equation\*?|align\*?|alignat\*?|flalign\*?|gather\*?|multline\*?|eqnarray\*?|aligned|gathered|split|cases|[pbBvV]?matrix|displaymath|math)\}[\s\S]*?\\end\{\1\}|\$\$[\s\S]*?\$\$|(?<!\\)\$(?!\$)(?:\\.|[^$\\])+\$|\\\[[\s\S]*?\\\]|\\\([\s\S]*?\\\)/g)].map(m=>({index:m.index,text:m[0]}));
  }
  // Pieces of tall brackets, braces and integrals (⎧ ⎪ ⎩ ⎡ ⌠) and under/over
  // braces (︸ ⏟) are drawn only in formulas.
  function formulaLike(text){return mathSpans(text).length>0||/[�\u0000-\u0008]|[∑∏∫√≈≠≤≥∞∂∇∼\u2320\u2321\u239B-\u23B3\u23DC-\u23E1\uFE35-\uFE38]|[=^_]|[α-ωΑ-Ω]|(?:z?ffl){2,}|[ðþ]/u.test(text)||mathLetters(text);}
  // Unicode math italic/bold letters (𝑆, 𝜇, 𝐾: Word, Typst, unicode-math)
  // are set only inside formulas. A run of them that makes up most of the
  // letters is a formula; one in a heading or a prose line is a symbol name.
  function mathLetters(text){const math=(String(text).match(/[\u{1D400}-\u{1D7FF}]/gu)||[]).length;return math>=3&&math>=(String(text).match(/\p{L}/gu)||[]).length*.4;}
  // Inline symbols in prose (50 μl, Δura3, κ(t,t′)) read correctly as text in
  // the translation, so the paragraph is translated in place. Only dense math
  // or broken glyph extraction keeps the source on the page.
  // Publisher math fonts often extract with a shifted encoding (PLOS and
  // Elsevier: "(" ")" as "ð" "Þ", "+" as "þ", "=" as "¼", "−" as "À") and
  // an approximate sign before a number as U+FFFD. Repair the unambiguous
  // cases so prose with inline math is translated instead of kept aside.
  // Subscripts and superscripts travel as <sub>…</sub> / <sup>…</sup> in
  // the `rich` source text and in translations. Only these exact tags are
  // markup; any other "<" is text. Unbalanced tags are dropped or closed.
  const {escapeHtml,splitPoints,scriptTokens,plainScripts,richHtml,scriptCut,repairMath,repairGlyphs}=typeof module!=='undefined'&&module.exports?require('./pdf-text.js'):root.appPdfText;
  // Translations made from unrepaired text copied the same artifacts.
  function repairPages(pages){
    if(!Array.isArray(pages))return pages;
    return pages.map(p=>p&&{...p,blocks:p.blocks.map(b=>{
      let t=b.translation;if(typeof t!=='string'||!t.trim())return b;
      if(/[ðÞ\uFFFD^ˆ]/.test(t))t=repairGlyphs(t);
      t=repairMath(t,true);
      // List items once read into one paragraph ("▶ … ▶ …", "… goes on. ▶ …": a slide's bullets) were
      // translated as one, the bullets left inside the text: each item starts a line of its own.
      if(/\S\s+[▶►▸▹▷➤➢➔•◦▪‣⁃]\s/.test(String(b.text||'')))t=t.replace(/[ \t]+(?=[▶►▸▹▷➤➢➔•◦▪‣⁃]\s)/g,'\n');
      // A list entry ("12.", "[12]", Lancet's bare "12") keeps its source number even if a reply dropped it.
      const marker=/^\s*(\[\d{1,3}\]|\d{1,3}\.|\d{1,3}(?=\s+\p{Lu}))\s/u.exec(String(b.text||''));
      if(marker&&!t.trimStart().startsWith(marker[1]))t=marker[1]+' '+t.trimStart();
      return t===b.translation?b:{...b,translation:t};
    })});
  }
  // Words of a sentence, as against the names an equation or a line of code carries: a word in Latin letters alone
  // (two or more, lower case but for a first capital) that is no part of a name ("max_depth", "z3.Int",
  // "branchInfo"), no function called or indexed ("transfer(…)", "buf[…]"), no name of math and no keyword of code,
  // and no operand: none with a sign of math or an opening bracket right before it, or a sign or a closing bracket
  // right after ("precision = TP / …", "P(fault | data)"). `weak` marks the words code uses too ("with", "in",
  // "class"): they count beside another word only.
  const MATH_NAME=/^(?:min|max|arg|exp|log|ln|sin|cos|tan|tanh|diag|det|sup|inf|lim|tr|softmax)$/i;
  const CODE_WORD=/^(?:if|else|elif|for|while|return|def|import|int|char|void|var|let|const|function|print|assume|pass|yield|continue|break|then|end|do|none|true|false|null)$/i;
  const WEAK_WORD=/^(?:class|with|where|from|in|is|not|and|or|as|to|of|on|at|by)$/i;
  function sentenceWords(text){
    const out=[],value=String(text);
    for(const m of value.matchAll(/(?<![\p{L}\p{N}_.$@#\\])[A-Z]?[a-z]+(?![\p{L}\p{N}_([]|\.\p{L})/gu)){
      if(m[0].length<2||MATH_NAME.test(m[0])||CODE_WORD.test(m[0]))continue;
      const before=value.slice(0,m.index).trimEnd().slice(-1),after=value.slice(m.index+m[0].length).trimStart()[0]||'';
      // A short capitalised token inside a line is as likely a symbol with its index ("λ Lreg", "Var", "Cov").
      if(/^[A-Z]/.test(m[0])&&m[0].length<5&&before&&!/[.?!:•◦▪‣⁃▶►-]/.test(before))continue;
      if(/[=<>≤≥≠≈∝∈+\-−×·*/|^([{"'‘’“”`]/.test(before)||/[=<>≤≥≠≈∝∈+\-−×·*/|^)\]}"'‘’“”`]/.test(after))continue;
      out.push({word:m[0],at:m.index,end:m.index+m[0].length,weak:WEAK_WORD.test(m[0])});
    }
    return out;
  }
  // A line that reads as a sentence though a relation stands in it ("(2, 9) reaches r = 1.", "r = 2 never runs, and
  // f", "α = 714, at once.", a heading "No Input Reaches r = 2", a bullet "• Concolic: with x = 5, the"): two words
  // of a sentence side by side, a word of four letters in a line that ends as a sentence does, or a list bullet and
  // a word. Lecture slides set such lines among their bullets; read as formulas they stayed in the source language
  // between translated lines, and cut their paragraphs in two.
  function sentenceLine(text){
    const value=String(text),words=sentenceWords(value),strong=w=>!w.weak&&w.word.length>=3;
    if(words.some((w,i)=>i&&/^[ \t]*,?[ \t]*$/.test(value.slice(words[i-1].end,w.at))&&(strong(w)||strong(words[i-1]))))return true;
    if(/^\s*[•◦▪‣⁃▶►▸▹▷➤➢➔]\s*$/.test(value.slice(0,words.find(strong)?.at??0)))return true;
    return /[.?!]["'”’)\]]*\s*$/.test(value)&&words.some(w=>!w.weak&&w.word.length>=4);
  }
  // Light math in such a line (no sum, root or script, every glyph read): a few symbols among the words.
  function lightMath(text){
    const value=String(text),letters=(value.match(/\p{L}/gu)||[]).length||1;
    return !/[∑∏∫√∂∇^\uFFFD\u0000-\u0008\uE000-\uF8FFðþÞ]/u.test(value)&&!mathSpans(value).length&&sentenceLine(value)&&(value.match(/[≈≠≤≥∞=α-ωΑ-Ω]/gu)||[]).length/letters<=.25;
  }
  function mathDense(text){
    text=repairGlyphs(text);
    if(/(?:z?ffl){2,}/u.test(text))return true;
    const letters=(text.match(/\p{L}/gu)||[]).length||1,words=(text.match(/\p{L}{3,}/gu)||[]).length;
    const broken=(text.match(/[\uFFFD\u0000-\u0008\uE000-\uF8FFðþÞ]/gu)||[]).length;
    // μ before a unit (μm, μg ml⁻¹, μM, μmol) is the micro prefix of a measure, not a symbol: an axis label "Cell width (μm)" is text.
    const unitless=text.replace(/[μµ](?=(?:mol|m|g|l|L|M|s|A|V|W|Hz|F|N|J|Pa)(?!\p{L}))/gu,'');
    // An underscore inside a name ("max_depth", "facts_of") is no subscript.
    const symbols=(unitless.replace(/(?<=[\p{L}\p{N}])_(?=[\p{L}\p{N}])/gu,'').match(/[∑∏∫√≈≠≤≥∞∂∇=^_α-ωΑ-Ω\u0300-\u036f]/gu)||[]).length+mathSpans(text).reduce((n,s)=>n+s.text.length,0);
    // A real paragraph (8+ words) is translated with its inline math and the
    // odd unknown glyph ("error �k,r ∼ GP(0, …)"); the translation copies
    // those tokens. Only a near-formula or unreliable extraction keeps the source.
    // So is a shorter sentence ("μⱼ and σⱼ simply denote the j-th element of
    // vectors μ and σ."): five words, a function word and a full stop.
    const sentence=words>=5&&/[.!?]["')\]]*$/.test(text.trim())&&/\b(?:the|of|is|are|to|in|by|that|this|we|denotes?|denoted)\b/i.test(text);
    if(words>=8||sentence)return broken>=Math.max(8,letters*.05)||(symbols+broken)/letters>.25;
    return broken>=Math.max(3,letters*.01)||symbols/letters>.08;
  }
  // A complete distribution call can be extracted separately from its lhs.
  // Balanced calls only: surrounding natural-language prose remains translatable.
  function distributionOnly(value){
    let text=String(value).trim(),count=0;
    while(text){
      const call=/^(?:GP|N|MVN|Normal|Gamma|Beta|Uniform|Exp|Poisson|Bernoulli|Binomial|Cauchy|Dirichlet|Student|Inv-?Gamma|Half-?Normal|Half-?Cauchy|Log-?Normal)\s*\(/.exec(text);
      if(!call)return false;
      let depth=1,end=call[0].length;
      for(;end<text.length&&depth;end++){if(text[end]==='(')depth++;else if(text[end]===')')depth--;}
      if(depth)return false;
      count++;text=text.slice(end).trim();
      if(/^[.;,]$/.test(text))text='';else text=text.replace(/^[;,]\s*/,'');
    }
    return count>0;
  }
  function formulaOnly(block){
    // Judge the repaired text: "ð" "Þ" are letters to Unicode, so a
    // mis-encoded equation would otherwise read as a run of words.
    const text=repairGlyphs(String(block.text||'')).replace(/[ﬀ-ﬄ]/g,c=>c.normalize('NFKC'));
    if(distributionOnly(text))return true;
    const spans=mathSpans(text);let proseText=text;
    for(const span of [...spans].reverse())proseText=proseText.slice(0,span.index)+' '+proseText.slice(span.index+span.text.length);
    // Extensible PDF braces may extract as long 'zffl...}|ffl...{' runs (or
    // the ligature characters 'ﬄ', normalised above). They are drawing glyphs,
    // not prose words; retain the original pixels.
    // A narrow brace has no extenders: an underbrace is "|{z}", an overbrace "z}|{".
    const brace=/\|(?:ffl)*\{z(?:ffl)*\}|z(?:ffl)*\}\|(?:ffl)*\{/g,braces=/(?:ffl){2,}/.test(proseText)||brace.test(proseText);proseText=proseText.replace(brace,' ').replace(/z?(?:ffl){2,}[}|{]*/g,' ');
    const words=proseText.match(/\p{L}{2,}/gu)||[];
    // An old formula classification must not suppress natural-language prose.
    // Four or more real words (3+ letters) make a prose line; equations carry
    // at most a few names such as exp, log or Var.
    // Two-letter tokens alone ("yk", "ap", "bc" in an encoded equation) never
    // make prose; a function word or four longer words do.
    // Mixed-case names ("ufT", "TPfT": V_{uf}^T) are symbols with indices,
    // never words; nor does a formula drawn with brace pieces (⎧ ⎨ ⎩, ︸)
    // become prose without a function word.
    // A numbered display equation ("score = … − αDis(Xtest), (8)") is a
    // formula whatever names it carries.
    const drawn=/[\u2320\u2321\u239B-\u23B3\u23DC-\u23E1\uFE35-\uFE38]/u.test(proseText);
    const numbered=/[=≤≥]/.test(proseText)&&/(?:^|\s)\(\d{1,3}[a-z]?\)(?=\s|$)/.test(proseText);
    // In a numbered display equation the words joining its parts ("… where
    // μ = W₄h + b₄ … (12)") are no sign of prose; a sentence carries others.
    const proseLike=t=>{const w=t.match(/\p{L}{2,}/gu)||[],long=(t.match(/\p{L}{3,}/gu)||[]).filter(x=>/^(?:\p{Lu}?\p{Ll}+|\p{Lu}+)$/u.test(x)&&!/^(?:min|max|arg|exp|log|diag|det|sup|inf|lim|sin|cos|tan)$/.test(x)).length;return w.length>=4&&(/\b(?:the|we|our|this|these|that|which|within|using|is|are|was|were|be|been|has|have|of|to|from|by|in|on|at|an|it|its|than|each|not|after|into|when|both|via|per)\b/i.test(t)||!numbered&&/\b(?:where|with|and|or|for|as)\b/i.test(t)||/[가-힣]{2,}/u.test(t))||!drawn&&!numbered&&long>=4;}; // i18n:keep — reads Korean in the text
    // Indices set as sub- or superscripts ("ŷ<sub>sp</sub>", "t̂<sub>present</sub>")
    // are no words: an equation full of them is still an equation. A script
    // with a space in it is no index: extraction may set prose words lowered
    // with one ("x<sub>m;measured) available up to time</sub>"). A line
    // that opens with a word of prose ("where uᵀ = b₁ + …", "Substituting
    // x₂ᵀ = … in (19):") stays prose.
    const indexFree=block.rich&&!/^\s*(?:where|with|and|for|then|if|when|since|which|so|thus|hence|here|or|let|\p{Lu}?\p{Ll}{4,})\b/iu.test(proseText)&&repairGlyphs(String(block.rich).replace(/<(sub|sup)>[^<\s]{1,12}<\/\1>/g,' ').replace(/<\/?su[bp]>/g,' ')).replace(brace,' ').replace(/z?(?:ffl){2,}[}|{]*/g,' ');
    const prose=proseLike(proseText)&&(!indexFree||proseLike(indexFree));
    if(prose)return false;
    // A sentence with a plain relation in it (sentenceLine) is prose; drawn, numbered and LaTeX equations (also one
    // whose number stands at the margin on its row: equationNumber, from paragraphs()), and text whose glyphs did not
    // extract, keep the rules below.
    if(!drawn&&!numbered&&!block.equationNumber&&!braces&&!spans.length&&!/[\uFFFD\u0000-\u0008ðþÞ∑∏∫√]/u.test(text)&&sentenceLine(indexFree||proseText))return false;
    if(braces)return true;
    if(spans.length&&proseText.replace(/[\s\d()[\].,:;+-]/g,'')==='')return true;
    if(spans.length&&words.length)return false;
    if(!formulaLike(text))return block.kind==='formula'&&words.length<2;
    // Greek symbols, math names and operators with no Latin word
    // ("1 + log((σθ,j)²) − (μθ,j)²", a line of eq. 24) are an equation line.
    if(words.length>=2&&!words.some(w=>/[A-Za-z]{2,}/.test(w)&&!/^(?:min|max|arg|exp|log|ln|diag|det|sup|inf|lim|sin|cos|tan|tanh|tr)$/.test(w))&&/[+\-−×·/]/.test(proseText))return true;
    // Greek names in headings and scientific terms are not standalone equations.
    if(words.length>=2&&!/[�\u0000-\u0008=^∑∏∫√≈≠≤≥∞∂∇∼ðþ\u2320\u2321\u239B-\u23B3\u23DC-\u23E1\uFE35-\uFE38]|(?:z?ffl){2,}/u.test(proseText)&&!mathLetters(proseText))return false;
    return true;
  }
  function publisherMark(block,page){
    // Elsevier's header band: "Contents lists available at …", "journal
    // homepage: …", also letter-spaced as "jo u rn al h om ep age : w w w …".
    if(/^(?:journalhomepage:|contentslistsavailableat)/i.test(String(block.text).replace(/\s+/g,''))&&block.text.length<160&&(!page.height||block.y<page.height*.25))return true;
    return /^PLOS\b/i.test(block.text)&&block.text.length<160&&(!page.height||block.y<page.height*.08||block.y>page.height*.93);
  }
  const sectionHeading=block=>['title','heading','subheading'].includes(block.kind);
  // Keep non-language tokens, standalone equations and publisher marks intact.
  // Coordinates between the title and abstract also contain affiliations and
  // addresses, so that entire band must not be treated as author names.
  // Short text inside a figure body (axis titles, legends, panel labels) sits
  // between the last prose above a "Fig" caption and the caption itself. It
  // keeps the source so Korean never paints over the plotted data.
  // Top of the figure body above a caption: below the nearest prose, heading
  // or other caption overlapping it, never inside the running-head band.
  // Shared by figure-label detection and the section view's figure crop.
  function figureTop(page,cap,gap=0){
    const above=(page.blocks||[]).filter(b=>b!==cap&&b.y+b.height<=cap.y+1&&b.x<cap.x+cap.width&&b.x+b.width>cap.x&&(String(b.text).length>120||sectionHeading(b)||/^(?:fig(?:ure)?\.?|table|그림|표)\s*\d/i.test(String(b.text).trim()))); // i18n:keep — reads a Korean caption
    return Math.max((page.height||0)*.07,...above.map(b=>b.y+b.height+gap));
  }
  function figureLabelIds(page){
    const ids=new Set(),blocks=page.blocks||[];
    // A caption carries label punctuation ("Fig 2."); "Figure 2 shows …" is prose.
    for(const cap of blocks.filter(b=>/^(?:fig(?:ure)?\.?|그림)\s*[A-Z]?\d+[a-z]?\s*[.:|]/i.test(String(b.text).trim()))){ // i18n:keep — reads a Korean caption
      const top=figureTop(page,cap);
      if(cap.y-top<40)continue;
      // Labels are short lines, narrow relative to the figure width: a label
      // set on two lines ("Update / gate (ut)") or a legend list as well.
      for(const b of blocks){
        const text=String(b.text).trim(),lines=Math.max(1,Math.round(b.height/(b.fontSize*1.2)));
        if(b!==cap&&b.y>=top-1&&b.y+b.height<=cap.y+1&&b.x>=cap.x-8&&b.x+b.width<=cap.x+cap.width+8&&b.width<=cap.width*.4&&lines<=6&&text.length<=Math.min(160,lines*40)&&!/[.!?]$/.test(text))ids.add(b.id);
      }
    }
    return ids;
  }
  // Table contents and algorithm listings stay as printed and are not
  // translated; the caption is.
  // From a "Table N" caption ("TABLE II", "Table 3:"; not "Table 3 shows")
  // the cells are on the side (above or below) whose blocks are mostly
  // cell-like: narrow, numeric or in smaller type. They run to a heading,
  // another caption, prose as wide as the table or a gap of four lines.
  const tableCaption=/^(?:Table|TABLE|Tab\.|표|Algorithm|ALGORITHM)\s*(?:[IVXL]+|[A-Z]?\d+[a-z]?)(?:\s*[.:|]|\s+[A-Z(]|\s*$)/; // i18n:keep — reads a Korean caption
  // A nomenclature (symbols beside their meanings) is a table without a
  // caption: from its title down to the first heading or paragraph of
  // sentences in each column.
  const nomenclatureTitle=/^(?:nomenclature|notation|list of (?:symbols|abbreviations)|abbreviations|symbols)$/i;
  function nomenclatureIds(blocks,ids){
    const sentences=b=>/[.!?]["'”’)\]]?(?:\s+\p{Lu}|$)/u.test(String(b.text).trim())&&(String(b.text).match(/\p{L}{2,}/gu)||[]).length>=8;
    for(const title of blocks.filter(b=>nomenclatureTitle.test(String(b.text).trim())))for(const b of blocks){
      if(b===title||b.y<title.y-1||sentences(b)||sectionHeading(b))continue;
      const stop=blocks.filter(p=>p.y>title.y&&(sentences(p)||sectionHeading(p))&&p.x<b.x+b.width&&p.x+p.width>b.x).reduce((y,p)=>Math.min(y,p.y),Infinity);
      if(b.y<stop)ids.add(b.id);
    }
  }
  // A line of program code (a slide's code box read by OCR, a listing): a
  // definition, return, import or decorator, a loop or condition
  // ending in ":", an assignment or a dotted call; with hardly any English
  // function words. It stays as printed, like a table cell (a "# …" comment is
  // English and is translated).
  const CODE_START=/^\s*(?:\d{1,3}\s+)?(?:(?:def|class)\s+\w+\s*\(|return\b|import\s+\w|from\s+[\w.]+\s+import\b|@[A-Za-z_][\w.]*|for\s+\w+(?:,\s*\w+)*\s+in\s+.+:\s*$|(?:if|elif|while|with)\s+.+:\s*$|[A-Za-z_][\w.]*(?:\s*,\s*[A-Za-z_][\w.]*)*\s*[+\-*/]?=(?!=)\s*\S|[A-Za-z_]\w*(?:\.\w+)+\s?\()/;
  const codeLine=b=>{const t=String(b.text).trim();return CODE_START.test(t)&&!/[\uac00-\ud7a3]/.test(t)&&(t.match(/\b(?:the|and|of|is|are|was|were|we|to|in|for|with|that|this|a|an)\b/gi)||[]).length<3;};
  function tableCellIds(page){
    const ids=new Set(),blocks=page.blocks||[];nomenclatureIds(blocks,ids);for(const b of blocks)if(codeLine(b)&&!sectionHeading(b))ids.add(b.id);
    const captions=blocks.filter(b=>tableCaption.test(String(b.text).trim()));if(!captions.length)return ids;
    const sorted=[...blocks].sort((a,b)=>a.fontSize-b.fontSize),total=sorted.reduce((n,b)=>n+String(b.text).length,0);let seen=0,body=sorted[0]?.fontSize||12;
    for(const b of sorted){seen+=String(b.text).length;if(seen*2>=total){body=b.fontSize;break;}}
    const prose=b=>{const t=String(b.text);return b.fontSize>=body*.95&&b.height>=b.fontSize*2.2&&(t.match(/\p{L}{3,}/gu)||[]).length>=8&&/\b(?:the|of|and|is|are|was|were|we|in|to|with|for)\b/i.test(t)&&(t.match(/\d/g)||[]).length<t.length*.15;};
    // A header cell in small bold type is no section heading.
    const label=b=>b.kind==='caption'||['heading','title','subheading'].includes(b.kind)&&b.fontSize>=body*.95||/^(?:fig(?:ure)?\.?|table|그림|표)\s*[A-Z]?\d/i.test(String(b.text).trim()); // i18n:keep — reads a Korean caption
    const cellLike=(b,width)=>b.width<width*.5||(String(b.text).match(/\d/g)||[]).length>String(b.text).length*.25||b.fontSize<body*.92;
    for(const cap of captions){
      // A caption on one side of the page centre keeps its table on that side.
      const w=page.width||Infinity,[lo,hi]=cap.x+cap.width<=w*.5?[0,w*.5]:cap.x>=w*.5?[w*.5,w]:[0,w];
      const inColumn=b=>b.x>=lo-2&&b.x+b.width<=hi+2;
      // An algorithm's steps are prose-like lines, indented and nested, below
      // its caption. They run to a caption, a section heading, a gap of two
      // and a half lines or a paragraph as wide as the caption at its margin.
      if(/^(?:Algorithm|ALGORITHM)/.test(String(cap.text).trim())){
        let edge=cap.y+cap.height;
        for(const b of blocks.filter(b=>b!==cap&&inColumn(b)&&b.y>=cap.y+cap.height-2&&b.x<cap.x+cap.width&&b.x+b.width>cap.x).sort((a,b)=>a.y-b.y)){
          const heading=sectionHeading(b)&&(b.fontSize>=body*1.08||/^(?:\d+(?:\.\d+)*\.?|[IVX]+\.)\s+\p{Lu}/u.test(String(b.text).trim()));
          if(b.y-edge>body*2.5||b.kind==='caption'||/^(?:fig(?:ure)?\.?|table|algorithm|그림|표)\s*[A-Z]?\d/i.test(String(b.text).trim())||heading||prose(b)&&b.x<=cap.x+2&&b.width>=cap.width*.9)break; // i18n:keep — reads a Korean caption
          ids.add(b.id);edge=Math.max(edge,b.y+b.height);
        }
        continue;
      }
      let best=[],bestCells=0;
      for(const below of [true,false]){
        let left=cap.x,right=cap.x+cap.width,edge=below?cap.y+cap.height:cap.y,title=true;const found=[];
        const side=blocks.filter(b=>b!==cap&&inColumn(b)&&(below?b.y>=cap.y+cap.height-2:b.y+b.height<=cap.y+2)).sort((a,b)=>below?a.y-b.y:(b.y+b.height)-(a.y+a.height));
        for(const b of side){
          if(b.x>=right-1||b.x+b.width<=left+1)continue;
          // Rows of a table may sit apart (pictures in cells); before the first cell, at most four lines.
          const gap=below?b.y-edge:edge-(b.y+b.height);if(gap>body*(found.length?7:4))break;
          // A caption's title line in capitals (IEEE) belongs to the caption.
          if(title&&gap<b.fontSize*3&&/\p{Lu}{3}/u.test(b.text)&&(String(b.text).match(/\p{Ll}/gu)||[]).length<=(String(b.text).match(/\p{L}/gu)||[]).length*.1){edge=below?b.y+b.height:b.y;continue;}
          title=false;
          // Body prose a text column wide ends the table even when the table is
          // wider (a full-width table above a two-column page: Nature Chem. Biol.).
          if(label(b)||prose(b)&&(b.width>=Math.max(right-left,cap.width)*.7||b.width>=(page.width||Infinity)*.35))break;
          found.push(b);left=Math.min(left,b.x);right=Math.max(right,b.x+b.width);edge=below?Math.max(edge,b.y+b.height):Math.min(edge,b.y);
        }
        const width=Math.max(right-left,cap.width),cells=found.filter(b=>cellLike(b,width)).length;
        if(found.length>=2&&cells>=found.length*.5&&cells>bestCells){best=found;bestCells=cells;}
      }
      // Cells beside those found, on the same rows, are the table's other columns.
      for(let grew=true;grew&&best.length;){
        grew=false;const top=Math.min(...best.map(b=>b.y)),bottom=Math.max(...best.map(b=>b.y+b.height));
        for(const b of blocks)if(b!==cap&&!best.includes(b)&&inColumn(b)&&!label(b)&&!prose(b)&&b.y+b.height/2>=top&&b.y+b.height/2<=bottom&&best.some(f=>Math.abs(f.y-b.y)<body*.6)){best.push(b);grew=true;}
      }
      // Notes under a table ("Data are mean (SD) …", "[1] The best results
      // are highlighted …") are sentences on rows of their own below the last
      // cells (a page number further down aside); they are translated like
      // the caption.
      const sentence=b=>{const t=String(b.text);return (t.match(/\p{L}{2,}/gu)||[]).length>=5&&/\b(?:the|of|and|are|is|in|for|to|with|from|by|was|were|denotes?|shown?)\b/i.test(t)&&(t.match(/\d/g)||[]).length<t.length*.2;};
      for(let trimmed=true;trimmed;){
        trimmed=false;const worded=best.filter(b=>/\p{L}{2}/u.test(b.text));if(!worded.length)break;
        const last=worded.reduce((a,b)=>b.y+b.height>a.y+a.height?b:a);
        const alone=!best.some(o=>o!==last&&o.y<last.y+last.height-1&&o.y+o.height>last.y+1);
        if(sentence(last)&&alone&&!worded.some(o=>o!==last&&o.y+o.height>last.y+1)){best.splice(best.indexOf(last),1);trimmed=true;}
      }
      for(const b of best)ids.add(b.id);
    }
    return ids;
  }
  function layoutBlocks(page){
    const blocks=page.blocks,figureLabels=figureLabelIds(page),tableCells=tableCellIds(page);
    const equations=blocks.filter(formulaOnly);
    // Small labels above/inside a display equation (e.g. a brace label) are
    // part of its original artwork. Do not translate them into its bounding box.
    const equationLabels=new Set(blocks.filter(b=>equations.some(f=>f!==b&&
      /^[\p{L}\p{N}_]{1,16}$/u.test(String(b.text).trim())&&
      b.fontSize<=f.fontSize*.65&&b.width<=f.width*.25&&
      b.x>=f.x&&b.x+b.width<=f.x+f.width&&
      b.y>=f.y-f.fontSize&&b.y+b.height<=f.y+f.height
    )).map(b=>b.id));
    const out=blocks.map(b=>{
      // Lone accents, primes and panel letters (ˆ, ′, A) carry no prose, nor
      // do single letters among symbols (matrix entries "s(1,1) . s(T,1)").
      const fragment=!/\p{L}{2,}/u.test(b.text);
      // Subscript-size words inside a paragraph's box ("hdv dmodel is") belong to that paragraph.
      const inProse=String(b.text).trim().length<=20&&String(b.text).trim().split(/\s+/).length<=3&&blocks.some(h=>h!==b&&String(h.text).length>80&&!formulaOnly(h)&&b.fontSize<=h.fontSize*.85&&b.x>=h.x-2&&b.y>=h.y-2&&b.x+b.width<=h.x+h.width+2&&b.y+b.height<=h.y+h.height+2);
      // A few words inside a formula's box ("( Scores", matrix entries
      // "xiL · · ·") are part of the formula.
      const inFormula=(String(b.text).trim().split(/\s+/).length<=3||(String(b.text).match(/\p{L}{2,}/gu)||[]).length<=1)&&equations.some(f=>f!==b&&b.x>=f.x-2&&b.y>=f.y-2&&b.x+b.width<=f.x+f.width+2&&b.y+b.height<=f.y+f.height+2);
      // Pieces set apart from a display equation ("ΔtᵀΔt" over its "min",
      // "s.t." beside it) hold no word (three letters in one case) but math names.
      const wordless=text=>!/(?<!\p{L})(?:\p{Lu}\p{Ll}{2,}|\p{Ll}{3,}|\p{Lu}{3,})(?!\p{L})/u.test(String(text).replace(/\b(?:min|max|arg|exp|log|diag|det|sup|inf|lim)\b/g,' '));
      // So are the words joining it ("where", "and", "s.t.") set beside it.
      const symbolic=String(b.text).length<=24&&(wordless(b.text)||/^(?:\s*(?:where|and|or|with|for|if|as|otherwise|s\.\s?t\.|st|subject to)[,.;:]?)+\s*$/i.test(b.text));
      // A line of "where" and an equation ("where uᵀ = b₁ + b₂(Δt + t̂)ᵀ …")
      // reads as well in the source as translated; it is no paragraph to move.
      const whereLine=/^\s*where\s/i.test(b.text)&&b.height<=b.fontSize*2.5&&mathDense(b.text)&&wordless(String(b.rich??b.text).replace(/<(sub|sup)>[^<\s]{1,12}<\/\1>/g,' ').replace(/<\/?su[bp]>/g,' ').replace(/^\s*where\s/i,' '));
      const besideFormula=symbolic&&b.height<=b.fontSize*2.5&&equations.some(f=>{if(f===b)return false;const size=Math.max(f.fontSize,b.fontSize),rows=Math.min(b.y+b.height,f.y+f.height)-Math.max(b.y,f.y),cols=Math.min(b.x+b.width,f.x+f.width)-Math.max(b.x,f.x);
        return rows>=Math.min(b.height,f.height)*.5&&cols>-size*3||cols>0&&rows>-size;});
      // Type under 5 pt (labels inside a drawing) is unreadable once translated.
      const tiny=b.fontSize<20/3&&String(b.text).length<=80;
      // An equation piece set apart ("exp", "xi2 2 2", "FhT", "if Hk b, 2 > Hk, 2 or
      // SPEk b, > SPEk,") has no word (none of four lowercase letters, a
      // capitalised or all-caps word of four, two Hangul or CJK letters, once function names and sub- and superscripts go)
      // and some mark of math: a digit, a sign, mixed case, a function name.
      const plainWords=String(b.rich??b.text).replace(/<(sub|sup)>[^<]*<\/\1>/g,' ').replace(/\b(?:exp|log|ln|sin|cos|tanh?|max|min|arg|sup|inf|lim|det|diag|softmax)\b/g,' ');
      // A lone connective between equations ("and") is still translated.
      const mathy=/[\d=+\-−×⋅<>≤≥()[\]{}|∑∫^_]|\p{Ll}\p{Lu}|\p{Lu}{2,}\p{Ll}/u.test(b.text)||/^\s*(?:exp|log|ln|sin|cos|tanh?|max|min|arg|sup|inf|lim|det|diag|softmax)\s*$/.test(b.text);
      // Rows of a table of results read as a paragraph ("FID ↓ ACC ↑ F1 ↑ … 0.982±0.008 0.033±0.000 …"):
      // eight or more pieces, half of them numbers, and no more than one word. Nothing to translate.
      const pieces=String(b.text).trim().split(/\s+/).filter(t=>/[\p{L}\p{N}]/u.test(t)),figures=pieces.length>=8&&pieces.filter(t=>/\d/.test(t)).length>=pieces.length*.5&&(String(b.text).match(/\p{Ll}{4,}/gu)||[]).length<=1&&!sectionHeading(b);
      const noWord=String(b.text).length<=60&&mathy&&!/\p{Ll}{4,}|\p{Lu}\p{Ll}{3,}|\p{Lu}{4,}|\p{Lo}{2,}/u.test(plainWords)&&!sectionHeading(b);
      const sourceOnly=Boolean(b.sameAsSource||b.englishOnly||b.pending||b.keepSource)||formulaOnly(b)||!/\p{L}/u.test(b.text)||fragment||inFormula||besideFormula||whereLine||inProse||tiny||noWord||figures||equationLabels.has(b.id)||figureLabels.has(b.id)||tableCells.has(b.id)||publisherMark(b,page);
      // Extracted glyph bounds omit CSS leading. Reserve that small baseline
      // allowance when space exists, without entering the next text region.
      const next=blocks.filter(n=>n!==b&&n.y>=b.y+b.height-1&&n.x<b.x+b.width&&n.x+n.width>b.x).reduce((y,n)=>Math.min(y,n.y),page.height||Infinity);
      const height=sourceOnly?b.height:Math.max(b.height,Math.min(b.height+b.fontSize*.3,next-b.y));
      // A few words with a symbol or a plain relation ("Φ at point 6", "(10 < α + β, α < 3): their conjunction is Φ")
      // read as well translated in place: the symbols are copied as they are. With sub- or superscripts the source stays.
      const plain=!/<su[bp]>/.test(String(b.rich||''))&&lightMath(String(b.text).replace(GRAPHIC," "));
      return {...b,height,sourceOnly,preserveSource:Boolean(b.preserveSource||!sourceOnly&&(b.inlineGraphic&&!graphicSpans(b.text).length||!plain&&mathDense(String(b.text).replace(GRAPHIC," "))))};
    });
    // Raised superscripts or deep descenders can make neighbouring boxes
    // overlap by a few pixels. Trim the upper box at the lower box's top
    // instead of treating both paragraphs as a layout collision.
    for(const a of out)for(const b of out){
      if(a===b||a.sourceOnly||b.sourceOnly||a.y>=b.y)continue;
      const across=Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x),overlap=a.y+a.height-b.y;
      if(across>2&&overlap>0&&overlap<=Math.min(a.height,b.height)*.35&&b.y-a.y>=a.fontSize*.8)a.height=b.y-a.y;
    }
    // A display equation's box is the full em height of its tallest glyph
    // (big brackets, sums), so it reaches into the paragraph above or below.
    // Settle an edge overlap first by dropping the paragraph's leading
    // allowance, then by trimming the equation box's empty em margin; a
    // paragraph is kept as source only for a real overlap.
    const own=new Map(blocks.map(b=>[b.id,b]));
    for(const a of out)for(const s of out){
      if(a.sourceOnly||!s.sourceOnly||a===s)continue;
      const across=Math.min(a.x+a.width,s.x+s.width)-Math.max(a.x,s.x);if(across<=2)continue;
      if(s.y>a.y&&s.y<a.y+a.height&&s.y+s.height>a.y+a.height){
        a.height=Math.min(a.height,Math.max(own.get(a.id)?.height??a.height,s.y-a.y));
        const overlap=a.y+a.height-s.y;
        if(overlap>0&&overlap<=s.height*.35){s.y+=overlap;s.height-=overlap;}
      }else if(s.y<a.y&&s.y+s.height>a.y&&s.y+s.height<a.y+a.height){
        const overlap=s.y+s.height-a.y;
        if(overlap<=s.height*.35)s.height-=overlap;
        else if(overlap<=a.fontSize*.3){a.y+=overlap;a.height-=overlap;}
      }
    }
    return out;
  }
  // A two-column page's gutter runs from where most left-column prose ends
  // to where most right-column prose starts: the commonest edges of wide
  // prose blocks, so a running head or a caption wider than its column
  // ("LEE et al.: DYNAMIC-DEEPHIT …" across the page) does not move it.
  function pageColumns(blocks,page){
    const c=page.width/2,prose=blocks.filter(b=>String(b.text).length>80&&b.width>page.width*.25);
    const common=values=>{let best=null,count=0;for(const v of values){const n=values.filter(w=>Math.abs(w-v)<=1.5).length;if(n>count||n===count&&v<best){best=v;count=n;}}return count>=2?best:null;};
    // With fewer agreeing blocks (a column of short entries, a page of
    // figures), one block still marks its column; the right column then
    // starts at its leftmost prose.
    const lefts=prose.filter(b=>b.x+b.width<=c+20).map(b=>b.x+b.width),rights=prose.filter(b=>b.x>=c-20);
    const left=common(lefts)??(lefts.length===1?lefts[0]:null),right=common(rights.map(b=>b.x))??(rights.length?Math.min(...rights.map(b=>b.x)):null);
    return left!==null&&right!==null&&left<right?{left,right,end:common(rights.map(b=>b.x+b.width))}:null;
  }
  // Grow only into verified blank raster strips, bounded by the text column
  // and neighbouring blocks. Never infer empty space from missing text alone:
  // figure strokes, rules and shaded-panel edges must stop the mask.
  function expandLayoutBlocks(page,pixels){
    const blocks=layoutBlocks(page);
    if(!pixels||!page.width||!page.height)return blocks;
    const gutter=pageColumns(blocks,page);
    const sx=pixels.width/page.width,sy=pixels.height/page.height;
    // Within four levels of the mask colour: on a shaded slide panel a box
    // grows only as far as its flat mask still matches the background.
    const blank=(i,color)=>pixels.data[i+3]>=240&&Math.abs(pixels.data[i]-color[0])<=4&&Math.abs(pixels.data[i+1]-color[1])<=4&&Math.abs(pixels.data[i+2]-color[2])<=4;
    // Growing a box one unit at a time revisits pixel columns (then rows);
    // each is checked once per box and remembered.
    const strips=(color,across,vertical)=>{
      const known=new Map(),[from,to]=vertical?[Math.max(0,Math.floor(across[0]*sy)),Math.min(pixels.height,Math.ceil(across[1]*sy))]:[Math.max(0,Math.floor(across[0]*sx)),Math.min(pixels.width,Math.ceil(across[1]*sx))];
      const line=k=>{if(!known.has(k)){let ok=true;for(let j=from;j<to&&ok;j++)ok=blank(vertical?(j*pixels.width+k)*4:(k*pixels.width+j)*4,color);known.set(k,ok);}return known.get(k);};
      return (start,size)=>{const scale=vertical?sx:sy,limit=vertical?pixels.width:pixels.height;for(let k=Math.max(0,Math.floor(start*scale)),end=Math.min(limit,Math.ceil((start+size)*scale));k<end;k++)if(!line(k))return false;return true;};
    };
    // A box grows only for a translation that needs the room. Roughly, Hangul
    // and CJK take an em and other characters half of one: a translation that
    // fills at most four fifths of the source box's lines keeps that box, and
    // its mask stays on the source text (a flat mask grown over a shaded
    // slide panel shows; grown over a drawing it could hide it).
    const emsOf=b=>{const t=String(b.translation||'').replace(/<\/?su[bp]>/g,'');if(!t.trim()||b.pending||b.missingTranslation)return 0;let ems=0;for(const c of t)ems+=/[\u1100-\u11FF\u3130-\u318F\uAC00-\uD7AF\u2E80-\u9FFF]/u.test(c)?1:.55;return ems;};
    const pitchOf=b=>b.linePitch||b.fontSize*1.2,capacity=(b,width,height)=>width*Math.max(1,Math.round(height/pitchOf(b)))*.8;
    const roomy=b=>{const ems=emsOf(b);return ems>0&&ems*b.fontSize<=capacity(b,b.width,b.height);};
    // layoutBlocks adds a leading allowance under each box when no block is
    // there; a rule drawn as graphics (a code panel's border, a table line)
    // is not a block. Where that allowance reaches a rule, it stops above it.
    const source=new Map((page.blocks||[]).map(b=>[b.id,b]));
    const ruled=blocks.map(b=>{
      const own=source.get(b.id);if(b.sourceOnly||!own||!(b.height>own.height+.5))return b;
      const sample=backgroundSample(pixels,{x:b.x*sx,y:b.y*sy,width:b.width*sx,height:own.height*sy});if(!sample.safe)return b;
      const color=sample.color.match(/\d+/g).map(Number),x0=Math.max(0,Math.floor(b.x*sx)),x1=Math.min(pixels.width,Math.ceil((b.x+b.width)*sx));
      for(let py=Math.ceil((b.y+own.height)*sy),end=Math.min(pixels.height,Math.ceil((b.y+b.height)*sy));py<end;py++){
        let ink=0;for(let px=x0;px<x1;px++)if(!blank((py*pixels.width+px)*4,color))ink++;
        if(x1>x0&&ink/(x1-x0)>.6)return {...b,height:Math.max(own.height,py/sy-1-b.y)};
      }
      return b;
    });
    blocks.splice(0,blocks.length,...ruled);
    const grown=blocks.map(b=>{
      if(b.sourceOnly||b.preserveSource||b.mappingUncertain||b.kind==='table'||roomy(b))return b;
      const sample=backgroundSample(pixels,{x:b.x*sx,y:b.y*sy,width:b.width*sx,height:b.height*sy});
      if(!sample.safe)return b;
      const color=sample.color.match(/\d+/g).map(Number);
      // A line across both columns (authors, a full-width figure caption) is not a column peer.
      const peers=blocks.filter(n=>n!==b&&Math.abs(n.x-b.x)<Math.max(8,b.fontSize)&&n.text.length>80&&n.width>page.width*.15&&n.width<=Math.max(b.width,page.width*.5)*1.15&&!['heading','title','table'].includes(n.kind));
      // A heading may use the full text area (e.g. a title above two columns).
      const textRight=Math.max(...blocks.filter(n=>n.text.length>80&&!n.sourceOnly).map(n=>n.x+n.width),b.x+b.width);
      // A heading already wider than its column spans the text area; one
      // inside a column stays within that column and never enters the gutter.
      // Without a peer the box grows a little, never past the text area
      // (the right edge of the page's prose, when there is any).
      const prose=blocks.filter(n=>n.text.length>80&&!n.sourceOnly);
      const fallback=Math.min(b.x+b.width+Math.min(b.fontSize*6,page.width*.15),prose.length?textRight:Infinity),peerRight=peers.length?Math.max(...peers.map(n=>n.x+n.width)):null;
      const columnRight=sectionHeading(b)&&(peerRight===null||b.x+b.width>peerRight+2)?Math.max(textRight,fallback):peerRight??fallback;
      // A box in a column never grows into the gutter, nor past the right
      // column's edge, so the gap between columns stays as printed.
      const edge=!gutter?Infinity:b.x+b.width<=gutter.left+2?gutter.left:b.x>=gutter.right-2&&gutter.end!==null?gutter.end:Infinity;
      // A wide block further right is the next column; a display equation
      // indented on its own rows ("(13)" under "F  Full VB") is not.
      const right=Math.max(b.x+b.width,Math.min(page.width-12,columnRight,edge,...blocks.filter(n=>n!==b&&n.x>=b.x+b.width&&n.x>b.x+b.fontSize*4&&n.width>page.width*.15&&n.kind!=='formula').map(n=>n.x-2),...blocks.filter(n=>n!==b&&n.x>=b.x+b.width&&n.y<b.y+b.height&&n.y+n.height>b.y).map(n=>n.x-2)));
      let width=b.width,height=b.height;
      const columns=strips(color,[b.y,b.y+height],true);
      // Growth stopped by ink (a drawing, an equation set as graphics) backs
      // off two units, so the mask's margin never reaches that ink.
      while(b.x+width+1<=right&&columns(b.x+width,1))width++;
      if(width>b.width&&b.x+width+1<=right)width=Math.max(b.width,width-2);
      const bottom=Math.max(b.y+height,Math.min(page.height-12,...blocks.filter(n=>n!==b&&n.y>=b.y+b.height&&n.x<b.x+width&&n.x+n.width>b.x).map(n=>n.y-2)));
      const rows=strips(color,[b.x,b.x+width],false);
      while(b.y+height+1<=bottom&&rows(b.y+height,1))height++;
      if(height>b.height&&b.y+height+1<=bottom)height=Math.max(b.height,height-2);
      // Still short of room (a centred notice right above the title, a
      // caption on the text above): grow left, then up, into verified blank
      // strips. Left stops at the text area (or the gutter for a right
      // column) and at the blocks beside; up stops at the blocks above, the
      // page's top margin, and the lines the translation still needs.
      let x=b.x,y=b.y;const need=emsOf(b)*b.fontSize;
      if(need>capacity(b,width,height)){
        // Left only for a box set in from the prose around it (centred, indented):
        // as far as where that prose starts. A paragraph already at its
        // column's edge stays there, also where no gutter was found (a scan).
        // Prose near it, within six lines above or below (not a slide's footer).
        const reach=pitchOf(b)*6,around=prose.filter(n=>n!==b&&Math.min(n.x+n.width,b.x+b.width)-Math.max(n.x,b.x)>b.width*.5&&n.y<b.y+b.height+reach&&n.y+n.height>b.y-reach);
        const textLeft=around.length?Math.min(b.x,...around.map(n=>n.x)):b.x;
        const columnLeft=gutter&&b.x>=gutter.right-2?Math.max(gutter.right,textLeft):textLeft;
        // A list item keeps its bullet where it stands: its place says which level it is.
        const left=b.bullet?b.x:Math.min(b.x,Math.max(12,columnLeft,...blocks.filter(n=>n!==b&&n.x+n.width<=b.x&&n.y<b.y+height&&n.y+n.height>b.y).map(n=>n.x+n.width+2)));
        const columnsLeft=strips(color,[b.y,b.y+height],true);
        while(x-1>=left&&columnsLeft(x-1,1))x--;
        if(x<b.x&&x-1>=left)x=Math.min(b.x,x+2);
        width+=b.x-x;
        if(need>capacity(b,width,height)){
          const lines=Math.ceil(need/(width*.8)),wanted=lines*pitchOf(b)-height+2;
          const top=Math.min(b.y,Math.max(12,b.y-wanted,...blocks.filter(n=>n!==b&&n.y+n.height<=b.y&&n.x<x+width&&n.x+n.width>x).map(n=>n.y+n.height+2)));
          const rowsUp=strips(color,[x,x+width],false);
          while(y-1>=top&&rowsUp(y-1,1))y--;
          if(y<b.y&&y-1>=top)y=Math.min(b.y,y+2);
          height+=b.y-y;
        }
      }
      const sides={right:width-(b.x-x)>b.width,bottom:height-(b.y-y)>b.height,left:x<b.x,top:y<b.y};
      return {...b,x,y,width,height,...(Object.values(sides).some(Boolean)?{grown:sides}:{})};
    });
    // Each box grows on its own, so two can claim the same blank strip: a
    // caption's centred last line grows down past the heading below it while
    // the heading grows right under that line. Where grown boxes meet but
    // the source boxes did not, the upper one stops above the lower and the
    // left one before the right (boxes grow only right and down).
    const meet=(a,b)=>Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x)>2&&Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y)>2;
    for(let i=0;i<grown.length;i++)for(let j=0;j<grown.length;j++){
      const a=grown[i],b=grown[j],A=blocks[i],B=blocks[j];
      if(i===j||!meet(a,b)||meet(A,B))continue;
      if(A.y+A.height<=B.y+2)a.height=Math.min(a.height,Math.max(A.height,B.y-2-A.y));
      else if(A.x+A.width<=B.x+2&&B.y+B.height>A.y+2)a.width=Math.min(a.width,Math.max(A.width,B.x-2-A.x));
    }
    // Growth left or up comes second: where such a box still meets another
    // it did not meet in the source, it gives that growth back.
    for(let i=0;i<grown.length;i++){
      const a=grown[i],A=blocks[i];if(!a.grown?.left&&!a.grown?.top)continue;
      if(grown.some((b,j)=>j!==i&&meet(a,b)&&!meet(A,blocks[j]))){a.width-=A.x-a.x;a.height-=A.y-a.y;a.x=A.x;a.y=A.y;a.grown={...a.grown,left:false,top:false};if(!Object.values(a.grown).some(Boolean))delete a.grown;}
    }
    return grown;
  }
  // PDF text runs with superscripts share a baseline even when their font sizes
  // differ. Assemble those runs before grouping lines into paragraphs.
  function columnGutters(runs){
    const rows=[];
    for(const run of [...runs].sort((a,b)=>a.baseline-b.baseline||a.x-b.x)){
      const row=rows.at(-1);
      if(row&&Math.abs(row.baseline-run.baseline)<run.fontSize*.3)row.runs.push(run);else rows.push({baseline:run.baseline,runs:[run]});
    }
    const gaps=[];
    for(const row of rows){
      row.runs.sort((a,b)=>a.x-b.x);
      // A run straight across an open gap (an ordinary prose line) ends it:
      // a gutter is a gap in consecutive rows, never word spacing that happens
      // to line up above and below a full-width line.
      for(const g of gaps)if(!g.closed&&row.runs.some(r=>r.x<g.left-1&&r.x+r.width>g.right+1))g.closed=true;
      // Words set as runs of their own (Elsevier, a scanned page's text
      // layer) are measured as the stretch of line they make: runs under an
      // em apart are one segment.
      const segments=[];
      for(const run of row.runs){
        const last=segments.at(-1);
        if(last&&run.x-last.x-last.width<Math.max(last.fontSize,run.fontSize)){last.width=Math.max(last.x+last.width,run.x+run.width)-last.x;last.fontSize=Math.max(last.fontSize,run.fontSize);}
        else segments.push({x:run.x,width:run.width,fontSize:run.fontSize});
      }
      for(let i=1;i<segments.length;i++){
        const a=segments[i-1],b=segments[i],size=Math.max(a.fontSize,b.fontSize),left=a.x+a.width,right=b.x;
        if(right-left<size||a.width<size*4||b.width<size*4)continue;
        const group=gaps.find(g=>!g.closed&&Math.max(g.left,left)<Math.min(g.right,right)&&row.baseline-g.bottom<size*4);
        if(group){group.left=Math.max(group.left,left);group.right=Math.min(group.right,right);group.bottom=row.baseline;group.count++;}else gaps.push({left,right,top:row.baseline-size,bottom:row.baseline,count:1});
      }
    }
    // A gap is measured only beside long runs, so rows of a justified line
    // set word by word interrupt a gutter. Two gutters one above the other
    // that no run crosses in between are one.
    const found=gaps.filter(g=>g.count>=4).sort((a,b)=>a.top-b.top);
    for(let i=0;i<found.length;i++)for(let j=i+1;j<found.length;j++){
      const a=found[i],b=found[j];if(!a||!b)continue;
      const left=Math.max(a.left,b.left),right=Math.min(a.right,b.right);
      if(left>=right||b.top<=a.bottom-1)continue;
      if(runs.some(r=>r.baseline>a.bottom+.5&&r.baseline<b.top+r.fontSize*.9&&r.x<left-1&&r.x+r.width>right+1))continue;
      Object.assign(a,{left,right,bottom:Math.max(a.bottom,b.bottom),count:a.count+b.count});found[j]=null;
    }
    return found.filter(Boolean).map(({closed,...g})=>g);
  }
  // A subscript and the words after it can come out as one text item at the
  // subscript's size ("L" then "total that is specifically designed …" at
  // 7 pt). Its advance per character gives it away: a run of words as wide
  // per character as body text at the size of the larger glyph it follows
  // on that baseline takes that glyph's size and baseline.
  function resizedRuns(runs){
    const aspect=r=>r.width/(String(r.text).length*r.fontSize);
    const aspects=runs.filter(r=>String(r.text).trim().length>=20).map(aspect).sort((a,b)=>a-b);
    if(aspects.length<5)return runs;
    const typical=aspects[Math.floor(aspects.length/2)];
    return runs.map(run=>{
      const n=String(run.text).length;
      if(n<15||!/\p{L}{2,}\s+\p{L}{2,}/u.test(run.text)||aspect(run)<typical*1.25)return run;
      const lead=runs.find(r=>r!==run&&r.fontSize>=run.fontSize*1.2&&Math.abs(r.baseline-run.baseline)<=r.fontSize*.4&&run.x-r.x-r.width>=-2&&run.x-r.x-r.width<=r.fontSize*.3);
      if(!lead||Math.abs(run.width/(n*lead.fontSize)-typical)>typical*.15)return run;
      return {...run,fontSize:lead.fontSize,baseline:lead.baseline,y:lead.y,height:lead.height};
    });
  }
  // A scanned figure's frame read as text ("|~~~~~~~~") is no prose; spread
  // over the gutter it would glue the column beside it to the figure.
  const drawnRule=run=>{const text=String(run.text).replace(/\s/g,'');return text.length>=8&&/^[|~_=\-\u2013\u2014\u2500\u2501]+$/.test(text);};
  // Words read by OCR (desktop/ocr.cjs; boxes in image pixels at `scale` image
  // pixels per page unit) as text runs like the PDF's own, so the same line,
  // paragraph and layout rules apply. Lines read with low confidence (formulas,
  // drawings, noise) are left to the picture; words over text the PDF already
  // has (a slide's title) are dropped; a bullet read as a letter ("e", "°")
  // before a gap becomes "•".
  const OCR_LINE_CONFIDENCE=55;
  const OCR_BULLET=/^(?:e|eo|oe|o|°|®|©|«|»|\*|e\.|[-–—•])$/;
  // Within a line (after a gap) only a bullet read as a letter or a ring is one: a "*", "-" or "—"
  // there is code or math ("9.5 * logvar", "(x - x_prime)").
  const OCR_BULLET_WITHIN=/^(?:e|eo|oe|o|°|•)$/;
  // A table read by OCR (a slide's "step | code | what it does | recap slide",
  // a printed log) comes as one line per row with its cells far apart. Three
  // or more rows in a row, each of three or more cells more than one and a
  // half ems apart, with at least two cell starts lined up with the rows
  // above, are a table (later rows by where their words start, see below): its cells stay as drawn, untranslated, like a table
  // in a paper (read as lines they would be joined across columns into
  // nonsense). Prose that OCR read into the same lines is no cell and stays:
  // a bulleted sentence beside the table ("… | total | • Line 9: the same
  // loss …") and the line just under it that starts where its text starts
  // ("little higher than …"). A rule read as a cell ("_—", "|") is none, nor
  // is noise read from a picture (words of confidence under 50), and one
  // row of no cells (only such prose) does not end the table. One row must
  // hold two or more cells with words, and two rows of three a word.
  // Returns the words to leave out, by line.
  function ocrTableWords(lines,scale){
    const rows=[];
    for(const line of lines||[]){
      const words=(Array.isArray(line?.words)?line.words:[]).filter(w=>String(w.text||'').trim()).sort((a,b)=>a.x0-b.x0);if(!words.length||!(scale>0))continue;
      const heights=words.map(w=>w.y1-w.y0).sort((a,b)=>a-b),size=(line.rowHeight||heights[Math.floor(heights.length/2)]*1.3)/scale;if(!(size>0))continue;
      const bullet=i=>(i?OCR_BULLET_WITHIN:OCR_BULLET).test(String(words[i].text).trim())&&words[i+1]&&(words[i+1].x0-words[i].x1)/scale>size*.5;
      // A bullet's text belongs to it however wide the gap after the bullet.
      const groups=[];words.forEach((w,i)=>{const prev=words[i-1],last=groups.at(-1);if(prev&&(last.bullet&&last.words.length===1||(w.x0-prev.x1)/scale<=size*1.5)&&!bullet(i))last.words.push(w);else groups.push({words:[w],bullet:bullet(i)});});
      rows.push({line,size,groups,top:Math.min(...words.map(w=>w.y0))/scale,bottom:Math.max(...words.map(w=>w.y1))/scale});
    }
    rows.sort((a,b)=>a.top-b.top);
    const above=[];
    for(const r of rows){
      const prose=[];
      for(const g of r.groups){
        const text=g.bullet?g.words.slice(1):g.words,x=text[0]?text[0].x0/scale:0,width=text.length?(text.at(-1).x1-text[0].x0)/scale:0;
        // OCR lines may overlap in height: the sentence line above may come before a table row.
        g.prose=g.bullet||above.some(p=>p.bottom<=r.bottom&&r.top-p.bottom<=Math.max(p.size,r.size)*.9&&Math.abs(x-p.x)<=r.size&&p.width>=p.size*12);
        if(g.prose)prose.push({x,width,size:r.size,bottom:r.bottom});
      }
      const real=w=>/[\p{L}\p{N}]/u.test(w.text)&&!(w.confidence<50);
      above.push(...prose);r.cells=r.groups.filter(g=>!g.prose&&g.words.some(real));r.starts=r.cells.map(g=>g.words[0].x0/scale);r.wordStarts=r.cells.flatMap(g=>g.words.filter(real).map(w=>w.x0/scale));
    }
    // A table has words: a row of two or more cells with a word in them (a header), and a word in at
    // least two rows of three (rows of a digit picture or a chart's ticks read as text are no table,
    // and the caption under them stays).
    const words=r=>r.cells.filter(g=>g.words.some(w=>/\p{L}{2,}/u.test(w.text))).length;
    // A row continues a table when it lies close to it, starts at its first column and its words start
    // at two or more of its columns: in a monospaced slide a cell gap can be as narrow as a word space,
    // so OCR may read two cells as one ("training, epoch 20 −840.4 58.8"). The rows just above a table
    // found so are taken by the same rule (a first row read as fewer cells).
    // A row read as one cell joins only when it is no sentence (four words at most): the words of a
    // monospaced sentence start everywhere and would meet the columns by chance.
    const joins=(r,table,size)=>{if(!r.starts.length)return false;if(r.starts.length<2&&(r.cells[0].words.map(w=>w.text).join(' ').match(/\p{L}{2,}/gu)||[]).length>4)return false;const columns=[];for(const x of table.flatMap(t=>t.starts).sort((a,b)=>a-b))if(!columns.some(c=>Math.abs(c-x)<=size))columns.push(x);return r.starts.length>0&&Math.abs(r.starts[0]-columns[0])<=size&&columns.filter(c=>r.wordStarts.some(x=>Math.abs(x-c)<=size)).length>=2;};
    const out=new Map();let run=[];
    const flush=()=>{
      if(run.length>=3&&run.some(r=>words(r)>=2)&&run.filter(r=>words(r)>=1).length*3>=run.length*2){
        for(let i=rows.indexOf(run[0])-1,top=run[0].top;i>=0;i--){const r=rows[i],size=Math.max(r.size,run[0].size);if(top-r.bottom>size*1.5)break;top=r.top;if(!r.starts.length)continue;if(!joins(r,run,size))break;run.unshift(r);}
        // Everything of a table row but the prose beside it goes (its noise too: "— exp (4").
        for(const r of run)out.set(r.line,new Set(r.groups.filter(g=>!g.prose).flatMap(g=>g.words)));
      }
      run=[];
    };
    // A row of no cells between rows (a rule under the header, a sentence beside) is passed over, one at a time.
    let bottom=-Infinity,passed=0;
    for(const r of rows){
      const last=run.at(-1),size=last&&Math.max(r.size,last.size),near=last&&r.top-bottom<=size*1.5;bottom=r.bottom;
      if(near&&!r.starts.length&&!passed){passed=1;continue;}passed=0;
      if(near&&joins(r,run,size)){run.push(r);continue;}
      flush();if(r.starts.length>=3)run.push(r);
    }
    flush();return out;
  }
  // Math read by OCR comes out garbled ("py(z|z)", "¢" for φ, "N(0,7)" for
  // 𝒩(0,I)), and a model asked to mend it writes it out wrongly. It stays as
  // drawn: a line that starts with math and has at most two words besides is
  // left to the picture (a display equation, a formula line under a sentence),
  // and math in a sentence becomes a graphic placeholder (⟦g:…⟧: protected in
  // the request, cut from the page where it shows). Math is a word with a math
  // sign, an operator or a function's bracket, a symbol read for a Greek
  // letter, a lone letter other than a, A or I (a variable), a primed letter,
  // one or two characters read with confidence under 40 ("9" for θ), and a
  // word read with confidence under 60 beside such a word. Code ("self.fc = nn.Linear(…)")
  // keeps its text.
  const OCR_MATH_SIGN=/[=≈~∼|^∑Σ∫√±×⊙∈∉→←⇒⇔‖≤≥<>{}\[\]∂∇∞∝∀∃α-ωΑ-Ω′″]/u;
  const ocrMathWord=w=>{const t=String(w.text);return t!=='•'&&(OCR_MATH_SIGN.test(t)||/^[-+−–—*/·]+$/.test(t)||t.length<=2&&w.confidence<40||/(?<![\p{L}.])\p{L}{1,3}\(|\d\)|\(\d|\)\)/u.test(t)||/^[^\x00-\x7F\uac00-\ud7a3\u2010-\u2015\u2026•]$/u.test(t)||/^[b-zB-HJ-Z][,.:;]?$/.test(t)||/^[\p{L}\d][′'’][,.:;]?$/u.test(t));};
  function ocrMath(words){
    const math=words.map(ocrMathWord);
    for(let changed=true;changed;){changed=false;words.forEach((w,i)=>{if(!math[i]&&w.text!=='•'&&w.confidence<60&&(math[i-1]||math[i+1])){math[i]=true;changed=true;}});}
    return math;
  }
  function ocrRuns(lines,scale,existing=[],page=0){
    const runs=[],lineRuns=[],covered=w=>existing.some(r=>{const ix=Math.min(r.x+r.width,w.x+w.width)-Math.max(r.x,w.x),iy=Math.min(r.y+r.height,w.y+w.height)-Math.max(r.y,w.y);return ix>0&&iy>0&&ix*iy>=w.width*w.height*.3;});
    const table=ocrTableWords(lines,scale);
    // OCR measures each line's row height on its own, and for lines of one type size it
    // comes out anywhere from 17 to 25 px; a paragraph would break wherever it changes.
    // The ink of those lines (the median height of their words) is the same, so lines whose
    // ink is that of the page's most common text line take that line's usual size.
    const ink=l=>{const h=(l?.words||[]).map(w=>w.y1-w.y0).sort((a,b)=>a-b);return h.length?h[Math.floor(h.length/2)]:0;};
    const texty=(lines||[]).filter(l=>Array.isArray(l?.words)&&l.words.length>=4&&l.rowHeight>0&&l.confidence>=OCR_LINE_CONFIDENCE),inks=new Map();
    for(const l of texty){const k=Math.round(ink(l));inks.set(k,(inks.get(k)||0)+l.words.length);}
    const commonInk=[...inks].sort((a,b)=>b[1]-a[1])[0]?.[0]||0,usual=texty.filter(l=>Math.abs(ink(l)-commonInk)<=commonInk*.1).map(l=>l.rowHeight).sort((a,b)=>a-b),commonRow=usual.length>=6?usual[Math.floor(usual.length/2)]:0;
    for(const source of lines||[]){
      const cells=table.get(source),line=cells?{...source,words:source.words.filter(w=>!cells.has(w))}:source;
      if(!(scale>0)||!Array.isArray(line?.words)||!line.words.length||!(line.confidence>=OCR_LINE_CONFIDENCE))continue;
      const heights=line.words.map(w=>w.y1-w.y0).sort((a,b)=>a-b),own=line.rowHeight||heights[Math.floor(heights.length/2)]*1.3,even=commonRow&&line.words.length>=3&&Math.abs(ink(source)-commonInk)<=commonInk*.12&&Math.abs(own-commonRow)<=commonRow*.45,size=(even?commonRow:own)/scale;
      if(!(size>0))continue;
      const at=x=>{const b=line.baseline;if(b&&b[2]!==b[0])return (b[1]+(b[3]-b[1])*(x-b[0])/(b[2]-b[0]))/scale;return Math.max(...line.words.map(w=>w.y1))/scale;};
      // OCR has already put the words of a line together: they stay one run
      // (a monospaced slide's word spaces are wider than the PDF rule allows),
      // split only at a gap of more than one and a half ems (a second column).
      // A "|" before lower-case letters is an l ("|ast layer"), not math.
      const words=line.words.map((w,i)=>{let text=String(w.text||'').trim().replace(/^\|(?=\p{Ll}{2,})/u,'l');const next=line.words[i+1];if((i===0&&OCR_BULLET.test(text)||i>0&&(w.x0-line.words[i-1].x1)/scale>size*1.5&&OCR_BULLET_WITHIN.test(text))&&next&&(next.x0-w.x1)/scale>size*.5)text='•';return {...w,text,raw:String(w.text||'').trim()};}).filter(w=>w.text);
      // Math (see ocrMath): a line that is a formula is left to the picture; in a sentence it is a placeholder.
      const code=CODE_START.test(words.map(w=>w.text).join(' ').replace(/^•\s*/,''));
      const math=page&&!code?ocrMath(words):words.map(()=>false),first=words.findIndex(w=>w.text!=='•');
      if(math[first]&&words.filter((w,i)=>!math[i]&&/\p{L}{2,}/u.test(w.text)).length<=2)continue;
      words.forEach((w,i)=>{w.math=math[i];});
      const groups=[];for(const w of words){const last=groups.at(-1),prev=last?.at(-1);if(prev&&(w.x0-prev.x1)/scale<=size*1.5&&!(prev.text==='•'))last.push(w);else groups.push([w]);}
      // Math that ends a run reaches up to two ems further (short of the next run), and within a run up to
      // 0.6 em (short of the next word): OCR often leaves its last glyphs unread (a closing bracket, a
      // final ε), which are cut with it (to their ink) and covered.
      const textOf=(group,reach)=>{const out=[];let extra=0;for(let i=0;i<group.length;){if(!group[i].math){out.push(group[i++].text);continue;}let j=i;while(j<group.length&&group[j].math)j++;const span=group.slice(i,j),x0=Math.min(...span.map(w=>w.x0)),y0=Math.min(...span.map(w=>w.y0)),y1=Math.max(...span.map(w=>w.y1));let x1=Math.max(...span.map(w=>w.x1));if(j===group.length){extra=Math.max(0,Math.min(size*2*scale,reach-x1));x1+=extra;}else x1=Math.max(x1,Math.min(x1+size*.6*scale,group[j].x0-size*.15*scale));out.push(graphicToken(page,x0/scale,y0/scale,(x1-x0)/scale,(y1-y0)/scale));i=j;}return {text:out.join(' '),extra:extra/scale};};
      groups.forEach((group,index)=>{
        const next=groups[index+1],{text,extra}=textOf(group,next?next[0].x0-size*.5*scale:Infinity);
        const x0=Math.min(...group.map(w=>w.x0)),x1=Math.max(...group.map(w=>w.x1))+extra*scale,baseline=at((x0+x1)/2);
        // The box covers the words' ink as read, whatever the baseline estimate.
        const top=Math.min(baseline-size*.8,Math.min(...group.map(w=>w.y0))/scale),bottom=Math.max(top+size,Math.max(...group.map(w=>w.y1))/scale);
        const run={x:x0/scale,y:top,width:(x1-x0)/scale,height:bottom-top,fontSize:size,baseline,text,fontName:'ocr',ocr:true};
        // Only lines of words are taken: a label in a picture ("Bird", "which
        // color?", an axis title) stays drawn; a bullet keeps its line, and the
        // text after a bullet (one read as a letter or ring, not a dash: a
        // slide's rule) is a list item however few its words ("• Example epoch
        // 20: 50 · 4.888 − 1084.8 = −840.4"), as is a numbered one ("2. Encoder: …").
        if(covered(run))return;
        const words=(run.text.match(/\p{L}{2,}/gu)||[]).length,bulleted=index>0&&groups[index-1].length===1&&groups[index-1][0].text==='•',item=index>0&&groups[index-1].length===1&&groups[index-1][0].text==='•'&&OCR_BULLET_WITHIN.test(groups[index-1][0].raw)||/^\d{1,2}[.)]$/.test(group[0].text)&&group.length>1;
        // A bullet with nothing after it on its line (a slide's rule read as a dash) is no item.
        if(run.text==='•'&&index===groups.length-1)return;
        if(run.text==='•'||words)lineRuns.push({run,bulleted,prose:run.text==='•'||words>=3||item&&words>=1});
      });
    }
    // A line just under a long line of text, starting at or just inside its
    // left edge, is that paragraph's wrapped end ("… in two" / "steps:",
    // "… an image," / "a video, a sound"), not a label: kept, however short,
    // with the line's size and pitch (OCR measures a short line's height from
    // its own words, and a subscript or descender, "P_data", pulls its
    // baseline down). A label under a short label (a picture's "pose," /
    // "size,") is not.
    // Text after a bullet starts an item: it is no paragraph's end.
    for(const {run,prose,bulleted} of lineRuns.sort((a,b)=>a.run.y-b.run.y)){
      const above=run.text==='•'||bulleted?null:runs.filter(r=>r.text!=='•'&&r.y<run.y&&run.y-(r.y+r.height)<=Math.max(r.fontSize,run.fontSize)*.9&&Math.abs(r.fontSize-run.fontSize)<=Math.max(r.fontSize,run.fontSize)*.25&&run.x>=r.x-r.fontSize*.6&&run.x<=r.x+r.fontSize*3.5&&r.width>=r.fontSize*12).sort((a,b)=>b.y-a.y)[0];
      if(above)runs.push({...run,fontSize:above.fontSize,baseline:Math.min(run.baseline,above.baseline+above.fontSize*1.6)});else if(prose)runs.push(run);
    }
    return runs;
  }
  // A tall brace or bracket drawn from a math font's extension pieces comes
  // out as one-character runs at one x, each a fraction of an em below the
  // last ("l", "o", "o", … "m", … "n"; "Ä", "Å", …): a drawing, not text
  // (pieces with their own code points, "⎧ ⎪ ⎨", stay: they read as math). Four
  // or more such pieces closer than two thirds of their size apart (lines of text are an em
  // or more apart) are left out.
  function stackedGlyphs(runs){
    const out=new Set(),single=runs.filter(r=>/^\p{L}$/u.test(String(r.text).trim()));
    const columns=new Map();for(const r of single){const key=Math.round(r.x*2)+':'+Math.round(r.fontSize);if(!columns.has(key))columns.set(key,[]);columns.get(key).push(r);}
    for(const list of columns.values()){
      list.sort((a,b)=>a.baseline-b.baseline);
      for(let i=0;i<list.length;){
        let j=i;while(j+1<list.length&&list[j+1].baseline-list[j].baseline<list[j].fontSize*.65)j++;
        if(j-i+1>=4)for(let k=i;k<=j;k++)out.add(list[k]);
        i=j+1;
      }
    }
    return out;
  }
  // Line numbers down the margin of a draft for consultation ("5", "6", "7" beside every
  // line): five or more whole numbers, one per line, counting up by one, set in one column
  // outside the text. They are no text of the page: read with it, each numbered line would
  // become a paragraph of its own. They stay in the page picture.
  function marginLineNumbers(runs){
    const numbers=runs.filter(r=>/^\s*\d{1,4}\s*$/.test(r.text)),found=new Set();
    for(const edge of [r=>r.x+r.width,r=>r.x]){
      const groups=new Map();
      for(const r of numbers){const key=Math.round(edge(r)/4);for(const k of [key-1,key,key+1]){if(!groups.has(k))groups.set(k,[]);groups.get(k).push(r);}}
      for(const group of groups.values()){
        if(group.length<5)continue;
        const sorted=[...group].sort((a,b)=>a.y-b.y);let steps=0;for(let i=1;i<sorted.length;i++)if(Number(sorted[i].text)-Number(sorted[i-1].text)===1)steps++;
        if(steps<(sorted.length-1)*.8)continue;
        const left=Math.min(...sorted.map(r=>r.x)),right=Math.max(...sorted.map(r=>r.x+r.width)),top=sorted[0].y,bottom=sorted.at(-1).y+sorted.at(-1).height;
        // Outside the text: nothing else of those lines lies on its outer side.
        const others=runs.filter(r=>!group.includes(r)&&r.y+r.height>top&&r.y<bottom&&String(r.text).trim());
        if(others.length&&(others.every(r=>r.x>=right-1)||others.every(r=>r.x+r.width<=left+1)))for(const r of sorted)found.add(r);
      }
    }
    return found;
  }
  // A large bracket from a math font's extension set ("{(" before "X₁, Y₁, C₁", "[" before
  // a vector) hangs below its own baseline: the PDF sets it most of an em above the line it
  // stands in. Read at that height it starts a line of its own, and the sentence is cut in
  // two there. A run of brackets only, with text of the line close beside it whose baseline
  // lies 0.4 to 1.2 em lower, is read on that baseline.
  function hangingBrackets(runs){
    return runs.map(r=>{
      const bracket=o=>/^[\[\](){}⟨⟩|]{1,3}$/.test(String(o.text).trim()),near=(o,k)=>Math.abs(o.x-(r.x+r.width))<=o.fontSize*k||Math.abs(r.x-(o.x+o.width))<=o.fontSize*k;
      if(!bracket(r)||!(r.baseline>0))return r;
      // A bracket with text beside it on its own baseline stands in that line ("(Silverman").
      if(runs.some(o=>o!==r&&!bracket(o)&&Math.abs(o.baseline-r.baseline)<o.fontSize*.25&&near(o,.8)))return r;
      const beside=runs.filter(o=>o!==r&&!/^[\[\](){}⟨⟩|]{1,3}$/.test(String(o.text).trim())&&o.baseline-r.baseline>=o.fontSize*.4&&o.baseline-r.baseline<=o.fontSize*1.2&&(Math.abs(o.x-(r.x+r.width))<=o.fontSize*.8||Math.abs(r.x-(o.x+o.width))<=o.fontSize*.8)).sort((p,q)=>p.baseline-q.baseline)[0];
      // Only in a line of words: in a display equation the brackets of each row stay in their rows.
      if(!beside||!runs.some(o=>Math.abs(o.baseline-beside.baseline)<o.fontSize*.25&&/\p{Ll}{3,}/u.test(o.text)&&Math.abs(o.x-r.x)<=o.fontSize*20))return r;
      const down=beside.baseline-r.baseline;return {...r,y:r.y+down,baseline:beside.baseline};
    });
  }
  function textLines(input){
    const numbered=marginLineNumbers(input);if(numbered.size)input=input.filter(run=>!numbered.has(run));
    input=hangingBrackets(input);
    // A large square or bullet set as a section's mark ("■ APPENDIX" in a journal's style, at three
    // times the text size) is an ornament: read as text it is no word, and gathers with the
    // equations below it into one block over the heading and the sentence between.
    {const sizes=input.map(r=>r.fontSize).sort((a,b)=>a-b),usual=sizes[Math.floor(sizes.length/2)]||0;if(usual)input=input.filter(r=>!(/^[■□▪▫◆◇●○▶►▸]$/.test(String(r.text).trim())&&r.fontSize>=usual*1.8));}
    const stacked=stackedGlyphs(input);
    const runs=resizedRuns(input.filter(run=>!drawnRule(run)&&!stacked.has(run))),lines=[],gutters=columnGutters(runs);
    const separated=(a,b)=>gutters.some(g=>Math.max(a.baseline,b.baseline)>=g.top&&Math.min(a.baseline,b.baseline)<=g.bottom+Math.max(a.fontSize,b.fontSize)&&((a.x+a.width<=g.right&&b.x>=g.left&&a.x<b.x)||(b.x+b.width<=g.right&&a.x>=g.left&&b.x<a.x)));
    // Seed lines with substantial text runs; single glyphs (math symbols,
    // superscripts) join afterwards, so an odd-sized or shifted symbol can
    // never split a physical line into two fragments.
    const short=run=>String(run.text).trim().length<3;
    for(const run of [...runs].sort((a,b)=>short(a)-short(b)||b.fontSize-a.fontSize||a.baseline-b.baseline||a.x-b.x)){
      const line=lines.find(l=>{
        const size=Math.max(l.fontSize,run.fontSize),ratio=Math.min(l.fontSize,run.fontSize)/size;
        // Ordinary word spaces are narrow. A larger allowance is only for
        // superscripts, never two body runs on either side of a column gutter.
        const gap=size*(ratio<.7?1.4:.8);
        return !separated(l,run)&&Math.abs(l.baseline-run.baseline)<=size*.5&&run.x<=l.x+l.width+gap&&run.x+run.width>=l.x-gap&&ratio>=.45;
      });
      if(!line){lines.push({...run,parts:[run]});continue;}
      line.parts.push(run);
      const right=Math.max(line.x+line.width,run.x+run.width),bottom=Math.max(line.y+line.height,run.y+run.height);line.x=Math.min(line.x,run.x);line.y=Math.min(line.y,run.y);line.height=bottom-line.y;line.width=right-line.x;
    }
    // Superscripts inserted last can bridge an ordinary word space between two
    // author names. Rejoin those neighbours without widening the gutter rule.
    // A reference number set in its own column ("12." right-aligned before
    // the entry text) belongs to the entry on its baseline.
    // A bullet ("•") set apart from its item text is a list marker too.
    const marker=l=>/^\s*(?:\[\d{1,3}\]|\d{1,3}\.|[•◦▪▫●○■□‣⁃▶►▸▹▷➤➢➔])\s*$/.test(l.parts.map(p=>p.text).join(''));
    // A bare number in its own column ("1", Lancet) opens a reference entry
    // when the line beside it starts like one ("Taitt HE.", "Donovan JL,",
    // "Van Calster B,", "National Cancer Institute …,"); margin line numbers
    // beside prose never do.
    const bare=l=>/^\s*\d{1,3}\s*$/.test(l.parts.map(p=>p.text).join('')),entry=t=>/^\p{Lu}[\p{L}'’-]+(?:\s+\p{Lu}[\p{L}'’-]+){0,4}(?:\s+\p{Lu}{1,3}\b|,)/u.test(t);
    const absorb=(into,line)=>{into.parts.push(...line.parts);const right=Math.max(into.x+into.width,line.x+line.width),bottom=Math.max(into.y+into.height,line.y+line.height);into.x=Math.min(into.x,line.x);into.width=right-into.x;into.y=Math.min(into.y,line.y);into.height=bottom-into.y;};
    // Either neighbour may come first: a bold number's baseline can sit a
    // hundredth of a pixel below its entry text, so order by position, not arrival.
    const lead=l=>[...l.parts].sort((a,b)=>a.x-b.x).map(p=>p.text).join('');
    // A caption label set apart from its text ("Fig. 2.   An illustration …").
    const label=l=>l.parts.length<=3&&/^\s*(?:fig(?:ure)?\.?|table|scheme|algorithm)\s*[A-Z]?\d+[a-z]?\s*[.:|]?\s*$/i.test(lead(l));
    // A drop capital (three lines tall) is on no line's baseline: sizes this
    // far apart never make one line, as when lines are first built.
    const touches=(b,line)=>{
      const size=Math.max(b.fontSize,line.fontSize);
      if(Math.min(b.fontSize,line.fontSize)<size*.45||separated(b,line)||Math.abs(b.baseline-line.baseline)>=size*.3)return false;
      const [left,right]=line.x>=b.x?[b,line]:[line,b];
      // An entry may open with a year or a number before its words
      // ("2. | 2020 Antibacterial Agents in Clinical …", a WHO report).
      // A bullet glyph opens an item whatever it starts with ("• 3x3 filters …").
      const opens=marker(left)&&left.parts.length===1?/^\s*[•◦▪▫●○■□‣⁃▶►▸▹▷➤➢➔]\s*$/.test(lead(left))?/^\W*[\p{L}\p{N}]/u:/^\W*(?:\p{L}|\d{1,4}\s+\p{L}{2})/u:/^\W*\p{L}/u;
      // A field label and its value set in two columns ("Received:" | "March 27, 2023").
      const field=left.parts.length<=2&&/^\s*\p{Lu}[\p{L} ]{1,30}:\s*$/u.test(lead(left))&&/^\W*[\p{L}\p{N}]/u.test(lead(right));
      if(field&&right.x-left.x-left.width<=size*2)return true;
      return right.x-left.x-left.width<=size*(((marker(left)||bare(left)&&entry(lead(right)))&&left.parts.length===1||label(left))&&opens.test(lead(right))&&right.width>right.fontSize*4?3:.8);
    };
    const join=(into,line)=>{const numbered=[into,line].some(l=>bare(l)&&l.parts.length===1);absorb(into,line);if(numbered)into.numbered=true;};
    // A joined line can reach one placed before it on the other side
    // ("times is denoted as T = {0, 1" + ", . . . , T" + "max} where …"),
    // so each join is followed by any others it now touches.
    const joinTouching=list=>{
      const out=[];
      for(const line of list.sort((a,b)=>a.baseline-b.baseline||a.x-b.x)){
        const into=out.find(b=>touches(b,line));
        if(!into){out.push(line);continue;}
        join(into,line);
        for(let next;(next=out.find(b=>b!==into&&touches(into,b)));){join(into,next);out.splice(out.indexOf(next),1);}
      }
      return out;
    };
    let joined=joinTouching(lines);
    // A prose line split in two (a symbol-font run with odd metrics, as in
    // "(50 | μg/ml)") is one line when lines of the same size just above and
    // below run straight across the gap: there is no gutter at that point.
    const across=(l,a,b)=>l&&l!==a&&l!==b&&Math.abs(l.fontSize-a.fontSize)<a.fontSize*.12&&l.x<a.x+a.width-a.fontSize&&l.x+l.width>b.x+a.fontSize;
    for(let i=0;i<joined.length;i++)for(let j=0;j<joined.length;j++){
      const a=joined[i],b=joined[j];if(!a||!b||a===b)continue;
      const size=Math.max(a.fontSize,b.fontSize),gap=b.x-a.x-a.width;
      if(Math.abs(a.baseline-b.baseline)>=size*.3||gap<-1||gap>size*2||Math.abs(a.fontSize-b.fontSize)>=size*.12||a.width<size*3||b.width<size*3)continue;
      const near=joined.filter(l=>across(l,a,b)&&Math.abs(l.baseline-a.baseline)<=size*2.5);
      if(!near.some(l=>l.baseline<a.baseline-size*.5)||!near.some(l=>l.baseline>a.baseline+size*.5))continue;
      // Joined lines are blanked, not removed, so the loop indices stay valid;
      // every lookup above skips the blanks.
      absorb(a,b);joined[j]=null;
    }
    for(let i=joined.length-1;i>=0;i--)if(!joined[i])joined.splice(i,1);
    // A stretched justified line ("description  of  AE-NNs  model  are …")
    // has word gaps wider than an ordinary space but all alike. Three or more
    // pieces of words on one baseline whose gaps are under 1.6 em and agree
    // within a fifth of the type size are one line; a column gutter still
    // separates, and unequal gaps (table cells) stay apart.
    const words=l=>/\p{L}{2}/u.test(l.parts.map(p=>p.text).join(''));
    for(const seed of [...joined].sort((a,b)=>a.baseline-b.baseline||a.x-b.x)){
      if(seed.merged)continue;
      const row=joined.filter(l=>!l.merged&&Math.abs(l.baseline-seed.baseline)<Math.max(l.fontSize,seed.fontSize)*.3&&Math.abs(l.fontSize-seed.fontSize)<Math.max(l.fontSize,seed.fontSize)*.12).sort((a,b)=>a.x-b.x);
      for(let start=0;start<row.length;){
        let end=start;const gaps=[];
        while(end+1<row.length){const a=row[end],b=row[end+1],size=Math.max(a.fontSize,b.fontSize),gap=b.x-a.x-a.width;if(gap<=0||gap>size*1.6||separated(a,b))break;gaps.push(gap);end++;}
        const piece=row.slice(start,end+1),size=Math.max(...piece.map(l=>l.fontSize));
        if(piece.length>=3&&Math.max(...gaps)-Math.min(...gaps)<=size*.2&&piece.filter(words).length*3>=piece.length*2)for(const line of piece.slice(1)){absorb(piece[0],line);line.merged=true;}
        start=end+1;
      }
    }
    for(let i=joined.length-1;i>=0;i--)if(joined[i].merged)joined.splice(i,1);
    // Inline math drawn apart from its line (a radical and its bar set
    // higher, a large ∑ with its limits, a run of index-size symbols) is
    // put back into the prose line it sits in, in x order, so the paragraph
    // text and its translation keep the symbols.
    const lineText=l=>l.parts.map(p=>p.text).join('');
    const piece=l=>{const t=lineText(l).trim(),small=l.parts.filter(p=>p.fontSize<=l.fontSize*.85||p.fontSize<9).reduce((n,p)=>n+p.text.length,0);
      return t.length<=20&&t.split(/\s+/).length<=4&&!/^\(\d+[a-z]?\)$/.test(t)&&(/[√∑∏∫∂∇∈×⋅=±≤≥≈\u0000\u0304\u0305]/u.test(t)&&!/\p{L}{3,}/u.test(t)||t.length<=4&&/[()[\]∣|]/.test(t)&&!/\p{L}{2,}|\d{2,}/u.test(t)||small>=t.length*.5);};
    const prose=l=>(lineText(l).match(/\p{L}{2,}/gu)||[]).length>=3&&lineText(l).length>=20;
    // A fraction's numerator or denominator in smaller type ("exp(e j)") is
    // part of the line it is stacked in; words longer than a function name
    // ("exp", "max") are not.
    const minor=(f,h)=>{const t=lineText(f).trim();return f.fontSize<=h.fontSize*.85&&t.length<=20&&t.split(/\s+/).length<=4&&!/^\(\d+[a-z]?\)$/.test(t)&&/[\p{L}\p{N}]/u.test(t)&&!/\p{L}{4,}/u.test(t.replace(/\b(?:exp|log|ln|sin|cos|tanh?|max|min|arg|sup|inf|lim|det|diag|tr|softmax)\b/g,' '));};
    // A drop capital ("S" three lines tall beside "URVIVAL analysis …", the
    // lines below indented beside it) starts the line beside its top: the
    // letter joins that line's first word.
    for(const cap of joined){
      if(!/^\p{Lu}$/u.test(lineText(cap).trim()))continue;
      const host=joined.find(h=>h!==cap&&!h.merged&&prose(h)&&h.fontSize<=cap.fontSize*.6&&h.x>=cap.x+cap.width-h.fontSize*.5&&h.x<=cap.x+cap.width+h.fontSize*1.5&&Math.abs(h.y-cap.y)<=h.fontSize*.6);
      if(!host||!/^\p{L}/u.test(lead(host))||!joined.some(l=>l!==host&&l.y>host.y+host.height*.5&&l.y<cap.y+cap.height&&Math.abs(l.x-host.x)<=host.fontSize))continue;
      const first=host.parts.reduce((a,p)=>p.x<a.x?p:a);
      host.parts[host.parts.indexOf(first)]={...first,text:lineText(cap).trim()+first.text.trimStart(),x:cap.x,width:first.x+first.width-cap.x};
      host.width+=host.x-cap.x;host.x=cap.x;host.dropCap={right:cap.x+cap.width,bottom:cap.y+cap.height};cap.merged=true;
    }
    for(const f of [...joined]){
      if(f.merged||prose(f))continue;
      const overlap=h=>Math.min(f.y+f.height,h.y+h.height)-Math.max(f.y,h.y);
      const hosts=joined.filter(h=>h!==f&&!h.merged&&prose(h)&&(piece(f)||minor(f,h))&&!separated(h,f)&&f.x+f.width>=h.x-h.fontSize*1.6&&f.x<=h.x+h.width+h.fontSize*.8&&overlap(h)>=Math.min(f.height,h.height)*.3)
        .sort((a,b)=>overlap(b)-overlap(a));
      // The left side of a display fraction ("ri =" before "number of … in bin i"
      // over "number of …"), centred between the two rows it precedes, belongs
      // to neither: it stays a formula piece and both rows keep their boxes.
      const centre=f.y+f.height/2,top=hosts[0],side=h=>Math.sign(h.y+h.height/2-centre);
      const lhs=Boolean(top)&&top.x>=f.x+f.width-1&&joined.some(o=>o!==top&&o!==f&&!o.merged&&prose(o)&&side(o)===-side(top)&&o.x>=f.x+f.width-1&&o.x>=top.x-o.fontSize*3&&o.x+o.width<=top.x+top.width+o.fontSize*3&&overlap(o)>=Math.min(f.height,o.height)*.3);
      const host=lhs?null:top;
      if(host){absorb(host,f);f.merged=true;}
    }
    // Pieces put back can close the gap between two parts of one line split
    // around a formula ("where aj = ∑…" | "exp(eℓ) represents the …").
    joined=joinTouching(joined.filter(l=>!l.merged));
    // Style flags follow the share of characters, so a bold "Received:" label
    // does not turn a whole metadata line into a heading.
    const share=(parts,key)=>{const total=parts.reduce((n,p)=>n+p.text.length,0)||1;return parts.filter(p=>p[key]).reduce((n,p)=>n+p.text.length,0)/total;};
    // A tall glyph set off the baseline over this line's own words (a "(" of
    // the next line's formula reaching up) stays in the text but does not
    // stretch the line's box into the next line.
    const band=l=>{const main=l.parts.filter(p=>String(p.text).trim().length>2);if(!main.length)return null;const top=Math.min(...main.map(p=>p.y)),bottom=Math.max(...main.map(p=>p.y+p.height));return {top,bottom};};
    for(const l of joined){
      const own=band(l);if(!own||l.y>=own.top-.5&&l.y+l.height<=own.bottom+.5)continue;
      const stray=p=>String(p.text).trim().length<=2&&Math.abs(p.baseline-l.baseline)>l.fontSize*.3&&l.parts.some(q=>q!==p&&String(q.text).trim().length>3&&q.x<=p.x+1&&q.x+q.width>=p.x+p.width-1);
      const kept=l.parts.filter(p=>!stray(p));if(kept.length===l.parts.length)continue;
      const top=Math.min(...kept.map(p=>p.y)),bottom=Math.max(...kept.map(p=>p.y+p.height));
      const intrudes=joined.some(o=>{if(o===l)return false;const b=band(o);return b&&Math.min(l.x+l.width,o.x+o.width)-Math.max(l.x,o.x)>2&&Math.min(l.y+l.height,b.bottom)-Math.max(l.y,b.top)>2&&Math.min(bottom,b.bottom)-Math.max(top,b.top)<=2;});
      if(intrudes){l.y=top;l.height=bottom-top;}
    }
    // The first glyphs of a display equation (a large "∑" and its limits, set a little below
    // the sentence that leads into it) are taken into that sentence's line when it ends just
    // before them. Pieces at the end of a line of words, set lower than it by 0.45em or more,
    // over an equation line that follows within three lines, are a line of their own: the
    // equation takes them (paragraphs).
    {
      const textOf=l=>[...l.parts].sort((p,q)=>p.x-q.x).map(p=>p.text).join(' '),equation=l=>formulaOnly({...l,text:repairGlyphs(textOf(l))});
      for(const line of [...joined]){
        if((textOf(line).match(/\p{Ll}{3,}/gu)||[]).length<3)continue;
        const level=line.parts.filter(p=>Math.abs(p.baseline-line.baseline)<line.fontSize*.25);if(!level.length)continue;
        const end=Math.max(...level.map(p=>p.x+p.width)),low=line.parts.filter(p=>p.x>=end-1&&p.baseline-line.baseline>=line.fontSize*.45);if(!low.length)continue;
        const below=joined.find(f=>f!==line&&f.baseline-line.baseline>=line.fontSize*1.2&&f.baseline-line.baseline<=line.fontSize*3&&equation(f)&&low.every(p=>p.x>=f.x-f.fontSize*2.5&&p.x<=f.x+f.width+f.fontSize*1.5));
        if(!below)continue;
        const rest=line.parts.filter(p=>!low.includes(p)),box=list=>{const x=Math.min(...list.map(p=>p.x)),y=Math.min(...list.map(p=>p.y));return {x,y,width:Math.max(...list.map(p=>p.x+p.width))-x,height:Math.max(...list.map(p=>p.y+p.height))-y};};
        Object.assign(line,box(rest),{parts:rest});
        const first=[...low].sort((p,q)=>p.x-q.x)[0];joined.push({...first,...box(low),parts:low});
      }
    }
    return joined.map(({parts,...line})=>{
      // A radical's bar comes out as combining overlines; √ alone reads the same.
      if(parts.some(p=>p.text.includes('√')))parts=parts.filter(p=>!/^[\u0304\u0305\s]+$/u.test(p.text));
      parts.sort((a,b)=>a.x-b.x);
      // Run boxes carry 1px of slack (extractPage), so a word space in tight
      // justified type (0.15 em) can measure under 1px: between words of one
      // size the space test scales with the type ("Where the diagonal", not
      // "Wherethediagonal"). A script beside its word, or an italic symbol
      // before a bracket ("P(T", "(i)"), keeps the 1px rule.
      // An OCR text layer's word boxes run 0.2 em and more into the next
      // word (scanned pages); kerned pairs ("V|AE-GAN") stay under 0.1 em.
      const gap=(p,i,a)=>{
        if(!i)return '';const q=a[i-1],same=Math.abs(p.fontSize-q.fontSize)<p.fontSize*.05;
        if(same&&q.x+q.width-1-p.x>p.fontSize*.15&&/\p{L}{2}$/u.test(q.text)&&/^\p{L}{2}/u.test(p.text))return ' ';
        const between=same&&/[\p{L}.,;:]$/u.test(q.text)&&/^\p{L}/u.test(p.text)&&(/\p{L}{2}$/u.test(q.text)||/^\p{L}{2}/u.test(p.text));
        return p.x>q.x+q.width+(between?Math.min(1,p.fontSize*.1-1):1)?' ':'';
      };
      const text=parts.map((p,i,a)=>gap(p,i,a)+p.text).join('');
      // A smaller run set below or above the line's baseline is a subscript or
      // superscript ("OD600", "σ2m", citation numbers). The `rich` text marks
      // it for the translation; accents and primes stay as they are.
      const script=p=>{const shift=line.baseline-p.baseline;return p.fontSize<=line.fontSize*.85&&Math.abs(shift)>=line.fontSize*.12&&!/^[\p{M}\p{Sk}\^ˆ˜~´`¨¯˙′″‴'.,]+$/u.test(p.text.trim())?(shift>0?'sup':'sub'):null;};
      let rich='',open=null;
      parts.forEach((p,i,a)=>{const kind=script(p),sep=gap(p,i,a);if(kind!==open){if(open)rich+=`</${open}>`;rich+=sep;if(kind)rich+=`<${kind}>`;open=kind;}else rich+=sep;rich+=kind?p.text.trim():p.text;});
      if(open)rich+=`</${open}>`;
      let boldPrefix=0;for(const p of parts){if(!(p.bold||p.heavy))break;boldPrefix+=p.text.length+1;}
      // The baseline where the line ends: an OCR line wanders, and a piece set
      // after its end ("Qa = " | "gXh2") follows the end, not the start.
      const last=parts.reduce((a,b)=>b.x+b.width>a.x+a.width?b:a);
      // A list item's bullet and where its text starts after it (the item's hanging indent).
      const bulletGap=parts.length>1&&/^\s*[•◦▪▫●○■□‣⁃▶►▸▹▷➤➢➔]\s*$/.test(parts[0].text)?parts[1].x-parts[0].x:0;
      return {...line,...(bulletGap>0?{bulletGap}:{}),endBaseline:last.baseline,bold:share(parts,'bold')>.6,heavy:share(parts,'heavy')>.8,serif:share(parts,'serif')>.5,startsBold:Boolean(parts[0].bold||parts[0].heavy),boldPrefix:Math.min(boldPrefix,text.length),text,...(rich!==text?{rich}:{})};
    });
  }
  // An indented line after a short or sentence-ending line opens a paragraph
  // (first-line indent style). A one-line block followed by an indented line
  // is a hanging indent (references), not a new paragraph; back at the
  // first line's margin after such indented lines and a finished entry, a
  // line opens the next entry (author-year references, bullet items).
  // An author–year reference: "Surname, X., …, 2021." or "Eigenvector, 2022.".
  const authorYear=t=>/^\p{Lu}[\p{L}'’ -]{1,40},\s*(?:\p{Lu}\.|(?:1[89]|20)\d{2})/u.test(String(t))&&/\b(?:1[89]|20)\d{2}[a-z]?\b/.test(String(t));
  // In a listing of code each comment and each docstring is a line of its own: a line that opens with a comment
  // mark ("# conjuncts of the path condition", "// here") starts a block and takes no line after it, and a
  // docstring closed on its line ("""One fresh symbol per parameter.""") ends there. Read on into one paragraph,
  // the comments of three lines and the code under a docstring were translated as one text and lost their lines.
  // "# Test", "# params." head a table's column (a count) and "//neurips.cc/…" goes on an address: a comment is a
  // mark, a space and three words or more, with no second mark.
  const commentLine=text=>{const m=/^\s*(?:#|\/\/)\s+([^#]*)$/.exec(String(text));return Boolean(m)&&!/\/\//.test(m[1])&&(m[1].match(/[\p{L}\p{N}_]+/gu)||[]).length>=3;};
  const docstringLine=text=>/^\s*(?:"""|''')/.test(String(text))||/(?:"""|''')\s*$/.test(String(text));
  function paragraphStart(b,line){
    const prev=b.lines?.at(-1);
    if(prev&&(commentLine(line.text)||commentLine(prev.text)||docstringLine(line.text)&&!docstringLine(prev.text)||/\S.*(?:"""|''')\s*$/.test(String(prev.text))))return true;
    // One-line entries in a row ("Vaswani, A., …, 2017. … 30." / "Wang, Q., …").
    if(b.lines?.length===1&&authorYear(prev.text)&&authorYear(line.text)&&/[.]["'”’)\]]*$/.test(String(prev.text).trim())&&Math.abs(line.x-prev.x)<=line.fontSize*.5)return true;
    if(!prev||b.lines.length<2)return false;
    const size=line.fontSize,indented=line.x-prev.x>=size*.6&&line.x-b.x>=size*.6;
    const short=prev.x+prev.width<b.x+b.width-size*1.5,ended=/[.!?:;]["'”’)\]]*$/.test(String(prev.text).trim());
    const first=b.lines[0],hanging=!first.dropCap&&b.lines.slice(1).every(l=>l.x-first.x>=size*.6&&l.x-first.x<=size*3.5);
    return indented&&(short||ended)||hanging&&ended&&Math.abs(line.x-first.x)<=size*.5;
  }
  // A paragraph's first line indented by up to 3 em, with the next line at
  // the margin: the first line runs at least as far right and does not end
  // the sentence, so the paragraph continues below it.
  function indentedFirst(b,line){
    const size=line.fontSize,indent=b.x-line.x;
    return b.lines?.length===1&&indent>=size*.6&&indent<=size*3&&b.width>=size*12&&b.x+b.width>=line.x+line.width-size*.5&&!/[.!?:;]["'”’)\]]*$/.test(String(b.text).trim());
  }
  // In a list whose first item starts with a marker ("1.", "[12]", "•"), each
  // marker line at the item margin starts a new entry (reference lists).
  const listMarker=/^\s*(?:\[\d{1,3}\]|\d{1,3}\.|[•◦▪▫●○■□‣⁃▶►▸▹▷➤➢➔])\s+\S/;
  // A bullet glyph opens an item wherever it stands: under a line without one (a sentence going on
  // after a displayed quotation), or set further in than the item above (a slide's second level).
  // A number may be a year at the head of a wrapped line; a glyph is never that.
  const bulletLine=/^\s*[•◦▪▫●○■□‣⁃▶►▸▹▷➤➢➔]\s+\S/;
  function listItemStart(b,line){
    const first=b.lines?.[0];
    if(first?.numbered&&line.numbered)return line.x<=first.x+line.fontSize*.5;
    // An appendix section number on its own ("A.1", "D.2"; a decimal "82.1" in a table is not; an appendix letter
    // "E": a table of contents' number column) neither continues the block
    // above nor takes the lines below.
    const number=t=>/^\s*[A-Z](?:\.\d{1,2}){1,3}\.?\s*$/.test(String(t)),letter=t=>/^\s*[A-Z]\s*$/.test(String(t));
    if(first&&(number(line.text)||number(b.lines.at(-1).text)))return true;
    // An appendix letter is a number too where it stands left of the text ("E" | "Coarse To Fine …").
    const last=b.lines.at(-1);
    if(first&&(letter(line.text)&&line.x<b.x-line.fontSize||letter(last.text)&&line.x>last.x+line.fontSize))return true;
    if(first&&bulletLine.test(String(line.text)))return true;
    return Boolean(first&&listMarker.test(String(line.text))&&listMarker.test(String(first.text))&&line.x<=first.x+line.fontSize*.5);
  }
  // A list item's wrapped lines sit under its text (hanging indent). A wrapped
  // line may itself begin like a marker ("6. https://doi…", a volume number);
  // indented under the entry text it still continues the entry.
  function hangingLine(b,line){
    const first=b.lines?.[0];
    if(first?.numbered&&!line.numbered&&line.x>first.x+line.fontSize*.5&&line.x-first.x<=line.fontSize*3.5)return true;
    // An author–year reference ("Azcarate, S.M., …, 2021. Data handling")
    // runs on in lines indented under its first.
    if(first&&authorYear(first.text)&&line.x>first.x+line.fontSize*.5&&line.x-first.x<=line.fontSize*3.5)return true;
    if(bulletLine.test(String(line.text)))return false;
    return Boolean(first&&listMarker.test(String(first.text))&&(line.x>first.x+line.fontSize*.5||!listMarker.test(String(line.text))&&line.x>first.x)&&line.x-first.x<=line.fontSize*3.5);
  }
  function runInHeading(line){
    const text=String(line.text).trim(),m=/^[A-Z][^.:]{2,60}\.(?=\s|$)/.exec(text);
    return Boolean(m&&line.startsBold&&(line.boldPrefix||0)>=m[0].length-1&&text.length>m[0].length+8);
  }
  function fieldLabel(line){return Boolean(line.startsBold&&/^[A-Z][A-Za-z ]{1,30}:/.test(String(line.text).trim()));}
  // Source paragraph appearance reproduced by the translation: serif/sans
  // class, justified alignment and baseline-to-baseline line pitch.
  function paragraphStyle(b){
    const lines=b.lines||[b],size=b.fontSize;
    const chars=lines.reduce((n,l)=>n+l.text.length,0)||1,serif=lines.filter(l=>l.serif).reduce((n,l)=>n+l.text.length,0)/chars>.5;
    const right=Math.max(...lines.map(l=>l.x+l.width)),inner=lines.slice(0,-1);
    const flush=inner.filter(l=>right-(l.x+l.width)<=Math.max(1.5,size*.25)).length;
    const justify=lines.length>=3&&flush>=inner.length*.8;
    const steps=lines.slice(1).map((l,i)=>(l.baseline??l.y)-(lines[i].baseline??lines[i].y)).filter(d=>d>size*.8&&d<size*2.2).sort((x,y)=>x-y);
    const style={serif,align:justify?'justify':'start'};
    if(steps.length)style.linePitch=steps[Math.floor(steps.length/2)];
    if(b.label)style.label=b.label===true?'field':b.label;
    // The source's first-line indent, reproduced in the translation.
    const indent=lines.length>=2?lines[0].x-Math.min(...lines.map(l=>l.x)):0;
    if(indent>=size*.3&&indent<=size*4)style.indent=indent;
    // A hanging indent (wrapped lines under the entry text, as in references).
    const hang=lines.length>=2?Math.min(...lines.slice(1).map(l=>l.x))-lines[0].x:0;
    if(hang>=size*.3&&hang<=size*4)style.hang=hang;
    // A bulleted item hangs under its text whether or not the source item wraps: by the wrapped
    // lines' place, else by where its text starts after the bullet, else by 1.4em. It is set
    // ragged: a short item's few Korean words, justified, stand far apart.
    if(/^\s*[•◦▪▫●○■□‣⁃▶►▸▹▷➤➢➔]\s/.test(String(lines[0].text))){style.bullet=true;style.align='start';if(!style.hang){const gap=lines[0].bulletGap||0;style.hang=gap>=size*.6&&gap<=size*4?gap:size*1.4;}delete style.indent;}
    // A bold caption title ("Fig 2. Estimated growth curves.") stays bold.
    const caption=/^(?:fig(?:ure)?\.?|table)\s*[A-Z]?\d+[a-z]?[.:]?/i.exec(String(lines[0].text).trim());
    if(caption&&lines[0].startsBold)style.label=(lines[0].boldPrefix||0)>caption[0].length+3?'caption-sentence':'caption-prefix';
    if(lines.every(l=>l.heavy))style.heavy=true;
    return style;
  }
  function headingLine(line,median,body=median){
    const text=String(line.text).trim();
    // A bullet or a dash alone (a slide's "•" kept as PDF text over a picture) heads nothing.
    return !formulaOnly(line)&&text.length<240&&/[\p{L}\p{N}]/u.test(text)&&(
      // By size a heading is larger than most lines and than the body text:
      // many small table cells make body lines larger than most lines. A
      // line that starts in lower case or breaks a word ("mortality was …",
      // "… top-1 ac-") continues a paragraph.
      (line.fontSize>median*1.5||line.fontSize>median*1.2&&text.split(/\s+/).length<=8&&!/[.!?;:]$/.test(text))&&line.fontSize>body*1.05&&!/^\p{Ll}/u.test(text)&&!/\p{L}-$/u.test(text)||
      /^(?:\d+(?:\.\d+)*[. ]+)?(?:abstract|author summary|introduction|background|materials and methods|methods|results(?: and discussion)?|discussion|conclusions?|supporting information|acknowledg(?:e)?ments|references|초록|저자 요약|서론|결론)$/i.test(text)|| // i18n:keep — reads Korean headings
      // A numbered line in ordinary case ending on a joining word ("… complex
      // and") or breaking a word ("2. A second approach … de-") is a list
      // item that continues; a heading in capitals may wrap. Word counts are
      // a poor guide in scanned text that lost its spaces.
      Boolean(/^\d+(?:\.\d+)*[.)]?\s+[A-Z][A-Za-z -]+$/.test(text)&&text.split(/\s+/).length<=10&&!/\p{L}-$/u.test(text)&&!(/\p{Ll}/u.test(text)&&/\b(?:and|or|of|the|a|an|to|in|for|with|by|on|at|from|as|that|which|is|are|was|were|be|between)$/i.test(text)))||
      Boolean(line.bold&&text.split(/\s+/).length<=8&&text.length<100&&!/[.!?;:]$/.test(text)&&!/^\s*(?:fig(?:ure)?|table)\b/i.test(text)));
  }
  function paragraphs(lines,pageWidth,pageHeight,index){
    const median=[...lines].map(l=>l.fontSize).sort((a,b)=>a-b)[Math.floor(lines.length/2)]||12;
    // The body size is the size of most characters, not of most lines.
    const body=(()=>{const sorted=[...lines].sort((a,b)=>a.fontSize-b.fontSize),total=sorted.reduce((n,l)=>n+String(l.text).length,0);let seen=0;for(const l of sorted){seen+=String(l.text).length;if(seen*2>=total)return l.fontSize;}return median;})();
    const abstractLine=lines.find(l=>/^abstract$/i.test(l.text.trim()));
    // The parts of a fraction set above and below an equation's row ("dA₃" over "dt" before
    // "= rₐ − …", "FᵢₙA₃" over "V" in it) are that equation's: a short piece without a word,
    // half a line above or below a formula line and within its reach, goes into that line.
    // Left as lines of their own they open a paragraph with the text below the equation.
    {
      const base=l=>l.baseline??l.y+l.height*.8,formulas=lines.filter(l=>formulaOnly({...l,text:repairGlyphs(l.text)})),taken=new Set();
      // Measured against the line as read, so a line that has taken a part does not reach further (into the next column).
      const own=new Map(formulas.map(f=>[f,{x:f.x,width:f.width}]));
      for(const part of lines){
        if(formulas.includes(part)||String(part.text).trim().length>14||/\p{Ll}{4,}/u.test(part.text))continue;
        // A piece that follows another line on its own baseline is that line's end (an equation's number in the next column over).
        if(lines.some(o=>o!==part&&!taken.has(o)&&Math.abs(base(o)-base(part))<part.fontSize*.25&&o.x+o.width<=part.x+1&&part.x-(o.x+o.width)<=part.fontSize*1.5))continue;
        // A large operator and its limits ("∑" with "m" over it) stand further from the row: up to 1.7em for a piece of ten characters or fewer without a word.
        const far=String(part.text).replace(/\s/g,'').length<=10&&!/\p{Ll}{3,}/u.test(part.text)?1.7:.95;
        const host=formulas.find(f=>{const d=Math.abs(base(part)-base(f)),o=own.get(f);return d>=f.fontSize*.25&&d<=f.fontSize*far&&part.x>=o.x-f.fontSize*2.5&&part.x<=o.x+o.width+f.fontSize*1.5&&part.width<=Math.max(o.width,f.fontSize*6);});
        if(!host)continue;
        const right=Math.max(host.x+host.width,part.x+part.width),bottom=Math.max(host.y+host.height,part.y+part.height);
        host.text+=' '+part.text;host.rich=(host.rich||host.text.slice(0,-part.text.length-1))+' '+(part.rich||part.text);host.x=Math.min(host.x,part.x);host.y=Math.min(host.y,part.y);host.width=right-host.x;host.height=bottom-host.y;taken.add(part);
      }
      if(taken.size)lines=lines.filter(l=>!taken.has(l));
    }
    const blocks=[];
    for(const line of [...lines].sort((a,b)=>a.y-b.y||a.x-b.x)){
      // Classify the repaired text: a mis-encoded "ð…Þ" line is prose, not a formula.
      // An equation's number set at the margin on its baseline ("… + higher order terms.     (12)") is a line of its own here.
      const equationNumber=lines.some(o=>o!==line&&/^\s*\(\d{1,3}[a-z]?\)\s*$/.test(o.text)&&o.x>line.x+line.width&&Math.abs((o.baseline??o.y)-(line.baseline??line.y))<line.fontSize*.6);
      const math=formulaOnly({...line,text:repairGlyphs(line.text),equationNumber});
      const heading=headingLine(line,median,body)&&!(abstractLine&&line.y<abstractLine.y&&line.fontSize<abstractLine.fontSize);
      // A bold "Label:" opens a new metadata field (Citation:, Received: …),
      // and a bold run-in heading ("Bayesian inference.") a new paragraph.
      const field=fieldLabel(line),runIn=runInHeading(line);
      // A line finishing a hyphenated word ("con-" / "verged within R^ < 1.1")
      // is prose whatever symbols it carries.
      const finishes=b=>/\p{Ll}-$/u.test(String(b.lines.at(-1).text).trim())&&/^\p{Ll}/u.test(String(line.text).trim());
      // Lines indented beside a drop capital continue the paragraph it opens.
      const besideCap=(b,line)=>{const cap=b.lines[0].dropCap;return Boolean(cap)&&line.y<cap.bottom&&Math.abs(line.x-cap.right)<=line.fontSize*1.5;};
      // A one-line "heading" that runs on into a line starting in lower case
      // at its size ("3. Thelastapproach … tohandle" / "missing data. …", a
      // bold lead "… model is capable" / "of predicting …") was the first
      // line of a paragraph, unless that line is short (a heading wrapped:
      // "4.3. Construction of … knowledge" / "graph"). Set well above the
      // body (and the commonest line, which small reference type can lower)
      // it is a title over several lines.
      const title=b=>b.fontSize>Math.max(body,median)*1.3;
      const runsOn=b=>b.heading&&(b.lines.length===1||title(b))&&!heading&&/^\p{Ll}/u.test(String(line.text).trim());
      // A caption ends with its sentence: the table's header row below it
      // ("… IndPenSim data set." / "Data type   Num. of variables   …")
      // shares its baseline with other cells under the caption, three ems or
      // more away (the other column's line beside it, or a legend's line
      // samples "(-·-) … (-h-)", are no cells) and is no caption line.
      const tableRow=b=>{
        if(!/^(?:fig(?:ure)?\.?|table|tab\.)\s*[A-Z]?\d/i.test(b.text)||!/[.:]["'”’)\]]*$/.test(String(b.lines.at(-1).text).trim()))return false;
        const row=lines.filter(o=>Math.abs((o.baseline??o.y)-(line.baseline??line.y))<line.fontSize*.3&&o.x<b.x+b.width&&o.x+o.width>b.x).sort((p,q)=>p.x-q.x);
        return row.some((o,i)=>i&&o.x-(row[i-1].x+row[i-1].width)>=line.fontSize*3);
      };
      // Cells under a table's head are no lines of that head. The head is one line so far; the line under it is one
      // short word a table row's height below (a line and a half: text lines are set closer) with another cell on its
      // row inside the head's width ("the state at point 6 of the execution tree" / "node | 6" / "env | x ↦ α, …"),
      // or holds no word at all, is a sliver of the head's width and has
      // such a cell beside it ("runs that reach r = 1" / "x   y" / "−1   100").
      const beside=test=>b=>lines.some(o=>o!==line&&test(o)&&Math.abs((o.baseline??o.y)-(line.baseline??line.y))<line.fontSize*.3&&o.x<b.x+b.width&&o.x+o.width>b.x);
      const bare=l=>!/\p{L}{2,}/u.test(l.text)&&!/[.?!,;:]["'”’)\]]*\s*$/.test(l.text);
      // Two rows of a table, one under the other ("f returns | 0 | 1 | 2" over "an input (x, y) | (10, 0) | (2, 9) |
      // none: …"), are no paragraph of two lines: each holds words and has two short cells or more to its right on its
      // row, and they stand a table row's height apart (a line and a half; tables set tight keep being read by column).
      const cells=l=>lines.filter(o=>o!==l&&o.x>=l.x+l.width+l.fontSize&&o.width<=l.fontSize*6&&Math.abs((o.baseline??o.y)-(l.baseline??l.y))<l.fontSize*.3).length;
      const rows=b=>b.lines.length===1&&/\p{L}{2,}/u.test(line.text)&&/\p{L}{2,}/u.test(b.text)&&(line.baseline??line.y)-(b.lastBaseline??b.y)>=line.fontSize*1.5&&cells(line)>=2&&cells(b.lines[0])>=2;
      const cell=b=>rows(b)||b.lines.length===1&&(bare(line)&&line.width<b.width*.15&&sentenceLine(b.text)&&formulaLike(b.text)&&beside(bare)(b)||line.width<b.width*.35&&/^\s*\S{1,12}\s*$/.test(line.text)&&(line.baseline??line.y)-(b.lastBaseline??b.y)>=line.fontSize*1.5&&String(b.text).trim().length>=30&&!/[,;:-]\s*$/.test(b.text)&&beside(o=>o.x>=line.x+line.width+line.fontSize)(b));
      // A sentence set centred over two or more lines ("… three inputs, one per path," / "and a proof that r = 2
      // never runs."): the lines share their middle (each edge moves in by the same two ems or more; a first-line
      // indent moves one edge only); the line above is a line of text (thirty characters: stacked cells of a table
      // are shorter), does not end the sentence, and this one goes on in lower case.
      // Translated apart, each half took its own size.
      const centred=b=>{const last=b.lines.at(-1),left=line.x-last.x,right=last.x+last.width-(line.x+line.width);return Math.abs(left-right)<=line.fontSize*.5&&Math.abs(left)>=line.fontSize*2&&!/[.?!:;]["'”’)\]]*\s*$/.test(last.text)&&/^\s*\p{Ll}{2,}/u.test(line.text)&&!/@|:\/\/|^\s*www\./.test(line.text)&&String(last.text).trim().length>=30;};
      const joins=aligned=>b=>!paragraphStart(b,line)&&!listItemStart(b,line)&&!tableRow(b)&&!cell(b)&&(!heading&&!b.heading||runsOn(b)||heading&&b.heading&&line.fontSize>median*1.45)&&(!math||finishes(b))&&!b.formulaLike&&aligned(b)&&Math.abs(b.fontSize-line.fontSize)<line.fontSize*.12&&(line.baseline??line.y)-(b.lastBaseline??b.y)>line.fontSize*.55&&(line.baseline??line.y)-(b.lastBaseline??b.y)<line.fontSize*1.7&&b.text.length+line.text.length<10000;
      // The usual alignment first; a centred continuation only when no block takes the line that way.
      const paragraph=!field&&!runIn&&(blocks.slice().reverse().find(joins(b=>Math.abs(b.x-line.x)<Math.max(12,line.fontSize*1.3)||hangingLine(b,line)||indentedFirst(b,line)||besideCap(b,line)))||blocks.slice().reverse().find(joins(centred)));
      if(paragraph){if(runsOn(paragraph)&&!title(paragraph)&&line.width>=paragraph.width*.6)paragraph.heading=false;paragraph.text+='\n'+line.text;paragraph.rich+='\n'+(line.rich||line.text);const right=Math.max(paragraph.x+paragraph.width,line.x+line.width);paragraph.x=Math.min(paragraph.x,line.x);paragraph.width=right-paragraph.x;paragraph.height=Math.max(paragraph.bottom,line.y+line.height)-paragraph.y;paragraph.bottom=paragraph.y+paragraph.height;paragraph.lastBaseline=line.baseline??line.y;paragraph.lines.push(line);}
      else blocks.push({...line,rich:line.rich||line.text,bottom:line.y+line.height,lastBaseline:line.baseline??line.y,formulaLike:math,heading,label:field?'field':runIn?'runin':false,lines:[line]});
    }
    // A display equation extracts as several lines (fraction bars, raised
    // exponents, the "(2)" number at the margin). Gather those pieces into one
    // formula block, so the equation is kept and cropped as a whole.
    // Operator names set beside a formula ("min" over "Δu", "s.t.") are part
    // of it, as are bracket glyphs drawn larger than the text ("[", "︸").
    const operators=/\b(?:arg\s*)?(?:min|max|sup|inf|lim)\b|\bs\.\s?t\.|\b(?:exp|log|ln|sin|cos|tanh?|det|diag|tr)\b/g;
    const piece=b=>(!b.heading||!/\p{L}/u.test(b.text))&&b.lines.length<=2&&!/\p{L}{3,}/u.test(repairGlyphs(b.text).replace(operators,' '))&&b.text.replace(/\s/g,'').length<=16;
    const number=b=>/^\(\d{1,3}[a-z]?\)$/.test(b.text.trim());
    const level=(a,b)=>a.y<b.y+b.height&&b.y<a.y+a.height;
    // Words between a formula and a number on its row (a line of the other
    // column) mean the number belongs to something else; matrix entries
    // between them do not.
    const between=(f,n)=>blocks.some(o=>o!==f&&o!==n&&level(o,n)&&o.x>=f.x+f.width-1&&o.x+o.width<=n.x+1&&(o.text.match(/\p{L}{2,}/gu)||[]).length>3);
    // A numbered display row ("anomaly | score = … | − αDis(Xtest), | (8)")
    // also takes the few words set on it right beside the formula.
    const labelled=f=>/\(\d{1,3}[a-z]?\)\s*$/.test(f.text)||blocks.some(n=>number(n)&&level(n,f)&&n.x>=f.x+f.width-1&&!between(f,n));
    const beside=(f,b)=>{
      // Once the number has joined, words between sit inside the row's box.
      const size=Math.max(f.fontSize,b.fontSize),gap=b.x>=f.x?b.x-f.x-f.width:f.x-b.x-b.width,inside=b.x>=f.x-1&&b.x+b.width<=f.x+f.width+1;
      return !b.heading&&b.lines.length===1&&(b.text.match(/\p{L}{2,}/gu)||[]).length<=3&&(inside||gap>=-size&&gap<=size*1.5)&&Math.min(f.y+f.height,b.y+b.height)-Math.max(f.y,b.y)>=Math.min(f.height,b.height)*.5&&labelled(f);
    };
    for(let merged=true;merged;){
      merged=false;
      gather:for(const f of blocks.filter(b=>b.formulaLike))for(const b of blocks){
        if(b===f)continue;
        const size=Math.max(f.fontSize,b.fontSize),bottom=f.y+f.height;
        const stacked=(b.formulaLike||piece(b))&&b.y<bottom+size*.6&&b.y+b.height>f.y-size*.6&&b.x<f.x+f.width+size*1.5&&b.x+b.width>f.x-size*1.5;
        const numbered=number(b)&&b.x>=f.x+f.width-1&&b.y<bottom&&b.y+b.height>f.y&&!between(f,b);
        if(!stacked&&!numbered&&!beside(f,b))continue;
        const right=Math.max(f.x+f.width,b.x+b.width),low=Math.max(bottom,b.y+b.height);
        f.lines.push(...b.lines);f.lines.sort((x,y)=>x.y-y.y||x.x-y.x);f.text=f.lines.map(l=>l.text).join('\n');f.rich=f.lines.map(l=>l.rich||l.text).join('\n');
        f.x=Math.min(f.x,b.x);f.y=Math.min(f.y,b.y);f.width=right-f.x;f.height=low-f.y;f.bottom=low;f.lastBaseline=Math.max(f.lastBaseline,b.lastBaseline);
        blocks.splice(blocks.indexOf(b),1);merged=true;break gather;
      }
    }
    // Inline math ("… J_{MPCA−MPLS,F̂DR} is proposed …") can break a paragraph
    // line: the script pieces and the rest of the line come out as blocks of
    // their own on that baseline. A one-line block that starts just after a
    // paragraph line ends, on its baseline (a script may sit half a line
    // lower) and inside the paragraph's column, is put back on that line.
    for(const p of blocks.filter(b=>!b.formulaLike&&!b.heading&&/\p{L}{3,}/u.test(b.text))){
      if(!blocks.includes(p))continue;
      for(const line of p.lines){
        const size=line.fontSize,base=line.baseline??line.y;
        // Inline math drawn as graphics (a slide's "B = [a, b]") leaves a wide
        // gap: a piece of prose further right still continues a line that
        // stops mid-sentence when it starts in lower case, inside the width
        // the paragraph's other lines already take (not across a gutter),
        // and no other prose starts where it does (no second column). The math is not in the
        // text, so the source stays in place (the translation goes below).
        const runOn=b=>b.x<p.x+p.width-size&&(String(b.text).match(/\p{Ll}{3,}/gu)||[]).length>=3&&String(b.text).trim().length>=20&&(String(line.text).match(/\p{L}{2,}/gu)||[]).length>=2&&/^\p{Ll}/u.test(String(b.text).trim())&&!/[.!?:;]["'”’)\]]*$/.test(String(line.text).trim())&&!blocks.some(o=>o!==b&&o!==p&&!o.heading&&String(o.text).length>40&&Math.abs(o.x-b.x)<=size);
        // The piece stays inside the column: as wide as the paragraph, or as
        // the column's other prose when the paragraph's lines so far are short
        // (a run-in heading over one closing line: "Label Smoothing" | "During
        // training, … This" | "hurts perplexity, …"). A piece where other
        // prose also starts opens a column of its own (the next column's
        // heading beside a line of this one), however wide the page's
        // full-width blocks make this column look.
        const columnRight=Math.max(p.x+p.width,...blocks.filter(o=>o!==p&&!o.heading&&!o.formulaLike&&String(o.text).length>80&&Math.abs(o.x-p.x)<=size).map(o=>o.x+o.width));
        const opensColumn=b=>blocks.some(o=>o!==b&&o!==p&&String(o.text).length>40&&Math.abs(o.x-b.x)<=size);
        // Past the paragraph's own width only prose joins prose: table cells
        // on one baseline ("Num." | "Category", "base" | "6") stay apart.
        // A cell is one line; a paragraph of two lines or more is prose even
        // when the line opens with one word and a script ("whereX2m" | "a is the …").
        const words=t=>(String(t).match(/\p{L}{2,}/gu)||[]).length;
        const inColumn=b=>b.x+b.width<=p.x+p.width+2||b.x+b.width<=columnRight+2&&!opensColumn(b)&&words(b.text)>=3&&(words(line.text)>=2||p.lines.length>=2);
        const near=b=>Math.min(Math.abs((b.lines[0].baseline??b.y)-base),Math.abs((b.lines[0].baseline??b.y)-(line.endBaseline??base)))<=size*.5;
        const tails=blocks.filter(b=>b!==p&&!b.heading&&b.lines.length===1&&near(b)&&b.fontSize<=size*1.12&&b.x>=line.x+line.width-1&&(inColumn(b)||runOn(b))).sort((a,b)=>a.x-b.x);
        let end=line.x+line.width;
        for(const tail of tails){
          // The gap holds math drawn as graphics ("for every subset B = [a, b] in
          // the domain …"): a placeholder keeps its place in the sentence, so the
          // translation carries it and the drawing shows there, cut from the page.
          let gap='';
          if(tail.x-end>size*2.5){if(!runOn(tail))break;p.inlineGraphic=true;gap=' '+graphicToken(index,end,Math.min(line.y,tail.y),tail.x-end,Math.max(line.y+line.height,tail.y+tail.height)-Math.min(line.y,tail.y));}
          const piece=tail.lines[0];line.rich=(line.rich||line.text)+gap+' '+(piece.rich||piece.text);line.text+=gap+' '+piece.text;
          end=Math.max(end,tail.x+tail.width);line.width=end-line.x;blocks.splice(blocks.indexOf(tail),1);
        }
        if(line.x+line.width>p.x+p.width)p.width=line.x+line.width-p.x;
      }
      p.text=p.lines.map(l=>l.text).join('\n');p.rich=p.lines.map(l=>l.rich||l.text).join('\n');
    }
    // Full-width headings/captions divide column regions. Within a region, read
    // down the left column before the right; never merge across the gutter.
    const footnote=b=>b.y>pageHeight*.85&&b.fontSize<body*.9;
    const ordered=[],pending=[],notes=[];
    const flush=()=>{
      const left=pending.filter(b=>b.x<pageWidth/2&&b.width>pageWidth*.22),right=pending.filter(b=>b.x>=pageWidth/2&&b.width>pageWidth*.22);
      const columns=left.some(a=>right.some(b=>a.y<b.bottom&&b.y<a.bottom));
      pending.sort((a,b)=>(columns?Number(a.x>=pageWidth/2)-Number(b.x>=pageWidth/2):0)||a.y-b.y||a.x-b.x);ordered.push(...pending);pending.length=0;
    };
    for(const b of blocks){if(footnote(b)){notes.push(b);continue;}if(b.width>pageWidth*.55){flush();ordered.push(b);}else pending.push(b);}flush();
    ordered.push(...notes);
    // The end of a line set apart from it: a wide gap in a justified line ("… reconstructed" |
    // "as"), or a glyph the PDF holds no text for ("ε ⫫ X, var(Y) = …"), cuts the line in two,
    // and the cut-off ends, one under another, read as a formula of their own inside the
    // paragraph. A block whose every line continues a line of one paragraph on its baseline
    // goes back into those lines.
    const baseOf=l=>l.baseline??l.y+l.height*.8;
    for(let i=ordered.length-1;i>=0;i--){
      const b=ordered[i];if(!b.lines?.length||b.lines.length>4||b.heading)continue;
      for(const a of ordered){
        if(a===b||!a.lines||a.lines.length<2||a.formulaLike||a.heading||b.x<a.x-a.fontSize)continue;
        // Within the paragraph's column: its own right edge, or that of the paragraphs set at its left edge (its first line may be the one cut).
        const edge=Math.max(...ordered.filter(o=>Math.abs(o.x-a.x)<=a.fontSize&&!o.formulaLike&&o.width<=a.width*1.3).map(o=>o.x+o.width));
        if(b.x+b.width>edge+a.fontSize)continue;
        const reach=a.fontSize*3.5,pieces=[...b.lines].sort((p,q)=>p.x-q.x),span=new Map(a.lines.map(h=>[h,{x:h.x,right:h.x+h.width}])),plan=[];
        // Each piece continues a line of the paragraph on its baseline; several may follow one line, left to right.
        for(const l of pieces){
          const h=a.lines.find(h=>{const e=span.get(h);return Math.abs(baseOf(h)-baseOf(l))<=Math.min(h.fontSize||a.fontSize,l.fontSize||b.fontSize)*.35&&(l.x>=e.right-1&&l.x-e.right<=reach||l.x+l.width<=e.x+1&&e.x-(l.x+l.width)<=reach);});
          if(!h){plan.length=0;break;}
          const e=span.get(h);plan.push([l,h,l.x>=e.right-1]);e.x=Math.min(e.x,l.x);e.right=Math.max(e.right,l.x+l.width);
        }
        if(!plan.length)continue;
        for(const [l,h,after] of plan){const right=Math.max(h.x+h.width,l.x+l.width),bottom=Math.max(h.y+h.height,l.y+l.height);
          const ht=h.text,hr=h.rich||h.text,lt=l.text,lr=l.rich||l.text;h.text=after?ht+' '+lt:lt+' '+ht;h.rich=after?hr+' '+lr:lr+' '+hr;
          h.x=Math.min(h.x,l.x);h.y=Math.min(h.y,l.y);h.width=right-h.x;h.height=bottom-h.y;}
        const right=Math.max(a.x+a.width,b.x+b.width),bottom=Math.max(a.y+a.height,b.y+b.height);
        a.text=a.lines.map(l=>l.text).join('\n');a.rich=a.lines.map(l=>l.rich||l.text).join('\n');a.x=Math.min(a.x,b.x);a.y=Math.min(a.y,b.y);a.width=right-a.x;a.height=bottom-a.y;if('bottom' in a)a.bottom=bottom;if(b.inlineGraphic)a.inlineGraphic=true;
        ordered.splice(i,1);break;
      }
    }
    // A piece lying inside another paragraph's box in the same type (the rest of a caption
    // whose lines an inline legend mark split, a list item's first word) is that paragraph's
    // text: its lines go into it, in reading order. Left apart, the two overlap and both
    // are kept as their source.
    const lineOrder=(x,y)=>Math.abs(x.y-y.y)>Math.min(x.height,y.height)*.5?x.y-y.y:x.x-y.x;
    for(let i=ordered.length-1;i>=0;i--){
      const b=ordered[i];if(b.formulaLike||!b.lines?.length)continue;
      const a=ordered.find(o=>{if(o===b||o.formulaLike||!o.lines?.length||o.width*o.height<b.width*b.height||Math.abs(o.fontSize-b.fontSize)>Math.max(o.fontSize,b.fontSize)*.1||Boolean(o.heading)!==Boolean(b.heading))return false;
        const w=Math.min(o.x+o.width,b.x+b.width)-Math.max(o.x,b.x),h=Math.min(o.y+o.height,b.y+b.height)-Math.max(o.y,b.y);return w>0&&h>0&&w*h>=b.width*b.height*.8;});
      if(!a)continue;
      const right=Math.max(a.x+a.width,b.x+b.width),bottom=Math.max(a.y+a.height,b.y+b.height);
      a.lines=[...a.lines,...b.lines].sort(lineOrder);a.text=a.lines.map(l=>l.text).join('\n');a.rich=a.lines.map(l=>l.rich||l.text).join('\n');
      a.x=Math.min(a.x,b.x);a.y=Math.min(a.y,b.y);a.width=right-a.x;a.height=bottom-a.y;if('bottom' in a)a.bottom=bottom;if(b.inlineGraphic)a.inlineGraphic=true;ordered.splice(i,1);
    }
    // A section number set apart from its heading ("3.3." then "Projection to the model plane
    // method", wrapped to "(PMP)" under the number) lies inside the heading's box, and the
    // heading would be kept as its source for that overlap. The number joins its heading.
    for(let i=ordered.length-1;i>=0;i--){
      const a=ordered[i],number=/^\d{1,2}(?:\.\d{1,2}){0,3}\.?$/;
      // The number may have taken the heading's second line with it ("3.6." over "in process
      // monitoring", both at the margin, beside "The asymmetric role of SPE and T²").
      if(a.lines?.length>=2&&number.test(String(a.lines[0].text).trim())&&!number.test(String(a.text).trim())){
        const n=a.lines[0],h=ordered.find(o=>{const first=o.lines?.[0];return o!==a&&first&&Math.abs(first.y-n.y)<=a.fontSize*.5&&first.x>=n.x+n.width-1&&first.x-(n.x+n.width)<=a.fontSize*2.5&&Math.abs(o.fontSize-a.fontSize)<=a.fontSize*.1;});
        if(h){
          const right=Math.max(a.x+a.width,h.x+h.width),bottom=Math.max(a.y+a.height,h.y+h.height),head={...h.lines[0],text:n.text+' '+h.lines[0].text,rich:(n.rich||n.text)+' '+(h.lines[0].rich||h.lines[0].text),x:n.x,width:h.lines[0].x+h.lines[0].width-n.x};
          h.lines=[head,...[...h.lines.slice(1),...a.lines.slice(1)].sort((p,q)=>p.y-q.y||p.x-q.x)];h.text=h.lines.map(l=>l.text).join('\n');h.rich=h.lines.map(l=>l.rich||l.text).join('\n');
          h.x=Math.min(a.x,h.x);h.y=Math.min(a.y,h.y);h.width=right-h.x;h.height=bottom-h.y;if('bottom' in h)h.bottom=bottom;ordered.splice(i,1);
        }
        continue;
      }
      if(!number.test(String(a.text).trim()))continue;
      const b=ordered.find(o=>{const first=o.lines?.[0];return o!==a&&first&&o.lines.length>=2&&Math.abs(first.y-a.y)<=a.fontSize*.5&&first.x>=a.x+a.width-1&&first.x-(a.x+a.width)<=a.fontSize*2.5&&o.x<a.x+a.width;});
      if(!b)continue;
      const right=b.x+b.width,bottom=b.y+b.height;b.text=a.text+' '+b.text;if(b.rich!==undefined)b.rich=(a.rich??a.text)+' '+b.rich;
      b.x=Math.min(a.x,b.x);b.y=Math.min(a.y,b.y);b.width=right-b.x;b.height=bottom-b.y;if('bottom' in b)b.bottom=bottom;
      b.lines=[{...b.lines[0],x:a.x,width:b.lines[0].x+b.lines[0].width-a.x},...b.lines.slice(1)];ordered.splice(i,1);
    }
    // A tall glyph in a paragraph's last line (a bracket of inline math) or in the first line
    // of the next takes one box a little into the other; two paragraphs overlapping would
    // both be kept as their source. The upper one ends where the lower one begins.
    for(const a of ordered)for(const b of ordered){
      if(a===b||!(b.y>a.y)||a.formulaLike||b.formulaLike)continue;
      const over=a.y+a.height-b.y,cols=Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x),last=a.lines?.at(-1);
      if(over>0&&over<=Math.min(a.fontSize,b.fontSize)&&cols>=Math.min(a.width,b.width)*.5&&(!last||a.lines.length<2||b.y>=last.y+last.height*.4)&&b.y+b.height>a.y+a.height){a.height=b.y-a.y;if('bottom' in a)a.bottom=b.y;}
    }
    // So with two columns: a line's last glyph measured a little wide takes the left
    // column's paragraph into the right one. It ends where the right one begins.
    for(const a of ordered)for(const b of ordered){
      if(a===b||!(b.x>a.x)||a.formulaLike||b.formulaLike)continue;
      const over=a.x+a.width-b.x,rows=Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y);
      if(over>0&&over<=Math.min(a.fontSize,b.fontSize)&&rows>=Math.min(a.height,b.height)*.5&&b.x+b.width>a.x+a.width&&b.x-a.x>=a.width*.7)a.width=b.x-a.x;
    }
    return ordered.map((b,i)=>({id:`p${index}-b${i}`,text:normalizeParagraph(b.text),...richField(b),...(b.inlineGraphic?{inlineGraphic:true}:{}),...(b.lines?.length>1&&b.lines.length<=6?{rows:b.lines.map(l=>[l.x,l.y,l.width,l.height].map(v=>Math.round(v*10)/10))}:{}),x:b.x,y:b.y,width:b.width,height:b.height,fontSize:b.fontSize,...paragraphStyle(b),kind:b.formulaLike?'formula':/^(fig(?:ure)?\.?|table)\s*[A-Z]?\d+[a-z]?\s*[.:|]/i.test(b.text)?'caption':footnote(b)?'footnote':b.heading?'heading':'body'}));
  }
  function richField(b){const text=normalizeParagraph(b.text),rich=normalizeParagraph(b.rich??b.text);return rich!==text&&/<(?:sub|sup)>/.test(rich)?{rich}:{};}
  // Reconcile legacy line fragments against current PDF paragraphs without an
  // inference request. Each cached block belongs to exactly one displayed block.
  function reconcilePage(cached,canonical){
    const groups=new Map(),unmatched=[];
    // What today's layout keeps as source (table cells, labels, equations)
    // stays source though an older layout translated it ("Num. of variables"
    // once taken for prose under a caption that swallowed its header row).
    const keep=new Set(layoutBlocks(canonical).filter(b=>b.sourceOnly).map(b=>b.id));
    for(const block of cached.blocks){
      let best=null,score=0;
      for(const candidate of canonical.blocks){
        const dx=Math.max(0,Math.min(block.x+block.width,candidate.x+candidate.width)-Math.max(block.x,candidate.x));
        const dy=Math.max(0,Math.min(block.y+block.height,candidate.y+candidate.height)-Math.max(block.y,candidate.y));
        const value=dx*dy/Math.max(block.width*block.height,candidate.width*candidate.height);
        if(value>score){score=value;best=candidate;}
      }
      // A line may map into a paragraph, but a large old block spanning several
      // new paragraphs must not be squeezed into the first overlapping one.
      const contained=best&&block.x>=best.x-4&&block.x+block.width<=best.x+best.width+4&&block.y>=best.y-block.fontSize&&block.y+block.height<=best.y+best.height+block.fontSize;
      // An old block reaching past today's paragraph only over blank page or
      // a drawing (a line once glued to a scanned figure's frame, "|~~~~")
      // still maps into it when half of it lies in that paragraph.
      const shared=c=>Math.max(0,Math.min(block.x+block.width,c.x+c.width)-Math.max(block.x,c.x))*Math.max(0,Math.min(block.y+block.height,c.y+c.height)-Math.max(block.y,c.y)),own=Math.max(1,block.width*block.height);
      const spilled=best&&!contained&&block.y>=best.y-block.fontSize&&block.y+block.height<=best.y+best.height+block.fontSize&&shared(best)>=own*.5&&!canonical.blocks.some(c=>c!==best&&shared(c)>own*.02);
      if(!best||(!contained&&!spilled&&score<.7)){
        // Text set at an angle is no longer extracted; an older translation
        // of it (mostly a margin download stamp) is dropped, not drawn.
        const covered=(canonical.rotatedMarks||[]).reduce((n,m)=>n+Math.max(0,Math.min(block.x+block.width,m.x+m.width)-Math.max(block.x,m.x))*Math.max(0,Math.min(block.y+block.height,m.y+m.height)-Math.max(block.y,m.y)),0);
        if(covered>=block.width*block.height*.5)continue;
        // An old block of the reference list set over several of today's entries (the list was
        // once read as one paragraph): the entries show as their source, as in a new
        // translation, and the old block is not drawn over them as a paragraph out of place.
        const entries=canonical.blocks.filter(c=>shared(c)>=Math.max(1,c.width*c.height)*.5);
        if(entries.length>=2&&bibliographyEntry(block.text)&&entries.filter(c=>bibliographyEntry(c.text)).length>=entries.length*.6){for(const c of entries)keep.add(c.id);continue;}
        unmatched.push({...block,sourceIds:[block.id],mappingUncertain:true});continue;
      }
      if(!groups.has(best.id))groups.set(best.id,{candidate:best,parts:[]});groups.get(best.id).parts.push(block);
    }
    // An old block over several of today's paragraphs in one column (a list
    // item split differently when it was translated) shows them as one box
    // with that old translation; formulas it reaches keep it apart.
    const area=b=>Math.max(1,b.width*b.height),cover=(u,c)=>Math.max(0,Math.min(u.x+u.width,c.x+c.width)-Math.max(u.x,c.x))*Math.max(0,Math.min(u.y+u.height,c.y+c.height)-Math.max(u.y,c.y))/area(c);
    for(let i=unmatched.length-1;i>=0;i--){
      const u=unmatched[i],covered=canonical.blocks.filter(c=>cover(u,c)>=.5&&!keep.has(c.id));
      // Numbered entries that start inside the old block but whose numbers it
      // lacks (a reference list with its numbers set apart) would lose them.
      const lost=covered.filter(c=>c.y>=u.y-1).some(c=>{const m=/^\s*(\[\d{1,3}\]|\d{1,3}\.?)\s+(\p{Lu}\S*)/u.exec(c.text);return m&&!String(u.text).includes(m[1]+' '+m[2]);});
      if(!covered.length||lost||covered.some(c=>formulaOnly(c))||covered.some(c=>Math.abs(c.x-covered[0].x)>c.fontSize*2))continue;
      // Over cells kept as source, the box is today's paragraphs only.
      // Nor where the old box runs into one of today's equations (it once took in the equation's
      // fraction parts, now read with the equation) or into a paragraph another old block is shown in.
      const meets=c=>Math.min(u.x+u.width,c.x+c.width)-Math.max(u.x,c.x)>2&&Math.min(u.y+u.height,c.y+c.height)-Math.max(u.y,c.y)>2;
      // The old block may end inside one of today's paragraphs that another old block is shown in
      // (list items once cut elsewhere: "▶ A. ▶ B begins" | "B goes on. ▶ C"): the two old
      // blocks share one box over all of those paragraphs, their translations in order.
      const joint=canonical.blocks.filter(c=>!covered.includes(c)&&groups.has(c.id)&&!formulaOnly(c)&&!keep.has(c.id)&&meets(c)&&cover(u,c)>=.15&&Math.abs(c.x-covered[0].x)<=c.fontSize*3.5);
      if(joint.length){covered.push(...joint);covered.sort((p,q)=>p.y-q.y||p.x-q.x);}
      const all=[...covered,...(canonical.blocks.some(c=>keep.has(c.id)&&cover(u,c)>=.5||!covered.includes(c)&&(formulaOnly(c)||groups.has(c.id))&&meets(c))?[]:[u])],x=Math.min(...all.map(b=>b.x)),y=Math.min(...all.map(b=>b.y));
      const candidate={...covered[0],x,y,width:Math.max(...all.map(b=>b.x+b.width))-x,height:Math.max(...all.map(b=>b.y+b.height))-y,text:covered.map(c=>c.text).join(' ')};
      const parts=[...covered.flatMap(c=>groups.get(c.id)?.parts||[]),{...u,mappingUncertain:false}];
      if(joint.length){
        parts.sort((p,q)=>p.y-q.y||p.x-q.x);
        // Today's paragraphs that those old blocks lie over and nothing else is shown in (the item
        // the second old block ended with) belong to the box too.
        const under=(o,c)=>Math.max(0,Math.min(o.x+o.width,c.x+c.width)-Math.max(o.x,c.x))*Math.max(0,Math.min(o.y+o.height,c.y+c.height)-Math.max(o.y,c.y))/area(c);
        const more=canonical.blocks.filter(c=>!covered.includes(c)&&!groups.has(c.id)&&!formulaOnly(c)&&!keep.has(c.id)&&parts.some(o=>under(o,c)>=.5));
        if(more.length){covered.push(...more);covered.sort((p,q)=>p.y-q.y||p.x-q.x);const x=Math.min(...covered.map(b=>b.x),candidate.x),y=Math.min(...covered.map(b=>b.y),candidate.y);Object.assign(candidate,{width:Math.max(candidate.x+candidate.width,...covered.map(b=>b.x+b.width))-x,height:Math.max(candidate.y+candidate.height,...covered.map(b=>b.y+b.height))-y,x,y,text:covered.map(c=>c.text).join(' ')});}
      }
      // Old blocks that overlap each other are ambiguous; they keep their source.
      if(parts.some(o=>o.id!==u.id&&Math.min(o.x+o.width,u.x+u.width)-Math.max(o.x,u.x)>2&&Math.min(o.y+o.height,u.y+u.height)-Math.max(o.y,u.y)>2))continue;
      for(const c of covered)groups.delete(c.id);
      groups.set(covered[0].id,{candidate,parts,merged:covered.map(c=>c.id)});unmatched.splice(i,1);
    }
    // Pieces of one paragraph that were translated apart may each carry the
    // whole paragraph's translation (a split-off first line); it is shown once.
    // A short old piece (inline math once drawn apart) adds nothing to a long
    // translated paragraph: its text was not in that paragraph's request.
    // A piece whose translation an earlier piece already carries (a split-off
    // first line translated as the whole reference, its rest again) is
    // shown once: contained in it, or ending as it does.
    // One of today's paragraphs that nothing is shown in, lying under an old block shown in the
    // paragraph beside it (a list item the old paragraph ran on into: "… ▶ next item"), is part of
    // that old block: its box takes the paragraph in, instead of naming it as missing.
    {
      const area=c=>Math.max(1,c.width*c.height),under=(o,c)=>Math.max(0,Math.min(o.x+o.width,c.x+c.width)-Math.max(o.x,c.x))*Math.max(0,Math.min(o.y+o.height,c.y+c.height)-Math.max(o.y,c.y))/area(c);
      for(const c of canonical.blocks){
        if(groups.has(c.id)||keep.has(c.id)||formulaOnly(c)||[...groups.values()].some(g=>g.merged?.includes(c.id)))continue;
        const host=[...groups.values()].find(g=>!formulaOnly(g.candidate)&&Math.abs(g.candidate.x-c.x)<=c.fontSize*3.5&&g.parts.some(o=>under(o,c)>=.5));
        if(!host)continue;
        const k=host.candidate,x=Math.min(k.x,c.x),y=Math.min(k.y,c.y),first=c.y<k.y;
        host.candidate={...k,x,y,width:Math.max(k.x+k.width,c.x+c.width)-x,height:Math.max(k.y+k.height,c.y+c.height)-y,text:first?c.text+' '+k.text:k.text+' '+c.text};
        host.merged=[...(host.merged||[k.id]),c.id];
      }
    }
    const tail=t=>t.replace(/\s+/g,'').slice(-16);
    const once=list=>list.filter((t,j)=>t.replace(/\s+/g,'').length<16||!list.slice(0,j).some(e=>e.length>=t.length&&(e.includes(t)||e.replace(/\s+/g,'').endsWith(tail(t)))));
    const blocks=[...groups.values()].map(({candidate,parts,merged})=>{
      parts.sort((a,b)=>a.y-b.y||a.x-b.x);
      const missingTranslation=parts.some(b=>b.missingTranslation||!b.translation?.trim()&&!formulaOnly(b)&&!publisherMark(b,cached));
      // The paragraphs of today that this box takes in (list items once translated as one): where
      // each starts within the box, the gap above it and its hanging indent, for setting the items.
      const taken=(merged||[]).map(id=>canonical.blocks.find(c=>c.id===id)).filter(Boolean).sort((p,q)=>p.y-q.y||p.x-q.x);
      const items=taken.length>=2?taken.map((c,i)=>({dx:Math.round((c.x-candidate.x)*10)/10,gap:i?Math.max(0,Math.round((c.y-(taken[i-1].y+taken[i-1].height))*10)/10):0,hang:c.hang||0,bullet:Boolean(c.bullet)})):null;
      return {...candidate,...(items?{items,bullet:items.some(t=>t.bullet)}:{}),...(keep.has(candidate.id)?{keepSource:true}:{}),id:parts[0].id,sourceIds:parts.map(b=>b.id),text:parts.map(b=>b.text).join(' '),translation:once([...new Set(parts.filter(b=>parts.length<2||!(String(b.text).trim().length<=20&&parts.some(o=>o!==b&&String(o.text).length>80&&String(o.translation||'').trim()))).map(b=>String(b.translation||'').trim()).filter(Boolean))]).join(' '),missingTranslation,...(missingTranslation&&parts.some(b=>b.missingReason)?{missingReason:parts.find(b=>b.missingReason).missingReason}:{}),...(parts.some(b=>b.pending)?{pending:true}:{}),warnings:[...new Set(parts.flatMap(b=>b.warnings||[]))]};
    });
    blocks.push(...unmatched);
    // Old caches may omit an entire canonical section. Surface its source and
    // a repair action instead of silently removing it from the reading model.
    for(const candidate of canonical.blocks){
      if(groups.has(candidate.id)||[...groups.values()].some(g=>g.merged?.includes(candidate.id))||unmatched.some(b=>b.x<candidate.x+candidate.width&&b.x+b.width>candidate.x&&b.y<candidate.y+candidate.height&&b.y+b.height>candidate.y))continue;
      const id=blocks.some(b=>b.id===candidate.id)?candidate.id+'-missing':candidate.id;
      // An entry of a reference list the old translation holds nothing for (its page of the list
      // has four or more entries) is kept as its source like the rest of a list today, not named as missing.
      const listed=/^\s*(?:\[[^\]]{1,60}\]|\(\d{1,3}\)|\d{1,3}[.)]?\s|\p{Lu}[\p{L}'’\-]+,\s+(?:\p{Lu}\.\s?-?){1,4})/u.test(candidate.text)&&bibliographyEntry(candidate.text)&&canonical.blocks.filter(c=>bibliographyEntry(c.text)).length>=4;
      if(keep.has(candidate.id)||listed){blocks.push({...candidate,id,sourceIds:[],translation:'',keepSource:true});continue;}
      blocks.push({...candidate,id,sourceIds:[],translation:'',missingTranslation:true,mappingUncertain:true,warnings:['이전 번역에 누락된 문단입니다. 이 페이지를 다시 번역하세요.']}); // i18n:keep — the warning stays Korean like the saved ones; warningText names it
    }
    blocks.sort((a,b)=>a.y-b.y||a.x-b.x);
    return {width:cached.width,height:cached.height,blocks};
  }
  // A semantic section can continue across pages. Its ID depends on its source
  // anchor, not translated text or an extraction array index.
  function sourceKey(hash,page,block){
    const input=[hash,page,Math.round(block.x),Math.round(block.y),normalizeParagraph(block.text)].join('|');
    let n=2166136261;for(const c of input)n=Math.imul(n^c.charCodeAt(0),16777619);
    return 's-'+(n>>>0).toString(36)+'-'+page+'-'+Math.round(block.y);
  }
  function sectionDocument(pages,hash){
    const sections=[],nodes=[],stack=[];let current=null;
    const headingSizes=[...new Set(pages.flatMap(p=>p?.blocks.filter(sectionHeading).map(b=>Math.round(b.fontSize))||[]))].sort((a,b)=>b-a);
    const repeated=new Map();for(const page of pages){if(!page)continue;const seen=new Set(page.blocks.filter(b=>b.y<page.height*.065||b.y>page.height*.94).map(b=>normalizeParagraph(b.text).replace(/\d+/g,'#')));for(const key of seen)repeated.set(key,(repeated.get(key)||0)+1);}
    for(let i=0;i<pages.length;i++){
      const page=pages[i];if(!page){current=null;stack.length=0;continue;}
      const sorted=[...page.blocks].sort((a,b)=>a.y-b.y||a.x-b.x);
      // Separate a narrow publisher sidebar from the main reading stream.
      const main=sorted.filter(b=>b.width>page.width*.35&&b.text.length>100);
      const mainX=main.length?Math.min(...main.map(b=>b.x)):0;
      const sidebar=b=>mainX>page.width*.2&&b.x+b.width<=mainX+2&&b.x<mainX-20;
      let side=null;
      // Reading order is column-first within horizontal heading bands.
      const ordered=[],pending=[];
      const flush=()=>{
        const starts=[];for(const b of pending.filter(b=>b.width>page.width*.22&&!sectionHeading(b))){if(!starts.some(x=>Math.abs(x-b.x)<24))starts.push(b.x);}starts.sort((a,b)=>a-b);
        const column=b=>starts.reduce((best,x,index)=>Math.abs(x-b.x)<Math.abs((starts[best]??b.x)-b.x)?index:best,0);
        pending.sort((a,b)=>column(a)-column(b)||a.y-b.y||a.x-b.x);ordered.push(...pending);pending.length=0;
      };
      for(const b of sorted.filter(b=>!sidebar(b))){if(sectionHeading(b)&&b.width>page.width*.55||['caption','table-caption','figure-caption'].includes(b.kind)&&b.width>page.width*.55){flush();ordered.push(b);}else pending.push(b);}flush();ordered.push(...sorted.filter(sidebar));
      for(const block of ordered){
        const running=publisherMark(block,page)||((block.y<page.height*.065||block.y>page.height*.94)&&block.kind!=='heading'&&block.text.length<160&&(repeated.get(normalizeParagraph(block.text).replace(/\d+/g,'#'))||0)>1);
        // Keep uncertain running matter as metadata, never discard source text.
        const isSide=sidebar(block)||running&&page.blocks.length>3;
        let section;
        if(isSide){if(!side){side={id:sourceKey(hash,i+1,block)+'-metadata',title:'문서 정보',level:1,parentSectionId:null,nodes:[],role:'metadata'};sections.push(side);}section=side;} // i18n:keep — the name of a section without a heading; the screen names it (pdf-view sectionName)
        else{
          if(sectionHeading(block)){
            const level=Math.min(3,Math.max(1,headingSizes.indexOf(Math.round(block.fontSize))+1));
            while(stack.length&&stack.at(-1).level>=level)stack.pop();
            current={id:sourceKey(hash,i+1,block),title:plainScripts(block.translation||block.text),sourceTitle:block.text,level,parentSectionId:stack.at(-1)?.id||null,nodes:[],role:/author summary/i.test(block.text)?'summary':'body'};
            sections.push(current);stack.push(current);
          }
          if(!current){current={id:sourceKey(hash,i+1,block),title:'본문',level:1,parentSectionId:null,nodes:[],role:'body',continued:i>0};sections.push(current);} // i18n:keep — the name of a section without a heading; the screen names it (pdf-view sectionName)
          section=current;
        }
        const node={...block,sectionId:section.id,page:i+1,sourceIds:block.sourceIds||[block.id],anchor:{page:i+1,x:block.x,y:block.y,width:block.width,height:block.height}};
        section.nodes.push(node);nodes.push(node);
      }
    }
    return {version:1,sourceHash:hash,sections,nodes};
  }
  // Build the section map before inference, including continuation pages.
  // Original block IDs/coordinates remain available for placement after translation.
  // An entry of the reference list: it is kept as its source and not sent for translation.
  // A translated title or journal cannot be looked up, and the list is a seventh of a
  // paper's text. Only what reads as an entry (a year, with a number, an author's name,
  // "et al." or a journal's marks) under a heading that names the list; an appendix set
  // after the list under no heading of its own is prose, and still translated.
  const referenceSection=title=>/^(?:\d+\.?\s*)?(?:references?(?: and notes)?|bibliography|literature cited|works cited|참고\s*문헌)\s*$/i.test(String(title||'').trim()); // i18n:keep — reads a Korean heading
  function bibliographyEntry(text){
    const t=String(text||'').trim(),years=(t.match(/(?:19|20)\d{2}[a-z]?(?!\d)/g)||[]).length,marks=/\b(?:pp?\.|vol\.|doi\b|https?:\/\/|arXiv|Proc\.|J\.|Trans\.|Lett\.|Res\.|Sci\.|Eng\.)/.test(t);
    // Several entries set as one block.
    if(years>=3&&(marks||/\bet al\./.test(t)))return true;
    if(t.length>900)return false;
    // An entry's head, whether or not its year is on a later line: "[12] …", "12. …", "(12) …", "Surname, A.B., …".
    if(/^(?:\[[^\]]{1,60}\]|\(\d{1,3}\)|\d{1,3}[.)]?\s)\s*\p{Lu}/u.test(t)||/^\p{Lu}[\p{L}'’\-]+,\s+(?:\p{Lu}\.\s?-?){1,4}/u.test(t))return true;
    return years>=1&&(marks||/\bet al\./.test(t));
  }
  function structureTranslationPages(pages,hash){
    const model=sectionDocument(pages,hash),byId=new Map();
    for(const section of model.sections){
      const text=section.nodes.filter(n=>!formulaOnly(n)&&!publisherMark(n,pages[n.page-1])).map(n=>n.text).join(' ');
      // Keep a bounded section reference shared across its requests/pages.
      const sectionContext=text.length>3200?text.slice(0,2000)+' … '+text.slice(-1190):text;
      for(const node of section.nodes)byId.set(node.id,{...node,sectionTitle:section.sourceTitle||section.title,sectionContext});
    }
    const chains=flowChains(model,pages),heads=new Map();
    for(const [id,chain] of chains)for(const member of chain.ids)heads.set(member,id);
    return pages.map(page=>({...page,blocks:page.blocks.map(b=>{
      const node=byId.get(b.id),chain=chains.get(b.id);
      return {...b,sectionId:node.sectionId,sectionTitle:node.sectionTitle,sectionContext:node.sectionContext,...(b.kind!=='heading'&&referenceSection(node.sectionTitle)&&bibliographyEntry(b.text)?{keepSource:true}:{}),...(chain?{flowIds:chain.ids,flowText:chain.text,...(chain.rich&&chain.rich!==chain.text?{flowRich:chain.rich}:{})}:{}),...(heads.has(b.id)?{flowHead:heads.get(b.id)}:{})};
    })}));
  }
  // The part of a translation set in bold, mirroring the source emphasis.
  // Self-contained: the print window receives this function serialized.
  function emphasis(text,label){
    text=String(text||'');const mode=label===true?'field':label;let m=null;
    const prefix=/^((?:표|그림|table|fig(?:ure)?\.?)\s*[A-Z]?\d+[a-z]?[.:]?)([\s\S]*)$/i; // i18n:keep — reads a Korean caption
    if(mode==='field')m=/^([^:：\n]{1,24}[:：])([\s\S]*)$/.exec(text);
    else if(mode==='caption-sentence')m=/^((?:표|그림|table|fig(?:ure)?\.?)\s*[A-Z]?\d+[a-z]?[.:]?\s*[^.。\n]{1,200}?[.。])(\s[\s\S]*|)$/i.exec(text)||prefix.exec(text); // i18n:keep — reads a Korean caption
    else if(mode==='caption-prefix')m=prefix.exec(text);
    else if(mode==='runin')m=/^([^.。:\n]{1,30}[.。])(\s[\s\S]*|)$/.exec(text);
    return m&&m[1].trim()?[m[1],m[2]]:null;
  }
  // A paragraph broken by a column, page or figure is one sentence stream.
  // Translate the chain once (head carries flowText/flowIds) so Korean word
  // order is never cut mid-sentence, then share it back across the boxes.
  function flowChains(model,pages){
    const role=new Map(model.sections.map(s=>[s.id,s.role])),labels=pages.map(p=>p?figureLabelIds(p):new Set());
    const skip=n=>['footnote','caption','table-caption','figure-caption'].includes(n.kind)||codeLine(n)||!/\p{L}{2,}/u.test(n.text)||String(n.text).trim().length<=3||labels[n.page-1].has(n.id)||publisherMark(n,pages[n.page-1]);
    const terminal=text=>/[.!?:;。]["'”’)\]]*$/.test(text)||/[.!?]["'”’)]*\s*\[[\d,\s–-]+\]$/.test(text);
    const chains=new Map();let last=null;
    for(const n of model.nodes){
      if(role.get(n.sectionId)==='metadata')continue;
      if(skip(n))continue;
      const body=n.kind==='body'&&!formulaOnly(n);
      if(body&&last&&last.sectionId===n.sectionId){
        const a=last,end=String(a.text).trim(),start=String(n.text).trim(),size=Math.max(a.fontSize,n.fontSize);
        // A block under the paragraph's left half is its column going on, or its last words; not a sliver of its
        // width that ends no sentence: the first cells of a table under its head ("the state at point 6 of the
        // execution tree" / "node env pc").
        const broken=n.page>a.page||n.x>a.x+a.width*.5||n.x+n.width<a.x+a.width*.5&&!(n.page===a.page&&n.y>a.y&&n.width<a.width*.2&&!terminal(start))||n.y<a.y||n.y-(a.y+a.height)>a.fontSize*2;
        // Back up the same page is the next column only when it lies beside the paragraph: a slide's
        // label above a page-wide line ("learn a score, …" over "… for example MCMC") is not its end.
        if(n.page===a.page&&n.y<a.y&&n.x<a.x+a.width-a.fontSize*2){last=body?n:null;continue;}
        const head=chains.get(a.flowHead||a.id)||{ids:[],text:a.text};
        // Only prose chains: a table cell or label is never the start of one.
        const prose=a.text.split(/\s+/).length>=6&&a.width>=(pages[a.page-1]?.width||0)*.2&&start.split(/\s+/).length>=2;
        if(broken&&prose&&!terminal(end)&&(/^[a-z(]/.test(start)||/[a-z]-$/.test(end))&&Math.abs(a.fontSize-n.fontSize)<=size*.12&&Boolean(a.serif)===Boolean(n.serif)&&head.ids.length<3&&head.text.length+start.length<8000){
          const hyphen=/[a-z]-$/.test(head.text.trim());
          head.rich=(hyphen?String(head.rich??a.rich??a.text).trim().slice(0,-1):String(head.rich??a.rich??a.text)+' ')+(n.rich??n.text);
          head.ids.push(n.id);head.text=(hyphen?head.text.trim().slice(0,-1):head.text+' ')+n.text;chains.set(a.flowHead||a.id,head);
          last={...n,flowHead:a.flowHead||a.id};continue;
        }
      }
      last=body?n:null;
    }
    return chains;
  }
  // Split a chain's joined translation back over its boxes in proportion to
  // their source text. Recomputed from the raw head text every time, so a
  // re-translated head page never duplicates or drops text.
  function splitShares(text,weights){
    const total=weights.reduce((a,b)=>a+b,0)||1,parts=[];let start=0,acc=0;
    for(let i=0;i<weights.length-1;i++){
      acc+=weights[i];let cut=Math.round(text.length*acc/total);
      for(let d=0;d<=24;d++){if(/\s/.test(text[cut+d]||'')&&scriptCut(text,cut+d)){cut+=d;break;}if(cut-d>start&&/\s/.test(text[cut-d]||'')&&scriptCut(text,cut-d)){cut-=d;break;}}
      while(cut<text.length&&!scriptCut(text,cut))cut++;
      cut=Math.max(start+1,Math.min(text.length-(weights.length-1-i),cut));
      parts.push(text.slice(start,cut).trim());start=cut;
    }
    parts.push(text.slice(start).trim());
    return parts;
  }
  function applyFlow(pages){
    if(!Array.isArray(pages)||!pages.some(p=>p?.blocks?.some(b=>Array.isArray(b.flowIds)&&b.flowIds.length)))return pages;
    const out=pages.map(p=>p&&{...p,blocks:p.blocks.map(b=>({...b}))}),byId=new Map();
    for(const p of out)for(const b of p?.blocks||[])byId.set(b.id,b);
    for(const head of byId.values()){
      if(!Array.isArray(head.flowIds)||!head.flowIds.length)continue;
      const members=head.flowIds.map(id=>byId.get(id));
      if(members.some(m=>!m||m.flowHead!==head.id))continue;
      const full=String(head.flowFull??head.translation??'');
      // A member translated on its own (older cache) is never overwritten.
      if(members.some(m=>String(m.translation||'').trim()&&!m.flowShare))continue;
      if(!full.trim()){for(const m of members){m.translation='';m.flowShare=true;}continue;}
      const parts=splitShares(full,[head,...members].map(b=>String(b.text).length||1));
      head.flowFull=full;head.translation=parts[0];
      members.forEach((m,i)=>{m.translation=parts[i+1]||'…';m.flowShare=true;m.missingTranslation=false;});
    }
    return out;
  }
  // A translation identical to its source (author names, e-mail, a code)
  // needs no mask and never moves: the source stays visible in place.
  function sameAsSource(text,translation){
    const value=plainScripts(translation||'');if(!value.trim()||/[가-힣]/.test(value))return false; // i18n:keep — checks the reply is in the translation language (Korean)
    // Letters only: extraction may glue icon text or superscripts onto names
    // ("DarnellID2"); the translation's letters must appear in source order.
    const letters=t=>String(t).toLowerCase().replace(/[^\p{L}]/gu,''),source=letters(text),own=letters(value);
    let i=0;for(const c of own){i=source.indexOf(c,i);if(i<0)return false;i++;}
    return own.length>=2&&own.length>=source.length*.7;
  }
  // Non-prose items (names, e-mail, codes) translated as themselves keep
  // their source. Long prose that came back in English, or a paragraph still being
  // translated, also shows its source in place, but is never "done": it is
  // counted as untranslated, never moved below the page.
  // Table cells and listings are stored with their source as translation;
  // they are kept source, not English replies (`width` places their columns).
  function markSame(blocks,width){const cells=tableCellIds({blocks,width});return blocks.map(b=>{
    if(b.sourceOnly)return b;
    if(cells.has(b.id))return {...b,sourceOnly:true,sameAsSource:true};
    if(b.pending)return {...b,sourceOnly:true,pending:true};
    const text=String(b.text),prose=(text.match(/\p{L}{3,}/gu)||[]).length>=12&&(text.match(/\b(?:the|we|our|is|are|was|were|and|of|to|in|for|with|that|this|by|from)\b/gi)||[]).length>=4;
    // A reference entry kept in English (titles, journals) is a normal result.
    const reference=/^\s*(?:\[\d{1,3}\]|\d{1,3}\.?)\s/.test(text)&&/\b(?:19|20)\d{2}\b/.test(text);
    if(sameAsSource(b.text,b.translation))return prose&&!reference?{...b,sourceOnly:true,englishOnly:true}:{...b,sourceOnly:true,sameAsSource:true};
    // A source with at most one real word (symbols, an equation, brace
    // pieces) answered without any Korean was rewritten, not translated
    // (a model writing out the whole equation); the source stays in place.
    const reply=plainScripts(b.translation||''),words=(text.replace(/z?(?:ffl|ﬄ){2,}[}|{]*/g,' ').match(/\p{L}{3,}/gu)||[]).length;
    if(reply.trim()&&!/[가-힣]/.test(reply)&&words<=1)return {...b,sourceOnly:true,sameAsSource:true}; // i18n:keep — checks the reply is in the translation language (Korean)
    return b;
  });}
  // Extend each translation mask just far enough to cover source glyph ink
  // left outside the extracted box (tall glyphs, bold strokes, overhangs).
  // A side stops at a masked neighbour, at half the gap to a source-only one,
  // and at a strip that is mostly ink (a rule or border). Page units.
  function maskPads(page,blocks,pixels){
    if(!pixels||!page.width||!page.height)return blocks;
    const sx=pixels.width/page.width,sy=pixels.height/page.height,data=pixels.data;
    return blocks.map(b=>{
      if(b.sourceOnly)return b;
      // Ink is anything clearly darker than this box's own background, so faint
      // anti-aliased fringes (a grey dotted line on screen) are covered too.
      const background=(backgroundSample(pixels,{x:b.x*sx,y:b.y*sy,width:b.width*sx,height:b.height*sy}).color.match(/\d+/g)||[255,255,255]).map(Number).reduce((a,c)=>a+c,0)/3;
      // Coloured graphics (badges, icons, plots) are not glyph ink and stay visible.
      const ink=(x,y)=>{if(x<0||y<0||x>=pixels.width||y>=pixels.height)return false;const i=(y*pixels.width+x)*4,r=data[i],g=data[i+1],c=data[i+2];return data[i+3]>=240&&(r+g+c)/3<background-20&&Math.max(r,g,c)-Math.min(r,g,c)<=60;};
      const room={top:b.fontSize*.45,bottom:b.fontSize*.45,left:b.fontSize*.45,right:b.fontSize*.45};
      for(const n of blocks){
        if(n===b)continue;
        // Ink between two masked boxes is hidden by either mask, so the whole
        // gap is available; a source-only neighbour keeps its half visible.
        const share=n.sourceOnly?.5:1,keep=n.sourceOnly?0:.25;
        const across=n.x<b.x+b.width&&n.x+n.width>b.x,along=n.y<b.y+b.height&&n.y+n.height>b.y;
        if(across&&n.y+n.height<=b.y+1)room.top=Math.min(room.top,(b.y-n.y-n.height)*share-keep);
        if(across&&n.y>=b.y+b.height-1)room.bottom=Math.min(room.bottom,(n.y-b.y-b.height)*share-keep);
        if(along&&n.x+n.width<=b.x+1)room.left=Math.min(room.left,(b.x-n.x-n.width)*share-keep);
        if(along&&n.x>=b.x+b.width-1)room.right=Math.min(room.right,(n.x-b.x-b.width)*share-keep);
      }
      const x0=Math.floor(b.x*sx),x1=Math.ceil((b.x+b.width)*sx),y0=Math.floor(b.y*sy),y1=Math.ceil((b.y+b.height)*sy);
      // One page unit past the last ink (and as a base margin) keeps the mask
      // edge, which falls on a fractional screen pixel, clear of the fringe.
      // Nothing, not even the base margin, crosses a rule or border strip.
      const reach=(limit,scale,strip)=>{let found=0,cap=limit;for(let d=1;d<=Math.floor(Math.max(0,limit)*scale);d++){const [hits,count]=strip(d);if(count&&hits/count>.6){cap=(d-1)/scale;break;}if(hits)found=d;}return Math.max(0,Math.min(cap,found?found/scale+1:1));};
      const row=y=>{let hits=0;for(let x=x0;x<x1;x++)hits+=ink(x,y);return [hits,x1-x0];},column=x=>{let hits=0;for(let y=y0;y<y1;y++)hits+=ink(x,y);return [hits,y1-y0];};
      // A side grown into verified blank space ends in it: ink beyond that
      // edge is something else (an equation drawn below), not an overhang.
      // Left and top keep the overhang search even when grown: ink just past
      // them may be the text's own (a tall glyph), and a rule stops the search.
      const pad={top:reach(room.top,sy,d=>row(y0-d)),bottom:b.grown?.bottom?Math.min(1,Math.max(0,room.bottom)):reach(room.bottom,sy,d=>row(y1-1+d)),left:reach(room.left,sx,d=>column(x0-d)),right:b.grown?.right?Math.min(1,Math.max(0,room.right)):reach(room.right,sx,d=>column(x1-1+d))};
      return pad.top||pad.bottom||pad.left||pad.right?{...b,maskPad:pad}:b;
    });
  }
  // ---- Citations: the reference list and the citations in the text ----
  // Entries come from the section titled References (Bibliography, Literature
  // cited, 참고문헌), one per block, with the number a numbered list gives and
  // the first author's surname and year an author-year list gives.
  const plainName=name=>String(name||'').normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[’'`]/g,'');
  function referenceEntry(text){
    const t=String(text).trim(),number=/^\s*\[?(\d{1,3})[\].]\s/.exec(t),year=/\b(1[89]\d{2}|20\d{2})([a-z]?)\b/.exec(t);
    const body=number?t.slice(number[0].length):t,surname=/^\s*(?:(?:van|von|de|der|den|la|le|di|da)\s+)*([\p{Lu}][\p{L}’'\-]+)/u.exec(body);
    return {number:number?Number(number[1]):null,surname:surname?plainName(surname[1]):null,year:year?year[1]+year[2]:null};
  }
  function citationIndex(pages){
    const entries=[],byNumber=new Map(),byAuthorYear=new Map();
    pages.forEach((page,index)=>{for(const b of page?.blocks||[]){
      if(!/reference|bibliograph|literature cited|참고\s*문헌/i.test(b.sectionTitle||'')||/^(?:\d+\.?\s*)?(?:references?|bibliography|literature cited|참고\s*문헌)\s*$/i.test(b.text.trim()))continue; // i18n:keep — reads a Korean heading
      const entry={id:b.id,page:index+1,x:b.x,y:b.y,text:b.text,...referenceEntry(b.text)};
      if(!entry.number&&!(entry.surname&&entry.year))continue;
      entries.push(entry);
      if(entry.number&&!byNumber.has(entry.number))byNumber.set(entry.number,entry);
      if(entry.surname&&entry.year){const key=entry.surname+'|'+entry.year;if(!byAuthorYear.has(key))byAuthorYear.set(key,entry);}
    }});
    return {entries,byNumber,byAuthorYear};
  }
  // Citations in a piece of text with their positions: "[12]", "[3–5, 8]",
  // "(Kim et al., 2020; Park and Lee, 2019a)", "Kim et al. (2020)". Each has
  // the numbers or author-year keys it names; resolving them is the index's job.
  function citationsIn(text){
    const out=[],t=String(text||'');
    for(const m of t.matchAll(/\[(\d{1,3}(?:\s*[–—-]\s*\d{1,3})?(?:\s*[,;]\s*\d{1,3}(?:\s*[–—-]\s*\d{1,3})?)*)\]/g)){
      const numbers=[];for(const part of m[1].split(/[,;]/)){const [a,b]=part.split(/[–—-]/).map(n=>Number(n.trim()));if(b&&b>=a&&b-a<=50)for(let n=a;n<=b;n++)numbers.push(n);else numbers.push(a);}
      out.push({start:m.index,end:m.index+m[0].length,numbers});
    }
    const name="[\\p{Lu}][\\p{L}’'\\-]+(?:\\s+(?:et\\s+al\\.?|(?:and|&)\\s+[\\p{Lu}][\\p{L}’'\\-]+))?";
    for(const m of t.matchAll(new RegExp(`(${name}),?\\s*(\\(?)((?:1[89]|20)\\d{2}[a-z]?)\\)?`,'gu'))){
      const surname=/^(?:(?:van|von|de|der|den|la|le|di|da)\s+)*([\p{Lu}][\p{L}’'\-]+)/u.exec(m[1]);if(!surname||/^(?:In|The|This|Table|Fig|Figure|Section|Eq|Equation|Appendix)$/.test(surname[1]))continue;
      out.push({start:m.index,end:m.index+m[0].length,keys:[plainName(surname[1])+'|'+m[3]]});
    }
    return out.sort((a,b)=>a.start-b.start);
  }
  // The entries a citation names, through the index.
  function resolveCitation(index,citation){
    const found=citation.numbers?citation.numbers.map(n=>index.byNumber.get(n)):citation.keys.map(k=>index.byAuthorYear.get(k));
    return found.filter(Boolean);
  }
  // A stray accent, prime or subscript extracted as its own source-only
  // fragment inside a paragraph is part of that paragraph, not a neighbour.
  // Subscripts ("k,r", "batch") are smaller than the paragraph's text; a
  // full-size formula inside a paragraph still keeps the source visible.
  // So is a script-sized label of a word or two ("deepest", "train").
  function scriptFragment(f,p){
    const t=String(f.text).trim();
    // An accented capital may come apart at a paragraph's start ("Ü" as "U" + "¨").
    const initial=/^\p{Lu}$/u.test(t)&&f.x>=p.x-p.fontSize&&f.x<=p.x+p.fontSize&&f.y<=p.y+p.fontSize*.5;
    // An inline operator or radical drawn apart (∑, √̅, ")T") is part of the line it sits in.
    const operator=t.length<=12&&!/\p{L}{3,}/u.test(t)&&formulaLike(t)&&f.width*f.height<=p.width*p.height*.03;
    // So is any single glyph inside the box, whatever it reads as: a math
    // extension font without a Unicode map sets a text-size ∑ as "P" (∏ "Q",
    // ∫ "R"), raised off the line, at the paragraph's own type size.
    const glyph=/^\S$/u.test(t)&&f.width<=Math.max(f.fontSize,p.fontSize)*1.6&&f.width*f.height<=p.width*p.height*.03;
    const small=initial||operator||glyph||/^[\p{M}\p{Sk}\p{Lm}′″‴'"`´~.·]{1,3}$/u.test(t)||t.length<=12&&!/\p{L}{3,}/u.test(t)&&f.fontSize<=p.fontSize*.8||t.length<=20&&t.split(/\s+/).length<=3&&f.fontSize<=p.fontSize*.85;
    return f.sourceOnly&&!p.sourceOnly&&small&&f.width*f.height<=p.width*p.height*.1&&(initial||f.x>=p.x-2)&&f.y>=p.y-2&&f.x+f.width<=p.x+p.width+2&&f.y+f.height<=p.y+p.height+2;
  }
  // A block kept as source (a formula, code) of a few rows has a box around
  // all of them; text set in that box's blank corner ("h0 = 1 − 2θ1θ3/3θ2²." |
  // "The relationship between them", a short code line | "# its comment")
  // meets none of its rows and is not covered by it.
  // A short piece kept as drawn (the "]ᵀ" of inline math, an equation's "(8)" the tool set
  // apart) lying inside a paragraph's box: the paragraph is translated in place over it,
  // rather than left whole as its source for a few glyphs.
  function strayPiece(f,p,shared){
    // An equation set between a paragraph's lines stays visible, however short ("x = y + 1").
    if(f.kind==='formula'||/[=≤≥<>≈∑∫]/.test(f.text))return false;
    return Boolean(f.sourceOnly)&&!p.sourceOnly&&String(f.text).trim().length<=14&&f.height<=p.fontSize*1.8&&p.height>=p.fontSize*1.8&&shared>=f.width*f.height*.6&&f.width*f.height<=p.width*p.height*.1;
  }
  function besideRows(f,t){
    if(!f.sourceOnly||t.sourceOnly||!Array.isArray(f.rows)||f.rows.length<2)return false;
    // Rows are clipped to the block's box as trimmed against its neighbours.
    return !f.rows.some(([x,y,w,h])=>{const left=Math.max(x,f.x),top=Math.max(y,f.y),right=Math.min(x+w,f.x+f.width),bottom=Math.min(y+h,f.y+f.height);return Math.min(right,t.x+t.width)-Math.max(left,t.x)>2&&Math.min(bottom,t.y+t.height)-Math.max(top,t.y)>2;});
  }
  // The set's `partners` names, for each colliding block, what it met and by
  // how much, so an audit report can point at the rule to change.
  function layoutCollisions(blocks){
    const ids=new Set(),partners=new Map(),box=b=>[b.x,b.y,b.width,b.height].map(v=>Math.round(v*10)/10);
    const note=(a,b,width,height)=>{if(a.sourceOnly)return;if(!partners.has(a.id))partners.set(a.id,[]);partners.get(a.id).push({id:b.id,text:String(b.text).slice(0,40),sourceOnly:Boolean(b.sourceOnly),overlap:[Math.round(width*10)/10,Math.round(height*10)/10],box:box(a),with:box(b)});};
    for(let i=0;i<blocks.length;i++)for(let j=i+1;j<blocks.length;j++){
      const a=blocks[i],b=blocks[j];if(a.sourceOnly&&b.sourceOnly)continue;
      const width=Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x),height=Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y);
      if(width>2&&height>2&&!scriptFragment(a,b)&&!scriptFragment(b,a)&&!besideRows(a,b)&&!besideRows(b,a)&&!strayPiece(a,b,width*height)&&!strayPiece(b,a,width*height)){if(!a.sourceOnly)ids.add(a.id);if(!b.sourceOnly)ids.add(b.id);note(a,b,width,height);note(b,a,width,height);}
    }
    ids.partners=partners;
    return ids;
  }
  // A paragraph that meets another block is not left whole as its source where room can be
  // made: the place of the other block (an equation between its lines, a piece of inline
  // math, a label) is left open, and the translation is set around it. For two translated
  // paragraphs the larger one makes room for the smaller. The Map names, for each colliding
  // block that can be set this way, the rectangles to leave open (in the block's own
  // coordinates; none for the smaller of a pair). A block is left out, and kept as its
  // source as before, when over two fifths of it would be left open (the translation would no
  // longer fit what is left), when it needs more than four
  // openings, when its place among today's paragraphs is uncertain, or when the paragraph
  // that should make room for it cannot.
  function collisionHoles(blocks,collisions){
    const out=new Map(),byId=new Map(blocks.map(b=>[b.id,b])),order=new Map(blocks.map((b,i)=>[b.id,i])),area=b=>b.width*b.height,waits=new Map();
    const yields=(a,b)=>area(a)>area(b)||area(a)===area(b)&&order.get(a.id)>order.get(b.id);
    for(const id of collisions||[]){
      const b=byId.get(id);if(!b||b.sourceOnly||b.mappingUncertain)continue;
      const rects=[],needs=[];let ok=true;
      for(const p of collisions.partners?.get(id)||[]){
        const o=byId.get(p.id);if(!o||o.mappingUncertain){ok=false;break;}
        if(!o.sourceOnly&&!yields(b,o)){needs.push(o.id);continue;}
        let x0=Math.max(b.x,o.x-2),y0=Math.max(b.y,o.y-1),x1=Math.min(b.x+b.width,o.x+o.width+2),y1=Math.min(b.y+b.height,o.y+o.height+1);
        // An equation takes its rows whole: what the paragraph holds beside it on those rows is
        // the equation's own (its left side, a fraction's parts), and stays as drawn. With no
        // full line of text between it and the paragraph's top or bottom, it takes those rows too.
        if(o.sourceOnly&&(o.kind==='formula'||formulaOnly(o)||/[=≤≥<>≈∑∫]/.test(o.text))){
          // A short piece of inline math is no such equation: its box takes in the words beside
          // it, and opened, it would show half of them. The paragraph stays as its source.
          // (At the paragraph's side edge, over a fifth of its width or less, there are no such
          // words: a fraction set beside "– Note." on a slide. Its place alone is left open.)
          const strip=Math.min(b.x+b.width,o.x+o.width)-Math.max(b.x,o.x),atEdge=o.x+o.width>=b.x+b.width-1||o.x<=b.x+1;
          if(o.width<b.width*.4&&atEdge&&strip<=b.width*.2){rects.push({x:x0-b.x,y:y0-b.y,width:x1-x0,height:y1-y0});continue;}
          if(o.width<b.width*.4){ok=false;break;}
          const line=b.fontSize*1.3;x0=b.x;x1=b.x+b.width;
          if(y0-b.y<=line*1.2){y0=b.y;y1=Math.min(b.y+b.height,y1+line*.5);}
          if(b.y+b.height-y1<=line*1.2){y1=b.y+b.height;y0=Math.max(b.y,y0-line*.5);}
        }
        if(x1>x0&&y1>y0)rects.push({x:x0-b.x,y:y0-b.y,width:x1-x0,height:y1-y0});
      }
      if(!ok)continue;
      const floats=holeFloats(rects,b.width),open=floats.reduce((n,f)=>n+f.width*f.height,0);
      if(floats.length>4||open>area(b)*.4)continue;
      out.set(id,rects);waits.set(id,needs);
    }
    // The smaller of a pair stands only if the larger one makes room.
    for(let changed=true;changed;){changed=false;for(const [id,needs] of waits)if(out.has(id)&&needs.some(n=>!out.has(n))){out.delete(id);changed=true;}}
    return out;
  }
  // The openings as the text is set around them: from top to bottom, each a gap of clear
  // text and then a box at the left or right edge (the whole width where the opening spans
  // the block or sits in its middle). Openings that share lines become one.
  function holeFloats(rects,width){
    const bands=[];
    for(const r of [...rects].sort((a,b)=>a.y-b.y)){
      const last=bands.at(-1);
      if(last&&r.y<last.y+last.height){const x=Math.min(last.x,r.x),right=Math.max(last.x+last.width,r.x+r.width),bottom=Math.max(last.y+last.height,r.y+r.height);Object.assign(last,{x,width:right-x,height:bottom-last.y});}
      else bands.push({...r});
    }
    let top=0;
    return bands.map(r=>{
      const gap=Math.max(0,r.y-top);top=r.y+r.height;
      const left=r.x<=width*.15,right=r.x+r.width>=width*.85;
      const side=left&&right||!left&&!right?'left':left?'left':'right';
      return {side,gap,height:r.height,width:Math.round((left&&right||!left&&!right?width:left?r.x+r.width:width-r.x)*10)/10};
    });
  }
  // The block's mask (its box grown by its pads) with the openings cut out, as a clip path.
  function holeClip(rects,width,height,pad={}){
    const n=v=>Math.round(v*10)/10,t=-(pad.top||0),r=width+(pad.right||0),b=height+(pad.bottom||0),l=-(pad.left||0);
    return `path(evenodd,'M${n(l)} ${n(t)}H${n(r)}V${n(b)}H${n(l)}Z${rects.map(q=>`M${n(q.x)} ${n(q.y)}H${n(q.x+q.width)}V${n(q.y+q.height)}H${n(q.x)}Z`).join('')}')`;
  }
  // The last word on masks, once every block's fate is known (translated,
  // kept as source): a translated block's mask, its box grown by maskPad,
  // never covers another block's box. Where it would, the pad on the side
  // that clears that box with the least change is cut back. Boxes that
  // overlap each other are layoutCollisions' business, not the mask's.
  function settleMasks(blocks){
    return blocks.map(b=>{
      if(b.sourceOnly||b.preserveSource||!b.maskPad)return b;
      const pad={...b.maskPad};let changed=false;
      for(const n of blocks){
        if(n===b||scriptFragment(n,b))continue;
        const w=Math.min(b.x+b.width+pad.right,n.x+n.width)-Math.max(b.x-pad.left,n.x),h=Math.min(b.y+b.height+pad.bottom,n.y+n.height)-Math.max(b.y-pad.top,n.y);
        if(w<=.5||h<=.5)continue;
        const room={top:b.y-(n.y+n.height),bottom:n.y-(b.y+b.height),left:b.x-(n.x+n.width),right:n.x-(b.x+b.width)};
        const side=Object.keys(room).filter(k=>room[k]>=0&&pad[k]>room[k]).sort((x,y)=>(pad[x]-room[x])-(pad[y]-room[y]))[0];
        if(side){pad[side]=Math.max(0,room[side]-.5);changed=true;}
      }
      return changed?{...b,maskPad:pad}:b;
    });
  }
  function normalizeParagraph(text){return repairGlyphs(text.replace(/[ﬀ-ﬄ]/g,c=>c.normalize('NFKC')).replace(/([a-z])-\s*\n\s*([a-z])/g,'$1$2').replace(/\s+/g,' ').trim());}

  // The warnings a translation saves stay Korean, so its record and hash do not depend on the screen. This names a
  // known one on the screen (tr) or, given a language, in a saved PDF (trIn); any other text stays as written.
  function warningText(text,language){
    const t=String(text),m=/^번역 응답을 확인하지 못한 문단입니다\((.*)\)\. 이 페이지를 다시 번역하세요\.$/.exec(t),list=/^숫자·인용 확인: ([\s\S]*)$/.exec(t); // i18n:keep — reads the Korean warnings saved with a translation
    const pick=(shown,saved)=>language?saved():shown();
    if(t==='수식 포함 영역은 원문으로 보존했습니다.')return pick(()=>tr('수식 포함 영역은 원문으로 보존했습니다.'),()=>trIn(language,'수식 포함 영역은 원문으로 보존했습니다.')); // i18n:keep — the saved warning it names
    if(t==='수식이 포함된 문단입니다. 원문을 보존하고 번역은 섹션 보기와 PDF 연속 페이지에 표시합니다.')return pick(()=>tr('수식이 포함된 문단입니다. 원문을 보존하고 번역은 섹션 보기와 PDF 연속 페이지에 표시합니다.'),()=>trIn(language,'수식이 포함된 문단입니다. 원문을 보존하고 번역은 섹션 보기와 PDF 연속 페이지에 표시합니다.')); // i18n:keep — the saved warning it names
    if(t==='수식 표기 확인 필요')return pick(()=>tr('수식 표기 확인 필요'),()=>trIn(language,'수식 표기 확인 필요')); // i18n:keep — the saved warning it names
    if(t==='이전 번역에 누락된 문단입니다. 이 페이지를 다시 번역하세요.')return pick(()=>tr('이전 번역에 누락된 문단입니다. 이 페이지를 다시 번역하세요.'),()=>trIn(language,'이전 번역에 누락된 문단입니다. 이 페이지를 다시 번역하세요.')); // i18n:keep — the saved warning it names
    if(list)return language?trIn(language,'숫자·인용 확인: {list}',{list:list[1]}):tr('숫자·인용 확인: {list}',{list:list[1]});
    if(m){const reason={'응답 누락':()=>language?trIn(language,'응답 누락'):tr('응답 누락'),'영문 응답':()=>language?trIn(language,'영문 응답'):tr('영문 응답'),'수식 표시 누락':()=>language?trIn(language,'수식 표시 누락'):tr('수식 표시 누락'),'응답 형식 오류':()=>language?trIn(language,'응답 형식 오류'):tr('응답 형식 오류')}[m[1]]?.()??m[1]; // i18n:keep — the saved reasons it names
      return language?trIn(language,'번역 응답을 확인하지 못한 문단입니다({reason}). 이 페이지를 다시 번역하세요.',{reason}):tr('번역 응답을 확인하지 못한 문단입니다({reason}). 이 페이지를 다시 번역하세요.',{reason});}
    return t;
  }
  const api={warningText,collisionHoles,holeFloats,holeClip,bibliographyEntry,ocrRuns,GRAPHIC,graphicToken,graphicSpans,TAIL_FIT,HARD_FIT,tableCellIds,escapeHtml,splitPoints,scriptTokens,plainScripts,richHtml,scriptCut,repairMath,hangingLine,listItemStart,paragraphStart,runInHeading,repairPages,repairGlyphs,markSame,sameAsSource,maskPads,settleMasks,citationIndex,citationsIn,resolveCitation,figureTop,MIN_FIT_LINE,emphasis,flowChains,splitShares,applyFlow,figureLabelIds,mathDense,sentenceLine,lightMath,MIN_FIT,fitScale,paragraphStyle,fieldLabel,mathSpans,publisherMark,sectionHeading,structureTranslationPages,translationFontSize,expandLayoutBlocks,backgroundColor,backgroundSample,formulaLike,layoutBlocks,columnGutters,textLines,paragraphs,reconcilePage,sectionDocument,sourceKey,layoutCollisions,normalizeParagraph,formulaOnly,typography,typographyRole,pageTypography,typographyCss};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.appPdfLayout=api;
})(globalThis);
