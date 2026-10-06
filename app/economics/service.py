"""İqtisadi təhlilin icrası: yerləşdirmə → yoxlama → qaydalar → suallar; sənəd yüklənəndə yenidən hesab.

Uyğunluq yoxlamasının statusuna TOXUNMUR: nəticə ayrıca `economics` cədvəlində saxlanılır.
Sənəd yüklənəndə model YENİDƏN ÇAĞIRILMIR — saxlanmış təsdiqlənmiş faktlar və sənəd analizi ilə
qaydalar yenidən hesablanır, "əvvəl/sonra" tarixçəyə yazılır.
"""
from __future__ import annotations

import logging
import traceback
import uuid
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any

from app import attachments, config, storage
from app.economics import evidence, extract, questions, rules
from app.ingest import parse_docx

log = logging.getLogger(__name__)

STATE_LABELS = {"gozleyir": "Gözləyir", "isleyir": "Hesablanır", "tamamlandi": "Tamamlandı", "xeta": "Xəta"}


class EconomicsError(ValueError):
    """İstifadəçiyə göstərilən xəta."""


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _run_config(check: dict[str, Any], name: str) -> dict[str, Any]:
    return {"run_name": f"{name}: {check.get('plan_name') or check['plan_id']} v{check['version']}",
            "tags": ["biznes-plan-komite", "iqtisadi-tehlil", f"plan:{check['plan_id']}"],
            "metadata": {"check_id": check["id"], "plan_id": check["plan_id"], "version": check["version"]},
            "recursion_limit": 40}


def _doc(check: dict[str, Any]) -> dict[str, Any]:
    doc = storage.doc_get(check["id"])
    if doc is None and Path(check.get("file_path") or "").exists():
        doc = parse_docx(check["file_path"])                  # köhnə yoxlama: sənəd yenidən oxunur
        storage.doc_set(check["id"], doc)
    if doc is None:
        raise EconomicsError("Sənəd tapılmadı — iqtisadi təhlil aparıla bilməz.")
    return doc


def ready(check: dict[str, Any] | None) -> str | None:
    """Təhlil başlaya bilərmi; bilməzsə səbəb."""
    if check is None:
        return "Yoxlama tapılmadı."
    if check.get("run_state") != "tamamlandi" or check.get("verdict") == "giris_xetasi":
        return "İqtisadi təhlil yalnız tamamlanmış yoxlama üçün aparılır."
    return None


def mark_started(check_id: str) -> None:
    storage.econ_set(check_id, state="isleyir", error=None)


def run(check_id: str) -> None:
    """Tam təhlil (fon tapşırığı). Xəta yoxlamaya təsir etmir — `economics.state = xeta`."""
    check = storage.get(check_id)
    if ready(check):
        return
    mark_started(check_id)
    try:
        doc = _doc(check)
        located = extract.locate(doc, check_id, _run_config(check, "İqtisadi təhlil"))
        facts = extract.verify(doc, located)
        result = compute(check, doc, facts)
        storage.econ_set(check_id, state="tamamlandi", error=None, facts=facts, result=result)
        questions.sync(check, result["findings"])
    except Exception as exc:
        traceback.print_exc()
        storage.econ_set(check_id, state="xeta", error=f"{type(exc).__name__}: {exc}")


def run_safe(check_id: str) -> None:
    """Yoxlama bitəndən sonra avtomatik — heç vaxt xəta qaldırmır."""
    if not config.ECONOMICS_AUTO:
        return
    try:
        run(check_id)
    except Exception as exc:                          # pragma: no cover — run özü tutur
        log.warning("iqtisadi təhlil alınmadı (%s)", type(exc).__name__)


def compute(check: dict[str, Any], doc: dict[str, Any], facts: dict[str, Any]) -> dict[str, Any]:
    finance = (check.get("result") or {}).get("finance")
    base = rules.evaluate(doc, facts, finance)
    items = storage.evidence_list(check["id"])
    findings = base["findings"] + evidence.evidence_findings(items)
    _attach_documents(findings, items, storage.questions_list(check["id"]))
    ctx = rules.Context(doc, facts, finance)
    risk = rules.risk_level(findings, base["sensitivity"]["scenarios"], ctx)
    return {"findings": findings, "sensitivity": base["sensitivity"], "risk": risk,
            "counts": counts(findings, base["sensitivity"]["scenarios"]),
            "rejected": facts.get("rejected") or [], "notes": facts.get("notes"), "ran_at": _now()}


def counts(findings: list[dict[str, Any]], scenarios: list[dict[str, Any]]) -> dict[str, Any]:
    def tally(group: str) -> dict[str, int]:
        own = [f for f in findings if f["group"] == group]
        return {"ok": sum(f["status"] == "ok" for f in own), "flag": sum(f["status"] == "flag" for f in own),
                "skip": sum(f["status"] == "skip" for f in own), "info": sum(f["status"] == "info" for f in own),
                "na": sum(f["status"] == "na" for f in own), "total": len(own)}
    return {"daxili": tally("daxili"), "realliq": tally("realliq"), "sened": tally("sened"),
            "hessasliq": {"negative": sum(1 for s in scenarios if s.get("negative")),
                          "total": sum(1 for s in scenarios if s.get("status") == "ok"),
                          "skip": sum(1 for s in scenarios if s.get("status") == "skip")}}


