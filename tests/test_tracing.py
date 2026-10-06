"""LangSmith izləmə konfiqurasiyası (şəbəkəsiz): daxili agentin izi yoxlamaya bağlı qalır.

Real LangSmith-ə sorğu getmir — yalnız ötürülən konfiqurasiya yoxlanılır.
"""
from __future__ import annotations

import uuid

from app import service, storage
from app.agents import extra_requirements
from app.agents.finance import child_config


def test_daxili_agent_valideynin_teq_və_metadatasını_saxlayır():
    parent = {"tags": ["biznes-plan-komite", "plan:X"], "metadata": {"check_id": "abc", "plan_id": "X"},
              "callbacks": ["cb"], "configurable": {"thread_id": "abc"}}
    child = child_config(parent, ["elave_telebler"], {"agent": "elave"})
    assert child["tags"] == ["biznes-plan-komite", "plan:X", "elave_telebler"]
    assert child["metadata"] == {"check_id": "abc", "plan_id": "X", "agent": "elave"}
    assert child["callbacks"] == ["cb"] and "configurable" not in child    # thread_id ötürülmür


def test_əlavə_tələb_çıxarışının_izi_yoxlamanın_adını_daşıyır(samples, monkeypatch):
    seen = {}

    def fake_extract(attachments, config=None):
        seen.update(config or {})
        return {"items": [], "rejected": [], "truncated": [], "error": None, "limits": {}, "over_limit_items": []}

    monkeypatch.setattr(extra_requirements, "extract", fake_extract)
    storage.init()
    check_id = uuid.uuid4().hex[:12]
    storage.create(check_id, "İz planı", 1, "plan_demo_v1.docx", str(samples / "plan_demo_v1.docx"))
    storage.extras_create(check_id, [{"id": "A1", "name": "t.txt", "kind": "metn", "size": 1, "sha256": "x",
                                      "stored": None, "status": "oxundu", "error": None,
                                      "parts": [{"ref": "abzas 1", "text": "Tələb: test"}], "chars": 11}])
    service.extract_requirements(check_id)
    assert seen["run_name"] == "Əlavə tələblər: İz planı v1"
    assert "biznes-plan-komite" in seen["tags"]
    assert seen["metadata"]["check_id"] == check_id and seen["metadata"]["plan_id"] == "İz planı"
