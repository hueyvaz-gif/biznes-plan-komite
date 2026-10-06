"""LangSmith qiymətləndirməsi — dataset + evaluator-lar, SAXTA MODELLƏ (real model çağırılmır).

    python scripts/langsmith_eval.py            # dataset yaradılır/yenilənir, eksperiment yüklənir
    python scripts/langsmith_eval.py --local    # LangSmith-ə heç nə göndərmədən yerli icra
    python scripts/langsmith_eval.py biznes-plan-aydinliq-qaydalari   # yalnız bir dataset

İki dataset:
  • biznes-plan-qebul-ssenarileri — status qaydası, maliyyə hesablaması, boş yerlər, rəqəm qoruyucusu;
  • biznes-plan-aydinliq-qaydalari — tələb saylarının ardıcıllığı, əlavə tələblərdə ayrıca sənədin
    "tamamlanmış" sayılmaması, eyni adlı planların avtomatik birləşdirilməməsi.

Nə qiymətləndirilir: modelin cavab keyfiyyəti YOX (saxta modeldir), sistemin DETERMINİSTİK hissələri —
status qaydası, Python maliyyə hesablaması, boş yerlərin tapılması, rəqəm qoruyucusu. Gözlənilən
nəticələr qəbul testlərindən (tests/test_scenarios.py) götürülüb.

İzolyasiya: müvəqqəti DATA_DIR, lokal leksik embeddings, bazar söndürülüb; real istifadəçi
məlumatına toxunulmur. Açarlar `.env`-dən oxunur və çap edilmir.
"""
from __future__ import annotations

import os
import sys
import tempfile
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
os.environ["DATA_DIR"] = tempfile.mkdtemp(prefix="komite-eval-")
os.environ["EMBEDDINGS_PROVIDER"] = "lexical"
os.environ["MARKET_ENABLED"] = "0"
os.environ.setdefault("COMPLIANCE_GROUPS", "")

from dotenv import load_dotenv  # noqa: E402

load_dotenv(ROOT / ".env")

from app import config, service, storage  # noqa: E402
from tests.fake_llm import FakeChatModel  # noqa: E402

DATASET = "biznes-plan-qebul-ssenarileri"
SAMPLES = ROOT / "samples"

#: Ssenarilər: giriş (fayl + saxta modelin "oxuduğu" rəqəmlərə dəyişiklik) → gözlənilən nəticə.
SCENARIOS = [
    {"inputs": {"ssenari": "v1", "file": "plan_demo_v1.docx", "figures": {}},
     "outputs": {"verdict": "duzelis", "npv": "ok", "pp": "warn", "placeholders": 12}},
    {"inputs": {"ssenari": "v2", "file": "plan_demo_v2.docx", "figures": {"payback_years": 7.0},
                "written": {"payback_years": "7,0"}},
     "outputs": {"verdict": "duzelis", "npv": "ok", "pp": "ok", "placeholders": 9}},
    {"inputs": {"ssenari": "saxta NPV", "file": "plan_demo_saxta.docx", "figures": {"npv": 2225241}},
     "outputs": {"verdict": "hazir_deyil", "npv": "fail", "pp": "warn", "placeholders": 12}},
    {"inputs": {"ssenari": "qırıq pul axını", "file": "plan_demo_qiriq.docx", "figures": {"cashflow_table_id": None}},
     "outputs": {"verdict": "duzelis", "npv": "skip", "pp": "skip", "placeholders": None}},
    {"inputs": {"ssenari": "yanlış DOCX", "file": "yanlis_fayl.docx", "figures": {}},
     "outputs": {"verdict": "giris_xetasi", "npv": None, "pp": None, "placeholders": None}},
]


