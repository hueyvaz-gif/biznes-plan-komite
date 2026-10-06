"""Azərbaycan formatında yazılmış rəqəmlərin mətndən oxunması.

Qaydalar:
  • Minlik ayırıcı adi boşluq, NBSP (\u00a0) və ya dar NBSP (\u202f) ola bilər —
    Word rəqəmlərin içində çox vaxt NBSP istifadə edir.
  • Onluq ayırıcı vergüldür: "11,5%" -> 11.5 ; "6,9 il" -> 6.9.
    Nöqtə onluq ayırıcı SAYILMIR (çünki "15.10.2026" kimi tarixlər var).
  • Mötərizə mənfi deməkdir: "(1 496 452)" -> -1496452.
  • Yalnız tiredən ibarət xana ("–", "-", "—") sıfır deməkdir.
"""
from __future__ import annotations

import re
from decimal import Decimal
from typing import Iterable, Sequence

# Minlik ayırıcı kimi qəbul edilən boşluq növləri
SPACE_CHARS = " \u00a0\u202f\u2009\u2007"
# Mənfi işarə kimi qəbul edilən tire növləri
DASH_CHARS = "-\u2010\u2011\u2012\u2013\u2014\u2212"

_SP = re.escape(SPACE_CHARS)
_DS = re.escape(DASH_CHARS)

# Rəqəm şablonu: mötərizə / işarə / qruplaşdırılmış tam hissə / vergüllü kəsr hissə
_NUMBER_RE = re.compile(
    rf"""
    (?P<open>\()?                                   # açılan mötərizə (mənfi)
    [{_SP}]*
    (?P<sign>[{_DS}])?                              # mənfi işarə
    [{_SP}]*
    (?P<int>\d{{1,3}}(?:[{_SP}]\d{{3}})+|\d+)       # 1 234 567 və ya 1234567
    (?:,(?P<frac>\d+))?                             # ,56
    [{_SP}]*
    (?P<close>\))?                                  # bağlanan mötərizə
    """,
    re.VERBOSE,
)

# Yalnız tire (və boşluq) — maliyyə cədvəllərində "sıfır" mənasını verir
_DASH_ONLY_RE = re.compile(rf"^[{_SP}{_DS}]+$")


def is_dash_only(text: str) -> bool:
    """Mətn yalnız tire və boşluqdan ibarətdirsə True (cədvəldə sıfır deməkdir)."""
    return bool(text) and bool(_DASH_ONLY_RE.match(text))


def _to_float(m: re.Match[str]) -> float:
    digits = m.group("int")
    for ch in SPACE_CHARS:
        digits = digits.replace(ch, "")
    value = float(digits)
    if m.group("frac"):
        value = float(f"{digits}.{m.group('frac')}")
    negative = bool(m.group("sign")) or (bool(m.group("open")) and bool(m.group("close")))
    return -value if negative else value


def parse_number(text: str | None) -> float | None:
    """Mətndəki İLK rəqəmi qaytarır; rəqəm yoxdursa None.

    Yalnız tiredən ibarət mətn üçün 0.0 qaytarılır.
    """
    if text is None:
        return None
    if is_dash_only(text):
        return 0.0
    m = _NUMBER_RE.search(text)
    return _to_float(m) if m else None


def all_numbers(text: str | None) -> list[float]:
    """Mətndəki bütün rəqəmlərin MÜTLƏQ qiymətlərini qaytarır.

    Mənbə yoxlamasında işarə əhəmiyyət daşımır: sənəddə "(1 496 452)" yazılıbsa,
    agentin qaytardığı 1 496 452 də, -1 496 452 də sənəddə mövcud sayılır.
    """
    if not text:
        return []
    return [abs(_to_float(m)) for m in _NUMBER_RE.finditer(text)]


def signed_numbers(text: str | None) -> list[tuple[int, int, float]]:
    """Mətndəki rəqəmlər İŞARƏ və mövqe ilə: [(başlanğıc, son, dəyər), ...].

    Mövqe rəqəmin özünə aiddir (ətrafdakı boşluqlar və mötərizə daxil deyil),
    ona görə yanındakı sözə məsafəni düzgün ölçmək olur.
    """
    if not text:
        return []
    return [(m.start("int"), m.end("frac") if m.group("frac") else m.end("int"), _to_float(m))
            for m in _NUMBER_RE.finditer(text)]


def prose_numbers(text: str | None) -> list[tuple[int, int, float]]:
    """Sərbəst mətndəki rəqəmlər işarə ilə — `signed_numbers`-dən SƏRT işarə qaydası.

    Mənfi sayılır yalnız:
      • mötərizədə: "(1 196 310)";
      • işarə rəqəmə BİTİŞİKDİR və ondan əvvəl hərf/rəqəm yoxdur: "−1 196 310", "NPV -100".
    Müsbət qalır: "2027–2030" (aralıq), "IRR — 12,8%" (tire ilə rəqəm arasında boşluq).
    """
    if not text:
        return []
    out = []
    for m in _NUMBER_RE.finditer(text):
        digits = m.group("int")
        for ch in SPACE_CHARS:
            digits = digits.replace(ch, "")
        value = float(f"{digits}.{m.group('frac')}" if m.group("frac") else digits)
        negative = bool(m.group("open")) and bool(m.group("close"))
        if m.group("sign") and not negative:
            before = text[m.start("sign") - 1] if m.start("sign") > 0 else ""
            negative = m.end("sign") == m.start("int") and not before.isalnum()
        end = m.end("frac") if m.group("frac") else m.end("int")
        out.append((m.start("int"), end, -value if negative else value))
    return out


