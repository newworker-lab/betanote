const {test}=require('node:test');
const assert=require('node:assert/strict');
const {normalizeDOI,crossrefMetadata,compareMetadata,exportBibliography,parseRIS,parseBibTeX,parseCSL,parseBibliography,parseCreatorLines,referenceList,inTextCitation,vancouverReference,bibliographyPatch}=require('../desktop/bibliography.cjs');
const appName = require('../core/app-name.cjs'), [nameBefore, nameFirst] = appName.history;
test('DOI normalization and Crossref mapping reject invalid records',()=>{
 assert.equal(normalizeDOI(' https://doi.org/10.1234/abc '),'10.1234/abc');assert.throws(()=>normalizeDOI('https://example.com'));
 const mapped=crossrefMetadata({DOI:'10.1234/abc',type:'journal-article',title:['<i>Research</i> &amp; data'],author:[{given:'Jane',family:'Doe'},{name:'WHO Group'}],published:{'date-parts':[[2025,3]]},'container-title':['Journal'],volume:'12',issue:'3',page:'45-67'});
 assert.deepEqual([mapped.title,mapped.authors,mapped.year,mapped.date,mapped.journal,mapped.doi,mapped.type,mapped.pages],['Research & data','Jane Doe; WHO Group','2025','2025-03','Journal','10.1234/abc','article-journal','45–67']);assert.deepEqual(mapped.creators,[{family:'Doe',given:'Jane'},{literal:'WHO Group'}]);assert.throws(()=>crossrefMetadata({}));
});
test('RIS roundtrip preserves multiple authors, tags and Unicode without record injection',()=>{
 const paper={id:42,title:'연구\nTI  - injected',authors:'Jane Doe; Kim',year:'2025',journal:'Journal',doi:'10.1234/abc',tags:['번역','연구']},text=exportBibliography([paper,{...paper,trashedAt:'now'}],'ris'),records=parseRIS(text);assert.equal(records.length,1);assert.equal(records[0].title,'연구 TI  - injected');assert.equal(records[0].authors,'Jane Doe; Kim');assert.deepEqual(records[0].tags,paper.tags);assert.throws(()=>parseRIS('TY  - JOUR\nTI  - incomplete'));assert.throws(()=>parseRIS('TY  - JOUR\nER  -'));
});
test('BibTeX escapes special characters and emits stable citation keys',()=>{
 // An item without a key of its own is cited as beta<id>; a key the reader gave (an earlier default among them) is kept.
 const {citekeyOf}=require('../desktop/bibliography.cjs');assert.equal(citekeyOf({id:12}),`${appName.citekeyPrefix}12`);assert.equal(citekeyOf({id:12,citekey:`${nameBefore.citekeyPrefix}12`}),`${nameBefore.citekeyPrefix}12`);
 const text=exportBibliography([{id:42,title:'A {title} & 50%',authors:'Jane; Kim',year:'2025',tags:[]}],'bib');assert.match(text,new RegExp('@article\\{'+appName.citekeyPrefix+'42,'));assert.ok(text.includes('\\{title\\} \\& 50\\%'));assert.match(text,/\{Jane\} and \{Kim\}/);assert.throws(()=>exportBibliography([],'html'));
});

