/* Müqayisə tabı (Faza 8): istənilən iki versiya, statuslar CARİ qaydalarla (GET /api/checks/{id}/compare?with=),
 * "Nə dəyişdi" xülasəsi (4 göstərici), diff stilində dəyişikliklər, iqtisadi göstəricilər "əvvəl/sonra".
 * Saxlanmış müqayisə (result.comparison) yalnız default cütü tapmaq üçün işlənir — status ondan götürülmür. */
import { api } from '../core/api.js';
import { $ } from '../core/dom.js';
import { REQ_STATUS, TREND, VERDICT_TONE } from '../core/labels.js';
import { openCheck } from '../core/router.js';
import { state } from '../core/state.js';
import { el } from '../ui/el.js';
import { icon } from '../ui/icons.js';
import { Badge } from '../ui/badge.js';
import { StatTile, EmptyState } from '../ui/card.js';
import { Disclosure } from '../ui/disclosure.js';
import { fmtDate, fmtMoney, fmtNumber, fmtPct, fmtYears } from '../format.js';
import { fmtCheckValue } from './summary-panel.js';
import { loadDoc, openDocAt, placeholderTitle } from './docviewer.js';

const TONE = { ok: 'success', warn: 'warning', fail: 'danger', skip: 'neutral' };
const VTONE = { ok: 'success', warn: 'warning', fail: 'danger', skip: 'neutral' };
const REQ_TONE = { var: 'success', natamam: 'warning', yoxdur: 'danger', tetbiq_edilmir: 'neutral', sened: 'info', skip: 'neutral' };
let versions = [];
let pair = null;                       // {from, to}
let token = 0;

/** Giriş: renderResults-dan (saxlanmış müqayisə) — versiyalar yüklənir, default cüt canlı müqayisə olunur. */
async function renderComparison(stored) {
  const host = $('cmp-body');
  const check = state.check;
  if (!host || !check) return;
  const my = ++token;
  host.replaceChildren(el('p', { class: 'cmpv__loading', text: 'Versiyalar yüklənir…' }));
  try {
    versions = (await api.get('/api/plans/' + encodeURIComponent(check.plan_id) + '/checks'))
      .filter((c) => c.run_state === 'tamamlandi').sort((a, b) => a.version - b.version);
  } catch (_) { versions = []; }
  if (my !== token) return;
  const others = versions.filter((v) => v.id !== check.id);
  $('cmp-empty').hidden = true;
  if (!others.length) {
    host.replaceChildren(EmptyState({ icon: 'file', title: 'Müqayisə üçün başqa versiya yoxdur',
      text: 'Eyni plan üçün yeni versiya yükləsəniz, dəyişikliklər burada görünəcək: status, boş yerlər, tələblər və maliyyə göstəriciləri.' }));
    return;
  }
  const prevId = stored && stored.previous && others.some((v) => v.id === stored.previous.check_id) ? stored.previous.check_id
    : (others.filter((v) => v.version < check.version).pop() || others[0]).id;
  const a = versions.find((v) => v.id === prevId);
  pair = a.version < check.version ? { from: prevId, to: check.id } : { from: check.id, to: prevId };
  load();
}

async function load() {
  const host = $('cmp-body');
  const my = ++token;
  host.replaceChildren(selector(), el('p', { class: 'cmpv__loading', text: 'Müqayisə hesablanır…' }));
  try {
    const data = await api.get('/api/checks/' + encodeURIComponent(pair.to) + '/compare?with=' + encodeURIComponent(pair.from));
    if (my !== token) return;
    host.replaceChildren(...view(data));
  } catch (err) {
    host.replaceChildren(selector(), el('p', { class: 'alert alert--warn', text: err.message || 'Müqayisə alınmadı.' }));
  }
}

