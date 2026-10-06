"""FastAPI tətbiqi — "Biznes Plan qiymətləndirmə komitəsi".

Fayl qəbul olunur, yoxlama SQLite-da qeyd edilir və fon tapşırığı kimi icra
olunur (`service.run_check` -> `graph.py`). Frontend `GET /api/checks/{id}` ilə
vəziyyəti izləyir.
"""
from __future__ import annotations

import re
import threading
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from fastapi import BackgroundTasks, FastAPI, File, Form, HTTPException, UploadFile, Query
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from app import attachments, chat, config, evidence, market, service, storage

#: İcra addımlarının istifadəçiyə göstərilən adları (qraf qovşaqlarına uyğun).
STEP_LABELS: dict[str, str] = {
    "ingest": "Sənəd oxunur",
    "load_previous": "Əvvəlki versiya yoxlanılır",
    "finance": "Maliyyə yoxlamaları aparılır",
    "compliance": "Tələblər yoxlanılır",
    "decide_status": "Yekun status müəyyən edilir",
    "compare_previous": "Versiyalar müqayisə olunur",
    "write_summary": "Komitə rəyi hazırlanır",
    "save": "Nəticə saxlanılır",
}

VERDICT_LABELS: dict[str, str] = {
    "hazir": "Təqdimata hazırdır",
    "duzelis": "Düzəliş lazımdır",
    "hazir_deyil": "Hazır deyil",
    "giris_xetasi": "Fayl oxunmadı",
}

RUN_STATE_LABELS: dict[str, str] = {
    "telebler_hazirlanir": "Əlavə tələblər hazırlanır",
    "tesdiq_gozleyir": "Tələblərin təsdiqini gözləyir",
    "gozleyir": "Gözləyir",
    "isleyir": "İşləyir",
    "tamamlandi": "Tamamlandı",
    "xeta": "Xəta",
}


#: Test rejimi: seçilmiş addımda BİR dəfəlik süni xəta.
FAIL_AT_OPTIONS: list[dict[str, str]] = [
    {"id": "", "label": "Xəta yoxdur"},
    {"id": "finance", "label": "Maliyyə agentində süni xəta"},
    {"id": "compliance", "label": "Uyğunluq agentində süni xəta"},
    {"id": "write_summary", "label": "Yekun rəydə süni xəta (ehtiyat rəy)"},
]


@asynccontextmanager
async def lifespan(_app: FastAPI):
    config.ensure_dirs()
    storage.init()
    service.graph()  # qraf bir dəfə qurulur
    # Köhnə qaydalarla qurulmuş hesabatlar yenidən qiymətləndirilir (model çağırılmır).
    threading.Thread(target=service.apply_rules_to_all, name="qaydalar", daemon=True).start()
    if config.MARKET_ENABLED:
        # Bazar keşi fonda doldurulur — ilk istifadəçi gözləməsin; xəta tətbiqə təsir etmir.
        threading.Thread(target=_warm_market, name="bazar-keşi", daemon=True).start()
    yield


def _warm_market() -> None:
    try:
        market.overview()
    except Exception:                      # köməkçi işdir — heç bir xəta yuxarı qalxmır
        pass


app = FastAPI(title="Biznes Plan qiymətləndirmə komitəsi", lifespan=lifespan)


# ── Köməkçilər ─────────────────────────────────────────────────────────────

def _bad_request(message: str) -> HTTPException:
    return HTTPException(status_code=400, detail=message)


# ── Gövdə həddi (multipart təhlilindən ƏVVƏL) ──────────────────────────────

def request_body_limit(path: str) -> int:
    """Sorğu gövdəsinin yuxarı həddi: yükləmə üçün bütün limitlərin cəmi + multipart başlıqları."""
    if path == "/api/checks":
        return (config.MAX_UPLOAD_BYTES + attachments.MAX_TOTAL_BYTES
                + 4 * attachments.MAX_EXTRA_TEXT + 1024 * 1024)
        # 4 × — UTF-8-də bir simvol 4 bayta qədər; 1 MB — sahə adları və sərhədlər
    if path.startswith("/api/checks/") and path.endswith("/evidence"):
        from app.economics.evidence import MAX_BYTES
        return MAX_BYTES + 1024 * 1024
    return config.MAX_JSON_BODY_BYTES


