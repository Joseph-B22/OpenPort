// SPEED + MEMORY SHOOTOUT for the installed models and the engine tuning options (tuning.js), on GPU and CPU.
// LOADS EACH MODEL IN TURN and runs it hard for a few minutes: only run with the user's OK, with OpenPort's chat model
// unloaded. Synthetic prompts only (written here); quality uses the built-in starter Model tests, never the user's own data.
//
//   node eval\bench-speed.js --yes                 everything (about 20-30 minutes)
//   node eval\bench-speed.js --yes --only=gpu      only GPU runs     (--only=cpu: only CPU runs)
//   node eval\bench-speed.js --yes --quick         one task per configuration
// Results: data\bench\speed-<time>.json and a table on screen.
const fs = require('fs'), path = require('path'), http = require('http'), net = require('net');
const { spawn } = require('child_process');
const ROOT = path.join(__dirname, '..');
const { tuningArgs } = require(path.join(ROOT, 'tuning.js'));
const { StatsHelper } = require(path.join(ROOT, 'sysstats.js'));
const evals = require(path.join(ROOT, 'evals.js'));

if (!process.argv.includes('--yes')) {
  console.log('This loads every chat model in turn (GPU and CPU) for several minutes. Re-run with --yes when the PC is idle and OpenPort\'s model is unloaded.');
  process.exit(1);
}
const ONLY = (process.argv.find(a => a.startsWith('--only=')) || '').split('=')[1] || 'all';
const QUICK = process.argv.includes('--quick');
const CPU_THREADS = 6;               // not all 8 cores: keeps the sustained CPU load moderate on this PC

// ---------- synthetic tasks ----------
const CONFIG = [
  'hostname BR-SW-01', '!', 'vlan 10', ' name USERS', 'vlan 20', ' name VOICE', 'vlan 30', ' name PRINTERS', 'vlan 99', ' name MGMT', '!',
  ...Array.from({ length: 10 }, (_, i) => [`interface GigabitEthernet1/0/${i + 1}`, ' description user-desk', ' switchport mode access',
    ' switchport access vlan 10', ' switchport voice vlan 20', ' spanning-tree portfast', '!']).flat(),
  'interface GigabitEthernet1/0/47', ' description printer-floor2', ' switchport mode access', ' switchport access vlan 30', '!',
  'interface GigabitEthernet1/0/48', ' description uplink-core', ' switchport mode trunk', ' switchport trunk allowed vlan 10,20,99', '!',
  'interface Vlan99', ' ip address 10.99.0.11 255.255.255.0', '!', 'ip default-gateway 10.99.0.1', 'ntp server 10.99.0.5', 'end',
].join('\n');
const SCRIPT = [
  'param([string]$Path = "C:\\Logs", [int]$Days = 30)', '',
  '$cutoff = (Get-Date).AddDays(-$Days)',
  '$files = Get-ChildItem -Path $Path -Filter *.log -Recurse -File | Where-Object { $_.LastWriteTime -lt $cutoff }',
  '$total = 0',
  'foreach ($f in $files) {', '    $total += $f.Length', '    Remove-Item -Path $f.FullName', '}',
  'Write-Host "Removed $($files.Count) files, $([math]::Round($total / 1MB, 1)) MB"',
].join('\n');
const TASKS = [
  { id: 'chat', label: 'Chat answer', copy: false, max: 350,
    prompt: 'Explain the difference between TCP and UDP to a new help-desk technician. Give two real examples of each. Keep it under 200 words.' },
  { id: 'config', label: 'Fix + return whole config', copy: true, max: 1400,
    prompt: `Printers on Gi1/0/47 are in VLAN 30, but VLAN 30 is missing from the uplink trunk, so they cannot reach the print server. Return the COMPLETE corrected configuration, changing only what is needed. Output only the configuration.\n\n${CONFIG}` },
  { id: 'script', label: 'Edit + return whole script', copy: true, max: 700,
    prompt: `Add a -WhatIf switch parameter to this PowerShell script so it only reports what it would delete. Return the COMPLETE script. Output only the script.\n\n${SCRIPT}` },
];

