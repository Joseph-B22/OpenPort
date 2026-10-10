// Deterministic parser + auditor for Cisco IOS / IOS-XE style configs. The model asks questions through the
// network_config tool and gets exact, compact answers computed by code, instead of reading thousands of lines
// and guessing. Read-only: it only analyzes text.
const MAX_ROWS = 60;

function parse(text) {
  const blocks = [];
  let cur = null;
  for (const raw of text.replace(/\r\n/g, '\n').split('\n')) {
    if (!raw.trim() || /^\s*!/.test(raw)) { if (/^!/.test(raw)) cur = null; continue; }
    if (/^\S/.test(raw)) { cur = { header: raw.trim(), children: [] }; blocks.push(cur); }
    else if (cur) cur.children.push(raw.trim());
  }
  const top = blocks.filter(b => !b.children.length).map(b => b.header);   // single-line global commands
  const has = re => blocks.some(b => re.test(b.header));
  const first = re => { const b = blocks.find(x => re.test(x.header)); return b ? b.header : null; };

  const interfaces = blocks.filter(b => /^interface\s+/i.test(b.header)).map(b => {
    const name = b.header.replace(/^interface\s+/i, '');
    const ch = b.children;
    const get = re => { const l = ch.find(x => re.test(x)); return l ? l.match(re)[1] ?? true : null; };
    const trunkVlans = ch.filter(x => /^switchport trunk allowed vlan/i.test(x)).map(x => x.replace(/^switchport trunk allowed vlan\s+(add\s+)?/i, '')).join(',') || null;
    return {
      name, description: get(/^description\s+(.+)/i) || '',
      mode: get(/^switchport mode\s+(\S+)/i), accessVlan: get(/^switchport access vlan\s+(\d+)/i),
      voiceVlan: get(/^switchport voice vlan\s+(\d+)/i), trunkVlans, nativeVlan: get(/^switchport trunk native vlan\s+(\d+)/i),
      shutdown: ch.some(x => /^shutdown$/i.test(x)), ip: get(/^ip address\s+(.+)/i),
      portfast: ch.some(x => /^spanning-tree portfast/i.test(x)), bpduguard: ch.some(x => /^spanning-tree bpduguard enable/i.test(x)),
      portSecurity: ch.some(x => /^switchport port-security$/i.test(x) || /^switchport port-security maximum/i.test(x)),
      channelGroup: get(/^channel-group\s+(\d+)/i), isPhysical: !/^(vlan|loopback|tunnel|port-channel|null)/i.test(name),
      lines: ch,
    };
  });

  const vlans = [];
  for (const b of blocks) {
    const m = b.header.match(/^vlan\s+(\d+)$/i);
    if (m) vlans.push({ id: +m[1], name: (b.children.find(x => /^name\s+/i.test(x)) || '').replace(/^name\s+/i, '') });
  }

  const routes = top.concat(blocks.filter(b => /^ip route /i.test(b.header)).map(b => b.header)).filter((v, i, a) => a.indexOf(v) === i)
    .filter(l => /^ipv?6? route\s+/i.test(l) || /^ip route\s+/i.test(l));

  const acls = [];
  for (const b of blocks) {
    const m = b.header.match(/^ip access-list\s+(standard|extended)\s+(\S+)/i);
    if (m) acls.push({ name: m[2], kind: m[1].toLowerCase(), rules: b.children });
  }
  const numbered = {};
  for (const l of top) { const m = l.match(/^access-list\s+(\d+)\s+(.+)/i); if (m) (numbered[m[1]] ??= []).push(m[2]); }
  for (const [n, rules] of Object.entries(numbered)) acls.push({ name: n, kind: 'numbered', rules });

  const vty = blocks.filter(b => /^line\s+vty/i.test(b.header)).map(b => ({ header: b.header, lines: b.children }));
  const snmp = top.filter(l => /^snmp-server/i.test(l));
  const ntp = top.filter(l => /^ntp server/i.test(l));
  const logging = top.filter(l => /^logging\s+(host\s+)?\d/i.test(l) || /^logging host/i.test(l));
  const users = top.filter(l => /^username\s+/i.test(l));
  const hostname = (first(/^hostname\s+/i) || '').replace(/^hostname\s+/i, '') || null;
  const version = (first(/^version\s+/i) || '').replace(/^version\s+/i, '') || null;
  return { blocks, top, interfaces, vlans, routes, acls, vty, snmp, ntp, logging, users, hostname, version, has, first };
}