class BodyLimitMiddleware:
    """Gövdənin HƏQİQƏTƏN gələn baytlarını sayır və hədd aşılan kimi oxumanı kəsir (413).

    Niyə lazımdır: Starlette multipart gövdəni endpoint işə düşməzdən ƏVVƏL tam
    təhlil edir (faylları müvəqqəti fayla yazır). Endpoint-dəki limitlər bundan
    sonra işləyir. Bu qat isə baytlar gəldikcə sayır.
    `Content-Length`-ə etibar edilmir: o yalnız açıq-aşkar böyük sorğunu oxumadan
    rədd etmək üçün işlədilir; kiçik göstərilib böyük göndərilən gövdə də sayılaraq kəsilir.
    Xəta zamanı Starlette yarımçıq müvəqqəti faylları özü bağlayır (silir).
    """

    def __init__(self, app: Any) -> None:
        self.app = app

    async def __call__(self, scope: dict, receive: Any, send: Any) -> None:
        if scope["type"] != "http" or scope["method"] not in ("POST", "PUT", "PATCH"):
            await self.app(scope, receive, send)
            return
        limit = request_body_limit(scope["path"])
        too_big = HTTPException(
            status_code=413,
            detail=f"Sorğu çox böyükdür. Ümumi hədd: {limit / 1024 / 1024:.0f} MB.")
        declared = dict(scope.get("headers") or []).get(b"content-length")
        if declared and declared.isdigit() and int(declared) > limit:
            response = JSONResponse({"detail": too_big.detail}, status_code=413)
            await response(scope, receive, send)
            return
        seen = 0

        async def counted() -> dict:
            nonlocal seen
            message = await receive()
            if message["type"] == "http.request":
                seen += len(message.get("body", b""))
                if seen > limit:
                    raise too_big
            return message

        await self.app(scope, counted, send)


async def _read_capped(upload: UploadFile, cap: int) -> tuple[bytes, bool]:
    """Faylı hissə-hissə oxuyur; `cap`-dən çox olarsa oxumanı dayandırır.

    Qaytarır: (məlumat, hədd_aşıldı). Hədd aşılanda məlumat `cap + 1` baytla kəsilir —
    bütöv fayl yaddaşa yığılmır. Ölçü `Content-Length`-dən yox, oxunan baytlardan sayılır.
    """
    parts: list[bytes] = []
    size = 0
    while True:
        # Həddən ən çoxu 1 bayt artıq oxunur — aşıldığını bilmək üçün kifayətdir.
        chunk = await upload.read(min(config.UPLOAD_CHUNK_BYTES, cap + 1 - size))
        if not chunk:
            return b"".join(parts), False
        size += len(chunk)
        parts.append(chunk)
        if size > cap:
            return b"".join(parts), True


async def _close_all(uploads: list[UploadFile]) -> None:
    for upload in uploads:
        try:
            await upload.close()               # müvəqqəti fayl silinir
        except Exception:                      # bağlanma xətası cavabı dəyişməməlidir
            pass


def _public(check: dict[str, Any]) -> dict[str, Any]:
    """Yoxlamanın istifadəçiyə göstərilən hissəsi — `fail_at` göstərilmir."""
    return {
        "id": check["id"],
        "plan_id": check["plan_id"],
        "plan_name": check.get("plan_name") or check["plan_id"],
        "version": check["version"],
        "file_name": check["file_name"],
        "created_at": check["created_at"],
        "run_state": check["run_state"],
        "run_state_label": RUN_STATE_LABELS.get(check["run_state"], check["run_state"]),
        "current_step": check["current_step"],
        "verdict": check["verdict"],
        "verdict_label": VERDICT_LABELS.get(check["verdict"] or "", ""),
        "error": check["error"],
        "result": check["result"],
        # Mərhələ göstəricisi üçün: əlavə tələb sənədi var idimi ("Tələblər" addımı ötürülübmü).
        "has_extras": storage.extras_get(check["id"]) is not None,
    }


# ── API ────────────────────────────────────────────────────────────────────

def _facts() -> dict[str, int]:
    from app.agents.compliance import all_groups
    from app.economics.rules import INTERNAL_RULES
    from app.economics.scenario import SCENARIOS
    from app.finance_tools import RULES
    groups = all_groups()
    items = [i for g in groups for i in g["items"]]
    document_only = sum(1 for i in items if i.get("kind") == "sened")
    return {"requirements": len(items), "in_plan": len(items) - document_only, "document_only": document_only,
            "groups": len(groups), "finance_checks": len(RULES),
            # İqtisadi təhlil: daxili uyğunluq qaydaları və həssaslıq ssenariləri (kodda nə varsa — o qədər).
            "economics_checks": len(INTERNAL_RULES), "scenarios": len(SCENARIOS)}


