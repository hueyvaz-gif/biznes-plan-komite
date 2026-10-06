"""İqtisadi təhlilin qaydaları — hamısı deterministik, hamısı Python-da.

Hər qayda bir tapıntı qaytarır:
  {id, group, title, status, severity, formula, numbers[], result, question, documents[]}
  • status:   ok (keçdi) · flag (bayraq) · skip (yoxlanıla bilmədi) · info (məlumat) · na (tətbiq edilmir)
  • severity: yuksek · orta · asagi (yalnız flag və sual verilən info üçün)
  • numbers:  hər rəqəm ya sənəddən (yer + hərfi sitat), ya kodun hesabından (düstur) gəlir.
Sual mətni şablondur, rəqəmlər tapıntının özündən götürülür — AI yalnız sitatlanmış yeri göstərib.
"""
from __future__ import annotations

import re
from typing import Any, Callable

from app.economics import benchmarks, scenario, sensitivity
from app.economics.catalog import FIGURES, reality_docs, rule_docs, scenario_docs
from app.finance_tools import read_row
from app.numbers import format_az

# ── Qaydaların hədləri (daxili parametrlər — benchmark deyil) ─────────────────
TOL_OK = 0.01            # ≤ 1% — uyğun
TOL_WARN = 0.05          # ≤ 5% — kiçik fərq (aşağı ciddilik)
RAMP_FIRST_YEAR = 90.0   # 1-ci ildə gücdən istifadə ≥ 90% — real olmayan rampa
IRR_SPREAD_PP = 2.0      # IRR − diskont < 2 faiz bəndi — ehtiyat payı azdır
TV_SHARE_MAX = 60.0      # qalıq dəyərin müsbət PV-də payı > 60%
BREAK_EVEN_MAX = 70.0    # tam zərərsizlik həcmi praktiki gücün > 70%-i
DSCR_MIN = 1.2

DISCOUNT_BASIS_WORDS = ("uçot dərəcə", "risk mükafat", "risk primi", "refinans", "risksiz")

SEVERITY_ORDER = {"yuksek": 0, "orta": 1, "asagi": 2, None: 3}


def num(value: float | None, decimals: int | None = None) -> str:
    if value is None:
        return "—"
    if decimals is None:
        decimals = 0 if abs(value) >= 100 else 2
    text = format_az(round(value, decimals), decimals)
    if decimals and "," in text:
        text = text.rstrip("0").rstrip(",")
    return text


def _fmt(value: float | None, unit: str | None) -> str:
    if unit == "%":
        return num(value, 1) + "%"
    return num(value) + (f" {unit}" if unit else "")


def doc_number(label: str, fact: dict[str, Any]) -> dict[str, Any]:
    return {"label": label, "value": fact["value"], "unit": fact.get("unit"), "text": _fmt(fact["value"], fact.get("unit")),
            "source": fact["source"]}


def calc_number(label: str, value: float | None, unit: str | None, formula: str) -> dict[str, Any]:
    return {"label": label, "value": value, "unit": unit, "text": _fmt(value, unit),
            "source": {"kind": "hesab", "formula": formula}}


def row_number(label: str, row: dict[str, Any], year: int, value: float) -> dict[str, Any]:
    return {"label": f"{label}, {year}", "value": value, "unit": row.get("unit"), "text": _fmt(value, row.get("unit")),
            "source": row["source"]}


def finding(rule_id: str, group: str, title: str, status: str, *, severity: str | None = None,
            formula: str | None = None, numbers: list[dict[str, Any]] | None = None,
            result: str = "", question: str | None = None, documents: list[str] | None = None,
            extra: dict[str, Any] | None = None) -> dict[str, Any]:
    return {"id": rule_id, "group": group, "title": title, "status": status,
            "severity": severity if status in ("flag", "info") else None,
            "formula": formula, "numbers": numbers or [], "result": result,
            "question": question, "documents": documents or [], **(extra or {})}


def _rel(a: float, b: float) -> float:
    return abs(a - b) / abs(b) if b else (0.0 if a == b else float("inf"))


def _level(diff: float) -> tuple[str, str | None]:
    if diff <= TOL_OK:
        return "ok", None
    return "flag", "asagi" if diff <= TOL_WARN else "orta"


def _missing(rule_id: str, group: str, title: str, formula: str, what: list[str],
             documents: list[str] | None = None) -> dict[str, Any]:
    return finding(rule_id, group, title, "skip", formula=formula,
                   result="Yoxlanıla bilmədi — sənəddə tapılmayan və ya təsdiqlənməyən: " + ", ".join(what) + ".",
                   documents=documents)


# ── Kontekst: təsdiqlənmiş faktlar + maliyyə yoxlamasının nəticəsi ────────────

class Context:
    def __init__(self, doc: dict[str, Any], facts: dict[str, Any], finance: dict[str, Any] | None):
        self.doc = doc
        self.f = facts.get("figures") or {}
        self.r = facts.get("rows") or {}
        self.s = facts.get("statements") or {}
        self.fin = finance or {}
        self.claimed = self.fin.get("claimed") or {}
        self.prov = self.claimed.get("provenance") or {}
        cash = self.fin.get("cashflow") or {}
        self.years: list[int] = list(cash.get("years") or [])
        self.flows: list[float] = [float(v) for v in (cash.get("flows") or [])]

    def claimed_fact(self, field: str, label: str, unit: str) -> dict[str, Any] | None:
        """Maliyyə agentinin TƏSDİQLƏNMİŞ rəqəmi (mənbəyi ilə)."""
        value = self.claimed.get(field)
        if value is None:
            return None
        p = self.prov.get(field) or {}
        return {"value": float(value), "unit": unit, "label": label,
                "source": {"kind": "sened", "location": p.get("location"), "title": p.get("location_title"),
                           "quote": p.get("quote")}}

    def aligned(self, key: str) -> list[float] | None:
        return sensitivity.align(self.years, self.r.get(key)) if self.years else None

    def residual(self) -> list[float] | None:
        table, label = self.claimed.get("cashflow_table_id"), self.claimed.get("row_residual")
        if not (self.years and table and label):
            return None
        got = read_row(self.doc, table, label)
        if not got.get("ok"):
            return None
        return sensitivity.align(self.years, {"years": got["years"], "values": got["values"]})

    def cash_row(self, key: str) -> list[float] | None:
        """Pul axını cədvəlinin sətri (planın öz cədvəlindən, illərə düzülmüş): row_tax, row_residual …"""
        table, label = self.claimed.get("cashflow_table_id"), self.claimed.get(key)
        if not (self.years and table and label):
            return None
        got = read_row(self.doc, table, label)
        if not got.get("ok"):
            return None
        return sensitivity.align(self.years, {"years": got["years"], "values": got["values"]})

    def fig(self, key: str) -> float | None:
        v = (self.f.get(key) or {}).get("value")
        return float(v) if isinstance(v, (int, float)) else None

    def scenario_model(self) -> dict[str, Any] | None:
        """Ssenari modelinin girişləri — hamısı planın təsdiqlənmiş rəqəmləri (app/economics/scenario.py)."""
        rate = self.claimed.get("discount_rate_pct")
        if not self.flows or rate is None:
            return None
        return scenario.model_inputs(
            self.years, self.flows, rate, residual=self.residual(), tax=self.cash_row("row_tax"),
            revenue=self.aligned("revenue"), raw=self.aligned("raw_material_cost"), volume=self.aligned("sales_volume_t"),
            depreciation=self.aligned("depreciation"), tax_rate_pct=self.fig("profit_tax_rate_pct"),
            margin_per_t=self.fig("margin_per_t"), price_per_t=self.fig("price_avg_per_t"), raw_per_t=self.fig("raw_cost_per_t"),
            practical_capacity_t=self.claimed.get("practical_capacity_t"),
            fixed_assets_investment=self.claimed.get("fixed_assets_investment"),
            receivable_days=self.fig("receivable_days"), inventory_days=self.fig("inventory_days"),
            payable_days=self.fig("payable_days"))

    def residual_source(self) -> dict[str, Any]:
        return {"kind": "sened", "location": self.claimed.get("cashflow_table_id"),
                "quote": self.claimed.get("row_residual")}


