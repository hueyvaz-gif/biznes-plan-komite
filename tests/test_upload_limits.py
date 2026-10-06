"""Yükləmə limitləri: hissə-hissə oxuma, erkən rədd, yarımçıq qeyd yoxdur, fayllar bağlanır.

Limitlər testdə kiçildilir (KB səviyyəsində) — böyük fayl yaratmağa ehtiyac yoxdur.
"""
from __future__ import annotations

import asyncio
import io
import sqlite3

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from starlette.datastructures import UploadFile as StarletteUpload

from app import attachments, config, main, storage
from app.main import app

DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"


@pytest.fixture()
def client():
    with TestClient(app, raise_server_exceptions=False) as c:
        yield c


@pytest.fixture()
def small(monkeypatch):
    """Kiçik limitlər: əsas fayl 4 KB, əlavə fayl 2 KB, cəmi 3 KB, mətn 200 simvol; hissə 512 B."""
    monkeypatch.setattr(config, "MAX_UPLOAD_BYTES", 4096)
    monkeypatch.setattr(config, "UPLOAD_CHUNK_BYTES", 512)
    monkeypatch.setattr(attachments, "MAX_FILE_BYTES", 2048)
    monkeypatch.setattr(attachments, "MAX_TOTAL_BYTES", 3072)
    monkeypatch.setattr(attachments, "MAX_EXTRA_TEXT", 200)
    monkeypatch.setattr(attachments, "MAX_FILES", 3)


@pytest.fixture()
def spy(monkeypatch):
    """UploadFile.read/close çağırışlarını sayır."""
    stats = {"read_bytes": 0, "closed": 0}
    real_read, real_close = StarletteUpload.read, StarletteUpload.close

    async def read(self, size=-1):
        data = await real_read(self, size)
        stats["read_bytes"] += len(data)
        return data

    async def close(self):
        stats["closed"] += 1
        await real_close(self)

    monkeypatch.setattr(StarletteUpload, "read", read)
    monkeypatch.setattr(StarletteUpload, "close", close)
    return stats


def _snapshot():
    storage.init()
    config.ensure_dirs()
    attachments.attachments_dir().mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(config.DB_FILE) as db:
        rows = db.execute("SELECT COUNT(*) FROM checks").fetchone()[0]
        extras = db.execute("SELECT COUNT(*) FROM extras").fetchone()[0]
    files = {p.name for p in config.UPLOAD_DIR.iterdir()} | {
        p.name for p in attachments.attachments_dir().iterdir()}
    return rows, extras, files


def _post(client, size=1000, extras=(), text="", plan="Limit testi"):
    files = [("file", ("plan.docx", io.BytesIO(b"P" * size), DOCX))]
    files += [("extra_files", (name, io.BytesIO(data), "text/plain")) for name, data in extras]
    return client.post("/api/checks", files=files,
                       data={"plan_id": plan, "fail_at": "", "extra_text": text})


def test_böyük_əsas_fayl_erkən_rədd_edilir_və_iz_qalmır(client, small, spy):
    before = _snapshot()
    response = _post(client, size=50_000)
    assert response.status_code == 400 and "çox böyükdür" in response.json()["detail"]
    # Hədd 4 KB, hissə 512 B — 50 KB-ın hamısı oxunmur.
    assert spy["read_bytes"] == 4097                         # hədd + 1 bayt
    assert spy["closed"] >= 1
    assert _snapshot() == before


def test_əlavə_faylların_cəmi_aşılanda_heç_nə_saxlanmır(client, small, spy):
    before = _snapshot()
    response = _post(client, extras=[("a.txt", b"a" * 1500), ("b.txt", b"b" * 1500), ("c.txt", b"c" * 1500)])
    assert response.status_code == 400 and "ümumi həcmi" in response.json()["detail"]
    assert spy["read_bytes"] == 1000 + 1500 * 2 + 73         # üçüncüdən yalnız qalan hədd + 1 bayt
    assert spy["closed"] >= 4
    assert _snapshot() == before