def _requirement_groups() -> list[dict[str, Any]]:
    from app.agents.compliance import all_groups
    return [{"id": g["id"], "title": g["title"], "items": len(g["items"])} for g in all_groups()]


@app.get("/api/meta")
async def meta() -> dict[str, Any]:
    """Frontend üçün sabitlər: məhdudiyyətlər, addım və status adları."""
    return {
        "max_upload_bytes": config.MAX_UPLOAD_BYTES,
        "max_upload_mb": config.MAX_UPLOAD_BYTES // (1024 * 1024),
        "allowed_suffix": config.ALLOWED_SUFFIX,
        "plan_id_pattern": config.PLAN_ID_PATTERN,
        # Yalnız REAL icra olunan addımlar göstərilir.
        "steps": [{"id": s, "label": STEP_LABELS[s]} for s in service.ACTIVE_STEPS],
        "verdicts": VERDICT_LABELS,
        "attachments": attachments.limits(),
        "dev_mode": config.DEV_MODE,
        "fail_at_options": FAIL_AT_OPTIONS if config.DEV_MODE else [],
        # Yükləmə ekranındakı faktlar — sayılar konfiqurasiyadan gəlir, uydurulmur.
        "facts": _facts(),
        # Hesabatın düzəliş siyahısı üçün: tələbin qısa mövzusu və konkret düzəliş mətni.
        "requirements": _requirement_texts(),
        "economics": _economics_meta(),
        # Gedişat ekranında təxmini qalan vaxt: son tamamlanmış yoxlamaların median müddəti (yoxdursa None).
        "typical_run_seconds": storage.typical_run_seconds(),
        # Gedişat ekranı: tələb qrupları (hələ başlamamış qruplar da görünsün).
        "requirement_groups": _requirement_groups(),
    }


def _economics_meta() -> dict[str, Any]:
    from app.economics.catalog import DOCUMENTS
    from app.economics.questions import STATUS_LABELS
    from app.economics.evidence import MAX_BYTES
    return {"documents": DOCUMENTS, "question_statuses": STATUS_LABELS,
            "evidence_formats": ["XLSX", "PDF", "DOCX", "JPG", "PNG"], "evidence_max_mb": MAX_BYTES // (1024 * 1024),
            "auto": config.ECONOMICS_AUTO}


def _requirement_texts() -> dict[str, dict[str, str]]:
    from app.agents.compliance import all_groups
    return {item["id"]: {"topic": item.get("topic") or "", "action": item.get("action") or ""}
            for group in all_groups() for item in group["items"]}


@app.post("/api/checks")
async def create_check(
    background: BackgroundTasks,
    file: UploadFile,
    plan_id: str = Form(""),
    plan_name: str = Form(""),
    existing_plan_id: str = Form(""),
    fail_at: str = Form(""),
    extra_files: list[UploadFile] | None = File(None),
    extra_text: str = Form(""),
) -> dict[str, Any]:
    """Yeni yoxlama yaradır.

    Əlavə tələb sənədi (və ya mətni) YOXDURSA — yoxlama dərhal fonda başlayır.
    VARSA — əvvəl tələblər çıxarılır və yoxlama istifadəçinin təsdiqini gözləyir
    (`needs_review=True`); tam yoxlama yalnız təsdiqdən sonra başlayır.
    """
    all_uploads = [file, *(extra_files or [])]
    try:
        return await _create_check(background, file, plan_name or plan_id, existing_plan_id, fail_at,
                                   [f for f in (extra_files or []) if f.filename], extra_text or "")
    finally:
        await _close_all(all_uploads)


