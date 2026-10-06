"""finance_tools.py və maliyyə subgraph-ı.

Gözlənilən dəyərlər orijinal CFG planı ilə yoxlanılıb:
investisiya 13 481 000 = 11 281 000 + 2 200 000; mənbələr 6 181 000 + 5 400 000
+ 1 900 000; 10 t/saat × 8 × 3 × 300 = 72 000 t, 80% -> 57 600 t;
WACC 11,49%; NPV 1 225 241; IRR 12,8%; PP 6,9 il.
Hesablanan: NPV ≈ 1 226 599, IRR ≈ 12,78%, PP ≈ 6,96 il.
"""
from __future__ import annotations

import pytest

from app import config
from app.agents.finance import build_finance_graph
from app.finance_tools import (irr, npv, payback, provenance, read_row, refine_rate,
                               run_checks)
from app.ingest import parse_docx
from tests.fake_llm import CFG_FIGURES, FakeChatModel, with_citations
from tests.synthetic import build_doc

FLOWS = [-13481000, -1496452, 68811, 1841830, 3326339, 3326339,
         3265158, 3265158, 3265158, 3265158, 14129627]


@pytest.fixture(scope="module")
def doc(samples):
    return parse_docx(samples / "plan_demo_v1.docx")


def _by_id(checks):
    return {c["id"]: c for c in checks}


# ── read_row ───────────────────────────────────────────────────────────────

def test_read_row_baza_ssenarini_götürür(doc):
    """Cədvəldə iki ssenari var; BİRİNCİ (güzəştli) sətir götürülməlidir."""
    row = read_row(doc, "T27", "Sərbəst pul axını (FCFF)")
    assert row["ok"]
    assert row["years"][0] == 2027 and row["years"][-1] == 2037
    assert row["values"] == pytest.approx(FLOWS)


def test_read_row_tire_sıfır_deməkdir(doc):
    row = read_row(doc, "T27", "İnvestisiya qoyuluşu")
    assert row["values"][0] == pytest.approx(-13481000)
    assert row["values"][1:] == [0.0] * 10          # hamısı "–"


def test_read_row_xəta_atmır_mətn_qaytarır(doc):
    assert read_row(doc, "T999", "EBITDA")["ok"] is False
    assert "Mövcud id-lər" in read_row(doc, "T999", "EBITDA")["error"]
    assert "Mövcud sətirlər" in read_row(doc, "T27", "Belə sətir yoxdur")["error"]
    assert read_row(doc, None, "EBITDA")["ok"] is False


# ── Riyaziyyat ─────────────────────────────────────────────────────────────

def test_npv_irr_payback():
    assert npv(11.49, FLOWS) == pytest.approx(1226598.6, abs=1.0)
    assert irr(FLOWS) == pytest.approx(12.7812, abs=0.001)
    assert payback(FLOWS) == pytest.approx(6.9644, abs=0.001)


def test_irr_işarə_dəyişmirsə_none():
    assert irr([100, 200, 300]) is None
    assert payback([-100, -50]) is None


# ── Mənbə yoxlaması ────────────────────────────────────────────────────────

def test_provenance_sənəddə_olmayan_rəqəmi_atır(doc):
    figures = dict(CFG_FIGURES, npv=9_999_999)
    clean, not_found = provenance(doc, with_citations(figures))
    assert clean["npv"] is None
    assert [n["field"] for n in not_found] == ["npv"]
    assert clean["investment_total"] == 13481000   # digərləri toxunulmur


def test_uydurma_npv_yoxlamanı_skip_edir(doc):
    clean, _ = provenance(doc, with_citations(dict(CFG_FIGURES, npv=9_999_999)))
    checks = _by_id(run_checks(doc, clean)["checks"])
    assert checks["npv"]["status"] == "skip"
    assert "tapılmadı" in checks["npv"]["detail"]


def test_provenance_mənbə_məbləğini_də_yoxlayır(doc):
    figures = dict(CFG_FIGURES)
    figures["sources"] = [{"name": "Uydurma mənbə", "amount": 7_777_777}]
    clean, not_found = provenance(doc, with_citations(figures))
    assert clean["sources"][0]["amount"] is None
    assert not_found[0]["label"].startswith("Mənbə:")


# ── 7 yoxlama ──────────────────────────────────────────────────────────────

