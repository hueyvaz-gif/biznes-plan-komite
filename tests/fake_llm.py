"""Saxta chat modeli — testlər üçün.

BU, REAL LLM-İN ƏVƏZİ DEYİL. O, modelin cavabının keyfiyyətini yoxlamır və
real modelin davranışını təqlid etmir. Yeganə məqsədi — sistemin hissələrinin
(alətlər, subgraph-lar, qraf, yaddaş, API) BİRLİKDƏ işlədiyini yoxlamaqdır.
Real modelin cavabları dəyişə bilər; ilk real işə salmada LangSmith-ə baxın.

Model bağlanan alətlərə görə davranır:
  • ClaimedFigures bağlanıbsa  -> əvvəl `list_tables`, sonra ClaimedFigures;
  • GroupResult bağlanıbsa     -> `list_sections`, sonra `get_section("S1")`, sonra GroupResult
                                  (sitat həmin bölmədən HƏRFİ götürülür);
  • CommitteeSummary bağlanıbsa -> dərhal sabit rəy.
"""
from __future__ import annotations

import re
from typing import Any, Sequence

from langchain_core.callbacks import CallbackManagerForLLMRun
from langchain_core.language_models import BaseChatModel
from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, ToolMessage
from langchain_core.outputs import ChatGeneration, ChatResult

#: Orijinal CFG planının rəqəmləri (anonim demo faylında da eynidir).
CFG_FIGURES: dict[str, Any] = {
    "investment_total": 13481000,
    "fixed_assets_investment": 11281000,
    "working_capital_investment": 2200000,
    "sources": [
        {"name": "Təsisçilərin kapital qoyuluşu", "amount": 6181000},
        {"name": "Bank (layihə/avadanlıq) krediti", "amount": 5400000},
        {"name": "Dövriyyə krediti (revolver)", "amount": 1900000},
    ],
    "capacity_t_per_hour": 10,
    "shifts_per_day": 3,
    "shift_hours": 8,
    "work_days_per_year": 300,
    "utilization_pct": 80,
    "nominal_capacity_t": 72000,
    "practical_capacity_t": 57600,
    "discount_rate_pct": 11.49,
    "npv": 1225241,
    "irr_pct": 12.8,
    "payback_years": 6.9,
    "cashflow_table_id": "T27",
    "row_investment": "İnvestisiya qoyuluşu",
    "row_ebitda": "EBITDA",
    "row_tax": "Mənfəət vergisi",
    "row_wc_change": "Dövriyyə kapitalının dəyişməsi",
    "row_residual": "Layihənin qalıq dəyəri",
    "row_fcff": "Sərbəst pul axını (FCFF)",
    "notes": None,
}

#: Demo faylında hər rəqəmin mənbəyi: sahə -> (yer, sitat şablonu). `{v}`
#: cari rəqəmlə Azərbaycan formatında əvəz olunur — test rəqəmi dəyişsə,
#: sitat da dəyişir (saxta NPV faylında "2 225 241" yazılıb).
CFG_CITATIONS: dict[str, tuple[str, str]] = {
    "investment_total": ("S28", "Layihə üzrə ümumi investisiya {v} manat"),
    "fixed_assets_investment": ("S28", "Bunun {v} manatı əsas vəsaitlərə"),
    "working_capital_investment": ("S28", "{v} manatı dövriyyə kapitalına"),
    "capacity_t_per_hour": ("S10", "Xəttin nominal məhsuldarlığı {v} ton/saatdır"),
    "shifts_per_day": ("S10", "Zavod {v} növbə"),
    "shift_hours": ("S10", "növbə {v} saat"),
    "work_days_per_year": ("S10", "ildə {v} iş günü"),
    "utilization_pct": ("S10", "effektiv istifadə əmsalı {v}%"),
    "nominal_capacity_t": ("S10", "nominal illik güc {v} ton"),
    "practical_capacity_t": ("S10", "praktiki illik güc isə {v} tondur"),
    "discount_rate_pct": ("S35", "Diskont dərəcəsi (WACC) = E/V × Ke + D/V × Kd × (1 − t) = "
                                 "45,8% × 15% + 54,2% × 8,52% × (1 − 0) = {v}%"),
    "npv": ("T2", "Xalis cari dəyər (NPV), manat | {v}"),
    "irr_pct": ("T2", "Daxili rentabellik norması (IRR) | {v}%"),
    "payback_years": ("T2", "Özünü ödəmə müddəti (PP) | {v} il"),
}
SOURCE_CITATIONS: dict[str, tuple[str, str]] = {
    "Təsisçilərin kapital qoyuluşu": ("T14", "Təsisçilərin kapital qoyuluşu | {v}"),
    "Bank (layihə/avadanlıq) krediti": ("T14", "Bank (layihə/avadanlıq) krediti | {v}"),
    "Dövriyyə krediti (revolver)": ("T14", "Dövriyyə krediti (revolver) | {v}"),
}


