// Memory page: see what recall can draw on, mark notes outdated, forget them, and save short facts from the open chat.
// Stored text is untrusted (it came from model answers), so every row is built with textContent.
const MEM = { dlg: $('mem-dlg'), list: $('mem-list'), q: $('mem-q'), filter: $('mem-filter'), stats: $('mem-stats') };
const memEl = (tag, props = {}, ...kids) => { const n = Object.assign(document.createElement(tag), props); n.append(...kids); return n; };

async function memRefresh() {
  try {
    const [rows, st] = await Promise.all([openport.memory.list({ query: MEM.q.value.trim() }), openport.chats.stats()]);
    MEM.stats.textContent = `${st.embedded} chat answers searchable, ${st.facts || 0} saved facts, ${st.outdated || 0} marked outdated.`;
    const f = MEM.filter.value;
    const shown = rows.filter(r => f === 'outdated' ? r.state === 1 : r.state !== 1 && (f === 'all' || r.kind === f));
    if (!shown.length) { MEM.list.replaceChildren(memEl('div', { className: 'hint', textContent: rows.length ? 'Nothing matches this filter.' : 'Nothing remembered yet. Answers are remembered as you chat.' })); return; }
    MEM.list.replaceChildren(...shown.map(memRow));
  } catch (e) { MEM.list.replaceChildren(memEl('div', { className: 'error-msg', textContent: e.message })); }
}

function memRow(r) {
  const act = async (state, ask) => {
    if (ask && !confirm(ask)) return;
    await openport.memory.setState(r.kind, r.id, state);
    memRefresh();
  };
  const toggle = memEl('button', { type: 'button', textContent: r.state === 1 ? 'Restore' : 'Mark outdated',
    title: r.state === 1 ? 'Allow this note to be recalled again' : 'Keep it here, but never recall it into a chat' });
  toggle.onclick = () => act(r.state === 1 ? 0 : 1);
  const forget = memEl('button', { type: 'button', className: 'danger', textContent: 'Forget',
    title: r.kind === 'fact' ? 'Delete this fact' : 'Remove it from memory. The chat itself is not deleted.' });
  forget.onclick = () => act(2, r.kind === 'fact' ? 'Delete this saved fact?' : 'Forget this answer? It will no longer be recalled. The chat itself stays in your history.');
  const head = memEl('div', { className: 'mem-head' },
    memEl('span', { className: 'mem-kind ' + r.kind, textContent: r.kind === 'fact' ? 'Fact' : 'Chat' }),
    memEl('span', { className: 'mem-src', textContent: r.title }),
    memEl('span', { className: 'mem-age', textContent: r.age, title: new Date(r.created).toLocaleString() }),
    memEl('span', { className: 'acts' }, toggle, forget));
  const body = memEl('div', { className: 'mem-text', textContent: r.kind === 'chat' ? r.text.replace(/^Q:\s*/, 'Q: ').slice(0, 600) : r.text });
  const note = r.state === 1 ? memEl('div', { className: 'hint', textContent: r.replaced_by ? 'Outdated: replaced by a newer fact.' : 'Outdated: kept, never recalled.' }) : '';
  return memEl('div', { className: 'mem-row' + (r.state === 1 ? ' outdated' : '') }, head, body, note);
}

