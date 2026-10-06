/* Detal paneli (fokus tələsi, arxa fon inert). */
import { $ } from '../core/dom.js';
import { state } from '../core/state.js';

/* ── Detal paneli (fokus tələsi, arxa fon inert) ────────────────────────── */

function markActiveRow(row) {
  document.querySelectorAll('.is-active').forEach((r) => r.classList.remove('is-active'));
  if (row) row.classList.add('is-active');
}
function openDetail(title, build, row) {
  state.lastFocus = document.activeElement;
  $('detail-title').textContent = title;
  const body = $('detail-body');
  body.replaceChildren();
  build(body);
  $('detail').hidden = false;
  $('detail-scrim').hidden = false;
  document.querySelector('.shell').inert = true;
  $('demo-banner').inert = true;
  markActiveRow(row);
  $('detail-close').focus();
}
function closeDetail() {
  if ($('detail').hidden) return;
  $('detail').hidden = true;
  $('detail-scrim').hidden = true;
  document.querySelector('.shell').inert = false;
  $('demo-banner').inert = false;
  markActiveRow(null);
  if (state.lastFocus && document.contains(state.lastFocus)) state.lastFocus.focus();
  state.lastFocus = null;
}
function trapFocus(e) {
  if ($('detail').hidden || e.key !== 'Tab') return;
  const focusable = [...$('detail').querySelectorAll('button, [href], input, select, textarea, summary, [tabindex]:not([tabindex="-1"])')]
    .filter((n) => !n.disabled && n.offsetParent !== null);
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}

export { closeDetail, openDetail, trapFocus };
