"""Komitənin yekun rəyi — LLM YALNIZ verilən faktları sözə çevirir.

Status (`verdict`) `app/verdict.py`-da deterministik qayda ilə müəyyən edilib.

- **Başlıq deterministikdir** — statusdan və əsas səbəblərdən qurulur; model
  onu yazmır, ona görə "plan hazırdır" kimi statusa zidd başlıq yarana bilməz.
- **Giriş strukturlaşdırılmış faktlardır** (`build_facts`): hər faktın id-si
  var (F1, F2, …). Modelin hər cümləsi əsaslandığı faktların id-lərini
  göstərməlidir; faktı olmayan (və ya naməlum id-li) cümlə atılır.
- **Rəqəm qoruyucusu** (`guard`): cümlədəki rəqəmlər YALNIZ istinad etdiyi
  faktlarda İŞARƏSİ İLƏ axtarılır (fakt −100 000-dirsə, cümlədəki 100 000 qəbul
  edilmir). Tapılmayan rəqəm `untraced_numbers` siyahısına düşür və
  cümlə atılır. İstisna — say və il kimi işlənən tam ədədlər: ≤20 və 1900–2100.
- **Model xətası nəticəni əlçatmaz etmir**: ehtiyat rəy qaydalarla qurulur
  (`fallback_summary`), xəta `error` sahəsində ayrıca qeyd olunur.

LangGraph `config`-i annotasiyaya görə tanıyır — `from __future__ import
annotations` istifadə edilmir.
"""
from typing import Any, Optional

from langchain.agents import create_agent
from langchain.agents.structured_output import ToolStrategy
from langchain_core.runnables import RunnableConfig

from app.agents.finance import child_config
from app.events import emit_result
from app.config import get_llm
from app.numbers import format_az, found_in, found_signed, prose_numbers
from app.schemas import CommitteeSummary

VERDICT_TEXT = {
    "hazir": "Təqdimata hazırdır",
    "duzelis": "Düzəliş lazımdır",
    "hazir_deyil": "Hazır deyil",
}

#: Səbəb olmayanda başlığın ikinci hissəsi.
HEADLINE_TAIL = {
    "hazir": "yoxlanılan bütün bəndlər qaydasındadır.",
    "duzelis": "plan təqdim olunmazdan əvvəl düzəlişlər tələb olunur.",
    "hazir_deyil": "planda ciddi problemlər var.",
}

STATUS_TEXT = {"ok": "uyğun", "warn": "xəbərdarlıq", "fail": "uyğunsuz", "skip": "yoxlanılmadı"}

#: Cümlədə fakt olmadan da icazə verilən tam ədədlər (say sözləri və illər).
SMALL_INT_MAX = 20
YEAR_RANGE = (1900, 2100)

MAX_POINTS = 6

SYSTEM_PROMPT = """\
Sən biznes planı qiymətləndirən komitənin katibisən.
Sənə yoxlamanın FAKTLARI verilir — hər faktın id-si var (F1, F2, …).

QƏTİ QAYDALAR
1. Yekun status artıq qərara alınıb və başlıq ayrıca yazılır. Statusa zidd yazma.
2. Yalnız verilən faktlardan istifadə et. Yeni fakt, rəqəm və ya ehtimal uydurma.
3. HƏR cümlə üçün `facts`-a onun əsaslandığı faktların id-lərini yaz. Faktı
   olmayan cümlə atılır.
4. HEÇ NƏ HESABLAMA. Rəqəm yazırsansa, istinad etdiyin faktda yazıldığı kimi köçür.
5. Bu, investisiya qərarı deyil — layihənin gəlirliliyi barədə fikir bildirmə.
   Yalnız sənədin tamlığı və daxili uyğunluğu barədə yaz.
6. Azərbaycan dilində, rəsmi və qısa yaz.

FORMA
- key_findings: ən vacib tapıntılar, ən çoxu 6 bənd, vaciblik sırası ilə.
- open_questions: plan müəllifinə veriləcək suallar, ən çoxu 6.
"""


def _num(value: Any, unit: str = "") -> str:
    if value is None:
        return "—"
    if unit in ("manat", "ton"):
        return f"{format_az(round(float(value)), 0)} {unit}"
    text = format_az(round(float(value), 2))        # 12,8 qalır, 12,7812 -> 12,78
    return f"{text}{'%' if unit == '%' else (' ' + unit if unit else '')}"


# ── Faktlar ────────────────────────────────────────────────────────────────

