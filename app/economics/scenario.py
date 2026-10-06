"""Ssenari modeli — həssaslıq, sıfır hədləri və "Nə olarsa?" simulyatoru üçün VAHİD nüvə.

Model planın ÖZ metodunu təkrarlayır (planın 8-ci bölməsi, S36):
  • FCFF = EBITDA − mənfəət vergisi − dövriyyə kapitalının artımı (+ son ildə qalıq dəyər);
  • qalıq dəyər = son ilin dövriyyə kapitalı + əsas vəsaitlərin balans (qalıq) dəyəri;
  • mənfəət vergisi yalnız planın vergi ödədiyi illərdə (vergi sətri ≠ 0) — güzəşt illərində dəyişiklik vergisizdir;
  • dövriyyə kapitalı gün normaları ilə: debitor borcları = gəlir × gün/365, xammal ehtiyatı = xammal × gün/365,
    kreditor borcları = xammal × gün/365.

Ssenari parametrləri (hamısı bir-biri ilə birləşə bilər):
  price        — satış qiymətinin dəyişməsi (pay: −0,10 = −10%)
  raw          — xammal qiymətinin dəyişməsi (pay)
  capex        — əsas vəsaitlərə investisiyanın dəyişməsi (pay); amortizasiya və balans dəyəri mütənasib dəyişir
  utilization  — gücdən istifadənin yuxarı həddi (praktiki gücün payı; None — məhdudiyyət yoxdur)
  delay        — satışın gecikməsi (il); investisiyadan sonrakı bütün axınlar sürüşür

Sadələşdirmələr (nəticədə AÇIQ yazılır — ASSUMPTIONS):
  • hazır məhsul ehtiyatı (30 gün) və qablaşdırma üzrə kreditor borcu dəyişmir — yalnız xammal hissəsi;
  • gecikmədə vergi güzəştinin təqvimi sürüşmür (axınlar planın vergisi ilə birlikdə sürüşür);
  • zərərin keçirilməsi (vergi bazasının azalması) modelləşdirilmir — vergi illik ΔEBT × dərəcə qədər dəyişir.

Eyni düsturlar static/econ-calc.js-dədir; tests/fixtures/econ_vectors.json hər iki tərəfi ±1 manat dəqiqliklə yoxlayır.
"""
from __future__ import annotations

from typing import Any, Sequence

from app.finance_tools import irr, npv

ASSUMPTIONS = (
    "Model planın öz metoduna uyğundur: vergi yalnız planın vergi ödədiyi illərdə dəyişir, dövriyyə kapitalı "
    "gün normaları ilə yenidən hesablanır, qalıq dəyər (dövriyyə kapitalı + əsas vəsaitlərin balans dəyəri) hər "
    "ssenaridə yenidən tapılır. Sadələşdirmə: hazır məhsul ehtiyatı və qablaşdırma borcu dəyişmir; gecikmədə "
    "vergi güzəştinin təqvimi sürüşmür."
)

#: Ciddilik: sıfır həddinə qədər ehtiyat (faiz bəndi) — < 5 yüksək, 5–15 orta, > 15 aşağı.
SEVERITY_LIMITS = ((5.0, "yuksek"), (15.0, "orta"))


def severity_for(margin_pct: float | None) -> str | None:
    if margin_pct is None:
        return None
    for limit, level in SEVERITY_LIMITS:
        if abs(margin_pct) < limit:
            return level
    return "asagi"


def _num(v: Any) -> float | None:
    return float(v) if isinstance(v, (int, float)) else None


def _series(v: Any, n: int) -> list[float] | None:
    if not v or len(v) != n:
        return None
    return [float(x or 0.0) for x in v]


