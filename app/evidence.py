"""Dəlil paneli: "bu harada yazılıb?" — planın orijinal parçası, vurğu mövqeyi ilə.

Hər parça: {"section_id", "section_title", "text", "mark": [başlanğıc, son]}.
`mark` mövqeyi XAM mətndə (parçanın içində) hesablanır; frontend parçanı üç
hissəyə bölüb hər birini AYRI escape edir (textContent) — sənəd mətni heç vaxt
HTML kimi işlənmir.

Cədvəl dəlili XAM xana mətnlərini verir — parse edilmiş rəqəm yox, sənəddə
yazıldığı kimi ("(13 481 000)", "–").
"""
from __future__ import annotations

from typing import Any, Iterable

from app.finance_tools import read_row
from app.ingest import find_table, year_header
from app.numbers import found_in, signed_numbers

WINDOW = 150
SECTION_PREVIEW = 800

#: Hər maliyyə yoxlaması üçün sənəddə axtarılan skalyar sahələr.
CHECK_FIELDS: dict[str, tuple[str, ...]] = {
    "investisiya_cemi": ("investment_total", "fixed_assets_investment", "working_capital_investment"),
    "menbeler_cemi": ("investment_total",),
    "guc": ("capacity_t_per_hour", "nominal_capacity_t", "practical_capacity_t", "utilization_pct"),
    "npv": ("npv", "discount_rate_pct"),
    "irr": ("irr_pct",),
    "pp": ("payback_years",),
}

#: Pul axını yoxlamalarında göstərilən cədvəl sətirləri.
CASHFLOW_ROWS: dict[str, tuple[str, ...]] = {
    "fcff_dusturu": ("row_investment", "row_ebitda", "row_tax", "row_wc_change", "row_residual", "row_fcff"),
    "npv": ("row_fcff",),
    "irr": ("row_fcff",),
    "pp": ("row_fcff",),
}


def _snippet(section: dict[str, Any], start: int, end: int) -> dict[str, Any]:
    """±WINDOW simvolluq parça; vurğu parçanın içindəki mövqedir."""
    text = section["text"]
    left = max(0, start - WINDOW)
    right = min(len(text), end + WINDOW)
    prefix = "…" if left > 0 else ""
    suffix = "…" if right < len(text) else ""
    return {
        "section_id": section["id"],
        "section_title": section["title"],
        "text": prefix + text[left:right] + suffix,
        "mark": [len(prefix) + start - left, len(prefix) + end - left],
    }


def locate_number(doc: dict[str, Any], value: float | None, limit: int = 3) -> list[dict[str, Any]]:
    """Dəyərin bölmə mətnlərində yazıldığı yerlər (NBSP və mötərizə nəzərə alınır)."""
    if value is None:
        return []
    found: list[dict[str, Any]] = []
    for section in doc["sections"]:
        for start, end, number in signed_numbers(section["text"]):
            if found_in(abs(number), [abs(float(value))]):
                found.append(_snippet(section, start, end))
                if len(found) >= limit:
                    return found
    return found


def _raw_row(table: dict[str, Any], row_index: int, columns: list[int]) -> list[str]:
    row = table["rows"][row_index]
    return [row[c] if c < len(row) else "" for c in columns]


def cashflow_evidence(doc: dict[str, Any], claimed: dict[str, Any], check: dict[str, Any],
                      row_fields: Iterable[str]) -> dict[str, Any] | None:
    """Pul axını cədvəlinin istifadə olunan sətirləri — XAM xana mətnləri ilə."""
    table_id = claimed.get("cashflow_table_id")
    table = find_table(doc, table_id) if table_id else None
    header = year_header(table) if table else None
    if table is None or header is None:
        return None
    header_row, years = header
    columns = [i for i, year in enumerate(years) if year is not None]
    rows = []
    for field in row_fields:
        found = read_row(doc, table["id"], claimed.get(field))
        if found.get("ok"):
            rows.append({"label": found["row_label"],
                         "cells": _raw_row(table, found["row_index"], columns)})
    if not rows:
        return None
    year_list = [years[c] for c in columns]
    highlight = None
    if check.get("id") == "fcff_dusturu" and check.get("status") == "fail":
        # Uyğunsuz ilin sütunu: detaldakı "2029-ci ildə" ifadəsindən.
        highlight = next((y for y in year_list if f"{y}-ci ildə" in (check.get("detail") or "")), None)
    return {
        "table_id": table["id"],
        "caption": table.get("caption") or "",
        "section_title": table.get("section_title") or "",
        "years": year_list,
        "rows": rows,
        "highlight_year": highlight,
    }