def build_facts(state: dict[str, Any]) -> list[dict[str, Any]]:
    """Rəy üçün strukturlaşdırılmış faktlar: [{"id", "kind", "text"}, ...].

    Rəqəmlər Azərbaycan formatındadır. F1 həmişə yekun statusdur.
    """
    facts: list[dict[str, Any]] = []

    def add(kind: str, text: str, **extra: Any) -> None:
        facts.append({"id": f"F{len(facts) + 1}", "kind": kind, "text": text, **extra})

    verdict = state.get("verdict") or ""
    reasons = state.get("reasons") or {}
    add("status", f"Plan: {state.get('plan_name') or state.get('plan_id')} (versiya {state.get('version')}). "
                  f"Yekun status (qayda ilə): {VERDICT_TEXT.get(verdict, verdict)}.")

    for reason in reasons.get("reasons") or []:
        shown = ", ".join(reason["items"][:8])
        more = f" və daha {reason['count'] - 8}" if reason["count"] > 8 else ""
        add("reason", f"{reason['text']}: {reason['count']} ({shown}{more}).",
            code=reason["code"], severity=reason["severity"])
    for note in reasons.get("notes") or []:
        add("note", f"{note['text']}: {', '.join(note['items'])}.", code=note["code"])

    for check in (state.get("finance") or {}).get("checks") or []:
        unit = check.get("unit") or ""
        add("finance",
            f"{check.get('title')}{' (kritik)' if check.get('critical') else ''}: "
            f"planda {_num(check.get('claimed'), unit)}, hesablanan "
            f"{_num(check.get('computed'), unit)}, status — "
            f"{STATUS_TEXT.get(check.get('status'), check.get('status'))}.",
            check_id=check.get("id"), status=check.get("status"))

    comparison = state.get("comparison") or {}
    if comparison.get("available"):
        prev = comparison.get("previous") or {}
        counts = comparison.get("counts") or {}
        before = VERDICT_TEXT.get(prev.get("verdict") or "", "məlum deyil")
        add("comparison",
            f"Əvvəlki versiya ilə müqayisə (versiya {prev.get('version')}, status: {before}): "
            f"yaxşılaşan bənd {counts.get('yaxsilasdi', 0)}, pisləşən bənd "
            f"{counts.get('pislesdi', 0)}, doldurulmuş boş yer {counts.get('filled', 0)}, "
            f"yeni boş yer {counts.get('added', 0)}.")
    else:
        add("comparison", "Əvvəlki versiya yoxdur — bu planın ilk yoxlamasıdır.")
    return facts


def facts_text(facts: list[dict[str, Any]]) -> str:
    """Modelə verilən mətn: hər sətirdə bir fakt və onun id-si."""
    return "\n".join(f"{f['id']}: {f['text']}" for f in facts)


def headline(verdict: str, reasons: dict[str, Any] | None) -> str:
    """Deterministik başlıq: status + ən ağır iki səbəb."""
    label = VERDICT_TEXT.get(verdict, verdict or "Status məlum deyil")
    top = (reasons or {}).get("reasons") or []
    if not top:
        return f"{label} — {HEADLINE_TAIL.get(verdict, '')}".rstrip(" —")
    parts = [f"{r['text'].lower()} ({r['count']})" for r in top[:2]]
    more = f" və daha {len(top) - 2} səbəb" if len(top) > 2 else ""
    return f"{label}: {'; '.join(parts)}{more}."


# ── Qoruyucu ───────────────────────────────────────────────────────────────

def _exempt(value: float) -> bool:
    """Say sözləri və illər: ≤20 və ya 1900–2100 arası TAM ədədlər."""
    if not float(value).is_integer():
        return False
    return abs(value) <= SMALL_INT_MAX or YEAR_RANGE[0] <= abs(value) <= YEAR_RANGE[1]


#: `untraced_numbers[].reason` — UI xəbərdarlıqda göstərir.
REASON_SIGN = "işarəsi faktdakından fərqlidir"
REASON_MISSING = "istinad edilən faktlarda yoxdur"


def _untraced(text: str, pool: list[float]) -> list[tuple[str, str]]:
    """Cümlədə istinad etdiyi faktlarda olmayan rəqəmlər: [(yazıldığı kimi, səbəb), ...].

    İstisna (say/il) yalnız faktlarda HEÇ bir işarə ilə olmayan rəqəmə şamil edilir —
    "-20" faktda "20"-dirsə, istisna işarə dəyişikliyini ört-basdır etmir.
    """
    missing = []
    for start, end, value in prose_numbers(text):
        if found_signed(value, pool):
            continue
        in_pool = found_in(abs(value), [abs(v) for v in pool], rel_tol=1e-4)
        if not in_pool and _exempt(value):
            continue
        sign = "−" if value < 0 and text[start - 1:start] != "(" else ""
        missing.append((sign + text[start:end], REASON_SIGN if in_pool else REASON_MISSING))
    return missing


