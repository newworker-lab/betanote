import { mkdir, readFile, writeFile, copyFile, cp } from 'node:fs/promises';
const root = new URL('../', import.meta.url);
await mkdir(new URL('dist/', root), { recursive: true });
let html = await readFile(new URL('desktop/index.html', root), 'utf8');
html = html.replace('<head>', `<head><meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: app:; frame-src 'self' app:; object-src app:; connect-src 'self'; worker-src 'self'; base-uri 'none'; form-action 'none'">`)
  .replace('<script src="app.js"></script>', '<script src="app-name.js"></script><script src="app-logo.js"></script><script src="i18n.js"></script><script src="i18n-en.js"></script><script src="memo-labels.js"></script><script src="ink-marks.js"></script><script src="storage-keys.js"></script><script src="app.js"></script><script src="renderer.js"></script><script src="ink.js"></script><script src="library.js"></script><script src="transfer.js"></script><script src="tags.js"></script><script src="insight.js"></script><script src="review.js"></script><script src="notebook.js"></script><script src="katex/katex.min.js"></script><script src="md-marks.js"></script><script src="markdown.js"></script><script src="live-editor.js"></script><script src="notes.js"></script><script src="appearance.js"></script><script src="help.js"></script>');
html = html.replace('</head>', '<link rel="stylesheet" href="pdfjs/pdf_viewer.css"><link rel="stylesheet" href="fonts/font.css"><link rel="stylesheet" href="desktop.css"><link rel="stylesheet" href="ink.css"><link rel="stylesheet" href="library.css"><link rel="stylesheet" href="typography.css"><link rel="stylesheet" href="katex/katex.min.css"><link rel="stylesheet" href="notes.css"></head>');
// The app's name (core/app-name.json): the page's title, and the brand files named after its id.
const appName=JSON.parse(await readFile(new URL('core/app-name.json',root),'utf8'));
if(!appName.name||!/^[a-z][a-z0-9]*$/.test(appName.id||''))throw Error('core/app-name.json: a name and an id (lower-case letters and digits) are needed');
html=html.replace('<title></title>',`<title>${appName.name.replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'})[c])}</title>`);
await writeFile(new URL('dist/index.html', root), html);
// The window and taskbar icon (Linux takes it from the window; Windows from the executable).
await copyFile(new URL(`brand/png/${appName.id}-icon-256.png`, root), new URL('dist/icon.png', root));
// The logo on the screen (desktop/app.js logo()): the icon and the word mark from brand/, as globalThis.appLogo. Each
// loses what makes it a file of its own (namespace, size, label: the page names the logo). The word mark's file keeps
// a margin around its letters (6 at the sides, 12 above and below) that the screen leaves out, and its dark ink
// (#191f28) becomes the screen's text colour.
{
  const brandSvg=async(kind,cls)=>{const svg=(await readFile(new URL(`brand/${appName.id}-${kind}.svg`,root),'utf8')).trim();
    if(!/^<svg [^>]*viewBox="[^"]+"/.test(svg))throw Error(`brand/${appName.id}-${kind}.svg: an <svg> with a viewBox is needed`);
    return svg.replace(/^<svg [^>]*>/,open=>'<svg class="'+cls+'" viewBox="'+/viewBox="([^"]+)"/.exec(open)[1]+'" aria-hidden="true">');};
  const mark=await brandSvg('mark','mark');
  const word=(await brandSvg('wordmark','logo-word')).replace(/viewBox="([^"]+)"/,(_,box)=>{const [x,y,w,h]=box.split(/\s+/).map(Number);return `viewBox="${x+6} ${y+12} ${w-12} ${h-24}"`;}).replaceAll('#191f28','currentColor');
  await writeFile(new URL('dist/app-logo.js',root),`globalThis.appLogo=${JSON.stringify({mark,word})};\n`);
}
await copyFile(new URL('desktop/app.js', root), new URL('dist/app.js', root));
await copyFile(new URL('desktop/app.css', root), new URL('dist/style.css', root));
await copyFile(new URL('desktop/renderer.js', root), new URL('dist/renderer.js', root));
await copyFile(new URL('desktop/ink.js', root), new URL('dist/ink.js', root));
await copyFile(new URL('desktop/ink.css', root), new URL('dist/ink.css', root));
for (const file of ['library.js','transfer.js','library.css','tags.js','insight.js','review.js','notebook.js','md-marks.js','markdown.js','notes.js','notes.css','appearance.js','help.js']) await copyFile(new URL('desktop/' + file, root), new URL('dist/' + file, root));
await copyFile(new URL('desktop/style.css', root), new URL('dist/desktop.css', root));
// The live memo editor (CodeMirror 6) is bundled into one script.
{const {fileURLToPath}=await import('node:url'),esbuild=await import('esbuild');await esbuild.build({entryPoints:[fileURLToPath(new URL('desktop/live-editor.mjs',root))],bundle:true,format:'iife',minify:true,legalComments:'none',target:'chrome130',outfile:fileURLToPath(new URL('dist/live-editor.js',root)),logLevel:'warning'});}
// KaTeX typesets the math in notes (script, styles and its fonts, all served from the app).
await mkdir(new URL('dist/katex/',root),{recursive:true});
for(const file of ['katex.min.js','katex.min.css'])await copyFile(new URL('node_modules/katex/dist/'+file,root),new URL('dist/katex/'+file,root));
await cp(new URL('node_modules/katex/dist/fonts/',root),new URL('dist/katex/fonts/',root),{recursive:true});
console.log('Built dist/: local desktop renderer with the reviewed UI.');