def _cell(key: str, table: str, row: str, column: str) -> dict[str, Any]:
    return {"key": key, "location": table, "quote": row, "row_label": row, "column": column}


def _quote_ref(key: str, location: str, quote: str, value: float) -> dict[str, Any]:
    return {"key": key, "location": location, "quote": quote, "value": value}


#: İqtisadi təhlil: demo faylında (plan_demo_v1) göstəricilərin YERİ — rəqəmi Python oxuyur.
DEMO_ECONOMICS: dict[str, Any] = {
    "figures": [
        _cell("price_avg_per_t", "T20", "Orta çəkili", "Qiymət"),
        _cell("raw_cost_per_t", "T20", "Orta çəkili", "Xammal"),
        _cell("variable_cost_per_t", "T20", "Orta çəkili", "Dəyişən maya dəyəri"),
        _cell("margin_per_t", "T20", "Orta çəkili", "Marjinal gəlir"),
        _quote_ref("raw_share_variable_pct", "S13", "xammal dəyişən maya dəyərinin 85,5%-ni təşkil edir", 85.5),
        _quote_ref("raw_share_full_pct", "S33", "tam maya dəyərinin təxminən 77%-ni təşkil edir", 77),
        _quote_ref("fixed_cash_cost_per_t", "S33", "sabit nağd xərclər 41 manat", 41),
        _quote_ref("depreciation_per_t", "S33", "amortizasiya 20 manat", 20),
        _cell("staff_count", "T17", "Cəmi (aylıq)", "Ştat"),
        _cell("payroll_monthly", "T17", "Cəmi (aylıq)", "Aylıq fond"),
        _cell("payroll_annual", "T19", "Əmək haqqı", "Dəyər, manat"),
        _cell("electricity_kwh_year", "T18", "Elektrik enerjisi", "Həcm"),
        _cell("electricity_tariff", "T18", "Elektrik enerjisi", "Tarif"),
        _cell("electricity_cost", "T18", "Elektrik enerjisi", "Dəyər"),
        _cell("gas_m3_year", "T18", "Təbii qaz", "Həcm"),
        _cell("gas_tariff", "T18", "Təbii qaz", "Tarif"),
        _cell("gas_cost", "T18", "Təbii qaz", "Dəyər"),
        _cell("buildings_value", "T16", "o cümlədən: binalar", "Məbləğ"),
        _cell("equipment_value", "T16", "o cümlədən: maşın", "Məbləğ"),
        _quote_ref("buildings_dep_rate_pct", "S35", "binalar 7%", 7),
        _quote_ref("equipment_dep_rate_pct", "S35", "avadanlıqlar 20%", 20),
        _quote_ref("receivable_days", "S35", "debitor borcları 30 gün", 30),
        _quote_ref("payable_days", "S35", "kreditor borcları 30 gün", 30),
        _quote_ref("inventory_days", "S35", "ehtiyatı 60 gün", 60),
        _quote_ref("profit_tax_rate_pct", "S35", "mənfəət vergisi = 20%", 20),
        _quote_ref("property_tax_rate_pct", "S35", "Əmlak vergisi = 1%", 1),
        _cell("loan_amount", "T14", "Bank (layihə/avadanlıq) krediti", "Məbləğ"),
    ],
    "rows": [
        {"key": "revenue", "table_id": "T22", "row_label": "Satış gəliri"},
        {"key": "raw_material_cost", "table_id": "T22", "row_label": "Xammal"},
        {"key": "sales_volume_t", "table_id": "T6", "row_label": "Satış həcmi"},
        {"key": "utilization_pct", "table_id": "T6", "row_label": "Gücdən istifadə"},
        {"key": "depreciation", "table_id": "T22", "row_label": "Amortizasiya"},
        {"key": "fixed_cash_costs", "table_id": "T29", "row_label": "Sabit nağd xərclər"},
        {"key": "debt_service", "table_id": "T15", "row_label": "Əsas borcun ödənişi"},
        {"key": "interest", "table_id": "T15", "row_label": "Faiz xərci"},
    ],
    "statements": [
        {"key": "incentives_claim", "location": "S18",
         "quote": "Sənaye parkı rezidenti kimi: rezident kimi qeydiyyata alındığı tarixdən 10 il müddətinə "
                  "mənfəət, əmlak və torpaq vergisindən azadolma"},
        {"key": "discount_basis", "location": "S35",
         "quote": "Diskont dərəcəsi (WACC) = E/V × Ke + D/V × Kd × (1 − t)"},
        {"key": "schedule_window", "location": "T13",
         "quote": "Layihənin icra qrafiki (Qantt diaqramı), dekabr 2026 – yanvar 2028"},
        {"key": "company_name", "location": "S4", "quote": "“Demo Fertilizer Group” Məhdud Məsuliyyətli Cəmiyyətidir"},
    ],
    "notes": None,
}