def flows_for(m: dict[str, Any], price: float = 0.0, raw: float = 0.0, capex: float = 0.0,
              utilization: float | None = None, delay: int = 0) -> list[float]:
    """Ssenari pul axını (son ildə qalıq dəyər daxil). Bütün parametrlər sıfır olanda planın FCFF-i dəyişmir."""
    years = m["years"]
    n = len(years)
    flows = [float(f) for f in m["flows"]]
    residual = _series(m.get("residual"), n) or [0.0] * n
    tax = _series(m.get("tax"), n) or [0.0] * n
    rate = (_num(m.get("tax_rate_pct")) or 0.0) / 100.0
    rev = _series(m.get("revenue"), n)
    rawc = _series(m.get("raw"), n)
    vol = _series(m.get("volume"), n)
    dep = _series(m.get("depreciation"), n) or [0.0] * n
    cap = _num(m.get("practical_capacity_t"))
    margin = _num(m.get("margin_per_t")) or 0.0
    price_t = _num(m.get("price_per_t")) or 0.0
    raw_t = _num(m.get("raw_per_t")) or 0.0
    fa = _num(m.get("fixed_assets_investment")) or 0.0
    rd = (_num(m.get("receivable_days")) or 0.0) / 365.0
    idays = (_num(m.get("inventory_days")) or 0.0) / 365.0
    pd = (_num(m.get("payable_days")) or 0.0) / 365.0

    # 1) Gücdən istifadə həddi: itirilən həcm marjinal gəliri, gəliri və xammalı azaldır.
    lost = [0.0] * n
    if utilization is not None and vol and cap:
        lost = [max(0.0, v - utilization * cap) for v in vol]
    rev2 = [r - l * price_t for r, l in zip(rev, lost)] if rev else None
    raw2 = [r - l * raw_t for r, l in zip(rawc, lost)] if rawc else None

    out = []
    wc_prev = 0.0
    nbv_change = capex * (fa - sum(dep))                     # əsas vəsaitlərin son balans dəyərinin dəyişməsi
    for t in range(n):
        d_rev = (price * rev2[t] + (rev2[t] - rev[t])) if rev2 else 0.0
        d_raw = (raw * raw2[t] + (raw2[t] - rawc[t])) if raw2 else 0.0
        d_ebitda = (price * rev2[t] if rev2 else 0.0) - (raw * raw2[t] if raw2 else 0.0) - lost[t] * margin
        d_dep = capex * dep[t]
        taxed = tax[t] != 0.0
        d_tax = -rate * (d_ebitda - d_dep) if taxed else 0.0          # FCFF-ə təsir: vergi = −(dərəcə × ΔEBT)
        wc = d_rev * rd + d_raw * idays - d_raw * pd                   # dövriyyə kapitalı balansının dəyişməsi
        d_wc = wc - wc_prev
        wc_prev = wc
        f = flows[t] - residual[t] + d_ebitda + d_tax - d_wc
        if t == 0:
            f -= capex * fa                                            # investisiya ili (t = 0)
        res = residual[t]
        if t == n - 1:
            res += wc + nbv_change                                    # qalıq dəyər: dövriyyə kapitalı + balans dəyəri
        out.append(f + res)
    if delay > 0:
        out = [out[0], *([0.0] * int(delay)), *out[1:]]
    return out


def evaluate(m: dict[str, Any], **params: Any) -> dict[str, Any]:
    flows = flows_for(m, **params)
    rate = float(m["rate_pct"])
    value = npv(rate, flows)
    return {"npv": value, "irr": irr(flows), "flows": flows}


def bisect(fn, lo: float, hi: float, iterations: int = 80) -> float | None:
    """fn(lo) və fn(hi) əks işarəlidirsə, kökü bisection ilə tapır; deyilsə None."""
    a, b = fn(lo), fn(hi)
    if a == 0:
        return lo
    if b == 0:
        return hi
    if (a > 0) == (b > 0):
        return None
    for _ in range(iterations):
        mid = (lo + hi) / 2
        v = fn(mid)
        if (v > 0) == (a > 0):
            lo, a = mid, v
        else:
            hi = mid
    return (lo + hi) / 2


def zero_threshold(m: dict[str, Any], kind: str) -> dict[str, Any] | None:
    """NPV = 0 olan hədd (bisection). change — dəyişmənin faizi; level — praktiki gücün faizi."""
    rate = float(m["rate_pct"])
    base = npv(rate, flows_for(m))
    if base <= 0:
        return None
    at = lambda **p: npv(rate, flows_for(m, **p))
    if kind == "price" and m.get("revenue"):
        x = bisect(lambda p: at(price=p), 0.0, -1.0)
        return {"value": x * 100, "kind": "change"} if x is not None else None
    if kind == "raw" and m.get("raw"):
        x = bisect(lambda q: at(raw=q), 0.0, 10.0)
        return {"value": x * 100, "kind": "change"} if x is not None else None
    if kind == "capex" and m.get("fixed_assets_investment"):
        x = bisect(lambda c: at(capex=c), 0.0, 20.0)
        return {"value": x * 100, "kind": "change"} if x is not None else None
    if kind == "capacity" and m.get("volume") and m.get("practical_capacity_t"):
        top = max(m["volume"]) / float(m["practical_capacity_t"])
        x = bisect(lambda u: at(utilization=u), top, 0.0)
        return {"value": x * 100, "kind": "level"} if x is not None else None
    return None


