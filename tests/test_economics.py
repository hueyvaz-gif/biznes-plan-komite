"""İqtisadi təhlil: hər qayda üçün keçən və bayraqlanan nümunə, yoxlama, benchmark, sənədlər, API.

Rəqəmlər sintetikdir; demo faylı (plan_demo_v1) yalnız tam axın testlərində işlədilir. Real model
çağırılmır (tests/fake_llm.py).
"""
from __future__ import annotations

import io
import time
import uuid
from datetime import date
from pathlib import Path

import pytest

from app import storage
from app.economics import benchmarks, evidence, rules
from app.economics.extract import read_cell, verify

SRC = {"kind": "sened", "location": "S1", "title": "Bölmə", "quote": "sitat"}


def fact(value, unit="manat"):
    return {"value": float(value), "unit": unit, "label": "x", "source": dict(SRC)}


def row(years, values, unit="manat"):
    return {"years": list(years), "values": [float(v) if v is not None else None for v in values], "unit": unit,
            "label": "sətir", "source": dict(SRC)}


def table(table_id, rows):
    return {"id": table_id, "caption": "", "section_title": "", "rows": rows, "row_labels": [r[0] for r in rows],
            "n_rows": len(rows), "n_cols": max(len(r) for r in rows)}


EMPTY = {"sections": [], "tables": []}
YEARS = [2027, 2028, 2029, 2030]


def ctx(figures=None, rows=None, statements=None, finance=None, doc=None):
    return rules.Context(doc or EMPTY, {"figures": figures or {}, "rows": rows or {}, "statements": statements or {}},
                         finance)


def claimed_finance(flows=(-1000.0, 300.0, 400.0, 500.0), rate=10.0, **claimed):
    prov = {k: {"location": "T2", "location_title": "Göstəricilər", "quote": f"{k} | {v}"} for k, v in claimed.items()}
    return {"claimed": {**claimed, "discount_rate_pct": rate, "provenance": prov,
                        "cashflow_table_id": "T9", "row_residual": "Qalıq dəyər", "row_ebitda": "EBITDA",
                        "row_tax": "Mənfəət vergisi"},
            "cashflow": {"years": YEARS, "flows": list(flows), "ok": True}, "checks": []}


# ── 1a. Daxili uyğunluq — hər qayda: keçən və bayraqlanan ───────────────────

def test_gəlir_həcm_qiymət():
    vol = row(YEARS[1:], [100, 200, 300], "ton")
    ok = rules.rule_revenue(ctx({"price_avg_per_t": fact(10, "manat/t")},
                                {"revenue": row(YEARS[1:], [1000, 2000, 3000]), "sales_volume_t": vol}))
    bad = rules.rule_revenue(ctx({"price_avg_per_t": fact(10, "manat/t")},
                                 {"revenue": row(YEARS[1:], [1000, 2000, 3600]), "sales_volume_t": vol}))
    assert ok["status"] == "ok"
    assert bad["status"] == "flag" and bad["severity"] == "orta" and "3 600" in bad["question"].replace(" ", " ")
    assert any(n["source"]["kind"] == "hesab" for n in bad["numbers"])      # hesab kodda, düsturla


def test_həcm_gücdən_çox_ola_bilməz():
    fin = claimed_finance(practical_capacity_t=300)
    ok = rules.rule_capacity(ctx(rows={"sales_volume_t": row(YEARS[1:], [100, 200, 300], "ton")}, finance=fin))
    bad = rules.rule_capacity(ctx(rows={"sales_volume_t": row(YEARS[1:], [100, 200, 350], "ton")}, finance=fin))
    assert ok["status"] == "ok"
    assert bad["status"] == "flag" and bad["severity"] == "yuksek"


def test_güc_rampası_birinci_il_100_faiz_bayraqdır():
    ok = rules.rule_ramp(ctx(rows={"utilization_pct": row(YEARS[1:], [52, 78, 95], "%")}))
    bad = rules.rule_ramp(ctx(rows={"utilization_pct": row(YEARS[1:], [100, 100, 100], "%")}))
    assert ok["status"] == "ok" and bad["status"] == "flag"


def test_xammal_xərci():
    vol = row(YEARS[1:], [100, 200, 300], "ton")
    ok = rules.rule_raw_material(ctx({"raw_cost_per_t": fact(5)}, {"raw_material_cost": row(YEARS[1:], [500, 1000, 1500]),
                                                                    "sales_volume_t": vol}))
    bad = rules.rule_raw_material(ctx({"raw_cost_per_t": fact(5)}, {"raw_material_cost": row(YEARS[1:], [500, 1000, 2000]),
                                                                     "sales_volume_t": vol}))
    assert ok["status"] == "ok" and bad["status"] == "flag"


def test_enerji_xərci():
    base = {"electricity_kwh_year": fact(1000, "kVt·st"), "electricity_tariff": fact(0.11, "manat/kVt·st")}
    ok = rules.rule_energy(ctx({**base, "electricity_cost": fact(110)}))
    bad = rules.rule_energy(ctx({**base, "electricity_cost": fact(150)}))
    assert ok["status"] == "ok" and bad["status"] == "flag"


def test_əmək_haqqı_fondu():
    base = {"staff_count": fact(10, "nəfər"), "payroll_monthly": fact(15000)}
    ok = rules.rule_payroll(ctx({**base, "payroll_annual": fact(180000)}))
    bad = rules.rule_payroll(ctx({**base, "payroll_annual": fact(240000)}))
    assert ok["status"] == "ok" and ok["avg_wage"] == 1500
    assert bad["status"] == "flag"


