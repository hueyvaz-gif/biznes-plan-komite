/* Nəticə tabı: qısa nəticə, düzəliş siyahısı, tələblər xəritəsi, maliyyə zolağı. */
import { $, el, formatAz, formatValue, planName, reqCounts, reqSummary, setHidden, setText } from '../core/dom.js';
import { VERDICT_TONE } from '../core/labels.js';
import { state } from '../core/state.js';
import { closeDetail } from '../shell/detail.js';
import { layoutTabs, selectTab, setTabCount } from '../shell/tabs.js';
import { renderHero } from '../shell/hero.js';
import { renderSummaryPanel, setFixesOpen } from './summary-panel.js';
import { renderComparison } from './compare.js';
import { AG, loadEvents, renderAgents } from './debug-log.js';
import { renderExtraResults } from './extras.js';
import { openFinanceDetail, renderCharts, renderFinance, setFinanceFilter } from './finance.js';
import { openPlaceholderDetail, renderPlaceholders } from './placeholders.js';
import { openRequirementDetail, renderCoverage, renderRequirements, reqMeta, setRequirementFilter } from './requirements.js';

/* ── Nəticə ─────────────────────────────────────────────────────────────── */

function resultParts(check) {
  const r = check.result || {};
  return {
    ingest: r.ingest || { stats: {}, placeholders: [] },
    finance: r.finance || { checks: [], not_found: [] },
    compliance: r.compliance || { items: [] },
    summary: r.summary || {},
    reasons: r.reasons || {},
    comparison: r.comparison,
    extras: r.extras,
  };
}
function renderResults(check) {
  const p = resultParts(check);
  setText('res-plan', planName(check));
  setText('res-file', check.file_name);
  setText('res-version', 'v' + check.version);
  setHidden('res-demo', !check.demo);

  // Hər blok ayrıca: birində xəta olsa, qalanları yenə göstərilir (xəta konsola yazılır).
  const safely = (name, fn) => {
    try { fn(); } catch (err) { console.error('Nəticə bloku göstərilmədi (' + name + '):', err); }
  };
  safely('status', () => renderStatusLine(check));
  safely('nəticə', () => renderReport(check, p));
  safely('hero', () => renderHero(check, state.overview));
  safely('xəritə', () => renderMaps(p));
  safely('əhatə', () => renderScope(p));
  safely('maliyyə', () => renderFinance(p.finance));
  safely('qrafiklər', () => renderCharts(p.finance));
  safely('tələblər', () => renderCoverage(check, p.compliance));
  safely('tələb siyahısı', () => renderRequirements());
  safely('əlavə tələblər', () => renderExtraResults(p));
  safely('boş yerlər', () => renderPlaceholders(p.ingest.placeholders || []));
  safely('müqayisə', () => renderComparison(p.comparison));
  safely('status tarixçəsi', () => renderRulesNote(check));
  safely('tab nişanları', () => renderTabCounts(p));
  safely('iqtisadi təhlil', () => window.Econ && window.Econ.load(check));
  loadEvents(check.id).then(() => { if (state.check && state.check.id === check.id) renderAgents(); });

  const tab = new URLSearchParams(location.search).get('tab');
  selectTab(tab && $('tab-' + tab) ? 'panel-' + tab : 'panel-xulase', false);
}
/* ── Nəticə: qısa nəticə, vahid düzəliş siyahısı, yığcam maliyyə (static/report.js) ── */