/* ── Versiya seçicisi: v1 (05.10 19:48) → v2 (05.10 21:59) ─────────────── */
function selector() {
  const label = (v) => `v${v.version} (${fmtDate(v.created_at).slice(0, 5)} ${fmtDate(v.created_at).slice(11)})`;
  // Digər tərəfdə seçilmiş versiya bu siyahıda bağlıdır (eyni versiya özü ilə müqayisə olunmur).
  const select = (id, value, other, onChange) => {
    const s = el('select', { class: 'ui-field__input', id, on: { change: (e) => onChange(e.target.value) } },
      versions.map((v) => el('option', { value: v.id, text: label(v) + (v.id === state.check.id ? ' — açıq' : ''), selected: v.id === value, disabled: v.id === other })));
    return el('span', { class: 'ui-field ui-field--select' }, s, icon('chevronDown', { size: 'sm' }));
  };
  const swap = (from, to) => {
    if (from === to) return;
    const a = versions.find((v) => v.id === from); const b = versions.find((v) => v.id === to);
    pair = a.version < b.version ? { from, to } : { from: to, to: from };
    load();
  };
  return el('div', { class: 'cmpv__pick' },
    el('label', { class: 'sr-only', for: 'cmp-from', text: 'Əvvəlki versiya' }), select('cmp-from', pair.from, pair.to, (v) => swap(v, pair.to)),
    el('span', { class: 'cmpv__arrow', 'aria-hidden': 'true' }, icon('arrowRight', { size: 'sm' })),
    el('label', { class: 'sr-only', for: 'cmp-to', text: 'Yeni versiya' }), select('cmp-to', pair.to, pair.from, (v) => swap(pair.from, v)));
}

/* ── Görünüş ────────────────────────────────────────────────────────────── */
function view(c) {
  const verdicts = (state.meta && state.meta.verdicts) || {};
  const prev = c.previous; const cur = c.current;
  const vb = (v) => Badge(verdicts[v] || v || '—', { tone: VTONE[VERDICT_TONE[v]] || 'neutral' });
  const status = el('div', { class: 'cmpv__status' },
    el('span', { class: 'cmpv__ver' }, el('button', { type: 'button', class: 'linkbtn', text: `v${prev.version}`, on: { click: () => openCheck(prev.check_id) } }), vb(c.verdict.before)),
    el('span', { class: 'cmpv__arrow', 'aria-hidden': 'true' }, icon('arrowRight', { size: 'sm' })),
    el('span', { class: 'cmpv__ver' }, el('button', { type: 'button', class: 'linkbtn', text: `v${cur.version}`, on: { click: () => openCheck(cur.id) } }), vb(c.verdict.after)),
    el('span', { class: 'cmpv__note', text: 'hər iki status cari qaydalarla' }));
  const n = c.counts || {};
  const ph = c.placeholders || { before: 0, after: 0, filled: [], added: [] };
  const diff = ph.after - ph.before;
  const tiles = el('div', { class: 'cmpv__tiles' },
    StatTile({ label: 'Yaxşılaşıb', value: n.yaxsilasdi || 0, unit: '↑', tone: n.yaxsilasdi ? 'success' : undefined, sub: 'tələb və maliyyə bəndi' }),
    StatTile({ label: 'Pisləşib', value: n.pislesdi || 0, unit: '↓', tone: n.pislesdi ? 'danger' : undefined, sub: 'tələb və maliyyə bəndi' }),
    StatTile({ label: 'Boş yer', value: `${ph.before} → ${ph.after}`, sub: diff ? `${fmtNumber(diff, { signed: true })} yer` : 'dəyişməyib', tone: diff < 0 ? 'success' : diff > 0 ? 'warning' : undefined }),
    StatTile({ label: 'Yeni boş yer', value: n.added || 0, tone: n.added ? 'warning' : undefined, sub: n.added ? 'yeni versiyada əlavə olunub' : 'yoxdur' }));
  return [
    el('section', { class: 'finv__lead' }, el('h2', { class: 'sumv__eyebrow', text: 'Versiyaların müqayisəsi' }),
      selector(), el('p', { class: 'sumv__sentence', text: sentence(c) }), status),
    tiles,
    econBars(c.finance || []),
    changes(c, cur),
  ].filter(Boolean);
}
function sentence(c) {
  const n = c.counts || {};
  const ph = c.placeholders || {};
  const parts = [`v${c.current.version}-də ${n.yaxsilasdi || 0} bənd yaxşılaşıb, ${n.pislesdi || 0} bənd pisləşib`];
  if (ph.before !== ph.after) parts.push(`boş yerlər ${ph.before}-dan ${ph.after}-a ${ph.after < ph.before ? 'enib' : 'qalxıb'}`);
  return parts.join('; ') + '.';
}

