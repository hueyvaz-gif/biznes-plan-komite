"""Maliyyə yoxlamaları — tamamilə LLM-SİZ.

Burada iki iş görülür:

1. **Mənbə yoxlaması** (`provenance`): agentin qaytardığı hər skalyar rəqəm
   sənədin mətnində axtarılır. Tapılmasa istifadə olunmur — "sənəddə tapılmadı".
2. **7 yoxlama** (`run_checks`): planın öz rəqəmlərinin daxili uyğunluğu.
   Pul axını sətirləri cədvəldən BİRBAŞA Python ilə oxunur, agentdən deyil.

Heç bir funksiya exception atmır: səhv girişdə nəticənin statusu `skip` olur və
`detail` sahəsində səbəb yazılır.
"""
from __future__ import annotations

import re
from decimal import ROUND_HALF_UP, Decimal
from typing import Any, Iterable, Sequence

from app.ingest import find_section, find_table, render_table, year_header
from app.numbers import (all_numbers, contains_quote, decimals_of, fold, format_az, found_in,
                         parse_number, percent_numbers, signed_numbers, written_decimals)

#: Mənbə yoxlamasına düşən skalyar sahələr.
SCALAR_FIELDS: tuple[str, ...] = (
    "investment_total",
    "fixed_assets_investment",
    "working_capital_investment",
    "capacity_t_per_hour",
    "shifts_per_day",
    "shift_hours",
    "work_days_per_year",
    "utilization_pct",
    "nominal_capacity_t",
    "practical_capacity_t",
    "discount_rate_pct",
    "npv",
    "irr_pct",
    "payback_years",
)

FIELD_LABELS: dict[str, str] = {
    "investment_total": "Ümumi investisiya",
    "fixed_assets_investment": "Əsas vəsaitlərə investisiya",
    "working_capital_investment": "Dövriyyə kapitalına investisiya",
    "capacity_t_per_hour": "Məhsuldarlıq, ton/saat",
    "shifts_per_day": "Növbə sayı",
    "shift_hours": "Növbənin müddəti, saat",
    "work_days_per_year": "İllik iş günləri",
    "utilization_pct": "Gücdən istifadə, %",
    "nominal_capacity_t": "Nominal illik güc, ton",
    "practical_capacity_t": "Praktiki illik güc, ton",
    "discount_rate_pct": "Diskont dərəcəsi (WACC), %",
    "npv": "NPV, manat",
    "irr_pct": "IRR, %",
    "payback_years": "Özünü ödəmə müddəti, il",
}

#: Pul məbləğləri üçün dözümlülük.
MONEY_OK_ABS = 1.0        # ≤ 1 manat fərq — yuvarlaqlaşdırma
MONEY_WARN_REL = 0.005    # ≤ 0,5% — xəbərdarlıq
FCFF_TOLERANCE = 2.0      # düsturun yoxlanmasında ±2 manat
NPV_OK_REL = 0.01         # ≤ 1% — dərəcənin yuvarlaqlaşdırılması
NPV_FAIL_REL = 0.05       # > 5% — uyğunsuzluq
IRR_WARN_PP = 0.5         # ≤ 0,5 faiz bəndi
PP_WARN_YEARS = 0.2       # ≤ 0,2 il


def _m(value: float | None) -> str:
    """Pul və ton məbləğləri: tam manat/ton, Azərbaycan formatında."""
    return "—" if value is None else format_az(round(value), 0)


def _n(value: float | None, digits: int = 2) -> str:
    """Kəsrli dəyər (faiz, il) — Azərbaycan formatında, işarəsi ilə."""
    if value is None:
        return "—"
    sign = "+" if value > 0 else ("−" if value < 0 else "")
    return sign + format_az(abs(value), digits)


# ── Mənbə yoxlaması ────────────────────────────────────────────────────────

#: Sitatda olmalı açar sözlər (fold edilmiş). Rəqəm bu sözlərə ƏN YAXIN olmalıdır.
FIELD_KEYWORDS: dict[str, tuple[str, ...]] = {
    "investment_total": ("investisiya",),
    "fixed_assets_investment": ("əsas vəsait",),
    "working_capital_investment": ("dövriyyə kapital",),
    "capacity_t_per_hour": ("t/saat", "ton/saat", "məhsuldarl"),
    "shifts_per_day": ("növbə",),
    "shift_hours": ("saat",),
    "work_days_per_year": ("gün",),
    "utilization_pct": ("istifadə", "yüklən", "effektiv"),
    "nominal_capacity_t": ("nominal",),
    "practical_capacity_t": ("praktiki", "faktiki"),
    "discount_rate_pct": ("diskont", "wacc"),
    "npv": ("npv", "xalis cari"),
    "irr_pct": ("irr", "daxili rentabel", "daxili gəlir"),
    "payback_years": ("ödəmə", "ödəyir", "payback", "pp"),
}

#: Faizlə ifadə olunan sahələr — sitatda rəqəmdən sonra "%" olmalıdır.
PERCENT_FIELDS = {"utilization_pct", "discount_rate_pct", "irr_pct"}


def location_lines(doc: dict[str, Any], location: str | None) -> tuple[str, list[str]] | None:
    """Bölmə və ya cədvəlin başlığı və sətirləri — agentin gördüyü formada."""
    if not location:
        return None
    key = location.strip()
    table = find_table(doc, key)
    if table is not None:
        title = table["caption"] or table["section_title"]
        return title, render_table(table, max_rows=len(table["rows"])).split("\n")
    section = find_section(doc, key)
    if section is not None:
        return section["title"], [section["title"], *section["text"].split("\n")]
    return None