// ---------- engine control ----------
const freePort = () => new Promise((res, rej) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); s.on('error', rej); });
function post(port, body, timeoutMs = 900000) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request({ host: '127.0.0.1', port, path: '/v1/chat/completions', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }, timeout: timeoutMs }, res => {
      let out = ''; res.on('data', d => (out += d)); res.on('end', () => { try { const j = JSON.parse(out); if (res.statusCode !== 200) reject(new Error(`${res.statusCode} ${out.slice(0, 300)}`)); else resolve(j); } catch (e) { reject(new Error(out.slice(0, 300))); } });
    });
    req.on('error', reject); req.on('timeout', () => req.destroy(new Error('request timed out')));
    req.end(data);
  });
}
async function waitHealthy(port, proc, ms = 600000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (proc.exitCode !== null) throw new Error('engine exited during load');
    const ok = await new Promise(r => http.get({ host: '127.0.0.1', port, path: '/health', timeout: 2000 }, res => { res.resume(); r(res.statusCode === 200); }).on('error', () => r(false)).on('timeout', function () { this.destroy(); r(false); }));
    if (ok) return Date.now() - t0;
    await new Promise(r => setTimeout(r, 1000));
  }
  throw new Error('engine load timed out');
}
async function startEngine(model, backend, tuning, { mmproj = false } = {}) {
  const exe = path.join(ROOT, 'engine', backend, 'llama-server.exe');
  const port = await freePort();
  const args = ['-m', model.file, '--host', '127.0.0.1', '--port', String(port), '-c', '8192', '--jinja', '--no-webui', '-cram', '512',
    '-ngl', backend === 'cpu' ? '0' : '99', ...(backend === 'cpu' ? ['-t', String(CPU_THREADS)] : ['-lm', 'none']),
    ...(mmproj && model.mmproj ? ['--mmproj', model.mmproj] : []), ...tuningArgs(tuning, backend)];
  const proc = spawn(exe, args, { cwd: path.dirname(exe), windowsHide: true });
  let log = '';
  proc.stdout.on('data', d => (log = (log + d).slice(-20000))); proc.stderr.on('data', d => (log = (log + d).slice(-20000)));
  const loadMs = await waitHealthy(port, proc);
  return { proc, port, loadMs, log: () => log, args };
}
async function stopEngine(e) {
  if (!e || e.proc.exitCode !== null) return;
  const gone = new Promise(r => { e.proc.once('exit', r); setTimeout(r, 15000); });
  e.proc.kill(); await gone; await new Promise(r => setTimeout(r, 2000));
}

// ---------- one configuration ----------
const stats = new StatsHelper();
async function runConfig(model, backend, tuning, { tasks, quality }) {
  const name = `${model.id} · ${backend.toUpperCase()} · KV ${tuning.kvCache || 'f16'}${tuning.copyAhead ? ` · copy-ahead ${tuning.copyAheadType}` : ''}`;
  process.stdout.write(`\n${name}\n  loading… `);
  const row = { model: model.id, backend, tuning, name, tasks: {} };
  let e;
  try {
    e = await startEngine(model, backend, tuning);
    row.loadSec = +(e.loadMs / 1000).toFixed(1);
    process.stdout.write(`${row.loadSec} s\n`);
    await post(e.port, { messages: [{ role: 'user', content: 'Say OK.' }], max_tokens: 4, temperature: 0 });   // warm-up
    for (const t of tasks) {
      const r = await post(e.port, { messages: [{ role: 'user', content: t.prompt }], max_tokens: t.max, temperature: 0, cache_prompt: false,
        chat_template_kwargs: { enable_thinking: false } });
      const tm = r.timings || {};
      const out = r.choices?.[0]?.message?.content || '';
      row.tasks[t.id] = { promptTokens: tm.prompt_n, promptTps: tm.prompt_per_second && +tm.prompt_per_second.toFixed(1), outTokens: tm.predicted_n,
        tps: tm.predicted_per_second && +tm.predicted_per_second.toFixed(1), draft: tm.draft_n ?? null, accepted: tm.draft_n_accepted ?? null,
        firstWordSec: tm.prompt_ms != null ? +(tm.prompt_ms / 1000).toFixed(2) : null, output: out };
      const d = row.tasks[t.id];
      console.log(`  ${t.label.padEnd(28)} ${String(d.tps).padStart(6)} tok/s  ${d.outTokens} tokens  first word ${d.firstWordSec}s` +
        (d.draft ? `  drafted ${d.draft}, accepted ${d.accepted} (${Math.round(100 * d.accepted / d.draft)}%)` : ''));
    }
    try {
      const s = await stats.sample([e.proc.pid]);
      const m = s.byPid[e.proc.pid];
      row.ramGB = +(m.ram / 2 ** 30).toFixed(2); row.privateGB = +(m.ramPrivate / 2 ** 30).toFixed(2); row.vramGB = +(m.vram / 2 ** 30).toFixed(2);
      console.log(`  memory: RAM ${row.ramGB} GB (reserved ${row.privateGB} GB), graphics memory ${row.vramGB} GB`);
    } catch { /* not critical */ }
    if (quality) {
      const ask = async messages => { const r = await post(e.port, { messages, max_tokens: 400, temperature: 0, chat_template_kwargs: { enable_thinking: false } }); return { content: r.choices?.[0]?.message?.content || '' }; };
      const run = await evals.runSuite({ cases: evals.STARTER.map((c, i) => ({ id: 's' + i, ...c })), ask, systemPrompt: 'You are a helpful IT assistant. Be concise and exact.', meta: {} });
      row.quality = { passed: run.passed, total: run.total, failed: run.details.filter(d => !d.pass).map(d => d.name) };
      console.log(`  starter Model tests: ${run.passed}/${run.total}${row.quality.failed.length ? ' (missed: ' + row.quality.failed.join(', ') + ')' : ''}`);
    }
  } catch (err) {
    row.error = err.message;
    console.log(`  FAILED: ${err.message}${e ? '\n  engine log: ' + e.log().slice(-600) : ''}`);
  } finally { await stopEngine(e); }
  return row;
}