def target(inputs: dict) -> dict:
    """Bir ssenarini tam axınla işlədir (saxta model, müvəqqəti baza)."""
    model = FakeChatModel()
    model.figures.update(inputs.get("figures") or {})
    if inputs.get("written"):
        model.written = inputs["written"]
    config.set_llm_override(model)
    try:
        storage.init()
        check_id = uuid.uuid4().hex[:12]
        storage.create(check_id, f"Qiymətləndirmə {check_id}", 1, inputs["file"], str(SAMPLES / inputs["file"]))
        service.run_check(check_id)
        row = storage.get(check_id)
    finally:
        config.set_llm_override(None)
    result = row.get("result") or {}
    checks = {c["id"]: c["status"] for c in (result.get("finance") or {}).get("checks") or []}
    summary = result.get("summary") or {}
    return {"verdict": row.get("verdict"), "npv": checks.get("npv"), "pp": checks.get("pp"),
            "placeholders": ((result.get("ingest") or {}).get("stats") or {}).get("placeholders"),
            "untraced_numbers": len(summary.get("untraced_numbers") or []),
            "unsourced_figures": len((result.get("finance") or {}).get("not_found") or [])}


# ── Evaluator-lar ──────────────────────────────────────────────────────────

def status_qaydasi(inputs: dict, outputs: dict, reference_outputs: dict) -> dict:
    return {"key": "status_qaydasi", "score": int(outputs["verdict"] == reference_outputs["verdict"])}


def npv_yoxlamasi(inputs: dict, outputs: dict, reference_outputs: dict) -> dict:
    return {"key": "npv_yoxlamasi", "score": int(outputs["npv"] == reference_outputs["npv"])}


def pp_yoxlamasi(inputs: dict, outputs: dict, reference_outputs: dict) -> dict:
    return {"key": "pp_yoxlamasi", "score": int(outputs["pp"] == reference_outputs["pp"])}


def bos_yerler(inputs: dict, outputs: dict, reference_outputs: dict) -> dict:
    expected = reference_outputs["placeholders"]
    return {"key": "bos_yerler", "score": 1 if expected is None else int(outputs["placeholders"] == expected)}


def reqem_qoruyucusu(inputs: dict, outputs: dict, reference_outputs: dict) -> dict:
    """Rəydə mənbəsiz rəqəm qalmamalıdır (saxta model rəqəm uydurmur — qoruyucu boş olmalıdır)."""
    return {"key": "reqem_qoruyucusu", "score": int(outputs["untraced_numbers"] == 0)}


EVALUATORS = [status_qaydasi, npv_yoxlamasi, pp_yoxlamasi, bos_yerler, reqem_qoruyucusu]


# ── İkinci dataset: aydınlıq qaydaları (API üzərindən, interfeysin istifadə etdiyi məlumatla) ──

CLARITY_DATASET = "biznes-plan-aydinliq-qaydalari"
EXTRA_TXT = (
    "Tələb: Plan layihənin ekoloji təsirini və qoruyucu tədbirləri təsvir etməlidir.\n\n"
    "Tələb: Planda istehsal olunan məhsulun ixrac bazarları göstərilməlidir.\n\n"
    "Tələb: Planda layihə üzrə sığorta müqaviləsinin şərtləri göstərilməlidir.\n\n"
    "Sənəd: Bankın zəmanət məktubu ayrıca təqdim olunmalıdır.\n"
)

CLARITY_SCENARIOS = [
    {"inputs": {"ssenari": "teleb_saylari", "file": "plan_demo_v1.docx"},
     "outputs": {"total": 47, "evaluated": 44, "document": 3, "answered": 43, "complete": False}},
    {"inputs": {"ssenari": "elave_sened", "file": "plan_demo_v1.docx", "missing_index": 2},
     "outputs": {"total": 4, "evaluated": 3, "document": 1, "answered": 2, "complete": False}},
    {"inputs": {"ssenari": "eyni_ad", "file": "plan_demo_v1.docx", "plan_name": "Eyni adlı plan"},
     "outputs": {"distinct_plans": True, "versions": [1, 1, 2], "same_plan_for_v2": True}},
]


