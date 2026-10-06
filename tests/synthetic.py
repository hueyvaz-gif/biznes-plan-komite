"""Testlər üçün sintetik .docx sənədləri — istifadəçi sənədlərinə toxunulmur.

    build_docx(tmp_path / "x.docx", [
        ("h", "1. Giriş"),
        ("p", "Mətn ..."),
        ("t", [["Göstərici", "2027", "2028", "2029"], ["EBITDA", "1", "2", "3"]]),
    ])

`parse_docx` başlıq və ən azı 500 simvol tələb edir — doldurucu paraqraf
avtomatik əlavə olunur.
"""
from __future__ import annotations

from pathlib import Path
from typing import Any, Sequence

import docx

FILLER = ("Bu sintetik sənəd yalnız avtomatik testlər üçün yaradılıb və heç bir "
          "real layihəyə aid deyil. ") * 6


def build_docx(path: Path, blocks: Sequence[tuple[Any, ...]]) -> Path:
    document = docx.Document()
    document.add_heading("Sintetik plan", level=1)
    document.add_paragraph(FILLER)
    for block in blocks:
        kind = block[0]
        if kind == "h":
            document.add_heading(block[1], level=block[2] if len(block) > 2 else 1)
        elif kind == "p":
            document.add_paragraph(block[1])
        elif kind == "t":
            rows = block[1]
            table = document.add_table(rows=len(rows), cols=max(len(r) for r in rows))
            for i, row in enumerate(rows):
                for j, value in enumerate(row):
                    table.cell(i, j).text = value
        else:
            raise ValueError(f"Naməlum blok: {kind}")
    document.save(str(path))
    return path


def build_doc(tmp_path: Path, blocks: Sequence[tuple[Any, ...]],
              name: str = "sintetik.docx") -> dict[str, Any]:
    """Sənədi yaradıb `parse_docx` ilə oxuyur."""
    from app.ingest import parse_docx

    return parse_docx(build_docx(tmp_path / name, blocks))
