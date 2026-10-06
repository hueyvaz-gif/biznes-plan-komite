"""Əlavə tələb sənədləri: qəbul, təhlükəsiz saxlama və mətnin çıxarılması.

Dəstəklənən formatlar: mətnli PDF, DOCX, TXT (UTF-8). Əlavə tələbi mətn kimi
yazmaq da olar (`extra_text`).

Qaydalar:
  • Fayl istifadəçinin adı ilə DEYİL, daxili ad (`uuid`) ilə saxlanılır;
    istifadəçi adı yalnız göstərmək üçündür və yol kimi işlənmir.
  • Mətn çıxarıla bilmirsə (skan PDF — OCR yoxdur, boş və ya zədələnmiş fayl),
    fayl "oxundu" kimi göstərilmir: `status="xeta"` və aydın səbəb.
  • Hər faylın SHA-256 izi saxlanılır — tələb siyahısının versiyası ona bağlıdır.
  • Çıxarılan mətn yalnız MƏLUMATDIR — heç vaxt təlimat kimi icra olunmur
    (bax: `app/agents/extra_requirements.py`).
"""
from __future__ import annotations

import hashlib
import io
import re
import uuid
import zipfile
from pathlib import Path
from typing import Any

from app import config
from app.ingest import heading_level

#: Limitlər — UI-də yükləmədən ƏVVƏL göstərilir (`/api/meta`).
MAX_FILES = 10
MAX_FILE_BYTES = 10 * 1024 * 1024
MAX_TOTAL_BYTES = 30 * 1024 * 1024
MAX_EXTRA_TEXT = 20_000
#: Bundan az mətn "çıxarılmadı" sayılır (skan PDF adətən 0 simvol verir).
MIN_TEXT_CHARS = 20

ALLOWED = {".pdf": "pdf", ".docx": "docx", ".txt": "txt"}

SCAN_MESSAGE = ("Mətn çıxarıla bilmədi; mətnli PDF, DOCX və ya TXT yükləyin "
                "(skan edilmiş PDF üçün OCR dəstəklənmir).")


class AttachmentError(ValueError):
    """İstifadəçiyə göstərilən aydın xəta."""


def limits() -> dict[str, Any]:
    return {
        "max_files": MAX_FILES,
        "max_file_mb": MAX_FILE_BYTES // (1024 * 1024),
        "max_total_mb": MAX_TOTAL_BYTES // (1024 * 1024),
        "max_extra_text": MAX_EXTRA_TEXT,
        "formats": sorted(ALLOWED),
    }


def attachments_dir() -> Path:
    path = config.UPLOAD_DIR / "elave"
    path.mkdir(parents=True, exist_ok=True)
    return path


# ── Mətnin çıxarılması ─────────────────────────────────────────────────────

def _clean(text: str) -> str:
    text = text.replace("\r\n", "\n").replace("\r", "\n").replace("\x00", "")
    return re.sub(r"[ \t]+\n", "\n", text).strip()


def _pdf_parts(data: bytes) -> list[dict[str, str]]:
    try:
        from pypdf import PdfReader
        from pypdf.errors import PdfReadError
    except ImportError as exc:  # pragma: no cover — requirements.txt-də var
        raise AttachmentError("PDF oxumaq üçün 'pypdf' paketi quraşdırılmayıb.") from exc
    try:
        reader = PdfReader(io.BytesIO(data))
        if reader.is_encrypted:
            raise AttachmentError("PDF şifrələnib — şifrəsiz versiyanı yükləyin.")
        parts = []
        for number, page in enumerate(reader.pages, start=1):
            text = _clean(page.extract_text() or "")
            if text:
                parts.append({"ref": f"səh. {number}", "text": text})
    except AttachmentError:
        raise
    except (PdfReadError, ValueError, KeyError, TypeError, OSError) as exc:
        raise AttachmentError("PDF faylı zədələnib və ya oxunmur.") from exc
    return parts


def _docx_parts(data: bytes) -> list[dict[str, str]]:
    import docx

    if not zipfile.is_zipfile(io.BytesIO(data)):
        raise AttachmentError("DOCX faylı zədələnib və ya əslində DOCX deyil.")
    try:
        document = docx.Document(io.BytesIO(data))
    except Exception as exc:  # python-docx-in daxili xətaları
        raise AttachmentError("DOCX faylı açıla bilmədi — zədələnib.") from exc

    parts: list[dict[str, str]] = []
    ref, lines = "sənədin əvvəli", []

    def flush() -> None:
        text = _clean("\n".join(lines))
        if text:
            parts.append({"ref": ref, "text": text})

    try:
        for paragraph in document.paragraphs:
            text = paragraph.text.strip()
            if not text:
                continue
            # Başlıq xam XML-dəki stil identifikatorundan (əsas parserlə eyni qayda):
            # p.style naməlum stildə None ola bilər; tanınmayan stil adi paraqrafdır.
            if heading_level(paragraph) is not None:
                flush()
                ref, lines = f"bölmə: {text}", []
            else:
                lines.append(text)
        flush()
        for number, table in enumerate(document.tables, start=1):
            rows = [" | ".join(cell.text.strip() for cell in row.cells) for row in table.rows]
            text = _clean("\n".join(r for r in rows if r.strip(" |")))
            if text:
                parts.append({"ref": f"cədvəl {number}", "text": text})
    except Exception as exc:  # python-docx-in daxili xətaları — fayla aid aydın xəta
        raise AttachmentError("DOCX faylının quruluşu zədələnib — mətn oxuna bilmədi. "
                              "Faylı Word-də açıb yenidən saxlayın.") from exc
    return parts


