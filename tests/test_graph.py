"""Ana qraf, supervisor marşrutu və icra xidməti."""
from __future__ import annotations

import uuid

import pytest

from app import config, service, storage
from app.graph import _route, build_graph


@pytest.fixture()
def check(samples):
    """Hər test üçün yeni yoxlama qeydi (SQLite-da)."""
    storage.init()

    def _make(file_name: str = "plan_demo_v1.docx", plan_id: str | None = None,
              fail_at: str = "") -> str:
        check_id = uuid.uuid4().hex[:12]
        storage.create(check_id, plan_id or f"Plan {check_id}", 1, file_name,
                       str(samples / file_name), fail_at)
        return check_id

    return _make


# ── Supervisor marşrutu ────────────────────────────────────────────────────

def test_supervisor_state_ə_görə_seçir():
    """Marşrut LLM-dən DEYİL, state-dən asılıdır — deterministikdir."""
    assert _route({}) == "finance"
    assert _route({"finance": {}}) == "compliance"
    done = {"finance": {}, "compliance": {}}
    assert _route(done) == "decide_status"
    done["verdict"] = "duzelis"
    assert _route(done) == "compare_previous"
    done["comparison"] = {}
    assert _route(done) == "write_summary"
    done["summary"] = {}
    assert _route(done) == "save"


def test_qrafın_qovşaqları():
    nodes = set(build_graph().get_graph().nodes)
    for node in ("ingest", "load_previous", "supervisor", "finance", "compliance",
                 "decide_status", "compare_previous", "write_summary", "save"):
        assert node in nodes


# ── Tam icra ───────────────────────────────────────────────────────────────

def test_tam_yoxlama(check):
    check_id = check()
    service.run_check(check_id)

    row = storage.get(check_id)
    assert row["run_state"] == "tamamlandi"
    assert row["current_step"] is None
    assert row["error"] is None

    result = row["result"]
    assert result["ingest"]["stats"]["placeholders"] == 12
    assert len(result["finance"]["checks"]) == 7
    assert len(result["compliance"]["items"]) == 47


def test_giriş_xətası_icra_xətası_deyil(check):
    check_id = check("yanlis_fayl.docx")
    service.run_check(check_id)

    row = storage.get(check_id)
    assert row["run_state"] == "tamamlandi"      # icra bitdi
    assert row["verdict"] == "giris_xetasi"
    assert "docx formatında deyil" in row["error"]
    assert row["result"]["ingest"] is None
    assert row["result"]["finance"] is None      # agentlər işə salınmadı


def test_qırıq_faylda_pul_axını_skip(check, fake_llm):
    fake_llm.figures["cashflow_table_id"] = None
    check_id = check("plan_demo_qiriq.docx")
    service.run_check(check_id)

    checks = {c["id"]: c for c in storage.get(check_id)["result"]["finance"]["checks"]}
    for key in ("fcff_dusturu", "npv", "irr", "pp"):
        assert checks[key]["status"] == "skip"


# ── Süni xəta və davam etdirmə ─────────────────────────────────────────────

def test_uyğunluq_xətası_düzgün_addımı_göstərir(check):
    """UI "supervisor"-u yox, HƏQİQİ uğursuz qovşağı qırmızı göstərməlidir."""
    check_id = check(fail_at="compliance")
    service.run_check(check_id)

    row = storage.get(check_id)
    assert row["run_state"] == "xeta"
    assert row["current_step"] == "compliance"
    assert "Süni xəta" in row["error"]


def test_davam_etdirmə_maliyyəni_təkrar_işlətmir(check, monkeypatch):
    """Checkpoint-dən davam: tamamlanmış qovşaq ikinci dəfə icra olunmur."""
    import app.graph as graph_module

    calls: list[str] = []
    original = graph_module._finance

    def counted(state, config=None):
        calls.append("finance")
        return original(state, config)

    monkeypatch.setattr(graph_module, "_finance", counted)
    service.reset_graphs()                       # qraf yeni funksiya ilə qurulsun

    check_id = check(fail_at="compliance")
    service.run_check(check_id)
    assert storage.get(check_id)["run_state"] == "xeta"
    assert len(calls) == 1

    service.run_check(check_id, resume=True)
    row = storage.get(check_id)
    assert row["run_state"] == "tamamlandi"
    assert len(calls) == 1                       # maliyyə CƏMİ 1 dəfə çağırılıb
    assert len(row["result"]["compliance"]["items"]) == 47


def test_süni_xəta_yalnız_bir_dəfə_işləyir(check):
    check_id = check(fail_at="finance")
    service.run_check(check_id)
    assert storage.get(check_id)["run_state"] == "xeta"

    service.run_check(check_id, resume=True)
    assert storage.get(check_id)["run_state"] == "tamamlandi"


# ── Yaddaş ─────────────────────────────────────────────────────────────────

def test_server_yenidən_başlayanda_yarımçıqlar_bağlanır(check):
    check_id = check()
    storage.update(check_id, run_state="isleyir", current_step="finance")
    storage.init()
    row = storage.get(check_id)
    assert row["run_state"] == "xeta"
    assert "Server yenidən başladı" in row["error"]


