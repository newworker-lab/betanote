const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { Library } = require('../desktop/storage.cjs');
const appName = require('../core/app-name.cjs'), [nameBefore, nameFirst] = appName.history;
const pdf = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n%%EOF');
async function fixture(t) { const dir = await fs.mkdtemp(path.join(os.tmpdir(), `${appName.id}-test-`)); t.after(() => fs.rm(dir, { recursive: true, force: true })); await fs.mkdir(path.join(dir, 'vault')); return dir; }
test('copies a real file, keeps the source, restores notes and metadata on reopen', async t => {
  const dir = await fixture(t), root = path.join(dir, 'vault'), source = path.join(dir, 'paper.pdf');
  await fs.writeFile(source, pdf); let library = await Library.open(root);
  assert.equal((await library.importFiles([source]))[0].ok, true);
  const id = library.data.papers[0].id;
  await library.update(id, { tags: ['연구'], status: '완독', star: true });
  await library.saveNotes({ [`${id}-메모`]: '한글 메모' });
  library = await Library.open(root);
  const view = await library.snapshot();
  assert.equal(view.papers.length, 1); assert.equal(view.notes[`${id}-메모`], '한글 메모');
  assert.deepEqual(view.papers[0].tags, ['연구']); assert.equal(view.papers[0].star, true);
  assert.deepEqual(await fs.readFile(source), await fs.readFile(await library.resolveFile(id, 'original')));
});
test('rejects invalid and duplicate PDFs without overwriting existing content', async t => {
  const dir = await fixture(t); const source = path.join(dir, 'paper.pdf'); await fs.writeFile(source, pdf);
  const bad = path.join(dir, 'bad.pdf'); await fs.writeFile(bad, 'not a pdf');
  const disguised = path.join(dir, 'paper.txt'); await fs.writeFile(disguised, pdf);
  const library = await Library.open(path.join(dir, 'vault'));
  const results = await library.importFiles([bad, source, source, disguised]);
  assert.deepEqual(results.map(r => r.ok), [false, true, false, false]); assert.equal(library.data.papers.length, 1);
  assert.deepEqual(await fs.readFile(await library.resolveFile(library.data.papers[0].id, 'original')), pdf);
});
test('switching libraries isolates notes, metadata and attachments', async t => {
  const dir = await fixture(t), other = path.join(dir, 'other'); await fs.mkdir(other);
  const a = await Library.open(path.join(dir, 'vault')), b = await Library.open(other);
  await a.saveNotes({ note: 'only in A' }); assert.notEqual(a.data.id, b.data.id); assert.deepEqual(b.data.notes, {});
});
test('restores translated attachment and does not count it as a second paper', async t => {
  const dir = await fixture(t), source = path.join(dir, 'paper.pdf'); await fs.writeFile(source, pdf);
  let library = await Library.open(path.join(dir, 'vault')); await library.importFiles([source]);
  const id = library.data.papers[0].id; await library.importFiles([source], id);
  await library.importFiles([source], id);
  library = await Library.open(path.join(dir, 'vault')); const view = await library.snapshot();
  assert.equal(view.papers.length, 1); assert.match(view.papers[0].files.translated.url, /translated$/);
});
// Windows lets an ordinary account make a directory junction but not a file symlink (EPERM without
// developer mode): directories are linked as junctions there, and a case that needs a file link is
// skipped with that reason instead of failing.
const DIR_LINK = process.platform === 'win32' ? 'junction' : 'dir';
async function fileLink(t, target, link) { try { await fs.symlink(target, link); return true; } catch (error) { if (process.platform !== 'win32' || error.code !== 'EPERM') throw error; t.skip('이 Windows 계정은 파일 심볼릭 링크를 만들 수 없습니다(개발자 모드 필요).'); return false; } }
test('does not follow a PDF symlink or allow attachment traversal', async t => {
  const dir = await fixture(t), outside = path.join(dir, 'outside.pdf'); await fs.writeFile(outside, pdf);
  const root = path.join(dir, 'vault'); if (!await fileLink(t, outside, path.join(root, 'link.pdf'))) return;
  const library = await Library.open(root); assert.equal(library.data.papers.length, 0);
  library.data.papers.push({ id: 1, original: '../outside.pdf' });
  await assert.rejects(library.resolveFile(1, 'original'), /저장소 밖/);
});
test('corrupt metadata is reported and preserved', async t => {
  const dir = await fixture(t), root = path.join(dir, 'vault'); await fs.mkdir(path.join(root, appName.vaultDir));
  const file = path.join(root, appName.vaultDir, 'library.json'); await fs.writeFile(file, '{bad');
  await assert.rejects(Library.open(root)); assert.equal(await fs.readFile(file, 'utf8'), '{bad');
});

test('failed metadata save rolls back copied file and in-memory entry', async t => {
  const dir = await fixture(t), source = path.join(dir, 'paper.pdf'); await fs.writeFile(source, pdf);
  const library = await Library.open(path.join(dir, 'vault'));
  library.save = async () => { throw Error('disk full'); };
  const result = await library.importFiles([source]);
  assert.equal(result[0].ok, false); assert.equal(library.data.papers.length, 0);
  await assert.rejects(fs.stat(path.join(dir, 'vault', 'papers', 'paper.pdf')), { code: 'ENOENT' });
});

test('metadata directory symlink cannot redirect writes outside the vault', async t => {
  const dir = await fixture(t), external = path.join(dir, 'external'); await fs.mkdir(external);
  await fs.symlink(external, path.join(dir, 'vault', appName.vaultDir), DIR_LINK);
  await assert.rejects(Library.open(path.join(dir, 'vault')), /심볼릭/);
  assert.deepEqual(await fs.readdir(external), []);
});

test('creates real nested folders and imports into the selected folder or root',async t=>{
 const dir=await fixture(t),root=path.join(dir,'vault'),source=path.join(dir,'논문.pdf');await fs.writeFile(source,pdf);let library=await Library.open(root);
 assert.equal(await library.createFolder('','연구'),'연구');assert.equal(await library.createFolder('연구','읽을 자료'),'연구/읽을 자료');
 assert.equal((await library.importFiles([source],null,'연구/읽을 자료'))[0].ok,true);assert.equal((await library.importFiles([source],null,''))[0].ok,true);
 const paper=library.data.papers.find(p=>p.original==='연구/읽을 자료/논문.pdf');await library.update(paper.id,{tags:['태그']});await library.saveNotes({[`${paper.id}-메모`]:'유지할 메모'});library=await Library.open(root);const snapshot=await library.snapshot();
 assert.deepEqual(snapshot.folders,['연구','연구/읽을 자료']);assert.equal(snapshot.papers.length,2);assert.equal(snapshot.papers.find(p=>p.id===paper.id).folder,'연구/읽을 자료');assert.equal(snapshot.papers.find(p=>p.id===paper.id).fileName,'논문.pdf');assert.deepEqual(snapshot.papers.find(p=>p.id===paper.id).tags,['태그']);assert.equal(snapshot.notes[`${paper.id}-메모`],'유지할 메모');assert.deepEqual(await fs.readFile(path.join(root,'연구','읽을 자료','논문.pdf')),pdf);
});
test('renames a folder on disk and keeps every attachment under it linked',async t=>{
 const dir=await fixture(t),root=path.join(dir,'vault'),source=path.join(dir,'논문.pdf');await fs.writeFile(source,pdf);let library=await Library.open(root);
 await library.createFolder('','연구');await library.createFolder('연구','읽을 자료');await library.createFolder('','다른');
 await library.importFiles([source],null,'연구/읽을 자료');const paper=library.data.papers[0];await library.saveNotes({[`${paper.id}-메모`]:'유지할 메모'});
 for(const name of ['','a/b',appName.vaultDir,'CON','bad:name','trailing.','다른'])await assert.rejects(library.renameFolder('연구',name));
 await assert.rejects(library.renameFolder('','새 이름'));await assert.rejects(library.renameFolder('../outside','x'));
 const backups=(await fs.readdir(path.join(root,appName.vaultDir,'backups'))).length;
 assert.equal(await library.renameFolder('연구','프로젝트'),'프로젝트');
 assert.ok((await fs.readdir(path.join(root,appName.vaultDir,'backups'))).length>backups,'backed up first');
 await fs.access(path.join(root,'프로젝트','읽을 자료','논문.pdf'));await assert.rejects(fs.access(path.join(root,'연구')));
 library=await Library.open(root);const snapshot=await library.snapshot();
 assert.deepEqual(snapshot.folders,['다른','프로젝트','프로젝트/읽을 자료']);assert.equal(snapshot.papers.length,1,'no duplicate from the moved file');
 const moved=snapshot.papers[0];assert.equal(moved.id,paper.id);assert.equal(moved.folder,'프로젝트/읽을 자료');assert.equal(library.data.notes[`${paper.id}-메모`],'유지할 메모');
 assert.equal(await library.renameFolder('프로젝트/읽을 자료','Reading'),'프로젝트/Reading');assert.equal((await library.snapshot()).papers[0].folder,'프로젝트/Reading');
});
test('translation requests are kept per vault, trimmed, limited and removable',async t=>{
 const dir=await fixture(t),root=path.join(dir,'vault');let library=await Library.open(root);
 await library.setTranslationRules('  ~다 체로 번역\r\n용어는 영어 병기  ');library=await Library.open(root);
 assert.equal((await library.snapshot()).translationRules,'~다 체로 번역\n용어는 영어 병기');
 await assert.rejects(library.setTranslationRules('x'.repeat(2001)));await assert.rejects(library.setTranslationRules(null));
 await library.setTranslationRules('   ');assert.equal((await library.snapshot()).translationRules,'');assert.equal('translationRules' in library.data,false);
});
test('discovers external nested PDFs and empty folders on refresh without duplicating records',async t=>{
 const dir=await fixture(t),root=path.join(dir,'vault'),library=await Library.open(root);await fs.mkdir(path.join(root,'외부','빈 폴더'),{recursive:true});await fs.writeFile(path.join(root,'외부','논문.pdf'),pdf);await fs.writeFile(path.join(root,'외부','설명.txt'),'text');await fs.writeFile(path.join(root,'외부','잘못.pdf'),'invalid');
 const first=await library.snapshot(),second=await library.snapshot();assert.equal(first.papers.length,1);assert.equal(second.papers[0].id,first.papers[0].id);assert.deepEqual(second.folders,['외부','외부/빈 폴더']);assert.equal(second.papers[0].folder,'외부');
});
test('folder creation and imports reject traversal, reserved names and directory symlinks',async t=>{
 const dir=await fixture(t),root=path.join(dir,'vault'),outside=path.join(dir,'outside'),source=path.join(dir,'paper.pdf');await fs.mkdir(outside);await fs.writeFile(source,pdf);const library=await Library.open(root);
 for(const name of ['../outside','a/b',appName.vaultDir,'translations','CON','bad:name','trailing.'])await assert.rejects(library.createFolder('',name));
 await assert.rejects(library.createFolder('../outside','escape'));await assert.rejects(library.importFiles([source],null,'../outside'));
 await fs.symlink(outside,path.join(root,'link'),DIR_LINK);await assert.rejects(library.createFolder('link','escape'));await assert.rejects(library.importFiles([source],null,'link'));
 assert.deepEqual(await fs.readdir(outside),[]);assert.ok(!(await library.snapshot()).folders.includes('link'));
});
test('same-name folders and files remain intact and translated attachments stay out of the source tree',async t=>{
 const dir=await fixture(t),root=path.join(dir,'vault'),source=path.join(dir,'paper.pdf');await fs.writeFile(source,pdf);const library=await Library.open(root);await library.createFolder('','연구');await assert.rejects(library.createFolder('','연구'),/같은 이름/);
 await library.importFiles([source],null,'연구');const id=library.data.papers[0].id;await library.importFiles([source],id);const snapshot=await library.snapshot();assert.equal(snapshot.papers.length,1);assert.ok(!snapshot.folders.includes('translations'));assert.equal((await library.importFiles([source],null,'연구'))[0].ok,false);assert.deepEqual(await fs.readFile(await library.resolveFile(id,'original')),pdf);
});

