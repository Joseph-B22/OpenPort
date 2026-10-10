// Settings window layout: a category list on the left (like System Settings), one pane at a time, and a search box that
// shows matching settings from every pane. Only presentation: the fields, ids and Save logic are unchanged (app.js).
const SET = { dlg: $('settings'), q: $('set-q'), nav: $('set-nav'), title: $('set-title'), main: $('set-main') };
let setPane = 'appearance';
try { setPane = localStorage.getItem('openport.setPane') || 'appearance'; } catch { /* default */ }

const panes = () => [...SET.dlg.querySelectorAll('.set-pane')];
function paneAvailable(p) { return !(p.dataset.pane === 'screen' && $('s-sm').hidden); }   // work edition: no screen memory

function showSettingsPane(name) {
  const list = panes().filter(paneAvailable);
  if (!list.some(p => p.dataset.pane === name)) name = list[0]?.dataset.pane;
  setPane = name;
  try { localStorage.setItem('openport.setPane', name); } catch { /* fine */ }
  for (const p of panes()) { p.hidden = p.dataset.pane !== name; p.querySelectorAll('section').forEach(s => s.classList.remove('filtered-out')); }
  SET.nav.querySelectorAll('button[data-pane]').forEach(b => b.classList.toggle('on', b.dataset.pane === name));
  SET.title.textContent = SET.dlg.querySelector(`.set-pane[data-pane="${name}"]`)?.dataset.title || 'Settings';
  SET.main.scrollTop = 0;
  requestAnimationFrame(() => syncAppearanceControls());           // pill sliders measure their buttons once visible
}
SET.nav.addEventListener('click', e => {
  const b = e.target.closest('button[data-pane]');
  if (!b) return;
  SET.q.value = '';
  showSettingsPane(b.dataset.pane);
});

// Search: show every section (from any pane) whose text contains all the words typed.
SET.q.addEventListener('input', () => {
  const words = SET.q.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) { showSettingsPane(setPane); return; }
  let hits = 0;
  for (const p of panes()) {
    if (!paneAvailable(p)) { p.hidden = true; continue; }
    let any = false;
    for (const s of p.querySelectorAll('section')) {
      if (s.hidden && s.id === 's-sm') continue;
      const text = s.textContent.toLowerCase();
      const ok = words.every(w => text.includes(w));
      s.classList.toggle('filtered-out', !ok);
      if (ok) { any = true; hits++; }
    }
    p.hidden = !any;
  }
  SET.nav.querySelectorAll('button[data-pane]').forEach(b => b.classList.remove('on'));
  SET.title.textContent = hits ? `Results for "${SET.q.value.trim()}"` : `No settings match "${SET.q.value.trim()}"`;
});

// Every time Settings opens: hide categories this edition doesn't have, and return to the last pane.
new MutationObserver(() => {
  if (!SET.dlg.open) return;
  SET.nav.querySelectorAll('button[data-pane]').forEach(b => {
    const p = SET.dlg.querySelector(`.set-pane[data-pane="${b.dataset.pane}"]`);
    b.hidden = !p || !paneAvailable(p);
  });
  SET.q.value = '';
  showSettingsPane(setPane);
}).observe(SET.dlg, { attributes: true, attributeFilter: ['open'] });

async function openSettingsPane(name) {
  if (name) setPane = name;
  await openSettings();
  showSettingsPane(setPane);
}