def _txt_parts(data: bytes) -> list[dict[str, str]]:
    if data.startswith((b"\xff\xfe", b"\xfe\xff")):
        text = data.decode("utf-16")
    else:
        try:
            text = data.decode("utf-8-sig")
        except UnicodeDecodeError as exc:
            raise AttachmentError("Mətn faylının kodlaşdırması tanınmadı — UTF-8 kimi "
                                  "saxlayıb yenidən yükləyin.") from exc
    return _text_parts(text)


def _text_parts(text: str) -> list[dict[str, str]]:
    """Mətni abzaslara bölür (boş sətirlə ayrılmış): istinad "abzas N"."""
    blocks = [b for b in re.split(r"\n\s*\n", _clean(text)) if b.strip()]
    return [{"ref": f"abzas {n}", "text": b.strip()} for n, b in enumerate(blocks, start=1)]


def extract_parts(kind: str, data: bytes) -> list[dict[str, str]]:
    """Faylın mətnini istinadlı hissələr şəklində qaytarır; xətada AttachmentError."""
    if not data:
        raise AttachmentError("Fayl boşdur.")
    parts = {"pdf": _pdf_parts, "docx": _docx_parts, "txt": _txt_parts}[kind](data)
    if sum(len(p["text"]) for p in parts) < MIN_TEXT_CHARS:
        raise AttachmentError(SCAN_MESSAGE if kind == "pdf" else
                              "Faylda oxunan mətn yoxdur.")
    return parts


# ── Qəbul ──────────────────────────────────────────────────────────────────

def _record(attachment_id: str, name: str, kind: str, data: bytes) -> dict[str, Any]:
    return {
        "id": attachment_id,
        "name": name,
        "kind": kind,
        "size": len(data),
        "sha256": hashlib.sha256(data).hexdigest(),
        "stored": None,
        "status": "oxundu",
        "error": None,
        "parts": [],
        "chars": 0,
    }


def accept(files: list[tuple[str, bytes]], extra_text: str = "") -> list[dict[str, Any]]:
    """Faylları yoxlayır, saxlayır və mətnini çıxarır.

    Ümumi limitlər pozulubsa AttachmentError atılır (heç nə saxlanılmır).
    Ayrı-ayrı faylın xətası (skan PDF, zədələnmiş fayl) isə həmin faylın
    `status="xeta"` qeydinə yazılır — istifadəçi onu siyahıda görür.
    """
    files = [(name, data) for name, data in files if name or data]
    if len(files) > MAX_FILES:
        raise AttachmentError(f"Ən çoxu {MAX_FILES} əlavə fayl yükləmək olar.")
    total = sum(len(data) for _name, data in files)
    if total > MAX_TOTAL_BYTES:
        raise AttachmentError(f"Əlavə faylların ümumi həcmi {MAX_TOTAL_BYTES // (1024 * 1024)} "
                              f"MB-dan çox ola bilməz.")
    if len(extra_text) > MAX_EXTRA_TEXT:
        raise AttachmentError(f"Əlavə tələb mətni {MAX_EXTRA_TEXT} simvoldan uzun ola bilməz.")

    records: list[dict[str, Any]] = []
    for number, (raw_name, data) in enumerate(files, start=1):
        name = Path(raw_name or "adsız").name[:120]      # yalnız göstərmək üçün
        suffix = Path(name).suffix.lower()
        kind = ALLOWED.get(suffix)
        record = _record(f"A{number}", name, kind or suffix.lstrip(".") or "?", data)
        records.append(record)
        if kind is None:
            record.update(status="xeta", error="Dəstəklənməyən format. Yalnız PDF, DOCX və "
                                               "TXT qəbul edilir.")
            continue
        if len(data) > MAX_FILE_BYTES:
            record.update(status="xeta", error=f"Fayl {MAX_FILE_BYTES // (1024 * 1024)} "
                                               f"MB-dan böyükdür.")
            continue
        stored = attachments_dir() / f"{uuid.uuid4().hex}{suffix}"   # daxili ad
        stored.write_bytes(data)
        record["stored"] = stored.name
        try:
            parts = extract_parts(kind, data)
        except AttachmentError as exc:
            record.update(status="xeta", error=str(exc))
            continue
        record.update(parts=parts, chars=sum(len(p["text"]) for p in parts))

    text = (extra_text or "").strip()
    if text:
        data = text.encode("utf-8")
        record = _record(f"A{len(records) + 1}", "Əlavə tələb mətni", "metn", data)
        record.update(parts=_text_parts(text), chars=len(text))
        records.append(record)
    return records


def public(record: dict[str, Any]) -> dict[str, Any]:
    """Frontend üçün: mətnin özü və daxili ad göndərilmir."""
    return {k: record[k] for k in ("id", "name", "kind", "size", "sha256", "status",
                                   "error", "chars")} | {"parts": len(record["parts"])}
