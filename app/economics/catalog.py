"""İqtisadi təhlilin göstəriciləri: açar → ad, vahid, sitatda olmalı açar sözlər.

Kataloq həm modelə verilən təlimatda (nə tapmalı), həm də Python yoxlamasında (sitatda göstəricinin
adı var və rəqəm ona ən yaxındır) istifadə olunur.
"""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Any

import yaml

#: Skalyar rəqəmlər. `percent` — sitatda rəqəmdən sonra "%" olmalıdır.
FIGURES: dict[str, dict[str, Any]] = {
    "price_avg_per_t": {"label": "Orta çəkili satış qiyməti", "unit": "manat/t",
                        "keywords": ("qiymət",), "hint": "1 ton məhsulun orta (çəkili) satış qiyməti"},
    "raw_cost_per_t": {"label": "1 tona düşən xammal dəyəri", "unit": "manat/t", "keywords": ("xammal",),
                       "hint": "orta çəkili hesabla 1 ton məhsula düşən xammal dəyəri"},
    "variable_cost_per_t": {"label": "1 tona düşən dəyişən maya dəyəri", "unit": "manat/t",
                            "keywords": ("dəyişən",), "hint": "orta çəkili dəyişən maya dəyəri"},
    "fixed_cash_cost_per_t": {"label": "1 tona düşən sabit nağd xərc", "unit": "manat/t",
                              "keywords": ("sabit",), "hint": "tam maya dəyərinin sabit nağd hissəsi, 1 tona"},
    "depreciation_per_t": {"label": "1 tona düşən amortizasiya", "unit": "manat/t",
                           "keywords": ("amortizasiya",), "hint": "tam maya dəyərindəki amortizasiya, 1 tona"},
    "margin_per_t": {"label": "1 tona düşən marjinal gəlir", "unit": "manat/t", "keywords": ("marjinal",),
                     "hint": "orta çəkili marjinal gəlir (qiymət − dəyişən maya dəyəri)"},
    "raw_share_variable_pct": {"label": "Xammalın dəyişən maya dəyərində payı", "unit": "%", "percent": True,
                               "keywords": ("dəyişən",), "hint": "mətndə 'xammal dəyişən maya dəyərinin X%-i'"},
    "raw_share_full_pct": {"label": "Xammalın tam maya dəyərində payı", "unit": "%", "percent": True,
                           "keywords": ("tam",), "hint": "mətndə 'xammal tam maya dəyərinin X%-i'"},
    "staff_count": {"label": "Ştat sayı", "unit": "nəfər", "keywords": ("ştat", "nəfər", "işçi", "cəmi"),
                    "hint": "ştat cədvəlinin cəmi (nəfər)"},
    "payroll_monthly": {"label": "Aylıq əmək haqqı fondu", "unit": "manat/ay", "keywords": ("aylıq", "cəmi"),
                        "hint": "ştat cədvəlinin aylıq fondu (cəmi)"},
    "payroll_annual": {"label": "İllik əmək haqqı fondu", "unit": "manat/il", "keywords": ("illik", "əmək haqqı"),
                       "hint": "illik əmək haqqı fondu (birinci il)"},
    "electricity_kwh_year": {"label": "İllik elektrik sərfiyyatı", "unit": "kVt·st", "keywords": ("elektrik",),
                             "hint": "tam güc ilində illik elektrik sərfiyyatı"},
    "electricity_tariff": {"label": "Elektrik tarifi", "unit": "manat/kVt·st", "keywords": ("elektrik", "tarif"),
                           "hint": "1 kVt·st elektrik enerjisinin tarifi"},
    "electricity_cost": {"label": "İllik elektrik xərci", "unit": "manat", "keywords": ("elektrik",),
                         "hint": "həmin sərfiyyat üçün illik elektrik xərci"},
    "gas_m3_year": {"label": "İllik qaz sərfiyyatı", "unit": "m³", "keywords": ("qaz",),
                    "hint": "tam güc ilində illik təbii qaz sərfiyyatı"},
    "gas_tariff": {"label": "Qaz tarifi", "unit": "manat/m³", "keywords": ("qaz", "tarif"),
                   "hint": "1 m³ təbii qazın tarifi"},
    "gas_cost": {"label": "İllik qaz xərci", "unit": "manat", "keywords": ("qaz",),
                 "hint": "həmin sərfiyyat üçün illik qaz xərci"},
    "buildings_value": {"label": "Binalar və qurğular (ilkin dəyər)", "unit": "manat",
                        "keywords": ("bina",), "hint": "amortizasiya olunan binaların ilkin dəyəri"},
    "equipment_value": {"label": "Maşın və avadanlıqlar (ilkin dəyər)", "unit": "manat",
                        "keywords": ("avadanlıq", "maşın"), "hint": "amortizasiya olunan avadanlığın ilkin dəyəri"},
    "buildings_dep_rate_pct": {"label": "Binaların amortizasiya norması", "unit": "%", "percent": True,
                               "keywords": ("bina",), "hint": "binalar üzrə illik norma"},
    "equipment_dep_rate_pct": {"label": "Avadanlığın amortizasiya norması", "unit": "%", "percent": True,
                               "keywords": ("avadanlıq", "maşın"), "hint": "maşın və avadanlıq üzrə illik norma"},
    "receivable_days": {"label": "Debitor borcların dövriyyəsi", "unit": "gün", "keywords": ("debitor",),
                        "hint": "debitor borcları, gün"},
    "payable_days": {"label": "Kreditor borcların dövriyyəsi", "unit": "gün", "keywords": ("kreditor",),
                     "hint": "kreditor borcları, gün"},
    "inventory_days": {"label": "Ehtiyatların dövriyyəsi", "unit": "gün", "keywords": ("ehtiyat",),
                       "hint": "xammal və ya hazır məhsul ehtiyatı, gün"},
    "profit_tax_rate_pct": {"label": "Mənfəət vergisinin dərəcəsi", "unit": "%", "percent": True,
                            "keywords": ("mənfəət vergisi",), "hint": "modeldə tətbiq olunan dərəcə"},
    "vat_rate_pct": {"label": "ƏDV dərəcəsi", "unit": "%", "percent": True, "keywords": ("ədv",),
                     "hint": "modeldə tətbiq olunan ƏDV dərəcəsi"},
    "property_tax_rate_pct": {"label": "Əmlak vergisinin dərəcəsi", "unit": "%", "percent": True,
                              "keywords": ("əmlak vergisi",), "hint": "modeldə tətbiq olunan dərəcə"},
    "loan_amount": {"label": "Bank krediti", "unit": "manat", "keywords": ("kredit",),
                    "hint": "layihəyə cəlb olunan bank kreditinin məbləği (kredit yoxdursa göstərmə)"},
}