async def _create_check(background: BackgroundTasks, file: UploadFile, plan_name: str, existing_plan_id: str,
                        fail_at: str,
                        extra_files: list[UploadFile], extra_text: str) -> dict[str, Any]:
    """Ardıcıllıq: ucuz yoxlamalar → fayllar hissə-hissə (limitlə) → saxlama → qeyd.

    Qeyd (`storage.create`) yalnız bütün yoxlamalardan sonra yaradılır; ondan əvvəlki
    hər hansı xətada diskə yazılmış fayllar silinir — yarımçıq yoxlama qalmır.
    """
    # Plan seçimi AÇIQDIR: ad uyğunluğu heç vaxt avtomatik versiya yaratmır.
    existing_plan_id = (existing_plan_id or "").strip()
    if existing_plan_id:
        if not storage.plan_exists(existing_plan_id):
            raise _bad_request("Seçilmiş plan tapılmadı. Siyahını yeniləyib yenidən seçin.")
        plan_id, plan_name = existing_plan_id, storage.plan_name_of(existing_plan_id)
    else:
        plan_name = (plan_name or "").strip()
        plan_id = ""
    if not existing_plan_id and not re.match(config.PLAN_ID_PATTERN, plan_name):
        raise _bad_request(
            "Plan adı düzgün deyil. 1–60 simvol olmalı; hərf, rəqəm, boşluq, "
            "nöqtə, tire və alt xətt işlədə bilərsiniz."
        )

    name = file.filename or ""
    if not name.lower().endswith(config.ALLOWED_SUFFIX):
        raise _bad_request("Yalnız .docx faylı qəbul edilir.")

    allowed_fail = {o["id"] for o in FAIL_AT_OPTIONS}
    if fail_at not in allowed_fail:
        raise _bad_request("Test rejimində yanlış seçim.")
    if fail_at and not config.DEV_MODE:
        raise _bad_request("Süni xəta yalnız inkişaf rejimində (DEV_MODE=1) mümkündür.")
    # Sayı və mətn uzunluğu — heç bir faylı oxumadan.
    if len(extra_files) > attachments.MAX_FILES:
        raise _bad_request(f"Ən çoxu {attachments.MAX_FILES} əlavə fayl yükləmək olar.")
    if len(extra_text) > attachments.MAX_EXTRA_TEXT:
        raise _bad_request(f"Əlavə tələb mətni {attachments.MAX_EXTRA_TEXT} simvoldan uzun ola bilməz.")

    content, over = await _read_capped(file, config.MAX_UPLOAD_BYTES)
    if over:
        raise _bad_request(f"Fayl çox böyükdür. Yuxarı hədd: {config.MAX_UPLOAD_BYTES // 1024 // 1024} MB.")
    if not content:
        raise _bad_request("Fayl boşdur.")

    uploads: list[tuple[str, bytes]] = []
    total = 0
    for upload in extra_files:
        # Oxuma həddi = min(tək fayl həddi, ümumi həddə qalan). Tək fayl həddi aşılırsa
        # fayl siyahıda "xəta" kimi qalır (accept); ümumi hədd aşılırsa sorğu rədd edilir.
        remaining = attachments.MAX_TOTAL_BYTES - total
        data, over = await _read_capped(upload, min(attachments.MAX_FILE_BYTES, remaining))
        total += len(data)
        if over and remaining <= attachments.MAX_FILE_BYTES:
            raise _bad_request(f"Əlavə faylların ümumi həcmi {attachments.MAX_TOTAL_BYTES // (1024 * 1024)} "
                               f"MB-dan çox ola bilməz.")
        uploads.append((upload.filename or "", data))

    written: list[Path] = []
    check_id = ""
    try:
        records = attachments.accept(uploads, extra_text) if (uploads or extra_text.strip()) else []
        written += [attachments.attachments_dir() / r["stored"] for r in records if r.get("stored")]
        config.ensure_dirs()
        new_id = uuid.uuid4().hex[:12]
        stored = config.UPLOAD_DIR / f"{new_id}.docx"
        stored.write_bytes(content)
        written.append(stored)
        plan_id = plan_id or storage.new_plan_id()
        version = storage.next_version(plan_id)
        storage.create(new_id, plan_id, version, Path(name).name, str(stored), fail_at,
                       run_state="telebler_hazirlanir" if records else "gozleyir", plan_name=plan_name)
        check_id = new_id
        if records:
            storage.extras_create(check_id, records)
    except attachments.AttachmentError as exc:
        _discard(written)
        raise _bad_request(str(exc)) from exc
    except BaseException:
        if check_id:
            storage.discard(check_id)
        _discard(written)
        raise

    if records:
        background.add_task(service.extract_requirements, check_id)
    else:
        background.add_task(service.run_check, check_id)

    return {"check_id": check_id, "plan_id": plan_id, "plan_name": plan_name, "version": version,
            "needs_review": bool(records)}


def _discard(paths: list[Path]) -> None:
    """Uğursuz yükləmədə diskə yazılmış faylları silir."""
    for path in paths:
        path.unlink(missing_ok=True)


# ── Əlavə tələblər: baxış və təsdiq ────────────────────────────────────────

