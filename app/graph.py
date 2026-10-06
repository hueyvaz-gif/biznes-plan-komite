"""Ana qraf — supervisor iki subgraph-ı və yekun addımları idarə edir.

```
START -> ingest -(giriş xətası)-> save -> END
               \\-> load_previous -> supervisor
                    supervisor -> { finance | compliance | decide_status
                                    | compare_previous | write_summary | save }
                    (hər iş qovşağı) -> supervisor
```

Ardıcıllıq: finance -> compliance -> decide_status -> compare_previous ->
write_summary -> save. Status müqayisədən ƏVVƏL qərara alınır ki, müqayisə
statusun dəyişməsini də göstərsin; rəy isə ən sonda — bütün faktlar hazır olanda.

**Marşrutu niyə LLM seçmir?** İş axını sabitdir: hər yoxlamada həm maliyyə, həm
uyğunluq aparılmalıdır. Marşrutu LLM-ə seçdirmək lazımsız risk olardı — model
bir addımı ötürə, təkrarlaya və ya dövrə sala bilər, üstəlik hər qərar üçün
əlavə çağırış deməkdir. LLM-in yeri agentlərin İÇİNDƏDİR (sənəddə rəqəm və
cavab tapmaq) və yekun rəyin yazılmasındadır — yəni mühakimə tələb edən yerdə.
Supervisor isə sadəcə state-ə baxır: nə hazır deyilsə, onu işə salır.

`load_previous` uzunmüddətli yaddaşdır: eyni plan_id-nin əvvəlki TAMAMLANMIŞ
yoxlaması SQLite-dan oxunur. `compare_previous` iki versiyanı LLM-siz
müqayisə edir (`app/compare.py`).

`decide_status` yekun statusu DETERMİNİSTİK qayda ilə verir (`app/verdict.py`).
`write_summary` — LLM bu statusu və faktları sözə çevirir, statusu dəyişə
bilməz; faktlarda olmayan rəqəm işlədən cümlələr atılır (`app/agents/summary.py`).

LangGraph `config` parametrini annotasiyaya görə tanıyır, ona görə bu faylda
`from __future__ import annotations` istifadə edilmir.
"""
import operator
from typing import Annotated, Any, Optional, TypedDict

from langchain_core.runnables import RunnableConfig
from langgraph.graph import END, START, StateGraph

from app import storage
from app.agents.summary import write_summary
from app.compare import compare, section_hashes, snapshot, stabilize
from app.verdict import decide
from app.agents.compliance import build_compliance_graph, requirement_index
from app.agents.compliance import coverage as compliance_coverage
from app.agents.extra_requirements import confirmed_groups
from app.agents.finance import build_finance_graph
from app.finance_tools import RULES as FINANCE_RULES
from app.finance_tools import chart_data
from app.ingest import IngestError, parse_docx


class CheckState(TypedDict, total=False):
    """Ana qrafın state-i. Bütün sahələr JSON-a çevrilə bilir."""

    check_id: str
    plan_id: str
    plan_name: str
    version: int
    file_path: str
    file_name: str
    doc: dict[str, Any]
    previous: dict[str, Any]
    finance: dict[str, Any]
    compliance: dict[str, Any]
    verdict: str
    reasons: dict[str, Any]
    comparison: dict[str, Any]
    summary: dict[str, Any]
    errors: Annotated[list[str], operator.add]


# ── Qovşaqlar ──────────────────────────────────────────────────────────────

def _ingest(state: CheckState) -> dict[str, Any]:
    """Sənədi oxuyur. Giriş xətası icra xətası deyil — nəticə kimi saxlanılır."""
    try:
        doc = parse_docx(state["file_path"])
    except IngestError as exc:
        return {"verdict": "giris_xetasi", "errors": [str(exc)]}
    return {"doc": doc}


def _after_ingest(state: CheckState) -> str:
    return "save" if state.get("verdict") == "giris_xetasi" else "load_previous"


