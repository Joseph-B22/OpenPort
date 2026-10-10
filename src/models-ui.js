// Model manager dialog. Everything from Hugging Face is untrusted text, so rows are built with textContent.
const M = {
  dlg: $('models-dlg'), list: $('m-list'), summary: $('m-summary'), catalog: $('m-catalog'),
  results: $('m-results'), repo: $('m-repo'), progress: $('m-progress'), error: $('m-error'),
  online: $('m-online'), offline: $('m-offline'),
};
let mInstalled = [];
let mFreeGB = 0;
const gb = b => (b / 1e9).toFixed(1) + ' GB';

function el(tag, props = {}, ...kids) {
  const n = Object.assign(document.createElement(tag), props);
  for (const k of kids) n.append(k);
  return n;
}
function mError(msg) { M.error.hidden = !msg; M.error.textContent = msg || ''; }

// ---- tabs ----
document.querySelectorAll('.tab').forEach(t => t.onclick = () => {
  document.querySelectorAll('.tab').forEach(x => x.classList.toggle('active', x === t));
  $('m-installed').hidden = t.dataset.tab !== 'installed';
  $('m-add').hidden = t.dataset.tab !== 'add';
  mError('');
});

// ---- installed ----
async function refreshInstalled() {
  const all = await openport.models.all();
  mInstalled = all.models; mFreeGB = all.freeGB;
  M.list.replaceChildren();
  if (!mInstalled.length) M.list.append(el('div', { className: 'hint', textContent: 'No models installed yet. Use “Add model”.' }));
  for (const m of mInstalled) {
    const name = el('div', { className: 'name', textContent: m.id });
    if (m.kind === 'embed') name.append(el('span', { className: 'badge', textContent: 'embedding' }));
    if (m.vision) name.append(el('span', { className: 'badge', textContent: 'vision' }));
    if (m.id === all.activeId) name.append(el('span', { className: 'badge ok', textContent: 'loaded' }));
    const del = el('button', { type: 'button', className: 'danger', textContent: 'Delete' });
    del.onclick = async () => {
      if (!confirm(`Delete "${m.id}" and free ${m.sizeGB} GB?\nYou can add it again later.`)) return;
      del.disabled = true;
      try { await openport.models.remove(m.kind === 'embed' ? 'embed' : 'chat', m.id); }
      catch (e) { mError(e.message); }
      await afterModelsChanged();
    };
    M.list.append(el('div', { className: 'mrow' },
      el('div', { className: 'info' }, name, el('div', { className: 'sub', textContent: `${m.sizeGB} GB` })), del));
  }
  const total = mInstalled.reduce((n, m) => n + m.bytes, 0);
  M.summary.textContent = `${gb(total)} used by models · ${mFreeGB} GB free on this drive`;
}

async function afterModelsChanged() {
  await loadModels();
  const st = await openport.getState();
  applyState(st);
  const chat = (await openport.listModels());
  if (st.status === 'idle' && chat.length) openport.startEngine(chat[0].id);
  await refreshInstalled();
  await renderCatalog();
}

// ---- progress ----
const bars = new Map();
function onProgress(p) {
  let b = bars.get(p.id);
  if (!b) {
    const label = el('span'), bar = el('progress', { max: 1, value: 0 });
    const cancel = el('button', { type: 'button', textContent: 'Cancel' });
    cancel.onclick = () => openport.models.hfCancel(p.id);
    const wrap = el('div', { className: 'dl' }, label, bar, cancel);
    M.progress.append(wrap);
    b = { wrap, label, bar, cancel };
    bars.set(p.id, b);
  }
  if (p.error || p.done) {
    b.wrap.remove(); bars.delete(p.id);
    if (p.error && !p.cancelled) mError(p.error);
    if (p.done) afterModelsChanged();
    return;
  }
  b.bar.value = p.received / p.total;
  b.label.textContent = `${p.file} — ${gb(p.received)} / ${gb(p.total)} (${Math.round(100 * p.received / p.total)}%)`;
  if (p.id.startsWith('import-')) b.cancel.hidden = true;
}
openport.models.onProgress(onProgress);

// ---- import ----
async function doImport(kind) {
  mError('');
  try { await openport.models.importFiles(kind); } catch (e) { mError(e.message); }
}
$('m-import-chat').onclick = () => doImport('chat');
$('m-import-embed').onclick = () => doImport('embed');

