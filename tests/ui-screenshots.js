// UI SCREENSHOTS of the preview (fake backend, no model, no engine): sidebar, chats, every dialog, light/dark, narrow, work edition.
// 1) npm run preview   (leave it running)   2) npm run shots   -> PNGs in the ui-screenshots folder
// SHOTS=03,16 npm run shots   re-takes only the named ones. Loads Electron only, never the chat model.
const { app, BrowserWindow, nativeTheme } = require('electron');
const fs = require('fs'), path = require('path');
app.disableHardwareAcceleration();
const out = process.argv.length > 2 && !process.argv[process.argv.length - 1].endsWith('.js') ? process.argv[process.argv.length - 1] : path.join(__dirname, '..', 'ui-screenshots');
fs.mkdirSync(out, { recursive: true });
const BASE = process.env.BASE || 'http://127.0.0.1:5599/';
const sleep = ms => new Promise(r => setTimeout(r, ms));

const openChat = `document.querySelector('.chat-item').click(); await new Promise(r => setTimeout(r, 400));`;
// A made-up answer with one wrong parameter, one invented cmdlet and one not-installed module, checked by the REAL checker.
const CMD_DEMO = `
  addMessage('user', 'Clean up logs older than 30 days in C:\\\\Logs and show me the adapter stats.');
  const md = "Here's a pipeline that finds old logs and removes them (dry run first):\\n\\n\`\`\`powershell\\nGet-ChildItem -Path C:\\\\Logs -Recursive -Filter *.log |\\n  Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-30) } |\\n  Remove-Item -WhatIf\\n\\nGet-NetAdapterStats -Name \\"Ethernet\\"\\nGet-ADUser -Filter * -Properties LastLogonDate\\n\`\`\`\\n\\nRemove \`-WhatIf\` when the list looks right.";
  const v = addMessage('assistant', md);
  const box = document.createElement('div'); v.body.appendChild(box);
  await checkCommandsIn(v.content, box, md);
  els.messages.scrollTop = els.messages.scrollHeight;`;
// A made-up answer about this PC and an attached switch config: claim checks with REAL service/update/path facts from this PC.
const CLAIM_DEMO = `
  const cfg = 'interface GigabitEthernet1/0/48\\n switchport access vlan 30\\n!\\ninterface Vlan30\\n ip address 10.20.30.1 255.255.255.0\\nip default-gateway 10.20.30.254\\n';
  addMessage('user', 'My print jobs are stuck, and which VLAN is the uplink on?  📄 core-switch.cfg');
  const md = "The Print Spooler service is stopped, which is why jobs are stuck. Clear the queue in C:\\\\Windows\\\\System32\\\\spool\\\\PRINTERS and restart it:\\n\\n\`\`\`powershell\\nRestart-Service Spooler\\n\`\`\`\\n\\nIf it keeps failing, KB5034441 is missing on this machine, so install it.\\n\\nIn your config, port Gi1/0/48 is in VLAN 30, its gateway is 10.20.30.254, and DNS is 10.20.0.53.";
  const v = addMessage('assistant', md);
  const box = document.createElement('div'); v.body.appendChild(box);
  await checkClaimsIn(v.content, box, md, { question: 'My print jobs are stuck, and which VLAN is the uplink on?', sources: [{ name: 'core-switch.cfg', text: cfg }] });
  els.messages.scrollTop = els.messages.scrollHeight;`;
// The model returns an attached config with one fix, and silently drops a line: the edit check shows both.
const EDIT_DEMO = `
  const cfg = 'hostname BR-SW-01\\n!\\nvlan 30\\n name PRINTERS\\n!\\ninterface GigabitEthernet1/0/47\\n description printer-floor2\\n switchport access vlan 30\\n!\\ninterface GigabitEthernet1/0/48\\n description uplink-core\\n switchport mode trunk\\n switchport trunk allowed vlan 10,20,99\\n!\\nntp server 10.99.0.5\\nlogging host 10.99.0.20\\nend';
  addMessage('user', 'Printers on Gi1/0/47 cannot reach the print server. Fix the config.  📄 BR-SW-01.cfg');
  const fixed = cfg.replace('allowed vlan 10,20,99', 'allowed vlan 10,20,30,99').replace('logging host 10.99.0.20\\n', '');
  const md = 'VLAN 30 is missing from the uplink trunk, so printer traffic never leaves the switch. Here is the corrected configuration:\\n\\n\`\`\`\\n' + fixed + '\\n\`\`\`';
  const v = addMessage('assistant', md);
  const box = document.createElement('div'); v.body.appendChild(box);
  checkEdits(v.content, box, md, [{ name: 'BR-SW-01.cfg', text: cfg }]);
  els.messages.scrollTop = els.messages.scrollHeight;`;
