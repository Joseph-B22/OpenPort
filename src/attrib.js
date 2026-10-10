// "Why did you say that?": compare an answer written with everything against the same answer re-written with one
// source withheld. If the answer changes a lot, the answer depended on that source. Pure comparison logic here;
// the page does the re-runs. Local models make the extra runs free.
(function (root) {
  const sentences = text => (text || '').replace(/\s+/g, ' ').split(/(?<=[.!?])\s+(?=[A-Z0-9`*(\[])/).map(s => s.trim()).filter(s => s.length > 3);
  const words = s => (s.toLowerCase().match(/[a-z0-9][a-z0-9._:\/-]*/g) || []).map(w => w.replace(/[.,;:]+$/, ''));
  const jaccard = (a, b) => {
    const A = new Set(a), B = new Set(b);
    if (!A.size && !B.size) return 1;
    let inter = 0; for (const x of A) if (B.has(x)) inter++;
    return inter / (A.size + B.size - inter);
  };
  // Values that must not silently change: anything containing a digit (ports, IPs, versions, dates, IDs), plus names
  // and capitalized terms (people, hosts, products), minus ordinary words that merely start a sentence.
  const STARTERS = new Set('the a an it this that these those there here i we you they he she if in on for to and but also so then use please note yes no not as at by from with when where which what who how why can could should would will may might do does did is are was were be been'.split(' '));
  const facts = text => {
    const t = text || '';
    const out = new Set((t.match(/\b[\w.:\/@-]*\d[\w.:\/@-]*\b/g) || []).map(x => x.toLowerCase().replace(/[.,;:]+$/, '')));
    for (const m of t.match(/\b[A-Z][a-z]{2,}(?:\s+[A-Z][a-z]+)*\b/g) || []) {
      const low = m.toLowerCase();
      if (!STARTERS.has(low)) out.add(low);
    }
    return out;
  };

  function diffAnswers(base, ablated) {
    const bs = sentences(base), as = sentences(ablated);
    const lostSentences = bs.filter(s => Math.max(0, ...as.map(a => jaccard(words(s), words(a)))) < 0.5);
    const fb = facts(base), fa = facts(ablated);
    const lostFacts = [...fb].filter(f => !fa.has(f)), gainedFacts = [...fa].filter(f => !fb.has(f));
    const wordChange = 1 - jaccard(words(base), words(ablated));
    const factChange = (lostFacts.length + gainedFacts.length) / Math.max(1, new Set([...fb, ...fa]).size);
    const sentChange = bs.length ? lostSentences.length / bs.length : 0;
    const changed = Math.min(1, 0.4 * wordChange + 0.35 * factChange + 0.25 * sentChange);
    return { changed, lostSentences, lostFacts, gainedFacts, identical: (base || '').trim() === (ablated || '').trim() };
  }

  // Wording for how much an answer changed. If whole statements or specific values disappeared, that is a clear effect
  // even when the overall percentage is modest (an answer with three claims loses a third when one source goes).
  const verdict = (c, d) => {
    if (c < 0.08) return 'no visible effect';
    if (c >= 0.6) return 'the answer depends on this';
    if (d && (d.lostFacts.length || d.lostSentences.length)) return 'clear effect';
    return c < 0.3 ? 'small effect' : 'clear effect';
  };

  // results: [{source, diff}] -> sorted most influential first
  const rank = results => [...results].sort((a, b) => b.diff.changed - a.diff.changed);

  const api = { sentences, words, jaccard, facts, diffAnswers, verdict, rank };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Attrib = api;
})(typeof window !== 'undefined' ? window : globalThis);
