"""Maliyyə agenti — LangGraph subgraph: locate -> verify -> compute.

- **locate**  — LLM sənəddə bəyan edilən rəqəmləri TAPIR və köçürür (hesablamır).
- **verify**  — hər rəqəm sənədin mətnində axtarılır (mənbə yoxlaması).
- **compute** — 7 yoxlama Python-da aparılır.

Daxili agentdə `checkpointer=False`: subgraph valideynin checkpointer-ini
miras almamalıdır, əks halda paralel çağırışlar eyni namespace-ə yazır.

LangGraph `config` parametrini ANNOTASİYAYA görə tanıyır, ona görə bu faylda
`from __future__ import annotations` İSTİFADƏ EDİLMİR — əks halda annotasiya
mətnə çevrilir və qovşağa config ötürülmür (LangSmith izi qopur).
"""
import time
from typing import Any, Optional, TypedDict

from langchain.agents import create_agent
from langchain.agents.structured_output import ToolStrategy
from langchain_core.runnables import RunnableConfig
from langgraph.graph import END, START, StateGraph

from app import storage
from app.agents.doc_tools import make_doc_tools
from app.events import emit_result
from app.config import get_llm
from app.finance_tools import provenance, refine_rate, run_checks
from app.schemas import ClaimedFigures

SYSTEM_PROMPT = """\
Sən biznes planı oxuyan maliyyə analitikisən. Vəzifən: planda BƏYAN EDİLƏN
rəqəmləri tapıb olduğu kimi köçürmək.

QƏTİ QAYDALAR
1. HEÇ NƏ HESABLAMA. Toplama, vurma, faiz — heç biri. Yalnız sənəddə yazılanı köçür.
2. Uydurma qadağandır. Tapmadığın dəyəri null burax və `notes` sahəsində yaz.
3. Köçürərkən formatı rəqəmə çevir:
   "13 481 000 manat" -> 13481000 ; "11,49%" -> 11.49 ; "6,9 il" -> 6.9 ;
   "(1 196 310)" -> -1196310 (mötərizə mənfi deməkdir).
4. BAZA SSENARİ: cədvəldə bir neçə ssenari varsa, BİRİNCİ gələni götür.
   Sonrakı ssenarilər ("güzəştsiz", "pessimist" və s.) bu işə aid deyil.
5. Diskont dərəcəsinin bir neçə variantı varsa, ƏN DƏQİQ yazılanı götür
   (məsələn mətndə 11,49%, cədvəldə 11,5% varsa -> 11.49).
6. HƏR rəqəm üçün `citations`-a mənbə yaz: yer (bölmə və ya cədvəl id-si),
   HƏRFİ qısa sitat, vahid və ssenari. Sitatda göstəricinin adı və YALNIZ onun
   rəqəmi olsun — başqa göstəricinin və ya başqa ssenarinin rəqəmi olmasın.
   Ən aydın yeri seç: göstəricinin adı yazılmış cədvəl sətri və ya cümlə.
   Maliyyələşmə mənbələri üçün `location` və `quote`-u mənbənin özündə yaz.
   Python sitatı sənədlə tutuşdurur; tutmayan rəqəm istifadə olunmur.
7. Pul axını cədvəli: illər üzrə investisiya, EBITDA, mənfəət vergisi,
   dövriyyə kapitalının dəyişməsi, qalıq dəyər və FCFF sətirləri olan cədvəl.
   Onun id-sini (`cashflow_table_id`) və sətir adlarını yaz. Sətir adlarını
   cədvəlin BİRİNCİ sütununda yazıldığı kimi, hərfbəhərf köçür.

İŞ QAYDASI
- Əvvəlcə `list_tables` və `list_sections` ilə sənədə bax.
- Sonra lazımi cədvəl və bölmələri `get_table` / `get_section` ilə oxu.
- Oxumadığın yerə istinad etmə.
- Hamısını tapdıqdan sonra nəticəni struktur formada qaytar.
"""

USER_PROMPT = """\
Bu biznes planda bəyan edilən əsas maliyyə rəqəmlərini tap və köçür:
investisiyanın həcmi və strukturu, maliyyələşmə mənbələri, istehsal gücü
parametrləri, diskont dərəcəsi, NPV, IRR, özünü ödəmə müddəti, həmçinin pul
axını cədvəlinin id-si və sətir adları.
"""


#: Maliyyə çıxarışının yaddaş açarı.
MEMO_KEY = "finance:locate"
#: Agent jurnalında bu agentin adı.
AGENT = "maliyye"


