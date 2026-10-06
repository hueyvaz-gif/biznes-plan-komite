"""Uyğunluq agenti və tələblər siyahısı."""
from __future__ import annotations

import pytest

from app import config
from app.agents.compliance import (
    ConfigError,
    build_compliance_graph,
    load_requirements,
    requirement_index,
)
from app.ingest import parse_docx
from tests.fake_llm import FakeChatModel
from tests.synthetic import build_doc

#: Ayrıca sənəd kimi təqdim olunan bəndlər — LLM-ə göndərilmir.
DOCUMENT_ITEMS = {"LT3", "LT5", "MP4"}


@pytest.fixture(scope="module")
def doc(samples):
    return parse_docx(samples / "plan_demo_v1.docx")


def _by_id(items):
    return {i["req_id"]: i for i in items}


# ── requirements.json ──────────────────────────────────────────────────────

def test_tələblər_siyahısı_yüklənir():
    groups = load_requirements()
    assert [g["id"] for g in groups] == [
        "xulase", "tesebbuskar", "tesvir", "yer_infrastruktur", "bazar",
        "teskilati", "investisiya", "maliyye", "swot", "effekt", "huquqi",
    ]
    index = requirement_index()
    assert len(index) == 47
    assert index["IP3"]["group_id"] == "investisiya"
    assert {k for k, v in index.items() if v["kind"] == "sened"} == DOCUMENT_ITEMS


def test_id_lər_təkrarlanmır():
    ids = [i["id"] for g in load_requirements() for i in g["items"]]
    assert len(ids) == len(set(ids))


# ── Subgraph ───────────────────────────────────────────────────────────────

def test_bütün_tələblər_nəticə_alır(doc, fake_llm):
    state = build_compliance_graph().invoke({"doc": doc})
    items = _by_id(state["items"])
    assert set(items) == set(requirement_index())
    for item in state["items"]:
        assert item["status"] in ("var", "natamam", "yoxdur", "sened", "skip")
        assert item["group_title"] and item["text"]


def test_ayrıca_sənəd_bəndləri_llm_ə_getmir(doc, fake_llm):
    state = build_compliance_graph().invoke({"doc": doc})
    items = _by_id(state["items"])
    for req_id in DOCUMENT_ITEMS:
        assert items[req_id]["status"] == "sened"
        assert "Ayrıca sənəd" in items[req_id]["missing"]
        assert items[req_id]["sections"] == []
    # Saxta model yalnız "plan" bəndlərini görür
    assert items["TP3"]["status"] == "natamam"


def test_hər_qrup_üçün_bir_çağırış(doc, fake_llm):
    build_compliance_graph().invoke({"doc": doc})
    # Hər qrup: əvvəl list_sections, sonra GroupResult = 2 cavab.
    assert fake_llm.call_log.count("compliance") == 3 * len(load_requirements())


def test_mövcud_olmayan_bölmə_istinadı_çıxarılır(doc):
    """Agent uydurma bölmə göstərsə, status 'var'dan 'natamam'a düşür."""
    class Uydurmaçı(FakeChatModel):
        def _group_items(self, messages):
            items = super()._group_items(messages)
            for item in items:
                item["sections"] = ["Belə bölmə sənəddə yoxdur 12345"]
            return items

    config.set_llm_override(Uydurmaçı())
    state = build_compliance_graph().invoke({"doc": doc})
    plan_items = [i for i in state["items"] if i["status"] != "sened"]
    assert plan_items, "plan bəndi olmalıdır"
    for item in plan_items:
        assert item["sections"] == []
        assert item["status"] != "var"
    assert any("mövcud bölmə və ya cədvələ istinad" in (i["missing"] or "") for i in plan_items)


def test_nəticə_qaytarılmayan_tələb_skip_olur(doc):
    class Yarımçıq(FakeChatModel):
        def _group_items(self, messages):
            return super()._group_items(messages)[:1]   # yalnız birinci bənd

    config.set_llm_override(Yarımçıq())
    state = build_compliance_graph().invoke({"doc": doc})
    skipped = [i for i in state["items"] if i["status"] == "skip"]
    assert skipped
    assert all("nəticə qaytarmadı" in i["missing"] for i in skipped)


