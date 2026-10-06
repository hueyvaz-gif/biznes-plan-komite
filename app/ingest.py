"""docx faylının LLM-siz oxunması: bölmələr, cədvəllər, doldurulmamış yerlər.

Nəticə sadə dict-dir və bütövlükdə JSON-a çevrilə bilir — qrafın state-ində saxlanılır.
"""
from __future__ import annotations

import re
import zipfile
from pathlib import Path
from typing import Any, Iterator

import docx
from docx.document import Document as DocxDocument
from docx.oxml.ns import qn
from docx.table import Table
from docx.text.paragraph import Paragraph

# ── Sabitlər ───────────────────────────────────────────────────────────────

#: Doldurulmamış yer: kvadrat mötərizədə qısa mətn — "[VÖEN]", "[tarix]" və s.
PLACEHOLDER_RE = re.compile(r"\[[^\[\]\n]{1,80}\]")

#: Başlıq stilləri xam XML-dən oxunur (p.style bu sənəddə bəzən None qaytarır).
#: Lokallaşdırılmış adlar da nəzərə alınır.
_HEADING_STYLE_RE = re.compile(
    r"^(?:heading|ba[sş]l[iı]q|basliq|zagolovok)\s*[-_]?\s*([1-6])$",
    re.IGNORECASE,
)

#: Cədvəlin altındakı izah sətri: "Cədvəl 8.7. Layihənin pul axınları."
_CAPTION_RE = re.compile(r"^C[əe]dv[əe]l\s", re.IGNORECASE)

#: Cədvəl başlığında il sütunları: ən azı 3 xanası 4 rəqəmli il olan sətir.
_YEAR_RE = re.compile(r"^(19|20)\d{2}$")

TITLE_SECTION = "Titul səhifəsi"
MIN_TEXT_LENGTH = 500


class IngestError(Exception):
    """Fayl oxunarkən istifadəçiyə göstəriləcək aydın xəta."""


# ── Köməkçilər ─────────────────────────────────────────────────────────────

def heading_level(paragraph: Paragraph) -> int | None:
    """Paraqrafın başlıq səviyyəsi (1..6) və ya None.

    p.style.name istifadə edilmir: p.style bəzən None qaytarır (naməlum stil və
    standart stil olmayanda). Stil identifikatoru xam XML-dən (pPr/pStyle/@w:val)
    oxunur; tanınmayan stil adi paraqrafdır. Əlavə sənədlər də bunu işlədir.
    """
    pPr = paragraph._p.pPr
    if pPr is None or pPr.pStyle is None:
        return None
    val = pPr.pStyle.val or ""
    m = _HEADING_STYLE_RE.match(val.strip())
    return int(m.group(1)) if m else None


def _iter_body(document: DocxDocument) -> Iterator[tuple[str, Any]]:
    """Sənədin gövdəsini ARDICILLIQLA gəzir: ("p", Paragraph) / ("t", Table)."""
    for child in document.element.body.iterchildren():
        if child.tag == qn("w:p"):
            yield "p", Paragraph(child, document)
        elif child.tag == qn("w:tbl"):
            yield "t", Table(child, document)


def _unique_cells(table: Table) -> Iterator[tuple[int, int, Any]]:
    """Cədvəlin xanalarını BİR DƏFƏ gəzir.

    python-docx birləşdirilmiş (merged) xananı hər sətir/sütunda təkrar qaytarır.
    Təkrarları ayırd etmək üçün xananın XML elementi yadda saxlanılır. Diqqət:
    yalnız id() saxlamaq kifayət etmir — lxml proxy obyektləri məhv olanda id
    təkrar istifadə oluna bilər, ona görə elementin ÖZÜ dəstdə saxlanılır.
    """
    seen: set[Any] = set()
    for r, row in enumerate(table.rows):
        for c, cell in enumerate(row.cells):
            tc = cell._tc
            if tc in seen:
                continue
            seen.add(tc)
            yield r, c, cell


def _table_grid(table: Table) -> list[list[str]]:
    """Cədvəli tam şəbəkə (grid) kimi qaytarır; birləşdirilmiş xanalar təkrarlanır."""
    grid: list[list[str]] = []
    for row in table.rows:
        grid.append([cell.text.strip() for cell in row.cells])
    return grid


