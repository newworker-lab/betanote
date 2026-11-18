// What a translation is made of, apart from where it runs: the checks on pages and replies, the
// protection of formulas, the split of a page into requests and their cache keys, and the page a
// translation is printed from. Nothing here reads a file, opens a connection or needs Node or
// Electron (tests/core-boundary.test.cjs); desktop/translation.cjs runs the jobs around it.
const {warningText,escapeHtml,plainScripts,richHtml,emphasis,mathSpans,graphicSpans,translationFontSize,formulaOnly,layoutBlocks,pageTypography,typographyCss,sectionDocument,holeFloats,holeClip}=require('./pdf-layout.js');
const {sha256}=require('./sha256.cjs');
const {tr,trIn}=require('./i18n.js');
// Built once: a segmenter per block cost thousands of instances per paper.
const sentenceSegmenter = new Intl.Segmenter('en', {granularity:'sentence'});
// Paragraph chains across columns/pages: the head carries the joined source
// text and member IDs; members point back at their head.
function flowFields(b){
  const out={};
  if(Array.isArray(b.flowIds)&&b.flowIds.length&&b.flowIds.length<=3&&b.flowIds.every(id=>typeof id==='string'&&id.length<=100&&id!==b.id)&&typeof b.flowText==='string'&&b.flowText.length<=24000)Object.assign(out,{flowIds:[...b.flowIds],flowText:b.flowText,...(typeof b.flowRich==='string'&&b.flowRich.length<=30000?{flowRich:b.flowRich}:{})});
  if(typeof b.flowHead==='string'&&b.flowHead.length<=100&&b.flowHead!==b.id)out.flowHead=b.flowHead;
  return out;
}
const labelValue=label=>label===true?'field':['field','caption-sentence','caption-prefix','runin'].includes(label)?label:false;
function validatePages(pages, allowEmpty = false) {
  if (!Array.isArray(pages) || !pages.length || pages.length > 500) throw Error(tr('1~500페이지 PDF만 번역할 수 있습니다.'));
  const ids = new Set(); let length = 0;
  for (const page of pages) {
    if (![page.width, page.height].every(n => Number.isFinite(n) && n > 0 && n < 20000) || !Array.isArray(page.blocks) || page.blocks.length > 10000) throw Error(tr('PDF 페이지 정보를 확인할 수 없습니다.'));
    for (const b of page.blocks) {
      if (typeof b.id !== 'string' || ids.has(b.id) || typeof b.text !== 'string' || b.text.length > 12000 || ![b.x,b.y,b.width,b.height,b.fontSize].every(Number.isFinite) || b.x < -10 || b.y < -10 || b.width <= 0 || b.height <= 0 || b.fontSize <= 0 || b.x + b.width > page.width + 20 || b.y + b.height > page.height + 20) throw Error(tr('PDF 문단 정보가 올바르지 않습니다.'));
      ids.add(b.id); length += b.text.length;
    }
  }
  if (!length && !allowEmpty) throw Error(tr('이 PDF에서 텍스트를 추출하지 못했습니다.'));
  if (length > 1500000) throw Error(tr('자료 본문이 번역 가능한 크기를 초과했습니다.'));
  return pages.map(p => ({ width:p.width, height:p.height, blocks:p.blocks.map(b => ({ id:b.id,text:b.text,...(typeof b.rich==='string'&&b.rich.length<=15000&&plainScripts(b.rich).length<=12000?{rich:b.rich}:{}),x:b.x,y:b.y,width:b.width,height:b.height,fontSize:b.fontSize,sectionId:String(b.sectionId||'').slice(0,100),sectionTitle:String(b.sectionTitle||'').slice(0,250),sectionContext:String(b.sectionContext||'').slice(0,3200),kind:['title','heading','subheading','caption','table-caption','figure-caption','table','annotation','metadata','footnote','body','formula'].includes(b.kind)?b.kind:'body', ...(b.keepSource===true?{keepSource:true}:{}), ...flowFields(b) })) }));
}
const {PROMPT_VERSION,DEFAULT_LANGUAGE,languageProfile}=require('./translation-policy.cjs');
// The language translations are written in (translation-policy.cjs LANGUAGES).
const TARGET=languageProfile(DEFAULT_LANGUAGE);
// Reference images of one translation: PNG data URLs, at most 3 of about 4 MB each.
const referenceImages=list=>(Array.isArray(list)?list:[]).filter(v=>typeof v==='string'&&v.length<=4_500_000&&/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(v)).slice(0,3);
// Cache keys: the SHA-256 of the value as JSON (the same keys Node's crypto gave).
const digest = value => sha256(JSON.stringify(value));
const englishProse=text=>(text.match(/\p{L}{3,}/gu)||[]).length>=12&&(text.match(/\b(?:the|we|our|is|are|was|were|and|of|to|in|for|with|that|this|by|from)\b/gi)||[]).length>=4;
// Why a reply failed validation, for the job's counts, the untranslated
// paragraph's notice and the audit.
const MISSING_REASONS={missing:'응답 누락',english:'영문 응답',math:'수식 표시 누락',format:'응답 형식 오류'}; // i18n:keep — the warning saved with the translation is Korean whatever the screen (pdf-layout warningText names it)
// The kind travels on the error, so no branch reads the message's wording.
const replyError=(message,kind)=>Object.assign(Error(message),{code:'APP_REPLY_INVALID',kind});
function invalidKind(error){return ['missing','english','math','format'].includes(error?.kind)?error.kind:'format';}
function checkResult(blocks, result, context = {}) {
  const expected = new Set(blocks.map(b => b.id));
  if (!Array.isArray(result) || result.length !== blocks.length || result.some(b => !b || !expected.delete(b.id) || typeof b.text !== 'string' || !b.text.trim())) throw replyError(tr('번역 결과에 누락 또는 중복 문단이 있습니다.'),'missing');
  const originals=new Map(blocks.map(b=>[b.id,b.text]));
  for(const reply of result)checkReply(originals.get(reply.id),reply.text,context);
  return result.map(b => ({ id:b.id, text:b.text }));
}
// One paragraph's reply: present, and not the English source handed back.
function checkReply(source,text,context={}){
  if(typeof text!=='string'||!text.trim())throw replyError(tr('번역 결과에 누락 또는 중복 문단이 있습니다.'),'missing');
  const references=/reference|bibliograph|참고\s*문헌/i.test(String(context.sectionTitle||'')); // i18n:keep — reads Korean in the text
  const original=plainScripts(source),reply=plainScripts(text),normalize=value=>value.replace(/\s+/g,' ').trim();
  // The reader's requests may ask to leave text untranslated: the source given back is then the answer.
  if((context.userRules||context.referenceImages?.length)&&normalize(original)===normalize(reply))return;
  if(normalize(original)===normalize(reply)&&!/[가-힣]/.test(original)&&original.split(/\s+/).length>=8&&/[.!?]$/.test(original.trim())&&/\b(?:we|our|is|are|was|were|shows?|observed|found)\b/i.test(original))throw replyError(tr('번역 결과 형식이 잘못됐습니다. 본문이 원문 그대로 반환됐습니다.'),'english'); // i18n:keep — reads Korean in the text
  // A reply that keeps long prose in English (most words copied, no Hangul)
  // is not a translation either; a reference list legitimately stays English.
  if(!references&&!TARGET.written(reply)&&englishProse(original)){const words=new Set(original.toLowerCase().match(/\p{L}{3,}/gu)||[]),copied=(reply.toLowerCase().match(/\p{L}{3,}/gu)||[]).filter(w=>words.has(w)).length;if(copied>=words.size*.6)throw replyError(tr('번역 결과 형식이 잘못됐습니다. 본문이 원문 그대로 반환됐습니다.'),'english');}
}
function protectedSpans(text){return [...mathSpans(text),...graphicSpans(text)].sort((a,b)=>a.index-b.index);}
function protectMath(block){
  let prefix='PAPINOTE_MATH_'+digest([block.id,block.text]).slice(0,12)+'_';
  while(block.text.includes(prefix))prefix+='X';
  // Math drawn as graphics travels as its placeholder (⟦g:…⟧), protected the same way.
  const math=protectedSpans(block.text).map((m,i)=>({...m,token:prefix+i+'_END'}));let text=block.text;
  for(const m of [...math].reverse())text=text.slice(0,m.index)+' '+m.token+' '+text.slice(m.index+m.text.length);
  return {text,math};
}
function restoreMath(task,result){
  return result.map(block=>({...block,text:restoreUnit(task.units.find(u=>u.id===block.id),block.text)}));
}
// Each protected formula's marker is put back. A marker the model dropped is
// accepted only when the formula itself came back verbatim, once.
function restoreUnit(unit,text){
  for(const m of unit.math){
    const marks=text.split(m.token).length-1;
    if(marks===1){text=text.replace(m.token,()=>m.text);continue;}
    if(!marks&&text.split(m.text).length===2)continue;
    throw replyError(tr('번역 결과 형식이 잘못됐습니다. 원문 수식 식별자가 누락 또는 중복됐습니다.'),'math');
  }
  return text;
}
function checkCachedMath(task,result){
  for(const block of result){
    const expected=task.units.find(u=>u.id===block.id).math.map(m=>m.text).sort();
    if(expected.length&&JSON.stringify(protectedSpans(block.text).map(m=>m.text).sort())!==JSON.stringify(expected))throw replyError(tr('캐시의 원문 수식이 일치하지 않습니다.'),'math');
  }
  return result;
}
// connection: named in the keys when given. The first connection there was is not named, so
// caches written before connections existed still match (desktop/translation.cjs decides).
function pageChunks(page, context, model, hash, connection) {
  const units = [];
  for (const block of layoutBlocks(page)) {
    // A chain member is translated as part of its head's joined text.
    if(block.sourceOnly||block.flowHead)continue;
    // Split long paragraphs at sentence boundaries; keep a mapping to the PDF block.
    // The marked text (<sub>/<sup>) lets the translation keep subscripts.
    const protectedInput=protectMath({...block,text:block.flowText?(block.flowRich||block.flowText):(block.rich||block.text)});
    const sentences = [...sentenceSegmenter.segment(protectedInput.text)].map(s=>s.segment);
    const parts = []; let part = '';
    for (let sentence of sentences) {
      while (sentence.length > 1600) { if(part){parts.push(part);part='';}let end=sentence.lastIndexOf(' ',1600);if(end<1000)end=1600;parts.push(sentence.slice(0,end));sentence=sentence.slice(end); }
      if (part.length + sentence.length > 1600) { parts.push(part);part=''; }
      part += sentence;
    }
    if(part.trim())parts.push(part);
    parts.forEach((text,i)=>units.push({id:`${block.id}:s${i}`,text,blockId:block.id,sectionId:block.sectionId,sectionTitle:block.sectionTitle,sectionContext:block.sectionContext,math:protectedInput.math.filter(m=>text.includes(m.token))}));
  }
  const chunks=[],chunkConnection=connection?{connection}:{};let blocks=[],size=0,offset=0;
  const flush=()=>{
    if(!blocks.length)return;
    const input=blocks.map(({id,text})=>({id,text}));
    // Local neighbours are stable even when the user starts at a different page.
    const chunkContext={...context,sectionTitle:units[offset].sectionTitle||context.title,sectionText:units[offset].sectionContext||'',previous:offset&&units[offset-1].sectionId===units[offset].sectionId?units[offset-1].text.slice(-600):context.previous,next:units[offset+blocks.length]?.sectionId===units[offset].sectionId?units[offset+blocks.length]?.text.slice(0,600):context.next};
    chunks.push({blocks:input,units:blocks,key:digest({hash,model,prompt:PROMPT_VERSION,language:TARGET.code,context:chunkContext,blocks:input,...chunkConnection}),context:chunkContext});
    offset+=blocks.length;blocks=[];size=0;
  };
  // Smaller requests run in parallel and return sooner; a section still never mixes.
  for(const unit of units){if(blocks.length&&(unit.sectionId!==blocks[0].sectionId||size+unit.text.length>2000||blocks.length>=16))flush();blocks.push(unit);size+=unit.text.length;}flush();return chunks;
}
// Places a block leaves open for another block (pdf-layout collisionHoles), checked: at most
// eight rectangles inside the block's own box.
function holeList(block){
  const list=block.holes;if(!Array.isArray(list)||!list.length||list.length>8||block.sourceOnly||block.preserveSource)return null;
  const ok=list.every(h=>h&&[h.x,h.y,h.width,h.height].every(Number.isFinite)&&h.x>=-1&&h.y>=-1&&h.width>0&&h.height>0&&h.x+h.width<=block.width+1&&h.y+h.height<=block.height+1);
  return ok?list.map(h=>({x:h.x,y:h.y,width:h.width,height:h.height})):null;
}
// The places of the list items a block takes in (pdf-layout reconcilePage), checked: at most sixty,
// each a start within the box, a gap above it and a hanging indent.
function itemList(block){
  const list=block.items;if(!Array.isArray(list)||list.length<2||list.length>60)return null;
  const ok=list.every(t=>t&&[t.dx,t.gap,t.hang].every(Number.isFinite)&&t.dx>=-2&&t.dx<=block.width&&t.gap>=0&&t.gap<=block.height&&t.hang>=0&&t.hang<200);
  return ok?list.map(t=>({dx:t.dx,gap:t.gap,hang:t.hang,bullet:t.bullet===true})):null;
}
function applyLayoutPlan(pages,plan){
  if(!Array.isArray(plan)||plan.length!==pages.length)throw Error(tr('PDF 표시 배치를 확인하세요.'));
  return plan.map((page,index)=>{
    const original=pages[index],byId=new Map(original.blocks.map(b=>[b.id,b])),seen=new Set();
    if(page.width!==original.width||page.height!==original.height||!Array.isArray(page.blocks))throw Error(tr('PDF 표시 크기가 원문과 다릅니다.'));
    const blocks=page.blocks.map(block=>{
      if(!Array.isArray(block.sourceIds)||!block.sourceIds.length||new Set(block.sourceIds).size!==block.sourceIds.length||block.sourceIds.some(id=>!byId.has(id)||seen.has(id)))throw Error(tr('PDF 문단 대응을 확인하세요.'));
      const parts=block.sourceIds.map(id=>{seen.add(id);return byId.get(id);});
      for(const colour of [block.backgroundColor,block.inkColor])if(colour){const rgb=/^rgb\((\d{1,3}), (\d{1,3}), (\d{1,3})\)$/.exec(colour);if(!rgb||rgb.slice(1).some(n=>Number(n)>255))throw Error(tr('PDF 배경색을 확인하세요.'));}
      return {id:parts[0].id,text:parts.map(b=>b.text).join(' '),translation:parts.map(b=>b.translation||'').join(' '),x:block.x,y:block.y,width:block.width,height:block.height,fontSize:block.fontSize,kind:block.kind,serif:Boolean(block.serif),align:block.align==='justify'?'justify':'start',label:labelValue(block.label),heavy:Boolean(block.heavy),...(Number.isFinite(block.linePitch)&&block.linePitch>0&&block.linePitch<1000?{linePitch:block.linePitch}:{}),...(Number.isFinite(block.indent)&&block.indent>0&&block.indent<200?{indent:block.indent}:{}),...(Number.isFinite(block.hang)&&block.hang>0&&block.hang<200?{hang:block.hang}:{}),...(block.maskPad&&['top','right','bottom','left'].every(side=>Number.isFinite(block.maskPad[side])&&block.maskPad[side]>=0&&block.maskPad[side]<=50)?{maskPad:{top:block.maskPad.top,right:block.maskPad.right,bottom:block.maskPad.bottom,left:block.maskPad.left}}:{}),sourceOnly:Boolean(block.sourceOnly),preserveSource:Boolean(block.preserveSource),...(holeList(block)?{holes:holeList(block)}:{}),...(block.bullet===true?{bullet:true}:{}),...(itemList(block)?{items:itemList(block)}:{}),backgroundColor:block.backgroundColor,...(block.inkColor?{inkColor:block.inkColor}:{})};
    });
    if(seen.size!==original.blocks.length)throw Error(tr('PDF 문단 배치에 누락이 있습니다.'));
    validatePages([{width:page.width,height:page.height,blocks}],true);
    return {width:page.width,height:page.height,blocks,layoutPrepared:true};
  });
}
// The words the saved PDF carries are in the translation's language (language), its errors in the screen's.
function exportHtml(pages, images,mode='layout',language=TARGET.code) {
  if(!['layout','reading'].includes(mode))throw Error(tr('PDF 저장 형식을 확인하세요.'));
  // A cached or imported record may be incomplete even after a job finished.
  // Never paint a blank mask over an untranslated abstract or paragraph.
  for(const [index,page] of pages.entries()){
    const missing=layoutBlocks(page).filter(b=>!b.sourceOnly&&(!b.translation||!b.translation.trim()||b.missingTranslation));
    if(missing.length)throw Error(tr('원문 {page}페이지에 번역되지 않은 문단 {n}개가 있습니다. 이 페이지를 다시 번역한 뒤 저장하세요.',{page:index+1,n:missing.length}));
  }
  if(mode==='reading'){
    return `<!doctype html><html lang="${escapeHtml(language)}"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; font-src file:; style-src 'unsafe-inline'"><style>@page{size:A4;margin:18mm}body{font:10.5pt/1.55 'Noto Sans KR',sans-serif;color:#111}.reading-page{break-before:page}.reading-page:first-child{break-before:auto}h2{font-size:12pt;line-height:1.4}.reading-block{white-space:pre-wrap;overflow-wrap:anywhere;margin:0 0 1em}.reading-block sub,.reading-block sup{font-size:.72em;line-height:0}.reading-block sup{vertical-align:.42em}.reading-block sub{vertical-align:-.24em}.warning{font-size:8.5pt;color:#8a4b00}</style></head><body>${pages.map((page,index)=>`<section class="reading-page"><h2>${escapeHtml(trIn(language,'{n}페이지 번역',{n:index+1}))}</h2>${page.blocks.map(b=>`<div class="reading-block" style="font-size:${translationFontSize(b.fontSize)}px">${formulaOnly(b)?escapeHtml(b.text):richHtml(b.translation)}</div>${b.warnings?.length?`<p class="warning">${escapeHtml(b.warnings.map(w=>warningText(w,language)).join(' · '))}</p>`:''}`).join('')}</section>`).join('')}</body></html>`;
  }
  if (!Array.isArray(images) || images.length!==pages.length || images.some(image=>typeof image!=='string'||!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(image)) || images.reduce((n,s)=>n+s.length,0)>150e6) throw Error(tr('PDF 저장용 페이지 이미지를 확인할 수 없습니다.'));
  const styles=`body{margin:0}*{box-sizing:border-box}.page{break-after:page;position:relative;overflow:hidden}.page:last-child{break-after:auto}.page>img{width:100%;height:100%;display:block}.block{clip-path:inset(calc(-1*var(--mask-top,0px)) calc(-1*var(--mask-right,0px)) calc(-1*var(--mask-bottom,0px)) calc(-1*var(--mask-left,0px)))}.block{position:absolute;color:#111;white-space:pre-wrap;overflow:hidden;overflow-wrap:anywhere;text-align:left;font-family:'Noto Sans KR',sans-serif;}.block[data-serif="true"]{font-family:'Noto Serif KR',serif}.block[data-align="justify"]{text-align:justify;text-align-last:start}.block strong,.block[data-heavy="true"]{font-weight:600}.block{text-indent:calc(var(--indent,0px) - var(--hang,0px))}.tl-list{display:block;margin-left:calc(-1*var(--hang,0px));text-indent:0}.tl-item{display:block}.tl-bullet{display:inline-block;text-indent:0;text-align:left;white-space:nowrap}.block sub,.block sup{font-size:.72em;line-height:0}.block sup{vertical-align:.42em}.block sub{vertical-align:-.24em}.block{font-size:var(--type-size);font-weight:var(--type-weight);line-height:var(--type-leading);padding:0 0 0 var(--hang,0px);letter-spacing:0}.protected-region{display:none}.continuation-header{position:absolute;inset:0 0 auto;overflow:hidden;pointer-events:none}.continuation-header img{display:block;max-width:none}.continuation-footer{position:absolute;bottom:12px;left:0;right:0;text-align:center;font-family:'Noto Sans KR',sans-serif;font-size:var(--type-size);line-height:var(--type-leading);color:#536171}${typographyCss()}`;
  const labelled=b=>{const text=String(b.translation||''),match=b.label&&emphasis(text,b.label);return match?`<strong>${richHtml(match[0])}</strong>${richHtml(match[1])}`:richHtml(text);};
  const sheets=pages.map((p,i)=>`@page sheet${i}{size:${p.width}px ${p.height}px;margin:0}`).join('');
  const prepared=pages.map(p=>({...p,blocks:pageTypography({...p,blocks:p.layoutPrepared?p.blocks:layoutBlocks(p)})}));
  // Nodes grouped by page once, not filtered again for every page.
  const byPage=new Map();for(const node of sectionDocument(prepared,'print').nodes){if(!byPage.has(node.page))byPage.set(node.page,[]);byPage.get(node.page).push(node);}
  const body=prepared.map((p,i)=>{
    const byId=new Map(p.blocks.map(b=>[b.id,b])),list=(byPage.get(i+1)||[]).map(n=>({...byId.get(n.id),sectionId:n.sectionId}));
    return `<section class="page" data-source-page="${i+1}" style="width:${p.width}px;height:${p.height}px;page:sheet${i}"><img src="${images[i]}">${list.map(b=>b.sourceOnly?`<div class="protected-region" style="left:${b.x}px;top:${b.y}px;width:${b.width}px;height:${b.height}px"></div>`:`<div class="block" data-kind="${escapeHtml(b.kind||'body')}" data-section-id="${escapeHtml(b.sectionId)}" data-typography="${escapeHtml(b.typographyRole)}" data-block-id="${escapeHtml(b.id)}" data-preserve-source="${Boolean(b.preserveSource)}"${b.bullet&&!b.preserveSource?` data-list="${escapeHtml(JSON.stringify({hang:Number(b.hang)||0,size:Number(b.fontSize)||0,items:b.items||null}))}"`:""}${b.holes?.length&&!b.preserveSource?` data-holes="${escapeHtml(JSON.stringify(holeFloats(b.holes,b.width)))}"`:""} data-serif="${Boolean(b.serif)}" data-heavy="${Boolean(b.heavy)}" data-align="${b.align==='justify'?'justify':'start'}" data-label="${labelValue(b.label)||false}" data-text="${escapeHtml(String(b.translation||''))}" style="--type-size:${b.fontSize}px;--type-leading:${b.lineHeight};${b.indent>0?`--indent:${Number(b.indent)}px;`:''}${b.hang>0?`--hang:${Number(b.hang)}px;`:''}${b.maskPad?['top','right','bottom','left'].map(side=>`--mask-${side}:${Number(b.maskPad[side])||0}px;`).join(''):''}${b.holes?.length&&!b.preserveSource?`clip-path:${holeClip(b.holes,b.width,b.height,b.maskPad||{})};`:''}left:${b.x}px;top:${b.y}px;width:${b.width}px;height:${b.height}px;${b.backgroundColor?'background-color:'+b.backgroundColor+';':''}${b.inkColor?'color:'+b.inkColor+';':''}">${b.holes?.length&&!b.preserveSource?holeFloats(b.holes,b.width).map(h=>`<span style="float:left;clear:both;width:0;height:${h.gap}px"></span><span style="float:${h.side};clear:left;width:${h.width}px;height:${h.height}px"></span>`).join(''):''}${labelled(b)}</div>`).join('')}</section>`;
  }).join('');
  return `<!doctype html><html lang="${escapeHtml(language)}"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; font-src file:; style-src 'unsafe-inline'"><style>${styles}${sheets}</style></head><body>${body}</body></html>`;
}
module.exports={TARGET,referenceImages,MISSING_REASONS,replyError,invalidKind,checkResult,checkReply,restoreMath,restoreUnit,checkCachedMath,pageChunks,validatePages,applyLayoutPlan,exportHtml,digest};