def _load_previous(state: CheckState) -> dict[str, Any]:
    """Uzunmüddətli yaddaş: eyni planın əvvəlki tamamlanmış yoxlaması.

    Tapılmasa `{}` yazılır — "yoxlanılıb, amma yoxdur" deməkdir.
    """
    row = storage.previous_result(state["plan_id"], state["version"])
    return {"previous": snapshot(row["result"], row) if row else {}}


def _supervisor(state: CheckState) -> dict[str, Any]:
    """Qərar qovşağı — state-i dəyişmir, yalnız marşrutlaşdırma nöqtəsidir."""
    return {}


def _route(state: CheckState) -> str:
    """Hansı iş hələ görülməyibsə, onu seçir."""
    if state.get("finance") is None:
        return "finance"
    if state.get("compliance") is None:
        return "compliance"
    if state.get("verdict") is None:
        return "decide_status"
    if state.get("comparison") is None:
        return "compare_previous"
    if state.get("summary") is None:
        return "write_summary"
    return "save"


def _finance(state: CheckState, config: Optional[RunnableConfig] = None) -> dict[str, Any]:
    """Maliyyə subgraph-ı. Fərqli state sxemi olduğu üçün node daxilində çağırılır."""
    _maybe_fail(state, "finance")
    result = _finance_graph().invoke(
        {"doc": state["doc"], "check_id": state.get("check_id")}, config)
    return {"finance": _finance_view(result)}


def _compliance(state: CheckState, config: Optional[RunnableConfig] = None) -> dict[str, Any]:
    """Uyğunluq subgraph-ı. Mətni dəyişməyən bölmələrdə əvvəlki status saxlanılır."""
    _maybe_fail(state, "compliance")
    # Təsdiqlənmiş əlavə tələblər saxlanmış siyahıdan gəlir — retry-da yenidən yaradılmır.
    result = _compliance_graph().invoke(
        {"doc": state["doc"], "check_id": state.get("check_id"),
         "extra_groups": confirmed_groups(state.get("check_id"))}, config)
    group_errors = [
        f"Uyğunluq qrupu '{g['group_id']}': {g['error']}"
        for g in (result.get("errors") or [])
    ]
    items = stabilize(state.get("previous") or {}, result.get("items") or [],
                      section_hashes(state["doc"]["sections"], state["doc"]["tables"]))
    return {"compliance": {"items": items,
                           "failed_groups": result.get("failed_groups") or [],
                           "coverage": compliance_coverage(items)},
            "errors": group_errors}


def _compare_previous(state: CheckState) -> dict[str, Any]:
    """Əvvəlki versiya varsa, onunla müqayisə edir (LLM-siz)."""
    previous = state.get("previous") or {}
    if not previous:
        return {"comparison": {"available": False}}
    current = snapshot(
        {
            "ingest": {"placeholders": state["doc"]["placeholders"],
                       "section_hashes": section_hashes(state["doc"]["sections"], state["doc"]["tables"])},
            "finance": state.get("finance"),
            "compliance": state.get("compliance"),
        },
        {"id": state.get("check_id"), "version": state.get("version"),
         "file_name": state.get("file_name"), "created_at": None,
         "verdict": state.get("verdict")},
    )
    return {"comparison": compare(previous, current)}


def _decide_status(state: CheckState) -> dict[str, Any]:
    """Yekun status — qayda ilə, LLM-siz. Gözlənilən bəndlərin hamısı yoxlanılmalıdır."""
    extras = confirmed_groups(state.get("check_id"))
    expected = {"requirements": set(requirement_index(extras)), "checks": set(FINANCE_RULES)}
    decision = decide(state.get("finance"), state.get("compliance"),
                      state["doc"]["placeholders"], expected)
    return {"verdict": decision["verdict"],
            "reasons": {"reasons": decision["reasons"], "notes": decision["notes"]}}