// ---- filters for the interfaces view: "vlan=340 mode=trunk desc~camera shutdown no-bpduguard name~Gi3/0" ----
function interfacePredicate(filter) {
  const preds = [];
  for (const tok of (filter || '').split(/[\s,]+/).filter(Boolean)) {
    let m;
    if ((m = tok.match(/^vlan=(\d+)$/i))) preds.push(i => i.accessVlan === m[1] || (i.trunkVlans || '').split(',').some(r => inRange(r, +m[1])));
    else if ((m = tok.match(/^mode=(\w+)$/i))) preds.push(i => (i.mode || '').toLowerCase() === m[1].toLowerCase());
    else if ((m = tok.match(/^desc~(.+)$/i))) preds.push(i => i.description.toLowerCase().includes(m[1].toLowerCase()));
    else if ((m = tok.match(/^name~(.+)$/i))) preds.push(i => i.name.toLowerCase().includes(m[1].toLowerCase()));
    else if (/^shutdown$/i.test(tok)) preds.push(i => i.shutdown);
    else if (/^up$|^enabled$/i.test(tok)) preds.push(i => !i.shutdown);
    else if (/^no-bpduguard$/i.test(tok)) preds.push(i => i.mode === 'access' && !i.bpduguard);
    else if (/^no-portfast$/i.test(tok)) preds.push(i => i.mode === 'access' && !i.portfast);
    else if (/^no-description$/i.test(tok)) preds.push(i => !i.description);
    else if (/^port-security$/i.test(tok)) preds.push(i => i.portSecurity);
  }
  return i => preds.every(p => p(i));
}
function inRange(spec, vlan) {
  const m = spec.trim().match(/^(\d+)(?:-(\d+))?$/);
  return m ? (m[2] ? vlan >= +m[1] && vlan <= +m[2] : vlan === +m[1]) : false;
}

// Community strings are secrets: show them only when they are the well-known defaults.
const maskCommunity = l => l.replace(/(community\s+)(\S+)/i, (m, a, b) => (/^(public|private)$/i.test(b) ? m : `${a}***`));

const rows = (list, fmt) => list.slice(0, MAX_ROWS).map(fmt).join('\n') + (list.length > MAX_ROWS ? `\n… ${list.length - MAX_ROWS} more (narrow the filter)` : '');