def _attach_documents(findings: list[dict[str, Any]], items: list[dict[str, Any]],
                      question_rows: list[dict[str, Any]]) -> None:
    """Hər tapıntının tələb etdiyi sənəd: yüklənibsə — hansı fayl, yoxdursa — gözlənilir."""
    by_question = {q["finding_id"]: q["id"] for q in question_rows if q.get("finding_id")}
    for f in findings:
        qid = by_question.get(f["id"])
        status = {}
        for doc_type in f.get("documents") or []:
            matched = [e for e in items if e.get("doc_type") == doc_type or (qid and e.get("question_id") == qid)]
            status[doc_type] = [{"id": e["id"], "file_name": e["file_name"]} for e in matched]
        f["documents_status"] = status


def reevaluate(check_id: str, trigger: dict[str, Any]) -> dict[str, Any] | None:
    """Sənəd yükləndikdən (və ya silindikdən) sonra — modelsiz yenidən hesab, "əvvəl/sonra" ilə."""
    check = storage.get(check_id)
    row = storage.econ_get(check_id)
    if check is None or row is None or not row.get("facts"):
        return None
    before = row.get("result") or {}
    after = compute(check, _doc(check), row["facts"])
    history = row.get("history") or []
    history.append({"at": _now(), "trigger": trigger, **diff(before, after)})
    storage.econ_set(check_id, state="tamamlandi", result=after, history=history)
    questions.sync(check, after["findings"])
    return after


def diff(before: dict[str, Any], after: dict[str, Any]) -> dict[str, Any]:
    old = {f["id"]: f for f in before.get("findings") or []}
    new = {f["id"]: f for f in after.get("findings") or []}
    changes = []
    for fid in list(old) + [k for k in new if k not in old]:
        a, b = old.get(fid), new.get(fid)
        if a and b and (a["status"], a.get("severity")) == (b["status"], b.get("severity")):
            continue
        changes.append({"id": fid, "title": (b or a)["title"],
                        "before": {"status": a["status"], "severity": a.get("severity")} if a else None,
                        "after": {"status": b["status"], "severity": b.get("severity")} if b else None})
    return {"risk_before": (before.get("risk") or {}).get("level"), "risk_after": (after.get("risk") or {}).get("level"),
            "changes": changes}


# ── Sənədlər ───────────────────────────────────────────────────────────────

def evidence_dir() -> Path:
    path = config.UPLOAD_DIR / "evidence"
    path.mkdir(parents=True, exist_ok=True)
    return path


def add_evidence(check_id: str, file_name: str, data: bytes, question_id: str | None = None,
                 req_code: str | None = None, doc_type: str | None = None) -> dict[str, Any]:
    """Faylı saxlayır (analiz fon tapşırığında — `analyze_evidence`)."""
    from app.economics.catalog import DOCUMENTS

    check = storage.get(check_id)
    if check is None:
        raise EconomicsError("Yoxlama tapılmadı.")
    kind = evidence.kind_of(file_name)
    if not data:
        raise EconomicsError("Fayl boşdur.")
    if len(data) > evidence.MAX_BYTES:
        raise EconomicsError(f"Faylın həcmi {evidence.MAX_BYTES // (1024 * 1024)} MB-dan çox ola bilməz.")
    question = storage.question_get(question_id) if question_id else None
    if question_id and (question is None or question["check_id"] != check_id):
        raise EconomicsError("Sual tapılmadı.")
    if doc_type and doc_type not in DOCUMENTS:
        raise EconomicsError("Naməlum sənəd növü.")
    if not doc_type:
        doc_type = "excel_model" if kind == "excel" else ((question or {}).get("documents") or [None])[0]
    evidence_id = "E" + uuid.uuid4().hex[:10]
    stored = evidence_id + Path(file_name).suffix.lower()
    (evidence_dir() / stored).write_bytes(data)
    item = {"id": evidence_id, "check_id": check_id, "plan_id": check["plan_id"], "question_id": question_id,
            "req_code": (req_code or "").strip() or None, "doc_type": doc_type, "kind": kind,
            "file_name": Path(file_name).name, "stored": stored, "size": len(data),
            "analysis": {"state": "isleyir"}}
    storage.evidence_add(item)
    if question and question["status"] in storage.OPEN_QUESTION_STATUSES:
        questions.update(question["id"], {"status": "cavablandi"})
    return storage.evidence_get(evidence_id)


