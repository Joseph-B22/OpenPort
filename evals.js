// Private model tests: a set of questions with machine-checkable expectations, run against whichever model is
// loaded, with every run kept so models can be compared before you switch. Local only; nothing is sent anywhere.
const fs = require('fs');
const path = require('path');

const FILLER = 'Routine status line: all checks nominal, no operator action required for this entry. ';
const longContext = needle => FILLER.repeat(35) + needle + ' ' + FILLER.repeat(35);
const SMALL_CONFIG = 'interface GigabitEthernet1/0/2\n description CCTV-camera-lobby\n switchport access vlan 340\n switchport mode access\n!\ninterface GigabitEthernet1/0/3\n description printer-HR\n switchport access vlan 10\n switchport mode access\n!';

// Starter set: deterministic IT facts, reading long text, reading a config, honesty, and following instructions.
const STARTER = [
  { name: 'RDP port', prompt: 'What is the default TCP port for Remote Desktop (RDP)? Answer briefly.', expect: ['3389'] },
  { name: 'LDAPS port', prompt: 'Which TCP port does LDAP over SSL (LDAPS) use by default? Answer briefly.', expect: ['636'] },
  { name: 'Flush DNS (Windows)', prompt: 'Which Windows command flushes the DNS resolver cache? Give just the command.', expect: ['ipconfig /flushdns'] },
  { name: 'Show VLANs (Cisco)', prompt: 'On a Cisco switch, which command lists all VLANs in brief form?', expect: ['show vlan brief'] },
  { name: 'Listening ports (Linux)', prompt: 'Name one Linux command that lists listening TCP ports.', expect: ['ss|netstat|lsof'] },
  { name: 'APIPA meaning', prompt: 'A Windows PC shows the address 169.254.12.7. What does that usually mean? One sentence.', expect: ['apipa|dhcp|automatic private'] },
  { name: 'IPv6 size', prompt: 'How many bits long is an IPv6 address? Just the number.', expect: ['128'] },
  { name: 'Needle in long text', context: longContext('NOTE: the database maintenance window is Saturday at 02:00 server time.'), prompt: 'According to the text above, when is the database maintenance window?', expect: ['02:00'] },
  { name: 'Read a config', context: SMALL_CONFIG, prompt: 'In the configuration above, which VLAN is the CCTV camera port in? Answer with the number.', expect: ['340'], forbid: ['vlan 10 '] },
  { name: 'Admits what it cannot know', prompt: 'What is the IP address of my company\'s primary domain controller?', expect: ['don\'t know|do not know|cannot|can\'t|not able|unable|no way|don\'t have|do not have|not have access'] },
  { name: 'One-word answer', prompt: 'Reply with exactly one word and nothing else: yes', expect: ['yes'], maxChars: 12 },
  { name: 'Loop protection (TTL)', prompt: 'What problem does the TTL field in an IP header help prevent? One sentence.', expect: ['loop|infinite|forever|circulat'] },
];

const stamp = () => new Date().toISOString();
const withIds = cases => cases.map((c, i) => ({ id: c.id || `t${Date.now().toString(36)}${i}`, ...c }));

function files(dataDir) {
  const dir = path.join(dataDir, 'evals');
  fs.mkdirSync(dir, { recursive: true });
  return { cases: path.join(dir, 'cases.json'), runs: path.join(dir, 'runs.json') };
}
function readJson(f, fallback) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return fallback; } }

function loadCases(dataDir) {
  const f = files(dataDir).cases;
  if (!fs.existsSync(f)) { const seeded = withIds(STARTER.map((c, i) => ({ ...c, id: `starter-${i + 1}` }))); fs.writeFileSync(f, JSON.stringify(seeded, null, 2)); return seeded; }
  return readJson(f, []);
}
function saveCases(dataDir, cases) {
  const clean = withIds(cases.map(c => ({
    id: c.id, name: String(c.name || 'Untitled').slice(0, 80), prompt: String(c.prompt || ''), context: c.context ? String(c.context) : undefined,
    expect: (c.expect || []).map(String).filter(Boolean), forbid: (c.forbid || []).map(String).filter(Boolean),
    maxChars: c.maxChars ? Number(c.maxChars) : undefined,
  })));
  fs.writeFileSync(files(dataDir).cases, JSON.stringify(clean, null, 2));
  return clean;
}
const loadRuns = dataDir => readJson(files(dataDir).runs, []);
function saveRun(dataDir, run) {
  const runs = loadRuns(dataDir); runs.unshift(run);
  fs.writeFileSync(files(dataDir).runs, JSON.stringify(runs.slice(0, 200), null, 2));
}
function deleteRun(dataDir, id) { fs.writeFileSync(files(dataDir).runs, JSON.stringify(loadRuns(dataDir).filter(r => r.id !== id), null, 2)); }

// "a|b" in an expectation means either is fine. Matching ignores case.
function score(answer, c) {
  const low = (answer || '').toLowerCase();
  const missing = (c.expect || []).filter(e => !e.split('|').some(alt => alt.trim() && low.includes(alt.trim().toLowerCase())));
  const forbidden = (c.forbid || []).filter(f => f && low.includes(f.toLowerCase()));
  const tooLong = c.maxChars && (answer || '').trim().length > c.maxChars;
  return { pass: !missing.length && !forbidden.length && !tooLong, missing, forbidden, tooLong: !!tooLong };
}

// ask(messages) -> {content, reasoning, tokens, tps}. onProgress({done,total,name}). Returns the run record.
async function runSuite({ cases, ask, onProgress, signal, meta, systemPrompt }) {
  const details = [];
  for (let i = 0; i < cases.length; i++) {
    if (signal?.aborted) break;
    const c = cases[i];
    onProgress?.({ done: i, total: cases.length, name: c.name });
    const user = c.context ? `${c.context}\n\n${c.prompt}` : c.prompt;
    const t0 = Date.now();
    let r, error = null;
    try { r = await ask([{ role: 'system', content: systemPrompt }, { role: 'user', content: user }]); }
    catch (e) { error = e.message; }
    const ms = Date.now() - t0;
    const s = error ? { pass: false, missing: c.expect || [], forbidden: [], tooLong: false } : score(r.content, c);
    details.push({ id: c.id, name: c.name, pass: s.pass, ms, tps: r?.tps ?? null, tokens: r?.tokens ?? null,
      answer: (r?.content || '').slice(0, 500), missing: s.missing, forbidden: s.forbidden, tooLong: s.tooLong, error });
  }
  const done = details.length;
  const timed = details.filter(d => d.tps);
  return {
    id: `run-${Date.now().toString(36)}`, when: stamp(), ...meta, total: cases.length, completed: done, cancelled: !!signal?.aborted,
    passed: details.filter(d => d.pass).length,
    avgMs: done ? Math.round(details.reduce((n, d) => n + d.ms, 0) / done) : 0,
    avgTps: timed.length ? +(timed.reduce((n, d) => n + d.tps, 0) / timed.length).toFixed(1) : null,
    details,
  };
}

module.exports = { STARTER, loadCases, saveCases, loadRuns, saveRun, deleteRun, score, runSuite };
