// Builds the semantic search index over the user-approved folders. Incremental: only files whose
// modified time changed are re-read. Everything stays on this machine (vectors live in data/chats.db).
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { extractText, isDocument } = require('./extract');

const TEXT_EXTS = new Set(['.txt', '.md', '.log', '.cfg', '.conf', '.ini', '.json', '.yaml', '.yml', '.xml', '.csv', '.toml', '.tf',
  '.ps1', '.psm1', '.bat', '.cmd', '.sh', '.py', '.js', '.mjs', '.ts', '.tsx', '.jsx', '.java', '.cs', '.cpp', '.c', '.h', '.hpp',
  '.go', '.rs', '.rb', '.php', '.sql', '.html', '.css', '.j2', '.rst', '.properties', '.gradle', '.vb', '.swift', '.kt']);
const SKIP_DIRS = new Set(['node_modules', '.git', '.svn', '$recycle.bin', 'system volume information', 'dist', 'build', '__pycache__', '.venv', 'venv']);
const SKIP_FILES = /(^|[\\/])(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|.*\.min\.(js|css))$/i;
const MAX_FILES = 5000, MAX_TEXT_BYTES = 2 * 1024 * 1024;
const CHUNK = 1000, OVERLAP_LINES = 2, BATCH = 16, DIMS = 256;

// Line-aware chunks of about CHUNK characters, with a little overlap so context isn't cut mid-thought.
function chunkText(text, size = CHUNK) {
  const lines = text.split('\n');
  const chunks = [];
  let cur = [], len = 0;
  const flush = () => {
    const t = cur.join('\n').trim();
    if (t.length > 20) chunks.push(t);
    cur = cur.slice(-OVERLAP_LINES); len = cur.reduce((n, l) => n + l.length + 1, 0);
  };
  for (const line of lines) {
    const piece = line.length > size ? line.match(new RegExp(`.{1,${size}}`, 'g')) : [line];   // very long lines
    for (const p of piece) {
      if (len + p.length > size && cur.length) flush();
      cur.push(p); len += p.length + 1;
    }
  }
  if (cur.join('').trim().length > 20) chunks.push(cur.join('\n').trim());
  return chunks;
}

async function listFiles(roots) {
  const files = [];
  async function walk(dir, depth) {
    if (files.length >= MAX_FILES || depth > 12) return;
    let entries; try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (files.length >= MAX_FILES) return;
      const full = path.join(dir, e.name);
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name.toLowerCase())) await walk(full, depth + 1); continue; }
      if (SKIP_FILES.test(full)) continue;
      const ext = path.extname(e.name).toLowerCase();
      if (TEXT_EXTS.has(ext) || isDocument(full)) files.push(full);
    }
  }
  for (const r of roots) await walk(r, 0);
  return files;
}

// deps: { db, embedder }. onProgress({phase, done, total, chunks, file}). signal: AbortSignal.
async function build(roots, { db, embedder }, onProgress, signal) {
  onProgress?.({ phase: 'scanning' });
  const files = await listFiles(roots);
  const known = db.indexPaths();
  const seen = new Set(files);
  for (const p of known.keys()) if (!seen.has(p)) db.indexDelete(p);       // deleted or no longer approved

  const todo = [];
  for (const f of files) {
    let st; try { st = await fsp.stat(f); } catch { continue; }
    const big = isDocument(f) ? st.size > 30e6 : st.size > MAX_TEXT_BYTES;
    if (big) continue;
    if (known.get(f) === Math.floor(st.mtimeMs)) continue;
    todo.push({ f, mtime: Math.floor(st.mtimeMs) });
  }

  let done = 0, chunkCount = 0, skipped = 0;
  for (const { f, mtime } of todo) {
    if (signal?.aborted) break;
    onProgress?.({ phase: 'indexing', done, total: todo.length, chunks: chunkCount, file: path.basename(f) });
    try {
      const { text } = await extractText(f);
      const pieces = chunkText(text);
      const out = [];
      for (let i = 0; i < pieces.length; i += BATCH) {
        const batch = pieces.slice(i, i + BATCH);
        const vecs = await embedder.embed(batch, 'doc', { titles: batch.map(() => path.basename(f)), dims: DIMS });
        batch.forEach((t, k) => out.push({ text: t, emb: vecs[k] }));
      }
      if (out.length) { db.indexReplace(f, mtime, out); chunkCount += out.length; }
    } catch { skipped++; }                                                  // unreadable/binary/scanned: skip quietly
    done++;
  }
  onProgress?.({ phase: 'done', done, total: todo.length, chunks: chunkCount, skipped, unchanged: files.length - todo.length });
  return { files: files.length, indexed: done, skipped, chunks: chunkCount, cancelled: !!signal?.aborted };
}

module.exports = { build, chunkText, listFiles, DIMS };
