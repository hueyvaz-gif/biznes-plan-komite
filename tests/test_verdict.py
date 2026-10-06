"""Yekun status qaydası və komitə rəyinin rəqəm qoruyucusu."""
from __future__ import annotations

import uuid

import pytest

from app import service, storage
from app.agents.summary import build_facts, guard
from app.verdict import decide


def _fin(*checks):
    return {"checks": list(checks), "not_found": []}


def _chk(cid, status, critical=False):
    return {"id": cid, "title": cid.upper(), "status": status, "critical": critical}


def _req(rid, status):
    return {"req_id": rid, "status": status}


# ── Qayda ──────────────────────────────────────────────────────────────────

def test_hər_şey_qaydasındadırsa_hazır():
    result = decide(_fin(_chk("npv", "ok", True)), {"items": [_req("A1", "var")]}, [])
    assert result["verdict"] == "hazir"
    assert result["reasons"] == []


def test_kritik_fail_hazır_deyil():
    result = decide(_fin(_chk("npv", "fail", True), _chk("pp", "warn")),
                    {"items": [_req("A1", "var")]}, [])
    assert result["verdict"] == "hazir_deyil"
    assert result["reasons"][0]["code"] == "kritik_maliyye"
    assert result["reasons"][0]["items"] == ["NPV"]


def test_qeyri_kritik_fail_düzəliş():
    result = decide(_fin(_chk("irr", "fail")), {"items": []}, [])
    assert result["verdict"] == "duzelis"


def test_çatışmayan_tələb_hazır_deyil():
    result = decide(_fin(_chk("npv", "ok", True)),
                    {"items": [_req("A1", "yoxdur"), _req("A2", "natamam")]}, [])
    assert result["verdict"] == "hazir_deyil"
    codes = [r["code"] for r in result["reasons"]]
    assert codes == ["teleb_yoxdur", "teleb_natamam"]


@pytest.mark.parametrize("finance, items, placeholders", [
    (_fin(_chk("pp", "warn")), [], []),
    (_fin(), [_req("A1", "natamam")], []),
    (_fin(), [], [{"text": "[VÖEN]"}]),
    (_fin(_chk("npv", "skip", True)), [], []),          # yoxlanılmayan ≠ uyğun
    (_fin(), [_req("A1", "skip")], []),
])
def test_düzəliş_halları(finance, items, placeholders):
    assert decide(finance, {"items": items}, placeholders)["verdict"] == "duzelis"


def test_boş_nəticə_hazır_sayılmır():
    """Tələblər siyahısı boş gəlibsə, heç nə yoxlanılmayıb — 'hazır' ola bilməz."""
    result = decide(_fin(_chk("npv", "ok", True)), {"items": []}, [])
    assert result["verdict"] != "hazir"
    assert "yoxlama_natamam" in {r["code"] for r in result["reasons"]}
    assert decide(_fin(), {"items": [_req("A1", "var")]}, [])["verdict"] != "hazir"


def test_qismən_nəticə_hazır_sayılmır():
    """Gözlənilən bəndlərdən biri nəticədə yoxdursa, qalanları qaydasında olsa da."""
    expected = {"requirements": {"A1", "A2"}, "checks": {"npv", "irr"}}
    complete = decide(_fin(_chk("npv", "ok", True), _chk("irr", "ok")),
                      {"items": [_req("A1", "var"), _req("A2", "var")]}, [], expected)
    assert complete["verdict"] == "hazir"

    partial = decide(_fin(_chk("npv", "ok", True)),
                     {"items": [_req("A1", "var")]}, [], expected)
    assert partial["verdict"] == "duzelis"
    reason = next(r for r in partial["reasons"] if r["code"] == "yoxlama_natamam")
    assert reason["items"] == ["irr", "A2"]


def test_tapılmayan_rəqəm_düzəlişdir():
    finance = {"checks": [], "not_found": [{"field": "npv", "label": "NPV", "value": 1}]}
    result = decide(finance, {"items": []}, [])
    assert result["verdict"] == "duzelis"
    assert result["reasons"][0]["items"] == ["NPV"]


def test_ayrıca_sənəd_statusa_təsir_etmir():
    result = decide(_fin(_chk("npv", "ok", True)), {"items": [_req("LT3", "sened")]}, [])
    assert result["verdict"] == "hazir"
    assert result["notes"][0]["items"] == ["LT3"]


# ── Rəy: başlıq, faktlar və rəqəm qoruyucusu ──────────────────────────────

