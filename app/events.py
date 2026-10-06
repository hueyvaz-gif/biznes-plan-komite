"""Agent fəaliyyətinin jurnalı — "Agentlər nə etdi" paneli üçün.

`EventLogger` LangChain callback handler-idir: run_check-in config-inə
`callbacks` kimi verilir və LangSmith izləyicisi ilə YANAŞI işləyir.

Nə yazılır (storage.events):
  • qovşaq   — ana qrafın qovşağı (ingest, finance, compliance, …): başlanğıc, müddət, status;
  • alət     — alət adı, qısa arqument (≤ 200 simvol), qısa nəticə ("52 bölmə",
               "T27: 15 sətir"), müddət, status. Nəticə "XƏTA:" ilə başlayırsa —
               status "alət xətası": alət agentə düzəliş mesajı qaytarıb (xəta idarəsi);
  • llm      — LLM çağırışı: müddət və token sayı (usage_metadata varsa);
  • nəticə   — agentin struktur cavabı hazırdır (ToolStrategy on_tool_start çağırmır,
               ona görə qovşaq bunu `emit_result` ilə özü yazır).

Nə YAZILMIR: modelin daxili düşüncəsi, sərbəst mətni, sənədin məzmunu.

Agent və qrup run metadata-sından götürülür ({"agent": "maliyye"},
{"agent": "uygunluq", "group": "swot", "group_title": "…"}). Metadata yalnız
*_start hadisələrinə gəlir — bitmə hadisəsi üçün run_id ilə yadda saxlanılır.
Uyğunluq qrupları paralel işlədiyi üçün handler thread-safe-dir.
"""
from __future__ import annotations

import re
import threading
import time
from typing import Any
from uuid import UUID

from langchain_core.callbacks import BaseCallbackHandler

from app import storage

#: Ana qrafın görünən qovşaqları — qovşaq hadisəsi yalnız bunlar üçün yazılır.
NODES = ("ingest", "load_previous", "finance", "compliance", "decide_status",
         "compare_previous", "write_summary", "save")

TOOL_ERROR = "alət xətası"
_SECTION_ID = re.compile(r"^S\d+ \|")
_TABLE_ID = re.compile(r"^T\d+ \|")
MAX_ARGS = 200


def _text(output: Any) -> str:
    content = getattr(output, "content", output)
    return content if isinstance(content, str) else str(content)


def summarize_tool(name: str, output: Any) -> tuple[str, str]:
    """Alət nəticəsinin qısa xülasəsi və statusu — mətnin özü saxlanılmır."""
    text = _text(output)
    if text.startswith("XƏTA"):
        return text.split("\n", 1)[0][:160], TOOL_ERROR
    lines = [line for line in text.split("\n") if line.strip()]
    if name == "list_sections":                  # başlıqlar çoxsətirli ola bilər — id-ləri say
        return f"{sum(1 for line in lines if _SECTION_ID.match(line))} bölmə", "ok"
    if name == "list_tables":
        return f"{sum(1 for line in lines if _TABLE_ID.match(line))} cədvəl", "ok"
    head = lines[0].split(" | ")[0] if lines else ""
    if name == "get_table":
        part = next((line for line in lines if line.startswith("… (hissə")), "")
        rows = len([line for line in lines[1:] if " | " in line])
        return f"{head}: {rows} sətir" + (f" {part[2:]}" if part else ""), "ok"
    if name == "get_section":
        part = next((line for line in lines if line.startswith("… (hissə")), "")
        return f"{head}: {len(text)} simvol" + (f" {part[2:]}" if part else ""), "ok"
    return f"{len(text)} simvol", "ok"


