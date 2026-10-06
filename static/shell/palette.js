/* Command palette (Ctrl/Cmd + K): planlar, versiyalar, tablar, tələblər (TS2…), düzəlişlər,
 * iqtisadi tapıntılar, suallar, boş yerlər. Seçim → müvafiq tab, elementə scroll, 1,5 s vurğu.
 * Klaviatura: ↑ ↓ seçim, Enter keçid, Esc bağla. ARIA: combobox + listbox (aria-activedescendant).
 * Qısayollar: 1–5 əsas tablar, "g n" İcmal, "?" qısayollar paneli. */
import { api } from '../core/api.js';
import { $, planName } from '../core/dom.js';
import { openCheck } from '../core/router.js';
import { state } from '../core/state.js';
import { PRIMARY, debugMode, selectTab } from './tabs.js';
import { el, nextId } from '../ui/el.js';
import { icon } from '../ui/icons.js';
import { reducedMotion } from '../ui/motion.js';
import { revealRequirement } from '../views/requirements.js';
import { focusFix } from '../views/summary-panel.js';
import { openFinding } from '../views/econ-panel.js';
import { fmtRelative } from '../format.js';

let econ = null;                 // son iqtisadi məlumat ('econ:data')
let versions = [];               // cari planın versiyaları (palette açılanda yüklənir)
document.addEventListener('econ:data', (e) => { econ = e.detail; });

const TAB_NAMES = {
  'panel-xulase': 'İcmal', 'panel-duzelis': 'Düzəlişlər', 'panel-maliyye': 'Maliyyə', 'panel-iqtisadi': 'İqtisadi təhlil', 'panel-teleb': 'Standart tələblər',
  'panel-bosyer': 'Boş yerlər', 'panel-suallar': 'Suallar və sənədlər', 'panel-elave': 'Əlavə tələblər',
  'panel-muqayise': 'Müqayisə', 'panel-agentler': 'Texniki jurnal',
};
const GROUPS = { tab: 'Tablar', req: 'Tələblər', fix: 'Düzəlişlər', finding: 'İqtisadi tapıntılar', question: 'Suallar',
  hole: 'Boş yerlər', plan: 'Planlar', version: 'Versiyalar' };
const ICON = { tab: 'arrowRight', req: 'check', fix: 'alert', finding: 'func', question: 'help', hole: 'empty', plan: 'fileText', version: 'file' };

const norm = (s) => String(s || '').toLocaleLowerCase('az').normalize('NFKD').replace(/[̀-ͯ]/g, '');

/** Bütün axtarıla bilən elementlər — hər biri {type, code, title, sub, go}. Yalnız API-dən gələn məlumat. */
function collect() {
  const out = [];
  const inResults = !!state.check && !$('view-results').hidden;
  if (inResults) {
    const tabs = [...PRIMARY, 'panel-teleb', 'panel-bosyer', 'panel-elave', 'panel-muqayise', ...(debugMode() ? ['panel-agentler'] : [])];
    tabs.forEach((id, i) => out.push({ type: 'tab', title: TAB_NAMES[id], code: i < PRIMARY.length ? String(i + 1) : '', go: () => selectTab(id, true) }));
    const r = state.check.result || {};
    for (const it of (r.compliance || {}).items || []) {
      out.push({ type: 'req', code: it.req_id, title: it.text, sub: it.group_title,
        go: () => goRequirement(it.req_id) });
    }
    for (const f of (state.report && state.report.fixes) || []) {
      out.push({ type: 'fix', code: (f.codes || []).map((c) => c.code).join(' '), title: f.topic, sub: 'Nə düzəltmək lazımdır',
        go: () => { focusFix(f.anchor); flash(document.getElementById(f.anchor)); } });
    }
    ((r.ingest || {}).placeholders || []).forEach((p, i) => {
      out.push({ type: 'hole', title: String(p.text || '').replace(/^\[|\]$/g, ''), sub: p.section_title, go: () => goTarget('panel-bosyer', 'ph-' + i) });
    });
    const domId = window.EconCore ? window.EconCore.domId : (pre, id) => pre + id;
    for (const f of (econ && econ.result && econ.result.findings) || []) {
      if (f.summary) continue;
      out.push({ type: 'finding', title: f.title, sub: 'İqtisadi təhlil', go: () => openFinding(f.id) });
    }
    (econ && econ.questions || []).forEach((q, i) => {
      out.push({ type: 'question', code: 'S' + (i + 1), title: q.text, sub: 'Suallar və sənədlər', go: () => goTarget('panel-suallar', domId('q-', q.id)) });
    });
    for (const v of versions) {
      out.push({ type: 'version', code: 'v' + v.version, title: planName(state.check) + ' · v' + v.version, sub: fmtRelative(v.created_at),
        go: () => openCheck(v.id) });
    }
  }
  for (const p of state.plans || []) {
    out.push({ type: 'plan', title: planName(p), sub: p.versions + ' versiya · ' + fmtRelative(p.last_at), go: () => openPlan(p) });
  }
  return out;
}

