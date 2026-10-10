// Asks this computer's own PowerShell which commands exist and what parameters they take, for the command checker.
// Safety: only plain names (letters, digits, - _ .) are ever passed, as data inside a fixed script sent on stdin with
// -NoProfile. Nothing from the model is executed. `Get-Command` may load an INSTALLED module to read its parameters
// (that is how PowerShell works); it never runs the command being looked up.
const { spawn } = require('child_process');
const fs = require('fs');
const { NAME_OK } = require('./cmdcheck');

const LOOKUP_PS = `
$ErrorActionPreference = 'SilentlyContinue'
$ProgressPreference = 'SilentlyContinue'
$names = @'
__NAMES__
'@ | ConvertFrom-Json
$out = New-Object System.Collections.ArrayList
foreach ($n in $names) {
  $c = Get-Command -Name $n -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $c) { [void]$out.Add([pscustomobject]@{ name = $n; found = $false }); continue }
  $r = $c
  if ($c.CommandType -eq 'Alias') { $r = $c.ResolvedCommand; if (-not $r) { $r = Get-Command -Name $c.Definition -ErrorAction SilentlyContinue | Select-Object -First 1 } }
  $p = $null
  if ($r) { $p = $r.Parameters }
  # Provider cmdlets (Get-Content -Raw, Get-ChildItem -File...) have extra "dynamic" parameters that only appear for a path.
  if ($r -and $r.CommandType -eq 'Cmdlet' -and $r.Source -eq 'Microsoft.PowerShell.Management') {
    try { $d = Get-Command -Name $r.Name -ArgumentList 'C:\\' -ErrorAction Stop; if ($d.Parameters) { $p = $d.Parameters } } catch {}
  }
  $params = @(); $aliases = @()
  if ($p) { foreach ($k in $p.Keys) { $params += $k; foreach ($a in $p[$k].Aliases) { $aliases += ($a + '=' + $k) } } }
  $adv = $true
  if ($r -and $r.CommandType -eq 'Function') { $adv = [bool]$r.CmdletBinding }
  [void]$out.Add([pscustomobject]@{ name = $n; found = $true; type = [string]$r.CommandType; resolved = [string]$r.Name; source = [string]$r.Source; params = $params; aliases = $aliases; advanced = $adv })
}
$v = $PSVersionTable.PSVersion.ToString()
ConvertTo-Json -InputObject ([pscustomobject]@{ ps = $v; cmds = @($out) }) -Depth 4 -Compress
`;

const NAMES_PS = `
$ErrorActionPreference = 'SilentlyContinue'
$ProgressPreference = 'SilentlyContinue'
$n = Get-Command -CommandType Cmdlet, Function -ErrorAction SilentlyContinue | Where-Object { $_.Name -match '^[A-Za-z]+-[A-Za-z0-9]+$' } | Select-Object -ExpandProperty Name -Unique
ConvertTo-Json -InputObject ([pscustomobject]@{ ps = $PSVersionTable.PSVersion.ToString(); names = @($n) }) -Compress
`;

function runPs(script, timeoutMs) {
  return new Promise((resolve, reject) => {
    const exe = process.env.SystemRoot ? `${process.env.SystemRoot}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe` : 'powershell.exe';
    const ps = spawn(exe, ['-NoProfile', '-NonInteractive', '-NoLogo', '-Command', '-'], { windowsHide: true });
    let out = '', err = '';
    const timer = setTimeout(() => { ps.kill(); reject(new Error('PowerShell took too long')); }, timeoutMs);
    ps.stdout.on('data', d => (out += d));
    ps.stderr.on('data', d => (err += d));
    ps.on('error', e => { clearTimeout(timer); reject(e); });
    ps.on('close', () => {
      clearTimeout(timer);
      const start = out.indexOf('{');
      try { resolve(JSON.parse(out.slice(start))); } catch { reject(new Error('Could not read PowerShell output' + (err ? ': ' + err.trim().split('\n')[0] : ''))); }
    });
    // "-Command -" reads stdin like typed input: a multi-line statement ends at the first empty line. So the script is sent
    // as ONE block with no empty lines inside, followed by an empty line. (Avoids -EncodedCommand and temp .ps1 files,
    // which endpoint-security tools often flag.)
    const body = script.split(/\r?\n/).filter(l => l.trim()).join('\n');
    ps.stdin.end(`& {\n${body}\n}\n\n`);
  });
}

class PsCatalog {
  // cacheFile: optional JSON file for the list of all command names (slow to build, changes rarely).
  constructor({ cacheFile = null, maxAgeDays = 7 } = {}) {
    Object.assign(this, { cacheFile, maxAgeDays });
    this.info = new Map();          // lower-case name -> info
    this.names = null;
    this.version = null;
  }

  async lookup(names) {
    const want = [...new Set(names.filter(n => NAME_OK.test(n)))].filter(n => !this.info.has(n.toLowerCase()));
    for (let i = 0; i < want.length; i += 40) {
      const batch = want.slice(i, i + 40);
      const r = await runPs(LOOKUP_PS.replace('__NAMES__', JSON.stringify(batch)), 45000);
      this.version = r.ps;
      for (const c of [].concat(r.cmds || [])) {
        this.info.set(String(c.name).toLowerCase(), { ...c, params: [].concat(c.params || []), aliases: [].concat(c.aliases || []) });
      }
    }
    return name => this.info.get(String(name).toLowerCase());
  }

  // Every cmdlet/function name on this PC, for "did you mean". Built once (several seconds), then cached on disk.
  async allNames() {
    if (this.names) return this.names;
    if (this.cacheFile) {
      try {
        const c = JSON.parse(fs.readFileSync(this.cacheFile, 'utf8'));
        if (Date.now() - c.when < this.maxAgeDays * 86400000 && Array.isArray(c.names) && c.names.length) return (this.names = c.names);
      } catch { /* rebuild */ }
    }
    const r = await runPs(NAMES_PS, 90000);
    this.names = [].concat(r.names || []);
    this.version = r.ps;
    if (this.cacheFile) { try { fs.writeFileSync(this.cacheFile, JSON.stringify({ when: Date.now(), ps: r.ps, names: this.names })); } catch { /* not critical */ } }
    return this.names;
  }
}

module.exports = { PsCatalog, runPs };
