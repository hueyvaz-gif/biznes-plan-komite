"""Demo məlumatları: interfeysi real API olmadan göstərmək üçün.

    python scripts/make_demo.py

Tam axın SAXTA modellə (tests/fake_llm.py) və MÜVƏQQƏTİ məlumat qovluğunda
işlədilir — real baza, real sənədlər və ödənişli API toxunulmur. API-nin
cavabları `static/demo/demo.json`-a yazılır; interfeys `/?demo=1` ilə açılanda
yalnız bu fayldan oxuyur, heç nə göndərmir və tarixçəyə yazmır. Hər yoxlama
`demo: true` ilə işarələnib.

Ssenarilər (samples/ hazır olmalıdır — scripts/make_samples.py):
  • "Demo zavod" v1 → v2: 12 → 9 boş yer, PP 6,9 → 7,0 (müqayisə);
  • "Demo saxta NPV": kritik uyğunsuzluq, hazır deyil;
  • "Demo əlavə tələblər": tələb sənədi + təsdiqlənmiş siyahı, bir bənd planda yoxdur.
"""
from __future__ import annotations

import json
import os
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TMP = Path(tempfile.mkdtemp(prefix="komite-demo-"))
os.environ.update({
    "DATA_DIR": str(TMP), "LANGSMITH_TRACING": "false", "DEV_MODE": "1",
    "ANTHROPIC_API_KEY": "demo-yoxdur", "GOOGLE_API_KEY": "demo-yoxdur",
    "EMBEDDINGS_PROVIDER": "lexical", "MARKET_ENABLED": "0",
    "LANGSMITH_API_KEY": "demo-yoxdur", "COMPLIANCE_GROUPS": "",
})
sys.path.insert(0, str(ROOT))

from fastapi.testclient import TestClient  # noqa: E402

from app import config, service  # noqa: E402
from app.main import app  # noqa: E402
from tests.fake_llm import FakeChatModel  # noqa: E402

SAMPLES = ROOT / "samples"
OUT = ROOT / "static" / "demo" / "demo.json"

DEMO_TXT = (
    "Tələb: Plan layihənin ekoloji təsirini və qoruyucu tədbirləri təsvir etməlidir.\n\n"
    "Tələb: Planda istehsal olunan məhsulun ixrac bazarları göstərilməlidir.\n\n"
    "Tələb: Planda layihə üzrə sığorta müqaviləsinin şərtləri göstərilməlidir.\n\n"
    "Sənəd: Bankın zəmanət məktubu ayrıca təqdim olunmalıdır.\n"
)


def _post(client, plan_id, sample, **extra):
    files = [("file", (sample, (SAMPLES / sample).read_bytes(), "application/octet-stream"))]
    files += [("extra_files", f) for f in extra.pop("extra_files", [])]
    response = client.post("/api/checks", files=files,
                           data={"plan_id": plan_id, "fail_at": "", **extra})
    response.raise_for_status()
    return response.json()["check_id"]


