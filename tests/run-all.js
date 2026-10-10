// Runs every logic test (tests/*.test.js) and prints a summary. These need no model, no embedder and no real screen.
//   npm test
const { spawnSync } = require('child_process');
const fs = require('fs'), path = require('path');

const files = fs.readdirSync(__dirname).filter(f => f.endsWith('.test.js')).sort();
let pass = 0, fail = 0;
for (const f of files) {
  const r = spawnSync(process.execPath, [path.join(__dirname, f)], { encoding: 'utf8', timeout: 120000 });
  const out = (r.stdout || '') + (r.stderr || '');
  const p = (out.match(/^PASS /gm) || []).length, x = (out.match(/^FAIL /gm) || []).length;
  pass += p; fail += x;
  const crashed = r.status !== 0 && !x && !p;
  console.log(`${x || crashed ? 'FAIL' : 'ok  '}  ${f.padEnd(26)} ${p} pass, ${x} fail${crashed ? '  (crashed: ' + out.split('\n').find(l => /Error/.test(l)) + ')' : ''}`);
  if (x) for (const l of out.split('\n')) if (l.startsWith('FAIL')) console.log('        ' + l);
  if (crashed) fail++;
}
console.log(`\n${pass} checks passed, ${fail} failed across ${files.length} test files.`);
process.exit(fail ? 1 : 0);
