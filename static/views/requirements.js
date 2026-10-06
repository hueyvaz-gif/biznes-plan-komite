/* Standart tələblər tabı. */
import { api } from '../core/api.js';
import { $, badge, el, group, reqCounts, reqSummary, setBusy } from '../core/dom.js';
import { REQ_STATUS, REQ_TECHNICAL } from '../core/labels.js';
import { openCheck } from '../core/router.js';
import { state } from '../core/state.js';
import { openDetail } from '../shell/detail.js';
import { selectTab } from '../shell/tabs.js';
import { previewCard } from './finance.js';
import { resultParts } from './summary.js';
import { openDocAt } from './docviewer.js';
import { el as el2 } from '../ui/el.js';
import { icon as uiIcon } from '../ui/icons.js';
import { Badge, FilterChips, withPlaceholders } from '../ui/badge.js';
import { EmptyState, MiniBar, ProgressRing } from '../ui/card.js';
import { SourceQuote } from '../ui/disclosure.js';
import { reducedMotion } from '../ui/motion.js';

/* ── Tələblər tabı (Faza 5) ───────────────────────────────────────────────
 * Nəticə cümləsi → qrup xəritəsi (kafel, halqa, problem intensivliyi) → saylı filtrlər + axtarış (vurğu, canlı say)
 * → yığıla bilən qruplar (problemlilər açıq) → yerində açılan tələb sətri (sitat, yer, səbəb, "Sənəddə yeri"). */

const PROBLEM = new Set(['natamam', 'yoxdur']);
const REQ_TONE = { var: 'success', natamam: 'warning', yoxdur: 'danger', tetbiq_edilmir: 'neutral', sened: 'info', skip: 'neutral' };
const openReqs = new Set();
const groupOpen = new Map();         // group_id → true/false (istifadəçinin seçimi)
let chips = null;
let searchTimer = null;

/** Model şərhində ingiliscə "placeholder" → "boş yer" (hərfi sitata toxunulmur). */
const humanize = (s) => String(s || '').replace(/placeholder(lər|ləri|i|in|ə|da)?/gi, (_, sfx) => 'boş yer' + (sfx ? ({ lər: 'lər', ləri: 'ləri', i: 'i', in: 'in', ə: 'ə', da: 'də' }[sfx] || '') : ''));

function filterItems(items) {
  const n = (f) => items.filter(f).length;
  return [
    { id: 'hamisi', label: 'Hamısı', count: items.length },
    { id: 'problem', label: 'Problemlilər', count: n((i) => PROBLEM.has(i.status)), tone: n((i) => i.status === 'yoxdur') ? 'danger' : 'warning' },
    { id: 'yoxdur', label: 'Yoxdur', count: n((i) => i.status === 'yoxdur'), tone: 'danger' },
    { id: 'skip', label: 'Yoxlanılmayan', count: n((i) => i.status === 'skip') },
    { id: 'sened', label: 'Ayrıca sənəd', count: n((i) => i.status === 'sened') },
  ];
}
function syncReqChipAttrs() {
  document.querySelectorAll('#req-filters .ui-chip').forEach((c) => { c.dataset.req = c.dataset.id; });
}
function setRequirementFilter(name) {
  state.reqFilter = name;
  if (chips) chips.update(filterItems(standardItems()), name);
  syncReqChipAttrs();
  renderRequirements();
}
function requirementMatches(item) {
  const f = state.reqFilter;
  if (f === 'problem' && !PROBLEM.has(item.status)) return false;
  if (f === 'yoxdur' && item.status !== 'yoxdur') return false;
  if (f === 'skip' && item.status !== 'skip') return false;
  if (f === 'sened' && item.status !== 'sened') return false;
  if (state.reqGroup && item.group_id !== state.reqGroup) return false;
  if (state.reqQuery) {
    const haystack = (item.req_id + ' ' + item.text + ' ' + (item.missing || '')).toLocaleLowerCase('az');
    if (!haystack.includes(state.reqQuery)) return false;
  }
  return true;
}

