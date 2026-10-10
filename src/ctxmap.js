// Context map: shows exactly what the model will see on the next turn, with the real token cost of each part,
// and lets you pin or exclude individual messages. Opens from the meter under the input.
const MAP = { dlg: $('map-dlg'), bar: $('map-bar'), legend: $('map-legend'), inEl: $('map-in'), outEl: $('map-out'), outH: $('map-out-h'), title: $('map-title') };

function preview(i) { return textOf(history[i].content).replace(/\s+/g, ' ').trim().slice(0, 110) || '(image or attachment)'; }

function mapRow(i, tokens, kind, plan) {
  const m = history[i];
  const row = document.createElement('div');
  row.className = `map-row ${kind}`;
  const who = document.createElement('span'); who.className = `who-tag ${m.role}`; who.textContent = `${i + 1} · ${m.role === 'user' ? 'you' : 'assistant'}`;
  const text = document.createElement('span'); text.className = 'txt'; text.textContent = preview(i);
  const tok = document.createElement('span'); tok.className = 'tok'; tok.textContent = `${tokens.toLocaleString()} tok`;
  row.append(who, text, tok);
  const isLast = i === history.length - 1;
  const act = document.createElement('span'); act.className = 'acts';
  const btn = (label, title, fn) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = label; b.title = title; b.onclick = fn; act.append(b); };
  const redraw = () => { renderMap(); updateMeter(); };
  if (kind === 'excluded') {
    btn('Include again', 'Send this message again', () => { history[i].excluded = false; redraw(); });
  } else if (!isLast) {
    if (kind === 'out') btn('Bring back', 'Pin it so it stays in view', () => { history[i].pinned = true; redraw(); });
    else btn(m.pinned ? '📌 Unpin' : '📌 Pin', 'Keep this message in view however old it gets', () => { history[i].pinned = !m.pinned; redraw(); });
    btn('Exclude', 'Stop sending this message to the model', () => { history[i].excluded = true; history[i].pinned = false; redraw(); });
  }
  row.append(act);
  return row;
}

async function renderMap() {
  const sys = activeCartridge ? activeCartridge.system : buildSystem(await getTools());
  const p = await planPrompt({ hist: history, systemText: sys, volatile: lastVolatile, commit: false });
  const ctx = config.contextSize;
  const used = p.total + p.sysTok + p.volTok;
  MAP.title.textContent = `${p.exact ? 'Exact' : 'Estimated'} token counts · ${used.toLocaleString()} of ${ctx.toLocaleString()} in use · ` +
    `${p.replyReserve.toLocaleString()} reserved for the reply`;

  MAP.bar.replaceChildren();
  const seg = (cls, tokens, label) => {
    const d = document.createElement('div'); d.className = `seg ${cls}`; d.title = label;
    d.style.width = Math.max(0.4, 100 * tokens / ctx) + '%'; MAP.bar.append(d);
  };
  const last = history.length - 1;
  seg('sys', p.sysTok, `System prompt · ${p.sysTok} tokens`);
  for (const i of p.included) {
    if (i === last && p.volTok) seg('notes', p.volTok, `Recalled notes · ${p.volTok} tokens`);
    seg(history[i].role + (history[i].pinned ? ' pinned' : ''), p.counts[i], `Message ${i + 1} (${history[i].role}) · ${p.counts[i]} tokens`);
  }
  seg('reserve', p.replyReserve, `Reserved for the reply · ${p.replyReserve} tokens`);
  const free = ctx - used - p.replyReserve;
  if (free > 0) seg('free', free, `Free · ${free} tokens`);

  MAP.legend.replaceChildren();
  for (const [cls, label] of [['sys', 'System prompt'], ['user', 'You'], ['assistant', 'Assistant'], ['notes', 'Recalled notes'], ['reserve', 'Reply reserve'], ['free', 'Free']]) {
    const s = document.createElement('span'); s.className = 'lg';
    const dot = document.createElement('i'); dot.className = `seg ${cls}`; s.append(dot, label); MAP.legend.append(s);
  }

  MAP.inEl.replaceChildren(...p.included.map(i => mapRow(i, p.counts[i], 'in', p)));
  const out = [...p.outOfView.map(i => mapRow(i, p.counts[i], 'out', p)), ...p.excluded.map(i => mapRow(i, p.counts[i], 'excluded', p))];
  MAP.outEl.replaceChildren(...out);
  MAP.outH.hidden = MAP.outEl.hidden = out.length === 0;
}

$('ctx-meter').onclick = async () => { await renderMap(); MAP.dlg.showModal(); };
$('map-close').onclick = () => MAP.dlg.close();
