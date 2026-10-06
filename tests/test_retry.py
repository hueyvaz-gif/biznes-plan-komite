"""Uğursuz qrupların təkrarı və restartdan sonra davam (yoxlama hesabatı, problem 7–8).

Saxta model çağırışları `call_log` ilə sayılır: uğurlu çağırış retry-da
TƏKRARLANMAMALIDIR.
"""
from __future__ import annotations

import uuid

import pytest
from fastapi.testclient import TestClient

from app import config, service, storage
from tests.fake_llm import FakeChatModel


class NasazSWOT(FakeChatModel):
    """SWOT qrupunda texniki xəta — `broken` False olana qədər."""

    broken: bool = True

    def _generate(self, messages, stop=None, run_manager=None, **kwargs):
        task = next((m.content for m in messages if m.type == "human"), "")
        if self.broken and "SWOT" in task:
            raise RuntimeError("Saxta nasazlıq: 503")
        return super()._generate(messages, stop, run_manager, **kwargs)


@pytest.fixture()
def make_check(samples):
    storage.init()

    def _make(file_name: str = "plan_demo_v1.docx", fail_at: str = "") -> str:
        check_id = uuid.uuid4().hex[:12]
        storage.create(check_id, f"Plan {check_id}", 1, file_name,
                       str(samples / file_name), fail_at)
        return check_id

    return _make


def _items(check_id):
    return {i["req_id"]: i for i in storage.get(check_id)["result"]["compliance"]["items"]}


def _use(model):
    config.set_llm_override(model)
    service.reset_graphs()


def test_texniki_xəta_sənəddə_çatışmazlıqdan_ayrı_göstərilir(make_check):
    _use(NasazSWOT())
    check_id = make_check()
    service.run_check(check_id)
    row = storage.get(check_id)

    assert row["run_state"] == "tamamlandi"
    sw1 = _items(check_id)["SW1"]
    assert sw1["status"] == "skip" and sw1["technical"] is True
    assert "Texniki nasazlıq" in sw1["missing"]
    compliance = row["result"]["compliance"]
    assert [g["group_id"] for g in compliance["failed_groups"]] == ["swot"]
    assert compliance["coverage"]["technical"] == 2
    codes = {r["code"] for r in row["result"]["reasons"]["reasons"]}
    assert "texniki_nasazliq" in codes
    assert row["verdict"] != "hazir"


def test_yalnız_uğursuz_qrup_təkrarlanır(make_check):
    model = NasazSWOT()
    _use(model)
    check_id = make_check()
    service.run_check(check_id)
    before = list(model.call_log)

    model.broken = False                              # nasazlıq aradan qalxıb
    service.retry_failed_groups(check_id)
    row = storage.get(check_id)
    retried = model.call_log[len(before):]

    assert row["run_state"] == "tamamlandi"
    assert _items(check_id)["SW1"]["status"] == "var"
    assert _items(check_id)["X1"]["status"] == "var"        # uğurlu nəticə itmədi
    assert "finance" not in retried                          # maliyyə yenidən çağırılmadı
    assert retried.count("compliance") == 3       # yalnız SWOT: list_sections + get_section + cavab
    assert row["result"]["compliance"]["failed_groups"] == []
    assert row["result"]["summary"]["headline"]


def test_api_uğursuz_qrup_təkrarı(make_check):
    from app.main import app

    model = NasazSWOT()
    _use(model)
    check_id = make_check()
    service.run_check(check_id)
    model.broken = False
    with TestClient(app) as client:
        response = client.post(f"/api/checks/{check_id}/retry-groups")
        assert response.status_code == 200
        assert response.json()["groups"] == ["swot"]
        # Uğursuz qrup qalmayıbsa — 409
        assert client.post(f"/api/checks/{check_id}/retry-groups").status_code == 409
    assert _items(check_id)["SW1"]["status"] == "var"


def test_restartdan_sonra_maliyyə_çıxarışı_təkrarlanmır(make_check, fake_llm, monkeypatch):
    """Çıxarış uğurlu, hesablama yıxılır; proses 'yenidən açılır' və davam edir."""
    import app.agents.finance as finance

    real = finance.run_checks
    calls = {"n": 0}

    def once_broken(*args, **kwargs):
        calls["n"] += 1
        if calls["n"] == 1:
            raise RuntimeError("Hesablamada süni xəta")
        return real(*args, **kwargs)

    monkeypatch.setattr(finance, "run_checks", once_broken)
    check_id = make_check()
    service.run_check(check_id)
    assert storage.get(check_id)["run_state"] == "xeta"
    located = fake_llm.call_log.count("finance")
    assert located == 2                                      # alət + struktur cavab

    service.reset_graphs()                                   # "proses bağlandı və açıldı"
    service.run_check(check_id, resume=True)

    assert storage.get(check_id)["run_state"] == "tamamlandi"
    assert fake_llm.call_log.count("finance") == located     # model YENİDƏN çağırılmadı


def test_restartdan_sonra_uğurlu_qruplar_təkrarlanmır(make_check, fake_llm, monkeypatch):
    """Qrup cavabları alınıb, sonrakı yoxlama yıxılır; davamda qruplar yaddaşdan gəlir."""
    import app.agents.compliance as compliance

    real = compliance.resolve_refs
    state = {"broken": True}

    def once_broken(*args, **kwargs):
        if state["broken"]:
            state["broken"] = False
            raise RuntimeError("Yoxlamada süni xəta")
        return real(*args, **kwargs)

    monkeypatch.setattr(compliance, "resolve_refs", once_broken)
    check_id = make_check()
    service.run_check(check_id)
    assert storage.get(check_id)["run_state"] == "xeta"
    asked = fake_llm.call_log.count("compliance")
    assert asked > 0

    service.reset_graphs()
    service.run_check(check_id, resume=True)

    assert storage.get(check_id)["run_state"] == "tamamlandi"
    assert fake_llm.call_log.count("compliance") == asked    # heç bir qrup yenidən soruşulmadı
