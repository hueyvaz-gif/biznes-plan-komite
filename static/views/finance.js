/* Maliyyə tabı. */
import { api } from '../core/api.js';
import { $, badge, el, formatAz, formatValue, group, setBusy, writtenDecimals } from '../core/dom.js';
import { STATUS_LABELS } from '../core/labels.js';
import { state } from '../core/state.js';
import { openDetail } from '../shell/detail.js';
import { selectTab } from '../shell/tabs.js';
import { resultParts } from './summary.js';
import { fmtCheckValue } from './summary-panel.js';
import { cashflowChart } from './cashflow-chart.js';
import { donut, gapBars } from './funding-chart.js';
import { el as el2 } from '../ui/el.js';
import { icon as uiIcon } from '../ui/icons.js';
import { Badge, FilterChips } from '../ui/badge.js';
import { StatTile, KeyValue, EmptyState } from '../ui/card.js';
import { DataTable } from '../ui/table.js';
import { Disclosure, SourceQuote } from '../ui/disclosure.js';
import { openDrawer } from '../ui/overlay.js';
import { reducedMotion } from '../ui/motion.js';
import { fmtMoney, fmtPct } from '../format.js';

/* ── Maliyyə tabı (Faza 4) ──────────────────────────────────────────────
 * Nəticə cümləsi → 4 KPI (İnvestisiya, NPV, IRR, PP) → yoxlamalar cədvəli (sətir yerində açılır)
 * → pul axını hekayəsi (FCFF + kumulyativ, bir qrafikdə) → maliyyələşmə (donut + investisiya ↔ mənbələr).
 * Hər rəqəm API-dən; status etiketi Report.financeLabel (Nəticə tabı ilə eyni). */

const isProblem = (c) => c.status === 'fail' || c.status === 'warn';
const isFormula = (c) => c.claimed == null && c.computed == null && c.status === 'ok' && c.id === 'fcff_dusturu';
const lowerFirst = (s) => (s.length > 1 && s[1] === s[1].toLocaleLowerCase('az') ? s.charAt(0).toLocaleLowerCase('az') + s.slice(1) : s);
const openRows = new Set();
let filterChips = null;

function setFinanceFilter(name) {
  state.finFilter = name;
  if (filterChips && state.check) filterChips.update(filterItems(resultParts(state.check).finance.checks || []), name);
  syncChipAttrs();
  if (state.check) renderFinanceTable(resultParts(state.check).finance);
}
function filterItems(all) {
  return [
    { id: 'hamisi', label: 'Hamısı', count: all.length },
    { id: 'problem', label: 'Problemlilər', count: all.filter(isProblem).length, tone: all.some((c) => c.status === 'fail') ? 'danger' : 'warning' },
    { id: 'skip', label: 'Yoxlanılmayanlar', count: all.filter((c) => c.status === 'skip').length },
  ];
}
/** Köhnə seçicilər ([data-fin]) işləməyə davam edir — testlər və çap üçün. */
function syncChipAttrs() {
  document.querySelectorAll('#fin-filters .ui-chip').forEach((c) => { c.dataset.fin = c.dataset.id; });
}

function renderFinance(finance) {
  const all = finance.checks || [];
  openRows.clear();
  renderLead(all);
  renderKpis(finance);
  filterChips = FilterChips({ label: 'Maliyyə süzgəci', items: filterItems(all), value: state.finFilter || 'hamisi', onChange: setFinanceFilter });
  $('fin-filters').replaceChildren(filterChips);
  syncChipAttrs();
  renderFinanceTable(finance);
  const notFound = finance.not_found || [];
  const note = $('fin-notfound');
  note.hidden = notFound.length === 0;
  note.textContent = notFound.length ? 'Mənbəsi təsdiqlənmədiyi üçün istifadə edilməyən rəqəmlər: '
    + notFound.map((n) => n.label + ' (' + formatAz(n.value, 2) + ')' + (n.reason ? ' — ' + n.reason : '')).join('; ') + '.' : '';
}