test('migrates v1 into an item with stable attachments and keeps a byte-for-byte backup',async t=>{
 const dir=await fixture(t),root=path.join(dir,'vault');await fs.mkdir(path.join(root,appName.vaultDir));await fs.mkdir(path.join(root,'papers'));await fs.writeFile(path.join(root,'papers','old.pdf'),pdf);
 const legacy={version:1,id:'legacy-vault',papers:[{id:42,title:'기존 논문',authors:'Author',year:2024,journal:'Journal',tags:['유지'],status:'읽는 중',star:true,original:'papers/old.pdf'}],notes:{'42-메모':'기존 메모','42-summary-0':'연구 질문'}};const bytes=JSON.stringify(legacy);await fs.writeFile(path.join(root,appName.vaultDir,'library.json'),bytes);
 let library=await Library.open(root),snapshot=await library.snapshot();assert.equal(library.data.version,2);assert.equal(snapshot.papers[0].id,42);assert.equal(snapshot.papers[0].attachments.length,1);assert.equal(snapshot.papers[0].attachments[0].id,'original-42');assert.equal(snapshot.notes['42-메모'],'기존 메모');assert.deepEqual(snapshot.papers[0].tags,['유지']);assert.equal(await fs.readFile(path.join(root,appName.vaultDir,'library.v1.backup.json'),'utf8'),bytes);
 library=await Library.open(root);assert.equal(library.data.papers[0].primaryAttachmentId,'original-42');assert.equal(await fs.readFile(path.join(root,appName.vaultDir,'library.v1.backup.json'),'utf8'),bytes);const disk=JSON.parse(await fs.readFile(library.file,'utf8'));assert.equal(disk.papers[0].original,undefined);assert.equal(disk.papers[0].attachments[0].path,'papers/old.pdf');
});
test('multiple attachments share one item and changing primary preserves metadata and notes',async t=>{
 const dir=await fixture(t),root=path.join(dir,'vault'),a=path.join(dir,'a.pdf'),b=path.join(dir,'b.pdf');await fs.writeFile(a,pdf);await fs.writeFile(b,Buffer.concat([pdf,Buffer.from('version B')]));let library=await Library.open(root);await library.importFiles([a]);const paper=library.data.papers[0],originalId=paper.primaryAttachmentId;await library.update(paper.id,{doi:'10.1234/test',tags:['논문 태그']});await library.saveNotes({[paper.id+'-메모']:'공통 메모'});
 const result=await library.importPDFs([b],{paperId:paper.id,role:'version',folder:'papers'});assert.equal(result[0].ok,true);await library.setPrimary(paper.id,result[0].attachmentId);library=await Library.open(root);const view=await library.snapshot();assert.equal(view.papers.length,1);assert.equal(view.papers[0].attachments.length,2);assert.equal(view.papers[0].primaryAttachmentId,result[0].attachmentId);assert.equal(view.papers[0].doi,'10.1234/test');assert.equal(view.notes[paper.id+'-메모'],'공통 메모');assert.equal(path.basename(await library.resolveFile(paper.id,'attachment-'+originalId)),'a.pdf');assert.equal(path.basename(await library.resolveFile(paper.id,'original')),'b.pdf');
});
test('collections reference items without copying files and invalid metadata changes roll back',async t=>{
 const dir=await fixture(t),a=path.join(dir,'a.pdf');await fs.writeFile(a,pdf);const library=await Library.open(path.join(dir,'vault'));await library.importFiles([a]);const paper=library.data.papers[0],x=await library.createCollection('연구'),y=await library.createCollection('학위논문');await library.update(paper.id,{collectionIds:[x.id,y.id]});assert.equal(paper.attachments.length,1);assert.equal((await fs.readdir(path.join(dir,'vault','papers'))).length,1);
 await assert.rejects(library.update(paper.id,{title:'잘못된 수정',collectionIds:['missing']}),/컬렉션/);assert.equal(library.paper(paper.id).title,'a');assert.deepEqual(library.paper(paper.id).collectionIds,[x.id,y.id]);
});
test('annotations belong to one attachment and hash, independently of shared item notes',async t=>{
 const dir=await fixture(t),a=path.join(dir,'a.pdf'),b=path.join(dir,'b.pdf');await fs.writeFile(a,pdf);await fs.writeFile(b,Buffer.concat([pdf,Buffer.from('other')]));const library=await Library.open(path.join(dir,'vault'));await library.importFiles([a]);const paper=library.data.papers[0];await library.importPDFs([b],{paperId:paper.id,role:'supplement',folder:'papers'});const [first,second]=paper.attachments;
 await library.addAnnotation(paper.id,first.id,{page:1,quote:'source',body:'첫 파일 주석',sourceHash:first.sourceHash});await library.addAnnotation(paper.id,second.id,{page:2,body:'두 번째 주석',sourceHash:second.sourceHash});assert.deepEqual(library.data.annotations.map(a=>a.attachmentId),[first.id,second.id]);await assert.rejects(library.addAnnotation(paper.id,'wrong-id',{page:1,body:'wrong'}),/첨부/);await fs.appendFile(await library.resolveFile(paper.id,'attachment-'+first.id),'changed');await assert.rejects(library.addAnnotation(paper.id,first.id,{page:1,body:'stale',sourceHash:first.sourceHash}),/변경/);assert.equal(library.data.annotations.length,2);
});
test('duplicate suggestions do not merge automatically; confirmed merge preserves file identities and all notes',async t=>{
 const dir=await fixture(t),a=path.join(dir,'a.pdf'),b=path.join(dir,'b.pdf');await fs.writeFile(a,pdf);await fs.writeFile(b,pdf);let library=await Library.open(path.join(dir,'vault'));await library.importFiles([a,b]);const [first,second]=library.data.papers,secondAttachment=second.attachments[0].id;await library.update(first.id,{tags:['A'],doi:'10.1234/SAME'});await library.update(second.id,{tags:['B'],doi:'https://doi.org/10.1234/same'});await library.saveNotes({[first.id+'-메모']:'A 메모',[second.id+'-메모']:'B 메모',[first.id+'-메모#pin']:'{"page":1}',[second.id+'-메모#pin']:'{"page":2}',[second.id+'-메모-x#pin']:'{"page":3}'});await library.addAnnotation(second.id,secondAttachment,{page:1,body:'B 주석',sourceHash:second.attachments[0].sourceHash});
 const suggestions=await library.duplicates();assert.equal(library.data.papers.length,2);assert.deepEqual(suggestions[0].reasons.sort(),['동일 DOI','동일 PDF']);await library.mergePapers(first.id,second.id);library=await Library.open(path.join(dir,'vault'));assert.equal(library.data.papers.length,1);assert.equal(library.paper(first.id).attachments.length,2);assert.ok(library.paper(first.id).attachments.some(a=>a.id===secondAttachment&&a.cacheOwnerId===second.id));assert.match(library.data.notes[first.id+'-메모'],/A 메모/);assert.match(library.data.notes[first.id+'-메모'],/B 메모/);assert.equal(library.data.notes[first.id+'-메모#pin'],'{"page":1}');assert.equal(library.data.notes[first.id+'-메모-x#pin'],'{"page":3}');assert.equal(library.data.annotations[0].paperId,first.id);assert.equal(library.data.annotations[0].attachmentId,secondAttachment);assert.deepEqual(await fs.readFile(await library.resolveFile(first.id,'attachment-'+secondAttachment)),pdf);
});
test('failed merge restores both items, notes and attachment ownership',async t=>{
 const dir=await fixture(t),a=path.join(dir,'a.pdf'),b=path.join(dir,'b.pdf');await fs.writeFile(a,pdf);await fs.writeFile(b,pdf);const library=await Library.open(path.join(dir,'vault'));await library.importFiles([a,b]);const [first,second]=library.data.papers;await library.saveNotes({[first.id+'-메모']:'A',[second.id+'-메모']:'B'});const before=JSON.stringify(library.data);library.save=async()=>{throw Error('disk full')};await assert.rejects(library.mergePapers(first.id,second.id),/disk full/);assert.equal(JSON.stringify(library.data),before);assert.equal(path.basename(await library.resolveFile(second.id,'original')),'b.pdf');
});

test('external rename preserves item, attachment, notes and cache identity without duplicate import',async t=>{
 const dir=await fixture(t),root=path.join(dir,'vault'),source=path.join(dir,'paper.pdf');await fs.writeFile(source,pdf);const library=await Library.open(root);await library.importFiles([source]);const paper=library.data.papers[0],attachment={...paper.attachments[0]};await library.saveNotes({[`${paper.id}-메모`]:'연결 유지'});await fs.mkdir(path.join(root,'moved'));await fs.rename(path.join(root,attachment.path),path.join(root,'moved','renamed.pdf'));
 const snapshot=await library.snapshot();assert.equal(snapshot.papers.length,1);assert.equal(snapshot.papers[0].id,paper.id);assert.equal(snapshot.papers[0].attachments[0].id,attachment.id);assert.equal(snapshot.papers[0].attachments[0].cacheKey,attachment.cacheKey);assert.equal(snapshot.papers[0].attachments[0].fileName,'renamed.pdf');assert.equal(snapshot.notes[`${paper.id}-메모`],'연결 유지');
});
test('ambiguous identical moves stay missing until explicitly reconnected',async t=>{
 const dir=await fixture(t),root=path.join(dir,'vault'),source=path.join(dir,'paper.pdf');await fs.writeFile(source,pdf);const library=await Library.open(root);await library.importFiles([source]);const paper=library.data.papers[0],a=paper.attachments[0];await fs.unlink(path.join(root,a.path));await fs.writeFile(path.join(root,'a.pdf'),pdf);await fs.writeFile(path.join(root,'b.pdf'),pdf);
 let snapshot=await library.snapshot();assert.equal(snapshot.papers.length,1);assert.equal(snapshot.papers[0].attachments[0].file,undefined);assert.equal(snapshot.relinkCandidates.length,2);await library.relinkAttachment(paper.id,a.id,'a.pdf');snapshot=await library.snapshot();assert.equal(snapshot.papers.find(p=>p.id===paper.id).attachments[0].fileName,'a.pdf');assert.equal(snapshot.papers.length,2);
});
test('move protects existing files, preserves references and rolls back failed metadata saves',async t=>{
 const dir=await fixture(t),root=path.join(dir,'vault'),source=path.join(dir,'paper.pdf');await fs.writeFile(source,pdf);const library=await Library.open(root);await library.importFiles([source]);const paper=library.data.papers[0],a=paper.attachments[0];await library.createFolder('','target');await library.moveAttachment(paper.id,a.id,'target','new.pdf');assert.equal(library.attachment(paper.id,a.id).path,'target/new.pdf');await assert.rejects(fs.stat(path.join(root,'papers','paper.pdf')),{code:'ENOENT'});
 await fs.writeFile(path.join(root,'occupied.pdf'),pdf);await assert.rejects(library.moveAttachment(paper.id,a.id,'','occupied.pdf'),{code:'EEXIST'});await assert.rejects(library.moveAttachment(paper.id,a.id,'','../escape.pdf'));
 library.save=async()=>{throw Error('disk full')};await assert.rejects(library.moveAttachment(paper.id,a.id,'','failed.pdf'),/disk full/);assert.equal(library.attachment(paper.id,a.id).path,'target/new.pdf');await assert.rejects(fs.stat(path.join(root,'failed.pdf')),{code:'ENOENT'});assert.deepEqual(await fs.readFile(path.join(root,'target','new.pdf')),pdf);
});
test('conflicting writers cannot silently overwrite metadata and failed note saves roll back memory',async t=>{
 const dir=await fixture(t),root=path.join(dir,'vault'),first=await Library.open(root),second=await Library.open(root);await second.saveNotes({note:'newer'});await assert.rejects(first.saveNotes({note:'stale'}),/다른 프로그램/);assert.deepEqual(first.data.notes,{});assert.equal(JSON.parse(await fs.readFile(first.file)).notes.note,'newer');second.save=async()=>{throw Error('disk full')};await assert.rejects(second.saveNotes({note:'unsaved'}),/disk full/);assert.deepEqual(second.data.notes,{note:'newer'});
});
test('backup restores merged records and keeps the pre-restore state recoverable',async t=>{
 const dir=await fixture(t),root=path.join(dir,'vault');await fs.writeFile(path.join(root,'a.pdf'),pdf);await fs.writeFile(path.join(root,'b.pdf'),Buffer.concat([pdf,Buffer.from('\nB')]));const library=await Library.open(root),[a,b]=library.data.papers;await library.saveNotes({[`${a.id}-메모`]:'A',[`${b.id}-메모`]:'B'});await library.mergePapers(a.id,b.id);assert.equal(library.data.papers.length,1);const backup=(await library.backups()).find(b=>b.label==='자료 병합 전');await library.restoreBackup(backup.id);assert.equal(library.data.papers.length,2);assert.equal(library.data.notes[`${b.id}-메모`],'B');assert.ok((await library.backups()).some(b=>b.label==='복원 직전'));await assert.rejects(library.restoreBackup('../library.json'));
});
test('trash keeps physical PDFs and notes, and scanning never resurrects them',async t=>{
 const dir=await fixture(t),root=path.join(dir,'vault');await fs.writeFile(path.join(root,'a.pdf'),pdf);const library=await Library.open(root),paper=library.data.papers[0];await library.saveNotes({[`${paper.id}-메모`]:'keep'});await library.trashPaper(paper.id);let snapshot=await library.snapshot();assert.equal(snapshot.papers.length,0);assert.equal(snapshot.trash[0].id,paper.id);assert.deepEqual(await fs.readFile(path.join(root,'a.pdf')),pdf);const reopened=await Library.open(root);assert.equal((await reopened.snapshot()).papers.length,0);await reopened.trashPaper(paper.id,true);snapshot=await reopened.snapshot();assert.equal(snapshot.papers[0].id,paper.id);assert.equal(snapshot.notes[`${paper.id}-메모`],'keep');
});
test('collection and annotation edits preserve ownership and deletion can be recovered',async t=>{
 const dir=await fixture(t),root=path.join(dir,'vault');await fs.writeFile(path.join(root,'a.pdf'),pdf);const library=await Library.open(root),paper=library.data.papers[0],a=paper.attachments[0],collection=await library.createCollection('old');await library.update(paper.id,{collectionIds:[collection.id]});await library.editCollection(collection.id,'new');assert.equal(library.data.collections[0].name,'new');const annotation=await library.addAnnotation(paper.id,a.id,{page:1,body:'old',sourceHash:a.sourceHash});await library.editAnnotation(annotation.id,{body:'new'});assert.equal(library.data.annotations[0].body,'new');await library.editAnnotation(annotation.id,null);assert.equal(library.data.annotations.length,0);await library.editCollection(collection.id,null);assert.deepEqual(library.paper(paper.id).collectionIds,[]);assert.equal(library.data.papers.length,1);
});
test('corrupt metadata can be recovered only from a validated local backup with original bytes preserved',async t=>{
 const dir=await fixture(t),root=path.join(dir,'vault'),library=await Library.open(root);await library.saveNotes({note:'recover me'});const id=await library.backup('test');await fs.writeFile(library.file,'{broken');await assert.rejects(Library.open(root));const restored=await Library.recover(root,id);assert.equal(restored.data.notes.note,'recover me');const preserved=(await fs.readdir(path.join(root,appName.vaultDir))).find(n=>n.startsWith('library.corrupt-'));assert.equal(await fs.readFile(path.join(root,appName.vaultDir,preserved),'utf8'),'{broken');await assert.rejects(Library.recover(root,'../library.json'));
});
test('rolling backups retain the newest twenty and one older one of the day, and reject symlink destinations',async t=>{
 const dir=await fixture(t),root=path.join(dir,'vault'),library=await Library.open(root);for(let i=0;i<22;i++)await library.backup('backup '+i);assert.equal((await library.backups()).length,21);const outside=path.join(dir,'outside');await fs.mkdir(outside);await fs.rm(path.join(root,appName.vaultDir,'backups'),{recursive:true});await fs.symlink(outside,path.join(root,appName.vaultDir,'backups'),DIR_LINK);await assert.rejects(library.backup(),/심볼릭/);assert.deepEqual(await fs.readdir(outside),[]);
});
test('vault lease rejects another writer and releases only its own token',async t=>{
 const {lockVault}=require('../desktop/vault-lock.cjs');const dir=await fixture(t),root=path.join(dir,'vault'),release=await lockVault(root);await assert.rejects(lockVault(root),/다른 앱/);await release();const release2=await lockVault(root);await release();await assert.rejects(lockVault(root),/다른 앱/);await release2();
});

