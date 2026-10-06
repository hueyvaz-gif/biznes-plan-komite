"""Planın silinməsi: bütün versiyalar və izləri silinir, başqa planlara toxunulmur."""
import sqlite3
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import config, memory, service, storage
from app.main import app


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


def _upload(client, path, **data):
    files = [("file", (path.name, path.read_bytes(), "application/octet-stream"))]
    files += [("extra_files", f) for f in data.pop("extra_files", [])]
    r = client.post("/api/checks", files=files, data={"fail_at": "", **data})
    assert r.status_code == 200, r.text
    return r.json()


def _memory_rows(prefix: str) -> int:
    total = 0
    for path in config.DATA_DIR.glob("memory-*.db"):
        with sqlite3.connect(path) as conn:
            total += conn.execute("SELECT count(*) FROM store WHERE prefix = ?", (prefix,)).fetchone()[0]
    return total


def _thread_exists(check_id: str) -> bool:
    return service.graph().checkpointer.get_tuple({"configurable": {"thread_id": check_id}}) is not None


def test_plan_bütün_versiyaları_və_izləri_ilə_silinir(client, samples):
    v1 = _upload(client, samples / "plan_demo_v1.docx", plan_name="Silinəcək plan")
    v2 = _upload(client, samples / "plan_demo_v2.docx", existing_plan_id=v1["plan_id"])
    other = _upload(client, samples / "plan_demo_v1.docx", plan_name="Qalacaq plan")   # eyni sənəd
    ids = [v1["check_id"], v2["check_id"]]
    files = [Path(storage.get(cid)["file_path"]) for cid in ids]
    findings = "tapinti." + memory._key(v1["plan_id"])
    shared_doc = "sened." + memory.doc_key(storage.doc_get(other["check_id"]))
    assert all(f.exists() for f in files) and all(_thread_exists(cid) for cid in ids)
    assert _memory_rows(findings) > 0 and storage.events_list(ids[0])

    r = client.delete(f"/api/plans/{v1['plan_id']}")
    assert r.status_code == 200 and r.json()["deleted_checks"] == 2

    assert all(storage.get(cid) is None for cid in ids)
    assert not any(storage.events_list(cid) for cid in ids)
    assert not any(f.exists() for f in files)
    assert not any(_thread_exists(cid) for cid in ids)
    assert _memory_rows(findings) == 0
    assert v1["plan_id"] not in {p["plan_id"] for p in client.get("/api/plans").json()}
    assert client.get(f"/api/checks/{ids[0]}").status_code == 404
    # Başqa plan toxunulmaz: yoxlaması, faylı, checkpoint-i və ortaq sənədin yaddaşı qalır.
    kept = storage.get(other["check_id"])
    assert kept and Path(kept["file_path"]).exists() and _thread_exists(other["check_id"])
    assert _memory_rows(shared_doc) > 0


def test_əlavə_tələb_faylları_da_silinir(client, samples):
    text = "Tələb: Planda ixrac bazarları göstərilməlidir.\n".encode("utf-8")
    created = _upload(client, samples / "plan_demo_v1.docx", plan_name="Əlavəli plan",
                      extra_files=[("telebler.txt", text, "text/plain")])
    stored = [config.UPLOAD_DIR / "elave" / a["stored"]
              for a in storage.extras_get(created["check_id"])["attachments"]]
    assert stored and all(p.exists() for p in stored)
    assert client.delete(f"/api/plans/{created['plan_id']}").status_code == 200
    assert not any(p.exists() for p in stored)
    assert storage.extras_get(created["check_id"]) is None


def test_mövcud_olmayan_plan_404(client):
    r = client.delete("/api/plans/p-yoxdur000000")
    assert r.status_code == 404 and "tapılmadı" in r.json()["detail"]


def test_işləyən_yoxlaması_olan_plan_silinmir(client, samples):
    created = _upload(client, samples / "plan_demo_v1.docx", plan_name="İşləyən plan")
    storage.update(created["check_id"], run_state="isleyir")
    try:
        r = client.delete(f"/api/plans/{created['plan_id']}")
        assert r.status_code == 409 and "hələ gedir" in r.json()["detail"]
        assert storage.get(created["check_id"]) is not None
    finally:
        storage.update(created["check_id"], run_state="tamamlandi")
