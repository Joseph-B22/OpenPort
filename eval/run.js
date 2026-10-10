// Experiment harness. Uses ONLY the small embedding model (CPU); it never loads the chat model.
//   node eval/run.js [a|b|all]
// Prints markdown tables and saves raw numbers to eval/results/<timestamp>.json
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const embedder = require(path.join(root, 'embed.js'));
const { ContextMemory } = require(path.join(root, 'ctxmem.js'));
const { focusText } = require(path.join(root, 'focus.js'));
const data = require('./data.js');

const TOK = c => Math.round(c / 3);                       // ~3 chars per token, same rule the app uses
const pct = (n, d) => `${Math.round(100 * n / d)}% (${n}/${d})`;
const has = (text, needle) => text.toLowerCase().includes(needle.toLowerCase());

// Cached embedding so every experiment arm reuses the same vectors (and dims are derived by truncation).
const cache = new Map();
async function embed(texts, kind, opts = {}) {
  const out = new Array(texts.length), todo = [], idx = [];
  texts.forEach((t, i) => {
    const key = `${kind}|${opts.titles?.[i] ?? ''}|${t}`;
    if (cache.has(key)) out[i] = cache.get(key); else { todo.push(t); idx.push(i); }
  });
  for (let b = 0; b < todo.length; b += 16) {
    const part = todo.slice(b, b + 16), ids = idx.slice(b, b + 16);
    const vecs = await embedder.embed(part, kind, { titles: ids.map(i => opts.titles?.[i]) });
    vecs.forEach((v, j) => { cache.set(`${kind}|${opts.titles?.[ids[j]] ?? ''}|${part[j]}`, v); out[ids[j]] = v; });
  }
  return out;
}

function table(title, head, rows) {
  console.log(`\n### ${title}\n`);
  console.log('| ' + head.join(' | ') + ' |');
  console.log('|' + head.map(() => '---').join('|') + '|');
  for (const r of rows) console.log('| ' + r.join(' | ') + ' |');
}

// What a plain "drop the oldest messages" window keeps (same rule as trimmed() in the app).
function windowStart(turns, ctxTokens) {
  const budget = ctxTokens * 3 * 0.6;
  let total = 0, i = turns.length;
  while (i > 0 && total + turns[i - 1].text.length <= budget) { total += turns[i - 1].text.length; i--; }
  return { start: i, chars: total };
}

async function experimentA(results) {
  const { turns, needles } = data.buildChat();
  const totalChars = turns.reduce((n, t) => n + t.text.length, 0);
  console.log(`\n## Experiment A: live context memory\nChat: ${turns.length} turns, ${totalChars.toLocaleString()} chars (~${TOK(totalChars).toLocaleString()} tokens), ${needles.length} planted facts among look-alike decoys.`);

  const base = [8192, 16384].map(ctx => { const w = windowStart(turns, ctx); return { ctx, ...w, inWindow: needles.filter(n => n.turn >= w.start).length }; });
  table('Baseline: plain truncation (what the app does today)', ['Context', 'Window keeps', 'Planted facts still visible'],
    base.map(b => [b.ctx, `last ${turns.length - b.start} turns`, pct(b.inWindow, needles.length)]));
  results.A = { baseline: base };

  // index the chat once per arm
  const arms = [
    { name: 'embeddings 768-d', mode: 'embed', dims: 768 },
    { name: 'embeddings 256-d', mode: 'embed', dims: 256 },
    { name: 'embeddings 128-d', mode: 'embed', dims: 128 },
    { name: 'keywords only (BM25)', mode: 'lexical', dims: 768 },
    { name: 'hybrid 256-d + keywords', mode: 'hybrid', dims: 256 },
  ];
  const w = windowStart(turns, 8192);                      // evaluate against the 8k window
  const t0 = Date.now();
  const rows = [], detail = [];
  for (const arm of arms) {
    const mem = new ContextMemory({ embed, mode: arm.mode, dims: arm.dims });
    for (let i = 0; i < turns.length; i++) await mem.addTurn(i, turns[i].role, turns[i].text);
    const hits = { 1: 0, 3: 0, 5: 0 }; let injChars = 0, rankSum = 0, found = 0;
    for (const n of needles) {
      const rec = await mem.recall(n.query, { before: w.start, k: 5 });
      for (const k of [1, 3, 5]) if (rec.slice(0, k).some(r => has(r.text, n.expect))) hits[k]++;
      const rank = rec.findIndex(r => has(r.text, n.expect));
      if (rank >= 0) { rankSum += rank + 1; found++; }
      injChars += rec.slice(0, 3).reduce((c, r) => c + r.text.length, 0);
    }
    rows.push([arm.name, pct(hits[1], needles.length), pct(hits[3], needles.length), pct(hits[5], needles.length), found ? (rankSum / found).toFixed(2) : '-', `~${TOK(injChars / needles.length)} tokens`]);
    detail.push({ arm: arm.name, hits, avgInjectedTokensAt3: TOK(injChars / needles.length) });
  }
  table('Recall of facts that fell out of the 8k window (needle found in the injected text)', ['Method', 'top-1', 'top-3', 'top-5', 'avg rank', 'Injected at k=3'], rows);
  results.A.recall = detail;
  console.log(`(indexing + recall for 5 methods took ${((Date.now() - t0) / 1000).toFixed(0)}s)`);

  // threshold study: can we tell "answer is in the chat" from "it is not"?
  const mem = new ContextMemory({ embed, mode: 'embed', dims: 768 });
  for (let i = 0; i < turns.length; i++) await mem.addTurn(i, turns[i].role, turns[i].text);
  const pos = [], neg = [];
  for (const n of needles) { const r = await mem.recall(n.query, { before: w.start, k: 1 }); if (r[0]) pos.push(r[0].cos); }
  for (const q of data.UNANSWERABLE) { const r = await mem.recall(q, { before: w.start, k: 1 }); if (r[0]) neg.push(r[0].cos); }
  const stat = a => `min ${Math.min(...a).toFixed(3)} · median ${a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)].toFixed(3)} · max ${Math.max(...a).toFixed(3)}`;
  console.log(`\n### Score separation (top-1 cosine, 768-d)\n\n- answerable questions:   ${stat(pos)}\n- unanswerable questions: ${stat(neg)}`);
  let best = { t: 0, acc: 0 };
  for (let t = 0.4; t <= 0.9; t += 0.01) { const acc = (pos.filter(x => x >= t).length + neg.filter(x => x < t).length) / (pos.length + neg.length); if (acc > best.acc) best = { t: +t.toFixed(2), acc }; }
  console.log(`- best single threshold: ${best.t} (${Math.round(best.acc * 100)}% of ${pos.length + neg.length} questions classified correctly)\n- the app's current memory cutoff is 0.65`);
  results.A.threshold = { pos, neg, best };
}