/** Başlıq: sənədin hazırlıq statusu (sadə etiket) və yoxlamanın icra vəziyyəti — ayrı. */
function renderStatusLine(check) {
  const tone = VERDICT_TONE[check.verdict] || 'skip';
  const pill = $('res-status');
  if (pill) pill.className = 'statuspill statuspill--' + tone;
  setText('res-status-label', check.verdict_label
    || ((state.meta && state.meta.verdicts) || {})[check.verdict] || 'Tamamlandı');
}
function reportFormat() {
  return {
    value: (c, v) => formatValue(v, c),
    money: (v) => formatAz(v) + ' manat',
  };
}
function renderReport(check, p) {
  const meta = { requirements: (state.meta && state.meta.requirements) || {} };
  const report = Report.buildReport(check.result || {}, meta, reportFormat());
  state.report = report;

  // Nəticə bloku — başlıq, bloklayan problem, göstəricilər; hamısı aşağıdakı siyahı ilə eyni mənbədən.
  const overview = Report.buildOverview(check, check.result || {}, report, $('res-status-label').textContent);
  state.overview = overview;
  // Yoxlanılmayan hissələr (texniki səbəb) — düzəliş deyil, ayrıca bildiriş.
  const technical = report.unchecked.filter((u) => u.technical);
  const failed = (p.compliance.failed_groups || []);
  $('sum-unchecked').hidden = technical.length === 0;
  if (technical.length) {
    const groups = [...new Set(technical.map((u) => u.group))];
    $('sum-unchecked-text').textContent = technical.length + ' tələb texniki səbəbdən yoxlanılmadı ('
      + groups.join(', ') + '). Bu, sənəddə olmaması demək deyil.';
    setText('sum-retry-label', groups.length > 1 ? 'Bu ' + groups.length + ' qrupu yenidən yoxla' : 'Bu qrupu yenidən yoxla');
  }
  $('sum-retry').hidden = !(failed.length && check.run_state === 'tamamlandi' && !check.demo);

  renderSummaryPanel(check, p, report, overview, openFixSource);
}
/** "Mənbəyə bax": tələb, maliyyə yoxlaması və ya boş yer üçün mövcud dəlil paneli. */
/** Status sonradan cari qaydalarla yenidən hesablanıbsa — versiya tarixçəsinin qeydidir (Müqayisə tabı). */
function renderRulesNote(check) {
  const rules = (check.result || {}).rules || {};
  const verdicts = (state.meta && state.meta.verdicts) || {};
  const before = rules.reevaluated && rules.previous_verdict && rules.previous_verdict !== check.verdict
    ? verdicts[rules.previous_verdict] : null;
  const note = $('cmp-rules');
  if (!note) return;
  note.hidden = !before;
  note.textContent = before ? 'v' + check.version + ' statusu cari qaydalarla yenidən hesablanıb: “' + before + '” → “'
    + (verdicts[check.verdict] || check.verdict_label || '') + '”.' : '';
}
function openFixSource(ref, opener) {
  const p = resultParts(state.check);
  if (ref.type === 'req') {
    const item = (p.compliance.items || []).find((i) => i.req_id === ref.id);
    if (item) openRequirementDetail(item, opener);
  } else if (ref.type === 'fin') {
    const c = (p.finance.checks || []).find((x) => x.id === ref.id);
    if (c) openFinanceDetail(c, opener);
  } else if (ref.type === 'ph') {
    const item = (p.ingest.placeholders || [])[ref.index];
    if (item) openPlaceholderDetail(item, ref.index, opener);
  }
}
/* ── Tələblər xəritəsi və maliyyə zolağı (Xülasə) ───────────────────────── */

