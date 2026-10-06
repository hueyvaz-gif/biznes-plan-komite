/* Nəticə tabı: qısa nəticə, düzəliş siyahısı, tələblər xəritəsi, maliyyə zolağı. */
import { $, badge, el, formatAz, formatDate, formatValue, icon, planName, reqCounts, reqSummary, setHidden, setText, writtenDecimals } from '../core/dom.js';
import { VERDICT_TONE } from '../core/labels.js';
import { state } from '../core/state.js';
import { closeDetail } from '../shell/detail.js';
import { layoutTabs, selectTab } from '../shell/tabs.js';
import { renderComparison } from './compare.js';
import { AG, loadEvents, renderAgents } from './debug-log.js';
import { renderExtraResults } from './extras.js';
import { openFinanceDetail, renderCharts, renderFinance, setFinanceFilter } from './finance.js';
import { openPlaceholderDetail, renderPlaceholders } from './placeholders.js';
import { openRequirementDetail, renderCoverage, renderRequirements, reqMeta, setRequirementFilter, standardItems } from './requirements.js';

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
  const head = $('reshead');
  if (head) head.dataset.tone = VERDICT_TONE[check.verdict] || 'skip';
  safely('nəticə', () => renderReport(check, p));
  safely('xəritə', () => renderMaps(p));
  safely('əhatə', () => renderScope(p));
  safely('maliyyə', () => renderFinance(p.finance));
  safely('qrafiklər', () => renderCharts(p.finance));
  safely('tələblər', () => renderCoverage(check, p.compliance));
  safely('tələb siyahısı', () => renderRequirements());
  safely('əlavə tələblər', () => renderExtraResults(p));
  safely('boş yerlər', () => renderPlaceholders(p.ingest.placeholders || []));
  safely('müqayisə', () => renderComparison(p.comparison));
  safely('tab nişanları', () => renderTabCounts(p));
  safely('iqtisadi təhlil', () => window.Econ && window.Econ.load(check));
  loadEvents(check.id).then(() => { if (state.check && state.check.id === check.id) renderAgents(); });

  const tab = new URLSearchParams(location.search).get('tab');
  selectTab(tab && $('tab-' + tab) ? 'panel-' + tab : 'panel-xulase', false);
}
/* ── Nəticə: qısa nəticə, vahid düzəliş siyahısı, yığcam maliyyə (static/report.js) ── */

