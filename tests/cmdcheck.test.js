// Part of OpenPort's logic tests. Run all with: npm test   (no model, no embedder, no real screen)
// Command checker: finding PowerShell in answers, parsing it, and judging names/parameters. A fake catalog is used for most
// checks; the last section asks this PC's real PowerShell (read-only Get-Command lookups, about a second).
const ROOT = require('path').join(__dirname, '..').replace(/\\/g, '/');
const ok = (c, m) => console.log((c ? 'PASS ' : 'FAIL ') + m);
const C = require(ROOT + '/cmdcheck.js');

// ---- fake catalog ----
const CAT = {
  'get-childitem': { found: true, type: 'Cmdlet', resolved: 'Get-ChildItem', params: ['Path', 'LiteralPath', 'Filter', 'Include', 'Exclude', 'Recurse', 'Depth', 'Force', 'Name', 'File', 'Directory', 'Verbose', 'ErrorAction'], aliases: ['PSPath=LiteralPath', 's=Recurse', 'ad=Directory'] },
  'gci': { found: true, type: 'Alias', resolved: 'Get-ChildItem', params: ['Path', 'Recurse', 'Filter', 'Force', 'File'], aliases: [] },
  'where-object': { found: true, type: 'Cmdlet', resolved: 'Where-Object', params: ['FilterScript', 'Property', 'Value', 'EQ', 'Like', 'Match', 'GT', 'LT'], aliases: [] },
  'foreach-object': { found: true, type: 'Cmdlet', resolved: 'ForEach-Object', params: ['Process', 'Begin', 'End', 'MemberName'], aliases: [] },
  'get-date': { found: true, type: 'Cmdlet', resolved: 'Get-Date', params: ['Date', 'Format', 'UFormat'], aliases: [] },
  'remove-item': { found: true, type: 'Cmdlet', resolved: 'Remove-Item', params: ['Path', 'Recurse', 'Force', 'WhatIf', 'Confirm'], aliases: [] },
  'get-service': { found: true, type: 'Cmdlet', resolved: 'Get-Service', params: ['Name', 'DisplayName', 'DependentServices', 'RequiredServices', 'ComputerName'], aliases: [] },
  'set-service': { found: true, type: 'Cmdlet', resolved: 'Set-Service', params: ['Name', 'StartupType', 'Status', 'DisplayName'], aliases: [] },
  'get-netadapter': { found: true, type: 'Function', advanced: true, resolved: 'Get-NetAdapter', params: ['Name', 'InterfaceDescription', 'Physical'], aliases: [] },
  'write-host': { found: true, type: 'Cmdlet', resolved: 'Write-Host', params: ['Object', 'ForegroundColor', 'BackgroundColor', 'NoNewline'], aliases: [] },
  'ipconfig': { found: true, type: 'Application', resolved: 'ipconfig.exe', params: [], aliases: [] },
  'my-oldfunc': { found: true, type: 'Function', advanced: false, resolved: 'My-OldFunc', params: [], aliases: [] },
};
const lookup = n => CAT[n.toLowerCase()] || { name: n, found: false };
const ALL = ['Get-ChildItem', 'Get-NetAdapter', 'Get-NetAdapterStatistics', 'Get-NetIPAddress', 'Get-Service', 'Set-Service', 'Restart-Service', 'Get-Date', 'Write-Host'];
const run = md => C.checkAnswer(md, lookup, ALL);
const byName = (r, n) => r.results.find(x => x.name.toLowerCase() === n.toLowerCase());

// ---- finding PowerShell in an answer ----
const md = 'Run:\n\n```powershell\nGet-Service DNS\n```\n\nOn Linux:\n\n```bash\nls -la | grep foo\n```\n\nOn the switch:\n\n```\nshow vlan brief\n```\n\n' +
  'Untagged:\n\n```\nGet-ChildItem C:\\Logs -Recurse\n```\n\nAlso `Get-Date -Format o` and `ls -la` and `C:\\Windows`.';
const pieces = C.extractPowerShell(md);
ok(pieces.length === 3 && pieces.some(p => p.text.includes('Get-Service')) && pieces.some(p => p.text.includes('Get-ChildItem')) && pieces.some(p => p.kind === 'inline' && p.text.startsWith('Get-Date')),
  'finds powershell blocks, untagged blocks that look like PowerShell, and inline Verb-Noun code');
