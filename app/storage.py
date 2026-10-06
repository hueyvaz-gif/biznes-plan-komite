"""Yoxlamaların SQLite-da saxlanması.

İki işi görür:
  • UI üçün cari vəziyyət (run_state, current_step, verdict);
  • uzunmüddətli yaddaş — eyni plan_id-nin əvvəlki tamamlanmış nəticəsi.

Bütün yazı əməliyyatları bir lock altındadır: fon tapşırığı və HTTP sorğusu
eyni anda yazа bilər.
"""
from __future__ import annotations

import json
import sqlite3
import threading
import uuid
from datetime import datetime, timezone
from typing import Any

from app import config

_LOCK = threading.Lock()

SCHEMA = """
CREATE TABLE IF NOT EXISTS checks (
    id           TEXT PRIMARY KEY,
    plan_id      TEXT NOT NULL,
    version      INTEGER NOT NULL,
    file_name    TEXT NOT NULL,
    file_path    TEXT NOT NULL,
    created_at   TEXT NOT NULL,
    run_state    TEXT NOT NULL,
    current_step TEXT,
    verdict      TEXT,
    error        TEXT,
    fail_at      TEXT,
    result_json  TEXT
);
CREATE INDEX IF NOT EXISTS idx_checks_plan ON checks(plan_id, version);
-- Uğurlu model çağırışlarının nəticəsi (maliyyə çıxarışı, uyğunluq qrupu).
-- Qovşaq ortada yıxılsa və ya server yenidən başlasa, uğurlu çağırış
-- TƏKRARLANMIR — retry yalnız çatışmayan hissəni modelə soruşur.
-- Əlavə tələb sənədləri: faylların izi, model qaralaması və istifadəçinin
-- TƏSDİQLƏDİYİ siyahı (versiyası ilə). Retry təsdiqlənmiş siyahını işlədir,
-- modelə yenidən yaratdırmır. Köhnə yoxlamalarda sətir yoxdur — onlar olduğu
-- kimi açılır.
CREATE TABLE IF NOT EXISTS extras (
    check_id         TEXT PRIMARY KEY,
    attachments_json TEXT NOT NULL,
    draft_json       TEXT,
    confirmed_json   TEXT,
    list_version     TEXT,
    confirmed_at     TEXT
);
-- Agent fəaliyyəti: qovşaqlar, alət çağırışları, LLM çağırışları (mətn SAXLANILMIR).
CREATE TABLE IF NOT EXISTS events (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    check_id    TEXT NOT NULL,
    attempt     INTEGER NOT NULL,
    ts          REAL NOT NULL,
    agent       TEXT,
    grp         TEXT,
    kind        TEXT NOT NULL,
    name        TEXT,
    args        TEXT,
    summary     TEXT,
    status      TEXT,
    duration_ms INTEGER
);
CREATE INDEX IF NOT EXISTS idx_events_check ON events(check_id, id);
CREATE TABLE IF NOT EXISTS memo (
    check_id   TEXT NOT NULL,
    key        TEXT NOT NULL,
    value_json TEXT NOT NULL,
    PRIMARY KEY (check_id, key)
);
-- İqtisadi təhlil: uyğunluq statusundan AYRI nəticə. `facts_json` — təsdiqlənmiş faktlar (sənəd yüklənəndə
-- qaydalar modeli çağırmadan yenidən hesablanır), `history_json` — "əvvəl/sonra" qeydləri.
CREATE TABLE IF NOT EXISTS economics (
    check_id     TEXT PRIMARY KEY,
    state        TEXT NOT NULL,
    error        TEXT,
    facts_json   TEXT,
    result_json  TEXT,
    history_json TEXT,
    updated_at   TEXT NOT NULL
);
-- Ərizəçiyə suallar: qaydadan (origin=qayda) və ya komitə üzvündən (origin=komite).
CREATE TABLE IF NOT EXISTS questions (
    id             TEXT PRIMARY KEY,
    check_id       TEXT NOT NULL,
    plan_id        TEXT NOT NULL,
    finding_id     TEXT,
    origin         TEXT NOT NULL,
    text           TEXT NOT NULL,
    documents_json TEXT NOT NULL,
    severity       TEXT,
    status         TEXT NOT NULL,
    note           TEXT,
    decided_by     TEXT,
    edited         INTEGER NOT NULL DEFAULT 0,
    stale          INTEGER NOT NULL DEFAULT 0,
    position       INTEGER NOT NULL DEFAULT 0,
    created_at     TEXT NOT NULL,
    updated_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_questions_check ON questions(check_id, position);
-- Əlavə sənədlər (təklif, niyyət məktubu, Excel modeli, şəkil) — yoxlamanın versiyasına bağlıdır.
CREATE TABLE IF NOT EXISTS evidence (
    id            TEXT PRIMARY KEY,
    check_id      TEXT NOT NULL,
    plan_id       TEXT NOT NULL,
    question_id   TEXT,
    req_code      TEXT,
    doc_type      TEXT,
    kind          TEXT NOT NULL,
    file_name     TEXT NOT NULL,
    stored        TEXT NOT NULL,
    size          INTEGER NOT NULL,
    analysis_json TEXT,
    uploaded_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_evidence_check ON evidence(check_id);
"""

