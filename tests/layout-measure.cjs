// One translated page as drawn on screen, for the audit and quality runs:
// the plan's counts and reasons, plus checks on the drawn geometry that do
// not trust the plan: boxes and their masks covering other text, text cut
// off in its box, masks over coloured graphics, and prose left in English as
// "source only". `p` is the Playwright page; the translated view is open.
async function measurePage(p,index){
  const started=Date.now();
  await p.evaluate(i=>{document.querySelector('.translated-pane .translated-pages').pdfViewer.currentPageNumber=i;},index);
  await p.waitForFunction(i=>document.querySelector(`.translated-sheet[data-page="${i}"] .translation-layer[data-ready="true"]`)&&document.querySelector('.translated-pane .translated-pages').pdfController.plans.has(i-1),index,{timeout:120000});
  const paintMs=Date.now()-started;
  await p.waitForFunction(i=>document.querySelector(`.translated-sheet[data-page="${i}"] canvas`)?.width>0,index);
  const page=await p.evaluate(i=>{
    const plan=document.querySelector('.translated-pane .translated-pages').pdfController.plans.get(i-1),sheet=document.querySelector(`.translated-sheet[data-page="${i}"]`),layer=sheet.querySelector('.translation-layer');
    const nodes=[...layer.querySelectorAll('.translated-block')].map(n=>{const c=n.querySelector('.translation-content'),pad=['top','right','bottom','left'].map(s=>parseFloat(getComputedStyle(n).getPropertyValue('--mask-'+s))||0);
      const planned=plan.blocks.find(b=>b.id===n.dataset.blockId);return {id:n.dataset.blockId,rows:planned?.rows||null,text:n.dataset.sourceText||'',masked:!n.classList.contains('source-preserved'),panel:Boolean(n.style.color),x:parseFloat(n.style.left),y:parseFloat(n.style.top),w:parseFloat(n.style.width),h:parseFloat(n.style.height),pad,clipped:Boolean(c)&&!n.classList.contains('source-preserved')&&(c.scrollHeight>c.clientHeight+1||c.scrollWidth>c.clientWidth+1)};});
    const cut=(a,b)=>Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x)>2&&Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y)>2;
    const withMask=n=>({x:n.x-n.pad[3],y:n.y-n.pad[0],w:n.w+n.pad[1]+n.pad[3],h:n.h+n.pad[0]+n.pad[2]});
    // A drawn translation (with its mask) must not cover another paragraph's text.
    const overlaps=[];
    // A few glyphs extracted apart but lying inside the paragraph's own box
    // (a prime, an index, a subscript word, ∑ or √) are part of that
    // paragraph, not a neighbour: up to 20 characters in three words, kept
    // as source under the translation.
    const inside=(b,a)=>b.x>=a.x-4&&b.y>=a.y-2&&b.x+b.w<=a.x+a.w+2&&b.y+b.h<=a.y+a.h+2;
    const piece=b=>!b.masked&&b.text.trim().length<=20&&b.text.trim().split(/\s+/).length<=3;
    // A source block of a few rows (a formula, code) covers its rows, not the
    // blank corner of the box around them (the app's layoutCollisions rule).
    const covers=(m,b)=>!b.masked&&b.rows?.length>1?b.rows.some(([x,y,w,h])=>{const l=Math.max(x,b.x),t=Math.max(y,b.y);return cut(m,{x:l,y:t,w:Math.min(x+w,b.x+b.w)-l,h:Math.min(y+h,b.y+b.h)-t});}):cut(m,b);
    for(const a of nodes.filter(n=>n.masked))for(const b of nodes)if(a!==b&&covers(withMask(a),b)&&!(piece(b)&&inside(b,a))&&!(b.masked&&nodes.indexOf(b)<nodes.indexOf(a)&&cut(withMask(b),a)))overlaps.push({a:a.text.slice(0,40),b:b.text.slice(0,40),bTranslated:b.masked});
    // Masks over coloured pixels of the source page: a figure or chart hidden.
    // A dark panel masked in its own colour under light ink hides nothing.
    const canvas=sheet.querySelector('canvas'),k=canvas.width/Number(layer.dataset.sourceWidth),img=canvas.getContext('2d',{willReadFrequently:true}).getImageData(0,0,canvas.width,canvas.height);
    const coloured=r=>{let hit=0,all=0;for(let y=r.y;y<r.y+r.h;y+=2)for(let x=r.x;x<r.x+r.w;x+=2){const px=Math.round(x*k),py=Math.round(y*k);if(px<0||py<0||px>=img.width||py>=img.height)continue;const j=(py*img.width+px)*4,c=[img.data[j],img.data[j+1],img.data[j+2]];all++;if(Math.max(...c)-Math.min(...c)>60)hit++;}return all?hit/all:0;};
    const maskOverGraphic=nodes.filter(n=>n.masked&&!n.panel&&coloured(withMask(n))>.3).map(n=>n.text.slice(0,40));
    const prose=t=>(t.match(/\p{L}{2,}/gu)||[]).length>=10&&/[a-z]{3,}/.test(t)&&/[.!?]["')\]]*$/.test(t.trim());
    const blocks=plan.blocks;
    return {
      page:i,blocks:blocks.length,
      translatable:blocks.filter(b=>!b.sourceOnly||b.untranslated).length,
      inPlace:blocks.filter(b=>!b.sourceOnly&&!b.preserveSource&&!b.overflow).length,
      shrunk:blocks.filter(b=>b.fitScale<1).length,
      // A translated heading set smaller to fit had no room to grow ("Full VB"
      // held to its English width by an equation further down the page).
      squeezedHeadings:blocks.filter(b=>['title','heading','subheading'].includes(b.kind)&&!b.sourceOnly&&!b.preserveSource&&b.fitScale<.9).map(b=>b.text.slice(0,60)),
      displaced:blocks.filter(b=>!b.sourceOnly&&(b.preserveSource||b.overflow)).map(b=>({reason:b.reason,split:Number.isInteger(b.splitAt),text:b.text.slice(0,60),...(b.collidedWith?{collidedWith:b.collidedWith}:{})})),
      untranslated:blocks.filter(b=>b.untranslated).map(b=>({text:b.text.slice(0,60),reason:b.missingReason||''})),
      english:blocks.filter(b=>b.englishOnly).map(b=>b.text.slice(0,60)),
      sourceOnlyProse:blocks.filter(b=>b.sourceOnly&&!b.untranslated&&!b.englishOnly&&!/reference|bibliograph|참고/i.test(b.sectionTitle||'')&&prose(b.text)).map(b=>b.text.slice(0,80)),
      overlaps,clipped:nodes.filter(n=>n.clipped).map(n=>n.text.slice(0,40)),maskOverGraphic,
      continuation:Boolean(document.querySelector(`.layout-flow-continuation[data-continuation-for="${i}"]`))
    };
  },index);
  return {...page,paintMs};
}
module.exports={measurePage};