def req_counts(items: list[dict]) -> dict:
    """static/core/dom.js → reqCounts() ilə EYNİ qayda (bütün ekranlarda istifadə olunan)."""
    n = lambda st: sum(1 for i in items if i.get("status") == st)  # noqa: E731
    answered, partial, missing, document = n("var"), n("natamam"), n("yoxdur"), n("sened")
    evaluated = answered + partial + missing
    return {"total": len(items), "evaluated": evaluated, "answered": answered, "document": document,
            "not_checked": len(items) - evaluated - document,
            "complete": len(items) > 0 and answered == len(items)}


def _post(client, sample: str, **data) -> dict:
    files = [("file", (sample, (SAMPLES / sample).read_bytes(), "application/octet-stream"))]
    files += [("extra_files", f) for f in data.pop("extra_files", [])]
    response = client.post("/api/checks", files=files, data={"fail_at": "", **data})
    response.raise_for_status()
    return response.json()


def clarity_target(inputs: dict) -> dict:
    """Bir aydınlıq ssenarisini API üzərindən işlədir (saxta model, müvəqqəti baza)."""
    from fastapi.testclient import TestClient

    from app.main import app

    model = FakeChatModel()
    config.set_llm_override(model)
    service.reset_graphs()
    try:
        with TestClient(app) as client:
            kind = inputs["ssenari"]
            if kind == "teleb_saylari":
                cid = _post(client, inputs["file"], plan_name="Saylar " + uuid.uuid4().hex[:6])["check_id"]
                items = [i for i in client.get(f"/api/checks/{cid}").json()["result"]["compliance"]["items"]
                         if (i.get("origin") or "standart") == "standart"]
                return {**req_counts(items), "facts": client.get("/api/meta").json()["facts"]}
            if kind == "elave_sened":
                cid = _post(client, inputs["file"], plan_name="Əlavə " + uuid.uuid4().hex[:6],
                            extra_files=[("telebler.txt", EXTRA_TXT.encode("utf-8"), "text/plain")])["check_id"]
                draft = client.get(f"/api/checks/{cid}/requirements").json()["draft"]["items"]
                model.missing_ids = (draft[inputs["missing_index"]]["id"],)
                client.post(f"/api/checks/{cid}/requirements", json={"items": [
                    {"id": i["id"], "text": i["text"], "kind": i["kind"]} for i in draft]}).raise_for_status()
                items = [i for i in client.get(f"/api/checks/{cid}").json()["result"]["compliance"]["items"]
                         if i.get("origin") == "elave"]
                return req_counts(items)
            if kind == "eyni_ad":
                name = inputs["plan_name"] + " " + uuid.uuid4().hex[:6]
                a = _post(client, inputs["file"], plan_name=name)
                b = _post(client, inputs["file"], plan_name=name)                  # eyni ad — YENİ plan
                c = _post(client, inputs["file"], existing_plan_id=a["plan_id"])   # açıq seçim — versiya
                return {"distinct_plans": a["plan_id"] != b["plan_id"],
                        "versions": [a["version"], b["version"], c["version"]],
                        "same_plan_for_v2": c["plan_id"] == a["plan_id"]}
            raise ValueError(kind)
    finally:
        config.set_llm_override(None)


def say_qaydasi(inputs: dict, outputs: dict, reference_outputs: dict) -> dict:
    """Saylar gözlənilənlə eynidir və hissələrin cəmi ümumi saya bərabərdir (heç nə itmir)."""
    if "total" not in reference_outputs:
        return {"key": "say_qaydasi", "score": 1}
    exact = all(outputs.get(k) == reference_outputs[k] for k in ("total", "evaluated", "document", "answered"))
    whole = outputs["total"] == outputs["evaluated"] + outputs["document"] + outputs["not_checked"]
    return {"key": "say_qaydasi", "score": int(exact and whole)}


def yoxlanilmayan_tamamlanmis_deyil(inputs: dict, outputs: dict, reference_outputs: dict) -> dict:
    """Ayrıca sənəd / yoxlanılmayan / natamam bənd varsa nəticə "hamısı" sayılmamalıdır."""
    if "complete" not in reference_outputs:
        return {"key": "yoxlanilmayan_tamamlanmis_deyil", "score": 1}
    open_items = outputs["total"] - outputs["answered"]
    ok = outputs["complete"] == reference_outputs["complete"] and outputs["complete"] == (open_items == 0)
    return {"key": "yoxlanilmayan_tamamlanmis_deyil", "score": int(ok)}