function viewSummary(c) {
  const phys = c.interfaces.filter(i => i.isPhysical);
  const byMode = {};
  for (const i of phys) { const k = i.mode || 'unspecified'; byMode[k] = (byMode[k] || 0) + 1; }
  const accessVlans = {};
  for (const i of phys.filter(x => x.mode === 'access' && x.accessVlan)) accessVlans[i.accessVlan] = (accessVlans[i.accessVlan] || 0) + 1;
  const svis = c.interfaces.filter(i => /^vlan/i.test(i.name) && i.ip);
  const def = c.routes.find(r => /\b0\.0\.0\.0\s+0\.0\.0\.0\b/.test(r));
  const trunks = phys.filter(i => i.mode === 'trunk');
  return [
    `Hostname: ${c.hostname ?? '(none)'}${c.version ? ` · version ${c.version}` : ''}`,
    `Interfaces: ${c.interfaces.length} total, ${phys.length} physical (${Object.entries(byMode).map(([k, v]) => `${v} ${k}`).join(', ')}), ${phys.filter(i => i.shutdown).length} shut down`,
    `VLANs defined: ${c.vlans.length ? c.vlans.map(v => `${v.id}${v.name ? ` ${v.name}` : ''}`).join(', ') : 'none'}`,
    `Access ports per VLAN: ${Object.entries(accessVlans).map(([k, v]) => `VLAN ${k}: ${v}`).join(', ') || 'n/a'}`,
    `Trunks: ${trunks.length ? trunks.map(t => `${t.name}${t.description ? ` (${t.description})` : ''} allows ${t.trunkVlans || 'ALL'}`).join('; ') : 'none'}`,
    `SVIs: ${svis.length ? svis.map(s => `${s.name} ${s.ip}`).join('; ') : 'none'}`,
    `Default route: ${def ?? 'none'} · other static routes: ${c.routes.length - (def ? 1 : 0)}`,
    `ACLs: ${c.acls.length ? c.acls.map(a => `${a.name} (${a.rules.length} rules)`).join(', ') : 'none'}`,
    `NTP: ${c.ntp.map(l => l.replace(/^ntp server\s+/i, '')).join(', ') || 'none'} · Logging hosts: ${c.logging.length || 0} · SNMP lines: ${c.snmp.length} · local users: ${c.users.length}`,
  ].join('\n');
}

function viewInterfaces(c, filter) {
  const pred = interfacePredicate(filter);
  const list = c.interfaces.filter(i => i.isPhysical || /^port-channel|^vlan/i.test(i.name)).filter(pred);
  if (!list.length) return `No interfaces match "${filter}". ${c.interfaces.length} interfaces in this config.`;
  const text = rows(list, i => `${i.name} | ${i.mode || (i.ip ? 'routed' : '-')}${i.accessVlan ? ` vlan ${i.accessVlan}` : ''}${i.trunkVlans ? ` allows ${i.trunkVlans}` : ''}${i.shutdown ? ' | SHUTDOWN' : ''}${i.description ? ` | ${i.description}` : ''}${i.ip ? ` | ip ${i.ip}` : ''}`);
  return `${list.length} interface${list.length > 1 ? 's' : ''} match${list.length > 1 ? '' : 'es'}${filter ? ` "${filter}"` : ''}:\n${text}`;
}

const viewVlans = c => c.vlans.length
  ? rows(c.vlans, v => `VLAN ${v.id} ${v.name || '(unnamed)'} · access ports: ${c.interfaces.filter(i => i.accessVlan === String(v.id)).length} · on trunks: ${c.interfaces.filter(i => i.mode === 'trunk' && (!i.trunkVlans || i.trunkVlans.split(',').some(r => inRange(r, v.id)))).length}`)
  : 'No VLANs are defined in this config.';
const viewRoutes = c => c.routes.length ? c.routes.join('\n') : 'No static routes.';
const viewAcls = c => c.acls.length ? c.acls.map(a => `ACL ${a.name} (${a.kind}):\n  ${a.rules.join('\n  ')}`).join('\n') : 'No ACLs.';
function viewServices(c) {
  return [
    `NTP: ${c.ntp.join('; ') || 'none'}`, `Logging: ${c.logging.join('; ') || 'none'}`,
    `SNMP:\n  ${c.snmp.map(maskCommunity).join('\n  ') || 'none'}`,
    `VTY lines:\n  ${c.vty.map(v => `${v.header}: ${v.lines.join(' / ') || '(defaults)'}`).join('\n  ') || 'none'}`,
    `Local users: ${c.users.map(u => u.replace(/(secret|password)\s+\d?\s*\S+/i, '$1 ***')).join('; ') || 'none'}`,
    `Other: ${['service password-encryption', 'aaa new-model', 'ip ssh version 2', 'ip http server', 'ip http secure-server', 'no cdp run', 'lldp run'].map(k => `${k}: ${c.top.concat(c.blocks.map(b => b.header)).some(l => l.toLowerCase() === k) ? 'yes' : 'no'}`).join(', ')}`,
  ].join('\n');
}

