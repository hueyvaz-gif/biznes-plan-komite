"""Texniki nasazlıqların qarşısı: (1) axtarış Google xətasında da işləyir və işləməyəndə bunu
açıq deyir; (2) tələb agenti addım büdcəsi bitəndə qrupu itirmir, yekun cavab verir.

Real embeddings/model çağırılmır: xəta verən saxta embeddings və saxta model.
"""
from __future__ import annotations

import time

import pytest

from app import config, embeddings, memory, storage
from app.agents import compliance
from app.agents.compliance import BUDGET_MISSING, build_compliance_graph, model_budget
from app.agents.doc_tools import make_doc_tools
from app.ingest import parse_docx
from tests.fake_llm import FakeChatModel


@pytest.fixture(scope="module")
def doc(samples):
    return parse_docx(samples / "plan_demo_v1.docx")


class BrokenEmbeddings(embeddings.LexicalHashEmbeddings):
    """Google xətasını təqlid edir; neçə dəfə çağırıldığını sayır."""

    def __init__(self, message="429 RESOURCE_EXHAUSTED quota key=AIzaSyFAKEFAKEFAKEFAKEFAKE12. Please retry in 22.2s."):
        super().__init__(dims=768)
        self.calls = 0
        self.message = message

    def embed_documents(self, texts):
        self.calls += 1
        raise RuntimeError(self.message)

    def embed_query(self, text):
        self.calls += 1
        raise RuntimeError(self.message)


def _wait_indexing(timeout=10.0):
    """Arxa fonda gedən indekslənmənin bitməsini gözləyir."""
    import threading
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        if not any(t.name.startswith("indeks-") and t.is_alive() for t in threading.enumerate()):
            return
        time.sleep(0.02)
    raise AssertionError("indekslənmə bitmədi")


def _google(monkeypatch, embedder):
    monkeypatch.setenv("EMBEDDINGS_PROVIDER", "google")
    monkeypatch.setenv("GOOGLE_API_KEY", "saxta-test-acari")
    memory.reset()
    embeddings.set_override(embedder)


@pytest.fixture
def google_down(monkeypatch):
    broken = BrokenEmbeddings()
    _google(monkeypatch, broken)
    yield broken
    _wait_indexing()
    embeddings.set_override(None)
    memory.reset()


# ── 1) Axtarış ─────────────────────────────────────────────────────────────

def test_google_kvotası_dolanda_leksik_axtarışa_keçir(doc, google_down, caplog):
    hits = memory.search_document(doc, "bank krediti və maliyyələşmə mənbələri", limit=3)
    assert hits and hits[0]["section_id"] == "S28" and hits[0]["via"] == "leksik"
    _wait_indexing()
    assert not memory.semantic_available()                      # kvota: qısa fasilə
    assert "AIza" not in caplog.text                            # açar loga düşmür
    out = memory.format_hits(hits)
    assert "Semantik axtarış hazırda işləmir" in out and "S28" in out


def test_kvota_fasiləsi_qısadır_digər_xətada_uzun(doc, monkeypatch):
    for message, longer_than in (("429 RESOURCE_EXHAUSTED. Please retry in 22.2s.", None),
                                 ("500 Internal error", 300)):
        _google(monkeypatch, BrokenEmbeddings(message))
        memory.search_document(doc, "bank krediti")
        _wait_indexing()
        left = memory._semantic_down_until - time.monotonic()
        if longer_than:
            assert left > longer_than
        else:
            assert 15 < left < 30                               # xidmətin dediyi ~23 san
    embeddings.set_override(None)
    memory.reset()


def test_fasilə_müddətində_google_sınanmır(doc, google_down):
    memory.search_document(doc, "bank krediti")
    _wait_indexing()
    calls = google_down.calls
    started = time.monotonic()
    for query in ("pul axını", "rəqiblər", "kredit faizi"):
        assert memory.search_document(doc, query)
    assert google_down.calls == calls                           # xidmət yenidən çağırılmadı
    assert time.monotonic() - started < 2                       # gözləmə yoxdur
    assert memory.index_document(doc) is None                   # indeksləmə də sınanmır


