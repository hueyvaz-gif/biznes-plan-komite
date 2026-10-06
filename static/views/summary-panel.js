/* İcmal: nəticə, göstəricilər, ilk addımlar və problemli maliyyə bəndləri.
 * Düzəlişlər: süzgəcli checklist, açılan mənbə izahları və ayrıca sənədlər. Hər rəqəm API-dən;
 * checklist işarəsi YALNIZ istifadəçinin lokal qeydidir (localStorage), statusu dəyişmir. */
import { $ } from '../core/dom.js';
import { state } from '../core/state.js';
import { selectTab, setTabCount } from '../shell/tabs.js';
import { el } from '../ui/el.js';
import { icon } from '../ui/icons.js';
import { Badge, withPlaceholders } from '../ui/badge.js';
import { StatTile, EmptyState } from '../ui/card.js';
import { DataTable } from '../ui/table.js';
import { tooltip, toast } from '../ui/overlay.js';
import { reducedMotion } from '../ui/motion.js';
import { fmtMoney, fmtNumber, fmtPct, fmtYears, DASH } from '../format.js';
import { setFinanceFilter, openFinanceRow } from './finance.js';
import { cashflowChart } from './cashflow-chart.js';

const SEV_TONE = { kritik: 'danger', duzelis: 'warning', deqiqlesdir: 'info' };
const SEV_ICON = { kritik: 'alert', duzelis: 'dot', deqiqlesdir: 'info' };

let ctx = null;            // {check, p, report, openSource}
let econ = null;           // son iqtisadi məlumat (sənəd statusları üçün)
let fixFilter = 'all';

/* ── Rəqəm formatı (vahidə görə) ────────────────────────────────────────── */
export function fmtCheckValue(value, check, decimals, signed = false) {
  if (value === null || value === undefined) return DASH;
  const unit = (check && check.unit) || '';
  if (unit === 'manat') return fmtMoney(value, { signed });
  if (unit === 'ton') return fmtNumber(value, { signed }) + ' ton';
  if (unit === '%') return fmtPct(value, { points: true, decimals: decimals ?? 2, signed });
  if (unit === 'il') return (signed && value > 0 ? '+' : '') + fmtYears(value, { decimals: decimals ?? 2 });
  return fmtNumber(value, { maxDecimals: decimals ?? 2, signed });
}

/* ── Checklist yaddaşı ──────────────────────────────────────────────────── */
const doneKey = (id) => 'fixdone:' + id;
function readDone(id) {
  try { return new Set(JSON.parse(localStorage.getItem(doneKey(id)) || '[]')); } catch (_) { return new Set(); }
}
function writeDone(id, set) {
  try { localStorage.setItem(doneKey(id), JSON.stringify([...set])); } catch (_) { /* gizli rejim — yaddaşsız işləyir */ }
}

/* ── Giriş ──────────────────────────────────────────────────────────────── */
export function renderSummaryPanel(check, p, report, overview, openSource) {
  ctx = { check, p, report, overview, openSource };
  $('sum-sentence').textContent = Report.buildSentence(check.verdict, report, overview);
  $('sum-priorities').replaceChildren(...report.fixes.slice(0, 3).map((f) =>
    el('button', { type: 'button', class: 'priority', on: { click: () => focusFix(f.anchor) } },
      el('span', { class: `priority__mark priority__mark--${f.severity}`, 'aria-hidden': 'true' }, icon(f.severity === 'kritik' ? 'alert' : 'arrowRight', { size: 'sm' })),
      el('span', { class: 'priority__body' }, el('span', { class: 'priority__topic', text: f.topic }),
        el('span', { class: 'priority__action', text: f.action || f.missing })), icon('chevronRight', { size: 'sm' }))));
  $('sum-priorities-sec').hidden = !report.fixes.length;
  setTabCount('count-duzelis', report.fixes.length, { tone: 'warn', complete: true, title: report.fixes.length + ' görüləcək iş', doneTitle: 'Düzəliş tələb edən iş yoxdur' });
  fixFilter = 'all';
  renderTiles(p, report);
  renderDashboard(p.finance);
  renderFixPlan(check, report, overview);
  renderDocs(report);
  renderNotApplicable(report);
  renderFinSummary(check, p);
}

