"""Yoxlamanın icrası — qrafı işə salır və vəziyyəti SQLite-a yazır.

Qraf BİR dəfə yaradılır və `SqliteSaver` ilə checkpoint saxlayır. `resume=True`
olanda giriş `None` ötürülür: LangGraph son checkpoint-dən davam edir və artıq
tamamlanmış qovşaqlar TƏKRAR işləmir (maliyyə agenti ikinci dəfə çağırılmır).
"""
from __future__ import annotations

import hashlib
import json
import logging
import sqlite3
import traceback
import uuid
from pathlib import Path
from typing import Any

from langgraph.checkpoint.sqlite import SqliteSaver

from app import attachments, config, evidence, memory, rules, storage
from app.agents import extra_requirements
from app.events import EventLogger
from app.compare import section_hashes
from app.graph import STEPS, build_graph, reset_subgraphs, _route

log = logging.getLogger(__name__)

_GRAPH: Any | None = None
_CONNECTION: sqlite3.Connection | None = None

#: UI-də göstərilən addımlar (qraf qovşaqları ilə eynidir, "supervisor" xaric).
ACTIVE_STEPS: tuple[str, ...] = STEPS


def graph() -> Any:
    """Ana qrafı qaytarır (bir dəfə qurulur)."""
    global _GRAPH, _CONNECTION
    if _GRAPH is None:
        config.ensure_dirs()
        _CONNECTION = sqlite3.connect(config.CHECKPOINT_FILE, check_same_thread=False)
        _GRAPH = build_graph(SqliteSaver(_CONNECTION))
    return _GRAPH


class PlanBusy(Exception):
    """Planın yoxlaması hələ işləyir — silmək olmaz."""


def delete_plan(plan_id: str) -> dict[str, Any]:
    """Planı BÜTÜN versiyaları ilə silir: yoxlamalar, hadisələr, əlavə tələblər, LangGraph
    checkpoint-ləri, yüklənmiş fayllar və semantik yaddaş. Geri qaytarılmır."""
    rows = storage.plan_check_ids(plan_id)
    if not rows:
        raise KeyError(plan_id)
    if any(r["run_state"] in storage.BUSY_STATES for r in rows):
        raise PlanBusy(plan_id)
    ids = [r["id"] for r in rows]

    # Silinəcək fayllar və sənəd açarları — sətirlər silinməzdən ƏVVƏL toplanır.
    files = [Path(r["file_path"]) for r in rows if r.get("file_path")]
    for cid in ids:
        extras = storage.extras_get(cid) or {}
        files += [attachments.attachments_dir() / a["stored"]
                  for a in extras.get("attachments") or [] if a.get("stored")]
    files += [config.UPLOAD_DIR / "evidence" / name for name in storage.evidence_files(ids)]
    doc_keys = {memory.doc_key(doc) for doc in map(storage.doc_get, ids) if doc}

    storage.delete_checks(ids)

    # Sənəd başqa plan/yoxlamada da yüklənibsə, onun parçaları saxlanılır.
    still_used = {memory.doc_key(doc) for doc in map(storage.doc_get, storage.all_check_ids()) if doc}
    memory_rows = memory.forget(plan_id, doc_keys - still_used)

    saver = graph().checkpointer
    for cid in ids:
        saver.delete_thread(cid)

    upload_root = config.UPLOAD_DIR.resolve()
    removed_files = 0
    for path in files:
        try:
            resolved = path.resolve()
            if upload_root in resolved.parents and resolved.is_file():   # yalnız yükləmə qovluğunda
                resolved.unlink()
                removed_files += 1
        except OSError as exc:
            log.warning("plan silinir: fayl silinmədi (%s)", type(exc).__name__)
    log.info("plan silindi: %d yoxlama, %d fayl, %d yaddaş sətri", len(ids), removed_files, memory_rows)
    return {"plan_id": plan_id, "deleted_checks": len(ids), "deleted_files": removed_files}