#: Hələ bitməmiş sayılan vəziyyətlər.
RUNNING_STATES = ("gozleyir", "isleyir")
#: Arxa fonda iş gedən vəziyyətlər — bu zaman plan silinmir.
BUSY_STATES = (*RUNNING_STATES, "telebler_hazirlanir")


def _connect() -> sqlite3.Connection:
    config.ensure_dirs()
    connection = sqlite3.connect(config.DB_FILE, timeout=30)
    connection.row_factory = sqlite3.Row
    return connection


def init() -> None:
    """Cədvəli yaradır və yarımçıq qalmış yoxlamaları xətalı kimi işarələyir.

    Server işləyərkən söndürülübsə, fon tapşırığı itir — həmin yoxlamalar
    əbədi "işləyir" qalmasın deyə başlanğıcda bağlanır.
    """
    with _LOCK, _connect() as connection:
        connection.executescript(SCHEMA)
        _ensure_doc_column(connection)
        _ensure_plan_name_column(connection)
        connection.execute(
            "UPDATE checks SET run_state = 'xeta', error = ? "
            "WHERE run_state IN (?, ?)",
            ("Server yenidən başladı; davam etdirmək olar.", *RUNNING_STATES),
        )
        # Tələblərin çıxarılması yarımçıq qalıbsa — istifadəçi siyahını əl ilə
        # doldura və ya çıxarışı təkrarlaya bilər; heç nə "hazır" sayılmır.
        connection.execute(
            "UPDATE checks SET run_state = 'tesdiq_gozleyir', error = ? "
            "WHERE run_state = 'telebler_hazirlanir'",
            ("Server yenidən başladı — tələblər çıxarılmadı. Yenidən çıxarın və ya "
             "əl ilə əlavə edin.",),
        )


def _ensure_plan_name_column(connection: sqlite3.Connection) -> None:
    """Planın göstərilən adı ayrıca saxlanılır; `plan_id` sabit açardır (miqrasiya, bir dəfəlik).

    Köhnə sətirlərdə `plan_name` boşdur — onların açarı elə adın özüdür (heç nə dəyişdirilmir,
    birləşdirilmir və silinmir).
    """
    columns = {row[1] for row in connection.execute("PRAGMA table_info(checks)")}
    if "plan_name" not in columns:
        connection.execute("ALTER TABLE checks ADD COLUMN plan_name TEXT")


def new_plan_id() -> str:
    """Yeni planın sabit açarı — adla əlaqəsi yoxdur (eyni adlı planlar ayrı qalır)."""
    return "p-" + uuid.uuid4().hex[:12]


def plan_exists(plan_id: str) -> bool:
    with _connect() as connection:
        return connection.execute("SELECT 1 FROM checks WHERE plan_id = ? LIMIT 1", (plan_id,)).fetchone() is not None


def plan_name_of(plan_id: str) -> str:
    """Planın göstərilən adı (sonuncu versiyadakı); köhnə planlarda açarın özü."""
    with _connect() as connection:
        row = connection.execute(
            "SELECT plan_name FROM checks WHERE plan_id = ? AND plan_name IS NOT NULL "
            "ORDER BY version DESC LIMIT 1", (plan_id,)).fetchone()
    return row["plan_name"] if row and row["plan_name"] else plan_id


