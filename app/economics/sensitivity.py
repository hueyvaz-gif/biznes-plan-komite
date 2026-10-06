"""Köməkçilər: illərə düzmə, baza sətri, qalıq dəyərin payı, zərərsizlik nöqtəsi — kodda, planın öz pul axınından.

Həssaslıq ssenariləri və sıfır hədləri app/economics/scenario.py-dadır (planın metodu: vergi, dövriyyə kapitalı,
qalıq dəyər hər ssenaridə yenidən hesablanır).
"""
from __future__ import annotations

from typing import Any, Sequence

from app.finance_tools import irr, npv

def align(years: Sequence[int], row: dict[str, Any] | None) -> list[float] | None:
    """Sətri pul axınının illərinə düzür; olmayan il 0 sayılmır — None qaytarılır (sətir yoxdursa)."""
    if not row:
        return None
    by_year = {y: v for y, v in zip(row["years"], row["values"]) if v is not None}
    return [float(by_year.get(y, 0.0)) for y in years]


def base_case(flows: Sequence[float], rate_pct: float) -> dict[str, Any]:
    """Baza sətri — planın öz pul axını ilə kodun hesabı."""
    return {"npv": npv(rate_pct, flows), "irr": irr(flows)}


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
