// Part of OpenPort's logic tests. Run all with: npm test   (no model, no embedder, no real screen)
// Claim checks: which statements are picked out, how they are judged, values vs. attached files. The last part asks this PC
// (read-only: Get-Service, Get-HotFix, whether C:\Windows exists).
const ROOT = require('path').join(__dirname, '..').replace(/\\/g, '/');
const ok = (c, m) => console.log((c ? 'PASS ' : 'FAIL ') + m);
const C = require(ROOT + '/src/claims.js');

// ---- services ----
const ans = 'The Print Spooler service is running, so printing should work. If the `wuauserv` service is stopped, updates fail. ' +
  'Check the service named W32Time too. Make sure the DNS Client service is set to automatic.\n\n```powershell\nRestart-Service Spooler\nGet-Service -Name BITS\nsc query Dnscache\n```';
const sv = C.extractServices(ans);
const svn = sv.map(s => s.name);
ok(['Print Spooler', 'wuauserv', 'W32Time', 'DNS Client', 'Spooler', 'BITS', 'Dnscache'].every(n => svn.includes(n)), 'services are found in prose ("the X service", "service named X") and in commands (Restart-Service, Get-Service -Name, sc query)');
ok(sv.find(s => s.name === 'Print Spooler').expect === 'running' && sv.find(s => s.name === 'wuauserv').expect === 'stopped' && sv.find(s => s.name === 'Spooler').expect === null,
  'a stated state ("is running", "is stopped") is read from the sentence; an instruction to restart is not a claim');
ok(!C.extractServices('Use the same service. The following service handles it. This service is fine.').length, 'vague phrases ("the same service") are not service names');
ok(C.extractServices('the Print* service').every(s => C.SERVICE_NAME.test(s.name)), 'only safe names are ever sent to Get-Service (no wildcards)');

const f = { found: true, name: 'Spooler', display: 'Print Spooler', status: 'Stopped', start: 'Automatic' };
ok(C.judgeService({ name: 'Print Spooler', expect: 'running' }, f).label === 'differs', '"is running" but stopped here: different');
ok(C.judgeService({ name: 'Print Spooler', expect: 'stopped' }, f).label === 'match', '"is stopped" and stopped here: match');
ok(C.judgeService({ name: 'Spooler', expect: null }, f).label === 'info' && /Print Spooler \(Spooler\) is Stopped, startup Automatic/.test(C.judgeService({ name: 'Spooler' }, f).text), 'no claim: the fact from this PC is shown as information');
ok(C.judgeService({ name: 'FakeSvc' }, { found: false }).label === 'absent', 'a service that does not exist here is "not found" (not "wrong": it may be about another machine)');

// ---- updates ----
const kb = C.extractKbs('KB5034441 is installed on this machine. KB5031356 is missing, so install it. See also KB 5029244.');
ok(kb.map(k => k.id).join() === 'KB5034441,KB5031356,KB5029244' && kb[0].expect === 'installed' && kb[1].expect === 'missing' && kb[2].expect === null, 'KB numbers and their stated state are found');
ok(C.judgeKb(kb[1], { installed: true, date: '2024-01-10' }).label === 'differs', '"missing" but installed here: different (Get-HotFix saying yes is reliable)');
const notListed = C.judgeKb(kb[0], { installed: false });
ok(notListed.label === 'absent' && /not proof/.test(notListed.text), '"installed" but not listed: only "not found", with the caveat that Get-HotFix misses some update types');

// ---- paths ----
const paths = C.extractPaths('Logs are in C:\\ProgramData\\App\\logs\\. Edit C:\\path\\to\\file.txt and %SystemRoot%\\System32\\drivers\\etc\\hosts. Not \\\\server\\share or C:\\Users\\<you>.');
const pp = paths.map(p => p.path);
ok(pp.includes('C:\\ProgramData\\App\\logs') && pp.some(p => p.startsWith('%SystemRoot%')), 'real-looking local paths and %VARIABLE% paths are found');
ok(!pp.some(p => /path\\to|<|server/.test(p)), 'placeholders (C:\\path\\to\\..., <you>) and network paths are not checked');

// ---- values vs. the attached file ----
const cfg = 'interface GigabitEthernet1/0/48\n switchport access vlan 30\n!\ninterface Vlan30\n ip address 10.20.30.1 255.255.255.0\nip default-gateway 10.20.30.254\n';
const answer = 'Port Gi1/0/48 is in VLAN 30 and the SVI is 10.20.30.1. The gateway is 10.20.30.254, and DNS is 10.20.0.53. ' +
  'Gi1/0/12 is a trunk. Your adapter "Ethernet 2" is fine. Use 255.255.255.0 and 8.8.8.8.';