def next_version(plan_id: str) -> int:
    """Bu plan üçün növbəti versiya nömrəsi."""
    with _connect() as connection:
        row = connection.execute(
            "SELECT MAX(version) AS v FROM checks WHERE plan_id = ?", (plan_id,)
        ).fetchone()
    return int(row["v"] or 0) + 1


def create(check_id: str, plan_id: str, version: int, file_name: str,
           file_path: str, fail_at: str = "", run_state: str = "gozleyir",
           plan_name: str | None = None) -> dict[str, Any]:
    """Yeni yoxlama qeydi yaradır (ilkin vəziyyət bir əməliyyatda yazılır)."""
    created_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
    with _LOCK, _connect() as connection:
        _ensure_plan_name_column(connection)
        connection.execute(
            "INSERT INTO checks (id, plan_id, plan_name, version, file_name, file_path, "
            "created_at, run_state, current_step, fail_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)",
            (check_id, plan_id, plan_name or plan_id, version, file_name, file_path, created_at,
             run_state, fail_at),
        )
    return get(check_id)  # type: ignore[return-value]


def plan_check_ids(plan_id: str) -> list[dict[str, Any]]:
    """Planın bütün yoxlamaları: id, vəziyyət və yüklənmiş faylın yolu."""
    with _connect() as connection:
        rows = connection.execute("SELECT id, run_state, file_path FROM checks WHERE plan_id = ?",
                                  (plan_id,)).fetchall()
    return [dict(r) for r in rows]


def all_check_ids() -> list[str]:
    with _connect() as connection:
        return [r["id"] for r in connection.execute("SELECT id FROM checks").fetchall()]


def delete_checks(check_ids: list[str]) -> None:
    """Yoxlamaları və onlara aid bütün sətirləri (əlavə tələblər, hadisələr, memo) BİR tranzaksiyada silir."""
    if not check_ids:
        return
    marks = ",".join("?" * len(check_ids))
    with _LOCK, _connect() as connection:
        connection.executescript(SCHEMA)
        for table, column in (("extras", "check_id"), ("events", "check_id"), ("memo", "check_id"),
                              ("economics", "check_id"), ("questions", "check_id"), ("evidence", "check_id"),
                              ("checks", "id")):
            connection.execute(f"DELETE FROM {table} WHERE {column} IN ({marks})", check_ids)


def discard(check_id: str) -> None:
    """Yaradılması yarımçıq qalmış yoxlamanı (və əlavə tələb qeydini) silir."""
    with _LOCK, _connect() as connection:
        connection.execute("DELETE FROM extras WHERE check_id = ?", (check_id,))
        connection.execute("DELETE FROM checks WHERE id = ?", (check_id,))


def update(check_id: str, **fields: Any) -> None:
    """Yoxlamanın sahələrini yeniləyir. `result` dict-i JSON kimi yazılır."""
    if "result" in fields:
        result = fields.pop("result")
        fields["result_json"] = None if result is None else json.dumps(result, ensure_ascii=False)
    if not fields:
        return
    assignments = ", ".join(f"{key} = ?" for key in fields)
    with _LOCK, _connect() as connection:
        connection.execute(
            f"UPDATE checks SET {assignments} WHERE id = ?",
            (*fields.values(), check_id),
        )


def _row_to_dict(row: sqlite3.Row | None) -> dict[str, Any] | None:
    if row is None:
        return None
    data = dict(row)
    data.pop("doc_json", None)             # sənədin mətni API cavabına daxil edilmir
    data["plan_name"] = data.get("plan_name") or data["plan_id"]
    raw = data.pop("result_json", None)
    data["result"] = json.loads(raw) if raw else None
    return data


def get(check_id: str) -> dict[str, Any] | None:
    with _connect() as connection:
        row = connection.execute(
            "SELECT * FROM checks WHERE id = ?", (check_id,)
        ).fetchone()
    return _row_to_dict(row)


