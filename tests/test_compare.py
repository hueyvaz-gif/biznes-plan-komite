"""Versiyaların müqayisəsi (LLM-siz)."""
from __future__ import annotations

from app.compare import compare, section_hashes, snapshot, stabilize


def _snap(placeholders=(), checks=(), items=(), version=1, hashes=None):
    return snapshot(
        {
            "ingest": {"placeholders": list(placeholders), "section_hashes": hashes or {}},
            "finance": {"checks": list(checks)},
            "compliance": {"items": list(items)},
        },
        {"id": f"c{version}", "version": version, "file_name": "x.docx",
         "created_at": "2026-10-04T00:00:00+00:00"},
    )


def _ph(text, section="1. Giriş"):
    return {"text": text, "section_title": section}


def test_boş_yerlər_doldurulan_və_yeni():
    old = _snap([_ph("[VÖEN]"), _ph("[tarix]"), _ph("[tarix]")])
    new = _snap([_ph("[tarix]"), _ph("[ad]", "2. Layihə")], version=2)
    result = compare(old, new)

    assert result["placeholders"]["before"] == 3
    assert result["placeholders"]["after"] == 2
    assert {(p["text"], p["count"]) for p in result["placeholders"]["filled"]} == {
        ("[VÖEN]", 1), ("[tarix]", 1)}
    assert [p["text"] for p in result["placeholders"]["added"]] == ["[ad]"]
    assert result["counts"]["filled"] == 2
    assert result["counts"]["added"] == 1


def test_maliyyə_statusu_və_rəqəmi():
    old = _snap(checks=[
        {"id": "npv", "title": "NPV", "status": "fail", "claimed": 2225241},
        {"id": "pp", "title": "PP", "status": "ok", "claimed": 6.9},
        {"id": "irr", "title": "IRR", "status": "ok", "claimed": 12.8},
    ])
    new = _snap(checks=[
        {"id": "npv", "title": "NPV", "status": "ok", "claimed": 1225241},
        {"id": "pp", "title": "PP", "status": "warn", "claimed": 7.0},
        {"id": "irr", "title": "IRR", "status": "ok", "claimed": 12.8},
    ], version=2)
    changes = {c["id"]: c for c in compare(old, new)["finance"]}

    assert set(changes) == {"npv", "pp"}            # dəyişməyən göstərilmir
    assert changes["npv"]["trend"] == "yaxsilasdi"
    assert changes["npv"]["claimed_before"] == 2225241
    assert changes["pp"]["trend"] == "pislesdi"


def test_yalnız_rəqəm_dəyişəndə_trend_deyisdi():
    old = _snap(checks=[{"id": "npv", "title": "NPV", "status": "ok", "claimed": 1}])
    new = _snap(checks=[{"id": "npv", "title": "NPV", "status": "ok", "claimed": 2}], version=2)
    assert compare(old, new)["finance"][0]["trend"] == "deyisdi"


def test_tələb_statusları():
    old = _snap(items=[
        {"req_id": "A1", "status": "yoxdur"},
        {"req_id": "A2", "status": "var"},
        {"req_id": "A3", "status": "skip"},
        {"req_id": "A4", "status": "var"},
    ])
    new = _snap(items=[
        {"req_id": "A1", "status": "var"},
        {"req_id": "A2", "status": "natamam"},
        {"req_id": "A3", "status": "var"},
        {"req_id": "A4", "status": "var"},
    ], version=2)
    result = compare(old, new)
    trends = {c["req_id"]: c["trend"] for c in result["requirements"]}

    assert trends == {"A1": "yaxsilasdi", "A2": "pislesdi", "A3": "deyisdi"}
    assert result["counts"]["yaxsilasdi"] == 1
    assert result["counts"]["pislesdi"] == 1
    assert result["counts"]["deyisdi"] == 1


def test_əvvəlki_versiyanın_məlumatı():
    result = compare(_snap(), _snap(version=2))
    assert result["available"] is True
    assert result["previous"]["version"] == 1
    assert result["previous"]["check_id"] == "c1"


# ── Sabitləşdirmə ──────────────────────────────────────────────────────────

def _sections(**texts):
    return section_hashes([{"title": t, "text": x} for t, x in texts.items()])


def _req(req_id, status, *titles):
    return {"req_id": req_id, "status": status, "text": "...",
            "sections": [{"id": "S1", "title": t} for t in titles],
            "quote": f"{status} sübutu", "missing": None}