const vals = C.checkValues(answer, [{ name: 'core-switch.cfg', text: cfg }], 'what VLAN is my uplink in?');
const lab = v => vals.find(x => x.mention === v)?.label;
ok(lab('Gi1/0/48') === 'match' && lab('VLAN 30') === 'match' && lab('10.20.30.1') === 'match' && lab('10.20.30.254') === 'match', 'values that are in the file are confirmed (Gi1/0/48 = GigabitEthernet1/0/48)');
ok(lab('10.20.0.53') === 'absent' && lab('Gi1/0/12') === 'absent', 'values that are NOT in the file are flagged (an invented DNS server, a port the file never mentions)');
ok(!vals.some(v => /Ethernet 2|255\.255\.255\.0|8\.8\.8\.8/.test(v.mention)), 'Windows adapter names, netmasks and well-known public resolvers are not judged');
ok(C.checkValues('It is 10.9.9.9', [{ name: 'a', text: '' }], 'is 10.9.9.9 reachable?').length === 0, 'a value the user typed in the question is not flagged');
ok(C.checkValues(answer, [], '').length === 0, 'with no files in the conversation, values are not judged at all');

// ---- one row per real service; "not listed" is never a green match ----
const both = C.toProbe('The Print Spooler service is stopped.\n\n```powershell\nRestart-Service Spooler\n```');
const judged = C.judgeAll(both, { services: [{ q: 'Print Spooler', found: true, name: 'Spooler', display: 'Print Spooler', status: 'Running', start: 'Automatic' }, { q: 'Spooler', found: true, name: 'Spooler', display: 'Print Spooler', status: 'Running', start: 'Automatic' }] });
ok(judged.filter(j => j.kind === 'service').length === 1 && judged[0].label === 'differs' && judged[0].alsoMentions.includes('Spooler'), 'the same service named twice ("Print Spooler" and "Spooler") gives one row, keeping the claim');
ok(C.judgeKb({ id: 'KB1234567', mention: 'KB1234567', expect: 'missing' }, { installed: false }).label === 'info', '"missing" and not listed: consistent, but shown as information, not as a confirmed match');
ok(/^VLAN 30 appears/.test(C.checkValues('Use VLAN 30.', [{ name: 'f', text: 'vlan 30' }])[0].text), 'value wording reads naturally ("VLAN 30 appears in ...")');

const qp = C.toProbe('Use Get-ChildItem on C:\\Logs. Results go to C:\\Reports.');
const qj = C.judgeAll(qp, { paths: [{ path: 'C:\\Logs', exists: false }, { path: 'C:\\Reports', exists: false }] }, 'delete old files in C:\\Logs');
ok(qj.find(j => j.mention === 'C:\\Logs').label === 'info' && /from your question/.test(qj.find(j => j.mention === 'C:\\Logs').text) && qj.find(j => j.mention === 'C:\\Reports').label === 'absent',
  'a missing path YOU named is plain information; a missing path only the model named is still flagged');

// ---- live: this PC ----
(async () => {
  if (process.platform !== 'win32') { console.log('SKIP live claim probe (not Windows)'); return; }
  const P = require(ROOT + '/claimprobe.js');
  try {
    const claims = { services: [{ name: 'EventLog' }, { name: 'Windows Event Log' }, { name: 'NoSuchServiceXyz' }], kbs: [{ id: 'KB0000001' }], paths: [{ path: 'C:\\Windows' }, { path: 'C:\\No-Such-Folder-OpenPort-Test' }, { path: '%SystemRoot%\\System32' }] };
    const facts = await P.probe(claims);
    const s = n => facts.services.find(x => x.q === n);
    ok(s('EventLog').found && s('EventLog').status === 'Running' && s('Windows Event Log').found && s('Windows Event Log').name === 'EventLog', 'live: services are found by name and by display name, with their status');
    ok(s('NoSuchServiceXyz').found === false, 'live: a made-up service is not found');
    ok(facts.kbs[0].installed === false, 'live: a made-up update is not installed');
    const pth = p => facts.paths.find(x => x.path === p);
    ok(pth('C:\\Windows').exists && pth('C:\\Windows').type === 'folder' && pth('C:\\No-Such-Folder-OpenPort-Test').exists === false && pth('%SystemRoot%\\System32').exists, 'live: local paths (and %SystemRoot%) are checked');
  } catch (e) { console.log('SKIP live claim probe: ' + e.message); }
})();
