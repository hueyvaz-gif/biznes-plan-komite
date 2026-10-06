"""Yekun status — deterministik qayda (LLM-in fikri DEYİL).

Qayda (yuxarıdan aşağı, ilk uyğun gələn):

| Status        | Nə vaxt |
| ------------- | ------- |
| `hazir_deyil` | kritik maliyyə yoxlaması `fail` və ya tələb `yoxdur` |
| `duzelis`     | qeyri-kritik `fail`, hər hansı `warn`, `natamam` tələb, doldurulmamış yer, sənəddə tapılmayan rəqəm, yoxlanıla bilməyən bənd (`skip`) |
| `hazir`       | yuxarıdakılardan heç biri yoxdur |

`skip` (yoxlanıla bilmədi) heç vaxt "uyğun" sayılmır — o, ən azı `duzelis`
deməkdir: məlumat çatmırsa, sənəd təqdimata hazır elan edilə bilməz.
`sened` (ayrıca sənəd) statusa təsir etmir, yalnız xatırlatma kimi göstərilir.

Hər səbəb `reasons` siyahısına düşür — UI və yekun rəy statusun NİYƏ belə
olduğunu buradan götürür.
"""
from __future__ import annotations

from typing import Any

#: Səbəbin ağırlığı -> onun yaratdığı status.
SEVERITY_VERDICT = {"kritik": "hazir_deyil", "duzelis": "duzelis"}


def _reason(code: str, severity: str, text: str, items: list[str],
            tab: str) -> dict[str, Any]:
    return {"code": code, "severity": severity, "text": text,
            "count": len(items), "items": items, "tab": tab}


def decide(finance: dict[str, Any] | None, compliance: dict[str, Any] | None,
           placeholders: list[dict[str, Any]],
           expected: dict[str, set[str]] | None = None) -> dict[str, Any]:
    """`{"verdict": ..., "reasons": [...], "notes": [...]}` qaytarır.

    `expected` — {"requirements": {req_id, ...}, "checks": {check_id, ...}}:
    nəticədə OLMALI olan bəndlər. Biri yoxdursa, yoxlama tam deyil və status
    `hazir` ola bilməz (boş və ya qismən nəticə səssizcə "hazır" sayılmır).
    """
    checks = (finance or {}).get("checks") or []
    not_found = (finance or {}).get("not_found") or []
    items = (compliance or {}).get("items") or []
    expected = expected or {}
    missing_checks = sorted(set(expected.get("checks") or ()) - {c.get("id") for c in checks})
    missing_reqs = sorted(set(expected.get("requirements") or ())
                          - {i.get("req_id") for i in items})
    if not checks and not missing_checks:
        missing_checks = ["maliyyə yoxlamaları"]
    if not items and not missing_reqs:
        missing_reqs = ["Tələblər"]

    def titles(predicate) -> list[str]:
        return [c.get("title") or c["id"] for c in checks if predicate(c)]

    def req_ids(status: str) -> list[str]:  # noqa: E306
        return [i["req_id"] for i in items if i.get("status") == status]

    candidates = [
        _reason("kritik_maliyye", "kritik",
                "Kritik maliyyə göstəricisi planda yazılanla uyğun gəlmir",
                titles(lambda c: c.get("critical") and c.get("status") == "fail"),
                "panel-maliyye"),
        _reason("teleb_yoxdur", "kritik",
                "Tələb planda ümumiyyətlə cavablanmayıb",
                req_ids("yoxdur"), "panel-teleb"),
        _reason("maliyye_fail", "duzelis",
                "Qeyri-kritik maliyyə uyğunsuzluğu",
                titles(lambda c: not c.get("critical") and c.get("status") == "fail"),
                "panel-maliyye"),
        _reason("maliyye_warn", "duzelis",
                "Maliyyə göstəricisində kiçik fərq (yuvarlaqlaşdırma həddindən çox)",
                titles(lambda c: c.get("status") == "warn"),
                "panel-maliyye"),
        _reason("teleb_natamam", "duzelis",
                "Tələb qismən cavablanıb",
                req_ids("natamam"), "panel-teleb"),
        _reason("bos_yer", "duzelis",
                "Sənəddə doldurulmamış yer qalıb",
                [p.get("text") or "" for p in placeholders], "panel-bosyer"),
        _reason("reqem_tapilmadi", "duzelis",
                "Bəyan edilən rəqəm sənədin mətnində tapılmadı",
                [str(n.get("label") or n.get("field") or n) if isinstance(n, dict) else str(n)
                 for n in not_found],
                "panel-maliyye"),
        _reason("maliyye_skip", "duzelis",
                "Maliyyə yoxlaması aparıla bilmədi — məlumat çatmır",
                titles(lambda c: c.get("status") == "skip"),
                "panel-maliyye"),
        _reason("texniki_nasazliq", "duzelis",
                "Texniki nasazlıq — model bu tələbləri yoxlaya bilmədi (sənədə görə deyil)",
                [i["req_id"] for i in items if i.get("status") == "skip" and i.get("technical")],
                "panel-teleb"),
        _reason("teleb_skip", "duzelis",
                "Tələb yoxlanıla bilmədi",
                [i["req_id"] for i in items
                 if i.get("status") == "skip" and not i.get("technical")],
                "panel-teleb"),
        _reason("yoxlama_natamam", "duzelis",
                "Yoxlama tam aparılmayıb — nəticədə olmayan bəndlər",
                missing_checks + missing_reqs,
                "panel-maliyye" if missing_checks else "panel-teleb"),
    ]
    reasons = [r for r in candidates if r["count"]]

    if any(r["severity"] == "kritik" for r in reasons):
        verdict = "hazir_deyil"
    elif reasons:
        verdict = "duzelis"
    else:
        verdict = "hazir"

    notes = []
    documents = req_ids("sened")
    if documents:
        notes.append(_reason("ayrica_sened", "melumat",
                             "Ayrıca sənəd kimi təqdim olunmalıdır — mövcudluğu yoxlanılmayıb",
                             documents, "panel-teleb"))
    not_applicable = req_ids("tetbiq_edilmir")
    if not_applicable:
        notes.append(_reason("tetbiq_edilmir", "melumat",
                             "Şərtli tələb tətbiq edilmir — plan şərti açıq istisna edir",
                             not_applicable, "panel-teleb"))
    return {"verdict": verdict, "reasons": reasons, "notes": notes}
