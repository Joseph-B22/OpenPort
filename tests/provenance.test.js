// Part of OpenPort's logic tests. Run all with: npm test   (no model, no embedder, no real screen)
// Edit check: an answer that returns your file with changes is compared line by line; changed and MISSING lines are found.
const ROOT = require('path').join(__dirname, '..').replace(/\\/g, '/');
const ok = (c, m) => console.log((c ? 'PASS ' : 'FAIL ') + m);
const P = require(ROOT + '/src/provenance.js');

const cfg = ['hostname BR-SW-01', '!', 'vlan 30', ' name PRINTERS', '!', 'interface GigabitEthernet1/0/47', ' switchport access vlan 30', '!',
  'interface GigabitEthernet1/0/48', ' description uplink-core', ' switchport mode trunk', ' switchport trunk allowed vlan 10,20,99', '!',
  'ntp server 10.99.0.5', 'end'].join('\n');
const src = [{ name: 'BR-SW-01.cfg', text: cfg }];
const fixed = cfg.replace('allowed vlan 10,20,99', 'allowed vlan 10,20,30,99').replace('ntp server 10.99.0.5\n', '');
let r = P.check('Here is the corrected config:\n\n```\n' + fixed + '\n```\n', src);
ok(r.length === 1 && r[0].source === 'BR-SW-01.cfg', 'an answer that returns the file with edits is recognised');
ok(r[0].changed.length === 1 && fixed.split('\n')[r[0].changed[0]].includes('10,20,30,99'), 'exactly the changed line is flagged (the trunk line)');
ok(r[0].missingCount === 1 && r[0].missing[0] === 'ntp server 10.99.0.5', 'a line the model silently dropped is reported as missing');
r = P.check('```\n' + cfg + '\n```', src);
ok(r[0].changed.length === 0 && r[0].missingCount === 0, 'an unchanged copy: nothing changed, nothing missing');
ok(P.check('```\n' + cfg.replace(/\n/g, '\n  ') + '\n```', src)[0].changed.length === 0, 'indentation and spacing differences are not counted as changes');
ok(P.check('```powershell\nGet-Service\nGet-Process\nGet-Date\nGet-Item x\nGet-ChildItem\n```', src).length === 0, 'a new script unrelated to the file is not treated as an edit');
ok(P.check('```\n' + fixed + '\n```', []).length === 0, 'with no files in the conversation nothing is judged');
ok(P.check('```\nvlan 30\nend\n```', src).length === 0, 'tiny snippets (under 5 lines) are not judged');
ok(P.check('Here is the corrected config:\n\n```\n' + fixed + '\n```\n', src)[0].replaced[0].was.includes('allowed vlan 10,20,99'), 'a changed line is paired with the original it replaces (so that original is not "missing")');
const partial = ['interface GigabitEthernet1/0/47', ' switchport access vlan 30', '!', 'interface GigabitEthernet1/0/48', ' description uplink-core', ' switchport mode trunk', ' switchport trunk allowed vlan 10,20,30,99', '!'].join('\n');
r = P.check('```\n' + partial + '\n```', src);
ok(r.length === 1 && r[0].missingCount === 0 && r[0].changed.length === 1, 'returning only the edited section: lines outside that section are not reported as missing');
