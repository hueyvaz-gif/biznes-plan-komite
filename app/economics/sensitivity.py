"""Həssaslıq, zərərsizlik nöqtəsi və qalıq dəyərin payı — hamısı kodda, planın öz pul axınından.

Sadələşdirmə AÇIQ yazılır: ssenarilərdə dəyişiklik FCFF-ə vergi effekti olmadan (vergiyə qədər)
əlavə olunur; qalıq dəyər və amortizasiya dəyişmir. Ona görə nəticə planın tam yenidən hesablanmış
modelindən (məs. planın öz həssaslıq cədvəlindən) bir qədər fərqlənə bilər.
"""
from __future__ import annotations

from typing import Any, Sequence

from app.finance_tools import irr, npv

#: Ssenarilər: (id, ad, düstur).
SCENARIOS: tuple[tuple[str, str, str], ...] = (
    ("price_-10", "Satış qiyməti −10%", "ΔFCFF_t = −10% × satış gəliri_t"),
    ("raw_+10", "Xammal qiyməti +10%", "ΔFCFF_t = −10% × xammal xərci_t"),
    ("capex_+15", "İnvestisiya (capex) +15%", "ΔFCFF_0 = −15% × investisiya qoyuluşu"),
    ("delay_1y", "Satışın 1 il gecikməsi", "investisiyadan sonrakı bütün axınlar 1 il sonraya keçir"),
    ("capacity_80", "Gücdən istifadə 80%", "ΔFCFF_t = −(həcm_t − min(həcm_t, 80% × praktiki güc)) × marjinal gəlir/t"),
)

ASSUMPTION = ("Dəyişiklik FCFF-ə vergi effekti olmadan əlavə olunur; qalıq dəyər və amortizasiya dəyişmir "
              "(sadələşdirmə).")


def align(years: Sequence[int], row: dict[str, Any] | None) -> list[float] | None:
    """Sətri pul axınının illərinə düzür; olmayan il 0 sayılmır — None qaytarılır (sətir yoxdursa)."""
    if not row:
        return None
    by_year = {y: v for y, v in zip(row["years"], row["values"]) if v is not None}
    return [float(by_year.get(y, 0.0)) for y in years]


def scenarios(years: Sequence[int], flows: Sequence[float], rate_pct: float,
              revenue: list[float] | None, raw: list[float] | None, volume: list[float] | None,
              margin_per_t: float | None, practical_capacity: float | None) -> list[dict[str, Any]]:
    base = npv(rate_pct, flows)
    out = []
    for sid, title, formula in SCENARIOS:
        new: list[float] | None = None
        missing = None
        if sid == "price_-10":
            if revenue is None:
                missing = "illər üzrə satış gəliri"
            else:
                new = [f - 0.10 * r for f, r in zip(flows, revenue)]
        elif sid == "raw_+10":
            if raw is None:
                missing = "illər üzrə xammal xərci"
            else:
                new = [f - 0.10 * m for f, m in zip(flows, raw)]
        elif sid == "capex_+15":
            first = flows[0]
            new = [first + 0.15 * first if first < 0 else first, *flows[1:]]
        elif sid == "delay_1y":
            new = [flows[0], 0.0, *flows[1:]]
        elif sid == "capacity_80":
            if volume is None or margin_per_t is None or practical_capacity is None:
                missing = "satış həcmi, marjinal gəlir/t və ya praktiki güc"
            else:
                cap = 0.80 * practical_capacity
                new = [f - (v - min(v, cap)) * margin_per_t for f, v in zip(flows, volume)]
        if new is None:
            out.append({"id": sid, "title": title, "formula": formula, "status": "skip",
                        "reason": f"yoxlanıla bilmədi — {missing} təsdiqlənmədi"})
            continue
        value = npv(rate_pct, new)
        out.append({"id": sid, "title": title, "formula": formula, "status": "ok",
                    "npv": value, "delta": value - base, "irr": irr(new), "negative": value < 0,
                    "threshold": zero_threshold(sid, flows, rate_pct, revenue, raw, volume, margin_per_t,
                                                practical_capacity)})
    return out


