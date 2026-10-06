/* Müqayisə tabı. */
import { $, badge, el, formatAz, formatDate, formatValue } from '../core/dom.js';
import { REQ_STATUS, STATUS_LABELS, TREND, VERDICT_TONE } from '../core/labels.js';
import { openCheck } from '../core/router.js';
import { state } from '../core/state.js';

/* ── Müqayisə ───────────────────────────────────────────────────────────── */

function trendBadge(trend) { const t = TREND[trend] || TREND.deyisdi; return badge(t.cls, t.label); }
function transition(before, after) {
  const cell = el('td', 'trans');
  cell.append(before, el('span', 'trans__arrow', '→'), after);
  return cell;
}
function cmpTable(headers, rows) {
  const table = el('table', 'table');
  const tr = el('tr');
  headers.forEach((h) => { const th = el('th', h.num ? 'num' : null, h.label); th.scope = 'col'; tr.append(th); });
  const head = el('thead');
  head.append(tr);
  const body = el('tbody');
  rows.forEach((r) => body.append(r));
  table.append(head, body);
  const wrap = el('div', 'tablewrap');
  wrap.append(table);
  return wrap;
}
function cmpSection(title, count, content) {
  const box = el('section', 'cmpsec');
  const head = el('h3', 'cmpsec__title', title);
  head.append(el('span', 'cmpsec__count', String(count)));
  box.append(head, content);
  return box;
}
function renderComparison(comparison) {
  const host = $('cmp-body');
  host.replaceChildren();
  const empty = $('cmp-empty');
  if (!comparison || !comparison.available) {
    empty.textContent = 'Bu planın əvvəlki tamamlanmış versiyası yoxdur. Eyni plan adı ilə yeni versiya '
      + 'yükləsəniz, dəyişikliklər burada görünəcək.';
    empty.hidden = false;
    return;
  }
  empty.hidden = true;
  const prev = comparison.previous || {};
  const intro = el('div', 'cmphead');
  const line = el('p', null, 'Əvvəlki versiya ilə müqayisə: ');
  const link = el('button', 'linkbtn', 'v' + prev.version + ' · ' + (prev.file_name || ''));
  link.type = 'button';
  link.addEventListener('click', () => openCheck(prev.check_id));
  line.append(link, document.createTextNode(' · ' + formatDate(prev.created_at)));
  intro.append(line);
  const verdicts = (state.meta && state.meta.verdicts) || {};
  const change = comparison.verdict;
  if (change && change.before && change.after) {
    const vb = (v) => badge('s-' + (VERDICT_TONE[v] || 'skip'), verdicts[v] || v);
    const row = el('p', 'cmpverdict');
    row.append(el('span', null, 'Status: '), vb(change.before), el('span', 'trans__arrow', '→'), vb(change.after));
    intro.append(row);
  }
  const counts = comparison.counts || {};
  const chips = el('div', 'cmpcounts');
  [[counts.yaxsilasdi, 'yaxşılaşıb', 's-ok'], [counts.pislesdi, 'pisləşib', 's-fail'],
   [counts.filled, 'boş yer doldurulub', 's-ok'], [counts.added, 'yeni boş yer', 's-warn']]
    .forEach(([n, label, cls]) => chips.append(badge(n ? cls : 's-skip', formatAz(n || 0) + ' ' + label)));
  intro.append(chips);
  host.append(intro);

  const ph = comparison.placeholders || { filled: [], added: [] };
  const phRows = [];
  [['filled', 's-ok', 'Doldurulub'], ['added', 's-warn', 'Yeni']].forEach(([key, cls, label]) => {
    (ph[key] || []).forEach((p) => {
      const row = el('tr');
      const s = el('td');
      s.append(badge(cls, label));
      row.append(el('td', 'mono', p.text), el('td', null, p.section_title), el('td', 'num', formatAz(p.count)), s);
      phRows.push(row);
    });
  });
  const phBox = el('div');
  phBox.append(el('p', 'note', 'Boş yerlər: ' + formatAz(ph.before) + ' → ' + formatAz(ph.after)));
  if (phRows.length) phBox.append(cmpTable([{ label: 'İfadə' }, { label: 'Bölmə' }, { label: 'Say', num: true }, { label: 'Dəyişiklik' }], phRows));
  host.append(cmpSection('Boş yerlər', phRows.length, phBox));

  const finStatus = (s) => badge('s-' + (s || 'skip'), STATUS_LABELS[s] || s || '—');
  const finRows = (comparison.finance || []).map((c) => {
    const row = el('tr');
    const title = el('td');
    title.append(el('span', 'rowtitle', c.title));
    if (c.critical) title.append(el('span', 'crit', 'KRİTİK'));
    const t = el('td');
    t.append(trendBadge(c.trend));
    row.append(title, transition(el('span', 'num', formatValue(c.claimed_before, c)), el('span', 'num', formatValue(c.claimed_after, c))),
      transition(finStatus(c.status_before), finStatus(c.status_after)), t);
    return row;
  });
  host.append(cmpSection('Maliyyə yoxlamaları', finRows.length, finRows.length
    ? cmpTable([{ label: 'Yoxlama' }, { label: 'Planda' }, { label: 'Status' }, { label: 'Nəticə' }], finRows)
    : el('p', 'note', 'Maliyyə yoxlamalarında dəyişiklik yoxdur.')));

  const reqStatus = (s) => { const m = REQ_STATUS[s] || { label: s || '—', cls: 's-skip' }; return badge(m.cls, m.label); };
  const reqRows = (comparison.requirements || []).map((r) => {
    const row = el('tr');
    const text = el('td');
    text.append(el('div', null, r.text), el('div', 'ctx', r.group_title));
    const t = el('td');
    t.append(trendBadge(r.trend));
    row.append(el('td', 'mono', r.req_id), text, transition(reqStatus(r.status_before), reqStatus(r.status_after)), t);
    return row;
  });
  host.append(cmpSection('Tələblərin statusu', reqRows.length, reqRows.length
    ? cmpTable([{ label: 'Bənd' }, { label: 'Tələb' }, { label: 'Status' }, { label: 'Nəticə' }], reqRows)
    : el('p', 'note', 'Tələblərin statusunda dəyişiklik yoxdur.')));

  // Tələb SİYAHISININ dəyişməsi — planın yaxşılaşması/pisləşməsi kimi göstərilmir.
  const lists = comparison.requirement_list || { added: [], removed: [], changed: [] };
  const listRows = [];
  [['added', 'Tələb əlavə edildi'], ['removed', 'Tələb çıxarıldı'], ['changed', 'Tələb dəyişdi']].forEach(([key, label]) => {
    (lists[key] || []).forEach((r) => {
      const row = el('tr');
      const text = el('td');
      text.append(el('div', null, r.text));
      if (r.text_before) text.append(el('div', 'ctx', 'Əvvəl: ' + r.text_before));
      const kind = el('td');
      kind.append(badge('s-doc', label));
      row.append(el('td', 'mono', r.req_id), text, kind);
      listRows.push(row);
    });
  });
  const listBox = el('div');
  listBox.append(el('p', 'note', 'Meyarların dəyişməsidir — biznes planın yaxşılaşması və ya pisləşməsi sayılmır.'));
  if (listRows.length) listBox.append(cmpTable([{ label: 'Bənd' }, { label: 'Tələb' }, { label: 'Dəyişiklik' }], listRows));
  host.append(cmpSection('Tələb siyahısı', listRows.length, listBox));

  const carried = comparison.carried || [];
  if (carried.length) {
    // Texniki qərar tarixçəsi — bağlı; əsas nəticədə hər bənd üçün BİR status göstərilir.
    const label = (s) => (REQ_STATUS[s] || REQ_STATUS.skip).label;
    const history = el('details', 'history');
    history.append(el('summary', null, 'Qiymətləndirmə tarixçəsi (' + carried.length + ' bənd)'),
      el('p', null, 'Bölmənin mətni dəyişmədiyi üçün əvvəlki versiyanın statusu saxlanılıb: '
        + carried.map((c) => c.req_id + ' — ' + label(c.status_kept) + ' (yeni qiymətləndirmə: '
          + label(c.status_model).toLowerCase() + ')').join('; ') + '.'));
    host.append(history);
  }
}

export { renderComparison };
