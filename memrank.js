// Time-aware ranking for cross-chat memory. Pure functions (no database, no embedder) so they can be unit-tested.
//  - parseTimeHint: "yesterday", "last week", "3 days ago"... -> a time window the recalled notes must fall in
//  - rerank: a small bonus for recent notes, so of two equally similar notes the newer one wins
//  - markSuperseded: when two recalled notes say nearly the same thing, the older one is flagged so the model prefers the newer
const DAY = 86400000;
const startOfDay = t => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
const dot = (a, b) => { let s = 0; const n = Math.min(a.length, b.length); for (let i = 0; i < n; i++) s += a[i] * b[i]; return s; };
const WORDNUM = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, couple: 2, few: 3 };

// Returns {since, until, label} or null. Only clear phrases count; anything vague is ignored rather than guessed.
function parseTimeHint(query, now = Date.now()) {
  const q = String(query || '').toLowerCase();
  const today = startOfDay(now);
  if (/\btoday\b|\bthis morning\b|\bearlier today\b/.test(q)) return { since: today, until: now, label: 'today' };
  if (/\byesterday\b/.test(q)) return { since: today - DAY, until: today, label: 'yesterday' };
  if (/\bthis week\b/.test(q)) {
    const dow = (new Date(now).getDay() + 6) % 7;                 // Monday = 0
    return { since: today - dow * DAY, until: now, label: 'this week' };
  }
  if (/\blast week\b/.test(q)) return { since: today - 14 * DAY, until: today - 6 * DAY, label: 'last week' };
  if (/\b(this|past) month\b/.test(q)) return { since: today - 31 * DAY, until: now, label: 'the past month' };
  if (/\blast month\b/.test(q)) return { since: today - 62 * DAY, until: today - 27 * DAY, label: 'last month' };
  const m = q.match(/\b(\d{1,3}|a|an|one|two|three|four|five|six|seven|eight|nine|ten|couple|few)\s+(?:of\s+)?(day|week|month)s?\s+ago\b/);
  if (m) {
    const n = /^\d+$/.test(m[1]) ? Number(m[1]) : WORDNUM[m[1]];
    const unit = m[2] === 'day' ? DAY : m[2] === 'week' ? 7 * DAY : 30 * DAY;
    const center = today - n * unit;
    const slack = Math.max(DAY, unit * 0.5);                      // "3 days ago" means roughly, not exactly
    return { since: center - slack, until: Math.min(now, center + unit + slack), label: m[0] };
  }
  const p = q.match(/\b(?:in the |over the )?(?:last|past)\s+(\d{1,3}|two|three|four|five|six|seven|ten|few|couple)\s+(day|week|month)s?\b/);
  if (p) {
    const n = /^\d+$/.test(p[1]) ? Number(p[1]) : WORDNUM[p[1]];
    const unit = p[2] === 'day' ? DAY : p[2] === 'week' ? 7 * DAY : 30 * DAY;
    return { since: today - n * unit, until: now, label: p[0].trim() };
  }
  return null;
}

// Human age, for the prompt and the Memory page.
function ageLabel(ts, now = Date.now()) {
  const days = Math.floor((startOfDay(now) - startOfDay(ts)) / DAY);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.round(days / 7)} weeks ago`;
  if (days < 730) return `${Math.round(days / 30)} months ago`;
  return `${Math.round(days / 365)} years ago`;
}

// hits: [{score (cosine), created, vec?, kind?}]. Adds `rank` = cosine + recency bonus (+ a small bonus for saved facts).
// The bonus is capped at `recencyWeight`, so it only reorders notes that are close in similarity; it never lifts a weak match
// over a strong one. A time window, when given, is a hard filter.
function rerank(hits, { now = Date.now(), halfLifeDays = 45, recencyWeight = 0.04, factBonus = 0.02, window = null } = {}) {
  return hits
    .filter(h => !window || (h.created >= window.since && h.created <= window.until))
    .map(h => {
      const ageDays = Math.max(0, (now - h.created) / DAY);
      const recency = recencyWeight * Math.pow(0.5, ageDays / halfLifeDays);
      return { ...h, rank: h.score + recency + (h.kind === 'fact' ? factBonus : 0) };
    })
    .sort((a, b) => b.rank - a.rank);
}

// Flags notes that a newer, near-identical note replaces. Needs `vec` on each hit. Mutates and returns the list,
// newest-first within each replaced pair is not forced: the order from rerank stays, only flags are added.
function markSuperseded(hits, { sameTopic = 0.88, minGapMs = 3600000 } = {}) {
  for (const a of hits) {
    if (!a.vec) continue;
    for (const b of hits) {
      if (a === b || !b.vec || b.created - a.created < minGapMs) continue;   // b must be clearly newer than a
      if (dot(a.vec, b.vec) >= sameTopic) { a.superseded = true; a.newerDate = b.created; break; }
    }
  }
  return hits;
}

// "Stands out" rule: a note must be clearly MORE similar than a typical note is to this question. A vague question
// ("what website was I on?") resembles every note a little; then nothing stands out and nothing is recalled. With few
// notes there is no reliable "typical" level, so only the fixed minimum applies.
// pool: similarity of the question to many notes (the top ~60). Returns the typical level (median) or null.
function background(pool, minPool = 12) {
  if (!pool || pool.length < minPool) return null;
  const s = [...pool].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}
function standsOut(candidates, pool, { minScore = 0.65, margin = 0.06 } = {}) {
  const bg = background(pool);
  return candidates.filter(c => c.score >= minScore && (bg === null || c.score >= bg + margin));
}

// The whole pipeline used by memory:search. `candidates` are hits above the (possibly lowered) bar, best first;
// pool, when given, applies the "stands out" rule.
function selectMemories(candidates, query, { topK = 3, now = Date.now(), pool = null, minScore = -1, margin = 0.06, ...opts } = {}) {
  const window = parseTimeHint(query, now);
  if (pool) candidates = standsOut(candidates, pool, { minScore, margin });
  const ranked = rerank(candidates, { now, window, ...opts }).slice(0, topK);
  markSuperseded(ranked, opts);
  return { hits: ranked.map(({ vec, ...h }) => ({ ...h, age: ageLabel(h.created, now) })), window };
}

module.exports = { parseTimeHint, ageLabel, rerank, markSuperseded, selectMemories, standsOut, background, DAY };
