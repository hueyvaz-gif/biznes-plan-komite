"""Ssenari modeli (app/economics/scenario.py): planın metodu ilə həssaslıq, sıfır hədləri, ciddilik.

Test modeli kiçik, əl ilə yoxlanıla bilən plandır: 4 il, 2-ci ildə vergi güzəşti bitir, son ildə qalıq dəyər =
dövriyyə kapitalı + əsas vəsaitlərin balans dəyəri. Frontend nüvəsi (static/econ-calc.js) eyni vektorları
tests/fixtures/econ_vectors.json-dan oxuyur — fərq > 1 manat olarsa JS testi düşür.
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.economics import scenario
from app.finance_tools import npv

FIXTURE = Path(__file__).resolve().parent / "fixtures" / "econ_vectors.json"


def model(**over):
    """Sadə plan: investisiya 1000 (əsas vəsaitlər 800 + dövriyyə 200), 3 il əməliyyat.
    Vergi: 1-ci və 2-ci il güzəşt (vergi 0), 3-cü il 20%. Qalıq dəyər 3-cü ildə."""
    m = {
        "years": [2027, 2028, 2029, 2030], "rate_pct": 10.0,
        "revenue": [0.0, 2000.0, 2000.0, 2000.0], "raw": [0.0, 1000.0, 1000.0, 1000.0],
        "volume": [0.0, 1000.0, 1000.0, 1000.0], "depreciation": [0.0, 100.0, 90.0, 80.0],
        "tax": [0.0, 0.0, 0.0, -40.0], "tax_rate_pct": 20.0,
        "margin_per_t": 0.5, "price_per_t": 2.0, "raw_per_t": 1.0, "practical_capacity_t": 1000.0,
        "fixed_assets_investment": 800.0, "receivable_days": 36.5, "inventory_days": 73.0, "payable_days": 36.5,
    }
    # FCFF = −investisiya, sonra EBITDA − vergi; son ildə qalıq dəyər = balans dəyəri (800 − 270) + dövriyyə 300.
    m["residual"] = [0.0, 0.0, 0.0, 530.0 + 300.0]
    m["flows"] = [-1000.0, 380.0, 380.0, 340.0 + m["residual"][3]]
    m.update(over)
    return m


def test_parametrsiz_ssenari_baza_pul_axınını_dəyişmir():
    m = model()
    assert scenario.flows_for(m) == m["flows"]
    assert scenario.evaluate(m)["npv"] == pytest.approx(npv(10.0, m["flows"]))


def test_vergi_güzəşti_yalnız_vergi_ödənilən_illərdə_tətbiq_olunur():
    m = model(receivable_days=0.0, inventory_days=0.0, payable_days=0.0)
    base = scenario.flows_for(m)
    new = scenario.flows_for(m, price=-0.10)
    d = [b - a for a, b in zip(base, new)]
    assert d[1] == pytest.approx(-200.0)                 # güzəşt ili: ΔFCFF = ΔEBITDA (vergisiz)
    assert d[2] == pytest.approx(-200.0)
    assert d[3] == pytest.approx(-200.0 * (1 - 0.20))    # vergi ili: vergi də 20% azalır


def test_qalıq_dəyər_ssenari_ilə_dəyişir():
    m = model()
    # Capex +10%: son ilin balans dəyəri 10% artır (800 − 270 = 530 → +53), amortizasiyanın vergi qalxanı.
    base = scenario.flows_for(m)
    capex = scenario.flows_for(m, capex=0.10)
    assert capex[0] - base[0] == pytest.approx(-80.0)
    assert capex[3] - base[3] == pytest.approx(53.0 + 0.20 * 0.10 * 80.0)
    # Qiymət −10%: debitor borcu (gəlir × 36,5/365 = 10%) azalır — dövriyyə kapitalı və qalıq dəyər dəyişir.
    price = scenario.flows_for(m, price=-0.10)
    wc_release = 0.10 * 2000.0 * 0.10                     # 2028-də debitor borcu 20 azalır → pul axını +20
    assert price[1] - base[1] == pytest.approx(-200.0 + wc_release)
    assert price[3] - base[3] == pytest.approx(-160.0 - wc_release)  # son ildə qalıq dəyərdə də 20 az


@pytest.mark.parametrize("kind,param", [("price", "price"), ("raw", "raw"), ("capex", "capex")])
def test_sıfır_həddində_npv_sıfırdır(kind, param):
    m = model()
    t = scenario.zero_threshold(m, kind)
    assert t and t["kind"] == "change"
    assert abs(scenario.evaluate(m, **{param: t["value"] / 100})["npv"]) < 1.0


def test_güc_istifadəsinin_sıfır_həddi_bisection_ilə():
    m = model(flows=[-1000.0, 600.0, 600.0, 600.0], residual=[0.0, 0.0, 0.0, 0.0], tax=[0.0] * 4)
    t = scenario.zero_threshold(m, "capacity")
    assert t["kind"] == "level" and 0 < t["value"] < 100
    assert abs(scenario.evaluate(m, utilization=t["value"] / 100)["npv"]) < 1.0


def test_baza_npv_mənfidirsə_hədd_yoxdur():
    m = model(flows=[-5000.0, 380.0, 380.0, 1170.0])
    assert scenario.zero_threshold(m, "price") is None


def test_ciddilik_sıfır_həddinə_qədər_ehtiyatdan():
    assert scenario.severity_for(0.9) == "yuksek"
    assert scenario.severity_for(-4.99) == "yuksek"
    assert scenario.severity_for(5.0) == "orta"
    assert scenario.severity_for(14.9) == "orta"
    assert scenario.severity_for(18.7) == "asagi"
    assert scenario.margin_of({"value": 87.5, "kind": "level"}) == pytest.approx(12.5)


def test_hər_ssenaridə_irr_və_öz_ciddiliyi():
    rows = {r["id"]: r for r in scenario.scenarios(model())}
    assert set(rows) == {"price_-10", "raw_+10", "capex_+15", "delay_1y", "capacity_80"}
    for r in rows.values():
        assert r["status"] == "ok" and "irr" in r
    price = rows["price_-10"]
    assert price["severity"] == scenario.severity_for(scenario.margin_of(price["threshold"]))
    assert rows["delay_1y"]["threshold"] is None


def test_birləşdirilmiş_ssenari_qiymət_və_xammal_xətti_toplanır():
    m = model()
    base = scenario.evaluate(m)["npv"]
    p = scenario.evaluate(m, price=-0.05)["npv"] - base
    q = scenario.evaluate(m, raw=0.05)["npv"] - base
    both = scenario.evaluate(m, price=-0.05, raw=0.05)["npv"] - base
    assert both == pytest.approx(p + q)


def test_çatışmayan_sətir_ssenarini_ötürür():
    rows = {r["id"]: r for r in scenario.scenarios(model(revenue=None))}
    assert rows["price_-10"]["status"] == "skip" and "satış gəliri" in rows["price_-10"]["reason"]


def test_fixture_python_ilə_eynidir():
    """tests/fixtures/econ_vectors.json — Python və JS üçün ortaq vektorlar. Model dəyişərsə:
    python scripts/make_econ_vectors.py (və dəyişikliyi commit mesajında izah et)."""
    data = json.loads(FIXTURE.read_text(encoding="utf-8"))
    assert data["vectors"], "fixture boşdur"
    for v in data["vectors"]:
        m = data["models"][v["model"]]
        got = scenario.evaluate(m, **v["params"])
        assert got["npv"] == pytest.approx(v["npv"], abs=1.0), v
        assert got["flows"] == pytest.approx(v["flows"], abs=1.0), v
        if v.get("irr") is not None:
            assert got["irr"] == pytest.approx(v["irr"], abs=1e-6), v
    for t in data["thresholds"]:
        got = scenario.zero_threshold(data["models"][t["model"]], t["kind"])
        assert (got or {}).get("value") == pytest.approx(t["value"], abs=1e-6) if t["value"] is not None else got is None
