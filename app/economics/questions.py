"""Ərizəçiyə suallar — tapıntılardan avtomatik, komitə üzvü əlavə/redaktə/silə bilər.

Qaydanın sualı tapıntının id-si ilə bağlıdır (`<check_id>:<finding_id>`): təhlil yenidən hesablananda
mətn və tələb olunan sənədlər yenilənir, amma komitənin redaktə etdiyi mətn və verdiyi status QORUNUR.
Qayda artıq sual vermirsə: komitə toxunmayıbsa (açıq, redaktəsiz, sənəd bağlanmayıb) sual silinir,
toxunubsa `stale` işarələnir ("qayda artıq bayraq vermir").
"""
from __future__ import annotations

import io
import uuid
from datetime import datetime, timezone
from typing import Any

from app import storage
from app.economics.catalog import DOCUMENTS

STATUS_LABELS = {"aciq": "Açıq", "cavab_gozlenilir": "Cavab gözlənilir", "cavablandi": "Cavablandı",
                 "qebul": "Qəbul edildi", "redd": "Rədd edildi"}
SEVERITY_ORDER = {"yuksek": 0, "orta": 1, "asagi": 2}


def rule_question_id(check_id: str, finding_id: str) -> str:
    return f"{check_id}:{finding_id}"


def sync(check: dict[str, Any], findings: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Qaydaların suallarını bazaya yazır; komitənin dəyişiklikləri qorunur."""
    existing = {q["id"]: q for q in storage.questions_list(check["id"])}
    asked = sorted((f for f in findings if f.get("question")),
                   key=lambda f: (SEVERITY_ORDER.get(f.get("severity") or "", 3), f["group"] != "daxili"))
    seen = set()
    for position, f in enumerate(asked):
        qid = rule_question_id(check["id"], f["id"])
        seen.add(qid)
        old = existing.get(qid)
        item = {
            "id": qid, "check_id": check["id"], "plan_id": check["plan_id"], "finding_id": f["id"],
            "origin": "qayda", "severity": f.get("severity"), "documents": f.get("documents") or [],
            "text": old["text"] if old and old["edited"] else f["question"],
            "status": old["status"] if old else "aciq", "note": old["note"] if old else None,
            "decided_by": old["decided_by"] if old else None, "edited": bool(old and old["edited"]),
            "stale": False, "position": position, "created_at": old["created_at"] if old else None,
        }
        storage.question_upsert(item)
    linked = {e.get("question_id") for e in storage.evidence_list(check["id"])}
    for qid, old in existing.items():
        if old["origin"] != "qayda" or qid in seen or old["stale"]:
            continue
        # Komitə toxunmayıbsa (açıq, redaktəsiz, sənədsiz) — sual silinir; toxunubsa iz qalsın deyə saxlanılır.
        if old["status"] == "aciq" and not old["edited"] and qid not in linked:
            storage.question_delete(qid)
        else:
            storage.question_upsert({**old, "stale": True})
    return storage.questions_list(check["id"])


def add(check: dict[str, Any], text: str, documents: list[str] | None = None) -> dict[str, Any]:
    text = (text or "").strip()
    if not text:
        raise ValueError("Sualın mətni boş ola bilməz.")
    position = 1000 + len(storage.questions_list(check["id"]))
    item = {"id": "Q" + uuid.uuid4().hex[:10], "check_id": check["id"], "plan_id": check["plan_id"],
            "finding_id": None, "origin": "komite", "text": text, "documents": _clean_docs(documents),
            "severity": None, "status": "aciq", "position": position}
    storage.question_upsert(item)
    return storage.question_get(item["id"])


def update(question_id: str, changes: dict[str, Any]) -> dict[str, Any]:
    question = storage.question_get(question_id)
    if question is None:
        raise KeyError(question_id)
    if "text" in changes:
        text = str(changes["text"] or "").strip()
        if not text:
            raise ValueError("Sualın mətni boş ola bilməz.")
        if text != question["text"]:
            question["text"], question["edited"] = text, True
    if "status" in changes:
        if changes["status"] not in storage.QUESTION_STATUSES:
            raise ValueError("Naməlum status.")
        question["status"] = changes["status"]
    if "documents" in changes:
        question["documents"] = _clean_docs(changes["documents"])
    for key in ("note", "decided_by"):
        if key in changes:
            question[key] = (str(changes[key]).strip() or None) if changes[key] is not None else None
    storage.question_upsert(question)
    return storage.question_get(question_id)


def _clean_docs(documents: list[str] | None) -> list[str]:
    return [d for d in (documents or []) if d in DOCUMENTS]


def is_open(question: dict[str, Any]) -> bool:
    return question["status"] in storage.OPEN_QUESTION_STATUSES and not question.get("stale")


# ── Məktub (.docx) ─────────────────────────────────────────────────────────

def letter_docx(check: dict[str, Any], questions: list[dict[str, Any]], company: str | None = None) -> bytes:
    """Rəsmi məktub: başlıq, tarix, müraciət, nömrələnmiş suallar, tələb olunan sənədlər, imza yeri."""
    from docx import Document
    from docx.enum.text import WD_ALIGN_PARAGRAPH
    from docx.shared import Pt

    open_questions = [q for q in questions if is_open(q)]
    document = Document()
    style = document.styles["Normal"]
    style.font.name = "Times New Roman"
    style.font.size = Pt(12)

    head = document.add_paragraph()
    head.alignment = WD_ALIGN_PARAGRAPH.CENTER
    run = head.add_run("BİZNES PLAN QİYMƏTLƏNDİRMƏ KOMİTƏSİ")
    run.bold = True

    today = datetime.now(timezone.utc).strftime("%d.%m.%Y")
    meta = document.add_paragraph()
    meta.add_run(f"Tarix: {today}\n")
    meta.add_run(f"Nömrə: ____________\n")
    meta.add_run(f"Kimə: {company or check.get('plan_name') or check['plan_id']}")

    subject = document.add_paragraph()
    subject.add_run("Mövzu: ").bold = True
    subject.add_run(f"“{check.get('plan_name') or check['plan_id']}” biznes planı (versiya {check['version']}, "
                    f"{check['file_name']}) üzrə əlavə suallar və sənəd sorğusu")

    document.add_paragraph("Hörmətli təşəbbüskar,")
    document.add_paragraph(
        "Təqdim etdiyiniz biznes planın ilkin iqtisadi təhlili zamanı aşağıdakı məsələlərin aydınlaşdırılması "
        "zəruri hesab edilmişdir. Cavablarınızı və göstərilən sənədləri təqdim etməyinizi xahiş edirik.")

    if open_questions:
        document.add_paragraph("Suallar", style="Heading 2")
        for q in open_questions:
            item = document.add_paragraph(q["text"], style="List Number")
            if not q["documents"]:
                item.add_run(" (yazılı cavab)").italic = True
    else:
        document.add_paragraph("Açıq sual yoxdur.")

    docs = []
    for q in open_questions:
        for d in q["documents"]:
            if d not in docs:
                docs.append(d)
    if docs:
        document.add_paragraph("Tələb olunan sənədlər", style="Heading 2")
        for d in docs:
            document.add_paragraph(DOCUMENTS.get(d, d), style="List Bullet")

    document.add_paragraph(
        "Qeyd: bu məktub avtomatik ilkin iqtisadi təhlilin nəticəsi əsasında hazırlanıb və komitə üzvü "
        "tərəfindən yoxlanılıb. İnvestisiya qərarı deyil.")
    sign = document.add_paragraph()
    sign.add_run("\nKomitə adından: ______________________        İmza: ____________")

    buffer = io.BytesIO()
    document.save(buffer)
    return buffer.getvalue()