test('removing the last attachment keeps its item, notes, file and annotations recoverable',async t=>{
 const dir=await fixture(t),root=path.join(dir,'vault');await fs.writeFile(path.join(root,'a.pdf'),pdf);const library=await Library.open(root),paper=library.data.papers[0],attachment=paper.attachments[0];await library.saveNotes({[`${paper.id}-메모`]:'shared'});await library.addAnnotation(paper.id,attachment.id,{page:1,body:'kept',sourceHash:attachment.sourceHash});await library.trashAttachment(paper.id,attachment.id);let snapshot=await library.snapshot();assert.equal(snapshot.papers.length,1);assert.equal(snapshot.papers[0].attachments.length,0);assert.equal(snapshot.trashAttachments[0].id,attachment.id);await assert.rejects(library.resolveFile(paper.id,'attachment-'+attachment.id));assert.equal(snapshot.notes[`${paper.id}-메모`],'shared');assert.equal(snapshot.annotations.length,1);const reopened=await Library.open(root);await reopened.trashAttachment(paper.id,attachment.id,true);snapshot=await reopened.snapshot();assert.equal(snapshot.papers[0].attachments[0].id,attachment.id);assert.ok(snapshot.papers[0].attachments[0].file);assert.equal(snapshot.papers[0].primaryAttachmentId,attachment.id);
});
test('RIS imports create metadata-only items transactionally and survive restart',async t=>{
 const dir=await fixture(t),root=path.join(dir,'vault'),library=await Library.open(root);const ids=await library.importBibliography('TY  - JOUR\nTI  - 논문\nAU  - Jane Doe\nDO  - 10.1234/abc\nER  -\n');assert.equal(ids.length,1);assert.deepEqual(library.paper(ids[0]).attachments,[]);const reopened=await Library.open(root);assert.equal((await reopened.snapshot()).papers[0].title,'논문');reopened.save=async()=>{throw Error('disk full')};await assert.rejects(reopened.importBibliography('TY  - JOUR\nTI  - second\nER  -\n'),/disk full/);assert.equal(reopened.data.papers.length,1);
});
test('nested collections, saved searches and batch edits keep papers and reject cycles', async t => {
  const dir = await fixture(t), root = path.join(dir, 'vault'); let library = await Library.open(root);
  const [a, b] = await library.importBibliography('TY  - JOUR\nTI  - One\nER  - \nTY  - JOUR\nTI  - Two\nER  - \n');
  const parent = await library.createCollection('연구'), child = await library.createCollection('방법', parent.id), grand = await library.createCollection('방법', child.id);
  await assert.rejects(library.createCollection('방법', parent.id), /같은 이름/);
  await assert.rejects(library.moveCollection(parent.id, grand.id), /자기 하위/);
  await library.batchUpdate([a, b], { addTags: ['검토'], status: '읽는 중', addCollection: child.id, type: 'book' });
  await assert.rejects(library.batchUpdate([a, 999], { status: '완독' }), /자료 항목이 없습니다/);
  assert.deepEqual(library.data.papers.map(p => [p.tags, p.status, p.collectionIds, p.type]), [[['검토'], '읽는 중', [child.id], 'book'], [['검토'], '읽는 중', [child.id], 'book']]);
  const saved = await library.saveSearch({ name: '읽는 중 방법', query: 'one', filter: '읽는 중', collectionId: child.id });
  await library.editCollection(child.id, null);
  library = await Library.open(root);
  assert.equal(library.data.collections.find(c => c.id === grand.id).parentId, parent.id, 'children move up a level');
  assert.deepEqual(library.data.papers.map(p => p.collectionIds), [[], []]);
  assert.equal(library.data.savedSearches[0].collectionId, null);
  await library.deleteSearch(saved.id); assert.deepEqual(library.data.savedSearches, []);
});
test('bibliography imports keep structured authors and fields; edits keep the original author string', async t => {
  const dir = await fixture(t), root = path.join(dir, 'vault'), library = await Library.open(root);
  const { ids, report } = await library.importBibliography('@article{doe2024, author={Doe, Jane and {WHO}}, title={T}, journal={J}, volume={3}, pages={1--2}, year={2024}, custom={x}}', 'a.bib', { withReport: true });
  const paper = library.paper(ids[0]);
  assert.deepEqual([paper.authors, paper.creators, paper.volume, paper.pages, paper.citekey], ['Jane Doe; WHO', [{ family: 'Doe', given: 'Jane' }, { literal: 'WHO' }], '3', '1–2', 'doe2024']);
  assert.deepEqual(report.unsupported, { 'BibTeX custom': 1 });
  const [plain] = await library.importBibliography('TY  - JOUR\nTI  - Old\nAU  - Hong Gildong\nER  - \n');
  await library.update(plain, { creators: [{ family: 'Hong', given: 'Gildong' }], authors: 'Gildong Hong' });
  assert.equal(library.paper(plain).authorsOriginal, 'Hong Gildong');
  await assert.rejects(library.update(plain, { citekey: 'doe2024' }), /같은 인용 키/);
});
test('the vault glossary is validated, saved and kept across reopen', async t => {
  const dir = await fixture(t), root = path.join(dir, 'vault'); let library = await Library.open(root);
  await library.setGlossary([{ term: ' attention ', translation: '어텐션' }, { term: 'layout', translation: '배치', note: '레이아웃 아님' }]);
  await assert.rejects(library.setGlossary([{ term: 'a', translation: 'b' }, { term: 'A', translation: 'c' }]), /두 번/);
  await assert.rejects(library.setGlossary([{ term: 'a', translation: '' }]), /용어집/);
  library = await Library.open(root);
  assert.deepEqual((await library.snapshot()).glossary, [{ term: 'attention', translation: '어텐션' }, { term: 'layout', translation: '배치', note: '레이아웃 아님' }]);
});
test('an imported key already in use gets a letter, and a paper with an unchanged key stays editable', async t => {
  const dir = await fixture(t), root = path.join(dir, 'vault'), library = await Library.open(root), bib = '@article{smith2020, title={A}, year={2020}}';
  const [first] = await library.importBibliography(bib, 'a.bib'), [second] = await library.importBibliography(bib, 'a.bib'), [third] = await library.importBibliography(bib, 'a.bib');
  assert.deepEqual([first, second, third].map(id => library.paper(id).citekey), ['smith2020', 'smith2020a', 'smith2020b']);
  library.paper(second).citekey = 'smith2020'; // a duplicate that arrived some other way (an older import, another device)
  await library.update(second, { citekey: 'smith2020', title: 'Edited' });
  assert.equal(library.paper(second).title, 'Edited');
});
test('a collection parent loop from a merge is broken where it closes', async t => {
  const dir = await fixture(t), root = path.join(dir, 'vault'), library = await Library.open(root);
  const data = JSON.parse(JSON.stringify(library.data));
  data.collections = [{ id: 'x', name: 'X', parentId: 'y' }, { id: 'y', name: 'Y', parentId: 'x' }, { id: 'z', name: 'Z', parentId: 'y' }];
  library.validateData(data);
  assert.deepEqual(data.collections.map(c => c.parentId), [undefined, 'x', 'y']);
});
test('a vault lease from before a restart, or a half-written one, does not lock the vault forever', async t => {
  const { lockVault } = require('../desktop/vault-lock.cjs');
  const dir = await fixture(t), root = path.join(dir, 'vault'), file = path.join(root, appName.vaultDir, 'writer.lock'); await fs.mkdir(path.dirname(file), { recursive: true });
  // pid 1 is always alive: only the older boot time makes this lease stale.
  await fs.writeFile(file, JSON.stringify({ pid: 1, host: os.hostname(), boot: Math.round(Date.now() / 1000 - os.uptime()) - 3600, token: 'old' }));
  let release = await lockVault(root); assert.ok(JSON.parse(await fs.readFile(file, 'utf8')).boot); await release();
  await fs.writeFile(file, ''); const old = new Date(Date.now() - 120000); await fs.utimes(file, old, old);
  release = await lockVault(root); await release();
  await fs.writeFile(file, '');
  await assert.rejects(lockVault(root), /잠금 파일을 확인할 수 없습니다/, 'a fresh empty lease may still be being written');
  await fs.rm(file);
  release = await lockVault(root); await assert.rejects(lockVault(root), /사용 중인 저장소/); await release();
});
test('tag colours belong to the vault, survive reopening and tolerate colours from a newer version',async t=>{
  const dir=await fixture(t),root=path.join(dir,'vault');let library=await Library.open(root);
  await library.setTagColor('RAG','#1B64DA');await library.setTagColor('통계','#30a46c');await library.setTagColor('통계',null);
  for(const [tag,color] of [['','#e5484d'],['RAG','blue'],['RAG','#12345'],['RAG','#gggggg'],['__proto__','#e5484d'],['x'.repeat(61),'#e5484d']])await assert.rejects(library.setTagColor(tag,color),/태그 색/);
  library=await Library.open(root);
  assert.deepEqual((await library.snapshot()).tagColors,{RAG:'#1b64da',통계:''},'any #rrggbb is kept, in lower case; no colour keeps the tag');
  const file=path.join(root,appName.vaultDir,'library.json'),data=JSON.parse(await fs.readFile(file,'utf8'));
  await fs.writeFile(file,JSON.stringify({...data,tagColors:{RAG:'ultraviolet'}}));
  library=await Library.open(root);assert.deepEqual((await library.snapshot()).tagColors,{RAG:'ultraviolet'});
  await fs.writeFile(file,JSON.stringify({...data,tagColors:['RAG']}));
  await assert.rejects(Library.open(root));
});
test('tags are made, renamed, merged and deleted for the whole vault',async t=>{
  const dir=await fixture(t),root=path.join(dir,'vault');for(const n of ['a','b'])await fs.writeFile(path.join(dir,n+'.pdf'),Buffer.concat([pdf,Buffer.from(n)]));
  const library=await Library.open(root);await library.importFiles([path.join(dir,'a.pdf'),path.join(dir,'b.pdf')]);
  const [a,b]=library.data.papers.map(p=>p.id);
  // A tag made on its own stays with no papers; a same name (after trimming and NFC) is refused.
  await library.createTag('  빈 태그 ','#e5484d');assert.deepEqual(library.data.tagColors,{'빈 태그':'#e5484d'});
  await assert.rejects(library.createTag('빈 태그'),/이미 있는 태그입니다: 빈 태그/);
  await assert.rejects(library.createTag('ᄒᆞᆫ'.normalize('NFD').padEnd(61,'x')),/1–60자/);
  // Tags given to papers join the vault's list and stay after the last paper drops them.
  await library.update(a,{tags:['RAG','통계']});await library.batchUpdate([b],{addTags:['RAG']});
  await library.update(a,{tags:['RAG']});assert.ok(library.tagNames().has('통계'));assert.equal(library.data.tagColors['통계'],'');
  await library.setTagColor('통계','#30a46c');await library.saveSearch({name:'통계 검색',tag:'통계'});
  // Rename moves the papers, colour and saved searches; a name that exists merges (after a backup).
  await library.update(b,{tags:['RAG','통계']});
  assert.deepEqual(await library.renameTag('통계','Statistics'),{merged:false,papers:1,name:'Statistics'});
  assert.deepEqual(library.paper(b).tags,['RAG','Statistics']);assert.equal(library.data.tagColors.Statistics,'#30a46c');assert.equal(library.data.tagColors['통계'],undefined);
  assert.equal(library.data.savedSearches[0].tag,'Statistics');
  const backups=(await library.backups()).length;
  assert.deepEqual(await library.renameTag('Statistics','RAG'),{merged:true,papers:1,name:'RAG'});
  assert.deepEqual(library.paper(b).tags,['RAG'],'no paper holds the merged tag twice');assert.equal(library.data.tagColors.RAG,'#30a46c','the merged tag takes the colour when it had none');
  assert.equal((await library.backups()).length,backups+1);
  // Delete takes the tag off every paper, keeps the papers, and makes a backup first.
  assert.deepEqual(await library.deleteTag('RAG'),{papers:2});
  assert.deepEqual(library.data.papers.map(p=>p.tags),[[],[]]);assert.equal(library.data.papers.length,2);
  assert.equal((await library.backups()).length,backups+2);
  await assert.rejects(library.deleteTag('RAG'),/태그가 없습니다/);await assert.rejects(library.renameTag('없음','x'),/태그가 없습니다/);
});

test('older backups thin out to one a day, then one a week, instead of vanishing after the newest twenty', () => {
  const { expiredBackups } = require('../desktop/storage.cjs');
  const DAY = 86400000, now = Date.UTC(2026, 10, 10, 12), id = time => `${time}-00000000-0000-4000-8000-000000000000.json`, backups = [];
  for (let day = 0; day < 120; day++) for (let n = 0; n < 6; n++) backups.push({ id: id(now - day * DAY - n * 3600000) });
  const expired = new Set(expiredBackups(backups, now).map(b => b.id)), kept = backups.filter(b => !expired.has(b.id)).sort((a, b) => b.id.localeCompare(a.id));
  assert.deepEqual(kept.slice(0, 20), [...backups].sort((a, b) => b.id.localeCompare(a.id)).slice(0, 20), 'the newest twenty all stay');
  const age = (days, within = 1) => kept.some(b => Math.abs(now - Number(b.id.split('-')[0]) - days * DAY) < within * DAY);
  assert.ok(age(1) && age(7) && age(13) && age(30, 7) && age(60, 7), 'a backup from a day, a week, a month and two months ago can be restored');
  assert.ok(!age(100), 'nothing is kept past ten weeks');
  assert.ok(kept.length <= 20 + 14 + 9, `bounded (${kept.length})`);
  assert.deepEqual(expiredBackups(backups.slice(0, 20), now), [], 'twenty or fewer: nothing is deleted');
  // Deleting the expired ones and asking again deletes nothing more.
  assert.deepEqual(expiredBackups(kept, now), []);
});

test('notes the page had not saved survive reading the vault again', () => {
  const { mergePendingNotes } = require('../desktop/storage.cjs');
  const base = { a: 'one', b: 'two', c: 'three' }, theirs = { a: 'one', b: 'two from the other PC', c: 'three', d: 'new elsewhere' };
  const merged = mergePendingNotes(base, theirs, { a: 'one edited here', b: 'two edited here', c: 'three', e: 'new here' });
  assert.equal(merged.notes.a, 'one edited here'); assert.equal(merged.notes.c, 'three'); assert.equal(merged.notes.d, 'new elsewhere'); assert.equal(merged.notes.e, 'new here');
  assert.match(merged.notes.b, /^two from the other PC[\s\S]*저장하지 못한 내용[\s\S]*two edited here$/, 'both sides of a note changed twice are kept');
  assert.deepEqual([merged.kept.sort(), merged.conflicts], [['a', 'e'], ['b']]);
  assert.deepEqual(mergePendingNotes(base, theirs, { b: 'two from the other PC' }), { notes: theirs, kept: [], conflicts: [] }, 'the same text on both sides is no conflict');
  assert.deepEqual(mergePendingNotes(base, theirs, null).notes, theirs);
});

test('a vault from a later app asks for an update and is never taken for a damaged one', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), `${appName.id}-newer-`)); t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, appName.vaultDir)); const file = path.join(root, appName.vaultDir, 'library.json'), text = JSON.stringify({ version: 3, id: 'x', papers: [], notes: {} });
  await fs.writeFile(file, text);
  await assert.rejects(Library.open(root), error => error.code === 'APP_NEWER_VAULT' && /업데이트/.test(error.message) && !/JSON|형식|식별자|대표 첨부/.test(error.message));
  assert.equal(await fs.readFile(file, 'utf8'), text, 'the newer vault is left untouched');
});