def test_qrup_xətası_nəticəni_itirmir(doc):
    """Bir qrup xəta versə, qalan qruplar işləməyə davam edir."""
    class Nasaz(FakeChatModel):
        def _generate(self, messages, stop=None, run_manager=None, **kwargs):
            # Yalnız tapşırıq mətninə baxılır: `list_sections` nəticəsində bütün
            # bölmə başlıqları olur və "SWOT" orada hər qrupda görünərdi.
            task = next((m.content for m in messages if m.type == "human"), "")
            if "SWOT" in task:
                raise RuntimeError("Saxta nasazlıq")
            return super()._generate(messages, stop, run_manager, **kwargs)

    config.set_llm_override(Nasaz())
    state = build_compliance_graph().invoke({"doc": doc})
    items = _by_id(state["items"])
    assert items["SW1"]["status"] == "skip"
    assert items["X1"]["status"] == "var"
    assert state["errors"], "xəta qeyd olunmalıdır"


def test_qrup_süzgəci_seçilməyənləri_skip_edir(doc, fake_llm, monkeypatch):
    """Seçilməyən qrupların bəndləri nəticədən İTMİR — 'yoxlanılmayıb' kimi qalır."""
    monkeypatch.setattr(config, "COMPLIANCE_GROUPS", ["swot", "huquqi"])
    items = _by_id(build_compliance_graph().invoke({"doc": doc})["items"])
    assert set(items) == set(requirement_index())                    # hamısı yerindədir
    assert {k for k, v in items.items() if v["status"] == "var"} == {"SW1", "SW2", "HQ1"}
    assert items["X1"]["status"] == "skip"
    assert "COMPLIANCE_GROUPS" in items["X1"]["missing"]


def test_naməlum_qrup_konfiqurasiya_xətasıdır(doc, monkeypatch):
    monkeypatch.setattr(config, "COMPLIANCE_GROUPS", ["swot", "yazi_sehvi"])
    with pytest.raises(ConfigError, match="yazi_sehvi"):
        build_compliance_graph().invoke({"doc": doc})


# ── Cədvəllər və hərfi sitat (yoxlama hesabatı, problem 3–4) ───────────────

@pytest.fixture()
def table_doc(tmp_path):
    """Cavab YALNIZ cədvəldədir — bölmə mətnində cədvəl qısa istinad kimi görünür."""
    return build_doc(tmp_path, [
        ("h", "2. Təşəbbüskar"),
        ("p", "Təşəbbüskar barədə məlumat aşağıdakı cədvəldə verilib."),
        ("t", [["Göstərici", "Dəyər"],
               ["VÖEN", "1234567891"],
               ["Təsis tarixi", "12.03.2024"]]),
    ])


class CədvəlOxuyan(FakeChatModel):
    """Əvvəl cədvəli oxuyur, sonra cədvəl sətrini sitat gətirir."""

    def _generate(self, messages, stop=None, run_manager=None, **kwargs):
        from langchain_core.messages import ToolMessage
        from tests.fake_llm import _tool_call
        if self._has("GroupResult") and not any(isinstance(m, ToolMessage) for m in messages):
            self.call_log.append("compliance")
            return _tool_call("get_table", {"table_id": "T1"})
        return super()._generate(messages, stop, run_manager, **kwargs)

    def _group_items(self, messages):
        items = super()._group_items(messages)
        for item in items:
            item.update(status="var", sections=["T1"], quote="VÖEN | 1234567891")
        return items


def test_agentə_cədvəl_alətləri_verilir(doc):
    tools = set()
    original = FakeChatModel.bind_tools

    def spy(self, tools_, **kwargs):
        clone = original(self, tools_, **kwargs)
        tools.update(clone.bound_tools)
        return clone

    FakeChatModel.bind_tools = spy
    try:
        build_compliance_graph().invoke({"doc": doc})
    finally:
        FakeChatModel.bind_tools = original
    assert {"get_table", "list_tables", "get_section", "list_sections"} <= tools


def test_cavabı_yalnız_cədvəldə_olan_tələb_var_qalır(table_doc):
    config.set_llm_override(CədvəlOxuyan())
    items = build_compliance_graph().invoke({"doc": table_doc})["items"]
    ts2 = _by_id(items)["TS2"]
    assert ts2["status"] == "var"
    assert ts2["sections"][0]["table_id"] == "T1"
    assert ts2["quote"] == "VÖEN | 1234567891"


def test_uydurma_sitat_var_statusunu_saxlamır(table_doc):
    class Uyduran(CədvəlOxuyan):
        def _group_items(self, messages):
            items = super()._group_items(messages)
            for item in items:
                item["quote"] = "VÖEN | 9999999999"
            return items

    config.set_llm_override(Uyduran())
    ts2 = _by_id(build_compliance_graph().invoke({"doc": table_doc})["items"])["TS2"]
    assert ts2["status"] == "natamam"
    assert ts2["quote"] is None
    assert "sitatı" in ts2["missing"]


