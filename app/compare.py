"""Eyni planın iki versiyasının müqayisəsi (LLM-siz, deterministik).

Müqayisə olunur:
  • boş yerlər — hansılar doldurulub, hansılar yeni yaranıb;
  • maliyyə yoxlamaları — planda bəyan edilən rəqəm və status dəyişikliyi;
  • Tələblər — status dəyişikliyi.

Boş yerlər mətn + bölmə başlığı ilə eyniləşdirilir (bölmə id-ləri versiyalar
arasında sürüşə bilər). Eyni ifadə bir bölmədə bir neçə dəfə ola bilər, ona
görə sayma `Counter` ilə aparılır.

**Sabitləşdirmə** (`stabilize`): LLM eyni mətnə hər dəfə eyni qiymət vermir.
Tələbin istinad etdiyi bölmələrin mətni versiyalar arasında dəyişməyibsə,
status dəyişikliyi yalnız modelin "səs-küyü"dür — əvvəlki status saxlanılır.
Bölmələr başlığa görə eyniləşdirilir və mətnin barmaq izi (sha1) tutuşdurulur.
"""
from __future__ import annotations

import hashlib
from collections import Counter
from typing import Any

#: Status nə qədər yaxşıdırsa, dərəcəsi o qədər yüksəkdir.
#: `skip` və `sened` dərəcələnmir — onlar "yoxlanılmayıb" deməkdir.
FINANCE_RANK = {"fail": 0, "warn": 1, "ok": 2}
REQUIREMENT_RANK = {"yoxdur": 0, "natamam": 1, "var": 2}


def snapshot(result: dict[str, Any] | None, check: dict[str, Any]) -> dict[str, Any]:
    """Saxlanılmış nəticədən müqayisə üçün lazım olan yüngül görüntü."""
    result = result or {}
    ingest = result.get("ingest") or {}
    return {
        "check_id": check["id"],
        "version": check["version"],
        "file_name": check["file_name"],
        "created_at": check["created_at"],
        "verdict": check.get("verdict"),
        "placeholders": ingest.get("placeholders") or [],
        "section_hashes": ingest.get("section_hashes") or {},
        "finance_checks": (result.get("finance") or {}).get("checks") or [],
        "requirements": (result.get("compliance") or {}).get("items") or [],
    }


def section_hashes(sections: list[dict[str, Any]],
                   tables: list[dict[str, Any]] = ()) -> dict[str, str]:
    """Bölmə başlığı -> mətnin sha1-i. Təkrarlanan başlıqların mətni birləşdirilir.

    Bölmə mətnində cədvəl yalnız qısa istinad kimi durur, ona görə bölmənin
    cədvəllərinin MƏZMUNU da barmaq izinə qatılır — cədvəl dəyişəndə bölmə
    "dəyişib" sayılır.
    """
    by_id = {t["id"]: t for t in tables}
    texts: dict[str, list[str]] = {}
    for section in sections:
        parts = [section["text"]]
        for table_id in section.get("table_ids") or []:
            if table_id in by_id:
                parts += [" | ".join(row) for row in by_id[table_id]["rows"]]
        texts.setdefault(section["title"], []).append("\n".join(parts))
    return {title: hashlib.sha1("\n".join(parts).encode("utf-8")).hexdigest()
            for title, parts in texts.items()}


def _unchanged(titles: set[str], before: dict[str, str], after: dict[str, str]) -> bool:
    """Bütün bölmələr hər iki versiyada var və mətni eynidir."""
    return bool(titles) and all(
        t in before and before[t] == after.get(t) for t in titles)


def stabilize(previous: dict[str, Any], items: list[dict[str, Any]],
              hashes: dict[str, str]) -> list[dict[str, Any]]:
    """Mətni dəyişməyən bölmələrə əsaslanan tələblərdə əvvəlki statusu saxlayır.

    Yalnız hər iki status dərəcələnəndə (var/natamam/yoxdur) tətbiq olunur:
    `skip` agent xətasıdır və gizlədilməməlidir. Köhnə yoxlamalarda barmaq izi
    yoxdursa, heç nə dəyişmir.
    """
    old_hashes = previous.get("section_hashes") or {}
    if not old_hashes:
        return items
    old_by_id = {r["req_id"]: r for r in previous.get("requirements") or []}
    result: list[dict[str, Any]] = []
    for item in items:
        before = old_by_id.get(item["req_id"])
        if (before is None or before.get("status") == item.get("status")
                or before.get("status") not in REQUIREMENT_RANK
                or item.get("status") not in REQUIREMENT_RANK
                # Tələbin özü dəyişibsə (siyahı yenilənib), köhnə status ona aid deyil.
                or before.get("text") != item.get("text")):
            result.append(item)
            continue
        titles = {s["title"] for s in (before.get("sections") or []) + (item.get("sections") or [])}
        if not _unchanged(titles, old_hashes, hashes):
            result.append(item)
            continue
        result.append({
            **item,
            **{k: before.get(k) for k in ("status", "sections", "quote", "comment", "missing")},
            "carried_from": {"version": previous.get("version"),
                             "status_now": item.get("status")},
        })
    return result


def _trend(rank: dict[str, int], old: str | None, new: str | None) -> str:
    """`yaxsilasdi` / `pislesdi` / `deyisdi` (dərəcələnməyən status iştirak edirsə)."""
    if old in rank and new in rank:
        return "yaxsilasdi" if rank[new] > rank[old] else "pislesdi"
    return "deyisdi"


