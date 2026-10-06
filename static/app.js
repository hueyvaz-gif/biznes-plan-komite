/* "Biznes Plan qiymətləndirmə komitəsi" — frontend (vanilla JS).
 *
 * Görünüşlər: yükləmə (A biznes plan + B əlavə tələb sənədləri) → əlavə
 * tələblərin təsdiqi → icra mərhələləri → nəticə (6 tab). Sol naviqasiyada
 * planlar və versiyalar.
 *
 * TƏHLÜKƏSİZLİK: sənəddən və modeldən gələn hər mətn etibarsız girişdir.
 * Səhifəyə YALNIZ textContent / createElement ilə yazılır; innerHTML yoxdur.
 *
 * Polling (static/poll.js), fayl seçimi (static/upload.js) və qrafiklər
 * (static/charts.js) ayrı modullardadır və Node ilə test olunur.
 *
 * Demo rejimi (`?demo=1`): məlumat yalnız /static/demo/demo.json-dan oxunur,
 * heç nə göndərilmir və tarixçəyə yazılmır; hər ekranda "Demo" işarəsi var.
 */
'use strict';

const $ = (id) => document.getElementById(id);
const POLL_MS = 1500;

/** Mətn yazır; element yoxdursa (şablondan silinib) xəbərdarlıq edir, səhifəni çökdürmür. */
function setText(id, value) {
  const node = $(id);
  if (!node) { console.warn('Element tapılmadı: #' + id); return null; }
  node.textContent = value;
  return node;
}

function setHidden(id, hidden) {
  const node = $(id);
  if (!node) { console.warn('Element tapılmadı: #' + id); return null; }
  node.hidden = hidden;
  return node;
}

const STATUS_LABELS = { ok: 'Uyğun', warn: 'Xəbərdarlıq', fail: 'Uyğunsuzluq', skip: 'Yoxlanılmadı' };
const STEP_STATE = { gozleyir: 'Gözləyir', isleyir: 'İşləyir', tamamlandi: 'Tamamlandı', xeta: 'Xəta' };

/* Tələbin statusu: etiket + rəng sinfi (sinif həm də işarə qoyur). */
const REQ_STATUS = {
  var: { label: 'Cavablandırılıb', cls: 's-ok' },
  natamam: { label: 'Natamam', cls: 's-warn' },
  yoxdur: { label: 'Cavabsız', cls: 's-fail' },
  tetbiq_edilmir: { label: 'Tətbiq edilmir', cls: 's-na' },
  sened: { label: 'Ayrıca sənəd', cls: 's-doc' },
  skip: { label: 'Yoxlanılmadı', cls: 's-skip' },
};
const REQ_TECHNICAL = { label: 'Texniki nasazlıq', cls: 's-fail' };
const VERDICT_TONE = { hazir: 'ok', duzelis: 'warn', hazir_deyil: 'fail', giris_xetasi: 'fail' };
const SEVERITY = {
  kritik: { label: 'Kritik', cls: 's-fail' },
  duzelis: { label: 'Düzəliş', cls: 's-warn' },
  melumat: { label: 'Məlumat', cls: 's-doc' },
};
const TREND = {
  yaxsilasdi: { label: 'Yaxşılaşdı', cls: 's-ok' },
  pislesdi: { label: 'Pisləşdi', cls: 's-fail' },
  deyisdi: { label: 'Dəyişdi', cls: 's-skip' },
};

const state = {
  meta: null,
  demo: null,            // demo.json (yalnız ?demo=1)
  file: null,            // A: biznes plan
  extras: [],            // B: əlavə fayllar [{file, error}]
  sending: false,
  check: null,
  runStates: {},         // check_id → son görülən icra vəziyyəti (sol panelin yenilənməsi üçün)
  review: null,          // təsdiq ekranının redaktə vəziyyəti
  finFilter: 'hamisi',
  reqFilter: 'hamisi',
  reqGroup: '',
  reqQuery: '',
  lastFocus: null,

};

/* ── Kiçik köməkçilər ───────────────────────────────────────────────────── */

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

const ICONS = {
  check: 'M20 6 9 17l-5-5',
  x: 'M18 6 6 18M6 6l12 12',
  plus: 'M12 5v14M5 12h14',
  upload: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12',
  menu: 'M3 6h18M3 12h18M3 18h18',
  refresh: 'M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5',
  alert: 'M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
  file: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6',
  trash: 'M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6',
  wifi: 'M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M12 20h.01',
  wifiOff: 'M2 2l20 20M8.5 16a5 5 0 0 1 7 0M12 20h.01M5 12.5a10 10 0 0 1 5-2.6',
  filePlus: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M12 18v-6M9 15h6',
  fileText: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M16 13H8M16 17H8M10 9H8',
  fileUp: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M12 18v-6M9 15l3-3 3 3',
  help: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01',
  info: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 16v-4M12 8h.01',
  sparkle: 'M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9zM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8zM5 2l.6 1.4L7 4l-1.4.6L5 6l-.6-1.4L3 4l1.4-.6z',
  send: 'M22 2 11 13M22 2l-7 20-4-9-9-4z',
  chevronDown: 'M6 9l6 6 6-6',
  chevronUp: 'M18 15l-6-6-6 6',
  minus: 'M5 12h14',
  copy: 'M20 9h-9a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2zM5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1',
  arrowRight: 'M5 12h14M12 5l7 7-7 7',
  layers: 'M12 2 2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5',
  calendar: 'M19 4H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2zM16 2v4M8 2v4M3 10h18',
  printer: 'M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 14h12v8H6z',
  trendUp: 'M23 6l-9.5 9.5-5-5L1 18M17 6h6v6',
  arrowUp: 'M12 19V5M5 12l7-7 7 7',
  chevronRight: 'M9 18l6-6-6-6',
  bookOpen: 'M2 4h7a3 3 0 0 1 3 3v13a2 2 0 0 0-2-2H2zM22 4h-7a3 3 0 0 0-3 3v13a2 2 0 0 1 2-2h8z',
  shield: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
  gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z',
};

/** SVG ikonu `node`-a yerləşdirir (innerHTML olmadan). */
function setIcon(node, name) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', ICONS[name] || '');
  svg.append(path);
  node.replaceChildren(svg);
  return node;
}

function icon(name) { return setIcon(el('span', 'icon'), name); }

/** Planın göstərilən adı (köhnə planlarda açarın özü). */
const planName = (c) => (c && (c.plan_name || c.plan_id)) || '';

/** Tələb sayları — BÜTÜN ekranlarda eyni qayda (static/report.js → reqCounts). */
const reqCounts = Report.reqCounts;

/** "32 cavablandırılıb · 12 natamam · 3 ayrıca sənəd yoxlanılmayıb" — yalnız real saylar. */
function reqSummary(c, opts) {
  const parts = [];
  if (c.answered) parts.push(c.answered + ' cavablandırılıb');
  if (c.partial) parts.push(c.partial + ' natamam');
  if (c.notApplicable) parts.push(c.notApplicable + ' tətbiq edilmir');
  if (c.missing) parts.push(c.missing + ' cavabsız');
  if (c.document) parts.push(c.document + ' ayrıca sənəd yoxlanılmayıb');
  if (c.notChecked) parts.push(c.notChecked + ' yoxlanıla bilmədi');
  if (c.complete) return c.notApplicable ? 'hamısı cavablandırılıb və ya tətbiq edilmir' : 'hamısı cavablandırılıb';
  return parts.join(' · ') + (opts && opts.withTotal ? ' · cəmi ' + c.total : '');
}

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Rəqəm HƏMİŞƏ dərhal dəqiq dəyərlə yazılır. (Əvvəl 0-dan sayılırdı — bu, qısa müddət yanlış
 *  aralıq rəqəmlər göstərirdi: məs. "1,2833 AZN" və ya "36 standart tələb".) */
function countUp(node, value, format) {
  node.textContent = (format || ((v) => formatAz(Math.round(v))))(value);
}

/** Element görünəndə bir dəfə `is-in` sinfi alır (illüstrasiyanın canlanması üçün). */
function revealOnce(node) {
  if (!node) return;
  if (!('IntersectionObserver' in window) || reducedMotion()) { node.classList.add('is-in'); return; }
  const io = new IntersectionObserver((entries) => {
    if (entries.some((e) => e.isIntersecting)) { node.classList.add('is-in'); io.disconnect(); }
  }, { threshold: 0.35 });
  io.observe(node);
}

/** Planın statusu: rəng nöqtəsi + MƏTN (yalnız rənglə bildirilmir). */
function statusOf(item) {
  const run = item.run_state || item.last_run_state;
  const verdict = item.verdict || item.last_verdict;
  const verdicts = (state.meta && state.meta.verdicts) || {};
  if (run && run !== 'tamamlandi') {
    if (run === 'xeta') return { tone: 'fail', label: 'Xəta' };
    if (run === 'tesdiq_gozleyir') return { tone: 'warn', label: 'Təsdiq gözləyir' };
    return { tone: 'run', label: 'İşləyir' };
  }
  return { tone: VERDICT_TONE[verdict] || 'skip', label: item.verdict_label || verdicts[verdict] || 'Tamamlandı' };
}

function statusDot(item) {
  const st = statusOf(item);
  const dot = el('span', 'sdot sdot--' + st.tone);
  dot.setAttribute('aria-hidden', 'true');
  return [dot, el('span', 'sr-only', st.label)];
}

function formatAz(value, decimals) {
  if (value === null || value === undefined || value === '' || Number.isNaN(Number(value))) return '—';
  const d = decimals === undefined || decimals === null ? 0 : decimals;
  const text = Math.abs(Number(value)).toFixed(d).replace(/\B(?=(\d{3})+(?!\d))/g, ' ').replace('.', ',');
  return (Number(value) < 0 ? '−' : '') + text;
}

function formatValue(value, check, decimals) {
  if (value === null || value === undefined) return '—';
  const unit = check.unit || '';
  const d = decimals === undefined || decimals === null ? 2 : decimals;
  if (unit === 'manat' || unit === 'ton') return formatAz(Math.round(value), 0) + ' ' + unit;
  if (unit === '%') return formatAz(value, d) + '%';
  if (unit === 'il') return formatAz(value, d) + ' il';
  return formatAz(value, d);
}

/** Planda yazılan dəqiqlik ("7,0" -> 1): mənbə sitatından (Mərhələ 1). */
const CHECK_FIELD = { irr: 'irr_pct', pp: 'payback_years' };
function writtenDecimals(finance, check) {
  const field = CHECK_FIELD[check.id];
  const source = field && ((finance.claimed || {}).provenance || {})[field];
  return source && source.decimals !== undefined ? source.decimals : undefined;
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return formatAz(bytes / 1024, 1) + ' KB';
  return formatAz(bytes / 1024 / 1024, 1) + ' MB';
}

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function announce(text) { $('live').textContent = text; }

function setBusy(button, busy, busyText) {
  if (!button.dataset.label) button.dataset.label = button.textContent.trim();
  button.disabled = busy;
  button.setAttribute('aria-busy', busy ? 'true' : 'false');
  if (busy && busyText) {
    button.replaceChildren(document.createTextNode(busyText));
  } else if (!busy) {
    button.replaceChildren(document.createTextNode(button.dataset.label));
  }
}