def previous_result(plan_id: str, before_version: int) -> dict[str, Any] | None:
    """Eyni planın əvvəlki TAMAMLANMIŞ yoxlaması (giriş xətası sayılmır)."""
    with _connect() as connection:
        row = connection.execute(
            "SELECT * FROM checks WHERE plan_id = ? AND version < ? "
            "AND run_state = 'tamamlandi' AND IFNULL(verdict, '') != 'giris_xetasi' "
            "ORDER BY version DESC LIMIT 1",
            (plan_id, before_version),
        ).fetchone()
    return _row_to_dict(row)


def list_plans() -> list[dict[str, Any]]:
    """Planlar: ad, versiya sayı, sonuncu yoxlamanın tarixi və statusu."""
    with _connect() as connection:
        rows = connection.execute(
            "SELECT plan_id, COUNT(*) AS versions, MAX(created_at) AS last_at "
            "FROM checks GROUP BY plan_id ORDER BY last_at DESC"
        ).fetchall()
        plans = []
        for row in rows:
            last = connection.execute(
                "SELECT verdict, run_state FROM checks WHERE plan_id = ? "
                "ORDER BY version DESC LIMIT 1",
                (row["plan_id"],),
            ).fetchone()
            plans.append({
                "plan_id": row["plan_id"],
                "plan_name": plan_name_of(row["plan_id"]),
                "versions": row["versions"],
                "last_at": row["last_at"],
                "last_verdict": last["verdict"] if last else None,
                "last_run_state": last["run_state"] if last else None,
            })
    return plans


def list_checks(plan_id: str) -> list[dict[str, Any]]:
    """Bir planın bütün versiyaları (nəticə JSON-u olmadan — siyahı yüngül olsun)."""
    with _connect() as connection:
        rows = connection.execute(
            "SELECT id, plan_id, IFNULL(plan_name, plan_id) AS plan_name, version, file_name, "
            "created_at, run_state, current_step, verdict, error FROM checks WHERE plan_id = ? "
            "ORDER BY version DESC",
            (plan_id,),
        ).fetchall()
    return [dict(row) for row in rows]


def consume_fail(check_id: str, node: str) -> bool:
    """Süni xəta yalnız BİR dəfə işləsin.

    Müvəqqəti API nasazlığını təqlid edir: xəta bir dəfə atılır, sonra
    `fail_at` sıfırlanır və davam etdirmə (retry) uğurla keçir.
    """
    with _LOCK, _connect() as connection:
        row = connection.execute(
            "SELECT fail_at FROM checks WHERE id = ?", (check_id,)
        ).fetchone()
        if row is None or (row["fail_at"] or "") != node:
            return False
        connection.execute("UPDATE checks SET fail_at = '' WHERE id = ?", (check_id,))
    return True


# ── Model nəticələrinin yaddaşı (memo) ─────────────────────────────────────

def memo_get(check_id: str | None, key: str) -> Any | None:
    """Saxlanılmış uğurlu model nəticəsi və ya None."""
    if not check_id:
        return None
    with _connect() as connection:
        connection.executescript(SCHEMA)
        row = connection.execute(
            "SELECT value_json FROM memo WHERE check_id = ? AND key = ?", (check_id, key)
        ).fetchone()
    return json.loads(row["value_json"]) if row else None


def memo_set(check_id: str | None, key: str, value: Any) -> None:
    """Uğurlu model nəticəsini saxlayır (eyni açar varsa əvəz olunur)."""
    if not check_id:
        return
    with _LOCK, _connect() as connection:
        connection.executescript(SCHEMA)
        connection.execute(
            "INSERT OR REPLACE INTO memo (check_id, key, value_json) VALUES (?, ?, ?)",
            (check_id, key, json.dumps(value, ensure_ascii=False)),
        )


# ── Əlavə tələblər ─────────────────────────────────────────────────────────

def extras_create(check_id: str, attachments: list[dict[str, Any]]) -> None:
    with _LOCK, _connect() as connection:
        connection.executescript(SCHEMA)
        connection.execute(
            "INSERT OR REPLACE INTO extras (check_id, attachments_json) VALUES (?, ?)",
            (check_id, json.dumps(attachments, ensure_ascii=False)),
        )