def _pairs(ctx: Context, a: str, b: str) -> list[tuple[int, float, float]]:
    ra, rb = ctx.r.get(a), ctx.r.get(b)
    if not ra or not rb:
        return []
    by_b = {y: v for y, v in zip(rb["years"], rb["values"]) if v is not None}
    return [(y, v, by_b[y]) for y, v in zip(ra["years"], ra["values"]) if v is not None and y in by_b]


# ── 1a. Daxili məntiqi uyğunluq ──────────────────────────────────────────────

def rule_revenue(ctx: Context) -> dict[str, Any]:
    rid, title, formula = "gelir_hecm_qiymet", "Gəlir = həcm × qiymət", "Satış gəliri_t ≈ satış həcmi_t × orta qiymət"
    price = ctx.f.get("price_avg_per_t")
    pairs = _pairs(ctx, "revenue", "sales_volume_t")
    if not price or not pairs:
        what = [x for x, ok in (("orta satış qiyməti", price), ("illər üzrə gəlir və həcm", pairs)) if not ok]
        return _missing(rid, "daxili", title, formula, what)
    rows = [(y, rev, vol, vol * price["value"]) for y, rev, vol in pairs]
    worst = max(rows, key=lambda r: _rel(r[1], r[3]))
    status, severity = _level(_rel(worst[1], worst[3]))
    y, rev, vol, calc = worst
    numbers = [doc_number("Orta çəkili qiymət", price), row_number("Satış həcmi", ctx.r["sales_volume_t"], y, vol),
               row_number("Satış gəliri", ctx.r["revenue"], y, rev),
               calc_number(f"Həcm × qiymət, {y}", calc, "manat", f"{num(vol)} t × {num(price['value'])} manat/t")]
    result = (f"{len(rows)} il yoxlanıldı; ən böyük fərq {y}-ci ildə: planda {num(rev)}, hesab {num(calc)} manat "
              f"({num(_rel(rev, calc) * 100, 1)}%).")
    question = None if status == "ok" else (
        f"{y}-ci ildə satış gəliri {num(rev)} manat göstərilib, halbuki {num(vol)} t × {num(price['value'])} manat/t = "
        f"{num(calc)} manatdır. Fərq nədən yaranır (qiymət artımı, məhsul strukturu)?")
    return finding(rid, "daxili", title, status, severity=severity, formula=formula, numbers=numbers,
                   result=result, question=question)


def rule_capacity(ctx: Context) -> dict[str, Any]:
    rid, title, formula = "hecm_guc", "Satış həcmi ≤ istehsal gücü", "max(satış həcmi_t) ≤ praktiki illik güc"
    volume = ctx.r.get("sales_volume_t")
    cap = ctx.claimed_fact("practical_capacity_t", "Praktiki illik güc", "ton")
    if not volume or not cap:
        return _missing(rid, "daxili", title, formula,
                        [x for x, ok in (("illər üzrə satış həcmi", volume), ("praktiki güc", cap)) if not ok])
    year, peak = max(((y, v) for y, v in zip(volume["years"], volume["values"]) if v is not None), key=lambda p: p[1])
    over = peak > cap["value"] * (1 + 1e-9)
    numbers = [doc_number("Praktiki illik güc", cap), row_number("Ən böyük satış həcmi", volume, year, peak),
               calc_number("Gücdən istifadə", peak / cap["value"] * 100, "%", f"{num(peak)} / {num(cap['value'])}")]
    result = f"Ən böyük həcm {num(peak)} t ({year}) — praktiki gücün {num(peak / cap['value'] * 100, 1)}%-i."
    return finding(rid, "daxili", title, "flag" if over else "ok", severity="yuksek" if over else None,
                   formula=formula, numbers=numbers, result=result,
                   question=(f"{year}-ci ildə satış həcmi {num(peak)} t göstərilib, praktiki güc isə {num(cap['value'])} t-dur. "
                             f"Əlavə həcm hansı güc hesabına istehsal olunacaq?") if over else None)


def rule_ramp(ctx: Context) -> dict[str, Any]:
    rid, title = "guc_rampasi", "Gücdən istifadənin rampası"
    formula = f"1-ci il gücdən istifadə < {num(RAMP_FIRST_YEAR, 0)}%"
    util = ctx.r.get("utilization_pct")
    volume = ctx.r.get("sales_volume_t")
    cap = ctx.claimed_fact("practical_capacity_t", "Praktiki illik güc", "ton")
    if util and any(v is not None for v in util["values"]):
        year, first = next((y, v) for y, v in zip(util["years"], util["values"]) if v is not None)
        first_pct = first * 100 if first <= 1.5 else first
        numbers = [row_number("Gücdən istifadə", util, year, first)]
    elif volume and cap:
        year, vol = next((y, v) for y, v in zip(volume["years"], volume["values"]) if v is not None)
        first_pct = vol / cap["value"] * 100
        numbers = [row_number("Satış həcmi", volume, year, vol), doc_number("Praktiki illik güc", cap),
                   calc_number(f"Gücdən istifadə, {year}", first_pct, "%", f"{num(vol)} / {num(cap['value'])}")]
    else:
        return _missing(rid, "daxili", title, formula, ["illər üzrə gücdən istifadə və ya satış həcmi"])
    trend = [v for v in (util or volume)["values"] if v is not None]
    falling = any(b < a for a, b in zip(trend, trend[1:]))
    flag = first_pct >= RAMP_FIRST_YEAR
    result = f"Birinci il ({year}) gücdən istifadə {num(first_pct, 1)}%" + ("; sonrakı illərdə azalma var." if falling else ".")
    return finding(rid, "daxili", title, "flag" if flag else "ok", severity="orta" if flag else None,
                   formula=formula, numbers=numbers, result=result,
                   question=(f"Birinci ildə ({year}) gücdən istifadə {num(first_pct, 1)}% planlaşdırılıb. Sınaq istismarı və "
                             f"bazara giriş dövrü nəzərə alınmaqla bu nə ilə əsaslandırılır?") if flag else None)


def rule_raw_material(ctx: Context) -> dict[str, Any]:
    rid, title = "xammal_xerci", "Xammal xərci = norma × həcm × qiymət"
    formula = "Xammal xərci_t ≈ 1 tona düşən xammal dəyəri × satış həcmi_t"
    per_t = ctx.f.get("raw_cost_per_t")
    pairs = _pairs(ctx, "raw_material_cost", "sales_volume_t")
    if not per_t or not pairs:
        what = [x for x, ok in (("1 tona düşən xammal dəyəri", per_t), ("illər üzrə xammal xərci və həcm", pairs)) if not ok]
        return _missing(rid, "daxili", title, formula, what)
    rows = [(y, cost, vol, vol * per_t["value"]) for y, cost, vol in pairs]
    y, cost, vol, calc = max(rows, key=lambda r: _rel(r[1], r[3]))
    status, severity = _level(_rel(cost, calc))
    numbers = [doc_number("1 tona düşən xammal dəyəri", per_t), row_number("Satış həcmi", ctx.r["sales_volume_t"], y, vol),
               row_number("Xammal xərci", ctx.r["raw_material_cost"], y, cost),
               calc_number(f"Norma × həcm, {y}", calc, "manat", f"{num(vol)} t × {num(per_t['value'])} manat/t")]
    return finding(rid, "daxili", title, status, severity=severity, formula=formula, numbers=numbers,
                   result=f"{len(rows)} il yoxlanıldı; ən böyük fərq {y}: {num(_rel(cost, calc) * 100, 2)}%.",
                   question=None if status == "ok" else
                   (f"{y}-ci ildə xammal xərci {num(cost)} manat, {num(vol)} t × {num(per_t['value'])} manat/t isə "
                    f"{num(calc)} manatdır. Fərqi izah edin."))