def _closest_number(quote: str, keywords: Iterable[str]) -> float | None:
    """Sitatda açar sözə ən yaxın rəqəm. Bərabər məsafədə fərqli rəqəmlər varsa None."""
    spans = []
    for word in keywords:
        start = quote.find(word)
        while start != -1:
            spans.append((start, start + len(word)))
            start = quote.find(word, start + 1)
    if not spans:
        return None
    best: dict[int, list[tuple[float, bool]]] = {}
    for n_start, n_end, value in signed_numbers(quote):
        gaps = [(max(k_start - n_end, n_start - k_end, 0), n_end <= k_start)
                for k_start, k_end in spans]
        gap = min(g for g, _before in gaps)
        before = any(b for g, b in gaps if g == gap)
        best.setdefault(gap, []).append((value, before))
    if not best:
        return None
    nearest = best[min(best)]
    values = {v for v, _b in nearest}
    if len(values) == 1:
        return next(iter(values))
    # Bərabərlik: Azərbaycan dilində say isimdən ƏVVƏL gəlir ("3 növbə", "300 iş günü").
    # "3 növbə (növbə 8 saat)" sitatında növbə sayı 3-dür, 8 deyil.
    preceding = {v for v, b in nearest if b}
    return next(iter(preceding)) if len(preceding) == 1 else None


def _formula_result(quote: str, fallback: float | None) -> float | None:
    """"WACC = … = 11,49%" — sitatın SON rəqəmi "=" işarəsindən sonradırsa, nəticədir."""
    numbers = signed_numbers(quote)
    if not numbers:
        return fallback
    start, _end, value = numbers[-1]
    before = quote[:start].rstrip(" (-")
    return value if before.endswith("=") else fallback


def row_amount_ok(quote: str, keywords: list[str], value: float) -> bool:
    from app.rules import row_amount_ok as _row
    return _row(quote, keywords, value)


def source_columns(doc: dict[str, Any], sources: list[dict[str, Any]], total: float) -> dict[str, Any] | None:
    from app.rules import source_columns as _cols
    return _cols(doc, sources, total)


def verify_citation(doc: dict[str, Any], field: str, value: float,
                    location: str | None, quote: str | None,
                    keywords: Iterable[str], percent: bool | None = None) -> str | None:
    """Rəqəm göstərilən mənbədə, düzgün göstəricinin yanında, eyni işarə ilə varmı.

    `percent` verilməyibsə, sahənin faiz olub-olmadığı `PERCENT_FIELDS`-dən götürülür.
    Qaytarır: None — təsdiqləndi; əks halda səbəb (Azərbaycan dilində).
    """
    is_percent = field in PERCENT_FIELDS if percent is None else percent
    if not location or not quote:
        return "mənbə (yer və sitat) göstərilməyib"
    found = location_lines(doc, location)
    if found is None:
        return f"göstərilən yer ('{location}') sənəddə yoxdur"
    if not any(contains_quote(line, quote) for line in found[1]):
        return f"sitat göstərilən yerdə ({location}) hərfi olaraq yoxdur"
    keywords = [fold(k) for k in keywords if fold(k)]
    folded = fold(quote)
    if not any(k in folded for k in keywords):
        return "sitatda göstəricinin adı yoxdur"
    if field == "sources" and row_amount_ok(folded, keywords, value):
        # Mənbə sətri ("Ad | 70% | … | 11 732 629"): məbləğ adın sətrindəki faiz olmayan xanadadır.
        # Skalyar göstəricilərə (NPV, IRR…) aid deyil — orada qonşu xana başqa ssenaridir.
        return None
    nearest = _closest_number(folded, keywords)
    if nearest is None or abs(nearest - value) > max(1e-6 * abs(value), 1e-9):
        nearest = _formula_result(folded, nearest)
    if nearest is None or abs(nearest - value) > max(1e-6 * abs(value), 1e-9):
        shown = "—" if nearest is None else format_az(nearest)
        return (f"sitatda göstəricinin yanındakı rəqəm ({shown}) agentin "
                f"rəqəminə ({format_az(value)}) işarəsi ilə birlikdə uyğun deyil")
    if is_percent and value not in percent_numbers(folded):
        return "sitatda rəqəmdən sonra faiz işarəsi yoxdur"
    return None


def _source_keywords(name: str | None) -> list[str]:
    """Mənbənin adındakı mənalı sözlərin kökləri (ilk 5 hərf)."""
    words = re.findall(r"[^\W\d_]{4,}", fold(name or ""))
    return [w[:5] for w in words]