def ekranlar_ardicil(inputs: dict, outputs: dict, reference_outputs: dict) -> dict:
    """Giriş ekranındakı faktlar (/api/meta) nəticədəki saylarla üst-üstə düşür."""
    facts = outputs.get("facts")
    if not facts:
        return {"key": "ekranlar_ardicil", "score": 1}
    ok = (facts["requirements"] == outputs["total"] and facts["document_only"] == outputs["document"]
          and facts["in_plan"] == outputs["total"] - outputs["document"])
    return {"key": "ekranlar_ardicil", "score": int(ok)}


def eyni_ad_birlesmir(inputs: dict, outputs: dict, reference_outputs: dict) -> dict:
    """Eyni ad yeni plan yaradır; versiya yalnız açıq seçimlə əlavə olunur."""
    if "distinct_plans" not in reference_outputs:
        return {"key": "eyni_ad_birlesmir", "score": 1}
    ok = all(outputs[k] == reference_outputs[k] for k in ("distinct_plans", "versions", "same_plan_for_v2"))
    return {"key": "eyni_ad_birlesmir", "score": int(ok)}


CLARITY_EVALUATORS = [say_qaydasi, yoxlanilmayan_tamamlanmis_deyil, ekranlar_ardicil, eyni_ad_birlesmir]

#: (dataset, nümunələr, hədəf, evaluator-lar, eksperiment prefiksi, təsvir)
SUITES = [
    (DATASET, SCENARIOS, target, EVALUATORS, "saxta-model",
     "Biznes plan yoxlamasının qəbul ssenariləri (deterministik hissələr; tests/test_scenarios.py)."),
    (CLARITY_DATASET, CLARITY_SCENARIOS, clarity_target, CLARITY_EVALUATORS, "aydinliq",
     "Aydınlıq qaydaları: tələb sayları, ayrıca sənəd, eyni adlı planlar (saxta model)."),
]


def _selected():
    only = [a for a in sys.argv[1:] if not a.startswith("--")]
    return [suite for suite in SUITES if not only or suite[0] in only]


def run_local() -> int:
    total, passed = 0, 0
    for name, cases, fn, evaluators, *_ in _selected():
        print(name)
        for case in cases:
            out = fn(case["inputs"])
            scores = {e.__name__: e(case["inputs"], out, case["outputs"])["score"] for e in evaluators}
            total += len(scores)
            passed += sum(scores.values())
            print(f"  {case['inputs']['ssenari']:18} {scores}")
    print(f"\nYerli nəticə: {passed}/{total}")
    return 0 if passed == total else 1


def run_langsmith() -> int:
    if not os.getenv("LANGSMITH_API_KEY", "").strip():
        sys.exit("LANGSMITH_API_KEY yoxdur — `--local` ilə işlədin.")
    from langsmith import Client, evaluate

    client = Client()
    failed = 0
    for name, cases, fn, evaluators, prefix, description in _selected():
        if not client.has_dataset(dataset_name=name):
            client.create_dataset(name, description=description)
            client.create_examples(dataset_name=name, examples=cases)
            print(f"Dataset yaradıldı: {name} ({len(cases)} nümunə)")
        else:
            print(f"Dataset mövcuddur: {name}")
        results = evaluate(fn, data=name, evaluators=evaluators, experiment_prefix=prefix,
                           metadata={"model": "saxta (tests/fake_llm.py)", "embeddings": "lexical"},
                           max_concurrency=1, client=client)
        scores: dict[str, list[float]] = {}
        for row in list(results):
            for r in row["evaluation_results"]["results"]:
                scores.setdefault(r.key, []).append(r.score)
        for key, values in scores.items():
            print(f"  {key:32} {sum(values)}/{len(values)}")
            failed += sum(values) != len(values)
        print(f"  Eksperiment: {results.experiment_name}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(run_local() if "--local" in sys.argv else run_langsmith())