def rule_energy(ctx: Context) -> dict[str, Any]:
    rid, title = "enerji_xerci", "Enerji xərci = sərfiyyat × tarif"
    formula = "elektrik: kVt·st × tarif; qaz: m³ × tarif"
    checks = []
    numbers: list[dict[str, Any]] = []
    for name, qty, tariff, cost, unit in (("Elektrik", "electricity_kwh_year", "electricity_tariff", "electricity_cost", "kVt·st"),
                                          ("Qaz", "gas_m3_year", "gas_tariff", "gas_cost", "m³")):
        q, t, c = ctx.f.get(qty), ctx.f.get(tariff), ctx.f.get(cost)
        if not (q and t and c):
            continue
        calc = q["value"] * t["value"]
        checks.append((name, c["value"], calc, _rel(c["value"], calc)))
        numbers += [doc_number(f"{name}: sərfiyyat", q), doc_number(f"{name}: tarif", t), doc_number(f"{name}: xərc", c),
                    calc_number(f"{name}: sərfiyyat × tarif", calc, "manat", f"{num(q['value'])} {unit} × {num(t['value'], 3)}")]
    if not checks:
        return _missing(rid, "daxili", title, formula, ["sərfiyyat, tarif və xərc (elektrik və ya qaz)"])
    name, plan, calc, diff = max(checks, key=lambda c: c[3])
    status, severity = _level(diff)
    return finding(rid, "daxili", title, status, severity=severity, formula=formula, numbers=numbers,
                   result="; ".join(f"{n}: planda {num(p)}, hesab {num(k)} manat" for n, p, k, _d in checks) + ".",
                   question=None if status == "ok" else f"{name} xərci {num(plan)} manat göstərilib, sərfiyyat × tarif isə {num(calc)} manatdır. Fərqi izah edin.")


def rule_payroll(ctx: Context) -> dict[str, Any]:
    rid, title = "emek_haqqi_fondu", "Əmək haqqı fondu = ştat × orta maaş"
    formula = "illik fond ≈ aylıq fond × 12; orta maaş = aylıq fond / ştat sayı"
    staff, monthly, annual = ctx.f.get("staff_count"), ctx.f.get("payroll_monthly"), ctx.f.get("payroll_annual")
    if not (staff and monthly):
        return _missing(rid, "daxili", title, formula,
                        [x for x, ok in (("ştat sayı", staff), ("aylıq fond", monthly)) if not ok])
    avg = monthly["value"] / staff["value"] if staff["value"] else None
    numbers = [doc_number("Ştat sayı", staff), doc_number("Aylıq fond", monthly),
               calc_number("Orta aylıq əmək haqqı", avg, "manat/ay", f"{num(monthly['value'])} / {num(staff['value'], 0)}")]
    status, severity, result = "ok", None, f"Orta aylıq əmək haqqı {num(avg)} manat (reallıq — benchmark ilə)."
    question = None
    if annual:
        calc = monthly["value"] * 12
        numbers += [doc_number("İllik fond", annual), calc_number("Aylıq fond × 12", calc, "manat", f"{num(monthly['value'])} × 12")]
        status, severity = _level(_rel(annual["value"], calc))
        result = f"İllik fond planda {num(annual['value'])}, hesab {num(calc)} manat. " + result
        if status != "ok":
            question = (f"İllik əmək haqqı fondu {num(annual['value'])} manat, aylıq fond × 12 isə {num(calc)} manatdır. "
                        f"Fərq (mükafat, indeksasiya) nədən yaranır?")
    return finding(rid, "daxili", title, status, severity=severity, formula=formula, numbers=numbers, result=result,
                   question=question, extra={"avg_wage": avg})


def rule_depreciation(ctx: Context) -> dict[str, Any]:
    rid, title = "amortizasiya", "Amortizasiya ≈ capex × norma"
    formula = "1-ci il amortizasiya ≈ binalar × norma_b + avadanlıq × norma_a"
    keys = ("buildings_value", "buildings_dep_rate_pct", "equipment_value", "equipment_dep_rate_pct")
    facts = [ctx.f.get(k) for k in keys]
    dep = ctx.r.get("depreciation")
    if not all(facts) or not dep:
        what = [FIGURES[k]["label"] for k, f in zip(keys, facts) if not f] + ([] if dep else ["illər üzrə amortizasiya"])
        return _missing(rid, "daxili", title, formula, what)
    b, br, e, er = (f["value"] for f in facts)
    calc = b * br / 100 + e * er / 100
    year, first = next((y, v) for y, v in zip(dep["years"], dep["values"]) if v)
    status, severity = _level(_rel(first, calc))
    numbers = [doc_number("Binalar", facts[0]), doc_number("Norma (binalar)", facts[1]),
               doc_number("Avadanlıq", facts[2]), doc_number("Norma (avadanlıq)", facts[3]),
               row_number("Amortizasiya", dep, year, first),
               calc_number(f"Hesab, {year}", calc, "manat", f"{num(b)} × {num(br, 1)}% + {num(e)} × {num(er, 1)}%")]
    return finding(rid, "daxili", title, status, severity=severity, formula=formula, numbers=numbers,
                   result=f"{year}: planda {num(first)}, hesab {num(calc)} manat.",
                   question=None if status == "ok" else f"{year}-ci il amortizasiyası {num(first)} manat, normalarla hesab {num(calc)} manatdır. Hansı metod tətbiq olunub?")


def rule_capex(ctx: Context) -> dict[str, Any]:
    rid, title = "capex_investisiya", "Capex cədvəli = investisiya cəmi"
    formula = "binalar + avadanlıq + dövriyyə kapitalı = ümumi investisiya"
    total = ctx.claimed_fact("investment_total", "Ümumi investisiya", "manat")
    wc = ctx.claimed_fact("working_capital_investment", "Dövriyyə kapitalı", "manat")
    b, e = ctx.f.get("buildings_value"), ctx.f.get("equipment_value")
    if not (total and wc and b and e):
        what = [x for x, ok in (("ümumi investisiya", total), ("dövriyyə kapitalı", wc), ("binalar", b), ("avadanlıq", e)) if not ok]
        return _missing(rid, "daxili", title, formula, what)
    calc = b["value"] + e["value"] + wc["value"]
    status, severity = _level(_rel(total["value"], calc))
    numbers = [doc_number("Binalar və qurğular", b), doc_number("Avadanlıq", e), doc_number("Dövriyyə kapitalı", wc),
               doc_number("Ümumi investisiya", total),
               calc_number("Cəm", calc, "manat", f"{num(b['value'])} + {num(e['value'])} + {num(wc['value'])}")]
    return finding(rid, "daxili", title, status, severity=severity, formula=formula, numbers=numbers,
                   result=f"Cəm {num(calc)} manat; planda {num(total['value'])} manat.",
                   question=None if status == "ok" else f"Capex komponentlərinin cəmi {num(calc)} manat, ümumi investisiya isə {num(total['value'])} manatdır. Fərqi izah edin.")


