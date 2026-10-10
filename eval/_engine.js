// Shared helper for experiments that need the real chat model: starts llama-server, waits until it is ready, and
// provides a JSON poster. Always call stop() (in a finally). Used by check-logprobs.js and exp-confidence.js.
const { spawn } = require('child_process');
const path = require('path'), http = require('http');
const root = path.join(__dirname, '..');
const models = require(path.join(root, 'models.js'));

async function start({ modelId, backend = 'cpu', ctx = 8192 }) {
  const m = models.listChat(path.join(root, 'models')).find(x => x.id === modelId);
  if (!m) throw new Error('model not found: ' + modelId);
  const port = 58900 + Math.floor(Math.random() * 90);
  const exe = path.join(root, 'engine', backend === 'gpu' ? 'vulkan' : 'cpu', 'llama-server.exe');
  const args = ['-m', m.file, '--host', '127.0.0.1', '--port', String(port), '-c', String(ctx), '--jinja', '--no-webui', '-cram', '1024',
    '-ngl', backend === 'gpu' ? '99' : '0', ...(backend === 'gpu' ? ['-lm', 'none'] : [])];
  const proc = spawn(exe, args, { cwd: path.dirname(exe), windowsHide: true });
  proc.stderr.on('data', () => {}); proc.stdout.on('data', () => {});
  const health = () => new Promise(r => http.get({ host: '127.0.0.1', port, path: '/health' }, x => { x.resume(); r(x.statusCode === 200); }).on('error', () => r(false)));
  for (let i = 0; i < 240; i++) { if (await health()) break; await new Promise(r => setTimeout(r, 1500)); }
  if (!(await health())) { proc.kill(); throw new Error('engine did not become ready'); }
  const post = (p, body, onChunk) => new Promise((res, rej) => {
    const d = JSON.stringify(body);
    const r = http.request({ host: '127.0.0.1', port, path: p, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(d) } }, x => {
      let b = '';
      x.on('data', c => { b += c; onChunk?.(c.toString()); });
      x.on('end', () => (x.statusCode === 200 ? res(b) : rej(new Error(`${x.statusCode} ${b.slice(0, 200)}`))));
    });
    r.on('error', rej); r.write(d); r.end();
  });
  return { port, post, stop: async () => { proc.kill(); await new Promise(r => setTimeout(r, 4000)); } };
}

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const requireYes = what => {
  if (!process.argv.includes('--yes')) { console.log(`${what}\nThis loads the chat model and uses a lot of memory. Re-run with --yes when ready (other apps closed).`); process.exit(1); }
};
module.exports = { start, arg, requireYes };
