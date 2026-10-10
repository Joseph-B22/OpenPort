// Confidence highlighting: the local engine can report how sure it was of every token it wrote. We turn that into
// "this value looks uncertain" underlines on the facts in an answer (numbers, IPs, versions, commands), so you know
// what to double-check. Pure logic here (no network); the page applies the result to the rendered answer.
(function (root) {
  const clampP = p => (Number.isFinite(p) ? Math.min(1, Math.max(0, p)) : null);

  // Reads token probabilities out of one streamed chunk. Handles the OpenAI-style shape
  // (choices[0].logprobs.content[]) and llama.cpp's native shape (completion_probabilities[]).
  function entriesFromChunk(obj) {
    const lp = obj?.choices?.[0]?.logprobs?.content;
    if (Array.isArray(lp)) {
      return lp.map(e => ({
        token: e.token ?? '', p: clampP(Math.exp(e.logprob)),
        alts: (e.top_logprobs || []).map(a => ({ token: a.token ?? '', p: clampP(Math.exp(a.logprob)) })),
      }));
    }
    const cp = obj?.completion_probabilities;
    if (Array.isArray(cp)) {
      return cp.map(e => {
        const token = e.content ?? e.token ?? '';
        const alts = (e.probs || e.top_logprobs || []).map(a => ({ token: a.tok_str ?? a.token ?? '', p: clampP(a.prob ?? Math.exp(a.logprob)) }));
        const chosen = alts.find(a => a.token === token);
        return { token, p: chosen ? chosen.p : (alts[0]?.p ?? null), alts };
      });
    }
    return [];
  }

  // Groups tokens into words (a token that starts with whitespace starts a new word) and records the least
  // confident token in each word. Trailing sentence punctuation is not part of the value.
  function toWords(entries) {
    const words = [];
    let cur = null;
    for (const e of entries) {
      const t = e.token;
      if (!t) continue;
      const startsNew = /^\s/.test(t) || !cur;
      if (startsNew) { cur = { text: '', minP: 1, minTok: null, alts: [], tokens: 0 }; words.push(cur); }
      cur.text += t.replace(/^\s+/, startsNew ? '' : '');
      cur.tokens++;
      if (e.p !== null && e.p < cur.minP) { cur.minP = e.p; cur.minTok = t.trim(); cur.alts = e.alts; }
      if (/\n/.test(t)) cur = null;                      // a line break always ends the word
    }
    // Markdown marks (** _ ` # >) and sentence punctuation are not part of a value and are absent from the rendered text.
    // Bare list numbers ("1." "2)") are formatting, never facts.
    return words
      .filter(w => !/^\d{1,2}[.)]$/.test(w.text))
      .map(w => { w.text = w.text.replace(/^[(\["'`*_#>~-]+/, '').replace(/[.,;:!?)\]}"'`*_~]+$/, ''); return w; })
      .filter(w => w.text);
  }

  // Values worth double-checking: contain a digit (ports, IPs, versions), or are written as code.
  const looksFactual = w => /\d/.test(w);

  const pct = p => `${Math.round(p * 100)}%`;
  function describe(word) {
    const others = (word.alts || []).filter(a => a.token.trim() && a.token.trim() !== word.minTok).slice(0, 3);
    return `The model was only ${pct(word.minP)} sure of this value.` +
      (others.length ? ` Other options it weighed: ${others.map(a => `${a.token.trim()} (${pct(a.p ?? 0)})`).join(', ')}.` : '') + ' Double-check it.';
  }

  // Marks `words` (from toWords) inside an element's rendered text. inCodeOf(node) tells whether a text node sits
  // inside <code>/<pre>. Returns the flagged list; `mode` is 'facts' (default) or 'all'.
  function flagWords(words, { threshold = 0.6, mode = 'facts' } = {}) {
    return words.filter(w => w.minP < (mode === 'all' ? Math.min(threshold, 0.35) : threshold) && (mode === 'all' || looksFactual(w.text) || w.inCode));
  }

  // Aligns the word list with the page's text (markdown removes characters like ** and #, so offsets differ) by walking
  // both in order, and returns [{start,end,word}] in page-text offsets for words that should be underlined.
  function alignToText(words, pageText, { threshold = 0.6, mode = 'facts', codeRanges = [] } = {}) {
    const hits = [];
    let pos = 0;
    const inCode = i => codeRanges.some(([a, b]) => i >= a && i < b);
    for (const w of words) {
      const i = pageText.indexOf(w.text, pos);
      if (i < 0 || i - pos > 60) continue;               // not found nearby: skip rather than jump far ahead
      const end = i + w.text.length;
      const factual = looksFactual(w.text) || inCode(i);
      const limit = mode === 'all' ? Math.min(threshold, 0.35) : threshold;
      if (w.minP < limit && (mode === 'all' || factual)) hits.push({ start: i, end, word: w });
      pos = end;
    }
    return hits;
  }

  const api = { entriesFromChunk, toWords, flagWords, alignToText, describe, looksFactual };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Confidence = api;
})(typeof window !== 'undefined' ? window : globalThis);
