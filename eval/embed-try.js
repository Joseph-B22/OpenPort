// Try EmbeddingGemma 2 directly: give it one question and several passages, see which it thinks match best.
//   node eval/embed-try.js "how do I fix a stale DNS record" "Flush the DNS cache with ipconfig /flushdns" "My favorite pasta uses garlic"
//   node eval/embed-try.js --dims 256 "question" "passage 1" "passage 2" ...
// Loads only the small embedding model (0.3 GB) at low priority for a few seconds. No chat model.
const path = require('path');
const root = path.join(__dirname, '..');
const embedder = require(path.join(root, 'embed.js'));

const argv = process.argv.slice(2);
let dims = 768;
const di = argv.indexOf('--dims');
if (di >= 0) { dims = +argv[di + 1]; argv.splice(di, 2); }
const [query, ...docs] = argv;
if (!query || docs.length < 2) {
  console.log('Usage: node eval/embed-try.js [--dims 128|256|512|768] "question" "passage 1" "passage 2" [more passages...]');
  process.exit(1);
}

const norm = v => { const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1; return v.map(x => x / n); };
const cut = v => (dims < v.length ? norm(v.slice(0, dims)) : v);
const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);

(async () => {
  const r = await embedder.start({ engineDir: path.join(root, 'engine'), modelsDir: path.join(root, 'models') });
  if (!r.ready) { console.log('Embedding model did not start:', r.reason); process.exit(1); }
  try {
    const [q] = await embedder.embed([query], 'query');
    const ds = await embedder.embed(docs, 'doc');
    const scored = docs.map((d, i) => ({ d, s: dot(cut(q), cut(ds[i])) })).sort((a, b) => b.s - a.s);
    console.log(`\nQuestion: ${query}   (${dims}-number vectors)\n`);
    for (const { d, s } of scored) console.log(`${s.toFixed(3)}  ${'█'.repeat(Math.max(0, Math.round((s - 0.4) * 60)))}  ${d.slice(0, 90)}`);
    console.log('\nHigher = closer in meaning. In this app: memory recall uses 0.65, in-chat recall 0.7. Related passages usually land around 0.75-0.85, unrelated around 0.5-0.7.');
  } finally { embedder.stop(); }
})().catch(e => { console.error('ERROR', e.message); try { embedder.stop(); } catch {} process.exit(1); });
