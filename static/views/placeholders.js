/* Boş yerlər tabı. */
import { $, badge, el, group } from '../core/dom.js';
import { openDetail } from '../shell/detail.js';
import { snippetCard } from './finance.js';

/* ── Boş yerlər ─────────────────────────────────────────────────────────── */

function renderPlaceholders(items) {
  const body = $('ph-body');
  body.replaceChildren();
  $('ph-empty').hidden = items.length > 0;
  $('ph-table').hidden = items.length === 0;
  items.forEach((item, index) => {
    const row = el('tr');
    row.tabIndex = 0;
    const where = el('td');
    where.append(item.where === 'cədvəl' ? badge('s-doc', 'cədvəl ' + (item.table_id || '')) : badge('s-skip', 'paraqraf'));
    row.append(el('td', 'mono', item.text), el('td', null, item.section_title), where, el('td', 'ctx', item.context));
    const open = () => openPlaceholderDetail(item, index, row);
    row.addEventListener('click', open);
    row.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
    body.append(row);
  });
}
function openPlaceholderDetail(item, index, row) {
  openDetail('Doldurulmamış yer', (body) => {
    const head = el('p');
    head.append(badge('s-warn', 'Doldurulmayıb'));
    body.append(head, group('İfadə', el('p', 'mono', item.text)));
    const source = ['Bölmə: ' + item.section_title];
    if (item.table_id) source.push('Cədvəl ' + item.table_id);
    body.append(group('Mənbə', el('p', null, source.join(' · '))));
    body.append(group('Sənəddən', item.evidence ? snippetCard(item.evidence)
      : (item.context ? highlight(item.context, item.text) : el('p', null, '—'))));
    body.append(group('Qeyd', el('p', 'rule', 'Təqdimatdan əvvəl real məlumatla əvəz olunmalıdır. '
      + 'Eyni ifadənin hər təkrarı ayrıca sətirdir (bu, ' + (index + 1) + '-ci tapıntıdır).')));
  }, row);
}
function highlight(text, needle) {
  const box = el('blockquote', 'quote');
  const at = needle ? text.indexOf(needle) : -1;
  if (at < 0) { box.textContent = text; return box; }
  box.append(document.createTextNode(text.slice(0, at)), el('mark', 'hit', needle),
    document.createTextNode(text.slice(at + needle.length)));
  return box;
}

export { openPlaceholderDetail, renderPlaceholders };