function group(label, node) {
  const box = el('div', 'dgroup');
  box.append(el('p', 'dgroup__label', label), node);
  return box;
}

function badge(cls, label) { return el('span', 'badge ' + cls, label); }

/* ── API (demo rejimində yalnız oxuma) ──────────────────────────────────── */

class ApiError extends Error {}

async function readError(response) {
  try {
    const data = await response.json();
    if (data && typeof data.detail === 'string') return data.detail;
  } catch (_) { /* cavab JSON deyil */ }
  return 'Server xətası (' + response.status + ').';
}

/** Demo məlumatından GET cavabı; tapılmasa 404. */
function demoGet(path) {
  const d = state.demo;
  const m = (re) => path.match(re);
  let r;
  if (path === '/api/meta') return { ...d.meta, dev_mode: false, fail_at_options: [] };
  if (path === '/api/plans') return d.plans;
  if ((r = m(/^\/api\/plans\/(.+)\/checks$/))) return d.plan_checks[decodeURIComponent(r[1])] || [];
  if ((r = m(/^\/api\/checks\/([^/]+)\/events\?after=(\d+)$/))) {
    const all = (d.events || {})[decodeURIComponent(r[1])] || [];
    const after = Number(r[2]);
    const events = all.filter((e) => e.id > after);
    return { events, last_id: events.length ? events[events.length - 1].id : after };
  }
  if ((r = m(/^\/api\/checks\/([^/]+)\/section\?title=(.+)$/))) {
    const text = ((d.sections || {})[decodeURIComponent(r[1])] || {})[decodeURIComponent(r[2])];
    if (text !== undefined) return { section_title: decodeURIComponent(r[2]), text };
  }
  if ((r = m(/^\/api\/checks\/([^/]+)\/requirements$/))) {
    const found = d.requirements[decodeURIComponent(r[1])];
    if (found) return found;
  }
  if ((r = m(/^\/api\/checks\/([^/]+)$/))) {
    const found = d.checks[decodeURIComponent(r[1])];
    if (found) return found;
  }
  return null;
}

const api = {
  async get(path, signal) {
    if (state.demo) {
      const data = demoGet(path);
      if (data === null) { const e = new ApiError('Tapılmadı.'); e.status = 404; throw e; }
      return data;
    }
    const response = await fetch(path, { signal });
    if (!response.ok) { const e = new ApiError(await readError(response)); e.status = response.status; throw e; }
    return response.json();
  },
  async del(path) {
    if (state.demo) throw new ApiError('Demo rejimində heç nə silinmir — bu, yalnız nümunədir.');
    const response = await fetch(path, { method: 'DELETE' });
    if (!response.ok) { const e = new ApiError(await readError(response)); e.status = response.status; throw e; }
    return response.json();
  },
  async post(path, body) {
    if (state.demo) throw new ApiError('Demo rejimində heç nə göndərilmir — bu, yalnız nümunədir.');
    const options = { method: 'POST' };
    if (body instanceof FormData) options.body = body;
    else if (body !== undefined) {
      options.body = JSON.stringify(body);
      options.headers = { 'Content-Type': 'application/json' };
    }
    const response = await fetch(path, options);
    if (!response.ok) { const e = new ApiError(await readError(response)); e.status = response.status; throw e; }
    return response.json();
  },
};

/* ── Görünüşlər və naviqasiya ───────────────────────────────────────────── */

const VIEWS = ['upload', 'review', 'run', 'results'];

function showView(name, title) {
  VIEWS.forEach((v) => { $('view-' + v).hidden = v !== name; });
  $('topbar-title').textContent = title || '';
  $('nav-new').classList.toggle('is-here', name === 'upload');
  if (name === 'upload') { $('nav-new').setAttribute('aria-current', 'page'); renderStepper('stepper-upload', ['current', 'todo', 'todo']); }
  else $('nav-new').removeAttribute('aria-current');
  closeNav();
}

/* ── Mərhələ göstəricisi: Sənəd → Tələblər → Hesabat ───────────────────────
 * Vəziyyət real axından gəlir: əlavə tələb yoxdursa "Tələblər" addımı ötürülür;
 * faiz və ya qalan vaxt göstərilmir. */
const STEPPER = [['Sənəd'], ['Tələblər'], ['Hesabat']];
const STEP_NOTE = { done: 'tamamlanıb', current: 'cari addım', todo: 'gözləyir', skipped: 'əlavə tələb yoxdur', error: 'dayanıb' };

function renderStepper(hostId, states) {
  const host = $(hostId);
  if (!host) return;
  // Poll hər 1,5 s-dən bir render edir — vəziyyət dəyişməyibsə yenidən qurulmur (animasiya təkrarlanmasın).
  const key = states.join();
  if (host.dataset.key === key) return;
  host.dataset.key = key;
  host.replaceChildren(...STEPPER.map(([label], i) => {
    const st = states[i];
    const li = el('li', 'stepper__step is-' + st);
    const mark = el('span', 'stepper__mark');
    if (st === 'done') mark.append(icon('check'));
    else if (st === 'error') mark.append(icon('x'));
    else mark.textContent = String(i + 1);
    mark.setAttribute('aria-hidden', 'true');
    const text = el('span', 'stepper__text');
    text.append(el('span', 'stepper__label', label));
    if (st === 'skipped' || st === 'error') text.append(el('span', 'stepper__note', STEP_NOTE[st]));
    li.append(mark, text, el('span', 'sr-only', ' — ' + STEP_NOTE[st]));
    if (st === 'current') li.setAttribute('aria-current', 'step');
    return li;
  }));
}

/** Yoxlamanın vəziyyətinə görə addımlar (təsdiq / icra ekranları). */
function checkStepper(check) {
  const extras = check && (check.has_extras || (check.result && check.result.extras));
  const second = extras ? 'done' : 'skipped';
  if (!check) return ['done', 'skipped', 'current'];
  if (check.run_state === 'telebler_hazirlanir' || check.run_state === 'tesdiq_gozleyir') return ['done', 'current', 'todo'];
  if (check.run_state === 'xeta') return ['done', second, 'error'];
  if (check.run_state === 'tamamlandi') return ['done', second, 'done'];
  return ['done', second, 'current'];
}

function openNav() {
  $('sidebar').classList.add('is-open');
  $('nav-scrim').hidden = false;
  $('menu-btn').setAttribute('aria-expanded', 'true');
  $('nav-new').focus();
}

function closeNav() {
  if (!$('sidebar').classList.contains('is-open')) return;
  $('sidebar').classList.remove('is-open');
  $('nav-scrim').hidden = true;
  $('menu-btn').setAttribute('aria-expanded', 'false');
}

/* Şəbəkə vəziyyəti: kəsilmə və bərpa görünür. */
let netTimer = null;
function setOnline(online) {
  const box = $('net');
  clearTimeout(netTimer);
  if (!online) {
    box.className = 'net net--off';
    box.replaceChildren(icon('wifiOff'), document.createTextNode(
      'Serverlə əlaqə yoxdur — yenidən qoşulmağa cəhd edilir (icra serverdə davam edir)'));
    box.hidden = false;
    box.dataset.off = '1';
    return;
  }
  if (box.dataset.off) {
    delete box.dataset.off;
    box.className = 'net net--on';
    box.replaceChildren(icon('wifi'), document.createTextNode('Bağlantı bərpa olundu'));
    box.hidden = false;
    netTimer = setTimeout(() => { box.hidden = true; }, 3000);
  }
}

/* ── A: biznes plan faylı ───────────────────────────────────────────────── */

function setFile(file) {
  const limits = state.meta
    ? { maxBytes: state.meta.max_upload_bytes, maxMb: state.meta.max_upload_mb } : undefined;
  const result = selectFile(file, limits);       // etibarsız seçim faylı təmizləyir
  state.file = result.file;
  showUploadError(result.error || '');
  if (!result.file) {
    $('filechip').hidden = true;
    $('file-input').value = '';
    $('dropzone').classList.remove('has-file');
    updateFormState();
    return;
  }
  $('filechip-name').textContent = result.file.name;
  $('filechip-size').textContent = formatSize(result.file.size);
  $('filechip').hidden = false;
  $('dropzone').classList.add('has-file');
  announce('Biznes plan seçildi: ' + result.file.name);
  updateFormState();
}

/** "Davam et" vizual olaraq hazır olanda canlanır (deaktiv edilmir — xəta mətni izah edir). */
/** "Yeni plan yarat" / "Mövcud plana versiya əlavə et" — seçim açıqdır, ad uyğunluğu yalnız təklifdir. */
function planMode() {
  const checked = document.querySelector('input[name="plan-mode"]:checked');
  return checked ? checked.value : 'new';
}

function fillPlanSelect(plans) {
  const select = $('plan-select');
  const keep = select.value;
  const empty = el('option', null, plans.length ? 'Plan seçin…' : 'Hələ plan yoxdur');
  empty.value = '';
  select.replaceChildren(empty, ...plans.map((p) => {
    const o = el('option', null, planName(p) + ' · ' + formatAz(p.versions) + ' versiya · ' + formatDate(p.last_at));
    o.value = p.plan_id;
    return o;
  }));
  if (keep && plans.some((p) => p.plan_id === keep)) select.value = keep;
  $('plan-mode-existing').disabled = plans.length === 0;
}

function setPlanMode(mode, planId) {
  const radio = document.querySelector('input[name="plan-mode"][value="' + mode + '"]');
  if (radio) radio.checked = true;
  $('plan-new-box').hidden = mode !== 'new';
  $('plan-existing-box').hidden = mode !== 'existing';
  if (planId !== undefined) $('plan-select').value = planId;
  if (mode === 'existing') $('plan-suggest').hidden = true;
  updateFormState();
}

/** Ad mövcud planın adı ilə üst-üstə düşürsə — TƏKLİF göstərilir, avtomatik birləşdirmə yoxdur. */
function suggestExistingPlan() {
  const name = $('plan-id').value.trim().toLowerCase();
  const match = name && (state.plans || []).find((p) => planName(p).toLowerCase() === name);
  $('plan-suggest').hidden = !match;
  if (match) {
    $('plan-suggest-text').textContent = '“' + planName(match) + '” adlı plan artıq var (' + formatAz(match.versions)
      + ' versiya). Yeni plan ayrıca yaradılacaq — bu faylın həmin planın versiyası olmasını istəyirsinizsə:';
    $('plan-suggest-btn').onclick = () => { setPlanMode('existing', match.plan_id); $('plan-select').focus(); };
  }
}

function updateFormState() {
  const named = planMode() === 'existing' ? Boolean($('plan-select').value) : $('plan-id').value.trim().length > 0;
  const ready = Boolean(state.file) && named;
  $('submit-btn').classList.toggle('is-ready', ready);
  const extras = state.extras.some((e) => !e.error) || $('extra-text').value.trim().length > 0;
  $('next-step').textContent = 'Növbəti addım: ' + (extras ? 'tələblərin təsdiqi' : 'yoxlama və hesabat');
}

/** Əlavə tələblər akkordeonu; fayl və ya xəta varsa başlıqda xülasə görünür (gizli qalmır). */
function setExtrasOpen(open) {
  $('extra-toggle').setAttribute('aria-expanded', String(open));
  $('extra-body').hidden = !open;
  $('extra-acc').classList.toggle('is-open', open);
}

