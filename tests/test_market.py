"""Bazar icmalı: CBAR bülleteni, Alpha Vantage, keş, vaxt limiti, köhnəlmiş məlumat, açar olmaması.

Şəbəkəyə çıxış yoxdur — `market.http_get` saxta cavablarla əvəz olunur.
"""
from __future__ import annotations

import json

import httpx
import pytest
from fastapi.testclient import TestClient

from app import config, market
from app.main import app

KEY = "AV-TEST-KEY-123"


def _cbar(date: str, usd: str, eur: str, try_: str, gold: str) -> bytes:
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<ValCurs Date="{date}" Name="AZN məzənnələri">
 <ValType Type="Bank metalları">
  <Valute Code="XAU"><Nominal>1 t.u.</Nominal><Name>Qızıl</Name><Value>{gold}</Value></Valute>
 </ValType>
 <ValType Type="Xarici valyutalar">
  <Valute Code="USD"><Nominal>1</Nominal><Name>1 ABŞ dolları</Name><Value>{usd}</Value></Valute>
  <Valute Code="EUR"><Nominal>1</Nominal><Name>1 Avro</Name><Value>{eur}</Value></Valute>
  <Valute Code="TRY"><Nominal>100</Nominal><Name>100 Türkiyə lirəsi</Name><Value>{try_}</Value></Valute>
 </ValType>