def found_signed(value: float, pool: Sequence[float], rel_tol: float = 1e-4) -> bool:
    """`value` hovuzda EYNİ işarə ilə varmı (sıfırın işarəsi yoxdur)."""
    same = [abs(c) for c in pool if c == 0 or value == 0 or (c < 0) == (value < 0)]
    return found_in(value, same, rel_tol=rel_tol)


def written_decimals(text: str | None, value: float) -> int | None:
    """Mətndə `value` necə yazılıb: onluq rəqəmlərin sayı ("7,0" -> 1, "7" -> 0).

    float-a çevrilmədə "7,0" ilə "7" eyniləşir; ilkin dəqiqlik buradan götürülür.
    Rəqəm mətndə yoxdursa None.
    """
    for m in _NUMBER_RE.finditer(text or ""):
        if abs(_to_float(m) - value) <= max(1e-9, 1e-9 * abs(value)):
            return len(m.group("frac") or "")
    return None


_FOLD_SPACES = re.compile(rf"[{_SP}]+")
_FOLD_DASHES = re.compile(rf"[{_DS}]")


def fold(text: str | None) -> str:
    """Müqayisə üçün normallaşdırma: kiçik hərf, vahid boşluq və tire.

    Azərbaycan "İ" hərfinin casefold-u "i" + birləşən nöqtə verir — nöqtə atılır,
    yoxsa "İnvestisiya" "investisiya" ilə tutuşmaz.
    """
    if not text:
        return ""
    text = text.casefold().replace("̇", "")
    text = _FOLD_DASHES.sub("-", text)
    return _FOLD_SPACES.sub(" ", text).strip()


_ELLIPSIS = re.compile(r"\.{3,}|…")


def _squash(text: str | None) -> str:
    """Tutuşdurma üçün: fold + cədvəl ayırıcısı "|" atılır (boş xanalar fərq yaratmasın)."""
    return _FOLD_SPACES.sub(" ", fold(text).replace("\n", " ").replace("|", " ")).strip()


def contains_quote(haystack: str | None, quote: str | None) -> bool:
    """Sitat mətndə HƏRFİ varmı (boşluq, tire, hərf ölçüsü və "|" fərqləri nəzərə alınmır).

    Model uzun cümləni "..." ilə qısalda və ya bir neçə sətri (məsələn, cədvəlin
    uzaq sətirlərini) yeni sətirlə birləşdirə bilər. Belə sitatın hər hissəsi
    hərfi olmalı və mətndə EYNİ ARDICILLIQLA gəlməlidir — hissələr uydurula
    bilməz, yalnız aradakı mətn buraxılır.
    """
    text = _squash(haystack)
    pieces = [piece for line in (quote or "").split("\n") for piece in _ELLIPSIS.split(line)]
    parts = [p for p in (_squash(x) for x in pieces) if p]
    if not parts:
        return False
    position = 0
    for part in parts:
        found = text.find(part, position)
        if found < 0:
            return False
        position = found + len(part)
    return True


def percent_numbers(text: str | None) -> list[float]:
    """Mətndə ardınca "%" gələn rəqəmlər: "= 11,49%." -> [11.49]."""
    if not text:
        return []
    return [abs(_to_float(m)) for m in _NUMBER_RE.finditer(text)
            if text[m.end():m.end() + 1] == "%"]


def found_in(value: float | int | None, pool: Sequence[float] | Iterable[float],
             rel_tol: float = 1e-6) -> bool:
    """`value` sənədin rəqəm hovuzunda varmı (mütləq qiymətə görə, dözümlülüklə)."""
    if value is None:
        return False
    target = abs(float(value))
    for candidate in pool:
        if abs(candidate - target) <= max(rel_tol * max(abs(candidate), target), 1e-9):
            return True
    return False


#: Onluq sayının yuxarı həddi — float-ın "quyruğu" mətnə düşməsin.
MAX_DECIMALS = 6


def decimals_of(value: float | int | None) -> int:
    """Bəyan edilmiş rəqəmin onluq dəqiqliyi: 6.9 -> 1, 11.49 -> 2, 1225241 -> 0."""
    if value is None:
        return 0
    exponent = Decimal(repr(float(value))).normalize().as_tuple().exponent
    if not isinstance(exponent, int):  # 'n'/'N'/'F' (NaN, sonsuzluq)
        return 0
    return min(MAX_DECIMALS, max(0, -exponent))


def format_az(value: float | int | None, decimals: int | None = None) -> str:
    """Rəqəmi Azərbaycan formatında yazır: minlik ayırıcı boşluq, onluq vergül."""
    if value is None:
        return "—"
    if decimals is None:
        decimals = decimals_of(value)
    text = f"{float(value):,.{decimals}f}"
    return text.replace(",", "\u00a0").replace(".", ",")
