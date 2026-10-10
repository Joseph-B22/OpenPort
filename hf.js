// Hugging Face browsing + resumable downloads. Runs in the main process only, and only ever talks to
// huggingface.co / hf.co hosts (checked on every request and after redirects). Disabled entirely
// when config.allowDownloads is false (the work edition).
const fs = require('fs');
const path = require('path');
const models = require('./models');

const hostOk = h => h === 'huggingface.co' || h === 'hf.co' || h.endsWith('.huggingface.co') || h.endsWith('.hf.co');

async function hfFetch(url, opts = {}) {
  if (!hostOk(new URL(url).hostname)) throw new Error('Blocked: not a Hugging Face host');
  const res = await fetch(url, { ...opts, headers: { 'User-Agent': 'OpenPort', ...opts.headers } });
  if (!hostOk(new URL(res.url).hostname)) { res.body?.cancel(); throw new Error('Blocked: redirected to a non-Hugging Face host'); }
  return res;
}
async function hfJson(url) {
  const res = await hfFetch(url);
  if (!res.ok) throw new Error(`Hugging Face returned ${res.status}`);
  return res.json();
}

const REPO_RE = /^[\w.-]+\/[\w.-]+$/;

// Admin policy: if `publishers` is non-empty, only repos owned by those Hugging Face accounts
// can be searched, listed or downloaded. Set from config.allowedPublishers by main.js.
const policy = { publishers: [] };
function checkRepo(repo) {
  if (!REPO_RE.test(repo)) throw new Error('Use the form owner/name');
  const owner = repo.split('/')[0].toLowerCase();
  if (policy.publishers.length && !policy.publishers.some(p => p.toLowerCase() === owner)) {
    throw new Error(`"${repo.split('/')[0]}" is not an approved publisher. Approved: ${policy.publishers.join(', ')}`);
  }
}

async function search(query, sort = 'downloads') {
  const sorts = { downloads: 'downloads', recent: 'createdAt', trending: 'trendingScore' };
  const base = `https://huggingface.co/api/models?filter=gguf&sort=${sorts[sort] || 'downloads'}&limit=25` +
    (query ? `&search=${encodeURIComponent(query)}` : '');
  // With an approved-publisher list, query each publisher separately and merge.
  const urls = policy.publishers.length ? policy.publishers.map(p => `${base}&author=${encodeURIComponent(p)}`) : [base];
  const rows = (await Promise.all(urls.map(hfJson))).flat();
  const key = sort === 'recent' ? 'createdAt' : sort === 'trending' ? 'trendingScore' : 'downloads';
  rows.sort((a, b) => (b[key] > a[key] ? 1 : b[key] < a[key] ? -1 : 0));
  return rows.slice(0, 25).map(r => ({ id: r.id, downloads: r.downloads, likes: r.likes, created: r.createdAt?.slice(0, 10), pipeline: r.pipeline_tag }));
}

// Groups a repo's GGUF files into pickable "variants" (single files or sharded quant folders)
// plus any vision projectors (mmproj).
async function files(repo) {
  checkRepo(repo);
  const top = await hfJson(`https://huggingface.co/api/models/${repo}/tree/main`);
  const variants = [], projectors = [];
  const dirs = top.filter(e => e.type === 'directory' && !/^(assets|\.|tensor-allocation|imatrix)/i.test(e.path));
  for (const e of top.filter(e => e.type === 'file' && models.isGguf(e.path))) {
    const item = { name: e.path, files: [{ path: e.path, size: e.size }], bytes: e.size };
    (models.isMmproj(e.path) ? projectors : variants).push(item);
  }
  await Promise.all(dirs.slice(0, 30).map(async d => {
    try {
      const sub = (await hfJson(`https://huggingface.co/api/models/${repo}/tree/main/${d.path}`))
        .filter(x => x.type === 'file' && models.isGguf(x.path));
      if (sub.length) variants.push({ name: d.path, files: sub.map(x => ({ path: x.path, size: x.size })), bytes: sub.reduce((n, x) => n + x.size, 0) });
    } catch { /* skip unreadable folder */ }
  }));
  const bySize = (a, b) => a.bytes - b.bytes;
  return { variants: variants.sort(bySize), projectors: projectors.sort(bySize) };
}

const active = new Map();   // downloadId -> AbortController

// items: [{path, size}] from files(); writes flat into models/<id>/ (or models/embeddings/<id>/).
async function download({ id: dlId, repo, name, kind, items }, emit) {
  checkRepo(repo);
  const modelsDir = download.modelsDir;
  // A folder holding only *.part files is an interrupted download of this same model: resume it.
  const wanted = models.safeName(name);
  const prior = (() => {
    try {
      const d = models.dirFor(modelsDir, kind, wanted);
      const names = fs.readdirSync(d);
      return names.some(n => n.endsWith('.part')) ? wanted : null;
    } catch { return null; }
  })();
  const id = prior || models.uniqueId(modelsDir, kind, name);
  const dest = models.dirFor(modelsDir, kind, id);
  const total = items.reduce((n, f) => n + f.size, 0);
  const free = models.freeBytes(modelsDir);
  if (free !== null && total > free) throw new Error(`Not enough disk space (${(total / 1e9).toFixed(1)} GB needed, ${(free / 1e9).toFixed(1)} GB free).`);

  fs.mkdirSync(dest, { recursive: true });
  const ctl = new AbortController();
  active.set(dlId, ctl);
  let done = 0, lastEmit = 0;
  try {
    for (const f of items) {
      const target = path.join(dest, path.basename(f.path));
      const part = target + '.part';
      if (fs.existsSync(target) && fs.statSync(target).size === f.size) { done += f.size; continue; }   // finished before an interruption
      const have = fs.existsSync(part) ? fs.statSync(part).size : 0;
      const url = `https://huggingface.co/${repo}/resolve/main/${f.path.split('/').map(encodeURIComponent).join('/')}`;
      const res = await hfFetch(url, { signal: ctl.signal, headers: have ? { Range: `bytes=${have}-` } : {} });
      if (!res.ok && res.status !== 206) throw new Error(`Download failed (${res.status}) for ${f.path}`);
      const resumed = res.status === 206;
      done += resumed ? have : 0;
      const ws = fs.createWriteStream(part, { flags: resumed ? 'a' : 'w' });
      const reader = res.body.getReader();
      for (;;) {
        const { value, done: end } = await reader.read();
        if (end) break;
        if (!ws.write(value)) await new Promise(r => ws.once('drain', r));
        done += value.length;
        if (Date.now() - lastEmit > 250) { lastEmit = Date.now(); emit({ id: dlId, received: done, total, file: path.basename(f.path) }); }
      }
      await new Promise((resolve, reject) => ws.end(err => (err ? reject(err) : resolve())));
      if (fs.statSync(part).size !== f.size) throw new Error(`Size mismatch for ${f.path} — try again.`);
      fs.renameSync(part, target);
    }
    emit({ id: dlId, received: total, total, done: true, modelId: id });
    return id;
  } catch (e) {
    const cancelled = ctl.signal.aborted;
    // Keep partial files on network errors so a retry resumes; remove everything on cancel.
    if (cancelled) fs.rmSync(dest, { recursive: true, force: true });
    emit({ id: dlId, error: cancelled ? 'Cancelled' : e.message, cancelled });
    throw e;
  } finally {
    active.delete(dlId);
  }
}
function cancel(dlId) { active.get(dlId)?.abort(); }

module.exports = { search, files, download, cancel, policy };
