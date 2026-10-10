// UI PREVIEW: serves src/ in any browser with a stand-in for the Electron backend (window.openport), so the interface can be
// viewed and driven with NO model, NO engine and NO real data.   Run: npm run preview   then open http://127.0.0.1:5599/
//   http://127.0.0.1:5599/?work   shows the work edition (screen memory hidden).
// When preload.js gains new functions, add matching stand-ins to the STUB below or the page will throw.
// Serves the app's UI with a stand-in backend (no Electron, no model) so the interface can be viewed and driven.
const http = require('http'), fs = require('fs'), path = require('path');
const SRC = path.resolve(__dirname, '..', 'src');
const STUB = `
const sleep = ms => new Promise(r => setTimeout(r, ms));
// pretend tokenizer: ~1.3 tokens per word
const count = t => Math.max(1, Math.round((t.trim().split(/\\s+/).length) * 1.3));
const cfg = { backend: 'auto', contextSize: 4096, systemPrompt: 'You are a helpful assistant.', memory: { enabled: true, topK: 3, minScore: 0.65 },
  retention: { maxAgeDays: 0, maxChats: 0, maxSizeMB: 0 }, tools: { enabled: false, folders: [] },
  smartContext: { recallChat: true, recallK: 3, minScore: 0.7, focusTools: false, typeahead: true }, allowDownloads: true };
window.__calls = [];
const log = (n, a) => window.__calls.push([n, JSON.stringify(a).slice(0, 120)]);
window.openport = {
  getConfig: async () => cfg, setConfig: async p => Object.assign(cfg, p),
  systemInfo: async () => ({ gpu: true, allowDownloads: true, allowScreenMemory: !location.search.includes('work'), engines: { gpu: true, cpu: true } }),
  listModels: async () => [{ id: 'gemma-4-26b-a4b', sizeGB: '15.4', mmproj: true }],
  getState: async () => ({ status: 'ready', model: 'gemma-4-26b-a4b', port: 1, backend: 'vulkan' }),
  startEngine: async () => {}, stopEngine: async () => {}, onState: () => {},
  tokenize: async texts => { log('tokenize', texts.length); return texts.map(count); },
  chats: { list: async q => [
      { id: 'c1', title: 'Branch DNS not resolving', updated: Date.now() - 3600e3 },
      { id: 'c2', title: 'Switch cabling for the new rack', updated: Date.now() - 86400e3 },
      { id: 'c3', title: 'PowerShell: find stale AD accounts', updated: Date.now() - 3 * 86400e3 },
      { id: 'c4', title: 'Review firewall rule export', updated: Date.now() - 9 * 86400e3 },
    ].filter(c => !q || c.title.toLowerCase().includes(q.toLowerCase())),
    get: async id => id !== 'c1' ? [] : [
      { id: 1, role: 'user', content: 'Clients at the branch can ping 10.20.0.10 but nslookup times out. What should I check?' },
      { id: 2, role: 'assistant', content: 'If ping works but DNS lookups time out, the path is fine and the problem is the DNS service or the port.\\n\\n1. **Test UDP/TCP 53 directly** from a client:\\n\\n\`\`\`powershell\\nResolve-DnsName example.com -Server 10.20.0.10 -DnsOnly\\nTest-NetConnection 10.20.0.10 -Port 53\\n\`\`\`\\n\\n2. **Check the DNS Server service** on 10.20.0.10 (\`Get-Service DNS\`).\\n3. **Look for a firewall rule** blocking 53 between the branch VLAN and the server.\\n\\n| Check | Expected |\\n|---|---|\\n| Port 53 TCP | \`TcpTestSucceeded : True\` |\\n| Service | Running |' },
      { id: 3, role: 'user', content: 'Port 53 test fails, the service is running.' },
      { id: 4, role: 'assistant', content: 'Then something between the client and the server is dropping port 53. The most likely place is the branch firewall or an ACL on the core switch. Look for a recent change to the rule that allows **DNS (53/udp, 53/tcp)** from 10.20.0.0/24.' },
    ], create: async () => 'chat-1', rename: async () => {}, remove: async () => {}, removeAll: async () => {}, stats: async () => ({ chats: 4, messages: 18, embedded: 9, facts: 2, outdated: 1, sizeMB: 0.2 }), prune: async () => ({ removed: 0 }), append: async () => 1 },
  memory: (() => {
    const D = 86400000;
    let rows = [
      { kind: 'fact', id: 4, text: 'The office switch uplink uses the black Cat6 cable on port Gi1/0/48.', created: Date.now() - 2 * 3600e3, state: 0, chat_id: 'c2', title: 'Switch cabling' },
      { kind: 'chat', id: 12, text: 'Q: Which DNS servers does the branch use?\\nA: The branch uses 10.20.0.10 and 10.20.0.11, set by DHCP scope 10.20.0.0/24.', created: Date.now() - D, state: 0, chat_id: 'c1', title: 'Branch DNS' },
      { kind: 'fact', id: 2, text: 'The office switch uplink uses the grey Cat5e cable.', created: Date.now() - 9 * D, state: 1, replaced_by: 4, chat_id: 'c0', title: 'Old cabling notes' },
      { kind: 'chat', id: 7, text: 'Q: How do I flush DNS on Windows?\\nA: Run ipconfig /flushdns in an elevated prompt.', created: Date.now() - 40 * D, state: 0, chat_id: 'c3', title: 'DNS basics' },
    ];
    const age = t => { const d = Math.floor((Date.now() - t) / D); return d <= 0 ? 'today' : d === 1 ? 'yesterday' : d < 14 ? d + ' days ago' : Math.round(d / 7) + ' weeks ago'; };
    return {
      status: async () => ({ ready: true, model: 'embeddinggemma-2', embedded: 0, messages: 0 }),
      search: async (q) => { log('memory.search', q); return []; },
      list: async (o) => rows.filter(r => !o?.query || r.text.toLowerCase().includes(o.query.toLowerCase())).map(r => ({ ...r, age: age(r.created) })),
      setState: async (kind, id, state) => { log('memory.setState', [kind, id, state]); rows = state === 2 ? rows.filter(r => !(r.kind === kind && r.id === id)) : rows.map(r => r.kind === kind && r.id === id ? { ...r, state } : r); return {}; },
      chatFacts: async () => [],
      saveFacts: async (chatId, facts) => { log('memory.saveFacts', facts); facts.forEach((t, i) => rows.unshift({ kind: 'fact', id: 100 + i, text: t, created: Date.now(), state: 0, chat_id: chatId, title: 'This chat' })); return facts.map(t => ({ text: t, replaced: [] })); },
    };
  })(),
  ctx: { sync: async a => { log('ctx.sync', a.turns.length); return true; }, recall: async a => { log('ctx.recall', { skip: a.skip.length }); return [{ turn: 2, role: 'user', text: 'The backup account is svc-backup-07.', score: 0.82 }]; } },
  evals: (() => {
    const names = ['RDP port','LDAPS port','Flush DNS (Windows)','Show VLANs (Cisco)','Listening ports (Linux)','Needle in long text','Read a config','Admits what it cannot know'];
    const mk = (id, model, backend, when, passFn, tps) => { const details = names.map((n, i) => ({ id: 's' + i, name: n, pass: passFn(i), ms: 1200 + i * 300, tps, tokens: 40, answer: passFn(i) ? 'Correct answer text for ' + n : 'I am not sure about that one.', missing: passFn(i) ? [] : ['expected phrase'], forbidden: [], tooLong: false })); const passed = details.filter(d => d.pass).length; return { id, when, model, backend, ctx: 8192, total: 8, completed: 8, passed, avgMs: 2300, avgTps: tps, details }; };
    let cases = names.map((n, i) => ({ id: 's' + i, name: n, prompt: 'q?', expect: ['x'] }));
    const runs = [mk('r2', 'gemma-4-12b', 'cpu', new Date(Date.now() - 3600e3).toISOString(), i => i !== 5 && i !== 7, 11.2), mk('r1', 'gemma-4-26b-a4b', 'vulkan', new Date(Date.now() - 86400e3).toISOString(), i => i !== 7, 97.4)];
    return { cases: async () => cases, saveCases: async c => (cases = c.map((x, i) => ({ id: x.id || 'n' + i, ...x }))), runs: async () => runs, deleteRun: async () => runs, start: async () => ({ run: runs[0] }), cancel: async () => {}, onProgress: () => {} };
  })(),
  screenmem: (() => {
    let st = { allowed: true, enabled: true, active: true, paused: false, locked: false, hotkeys: { pause: true, remember: true }, stats: { captured: 14, skippedDuplicate: 9, skippedExcluded: 3, scrubbedItems: 2, errors: 0, lastError: null }, db: { count: 14, pinned: 2, embedded: 14, mb: 0.12 }, config: { enabled: true, retentionDays: 3, intervalSec: 30, exclude: ['1password', 'incognito', 'sign in', 'bank'] }, helper: { ok: true, languages: ['en-US'] }, defaultExclude: ['1password', 'bitwarden', 'incognito', 'sign in', 'bank', 'password'] };
    let cb = () => {};
    const hits = [
      { id: 3, ts: Date.now() - 20 * 60000, process: 'WindowsTerminal', title: 'PS C:\\> ping 10.9.8.7', pinned: false, snippet: 'Pinging 10.9.8.7 with 32 bytes of data:\\nRequest timed out.\\nRequest timed out.' },
      { id: 2, ts: Date.now() - 55 * 60000, process: 'mmc', title: 'Event Viewer', pinned: true, snippet: 'Event ID 4625 An account failed to log on\\nAccount Name: jmarsh' },
    ];
    return { status: async () => st, onState: f => { cb = f; },
      pause: async p => { st = { ...st, paused: p }; cb(st); return st; }, remember: async () => st, clear: async () => { st = { ...st, db: { ...st.db, count: 0 } }; cb(st); return st; },
      search: async q => ({ searched: 14, hits: q.query ? hits.slice(0, 1) : hits }), readScreen: async () => ({ text: 'PS C:\\Users\\admin> ipconfig\\nIPv4 Address. . . : 10.20.30.45\\nDefault Gateway . . : 10.20.30.1', chars: 90, ms: 44 }) };
  })(),
  cart: { list: async () => [{ id: 'c1', name: 'falcon-runbook.txt', tokens: 18000, mb: 612, model: 'gemma-4-26b-a4b', ctx: 8192, createMs: 91000 }], create: async () => ({}), use: async () => ({ system: 'You are a helpful assistant.', block: '[Document: falcon-runbook.txt]', tokens: 18000, name: 'falcon-runbook.txt' }), remove: async () => [] },
  tools: { list: async () => ({ defs: [], folders: [] }), run: async () => ({ ok: true, text: '' }), pickFolder: async () => null },
  models: { all: async () => ({ models: [{ id: 'gemma-4-26b-a4b', kind: 'chat', sizeGB: '15.4', bytes: 15.4e9, vision: true }, { id: 'embeddinggemma-2', kind: 'embed', sizeGB: '0.3', bytes: 3e8, vision: false }], activeId: 'gemma-4-26b-a4b', freeGB: 1100 }), catalog: async () => ({ models: [{ id: 'gemma-4-12b', name: 'Gemma 4 12B (fast)', kind: 'chat', repo: 'unsloth/gemma-4-12b-it-qat-GGUF', files: [], sizeGB: 6.5, license: 'Apache 2.0', notes: 'Smaller and quicker.' }] }), onProgress: () => {}, remove: async () => true, importFiles: async () => null, hfSearch: async () => [{ id: 'unsloth/gemma-4-12b-it-qat-GGUF', created: '2026-06-05', downloads: 545521, pipeline: 'image-text-to-text' }], hfFiles: async () => ({ variants: [{ name: 'gemma-4-12B-it-qat-UD-Q4_K_XL.gguf', files: [{ path: 'a.gguf', size: 6.3e9 }], bytes: 6.3e9 }], projectors: [{ name: 'mmproj-F16.gguf', files: [{ path: 'm.gguf', size: 2e8 }], bytes: 2e8 }] }), hfDownload: async () => ({}), hfCancel: async () => {} },
  index: { status: async () => ({ files: 0, chunks: 0, building: false }), onProgress: () => {}, build: async () => ({}), cancel: async () => {}, clear: async () => ({}) },
  docs: { pick: async () => [], load: async () => [], summarize: async () => ({}), pathFor: () => '' },
  audit: { recent: async () => [], reveal: async () => {} }, captureScreen: async () => '',
  // Not canned: the preview server runs the REAL checker against this PC's PowerShell (read-only name lookups).
  cmdcheck: { check: async md => (await fetch('http://127.0.0.1:' + location.port + '/__cmdcheck', { method: 'POST', body: md })).json() },
  // Canned, but taken from a real reading on the home PC (GPU, Gemma 4 26B loaded).
  stats: { get: async () => ({ chat: { ram: 3.2e9, vram: 14.73e9, model: 'gemma-4-26b-a4b', status: 'ready', backend: 'vulkan' }, embed: { ram: 1.43e9, vram: 0 }, app: 0.5e9, vramAll: 16.02e9, vramCapacity: 17.16e9, pcUsed: 19.5e9, pcTotal: 33.4e9, partial: false }) },
  // Also real: service status, installed updates and local paths from this PC (read-only).
  claims: { probe: async req => (await fetch('http://127.0.0.1:' + location.port + '/__claims', { method: 'POST', body: JSON.stringify(req) })).json() },
  ledger: (() => {
    let rows = [
      { id: 1, kind: 'param', command: 'Get-ChildItem', token: '-Recursive', fact: 'Get-ChildItem has no parameter -Recursive on this PC. Its real parameters are: -Path, -LiteralPath, -Filter, -Include, -Exclude, -Recurse, -Depth, -Force, -Name, -Attributes, -Directory, -File, -Hidden, -ReadOnly, -System.', count: 3, shown: 2, repeat_after_shown: 0, model: 'gemma-4-26b-a4b', last_seen: Date.now() - 3600e3 },
      { id: 2, kind: 'command', command: 'Get-NetAdapterStats', token: 'Get-NetAdapterStats', fact: 'There is no command named Get-NetAdapterStats on this PC. Commands with similar names that do exist: Get-NetAdapterStatistics (similar name only; check that one does what is needed).', count: 1, shown: 1, repeat_after_shown: 1, model: 'gemma-4-12b', last_seen: Date.now() - 2 * 86400e3 },
    ];
    const stats = () => ({ entries: rows.length, caught: rows.reduce((n, r) => n + r.count, 0), repeats: rows.reduce((n, r) => n + r.count - 1, 0), shown: rows.reduce((n, r) => n + r.shown, 0), repeatsAfterShown: rows.reduce((n, r) => n + r.repeat_after_shown, 0) });
    return { relevant: async () => [], list: async () => ({ rows, stats: stats() }), remove: async id => { rows = rows.filter(r => r.id !== id); return stats(); }, clear: async () => { rows = []; return stats(); } };
  })(),
};
`;
const cmdcheck = require('../cmdcheck');
const { PsCatalog } = require('../pscatalog');
const psCatalog = new PsCatalog();
async function realCheck(md) {
  const lookup = await psCatalog.lookup(cmdcheck.namesToLookUp(md));
  let r = cmdcheck.checkAnswer(md, lookup, []);
  if (r.results.some(x => x.status === 'unknown-command')) r = cmdcheck.checkAnswer(md, lookup, await psCatalog.allNames());
  for (const x of r.results) { x.message = cmdcheck.describe(x); if (x.status === 'bad-params') x.valid = (lookup(x.name)?.params || []).filter(p => !/^(Verbose|Debug|ErrorAction|WarningAction|InformationAction|ErrorVariable|WarningVariable|InformationVariable|OutVariable|OutBuffer|PipelineVariable|ProgressAction|WhatIf|Confirm)$/.test(p)).slice(0, 40); }
  return { ...r, ps: psCatalog.version };
}
http.createServer((req, res) => {
  let url = req.url.split('?')[0]; if (url === '/') url = '/index.html';
  if (url === '/__stub.js') { res.writeHead(200, { 'Content-Type': 'text/javascript' }); return res.end(STUB); }
  if (url === '/__claims' && req.method === 'POST') {
    let body = '';
    req.on('data', d => (body += d));
    req.on('end', () => require('../claimprobe').probe(JSON.parse(body || '{}')).then(
      r => { res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }); res.end(JSON.stringify(r)); },
      e => { res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }); res.end(JSON.stringify({ error: e.message })); }));
    return;
  }
  if (url === '/__cmdcheck' && req.method === 'POST') {
    let body = '';
    req.on('data', d => (body += d));
    req.on('end', () => realCheck(body).then(r => { res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }); res.end(JSON.stringify(r)); },
      e => { res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }); res.end(JSON.stringify({ error: e.message, results: [] })); }));
    return;
  }
  const f = path.resolve(path.join(SRC, url));
  if (!f.startsWith(SRC) || !fs.existsSync(f)) { res.writeHead(404); return res.end('nf'); }
  let body = fs.readFileSync(f);
  if (url === '/index.html') body = Buffer.from(body.toString().replace('<script src="vendor/marked.umd.js">', '<script src="__stub.js"></script><script src="vendor/marked.umd.js">'));
  const type = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }[path.extname(f)] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': type }); res.end(body);
}).listen(5599, '127.0.0.1', () => console.log('ui stub on http://127.0.0.1:5599'));
