"""FastAPI — fayl yükləmə və sənəd oxuma (MƏRHƏLƏ 1)."""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.main import app


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


def _upload(client, path, plan_id="Demo plan"):
    with open(path, "rb") as fh:
        return client.post(
            "/api/checks",
            files={"file": (path.name, fh,
                            "application/vnd.openxmlformats-officedocument.wordprocessingml.document")},
            data={"plan_id": plan_id, "fail_at": ""},
        )


def test_ana_səhifə_açılır(client):
    response = client.get("/")
    assert response.status_code == 200
    assert "Biznes Plan qiymətləndirmə komitəsi" in response.text


def test_meta(client):
    data = client.get("/api/meta").json()
    assert data["allowed_suffix"] == ".docx"
    assert data["max_upload_mb"] == 25
    assert any(step["id"] == "ingest" for step in data["steps"])


def test_docx_yüklənir_və_oxunur(client, samples):
    response = _upload(client, samples / "plan_demo_v1.docx", "Demo plan")
    assert response.status_code == 200
    created = response.json()
    assert created["version"] >= 1

    check = client.get(f"/api/checks/{created['check_id']}").json()
    assert check["run_state"] == "tamamlandi"
    assert check["result"]["ingest"]["stats"]["placeholders"] == 12
    assert check["result"]["ingest"]["stats"]["tables"] == 34
    # fail_at istifadəçiyə göstərilmir
    assert "fail_at" not in check


def test_mövcud_plana_açıq_seçimlə_ikinci_versiya(client, samples):
    first = _upload(client, samples / "plan_demo_v1.docx", "Versiya testi").json()
    with open(samples / "plan_demo_v2.docx", "rb") as fh:
        second = client.post("/api/checks", files={"file": ("v2.docx", fh, "application/octet-stream")},
                             data={"existing_plan_id": first["plan_id"], "fail_at": ""}).json()
    assert second["version"] == 2 and second["plan_id"] == first["plan_id"]
    assert second["plan_name"] == "Versiya testi"


def test_eyni_adlı_yeni_plan_avtomatik_birləşdirilmir(client, samples):
    a = _upload(client, samples / "plan_demo_v1.docx", "Eyni ad").json()
    b = _upload(client, samples / "plan_demo_v2.docx", "Eyni ad").json()
    assert a["plan_id"] != b["plan_id"] and a["version"] == b["version"] == 1
    assert a["plan_id"].startswith("p-") and a["plan_name"] == b["plan_name"] == "Eyni ad"


def test_mövcud_olmayan_plan_seçimi_rədd_edilir(client, samples):
    with open(samples / "plan_demo_v1.docx", "rb") as fh:
        r = client.post("/api/checks", files={"file": ("v.docx", fh, "application/octet-stream")},
                        data={"existing_plan_id": "p-yoxdur000000", "fail_at": ""})
    assert r.status_code == 400 and "tapılmadı" in r.json()["detail"]


def test_köhnə_ad_açarlı_plana_versiya_əlavə_olunur(client, samples):
    """Miqrasiyadan əvvəlki plan (açar = ad) toxunulmaz qalır və ona versiya əlavə etmək olur."""
    from app import storage
    import uuid
    storage.init()
    storage.create(uuid.uuid4().hex[:12], "Köhnə plan", 1, "a.docx", str(samples / "plan_demo_v1.docx"))
    with open(samples / "plan_demo_v2.docx", "rb") as fh:
        r = client.post("/api/checks", files={"file": ("v2.docx", fh, "application/octet-stream")},
                        data={"existing_plan_id": "Köhnə plan", "fail_at": ""}).json()
    assert r["plan_id"] == "Köhnə plan" and r["version"] == 2


def test_pdf_qəbul_edilmir(client, samples):
    with open(samples / "plan_demo_v1.docx", "rb") as fh:
        response = client.post(
            "/api/checks",
            files={"file": ("plan.pdf", fh, "application/pdf")},
            data={"plan_id": "Demo", "fail_at": ""},
        )
    assert response.status_code == 400
    assert ".docx" in response.json()["detail"]


def test_boş_fayl_qəbul_edilmir(client):
    response = client.post(
        "/api/checks",
        files={"file": ("bos.docx", b"", "application/octet-stream")},
        data={"plan_id": "Demo", "fail_at": ""},
    )
    assert response.status_code == 400
    assert "boş" in response.json()["detail"].lower()


def test_yanlış_plan_adı(client, samples):
    response = _upload(client, samples / "plan_demo_v1.docx", "pis/ad*!")
    assert response.status_code == 400
    assert "Plan adı" in response.json()["detail"]


def test_docx_olmayan_fayl_giriş_xətası_verir(client, samples):
    created = _upload(client, samples / "yanlis_fayl.docx", "Yanlış fayl").json()
    check = client.get(f"/api/checks/{created['check_id']}").json()
    assert check["verdict"] == "giris_xetasi"
    assert check["verdict_label"] == "Fayl oxunmadı"
    assert "docx formatında deyil" in check["error"]


def test_olmayan_yoxlama(client):
    assert client.get("/api/checks/yoxdur").status_code == 404


# ── MƏRHƏLƏ 2: fon icrası, maliyyə nəticəsi, davam etdirmə ────────────────