def base_case(flows: Sequence[float], rate_pct: float) -> dict[str, Any]:
    """Baza sətri — planın öz pul axını ilə kodun hesabı."""
    return {"npv": npv(rate_pct, flows), "irr": irr(flows)}


def zero_threshold(sid: str, flows: Sequence[float], rate_pct: float, revenue: list[float] | None,
                   raw: list[float] | None, volume: list[float] | None, margin_per_t: float | None,
                   practical_capacity: float | None) -> dict[str, Any] | None:
    """NPV-nin SIFIRA endiyi hədd (kodun hesabı, ssenarinin öz modeli ilə):
      • qiymət / xammal / capex — dəyişmənin faizi: baza NPV / PV(təsir olunan axın) (model xəttidir);
      • gücdən istifadə — praktiki gücün hansı faizində NPV = 0 (bisection);
      • gecikmə — kəsilməz hədd yoxdur (None).
    Baza NPV artıq mənfidirsə, hədd yoxdur (None)."""
    base = npv(rate_pct, flows)
    if base <= 0:
        return None
    if sid == "price_-10" and revenue:
        pv = npv(rate_pct, revenue)
        return {"value": -base / pv * 100, "kind": "change"} if pv > 0 else None
    if sid == "raw_+10" and raw:
        pv = npv(rate_pct, raw)
        return {"value": base / pv * 100, "kind": "change"} if pv > 0 else None
    if sid == "capex_+15" and flows and flows[0] < 0:
        return {"value": base / -flows[0] * 100, "kind": "change"}
    if sid == "capacity_80" and volume and margin_per_t and practical_capacity:
        def value_at(u: float) -> float:
            cap = u * practical_capacity
            return npv(rate_pct, [f - (v - min(v, cap)) * margin_per_t for f, v in zip(flows, volume)])
        if value_at(0.0) > 0:
            return None                                   # həcm sıfır olsa belə NPV müsbət — hədd yoxdur
        low, high = 0.0, max(volume) / practical_capacity
        for _ in range(60):
            mid = (low + high) / 2
            if value_at(mid) > 0:
                high = mid
            else:
                low = mid
        return {"value": high * 100, "kind": "level"}
    return None


def terminal_value(years: Sequence[int], flows: Sequence[float], residual: list[float] | None,
                   rate_pct: float) -> dict[str, Any] | None:
    """Qalıq dəyərin müsbət diskontlaşdırılmış axınlarda payı və qalıq dəyərsiz NPV."""
    if residual is None or not any(residual):
        return None
    rate = rate_pct / 100.0
    pv = [f / (1 + rate) ** t for t, f in enumerate(flows)]
    pv_residual = sum(r / (1 + rate) ** t for t, r in enumerate(residual))
    pv_positive = sum(v for v in pv if v > 0)
    base = sum(pv)
    return {"pv_residual": pv_residual, "pv_positive": pv_positive,
            "share_pct": pv_residual / pv_positive * 100 if pv_positive else None,
            "npv": base, "npv_without": base - pv_residual,
            "year": next((y for y, r in zip(reversed(years), reversed(residual)) if r), None)}


def break_even(years: Sequence[int], volume: list[float] | None, fixed_cash: list[float] | None,
               depreciation: list[float] | None, margin_per_t: float | None,
               practical_capacity: float | None) -> dict[str, Any] | None:
    """Tam zərərsizlik həcmi = (sabit nağd xərc + amortizasiya) / marjinal gəlir/t."""
    if fixed_cash is None or not margin_per_t:
        return None
    rows = []
    for i, year in enumerate(years):
        fixed = fixed_cash[i] + (depreciation[i] if depreciation else 0.0)
        if not fixed:
            continue
        be = fixed / margin_per_t
        rows.append({"year": year, "volume": volume[i] if volume else None, "break_even_t": be,
                     "pct_of_capacity": be / practical_capacity * 100 if practical_capacity else None})
    if not rows:
        return None
    below = [r for r in rows if r["volume"] is not None and r["volume"] < r["break_even_t"]]
    worst = max((r["pct_of_capacity"] for r in rows if r["pct_of_capacity"] is not None), default=None)
    return {"rows": rows, "below": below, "max_pct_of_capacity": worst}