def test_agent_axtarışı_indeksi_gözləmir(doc, monkeypatch):
    class Slow(embeddings.LexicalHashEmbeddings):
        def embed_documents(self, texts):
            time.sleep(1.5)                                     # böyük sənəd / kvota gözləməsi
            return super().embed_documents(texts)

    _google(monkeypatch, Slow(dims=768))
    try:
        started = time.monotonic()
        hits = memory.search_document(doc, "bank krediti")
        assert time.monotonic() - started < 1.0                 # agent gözləmədi
        assert hits and hits[0]["via"] == "leksik"
        _wait_indexing()
        hits = memory.search_document(doc, "bank krediti")
        assert hits and hits[0]["via"] == "semantik"            # indeks hazırdır — semantik axtarış
    finally:
        embeddings.set_override(None)
        memory.reset()


# ── Kvota məhdudlaşdırıcısı (saxta saat — real gözləmə yoxdur) ─────────────

class FakeClock:
    def __init__(self):
        self.now = 1000.0
        self.slept = 0.0

    def __call__(self):
        return self.now

    def sleep(self, seconds):
        self.now += seconds
        self.slept += seconds


def test_pəncərə_dəqiqədə_limitdən_çox_buraxmır():
    clock = FakeClock()
    window = embeddings.RateWindow(90, clock=clock, sleep=clock.sleep)
    assert window.reserve(90, max_wait=0)
    assert not window.reserve(1, max_wait=5)                    # agent axtarışı: gözləmir
    assert window.reserve(10, max_wait=120)                     # indeks: pəncərə açılana qədər gözləyir
    assert 55 <= clock.slept <= 61


def test_429_da_gözləyib_yenidən_sınayır():
    clock = FakeClock()

    class Flaky(embeddings.LexicalHashEmbeddings):
        calls = 0

        def embed_documents(self, texts):
            Flaky.calls += 1
            if Flaky.calls == 1:
                raise RuntimeError("Error embedding content (RESOURCE_EXHAUSTED): 429. Please retry in 22.2s.")
            return super().embed_documents(texts)

    limited = embeddings.RateLimitedEmbeddings(Flaky(), embeddings.RateWindow(90, clock=clock, sleep=clock.sleep))
    vectors = limited.embed_documents(["a", "b", "c"])
    assert len(vectors) == 3 and Flaky.calls == 2
    assert 20 <= clock.slept <= 30                              # xidmətin dediyi qədər gözlədi


def test_böyük_sənəd_hissələrlə_göndərilir():
    clock = FakeClock()
    sizes = []

    class Recording(embeddings.LexicalHashEmbeddings):
        def embed_documents(self, texts):
            sizes.append(len(texts))
            return super().embed_documents(texts)

    limited = embeddings.RateLimitedEmbeddings(Recording(), embeddings.RateWindow(90, clock=clock, sleep=clock.sleep))
    assert len(limited.embed_documents([f"parça {i}" for i in range(150)])) == 150
    assert sizes == [90, 60] and 55 <= clock.slept <= 61        # ikinci hissə növbəti dəqiqəyə


def test_kvota_doludursa_sorğu_dərhal_imtina_edir():
    clock = FakeClock()
    window = embeddings.RateWindow(90, clock=clock, sleep=clock.sleep)
    window.reserve(90, max_wait=0)
    limited = embeddings.RateLimitedEmbeddings(embeddings.LexicalHashEmbeddings(), window)
    with pytest.raises(embeddings.QuotaExceeded) as info:
        limited.embed_query("bank")
    assert info.value.retry_after > 0 and clock.slept <= 2


def test_axtarış_ümumiyyətlə_işləməyəndə_agentə_açıq_deyilir(doc, google_down, monkeypatch):
    def broken(*_a, **_k):
        raise RuntimeError("leksik də yoxdur")
    monkeypatch.setattr(memory, "_lexical_search", broken)
    assert memory.search_document(doc, "bank krediti") is None
    out = {t.name: t for t in make_doc_tools(doc)}["search_document"].invoke({"query": "bank krediti"})
    assert "İŞLƏMİR" in out and "olmaması demək DEYİL" in out and "get_section" in out
    assert out != "Uyğun parça tapılmadı."