/** Bir cümlə: neçəsi uyğundur + problemli yoxlamalar (ad və fərq), etiketə görə qruplaşdırılmış. */
function renderLead(all) {
  const lead = $('fin-lead');
  if (!all.length) { lead.textContent = 'Maliyyə yoxlaması aparılmayıb: planda yenidən hesablanacaq cədvəl tapılmadı.'; return; }
  const ok = all.filter((c) => c.status === 'ok').length;
  const parts = [`${all.length} maliyyə yoxlamasından ${Report.poss(ok)} uyğundur.`];
  const groups = {};
  all.filter((c) => c.status !== 'ok').forEach((c) => {
    const l = Report.financeLabel(c).label;
    (groups[l] ||= []).push(lowerFirst(c.title) + (c.diff && c.status !== 'skip' ? ` (fərq ${fmtCheckValue(c.diff, c, undefined, true)})` : ''));
  });
  Object.entries(groups).forEach(([label, list]) => parts.push(`${label}: ${Report.joinAz(list)}.`));
  lead.textContent = parts.join(' ');
}

const KPIS = [
  ['investisiya_cemi', 'İnvestisiya'], ['npv', 'NPV — xalis cari dəyər'], ['irr', 'IRR — daxili rentabellik'], ['pp', 'PP — özünü ödəmə'],
];
function renderKpis(finance) {
  const checks = finance.checks || [];
  const tiles = KPIS.map(([id, label]) => {
    const c = checks.find((x) => x.id === id);
    if (!c || c.claimed == null) return null;
    const d = writtenDecimals(finance, c);
    const fmt = (v) => (c.unit === 'manat' ? fmtMoney(v, { compact: true }) : fmtCheckValue(v, c, d ?? c.decimals));
    const fl = Report.financeLabel(c);
    const sub = c.status === 'ok' ? 'Planda ↔ yenidən hesablanmış ✓' : `${fl.label}: yenidən hesablanmış ${fmtCheckValue(c.computed, c)}`;
    return StatTile({ label, value: c.claimed, format: fmt, sub, tone: c.status === 'ok' ? undefined : fl.tone, onClick: () => openFinanceRow(c.id) });
  }).filter(Boolean);
  $('fin-kpis').replaceChildren(...tiles);
  $('fin-kpis').hidden = tiles.length === 0;
}

const STAT_ICON = { ok: 'check', warn: 'alert', fail: 'alert', skip: 'minus' };
function renderFinanceTable(finance) {
  const host = $('fin-list');
  const all = finance.checks || [];
  const visible = all.filter((c) => (state.finFilter === 'problem' ? isProblem(c) : state.finFilter === 'skip' ? c.status === 'skip' : true));
  if (!visible.length) {
    host.replaceChildren(EmptyState({ icon: 'check', compact: true, title: all.length ? 'Bu süzgəcə uyğun yoxlama yoxdur' : 'Maliyyə yoxlaması aparılmayıb' }));
    return;
  }
  const table = el2('table', { class: 'fintbl' },
    el2('caption', { class: 'sr-only', text: 'Maliyyə yoxlamaları' }),
    el2('colgroup', null, el2('col', { class: 'fintbl__c1' }), el2('col'), el2('col'), el2('col'), el2('col'), el2('col', { class: 'fintbl__c6' })),
    el2('thead', null, el2('tr', null,
      el2('th', { scope: 'col', text: 'Yoxlama' }), el2('th', { scope: 'col', class: 'num', text: 'Planda' }),
      el2('th', { scope: 'col', class: 'num', text: 'Yenidən hesablanmış' }), el2('th', { scope: 'col', class: 'num', text: 'Fərq' }),
      el2('th', { scope: 'col', text: 'Status' }), el2('th', { scope: 'col' }, el2('span', { class: 'sr-only', text: 'Ətraflı' })))));
  const tbody = el2('tbody');
  visible.forEach((c) => tbody.append(...financeRow(c, finance)));
  table.append(tbody);
  host.replaceChildren(table);
}