def rule_sources(ctx: Context) -> dict[str, Any]:
    """Maliyyələşmə mənbələri — maliyyə yoxlamasının ÖZ nəticəsi (təkrar hesablanmır)."""
    rid, title = "maliyyelesme_menbeleri", "İnvestisiya = maliyyələşmə mənbələri"
    formula = "Σ mənbələr = ümumi investisiya (maliyyə yoxlaması)"
    check = next((c for c in ctx.fin.get("checks") or [] if c.get("id") == "menbeler_cemi"), None)
    if not check or check.get("status") == "skip":
        return _missing(rid, "daxili", title, formula, ["maliyyələşmə mənbələrinin məbləğləri"])
    total = ctx.claimed_fact("investment_total", "Ümumi investisiya", "manat")
    numbers = ([doc_number("Ümumi investisiya", total)] if total else []) + [
        calc_number("Mənbələrin cəmi (agentin götürdüyü sütun)", check.get("computed"), "manat", "Σ mənbələr")]
    for s in (ctx.claimed.get("sources") or []):
        if s.get("amount") is not None and s.get("provenance"):
            numbers.append({"label": s.get("name"), "value": s["amount"], "unit": "manat", "text": _fmt(s["amount"], "manat"),
                            "source": {"kind": "sened", "location": s["provenance"].get("location"),
                                       "title": s["provenance"].get("location_title"), "quote": s["provenance"].get("quote")}})
    if check.get("status") == "ok":
        return finding(rid, "daxili", title, "ok", formula=formula, numbers=numbers, result=check.get("detail") or "")
    diff = (check.get("computed") or 0) - (check.get("claimed") or 0)
    question = (f"Maliyyələşmə mənbələrinin cəmi {num(check.get('computed'))} manat, ümumi investisiya isə "
                f"{num(check.get('claimed'))} manatdır (fərq {num(abs(diff))} manat). "
                + (check.get("clarify") or "Hansı məbləğ düzgündür?"))
    return finding(rid, "daxili", title, "flag", severity="orta", formula=formula, numbers=numbers,
                   result=check.get("detail") or "", question=question)


def rule_taxes(ctx: Context) -> dict[str, Any]:
    rid, title = "vergi_guzestleri", "Vergilər və güzəştlər"
    formula = "güzəşt iddia olunubsa — təsdiqləyici sənəd tələb olunur; dərəcələr reallıq yoxlamasında"
    claim = ctx.s.get("incentives_claim")
    rates = [doc_number(FIGURES[k]["label"], ctx.f[k]) for k in ("profit_tax_rate_pct", "vat_rate_pct", "property_tax_rate_pct")
             if ctx.f.get(k)]
    if not claim:
        return finding(rid, "daxili", title, "ok", formula=formula, numbers=rates,
                       result="Planda vergi güzəşti iddiası tapılmadı.")
    numbers = rates + [{"label": "Güzəşt iddiası", "value": None, "unit": None, "text": "", "source": claim["source"]}]
    return finding(rid, "daxili", title, "flag", severity="orta", formula=formula, numbers=numbers,
                   result="Planda vergi güzəşti iddia olunur — modeldəki vergi azadolmaları bu sənədə əsaslanır.",
                   question=("Planda vergi güzəştləri tətbiq olunub (“" + _short(claim["quote"]) + "”). Rezidentlik "
                             "şəhadətnaməsini və ya investisiya təşviqi sənədini təqdim edin; sənəd olmadıqda güzəştsiz "
                             "ssenari əsas götürülməlidir."))


def rule_working_capital(ctx: Context) -> dict[str, Any]:
    rid, title = "dovriyye_kapitali", "Dövriyyə kapitalının günləri"
    formula = "debitor, kreditor və ehtiyat günləri göstərilib və 0 deyil"
    keys = ("receivable_days", "payable_days", "inventory_days")
    got = {k: ctx.f.get(k) for k in keys}
    numbers = [doc_number(FIGURES[k]["label"], f) for k, f in got.items() if f]
    missing = [FIGURES[k]["label"].lower() for k, f in got.items() if not f]
    zero = [FIGURES[k]["label"].lower() for k, f in got.items() if f and f["value"] == 0]
    if zero:
        return finding(rid, "daxili", title, "flag", severity="orta", formula=formula, numbers=numbers,
                       result="Sıfır gün: " + ", ".join(zero) + ".",
                       question="Dövriyyə kapitalının hesabında " + ", ".join(zero) + " 0 gün götürülüb. Bu nə ilə əsaslandırılır?")
    if len(missing) == len(keys):
        return _missing(rid, "daxili", title, formula, missing)
    if missing:
        return finding(rid, "daxili", title, "flag", severity="asagi", formula=formula, numbers=numbers,
                       result="Göstərilməyib: " + ", ".join(missing) + ".",
                       question="Dövriyyə kapitalının hesabında " + ", ".join(missing) + " göstərilməyib. Hansı fərziyyə istifadə olunub?")
    return finding(rid, "daxili", title, "ok", formula=formula, numbers=numbers,
                   result=", ".join(f"{n['label'].lower()} {n['text']}" for n in numbers) + ".")


def rule_discount(ctx: Context) -> dict[str, Any]:
    rid, title = "diskont_esaslandirma", "Diskont dərəcəsinin əsaslandırılması"
    formula = "diskont dərəcəsi göstərilib və əsaslandırılıb (AMB uçot dərəcəsi / risksiz dərəcə + risk mükafatı)"
    rate = ctx.claimed_fact("discount_rate_pct", "Diskont dərəcəsi", "%")
    basis = ctx.s.get("discount_basis")
    if not rate:
        return finding(rid, "daxili", title, "flag", severity="orta", formula=formula, result="Diskont dərəcəsi təsdiqlənmədi.",
                       question="Layihənin diskont dərəcəsini və onun hesablanma qaydasını göstərin.")
    numbers = [doc_number("Diskont dərəcəsi", rate)]
    if basis:
        numbers.append({"label": "Əsaslandırma", "value": None, "unit": None, "text": "", "source": basis["source"]})
    folded = (basis or {}).get("quote", "").lower()
    if basis and any(w in folded for w in DISCOUNT_BASIS_WORDS):
        return finding(rid, "daxili", title, "ok", formula=formula, numbers=numbers,
                       result="Dərəcə bazis dərəcə və risk mükafatı ilə əsaslandırılıb.")
    return finding(rid, "daxili", title, "flag", severity="orta", formula=formula, numbers=numbers,
                   result=("Əsaslandırmada AMB uçot dərəcəsi / risksiz dərəcə və risk mükafatı göstərilməyib."
                           if basis else "Diskont dərəcəsinin əsaslandırılması tapılmadı."),
                   question=(f"Diskont dərəcəsi {num(rate['value'], 2)}% götürülüb"
                             + (f" (“{_short(basis['quote'])}”)" if basis else "")
                             + ". Bu dərəcəni AMB-nin uçot dərəcəsi (və ya risksiz dərəcə) və layihənin risk mükafatı ilə "
                               "əsaslandırın; real/nominal olmasını göstərin."))


def rule_irr_spread(ctx: Context) -> dict[str, Any]:
    rid, title = "irr_diskont_ferqi", "IRR – diskont dərəcəsi fərqi"
    formula = f"IRR − diskont ≥ {num(IRR_SPREAD_PP, 0)} faiz bəndi"
    irr_f = ctx.claimed_fact("irr_pct", "IRR", "%")
    rate = ctx.claimed_fact("discount_rate_pct", "Diskont dərəcəsi", "%")
    if not (irr_f and rate):
        return _missing(rid, "daxili", title, formula, [x for x, ok in (("IRR", irr_f), ("diskont dərəcəsi", rate)) if not ok])
    spread = irr_f["value"] - rate["value"]
    numbers = [doc_number("IRR", irr_f), doc_number("Diskont dərəcəsi", rate),
               calc_number("Fərq", spread, "faiz bəndi", f"{num(irr_f['value'], 2)} − {num(rate['value'], 2)}")]
    if spread >= IRR_SPREAD_PP:
        return finding(rid, "daxili", title, "ok", formula=formula, numbers=numbers,
                       result=f"IRR diskont dərəcəsindən {num(spread, 2)} faiz bəndi yüksəkdir.")
    severity = "yuksek" if spread < 0 else "orta"
    return finding(rid, "daxili", title, "flag", severity=severity, formula=formula, numbers=numbers,
                   result=f"IRR diskont dərəcəsindən cəmi {num(spread, 2)} faiz bəndi {'aşağıdır' if spread < 0 else 'yüksəkdir'}.",
                   question=(f"IRR ({num(irr_f['value'], 2)}%) ilə diskont dərəcəsi ({num(rate['value'], 2)}%) arasındakı fərq "
                             f"{num(spread, 2)} faiz bəndidir. Əsas fərziyyələr pisləşdikdə layihənin səmərəliliyi necə qorunur?"))


