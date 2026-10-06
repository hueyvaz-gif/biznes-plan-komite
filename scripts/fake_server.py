"""Saxta modelli yerli server — interfeysi real API olmadan, uçdan-uca sınamaq üçün.

    python scripts/fake_server.py            # http://127.0.0.1:8011

- Model: tests/fake_llm.py (ödənişli API çağırılmır, şəbəkə lazım deyil).
- Məlumat: MÜVƏQQƏTİ qovluq — real baza və yüklənmiş sənədlərə toxunulmur.
- İnkişaf rejimi açıqdır (süni xəta seçimi görünür).
Nəticələr real deyil; yalnız axını və interfeysi yoxlamaq üçündür.
"""
from __future__ import annotations

import os
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
# Windows konsolu (cp1252) "ə" hərfini çap edə bilmir — PYTHONUTF8 olmadan da işləsin.
for stream in (sys.stdout, sys.stderr):
    if hasattr(stream, "reconfigure"):
        stream.reconfigure(encoding="utf-8", errors="replace")
os.environ.update({
    "DATA_DIR": tempfile.mkdtemp(prefix="komite-fake-"), "LANGSMITH_TRACING": "false",
    "DEV_MODE": "1", "ANTHROPIC_API_KEY": "fake-yoxdur", "GOOGLE_API_KEY": "fake-yoxdur",
    "LANGSMITH_API_KEY": "fake-yoxdur", "COMPLIANCE_GROUPS": "",
    # Saxta açarla real Google embeddings-ə sorğu getməsin — lokal leksik semantik yaddaş.
    "EMBEDDINGS_PROVIDER": "lexical",
})
sys.path.insert(0, str(ROOT))

import uvicorn  # noqa: E402

from app import config  # noqa: E402
from tests.fake_llm import FakeChatModel  # noqa: E402


def main() -> None:
    port = int(os.getenv("PORT", "8011"))
    config.set_llm_override(FakeChatModel())
    print(f"Saxta modelli server: http://127.0.0.1:{port}  (məlumat: {os.environ['DATA_DIR']})")
    uvicorn.run("app.main:app", host="127.0.0.1", port=port, log_level="warning")


if __name__ == "__main__":
    main()