/** Overview uses the same verified values and residual components as the finance view. */
function renderDashboard(finance) {
  const checks = finance.checks || [];
  const metrics = [['investisiya_cemi', 'İnvestisiya'], ['npv', 'Xalis cari dəyər · NPV'],
    ['irr', 'Rentabellik · IRR'], ['pp', 'Özünü ödəmə']].map(([id, label]) => {
    const check = checks.find((c) => c.id === id);
    if (!check || (check.computed == null && check.claimed == null)) return null;
    const value = check.computed ?? check.claimed;
    const display = check.unit === 'manat' ? fmtMoney(value, { compact: true }) : fmtCheckValue(value, check, 1);
    const status = Report.financeLabel(check);
    return el('button', { type: 'button', class: 'metric', on: { click: () => openFinanceRow(id) } },
      el('span', { class: 'metric__label', text: label }),
      el('span', { class: 'metric__value', text: display }),
      el('span', { class: 'metric__foot' },
        Badge(status.label, { tone: status.tone, size: 'sm' }),
        el('span', { class: 'metric__source', text: check.computed == null ? 'Planda' : 'Hesablanmış' })));
  }).filter(Boolean);
  $('sum-kpis').replaceChildren(...metrics);
  $('sum-metrics-sec').hidden = !metrics.length;

  const { fcff, cumulative } = finance.charts || {};
  const available = fcff?.available && cumulative?.available && fcff.years?.length;
  $('sum-chart-sec').hidden = !available;
  $('sum-chart-host').replaceChildren();
  if (!available) return;
  const residualRow = finance.cashflow?.rows?.residual;
  const residual = residualRow && residualRow.ok !== false
    ? fcff.years.map((year) => { const i = residualRow.years.indexOf(year); return i >= 0 ? residualRow.values[i] || 0 : 0; }) : null;
  const payback = checks.find((c) => c.id === 'pp')?.computed ?? null;
  $('sum-chart-meta').textContent = `${fcff.years[0]}–${fcff.years.at(-1)} · manat · mənbə: ${fcff.source || 'planın pul axını cədvəli'}`;
  $('sum-chart-host').append(cashflowChart({ years: fcff.years, fcff: fcff.values, cumulative: cumulative.values,
    residual, ratePct: finance.claimed?.discount_rate_pct ?? null, payback, compact: true }).node);
}

/* ── 3 göstərici ────────────────────────────────────────────────────────── */
function renderTiles(p, report) {
  const host = $('sum-tiles');
  const tiles = [];
  const documentCount = (report.documents || []).length;
  const fin = Report.financeCounts(p.finance.checks || []);
  if (fin.total) {
    const sub = [fin.clarify && fin.clarify + ' dəqiqləşdirmə', fin.fail && fin.fail + ' uyğunsuz',
      fin.warn && fin.warn + ' kiçik fərq', fin.skip && fin.skip + ' yoxlanılmadı'].filter(Boolean).join(' · ') || 'hamısı uyğun';
    tiles.push(StatTile({
      label: 'Maliyyə', value: fin.ok, format: (v) => `${fmtNumber(Math.round(v))}/${fin.total}`, unit: 'uyğun', sub,
      progress: { value: fin.ok, max: fin.total }, tone: fin.fail ? 'danger' : undefined,
      onClick: () => { selectTab('panel-maliyye', true); setFinanceFilter(fin.problems ? 'problem' : 'hamisi'); },
    }));
  }
  tiles.push(StatTile({
    label: 'Görüləcək işlər', value: report.fixes.length, unit: 'iş',
    sub: 'Birləşdirilmiş düzəliş siyahısı',
    onClick: () => selectTab('panel-duzelis', true),
  }));
  tiles.push(StatTile({
    label: 'Əlavə sənədlər', value: documentCount, unit: 'sənəd',
    sub: documentCount ? 'Ayrıca təqdim edilməlidir' : 'Əlavə sənəd tələb olunmur',
    onClick: documentCount ? () => { selectTab('panel-duzelis', true); $('docs-sec').scrollIntoView({ block: 'start' }); } : undefined,
  }));
  host.replaceChildren(...tiles);
}

