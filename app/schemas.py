"""Agentlərin strukturlaşdırılmış cavabları (Pydantic v2).

Field-lərin `description` mətnləri LLM üçün TƏLİMAT rolunu oynayır — modelə
sxemlə birlikdə ötürülür. Ona görə onlar dəqiq və qısa yazılıb.

Bütün sahələr optionaldır: agent tapmadığı dəyəri `null` buraxmalıdır.
Uydurmaq qadağandır — tapılmayan rəqəm "sənəddə tapılmadı" kimi göstərilir.
"""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


LOCATION_HELP = "Rəqəmin olduğu bölmənin ('S14') və ya cədvəlin ('T27') id-si."
QUOTE_HELP = ("Həmin yerdən HƏRFİ, QISA sitat: göstəricinin adı və YALNIZ onun rəqəmi, "
              "sənəddə yazıldığı kimi. Cədvəldə: sətrin adı və baza ssenari xanası, "
              "məsələn 'Xalis cari dəyər (NPV), manat | 1 225 241'.")


class SourceAmount(BaseModel):
    """Maliyyələşmə mənbəyi və onun məbləği."""

    name: str = Field(description="Mənbənin adı, sənəddə yazıldığı kimi.")
    amount: float | None = Field(
        default=None,
        description="Mənbənin məbləği (manat). Tapılmasa null.",
    )
    location: str | None = Field(default=None, description=LOCATION_HELP)
    quote: str | None = Field(default=None, description=QUOTE_HELP)


class Citation(BaseModel):
    """Bir rəqəmin sənəddəki mənbəyi — Python onu sənədlə tutuşdurur."""

    field: str = Field(description="Sahənin adı, məsələn 'npv' və ya 'irr_pct'.")
    location: str = Field(description=LOCATION_HELP)
    quote: str = Field(description=QUOTE_HELP)
    unit: str | None = Field(
        default=None, description="Sənəddəki ölçü vahidi: 'manat', '%', 'il', 'ton', 't/saat'.")
    scenario: str | None = Field(
        default=None,
        description="Ssenarinin adı, cədvəldə və ya mətndə yazıldığı kimi ('Güzəştlərlə'). "
                    "Ssenari yoxdursa null.")


class ClaimedFigures(BaseModel):
    """Planda BƏYAN EDİLƏN rəqəmlər — agent yalnız köçürür, hesablamır."""

    # ── İnvestisiya ───────────────────────────────────────────────────────
    investment_total: float | None = Field(
        default=None,
        description="Layihənin ÜMUMİ investisiya həcmi, manat. "
                    "Nümunə: sənəddə '13 481 000 manat' yazılıbsa -> 13481000.",
    )
    fixed_assets_investment: float | None = Field(
        default=None,
        description="ƏSAS VƏSAİTLƏRƏ yönəldilən investisiya, manat.",
    )
    working_capital_investment: float | None = Field(
        default=None,
        description="DÖVRİYYƏ KAPİTALINA (və likvidlik ehtiyatına) yönəldilən "
                    "investisiya, manat.",
    )
    sources: list[SourceAmount] = Field(
        default_factory=list,
        description="Maliyyələşmə mənbələri: hər biri ad və məbləğ. "
                    "'Cəmi' sətrini bura DAXİL ETMƏ — o, ümumi məbləğdir.",
    )

    # ── İstehsal gücü ─────────────────────────────────────────────────────
    capacity_t_per_hour: float | None = Field(
        default=None, description="Xəttin nominal məhsuldarlığı, ton/saat.")
    shifts_per_day: float | None = Field(
        default=None, description="Gündəlik növbə sayı.")
    shift_hours: float | None = Field(
        default=None, description="Bir növbənin müddəti, saat.")
    work_days_per_year: float | None = Field(
        default=None, description="İllik iş günlərinin sayı.")
    utilization_pct: float | None = Field(
        default=None,
        description="Gücdən effektiv istifadə əmsalı, FAİZLƏ. "
                    "Nümunə: '80%' -> 80 (0.8 YOX).",
    )
    nominal_capacity_t: float | None = Field(
        default=None, description="Nominal illik güc, ton.")
    practical_capacity_t: float | None = Field(
        default=None, description="Praktiki illik güc, ton.")

    # ── Səmərəlilik göstəriciləri ─────────────────────────────────────────
    discount_rate_pct: float | None = Field(
        default=None,
        description="Diskont dərəcəsi (WACC), FAİZLƏ. Sənəddə bir neçə "
                    "variant varsa, ƏN DƏQİQ yazılanı götür: '11,5%' və "
                    "'11,49%' varsa -> 11.49.",
    )
    npv: float | None = Field(
        default=None,
        description="Xalis cari dəyər (NPV), manat. Baza (güzəştli) ssenari. "
                    "Mötərizə mənfi deməkdir: '(1 196 310)' -> -1196310.",
    )
    irr_pct: float | None = Field(
        default=None,
        description="Daxili rentabellik norması (IRR), FAİZLƏ. '12,8%' -> 12.8.",
    )
    payback_years: float | None = Field(
        default=None,
        description="Özünü ödəmə müddəti (PP), İLLƏ. '6,9 il' -> 6.9. "
                    "Diskontlaşdırılmış müddəti (DPBP) BURA YAZMA.",
    )

    # ── Pul axını cədvəli ─────────────────────────────────────────────────
    cashflow_table_id: str | None = Field(
        default=None,
        description="Layihənin pul axınları cədvəlinin id-si ('T27' kimi). "
                    "Bu, illər üzrə investisiya, EBITDA, vergi, dövriyyə "
                    "kapitalı və FCFF sətirləri olan cədvəldir.",
    )
    row_investment: str | None = Field(
        default=None,
        description="İnvestisiya sətrinin adı — cədvəlin BİRİNCİ sütununda "
                    "yazıldığı kimi, hərfbəhərf.",
    )
    row_ebitda: str | None = Field(
        default=None, description="EBITDA sətrinin adı, birinci sütundakı kimi.")
    row_tax: str | None = Field(
        default=None, description="Mənfəət vergisi sətrinin adı, birinci sütundakı kimi.")
    row_wc_change: str | None = Field(
        default=None,
        description="Dövriyyə kapitalının dəyişməsi sətrinin adı, birinci sütundakı kimi.")
    row_residual: str | None = Field(
        default=None,
        description="Layihənin qalıq dəyəri sətrinin adı, birinci sütundakı kimi.")
    row_fcff: str | None = Field(
        default=None,
        description="Sərbəst pul axını (FCFF) sətrinin adı, birinci sütundakı kimi.")

    citations: list[Citation] = Field(
        default_factory=list,
        description="Yuxarıdakı HƏR skalyar rəqəm üçün bir mənbə. Mənbəsi olmayan "
                    "rəqəm yoxlanılmış sayılmır və istifadə olunmur.",
    )

    notes: str | None = Field(
        default=None,
        description="Tapa bilmədiyin və ya şübhəli gördüyün şeylər haqqında "
                    "qısa qeyd (Azərbaycan dilində).",
    )


