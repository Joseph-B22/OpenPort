// Window chrome only: sidebar show/hide (a slide-over drawer on narrow windows), the chat title in the top bar,
// the starter suggestions on an empty chat, and Ctrl+N. No backend calls.
(() => {
  const body = document.body;
  const narrow = window.matchMedia('(max-width: 760px)');
  const scrim = $('scrim');
  const store = { get: k => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } } };

  if (store.get('openport.sidebar') === 'collapsed') body.classList.add('side-collapsed');
  const closeDrawer = () => { body.classList.remove('side-open'); scrim.hidden = true; };
  $('side-toggle').onclick = () => {
    if (narrow.matches) { const open = !body.classList.contains('side-open'); body.classList.toggle('side-open', open); scrim.hidden = !open; }
    else { const c = body.classList.toggle('side-collapsed'); store.set('openport.sidebar', c ? 'collapsed' : 'open'); }
  };
  scrim.onclick = closeDrawer;
  narrow.addEventListener('change', closeDrawer);
  // Picking a chat or starting a new one closes the drawer on a narrow window.
  $('chat-list').addEventListener('click', e => { if (narrow.matches && e.target.closest('.chat-item') && !e.target.closest('.x')) closeDrawer(); });
  $('new-chat').addEventListener('click', () => { if (narrow.matches) closeDrawer(); });
  // Keyboard shortcuts (also listed in Settings → About and Ctrl+/).
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && body.classList.contains('side-open')) closeDrawer();
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === 'k' && !e.shiftKey) { e.preventDefault(); openPalette(); }
    else if (k === 'n' && !e.shiftKey) { e.preventDefault(); document.querySelectorAll('dialog[open]').forEach(d => d.close()); $('new-chat').click(); }
    else if (k === ',') { e.preventDefault(); if (!$('settings').open) openSettingsPane(); }
    else if (k === 'b' && !e.shiftKey) { e.preventDefault(); $('side-toggle').click(); }
    else if (k === '/') { e.preventDefault(); const d = $('keys-dlg'); if (d.open) d.close(); else { document.querySelectorAll('dialog[open]').forEach(x => x.close()); d.showModal(); } }
  });

  // "Jump to latest" appears when you've scrolled up; while you read older messages, streaming no longer yanks you down.
  const msgs = $('messages'), toBottom = $('to-bottom');
  const update = () => { toBottom.hidden = msgs.scrollHeight - msgs.scrollTop - msgs.clientHeight < 240; };
  msgs.addEventListener('scroll', update, { passive: true });
  new MutationObserver(update).observe(msgs, { childList: true });
  toBottom.onclick = () => msgs.scrollTo({ top: msgs.scrollHeight, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });

  // Top bar title follows the highlighted chat in the list.
  const title = $('top-title');
  const syncTitle = () => { title.textContent = $('chat-list').querySelector('.chat-item.active .t')?.textContent || 'New chat'; };
  new MutationObserver(syncTitle).observe($('chat-list'), { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
  syncTitle();

  // Starter suggestions on the empty screen (static text, see showEmpty in app.js): fill the box, don't send.
  $('messages').addEventListener('click', e => {
    const b = e.target.closest('.suggest');
    if (!b) return;
    const input = $('input');
    input.value = b.dataset.prompt;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  });
})();