def provenance(doc: dict[str, Any], claimed: Any) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    """Agentin hər rəqəmini ÖZ MƏNBƏYİ ilə tutuşdurur.

    Rəqəmin sənəddə hardasa olması kifayət deyil: agentin göstərdiyi bölmə və
    ya cədvəldə hərfi sitat olmalı, sitatda göstəricinin adı və ona ən yaxın
    rəqəm agentin rəqəmi (işarəsi ilə) olmalıdır. Təsdiqlənməyən dəyər `None`
    edilir və səbəbi ilə `not_found`-a düşür. Təsdiqlənən mənbələr
    `data["provenance"]`-da saxlanılır.
    """
    data: dict[str, Any] = (
        claimed.model_dump() if hasattr(claimed, "model_dump") else dict(claimed)
    )
    citations = {c.get("field"): c for c in data.pop("citations", None) or []
                 if isinstance(c, dict)}
    not_found: list[dict[str, Any]] = []
    verified: dict[str, dict[str, Any]] = {}

    for field in SCALAR_FIELDS:
        value = data.get(field)
        if value is None:
            continue
        cite = citations.get(field) or {}
        reason = verify_citation(doc, field, value, cite.get("location"), cite.get("quote"),
                                 FIELD_KEYWORDS.get(field, ()))
        if reason:
            not_found.append({"field": field, "label": FIELD_LABELS.get(field, field),
                              "value": value, "reason": reason})
            data[field] = None
            continue
        verified[field] = _source_record(doc, cite)
        written = written_decimals(cite.get("quote"), value)
        if written is not None:
            verified[field]["decimals"] = written         # "7,0" -> 1 (float itirir)

    sources: list[dict[str, Any]] = []
    for source in data.get("sources") or []:
        item = dict(source)
        amount = item.get("amount")
        if amount is not None:
            reason = verify_citation(doc, "sources", amount, item.get("location"),
                                     item.get("quote"), _source_keywords(item.get("name")))
            if reason:
                not_found.append({"field": "sources",
                                  "label": f"Mənbə: {item.get('name') or '?'}",
                                  "value": amount, "reason": reason})
                item["amount"] = None
            else:
                item["provenance"] = _source_record(doc, item)
        sources.append(item)
    data["sources"] = sources
    data["provenance"] = verified

    return data, not_found


def _source_record(doc: dict[str, Any], cite: dict[str, Any]) -> dict[str, Any]:
    found = location_lines(doc, cite.get("location"))
    return {
        "location": (cite.get("location") or "").strip(),
        "location_title": found[0] if found else "",
        "quote": cite.get("quote"),
        "unit": cite.get("unit"),
        "scenario": cite.get("scenario"),
    }


#: Diskont dərəcəsinin daha dəqiq yazılışı yalnız bu sözlər olan sətirlərdə axtarılır.
RATE_KEYWORDS: tuple[str, ...] = ("wacc", "diskont")


def refine_rate(doc: dict[str, Any], data: dict[str, Any]) -> dict[str, Any]:
    """Agent yuvarlaqlaşdırılmış dərəcə götürübsə (11,5%), daha dəqiqini (11,49%) qoyur.

    Sənəddə "WACC"/"diskont" sözü olan sətirlərdə elə faiz axtarılır ki, ondalıq
    rəqəmi çox olsun və agentin dəqiqliyinə yuvarlaqlaşdırıldıqda agentin
    rəqəminə bərabər olsun. Ən dəqiq namizəd YEGANƏDİRSƏ götürülür; əks halda
    agentin rəqəmi saxlanılır. Köhnə dəyər `discount_rate_refined_from`-da qalır.
    """
    rate = data.get("discount_rate_pct")
    if rate is None:
        return data
    places = decimals_of(rate)
    half_step = 0.5 * 10 ** -places + 1e-9
    candidates: dict[float, tuple[str, str]] = {}      # dəyər -> (yer, sətir)
    locations = [s["id"] for s in doc["sections"]] + [t["id"] for t in doc["tables"]]
    for location in locations:
        for line in (location_lines(doc, location) or ("", []))[1]:
            if not any(word in fold(line) for word in RATE_KEYWORDS):
                continue
            for value in percent_numbers(line):
                if decimals_of(value) > places and abs(value - rate) <= half_step:
                    candidates.setdefault(value, (location, line.strip()[:300]))
    if not candidates:
        return data
    best = max(decimals_of(v) for v in candidates)
    top = [v for v in candidates if decimals_of(v) == best]
    if len(top) != 1:
        return data
    location, line = candidates[top[0]]
    provenance_map = dict(data.get("provenance") or {})
    provenance_map["discount_rate_pct"] = _source_record(
        doc, {"location": location, "quote": line, "unit": "%",
              "scenario": (provenance_map.get("discount_rate_pct") or {}).get("scenario")})
    return {**data, "discount_rate_pct": top[0], "discount_rate_refined_from": rate,
            "provenance": provenance_map}


# ── Cədvəl sətrinin oxunması ───────────────────────────────────────────────

def read_row(doc: dict[str, Any], table_id: str | None, label: str | None) -> dict[str, Any]:
    """Cədvəldən bir sətri illər üzrə oxuyur.

    Birinci sütunu `label` ilə BAŞLAYAN İLK sətir götürülür — baza (güzəştli)
    ssenari cədvəldə birinci gəlir, ona görə bu qayda düzgün sətri seçir.

    Yalnız açıq yazılmış tire ("–") sıfırdır. Boş xana və rəqəmsiz mətn `None`
    olur və `missing`-ə düşür — oxunmayan dəyər sıfır kimi uydurulmur.
    """
    if not table_id:
        return {"ok": False, "error": "Pul axını cədvəlinin id-si göstərilməyib."}
    if not label:
        return {"ok": False, "error": "Sətrin adı göstərilməyib."}

    table = find_table(doc, table_id)
    if table is None:
        available = ", ".join(t["id"] for t in doc["tables"][:40])
        return {"ok": False, "error": f"'{table_id}' cədvəli tapılmadı. Mövcud id-lər: {available}"}

    header = year_header(table)
    if header is None:
        return {"ok": False,
                "error": f"'{table_id}' cədvəlində illər başlığı tapılmadı "
                         f"(ən azı 3 xanası 4 rəqəmli il olan sətir gözlənilir)."}
    header_row, years = header
    columns = [i for i, year in enumerate(years) if year is not None]

    needle = label.strip().casefold()
    for index, row in enumerate(table["rows"]):
        if index <= header_row or not row:
            continue
        if not row[0].strip().casefold().startswith(needle):
            continue
        values: list[float | None] = []
        for column in columns:
            cell = row[column] if column < len(row) else ""
            values.append(parse_number(cell) if cell.strip() else None)
        return {
            "ok": True,
            "table_id": table["id"],
            "row_label": row[0].strip(),
            "row_index": index,
            "years": [years[c] for c in columns],
            "values": values,
            "missing": [y for y, v in zip([years[c] for c in columns], values) if v is None],
        }

    labels = ", ".join(table["row_labels"][:20])
    return {"ok": False,
            "error": f"'{table_id}' cədvəlində '{label}' ilə başlayan sətir yoxdur. "
                     f"Mövcud sətirlər: {labels}"}