def test_amortizasiya():
    figs = {"buildings_value": fact(1000), "buildings_dep_rate_pct": fact(7, "%"),
            "equipment_value": fact(500), "equipment_dep_rate_pct": fact(20, "%")}
    ok = rules.rule_depreciation(ctx(figs, {"depreciation": row(YEARS[1:], [170, 150, 130])}))
    bad = rules.rule_depreciation(ctx(figs, {"depreciation": row(YEARS[1:], [250, 150, 130])}))
    assert ok["status"] == "ok" and bad["status"] == "flag"


def test_capex_investisiya_cəminə_bərabərdir():
    figs = {"buildings_value": fact(600), "equipment_value": fact(300)}
    ok = rules.rule_capex(ctx(figs, finance=claimed_finance(investment_total=1000, working_capital_investment=100)))
    bad = rules.rule_capex(ctx(figs, finance=claimed_finance(investment_total=1200, working_capital_investment=100)))
    assert ok["status"] == "ok" and bad["status"] == "flag"


def test_maliyyələşmə_mənbələri_fərqi_sual_olur():
    """CFG v2: mənbələrin cəmi 16 760 899, investisiya 14 746 938 — sual kimi çıxır."""
    fin = claimed_finance(investment_total=14746938)
    fin["checks"] = [{"id": "menbeler_cemi", "status": "warn", "claimed": 14746938, "computed": 16760899,
                      "detail": "Cəmi 16 760 899 manat.", "clarify": "İnvestisiyanı hansı məbləğin maliyyələşdirdiyini dəqiqləşdirin."}]
    bad = rules.rule_sources(ctx(finance=fin))
    assert bad["status"] == "flag"
    text = bad["question"].replace(" ", " ")
    assert "16 760 899" in text and "14 746 938" in text and "2 013 961" in text
    fin["checks"] = [{"id": "menbeler_cemi", "status": "ok", "claimed": 100, "computed": 100, "detail": "uyğun"}]
    assert rules.rule_sources(ctx(finance=fin))["status"] == "ok"


def test_vergi_güzəşti_iddiası_sənəd_tələb_edir():
    ok = rules.rule_taxes(ctx({"profit_tax_rate_pct": fact(20, "%")}))
    claim = {"incentives_claim": {"quote": "Sənaye parkı rezidenti kimi mənfəət vergisindən azadolma", "source": dict(SRC)}}
    bad = rules.rule_taxes(ctx(statements=claim))
    assert ok["status"] == "ok"
    assert bad["status"] == "flag" and rules.required_documents(bad) == ["guzest_senedi"]


def test_dövriyyə_kapitalının_günləri():
    days = {"receivable_days": fact(30, "gün"), "payable_days": fact(30, "gün"), "inventory_days": fact(60, "gün")}
    assert rules.rule_working_capital(ctx(days))["status"] == "ok"
    bad = rules.rule_working_capital(ctx({**days, "receivable_days": fact(0, "gün")}))
    assert bad["status"] == "flag" and bad["severity"] == "orta"


def test_diskont_dərəcəsinin_əsaslandırılması():
    fin = claimed_finance()
    good = {"discount_basis": {"quote": "AMB-nin uçot dərəcəsi 7% + risk mükafatı 3% = 10%", "source": dict(SRC)}}
    weak = {"discount_basis": {"quote": "WACC = Ke = 10,0% (təsisçinin tələb etdiyi minimal gəlirlilik)", "source": dict(SRC)}}
    assert rules.rule_discount(ctx(statements=good, finance=fin))["status"] == "ok"
    bad = rules.rule_discount(ctx(statements=weak, finance=fin))
    assert bad["status"] == "flag" and "uçot dərəcəsi" in bad["question"]


def test_irr_diskont_fərqi():
    assert rules.rule_irr_spread(ctx(finance=claimed_finance(irr_pct=13.5)))["status"] == "ok"
    bad = rules.rule_irr_spread(ctx(finance=claimed_finance(irr_pct=11.8)))
    assert bad["status"] == "flag" and bad["severity"] == "orta"
    assert rules.rule_irr_spread(ctx(finance=claimed_finance(irr_pct=8.0)))["severity"] == "yuksek"


def _cashflow_doc(residual):
    return {"sections": [], "tables": [table("T9", [
        ["Göstərici", "2027", "2028", "2029", "2030"],
        ["EBITDA", "0", "500", "500", "500"],
        ["Mənfəət vergisi", "0", "(100)", "(100)", "(100)"],
        ["Qalıq dəyər", "0", "0", "0", str(residual)],
    ])]}


def test_qalıq_dəyərsiz_npv_mənfi_olarsa_bayraq():
    ok = rules.rule_terminal(ctx(finance=claimed_finance(flows=(-1000, 500, 500, 520)), doc=_cashflow_doc(20)))
    bad = rules.rule_terminal(ctx(finance=claimed_finance(flows=(-1000, 100, 100, 1500)), doc=_cashflow_doc(1400)))
    assert ok["status"] == "ok"
    assert bad["status"] == "flag" and "qalıq dəyər olmadan NPV mənfidir" in bad["result"]
    assert "Npv" not in bad["result"]                                    # böyük hərflər qorunur


def test_proqnoz_üfüqü_məlumatdır():
    assert rules.rule_horizon(ctx(finance=claimed_finance()))["status"] == "info"
    assert rules.rule_horizon(ctx())["status"] == "skip"


