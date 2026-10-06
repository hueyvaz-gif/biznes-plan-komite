"""Python ↔ JS ortaq test vektorları: tests/fixtures/econ_vectors.json.

    python scripts/make_econ_vectors.py

Modellər: test_scenario.py-dakı kiçik plan və anonimləşdirilmiş real plan forması (CFG v2-nin pul axını,
gəlir, xammal, vergi sətirləri — yalnız rəqəmlər, ad yoxdur). Hər vektor: parametrlər → pul axını, NPV, IRR.
JS testi (tests/js/econ-calc.test.mjs) eyni nəticəni ±1 manat dəqiqliklə almalıdır.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from app.economics import scenario  # noqa: E402
from tests.test_scenario import model  # noqa: E402

REAL = {
    "years": [2027, 2028, 2029, 2030, 2031, 2032, 2033, 2034, 2035, 2036, 2037], "rate_pct": 10.0,
    "flows": [-14746938.0, -1513961.0, 36481.0, 1800585.0, 3285094.0, 3285094.0, 3223913.0, 3223913.0, 3223913.0,
              2625265.0, 16366782.0],
    "residual": [0.0] * 10 + [13746100.0],
    "tax": [0.0] * 9 + [-535907.0, -545099.0], "tax_rate_pct": 20.0,
    "revenue": [0.0, 20350520.0, 30525780.0] + [37309287.0] * 8,
    "raw": [0.0, 14622985.0, 21934477.0] + [26808806.0] * 8,
    "volume": [0.0, 30000.0, 45000.0] + [55000.0] * 8,
    "depreciation": [0.0, 1105916.0, 982976.0, 877746.0, 787168.0, 708757.0, 640496.0, 580743.0, 528157.0, 481639.0, 440286.0],
    "margin_per_t": 108.0, "price_per_t": 678.0, "raw_per_t": 487.0, "practical_capacity_t": 57600.0,
    "fixed_assets_investment": 12546938.0, "receivable_days": 30.0, "inventory_days": 60.0, "payable_days": 30.0,
}

PARAMS = [
    {}, {"price": -0.10}, {"raw": 0.10}, {"capex": 0.15}, {"delay": 1}, {"delay": 2}, {"utilization": 0.80},
    {"price": -0.05, "raw": 0.03}, {"price": 0.12, "capex": -0.05}, {"price": -0.02, "utilization": 0.9, "delay": 1},
]


def main() -> None:
    models = {"small": model(), "real": REAL}
    vectors = []
    for name, m in models.items():
        for params in PARAMS:
            r = scenario.evaluate(m, **params)
            vectors.append({"model": name, "params": params, "npv": r["npv"], "irr": r["irr"], "flows": r["flows"]})
    thresholds = [{"model": name, "kind": kind, "value": (scenario.zero_threshold(m, kind) or {}).get("value")}
                  for name, m in models.items() for kind in ("price", "raw", "capex", "capacity")]
    out = ROOT / "tests" / "fixtures" / "econ_vectors.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps({"models": models, "vectors": vectors, "thresholds": thresholds}, ensure_ascii=False, indent=1),
                   encoding="utf-8")
    print(f"{len(vectors)} vektor, {len(thresholds)} hədd → {out.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