def _placeholder_key(item: dict[str, Any]) -> tuple[str, str]:
    return (item.get("text") or "", item.get("section_title") or "")


def _compare_placeholders(old: list[dict[str, Any]],
                          new: list[dict[str, Any]]) -> dict[str, Any]:
    old_count = Counter(_placeholder_key(p) for p in old)
    new_count = Counter(_placeholder_key(p) for p in new)

    def expand(counter: Counter) -> list[dict[str, Any]]:
        return [{"text": text, "section_title": section, "count": n}
                for (text, section), n in sorted(counter.items())]

    return {
        "before": len(old),
        "after": len(new),
        "filled": expand(old_count - new_count),
        "added": expand(new_count - old_count),
    }


def _compare_finance(old: list[dict[str, Any]],
                     new: list[dict[str, Any]]) -> list[dict[str, Any]]:
    old_by_id = {c["id"]: c for c in old}
    changes: list[dict[str, Any]] = []
    for check in new:
        before = old_by_id.get(check["id"])
        if before is None:
            continue
        status_changed = before.get("status") != check.get("status")
        claimed_changed = before.get("claimed") != check.get("claimed")
        if not (status_changed or claimed_changed):
            continue
        changes.append({
            "id": check["id"],
            "title": check.get("title") or check["id"],
            "critical": bool(check.get("critical")),
            "unit": check.get("unit") or "",
            "decimals": check.get("decimals") or 0,
            "claimed_before": before.get("claimed"),
            "claimed_after": check.get("claimed"),
            "status_before": before.get("status"),
            "status_after": check.get("status"),
            "trend": (_trend(FINANCE_RANK, before.get("status"), check.get("status"))
                      if status_changed else "deyisdi"),
        })
    return changes


def _compare_requirements(old: list[dict[str, Any]],
                          new: list[dict[str, Any]]) -> list[dict[str, Any]]:
    old_by_id = {r["req_id"]: r for r in old}
    changes: list[dict[str, Any]] = []
    for item in new:
        before = old_by_id.get(item["req_id"])
        if before is None or before.get("status") == item.get("status"):
            continue
        if before.get("text") != item.get("text"):
            continue      # tələbin özü dəyişib — `requirement_list`-də göstərilir, trend deyil
        changes.append({
            "req_id": item["req_id"],
            "group_title": item.get("group_title"),
            "text": item.get("text"),
            "status_before": before.get("status"),
            "status_after": item.get("status"),
            "trend": _trend(REQUIREMENT_RANK, before.get("status"), item.get("status")),
        })
    return changes


def _compare_requirement_list(old: list[dict[str, Any]],
                              new: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    """Tələb SİYAHISININ dəyişməsi: əlavə edildi / çıxarıldı / mətni dəyişdi.

    Bu, planın yaxşılaşması və ya pisləşməsi DEYİL — meyarlar dəyişib; ona görə
    trend sayğaclarına düşmür.
    """
    old_by_id = {r["req_id"]: r for r in old}
    new_by_id = {r["req_id"]: r for r in new}

    def brief(item: dict[str, Any]) -> dict[str, Any]:
        return {"req_id": item["req_id"], "text": item.get("text"),
                "group_title": item.get("group_title"), "origin": item.get("origin")}

    return {
        "added": [brief(r) for rid, r in new_by_id.items() if rid not in old_by_id],
        "removed": [brief(r) for rid, r in old_by_id.items() if rid not in new_by_id],
        "changed": [{**brief(r), "text_before": old_by_id[rid].get("text")}
                    for rid, r in new_by_id.items()
                    if rid in old_by_id and old_by_id[rid].get("text") != r.get("text")],
    }


def compare(previous: dict[str, Any], current: dict[str, Any]) -> dict[str, Any]:
    """İki görüntünü müqayisə edir. `current` də `snapshot` formasındadır."""
    finance = _compare_finance(previous["finance_checks"], current["finance_checks"])
    requirements = _compare_requirements(previous["requirements"], current["requirements"])
    requirement_list = _compare_requirement_list(previous["requirements"],
                                                 current["requirements"])
    placeholders = _compare_placeholders(previous["placeholders"], current["placeholders"])

    # Saxlanılan status modelin YENİ qiymətini gizlətmir: hər ikisi göstərilir.
    carried = [{"req_id": r["req_id"], "text": r.get("text"),
                "status_kept": r.get("status"),
                "status_model": r["carried_from"].get("status_now")}
               for r in current["requirements"] if r.get("carried_from")]

    all_trends = [c["trend"] for c in finance + requirements]
    return {
        "available": True,
        "verdict": {"before": previous.get("verdict"), "after": current.get("verdict")},
        "previous": {k: previous[k] for k in
                     ("check_id", "version", "file_name", "created_at", "verdict")},
        "placeholders": placeholders,
        "finance": finance,
        "requirements": requirements,
        "carried": carried,
        "requirement_list": requirement_list,
        "counts": {
            "yaxsilasdi": all_trends.count("yaxsilasdi"),
            "pislesdi": all_trends.count("pislesdi"),
            "deyisdi": all_trends.count("deyisdi"),
            "carried": len(carried),
            "filled": sum(p["count"] for p in placeholders["filled"]),
            "added": sum(p["count"] for p in placeholders["added"]),
        },
    }