def extras_get(check_id: str) -> dict[str, Any] | None:
    """{"attachments", "draft", "confirmed", "list_version", "confirmed_at"} və ya None."""
    with _connect() as connection:
        connection.executescript(SCHEMA)
        row = connection.execute("SELECT * FROM extras WHERE check_id = ?",
                                 (check_id,)).fetchone()
    if row is None:
        return None
    load = lambda value: json.loads(value) if value else None  # noqa: E731
    return {
        "attachments": load(row["attachments_json"]) or [],
        "draft": load(row["draft_json"]),
        "confirmed": load(row["confirmed_json"]),
        "list_version": row["list_version"],
        "confirmed_at": row["confirmed_at"],
    }


def extras_set_draft(check_id: str, draft: dict[str, Any]) -> None:
    with _LOCK, _connect() as connection:
        connection.execute("UPDATE extras SET draft_json = ? WHERE check_id = ?",
                           (json.dumps(draft, ensure_ascii=False), check_id))


def extras_confirm(check_id: str, items: list[dict[str, Any]], version: str) -> None:
    """Təsdiqlənmiş siyahını saxlayır — bundan sonra dəyişmir (retry də onu işlədir)."""
    confirmed_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
    with _LOCK, _connect() as connection:
        connection.execute(
            "UPDATE extras SET confirmed_json = ?, list_version = ?, confirmed_at = ? "
            "WHERE check_id = ?",
            (json.dumps(items, ensure_ascii=False), version, confirmed_at, check_id),
        )


# ── Agent fəaliyyəti (events) ──────────────────────────────────────────────

EVENT_FIELDS = ("check_id", "attempt", "ts", "agent", "grp", "kind", "name", "args",
                "summary", "status", "duration_ms")


def event_add(**event: Any) -> None:
    """Bir hadisə yazır (qovşaq, alət, LLM). Modelin mətni burada SAXLANILMIR."""
    values = [event.get(f) for f in EVENT_FIELDS]
    with _LOCK, _connect() as connection:
        connection.executescript(SCHEMA)
        connection.execute(
            f"INSERT INTO events ({', '.join(EVENT_FIELDS)}) "
            f"VALUES ({', '.join('?' for _ in EVENT_FIELDS)})", values)


def events_list(check_id: str, after: int = 0, limit: int = 2000) -> list[dict[str, Any]]:
    """`after`-dən sonrakı hadisələr (artımlı polling üçün), id sırası ilə."""
    with _connect() as connection:
        connection.executescript(SCHEMA)
        rows = connection.execute(
            "SELECT * FROM events WHERE check_id = ? AND id > ? ORDER BY id LIMIT ?",
            (check_id, after, limit)).fetchall()
    return [dict(row) for row in rows]


def typical_run_seconds(limit: int = 10) -> float | None:
    """Son `limit` tamamlanmış yoxlamanın icra müddətinin medianı (saniyə) — hər yoxlamanın SON cəhdi,
    ilk hadisədən sonuncuya qədər. Məlumat yoxdursa None (vaxt uydurulmur)."""
    with _connect() as connection:
        connection.executescript(SCHEMA)
        rows = connection.execute(
            """SELECT e.check_id, MAX(e.ts) - MIN(e.ts) AS seconds
                 FROM events e JOIN checks c ON c.id = e.check_id
                WHERE c.run_state = 'tamamlandi' AND c.verdict IS NOT NULL AND c.verdict != 'giris_xetasi'
                  AND e.attempt = (SELECT MAX(attempt) FROM events WHERE check_id = e.check_id)
                GROUP BY e.check_id
                ORDER BY MAX(c.created_at) DESC
                LIMIT ?""", (limit,)).fetchall()
    values = sorted(float(r["seconds"]) for r in rows if r["seconds"] and r["seconds"] > 5)
    if not values:
        return None
    mid = len(values) // 2
    return values[mid] if len(values) % 2 else (values[mid - 1] + values[mid]) / 2


def next_attempt(check_id: str) -> int:
    """Növbəti icra cəhdinin nömrəsi (1, 2, ...). Köhnə cəhdlərin hadisələri qalır."""
    with _connect() as connection:
        connection.executescript(SCHEMA)
        row = connection.execute("SELECT MAX(attempt) AS a FROM events WHERE check_id = ?",
                                 (check_id,)).fetchone()
    return int(row["a"] or 0) + 1


