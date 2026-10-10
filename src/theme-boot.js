// Runs in <head>, before the page paints: applies the saved appearance (theme, accent, style, text size) so the app never
// flashes the wrong theme on start. The real settings live in config.appearance; this is a per-PC copy for speed.
(function () {
  var a = {};
  try { a = JSON.parse(localStorage.getItem('openport.appearance') || '{}') || {}; } catch (e) { /* private mode: defaults */ }
  var d = document.documentElement;
  d.dataset.theme = a.mode || 'auto';
  d.dataset.accent = a.accent || 'blue';
  d.dataset.style = a.style || 'glass';
  d.dataset.text = a.text || 'm';
  if (a.motion === 'reduced') d.dataset.motion = 'reduced';
})();
