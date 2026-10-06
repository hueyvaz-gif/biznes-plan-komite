"""numbers.py — Azərbaycan formatında rəqəmlərin oxunması."""
from __future__ import annotations

import pytest

from app.numbers import (
    all_numbers,
    decimals_of,
    format_az,
    found_in,
    is_dash_only,
    parse_number,
)

NBSP = " "
NNBSP = " "


@pytest.mark.parametrize(
    "text, expected",
    [
        ("11,5%", 11.5),
        ("6,9 il", 6.9),
        ("1 225 241", 1225241.0),
        (f"1{NBSP}225{NBSP}241", 1225241.0),            # Word NBSP işlədir
        (f"1{NNBSP}225{NNBSP}241 manat", 1225241.0),    # dar NBSP
        ("(1 496 452)", -1496452.0),                    # mötərizə = mənfi
        (f"({NBSP}1{NBSP}496{NBSP}452{NBSP})", -1496452.0),
        ("-12,8", -12.8),
        ("–", 0.0),                                     # yalnız tire = sıfır
        ("-", 0.0),
        ("—", 0.0),
        ("  –  ", 0.0),
        ("mətn", None),
        ("", None),
        (None, None),
    ],
)
def test_parse_number(text, expected):
    assert parse_number(text) == expected


def test_nümrə_nöqtəsi_onluq_ayırıcı_deyil():
    """Nöqtə onluq ayırıcı sayılmır — "15.10.2026" tarixdir, rəqəm deyil."""
    assert parse_number("15.10.2026") == 15.0
    assert all_numbers("15.10.2026") == [15.0, 10.0, 2026.0]


def test_all_numbers_mütləq_qiymət_qaytarır():
    pool = all_numbers(f"İnvestisiya 13{NBSP}481{NBSP}000, zərər (1 496 452)")
    assert pool == [13481000.0, 1496452.0]


def test_found_in():
    pool = all_numbers(f"NPV 1{NBSP}225{NBSP}241 manat, IRR 12,8%")
    assert found_in(1225241, pool)
    assert found_in(-1225241, pool)       # işarə əhəmiyyət daşımır
    assert found_in(12.8, pool)
    assert not found_in(2225241, pool)
    assert not found_in(None, pool)


@pytest.mark.parametrize("value, expected", [(6.9, 1), (11.49, 2), (1225241, 0), (12.8, 1), (None, 0)])
def test_decimals_of(value, expected):
    assert decimals_of(value) == expected


def test_is_dash_only():
    assert is_dash_only("–")
    assert is_dash_only(f"{NBSP}—{NBSP}")
    assert not is_dash_only("0")
    assert not is_dash_only("")


def test_format_az():
    assert format_az(1225241) == f"1{NBSP}225{NBSP}241"
    assert format_az(11.49, 2) == "11,49"
    assert format_az(None) == "—"