def test_dscr_kredit_yoxdursa_tətbiq_edilmir_varsa_hesablanır():
    no_loan = {"no_loan": {"quote": "Bank krediti cəlb edilmir", "source": dict(SRC)}}
    assert rules.rule_dscr(ctx(statements=no_loan, finance=claimed_finance()))["status"] == "na"
    loan = {"loan_amount": fact(1000)}
    ok = rules.rule_dscr(ctx(loan, {"debt_service": row(YEARS, [0, 200, 200, 200]), "interest": row(YEARS, [0, 50, 40, 30])},
                             finance=claimed_finance(), doc=_cashflow_doc(0)))
    bad = rules.rule_dscr(ctx(loan, {"debt_service": row(YEARS, [0, 400, 200, 200]), "interest": row(YEARS, [0, 50, 40, 30])},
                              finance=claimed_finance(), doc=_cashflow_doc(0)))
    assert ok["status"] == "ok"                                         # (500 − 100) / 250 = 1,6
    assert bad["status"] == "flag" and bad["severity"] == "yuksek"      # 400 / 450 < 1,2
    missing = rules.rule_dscr(ctx(loan, finance=claimed_finance(), doc=_cashflow_doc(0)))
    assert missing["status"] == "skip" and rules.required_documents(missing) == ["kredit_teklifi"]


def test_zaman_xətti():
    vol = {"sales_volume_t": row(YEARS[1:], [100, 200, 300], "ton")}
    early = {"schedule_window": {"quote": "dekabr 2026 – yanvar 2028", "source": dict(SRC)}}
    late = {"schedule_window": {"quote": "dekabr 2026 – mart 2029", "source": dict(SRC)}}
    ok = rules.rule_timeline(ctx(rows=vol, statements=early))
    bad = rules.rule_timeline(ctx(rows=vol, statements=late))
    assert ok["status"] == "ok"
    assert bad["status"] == "flag" and bad["severity"] == "yuksek"


def test_xammal_payı_78_85_ziddiyyət_deyil_aydınlıq_sualıdır():
    """CFG v2: 487/570 = 85,5% (dəyişən) və 487/(570+41+16) = 77,7% ≈ 78% (tam) — hər ikisi düzdür."""
    figs = {"raw_cost_per_t": fact(487.43, "manat/t"), "variable_cost_per_t": fact(570.02, "manat/t"),
            "fixed_cash_cost_per_t": fact(41, "manat/t"), "depreciation_per_t": fact(16, "manat/t"),
            "raw_share_variable_pct": fact(85.5, "%"), "raw_share_full_pct": fact(78, "%")}
    info = rules.rule_raw_share(ctx(figs))
    assert info["status"] == "info" and info["severity"] == "asagi" and info["question"]
    assert "78%" in info["question"] and "85,5%" in info["question"]
    bad = rules.rule_raw_share(ctx({**figs, "raw_share_full_pct": fact(60, "%")}))
    assert bad["status"] == "flag"


def test_həssaslıq_npv_mənfi_olan_ssenariləri_göstərir():
    years = [2027, 2028, 2029, 2030]
    robust = claimed_finance(flows=(-1000, 800, 800, 800), practical_capacity_t=1000)
    fragile = claimed_finance(flows=(-1000, 380, 380, 380), practical_capacity_t=1000)
    rows_ = {"revenue": row(years, [0, 2000, 2000, 2000]), "raw_material_cost": row(years, [0, 1000, 1000, 1000]),
             "sales_volume_t": row(years, [0, 1000, 1000, 1000], "ton")}
    figs = {"margin_per_t": fact(1, "manat/t")}
    ok, scen = rules.rule_sensitivity(ctx(figs, rows_, finance=robust))
    bad, scen2 = rules.rule_sensitivity(ctx(figs, rows_, finance=fragile))
    assert ok["status"] == "ok" and not any(s.get("negative") for s in scen)
    negative = {s["id"] for s in scen2 if s.get("negative")}
    assert bad["status"] == "flag" and {"price_-10", "raw_+10"} <= negative
    assert bad["severity"] == "yuksek"


def test_zərərsizlik_nöqtəsi():
    years = YEARS
    base = {"margin_per_t": fact(100, "manat/t")}
    fin = claimed_finance(practical_capacity_t=1000)
    ok, _ = rules.rule_break_even(ctx(base, {"fixed_cash_costs": row(years, [0, 30000, 30000, 30000]),
                                             "sales_volume_t": row(years, [0, 800, 800, 800], "ton")}, finance=fin))
    bad, be = rules.rule_break_even(ctx(base, {"fixed_cash_costs": row(years, [0, 90000, 30000, 30000]),
                                               "sales_volume_t": row(years, [0, 800, 800, 800], "ton")}, finance=fin))
    assert ok["status"] == "ok"
    assert bad["status"] == "flag" and be["below"][0]["year"] == 2028


# ── 1b. Reallıq ─────────────────────────────────────────────────────────────

def _bench(tmp_path, entry):
    import yaml
    path = tmp_path / "test.yaml"
    path.write_text(yaml.safe_dump({"sektor": "test", "gostericiler": [entry]}, allow_unicode=True), encoding="utf-8")
    return path


