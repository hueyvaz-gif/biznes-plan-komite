"""Embeddings — semantik yaddaş üçün mətnin vektora çevrilməsi.

İki rejim:
  • **Google (`GOOGLE_API_KEY` varsa):** `models/gemini-embedding-001` — çoxdilli, Azərbaycan dilini
    anlayan əsl semantik model. Vektor ölçüsü `EMBEDDINGS_DIMS` (susmaya görə 768).
  • **Lokal leksik (açar yoxdursa):** `LexicalHashEmbeddings` — söz və hərf üçlüklərinin heşi.
    Model yükləmir, pul və şəbəkə tələb etmir; amma ƏSL SEMANTİK MODEL DEYİL — eyni sözləri və
    oxşar söz köklərini tapır, sinonimləri yox. İnterfeys və cavablar rejimi açıq göstərir.

Açar heç yerə yazılmır. Rejim dəyişəndə (ölçü fərqli olduğu üçün) yaddaş ayrı faylda saxlanılır.
"""
from __future__ import annotations

import hashlib
import math
import os
import re
import threading
import time
import unicodedata
from collections import deque
from typing import Any, Callable

from langchain_core.embeddings import Embeddings

LEXICAL_DIMS = 512
_WORD_RE = re.compile(r"[^\W_]+", re.UNICODE)
#: Məna daşımayan sual və bağlayıcı sözlər — leksik axtarışı bulandırmasın (semantik model üçün lazım deyil).
STOPWORDS = frozenset("""
və ilə üçün da də ki bu o bir hansı hansında harada haradadır nə nədir necə niyə nəyə neçə kim mi mı mu mü
var yoxdur olan olub olunur olunub edilib edir edilir yazılıb yazılır göstərilib göstər deyir haqqında barədə
sənəd sənəddə sənədin sənəddə planda plan planın mənə bizə zəhmət izah et
""".split())


def _fold(text: str) -> str:
    text = unicodedata.normalize("NFKC", text or "").replace("İ", "i").replace("I", "ı").lower()
    return text


class LexicalHashEmbeddings(Embeddings):
    """Söz + hərf üçlüyü heşindən vektor (L2-normallaşdırılmış). Deterministikdir."""

    def __init__(self, dims: int = LEXICAL_DIMS) -> None:
        self.dims = dims

    def _features(self, text: str) -> dict[int, float]:
        counts: dict[int, float] = {}
        for word in _WORD_RE.findall(_fold(text)):
            if word in STOPWORDS:
                continue
            # kök (şəkilçidən əvvəlki hissə): "işçi" ~ "işçilərin", "investisiya" ~ "investisiyanın"
            grams = [word] + ([f"#{word[:4]}"] if len(word) >= 4 else []) + ([f"#{word[:6]}"] if len(word) >= 6 else [])
            padded = f"<{word}>"
            grams += [padded[i:i + 3] for i in range(len(padded) - 2)] if len(word) > 2 else []
            for gram in grams:
                digest = hashlib.blake2b(gram.encode("utf-8"), digest_size=8).digest()
                index = int.from_bytes(digest[:4], "little") % self.dims
                sign = 1.0 if digest[4] & 1 else -1.0
                weight = 1.0 if gram == word or gram.startswith("#") else 0.35
                counts[index] = counts.get(index, 0.0) + sign * weight
        return counts

    def _embed(self, text: str) -> list[float]:
        vector = [0.0] * self.dims
        for index, value in self._features(text).items():
            vector[index] = math.copysign(math.log1p(abs(value)), value)
        norm = math.sqrt(sum(v * v for v in vector)) or 1.0
        return [v / norm for v in vector]

    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        return [self._embed(t) for t in texts]

    def embed_query(self, text: str) -> list[float]:
        return self._embed(text)


# ── Kvota: Google pulsuz planı — dəqiqədə 100 mətn (toplu sorğuda hər mətn ayrıca sayılır) ──

class QuotaExceeded(RuntimeError):
    """Kvota dolub; `retry_after` saniyədən sonra yenidən sınamaq olar."""

    def __init__(self, retry_after: float) -> None:
        super().__init__(f"embeddings kvotası doludur — {retry_after:.0f} san sonra yenidən")
        self.retry_after = retry_after


_RETRY_RE = re.compile(r"retry in ([0-9.]+)\s*s", re.IGNORECASE)


def is_quota_error(exc: BaseException) -> bool:
    text = str(exc)
    return isinstance(exc, QuotaExceeded) or "RESOURCE_EXHAUSTED" in text or "429" in text.split(".")[0]


def retry_after(exc: BaseException, default: float = 30.0) -> float:
    """Xidmətin "Please retry in 22.2s" göstərişi (yoxdursa — susmaya görə), 65 san ilə məhdud."""
    if isinstance(exc, QuotaExceeded):
        return exc.retry_after
    match = _RETRY_RE.search(str(exc))
    return min(65.0, float(match.group(1)) + 1.0) if match else default