function financeRow(c, finance) {
  const fl = Report.financeLabel(c);
  const detId = 'fdet-' + c.id;
  const open = openRows.has(c.id);
  const btn = el2('button', { type: 'button', class: 'fintbl__more', 'aria-expanded': String(open), 'aria-controls': detId,
    'aria-label': c.title + ' — necə hesablandı və mənbə' }, el2('span', { class: 'fintbl__moretext', text: 'Ətraflı' }), uiIcon('chevronDown', { size: 'sm' }));
  const name = el2('th', { scope: 'row', class: 'fintbl__name' }, el2('div', { class: 'fintbl__namein' },
    el2('span', { class: `fstat fstat--${c.status}`, 'aria-hidden': 'true' }, uiIcon(STAT_ICON[c.status] || 'minus', { size: 'sm' })),
    el2('span', { class: 'fintbl__title' }, el2('span', { text: c.title }), c.critical ? el2('span', { class: 'finrow__crit', text: 'kritik' }) : null)));
  const diffTone = c.status === 'fail' ? 'tone-negative' : c.status === 'warn' ? 'tone-warn' : null;
  const cells = isFormula(c)
    ? [el2('td', { class: 'fintbl__formula', colSpan: 3, dataset: { label: 'Nəticə' } },
      uiIcon('check', { size: 'sm' }), el2('span', { text: 'Düstur düzgündür' }),
      c.diff ? el2('span', { class: 'fintbl__hint', text: `(yuvarlaqlaşdırma fərqi ${fmtCheckValue(Math.abs(c.diff), c)})` }) : null)]
    : [el2('td', { class: 'num', dataset: { label: 'Planda' }, text: fmtCheckValue(c.claimed, c, writtenDecimals(finance, c)) }),
      el2('td', { class: 'num fintbl__calc', dataset: { label: 'Yenidən hesablanmış' }, text: fmtCheckValue(c.computed, c) }),
      el2('td', { class: ['num', 'fintbl__diff', diffTone], dataset: { label: 'Fərq' }, text: c.diff == null ? '—' : fmtCheckValue(c.diff, c, undefined, true) })];
  const row = el2('tr', { class: ['frow', `frow--${c.status}`, open && 'is-open'], dataset: { id: c.id }, id: 'frow-' + c.id },
    name, ...cells, el2('td', { class: 'fintbl__status', dataset: { label: 'Status' } }, Badge(fl.label, { tone: fl.tone, size: 'sm' })), el2('td', { class: 'fintbl__go' }, btn));
  const inner = el2('div', { class: 'fdet__inner' });
  inner.inert = !open;
  const det = el2('tr', { class: ['fdet', open && 'is-open'], id: detId }, el2('td', { colSpan: 6 }, el2('div', { class: 'fdet__panel' }, inner)));
  if (open) inner.append(detailContent(c, finance));
  const toggle = () => {
    const now = !openRows.has(c.id);
    if (now) openRows.add(c.id); else openRows.delete(c.id);
    if (now && !inner.childNodes.length) inner.append(detailContent(c, finance));
    row.classList.toggle('is-open', now);
    det.classList.toggle('is-open', now);
    inner.inert = !now;
    btn.setAttribute('aria-expanded', String(now));
  };
  btn.addEventListener('click', (e) => { e.stopPropagation(); toggle(); });
  row.addEventListener('click', (e) => { if (!e.target.closest('button, a')) toggle(); });
  row.toggle = toggle;
  return [row, det];
}