# ── Sənədin özü (dəlil paneli üçün) ────────────────────────────────────────

def _ensure_doc_column(connection: sqlite3.Connection) -> None:
    """Köhnə bazaya `doc_json` sütununu əlavə edir (miqrasiya, bir dəfəlik)."""
    columns = {row[1] for row in connection.execute("PRAGMA table_info(checks)")}
    if "doc_json" not in columns:
        connection.execute("ALTER TABLE checks ADD COLUMN doc_json TEXT")


def doc_set(check_id: str, doc: dict[str, Any]) -> None:
    """Oxunmuş sənədi (bölmələr, cədvəllər) saxlayır — API cavabına DAXİL EDİLMİR."""
    with _LOCK, _connect() as connection:
        _ensure_doc_column(connection)
        connection.execute("UPDATE checks SET doc_json = ? WHERE id = ?",
                           (json.dumps(doc, ensure_ascii=False), check_id))


def doc_get(check_id: str) -> dict[str, Any] | None:
    """Saxlanmış sənəd; köhnə yoxlamalarda None."""
    with _LOCK, _connect() as connection:
        _ensure_doc_column(connection)
        row = connection.execute("SELECT doc_json FROM checks WHERE id = ?", (check_id,)).fetchone()
    return json.loads(row["doc_json"]) if row and row["doc_json"] else None


# ── İqtisadi təhlil ────────────────────────────────────────────────────────

def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def econ_get(check_id: str) -> dict[str, Any] | None:
    with _connect() as connection:
        connection.executescript(SCHEMA)
        row = connection.execute("SELECT * FROM economics WHERE check_id = ?", (check_id,)).fetchone()
    if row is None:
        return None
    data = dict(row)
    for key in ("facts_json", "result_json", "history_json"):
        raw = data.pop(key)
        data[key.removesuffix("_json")] = json.loads(raw) if raw else None
    data["history"] = data["history"] or []
    return data


def econ_set(check_id: str, **fields: Any) -> None:
    """Sətri yaradır və ya yeniləyir. `facts`, `result`, `history` JSON kimi yazılır."""
    values = {}
    for key, value in fields.items():
        if key in ("facts", "result", "history"):
            values[key + "_json"] = None if value is None else json.dumps(value, ensure_ascii=False)
        else:
            values[key] = value
    values["updated_at"] = _now()
    with _LOCK, _connect() as connection:
        connection.executescript(SCHEMA)
        exists = connection.execute("SELECT 1 FROM economics WHERE check_id = ?", (check_id,)).fetchone()
        if exists is None:
            values.setdefault("state", "gozleyir")
            columns = ["check_id", *values]
            connection.execute(f"INSERT INTO economics ({', '.join(columns)}) VALUES ({', '.join('?' * len(columns))})",
                               (check_id, *values.values()))
        else:
            assignments = ", ".join(f"{k} = ?" for k in values)
            connection.execute(f"UPDATE economics SET {assignments} WHERE check_id = ?", (*values.values(), check_id))


QUESTION_STATUSES = ("aciq", "cavab_gozlenilir", "cavablandi", "qebul", "redd")
OPEN_QUESTION_STATUSES = ("aciq", "cavab_gozlenilir")


def _question(row: sqlite3.Row) -> dict[str, Any]:
    data = dict(row)
    data["documents"] = json.loads(data.pop("documents_json") or "[]")
    data["edited"] = bool(data["edited"])
    data["stale"] = bool(data["stale"])
    return data


def questions_list(check_id: str) -> list[dict[str, Any]]:
    with _connect() as connection:
        connection.executescript(SCHEMA)
        rows = connection.execute("SELECT * FROM questions WHERE check_id = ? ORDER BY position, created_at",
                                  (check_id,)).fetchall()
    return [_question(r) for r in rows]


def question_get(question_id: str) -> dict[str, Any] | None:
    with _connect() as connection:
        connection.executescript(SCHEMA)
        row = connection.execute("SELECT * FROM questions WHERE id = ?", (question_id,)).fetchone()
    return _question(row) if row else None