// ---------- the plan ----------
function models() {
  const dir = path.join(ROOT, 'models');
  const out = [];
  for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!d.isDirectory() || /embed/i.test(d.name)) continue;
    const files = fs.readdirSync(path.join(dir, d.name)).filter(f => f.endsWith('.gguf'));
    const main = files.find(f => !/mmproj/i.test(f)), mm = files.find(f => /mmproj/i.test(f));
    if (main) out.push({ id: d.name, file: path.join(dir, d.name, main), mmproj: mm ? path.join(dir, d.name, mm) : null, gb: +(fs.statSync(path.join(dir, d.name, main)).size / 1e9).toFixed(1) });
  }
  return out.sort((a, b) => b.gb - a.gb);
}

(async () => {
  const all = models();
  console.log('Models:', all.map(m => `${m.id} (${m.gb} GB)`).join(', '));
  const big = all[0];
  const tasksFull = QUICK ? TASKS.slice(1, 2) : TASKS;
  const tasksCpu = QUICK ? TASKS.slice(1, 2) : [TASKS[0], { ...TASKS[2] }];          // CPU: shorter set, keeps the load short
  const base = { kvCache: 'f16', copyAhead: false };
  const plan = [];
  if (ONLY !== 'cpu') {
    plan.push([big, 'vulkan', base, { tasks: tasksFull, quality: true }]);
    plan.push([big, 'vulkan', { kvCache: 'q8_0', copyAhead: false }, { tasks: tasksFull, quality: true }]);
    plan.push([big, 'vulkan', { kvCache: 'f16', copyAhead: true, copyAheadType: 'ngram-mod' }, { tasks: tasksFull, quality: false }]);
    plan.push([big, 'vulkan', { kvCache: 'f16', copyAhead: true, copyAheadType: 'ngram-simple' }, { tasks: tasksFull, quality: false }]);
    for (const m of all.slice(1)) plan.push([m, 'vulkan', base, { tasks: tasksFull, quality: true }]);
  }
  if (ONLY !== 'gpu') {
    const tasksBigCpu = QUICK ? TASKS.slice(1, 2) : [TASKS[0], TASKS[1]];           // the big model also gets the copy-heavy config task
    for (const m of all) plan.push([m, 'cpu', base, { tasks: m === big ? tasksBigCpu : tasksCpu, quality: false }]);
    plan.push([big, 'cpu', { kvCache: 'f16', copyAhead: true, copyAheadType: 'ngram-simple' }, { tasks: tasksBigCpu, quality: false }]);
  }
  const results = [];
  for (const p of plan) results.push(await runConfig(...p));

  // Copy-ahead must not change the answer (greedy decoding): compare outputs with the same model's plain run.
  for (const r of results.filter(x => x.tuning.copyAhead)) {
    const ref = results.find(x => x.model === r.model && x.backend === r.backend && !x.tuning.copyAhead && x.tuning.kvCache === r.tuning.kvCache);
    if (!ref) continue;
    r.sameOutput = Object.fromEntries(Object.keys(r.tasks).map(k => [k, ref.tasks[k] ? ref.tasks[k].output === r.tasks[k].output : null]));
  }
  // vision + copy-ahead: does the engine start and answer with the image projector loaded?
  if (ONLY !== 'cpu' && big.mmproj) {
    process.stdout.write('\nCopy-ahead with vision (mmproj) loaded… ');
    let e;
    try {
      e = await startEngine(big, 'vulkan', { kvCache: 'f16', copyAhead: true, copyAheadType: 'ngram-simple' }, { mmproj: true });
      const r = await post(e.port, { messages: [{ role: 'user', content: `Return this text unchanged:\n${SCRIPT}` }], max_tokens: 300, temperature: 0 });
      const tm = r.timings || {};
      results.push({ visionCopyAhead: { ok: true, tps: tm.predicted_per_second, draft: tm.draft_n ?? null, accepted: tm.draft_n_accepted ?? null, logHint: (e.log().match(/.*(specul|draft|ngram).*/gi) || []).slice(-4) } });
      console.log(`works: ${tm.predicted_per_second?.toFixed(1)} tok/s, drafted ${tm.draft_n ?? '-'}, accepted ${tm.draft_n_accepted ?? '-'}`);
    } catch (err) { results.push({ visionCopyAhead: { ok: false, error: err.message, log: e?.log().slice(-800) } }); console.log('FAILED: ' + err.message); }
    finally { await stopEngine(e); }
  }
  stats.stop();
  const outDir = path.join(ROOT, 'data', 'bench');
  fs.mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, `speed-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(file, JSON.stringify(results.map(r => ({ ...r, tasks: r.tasks && Object.fromEntries(Object.entries(r.tasks).map(([k, v]) => [k, { ...v, output: v.output?.slice(0, 4000) }])) })), null, 2));
  console.log(`\nSaved ${file}`);
})().catch(e => { console.error(e); process.exit(1); });