def reset_graphs() -> None:
    """Testlər üçün: saxta model dəyişəndə qraflar yenidən qurulsun."""
    global _GRAPH, _CONNECTION
    if _CONNECTION is not None:
        _CONNECTION.close()
    _GRAPH = None
    _CONNECTION = None
    reset_subgraphs()


# ── Nəticənin frontend görüntüsü ───────────────────────────────────────────

def ingest_view(doc: dict[str, Any]) -> dict[str, Any]:
    """Sənədin yüngül görüntüsü — tam mətn frontend-ə göndərilmir."""
    return {
        "file_name": doc["file_name"],
        "stats": doc["stats"],
        "placeholders": doc["placeholders"],
        "section_hashes": section_hashes(doc["sections"], doc["tables"]),
        "sections": [
            {"id": s["id"], "title": s["title"], "level": s["level"],
             "chars": len(s["text"]), "table_ids": s["table_ids"]}
            for s in doc["sections"]
        ],
        "tables": [
            {"id": t["id"], "caption": t["caption"], "section_title": t["section_title"],
             "n_rows": t["n_rows"], "n_cols": t["n_cols"]}
            for t in doc["tables"]
        ],
    }


def result_view(values: dict[str, Any], check_id: str | None = None) -> dict[str, Any]:
    """Qrafın state-indən saxlanılacaq nəticəni qurur."""
    doc = values.get("doc")
    finance = values.get("finance")
    compliance = values.get("compliance")
    ingest = ingest_view(doc) if doc else None
    if doc:
        # Dəlil paneli: hər tapıntının sənəddəki orijinal parçası (vurğu mövqeyi ilə).
        if finance:
            finance = evidence.finance_evidence(doc, finance)
        if compliance:
            compliance = evidence.compliance_evidence(doc, compliance)
        ingest["placeholders"] = evidence.placeholder_evidence(doc, ingest["placeholders"])
    return {
        "ingest": ingest,
        "finance": finance,
        "compliance": compliance,
        "comparison": values.get("comparison"),
        "summary": values.get("summary"),
        "reasons": values.get("reasons"),
        "graph_errors": values.get("errors") or [],
        # Əlavə tələb sənədləri (yoxdursa None — köhnə yoxlamalar kimi).
        "extras": extras_view(check_id) if check_id else None,
        # Nəticə hansı qayda versiyası ilə qurulub (köhnə nəticələr yenidən qiymətləndirilir).
        "rules": {"version": rules.RULES_VERSION},
    }


def apply_current_rules(check: dict[str, Any] | None) -> dict[str, Any] | None:
    """Saxlanmış hesabat köhnə qaydalarla qurulubsa — model çağırmadan yenidən qiymətləndirilir
    və saxlanılır (əvvəlki status `result.rules.previous_verdict`-də qalır)."""
    if not check or check.get("run_state") != "tamamlandi" or not check.get("result"):
        return check
    if (check["result"].get("rules") or {}).get("version", 1) >= rules.RULES_VERSION:
        return check
    try:
        outcome = rules.reevaluate(check, storage.doc_get(check["id"]))
    except Exception as exc:                     # qayda xətası hesabatı açmağa mane olmamalıdır
        log.warning("qaydaların yenidən tətbiqi alınmadı (%s)", type(exc).__name__)
        return check
    if outcome is None:
        return check
    storage.update(check["id"], result=outcome["result"], verdict=outcome["verdict"])
    log.info("hesabat %s yeni qaydalarla yeniləndi: %s → %s", check["id"],
             check.get("verdict"), outcome["verdict"])
    return storage.get(check["id"])


def apply_rules_to_all() -> int:
    """Başlanğıcda: bütün tamamlanmış hesabatlara cari qaydalar (sol paneldəki status da düzgün olsun)."""
    count = 0
    for check_id in storage.all_check_ids():
        before = storage.get(check_id)
        after = apply_current_rules(before)
        count += after is not before and after is not None
    return count