function updateExtraSummary() {
  const files = state.extras.length;
  const errors = state.extras.filter((e) => e.error).length;
  const text = $('extra-text').value.trim().length;
  const parts = [];
  if (files) parts.push(files + ' fayl');
  if (errors) parts.push(errors + ' xəta');
  if (text) parts.push('mətn');
  $('extra-summary').textContent = parts.join(' · ');
  $('extra-acc').classList.toggle('has-error', errors > 0);
  if (errors) setExtrasOpen(true);
  updateFormState();
}

function showUploadError(message) {
  $('upload-error').textContent = message || '';
  $('upload-error').hidden = !message;
}

function wireDropzone() {
  const zone = $('dropzone');
  const input = $('file-input');
  zone.addEventListener('click', () => input.click());
  zone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); }
  });
  input.addEventListener('change', () => setFile(input.files[0] || null));
  const idleText = $('dropzone-text').textContent;
  ['dragenter', 'dragover'].forEach((n) => zone.addEventListener(n, (e) => {
    e.preventDefault(); zone.classList.add('is-over');
    $('dropzone-text').textContent = 'Buraxın — fayl qəbul ediləcək';
  }));
  ['dragleave', 'drop'].forEach((n) => zone.addEventListener(n, (e) => {
    e.preventDefault(); zone.classList.remove('is-over');
    $('dropzone-text').textContent = idleText;
  }));
  zone.addEventListener('drop', (e) => {
    const file = e.dataTransfer && e.dataTransfer.files ? e.dataTransfer.files[0] : null;
    if (file) setFile(file);
  });
  $('filechip-remove').addEventListener('click', () => { setFile(null); zone.focus(); });
}

/* ── B: əlavə tələb sənədləri ───────────────────────────────────────────── */

function attachmentLimits() {
  return (state.meta && state.meta.attachments)
    || { max_files: 10, max_file_mb: 10, max_total_mb: 30, max_extra_text: 20000,
         formats: ['.docx', '.pdf', '.txt'] };
}

function extraFileError(file) {
  const lim = attachmentLimits();
  const name = file.name.toLowerCase();
  if (!lim.formats.some((f) => name.endsWith(f))) return 'Dəstəklənməyən format — yalnız PDF, DOCX, TXT.';
  if (file.size === 0) return 'Fayl boşdur.';
  if (file.size > lim.max_file_mb * 1024 * 1024) return 'Fayl ' + lim.max_file_mb + ' MB-dan böyükdür.';
  return null;
}

function addExtraFiles(files) {
  const lim = attachmentLimits();
  [...files].forEach((file) => {
    if (state.extras.length >= lim.max_files) {
      showUploadError('Ən çoxu ' + lim.max_files + ' əlavə fayl yükləmək olar.');
      return;
    }
    state.extras.push({ file, error: extraFileError(file) });
  });
  $('extra-input').value = '';
  renderExtraFiles();
}

function renderExtraFiles() {
  const list = $('extra-list');
  list.replaceChildren();
  state.extras.forEach((entry, index) => {
    const li = el('li', 'extrafile ' + (entry.error ? 'extrafile--error' : 'extrafile--ok'));
    li.append(setIcon(el('span', 'icon extrafile__icon'), entry.error ? 'alert' : 'file'));
    li.append(el('span', 'extrafile__name', entry.file.name));
    li.append(el('span', 'extrafile__size num', formatSize(entry.file.size)));
    const remove = el('button', 'iconbtn');
    remove.type = 'button';
    remove.append(icon('trash'), el('span', 'sr-only', entry.file.name + ' faylını sil'));
    remove.addEventListener('click', () => {
      state.extras.splice(index, 1);
      renderExtraFiles();
      $('extra-add').focus();
    });
    li.append(remove);
    li.append(el('span', 'extrafile__status', entry.error
      ? entry.error + ' Bu fayl göndərilməyəcək.'
      : 'Yükləməyə hazırdır — mətni serverdə çıxarılacaq, oxunma statusu təsdiq ekranında görünəcək.'));
    list.append(li);
  });
  const total = state.extras.reduce((s, e) => s + e.file.size, 0);
  const lim = attachmentLimits();
  updateExtraSummary();
  $('extra-limits').textContent = 'Formatlar: mətnli PDF, DOCX, TXT · hər fayl ən çoxu '
    + lim.max_file_mb + ' MB · cəmi ' + lim.max_total_mb + ' MB-a qədər · ən çoxu '
    + lim.max_files + ' fayl. Skan PDF üçün OCR yoxdur.'
    + (state.extras.length ? ' Seçilib: ' + state.extras.length + ' fayl, ' + formatSize(total) + '.' : '');
}

function updateExtraTextHint() {
  const lim = attachmentLimits();
  const length = $('extra-text').value.length;
  $('extra-text-hint').textContent = 'Hər tələbi ayrıca abzasda yazın. '
    + formatAz(length) + ' / ' + formatAz(lim.max_extra_text) + ' simvol.';
  updateExtraSummary();
}

/* ── Göndərmə ───────────────────────────────────────────────────────────── */

async function submitCheck(event) {
  event.preventDefault();
  if (state.sending) return;
  const existing = planMode() === 'existing';
  const planId = existing ? $('plan-select').value : $('plan-id').value.trim();
  if (!planId) {
    if (existing) { showUploadError('Versiya əlavə ediləcək planı seçin.'); $('plan-select').focus(); }
    else { showUploadError('Planın adını yazın.'); $('plan-id').focus(); }
    return;
  }
  if (state.extras.some((e) => e.error)) setExtrasOpen(true);       // xətalı fayl göndərilmir — görünsün
  if (!state.file) { showUploadError('Biznes plan faylını (DOCX) seçin.'); $('dropzone').focus(); return; }

  const lim = attachmentLimits();
  const valid = state.extras.filter((e) => !e.error);
  const total = valid.reduce((s, e) => s + e.file.size, 0);
  if (total > lim.max_total_mb * 1024 * 1024) {
    showUploadError('Əlavə faylların ümumi həcmi ' + lim.max_total_mb + ' MB-dan çoxdur.');
    return;
  }
  const extraText = $('extra-text').value;
  if (extraText.length > lim.max_extra_text) {
    showUploadError('Əlavə tələb mətni ' + lim.max_extra_text + ' simvoldan uzundur.');
    return;
  }

  const body = new FormData();
  body.append('file', state.file);
  if (existing) body.append('existing_plan_id', planId);
  else body.append('plan_name', planId);
  body.append('fail_at', $('fail-at').value || '');
  body.append('extra_text', extraText);
  valid.forEach((e) => body.append('extra_files', e.file));

  state.sending = true;
  setBusy($('submit-btn'), true, 'Göndərilir…');
  showUploadError('');
  announce('Sənəd göndərilir.');
  try {
    const created = await api.post('/api/checks', body);
    state.extras = [];
    $('extra-text').value = '';
    renderExtraFiles();
    openCheck(created.check_id, { fresh: true });
    loadHistory();
  } catch (e) {
    // Uğursuz olsa plan adı və seçilmiş fayllar saxlanılır.
    showUploadError(e instanceof ApiError ? e.message
      : 'Serverlə əlaqə kəsildi. Bağlantını yoxlayıb yenidən cəhd edin.');
  } finally {
    state.sending = false;
    setBusy($('submit-btn'), false);
  }
}

/* ── Polling və marşrutlaşdırma ─────────────────────────────────────────── */

const poller = createPoller({
  intervalMs: POLL_MS,
  fetchCheck: async (checkId, signal) => {
    try {
      return { status: 'ok', check: await api.get('/api/checks/' + encodeURIComponent(checkId), signal) };
    } catch (e) {
      if (e.status === 404) return { status: 'notfound' };
      if (e instanceof ApiError) return { status: 'offline' };
      throw e;
    }
  },
  onOffline: (offline) => setOnline(!offline),
  onNotFound: () => {
    resetToUpload();
    showUploadError('Belə yoxlama tapılmadı.');
  },
  onResult: (check) => {
    render(check);
    // Təsdiq gözləyəndə, bitəndə və ya xətada sorğu dayanır.
    return ['tamamlandi', 'xeta', 'tesdiq_gozleyir'].includes(check.run_state);
  },
});

/**
 * İcra ekranının rejimi:
 *   loading — hesabat serverdən gəlir ("Hesabat açılır…"), mərhələlər GÖSTƏRİLMİR;
 *   running — yoxlama həqiqətən davam edir (mərhələlər, canlı lent);
 *   error   — yoxlama dayanıb (mərhələ və xəta);
 *   ingest  — fayl oxunmadı.
 */
function setRunMode(mode) {
  $('run-loading').hidden = mode !== 'loading';
  $('run-lead').hidden = mode !== 'running';
  $('stepper-run').hidden = mode === 'loading' || mode === 'ingest';
  document.querySelector('#view-run .runlayout').hidden = mode === 'loading' || mode === 'ingest';
  if (mode === 'loading') { $('run-title').textContent = 'Hesabat açılır…'; $('run-plan').textContent = ''; }
}

function openCheck(checkId, opts) {
  closeDetail();
  state.check = null;
  const params = new URLSearchParams(location.search);
  params.set('check', checkId);
  if (!(opts && opts.keepTab)) params.delete('tab');
  history.replaceState(null, '', '?' + params.toString());
  $('run-error').hidden = true;
  $('ingest-error').hidden = true;
  if (opts && opts.fresh) {
    // Yeni göndərilmiş sənəd: yoxlama həqiqətən başlayır.
    showView('run', 'Yoxlama');
    setRunMode('running');
    $('run-title').textContent = 'Yoxlama başladı';
    renderStepper('stepper-run', checkStepper(null));
    renderSteps(null);
  } else {
    showView('run', 'Hesabat açılır…');
    setRunMode('loading');
  }
  poller.open(checkId);
}

function render(check) {
  // Bu yoxlamanın icra vəziyyəti dəyişibsə (məs. işləyir → tamamlandı), sol paneldəki siyahı yenilənir.
  const prev = state.runStates[check.id];
  state.runStates[check.id] = check.run_state;
  if (prev && prev !== check.run_state) loadHistory();
  state.check = check;
  renderNavCurrent(check);
  markCurrentVersion(check);
  const title = planName(check) + ' · v' + check.version;
  AiChat.setContext({ checkId: check.id, planId: planName(check), version: check.version, runState: check.run_state });
  renderStepper('stepper-review', checkStepper(check));
  renderStepper('stepper-run', checkStepper(check));

  if (check.run_state === 'telebler_hazirlanir' || check.run_state === 'tesdiq_gozleyir') {
    showView('review', title + ' · əlavə tələblər');
    renderReview(check);
    return;
  }
  if (check.run_state === 'xeta') {
    showView('run', title);
    setRunMode('error');
    $('run-plan').textContent = title;
    $('run-title').textContent = 'Yoxlama dayandı';
    renderSteps(check);
    $('error-step').textContent = stepLabel(check.current_step);
    $('error-text').textContent = check.error || 'Naməlum xəta.';
    $('run-error').hidden = false;
    refreshFeed(check.id);
    announce('Yoxlama xəta ilə dayandı.');
    return;
  }
  if (check.run_state !== 'tamamlandi') {
    showView('run', title);
    setRunMode('running');
    $('run-plan').textContent = title;
    $('run-title').textContent = 'Yoxlama gedir';
    $('run-error').hidden = true;
    renderSteps(check);
    refreshFeed(check.id);
    return;
  }
  if (check.verdict === 'giris_xetasi') {
    showView('run', title);
    setRunMode('ingest');
    $('run-plan').textContent = title;
    $('run-title').textContent = 'Fayl oxunmadı';
    $('steps').replaceChildren();
    $('ingest-error-text').textContent = check.error || 'Fayl oxunmadı.';
    $('ingest-error').hidden = false;
    announce('Fayl oxunmadı.');
    return;
  }
  showView('results', title);
  renderResults(check);
  announce('Yoxlama tamamlandı: ' + (check.verdict_label || ''));
}

