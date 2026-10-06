"""Deterministik nəticə qaydaları (LLM-siz) — tətbiq şərti və saxlanmış nəticənin yenidən qiymətləndirilməsi.

1. **Tətbiq şərti.** Bəzi tələblər şərtlidir ("kredit varsa — mənbəyi və ödəniş qrafiki"). Plan
   şərti AÇIQ istisna edirsə ("Bank krediti cəlb edilmir"), tələb "tətbiq edilmir" olur — sübutu
   sənəddən hərfi sitatdır. Agent "tətbiq edilmir" desə, amma sənəddə belə açıq ifadə yoxdursa,
   tələb "natamam" + "Dəqiqləşdirmə tələb olunur" olur. Şərt istisna edilməyibsə heç nə dəyişmir:
   kredit tələbləri avtomatik istisna EDİLMİR.

2. **Yenidən qiymətləndirmə.** Qayda düzəldiləndə (`RULES_VERSION` artır) saxlanmış hesabat modeli
   çağırmadan yenidən qiymətləndirilir: tətbiq şərti, maliyyə mənbələrinin cədvəl sətrinə görə
   təsdiqi, maliyyə yoxlamaları və yekun status. Əvvəlki status `rules.previous_verdict`-də qalır.
"""
from __future__ import annotations

import copy
import re
from typing import Any

from app.numbers import fold

#: Qaydaların versiyası — saxlanmış nəticə bundan köhnədirsə, yenidən qiymətləndirilir.
RULES_VERSION = 2

NOT_APPLICABLE = "tetbiq_edilmir"
CLARIFY_PREFIX = "Dəqiqləşdirmə tələb olunur: "


def _doc_passages(doc: dict[str, Any]) -> list[dict[str, Any]]:
    """Axtarış üçün sənəd parçaları: bölmə mətni, cədvəl başlığı və sətirləri — yeri ilə."""
    out = []
    for s in doc.get("sections") or []:
        if s.get("text"):
            out.append({"text": s["text"], "section_id": s["id"], "section_title": s["title"], "table_id": None})
    for t in doc.get("tables") or []:
        parts = [t.get("caption") or ""] + [" | ".join(r) for r in t.get("rows") or []]
        out.append({"text": "\n".join(p for p in parts if p), "section_id": t.get("section_id"),
                    "section_title": t.get("section_title"), "table_id": t["id"]})
    return out


def _sentence(text: str, start: int, end: int) -> str:
    """Uyğunluğun olduğu cümlə (və ya sətir) — hərfi, orijinal yazılışla."""
    left = max(text.rfind(".", 0, start), text.rfind("\n", 0, start), text.rfind(";", 0, start)) + 1
    stops = [i for i in (text.find(".", end), text.find("\n", end), text.find(";", end)) if i != -1]
    right = min(stops) + 1 if stops else len(text)
    return text[left:right].strip().rstrip(";,")


def _lower_same_length(text: str) -> str:
    """Kiçik hərf — hər simvol üçün bir simvol (Azərbaycan İ/I), mövqelər orijinalla eyni qalır."""
    return "".join("i" if ch == "İ" else "ı" if ch == "I" else (ch.lower() if len(ch.lower()) == 1 else ch)
                   for ch in text)


def find_exclusion(doc: dict[str, Any], condition: dict[str, Any]) -> dict[str, Any] | None:
    """Şərti AÇIQ istisna edən ifadə sənəddə varmı. Varsa: hərfi sitat və yer."""
    patterns = [re.compile(p) for p in condition.get("not_applicable_when") or []]
    for passage in _doc_passages(doc):
        original = passage["text"]
        lowered = _lower_same_length(original)
        for pattern in patterns:
            match = pattern.search(lowered)
            if match:
                quote = _sentence(original, match.start(), match.end())
                return {"quote": quote, "section_id": passage["section_id"],
                        "section_title": passage["section_title"], "table_id": passage["table_id"]}
    return None


