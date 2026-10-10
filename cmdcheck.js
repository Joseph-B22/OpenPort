// Command checker: finds the PowerShell commands in a model's answer and checks each command name and parameter against
// what really exists on this computer (see pscatalog.js). Catches invented cmdlets ("Get-NetAdapterStats") and invented or
// misspelled parameters ("Get-ChildItem -Recursive") without asking the model anything. Pure logic: no PowerShell here.
//
// It checks that a command and its parameters EXIST. It does not check that the command does what the answer claims,
// that the values are right, or that it is safe to run.

const KEYWORDS = new Set(['if', 'else', 'elseif', 'foreach', 'for', 'while', 'do', 'until', 'switch', 'try', 'catch', 'finally',
  'function', 'filter', 'param', 'begin', 'process', 'end', 'return', 'break', 'continue', 'throw', 'exit', 'trap', 'class',
  'enum', 'using', 'data', 'dynamicparam', 'workflow', 'parallel', 'sequence', 'inlinescript', 'in', 'default', 'hidden', 'static']);
const SYMBOL_ALIASES = { '%': 'ForEach-Object', '?': 'Where-Object' };
const PS_LANGS = new Set(['powershell', 'ps', 'ps1', 'pwsh', 'posh', 'psm1']);
const SHELLISH = new Set(['', 'shell', 'cmd', 'bat', 'console', 'text', 'plaintext', 'terminal']);
// Approved PowerShell verbs most often seen; used only to recognise PowerShell inside untagged blocks and inline code.
const VERBS = 'Add|Approve|Assert|Backup|Block|Build|Checkpoint|Clear|Close|Compare|Complete|Compress|Confirm|Connect|Convert|ConvertFrom|ConvertTo|Copy|Debug|Deny|Deploy|Disable|Disconnect|Dismount|Edit|Enable|Enter|Exit|Expand|Export|Find|Format|Get|Grant|Group|Hide|Import|Initialize|Install|Invoke|Join|Limit|Lock|Measure|Merge|Mount|Move|New|Open|Optimize|Out|Ping|Pop|Protect|Publish|Push|Read|Receive|Redo|Register|Remove|Rename|Repair|Request|Reset|Resize|Resolve|Restart|Restore|Resume|Revoke|Save|Search|Select|Send|Set|Show|Skip|Sort|Split|Start|Step|Stop|Submit|Suspend|Switch|Sync|Test|Trace|Unblock|Undo|Uninstall|Unlock|Unprotect|Unpublish|Unregister|Update|Use|Wait|Watch|Where|Write|ForEach|Tee';
const VERB_NOUN = new RegExp(`^(?:${VERBS})-[A-Za-z][A-Za-z0-9]*$`, 'i');
const NAME_OK = /^[A-Za-z_][\w.-]*$/;                 // only plain names are ever sent to PowerShell (no wildcards, quotes, paths)
// When a command is missing, a well-known module may be the reason (it exists, just not installed here).
const MODULE_HINTS = [
  [/^[A-Za-z]+-AD[A-Z]/, 'ActiveDirectory (RSAT)'], [/^[A-Za-z]+-Az[A-Z]/, 'Az (Azure)'], [/^[A-Za-z]+-Mg[A-Z]/, 'Microsoft.Graph'],
  [/^[A-Za-z]+-(EXO|Mailbox|DistributionGroup|TransportRule)/, 'ExchangeOnlineManagement / Exchange'], [/^[A-Za-z]+-SPO/, 'SharePoint Online'],
  [/^[A-Za-z]+-(VM|VMHost|Datastore|Cluster)\b/, 'Hyper-V or VMware PowerCLI'], [/^[A-Za-z]+-(Dhcp|DnsServer)/, 'DhcpServer / DnsServer (RSAT)'],
  [/^[A-Za-z]+-(GPO|GPRegistry|GPLink)/, 'GroupPolicy (RSAT)'], [/^[A-Za-z]+-(Teams|Cs[A-Z])/, 'MicrosoftTeams'], [/^[A-Za-z]+-Pnp/, 'PnP.PowerShell'],
];