def _extras_or_404(check_id: str) -> tuple[dict[str, Any], dict[str, Any]]:
    check = storage.get(check_id)
    if check is None:
        raise HTTPException(status_code=404, detail="Yoxlama tapılmadı.")
    extras = storage.extras_get(check_id)
    if extras is None:
        raise HTTPException(status_code=404, detail="Bu yoxlamada əlavə tələb sənədi yoxdur.")
    return check, extras


@app.get("/api/checks/{check_id}/requirements")
async def get_requirements(check_id: str) -> dict[str, Any]:
    """Əlavə sənədlər, model qaralaması (rədd edilənlərlə) və təsdiqlənmiş siyahı."""
    check, extras = _extras_or_404(check_id)
    return {
        "check_id": check_id,
        "run_state": check["run_state"],
        "run_state_label": RUN_STATE_LABELS.get(check["run_state"], check["run_state"]),
        "error": check["error"],
        "attachments": [attachments.public(a) for a in extras["attachments"]],
        "draft": extras.get("draft"),
        "confirmed": extras.get("confirmed"),
        "list_version": extras.get("list_version"),
        "confirmed_at": extras.get("confirmed_at"),
    }


def _require_review_state(check: dict[str, Any]) -> None:
    if check["run_state"] != "tesdiq_gozleyir":
        raise HTTPException(
            status_code=409,
            detail="Tələb siyahısı yalnız təsdiqdən əvvəl dəyişdirilə bilər. Cari vəziyyət: "
                   f"{RUN_STATE_LABELS.get(check['run_state'], check['run_state'])}.",
        )


@app.post("/api/checks/{check_id}/requirements/extract")
async def reextract_requirements(check_id: str, background: BackgroundTasks) -> dict[str, Any]:
    """Tələbləri yenidən çıxarır (məsələn, model xətasından sonra)."""
    check, _extras = _extras_or_404(check_id)
    _require_review_state(check)
    storage.update(check_id, run_state="telebler_hazirlanir", error=None)
    background.add_task(service.extract_requirements, check_id)
    return {"check_id": check_id}


@app.post("/api/checks/{check_id}/requirements")
async def confirm_requirements(check_id: str, payload: dict[str, Any],
                               background: BackgroundTasks) -> dict[str, Any]:
    """İstifadəçinin redaktə etdiyi siyahını təsdiqləyir və tam yoxlamanı başladır."""
    check, _extras = _extras_or_404(check_id)
    _require_review_state(check)
    items = payload.get("items")
    if not isinstance(items, list) or not all(isinstance(i, dict) for i in items):
        raise _bad_request("Gözlənilən forma: {\"items\": [{\"id\", \"text\", \"kind\"}, ...]}.")
    try:
        confirmed = service.confirm_requirements(
            check_id, items, acknowledge_incomplete=bool(payload.get("acknowledge_incomplete")))
    except service.RequirementsError as exc:
        raise _bad_request(str(exc)) from exc
    background.add_task(service.run_check, check_id)
    return {"check_id": check_id, "count": len(confirmed["items"]),
            "list_version": confirmed["list_version"]}


@app.get("/api/checks/{check_id}")
async def get_check(check_id: str) -> dict[str, Any]:
    check = service.apply_current_rules(storage.get(check_id))
    if check is None:
        raise HTTPException(status_code=404, detail="Yoxlama tapılmadı.")
    return _public(check)


@app.post("/api/checks/{check_id}/retry")
async def retry_check(check_id: str, background: BackgroundTasks) -> dict[str, Any]:
    """Xəta ilə dayanmış yoxlamanı davam etdirir. Yeni versiya yaradılmır."""
    check = storage.get(check_id)
    if check is None:
        raise HTTPException(status_code=404, detail="Yoxlama tapılmadı.")
    if check["run_state"] != "xeta":
        raise HTTPException(
            status_code=409,
            detail="Yalnız xəta ilə dayanmış yoxlamanı davam etdirmək olar. "
                   f"Cari vəziyyət: {RUN_STATE_LABELS.get(check['run_state'], '?')}.",
        )
    storage.update(check_id, run_state="gozleyir", error=None)
    background.add_task(service.run_check, check_id, True)
    return {"check_id": check_id, "resumed": True}