#: İllər üzrə sətirlər — Python cədvəldən özü oxuyur (`read_row`).
ROWS: dict[str, dict[str, Any]] = {
    "revenue": {"label": "Satış gəliri", "unit": "manat", "hint": "mənfəət-zərər hesabatında satış gəliri"},
    "sales_volume_t": {"label": "Satış həcmi", "unit": "ton", "hint": "illər üzrə satış həcmi, ton"},
    "utilization_pct": {"label": "Gücdən istifadə", "unit": "%", "hint": "illər üzrə gücdən istifadə faizi"},
    "raw_material_cost": {"label": "Xammal xərci", "unit": "manat", "hint": "illər üzrə xammal xərci"},
    "depreciation": {"label": "Amortizasiya", "unit": "manat", "hint": "illər üzrə amortizasiya (cəmi)"},
    "fixed_cash_costs": {"label": "Sabit nağd xərclər", "unit": "manat", "hint": "zərərsizlik cədvəlində"},
    "debt_service": {"label": "Borc xidməti (əsas borc)", "unit": "manat",
                     "hint": "kreditin əsas borcunun illik ödənişi (kredit varsa)"},
    "interest": {"label": "Kredit üzrə faiz", "unit": "manat", "hint": "kredit üzrə illik faiz xərci (kredit varsa)"},
}

#: Rəqəmsiz ifadələr — yalnız hərfi sitat yoxlanılır.
STATEMENTS: dict[str, dict[str, Any]] = {
    "incentives_claim": {"label": "Vergi güzəşti iddiası",
                         "hint": "sənaye parkı / investisiya təşviqi və ya başqa vergi güzəştinin iddia edildiyi cümlə"},
    "no_loan": {"label": "Kredit cəlb edilmir", "hint": "bank kreditinin cəlb edilmədiyini deyən cümlə (varsa)"},
    "discount_basis": {"label": "Diskont dərəcəsinin əsaslandırılması",
                       "hint": "diskont dərəcəsinin necə müəyyən edildiyini izah edən cümlə"},
    "schedule_window": {"label": "İcra qrafikinin müddəti",
                        "hint": "tikinti/quraşdırma qrafikinin başlama və bitmə ayı-ili (məs. 'dekabr 2026 – yanvar 2028')"},
    "company_name": {"label": "Şirkətin adı", "hint": "layihənin təşəbbüskarı olan şirkətin tam adı"},
}

#: Sual ↔ sənəd xəritəsi — `config/doc_requirements.yaml` (kodda hardcode yoxdur).
DOC_REQUIREMENTS_FILE = Path(__file__).resolve().parent.parent.parent / "config" / "doc_requirements.yaml"


@lru_cache(maxsize=1)
def doc_requirements() -> dict[str, Any]:
    with open(DOC_REQUIREMENTS_FILE, encoding="utf-8") as handle:
        data = yaml.safe_load(handle) or {}
    for key in ("senedler", "qaydalar", "hessasliq_ssenarileri", "realliq"):
        data.setdefault(key, {})
    return data


#: Tələb oluna bilən sənəd növləri (id → ad).
DOCUMENTS: dict[str, str] = doc_requirements()["senedler"]


def _known(docs: list[str] | None) -> list[str]:
    return [d for d in (docs or []) if d in DOCUMENTS]


def rule_docs(rule_id: str) -> list[str]:
    """Qayda üçün tələb olunan sənədlər; [] — yazılı cavab."""
    return _known(doc_requirements()["qaydalar"].get(rule_id))


def scenario_docs(scenario_id: str) -> list[str]:
    return _known(doc_requirements()["hessasliq_ssenarileri"].get(scenario_id))


def reality_docs(plan_key: str) -> list[str]:
    return _known(doc_requirements()["realliq"].get(plan_key))


def figure_label(key: str) -> str:
    return (FIGURES.get(key) or ROWS.get(key) or STATEMENTS.get(key) or {}).get("label", key)


def catalog_prompt() -> str:
    """Modelə verilən siyahı: açar — nə axtarmalı."""
    lines = ["RƏQƏMLƏR (figures):"]
    lines += [f"- {k}: {v['hint']} ({v['unit']})" for k, v in FIGURES.items()]
    lines.append("İLLƏR ÜZRƏ SƏTİRLƏR (rows):")
    lines += [f"- {k}: {v['hint']}" for k, v in ROWS.items()]
    lines.append("İFADƏLƏR (statements):")
    lines += [f"- {k}: {v['hint']}" for k, v in STATEMENTS.items()]
    return "\n".join(lines)