function stepLabel(stepId) {
  const steps = (state.meta && state.meta.steps) || [];
  const found = steps.find((s) => s.id === stepId);
  return found ? found.label : (stepId || '—');
}

/** Addımlar: yalnız serverin current_step-inə görə; faiz/vaxt uydurulmur. */
function renderSteps(check) {
  const host = $('steps');
  host.replaceChildren();
  const steps = (state.meta && state.meta.steps) || [];
  const current = check ? check.current_step : null;
  const runState = check ? check.run_state : 'gozleyir';
  const currentIndex = steps.findIndex((s) => s.id === current);
  steps.forEach((step, index) => {
    let status = 'gozleyir';
    if (runState === 'tamamlandi') status = 'tamamlandi';
    else if (currentIndex >= 0 && index < currentIndex) status = 'tamamlandi';
    else if (index === currentIndex) status = runState === 'xeta' ? 'xeta' : 'isleyir';
    const li = el('li', 'step step--' + status);
    const mark = el('span', 'step__mark');
    if (status === 'tamamlandi') mark.append(icon('check'));
    if (status === 'xeta') mark.append(icon('x'));
    li.append(mark, el('span', 'step__label', step.label), el('span', 'step__state', STEP_STATE[status]));
    if (status === 'isleyir') li.setAttribute('aria-current', 'step');
    host.append(li);
  });
}

/* ── Əlavə tələblərin təsdiqi ───────────────────────────────────────────── */

async function renderReview(check) {
  const preparing = check.run_state === 'telebler_hazirlanir';
  $('review-plan').textContent = planName(check) + ' · v' + check.version;
  $('review-progress').hidden = !preparing;
  $('review-confirm').disabled = preparing;
  if (preparing) {
    $('review-items').replaceChildren();
    $('review-files').replaceChildren();
    return;
  }
  let data;
  try {
    data = await api.get('/api/checks/' + encodeURIComponent(check.id) + '/requirements');
  } catch (e) {
    $('review-error-text').textContent = e.message || 'Tələbləri yükləmək mümkün olmadı.';
    $('review-error').hidden = false;
    return;
  }
  if (!state.check || state.check.id !== check.id) return;     // başqa yoxlamaya keçilib
  const draft = data.draft || { items: [], rejected: [] };
  if (!state.review || state.review.checkId !== check.id) {
    state.review = {
      checkId: check.id,
      items: (draft.items || []).map((i) => ({ ...i })),
    };
  }
  const problem = check.error || draft.error;
  $('review-error').hidden = !problem;
  $('review-error-text').textContent = problem
    ? (draft.error ? 'Model tələbləri çıxara bilmədi: ' + draft.error : problem)
      + ' Tələbləri əl ilə əlavə edə və ya yenidən çıxara bilərsiniz.' : '';

  renderReviewFiles(data.attachments || [], draft.truncated || []);
  renderReviewLimits(draft);
  renderReviewItems();
  renderRejected(draft.rejected || []);
}

/** Natamam çıxarış: bənd limiti və mətn kəsilməsi AYRI göstərilir; təsdiq razılıq tələb edir. */
function renderReviewLimits(draft) {
  const limits = draft.limits || {};
  const box = $('review-limits');
  box.hidden = !limits.incomplete;
  $('review-ack').checked = false;
  updateConfirmState();
  if (!limits.incomplete) return;
  const lines = [];
  if (limits.over_limit) {
    lines.push('Bənd limiti: model ' + limits.received + ' bənd qaytarıb, ' + limits.kept
      + ' bənd saxlanılıb, ' + limits.over_limit + ' bənd limitdən (' + limits.max_items
      + ') kənarda qalıb.');
  } else if (limits.model_at_limit) {
    lines.push('Bənd limiti: model limitə (' + limits.max_items + ') çatıb — sənəddə daha çox tələb ola bilər.');
  }
  if (limits.input_truncated) {
    lines.push('Mətnin kəsilməsi: ' + (limits.truncated_files || []).join(', ') + ' faylının bir hissəsi '
      + 'modelə verilməyib (ən çoxu ' + limits.max_chunks + ' hissə × ' + formatAz(limits.max_prompt_chars)
      + ' simvol). Tam əhatə üçün sənədi kiçik fayllara bölüb ayrı yoxlamalarda yükləyin.');
  }
  $('review-limits-list').replaceChildren(...lines.map((line) => el('li', null, line)));
  const over = draft.over_limit_items || [];
  $('review-overlimit-box').hidden = over.length === 0;
  $('review-overlimit-count').textContent = over.length ? '(' + over.length + ')' : '';
  $('review-overlimit').replaceChildren(...over.map((i) => el('li', null, i.text + (i.ref ? ' — ' + i.ref : ''))));
}

/** Natamam siyahını istifadəçi açıq qəbul etmədən təsdiq düyməsi bağlıdır. */
function updateConfirmState() {
  const blocked = !$('review-limits').hidden && !$('review-ack').checked;
  $('review-confirm').disabled = blocked || !$('review-progress').hidden;
  $('review-confirm').title = blocked ? 'Əvvəl siyahının natamam olduğunu qəbul edin' : '';
}

function renderReviewFiles(files, truncated) {
  const list = $('review-files');
  list.replaceChildren();
  files.forEach((a) => {
    const ok = a.status === 'oxundu';
    const li = el('li', 'extrafile ' + (ok ? 'extrafile--ok' : 'extrafile--error'));
    li.append(setIcon(el('span', 'icon extrafile__icon'), ok ? 'check' : 'alert'));
    li.append(el('span', 'extrafile__name', a.name + ' (' + a.id + ')'));
    li.append(el('span', 'extrafile__size num', formatSize(a.size)));
    li.append(el('span'));
    li.append(el('span', 'extrafile__status', ok
      ? 'Oxundu — ' + formatAz(a.chars) + ' simvol, ' + a.parts + ' hissə'
        + (truncated.includes(a.name) ? '. Diqqət: mətn uzun olduğu üçün modelə qismən verilib.' : '')
      : 'Oxunmadı — ' + a.error));
    list.append(li);
  });
}

function renderReviewItems() {
  const list = $('review-items');
  list.replaceChildren();
  const items = state.review ? state.review.items : [];
  $('review-empty').hidden = items.length > 0;
  $('review-count').textContent = items.length ? '(' + items.length + ')' : '';
  items.forEach((item, index) => list.append(reviewRow(item, index)));
  // Hündürlük yalnız DOM-a əlavə ediləndən sonra ölçülə bilər.
  requestAnimationFrame(() => list.querySelectorAll('textarea').forEach(fitArea));
}

/** Mətn sahəsi məzmuna görə uzanır — uzun tələb kəsilmir, daxili sürüşmə lazım olmur. */
function fitArea(area) {
  area.style.height = 'auto';
  area.style.height = (area.scrollHeight + 2) + 'px';
}

function reviewRow(item, index) {
  const li = el('li', 'reviewitem');
  const head = el('div', 'reviewitem__head');
  head.append(el('span', 'reviewitem__id', item.id || 'yeni'));
  if (item.origin === 'istifadeci' || !item.source_id) head.append(el('span', 'tag', 'Sizin əlavəniz'));
  else head.append(el('span', 'tag tag--req', 'Sənəddən çıxarılıb'));
  li.append(head);

  const fields = el('div', 'reviewitem__fields');
  const textId = 'rv-text-' + index;
  const textBox = el('div', 'field');
  const textLabel = el('label', 'sr-only', 'Tələb mətni');
  textLabel.htmlFor = textId;
  const area = el('textarea', 'input input--area');
  area.id = textId;
  area.rows = 2;
  area.value = item.text || '';
  area.addEventListener('input', () => { item.text = area.value; fitArea(area); });
  textBox.append(textLabel, area);

  const kindId = 'rv-kind-' + index;
  const kindBox = el('div', 'field');
  const kindLabel = el('label', 'sr-only', 'Tələbin növü');
  kindLabel.htmlFor = kindId;
  const select = el('select', 'input');
  select.id = kindId;
  [['plan', 'Planın mətnində yoxlanır'], ['sened', 'Ayrıca sənəd tələb edir']].forEach(([v, l]) => {
    const option = el('option', null, l);
    option.value = v;
    select.append(option);
  });
  select.value = item.kind || 'plan';
  select.addEventListener('change', () => { item.kind = select.value; });
  kindBox.append(kindLabel, select);
  fields.append(textBox, kindBox);
  li.append(fields);

  const remove = el('button', 'btn btn--small btn--danger reviewitem__remove');
  remove.type = 'button';
  remove.append(icon('trash'), document.createTextNode('Sil'));
  remove.addEventListener('click', () => {
    state.review.items.splice(index, 1);
    renderReviewItems();
    $('review-add').focus();
  });
  li.append(remove);

  const source = el('div', 'reviewitem__source');
  if (item.source_id) {
    source.append(el('span', null, 'Mənbə: ' + (item.source_name || item.source_id) + ' · ' + (item.ref || '')));
    source.append(el('blockquote', 'quote', item.fragment || ''));
  } else {
    source.append(el('span', null, 'Mənbə faylı yoxdur — tələbi siz yazmısınız.'));
  }
  li.append(source);
  return li;
}

function renderRejected(rejected) {
  const box = $('review-rejected-box');
  const list = $('review-rejected');
  list.replaceChildren();
  box.hidden = rejected.length === 0;
  $('review-rejected-count').textContent = rejected.length ? '(' + rejected.length + ')' : '';
  rejected.forEach((r) => {
    const li = el('li');
    li.append(el('p', null, r.text || '—'));
    if (r.fragment) li.append(el('blockquote', 'quote', r.fragment));
    li.append(el('p', 'rejected__reason', 'Səbəb: ' + r.reason));
    const add = el('button', 'btn btn--small');
    add.type = 'button';
    add.append(icon('plus'), document.createTextNode('Öz tələbim kimi əlavə et'));
    add.addEventListener('click', () => {
      state.review.items.push({ text: r.text || '', kind: 'plan', origin: 'istifadeci' });
      renderReviewItems();
    });
    li.append(add);
    list.append(li);
  });
}

async function confirmReview() {
  if (!state.check || !state.review) return;
  const items = state.review.items.map((i) => ({ id: i.id, text: (i.text || '').trim(), kind: i.kind || 'plan' }));
  const empty = items.findIndex((i) => !i.text);
  if (empty >= 0) {
    $('review-submit-error').textContent = (empty + 1) + '-ci tələbin mətni boşdur — doldurun və ya silin.';
    $('review-submit-error').hidden = false;
    return;
  }
  $('review-submit-error').hidden = true;
  setBusy($('review-confirm'), true, 'Təsdiqlənir…');
  try {
    await api.post('/api/checks/' + encodeURIComponent(state.check.id) + '/requirements',
      { items, acknowledge_incomplete: $('review-ack').checked });
    state.review = null;
    openCheck(state.check.id);
  } catch (e) {
    $('review-submit-error').textContent = e.message || 'Serverlə əlaqə kəsildi.';
    $('review-submit-error').hidden = false;
  } finally {
    setBusy($('review-confirm'), false);
  }
}