test('an outside change is reported with its own code, and reading the vault again clears it', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), `${appName.id}-outside-`)); t.after(() => fs.rm(root, { recursive: true, force: true }));
  const library = await Library.open(root); await library.saveNotes({ 'k-메모': 'first' });
  const file = path.join(root, appName.vaultDir, 'library.json'), data = JSON.parse(await fs.readFile(file, 'utf8')); data.notes['k-메모'] = 'changed elsewhere';
  await fs.writeFile(file, JSON.stringify(data, null, 2));
  assert.equal(await library.unchanged(), false);
  await assert.rejects(library.saveNotes({ 'k-메모': 'mine' }), error => error.code === 'APP_EXTERNAL_CHANGE');
  const again = await Library.open(root); assert.equal(await again.unchanged(), true); assert.equal(again.data.notes['k-메모'], 'changed elsewhere');
});

test('a translation into another language gets its own cache file; Korean keeps the existing name', () => {
  const { translationFileName } = require('../desktop/storage.cjs'), { languageProfile, DEFAULT_LANGUAGE, LANGUAGES } = require('../core/translation-policy.cjs');
  const attachment = { id: '8a5082fc-55c0-49a0-a941-8742abf4dfd9', cacheOwnerId: 1792973342970787, cacheKey: '' };
  assert.equal(translationFileName(1, attachment), 'translation-1792973342970787.json');
  assert.equal(translationFileName(1, attachment, 'ko'), 'translation-1792973342970787.json');
  assert.equal(translationFileName(1, attachment, 'ja'), 'translation-1792973342970787-lang-ja.json');
  assert.equal(translationFileName(1, { id: 'abc-1' }, 'zh-Hans'), 'translation-1-abc-1-lang-zh-Hans.json');
  // What backup and sync already carry (their file-name patterns) covers the new names.
  for (const name of [translationFileName(1, attachment, 'ja'), translationFileName(1, { id: 'abc-1' }, 'zh-Hans')]) assert.match(name, /^translation-[-a-zA-Z0-9]+\.json$/);
  assert.equal(translationFileName(1, attachment, '../x'), null);
  assert.equal(DEFAULT_LANGUAGE, 'ko'); assert.deepEqual(Object.keys(LANGUAGES), ['ko']);
  assert.equal(languageProfile().written('번역'), true); assert.equal(languageProfile().written('translation'), false);
  assert.throws(() => languageProfile('ja'), /지원하지 않는 번역 언어/);
});

test('a PDF the vault already has is named before it is added again', async t => {
  const dir = await fixture(t), a = path.join(dir, 'a.pdf'), copy = path.join(dir, 'copy.pdf'), other = path.join(dir, 'other.pdf');
  await fs.writeFile(a, pdf); await fs.writeFile(copy, pdf); await fs.writeFile(other, Buffer.concat([pdf, Buffer.from('\n% different')]));
  const library = await Library.open(path.join(dir, 'vault')); await library.importFiles([a]); const paper = library.data.papers[0];
  assert.deepEqual((await library.knownCopies([copy, other, path.join(dir, 'missing.pdf')])).map(d => [d.name, d.paperId, d.trashed]), [['copy.pdf', paper.id, false]]);
  await library.trashPaper(paper.id); assert.equal((await library.knownCopies([copy]))[0].trashed, true, 'a copy of a trashed item says so');
});

test('merging keeps the memo order under the kept item\'s keys', async t => {
  const dir = await fixture(t), a = path.join(dir, 'a.pdf'), b = path.join(dir, 'b.pdf'); await fs.writeFile(a, pdf); await fs.writeFile(b, Buffer.concat([pdf, Buffer.from('\nB')]));
  const library = await Library.open(path.join(dir, 'vault')); await library.importFiles([a, b]); const [target, source] = library.data.papers, T = target.id, S = source.id;
  await library.saveNotes({ [`${S}-메모-a`]: 'A', [`${S}-메모-b`]: 'B', [`${S}-메모#order`]: JSON.stringify([`${S}-메모-b`, `${S}-메모-a`]) });
  await library.mergePapers(T, S);
  assert.deepEqual(JSON.parse(library.data.notes[`${T}-메모#order`]), [`${T}-메모-b`, `${T}-메모-a`], 'the order names the kept item\'s keys');
  assert.equal(Object.keys(library.data.notes).some(k => k.startsWith(`${S}-`)), false);
  // When the kept item has an order of its own, the other's keys follow it, each once.
  const c = path.join(dir, 'c.pdf'), d = path.join(dir, 'd.pdf'); await fs.writeFile(c, Buffer.concat([pdf, Buffer.from('\nC')])); await fs.writeFile(d, Buffer.concat([pdf, Buffer.from('\nD')]));
  await library.importFiles([c, d]); const [, kept, other] = library.data.papers, K = kept.id, O = other.id;
  await library.saveNotes({ [`${K}-메모-x`]: 'X', [`${K}-메모-a`]: 'KA', [`${K}-메모#order`]: JSON.stringify([`${K}-메모-x`, `${K}-메모-a`]), [`${O}-메모-a`]: 'OA', [`${O}-메모-y`]: 'Y', [`${O}-메모#order`]: JSON.stringify([`${O}-메모-y`, `${O}-메모-a`]) });
  await library.mergePapers(K, O);
  assert.deepEqual(JSON.parse(library.data.notes[`${K}-메모#order`]), [`${K}-메모-x`, `${K}-메모-a`, `${K}-메모-y`]);
});
test('merging keeps one of two identical PDFs: the one with work, both when both have work; status follows the further side', async t => {
  const dir = await fixture(t), a = path.join(dir, 'a.pdf'), b = path.join(dir, 'b.pdf'); await fs.writeFile(a, pdf); await fs.writeFile(b, pdf);
  const open = async name => { await fs.mkdir(path.join(dir, name)); const library = await Library.open(path.join(dir, name)); await library.importFiles([a, b]); return library; };
  // No work on either side: the target's own copy stays, the other goes to 제거한 첨부 (no file is deleted).
  let library = await open('v1'), [first, second] = library.data.papers; await library.update(second.id, { status: '완독' });
  await library.mergePapers(first.id, second.id); let merged = library.paper(first.id);
  assert.deepEqual(library.lastMerge, { removed: 1, keptBoth: 0 }); assert.equal(merged.status, '완독');
  assert.deepEqual(merged.attachments.map(x => Boolean(x.trashedAt)), [false, true]); assert.equal(merged.primaryAttachmentId, first.attachments[0].id);
  for (const x of merged.attachments) await fs.access(path.join(library.root, x.path));
  // Work only on the incoming copy: that copy stays and becomes the one that opens.
  library = await open('v2'); [first, second] = library.data.papers; await library.update(first.id, { status: '읽는 중' });
  await library.addAnnotation(second.id, second.attachments[0].id, { page: 1, body: 'note', sourceHash: second.attachments[0].sourceHash });
  await library.mergePapers(first.id, second.id); merged = library.paper(first.id);
  assert.deepEqual(library.lastMerge, { removed: 1, keptBoth: 0 }); assert.equal(merged.status, '읽는 중', 'the target was further along');
  assert.equal(merged.primaryAttachmentId, second.attachments[0].id); assert.ok(merged.attachments.find(x => x.id === first.attachments[0].id).trashedAt);
  // Work on both: both stay and the caller is told.
  library = await open('v3'); [first, second] = library.data.papers;
  for (const p of [first, second]) await library.addAnnotation(p.id, p.attachments[0].id, { page: 1, body: 'note', sourceHash: p.attachments[0].sourceHash });
  await library.mergePapers(first.id, second.id);
  assert.deepEqual(library.lastMerge, { removed: 0, keptBoth: 1 }); assert.ok(library.paper(first.id).attachments.every(x => !x.trashedAt));
});

test('deleting an item removes its PDF, notes, annotations and per-file records; deleting one attachment leaves the rest', async t => {
  const dir = await fixture(t), a = path.join(dir, 'a.pdf'), b = path.join(dir, 'b.pdf'), c = path.join(dir, 'c.pdf');
  await fs.writeFile(a, pdf); await fs.writeFile(b, Buffer.concat([pdf, Buffer.from('\n% b')])); await fs.writeFile(c, Buffer.concat([pdf, Buffer.from('\n% c')]));
  let library = await Library.open(path.join(dir, 'vault')); await library.importFiles([a, b]); const [first, second] = library.data.papers, ownDir = path.join(library.root, appName.vaultDir);
  await library.importPDFs([c], { paperId: second.id, role: 'supplement', folder: '' }); const extra = library.paper(second.id).attachments[1];
  await library.saveNotes({ [first.id + '-메모']: 'gone', [second.id + '-메모']: 'kept' });
  await library.addAnnotation(first.id, first.attachments[0].id, { page: 1, body: 'gone', sourceHash: first.attachments[0].sourceHash });
  await library.addAnnotation(second.id, extra.id, { page: 1, body: 'gone too', sourceHash: extra.sourceHash });
  await library.addAnnotation(second.id, second.attachments[0].id, { page: 1, body: 'kept', sourceHash: second.attachments[0].sourceHash });
  const { translationFileName } = require('../desktop/storage.cjs'), cache = path.join(ownDir, translationFileName(first.id, first.attachments[0]));
  await fs.writeFile(cache, '{}'); await fs.writeFile(cache.replace('.json', '.chunks.json'), '{}');
  await fs.mkdir(path.join(ownDir, 'ink', first.attachments[0].id), { recursive: true }); await fs.writeFile(path.join(ownDir, 'ink', first.attachments[0].id, 'original.log'), '');
  await fs.mkdir(path.join(ownDir, 'ai'), { recursive: true }); await fs.writeFile(path.join(ownDir, 'ai', first.attachments[0].id + '.json'), '{}');
  const discarded = [], firstFile = path.join(library.root, first.attachments[0].path), extraFile = path.join(library.root, extra.path);
  assert.deepEqual(await library.deleteAttachments(first.id, null, async file => { discarded.push(file); await fs.rm(file); }), { files: 1, failed: [] });
  assert.deepEqual(discarded, [firstFile]); await assert.rejects(fs.access(firstFile)); await assert.rejects(fs.access(cache)); await assert.rejects(fs.access(cache.replace('.json', '.chunks.json')));
  await assert.rejects(fs.access(path.join(ownDir, 'ink', first.attachments[0].id))); await assert.rejects(fs.access(path.join(ownDir, 'ai', first.attachments[0].id + '.json')));
  assert.deepEqual(library.data.papers.map(p => p.id), [second.id]); assert.deepEqual(library.data.notes, { [second.id + '-메모']: 'kept' }); assert.deepEqual(library.data.annotations.map(x => x.body).sort(), ['gone too', 'kept']);
  // One attachment: its file and annotation go, the item and its other file stay.
  await library.deleteAttachments(second.id, [extra.id]);
  await assert.rejects(fs.access(extraFile)); await fs.access(path.join(library.root, second.attachments[0].path));
  assert.deepEqual(library.paper(second.id).attachments.map(x => x.id), [second.attachments[0].id]); assert.deepEqual(library.data.annotations.map(x => x.body), ['kept']);
  await assert.rejects(library.deleteAttachments(second.id, ['nope']), /첨부파일이 없습니다/);
  // Reopening does not bring anything back, and a backup was made before each deletion.
  assert.ok((await library.backups()).some(x => x.label === '자료 삭제 전'));
  library = await Library.open(library.root); assert.deepEqual(library.data.papers.map(p => p.id), [second.id]); assert.equal(library.data.movedCopies, undefined);
  // A file that cannot be removed is reported and is not registered again as a new item.
  const kept = path.join(library.root, library.paper(second.id).attachments[0].path);
  assert.deepEqual(await library.deleteAttachments(second.id, null, async () => { throw Error('in use'); }), { files: 0, failed: [path.basename(kept)] });
  await fs.access(kept); library = await Library.open(library.root); assert.deepEqual(library.data.papers, []);
});

