// Mistake log ("ledger"): turns a caught command mistake into a FACT about this PC, picks which facts to show the model for a
// new question, and re-checks that a fact is still true before it is used. Pure logic: the database and PowerShell are passed in.
//
// Rule: a fact says only what this PC proved: what does NOT exist and what DOES. It never says which parameter or command the
// model should have used, because that would be a guess, and a "correction" can itself be wrong.

const VERB_NOUN = /\b[A-Za-z]+-[A-Za-z][A-Za-z0-9]+\b/g;

// From a command-checker result to the ledger entries it produces.
function entriesFrom(result) {
  if (result.status === 'bad-params') {
    const cmd = result.resolved || result.name;
    const real = (result.valid || []).slice(0, 30);
    return result.bad.filter(b => b.why === 'unknown').map(b => ({
      kind: 'param', command: cmd, token: b.param,
      fact: `${cmd} has no parameter ${b.param} on this PC.` + (real.length ? ` Its real parameters are: ${real.map(p => '-' + p).join(', ')}.` : ''),
    }));
  }
  if (result.status === 'unknown-command') {
    return [{
      kind: 'command', command: result.name, token: result.name,
      fact: `There is no command named ${result.name} on this PC.` +
        (result.suggest?.length ? ` Commands with similar names that do exist: ${result.suggest.join(', ')} (similar name only; check that one does what is needed).` : ''),
    }];
  }
  return [];                                                  // not-installed modules are not mistakes
}

const dot = (a, b) => { let s = 0; const n = Math.min(a.length, b.length); for (let i = 0; i < n; i++) s += a[i] * b[i]; return s; };

// Which stored facts matter for this question. A fact matches when its command is named in the question or the recent
// conversation (the model is likely to use it again), or when the question is close in meaning to the one that caused the
// mistake (qvec/emb, 256-d). Returns at most k rows, best first.
function pickRelevant(rows, { question = '', recent = '', qvec = null, k = 5, minSim = 0.62 } = {}) {
  const named = new Set([...`${question}\n${recent}`.matchAll(VERB_NOUN)].map(m => m[0].toLowerCase()));
  const scored = [];
  for (const r of rows) {
    let s = 0, why = '';
    if (named.has(r.command.toLowerCase())) { s = 1; why = 'named'; }
    else if (qvec && r.emb && r.emb.length === qvec.length) { const c = dot(qvec, r.emb); if (c >= minSim) { s = c; why = 'similar question'; } }
    if (s) scored.push({ ...r, score: s, why });
  }
  return scored.sort((a, b) => b.score - a.score || b.count - a.count).slice(0, k);
}

// Is a stored fact still true? (A module may have been installed, PowerShell updated...) lookup(name) -> catalog info.
function stillTrue(row, lookup) {
  const info = lookup(row.command);
  if (!info) return null;                                      // could not ask: unknown
  if (row.kind === 'command') return !info.found;
  if (!info.found) return false;                               // the command itself is gone: the fact is stale
  const p = row.token.replace(/^-/, '').toLowerCase();
  const names = (info.params || []).map(x => x.toLowerCase());
  const aliases = (info.aliases || []).map(a => a.split('=')[0].toLowerCase());
  return !names.includes(p) && !aliases.includes(p);
}

// The block that goes into the prompt (with recalled notes, at the end, so the start of the prompt stays reusable).
function promptBlock(rows) {
  if (!rows.length) return '';
  return '[Verified facts about PowerShell on this PC. These were checked on this computer after earlier answers got them wrong. ' +
    'Treat them as true here.]\n' + rows.map(r => `- ${r.fact}`).join('\n');
}

module.exports = { entriesFrom, pickRelevant, stillTrue, promptBlock };
