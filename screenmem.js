// Screen memory (home edition, opt-in): remembers the TEXT of the window you are working in, never an image.
// This file holds the rules (what is excluded, what counts as new, how search ranks) and the capture loop. All real
// I/O (screen, OCR, database, embedder) is injected, so the whole policy can be tested without touching a real screen.
const crypto = require('crypto');
const { scrub } = require('./scrub');
const { bm25, fuse, tokenize } = require('./lexical');

// Windows and apps that are never captured. Matched (case-insensitive substring) against the program name AND the
// window title. Editable in Settings; the OpenPort window itself is always excluded.
const DEFAULT_EXCLUDE = [
  '1password', 'bitwarden', 'keepass', 'lastpass', 'dashlane', 'enpass', 'roboform', 'nordpass', 'proton pass',
  'authenticator', 'incognito', 'inprivate', 'private browsing', 'private window',
  'sign in', 'sign-in', 'log in', 'login', 'password', 'credential', 'bank', 'paypal', 'wallet', 'vault', 'secret',
  'windows security', 'user account control', 'remote desktop connection',
];
const ALWAYS_EXCLUDED = ['openport'];

function isExcluded(win, terms = DEFAULT_EXCLUDE) {
  const hay = `${win.process || ''} ${win.title || ''}`.toLowerCase();
  return [...ALWAYS_EXCLUDED, ...terms.map(t => String(t).toLowerCase().trim()).filter(Boolean)].some(t => hay.includes(t));
}

const wordSet = t => new Set((t.toLowerCase().match(/[a-z0-9][a-z0-9._:-]{2,}/g) || []));
function similarity(a, b) {
  const A = wordSet(a), B = wordSet(b);
  if (!A.size && !B.size) return 1;
  let inter = 0; for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}
const hashOf = t => crypto.createHash('sha1').update(t).digest('hex');

