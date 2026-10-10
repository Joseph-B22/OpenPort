// Copy score (needs copy-ahead on): the engine reports how many of its "copy from the prompt" guesses the model accepted.
// A high share means much of the answer was taken word for word from your message or files; a low share on a "return this
// unchanged" request means the model reworded or changed things. It is a rough signal; the edit check above is exact.
function copyScoreText(t) {
  if (!t?.drafted || t.drafted < 20 || t.accepted == null || !t.outTokens) return null;   // too few guesses to mean anything
  const share = Math.min(1, t.accepted / t.outTokens);
  const pct = Math.round(share * 100);
  const kind = share >= 0.6 ? 'mostly a copy with small changes' : share >= 0.25 ? 'a mix of copied and new text' : 'mostly new writing';
  return `Copy-ahead: ${pct}% of this answer was copied word for word from earlier in this chat: your messages, files or previous answers (${t.accepted} of ${t.outTokens} tokens), ` +
    `so it is ${kind}.${t.tps ? ` Written at ${Math.round(t.tps)} tokens/s.` : ''}`;
}
function showCopyScore(box, t) {
  const text = copyScoreText(t);
  if (!text) return;
  const line = document.createElement('div');
  line.className = 'copy-score';
  line.title = 'With copy-ahead on, the engine guesses the next words by copying them from earlier in the chat, and the model accepts or rejects each guess. ' +
    'This is the share of the answer that came from accepted guesses: a quick hint, not a check. It reads lower than the true overlap, because copying ' +
    'only restarts after a dozen or so matching words following each change, and any new explanation counts as new text. The edit check (when shown) is exact.';
  line.textContent = text;
  box.append(line);
  if (!box.className) box.className = 'provnote';
}

// Edit check, page side: highlights the changed lines inside the answer's code block and writes a short note:
// "52 of 54 lines unchanged from core.cfg · 2 changed (highlighted) · 1 line of your file is missing: ...".
// The answer is never changed; lines are re-built with textContent only.
function checkEdits(root, box, answer, sources) {
  if (config?.checkEdits === false || !window.Provenance) return;
  const results = Provenance.check(answer, sources || []);
  if (!results.length) return;
  const codes = [...root.querySelectorAll('pre > code')];
  box.replaceChildren();
  box.className = 'provnote';
  for (const r of results) {
    const code = codes[r.index];
    if (code && r.changed.length) {
      const changed = new Set(r.changed);
      const was = new Map((r.replaced || []).map(x => [x.line, x.was]));
      const lines = code.textContent.replace(/\n$/, '').split('\n');
      code.replaceChildren(...lines.map((l, i) => {
        const s = document.createElement('span');
        s.className = 'prov-line' + (changed.has(i) ? ' prov-new' : '');
        if (changed.has(i)) s.title = was.has(i) ? `Changed. In ${r.source} this line was:\n${was.get(i)}` : `New: this line is not in ${r.source}`;
        s.textContent = l + (i < lines.length - 1 ? '\n' : '');
        return s;
      }));
    }
    const head = document.createElement('div');
    head.className = 'prov-head' + (r.missingCount ? ' warn' : '');
    const same = r.total - r.changed.length;
    head.textContent = `Edit check: ${same} of ${r.total} lines unchanged from ${r.source} · ${r.changed.length} new or changed${r.changed.length ? ' (highlighted)' : ''}` +
      (r.missingCount ? ` · ${r.missingCount} line${r.missingCount === 1 ? '' : 's'} of ${r.source} missing from this answer` : ` · nothing from ${r.source} is missing`);
    box.append(head);
    if (r.missingCount) {
      const ul = document.createElement('ul');
      for (const m of r.missing) { const li = document.createElement('li'); li.textContent = m; ul.append(li); }
      if (r.missingCount > r.missing.length) { const li = document.createElement('li'); li.textContent = `…and ${r.missingCount - r.missing.length} more`; ul.append(li); }
      box.append(ul);
      const hint = document.createElement('div');
      hint.className = 'prov-hint';
      hint.textContent = 'Missing lines may be intentional (the change removed them) or a silent mistake. Check them before you paste this anywhere.';
      box.append(hint);
    }
  }
}