class RateWindow:
    """Sürüşən pəncərə: son `period` saniyədə ən çoxu `limit` mətn. Bütün axınlar üçün ortaq."""

    def __init__(self, limit: int, period: float = 60.0,
                 clock: Callable[[], float] = time.monotonic, sleep: Callable[[float], None] = time.sleep) -> None:
        self.limit, self.period, self.clock, self.sleep = limit, period, clock, sleep
        self._events: deque[tuple[float, int]] = deque()     # zamana görə sıralı
        self._blocked_until = 0.0                              # xidmətin 429 göstərişi
        self._lock = threading.Lock()

    def _wait_needed(self, n: int) -> float:
        now = self.clock()
        if now < self._blocked_until:
            return self._blocked_until - now
        while self._events and self._events[0][0] <= now - self.period:
            self._events.popleft()
        used = sum(count for _t, count in self._events)
        if used + n <= self.limit:
            return 0.0
        # Kifayət qədər yer açılana qədər: köhnə qeydlər bir-bir pəncərədən çıxır.
        free_needed = used + n - self.limit
        for at, count in self._events:
            free_needed -= count
            if free_needed <= 0:
                return max(0.01, at + self.period - now)
        return self.period

    def reserve(self, n: int, max_wait: float) -> bool:
        """`n` mətn üçün yer ayırır; lazım olsa gözləyir. `max_wait`-dən çox gözləmək lazımdırsa — False."""
        n = min(n, self.limit)
        waited = 0.0
        while True:
            with self._lock:
                wait = self._wait_needed(n)
                if wait == 0.0:
                    self._events.append((self.clock(), n))
                    return True
            if waited + wait > max_wait:
                return False
            step = min(wait, 5.0)
            self.sleep(step)
            waited += step

    def hint(self, n: int = 1) -> float:
        with self._lock:
            return self._wait_needed(n)

    def block(self, seconds: float) -> None:
        """Xidmət 429 qaytardı: pəncərə `seconds` müddətinə dolu sayılır (digər axınlar da gözləsin)."""
        with self._lock:
            self._blocked_until = max(self._blocked_until, self.clock() + seconds)


class RateLimitedEmbeddings(Embeddings):
    """Kvotaya uyğun embeddings: mətnləri pəncərəyə sığan hissələrlə göndərir, 429-da gözləyib təkrarlayır.

    • Sənəd indeksi (embed_documents) gözləyə bilər — arxa fonda işləyir (`doc_wait`).
    • Axtarış sorğusu (embed_query) agenti ləngitmir: kvota doludursa dərhal `QuotaExceeded` —
      yaddaş leksik axtarışa keçir.
    """

    def __init__(self, inner: Embeddings, window: RateWindow, doc_wait: float = 240.0,
                 query_wait: float = 2.0, retries: int = 2) -> None:
        self.inner, self.window = inner, window
        self.doc_wait, self.query_wait, self.retries = doc_wait, query_wait, retries

    def _call(self, fn: Callable[[], Any], n: int, max_wait: float, retries: int) -> Any:
        for attempt in range(retries + 1):
            if not self.window.reserve(n, max_wait):
                raise QuotaExceeded(max(1.0, self.window.hint(n)))
            try:
                return fn()
            except Exception as exc:
                if not is_quota_error(exc):
                    raise
                delay = retry_after(exc)
                self.window.block(delay)
                if attempt == retries:
                    raise QuotaExceeded(delay) from exc

    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        out: list[list[float]] = []
        size = max(1, self.window.limit)
        for start in range(0, len(texts), size):
            part = texts[start:start + size]
            out += self._call(lambda part=part: self.inner.embed_documents(part), len(part),
                              self.doc_wait, self.retries)
        return out

    def embed_query(self, text: str) -> list[float]:
        return self._call(lambda: self.inner.embed_query(text), 1, self.query_wait, 0)


#: Google pulsuz planı dəqiqədə 100 mətn qəbul edir — ehtiyatla 90 (EMBEDDINGS_PER_MINUTE ilə dəyişir).
_google_window: RateWindow | None = None


def google_window() -> RateWindow:
    global _google_window
    if _google_window is None:
        _google_window = RateWindow(int(os.getenv("EMBEDDINGS_PER_MINUTE", "90") or 90))
    return _google_window


def mode() -> dict[str, Any]:
    """Hazırkı rejim: ad, ölçü, semantik olub-olmadığı (açar qaytarılmır)."""
    provider = (os.getenv("EMBEDDINGS_PROVIDER") or "auto").strip().lower()   # auto | google | lexical
    if provider != "lexical" and os.getenv("GOOGLE_API_KEY", "").strip():
        dims = int(os.getenv("EMBEDDINGS_DIMS", "768") or 768)
        return {"id": "google", "label": "Google Gemini embeddings", "semantic": True, "dims": dims,
                "model": os.getenv("EMBEDDINGS_MODEL", "models/gemini-embedding-001")}
    return {"id": "lexical", "label": "Lokal leksik axtarış (semantik model qoşulmayıb)", "semantic": False,
            "dims": LEXICAL_DIMS, "model": "lexical-hash"}


_override: Embeddings | None = None


def set_override(embeddings: Embeddings | None) -> None:
    """Testlər üçün."""
    global _override
    _override = embeddings


def get_embeddings() -> Embeddings:
    if _override is not None:
        return _override
    current = mode()
    if current["id"] == "google":
        from langchain_google_genai import GoogleGenerativeAIEmbeddings
        return RateLimitedEmbeddings(
            GoogleGenerativeAIEmbeddings(model=current["model"], output_dimensionality=current["dims"]),
            google_window())
    return LexicalHashEmbeddings()
