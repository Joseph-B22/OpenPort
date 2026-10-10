// Log triage: reduce a huge log to a handful of things worth reading. Deterministic first (mask the variable parts of
// every line to get message "templates", count them, find rare and bursty ones), then optionally merge templates that
// mean the same thing using the embedding model. The chat model then explains only what this returns.
// Read-only: it only analyzes text.

const SEVERITY = [
  [/\b(fatal|panic|emerg|crit(ical)?|segfault|out of memory|oom)\b/i, 5],
  [/\b(error|err|fail(ed|ure)?|exception|denied|refused|unreachable|corrupt|lockout|locked out)\b/i, 4],
  [/\b(timeout|timed out|exceeded|quota|expired?|expires|invalid|unauthori[sz]ed|forbidden|reset by peer)\b/i, 3],
  [/\b(warn(ing)?|retry(ing)?|degraded|slow|deprecated|high (cpu|memory|latency))\b/i, 2],
];
const severityOf = line => { for (const [re, w] of SEVERITY) if (re.test(line)) return w; return 0; };

// Replaces the parts of a line that change from one occurrence to the next, leaving the wording that identifies it.
function template(line) {
  return line
    .replace(/^\s*(\[?\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?(?:Z|[+-]\d{2}:?\d{2})?\]?|[A-Z][a-z]{2}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}|\d{2}:\d{2}:\d{2}(?:[.,]\d+)?)\s*/, '')   // timestamp prefix
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<UUID>')
    .replace(/\b\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?\b/g, '<IP>')
    .replace(/\b(?:[0-9a-f]{2}[:-]){5}[0-9a-f]{2}\b/gi, '<MAC>')
    .replace(/\b0x[0-9a-f]+\b|\b[0-9a-f]{12,}\b/gi, '<HEX>')
    .replace(/(?:[A-Za-z]:\\|\/)[\w.\-\\/ ]{3,}/g, '<PATH>')
    .replace(/"[^"]{1,80}"|'[^']{1,80}'/g, '<STR>')
    .replace(/\b[a-z][a-z0-9]*(?:[-_][a-z0-9]+)*-\d+\b/gi, '<HOST>')          // names ending in a number: app12, db-prod-7
    .replace(/\b\d+(?:\.\d+)?\b/g, '<N>')
    .replace(/\s+/g, ' ').trim();
}

function parseTime(line) {
  let m = line.match(/(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})/);
  if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  m = line.match(/\b(\d{2}):(\d{2}):(\d{2})\b/);
  return m ? ((+m[1] * 60 + +m[2]) * 60 + +m[3]) * 1000 : null;
}

// text -> {total, groups[]} where each group is a template with counts, severity, line numbers, examples and burst info.
function mine(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const groups = new Map();
  let n = 0;
  lines.forEach((raw, i) => {
    if (!raw.trim()) return;
    n++;
    const t = template(raw);
    let g = groups.get(t);
    if (!g) { g = { template: t, count: 0, severity: severityOf(raw), firstLine: i + 1, lastLine: i + 1, examples: [], times: [] }; groups.set(t, g); }
    g.count++; g.lastLine = i + 1;
    g.severity = Math.max(g.severity, severityOf(raw));
    if (g.examples.length < 2 && !g.examples.some(e => e.text === raw.trim())) g.examples.push({ line: i + 1, text: raw.trim().slice(0, 240) });
    const ts = parseTime(raw);
    if (ts !== null && g.times.length < 5000) g.times.push(ts);
  });
  return { total: n, lineCount: lines.length, groups: [...groups.values()] };
}

// Share of a template's occurrences that fall inside its busiest window (default 5 minutes). Needs 5+ occurrences.
function burst(times, windowMs = 5 * 60 * 1000) {
  if (times.length < 5) return 0;
  const t = [...times].sort((a, b) => a - b);
  let best = 0, j = 0;
  for (let i = 0; i < t.length; i++) { while (t[i] - t[j] > windowMs) j++; best = Math.max(best, i - j + 1); }
  return best / t.length;
}