/** Açılan sətir: necə hesablanıb (insan dilində) → rəqəmlər → mənbə sitatları → cədvəl → qayda (sonda, boz). */
function detailContent(c, finance) {
  const box = el2('div', { class: 'fdet__body' });
  box.append(el2('section', { class: 'fdet__sec' }, el2('h4', { class: 'fdet__h', text: 'Necə hesablanıb' }), el2('p', { class: 'fdet__text', text: c.detail || '—' })));
  if (c.claimed != null || c.computed != null) {
    const written = writtenDecimals(finance, c);
    box.append(el2('section', { class: 'fdet__sec' }, el2('h4', { class: 'fdet__h', text: 'Rəqəmlər' }),
      KeyValue([['Planda göstərilən', fmtCheckValue(c.claimed, c, written)], ['Yenidən hesablanmış', fmtCheckValue(c.computed, c)],
        ['Fərq', c.diff == null ? '—' : fmtCheckValue(c.diff, c, undefined, true)]], { dense: true })));
  }
  if ((c.unread_cells || []).length) {
    box.append(el2('section', { class: 'fdet__sec' }, el2('h4', { class: 'fdet__h', text: 'Oxunmayan xanalar' }),
      el2('p', { class: 'fdet__text', text: c.unread_cells.map((u) => u.year + ' — ' + u.rows.join(', ')).join('; ') })));
  }
  const ev = c.evidence || {};
  const snippets = ev.snippets || [];
  if (snippets.length) {
    box.append(el2('section', { class: 'fdet__sec fdet__sec--wide' }, el2('h4', { class: 'fdet__h', text: 'Sənəddə harada yazılıb' }),
      el2('div', { class: 'fdet__quotes' }, snippets.map((sn) => SourceQuote({
        section: [FIELD_NAMES[sn.field] || sn.label, sn.section_title].filter(Boolean).join(' · '),
        quote: excerpt(sn.text || '', sn.mark), location: sn.table_id ? `Cədvəl ${sn.table_id}` : 'Mətndə',
        onOpen: sn.section_title ? () => openSection(sn) : null,
      })))));
  } else if (ev.snippets && !ev.cashflow) {
    box.append(el2('p', { class: 'alert alert--warn', text: 'Bu rəqəm sənəddə tapılmadı — model tərəfindən verilən dəyər istifadə olunmayıb.' }));
  }
  if (ev.cashflow) box.append(el2('section', { class: 'fdet__sec fdet__sec--wide' }, el2('h4', { class: 'fdet__h', text: 'Cədvəldən (sənəddə yazıldığı kimi)' }), cashflowTable(ev.cashflow)));
  if (c.rule) box.append(el2('p', { class: 'fdet__rule' }, el2('span', { class: 'fdet__rulelabel', text: 'Qayda: ' }), c.rule));
  return box;
}
/** Sitat: vurğulanan yerin ətrafı (±110 simvol), söz sərhədində kəsilir. */
function excerpt(text, mark) {
  if (!mark || mark[0] < 0 || mark[1] > text.length) return text.length > 320 ? text.slice(0, 300).replace(/\s\S*$/, '') + '…' : text;
  let a = Math.max(0, mark[0] - 110);
  let b = Math.min(text.length, mark[1] + 110);
  if (a > 0) a = text.indexOf(' ', a) + 1 || a;
  if (b < text.length) { const sp = text.lastIndexOf(' ', b); if (sp > mark[1]) b = sp; }
  return (a > 0 ? '…' : '') + text.slice(a, b) + (b < text.length ? '…' : '');
}
/** Bölmənin tam mətni drawer-də, sitat vurğulanmış və görünüşə sürüşdürülmüş (Faza 5-də sənəd görüntüsünə çevrilir). */
async function openSection(sn) {
  const body = el2('div', { class: 'docview' }, el2('p', { class: 'docview__loading', text: 'Bölmə yüklənir…' }));
  openDrawer({ title: sn.section_title, content: body });
  try {
    const data = await api.get('/api/checks/' + encodeURIComponent(state.check.id) + '/section?title=' + encodeURIComponent(sn.section_title));
    const marked = sn.mark ? sn.text.slice(sn.mark[0], sn.mark[1]) : null;
    const at = marked ? data.text.indexOf(marked) : -1;
    const q = markedText(data.text, at >= 0 ? [at, at + marked.length] : null);
    q.classList.add('docview__text');
    body.replaceChildren(q);
    const hit = q.querySelector('mark');
    if (hit) requestAnimationFrame(() => hit.scrollIntoView({ block: 'center' }));
  } catch (err) {
    body.replaceChildren(el2('p', { class: 'alert alert--warn', text: err.message || 'Bölmə yüklənmədi.' }));
  }
}

