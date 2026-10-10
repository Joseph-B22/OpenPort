// Retrieval-utilization study: does a model use retrieved text like a small model or like a big one?
// Compares installed models (e.g. the 26B mixture-of-experts with ~4B active parameters vs a dense 12B) on the same
// questions under different amounts of supplied context.
//   node eval/study-retrieval.js --models gemma-4-26b-a4b,gemma-4-12b --backend cpu --yes
// THIS LOADS EACH CHAT MODEL, ONE AFTER THE OTHER. It refuses to run without --yes. Uses keyword retrieval only (no embedder).
const { spawn } = require('child_process');
const fs = require('fs'), path = require('path'), http = require('http');
const root = path.join(__dirname, '..');
const data = require('./data.js');
const models = require(path.join(root, 'models.js'));
const { chunkText } = require(path.join(root, 'indexer.js'));
const { bm25 } = require(path.join(root, 'lexical.js'));

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
if (!process.argv.includes('--yes')) { console.log('This loads each chat model in turn and uses a lot of memory. Re-run with --yes when ready (other apps closed).'); process.exit(1); }
const ids = arg('models', 'gemma-4-26b-a4b').split(','), backend = arg('backend', 'cpu'), ctx = +arg('ctx', 8192);
const has = (t, n) => t.toLowerCase().includes(n.toLowerCase());

// Questions come from the same synthetic files as the retrieval experiments, so retrieval itself is a solved variable:
// the study isolates what the MODEL does with the text it is given.
const docs = [data.buildConfig(), data.buildLog(), data.buildRunbook()];
const tasks = [];
for (const d of docs) {
  const chunks = chunkText(d.text, 800);
  for (const qa of d.qa) {
    const gold = chunks.findIndex(c => c.includes(qa.a));
    const ranked = bm25(chunks, qa.q).map((s, i) => [s, i]).sort((a, b) => b[0] - a[0]).map(x => x[1]);
    // the 4 best-matching WRONG chunks (none may contain the answer): hard distractors
    const distract = ranked.filter(i => i !== gold && !chunks[i].toLowerCase().includes(qa.a.toLowerCase())).slice(0, 4);
    tasks.push({ q: qa.q, a: qa.a, doc: d.name, gold: chunks[gold], distractors: distract.map(i => chunks[i]), head: d.text.slice(0, 12000) });
  }
}
const CONDITIONS = {
  'no context (memory only)': t => '',
  'gold passage only': t => t.gold,
  'gold + 4 look-alike passages': t => [t.distractors[0], t.gold, ...t.distractors.slice(1)].join('\n---\n'),
  'first 12k characters of the file': t => t.head,
};

function post(port, p, body) {
  return new Promise((res, rej) => {
    const d = JSON.stringify(body);
    const r = http.request({ host: '127.0.0.1', port, path: p, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(d) } }, x => { let b = ''; x.on('data', c => (b += c)); x.on('end', () => (x.statusCode === 200 ? res(JSON.parse(b)) : rej(new Error(`${x.statusCode}`)))); });
    r.on('error', rej); r.write(d); r.end();
  });
}

(async () => {
  const results = {};
  for (const id of ids) {
    const m = models.listChat(path.join(root, 'models')).find(x => x.id === id);
    if (!m) { console.log('model not found:', id); continue; }
    const port = 58700 + Math.floor(Math.random() * 200);
    const exe = path.join(root, 'engine', backend === 'gpu' ? 'vulkan' : 'cpu', 'llama-server.exe');
    const srv = spawn(exe, ['-m', m.file, '--host', '127.0.0.1', '--port', String(port), '-c', String(ctx), '--jinja', '--no-webui', '-cram', '1024', '-ngl', backend === 'gpu' ? '99' : '0', ...(backend === 'gpu' ? ['-lm', 'none'] : [])], { cwd: path.dirname(exe), windowsHide: true });
    srv.stderr.on('data', () => {}); srv.stdout.on('data', () => {});
    try {
      for (let i = 0; i < 240; i++) { try { await new Promise((r, j) => http.get({ host: '127.0.0.1', port, path: '/health' }, x => { x.resume(); x.statusCode === 200 ? r() : j(); }).on('error', j)); break; } catch { await new Promise(r => setTimeout(r, 1500)); } }
      results[id] = {};
      for (const [name, build] of Object.entries(CONDITIONS)) {
        let ok = 0, ms = 0;
        for (const t of tasks) {
          const context = build(t);
          const user = (context ? `${context}\n\n` : '') + `${t.q} Answer in one short sentence.` + (context ? ' Use only the text above.' : '');
          const t0 = Date.now();
          try { const r = await post(port, '/v1/chat/completions', { messages: [{ role: 'user', content: user }], max_tokens: 1200, temperature: 0, stream: false }); if (has(r.choices[0].message.content || '', t.a)) ok++; } catch { /* counts as wrong */ }
          ms += Date.now() - t0;
        }
        results[id][name] = { correct: ok, of: tasks.length, avgMs: Math.round(ms / tasks.length) };
        console.log(`${id} | ${name}: ${ok}/${tasks.length} (${(ms / tasks.length / 1000).toFixed(1)} s each)`);
      }
    } finally { srv.kill(); await new Promise(r => setTimeout(r, 4000)); }          // let memory free before the next model
  }
  console.log('\n| Condition | ' + ids.join(' | ') + ' |\n|---|' + ids.map(() => '---').join('|') + '|');
  for (const c of Object.keys(CONDITIONS)) console.log(`| ${c} | ` + ids.map(i => (results[i]?.[c] ? `${results[i][c].correct}/${results[i][c].of}` : '-')).join(' | ') + ' |');
  fs.writeFileSync(path.join(__dirname, 'results', `study-retrieval-${new Date().toISOString().replace(/[:.]/g, '-')}.json`), JSON.stringify({ ids, backend, ctx, results }, null, 2));
})().catch(e => { console.error('ERROR', e.message); process.exit(1); });