async function experimentB(results) {
  const docs = [data.buildConfig(), data.buildLog(), data.buildRunbook()];
  console.log('\n## Experiment B: query-focused trimming of big files');
  const HEAD = 12000;                                      // what read_file returns first today
  const where = docs.map(d => [d.name, d.text.length.toLocaleString(), d.qa.map(x => Math.round(100 * d.text.indexOf(x.a) / d.text.length) + '%').join(', '), d.qa.filter(x => d.text.indexOf(x.a) < HEAD).length + '/' + d.qa.length]);
  table('Test files (where each answer sits in the file)', ['File', 'Chars', 'Answer positions', 'Answers inside first 12k chars'], where);

  const total = docs.reduce((n, d) => n + d.qa.length, 0);
  const rows = [];
  const baseline = docs.reduce((n, d) => n + d.qa.filter(x => has(d.text.slice(0, HEAD), x.a)).length, 0);
  rows.push(['first 12k chars (today)', '12000', `~${TOK(HEAD)}`, pct(baseline, total)]);

  const arms = [];
  for (const mode of ['lexical', 'embed', 'hybrid']) for (const budget of [3000, 6000]) arms.push({ mode, budget, chunk: 800, dims: 256 });
  arms.push({ mode: 'hybrid', budget: 3000, chunk: 500, dims: 256 }, { mode: 'hybrid', budget: 3000, chunk: 1500, dims: 256 }, { mode: 'hybrid', budget: 3000, chunk: 800, dims: 768 });
  const out = [];
  for (const a of arms) {
    let ok = 0, chars = 0;
    for (const d of docs) for (const x of d.qa) {
      const r = await focusText(d.text, x.q, { embed, budgetChars: a.budget, chunkChars: a.chunk, dims: a.dims, mode: a.mode });
      if (has(r.text, x.a)) ok++;
      chars += r.chars;
    }
    const label = `${a.mode} · ${a.budget / 1000}k budget · ${a.chunk}-char chunks · ${a.dims}-d`;
    rows.push([label, String(Math.round(chars / total)), `~${TOK(chars / total)}`, pct(ok, total)]);
    out.push({ ...a, accuracy: ok / total, avgChars: chars / total });
  }
  table('Does the returned text contain the answer?', ['Method', 'avg chars returned', 'avg tokens', 'Answer present'], rows);
  results.B = { baseline: baseline / total, arms: out };
}

(async () => {
  const which = process.argv[2] || 'all';
  const os = require('os');
  console.log(`# Experiment run ${new Date().toISOString()}\nCPU: ${os.cpus()[0].model.trim()} · embedder: EmbeddingGemma 2 (Q8, CPU) · chat model NOT loaded`);
  const r = await embedder.start({ engineDir: path.join(root, 'engine'), modelsDir: path.join(root, 'models') });
  if (!r.ready) { console.log('Embedding model could not start:', r.reason); process.exit(1); }
  const results = { when: new Date().toISOString() };
  const t0 = Date.now();
  try {
    if (which === 'a' || which === 'all') await experimentA(results);
    if (which === 'b' || which === 'all') await experimentB(results);
  } finally { embedder.stop(); }
  fs.mkdirSync(path.join(__dirname, 'results'), { recursive: true });
  const file = path.join(__dirname, 'results', `${results.when.replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(file, JSON.stringify(results, null, 2));
  console.log(`\nTotal ${((Date.now() - t0) / 1000).toFixed(0)}s · embeddings computed: ${cache.size} · saved ${path.relative(root, file)}`);
})().catch(e => { console.error('ERROR', e); try { embedder.stop(); } catch {} process.exit(1); });