/** Bir cümlə: neçəsi cavablandırılıb, problemlər neçə qrupdadır. */
function renderLead(items) {
  const c = reqCounts(items);
  const probGroups = new Set(items.filter((i) => PROBLEM.has(i.status)).map((i) => i.group_id)).size;
  const parts = [`${c.total} standart tələbdən ${Report.poss(c.answered)} cavablandırılıb.`];
  const prob = [c.partial && `${c.partial} natamam`, c.missing && `${c.missing} cavabsız`].filter(Boolean);
  if (prob.length) parts.push(`${Report.joinAz(prob)} tələb ${probGroups} qrupdadır.`);
  if (c.document) parts.push(`${c.document} bənd ayrıca sənəd tələb edir.`);
  $('req-lead').textContent = parts.join(' ');
}

/** Qrup xəritəsi: hər qrup kafeldir — halqa (tam/yoxlanılan), problem sayı, intensivlik (heatmap). */
function renderReqMap(items) {
  const groups = groupBy(items);
  const host = $('req-map');
  host.replaceChildren(...[...groups.values()].map((g) => {
    const c = reqCounts(g.items);
    const problems = g.items.filter((i) => PROBLEM.has(i.status)).length;
    const missing = g.items.some((i) => i.status === 'yoxdur');
    const ratio = c.evaluated ? problems / c.evaluated : 0;
    const heat = problems === 0 ? 0 : missing ? 3 : ratio > 0.4 ? 2 : 1;
    const pct = c.evaluated ? Math.round((c.answered / c.evaluated) * 100) : 100;
    const title = g.title.replace(/^\d+\.\s*/, '');
    const tile = el2('button', {
      type: 'button', class: ['reqtile', `reqtile--h${heat}`, state.reqGroup === g.id && 'is-active'], dataset: { group: g.id },
      'aria-label': `${g.title}: ${c.evaluated} yoxlanılan tələbdən ${c.answered} cavablandırılıb` + (problems ? `, ${problems} problemli` : '') + '. Siyahını bu qrupa süz.',
      'aria-pressed': String(state.reqGroup === g.id),
      on: { click: () => focusGroup(g.id) },
    }, ProgressRing({ value: pct, size: 44, stroke: 5, center: `${c.answered}/${c.evaluated}`, tone: missing ? 'danger' : problems ? 'warning' : 'success', label: `${pct}%` }),
    el2('span', { class: 'reqtile__text' }, el2('span', { class: 'reqtile__title', text: title }),
      el2('span', { class: 'reqtile__meta', text: problems ? `${problems} problem` : c.document && !c.evaluated ? `${c.document} ayrıca sənəd` : 'tam ✓' })));
    tile.querySelector('.ui-ring').setAttribute('aria-hidden', 'true');
    return tile;
  }));
}
function groupBy(items) {
  const groups = new Map();
  items.forEach((i) => {
    if (!groups.has(i.group_id)) groups.set(i.group_id, { id: i.group_id, title: i.group_title, items: [] });
    groups.get(i.group_id).items.push(i);
  });
  return groups;
}
/** Kafel kliki: siyahı həmin qrupa süzülür (ikinci klik — süzgəci götürür), qrupa sürüşür. */
function focusGroup(id) {
  state.reqGroup = state.reqGroup === id ? '' : id;
  $('req-group').value = state.reqGroup;
  if (state.reqGroup) groupOpen.set(id, true);
  renderRequirements();
  const sec = $('reqgroup-' + id);
  if (sec && state.reqGroup) sec.scrollIntoView({ block: 'start', behavior: reducedMotion() ? 'auto' : 'smooth' });
}

function renderRequirements() {
  const items = standardItems();
  fillGroupSelect(items);
  renderLead(items);
  renderReqMap(items);
  if (!chips) {
    chips = FilterChips({ label: 'Status süzgəci', items: filterItems(items), value: state.reqFilter || 'hamisi', onChange: setRequirementFilter });
    $('req-filters').replaceChildren(chips);
  } else chips.update(filterItems(items), state.reqFilter || 'hamisi');
  syncReqChipAttrs();
  const visible = items.filter(requirementMatches);
  const filtered = state.reqFilter !== 'hamisi' || state.reqGroup || state.reqQuery;
  $('req-count').textContent = filtered ? `${items.length}-dən ${visible.length} nəticə` : `${items.length} tələb`;
  const host = $('req-groups');
  if (!visible.length) {
    host.replaceChildren(EmptyState({ icon: 'search', compact: true, title: 'Bu süzgəcə uyğun tələb yoxdur',
      text: state.reqQuery ? `“${state.reqQuery}” sorğusunu dəyişin və ya süzgəci sıfırlayın.` : 'Süzgəci dəyişin.',
      action: { label: 'Süzgəci sıfırla', onClick: resetRequirementFilters } }));
    return;
  }
  const all = groupBy(items);
  const shown = groupBy(visible);
  host.replaceChildren(...[...shown.values()].map((g) => groupSection(g, all.get(g.id), filtered)));
}
function resetRequirementFilters() {
  state.reqGroup = '';
  state.reqQuery = '';
  $('req-group').value = '';
  $('req-search').value = '';
  setRequirementFilter('hamisi');
}

