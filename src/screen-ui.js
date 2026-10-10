// Screen memory interface (home edition): the always-visible pill, the Settings section, the timeline window, and the
// "Read text on my screen" button. Everything shown from stored screen text is untrusted, so rows use textContent.
let smAllowedUI = false;      // false in the work edition: all of this stays hidden
let smState = null;

const sel = el => (typeof el === 'string' ? $(el) : el);
const sEl = (tag, props = {}, ...kids) => { const n = Object.assign(document.createElement(tag), props); n.append(...kids); return n; };

function applySmState(s) {
  smState = s;
  const on = smAllowedUI && s?.enabled;
  const pill = $('sm-pill');
  pill.hidden = !on;
  if (on) {
    const paused = s.paused || s.locked;
    pill.className = 'pill ' + (paused ? 'paused' : 'live');
    pill.textContent = paused ? (s.locked ? '⏸ Screen memory paused (locked)' : '⏸ Screen memory paused · click to resume') : '● Screen memory on · click to pause';
    pill.title = `${s.db.count} moments saved (${s.db.mb} MB). Reads window text only, never images. Hotkey Ctrl+Alt+P.`;
  }
  $('open-timeline').hidden = !on;
  $('ocr-btn').hidden = !smAllowedUI;
  if ($('settings').open) renderSmStatus();
}

function renderSmStatus() {
  const s = smState; const box = $('s-sm-status');
  if (!s) { box.textContent = ''; return; }
  const lines = [];
  lines.push(s.enabled ? (s.paused ? 'Paused.' : s.locked ? 'Paused while the screen is locked.' : 'On: reading the window in front.') : 'Off.');
  lines.push(`${s.db.count} moments saved (${s.db.mb} MB of text, ${s.db.pinned} you chose to keep).`);
  if (s.stats) lines.push(`This session: ${s.stats.captured} saved, ${s.stats.skippedDuplicate} unchanged, ${s.stats.skippedExcluded} skipped (excluded windows), ${s.stats.scrubbedItems} secret${s.stats.scrubbedItems === 1 ? '' : 's'} removed${s.stats.lastError ? `. Last problem: ${s.stats.lastError}` : ''}.`);
  if (s.enabled && s.helper && !s.helper.ok) lines.push(`Windows OCR is not available: ${s.helper.error || 'no OCR language installed'}.`);
  if (s.enabled && !s.hotkeys.pause) lines.push('Note: the Ctrl+Alt+P hotkey is taken by another program.');
  if (s.enabled && !s.hotkeys.remember) lines.push('Note: the Ctrl+Alt+M hotkey is taken by another program.');
  box.textContent = lines.join(' ');
  $('s-sm-pause').textContent = s.paused ? 'Resume' : 'Pause';
  $('s-sm-pause').disabled = !s.enabled;
}

// Settings form <-> config
function smFillSettings(cfg) {
  $('s-sm').hidden = !smAllowedUI;
  if (!smAllowedUI) return;
  $('s-sm-on').checked = !!cfg?.enabled;
  $('s-sm-assist').checked = cfg?.assistantSearch !== false;
  $('s-sm-days').value = cfg?.retentionDays ?? 3;
  $('s-sm-interval').value = cfg?.intervalSec ?? 30;
  // If a saved config has no list at all, show the defaults instead of an empty box (an empty box would save "exclude nothing").
  $('s-sm-exclude').value = (cfg?.exclude ?? smState?.defaultExclude ?? []).join('\n');
  renderSmStatus();
}
$('s-sm-reset-exclude').onclick = () => { $('s-sm-exclude').value = (smState?.defaultExclude || []).join('\n'); };
function smFromForm(prev = {}) {
  return {
    ...prev,
    enabled: $('s-sm-on').checked,
    assistantSearch: $('s-sm-assist').checked,
    retentionDays: Math.min(30, Math.max(1, Number($('s-sm-days').value) || 3)),
    intervalSec: Math.min(600, Math.max(10, Number($('s-sm-interval').value) || 30)),
    exclude: $('s-sm-exclude').value.split('\n').map(s => s.trim()).filter(Boolean),
  };
}