const SQ_STATUS = { var: 'var', natamam: 'natamam', yoxdur: 'yoxdur', tetbiq_edilmir: 'na', sened: 'sened', skip: 'skip' };
function square(statusKey, label, critical) {
  const sq = el('span', 'sq sq--' + statusKey + (critical ? ' sq--crit' : ''));
  sq.setAttribute('role', 'img');
  sq.setAttribute('aria-label', label);
  sq.title = label;
  return sq;
}
/** Qrup: kvadratlar + ad + mətnlə say ("3/4 var") — yalnız rəngə güvənilmir. */
function mapGroup(title, squares, countText, ariaLabel, onClick) {
  const button = el('button', 'mapgroup');
  button.type = 'button';
  button.setAttribute('aria-label', ariaLabel);
  const grid = el('span', 'mapgroup__squares');
  grid.setAttribute('aria-hidden', 'true');            // təsvir düymənin aria-label-ındadır
  squares.forEach((sq) => grid.append(sq));
  button.append(grid, el('span', 'mapgroup__title', title), el('span', 'mapgroup__count', countText));
  button.addEventListener('click', onClick);
  return button;
}
function renderMaps(p) {
  const items = (p.compliance.items || []);
  const groups = new Map();
  items.forEach((i) => {
    const key = i.origin === 'elave' ? 'elave' : i.group_id;
    if (!groups.has(key)) groups.set(key, { id: i.group_id, title: i.group_title, items: [], extra: i.origin === 'elave' });
    groups.get(key).items.push(i);
  });
  const host = $('req-map');
  host.replaceChildren(...[...groups.values()].map((g) => {
    // Ortaq sayma qaydası (reqCounts): ayrıca sənəd məxrəcə qatılmır, ayrıca yazılır.
    const gc = reqCounts(g.items);
    const ok = gc.answered;
    const docs = gc.document;
    const checkable = gc.evaluated;
    const squares = g.items.map((i) => square(SQ_STATUS[i.status] || 'skip',
      i.req_id + ' — ' + reqMeta(i).label.toLowerCase(), false));
    const problems = g.items.filter((i) => ['natamam', 'yoxdur'].includes(i.status)).length;
    const aria = g.title + ': ' + checkable + ' yoxlanılan tələbdən ' + ok + ' cavablandırılıb'
      + (problems ? ', ' + problems + ' problemli' : '') + (docs ? ', ' + docs + ' ayrıca sənəd yoxlanılmayıb' : '')
      + (gc.notChecked ? ', ' + gc.notChecked + ' yoxlanılmadı' : '') + '. Tələblərə keç.';
    const count = (checkable ? ok + '/' + checkable + ' cavablandırılıb' : '')
      + (docs ? (checkable ? ' · ' : '') + docs + ' ayrıca sənəd' : '')
      + (gc.notChecked ? ' · ' + gc.notChecked + ' yoxlanılmadı' : '');
    return mapGroup(g.title, squares, count, aria, () => {
      if (g.extra) { selectTab('panel-elave', true); return; }
      openRequirementGroup(g.id);
    });
  }));
  $('req-mapbox').hidden = groups.size === 0;
}
/** Xəritədən: "Standart tələblər" tabını açır, süzgəcləri sıfırlayır, qrupa sürüşür. */
function openRequirementGroup(groupId) {
  state.reqGroup = '';
  state.reqQuery = '';
  $('req-search').value = '';
  setRequirementFilter('hamisi');
  $('req-group').value = '';
  selectTab('panel-teleb', false);
  const section = $('reqgroup-' + groupId);
  if (section) {
    section.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    section.querySelector('.reqgroup__title').focus({ preventScroll: true });
  }
}
/** Çapdan əvvəl: süzgəclər sıfırlanır (heç bir sətir itməsin), problemlərin hamısı açılır. */
function prepareForPrint() {
  if (!state.check || state.check.run_state !== 'tamamlandi') return;
  state.reqGroup = '';
  state.reqQuery = '';
  $('req-search').value = '';
  setFinanceFilter('hamisi');
  setRequirementFilter('hamisi');
  setFixesOpen(true);                                // çapda bütün düzəlişlər
  closeDetail();
  $('req-mapbox').open = true;                       // bağlı <details> çapda görünmür
  const r = state.check.result || {};
  // Müqayisə və əlavə tələblər yalnız varsa çap olunur.
  $('panel-muqayise').classList.toggle('print-skip', !(r.comparison && r.comparison.available));
  $('panel-elave').classList.toggle('print-skip', !r.extras);
  $('panel-agentler').classList.toggle('print-skip', !AG.list.length);
  if (window.Econ) window.Econ.prepareForPrint();
}
function renderScope(p) {
  const list = $('scope-list');
  list.replaceChildren();
  const checks = p.finance.checks || [];
  const done = checks.filter((c) => c.status !== 'skip').length;
  const standard = (p.compliance.items || []).filter((i) => (i.origin || 'standart') === 'standart');
  const extra = (p.compliance.items || []).filter((i) => i.origin === 'elave');
  const std = reqCounts(standard);
  const ex = reqCounts(extra);
  const rows = [
    ['Maliyyə yoxlamaları aparılıb', done + ' / ' + checks.length],
    ['Standart tələblər — cəmi', String(std.total)],
    ['— planın mətnində yoxlanılıb', String(std.evaluated)],
    ['— cavablandırılıb', String(std.answered)],
    ['— ayrıca sənəd (mövcudluğu yoxlanılmır)', String(std.document)],
  ];
  if (std.notApplicable) rows.push(['— tətbiq edilmir (şərt planda istisna edilib)', String(std.notApplicable)]);
  if (std.notChecked) rows.push(['— yoxlanıla bilmədi', String(std.notChecked)]);
  rows.push(['Əlavə tələblər', extra.length ? reqSummary(ex) + ' · cəmi ' + ex.total : 'yoxdur'],
    ['Doldurulmamış yer', String((p.ingest.placeholders || []).length)],
    ['Mənbəsi təsdiqlənməyən rəqəm', String((p.finance.not_found || []).length)]);
  rows.forEach(([label, value]) => {
    const li = el('li');
    li.append(el('span', null, label), el('span', null, value));
    list.append(li);
  });
}
function renderTabCounts(p) {
  const checks = p.finance.checks || [];
  const items = p.compliance.items || [];
  // Nişan problem sayıdır; mənası tooltip-də (nəticə blokundakı göstəricilərlə eyni qayda).
  const fin = Report.financeCounts(checks);
  setTabCount('count-maliyye', fin.problems, {
    tone: fin.fail ? 'fail' : 'warn', complete: fin.total > 0, doneTitle: 'Bütün maliyyə yoxlamaları uyğundur',
    title: [fin.clarify && fin.clarify + ' dəqiqləşdirmə', fin.fail && fin.fail + ' uyğunsuz',
      fin.warn && fin.warn + ' kiçik fərq', fin.skip && fin.skip + ' yoxlanılmadı'].filter(Boolean).join(', '),
  });
  const problemText = (c) => [c.partial && c.partial + ' natamam', c.missing && c.missing + ' cavabsız',
    c.notChecked && c.notChecked + ' yoxlanılmadı'].filter(Boolean).join(', ') + ' tələb';
  const std = reqCounts(items.filter((i) => (i.origin || 'standart') === 'standart'));
  setTabCount('count-teleb', std.partial + std.missing + std.notChecked, {
    tone: std.missing ? 'fail' : 'warn', title: problemText(std), complete: std.total > 0, doneTitle: 'Bütün tələblər cavablandırılıb',
  });
  const ex = reqCounts(items.filter((i) => i.origin === 'elave'));
  setTabCount('count-elave', ex.partial + ex.missing + ex.notChecked, {
    tone: ex.missing ? 'fail' : 'warn', title: ex.total ? problemText(ex) : '', complete: ex.total > 0,
    doneTitle: 'Əlavə tələblərdə problem yoxdur',
  });
  const holes = (p.ingest.placeholders || []).length;
  setTabCount('count-bosyer', holes, { tone: 'warn', title: holes + ' doldurulmamış yer', complete: true, doneTitle: 'Boş yer qalmayıb' });
  layoutTabs();                                      // nişan dəyişdi — zolaq yenidən yerləşir
}

export { prepareForPrint, renderResults, resultParts, setFixesOpen };