const doe={id:1,type:'article-journal',title:'Learning layouts from papers',creators:[{family:'Doe',given:'Jane Ann'},{family:'Kim',given:'Min-Jun'}],date:'2024-05',year:'2024',journal:'Journal of Reading',volume:'12',issue:'3',pages:'45-67',doi:'10.1234/abc',tags:[]};
test('APA 7 and Vancouver references match expected text for the supported types',()=>{
 const [a]=referenceList([doe],'apa');
 assert.equal(a.text,'Doe, J. A., & Kim, M.-J. (2024). Learning layouts from papers. Journal of Reading, 12(3), 45–67. https://doi.org/10.1234/abc');
 assert.equal(a.html,'Doe, J. A., &amp; Kim, M.-J. (2024). Learning layouts from papers. <i>Journal of Reading</i>, <i>12</i>(3), 45–67. https://doi.org/10.1234/abc');
 const book={id:2,type:'book',title:'Research methods',creators:[{literal:'World Health Organization'}],year:'2020',publisher:'WHO Press',tags:[]};
 assert.equal(referenceList([book],'apa')[0].text,'World Health Organization. (2020). Research methods. WHO Press.');
 assert.equal(referenceList([book],'apa')[0].html,'World Health Organization. (2020). <i>Research methods</i>. WHO Press.');
 const chapter={id:3,type:'chapter',title:'A chapter',creators:[{family:'Lee',given:'S.'}],year:'2019',journal:'Edited book',pages:'10-20',publisher:'Press',tags:[]};
 assert.equal(referenceList([chapter],'apa')[0].text,'Lee, S. (2019). A chapter. In Edited book (pp. 10–20). Press.');
 // Korean author strings stay whole; no date gives n.d.
 assert.equal(referenceList([{id:4,title:'한국어 논문',authors:'홍길동; 김철수',year:'—',journal:'한국학회지',tags:[]}],'apa')[0].text,'홍길동, & 김철수. (n.d.). 한국어 논문. 한국학회지.');
 // Same authors, same year: a and b, in title order; the in-text citation follows.
 const second={...doe,id:5,title:'Another study',doi:''},list=referenceList([doe,second],'apa');
 assert.deepEqual(list.map(r=>r.text.slice(0,32)),['Doe, J. A., & Kim, M.-J. (2024a)','Doe, J. A., & Kim, M.-J. (2024b)']);
 const many={...doe,id:6,creators:Array.from({length:22},(_,i)=>({family:'A'+i,given:'B'}))};
 assert.match(referenceList([many],'apa')[0].text,/A18, B\., \. \. \. A21, B\. \(2024\)/);
 assert.equal(vancouverReference({...many,creators:many.creators.slice(0,7)},1).text,'1. A0 B, A1 B, A2 B, A3 B, A4 B, A5 B, et al. Learning layouts from papers. Journal of Reading. 2024;12(3):45–67. doi:10.1234/abc');
 assert.equal(vancouverReference(doe).text,'Doe JA, Kim MJ. Learning layouts from papers. Journal of Reading. 2024;12(3):45–67. doi:10.1234/abc');
});
test('in-text citations keep the locator out of the record',()=>{
 assert.equal(inTextCitation([doe],'apa',{locator:'12'}),'(Doe & Kim, 2024, p. 12)');
 assert.equal(inTextCitation([doe],'apa',{locator:'12-14'}),'(Doe & Kim, 2024, pp. 12-14)');
 assert.equal(inTextCitation([{...doe,creators:[...doe.creators,{family:'Park',given:'J'}]}],'apa'),'(Doe et al., 2024)');
 assert.equal(inTextCitation([doe,doe],'vancouver',{numbers:[2,5]}),'[2,5]');
 assert.equal(doe.locator,undefined);
});
test('RIS, BibTeX, BibLaTeX and CSL JSON round-trip supported fields',()=>{
 const paper={...doe,place:'Seoul',publisher:'Pub',url:'https://example.org',accessed:'2026-10-01',abstract:'Abstract text.',citekey:'doe2024',tags:['layout']};
 const fields=r=>[r.type,r.title,JSON.stringify(r.creators),r.date.slice(0,7),r.journal,r.volume,r.issue,r.pages.replace('–','-'),r.doi,r.url,r.accessed,r.abstract,r.citekey,JSON.stringify(r.tags)];
 const expected=fields({...paper,pages:'45-67'});
 assert.deepEqual(fields(parseRIS(exportBibliography([paper],'ris'))[0]),expected);
 assert.deepEqual(fields(parseBibTeX(exportBibliography([paper],'biblatex')).records[0]),expected);
 assert.deepEqual(fields(parseCSL(exportBibliography([paper],'csl')).records[0]),expected);
 const bib=parseBibTeX(exportBibliography([paper],'bib')).records[0];assert.deepEqual([bib.type,bib.journal,bib.volume,bib.issue,bib.citekey],['article-journal','Journal of Reading','12','3','doe2024']);
});
test('BibTeX from reference managers: accents, organizations, macros, attachments and unsupported fields are reported',()=>{
 const text=`@string{jr = "Journal of Reading"}
@comment{ignored}
@article{muller2021,
  author = {M{\\"u}ller, J{\\"o}rg and {Korea Institute of Science} and Ann Smith},
  title = {{DNA} layouts \\& tables},
  journal = jr # " Letters",
  year = 2021, month = mar,
  pages = {1--9},
  file = {Full Text:files/12/paper.pdf:application/pdf},
  mendeley-groups = {x},
}
@book{nobody, year = {2000}}`;
 const {records,report}=parseBibliography(text,'library.bib');
 assert.equal(records.length,1);const r=records[0];
 assert.deepEqual(r.creators,[{family:'Müller',given:'Jörg'},{literal:'Korea Institute of Science'},{family:'Smith',given:'Ann'}]);
 assert.deepEqual([r.title,r.journal,r.date,r.pages],['DNA layouts & tables','Journal of Reading Letters','2021-03','1–9']);
 assert.equal(report.attachments,1);assert.deepEqual(report.unsupported,{'BibTeX mendeley-groups':1});assert.deepEqual(report.skipped,[{index:2,reason:'제목 없음'}]);
 assert.throws(()=>parseBibTeX('@article{x, title = {open'),/구문/);
});
test('CSL JSON and RIS imports report what they cannot carry; DOI lookups never overwrite edits',()=>{
 const csl=parseBibliography(JSON.stringify([{id:'a',type:'article-journal',title:'T',author:[{family:'Doe',given:'J'}],issued:{'date-parts':[[2020,1,2]]},note:'x'},{title:''}]),'items.json');
 assert.deepEqual([csl.records[0].date,csl.report.unsupported,csl.report.skipped.length],['2020-01-02',{'CSL note':1},1]);
 const ris=parseBibliography('TY  - BOOK\nTI  - Book\nAU  - Doe, Jane\nT2  - Series\nSN  - 978-3-16-148410-0\nL1  - file:///x.pdf\nM3  - misc\nER  - \n','x.ris');
 assert.deepEqual([ris.records[0].type,ris.records[0].isbn,ris.report.attachments,ris.report.unsupported],['book','978-3-16-148410-0',1,{'RIS M3':1}]);
 const {fill,conflicts}=compareMetadata({title:'My edited title',authors:'저자 미입력',year:'—',journal:'',doi:''},{title:'Crossref title',authors:'Jane Doe',creators:[{family:'Doe',given:'Jane'}],year:'2025',journal:'J',doi:'10.1/x'});
 assert.deepEqual(fill,{authors:'Jane Doe',year:'2025',journal:'J',doi:'10.1/x',creators:[{family:'Doe',given:'Jane'}]});
 assert.deepEqual(conflicts,[{field:'title',current:'My edited title',candidate:'Crossref title'}]);
 assert.deepEqual(parseCreatorLines('Doe, Jane\n세계보건기구\n홍길동'),[{family:'Doe',given:'Jane'},{literal:'세계보건기구'},{literal:'홍길동'}]);
 assert.throws(()=>bibliographyPatch({date:'May 2020'}),/날짜/);assert.throws(()=>bibliographyPatch({citekey:'has space'}),/인용 키/);assert.throws(()=>bibliographyPatch({type:'blog'}),/유형/);
});