ok(!pieces.some(p => /grep|show vlan|ls -la/.test(p.text)), 'ignores bash, Cisco and inline non-PowerShell code');

// ---- parsing ----
const names = s => C.parseCommands(s).calls.map(c => c.name);
ok(names('Get-ChildItem -Path C:\\x | Where-Object { $_.Length -gt 1MB } | ForEach-Object { Write-Host $_.Name }').join() === 'Get-ChildItem,Where-Object,Write-Host,ForEach-Object' ||
   names('Get-ChildItem -Path C:\\x | Where-Object { $_.Length -gt 1MB } | ForEach-Object { Write-Host $_.Name }').sort().join() === ['ForEach-Object', 'Get-ChildItem', 'Where-Object', 'Write-Host'].sort().join(),
  'pipelines and commands inside script blocks are all found');
ok(names('$d = (Get-Date).AddDays(-30)\n$s = Get-Service -Name DNS').sort().join() === 'Get-Date,Get-Service', 'assignments and sub-expressions: the command is found, the variable is not');
ok(names('if (-not (Test-Path $p)) { New-Item -Path $p -ItemType Directory }\nforeach ($f in $files) { Remove-Item $f }').sort().join() === 'New-Item,Remove-Item,Test-Path', 'keywords (if, foreach, -not) are not commands; what they contain is');
ok(names('$h = @{ Name = "x"; Expression = { Get-Date } }').join() === 'Get-Date', 'hashtable keys are not commands, but commands inside their values are');
ok(names('Write-Host "Run Fake-Command -Bogus now"\n# Fake-Comment -X\n<# Fake-Block #>').join() === 'Write-Host', 'strings and comments are ignored');
ok(names("$t = @'\nFake-InHereString -X\n'@\nGet-Date").join() === 'Get-Date', 'here-strings are ignored');
ok(C.parseCommands('Get-ChildItem `\n  -Path C:\\x `\n  -Recurse').calls[0].params.map(p => p.name).join() === 'Path,Recurse', 'backtick line continuation keeps parameters with their command');
ok(names('gci -rec | % { $_.FullName } | ? { $_ }').sort().join() === 'ForEach-Object,Where-Object,gci', '% and ? are understood as ForEach-Object and Where-Object');
ok(names('[System.IO.File]::ReadAllText($p)\n.\\setup.ps1 -Quiet\n& $exe /s\n$x.Method()').length === 0, 'type calls, script paths, call operator and method calls are not looked up');
ok(names('param([string]$Path)\nfunction Get-Thing { [CmdletBinding()] param($A) }').every(n => n !== 'param'), 'param blocks are not commands');
ok(C.parseCommands('Set-Service -Name x -StartupType:Disabled -WhatIf:$false').calls[0].params.map(p => p.name).join() === 'Name,StartupType,WhatIf', '-Param:value form is read as the parameter name');
ok(C.parseCommands('Get-Date -Format "yyyy -MM -dd" -1').calls[0].params.map(p => p.name).join() === 'Format', 'dashes inside strings and negative numbers are not parameters');

