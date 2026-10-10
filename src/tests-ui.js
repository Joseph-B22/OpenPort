// Model tests dialog: run a private test set on any installed model, keep scorecards, compare models.
// Everything shown from model answers is untrusted text, so rows are built with textContent.
const T = {
  dlg: $('tests-dlg'), model: $('t-model'), run: $('t-run'), cancel: $('t-cancel'), bar: $('t-bar'), status: $('t-status'),
  runs: $('t-runs'), detail: $('t-detail'), cases: $('t-cases'), form: $('t-form'),
};
let tCases = [], tRuns = [], tEditing = null, tRunning = false;

const tel = (tag, props = {}, ...kids) => { const n = Object.assign(document.createElement(tag), props); n.append(...kids); return n; };
const pctOf = (a, b) => (b ? Math.round(100 * a / b) : 0);

async function openTests() {
  T.status.textContent = ''; T.bar.hidden = true; T.form.hidden = true; T.detail.replaceChildren();
  const models = await openport.listModels();
  const st = await openport.getState();
  T.model.replaceChildren(...models.map(m => tel('option', { value: m.id, textContent: `${m.id}${m.id === st.model && st.status === 'ready' ? ' (loaded)' : ''}` })));
  if (st.model) T.model.value = st.model;
  await refreshTests();
  T.dlg.showModal();
}

async function refreshTests() {
  [tCases, tRuns] = await Promise.all([openport.evals.cases(), openport.evals.runs()]);
  renderRuns(); renderCases();
}

// ---- scorecards ----
function renderRuns() {
  T.runs.replaceChildren();
  if (!tRuns.length) { T.runs.append(tel('div', { className: 'hint', textContent: 'No runs yet. Pick a model above and press “Run all tests”.' })); return; }
  const head = tel('div', { className: 'trow thead' }, ...['When', 'Model', 'Score', 'Speed', 'Avg time', ''].map(h => tel('span', { textContent: h })));
  T.runs.append(head);
  for (const r of tRuns.slice(0, 15)) {
    const score = tel('span', { className: 'score', textContent: `${r.passed}/${r.total} (${pctOf(r.passed, r.total)}%)` });
    const open = tel('button', { type: 'button', textContent: 'Details' });
    const del = tel('button', { type: 'button', className: 'danger', textContent: 'Delete' });
    open.onclick = () => showRun(r);
    del.onclick = async () => { tRuns = await openport.evals.deleteRun(r.id); renderRuns(); T.detail.replaceChildren(); };
    T.runs.append(tel('div', { className: 'trow' },
      tel('span', { textContent: new Date(r.when).toLocaleString() }),
      tel('span', { textContent: `${r.model} · ${r.backend === 'vulkan' ? 'GPU' : (r.backend || '?').toUpperCase()}${r.cancelled ? ' · stopped early' : ''}` }),
      score,
      tel('span', { textContent: r.avgTps ? `${r.avgTps} tok/s` : '—' }),
      tel('span', { textContent: `${(r.avgMs / 1000).toFixed(1)} s` }),
      tel('span', { className: 'acts' }, open, del)));
  }
}

function showRun(r) {
  const prev = tRuns.find(x => x.when < r.when && x.model !== r.model);          // newest earlier run of a different model
  T.detail.replaceChildren(tel('h4', { textContent: `${r.model}: case by case${prev ? ` (compared with ${prev.model})` : ''}` }));
  for (const d of r.details) {
    const before = prev?.details.find(x => x.id === d.id);
    const change = !before ? '' : (before.pass === d.pass ? '' : d.pass ? '▲ better' : '▼ worse');
    const why = d.error ? `error: ${d.error}` : [d.missing.length ? `missing: ${d.missing.join(', ')}` : '', d.forbidden.length ? `contains: ${d.forbidden.join(', ')}` : '', d.tooLong ? 'too long' : ''].filter(Boolean).join(' · ');
    const row = tel('details', { className: 'tcase' + (d.pass ? ' pass' : ' fail') },
      tel('summary', { textContent: `${d.pass ? '✓' : '✗'} ${d.name}${change ? `  ${change}` : ''}  ·  ${(d.ms / 1000).toFixed(1)} s${d.tps ? ` · ${d.tps} tok/s` : ''}` }),
      tel('pre', { textContent: `${why ? why + '\n\n' : ''}${d.answer || '(no answer)'}` }));
    T.detail.append(row);
  }
}