/** NPV, IRR, PP: əvvəl/sonra mini bar cütləri (planın öz rəqəmləri). */
function econBars(fin) {
  const pick = { npv: ['NPV', (v) => fmtMoney(v, { compact: true })], irr: ['IRR', (v) => fmtPct(v, { points: true })], pp: ['PP', (v) => fmtYears(v)] };
  const rows = Object.entries(pick).map(([id, [label, fmt]]) => {
    const f = fin.find((x) => x.id === id);
    if (!f || (f.claimed_before == null && f.claimed_after == null)) return null;
    const a = f.claimed_before; const b = f.claimed_after;
    const max = Math.max(Math.abs(a || 0), Math.abs(b || 0)) || 1;
    const bar = (v, cls) => el('span', { class: 'cmpbar__track' }, el('span', { class: ['cmpbar__fill', cls, v < 0 && 'is-neg'], style: { width: `${(Math.abs(v || 0) / max) * 100}%` } }));
    const better = id === 'pp' ? b < a : b > a;
    return el('li', { class: 'cmpbar' },
      el('span', { class: 'cmpbar__label', text: label }),
      el('span', { class: 'cmpbar__pair' },
        el('span', { class: 'cmpbar__row' }, el('span', { class: 'cmpbar__v', text: 'əvvəl' }), bar(a, 'is-before'), el('span', { class: ['cmpbar__num', a < 0 && 'tone-negative'], text: a == null ? '—' : fmt(a) })),
        el('span', { class: 'cmpbar__row' }, el('span', { class: 'cmpbar__v', text: 'sonra' }), bar(b, better ? 'is-better' : 'is-worse'), el('span', { class: ['cmpbar__num', b < 0 && 'tone-negative'], text: b == null ? '—' : fmt(b) }))));
  }).filter(Boolean);
  if (!rows.length) return null;
  return el('section', { class: 'cmpv__sec' }, el('h3', { class: 'radar__h', text: 'İqtisadi göstəricilər: əvvəl → sonra' }), el('ul', { class: 'cmpbars' }, rows));
}

