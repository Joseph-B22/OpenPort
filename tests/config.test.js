// Part of OpenPort's logic tests. Run all with: npm test   (no model, no embedder, no real screen)
const ROOT = require('path').join(__dirname, '..').replace(/\\/g, '/');
// Runs the REAL loadConfig() from main.js (extracted from the source) against odd config files. No Electron, no model.
const fs = require('fs'), path = require('path'), os = require('os'), vm = require('vm');
const ok = (c, m) => console.log((c ? 'PASS ' : 'FAIL ') + m);
const src = fs.readFileSync(ROOT + '/main.js', 'utf8');
const fn = src.match(/let configWarned = false;\nfunction loadConfig\(\) \{[\s\S]*?\n\}\n/)[0];
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cfg-'));
const configPath = path.join(dir, 'config.json');
const audits = [];
const DEFAULT_CONFIG = { autoloadModel: true, allowScreenMemory: true, backend: 'auto' };
const ctx = vm.createContext({ fs, configPath, DEFAULT_CONFIG, audit: { log: (e, d) => audits.push(e) } });
vm.runInContext(fn, ctx);                                   // one persistent context, like the real app
const load = () => vm.runInContext('loadConfig()', ctx);

ok(load().allowScreenMemory === true && load().autoloadModel === true, 'no config file: defaults');
fs.writeFileSync(configPath, JSON.stringify({ autoloadModel: false, allowScreenMemory: false }));
ok(load().autoloadModel === false && load().allowScreenMemory === false, 'normal config is read');
fs.writeFileSync(configPath, '\uFEFF' + JSON.stringify({ autoloadModel: false, allowScreenMemory: false }));
let c = load();
ok(c.autoloadModel === false && c.allowScreenMemory === false, 'a config with a byte-order mark (PowerShell/Notepad) is read correctly: allowScreenMemory stays false');
fs.writeFileSync(configPath, '{ "allowScreenMemory": false,, oops');
c = load();
ok(c.allowScreenMemory === false && audits.includes('config_unreadable'), 'a corrupt config does NOT revert screen memory to "allowed", and the problem is logged');
load(); load();
ok(audits.filter(a => a === 'config_unreadable').length === 1, 'the problem is logged once, not on every read');