@app.get("/api/checks/{check_id}/section")
async def get_section_text(check_id: str, title: str) -> dict[str, Any]:
    """Bölmənin tam mətni — dəlil panelindəki "Tam bölməni göstər" üçün."""
    if storage.get(check_id) is None:
        raise HTTPException(status_code=404, detail="Yoxlama tapılmadı.")
    doc = storage.doc_get(check_id)
    if doc is None:
        raise HTTPException(status_code=404,
                            detail="Bu yoxlama üçün sənədin mətni saxlanmayıb (köhnə yoxlama).")
    found = evidence.section_text(doc, title)
    if found is None:
        raise HTTPException(status_code=404, detail="Belə bölmə tapılmadı.")
    return found


@app.get("/api/checks/{check_id}/compare")
async def compare_versions(check_id: str, with_: str = Query(..., alias="with")) -> dict[str, Any]:
    """Eyni planın istənilən iki tamamlanmış versiyası — CARİ statuslarla (yenidən hesablanmış verdict).
    Köhnə versiya həmişə "əvvəl", yenisi "sonra" kimi götürülür. Saxlanmış müqayisədən fərqli olaraq
    köhnəlmiş status göstərilmir."""
    from app import compare as cmp
    a, b = storage.get(check_id), storage.get(with_)
    if a is None or b is None:
        raise HTTPException(status_code=404, detail="Yoxlama tapılmadı.")
    if a["id"] == b["id"]:
        raise _bad_request("Eyni versiya ilə müqayisə olunmur.")
    if a["plan_id"] != b["plan_id"]:
        raise _bad_request("Versiyalar eyni plana aid deyil.")
    if a.get("run_state") != "tamamlandi" or b.get("run_state") != "tamamlandi":
        raise _bad_request("Hər iki versiyanın yoxlaması tamamlanmalıdır.")
    old, new = sorted((a, b), key=lambda c: c["version"])
    out = cmp.compare(cmp.snapshot(old.get("result"), old), cmp.snapshot(new.get("result"), new))
    out["current"] = {k: new.get(k) for k in ("id", "version", "file_name", "created_at", "verdict")}
    return out


@app.get("/api/checks/{check_id}/doc")
async def get_document(check_id: str) -> dict[str, Any]:
    """Sənədin strukturu (bölmələr, paraqraflar, cədvəllər) — sənəd görüntüsü drawer-i və mini-xəritə üçün.
    Yalnız oxuma; mətn yükləmə zamanı saxlanandır, model çağırılmır."""
    if storage.get(check_id) is None:
        raise HTTPException(status_code=404, detail="Yoxlama tapılmadı.")
    doc = storage.doc_get(check_id)
    if doc is None:
        raise HTTPException(status_code=404,
                            detail="Bu yoxlama üçün sənədin mətni saxlanmayıb (köhnə yoxlama).")
    return {
        "sections": [{"id": s["id"], "level": s.get("level", 1), "title": s["title"],
                      "paragraphs": s.get("paragraphs", []), "table_ids": s.get("table_ids", [])}
                     for s in doc["sections"]],
        "tables": [{"id": t["id"], "section_id": t.get("section_id"), "caption": t.get("caption"), "rows": t.get("rows", [])}
                   for t in doc.get("tables", [])],
    }


@app.get("/api/checks/{check_id}/events")
async def get_events(check_id: str, after: int = 0) -> dict[str, Any]:
    """Agent fəaliyyəti — artımlı: yalnız `after` id-sindən sonrakı hadisələr.

    Alət adları, qısa arqumentlər, qısa nəticələr, müddət və status; modelin
    mətni və daxili düşüncəsi YOXDUR.
    """
    if storage.get(check_id) is None:
        raise HTTPException(status_code=404, detail="Yoxlama tapılmadı.")
    events = storage.events_list(check_id, after=max(0, after))
    return {"check_id": check_id, "events": events,
            "last_id": events[-1]["id"] if events else after}


@app.post("/api/checks/{check_id}/retry-groups")
async def retry_failed_groups(check_id: str, background: BackgroundTasks) -> dict[str, Any]:
    """Texniki xəta ilə yıxılan uyğunluq qruplarını yenidən yoxlayır.

    Uğurlu qrupların nəticəsi saxlanılır; yeni versiya yaradılmır.
    """
    check = storage.get(check_id)
    if check is None:
        raise HTTPException(status_code=404, detail="Yoxlama tapılmadı.")
    groups = service.failed_groups(check)
    if check["run_state"] != "tamamlandi" or not groups:
        raise HTTPException(
            status_code=409,
            detail="Təkrar yoxlanacaq uğursuz tələb qrupu yoxdur "
                   "(yalnız tamamlanmış yoxlamada texniki xəta olan qruplar təkrarlanır).",
        )
    storage.update(check_id, run_state="gozleyir", error=None)
    background.add_task(service.retry_failed_groups, check_id)
    return {"check_id": check_id, "groups": [g["group_id"] for g in groups]}