/** Diff: köhnə dəyər üstüxətli boz, yeni — rəngli; boş yer doldurulubsa — yeni versiyada bölməyə keçid. */
function changes(c, cur) {
  const secs = [];
  const old = (text) => el('del', { class: 'diff__old', text });
  const arrow = () => el('span', { class: 'diff__arrow', 'aria-hidden': 'true', text: '→' });
  const trendTone = (t) => (t === 'yaxsilasdi' ? 'success' : t === 'pislesdi' ? 'danger' : 'neutral');

  const fin = (c.finance || []).filter((f) => f.trend !== 'eyni');
  if (fin.length) {
    secs.push(section('Maliyyə yoxlamaları', fin.length, el('ul', { class: 'diff' }, fin.map((f) => el('li', { class: `diff__row diff__row--fin diff__row--${f.trend}` },
      el('span', { class: 'diff__title', text: f.title }),
      el('span', { class: 'diff__vals' }, old(fmtCheckValue(f.claimed_before, f)), arrow(), el('ins', { class: 'diff__new', text: fmtCheckValue(f.claimed_after, f) })),
      el('span', { class: 'diff__vals' }, statusOld(f.status_before), arrow(), Badge(statusLabel(f.status_after), { tone: TONE[f.status_after] || 'neutral', size: 'sm' })),
      Badge((TREND[f.trend] || TREND.deyisdi).label, { tone: trendTone(f.trend), size: 'sm' }))))));
  }
  const reqs = c.requirements || [];
  if (reqs.length) {
    const order = { pislesdi: 0, yaxsilasdi: 1, deyisdi: 2 };
    secs.push(section('Tələblərin statusu', reqs.length, el('ul', { class: 'diff' }, [...reqs].sort((a, b) => (order[a.trend] ?? 3) - (order[b.trend] ?? 3)).map((r) => el('li', { class: `diff__row diff__row--${r.trend}` },
      el('span', { class: 'diff__code', text: r.req_id }),
      el('span', { class: 'diff__title' }, r.text, el('span', { class: 'diff__sub', text: r.group_title })),
      el('span', { class: 'diff__vals' }, el('del', { class: 'diff__old', text: (REQ_STATUS[r.status_before] || { label: r.status_before || '—' }).label }), arrow(),
        Badge((REQ_STATUS[r.status_after] || { label: r.status_after || '—' }).label, { tone: REQ_TONE[r.status_after] || 'neutral', size: 'sm' })),
      Badge((TREND[r.trend] || TREND.deyisdi).label, { tone: trendTone(r.trend), size: 'sm' }))))));
  }
  const ph = c.placeholders || { filled: [], added: [] };
  const phRows = [
    ...(ph.filled || []).map((p) => phRow(p, 'filled', cur)),
    ...(ph.added || []).map((p) => phRow(p, 'added', cur)),
  ];
  if (phRows.length) secs.push(section('Boş yerlər', phRows.length, el('ul', { class: 'diff' }, phRows)));
  const lists = c.requirement_list || {};
  const listRows = ['added', 'removed', 'changed'].flatMap((k) => (lists[k] || []).map((r) => el('li', { class: 'diff__row' },
    el('span', { class: 'diff__code', text: r.req_id }), el('span', { class: 'diff__title' }, r.text, r.text_before ? el('span', { class: 'diff__sub' }, old(r.text_before)) : null),
    Badge({ added: 'Tələb əlavə edildi', removed: 'Tələb çıxarıldı', changed: 'Tələb dəyişdi' }[k], { tone: 'info', size: 'sm' }))));
  if (listRows.length) secs.push(section('Tələb siyahısı (meyarların dəyişməsi)', listRows.length, el('ul', { class: 'diff' }, listRows)));
  const carried = c.carried || [];
  if (carried.length) {
    const lab = (s) => (REQ_STATUS[s] || REQ_STATUS.skip).label;
    secs.push(el('section', { class: 'cmpv__sec' }, Disclosure({ summary: `Qiymətləndirmə tarixçəsi (${carried.length} bənd)`,
      content: el('p', { class: 'fdet__text', text: 'Bölmənin mətni dəyişmədiyi üçün əvvəlki versiyanın statusu saxlanılıb: '
        + carried.map((x) => `${x.req_id} — ${lab(x.status_kept)} (yeni qiymətləndirmə: ${lab(x.status_model).toLocaleLowerCase('az')})`).join('; ') + '.' }) })));
  }
  if (!secs.length) return EmptyState({ icon: 'check', compact: true, title: 'Bu iki versiya arasında dəyişiklik yoxdur' });
  return el('div', { class: 'cmpv__changes' }, el('h2', { class: 'sumv__h', text: 'Nə dəyişdi' }), ...secs);
}
const statusLabel = (s) => ({ ok: 'Uyğun', warn: 'Kiçik fərq', fail: 'Uyğunsuz', skip: 'Yoxlanılmadı' }[s] || s || '—');
const statusOld = (s) => el('del', { class: 'diff__old', text: statusLabel(s) });
function section(title, count, content) {
  return el('section', { class: 'cmpv__sec' }, el('h3', { class: 'cmpv__h' }, title, el('span', { class: 'cmpv__count', text: String(count) })), content);
}
/** Boş yer: doldurulubsa — yeni versiyada həmin bölmənin mətni (sənəd görüntüsü). */
function phRow(p, kind, cur) {
  const filled = kind === 'filled';
  const canOpen = state.check && state.check.id === cur.id;
  const row = el('li', { class: ['diff__row', filled ? 'diff__row--yaxsilasdi' : 'diff__row--pislesdi'] },
    el('span', { class: 'diff__title' }, filled ? el('del', { class: 'diff__old', text: placeholderTitle(p.text) }) : el('span', { text: placeholderTitle(p.text) }),
      el('span', { class: 'diff__sub', text: p.section_title + (p.count > 1 ? ` · ${p.count} yer` : '') })),
    Badge(filled ? 'Doldurulub' : 'Yeni boş yer', { tone: filled ? 'success' : 'warning', size: 'sm' }),
    canOpen ? el('button', { type: 'button', class: 'efc__go', on: { click: () => openSectionInDoc(p.section_title) } }, filled ? 'Yeni mətnə bax' : 'Sənəddə bax', icon('arrowRight', { size: 'sm' })) : null);
  return row;
}
async function openSectionInDoc(title) {
  try {
    const doc = await loadDoc(state.check.id);
    const sec = doc.sections.find((s) => s.title === title);
    openDocAt({ key: 'cmp:' + title, kind: 'quote', section_id: sec ? sec.id : null, quote: null, label: title });
  } catch (_) { /* sənəd mətni saxlanmayıb — keçid yoxdur */ }
}

export { renderComparison };
