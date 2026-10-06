/* İkonlar — 24×24 xətt ikonları (stroke). icon('check') → <span class="icon"><svg>…</svg></span>. */
import { el } from './el.js';

export const ICONS = {
  check: 'M20 6 9 17l-5-5',
  clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 6v6l4 2',
  x: 'M18 6 6 18M6 6l12 12',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  upload: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12',
  alert: 'M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
  info: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 16v-4M12 8h.01',
  help: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01',
  dot: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  circle: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z',
  file: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6',
  fileText: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M16 13H8M16 17H8M10 9H8',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3',
  chevronDown: 'M6 9l6 6 6-6',
  chevronRight: 'M9 18l6-6-6-6',
  chevronLeft: 'M15 18l-6-6 6-6',
  arrowRight: 'M5 12h14M12 5l7 7-7 7',
  arrowUp: 'M12 19V5M5 12l7-7 7 7',
  arrowDown: 'M12 5v14M19 12l-7 7-7-7',
  locate: 'M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11zM12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  quote: 'M7 7h4v4c0 3-2 5-4 6M15 7h4v4c0 3-2 5-4 6',
  table: 'M3 5h18v14H3zM3 10h18M3 15h18M9 5v14',
  paragraph: 'M13 4v16M17 4v16M19 4H9.5a4.5 4.5 0 0 0 0 9H13',
  empty: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM5.6 18.4 18.4 5.6',
  sun: 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4',
  moon: 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z',
  monitor: 'M3 4h18v12H3zM8 20h8M12 16v4',
  undo: 'M3 7v6h6M3 13a9 9 0 1 0 3-7.7L3 7',
  func: 'M15 4h-2a3 3 0 0 0-3 3v13M7 10h7M14 14l5 5M19 14l-5 5',
  external: 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14 21 3',
};

export function svgIcon(name) {
  return el('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true', focusable: 'false' }, el('path', { d: ICONS[name] || '', fill: name === 'dot' ? 'currentColor' : undefined }));
}

/** <span class="icon"> ikonu; size: 'sm' | 'md' (default) | 'lg'. */
export function icon(name, { size, label } = {}) {
  const node = el('span', { class: ['icon', size && size !== 'md' && `icon--${size}`] }, svgIcon(name));
  if (label) { node.setAttribute('role', 'img'); node.setAttribute('aria-label', label); }
  else node.setAttribute('aria-hidden', 'true');
  return node;
}
