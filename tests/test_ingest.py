"""ingest.py — docx faylının oxunması (LLM olmadan)."""
from __future__ import annotations

import pytest

from app.ingest import (
    IngestError,
    find_section,
    find_table,
    full_text,
    parse_docx,
    render_table,
    year_header,
)


@pytest.fixture(scope="module")
def doc(samples):
    return parse_docx(samples / "plan_demo_v1.docx")


def test_gözlənilən_statistika(doc):
    """Orijinal CFG planı ilə yoxlanılıb: 34 cədvəl, 12 doldurulmamış yer."""
    assert doc["stats"]["tables"] == 34
    assert doc["stats"]["placeholders"] == 12
    assert doc["stats"]["chars"] > 20000


def test_boş_yerlər_bölmə_ilə_birlikdə(doc):
    texts = [p["text"] for p in doc["placeholders"]]
    assert "[VÖEN]" in texts
    assert "[tarix]" in texts
    for placeholder in doc["placeholders"]:
        assert placeholder["section_title"]
        assert placeholder["where"] in ("paraqraf", "cədvəl")
        assert placeholder["text"] in placeholder["context"]


def test_cədvəl_xanasındakı_boş_yerlər_bir_dəfə_sayılır(doc):
    """Birləşdirilmiş xanalar python-docx-də təkrarlanır — təkrar sayılmamalıdır."""
    cell_items = [p for p in doc["placeholders"] if p["where"] == "cədvəl"]
    assert len(cell_items) == 3
    assert len({p["text"] for p in cell_items}) == 3


def test_başlıqlar_xam_xml_dən_oxunur(doc):
    """p.style bu sənəddə bəzən None qaytarır, ona görə pStyle/@w:val oxunur."""
    titles = [s["title"] for s in doc["sections"]]
    assert "1. LAYİHƏNİN QISA XÜLASƏSİ" in titles
    assert "8.7. Kapitalda dəyişikliklər haqqında hesabat" in titles
    assert sum(1 for s in doc["sections"] if s["level"] == 1) == 12


def test_cədvəl_captionu_cədvəldən_sonra_gəlir(doc):
    table = find_table(doc, "T27")
    assert table is not None
    # id ardıcıl nömrədir (T27), caption nömrəsi isə fərqlidir (8.7).
    assert table["caption"].startswith("Cədvəl 8.7.")
    assert "pul axın" in table["caption"]


def test_pul_axını_cədvəlinin_sətirləri(doc):
    labels = find_table(doc, "T27")["row_labels"]
    for needed in ["İnvestisiya qoyuluşu", "EBITDA", "Mənfəət vergisi",
                   "Dövriyyə kapitalının dəyişməsi", "Layihənin qalıq dəyəri",
                   "Sərbəst pul axını (FCFF)"]:
        assert needed in labels
    # Baza (güzəştli) ssenari cədvəldə BİRİNCİ gəlir.
    assert labels.index("Güzəştlərlə") < labels.index("Güzəştlər tətbiq olunmadan")


def test_il_başlığı(doc):
    row_index, years = year_header(find_table(doc, "T27"))
    assert row_index == 0
    assert 2027 in years and 2037 in years


def test_find_section_bir_neçə_üsulla_axtarır(doc):
    assert find_section(doc, "S1") is not None
    assert find_section(doc, "8.7.").get("level") == 2
    assert find_section(doc, "Kapitalda dəyişikliklər") is not None
    assert find_section(doc, "belə bölmə yoxdur") is None


def test_render_table_təkrarları_sıxır(doc):
    rendered = render_table(find_table(doc, "T31"), max_rows=5)  # SWOT cədvəli
    assert "|" in rendered
    for line in rendered.splitlines():
        cells = [c.strip() for c in line.split("|")]
        assert all(a != b for a, b in zip(cells, cells[1:]))


def test_full_text_cədvəl_rəqəmlərini_də_əhatə_edir(doc):
    text = full_text(doc)
    assert "Cədvəl 8.7." in text
    assert "EBITDA" in text
    assert len(text) > len("".join(s["text"] for s in doc["sections"]))


def test_json_a_çevrilə_bilir(doc):
    import json
    assert json.loads(json.dumps(doc))["stats"]["tables"] == 34


def test_yanlış_fayl_aydın_xəta_verir(samples):
    with pytest.raises(IngestError) as exc:
        parse_docx(samples / "yanlis_fayl.docx")
    assert "docx formatında deyil" in str(exc.value)


def test_olmayan_fayl(samples):
    with pytest.raises(IngestError) as exc:
        parse_docx(samples / "belə_fayl_yoxdur.docx")
    assert "tapılmadı" in str(exc.value)


def test_v2_də_boş_yerlər_azalıb(samples):
    v2 = parse_docx(samples / "plan_demo_v2.docx")
    assert v2["stats"]["placeholders"] == 9
    texts = [p["text"] for p in v2["placeholders"]]
    for filled in ["[VÖEN]", "[hüquqi ünvan]", "[tarix]"]:
        assert filled not in texts


def test_qırıq_faylda_pul_axını_cədvəli_yoxdur(samples):
    broken = parse_docx(samples / "plan_demo_qiriq.docx")
    assert broken["stats"]["tables"] == 33
    captions = [t["caption"] for t in broken["tables"]]
    assert not any(c.startswith("Cədvəl 8.7") for c in captions)
