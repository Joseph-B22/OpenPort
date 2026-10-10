// CPU MEMORY CHECK: loads the biggest chat model on the CPU engine with different loading options, asks one tiny question,
// and records RAM. Short (about a minute per option) but it does load a ~14 GB model: run only with the user's OK.
//   node eval\bench-cpu-memory.js --yes
const fs = require('fs'), path = require('path'), http = require('http'), net = require('net');
const { spawn } = require('child_process');
const ROOT = path.join(__dirname, '..');
const { StatsHelper } = require(path.join(ROOT, 'sysstats.js'));
if (!process.argv.includes('--yes')) { console.log('Loads the biggest model on CPU a few times. Re-run with --yes.'); process.exit(1); }

const dir = path.join(ROOT, 'models', 'gemma-4-26b-a4b');
const file = path.join(dir, fs.readdirSync(dir).find(f => f.endsWith('.gguf') && !/mmproj/i.test(f)));
const freePort = () => new Promise(r => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const get = (port, p) => new Promise(r => http.get({ host: '127.0.0.1', port, path: p, timeout: 2000 }, res => { res.resume(); r(res.statusCode); }).on('error', () => r(0)).on('timeout', function () { this.destroy(); r(0); }));
const post = (port, body) => new Promise((resolve, reject) => {
  const data = JSON.stringify(body);
  const req = http.request({ host: '127.0.0.1', port, path: '/v1/chat/completions', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } }, res => { let o = ''; res.on('data', d => (o += d)); res.on('end', () => { try { resolve(JSON.parse(o)); } catch { reject(new Error(o.slice(0, 200))); } }); });
  req.on('error', reject); req.end(data);
});
const OPTIONS = [
  { name: 'default (mmap + repack)', args: [] },
  { name: 'no repack (mmap only)', args: ['--no-repack'] },
  ];
(async () => {
  const stats = new StatsHelper();
  const out = [];
  for (const o of OPTIONS) {
    const port = await freePort();
    const exe = path.join(ROOT, 'engine', 'cpu', 'llama-server.exe');
    const t0 = Date.now();
    const proc = spawn(exe, ['-m', file, '--host', '127.0.0.1', '--port', String(port), '-c', '8192', '--jinja', '--no-webui', '-cram', '512', '-ngl', '0', '-t', '6', ...o.args], { cwd: path.dirname(exe), windowsHide: true });
    proc.stderr.on('data', () => {}); proc.stdout.on('data', () => {});
    while ((await get(port, '/health')) !== 200) { if (proc.exitCode !== null) break; await new Promise(r => setTimeout(r, 1000)); }
    const loadSec = (Date.now() - t0) / 1000;
    let tps = null;
    try { const r = await post(port, { messages: [{ role: 'user', content: 'Explain what DNS does in two sentences.' }], max_tokens: 80, temperature: 0 }); tps = r.timings?.predicted_per_second; } catch { /* report memory anyway */ }
    // Reading speed on a long prompt (~1,500 tokens of switch config): what decides "time to first word" with an attached file.
    let readTps = null;
    try {
      const cfg = Array.from({ length: 60 }, (_, i) => `interface GigabitEthernet1/0/${i + 1}\n description desk-${i + 1}\n switchport access vlan ${10 + (i % 4)}\n!`).join('\n');
      const r = await post(port, { messages: [{ role: 'user', content: 'Which VLAN is port 37 in?\n\n' + cfg }], max_tokens: 1, temperature: 0, cache_prompt: false });
      readTps = r.timings?.prompt_per_second; o.promptTokens = r.timings?.prompt_n;
    } catch { /* optional */ }
    const s = await stats.sample([proc.pid]);
    const m = s.byPid[proc.pid];
    const row = { option: o.name, loadSec: +loadSec.toFixed(1), ramGB: +(m.ram / 2 ** 30).toFixed(1), privateGB: +(m.ramPrivate / 2 ** 30).toFixed(1), tps: tps && +tps.toFixed(1), readTps: readTps && +readTps.toFixed(0), promptTokens: o.promptTokens };
    out.push(row);
    console.log(`${row.option.padEnd(30)} load ${row.loadSec}s  RAM ${row.ramGB} GB  reserved ${row.privateGB} GB  ${row.tps} tok/s writing, reads ${row.readTps} tok/s (${row.promptTokens}-token prompt)`);
    const gone = new Promise(r => { proc.once('exit', r); setTimeout(r, 15000); });
    proc.kill(); await gone; await new Promise(r => setTimeout(r, 3000));
  }
  stats.stop();
  fs.writeFileSync(path.join(ROOT, 'data', 'bench', `cpu-memory-${Date.now()}.json`), JSON.stringify(out, null, 2));
})().catch(e => { console.error(e); process.exit(1); });