def test_bütün_yoxlamalar_gözlənilən_statusda(doc):
    clean, not_found = provenance(doc, with_citations(CFG_FIGURES))
    assert not_found == []
    checks = _by_id(run_checks(doc, clean)["checks"])
    assert len(checks) == 7
    statuses = {k: v["status"] for k, v in checks.items()}
    assert statuses == {
        "investisiya_cemi": "ok",
        "menbeler_cemi": "ok",
        "guc": "ok",
        "fcff_dusturu": "ok",
        "npv": "ok",
        "irr": "ok",
        "pp": "warn",          # 6,96 -> 7,0, planda 6,9
    }


def test_hesablanan_dəyərlər(doc):
    clean, _ = provenance(doc, with_citations(CFG_FIGURES))
    checks = _by_id(run_checks(doc, clean)["checks"])
    assert checks["npv"]["computed"] == pytest.approx(1226599, abs=1)
    assert checks["irr"]["computed"] == pytest.approx(12.78, abs=0.01)
    assert checks["pp"]["computed"] == pytest.approx(6.96, abs=0.01)


def test_pp_izahı_yuvarlaqlaşdırmanı_açıqlayır(doc):
    clean, _ = provenance(doc, with_citations(CFG_FIGURES))
    detail = _by_id(run_checks(doc, clean)["checks"])["pp"]["detail"]
    assert "6,96" in detail and "7,0" in detail and "6,9" in detail


def test_kritik_yoxlamalar_işarələnib(doc):
    clean, _ = provenance(doc, with_citations(CFG_FIGURES))
    critical = {c["id"] for c in run_checks(doc, clean)["checks"] if c["critical"]}
    assert critical == {"investisiya_cemi", "menbeler_cemi", "npv"}


def test_hər_yoxlamanın_qaydası_və_mənbəsi_var(doc):
    clean, _ = provenance(doc, with_citations(CFG_FIGURES))
    for check in run_checks(doc, clean)["checks"]:
        assert check["rule"], check["id"]
        assert check["detail"], check["id"]


# ── Dərəcənin dəqiqləşdirilməsi ────────────────────────────────────────────

def _recite(figures, field, location, quote):
    """Bir sahənin mənbəyini əvəz edir."""
    out = with_citations(figures)
    out["citations"] = [c for c in out["citations"] if c["field"] != field]
    out["citations"].append({"field": field, "location": location, "quote": quote})
    return out


#: Agent S42-dəki yuvarlaq 11,5%-i götürüb (real modellə müşahidə olunub).
ROUNDED_RATE = _recite(dict(CFG_FIGURES, discount_rate_pct=11.5),
                       "discount_rate_pct", "S42", "diskont dərəcəsini (11,5%)")

def test_yuvarlaq_dərəcə_dəqiqi_ilə_əvəz_olunur(doc):
    """Cədvəldə 11,5%, WACC düsturunda 11,49% — agent 11,5 götürsə də 11,49 işlənir."""
    clean, _ = provenance(doc, ROUNDED_RATE)
    refined = refine_rate(doc, clean)
    assert refined["discount_rate_pct"] == 11.49
    assert refined["discount_rate_refined_from"] == 11.5
    check = _by_id(run_checks(doc, refined)["checks"])["npv"]
    assert check["computed"] == pytest.approx(1226599, abs=1)
    assert "11,5%" in check["detail"] and "daha dəqiq" in check["detail"]


def test_dəqiq_dərəcəyə_toxunulmur(doc):
    clean, _ = provenance(doc, with_citations(CFG_FIGURES))
    refined = refine_rate(doc, clean)
    assert refined["discount_rate_pct"] == 11.49
    assert "discount_rate_refined_from" not in refined


def test_dərəcə_yalnız_wacc_sətrindən_götürülür():
    """Açar sözü olmayan sətirdəki 11,49% nəzərə alınmır; namizəd ikidirsə dəyişmir."""
    def make(*lines):
        return {"sections": [{"id": "S1", "title": "", "text": "\n".join(lines)}],
                "tables": []}

    assert "discount_rate_refined_from" not in refine_rate(
        make("Rentabellik 11,49% təşkil edir.", "Diskont dərəcəsi 11,5%."),
        {"discount_rate_pct": 11.5})
    assert "discount_rate_refined_from" not in refine_rate(
        make("WACC 11,49%.", "Diskont dərəcəsi 11,46%."),
        {"discount_rate_pct": 11.5})
    assert refine_rate(make("WACC = 11,49%."), {"discount_rate_pct": 11.5})[
        "discount_rate_pct"] == 11.49


