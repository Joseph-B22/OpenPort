// Read-only lookups for claim checks: service status (Get-Service), installed updates (Get-HotFix) and whether a local path
// exists. Names come from the model's answer, so they are validated (no wildcards, no quotes) and passed to PowerShell only
// as data. Paths are checked only on this PC's FIXED drives: never network shares or mapped drives (that could reach a server).
const fs = require('fs');
const { runPs } = require('./pscatalog');
const { SERVICE_NAME } = require('./src/claims');

const PROBE_PS = `
$ErrorActionPreference = 'SilentlyContinue'
$in = @'
__IN__
'@ | ConvertFrom-Json
$svc = New-Object System.Collections.ArrayList
foreach ($n in @($in.services)) {
  $s = Get-Service -Name $n -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $s) { $s = Get-Service -DisplayName $n -ErrorAction SilentlyContinue | Select-Object -First 1 }
  if ($s) { [void]$svc.Add([pscustomobject]@{ q = $n; found = $true; name = $s.Name; display = $s.DisplayName; status = [string]$s.Status; start = [string]$s.StartType }) }
  else { [void]$svc.Add([pscustomobject]@{ q = $n; found = $false }) }
}
$kbs = New-Object System.Collections.ArrayList
foreach ($k in @($in.kbs)) {
  $h = Get-HotFix -Id $k -ErrorAction SilentlyContinue | Select-Object -First 1
  $d = $null
  if ($h -and $h.InstalledOn) { $d = $h.InstalledOn.ToString('yyyy-MM-dd') }
  [void]$kbs.Add([pscustomobject]@{ q = $k; installed = [bool]$h; date = $d })
}
$fixed = @([System.IO.DriveInfo]::GetDrives() | Where-Object { $_.DriveType -eq 'Fixed' } | ForEach-Object { $_.Name.Substring(0, 1) })
ConvertTo-Json -InputObject ([pscustomobject]@{ services = @($svc); kbs = @($kbs); fixed = $fixed }) -Depth 4 -Compress
`;

// Every service with its state, startup type and the company that made its program file (read-only: Win32_Service plus the
// program file's version information). Used by check_this_pc's list mode.
const LIST_PS = `
$ErrorActionPreference = 'SilentlyContinue'
$co = @{}
$out = New-Object System.Collections.ArrayList
foreach ($s in Get-CimInstance -ClassName Win32_Service) {
  $p = [string]$s.PathName
  $exe = $null
  if ($p -match '^\\s*"([^"]+)"') { $exe = $Matches[1] } elseif ($p -match '^\\s*(.+?\\.exe)\\b') { $exe = $Matches[1] }
  $c = ''
  if ($exe) {
    $exe = [Environment]::ExpandEnvironmentVariables($exe)
    if ($co.ContainsKey($exe)) { $c = $co[$exe] } else { $c = [string](Get-Item -LiteralPath $exe -ErrorAction SilentlyContinue).VersionInfo.CompanyName; $co[$exe] = $c }
  }
  [void]$out.Add([pscustomobject]@{ n = [string]$s.Name; d = [string]$s.DisplayName; s = [string]$s.State; m = [string]$s.StartMode; c = $c })
}
ConvertTo-Json -InputObject ([pscustomobject]@{ list = @($out) }) -Compress
`;
async function listServices() {
  const r = await runPs(LIST_PS, 45000);
  return [].concat(r.list || []);
}
const isMicrosoft = s => /microsoft/i.test(s.c || '');

// Compact text for the model. mode: 'running' | 'third_party' | 'auto_not_running'. Microsoft services are summarised by
// name only (part of Windows, rarely safe to disable); other vendors' services get full detail.
function formatServiceList(all, mode) {
  const line = s => `- ${s.d} (${s.n}): ${s.s}, startup ${s.m}, vendor: ${s.c || 'unknown (no version info)'}`;
  const pick = mode === 'third_party' ? all.filter(s => !isMicrosoft(s))
    : mode === 'auto_not_running' ? all.filter(s => s.m === 'Auto' && s.s !== 'Running')
    : all.filter(s => s.s === 'Running');
  const ms = pick.filter(isMicrosoft), other = pick.filter(s => !isMicrosoft(s));
  const head = mode === 'third_party' ? `Services on this PC NOT made by Microsoft (${other.length} of ${all.length} services):`
    : mode === 'auto_not_running' ? `Services set to start automatically that are NOT running (${pick.length}). Some only run briefly by design ("trigger start"), so not running is not always a fault:`
    : `Running services on this PC: ${pick.length} of ${all.length}.`;
  const parts = [head];
  if (other.length) parts.push(`${mode === 'third_party' ? '' : `From other vendors (${other.length}):\n`}${other.sort((a, b) => a.d.localeCompare(b.d)).map(line).join('\n')}`);
  if (ms.length && mode !== 'third_party') {
    parts.push(mode === 'auto_not_running' ? `Microsoft (${ms.length}):\n${ms.map(line).join('\n')}`
      : `Microsoft / Windows (${ms.length}, names only): ${ms.map(s => s.n).sort().join(', ')}`);
  }
  parts.push('Note: Microsoft services are part of Windows; disabling them can break features or updates. Third-party services belong to installed software: removing or disabling them affects that software. This tool is read-only; any change is the user\'s decision.');
  return parts.join('\n\n');
}

function expandEnv(p) {
  return p.replace(/%(\w+)%/g, (all, name) => {
    const k = Object.keys(process.env).find(x => x.toLowerCase() === name.toLowerCase());
    return k ? process.env[k] : all;
  });
}

// claims: {services:[{name}], kbs:[{id}], paths:[{path}]} (from Claims.toProbe). Returns facts for Claims.judgeAll.
async function probe(claims) {
  const services = (claims.services || []).map(s => s.name).filter(n => SERVICE_NAME.test(n)).slice(0, 10);
  const kbs = (claims.kbs || []).map(k => k.id).filter(id => /^KB\d{6,8}$/i.test(id)).slice(0, 10);
  const paths = (claims.paths || []).map(p => p.path).slice(0, 12);
  if (!services.length && !kbs.length && !paths.length) return { services: [], kbs: [], paths: [] };
  const r = await runPs(PROBE_PS.replace('__IN__', JSON.stringify({ services, kbs })), 30000);
  const fixed = new Set([].concat(r.fixed || []).map(d => String(d).toUpperCase()));
  const pathFacts = paths.map(p => {
    const full = expandEnv(p);
    const m = full.match(/^([A-Za-z]):\\/);
    if (!m || !fixed.has(m[1].toUpperCase()) || full.includes('%')) return { path: p, skipped: true };   // not a local fixed drive
    try { const st = fs.statSync(full); return { path: p, shown: full === p ? p : `${p} (${full})`, exists: true, type: st.isDirectory() ? 'folder' : 'file' }; }
    catch { return { path: p, shown: full === p ? p : `${p} (${full})`, exists: false }; }
  });
  return { services: [].concat(r.services || []), kbs: [].concat(r.kbs || []), paths: pathFacts };
}

module.exports = { probe, expandEnv, listServices, formatServiceList, isMicrosoft };