/* ── Düzəliş planı ──────────────────────────────────────────────────────── */
function renderFixPlan(check, report, overview) {
  const done = readDone(check.id);
  const fixes = report.fixes.filter((f) => fixFilter === 'all' || (fixFilter === 'open' && !done.has(f.anchor))
    || (fixFilter === 'holes' && (f.kind === 'bosyer' || f.holes.length > 0)));
  // Köhnə (artıq olmayan) işarələr atılır — sayğac həmişə cari siyahıya uyğundur.
  for (const a of [...done]) if (!report.fixes.some((f) => f.anchor === a)) done.delete(a);
  $('fix-sub').textContent = 'İşarələr şəxsi qeyddir. Nəticə yeni versiya yoxlandıqda yenilənir.';
  $('fix-composition').textContent = overview.composition || '';
  $('fix-composition-box').hidden = !overview.composition;
  document.querySelectorAll('[data-fix-filter]').forEach((b) => {
    b.setAttribute('aria-pressed', String(b.dataset.fixFilter === fixFilter));
  });
  const groups = [
    ['critical', 'fixes-critical', (f) => f.severity === 'kritik'],
    ['main', 'fixes', (f) => f.severity !== 'kritik' && f.severity !== 'deqiqlesdir'],
    ['clarify', 'fixes-clarify', (f) => f.severity === 'deqiqlesdir'],
  ];
  for (const [key, host, matches] of groups) {
    const items = fixes.filter(matches);
    $('fixgroup-' + key).hidden = items.length === 0;
    $('fixgroup-' + key + '-count').textContent = items.length + ' iş';
    $(host).replaceChildren(...items.map((f) => fixCard(f, ctx.report.fixes.indexOf(f) + 1, done)));
  }
  $('fixes-more').replaceChildren();
  setFixesOpen(false);
  const empty = $('fixes-empty-host');
  empty.replaceChildren(fixes.length ? '' : EmptyState({ icon: 'check', compact: true,
    title: fixFilter === 'all' ? 'Düzəliş tələb edən bənd tapılmadı' : 'Bu filtrdə iş yoxdur' }));
  $('fix-progress').hidden = report.fixes.length === 0;
  updateProgress(check.id, report.fixes.length, done.size);
}

function updateProgress(id, total, n) {
  $('fix-progress-text').textContent = `${n}/${total} iş tamamlandı kimi işarələnib`;
  $('fix-progress-bar').style.setProperty('--p', total ? String(n / total) : '0');
}

