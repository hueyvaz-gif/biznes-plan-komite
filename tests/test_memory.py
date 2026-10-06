"""Semantik yaddaş: LangGraph SqliteStore + vektor indeksi (testdə lokal leksik embeddings).

Real embeddings API çağırılmır (`EMBEDDINGS_PROVIDER=lexical`, conftest).
"""
from __future__ import annotations

import uuid

import pytest

from app import embeddings, memory, service, storage
from app.agents.doc_tools import make_doc_tools
from app.ingest import parse_docx


@pytest.fixture(scope="module")
def doc(samples):
    return parse_docx(samples / "plan_demo_v1.docx")


def test_rejim_açıq_bildirilir_və_açar_qaytarılmır():
    status = memory.status()
    assert status == {"mode": "lexical", "label": "Lokal leksik axtarış (semantik model qoşulmayıb)",
                      "semantic": False, "dims": embeddings.LEXICAL_DIMS}


def test_sənəd_parçalanır_bölmə_və_cədvəl_istinadı_ilə(doc):
    parts = memory.chunks(doc)
    kinds = {v["kind"] for _k, v in parts}
    assert kinds == {"bolme", "cedvel"}
    assert all(len(v["text"]) <= memory.CHUNK_CHARS + 200 for _k, v in parts if v["kind"] == "bolme")
    assert any(v["table_id"] == "T27" for _k, v in parts)


@pytest.mark.parametrize("query,expected", [
    ("bank krediti və maliyyələşmə mənbələri", "S28"),
    ("pul axını cədvəli", "S42"),
    ("rəqiblər barədə nə yazılıb", "S21"),
])
def test_axtarış_mənaca_uyğun_bölməni_tapır(doc, query, expected):
    hits = memory.search_document(doc, query, limit=3)
    assert hits and hits[0]["section_id"] == expected
    assert hits[0]["score"] >= hits[-1]["score"]


def test_indeks_bir_dəfə_qurulur_eyni_sənəd_üçün(doc, monkeypatch):
    memory.index_document(doc)
    calls = []
    real = memory.store().put
    monkeypatch.setattr(memory.store(), "put", lambda *a, **k: (calls.append(a), real(*a, **k)))
    memory.index_document(doc)
    assert calls == []                                  # açar sənədin heşidir — təkrar vektorlaşdırma yoxdur


def test_embeddings_xətası_yoxlamanı_pozmur(samples, monkeypatch):
    class Broken(embeddings.LexicalHashEmbeddings):
        def embed_documents(self, texts):
            raise RuntimeError("şəbəkə yoxdur")

        def embed_query(self, text):
            raise RuntimeError("şəbəkə yoxdur")

    memory.reset()
    embeddings.set_override(Broken())
    try:
        storage.init()
        check_id = uuid.uuid4().hex[:12]
        storage.create(check_id, "Yaddaş xətası", 1, "plan_demo_v1.docx", str(samples / "plan_demo_v1.docx"))
        service.run_check(check_id)
        assert storage.get(check_id)["run_state"] == "tamamlandi"
        # Vektor axtarışı alınmır — ehtiyat leksik axtarış işləyir (boş "tapılmadı" qaytarılmır).
        hits = memory.search_document({"sections": [{"id": "S1", "title": "x", "text": "y"}], "tables": []}, "y")
        assert hits and hits[0]["section_id"] == "S1" and hits[0]["via"] == "leksik"
    finally:
        embeddings.set_override(None)
        memory.reset()


def test_agentlərin_semantik_axtarış_aləti(doc):
    tools = {t.name: t for t in make_doc_tools(doc)}
    assert "search_document" in tools
    out = tools["search_document"].invoke({"query": "bank krediti"})
    assert "S28" in out and "oxşarlıq" in out


def test_planın_tapıntıları_versiyalar_arasında_yadda_qalır(samples):
    storage.init()
    plan = f"Yaddaş {uuid.uuid4().hex[:6]}"
    ids = []
    for version, name in ((1, "plan_demo_v1.docx"), (2, "plan_demo_v2.docx")):
        check_id = uuid.uuid4().hex[:12]
        storage.create(check_id, plan, version, name, str(samples / name))
        service.run_check(check_id)
        ids.append(check_id)
    hits = memory.recall_findings(plan, "Özünü ödəmə müddəti", limit=10)
    versions = {h["version"] for h in hits if h["ref"] == "pp"}
    assert versions == {1, 2}
    assert {h["status"] for h in hits if h["ref"] == "pp" and h["version"] == 1} == {"warn"}
    assert memory.recall_findings("başqa plan", "Özünü ödəmə müddəti") == []   # planlar qarışmır
