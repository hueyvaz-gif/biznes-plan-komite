"""Bazar icmalı — açıq mənbələrdən, keşlə və vaxt limiti ilə.

Mənbələr:
  • Valyutalar (USD, EUR, TRY → AZN) və qızıl: AR Mərkəzi Bankının gündəlik XML
    bülleteni (https://www.cbar.az/currencies/DD.MM.YYYY.xml). Açar tələb etmir.
    Bülletenin tarixi ("dərc tarixi") sorğunun vaxtı ilə qarışdırılmır — ayrıca qaytarılır.
  • AAPL, Brent və maliyyə xəbərləri: Alpha Vantage. `ALPHAVANTAGE_API_KEY` yoxdursa
    bu hissələr "Mənbə qoşulmayıb" kimi qaytarılır — heç bir rəqəm uydurulmur.

Qaydalar:
  • Hər mənbə üçün keş (TTL); mənbə xəta versə, son uğurlu cavab `stale=True` ilə
    verilir, yoxdursa "Məlumat mövcud deyil".
  • Bu modul sənəd yoxlamasından tam asılı deyil: hər xəta burada tutulur.
  • Açar heç bir cavaba, loga və ya xəta mətninə yazılmır.
"""
from __future__ import annotations

import logging
import threading
import time
import xml.etree.ElementTree as ET
from datetime import date, datetime, timedelta, timezone
from typing import Any, Callable

import httpx

from app import config

log = logging.getLogger(__name__)

BAKU = timezone(timedelta(hours=4))
CBAR_URL = "https://www.cbar.az/currencies/{d}.xml"
CBAR_SOURCE = {"name": "AR Mərkəzi Bankı", "url": "https://www.cbar.az/currency/rates"}
AV_URL = "https://www.alphavantage.co/query"
AV_SOURCE = {"name": "Alpha Vantage", "url": "https://www.alphavantage.co/"}

FX_CODES = ("USD", "EUR", "TRY")
MAX_BYTES = 1_000_000

#: Keş müddətləri (saniyə). Alpha Vantage-in pulsuz limiti azdır — sorğular seyrək olmalıdır.
TTL = {"cbar": 3600, "aapl": 1800, "brent": 6 * 3600, "news": 3600}

NOT_CONFIGURED = "Mənbə qoşulmayıb: serverdə ALPHAVANTAGE_API_KEY təyin edilməyib."
UNAVAILABLE = "Məlumat mövcud deyil: mənbə cavab vermədi."
DISABLED = "Bazar icmalı söndürülüb (MARKET_ENABLED=0)."


class SourceError(Exception):
    """Mənbədən istifadə oluna bilən cavab alınmadı (mətn istifadəçiyə göstərilmir)."""


# ── HTTP (testlərdə əvəz olunur) ───────────────────────────────────────────

def http_get(url: str, params: dict[str, str] | None = None) -> httpx.Response:
    with httpx.Client(timeout=config.MARKET_TIMEOUT, follow_redirects=False,
                      headers={"User-Agent": "biznes-plan-komite/1.0"}) as client:
        return client.get(url, params=params)


def _get(url: str, params: dict[str, str] | None = None) -> httpx.Response:
    try:
        response = http_get(url, params)
    except httpx.TimeoutException as exc:
        raise SourceError("timeout") from exc
    except httpx.HTTPError as exc:
        raise SourceError(type(exc).__name__) from exc
    if len(response.content) > MAX_BYTES:
        raise SourceError("cavab çox böyükdür")
    return response


# ── Keş ────────────────────────────────────────────────────────────────────