def question_upsert(item: dict[str, Any]) -> None:
    """Sual yazır (id eynidirsə əvəz edir). `documents` siyahı kimi verilir."""
    now = _now()
    row = {**item, "documents_json": json.dumps(item.get("documents") or [], ensure_ascii=False),
           "edited": int(bool(item.get("edited"))), "stale": int(bool(item.get("stale"))),
           "created_at": item.get("created_at") or now, "updated_at": now}
    row.pop("documents", None)
    columns = ["id", "check_id", "plan_id", "finding_id", "origin", "text", "documents_json", "severity", "status",
               "note", "decided_by", "edited", "stale", "position", "created_at", "updated_at"]
    with _LOCK, _connect() as connection:
        connection.executescript(SCHEMA)
        connection.execute(f"INSERT OR REPLACE INTO questions ({', '.join(columns)}) VALUES ({', '.join('?' * len(columns))})",
                           tuple(row.get(c) if c not in ("position",) else int(row.get(c) or 0) for c in columns))


def question_delete(question_id: str) -> bool:
    with _LOCK, _connect() as connection:
        connection.executescript(SCHEMA)
        cursor = connection.execute("DELETE FROM questions WHERE id = ?", (question_id,))
        connection.execute("UPDATE evidence SET question_id = NULL WHERE question_id = ?", (question_id,))
    return cursor.rowcount > 0


def _evidence(row: sqlite3.Row) -> dict[str, Any]:
    data = dict(row)
    raw = data.pop("analysis_json")
    data["analysis"] = json.loads(raw) if raw else None
    return data


def evidence_add(item: dict[str, Any]) -> None:
    columns = ["id", "check_id", "plan_id", "question_id", "req_code", "doc_type", "kind", "file_name", "stored",
               "size", "analysis_json", "uploaded_at"]
    row = {**item, "analysis_json": json.dumps(item.get("analysis"), ensure_ascii=False) if item.get("analysis") else None,
           "uploaded_at": item.get("uploaded_at") or _now()}
    with _LOCK, _connect() as connection:
        connection.executescript(SCHEMA)
        connection.execute(f"INSERT INTO evidence ({', '.join(columns)}) VALUES ({', '.join('?' * len(columns))})",
                           tuple(row.get(c) for c in columns))


def evidence_set_analysis(evidence_id: str, analysis: dict[str, Any]) -> None:
    with _LOCK, _connect() as connection:
        connection.execute("UPDATE evidence SET analysis_json = ? WHERE id = ?",
                           (json.dumps(analysis, ensure_ascii=False), evidence_id))


def evidence_list(check_id: str) -> list[dict[str, Any]]:
    with _connect() as connection:
        connection.executescript(SCHEMA)
        rows = connection.execute("SELECT * FROM evidence WHERE check_id = ? ORDER BY uploaded_at, id",
                                  (check_id,)).fetchall()
    return [_evidence(r) for r in rows]


def evidence_get(evidence_id: str) -> dict[str, Any] | None:
    with _connect() as connection:
        connection.executescript(SCHEMA)
        row = connection.execute("SELECT * FROM evidence WHERE id = ?", (evidence_id,)).fetchone()
    return _evidence(row) if row else None


def evidence_delete(evidence_id: str) -> dict[str, Any] | None:
    item = evidence_get(evidence_id)
    if item is None:
        return None
    with _LOCK, _connect() as connection:
        connection.execute("DELETE FROM evidence WHERE id = ?", (evidence_id,))
    return item


def evidence_files(check_ids: list[str]) -> list[str]:
    """Silinəcək yoxlamaların sənəd fayllarının adları (yükləmə qovluğunda)."""
    if not check_ids:
        return []
    marks = ",".join("?" * len(check_ids))
    with _connect() as connection:
        connection.executescript(SCHEMA)
        rows = connection.execute(f"SELECT stored FROM evidence WHERE check_id IN ({marks})", check_ids).fetchall()
    return [r["stored"] for r in rows]


def memo_delete(check_id: str, key: str) -> None:
    """Saxlanmış model nəticəsini silir — növbəti icrada model yenidən çağırılır."""
    with _LOCK, _connect() as connection:
        connection.executescript(SCHEMA)
        connection.execute("DELETE FROM memo WHERE check_id = ? AND key = ?", (check_id, key))