def rule_terminal(ctx: Context) -> dict[str, Any]:
    rid, title = "qaliq_deyer_payi", "Qalıq dəyərin NPV-dəki payı"
    formula = f"PV(qalıq dəyər) / PV(müsbət axınlar) ≤ {num(TV_SHARE_MAX, 0)}%; qalıq dəyərsiz NPV ≥ 0"
    rate = ctx.claimed.get("discount_rate_pct")
    residual = ctx.residual()
    if not (ctx.flows and rate is not None and residual):
        return _missing(rid, "daxili", title, formula, ["pul axını, diskont dərəcəsi və ya qalıq dəyər sətri"])
    tv = sensitivity.terminal_value(ctx.years, ctx.flows, residual, rate)
    if tv is None:
        return finding(rid, "daxili", title, "ok", formula=formula, result="Pul axınında qalıq dəyər yoxdur.")
    tv_year = tv["year"]
    tv_value = residual[ctx.years.index(tv_year)] if tv_year in ctx.years else None
    numbers = [{"label": f"Qalıq dəyər, {tv_year}", "value": tv_value, "unit": "manat", "text": _fmt(tv_value, "manat"),
                "source": ctx.residual_source()},
               calc_number("PV(qalıq dəyər)", tv["pv_residual"], "manat", f"{num(tv_value)} / (1 + {num(rate, 2)}%)^t"),
               calc_number("Payı (müsbət PV-də)", tv["share_pct"], "%", "PV(qalıq) / PV(müsbət axınlar)"),
               calc_number("NPV (kodun hesabı)", tv["npv"], "manat", "Σ FCFF_t / (1+r)^t"),
               calc_number("Qalıq dəyərsiz NPV", tv["npv_without"], "manat", "NPV − PV(qalıq dəyər)")]
    high_share = tv["share_pct"] is not None and tv["share_pct"] > TV_SHARE_MAX
    negative = tv["npv_without"] < 0
    if not (high_share or negative):
        return finding(rid, "daxili", title, "ok", formula=formula, numbers=numbers,
                       result=f"Qalıq dəyərin payı {num(tv['share_pct'], 1)}%; qalıq dəyərsiz NPV müsbətdir.")
    parts = []
    if high_share:
        parts.append(f"qalıq dəyər müsbət diskontlaşdırılmış axınların {num(tv['share_pct'], 1)}%-ni təşkil edir")
    if negative:
        parts.append(f"qalıq dəyər olmadan NPV mənfidir ({num(tv['npv_without'])} manat)")
    return finding(rid, "daxili", title, "flag", severity="orta", formula=formula, numbers=numbers,
                   result=upper_first("; ".join(parts)) + ".",
                   question=(f"{tv_year}-ci ildə {num(tv_value)} manat qalıq dəyər nəzərə alınıb; onsuz NPV "
                             f"{num(tv['npv_without'])} manatdır. Qalıq dəyər necə hesablanıb (aktivlərin satışı, dövriyyə "
                             f"kapitalının qaytarılması) və bu dəyər nə dərəcədə reallaşa bilər?"))


def rule_horizon(ctx: Context) -> dict[str, Any]:
    rid, title = "proqnoz_ufuqu", "Proqnoz üfüqü"
    if not ctx.years:
        return _missing(rid, "daxili", title, "pul axınının illəri", ["pul axını cədvəli"])
    return finding(rid, "daxili", title, "info", formula="pul axınının ilk və son ili",
                   numbers=[calc_number("İllərin sayı", len(ctx.years), "il", f"{ctx.years[0]}–{ctx.years[-1]}")],
                   result=f"Proqnoz {ctx.years[0]}–{ctx.years[-1]} ({len(ctx.years)} il, t = 0 daxil).")


def rule_dscr(ctx: Context) -> dict[str, Any]:
    rid, title = "dscr", "Borc xidmətinin örtülməsi (DSCR)"
    formula = f"DSCR_t = (EBITDA_t − vergi_t) / (əsas borc_t + faiz_t) ≥ {num(DSCR_MIN, 1)}"
    loan = ctx.f.get("loan_amount")
    no_loan = ctx.s.get("no_loan")
    has_credit_source = any("kredit" in (s.get("name") or "").lower() for s in ctx.claimed.get("sources") or [])
    if no_loan and not loan and not has_credit_source:
        return finding(rid, "daxili", title, "na", formula=formula,
                       numbers=[{"label": "Plan", "value": None, "unit": None, "text": "", "source": no_loan["source"]}],
                       result="Kredit cəlb edilmir — DSCR tətbiq edilmir.")
    if not loan and not has_credit_source:
        return finding(rid, "daxili", title, "na", formula=formula, result="Planda bank krediti tapılmadı.")
    principal, interest = ctx.aligned("debt_service"), ctx.aligned("interest")
    ebitda = _cashflow_row(ctx, "row_ebitda")
    tax = _cashflow_row(ctx, "row_tax")
    if not (principal and ebitda):
        return finding(rid, "daxili", title, "skip", formula=formula,
                       result="Kredit var, lakin borc ödənişi qrafiki və ya EBITDA sətri təsdiqlənmədi.",
                       question="Kreditin ödəniş qrafikini (əsas borc və faiz, illər üzrə) və bankın kredit təklifini təqdim edin.")
    values = []
    for i, year in enumerate(ctx.years):
        service = (principal[i] or 0) + ((interest[i] if interest else 0) or 0)
        if service:
            cfads = ebitda[i] + (tax[i] if tax else 0)       # vergi sətri mənfi işarə ilə yazılır
            values.append((year, cfads / service, cfads, service))
    if not values:
        return finding(rid, "daxili", title, "na", formula=formula, result="Borc ödənişi illəri tapılmadı.")
    year, worst, cfads, service = min(values, key=lambda v: v[1])
    numbers = [calc_number(f"DSCR, {year}", worst, None, f"{num(cfads)} / {num(service)}")]
    if worst >= DSCR_MIN:
        return finding(rid, "daxili", title, "ok", formula=formula, numbers=numbers,
                       result=f"Ən aşağı DSCR {num(worst, 2)} ({year}).")
    return finding(rid, "daxili", title, "flag", severity="yuksek", formula=formula, numbers=numbers,
                   result=f"{year}-ci ildə DSCR {num(worst, 2)} — {num(DSCR_MIN, 1)}-dən aşağıdır.",
                   question=(f"{year}-ci ildə borc xidməti {num(service)} manat, ödəmə qabiliyyətli pul axını isə {num(cfads)} "
                             f"manatdır (DSCR {num(worst, 2)}). Borc xidməti hansı mənbədən təmin olunacaq?"))


def _cashflow_row(ctx: Context, label_field: str) -> list[float] | None:
    table, label = ctx.claimed.get("cashflow_table_id"), ctx.claimed.get(label_field)
    if not (ctx.years and table and label):
        return None
    got = read_row(ctx.doc, table, label)
    if not got.get("ok"):
        return None
    return sensitivity.align(ctx.years, {"years": got["years"], "values": got["values"]})