class _Cache:
    def __init__(self) -> None:
        self._data: dict[str, tuple[float, dict[str, Any]]] = {}
        self._locks: dict[str, threading.Lock] = {}
        self._guard = threading.Lock()

    def clear(self) -> None:
        with self._guard:
            self._data.clear()

    def _lock(self, key: str) -> threading.Lock:
        with self._guard:
            return self._locks.setdefault(key, threading.Lock())

    def get(self, key: str, loader: Callable[[], dict[str, Any]]) -> dict[str, Any]:
        """Təzə keş → olduğu kimi; köhnəlib → yenidən yüklə; xəta → köhnə (stale) və ya None."""
        with self._lock(key):                      # eyni mənbəyə paralel sorğu getmir
            cached = self._data.get(key)
            now = time.monotonic()
            if cached and now - cached[0] < TTL[key]:
                return {**cached[1], "stale": False}
            try:
                value = loader()
            except SourceError as exc:
                log.warning("bazar mənbəyi %s: %s", key, exc)   # açar loga düşmür
                if cached:
                    return {**cached[1], "stale": True}
                raise
            value["fetched_at"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
            self._data[key] = (now, value)
            return {**value, "stale": False}


CACHE = _Cache()


# ── AR Mərkəzi Bankı ───────────────────────────────────────────────────────

def _cbar_bulletin(day: date) -> dict[str, Any] | None:
    """Bir günün bülleteni; o gün üçün dərc edilməyibsə None."""
    response = _get(CBAR_URL.format(d=day.strftime("%d.%m.%Y")))
    if response.status_code == 404:
        return None
    if response.status_code != 200:
        raise SourceError(f"HTTP {response.status_code}")
    try:
        root = ET.fromstring(response.content)
    except ET.ParseError:
        return None                                # həftəsonu və s. üçün HTML qaytarıla bilər
    if root.tag != "ValCurs":
        return None
    values: dict[str, dict[str, Any]] = {}
    for node in root.iter("Valute"):
        code = node.get("Code") or ""
        try:
            nominal = float((node.findtext("Nominal") or "1").split()[0].replace(",", "."))
            value = float((node.findtext("Value") or "").replace(",", "."))
        except ValueError:
            continue
        values[code] = {"value": value, "nominal": nominal,
                        "nominal_text": (node.findtext("Nominal") or "").strip()}
    if "USD" not in values:
        return None
    return {"date": root.get("Date") or day.strftime("%d.%m.%Y"), "values": values}


def _find_bulletin(start: date, days: int = 7) -> tuple[date, dict[str, Any]]:
    for back in range(days):
        day = start - timedelta(days=back)
        bulletin = _cbar_bulletin(day)
        if bulletin:
            return day, bulletin
    raise SourceError("son günlərdə bülleten tapılmadı")


def _load_cbar() -> dict[str, Any]:
    today = datetime.now(BAKU).date()
    day, current = _find_bulletin(today)
    previous: dict[str, Any] | None = None
    try:
        _d, previous = _find_bulletin(day - timedelta(days=1))
    except SourceError:
        previous = None                            # dəyişmə göstərilmir, qiymət göstərilir
    return {"current": current, "previous": previous}


def _per_unit(entry: dict[str, Any]) -> float:
    return entry["value"] / (entry["nominal"] or 1)


def _change_pct(now: float | None, before: float | None) -> float | None:
    if now is None or not before:
        return None
    return round((now - before) / before * 100, 2)


def fx_block() -> dict[str, Any]:
    try:
        data = CACHE.get("cbar", _load_cbar)
    except SourceError:
        return {"status": "unavailable", "message": UNAVAILABLE, "source": CBAR_SOURCE, "items": []}
    current, previous = data["current"], data.get("previous")
    items = []
    for code in FX_CODES:
        entry = current["values"].get(code)
        if not entry:
            continue
        before = previous["values"].get(code) if previous else None
        value = _per_unit(entry)
        items.append({"code": code, "pair": f"{code}/AZN", "value": round(value, 4), "unit": "AZN",
                      "nominal": entry["nominal_text"],
                      "change_pct": _change_pct(value, _per_unit(before) if before else None)})
    return {"status": "stale" if data["stale"] else "ok", "source": CBAR_SOURCE,
            "bulletin_date": current["date"], "fetched_at": data["fetched_at"],
            "message": None if not data["stale"] else "Mənbə cavab vermədi — son alınan bülleten.",
            "items": items}


def gold_item() -> dict[str, Any]:
    base = {"id": "gold", "label": "Qızıl", "unit": "1 troya unsiyası", "currency": "AZN",
            "source": CBAR_SOURCE, "as_of_label": "bülleten tarixi"}
    try:
        data = CACHE.get("cbar", _load_cbar)
    except SourceError:
        return {**base, "status": "unavailable", "message": UNAVAILABLE}
    entry = data["current"]["values"].get("XAU")
    if not entry:
        return {**base, "status": "unavailable", "message": "Bülletendə qızıl məzənnəsi yoxdur."}
    previous = data.get("previous")
    before = previous["values"].get("XAU") if previous else None
    value = _per_unit(entry)
    return {**base, "status": "stale" if data["stale"] else "ok", "value": round(value, 2),
            "change_pct": _change_pct(value, _per_unit(before) if before else None),
            "as_of": data["current"]["date"], "fetched_at": data["fetched_at"]}


# ── Alpha Vantage ──────────────────────────────────────────────────────────

#: Pulsuz Alpha Vantage tarifi ardıcıl sorğuları rədd edir — sorğular arasında fasilə.
AV_MIN_INTERVAL = 1.1
_av_lock = threading.Lock()
_av_last = 0.0


def _av(params: dict[str, str]) -> dict[str, Any]:
    global _av_last
    with _av_lock:
        wait = AV_MIN_INTERVAL - (time.monotonic() - _av_last)
        if wait > 0:
            time.sleep(wait)
        try:
            response = _get(AV_URL, {**params, "apikey": config.ALPHAVANTAGE_API_KEY})
        finally:
            _av_last = time.monotonic()
    if response.status_code != 200:
        raise SourceError(f"HTTP {response.status_code}")
    try:
        data = response.json()
    except ValueError as exc:
        raise SourceError("JSON deyil") from exc
    if not isinstance(data, dict) or {"Note", "Information", "Error Message"} & set(data):
        raise SourceError("limit və ya xəta cavabı")   # mətn göstərilmir (açar barədə ola bilər)
    return data


def _num(text: Any) -> float | None:
    try:
        return float(str(text).strip().rstrip("%"))
    except (TypeError, ValueError):
        return None


def _load_aapl() -> dict[str, Any]:
    quote = _av({"function": "GLOBAL_QUOTE", "symbol": "AAPL"}).get("Global Quote") or {}
    price = _num(quote.get("05. price"))
    if price is None:
        raise SourceError("qiymət yoxdur")
    return {"value": round(price, 2), "change_pct": _num(quote.get("10. change percent")),
            "as_of": quote.get("07. latest trading day")}


def _load_brent() -> dict[str, Any]:
    data = _av({"function": "BRENT", "interval": "daily"})
    points = [(p.get("date"), _num(p.get("value"))) for p in data.get("data") or []]
    points = [(d, v) for d, v in points if d and v is not None]
    if not points:
        raise SourceError("məlumat yoxdur")
    (day, value), before = points[0], (points[1][1] if len(points) > 1 else None)
    return {"value": round(value, 2), "change_pct": _change_pct(value, before), "as_of": day}


def _load_news() -> dict[str, Any]:
    data = _av({"function": "NEWS_SENTIMENT", "topics": "financial_markets", "sort": "LATEST",
                "limit": "20"})
    items = []
    for a in data.get("feed") or []:
        url = str(a.get("url") or "")
        title = " ".join(str(a.get("title") or "").split())[:200]
        if not title or not url.startswith(("https://", "http://")):
            continue                                   # javascript: və s. keçid qəbul edilmir
        items.append({"title": title, "url": url, "source": str(a.get("source") or "")[:80],
                      "published": _av_time(a.get("time_published"))})
        if len(items) == 2:
            break
    if not items:
        raise SourceError("xəbər yoxdur")
    return {"items": items}


def _av_time(text: Any) -> str | None:
    """"20261005T143000" → "2026-10-05T14:30:00" (mənbənin göstərdiyi vaxt, saat qurşağı əlavə edilmir)."""
    try:
        return datetime.strptime(str(text), "%Y%m%dT%H%M%S").isoformat()
    except (TypeError, ValueError):
        return None


ASSETS = {
    "aapl": {"label": "AAPL", "unit": "1 səhm (NASDAQ)", "currency": "USD", "loader": _load_aapl,
             "as_of_label": "son ticarət günü"},
    "brent": {"label": "Brent", "unit": "1 barel", "currency": "USD", "loader": _load_brent,
              "as_of_label": "son gündəlik qiymət"},
}


def asset_item(key: str) -> dict[str, Any]:
    spec = ASSETS[key]
    base = {"id": key, "label": spec["label"], "unit": spec["unit"], "currency": spec["currency"],
            "source": AV_SOURCE, "as_of_label": spec["as_of_label"]}
    if not config.ALPHAVANTAGE_API_KEY:
        return {**base, "status": "not_configured", "message": NOT_CONFIGURED}
    try:
        data = CACHE.get(key, spec["loader"])
    except SourceError:
        return {**base, "status": "unavailable", "message": UNAVAILABLE}
    return {**base, "status": "stale" if data["stale"] else "ok", "value": data["value"],
            "change_pct": data.get("change_pct"), "as_of": data.get("as_of"),
            "fetched_at": data["fetched_at"]}


def news_block() -> dict[str, Any]:
    if not config.ALPHAVANTAGE_API_KEY:
        return {"status": "not_configured", "message": NOT_CONFIGURED, "source": AV_SOURCE, "items": []}
    try:
        data = CACHE.get("news", _load_news)
    except SourceError:
        return {"status": "unavailable", "message": UNAVAILABLE, "source": AV_SOURCE, "items": []}
    return {"status": "stale" if data["stale"] else "ok", "source": AV_SOURCE, "items": data["items"],
            "fetched_at": data["fetched_at"], "message": None}


def overview() -> dict[str, Any]:
    """Bütün blok; heç bir mənbənin xətası bütöv cavabı pozmur."""
    generated = datetime.now(timezone.utc).isoformat(timespec="seconds")
    if not config.MARKET_ENABLED:
        off = {"status": "disabled", "message": DISABLED, "items": []}
        return {"generated_at": generated, "enabled": False, "fx": off, "assets": [], "news": off}
    return {
        "generated_at": generated,
        "enabled": True,
        "fx": fx_block(),
        "assets": [asset_item("aapl"), asset_item("brent"), gold_item()],
        "news": news_block(),
        "alphavantage_configured": bool(config.ALPHAVANTAGE_API_KEY),
    }
