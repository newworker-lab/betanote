const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { VaultWatch, treeSignature } = require('../desktop/vault-watch.cjs');
const appName = require('../core/app-name.cjs');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

test('the tree signature follows folders and PDFs, and nothing hidden or of another kind', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), `${appName.id}-watch-`)); t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, appName.vaultDir)); await fs.writeFile(path.join(root, 'a.pdf'), 'one');
  const first = await treeSignature(root);
  await fs.writeFile(path.join(root, appName.vaultDir, 'library.json'), '{}'); await fs.writeFile(path.join(root, 'notes.txt'), 'x'); await fs.writeFile(path.join(root, '.hidden.pdf'), 'x');
  assert.equal(await treeSignature(root), first);
  await fs.mkdir(path.join(root, 'box')); const withFolder = await treeSignature(root); assert.notEqual(withFolder, first);
  await fs.writeFile(path.join(root, 'box', 'b.PDF'), 'two'); const withFile = await treeSignature(root); assert.notEqual(withFile, withFolder);
  await fs.writeFile(path.join(root, 'box', 'b.PDF'), 'two, longer'); assert.notEqual(await treeSignature(root), withFile);
  await fs.rm(path.join(root, 'box'), { recursive: true }); assert.equal(await treeSignature(root), first);
});

test('a change made outside is reported once; what the app read in full, or its own records, is not', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), `${appName.id}-watch-`)); t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, appName.vaultDir)); await fs.mkdir(path.join(root, 'papers')); await fs.writeFile(path.join(root, 'a.pdf'), 'one');
  let reported = 0; const watch = new VaultWatch({ onChange: () => { reported++; }, delay: 80 }); t.after(() => watch.stop());
  watch.start(root); await watch.work;
  // Outside: a PDF dropped into a folder (several events, one report).
  await fs.writeFile(path.join(root, 'papers', 'new.pdf'), 'x'); await fs.appendFile(path.join(root, 'papers', 'new.pdf'), 'y');
  await wait(400); await watch.work; assert.equal(reported, 1);
  // The app's own records and other kinds of files report nothing.
  await fs.writeFile(path.join(root, appName.vaultDir, 'library.json'), '{}'); await fs.writeFile(path.join(root, 'memo.txt'), 'x');
  await wait(400); await watch.work; assert.equal(reported, 1);
  // The app reads the folder in full: what was there when the reading began is seen, and a file
  // that arrives while it runs is still reported.
  await fs.writeFile(path.join(root, 'own.pdf'), 'x'); const seen = watch.reading(); await wait(30);
  await fs.writeFile(path.join(root, 'during.pdf'), 'x'); await seen();
  await wait(400); await watch.work; assert.equal(reported, 2);
  // Seen in full with nothing new since: nothing to report.
  await fs.writeFile(path.join(root, 'again.pdf'), 'x'); await wait(20); await watch.shown();
  await wait(400); await watch.work; assert.equal(reported, 2);
  // A file removed and a folder made outside.
  await fs.rm(path.join(root, 'a.pdf')); await wait(400); await watch.work; assert.equal(reported, 3);
  await fs.mkdir(path.join(root, 'new folder')); await wait(400); await watch.work; assert.equal(reported, 4);
  // After stop nothing is reported.
  watch.stop(); await fs.writeFile(path.join(root, 'late.pdf'), 'x'); await wait(300); assert.equal(reported, 4);
});
