/* Card, StatTile, ProgressRing, MiniBar, KeyValue, EmptyState, Skeleton. */
import { el } from './el.js';
import { icon } from './icons.js';
import { onFirstVisible, reducedMotion } from './motion.js';
import { fmtNumber } from '../format.js';

/**
 * Card({title, meta, actions, body, footer, variant: 'default' | 'accent-left', tone, level, id}).
 * accent-left — status rəngli sol zolaq (tone: success | warning | danger | info | neutral).
 */
export function Card({ title, meta, actions, body, footer, variant = 'default', tone = 'neutral', level = 3, id, tag = 'section' } = {}) {
  const head = title || meta || actions
    ? el('header', { class: 'ui-card__head' },
      el('div', { class: 'ui-card__titles' },
        title ? el(`h${level}`, { class: 'ui-card__title', text: typeof title === 'string' ? title : null }, typeof title === 'string' ? null : title) : null,
        meta ? el('p', { class: 'ui-card__meta' }, meta) : null),
      actions ? el('div', { class: 'ui-card__actions' }, actions) : null)
    : null;
  return el(tag, { class: ['ui-card', variant === 'accent-left' && `ui-card--accent ui-card--${tone}`], id },
    head, body ? el('div', { class: 'ui-card__body' }, body) : null, footer ? el('footer', { class: 'ui-card__foot' }, footer) : null);
}

/**
 * ProgressRing({value: 0–100, size, stroke, label, center}) — dairəvi progress, ilk görünəndə 600ms dolur.
 * label — ekran oxuyucu üçün ("Hazırlıq 77%"); center — mərkəzdəki mətn (default "77%").
 */
export function ProgressRing({ value = 0, size = 64, stroke = 6, label, center, tone = 'accent' } = {}) {
  const v = Math.max(0, Math.min(100, Number(value) || 0));
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const arc = el('circle', {
    class: 'ui-ring__arc', cx: size / 2, cy: size / 2, r, 'stroke-width': stroke,
    'stroke-dasharray': c.toFixed(2), 'stroke-dashoffset': c.toFixed(2),
  });
  const svg = el('svg', { class: 'ui-ring__svg', viewBox: `0 0 ${size} ${size}`, width: size, height: size, 'aria-hidden': 'true' },
    el('circle', { class: 'ui-ring__track', cx: size / 2, cy: size / 2, r, 'stroke-width': stroke }), arc);
  const text = el('span', { class: 'ui-ring__value', text: center ?? `${fmtNumber(v)}%` });
  const node = el('div', {
    class: ['ui-ring', `ui-ring--${tone}`, size < 56 && 'ui-ring--sm'], role: 'img', 'aria-label': label || `${fmtNumber(v)}%`,
    style: { '--ring-size': `${size}px` },
  }, svg, text);
  const fill = () => arc.setAttribute('stroke-dashoffset', (c * (1 - v / 100)).toFixed(2));
  if (reducedMotion()) { arc.classList.add('is-static'); fill(); } else onFirstVisible(node, () => requestAnimationFrame(fill));
  node.setValue = (nv) => { const k = Math.max(0, Math.min(100, nv)); arc.setAttribute('stroke-dashoffset', (c * (1 - k / 100)).toFixed(2)); text.textContent = `${fmtNumber(k)}%`; };
  return node;
}

/** MiniBar: tək progress (value/max) və ya seqmentli stacked bar ([{value, tone, label}]). */
export function MiniBar({ value, max, segments, label } = {}) {
  const bar = el('div', { class: 'ui-minibar', role: 'img', 'aria-label': label || '' });
  const parts = segments || [{ value, tone: 'accent' }, { value: Math.max(0, (max || 0) - (value || 0)), tone: 'track' }];
  const total = parts.reduce((s, p) => s + (p.value || 0), 0) || 1;
  for (const p of parts) {
    if (!p.value) continue;
    bar.append(el('span', { class: `ui-minibar__seg ui-minibar__seg--${p.tone}`, style: { flexGrow: String(p.value / total) }, title: p.label }));
  }
  return bar;
}

/**
 * StatTile({label, value, format, sub, delta: {text, tone}, onClick, progress: {value, max}, segments, ring}).
 * onClick varsa tile düymədir (klaviatura ilə əlçatan). Rəqəm həmişə son dəyəri göstərir.
 */
export function StatTile({ label, value, format = (v) => fmtNumber(Math.round(v)), unit, sub, delta, onClick, progress, segments, tone } = {}) {
  const valueNode = el('span', { class: 'ui-tile__num' });
  const body = [
    el('span', { class: 'ui-tile__label', text: label }),
    el('span', { class: 'ui-tile__value' }, valueNode, unit ? el('span', { class: 'ui-tile__unit', text: unit }) : null),
    progress || segments ? MiniBar({ ...(progress || {}), segments, label: sub || label }) : null,
    sub ? el('span', { class: 'ui-tile__sub', text: sub }) : null,
    delta ? el('span', { class: `ui-tile__delta tone-${delta.tone || 'neutral'}`, text: delta.text }) : null,
  ];
  const node = onClick
    ? el('button', { type: 'button', class: ['ui-tile', 'ui-tile--action', tone && `ui-tile--${tone}`], on: { click: onClick } }, ...body, icon('chevronRight', { size: 'sm' }))
    : el('div', { class: ['ui-tile', tone && `ui-tile--${tone}`] }, ...body);
  if (typeof value === 'number') {
    valueNode.textContent = format(value);
  } else valueNode.textContent = value ?? '—';
  return node;
}

/** KeyValue([[etiket, dəyər], …]) — etiket sütunu max-content. */
export function KeyValue(pairs, { dense = false } = {}) {
  return el('dl', { class: ['ui-kv', dense && 'ui-kv--dense'] },
    pairs.filter(Boolean).map(([k, v]) => [el('dt', { text: k }), el('dd', null, v ?? '—')]));
}

/** EmptyState({icon, title, text, action: {label, onClick}}). */
export function EmptyState({ icon: iconName = 'empty', title, text, action, compact = false } = {}) {
  return el('div', { class: ['ui-empty', compact && 'ui-empty--compact'] },
    el('span', { class: 'ui-empty__icon' }, icon(iconName, { size: 'lg' })),
    el('p', { class: 'ui-empty__title', text: title }),
    text ? el('p', { class: 'ui-empty__text', text }) : null,
    action ? el('button', { type: 'button', class: 'btn', on: { click: action.onClick } }, action.label) : null);
}

/** Skeleton({shape: 'text' | 'tile' | 'card' | 'table', lines, rows}) — yüklənmə zamanı shimmer. */
export function Skeleton({ shape = 'text', lines = 3, rows = 4 } = {}) {
  const line = (w) => el('span', { class: 'ui-skel-line', style: { width: w } });
  let content;
  if (shape === 'tile') content = [line('40%'), el('span', { class: 'ui-skel-line ui-skel-line--lg', style: { width: '55%' } }), line('70%')];
  else if (shape === 'card') content = [el('span', { class: 'ui-skel-line ui-skel-line--lg', style: { width: '45%' } }), ...Array.from({ length: lines }, (_, i) => line(`${90 - i * 12}%`))];
  else if (shape === 'table') content = Array.from({ length: rows }, () => el('span', { class: 'ui-skel-row' }, line('30%'), line('15%'), line('15%'), line('12%')));
  else content = Array.from({ length: lines }, (_, i) => line(i === lines - 1 ? '60%' : '100%'));
  return el('div', { class: ['ui-skel', `ui-skel--${shape}`], 'aria-busy': 'true', 'aria-label': 'Yüklənir…', role: 'status' }, content);
}