# ── Bazar icmalı və AI köməkçi ─────────────────────────────────────────────

# ── İqtisadi təhlil, suallar və sənədlər ───────────────────────────────────

def _check_or_404(check_id: str) -> dict[str, Any]:
    check = storage.get(check_id)
    if check is None:
        raise HTTPException(status_code=404, detail="Yoxlama tapılmadı.")
    return check


@app.get("/api/checks/{check_id}/economics")
async def get_economics(check_id: str) -> dict[str, Any]:
    from app.economics import service as economics
    _check_or_404(check_id)
    return economics.view(check_id)


@app.post("/api/checks/{check_id}/economics")
async def run_economics(check_id: str, background: BackgroundTasks, fresh: bool = False) -> dict[str, Any]:
    """İqtisadi təhlili başladır və ya yenidən hesablayır. Yerlər yaddaşdadırsa model ÇAĞIRILMIR;
    `fresh=1` — yaddaş silinir və model sənədi yenidən oxuyur (bir model çağırışı)."""
    from app.economics import extract
    from app.economics import service as economics
    check = _check_or_404(check_id)
    reason = economics.ready(check)
    if reason:
        raise HTTPException(status_code=409, detail=reason)
    if (storage.econ_get(check_id) or {}).get("state") == "isleyir":
        raise HTTPException(status_code=409, detail="İqtisadi təhlil artıq hesablanır.")
    if fresh:
        storage.memo_delete(check_id, extract.MEMO_KEY)
    economics.mark_started(check_id)
    background.add_task(economics.run, check_id)
    return {"check_id": check_id, "state": "isleyir"}