// ---- download helpers ----
async function startDownload({ repo, name, kind, items }) {
  mError('');
  const id = `dl-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const need = items.reduce((n, f) => n + f.size, 0) / 1e9;
  if (need > mFreeGB) { mError(`Needs ${need.toFixed(1)} GB but only ${mFreeGB} GB is free.`); return; }
  onProgress({ id, received: 0, total: Math.max(1, items.reduce((n, f) => n + f.size, 0)), file: 'Starting…' });
  const res = await openport.models.hfDownload({ id, repo, name, kind, items });
  if (res?.error && !bars.has(id)) mError(res.error);
}

// ---- recommended ----
async function renderCatalog() {
  const cat = await openport.models.catalog();
  M.catalog.replaceChildren();
  for (const c of cat.models) {
    const have = mInstalled.some(m => m.id === c.id);
    const name = el('div', { className: 'name', textContent: c.name });
    if (have) name.append(el('span', { className: 'badge ok', textContent: 'installed' }));
    const sub = el('div', { className: 'sub', textContent: `${c.sizeGB} GB · ${c.license} · ${c.notes}` });
    const btn = el('button', { type: 'button', className: 'primary', textContent: have ? 'Reinstall' : 'Download', hidden: have });
    btn.onclick = async () => {
      btn.disabled = true; mError('');
      try {
        const { variants, projectors } = await openport.models.hfFiles(c.repo);
        const flat = [...variants, ...projectors].flatMap(v => v.files);
        const items = c.files.map(f => flat.find(x => x.path === f || x.path.endsWith('/' + f)));
        if (items.includes(undefined)) throw new Error('This repo no longer has the expected files. Try “Search Hugging Face”.');
        await startDownload({ repo: c.repo, name: c.id, kind: c.kind, items });
      } catch (e) { mError(e.message); }
      btn.disabled = false;
    };
    M.catalog.append(el('div', { className: 'mrow' }, el('div', { className: 'info' }, name, sub), btn));
  }
}

// ---- search ----
async function doSearch() {
  mError(''); M.repo.replaceChildren(); M.results.replaceChildren(el('div', { className: 'hint', textContent: 'Searching…' }));
  const q = $('m-q').value.trim();
  try {
    if (/^[\w.-]+\/[\w.-]+$/.test(q)) { M.results.replaceChildren(); return openRepo(q); }
    const rows = await openport.models.hfSearch(q, $('m-sort').value);
    M.results.replaceChildren();
    if (!rows.length) M.results.append(el('div', { className: 'hint', textContent: 'No results.' }));
    for (const r of rows) {
      const row = el('div', { className: 'mrow clickable' },
        el('div', { className: 'info' },
          el('div', { className: 'name', textContent: r.id }),
          el('div', { className: 'sub', textContent: `${r.created ?? ''} · ${(r.downloads ?? 0).toLocaleString()} downloads · ${r.pipeline ?? ''}` })));
      row.onclick = () => openRepo(r.id);
      M.results.append(row);
    }
  } catch (e) { M.results.replaceChildren(); mError(e.message); }
}
$('m-search').onclick = doSearch;
$('m-q').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); doSearch(); } });

async function openRepo(repo) {
  M.repo.replaceChildren(el('div', { className: 'hint', textContent: `Loading ${repo}…` }));
  let data;
  try { data = await openport.models.hfFiles(repo); }
  catch (e) { M.repo.replaceChildren(); return mError(e.message); }
  if (!data.variants.length) { M.repo.replaceChildren(); return mError('No GGUF files in that repo.'); }

  const variant = el('select');
  data.variants.forEach((v, i) => variant.append(el('option', { value: i, textContent: `${v.name}  —  ${gb(v.bytes)}${v.files.length > 1 ? ` (${v.files.length} parts)` : ''}` })));
  const proj = el('select');
  proj.append(el('option', { value: -1, textContent: 'No vision file' }));
  data.projectors.forEach((p, i) => proj.append(el('option', { value: i, textContent: `${p.name}  —  ${gb(p.bytes)}` })));
  const best = data.projectors.findIndex(p => /f16/i.test(p.name));
  proj.value = best >= 0 ? best : (data.projectors.length ? 0 : -1);
  const name = el('input', { type: 'text', value: repo.split('/')[1].replace(/-GGUF$/i, ''), className: 'name-input' });
  const kind = el('select');
  kind.append(el('option', { value: 'chat', textContent: 'Chat model' }), el('option', { value: 'embed', textContent: 'Embedding model' }));
  const total = el('div', { className: 'sub' });
  const update = () => {
    const v = data.variants[variant.value], p = data.projectors[proj.value];
    const bytes = v.bytes + (p && kind.value === 'chat' ? p.bytes : 0);
    total.textContent = `Download: ${gb(bytes)} · ${mFreeGB} GB free` + (bytes / 1e9 > mFreeGB ? ' — not enough space!' : '');
  };
  [variant, proj, kind].forEach(s => s.onchange = update);
  update();

  const go = el('button', { type: 'button', className: 'primary', textContent: 'Download' });
  go.onclick = () => {
    const v = data.variants[variant.value], p = data.projectors[proj.value];
    const items = [...v.files, ...(p && kind.value === 'chat' ? p.files : [])];
    startDownload({ repo, name: name.value || repo, kind: kind.value, items });
  };
  M.repo.replaceChildren(el('div', { className: 'repo-pick' },
    el('strong', { textContent: repo }),
    el('label', {}, 'Quantization ', variant),
    el('label', {}, 'Vision file ', proj),
    el('label', {}, 'Install as ', kind),
    el('label', {}, 'Name ', name),
    total, go,
    el('div', { className: 'hint', textContent: 'Tip: pick a quant smaller than your VRAM/RAM budget. Check the model’s license before using it at work.' })));
}

// ---- open/close ----
async function openModels() {
  mError('');
  const info = await openport.systemInfo();
  M.online.hidden = !info.allowDownloads;
  M.offline.hidden = info.allowDownloads;
  await refreshInstalled();
  if (info.allowDownloads) renderCatalog();
  M.dlg.showModal();
}
$('open-models').onclick = openModels;
$('m-close').onclick = () => M.dlg.close();
