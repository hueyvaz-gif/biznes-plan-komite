/* İqtisadi təhlil tabı (Faza 6): risk banneri → 3 göstərici → risk radarı (tornado + "Nə olarsa?" simulyatoru)
 * → ciddiliyə görə qruplaşdırılmış yığcam tapıntılar → reallıq (benchmark).
 * Məlumat 'econ:data' hadisəsindən (views/economics.js yükləyir). Simulyator static/econ-calc.js ilə
 * backend-in EYNİ düsturlarını işlədir (sensitivity.model) — nəticəsi yoxlama statusuna təsir etmir. */
import { api } from '../core/api.js';
import { $ } from '../core/dom.js';
import { state } from '../core/state.js';
import { selectTab } from '../shell/tabs.js';
import { el } from '../ui/el.js';
import { icon } from '../ui/icons.js';
import { Badge, SeverityBadge, Segmented } from '../ui/badge.js';
import { StatTile, EmptyState } from '../ui/card.js';
import { DataTable } from '../ui/table.js';
import { Disclosure, SourceQuote } from '../ui/disclosure.js';
import { toast, tooltip } from '../ui/overlay.js';
import { onFirstVisible, reducedMotion } from '../ui/motion.js';
import { fmtDate, fmtMoney, fmtNumber, fmtPct, fmtYears, moneyLabel, DASH } from '../format.js';
import { evaluate } from '../econ-calc.js';
import { openDocAt } from './docviewer.js';
import { t } from '../i18n/az.js';

const C = () => window.EconCore;
const SEV = { yuksek: 'high', orta: 'medium', asagi: 'low' };
const SEV_LABEL = { yuksek: 'Yüksək', orta: 'Orta', asagi: 'Aşağı' };
const RISK_TONE = { yuksek: 'fail', orta: 'warn', asagi: 'ok' };
const FACTOR = { price: 'satış qiymətinə', raw: 'xammal qiymətinə', capex: 'investisiyanın həcminə', capacity: 'gücdən istifadəyə' };
const kindOf = (id) => (id.startsWith('price') ? 'price' : id.startsWith('raw') ? 'raw' : id.startsWith('capex') ? 'capex' : id.startsWith('capacity') ? 'capacity' : 'delay');
const SHORT = { price: 'Satış qiyməti', raw: 'Xammal qiyməti', capex: 'İnvestisiya (capex)', capacity: 'Gücdən istifadə', delay: 'Gecikmə' };

let data = null;
let notesDismissed = false;
const openCards = new Set();