function groupSection(g, full, filtered) {
  const c = reqCounts(full.items);
  const problems = full.items.filter((i) => PROBLEM.has(i.status)).length;
  const open = filtered || (groupOpen.has(g.id) ? groupOpen.get(g.id) : problems > 0);
  const bodyId = 'reqgroup-body-' + g.id;
  const head = el2('button', { type: 'button', class: 'reqgrp__head', 'aria-expanded': String(open), 'aria-controls': bodyId },
    uiIcon('chevronRight', { size: 'sm' }),
    el2('span', { class: 'reqgrp__title', text: g.title }),
    el2('span', { class: 'reqgrp__bar' }, MiniBar({ segments: [
      { value: c.answered, tone: 'success', label: 'cavablandırılıb' }, { value: c.partial, tone: 'warning', label: 'natamam' },
      { value: c.missing, tone: 'danger', label: 'cavabsız' }, { value: c.notApplicable + c.document + c.notChecked, tone: 'neutral', label: 'digər' }],
    label: `${c.answered}/${c.evaluated} tam` })),
    el2('span', { class: 'reqgrp__count', text: `${c.answered}/${c.evaluated} tam` }),
    problems ? Badge(`${problems}`, { tone: full.items.some((i) => i.status === 'yoxdur') ? 'danger' : 'warning', size: 'sm', title: `${problems} problemli tələb` }) : null);
  const list = el2('ul', { class: 'reqlist2', id: bodyId }, g.items.map((item) => requirementRow(item)));
  const panel = el2('div', { class: 'reqgrp__panel' }, el2('div', { class: 'reqgrp__inner' }, list));
  panel.firstChild.inert = !open;
  const sec = el2('section', { class: ['reqgrp', open && 'is-open'], id: 'reqgroup-' + g.id }, head, panel);
  head.addEventListener('click', () => {
    const now = head.getAttribute('aria-expanded') !== 'true';
    groupOpen.set(g.id, now);
    head.setAttribute('aria-expanded', String(now));
    sec.classList.toggle('is-open', now);
    panel.firstChild.inert = !now;
  });
  return sec;
}

/** Axtarış sözünü mətndə <mark> ilə vurğulayır (registrə həssas deyil); [MƏLUMAT LAZIMDIR] → boş yer pill-i. */
function marked(text) {
  const q = state.reqQuery;
  const frag = document.createDocumentFragment();
  const pieces = String(text || '').split(/(\[\s*MƏLUMAT LAZIMDIR[^\]]*\])/iu);
  for (const piece of pieces) {
    if (/^\[\s*MƏLUMAT LAZIMDIR/iu.test(piece)) { frag.append(withPlaceholders(piece)); continue; }
    if (!q) { frag.append(piece); continue; }
    const low = piece.toLocaleLowerCase('az');
    let at = 0;
    for (let i = low.indexOf(q); i >= 0; i = low.indexOf(q, i + q.length)) {
      frag.append(piece.slice(at, i), el2('mark', { class: 'reqhit', text: piece.slice(i, i + q.length) }));
      at = i + q.length;
    }
    frag.append(piece.slice(at));
  }
  return frag;
}