const shots = [
  { name: '01-start-light', w: 1280, h: 800, theme: 'light', js: '' },
  { name: '02-start-dark', w: 1280, h: 800, theme: 'dark', js: '' },
  { name: '03-chat-light', w: 1280, h: 800, theme: 'light', js: openChat },
  { name: '04-chat-dark', w: 1280, h: 800, theme: 'dark', js: openChat },
  { name: '05-narrow-chat', w: 640, h: 820, theme: 'light', js: openChat },
  { name: '06-narrow-drawer', w: 640, h: 820, theme: 'light', js: `document.getElementById('side-toggle').click(); await new Promise(r => setTimeout(r, 400));` },
  { name: '07-narrow-dark-start', w: 640, h: 820, theme: 'dark', js: '' },
  { name: '08-command-check', w: 1280, h: 800, theme: 'light', js: CMD_DEMO },
  { name: '09-command-check-dark', w: 1280, h: 800, theme: 'dark', js: CMD_DEMO },
  { name: '08d-edit-check', w: 1280, h: 860, theme: 'light', js: EDIT_DEMO },
  { name: '08e-edit-check-dark', w: 1280, h: 860, theme: 'dark', js: EDIT_DEMO },
  { name: '08b-claim-check', w: 1280, h: 860, theme: 'light', js: CLAIM_DEMO },
  { name: '08c-claim-check-dark', w: 1280, h: 860, theme: 'dark', js: CLAIM_DEMO },
  { name: '16b-memory-mistake-log', w: 1280, h: 860, theme: 'light', js: `document.getElementById('open-memory').click(); await new Promise(r => setTimeout(r, 600)); document.getElementById('led-stats').scrollIntoView({ block: 'start' }); document.querySelector('#mem-dlg .dlg-body').scrollTop -= 60; await new Promise(r => setTimeout(r, 200));` },
  { name: '10-settings-appearance', w: 1280, h: 860, theme: 'light', js: `config = await openport.getConfig(); await openSettings(); showSettingsPane('appearance'); await new Promise(r => setTimeout(r, 500));` },
  { name: '11-settings-engine', w: 1280, h: 860, theme: 'light', js: `config = await openport.getConfig(); await openSettings(); showSettingsPane('engine'); await new Promise(r => setTimeout(r, 500));` },
  { name: '11b-settings-checks', w: 1280, h: 860, theme: 'light', js: `config = await openport.getConfig(); await openSettings(); showSettingsPane('checks'); await new Promise(r => setTimeout(r, 500));` },
  { name: '11c-settings-search', w: 1280, h: 860, theme: 'light', js: `config = await openport.getConfig(); await openSettings(); showSettingsPane('appearance'); const q = document.getElementById('set-q'); q.value = 'memory'; q.dispatchEvent(new Event('input')); await new Promise(r => setTimeout(r, 500));` },
  { name: '12-settings-appearance-dark-purple', w: 1280, h: 860, theme: 'dark', js: `applyAppearance({"accent":"purple"}, { save: false, animate: false }); await new Promise(r => setTimeout(r, 150)); config = await openport.getConfig(); await openSettings(); showSettingsPane('appearance'); await new Promise(r => setTimeout(r, 500));` },
  { name: '12b-settings-memory-dark', w: 1280, h: 860, theme: 'dark', js: `config = await openport.getConfig(); await openSettings(); showSettingsPane('memory'); await new Promise(r => setTimeout(r, 500));` },
  { name: '13-models', w: 1280, h: 860, theme: 'light', js: `document.getElementById('open-models').click(); await new Promise(r => setTimeout(r, 600));` },
  { name: '14-models-add-dark', w: 1280, h: 860, theme: 'dark', js: `document.getElementById('open-models').click(); await new Promise(r => setTimeout(r, 400)); document.querySelector('.tab[data-tab="add"]').click(); await new Promise(r => setTimeout(r, 600));` },
  { name: '15-model-tests', w: 1280, h: 860, theme: 'light', js: `document.getElementById('open-tests').click(); await new Promise(r => setTimeout(r, 600));` },
  { name: '16-memory', w: 1280, h: 860, theme: 'light', js: `document.getElementById('open-memory').click(); await new Promise(r => setTimeout(r, 500));` },
  { name: '17-memory-dark', w: 1280, h: 860, theme: 'dark', js: `document.getElementById('open-memory').click(); await new Promise(r => setTimeout(r, 500));` },
  { name: '18-cartridges', w: 1280, h: 860, theme: 'light', js: `document.getElementById('open-cart').click(); await new Promise(r => setTimeout(r, 500));` },
  { name: '19-timeline', w: 1280, h: 860, theme: 'light', js: `document.getElementById('open-timeline').click(); await new Promise(r => setTimeout(r, 600));` },
  { name: '20-context-map', w: 1280, h: 860, theme: 'light', js: openChat + `await new Promise(r => setTimeout(r, 500)); document.getElementById('ctx-meter').click(); await new Promise(r => setTimeout(r, 600));` },
  { name: '21-activity-log', w: 1280, h: 860, theme: 'light', js: `config = await openport.getConfig(); await openSettings(); await new Promise(r => setTimeout(r, 300)); document.getElementById('s-audit').click(); await new Promise(r => setTimeout(r, 600));` },
  { name: '22-narrow-settings', w: 640, h: 860, theme: 'light', js: `config = await openport.getConfig(); await openSettings(); showSettingsPane('appearance'); await new Promise(r => setTimeout(r, 500));` },
  { name: '30-work-start', w: 1280, h: 800, theme: 'light', q: '?work', js: openChat },
  { name: '31-work-settings', w: 1280, h: 860, theme: 'light', q: '?work', js: `config = await openport.getConfig(); await openSettings(); showSettingsPane('screen'); await new Promise(r => setTimeout(r, 500));` },
  { name: '23-palette', w: 1280, h: 800, theme: 'light', js: `openPalette(); await new Promise(r => setTimeout(r, 400));` },
  { name: '24-palette-search-dark', w: 1280, h: 800, theme: 'dark', js: `openPalette(); const q = document.getElementById('pal-q'); q.value = 'theme'; q.dispatchEvent(new Event('input')); await new Promise(r => setTimeout(r, 400));` },
  { name: '25-shortcuts', w: 1280, h: 800, theme: 'dark', js: `document.getElementById('keys-dlg').showModal(); await new Promise(r => setTimeout(r, 400));` },
  { name: '26-start-dark-oled-orange', w: 1280, h: 800, theme: 'dark', js: `applyAppearance({"style":"oled","accent":"orange"}, { save: false, animate: false }); await new Promise(r => setTimeout(r, 150)); ` },
  { name: '27-chat-light-solid-green', w: 1280, h: 800, theme: 'light', js: `applyAppearance({"style":"solid","accent":"green"}, { save: false, animate: false }); await new Promise(r => setTimeout(r, 150)); ` + openChat },
  { name: '28-chat-dark-pink', w: 1280, h: 800, theme: 'dark', js: `applyAppearance({"accent":"pink"}, { save: false, animate: false }); await new Promise(r => setTimeout(r, 150)); ` + openChat },
];