def test_mətn_dəyişməyibsə_əvvəlki_status_saxlanılır():
    """v1 və v2-də kredit bölməsi eynidir — 'var' -> 'natamam' modelin səs-küyüdür."""
    hashes = _sections(Kredit="Bank krediti 5 400 000 manat, 7 il.")
    old = _snap(items=[_req("IP2", "var", "Kredit")], hashes=hashes)
    items = stabilize(old, [_req("IP2", "natamam", "Kredit")], hashes)

    assert items[0]["status"] == "var"
    assert items[0]["quote"] == "var sübutu"
    assert items[0]["carried_from"] == {"version": 1, "status_now": "natamam"}

    result = compare(old, _snap(items=items, version=2, hashes=hashes))
    assert result["requirements"] == []
    assert [c["req_id"] for c in result["carried"]] == ["IP2"]
    assert result["carried"][0]["status_model"] == "natamam"
    assert result["counts"]["pislesdi"] == 0


def test_mətn_dəyişibsə_yeni_status_qalır():
    old = _snap(items=[_req("TS2", "natamam", "Təşəbbüskar")],
                hashes=_sections(Təşəbbüskar="VÖEN [VÖEN]"))
    new_hashes = _sections(Təşəbbüskar="VÖEN 1234567891")
    items = stabilize(old, [_req("TS2", "var", "Təşəbbüskar")], new_hashes)
    assert items[0]["status"] == "var"
    assert "carried_from" not in items[0]


def test_yeni_versiya_başqa_dəyişmiş_bölməyə_istinad_edirsə_qalır():
    """İstinad edilən bölmələrin BİRLƏŞMƏSİ yoxlanılır."""
    old_hashes = _sections(A="eyni", B="köhnə")
    new_hashes = _sections(A="eyni", B="yeni")
    old = _snap(items=[_req("X1", "natamam", "A")], hashes=old_hashes)
    items = stabilize(old, [_req("X1", "var", "A", "B")], new_hashes)
    assert items[0]["status"] == "var"


def test_sabitləşdirmə_tətbiq_olunmayan_hallar():
    hashes = _sections(A="eyni")
    # skip — agent xətasıdır, gizlədilmir
    old = _snap(items=[_req("X1", "var", "A")], hashes=hashes)
    assert stabilize(old, [_req("X1", "skip")], hashes)[0]["status"] == "skip"
    # istinad yoxdur — mətnin dəyişmədiyini bilmirik
    old = _snap(items=[_req("X1", "yoxdur")], hashes=hashes)
    assert stabilize(old, [_req("X1", "natamam")], hashes)[0]["status"] == "natamam"
    # köhnə yoxlamada barmaq izi yoxdur
    old = _snap(items=[_req("X1", "var", "A")])
    assert stabilize(old, [_req("X1", "natamam", "A")], hashes)[0]["status"] == "natamam"


def test_cədvəlin_məzmunu_dəyişəndə_bölmə_dəyişmiş_sayılır():
    """Bölmə mətnində cədvəl yalnız istinaddır — barmaq izi cədvəlin içini də tutmalıdır."""
    section = [{"title": "Kredit", "text": "[Cədvəl T1: Kredit]", "table_ids": ["T1"]}]
    before = section_hashes(section, [{"id": "T1", "rows": [["Bank", "5 400 000"]]}])
    after = section_hashes(section, [{"id": "T1", "rows": [["Bank", "6 000 000"]]}])
    assert before["Kredit"] != after["Kredit"]


def test_tələbin_mətni_dəyişibsə_status_daşınmır():
    """Tələb siyahısı yenilənib — köhnə status yeni tələbə aid deyil."""
    hashes = _sections(A="eyni")
    old_item = dict(_req("X1", "var", "A"), text="Köhnə tələb")
    new_item = dict(_req("X1", "natamam", "A"), text="Yenilənmiş tələb")
    old = _snap(items=[old_item], hashes=hashes)
    items = stabilize(old, [new_item], hashes)
    assert items[0]["status"] == "natamam"
    assert "carried_from" not in items[0]


def test_tələb_siyahısının_dəyişməsi_trend_sayılmır():
    """Yeni versiyada tələb əlavə edilib, çıxarılıb və mətni dəyişib."""
    old = _snap(items=[dict(_req("A1", "var"), text="Köhnə mətn"),
                       dict(_req("B1", "natamam"), text="Çıxarılan tələb")])
    new = _snap(items=[dict(_req("A1", "yoxdur"), text="Yeni mətn"),
                       dict(_req("E1A2B3C", "var"), text="Əlavə tələb", origin="elave")],
                version=2)
    result = compare(old, new)
    lists = result["requirement_list"]
    assert [i["req_id"] for i in lists["added"]] == ["E1A2B3C"]
    assert [i["req_id"] for i in lists["removed"]] == ["B1"]
    assert lists["changed"][0]["text_before"] == "Köhnə mətn"
    # A1 "var -> yoxdur" pisləşmə kimi göstərilmir: tələbin özü dəyişib.
    assert result["requirements"] == []
    assert result["counts"]["pislesdi"] == 0
