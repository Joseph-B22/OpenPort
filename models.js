// Filesystem side of model management: scan, delete, import. Layout:
//   models/<name>/*.gguf (+ mmproj*.gguf)            chat models (vision if an mmproj is present)
//   models/embeddings/<name>/*.gguf                  embedding models (memory search)
const fs = require('fs');
const path = require('path');

const isMmproj = f => /^mmproj/i.test(f);
const isGguf = f => /\.gguf$/i.test(f);
const safeName = s => s.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'model';

function inspect(dir, id, kind) {
  const files = fs.readdirSync(dir).filter(isGguf).sort();
  const weights = files.filter(f => !isMmproj(f));
  if (!weights.length) return null;
  // Sharded models ("-00001-of-00004") load from the first shard; llama.cpp finds the rest.
  const first = weights.find(f => /-0*1-of-\d+\.gguf$/i.test(f)) || weights[0];
  const mm = files.find(isMmproj);
  const bytes = files.reduce((n, f) => n + fs.statSync(path.join(dir, f)).size, 0);
  return {
    id, kind, dir,
    file: path.join(dir, first),
    mmproj: mm ? path.join(dir, mm) : null,
    sizeGB: (bytes / 1e9).toFixed(1),
    bytes,
  };
}

function scan(root, kind) {
  if (!fs.existsSync(root)) return [];
  const out = [];
  for (const d of fs.readdirSync(root, { withFileTypes: true })) {
    if (!d.isDirectory() || (kind === 'chat' && d.name === 'embeddings')) continue;
    try { const m = inspect(path.join(root, d.name), d.name, kind); if (m) out.push(m); } catch { /* unreadable folder */ }
  }
  return out;
}

const listChat = modelsDir => scan(modelsDir, 'chat');
const listEmbed = modelsDir => scan(path.join(modelsDir, 'embeddings'), 'embed');
const listAll = modelsDir => [...listChat(modelsDir), ...listEmbed(modelsDir)];

function dirFor(modelsDir, kind, id) {
  const base = kind === 'embed' ? path.join(modelsDir, 'embeddings') : modelsDir;
  const dir = path.resolve(base, id);
  // Never delete or write outside the models folder.
  if (!dir.startsWith(path.resolve(modelsDir) + path.sep) || dir === path.resolve(base)) throw new Error('Invalid model id');
  return dir;
}

function remove(modelsDir, kind, id) {
  fs.rmSync(dirFor(modelsDir, kind, id), { recursive: true, force: true });
}

function uniqueId(modelsDir, kind, wanted) {
  const base = safeName(wanted);
  let id = base, n = 2;
  while (fs.existsSync(dirFor(modelsDir, kind, id))) id = `${base}-${n++}`;
  return id;
}

function freeBytes(dir) {
  try { fs.mkdirSync(dir, { recursive: true }); const s = fs.statfsSync(dir); return s.bavail * s.bsize; }
  catch { return null; }
}

// Copies user-picked .gguf files into a fresh model folder. onProgress(received, total, file).
async function importFiles(modelsDir, kind, files, onProgress) {
  const ggufs = files.filter(isGguf);
  if (!ggufs.length) throw new Error('Pick at least one .gguf file.');
  const main = ggufs.find(f => !isMmproj(path.basename(f))) || ggufs[0];
  const id = uniqueId(modelsDir, kind, path.basename(main).replace(/\.gguf$/i, '').replace(/-0*1-of-\d+$/i, ''));
  const dest = dirFor(modelsDir, kind, id);
  const total = ggufs.reduce((n, f) => n + fs.statSync(f).size, 0);
  const free = freeBytes(modelsDir);
  if (free !== null && total > free) throw new Error(`Not enough disk space (${(total / 1e9).toFixed(1)} GB needed, ${(free / 1e9).toFixed(1)} GB free).`);

  fs.mkdirSync(dest, { recursive: true });
  let done = 0;
  try {
    for (const src of ggufs) {
      const target = path.join(dest, path.basename(src));
      await new Promise((resolve, reject) => {
        const rs = fs.createReadStream(src);
        const ws = fs.createWriteStream(target);
        rs.on('data', c => { done += c.length; onProgress?.(done, total, path.basename(src)); });
        rs.on('error', reject); ws.on('error', reject); ws.on('finish', resolve);
        rs.pipe(ws);
      });
    }
  } catch (e) {
    fs.rmSync(dest, { recursive: true, force: true });
    throw e;
  }
  return id;
}

module.exports = { listChat, listEmbed, listAll, remove, importFiles, uniqueId, dirFor, freeBytes, safeName, isMmproj, isGguf };