def test_sənəd_bir_toplu_yazı_ilə_indekslənir(doc, monkeypatch):
    class Counting(embeddings.LexicalHashEmbeddings):
        calls = 0

        def embed_documents(self, texts):
            Counting.calls += 1
            return super().embed_documents(texts)

    unique = {**doc, "sections": [*doc["sections"], {"id": "S999", "title": "Unikal", "text": str(time.time())}]}
    memory.reset()
    embeddings.set_override(Counting())
    try:
        assert memory.index_document(unique)
        assert Counting.calls == 1                              # əvvəl hər parça üçün ayrıca sorğu idi
        assert memory.search_document(unique, "Unikal")[0]["via"] == "leksik"
    finally:
        embeddings.set_override(None)
        memory.reset()


# ── 2) Addım büdcəsi ───────────────────────────────────────────────────────

class DövrəyəDüşən(FakeChatModel):
    """Sənəd alətləri olduqca dayanmadan oxuyur (real hadisədəki kimi); alətlər götürüləndə
    yalnız birinci bəndə cavab verir."""

    def _generate(self, messages, stop=None, run_manager=None, **kwargs):
        if self._has("GroupResult") and any("get_section" in t for t in self.bound_tools):
            self.call_log.append("compliance")
            from tests.fake_llm import _tool_call
            return _tool_call("get_section", {"section": "S1"})
        if self._has("GroupResult"):
            self.call_log.append("compliance")
            from tests.fake_llm import _tool_call
            return _tool_call("GroupResult", {"items": self._group_items(messages)[:1]})
        return super()._generate(messages, stop, run_manager, **kwargs)


class HamısınıYazan(DövrəyəDüşən):
    def _generate(self, messages, stop=None, run_manager=None, **kwargs):
        if self._has("GroupResult") and not any("get_section" in t for t in self.bound_tools):
            self.call_log.append("compliance")
            from tests.fake_llm import _tool_call
            return _tool_call("GroupResult", {"items": self._group_items(messages)})
        return super()._generate(messages, stop, run_manager, **kwargs)


def test_büdcə_bitəndə_qrup_itmir_cavablanan_bənd_saxlanılır(doc, monkeypatch):
    monkeypatch.setattr(config, "COMPLIANCE_GROUPS", ["investisiya"])
    model = DövrəyəDüşən()
    config.set_llm_override(model)
    state = build_compliance_graph().invoke({"doc": doc})

    group = [i for i in state["items"] if i["group_id"] == "investisiya"]
    plan_items = [i for i in group if i["status"] != "sened"]
    assert not state["errors"], state["errors"]                 # GraphRecursionError YOXDUR
    assert plan_items[0]["status"] in ("var", "natamam", "yoxdur")
    rest = plan_items[1:]
    assert rest and all(i["status"] == "skip" and i["technical"] and i["missing"] == BUDGET_MISSING
                        for i in rest)
    assert model.call_log.count("compliance") == model_budget(len(plan_items))
    assert [g["group_id"] for g in state["failed_groups"]] == ["investisiya"]   # "yenidən yoxla" mümkündür
    assert state["failed_groups"][0]["partial"] is True


def test_büdcə_bitib_amma_hamısı_cavablanıbsa_tam_sayılır(doc, monkeypatch):
    monkeypatch.setattr(config, "COMPLIANCE_GROUPS", ["investisiya"])
    config.set_llm_override(HamısınıYazan())
    state = build_compliance_graph().invoke({"doc": doc, "check_id": "budce-test"})
    group = [i for i in state["items"] if i["group_id"] == "investisiya" and i["status"] != "sened"]
    assert all(i["status"] in ("var", "natamam", "yoxdur") for i in group)
    assert not state["failed_groups"]
    assert storage.memo_get("budce-test", compliance.group_memo_key(
        next(g for g in compliance.load_requirements() if g["id"] == "investisiya"))) is not None


def test_büdcə_bənd_sayına_görə_böyüyür_və_həddi_var():
    assert model_budget(1) < model_budget(9) <= compliance.BUDGET_MAX
    assert model_budget(100) == compliance.BUDGET_MAX