function fixCard(f, no, done) {
  const isDone = done.has(f.anchor);
  const cbId = 'fixcb-' + f.anchor;
  const cb = el('input', { type: 'checkbox', class: 'fixc__cb', id: cbId, checked: isDone });
  const card = el('li', { class: ['fixc', `fixc--${f.severity}`, isDone && 'is-done'], id: f.anchor, tabIndex: -1 });
  cb.addEventListener('change', () => {
    const set = readDone(ctx.check.id);
    if (cb.checked) set.add(f.anchor); else set.delete(f.anchor);
    writeDone(ctx.check.id, set);
    card.classList.toggle('is-done', cb.checked);
    updateProgress(ctx.check.id, ctx.report.fixes.length, set.size);
    if (fixFilter === 'open') {
      renderFixPlan(ctx.check, ctx.report, ctx.overview);
      document.querySelector('[data-fix-filter="open"]').focus();
    }
  });

  const codes = (f.codes || []).map((c) => tooltip(el('span', { class: 'fixc__code', text: c.code, 'aria-label': 'Tələb ' + c.code + ': ' + c.title }), c.title));
  const where = f.ref ? el('button', { type: 'button', class: 'fixc__where', on: { click: (e) => ctx.openSource(f.ref, e.currentTarget) } },
    icon('locate', { size: 'sm' }), el('span', { text: 'Sənəddə göstər' })) : null;
  const head = el('div', { class: 'fixc__head' },
    Badge(Report.SEVERITY_LABEL[f.severity] || f.severity, { tone: SEV_TONE[f.severity] || 'neutral', icon: SEV_ICON[f.severity], size: 'sm' }),
    el('h3', { class: 'fixc__topic' }, el('label', { for: cbId, text: f.topic })), where);

  const col = (label, value) => (value ? el('div', { class: 'fixc__col' }, el('h4', { class: 'fixc__label', text: label }),
    el('p', { class: 'fixc__text' }, typeof value === 'string' ? withPlaceholders(value) : value)) : null);
  const action = el('p', { class: 'fixc__action' }, withPlaceholders(f.action || f.missing || 'Ətraflı məlumatı yoxlayın.'));
  const detail = el('details', { class: 'fixc__detail' },
    el('summary', { text: 'Ətraflı' }),
    el('div', { class: 'fixc__detail-body' }, col('Yoxlamanın qeydi', f.missing),
      codes.length ? el('div', { class: 'fixc__codes' }, ...codes) : null));

  const extra = [];
  if (f.location) extra.push(el('p', { class: 'fixc__loc' }, icon('fileText', { size: 'sm' }), el('span', { text: f.location })));
  if (f.related && f.related.length) {
    extra.push(el('ul', { class: 'fixc__related' }, f.related.map((r) => el('li', null,
      withPlaceholders(r.text),
      r.ref ? el('button', { type: 'button', class: 'fixc__inline', text: 'yerinə bax', 'aria-label': 'Yerinə bax: ' + r.text,
        on: { click: (e) => ctx.openSource(r.ref, e.currentTarget) } }) : null))));
  }
  detail.querySelector('.fixc__detail-body').append(...extra);
  card.append(
    el('div', { class: 'fixc__check' }, cb, el('span', { class: 'fixc__no', 'aria-hidden': 'true', text: String(no) }),
      el('span', { class: 'sr-only', text: 'Tamamlandı kimi işarələ' })),
    el('div', { class: 'fixc__main' }, head, action, detail));
  return card;
}

export function setFixesOpen(open) {
  const more = $('fixes-more');
  const wrap = $('fixes-more-wrap');
  const toggle = $('fixes-toggle');
  if (!more || !toggle) return;
  const n = more.children.length;
  wrap.classList.toggle('is-open', open);
  more.inert = !open;
  toggle.hidden = n === 0;
  toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  toggle.textContent = open ? 'Daha az göstər' : `Daha ${n} bənd göstər`;
}

/** Nəticə cümləsindən və palette-dən: kart gizli hissədədirsə açılır, sonra fokus. */
export function focusFix(anchor) {
  if (ctx && fixFilter !== 'all') { fixFilter = 'all'; renderFixPlan(ctx.check, ctx.report, ctx.overview); }
  selectTab('panel-duzelis', true);
  const card = document.getElementById(anchor);
  if (!card) return;
  if (card.parentElement && card.parentElement.id === 'fixes-more') setFixesOpen(true);
  card.scrollIntoView({ block: 'start', behavior: reducedMotion() ? 'auto' : 'smooth' });
  card.focus({ preventScroll: true });
}

/* ── Ayrıca sənədlər ────────────────────────────────────────────────────── */
function evidenceFor(code) {
  return ((econ && econ.evidence) || []).filter((e) => e.req_code === code);
}
/** Yüklənmiş sənədin yoxlama nəticəsi: {tone, text}. Analiz serverdədir — burada yalnız göstərilir. */
export function docStatus(found) {
  if (!found.length) return { tone: 'neutral', text: 'Gözlənilir', state: 'wait' };
  const last = found[found.length - 1];
  const a = last.analysis || {};
  const name = last.file_name;
  if (a.state === 'isleyir') return { tone: 'info', text: `${name}: yoxlanılır…`, state: 'busy' };
  if (a.error) return { tone: 'warning', text: `${name}: yoxlanılmadı — ${a.error}`, state: 'done' };
  if (last.kind === 'sekil') return { tone: 'success', text: `${name}: şəkil təqdim edilib (məzmun qiymətləndirilmir)`, state: 'done' };
  const checks = a.checks || [];
  const flags = checks.filter((c) => c.status === 'flag');
  if (flags.length) return { tone: 'warning', text: `${name}: ` + flags.map((c) => `${c.title} — ${c.detail}`).join('; '), state: 'done' };
  if (checks.length) return { tone: 'success', text: `${name}: ` + checks.map((c) => c.title).join(', ') + ' uyğundur', state: 'done' };
  return { tone: 'success', text: `${name}: yükləndi və yoxlandı`, state: 'done' };
}

