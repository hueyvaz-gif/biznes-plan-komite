/* Ssenari modeli — app/economics/scenario.py-ın JS köçürməsi ("Nə olarsa?" simulyatoru üçün).
 *
 * Düsturlar Python ilə EYNİDİR (planın metodu: vergi yalnız vergi ödənilən illərdə dəyişir, dövriyyə kapitalı
 * gün normaları ilə, qalıq dəyər = dövriyyə kapitalı + əsas vəsaitlərin balans dəyəri). Girişlər API cavabındakı
 * `sensitivity.model`-dir — rəqəmləri AI yox, plan və kod verir. tests/js/econ-calc.test.mjs Python-un
 * tests/fixtures/econ_vectors.json vektorlarını ±1 manat dəqiqliklə yoxlayır.
 * Bu nəticə simulyasiyadır: yoxlama statusuna təsir etmir. */

export function npv(ratePct, flows) {
  const r = ratePct / 100;
  let sum = 0;
  for (let t = 0; t < flows.length; t++) sum += flows[t] / (1 + r) ** t;
  return sum;
}

/** IRR, faizlə — Python finance_tools.irr ilə eyni bisection (−99,99% … 1000%, 200 addım). */
export function irr(flows) {
  if (!flows.length || flows.every((f) => f >= 0) || flows.every((f) => f <= 0)) return null;
  let low = -0.9999;
  let high = 10.0;
  let fLow = npv(low * 100, flows);
  if (fLow * npv(high * 100, flows) > 0) return null;
  for (let i = 0; i < 200; i++) {
    const mid = (low + high) / 2;
    const fMid = npv(mid * 100, flows);
    if (fLow * fMid <= 0) high = mid; else { low = mid; fLow = fMid; }
  }
  return ((low + high) / 2) * 100;
}

/** Özünü ödəmə (il), il daxilində xətti interpolyasiya — Python finance_tools.payback. */
export function payback(flows) {
  let cum = 0;
  for (let i = 0; i < flows.length; i++) {
    const prev = cum;
    cum += flows[i];
    if (prev < 0 && cum >= 0 && flows[i] !== 0) return (i - 1) + (-prev) / flows[i];
  }
  return null;
}

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const series = (v, n) => (Array.isArray(v) && v.length === n ? v.map((x) => Number(x) || 0) : null);

/** Ssenari pul axını (son ildə qalıq dəyər daxil) — scenario.flows_for. */
export function flowsFor(m, { price = 0, raw = 0, capex = 0, utilization = null, delay = 0 } = {}) {
  const n = m.years.length;
  const flows = m.flows.map(Number);
  const residual = series(m.residual, n) || new Array(n).fill(0);
  const tax = series(m.tax, n) || new Array(n).fill(0);
  const rate = (num(m.tax_rate_pct) || 0) / 100;
  const rev = series(m.revenue, n);
  const rawc = series(m.raw, n);
  const vol = series(m.volume, n);
  const dep = series(m.depreciation, n) || new Array(n).fill(0);
  const cap = num(m.practical_capacity_t);
  const margin = num(m.margin_per_t) || 0;
  const priceT = num(m.price_per_t) || 0;
  const rawT = num(m.raw_per_t) || 0;
  const fa = num(m.fixed_assets_investment) || 0;
  const rd = (num(m.receivable_days) || 0) / 365;
  const idays = (num(m.inventory_days) || 0) / 365;
  const pd = (num(m.payable_days) || 0) / 365;

  let lost = new Array(n).fill(0);
  if (utilization !== null && utilization !== undefined && vol && cap) lost = vol.map((v) => Math.max(0, v - utilization * cap));
  const rev2 = rev ? rev.map((r, t) => r - lost[t] * priceT) : null;
  const raw2 = rawc ? rawc.map((r, t) => r - lost[t] * rawT) : null;

  const out = [];
  let wcPrev = 0;
  const nbvChange = capex * (fa - dep.reduce((s, d) => s + d, 0));
  let wc = 0;
  for (let t = 0; t < n; t++) {
    const dRev = rev2 ? price * rev2[t] + (rev2[t] - rev[t]) : 0;
    const dRaw = raw2 ? raw * raw2[t] + (raw2[t] - rawc[t]) : 0;
    const dEbitda = (rev2 ? price * rev2[t] : 0) - (raw2 ? raw * raw2[t] : 0) - lost[t] * margin;
    const dDep = capex * dep[t];
    const taxed = tax[t] !== 0;
    const dTax = taxed ? -rate * (dEbitda - dDep) : 0;
    wc = dRev * rd + dRaw * idays - dRaw * pd;
    const dWc = wc - wcPrev;
    wcPrev = wc;
    let f = flows[t] - residual[t] + dEbitda + dTax - dWc;
    if (t === 0) f -= capex * fa;
    let res = residual[t];
    if (t === n - 1) res += wc + nbvChange;
    out.push(f + res);
  }
  if (delay > 0) return [out[0], ...new Array(Math.trunc(delay)).fill(0), ...out.slice(1)];
  return out;
}

export function evaluate(m, params = {}) {
  const flows = flowsFor(m, params);
  return { npv: npv(Number(m.rate_pct), flows), irr: irr(flows), payback: payback(flows), flows };
}

export function bisect(fn, lo, hi, iterations = 80) {
  let a = fn(lo);
  const b = fn(hi);
  if (a === 0) return lo;
  if (b === 0) return hi;
  if ((a > 0) === (b > 0)) return null;
  for (let i = 0; i < iterations; i++) {
    const mid = (lo + hi) / 2;
    const v = fn(mid);
    if ((v > 0) === (a > 0)) { lo = mid; a = v; } else hi = mid;
  }
  return (lo + hi) / 2;
}

/** NPV = 0 həddi — scenario.zero_threshold ilə eyni intervallar. */
export function zeroThreshold(m, kind) {
  const rate = Number(m.rate_pct);
  if (npv(rate, flowsFor(m)) <= 0) return null;
  const at = (p) => npv(rate, flowsFor(m, p));
  let x;
  if (kind === 'price' && m.revenue) { x = bisect((p) => at({ price: p }), 0, -1); return x === null ? null : { value: x * 100, kind: 'change' }; }
  if (kind === 'raw' && m.raw) { x = bisect((q) => at({ raw: q }), 0, 10); return x === null ? null : { value: x * 100, kind: 'change' }; }
  if (kind === 'capex' && m.fixed_assets_investment) { x = bisect((c) => at({ capex: c }), 0, 20); return x === null ? null : { value: x * 100, kind: 'change' }; }
  if (kind === 'capacity' && m.volume && m.practical_capacity_t) {
    const top = Math.max(...m.volume) / Number(m.practical_capacity_t);
    x = bisect((u) => at({ utilization: u }), top, 0);
    return x === null ? null : { value: x * 100, kind: 'level' };
  }
  return null;
}

export const SEVERITY_LIMITS = [[5, 'yuksek'], [15, 'orta']];
export function severityFor(marginPct) {
  if (marginPct === null || marginPct === undefined) return null;
  for (const [limit, level] of SEVERITY_LIMITS) if (Math.abs(marginPct) < limit) return level;
  return 'asagi';
}
export function marginOf(t) {
  if (!t) return null;
  return t.kind === 'change' ? Math.abs(t.value) : 100 - t.value;
}