def test_mənbəsiz_benchmark_istifadə_edilmir(tmp_path):
    path = _bench(tmp_path, {"id": "tarif", "ad": "Tarif", "plan": "electricity_tariff", "vahid": "manat",
                             "min": 0.1, "max": 0.2, "menbe": "TODO: mənbə", "tarix": None})
    out = rules.reality(ctx({"electricity_tariff": fact(0.11, "manat/kVt·st")}), {}, path=path)
    assert out[0]["status"] == "skip" and "mənbəsi" in out[0]["result"]


def test_benchmark_diapazonu_və_usd_çevrilməsi(tmp_path):
    entry = {"id": "qiymet", "ad": "Qiymət", "plan": "price_avg_per_t", "vahid": "manat/t", "valyuta": "USD",
             "min": 300, "max": 400, "menbe": "Sınaq mənbəyi", "tarix": "2026-09"}
    path = _bench(tmp_path, entry)
    benchmarks.set_fx_override({"USD": 1.7, "date": "06.10.2026", "source": "AMB"})
    try:
        ok = rules.reality(ctx({"price_avg_per_t": fact(600, "manat/t")}), {}, path=path)[0]
        bad = rules.reality(ctx({"price_avg_per_t": fact(900, "manat/t")}), {}, path=path)[0]
    finally:
        benchmarks.set_fx_override(None)
    assert ok["status"] == "ok"                                          # 300–400 USD × 1,7 = 510–680 manat
    assert bad["status"] == "flag" and bad["question"]
    bench = next(n for n in bad["numbers"] if n["source"]["kind"] == "benchmark")
    assert bench["source"]["name"] == "Sınaq mənbəyi" and bench["source"]["converted"]["rate"] == 1.7


def test_məzənnə_yoxdursa_usd_benchmark_yoxlanılmır(tmp_path):
    path = _bench(tmp_path, {"id": "q", "ad": "Q", "plan": "price_avg_per_t", "valyuta": "USD", "min": 1, "max": 2,
                             "menbe": "M", "tarix": "2026"})
    out = rules.reality(ctx({"price_avg_per_t": fact(5, "manat/t")}), {}, path=path)    # testdə bazar söndürülüb
    assert out[0]["status"] == "skip" and "məzənnə" in out[0]["result"]


def test_layihədəki_benchmark_faylında_uydurma_rəqəm_və_mənbə_yoxdur():
    data = benchmarks.load()
    assert data["gostericiler"]
    for entry in data["gostericiler"]:
        assert str(entry["menbe"]).startswith("TODO")                   # komitə doldurur
        assert benchmarks._usable(entry) is not None                     # mənbəsiz — istifadə olunmur


# ── Risk səviyyəsi ──────────────────────────────────────────────────────────

def test_risk_səviyyəsi_qaydadır():
    f = lambda status, severity=None: {"status": status, "severity": severity, "title": "t", "group": "daxili"}  # noqa: E731
    c = ctx(finance=claimed_finance(flows=(-100, 60, 60, 60)))
    assert rules.risk_level([f("ok")], [], c)["level"] == "asagi"
    assert rules.risk_level([f("flag", "orta")], [], c)["level"] == "orta"
    assert rules.risk_level([f("ok")], [{"negative": True}], c)["level"] == "orta"
    assert rules.risk_level([f("ok")], [{"negative": True}, {"negative": True}], c)["level"] == "yuksek"
    assert rules.risk_level([f("flag", "yuksek")], [], c)["level"] == "yuksek"
    assert rules.risk_level([f("ok")], [], ctx(finance=claimed_finance(flows=(-100, 10, 10, 10))))["level"] == "yuksek"


# ── Yoxlama: AI-dan sitatsız rəqəm qəbul edilmir ────────────────────────────

DOC = {"sections": [{"id": "S1", "title": "Fərziyyələr", "text": "Debitor borcları 30 gün, kreditor borcları 45 gün."}],
       "tables": [table("T1", [["İnfrastruktur", "Həcm", "Tarif, manat", "Dəyər, manat"],
                               ["Elektrik enerjisi, kVt·st", "2 475 000", "0,110", "272 250"]]),
                  table("T2", [["Göstərici", "2028", "2029", "2030"], ["Satış həcmi, ton", "30 000", "45 000", "55 000"]])]}


def test_cədvəl_xanasının_rəqəmini_python_oxuyur_modelin_rəqəmi_yox():
    located = {"figures": [{"key": "electricity_tariff", "location": "T1", "quote": "Elektrik", "value": 999,
                            "row_label": "Elektrik enerjisi", "column": "Tarif"}]}
    facts = verify(DOC, located)
    assert facts["figures"]["electricity_tariff"]["value"] == pytest.approx(0.11)
    assert read_cell(DOC, "T1", "Elektrik", "Yoxdur")[2]                # sütun yoxdur — xəta


def test_sitatsız_və_ya_uyğunsuz_rəqəm_rədd_edilir():
    located = {"figures": [
        {"key": "receivable_days", "location": "S1", "quote": "Debitor borcları 30 gün", "value": 30},
        {"key": "payable_days", "location": "S1", "quote": "kreditor borcları 45 gün", "value": 60},
        {"key": "inventory_days", "location": "S1", "quote": "ehtiyat 90 gün", "value": 90},
        {"key": "staff_count", "location": "S1", "quote": "ştat 49", "value": None},
    ], "rows": [{"key": "sales_volume_t", "table_id": "T2", "row_label": "Satış həcmi"},
                {"key": "revenue", "table_id": "T2", "row_label": "Gəlir"}],
        "statements": [{"key": "no_loan", "location": "S1", "quote": "Kredit cəlb edilmir"}]}
    facts = verify(DOC, located)
    assert set(facts["figures"]) == {"receivable_days"}
    assert {r["key"] for r in facts["rejected"]} == {"payable_days", "inventory_days", "staff_count", "revenue", "no_loan"}
    assert facts["rows"]["sales_volume_t"]["values"] == [30000, 45000, 55000]