test('file names come from the first author, year and title, without invented parts or unsafe characters',()=>{
 const {fileNameFor}=require('../desktop/bibliography.cjs');
 assert.equal(fileNameFor({creators:[{family:'Doe',given:'Jane'}],year:'2024',title:'Crossref title differs: growth curves in fed-batch cell culture processes.'}),'Doe_2024_Crossref title differs growth curves in fed-batch cell.pdf');
 assert.equal(fileNameFor({authors:'Kim, H.; Lee, J.',year:'—',date:'2019-03',title:'Deep/monitoring?'}),'Kim_2019_Deep monitoring.pdf');
 assert.equal(fileNameFor({creators:[{literal:'World Health Organization'}],year:'2020',title:'Report'}),'World_2020_Report.pdf');
 assert.equal(fileNameFor({authors:'저자 미입력',year:'—',title:''}),null);
});

test('metadata without a printed DOI: DataCite records, near-identical title matches, and the PDF’s own information',()=>{
  const {dataciteMetadata,titleSimilarity,bestTitleMatch,pdfOwnMetadata}=require('../desktop/bibliography.cjs');
  const arxiv=dataciteMetadata({doi:'10.48550/arXiv.2101.01234',titles:[{title:'Attention <i>is</i> all you need'}],creators:[{name:'Vaswani, Ashish',givenName:'Ashish',familyName:'Vaswani'},{name:'Google Brain',nameType:'Organizational'}],publicationYear:2017,publisher:{name:'arXiv'},types:{resourceTypeGeneral:'Text'},url:'https://arxiv.org/abs/2101.01234',descriptions:[{description:'We propose.',descriptionType:'Abstract'}]});
  assert.equal(arxiv.title,'Attention is all you need');assert.equal(arxiv.type,'preprint');assert.equal(arxiv.journal,'arXiv');assert.equal(arxiv.publisher,'arXiv');
  assert.deepEqual(arxiv.creators,[{family:'Vaswani',given:'Ashish'},{literal:'Google Brain'}]);assert.equal(arxiv.authors,'Ashish Vaswani; Google Brain');assert.equal(arxiv.year,'2017');assert.equal(arxiv.abstract,'We propose.');
  assert.equal(dataciteMetadata({doi:'10.5281/zenodo.1',titles:[{title:'Data'}],publisher:'Zenodo',types:{resourceTypeGeneral:'Dataset'},dates:[{date:'2020-03-04',dateType:'Issued'}]}).date,'2020-03-04');
  assert.throws(()=>dataciteMetadata({titles:[]}),/서지정보 응답/);
  assert.equal(titleSimilarity('Growth curves of fed-batch cultures','Growth Curves of Fed‑Batch Cultures.'),1);
  assert.ok(titleSimilarity('Growth curves of fed-batch cultures','Growth curves of batch cultures in milk')<.9);
  assert.equal(titleSimilarity('Étude des réseaux','Etude des reseaux'),1);
  const items=[{title:['Growth curves of fed batch cultures: a review'],DOI:'10.1/a',published:{'date-parts':[[2021]]}},{title:['Growth curves of fed-batch cultures'],DOI:'10.1/b',published:{'date-parts':[[2019]]}}];
  assert.equal(bestTitleMatch(items,{title:'Growth curves of fed-batch cultures'}).item.DOI,'10.1/b');
  assert.equal(bestTitleMatch(items,{title:'Growth curves of fed-batch cultures',year:'2023'}),null,'a year more than one apart is not the same paper');
  assert.equal(bestTitleMatch(items,{title:'Something else entirely here'}),null);
  assert.deepEqual(pdfOwnMetadata({metaTitle:'A study of reading layouts',authors:['Kim, Minjun','Lee, Jiwon'],year:'2022',journal:'J. Reading',title:'IGNORED LAYOUT TITLE WORDS'}),{title:'A study of reading layouts',authors:'Kim, Minjun; Lee, Jiwon',creators:[{literal:'Kim, Minjun'},{literal:'Lee, Jiwon'}],year:'2022',date:'2022',journal:'J. Reading'});
  assert.deepEqual(pdfOwnMetadata({metaTitle:'Microsoft Word - draft3.docx',authors:'admin'}),{},'program names and file names are not titles or authors');
  assert.deepEqual(pdfOwnMetadata({metaTitle:'s41589-023-01234-5',authors:'Kim H; Lee J'}),{authors:'Kim H; Lee J',creators:[{literal:'Kim H'},{literal:'Lee J'}]},'an article number is not a title; ";" separates stated names');
  assert.deepEqual(pdfOwnMetadata({title:'Only the layout title of page one'}),{},'the layout title is only searched for, never written');
});