MONTHS = {"yan": 1, "fev": 2, "mar": 3, "apr": 4, "may": 5, "iyn": 6, "iyun": 6, "iyl": 7, "iyul": 7, "avq": 8,
          "sen": 9, "okt": 10, "noy": 11, "dek": 12}


def parse_month_years(text: str) -> list[tuple[int, int]]:
    """'dekabr 2026 – yanvar 2028' → [(2026, 12), (2028, 1)]."""
    out = []
    for word, year in re.findall(r"([A-Za-zƏəÖöÜüĞğŞşÇçİı]+)\s+(\d{4})", text or ""):
        month = MONTHS.get(word.lower()[:4]) or MONTHS.get(word.lower()[:3])
        if month:
            out.append((int(year), month))
    return out


def rule_timeline(ctx: Context) -> dict[str, Any]:
    rid, title = "zaman_xetti", "Zaman xətti: tikinti ↔ satışın başlanması"
    formula = "icra qrafikinin bitmə ili ≤ satışın birinci ili"
    window = ctx.s.get("schedule_window")
    volume = ctx.r.get("sales_volume_t")
    if not (window and volume):
        return _missing(rid, "daxili", title, formula,
                        [x for x, ok in (("icra qrafikinin müddəti", window), ("illər üzrə satış həcmi", volume)) if not ok],
                        ["kommersiya_teklifi", "torpaq_cixarisi"])
    dates = parse_month_years(window["quote"])
    first_sales = next((y for y, v in zip(volume["years"], volume["values"]) if v), None)
    if not dates or first_sales is None:
        return _missing(rid, "daxili", title, formula, ["qrafikin tarixləri"])
    end_year, end_month = max(dates)
    numbers = [{"label": "İcra qrafiki", "value": None, "unit": None, "text": f"{end_month:02d}.{end_year}-də bitir",
                "source": window["source"]},
               row_number("Satışın birinci ili", volume, first_sales, next(v for v in volume["values"] if v))]
    if end_year > first_sales:
        return finding(rid, "daxili", title, "flag", severity="yuksek", formula=formula, numbers=numbers,
                       result=f"Qrafik {end_month:02d}.{end_year}-də bitir, satış isə {first_sales}-ci ildən planlaşdırılıb.",
                       question=(f"İcra qrafiki {end_month:02d}.{end_year}-də bitir, satış həcmi isə {first_sales}-ci ildən "
                                 f"göstərilib. Satış tikinti bitmədən necə başlayacaq?"))
    note = (f" Qrafik {first_sales}-ci ilin {end_month}-ci ayında bitir — birinci il tam il deyil."
            if end_year == first_sales and end_month > 1 else "")
    return finding(rid, "daxili", title, "info" if note else "ok", severity="asagi" if note else None,
                   formula=formula, numbers=numbers,
                   result=f"Qrafik {end_month:02d}.{end_year}-də bitir; satış {first_sales}-ci ildən." + note,
                   question=(f"Tikinti {first_sales}-ci ilin {end_month}-ci ayında bitir; birinci ilin satış həcmi bu "
                             f"gecikmə nəzərə alınıbmı?") if note else None)


def rule_raw_share(ctx: Context) -> dict[str, Any]:
    """Xammalın payı iki fərqli bazada (dəyişən və tam maya dəyəri) — ziddiyyət deyil, aydınlıq sualı."""
    rid, title = "xammal_payi_bazasi", "Xammalın maya dəyərində payı"
    formula = "xammal / dəyişən maya dəyəri; xammal / (dəyişən + sabit nağd + amortizasiya)"
    raw, var = ctx.f.get("raw_cost_per_t"), ctx.f.get("variable_cost_per_t")
    s_var, s_full = ctx.f.get("raw_share_variable_pct"), ctx.f.get("raw_share_full_pct")
    fixed, dep = ctx.f.get("fixed_cash_cost_per_t"), ctx.f.get("depreciation_per_t")
    if not (raw and var and (s_var or s_full)):
        return _missing(rid, "daxili", title, formula, ["xammal və maya dəyəri (1 tona) və ya pay faizləri"])
    numbers = [doc_number("Xammal, 1 tona", raw), doc_number("Dəyişən maya dəyəri, 1 tona", var)]
    checks = []
    if s_var:
        calc = raw["value"] / var["value"] * 100
        numbers += [doc_number("Plan: dəyişən maya dəyərində pay", s_var),
                    calc_number("Hesab: xammal / dəyişən", calc, "%", f"{num(raw['value'])} / {num(var['value'])}")]
        checks.append(("dəyişən", s_var["value"], calc))
    if s_full and fixed and dep:
        full = var["value"] + fixed["value"] + dep["value"]
        calc = raw["value"] / full * 100
        numbers += [doc_number("Sabit nağd xərc, 1 tona", fixed), doc_number("Amortizasiya, 1 tona", dep),
                    doc_number("Plan: tam maya dəyərində pay", s_full),
                    calc_number("Hesab: xammal / tam", calc, "%",
                                f"{num(raw['value'])} / ({num(var['value'])} + {num(fixed['value'])} + {num(dep['value'])})")]
        checks.append(("tam", s_full["value"], calc))
    bad = [c for c in checks if abs(c[1] - c[2]) > 1.0]           # 1 faiz bəndindən çox fərq
    if bad:
        base, plan, calc = bad[0]
        return finding(rid, "daxili", title, "flag", severity="orta", formula=formula, numbers=numbers,
                       result=f"Xammalın {base} maya dəyərində payı planda {num(plan, 1)}%, hesab {num(calc, 1)}%.",
                       question=f"Xammalın {base} maya dəyərində payı {num(plan, 1)}% göstərilib, planın öz rəqəmləri ilə {num(calc, 1)}%-dir. Hansı düzgündür?")
    if len(checks) == 2:
        return finding(rid, "daxili", title, "info", severity="asagi", formula=formula, numbers=numbers,
                       result=(f"Planda iki fərqli pay var — {num(s_var['value'], 1)}% (dəyişən maya dəyərində) və "
                               f"{num(s_full['value'], 1)}% (tam maya dəyərində). Hər ikisi planın öz rəqəmləri ilə düzdür; "
                               f"ziddiyyət deyil, bazalar fərqlidir."),
                       question=(f"Planda xammalın payı {num(s_var['value'], 1)}% (dəyişən maya dəyərində) və "
                                 f"{num(s_full['value'], 1)}% (tam maya dəyərində) göstərilib — hər ikisi rəqəmlərlə uyğundur. "
                                 f"Oxucu üçün maya dəyəri cədvəlində hansı bazanın nəzərdə tutulduğunu açıq göstərin."))
    return finding(rid, "daxili", title, "ok", formula=formula, numbers=numbers, result="Pay planın rəqəmləri ilə uyğundur.")


def upper_first(text: str) -> str:
    return text[:1].upper() + text[1:] if text else text


def lower_first(text: str) -> str:
    """Azərbaycan dilində: "İnvestisiya" → "investisiya" (Python-un lower() "i̇" yazır)."""
    if not text:
        return text
    head = {"İ": "i", "I": "ı"}.get(text[0], text[0].lower())
    return head + text[1:]


def _short(text: str, limit: int = 140) -> str:
    text = " ".join(str(text or "").split())
    return text if len(text) <= limit else text[: limit - 1].rsplit(" ", 1)[0] + "…"


# ── Həssaslıq və zərərsizlik ────────────────────────────────────────────────

SEVERITY_ORDER = {"yuksek": 3, "orta": 2, "asagi": 1}


