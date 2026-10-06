"""Frontend məntiqinin Node testləri (tests/js/*.test.js) — pytest-in bir hissəsi kimi.

Brauzer lazım deyil: polling və fayl seçimi DOM-dan ayrı modullardadır
(static/poll.js, static/upload.js). Node yoxdursa test aydın səbəblə ötürülür.
"""
from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

import pytest

JS_DIR = Path(__file__).resolve().parent / "js"


def test_js_modulları():
    node = shutil.which("node")
    if node is None:
        pytest.skip("Node.js tapılmadı — frontend testləri işə salınmadı.")
    files = sorted(str(p) for p in JS_DIR.glob("*.test.js"))
    assert files, "tests/js-də test faylı yoxdur"
    result = subprocess.run([node, "--test", *files], capture_output=True, text=True,
                            encoding="utf-8", timeout=120)
    assert result.returncode == 0, result.stdout[-4000:] + result.stderr[-2000:]
