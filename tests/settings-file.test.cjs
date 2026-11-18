// This computer's settings files (desktop/settings-file.cjs): one that cannot be read is set aside beside itself and the
// app starts from the defaults, telling what it did; settings.json's missing parts are filled in.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const appName = require('../core/app-name.cjs');
const { readSettingsFile, settingsShape } = require('../desktop/settings-file.cjs');
const { ApiKeyStore } = require('../desktop/api-llm.cjs');
const { ChatGPT } = require('../desktop/chatgpt.cjs');
async function dir(t) { const d = await fs.mkdtemp(path.join(os.tmpdir(), `${appName.id}-settings-`)); t.after(() => fs.rm(d, { recursive: true, force: true })); return d; }
test('a settings file that cannot be read is set aside and the defaults are used, said in a notice', async t => {
  const d = await dir(t);
  for (const [name, text] of [['broken.json', '{broken'], ['list.json', '[1,2]'], ['text.json', '"x"'], ['null.json', 'null']]) {
    const file = path.join(d, name), notices = []; await fs.writeFile(file, text);
    assert.deepEqual(await readSettingsFile(file, { a: 1 }, notices, 'settings'), { a: 1 }, name);
    assert.equal(notices.length, 1, name); assert.equal(notices[0].kind, 'settings'); assert.match(notices[0].aside, new RegExp(`^${name}\\.broken-\\d+$`));
    assert.equal(await fs.readFile(path.join(d, notices[0].aside), 'utf8'), text, `${name}: kept beside`); await assert.rejects(fs.access(file));
  }
  const fine = path.join(d, 'fine.json'), notices = []; await fs.writeFile(fine, '{"b":2}');
  assert.deepEqual(await readSettingsFile(fine, { a: 1 }, notices, 'settings'), { b: 2 }); assert.deepEqual(notices, []);
  assert.deepEqual(await readSettingsFile(path.join(d, 'none.json'), { a: 1 }, notices, 'settings'), { a: 1 }); assert.deepEqual(notices, []);
});
test('settings.json without its recents, or with odd ones, is filled in', () => {
  for (const raw of [{}, { recents: null }, { recents: 'x' }, { recents: [null, 1, { id: 'a' }, { id: 'v', name: 'V', root: '/v' }] }]) {
    const shaped = settingsShape(raw);
    assert.ok(Array.isArray(shaped.recents)); assert.ok(shaped.recents.every(r => typeof r.id === 'string' && typeof r.root === 'string' && typeof r.name === 'string'));
    assert.equal(shaped.provider, 'gpt'); assert.ok(shaped.llm && typeof shaped.llm.connection === 'string');
  }
  assert.deepEqual(settingsShape({ recents: [{ id: 'v', name: 'V', root: '/v' }] }).recents, [{ id: 'v', name: 'V', root: '/v' }]);
});
test('a broken ChatGPT or API key file does not stop the start; it is set aside and asks to connect again', async t => {
  const d = await dir(t), notices = [];
  await fs.writeFile(path.join(d, 'chatgpt-host.json'), '{'); await fs.writeFile(path.join(d, 'chatgpt-session.json'), '{'); await fs.writeFile(path.join(d, 'llm-keys.json'), '{');
  const auth = new ChatGPT({ directory: d, persistent: () => true, protect: s => Buffer.from(s), unprotect: b => Buffer.from(b).toString(), notices });
  await auth.init();
  const keys = new ApiKeyStore({ file: path.join(d, 'llm-keys.json'), persistent: () => true, protect: s => Buffer.from(s), unprotect: b => Buffer.from(b).toString(), notices });
  await keys.init();
  assert.deepEqual(notices.map(n => n.kind).sort(), ['chatgpt', 'chatgpt', 'keys']);
  assert.equal(auth.status().connected, false);
});