def main() -> None:
    if not (SAMPLES / "plan_demo_v1.docx").exists():
        sys.exit("samples/ hazır deyil: əvvəlcə scripts/make_samples.py işlədin.")

    model = FakeChatModel()
    config.set_llm_override(model)
    service.reset_graphs()
    ids: list[str] = []
    with TestClient(app) as client:
        ids.append(_post(client, "Demo zavod", "plan_demo_v1.docx"))
        model.figures["payback_years"] = 7.0
        model.written = {"payback_years": "7,0"}
        # v2 — mövcud plana AÇIQ seçimlə (ad uyğunluğu versiya yaratmır)
        zavod = client.get(f"/api/checks/{ids[0]}").json()["plan_id"]
        ids.append(_post(client, "", "plan_demo_v2.docx", existing_plan_id=zavod))

        model.figures.update(payback_years=6.9, npv=2225241)
        model.written = {}
        ids.append(_post(client, "Demo saxta NPV", "plan_demo_saxta.docx"))
        model.figures["npv"] = 1225241

        check_id = _post(client, "Demo əlavə tələblər", "plan_demo_v1.docx",
                         extra_files=[("bank_telebleri.txt", DEMO_TXT.encode("utf-8"),
                                       "text/plain")])
        draft = client.get(f"/api/checks/{check_id}/requirements").json()["draft"]["items"]
        model.missing_ids = (draft[2]["id"],)              # sığorta bəndi planda yoxdur
        client.post(f"/api/checks/{check_id}/requirements", json={"items": [
            {"id": i["id"], "text": i["text"], "kind": i["kind"]} for i in draft]})
        ids.append(check_id)

        checks = {cid: {**client.get(f"/api/checks/{cid}").json(), "demo": True} for cid in ids}
        # Ekran vəziyyətləri üçün: icra gedir və xəta (tarixçədə görünmür).
        first = checks[ids[0]]
        checks["demo-isleyir"] = {**first, "id": "demo-isleyir", "run_state": "isleyir",
                                  "run_state_label": "İşləyir", "current_step": "compliance",
                                  "verdict": None, "verdict_label": "", "result": None}
        # Köhnə formatda saxlanmış nəticə (əlavə tələblər, mənbə, əhatə, qrafik yoxdur).
        checks["demo-kohne"] = {**first, "id": "demo-kohne", "result": {
            "ingest": {"stats": {"placeholders": 1}, "placeholders": [
                {"text": "[VÖEN]", "section_title": "2. Təşəbbüskar", "where": "paraqraf",
                 "table_id": None, "context": "VÖEN-i [VÖEN]-dir."}]},
            "finance": {"checks": [{"id": "npv", "title": "Xalis cari dəyər (NPV)", "status": "ok",
                                    "claimed": 1225241, "computed": 1226599, "diff": 1358,
                                    "unit": "manat", "critical": True, "detail": "Köhnə nəticə.",
                                    "evidence": {}, "rule": ""}],
                        "not_found": [], "claimed": {"npv": 1225241}},
            "compliance": {"items": [{"req_id": "X1", "group_id": "xulase",
                                      "group_title": "1. Layihənin qısa xülasəsi", "status": "var",
                                      "text": "Layihənin məqsədi göstərilib.", "sections": [],
                                      "evidence": "Köhnə formatda sübut mətni.", "missing": None}]},
            "comparison": {"available": False},
            "summary": {"headline": "Köhnə formatda rəy.", "key_findings": ["Köhnə tapıntı."],
                        "open_questions": [], "dropped": 0},
            "reasons": {"reasons": [], "notes": []}}}
        checks["demo-xeta"] = {**first, "id": "demo-xeta", "run_state": "xeta",
                               "run_state_label": "Xəta", "current_step": "compliance",
                               "verdict": None, "verdict_label": "", "result": None,
                               "error": "RuntimeError: Saxta nasazlıq (demo) — davam etdirmək olar."}
        plans = client.get("/api/plans").json()
        demo = {
            "demo": True,
            "note": "Saxta model və sintetik məlumatla yaradılıb — real nəticə deyil.",
            "meta": client.get("/api/meta").json(),
            "plans": plans,
            "plan_checks": {p["plan_id"]: client.get(f"/api/plans/{p['plan_id']}/checks").json()
                            for p in plans},
            "checks": checks,
            "requirements": {check_id: client.get(f"/api/checks/{check_id}/requirements").json()},
            "events": {cid: client.get(f"/api/checks/{cid}/events").json()["events"] for cid in ids},
            # "Tam bölməni göstər" üçün bölmə mətnləri (demo heç nə soruşmur).
            "sections": {cid: {sec["title"]: client.get(f"/api/checks/{cid}/section",
                                                         params={"title": sec["title"]}).json()["text"]
                               for sec in checks[cid]["result"]["ingest"]["sections"]}
                         for cid in ids},
        }
        # "İcra gedir" ekranı üçün canlı lent: birinci yoxlamanın hadisələrinin ilk hissəsi.
        first_events = demo["events"][ids[0]]
        demo["events"]["demo-isleyir"] = first_events[: max(1, len(first_events) * 2 // 5)]
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(demo, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"Yazıldı: {OUT.relative_to(ROOT)} ({len(ids)} yoxlama, {len(plans)} plan)")
    for cid in ids:
        print(f"  {checks[cid]['plan_name']} v{checks[cid]['version']}: "
              f"{checks[cid]['verdict_label']}")


if __name__ == "__main__":
    main()