</ValCurs>""".encode()


class FakeHttp:
    """URL-ə görə cavab; `calls` sorğuları sayır, `fail` hamısını xətaya çevirir."""

    def __init__(self, routes):
        self.routes = routes
        self.calls: list[tuple[str, dict]] = []
        self.fail: Exception | None = None

    def __call__(self, url, params=None):
        self.calls.append((url, dict(params or {})))
        if self.fail:
            raise self.fail
        for key, (status, body) in self.routes.items():
            if key in url or (params and key == params.get("function")):
                content = body if isinstance(body, bytes) else json.dumps(body).encode()
                return httpx.Response(status, content=content)
        return httpx.Response(404, content=b"<html>yoxdur</html>")


@pytest.fixture(autouse=True)
def clean(monkeypatch):
    market.CACHE.clear()
    monkeypatch.setattr(market, "AV_MIN_INTERVAL", 0)       # testlərdə fasilə yoxdur (ayrıca yoxlanılır)
    monkeypatch.setattr(config, "MARKET_ENABLED", True)
    monkeypatch.setattr(config, "ALPHAVANTAGE_API_KEY", "")
    yield
    market.CACHE.clear()


@pytest.fixture()
def fixed_day(monkeypatch):
    """"Bu gün" — 06.10.2026 (bülleten yoxdur), dünən 05.10, srağagün 04.10."""
    from datetime import datetime

    class FixedDT(datetime):
        @classmethod
        def now(cls, tz=None):
            return datetime(2026, 10, 6, 9, 0, tzinfo=tz)

    monkeypatch.setattr(market, "datetime", FixedDT)


def _routes():
    return {
        "05.10.2026": (200, _cbar("05.10.2026", "1.7000", "1.9014", "3.4600", "7025.28")),
        "04.10.2026": (200, _cbar("04.10.2026", "1.7000", "1.9129", "3.4700", "7114.20")),
    }


def test_cbar_bülleteni_dərc_tarixi_və_vahid(monkeypatch, fixed_day):
    http = FakeHttp(_routes())
    monkeypatch.setattr(market, "http_get", http)
    fx = market.fx_block()
    assert fx["status"] == "ok"
    assert fx["bulletin_date"] == "05.10.2026"            # bu gün (06.10) bülleten yoxdur — dünənki
    assert fx["fetched_at"] != fx["bulletin_date"]         # sorğu vaxtı ayrıca
    items = {i["code"]: i for i in fx["items"]}
    assert items["USD"]["value"] == 1.7 and items["USD"]["unit"] == "AZN"
    assert items["TRY"]["value"] == 0.0346                 # 100 lirə üçün 3,46 → 1 lirə
    assert items["EUR"]["change_pct"] == -0.6
    gold = market.gold_item()
    assert gold["value"] == 7025.28 and gold["unit"] == "1 troya unsiyası" and gold["currency"] == "AZN"
    assert gold["change_pct"] == -1.25 and gold["as_of"] == "05.10.2026"


def test_keş_ikinci_sorğuda_mənbəyə_getmir(monkeypatch, fixed_day):
    http = FakeHttp(_routes())
    monkeypatch.setattr(market, "http_get", http)
    market.overview()
    first = len(http.calls)
    market.overview()
    assert len(http.calls) == first


def test_vaxt_limiti_keş_yoxdursa_məlumat_mövcud_deyil(monkeypatch):
    http = FakeHttp({})
    http.fail = httpx.ReadTimeout("yavaş")
    monkeypatch.setattr(market, "http_get", http)
    fx = market.fx_block()
    assert fx["status"] == "unavailable" and fx["items"] == []
    assert "Məlumat mövcud deyil" in fx["message"]
    assert market.gold_item()["status"] == "unavailable"


def test_mənbə_düşəndə_son_bülleten_köhnəlmiş_kimi(monkeypatch, fixed_day):
    http = FakeHttp(_routes())
    monkeypatch.setattr(market, "http_get", http)
    assert market.fx_block()["status"] == "ok"
    monkeypatch.setitem(market.TTL, "cbar", 0)               # keş köhnəlib
    http.fail = httpx.ConnectError("şəbəkə yoxdur")
    fx = market.fx_block()
    assert fx["status"] == "stale" and fx["items"][0]["value"] == 1.7
    assert "son alınan" in fx["message"]


def test_açar_yoxdursa_qoşulmayıb_və_sorğu_getmir(monkeypatch, fixed_day):
    http = FakeHttp(_routes())
    monkeypatch.setattr(market, "http_get", http)
    data = market.overview()
    assert [a["status"] for a in data["assets"]] == ["not_configured", "not_configured", "ok"]
    assert data["news"]["status"] == "not_configured"
    assert "ALPHAVANTAGE_API_KEY" in data["news"]["message"]
    assert not any("alphavantage" in url for url, _ in http.calls)
    assert "value" not in data["assets"][0]                  # rəqəm uydurulmur


def _av_routes():
    return {
        "GLOBAL_QUOTE": (200, {"Global Quote": {"05. price": "222.6400", "07. latest trading day": "2026-10-02",
                                                "10. change percent": "-1.3208%"}}),
        "BRENT": (200, {"name": "Brent", "unit": "dollars per barrel",
                        "data": [{"date": "2026-10-01", "value": "."}, {"date": "2026-09-30", "value": "75.00"},
                                 {"date": "2026-09-29", "value": "75.30"}]}),
        "NEWS_SENTIMENT": (200, {"feed": [
            {"title": "Pis keçid", "url": "javascript:alert(1)", "source": "X", "time_published": "20261005T080000"},
            {"title": "Bazarlar   həftəni yüksəlişlə bağladı", "url": "https://example.com/a", "source": "Reuters",
             "time_published": "20261005T143000"},
            {"title": "Neft qiymətləri sabitləşdi", "url": "https://example.com/b", "source": "Bloomberg",
             "time_published": "20261004T091500"},
            {"title": "Üçüncü", "url": "https://example.com/c", "source": "Y", "time_published": "x"}]}),
    }


def test_alpha_vantage_səhm_brent_xəbər(monkeypatch):
    monkeypatch.setattr(config, "ALPHAVANTAGE_API_KEY", KEY)
    http = FakeHttp(_av_routes())
    monkeypatch.setattr(market, "http_get", http)
    aapl = market.asset_item("aapl")
    assert (aapl["status"], aapl["value"], aapl["currency"], aapl["as_of"]) == ("ok", 222.64, "USD", "2026-10-02")
    assert aapl["change_pct"] == -1.3208 and aapl["as_of_label"] == "son ticarət günü"
    brent = market.asset_item("brent")
    assert (brent["value"], brent["unit"], brent["as_of"]) == (75.0, "1 barel", "2026-09-30")   # "." atılır
    assert brent["change_pct"] == -0.4
    news = market.news_block()
    assert [n["title"] for n in news["items"]] == ["Bazarlar həftəni yüksəlişlə bağladı", "Neft qiymətləri sabitləşdi"]
    assert news["items"][0]["published"] == "2026-10-05T14:30:00" and news["items"][0]["source"] == "Reuters"


def test_limit_cavabı_mövcud_deyil_və_açar_cavabda_yoxdur(monkeypatch):
    monkeypatch.setattr(config, "ALPHAVANTAGE_API_KEY", KEY)
    http = FakeHttp({"GLOBAL_QUOTE": (200, {"Note": f"limit aşıldı, açar {KEY}"}),
                     "BRENT": (500, {}), "NEWS_SENTIMENT": (200, {"Information": "premium"})})
    monkeypatch.setattr(market, "http_get", http)
    data = market.overview()
    assert data["assets"][0]["status"] == "unavailable" and data["assets"][1]["status"] == "unavailable"
    assert data["news"]["status"] == "unavailable"
    assert KEY not in json.dumps(data, ensure_ascii=False)


def test_api_bütün_mənbələr_düşəndə_də_200_və_yoxlama_işləyir(monkeypatch, samples):
    http = FakeHttp({})
    http.fail = httpx.ConnectError("yoxdur")
    monkeypatch.setattr(market, "http_get", http)
    with TestClient(app) as client:
        data = client.get("/api/market").json()
        assert data["fx"]["status"] == "unavailable"
        with open(samples / "plan_demo_v1.docx", "rb") as fh:
            created = client.post("/api/checks", files={"file": ("plan.docx", fh, "application/octet-stream")},
                                  data={"plan_id": "Bazar düşüb", "fail_at": ""})
        assert created.status_code == 200


def test_söndürülmüş_rejim(monkeypatch):
    monkeypatch.setattr(config, "MARKET_ENABLED", False)
    http = FakeHttp({})
    monkeypatch.setattr(market, "http_get", http)
    data = market.overview()
    assert data["enabled"] is False and data["fx"]["status"] == "disabled" and http.calls == []


def test_alpha_vantage_sorğuları_arasında_fasilə(monkeypatch):
    """Pulsuz tarif ardıcıl sorğuları rədd edir — hər sorğudan əvvəl lazımi qədər gözlənilir."""
    monkeypatch.setattr(config, "ALPHAVANTAGE_API_KEY", KEY)
    monkeypatch.setattr(market, "AV_MIN_INTERVAL", 1.1)
    monkeypatch.setattr(market, "_av_last", 0.0)
    clock = {"t": 100.0}
    sleeps: list[float] = []
    monkeypatch.setattr(market.time, "monotonic", lambda: clock["t"])
    monkeypatch.setattr(market.time, "sleep", lambda s: (sleeps.append(round(s, 2)), clock.__setitem__("t", clock["t"] + s)))
    monkeypatch.setattr(market, "http_get", FakeHttp(_av_routes()))
    market.asset_item("aapl")
    market.asset_item("brent")
    assert sleeps == [1.1]                                   # ikinci sorğu birincidən dərhal sonra gözləyir
