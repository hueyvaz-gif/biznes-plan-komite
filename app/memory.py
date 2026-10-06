"""Semantik yaddaş — LangGraph `SqliteStore` (sqlite-vec vektor indeksi) üzərində.

İki ad sahəsi (namespace):
  • ("sened", <sənəd heşi>)      — sənədin bölmə və cədvəl parçaları (RAG). Açar sənədin MƏZMUN
                                   heşidir: qrafın agentləri və AI köməkçi eyni indeksdən istifadə
                                   edir, eyni sənəd iki dəfə vektorlaşdırılmır.
  • ("tapinti", <plan heşi>)     — planın BÜTÜN versiyalarının tapıntıları (tələb statusları,
                                   maliyyə yoxlamaları) — uzunmüddətli yaddaş: "əvvəlki versiyada
                                   bu problem var idimi?".

Qaydalar:
  • Yaddaş köməkçidir: hər xəta burada tutulur, yoxlama və status ondan asılı deyil.
  • Yaddaşdakı mətn istifadəçinin sənədidir — agentlərə MƏLUMAT kimi verilir, təlimat kimi yox.
  • Embeddings rejimi (`app.embeddings.mode`) dəyişəndə ölçü də dəyişir — ona görə hər rejimin öz faylı var.
"""
from __future__ import annotations

import hashlib
import logging
import math
import re
import sqlite3
import threading
import time
from typing import Any

from app import config, embeddings
from app.ingest import render_table

log = logging.getLogger(__name__)

CHUNK_CHARS = 1200
CHUNK_OVERLAP = 150
TABLE_ROWS = 25

_lock = threading.RLock()
_stores: dict[str, Any] = {}

#: Google embeddings xəta verəndə bu qədər saniyə yenidən sınanmır — hər axtarış 15–40 san gözləməsin.
SEMANTIC_COOLDOWN = 600
_semantic_down_until = 0.0
#: Ehtiyat leksik axtarış üçün sənəd parçalarının vektorları (sənəd açarı → [(dəyər, vektor)]).
_lexical_cache: dict[str, list[tuple[dict[str, Any], list[float]]]] = {}
_LEXICAL_CACHE_MAX = 8
_KEY_RE = re.compile(r"AIza[0-9A-Za-z_\-]{20,}")


def _reason(exc: BaseException) -> str:
    """Xətanın qısa təsviri loga — açara oxşar hər şey gizlədilir."""
    text = _KEY_RE.sub("***", " ".join(str(exc).split()))[:200]
    return f"{type(exc).__name__}: {text}" if text else type(exc).__name__


def semantic_available() -> bool:
    """Semantik (Google) axtarış hazırda istifadə oluna bilərmi (son xətadan sonra fasilə bitibmi)."""
    return time.monotonic() >= _semantic_down_until