def _write_summary(state: CheckState, config: Optional[RunnableConfig] = None) -> dict[str, Any]:
    """Komitənin yekun rəyi (LLM + rəqəm qoruyucusu).

    Rəy modelinin xətası yoxlamanı DAYANDIRMIR: qaydalarla ehtiyat rəy qurulur,
    xəta `summary.error`-da qeyd olunur, maliyyə və uyğunluq nəticələri görünür.
    Test rejimindəki süni xəta da model xətası kimi təqlid olunur.
    """
    check_id = state.get("check_id")
    simulate = bool(check_id) and storage.consume_fail(check_id, "write_summary")
    return {"summary": write_summary(dict(state), config, simulate_error=simulate)}


def _save(state: CheckState) -> dict[str, Any]:
    """Nəticə `service.py`-da saxlanılır; burada qraf sadəcə bitir."""
    return {}


def _maybe_fail(state: CheckState, node: str) -> None:
    """Test rejimi: seçilmiş qovşaq BİR dəfə süni xəta verir."""
    check_id = state.get("check_id")
    if check_id and storage.consume_fail(check_id, node):
        raise RuntimeError(
            f"Süni xəta (test rejimi): '{node}' qovşağı cavab vermədi. "
            "Davam etdirmək olar."
        )


def _finance_view(result: dict[str, Any]) -> dict[str, Any]:
    cashflow = result.get("cashflow") or {}
    return {
        "charts": chart_data(result.get("claimed") or {}, cashflow),
        "claimed": result.get("claimed") or {},
        "not_found": result.get("not_found") or [],
        "checks": result.get("checks") or [],
        "notes": result.get("notes"),
        "cashflow": {
            "table_id": cashflow.get("table_id"),
            "ok": cashflow.get("ok", False),
            "error": cashflow.get("error"),
            "years": cashflow.get("years"),
            "flows": cashflow.get("flows"),
        },
    }


# ── Subgraph-lar bir dəfə qurulur ──────────────────────────────────────────

_FINANCE: Any = None
_COMPLIANCE: Any = None


def _finance_graph() -> Any:
    global _FINANCE
    if _FINANCE is None:
        _FINANCE = build_finance_graph()
    return _FINANCE


def _compliance_graph() -> Any:
    global _COMPLIANCE
    if _COMPLIANCE is None:
        _COMPLIANCE = build_compliance_graph()
    return _COMPLIANCE


def reset_subgraphs() -> None:
    """Testlər üçün: saxta model dəyişəndə subgraph-lar yenidən qurulsun."""
    global _FINANCE, _COMPLIANCE
    _FINANCE = None
    _COMPLIANCE = None


# ── Qrafın qurulması ───────────────────────────────────────────────────────

#: İstifadəçiyə göstərilən addımlar — qovşaq adları ilə eynidir.
STEPS: tuple[str, ...] = (
    "ingest", "load_previous", "finance", "compliance", "decide_status",
    "compare_previous", "write_summary", "save",
)

#: Supervisor-un seçə biləcəyi iş qovşaqları.
WORK_NODES: tuple[str, ...] = (
    "finance", "compliance", "decide_status", "compare_previous", "write_summary",
)


def build_graph(checkpointer: Any = None) -> Any:
    graph = StateGraph(CheckState)
    graph.add_node("ingest", _ingest)
    graph.add_node("load_previous", _load_previous)
    graph.add_node("supervisor", _supervisor)
    graph.add_node("finance", _finance)
    graph.add_node("compliance", _compliance)
    graph.add_node("decide_status", _decide_status)
    graph.add_node("compare_previous", _compare_previous)
    graph.add_node("write_summary", _write_summary)
    graph.add_node("save", _save)

    graph.add_edge(START, "ingest")
    graph.add_conditional_edges("ingest", _after_ingest, ["load_previous", "save"])
    graph.add_edge("load_previous", "supervisor")
    graph.add_conditional_edges("supervisor", _route, [*WORK_NODES, "save"])
    for node in WORK_NODES:
        graph.add_edge(node, "supervisor")
    graph.add_edge("save", END)

    return graph.compile(checkpointer=checkpointer, name="komite")