def test_subgraph_dərəcəni_dəqiqləşdirir(doc):
    config.set_llm_override(FakeChatModel(figures=ROUNDED_RATE))
    state = build_finance_graph().invoke({"doc": doc})
    assert state["claimed"]["discount_rate_pct"] == 11.49
    assert _by_id(state["checks"])["npv"]["computed"] == pytest.approx(1226599, abs=1)


# ── Pozulmuş planlar ───────────────────────────────────────────────────────

def test_saxta_npv_uyğunsuzluq_verir(samples):
    """Sənəddə NPV 2 225 241 yazılıb, FCFF sətri isə dəyişməyib."""
    fake_doc = parse_docx(samples / "plan_demo_saxta.docx")
    clean, not_found = provenance(fake_doc, with_citations(dict(CFG_FIGURES, npv=2225241)))
    assert not_found == []                      # rəqəm sənəddə HƏQİQƏTƏN var
    check = _by_id(run_checks(fake_doc, clean)["checks"])["npv"]
    assert check["status"] == "fail"
    assert check["critical"] is True


def test_qırıq_planda_pul_axını_yoxlamaları_skip(samples):
    broken = parse_docx(samples / "plan_demo_qiriq.docx")
    clean, _ = provenance(broken, with_citations(dict(CFG_FIGURES, cashflow_table_id=None)))
    checks = _by_id(run_checks(broken, clean)["checks"])
    for check_id in ("fcff_dusturu", "npv", "irr", "pp"):
        assert checks[check_id]["status"] == "skip", check_id
        assert "Yoxlanıla bilmədi" in checks[check_id]["detail"]
    # Cədvəldən asılı olmayanlar işləməyə davam edir
    assert checks["investisiya_cemi"]["status"] == "ok"


# ── Subgraph ───────────────────────────────────────────────────────────────

def test_subgraph_tam_işləyir(doc, fake_llm):
    state = build_finance_graph().invoke({"doc": doc})
    assert state["claimed"]["investment_total"] == 13481000
    assert state["not_found"] == []
    assert len(state["checks"]) == 7
    assert state["cashflow"]["ok"] is True
    # Agent əvvəlcə alət çağırıb, sonra struktur cavab verib
    assert fake_llm.call_log.count("finance") == 2


def test_subgraph_struktur_cavab_olmasa_xəta_verir(doc):
    class Boş(FakeChatModel):
        def _generate(self, messages, stop=None, run_manager=None, **kwargs):
            from langchain_core.messages import AIMessage
            from langchain_core.outputs import ChatGeneration, ChatResult
            return ChatResult(generations=[ChatGeneration(message=AIMessage(content="yox"))])

    config.set_llm_override(Boş())
    with pytest.raises(RuntimeError, match="struktur cavab"):
        build_finance_graph().invoke({"doc": doc})


# ── Oxunmayan xanalar (yoxlama hesabatı, problem 1) ────────────────────────

ROWS = {"cashflow_table_id": "T1", "row_investment": "İnvestisiya", "row_ebitda": "EBITDA",
        "row_tax": "Vergi", "row_wc_change": "Dövriyyə", "row_residual": "Qalıq",
        "row_fcff": "FCFF"}


def _cashflow_doc(tmp_path, ebitda=("–", "50", "60", "70"), fcff=("(100)", "50", "60", "60")):
    return build_doc(tmp_path, [
        ("h", "8. Pul axını"),
        ("t", [["Göstərici", "2027", "2028", "2029", "2030"],
               ["İnvestisiya", "(100)", "–", "–", "–"],
               ["EBITDA", *ebitda],
               ["Vergi", "–", "–", "–", "(10)"],
               ["Dövriyyə", "–", "–", "–", "–"],
               ["Qalıq", "–", "–", "–", "–"],
               ["FCFF", *fcff]]),
    ])


def _fcff(doc):
    return _by_id(run_checks(doc, dict(ROWS))["checks"])["fcff_dusturu"]


def test_tire_sıfırdır_tam_cədvəl_uyğundur(tmp_path):
    check = _fcff(_cashflow_doc(tmp_path))
    assert check["status"] == "ok"
    assert check["unread_years"] == []