function requirementRow(item) {
  const meta = reqMeta(item);
  const open = openReqs.has(item.req_id);
  const detId = 'reqdet-' + item.req_id;
  const head = el2('button', { type: 'button', class: 'reqrow__head', 'aria-expanded': String(open), 'aria-controls': detId },
    el2('span', { class: 'reqrow__id', text: item.req_id }),
    el2('span', { class: 'reqrow__text' }, marked(item.text),
      item.missing && !open ? el2('span', { class: 'reqrow__missing' }, marked(humanize(item.missing))) : null),
    Badge(meta.label, { tone: REQ_TONE[item.status] || 'neutral', size: 'sm' }),
    uiIcon('chevronDown', { size: 'sm' }));
  const inner = el2('div', { class: 'reqrow__inner' });
  inner.inert = !open;
  const row = el2('li', { class: ['reqrow', `reqrow--${item.status}`, open && 'is-open'], dataset: { code: item.req_id }, tabIndex: -1 },
    head, el2('div', { class: 'reqrow__panel', id: detId }, inner));
  if (open) inner.append(requirementDetail(item));
  const toggle = (force) => {
    const now = force ?? !openReqs.has(item.req_id);
    if (now) openReqs.add(item.req_id); else openReqs.delete(item.req_id);
    if (now && !inner.childNodes.length) inner.append(requirementDetail(item));
    row.classList.toggle('is-open', now);
    head.setAttribute('aria-expanded', String(now));
    inner.inert = !now;
    const miss = head.querySelector('.reqrow__missing');
    if (miss) miss.hidden = now;
  };
  head.addEventListener('click', () => toggle());
  row.toggle = toggle;
  return row;
}

/** Açılan sətir: səbəb → hərfi sitat (Sənəddə yeri) → şərt / mənbə / tarixçə → qayda. */
function requirementDetail(item) {
  const box = el2('div', { class: 'reqrow__body' });
  const sec = (title, ...content) => el2('section', { class: 'fdet__sec' }, el2('h4', { class: 'fdet__h', text: title }), ...content);
  if (item.missing) box.append(sec('Nə çatışmır', el2('p', { class: 'fdet__text' }, marked(humanize(item.missing)))));
  if (item.comment) box.append(sec('Statusun səbəbi', el2('p', { class: 'fdet__text', text: humanize(item.comment) })));
  const s0 = (item.sections || [])[0];
  const where = (item.sections || []).map((s) => s.title + (s.table_id ? ` · cədvəl ${s.table_id}` : '')).join('; ');
  const canOpen = s0 && item.quote;
  box.append(sec('Biznes plandan (hərfi sitat)', item.quote
    ? SourceQuote({ section: where || 'Sənəd', quote: item.quote, location: s0 && s0.table_id ? `Cədvəl ${s0.table_id}` : 'Mətndə',
      onOpen: canOpen ? () => openDocAt('req:' + item.req_id, { fallback: () => openRequirementDetail(item, null) }) : null })
    : el2('p', { class: 'fdet__text fdet__muted', text: where ? `Sənəddə yeri: ${where}. Təsdiqlənmiş hərfi sitat yoxdur.` : 'Təsdiqlənmiş istinad və sitat yoxdur.' })));
  if (item.condition) {
    box.append(sec('Tətbiq şərti', el2('p', { class: 'fdet__text', text: item.condition.text
      + (item.status === 'tetbiq_edilmir' ? ' — plan bu şərti açıq istisna edir, tələb tətbiq edilmir.' : ' — planda bu barədə açıq ifadə yoxdur, dəqiqləşdirmə lazımdır.') })));
  }
  if (item.source) {
    box.append(sec('Tələb sənədindəki mənbə', el2('p', { class: 'fdet__text', text: (item.source.source_name || 'İstifadəçi əlavə edib')
      + (item.source.ref ? ' · ' + item.source.ref : '') + (item.source.edited ? ' · istifadəçi redaktə edib' : '') }),
    item.source.fragment ? SourceQuote({ quote: item.source.fragment }) : null));
  }
  const carried = Report.resolveCarried(item).conflict;
  if (carried) {
    box.append(sec('Qiymətləndirmə tarixçəsi', el2('p', { class: 'fdet__text', text: 'Status v' + carried.version + '-dən saxlanılıb: istinad edilən bölmələrin mətni dəyişməyib. '
      + 'Bu yoxlamada yeni qiymətləndirmə “' + (REQ_STATUS[carried.now] || REQ_STATUS.skip).label + '” verdi. '
      + (carried.resolved ? 'Saxlanan statusun sənəddən sitatı var — o əsas götürülür.' : 'Yeni qiymətləndirmənin sitatı var — fərq həll olunmayıb, bölməni sənəddə yoxlayın.') })));
  }
  box.append(el2('p', { class: 'fdet__rule' }, el2('span', { class: 'fdet__rulelabel', text: 'Qayda: ' }), item.status === 'sened'
    ? 'Bu bənd ayrıca sənəd tələb edir. Tətbiq həmin sənədin mövcudluğunu planın mətnində yoxlamır.'
    : '“Cavablandırılıb” statusu yalnız mövcud bölməyə/cədvələ istinad və sənəddə hərfi tapılan sitat varsa qalır.'));
  return box;
}