// ---- checking ----
let r = run('```powershell\nGet-ChildItem -Path C:\\Logs -Recursive -Filter *.log\n```');
let x = byName(r, 'Get-ChildItem');
ok(x.status === 'bad-params' && x.bad[0].param === '-Recursive' && x.bad[0].suggest[0] === 'Recurse', 'an invented parameter is caught and the real one suggested (-Recursive -> -Recurse)');
ok(/has no parameter "-Recursive" \(did you mean -Recurse\?\)/.test(C.describe(x)), '...in plain words');
r = run('```powershell\nGet-ChildItem -Rec -s -PSPath x -filt *.log\n```');
ok(byName(r, 'Get-ChildItem').status === 'ok', 'unambiguous short forms (-Rec) and parameter aliases (-s, -PSPath) are accepted, as PowerShell does');
r = run('```powershell\nGet-ChildItem -F x\n```');
x = byName(r, 'Get-ChildItem');
ok(x.status === 'bad-params' && x.bad[0].why === 'ambiguous' && x.bad[0].options.length >= 3, 'an ambiguous short form (-F: Filter, Force, File) is flagged, as PowerShell would refuse it');
r = run('```powershell\n$s = Get-NetAdapterStats -Name Ethernet\n```');
x = byName(r, 'Get-NetAdapterStats');
ok(x.status === 'unknown-command' && x.suggest[0] === 'Get-NetAdapterStatistics', 'an invented command is caught and the closest real one suggested');
r = run('```powershell\nGet-ADUser -Filter *\nGet-MgUser -All\n```');
ok(byName(r, 'Get-ADUser').status === 'not-installed' && /ActiveDirectory/.test(byName(r, 'Get-ADUser').module) && byName(r, 'Get-MgUser').status === 'not-installed', 'commands from known modules that are not installed are "can\'t verify here", not "invented"');
ok(r.problems === 0 && r.notInstalled === 2, '...and are not counted as problems');
r = run('```powershell\nipconfig /all\nMy-OldFunc -Anything 1\n```');
ok(byName(r, 'ipconfig').status === 'program' && byName(r, 'My-OldFunc').status === 'ok', 'programs (ipconfig) pass; simple functions that accept any argument are not judged on parameters');
r = run('```powershell\nfunction Invoke-Cleanup { param($Days) }\nInvoke-Cleanup -Days 30\n```');
ok(byName(r, 'Invoke-Cleanup').status === 'defined-here' && r.problems === 0, 'a function the answer defines itself counts as existing');
r = run('```powershell\nGet-Service -Name DNS | Set-Service -StartupType Automatic\nWhere-Object Status -EQ Running\n```');
ok(r.problems === 0 && r.checked === 3, 'a correct answer has no problems');

// ---- an answer repeating the same pipeline counts each command once ----
const twice = '```powershell\nGet-ChildItem -Path C:\\x -Recurse | Remove-Item\n```\n\n```powershell\nGet-ChildItem -Path C:\\x -Recurse | Remove-Item -WhatIf\n```\n\n- `Get-ChildItem -Path C:\\x`: looks in the folder\n- `Remove-Item`: deletes';
r = run(twice);
ok(r.checked === 2 && r.results.length === 6, 'the same commands shown three times are counted once each ("2 commands checked", not 6)');
r = run('```powershell\nGet-ChildItem -Recursive\n```\n\nAgain: `Get-ChildItem -Recursive`');
ok(r.problems === 1, 'the same mistake shown twice counts as one problem');

// ---- names sent to PowerShell are always plain ----
const sent = C.namesToLookUp('```powershell\nGet-Date\n& "C:\\evil.exe"\n$(Remove-Item C:\\ -Recurse)\nGet-Item *\nInvoke-Expression $x\n```');
ok(sent.every(n => C.NAME_OK.test(n)) && sent.includes('Remove-Item') && !sent.some(n => /[\\*"$&]/.test(n)), 'only plain names are ever looked up (no paths, quotes, wildcards or variables)');

// ---- the real PowerShell on this PC ----
(async () => {
  if (process.platform !== 'win32') { console.log('SKIP live PowerShell check (not Windows)'); return; }
  const { PsCatalog } = require(ROOT + '/pscatalog.js');
  try {
    const cat = new PsCatalog();
    const live = '```powershell\nGet-ChildItem -Path C:\\Windows -Recursive -Filter *.log\nGet-Content .\\a.log -Tail 5 -Raw\ngci -rec\nGet-NetAdapterStats\nGet-Service -Name Spooler\n```';
    const lk = await cat.lookup(C.namesToLookUp(live));
    const res = C.checkAnswer(live, lk, ['Get-NetAdapterStatistics']);
    const g = n => res.results.find(x => x.name === n);
    ok(g('Get-ChildItem').status === 'bad-params' && g('Get-ChildItem').bad.map(b => b.param).join() === '-Recursive', 'live: real PowerShell knows -Recurse/-Filter/-Path and rejects -Recursive');
    ok(g('Get-Content').status === 'ok', 'live: provider-only parameters (-Tail, -Raw on Get-Content) are known');
    ok(g('gci').status === 'ok' && g('Get-Service').status === 'ok', 'live: aliases and normal cmdlets pass');
    ok(g('Get-NetAdapterStats').status === 'unknown-command', 'live: an invented cmdlet is not found');
  } catch (e) { console.log('SKIP live PowerShell check: ' + e.message); }
})();