class FinanceState(TypedDict, total=False):
    """Maliyyə subgraph-ının state-i."""

    doc: dict[str, Any]
    check_id: str | None
    claimed: dict[str, Any]
    not_found: list[dict[str, Any]]
    checks: list[dict[str, Any]]
    cashflow: dict[str, Any]
    notes: str | None


def child_config(config: Optional[RunnableConfig], tags: list[str],
                 metadata: Optional[dict[str, Any]] = None) -> RunnableConfig:
    """Daxili agent üçün konfiq.

    VACİB: valideynin `configurable` (thread_id) sahəsi ÖTÜRÜLMÜR — daxili
    agentdə checkpointer yoxdur və thread_id ona lazım deyil. Yalnız LangSmith
    və agent jurnalı üçün `callbacks`, `tags`, `metadata` (agent/qrup) və addım
    limiti ötürülür.
    """
    parent = config or {}
    callbacks = parent.get("callbacks")
    # Valideynin teqləri və metadata-sı (check_id, plan_id...) saxlanılır — qrafdan kənar işləyən
    # agentin (əlavə tələb çıxarışı) LangSmith izi də yoxlamaya bağlı qalsın.
    child: RunnableConfig = {"recursion_limit": 40,
                             "tags": list(dict.fromkeys([*(parent.get("tags") or []), *tags]))}
    if callbacks is not None:
        child["callbacks"] = callbacks
    merged = {**(parent.get("metadata") or {}), **(metadata or {})}
    if merged:
        child["metadata"] = merged
    return child


def _locate(state: FinanceState, config: Optional[RunnableConfig] = None) -> dict[str, Any]:
    """LLM sənəddə bəyan edilən rəqəmləri tapır.

    Uğurlu çıxarış yoxlamaya bağlı yaddaşda (`memo`) saxlanılır: sonrakı addım
    yıxılsa və ya server yenidən başlasa, retry modeli YENİDƏN çağırmır.
    """
    doc = state["doc"]
    cached = storage.memo_get(state.get("check_id"), MEMO_KEY)
    if cached is not None:
        emit_result(config, AGENT, "yaddaşdan götürüldü — model yenidən çağırılmadı")
        return {"claimed": cached, "notes": cached.get("notes")}
    started = time.time()
    agent = create_agent(
        get_llm(),
        tools=make_doc_tools(doc),
        system_prompt=SYSTEM_PROMPT,
        response_format=ToolStrategy(ClaimedFigures),
        checkpointer=False,
        name="maliyye_agenti",
    )
    result = agent.invoke(
        {"messages": [{"role": "user", "content": USER_PROMPT}]},
        config=child_config(config, ["maliyye", "locate"], {"agent": AGENT}),
    )
    claimed = result.get("structured_response")
    if claimed is None:
        emit_result(config, AGENT, "struktur cavab yoxdur", "xeta", started=started)
        raise RuntimeError(
            "Maliyyə agenti struktur cavab qaytarmadı. "
            "Yoxlamanı yenidən başladın və ya modeli dəyişin."
        )
    data = claimed.model_dump() if hasattr(claimed, "model_dump") else dict(claimed)
    storage.memo_set(state.get("check_id"), MEMO_KEY, data)
    found = sum(1 for k, v in data.items() if isinstance(v, (int, float)) and not isinstance(v, bool))
    emit_result(config, AGENT, f"{found} rəqəm, {len(data.get('citations') or [])} mənbə",
                started=started)
    return {"claimed": data, "notes": data.get("notes")}


def _verify(state: FinanceState) -> dict[str, Any]:
    """Mənbə yoxlaması: sənəddə olmayan rəqəm istifadə olunmur; dərəcə dəqiqləşdirilir."""
    clean, not_found = provenance(state["doc"], state["claimed"])
    return {"claimed": refine_rate(state["doc"], clean), "not_found": not_found}


def _compute(state: FinanceState) -> dict[str, Any]:
    """7 yoxlama — tamamilə Python-da."""
    outcome = run_checks(state["doc"], state["claimed"])
    return {"checks": outcome["checks"], "cashflow": outcome["cashflow"]}


def build_finance_graph() -> Any:
    """Maliyyə subgraph-ını qurur və kompilyasiya edir."""
    graph = StateGraph(FinanceState)
    graph.add_node("locate", _locate)
    graph.add_node("verify", _verify)
    graph.add_node("compute", _compute)
    graph.add_edge(START, "locate")
    graph.add_edge("locate", "verify")
    graph.add_edge("verify", "compute")
    graph.add_edge("compute", END)
    # checkpointer=False: valideynin checkpointer-i miras alınmır.
    return graph.compile(checkpointer=False, name="maliyye_subgraph")