def margin_of(threshold: dict[str, Any] | None) -> float | None:
    """Sıfır həddinə qədər ehtiyat (faiz bəndi): change — |hədd|; level — 100 − hədd."""
    if not threshold:
        return None
    return abs(threshold["value"]) if threshold["kind"] == "change" else 100.0 - threshold["value"]


#: Sabit ssenarilər: (id, ad, parametrlər, hədd növü, insan dilində düstur).
SCENARIOS: tuple[tuple[str, str, dict[str, Any], str | None, str], ...] = (
    ("price_-10", "Satış qiyməti −10%", {"price": -0.10}, "price",
     "Hər ilin satış gəliri 10% azalır; vergi yalnız vergi ödənilən illərdə dəyişir; debitor borcları və qalıq dəyər yenidən hesablanır."),
    ("raw_+10", "Xammal qiyməti +10%", {"raw": 0.10}, "raw",
     "Hər ilin xammal xərci 10% artır; vergi yalnız vergi ödənilən illərdə dəyişir; ehtiyat, kreditor borcu və qalıq dəyər yenidən hesablanır."),
    ("capex_+15", "İnvestisiya (capex) +15%", {"capex": 0.15}, "capex",
     "Əsas vəsaitlərə investisiya 15% artır; amortizasiya (vergi qalxanı) və son ilin balans dəyəri mütənasib artır."),
    ("delay_1y", "Satışın 1 il gecikməsi", {"delay": 1}, None,
     "İnvestisiyadan sonrakı bütün axınlar (qalıq dəyər daxil) 1 il sonraya sürüşür."),
    ("capacity_80", "Gücdən istifadə 80%", {"utilization": 0.80}, "capacity",
     "Satış həcmi praktiki gücün 80%-i ilə məhdudlaşır; itirilən həcm marjinal gəliri, gəliri və xammalı azaldır."),
)

NEEDS = {"price": ("revenue", "illər üzrə satış gəliri"), "raw": ("raw", "illər üzrə xammal xərci"),
         "capacity": ("volume", "satış həcmi və praktiki güc")}


def scenarios(m: dict[str, Any]) -> list[dict[str, Any]]:
    base = evaluate(m)
    out = []
    for sid, title, params, kind, formula in SCENARIOS:
        need = NEEDS.get(kind or "")
        if need and not m.get(need[0]) or kind == "capacity" and not (m.get("practical_capacity_t") and m.get("margin_per_t")):
            out.append({"id": sid, "title": title, "formula": formula, "status": "skip",
                        "reason": f"yoxlanıla bilmədi — {(need or ('', 'satış həcmi, marjinal gəlir və ya praktiki güc'))[1]} təsdiqlənmədi"})
            continue
        r = evaluate(m, **params)
        threshold = zero_threshold(m, kind) if kind else None
        out.append({"id": sid, "title": title, "formula": formula, "status": "ok", "params": params,
                    "npv": r["npv"], "delta": r["npv"] - base["npv"], "irr": r["irr"], "negative": r["npv"] < 0,
                    "threshold": threshold, "severity": severity_for(margin_of(threshold)) if threshold
                    else ("yuksek" if r["npv"] < 0 else None)})
    return out


def model_inputs(years: Sequence[int], flows: Sequence[float], rate_pct: float, **parts: Any) -> dict[str, Any]:
    """Modelin girişləri — frontend simulyatoru eyni obyektlə işləyir (API cavabında `sensitivity.model`)."""
    m = {"years": list(years), "flows": [float(f) for f in flows], "rate_pct": float(rate_pct)}
    for key in ("residual", "tax", "revenue", "raw", "volume", "depreciation"):
        v = parts.get(key)
        m[key] = [float(x or 0.0) for x in v] if v else None
    for key in ("tax_rate_pct", "margin_per_t", "price_per_t", "raw_per_t", "practical_capacity_t",
                "fixed_assets_investment", "receivable_days", "inventory_days", "payable_days"):
        m[key] = _num(parts.get(key))
    return m
