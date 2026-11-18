// Makes the brand images from the SVGs in brand/ (docs/BRANDING.md): the app icon as PNG at every size and as
// a Windows .ico, the horizontal logo as PNG, the two introduction banners (1280×640) and the preview sheet.
// Only Playwright's Chromium draws them, so what is written is what a browser shows for the SVGs.
//   node scripts/brand.mjs
// A Chromium other than the one Playwright downloads can be named in APP_CHROMIUM_PATH.
import { chromium } from 'playwright';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = new URL('../', import.meta.url), brand = new URL('brand/', root);
// The files are named after the app's id and the sheet after its name (core/app-name.json).
const appName = JSON.parse(await readFile(new URL('core/app-name.json', root), 'utf8')), id = appName.id;
const read = name => readFile(new URL(name, brand), 'utf8');
const [mark, mono, logo, logoDark, wordmark] = await Promise.all(['mark', 'mark-mono', 'logo', 'logo-dark', 'wordmark'].map(kind => read(`${id}-${kind}.svg`)));
// An SVG drawn at a given size (its own width and height replaced).
const sized = (svg, width, height) => svg.replace(/ width="[\d.]+" height="[\d.]+"/, ` width="${width}" height="${height}"`);
const COLOURS = { blue: '#1b64da', highlighter: '#ffd43b', ink: '#191f28', paper: '#f7f5ef', muted: '#6b7684', night: '#1b1f28' };
// The banner's Korean text and the sheet's labels are set in Noto Sans KR (the app's own font, from node_modules).
const font = ['400', '500', '700'].map(w => `<link rel="stylesheet" href="${pathToFileURL(fileURLToPath(new URL(`node_modules/@fontsource/noto-sans-kr/${w}.css`, root))).href}">`).join('');
const page = async (browser, html, width, height) => {
  const p = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  // Written beside the fonts' folder is not needed: file:// pages may load file:// styles.
  const file = new URL('brand/.page.html', root); await writeFile(file, `<!doctype html><meta charset="utf-8">${font}${html}`);
  await p.goto(file.href); await p.evaluate(() => document.fonts.ready);
  return p;
};
const shot = async (browser, html, width, height, transparent = true) => {
  const p = await page(browser, `<style>html,body{margin:0;background:transparent}svg{display:block}</style>${html}`, width, height);
  const png = await p.screenshot({ omitBackground: transparent, clip: { x: 0, y: 0, width, height } }); await p.close(); return png;
};

// A Windows icon: the PNGs as they are, each with its directory entry (PNG entries are read by Windows Vista on).
function ico(pngs) {
  const head = Buffer.alloc(6 + 16 * pngs.length); head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(pngs.length, 4);
  let offset = head.length;
  pngs.forEach(({ size, png }, i) => {
    const at = 6 + 16 * i; head.writeUInt8(size >= 256 ? 0 : size, at); head.writeUInt8(size >= 256 ? 0 : size, at + 1);
    head.writeUInt16LE(1, at + 4); head.writeUInt16LE(32, at + 6); head.writeUInt32LE(png.length, at + 8); head.writeUInt32LE(offset, at + 12); offset += png.length;
  });
  return Buffer.concat([head, ...pngs.map(p => p.png)]);
}