def rule_sensitivity(ctx: Context) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    """Həssaslıq: hər ssenari planın öz metodu ilə yenidən hesablanır (scenario.py). Ümumi tapıntı XÜLASƏDİR
    (summary): sual vermir və bayraq sayına daxil edilmir; ciddiliyi ən ciddi ssenarininkidir."""
    rid, title = "hessasliq", "Həssaslıq: NPV < 0 olan ssenarilər"
    formula = "hər ssenaridə pul axını planın metodu ilə yenidən qurulur (vergi, dövriyyə kapitalı, qalıq dəyər) və NPV hesablanır"
    m = ctx.scenario_model()
    if m is None:
        return _missing(rid, "hessasliq", title, formula, ["pul axını (FCFF) və ya diskont dərəcəsi"]), []
    rows = scenario.scenarios(m)
    rate = m["rate_pct"]
    base = sum(f / (1 + rate / 100) ** t for t, f in enumerate(ctx.flows))
    negative = [r for r in rows if r.get("negative")]
    numbers = [calc_number("Baza NPV", base, "manat", "Σ FCFF_t / (1+r)^t")]
    numbers += [calc_number(r["title"], r["npv"], "manat", r["formula"]) for r in rows if r["status"] == "ok"]
    if not negative:
        return finding(rid, "hessasliq", title, "ok", formula=formula, numbers=numbers,
                       result="Heç bir ssenaridə NPV mənfi olmur. " + scenario.ASSUMPTIONS, extra={"summary": True}), rows
    levels = [r["severity"] for r in rows if r.get("severity")]
    severity = max(levels, key=lambda lv: SEVERITY_ORDER[lv]) if levels else "orta"
    names = ", ".join(f"{lower_first(r['title'])} ({num(r['npv'])} manat)" for r in negative)
    return finding(rid, "hessasliq", title, "flag", severity=severity, formula=formula, numbers=numbers,
                   result=f"{len(negative)} ssenaridə NPV mənfidir: {names}. Hər ssenari üzrə ayrıca sual verilir. "
                          + scenario.ASSUMPTIONS, extra={"summary": True}), rows


#: NPV < 0 ssenarisi üzrə sual — riskin necə idarə olunacağı (rəqəmlər ssenaridən).
SCENARIO_QUESTIONS: dict[str, str] = {
    "price_-10": ("Satış qiyməti 10% aşağı düşəndə NPV {npv} manat olur (baza {base} manat). Qiymət riski necə "
                  "idarə olunacaq — uzunmüddətli satış müqavilələri, qiymət formulu?"),
    "raw_+10": ("Xammal qiyməti 10% artanda NPV {npv} manat olur (baza {base} manat). Xammalın qiyməti necə "
                "sabitlənəcək — uzunmüddətli təchizat müqaviləsi, sabit qiymətli təklif, hedcinq?"),
    "capex_+15": ("İnvestisiya 15% artanda NPV {npv} manat olur (baza {base} manat). Capex smetası nə dərəcədə "
                  "dəqiqdir və gözlənilməz xərclər ehtiyatı necə əsaslandırılıb?"),
    "delay_1y": ("Satış 1 il gecikəndə NPV {npv} manat olur (baza {base} manat). Gecikmə riskinə qarşı hansı "
                 "tədbirlər nəzərdə tutulub?"),
    "capacity_80": ("Gücdən istifadə 80% olanda NPV {npv} manat olur (baza {base} manat). Planlaşdırılan satış həcmi "
                    "hansı müqavilələr və ya niyyət məktubları ilə təsdiqlənir?"),
}


def scenario_findings(rows: list[dict[str, Any]], ctx: Context) -> list[dict[str, Any]]:
    """Hər NPV < 0 ssenarisi — ayrıca tapıntı və sual; sənədləri ssenariyə görə (config)."""
    rate = ctx.claimed.get("discount_rate_pct")
    if not ctx.flows or rate is None:
        return []
    base = sum(f / (1 + rate / 100) ** t for t, f in enumerate(ctx.flows))
    out = []
    for r in rows:
        if not r.get("negative"):
            continue
        out.append(finding(
            f"hessasliq:{r['id']}", "hessasliq", f"Həssaslıq: {lower_first(r['title'])}", "flag",
            severity=r.get("severity") or "orta",
            formula=r["formula"],
            numbers=[calc_number("Baza NPV", base, "manat", "Σ FCFF_t / (1+r)^t"),
                     calc_number(r["title"], r["npv"], "manat", r["formula"]),
                     calc_number("ΔNPV", r["delta"], "manat", "ssenari NPV − baza NPV")],
            result=f"Bu ssenaridə NPV mənfidir: {num(r['npv'])} manat"
                   + (f"; sıfır həddi — {_threshold_text(r['threshold'])}" if r.get("threshold") else "")
                   + ". " + scenario.ASSUMPTIONS,
            question=SCENARIO_QUESTIONS.get(r["id"], "{npv}").format(npv=num(r["npv"]), base=num(base)),
            extra={"scenario": r["id"], "threshold": r.get("threshold")}))
    return out


def _threshold_text(t: dict[str, Any]) -> str:
    """Sıfır həddi mətnlə: "−1,0%" (dəyişmə) və ya "gücdən istifadə 87,5%" (səviyyə)."""
    if t["kind"] == "level":
        return f"gücdən istifadə {num(t['value'], 1)}%"
    return f"{'+' if t['value'] > 0 else '−'}{num(abs(t['value']), 2)}%"


def rule_break_even(ctx: Context) -> tuple[dict[str, Any], dict[str, Any] | None]:
    rid, title = "zerersizlik", "Zərərsizlik nöqtəsi (gücün %-i)"
    formula = "tam zərərsizlik həcmi = (sabit nağd xərc + amortizasiya) / marjinal gəlir 1 tona"
    margin = ctx.f.get("margin_per_t")
    cap = ctx.claimed.get("practical_capacity_t")
    be = sensitivity.break_even(ctx.years, ctx.aligned("sales_volume_t"), ctx.aligned("fixed_cash_costs"),
                                ctx.aligned("depreciation"), (margin or {}).get("value"), cap)
    if be is None:
        return _missing(rid, "hessasliq", title, formula, ["sabit nağd xərclər (illər üzrə) və ya marjinal gəlir 1 tona"]), None
    worst = be["max_pct_of_capacity"]
    numbers = [doc_number("Marjinal gəlir, 1 tona", margin)]
    numbers += [calc_number(f"Zərərsizlik həcmi, {r['year']}", r["break_even_t"], "ton",
                            f"(sabit + amortizasiya) / {num(margin['value'])}") for r in be["rows"][:3]]
    if worst is not None:
        numbers.append(calc_number("Ən yüksək — praktiki gücün", worst, "%", f"/ {num(cap)} t"))
    parts = []
    if worst is not None and worst > BREAK_EVEN_MAX:
        parts.append(f"zərərsizlik həcmi praktiki gücün {num(worst, 1)}%-nə çatır")
    if be["below"]:
        parts.append("satış həcmi zərərsizlik həcmindən aşağıdır: "
                     + ", ".join(f"{r['year']} ({num(r['volume'])} < {num(r['break_even_t'])} t)" for r in be["below"]))
    if not parts:
        return finding(rid, "hessasliq", title, "ok", formula=formula, numbers=numbers,
                       result=f"Zərərsizlik həcmi praktiki gücün ən çoxu {num(worst, 1)}%-idir."), be
    return finding(rid, "hessasliq", title, "flag", severity="orta", formula=formula, numbers=numbers,
                   result=upper_first("; ".join(parts)) + ".",
                   question=("Kodun hesabına görə " + "; ".join(parts) + ". Bu illərin zərəri hansı mənbədən örtüləcək?")), be


# ── 1b. Reallıq ─────────────────────────────────────────────────────────────

