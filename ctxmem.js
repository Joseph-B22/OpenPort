// Experiment A: live context memory. Every conversation turn is embedded as it happens. When old turns fall
// out of the model's window, the ones relevant to the current question are found again and re-inserted,
// so a small window behaves like a larger memory. `embed(texts, kind, opts)` returns normalized 768-d vectors.
const { bm25, fuse } = require('./lexical');

function normalize(v) { let n = 0; for (const x of v) n += x * x; n = Math.sqrt(n) || 1; return v.map(x => x / n); }
const truncate = (v, dims) => (dims && dims < v.length ? normalize(v.slice(0, dims)) : v);
const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };

// Splits a long turn into pieces of at most `max` characters, preferring paragraph then sentence breaks.
function segmentText(text, max = 700) {
  const out = [];
  let rest = text.trim();
  while (rest.length > max) {
    let cut = rest.lastIndexOf('\n\n', max);
    if (cut < max * 0.4) cut = rest.lastIndexOf('. ', max) + 1;
    if (cut < max * 0.4) cut = max;
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) out.push(rest);
  return out;
}

class ContextMemory {
  // mode: 'embed' | 'lexical' | 'hybrid'. dims: truncate stored vectors (Matryoshka) to save memory.
  constructor({ embed, dims = 768, mode = 'embed', segmentChars = 700 }) {
    Object.assign(this, { embed, dims, mode, segmentChars });
    this.items = [];                                       // {turn, role, text, vec}
  }

  async addTurn(turn, role, text) {
    this.items = this.items.filter(i => i.turn !== turn);   // re-adding a turn index replaces it
    const segs = segmentText(text, this.segmentChars);
    if (!segs.length) return;
    const vecs = this.mode === 'lexical' ? segs.map(() => null) : await this.embed(segs, 'doc', { titles: segs.map(() => role) });
    segs.forEach((s, i) => this.items.push({ turn, role, text: s, vec: vecs[i] && truncate(vecs[i], this.dims) }));
  }

  // Best old segments (turn < `before`, i.e. no longer visible to the model) for this query.
  // `skip`: Set of turn numbers never to return (messages still visible to the model, or excluded by the user).
  async recall(query, { before = Infinity, k = 3, skip = null } = {}) {
    const cand = this.items.filter(i => i.turn < before && !(skip && skip.has(i.turn)));
    if (!cand.length) return [];
    let emb = null, lex = null;
    if (this.mode !== 'lexical') {
      const [qv] = await this.embed([query], 'query');
      const q = truncate(qv, this.dims);
      emb = cand.map(c => dot(c.vec, q));
    }
    if (this.mode !== 'embed') lex = bm25(cand.map(c => c.text), query);
    const scores = this.mode === 'embed' ? emb : this.mode === 'lexical' ? lex : fuse([emb, lex]);
    const ranked = cand.map((c, i) => ({ ...c, score: scores[i], cos: emb ? emb[i] : null })).sort((a, b) => b.score - a.score);
    const seen = new Set(), out = [];
    for (const r of ranked) {                              // one segment per turn keeps the injected text diverse
      if (seen.has(r.turn)) continue;
      seen.add(r.turn); out.push({ turn: r.turn, role: r.role, text: r.text, score: r.score, cos: r.cos });
      if (out.length >= k) break;
    }
    return out;
  }
}

module.exports = { ContextMemory, segmentText, truncate, normalize };
