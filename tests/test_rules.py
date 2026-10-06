"""Nəticə qaydaları: tətbiq şərti, cədvəl sətrinə görə məbləğ, mənbələr cəmində dəqiqləşdirmə,
saxlanmış hesabatın yenidən qiymətləndirilməsi. Real model çağırılmır."""
from __future__ import annotations

import copy
import uuid

import pytest

from app import config, rules, service, storage
from app.agents.compliance import build_compliance_graph, requirement_index
from app.finance_tools import _source_keywords, verify_citation
from app.ingest import parse_docx
from app.verdict import decide
from tests.fake_llm import FakeChatModel

EXCLUSION = "Layihə təsisçilərin vəsaiti ilə maliyyələşir. Bank krediti cəlb edilmir; borc yoxdur."


@pytest.fixture(scope="module")
def doc(samples):
    return parse_docx(samples / "plan_demo_v1.docx")


def _with_text(doc, text):
    new = copy.deepcopy(doc)
    new["sections"].append({"id": "S900", "title": "7.9. Maliyyələşmə", "level": 2, "text": text, "table_ids": []})
    return new


def _item(req_id, status, **extra):
    return {"req_id": req_id, "status": status, "sections": [], "quote": None, "missing": "x", **extra}


# ── Tətbiq şərti ───────────────────────────────────────────────────────────

def test_kredit_açıq_istisna_ediləndə_tətbiq_edilmir(doc):
    out = rules.apply_conditions(_with_text(doc, EXCLUSION), [_item("IP2", "yoxdur")], requirement_index())[0]
    assert out["status"] == "tetbiq_edilmir"
    assert out["quote"] == "Bank krediti cəlb edilmir"                       # hərfi sitat, sənəddən
    assert out["sections"][0]["id"] == "S900" and out["missing"] is None
    assert out["condition"]["status_before"] == "yoxdur"


def test_şərt_haqqında_susan_planda_kredit_tələbi_istisna_edilmir(doc):
    out = rules.apply_conditions(doc, [_item("IP2", "yoxdur")], requirement_index())[0]
    assert out["status"] == "yoxdur"                                       # avtomatik istisna YOXDUR


def test_agent_tətbiq_edilmir_deyib_sübut_yoxdursa_dəqiqləşdirmə(doc):
    out = rules.apply_conditions(doc, [_item("IP2", "tetbiq_edilmir")], requirement_index())[0]
    assert out["status"] == "natamam" and out["clarify"] is True
    assert out["missing"].startswith(rules.CLARIFY_PREFIX)


def test_şərtsiz_tələbə_toxunulmur_və_var_qalır(doc):
    text = _with_text(doc, EXCLUSION)
    out = rules.apply_conditions(text, [_item("IP1", "yoxdur"), _item("IP2", "var")], requirement_index())
    assert [o["status"] for o in out] == ["yoxdur", "var"]


def test_tətbiq_edilməyən_tələb_statusu_pisləşdirmir():
    items = [{"req_id": "A", "status": "var"}, {"req_id": "IP2", "status": "tetbiq_edilmir"}]
    finance = {"checks": [{"id": "npv", "status": "ok", "critical": True, "title": "NPV"}], "not_found": []}
    decision = decide(finance, {"items": items}, [], {"requirements": {"A", "IP2"}, "checks": {"npv"}})
    assert decision["verdict"] == "hazir"
    assert [n["code"] for n in decision["notes"]] == ["tetbiq_edilmir"]


def test_qrafda_IP2_kredit_istisnasında_tətbiq_edilmir(doc, monkeypatch):
    monkeypatch.setattr(config, "COMPLIANCE_GROUPS", ["investisiya"])
    model = FakeChatModel()
    model.missing_ids = ("IP2", "IP7")
    config.set_llm_override(model)
    items = {i["req_id"]: i for i in build_compliance_graph().invoke({"doc": _with_text(doc, EXCLUSION)})["items"]}
    assert items["IP2"]["status"] == "tetbiq_edilmir"
    assert items["IP7"]["status"] == "yoxdur"                              # şərtsiz tələb — dəyişmir


# ── Maliyyə mənbələri: cədvəl sətri ────────────────────────────────────────

ROW = "Ağayev Yavər Seyfulla oğlu | 70% | 10 322 857 | 1 409 773 | 11 732 629"