#: Əlavə sənəddə "Tərəf: …" kimi sətirlər → EvidenceFacts sahəsi (sitat — sətrin özü).
EVIDENCE_LINES: dict[str, str] = {
    "Tərəf:": "issuer", "Ünvan:": "addressee", "Tarix:": "date", "Məbləğ:": "amount", "Valyuta:": "currency",
    "Həcm:": "volume_t", "Etibarlıdır:": "valid_until", "İmza:": "signature",
}


def _az(value: Any) -> str:
    from app.numbers import format_az

    text = format_az(abs(value))
    return f"({text})" if value < 0 else text


def with_citations(figures: dict[str, Any],
                   written: dict[str, str] | None = None) -> dict[str, Any]:
    """Rəqəmlərə demo faylındakı mənbələri əlavə edir (açıq verilənlərə toxunmur)."""
    out = dict(figures)
    if "citations" not in out:
        out["citations"] = [
            {"field": field, "location": location,
             "quote": quote.format(v=(written or {}).get(field) or _az(out[field]))}
            for field, (location, quote) in CFG_CITATIONS.items()
            if out.get(field) is not None
        ]
    sources = []
    for source in out.get("sources") or []:
        item = dict(source)
        if "quote" not in item and item.get("name") in SOURCE_CITATIONS and item.get("amount"):
            location, quote = SOURCE_CITATIONS[item["name"]]
            item["location"], item["quote"] = location, quote.format(v=_az(item["amount"]))
        sources.append(item)
    out["sources"] = sources
    return out

#: Hər cümlə faktlara istinad edir: F1 — yekun status, F2 — birinci səbəb.
CFG_SUMMARY: dict[str, Any] = {
    "key_findings": [
        {"text": "Yekun status qayda ilə müəyyən edilib.", "facts": ["F1"]},
        {"text": "Statusun əsas səbəbi ayrıca göstərilib.", "facts": ["F2"]},
    ],
    "open_questions": [
        {"text": "Göstərilən çatışmazlıqlar təqdimatdan əvvəl aradan qaldırılacaqmı?",
         "facts": ["F2"]},
    ],
}

#: Uyğunluq agenti bu id-ləri "natamam" qaytarır, qalanlarını "var".
DEFAULT_PARTIAL = ("TP3",)

_REQ_ID_RE = re.compile(r"^\s*-\s*([A-ZƏİÖÜĞŞÇ]{1,4}\d{1,2}|EU?[0-9A-F]{6,12})\s*:",
                        re.MULTILINE)
_SENED_RE = re.compile(r'<sened id="(A\d+)"[^>]*>(.*?)</sened>', re.DOTALL)
_HISSE_RE = re.compile(r'<hisse ref="([^"]+)">\n(.*?)\n</hisse>', re.DOTALL)


def _tool_name(tool: Any) -> str:
    for attribute in ("name", "__name__"):
        value = getattr(tool, attribute, None)
        if isinstance(value, str):
            return value
    if isinstance(tool, dict):
        return str(tool.get("name") or tool.get("title") or "")
    return getattr(getattr(tool, "schema", None), "__name__", "") or str(tool)