/** Kənardan (KPI, Nəticə tabı): Maliyyə tabı, süzgəc sıfırlanır, sətir açılır və vurğulanır. */
function openFinanceRow(id) {
  selectTab('panel-maliyye', false);
  if (state.finFilter !== 'hamisi') setFinanceFilter('hamisi');
  const row = $('frow-' + id);
  if (!row) return;
  if (!openRows.has(id)) row.toggle();
  row.scrollIntoView({ block: 'center', behavior: reducedMotion() ? 'auto' : 'smooth' });
  row.querySelector('.fintbl__more')?.focus({ preventScroll: true });
  row.classList.remove('is-flash');
  void row.offsetWidth;
  row.classList.add('is-flash');
}

/* ── Qrafiklər ──────────────────────────────────────────────────────────── */
function renderCharts(finance) {
  const charts = finance.charts || {};
  const cfHost = $('fin-cashflow');
  const fcff = charts.fcff;
  const cum = charts.cumulative;
  if (fcff && fcff.available && cum && cum.available) {
    const rows = ((finance.cashflow || {}).rows) || {};
    const resRow = rows.residual && rows.residual.ok !== false ? rows.residual : null;
    const residual = resRow ? fcff.years.map((yr) => { const k = resRow.years.indexOf(yr); return k >= 0 ? resRow.values[k] || 0 : 0; }) : null;
    const pp = (finance.checks || []).find((c) => c.id === 'pp');
    const chart = cashflowChart({
      years: fcff.years, fcff: fcff.values, cumulative: cum.values, residual,
      ratePct: (finance.claimed || {}).discount_rate_pct ?? null, payback: pp && pp.computed != null ? pp.computed : null,
    });
    cfHost.replaceChildren(el2('div', { class: 'finv__card' },
      el2('p', { class: 'finv__meta', text: `Vahid: ₼ · İllər: ${fcff.years[0]}–${fcff.years[fcff.years.length - 1]} · Mənbə: cədvəl ${fcff.source || '—'}` }),
      chart.node,
      Disclosure({ summary: 'Cədvəl kimi göstər', content: DataTable({ ...chart.table, dense: true }) })));
  } else {
    cfHost.replaceChildren(EmptyState({ icon: 'info', compact: true, title: 'Pul axını qrafiki qurulmadı', text: 'Planda illər üzrə FCFF cədvəli tapılmadı.' }));
  }

  const cards = [];
  const funding = charts.funding;
  const inv = charts.investment;
  if (funding && funding.available) {
    const srcCheck = (finance.checks || []).find((c) => c.id === 'menbeler_cemi');
    const investment = (finance.claimed || {}).investment_total;
    const parts = funding.parts.map((p) => ({ label: p.label, value: p.value }));
    cards.push(el2('div', { class: 'finv__card' }, el2('h3', { class: 'finv__h3', text: 'Maliyyələşmə mənbələri' }),
      donut({ parts, total: funding.total, centerLabel: 'Mənbələr' }),
      investment != null ? gapBars({ investment, sources: funding.total, diff: srcCheck ? srcCheck.diff : null }) : null,
      Disclosure({ summary: 'Cədvəl kimi göstər', content: partsTable(parts, funding.total) })));
  }
  if (inv && inv.available) {
    const parts = inv.parts.map((p) => ({ label: p.label, value: p.value }));
    cards.push(el2('div', { class: 'finv__card' }, el2('h3', { class: 'finv__h3', text: 'İnvestisiyanın strukturu' }),
      donut({ parts, total: inv.total, centerLabel: 'İnvestisiya' }),
      Disclosure({ summary: 'Cədvəl kimi göstər', content: partsTable(parts, inv.total) })));
  }
  $('fin-funding').replaceChildren(...cards);
  $('fin-funding-sec').hidden = cards.length === 0;
}
function partsTable(parts, total) {
  return DataTable({ dense: true, caption: 'Hissələr', rows: [...parts.map((p, i) => ({ id: i, ...p })), { id: 'cemi', label: 'Cəmi', value: total }],
    columns: [{ key: 'label', label: 'Hissə' }, { key: 'value', label: 'Məbləğ', type: 'number', render: (r) => fmtMoney(r.value) },
      { key: 'share', label: 'Pay', type: 'number', render: (r) => fmtPct(r.value / (total || 1)) }] });
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

export { openFinanceDetail, openFinanceRow, previewCard, renderCharts, renderFinance, setFinanceFilter, snippetCard };