// ---- fact suggestions from the open chat ----
const memStatus = $('mem-extract-status');
$('mem-extract').onclick = async () => {
  const btn = $('mem-extract');
  if (!currentChatId || !history.some(m => m.role === 'assistant')) { memStatus.textContent = 'Open a chat with at least one answer first.'; return; }
  if (engine.status !== 'ready' || abort) { memStatus.textContent = 'Load the model (and wait for it to finish answering), then try again.'; return; }
  btn.disabled = true; memStatus.textContent = 'Reading the chat…';
  try {
    const prompt = MemFacts.buildPrompt(history, Math.max(4000, Math.floor((config?.contextSize || 8192) * 2)));
    const res = await fetch(`http://127.0.0.1:${engine.port}/v1/chat/completions`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: prompt }], stream: false, temperature: 0, max_tokens: 600, chat_template_kwargs: { enable_thinking: false } }),
    });
    if (!res.ok) throw new Error(`Engine returned ${res.status}`);
    const facts = MemFacts.parse((await res.json()).choices?.[0]?.message?.content);
    const already = (await openport.memory.chatFacts(currentChatId)).filter(f => f.state === 0).length;
    if (!facts.length) { memStatus.textContent = 'The model found nothing worth remembering in this chat.'; return; }
    $('mem-facts-edit').value = facts.join('\n');
    $('mem-facts-edit').hidden = false; $('mem-facts-acts').hidden = false;
    memStatus.textContent = `${facts.length} suggested. Check each one: the model can misstate a value. One fact per line.${already ? ` This chat already has ${already} saved; matching ones will be replaced.` : ''}`;
  } catch (e) { memStatus.textContent = `Could not get suggestions: ${e.message}`; }
  finally { btn.disabled = false; }
};
const memHideEditor = () => { $('mem-facts-edit').hidden = true; $('mem-facts-acts').hidden = true; $('mem-facts-edit').value = ''; };
$('mem-facts-discard').onclick = () => { memHideEditor(); memStatus.textContent = 'Discarded. Nothing was saved.'; };
$('mem-facts-save').onclick = async () => {
  const facts = $('mem-facts-edit').value.split('\n').map(s => s.replace(/^\s*[-*•]\s*/, '').trim()).filter(Boolean);
  if (!facts.length) return;
  const out = await openport.memory.saveFacts(currentChatId, facts);
  const replaced = out.reduce((n, f) => n + f.replaced.length, 0);
  memHideEditor();
  memStatus.textContent = `Saved ${out.length} fact${out.length === 1 ? '' : 's'}${replaced ? `; ${replaced} older fact${replaced === 1 ? '' : 's'} marked outdated` : ''}.`;
  memRefresh();
};

// ---- mistake log ----
async function ledRefresh() {
  let data;
  try { data = await openport.ledger.list(); } catch (e) { $('led-stats').textContent = e.message; return; }
  const s = data.stats;
  $('led-stats').textContent = !s.entries ? 'Nothing logged yet. Facts appear here after the command checker catches a mistake.'
    : `${s.caught} mistake${s.caught === 1 ? '' : 's'} caught in ${s.entries} distinct form${s.entries === 1 ? '' : 's'}. ` +
      `Repeated ${s.repeats} time${s.repeats === 1 ? '' : 's'}; ${s.repeatsAfterShown} of those happened even though the fact was in the model's prompt ` +
      `(facts were given to the model ${s.shown} time${s.shown === 1 ? '' : 's'}).`;
  $('led-clear').hidden = !s.entries;
  $('led-list').replaceChildren(...data.rows.map(r => {
    const del = memEl('button', { type: 'button', className: 'danger', textContent: 'Delete' });
    del.onclick = async () => { await openport.ledger.remove(r.id); ledRefresh(); };
    const meta = `${r.count}× by the model${r.model ? ` (last: ${r.model})` : ''} · given to the model ${r.shown}× · repeated after that ${r.repeat_after_shown}× · ${new Date(r.last_seen).toLocaleDateString()}`;
    return memEl('div', { className: 'mem-row' },
      memEl('div', { className: 'mem-head' },
        memEl('span', { className: 'mem-kind fact', textContent: r.kind === 'param' ? 'Parameter' : 'Command' }),
        memEl('span', { className: 'mem-src', textContent: `${r.command}${r.kind === 'param' ? ' ' + r.token : ''}` }),
        memEl('span', { className: 'mem-age', textContent: '' }),
        memEl('span', { className: 'acts' }, del)),
      memEl('div', { className: 'mem-text', textContent: r.fact }),
      memEl('div', { className: 'hint', textContent: meta }));
  }));
}
$('led-clear').onclick = async () => {
  if (!confirm('Clear every fact in the mistake log? The model will no longer be reminded of them.')) return;
  await openport.ledger.clear();
  ledRefresh();
};

let memTimer = null;
MEM.q.addEventListener('input', () => { clearTimeout(memTimer); memTimer = setTimeout(memRefresh, 200); });
MEM.filter.onchange = memRefresh;
const openMemory = async () => { memStatus.textContent = ''; MEM.dlg.showModal(); await Promise.all([memRefresh(), ledRefresh()]); };
$('open-memory').onclick = openMemory;
$('mem-close').onclick = () => MEM.dlg.close();