// The banner: the logo, the line under it and two pages with a translation, a question and the pen, as the
// earlier banner laid them out. Only the name and the logo are new.
function banner(dark) {
  const c = dark ? { bg: COLOURS.night, ink: '#ffffff', sub: '#b0b8c1', mark: 'rgba(255,212,59,.55)', shadow: 'rgba(0,0,0,.45)' } : { bg: COLOURS.paper, ink: COLOURS.ink, sub: COLOURS.muted, mark: COLOURS.highlighter, shadow: 'rgba(25,31,40,.12)' };
  const line = (x, y, w, colour = '#c9cdd2', h = 9) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${h / 2}" fill="${colour}"/>`;
  const sheet = (lines, extra = '') => `${lines}${extra}`;
  return `<style>
    body{width:1280px;height:640px;background:${c.bg};font-family:'Noto Sans KR',sans-serif;position:relative;overflow:hidden}
    .logo{position:absolute;left:76px;top:160px;height:88px}
    h1{position:absolute;left:76px;top:290px;margin:0;font-size:44px;line-height:58px;font-weight:700;letter-spacing:-1.2px;color:${c.ink}}
    h1 span{background:linear-gradient(transparent 62%,${c.mark} 62%,${c.mark} 92%,transparent 92%)}
    p{position:absolute;left:76px;top:420px;margin:0;font-size:18px;line-height:32px;color:${c.sub};letter-spacing:-.2px}
    .art{position:absolute;left:640px;top:140px}
  </style>
  <div class="logo">${sized(dark ? logoDark : logo, 275, 88)}</div>
  <h1>원문 그대로 번역해 읽고,<br><span>묻고, 그 위에 쓴다.</span></h1>
  <p>번역은 원문 자리에, AI와 나눈 질문과 답은 논문 옆에.<br>내 모델로 쓰는 논문 스터디 노트</p>
  <svg class="art" width="620" height="440" viewBox="0 0 620 440"><defs><filter id="s" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="14" stdDeviation="16" flood-color="${c.shadow}"/></filter></defs>
    <g transform="translate(20 22) rotate(-3)" filter="url(#s)"><rect width="250" height="340" rx="8" fill="#fff"/>${sheet(line(28, 36, 122, '#8b95a1', 13) + [72, 90, 108, 126, 144].map((y, i) => line(28, y, [182, 190, 176, 186, 120][i])).join('') + '<rect x="28" y="168" width="196" height="60" rx="6" fill="#eef0f2"/>' + [246, 264, 282, 300].map((y, i) => line(28, y, [186, 176, 190, 142][i])).join(''))}</g>
    <g transform="translate(296 44) rotate(-3)" filter="url(#s)"><rect width="250" height="340" rx="8" fill="#fff"/>${sheet(line(28, 36, 122, COLOURS.blue, 13) + [72, 90, 108].map((y, i) => line(28, y, [178, 188, 172][i], '#8b95a1')).join('') + line(28, 128, 180, COLOURS.highlighter, 13) + line(28, 148, 150, '#8b95a1') + '<rect x="28" y="170" width="120" height="56" rx="6" fill="#eef0f2"/>' + [244, 262, 280, 298].map((y, i) => line(28, y, [184, 192, 182, 136][i], '#8b95a1')).join(''))}</g>
    <g transform="translate(410 156)" filter="url(#s)"><rect width="188" height="130" rx="10" fill="#fff" stroke="#e5e8eb"/>
      <rect x="14" y="14" width="20" height="20" rx="5" fill="#eef0f2"/><text x="24" y="29" text-anchor="middle" font-family="Inter,'Noto Sans KR',sans-serif" font-size="12" font-weight="700" fill="#6b7684">Q</text>${line(44, 20, 118, '#8b95a1', 7)}
      <rect x="14" y="44" width="20" height="20" rx="5" fill="${COLOURS.blue}"/><text x="24" y="59" text-anchor="middle" font-family="Inter,'Noto Sans KR',sans-serif" font-size="12" font-weight="700" fill="#fff">A</text>${line(44, 50, 120, '#c9cdd2', 7)}${line(44, 64, 104, '#c9cdd2', 7)}${line(44, 78, 80, '#c9cdd2', 7)}
      <rect x="44" y="96" width="28" height="16" rx="5" fill="#e8f3ff"/><text x="58" y="108" text-anchor="middle" font-family="Inter,'Noto Sans KR',sans-serif" font-size="10" font-weight="700" fill="${COLOURS.blue}">p.3</text></g>
    <path d="M398 345c14-14 26-16 38-2s24 16 38 0 26-18 40-2 28 14 42 0 22-14 40-12" stroke="${COLOURS.blue}" stroke-width="4.5" stroke-linecap="round" fill="none"/>
  </svg>`;
}

