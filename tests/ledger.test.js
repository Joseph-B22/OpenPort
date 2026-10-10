// Part of OpenPort's logic tests. Run all with: npm test   (no model, no embedder, no real screen)
// Mistake log: turning caught mistakes into facts, storing them, choosing which to show for a new question, expiring stale ones.
const ROOT = require('path').join(__dirname, '..').replace(/\\/g, '/');
const fs = require('fs'), path = require('path'), os = require('os');
const ok = (c, m) => console.log((c ? 'PASS ' : 'FAIL ') + m);
const L = require(ROOT + '/ledger.js');

// ---- facts say only what this PC proved ----
const paramResult = { status: 'bad-params', name: 'gci', resolved: 'Get-ChildItem', bad: [{ param: '-Recursive', why: 'unknown', suggest: ['Recurse'] }, { param: '-F', why: 'ambiguous', options: ['Filter', 'Force'] }], valid: ['Path', 'Filter', 'Recurse', 'Depth'] };
let e = L.entriesFrom(paramResult);
ok(e.length === 1 && e[0].kind === 'param' && e[0].command === 'Get-ChildItem' && e[0].token === '-Recursive', 'an invented parameter becomes one entry under the real command name (ambiguous short forms are not "mistakes" to remember)');
ok(/has no parameter -Recursive/.test(e[0].fact) && /-Recurse, -Depth/.test(e[0].fact) && !/should|use -Recurse|did you mean/i.test(e[0].fact), 'the fact states what does not exist and what does, never which one to use');
e = L.entriesFrom({ status: 'unknown-command', name: 'Get-NetAdapterStats', suggest: ['Get-NetAdapterStatistics'] });
ok(e.length === 1 && /no command named Get-NetAdapterStats/.test(e[0].fact) && /similar names that do exist: Get-NetAdapterStatistics \(similar name only/.test(e[0].fact), 'an invented command: "does not exist", plus real similar names clearly labelled as similar only');
ok(L.entriesFrom({ status: 'not-installed', name: 'Get-ADUser' }).length === 0 && L.entriesFrom({ status: 'ok', name: 'Get-Date' }).length === 0, 'missing modules and correct commands are not logged as mistakes');

// ---- picking facts for a new question ----
const unit = (...xs) => { const n = Math.hypot(...xs); return Float32Array.from(xs.map(x => x / n)); };
const rows = [
  { id: 1, kind: 'param', command: 'Get-ChildItem', token: '-Recursive', fact: 'f1', count: 3, emb: unit(1, 0, 0) },
  { id: 2, kind: 'command', command: 'Get-NetAdapterStats', token: 'Get-NetAdapterStats', fact: 'f2', count: 1, emb: unit(0, 1, 0) },
  { id: 3, kind: 'param', command: 'Get-Service', token: '-Names', fact: 'f3', count: 1, emb: null },
];
let p = L.pickRelevant(rows, { question: 'Why does Get-ChildItem skip subfolders?' });
ok(p.length === 1 && p[0].id === 1 && p[0].why === 'named', 'a question naming the command gets its fact');
p = L.pickRelevant(rows, { question: 'now make it go into subfolders', recent: 'Get-ChildItem -Path C:\\Logs | Remove-Item' });
ok(p.some(r => r.id === 1), 'a follow-up gets the facts for commands already used in the conversation');
p = L.pickRelevant(rows, { question: 'clean up old log files', qvec: unit(0.95, 0.1, 0) });
ok(p.length === 1 && p[0].id === 1 && p[0].why === 'similar question', 'a question similar in meaning to the one that caused the mistake gets the fact');
p = L.pickRelevant(rows, { question: 'what is the capital of France', qvec: unit(0, 0, 1) });
ok(p.length === 0, 'an unrelated question gets nothing');
ok(L.pickRelevant(Array.from({ length: 9 }, (_, i) => ({ ...rows[0], id: 10 + i, command: 'Get-ChildItem' })), { question: 'Get-ChildItem' }).length === 5, 'at most 5 facts per question');

// ---- facts are re-checked before use ----
const cat = { 'get-childitem': { found: true, params: ['Path', 'Recurse'], aliases: ['s=Recurse'] }, 'get-netadapterstats': { found: false } };
const lk = n => cat[n.toLowerCase()];
ok(L.stillTrue(rows[0], lk) === true && L.stillTrue(rows[1], lk) === true, 'facts that are still true are kept');
cat['get-netadapterstats'] = { found: true, params: [] };
ok(L.stillTrue(rows[1], lk) === false, 'if the command now exists (a module was installed), the "does not exist" fact is stale');
cat['get-childitem'].params.push('Recursive');
ok(L.stillTrue(rows[0], lk) === false, 'if the parameter now exists (PowerShell updated), the fact is stale');
ok(L.stillTrue(rows[2], () => undefined) === null, 'if PowerShell could not be asked, the answer is "unknown", not "false"');

// ---- database ----
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-'));
const db = require(ROOT + '/db.js');
db.open(dir);
const a = db.ledgerRecord({ kind: 'param', command: 'Get-ChildItem', token: '-Recursive', fact: 'f', question: 'q', emb: Array.from(unit(1, 0)), model: 'm1' });
const b = db.ledgerRecord({ kind: 'param', command: 'get-childitem', token: '-RECURSIVE', fact: 'f', model: 'm2', wasShown: true });
ok(!a.repeat && b.repeat && a.id === b.id, 'the same mistake (any capitalisation) is one entry, counted again');
db.ledgerMarkShown([a.id]); db.ledgerMarkShown([a.id]);
let all = db.ledgerAll();
ok(all.length === 1 && all[0].count === 2 && all[0].shown === 2 && all[0].repeat_after_shown === 1 && all[0].model === 'm2' && all[0].emb.length === 2, 'counts: times made, times shown to the model, repeats despite being shown');
const st = db.ledgerStats();
ok(st.entries === 1 && st.caught === 2 && st.repeats === 1 && st.repeatsAfterShown === 1, 'stats for the Memory page');
db.ledgerRecord({ kind: 'command', command: 'Get-Foo', token: 'Get-Foo', fact: 'g' });
db.ledgerDelete(a.id);
ok(db.ledgerAll().length === 1 && db.ledgerAll()[0].command === 'Get-Foo', 'one entry can be deleted');
db.deleteAll();
ok(db.ledgerAll().length === 0, '"Delete all chat history" also clears the mistake log (it holds question text)');
db.close();
try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* temp */ }
