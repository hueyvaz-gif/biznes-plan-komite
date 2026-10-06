/* Maliyyə tabı. */
import { api } from '../core/api.js';
import { $, badge, el, formatAz, formatValue, group, icon, setBusy, writtenDecimals } from '../core/dom.js';
import { STATUS_LABELS } from '../core/labels.js';
import { state } from '../core/state.js';
import { openDetail } from '../shell/detail.js';
import { resultParts } from './summary.js';

/* ── Maliyyə ────────────────────────────────────────────────────────────── */

function setFinanceFilter(name) {
  state.finFilter = name;
  document.querySelectorAll('[data-fin]').forEach((chip) => {
    chip.classList.toggle('is-on', chip.dataset.fin === name);
    chip.setAttribute('aria-pressed', chip.dataset.fin === name ? 'true' : 'false');
  });
  if (state.check) renderFinance(resultParts(state.check).finance);
}
function renderFinance(finance) {
  const body = $('fin-body');
  body.replaceChildren();
  const visible = (finance.checks || []).filter((c) => {
    if (state.finFilter === 'problem') return c.status === 'fail' || c.status === 'warn';
    if (state.finFilter === 'skip') return c.status === 'skip';
    return true;
  });
  $('fin-empty').hidden = visible.length > 0;
  $('fin-empty').textContent = 'Bu süzgəcə uyğun yoxlama yoxdur.';
  $('fin-table').hidden = visible.length === 0;
  const all = finance.checks || [];
  $('fin-c-hamisi').textContent = String(all.length);
  $('fin-c-problem').textContent = String(all.filter((c) => c.status === 'fail' || c.status === 'warn').length);
  $('fin-c-skip').textContent = String(all.filter((c) => c.status === 'skip').length);
  const STAT_ICON = { ok: 'check', warn: 'alert', fail: 'x', skip: 'minus' };
  visible.forEach((check) => {
    const row = el('tr', 'frow frow--' + check.status);
    const title = el('td', 'ftitle');
    const mark = el('span', 'fstat fstat--' + check.status);
    mark.setAttribute('aria-hidden', 'true');
    mark.append(icon(STAT_ICON[check.status] || 'minus'));
    const name = el('span', 'ftitle__text');
    name.append(el('span', 'rowtitle', check.title));
    if (check.critical) name.append(el('span', 'crit', 'Kritik'));
    title.append(mark, name);
    const cell = (label, value, cls) => { const td = el('td', 'num' + (cls ? ' ' + cls : ''), value); td.dataset.label = label; return td; };
    const diff = el('td', 'num fdiffcell');
    diff.dataset.label = 'Fərq';
    diff.append(el('span', 'fdiff fdiff--' + check.status, formatValue(check.diff, check)));
    const status = el('td');
    status.append(badge('s-' + check.status, STATUS_LABELS[check.status] || check.status));
    const go = el('td', 'fin__go');
    const more = el('button', 'fin__more');
    more.type = 'button';
    more.append(el('span', null, 'Ətraflı'), icon('chevronRight'));
    more.setAttribute('aria-label', check.title + ' — ətraflı: necə hesablandı və sənəddə harada yazılıb');
    more.addEventListener('click', (e) => { e.stopPropagation(); openFinanceDetail(check, row); });
    go.append(more);
    row.append(title, cell('Planda', formatValue(check.claimed, check, writtenDecimals(finance, check))),
      cell('Hesablama', formatValue(check.computed, check), 'fcalc'), diff, status, go);
    row.addEventListener('click', () => openFinanceDetail(check, row));   // siçan üçün bütün sətir
    body.append(row);
  });

  const notFound = finance.not_found || [];
  const note = $('fin-notfound');
  note.hidden = notFound.length === 0;
  note.textContent = notFound.length ? 'Mənbəsi təsdiqlənmədiyi üçün istifadə edilməyən rəqəmlər: '
    + notFound.map((n) => n.label + ' (' + formatAz(n.value, 2) + ')' + (n.reason ? ' — ' + n.reason : '')).join('; ') + '.' : '';
}
function renderCharts(finance) {
  const host = $('charts');
  host.replaceChildren();
  const charts = finance.charts || {};
  const width = window.innerWidth < 600 ? 360 : 640;    // dar ekranda yazılar sıxılmasın
  host.append(
    Charts.chartCard('bar', 'Sərbəst pul axını (FCFF) illər üzrə', charts.fcff, width),
    Charts.chartCard('line', 'Kumulyativ pul axını', charts.cumulative, width),
    Charts.chartCard('split', 'Maliyyələşmə mənbələrinin bölgüsü', charts.funding, width),
    Charts.chartCard('split', 'İnvestisiya: əsas və dövriyyə vəsaitləri', charts.investment, width),
  );
}
function openFinanceDetail(check, row) {
  openDetail(check.title, (body) => {
    const head = el('p');
    head.append(badge('s-' + check.status, STATUS_LABELS[check.status] || check.status));
    if (check.critical) head.append(el('span', 'crit', 'KRİTİK'));
    body.append(head, group('İzah', el('p', null, check.detail)));
    if (check.claimed !== null || check.computed !== null) {
      const list = el('dl', 'kv');
      const written = writtenDecimals((resultParts(state.check).finance), check);
      [['Planda göstərilən', check.claimed, written], ['Yenidən hesablanmış', check.computed],
       ['Fərq', check.diff]]
        .forEach(([label, value, d]) => list.append(el('dt', null, label), el('dd', null, formatValue(value, check, d))));
      body.append(group('Rəqəmlər', list));
    }
    if ((check.unread_cells || []).length) {
      body.append(group('Oxunmayan xanalar', el('p', null,
        check.unread_cells.map((u) => u.year + ' — ' + u.rows.join(', ')).join('; '))));
    }
    const evidence = check.evidence || {};
    if (evidence.cashflow) {
      body.append(group('Cədvəldən (sənəddə yazıldığı kimi)', cashflowTable(evidence.cashflow)));
    }
    const snippets = evidence.snippets;
    if (snippets && snippets.length) {
      const box = el('div', 'evidence');
      snippets.forEach((sn) => box.append(snippetCard(sn, FIELD_NAMES[sn.field] || sn.label)));
      body.append(group('Mətndə harada yazılıb', box));
    } else if (snippets && !evidence.cashflow) {
      body.append(group('Mətndə harada yazılıb', el('p', 'alert alert--warn',
        'Bu rəqəm sənəddə tapılmadı — agentin verdiyi dəyər istifadə olunmayıb.')));
    } else if (!snippets) {
      // Köhnə nəticə: dəlil paneli yoxdur — əvvəlki mənbə göstərilir.
      if (evidence.table_text) body.append(group('Sənəddən', miniTable(evidence.table_text)));
      else if (evidence.quote) body.append(group('Sənəddən', el('blockquote', 'quote', evidence.quote)));
    }
    if (check.rule) body.append(group('Yoxlama qaydası', el('p', 'rule', check.rule)));
  }, row);
}
const FIELD_NAMES = {
  investment_total: 'Ümumi investisiya', fixed_assets_investment: 'Əsas vəsaitlər',
  working_capital_investment: 'Dövriyyə kapitalı', capacity_t_per_hour: 'Məhsuldarlıq',
  nominal_capacity_t: 'Nominal güc', practical_capacity_t: 'Praktiki güc', utilization_pct: 'Gücdən istifadə',
  npv: 'NPV', discount_rate_pct: 'Diskont dərəcəsi', irr_pct: 'IRR', payback_years: 'Geri ödəmə',
};
/** Parça + <mark>: vurğu xam mətndəki mövqeyə görə; üç hissə AYRI-AYRI textContent ilə. */
function markedText(text, mark) {
  const box = el('blockquote', 'quote');
  if (!mark || mark[0] < 0 || mark[1] > text.length) { box.textContent = text; return box; }
  box.append(document.createTextNode(text.slice(0, mark[0])), el('mark', 'hit', text.slice(mark[0], mark[1])),
    document.createTextNode(text.slice(mark[1])));
  return box;
}
/** Parçanın üstündə bölmə adı və "Tam bölməni göstər". */
function snippetCard(sn, label) {
  const card = el('div', 'snippet');
  const head = el('div', 'snippet__head');
  head.append(el('span', 'snippet__title', (label ? label + ' · ' : '') + (sn.section_title || '')));
  const quote = markedText(sn.text || '', sn.mark);
  if (sn.section_title) head.append(fullSectionButton(sn.section_title, quote, sn));
  card.append(head, quote);
  return card;
}
function previewCard(pv) {
  const card = el('div', 'snippet');
  const head = el('div', 'snippet__head');
  head.append(el('span', 'snippet__title', pv.section_title));
  const quote = el('blockquote', 'quote', pv.text);
  if (pv.truncated) head.append(fullSectionButton(pv.section_title, quote, null));
  card.append(head, quote);
  if (pv.tables && pv.tables.length) {
    card.append(el('p', 'note', 'Bu bölmədəki cədvəllər: ' + pv.tables.map((t) => t.id + ' — ' + t.caption).join('; ')));
  }
  return card;
}
/** Tam bölmə mətnini gətirir və parçanın yerinə qoyur (vurğu ilk uyğun yerdə saxlanılır). */
function fullSectionButton(title, quote, sn) {
  const button = el('button', 'linkbtn snippet__more', 'Tam bölməni göstər');
  button.type = 'button';
  button.addEventListener('click', async () => {
    if (!state.check) return;
    setBusy(button, true, 'Yüklənir…');
    try {
      const data = await api.get('/api/checks/' + encodeURIComponent(state.check.id)
        + '/section?title=' + encodeURIComponent(title));
      const marked = sn && sn.mark ? sn.text.slice(sn.mark[0], sn.mark[1]) : null;
      const at = marked ? data.text.indexOf(marked) : -1;
      quote.replaceWith(markedText(data.text, at >= 0 ? [at, at + marked.length] : null));
      button.remove();
    } catch (e) {
      setBusy(button, false);
      button.textContent = e.message || 'Bölmə yüklənmədi';
    }
  });
  return button;
}
/** İllər başlığı + sətirlər (xam xana mətni); problemli il sütunu işarə və mətnlə. */
function cashflowTable(cash) {
  const table = el('table', 'minitable minitable--cash');
  table.append(el('caption', 'sr-only', cash.table_id + (cash.caption ? ' — ' + cash.caption : '')));
  const head = el('tr');
  head.append(el('th', null, 'Sətir'));
  cash.years.forEach((year) => {
    const th = el('th', year === cash.highlight_year ? 'is-bad' : null,
      year === cash.highlight_year ? '⚠ ' + year : String(year));
    th.scope = 'col';
    if (year === cash.highlight_year) th.title = 'Bu ildə FCFF komponentlərin cəmindən fərqlənir';
    head.append(th);
  });
  const thead = el('thead');
  thead.append(head);
  const tbody = el('tbody');
  cash.rows.forEach((r) => {
    const tr = el('tr');
    const th = el('th', null, r.label);
    th.scope = 'row';
    tr.append(th);
    r.cells.forEach((cell, i) => tr.append(el('td', cash.years[i] === cash.highlight_year ? 'num is-bad' : 'num', cell)));
    tbody.append(tr);
  });
  table.append(thead, tbody);
  const box = el('div', 'snippet');
  box.append(el('p', 'snippet__title', cash.table_id + (cash.caption ? ' — ' + cash.caption : '')
    + (cash.section_title ? ' · ' + cash.section_title : '')));
  const wrap = el('div', 'tablewrap');
  wrap.append(table);
  box.append(wrap);
  if (cash.highlight_year) box.append(el('p', 'note', '⚠ ' + cash.highlight_year + ' — uyğunsuz il.'));
  return box;
}
function miniTable(text) {
  const table = el('table', 'minitable');
  const body = el('tbody');
  text.split('\n').slice(0, 20).forEach((line) => {
    const row = el('tr');
    line.split(' | ').forEach((cell) => row.append(el('td', null, cell)));
    body.append(row);
  });
  table.append(body);
  const wrap = el('div', 'tablewrap');
  wrap.append(table);
  return wrap;
}

export { openFinanceDetail, previewCard, renderCharts, renderFinance, setFinanceFilter, snippetCard };
