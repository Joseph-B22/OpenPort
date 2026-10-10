// Experiment B: query-focused trimming. Instead of pasting the first N characters of a big file into the
// prompt, split it into chunks, score them against the user's question, and keep only the best ones
// (in original order) within a character budget. Same prompt cost, far more likely to contain the answer.
const { chunkText } = require('./indexer');
const { bm25, fuse } = require('./lexical');
const { truncate } = require('./ctxmem');

const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };

// mode: 'embed' | 'lexical' | 'hybrid'. Returns {text, kept, total, chars}.
async function focusText(text, query, { embed, budgetChars = 3000, chunkChars = 800, dims = 256, mode = 'hybrid' } = {}) {
  if (text.length <= budgetChars) return { text, kept: 1, total: 1, chars: text.length };
  const chunks = chunkText(text, chunkChars);
  let emb = null, lex = null;
  if (mode !== 'lexical') {
    const vecs = [];
    for (let i = 0; i < chunks.length; i += 16) vecs.push(...await embed(chunks.slice(i, i + 16), 'doc', { titles: chunks.slice(i, i + 16).map(() => 'file') }));
    const [qv] = await embed([query], 'query');
    const q = truncate(qv, dims);
    emb = vecs.map(v => dot(truncate(v, dims), q));
  }
  if (mode !== 'embed') lex = bm25(chunks, query);
  const scores = mode === 'embed' ? emb : mode === 'lexical' ? lex : fuse([emb, lex]);

  const order = chunks.map((c, i) => i).sort((a, b) => scores[b] - scores[a]);
  const picked = [];
  let used = 0;
  for (const i of order) {
    if (used + chunks[i].length > budgetChars && picked.length) continue;
    picked.push(i); used += chunks[i].length;
    if (used >= budgetChars) break;
  }
  picked.sort((a, b) => a - b);
  let out = '', prev = -2;
  for (const i of picked) {
    out += (i === prev + 1 ? '\n' : `\n[… part ${i + 1} of ${chunks.length} …]\n`) + chunks[i];
    prev = i;
  }
  return { text: out.trim(), kept: picked.length, total: chunks.length, chars: out.length };
}

module.exports = { focusText };