function renderDocs(report) {
  const docs = report.documents || [];
  $('docs-sec').hidden = docs.length === 0;
  if (!docs.length) return;
  const canUpload = !!window.Econ && !ctx.check.demo;
  let uploaded = 0;
  $('docs-list').replaceChildren(...docs.map((d) => {
    const found = evidenceFor(d.code);
    const st = docStatus(found);
    if (found.length) uploaded++;
    const input = el('input', { type: 'file', class: 'sr-only', tabIndex: -1, accept: '.xlsx,.xlsm,.pdf,.docx,.jpg,.jpeg,.png', 'aria-hidden': 'true' });
    const li = el('li', { class: ['docitem', `docitem--${st.state}`], dataset: { code: d.code } });
    const send = async (file) => {
      if (!file || !canUpload) return;
      li.className = 'docitem docitem--busy';
      li.querySelector('.docitem__status').textContent = `${file.name}: yüklənir…`;
      try { await window.Econ.upload(file, { req_code: d.code }); } catch (err) { toast({ message: err.message, tone: 'danger' }); }
    };
    input.addEventListener('change', () => send(input.files[0]));
    if (canUpload) {
      li.addEventListener('dragover', (e) => { e.preventDefault(); li.classList.add('is-over'); });
      li.addEventListener('dragleave', (e) => { if (!li.contains(e.relatedTarget)) li.classList.remove('is-over'); });
      li.addEventListener('drop', (e) => { e.preventDefault(); li.classList.remove('is-over'); send(e.dataTransfer.files[0]); });
    }
    li.append(
      el('span', { class: 'docitem__mark', 'aria-hidden': 'true' }, icon(found.length && st.state === 'done' ? (st.tone === 'success' ? 'check' : 'alert') : 'fileText')),
      el('div', { class: 'docitem__main' },
        el('p', { class: 'docitem__title' }, el('span', { text: d.text }), el('span', { class: 'fixc__code', text: d.code })),
        el('p', { class: `docitem__status tone-${st.tone === 'success' ? 'positive' : st.tone === 'warning' ? 'negative' : 'neutral'}`, 'aria-live': 'polite', text: st.text }),
        canUpload && !found.length ? el('p', { class: 'docitem__hint', text: 'Excel, PDF, DOCX və ya şəkil' }) : null),
      canUpload ? el('button', { type: 'button', class: 'btn btn--small', on: { click: () => input.click() } },
        icon('upload', { size: 'sm' }), found.length ? 'Yenidən yüklə' : 'Yüklə') : null,
      input);
    return li;
  }));
  $('docs-progress').textContent = `${uploaded}/${docs.length} yüklənib`;
}

function renderNotApplicable(report) {
  const list = report.notApplicable || [];
  $('na-sec').hidden = list.length === 0;
  $('na-list').replaceChildren(...list.map((n) => el('li', null,
    el('strong', { text: n.text }), ' — planda: ', el('q', { text: n.quote || '' }), ' ', el('span', { class: 'fixc__code', text: n.code }))));
}

