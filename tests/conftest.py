"""Testlərin ümumi quraşdırması.

Real API HEÇ VAXT çağırılmır: LangSmith izləməsi söndürülür, DATA_DIR müvəqqəti
qovluğa yönəldilir, LLM isə saxta modellə əvəz olunur (2-ci mərhələdən etibarən).
"""
from __future__ import annotations

import os
import sys
import tempfile
from pathlib import Path

import pytest

# Konfiqurasiya import olunmamışdan ƏVVƏL mühit dəyişənləri qurulur.
_TMP = Path(tempfile.mkdtemp(prefix="komite-test-"))
os.environ["DATA_DIR"] = str(_TMP)
os.environ["LANGSMITH_TRACING"] = "false"
os.environ.pop("LANGSMITH_API_KEY", None)
# Real açarlar .env-dən YÜKLƏNMƏSİN: load_dotenv mövcud dəyişəni əvəz etmir.
for _key in ("ANTHROPIC_API_KEY", "GOOGLE_API_KEY", "LANGSMITH_API_KEY"):
    os.environ[_key] = "test-yoxdur"
os.environ["COMPLIANCE_GROUPS"] = ""
# Bazar icmalının real açarı testlərə düşməsin (boş dəyər .env-i də bloklayır).
os.environ["ALPHAVANTAGE_API_KEY"] = ""
# Bazar icmalı testlərdə susmaya görə söndürülüb (fon isinməsi şəbəkəyə getməsin);
# tests/test_market.py onu ayrıca, saxta HTTP ilə açır.
os.environ["MARKET_ENABLED"] = "0"
# Semantik yaddaş testlərdə lokal leksik embeddings ilə işləyir (şəbəkə və açar yoxdur).
os.environ["EMBEDDINGS_PROVIDER"] = "lexical"
# Testlər süni xəta (fail_at) ilə retry-ni yoxlayır — inkişaf rejimi açıqdır.
os.environ["DEV_MODE"] = "1"

BASE_DIR = Path(__file__).resolve().parent.parent
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))

SAMPLES_DIR = BASE_DIR / "samples"


@pytest.fixture(scope="session")
def samples() -> Path:
    """samples/ qovluğu. Yoxdursa testlər aydın səbəblə ötürülür."""
    if not (SAMPLES_DIR / "plan_demo_v1.docx").exists():
        pytest.skip(
            "samples/ hazır deyil. Əvvəlcə: "
            "python scripts/make_samples.py input/CFG_Biznes_Plan_ilkin.docx"
        )
    return SAMPLES_DIR


@pytest.fixture()
def data_dir() -> Path:
    """Testlər üçün müvəqqəti məlumat qovluğu."""
    return _TMP


@pytest.fixture(autouse=True)
def fake_llm():
    """HƏR testdə real model saxta modellə əvəz olunur — API çağırılmır."""
    from app import config, service
    from tests.fake_llm import FakeChatModel

    model = FakeChatModel()
    config.set_llm_override(model)
    service.reset_graphs()
    yield model
    config.set_llm_override(None)
    service.reset_graphs()


@pytest.fixture(autouse=True)
def no_network(monkeypatch):
    """Xarici şəbəkə bloklanır: təsadüfi real API çağırışı testi dərhal yıxır.

    Yalnız loopback (127.0.0.1, ::1) açıqdır — Windows-da asyncio öz daxili
    socket cütünü belə qurur, TestClient də buna ehtiyac duyur.
    """
    import socket

    real_connect = socket.socket.connect
    real_create = socket.create_connection
    local = {"127.0.0.1", "::1", "localhost"}

    def _host(address):
        return address[0] if isinstance(address, tuple) else address

    def connect(self, address, *args, **kwargs):
        if _host(address) not in local:
            raise RuntimeError(f"Testdə şəbəkə çağırışı qadağandır: {address}")
        return real_connect(self, address, *args, **kwargs)

    def create_connection(address, *args, **kwargs):
        if _host(address) not in local:
            raise RuntimeError(f"Testdə şəbəkə çağırışı qadağandır: {address}")
        return real_create(address, *args, **kwargs)

    monkeypatch.setattr(socket.socket, "connect", connect)
    monkeypatch.setattr(socket, "create_connection", create_connection)