const FIX_SHOW = 6;
/** Başlıq: sənədin hazırlıq statusu (sadə etiket) və yoxlamanın icra vəziyyəti — ayrı. */
function renderStatusLine(check) {
  const tone = VERDICT_TONE[check.verdict] || 'skip';
  const pill = $('res-status');
  if (pill) pill.className = 'statuspill statuspill--' + tone;
  setText('res-status-label', check.verdict_label
    || ((state.meta && state.meta.verdicts) || {})[check.verdict] || 'Tamamlandı');
  setText('res-runstate', 'Yoxlama tamamlandı · ' + formatDate(check.created_at));
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
  renderOverview(overview);
  // Statusun yenidən hesablanması daxili tarixçədir — "Yoxlama haqqında" bölməsində göstərilir.
  const rules = (check.result || {}).rules || {};
  const before = rules.reevaluated && rules.previous_verdict && rules.previous_verdict !== check.verdict
    ? ((state.meta && state.meta.verdicts) || {})[rules.previous_verdict] : null;
  $('about-result').textContent = 'Avtomatik yoxlama nəticəsidir. İnsan ekspert və ya komitə tərəfindən təsdiqlənməyib.'
    + (before ? ' Status sonradan yenilənmiş qaydalarla yenidən hesablanıb (əvvəl: “' + before + '”).' : '');

  // Yoxlanılmayan hissələr (texniki səbəb) — düzəliş deyil, ayrıca bildiriş.
  const technical = report.unchecked.filter((u) => u.technical);
  const failed = (p.compliance.failed_groups || []);
  $('sum-unchecked').hidden = technical.length === 0;
  if (technical.length) {
    const groups = [...new Set(technical.map((u) => u.group))].join(', ');
    $('sum-unchecked-text').textContent = technical.length + ' tələb texniki səbəbdən yoxlanılmadı ('
      + groups + '). Bu, sənəddə olmaması demək deyil.';
  }
  $('sum-retry').hidden = !(failed.length && check.run_state === 'tamamlandi' && !check.demo);

  // Düzəlişlər
  const fixes = report.fixes;
  $('fix-sub').textContent = overview.composition;
  $('fix-sub').hidden = !overview.composition;
  $('fixes').replaceChildren(...fixes.slice(0, FIX_SHOW).map(fixItem));
  $('fixes-more').replaceChildren(...fixes.slice(FIX_SHOW).map(fixItem));
  $('fixes-more').start = FIX_SHOW + 1;
  setFixesOpen(false);
  $('fixes-empty').hidden = fixes.length > 0;

  const aside = $('fix-aside');
  aside.replaceChildren();
  if (report.notApplicable.length) {
    const box = el('div', 'aside__row');
    box.append(el('h3', 'aside__title', 'Tətbiq edilmir'));
    const list = el('ul', 'aside__list');
    report.notApplicable.forEach((n) => {
      const li = el('li');
      li.append(el('strong', null, n.text), document.createTextNode(' — planda: '),
        el('q', null, n.quote || ''), el('span', 'fix__code', n.code));
      list.append(li);
    });
    box.append(list);
    aside.append(box);
  }
  if (report.documents.length) {
    // Status "Suallar və sənədlər" tabında yüklənən fayllardan gəlir (static/economics.js).
    const box = el('div', 'aside__row');
    const list = el('ul', 'aside__list docreq');
    report.documents.forEach((d) => {
      const li = el('li');
      li.append(el('span', null, d.text), document.createTextNode(' '), el('span', 'fix__code', d.code),
        document.createTextNode(' — '));
      const st = el('span', 'docreq__status', 'Gözlənilir');
      st.dataset.code = d.code;
      li.append(st);
      list.append(li);
    });
    box.append(el('h3', 'aside__title', 'Ayrıca təqdim ediləcək sənədlər'), list,
      el('p', 'docreq__hint', 'Sənədi “Suallar və sənədlər” tabında yükləyin; yüklənmiş sənəd üçün yoxlama nəticəsi göstərilir.'));
    aside.append(box);
  }

  // Maliyyə — yığcam cədvəl
  const rows = Report.financeRows(check.result || {});
  const checks = p.finance.checks || [];
  $('finsum').hidden = rows.length === 0;
  $('finsum-empty').hidden = rows.length > 0;
  $('finsum-body').replaceChildren(...rows.map((r) => {
    const c = checks.find((x) => x.id === r.id);
    const tr = el('tr');
    const th = el('th', 'finsum__title', r.title);
    th.scope = 'row';
    const result = el('td');
    const cls = r.label === 'Dəqiqləşdirmə' ? 's-warn' : 's-' + r.status;
    result.append(badge(cls, r.label));
    const more = el('td', 'finsum__go');
    const b = el('button', 'btn btn--small finsum__more');
    b.type = 'button';
    b.append(el('span', null, 'Ətraflı'), icon('chevronRight'));
    b.setAttribute('aria-label', r.title + ' — ətraflı: necə hesablandı və mənbə');
    b.addEventListener('click', () => openFinanceDetail(c, b));
    more.append(b);
    tr.append(th, el('td', 'num', formatValue(r.claimed, c, writtenDecimals(p.finance, c))),
      el('td', 'num', formatValue(r.computed, c)), result, more);
    return tr;
  }));

  const std = reqCounts(standardItems());
  $('go-teleb-sub').textContent = std.total
    ? std.total + ' tələb: ' + reqSummary(std) : 'Hər tələbin statusu və sitatı';
  const holes = (p.ingest.placeholders || []).length;
  $('go-bosyer-sub').textContent = holes ? holes + ' boş yer' : 'Boş yer qalmayıb';
}
/** Nəticə bloku: status + saylar, bloklayan problem, kliklənən göstəricilər, ən vacib 3 düzəliş. */
function renderOverview(o) {
  const host = $('sum-text');
  const blocking = el('p', 'overview__block' + (o.blocking.critical ? ' is-critical' : ''), o.blocking.text);
  const tiles = el('div', 'stats');
  o.tiles.forEach((t) => {
    const b = el('button', 'stat stat--' + t.id);
    b.type = 'button';
    b.title = t.hint;
    b.setAttribute('aria-label', t.title + ': ' + t.value + ' ' + t.unit + ', ' + t.sub + '. ' + t.hint + ' Tabı aç.');
    const value = el('span', 'stat__value', t.value);
    value.append(el('span', 'stat__unit', ' ' + t.unit));
    b.append(el('span', 'stat__title', t.title), value, el('span', 'stat__sub', t.sub));
    b.addEventListener('click', () => selectTab(t.tab, true));
    tiles.append(b);
  });
  const parts = [el('p', 'overview__headline', o.headline), blocking, tiles];
  if (o.top.length) {
    const top = el('p', 'overview__top');
    top.append(el('span', 'overview__toplabel', 'Ən vacib ' + o.top.length + ' düzəliş: '));
    o.top.forEach((t, i) => {
      if (i) top.append(document.createTextNode(' · '));
      const a = el('a', 'report__link', t.topic);
      a.href = '#' + t.anchor;
      a.addEventListener('click', (e) => { e.preventDefault(); focusFix(t.anchor); });
      top.append(a);
    });
    parts.push(top);
  }
  host.replaceChildren(...parts);
}
/** Nəticə blokundakı keçid: kart gizli siyahıdadırsa açılır, sonra karta sürüşür və fokuslanır. */
function focusFix(anchor) {
  const card = document.getElementById(anchor);
  if (!card) return;
  if (card.parentElement && card.parentElement.id === 'fixes-more') setFixesOpen(true);
  card.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  card.focus({ preventScroll: true });
}
function fixItem(f) {
  const li = el('li', 'fix fix--' + f.severity);
  li.id = f.anchor;
  li.tabIndex = -1;
  const head = el('div', 'fix__head');
  head.append(el('span', 'fix__sev', Report.SEVERITY_LABEL[f.severity]), el('h3', 'fix__topic', f.topic));
  (f.codes || []).forEach((c) => {
    // Kod kiçik və boz; tələbin tam adı tooltip-də və ekran oxuyucuda.
    const code = el('span', 'fix__code', c.code);
    code.title = c.title;
    code.setAttribute('aria-label', 'Tələb ' + c.title);
    head.append(code);
  });
  li.append(head);
  const body = el('dl', 'fix__body');
  const row = (label, value) => {
    if (!value) return;
    const wrap = el('div', 'fix__row');
    const dd = el('dd');
    if (typeof value === 'string') dd.textContent = value; else dd.append(value);
    wrap.append(el('dt', null, label), dd);
    body.append(wrap);
  };
  row('Nə çatışmır', f.missing);
  row('Nə etmək lazımdır', f.action);
  row('Sənəddə yeri', f.location);
  if (f.related && f.related.length) {
    const list = el('ul', 'fix__related');
    f.related.forEach((r) => {
      const item = el('li');
      item.append(document.createTextNode(r.text));
      if (r.ref) {
        const link = el('button', 'fix__inline', 'yerinə bax');
        link.type = 'button';
        link.setAttribute('aria-label', 'Yerinə bax: ' + r.text);
        link.addEventListener('click', () => openFixSource(r.ref, link));
        item.append(document.createTextNode(' · '), link);
      }
      list.append(item);
    });
    row('Əlaqəli', list);
  }
  li.append(body);
  if (f.ref) {
    const b = el('button', 'btn btn--small fix__src');
    b.type = 'button';
    b.append(icon('fileText'), el('span', null, 'Mənbəyə bax'));
    b.setAttribute('aria-label', 'Mənbəyə bax: ' + f.topic);
    b.addEventListener('click', () => openFixSource(f.ref, b));
    li.append(b);
  }
  return li;
}
/** "Mənbəyə bax": tələb, maliyyə yoxlaması və ya boş yer üçün mövcud dəlil paneli. */
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
function setFixesOpen(open) {
  const more = $('fixes-more');
  const toggle = $('fixes-toggle');
  const n = more.children.length;
  more.hidden = !open;
  toggle.hidden = n === 0;
  toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  toggle.textContent = open ? 'Daha az göstər' : 'Daha ' + n + ' bənd göstər';
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
  const badge = (id, n, hint, zeroHint) => {
    const b = $(id);
    b.textContent = n ? String(n) : zeroHint ? '0' : '';
    b.classList.toggle('is-zero', !n);
    b.title = n ? hint : zeroHint || '';
    b.parentElement.title = b.title;
  };
  const fin = Report.financeCounts(checks);
  badge('count-maliyye', fin.problems, [fin.clarify && fin.clarify + ' dəqiqləşdirmə', fin.fail && fin.fail + ' uyğunsuz',
    fin.warn && fin.warn + ' kiçik fərq', fin.skip && fin.skip + ' yoxlanılmadı'].filter(Boolean).join(', '));
  const problemText = (c) => [c.partial && c.partial + ' natamam', c.missing && c.missing + ' cavabsız',
    c.notChecked && c.notChecked + ' yoxlanılmadı'].filter(Boolean).join(', ') + ' tələb';
  const std = reqCounts(items.filter((i) => (i.origin || 'standart') === 'standart'));
  badge('count-teleb', std.partial + std.missing + std.notChecked, problemText(std));
  const ex = reqCounts(items.filter((i) => i.origin === 'elave'));
  badge('count-elave', ex.partial + ex.missing + ex.notChecked,
    ex.total ? problemText(ex) : '', ex.total ? 'Əlavə tələblərdə problem yoxdur' : 'Əlavə tələb yoxdur');
  const holes = (p.ingest.placeholders || []).length;
  badge('count-bosyer', holes, holes + ' doldurulmamış yer');
  layoutTabs();                                      // nişan dəyişdi — zolaq yenidən yerləşir
}

export { prepareForPrint, renderResults, resultParts, setFixesOpen };