# ── Excel modeli ────────────────────────────────────────────────────────────

def make_excel(npv=1000000, irr=0.128, payback=6.9, error=True) -> bytes:
    from openpyxl import Workbook
    wb = Workbook()
    ws = wb.active
    ws.title = "Model"
    ws.append(["Göstərici", "Dəyər"])
    ws.append(["NPV, manat", npv])
    ws.append(["IRR", irr])
    ws.append(["Özünü ödəmə müddəti (PP)", payback])
    ws.append(["Ümumi investisiya", 13481000])
    ws.append(["Hesab", "=B2/B5"])
    if error:
        ws.append(["Xəta", "#DIV/0!"])
    buffer = io.BytesIO()
    wb.save(buffer)
    return buffer.getvalue()


def test_excel_modeli_plan_ilə_tutuşdurulur():
    plan = {"npv": 1225241, "irr_pct": 12.8, "payback_years": 6.9, "investment_total": 13481000, "revenue_y1": None}
    a = evidence.analyze_excel(make_excel(), plan)
    diffs = {d["key"]: d for d in a["diffs"]}
    assert diffs["npv"]["status"] == "fail" and diffs["npv"]["model"] == 1000000
    assert diffs["irr_pct"]["status"] == "ok" and diffs["irr_pct"]["model"] == pytest.approx(12.8)     # 0,128 → 12,8%
    assert diffs["payback_years"]["status"] == "ok" and diffs["investment_total"]["status"] == "ok"
    assert a["error_count"] == 1 and a["errors"][0]["value"] == "#DIV/0!"
    assert a["formula_cells"] == 1 and a["constant_cells"] == 4
    f = evidence.evidence_findings([{"id": "E1", "kind": "excel", "file_name": "m.xlsx", "doc_type": "excel_model",
                                     "analysis": a}])[0]
    assert f["status"] == "flag" and "NPV" in f["question"] and "#DIV/0!" in f["question"]


def test_sənəd_faktları_sitatla_yoxlanılır_və_tutuşdurulur():
    text = ("Kommersiya təklifi\nTərəf: Sinoma Engineering\nÜnvan: Demo Fertilizer Group MMC\n"
            "Məbləğ: 1 030 000\nValyuta: USD\nEtibarlıdır: 31.12.2025\n")
    raw = {"issuer": {"value": "Sinoma Engineering", "quote": "Tərəf: Sinoma Engineering"},
           "addressee": {"value": "Demo Fertilizer Group MMC", "quote": "Ünvan: Demo Fertilizer Group MMC"},
           "amount": {"value": "1 030 000", "quote": "Məbləğ: 1 030 000"},
           "currency": {"value": "USD", "quote": "Valyuta: USD"},
           "valid_until": {"value": "31.12.2025", "quote": "Etibarlıdır: 31.12.2025"},
           "volume_t": {"value": "5000", "quote": "Həcm: 5000 ton"}}                    # sitat sənəddə yoxdur
    v = evidence.verify_facts(text, raw)
    assert "volume_t" not in v["facts"] and v["rejected"][0]["key"] == "volume_t"
    benchmarks.set_fx_override({"USD": 1.7, "date": "06.10.2026", "source": "AMB"})
    try:
        checks = {c["id"]: c for c in evidence.document_checks(
            v, "kommersiya_teklifi", {"company": "Demo Fertilizer Group", "equipment_value": 1751000,
                                      "first_volume": 30000, "today": date(2026, 10, 6)})}
    finally:
        benchmarks.set_fx_override(None)
    assert checks["tereq"]["status"] == "ok"
    assert checks["mebleg"]["status"] == "ok"                           # 1 030 000 × 1,7 = 1 751 000
    assert checks["tarix"]["status"] == "flag"                          # müddəti bitib
    other = evidence.document_checks(v, None, {"company": "Caspian Fertilizer Group"})
    assert {c["id"]: c for c in other}["tereq"]["status"] == "ok"       # "Fertilizer" ortaqdır
    renamed = evidence.document_checks(v, None, {"company": "Başqa Kimya"})
    assert {c["id"]: c for c in renamed}["tereq"]["status"] == "flag"


# ── Tam axın: yoxlama → avtomatik iqtisadi təhlil → API ─────────────────────

@pytest.fixture()
def done_check(samples):
    from app import service
    storage.init()
    check_id = uuid.uuid4().hex[:12]
    storage.create(check_id, f"Plan {check_id}", 1, "plan_demo_v1.docx", str(samples / "plan_demo_v1.docx"), "")
    service.run_check(check_id)
    return check_id


