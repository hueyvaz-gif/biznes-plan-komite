/* Maliyyələşmə: donut + legend (mərkəzdə cəmi) və "investisiya ↔ mənbələr" müqayisə zolağı.
 * Fərq backend-in yoxlamasından (menbeler_cemi.diff) gəlir — burada hesablanmır. */
import { el } from '../ui/el.js';
import { onFirstVisible } from '../ui/motion.js';
import { fmtMoney, fmtPct } from '../format.js';

const TONES = ['cfd--1', 'cfd--2', 'cfd--3', 'cfd--4', 'cfd--5'];

/** donut({title, parts: [{label, value}], total, centerLabel}) */
export function donut({ parts, total, centerLabel = 'Cəmi', label }) {
  const size = 168; const stroke = 22; const r = (size - stroke) / 2; const c = 2 * Math.PI * r;
  const sum = total || parts.reduce((s, p) => s + p.value, 0) || 1;
  let offset = 0;
  const segs = parts.map((p, i) => {
    const len = (p.value / sum) * c;
    const seg = el('circle', {
      class: `cfd__seg ${TONES[i % TONES.length]}`, cx: size / 2, cy: size / 2, r, 'stroke-width': stroke,
      'stroke-dasharray': `${Math.max(0, len - 2).toFixed(2)} ${c.toFixed(2)}`, 'stroke-dashoffset': (-offset).toFixed(2),
      style: { '--i': String(i) },
    });
    offset += len;
    return seg;
  });
  const svg = el('svg', { class: 'cfd__svg', viewBox: `0 0 ${size} ${size}`, width: size, height: size, 'aria-hidden': 'true' },
    el('circle', { class: 'cfd__track', cx: size / 2, cy: size / 2, r, 'stroke-width': stroke }), el('g', { transform: `rotate(-90 ${size / 2} ${size / 2})` }, segs));
  const center = el('div', { class: 'cfd__center' },
    el('span', { class: 'cfd__clabel', text: centerLabel }), el('span', { class: 'cfd__cvalue', text: fmtMoney(sum, { compact: true }) }));
  const legend = el('ul', { class: 'cfd__legend' }, parts.map((p, i) => el('li', null,
    el('span', { class: `cfd__key ${TONES[i % TONES.length]}` }),
    el('span', { class: 'cfd__name', text: p.label }),
    el('span', { class: 'cfd__val', text: fmtMoney(p.value) }),
    el('span', { class: 'cfd__share', text: fmtPct(p.value / sum) }))));
  const aria = label || `${centerLabel}: ${fmtMoney(sum)}. ` + parts.map((p) => `${p.label} ${fmtMoney(p.value)} (${fmtPct(p.value / sum)})`).join('; ') + '.';
  const ring = el('div', { class: 'cfd__ring', role: 'img', 'aria-label': aria }, svg, center);
  const node = el('div', { class: 'cfd' }, ring, legend);
  onFirstVisible(node, () => node.classList.add('is-in'), { threshold: 0.3 });
  return node;
}

/**
 * gapBars({investment, sources, diff, status}) — iki üfüqi zolaq: investisiya və mənbələrin cəmi.
 * Mənbələr investisiyadan çoxdursa artıq hissə kəhrəba ştrixli seqmentdir; azdırsa çatışmayan hissə qırmızı.
 */
export function gapBars({ investment, sources, diff }) {
  const max = Math.max(investment, sources) || 1;
  const row = (label, value, parts) => el('div', { class: 'cfg__row' },
    el('span', { class: 'cfg__label', text: label }),
    el('span', { class: 'cfg__track' }, parts.map(([w, cls]) => el('span', { class: `cfg__seg ${cls}`, style: { width: `${(w / max) * 100}%` } }))),
    el('span', { class: 'cfg__val', text: fmtMoney(value) }));
  const over = sources > investment;
  const gap = Math.abs(diff != null ? diff : sources - investment);
  const note = gap < 1 ? 'Mənbələrin cəmi investisiyaya bərabərdir.'
    : over ? `Mənbələr investisiyadan ${fmtMoney(gap)} çoxdur — hansı sütunun (başlanğıc və ya “Cəmi”) əsas götürüldüyü dəqiqləşdirilməlidir.`
      : `Mənbələr investisiyanı ${fmtMoney(gap)} qədər örtmür.`;
  const node = el('div', { class: ['cfg', gap >= 1 && (over ? 'cfg--over' : 'cfg--under')] },
    row('İnvestisiya', investment, [[investment, 'cfg__seg--inv']]),
    row('Mənbələr', sources, over ? [[investment, 'cfg__seg--src'], [sources - investment, 'cfg__seg--over']] : [[sources, 'cfg__seg--src']]),
    gap >= 1 ? el('p', { class: 'cfg__note' }, el('strong', { text: (over ? '+' : '−') + fmtMoney(gap) }), ' ', note) : el('p', { class: 'cfg__note', text: note }));
  onFirstVisible(node, () => node.classList.add('is-in'), { threshold: 0.3 });
  return node;
}