def test_cədvəl_sətrində_məbləğ_faiz_olmayan_xanadan_təsdiqlənir():
    keys = _source_keywords("Ağayev Yavər Seyfulla oğlu")
    assert rules.row_amount_ok(ROW, keys, 11732629)
    assert rules.row_amount_ok(ROW, keys, 10322857)
    assert not rules.row_amount_ok(ROW, keys, 70)                          # faiz xanası məbləğ deyil
    assert not rules.row_amount_ok(ROW, keys, 999)
    assert not rules.row_amount_ok(ROW, ["başqa"], 11732629)               # ad sətirdə olmalıdır


def _sources_doc():
    rows = [["Maliyyələşmə mənbəyi (təsisçi)", "Pay", "Başlanğıc, 2026–2027, manat", "Əlavə, 2028, manat", "Cəmi, manat"],
            ["Ağayev Yavər Seyfulla oğlu", "70%", "10 322 857", "1 409 773", "11 732 629"],
            ["Azərbaycan Biznesin İnkişafı Fondu", "30%", "4 424 081", "604 188", "5 028 270"],
            ["Cəmi", "100%", "14 746 938", "2 013 961", "16 760 899"]]
    table = {"id": "T14", "caption": "Cədvəl 7.1. Maliyyələşmə strukturu.", "section_id": "S28",
             "section_title": "7.1. İnvestisiya", "rows": rows, "n_rows": 4, "n_cols": 5}
    return {"sections": [{"id": "S28", "title": "7.1. İnvestisiya", "level": 2, "text": "[Cədvəl T14]",
                          "table_ids": ["T14"]}], "tables": [table], "placeholders": []}


def test_mənbə_sitatı_artıq_rəqəm_tapılmadı_sayılmır():
    reason = verify_citation(_sources_doc(), "sources", 11732629, "T14", ROW,
                             _source_keywords("Ağayev Yavər Seyfulla oğlu"))
    assert reason is None


def test_mənbələr_cəmi_başqa_sütuna_bərabərdirsə_dəqiqləşdirmə():
    sources = [{"name": "Ağayev Yavər Seyfulla oğlu", "amount": 11732629, "location": "T14"},
               {"name": "Azərbaycan Biznesin İnkişafı Fondu", "amount": 5028270, "location": "T14"}]
    cols = rules.source_columns(_sources_doc(), sources, 14746938)
    assert cols == {"matching": "Başlanğıc, 2026–2027, manat", "taken": "Cəmi, manat", "table_id": "T14"}
    from app.finance_tools import _check_sources
    check = _check_sources(_sources_doc(), {"investment_total": 14746938, "sources": sources})
    assert check["status"] == "warn" and "dəqiqləşdirin" in check["clarify"]


# ── Saxlanmış hesabat: yenidən qiymətləndirmə ──────────────────────────────

def test_köhnə_hesabat_yeni_qaydalarla_yenilənir_əvvəlki_status_saxlanılır(doc, samples):
    storage.init()
    check_id = uuid.uuid4().hex[:12]
    storage.create(check_id, "Qayda testi " + check_id, 1, "plan.docx", str(samples / "plan_demo_v1.docx"))
    service.run_check(check_id)
    stored = storage.get(check_id)
    # Köhnə qaydalarla saxlanmış vəziyyəti təqlid edirik: IP2 "yoxdur", status "hazır deyil".
    result = copy.deepcopy(stored["result"])
    result.pop("rules", None)
    for item in result["compliance"]["items"]:
        if item["req_id"] == "IP2":
            item.update(status="yoxdur", quote=None, missing="Kredit yoxdur.")
    storage.update(check_id, result=result, verdict="hazir_deyil")
    storage.doc_set(check_id, _with_text(storage.doc_get(check_id), EXCLUSION))

    after = service.apply_current_rules(storage.get(check_id))
    ip2 = next(i for i in after["result"]["compliance"]["items"] if i["req_id"] == "IP2")
    assert ip2["status"] == "tetbiq_edilmir"
    assert after["verdict"] != "hazir_deyil"
    assert after["result"]["rules"] == {"version": rules.RULES_VERSION, "previous_verdict": "hazir_deyil",
                                        "reevaluated": True}
    again = service.apply_current_rules(after)                            # ikinci dəfə — dəyişiklik yoxdur
    assert again["result"] == after["result"]


def test_yeni_nəticə_cari_qayda_versiyası_ilə_saxlanılır(samples):
    storage.init()
    check_id = uuid.uuid4().hex[:12]
    storage.create(check_id, "Versiya " + check_id, 1, "plan.docx", str(samples / "plan_demo_v1.docx"))
    service.run_check(check_id)
    assert storage.get(check_id)["result"]["rules"]["version"] == rules.RULES_VERSION
