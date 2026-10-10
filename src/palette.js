// Command palette (Ctrl+K): type to jump to any action, setting or chat. Chat titles are untrusted text: textContent only.
const PAL = { dlg: $('palette'), q: $('pal-q'), list: $('pal-list') };
let palItems = [], palSel = 0;

const visible = id => { const el = $(id); return el && !el.hidden; };
function palCommands() {
  const cmds = [
    { group: 'Actions', label: 'New chat', hint: 'Ctrl N', run: () => $('new-chat').click() },
    { group: 'Actions', label: 'Search chats', hint: '', run: () => { document.body.classList.remove('side-collapsed'); $('chat-search').focus(); } },
    { group: 'Actions', label: engine.status === 'ready' || engine.status === 'loading' ? 'Unload the model (free memory)' : 'Load the model', run: () => $('model-toggle').click() },
    { group: 'Actions', label: 'Show or hide the sidebar', hint: 'Ctrl B', run: () => $('side-toggle').click() },
    { group: 'Open', label: 'Settings', hint: 'Ctrl ,', run: () => openSettingsPane() },
    { group: 'Open', label: 'Appearance', run: () => openSettingsPane('appearance') },
    { group: 'Open', label: 'Models', run: () => $('open-models').click() },
    { group: 'Open', label: 'Model tests', run: () => $('open-tests').click() },
    { group: 'Open', label: 'Memory', run: () => $('open-memory').click() },
    { group: 'Open', label: 'Cartridges', run: () => $('open-cart').click() },
    ...(visible('open-timeline') ? [{ group: 'Open', label: 'Screen timeline', run: () => $('open-timeline').click() }] : []),
    { group: 'Open', label: 'Activity log', run: () => $('s-audit').click() },
    { group: 'Open', label: 'Keyboard shortcuts', hint: 'Ctrl /', run: () => $('keys-dlg').showModal() },
    { group: 'Appearance', label: 'Theme: Auto (follow Windows)', run: () => applyAppearance({ mode: 'auto' }) },
    { group: 'Appearance', label: 'Theme: Light', run: () => applyAppearance({ mode: 'light' }) },
    { group: 'Appearance', label: 'Theme: Dark', run: () => applyAppearance({ mode: 'dark' }) },
    { group: 'Appearance', label: 'Style: Glass', run: () => applyAppearance({ style: 'glass' }) },
    { group: 'Appearance', label: 'Style: Solid', run: () => applyAppearance({ style: 'solid' }) },
    { group: 'Appearance', label: 'Style: OLED black', run: () => applyAppearance({ style: 'oled', mode: 'dark' }) },
    ...ACCENTS.map(([v, name]) => ({ group: 'Appearance', label: `Accent: ${name}`, swatch: v, run: () => applyAppearance({ accent: v }) })),
  ];
  for (const row of document.querySelectorAll('#chat-list .chat-item')) {
    const title = row.querySelector('.t')?.textContent || '';
    if (title) cmds.push({ group: 'Chats', label: title, chat: true, run: () => row.click() });
  }
  return cmds;
}

// Simple fuzzy match: whole-word starts score best, then substrings, then letters in order.
function palScore(label, q) {
  if (!q) return 1;
  const l = label.toLowerCase();
  const i = l.indexOf(q);
  if (i === 0 || (i > 0 && /\W/.test(l[i - 1]))) return 3 - i / 1000;
  if (i > 0) return 2 - i / 1000;
  // Letters in order, but close together (so "theme" doesn't match "unload THE MOdEl")
  let j = 0, first = -1, last = -1;
  for (let k = 0; k < l.length && j < q.length; k++) if (l[k] === q[j]) { if (first < 0) first = k; last = k; j++; }
  return j === q.length && last - first < q.length * 2 ? 1 - l.length / 1000 : 0;
}

function palRender() {
  const q = PAL.q.value.trim().toLowerCase();
  palItems = palCommands().map(c => ({ ...c, s: palScore(c.label, q) })).filter(c => c.s > 0);
  if (q) palItems.sort((a, b) => b.s - a.s);
  else palItems = palItems.filter(c => !c.chat || palItems.filter(x => x.chat).indexOf(c) < 5);   // a few recent chats when empty
  palSel = Math.min(palSel, Math.max(0, palItems.length - 1));
  PAL.list.replaceChildren();
  let lastGroup = null;
  palItems.forEach((c, i) => {
    if (!q && c.group !== lastGroup) {
      const g = document.createElement('div'); g.className = 'pal-group'; g.textContent = c.group; PAL.list.append(g); lastGroup = c.group;
    }
    const row = document.createElement('div');
    row.className = 'pal-item' + (i === palSel ? ' on' : '');
    row.setAttribute('role', 'option');
    const ic = document.createElement('span');
    ic.className = 'pal-ic' + (c.swatch ? ' sw' : '') + (c.chat ? ' chat' : '');
    if (c.swatch) ic.dataset.accent = c.swatch;
    const l = document.createElement('span'); l.className = 'pal-label'; l.textContent = c.label;
    row.append(ic, l);
    if (c.hint) { const h = document.createElement('kbd'); h.textContent = c.hint; row.append(h); }
    row.onmouseenter = () => { palSel = i; PAL.list.querySelectorAll('.pal-item').forEach((r, k) => r.classList.toggle('on', k === i)); };
    row.onclick = () => palRun(i);
    PAL.list.append(row);
  });
  if (!palItems.length) { const e = document.createElement('div'); e.className = 'pal-empty'; e.textContent = 'No matches'; PAL.list.append(e); }
}
function palRun(i) {
  const c = palItems[i];
  if (!c) return;
  PAL.dlg.close();
  setTimeout(() => c.run(), 0);                 // after the palette has closed, so the next dialog opens cleanly
}
function openPalette() {
  if (PAL.dlg.open) { PAL.dlg.close(); return; }
  document.querySelectorAll('dialog[open]').forEach(d => d.close());
  PAL.q.value = ''; palSel = 0; palRender();
  PAL.dlg.showModal(); PAL.q.focus();
}
PAL.q.addEventListener('input', () => { palSel = 0; palRender(); });
PAL.q.addEventListener('keydown', e => {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    palSel = (palSel + (e.key === 'ArrowDown' ? 1 : -1) + palItems.length) % Math.max(1, palItems.length);
    PAL.list.querySelectorAll('.pal-item').forEach((r, k) => { r.classList.toggle('on', k === palSel); if (k === palSel) r.scrollIntoView({ block: 'nearest' }); });
  } else if (e.key === 'Enter') { e.preventDefault(); palRun(palSel); }
});
PAL.dlg.addEventListener('click', e => { if (e.target === PAL.dlg) PAL.dlg.close(); });     // click outside closes
$('palette-btn').onclick = openPalette;
$('keys-close').onclick = () => $('keys-dlg').close();
