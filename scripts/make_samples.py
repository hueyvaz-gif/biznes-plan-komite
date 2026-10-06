"""Orijinal biznes plandan anonim demo və test faylları yaradır.

İstifadə:
    python scripts/make_samples.py input/CFG_Biznes_Plan_ilkin.docx

Nəticə (samples/ qovluğunda):
    plan_demo_v1.docx      — anonimləşdirilmiş plan
    plan_demo_v2.docx      — v1 + bəzi boş yerlər doldurulub, PP 7,0 il
    plan_demo_saxta.docx   — v1 + NPV rəqəmi dəyişdirilib (uyğunsuzluq)
    plan_demo_qiriq.docx   — v1 + pul axını cədvəli silinib
    yanlis_fayl.docx       — docx olmayan bayt-lar (yanlış fayl testi)

DİQQƏT: şəkillərin İÇİNDƏKİ mətn dəyişdirilmir — docx-də şəkillər rastr
qrafikasıdır. Demo zamanı diaqram və sxemlərdə orijinal adlar görünə bilər.
"""
from __future__ import annotations

import re
import shutil
import sys
from pathlib import Path
from typing import Any, Iterable

import docx
from docx.oxml.ns import qn
from docx.table import Table
from docx.text.paragraph import Paragraph

BASE_DIR = Path(__file__).resolve().parent.parent
SAMPLES_DIR = BASE_DIR / "samples"

#: Anonimləşdirmə xəritəsi. Uzun açarlar əvvəl tətbiq olunur ki, qısa açar
#: (məsələn "CFG") uzun adın içini kəsməsin.
NAME_MAP: dict[str, str] = {
    "CASPIAN FERTILIZER GROUP": "DEMO FERTILIZER GROUP",
    "Caspian Fertilizer Group": "Demo Fertilizer Group",
    "Misael Machado": "Mateo Rivera",
    "Anusaya AgriNutrition": "Alfa AgriTrade",
    "Campofert Colombia S.A.S.": "Beta Agro S.A.S.",
    "Campofert Colombia": "Beta Agro",
    "Sinofert China Co., Ltd.": "Gamma Fert Co., Ltd.",
    "Sinofert China": "Gamma Fert",
    "GoudenKorrel": "Delta Trading",
    "Yaver": "Direktor",
    "Azair": "Benchmark-A",
    "CCM": "XYZ",
    "CFG": "DFG",
}

#: v2-də doldurulan boş yerlər və düzəldilən rəqəm.
V2_EDITS: dict[str, str] = {
    "[VÖEN]": "1700123451",
    "[hüquqi ünvan]": "Bakı şəhəri, Nizami rayonu, Demo küçəsi 12, mənzil 4",
    "[tarix]": "15.10.2026",
    "6,9 il": "7,0 il",
}

#: Saxta plan: NPV rəqəmi dəyişdirilir, hesablama isə dəyişmir.
FAKE_EDITS: dict[str, str] = {"1 225 241": "2 225 241"}

#: Qırıq plan: caption-u bu mətnlə başlayan cədvəl silinir.
BROKEN_TABLE_CAPTION = "Cədvəl 8.7"

NBSP = " "


# ── Mətn əvəzləmə ──────────────────────────────────────────────────────────

def _pairs_with_nbsp(mapping: dict[str, str]) -> list[tuple[str, str]]:
    """Hər cütü həm adi boşluqla, həm də NBSP variantı ilə hazırlayır.

    Word rəqəmlərdə və bəzən adlarda adi boşluq yerinə NBSP işlədir, ona görə
    hər iki variant sınanmalıdır. Uzun açarlar əvvəl gəlir.
    """
    pairs: list[tuple[str, str]] = []
    for old in sorted(mapping, key=len, reverse=True):
        new = mapping[old]
        pairs.append((old, new))
        if " " in old:
            # Mənbədə NBSP varsa, nəticədə də NBSP qalsın — formatı dəyişməsin.
            pairs.append((old.replace(" ", NBSP), new.replace(" ", NBSP)))
    return pairs


def _replace_in_paragraph(paragraph: Paragraph, old: str, new: str) -> int:
    """Paraqrafda `old` -> `new`. Mümkün olduqca run formatını qoruyur.

    Əvvəlcə run səviyyəsində əvəz olunur. Ad bir neçə run-a bölünübsə, yalnız
    həmin run-lar birləşdirilir: əvəzləmə birinci run-a yazılır, qalanları
    boşaldılır. Paraqrafın digər run-larının formatı toxunulmaz qalır.
    """
    count = 0
    # 1) Run səviyyəsi — format tam qorunur.
    for run in paragraph.runs:
        if old in run.text:
            count += run.text.count(old)
            run.text = run.text.replace(old, new)

    # 2) Ad bir neçə run-a bölünübsə: yalnız həmin run-lar birləşdirilir.
    guard = 0
    while old in paragraph.text and guard < 200:
        guard += 1
        runs = paragraph.runs
        index = "".join(r.text for r in runs).find(old)
        if index < 0:
            break
        end = index + len(old)
        starts: list[int] = []
        offset = 0
        for run in runs:
            starts.append(offset)
            offset += len(run.text)
        touched = [
            i for i, run in enumerate(runs)
            if starts[i] < end and starts[i] + len(run.text) > index
        ]
        if not touched:
            break
        first, last = touched[0], touched[-1]
        head = runs[first].text[: index - starts[first]]
        tail = runs[last].text[end - starts[last]:]
        runs[first].text = head + new + (tail if last == first else "")
        for i in touched[1:-1]:
            runs[i].text = ""
        if last != first:
            runs[last].text = tail
        count += 1
    return count


