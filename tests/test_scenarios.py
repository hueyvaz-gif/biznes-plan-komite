"""Mərhələ 4: təhvil ssenariləri — hər biri tam axınla (saxta model, müvəqqəti DATA_DIR).

| Ssenari                                        | Test                                         |
| ---------------------------------------------- | -------------------------------------------- |
| v1: 12 boş yer, PP warn                        | test_v1                                      |
| v2: 9 boş yer, PP=7,0, PP warn → ok            | test_v2_müqayisə                             |
| Saxta NPV: npv fail, hazır deyil               | test_saxta_npv                               |
| Qırıq pul axını: müvafiq yoxlamalar skip       | test_qırıq_pul_axını                         |
| Yanlış DOCX: aydın giriş xətası                | test_yanlış_docx                             |
| Uyğunluqda xəta və checkpoint-dən davam        | test_uyğunluq_xətası_və_davam                |
| Rəy modelində xəta və ehtiyat rəy              | test_rəy_xətası_ehtiyat_rəy                  |
| Əlavə tələb sənədi ilə tam axın                | test_əlavə_tələb_tam_axın                    |
| Sorğu davam edərkən başqa yoxlamaya keçid      | tests/js/poll.test.js + tests/ui/e2e_ui.py   |
| Server restartından sonra davam                | test_restartdan_sonra_davam                  |
| Köhnə saxlanmış nəticələrin açılması           | test_köhnə_nəticə_açılır                     |
| NPV-nin işarəsi rəydə dəyişdirilib → rədd      | test_npv_işarəsi_rəydə_dəyişdirilə_bilməz    |
| Mənfi NPV rəydə müsbət yazılıb → rədd          | test_mənfi_npv_rəydə_müsbət_rədd_edilir      |
| Fayl ölçüsü və ümumi yükləmə limiti            | tests/test_upload_limits.py                  |
"""
from __future__ import annotations

import uuid

import pytest

from app import service, storage


@pytest.fixture()
def run(samples):
    storage.init()

    def _run(file_name, plan_id=None, version=1, fail_at=""):
        check_id = uuid.uuid4().hex[:12]
        storage.create(check_id, plan_id or f"Ssenari {check_id}", version, file_name,
                       str(samples / file_name), fail_at)
        service.run_check(check_id)
        return storage.get(check_id)

    return _run


def _checks(row):
    return {c["id"]: c for c in row["result"]["finance"]["checks"]}


def test_v1(run):
    row = run("plan_demo_v1.docx")
    assert row["run_state"] == "tamamlandi"
    assert row["result"]["ingest"]["stats"]["placeholders"] == 12
    assert _checks(row)["pp"]["status"] == "warn"
    assert row["verdict"] == "duzelis"


def test_v2_müqayisə(run, fake_llm):
    plan = "Ssenari v2 " + uuid.uuid4().hex[:6]
    run("plan_demo_v1.docx", plan_id=plan)
    fake_llm.figures["payback_years"] = 7.0
    fake_llm.written = {"payback_years": "7,0"}
    row = run("plan_demo_v2.docx", plan_id=plan, version=2)
    assert row["result"]["ingest"]["stats"]["placeholders"] == 9
    assert _checks(row)["pp"]["status"] == "ok"
    pp = [c for c in row["result"]["comparison"]["finance"] if c["id"] == "pp"][0]
    assert (pp["status_before"], pp["status_after"], pp["trend"]) == ("warn", "ok", "yaxsilasdi")
    assert row["result"]["comparison"]["counts"]["filled"] == 3


def test_saxta_npv(run, fake_llm):
    fake_llm.figures["npv"] = 2225241
    row = run("plan_demo_saxta.docx")
    assert _checks(row)["npv"]["status"] == "fail"
    assert row["verdict"] == "hazir_deyil"


def test_qırıq_pul_axını(run, fake_llm):
    fake_llm.figures["cashflow_table_id"] = None
    row = run("plan_demo_qiriq.docx")
    checks = _checks(row)
    for check_id in ("fcff_dusturu", "npv", "irr", "pp"):
        assert checks[check_id]["status"] == "skip", check_id
    assert row["result"]["finance"]["charts"]["fcff"]["available"] is False
    assert row["verdict"] != "hazir"


def test_yanlış_docx(run):
    row = run("yanlis_fayl.docx")
    assert row["run_state"] == "tamamlandi"
    assert row["verdict"] == "giris_xetasi"
    assert "docx formatında deyil" in row["error"]


def test_uyğunluq_xətası_və_davam(run, fake_llm):
    row = run("plan_demo_v1.docx", fail_at="compliance")
    assert (row["run_state"], row["current_step"]) == ("xeta", "compliance")
    finance_calls = fake_llm.call_log.count("finance")
    service.run_check(row["id"], resume=True)
    row = storage.get(row["id"])
    assert row["run_state"] == "tamamlandi"
    assert fake_llm.call_log.count("finance") == finance_calls      # maliyyə təkrarlanmadı


def test_rəy_xətası_ehtiyat_rəy(run):
    row = run("plan_demo_v1.docx", fail_at="write_summary")
    assert row["run_state"] == "tamamlandi"
    summary = row["result"]["summary"]
    assert summary["source"] == "qayda" and summary["error"]
    assert summary["headline"].startswith("Düzəliş lazımdır")
    assert row["result"]["finance"]["checks"] and row["result"]["compliance"]["items"]


