"""Reallıq yoxlaması — xarici benchmark-larla (`config/benchmarks/<sektor>.yaml`).

Mənbəsi (TODO olmayan) və tarixi olmayan sətir İSTİFADƏ OLUNMUR: nəticə "yoxlanıla bilməz" olur,
təxmin edilmir. Xarici valyutadakı hədlər AMB-nin rəsmi məzənnəsi ilə manata çevrilir.
"""
from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

import yaml

from app import config

log = logging.getLogger(__name__)

BENCHMARK_DIR = config.BASE_DIR / "config" / "benchmarks"
DEFAULT_SECTOR = "gubre"

#: Testlər üçün: məzənnəni şəbəkəsiz vermək.
_FX_OVERRIDE: dict[str, Any] | None = None


def set_fx_override(rates: dict[str, Any] | None) -> None:
    global _FX_OVERRIDE
    _FX_OVERRIDE = rates


def fx_rates() -> dict[str, Any] | None:
    """{"USD": 1.7, "EUR": 1.96, "date": "06.10.2026", "source": "AR Mərkəzi Bankı"} və ya None."""
    if _FX_OVERRIDE is not None:
        return _FX_OVERRIDE
    if not config.MARKET_ENABLED:
        return None
    from app import market
    try:
        data = market.CACHE.get("cbar", market._load_cbar)
    except Exception as exc:                      # mənbə əlçatmazdır — çevirmə aparılmır
        log.info("AMB məzənnəsi alınmadı (%s)", type(exc).__name__)
        return None
    current = data["current"]
    rates = {code: entry["value"] / (entry["nominal"] or 1) for code, entry in current["values"].items()}
    return {**rates, "date": current["date"], "source": market.CBAR_SOURCE["name"]}


def _usable(entry: dict[str, Any]) -> str | None:
    """Sətir istifadə oluna bilərmi; olmazsa səbəb."""
    source = str(entry.get("menbe") or "").strip()
    if not source or source.upper().startswith("TODO"):
        return "benchmark mənbəsi göstərilməyib"
    if not str(entry.get("tarix") or "").strip():
        return "benchmark tarixi göstərilməyib"
    if entry.get("min") is None and entry.get("max") is None:
        return "benchmark hədləri göstərilməyib"
    return None


def load(sector: str = DEFAULT_SECTOR, path: Path | None = None) -> dict[str, Any]:
    file = path or BENCHMARK_DIR / f"{sector}.yaml"
    if not file.exists():
        return {"sektor": sector, "ad": None, "gostericiler": [], "error": f"benchmark faylı yoxdur: {file.name}"}
    with open(file, encoding="utf-8") as handle:
        data = yaml.safe_load(handle) or {}
    data.setdefault("gostericiler", [])
    data["file"] = file.name
    return data


def check(values: dict[str, dict[str, Any]], sector: str = DEFAULT_SECTOR,
          path: Path | None = None) -> list[dict[str, Any]]:
    """Hər benchmark sətri üçün nəticə. `values`: plan açarı → {value, unit, label, source}."""
    data = load(sector, path)
    results = []
    fx: dict[str, Any] | None = None
    fx_loaded = False
    for entry in data["gostericiler"]:
        plan_key = entry.get("plan")
        plan = values.get(plan_key)
        base = {"id": entry.get("id"), "title": entry.get("ad"), "plan_key": plan_key,
                "unit": entry.get("vahid"), "benchmark": {k: entry.get(k) for k in
                                                           ("min", "max", "valyuta", "menbe", "tarix")},
                "file": data.get("file")}
        reason = _usable(entry)
        if reason:
            results.append({**base, "status": "skip", "reason": reason,
                            "plan": plan})
            continue
        if plan is None:
            results.append({**base, "status": "skip", "reason": "plandakı göstərici tapılmadı və ya təsdiqlənmədi",
                            "plan": None})
            continue
        low, high = entry.get("min"), entry.get("max")
        currency = (entry.get("valyuta") or "AZN").upper()
        converted = None
        if currency not in ("AZN", "MANAT"):
            if not fx_loaded:
                fx, fx_loaded = fx_rates(), True
            rate = (fx or {}).get(currency)
            if not rate:
                results.append({**base, "status": "skip", "plan": plan,
                                "reason": f"{currency}/AZN məzənnəsi alınmadı — çevirmə aparılmadı"})
                continue
            low = None if low is None else low * rate
            high = None if high is None else high * rate
            converted = {"currency": currency, "rate": rate, "date": fx.get("date"), "source": fx.get("source")}
        value = plan["value"]
        below = low is not None and value < low
        above = high is not None and value > high
        results.append({**base, "status": "flag" if below or above else "ok", "plan": plan,
                        "range_azn": {"min": low, "max": high}, "converted": converted,
                        "direction": "aşağı" if below else "yuxarı" if above else None})
    return results
