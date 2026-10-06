"""Agentlərin sənədlə işləmək üçün alətləri.

`make_doc_tools(doc)` closure ilə MƏHZ bu sənədə bağlı alətlər qaytarır — agent
fayl yolu və ya id ötürmür, yalnız bölmə/cədvəl adı ilə işləyir.

Alətlər HEÇ VAXT exception atmır: səhv girişdə agentə nə etməli olduğunu deyən
mətn qaytarırlar ("XƏTA: ... Mövcud bölmələr: ...").

Uzun bölmə və böyük cədvəl hissə-hissə oxunur (`part=1, 2, …`) — heç nə
səssizcə kəsilmir; cavabın sonunda davamın olub-olmadığı yazılır.
"""
from __future__ import annotations

from typing import Any

from langchain.tools import tool

from app.ingest import find_section, find_table, render_table

#: Bölmənin bir hissəsinin maksimal həcmi.
MAX_SECTION_CHARS = 12_000
#: Cədvəlin bir hissəsindəki maksimal sətir sayı (başlıq sətri hər hissədə təkrarlanır).
MAX_TABLE_ROWS = 60


def _section_list(doc: dict[str, Any]) -> str:
    lines = []
    for section in doc["sections"]:
        indent = "  " * max(0, section["level"] - 1)
        tables = f"  [cədvəllər: {', '.join(section['table_ids'])}]" if section["table_ids"] else ""
        lines.append(f"{section['id']} | {indent}{section['title']}"
                     f" ({len(section['text'])} simvol){tables}")
    return "\n".join(lines)


def _paginate(chunks: list[str], part: int, what: str) -> str:
    """Hissəni qaytarır; davamı varsa agentə növbəti `part`-ı deyir."""
    total = len(chunks)
    if part < 1 or part > total:
        return f"XƏTA: {what} {total} hissədən ibarətdir; part 1–{total} arasında olmalıdır."
    text = chunks[part - 1]
    if total > 1:
        tail = f"növbəti hissə üçün part={part + 1}" if part < total else "son hissə"
        text += f"\n… (hissə {part}/{total}; {tail})"
    return text


def section_chunks(text: str, size: int = MAX_SECTION_CHARS) -> list[str]:
    """Mətni sətir sərhədlərində hissələrə bölür (həddən uzun sətir isə kəsilir)."""
    chunks: list[str] = []
    current = ""
    for line in text.split("\n"):
        while len(line) > size:
            if current:
                chunks.append(current)
                current = ""
            chunks.append(line[:size])
            line = line[size:]
        candidate = f"{current}\n{line}" if current else line
        if len(candidate) > size:
            chunks.append(current)
            current = line
        else:
            current = candidate
    if current or not chunks:
        chunks.append(current)
    return chunks


def table_chunks(table: dict[str, Any], size: int = MAX_TABLE_ROWS) -> list[str]:
    """Cədvəli sətir qruplarına bölür; ilk sətir (başlıq) hər hissədə təkrarlanır."""
    rows = table["rows"]
    if len(rows) <= size:
        return [render_table(table, max_rows=len(rows))]
    header, body = rows[:1], rows[1:]
    chunks = []
    for start in range(0, len(body), size - 1):
        part = {**table, "rows": header + body[start:start + size - 1]}
        chunks.append(render_table(part, max_rows=size))
    return chunks


def make_doc_tools(doc: dict[str, Any]) -> list[Any]:
    """Bu sənədə bağlı 5 alət qaytarır (o cümlədən semantik axtarış)."""

    @tool
    def list_sections() -> str:
        """Sənədin bütün bölmələrini sadalayır: id, başlıq, həcm və cədvəl id-ləri.

        Oxumağa başlamazdan əvvəl HƏMİŞƏ bunu çağır.
        """
        return _section_list(doc)

    @tool
    def get_section(section: str, part: int = 1) -> str:
        """Bir bölmənin mətnini qaytarır. Uzun bölmə hissələrə bölünür.

        Bölmədəki cədvəllər yalnız "[Cədvəl T5: ...]" kimi göstərilir —
        məzmunu üçün `get_table` çağır.

        Args:
            section: bölmənin id-si ("S14") və ya başlığı ("8.1. Əsas fərziyyələr").
            part: hissənin nömrəsi (1-dən başlayır); cavab davamın olub-olmadığını deyir.
        """
        found = find_section(doc, section)
        if found is None:
            return (f"XƏTA: '{section}' adlı bölmə tapılmadı. "
                    f"Mövcud bölmələr:\n{_section_list(doc)}")
        body = _paginate(section_chunks(found["text"]), part, f"'{found['id']}' bölməsi")
        return f"{found['id']} | {found['title']}\n\n{body}"

    @tool
    def list_tables() -> str:
        """Sənədin bütün cədvəllərini sadalayır: id, bölmə, başlıq və sətir adları."""
        lines = []
        for table in doc["tables"]:
            labels = ", ".join(table["row_labels"][:12])
            if len(table["row_labels"]) > 12:
                labels += ", …"
            lines.append(
                f"{table['id']} | {table['section_title']} | "
                f"{table['caption'] or 'başlıqsız'} | sətirlər: {labels}"
            )
        return "\n".join(lines)

    @tool
    def get_table(table_id: str, part: int = 1) -> str:
        """Bir cədvəlin məzmununu qaytarır. Böyük cədvəl hissələrə bölünür.

        Args:
            table_id: cədvəlin id-si, məsələn "T27".
            part: hissənin nömrəsi (1-dən başlayır); başlıq sətri hər hissədə var.
        """
        found = find_table(doc, table_id)
        if found is None:
            available = ", ".join(t["id"] for t in doc["tables"])
            return (f"XƏTA: '{table_id}' cədvəli tapılmadı. "
                    f"Mövcud id-lər: {available}")
        body = _paginate(table_chunks(found), part, f"'{found['id']}' cədvəli")
        return f"{found['id']} | bölmə: {found['section_title']}\n{body}"

    @tool
    def search_document(query: str) -> str:
        """Sənəddə MƏNAYA görə axtarış (semantik yaddaş): sorğuya ən uyğun bölmə və cədvəl
        parçalarını istinadı (S.., T..) və oxşarlıq balı ilə qaytarır. Hansı bölmədə olduğunu
        bilmədiyin məlumatı tapmaq üçün istifadə et; sonra get_section/get_table ilə yoxla.
        """
        from app import memory
        return memory.format_hits(memory.search_document(doc, query, limit=4))

    return [list_sections, get_section, list_tables, get_table, search_document]