FACTS = [
    {"id": "F1", "kind": "status", "text": "Yekun status (qayda ilə): Düzəliş lazımdır."},
    {"id": "F2", "kind": "finance",
     "text": "NPV: planda 1 225 241 manat, hesablanan 1 226 599 manat, status — uyğun."},
    {"id": "F3", "kind": "finance", "text": "IRR: planda 12,8%, hesablanan 12,78%, status — uyğun."},
]
REASONS = {"reasons": [{"code": "bos_yer", "severity": "duzelis", "count": 12,
                        "text": "Sənəddə doldurulmamış yer qalıb", "items": []}]}


def _p(text, *facts):
    return {"text": text, "facts": list(facts)}


def test_başlıq_deterministikdir_və_statusa_zidd_ola_bilməz():
    """Model 'plan hazırdır' yazsa da, başlıq statusdan qurulur."""
    out = guard({"headline": "Plan təqdimata tam hazırdır.",
                 "key_findings": [], "open_questions": []}, FACTS, "hazir_deyil", REASONS)
    assert out["headline"].startswith("Hazır deyil")
    assert "tam hazırdır" not in out["headline"]
    assert "doldurulmamış yer qalıb (12)" in out["headline"]


def test_istinad_etdiyi_faktdakı_rəqəmlər_saxlanılır():
    out = guard({"key_findings": [_p("IRR 12,8% təsdiqləndi.", "F3"),
                                  _p("3 bənd natamamdır.", "F1")],
                 "open_questions": []}, FACTS, "duzelis", REASONS)
    assert out["key_findings"] == ["IRR 12,8% təsdiqləndi.", "3 bənd natamamdır."]
    assert out["dropped"] == 0
    assert out["untraced_numbers"] == []


def test_mənbəsiz_rəqəm_untraced_numbers_siyahısına_düşür():
    out = guard({"key_findings": [_p("Gəlir 45,5% artacaq.", "F2"),
                                  _p("IRR 12,8% təsdiqləndi.", "F3")],
                 "open_questions": [_p("Kredit 7 500 000 manat olacaqmı?", "F1")]},
                FACTS, "duzelis", REASONS)
    assert out["key_findings"] == ["IRR 12,8% təsdiqləndi."]
    assert out["open_questions"] == []
    assert [u["number"] for u in out["untraced_numbers"]] == ["45,5", "7 500 000"]
    assert out["dropped"] == 2


def test_rəqəm_başqa_faktda_olsa_da_istinad_edilən_faktda_olmalıdır():
    """12,8 F3-dədir; cümlə F2-yə istinad edirsə, rəqəm mənbəsiz sayılır."""
    out = guard({"key_findings": [_p("IRR 12,8% təsdiqləndi.", "F2")], "open_questions": []},
                FACTS, "duzelis", REASONS)
    assert out["key_findings"] == []
    assert out["untraced_numbers"][0]["number"] == "12,8"


def test_faktsız_və_naməlum_faktlı_cümlə_atılır():
    """Rəqəmsiz uydurma iddia da faktsız keçmir."""
    out = guard({"key_findings": [_p("Layihə çox gəlirlidir."),
                                  _p("Plan hazırdır.", "F99")],
                 "open_questions": []}, FACTS, "duzelis", REASONS)
    assert out["key_findings"] == []
    assert out["dropped"] == 2


def test_say_və_il_istisnaları():
    """≤20 və 1900–2100 arası tam ədədlər faktsız da icazəlidir; 21 və 1,5 yox."""
    out = guard({"key_findings": [_p("20 bənd 2027–2037 illəri üzrə yoxlanılıb.", "F1"),
                                  _p("21 bənd yoxlanılıb.", "F1"),
                                  _p("Fərq 1,5 il təşkil edir.", "F1")],
                 "open_questions": []}, FACTS, "duzelis", REASONS)
    assert out["key_findings"] == ["20 bənd 2027–2037 illəri üzrə yoxlanılıb."]
    assert [u["number"] for u in out["untraced_numbers"]] == ["21", "1,5"]


def test_faktlar_strukturlaşdırılıb_və_id_lidir():
    decision = decide(_fin(_chk("npv", "fail", True)), {"items": []}, [])
    facts = build_facts({
        "plan_id": "X", "version": 1, "verdict": decision["verdict"],
        "reasons": {"reasons": decision["reasons"], "notes": []},
        "finance": _fin(_chk("npv", "fail", True)), "comparison": {"available": False},
    })
    assert facts[0]["id"] == "F1" and facts[0]["kind"] == "status"
    assert "Hazır deyil" in facts[0]["text"]
    assert any(f["kind"] == "reason" and "Kritik maliyyə" in f["text"] for f in facts)
    assert any("ilk yoxlamasıdır" in f["text"] for f in facts)
    assert len({f["id"] for f in facts}) == len(facts)


