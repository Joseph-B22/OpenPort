// Small RAM / graphics-memory meter in the top bar. Asks every 5 s, and ONLY while the window is visible (a minimized or
// hidden window asks nothing, and the main process refuses to measure then too). Hover it for the breakdown.
(() => {
  const el = $('res-meter');
  const GB = 1024 ** 3;                                       // same units as Task Manager
  const gb = (b, d = 1) => (b / GB).toFixed(d);
  let timer = null, busy = false;

  async function refresh() {
    if (document.hidden || busy) return;
    busy = true;
    let s = null;
    try { s = await openport.stats.get(); } catch { /* leave the last reading */ }
    busy = false;
    if (!s) { if (config?.showResourceMeter === false) el.hidden = true; return; }
    const ram = s.chat.ram + s.embed.ram + s.app;
    const vram = s.chat.vram + s.embed.vram;
    const showVram = vram > 0 || (s.chat.backend === 'vulkan' && s.chat.status === 'ready');
    el.replaceChildren();
    const part = (label, value, warn) => {
      const span = document.createElement('span');
      span.className = 'res-part' + (warn ? ' warn' : '');
      const l = document.createElement('b'); l.textContent = label;
      span.append(l, document.createTextNode(' ' + value));
      el.append(span);
    };
    const pcFull = s.pcUsed / s.pcTotal > 0.9;
    const cardFull = s.vramCapacity && s.vramAll != null && s.vramAll / s.vramCapacity > 0.95;
    part('RAM', `${gb(ram)} GB`, pcFull);
    if (showVram) part('VRAM', s.vramCapacity ? `${gb(vram)} / ${gb(s.vramCapacity, 0)} GB` : `${gb(vram)} GB`, cardFull);
    const lines = ['OpenPort is using:'];
    lines.push(s.chat.model && s.chat.status === 'ready'
      ? `  Chat model (${s.chat.model}, ${s.chat.backend === 'vulkan' ? 'GPU' : 'CPU'}): ${gb(s.chat.ram)} GB RAM${s.chat.vram ? `, ${gb(s.chat.vram)} GB graphics memory` : ''}`
      : '  Chat model: not loaded');
    lines.push(s.embed.ram ? `  Embedding model (memory search): ${gb(s.embed.ram)} GB RAM` : '  Embedding model: not running');
    lines.push(`  App window: ${gb(s.app)} GB RAM`, '');
    lines.push(`This PC: ${gb(s.pcUsed)} of ${gb(s.pcTotal)} GB RAM in use (all programs)${pcFull ? ' — nearly full' : ''}`);
    if (s.vramAll != null && s.vramCapacity) lines.push(`Graphics card: ${gb(s.vramAll)} of ${gb(s.vramCapacity, 0)} GB in use (all programs)${cardFull ? ' — nearly full' : ''}`);
    if (s.partial) lines.push('', '(Engine figures unavailable right now; showing what the app could measure.)');
    lines.push('', 'Updates every 5 seconds while this window is visible; nothing is measured while it is minimized.');
    el.title = lines.join('\n');
    el.hidden = false;
  }

  function start() { if (!timer) { timer = setInterval(refresh, 5000); refresh(); } }
  function stop() { clearInterval(timer); timer = null; }
  document.addEventListener('visibilitychange', () => (document.hidden ? stop() : start()));
  window.applyResourceMeterSetting = on => { if (on === false) { stop(); el.hidden = true; } else if (!document.hidden) start(); };
  if (!document.hidden) start();
})();