@pytest.mark.parametrize("cell", ["", "məlumat yoxdur"])
def test_boş_və_mətnli_xana_sıfır_sayılmır(tmp_path, cell):
    doc = _cashflow_doc(tmp_path, ebitda=("–", "50", cell, "70"))
    row = read_row(doc, "T1", "EBITDA")
    assert row["values"][2] is None
    assert row["missing"] == [2029]

    check = _fcff(doc)
    assert check["status"] == "skip"                 # tam yoxlanılmayıb — ok deyil
    assert check["unread_years"] == [2029]
    assert "2029" in check["detail"]


def test_bütün_komponentləri_oxunmayan_il(tmp_path):
    doc = build_doc(tmp_path, [
        ("h", "8. Pul axını"),
        ("t", [["Göstərici", "2027", "2028", "2029"],
               ["İnvestisiya", "(100)", "", "–"],
               ["EBITDA", "–", "", "60"],
               ["Vergi", "–", "", "–"],
               ["Dövriyyə", "–", "", "–"],
               ["Qalıq", "–", "", "–"],
               ["FCFF", "(100)", "50", "60"]]),
    ])
    check = _fcff(doc)
    assert check["status"] == "skip"
    assert check["unread_years"] == [2028]


def test_oxunan_ildə_fərq_varsa_oxunmayan_il_olsa_da_fail(tmp_path):
    doc = _cashflow_doc(tmp_path, ebitda=("–", "50", "", "70"),
                        fcff=("(100)", "55", "60", "60"))
    check = _fcff(doc)
    assert check["status"] == "fail"
    assert check["unread_years"] == [2029]


# ── Mənbəyə bağlı yoxlama (yoxlama hesabatı, problem 2) ────────────────────

@pytest.fixture()
def cited_doc(tmp_path):
    return build_doc(tmp_path, [
        ("h", "9. Səmərəlilik"),
        ("p", "Nizamnamə kapitalı 1 225 241 manatdır."),
        ("p", "Güzəştli ssenaridə NPV müsbətdir (1 225 241 manat), IRR (12,8%) "
              "diskont dərəcəsini (11,5%) üstələyir."),
        ("t", [["Göstərici", "Güzəştlərlə", "Güzəştsiz"],
               ["Xalis cari dəyər (NPV), manat", "1 225 241", "(1 196 310)"]]),
    ])


def _npv(doc, value, location, quote):
    figures = {"npv": value, "citations": [
        {"field": "npv", "location": location, "quote": quote}]}
    return provenance(doc, figures)


def test_düzgün_mənbə_təsdiqlənir(cited_doc):
    clean, not_found = _npv(cited_doc, 1225241, "T1", "Xalis cari dəyər (NPV), manat | 1 225 241")
    assert not_found == []
    assert clean["npv"] == 1225241
    assert clean["provenance"]["npv"]["location"] == "T1"


def test_eyni_rəqəm_başqa_göstəricidə_qəbul_edilmir(cited_doc):
    """Rəqəm sənəddə VAR, amma 'Nizamnamə kapitalı'na aiddir."""
    section = cited_doc["sections"][-1]["id"]
    clean, not_found = _npv(cited_doc, 1225241, section, "Nizamnamə kapitalı 1 225 241 manatdır")
    assert clean["npv"] is None
    assert "göstəricinin adı" in not_found[0]["reason"]


def test_eyni_cümlədə_başqa_göstəricinin_rəqəmi_qəbul_edilmir(cited_doc):
    """'IRR (12,8%)' sitatı NPV kimi verilə bilməz — NPV-yə ən yaxın rəqəm 1 225 241-dir."""
    section = cited_doc["sections"][-1]["id"]
    figures = {"irr_pct": 11.5, "citations": [{
        "field": "irr_pct", "location": section,
        "quote": "IRR (12,8%) diskont dərəcəsini (11,5%)"}]}
    clean, not_found = provenance(cited_doc, figures)
    assert clean["irr_pct"] is None
    assert "uyğun deyil" in not_found[0]["reason"]


def test_mənfi_işarənin_dəyişməsi_qəbul_edilmir(cited_doc):
    clean, not_found = _npv(cited_doc, -1225241, "T1", "Xalis cari dəyər (NPV), manat | 1 225 241")
    assert clean["npv"] is None
    assert "işarəsi" in not_found[0]["reason"]


def test_başqa_ssenarinin_xanası_qəbul_edilmir(cited_doc):
    """Bütün sətir sitat gətirilsə də, NPV-yə ən yaxın rəqəm baza ssenaridir."""
    quote = "Xalis cari dəyər (NPV), manat | 1 225 241 | (1 196 310)"
    clean, _ = _npv(cited_doc, -1196310, "T1", quote)
    assert clean["npv"] is None
    clean, _ = _npv(cited_doc, 1225241, "T1", quote)
    assert clean["npv"] == 1225241