def _run_config(check: dict[str, Any]) -> dict[str, Any]:
    """LangSmith üçün izin adı, teqlər, metadata və checkpoint açarı."""
    return {
        "configurable": {"thread_id": check["id"]},
        "run_name": f"Komitə: {check.get('plan_name') or check['plan_id']} v{check['version']}",
        "tags": ["biznes-plan-komite", f"plan:{check['plan_id']}"],
        "metadata": {
            "check_id": check["id"],
            "plan_id": check["plan_id"],
            "version": check["version"],
            "file_name": check["file_name"],
        },
        "recursion_limit": 40,
    }


def _pending_step(values: dict[str, Any]) -> str | None:
    """Hazırda gözləyən növbəti GÖRÜNƏN qovşaq.

    State-in məzmunundan hesablanır, `get_state(...).next`-dən YOX: axın zamanı
    checkpoint bir superstep geri qalır və UI səhv addımı göstərərdi.
    "supervisor" istifadəçiyə göstərilmir — onun yerinə `_route`-un seçəcəyi
    qovşağın adı qaytarılır.
    """
    if values.get("verdict") == "giris_xetasi":
        return "save"
    if not values.get("doc"):
        return "ingest"
    if "previous" not in values:
        return "load_previous"
    nxt = _route(values)
    return nxt if nxt in STEPS else None


def _failed_step(snapshot: Any, fallback: str | None) -> str | None:
    """Xəta verən qovşağın adı.

    `graph.get_state(...).tasks` içində error-u olan task axtarılır — əks halda
    UI "supervisor"-u qırmızı göstərərdi.
    """
    for task in getattr(snapshot, "tasks", ()) or ():
        if getattr(task, "error", None) and task.name in STEPS:
            return task.name
    for task in getattr(snapshot, "tasks", ()) or ():
        if getattr(task, "error", None):
            return task.name
    return fallback


def run_check(check_id: str, resume: bool = False) -> None:
    """Yoxlamanı icra edir (və ya checkpoint-dən davam etdirir)."""
    check = storage.get(check_id)
    if check is None:
        return
    extras = storage.extras_get(check_id)
    if extras is not None and extras.get("confirmed") is None:
        # Əlavə tələblər hələ təsdiqlənməyib — tam yoxlama BAŞLAMIR.
        return

    compiled = graph()
    cfg = _run_config(check)
    # Agent jurnalı: hər icra cəhdi ayrıca nömrələnir (resume → +1); LangSmith
    # izləyicisi (LANGSMITH_TRACING) bununla YANAŞI işləyir.
    cfg["callbacks"] = [EventLogger(check_id, storage.next_attempt(check_id))]

    inputs: dict[str, Any] | None
    values: dict[str, Any]
    if resume and compiled.get_state(cfg).created_at is not None:
        inputs = None                      # son checkpoint-dən davam
        values = dict(compiled.get_state(cfg).values)
    else:
        inputs = {
            "check_id": check["id"],
            "plan_id": check["plan_id"],
            "plan_name": check.get("plan_name") or check["plan_id"],
            "version": check["version"],
            "file_path": check["file_path"],
            "file_name": check["file_name"],
        }
        values = {}

    storage.update(check_id, run_state="isleyir", error=None,
                   current_step=_pending_step(values))

    try:
        # State-i özümüz yığırıq: hər update bir qovşağın dəyişikliyidir.
        for update in compiled.stream(inputs, cfg, stream_mode="updates"):
            for delta in update.values():
                if isinstance(delta, dict):
                    values.update(delta)
            done = "save" in update          # sonuncu qovşaq bitdi
            storage.update(check_id,
                           current_step=None if done else _pending_step(values))
    except Exception as exc:
        snapshot = compiled.get_state(cfg)
        storage.update(
            check_id,
            run_state="xeta",
            current_step=_failed_step(snapshot, _pending_step(values)),
            error=f"{type(exc).__name__}: {exc}",
            result=result_view(snapshot.values or values, check_id),
        )
        traceback.print_exc()
        return

    values = compiled.get_state(cfg).values
    if values.get("doc"):
        storage.doc_set(check_id, values["doc"])      # dəlil paneli / "Tam bölməni göstər" üçün
    verdict = values.get("verdict")
    errors = values.get("errors") or []
    storage.update(
        check_id,
        run_state="tamamlandi",
        current_step=None,
        verdict=verdict,
        error=errors[0] if verdict == "giris_xetasi" and errors else None,
        result=result_view(values, check_id),
    )
    if values.get("doc") and verdict != "giris_xetasi":
        _remember(check_id, values["doc"])
        # İqtisadi təhlil — ayrıca nəticə; xətası yoxlamanın statusuna təsir etmir.
        from app.economics import service as economics
        economics.run_safe(check_id)


