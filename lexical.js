// Cheap keyword scoring (BM25) used as a control and as the second half of hybrid retrieval.
// Embeddings are good at meaning, keywords are good at exact tokens like IPs, hostnames and error codes.
const STOP = new Set('a an the and or of to in on for with is are was were be been it this that these those what which who whom when where why how do does did can could should would will my our we you your i at by from as about up out if then than so not no any there here has have had get got into over under just'.split(' '));

// Keeps whole tokens ("172.31.40.0/24", "svc-backup-07") and also their parts ("svc", "backup", "07").
function tokenize(s) {
  const out = [];
  for (const w of s.toLowerCase().match(/[a-z0-9][a-z0-9._\/:-]*[a-z0-9]|[a-z0-9]/g) || []) {
    if (STOP.has(w)) continue;
    out.push(w);
    if (/[._\/:-]/.test(w)) for (const p of w.split(/[._\/:-]+/)) if (p && !STOP.has(p)) out.push(p);
  }
  return out;
}

function bm25(chunks, query, { k1 = 1.4, b = 0.75 } = {}) {
  const docs = chunks.map(c => tokenize(c));
  const N = docs.length || 1;
  const avg = docs.reduce((n, d) => n + d.length, 0) / N || 1;
  const df = new Map();
  for (const d of docs) for (const t of new Set(d)) df.set(t, (df.get(t) || 0) + 1);
  const q = [...new Set(tokenize(query))];
  return docs.map(d => {
    const tf = new Map();
    for (const t of d) tf.set(t, (tf.get(t) || 0) + 1);
    let s = 0;
    for (const t of q) {
      const f = tf.get(t); if (!f) continue;
      const idf = Math.log(1 + (N - df.get(t) + 0.5) / (df.get(t) + 0.5));
      s += idf * (f * (k1 + 1)) / (f + k1 * (1 - b + b * d.length / avg));
    }
    return s;
  });
}

// Reciprocal-rank fusion of any number of score arrays (same length). Robust without tuning weights.
function fuse(scoreArrays, k = 60) {
  const n = scoreArrays[0].length;
  const total = new Array(n).fill(0);
  for (const scores of scoreArrays) {
    scores.map((s, i) => [s, i]).sort((a, b) => b[0] - a[0]).forEach(([s, i], rank) => { if (s > 0) total[i] += 1 / (k + rank + 1); });
  }
  return total;
}

module.exports = { tokenize, bm25, fuse };