def guard(summary: dict[str, Any], facts: list[dict[str, Any]], verdict: str,
          reasons: dict[str, Any] | None = None) -> dict[str, Any]:
    """Modelin cümlələrini faktlara bağlayır və mənbəsiz rəqəmləri ayırır.

    - faktı olmayan və ya naməlum fakt id-li cümlə atılır (`unbound`);
    - cümlədəki rəqəm İSTİNAD ETDİYİ faktlarda yoxdursa, rəqəm
      `untraced_numbers`-ə düşür və cümlə atılır.
    """
    by_id = {f["id"]: f for f in facts}
    untraced: list[dict[str, str]] = []
    dropped = 0

    def clean(points: list[Any]) -> list[str]:
        nonlocal dropped
        kept = []
        for point in (points or [])[:MAX_POINTS]:
            if isinstance(point, str):            # köhnə forma — faktsızdır
                point = {"text": point, "facts": []}
            text = (point.get("text") or "").strip()
            if not text:
                continue
            cited = [by_id[f] for f in point.get("facts") or [] if f in by_id]
            if not cited:
                dropped += 1
                continue
            pool = [v for f in cited for _s, _e, v in prose_numbers(f["text"])]
            numbers = _untraced(text, pool)
            if numbers:
                untraced.extend({"number": n, "sentence": text, "reason": why} for n, why in numbers)
                dropped += 1
                continue
            kept.append(text)
        return kept

    return {
        "headline": headline(verdict, reasons),
        "key_findings": clean(summary.get("key_findings")),
        "open_questions": clean(summary.get("open_questions")),
        "dropped": dropped,
        "untraced_numbers": untraced,
        "source": "model",
        "error": None,
    }


# ── Ehtiyat rəy ────────────────────────────────────────────────────────────

def fallback_summary(facts: list[dict[str, Any]], verdict: str,
                     reasons: dict[str, Any] | None, error: str) -> dict[str, Any]:
    """Model işləmədikdə qaydalarla qurulan sadə rəy — yalnız faktların özü."""
    findings = [f["text"] for f in facts if f["kind"] == "reason"][:MAX_POINTS]
    if not findings:
        findings = [f["text"] for f in facts if f["kind"] == "status"]
    return {
        "headline": headline(verdict, reasons),
        "key_findings": findings,
        "open_questions": [],
        "dropped": 0,
        "untraced_numbers": [],
        "source": "qayda",
        "error": error,
    }


def write_summary(state: dict[str, Any], config: Optional[RunnableConfig] = None,
                  simulate_error: bool = False) -> dict[str, Any]:
    """LLM-dən rəy alır və qoruyucudan keçirir; model xətasında ehtiyat rəy qaytarır.

    `simulate_error` — test rejimi: modelin xəta verməsini təqlid edir.
    """
    facts = build_facts(state)
    verdict = state.get("verdict") or ""
    reasons = state.get("reasons") or {}
    try:
        if simulate_error:
            raise RuntimeError("Süni xəta (test rejimi): rəy modeli cavab vermədi.")
        agent = create_agent(
            get_llm(),
            tools=[],
            system_prompt=SYSTEM_PROMPT,
            response_format=ToolStrategy(CommitteeSummary),
            checkpointer=False,
            name="rey_agenti",
        )
        result = agent.invoke(
            {"messages": [{"role": "user", "content": "FAKTLAR\n\n" + facts_text(facts)}]},
            config=child_config(config, ["rey"], {"agent": "rey"}),
        )
        response = result.get("structured_response")
        if response is None:
            raise RuntimeError("Rəy agenti struktur cavab qaytarmadı.")
    except Exception as exc:  # noqa: BLE001 — istənilən model xətası ehtiyat rəyə aparır
        emit_result(config, "rey", f"model xətası — ehtiyat rəy: {type(exc).__name__}", "xeta")
        return fallback_summary(facts, verdict, reasons, f"{type(exc).__name__}: {exc}")
    raw = response.model_dump() if hasattr(response, "model_dump") else dict(response)
    out = guard(raw, facts, verdict, reasons)
    emit_result(config, "rey", f"{len(out['key_findings'])} tapıntı, {out['dropped']} cümlə atılıb")
    return out