def test_yoxlamadan_sonra_iqtisadi_təhlil_avtomatik_aparılır_status_dəyişmir(done_check, fake_llm):
    check = storage.get(done_check)
    econ = storage.econ_get(done_check)
    assert check["run_state"] == "tamamlandi" and econ["state"] == "tamamlandi", econ.get("error")
    assert fake_llm.call_log.count("economics") >= 1
    result = econ["result"]
    assert result["risk"]["level"] in ("asagi", "orta", "yuksek")
    ids = {f["id"]: f for f in result["findings"]}
    assert ids["dscr"]["status"] in ("ok", "flag")                     # demoda bank krediti var — hesablanır
    assert ids["amortizasiya"]["status"] == "ok"                       # 5 125 000 × 7% + 6 156 000 × 20%
    assert ids["capex_investisiya"]["status"] == "ok"
    assert all(n["source"]["kind"] in ("sened", "hesab", "benchmark") for f in result["findings"] for n in f["numbers"])
    for f in result["findings"]:                                       # sənəddən rəqəm — yeri və sitatı ilə
        for n in f["numbers"]:
            if n["source"]["kind"] == "sened" and n["value"] is not None:
                assert n["source"]["location"] and n["source"]["quote"]
    assert check["verdict"] in ("duzelis", "hazir_deyil", "hazir")      # uyğunluq statusu ayrıca qalır


def test_suallar_api_redaktə_status_silmə_və_məktub(done_check):
    from fastapi.testclient import TestClient

    from app.main import app
    client = TestClient(app)
    view = client.get(f"/api/checks/{done_check}/economics").json()
    assert view["state"] == "tamamlandi" and view["questions"]
    q = view["questions"][0]
    assert q["origin"] == "qayda" and q["status"] == "aciq"

    r = client.patch(f"/api/questions/{q['id']}", json={"text": "Komitənin dəqiqləşdirdiyi sual", "status": "cavab_gozlenilir"})
    assert r.status_code == 200 and r.json()["edited"] is True
    added = client.post(f"/api/checks/{done_check}/questions", json={"text": "Əlavə sual", "documents": ["excel_model"]}).json()
    assert added["origin"] == "komite"
    assert client.post(f"/api/checks/{done_check}/questions", json={"text": "  "}).status_code == 400
    assert client.patch(f"/api/questions/{q['id']}", json={"status": "bilinmir"}).status_code == 400

    # Yenidən hesab: komitənin mətni və statusu qorunur
    from app.economics import service as economics
    economics.reevaluate(done_check, {"kind": "test"})
    again = {x["id"]: x for x in client.get(f"/api/checks/{done_check}/economics").json()["questions"]}
    assert again[q["id"]]["text"] == "Komitənin dəqiqləşdirdiyi sual" and again[q["id"]]["status"] == "cavab_gozlenilir"

    letter = client.get(f"/api/checks/{done_check}/questions/letter.docx")
    assert letter.status_code == 200 and letter.content[:2] == b"PK"
    from docx import Document
    text = "\n".join(p.text for p in Document(io.BytesIO(letter.content)).paragraphs)
    assert "Komitənin dəqiqləşdirdiyi sual" in text and "Excel maliyyə modeli" in text

    assert client.delete(f"/api/questions/{added['id']}").status_code == 200
    assert client.delete(f"/api/questions/{added['id']}").status_code == 404


def _wait(check_id, evidence_id, seconds=10):
    end = time.time() + seconds
    while time.time() < end:
        item = storage.evidence_get(evidence_id)
        if item and (item.get("analysis") or {}).get("state") == "tamamlandi":
            return item
        time.sleep(0.05)
    raise AssertionError("analiz bitmədi")


def test_excel_yüklənəndə_plan_model_fərqləri_və_əvvəl_sonra(done_check):
    from fastapi.testclient import TestClient

    from app.main import app
    client = TestClient(app)
    r = client.post(f"/api/checks/{done_check}/evidence",
                    files={"file": ("CFG_Maliyye_Modeli.xlsx", make_excel(), "application/octet-stream")})
    assert r.status_code == 200, r.text
    item = _wait(done_check, r.json()["id"])
    assert item["doc_type"] == "excel_model"
    diffs = {d["key"]: d for d in item["analysis"]["diffs"]}
    assert diffs["npv"]["status"] == "fail"                            # plan 1 225 241 ↔ model 1 000 000
    view = client.get(f"/api/checks/{done_check}/economics").json()
    sened = [f for f in view["result"]["findings"] if f["group"] == "sened"]
    assert sened and sened[0]["status"] == "flag"
    last = view["history"][-1]
    assert last["trigger"]["file_name"] == "CFG_Maliyye_Modeli.xlsx"
    assert any(c["id"].startswith("sened:") and c["before"] is None for c in last["changes"])
    excel_q = [q for q in view["questions"] if q["finding_id"] == sened[0]["id"]]
    assert excel_q and "NPV" in excel_q[0]["text"]
    assert client.delete(f"/api/evidence/{item['id']}").status_code == 200
    assert not any(f["group"] == "sened" for f in client.get(f"/api/checks/{done_check}/economics").json()["result"]["findings"])


def test_pdf_docx_sənədi_suala_bağlanır_və_yoxlanılır(done_check):
    from docx import Document
    from fastapi.testclient import TestClient

    from app.main import app
    client = TestClient(app)
    questions = client.get(f"/api/checks/{done_check}/economics").json()["questions"]
    q = questions[0]
    document = Document()
    for line in ("Kommersiya təklifi", "Tərəf: Sinoma Engineering", "Ünvan: Başqa Şirkət MMC",
                 "Məbləğ: 1 751 000", "Valyuta: AZN", "Etibarlıdır: 31.12.2030"):
        document.add_paragraph(line)
    buffer = io.BytesIO()
    document.save(buffer)
    r = client.post(f"/api/checks/{done_check}/evidence",
                    data={"question_id": q["id"], "doc_type": "kommersiya_teklifi"},
                    files={"file": ("teklif.docx", buffer.getvalue(), "application/octet-stream")})
    assert r.status_code == 200, r.text
    item = _wait(done_check, r.json()["id"])
    checks = {c["id"]: c for c in item["analysis"]["checks"]}
    assert checks["tereq"]["status"] == "flag"                         # “Başqa Şirkət” ≠ Demo Fertilizer Group
    assert checks["mebleg"]["status"] == "ok" and checks["tarix"]["status"] == "ok"
    assert storage.question_get(q["id"])["status"] == "cavablandi"     # sənəd cavab kimi bağlandı