// ---- audit: fixed, explainable checks. Each finding carries the evidence so the model can quote it. ----
function audit(c) {
  const all = c.top.concat(c.blocks.map(b => b.header));
  const hasLine = re => all.some(l => re.test(l));
  const f = [];
  const add = (sev, id, title, detail, evidence = []) => f.push({ sev, id, title, detail, evidence: evidence.slice(0, 6), count: evidence.length });

  const telnet = c.vty.filter(v => v.lines.some(l => /^transport input\s+.*\b(telnet|all)\b/i.test(l)));
  if (telnet.length) add('High', 'telnet-vty', 'Telnet is allowed on remote-access lines', 'Telnet sends credentials in clear text. Use "transport input ssh".', telnet.map(v => v.header));
  const vtyNoTransport = c.vty.filter(v => !v.lines.some(l => /^transport input/i.test(l)));
  if (vtyNoTransport.length && !telnet.length) add('Medium', 'vty-default-transport', 'VTY lines do not restrict transport', 'Without "transport input ssh" the platform default applies (often telnet and ssh).', vtyNoTransport.map(v => v.header));

  const comm = c.snmp.filter(l => /^snmp-server community\s+/i.test(l));
  const weak = comm.filter(l => /community\s+(public|private)\b/i.test(l));
  if (weak.length) add('High', 'snmp-default-community', 'SNMP uses a default community string', 'Anyone who knows "public"/"private" can read (or write) device data.', weak);
  const rw = comm.filter(l => /\bRW\b/i.test(l)).map(maskCommunity);
  if (rw.length) add('High', 'snmp-rw', 'SNMP read-write community configured', 'Write access over SNMPv1/v2c is rarely needed and easily abused.', rw);
  if (comm.length && !weak.length && !rw.length) add('Medium', 'snmp-v2c', 'SNMPv1/v2c communities in use', 'Communities are sent in clear text; prefer SNMPv3 with authentication and encryption.', comm.map(maskCommunity));

  const enablePw = c.top.filter(l => /^enable password\s+/i.test(l));
  if (enablePw.length) add('High', 'enable-password', 'Enable password is not a "secret"', '"enable password" is stored reversibly. Use "enable secret".', enablePw.map(l => l.replace(/password\s+\d?\s*\S+/i, 'password ***')));
  const plainUsers = c.users.filter(l => /\bpassword\s+(0\s+)?\S+/i.test(l) && !/\bsecret\b/i.test(l));
  if (plainUsers.length) add('High', 'user-password', 'Local users with reversible passwords', 'Use "secret" (type 8/9) for local accounts.', plainUsers.map(l => l.replace(/password\s+\d?\s*\S+/i, 'password ***')));
  if (!hasLine(/^service password-encryption$/i) && (enablePw.length || plainUsers.length)) add('Medium', 'no-password-encryption', 'service password-encryption is off', 'Other plain-text passwords in the config are not even weakly obscured.', []);

  if (hasLine(/^ip http server$/i)) add('Medium', 'http-server', 'HTTP management server is enabled', 'Unencrypted web management. Disable it, or use "ip http secure-server" only.', ['ip http server']);
  if (c.vty.length && !hasLine(/^ip ssh version 2$/i) && !c.vty.every(v => v.lines.some(l => /^transport input\s+none$/i.test(l)))) add('Low', 'ssh-version', 'SSH version 2 is not forced', 'Add "ip ssh version 2".', []);
  if (!c.ntp.length) add('Low', 'no-ntp', 'No NTP server configured', 'Without time sync, logs from different devices cannot be correlated.', []);
  if (!c.logging.length) add('Low', 'no-syslog', 'No remote logging host', 'Logs only live on the device and are lost on reload.', []);
  if (!hasLine(/^aaa new-model$/i)) add('Info', 'no-aaa', 'AAA is not enabled', 'Centralized authentication (TACACS+/RADIUS) is not configured.', []);
  if (!c.blocks.some(b => /^banner\s+/i.test(b.header))) add('Info', 'no-banner', 'No login banner', 'A legal warning banner is commonly required by policy.', []);

  const phys = c.interfaces.filter(i => i.isPhysical);
  const access = phys.filter(i => i.mode === 'access' && !i.shutdown);
  const noGuard = access.filter(i => !i.bpduguard);
  if (noGuard.length) add('Low', 'no-bpduguard', `${noGuard.length} active access ports lack BPDU guard`, 'A rogue switch plugged into these ports could disturb spanning tree.', noGuard.map(i => i.name));
  const noPf = access.filter(i => !i.portfast);
  if (noPf.length) add('Info', 'no-portfast', `${noPf.length} active access ports lack PortFast`, 'End-device ports will wait for spanning-tree convergence after link-up.', noPf.map(i => i.name));
  const vlan1 = phys.filter(i => (!i.mode || i.mode === 'access') && (!i.accessVlan || i.accessVlan === '1') && !i.shutdown);
  if (vlan1.length) add('Low', 'default-vlan', `${vlan1.length} active ports sit in the default VLAN 1`, 'The default VLAN should not carry user traffic.', vlan1.map(i => i.name));
  const openTrunk = phys.filter(i => i.mode === 'trunk' && !i.trunkVlans);
  if (openTrunk.length) add('Medium', 'trunk-all-vlans', 'Trunks allow every VLAN', 'Limit trunks to the VLANs that need to cross them.', openTrunk.map(i => i.name));
  const nativeDefault = phys.filter(i => i.mode === 'trunk' && (!i.nativeVlan || i.nativeVlan === '1'));
  if (nativeDefault.length) add('Low', 'native-vlan-1', 'Trunks use native VLAN 1', 'Use an unused VLAN as native to reduce VLAN-hopping risk.', nativeDefault.map(i => i.name));
  const idle = phys.filter(i => !i.shutdown && !i.description && !i.mode && !i.ip);
  if (idle.length) add('Low', 'unconfigured-ports', `${idle.length} ports are up with no configuration`, 'Unused ports should be shut down.', idle.map(i => i.name));

  const order = { High: 0, Medium: 1, Low: 2, Info: 3 };
  return f.sort((a, b) => order[a.sev] - order[b.sev]);
}

