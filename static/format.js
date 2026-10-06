/* Rəqəm və tarix formatı — tətbiqdə bütün formatlama BURADAN keçir (ES module).
 *
 * Qərarlar:
 *   • Valyuta işarəsi hər yerdə "₼" (kompakt, dar sütunlara sığır). Ekran oxuyucu üçün moneyLabel() "manat" yazır.
 *   • Intl.NumberFormat('az-AZ') əsasdır; onun mərtəbə ayırıcısı (".") bölünməz boşluqla əvəz olunur —
 *     "1 944 881" komitə sənədlərindəki yazılışdır və onluq vergüllə qarışmır.
 *   • Mənfi işarə həmişə U+2212 "−" (defis yox). signed:true → "+1,2 mln ₼".
 *   • Boş dəyər (null / undefined / '' / NaN) → "—".
 */

export const MINUS = '−';
export const NBSP = ' ';
export const DASH = '—';
const CURRENCY = '₼';

const cache = new Map();
function nf(min, max) {
  const key = min + ':' + max;
  if (!cache.has(key)) {
    cache.set(key, new Intl.NumberFormat('az-AZ', { minimumFractionDigits: min, maximumFractionDigits: max }));
  }
  return cache.get(key);
}

/** Dəyər rəqəmdirmi (boş, null, NaN deyil). */
export function isNum(v) {
  return v !== null && v !== undefined && v !== '' && !Number.isNaN(Number(v)) && Number.isFinite(Number(v));
}

/** Mütləq dəyəri formatlayır: mərtəbələr NBSP ilə, onluq vergül. */
function abs(v, min, max) {
  return nf(min, max).formatToParts(Math.abs(v))
    .map((p) => (p.type === 'group' ? NBSP : p.value)).join('');
}

/** İşarə: mənfi → "−"; signed → "+" (sıfır işarəsiz). Yuvarlaqlaşdırılmış sıfır işarə almır. */
function sign(v, text, signed) {
  if (!/[1-9]/.test(text)) return '';
  if (v < 0) return MINUS;
  return signed && v > 0 ? '+' : '';
}

/**
 * Ümumi rəqəm. fmtNumber(1944881) → "1 944 881"; fmtNumber(-0.5, {decimals: 1}) → "−0,5".
 * decimals — dəqiq onluq sayı; maxDecimals — "ən çoxu" (sonda sıfır yazılmır).
 */
export function fmtNumber(v, { decimals, maxDecimals, signed = false } = {}) {
  if (!isNum(v)) return DASH;
  const n = Number(v);
  const min = decimals ?? 0;
  const max = decimals ?? maxDecimals ?? 0;
  const text = abs(n, min, max);
  return sign(n, text, signed) + text;
}

/**
 * Pul: fmtMoney(1944881) → "1 944 881 ₼"; {compact: true} → "1,94 mln ₼"; {signed: true} → "+1 944 881 ₼".
 * Kompakt forma |v| ≥ 1 mln olanda işləyir (mln / mlrd, 1–2 onluq); kiçik məbləğ tam yazılır.
 */
export function fmtMoney(v, { compact = false, signed = false, decimals, currency = true } = {}) {
  if (!isNum(v)) return DASH;
  const n = Number(v);
  const tail = currency ? NBSP + CURRENCY : '';
  if (compact && Math.abs(n) >= 1e6) {
    const [div, unit] = Math.abs(n) >= 1e9 ? [1e9, 'mlrd'] : [1e6, 'mln'];
    // 1–2 onluq: "1,94 mln", "−18,9 mln", "2,0 mln"; decimals verilsə dəqiq o qədər.
    const text = decimals === undefined ? abs(n / div, 1, 2) : abs(n / div, decimals, decimals);
    return sign(n, text, signed) + text + NBSP + unit + tail;
  }
  return fmtNumber(n, { decimals: decimals ?? 0, signed }) + tail;
}

/** Ekran oxuyucu üçün: "1 944 881 manat" / "mənfi 1,94 mln manat". */
export function moneyLabel(v, opts = {}) {
  const text = fmtMoney(v, { ...opts, currency: false });
  if (text === DASH) return 'məlumat yoxdur';
  return text.replace(MINUS, 'mənfi ').replace(/^\+/, 'artı ') + ' manat';
}

/**
 * Faiz. Giriş PAY kimidir: fmtPct(0.1178) → "11,8%". Dəyər artıq faizdirsə {points: true}: fmtPct(11.78, {points: true}).
 * signed:true → "+2,5%"; decimals default 1.
 */
export function fmtPct(v, { decimals = 1, signed = false, points = false } = {}) {
  if (!isNum(v)) return DASH;
  const n = points ? Number(v) : Number(v) * 100;
  return fmtNumber(n, { decimals, signed }) + '%';
}

/** İl: fmtYears(7.44) → "7,4 il". */
export function fmtYears(v, { decimals = 1 } = {}) {
  if (!isNum(v)) return DASH;
  return fmtNumber(v, { decimals }) + NBSP + 'il';
}

/**
 * İki dəyərin fərqi: {abs, pct, tone}.
 *   abs  — b − a (rəqəm), pct — nisbi dəyişmə (pay; a = 0 olanda null),
 *   tone — 'positive' | 'negative' | 'neutral' (higherIsBetter=false olanda azalma müsbətdir; |fərq| ≤ epsilon → neutral).
 */
export function fmtDelta(a, b, { higherIsBetter = true, epsilon = 0 } = {}) {
  if (!isNum(a) || !isNum(b)) return { abs: null, pct: null, tone: 'neutral' };
  const d = Number(b) - Number(a);
  const pct = Number(a) === 0 ? null : d / Math.abs(Number(a));
  let tone = 'neutral';
  if (Math.abs(d) > epsilon) tone = (d > 0) === higherIsBetter ? 'positive' : 'negative';
  return { abs: d, pct, tone };
}

/** Rəqəm işarəsinə görə ton (mənfi rəqəmləri rəngləmək üçün). */
export function toneOf(v) {
  if (!isNum(v) || Number(v) === 0) return 'neutral';
  return Number(v) > 0 ? 'positive' : 'negative';
}

/** Fayl ölçüsü: "812 B", "1,2 KB", "3,4 MB". */
export function fmtSize(bytes) {
  if (!isNum(bytes)) return DASH;
  if (bytes < 1024) return fmtNumber(bytes) + NBSP + 'B';
  if (bytes < 1024 * 1024) return fmtNumber(bytes / 1024, { decimals: 1 }) + NBSP + 'KB';
  return fmtNumber(bytes / 1024 / 1024, { decimals: 1 }) + NBSP + 'MB';
}

const pad = (n) => String(n).padStart(2, '0');

/** Tarix: "05.10.2026 21:59" (time:false → "05.10.2026"). */
export function fmtDate(iso, { time = true } = {}) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  const day = `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
  return time ? `${day} ${pad(d.getHours())}:${pad(d.getMinutes())}` : day;
}

/** Nisbi tarix: "indicə", "12 dəq əvvəl", "bu gün 21:59", "dünən 21:59", sonra tam tarix. */
export function fmtRelative(iso, now = new Date()) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  const diff = (now - d) / 1000;
  if (diff >= 0 && diff < 60) return 'indicə';
  if (diff >= 0 && diff < 3600) return `${Math.floor(diff / 60)} dəq əvvəl`;
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const startOf = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOf(now) - startOf(d)) / 86400000);
  if (days === 0) return `bu gün ${hm}`;
  if (days === 1) return `dünən ${hm}`;
  return fmtDate(iso);
}