/** Kənardan (Ctrl+K, Nəticə tabı): süzgəclər sıfırlanır, qrup və sətir açılır, sətrə sürüşüb vurğulanır. */
function revealRequirement(code) {
  selectTab('panel-teleb', false);
  state.reqGroup = '';
  state.reqQuery = '';
  $('req-group').value = '';
  $('req-search').value = '';
  const item = standardItems().find((i) => i.req_id === code);
  if (item) { groupOpen.set(item.group_id, true); openReqs.add(code); }
  setRequirementFilter('hamisi');
  const row = document.querySelector('.reqrow[data-code="' + CSS.escape(code) + '"]');
  if (!row) return null;
  row.scrollIntoView({ block: 'center', behavior: reducedMotion() ? 'auto' : 'smooth' });
  row.focus({ preventScroll: true });
  row.classList.remove('is-flash');
  void row.offsetWidth;
  row.classList.add('is-flash');
  return row;
}

/** Axtarış (150ms debounce) və qrup seçimi — bir dəfə qoşulur. */
function wireRequirements() {
  $('req-search').addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { state.reqQuery = e.target.value.trim().toLocaleLowerCase('az'); renderRequirements(); }, 150);
  });
  $('req-group').addEventListener('change', (e) => { state.reqGroup = e.target.value; renderRequirements(); });
}

/* ── Standart tələblər ──────────────────────────────────────────────────── */

