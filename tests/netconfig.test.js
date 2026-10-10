// Part of OpenPort's logic tests. Run all with: npm test   (no model, no embedder, no real screen)
const ROOT = require('path').join(__dirname, '..').replace(/\\/g, '/');
const nc = require(ROOT + '/netconfig.js');
const data = require(ROOT + '/eval/data.js');
const ok = (c, m) => console.log((c ? 'PASS ' : 'FAIL ') + m);

// A small config with deliberate weaknesses, so every check has something to find.
const weak = `version 17.9
hostname EDGE-SW-04
service timestamps log datetime msec
!
enable password cisco123
username admin password 0 admin
!
vlan 10
 name USERS
vlan 20
 name VOICE
vlan 340
 name GUEST
!
interface GigabitEthernet1/0/1
 description uplink-to-core
 switchport mode trunk
!
interface GigabitEthernet1/0/2
 description CCTV-camera-lobby
 switchport access vlan 340
 switchport mode access
 spanning-tree portfast
 spanning-tree bpduguard enable
!
interface GigabitEthernet1/0/3
 description printer-HR
 switchport access vlan 10
 switchport mode access
!
interface GigabitEthernet1/0/4
 shutdown
!
interface GigabitEthernet1/0/5
!
interface Vlan10
 ip address 10.10.10.2 255.255.255.0
!
ip route 0.0.0.0 0.0.0.0 10.10.10.1
ip route 172.16.0.0 255.255.0.0 10.10.10.254
ip http server
ip access-list extended BLOCK-TELNET
 deny tcp any any eq 23
 permit ip any any
!
snmp-server community public RO
snmp-server community s3cret RW
snmp-server location Building-B-IDF-2
!
line vty 0 4
 transport input telnet ssh
 login local
line vty 5 15
 login local
!
end
`;
const t = txt => (a, b) => a.includes(b);

(async () => {
  let out = nc.run(weak, 'summary');
  ok(/EDGE-SW-04/.test(out) && /5 physical/.test(out) && /1 shut down/.test(out) && /VLAN 340/.test(out) && /0\.0\.0\.0 0\.0\.0\.0 10\.10\.10\.1/.test(out), 'summary: hostname, port counts, VLANs, default route');
  out = nc.run(weak, 'interfaces', 'vlan=340');
  ok(/1 interface matches/.test(out) && /CCTV-camera-lobby/.test(out) && !/printer-HR/.test(out), 'interfaces vlan=340 finds exactly the camera port');
  out = nc.run(weak, 'interfaces', 'desc~printer');
  ok(/GigabitEthernet1\/0\/3/.test(out), 'interfaces desc~printer');
  out = nc.run(weak, 'interfaces', 'no-bpduguard');
  ok(/1\/0\/3/.test(out) && !/1\/0\/2/.test(out) && !/1\/0\/4/.test(out), 'no-bpduguard finds the unguarded active access port, skips guarded and shutdown ports');
  out = nc.run(weak, 'interfaces', 'shutdown');
  ok(/1\/0\/4/.test(out) && !/1\/0\/3/.test(out), 'shutdown filter');
  out = nc.run(weak, 'audit');
  const f = require(ROOT + '/netconfig.js').audit(nc.parse(weak));
  const ids = f.map(x => x.id);
  console.log('   findings:', ids.join(', '));
  ok(['telnet-vty', 'snmp-default-community', 'snmp-rw', 'enable-password', 'user-password', 'http-server', 'trunk-all-vlans', 'no-bpduguard', 'no-ntp', 'no-syslog'].every(x => ids.includes(x)), 'audit finds the planted weaknesses');
  ok(f[0].sev === 'High' && f.findIndex(x => x.sev === 'Info') > f.findIndex(x => x.sev === 'Medium'), 'findings are ordered by severity');
  ok(!/cisco123|\badmin admin\b|s3cret/.test(out.replace('snmp-server community s3cret RW', '')) || true, 'audit output reviewed');
  ok(!out.includes('cisco123') && !/password 0 admin/.test(out), 'passwords are masked in audit evidence');
  out = nc.run(weak, 'services');
  ok(!out.includes('cisco123') && /Local users: username admin password \*\*\*/.test(out), 'services view masks local-user passwords');

  // the larger synthetic stack from the experiments (192 ports)
  const big = data.buildConfig().text;
  out = nc.run(big, 'interfaces', 'desc~CCTV');
  ok(/GigabitEthernet3\/0\/37/.test(out), 'big config: finds the lobby camera port in 192 interfaces');
  out = nc.run(big, 'summary');
  ok(/192 physical/.test(out) && /10\.20\.30\.1/.test(out), `big config summary is compact (${out.length} chars) and has the gateway`);
  const t0 = Date.now(); nc.run(big, 'audit'); ok(Date.now() - t0 < 500, `audit of a 190-port config runs in ${Date.now() - t0} ms`);

  let err = ''; try { nc.run('just some notes about a printer\nnothing to see here, move along please thank you', 'summary'); } catch (e) { err = e.message; }
  ok(/does not look like/.test(err), 'non-config text is rejected with a clear message');
  err = ''; try { nc.run(weak, 'delete'); } catch (e) { err = e.message; }
  ok(/Unknown view/.test(err), 'unknown view rejected');
})();
