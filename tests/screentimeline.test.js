// Part of OpenPort's logic tests. Run all with: npm test   (no model, no embedder, no real screen)
// Screen-memory timeline ("what website was I on?") and the check_this_pc tool definition. Synthetic data only.
const ROOT = require('path').join(__dirname, '..').replace(/\\/g, '/');
const ok = (c, m) => console.log((c ? 'PASS ' : 'FAIL ') + m);
const S = require(ROOT + '/screenmem.js');
const T = require(ROOT + '/tools.js');

const t0 = new Date(2026, 9, 8, 14, 0).getTime(), min = 60000;
const rows = [   // newest first, like the database returns them
  { ts: t0 + 12 * min, process: 'WindowsTerminal', title: 'PS C:\\>', text: 'PS C:\\> ping 10.9.8.7' },
  { ts: t0 + 9 * min, process: 'msedge', title: 'Pull requests - Microsoft Edge', text: 'github.com/acme/repo/pulls\nPull requests' },
  { ts: t0 + 6 * min, process: 'chrome', title: 'Google AI Studio - Google Chrome', text: 'https://aistudio.google.com/prompts/new_chat\nRun settings' },
  { ts: t0 + 3 * min, process: 'chrome', title: 'Google AI Studio - Google Chrome', text: 'aistudio.google.com/prompts\nModel' },
  { ts: t0, process: 'Code', title: 'main.js - OpenPort', text: 'const app = require(electron)' },
];
const all = S.timeline(rows);
ok(all.length === 4 && all[0].process === 'Code' && all[all.length - 1].process === 'WindowsTerminal', 'visits are listed oldest first');
const studio = all.find(v => v.process === 'chrome');
ok(studio.moments === 2 && studio.from === t0 + 3 * min && studio.to === t0 + 6 * min, 'consecutive moments in the same window become one visit with a start and end time');
ok(studio.domains.join() === 'aistudio.google.com', 'the web address is read from the window text (address bar)');
const web = S.timeline(rows, { app: 'browser' });
ok(web.length === 2 && web.every(v => v.kind === 'browser') && web[1].domains[0] === 'github.com', 'app: "browser" lists only browser windows (Edge, Chrome...)');
ok(S.timeline(rows, { app: 'terminal' }).length === 1, 'app: "terminal" lists only consoles');
ok(S.appKind('firefox.exe') === 'browser' && S.appKind('pwsh') === 'terminal' && S.appKind('EXCEL') === 'other', 'program names are classified');
ok(S.domainsIn('See C:\\Windows\\notepad.exe and version 1.2.3').length === 0, 'file names and version numbers are not mistaken for websites');

const pc = T.extraDefinitions.check_this_pc.function;
ok(pc.name === 'check_this_pc' && Object.keys(pc.parameters.properties).sort().join() === 'list_services,paths,services,updates', 'check_this_pc takes only services, updates, paths and a list mode');
ok(pc.parameters.properties.list_services.enum.join() === 'running,third_party,auto_not_running', 'list modes: running, third_party, auto_not_running');

// ---- service lists (synthetic) ----
const P = require(ROOT + '/claimprobe.js');
const svcs = [
  { n: 'Spooler', d: 'Print Spooler', s: 'Running', m: 'Auto', c: 'Microsoft Corporation' },
  { n: 'wuauserv', d: 'Windows Update', s: 'Stopped', m: 'Manual', c: 'Microsoft Corporation' },
  { n: 'AdobeARMservice', d: 'Adobe Acrobat Update Service', s: 'Running', m: 'Auto', c: 'Adobe Inc.' },
  { n: 'TeamViewer', d: 'TeamViewer', s: 'Stopped', m: 'Auto', c: 'TeamViewer Germany GmbH' },
  { n: 'odd', d: 'Odd Service', s: 'Running', m: 'Manual', c: '' },
];
let txt = P.formatServiceList(svcs, 'running');
ok(/Running services on this PC: 3 of 5/.test(txt) && /Adobe Acrobat Update Service \(AdobeARMservice\): Running, startup Auto, vendor: Adobe Inc\./.test(txt) && /names only\): Spooler/.test(txt) && !/TeamViewer/.test(txt),
  'running: other vendors in full, Microsoft by name only, stopped services left out');
ok(/vendor: unknown/.test(txt), 'a service whose program has no version info is shown as "unknown vendor", not hidden');
txt = P.formatServiceList(svcs, 'third_party');
ok(/NOT made by Microsoft \(3 of 5/.test(txt) && /TeamViewer/.test(txt) && !/Print Spooler/.test(txt), 'third_party: every non-Microsoft service, running or not, and no Microsoft ones');
txt = P.formatServiceList(svcs, 'auto_not_running');
ok(/NOT running \(1\)/.test(txt) && /TeamViewer/.test(txt) && /trigger start/.test(txt), 'auto_not_running: automatic but stopped, with the "trigger start" caveat');
ok(/read-only; any change is the user's decision/.test(txt), 'every list reminds the model that the tool changes nothing and changes are the user\'s call');
ok(/read-only/i.test(pc.description) && /cannot change anything/i.test(pc.description), 'its description tells the model it is read-only');
const ssm = T.extraDefinitions.search_screen_memory.function;
ok(ssm.parameters.required.length === 0 && ssm.parameters.properties.app.enum.includes('browser'), 'search_screen_memory: query is optional (timeline) and an app filter exists');