function reqMeta(item) {
  if (item.status === 'skip' && item.technical) return REQ_TECHNICAL;
  return REQ_STATUS[item.status] || REQ_STATUS.skip;
}
function standardItems() {
  const items = state.check ? (resultParts(state.check).compliance.items || []) : [];
  return items.filter((i) => (i.origin || 'standart') === 'standart');
}
function renderCoverage(check, compliance) {
  const c = compliance.coverage;
  const std = reqCounts(standardItems());
  $('req-coverage').textContent = c
    ? 'Cəmi ' + std.total + ' standart tələb: ' + std.evaluated + '-i planın mətnində yoxlanılıb ('
      + reqSummary({ ...std, document: 0, notChecked: 0, total: std.evaluated }) + ')'
      + (std.document ? '; ' + std.document + '-i ayrıca sənəd tələb edir — mövcudluğu yoxlanılmır' : '')
      + (c.not_selected ? '; ' + c.not_selected + ' seçilməyən qrupda' : '')
      + (c.technical ? '; ' + c.technical + ' texniki nasazlıq səbəbindən yoxlanılmayıb' : '')
      + (c.no_answer ? '; ' + c.no_answer + ' üçün nəticə alınmayıb' : '') + '.'
    : '';
  const failed = compliance.failed_groups || [];
  const box = $('failed-groups');
  box.hidden = !(failed.length && check.run_state === 'tamamlandi');
  if (!box.hidden) {
    const names = (list) => list.map((g) => g.group_title || g.group_id).join(', ');
    const full = failed.filter((g) => !g.partial);
    const partial = failed.filter((g) => g.partial);
    $('failed-groups-text').textContent = [
      full.length ? 'Texniki nasazlıq: model bu qrupları yoxlaya bilmədi — ' + names(full) + '.' : '',
      partial.length ? 'Qismən yoxlanıldı (agentin addım büdcəsi çatmadı): ' + names(partial)
        + ' — yoxlanılmayan bəndlər “Texniki nasazlıq” kimi göstərilir.' : '',
      'Bu, sənəddə məlumatın olmaması demək deyil. Digər nəticələr saxlanılır, yalnız bu qruplar yenidən yoxlanılır.',
    ].filter(Boolean).join(' ');
  }
}
function fillGroupSelect(items) {
  const select = $('req-group');
  const seen = new Map();
  items.forEach((i) => { if (!seen.has(i.group_id)) seen.set(i.group_id, i.group_title); });
  const signature = [...seen.keys()].join('|');
  if (select.dataset.signature === signature) return;
  select.dataset.signature = signature;
  const all = el('option', null, 'Bütün qruplar');
  all.value = '';
  select.replaceChildren(all);
  seen.forEach((title, id) => { const o = el('option', null, title); o.value = id; select.append(o); });
  select.value = seen.has(state.reqGroup) ? state.reqGroup : '';
  state.reqGroup = select.value;
}
function openRequirementDetail(item, row) {
  const meta = reqMeta(item);
  openDetail('Tələb ' + item.req_id, (body) => {
    const head = el('p');
    head.append(badge(meta.cls, meta.label));
    body.append(head, group('Tələb', el('p', null, item.text)), group('Qrup', el('p', null, item.group_title)));
    if (item.source) {
      // Tələb sənədindəki mənbə — plandakı cavabdan AYRI.
      const src = el('div');
      src.append(el('p', null, (item.source.source_name || 'İstifadəçi əlavə edib')
        + (item.source.ref ? ' · ' + item.source.ref : '')
        + (item.source.edited ? ' · istifadəçi redaktə edib' : '')));
      if (item.source.fragment) src.append(el('blockquote', 'quote', item.source.fragment));
      body.append(group('Tələb sənədindəki mənbə', src));
    }
    if (item.missing) body.append(group('Nə çatışmır', el('p', null, item.missing)));
    const carried = Report.resolveCarried(item).conflict;
    if (carried) {
      // Texniki qərar tarixçəsi — əsas statusun yanında deyil, burada.
      const history = el('details', 'history');
      history.append(el('summary', null, 'Qiymətləndirmə tarixçəsi'),
        el('p', null, 'Status v' + carried.version + '-dən saxlanılıb: istinad edilən bölmələrin mətni dəyişməyib. '
          + 'Bu yoxlamada yeni qiymətləndirmə “' + (REQ_STATUS[carried.now] || REQ_STATUS.skip).label + '” verdi. '
          + (carried.resolved ? 'Saxlanan statusun sənəddən sitatı var — o əsas götürülür.'
            : 'Yeni qiymətləndirmənin sitatı var — fərq həll olunmayıb, bölməni sənəddə yoxlayın.')));
      body.append(history);
    }
    if (item.condition) {
      body.append(group('Tətbiq şərti', el('p', null, item.condition.text
        + (item.status === 'tetbiq_edilmir' ? ' — plan bu şərti açıq istisna edir, tələb tətbiq edilmir.'
          : ' — planda bu barədə açıq ifadə yoxdur, dəqiqləşdirmə lazımdır.'))));
    }
    const sections = item.sections || [];
    const list = el('ul', 'bullets');
    sections.forEach((s) => list.append(el('li', null, s.id + (s.table_id ? ' · cədvəl ' + s.table_id : '') + ' — ' + s.title)));
    body.append(group('Biznes plandakı yer', sections.length ? list : el('p', null, 'Təsdiqlənmiş istinad yoxdur.')));
    (item.previews || []).forEach((pv) => body.append(group('Bölmədən: ' + pv.section_title, previewCard(pv))));
    body.append(group('Biznes plandan (hərfi sitat)', item.quote
      ? el('blockquote', 'quote', item.quote) : el('p', null, 'Təsdiqlənmiş sitat yoxdur.')));
    if (!item.quote && item.evidence) {
      // Köhnə formatda saxlanmış nəticə: sübut o vaxt sənədlə tutuşdurulmurdu.
      body.append(group('Köhnə formatda sübut (sənədlə tutuşdurulmayıb)', el('p', null, item.evidence)));
    }
    if (item.comment) body.append(group('Modelin şərhi', el('p', null, item.comment)));
    body.append(group('Yoxlama qaydası', el('p', 'rule', item.status === 'sened'
      ? 'Bu bənd ayrıca sənəd tələb edir. Tətbiq həmin sənədin mövcudluğunu YOXLAMIR.'
      : '"Var" statusu yalnız mövcud bölməyə/cədvələ istinad və sənəddə hərfi tapılan sitat varsa qalır.')));
  }, row);
}
async function retryFailedGroups() {
  if (!state.check) return;
  const button = $('retry-groups-btn');
  setBusy(button, true, 'Göndərilir…');
  try {
    await api.post('/api/checks/' + encodeURIComponent(state.check.id) + '/retry-groups');
    openCheck(state.check.id);
  } catch (e) {
    $('failed-groups-text').textContent = e.message || 'Serverlə əlaqə kəsildi.';
  } finally {
    setBusy(button, false);
  }
}

export { openRequirementDetail, renderCoverage, renderRequirements, reqMeta, retryFailedGroups, revealRequirement, setRequirementFilter, standardItems, wireRequirements };
