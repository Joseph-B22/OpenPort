// Memory use of OpenPort's engines (RAM and graphics-card memory), for the small meter in the top bar.
// Efficient by design: ONE PowerShell process is started on first use and kept alive (starting PowerShell costs ~0.3 s of CPU
// each time), and it is only asked when the window is visible. It reads Get-Process and the "GPU Process Memory" counters:
// read-only, nothing is changed. Electron's own processes are measured by Electron (app.getAppMetrics), not here.
const { spawn } = require('child_process');

const SETUP = `
function Get-OPStats([int[]]$ids) {
  $p = @{}
  foreach ($id in $ids) { $x = Get-Process -Id $id -ErrorAction SilentlyContinue; if ($x) { $p["$id"] = @{ ws = $x.WorkingSet64; priv = $x.PrivateMemorySize64 } } }
  $g = @{}; $gt = 0
  try {
    $paths = @($ids | ForEach-Object { "\\GPU Process Memory(pid_$($_)_*)\\Dedicated Usage" }) + '\\GPU Adapter Memory(*)\\Dedicated Usage'
    foreach ($s in (Get-Counter -Counter $paths -ErrorAction SilentlyContinue).CounterSamples) {
      if ($s.Path -like '*gpu adapter memory*') { $gt += $s.CookedValue }
      elseif ($s.InstanceName -match '^pid_(\\d+)_') { $g[$Matches[1]] = [double]$g[$Matches[1]] + $s.CookedValue }
    }
  } catch {}
  '@@' + (ConvertTo-Json -Compress -Depth 3 -InputObject @{ p = $p; g = $g; gt = $gt; cap = $script:OPVramCap })
}
# Size of the largest graphics card's own memory, read once from the driver's registry entry (read-only).
$script:OPVramCap = 0
try {
  Get-ItemProperty 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}\\0*' -Name 'HardwareInformation.qwMemorySize' -ErrorAction SilentlyContinue |
    ForEach-Object { $v = [double]$_.'HardwareInformation.qwMemorySize'; if ($v -gt $script:OPVramCap) { $script:OPVramCap = $v } }
} catch {}
`;

class StatsHelper {
  constructor() { this.proc = null; this.buf = ''; this.waiting = null; }

  start() {
    if (this.proc) return;
    const exe = process.env.SystemRoot ? `${process.env.SystemRoot}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe` : 'powershell.exe';
    const p = spawn(exe, ['-NoProfile', '-NonInteractive', '-NoLogo', '-Command', '-'], { windowsHide: true });
    this.proc = p;
    p.stdout.on('data', d => {
      this.buf += d;
      let i;
      while ((i = this.buf.indexOf('\n')) >= 0) {
        const line = this.buf.slice(0, i).trim(); this.buf = this.buf.slice(i + 1);
        if (line.startsWith('@@') && this.waiting) { const w = this.waiting; this.waiting = null; try { w.resolve(JSON.parse(line.slice(2))); } catch (e) { w.reject(e); } }
      }
    });
    p.on('exit', () => { if (this.proc === p) this.proc = null; if (this.waiting) { this.waiting.reject(new Error('stats helper exited')); this.waiting = null; } });
    p.on('error', () => {});
    // "-Command -" reads typed-style input: the function definition is one block, ended by an empty line.
    p.stdin.write(SETUP.split(/\r?\n/).filter(l => l.trim()).join('\n') + '\n\n');
  }

  // pids: process ids to measure. Returns {byPid: {pid: {ram, ramPrivate, vram}}, vramAll} in bytes, or null if busy/failed.
  async sample(pids, timeoutMs = 8000) {
    if (this.waiting) return null;                                   // previous sample still running: skip, never pile up
    this.start();
    const ids = pids.filter(n => Number.isInteger(n) && n > 0);
    const res = await new Promise((resolve, reject) => {
      this.waiting = { resolve, reject };
      setTimeout(() => { if (this.waiting?.resolve === resolve) { this.waiting = null; reject(new Error('stats timed out')); } }, timeoutMs);
      this.proc.stdin.write(`Get-OPStats @(${ids.length ? ids.join(',') : '0'})\n`);
    });
    const byPid = {};
    for (const id of ids) {
      const p = res.p?.[String(id)];
      byPid[id] = { ram: p ? Number(p.ws) : 0, ramPrivate: p ? Number(p.priv) : 0, vram: Number(res.g?.[String(id)] || 0) };
    }
    return { byPid, vramAll: Number(res.gt || 0), vramCapacity: Number(res.cap || 0) };
  }

  stop() { try { this.proc?.stdin.end('exit\n'); this.proc?.kill(); } catch { /* gone */ } this.proc = null; }
}

module.exports = { StatsHelper };
