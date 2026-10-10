// Edit check ("copy provenance"): when an answer returns a config, script or document you gave it (with changes), compare
// it line by line with your file. Lines copied unchanged are quiet; lines that are new or changed are highlighted; lines of
// your file that are MISSING from the answer are listed (a model silently dropping a line is a classic, dangerous edit error).
// Pure logic, no model: it only looks at the answer text and the files in this conversation.
(function (root) {
  const norm = l => l.replace(/\s+/g, ' ').trim();
  const meaningful = l => norm(l).length > 0 && !/^[!#]+$/.test(norm(l));     // ignore blank lines and lone "!" separators

  // Word-level similarity (0..1) of two lines: shared words over all words. "switchport trunk allowed vlan 10,20,99" vs
  // "switchport trunk allowed vlan 10,20,30,99" = 4/6.
  function similar(a, b) {
    const A = new Set(a.toLowerCase().split(' ')), B = new Set(b.toLowerCase().split(' '));
    let both = 0; for (const w of A) if (B.has(w)) both++;
    return both / (A.size + B.size - both || 1);
  }

  function codeBlocks(md) {
    return [...String(md || '').matchAll(/```[^\n]*\n([\s\S]*?)```/g)].map((m, i) => ({ index: i, text: m[1].replace(/\n$/, '') }));
  }

  // One answer block against the files. Returns null unless the block is clearly an edited copy of one file
  // (at least 5 meaningful lines and at least half of them copied unchanged from that file).
  function compareBlock(block, sources) {
    const lines = block.text.split('\n');
    const mlines = lines.map((l, i) => ({ i, n: norm(l) })).filter(x => meaningful(x.n));
    if (mlines.length < 5) return null;
    let best = null;
    for (const s of sources) {
      const srcLines = String(s.text || '').split(/\r?\n/).map(norm).filter(meaningful);
      if (!srcLines.length) continue;
      const set = new Map();
      for (const l of srcLines) set.set(l, (set.get(l) || 0) + 1);
      const copied = mlines.filter(x => set.has(x.n)).length;
      if (!best || copied > best.copied) best = { source: s, srcLines, set, copied };
    }
    if (!best || best.copied / mlines.length < 0.5) return null;
    const changed = mlines.filter(x => !best.set.has(x.n)).map(x => x.i);
    // Missing: lines of the file (within the part the answer reproduces) that do not appear in the answer at all.
    const answerSet = new Set(mlines.map(x => x.n));
    const idx = best.srcLines.map((l, i) => (answerSet.has(l) ? i : -1)).filter(i => i >= 0);
    const from = Math.min(...idx), to = Math.max(...idx);
    let missing = [];
    for (let i = from; i <= to; i++) if (!answerSet.has(best.srcLines[i])) missing.push(best.srcLines[i]);
    // A changed line usually REPLACES an original one ("allowed vlan 10,20,99" -> "allowed vlan 10,20,30,99"). Pair each
    // changed line with the most similar missing original; only originals with no replacement are truly missing.
    const replaced = [];
    for (const ci of changed) {
      const c = norm(lines[ci]);
      let bestJ = -1, bestS = 0;
      missing.forEach((m, j) => { const s = similar(c, m); if (s > bestS) { bestS = s; bestJ = j; } });
      if (bestJ >= 0 && bestS >= 0.5) { replaced.push({ line: ci, was: missing[bestJ] }); missing.splice(bestJ, 1); }
    }
    return { index: block.index, source: best.source.name, total: mlines.length, copied: best.copied, changed, replaced,
      missing: missing.slice(0, 20), missingCount: missing.length };
  }

  function check(md, sources) {
    if (!sources?.length) return [];
    return codeBlocks(md).map(b => compareBlock(b, sources)).filter(Boolean);
  }

  const api = { check, compareBlock, codeBlocks, norm };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Provenance = api;
})(typeof window !== 'undefined' ? window : globalThis);