def test_fayl_sayı_və_mətn_uzunluğu_oxumadan_yoxlanılır(client, small, spy):
    before = _snapshot()
    many = _post(client, extras=[(f"{i}.txt", b"x") for i in range(4)])
    assert many.status_code == 400 and "Ən çoxu 3" in many.json()["detail"]
    long_text = _post(client, text="ə" * 201)
    assert long_text.status_code == 400 and "200 simvol" in long_text.json()["detail"]
    assert spy["read_bytes"] == 0                             # heç bir fayl oxunmayıb
    assert _snapshot() == before


def test_tək_böyük_əlavə_fayl_xəta_kimi_qeyd_olunur_amma_tam_oxunmur(client, small, spy):
    response = _post(client, extras=[("böyük.txt", b"y" * 2900)])
    assert response.status_code == 200 and response.json()["needs_review"]
    record = storage.extras_get(response.json()["check_id"])["attachments"][0]
    assert record["status"] == "xeta" and "böyükdür" in record["error"]
    assert record["stored"] is None                          # diskə yazılmayıb
    assert record["size"] == 2049                            # hədd + 1 bayt — qalanı oxunmayıb


def test_qeyddən_sonra_xəta_olsa_qeyd_və_fayllar_silinir(client, small, spy, monkeypatch):
    def broken(*_a, **_k):
        raise RuntimeError("disk dolub")

    monkeypatch.setattr(storage, "extras_create", broken)
    before = _snapshot()
    response = _post(client, extras=[("tələb.txt", "1. Sığorta göstərilməlidir.".encode())])
    assert response.status_code == 500
    assert _snapshot() == before                              # nə yoxlama, nə fayl qalıb
    assert spy["closed"] >= 2


def test_ümumi_gövdə_həddi_413(client, small):
    """Gövdə limitlərin cəmindən (≈1 MB + kiçik limitlər) böyükdür → 413, endpoint işə düşmür."""
    before = _snapshot()
    response = _post(client, size=main.request_body_limit("/api/checks") + 10_000)
    assert response.status_code == 413 and "Sorğu çox böyükdür" in response.json()["detail"]
    assert _snapshot() == before


def test_content_length_ə_etibar_edilmir():
    """Başlıqda kiçik ölçü göstərilib, gövdə isə böyükdür — baytlar sayılır və oxuma kəsilir."""
    limit = main.request_body_limit("/api/other")
    chunks = [{"type": "http.request", "body": b"z" * 600_000, "more_body": True} for _ in range(10)]
    received = []

    async def receive():
        return chunks.pop(0)

    async def inner(_scope, recv, _send):
        while True:
            message = await recv()
            received.append(len(message["body"]))
            if not message.get("more_body"):
                break

    scope = {"type": "http", "method": "POST", "path": "/api/other",
             "headers": [(b"content-length", b"100")]}
    with pytest.raises(HTTPException) as exc:
        asyncio.run(main.BodyLimitMiddleware(inner)(scope, receive, None))
    assert exc.value.status_code == 413
    assert sum(received) <= limit                             # həddən artığı tətbiqə ötürülmür


def test_adi_yükləmə_işləyir_və_fayllar_bağlanır(client, samples, spy):
    with open(samples / "plan_demo_v1.docx", "rb") as fh:
        response = client.post("/api/checks", files={"file": ("plan_demo_v1.docx", fh, DOCX)},
                               data={"plan_id": "Limit normal", "fail_at": ""})
    assert response.status_code == 200
    assert spy["closed"] >= 1


def test_dəqiq_limitdə_qəbul_bir_bayt_artıq_rədd(client, small, spy):
    """Əsas fayl: 4096 bayt qəbul, 4097 rədd; əlavə: cəmi 3072 qəbul, 3073 rədd."""
    exact = _post(client, size=4096, plan="Limit dəqiq")
    assert exact.status_code == 200
    before = _snapshot()
    over = _post(client, size=4097, plan="Limit artıq")
    assert over.status_code == 400 and "çox böyükdür" in over.json()["detail"]
    assert _snapshot() == before
    ok_total = _post(client, extras=[("a.txt", b"1. A. " * 256), ("b.txt", b"b" * 1536)], plan="Cəm dəqiq")
    assert ok_total.status_code == 200
    before = _snapshot()
    bad_total = _post(client, extras=[("a.txt", b"a" * 1536), ("b.txt", b"b" * 1537)], plan="Cəm artıq")
    assert bad_total.status_code == 400 and "ümumi həcmi" in bad_total.json()["detail"]
    assert _snapshot() == before