# ── Maliyyə riyaziyyatı ────────────────────────────────────────────────────

def npv(rate_pct: float, flows: Sequence[float]) -> float:
    """Xalis cari dəyər. t = 0 cədvəlin İLK ilidir."""
    rate = rate_pct / 100.0
    return sum(flow / (1.0 + rate) ** t for t, flow in enumerate(flows))


def irr(flows: Sequence[float]) -> float | None:
    """Daxili rentabellik norması, faizlə. Bisection; işarə dəyişmirsə None."""
    if not flows or all(f >= 0 for f in flows) or all(f <= 0 for f in flows):
        return None
    low, high = -0.9999, 10.0
    f_low = npv(low * 100, flows)
    if f_low * npv(high * 100, flows) > 0:
        return None
    for _ in range(200):
        mid = (low + high) / 2.0
        f_mid = npv(mid * 100, flows)
        if f_low * f_mid <= 0:
            high = mid
        else:
            low, f_low = mid, f_mid
    return (low + high) / 2.0 * 100.0


def payback(flows: Sequence[float]) -> float | None:
    """Özünü ödəmə müddəti, illə. İl daxilində xətti interpolyasiya."""
    cumulative = 0.0
    for index, flow in enumerate(flows):
        previous = cumulative
        cumulative += flow
        if previous < 0 <= cumulative and flow != 0:
            return (index - 1) + (-previous) / flow
    return None


# ── Yoxlamaların qurulması ─────────────────────────────────────────────────

def _check(check_id: str, title: str, critical: bool, status: str, detail: str,
           claimed: float | None = None, computed: float | None = None,
           diff: float | None = None, unit: str = "", decimals: int = 0,
           evidence: dict[str, Any] | None = None) -> dict[str, Any]:
    return {
        "id": check_id,
        "title": title,
        "critical": critical,
        "status": status,
        "claimed": claimed,
        "computed": computed,
        "diff": diff,
        "unit": unit,
        "decimals": decimals,
        "detail": detail,
        "evidence": evidence or {},
        "rule": RULES.get(check_id, ""),
    }


#: Hər yoxlamanın deterministik qaydası — detal panelində göstərilir.
RULES: dict[str, str] = {
    "investisiya_cemi": "Əsas vəsaitlər + dövriyyə kapitalı = ümumi investisiya. "
                        "≤1 manat fərq — uyğun; ≤0,5% — xəbərdarlıq; daha çox — uyğunsuzluq.",
    "menbeler_cemi": "Maliyyələşmə mənbələrinin cəmi = ümumi investisiya. "
                     "≤1 manat fərq — uyğun; ≤0,5% — xəbərdarlıq; daha çox — uyğunsuzluq.",
    "guc": "ton/saat × növbə saatı × növbə sayı × iş günü = nominal güc; "
           "nominal güc × gücdən istifadə% = praktiki güc.",
    "fcff_dusturu": "Hər il üçün FCFF = investisiya + EBITDA + mənfəət vergisi + "
                    "dövriyyə kapitalının dəyişməsi + qalıq dəyər (cədvəldəki işarələrlə). "
                    "İcazə verilən fərq ±2 manat.",
    "npv": "NPV cədvəlin FCFF sətrindən yenidən hesablanır (t = 0 — ilk il). "
           "≤1% fərq — uyğun (dərəcənin yuvarlaqlaşdırılması); >5% və ya fərqli işarə — uyğunsuzluq.",
    "irr": "IRR cədvəlin FCFF sətrindən bisection üsulu ilə tapılır. Bəyan edilən "
           "dəqiqliklə yuvarlaqlaşdırıldıqda eynidirsə — uyğun; ≤0,5 faiz bəndi — xəbərdarlıq.",
    "pp": "Özünü ödəmə müddəti kumulyativ FCFF-dən, il daxilində xətti interpolyasiya "
          "ilə tapılır. Bəyan edilən dəqiqliklə eynidirsə — uyğun; ≤0,2 il — xəbərdarlıq.",
}


def _money_status(claimed: float, computed: float) -> tuple[str, float]:
    """Pul məbləğləri üçün status və fərq."""
    diff = computed - claimed
    scale = max(abs(claimed), abs(computed), 1.0)
    if abs(diff) <= MONEY_OK_ABS:
        return "ok", diff
    if abs(diff) <= MONEY_WARN_REL * scale:
        return "warn", diff
    return "fail", diff


def _worse(a: str, b: str) -> str:
    order = {"ok": 0, "warn": 1, "skip": 2, "fail": 3}
    return a if order[a] >= order[b] else b


def _table_evidence(doc: dict[str, Any], table_id: str | None,
                    row: dict[str, Any] | None = None) -> dict[str, Any]:
    table = find_table(doc, table_id) if table_id else None
    if table is None:
        return {}
    evidence: dict[str, Any] = {
        "table_id": table["id"],
        "section_id": table["section_id"],
        "quote": table["caption"] or table["section_title"],
        "table_text": render_table(table, max_rows=20),
    }
    if row and row.get("ok"):
        evidence["row_label"] = row["row_label"]
    return evidence