// OCR text -> cleaned, scrubbed text (or null when there is nothing worth keeping).
function prepare(rawText) {
  const text = String(rawText || '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  if (text.length < 40) return null;                                   // an empty desktop, a loading screen
  const { text: clean, total } = scrub(text.slice(0, 20000));
  return { text: clean, scrubbed: total };
}

// Picks the lines of a stored text that best match a query (so the model sees the relevant part, not a whole screen).
function snippet(text, query, maxChars = 800) {
  const q = new Set(tokenize(query));
  const lines = text.split('\n');
  const scored = lines.map((l, i) => ({ i, s: tokenize(l).filter(t => q.has(t)).length }));
  const best = scored.filter(x => x.s > 0).sort((a, b) => b.s - a.s).slice(0, 4);
  // Include the lines on either side of each match: the value you want (an IP, a name) is often next to the words you remember.
  const keep = new Set();
  for (const b of best) for (let j = Math.max(0, b.i - 1); j <= Math.min(lines.length - 1, b.i + 1); j++) keep.add(j);
  const picked = keep.size ? [...keep].sort((a, b) => a - b).map(j => lines[j]) : lines.slice(0, 8);
  const out = picked.join('\n');
  return out.length > maxChars ? out.slice(0, maxChars) + '…' : out;
}

// rows: from db.screenRows; queryVec: 256-dim unit vector or null. Hybrid keyword + meaning, fused by rank.
function searchRows(rows, query, { queryVec = null, k = 5 } = {}) {
  if (!rows.length) return [];
  const texts = rows.map(r => `${r.process} ${r.title}\n${r.text}`);
  const lex = bm25(texts, query);
  let scores = lex;
  if (queryVec) {
    const emb = rows.map(r => (r.vec && r.vec.length === queryVec.length ? r.vec.reduce((s, x, i) => s + x * queryVec[i], 0) : 0));
    scores = fuse([emb, lex]);
  }
  return rows.map((r, i) => ({ r, s: scores[i] })).filter(x => x.s > 0).sort((a, b) => b.s - a.s).slice(0, k)
    .map(x => ({ id: x.r.id, ts: x.r.ts, process: x.r.process, title: x.r.title, snippet: snippet(x.r.text, query), pinned: !!x.r.pinned }));
}

// Which kind of program a window belongs to, for "what website / which terminal" questions.
const APP_KINDS = {
  browser: /^(chrome|msedge|firefox|brave|opera|vivaldi|arc|iexplore|librewolf|waterfox|thorium)$/i,
  terminal: /^(windowsterminal|powershell|pwsh|cmd|conhost|putty|mobaxterm|kitty|wezterm-gui|alacritty|securecrt|termius|openconsole)$/i,
};
function appKind(proc) {
  const p = String(proc || '').replace(/\.exe$/i, '');
  return Object.keys(APP_KINDS).find(k => APP_KINDS[k].test(p)) || 'other';
}
// Web addresses visible in a window's text (usually the address bar near the top). OCR text: untrusted and can be misread.
const DOMAIN = /\b(?:https?:\/\/)?((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:com|org|net|io|ai|dev|gov|edu|co|us|uk|ca|de|app|cloud|so|me|tv|info|gg|ly|xyz|tech|site|page|microsoft|google))(?=[\/\s:?#)"']|$)/gi;
function domainsIn(text, max = 3) {
  const out = [];
  for (const m of String(text || '').slice(0, 600).matchAll(DOMAIN)) {
    const d = m[1].toLowerCase().replace(/^www\./, '');
    if (!out.includes(d)) out.push(d);
    if (out.length >= max) break;
  }
  return out;
}
// "What was I doing?": consecutive moments in the same window become one visit, oldest first.
// rows: newest first (as db.screenRows returns them). app: 'browser' | 'terminal' | 'any'.
function timeline(rows, { app = 'any', max = 25 } = {}) {
  const pick = rows.filter(r => app === 'any' || appKind(r.process) === app).slice().sort((a, b) => a.ts - b.ts);
  const visits = [];
  for (const r of pick) {
    const last = visits[visits.length - 1];
    const doms = appKind(r.process) === 'browser' ? domainsIn(r.text) : [];
    if (last && last.process === r.process && last.title === r.title) {
      last.to = r.ts; last.moments++;
      for (const d of doms) if (!last.domains.includes(d)) last.domains.push(d);
    } else visits.push({ from: r.ts, to: r.ts, process: r.process, title: r.title, kind: appKind(r.process), domains: doms, moments: 1 });
  }
  return visits.slice(-max);
}

class ScreenMemory {
  // deps: { cfg(), helper: {fg(), ocr(buf)}, capture(win)->Buffer|null, db, embedder: {isReady(), embed()}, now(), idleSeconds(), audit(event, data), onState() }
  constructor(deps) {
    this.d = deps; this.paused = false; this.locked = false; this.timer = null;
    this.lastKey = null; this.lastAt = 0; this.lastText = new Map(); this.busy = false; this.embedding = false;
    this.stats = { captured: 0, skippedExcluded: 0, skippedDuplicate: 0, skippedIdle: 0, scrubbedItems: 0, errors: 0, lastError: null, lastAt: null };
  }

  start() { this.stop(); this.timer = setInterval(() => this.tick().catch(() => {}), 3000); this.timer.unref?.(); this.d.audit('screen_memory_on'); this.d.onState?.(); }
  stop() { if (this.timer) { clearInterval(this.timer); this.timer = null; this.d.audit('screen_memory_off'); } this.d.onState?.(); }
  setPaused(p) { this.paused = !!p; this.d.audit(p ? 'screen_memory_paused' : 'screen_memory_resumed'); this.d.onState?.(); }
  get active() { return !!this.timer && !this.paused && !this.locked; }

  // One look at the screen. Decides whether anything should be captured, and stores it if so.
  async tick() {
    const cfg = this.d.cfg();
    if (!cfg.enabled || this.paused || this.locked || this.busy) return;
    if (this.d.idleSeconds() > cfg.idleSkipSec) { this.stats.skippedIdle++; return; }
    this.busy = true;
    try {
      const win = await this.d.helper.fg();
      if (!win.ok || win.minimized || !win.hwnd) return;
      if (isExcluded(win, cfg.exclude)) { this.stats.skippedExcluded++; this.lastKey = null; return; }
      const key = `${win.process}|${win.title}`;
      const gap = (this.d.now() - this.lastAt) / 1000;
      const switched = key !== this.lastKey;
      if (switched ? gap < cfg.minGapSec : gap < cfg.intervalSec) return;
      await this.capture(win, { pinned: false });
    } catch (e) { this.stats.errors++; this.stats.lastError = e.message; }
    finally { this.busy = false; }
  }

  // Captures one window now. `pinned` saves it as a "moment" the user chose to keep (longer retention, no duplicate skip).
  async capture(win, { pinned = false } = {}) {
    const key = `${win.process}|${win.title}`;
    this.lastKey = key; this.lastAt = this.d.now();
    const png = await this.d.capture(win);
    if (!png) return { ok: false, reason: 'This window could not be captured (it may be protected).' };
    const { text: raw } = await this.d.helper.ocr(png);
    const prep = prepare(raw);                                           // the image is already out of scope here: only text continues
    if (!prep) return { ok: false, reason: 'No readable text in this window.' };
    const hash = hashOf(prep.text);
    const prev = this.lastText.get(key);
    if (!pinned && prev && (prev.hash === hash || similarity(prev.text, prep.text) >= 0.92)) { this.stats.skippedDuplicate++; return { ok: false, reason: 'unchanged' }; }
    this.lastText.set(key, { hash, text: prep.text });
    if (this.lastText.size > 50) this.lastText.delete(this.lastText.keys().next().value);
    const id = this.d.db.screenAdd({ ts: this.d.now(), process: win.process, title: win.title.slice(0, 200), text: prep.text, hash, pinned });
    this.stats.captured++; this.stats.scrubbedItems += prep.scrubbed; this.stats.lastAt = this.d.now();
    this.d.onState?.();
    this.embedSoon();
    return { ok: true, id, chars: prep.text.length, scrubbed: prep.scrubbed };
  }

  // Embeds stored moments that have no vector yet, one at a time (gentle on the CPU). Safe to call repeatedly.
  async embedSoon() {
    if (this.embedding || !this.d.embedder.isReady()) return;
    this.embedding = true;
    try {
      for (const row of this.d.db.screenPending(30)) {
        if (!this.d.embedder.isReady()) break;
        const [v] = await this.d.embedder.embed([`${row.title}\n${row.text}`.slice(0, 4000)], 'doc', { dims: 256 });
        this.d.db.screenSetEmb(row.id, v);
      }
    } catch { /* retried on the next call */ } finally { this.embedding = false; }
  }

  purge() { const n = this.d.db.screenPurge(this.d.cfg().retentionDays, 90, this.d.now()); if (n) this.d.audit('screen_memory_purged', { removed: n }); return n; }
}

module.exports = { ScreenMemory, isExcluded, DEFAULT_EXCLUDE, similarity, prepare, snippet, searchRows, hashOf, timeline, appKind, domainsIn };