@app.post("/api/checks/{check_id}/questions")
async def add_question(check_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    from app.economics import questions
    check = _check_or_404(check_id)
    try:
        return questions.add(check, str(payload.get("text") or ""), payload.get("documents"))
    except ValueError as exc:
        raise _bad_request(str(exc)) from exc


@app.patch("/api/questions/{question_id}")
async def update_question(question_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    from app.economics import questions
    allowed = {k: payload[k] for k in ("text", "status", "documents", "note", "decided_by") if k in payload}
    try:
        return questions.update(question_id, allowed)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Sual tapılmadı.") from exc
    except ValueError as exc:
        raise _bad_request(str(exc)) from exc


@app.delete("/api/questions/{question_id}")
async def delete_question(question_id: str) -> dict[str, Any]:
    if not storage.question_delete(question_id):
        raise HTTPException(status_code=404, detail="Sual tapılmadı.")
    return {"deleted": question_id}


def _letter_ids(ids: str | None) -> list[str] | None:
    """`?ids=a,b,c` — məktuba daxil ediləcək suallar; verilməsə — bütün açıq suallar."""
    return [x for x in (ids or "").split(",") if x] if ids is not None else None


@app.get("/api/checks/{check_id}/questions/letter")
async def question_letter_preview(check_id: str, ids: str | None = None) -> dict[str, Any]:
    """Məktubun önizləməsi (A4) — .docx ilə eyni mətn (questions.letter_content)."""
    from app.economics import questions
    from app.economics.service import _company
    check = _check_or_404(check_id)
    facts = (storage.econ_get(check_id) or {}).get("facts")
    return questions.letter_content(check, storage.questions_list(check_id), _company(check, facts) or None,
                                    _letter_ids(ids))


@app.get("/api/checks/{check_id}/questions/letter.docx")
async def question_letter(check_id: str, ids: str | None = None) -> Any:
    from fastapi.responses import Response

    from app.economics import questions
    from app.economics.service import _company
    check = _check_or_404(check_id)
    facts = (storage.econ_get(check_id) or {}).get("facts")
    data = questions.letter_docx(check, storage.questions_list(check_id), _company(check, facts) or None,
                                 _letter_ids(ids))
    name = f"suallar-{check['plan_id']}-v{check['version']}.docx"
    return Response(data, media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                    headers={"Content-Disposition": f'attachment; filename="{name}"'})


@app.post("/api/checks/{check_id}/evidence")
async def upload_evidence(check_id: str, background: BackgroundTasks, file: UploadFile = File(...),
                          question_id: str = Form(""), req_code: str = Form(""),
                          doc_type: str = Form("")) -> dict[str, Any]:
    """Əlavə sənəd (XLSX, PDF, DOCX, JPG, PNG) — suala, tələbə və ya ümumi plana bağlanır."""
    from app.economics import evidence as econ_evidence
    from app.economics import service as economics
    _check_or_404(check_id)
    data, over = await _read_capped(file, econ_evidence.MAX_BYTES)
    if over:
        raise _bad_request(f"Fayl çox böyükdür. Yuxarı hədd: {econ_evidence.MAX_BYTES // 1024 // 1024} MB.")
    try:
        item = economics.add_evidence(check_id, file.filename or "fayl", data, question_id or None,
                                      req_code or None, doc_type or None)
    except (economics.EconomicsError, econ_evidence.EvidenceError) as exc:
        raise _bad_request(str(exc)) from exc
    background.add_task(economics.analyze_evidence, item["id"])
    return {k: v for k, v in item.items() if k != "stored"}


@app.delete("/api/evidence/{evidence_id}")
async def delete_evidence(evidence_id: str) -> dict[str, Any]:
    from app.economics import service as economics
    if not economics.remove_evidence(evidence_id):
        raise HTTPException(status_code=404, detail="Sənəd tapılmadı.")
    return {"deleted": evidence_id}


@app.get("/api/market")
def get_market() -> dict[str, Any]:
    """Valyuta, səhm/əmtəə və xəbərlər — keşlə; mənbə xətası sənəd yoxlamasına təsir etmir."""
    return market.overview()


@app.get("/api/chat/status")
def chat_status() -> dict[str, Any]:
    """Model qoşulubmu (açarın özü qaytarılmır)."""
    return chat.status()


@app.post("/api/chat")
async def chat_reply(payload: dict[str, Any]) -> dict[str, Any]:
    """AI köməkçi: kontekst serverdə check ID-yə görə qurulur."""
    try:
        return await chat.reply(payload)
    except chat.ChatError as exc:
        raise HTTPException(status_code=exc.status, detail=exc.message) from None


@app.get("/api/plans")
async def list_plans() -> list[dict[str, Any]]:
    return storage.list_plans()


@app.delete("/api/plans/{plan_id}")
def delete_plan(plan_id: str) -> dict[str, Any]:
    """Planı bütün versiyaları ilə birdəfəlik silir (interfeysdə təsdiqdən sonra)."""
    try:
        return service.delete_plan(plan_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="Plan tapılmadı. Siyahını yeniləyin.") from None
    except service.PlanBusy:
        raise HTTPException(status_code=409, detail="Bu planın yoxlaması hələ gedir. "
                                                    "Yoxlama bitəndən sonra silin.") from None


@app.get("/api/plans/{plan_id}/checks")
async def list_plan_checks(plan_id: str) -> list[dict[str, Any]]:
    checks = storage.list_checks(plan_id)
    for check in checks:
        check["verdict_label"] = VERDICT_LABELS.get(check["verdict"] or "", "")
        check["run_state_label"] = RUN_STATE_LABELS.get(check["run_state"], check["run_state"])
    return checks


# ── Statik fayllar ─────────────────────────────────────────────────────────

class RevalidatedStaticFiles(StaticFiles):
    """Brauzer hər dəfə ETag ilə yoxlayır (dəyişməyibsə 304). Başlıq olmadan Chrome JS-i evristik
    keşləyir: yeni index.html köhnə app.js ilə işləyir və silinmiş elementə görə səhifə çökür."""

    async def get_response(self, path: str, scope: Any) -> Any:
        response = await super().get_response(path, scope)
        response.headers["Cache-Control"] = "no-cache"
        return response


app.mount("/static", RevalidatedStaticFiles(directory=str(config.STATIC_DIR)), name="static")


@app.get("/")
async def index(ui: str | None = None) -> Any:
    # ?ui=kitchen-sink — komponent kitabxanasının vitrini (dev; vizual reqressiya testlərinin əsası).
    page = config.STATIC_DIR / ("kitchen-sink.html" if ui == "kitchen-sink" else "index.html")
    if not page.exists():
        return JSONResponse({"detail": "index.html tapılmadı."}, status_code=404)
    return FileResponse(page, headers={"Cache-Control": "no-cache"})


# Gövdə həddi bütün marşrutlardan əvvəl işləyir (yuxarıda təyin olunub).
app.add_middleware(BodyLimitMiddleware)