app.whenReady().then(async () => {
  app.on('window-all-closed', () => {});      // keep running between shots
  const report = [];
  const only = process.env.SHOTS ? process.env.SHOTS.split(',') : null;
  for (const s of shots) {
    if (only && !only.some(o => s.name.startsWith(o))) continue;
    nativeTheme.themeSource = s.theme;
    const win = new BrowserWindow({ width: s.w, height: s.h, show: false, useContentSize: true, webPreferences: { sandbox: true, backgroundThrottling: false, offscreen: true } });
    const errors = [];
    win.webContents.on('console-message', (e, level, msg) => { const lv = e.level ?? level; if (lv === 'error' || lv === 3) errors.push(e.message ?? msg); });
    await win.webContents.session.clearStorageData({ storages: ['localstorage'] });   // each shot starts with default appearance
    for (let i = 0; ; i++) { try { await win.loadURL(BASE + (s.q || '')); break; } catch (e) { if (i > 4) throw e; await sleep(800); } }
    await sleep(700);
    try { await win.webContents.executeJavaScript(`(async () => { ${s.js} })()`); } catch (e) { errors.push('setup: ' + e.message); }
    await sleep(350);
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(out, s.name + '.png'), img.toPNG());
    report.push(`${s.name}: ${img.getSize().width}x${img.getSize().height}${errors.length ? '  ERRORS: ' + errors.join(' | ') : ''}`);
    console.log(report[report.length - 1]);
    win.destroy();
  }
  console.log(report.join('\n'));
  app.quit();
});