def _collapse(values: list[str]) -> list[str]:
    """Ardıcıl təkrarları sıxır (birləşdirilmiş xanaların görüntüsünü düzəldir)."""
    out: list[str] = []
    for v in values:
        if out and out[-1] == v:
            continue
        out.append(v)
    return out


# ── Əsas funksiya ──────────────────────────────────────────────────────────

def parse_docx(path: str | Path) -> dict[str, Any]:
    """docx faylını oxuyur və JSON-a çevrilə bilən dict qaytarır.

    Açarlar: sections, tables, placeholders, stats.
    """
    path = Path(path)
    if not path.exists():
        raise IngestError(f"Fayl tapılmadı: {path.name}")
    if not zipfile.is_zipfile(path):
        raise IngestError(
            "Fayl docx formatında deyil və ya zədələnib. "
            "Zəhmət olmasa Word-də yaradılmış .docx faylı yükləyin."
        )
    try:
        document = docx.Document(str(path))
    except Exception as exc:  # python-docx-in daxili xətaları
        raise IngestError(
            f"Fayl açıla bilmədi: {exc}. Faylın zədələnmədiyini yoxlayın."
        ) from exc

    sections: list[dict[str, Any]] = []
    tables: list[dict[str, Any]] = []
    placeholders: list[dict[str, Any]] = []

    # Birinci başlığa qədərki hissə titul səhifəsidir.
    current: dict[str, Any] = {
        "id": "S1",
        "level": 0,
        "title": TITLE_SECTION,
        "paragraphs": [],
        "table_ids": [],
    }
    sections.append(current)

    body = list(_iter_body(document))
    heading_count = 0

    for index, (kind, obj) in enumerate(body):
        if kind == "p":
            text = obj.text.strip()
            level = heading_level(obj)
            if level is not None and text:
                heading_count += 1
                current = {
                    "id": f"S{len(sections) + 1}",
                    "level": level,
                    "title": text,
                    "paragraphs": [],
                    "table_ids": [],
                }
                sections.append(current)
                continue
            if text:
                current["paragraphs"].append(text)
                for match in PLACEHOLDER_RE.finditer(text):
                    placeholders.append(
                        _placeholder(match, text, current, where="paraqraf")
                    )
            continue

        # ── Cədvəl ────────────────────────────────────────────────────────
        table_id = f"T{len(tables) + 1}"
        caption = _find_caption(body, index)
        grid = _table_grid(obj)
        record = {
            "id": table_id,
            "section_id": current["id"],
            "section_title": current["title"],
            "caption": caption,
            "n_rows": len(grid),
            "n_cols": max((len(r) for r in grid), default=0),
            "rows": grid,
            "row_labels": _collapse([r[0] for r in grid if r]),
        }
        tables.append(record)
        current["table_ids"].append(table_id)

        # Boş yerlər: hər xana YALNIZ bir dəfə yoxlanılır.
        for r, _c, cell in _unique_cells(obj):
            cell_text = cell.text.strip()
            if not cell_text:
                continue
            for match in PLACEHOLDER_RE.finditer(cell_text):
                placeholders.append(
                    _placeholder(
                        match, cell_text, current,
                        where="cədvəl", table_id=table_id, row=r,
                    )
                )

    # ── Yoxlamalar ────────────────────────────────────────────────────────
    for section in sections:
        section["text"] = _section_text(section, tables)
    if not sections[0]["paragraphs"] and not sections[0]["table_ids"]:
        sections.pop(0)  # titul səhifəsi boşdursa göstərməyə dəyməz

    total_chars = sum(len(s["text"]) for s in sections)
    if heading_count == 0:
        raise IngestError(
            "Sənəddə başlıq (Heading 1/2) tapılmadı. Biznes plan bölmələrə "
            "ayrılmış olmalıdır — Word-də başlıq stillərindən istifadə edin."
        )
    if total_chars < MIN_TEXT_LENGTH:
        raise IngestError(
            f"Sənəddə mətn demək olar ki, yoxdur ({total_chars} simvol). "
            "Düzgün biznes plan faylı yüklədiyinizi yoxlayın."
        )

    return {
        "file_name": path.name,
        "sections": sections,
        "tables": tables,
        "placeholders": placeholders,
        "stats": {
            "sections": len(sections),
            "tables": len(tables),
            "placeholders": len(placeholders),
            "chars": total_chars,
        },
    }