def _text_evidence(doc: dict[str, Any], needles: Iterable[float | None]) -> dict[str, Any]:
    """Rəqəmin keçdiyi ilk cümləni mənbə fraqmenti kimi götürür."""
    values = [v for v in needles if v is not None]
    if not values:
        return {}
    for section in doc["sections"]:
        for line in section["text"].split("\n"):
            pool = all_numbers(line)
            if all(found_in(v, pool) for v in values):
                return {
                    "section_id": section["id"],
                    "quote": line.strip()[:600],
                }
    return {}


# ── 7 yoxlama ──────────────────────────────────────────────────────────────

def run_checks(doc: dict[str, Any], claimed: dict[str, Any]) -> dict[str, Any]:
    """7 yoxlamanı aparır. Qaytarır: {"checks": [...], "cashflow": {...}}."""
    checks: list[dict[str, Any]] = []

    checks.append(_check_investment(doc, claimed))
    checks.append(_check_sources(doc, claimed))
    checks.append(_check_capacity(doc, claimed))

    cashflow = _read_cashflow(doc, claimed)
    checks.append(_check_fcff_formula(doc, claimed, cashflow))
    checks.append(_check_npv(doc, claimed, cashflow))
    checks.append(_check_irr(doc, claimed, cashflow))
    checks.append(_check_payback(doc, claimed, cashflow))

    return {"checks": checks, "cashflow": cashflow}


def _check_investment(doc: dict[str, Any], c: dict[str, Any]) -> dict[str, Any]:
    total = c.get("investment_total")
    fixed = c.get("fixed_assets_investment")
    working = c.get("working_capital_investment")
    if total is None or fixed is None or working is None:
        missing = [FIELD_LABELS[f] for f, v in
                   (("investment_total", total), ("fixed_assets_investment", fixed),
                    ("working_capital_investment", working)) if v is None]
        return _check("investisiya_cemi", "İnvestisiyanın cəmi", True, "skip",
                      "Yoxlanıla bilmədi — sənəddə tapılmayan dəyər(lər): "
                      + ", ".join(missing) + ".", unit="manat")

    computed = fixed + working
    status, diff = _money_status(total, computed)
    detail = (f"Əsas vəsaitlər {_m(fixed)} + dövriyyə kapitalı "
              f"{_m(working)} = {_m(computed)} manat; "
              f"planda ümumi investisiya {_m(total)} manat.")
    if status != "ok":
        detail += f" Fərq: {_m(diff)} manat."
    return _check("investisiya_cemi", "İnvestisiyanın cəmi", True, status, detail,
                  claimed=total, computed=computed, diff=diff, unit="manat",
                  evidence=_text_evidence(doc, [total, fixed, working]))


def _check_sources(doc: dict[str, Any], c: dict[str, Any]) -> dict[str, Any]:
    total = c.get("investment_total")
    all_sources = c.get("sources") or []
    sources = [s for s in all_sources if s.get("amount") is not None]
    # Məbləği olmayan (və ya mənbəsi təsdiqlənməyən) mənbə varsa, qalanları
    # toplamaq yanlış ok/fail verər — cəm tam təsdiqlənə bilməz.
    unknown = [s.get("name") or "adsız mənbə" for s in all_sources if s.get("amount") is None]
    if total is None or not sources or unknown:
        if total is None:
            reason = "ümumi investisiya sənəddə tapılmadı"
        elif unknown:
            reason = "bu mənbələrin məbləği təsdiqlənmədi: " + ", ".join(unknown)
        else:
            reason = "maliyyələşmə mənbələri tapılmadı"
        return _check("menbeler_cemi", "Maliyyələşmə mənbələrinin cəmi", True, "skip",
                      f"Yoxlanıla bilmədi — {reason}.", unit="manat")

    computed = sum(s["amount"] for s in sources)
    status, diff = _money_status(total, computed)
    parts = ", ".join(f"{s['name']} {_m(s['amount'])}" for s in sources)
    detail = (f"Mənbələr: {parts}. Cəmi {_m(computed)} manat; "
              f"planda ümumi investisiya {_m(total)} manat.")
    clarify = None
    if status != "ok":
        detail += f" Fərq: {_m(diff)} manat."
        columns = source_columns(doc, sources, total)
        if columns:
            # Cədvəlin BAŞQA sütunu investisiyaya bərabərdir — uyğunsuzluq deyil, hansı məbləğin
            # nəzərdə tutulduğu qeyri-müəyyəndir: xəbərdarlıq + dəqiqləşdirmə.
            status = "warn"
            clarify = (f"Cədvəldə “{columns['matching']}” sütununun cəmi ümumi investisiyaya bərabərdir, "
                       f"“{columns['taken']}” sütunu isə ondan fərqlidir. İnvestisiyanı hansı məbləğin "
                       f"maliyyələşdirdiyini dəqiqləşdirin.")
            detail += " " + clarify
    check = _check("menbeler_cemi", "Maliyyələşmə mənbələrinin cəmi", True, status, detail,
                   claimed=total, computed=computed, diff=diff, unit="manat",
                   evidence=_text_evidence(doc, [s["amount"] for s in sources[:2]]))
    if clarify:
        check["clarify"] = clarify
    return check