def apply_conditions(doc: dict[str, Any], items: list[dict[str, Any]],
                     index: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    """Şərtli tələblərə tətbiq şərtini tətbiq edir (bax: modulun izahı)."""
    out = []
    for item in items:
        meta = index.get(item.get("req_id")) or {}
        condition = meta.get("condition")
        status = item.get("status")
        if not condition or status not in ("yoxdur", "natamam", NOT_APPLICABLE):
            out.append(item)
            continue
        found = find_exclusion(doc, condition)
        if found:
            out.append({**item, "status": NOT_APPLICABLE, "quote": found["quote"],
                        "sections": [{"id": found["section_id"], "title": found["section_title"],
                                      "table_id": found["table_id"]}],
                        "missing": None, "clarify": False,
                        "condition": {"text": condition["text"], "met": False,
                                      "status_before": status},
                        "comment": f"Şərt ödənmir ({condition['text'].lower()}): planda açıq yazılıb."})
        elif status == NOT_APPLICABLE:
            # Agent "tətbiq edilmir" deyib, amma sənəddə açıq istisna yoxdur — qərar istifadəçinindir.
            out.append({**item, "status": "natamam", "clarify": True,
                        "condition": {"text": condition["text"], "met": None, "status_before": status},
                        "missing": CLARIFY_PREFIX + condition["text"].lower()
                                   + " — planda bu barədə açıq ifadə yoxdur."})
        else:
            out.append(item)
    return out


# ── Maliyyə mənbələri: cədvəl sətrinə görə təsdiq ───────────────────────────

def _cells(row_text: str) -> list[str]:
    return [c.strip() for c in row_text.split("|")]


def _cell_numbers(cell: str) -> list[float]:
    from app.numbers import signed_numbers
    return [] if cell.endswith("%") else [v for _s, _e, v in signed_numbers(cell)]


def row_amount_ok(quote: str, name_keywords: list[str], value: float) -> bool:
    """Cədvəl sətri sitatında ("Ad | 70% | … | 11 732 629"): ad bir xanadadır və məbləğ həmin
    sətrin faiz OLMAYAN xanalarından birinə bərabərdir."""
    if "|" not in (quote or ""):
        return False
    cells = _cells(quote)
    label = [i for i, c in enumerate(cells) if any(k in fold(c) for k in name_keywords)]
    if not label:
        return False
    tol = max(1e-6 * abs(value), 1e-9)
    return any(abs(v - value) <= tol
               for i, c in enumerate(cells) if i not in label for v in _cell_numbers(c))


def source_columns(doc: dict[str, Any], sources: list[dict[str, Any]], total: float
                   ) -> dict[str, Any] | None:
    """Mənbələr eyni cədvəldədirsə: hansı sütunun cəmi ümumi investisiyaya bərabərdir və
    agentin götürdüyü sütun hansıdır. Dəqiqləşdirmə mətni üçün."""
    from app.ingest import find_table
    from app.finance_tools import _source_keywords
    locations = {s.get("location") for s in sources}
    if len(locations) != 1:
        return None
    table = find_table(doc, next(iter(locations)) or "")
    if not table or not table.get("rows"):
        return None
    header = table["rows"][0]
    rows = []
    for s in sources:
        keys = _source_keywords(s.get("name"))
        row = next((r for r in table["rows"][1:] if r and any(k in fold(r[0]) for k in keys)), None)
        if row is None:
            return None
        rows.append(row)
    width = min(len(r) for r in rows)
    matching, taken = None, None
    for j in range(1, width):
        nums = [(_cell_numbers(r[j]) or [None])[0] for r in rows]
        if any(n is None for n in nums):
            continue
        if abs(sum(nums) - total) <= 1 and matching is None:
            matching = j
        if all(abs(n - (s.get("amount") or 0)) <= 1 for n, s in zip(nums, sources)):
            taken = j
    if matching is None or taken is None or matching == taken:
        return None
    name = lambda j: header[j] if j < len(header) else f"{j + 1}-ci sütun"  # noqa: E731
    return {"matching": name(matching), "taken": name(taken), "table_id": table["id"]}


# ── Saxlanmış nəticənin yenidən qiymətləndirilməsi ──────────────────────────

def _recheck_sources(doc: dict[str, Any], finance: dict[str, Any]) -> bool:
    """Təsdiqlənməmiş mənbə məbləğlərini cədvəl sətri qaydası ilə yenidən yoxlayır."""
    from app.finance_tools import _source_keywords
    claimed = finance.get("claimed") or {}
    sources = claimed.get("sources") or []
    not_found = finance.get("not_found") or []
    changed = False
    for source in sources:
        if source.get("amount") is not None:
            continue
        miss = next((n for n in not_found if n.get("field") == "sources"
                     and n.get("label") == f"Mənbə: {source.get('name')}"), None)
        if miss is None or miss.get("value") is None:
            continue
        if row_amount_ok(source.get("quote") or "", _source_keywords(source.get("name")), miss["value"]):
            source["amount"] = miss["value"]
            not_found.remove(miss)
            changed = True
    finance["not_found"] = not_found
    return changed


def reevaluate(check: dict[str, Any], doc: dict[str, Any] | None) -> dict[str, Any] | None:
    """Saxlanmış nəticəni cari qaydalarla yenidən qiymətləndirir. Dəyişiklik yoxdursa — None.

    Qaytarır: {"result": yeni nəticə, "verdict": yeni status}. Model çağırılmır.
    """
    result = check.get("result")
    if not result or not doc or (result.get("rules") or {}).get("version", 1) >= RULES_VERSION:
        return None
    from app import evidence
    from app.agents.compliance import coverage, requirement_index
    from app.agents.extra_requirements import confirmed_groups
    from app.finance_tools import RULES as FINANCE_RULES
    from app.finance_tools import chart_data, run_checks
    from app.verdict import decide

    new = copy.deepcopy(result)
    extras = confirmed_groups(check["id"])
    index = requirement_index(extras)
    compliance = new.get("compliance") or {}
    if compliance.get("items"):
        compliance["items"] = apply_conditions(doc, compliance["items"], index)
        compliance["coverage"] = coverage(compliance["items"])
        new["compliance"] = evidence.compliance_evidence(doc, compliance)
    finance = new.get("finance")
    if finance and finance.get("claimed") and _recheck_sources(doc, finance):
        outcome = run_checks(doc, finance["claimed"])
        finance.update(checks=outcome["checks"], cashflow=outcome["cashflow"],
                       charts=chart_data(finance["claimed"], outcome["cashflow"]))
        new["finance"] = evidence.finance_evidence(doc, finance)
    if check.get("verdict") == "giris_xetasi":
        verdict = check["verdict"]
    else:
        expected = {"requirements": set(index), "checks": set(FINANCE_RULES)}
        decision = decide(new.get("finance"), new.get("compliance"),
                          (new.get("ingest") or {}).get("placeholders") or [], expected)
        verdict = decision["verdict"]
        new["reasons"] = {"reasons": decision["reasons"], "notes": decision["notes"]}
    new["rules"] = {"version": RULES_VERSION, "previous_verdict": check.get("verdict"),
                    "reevaluated": True}
    return {"result": new, "verdict": verdict}