def finance_evidence(doc: dict[str, Any], finance: dict[str, Any]) -> dict[str, Any]:
    """Maliyyə yoxlamalarına `evidence.snippets` və `evidence.cashflow` əlavə edir."""
    claimed = finance.get("claimed") or {}
    checks = []
    for check in finance.get("checks") or []:
        check = dict(check)
        evidence = dict(check.get("evidence") or {})
        fields = CHECK_FIELDS.get(check["id"], ())
        snippets = []
        for field in fields:
            for snippet in locate_number(doc, claimed.get(field), limit=2):
                snippets.append({**snippet, "field": field})
        if check["id"] == "menbeler_cemi":
            for source in claimed.get("sources") or []:
                for snippet in locate_number(doc, source.get("amount"), limit=1):
                    snippets.append({**snippet, "field": "sources", "label": source.get("name")})
        evidence["snippets"] = snippets
        if check["id"] in CASHFLOW_ROWS:
            evidence["cashflow"] = cashflow_evidence(doc, claimed, check, CASHFLOW_ROWS[check["id"]])
        check["evidence"] = evidence
        checks.append(check)
    return {**finance, "checks": checks}


def section_preview(doc: dict[str, Any], section_id: str) -> dict[str, Any] | None:
    section = next((s for s in doc["sections"] if s["id"] == section_id), None)
    if section is None:
        return None
    text = section["text"]
    tables = [t for t in doc["tables"] if t["id"] in (section.get("table_ids") or [])]
    return {
        "section_id": section["id"],
        "section_title": section["title"],
        "text": text[:SECTION_PREVIEW] + ("…" if len(text) > SECTION_PREVIEW else ""),
        "truncated": len(text) > SECTION_PREVIEW,
        "tables": [{"id": t["id"], "caption": t.get("caption") or "başlıqsız cədvəl"} for t in tables],
    }


def compliance_evidence(doc: dict[str, Any], compliance: dict[str, Any]) -> dict[str, Any]:
    """Hər tələbə istinad edilən bölmələrin ilk ~800 simvolu və cədvəl başlıqları."""
    items = []
    for item in compliance.get("items") or []:
        previews = [p for p in (section_preview(doc, ref["id"]) for ref in item.get("sections") or []) if p]
        items.append({**item, "previews": previews})
    return {**compliance, "items": items}


def placeholder_evidence(doc: dict[str, Any], placeholders: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Boş yerlər: ±150 simvolluq parça və vurğu mövqeyi (eyni ifadənin n-ci təkrarı)."""
    by_id = {s["id"]: s for s in doc["sections"]}
    seen: dict[tuple[str, str], int] = {}
    out = []
    for item in placeholders:
        item = dict(item)
        section = by_id.get(item.get("section_id"))
        if item.get("where") == "paraqraf" and section is not None:
            key = (section["id"], item["text"])
            nth = seen.get(key, 0)
            seen[key] = nth + 1
            start = -1
            for _ in range(nth + 1):
                start = section["text"].find(item["text"], start + 1)
                if start < 0:
                    break
            if start >= 0:
                item["evidence"] = _snippet(section, start, start + len(item["text"]))
        if "evidence" not in item:
            context = item.get("context") or ""
            at = context.find(item["text"])
            item["evidence"] = {"section_id": item.get("section_id"),
                                "section_title": item.get("section_title"),
                                "text": context, "mark": [at, at + len(item["text"])] if at >= 0 else None}
        out.append(item)
    return out


def section_text(doc: dict[str, Any], title: str) -> dict[str, Any] | None:
    """Tam bölmə mətni ("Tam bölməni göstər")."""
    section = next((s for s in doc["sections"] if s["title"] == title or s["id"] == title), None)
    if section is None:
        return None
    return {"section_id": section["id"], "section_title": section["title"], "text": section["text"]}