function viewAudit(c) {
  const f = audit(c);
  if (!f.length) return 'No findings from the built-in checks.';
  const counts = f.reduce((m, x) => ((m[x.sev] = (m[x.sev] || 0) + 1), m), {});
  const head = `Audit of ${c.hostname || 'config'}: ${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(', ')} (rule-based checks, not a full compliance review)`;
  return head + '\n' + f.map(x => `[${x.sev}] ${x.title}\n   why: ${x.detail}${x.evidence.length ? `\n   evidence (${x.count}): ${x.evidence.join(', ')}${x.count > x.evidence.length ? ', …' : ''}` : ''}`).join('\n');
}

const VIEWS = ['summary', 'interfaces', 'vlans', 'routes', 'acls', 'services', 'audit'];

function run(text, view = 'summary', filter = '') {
  if (!/^\s*(version|hostname|interface|!|vlan|ip |service|boot|no )/im.test(text) || text.length < 40) {
    throw new Error('This does not look like a Cisco IOS-style configuration.');
  }
  const c = parse(text);
  switch ((view || 'summary').toLowerCase()) {
    case 'summary': return viewSummary(c);
    case 'interfaces': return viewInterfaces(c, filter);
    case 'vlans': return viewVlans(c);
    case 'routes': return viewRoutes(c);
    case 'acls': return viewAcls(c);
    case 'services': return viewServices(c);
    case 'audit': return viewAudit(c);
    default: throw new Error(`Unknown view "${view}". Use one of: ${VIEWS.join(', ')}.`);
  }
}

module.exports = { parse, run, audit, VIEWS };
