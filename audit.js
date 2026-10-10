// Append-only activity log (JSON lines) in data/audit.log. Records WHAT the app did — tool calls, file
// paths touched, model changes, settings changes — never chat text or file contents.
const fs = require('fs');
const path = require('path');

const MAX_BYTES = 5 * 1024 * 1024;
let file = null;

function init(dataDir) { file = path.join(dataDir, 'audit.log'); }

const clip = v => (typeof v === 'string' && v.length > 300 ? v.slice(0, 300) + '…' : v);

function log(event, detail = {}) {
  if (!file) return;
  try {
    if (fs.existsSync(file) && fs.statSync(file).size > MAX_BYTES) fs.renameSync(file, file.replace(/\.log$/, '.1.log'));
    const clean = Object.fromEntries(Object.entries(detail).map(([k, v]) => [k, clip(v)]));
    fs.appendFileSync(file, JSON.stringify({ t: new Date().toISOString(), event, ...clean }) + '\n');
  } catch { /* logging must never break the app */ }
}

function recent(n = 200) {
  if (!file || !fs.existsSync(file)) return [];
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
  return lines.slice(-n).reverse().map(l => { try { return JSON.parse(l); } catch { return { t: '', event: 'unreadable', raw: l.slice(0, 100) }; } });
}

const location = () => file;

module.exports = { init, log, recent, location };