// Higher = more worth reading. Rare + severe + bursty beats frequent noise.
function score(g, total) {
  const rarity = Math.log2(1 + total / g.count);                 // a one-off in 4,000 lines ~ 12; a 1,000x line ~ 2
  const b = burst(g.times);
  return (g.severity || 0.3) * rarity * (1 + (b > 0.7 ? 1.5 : 0)) + (g.severity >= 4 ? 8 : 0);
}

const cosine = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };

// Merges groups whose templates mean nearly the same thing ("connection timed out" / "connect timeout"). embed(texts) -> unit vectors.
async function mergeSimilar(groups, embed, threshold = 0.9, maxGroups = 150) {
  const top = [...groups].sort((a, b) => b.severity - a.severity || a.count - b.count).slice(0, maxGroups);
  const vecs = await embed(top.map(g => g.template));
  const merged = [], used = new Set();
  for (let i = 0; i < top.length; i++) {
    if (used.has(i)) continue;
    const g = { ...top[i], examples: [...top[i].examples], times: [...top[i].times], variants: 1 };
    for (let j = i + 1; j < top.length; j++) {
      if (used.has(j) || Math.abs(top[j].severity - g.severity) > 1) continue;
      if (cosine(vecs[i], vecs[j]) >= threshold) {
        used.add(j); g.count += top[j].count; g.variants++;
        g.firstLine = Math.min(g.firstLine, top[j].firstLine); g.lastLine = Math.max(g.lastLine, top[j].lastLine);
        g.severity = Math.max(g.severity, top[j].severity);
        for (const e of top[j].examples) if (g.examples.length < 3) g.examples.push(e);
        g.times.push(...top[j].times);
      }
    }
    merged.push(g);
  }
  const rest = groups.filter(g => !top.includes(g));
  return [...merged, ...rest];
}

const SEV_NAME = { 5: 'critical', 4: 'error', 3: 'problem', 2: 'warning', 0: 'info' };

// Returns text for the model: a compact ranked report. opts: {top, embed, contextText}
async function triage(text, { top = 10, embed = null } = {}) {
  const { total, lineCount, groups } = mine(text);
  if (!total) throw new Error('The log is empty.');
  let list = groups;
  let merged = false;
  if (embed && groups.length > 1) { try { list = await mergeSimilar(groups, embed); merged = true; } catch { /* deterministic result still stands */ } }
  const ranked = list.map(g => ({ g, s: score(g, total) })).sort((a, b) => b.s - a.s);
  const infoCount = groups.filter(g => g.severity === 0).reduce((n, g) => n + g.count, 0);

  const out = [`Log triage: ${total.toLocaleString()} lines reduced to ${groups.length} distinct message patterns${merged ? ' (similar patterns merged by meaning)' : ''}. ` +
    `${infoCount.toLocaleString()} lines (${(100 * infoCount / total).toFixed(infoCount / total > 0.99 ? 1 : 0)}%) are routine messages with no problem keywords.`];
  ranked.slice(0, top).forEach(({ g }, i) => {
    const b = burst(g.times);
    const where = g.count === 1 ? `line ${g.firstLine}` : `lines ${g.firstLine}-${g.lastLine}`;
    out.push(`\n#${i + 1} [${SEV_NAME[g.severity] || 'info'}] seen ${g.count}× (${where})${b > 0.7 ? ` — bursty: ${Math.round(b * 100)}% within 5 minutes` : ''}${g.variants > 1 ? ` — ${g.variants} similar patterns merged` : ''}` +
      `\n   pattern: ${g.template.slice(0, 200)}` + g.examples.map(e => `\n   e.g. line ${e.line}: ${e.text}`).join(''));
  });
  const tail = ranked.length - Math.min(top, ranked.length);
  if (tail > 0) out.push(`\n(${tail} lower-priority patterns not shown. Ask about a specific keyword to look closer, or use search_files.)`);
  return out.join('');
}

module.exports = { template, mine, burst, score, mergeSimilar, triage, severityOf };
