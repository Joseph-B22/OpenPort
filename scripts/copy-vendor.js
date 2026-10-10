// Copies browser-ready libs into src/vendor so the UI loads them locally (no CDN, works offline).
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const out = path.join(root, 'src', 'vendor');
fs.mkdirSync(out, { recursive: true });

const files = [
  ['node_modules/marked/lib/marked.umd.js', 'marked.umd.js'],
  ['node_modules/dompurify/dist/purify.min.js', 'purify.min.js'],
];
for (const [from, to] of files) {
  fs.copyFileSync(path.join(root, from), path.join(out, to));
}
console.log('vendor files copied');