/* ── Köməkçilər ─────────────────────────────────────────────────────────── */
const mln = (v) => fmtMoney(v, { compact: true });
function thresholdPhrase(s) {
  const th = s.threshold;
  if (!th) return null;
  const k = kindOf(s.id);
  const a = Math.abs(th.value);
  const v = fmtPct(a, { points: true, decimals: a < 1 ? 2 : 1 });
  if (k === 'price') return `satış qiyməti ${v} düşsə`;
  if (k === 'raw') return `xammal ${v} bahalaşsa`;
  if (k === 'capex') return `investisiya ${v} artsa`;
  if (k === 'capacity') return `gücdən istifadə ${fmtNumber(th.value, { maxDecimals: 1 })}%-dən aşağı düşsə`;
  return null;
}
const margin = (th) => (th ? (th.kind === 'change' ? Math.abs(th.value) : 100 - th.value) : Infinity);
/** Sualın özü: tapıntı mətnini təkrarlamamaq üçün sonuncu (sual / tapşırıq) cümləsi. */
function askOf(q) {
  const parts = String(q || '').split(/(?<=[.?!])\s+(?=[A-ZƏÖÜĞIİŞÇ“"])/u).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : q;
}
/** Developer jarqonu istifadəçiyə çıxmasın. */
const humanLabel = (s) => String(s || '').replace(/(^|[\s(:])-(?=\d)/g, '$1−').replace(/\(agentin götürdüyü sütun\)/gi, '(mənbələr cədvəlinin “Cəmi” sütunu)')
  .replace(/\(kodun hesabı\)/gi, '').replace(/agent(in)?/gi, 'model$1').trim();
const docs = () => ((state.meta && state.meta.economics) || {}).documents || {};
const qStatuses = () => ((state.meta && state.meta.economics) || {}).question_statuses || {};
const questionFor = (f) => ((data && data.questions) || []).find((q) => q.finding_id === f.id);

/* ── Giriş ──────────────────────────────────────────────────────────────── */
export function wireEconPanel() {
  document.addEventListener('econ:data', (e) => { data = e.detail; render(); });
  $('econ-notes-close')?.addEventListener('click', () => { notesDismissed = true; $('econ-notes-box').hidden = true; });
}

function render() {
  const d = data;
  renderBanner(d);
  const has = !!(d && d.result);
  renderTiles(d);
  $('econ-radar').hidden = !has || !(d.result.sensitivity && (d.result.sensitivity.scenarios || []).length);
  if (has && !$('econ-radar').hidden) { renderTornado(d); renderSimulator(d); }
  renderFindings(d);
  renderReality(d);
}

/* ── Banner ─────────────────────────────────────────────────────────────── */
function renderBanner(d) {
  const banner = $('econ-banner');
  const run = $('econ-run');
  if (!banner || !run) return;
  run.hidden = !d || d.state === 'yoxdur' || !!state.demo;
  run.disabled = !!(d && d.state === 'isleyir');
  $('econ-run-label').textContent = d && d.result ? 'Yenidən hesabla' : 'İqtisadi təhlili başlat';
  run.title = d && d.result ? 'Qaydalar saxlanmış yerlərlə yenidən hesablanır (model çağırılmır)' : '';
  const fresh = $('econ-fresh');
  fresh.hidden = run.hidden || !(d && d.result);
  fresh.disabled = run.disabled;
  $('econ-state').textContent = C().stateText(d, (iso) => fmtDate(iso));
  const notes = d && d.result && d.result.notes;
  $('econ-notes-box').hidden = !notes || notesDismissed;
  $('econ-notes').textContent = notes ? notes : '';
  if (!d || !d.result) {
    banner.dataset.tone = 'skip';
    $('econ-level').textContent = 'İqtisadi təhlil';
    $('econ-banner-text').textContent = d && d.state === 'isleyir' ? 'Təhlil hesablanır…' : d && d.error ? d.error : 'İqtisadi təhlil hələ aparılmayıb.';
    return;
  }
  const risk = d.result.risk || {};
  banner.dataset.tone = RISK_TONE[risk.level] || 'skip';
  $('econ-level').textContent = `${String(risk.label || risk.level).toLocaleUpperCase('az')} RİSK`;
  $('econ-banner-text').textContent = bannerSentence(d.result);
}
/** "Layihə satış qiymətinə həddən artıq həssasdır. Satış qiyməti 1,0% düşsə və ya xammal 1,3% bahalaşsa, NPV sıfıra enir." */
function bannerSentence(result) {
  const sens = result.sensitivity || {};
  if (sens.base && sens.base.npv <= 0) return 'Baza ssenaridə NPV artıq mənfidir — layihə planın öz rəqəmləri ilə də dəyərini itirir.';
  const rows = (sens.scenarios || []).filter((s) => s.status === 'ok' && s.threshold).sort((a, b) => margin(a.threshold) - margin(b.threshold));
  const critical = rows.filter((s) => s.severity === 'yuksek');
  const pick = (critical.length ? critical : rows.filter((s) => s.negative)).slice(0, 2);
  if (!pick.length) {
    const neg = (sens.scenarios || []).filter((s) => s.negative);
    return neg.length ? `${neg.length} ssenaridə NPV mənfi olur.` : 'Layihə yoxlanılan ssenarilərdə müsbət NPV saxlayır.';
  }
  const head = `Layihə ${FACTOR[kindOf(pick[0].id)]} ${pick[0].severity === 'yuksek' ? 'həddən artıq ' : ''}həssasdır.`;
  const cond = pick.map(thresholdPhrase).filter(Boolean);
  const c = cond.length ? cond[0].charAt(0).toLocaleUpperCase('az') + cond.join(' və ya ').slice(1) : '';
  return `${head} ${c ? c + ', NPV sıfıra enir.' : ''}`.trim();
}

/* ── 3 göstərici ────────────────────────────────────────────────────────── */
function renderTiles(d) {
  const host = $('econ-tiles');
  if (!host) return;
  if (!d || !d.result) { host.replaceChildren(); return; }
  const go = (id) => () => $(id)?.scrollIntoView({ block: 'start', behavior: reducedMotion() ? 'auto' : 'smooth' });
  const target = { 'Daxili uyğunluq': 'econ-find-title', Reallıq: 'econ-reality', Həssaslıq: 'econ-radar' };
  host.replaceChildren(...C().tiles(d.result.counts).map((x) => StatTile({
    label: x.title, value: x.value, unit: x.unit, sub: x.sub, onClick: go(target[x.title] || 'econ-find-title'),
  })));
}

/* ── Tornado ────────────────────────────────────────────────────────────── */
function renderTornado(d) {
  const sens = d.result.sensitivity;
  const base = sens.base ? sens.base.npv : null;
  const rows = (sens.scenarios || []).filter((s) => s.status === 'ok').sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  const card = $('econ-tornado-card');
  if (base == null || !rows.length) { card.replaceChildren(); return; }
  const values = [0, base, ...rows.map((r) => r.npv)];
  let lo = Math.min(...values); let hi = Math.max(...values);
  const pad = (hi - lo) * 0.04; lo -= pad; hi += pad;
  const x = (v) => ((v - lo) / (hi - lo)) * 100;
  const label = `Tornado: baza NPV ${mln(base)}. ` + rows.map((r) => `${SHORT[kindOf(r.id)]}: NPV ${mln(r.npv)}`).join('; ') + '.';
  const list = el('ol', { class: 'tornado2', role: 'list', 'aria-label': label, style: { '--zero': `${x(0)}%`, '--base': `${x(base)}%` } },
    rows.map((r, i) => {
      const a = x(Math.min(base, r.npv)); const b = x(Math.max(base, r.npv));
      const worse = r.npv < base;
      const tip = [`IRR: ${r.irr == null ? DASH : fmtPct(r.irr, { points: true })}`, `ΔNPV: ${fmtMoney(r.delta, { compact: true, signed: true })}`,
        `Sıfır həddi: ${r.threshold ? C().thresholdText(r.threshold) : 'yoxdur'}`].join(' · ');
      const row = el('li', { class: ['tornado2__row', worse ? 'is-worse' : 'is-better', r.negative && 'is-negative'], style: { '--i': String(i) } },
        el('button', { type: 'button', class: 'tornado2__btn', 'aria-label': `${r.title}: NPV ${moneyLabel(r.npv, { compact: true })}. ${tip}. Tapıntını aç.`,
          on: { click: () => openFinding('hessasliq:' + r.id) } },
        el('span', { class: 'tornado2__label', text: r.title }),
        el('span', { class: 'tornado2__track' },
          el('span', { class: 'tornado2__bar', style: { left: `${a}%`, width: `${Math.max(0.6, b - a)}%`, transformOrigin: worse ? 'right' : 'left' } }),
          // Dəyər bar-ın ucunda; bar trekin kənarına çatırsa, yazı bar-ın içinə keçir (adla toqquşmasın).
          el('span', { class: ['tornado2__val', worse && a < 22 && 'is-inside'], style: worse ? (a < 22 ? { left: `${a}%` } : { right: `${100 - a}%` }) : { left: `${b}%` }, text: mln(r.npv) }))));
      tooltip(row.querySelector('.tornado2__btn'), tip);
      return row;
    }));
  // "NPV = 0" yuxarıda, "Baza" aşağıda — bir-birinə yaxın olanda da toqquşmur.
  const axis = el('div', { class: 'tornado2__axis', 'aria-hidden': 'true', style: { '--zero': `${x(0)}%`, '--base': `${x(base)}%` } },
    el('span', { class: 'tornado2__zero', text: 'NPV = 0' }), el('span', { class: 'tornado2__basel', text: `baza ${mln(base)}` }));
  const box = el('div', { class: 'tornado2__wrap' }, axis, list);
  card.replaceChildren(
    el('h3', { class: 'radar__h', text: 'Hər ssenarinin NPV-yə təsiri' }),
    el('p', { class: 'radar__sub', text: 'Mərkəz — baza NPV. Sola — pisləşmə, sağa — yaxşılaşma. Qırmızı punktir — NPV = 0.' }),
    box,
    Disclosure({ summary: t('common.showTable'), content: DataTable({ dense: true, caption: 'Həssaslıq ssenariləri', rows: rows.map((r) => ({ ...r })),
      columns: [{ key: 'title', label: 'Ssenari' }, { key: 'npv', label: 'NPV', type: 'number', signed: true, render: (r) => fmtMoney(r.npv) },
        { key: 'delta', label: 'ΔNPV', type: 'number', render: (r) => fmtMoney(r.delta, { signed: true }) },
        { key: 'irr', label: 'IRR', type: 'number', render: (r) => (r.irr == null ? DASH : fmtPct(r.irr, { points: true })) },
        { key: 'th', label: 'Sıfır həddi', type: 'number', render: (r) => (r.threshold ? C().thresholdText(r.threshold) : DASH) },
        { key: 'sev', label: 'Ciddilik', type: 'status', render: (r) => (r.severity ? SeverityBadge(SEV[r.severity], { size: 'sm' }) : DASH) }] }) }));
  onFirstVisible(box, () => { if (!reducedMotion()) box.classList.add('is-animating'); box.classList.add('is-in'); }, { threshold: 0.3 });
}

/* ── "Nə olarsa?" simulyatoru ───────────────────────────────────────────── */
const SLIDERS = [
  { key: 'price', label: 'Satış qiyməti', min: -30, max: 30, value: 0, safe: 'right', th: 'price_' },
  { key: 'raw', label: 'Xammal qiyməti', min: -30, max: 30, value: 0, safe: 'left', th: 'raw_' },
  { key: 'capex', label: 'İnvestisiya (capex)', min: -30, max: 50, value: 0, safe: 'left', th: 'capex_' },
  { key: 'utilization', label: 'Gücdən istifadə (praktiki gücün %-i)', min: 50, max: 100, value: 100, safe: 'right', th: 'capacity_', level: true },
];
let simState = null;

function renderSimulator(d) {
  const host = $('econ-sim');
  const m = d.result.sensitivity.model;
  if (!m || !m.flows) { host.replaceChildren(EmptyState({ compact: true, icon: 'info', title: 'Simulyator üçün plan rəqəmləri çatmır' })); return; }
  const sig = JSON.stringify([m.flows, m.rate_pct]);
  if (simState && simState.sig === sig) return;                   // eyni model — vəziyyət saxlanılır
  const base = evaluate(m);
  const thresholds = Object.fromEntries((d.result.sensitivity.scenarios || []).map((s) => [kindOf(s.id), s.threshold]));
  const values = Object.fromEntries(SLIDERS.map((s) => [s.key, s.value]));
  values.delay = 0;
  simState = { sig, m, base, values };

  const out = {
    npv: el('output', { class: 'sim__npv', 'aria-live': 'polite' }), delta: el('span', { class: 'sim__delta' }),
    irr: el('span', { class: 'sim__kv' }), pp: el('span', { class: 'sim__kv' }), chart: el('div', { class: 'sim__chart', 'aria-hidden': 'true' }),
  };
  const bars = m.years.map(() => el('span', { class: 'sim__bar' }));
  const extra = [el('span', { class: 'sim__bar' }), el('span', { class: 'sim__bar' })];              // gecikmə üçün (+2 il)
  out.chart.append(...bars, ...extra);

  const params = () => ({
    price: values.price / 100, raw: values.raw / 100, capex: values.capex / 100,
    utilization: values.utilization >= 100 ? null : values.utilization / 100, delay: values.delay,
  });
  let pending = false;
  const sliders = SLIDERS.map((s) => slider(s, thresholds[kindOf(s.th)], values, () => schedule()));
  const delay = Segmented({ label: 'Satışın gecikməsi', size: 'sm', value: '0',
    options: [{ value: '0', label: 'Yoxdur' }, { value: '1', label: '1 il' }, { value: '2', label: '2 il' }],
    onChange: (v) => { values.delay = Number(v); schedule(); } });
  const reset = el('button', { type: 'button', class: 'btn btn--small', on: { click: () => {
    SLIDERS.forEach((s, i) => sliders[i].set(s.value));
    values.delay = 0; delay.setValue('0'); schedule();
  } } }, icon('undo', { size: 'sm' }), t('common.reset'));
  const ask = el('button', { type: 'button', class: 'btn btn--small', on: { click: () => toQuestion() } }, icon('help', { size: 'sm' }), 'Bu ssenarini suala çevir');

  function update() {
    pending = false;
    const r = evaluate(m, params());
    const neg = r.npv < 0;
    out.npv.textContent = fmtMoney(r.npv);
    out.npv.classList.toggle('is-negative', neg);
    out.delta.textContent = `Baza ilə fərq: ${fmtMoney(r.npv - base.npv, { compact: true, signed: true })}`;
    out.irr.textContent = r.irr == null ? DASH : fmtPct(r.irr, { points: true });
    out.pp.textContent = r.payback == null ? 'ödəmir' : fmtYears(r.payback);
    const flows = r.flows;
    const peak = Math.max(1, ...flows.map(Math.abs));
    [...bars, ...extra].forEach((b, i) => {
      const v = flows[i];
      b.hidden = v === undefined;
      if (v === undefined) return;
      b.style.setProperty('--h', `${(Math.abs(v) / peak) * 50}%`);
      b.classList.toggle('is-neg', v < 0);
    });
    sliders.forEach((s) => s.describe(r.npv));
    const changed = Object.entries(params()).some(([k, v]) => (k === 'utilization' ? v !== null : v !== 0));
    ask.disabled = !changed;
    reset.disabled = !changed;
    simState.last = { r, params: params(), changed };
  }
  function schedule() { if (!pending) { pending = true; requestAnimationFrame(update); } }

  async function toQuestion() {
    const { r, params: p } = simState.last;
    const parts = [];
    if (p.price) parts.push(`satış qiyməti ${fmtPct(p.price, { signed: true, decimals: 0 })}`);
    if (p.raw) parts.push(`xammal qiyməti ${fmtPct(p.raw, { signed: true, decimals: 0 })}`);
    if (p.capex) parts.push(`investisiya ${fmtPct(p.capex, { signed: true, decimals: 0 })}`);
    if (p.utilization !== null) parts.push(`gücdən istifadə ${fmtNumber(p.utilization * 100)}%`);
    if (p.delay) parts.push(`satış ${p.delay} il gecikmə ilə`);
    const text = `Birləşmiş ssenari (${parts.join(', ')}) olduqda NPV ${fmtMoney(r.npv)} olur (baza ${fmtMoney(base.npv)}), `
      + `IRR ${r.irr == null ? 'hesablanmır' : fmtPct(r.irr, { points: true })}. Bu risklərin birlikdə baş verməsinə qarşı hansı tədbirlər nəzərdə tutulub?`;
    try {
      await api.post('/api/checks/' + encodeURIComponent(state.check.id) + '/questions', { text, documents: [] });
      toast({ message: 'Ssenari Suallar tabına sual kimi əlavə edildi', tone: 'success',
        action: { label: 'Suallar tabında aç', onClick: () => selectTab('panel-suallar', true) } });
      if (window.Econ) window.Econ.load();
    } catch (err) { toast({ message: err.message || 'Sual əlavə olunmadı', tone: 'danger' }); }
  }

  host.replaceChildren(
    el('div', { class: 'sim__head' }, el('h3', { class: 'radar__h', text: '“Nə olarsa?” simulyatoru' }),
      el('p', { class: 'sim__note' }, icon('info', { size: 'sm' }), el('span', { text: t('sim.note') }))),
    el('div', { class: 'sim__result' },
      el('div', { class: 'sim__main' }, el('span', { class: 'sim__lbl', text: 'NPV' }), out.npv, out.delta),
      el('dl', { class: 'sim__kvs' }, el('dt', { text: 'IRR' }), el('dd', null, out.irr), el('dt', { text: 'Özünü ödəmə' }), el('dd', null, out.pp)),
      out.chart),
    el('div', { class: 'sim__controls' }, ...sliders.map((s) => s.node),
      el('div', { class: 'sim__row' }, el('span', { class: 'sim__label', text: 'Satışın gecikməsi' }), delay)),
    el('div', { class: 'sim__actions' }, reset, ask));
  if (state.demo) ask.hidden = true;
  update();
}

/** Slider: trek-də sıfır həddi markeri (qırmızı çentik, "NPV=0"), bir tərəf yaşıl, digəri qırmızı tonlu. */
function slider(s, threshold, values, onInput) {
  const id = 'sim-' + s.key;
  const input = el('input', { type: 'range', id, class: 'sim__range', min: s.min, max: s.max, step: 1, value: s.value });
  const val = el('output', { class: 'sim__val', for: id });
  const fmtV = (v) => (s.level ? `${v}%` : `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v)}%`);
  const pos = (v) => ((v - s.min) / (s.max - s.min)) * 100;
  const node = el('div', { class: 'sim__row' }, el('label', { class: 'sim__label', for: id, text: s.label }), val);
  const track = el('div', { class: 'sim__track' }, input);
  if (threshold && threshold.value >= s.min && threshold.value <= s.max) {
    const z = pos(threshold.value);
    track.style.setProperty('--z', `${z}%`);
    track.classList.add(s.safe === 'right' ? 'is-safe-right' : 'is-safe-left');
    track.append(el('span', { class: 'sim__zero', style: { left: `${z}%` }, 'aria-hidden': 'true' }, el('span', { text: 'NPV=0' })));
  } else track.classList.add('is-safe-all');
  node.append(track);
  const sync = () => { values[s.key] = Number(input.value); val.textContent = fmtV(values[s.key]); };
  input.addEventListener('input', () => { sync(); onInput(); });
  input.addEventListener('keydown', (e) => {
    if (!e.shiftKey || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
    e.preventDefault();
    const dir = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 1 : -1;
    input.value = String(Math.min(s.max, Math.max(s.min, Number(input.value) + dir * 5)));
    sync(); onInput();
  });
  sync();
  return {
    node,
    set: (v) => { input.value = String(v); sync(); },
    describe: (npv) => input.setAttribute('aria-valuetext', `${fmtV(values[s.key])}, NPV ${moneyLabel(npv, { compact: true })}`),
  };
}

/* ── Tapıntılar ─────────────────────────────────────────────────────────── */
function renderFindings(d) {
  const host = $('econ-findings');
  if (!host) return;
  if (!d || !d.result) {
    host.replaceChildren(EmptyState({ compact: true, icon: 'info', title: d && d.state === 'isleyir' ? 'Təhlil hesablanır…' : 'İqtisadi təhlil aparılmayıb',
      text: 'Təhlil planın öz rəqəmlərini qaydalarla yoxlayır; model yalnız rəqəmlərin sənəddəki yerini tapır.' }));
    return;
  }
  const all = d.result.findings.filter((f) => !f.summary);
  const action = all.filter(C().needsAction);
  const rest = all.filter((f) => !C().needsAction(f) && f.group !== 'realliq');
  const groups = ['yuksek', 'orta', 'asagi'].map((lv) => [lv, action.filter((f) => (f.severity || 'orta') === lv)]).filter(([, l]) => l.length);
  const scen = Object.fromEntries((d.result.sensitivity.scenarios || []).map((s) => [s.id, s]));
  host.replaceChildren(
    ...groups.map(([lv, list]) => group(`${SEV_LABEL[lv]} (${list.length})`, lv, list.map((f) => card(f, scen)), true)),
    rest.length ? group(`Uyğun və məlumat (${rest.length})`, 'ok', rest.map((f) => card(f, scen)), false) : null);
}
/** Ciddilik qrupu: başlıq sticky; uyğun/məlumat qrupu default yığılıdır. */
function group(title, tone, cards, open) {
  if (!open) return el('section', { class: ['efgroup', `efgroup--${tone}`] }, Disclosure({ summary: title, content: el('ol', { class: 'eflist' }, cards) }));
  return el('section', { class: ['efgroup', `efgroup--${tone}`] },
    el('h3', { class: 'efgroup__h' }, el('span', { text: title })), el('ol', { class: 'eflist' }, cards));
}

function card(f, scen) {
  const q = questionFor(f);
  const s = f.scenario ? scen[f.scenario] : null;
  const open = openCards.has(f.id);
  const id = C().domId('ef-', f.id);
  const panelId = id + '-body';
  const badge = f.status === 'flag' || (f.status === 'info' && f.question)
    ? SeverityBadge(SEV[f.severity] || 'medium', { size: 'sm' })
    : Badge({ ok: 'Uyğun', info: 'Məlumat', skip: 'Yoxlanıla bilmədi', na: 'Tətbiq edilmir' }[f.status] || f.status,
      { tone: { ok: 'success', info: 'info', skip: 'neutral', na: 'neutral' }[f.status] || 'neutral', size: 'sm' });
  const title = s ? `${s.title} → NPV ${mln(s.npv)}` : f.title;
  const head = el('button', { type: 'button', class: 'efc__head', 'aria-expanded': String(open), 'aria-controls': panelId },
    badge, el('span', { class: 'efc__title', text: title }),
    s && s.threshold ? el('span', { class: 'efc__meta', text: `sıfır həddi ${C().thresholdText(s.threshold)}` }) : null,
    q ? el('span', { class: `efc__q efc__q--${q.status}`, text: `Sual: ${qStatuses()[q.status] || q.status}` }) : null,
    icon('chevronDown', { size: 'sm' }));
  const inner = el('div', { class: 'efc__inner' });
  inner.inert = !open;
  const li = el('li', { class: ['efc', `efc--${f.severity || f.status}`, open && 'is-open'], id, tabIndex: -1 }, head,
    el('div', { class: 'efc__panel', id: panelId }, inner));
  if (open) inner.append(cardBody(f, q, s));
  head.addEventListener('click', () => {
    const now = !openCards.has(f.id);
    if (now) openCards.add(f.id); else openCards.delete(f.id);
    if (now && !inner.childNodes.length) inner.append(cardBody(f, q, s));
    li.classList.toggle('is-open', now);
    head.setAttribute('aria-expanded', String(now));
    inner.inert = !now;
  });
  li.toggle = () => head.click();
  return li;
}

function cardBody(f, q, s) {
  const left = el('div', { class: 'efc__col' });
  if (f.result) left.append(el('p', { class: 'efc__result', text: humanLabel(f.result).replace(/\s*Model planın öz metoduna uyğundur:.*$/s, '') }));
  if (f.numbers && f.numbers.length) {
    left.append(DataTable({ dense: true, caption: 'Rəqəmlər və mənbələr', rows: f.numbers.map((n, i) => ({ id: i, ...n })),
      columns: [
        { key: 'label', label: 'Göstərici', render: (n) => humanLabel(n.label) },
        { key: 'text', label: 'Dəyər', type: 'number', render: (n) => numberText(n) },
        { key: 'src', label: 'Mənbə', render: (n) => sourceCell(n, f) },
      ] }));
  }
  const right = el('div', { class: 'efc__col efc__col--act' });
  if (f.question) {
    right.append(el('h4', { class: 'fdet__h', text: 'Sual' }), el('p', { class: 'efc__ask', text: askOf(q ? q.text : f.question) }));
    if (q) right.append(el('p', { class: 'efc__qstate' }, Badge(qStatuses()[q.status] || q.status, { tone: q.status === 'aciq' ? 'warning' : q.status === 'qebul' ? 'success' : 'info', size: 'sm' })));
  }
  const mode = C().answerForm(f);
  if (mode === 'sened') {
    right.append(el('h4', { class: 'fdet__h', text: 'Tələb olunan sənədlər' }),
      el('ul', { class: 'efc__docs' }, f.documents.map((dt) => {
        const got = (f.documents_status || {})[dt] || [];
        return el('li', { class: got.length ? 'is-done' : '' }, icon(got.length ? 'check' : 'circle', { size: 'sm' }),
          el('span', { text: docs()[dt] || dt }), got.length ? el('span', { class: 'efc__file', text: got.map((x) => x.file_name).join(', ') }) : Badge('Gözlənilir', { tone: 'neutral', size: 'sm', icon: false }));
      })));
    if (!state.demo && window.Econ) right.append(dropzone(f, q));
  } else if (mode === 'yazili') {
    right.append(el('p', { class: 'efc__written' }, icon('fileText', { size: 'sm' }), C().WRITTEN_ANSWER));
  }
  if (q) right.append(el('button', { type: 'button', class: 'efc__go', on: { click: () => { selectTab('panel-suallar', true); window.Econ?.focusQuestion?.(q.id); } } },
    'Suallar tabında aç', icon('arrowRight', { size: 'sm' })));
  const how = [];
  if (s) how.push(el('p', { class: 'fdet__text', text: s.formula }), el('p', { class: 'fdet__text fdet__muted', text: scenarioAssumption() }));
  else if (f.formula) how.push(el('p', { class: 'fdet__text', text: 'Qayda planın öz rəqəmlərini tutuşdurur; nəticəni AI deyil, kod verir.' }));
  if (f.formula) how.push(el('p', { class: 'fdet__rule', text: f.formula }));
  return el('div', { class: 'efc__body' }, el('div', { class: 'efc__cols' }, left, right.childNodes.length ? right : null),
    how.length ? Disclosure({ summary: t('calc.howComputed'), content: el('div', null, how) }) : null);
}
const scenarioAssumption = () => ((data && data.result && data.result.sensitivity) || {}).assumption || '';

function numberText(n) {
  const neg = typeof n.value === 'number' && n.value < 0;
  const txt = String(n.text || (n.value == null ? DASH : fmtNumber(n.value))).replace(/^-/, '−').replace(/ manat$/, ' ₼');
  return el('span', { class: neg ? 'tone-negative' : '', text: txt });
}
function sourceCell(n, f) {
  const s = n.source || {};
  if (s.kind === 'sened' || s.kind === 'elave') {
    const loc = s.location || '';
    return SourceQuote({ section: s.title || s.file_name || loc || 'Sənəd', quote: s.quote, location: /^T\d+/.test(loc) ? `Cədvəl ${loc}` : s.kind === 'elave' ? 'Əlavə sənəd' : 'Mətndə',
      onOpen: s.kind === 'sened' && s.quote ? () => openDocAt({ key: 'econ:' + f.id + ':' + n.label, kind: 'fin', section_id: /^S\d+/.test(loc) ? loc : null, quote: s.quote, label: humanLabel(n.label) }) : null });
  }
  if (s.kind === 'hesab' || s.kind === 'kod') {
    const node = el('span', { class: 'efc__calc' }, el('span', { class: 'efc__f', text: 'ƒ' }), t('calc.computed'));
    if (s.formula) tooltip(node, s.formula);
    return node;
  }
  if (s.kind === 'benchmark') return el('span', { class: 'efc__src', text: [s.name, s.date].filter(Boolean).join(' · ') || 'Benchmark' });
  return el('span', { class: 'efc__src', text: C().sourceText(s) });
}
function dropzone(f, q) {
  const input = el('input', { type: 'file', class: 'sr-only', tabIndex: -1, accept: '.xlsx,.xlsm,.pdf,.docx,.jpg,.jpeg,.png', 'aria-hidden': 'true' });
  const zone = el('div', { class: 'efc__drop' }, icon('upload', { size: 'sm' }), el('span', { text: 'Faylı bura sürükləyin və ya ' }),
    el('button', { type: 'button', class: 'efc__pick', text: 'seçin', on: { click: () => input.click() } }), input);
  const send = (file) => file && window.Econ.upload(file, { question_id: q && q.id, doc_type: f.documents[0] });
  input.addEventListener('change', () => send(input.files[0]));
  zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('is-over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('is-over'));
  zone.addEventListener('drop', (e) => { e.preventDefault(); zone.classList.remove('is-over'); send(e.dataTransfer.files[0]); });
  return zone;
}

/** Tornado / palette-dən: kartı açır, ora sürüşür, vurğulayır. */
export function openFinding(fid) {
  selectTab('panel-iqtisadi', false);
  const node = document.getElementById(C().domId('ef-', fid));
  if (!node) return;
  const det = node.closest('details');
  if (det) det.open = true;
  const disc = node.closest('.ui-disc');
  if (disc && disc.setOpen) disc.setOpen(true);
  if (!node.classList.contains('is-open')) node.toggle();
  node.scrollIntoView({ block: 'start', behavior: reducedMotion() ? 'auto' : 'smooth' });
  node.focus({ preventScroll: true });
  node.classList.remove('is-flash');
  void node.offsetWidth;
  node.classList.add('is-flash');
}

/* ── Reallıq ────────────────────────────────────────────────────────────── */
function renderReality(d) {
  const sec = $('econ-reality');
  const host = $('econ-reality-body');
  if (!sec) return;
  const list = d && d.result ? d.result.findings.filter((f) => f.group === 'realliq') : [];
  sec.hidden = !list.length;
  if (!list.length) return;
  const planOf = (f) => (f.numbers || []).find((n) => n.label === 'Planda');
  const waiting = list.filter((f) => f.status === 'skip');
  const checked = list.filter((f) => f.status !== 'skip');
  const parts = [];
  if (checked.length) parts.push(el('ul', { class: 'rbars' }, checked.map((f) => rangeRow(f, planOf(f)))));
  if (waiting.length) {
    parts.push(EmptyState({ compact: true, icon: 'search',
      title: 'Bazarla müqayisə tamamlanmayıb',
      text: `${waiting.length} göstərici üçün mənbə və tarix çatışmır.` }),
    el('details', { class: 'task-note' }, el('summary', { text: 'Mənbəsi çatışmayan göstəricilər' }),
    DataTable({ dense: true, caption: 'Mənbəyi gözlənilən göstəricilər', rows: waiting.map((f) => ({ ...f })),
      columns: [{ key: 'title', label: 'Göstərici' },
        { key: 'plan', label: 'Planda', type: 'number', render: (f) => { const p = planOf(f); return p ? numberText(p) : DASH; } },
        { key: 'src', label: 'Mənbə', render: () => el('span', { class: 'efc__src', text: 'Gözlənilir' }) }] })),
    el('p', { class: 'rbars__admin' }, icon('info', { size: 'sm' }), el('span', null, 'Admin üçün: ', el('code', { text: 'config/benchmarks/gubre.yaml' }),
      ' faylında hər göstəricinin min/max, mənbə və tarix sahələrini doldurun.')));
  }
  host.replaceChildren(...parts);
}
/** Range bar: sektor diapazonu boz zolaq, planın dəyəri marker; kənardadırsa qırmızı. */
function rangeRow(f, plan) {
  const bm = f.benchmark || {};
  const lo = typeof bm.min === 'number' ? bm.min : null;
  const hi = typeof bm.max === 'number' ? bm.max : null;
  const v = plan && typeof plan.value === 'number' ? plan.value : null;
  const out = f.status === 'flag';
  const row = el('li', { class: ['rbar', out && 'is-out'] }, el('span', { class: 'rbar__title', text: f.title }));
  if (v != null && (lo != null || hi != null) && (!bm.valyuta || bm.valyuta === 'AZN')) {
    const a = lo ?? v; const b = hi ?? v;
    const min = Math.min(a, v) * 0.85; const max = Math.max(b, v) * 1.15;
    const x = (n) => ((n - min) / (max - min)) * 100;
    const track = el('span', { class: 'rbar__track' },
      el('span', { class: 'rbar__range', style: { left: `${x(a)}%`, width: `${Math.max(1, x(b) - x(a))}%` } }),
      el('span', { class: 'rbar__plan', style: { left: `${x(v)}%` } }));
    tooltip(track, `Sektor: ${f.numbers.find((n) => n.label === 'Benchmark')?.text || ''} · Mənbə: ${bm.menbe || '—'} · ${bm.tarix || ''}`);
    row.append(track);
  }
  row.append(el('span', { class: 'rbar__val' }, plan ? numberText(plan) : DASH), Badge(out ? 'Diapazondan kənar' : 'Diapazonda', { tone: out ? 'danger' : 'success', size: 'sm' }));
  return row;
}