def _check_capacity(doc: dict[str, Any], c: dict[str, Any]) -> dict[str, Any]:
    needed = ("capacity_t_per_hour", "shift_hours", "shifts_per_day",
              "work_days_per_year", "nominal_capacity_t")
    missing = [FIELD_LABELS[f] for f in needed if c.get(f) is None]
    if missing:
        return _check("guc", "İstehsal gücü", False, "skip",
                      "Yoxlanıla bilmədi — sənəddə tapılmayan dəyər(lər): "
                      + ", ".join(missing) + ".", unit="ton")

    per_hour = c["capacity_t_per_hour"]
    nominal_computed = (per_hour * c["shift_hours"] * c["shifts_per_day"]
                        * c["work_days_per_year"])
    nominal_claimed = c["nominal_capacity_t"]
    status, diff = _money_status(nominal_claimed, nominal_computed)
    detail = (f"{format_az(per_hour)} t/saat × {format_az(c['shift_hours'])} saat × "
              f"{format_az(c['shifts_per_day'])} növbə × {format_az(c['work_days_per_year'])} gün "
              f"= {_m(nominal_computed)} ton; planda {_m(nominal_claimed)} ton.")

    practical_claimed = c.get("practical_capacity_t")
    utilization = c.get("utilization_pct")
    if practical_claimed is None or utilization is None:
        detail += " Praktiki güc yoxlanılmadı — istifadə faizi və ya praktiki güc tapılmadı."
        status = _worse(status, "warn")
    else:
        practical_computed = nominal_claimed * utilization / 100.0
        p_status, p_diff = _money_status(practical_claimed, practical_computed)
        status = _worse(status, p_status)
        detail += (f" {_m(nominal_claimed)} ton × {format_az(utilization, 0)}% = "
                   f"{_m(practical_computed)} ton; planda "
                   f"{_m(practical_claimed)} ton.")
        if p_status != "ok":
            detail += f" Fərq: {_m(p_diff)} ton."

    return _check("guc", "İstehsal gücü", False, status, detail,
                  claimed=nominal_claimed, computed=nominal_computed, diff=diff, unit="ton",
                  evidence=_text_evidence(doc, [per_hour, nominal_claimed]))


def _read_cashflow(doc: dict[str, Any], c: dict[str, Any]) -> dict[str, Any]:
    """Pul axını cədvəlinin bütün lazımi sətirlərini oxuyur."""
    table_id = c.get("cashflow_table_id")
    rows = {
        "investment": read_row(doc, table_id, c.get("row_investment")),
        "ebitda": read_row(doc, table_id, c.get("row_ebitda")),
        "tax": read_row(doc, table_id, c.get("row_tax")),
        "wc_change": read_row(doc, table_id, c.get("row_wc_change")),
        "residual": read_row(doc, table_id, c.get("row_residual")),
        "fcff": read_row(doc, table_id, c.get("row_fcff")),
    }
    fcff = rows["fcff"]
    ok = bool(fcff.get("ok")) and not fcff.get("missing")
    return {
        "table_id": table_id,
        "rows": rows,
        "ok": ok,
        "years": fcff.get("years") if ok else None,
        "flows": fcff.get("values") if ok else None,
        "error": None if ok else (fcff.get("error") or "FCFF sətrində oxunmayan xana var."),
    }


def _skip_cashflow(check_id: str, title: str, critical: bool,
                   cashflow: dict[str, Any], unit: str) -> dict[str, Any]:
    return _check(check_id, title, critical, "skip",
                  f"Yoxlanıla bilmədi — pul axını cədvəli oxunmadı: {cashflow['error']}",
                  unit=unit)


def _check_fcff_formula(doc: dict[str, Any], c: dict[str, Any],
                        cashflow: dict[str, Any]) -> dict[str, Any]:
    title = "FCFF düsturu"
    if not cashflow["ok"]:
        return _skip_cashflow("fcff_dusturu", title, False, cashflow, "manat")

    rows = cashflow["rows"]
    parts = ["investment", "ebitda", "tax", "wc_change", "residual"]
    unread = [p for p in parts if not rows[p].get("ok")]
    if unread:
        reasons = "; ".join(rows[p]["error"] for p in unread)
        return _check("fcff_dusturu", title, False, "skip",
                      f"Yoxlanıla bilmədi — {reasons}", unit="manat",
                      evidence=_table_evidence(doc, cashflow["table_id"]))

    years = cashflow["years"]
    flows = cashflow["flows"]
    worst_year, worst_diff = None, 0.0
    unread_years: list[int] = []
    unread_cells: list[dict[str, Any]] = []        # hansı ildə hansı sətir oxunmadı
    for index, year in enumerate(years):
        values = [rows[p]["values"][index] if index < len(rows[p]["values"]) else None
                  for p in parts]
        if any(v is None for v in values):
            unread_years.append(year)
            unread_cells.append({"year": year, "rows": [
                rows[p]["row_label"] for p, v in zip(parts, values) if v is None]})
            continue
        diff = sum(values) - flows[index]
        if abs(diff) > abs(worst_diff):
            worst_year, worst_diff = year, diff

    unread_text = "; ".join(f"{u['year']} — {', '.join(u['rows'])}" for u in unread_cells)
    if abs(worst_diff) > FCFF_TOLERANCE:
        status = "fail"
        detail = (f"{worst_year}-ci ildə FCFF komponentlərin cəmindən "
                  f"{_m(worst_diff)} manat fərqlənir (icazə verilən "
                  f"±{FCFF_TOLERANCE:.0f} manat).")
        if unread_years:
            detail += f" Komponenti oxunmayan illər yoxlanılmadı: {unread_text}."
    elif unread_years:
        status = "skip"
        checked = len(years) - len(unread_years)
        detail = (f"Tam yoxlanıla bilmədi — {cashflow['table_id']} cədvəlində bu xanalar "
                  f"boş və ya rəqəmsizdir (il — sətir): {unread_text}. Oxunan {checked} "
                  f"ildə fərq tapılmadı.")
    else:
        status = "ok"
        detail = (f"Bütün illər ({years[0]}–{years[-1]}) üçün FCFF cədvəldəki "
                  f"komponentlərin cəminə bərabərdir (ən böyük fərq "
                  f"{_m(worst_diff)} manat, icazə verilən ±{FCFF_TOLERANCE:.0f}).")
    check = _check("fcff_dusturu", title, False, status, detail,
                   diff=worst_diff, unit="manat",
                   evidence=_table_evidence(doc, cashflow["table_id"], rows["fcff"]))
    check["unread_years"] = unread_years
    check["unread_cells"] = unread_cells
    return check


