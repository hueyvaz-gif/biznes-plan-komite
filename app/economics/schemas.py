"""İqtisadi təhlil üçün modelin strukturlaşdırılmış cavabları.

Model RƏQƏM VERMİR, yalnız YER göstərir:
  • cədvəldəki rəqəm üçün — cədvəl id-si, sətrin adı və sütunun başlığı (rəqəmi Python oxuyur);
  • mətndəki rəqəm üçün — hərfi sitat və köçürülmüş rəqəm (Python sitatla tutuşdurur);
  • illər üzrə sətir üçün — cədvəl id-si və sətrin adı (dəyərləri Python oxuyur).
"""
from __future__ import annotations

from pydantic import BaseModel, Field


class FigureRef(BaseModel):
    key: str = Field(description="Kataloqdakı açar, məsələn 'electricity_tariff'.")
    location: str = Field(description="Bölmənin ('S14') və ya cədvəlin ('T18') id-si.")
    quote: str = Field(description="Həmin yerdən HƏRFİ, qısa sitat: göstəricinin adı və rəqəmi. "
                                   "Cədvəldə: sətrin sənəddə yazıldığı kimi mətni.")
    value: float | None = Field(default=None, description="Sitatdakı rəqəm, köçürülmüş (hesablanmamış).")
    row_label: str | None = Field(default=None, description="Cədvəldədirsə: sətrin BİRİNCİ xanasının mətni, hərfbəhərf.")
    column: str | None = Field(default=None, description="Cədvəldədirsə: sütunun başlığı, hərfbəhərf (məs. 'Tarif, manat').")


class RowRef(BaseModel):
    key: str = Field(description="Kataloqdakı açar, məsələn 'revenue'.")
    table_id: str = Field(description="İllər başlığı olan cədvəlin id-si ('T22').")
    row_label: str = Field(description="Sətrin BİRİNCİ xanasının mətni, hərfbəhərf.")


class StatementRef(BaseModel):
    key: str = Field(description="Kataloqdakı açar, məsələn 'discount_basis'.")
    location: str = Field(description="Bölmənin və ya cədvəlin id-si.")
    quote: str = Field(description="HƏRFİ sitat — bir və ya iki cümlə.")


class EconomicLocations(BaseModel):
    """Planda iqtisadi təhlil üçün lazım olan yerlər — model yalnız göstərir, hesablamır."""

    figures: list[FigureRef] = Field(default_factory=list)
    rows: list[RowRef] = Field(default_factory=list)
    statements: list[StatementRef] = Field(default_factory=list)
    notes: str | None = Field(default=None, description="Tapılmayanlar haqqında qısa qeyd.")


class FactQuote(BaseModel):
    value: str | None = Field(default=None, description="Dəyər sənəddə yazıldığı kimi (rəqəm və ya mətn).")
    quote: str | None = Field(default=None, description="Dəyərin olduğu HƏRFİ sitat.")


class EvidenceFacts(BaseModel):
    """Əlavə sənəddən (təklif, niyyət məktubu, müqavilə) çıxarış — hər fakt hərfi sitatla."""

    doc_kind: str | None = Field(default=None, description="Sənədin növü: 'kommersiya_teklifi', 'niyyet_mektubu', "
                                                           "'muqavile', 'tarif_mektubu', 'diger'.")
    issuer: FactQuote = Field(default_factory=FactQuote, description="Sənədi verən tərəf (təchizatçı, alıcı).")
    addressee: FactQuote = Field(default_factory=FactQuote, description="Sənədin ünvanlandığı şirkət.")
    date: FactQuote = Field(default_factory=FactQuote, description="Sənədin tarixi.")
    amount: FactQuote = Field(default_factory=FactQuote, description="Məbləğ (rəqəm).")
    currency: FactQuote = Field(default_factory=FactQuote, description="Valyuta (USD, EUR, AZN...).")
    volume_t: FactQuote = Field(default_factory=FactQuote, description="Həcm, ton (illik).")
    valid_until: FactQuote = Field(default_factory=FactQuote, description="Etibarlılıq müddətinin sonu.")
    signature: FactQuote = Field(default_factory=FactQuote, description="İmza və ya möhür barədə qeyd (varsa).")