def test_şəkil_yalnız_mövcudluq_və_yanlış_format(done_check):
    from fastapi.testclient import TestClient

    from app.main import app
    client = TestClient(app)
    png = b"\x89PNG\r\n\x1a\n" + b"0" * 64
    r = client.post(f"/api/checks/{done_check}/evidence", data={"req_code": "LT3"},
                    files={"file": ("plan.png", png, "image/png")})
    item = _wait(done_check, r.json()["id"])
    assert item["req_code"] == "LT3" and item["analysis"]["kind"] == "sekil"
    bad = client.post(f"/api/checks/{done_check}/evidence", files={"file": ("x.exe", b"MZ", "application/octet-stream")})
    assert bad.status_code == 400


def test_iqtisadi_təhlil_yalnız_tamamlanmış_yoxlama_üçün(samples):
    from fastapi.testclient import TestClient

    from app.main import app
    storage.init()
    check_id = uuid.uuid4().hex[:12]
    storage.create(check_id, "Plan", 1, "plan_demo_v1.docx", str(samples / "plan_demo_v1.docx"), "")
    client = TestClient(app)
    assert client.post(f"/api/checks/{check_id}/economics").status_code == 409
    assert client.get(f"/api/checks/{check_id}/economics").json()["state"] == "gozleyir"


def test_plan_silinəndə_iqtisadi_məlumat_və_sənədlər_silinir(done_check):
    from app import service
    from app.economics import service as economics
    item = economics.add_evidence(done_check, "m.xlsx", make_excel(error=False))
    path = economics.evidence_dir() / item["stored"]
    assert path.exists()
    service.delete_plan(storage.get(done_check)["plan_id"])
    assert storage.econ_get(done_check) is None and storage.questions_list(done_check) == []
    assert storage.evidence_list(done_check) == [] and not path.exists()


# ── Sual ↔ tələb olunan sənəd (config/doc_requirements.yaml) ────────────────

from app.economics import catalog  # noqa: E402

EXPECTED_DOCS = {
    "maliyyelesme_menbeleri": ["bank_arayisi", "fond_tesdiqi"],
    "diskont_esaslandirma": [],
    "vergi_guzestleri": ["guzest_senedi"],
    "zerersizlik": ["satis_hecmi_muqavilesi"],
    "qaliq_deyer_payi": [],
    "irr_diskont_ferqi": [],
    "dovriyye_kapitali": [],
    "xammal_payi_bazasi": [],
    "hessasliq": [],
    "enerji_xerci": ["tarif_mektubu"],
    "dscr": ["kredit_teklifi"],
    "capex_investisiya": ["kommersiya_teklifi"],
    "zaman_xetti": ["kommersiya_teklifi", "torpaq_cixarisi"],
}
EXPECTED_SCENARIO_DOCS = {
    "price_-10": ["satis_muqavilesi", "qiymet_risk_plani"],
    "raw_+10": ["xammal_muqavilesi", "hedcinq_plani"],
    "capex_+15": ["kommersiya_teklifi", "gozlenilmez_xerc"],
    "capacity_80": ["niyyet_mektubu", "satis_hecmi_muqavilesi"],
    "delay_1y": [],
}


@pytest.mark.parametrize("rule_id, expected", sorted(EXPECTED_DOCS.items()))
def test_qayda_tipi_üçün_gözlənilən_sənədlər(rule_id, expected):
    assert catalog.rule_docs(rule_id) == expected


@pytest.mark.parametrize("scenario, expected", sorted(EXPECTED_SCENARIO_DOCS.items()))
def test_həssaslıq_ssenarisi_üçün_gözlənilən_sənədlər(scenario, expected):
    assert catalog.scenario_docs(scenario) == expected


def test_xəritə_tamdır_və_yalnız_tanınan_sənədlər_istifadə_olunur():
    data = catalog.doc_requirements()
    rule_ids = {r.__name__ for r in rules.INTERNAL_RULES}
    assert rule_ids                                                        # qaydalar mövcuddur
    produced = set(EXPECTED_DOCS) | {"gelir_hecm_qiymet", "hecm_guc", "guc_rampasi", "xammal_xerci",
                                     "emek_haqqi_fondu", "amortizasiya", "proqnoz_ufuqu"}
    assert produced <= set(data["qaydalar"])                              # hər qaydanın sətri var
    from app.economics.sensitivity import SCENARIOS
    assert {sid for sid, _t, _f in SCENARIOS} == set(data["hessasliq_ssenarileri"])
    for section in ("qaydalar", "hessasliq_ssenarileri", "realliq"):
        for key, docs in data[section].items():
            assert set(docs or []) <= set(catalog.DOCUMENTS), (section, key)
    # həssaslıq sualı niyyət məktubu + kommersiya təklifi cütünü TƏLƏB ETMİR (köhnə xəta)
    assert catalog.rule_docs("hessasliq") == []