// The preview sheet: the logo on light and dark, the mark at the icon sizes with the one-colour mark and the
// word mark, and the colours.
function sheet() {
  const label = text => `<div class="label">${text}</div>`;
  const icon = size => `<figure>${sized(mark, size, size)}<figcaption>${size}px</figcaption></figure>`;
  const swatch = (name, hex, use, border) => `<div class="swatch"><div class="chip" style="background:${hex};${border ? 'border:1px solid #e5e8eb' : ''}"></div><b>${name}</b><code>${hex}</code><small>${use}</small></div>`;
  return `<style>
    body{width:1600px;background:#fff;font-family:Inter,'Noto Sans KR',sans-serif;color:${COLOURS.ink}}
    section{padding:44px 56px 40px;border-bottom:1px solid #e5e8eb}
    .label{font-size:15px;font-weight:600;letter-spacing:1px;color:${COLOURS.muted};margin-bottom:22px}
    .card{width:742px;height:238px;border-radius:14px;display:grid;place-items:center;margin-bottom:28px}
    .card:last-child{margin-bottom:0}
    .icons{display:flex;align-items:flex-end;gap:26px}
    figure{margin:0;display:flex;flex-direction:column;align-items:center;gap:10px}
    figcaption{font-size:12px;color:#8b95a1}
    .mono{width:214px;height:198px;border-radius:12px;background:${COLOURS.paper};display:grid;place-items:center;color:${COLOURS.ink};margin-left:10px;align-self:center}
    .word{width:398px;height:178px;border-radius:12px;border:1px solid #e5e8eb;display:grid;place-items:center;align-self:center}
    .swatches{display:flex;gap:28px}
    .swatch{width:210px;display:flex;flex-direction:column;gap:3px}
    .chip{height:84px;border-radius:8px;margin-bottom:14px;box-sizing:border-box}
    b{font-size:16px}code{font-size:13px;letter-spacing:.5px}small{font-size:13px;color:${COLOURS.muted}}
  </style>
  <section>${label('LOGO')}<div class="card" style="background:${COLOURS.paper}">${sized(logo, 618, 198)}</div><div class="card" style="background:${COLOURS.night}">${sized(logoDark, 618, 198)}</div></section>
  <section>${label('MARK · APP ICON')}<div class="icons">${[256, 128, 64, 32, 16].map(icon).join('')}<div class="mono">${sized(mono, 96, 96)}</div><div class="word">${sized(wordmark, 278, 125)}</div></div></section>
  <section>${label('COLOUR')}<div class="swatches">${swatch(`${appName.name} Blue`, COLOURS.blue, '주 색 · 아이콘 바탕 · 버튼')}${swatch('Highlighter', COLOURS.highlighter, '강조 · 밑줄 · 필기의 흔적')}${swatch('Ink', COLOURS.ink, '글자 · 어두운 바탕')}${swatch('Paper', COLOURS.paper, '소개 이미지 바탕', true)}${swatch('Muted', COLOURS.muted, '보조 글자')}</div></section>`;
}

const browser = await chromium.launch(process.env.APP_CHROMIUM_PATH ? { executablePath: process.env.APP_CHROMIUM_PATH } : {});
try {
  await mkdir(new URL('png/', brand), { recursive: true });
  const icons = [];
  for (const size of [16, 24, 32, 48, 64, 128, 256, 512, 1024]) {
    const png = await shot(browser, sized(mark, size, size), size, size);
    await writeFile(new URL(`png/${id}-icon-${size}.png`, brand), png); if (size <= 256) icons.push({ size, png });
  }
  await writeFile(new URL(`${id}.ico`, brand), ico(icons));
  for (const [svg, name] of [[logo, `${id}-logo`], [logoDark, `${id}-logo-dark`]]) await writeFile(new URL(`png/${name}.png`, brand), await shot(browser, sized(svg, 748, 240), 748, 240));
  for (const dark of [false, true]) await writeFile(new URL(dark ? `${id}-banner-dark.png` : `${id}-banner.png`, brand), await shot(browser, banner(dark), 1280, 640, false));
  const p = await page(browser, sheet(), 1600, 800), height = await p.evaluate(() => Math.ceil(document.body.getBoundingClientRect().height));
  await writeFile(new URL('brand-sheet.png', brand), await p.screenshot({ fullPage: true, clip: { x: 0, y: 0, width: 1600, height } })); await p.close();
} finally {
  await browser.close();
  await import('node:fs/promises').then(fs => fs.rm(new URL('brand/.page.html', root), { force: true }));
}
console.log(`Wrote brand/png, brand/${id}.ico, the banners and brand/brand-sheet.png.`);
