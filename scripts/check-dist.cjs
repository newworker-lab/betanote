// Loads dist/index.html's scripts in one shared global scope (as the window does) and reports
// any script that cannot even start: a syntax error or a name declared twice across scripts.
const fs = require('fs'), path = require('path'), vm = require('vm');
const dist = path.resolve(process.argv[2] || 'dist'), html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
const ctx = vm.createContext({}); let bad = 0;
for (const [, src] of html.matchAll(/<script src="([^"]+)"/g)) {
  const file = path.join(dist, src); let code;
  try { code = fs.readFileSync(file, 'utf8'); } catch { console.log('MISSING', src); bad++; continue; }
  try { new vm.Script(code, { filename: src }).runInContext(ctx, { timeout: 2000 }); }
  catch (e) { if (e instanceof SyntaxError || e?.constructor?.name === 'SyntaxError') { console.log('FAIL', src, '-', e.message); bad++; } }
}
console.log(bad ? `${bad} script(s) cannot load` : 'all scripts load');