// ---------- extracting PowerShell from markdown ----------
// Returns [{text, kind: 'block'|'inline', index}] for code that is (or looks like) PowerShell.
function extractPowerShell(markdown) {
  const out = [];
  const md = String(markdown || '');
  const fence = /(^|\n)[ \t]*(```|~~~)[ \t]*([\w+#-]*)[^\n]*\n([\s\S]*?)\n[ \t]*\2[ \t]*(?=\n|$)/g;
  let m, rest = '', last = 0, n = 0;
  while ((m = fence.exec(md))) {
    rest += md.slice(last, m.index) + '\n';
    last = m.index + m[0].length;
    const lang = m[3].toLowerCase(), body = m[4];
    if (PS_LANGS.has(lang) || (SHELLISH.has(lang) && looksLikePowerShell(body))) out.push({ text: body, kind: 'block', index: n });
    n++;
  }
  rest += md.slice(last);
  for (const im of rest.matchAll(/`([^`\n]{3,300})`/g)) {
    const t = im[1].trim();
    const first = t.split(/\s+/)[0];
    if (VERB_NOUN.test(first)) out.push({ text: t, kind: 'inline', index: n++ });
  }
  return out;
}
function looksLikePowerShell(text) {
  return /(^|[\s|;({])(?:[A-Za-z]+-[A-Za-z][A-Za-z0-9]*)(?=\s|$|\))/m.test(text) && text.split('\n').some(l => VERB_NOUN.test(l.trim().split(/\s+/)[0] || '') || /\|\s*(?:[A-Za-z]+-[A-Za-z]+|%|\?)/.test(l));
}

// ---------- a small PowerShell tokenizer ----------
// Splits a script into command segments. Every (...), $(...), @(...), {...}, @{...} is parsed as its own script, so
// commands inside script blocks and sub-expressions are found too. Strings, here-strings and comments are skipped.
function segments(script, baseLine = 1, hash = false) {        // hash: this script is the inside of @{...}
  const s = String(script).replace(/\r\n/g, '\n').replace(/`\n/g, ' ');   // backtick line continuation
  const segs = [];
  let cur = [], line = baseLine, segLine = baseLine, tok = '', tokStart = null;
  const pushTok = () => { if (tok) cur.push({ t: tok, line: tokStart }); tok = ''; tokStart = null; };
  const pushSeg = () => { pushTok(); if (cur.length) segs.push({ tokens: cur, line: segLine, hash }); cur = []; };
  const startTok = () => { if (tokStart === null) tokStart = line; };
  for (let i = 0; i < s.length; i++) {
    const c = s[i], next = s[i + 1];
    if (!cur.length && !tok) segLine = line;
    if (c === '\n') { line++; pushSeg(); continue; }
    if (c === '\r') continue;
    if (c === '<' && next === '#') { const e = s.indexOf('#>', i + 2); const body = s.slice(i, e < 0 ? s.length : e + 2); line += (body.match(/\n/g) || []).length; i = e < 0 ? s.length : e + 1; continue; }
    if (c === '#' && !tok) { const e = s.indexOf('\n', i); i = (e < 0 ? s.length : e) - 1; continue; }
    if (c === '@' && (next === "'" || next === '"') && s[i + 2] === '\n') {   // here-string
      const close = s.indexOf('\n' + next + '@', i + 3);
      const body = s.slice(i, close < 0 ? s.length : close + 3);
      line += (body.match(/\n/g) || []).length;
      startTok(); tok += '@str'; i = close < 0 ? s.length : close + 2; continue;
    }
    if (c === "'" || c === '"') {
      let j = i + 1;
      while (j < s.length) {
        if (s[j] === c) { if (s[j + 1] === c) { j += 2; continue; } break; }
        if (c === '"' && s[j] === '`') { j += 2; continue; }
        if (s[j] === '\n') line++;
        j++;
      }
      startTok(); tok += 'STR'; i = j; continue;
    }
    if (c === '{' || c === '(' || (c === '$' && next === '(') || (c === '@' && (next === '(' || next === '{'))) {
      const open = c === '$' || c === '@' ? next : c;
      const from = c === '$' || c === '@' ? i + 1 : i;
      const end = matchClose(s, from, open);
      const inner = s.slice(from + 1, end);
      const isHash = c === '@' && next === '{';
      segs.push(...segments(inner, line, isHash));
      line += (inner.match(/\n/g) || []).length;
      startTok(); tok += open === '{' ? '{…}' : '(…)'; i = end; continue;
    }
    if (c === ';' || c === '|' || (c === '&' && next === '&')) { pushSeg(); if (next === c) i++; continue; }
    if (c === ' ' || c === '\t' || c === ',') { pushTok(); continue; }
    if (c === '}' || c === ')') { pushTok(); continue; }               // stray closer
    startTok(); tok += c;
  }
  pushSeg();
  return segs;
}
function matchClose(s, from, open) {
  const close = open === '{' ? '}' : ')';
  let depth = 0;
  for (let i = from; i < s.length; i++) {
    const c = s[i];
    if (c === "'" || c === '"') { let j = i + 1; while (j < s.length && s[j] !== c) { if (c === '"' && s[j] === '`') j++; j++; } i = j; continue; }
    if (c === '#' && (i === 0 || /\s/.test(s[i - 1]))) { const e = s.indexOf('\n', i); if (e < 0) return s.length; i = e; continue; }
    if (c === '(' || c === '{') depth++;
    else if (c === ')' || c === '}') { depth--; if (depth === 0) return i; }
  }
  return s.length;
}