def _iter_paragraphs(container: Any) -> Iterable[Paragraph]:
    """Konteynerin (sənəd, xana, kolontitul) bütün paraqrafları — iç-içə cədvəllərlə."""
    for paragraph in container.paragraphs:
        yield paragraph
    for table in getattr(container, "tables", []):
        for row in table.rows:
            for cell in row.cells:
                yield from _iter_paragraphs(cell)


def _all_paragraphs(document: Any) -> Iterable[Paragraph]:
    """Sənədin gövdəsi + bütün kolontitullar."""
    yield from _iter_paragraphs(document)
    for section in document.sections:
        for part in (section.header, section.footer,
                     section.first_page_header, section.first_page_footer,
                     section.even_page_header, section.even_page_footer):
            if part is not None:
                yield from _iter_paragraphs(part)


def replace_everywhere(document: Any, mapping: dict[str, str]) -> int:
    """Sənədin hər yerində əvəzləmə aparır; dəyişikliklərin sayını qaytarır."""
    pairs = _pairs_with_nbsp(mapping)
    total = 0
    for paragraph in _all_paragraphs(document):
        for old, new in pairs:
            if old in paragraph.text:
                total += _replace_in_paragraph(paragraph, old, new)
    return total


def document_text(document: Any) -> str:
    """Yoxlama üçün sənədin bütün mətni."""
    return "\n".join(p.text for p in _all_paragraphs(document))


def assert_clean(document: Any, mapping: dict[str, str]) -> None:
    """Anonimləşdirmədən sonra köhnə adlardan heç biri qalmamalıdır."""
    text = document_text(document)
    left = [old for old in mapping if old in text or old.replace(" ", NBSP) in text]
    if left:
        raise RuntimeError(
            "Anonimləşdirmə tam alınmadı, sənəddə qalan adlar: " + ", ".join(left)
        )


def set_author(document: Any, author: str = "Demo") -> None:
    """Sənədin metadata-sındakı müəllif adını dəyişir."""
    props = document.core_properties
    props.author = author
    props.last_modified_by = author
    props.company = author


# ── Fayl variantları ───────────────────────────────────────────────────────

def drop_table_by_caption(document: Any, caption_prefix: str) -> bool:
    """Caption-u `caption_prefix` ilə başlayan cədvəli sənəddən silir."""
    body = document.element.body
    children = list(body.iterchildren())
    for i, child in enumerate(children):
        if child.tag != qn("w:tbl"):
            continue
        for following in children[i + 1: i + 3]:
            if following.tag != qn("w:p"):
                break
            text = Paragraph(following, document).text.strip()
            if not text:
                continue
            if text.startswith(caption_prefix):
                body.remove(child)
                return True
            break
    return False


def apply_edits(path: Path, edits: dict[str, str], out: Path) -> int:
    """Hazır fayla kiçik düzəlişlər tətbiq edib yeni fayl kimi yazır."""
    document = docx.Document(str(path))
    changed = replace_everywhere(document, edits)
    document.save(str(out))
    return changed


def write_invalid_file(out: Path) -> None:
    """docx olmayan, lakin .docx adlanan fayl — yanlış fayl ssenarisi üçün."""
    out.write_bytes(
        b"%PDF-1.7\n% Bu fayl docx deyil: yanl\xc4\xb1\xc5\x9f fayl testi \xc3\xbc\xc3\xa7\xc3\xbcnd\xc3\xbcr.\n"
        b"1 0 obj << /Type /Catalog >> endobj\ntrailer\n%%EOF\n"
    )


# ── Əsas axın ──────────────────────────────────────────────────────────────

def main(source: str) -> int:
    src = Path(source)
    if not src.exists():
        print(f"XƏTA: mənbə fayl tapılmadı: {src}", file=sys.stderr)
        return 1

    SAMPLES_DIR.mkdir(parents=True, exist_ok=True)

    # 1) Anonim v1
    document = docx.Document(str(src))
    replaced = replace_everywhere(document, NAME_MAP)
    set_author(document)
    assert_clean(document, NAME_MAP)
    v1 = SAMPLES_DIR / "plan_demo_v1.docx"
    document.save(str(v1))
    print(f"plan_demo_v1.docx      — {replaced} ad əvəzləndi")

    # 2) v2: bəzi boş yerlər doldurulub, geri ödəmə müddəti düzəldilib
    v2 = SAMPLES_DIR / "plan_demo_v2.docx"
    changed = apply_edits(v1, V2_EDITS, v2)
    print(f"plan_demo_v2.docx      — {changed} düzəliş (boş yerlər + PP)")

    # 3) Saxta: NPV rəqəmi dəyişib, hesablama isə dəyişməyib
    fake = SAMPLES_DIR / "plan_demo_saxta.docx"
    changed = apply_edits(v1, FAKE_EDITS, fake)
    print(f"plan_demo_saxta.docx   — {changed} rəqəm dəyişdirildi (NPV)")

    # 4) Qırıq: pul axını cədvəli silinib
    broken = SAMPLES_DIR / "plan_demo_qiriq.docx"
    document = docx.Document(str(v1))
    if not drop_table_by_caption(document, BROKEN_TABLE_CAPTION):
        print(f"XƏTA: '{BROKEN_TABLE_CAPTION}' cədvəli tapılmadı", file=sys.stderr)
        return 1
    document.save(str(broken))
    print(f"plan_demo_qiriq.docx   — '{BROKEN_TABLE_CAPTION}' cədvəli silindi")

    # 5) Yanlış fayl
    wrong = SAMPLES_DIR / "yanlis_fayl.docx"
    write_invalid_file(wrong)
    print("yanlis_fayl.docx       — docx olmayan bayt-lar yazıldı")

    print(f"\nHamısı hazırdır: {SAMPLES_DIR}")
    return 0


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print(__doc__)
        sys.exit(2)
    sys.exit(main(sys.argv[1]))
