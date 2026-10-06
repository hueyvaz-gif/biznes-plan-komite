"""Test mühitinin izolyasiyası: xarici şəbəkə və real açarlar yoxdur."""
from __future__ import annotations

import os
import socket

import pytest

from app import config


def test_xarici_şəbəkə_bloklanıb():
    with pytest.raises(RuntimeError, match="qadağandır"):
        socket.create_connection(("api.anthropic.com", 443), timeout=1)


def test_real_açarlar_və_məlumat_qovluğu_testdə_yoxdur():
    assert os.environ["ANTHROPIC_API_KEY"] == "test-yoxdur"
    assert "komite-test-" in str(config.DATA_DIR)