def _placeholder(match: re.Match[str], source: str, section: dict[str, Any],
                 where: str, table_id: str | None = None,
                 row: int | None = None) -> dict[str, Any]:
    """Tapılmış boş yeri bölmə və ətraf mətni ilə birlikdə qeyd edir."""
    start = max(0, match.start() - 90)
    end = min(len(source), match.end() + 90)
    context = source[start:end].strip()
    if start > 0:
        context = "…" + context
    if end < len(source):
        context = context + "…"
    return {
        "text": match.group(0),
        "section_id": section["id"],
        "section_title": section["title"],
        "where": where,
        "table_id": table_id,
        "row": row,
        "context": context,
    }


def _find_caption(body: list[tuple[str, Any]], table_index: int) -> str:
    """Cədvəldən DƏRHAL SONRA gələn "Cədvəl N.N ..." paraqrafı.

    Diqqət: caption-dakı nömrə ("8.7") cədvəlin daxili id-si ("T27") ilə üst-üstə
    düşmür — id ardıcıl sayğacdır.
    """
    for kind, obj in body[table_index + 1: table_index + 3]:
        if kind != "p":
            break
        text = obj.text.strip()
        if not text:
            continue
        return text if _CAPTION_RE.match(text) else ""
    return ""


def _section_text(section: dict[str, Any], tables: list[dict[str, Any]]) -> str:
    """Bölmənin mətni; içindəki cədvəllər qısa istinad kimi göstərilir."""
    parts = list(section["paragraphs"])
    for table_id in section["table_ids"]:
        table = next((t for t in tables if t["id"] == table_id), None)
        if table is None:
            continue
        caption = table["caption"] or "başlıqsız cədvəl"
        parts.append(f"[Cədvəl {table_id}: {caption}]")
    return "\n".join(parts)


# ── Oxunmuş sənədlə iş (doc = parse_docx nəticəsi) ─────────────────────────

def full_text(doc: dict[str, Any]) -> str:
    """Sənədin bütün mətni: bölmələr + cədvəl xanaları.

    Mənbə yoxlaması bu mətn üzərində aparılır, ona görə cədvəl rəqəmləri də daxildir.
    """
    parts = [s["title"] for s in doc["sections"]]
    parts += [s["text"] for s in doc["sections"]]
    for table in doc["tables"]:
        if table["caption"]:
            parts.append(table["caption"])
        for row in table["rows"]:
            parts.append(" | ".join(row))
    return "\n".join(parts)


def find_section(doc: dict[str, Any], key: str) -> dict[str, Any] | None:
    """Bölməni id, tam başlıq, başlığın əvvəli və ya daxil olmasına görə tapır."""
    if not key:
        return None
    needle = key.strip().casefold()
    for section in doc["sections"]:
        if section["id"].casefold() == needle:
            return section
    for section in doc["sections"]:
        if section["title"].casefold() == needle:
            return section
    for section in doc["sections"]:
        if section["title"].casefold().startswith(needle):
            return section
    for section in doc["sections"]:
        if needle in section["title"].casefold():
            return section
    return None


def find_table(doc: dict[str, Any], table_id: str) -> dict[str, Any] | None:
    """Cədvəli id-sinə görə tapır ("T27")."""
    if not table_id:
        return None
    needle = table_id.strip().casefold()
    for table in doc["tables"]:
        if table["id"].casefold() == needle:
            return table
    return None


def render_table(table: dict[str, Any], max_rows: int = 40) -> str:
    """Cədvəli mətn şəklində yazır; birləşdirilmiş xanaların təkrarı sıxılır."""
    lines: list[str] = []
    if table.get("caption"):
        lines.append(table["caption"])
    for row in table["rows"][:max_rows]:
        lines.append(" | ".join(_collapse(row)))
    if len(table["rows"]) > max_rows:
        lines.append(f"… daha {len(table['rows']) - max_rows} sətir")
    return "\n".join(lines)


def year_header(table: dict[str, Any]) -> tuple[int, list[int | None]] | None:
    """İllər sətrini tapır: ilk sətirlərdə ən azı 3 xanası 4 rəqəmli il olan sətir.

    Qaytarır: (sətir nömrəsi, hər sütun üçün il və ya None siyahısı).
    """
    for r, row in enumerate(table["rows"][:5]):
        years = [int(c) if _YEAR_RE.match(c.strip()) else None for c in row]
        if sum(1 for y in years if y is not None) >= 3:
            return r, years
    return None