# ── Tam icra (saxta modellə) ───────────────────────────────────────────────

def _run(samples, file_name, plan_id=None, version=1, fail_at=""):
    storage.init()
    check_id = uuid.uuid4().hex[:12]
    storage.create(check_id, plan_id or f"Plan {check_id}", version, file_name,
                   str(samples / file_name), fail_at)
    service.run_check(check_id)
    return check_id


def test_demo_v1_düzəliş_tələb_edir(samples):
    row = storage.get(_run(samples, "plan_demo_v1.docx"))
    assert row["verdict"] == "duzelis"                # boş yerlər + TP3 natamam
    codes = {r["code"] for r in row["result"]["reasons"]["reasons"]}
    assert {"bos_yer", "teleb_natamam"} <= codes
    summary = row["result"]["summary"]
    assert summary["headline"]
    assert summary["dropped"] == 0


def test_saxta_npv_hazır_deyil(samples, fake_llm):
    fake_llm.figures["npv"] = 2225241
    row = storage.get(_run(samples, "plan_demo_saxta.docx"))
    assert row["verdict"] == "hazir_deyil"
    reasons = row["result"]["reasons"]["reasons"]
    assert reasons[0]["code"] == "kritik_maliyye"


def test_rəy_modelində_xəta_ehtiyat_rəy_verir(samples, fake_llm):
    """Rəy modeli yıxılsa da yoxlama tamamlanır, maliyyə və tələblər görünür."""
    check_id = _run(samples, "plan_demo_v1.docx", fail_at="write_summary")
    row = storage.get(check_id)
    assert row["run_state"] == "tamamlandi"
    assert row["verdict"] == "duzelis"
    summary = row["result"]["summary"]
    assert summary["source"] == "qayda"
    assert "rəy modeli" in summary["error"]
    assert summary["headline"].startswith("Düzəliş lazımdır")
    assert summary["key_findings"]                       # səbəblərdən qurulub
    assert row["result"]["finance"]["checks"]
    assert row["result"]["compliance"]["items"]
    assert "summary" not in fake_llm.call_log            # model çağırılmadı


def test_rəy_modelinin_real_xətası_da_ehtiyat_rəyə_aparır(samples, fake_llm):
    from app import config
    from tests.fake_llm import FakeChatModel

    class RəySınıq(FakeChatModel):
        def _generate(self, messages, stop=None, run_manager=None, **kwargs):
            if self._has("CommitteeSummary"):
                raise RuntimeError("Saxta 529: model həddən artıq yüklənib")
            return super()._generate(messages, stop, run_manager, **kwargs)

    config.set_llm_override(RəySınıq())
    service.reset_graphs()
    row = storage.get(_run(samples, "plan_demo_v1.docx"))
    assert row["run_state"] == "tamamlandi"
    assert row["result"]["summary"]["source"] == "qayda"
    assert "529" in row["result"]["summary"]["error"]


def test_müqayisə_statusun_dəyişməsini_göstərir(samples, fake_llm):
    plan = "Status " + uuid.uuid4().hex[:6]
    fake_llm.figures["npv"] = 2225241
    _run(samples, "plan_demo_saxta.docx", plan_id=plan)
    fake_llm.figures["npv"] = 1225241
    row = storage.get(_run(samples, "plan_demo_v2.docx", plan_id=plan, version=2))

    verdict = row["result"]["comparison"]["verdict"]
    assert verdict == {"before": "hazir_deyil", "after": row["verdict"]}


def test_mətn_dəyişməyən_tələbdə_model_səs_küyü_statusu_dəyişmir(samples, fake_llm):
    """v2-də model IP2-yə 'natamam' deyir, amma istinad etdiyi bölmə dəyişməyib."""
    plan = "Sabit " + uuid.uuid4().hex[:6]
    _run(samples, "plan_demo_v1.docx", plan_id=plan)
    fake_llm.partial_ids = ("TP3", "IP2")
    row = storage.get(_run(samples, "plan_demo_v2.docx", plan_id=plan, version=2))

    items = {i["req_id"]: i for i in row["result"]["compliance"]["items"]}
    assert items["IP2"]["status"] == "var"
    assert items["IP2"]["carried_from"]["status_now"] == "natamam"
    comparison = row["result"]["comparison"]
    assert [c["req_id"] for c in comparison["carried"]] == ["IP2"]
    assert comparison["counts"]["pislesdi"] == 0
    assert "IP2" not in str(row["result"]["reasons"])