/* ── Maliyyə xülasəsi ───────────────────────────────────────────────────── */
const FIN_TONE = { ok: 'success', warn: 'warning', fail: 'danger', skip: 'neutral' };
function renderFinSummary(check, p) {
  const rows = Report.financeRows(check.result || {}).filter((r) => r.status !== 'ok' || r.label === 'Dəqiqləşdirmə');
  const checks = p.finance.checks || [];
  const host = $('finsum-host');
  $('finsum-sec').hidden = !rows.length;
  if (!rows.length) { host.replaceChildren(); return; }
  const decimals = (c) => {
    const field = { irr: 'irr_pct', pp: 'payback_years' }[c.id];
    const src = field && ((p.finance.claimed || {}).provenance || {})[field];
    return src && src.decimals !== undefined ? src.decimals : undefined;
  };
  host.replaceChildren(DataTable({
    caption: 'Maliyyə yoxlamasının xülasəsi', dense: true,
    rows: rows.map((r) => ({ ...r, check: checks.find((x) => x.id === r.id) })),
    columns: [
      { key: 'title', label: 'Göstərici', render: (r) => el('span', { class: 'finrow__title' }, r.title,
        r.critical ? el('span', { class: 'finrow__crit', text: 'kritik' }) : null) },
      { key: 'claimed', label: 'Planda', type: 'number', render: (r) => formulaRow(r) ? 'düstur' : fmtCheckValue(r.claimed, r.check, decimals(r.check || {})) },
      { key: 'computed', label: 'Yenidən hesablanmış', type: 'number',
        render: (r) => (formulaRow(r) ? 'düzgündür' : fmtCheckValue(r.computed, r.check)) },
      { key: 'label', label: 'Nəticə', type: 'status', render: (r) => Badge(r.label, { tone: r.label === 'Dəqiqləşdirmə' ? 'warning' : FIN_TONE[r.status] || 'neutral', size: 'sm' }) },
      { key: 'go', label: 'Ətraflı', type: 'actions', render: (r) => (r.check ? el('button', {
        type: 'button', class: 'btn btn--small', 'aria-label': r.title + ' — necə hesablandı və mənbə',
        on: { click: () => openFinanceRow(r.check.id) },
      }, 'Ətraflı', icon('chevronRight', { size: 'sm' })) : null) },
    ],
  }));
}
/** Düstur yoxlaması (FCFF): rəqəm yox, "düstur düzgündür" kimi göstərilir. */
const formulaRow = (r) => r.claimed == null && r.computed == null && r.status === 'ok';

/* ── Bir dəfəlik qoşulma ────────────────────────────────────────────────── */
export function wireSummary() {
  document.querySelectorAll('[data-fix-filter]').forEach((b) => b.addEventListener('click', () => {
    fixFilter = b.dataset.fixFilter;
    if (ctx) renderFixPlan(ctx.check, ctx.report, ctx.overview);
  }));
  $('fixes-toggle')?.addEventListener('click', () => setFixesOpen($('fixes-toggle').getAttribute('aria-expanded') !== 'true'));
  const toggle = $('about-toggle');
  const setAbout = (open) => {
    $('about-disc').classList.toggle('is-open', open);
    toggle.setAttribute('aria-expanded', String(open));
    $('about-body').querySelector('.about__inner').inert = !open;
  };
  toggle?.addEventListener('click', () => setAbout(toggle.getAttribute('aria-expanded') !== 'true'));
  $('about-link')?.addEventListener('click', (e) => {
    e.preventDefault();
    setAbout(true);
    $('about').scrollIntoView({ block: 'start', behavior: reducedMotion() ? 'auto' : 'smooth' });
    toggle.focus({ preventScroll: true });
  });
  window.addEventListener('beforeprint', () => {
    setAbout(true);
    if (ctx) { fixFilter = 'all'; renderFixPlan(ctx.check, ctx.report, ctx.overview); setFixesOpen(true); }
    document.querySelectorAll('.fixc__detail').forEach((d) => { d.dataset.printOpen = String(d.open); d.open = true; });
  });
  window.addEventListener('afterprint', () => document.querySelectorAll('.fixc__detail').forEach((d) => { d.open = d.dataset.printOpen === 'true'; }));
  document.addEventListener('econ:data', (e) => {
    econ = e.detail;
    if (ctx && ctx.report) renderDocs(ctx.report);
  });
}
