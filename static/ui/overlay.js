/* Toast, Tooltip, Drawer. */
import { el, nextId } from './el.js';
import { icon } from './icons.js';
import { t } from '../i18n/az.js';

/* ── Toast ──────────────────────────────────────────────────────────────── */
let region;
function toastRegion() {
  if (!region || !region.isConnected) {
    region = el('div', { class: 'ui-toasts', role: 'status', 'aria-live': 'polite' });
    document.body.append(region);
  }
  return region;
}

/** toast({message, tone: 'success' | 'danger' | 'info', action: {label, onClick}, duration}) → {close}. */
export function toast({ message, tone = 'info', action, duration = 4000 } = {}) {
  const ICON = { success: 'check', danger: 'alert', warning: 'alert', info: 'info' };
  let timer;
  const close = () => {
    clearTimeout(timer);
    node.classList.add('is-leaving');
    setTimeout(() => node.remove(), 160);
  };
  const node = el('div', { class: ['ui-toast', `ui-toast--${tone}`] },
    icon(ICON[tone] || 'info', { size: 'sm' }),
    el('span', { class: 'ui-toast__msg', text: message }),
    action ? el('button', { type: 'button', class: 'ui-toast__action', on: { click: () => { action.onClick(); close(); } } },
      icon('undo', { size: 'sm' }), action.label || t('common.undo')) : null,
    el('button', { type: 'button', class: 'ui-toast__close', 'aria-label': t('common.close'), on: { click: close } }, icon('x', { size: 'sm' })));
  toastRegion().append(node);
  const arm = () => { timer = setTimeout(close, duration); };
  node.addEventListener('mouseenter', () => clearTimeout(timer));
  node.addEventListener('mouseleave', arm);
  node.addEventListener('focusin', () => clearTimeout(timer));
  arm();
  return { close };
}

/* ── Tooltip ────────────────────────────────────────────────────────────── */
let tip;
let showTimer;
function tipNode() {
  if (!tip || !tip.isConnected) {
    tip = el('div', { class: 'ui-tooltip', role: 'tooltip', id: nextId('tip'), hidden: true });
    document.body.append(tip);
  }
  return tip;
}
function place(trigger) {
  const r = trigger.getBoundingClientRect();
  const t2 = tipNode();
  const w = t2.offsetWidth; const h = t2.offsetHeight;
  let top = r.top - h - 8;
  t2.dataset.side = 'top';
  if (top < 8) { top = r.bottom + 8; t2.dataset.side = 'bottom'; }
  const left = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), innerWidth - w - 8);
  t2.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
}
function hide() { clearTimeout(showTimer); if (tip) { tip.hidden = true; tip.classList.remove('is-in'); } }

/**
 * tooltip(trigger, text | () => text) — hover/focus-da 300ms sonra; Esc bağlayır; aria-describedby ilə bağlıdır.
 * Trigger fokuslana bilməyən elementdirsə tabindex=0 alır.
 */
export function tooltip(trigger, content, { delay = 300 } = {}) {
  const show = () => {
    clearTimeout(showTimer);
    showTimer = setTimeout(() => {
      const node = tipNode();
      node.textContent = typeof content === 'function' ? content() : content;
      node.hidden = false;
      trigger.setAttribute('aria-describedby', node.id);
      place(trigger);
      requestAnimationFrame(() => node.classList.add('is-in'));
    }, delay);
  };
  if (!trigger.matches('button, a, input, select, textarea, [tabindex]')) trigger.tabIndex = 0;
  trigger.addEventListener('mouseenter', show);
  trigger.addEventListener('focus', show);
  trigger.addEventListener('mouseleave', hide);
  trigger.addEventListener('blur', hide);
  trigger.addEventListener('keydown', (e) => { if (e.key === 'Escape') hide(); });
  return trigger;
}
// Scroll yalnız GÖRÜNƏN tooltip-i gizlədir; gözləyən taymer qalır (fokus elementi görünüşə sürüşdürəndə də açılsın).
addEventListener('scroll', () => { if (tip && !tip.hidden) { tip.hidden = true; tip.classList.remove('is-in'); } }, { passive: true, capture: true });

/* ── Drawer ─────────────────────────────────────────────────────────────── */
/**
 * openDrawer({title, content, footer, width, onClose}) → {close, body, setTitle}.
 * Native <dialog>.showModal(): fokus tələsi, Esc, arxa fon inert. Bağlananda fokus açan elementə qayıdır.
 */
export function openDrawer({ title, content, footer, width = 560, onClose, label } = {}) {
  const opener = document.activeElement;
  const titleId = nextId('drawer-title');
  const heading = el('h2', { class: 'ui-drawer__title', id: titleId, text: title });
  const body = el('div', { class: 'ui-drawer__body' }, content);
  const dlg = el('dialog', { class: 'ui-drawer', 'aria-labelledby': titleId, style: { '--drawer-w': `${width}px` } },
    el('header', { class: 'ui-drawer__head' }, heading,
      el('button', { type: 'button', class: 'iconbtn ui-drawer__close', 'aria-label': label || t('common.close'), on: { click: () => close() } }, icon('x'))),
    body, footer ? el('footer', { class: 'ui-drawer__foot' }, footer) : null);
  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    dlg.classList.add('is-leaving');
    const done = () => { dlg.close(); dlg.remove(); if (opener && opener.focus) opener.focus(); if (onClose) onClose(); };
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) done(); else setTimeout(done, 200);
  }
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
  dlg.addEventListener('click', (e) => { if (e.target === dlg) close(); });      // fon (::backdrop) kliki
  document.body.append(dlg);
  dlg.showModal();
  return { close, body, dialog: dlg, setTitle: (s) => { heading.textContent = s; } };
}