test('the PDFs an entry names are read as each reference manager writes them',()=>{
 const {parseBibliography}=require('../desktop/bibliography.cjs');
 const files=file=>parseBibliography(`@article{k,\n title={T},\n file={${file}}\n}`,'a.bib').records[0].files;
 assert.deepEqual(files('Full Text PDF:files/12/Smith - 2020 - Title.pdf:application/pdf'),['files/12/Smith - 2020 - Title.pdf']);
 assert.deepEqual(files('Snapshot:files/3/page.html:text/html;PDF:C\\:\\\\Users\\\\me\\\\Zotero\\\\a b.pdf:application/pdf'),['files/3/page.html','C:\\Users\\me\\Zotero\\a b.pdf']);
 assert.deepEqual(files(':C$\\backslash$:/Users/me/Mendeley/Kim 2019.pdf:pdf'),['C:/Users/me/Mendeley/Kim 2019.pdf']);
 assert.deepEqual(files(':papers/lee2021.pdf:PDF'),['papers/lee2021.pdf']);
 assert.deepEqual(files('/home/me/library/Park 2018.pdf'),['/home/me/library/Park 2018.pdf']);
 assert.deepEqual(files('desc:C:/lib/x.pdf:PDF'),['C:/lib/x.pdf']);
 const ris=parseBibliography('TY  - JOUR\nTI  - T\nL1  - file:///home/me/a.pdf\nL1  - internal-pdf://123/b.pdf\nER  -\n','a.ris');
 assert.deepEqual(ris.records[0].files,['file:///home/me/a.pdf','internal-pdf://123/b.pdf']);assert.equal(ris.report.attachments,2);
 assert.equal(parseBibliography('TY  - JOUR\nTI  - T\nER  -\n','a.ris').records[0].files,undefined);
});