def _remember(check_id: str, doc: dict[str, Any]) -> None:
    """Semantik yaddaş: sənəd indeksi (RAG) + planın tapıntıları. Xətası yoxlamaya təsir etmir."""
    try:
        memory.index_document(doc)
        check = storage.get(check_id)
        if check:
            memory.remember_findings(check)
    except Exception as exc:                     # yaddaş köməkçidir
        log.warning("semantik yaddaş yazılmadı (%s)", type(exc).__name__)


def failed_groups(check: dict[str, Any]) -> list[dict[str, Any]]:
    """Saxlanmış nəticədə texniki xəta ilə yıxılan uyğunluq qrupları."""
    result = check.get("result") or {}
    return list(((result.get("compliance") or {}).get("failed_groups")) or [])


def retry_failed_groups(check_id: str) -> None:
    """Yalnız uğursuz uyğunluq qruplarını yenidən yoxlayır.

    Checkpoint-dəki state-də uyğunluq nəticəsi və ondan asılı addımlar
    (status, müqayisə, rəy) sıfırlanır, qraf davam etdirilir. Uyğunluq qovşağı
    uğurlu qrupların cavabını yaddaşdan (`memo`) götürür — onlar itmir və
    modelə yenidən göndərilmir; yalnız uğursuz qruplar soruşulur. Maliyyə
    nəticəsinə toxunulmur.
    """
    check = storage.get(check_id)
    if check is None:
        return
    compiled = graph()
    cfg = _run_config(check)
    compiled.update_state(
        cfg,
        {"compliance": None, "verdict": None, "reasons": None,
         "comparison": None, "summary": None},
        as_node="finance",                 # növbəti addım: supervisor -> compliance
    )
    run_check(check_id, resume=True)


# ── Əlavə tələblər ─────────────────────────────────────────────────────────

#: Bir siyahıda ən çox bənd və bir bəndin ən uzun mətni.
MAX_CONFIRMED = 100
MAX_ITEM_TEXT = 1000


class RequirementsError(ValueError):
    """Təsdiq üçün göndərilən siyahıda səhv — istifadəçiyə göstərilir."""


def extract_requirements(check_id: str) -> None:
    """Əlavə sənədlərdən tələb QARALAMASI çıxarır və təsdiq gözləyir.

    Tam yoxlama BURADA başlamır — yalnız istifadəçi siyahını təsdiqləyəndə.
    """
    extras = storage.extras_get(check_id)
    if extras is None:
        return
    storage.update(check_id, run_state="telebler_hazirlanir", error=None)
    check = storage.get(check_id) or {}
    cfg = _run_config(check)
    cfg["run_name"] = f"Əlavə tələblər: {check.get('plan_name') or check['plan_id']} v{check['version']}"
    cfg["callbacks"] = [EventLogger(check_id, 0)]       # 0 — təsdiqdən əvvəlki çıxarış
    draft = extra_requirements.extract(extras["attachments"], cfg)
    storage.extras_set_draft(check_id, draft)
    storage.update(check_id, run_state="tesdiq_gozleyir",
                   error=("Tələblər avtomatik çıxarılmadı: " + draft["error"]
                          if draft.get("error") else None))


def list_version(items: list[dict[str, Any]], attachments: list[dict[str, Any]]) -> str:
    """Təsdiqlənmiş siyahının versiyası: bəndlər + mənbə faylların izi."""
    canonical = json.dumps(
        {"items": [{k: i.get(k) for k in ("id", "text", "kind", "source_id", "fragment")}
                   for i in items],
         "files": sorted(a["sha256"] for a in attachments)},
        ensure_ascii=False, sort_keys=True)
    return hashlib.sha1(canonical.encode("utf-8")).hexdigest()[:12]