// ---- running ----
function setRunning(on) { tRunning = on; T.run.hidden = on; T.cancel.hidden = !on; T.model.disabled = on; T.bar.hidden = !on; }
T.run.onclick = async () => {
  if (tRunning) return;
  const target = T.model.value;
  const st = await openport.getState();
  const swap = target && (target !== st.model || st.status !== 'ready');
  if (swap && !confirm(`Testing "${target}" will unload the current model, run ${tCases.length} tests, then load the previous model again.\nThis takes a while and uses a lot of memory. Close other applications first. Continue?`)) return;
  setRunning(true); T.bar.value = 0; T.status.textContent = 'Starting…';
  const res = await openport.evals.start(swap ? target : undefined);
  setRunning(false);
  if (res.error) T.status.textContent = `Could not run: ${res.error}`;
  await refreshTests();
  if (res.run) showRun(res.run);
};
T.cancel.onclick = () => openport.evals.cancel();
openport.evals.onProgress(p => {
  if (p.phase === 'loading') T.status.textContent = `Loading ${p.model}…`;
  else if (p.phase === 'restoring') T.status.textContent = `Loading ${p.model} back…`;
  else if (p.phase === 'running') { T.bar.hidden = false; T.bar.value = p.total ? p.done / p.total : 0; T.status.textContent = `Test ${p.done + 1} of ${p.total}: ${p.name}`; }
  else if (p.phase === 'done') T.status.textContent = `Finished: ${p.run.passed} of ${p.run.total} passed.`;
  else if (p.phase === 'error') T.status.textContent = `Error: ${p.error}`;
});

// ---- test cases ----
function renderCases() {
  T.cases.replaceChildren();
  for (const c of tCases) {
    const edit = tel('button', { type: 'button', textContent: 'Edit' });
    const del = tel('button', { type: 'button', className: 'danger', textContent: 'Delete' });
    edit.onclick = () => openForm(c);
    del.onclick = async () => { tCases = await openport.evals.saveCases(tCases.filter(x => x.id !== c.id)); renderCases(); };
    T.cases.append(tel('div', { className: 'mrow' },
      tel('div', { className: 'info' }, tel('div', { className: 'name', textContent: c.name }),
        tel('div', { className: 'sub', textContent: `${c.context ? 'with context · ' : ''}expects: ${c.expect.join(' · ')}` })),
      edit, del));
  }
}
function openForm(c = {}) {
  tEditing = c.id || null;
  $('tf-name').value = c.name || ''; $('tf-context').value = c.context || ''; $('tf-prompt').value = c.prompt || '';
  $('tf-expect').value = (c.expect || []).join('\n'); $('tf-forbid').value = (c.forbid || []).join('\n');
  T.form.hidden = false; $('tf-name').focus();
}
$('t-add').onclick = () => openForm();
$('t-from-chat').onclick = () => {
  const lastUser = [...history].reverse().find(m => m.role === 'user');
  openForm({ prompt: lastUser ? textOf(lastUser.content).replace(/\n\n📄.*$/s, '') : '', name: 'From chat' });
};
$('tf-cancel').onclick = () => { T.form.hidden = true; };
$('tf-save').onclick = async () => {
  const lines = id => $(id).value.split('\n').map(s => s.trim()).filter(Boolean);
  const c = { id: tEditing || undefined, name: $('tf-name').value.trim() || 'Untitled', context: $('tf-context').value.trim() || undefined, prompt: $('tf-prompt').value.trim(), expect: lines('tf-expect'), forbid: lines('tf-forbid') };
  if (!c.prompt || !c.expect.length) { alert('A test needs a question and at least one thing the answer must contain.'); return; }
  const next = tEditing ? tCases.map(x => (x.id === tEditing ? c : x)) : [...tCases, c];
  tCases = await openport.evals.saveCases(next);
  T.form.hidden = true; renderCases();
};

$('open-tests').onclick = openTests;
$('t-close').onclick = () => T.dlg.close();
