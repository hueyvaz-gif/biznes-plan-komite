/* DataTable — sütun tipləri: text | number | status | actions.
 * Rəqəm sütunları sağa düzlənir, tabular. Başlıq sticky (top: var(--sticky-stack-h)).
 * < 768px-də kart siyahısına çevrilir: hər xananın data-label-i etiket kimi görünür (CSS). */
import { el } from './el.js';
import { Badge, STATUS_TONE } from './badge.js';
import { toneOf } from '../format.js';

/**
 * DataTable({columns: [{key, label, type, width, render, align, signed}], rows, caption, rowKey, onRowClick, empty}).
 *   width — CSS grid sütun eni deyil, <col> eni (məs. 'minmax(220px, 1.4fr)' dəstəklənmir; '40%' / '12rem').
 *   render(row) — Node | string qaytarır; yoxdursa row[key].
 *   type 'number' + signed → mənfi dəyər qırmızı tonla.
 */
export function DataTable({ columns, rows, caption, rowKey = 'id', onRowClick, empty = 'Məlumat yoxdur', dense = false } = {}) {
  const table = el('table', { class: ['ui-dtable', dense && 'ui-dtable--dense'] });
  if (caption) table.append(el('caption', { class: 'sr-only', text: caption }));
  table.append(el('colgroup', null, columns.map((c) => el('col', { style: c.width ? { width: c.width } : undefined }))));
  table.append(el('thead', null, el('tr', null, columns.map((c) =>
    el('th', { scope: 'col', class: [`ui-dtable__${c.type || 'text'}`], text: c.label })))));
  const tbody = el('tbody');
  if (!rows.length) {
    tbody.append(el('tr', { class: 'ui-dtable__empty' }, el('td', { colSpan: columns.length, text: empty })));
  }
  for (const row of rows) {
    const tr = el('tr', { dataset: { key: row[rowKey] } });
    columns.forEach((c, i) => {
      const raw = row[c.key];
      let content = c.render ? c.render(row) : raw;
      if (c.type === 'status' && !c.render && raw) content = Badge(raw.label, { tone: STATUS_TONE[raw.status] || raw.tone || 'neutral', size: 'sm' });
      const cellTag = i === 0 ? 'th' : 'td';
      const cls = [`ui-dtable__${c.type || 'text'}`];
      if (c.type === 'number' && c.signed && typeof row[c.toneKey || c.key] === 'number') cls.push(`tone-${toneOf(row[c.toneKey || c.key])}`);
      tr.append(el(cellTag, { class: cls, scope: i === 0 ? 'row' : undefined, dataset: { label: c.label } }, content ?? '—'));
    });
    if (onRowClick) {
      tr.classList.add('ui-dtable__row--action');
      tr.addEventListener('click', (e) => { if (!e.target.closest('button, a, input')) onRowClick(row, e); });
    }
    tbody.append(tr);
  }
  table.append(tbody);
  return el('div', { class: 'ui-dtable-wrap' }, table);
}