def confirm_requirements(check_id: str, submitted: list[dict[str, Any]],
                         acknowledge_incomplete: bool = False) -> dict[str, Any]:
    """İstifadəçinin redaktə etdiyi siyahını yoxlayır və təsdiqləyir.

    - Qaralamadakı bənd: mənbə (fayl, istinad, fraqment) QARALAMADAN götürülür —
      müştəri tərəfi fraqmenti dəyişə bilməz. Mətn dəyişibsə `edited=True`.
    - Yeni bənd: istifadəçi yazıb, mənbəsi yoxdur (`origin="istifadeci"`).
    - Çıxarış NATAMAMDIRSA (bənd limiti, mətn kəsilməsi), təsdiq yalnız istifadəçi
      bunu açıq qəbul etdikdə (`acknowledge_incomplete=True`) mümkündür.
    Qaytarır: {"items", "list_version"}.
    """
    extras = storage.extras_get(check_id)
    if extras is None:
        raise RequirementsError("Bu yoxlamada əlavə tələb sənədi yoxdur.")
    limits = (extras.get("draft") or {}).get("limits") or {}
    if limits.get("incomplete") and not acknowledge_incomplete:
        raise RequirementsError("Çıxarılan siyahı natamamdır (bənd limiti və ya mətnin kəsilməsi). "
                                "Təsdiq üçün bunu qəbul etdiyinizi açıq bildirin.")
    draft = {i["id"]: i for i in (extras.get("draft") or {}).get("items") or []}
    if len(submitted) > MAX_CONFIRMED:
        raise RequirementsError(f"Ən çoxu {MAX_CONFIRMED} əlavə tələb ola bilər.")

    items: list[dict[str, Any]] = []
    seen: set[str] = set()
    for raw in submitted:
        text = str(raw.get("text") or "").strip()
        if not text:
            raise RequirementsError("Boş tələb mətni ola bilməz — bəndi silin və ya doldurun.")
        if len(text) > MAX_ITEM_TEXT:
            raise RequirementsError(f"Tələb mətni {MAX_ITEM_TEXT} simvoldan uzundur.")
        kind = raw.get("kind")
        if kind not in ("plan", "sened"):
            raise RequirementsError("Tələbin növü 'plan' və ya 'sened' olmalıdır.")
        base = draft.get(str(raw.get("id") or ""))
        if base is not None:
            item = {**base, "text": text, "kind": kind,
                    "edited": base.get("edited") or text != base["text"] or kind != base["kind"]}
        else:
            item = {"id": "EU" + uuid.uuid4().hex[:12].upper(), "text": text, "kind": kind,
                    "source_id": None, "source_name": None, "ref": None, "fragment": None,
                    "origin": "istifadeci", "edited": False}
        if item["id"] in seen:
            continue
        seen.add(item["id"])
        items.append(item)

    version = list_version(items, extras["attachments"])
    storage.extras_confirm(check_id, items, version)
    storage.update(check_id, run_state="gozleyir", error=None)
    return {"items": items, "list_version": version}


#: Uyğunluq agenti üçün təsdiqlənmiş əlavə tələblər qrupu.
extra_groups = extra_requirements.confirmed_groups


def extras_view(check_id: str) -> dict[str, Any] | None:
    """Nəticəyə əlavə olunan qısa məlumat: fayllar, versiya, təsdiq vaxtı."""
    extras = storage.extras_get(check_id)
    if extras is None:
        return None
    return {
        "attachments": [attachments.public(a) for a in extras["attachments"]],
        "list_version": extras.get("list_version"),
        "confirmed_at": extras.get("confirmed_at"),
        "count": len(extras.get("confirmed") or []),
        # Natamam çıxarış istifadəçinin razılığı ilə təsdiqlənib — nəticədə də görünür.
        "incomplete": bool(((extras.get("draft") or {}).get("limits") or {}).get("incomplete")),
        "limits": (extras.get("draft") or {}).get("limits"),
    }