def _semantic_failed(exc: BaseException, what: str) -> None:
    global _semantic_down_until
    if embeddings.mode()["id"] == "google" and embeddings.is_quota_error(exc):
        # Kvota — yalnız xidmətin dediyi qədər fasilə (adətən < 1 dəq), sonra yenidən semantik.
        pause = max(5.0, embeddings.retry_after(exc))
        _semantic_down_until = max(_semantic_down_until, time.monotonic() + pause)
        log.info("semantik yaddaş: %s — kvota doludur, %.0f san leksik axtarış", what, pause)
    elif embeddings.mode()["id"] == "google":
        _semantic_down_until = time.monotonic() + SEMANTIC_COOLDOWN
        log.warning("semantik yaddaş: %s alınmadı (%s) — %d dəq. leksik axtarışa keçilir",
                    what, _reason(exc), SEMANTIC_COOLDOWN // 60)
    else:
        log.warning("semantik yaddaş: %s alınmadı (%s)", what, _reason(exc))


def _store_usable() -> bool:
    return embeddings.mode()["id"] != "google" or semantic_available()


def _key(text: str) -> str:
    """Namespace etiketi nöqtə saxlaya bilməz — heş istifadə olunur."""
    return hashlib.sha1((text or "").encode("utf-8")).hexdigest()[:16]


def doc_key(doc: dict[str, Any]) -> str:
    body = "\n".join(s["id"] + s["title"] + (s.get("text") or "") for s in doc.get("sections", []))
    body += "\n".join(t["id"] + " | ".join(" | ".join(r) for r in t.get("rows", [])) for t in doc.get("tables", []))
    return _key(body)


def store() -> Any:
    """Rejimə uyğun store (tək nüsxə). Fayl: DATA_DIR/memory-<rejim>-<ölçü>.db"""
    from langgraph.store.sqlite import SqliteStore

    current = embeddings.mode()
    name = f"{current['id']}-{current['dims']}"
    with _lock:
        if name not in _stores:
            config.ensure_dirs()
            conn = sqlite3.connect(config.DATA_DIR / f"memory-{name}.db", check_same_thread=False,
                                   isolation_level=None)
            st = SqliteStore(conn, index={"dims": current["dims"], "embed": embeddings.get_embeddings(),
                                          "fields": ["text"]})
            st.setup()
            _stores[name] = st
        return _stores[name]


def reset() -> None:
    """Testlər üçün: açıq store-ları bağlayır, fasilə və ehtiyat keşi sıfırlanır."""
    global _semantic_down_until
    with _lock:
        _semantic_down_until = 0.0
        _lexical_cache.clear()
        _indexing.clear()
        for st in _stores.values():
            try:
                st.conn.close()
            except Exception:
                pass
        _stores.clear()


# ── Sənəd yaddaşı ──────────────────────────────────────────────────────────

def _split(text: str) -> list[str]:
    text = (text or "").strip()
    if len(text) <= CHUNK_CHARS:
        return [text] if text else []
    parts, start = [], 0
    while start < len(text):
        end = min(len(text), start + CHUNK_CHARS)
        cut = text.rfind("\n", start + CHUNK_CHARS // 2, end) if end < len(text) else end
        end = cut if cut > start else end
        parts.append(text[start:end].strip())
        start = max(end - CHUNK_OVERLAP, start + 1) if end < len(text) else end
    return [p for p in parts if p]


def chunks(doc: dict[str, Any]) -> list[tuple[str, dict[str, Any]]]:
    """(açar, dəyər) cütləri: bölmə parçaları və cədvəllər (başlıq və istinadla)."""
    out: list[tuple[str, dict[str, Any]]] = []
    for section in doc.get("sections", []):
        for i, part in enumerate(_split(section.get("text") or "")):
            out.append((f"{section['id']}#{i}", {
                "text": f"{section['title']}\n{part}", "kind": "bolme",
                "section_id": section["id"], "section_title": section["title"], "table_id": None}))
    for table in doc.get("tables", []):
        rendered = render_table(table, max_rows=TABLE_ROWS)
        if rendered.strip():
            out.append((f"{table['id']}", {
                "text": f"{table.get('caption') or 'Cədvəl'} ({table.get('section_title') or ''})\n{rendered}",
                "kind": "cedvel", "section_id": table.get("section_id"),
                "section_title": table.get("section_title"), "table_id": table["id"]}))
    return out


#: Hazırda indekslənən sənədlər — eyni sənəd iki dəfə vektorlaşdırılmır.
_indexing: set[str] = set()


class IndexPending(RuntimeError):
    """Sənəd hələ indekslənir (arxa fonda) — bu müddətdə leksik axtarış."""


def _indexed(key: str) -> bool:
    return store().get(("sened", key), "_meta") is not None


def _index(doc: dict[str, Any]) -> str:
    """Sənədi bir dəfə indeksləyir. Bütün parçalar BİR toplu yazı ilə (embeddings kvotaya uyğun
    hissələrlə). Ümumi kilid vektorlaşdırma zamanı TUTULMUR — digər axtarışlar gözləmir."""
    from langgraph.store.base import PutOp

    key = doc_key(doc)
    namespace = ("sened", key)
    st = store()
    with _lock:
        if st.get(namespace, "_meta") is not None:
            return key
        if key in _indexing:
            raise IndexPending(key)
        _indexing.add(key)
    try:
        parts = chunks(doc)
        ops = [PutOp(namespace, item_key, value) for item_key, value in parts]
        # "_meta" ən sonda yazılır: yarımçıq indeks tam sayılmır və növbəti dəfə tamamlanır.
        ops.append(PutOp(namespace, "_meta", {"file_name": doc.get("file_name"), "count": len(parts)},
                         index=False))
        st.batch(ops)
    finally:
        with _lock:
            _indexing.discard(key)
    return key


def index_document(doc: dict[str, Any]) -> str | None:
    """Sənədi bir dəfə indeksləyir; açarı qaytarır (xəta olsa None — yoxlama pozulmur).
    Google rejimində kvotaya görə gözləyə bilər — yoxlama bitəndən sonra çağırılır."""
    if not _store_usable():
        return None
    try:
        return _index(doc)
    except IndexPending:
        return None
    except Exception as exc:                      # embeddings/şəbəkə xətası yoxlamanı pozmur
        _semantic_failed(exc, "sənədin indekslənməsi")
        return None


def _index_in_background(doc: dict[str, Any]) -> None:
    """Agent axtarışı indeksi GÖZLƏMİR: indeks arxa fonda qurulur, o vaxta qədər leksik axtarış."""
    key = doc_key(doc)
    with _lock:
        if key in _indexing:
            return
    threading.Thread(target=index_document, args=(doc,), name=f"indeks-{key[:6]}", daemon=True).start()


def _lexical_search(doc: dict[str, Any], query: str, limit: int) -> list[dict[str, Any]]:
    """Ehtiyat axtarış: lokal leksik vektorlar (şəbəkəsiz, pulsuz, sinonimləri tanımır)."""
    lexical = embeddings.LexicalHashEmbeddings()
    key = doc_key(doc)
    with _lock:
        vectors = _lexical_cache.get(key)
        if vectors is None:
            parts = [value for _key_, value in chunks(doc)]
            vectors = list(zip(parts, lexical.embed_documents([v["text"] for v in parts])))
            if len(_lexical_cache) >= _LEXICAL_CACHE_MAX:
                _lexical_cache.pop(next(iter(_lexical_cache)))
            _lexical_cache[key] = vectors
    q = lexical.embed_query(query)
    scored = sorted(((sum(a * b for a, b in zip(q, v)), value) for value, v in vectors),
                    key=lambda pair: pair[0], reverse=True)
    return [{**value, "score": round(score, 3), "via": "leksik"}
            for score, value in scored[:limit] if score > 0 and not math.isnan(score)]


def search_document(doc: dict[str, Any], query: str, limit: int = 4) -> list[dict[str, Any]] | None:
    """Sənəddə axtarış. Semantik axtarış alınmasa — leksik ehtiyat axtarış.

    Qaytarır: tapılan parçalar (boş siyahı = həqiqətən tapılmadı) və ya None — axtarış
    ÜMUMİYYƏTLƏ işləmədi (bu, "sənəddə yoxdur" demək deyil).
    """
    if not (query or "").strip():
        return []
    if _store_usable():
        try:
            key = doc_key(doc)
            if embeddings.mode()["id"] == "google" and not _indexed(key):
                _index_in_background(doc)          # Google: indeks hazır deyil — gözləmədən leksik
                raise IndexPending(key)
            key = _index(doc)                      # lokal rejim: indeks sürətlidir, dərhal qurulur
            results = store().search(("sened", key), query=query, limit=limit + 1)
            via = "semantik" if embeddings.mode()["semantic"] else "leksik"
            return [{**item.value, "score": round(float(item.score or 0), 3), "via": via}
                    for item in results if item.key != "_meta"][:limit]
        except IndexPending:
            pass
        except Exception as exc:
            _semantic_failed(exc, "axtarış")
    try:
        return _lexical_search(doc, query, limit)
    except Exception as exc:
        log.warning("semantik yaddaş: ehtiyat axtarış da alınmadı (%s)", _reason(exc))
        return None


#: Axtarış işləməyəndə agentə AÇIQ deyilir — "tapılmadı" "sənəddə yoxdur" kimi başa düşülməsin.
SEARCH_UNAVAILABLE = ("Axtarış hazırda İŞLƏMİR (texniki səbəb) — bu, məlumatın sənəddə olmaması demək DEYİL. "
                      "Bölmələri list_sections/get_section, cədvəlləri list_tables/get_table ilə birbaşa aç.")


def format_hits(hits: list[dict[str, Any]] | None, max_chars: int = 900) -> str:
    if hits is None:
        return SEARCH_UNAVAILABLE
    if not hits:
        return "Uyğun parça tapılmadı."
    lines = []
    if embeddings.mode()["semantic"] and any(h.get("via") == "leksik" for h in hits):
        lines.append("(Semantik axtarış hazırda işləmir — nəticələr sadə söz uyğunluğu ilə tapılıb; "
                     "sinonimlər tapılmaya bilər, lazım olsa bölmələri birbaşa aç.)")
    for h in hits:
        ref = h["section_id"] + (f" / {h['table_id']}" if h.get("table_id") else "")
        body = h["text"] if len(h["text"]) <= max_chars else h["text"][:max_chars] + "…"
        lines.append(f"[{ref} — {h.get('section_title') or ''} · oxşarlıq {h['score']}]\n{body}")
    return "\n\n".join(lines)


# ── Planın uzunmüddətli yaddaşı ────────────────────────────────────────────

def remember_findings(check: dict[str, Any]) -> int:
    """Tamamlanmış yoxlamanın tapıntılarını planın yaddaşına yazır. Yazılan sayı."""
    result = check.get("result") or {}
    namespace = ("tapinti", _key(check["plan_id"]))
    if not _store_usable():
        return 0
    from langgraph.store.base import PutOp

    ops = []
    for item in (result.get("compliance") or {}).get("items") or []:
        text = (f"{item.get('req_id')} [{item.get('status')}] {item.get('text')}"
                + (f" Çatışmayan: {item['missing']}" if item.get("missing") else ""))
        ops.append(PutOp(namespace, f"{check['id']}:{item.get('req_id')}", {
            "text": text, "kind": "teleb", "ref": item.get("req_id"), "status": item.get("status"),
            "version": check["version"], "check_id": check["id"]}))
    for c in (result.get("finance") or {}).get("checks") or []:
        text = (f"{c.get('title')} [{c.get('status')}] planda {c.get('claimed')}, "
                f"hesablanan {c.get('computed')}. {c.get('detail') or ''}")
        ops.append(PutOp(namespace, f"{check['id']}:{c.get('id')}", {
            "text": text, "kind": "maliyye", "ref": c.get("id"), "status": c.get("status"),
            "version": check["version"], "check_id": check["id"]}))
    count = 0
    try:
        with _lock:
            if ops:
                store().batch(ops)            # bir toplu yazı — embeddings bir neçə sorğu ilə
            count = len(ops)
    except Exception as exc:
        _semantic_failed(exc, "tapıntıların yazılması")
    return count


def forget(plan_id: str, doc_keys: set[str]) -> int:
    """Planın tapıntılarını və (başqa yoxlamada istifadə olunmayan) sənəd parçalarını
    BÜTÜN yaddaş fayllarından silir (google/lexical rejimlərinin hər biri). Silinən sətir sayı."""
    prefixes = ["tapinti." + _key(plan_id), *("sened." + k for k in doc_keys)]
    marks = ",".join("?" * len(prefixes))
    removed = 0
    with _lock:
        for path in sorted(config.DATA_DIR.glob("memory-*.db")):
            conn = sqlite3.connect(path)
            try:
                tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
                with conn:
                    for table in ("store_vectors", "store"):
                        if table in tables:
                            removed += conn.execute(f"DELETE FROM {table} WHERE prefix IN ({marks})",
                                                    prefixes).rowcount
            finally:
                conn.close()
    return removed


def recall_findings(plan_id: str, query: str, limit: int = 6) -> list[dict[str, Any]]:
    if not _store_usable():
        return []
    try:
        results = store().search(("tapinti", _key(plan_id)), query=query, limit=limit)
    except Exception as exc:
        _semantic_failed(exc, "tapıntıların oxunması")
        return []
    return [{**r.value, "score": round(float(r.score or 0), 3)} for r in results]


def status() -> dict[str, Any]:
    current = embeddings.mode()
    return {"mode": current["id"], "label": current["label"], "semantic": current["semantic"],
            "dims": current["dims"]}
