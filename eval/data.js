// Deterministic synthetic test data. Facts ("needles") are planted among look-alike decoys so that
// matching on topic alone is not enough: the retrieved text must contain the exact fact.
function rng(seed) { return () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const pick = (r, a) => a[Math.floor(r() * a.length)];
const int = (r, lo, hi) => lo + Math.floor(r() * (hi - lo + 1));

// ---------- Experiment A: a long chat ----------
const NEEDLES = [
  { fact: 'Heads up, the maintenance window for the core switch stack is Saturday at 02:00 and it will drop the building B uplinks for about 12 minutes.', query: 'when are we taking the core switches down for work?', expect: '02:00' },
  { fact: 'For the nightly backup job we use the service account svc-backup-07, so please do not use the admin one.', query: 'which account does the backup job run as?', expect: 'svc-backup-07' },
  { fact: 'The guest wifi VLAN is 340 and it is isolated from corporate, the DHCP scope is 172.31.40.0/24.', query: 'what subnet does guest wireless hand out?', expect: '172.31.40.0/24' },
  { fact: 'Our NTP source for the warehouse site is 10.44.0.9, not the public pool.', query: 'which time server do warehouse devices sync to?', expect: '10.44.0.9' },
  { fact: 'The printer on floor 3 keeps jamming because tray 2 firmware is v2.4.1, the support case number is SR-88231.', query: "what's the ticket for the third floor printer problem?", expect: 'SR-88231' },
  { fact: 'The VPN concentrator license expires on March 14 and the renewal quote came to $4,860.', query: 'how much is the VPN renewal and when does the license run out?', expect: 'March 14' },
  { fact: 'Firewall admin credentials rotate every 90 days and the last rotation was September 3.', query: 'when did we last change the firewall admin credentials?', expect: 'September 3' },
  { fact: 'The new hire laptop image is called Win11-Std-2026Q3 and it lives on the deployment share DEPLOY02.', query: "what's the OS image name for new employee laptops?", expect: 'Win11-Std-2026Q3' },
  { fact: 'SAN replication to the DR site runs over the 200 Mbps MPLS link and lags about 40 seconds at peak.', query: 'how far behind does disaster recovery storage get?', expect: '40 seconds' },
  { fact: 'Dana Whitfield is the on-call lead for network this week, her cell is 555-0142.', query: 'who is the on-call network person and how do I reach them?', expect: '555-0142' },
  { fact: 'The wiki page for the Exchange migration is wiki/exchange-2026 and the cutover is scheduled for October 19.', query: 'when is the mail system cutover?', expect: 'October 19' },
  { fact: "Switch SW-DALLAS-07 is stuck on IOS-XE 17.6.3 because the 9200L can't take 17.9 until the ROMMON is upgraded.", query: "why can't the Dallas access switch go to the newer firmware?", expect: 'ROMMON' },
];

// Look-alikes: same kind of fact, different values.
const DECOYS = [
  'The maintenance window for the wireless controllers is Sunday at 03:00 and clients roam to the backup controller.',
  'Monitoring polls use the service account svc-mon-02 which only has read access.',
  'The lab VLAN is 410 and the DHCP scope is 172.31.50.0/24, it can reach the internet but not production.',
  'HQ servers sync time from 10.10.0.5 which is the domain controller.',
  'The plotter on floor 1 needs a new fuser, support case number is SR-77410.',
  'The wildcard certificate renews on June 2 and the quote came to $310.',
  'The service account passwords for the database rotate every 180 days, last rotated July 22.',
  'The server image is called Srv2022-Core-Base and it lives on the deployment share DEPLOY01.',
  'Backup replication to the cloud tier runs nightly and lags about 3 hours at worst.',
  'Priya Raman is the on-call lead for servers this week, her cell is 555-0177.',
  'The wiki page for the VPN rollout is wiki/vpn-2025 and it was completed on April 8.',
  'Switch SW-AUSTIN-02 runs IOS-XE 17.9.4 and passed the security scan last month.',
  'The core router pair failed over twice last quarter because of a flapping optic.',
  'We should keep the guest portal splash page under 200 KB so phones load it quickly.',
];

const TOPICS = [
  ['How do I flush the DNS cache on a Windows client?', 'Open an elevated prompt and run ipconfig /flushdns. If the stale record persists, also clear the resolver cache on the DNS server and check the TTL of the record. Long TTLs are the usual reason a change seems to be ignored for hours.'],
  ['Why would a user get a 169.254 address?', 'That is an APIPA address, which means the client could not reach a DHCP server. Check the cable or wireless association, confirm the VLAN, verify the DHCP relay (ip helper-address) on the gateway and look for a full or exhausted scope.'],
  ['What does spanning tree do when a loop appears?', 'Spanning tree elects a root bridge and blocks redundant links so frames cannot circulate forever. Rapid PVST converges in a second or two. Ports facing end devices should use PortFast with BPDU guard so a rogue switch cannot disturb the topology.'],
  ['How can I tell if a VPN tunnel is up on the firewall?', 'Look at the IKE security associations and the IPsec SAs. Phase 1 up with no phase 2 usually means mismatched proxy IDs or transform sets. Packet counters that increase in one direction only point to a routing or NAT problem on the far side.'],
  ['A shared printer prints blank pages, where do I start?', 'Print a test page directly from the printer to separate hardware from driver problems. Then reinstall the driver on one client, check the spooler for stuck jobs, and compare the port settings, since a wrong protocol or port can produce blank output.'],
  ['How do I find which Group Policy is applying a setting?', 'Run gpresult /h report.html on the client and open the report, or use the Group Policy Results wizard. It lists the winning GPO for each setting along with the denied or filtered ones, which makes precedence conflicts easy to see.'],
  ['What is a safe way to patch the hypervisor hosts?', 'Put one host into maintenance mode at a time, let the VMs migrate, apply the update, reboot and verify health before moving to the next. Always keep the cluster below its failover capacity margin and snapshot nothing that is critical during the change.'],
  ['How do I test whether a port is reachable?', 'On Windows use Test-NetConnection with the -Port switch. On Linux use nc -vz. A timeout usually means a firewall drop, while a refused connection means the host answered but nothing is listening on that port.'],
  ['Why is Wi-Fi slow on the third floor?', 'Check channel utilisation and the number of clients per access point first. Overlapping channels, low minimum data rates and sticky clients are common causes. A site survey helps decide whether to lower power or add an access point.'],
  ['How do I read an MFA failure in the logs?', 'Look for the sign-in event and its result code. Conditional access blocks, expired tokens and clock skew each have distinct codes. Time drift on a phone or a server is surprisingly common and fixes itself once time sync is corrected.'],
  ['What causes certificate errors on an internal site?', 'Usually an expired certificate, a name mismatch with the URL, or a missing intermediate. Check the chain with openssl s_client and confirm the clients trust the issuing authority through group policy.'],
  ['How should I size the storage for a new file server?', 'Start from current usage and growth per year, add snapshots and backups overhead, then keep at least twenty percent free. Prefer separate volumes for data and logs and test restore time, not just backup success.'],
  ['What is the quickest way to check disk health on Linux?', 'Run smartctl -a on the device and watch reallocated and pending sector counts. Combine it with dmesg for I/O errors and iostat to see latency. Rising reallocated sectors mean the drive should be replaced soon.'],
  ['How do I trace where a packet is dropped?', 'Use traceroute or tracert to see the last responding hop, then compare against the expected path. Packet captures on both sides help, and firewall logs with the exact source and destination will show an explicit deny if there is one.'],
];

// Builds {turns, needles:[{...needle, turn}]}. Each turn is {role, text}. Needles land in the first ~45% so they
// fall out of any realistic window by the end.
function buildChat({ pairs = 260, seed = 7 } = {}) {
  const r = rng(seed);
  const turns = [];
  const needleAt = new Map();
  NEEDLES.forEach((n, i) => needleAt.set(8 + i * 9 + int(r, 0, 4), n));
  const decoyAt = new Map();
  for (let i = 0; i < 40; i++) decoyAt.set(int(r, 5, pairs - 5), DECOYS[i % DECOYS.length]);
  const needles = [];
  for (let p = 0; p < pairs; p++) {
    let user, assistant;
    if (needleAt.has(p)) {
      const n = needleAt.get(p);
      user = n.fact; assistant = 'Noted, thanks for the details. I will keep that in mind for the rest of this troubleshooting session.';
      needles.push({ ...n, turn: turns.length });
    } else if (decoyAt.has(p)) {
      user = decoyAt.get(p); assistant = 'Understood. That is useful context, tell me if you want me to factor it into the plan.';
    } else {
      const [q, a] = pick(r, TOPICS);
      user = q + (r() < 0.4 ? ` It happens on host ${pick(r, ['SW', 'FW', 'SRV', 'AP'])}-${int(r, 1, 40)}.` : '');
      assistant = a + (r() < 0.5 ? ` In your case with ${int(r, 10, 250)} devices I would start with the logs.` : '');
    }
    turns.push({ role: 'user', text: user }, { role: 'assistant', text: assistant });
  }
  return { turns, needles };
}

// Questions whose answers are NOT in the chat (hard negatives for threshold tuning).
const UNANSWERABLE = [
  'what is the retention period for security camera footage?',
  'which vendor supplies our laptops?',
  'how many licenses of the endpoint protection suite do we own?',
  "what is the CEO's mobile number?",
  'where is the offsite tape storage located?',
  'which ISP provides the backup internet circuit?',
  'what is the password policy minimum length for contractors?',
  'when does the data center lease end?',
  'what is the budget for the next network refresh?',
  'which team owns the ticketing system?',
  'what port does the badge reader controller listen on?',
  'how do I request a new shared mailbox?',
];

// ---------- Experiment B: big files with known answers ----------
function buildConfig(seed = 3) {
  const r = rng(seed);
  const descs = ['user-port', 'AP-floor2', 'voip-phone', 'user-port', 'printer', 'user-port', 'conference-room'];
  let s = 'version 17.9\nhostname STACK-B-IDF2\nservice timestamps log datetime msec\n!\nusername netadmin privilege 15 secret 9 $9$abc123\n!\nvlan 10\n name USERS\nvlan 20\n name VOICE\nvlan 30\n name SERVERS\nvlan 340\n name GUEST\n!\n';
  const marks = { cam: 'GigabitEthernet3/0/37', fw: 'GigabitEthernet1/0/12' };
  for (let m = 1; m <= 4; m++) for (let p = 1; p <= 48; p++) {
    let d = pick(r, descs) + '-' + int(r, 100, 999);
    if (m === 3 && p === 37) d = 'CCTV-camera-lobby';
    if (m === 1 && p === 12) d = 'uplink-to-firewall-FW02';
    s += `interface GigabitEthernet${m}/0/${p}\n description ${d}\n switchport access vlan ${pick(r, [10, 10, 20, 30])}\n switchport mode access\n switchport port-security maximum 3\n spanning-tree portfast\n spanning-tree bpduguard enable\n storm-control broadcast level 5.00\n!\n`;
  }
  s += 'interface Vlan10\n ip address 10.10.10.2 255.255.255.0\n!\nip route 0.0.0.0 0.0.0.0 10.20.30.1\n!\nip access-list extended BLOCK-TELNET\n deny tcp any any eq 23\n permit ip any any\n!\nsnmp-server location Building-B-IDF-2\nsnmp-server community monitor-ro RO\nntp server 10.44.0.9\nlogging host 10.30.0.50\n!\nline vty 0 15\n transport input ssh\n!\nend\n';
  return {
    name: 'Cisco 9200 stack config', text: s,
    qa: [
      { q: 'What is the default gateway of this switch stack?', a: '10.20.30.1' },
      { q: 'Which port has the lobby security camera?', a: 'GigabitEthernet3/0/37' },
      { q: 'Where is this switch physically located according to SNMP?', a: 'Building-B-IDF-2' },
      { q: 'Which NTP server is configured?', a: '10.44.0.9' },
      { q: 'Is telnet blocked anywhere?', a: 'eq 23' },
      { q: 'What is connected to the firewall uplink?', a: 'FW02' },
    ],
  };
}

function buildLog(seed = 5) {
  const r = rng(seed);
  const msgs = ['request completed in %d ms', 'cache hit for key user:%d', 'heartbeat ok from node-%d', 'scheduled job %d finished', 'connection pool size now %d', 'session %d refreshed'];
  const svcs = ['api', 'auth', 'worker', 'scheduler', 'gateway'];
  const events = new Map([
    [900, '2026-10-06 03:12:44 ERROR storage disk quota exceeded for volume vol_finance on host fs-prod-3'],
    [2500, '2026-10-06 09:41:02 WARN certificate for portal.corp.example expires in 6 days'],
    [3600, '2026-10-06 11:05:31 ERROR account lockout for user jmarsh from 10.9.8.7 after 5 failed attempts'],
  ]);
  let s = '';
  for (let i = 0; i < 4200; i++) {
    if (events.has(i)) { s += events.get(i) + '\n'; continue; }
    const t = `2026-10-06 ${String(int(r, 0, 23)).padStart(2, '0')}:${String(int(r, 0, 59)).padStart(2, '0')}:${String(int(r, 0, 59)).padStart(2, '0')}`;
    s += `${t} INFO ${pick(r, svcs)} ${pick(r, msgs).replace('%d', int(r, 1, 9999))}\n`;
  }
  return { name: 'Application log', text: s, qa: [
    { q: 'Which host ran into a disk quota problem?', a: 'fs-prod-3' },
    { q: 'Which certificate is about to expire?', a: 'portal.corp.example' },
    { q: 'Who got locked out and from which address?', a: 'jmarsh' },
  ] };
}

function buildRunbook(seed = 9) {
  const r = rng(seed);
  let s = 'PROJECT FALCON DATA CENTER MIGRATION RUNBOOK\nThis runbook covers moving the billing cluster from the Dallas site to the new Ashburn site.\n\n';
  for (let i = 1; i <= 120; i++) {
    s += `Section ${i}: Server app${i} (10.20.${i % 250}.${(i * 7) % 250}) runs service module-${i}. Cutover step ${i}: drain connections, snapshot the volume, repoint DNS record app${i}.corp.example, verify health check ${i} returns 200 within 90 seconds, then record the result in the migration tracker. ${'Routine verification detail. '.repeat(int(r, 8, 14))}\n\n`;
    if (i === 41) s += 'Change freeze: no production changes are allowed after November 21 until the January review.\n\n';
    if (i === 88) s += 'Storage escalation: the SAN is supported by Contoso Storage under contract CS-5521, call their 24x7 line for controller faults.\n\n';
  }
  s += 'FINAL SECTION: Rollback. If more than 3 services fail health checks, the rollback owner Priya Raman decides to revert DNS to Dallas within 30 minutes.\n';
  return { name: 'Migration runbook', text: s, qa: [
    { q: 'Who decides on rollback?', a: 'Priya Raman' },
    { q: 'When does the change freeze start?', a: 'November 21' },
    { q: 'Who supports the SAN and what is the contract number?', a: 'CS-5521' },
  ] };
}

module.exports = { buildChat, UNANSWERABLE, NEEDLES, buildConfig, buildLog, buildRunbook };
