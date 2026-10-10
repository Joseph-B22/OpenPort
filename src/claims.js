// Claim checks: finds statements in an answer that can be checked against THIS computer or the files in this conversation,
// and judges them once the facts are in. No model is involved: extraction is by fixed patterns, facts come from read-only
// lookups (claimprobe.js) or the text of attached files.
//
// Labels (always one of):
//   match       the answer's claim agrees with this PC / your file
//   differs     this PC shows something else than the answer says
//   absent      the thing the answer names was not found here (it may exist on another machine, or be invented)
//   info        no claim to judge, but here is the fact from this PC
// They describe THIS computer. If the answer is about another machine, they don't apply.
(function (root) {
  const STOP = new Set(['this', 'that', 'the', 'your', 'same', 'new', 'following', 'above', 'relevant', 'windows', 'a', 'an', 'which', 'each', 'any', 'one', 'my', 'web', 'cloud']);
  const SERVICE_NAME = /^[A-Za-z0-9][A-Za-z0-9 ._()-]{1,59}$/;          // what may be sent to Get-Service (no wildcards)

  function stripCode(md) { return String(md || '').replace(/```[\s\S]*?```/g, ' '); }
  function codeOf(md) { return [...String(md || '').matchAll(/```[^\n]*\n([\s\S]*?)```/g)].map(m => m[1]).join('\n') + '\n' + [...String(md || '').matchAll(/`([^`\n]+)`/g)].map(m => m[1]).join('\n'); }
  function sentences(text) { return text.replace(/\s+/g, ' ').split(/(?<=[.!?])\s+(?=[A-Z0-9`"(*])/); }
  const sentenceWith = (sents, needle) => sents.find(s => s.toLowerCase().includes(needle.toLowerCase())) || '';

  // ---------- services ----------
  function serviceExpectation(s) {
    const t = s.toLowerCase();
    if (/\b(is|are|was|has been|set to)\s+(?:now\s+)?disabled\b/.test(t)) return 'disabled';
    if (/\b(is|are)\s+(not running|stopped)\b|\bisn'?t running\b|\bhas stopped\b/.test(t)) return 'stopped';
    if (/\b(is|are)\s+(?:currently\s+|already\s+)?(running|started)\b/.test(t)) return 'running';
    return null;
  }
  function extractServices(md) {
    const prose = stripCode(md), sents = sentences(prose), out = new Map();
    const add = (name, expect, where) => {
      name = name.replace(/[`"']/g, '').trim();
      if (!SERVICE_NAME.test(name) || STOP.has(name.toLowerCase()) || name.split(' ').length > 5) return;
      const k = name.toLowerCase();
      if (!out.has(k)) out.set(k, { name, expect, where });
      else if (expect && !out.get(k).expect) out.get(k).expect = expect;
    };
    for (const m of prose.matchAll(/\b[Tt]he\s+(`[\w.-]{2,40}`|(?:[A-Z][\w.-]*)(?:\s+[A-Z][\w.-]*){0,3})\s+service\b/g)) {
      const name = m[1];
      if (STOP.has(name.replace(/`/g, '').toLowerCase())) continue;
      add(name, serviceExpectation(sentenceWith(sents, name.replace(/`/g, '') + (name.startsWith('`') ? '' : ' service'))), 'text');
    }
    for (const m of prose.matchAll(/\bservice\s+(?:named|called)\s+[`"']?([\w.() -]{2,40}?)[`"']?(?=[\s.,;:)]|$)/gi)) add(m[1], serviceExpectation(sentenceWith(sents, m[1])), 'text');
    const code = codeOf(md);
    for (const m of code.matchAll(/\b(?:Get|Start|Stop|Restart|Set|Suspend|Resume)-Service\s+(?:-Name\s+)?(["']?)([A-Za-z][\w.-]{1,40})\1(?=[\s;|)]|$)/gi)) {
      if (!m[2].startsWith('-')) add(m[2], null, 'command');
    }
    for (const m of code.matchAll(/\b(?:net\s+(?:start|stop)|sc(?:\.exe)?\s+(?:query|start|stop|config|qc))\s+(["']?)([A-Za-z][\w.-]{1,40})\1/gi)) add(m[2], null, 'command');
    return [...out.values()].slice(0, 10);
  }
  function judgeService(c, f) {
    if (!f) return null;
    if (!f.found) return { kind: 'service', mention: c.name, label: 'absent', text: `No service called "${c.name}" on this PC.` };
    const desc = `${f.display}${f.name.toLowerCase() !== f.display.toLowerCase() ? ` (${f.name})` : ''} is ${f.status}, startup ${f.start}`;
    if (c.expect === 'running') return { kind: 'service', mention: c.name, label: f.status === 'Running' ? 'match' : 'differs', text: `The answer says it is running. On this PC: ${desc}.` };
    if (c.expect === 'stopped') return { kind: 'service', mention: c.name, label: f.status === 'Stopped' ? 'match' : 'differs', text: `The answer says it is stopped. On this PC: ${desc}.` };
    if (c.expect === 'disabled') return { kind: 'service', mention: c.name, label: f.start === 'Disabled' ? 'match' : 'differs', text: `The answer says it is disabled. On this PC: ${desc}.` };
    return { kind: 'service', mention: c.name, label: 'info', text: `On this PC: ${desc}.` };
  }

  // ---------- installed updates (KB numbers) ----------
  function extractKbs(md) {
    const prose = stripCode(md), sents = sentences(prose), out = new Map();
    for (const m of String(md).matchAll(/\bKB\s?(\d{6,8})\b/gi)) {
      const id = 'KB' + m[1];
      if (out.has(id)) continue;
      const s = sentenceWith(sents, m[0]).toLowerCase();
      let expect = null;
      if (/\b(not installed|isn'?t installed|is missing|are missing|not present|hasn'?t been installed|was not installed)\b/.test(s)) expect = 'missing';
      else if (/\b(is|was|has been|are|were|have been)\s+installed\b/.test(s)) expect = 'installed';
      out.set(id, { id, mention: m[0], expect });
    }
    return [...out.values()].slice(0, 10);
  }
  function judgeKb(c, f) {
    if (!f) return null;
    const caveat = 'Get-HotFix does not list every kind of update, so "not listed" is not proof it is missing.';
    if (f.installed) {
      const t = `${c.id} is installed on this PC${f.date ? ` (${f.date})` : ''}.`;
      return { kind: 'update', mention: c.mention, label: c.expect === 'missing' ? 'differs' : c.expect === 'installed' ? 'match' : 'info', text: c.expect === 'missing' ? `The answer says it is missing. ${t}` : t };
    }
    // "Not listed" can't confirm "missing" (Get-HotFix misses some update types), so that case is information, not a match.
    return { kind: 'update', mention: c.mention, label: c.expect === 'installed' ? 'absent' : 'info',
      text: `${c.expect === 'missing' ? 'Consistent with the answer, but not proof: ' : ''}${c.id} is not in this PC's installed-updates list. ${caveat}` };
  }

  // ---------- local paths ----------
  function extractPaths(md) {
    const out = new Set();
    for (const m of String(md).matchAll(/(?<![\w\\/])([A-Za-z]:\\(?:[^\\/:*?"<>|\r\n`'\s,;()]+\\?)*)/g)) {
      let p = m[1].replace(/[.\\]+$/, '');
      if (p.length < 3) p = m[1].slice(0, 3);
      if (/\\path\\to\\|\\your|example|\\user(name)?\\|<|\.\.\./i.test(p)) continue;        // placeholders, not real paths
      out.add(p);
    }
    for (const m of String(md).matchAll(/%(\w+)%((?:\\[^\\/:*?"<>|\r\n`'\s,;()]+)*)/g)) out.add(`%${m[1]}%${m[2]}`.replace(/[.\\]+$/, ''));
    return [...out].slice(0, 12).map(p => ({ path: p }));
  }
  function judgePath(c, f) {
    if (!f || f.skipped) return null;
    return f.exists
      ? { kind: 'path', mention: c.path, label: 'info', text: `${f.shown || c.path} exists on this PC (${f.type}).` }
      : { kind: 'path', mention: c.path, label: 'absent', text: `${f.shown || c.path} was not found on this PC.` };
  }

  // ---------- values vs. the files in this conversation ----------
  const IFACE = { gigabitethernet: 'gi', gi: 'gi', tengigabitethernet: 'te', te: 'te', fastethernet: 'fa', fa: 'fa', ethernet: 'eth', eth: 'eth', 'port-channel': 'po', po: 'po' };
  const ipRe = /\b((?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d))(\/(?:3[0-2]|[12]?\d))?\b/g;
  const macRe = /\b(?:[0-9a-f]{2}(?:[:-][0-9a-f]{2}){5}|[0-9a-f]{4}\.[0-9a-f]{4}\.[0-9a-f]{4})\b/gi;
  const ifRe = /\b(GigabitEthernet|TenGigabitEthernet|FastEthernet|Ethernet|Port-channel|Gi|Te|Fa|Eth|Po)\s?(\d+(?:\/\d+){0,3})\b/gi;
  const vlanRe = /\bvlan\s?(\d{1,4})\b/gi;
  const normMac = m => m.toLowerCase().replace(/[^0-9a-f]/g, '');
  function valuesIn(text) {
    const vals = new Map();
    const t = String(text || '');
    for (const m of t.matchAll(ipRe)) vals.set('ip:' + m[1], { type: 'IP address', value: m[0], key: 'ip:' + m[1] });
    for (const m of t.matchAll(macRe)) vals.set('mac:' + normMac(m[0]), { type: 'MAC address', value: m[0], key: 'mac:' + normMac(m[0]) });
    for (const m of t.matchAll(ifRe)) {
      const p = IFACE[m[1].toLowerCase()];
      if (p !== 'po' && !m[2].includes('/')) continue;                       // "Ethernet 2" is a Windows adapter name, not a switch port
      vals.set(`if:${p}${m[2]}`, { type: 'interface', value: m[0], key: `if:${p}${m[2]}` });
    }
    for (const m of t.matchAll(vlanRe)) vals.set('vlan:' + Number(m[1]), { type: 'VLAN', value: m[0], key: 'vlan:' + Number(m[1]) });
    return vals;
  }
  function boring(v) {
    if (v.key.startsWith('ip:')) { const ip = v.key.slice(3); return /^(0\.0\.0\.0|255\.|127\.0\.0\.1$|8\.8\.[48]\.[48]$|1\.1\.1\.1$|224\.)/.test(ip); }
    return false;
  }
  // sources: [{name, text}] (attached files, tool results). Values the user typed in the question are not judged.
  function checkValues(answer, sources, question = '') {
    if (!sources.length) return [];
    const inAnswer = valuesIn(answer), inQuestion = valuesIn(question);
    const srcVals = sources.map(s => ({ name: s.name, vals: valuesIn(s.text) }));
    const items = [];
    for (const v of inAnswer.values()) {
      if (inQuestion.has(v.key) || boring(v)) continue;
      const where = srcVals.filter(s => s.vals.has(v.key)).map(s => s.name);
      const what = v.type === 'VLAN' ? v.value : `${v.type} ${v.value}`;
      items.push(where.length
        ? { kind: 'value', mention: v.value, label: 'match', text: `${what} appears in ${where.slice(0, 2).join(', ')}.` }
        : { kind: 'value', mention: v.value, label: 'absent', text: `${what} is not in ${sources.length === 1 ? sources[0].name : 'any of the files in this conversation'}. It may be a suggestion, or the model may have invented it.` });
    }
    return items.slice(0, 20);
  }

  // What to ask the main process to look up.
  function toProbe(md) {
    return { services: extractServices(md), kbs: extractKbs(md), paths: extractPaths(md) };
  }
  function judgeAll(claims, facts, question = '') {
    const out = [];
    const sv = new Map((facts.services || []).map(f => [String(f.q).toLowerCase(), f]));
    // One row per real service: "the Print Spooler service" and "Restart-Service Spooler" are the same one; keep the claim.
    const perService = new Map();
    for (const c of claims.services) {
      const f = sv.get(c.name.toLowerCase());
      const j = judgeService(c, f);
      if (!j) continue;
      const key = f?.found ? f.name.toLowerCase() : 'missing:' + c.name.toLowerCase();
      const prev = perService.get(key);
      if (!prev || (prev.label === 'info' && j.label !== 'info')) perService.set(key, { ...j, alsoMentions: prev ? [prev.mention] : [] });
      else prev.alsoMentions = [...(prev.alsoMentions || []), c.name];
    }
    for (const j of perService.values()) out.push(j);
    const kb = new Map((facts.kbs || []).map(f => [String(f.q).toUpperCase(), f]));
    for (const c of claims.kbs) { const j = judgeKb(c, kb.get(c.id.toUpperCase())); if (j) out.push(j); }
    const pa = new Map((facts.paths || []).map(f => [f.path, f]));
    const q = String(question).toLowerCase();
    for (const c of claims.paths) {
      const j = judgePath(c, pa.get(c.path));
      if (!j) continue;
      // A path YOU named in the question isn't the model's claim: say it plainly, without a warning.
      if (j.label === 'absent' && q.includes(c.path.toLowerCase())) {
        j.label = 'info';
        j.text = `${c.path} (from your question) doesn't exist on this PC. That's fine if you meant another machine or haven't created it yet.`;
      }
      out.push(j);
    }
    return out;
  }

  const api = { extractServices, extractKbs, extractPaths, judgeService, judgeKb, judgePath, checkValues, valuesIn, toProbe, judgeAll, SERVICE_NAME };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Claims = api;
})(typeof window !== 'undefined' ? window : globalThis);
