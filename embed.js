// Runs a small embedding model (CPU-only, so it never competes with the chat model for VRAM)
// and turns text into normalized vectors for memory search.
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const net = require('net');
const os = require('os');
const http = require('http');
const models = require('./models');

let proc = null;
let port = null;
let ready = false;

// Uses the preferred embedding model if installed, otherwise the first one found.
function findModel(modelsDir, preferred) {
  const all = models.listEmbed(modelsDir);
  return all.find(m => m.id === preferred) || all[0] || null;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
    s.on('error', reject);
  });
}

function request(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request({
      host: '127.0.0.1', port, path: urlPath, method, timeout: 60000,
      headers: data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {},
    }, res => {
      let buf = '';
      res.on('data', c => (buf += c));
      res.on('end', () => (res.statusCode === 200 ? resolve(JSON.parse(buf)) : reject(new Error(`embed server ${res.statusCode}: ${buf.slice(0, 200)}`))));
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('embed request timed out')));
    if (data) req.write(data);
    req.end();
  });
}

async function start({ engineDir, modelsDir, preferred }) {
  stop();
  const model = findModel(modelsDir, preferred);
  const exe = path.join(engineDir, 'cpu', 'llama-server.exe');
  if (!model || !fs.existsSync(exe)) return { ready: false, reason: model ? 'cpu engine missing' : 'no embedding model' };

  port = await freePort();
  // Gentle by design: a quarter of the logical cores, small batches, below-normal priority. Embedding is
  // background work and must never saturate the CPU (heavy all-core bursts are what we want to avoid).
  const threads = Math.max(2, Math.floor(os.cpus().length / 4));
  const p = spawn(exe, ['-m', model.file, '--embeddings', '--host', '127.0.0.1', '--port', String(port),
    '-c', '4096', '-b', '2048', '-ub', '2048', '-t', String(threads), '-ngl', '0', '--no-webui'], { cwd: path.dirname(exe), windowsHide: true });
  proc = p;
  try { os.setPriority(p.pid, os.constants.priority.PRIORITY_BELOW_NORMAL); } catch { /* not critical */ }
  p.stdout.on('data', () => {}); p.stderr.on('data', () => {});
  p.on('exit', () => { if (proc === p) { proc = null; ready = false; } });

  for (let i = 0; i < 90 && proc === p; i++) {
    try { await request('GET', '/health'); ready = true; return { ready: true, model: model.id }; }
    catch { await new Promise(r => setTimeout(r, 1000)); }
  }
  return { ready: false, reason: 'embedding server did not start' };
}

function stop() { if (proc) { proc.kill(); proc = null; } ready = false; }
function isReady() { return ready; }

function normalize(v) {
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n) || 1;
  return v.map(x => x / n);
}

// kind: 'query' for what the user types now, 'doc' for stored material (formats per the model card).
// opts.titles: per-text titles for documents (e.g. file names). opts.dims: truncate to 128/256/512
// (the model is trained for this) to shrink storage; vectors are re-normalized.
async function embed(texts, kind, opts = {}) {
  if (!ready) throw new Error('embedding model not running');
  const input = texts.map((t, i) => {
    const clipped = t.slice(0, 5000);                     // must fit the 2048-token batch
    return kind === 'query' ? `task: search result | query: ${clipped}` : `title: ${opts.titles?.[i] || 'none'} | text: ${clipped}`;
  });
  const res = await request('POST', '/v1/embeddings', { input });
  return res.data.sort((a, b) => a.index - b.index)
    .map(d => normalize(opts.dims ? d.embedding.slice(0, opts.dims) : d.embedding));
}

const pid = () => proc?.pid ?? null;
module.exports = { start, stop, isReady, embed, findModel, pid };