// Turns one segment into {name, params:[{name, raw}], line, text} or null when it is not a command call.
function commandOf(seg) {
  let t = seg.tokens.map(x => x.t);
  if (t.length > 1 && /^([-+*/%]|\?\?)?=$/.test(t[1])) t = t.slice(2);           // $x = Get-Foo ...   /  Key = value in @{}
  else if (seg.hash) return null;                                              // hashtable entry without "="
  if (!t.length) return null;
  let first = t[0];
  if (first === '!' || first.toLowerCase() === '-not') return null;
  if (SYMBOL_ALIASES[first]) first = SYMBOL_ALIASES[first];
  if (/^[$@'"\[.&\d-]|^STR|^\(…\)|^\{…\}/.test(first)) return null;           // variables, strings, types, call operator, numbers
  if (KEYWORDS.has(first.replace(/[({]….*$/, '').toLowerCase())) return null;    // also "param(…)", "if(…)", "foreach{…}"
  if (/[({]…/.test(first)) return null;                                         // a method call or expression, not a command
  if (/[\\/]/.test(first) || /\.(ps1|psm1|bat|cmd|vbs|js|py)$/i.test(first)) return null;   // a script path, not a command
  if (/[:=<>]/.test(first)) return null;
  const params = [];
  for (const raw of t.slice(1)) {
    const m = raw.match(/^-([A-Za-z_][\w]*)(:.*)?$/);
    if (m) params.push({ name: m[1], raw: '-' + m[1] });
  }
  return { name: first, params, line: seg.line, text: t.join(' ').replace(/STR/g, '"…"').slice(0, 160) };
}

// All command calls in a script, plus names of functions the script defines itself (those count as existing).
function parseCommands(script) {
  const defined = new Set([...String(script).matchAll(/\b(?:function|filter)\s+([\w-]+)/gi)].map(m => m[1].toLowerCase()));
  const calls = [];
  for (const seg of segments(script)) { const c = commandOf(seg); if (c) calls.push(c); }
  return { calls, defined };
}

// ---------- checking against the catalog ----------
// info: what pscatalog returned for a name: {found, type, resolved, source, params:[...], aliases:["Alias=Param"], advanced}
function checkParam(p, info) {
  const names = info.params || [];
  const aliasMap = new Map((info.aliases || []).map(a => { const [al, real] = a.split('='); return [al.toLowerCase(), real]; }));
  const lower = p.toLowerCase();
  if (names.some(n => n.toLowerCase() === lower) || aliasMap.has(lower)) return { ok: true };
  // PowerShell accepts any unambiguous start of a parameter name (-Rec for -Recurse).
  const pref = [...new Set([...names.filter(n => n.toLowerCase().startsWith(lower)), ...[...aliasMap].filter(([a]) => a.startsWith(lower)).map(([, r]) => r)])];
  if (pref.length === 1) return { ok: true, expanded: pref[0] };
  if (pref.length > 1) return { ok: false, why: 'ambiguous', options: pref.slice(0, 6) };
  return { ok: false, why: 'unknown', suggest: closest(p, names, 3) };
}

// calls: from parseCommands; lookup(name) -> info | undefined (undefined = could not ask)
function checkCalls(calls, defined, lookup, allNames = []) {
  const results = [];
  for (const c of calls) {
    const key = c.name.toLowerCase();
    if (defined.has(key)) { results.push({ ...c, status: 'defined-here' }); continue; }
    if (!NAME_OK.test(c.name)) { results.push({ ...c, status: 'skipped' }); continue; }
    const info = lookup(c.name);
    if (!info) { results.push({ ...c, status: 'unchecked' }); continue; }
    if (!info.found) {
      const hint = MODULE_HINTS.find(([re]) => re.test(c.name));
      // A known module's naming pattern (Get-AD..., Get-Mg...) most likely means "real, but not installed here": it can't be
      // verified on this PC, which is different from "invented".
      results.push({ ...c, status: hint ? 'not-installed' : 'unknown-command', module: hint ? hint[1] : null, suggest: closest(c.name, allNames, Math.max(2, Math.round(c.name.length / 5))) });
      continue;
    }
    if (info.type === 'Application' || info.type === 'ExternalScript') { results.push({ ...c, status: 'program', resolved: info.resolved }); continue; }
    // Simple functions (no [CmdletBinding()]) accept any argument, so their parameters can't be judged.
    if (info.type === 'Function' && info.advanced === false) { results.push({ ...c, status: 'ok', resolved: info.resolved, lenient: true }); continue; }
    const bad = [];
    for (const p of c.params) {
      const r = checkParam(p.name, info);
      if (!r.ok) bad.push({ param: p.raw, why: r.why, suggest: r.suggest || [], options: r.options || [] });
    }
    results.push({ ...c, status: bad.length ? 'bad-params' : 'ok', resolved: info.resolved, source: info.source, bad });
  }
  return results;
}

// Counts DISTINCT commands: an answer that shows the same pipeline twice and explains it again counts each command once.
function summarize(results) {
  const counted = results.filter(r => !['skipped', 'defined-here'].includes(r.status));
  const distinct = (list, key = r => (r.resolved || r.name).toLowerCase()) => new Set(list.map(key)).size;
  const problems = counted.filter(r => r.status === 'unknown-command' || r.status === 'bad-params');
  return {
    checked: distinct(counted.filter(r => r.status !== 'unchecked')), unchecked: distinct(counted.filter(r => r.status === 'unchecked')),
    problems: distinct(problems, r => describe(r)), notInstalled: distinct(counted.filter(r => r.status === 'not-installed')),
    ok: distinct(counted.filter(r => r.status === 'ok' || r.status === 'program')),
  };
}

// Plain-language line for each problem, used in the page and in the "ask the model to fix it" message.
function describe(r) {
  if (r.status === 'unknown-command') {
    return `"${r.name}" is not a command on this PC` + (r.suggest?.length ? `. Did you mean ${r.suggest.map(s => `"${s}"`).join(' or ')}?` : '.');
  }
  if (r.status === 'not-installed') {
    return `"${r.name}" can't be checked here: it looks like part of the ${r.module} module, which isn't installed on this PC`;
  }
  if (r.status === 'bad-params') {
    return r.bad.map(b => b.why === 'ambiguous'
      ? `${r.resolved || r.name}: "${b.param}" is ambiguous (could be ${b.options.map(o => '-' + o).join(', ')})`
      : `${r.resolved || r.name} has no parameter "${b.param}"` + (b.suggest.length ? ` (did you mean ${b.suggest.map(s => '-' + s).join(' or ')}?)` : '')).join('; ');
  }
  return '';
}

// ---------- string distance for suggestions ----------
function lev(a, b) {
  a = a.toLowerCase(); b = b.toLowerCase();
  if (Math.abs(a.length - b.length) > 8) return 99;
  const d = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = d[0]; d[0] = i;
    for (let j = 1; j <= b.length; j++) { const tmp = d[j]; d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = tmp; }
  }
  return d[b.length];
}
// Up to 2 close names: a small edit distance, or a long shared start, which catches shortened names
// ("Get-NetAdapterStats" -> "Get-NetAdapterStatistics", "-Recursive" -> "-Recurse").
function closest(word, pool, maxDist = 3) {
  const w = word.toLowerCase();
  const scored = [];
  for (const p of pool) {
    const l = p.toLowerCase();
    if (l === w) continue;
    const d = lev(w, l);
    let lcp = 0; while (lcp < w.length && lcp < l.length && w[lcp] === l[lcp]) lcp++;
    const byStart = lcp >= Math.max(4, w.length - 4) ? (w.length - lcp) / 2 + Math.abs(l.length - w.length) / 20 : 99;
    const s = Math.min(d, byStart);
    if (s <= maxDist) scored.push({ p, s });
  }
  return scored.sort((a, b) => a.s - b.s || a.p.length - b.p.length).slice(0, 2).map(x => x.p);
}

// Whole pipeline for one answer. lookup/allNames come from the catalog.
function checkAnswer(markdown, lookup, allNames) {
  const pieces = extractPowerShell(markdown);
  const all = [];
  for (const piece of pieces) {
    const { calls, defined } = parseCommands(piece.text);
    for (const r of checkCalls(calls, defined, lookup, allNames)) all.push({ ...r, piece: piece.index, kind: piece.kind });
  }
  return { results: all, pieces: pieces.length, ...summarize(all) };
}

// The distinct plain names a check will need from PowerShell.
function namesToLookUp(markdown) {
  const names = new Set();
  for (const piece of extractPowerShell(markdown)) {
    const { calls, defined } = parseCommands(piece.text);
    for (const c of calls) if (NAME_OK.test(c.name) && !defined.has(c.name.toLowerCase())) names.add(c.name);
  }
  return [...names].slice(0, 80);
}

module.exports = { extractPowerShell, segments, parseCommands, checkCalls, checkParam, checkAnswer, namesToLookUp, describe, closest, summarize, NAME_OK, SYMBOL_ALIASES };