// A vault as an earlier app left it under its folder name: records, ink and a translation.
const oldData = { version: 2, id: '11111111-1111-4111-8111-111111111111', papers: [], notes: { 'k-메모': '이전 메모' }, collections: [], annotations: [] };
async function oldVault(root, folder, data = oldData) {
  await fs.mkdir(path.join(root, folder, 'ink', 'a1'), { recursive: true });
  await fs.writeFile(path.join(root, folder, 'library.json'), JSON.stringify(data)); await fs.writeFile(path.join(root, folder, 'ink', 'a1', 'original.log'), 'ink');
  await fs.writeFile(path.join(root, folder, 'translation-1.json'), '{"version":1}');
}
// The folder's files, less the rolling backups the vault makes each time it is opened.
const tree = async dir => (await fs.readdir(dir, { recursive: true })).map(name => name.split(path.sep).join('/')).filter(name => !name.startsWith(`.${appName.id}/backups/`)).sort();
for (const [old, app] of appName.history.map(h => ['.' + h.id, h.name])) test(`a vault from ${app} (${old}) is taken over without loss`, async t => {
  const dir = await fixture(t), root = path.join(dir, 'old-vault'), legacy = require('../desktop/legacy.cjs'), { lockVault } = require('../desktop/vault-lock.cjs');
  await oldVault(root, old); await fs.writeFile(path.join(root, 'a.pdf'), pdf);
  const release = await lockVault(root), library = await Library.open(root);
  await assert.rejects(fs.access(path.join(root, old)), 'the old folder is renamed, not copied');
  assert.equal(library.data.id, oldData.id); assert.equal(library.data.notes['k-메모'], '이전 메모'); assert.equal(library.data.papers.length, 1, 'the PDF beside it is registered as before');
  assert.equal(await fs.readFile(path.join(root, appName.vaultDir, 'ink', 'a1', 'original.log'), 'utf8'), 'ink'); assert.equal(await fs.readFile(path.join(root, appName.vaultDir, 'translation-1.json'), 'utf8'), '{"version":1}');
  await release();
  // Taken over once: opened again (the app started again, a second window), nothing changes.
  const seen = await tree(root);
  assert.equal(await legacy.adoptVaultFolder(root), false, 'nothing left to take over');
  const again = await lockVault(root); await Library.open(root); await again();
  assert.deepEqual(await tree(root), seen); assert.equal(await legacy.oldVaultBeside(root), null);
  // An earlier app that still has the vault open keeps it: the rename waits, and the app is named.
  const busy = path.join(dir, 'busy'); await oldVault(busy, old);
  await fs.writeFile(path.join(busy, old, 'writer.lock'), JSON.stringify({ pid: process.ppid, host: os.hostname(), boot: legacy.bootTime(), token: 'x' }));
  await assert.rejects(Library.open(busy), new RegExp(RegExp.escape(`이전 버전 앱(${app})에서 열려 있습니다`))); await fs.access(path.join(busy, old, 'library.json')); await assert.rejects(fs.access(path.join(busy, appName.vaultDir)));
  await fs.writeFile(path.join(busy, old, 'writer.lock'), JSON.stringify({ pid: 1, host: 'other-computer', boot: 0, token: 'x' }));
  await assert.rejects(legacy.adoptVaultFolder(busy), err => err.message.includes('other-computer') && err.message.includes(`${old}/writer.lock`));
  await fs.writeFile(path.join(busy, old, 'writer.lock'), JSON.stringify({ pid: 2 ** 22 + 12345, host: os.hostname(), boot: 0, token: 'x' }));
  assert.equal(await legacy.adoptVaultFolder(busy), true, 'a lock left by an app that is gone does not block'); await fs.access(path.join(busy, appName.vaultDir, 'library.json'));
  await assert.rejects(fs.access(path.join(busy, appName.vaultDir, 'writer.lock')), 'the stale lease is not carried over');
});
test(`with both earlier folders, .${nameBefore.id} is taken over and .${nameFirst.id} left; beside a .${appName.id}, the old one is left and told of when it holds items`, async t => {
  const dir = await fixture(t), legacy = require('../desktop/legacy.cjs');
  const both = path.join(dir, 'both'); await oldVault(both, `.${nameBefore.id}`); await oldVault(both, `.${nameFirst.id}`, { ...oldData, notes: { 'k-메모': `${nameFirst.id} 메모` } });
  assert.equal(await legacy.adoptVaultFolder(both), true);
  assert.equal(JSON.parse(await fs.readFile(path.join(both, appName.vaultDir, 'library.json'), 'utf8')).notes['k-메모'], '이전 메모');
  assert.equal(JSON.parse(await fs.readFile(path.join(both, `.${nameFirst.id}`, 'library.json'), 'utf8')).notes['k-메모'], `${nameFirst.id} 메모`, `.${nameFirst.id} is left as it is`);
  // The new folder there already: it is used; the old one is neither removed nor merged.
  const beside = path.join(dir, 'beside'); await oldVault(beside, `.${nameBefore.id}`, { ...oldData, papers: [{ id: 'p1' }, { id: 'p2' }] }); await fs.mkdir(path.join(beside, appName.vaultDir));
  const before = await fs.readFile(path.join(beside, `.${nameBefore.id}`, 'library.json'));
  assert.equal(await legacy.adoptVaultFolder(beside), false); assert.deepEqual(await fs.readFile(path.join(beside, `.${nameBefore.id}`, 'library.json')), before);
  assert.deepEqual(await legacy.oldVaultBeside(beside), { folders: [`.${nameBefore.id}`], papers: 2 });
  // Both old folders holding items are told of together; items in the trash are not counted.
  await oldVault(beside, `.${nameFirst.id}`, { ...oldData, papers: [{ id: 'p3' }, { id: 'p4', trashedAt: '2026-01-01T00:00:00.000Z' }] });
  assert.deepEqual(await legacy.oldVaultBeside(beside), { folders: [`.${nameBefore.id}`, `.${nameFirst.id}`], papers: 3 });
  await fs.writeFile(path.join(beside, `.${nameBefore.id}`, 'library.json'), JSON.stringify({ ...oldData, papers: [{ id: 'p1', trashedAt: '2026-01-01T00:00:00.000Z' }] }));
  assert.deepEqual(await legacy.oldVaultBeside(beside), { folders: [`.${nameFirst.id}`], papers: 1 }, 'an old folder with only trashed items is not told of');
  await fs.writeFile(path.join(beside, `.${nameFirst.id}`, 'library.json'), '{ not json'); assert.equal(await legacy.oldVaultBeside(beside), null, 'one that cannot be read is not told of');
  // Without the new folder there is nothing beside it (it is taken over instead).
  assert.equal(await legacy.oldVaultBeside(both + '-none'), null);
  // Of two old folders, the one holding library.json is taken over, whichever name it has.
  const one = path.join(dir, 'one'); await fs.mkdir(path.join(one, `.${nameBefore.id}`), { recursive: true }); await oldVault(one, `.${nameFirst.id}`);
  assert.equal(await legacy.adoptVaultFolder(one), true); await fs.access(path.join(one, appName.vaultDir, 'library.json')); await fs.access(path.join(one, `.${nameBefore.id}`));
  // An old folder that is a symbolic link is refused, as the vault's own folder is: no empty vault is made in its place.
  const linked = path.join(dir, 'linked'), elsewhere = path.join(dir, 'elsewhere'); await oldVault(elsewhere, `.${nameBefore.id}`); await fs.mkdir(linked);
  await fs.symlink(path.join(elsewhere, `.${nameBefore.id}`), path.join(linked, `.${nameBefore.id}`), 'dir');
  await assert.rejects(Library.open(linked), new RegExp(RegExp.escape('.' + nameBefore.id) + ' 폴더의 심볼릭 링크는 지원하지 않습니다')); await assert.rejects(fs.access(path.join(linked, appName.vaultDir)));
  // A linked .<earlier id> beside a real .<first id> holding records: the real one is taken over, the link left alone.
  await oldVault(linked, `.${nameFirst.id}`); assert.equal(await legacy.adoptVaultFolder(linked), true);
  await fs.access(path.join(linked, appName.vaultDir, 'library.json')); assert.ok((await fs.lstat(path.join(linked, `.${nameBefore.id}`))).isSymbolicLink());
  // A linked .<earlier id> holding the records beside a real but empty .<first id>: the records are not given up for an empty
  // vault; the link is refused.
  const empty = path.join(dir, 'empty-real'); await fs.mkdir(path.join(empty, `.${nameFirst.id}`), { recursive: true });
  await fs.symlink(path.join(elsewhere, `.${nameBefore.id}`), path.join(empty, `.${nameBefore.id}`), 'dir');
  await assert.rejects(legacy.adoptVaultFolder(empty), new RegExp(RegExp.escape('.' + nameBefore.id) + ' 폴더의 심볼릭 링크는 지원하지 않습니다')); await assert.rejects(fs.access(path.join(empty, appName.vaultDir)));
});
test('an earlier app\'s lease holds while its process runs, whatever the clock says; one half written a minute ago does not', async t => {
  const dir = await fixture(t), legacy = require('../desktop/legacy.cjs'), lease = owner => JSON.stringify({ host: os.hostname(), boot: legacy.bootTime(), token: 'x', ...owner });
  const vault = async (name, text, mtime) => { const root = path.join(dir, name); await oldVault(root, `.${nameBefore.id}`); const file = path.join(root, `.${nameBefore.id}`, 'writer.lock'); await fs.writeFile(file, text); if (mtime) await fs.utimes(file, mtime, mtime); return root; };
  // A running process on this computer, since its last start: the vault is open there; the message names the lease to delete.
  await assert.rejects(legacy.adoptVaultFolder(await vault('open', lease({ pid: process.ppid }))), error => error.message.includes(`이전 버전 앱(${nameBefore.name})`) && error.message.includes(`.${nameBefore.id}/writer.lock`));
  // A boot time far off (the clock jumped: NTP, a dual boot, a virtual machine resumed) does not release a running process's
  // lease: the folder is never moved from under an app that may still be writing. Its own process gone, it is stale.
  for (const boot of [legacy.bootTime() - 300, legacy.bootTime() + 180, legacy.bootTime() - 3 * 86400]) await assert.rejects(legacy.adoptVaultFolder(await vault('jumped' + boot, lease({ pid: process.ppid, boot }))), new RegExp(RegExp.escape(`이전 버전 앱(${nameBefore.name})`)));
  assert.equal(await legacy.adoptVaultFolder(await vault('gone', lease({ pid: 2 ** 22 + 12345, boot: legacy.bootTime() - 3 * 86400 }))), true);
  // A lease without a host is this computer's.
  await assert.rejects(legacy.adoptVaultFolder(await vault('no-host', JSON.stringify({ pid: process.ppid, boot: legacy.bootTime() }))), error => !error.message.includes('undefined') && error.message.includes(`이전 버전 앱(${nameBefore.name})`));
  // Half written: held for a minute, then left over.
  await assert.rejects(legacy.adoptVaultFolder(await vault('half', '{"pid":')), /잠금 파일을 확인할 수 없습니다/);
  const old = new Date(Date.now() - 120000); assert.equal(await legacy.adoptVaultFolder(await vault('half-old', '{"pid":', old)), true);
  // A lease this app could not have written (a pid that is not a number, a list) is read as a half-written one.
  for (const [name, text] of [['string-pid', '{"pid":"123"}'], ['list', '[]'], ['no-pid', JSON.stringify({ host: os.hostname() })]]) {
    await assert.rejects(legacy.adoptVaultFolder(await vault(name, text)), /잠금 파일을 확인할 수 없습니다/, name);
    assert.equal(await legacy.adoptVaultFolder(await vault(name + '-old', text, old)), true, name);
  }
  // A lease another window takes on the renamed folder in the meantime is not removed with the stale one.
  const raced = await vault('raced', lease({ pid: 2 ** 22 + 12345 })), fsp = require('node:fs/promises'), rename = fsp.rename;
  fsp.rename = async (from, to) => { await rename(from, to); await fs.writeFile(path.join(to, 'writer.lock'), lease({ pid: process.pid, token: 'other' })); };
  try { assert.equal(await legacy.adoptVaultFolder(raced), true); } finally { fsp.rename = rename; }
  assert.match(await fs.readFile(path.join(raced, appName.vaultDir, 'writer.lock'), 'utf8'), /"other"/);
});
test('a rename refused by another program leaves the old folder as it was and says what to do', async t => {
  const dir = await fixture(t), root = path.join(dir, 'held'), fsp = require('node:fs/promises'), rename = fsp.rename;
  await oldVault(root, `.${nameBefore.id}`); const seen = await tree(root);
  for (const code of ['EPERM', 'EBUSY']) {
    fsp.rename = async () => { throw Object.assign(Error(`${code}: operation not permitted, rename`), { code }); };
    try { await assert.rejects(Library.open(root), error => error.code === 'APP_RENAME_FAILED' && error.message.includes(`저장소 폴더 이름을 바꾸지 못했습니다(.${nameBefore.id} → ${appName.vaultDir})`) && !error.message.includes(code)); }
    finally { fsp.rename = rename; }
    assert.deepEqual(await tree(root), seen, 'nothing moved, nothing made');
  }
  // Once the other program lets go, it is taken over.
  await Library.open(root); await fs.access(path.join(root, appName.vaultDir, 'library.json'));
  // Held for a moment only (refused twice, then let go): taken over without a word.
  const brief = path.join(dir, 'brief'); await oldVault(brief, `.${nameBefore.id}`); let refused = 0;
  fsp.rename = async (from, to) => { if (path.basename(from) === `.${nameBefore.id}` && refused++ < 2) throw Object.assign(Error('EBUSY: resource busy'), { code: 'EBUSY' }); return rename(from, to); };
  try { await Library.open(brief); } finally { fsp.rename = rename; }
  assert.equal(refused, 3, 'refused twice, taken on the third try'); await fs.access(path.join(brief, appName.vaultDir, 'library.json'));
});
test('the vault keeps its lease out of git with its own .gitignore, leaving one already there', async t => {
  const dir = await fixture(t), { lockVault } = require('../desktop/vault-lock.cjs');
  const root = path.join(dir, 'git-vault'); await fs.mkdir(root);
  let release = await lockVault(root); await release();
  assert.equal(await fs.readFile(path.join(root, appName.vaultDir, '.gitignore'), 'utf8'), 'writer.lock\nwriter.lock.*\n');
  await fs.writeFile(path.join(root, appName.vaultDir, '.gitignore'), 'mine\n');
  release = await lockVault(root); await release(); assert.equal(await fs.readFile(path.join(root, appName.vaultDir, '.gitignore'), 'utf8'), 'mine\n');
  // A vault taken over from an earlier name gets one too.
  const old = path.join(dir, 'old'); await oldVault(old, `.${nameBefore.id}`); release = await lockVault(old); await release();
  assert.equal(await fs.readFile(path.join(old, appName.vaultDir, '.gitignore'), 'utf8'), 'writer.lock\nwriter.lock.*\n');
});
test('sync folders and backup paths under the earlier names are known', async t => {
  const dir = await fixture(t), legacy = require('../desktop/legacy.cjs');
  for (const name of [`${nameBefore.id}-sync`, `${nameFirst.id}-sync`, `${nameBefore.id.toUpperCase()}-SYNC`, appName.syncDir]) assert.equal(legacy.isSyncDirName(name), true, name);
  assert.equal(legacy.isSyncDirName('notes'), false);
  for (const name of [appName.vaultDir, `.${nameBefore.id}`, `.${nameFirst.id}`]) { const vault = path.join(dir, 'v' + name); await fs.mkdir(path.join(vault, name), { recursive: true }); await fs.writeFile(path.join(vault, name, 'library.json'), '{}'); assert.equal(await legacy.isVaultFolder(vault), true, name); }
  assert.equal(await legacy.isVaultFolder(dir), false);
  assert.equal(legacy.adoptBackupPath(`.${nameBefore.id}/library.json`), `.${appName.id}/library.json`); assert.equal(legacy.adoptBackupPath(`.${nameFirst.id}/ink/a/original.log`), `.${appName.id}/ink/a/original.log`);
  assert.equal(legacy.adoptBackupPath(`.${appName.id}/library.json`), `.${appName.id}/library.json`); assert.equal(legacy.adoptBackupPath('papers/a.pdf'), 'papers/a.pdf');
  for (const kind of [appName.backupKind, `${nameBefore.id}-full-backup`, `${nameFirst.id}-full-backup`]) assert.equal(legacy.isBackupKind(kind), true, kind);
  assert.equal(legacy.isBackupKind('other'), false);
  // A path given from outside never reaches the vault's own folder, under any of its names.
  const library = await Library.open(path.join(dir, 'vault'));
  for (const inner of [`.${appName.id}/library.json`, `.${nameBefore.id}/library.json`, `sub/.${nameFirst.id.toUpperCase()}/x.json`]) assert.throws(() => library.relative(inner), /내부 설정 폴더/, inner);
  assert.equal(library.relative('papers/a.pdf'), 'papers/a.pdf');
});