async function reextract() {
  if (!state.check) return;
  setBusy($('review-reextract'), true, 'Göndərilir…');
  try {
    await api.post('/api/checks/' + encodeURIComponent(state.check.id) + '/requirements/extract');
    state.review = null;
    openCheck(state.check.id);
  } catch (e) {
    $('review-error-text').textContent = e.message;
  } finally {
    setBusy($('review-reextract'), false);
  }
}

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

/* ── Tablar (ox düymələri ilə) ──────────────────────────────────────────── */

function tabs() { return [...document.querySelectorAll('#tabs .tab')]; }

function selectTab(panelId, focus) {
  tabs().forEach((tab) => {
    const on = tab.getAttribute('aria-controls') === panelId;
    tab.setAttribute('aria-selected', on ? 'true' : 'false');
    tab.tabIndex = on ? 0 : -1;
    $(tab.getAttribute('aria-controls')).hidden = !on;
    if (on) revealTab(tab);
  });
  layoutTabs();                                      // aktiv tab menyudadırsa — düymədə onun adı
  const active = tabs().find((t) => t.getAttribute('aria-controls') === panelId);
  if (focus && active) {
    if (active.hidden) $('tabs-more').focus(); else active.focus();
  }
  const params = new URLSearchParams(location.search);
  params.set('tab', panelId.replace('panel-', ''));
  history.replaceState(null, '', '?' + params.toString());
}

/** Seçilmiş tabı yalnız tab zolağının İÇİNDƏ üfüqi görünən edir — səhifə şaquli sürüşmür
 *  (əvvəl scrollIntoView mobil ekranı açılışda başlıq və möhürdən aşağı aparırdı). */
function revealTab(tab) {
  const strip = $('tabs');
  const t = tab.getBoundingClientRect();
  const s = strip.getBoundingClientRect();
  if (t.left < s.left) strip.scrollLeft -= s.left - t.left + 16;
  else if (t.right > s.right) strip.scrollLeft += t.right - s.right + 16;
}

function wireTabs() {
  tabs().forEach((tab) => {
    tab.addEventListener('click', () => selectTab(tab.getAttribute('aria-controls'), true));
    tab.addEventListener('keydown', (e) => {
      // Ox düymələri yalnız zolaqda GÖRÜNƏN tablar arasında; qalanları "Daha çox" menyusundadır.
      const all = tabs().filter((t) => !t.hidden);
      const index = all.indexOf(tab);
      let next = null;
      if (e.key === 'ArrowRight') next = all[(index + 1) % all.length];
      if (e.key === 'ArrowLeft') next = all[(index - 1 + all.length) % all.length];
      if (e.key === 'Home') next = all[0];
      if (e.key === 'End') next = all[all.length - 1];
      if (next) { e.preventDefault(); selectTab(next.getAttribute('aria-controls'), true); }
    });
  });
  wireTabsMore();
  if ('ResizeObserver' in window) {
    // Zolağın eni və tabların öz eni (şrift yüklənəndə, nişan dəyişəndə) dəyişəndə yenidən yerləşdirilir.
    let pending = false;
    const ro = new ResizeObserver(() => {
      if (pending) return;
      pending = true;
      requestAnimationFrame(() => { pending = false; layoutTabs(); });
    });
    ro.observe(document.querySelector('.tabsbar'));
  }
  window.addEventListener('resize', () => layoutTabs());
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => layoutTabs());
}

/* ── Tab zolağı: sığmayan tablar "Daha çox" menyusuna (üfüqi scrollbar yoxdur) ── */

/** Menyuya ilk keçən tablar (aşağı prioritet). Nişanında problem sayı olan tab menyuya düşmür. */
const TAB_OVERFLOW_ORDER = ['tab-agentler', 'tab-muqayise', 'tab-elave'];

function tabBadge(tab) {
  const count = tab.querySelector('.tab__count');
  return count && !count.classList.contains('is-zero') && Number(count.textContent) > 0;
}

/**
 * Mərhələlər: (1) hamısı tam adla; (2) qısa adlarla; (3) aşağı prioritetli, nişansız tablar menyuya;
 * (4) dar ekranda yalnız aktiv tab zolaqda, qalanları menyuda. Hər mərhələdə zolağın sığması ölçülür.
 */
function layoutTabs() {
  const strip = $('tabs');
  const wrap = $('tabs-more-wrap');
  if (!strip || !wrap) return;
  const all = tabs();
  const active = all.find((t) => t.getAttribute('aria-selected') === 'true') || all[0];
  const btn = $('tabs-more');
  const fits = () => strip.scrollWidth <= strip.clientWidth + 1;
  let overflow = [];
  // Menyu və düymənin mətni hər yoxlamadan ƏVVƏL yazılır — düymənin eni də ölçüyə daxildir.
  const apply = () => renderTabsMenu(all.filter((t) => overflow.includes(t)), active);
  all.forEach((t) => { t.hidden = false; });
  strip.classList.remove('is-short', 'is-tight');
  btn.classList.remove('is-icon');
  apply();
  const steps = [
    () => strip.classList.add('is-short'),                         // 2) qısa adlar
    () => {                                                          // 3) aşağı prioritetli, nişansız tablar menyuya
      for (const id of TAB_OVERFLOW_ORDER) {
        const t = $(id);
        if (!t || tabBadge(t)) continue;
        t.hidden = true;
        overflow.push(t);
        apply();
        if (fits()) return;
      }
    },
    () => strip.classList.add('is-tight'),                         // 4) sıx tablar
    () => { if (!overflow.includes(active)) btn.classList.add('is-icon'); },   // 5) "Daha çox" — yalnız ikon
    () => {                                                          // 6) dar ekran: zolaqda yalnız aktiv tab
      all.forEach((t) => { t.hidden = t !== active; });
      overflow = all.filter((t) => t !== active);
      btn.classList.remove('is-icon');
    },
  ];
  for (const step of steps) {
    if (fits()) break;
    step();
    apply();
  }
  updateStickyOffsets();
}

function renderTabsMenu(overflow, active) {
  const wrap = $('tabs-more-wrap');
  const menu = $('tabs-menu');
  const label = $('tabs-more-label');
  const btn = $('tabs-more');
  wrap.hidden = overflow.length === 0;
  const activeInMenu = overflow.includes(active);
  // Aktiv tab menyudadırsa — düymədə onun adı.
  // Zolaq qısa adlardadırsa, düymədə də qısa ad ("Əlavə") — en ölçüsünə daxildir.
  const short = $('tabs').classList.contains('is-short') && active.querySelector('.tab__short');
  label.textContent = activeInMenu
    ? (short || active.querySelector('.tab__full') || active).firstChild.textContent.trim() : 'Daha çox';
  btn.classList.toggle('is-current', activeInMenu);
  menu.replaceChildren(...overflow.map((t) => {
    const item = el('button', 'tabsmore__item');
    item.type = 'button';
    item.setAttribute('role', 'menuitemradio');
    item.setAttribute('aria-checked', t === active ? 'true' : 'false');
    item.tabIndex = -1;
    const name = t.querySelector('.tab__full') ? t.querySelector('.tab__full').textContent : t.firstChild.textContent.trim();
    item.append(el('span', null, name));
    const count = t.querySelector('.tab__count');
    if (count && count.textContent) {
      const c = el('span', 'tab__count' + (count.classList.contains('is-zero') ? ' is-zero' : ''), count.textContent);
      c.title = count.title;
      item.append(c);
    }
    item.dataset.panel = t.getAttribute('aria-controls');
    return item;
  }));
}

function setTabsMenu(open, focusFirst) {
  const menu = $('tabs-menu');
  const btn = $('tabs-more');
  menu.hidden = !open;
  btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  if (open && focusFirst) {
    const items = [...menu.querySelectorAll('.tabsmore__item')];
    (items.find((i) => i.getAttribute('aria-checked') === 'true') || items[0])?.focus();
  }
}

function wireTabsMore() {
  const btn = $('tabs-more');
  const menu = $('tabs-menu');
  if (!btn) return;
  btn.addEventListener('click', () => setTabsMenu(menu.hidden, true));
  btn.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setTabsMenu(true, true); }
  });
  menu.addEventListener('click', (e) => {
    const item = e.target.closest('.tabsmore__item');
    if (!item) return;
    setTabsMenu(false);
    selectTab(item.dataset.panel, false);
    btn.focus();
  });
  menu.addEventListener('keydown', (e) => {
    const items = [...menu.querySelectorAll('.tabsmore__item')];
    const i = items.indexOf(document.activeElement);
    let next = null;
    if (e.key === 'ArrowDown') next = items[(i + 1) % items.length];
    if (e.key === 'ArrowUp') next = items[(i - 1 + items.length) % items.length];
    if (e.key === 'Home') next = items[0];
    if (e.key === 'End') next = items[items.length - 1];
    if (next) { e.preventDefault(); next.focus(); }
    if (e.key === 'Escape' || e.key === 'Tab') { setTabsMenu(false); if (e.key === 'Escape') { e.preventDefault(); btn.focus(); } }
  });
  document.addEventListener('click', (e) => {
    if (!menu.hidden && !e.target.closest('#tabs-more-wrap')) setTabsMenu(false);
  });
}

/**
 * Yapışqan zolağın alt sərhədi (`--tabs-h`) və açıq paneldəki yapışqan filtr sətrinin hündürlüyü
 * (`--filters-h`): altdakı yapışqan elementlər və keçidlərin hədəfi (scroll-margin) bunları işlədir.
 */
function updateStickyOffsets() {
  const bar = document.querySelector('.tabsbar');
  if (!bar || bar.offsetParent === null) return;
  const top = parseFloat(getComputedStyle(bar).top) || 0;
  document.documentElement.style.setProperty('--tabs-h', Math.ceil(top + bar.offsetHeight) + 'px');
  const panel = [...document.querySelectorAll('#view-results .panel')].find((p) => !p.hidden);
  const sticky = panel && [...panel.querySelectorAll('.stickyrow')].find((n) => getComputedStyle(n).position === 'sticky');
  document.documentElement.style.setProperty('--filters-h', (sticky ? Math.ceil(sticky.offsetHeight) : 0) + 'px');
}

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

/* ── Standart tələblər ──────────────────────────────────────────────────── */

function reqMeta(item) {
  if (item.status === 'skip' && item.technical) return REQ_TECHNICAL;
  return REQ_STATUS[item.status] || REQ_STATUS.skip;
}

function standardItems() {
  const items = state.check ? (resultParts(state.check).compliance.items || []) : [];
  return items.filter((i) => (i.origin || 'standart') === 'standart');
}

function setRequirementFilter(name) {
  state.reqFilter = name;
  document.querySelectorAll('[data-req]').forEach((chip) => {
    chip.classList.toggle('is-on', chip.dataset.req === name);
    chip.setAttribute('aria-pressed', chip.dataset.req === name ? 'true' : 'false');
  });
  renderRequirements();
}

