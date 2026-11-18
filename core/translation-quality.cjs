// Heuristics flag possible omissions for review; they do not certify translation quality. The warnings are
// saved with the translation in Korean whatever the screen, so the record and its hash stay the same; the
// screen and a saved PDF name them through pdf-layout warningText().
function reviewTranslation(original,translation){
 // Subscript/superscript tags are markup, not text ("OD<sub>600</sub>" reads OD600).
 const plain=text=>String(text??'').replace(/<\/?(?:sub|sup)>/g,'');original=plain(original);translation=plain(translation);
 const numbers=text=>[...text.normalize('NFKC').replace(/−/g,'-').matchAll(/(?<![\p{L}\p{N}])[-+]?\d+(?:[.,]\d+)*(?:[eE][+-]?\d+)?%?/gu)].map(m=>m[0]);
 // In Korean a number may follow a letter ("제19권", "약5배"); in the source it may not ("P2", "A362T").
 const translated=text=>[...text.normalize('NFKC').replace(/−/g,'-').matchAll(/(?<![A-Za-z\p{N}])[-+]?\d+(?:[.,]\d+)*(?:[eE][+-]?\d+)?%?/gu)].map(m=>m[0]);
 const remaining=new Map();for(const value of translated(translation))remaining.set(value,(remaining.get(value)||0)+1);
 const missing=[];for(const value of numbers(original)){if(remaining.get(value))remaining.set(value,remaining.get(value)-1);else missing.push(value);}
 const warnings=[];if(missing.length)warnings.push('숫자·인용 확인: '+[...new Set(missing)].slice(0,12).join(', ')); // i18n:keep — the warning saved with the translation is Korean whatever the screen (pdf-layout warningText names it)
 const equations=[...original.matchAll(/\$[^$\n]+\$/g)].map(m=>m[0]);if(equations.some(eq=>!translation.includes(eq)))warnings.push('수식 표기 확인 필요'); // i18n:keep — the warning saved with the translation is Korean whatever the screen (pdf-layout warningText names it)
 return warnings;
}
module.exports={reviewTranslation};
