"""Agent jurnalı ("Agentlər nə etdi"): hadisələr, artımlı API, alət xətası, cəhdlər."""
from __future__ import annotations

import uuid

import pytest
from fastapi.testclient import TestClient

from app import config, service, storage
from app.events import EventLogger, summarize_tool
from tests.fake_llm import FakeChatModel


@pytest.fixture()
def run(samples):
    storage.init()

    def _run(fail_at="", file_name="plan_demo_v1.docx"):
        check_id = uuid.uuid4().hex[:12]
        storage.create(check_id, f"Jurnal {check_id}", 1, file_name, str(samples / file_name), fail_at)
        service.run_check(check_id)
        return check_id

    return _run


def _events(check_id, **filters):
    return [e for e in storage.events_list(check_id)
            if all(e.get(k) == v for k, v in filters.items())]


def test_alət_çağırışları_agentlərə_bağlanır(run):
    check_id = run()
    finance_tools = {e["name"] for e in _events(check_id, kind="tool", agent="maliyye")}
    assert "list_tables" in finance_tools
    comp = _events(check_id, kind="tool", agent="uygunluq")
    assert any(e["name"] == "list_sections" for e in comp)
    assert all(e["grp"] and "|" in e["grp"] for e in comp)          # hər çağırış qrupa bağlıdır
    assert len({e["grp"] for e in comp}) == 11                         # 11 standart qrup
    sec = next(e for e in comp if e["name"] == "get_section")
    assert sec["args"] == "section=S1" and sec["summary"].startswith("S1:")
    lt = next(e for e in _events(check_id, kind="tool", agent="maliyye") if e["name"] == "list_tables")
    assert lt["summary"] == "34 cədvəl" and lt["status"] == "ok" and lt["duration_ms"] >= 0


def test_qovşaq_llm_və_nəticə_hadisələri(run):
    check_id = run()
    nodes = [e["name"] for e in _events(check_id, kind="node")]
    for node in ("ingest", "finance", "compliance", "decide_status", "write_summary", "save"):
        assert node in nodes, node
    assert _events(check_id, kind="llm", agent="maliyye")               # LLM çağırışı sayılır
    results = _events(check_id, kind="result")
    assert {e["agent"] for e in results} >= {"maliyye", "uygunluq", "rey"}
    assert all(e["attempt"] == 1 for e in storage.events_list(check_id))


def test_model_mətni_saxlanılmır(run):
    check_id = run()
    for event in storage.events_list(check_id):
        for field in ("args", "summary"):
            assert len(event[field] or "") <= 200


def test_after_yalnız_yeni_hadisələri_qaytarır(run):
    from app.main import app
    check_id = run()
    with TestClient(app) as client:
        everything = client.get(f"/api/checks/{check_id}/events").json()
        middle = everything["events"][len(everything["events"]) // 2]["id"]
        newer = client.get(f"/api/checks/{check_id}/events", params={"after": middle}).json()
        assert all(e["id"] > middle for e in newer["events"])
        assert len(newer["events"]) == len([e for e in everything["events"] if e["id"] > middle])
        tail = client.get(f"/api/checks/{check_id}/events", params={"after": everything["last_id"]}).json()
        assert tail["events"] == [] and tail["last_id"] == everything["last_id"]
        assert client.get("/api/checks/yoxdur/events").status_code == 404


def test_mövcud_olmayan_bölmə_alət_xətası_kimi_yazılır(run):
    class Səhv(FakeChatModel):
        def _generate(self, messages, stop=None, run_manager=None, **kwargs):
            from langchain_core.messages import ToolMessage
            from tests.fake_llm import _tool_call
            if self._has("GroupResult") and sum(isinstance(m, ToolMessage) for m in messages) == 1:
                self.call_log.append("compliance")
                return _tool_call("get_section", {"section": "S999"})
            return super()._generate(messages, stop, run_manager, **kwargs)

    config.set_llm_override(Səhv())
    service.reset_graphs()
    check_id = run()
    errors = [e for e in _events(check_id, kind="tool", name="get_section") if e["status"] == "alət xətası"]
    assert errors and errors[0]["summary"].startswith("XƏTA")


def test_davamda_cəhd_artır_maliyyə_yenidən_çağırılmır(run):
    check_id = run(fail_at="compliance")
    first = storage.events_list(check_id)
    assert {e["attempt"] for e in first} == {1}
    assert any(e["kind"] == "node" and e["name"] == "compliance" and e["status"] == "xeta" for e in first)

    service.run_check(check_id, resume=True)
    second = [e for e in storage.events_list(check_id) if e["attempt"] == 2]
    assert second and len(storage.events_list(check_id)) > len(first)   # 1-ci cəhd silinmir
    assert not any(e["kind"] == "node" and e["name"] == "finance" for e in second)
    assert not any(e["agent"] == "maliyye" and e["kind"] in ("tool", "llm") for e in second)


def test_alət_nəticəsinin_xülasəsi():
    assert summarize_tool("list_sections", "S1 | a\nS2 | b") == ("2 bölmə", "ok")
    assert summarize_tool("get_table", "T27 | bölmə: X\ncap\nA | 1\nB | 2") == ("T27: 2 sətir", "ok")
    assert summarize_tool("get_section", "XƏTA: 'S9' tapılmadı.\nMövcud…")[1] == "alət xətası"


def test_jurnal_xətası_icranı_dayandırmır(run, monkeypatch):
    def broken(**_):
        raise OSError("disk dolub")
    monkeypatch.setattr(storage, "event_add", broken)
    check_id = run()
    assert storage.get(check_id)["run_state"] == "tamamlandi"
    assert EventLogger.raise_error is False