def test_sitatsız_var_statusu_saxlanılmır(table_doc):
    class Sitatsız(CədvəlOxuyan):
        def _group_items(self, messages):
            items = super()._group_items(messages)
            for item in items:
                item["quote"] = None
            return items

    config.set_llm_override(Sitatsız())
    ts2 = _by_id(build_compliance_graph().invoke({"doc": table_doc})["items"])["TS2"]
    assert ts2["status"] == "natamam"
    assert "hərfi sitat" in ts2["missing"]


def test_başqa_qrupun_bəndi_nəticəni_əvəz_etmir(doc):
    """'xulase' qrupunun cavabına TS2 (başqa qrup) 'yoxdur' kimi qarışıb."""
    class Qarışdıran(FakeChatModel):
        def _group_items(self, messages):
            items = super()._group_items(messages)
            if any(i["req_id"] == "X1" for i in items):
                items.append({"req_id": "TS2", "status": "yoxdur", "sections": [],
                              "quote": None, "comment": None, "missing": "qarışıq"})
            return items

    config.set_llm_override(Qarışdıran())
    ts2 = _by_id(build_compliance_graph().invoke({"doc": doc})["items"])["TS2"]
    assert ts2["status"] == "var"
    assert ts2["missing"] != "qarışıq"


def test_uzun_bölmə_və_cədvəl_hissə_hissə_oxunur():
    from app.agents.doc_tools import make_doc_tools

    long_text = "\n".join(f"Sətir {i}: " + "x" * 200 for i in range(150))   # ~31 000 simvol
    doc = {
        "sections": [{"id": "S1", "level": 1, "title": "Uzun", "text": long_text,
                      "table_ids": ["T1"]}],
        "tables": [{"id": "T1", "section_id": "S1", "section_title": "Uzun", "caption": "",
                    "rows": [["Ad", "Dəyər"]] + [[f"r{i}", str(i)] for i in range(130)],
                    "row_labels": []}],
    }
    tools = {t.name: t for t in make_doc_tools(doc)}

    first = tools["get_section"].invoke({"section": "S1"})
    assert "hissə 1/3" in first and "part=2" in first
    last = tools["get_section"].invoke({"section": "S1", "part": 3})
    assert "Sətir 149" in last and "son hissə" in last
    joined = "".join(tools["get_section"].invoke({"section": "S1", "part": p}) for p in (1, 2, 3))
    assert all(f"Sətir {i}:" in joined for i in range(150))      # heç nə itmir

    table_last = tools["get_table"].invoke({"table_id": "T1", "part": 3})
    assert "r129 | 129" in table_last
    assert table_last.splitlines()[1] == "Ad | Dəyər"             # başlıq təkrarlanır
    assert "XƏTA" in tools["get_table"].invoke({"table_id": "T1", "part": 9})


def test_yoxdur_bəndində_plandan_sitat_göstərilmir(doc):
    config.set_llm_override(FakeChatModel(missing_ids=("X1",)))
    x1 = _by_id(build_compliance_graph().invoke({"doc": doc})["items"])["X1"]
    assert x1["status"] == "yoxdur"
    assert x1["quote"] is None


def test_real_model_sitatları_qəbul_edilir(doc):
    """Real modelin cavablarından: üç nöqtəli cümlə və iki cədvəl sətri (boş xana ayırıcıları ilə)."""
    from app.agents.compliance import quote_in, resolve_refs
    lt4 = ("Xəttin nominal məhsuldarlığı 10 ton/saatdır. ... nominal illik güc 72 000 ton, "
           "praktiki illik güc isə 57 600 tondur.")
    assert quote_in(doc, resolve_refs(doc, ["S10"]), lt4)
    ip3 = "Əsas vəsaitlər — cəmi | 11 281 000 |  \n Dövriyyə kapitalı və likvidlik ehtiyatı | 2 200 000 | "
    assert quote_in(doc, resolve_refs(doc, ["T16", "S28"]), ip3)
    # uydurma hissə yenə rədd edilir
    assert not quote_in(doc, resolve_refs(doc, ["S10"]), "Xəttin nominal məhsuldarlığı 12 ton/saatdır. ...")


def test_çoxsətirli_sitatda_sətirlərin_sırası_yoxlanılır(doc):
    from app.agents.compliance import quote_in, resolve_refs
    refs = resolve_refs(doc, ["T16"])
    reversed_order = "Dövriyyə kapitalı və likvidlik ehtiyatı | 2 200 000\nƏsas vəsaitlər — cəmi | 11 281 000"
    assert not quote_in(doc, refs, reversed_order)