def _check_npv(doc: dict[str, Any], c: dict[str, Any],
               cashflow: dict[str, Any]) -> dict[str, Any]:
    title = "Xalis cari dəyər (NPV)"
    if not cashflow["ok"]:
        return _skip_cashflow("npv", title, True, cashflow, "manat")
    claimed = c.get("npv")
    rate = c.get("discount_rate_pct")
    if claimed is None or rate is None:
        missing = "NPV" if claimed is None else "diskont dərəcəsi"
        return _check("npv", title, True, "skip",
                      f"Yoxlanıla bilmədi — {missing} sənəddə tapılmadı.", unit="manat",
                      evidence=_table_evidence(doc, cashflow["table_id"]))

    computed = npv(rate, cashflow["flows"])
    diff = computed - claimed
    scale = max(abs(claimed), abs(computed), 1.0)
    relative = abs(diff) / scale
    if claimed * computed < 0:
        status = "fail"
    elif relative <= NPV_OK_REL:
        status = "ok"
    elif relative > NPV_FAIL_REL:
        status = "fail"
    else:
        status = "warn"

    detail = (f"{cashflow['table_id']} cədvəlinin FCFF sətri {format_az(rate, decimals_of(rate))}% "
              f"dərəcə ilə "
              f"yenidən diskontlaşdırıldı (t = 0 → {cashflow['years'][0]}): "
              f"{_m(computed)} manat; planda {_m(claimed)} manat. "
              f"Fərq {_m(diff)} manat ({format_az(relative * 100, 2)}%).")
    refined_from = c.get("discount_rate_refined_from")
    if refined_from is not None:
        detail += (f" Agent dərəcəni {format_az(refined_from, decimals_of(refined_from))}% "
                   f"kimi götürmüşdü; sənəddə daha dəqiq yazılış tapıldı.")
    if status == "ok":
        detail += " Fərq diskont dərəcəsinin yuvarlaqlaşdırılması ilə izah olunur."
    return _check("npv", title, True, status, detail,
                  claimed=claimed, computed=computed, diff=diff, unit="manat",
                  evidence=_table_evidence(doc, cashflow["table_id"], cashflow["rows"]["fcff"]))


def claimed_digits(c: dict[str, Any], field: str) -> int:
    """Planda rəqəmin YAZILDIĞI dəqiqlik: "7,0" -> 1, "7" -> 0.

    Mənbə sitatından götürülür (float "7,0"-ı "7"-yə çevirir). Sitat yoxdursa —
    float-dan təxmin.
    """
    written = ((c.get("provenance") or {}).get(field) or {}).get("decimals")
    return written if written is not None else decimals_of(c.get(field))


def round_half_up(value: float, digits: int) -> float:
    """Məktəb qaydası ilə yuvarlaqlaşdırma (6,95 -> 7,0); round() "bankir" qaydasıdır."""
    quantum = Decimal(1).scaleb(-digits)
    return float(Decimal(repr(value)).quantize(quantum, rounding=ROUND_HALF_UP))


def _check_irr(doc: dict[str, Any], c: dict[str, Any],
               cashflow: dict[str, Any]) -> dict[str, Any]:
    title = "Daxili rentabellik (IRR)"
    if not cashflow["ok"]:
        return _skip_cashflow("irr", title, False, cashflow, "%")
    claimed = c.get("irr_pct")
    if claimed is None:
        return _check("irr", title, False, "skip",
                      "Yoxlanıla bilmədi — IRR sənəddə tapılmadı.", unit="%",
                      evidence=_table_evidence(doc, cashflow["table_id"]))

    computed = irr(cashflow["flows"])
    if computed is None:
        return _check("irr", title, False, "skip",
                      "Yoxlanıla bilmədi — pul axınının işarəsi dəyişmir, IRR hesablanmır.",
                      claimed=claimed, unit="%",
                      evidence=_table_evidence(doc, cashflow["table_id"]))

    digits = claimed_digits(c, "irr_pct")
    diff = computed - claimed
    if round_half_up(computed, digits) == round_half_up(claimed, digits):
        status = "ok"
    elif abs(diff) <= IRR_WARN_PP:
        status = "warn"
    else:
        status = "fail"

    detail = (f"FCFF sətrindən hesablanan IRR {format_az(computed, 4)}%; planda "
              f"{format_az(claimed, digits)}%. Fərq {_n(diff, 4)} faiz bəndi.")
    if status == "ok":
        detail += f" Bəyan edilən dəqiqliklə ({digits} onluq) eynidir."
    return _check("irr", title, False, status, detail,
                  claimed=claimed, computed=computed, diff=diff, unit="%", decimals=2,
                  evidence=_table_evidence(doc, cashflow["table_id"], cashflow["rows"]["fcff"]))