// The app's name for the screen: the name file's values, then the module that makes what is named after it
// (core/app-name.cjs sets globalThis.appName from globalThis.appNameData).
await writeFile(new URL('dist/app-name.js',root),`globalThis.appNameData=${JSON.stringify(JSON.parse(await readFile(new URL('core/app-name.json',root),'utf8')))};\n${await readFile(new URL('core/app-name.cjs',root),'utf8')}`);
await copyFile(new URL('core/i18n.js',root),new URL('dist/i18n.js',root));
await copyFile(new URL('core/i18n-en.js',root),new URL('dist/i18n-en.js',root));
await copyFile(new URL('core/memo-labels.cjs',root),new URL('dist/memo-labels.js',root));
await copyFile(new URL('core/ink-marks.cjs',root),new URL('dist/ink-marks.js',root));
await copyFile(new URL('desktop/storage-keys.js',root),new URL('dist/storage-keys.js',root));
await copyFile(new URL('core/pdf-text.js',root),new URL('dist/pdf-text.js',root));
await copyFile(new URL('core/pdf-layout.js',root),new URL('dist/pdf-layout.js',root));
await copyFile(new URL('core/pdf-view.js',root),new URL('dist/pdf-view.js',root));
const {createRequire}=await import('node:module');
const layout=createRequire(import.meta.url)('../core/pdf-layout.js');
await writeFile(new URL('dist/typography.css',root),layout.typographyCss());
if (!process.argv.includes('--ui-only')) {
await mkdir(new URL('dist/pdfjs/',root),{recursive:true});
for(const file of ['pdf.mjs','pdf.worker.mjs'])await copyFile(new URL('node_modules/pdfjs-dist/build/'+file,root),new URL('dist/pdfjs/'+file,root));
// The viewer's text layer orders its spans for screen readers by comparing
// their boxes, reading both boxes again on every comparison (about 30,000
// layout reads a page). Each box is read once instead; the order is the
// same. A PDF.js upgrade that changes this code stops the build here.
{
  const viewer=await readFile(new URL('node_modules/pdfjs-dist/web/pdf_viewer.mjs',root),'utf8');
  const sort='this.#textChildren.sort(TextAccessibilityManager.#compareElementPositions);',compare='  static #compareElementPositions(e1, e2) {\n    const rect1 = e1.getBoundingClientRect();\n    const rect2 = e2.getBoundingClientRect();';
  if(viewer.split(sort).length!==2||viewer.split(compare).length!==2)throw Error('pdf_viewer.mjs changed: review the text-layer sort patch in scripts/build.mjs');
  await writeFile(new URL('dist/pdfjs/pdf_viewer.mjs',root),viewer.replace(sort,'const appRects=new Map(this.#textChildren.map(e=>[e,e.getBoundingClientRect()]));this.#textChildren.sort((a,b)=>TextAccessibilityManager.#compareElementPositions(a,b,appRects));').replace(compare,'  static #compareElementPositions(e1, e2, rects) {\n    const rect1 = rects?.get(e1) || e1.getBoundingClientRect();\n    const rect2 = rects?.get(e2) || e2.getBoundingClientRect();'));
}
const viewerCss=await readFile(new URL('node_modules/pdfjs-dist/web/pdf_viewer.css',root),'utf8');
await writeFile(new URL('dist/pdfjs/pdf_viewer.css',root),'@scope (.native-pdf) {\n'+viewerCss.replace(/:root/g,':scope')+'\n}');
await cp(new URL('node_modules/pdfjs-dist/web/images/',root),new URL('dist/pdfjs/images/',root),{recursive:true});
for(const folder of ['cmaps','standard_fonts','wasm'])await cp(new URL('node_modules/pdfjs-dist/'+folder,root),new URL('dist/pdfjs/'+folder,root),{recursive:true});

// Translations follow the source's serif/sans class, so both Korean families ship.
let fontCss='';
await mkdir(new URL('dist/fonts/files/',root),{recursive:true});
for(const family of ['noto-sans-kr','noto-serif-kr']){
  let css=(await Promise.all(['400','600'].map(weight=>readFile(new URL('node_modules/@fontsource/'+family+'/'+weight+'.css',root),'utf8')))).join('\n');
  css=css.replace(/, url\([^)]*\.woff\) format\('woff'\)/g,'');
  for(const match of css.matchAll(/url\(\.\/files\/([^)]*\.woff2)\)/g))await copyFile(new URL('node_modules/@fontsource/'+family+'/files/'+match[1],root),new URL('dist/fonts/files/'+match[1],root));
  await copyFile(new URL('node_modules/@fontsource/'+family+'/LICENSE',root),new URL('dist/fonts/LICENSE-'+family,root));
  fontCss+=css+'\n';
}
await writeFile(new URL('dist/fonts/font.css',root),fontCss);
await copyFile(new URL('node_modules/@fontsource/noto-sans-kr/LICENSE',root),new URL('dist/fonts/LICENSE',root));
}