test('records follow a file that was moved: copied then removed, merged with its copy, or moved back', async t => {
  const dir = await fixture(t), root = path.join(dir, 'vault'), other = Buffer.concat([pdf, Buffer.from('\n% other')]);
  await fs.mkdir(path.join(root, 'old'), { recursive: true }); await fs.writeFile(path.join(root, 'old', 'a.pdf'), pdf); await fs.writeFile(path.join(root, 'old', 'b.pdf'), other);
  let library = await Library.open(root); const [a, b] = library.data.papers, aFile = a.attachments[0], bFile = b.attachments[0];
  await library.saveNotes({ [a.id + '-메모']: 'A의 메모' }); await library.addAnnotation(a.id, aFile.id, { page: 1, body: 'A의 주석', sourceHash: aFile.sourceHash });
  // 1. Copied to a new place while the app was closed, opened (the copy is registered as a new item), then the old place removed.
  await fs.copyFile(path.join(root, 'old', 'a.pdf'), path.join(root, 'a.pdf'));
  library = await Library.open(root); assert.equal(library.data.papers.length, 3, 'the copy is its own item while both files exist');
  await fs.rm(path.join(root, 'old', 'a.pdf')); library = await Library.open(root);
  assert.equal(library.data.papers.length, 2, 'the untouched new item is gone'); let paper = library.paper(a.id);
  assert.deepEqual(paper.attachments.map(x => [x.id, x.path]), [[aFile.id, 'a.pdf']], 'the record with the work now points at the file');
  assert.equal(library.data.annotations[0].attachmentId, aFile.id); assert.equal(library.data.notes[a.id + '-메모'], 'A의 메모'); await library.resolveFile(a.id, 'original');
  // 2. The copy was merged into the same item (two attachments), then the old file removed.
  await fs.mkdir(path.join(root, 'new')); await fs.copyFile(path.join(root, 'old', 'b.pdf'), path.join(root, 'new', 'b.pdf'));
  library = await Library.open(root); const copy = library.data.papers.find(p => p.id !== a.id && p.id !== b.id);
  await library.addAnnotation(b.id, bFile.id, { page: 1, body: 'B의 주석', sourceHash: bFile.sourceHash });
  await library.transaction(() => { const target = library.paper(b.id); target.attachments.push(...copy.attachments); library.data.papers = library.data.papers.filter(p => p !== copy); }); // as an earlier merge left it
  await fs.rm(path.join(root, 'old', 'b.pdf')); library = await Library.open(root); paper = library.paper(b.id);
  assert.deepEqual(paper.attachments.map(x => [x.id, x.path]), [[bFile.id, 'new/b.pdf']]); assert.equal(paper.primaryAttachmentId, bFile.id);
  // 3. Moved inside the app (the app remembers the place it left), then moved back by hand.
  await library.moveAttachment(a.id, aFile.id, 'new', 'a.pdf'); await fs.copyFile(path.join(root, 'new', 'a.pdf'), path.join(root, 'a.pdf')); // a copy returns to the place the app left
  library = await Library.open(root); assert.equal(library.data.papers.length, 2, 'while the moved file exists, the left-over copy stays out');
  await fs.rm(path.join(root, 'new', 'a.pdf')); library = await Library.open(root);
  assert.equal(library.paper(a.id).attachments[0].path, 'a.pdf', 'moved back: the same record again'); assert.equal(library.data.papers.length, 2);
  assert.ok(!(library.data.movedCopies || []).some(m => m.path === 'a.pdf'));
  // Both records carry work: nothing is removed, and the item opens the file that exists.
  await fs.copyFile(path.join(root, 'a.pdf'), path.join(root, 'old', 'a2.pdf')); library = await Library.open(root); const twin = library.data.papers.find(p => p.attachments.some(x => x.path === 'old/a2.pdf'));
  await library.addAnnotation(twin.id, twin.attachments[0].id, { page: 1, body: '사본의 주석', sourceHash: aFile.sourceHash });
  await library.mergePapers(a.id, twin.id); await fs.rm(path.join(root, 'a.pdf')); library = await Library.open(root); paper = library.paper(a.id);
  assert.equal(paper.attachments.length, 2); assert.equal(paper.attachments.find(x => x.id === paper.primaryAttachmentId).path, 'old/a2.pdf');
});

test('an annotation on a quoted passage may start without text of its own; one with neither is refused', async t => {
  const dir = await fixture(t), root = path.join(dir, 'vault'); await fs.writeFile(path.join(root, 'a.pdf'), pdf);
  const library = await Library.open(root), paper = library.data.papers[0], file = paper.attachments[0];
  await library.addAnnotation(paper.id, file.id, { page: 1, quote: 'a quoted passage', body: '', sourceHash: file.sourceHash });
  assert.deepEqual(library.data.annotations.map(a => [a.quote, a.body]), [['a quoted passage', '']]);
  await assert.rejects(library.addAnnotation(paper.id, file.id, { page: 1, quote: '  ', body: ' ', sourceHash: file.sourceHash }), /주석 내용/);
  assert.equal((await Library.open(root)).data.annotations.length, 1, 'it opens again');
});

test('a bibliography file brings its PDFs along only when asked; what cannot be attached is named',async t=>{
 const dir=await fixture(t),root=path.join(dir,'vault'),from=path.join(dir,'export'),{pathToFileURL}=require('node:url');
 await fs.mkdir(path.join(from,'files','1'),{recursive:true});await fs.mkdir(path.join(from,'files','2'));await fs.mkdir(path.join(from,'refs.Data','PDF','77'),{recursive:true});
 const other=Buffer.concat([pdf,Buffer.from('\n% second\n')]),third=Buffer.concat([pdf,Buffer.from('\n% third\n')]);
 await fs.writeFile(path.join(from,'files','1','Full Text.pdf'),pdf);await fs.writeFile(path.join(from,'files','2','Full Text.pdf'),other);await fs.writeFile(path.join(from,'refs.Data','PDF','77','end note.pdf'),third);await fs.writeFile(path.join(from,'note.txt'),'x');
 const bib=`@article{a, title={First}, file={Full Text PDF:files/1/Full Text.pdf:application/pdf;Snapshot:files/1/page.html:text/html}}
@article{b, title={Second}, file={PDF:${pathToFileURL(path.join(from,'files','2','Full Text.pdf')).href.replace(/:/g,'\\:')}:application/pdf;:files/9/gone.pdf:PDF}}
@article{c, title={Third}, file={https\\://example.org/x.pdf}}`;
 const ris='TY  - JOUR\nTI  - Fourth\nL1  - internal-pdf://77/end%20note.pdf\nER  -\n';
 // Not asked for: the items come in without files, as before.
 let library=await Library.open(root);const plain=await library.importBibliography(bib,'refs.bib',{withReport:true});
 assert.deepEqual(plain.ids.map(id=>library.paper(id).attachments.length),[0,0,0]);assert.equal(plain.report.attachments,5);assert.equal(plain.report.attached,0);assert.equal(library.paper(plain.ids[0]).files,undefined);
 // Asked for: found PDFs are copied in and attached, the first as the original; the source files stay.
 const full=await library.importBibliography(bib,'refs.bib',{withReport:true,attachmentsFrom:from}),[a,b,c]=full.ids.map(id=>library.paper(id));
 assert.equal(full.report.attached,2);assert.deepEqual([a.attachments.length,b.attachments.length,c.attachments.length],[1,1,0]);
 assert.equal(a.attachments[0].role,'original');assert.equal(a.primaryAttachmentId,a.attachments[0].id);
 // Two PDFs of one name: the second is kept under a numbered name, each with its own bytes.
 assert.equal(a.attachments[0].name,'Full Text.pdf');assert.equal(b.attachments[0].name,'Full Text (2).pdf');
 assert.deepEqual(await fs.readFile(path.join(root,b.attachments[0].path)),other);assert.deepEqual(await fs.readFile(path.join(from,'files','2','Full Text.pdf')),other);
 assert.deepEqual(full.report.attachmentFailures.map(f=>[f.title,f.name,f.reason]),[['First','page.html','PDF가 아님'],['Second','gone.pdf','파일 없음'],['Third','x.pdf','웹 주소']]);
 assert.ok(!JSON.stringify(full.report).includes(dir));
 // They sit in a folder named after the exchange file, which the vault shows as a folder.
 assert.equal(full.report.attachmentFolder,'refs');assert.deepEqual([a.attachments[0].path,b.attachments[0].path],['refs/Full Text.pdf','refs/Full Text (2).pdf']);
 assert.ok((await library.snapshot()).folders.includes('refs'));await assert.rejects(fs.access(path.join(root,'papers')));
 const end=await library.importBibliography(ris,'refs.ris',{withReport:true,attachmentsFrom:from});
 assert.equal(end.report.attached,1);assert.equal(library.paper(end.ids[0]).attachments[0].path,'refs/end note.pdf');
 // A file whose name no folder may take ("con.bib", ".bib") still brings its PDFs, into papers/.
 const odd=await library.importBibliography('@article{z, title={Odd}, file={files/1/Full Text.pdf}}','con.bib',{withReport:true,attachmentsFrom:from});
 assert.equal(odd.report.attachmentFolder,'papers');assert.equal(library.paper(odd.ids[0]).attachments[0].path,'papers/Full Text.pdf');assert.deepEqual(await fs.readFile(path.join(root,library.paper(end.ids[0]).attachments[0].path)),third);
 await library.close?.();library=await Library.open(root);assert.equal(library.paper(b.id).attachments.length,1);
});

test('deleting a folder removes what it holds: whole items, single attachments of items that live elsewhere too, inner folders',async t=>{
 const dir=await fixture(t),root=path.join(dir,'vault'),library=await Library.open(root),second=Buffer.concat([pdf,Buffer.from('\n% 2\n')]),third=Buffer.concat([pdf,Buffer.from('\n% 3\n')]),fourth=Buffer.concat([pdf,Buffer.from('\n% 4\n')]);
 await library.createFolder('','box');await library.createFolder('box','inner');await library.createFolder('','boxer');
 const src=async(name,bytes)=>{const file=path.join(dir,name);await fs.writeFile(file,bytes);return file;};
 const [inBox]=await library.importFiles([await src('a.pdf',pdf)],null,'box'),[inInner]=await library.importFiles([await src('b.pdf',second)],null,'box/inner'),[kept]=await library.importFiles([await src('c.pdf',third)],null,'boxer');
 // An item whose original is elsewhere and that has one more PDF inside the folder.
 const [extra]=await library.importPDFs([await src('d.pdf',fourth)],{paperId:kept.paperId,role:'supplement',folder:'box'});assert.ok(extra.ok,extra.error);
 library.data.notes[inBox.paperId+'-memo']='메모';await library.save();await fs.writeFile(path.join(root,'box','readme.txt'),'x');
 await assert.rejects(library.deleteFolder(''),/저장소 폴더 자체/);await assert.rejects(library.deleteFolder('../outside'));await assert.rejects(library.deleteFolder(appName.vaultDir));await assert.rejects(library.deleteFolder('missing'));
 const backups=(await library.backups()).length,report=await library.deleteFolder('box');
 assert.deepEqual([report.papers,report.attachments,report.files,report.failed,report.folderRemoved],[2,1,3,[],true]);
 assert.equal((await library.backups()).length,backups+1,'one backup for the whole folder');
 await assert.rejects(fs.access(path.join(root,'box')));
 // The neighbour whose name starts the same way, and the item that also lived there, are untouched.
 assert.deepEqual(library.data.papers.map(p=>p.id),[kept.paperId]);assert.deepEqual(library.paper(kept.paperId).attachments.map(a=>a.path),['boxer/c.pdf']);
 assert.deepEqual(await fs.readFile(path.join(root,'boxer','c.pdf')),third);assert.ok(!Object.keys(library.data.notes).some(k=>k.startsWith(inBox.paperId+'-')));
 const snapshot=await library.snapshot();assert.deepEqual(snapshot.folders.filter(f=>f.startsWith('box')),['boxer']);assert.equal(snapshot.papers.length,1);
 // A PDF that cannot be removed is named and its folder stays.
 await library.importFiles([await src('e.pdf',Buffer.concat([pdf,Buffer.from('\n% 5\n')]))],null,'boxer');
 const stuck=await library.deleteFolder('boxer',async file=>{if(file.endsWith('e.pdf'))throw Error('in use');await fs.rm(file);});
 assert.deepEqual([stuck.failed,stuck.folderRemoved],[['e.pdf'],false]);await fs.access(path.join(root,'boxer','e.pdf'));
});

test('duplicate candidates form groups through any chain, each kept as the item registered first',async t=>{
 const dir=await fixture(t),root=path.join(dir,'vault'),library=await Library.open(root);
 const ids=await library.importBibliography(`@article{a, title={A}, doi={10.1234/x}}
@article{b, title={B}, doi={10.1234/X}}
@article{c, title={C}, doi={https://doi.org/10.1234/x}, keywords={kept}}
@article{d, title={D}, doi={10.5678/y}}
@article{e, title={E}, doi={10.5678/y}}
@article{f, title={F}, doi={10.9999/z}}`,'refs.bib');
 const groups=await library.duplicateGroups();
 assert.deepEqual(groups,[{target:ids[0],sources:[ids[1],ids[2]]},{target:ids[3],sources:[ids[4]]}]);
 const backups=(await library.backups()).length;
 for(const group of groups)for(const source of group.sources)await library.mergePapers(group.target,source,{backup:false});
 assert.equal((await library.backups()).length,backups);assert.deepEqual(library.data.papers.map(p=>p.title),['A','D','F']);
 assert.deepEqual(library.paper(ids[0]).tags,['kept']);assert.deepEqual(await library.duplicateGroups(),[]);
});

test('merging a PDF item into one that has no PDF leaves an item that opens; a vault saved without that still opens',async t=>{
 const dir=await fixture(t),root=path.join(dir,'vault'),source=path.join(dir,'paper.pdf');await fs.writeFile(source,pdf);
 let library=await Library.open(root);
 const [bare]=await library.importBibliography('@article{a, title={Bare}, doi={10.1234/same}}','refs.bib'),[file]=await library.importFiles([source],null,'');
 await library.update(file.paperId,{doi:'10.1234/same'});
 assert.deepEqual(await library.duplicateGroups(),[{target:bare,sources:[file.paperId]}]);
 await library.mergePapers(bare,file.paperId);
 assert.equal(library.paper(bare).primaryAttachmentId,file.attachmentId);
 library=await Library.open(root);assert.equal(library.paper(bare).attachments.length,1);assert.equal((await library.snapshot()).papers[0].files.original.name,'paper.pdf');
 // What an earlier version wrote: files, but no file named as the one to open.
 const meta=path.join(root,appName.vaultDir,'library.json'),data=JSON.parse(await fs.readFile(meta,'utf8'));data.papers[0].primaryAttachmentId=null;await fs.writeFile(meta,JSON.stringify(data));
 library=await Library.open(root);assert.equal(library.paper(bare).primaryAttachmentId,file.attachmentId);
 assert.equal(JSON.parse(await fs.readFile(meta,'utf8')).papers[0].primaryAttachmentId,file.attachmentId,'the repair is saved');
});