/** Sıralama: kodun dəqiq / başlanğıc uyğunluğu → başlığın başlanğıcı → hər yerdə. Bütün sözlər tapılmalıdır. */
function search(items, query) {
  const q = norm(query).trim();
  if (!q) return items.filter((i) => ['tab', 'fix', 'plan'].includes(i.type)).slice(0, 30);
  const words = q.split(/\s+/);
  const scored = [];
  for (const it of items) {
    const code = norm(it.code);
    const hay = norm(it.code + ' ' + it.title + ' ' + (it.sub || ''));
    if (!words.every((w) => hay.includes(w))) continue;
    let score = 0;
    if (code && code === q) score += 100;
    else if (code && code.startsWith(q)) score += 60;
    if (norm(it.title).startsWith(q)) score += 30;
    if (it.type === 'tab') score += 5;
    scored.push([score, it]);
  }
  return scored.sort((a, b) => b[0] - a[0]).slice(0, 50).map(([, it]) => it);
}

/* ── Naviqasiya və vurğu ────────────────────────────────────────────────── */
function flash(node) {
  if (!node) return;
  node.scrollIntoView({ block: 'center', behavior: reducedMotion() ? 'auto' : 'smooth' });
  if (node.tabIndex < 0 && !node.matches('a, button, input, select, textarea')) node.tabIndex = -1;
  node.focus({ preventScroll: true });
  node.classList.remove('is-flash');
  void node.offsetWidth;
  node.classList.add('is-flash');
  setTimeout(() => node.classList.remove('is-flash'), 1600);
}
function goTarget(panel, id, before) {
  selectTab(panel, false);
  if (before) before();
  requestAnimationFrame(() => flash(document.getElementById(id)));
}
function goRequirement(code) {
  revealRequirement(code);
}
async function openPlan(plan) {
  try {
    const checks = await api.get('/api/plans/' + encodeURIComponent(plan.plan_id) + '/checks');
    const latest = checks.reduce((a, b) => (!a || b.version > a.version ? b : a), null);
    if (latest) openCheck(latest.id);
  } catch (_) { /* sidebar-dan açıla bilər */ }
}

/* ── Dialoq ─────────────────────────────────────────────────────────────── */
let dlg = null;
function build() {
  const listId = nextId('pal-list');
  const input = el('input', {
    class: 'pal__input', type: 'text', role: 'combobox', 'aria-expanded': 'true', 'aria-controls': listId,
    'aria-autocomplete': 'list', 'aria-label': 'Axtarış: tələb, tapıntı, sual, plan və ya tab', placeholder: 'Axtar: TS2, NPV, sual, plan…',
    autocomplete: 'off', spellcheck: false,
  });
  const list = el('ul', { class: 'pal__list', id: listId, role: 'listbox', 'aria-label': 'Nəticələr' });
  const count = el('p', { class: 'sr-only', 'aria-live': 'polite' });
  const foot = el('p', { class: 'pal__foot' },
    el('span', null, el('kbd', { text: '↑' }), el('kbd', { text: '↓' }), ' seç'),
    el('span', null, el('kbd', { text: 'Enter' }), ' keç'), el('span', null, el('kbd', { text: 'Esc' }), ' bağla'),
    el('span', null, el('kbd', { text: '?' }), ' qısayollar'));
  dlg = el('dialog', { class: 'pal', 'aria-label': 'Sürətli keçid' },
    el('div', { class: 'pal__head' }, icon('search'), input), list, count, foot);
  document.body.append(dlg);

  let items = [];
  let results = [];
  let active = 0;
  const render = () => {
    results = search(items, input.value);
    active = Math.min(active, Math.max(0, results.length - 1));
    const nodes = [];
    let group = null;
    results.forEach((it, i) => {
      if (it.type !== group) {
        group = it.type;
        nodes.push(el('li', { class: 'pal__group', role: 'presentation', text: GROUPS[group] }));
      }
      nodes.push(el('li', {
        class: ['pal__opt', i === active && 'is-active'], role: 'option', id: `${listId}-${i}`, 'aria-selected': String(i === active),
        on: { click: () => choose(i), mousemove: () => { if (active !== i) { active = i; paint(); } } },
      }, icon(ICON[it.type], { size: 'sm' }),
      it.code ? el('span', { class: 'pal__code', text: it.code }) : null,
      el('span', { class: 'pal__title', text: it.title }),
      it.sub ? el('span', { class: 'pal__sub', text: it.sub }) : null));
    });
    if (!results.length) nodes.push(el('li', { class: 'pal__empty', role: 'presentation', text: 'Uyğun nəticə yoxdur' }));
    list.replaceChildren(...nodes);
    count.textContent = results.length ? `${results.length} nəticə` : 'Nəticə yoxdur';
    paint();
  };
  const paint = () => {
    list.querySelectorAll('.pal__opt').forEach((n) => {
      const on = n.id === `${listId}-${active}`;
      n.classList.toggle('is-active', on);
      n.setAttribute('aria-selected', String(on));
      if (on) n.scrollIntoView({ block: 'nearest' });
    });
    if (results.length) input.setAttribute('aria-activedescendant', `${listId}-${active}`); else input.removeAttribute('aria-activedescendant');
  };
  const choose = (i) => {
    const it = results[i];
    if (!it) return;
    close();
    it.go();
  };
  input.addEventListener('input', () => { active = 0; render(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); active = (active + 1) % Math.max(1, results.length); paint(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); active = (active - 1 + results.length) % Math.max(1, results.length); paint(); }
    else if (e.key === 'Enter') { e.preventDefault(); choose(active); }
  });
  dlg.addEventListener('click', (e) => { if (e.target === dlg) close(); });
  dlg.addEventListener('close', () => { input.value = ''; });
  dlg.refresh = () => { items = collect(); active = 0; render(); };
  dlg.input = input;
}
function close() { if (dlg && dlg.open) dlg.close(); }