def test_əvvəlki_nəticə_tapılır(check):
    plan = "Yaddaş testi " + uuid.uuid4().hex[:6]
    first = check(plan_id=plan)
    service.run_check(first)
    storage.update(first, version=1)

    second = uuid.uuid4().hex[:12]
    storage.create(second, plan, 2, "plan_demo_v2.docx", "yol", "")

    previous = storage.previous_result(plan, before_version=2)
    assert previous is not None and previous["id"] == first
    assert storage.previous_result(plan, before_version=1) is None


def test_ilk_versiyada_müqayisə_yoxdur(check):
    check_id = check()
    service.run_check(check_id)
    assert storage.get(check_id)["result"]["comparison"] == {"available": False}


def test_v2_v1_ilə_müqayisə_olunur(check, samples):
    """v2-də 3 boş yer doldurulub — müqayisə bunu göstərməlidir."""
    plan = "Müqayisə " + uuid.uuid4().hex[:6]
    first = check(plan_id=plan)
    service.run_check(first)

    second = uuid.uuid4().hex[:12]
    storage.create(second, plan, 2, "plan_demo_v2.docx",
                   str(samples / "plan_demo_v2.docx"), "")
    service.run_check(second)

    comparison = storage.get(second)["result"]["comparison"]
    assert comparison["available"] is True
    assert comparison["previous"]["check_id"] == first
    assert comparison["previous"]["version"] == 1
    assert comparison["counts"]["filled"] == 3
    assert comparison["placeholders"]["after"] == comparison["placeholders"]["before"] - 3


# ── LangSmith izi ──────────────────────────────────────────────────────────

def test_callbacks_subagentlərə_ötürülür(check):
    """İz qopmasın: valideynin callback-ləri hər iki agentə çatmalıdır.

    LangSmith izi məhz bu yolla bir ağac kimi qurulur. `child_config` yalnız
    `callbacks`, `tags` və `recursion_limit` ötürür — `thread_id` ötürülmür,
    çünki daxili agentlərdə checkpointer yoxdur.
    """
    from langchain_core.callbacks import BaseCallbackHandler

    class Sayğac(BaseCallbackHandler):
        def __init__(self):
            self.chat_model_starts = 0

        def on_chat_model_start(self, serialized, messages, **kwargs):
            self.chat_model_starts += 1

    counter = Sayğac()
    check_id = check()
    row = storage.get(check_id)

    inputs = {
        "check_id": check_id,
        "plan_id": row["plan_id"],
        "version": row["version"],
        "file_path": row["file_path"],
        "file_name": row["file_name"],
    }
    cfg = {"configurable": {"thread_id": check_id}, "callbacks": [counter],
           "recursion_limit": 40}
    service.graph().invoke(inputs, cfg)

    # Maliyyə agenti 2 + hər uyğunluq qrupu üçün 2 çağırış.
    assert counter.chat_model_starts >= 2 + 2 * 11


def test_child_config_thread_id_ötürmür():
    """Daxili agent valideynin checkpoint namespace-inə yazmamalıdır."""
    from app.agents.finance import child_config

    parent = {"configurable": {"thread_id": "abc"}, "callbacks": ["x"], "tags": ["üst"]}
    child = child_config(parent, ["alt"])
    assert "configurable" not in child
    assert child["callbacks"] == ["x"]
    assert child["tags"] == ["üst", "alt"]      # valideynin teqləri saxlanılır (LangSmith izi bağlı qalsın)
    assert child["recursion_limit"] == 40


# ── Addım izləməsi ─────────────────────────────────────────────────────────

def test_addımlar_düzgün_ardıcıllıqla_dəyişir(check, monkeypatch):
    """UI-də göstərilən addım hər qovşaqdan sonra düzgün olmalıdır.

    `get_state(...).next` istifadə edilsəydi, axın zamanı bir superstep geri
    qalardı və "Sənəd oxunur" bitəndən sonra da "Sənəd oxunur" görünərdi.
    """
    seen: list[str | None] = []
    original = storage.update

    def spy(check_id, **fields):
        if "current_step" in fields:
            seen.append(fields["current_step"])
        return original(check_id, **fields)

    monkeypatch.setattr(storage, "update", spy)
    service.run_check(check())

    compact = [s for i, s in enumerate(seen) if i == 0 or s != seen[i - 1]]
    assert compact == ["ingest", "load_previous", "finance", "compliance",
                       "decide_status", "compare_previous", "write_summary", "save", None]


def test_giriş_xətasında_addım_birbaşa_saxlamaya_keçir(check, monkeypatch):
    seen: list[str | None] = []
    original = storage.update

    def spy(check_id, **fields):
        if "current_step" in fields:
            seen.append(fields["current_step"])
        return original(check_id, **fields)

    monkeypatch.setattr(storage, "update", spy)
    service.run_check(check("yanlis_fayl.docx"))

    compact = [s for i, s in enumerate(seen) if i == 0 or s != seen[i - 1]]
    # Maliyyə və uyğunluq ATLANIR — birbaşa saxlamaya keçilir.
    assert compact == ["ingest", "save", None]
