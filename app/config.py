"""Tətbiqin mərkəzi konfiqurasiyası: .env, qovluq yolları və LLM-in yaradılması.

API açarları YALNIZ burada, backend tərəfdə oxunur. Frontend-ə heç bir açar ötürülmür.
"""
from __future__ import annotations

import os
from pathlib import Path
from typing import Any

from dotenv import load_dotenv

# ── Qovluq yolları ─────────────────────────────────────────────────────────
BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")

# DATA_DIR testlərdə müvəqqəti qovluqla əvəz oluna bilsin deyə .env-dən oxunur.
DATA_DIR = Path(os.getenv("DATA_DIR") or (BASE_DIR / "data"))
UPLOAD_DIR = DATA_DIR / "uploads"
STATIC_DIR = BASE_DIR / "static"
SAMPLES_DIR = BASE_DIR / "samples"
# Tələblər siyahısı repozitoriyanın bir hissəsidir (runtime məlumatı deyil).
REQUIREMENTS_FILE = BASE_DIR / "data" / "requirements.json"
DB_FILE = DATA_DIR / "komite.db"
CHECKPOINT_FILE = DATA_DIR / "checkpoints.db"

# ── Yükləmə məhdudiyyətləri ────────────────────────────────────────────────
MAX_UPLOAD_BYTES = 25 * 1024 * 1024  # 25 MB
#: Yükləmə hissə-hissə oxunur — yaddaşda bütöv fayl saxlanmadan limit yoxlanılır.
UPLOAD_CHUNK_BYTES = 256 * 1024
#: Digər POST/PUT sorğularının (JSON) gövdə həddi.
MAX_JSON_BODY_BYTES = 2 * 1024 * 1024
ALLOWED_SUFFIX = ".docx"
PLAN_ID_PATTERN = r"^[\w\-. ]{1,60}$"

# ── Model ──────────────────────────────────────────────────────────────────
LLM_MODEL = os.getenv("LLM_MODEL", "anthropic:claude-sonnet-5")
LLM_TEMPERATURE = 0
LLM_MAX_RETRIES = 2
LLM_TIMEOUT = 120

# ── Uyğunluq agenti ────────────────────────────────────────────────────────
COMPLIANCE_GROUPS = [
    g.strip() for g in (os.getenv("COMPLIANCE_GROUPS") or "").split(",") if g.strip()
]
COMPLIANCE_CONCURRENCY = int(os.getenv("COMPLIANCE_CONCURRENCY", "4") or 4)

# ── İnkişaf rejimi ─────────────────────────────────────────────────────────
# Yalnız DEV_MODE=1 olanda süni xəta seçimləri (fail_at) göstərilir və qəbul edilir.
DEV_MODE = (os.getenv("DEV_MODE") or "").strip().lower() in ("1", "true", "yes")

# ── AI köməkçi (chat) ──────────────────────────────────────────────────────
# Rəy agentləri ilə EYNİ model konfiqurasiyası (LLM_MODEL) istifadə olunur; açar yalnız backend-dədir.
CHAT_MAX_MESSAGE = 1500          # istifadəçinin bir mesajı (simvol)
CHAT_MAX_HISTORY = 8             # modelə gedən əvvəlki mesajların sayı
CHAT_MAX_HISTORY_CHARS = 4000    # hər əvvəlki mesajın həddi
CHAT_CONTEXT_CHARS = 24000       # yoxlama konteksti büdcəsi (nəticə + sənəd parçaları)
CHAT_TIMEOUT = float(os.getenv("CHAT_TIMEOUT", "60") or 60)
CHAT_CONCURRENCY = int(os.getenv("CHAT_CONCURRENCY", "2") or 2)

# ── Bazar icmalı ───────────────────────────────────────────────────────────
# Valyuta və qızıl: AR Mərkəzi Bankının açıq XML bülleteni (açar lazım deyil).
# AAPL, Brent və xəbərlər: Alpha Vantage — ALPHAVANTAGE_API_KEY olmadan "Mənbə qoşulmayıb".
MARKET_ENABLED = (os.getenv("MARKET_ENABLED", "1") or "1").strip().lower() not in ("0", "false", "no")
MARKET_TIMEOUT = float(os.getenv("MARKET_TIMEOUT", "6") or 6)
ALPHAVANTAGE_API_KEY = (os.getenv("ALPHAVANTAGE_API_KEY") or "").strip()

# ── İqtisadi təhlil ────────────────────────────────────────────────────────
# Yoxlama bitəndən sonra avtomatik başlasın (bir əlavə model çağırışı). 0 — yalnız düymə ilə.
ECONOMICS_AUTO = (os.getenv("ECONOMICS_AUTO", "1") or "1").strip().lower() not in ("0", "false", "no")

#: Model provayderi → backend-də olmalı açar (açarın özü heç yerə çıxarılmır).
_PROVIDER_KEYS = {"anthropic": "ANTHROPIC_API_KEY", "google_genai": "GOOGLE_API_KEY",
                  "openai": "OPENAI_API_KEY"}


def llm_available() -> bool:
    """Model çağırıla bilərmi: saxta model qoyulub və ya provayderin açarı mühitdə var."""
    if _llm_override is not None:
        return True
    provider = LLM_MODEL.split(":", 1)[0] if ":" in LLM_MODEL else ""
    key = _PROVIDER_KEYS.get(provider)
    return bool(os.getenv(key, "").strip()) if key else True


# ── LangSmith ──────────────────────────────────────────────────────────────
LANGSMITH_PROJECT = os.getenv("LANGSMITH_PROJECT", "biznes-plan-komite")


def ensure_dirs() -> None:
    """İşləmək üçün lazım olan qovluqları yaradır."""
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)


# ── LLM ────────────────────────────────────────────────────────────────────
_llm_override: Any | None = None
_llm_cache: Any | None = None


def set_llm_override(llm: Any | None) -> None:
    """Testlər üçün: real modelin əvəzinə saxta model qoyur."""
    global _llm_override, _llm_cache
    _llm_override = llm
    _llm_cache = None


def get_llm() -> Any:
    """Konfiqurasiyaya uyğun chat modelini qaytarır (bir dəfə yaradılır)."""
    global _llm_cache
    if _llm_override is not None:
        return _llm_override
    if _llm_cache is None:
        from langchain.chat_models import init_chat_model

        kwargs: dict[str, Any] = {"max_retries": LLM_MAX_RETRIES, "timeout": LLM_TIMEOUT}
        # Yeni Anthropic modelləri `temperature` qəbul etmir (400 qaytarır).
        if not LLM_MODEL.startswith("anthropic:"):
            kwargs["temperature"] = LLM_TEMPERATURE
        _llm_cache = init_chat_model(LLM_MODEL, **kwargs)
    return _llm_cache