export async function openPalette() {
  if (!dlg) build();
  if (dlg.open) return;
  dlg.refresh();
  dlg.showModal();
  dlg.input.focus();
  // Cari planın versiyaları (bir dəfə, fonda) — siyahı gələndə yenilənir.
  if (state.check && !versions.some((v) => v.id === state.check.id)) {
    try {
      versions = await api.get('/api/plans/' + encodeURIComponent(state.check.plan_id) + '/checks');
      if (dlg.open) dlg.refresh();
    } catch (_) { versions = []; }
  }
}

/* ── Qısayollar paneli ──────────────────────────────────────────────────── */
let help = null;
const SHORTCUTS = [
  ['Ctrl / ⌘ + K', 'Sürətli keçid: tələb, tapıntı, sual, plan'],
  ['1 – 5', 'Əsas tablar: İcmal, Düzəlişlər, Maliyyə, İqtisadi təhlil, Suallar'],
  ['g, sonra n', 'İcmala qayıt'],
  ['← →', 'Tab zolağında əvvəlki / növbəti tab'],
  ['Esc', 'Paneli və ya pəncərəni bağla'],
  ['?', 'Bu siyahı'],
];
export function openShortcuts() {
  if (!help) {
    help = el('dialog', { class: 'pal pal--help', 'aria-labelledby': 'kbd-title' },
      el('div', { class: 'pal__helphead' }, el('h2', { id: 'kbd-title', text: 'Klaviatura qısayolları' }),
        el('button', { type: 'button', class: 'iconbtn', 'aria-label': 'Bağla', on: { click: () => help.close() } }, icon('x'))),
      el('dl', { class: 'pal__keys' }, SHORTCUTS.map(([k, v]) => [el('dt', null, el('kbd', { text: k })), el('dd', { text: v })])));
    help.addEventListener('click', (e) => { if (e.target === help) help.close(); });
    document.body.append(help);
  }
  if (!help.open) help.showModal();
}

/** Qlobal qısayollar. Yazı sahəsində (input, textarea, select, contenteditable) yalnız Ctrl+K işləyir. */
export function wireShortcuts() {
  let gPending = 0;
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === 'k' || e.key === 'K')) {
      e.preventDefault();
      openPalette();
      return;
    }
    const t = e.target;
    if (e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
    if (t && (t.isContentEditable || t.closest('input, textarea, select, dialog[open]'))) return;
    if (e.key === '?') { e.preventDefault(); openShortcuts(); return; }
    const inResults = state.check && !$('view-results').hidden;
    if (!inResults) return;
    if (/^[1-5]$/.test(e.key)) { e.preventDefault(); selectTab(PRIMARY[Number(e.key) - 1], true); return; }
    if (e.key === 'g') { gPending = Date.now(); return; }
    if (e.key === 'n' && Date.now() - gPending < 1000) { gPending = 0; e.preventDefault(); selectTab('panel-xulase', true); }
  });
  $('palette-btn')?.addEventListener('click', openPalette);
}