def test_hər_npv_mənfi_ssenarisi_ayrıca_sual_və_öz_sənədi():
    years = [2027, 2028, 2029, 2030]
    fragile = claimed_finance(flows=(-1000, 380, 380, 380), practical_capacity_t=1000)
    rows_ = {"revenue": row(years, [0, 2000, 2000, 2000]), "raw_material_cost": row(years, [0, 1000, 1000, 1000]),
             "sales_volume_t": row(years, [0, 1000, 1000, 1000], "ton")}
    result = rules.evaluate(EMPTY, {"figures": {"margin_per_t": fact(1, "manat/t")}, "rows": rows_, "statements": {}},
                            fragile)
    by_id = {f["id"]: f for f in result["findings"]}
    assert by_id["hessasliq"]["question"] is None and by_id["hessasliq"]["documents"] == []
    price, raw = by_id["hessasliq:price_-10"], by_id["hessasliq:raw_+10"]
    assert price["documents"] == ["satis_muqavilesi", "qiymet_risk_plani"] and "qiymət" in price["question"].lower()
    assert raw["documents"] == ["xammal_muqavilesi", "hedcinq_plani"]
    assert all("niyyet_mektubu" not in f["documents"] for f in (price, raw))
    assert result["risk"]["level"] == "yuksek"                           # risk dəyişmir — ümumi tapıntıdan


def test_sualı_olmayan_tapıntıya_sənəd_bağlanmır():
    assert rules.required_documents({"id": "vergi_guzestleri", "group": "daxili", "question": None}) == []
    assert rules.required_documents({"id": "realliq:x", "group": "realliq", "plan_key": "gas_tariff", "question": "?"}) == ["tarif_mektubu"]


def test_toxunulmamış_köhnə_qayda_sualı_silinir_toxunulmuşu_qalır():
    from app.economics import questions
    storage.init()
    check = {"id": uuid.uuid4().hex[:12], "plan_id": "p-test"}
    findings = [{"id": "a", "group": "daxili", "question": "A?", "severity": "orta", "documents": []},
                {"id": "b", "group": "daxili", "question": "B?", "severity": "orta", "documents": []}]
    questions.sync(check, findings)
    qid_b = questions.rule_question_id(check["id"], "b")
    questions.update(qid_b, {"status": "cavab_gozlenilir"})
    after = {q["finding_id"]: q for q in questions.sync(check, [])}
    assert "a" not in after                                               # açıq, redaktəsiz — silindi
    assert after["b"]["stale"] is True                                     # komitə toxunub — saxlanıldı


# ── Həssaslıq: sıfır həddi və baza sətri (kodun hesabı) ─────────────────────

def test_sıfır_həddi_npv_ni_həqiqətən_sıfıra_endirir():
    from app.economics import sensitivity
    from app.finance_tools import npv
    flows = [-1000.0, 450.0, 450.0, 450.0]                              # baza NPV > 0 (≈ 119)
    revenue = [0.0, 2000.0, 2000.0, 2000.0]
    raw = [0.0, 1000.0, 1000.0, 1000.0]
    volume = [0.0, 1000.0, 1000.0, 1000.0]
    rate = 10.0
    rows = {r["id"]: r for r in sensitivity.scenarios(YEARS, flows, rate, revenue, raw, volume, 1.0, 1000.0)}
    price = rows["price_-10"]["threshold"]
    assert price["kind"] == "change" and price["value"] < 0
    assert abs(npv(rate, [f + price["value"] / 100 * r for f, r in zip(flows, revenue)])) < 1e-6
    raw_t = rows["raw_+10"]["threshold"]["value"]
    assert abs(npv(rate, [f - raw_t / 100 * m for f, m in zip(flows, raw)])) < 1e-6
    capex = rows["capex_+15"]["threshold"]["value"]
    assert abs(npv(rate, [flows[0] * (1 + capex / 100), *flows[1:]])) < 1e-6
    assert rows["delay_1y"]["threshold"] is None                         # gecikmənin kəsilməz həddi yoxdur


def test_güc_istifadəsinin_sıfır_həddi_bisection_ilə():
    from app.economics import sensitivity
    from app.finance_tools import npv
    flows = [-1000.0, 600.0, 600.0, 600.0]
    volume = [0.0, 1000.0, 1000.0, 1000.0]
    t = sensitivity.zero_threshold("capacity_80", flows, 10.0, None, None, volume, 1.0, 1000.0)
    assert t["kind"] == "level" and 0 < t["value"] < 100
    cap = t["value"] / 100 * 1000.0
    assert abs(npv(10.0, [f - (v - min(v, cap)) * 1.0 for f, v in zip(flows, volume)])) < 1e-3


def test_baza_npv_mənfidirsə_hədd_yoxdur_və_baza_sətri():
    from app.economics import sensitivity
    assert sensitivity.zero_threshold("price_-10", [-1000.0, 10.0], 10.0, [0.0, 100.0], None, None, None, None) is None
    base = sensitivity.base_case([-1000.0, 600.0, 600.0], 10.0)
    assert round(base["npv"], 2) == round(-1000 + 600 / 1.1 + 600 / 1.21, 2) and base["irr"] > 10
    out = rules.evaluate(EMPTY, {"figures": {}, "rows": {}, "statements": {}}, claimed_finance())
    assert out["sensitivity"]["base"]["npv"] == pytest.approx(-1000 + 300 / 1.1 + 400 / 1.21 + 500 / 1.331)
