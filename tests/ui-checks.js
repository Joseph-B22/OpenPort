// Static safety checks for the interface and the build. Run after ANY change to src/ :   npm run check
//  - every JS file parses
//  - every element id the scripts look up exists in index.html (the most common way a restyle breaks the app)
//  - no inline styles / inline scripts / inline event handlers (the Content-Security-Policy forbids them)
//  - every <script> in index.html exists, and every module main.js requires is in the build list
//  - no garbled characters (a past encoding bug turned emoji into "ðŸ")
const fs = require('fs'), path = require('path');
const { execFileSync } = require('child_process');
const root = path.join(__dirname, '..');
let failures = 0;
const ok = (c, m, detail) => { if (!c) failures++; console.log((c ? 'PASS ' : 'FAIL ') + m + (!c && detail ? '\n       ' + detail : '')); };
const read = f => fs.readFileSync(path.join(root, f), 'utf8');

// 1. syntax
const jsFiles = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (['node_modules', 'dist', 'vendor', '.git', 'data', 'models', 'engine'].includes(e.name)) continue;
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p); else if (e.name.endsWith('.js')) jsFiles.push(p);
  }
})(root);
const bad = [];
for (const f of jsFiles) { try { execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' }); } catch (e) { bad.push(path.relative(root, f) + ': ' + String(e.stderr).split('\n').find(l => /Error/.test(l))); } }
ok(!bad.length, `all ${jsFiles.length} JavaScript files parse`, bad.join('\n       '));

// 2. element ids
const html = read('src/index.html');
const htmlIds = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]));
const srcJs = fs.readdirSync(path.join(root, 'src')).filter(f => f.endsWith('.js')).map(f => ({ f, t: read('src/' + f) }));
const used = new Map();
for (const { f, t } of srcJs) for (const m of t.matchAll(/(?:\$|S)\('([A-Za-z][\w-]*)'\)|getElementById\('([A-Za-z][\w-]*)'\)/g)) used.set(m[1] || m[2], f);
const missing = [...used].filter(([id]) => !htmlIds.has(id));
ok(!missing.length, `all ${used.size} element ids used by the scripts exist in index.html`, missing.map(([id, f]) => `"${id}" (used in ${f}) is missing from index.html`).join('\n       '));

// 3. CSP
const inlineStyle = [...html.matchAll(/\sstyle="/g)].length;
const inlineScript = [...html.matchAll(/<script(?![^>]*\ssrc=)[^>]*>/g)].length;
const inlineHandlers = [...html.matchAll(/\son[a-z]+="/g)].length;
ok(!inlineStyle && !inlineScript && !inlineHandlers, 'index.html has no inline style="", inline <script>, or on*="" handlers (blocked by the CSP)', `style=: ${inlineStyle}, inline scripts: ${inlineScript}, handlers: ${inlineHandlers}`);
const jsInlineStyle = srcJs.filter(({ t }) => /innerHTML\s*=\s*[`'"][^;]*\sstyle=/.test(t)).map(x => x.f);
ok(!jsInlineStyle.length, 'no style="" attributes built into innerHTML strings (also blocked)', jsInlineStyle.join(', '));
const csp = (html.match(/Content-Security-Policy"\s*content="([^"]+)"/) || [])[1] || '';
ok(/script-src 'self'/.test(csp) && /style-src 'self'/.test(csp) && !/unsafe-/.test(csp) && !/https?:\/\/(?!127\.0\.0\.1)/.test(csp), 'the Content-Security-Policy is still strict (self only, no unsafe-*, no outside hosts)', csp);

// 4. scripts and build list
const scripts = [...html.matchAll(/<script src="([^"]+)"/g)].map(m => m[1]);
const noFile = scripts.filter(s => !fs.existsSync(path.join(root, 'src', s)));
ok(!noFile.length, `all ${scripts.length} <script> files referenced by index.html exist`, noFile.join(', '));
const cssLinks = [...html.matchAll(/<link[^>]+href="([^"]+)"/g)].map(m => m[1]);
ok(cssLinks.every(h => !/^https?:/.test(h)), 'no stylesheet or font is loaded from the internet (the app must work offline)', cssLinks.join(', '));
const pkg = read('package.json');
const mainRequires = [...read('main.js').matchAll(/require\('\.\/([\w-]+)'\)/g)].map(m => m[1] + '.js');
const notPackaged = [...new Set(mainRequires)].filter(m => !pkg.includes(m));
ok(!notPackaged.length, 'every module main.js requires is in the build file list', notPackaged.join(', '));

// 5. encoding
const garbled = [...srcJs.map(x => ({ f: 'src/' + x.f, t: x.t })), { f: 'src/index.html', t: html }, { f: 'src/styles.css', t: read('src/styles.css') }, { f: 'main.js', t: read('main.js') }]
  .filter(({ t }) => /ðŸ|â€|âš|Ã—|Â·/.test(t)).map(x => x.f);
ok(!garbled.length, 'no garbled characters (emoji and symbols are intact)', garbled.join(', '));

console.log(failures ? `\n${failures} check(s) failed.` : '\nAll interface checks passed.');
process.exit(failures ? 1 : 0);
