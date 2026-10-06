"""Dəlil paneli: rəqəmin sənəddəki yeri, cədvəl sətirləri (xam), boş yerin vurğusu, API."""
from __future__ import annotations

import uuid

import pytest
from fastapi.testclient import TestClient

from app import evidence, service, storage
from app.ingest import parse_docx
from tests.synthetic import build_doc


@pytest.fixture(scope="module")
def doc(samples):
    return parse_docx(samples / "plan_demo_v1.docx")


def test_locate_number_bölmə_tapır_və_vurğu_dəqiqdir(doc):
    found = evidence.locate_number(doc, 1225241)
    assert found, "1 225 241 bölmə mətnində tapılmalıdır"
    first = found[0]
    marked = first["text"][first["mark"][0]:first["mark"][1]]
    assert marked.replace(" ", " ") == "1 225 241"         # NBSP ilə yazılıb
    assert first["section_title"]


def test_mötərizəli_mənfi_rəqəm_tapılır(tmp_path):
    doc = build_doc(tmp_path, [("h", "Nəticə"), ("p", "Güzəştsiz ssenaridə NPV (1 196 310) manatdır.")])
    found = evidence.locate_number(doc, -1196310)
    assert found and found[0]["text"][found[0]["mark"][0]:found[0]["mark"][1]] == "1 196 310"


def test_tapılmayan_rəqəm_boş_siyahı_verir(doc):
    assert evidence.locate_number(doc, 987654321) == []
    assert evidence.locate_number(doc, None) == []


def _run(samples):
    storage.init()
    check_id = uuid.uuid4().hex[:12]
    storage.create(check_id, f"Dəlil {check_id}", 1, "plan_demo_v1.docx", str(samples / "plan_demo_v1.docx"))
    service.run_check(check_id)
    return storage.get(check_id)


def test_npv_dəlilində_t27_fcff_sətri_xam_mətnlə(samples):
    row = _run(samples)
    checks = {c["id"]: c for c in row["result"]["finance"]["checks"]}
    cash = checks["npv"]["evidence"]["cashflow"]
    assert cash["table_id"] == "T27"
    labels = [r["label"] for r in cash["rows"]]
    assert labels == ["Sərbəst pul axını (FCFF)"]
    assert cash["years"][0] == 2027
    assert cash["rows"][0]["cells"][0].replace(" ", " ") == "(13 481 000)"   # parse edilməyib
    fcff = checks["fcff_dusturu"]["evidence"]["cashflow"]
    assert len(fcff["rows"]) == 6 and fcff["highlight_year"] is None           # uyğundur
    assert checks["npv"]["evidence"]["snippets"]                                # NPV mətndə də var


def test_boş_yer_parçası_və_vurğusu(samples):
    row = _run(samples)
    voen = next(p for p in row["result"]["ingest"]["placeholders"] if p["text"] == "[VÖEN]")
    ev = voen["evidence"]
    assert ev["text"][ev["mark"][0]:ev["mark"][1]] == "[VÖEN]"
    assert len(ev["text"]) <= 2 * evidence.WINDOW + len("[VÖEN]") + 2
    assert ev["section_title"].startswith("2.")


def test_tələbin_bölmə_önizləməsi(samples):
    row = _run(samples)
    item = next(i for i in row["result"]["compliance"]["items"] if i["status"] == "var")
    preview = item["previews"][0]
    assert preview["section_title"] and len(preview["text"]) <= evidence.SECTION_PREVIEW + 1


def test_fcff_uyğunsuz_ilin_sütunu_işarələnir(tmp_path):
    from app.finance_tools import provenance, run_checks
    doc = build_doc(tmp_path, [("h", "Pul axını"), ("t", [
        ["Göstərici", "2027", "2028", "2029"],
        ["İnvestisiya", "(100)", "–", "–"], ["EBITDA", "–", "50", "60"], ["Vergi", "–", "–", "–"],
        ["Dövriyyə", "–", "–", "–"], ["Qalıq", "–", "–", "–"], ["FCFF", "(100)", "55", "60"]])])
    claimed = {"cashflow_table_id": "T1", "row_investment": "İnvestisiya", "row_ebitda": "EBITDA",
               "row_tax": "Vergi", "row_wc_change": "Dövriyyə", "row_residual": "Qalıq", "row_fcff": "FCFF"}
    clean, _ = provenance(doc, claimed)
    finance = {"claimed": clean, "checks": run_checks(doc, clean)["checks"]}
    fcff = next(c for c in evidence.finance_evidence(doc, finance)["checks"] if c["id"] == "fcff_dusturu")
    assert fcff["status"] == "fail"
    assert fcff["evidence"]["cashflow"]["highlight_year"] == 2028


def test_tam_bölmə_api_və_sənəd_cavabda_yoxdur(samples):
    from app.main import app
    row = _run(samples)
    title = row["result"]["ingest"]["placeholders"][0]["section_title"]
    with TestClient(app) as client:
        data = client.get(f"/api/checks/{row['id']}").json()
        assert "doc_json" not in data and "doc" not in data["result"]
        full = client.get(f"/api/checks/{row['id']}/section", params={"title": title}).json()
        assert full["section_title"] == title and "[VÖEN]" in full["text"]
        assert client.get(f"/api/checks/{row['id']}/section", params={"title": "Yoxdur"}).status_code == 404


def test_sənəd_strukturu_api(samples):
    """GET /doc: bölmələr sırası ilə, paraqraflar və cədvəllər; boş yer marker-i mətndə qalır."""
    from app.main import app
    row = _run(samples)
    with TestClient(app) as client:
        doc = client.get(f"/api/checks/{row['id']}/doc").json()
        assert [s["id"] for s in doc["sections"]] == sorted((s["id"] for s in doc["sections"]), key=lambda x: int(x[1:]))
        assert all({"id", "level", "title", "paragraphs", "table_ids"} <= set(s) for s in doc["sections"])
        table_ids = {t["id"] for t in doc["tables"]}
        assert all(tid in table_ids for s in doc["sections"] for tid in s["table_ids"])
        assert any("[VÖEN]" in p for s in doc["sections"] for p in s["paragraphs"])
        assert client.get("/api/checks/yoxdur/doc").status_code == 404