def test_sitat_başqa_yerdədirsə_və_ya_yoxdursa(cited_doc):
    first = cited_doc["sections"][0]["id"]
    _, not_found = _npv(cited_doc, 1225241, first, "Xalis cari dəyər (NPV), manat | 1 225 241")
    assert "hərfi" in not_found[0]["reason"]
    _, not_found = _npv(cited_doc, 1225241, "T99", "NPV 1 225 241")
    assert "yoxdur" in not_found[0]["reason"]
    _, not_found = provenance(cited_doc, {"npv": 1225241})
    assert "göstərilməyib" in not_found[0]["reason"]


# ── Natamam mənbələr və dəqiqlik (yoxlama hesabatı, problem 10–11) ─────────

def test_məbləği_olmayan_mənbə_varsa_cəm_təsdiqlənmir(doc):
    """Üç mənbədən birinin məbləği yoxdur — qalan ikisini toplamaq yanlış fail verərdi."""
    figures = with_citations(CFG_FIGURES)
    figures["sources"][2] = {"name": "Dövriyyə krediti (revolver)", "amount": None}
    clean, _ = provenance(doc, figures)
    check = _by_id(run_checks(doc, clean)["checks"])["menbeler_cemi"]
    assert check["status"] == "skip"
    assert "Dövriyyə krediti" in check["detail"]


def test_mənbəsi_təsdiqlənməyən_mənbə_də_cəmi_dayandırır(doc):
    figures = with_citations(CFG_FIGURES)
    figures["sources"][0]["quote"] = "Uydurma sitat 6 181 000"
    clean, not_found = provenance(doc, figures)
    assert any(n["label"].startswith("Mənbə:") for n in not_found)
    assert _by_id(run_checks(doc, clean)["checks"])["menbeler_cemi"]["status"] == "skip"


def test_fcff_oxunmayan_xananın_sətri_və_ili_göstərilir(tmp_path):
    doc = _cashflow_doc(tmp_path, ebitda=("–", "50", "", "70"))
    check = _fcff(doc)
    assert check["unread_cells"] == [{"year": 2029, "rows": ["EBITDA"]}]
    assert "2029 — EBITDA" in check["detail"]


@pytest.fixture()
def pp_doc(tmp_path):
    """FCFF: PP = 6 + 10/16 ≈ 6,63 il. Planda "7,0 il" və ya "7 il" yazılıb."""
    def make(written):
        return build_doc(tmp_path, [
            ("h", "8. Pul axını"),
            ("p", f"Özünü ödəmə müddəti (PP) {written} il."),
            ("t", [["Göstərici", "2027", "2028", "2029", "2030", "2031", "2032", "2033", "2034"],
                   ["FCFF", "(100)", "15", "15", "15", "15", "15", "15", "16"]]),
        ], name=f"pp_{written}.docx")
    return make


def _pp(doc, written):
    section = doc["sections"][-1]["id"]
    figures = {"payback_years": 7.0, "cashflow_table_id": "T1", "row_fcff": "FCFF",
               "citations": [{"field": "payback_years", "location": section,
                              "quote": f"Özünü ödəmə müddəti (PP) {written} il"}]}
    clean, _ = provenance(doc, figures)
    return _by_id(run_checks(doc, clean)["checks"])["pp"]


def test_7_vergül_0_bir_onluq_dəqiqliklə_müqayisə_olunur(pp_doc):
    """Hesablanan ~6,63 il: "7" yazılıbsa 7-yə yuvarlanır (ok), "7,0" yazılıbsa 6,6 ≠ 7,0."""
    assert _pp(pp_doc("7"), "7")["status"] == "ok"
    check = _pp(pp_doc("7,0"), "7,0")
    assert check["status"] != "ok"
    assert "6,6" in check["detail"] and "7,0" in check["detail"]


def test_yarım_yuxarı_yuvarlaqlaşdırma():
    from app.finance_tools import round_half_up
    assert round_half_up(6.95, 1) == 7.0          # round(6.95, 1) == 6.9 olardı
    assert round_half_up(12.85, 1) == 12.9


# ── Qrafik məlumatı (Mərhələ 3) ────────────────────────────────────────────

