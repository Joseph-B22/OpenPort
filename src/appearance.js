// Appearance: theme (auto/light/dark), accent colour, surface style (glass/solid/OLED), text size and motion. Applied instantly
// (with a short cross-fade where the browser supports it), saved to config.appearance and to localStorage (read by
// theme-boot.js before the first paint). Also: the segmented "pill slider" controls and the top-bar theme toggle.
const APPEARANCE_DEFAULTS = { mode: 'auto', accent: 'blue', style: 'glass', text: 'm', motion: 'full' };
const ACCENTS = [
  ['blue', 'Blue'], ['indigo', 'Indigo'], ['purple', 'Purple'], ['pink', 'Pink'],
  ['orange', 'Orange'], ['green', 'Green'], ['teal', 'Teal'], ['graphite', 'Graphite'],
];
let appearance = { ...APPEARANCE_DEFAULTS };
try { appearance = { ...APPEARANCE_DEFAULTS, ...JSON.parse(localStorage.getItem('openport.appearance') || '{}') }; } catch { /* defaults */ }

function applyAppearance(next, { save = true, animate = true } = {}) {
  appearance = { ...appearance, ...next };
  const d = document.documentElement;
  const set = () => {
    d.dataset.theme = appearance.mode; d.dataset.accent = appearance.accent; d.dataset.style = appearance.style; d.dataset.text = appearance.text;
    if (appearance.motion === 'reduced') d.dataset.motion = 'reduced'; else delete d.dataset.motion;
  };
  // Cross-fade the whole window between themes: one snapshot, then an opacity animation (cheap even without GPU acceleration).
  if (animate && document.startViewTransition && appearance.motion !== 'reduced' && !matchMedia('(prefers-reduced-motion: reduce)').matches) document.startViewTransition(set);
  else set();
  try { localStorage.setItem('openport.appearance', JSON.stringify(appearance)); } catch { /* private mode */ }
  if (save) openport.setConfig({ appearance }).catch(() => {});
  syncAppearanceControls();
  updateThemeToggle();
}
const isDark = () => appearance.mode === 'dark' || (appearance.mode === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);

// ---- segmented controls ("pill sliders"): <div class="seg-ctl" data-key="mode"><button data-v="auto">… ----
function segThumb(ctl) {
  const on = ctl.querySelector('button.on');
  let thumb = ctl.querySelector('.seg-thumb');
  if (!thumb) { thumb = document.createElement('span'); thumb.className = 'seg-thumb'; ctl.prepend(thumb); }
  if (!on || !on.offsetWidth) { thumb.style.opacity = '0'; return; }
  thumb.style.opacity = '1';
  thumb.style.width = on.offsetWidth + 'px';
  thumb.style.transform = `translateX(${on.offsetLeft - 3}px)`;
}
function syncAppearanceControls() {
  document.querySelectorAll('.seg-ctl[data-key]').forEach(ctl => {
    const v = appearance[ctl.dataset.key];
    ctl.querySelectorAll('button[data-v]').forEach(b => { b.classList.toggle('on', b.dataset.v === v); b.setAttribute('aria-pressed', b.dataset.v === v); });
    segThumb(ctl);
  });
  document.querySelectorAll('#ap-accent .swatch').forEach(s => { s.classList.toggle('on', s.dataset.v === appearance.accent); s.setAttribute('aria-pressed', s.dataset.v === appearance.accent); });
}
document.querySelectorAll('.seg-ctl[data-key]').forEach(ctl => {
  ctl.addEventListener('click', e => {
    const b = e.target.closest('button[data-v]');
    if (b) applyAppearance({ [ctl.dataset.key]: b.dataset.v });
  });
});
// Accent swatches (built here so the list lives in one place)
const swatches = $('ap-accent');
for (const [v, name] of ACCENTS) {
  const s = document.createElement('button');
  s.type = 'button'; s.className = 'swatch'; s.dataset.v = v; s.title = name; s.setAttribute('aria-label', `${name} accent`);
  s.onclick = () => applyAppearance({ accent: v });
  swatches.append(s);
}

// ---- top-bar theme toggle: cycles Auto → Light → Dark ----
function updateThemeToggle() {
  const b = $('theme-toggle');
  b.dataset.mode = appearance.mode;
  b.title = `Theme: ${{ auto: 'Auto (follows Windows)', light: 'Light', dark: 'Dark' }[appearance.mode]}. Click to change.`;
}
$('theme-toggle').onclick = () => applyAppearance({ mode: { auto: 'light', light: 'dark', dark: 'auto' }[appearance.mode] });
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', updateThemeToggle);
window.addEventListener('resize', () => document.querySelectorAll('.seg-ctl[data-key]').forEach(segThumb));

// The saved config wins over this PC's quick copy (e.g. after copying the portable folder to another PC).
(async () => {
  try {
    const cfg = await openport.getConfig();
    if (cfg.appearance) applyAppearance(cfg.appearance, { save: false, animate: false });
    else syncAppearanceControls();
  } catch { syncAppearanceControls(); }
  updateThemeToggle();
})();