# ── Rəqəm qoruyucusu: işarə ────────────────────────────────────────────────

NEG = [{"id": "F1", "kind": "status", "text": "Yekun status (qayda ilə): Hazır deyil."},
       {"id": "F2", "kind": "finance",
        "text": "NPV (kritik): planda -100 000 manat, hesablanan -100 412 manat, status — uyğun."},
       {"id": "F3", "kind": "finance", "text": "NPV: planda 250 000 manat, status — uyğun."}]


@pytest.mark.parametrize("sentence", [
    "NPV 100 000 manatdır.",                       # işarəsiz — müsbət oxunur
    "NPV +100 000 manatdır.",
    "NPV — 100 000 manat.",                        # tire boşluqla ayrılıb: işarə deyil
])
def test_mənfi_faktın_müsbət_rəqəmi_rədd_edilir(sentence):
    out = guard({"key_findings": [_p(sentence, "F2")], "open_questions": []}, NEG, "hazir_deyil", REASONS)
    assert out["key_findings"] == []
    assert out["untraced_numbers"][0]["number"].replace(" ", " ") == "100 000"


@pytest.mark.parametrize("sentence", [
    "NPV −100 000 manatdır.",                      # U+2212
    "NPV -100 000 manatdır.",                 # defis + NBSP
    "NPV (100 000) manatdır.",                     # mötərizə — mənfi
    "Hesablanan NPV –100 412 manat.",              # en-dash, bitişik
])
def test_mənfi_rəqəm_düzgün_yazılanda_qəbul_edilir(sentence):
    out = guard({"key_findings": [_p(sentence, "F2")], "open_questions": []}, NEG, "hazir_deyil", REASONS)
    assert out["key_findings"] == [sentence] and out["untraced_numbers"] == []


def test_müsbət_faktın_mənfi_rəqəmi_rədd_edilir():
    out = guard({"key_findings": [_p("NPV −250 000 manatdır.", "F3"), _p("NPV (250 000) manat.", "F3")],
                 "open_questions": []}, NEG, "hazir_deyil", REASONS)
    assert out["key_findings"] == []
    assert [u["number"] for u in out["untraced_numbers"]] == ["−250 000", "250 000"]


def test_istisnalar_və_aralıqlar_işarədən_asılı_deyil():
    """İl aralığı "2027–2030" mənfi 2030 deyil; ≤20 say mötərizədə də istisnadır."""
    out = guard({"key_findings": [_p("2027–2030 illərində NPV -100 000 manat qalır.", "F2"),
                                  _p("Boş yerlər (12) doldurulmalıdır.", "F1")],
                 "open_questions": []}, NEG, "hazir_deyil", REASONS)
    assert len(out["key_findings"]) == 2 and out["untraced_numbers"] == []


def test_prose_numbers_işarə_qaydası():
    from app.numbers import prose_numbers
    vals = lambda t: [v for _s, _e, v in prose_numbers(t)]
    assert vals("(1 196 310)") == [-1196310]
    assert vals("IRR — 12,8%") == [12.8]
    assert vals("2027–2030") == [2027, 2030]
    assert vals("TP-3 bəndi") == [3]
    assert vals("fərq −0,02%") == [-0.02]
    assert vals("1 225 241") == [1225241]


def test_səbəb_göstərilir_və_istisna_işarəni_ört_basdır_etmir():
    facts = NEG + [{"id": "F4", "kind": "finance", "text": "Fərq: planda -12 gün."}]
    out = guard({"key_findings": [_p("NPV 100 000 manatdır.", "F2"), _p("Gəlir 777 manat.", "F2"),
                                  _p("Fərq 12 gündür.", "F4"), _p("Fərq -12 gündür.", "F4")],
                 "open_questions": []}, facts, "hazir_deyil", REASONS)
    reasons = [(u["number"].replace(" ", " "), u["reason"]) for u in out["untraced_numbers"]]
    assert reasons == [("100 000", "işarəsi faktdakından fərqlidir"),
                       ("777", "istinad edilən faktlarda yoxdur"),
                       ("12", "işarəsi faktdakından fərqlidir")]
    assert out["key_findings"] == ["Fərq -12 gündür."]