function requirementMatches(item) {
  const f = state.reqFilter;
  if (f === 'problem' && item.status !== 'natamam' && item.status !== 'yoxdur') return false;
  if (f === 'yoxdur' && item.status !== 'yoxdur') return false;
  if (f === 'skip' && item.status !== 'skip') return false;
  if (f === 'sened' && item.status !== 'sened') return false;
  if (state.reqGroup && item.group_id !== state.reqGroup) return false;
  if (state.reqQuery) {
    const haystack = (item.req_id + ' ' + item.text + ' ' + (item.missing || '')).toLowerCase();
    if (!haystack.includes(state.reqQuery)) return false;
  }
  return true;
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

function renderRequirements() {
  const items = standardItems();
  fillGroupSelect(items);
  const host = $('req-groups');
  host.replaceChildren();
  const visible = items.filter(requirementMatches);
  $('req-empty').hidden = visible.length > 0;
  $('req-empty').textContent = 'Bu süzgəcə uyğun tələb yoxdur.';
  const grouped = new Map();
  visible.forEach((item) => {
    if (!grouped.has(item.group_id)) grouped.set(item.group_id, []);
    grouped.get(item.group_id).push(item);
  });
  grouped.forEach((members) => {
    const box = el('section', 'reqgroup');
    box.id = 'reqgroup-' + members[0].group_id;
    const title = el('h3', 'reqgroup__title', members[0].group_title + ' ');
    title.tabIndex = -1;
    title.append(el('span', 'reqgroup__count', '(' + members.length + ')'));
    const list = el('ul', 'reqlist');
    members.forEach((item) => list.append(requirementRow(item)));
    box.append(title, list);
    host.append(box);
  });
}

function requirementRow(item) {
  const meta = reqMeta(item);
  const row = el('li', 'req');
  row.tabIndex = 0;
  const text = el('span', 'req__text');
  text.append(document.createTextNode(item.text));
  if (item.missing) {
    text.append(el('span', 'req__missing' + (item.status === 'sened' ? ' req__missing--doc' : ''), item.missing));
  }
  const carried = Report.resolveCarried(item).conflict;
  if (carried && !carried.resolved) {
    text.append(el('span', 'req__carried', 'Versiyalar arasında fərqli qiymətləndirmə — sənəddə yoxlayın.'));
  }
  const status = el('span');
  status.append(badge(meta.cls, meta.label));
  row.append(el('span', 'req__id', item.req_id), text, status);
  const open = () => openRequirementDetail(item, row);
  row.addEventListener('click', open);
  row.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
  return row;
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

/* ── Əlavə tələblər ─────────────────────────────────────────────────────── */

function renderExtraResults(p) {
  const items = (p.compliance.items || []).filter((i) => i.origin === 'elave');
  const host = $('extra-results');
  const meta = $('extra-meta');
  host.replaceChildren();
  meta.replaceChildren();
  $('extra-empty').hidden = Boolean(p.extras) || items.length > 0;
  if (p.extras) {
    const files = (p.extras.attachments || []).map((a) => a.name + (a.status === 'oxundu' ? '' : ' (oxunmadı)'));
    meta.append(el('p', 'panel__lead', 'Mənbə sənədlər: ' + (files.join(', ') || '—')
      + ' · təsdiqlənmiş siyahının versiyası ' + (p.extras.list_version || '—')
      + (p.extras.confirmed_at ? ' · təsdiq: ' + formatDate(p.extras.confirmed_at) : '')
      + '. Əlavə tələblər standart siyahını əvəz etmir və yekun statusa daxildir.'));
    if (p.extras.incomplete) {
      meta.append(el('p', 'alert alert--warn', 'Diqqət: tələb çıxarışı natamam idi (bənd limiti və ya '
        + 'mətnin kəsilməsi) və istifadəçi bunu qəbul edərək təsdiqləyib. Bu yoxlama tələb sənədinin '
        + 'bütün bəndlərini əhatə etməyə bilər.'));
    }
  }
  items.forEach((item) => {
    const meta2 = reqMeta(item);
    const li = el('li', 'extraresult');
    const head = el('div', 'extraresult__head');
    const title = el('div');
    title.append(el('span', 'req__id', item.req_id + ' '), el('span', 'extraresult__text', item.text));
    head.append(title, badge(meta2.cls, meta2.label));
    const left = el('div', 'extraresult__col');
    left.append(el('p', 'extraresult__label', 'Tələb sənədində'));
    const src = item.source || {};
    left.append(el('p', 'note', (src.source_name || 'İstifadəçi əlavə edib') + (src.ref ? ' · ' + src.ref : '')));
    if (src.fragment) left.append(el('blockquote', 'quote', src.fragment));
    const right = el('div', 'extraresult__col');
    right.append(el('p', 'extraresult__label', 'Biznes planda'));
    if (item.quote) right.append(el('blockquote', 'quote', item.quote));
    right.append(el('p', 'note', item.missing || (item.quote ? '' : 'Cavab tapılmadı.')));
    li.append(head, left, right);
    li.tabIndex = 0;
    li.addEventListener('click', () => openRequirementDetail(item, li));
    li.addEventListener('keydown', (e) => { if (e.key === 'Enter') openRequirementDetail(item, li); });
    host.append(li);
  });
}

/* ── Boş yerlər ─────────────────────────────────────────────────────────── */

function renderPlaceholders(items) {
  const body = $('ph-body');
  body.replaceChildren();
  $('ph-empty').hidden = items.length > 0;
  $('ph-table').hidden = items.length === 0;
  items.forEach((item, index) => {
    const row = el('tr');
    row.tabIndex = 0;
    const where = el('td');
    where.append(item.where === 'cədvəl' ? badge('s-doc', 'cədvəl ' + (item.table_id || '')) : badge('s-skip', 'paraqraf'));
    row.append(el('td', 'mono', item.text), el('td', null, item.section_title), where, el('td', 'ctx', item.context));
    const open = () => openPlaceholderDetail(item, index, row);
    row.addEventListener('click', open);
    row.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
    body.append(row);
  });
}

function openPlaceholderDetail(item, index, row) {
  openDetail('Doldurulmamış yer', (body) => {
    const head = el('p');
    head.append(badge('s-warn', 'Doldurulmayıb'));
    body.append(head, group('İfadə', el('p', 'mono', item.text)));
    const source = ['Bölmə: ' + item.section_title];
    if (item.table_id) source.push('Cədvəl ' + item.table_id);
    body.append(group('Mənbə', el('p', null, source.join(' · '))));
    body.append(group('Sənəddən', item.evidence ? snippetCard(item.evidence)
      : (item.context ? highlight(item.context, item.text) : el('p', null, '—'))));
    body.append(group('Qeyd', el('p', 'rule', 'Təqdimatdan əvvəl real məlumatla əvəz olunmalıdır. '
      + 'Eyni ifadənin hər təkrarı ayrıca sətirdir (bu, ' + (index + 1) + '-ci tapıntıdır).')));
  }, row);
}

function highlight(text, needle) {
  const box = el('blockquote', 'quote');
  const at = needle ? text.indexOf(needle) : -1;
  if (at < 0) { box.textContent = text; return box; }
  box.append(document.createTextNode(text.slice(0, at)), el('mark', 'hit', needle),
    document.createTextNode(text.slice(at + needle.length)));
  return box;
}

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

/* ── Tarixçə (sol naviqasiya) ───────────────────────────────────────────── */

let historyGeneration = 0;

async function loadHistory() {
  const generation = ++historyGeneration;
  const list = $('history');
  const empty = $('history-empty');
  list.setAttribute('aria-busy', 'true');
  if (!list.children.length) {
    list.replaceChildren(...[0, 1, 2].map(() => {
      const li = el('li', 'skel');
      li.setAttribute('aria-hidden', 'true');
      return li;
    }));
  }
  let plans;
  try {
    plans = await api.get('/api/plans');
  } catch (_) {
    if (generation !== historyGeneration) return;
    list.replaceChildren();
    list.setAttribute('aria-busy', 'false');
    empty.textContent = 'Tarixçəni yükləmək mümkün olmadı.';
    empty.hidden = false;
    return;
  }
  if (generation !== historyGeneration) return;
  list.replaceChildren(...plans.map(planItem));
  list.setAttribute('aria-busy', 'false');
  state.plans = plans;
  fillPlanSelect(plans);
  $('history-count').textContent = plans.length ? String(plans.length) : '';
  $('history-count').title = plans.length ? plans.length + ' plan' : '';
  empty.textContent = 'Hələ heç bir yoxlama aparılmayıb. İlk planınızı yükləyin — burada görünəcək.';
  empty.hidden = plans.length > 0;
  if (state.check) markCurrentVersion(state.check);
}

function runBadge(item) {
  const run = item.run_state || item.last_run_state;
  const verdict = item.verdict || item.last_verdict;
  const verdicts = (state.meta && state.meta.verdicts) || {};
  if (run && run !== 'tamamlandi') {
    if (run === 'xeta') return badge('s-fail', 'Xəta');
    if (run === 'tesdiq_gozleyir') return badge('s-warn', 'Təsdiq gözləyir');
    return badge('s-run', 'İşləyir');
  }
  return badge('s-' + (VERDICT_TONE[verdict] || 'skip'), item.verdict_label || verdicts[verdict] || 'Tamamlandı');
}

function planItem(plan) {
  const item = el('li', 'plan');
  item.dataset.plan = plan.plan_id;
  const head = el('button', 'plan__head');
  head.type = 'button';
  head.setAttribute('aria-expanded', 'false');
  const st = statusOf(plan);
  head.title = planName(plan) + ' — ' + st.label + ' · ' + formatAz(plan.versions) + ' versiya · ' + formatDate(plan.last_at);
  head.append(...statusDot(plan), el('span', 'plan__name', planName(plan)),
    el('span', 'plan__count', 'v' + plan.versions),
    el('span', 'sr-only', ', ' + formatAz(plan.versions) + ' versiya, son: ' + formatDate(plan.last_at)));
  const panel = el('div');
  panel.hidden = true;
  const versions = el('ol', 'versions');
  const newVersion = el('button', 'btn btn--small newversion', 'Yeni versiya yüklə');
  newVersion.type = 'button';
  newVersion.addEventListener('click', () => {
    resetToUpload();
    setPlanMode('existing', plan.plan_id);
    $('dropzone').focus();
  });
  const actions = el('div', 'plan__actions');
  actions.append(newVersion);
  if (!state.demo) {
    const remove = el('button', 'btn btn--small btn--danger plan__delete');
    remove.type = 'button';
    remove.append(icon('trash'), el('span', null, 'Planı sil'));
    remove.setAttribute('aria-label', '“' + planName(plan) + '” planını sil');
    remove.addEventListener('click', () => askDeletePlan(plan, remove));
    actions.append(remove);
  }
  panel.append(versions, actions);
  head.addEventListener('click', () => togglePlan(head, panel, versions, plan.plan_id));
  item.append(head, panel);
  return item;
}

/** "Planı sil": təsdiq pəncərəsi → DELETE /api/plans/{id}. Fokus "Ləğv et"-də başlayır (təhlükəsiz seçim). */
function askDeletePlan(plan, opener) {
  const dialog = $('delete-dialog');
  const confirmBtn = $('delete-confirm');
  $('delete-text').textContent = '“' + planName(plan) + '” — ' + formatAz(plan.versions) + ' versiya, son yoxlama '
    + formatDate(plan.last_at) + '.';
  $('delete-error').hidden = true;
  confirmBtn.disabled = false;
  confirmBtn.textContent = 'Planı sil';
  const close = () => { dialog.close(); if (opener.isConnected) opener.focus(); };
  $('delete-cancel').onclick = close;
  dialog.oncancel = (e) => { e.preventDefault(); close(); };
  confirmBtn.onclick = async () => {
    confirmBtn.disabled = true;
    confirmBtn.textContent = 'Silinir…';
    try {
      await api.del('/api/plans/' + encodeURIComponent(plan.plan_id));
      dialog.close();
      const current = state.check && state.check.plan_id === plan.plan_id;
      if (current) resetToUpload();
      await loadHistory();
      announce('“' + planName(plan) + '” planı silindi.');
      (current ? $('plan-id') : $('nav-new')).focus();
    } catch (err) {
      $('delete-error').textContent = err.message || 'Plan silinmədi.';
      $('delete-error').hidden = false;
      confirmBtn.disabled = false;
      confirmBtn.textContent = 'Planı sil';
    }
  };
  dialog.showModal();
  $('delete-cancel').focus();
}

function togglePlan(head, panel, versions, planId, forceOpen) {
  const open = head.getAttribute('aria-expanded') === 'true';
  if (open && forceOpen) return Promise.resolve();
  head.setAttribute('aria-expanded', open ? 'false' : 'true');
  panel.hidden = open;
  if (!open && !versions.dataset.loaded) return loadVersions(planId, versions);
  return Promise.resolve();
}

async function loadVersions(planId, host) {
  host.replaceChildren(el('li', 'skel'));
  try {
    const checks = await api.get('/api/plans/' + encodeURIComponent(planId) + '/checks');
    host.replaceChildren(...checks.map((c) => {
      const li = el('li');
      const button = el('button', 'version');
      button.type = 'button';
      button.dataset.check = c.id;
      button.title = c.file_name + ' — ' + statusOf(c).label;
      button.append(el('span', 'version__no', 'v' + c.version), el('span', 'version__date', formatDate(c.created_at)),
        ...statusDot(c));
      button.addEventListener('click', () => openCheck(c.id));
      li.append(button);
      return li;
    }));
    host.dataset.loaded = '1';
    if (state.check) markCurrentVersion(state.check);
  } catch (_) {
    host.replaceChildren(el('li', 'note', 'Versiyaları yükləmək mümkün olmadı.'));
  }
}

function markCurrentVersion(check) {
  document.querySelectorAll('.version').forEach((b) => {
    const on = b.dataset.check === check.id;
    b.classList.toggle('is-current', on);
    if (on) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current');
  });
  // Cari plan bir dəfə avtomatik açılır. İşarə DOM elementindədir: tarixçə
  // yenidən qurulanda yeni element yenə açılır, istifadəçi bağlasa isə məcbur açılmır.
  document.querySelectorAll('.plan').forEach((p) => p.classList.toggle('is-current', p.dataset.plan === check.plan_id));
  const item = document.querySelector('.plan[data-plan="' + CSS.escape(check.plan_id) + '"]');
  if (item && !item.dataset.autoOpened) {
    item.dataset.autoOpened = '1';
    const head = item.querySelector('.plan__head');
    const panel = head.nextElementSibling;
    togglePlan(head, panel, panel.querySelector('.versions'), check.plan_id, true);
  }
}

function renderNavCurrent(check) {
  $('nav-current').hidden = false;
  $('nav-current-name').textContent = planName(check);
  $('nav-current-meta').textContent = 'v' + check.version + ' · ' + formatDate(check.created_at);
  $('nav-current-status').replaceChildren(runBadge(check));
}

/* ── Detal paneli (fokus tələsi, arxa fon inert) ────────────────────────── */

function markActiveRow(row) {
  document.querySelectorAll('.is-active').forEach((r) => r.classList.remove('is-active'));
  if (row) row.classList.add('is-active');
}

function openDetail(title, build, row) {
  state.lastFocus = document.activeElement;
  $('detail-title').textContent = title;
  const body = $('detail-body');
  body.replaceChildren();
  build(body);
  $('detail').hidden = false;
  $('detail-scrim').hidden = false;
  document.querySelector('.shell').inert = true;
  $('demo-banner').inert = true;
  markActiveRow(row);
  $('detail-close').focus();
}

function closeDetail() {
  if ($('detail').hidden) return;
  $('detail').hidden = true;
  $('detail-scrim').hidden = true;
  document.querySelector('.shell').inert = false;
  $('demo-banner').inert = false;
  markActiveRow(null);
  if (state.lastFocus && document.contains(state.lastFocus)) state.lastFocus.focus();
  state.lastFocus = null;
}

function trapFocus(e) {
  if ($('detail').hidden || e.key !== 'Tab') return;
  const focusable = [...$('detail').querySelectorAll('button, [href], input, select, textarea, summary, [tabindex]:not([tabindex="-1"])')]
    .filter((n) => !n.disabled && n.offsetParent !== null);
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}

/* ── Davam etdirmə və sıfırlama ─────────────────────────────────────────── */

async function retryCheck() {
  if (!state.check) return;
  setBusy($('retry-btn'), true, 'Davam edilir…');
  try {
    await api.post('/api/checks/' + encodeURIComponent(state.check.id) + '/retry');
    openCheck(state.check.id);
  } catch (e) {
    $('error-text').textContent = e.message || 'Serverlə əlaqə kəsildi.';
  } finally {
    setBusy($('retry-btn'), false);
  }
}

function resetToUpload() {
  poller.stop();
  closeDetail();
  state.check = null;
  state.review = null;
  setFile(null);
  showUploadError('');
  const params = new URLSearchParams(location.search);
  ['check', 'tab', 'review'].forEach((k) => params.delete(k));
  const query = params.toString();
  history.replaceState(null, '', query ? '?' + query : location.pathname);
  $('nav-current').hidden = true;
  setPlanMode('new');
  $('plan-id').value = '';
  $('plan-suggest').hidden = true;
  markCurrentVersion({ id: '', plan_id: '' });
  AiChat.setContext(null);
  showView('upload', 'Yeni yoxlama');
  $('plan-id').focus();
}

/* ── Agentlər: canlı lent və "Agentlər" tabı ────────────────────────────── */

const AG = { checkId: null, list: [], last: 0, loading: null, filter: '', errorsOnly: false };

/** Hadisələri artımlı gətirir (yalnız yeni olanlar); yoxlama dəyişəndə sıfırlanır. */
async function loadEvents(checkId) {
  if (AG.checkId !== checkId) { AG.checkId = checkId; AG.list = []; AG.last = 0; }
  if (AG.loading) return AG.loading;
  AG.loading = (async () => {
    try {
      const data = await api.get('/api/checks/' + encodeURIComponent(checkId) + '/events?after=' + AG.last);
      if (AG.checkId !== checkId) return;                    // başqa yoxlamaya keçilib
      AG.list = AG.list.concat(data.events || []);
      AG.last = data.last_id || AG.last;
    } catch (_) { /* lent köməkçidir — xəta icranı göstərməyə mane olmur */ }
    finally { AG.loading = null; }
  })();
  return AG.loading;
}

function relTime(e, start) {
  return '+' + Math.max(0, e.ts - start).toFixed(1).replace('.', ',') + ' s';
}

function eventBadge(e) {
  if (e.status === 'ok') return badge('s-ok', e.kind === 'result' ? 'hazır' : 'ok');
  if (e.status === 'alət xətası') return badge('s-warn', 'alət xətası');
  return badge('s-fail', 'xəta');
}

/** İcra ekranı: son alət çağırışları və agent nəticələri (yeni olan aşağıda). */
function renderFeed() {
  const list = $('feed');
  const shown = AG.list.filter((e) => e.kind === 'tool' || e.kind === 'result'
    || (e.kind === 'node' && e.status !== 'ok')).slice(-40);
  $('feed-empty').hidden = shown.length > 0;
  if (!shown.length) { list.replaceChildren(); return; }
  const start = Math.min(...AG.list.map((e) => e.ts));
  list.replaceChildren(...shown.map((e) => {
    const li = el('li', 'feed__item feed__item--' + e.kind);
    const head = el('span', 'feed__meta', relTime(e, start) + ' · ' + Agents.agentLabel(e.agent)
      + (e.grp ? ' · ' + Agents.groupTitle(e.grp) : '') + (e.attempt > 1 ? ' · ' + e.attempt + '-ci cəhd' : ''));
    const body = el('span', 'feed__text', Agents.describe(e));
    li.append(head, body, eventBadge(e));
    return li;
  }));
  list.scrollTop = list.scrollHeight;                    // yeni hadisə görünsün
}

async function refreshFeed(checkId) {
  await loadEvents(checkId);
  if (state.check && state.check.id === checkId) renderFeed();
}

/** Nəticə: xülasə, cəhdlər, zaman xətti (hər cəhd ayrıca), süzgəcli cədvəl. */
function renderAgents() {
  const events = AG.list;
  const s = Agents.stats(events);
  $('count-agentler').textContent = s.toolErrors ? String(s.toolErrors) : '';
  const stats = $('ag-stats');
  stats.replaceChildren();
  // Ölçülmüş sıfır ilə OLMAYAN məlumat fərqlidir: jurnal yoxdursa rəqəm göstərilmir.
  stats.hidden = events.length === 0;
  [['Model çağırışları', formatAz(s.llm)], ['Sənəd alətləri çağırışları', formatAz(s.tools)],
   ['Alət xətaları', formatAz(s.toolErrors)], ['İcra müddəti', Agents.seconds(Math.round(s.busySeconds * 1000))]]
    .forEach(([label, value]) => {
      const box = el('div', 'agstat');
      box.append(el('dt', null, label), el('dd', null, value));
      stats.append(box);
    });

  const attempts = Agents.attempts(events);
  $('ag-attempts').replaceChildren(...attempts.map((a) => {
    const li = el('li', 'attempt');
    li.append(el('strong', null, a.attempt + '-ci cəhd'),
      document.createTextNode(' — ' + a.status + (a.failedAt ? ' (' + a.failedAt + ')' : '')
        + ' · ' + Agents.seconds(Math.round((a.end - a.start) * 1000))));
    return li;
  }));
  $('ag-attempts').hidden = attempts.length < 2;

  const host = $('ag-gantts');
  host.replaceChildren(...attempts.map((a) => ganttFor(events, a, attempts.length > 1)));
  if (!attempts.length) host.append(el('p', 'empty', 'Bu hesabat üçün icra məlumatı qeydə alınmayıb '
    + '(köhnə yoxlama və ya demo). Ona görə çağırış sayı və müddət göstərilmir.'));
  $('ag-pick').hidden = true;
  fillAgentFilter(events);
  renderAgentTable();
}

function ganttFor(events, attempt, showTitle) {
  const line = Agents.timeline(events, attempt.attempt);
  const box = el('section', 'gantt');
  const title = el('h3', 'gantt__title', showTitle
    ? attempt.attempt + '-ci cəhd — ' + attempt.status + (attempt.failedAt ? ' (' + attempt.failedAt + ')' : '')
    : 'Zaman xətti');
  title.append(el('span', 'gantt__span', ' · ' + Agents.seconds(Math.round(line.seconds * 1000))));
  box.append(title);
  line.rows.forEach((row) => {
    const resumedFinance = row.empty && attempt.resumed && row.key === 'maliyye';
    if (row.empty && !resumedFinance) return;           // bu cəhddə işləməyən agent göstərilmir
    const r = el('div', 'gantt__row' + (row.level ? ' gantt__row--sub' : ''));
    r.append(el('span', 'gantt__label', row.label));
    if (!row.bars.length && !resumedFinance) {          // qrup başlığı: zolaqlar alt-sətirlərdədir
      r.classList.add('gantt__row--head');
      box.append(r);
      return;
    }
    const track = el('div', 'gantt__track');
    if (row.empty && attempt.resumed && row.key === 'maliyye') {
      track.append(el('span', 'gantt__note', 'bu cəhddə işləmədi — nəticə saxlanmışdı'));
    }
    row.bars.forEach((b) => {
      const e = b.event;
      const bar = el('button', 'gantt__bar gantt__bar--' + e.kind + (e.status !== 'ok' ? ' gantt__bar--bad' : ''));
      bar.type = 'button';
      bar.style.left = (b.left * 100).toFixed(2) + '%';
      bar.style.width = 'max(4px, ' + (b.width * 100).toFixed(2) + '%)';
      const label = Agents.describe(e) + ' · ' + Agents.seconds(e.duration_ms) + ' · ' + e.status;
      bar.title = label;
      bar.setAttribute('aria-label', label);
      bar.addEventListener('click', () => showPick(row, e));
      track.append(bar);
    });
    r.append(track);
    box.append(r);
  });
  const axis = el('div', 'gantt__axis');
  axis.append(el('span', null, '0 s'), el('span', null, Agents.seconds(Math.round(line.seconds * 1000))));
  box.append(axis);
  return box;
}

/** Zolağa klik: həmin sətirdəki alət çağırışları (seçilən vurğulanır). */
function showPick(row, picked) {
  const box = $('ag-pick');
  box.replaceChildren(el('h3', 'gantt__title', row.label + ' — çağırışlar'));
  const list = el('ol', 'pick__list');
  row.bars.forEach(({ event: e }) => {
    const li = el('li', e === picked ? 'is-picked' : null);
    li.append(el('span', 'pick__text', Agents.describe(e)), el('span', 'pick__time', Agents.seconds(e.duration_ms)),
      eventBadge(e));
    list.append(li);
  });
  box.append(list);
  box.hidden = false;
}

function fillAgentFilter(events) {
  const select = $('ag-filter');
  const agents = [...new Set(events.map((e) => e.agent).filter(Boolean))];
  const all = el('option', null, 'Bütün agentlər');
  all.value = '';
  select.replaceChildren(all, ...agents.map((a) => { const o = el('option', null, Agents.agentLabel(a)); o.value = a; return o; }));
  select.value = agents.includes(AG.filter) ? AG.filter : '';
}

function renderAgentTable() {
  const body = $('ag-body');
  const events = AG.list.filter((e) => e.kind !== 'llm' || !AG.errorsOnly)
    .filter((e) => !AG.filter || e.agent === AG.filter)
    .filter((e) => !AG.errorsOnly || e.status !== 'ok');
  const start = AG.list.length ? Math.min(...AG.list.map((e) => e.ts)) : 0;
  body.replaceChildren(...events.map((e) => {
    const tr = el('tr');
    const status = el('td');
    status.append(eventBadge(e));
    tr.append(el('td', 'num', relTime(e, start)),
      el('td', null, Agents.agentLabel(e.agent) + (e.grp ? ' · ' + Agents.groupTitle(e.grp) : '')),
      el('td', 'mono', e.kind === 'tool' ? e.name : (e.kind === 'llm' ? 'LLM' : e.name)),
      el('td', 'ctx', e.args || ''), el('td', null, e.summary || ''),
      el('td', 'num', Agents.seconds(e.duration_ms)), status);
    return tr;
  }));
  $('ag-empty').hidden = events.length > 0;
  $('ag-empty').textContent = 'Bu süzgəcə uyğun hadisə yoxdur.';
}

/* ── Başlanğıc ──────────────────────────────────────────────────────────── */

function applyMeta() {
  const meta = state.meta || {};
  const facts = meta.facts;
  if (facts) {
    $('facts').hidden = false;
    countUp($('fact-req'), facts.requirements);
    $('fact-req-sub').textContent = facts.document_only !== undefined
      ? '(' + facts.in_plan + '-i planın mətnində yoxlanılır, ' + facts.document_only + '-i ayrıca sənəd)' : '';
    countUp($('fact-groups'), facts.groups);
    countUp($('fact-fin'), facts.finance_checks);
  }
  if (meta.max_upload_mb) $('max-mb').textContent = String(meta.max_upload_mb);
  const select = $('fail-at');
  select.replaceChildren();
  (meta.fail_at_options || []).forEach((o) => { const n = el('option', null, o.label); n.value = o.id; select.append(n); });
  $('dev-box').hidden = !(meta.dev_mode && (meta.fail_at_options || []).length);
  renderExtraFiles();
  updateExtraTextHint();
}

async function init() {
  document.querySelectorAll('[data-icon]').forEach((n) => setIcon(n, n.dataset.icon));
  wireDropzone();
  wireTabs();
  revealOnce(document.querySelector('.explain__art'));
  $('upload-form').addEventListener('submit', submitCheck);
  $('extra-add').addEventListener('click', () => $('extra-input').click());
  $('extra-input').addEventListener('change', (e) => addExtraFiles(e.target.files));
  $('extra-text').addEventListener('input', updateExtraTextHint);
  $('plan-id').addEventListener('input', () => { updateFormState(); suggestExistingPlan(); });
  document.querySelectorAll('input[name="plan-mode"]').forEach((r) => r.addEventListener('change', () => setPlanMode(r.value)));
  $('plan-select').addEventListener('change', updateFormState);
  $('extra-toggle').addEventListener('click', () => setExtrasOpen($('extra-toggle').getAttribute('aria-expanded') !== 'true'));
  $('nav-history').addEventListener('click', () => {
    const open = $('nav-history').getAttribute('aria-expanded') !== 'true';
    $('nav-history').setAttribute('aria-expanded', String(open));
    $('history-box').hidden = !open;
  });
  $('nav-help').addEventListener('click', () => { closeNav(); AiChat.open(); });
  $('nav-new').addEventListener('click', resetToUpload);
  $('menu-btn').addEventListener('click', () => ($('sidebar').classList.contains('is-open') ? closeNav() : openNav()));
  $('nav-scrim').addEventListener('click', closeNav);
  $('error-new').addEventListener('click', resetToUpload);
  $('ingest-new').addEventListener('click', resetToUpload);
  $('review-cancel').addEventListener('click', resetToUpload);
  $('retry-btn').addEventListener('click', retryCheck);
  $('retry-groups-btn').addEventListener('click', retryFailedGroups);
  $('review-add').addEventListener('click', () => {
    if (!state.review) return;
    state.review.items.push({ text: '', kind: 'plan', origin: 'istifadeci' });
    renderReviewItems();
    const areas = $('review-items').querySelectorAll('textarea');
    if (areas.length) areas[areas.length - 1].focus();
  });
  $('review-confirm').addEventListener('click', confirmReview);
  $('review-reextract').addEventListener('click', reextract);
  $('review-ack').addEventListener('change', updateConfirmState);
  $('print-btn').addEventListener('click', () => { prepareForPrint(); window.print(); });
  $('res-newversion').addEventListener('click', () => {
    if (!state.check) return;
    const planId = state.check.plan_id;
    resetToUpload();
    setPlanMode('existing', planId);
    $('dropzone').focus();
  });
  window.addEventListener('beforeprint', prepareForPrint);        // Ctrl+P ilə də
  window.addEventListener('afterprint', () => setFixesOpen(false));  // çapdan sonra yenə ilk 6 bənd
  window.addEventListener('resize', () => $('review-items').querySelectorAll('textarea').forEach(fitArea));
  $('fixes-toggle').addEventListener('click', () => {
    setFixesOpen($('fixes-toggle').getAttribute('aria-expanded') !== 'true');
  });
  $('sum-retry').addEventListener('click', () => $('retry-groups-btn').click());
  $('about-link').addEventListener('click', (e) => {
    e.preventDefault();
    $('about').scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    $('about').focus({ preventScroll: true });
  });
  document.querySelectorAll('.golink').forEach((b) => b.addEventListener('click', () => selectTab(b.dataset.goto, true)));
  $('ag-filter').addEventListener('change', (e) => { AG.filter = e.target.value; renderAgentTable(); });
  $('ag-errors').addEventListener('change', (e) => { AG.errorsOnly = e.target.checked; renderAgentTable(); });
  $('detail-close').addEventListener('click', closeDetail);
  $('detail-scrim').addEventListener('click', closeDetail);
  document.addEventListener('keydown', (e) => {
    trapFocus(e);
    if (e.key === 'Escape') { closeDetail(); closeNav(); }
  });
  document.querySelectorAll('[data-fin]').forEach((c) => c.addEventListener('click', () => setFinanceFilter(c.dataset.fin)));
  document.querySelectorAll('[data-req]').forEach((c) => c.addEventListener('click', () => setRequirementFilter(c.dataset.req)));
  $('req-group').addEventListener('change', (e) => { state.reqGroup = e.target.value; renderRequirements(); });
  $('req-search').addEventListener('input', (e) => { state.reqQuery = e.target.value.trim().toLowerCase(); renderRequirements(); });
  window.addEventListener('offline', () => setOnline(false));
  window.addEventListener('online', () => setOnline(true));

  const params = new URLSearchParams(location.search);
  if (params.get('demo') === '1') {
    try {
      const response = await fetch('/static/demo/demo.json');
      state.demo = await response.json();
      $('demo-banner').hidden = false;
      $('submit-btn').title = 'Demo rejimində göndərilmir';
    } catch (_) {
      showUploadError('Demo məlumatı tapılmadı: python scripts/make_demo.py işlədin.');
    }
  }
  try { state.meta = await api.get('/api/meta'); } catch (_) { /* meta olmasa da işləyir */ }
  applyMeta();
  // Bazar icmalı və AI köməkçi müstəqildir: xətaları sənəd yoxlamasını dayandırmır.
  const deps = { el, $, setIcon, icon, announce, demo: () => Boolean(state.demo),
    get: (path) => api.get(path) };
  Market.init(deps);
  AiChat.init(deps);

  loadHistory();
  const checkId = params.get('check');
  if (checkId && state.demo && params.get('review') === '1') {
    showReviewDemo(checkId);
  } else if (checkId) {
    openCheck(checkId, { keepTab: true });
  } else {
    showView('upload', 'Yeni yoxlama');
  }
}

/** Demo: əlavə tələbli yoxlamanın təsdiq ekranı (qaralama ilə, göndərilmir). */
function showReviewDemo(checkId) {
  const check = state.demo.checks[checkId];
  if (!check) { showView('upload', 'Yeni yoxlama'); return; }
  const pending = { ...check, run_state: 'tesdiq_gozleyir', error: null };
  state.check = pending;
  renderNavCurrent(pending);
  showView('review', planName(check) + ' · v' + check.version + ' · əlavə tələblər');
  renderReview(pending);
}

init();
