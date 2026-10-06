/* DOM və köhnə formatlama köməkçiləri ($, el, icon, badge, formatAz…). Yeni kod static/ui və static/format.js işlədir. */
import { VERDICT_TONE } from './labels.js';
import { state } from './state.js';

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
/* ── Kiçik köməkçilər ───────────────────────────────────────────────────── */

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}
const ICONS = {
  check: 'M20 6 9 17l-5-5',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3',
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
  dot.title = st.label;                  // rəngin mənası (məs. "Düzəliş lazımdır") — görən istifadəçi üçün
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

export { $, POLL_MS, announce, badge, countUp, el, formatAz, formatDate, formatSize, formatValue, group, icon, planName, reqCounts, reqSummary, revealOnce, setBusy, setHidden, setIcon, setText, statusDot, statusOf, writtenDecimals };