def test_maliyyə_nəticəsi_qaytarılır(client, samples):
    """TestClient fon tapşırığını cavabdan sonra dərhal icra edir."""
    created = _upload(client, samples / "plan_demo_v1.docx", "Maliyyə testi").json()
    check = client.get(f"/api/checks/{created['check_id']}").json()

    assert check["run_state"] == "tamamlandi"
    assert check["current_step"] is None
    finance = check["result"]["finance"]
    assert len(finance["checks"]) == 7
    assert finance["not_found"] == []
    statuses = {c["id"]: c["status"] for c in finance["checks"]}
    assert statuses["npv"] == "ok"
    assert statuses["pp"] == "warn"
    assert finance["cashflow"]["table_id"] == "T27"


def test_saxta_planda_npv_uyğunsuzluğu(client, samples, fake_llm):
    fake_llm.figures["npv"] = 2225241
    created = _upload(client, samples / "plan_demo_saxta.docx", "Saxta plan").json()
    check = client.get(f"/api/checks/{created['check_id']}").json()
    npv_check = next(c for c in check["result"]["finance"]["checks"] if c["id"] == "npv")
    assert npv_check["status"] == "fail"


def test_süni_xəta_və_davam_etdirmə(client, samples):
    with open(samples / "plan_demo_v1.docx", "rb") as fh:
        created = client.post(
            "/api/checks",
            files={"file": ("plan.docx", fh, "application/octet-stream")},
            data={"plan_id": "Xəta testi", "fail_at": "finance"},
        ).json()
    check_id = created["check_id"]

    failed = client.get(f"/api/checks/{check_id}").json()
    assert failed["run_state"] == "xeta"
    assert failed["current_step"] == "finance"
    assert "Süni xəta" in failed["error"]

    assert client.post(f"/api/checks/{check_id}/retry").status_code == 200
    resumed = client.get(f"/api/checks/{check_id}").json()
    assert resumed["run_state"] == "tamamlandi"
    assert resumed["error"] is None
    assert len(resumed["result"]["finance"]["checks"]) == 7


def test_tamamlanmış_yoxlamanı_davam_etdirmək_olmaz(client, samples):
    created = _upload(client, samples / "plan_demo_v1.docx", "Retry 409").json()
    response = client.post(f"/api/checks/{created['check_id']}/retry")
    assert response.status_code == 409
    assert "davam etdirmək" in response.json()["detail"]


def test_planlar_və_versiyalar(client, samples):
    first = _upload(client, samples / "plan_demo_v1.docx", "Tarixçə").json()
    with open(samples / "plan_demo_v2.docx", "rb") as fh:
        client.post("/api/checks", files={"file": ("v2.docx", fh, "application/octet-stream")},
                    data={"existing_plan_id": first["plan_id"], "fail_at": ""})

    plans = client.get("/api/plans").json()
    plan = next(p for p in plans if p["plan_id"] == first["plan_id"])
    assert plan["versions"] == 2 and plan["plan_name"] == "Tarixçə"

    checks = client.get(f"/api/plans/{first['plan_id']}/checks").json()
    assert [c["version"] for c in checks] == [2, 1]
    assert all("result" not in c for c in checks)   # siyahı yüngüldür


def test_yanlış_test_rejimi_seçimi(client, samples):
    with open(samples / "plan_demo_v1.docx", "rb") as fh:
        response = client.post(
            "/api/checks",
            files={"file": ("plan.docx", fh, "application/octet-stream")},
            data={"plan_id": "Pis fail_at", "fail_at": "nəsə"},
        )
    assert response.status_code == 400


# ── MƏRHƏLƏ 3: uyğunluq nəticəsi ──────────────────────────────────────────

def test_tələblər_nəticədə_var(client, samples):
    created = _upload(client, samples / "plan_demo_v1.docx", "Uyğunluq testi").json()
    check = client.get(f"/api/checks/{created['check_id']}").json()

    items = check["result"]["compliance"]["items"]
    assert len(items) == 47
    by_id = {i["req_id"]: i for i in items}
    assert by_id["MP4"]["status"] == "sened"          # ayrıca sənəd
    assert "Ayrıca sənəd" in by_id["MP4"]["missing"]
    assert by_id["X1"]["group_title"].startswith("1.")
    assert all(i["text"] for i in items)


def test_uyğunluq_agentində_süni_xəta(client, samples):
    with open(samples / "plan_demo_v1.docx", "rb") as fh:
        created = client.post(
            "/api/checks",
            files={"file": ("plan.docx", fh, "application/octet-stream")},
            data={"plan_id": "Uyğunluq xətası", "fail_at": "compliance"},
        ).json()
    failed = client.get(f"/api/checks/{created['check_id']}").json()
    assert failed["run_state"] == "xeta"
    assert failed["current_step"] == "compliance"     # "supervisor" DEYİL

    client.post(f"/api/checks/{created['check_id']}/retry")
    done = client.get(f"/api/checks/{created['check_id']}").json()
    assert done["run_state"] == "tamamlandi"
    assert len(done["result"]["compliance"]["items"]) == 47


def test_addım_siyahısında_uyğunluq_var(client):
    steps = [s["id"] for s in client.get("/api/meta").json()["steps"]]
    assert steps == ["ingest", "load_previous", "finance", "compliance", "decide_status",
                     "compare_previous", "write_summary", "save"]


def test_süni_xəta_yalnız_inkişaf_rejimində(client, samples, monkeypatch):
    from app import config
    monkeypatch.setattr(config, "DEV_MODE", False)
    assert client.get("/api/meta").json()["fail_at_options"] == []
    with open(samples / "plan_demo_v1.docx", "rb") as fh:
        response = client.post("/api/checks", files={"file": ("p.docx", fh, "application/octet-stream")},
                               data={"plan_id": "Dev yox", "fail_at": "finance"})
    assert response.status_code == 400
    assert "DEV_MODE" in response.json()["detail"]