// The settings folder (userData) of an earlier app: the earlier app, else <first id>, taken over before anything reads it.
const appFor = (appData, { userData = path.join(appData, appName.product), switched = false } = {}) => ({ getName: () => appName.product, getPath: name => ({ appData, userData })[name], commandLine: { hasSwitch: name => switched && name === 'user-data-dir' } });
const writeSettings = async (folder, text) => { await fs.mkdir(folder, { recursive: true }); await fs.writeFile(path.join(folder, 'settings.json'), text); };
const readSettings = folder => fs.readFile(path.join(folder, 'settings.json'), 'utf8');
const quietly = fn => { const quiet = console.error; console.error = () => {}; try { return fn(); } finally { console.error = quiet; } };
test(`the settings folder of ${nameBefore.product} or ${nameFirst.product} is taken over as ${appName.product}, once, and never one given on the command line`, async t => {
  const dir = await fixture(t), { adoptUserData } = require('../desktop/legacy.cjs');
  let n = 0; const place = async () => { const appData = path.join(dir, 'appdata-' + n++); await fs.mkdir(appData); return appData; };
  // (a) the earlier app alone: renamed. (h) A second call changes nothing.
  let appData = await place(); await writeSettings(path.join(appData, nameBefore.product), 'papi');
  assert.equal(adoptUserData(appFor(appData)), true); assert.equal(await readSettings(path.join(appData, appName.product)), 'papi'); await assert.rejects(fs.access(path.join(appData, nameBefore.product)));
  assert.equal(adoptUserData(appFor(appData)), false); assert.deepEqual(await fs.readdir(appData), [appName.product]);
  // (b) <first id> alone.
  appData = await place(); await writeSettings(path.join(appData, nameFirst.product), nameFirst.product);
  assert.equal(adoptUserData(appFor(appData)), true); assert.equal(await readSettings(path.join(appData, appName.product)), nameFirst.product);
  // (c) Both: the earlier app's, and <first id>'s is left.
  appData = await place(); await writeSettings(path.join(appData, nameBefore.product), 'papi'); await writeSettings(path.join(appData, nameFirst.product), nameFirst.product);
  assert.equal(adoptUserData(appFor(appData)), true); assert.equal(await readSettings(path.join(appData, appName.product)), 'papi'); assert.equal(await readSettings(path.join(appData, nameFirst.product)), nameFirst.product);
  // (d) <product> already in use: nothing changes.
  appData = await place(); await writeSettings(path.join(appData, nameBefore.product), 'papi'); await writeSettings(path.join(appData, appName.product), 'beta');
  assert.equal(adoptUserData(appFor(appData)), false); assert.equal(await readSettings(path.join(appData, appName.product)), 'beta'); assert.equal(await readSettings(path.join(appData, nameBefore.product)), 'papi');
  // (e) The empty <product> Electron makes before the app's code runs, or one holding only what Chromium wrote: the old
  // folder is renamed into its place whole, and what was there goes.
  appData = await place(); await writeSettings(path.join(appData, nameBefore.product), 'papi'); await fs.mkdir(path.join(appData, appName.product));
  assert.equal(adoptUserData(appFor(appData)), true); assert.deepEqual(await fs.readdir(appData), [appName.product]); assert.equal(await readSettings(path.join(appData, appName.product)), 'papi');
  appData = await place(); await writeSettings(path.join(appData, nameBefore.product), 'papi'); await fs.writeFile(path.join(appData, nameBefore.product, 'llm-keys.json'), 'key');
  await fs.mkdir(path.join(appData, appName.product)); await fs.writeFile(path.join(appData, appName.product, 'Local State'), 'chromium');
  assert.equal(adoptUserData(appFor(appData)), true); assert.deepEqual(await fs.readdir(appData), [appName.product]);
  assert.deepEqual((await fs.readdir(path.join(appData, appName.product))).sort(), ['llm-keys.json', 'settings.json'], 'the old folder whole, nothing of what Chromium wrote');
  // (f) A development run looks at the earlier app's <product>-dev only.
  appData = await place(); await writeSettings(path.join(appData, nameBefore.product), 'papi'); await writeSettings(path.join(appData, `${nameBefore.product}-dev`), 'papi-dev');
  assert.equal(adoptUserData(appFor(appData), '-dev'), true); assert.equal(await readSettings(path.join(appData, `${appName.product}-dev`)), 'papi-dev'); assert.equal(await readSettings(path.join(appData, nameBefore.product)), 'papi');
  // (g) A folder given on the command line (any place but the default) is left alone, told by the folder in use, not by
  // the switch: Chromium ignores --user-data-dir given with a space and uses the default, which is then taken over.
  appData = await place(); await writeSettings(path.join(appData, nameBefore.product), 'papi');
  assert.equal(adoptUserData(appFor(appData, { userData: path.join(dir, 'elsewhere', appName.product) })), false);
  assert.equal(adoptUserData(appFor(appData, { userData: path.join(appData, 'Another') })), false);
  assert.deepEqual(await fs.readdir(appData), [nameBefore.product]);
  assert.equal(adoptUserData(appFor(appData, { switched: true })), true); assert.equal(await readSettings(path.join(appData, appName.product)), 'papi');
});
test('a settings takeover that cannot finish leaves the old folder whole, puts back what it moved, and is done at the next start', async t => {
  const dir = await fixture(t), { adoptUserData } = require('../desktop/legacy.cjs'), fsSync = require('node:fs'), renameSync = fsSync.renameSync, cpSync = fsSync.cpSync;
  const appData = path.join(dir, 'appdata'); await writeSettings(path.join(appData, nameBefore.product), 'papi');
  for (const [name, text] of [['llm-keys.json', 'key'], ['chatgpt-session.json', 'session']]) await fs.writeFile(path.join(appData, nameBefore.product, name), text);
  await fs.mkdir(path.join(appData, nameBefore.product, 'themes', 'warm'), { recursive: true }); await fs.writeFile(path.join(appData, nameBefore.product, 'themes', 'warm', 'theme.css'), 'old theme');
  // (h) A link Chromium leaves pointing nowhere once the app is closed is copied as a link.
  await fs.symlink(`${os.hostname()}-${2 ** 22 + 12345}`, path.join(appData, nameBefore.product, 'SingletonLock'));
  const tree = async folder => (await fs.readdir(folder, { recursive: true })).sort(), before = await tree(path.join(appData, nameBefore.product));
  // What Chromium made in <product> before the app's code ran.
  await fs.mkdir(path.join(appData, appName.product)); await fs.writeFile(path.join(appData, appName.product, 'Local State'), 'chromium');
  // The rename refused (another drive), then the copy cut short by a full disk: nothing changes, <product> is put back.
  fsSync.renameSync = (from, to) => { if (path.basename(from) === nameBefore.product) throw Object.assign(Error('EXDEV: cross-device link'), { code: 'EXDEV' }); return renameSync(from, to); };
  fsSync.cpSync = () => { throw Object.assign(Error('ENOSPC: no space left on device'), { code: 'ENOSPC' }); };
  try { assert.equal(quietly(() => adoptUserData(appFor(appData))), false); } finally { fsSync.cpSync = cpSync; }
  assert.deepEqual(adoptUserData.failed, { name: nameBefore.product, reason: 'space' }); assert.deepEqual(await tree(path.join(appData, nameBefore.product)), before);
  assert.deepEqual(await fs.readdir(path.join(appData, appName.product)), ['Local State']); assert.deepEqual((await fs.readdir(appData)).sort(), [appName.product, nameBefore.product].sort());
  // (h) The copy, with space: whole, the dead link included, in one rename.
  try { assert.equal(quietly(() => adoptUserData(appFor(appData))), true); } finally { fsSync.renameSync = renameSync; }
  assert.deepEqual(await tree(path.join(appData, appName.product)), before); assert.deepEqual((await fs.readdir(appData)).sort(), [appName.product, nameBefore.product].sort(), 'the old folder kept where it was copied');
  assert.equal(adoptUserData(appFor(appData)), false, 'in use now: never again');
});
test('a settings folder in use is never replaced; a takeover once done stays done', async t => {
  const dir = await fixture(t), { adoptUserData } = require('../desktop/legacy.cjs'), fsSync = require('node:fs'), rmSync = fsSync.rmSync;
  // (a) The rename done, the moved-aside folder cannot be removed at once: the takeover counts, the next start changes nothing.
  let appData = path.join(dir, 'aside'); await writeSettings(path.join(appData, nameBefore.product), 'papi');
  await fs.mkdir(path.join(appData, appName.product)); await fs.writeFile(path.join(appData, appName.product, 'Local State'), 'chromium');
  fsSync.rmSync = (target, options) => { if (path.basename(String(target)).startsWith(`.${appName.product}-before-`)) throw Object.assign(Error('EBUSY: resource busy'), { code: 'EBUSY' }); return rmSync(target, options); };
  try { assert.equal(adoptUserData(appFor(appData)), true); } finally { fsSync.rmSync = rmSync; }
  assert.equal(adoptUserData.failed, null); assert.equal(await readSettings(path.join(appData, appName.product)), 'papi');
  await fs.writeFile(path.join(appData, appName.product, 'llm-keys.json'), 'beta key');
  assert.equal(adoptUserData(appFor(appData)), false); assert.equal(await fs.readFile(path.join(appData, appName.product, 'llm-keys.json'), 'utf8'), 'beta key');
  assert.deepEqual(await fs.readdir(appData), [appName.product], 'the folder moved aside (only what Chromium made) is removed at the next start');
  // (b) the app in use (keys, a theme, the page's storage) and the earlier app run once more, making its settings again: left alone.
  appData = path.join(dir, 'in-use'); const beta = path.join(appData, appName.product); await fs.mkdir(path.join(beta, 'themes', 'mine'), { recursive: true });
  await fs.writeFile(path.join(beta, 'llm-keys.json'), 'beta key'); await fs.mkdir(path.join(beta, 'Local Storage')); await fs.writeFile(path.join(beta, 'settings.json'), 'beta');
  await writeSettings(path.join(appData, nameBefore.product), 'papi again');
  assert.equal(adoptUserData(appFor(appData)), false); assert.equal(await readSettings(beta), 'beta'); assert.equal(await readSettings(path.join(appData, nameBefore.product)), 'papi again');
  // (c) Its settings.json alone removed (to start the settings over): still in use, still left alone.
  await fs.rm(path.join(beta, 'settings.json'));
  assert.equal(adoptUserData(appFor(appData)), false); assert.equal(await fs.readFile(path.join(beta, 'llm-keys.json'), 'utf8'), 'beta key'); await fs.access(path.join(appData, nameBefore.product, 'settings.json'));
  // (g) the earlier app taken over while <first id> is there too: <first id> never comes in, however often it starts.
  appData = path.join(dir, 'both'); await writeSettings(path.join(appData, nameBefore.product), 'papi'); await writeSettings(path.join(appData, nameFirst.product), nameFirst.product);
  assert.equal(adoptUserData(appFor(appData)), true);
  for (let i = 0; i < 3; i++) assert.equal(adoptUserData(appFor(appData)), false);
  assert.equal(await readSettings(path.join(appData, appName.product)), 'papi'); assert.equal(await readSettings(path.join(appData, nameFirst.product)), nameFirst.product);
});
test('a settings takeover waits for an earlier app still running, for another run, and fails in words on any error', async t => {
  const dir = await fixture(t), { adoptUserData } = require('../desktop/legacy.cjs'), fsSync = require('node:fs'), renameSync = fsSync.renameSync, net = require('node:net');
  // The earlier app runs from that folder: its SingletonSocket answers (Chromium's own check). Closed, the socket refuses.
  let appData = path.join(dir, 'running'); const old = path.join(appData, nameBefore.product); await writeSettings(old, 'papi');
  const socketDir = await fs.mkdtemp(path.join(os.tmpdir(), 's-')), socketPath = path.join(socketDir, 'SingletonSocket'); t.after(() => fs.rm(socketDir, { recursive: true, force: true }));
  const server = net.createServer(); await new Promise(done => server.listen(socketPath, done));
  t.after(() => new Promise(done => server.close(() => done())));
  await fs.symlink(`${os.hostname()}-${2 ** 22 + 12345}`, path.join(old, 'SingletonLock')); await fs.symlink(socketPath, path.join(old, 'SingletonSocket'));
  assert.equal(quietly(() => adoptUserData(appFor(appData))), false); assert.deepEqual(adoptUserData.failed, { name: nameBefore.product, reason: 'running', lock: path.join(old, 'SingletonLock') }); await fs.access(path.join(old, 'settings.json'));
  await new Promise(done => server.close(done));
  assert.equal(adoptUserData(appFor(appData)), true, 'a socket that refuses: the app is gone, whatever pid the lock names');
  // A settings folder shared with another computer where the earlier app runs: its lock names that host, its socket is in
  // that computer's temporary folder (missing here). In doubt, counted as running, the lock named.
  appData = path.join(dir, 'shared'); const sharedOld = path.join(appData, nameBefore.product); await writeSettings(sharedOld, 'papi');
  await fs.symlink(`host-a-${process.ppid}`, path.join(sharedOld, 'SingletonLock')); await fs.symlink('/tmp/.org.chromium.Chromium.gone/SingletonSocket', path.join(sharedOld, 'SingletonSocket'));
  assert.equal(quietly(() => adoptUserData(appFor(appData))), false); assert.deepEqual(adoptUserData.failed, { name: nameBefore.product, reason: 'running', lock: path.join(sharedOld, 'SingletonLock') });
  // No socket to ask: this computer's live pid is running; another host's link is in doubt, counted as running and named.
  appData = path.join(dir, 'link'); const linkOld = path.join(appData, nameBefore.product); await writeSettings(linkOld, 'papi'); const link = path.join(linkOld, 'SingletonLock');
  await fs.symlink(`${os.hostname()}-${process.ppid}`, link);
  assert.equal(quietly(() => adoptUserData(appFor(appData))), false); assert.deepEqual(adoptUserData.failed, { name: nameBefore.product, reason: 'running', lock: link });
  await fs.rm(link); await fs.symlink(`renamed-host-${process.ppid}`, link);
  assert.equal(quietly(() => adoptUserData(appFor(appData))), false); assert.deepEqual(adoptUserData.failed, { name: nameBefore.product, reason: 'running', lock: link });
  await fs.rm(link); await fs.symlink(`${os.hostname()}-${2 ** 22 + 12345}`, link);
  assert.equal(adoptUserData(appFor(appData)), true, 'this computer\'s pid that is gone: not running');
  // On Windows a running app holds its folder: the rename is refused even after trying again, and nothing is copied.
  appData = path.join(dir, 'held'); await writeSettings(path.join(appData, nameBefore.product), 'papi');
  fsSync.renameSync = (from, to) => { if (path.basename(from) === nameBefore.product) throw Object.assign(Error('EPERM: operation not permitted'), { code: 'EPERM' }); return renameSync(from, to); };
  try { assert.equal(quietly(() => adoptUserData(appFor(appData))), false); } finally { fsSync.renameSync = renameSync; }
  assert.deepEqual(adoptUserData.failed, { name: nameBefore.product, reason: 'busy' }); assert.deepEqual(await fs.readdir(appData), [nameBefore.product]);
  // Another run holds the lock: this one does nothing and its app quits.
  appData = path.join(dir, 'locked'); await writeSettings(path.join(appData, nameBefore.product), 'papi'); const lock = path.join(appData, `.${appName.product}-adopt.lock`);
  await fs.writeFile(lock, JSON.stringify({ pid: process.ppid, host: os.hostname() }));
  assert.equal(adoptUserData(appFor(appData)), false); assert.equal(adoptUserData.busy, true); assert.equal(adoptUserData.failed, null);
  // One left by a run that is gone is taken; an earlier run's copy is removed.
  await fs.writeFile(lock, JSON.stringify({ pid: 2 ** 22 + 12345, host: os.hostname() })); await fs.mkdir(path.join(appData, `.${appName.product}-from-999`)); await fs.writeFile(path.join(appData, `.${appName.product}-from-999`, 'llm-keys.json'), 'copy');
  assert.equal(adoptUserData(appFor(appData)), true); assert.deepEqual(await fs.readdir(appData), [appName.product]);
  // (e) The lock cannot be written (a full disk): no lock file left behind, and a takeover that was needed fails in words.
  appData = path.join(dir, 'full'); await writeSettings(path.join(appData, nameBefore.product), 'papi'); const writeSync = fsSync.writeSync;
  fsSync.writeSync = () => { throw Object.assign(Error('ENOSPC: no space left on device'), { code: 'ENOSPC' }); };
  try { assert.equal(quietly(() => adoptUserData(appFor(appData))), false); } finally { fsSync.writeSync = writeSync; }
  assert.deepEqual(adoptUserData.failed, { name: nameBefore.product, reason: 'space' }); assert.deepEqual(await fs.readdir(appData), [nameBefore.product]);
  // (d) A leftover that cannot be removed is let be: the takeover goes on (and nothing fails when there is none to do).
  appData = path.join(dir, 'stuck'); await writeSettings(path.join(appData, nameBefore.product), 'papi'); await fs.mkdir(path.join(appData, `.${appName.product}-from-1`));
  const rmSync = fsSync.rmSync; fsSync.rmSync = (target, options) => { if (path.basename(String(target)) === `.${appName.product}-from-1`) throw Object.assign(Error('EACCES: permission denied'), { code: 'EACCES' }); return rmSync(target, options); };
  try {
    assert.equal(adoptUserData(appFor(appData)), true); assert.equal(adoptUserData.failed, null); assert.equal(await readSettings(path.join(appData, appName.product)), 'papi');
    assert.equal(adoptUserData(appFor(appData)), false); assert.equal(adoptUserData.failed, null, 'nothing to take over: the leftover is let be');
  } finally { fsSync.rmSync = rmSync; }
  // A folder moved aside by an earlier run that holds what the app makes, the new folder gone: it is put back, and is then
  // in use, so nothing is taken over and its keys stay.
  appData = path.join(dir, 'put-back'); await writeSettings(path.join(appData, nameBefore.product), 'papi'); const kept = path.join(appData, `.${appName.product}-before-111`);
  await writeSettings(kept, 'beta'); await fs.writeFile(path.join(kept, 'llm-keys.json'), 'beta key');
  assert.equal(adoptUserData(appFor(appData)), false); assert.equal(adoptUserData.failed, null);
  assert.equal(await fs.readFile(path.join(appData, appName.product, 'llm-keys.json'), 'utf8'), 'beta key'); assert.equal(await readSettings(path.join(appData, nameBefore.product)), 'papi');
  assert.deepEqual((await fs.readdir(appData)).sort(), [appName.product, nameBefore.product].sort());
  // The same with the empty <product> Electron makes before the app's code runs: that one makes way, the keys come back.
  appData = path.join(dir, 'put-back-empty'); await writeSettings(path.join(appData, nameBefore.product), 'papi'); const aside = path.join(appData, `.${appName.product}-before-4242`);
  await writeSettings(aside, 'beta'); await fs.writeFile(path.join(aside, 'llm-keys.json'), 'beta key'); await fs.mkdir(path.join(appData, appName.product));
  assert.equal(adoptUserData(appFor(appData)), false); assert.equal(adoptUserData.failed, null);
  assert.equal(await fs.readFile(path.join(appData, appName.product, 'llm-keys.json'), 'utf8'), 'beta key'); assert.deepEqual((await fs.readdir(appData)).sort(), [appName.product, nameBefore.product].sort());
  // One that cannot be put back stops the takeover (in words), so the earlier app's folder never takes its place.
  appData = path.join(dir, 'put-back-refused'); await writeSettings(path.join(appData, nameBefore.product), 'papi'); const refused = path.join(appData, `.${appName.product}-before-4343`);
  await writeSettings(refused, 'beta'); await fs.mkdir(path.join(appData, appName.product)); await fs.writeFile(path.join(appData, appName.product, 'Local State'), 'chromium');
  fsSync.renameSync = (from, to) => { if (from === refused) throw Object.assign(Error('EINVAL: invalid argument'), { code: 'EINVAL' }); return renameSync(from, to); };
  try { assert.equal(quietly(() => adoptUserData(appFor(appData))), false); } finally { fsSync.renameSync = renameSync; }
  assert.deepEqual(adoptUserData.failed, { name: nameBefore.product, reason: 'restore', aside: refused, folder: path.join(appData, appName.product) }); assert.equal(await readSettings(refused), 'beta'); assert.equal(await readSettings(path.join(appData, nameBefore.product)), 'papi');
  // With no earlier app's folder left to take over, the same: a start that went on would make <product> in use, and the
  // folder moved aside would never come back.
  await fs.rm(path.join(appData, nameBefore.product), { recursive: true });
  fsSync.renameSync = (from, to) => { if (from === refused) throw Object.assign(Error('EINVAL: invalid argument'), { code: 'EINVAL' }); return renameSync(from, to); };
  try { assert.equal(quietly(() => adoptUserData(appFor(appData))), false); } finally { fsSync.renameSync = renameSync; }
  assert.deepEqual(adoptUserData.failed, { name: null, reason: 'restore', aside: refused, folder: path.join(appData, appName.product) });
  assert.equal(adoptUserData(appFor(appData)), false, 'put back once it can be'); assert.equal(await readSettings(path.join(appData, appName.product)), 'beta');
});
test('the takeover lock: one of an earlier start or of this run is left over, one just made by another run is never removed', async t => {
  const dir = await fixture(t), { adoptUserData, bootTime } = require('../desktop/legacy.cjs'), fsSync = require('node:fs');
  const ready = async name => { const appData = path.join(dir, name); await writeSettings(path.join(appData, nameBefore.product), 'papi'); return appData; };
  const lockOf = appData => path.join(appData, `.${appName.product}-adopt.lock`), live = { pid: process.ppid, host: os.hostname(), boot: bootTime(), nonce: 'x' };
  // A lock of a process that runs, in this start of the computer: held.
  let appData = await ready('held'); await fs.writeFile(lockOf(appData), JSON.stringify(live));
  assert.equal(adoptUserData(appFor(appData)), false); assert.equal(adoptUserData.busy, true); assert.equal(adoptUserData.stuckLock, null);
  // Held for over a minute: the start that is blocked says so (stuckLock), naming the lock.
  const old = new Date(Date.now() - 120000); await fs.utimes(lockOf(appData), old, old);
  assert.equal(adoptUserData(appFor(appData)), false); assert.equal(adoptUserData.stuckLock, lockOf(appData));
  // Its pid used again by another process after a restart (a lock of an earlier start), or this run's own pid: left over.
  // A clock moved by minutes (a boot time worked out from it) does not make a running lock look like another start's.
  appData = await ready('clock'); await fs.writeFile(lockOf(appData), JSON.stringify({ ...live, boot: bootTime() - 300 }));
  assert.equal(adoptUserData(appFor(appData)), false); assert.equal(adoptUserData.busy, true);
  const startId = require('node:fs').existsSync('/proc/sys/kernel/random/boot_id') ? [['earlier-boot', { ...live, boot: 'an-earlier-start-of-this-computer' }]] : [];
  for (const [name, lock] of [...startId, ['own-pid', { ...live, pid: process.pid }]]) {
    appData = await ready(name); await fs.writeFile(lockOf(appData), JSON.stringify(lock));
    assert.equal(adoptUserData(appFor(appData)), true, name); assert.deepEqual(await fs.readdir(appData), [appName.product], name);
  }
  // A lock judged left over, replaced by another run while this one takes the breaker: the new lock is not removed.
  appData = await ready('replaced'); await fs.writeFile(lockOf(appData), JSON.stringify({ ...live, pid: 2 ** 22 + 12345 }));
  const openSync = fsSync.openSync, fresh = JSON.stringify({ ...live, nonce: 'another run' }); let swapped = false;
  fsSync.openSync = (file, flags, ...rest) => { if (String(file).endsWith('.break') && !swapped) { swapped = true; fsSync.writeFileSync(lockOf(appData), fresh); } return openSync(file, flags, ...rest); };
  try { assert.equal(adoptUserData(appFor(appData)), false); } finally { fsSync.openSync = openSync; }
  assert.equal(adoptUserData.busy, true); assert.equal(await fs.readFile(lockOf(appData), 'utf8'), fresh, 'the other run\'s lock stays'); await fs.access(path.join(appData, nameBefore.product, 'settings.json'));
  // A breaker another run has just taken over from one left by a run that is gone is not removed either.
  appData = await ready('breaker'); await fs.writeFile(lockOf(appData), JSON.stringify({ ...live, pid: 2 ** 22 + 12345 }));
  const breaker = lockOf(appData) + '.break'; await fs.writeFile(breaker, 'left by a run that is gone'); const longAgo = new Date(Date.now() - 60000); await fs.utimes(breaker, longAgo, longAgo);
  const readFileSync = fsSync.readFileSync; let reads = 0;
  fsSync.readFileSync = (file, ...rest) => { if (file === breaker && ++reads === 2) fsSync.writeFileSync(breaker, 'another run'); return readFileSync(file, ...rest); };
  try { assert.equal(adoptUserData(appFor(appData)), false); } finally { fsSync.readFileSync = readFileSync; }
  assert.equal(adoptUserData.busy, true); assert.equal(await fs.readFile(breaker, 'utf8'), 'another run');
  // This run's lock gone from under it (read back as missing): it counts as held by another run, not as a failure.
  appData = await ready('gone'); const writeSync = fsSync.writeSync;
  fsSync.writeSync = (fd, data, ...rest) => { const written = writeSync(fd, data, ...rest); fsSync.rmSync(lockOf(appData), { force: true }); return written; };
  try { assert.equal(adoptUserData(appFor(appData)), false); } finally { fsSync.writeSync = writeSync; }
  assert.equal(adoptUserData.busy, true); assert.equal(adoptUserData.failed, null); await fs.access(path.join(appData, nameBefore.product, 'settings.json'));
});
test('two starts at once take the settings over once and whole', async t => {
  const dir = await fixture(t), { spawn } = require('node:child_process'), legacy = require.resolve('../desktop/legacy.cjs');
  const code = appData => `const path=require('node:path'),a=${JSON.stringify(appData)};const {adoptUserData}=require(${JSON.stringify(legacy)});
    const r=adoptUserData({getName:()=>${JSON.stringify(appName.product)},getPath:n=>({appData:a,userData:path.join(a,${JSON.stringify(appName.product)})})[n],commandLine:{hasSwitch:()=>false}});process.stdout.write(JSON.stringify({r,busy:adoptUserData.busy,failed:adoptUserData.failed}));`;
  const run = appData => new Promise((resolve, reject) => { const child = spawn(process.execPath, ['-e', code(appData)]); let out = ''; child.stdout.on('data', d => { out += d; }); child.on('error', reject); child.on('close', () => resolve(JSON.parse(out))); });
  // (f) Three to five at once, again and again, with and without a lock left by a run that is gone.
  for (let round = 0; round < 24; round++) {
    const appData = path.join(dir, 'appdata-' + round); await writeSettings(path.join(appData, nameBefore.product), 'papi');
    for (let i = 0; i < 60; i++) await fs.writeFile(path.join(appData, nameBefore.product, `index-${i}.bin`), Buffer.alloc(2048, i));
    for (const name of ['llm-keys.json', 'chatgpt-session.json']) await fs.writeFile(path.join(appData, nameBefore.product, name), name);
    if (round % 2) await fs.writeFile(path.join(appData, `.${appName.product}-adopt.lock`), JSON.stringify({ pid: 2 ** 22 + 12345, host: os.hostname() }));
    const before = (await fs.readdir(path.join(appData, nameBefore.product))).sort();
    const results = await Promise.all(Array.from({ length: 3 + round % 3 }, () => run(appData)));
    assert.equal(results.filter(r => r.r).length, 1, JSON.stringify(results)); assert.ok(results.every(r => !r.failed), JSON.stringify(results));
    assert.deepEqual((await fs.readdir(path.join(appData, appName.product))).sort(), before, `round ${round}`); assert.deepEqual(await fs.readdir(appData), [appName.product], `round ${round}`);
  }
});
test('a save whose rename a cloud drive or antivirus holds for a moment is tried again; one still held says so in words', async t => {
  const fsp = require('node:fs/promises'), { atomicJson } = require('../desktop/storage.cjs'), rename = fsp.rename;
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), `${appName.id}-held-`)); t.after(() => { fsp.rename = rename; return fsp.rm(dir, { recursive: true, force: true }); });
  const file = path.join(dir, 'library.json'); let refusals = 2;
  fsp.rename = async (from, to) => { if (to === file && refusals-- > 0) throw Object.assign(Error(`EPERM: operation not permitted, rename '${from}' -> '${to}'`), { code: 'EPERM' }); return rename(from, to); };
  await atomicJson(file, { a: 1 });
  assert.deepEqual(JSON.parse(await fsp.readFile(file, 'utf8')), { a: 1 }, 'saved after two refusals');
  refusals = 99;
  await assert.rejects(atomicJson(file, { a: 2 }), error => error.code === 'EPERM' && !error.message.includes(dir) && /[가-힣]/.test(error.message));
  fsp.rename = rename;
  assert.deepEqual(JSON.parse(await fsp.readFile(file, 'utf8')), { a: 1 }, 'the file as it was');
  assert.deepEqual((await fsp.readdir(dir)).filter(n => n.endsWith('.tmp')), [], 'no temporary file left');
});