def analyze_evidence(evidence_id: str) -> None:
    """Fon tapşırığı: sənədi yoxlayır, sonra iqtisadi təhlili yenidən hesablayır."""
    item = storage.evidence_get(evidence_id)
    if item is None:
        return
    check = storage.get(item["check_id"]) or {}
    data = (evidence_dir() / item["stored"]).read_bytes()
    try:
        analysis = _analyze(item, check, data)
    except Exception as exc:
        traceback.print_exc()
        analysis = {"kind": item["kind"], "error": str(exc) if isinstance(exc, (evidence.EvidenceError,
                                                                              attachments.AttachmentError))
                    else f"{type(exc).__name__}"}
    analysis["state"] = "tamamlandi"
    storage.evidence_set_analysis(evidence_id, analysis)
    reevaluate(item["check_id"], {"kind": "sened", "evidence_id": evidence_id, "file_name": item["file_name"]})


def _plan_values(check: dict[str, Any], facts: dict[str, Any] | None) -> dict[str, float | None]:
    claimed = ((check.get("result") or {}).get("finance") or {}).get("claimed") or {}
    revenue = ((facts or {}).get("rows") or {}).get("revenue")
    first_revenue = next((v for v in (revenue or {}).get("values") or [] if v), None)
    return {"npv": claimed.get("npv"), "irr_pct": claimed.get("irr_pct"), "payback_years": claimed.get("payback_years"),
            "investment_total": claimed.get("investment_total"), "revenue_y1": first_revenue}


def _company(check: dict[str, Any], facts: dict[str, Any] | None) -> str:
    quote = (((facts or {}).get("statements") or {}).get("company_name") or {}).get("quote") or ""
    import re
    m = re.search(r"[“\"«]([^”\"»]+)[”\"»]", quote)
    return m.group(1) if m else (quote or check.get("plan_name") or "")


def _analyze(item: dict[str, Any], check: dict[str, Any], data: bytes) -> dict[str, Any]:
    facts = (storage.econ_get(item["check_id"]) or {}).get("facts")
    if item["kind"] == "sekil":
        return {"kind": "sekil"}
    if item["kind"] == "excel":
        return evidence.analyze_excel(data, _plan_values(check, facts))
    text = "\n".join(p["text"] for p in attachments.extract_parts(item["kind"], data))
    raw = evidence.extract_facts(text, _run_config(check, "Əlavə sənəd"))
    verified = evidence.verify_facts(text, raw)
    doc_type = item.get("doc_type") or raw.get("doc_kind")
    figures = (facts or {}).get("figures") or {}
    volume = ((facts or {}).get("rows") or {}).get("sales_volume_t") or {}
    context = {"company": _company(check, facts),
               "equipment_value": (figures.get("equipment_value") or {}).get("value"),
               "capex_lines": capex_lines(storage.doc_get(item["check_id"]), facts),
               "first_volume": next((v for v in volume.get("values") or [] if v), None),
               "today": date.today()}
    return {"kind": item["kind"], "text_chars": len(text), **verified,
            "checks": evidence.document_checks(verified, doc_type, context)}


def capex_lines(doc: dict[str, Any] | None, facts: dict[str, Any] | None) -> list[tuple[str, float]]:
    """Capex cədvəlinin sətirləri (ad, məbləğ) — avadanlıq rəqəminin götürüldüyü cədvəldən, Python oxuyur."""
    from app.ingest import find_table
    from app.numbers import parse_number

    source = (((facts or {}).get("figures") or {}).get("equipment_value") or {}).get("source") or {}
    table = find_table(doc or {"tables": []}, source.get("location") or "")
    if not table or not table.get("rows"):
        return []
    header = table["rows"][0]
    column = next((i for i, cell in enumerate(header) if "məbləğ" in cell.casefold()), None)
    lines = []
    for row in table["rows"][1:]:
        label = next((c for c in row[:2] if c.strip() and not c.strip().isdigit()), "")
        cell = row[column] if column is not None and column < len(row) else ""
        value = parse_number(cell)
        if label and value:
            lines.append((label.strip(), value))
    return lines


def remove_evidence(evidence_id: str) -> bool:
    item = storage.evidence_delete(evidence_id)
    if item is None:
        return False
    try:
        (evidence_dir() / item["stored"]).unlink(missing_ok=True)
    except OSError:
        pass
    reevaluate(item["check_id"], {"kind": "sened_silindi", "evidence_id": evidence_id, "file_name": item["file_name"]})
    return True


# ── API görüntüsü ──────────────────────────────────────────────────────────

def view(check_id: str) -> dict[str, Any]:
    row = storage.econ_get(check_id) or {"state": "gozleyir", "result": None, "history": [], "error": None}
    qs = storage.questions_list(check_id)
    return {
        "state": row["state"], "state_label": STATE_LABELS.get(row["state"], row["state"]),
        "error": row.get("error"), "updated_at": row.get("updated_at"),
        "result": row.get("result"), "history": row.get("history") or [],
        "questions": qs, "open_questions": sum(1 for q in qs if questions.is_open(q)),
        "evidence": [{k: v for k, v in e.items() if k != "stored"} for e in storage.evidence_list(check_id)],
    }