def _check_payback(doc: dict[str, Any], c: dict[str, Any],
                   cashflow: dict[str, Any]) -> dict[str, Any]:
    title = "Özünü ödəmə müddəti (PP)"
    if not cashflow["ok"]:
        return _skip_cashflow("pp", title, False, cashflow, "il")
    claimed = c.get("payback_years")
    if claimed is None:
        return _check("pp", title, False, "skip",
                      "Yoxlanıla bilmədi — özünü ödəmə müddəti sənəddə tapılmadı.", unit="il",
                      evidence=_table_evidence(doc, cashflow["table_id"]))

    computed = payback(cashflow["flows"])
    if computed is None:
        return _check("pp", title, False, "skip",
                      "Yoxlanıla bilmədi — kumulyativ pul axını müsbətə keçmir.",
                      claimed=claimed, unit="il",
                      evidence=_table_evidence(doc, cashflow["table_id"]))

    digits = claimed_digits(c, "payback_years")
    diff = computed - claimed
    rounded = round_half_up(computed, digits)
    if rounded == round_half_up(claimed, digits):
        status = "ok"
        detail = (f"Kumulyativ FCFF-dən hesablanan müddət {format_az(computed, 2)} il; "
                  f"bəyan edilən dəqiqliklə {format_az(rounded, digits)} il — "
                  f"planla ({format_az(claimed, digits)} il) eynidir.")
    elif abs(diff) <= PP_WARN_YEARS:
        status = "warn"
        detail = (f"Hesablanan müddət {format_az(computed, 2)} il. "
                  f"{format_az(computed, 2)} yuvarlaqlaşanda "
                  f"{format_az(rounded, digits)} olur, planda isə "
                  f"{format_az(claimed, digits)} yazılıb. Fərq {_n(diff)} il — "
                  f"kiçikdir, lakin yuvarlaqlaşdırma istiqaməti düzəldilməlidir.")
    else:
        status = "fail"
        detail = (f"Hesablanan müddət {format_az(computed, 2)} il, planda "
                  f"{format_az(claimed, digits)} il. Fərq {_n(diff)} il.")

    return _check("pp", title, False, status, detail,
                  claimed=claimed, computed=computed, diff=diff, unit="il", decimals=2,
                  evidence=_table_evidence(doc, cashflow["table_id"], cashflow["rows"]["fcff"]))


# ── Qrafiklər üçün məlumat (hesablama Python-dadır, frontend yalnız çəkir) ──

def chart_data(claimed: dict[str, Any], cashflow: dict[str, Any]) -> dict[str, Any]:
    """Dörd qrafik üçün hazır məlumat — vahid, il və mənbə ilə.

    Məlumat tam deyilsə qrafik UYDURULMUR: `available=False` və `reason`.
    Mənbələr/investisiya bölgüsü yalnız bütün hissələrin mənbəsi təsdiqlənibsə
    qurulur. Bu, planın rəqəmlərinin vizual görüntüsüdür — iqtisadi qiymət deyil.
    """
    provenance_map = claimed.get("provenance") or {}

    def source_of(field: str) -> str | None:
        record = provenance_map.get(field) or {}
        return record.get("location") or None

    table_id = cashflow.get("table_id")
    if cashflow.get("ok") and cashflow.get("years") and cashflow.get("flows"):
        years = list(cashflow["years"])
        flows = [float(v) for v in cashflow["flows"]]
        cumulative, running = [], 0.0
        for value in flows:
            running += value
            cumulative.append(running)
        fcff = {"available": True, "unit": "manat", "source": table_id,
                "years": years, "values": flows}
        cumul = {"available": True, "unit": "manat", "source": table_id,
                 "years": years, "values": cumulative,
                 "note": "Diskontlaşdırılmamış kumulyativ FCFF (Python-da toplanıb)."}
    else:
        reason = cashflow.get("error") or "Pul axını cədvəli oxunmadı."
        fcff = {"available": False, "reason": reason}
        cumul = {"available": False, "reason": reason}

    sources = claimed.get("sources") or []
    if sources and all(s.get("amount") is not None for s in sources):
        funding = {"available": True, "unit": "manat",
                   "parts": [{"label": s.get("name") or "adsız", "value": float(s["amount"]),
                              "source": (s.get("provenance") or {}).get("location")}
                             for s in sources]}
    else:
        funding = {"available": False,
                   "reason": "Maliyyələşmə mənbələrinin hamısının məbləği təsdiqlənməyib."}

    fixed = claimed.get("fixed_assets_investment")
    working = claimed.get("working_capital_investment")
    if fixed is not None and working is not None:
        investment = {"available": True, "unit": "manat", "parts": [
            {"label": "Əsas vəsaitlər", "value": float(fixed),
             "source": source_of("fixed_assets_investment")},
            {"label": "Dövriyyə kapitalı", "value": float(working),
             "source": source_of("working_capital_investment")},
        ]}
    else:
        investment = {"available": False,
                      "reason": "Əsas vəsaitlər və dövriyyə kapitalı üzrə məbləğ təsdiqlənməyib."}

    for split in (funding, investment):              # paylar da Python-da hesablanır
        if split["available"]:
            total = sum(part["value"] for part in split["parts"])
            split["total"] = total
            for part in split["parts"]:
                part["share"] = part["value"] / total if total else None
    return {"fcff": fcff, "cumulative": cumul, "funding": funding, "investment": investment}