class FakeChatModel(BaseChatModel):
    """Alət çağıran, lakin heç nə düşünməyən saxta model."""

    figures: dict[str, Any] = {}
    summary: dict[str, Any] = {}
    #: Rəqəmin sənəddəki yazılışı ("7,0") — sitat bununla qurulur.
    written: dict[str, str] = {}
    #: Əlavə tələb çıxarışında mənbədə OLMAYAN uydurma bənd də qaytarılsın.
    fabricate: bool = False

    def _extracted(self, messages: list[BaseMessage]) -> list[dict[str, Any]]:
        """Zərfdəki "Tələb: ..." (plan) və "Sənəd: ..." (sened) sətirləri — hərfi fraqmentlə."""
        text = "\n".join(m.content for m in messages
                         if isinstance(m, HumanMessage) and isinstance(m.content, str))
        items = []
        for source_id, body in _SENED_RE.findall(text):
            for ref, part in _HISSE_RE.findall(body):
                for line in part.splitlines():
                    line = line.strip()
                    for prefix, kind in (("Tələb:", "plan"), ("Sənəd:", "sened")):
                        if line.startswith(prefix):
                            items.append({"text": line[len(prefix):].strip(), "kind": kind,
                                          "source_id": source_id, "ref": ref, "fragment": line})
        if self.fabricate:
            items.append({"text": "Uydurma tələb", "kind": "plan", "source_id": "A1",
                          "ref": "abzas 1", "fragment": "Bu cümlə sənəddə yoxdur."})
        return items
    partial_ids: tuple[str, ...] = DEFAULT_PARTIAL
    missing_ids: tuple[str, ...] = ()
    bound_tools: list[str] = []
    #: Neçə dəfə cavab verildiyini saymaq üçün (testlər yoxlayır).
    call_log: list[str] = []
    #: AI köməkçi: modelə gedən son mesajlar (testlər kontekstin ayrılmasını yoxlayır).
    chat_seen: list[Any] = []
    #: AI köməkçi komandası: (bağlanan alətlər, mesajlar) — hər model çağırışı.
    chat_calls: list[Any] = []
    #: AI köməkçi: provayder xətasını təqlid etmək üçün (mətnində "sirr" var — istifadəçiyə çatmamalıdır).
    chat_error: bool = False
    #: İqtisadi təhlil: yerləşdirmə cavabı (None — demo faylı üçün DEMO_ECONOMICS).
    economics: dict[str, Any] | None = None

    def _evidence(self, messages: list[BaseMessage]) -> dict[str, Any]:
        text = "\n".join(m.content for m in messages if isinstance(m, HumanMessage) and isinstance(m.content, str))
        facts: dict[str, Any] = {"doc_kind": "kommersiya_teklifi" if "təklif" in text.lower() else "niyyet_mektubu"}
        for line in text.splitlines():
            line = line.strip()
            for prefix, key in EVIDENCE_LINES.items():
                if line.startswith(prefix):
                    facts[key] = {"value": line[len(prefix):].strip(), "quote": line}
        return facts

    def __init__(self, **data: Any) -> None:
        data.setdefault("figures", dict(CFG_FIGURES))
        data.setdefault("summary", dict(CFG_SUMMARY))
        data.setdefault("call_log", [])
        data.setdefault("chat_seen", [])
        data.setdefault("chat_calls", [])
        super().__init__(**data)

    @property
    def _llm_type(self) -> str:
        return "saxta-model"

    def bind_tools(self, tools: Sequence[Any], **kwargs: Any) -> "FakeChatModel":
        names = [_tool_name(t) for t in tools]
        clone = self.model_copy(update={"bound_tools": names})
        clone.call_log = self.call_log  # eyni jurnal paylaşılır
        return clone

    # ── Cavabın qurulması ─────────────────────────────────────────────────

    def _has(self, name: str) -> bool:
        return any(name in t for t in self.bound_tools)

    def _generate(self, messages: list[BaseMessage], stop: list[str] | None = None,
                  run_manager: CallbackManagerForLLMRun | None = None,
                  **kwargs: Any) -> ChatResult:
        saw_tool_result = any(isinstance(m, ToolMessage) for m in messages)

        if self._has("ClaimedFigures"):
            self.call_log.append("finance")
            if not saw_tool_result:
                return _tool_call("list_tables", {})
            return _tool_call("ClaimedFigures", with_citations(self.figures, self.written))

        if self._has("GroupResult"):
            self.call_log.append("compliance")
            tool_results = sum(isinstance(m, ToolMessage) for m in messages)
            if tool_results == 0:
                return _tool_call("list_sections", {})                 # real agent kimi: əvvəl quruluş
            if tool_results == 1:
                return _tool_call("get_section", {"section": "S1"})
            return _tool_call("GroupResult", {"items": self._group_items(messages)})

        if self._has("ExtractedRequirements"):
            self.call_log.append("extract")
            return _tool_call("ExtractedRequirements", {"items": self._extracted(messages)})

        if self._has("CommitteeSummary"):
            self.call_log.append("summary")
            return _tool_call("CommitteeSummary", dict(self.summary))

        if self._has("EconomicLocations"):
            self.call_log.append("economics")
            if not saw_tool_result:
                return _tool_call("list_tables", {})
            return _tool_call("EconomicLocations", dict(self.economics or DEMO_ECONOMICS))

        if self._has("EvidenceFacts"):
            self.call_log.append("evidence")
            return _tool_call("EvidenceFacts", self._evidence(messages))

        if messages and "AI köməkçisisən" in str(messages[0].content):
            return self._chat(messages)

        self.call_log.append("plain")
        return _text("Saxta model: bağlanan alət tanınmadı.")

    def _chat(self, messages: list[BaseMessage]) -> ChatResult:
        """AI köməkçi komandası: agent bağlanan alətlərinə görə tanınır.

        triaj — açar sözlərə görə ötürür (handoff), ümumi suala özü cavab verir;
        maliyyə eksperti — əvvəl `maliyye_yoxlamalari`, sonra alət nəticəsinə əsaslanan cavab;
        tələb eksperti — əvvəl `sened_axtar` (semantik), sonra cavab.
        """
        self.call_log.append("chat")
        self.chat_calls.append((list(self.bound_tools), list(messages)))
        if self.chat_error:
            raise RuntimeError("provider 401: invalid x-api-key sk-ant-SIRR-123")
        human = next((str(m.content) for m in reversed(messages) if isinstance(m, HumanMessage)), "")
        own = lambda name: any(isinstance(m, ToolMessage) and m.name == name for m in messages)  # noqa: E731
        last_tool = next((str(m.content) for m in reversed(messages) if isinstance(m, ToolMessage)), "")
        if self._has("transfer_to_maliyye_eksperti"):
            self.chat_seen[:] = list(messages)
            q = human.lower()
            if any(k in q for k in ("npv", "irr", "maliyy", "investisiya", "rəqəm", "pul axını", "geri ödəmə")):
                return _tool_call("transfer_to_maliyye_eksperti", {"sebeb": "maliyyə sualı"})
            if any(k in q for k in ("tələb", "bölmə", "boş yer", "vöen", "sənəddə")):
                return _tool_call("transfer_to_teleb_eksperti", {"sebeb": "tələb sualı"})
            return _text("Saxta köməkçi cavabı.\n1. Birinci addım\n2. İkinci addım")
        if self._has("maliyye_yoxlamalari"):
            if not own("maliyye_yoxlamalari"):
                return _tool_call("maliyye_yoxlamalari", {})
            return _text("Saxta maliyyə eksperti: " + last_tool[:3000])
        if self._has("telebler"):
            if not own("sened_axtar"):
                return _tool_call("sened_axtar", {"sorgu": human})
            return _text("Saxta tələb eksperti: " + last_tool[:3000])
        return _text("Saxta model: naməlum köməkçi agenti.")

    def _group_items(self, messages: list[BaseMessage]) -> list[dict[str, Any]]:
        """Tapşırıq mətnindəki "- ID: ..." sətirlərindən nəticə qurur."""
        text = "\n".join(
            m.content for m in messages
            if isinstance(m, HumanMessage) and isinstance(m.content, str)
        )
        quote = _first_line(messages)
        items = []
        for req_id in _REQ_ID_RE.findall(text):
            if req_id in self.missing_ids:
                status, missing = "yoxdur", "Saxta model: tapılmadı."
            elif req_id in self.partial_ids:
                status, missing = "natamam", "Saxta model: qismən cavablanıb."
            else:
                status, missing = "var", None
            items.append({
                "req_id": req_id,
                "status": status,
                "sections": ["S1"],
                "quote": quote,
                "comment": "Saxta model tərəfindən yaradılmış nəticə.",
                "missing": missing,
            })
        return items


def _first_line(messages: list[BaseMessage]) -> str | None:
    """SON alət cavabının (get_section) mətnindəki ilk sətir — hərfi sitat."""
    for message in reversed(messages):
        if isinstance(message, ToolMessage) and isinstance(message.content, str):
            body = message.content.split("\n\n", 1)[-1]
            lines = [line.strip() for line in body.split("\n") if line.strip()]
            if lines:
                return lines[0][:120]
    return None


def _tool_call(name: str, args: dict[str, Any]) -> ChatResult:
    message = AIMessage(
        content="",
        tool_calls=[{"name": name, "args": args, "id": f"call_{name}"}],
    )
    return ChatResult(generations=[ChatGeneration(message=message)])


def _text(content: str) -> ChatResult:
    return ChatResult(generations=[ChatGeneration(message=AIMessage(content=content))])