def reality(ctx: Context, payroll: dict[str, Any], sector: str = benchmarks.DEFAULT_SECTOR,
            path: Any = None) -> list[dict[str, Any]]:
    values = dict(ctx.f)
    if payroll.get("avg_wage") is not None:
        values["avg_wage"] = {"value": payroll["avg_wage"], "unit": "manat/ay", "label": "Orta aylıq əmək haqqı",
                              "source": {"kind": "hesab", "formula": "aylıq fond / ştat sayı"}}
    price, margin = ctx.f.get("price_avg_per_t"), ctx.f.get("margin_per_t")
    if price and margin and price["value"]:
        values["margin_pct"] = {"value": margin["value"] / price["value"] * 100, "unit": "%", "label": "Marja",
                                "source": {"kind": "hesab", "formula": "marjinal gəlir / qiymət"}}
    fixed_assets, cap = ctx.claimed.get("fixed_assets_investment"), ctx.claimed.get("practical_capacity_t")
    if fixed_assets and cap:
        values["capex_per_t"] = {"value": fixed_assets / cap, "unit": "manat/t", "label": "Capex 1 ton gücə",
                                 "source": {"kind": "hesab", "formula": "əsas vəsaitlər / praktiki güc"}}
    out = []
    for r in benchmarks.check(values, sector, path):
        rid = "realliq:" + str(r["id"])
        title = r["title"] or r["id"]
        plan = r.get("plan")
        numbers = []
        if plan:
            numbers.append(doc_number("Planda", plan) if plan["source"].get("kind") == "sened"
                           else calc_number("Planda (hesab)", plan["value"], plan.get("unit"), plan["source"]["formula"]))
        bm = r["benchmark"]
        if r["status"] == "skip":
            out.append(finding(rid, "realliq", title, "skip", formula="plan dəyəri benchmark diapazonunda",
                               numbers=numbers, result="Yoxlanıla bilməz — " + r["reason"] + ".",
                               extra={"benchmark": bm, "plan_key": r["plan_key"]}))
            continue
        rng = r["range_azn"]
        numbers.append({"label": "Benchmark", "value": None, "unit": r.get("unit"),
                        "text": f"{num(rng['min']) if rng['min'] is not None else '…'} – {num(rng['max']) if rng['max'] is not None else '…'} {r.get('unit') or ''}".strip(),
                        "source": {"kind": "benchmark", "name": bm.get("menbe"), "date": bm.get("tarix"),
                                   "converted": r.get("converted"), "file": r.get("file")}})
        if r["status"] == "ok":
            out.append(finding(rid, "realliq", title, "ok", formula="plan dəyəri benchmark diapazonunda", numbers=numbers,
                               result="Plan dəyəri diapazondadır.", extra={"benchmark": bm, "plan_key": r["plan_key"]}))
        else:
            out.append(finding(rid, "realliq", title, "flag", severity="orta", formula="plan dəyəri benchmark diapazonunda",
                               numbers=numbers, result=f"Plan dəyəri diapazondan {r['direction']}dır.",
                               question=(f"{title}: planda {_fmt(plan['value'], plan.get('unit'))}, "
                                         f"bazar diapazonu isə {numbers[-1]['text']} ({bm.get('menbe')}, {bm.get('tarix')}). "
                                         f"Fərqi əsaslandırın."), extra={"benchmark": bm, "plan_key": r["plan_key"]}))
    return out




# ── Hamısı birlikdə ─────────────────────────────────────────────────────────

INTERNAL_RULES: tuple[Callable[[Context], dict[str, Any]], ...] = (
    rule_revenue, rule_capacity, rule_ramp, rule_raw_material, rule_energy, rule_payroll, rule_depreciation,
    rule_capex, rule_sources, rule_taxes, rule_working_capital, rule_discount, rule_irr_spread, rule_terminal,
    rule_horizon, rule_dscr, rule_timeline, rule_raw_share,
)


def evaluate(doc: dict[str, Any], facts: dict[str, Any], finance: dict[str, Any] | None,
             benchmark_path: Any = None) -> dict[str, Any]:
    ctx = Context(doc, facts, finance)
    findings: list[dict[str, Any]] = []
    payroll: dict[str, Any] = {}
    for rule in INTERNAL_RULES:
        try:
            result = rule(ctx)
        except Exception as exc:                     # bir qaydanın xətası digərlərinə mane olmur
            result = finding(rule.__name__.replace("rule_", ""), "daxili", rule.__name__, "skip",
                             result=f"Qayda icra olunmadı ({type(exc).__name__}).")
        if rule is rule_payroll:
            payroll = result
        findings.append(result)
    sens, scenarios = rule_sensitivity(ctx)
    be_finding, be = rule_break_even(ctx)
    findings += [sens, *scenario_findings(scenarios, ctx), be_finding]
    findings += reality(ctx, payroll, path=benchmark_path)
    for f in findings:
        f.pop("avg_wage", None)
        f["documents"] = required_documents(f)
    rate = ctx.claimed.get("discount_rate_pct")
    base = sensitivity.base_case(ctx.flows, rate) if ctx.flows and rate is not None else None
    return {"findings": findings, "sensitivity": {"scenarios": scenarios, "assumption": scenario.ASSUMPTIONS,
                                                 "break_even": be, "base": base, "model": ctx.scenario_model(),
                                                 "severity_limits": [list(x) for x in scenario.SEVERITY_LIMITS]},
            "risk": risk_level(findings, scenarios, ctx)}


def required_documents(f: dict[str, Any]) -> list[str]:
    """Tələb olunan sənədlər — YALNIZ sualı olan tapıntıya, `config/doc_requirements.yaml`-dan.
    Boş siyahı — sənəd tələb olunmur, ərizəçi yazılı cavab verir."""
    if not f.get("question"):
        return []
    if f.get("scenario"):
        return scenario_docs(f["scenario"])
    if f["group"] == "realliq":
        return reality_docs(f.get("plan_key") or "")
    return rule_docs(f["id"])


def risk_level(findings: list[dict[str, Any]], scenarios: list[dict[str, Any]], ctx: Context) -> dict[str, Any]:
    """Qayda: yüksək — 'yüksək' ciddilikli bayraq, ≥ 2 ssenaridə NPV < 0 və ya baza NPV < 0;
    orta — 'orta' bayraq və ya 1 ssenaridə NPV < 0; əks halda aşağı."""
    flags = [f for f in findings if f["status"] == "flag" and not f.get("summary")]
    negative = [s for s in scenarios if s.get("negative")]
    reasons = []
    base_negative = False
    if ctx.flows and ctx.claimed.get("discount_rate_pct") is not None:
        rate = ctx.claimed["discount_rate_pct"]
        base_negative = sum(f / (1 + rate / 100) ** t for t, f in enumerate(ctx.flows)) < 0
    if base_negative:
        reasons.append("baza ssenaridə NPV mənfidir")
    if len(negative) >= 2:
        reasons.append(f"{len(negative)} həssaslıq ssenarisində NPV mənfidir")
    high = [f for f in flags if f["severity"] == "yuksek"]
    if high:
        reasons.append("yüksək ciddilikli tapıntı: " + ", ".join(f["title"] for f in high))
    if reasons:
        return {"level": "yuksek", "label": "yüksək", "reasons": reasons}
    mid = [f for f in flags if f["severity"] == "orta"]
    if len(negative) == 1:
        reasons.append("1 həssaslıq ssenarisində NPV mənfidir")
    if mid:
        reasons.append(f"{len(mid)} orta ciddilikli tapıntı")
    if reasons:
        return {"level": "orta", "label": "orta", "reasons": reasons}
    return {"level": "asagi", "label": "aşağı", "reasons": ["bayraqlanan tapıntı yoxdur"]}