def test_əlavə_tələb_tam_axın(samples, fake_llm):
    from app import attachments
    storage.init()
    check_id = uuid.uuid4().hex[:12]
    storage.create(check_id, "Ssenari əlavə", 1, "plan_demo_v1.docx",
                   str(samples / "plan_demo_v1.docx"))
    storage.extras_create(check_id, attachments.accept(
        [], "Tələb: Plan layihənin ekoloji təsirini təsvir etməlidir.\n\n"
            "Sənəd: Bankın zəmanət məktubu ayrıca təqdim olunmalıdır."))
    service.extract_requirements(check_id)
    assert storage.get(check_id)["run_state"] == "tesdiq_gozleyir"
    draft = storage.extras_get(check_id)["draft"]["items"]
    service.confirm_requirements(check_id, [{"id": i["id"], "text": i["text"], "kind": i["kind"]}
                                            for i in draft])
    service.run_check(check_id)
    row = storage.get(check_id)
    extra = {i["req_id"]: i for i in row["result"]["compliance"]["items"] if i["origin"] == "elave"}
    assert [extra[i["id"]]["status"] for i in draft] == ["var", "sened"]
    assert row["result"]["extras"]["count"] == 2


def test_restartdan_sonra_davam(run, fake_llm):
    row = run("plan_demo_v1.docx", fail_at="compliance")
    storage.update(row["id"], run_state="isleyir")      # server icra zamanı söndü
    service.reset_graphs()
    storage.init()                                      # yenidən başladı
    assert storage.get(row["id"])["run_state"] == "xeta"
    service.run_check(row["id"], resume=True)
    assert storage.get(row["id"])["run_state"] == "tamamlandi"


def test_köhnə_nəticə_açılır(samples):
    """Əlavə tələblərdən, mənbə sitatlarından və əhatədən əvvəlki formada saxlanmış nəticə."""
    from fastapi.testclient import TestClient
    from app.main import app

    storage.init()
    check_id = uuid.uuid4().hex[:12]
    storage.create(check_id, "Köhnə", 1, "plan.docx", str(samples / "plan_demo_v1.docx"))
    storage.update(check_id, run_state="tamamlandi", verdict="duzelis", result={
        "ingest": {"stats": {"placeholders": 0}, "placeholders": []},
        "finance": {"checks": [{"id": "npv", "title": "NPV", "status": "ok", "claimed": 1,
                                "computed": 1, "diff": 0, "unit": "manat", "critical": True}],
                    "not_found": [], "claimed": {}},
        "compliance": {"items": [{"req_id": "X1", "status": "var", "text": "t",
                                  "group_id": "xulase", "group_title": "1.", "evidence": "köhnə"}]},
        "comparison": {"available": False},
        "summary": {"headline": "Köhnə rəy", "key_findings": ["a"], "open_questions": [], "dropped": 0},
        "reasons": {"reasons": [], "notes": []},
    })
    with TestClient(app) as client:
        data = client.get(f"/api/checks/{check_id}").json()
    assert data["result"]["summary"]["headline"] == "Köhnə rəy"
    assert "extras" not in data["result"]                # köhnə formada açar yoxdur — UI bunu daşıyır


ALL_FACTS = [f"F{i}" for i in range(1, 41)]        # naməlum id-lər nəzərə alınmır


def test_npv_işarəsi_rəydə_dəyişdirilə_bilməz(run, fake_llm):
    """Tam axın (v1): planda NPV +1 225 241. Rəydə "−1 225 241" yazılan cümlə atılır,
    düzgün işarəli cümlə saxlanılır; nəticə bazada da belədir."""
    fake_llm.summary = {
        "key_findings": [{"text": "NPV 1 225 241 manat göstərilib.", "facts": ALL_FACTS},
                         {"text": "NPV −1 225 241 manat göstərilib.", "facts": ALL_FACTS}],
        "open_questions": []}
    row = run("plan_demo_v1.docx")
    summary = row["result"]["summary"]
    assert summary["source"] == "model"
    assert summary["key_findings"] == ["NPV 1 225 241 manat göstərilib."]
    assert [(u["number"].replace(" ", " "), u["reason"]) for u in summary["untraced_numbers"]] == [
        ("−1 225 241", "işarəsi faktdakından fərqlidir")]


def test_mənfi_npv_rəydə_müsbət_rədd_edilir(fake_llm):
    """Rəy qovşağı (saxta model + qoruyucu): faktda NPV mənfidir, model müsbət yazır."""
    from app.agents.summary import write_summary
    state = {"plan_id": "X", "version": 1, "verdict": "hazir_deyil",
             "reasons": {"reasons": [], "notes": []},
             "finance": {"checks": [{"id": "npv", "title": "NPV", "unit": "manat", "critical": True,
                                     "claimed": -1196310, "computed": -1196310, "status": "ok"}]}}
    fake_llm.summary = {
        "key_findings": [{"text": "NPV 1 196 310 manatdır.", "facts": ["F2"]},
                         {"text": "NPV (1 196 310) manatdır.", "facts": ["F2"]}],
        "open_questions": []}
    out = write_summary(state)
    assert out["key_findings"] == ["NPV (1 196 310) manatdır."]
    assert out["untraced_numbers"][0]["reason"] == "işarəsi faktdakından fərqlidir"
    assert out["headline"].startswith("Hazır deyil")
