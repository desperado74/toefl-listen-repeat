from functools import lru_cache
import hashlib
from pathlib import Path
import os

from dotenv import load_dotenv


load_dotenv()


class Settings:
    azure_speech_key: str = os.getenv("AZURE_SPEECH_KEY", "")
    azure_speech_region: str = os.getenv("AZURE_SPEECH_REGION", "")
    database_path: Path = Path(os.getenv("APP_DATABASE_PATH", "data/toefl_repeat.sqlite3"))
    attempts_dir: Path = Path(os.getenv("APP_ATTEMPTS_DIR", "attempts"))
    prompt_audio_dir: Path = Path(os.getenv("APP_PROMPT_AUDIO_DIR", "data/audio/generated"))
    prompt_voice: str = os.getenv("APP_PROMPT_VOICE", "Samantha")
    prompt_rate: str = os.getenv("APP_PROMPT_RATE", "150")
    prompt_tts_provider: str = os.getenv("APP_PROMPT_TTS_PROVIDER", "auto").lower()
    prompt_azure_voice: str = os.getenv("APP_PROMPT_AZURE_VOICE", "en-US-JennyNeural")
    interview_ai_provider: str = os.getenv("INTERVIEW_AI_PROVIDER", "none").lower()
    interview_reference_provider: str = os.getenv("INTERVIEW_REFERENCE_PROVIDER", "local").lower()
    deepseek_api_key: str = os.getenv("DEEPSEEK_API_KEY", "")
    deepseek_base_url: str = os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com")
    deepseek_model: str = os.getenv("DEEPSEEK_MODEL", "deepseek-v4-flash")
    frontend_dist_dir: Path = Path(os.getenv("APP_FRONTEND_DIST_DIR", "frontend/dist"))
    cors_allow_origins: str = os.getenv(
        "APP_CORS_ALLOW_ORIGINS",
        "http://localhost:5173,http://127.0.0.1:5173",
    )
    access_password: str = os.getenv("APP_ACCESS_PASSWORD", "")
    session_cookie_name: str = os.getenv("APP_SESSION_COOKIE_NAME", "trainer_session")
    session_cookie_secure: bool = os.getenv("APP_SESSION_COOKIE_SECURE", "0") == "1"
    session_secret: str = os.getenv("APP_SESSION_SECRET", "replace-me")
    scenarios_path: Path = Path("data/scenarios/listen_repeat.json")
    reading_bank_path: Path = Path("data/reading/reading_bank.json")
    interview_bank_path: Path = Path("data/interview/interview_bank.json")

    @property
    def azure_configured(self) -> bool:
        placeholder_fragments = ("replace", "your-", "example", "placeholder")
        key = self.azure_speech_key.strip()
        region = self.azure_speech_region.strip()
        if not key or not region:
            return False
        lowered = f"{key} {region}".lower()
        return not any(fragment in lowered for fragment in placeholder_fragments)

    @property
    def cors_origins(self) -> list[str]:
        return [item.strip() for item in self.cors_allow_origins.split(",") if item.strip()]

    @property
    def access_protection_enabled(self) -> bool:
        return bool(self.access_password.strip())

    @property
    def access_session_token(self) -> str:
        payload = f"{self.access_password}:{self.session_secret}".encode("utf-8")
        return hashlib.sha256(payload).hexdigest()


@lru_cache
def get_settings() -> Settings:
    return Settings()
