// Bibliographic records: structured fields, exchange formats and citations.
const {tr}=require('../core/i18n.js');
// Author strings are never split by guessing; a creator gets family/given
// only when its source states them (RIS "Family, Given", BibTeX, CSL, Crossref).
const TYPES={'article-journal':'학술지 논문','paper-conference':'학회 논문','book':'책','chapter':'책의 장','thesis':'학위논문','report':'보고서','webpage':'웹페이지','preprint':'프리프린트','other':'기타'}; // i18n:keep — only the keys are read
const FIELDS=['abstract','date','volume','issue','pages','publisher','place','isbn','issn','url','accessed','citekey'];
const LIMITS={abstract:20000,url:2000};
const plain=value=>String(value??'').replace(/[\r\n]+/g,' ').trim();

function normalizeDOI(value){
 if(typeof value!=='string')throw Error(tr('DOI를 입력하세요.'));
 const doi=value.trim().replace(/^https?:\/\/(?:dx\.)?doi\.org\//i,'').replace(/^doi:\s*/i,'');
 if(!/^10\.\d{4,9}\/[^\s<>"?#]+$/i.test(doi)||doi.length>300)throw Error(tr('DOI 형식을 확인하세요.'));return doi;
}
function validCreators(list){
 return Array.isArray(list)&&list.length<=500&&list.every(c=>c&&typeof c==='object'&&(typeof c.literal==='string'&&c.literal.trim()&&c.literal.length<=300&&c.family===undefined||typeof c.family==='string'&&c.family.trim()&&c.family.length<=200&&(c.given===undefined||typeof c.given==='string'&&c.given.length<=200)&&c.literal===undefined));
}
function cleanCreators(list){return list.map(c=>c.literal!==undefined?{literal:plain(c.literal)}:{family:plain(c.family),...(plain(c.given)?{given:plain(c.given)}:{})});}
// Without stated structure each ";"-separated name stays one literal name.
function creatorsOf(paper){
 if(validCreators(paper.creators)&&paper.creators.length)return paper.creators;
 const text=plain(paper.authors);if(!text||text==='저자 미입력')return []; // i18n:keep — the stored value for no author
 return text.split(';').map(s=>s.trim()).filter(Boolean).map(literal=>({literal}));
}
const creatorName=c=>c.literal??[c.given,c.family].filter(Boolean).join(' ');
const creatorsText=list=>list.map(creatorName).join('; ');
// One author per line: "Family, Given" is structured, anything else is kept whole.
function parseCreatorLines(text){
 return String(text||'').split(/\r?\n/).map(s=>s.trim()).filter(Boolean).map(line=>{const at=line.indexOf(',');return at>0&&line.slice(0,at).trim()&&line.slice(at+1).trim()?{family:line.slice(0,at).trim(),given:line.slice(at+1).trim()}:{literal:line};});
}
function creatorLines(paper){return creatorsOf(paper).map(c=>c.literal??(c.given?`${c.family}, ${c.given}`:c.family)).join('\n');}
const yearOf=p=>(/\d{4}/.exec(plain(p.date))||/\d{4}/.exec(plain(p.year))||[''])[0];
// An item without a key of its own is cited as beta<id> (an earlier app's default key, written in the item's key field, is kept).
const citekeyOf=p=>plain(p.citekey)||require('../core/app-name.cjs').citekeyPrefix+p.id;
// Patch validation shared by the editor and every importer.
function bibliographyPatch(patch){
 const out={};
 if(Object.hasOwn(patch,'type')){if(!Object.hasOwn(TYPES,patch.type))throw Error(tr('자료 유형을 확인하세요.'));out.type=patch.type;}
 if(Object.hasOwn(patch,'creators')){if(!validCreators(patch.creators))throw Error(tr('저자 목록을 확인하세요.'));out.creators=cleanCreators(patch.creators);}
 for(const key of FIELDS)if(Object.hasOwn(patch,key)){
  if(typeof patch[key]!=='string'||patch[key].length>(LIMITS[key]||1000))throw Error(tr('서지정보를 확인하세요.'));
  out[key]=key==='abstract'?patch[key].trim():plain(patch[key]);
 }
 if(out.citekey&&!/^[A-Za-z0-9_:.\-]{1,100}$/.test(out.citekey))throw Error(tr('인용 키는 영문·숫자·_:.- 로 입력하세요.'));
 for(const key of ['date','accessed'])if(out[key]&&!/^\d{4}(-\d{2}(-\d{2})?)?$/.test(out[key]))throw Error(tr('날짜는 YYYY, YYYY-MM 또는 YYYY-MM-DD로 입력하세요.'));
 return out;
}

function crossrefMetadata(record){
 const text=value=>typeof value==='string'?value.replace(/<[^>]*>/g,'').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/\s+/g,' ').trim().slice(0,1000):'';
 const parts=record?.published?.['date-parts']?.[0]||record?.issued?.['date-parts']?.[0]||[];
 if(!record||!Array.isArray(record.title)||!text(record.title[0]))throw Error(tr('서지정보 응답을 확인할 수 없습니다.'));
 const creators=(record.author||[]).map(a=>a.family?{family:text(a.family),...(text(a.given)?{given:text(a.given)}:{})}:text(a.name)?{literal:text(a.name)}:null).filter(Boolean);
 const type={'journal-article':'article-journal','proceedings-article':'paper-conference','book':'book','monograph':'book','edited-book':'book','book-chapter':'chapter','dissertation':'thesis','report':'report','posted-content':'preprint'}[record.type]||'other';
 const date=parts.filter(Number.isInteger).slice(0,3).map((n,i)=>i?String(n).padStart(2,'0'):String(n)).join('-');
 return {type,title:text(record.title[0]),authors:creatorsText(creators).slice(0,1000),creators,year:parts[0]?String(parts[0]):'',date,journal:text(record['container-title']?.[0]),volume:text(record.volume),issue:text(record.issue),pages:text(record.page).replace(/-/g,'–'),publisher:text(record.publisher),isbn:text(record.ISBN?.[0]),issn:text(record.ISSN?.[0]),url:text(record.URL),abstract:typeof record.abstract==='string'?record.abstract.replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim().slice(0,20000):'',doi:normalizeDOI(record.DOI)};
}
// DataCite holds the DOIs Crossref does not: arXiv (10.48550), Zenodo, many repositories.
function dataciteMetadata(a){
 const text=value=>typeof value==='string'?value.replace(/<[^>]*>/g,'').replace(/\s+/g,' ').trim().slice(0,1000):'';
 const title=text(a?.titles?.[0]?.title);if(!title)throw Error(tr('서지정보 응답을 확인할 수 없습니다.'));
 const creators=(a.creators||[]).map(c=>text(c.familyName)?{family:text(c.familyName),...(text(c.givenName)?{given:text(c.givenName)}:{})}:text(c.name)?{literal:text(c.name)}:null).filter(Boolean);
 const general=a.types?.resourceTypeGeneral,arxiv=/^10\.48550\//i.test(a.doi||'');
 const type=arxiv?'preprint':{JournalArticle:'article-journal',ConferencePaper:'paper-conference',Book:'book',BookChapter:'chapter',Dissertation:'thesis',Report:'report',Preprint:'preprint'}[general]||'other';
 const issued=(a.dates||[]).find(d=>d.dateType==='Issued')?.date,date=/^\d{4}(-\d{2}(-\d{2})?)?/.exec(text(issued)||'')?.[0]||(a.publicationYear?String(a.publicationYear):'');
 const publisher=typeof a.publisher==='string'?a.publisher:a.publisher?.name;
 return {type,title,authors:creatorsText(creators).slice(0,1000),creators,year:a.publicationYear?String(a.publicationYear):date.slice(0,4),date,journal:text(a.container?.title)||(arxiv?'arXiv':''),publisher:text(publisher),url:text(a.url),abstract:text((a.descriptions||[]).find(d=>d.descriptionType==='Abstract')?.description).slice(0,20000)};
}
// Titles compared word by word, ignoring case, accents and punctuation (Dice coefficient, 0–1).
const titleWords=value=>String(value||'').normalize('NFKD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/<[^>]*>/g,' ').replace(/[^\p{L}\p{N}]+/gu,' ').trim().split(' ').filter(Boolean);
function titleSimilarity(a,b){
 const x=titleWords(a),y=titleWords(b);if(!x.length||!y.length)return 0;
 const pool=new Map();for(const w of y)pool.set(w,(pool.get(w)||0)+1);
 let shared=0;for(const w of x)if(pool.get(w)){shared++;pool.set(w,pool.get(w)-1);}
 return 2*shared/(x.length+y.length);
}
// A Crossref search result is taken only when its title is nearly the PDF's
// (and its year, when the PDF states one, is within a year).
function bestTitleMatch(items,clue,threshold=.9){
 let best=null;
 for(const item of items||[]){
  const title=Array.isArray(item?.title)?item.title[0]:'',score=titleSimilarity(clue.title,title);if(score<threshold)continue;
  const year=(item.published||item.issued)?.['date-parts']?.[0]?.[0];if(clue.year&&year&&Math.abs(Number(clue.year)-year)>1)continue;
  if(!best||score>best.score)best={score,item};
 }
 return best;
}
// What a PDF's own information (its metadata, never its layout) can fill when
// no record is found: a real title (not a file or program name), stated
// authors, a publication year, a journal.
function pdfOwnMetadata(clue){
 const text=value=>String(value??'').replace(/\s+/g,' ').trim();
 const title=text(clue.metaTitle),words=titleWords(title).length;
 const goodTitle=title.length>=10&&title.length<=300&&words>=3&&words<=40&&title.split(' ').length>=3&&!/^(untitled|microsoft (word|powerpoint)\b|document\d*$|slide \d)|\.(docx?|tex|dvi|pdf|indd|qxd|pptx?)$/i.test(title);
 const names=(Array.isArray(clue.authors)?clue.authors:text(clue.authors).split(';')).map(text).filter(n=>n.length>=3&&n.length<=300&&!/^(admin(istrator)?|user|owner|author|unknown|microsoft|adobe|elsevier|springer)\b/i.test(n));
 const creators=names.slice(0,100).map(literal=>({literal}));
 const year=/^(19|20)\d{2}$/.test(text(clue.year))?text(clue.year):'';
 return {...(goodTitle?{title}:{}),...(creators.length?{authors:creatorsText(creators).slice(0,1000),creators}:{}),...(year?{year,date:year}:{}),...(text(clue.journal)?{journal:text(clue.journal).slice(0,300)}:{})};
}
// A lookup only fills empty fields; differing values are returned for review.
function compareMetadata(current,candidate){
 const fill={},conflicts=[];
 for(const [key,value] of Object.entries(candidate)){
  if(key==='creators'||value===''||value===undefined)continue;
  const now=plain(current[key]);
  if(!now||(key==='authors'&&now==='저자 미입력')||(key==='year'&&now==='—'))fill[key]=value; // i18n:keep — the stored value for no author
  else if(now!==plain(value))conflicts.push({field:key,current:now,candidate:value});
 }
 if(candidate.creators?.length&&(!validCreators(current.creators)||!current.creators.length)&&fill.authors!==undefined)fill.creators=candidate.creators;
 return {fill,conflicts};
}

// "Surname_Year_Title.pdf" for an item's PDF: the first author's family name,
// the year and at most 60 characters of the title (cut at a word), without
// characters a file system refuses. Missing parts are left out, never invented.
function fileNameFor(paper){
  const clean=value=>String(value||'').normalize('NFC').replace(/[<>:"/\\|?*\x00-\x1f]/g,' ').replace(/\s+/g,' ').trim();
  const first=creatorsOf(paper)[0],surname=clean(first?.family||(first?.literal||'').split(/[,\s]/)[0]);
  const year=(/\b\d{4}\b/.exec(`${paper.year||''} ${paper.date||''}`)||[''])[0];
  let title=clean(paper.title).replace(/[.\s]+$/,'');
  if(title.length>60){title=title.slice(0,60);const space=title.lastIndexOf(' ');if(space>30)title=title.slice(0,space);}
  const stem=[surname,year,title].filter(Boolean).join('_').replace(/^[.\s]+/,'').slice(0,190);
  return stem?stem+'.pdf':null;
}

// ---- Exchange formats ----
const RIS_TYPES={'article-journal':'JOUR','paper-conference':'CPAPER','book':'BOOK','chapter':'CHAP','thesis':'THES','report':'RPRT','webpage':'ELEC','preprint':'JOUR','other':'GEN'};
const RIS_IN={JOUR:'article-journal',JFULL:'article-journal',MGZN:'article-journal',CONF:'paper-conference',CPAPER:'paper-conference',BOOK:'book',EBOOK:'book',EDBOOK:'book',CHAP:'chapter',ECHAP:'chapter',THES:'thesis',RPRT:'report',ELEC:'webpage',WEB:'webpage',BLOG:'webpage',UNPB:'preprint'};
const BIB_TYPES={'article-journal':'article','paper-conference':'inproceedings','book':'book','chapter':'incollection','thesis':'phdthesis','report':'techreport','webpage':'misc','preprint':'misc','other':'misc'};
const BIBLATEX_TYPES={'article-journal':'article','paper-conference':'inproceedings','book':'book','chapter':'incollection','thesis':'thesis','report':'report','webpage':'online','preprint':'online','other':'misc'};
const BIB_IN={article:'article-journal',inproceedings:'paper-conference',conference:'paper-conference',book:'book',inbook:'chapter',incollection:'chapter',phdthesis:'thesis',mastersthesis:'thesis',thesis:'thesis',techreport:'report',report:'report',online:'webpage',electronic:'webpage',www:'webpage',unpublished:'preprint',misc:'other'};
function exportBibliography(papers,format){
 if(!['ris','bib','biblatex','csl'].includes(format))throw Error(tr('내보내기 형식을 확인하세요.'));
 const list=papers.filter(p=>!p.trashedAt);
 if(format==='csl')return JSON.stringify(list.map(cslItem),null,2);
 const clean=value=>plain(value).replace(/[\\{}%&#_$^~]/g,c=>c==='\\'?'\\textbackslash{}':c==='^'?'\\textasciicircum{}':c==='~'?'\\textasciitilde{}':'\\'+c);
 return list.map(p=>{
  const type=p.type||'article-journal',creators=creatorsOf(p),[start,end]=plain(p.pages).split(/[-–]/);
  if(format==='ris')return [`TY  - ${RIS_TYPES[type]}`,'ID  - '+citekeyOf(p),'TI  - '+plain(p.title),...creators.map(c=>'AU  - '+plain(c.literal??(c.given?`${c.family}, ${c.given}`:c.family))),'PY  - '+yearOf(p),...(p.date?['DA  - '+plain(p.date).replace(/-/g,'/')]:[]),`${type==='book'?'T2':'JO'}  - `+plain(p.journal),...[['VL',p.volume],['IS',p.issue],['SP',start],['EP',end],['PB',p.publisher],['CY',p.place],['SN',p.isbn||p.issn],['UR',p.url],['Y2',p.accessed],['AB',p.abstract]].filter(([,v])=>plain(v)).map(([k,v])=>`${k}  - ${plain(v)}`),'DO  - '+plain(p.doi),...p.tags.map(t=>'KW  - '+plain(t)),'ER  - ',''].join('\r\n');
  const latex=format==='biblatex',container={'article-journal':'journal','paper-conference':'booktitle','chapter':'booktitle'}[type]||(latex&&type==='preprint'?'eprinttype':'journal');
  // Organizations stay one name inside braces so BibTeX never splits them.
  const names=creators.map(c=>c.literal!==undefined?`{${clean(c.literal)}}`:clean(c.given?`${c.family}, ${c.given}`:c.family)).join(' and ');
  const fields=[['title',p.title],['author',names,true],[latex?'date':'year',latex?(p.date||yearOf(p)):yearOf(p)],[latex&&container==='journal'?'journaltitle':container,p.journal],['volume',p.volume],['number',p.issue],['pages',plain(p.pages).replace(/–/g,'--')],[type==='thesis'&&!latex?'school':type==='report'&&!latex?'institution':'publisher',p.publisher],[latex?'location':'address',p.place],['isbn',p.isbn],['issn',p.issn],['doi',p.doi],['url',p.url],[latex?'urldate':'note',latex?p.accessed:p.accessed?'Accessed '+p.accessed:''],['abstract',p.abstract],['keywords',p.tags.join(', ')]];
  return `@${(latex?BIBLATEX_TYPES:BIB_TYPES)[type]}{${citekeyOf(p)},\n${fields.filter(([,v])=>plain(v)).map(([key,v,raw])=>`  ${key} = {${raw?v:clean(v)}}`).join(',\n')}\n}`;
 }).join('\n');
}
function cslItem(p){
 const dateParts=d=>{const parts=plain(d).split('-').map(Number).filter(Boolean);return parts.length?{'date-parts':[parts]}:undefined;};
 const item={id:citekeyOf(p),type:p.type||'article-journal',title:plain(p.title),author:creatorsOf(p).map(c=>({...c})),issued:dateParts(p.date||yearOf(p)),'container-title':plain(p.journal)||undefined,volume:plain(p.volume)||undefined,issue:plain(p.issue)||undefined,page:plain(p.pages)||undefined,publisher:plain(p.publisher)||undefined,'publisher-place':plain(p.place)||undefined,ISBN:plain(p.isbn)||undefined,ISSN:plain(p.issn)||undefined,DOI:plain(p.doi)||undefined,URL:plain(p.url)||undefined,accessed:dateParts(p.accessed),abstract:p.abstract?String(p.abstract):undefined,keyword:p.tags.length?p.tags.join(', '):undefined};
 return Object.fromEntries(Object.entries(item).filter(([,v])=>v!==undefined));
}
// The PDFs an entry names, as written (not yet resolved against a folder). RIS gives one link a line
// (L1, L4). BibTeX "file" holds several, separated by ";", each "description:path:type" as Zotero,
// JabRef and Mendeley write it (a ":" or ";" inside a path is escaped; Mendeley spells "\" as
// $\backslash$), or a bare path.
function bibFiles(raw){
 const text=String(raw).replace(/\$\\backslash\$/g,'\\').replace(/[{}]/g,''),links=[];
 const split=(value,mark)=>{const out=[''];for(let i=0;i<value.length;i++){if(value[i]==='\\'&&i+1<value.length&&(value[i+1]===':'||value[i+1]===';'||value[i+1]==='\\')){out[out.length-1]+=value[++i];continue;}if(value[i]===mark)out.push('');else out[out.length-1]+=value[i];}return out;};
 // Split on ";" first, keeping escapes for the second split on ":".
 const parts=[''];for(let i=0;i<text.length;i++){if(text[i]==='\\'&&i+1<text.length){parts[parts.length-1]+=text[i]+text[++i];continue;}if(text[i]===';')parts.push('');else parts[parts.length-1]+=text[i];}
 for(const part of parts){
  const pieces=split(part.trim(),':').map(v=>v.trim());if(!pieces.some(Boolean))continue;
  const middle=pieces.length>=3?pieces.slice(1,-1).join(':'):'',whole=pieces.join(':');
  links.push(/\.pdf$/i.test(middle)?middle:/\.pdf$/i.test(whole)?whole.replace(/^:+/,''):pieces.find(v=>/\.pdf$/i.test(v))||middle||whole);
 }
 return links.filter(Boolean);
}
const fileLinks=list=>list.map(v=>String(v).trim()).filter(v=>v&&v.length<=2000).slice(0,20);
// Every importer returns records plus what it could not carry over.
function report(){return {skipped:[],unsupported:{},attachments:0};}
const note=(r,field)=>{r.unsupported[field]=(r.unsupported[field]||0)+1;};
function finish(records,r){
 if(!records.length||records.length>1000)throw Error(records.length?tr('한 번에 1000개 이하의 항목을 가져오세요.'):tr('가져올 수 있는 서지 항목이 없습니다.'));
 for(const record of records){
  if(Object.values(record).some(v=>typeof v==='string'&&v.length>(v===record.abstract?20000:1000))||record.tags.length>100||record.tags.some(t=>t.length>60))throw Error(tr('서지 필드가 너무 깁니다.'));
  Object.assign(record,bibliographyPatch(Object.fromEntries(Object.entries(record).filter(([k])=>k==='type'||k==='creators'||FIELDS.includes(k)))));
  if(record.doi){try{record.doi=normalizeDOI(record.doi);}catch{note(r,tr('DOI 형식 오류'));record.doi='';}}
 }
 return {records,report:r};
}
function record(fields){
 const creators=(fields.creators||[]).slice(0,500),date=plain(fields.date);
 return {type:fields.type||'article-journal',title:plain(fields.title),authors:creatorsText(creators).slice(0,1000)||'저자 미입력',creators,year:(/\d{4}/.exec(date)||/\d{4}/.exec(plain(fields.year))||['—'])[0],date:/^\d{4}(-\d{2}(-\d{2})?)?$/.test(date)?date:'',journal:plain(fields.journal),volume:plain(fields.volume),issue:plain(fields.issue),pages:plain(fields.pages),publisher:plain(fields.publisher),place:plain(fields.place),isbn:plain(fields.isbn),issn:plain(fields.issn),url:plain(fields.url),accessed:/^\d{4}(-\d{2}(-\d{2})?)?$/.test(plain(fields.accessed))?plain(fields.accessed):'',abstract:String(fields.abstract||'').trim(),doi:plain(fields.doi),citekey:/^[A-Za-z0-9_:.\-]{1,100}$/.test(plain(fields.citekey))?plain(fields.citekey):'',tags:(fields.tags||[]).map(plain).filter(Boolean),...(fields.files?.length?{files:fields.files}:{})}; // i18n:keep — the stored value for no author
}
const risDate=value=>{const m=/^(\d{4})(?:[\/-](\d{1,2})?(?:[\/-](\d{1,2})?)?)?/.exec(plain(value));return m?[m[1],m[2]&&m[2].padStart(2,'0'),m[2]&&m[3]&&m[3].padStart(2,'0')].filter(Boolean).join('-'):'';};
function parseRIS(text,{withReport=false}={}){
 if(typeof text!=='string'||text.length>2e6)throw Error(tr('2MB 이하의 RIS 파일을 선택하세요.'));
 const records=[],r=report();let fields=null,last=null,type='';
 const used=new Set(['TY','ER','TI','T1','AU','A1','PY','Y1','DA','JO','JF','T2','JA','J2','BT','DO','KW','VL','IS','SP','EP','PB','CY','SN','UR','Y2','AB','N2','ID','L1','L4']);
 for(const line of text.replace(/^\uFEFF/,'').split(/\r?\n/)){
  const match=line.match(/^([A-Z][A-Z0-9])\s{2}- ?(.*)$/);
  if(!match){if(fields&&last&&line.trim())fields[last][fields[last].length-1]+=' '+line.trim();continue;}
  const [,key,value]=match;if(key==='TY'){if(fields)throw Error(tr('RIS 항목의 ER 구분을 확인하세요.'));fields={};last=null;type=value.trim();continue;}
  if(key==='ER'){
   if(!fields)throw Error(tr('RIS 항목의 TY 구분을 확인하세요.'));
   const first=(...keys)=>keys.map(k=>fields[k]?.[0]).find(Boolean)||'';const title=first('TI','T1');
   if(!title){r.skipped.push({index:records.length+r.skipped.length+1,reason:tr('제목 없음')});fields=null;continue;}
   for(const key of Object.keys(fields))if(!used.has(key))note(r,'RIS '+key);
   r.attachments+=(fields.L1||[]).length+(fields.L4||[]).length;
   const files=fileLinks([...(fields.L1||[]),...(fields.L4||[])]);
   const book=['BOOK','EBOOK','EDBOOK'].includes(type),sp=first('SP'),ep=first('EP'),sn=first('SN');
   records.push(record({type:RIS_IN[type]||'other',title,creators:(fields.AU||fields.A1||[]).map(name=>{const at=name.indexOf(',');return at>0&&name.slice(at+1).trim()?{family:name.slice(0,at).trim(),given:name.slice(at+1).trim()}:{literal:name.trim()};}).filter(c=>c.literal!==''),year:first('PY','Y1').slice(0,4),date:risDate(first('DA','PY','Y1')),journal:book?first('T2'):first('JO','JF','T2','JA','J2','BT'),volume:first('VL'),issue:first('IS'),pages:sp&&ep?`${sp}–${ep}`:sp,publisher:first('PB'),place:first('CY'),isbn:/^[\d-]{10,17}X?$/i.test(sn)&&sn.replace(/-/g,'').length>8?sn:'',issn:/^\d{4}-?\d{3}[\dX]$/i.test(sn)?sn:'',url:first('UR'),accessed:risDate(first('Y2')),abstract:first('AB','N2'),doi:first('DO'),citekey:first('ID'),tags:fields.KW||[],files}));
   fields=null;last=null;continue;
  }
  if(fields){(fields[key]||=[]).push(value);last=key;}
 }
 if(fields)throw Error(tr('RIS 항목의 ER 구분을 확인하세요.'));
 const result=finish(records,r);return withReport?result:result.records;
}
// BibTeX: braces and quotes nest, "#" joins, @string macros expand.
const ACCENTS={'"':{a:'ä',o:'ö',u:'ü',A:'Ä',O:'Ö',U:'Ü',e:'ë',i:'ï'},"'":{a:'á',e:'é',i:'í',o:'ó',u:'ú',E:'É',c:'ć',n:'ń',s:'ś',z:'ź'},'`':{a:'à',e:'è',i:'ì',o:'ò',u:'ù'},'^':{a:'â',e:'ê',i:'î',o:'ô',u:'û'},'~':{n:'ñ',a:'ã',o:'õ',N:'Ñ'},'c':{c:'ç',C:'Ç'},'v':{c:'č',s:'š',z:'ž',r:'ř',e:'ě',C:'Č',S:'Š',Z:'Ž'}};
function latexText(value){
 return value.replace(/\{\\([`'"^~cv])\s*\{?\\?([A-Za-z])\}?\}|\\([`'"^~])\{?([A-Za-z])\}?|\\([cv])\{([A-Za-z])\}/g,(m,a,b,c,d,e,f)=>{const accent=a||c||e,letter=b||d||f;return ACCENTS[accent]?.[letter]||letter;})
  .replace(/\\ss\b\{?\}?/g,'ß').replace(/\\(?:o|O|aa|AA|ae|AE)\b/g,m=>({'\\o':'ø','\\O':'Ø','\\aa':'å','\\AA':'Å','\\ae':'æ','\\AE':'Æ'}[m])).replace(/\\&/g,'&').replace(/\\([%$#_])/g,'$1').replace(/--/g,'–').replace(/~/g,' ').replace(/\\textbackslash\{\}/g,'\\').replace(/[{}]/g,'').replace(/\s+/g,' ').trim();
}
function bibNames(value){
 const names=[];let depth=0,start=0;
 for(let i=0;i<value.length;i++){const c=value[i];if(c==='{')depth++;else if(c==='}')depth--;else if(!depth&&/\s/.test(c)&&value.slice(i).match(/^\s+and\s+/i)){names.push(value.slice(start,i));const skip=value.slice(i).match(/^\s+and\s+/i)[0].length;i+=skip-1;start=i+1;}}
 names.push(value.slice(start));
 return names.map(n=>n.trim()).filter(Boolean).map(name=>{
  if(/^\{[^{}]*\}$/.test(name))return {literal:latexText(name)};
  const parts=[];depth=0;let from=0;for(let i=0;i<name.length;i++){if(name[i]==='{')depth++;else if(name[i]==='}')depth--;else if(name[i]===','&&!depth){parts.push(name.slice(from,i));from=i+1;}}parts.push(name.slice(from));
  if(parts.length>=2)return {family:latexText(parts[0]),...(latexText(parts.at(-1))?{given:latexText(parts.at(-1))}:{})};
  // "First Last" is BibTeX's own rule: the last word is the family name.
  const words=name.trim().split(/\s+(?![^{]*\})/);if(words.length===1)return {literal:latexText(name)};
  return {family:latexText(words.at(-1)),given:latexText(words.slice(0,-1).join(' '))};
 });
}
function parseBibTeX(text){
 if(typeof text!=='string'||text.length>2e6)throw Error(tr('2MB 이하의 BibTeX 파일을 선택하세요.'));
 const records=[],r=report(),strings={jan:'01',feb:'02',mar:'03',apr:'04',may:'05',jun:'06',jul:'07',aug:'08',sep:'09',oct:'10',nov:'11',dec:'12'};let i=0;
 const fail=()=>{throw Error(tr('BibTeX 구문을 확인하세요.'));};
 const space=()=>{while(i<text.length&&/\s/.test(text[i]))i++;};
 const braced=()=>{let depth=0,start=++i;for(;i<text.length;i++){if(text[i]==='\\'){i++;continue;}if(text[i]==='{')depth++;else if(text[i]==='}'){if(!depth)return text.slice(start,i++);depth--;}}fail();};
 const quoted=()=>{let depth=0,start=++i;for(;i<text.length;i++){if(text[i]==='\\'){i++;continue;}if(text[i]==='{')depth++;else if(text[i]==='}')depth--;else if(text[i]==='"'&&!depth)return text.slice(start,i++);}fail();};
 const value=()=>{let out='';for(;;){space();if(text[i]==='{')out+=braced();else if(text[i]==='"')out+=quoted();else{const m=/^[A-Za-z0-9_:.\-+]+/.exec(text.slice(i));if(!m)fail();i+=m[0].length;out+=/^\d+$/.test(m[0])?m[0]:strings[m[0].toLowerCase()]??m[0];}space();if(text[i]!=='#')return out;i++;}};
 while(i<text.length){
  const at=text.indexOf('@',i);if(at<0)break;i=at+1;
  const kind=/^[A-Za-z]+/.exec(text.slice(i))?.[0]?.toLowerCase();if(!kind)continue;i+=kind.length;space();
  const open=text[i];if(open!=='{'&&open!=='(')continue;const close=open==='{'?'}':')';i++;
  if(kind==='comment'||kind==='preamble'){i--;if(open==='{')braced();else{const end=text.indexOf(')',i);i=end<0?text.length:end+1;}continue;}
  if(kind==='string'){space();const name=/^[A-Za-z0-9_:.\-]+/.exec(text.slice(i))?.[0];if(!name)fail();i+=name.length;space();if(text[i++]!=='=')fail();strings[name.toLowerCase()]=value();if(text[i]===close)i++;continue;}
  const key=/^[^,\s]+/.exec(text.slice(i))?.[0]||'';i+=key.length;space();const fields={};
  while(text[i]===','){i++;space();if(text[i]===close)break;const name=/^[A-Za-z0-9_:.\-]+/.exec(text.slice(i))?.[0];if(!name)fail();i+=name.length;space();if(text[i++]!=='=')fail();fields[name.toLowerCase()]=value();}
  space();if(text[i]!==close)fail();i++;
  const get=(...names)=>{for(const n of names)if(fields[n])return latexText(fields[n]);return '';};
  if(!get('title')){r.skipped.push({index:records.length+r.skipped.length+1,reason:tr('제목 없음')});continue;}
  const known=['title','author','editor','year','date','month','journal','journaltitle','booktitle','volume','number','issue','pages','publisher','school','institution','organization','address','location','isbn','issn','doi','url','urldate','abstract','keywords','note','file'];
  for(const name of Object.keys(fields))if(!known.includes(name))note(r,'BibTeX '+name);
  if(fields.editor)note(r,'BibTeX editor');
  const files=fields.file?fileLinks(bibFiles(fields.file)):[];r.attachments+=files.length;
  const month=get('month'),year=get('year'),date=get('date')||(year&&/^\d{1,2}$/.test(month)?`${year}-${month.padStart(2,'0')}`:year);
  const accessed=get('urldate')||(/accessed\s+(\d{4}-\d{2}-\d{2})/i.exec(get('note'))||[])[1]||'';
  records.push(record({type:BIB_IN[kind]||'other',title:get('title'),creators:fields.author?bibNames(fields.author):[],date,year,journal:get('journal','journaltitle','booktitle'),volume:get('volume'),issue:get('number','issue'),pages:get('pages'),publisher:get('publisher','school','institution','organization'),place:get('address','location'),isbn:get('isbn'),issn:get('issn'),doi:get('doi'),url:get('url'),accessed,abstract:get('abstract'),citekey:key,tags:get('keywords').split(/[,;]/).map(t=>t.trim()).filter(Boolean),files}));
 }
 return finish(records,r);
}
function parseCSL(text){
 if(typeof text!=='string'||text.length>5e6)throw Error(tr('5MB 이하의 CSL JSON 파일을 선택하세요.'));
 let items;try{items=JSON.parse(text);}catch{throw Error(tr('CSL JSON 형식을 확인하세요.'));}
 if(!Array.isArray(items))items=items?.items;if(!Array.isArray(items))throw Error(tr('CSL JSON 항목 배열을 찾지 못했습니다.'));
 const records=[],r=report(),known=new Set(['id','type','title','author','issued','container-title','volume','issue','page','publisher','publisher-place','ISBN','ISSN','DOI','URL','accessed','abstract','keyword']);
 const date=d=>Array.isArray(d?.['date-parts']?.[0])?d['date-parts'][0].filter(Number.isInteger).slice(0,3).map((n,i)=>i?String(n).padStart(2,'0'):String(n)).join('-'):typeof d?.raw==='string'?(/\d{4}(-\d{2}(-\d{2})?)?/.exec(d.raw)||[''])[0]:'';
 for(const [index,item] of items.entries()){
  const str=v=>typeof v==='string'||typeof v==='number'?String(v):'';
  if(!item||typeof item!=='object'||!str(item.title).trim()){r.skipped.push({index:index+1,reason:tr('제목 없음')});continue;}
  for(const key of Object.keys(item))if(!known.has(key))note(r,'CSL '+key);
  const type={'article':'article-journal','article-magazine':'article-journal','article-newspaper':'article-journal','post-weblog':'webpage','post':'webpage','manuscript':'preprint'}[item.type]||(Object.hasOwn(TYPES,item.type)?item.type:'other');
  records.push(record({type,title:str(item.title),creators:(Array.isArray(item.author)?item.author:[]).map(a=>a?.family?{family:str(a.family),...(str(a.given)?{given:str(a.given)}:{})}:str(a?.literal)?{literal:str(a.literal)}:null).filter(Boolean),date:date(item.issued),year:date(item.issued).slice(0,4),journal:str(item['container-title']),volume:str(item.volume),issue:str(item.issue),pages:str(item.page),publisher:str(item.publisher),place:str(item['publisher-place']),isbn:str(item.ISBN),issn:str(item.ISSN),doi:str(item.DOI),url:str(item.URL),accessed:date(item.accessed),abstract:str(item.abstract),citekey:str(item.id),tags:str(item.keyword).split(/[,;]/).map(t=>t.trim()).filter(Boolean)}));
 }
 return finish(records,r);
}
function parseBibliography(text,name=''){
 const trimmed=String(text).replace(/^\uFEFF/,'').trimStart();
 if(/\.json$/i.test(name)||trimmed.startsWith('[')||trimmed.startsWith('{'))return parseCSL(trimmed);
 if(/\.bib$/i.test(name)||trimmed.startsWith('@')||/^%/.test(trimmed))return parseBibTeX(text);
 return parseRIS(text,{withReport:true});
}

// ---- Citations (APA 7th, Vancouver/NLM) for the supported types ----
// Both return {text, html}: html carries the italics a word processor keeps.
const esc=value=>String(value).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const initials=(given,dots=true)=>plain(given).split(/\s+/).filter(Boolean).map(word=>word.split('-').map(part=>part[0]?part[0].toUpperCase()+(dots?'.':''):'').join(dots?'-':'')).join(dots?' ':'');
const sentence=text=>{const t=plain(text);return t&&!/[.?!]$/.test(t)?t+'.':t;};
const pageRange=p=>plain(p).replace(/\s*-{1,2}\s*/g,'–');
function apaNames(list){
 const names=list.map(c=>c.literal??(c.given?`${c.family}, ${initials(c.given)}`:c.family));
 if(names.length<=1)return names.join('');if(names.length===2)return `${names[0]}, & ${names[1]}`;
 if(names.length<=20)return `${names.slice(0,-1).join(', ')}, & ${names.at(-1)}`;
 return `${names.slice(0,19).join(', ')}, . . . ${names.at(-1)}`;
}
function apaReference(p,suffix=''){
 const type=p.type||'article-journal',creators=creatorsOf(p),year=yearOf(p),doi=plain(p.doi),link=doi?`https://doi.org/${doi}`:plain(p.url);
 const title=plain(p.title),container=plain(p.journal),date=`(${year?year+suffix:'n.d.'+(suffix?'-'+suffix:'')})`;
 const italicTitle=['book','report','thesis','webpage'].includes(type);
 const parts=[],html=[],push=(t,h=esc(t))=>{if(t){parts.push(t);html.push(h);}};
 const author=apaNames(creators);
 if(author){push(sentence(author));push(date+'.');push(italicTitle?sentence(title):sentence(title),italicTitle?`<i>${esc(sentence(title).replace(/\.$/,''))}</i>.`:undefined);}
 else{push(italicTitle?sentence(title):sentence(title),italicTitle?`<i>${esc(sentence(title).replace(/\.$/,''))}</i>.`:undefined);push(date+'.');}
 if(type==='article-journal'||type==='preprint'){
  if(container){const vol=plain(p.volume),iss=plain(p.issue),pages=pageRange(p.pages);let t=container,h=`<i>${esc(container)}</i>`;if(vol){t+=`, ${vol}`;h+=`, <i>${esc(vol)}</i>`;}if(iss){t+=`(${iss})`;h+=`(${esc(iss)})`;}if(pages){t+=`, ${pages}`;h+=`, ${esc(pages)}`;}push(t+'.',h+'.');}
 }else if(type==='chapter'||type==='paper-conference'){
  if(container){const pages=pageRange(p.pages),t=`In ${container}${pages?` (pp. ${pages})`:''}.`;push(t,`In <i>${esc(container)}</i>${pages?` (pp. ${esc(pages)})`:''}.`);}
  if(plain(p.publisher))push(sentence(p.publisher));
 }else if(type==='thesis'){
  if(plain(p.publisher)){parts[parts.length-1]=parts.at(-1).replace(/\.$/,'')+` [Doctoral dissertation, ${plain(p.publisher)}].`;html[html.length-1]=html.at(-1).replace(/\.$/,'')+` [Doctoral dissertation, ${esc(plain(p.publisher))}].`;}
 }else if(plain(p.publisher)&&p.publisher!==author)push(sentence(p.publisher));
 if(link)push(link);
 return {text:parts.join(' '),html:html.join(' ')};
}
function vancouverReference(p,number){
 const type=p.type||'article-journal',creators=creatorsOf(p),year=yearOf(p);
 let names=creators.slice(0,6).map(c=>c.literal??(c.given?`${c.family} ${initials(c.given,false)}`:c.family)).join(', ');
 if(creators.length>6)names+=', et al';
 const parts=[];if(names)parts.push(sentence(names));parts.push(sentence(p.title));
 const container=plain(p.journal),vol=plain(p.volume),iss=plain(p.issue),pages=pageRange(p.pages).replace(/^(\d+)–\1(\d+)$/,'$1–$2');
 if(type==='article-journal'||type==='preprint'){if(container)parts.push(sentence(container));parts.push(`${year||'[date unknown]'}${vol?';'+vol:''}${iss?`(${iss})`:''}${pages?':'+pages:''}.`);}
 else if(type==='chapter'||type==='paper-conference'){if(container)parts.push(`In: ${sentence(container)}`);parts.push(`${[plain(p.place),plain(p.publisher)].filter(Boolean).join(': ')||''}${plain(p.publisher)||plain(p.place)?'; ':''}${year}.`.trim());if(pages)parts.push(`p. ${pages}.`);}
 else parts.push(`${[plain(p.place),plain(p.publisher)].filter(Boolean).join(': ')}${plain(p.publisher)||plain(p.place)?'; ':''}${year||'[date unknown]'}.`);
 if(plain(p.doi))parts.push(`doi:${plain(p.doi)}`);else if(plain(p.url))parts.push(`Available from: ${plain(p.url)}`);
 const text=(number?`${number}. `:'')+parts.join(' ');return {text,html:esc(text)};
}
// The locator (page, figure…) belongs to the citation, never to the record.
function inTextCitation(papers,style,{locator='',numbers=[]}={}){
 if(style==='vancouver')return `[${numbers.length?numbers.join(','):papers.map((_,i)=>i+1).join(',')}]`;
 const loc=plain(locator)?`, ${/^\d/.test(plain(locator))?(/[-–,]/.test(plain(locator))?'pp. ':'p. '):''}${plain(locator)}`:'';
 return `(${papers.map(p=>{const c=creatorsOf(p),name=n=>n.literal??n.family,year=yearOf(p)||'n.d.';const who=!c.length?`“${plain(p.title)}”`:c.length===1?name(c[0]):c.length===2?`${name(c[0])} & ${name(c[1])}`:`${name(c[0])} et al.`;return `${who}, ${year}${p.yearSuffix||''}`;}).join('; ')}${loc})`;
}
function referenceList(papers,style){
 const list=papers.filter(p=>!p.trashedAt);
 if(style==='vancouver')return list.map((p,i)=>vancouverReference(p,i+1));
 if(style!=='apa')throw Error(tr('인용 형식을 확인하세요.'));
 // APA: alphabetical by author, then year; same authors and year get a, b, c.
 const key=p=>(apaNames(creatorsOf(p))||plain(p.title)).toLowerCase();
 const sorted=[...list].sort((a,b)=>key(a).localeCompare(key(b),'en')||yearOf(a).localeCompare(yearOf(b))||plain(a.title).localeCompare(plain(b.title),'en'));
 const groups=new Map();for(const p of sorted){const k=key(p)+'|'+yearOf(p);groups.set(k,[...(groups.get(k)||[]),p]);}
 return sorted.map(p=>{const group=groups.get(key(p)+'|'+yearOf(p)),suffix=group.length>1?String.fromCharCode(97+group.indexOf(p)):'';return {...apaReference(p,suffix),id:p.id,suffix};});
}
module.exports={TYPES,FIELDS,normalizeDOI,crossrefMetadata,dataciteMetadata,titleSimilarity,bestTitleMatch,pdfOwnMetadata,compareMetadata,fileNameFor,bibliographyPatch,creatorsOf,creatorsText,parseCreatorLines,creatorLines,citekeyOf,exportBibliography,cslItem,parseRIS,parseBibTeX,parseCSL,parseBibliography,apaReference,vancouverReference,inTextCitation,referenceList};