$('sm-pill').onclick = async () => { if (smState) applySmState(await openport.screenmem.pause(!smState.paused)); };
$('s-sm-pause').onclick = async () => { if (smState) applySmState(await openport.screenmem.pause(!smState.paused)); };
$('s-sm-clear').onclick = async () => {
  if (!confirm('Delete everything screen memory has saved? This cannot be undone.')) return;
  applySmState(await openport.screenmem.clear());
};

// "Read text on my screen": you pressed it, so it reads once and puts the text in your message as an attachment.
$('ocr-btn').onclick = async () => {
  const btn = $('ocr-btn'); btn.disabled = true;
  try {
    const r = await openport.screenmem.readScreen();
    if (!r.text.trim()) throw new Error('No text was found on the screen.');
    addDocs([{ name: `Screen text ${new Date().toLocaleTimeString()}`, text: r.text, chars: r.chars }]);
  } catch (e) { els.banner.hidden = false; els.banner.textContent = e.message; setTimeout(() => { if (engine.status !== 'error') els.banner.hidden = true; }, 6000); }
  btn.disabled = false; els.input.focus();
};

// ---- timeline ----
const TL = { dlg: $('tl-dlg'), q: $('tl-q'), range: $('tl-range'), status: $('tl-status'), results: $('tl-results') };
async function runTimeline() {
  TL.status.textContent = 'Searching…';
  try {
    const r = await openport.screenmem.search({ query: TL.q.value.trim(), sinceMinutes: Number(TL.range.value) });
    TL.status.textContent = `${r.hits.length} result${r.hits.length === 1 ? '' : 's'} from ${r.searched} saved moments.`;
    TL.results.replaceChildren(...r.hits.map(h => {
      const copy = sEl('button', { type: 'button', textContent: 'Copy' });
      copy.onclick = () => { navigator.clipboard.writeText(h.snippet); copy.textContent = 'Copied'; setTimeout(() => (copy.textContent = 'Copy'), 1200); };
      const use = sEl('button', { type: 'button', textContent: 'Use in chat' });
      use.onclick = () => { addDocs([{ name: `Screen memory ${new Date(h.ts).toLocaleTimeString()}`, text: h.snippet, chars: h.snippet.length }]); TL.dlg.close(); els.input.focus(); };
      return sEl('div', { className: 'tl-row' },
        sEl('div', { className: 'tl-head' },
          sEl('span', { className: 'tl-time', textContent: `${new Date(h.ts).toLocaleString()}${h.pinned ? '  ·  saved by you' : ''}` }),
          sEl('span', { className: 'tl-win', textContent: `${h.process}: ${h.title}` }),
          sEl('span', { className: 'acts' }, copy, use)),
        sEl('pre', { textContent: h.snippet }));
    }));
  } catch (e) { TL.status.textContent = e.message; }
}
$('tl-go').onclick = runTimeline;
TL.q.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); runTimeline(); } });
const openTimeline = async () => { TL.results.replaceChildren(); TL.dlg.showModal(); TL.q.focus(); await runTimeline(); };
$('open-timeline').onclick = openTimeline;
$('s-sm-timeline').onclick = () => { $('settings').close(); openTimeline(); };
$('tl-close').onclick = () => TL.dlg.close();

// ---- start up ----
(async () => {
  try {
    const info = await openport.systemInfo();
    smAllowedUI = info.allowScreenMemory !== false;
    $('s-sm').hidden = !smAllowedUI;
    if (!smAllowedUI) return;
    applySmState(await openport.screenmem.status());
    openport.screenmem.onState(applySmState);
  } catch { /* leave the feature hidden */ }
})();