class RequirementResult(BaseModel):
    """Bir tələb üzrə nəticə."""

    req_id: str = Field(description="Tələbin id-si, siyahıda verildiyi kimi (məsələn 'IP3').")
    status: Literal["var", "natamam", "yoxdur", "tetbiq_edilmir"] = Field(
        description="'var' — tələb tam cavablanıb; 'natamam' — qismən "
                    "cavablanıb və ya doldurulmamış yer var; 'yoxdur' — planda yoxdur; "
                    "'tetbiq_edilmir' — YALNIZ şərtli tələbdə (məs. 'kredit varsa'), plan şərti "
                    "AÇIQ istisna edəndə (məs. 'Bank krediti cəlb edilmir'), hərfi sitatla.",
    )
    sections: list[str] = Field(
        default_factory=list,
        description="Cavabın tapıldığı bölmələrin ('S14') və ya cədvəllərin ('T5') "
                    "id-ləri — YALNIZ oxuduğun yerlər.",
    )
    quote: str | None = Field(
        default=None,
        description="Cavabı sübut edən HƏRFİ sitat — istinad edilən yerdən olduğu kimi.",
    )
    comment: str | None = Field(
        default=None,
        description="Sənin qısa şərhin (1 cümlə). Sitat deyil.",
    )
    missing: str | None = Field(
        default=None,
        description="Nə çatışmır — yalnız status 'natamam' və ya 'yoxdur' olanda.",
    )


class GroupResult(BaseModel):
    """Bir tələb qrupu üzrə nəticələr."""

    items: list[RequirementResult] = Field(
        description="Qrupdakı HƏR req_id üçün bir element.",
    )


class SummaryPoint(BaseModel):
    """Rəyin bir cümləsi və onun əsaslandığı faktlar."""

    text: str = Field(description="Bir cümlə, Azərbaycan dilində.")
    facts: list[str] = Field(
        default_factory=list,
        description="Bu cümlənin əsaslandığı faktların id-ləri ('F2', 'F5'). Ən azı bir. "
                    "Faktı olmayan cümlə atılır.",
    )


class CommitteeSummary(BaseModel):
    """Komitənin yekun rəyi — yalnız verilən faktlara əsaslanır.

    Başlıq (status) burada YOXDUR: o, yekun statusdan deterministik qurulur.
    """

    key_findings: list[SummaryPoint] = Field(
        default_factory=list,
        description="Ən vacib tapıntılar, ən çoxu 6 bənd, vaciblik sırası ilə.",
    )
    open_questions: list[SummaryPoint] = Field(
        default_factory=list,
        description="Plan müəllifinə veriləcək suallar, ən çoxu 6 bənd.",
    )


class ExtractedRequirement(BaseModel):
    """Əlavə tələb sənədindən çıxarılmış BİR tələb bəndi. Status YOXDUR —
    model yalnız bəndi strukturlaşdırır, planı qiymətləndirmir."""

    text: str = Field(description="Tələbin özü, qısa və aydın (Azərbaycan dilində).")
    kind: Literal["plan", "sened"] = Field(
        description="'plan' — biznes planın mətnində yoxlanır; 'sened' — ayrıca sənəd "
                    "(sertifikat, müqavilə surəti və s.) təqdim edilməsini tələb edir.")
    source_id: str = Field(description="Mənbə faylın id-si ('A1').")
    ref: str = Field(description="Hissənin istinadı, verildiyi kimi ('səh. 3', 'abzas 2').")
    fragment: str = Field(
        description="Mənbədən HƏRFİ fraqment — tələbin yazıldığı cümlə, olduğu kimi.")


class ExtractedRequirements(BaseModel):
    """Əlavə sənədlərdəki bütün tələb bəndləri."""

    items: list[ExtractedRequirement] = Field(default_factory=list)