def test_qrafik_məlumatı_python_da_hesablanır(doc):
    from app.finance_tools import chart_data

    clean, _ = provenance(doc, with_citations(CFG_FIGURES))
    outcome = run_checks(doc, clean)
    charts = chart_data(clean, outcome["cashflow"])
    assert charts["fcff"]["values"] == pytest.approx(FLOWS)
    assert charts["fcff"]["years"][0] == 2027 and charts["fcff"]["source"] == "T27"
    assert charts["cumulative"]["values"][-1] == pytest.approx(sum(FLOWS))
    assert [p["value"] for p in charts["funding"]["parts"]] == [6181000, 5400000, 1900000]
    assert charts["funding"]["parts"][0]["source"] == "T14"
    assert charts["investment"]["parts"][0]["source"] == "S28"


def test_məlumat_yoxdursa_qrafik_uydurulmur(doc):
    from app.finance_tools import chart_data

    figures = with_citations(dict(CFG_FIGURES, cashflow_table_id=None))
    figures["sources"][1]["amount"] = None
    clean, _ = provenance(doc, figures)
    charts = chart_data(clean, run_checks(doc, clean)["cashflow"])
    assert charts["fcff"]["available"] is False and charts["fcff"]["reason"]
    assert charts["cumulative"]["available"] is False
    assert charts["funding"]["available"] is False
    assert charts["investment"]["available"] is True


def test_bölgü_payları_python_da(doc):
    from app.finance_tools import chart_data

    clean, _ = provenance(doc, with_citations(CFG_FIGURES))
    charts = chart_data(clean, run_checks(doc, clean)["cashflow"])
    assert charts["funding"]["total"] == 13481000
    assert sum(p["share"] for p in charts["funding"]["parts"]) == pytest.approx(1.0)
    assert charts["investment"]["parts"][0]["share"] == pytest.approx(11281000 / 13481000)


# ── Real model ilə aşkarlanan hallar (5 oktyabr 2026, claude-sonnet-5) ─────

def _one(doc, field, value, location, quote):
    from app.finance_tools import FIELD_KEYWORDS, verify_citation
    return verify_citation(doc, field, value, location, quote, FIELD_KEYWORDS[field])


def test_real_model_növbə_sitatında_bərabərlik(doc):
    """Model: '3 növbə (növbə 8 saat)'. 3 və 8 'növbə'yə eyni məsafədədir — say isimdən əvvəl gəlir."""
    assert _one(doc, "shifts_per_day", 3, "S10", "3 növbə (növbə 8 saat)") is None
    assert _one(doc, "shifts_per_day", 8, "S10", "3 növbə (növbə 8 saat)") is not None
    assert _one(doc, "shift_hours", 8, "S10", "növbə 8 saat") is None


def test_real_model_üç_nöqtəli_sitat(doc):
    """Model: 'Diskont dərəcəsi (WACC) = ... = 11,49%' — formulun ortası buraxılıb."""
    assert _one(doc, "discount_rate_pct", 11.49, "S35", "Diskont dərəcəsi (WACC) = ... = 11,49%") is None
    assert _one(doc, "discount_rate_pct", 11.49, "S35", "Diskont dərəcəsi (WACC) … = 11,49%") is None


def test_üç_nöqtə_hissələri_uydurmağa_icazə_vermir(doc):
    # hissələrin sırası dəyişib
    assert _one(doc, "discount_rate_pct", 11.49, "S35", "= 11,49% ... Diskont dərəcəsi (WACC)") is not None
    # hissələrdən biri sənəddə yoxdur
    assert _one(doc, "discount_rate_pct", 11.49, "S35", "Diskont dərəcəsi (WACC) = ... = 12,49%") is not None
    assert _one(doc, "discount_rate_pct", 11.49, "S35", "...") is not None


def test_ayırıcı_atılsa_da_qonşu_xanalar_birləşmir(tmp_path):
    """Tutuşdurmada '|' nəzərə alınmır, amma rəqəmlər ayırıcılı mətndən oxunur: 15 | 300 ≠ 15300."""
    doc = build_doc(tmp_path, [("h", "Güc"), ("t", [["Göstərici", "Dəyər", "Gün"],
                                                    ["Növbə sayı", "15", "300"]])])
    assert _one(doc, "shifts_per_day", 15300, "T1", "Növbə sayı | 15 | 300") is not None
    assert _one(doc, "shifts_per_day", 15, "T1", "Növbə sayı | 15") is None
