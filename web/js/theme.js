import { groupOf } from './common.js';

// Canvas colours come from the CSS custom properties, so style.css stays the single source of the palette.
export const PAL = {};
const KEYS = ['night', 'band', 'star', 'dim', 'rule', 'gold', 'l-line', 'l-reborn', 'l-cross', 'l-kill', 'l-deva', 'l-tell', 'l-reign', 'l-story',
  'k-person', 'k-sage', 'k-avatar', 'k-deva', 'k-event', 'k-story'];

function readPalette() {
  const cs = getComputedStyle(document.documentElement);
  KEYS.forEach(k => { PAL[k] = cs.getPropertyValue('--' + k).trim(); });
  PAL.kill = PAL['l-kill'];
}

export const edgeColor = t => PAL['l-' + groupOf(t)];
export const nodeColor = n => PAL['k-' + n.kind] || PAL['k-person'];

export function initTheme(button, onChange) {
  const set = t => {
    document.documentElement.dataset.theme = t;
    button.setAttribute('aria-pressed', String(t === 'light'));
    readPalette();
    onChange();
  };
  button.onclick = () => {
    const t = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
    try { localStorage.setItem('yc-theme', t); } catch (_) {}
    set(t);
  };
  let saved = null;
  try { saved = localStorage.getItem('yc-theme'); } catch (_) {}
  set(saved === 'light' ? 'light' : 'dark');
}