class EventLogger(BaseCallbackHandler):
    """Hadisələri `storage.events`-ə yazır. Bir icra cəhdi üçün bir obyekt."""

    raise_error = False          # jurnalın xətası icranı dayandırmamalıdır

    def __init__(self, check_id: str, attempt: int) -> None:
        self.check_id = check_id
        self.attempt = attempt
        self._lock = threading.Lock()
        self._runs: dict[UUID, dict[str, Any]] = {}

    # ── köməkçilər ──────────────────────────────────────────────────────────
    def _remember(self, run_id: UUID, **info: Any) -> None:
        with self._lock:
            self._runs[run_id] = {"start": time.time(), **info}

    def _pop(self, run_id: UUID) -> dict[str, Any] | None:
        with self._lock:
            return self._runs.pop(run_id, None)

    def _write(self, **event: Any) -> None:
        try:
            storage.event_add(check_id=self.check_id, attempt=self.attempt, **event)
        except Exception:  # noqa: BLE001 — jurnal yazılmasa da yoxlama davam edir
            pass

    def _finish(self, run_id: UUID, kind: str, status: str, summary: str | None) -> None:
        info = self._pop(run_id)
        if info is None:
            return
        self._write(ts=info["start"], agent=info.get("agent"), grp=info.get("group"),
                    kind=kind, name=info.get("name"), args=info.get("args"), summary=summary,
                    status=status, duration_ms=int((time.time() - info["start"]) * 1000))

    @staticmethod
    def _who(metadata: dict[str, Any] | None) -> dict[str, Any]:
        md = metadata or {}
        group = md.get("group")
        title = md.get("group_title")
        return {"agent": md.get("agent"), "group": f"{group}|{title}" if group else None}

    # ── qovşaqlar ───────────────────────────────────────────────────────────
    def on_chain_start(self, serialized: dict[str, Any] | None, inputs: Any, *, run_id: UUID,
                       metadata: dict[str, Any] | None = None, **kwargs: Any) -> None:
        name = kwargs.get("name") or (serialized or {}).get("name")
        if name in NODES and (metadata or {}).get("langgraph_node") == name \
                and not (metadata or {}).get("agent"):
            self._remember(run_id, kind="node", name=name, agent="qraf")

    def on_chain_end(self, outputs: Any, *, run_id: UUID, **kwargs: Any) -> None:
        if run_id in self._runs and self._runs[run_id].get("kind") == "node":
            self._finish(run_id, "node", "ok", None)

    def on_chain_error(self, error: BaseException, *, run_id: UUID, **kwargs: Any) -> None:
        if run_id in self._runs and self._runs[run_id].get("kind") == "node":
            self._finish(run_id, "node", "xeta", f"{type(error).__name__}: {error}"[:200])

    # ── alətlər ─────────────────────────────────────────────────────────────
    def on_tool_start(self, serialized: dict[str, Any] | None, input_str: str, *, run_id: UUID,
                      metadata: dict[str, Any] | None = None, **kwargs: Any) -> None:
        name = kwargs.get("name") or (serialized or {}).get("name") or "alət"
        args = kwargs.get("inputs")
        args_text = input_str if args is None else ", ".join(f"{k}={v}" for k, v in args.items())
        self._remember(run_id, kind="tool", name=name, args=(args_text or "")[:MAX_ARGS],
                       **self._who(metadata))

    def on_tool_end(self, output: Any, *, run_id: UUID, **kwargs: Any) -> None:
        with self._lock:
            name = (self._runs.get(run_id) or {}).get("name", "")
        summary, status = summarize_tool(name, output)
        self._finish(run_id, "tool", status, summary)

    def on_tool_error(self, error: BaseException, *, run_id: UUID, **kwargs: Any) -> None:
        self._finish(run_id, "tool", "xeta", f"{type(error).__name__}: {error}"[:200])

    # ── LLM ─────────────────────────────────────────────────────────────────
    def on_chat_model_start(self, serialized: dict[str, Any] | None, messages: Any, *,
                            run_id: UUID, metadata: dict[str, Any] | None = None,
                            **kwargs: Any) -> None:
        self._remember(run_id, kind="llm", name="LLM çağırışı", **self._who(metadata))

    def on_llm_end(self, response: Any, *, run_id: UUID, **kwargs: Any) -> None:
        usage = None
        try:
            message = response.generations[0][0].message
            usage = getattr(message, "usage_metadata", None)
        except (AttributeError, IndexError):
            pass
        summary = (f"giriş {usage.get('input_tokens', 0)} · çıxış {usage.get('output_tokens', 0)} token"
                   if usage else None)
        self._finish(run_id, "llm", "ok", summary)

    def on_llm_error(self, error: BaseException, *, run_id: UUID, **kwargs: Any) -> None:
        self._finish(run_id, "llm", "xeta", f"{type(error).__name__}: {error}"[:200])

    # ── agentin nəticəsi (qovşaq özü çağırır) ───────────────────────────────
    def result(self, agent: str, summary: str, status: str = "ok", group: str | None = None,
               started: float | None = None) -> None:
        now = time.time()                   # bitmə anı — zaman xəttində nişan burada
        self._write(ts=now, agent=agent, grp=group, kind="result",
                    name="nəticə hazır", args=None, summary=summary, status=status,
                    duration_ms=int((now - started) * 1000) if started else None)


def _loggers(config: Any) -> list[EventLogger]:
    callbacks = (config or {}).get("callbacks")
    handlers = getattr(callbacks, "handlers", callbacks) or []
    return [h for h in handlers if isinstance(h, EventLogger)]


def emit_result(config: Any, agent: str, summary: str, status: str = "ok",
                group: str | None = None, started: float | None = None) -> None:
    """Qovşaqdan: agentin struktur cavabı hazırdır (və ya alınmadı)."""
    for logger in _loggers(config):
        logger.result(agent, summary, status, group, started)
