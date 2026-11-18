// The vault's writer lease (desktop/vault-lock.cjs) on this computer: a lease whose process id another program now has
// (the app ended abruptly and the id was given again) is not taken for the app; where that cannot be told, opening asks
// to release it rather than refusing for good.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const appName = require('../core/app-name.cjs');
const { lockVault } = require('../desktop/vault-lock.cjs');
const { bootTime } = require('../desktop/legacy.cjs');
async function vault(t) { const dir = await fs.mkdtemp(path.join(os.tmpdir(), `${appName.id}-lock-`)); t.after(() => fs.rm(dir, { recursive: true, force: true })); await fs.mkdir(path.join(dir, appName.vaultDir)); return dir; }
// A process that is not this app, holding a pid the lease names.
function other(t) { const child = spawn(process.execPath, ['-e', 'setTimeout(()=>{},60000)'], { stdio: 'ignore' }); t.after(() => child.kill()); return child; }
const lease = (root, fields) => fs.writeFile(path.join(root, appName.vaultDir, 'writer.lock'), JSON.stringify({ host: os.hostname(), boot: bootTime(), token: 'old', ...fields }));
test('a lease of this computer whose pid another program now has is taken over when the process start tells so', { skip: process.platform !== 'linux' && 'reads /proc' }, async t => {
  const root = await vault(t), child = other(t); await new Promise(r => setTimeout(r, 200));
  await lease(root, { pid: child.pid, started: Math.round(Date.now() / 1000) - 3600 });
  const release = await lockVault(root); await release();
});
test('a lease of this computer that cannot be told apart asks to be released (a code the opening offers), and is released when asked', async t => {
  const root = await vault(t), child = other(t); await new Promise(r => setTimeout(r, 200));
  await lease(root, { pid: child.pid });
  await assert.rejects(lockVault(root), { code: 'APP_LOCKED_HERE' });
  const release = await lockVault(root, { takeOver: true }); await release();
});
test('a lease of this very process is never taken by another opening', async t => {
  const root = await vault(t), release = await lockVault(root);
  await assert.rejects(lockVault(root), error => error.code === 'APP_LOCKED_HERE' || /사용 중/.test(error.message));
  await release();
});
test('a lease naming this process that it does not hold (copied with the vault folder) is taken over', async t => {
  const root = await vault(t), copy = await vault(t), release = await lockVault(root);
  await fs.copyFile(path.join(root, appName.vaultDir, 'writer.lock'), path.join(copy, appName.vaultDir, 'writer.lock'));
  const second = await lockVault(copy); await second(); await release();
});
