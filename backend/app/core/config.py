"""Application settings and configuration validation."""

from pathlib import Path
from typing import List, Optional, Union
import os
import shutil

from pydantic import AnyHttpUrl, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


BASE_DIR = Path(__file__).resolve().parent.parent.parent
ENV_FILE = BASE_DIR / ".env"


class Settings(BaseSettings):
    PROJECT_NAME: str = "NoteVerse Pro"
    API_V1_STR: str = "/api/v1"
    SECRET_KEY: str
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24 * 7
    DEBUG: bool = False
    PRACTICE_ALIGNMENT_ENGINE: str = "matchmaker"
    PRACTICE_MATCHMAKER_METHOD: str = "arzt"
    PRACTICE_MATCHMAKER_FEATURE_TYPE: str = "lse"
    PRACTICE_MATCHMAKER_FRAME_RATE: int = 30
    PRACTICE_AUDIO_RMS_GATE: float = 0.015
    PRACTICE_AUDIO_PEAK_GATE: float = 0.06
    PRACTICE_AUDIO_START_RMS_GATE: float = 0.08
    PRACTICE_AUDIO_START_PEAK_GATE: float = 0.18
    PRACTICE_AUDIO_MIN_ACTIVE_FRAMES: int = 1
    PRACTICE_AUDIO_WARMUP_FRAMES: int = 30
    PRACTICE_AUDIO_RMS_NOISE_MULTIPLIER: float = 4.0
    PRACTICE_AUDIO_PEAK_NOISE_MULTIPLIER: float = 2.5
    PRACTICE_AUDIO_DIAGNOSTICS: bool = False

    # CORS
    BACKEND_CORS_ORIGINS: List[AnyHttpUrl] = []

    @field_validator("BACKEND_CORS_ORIGINS", mode="before")
    def assemble_cors_origins(cls, v: Union[str, List[str]]) -> Union[List[str], str]:
        if v in (None, ""):
            return []
        if isinstance(v, str) and not v.startswith("["):
            return [i.strip() for i in v.split(",")]
        if isinstance(v, (list, str)):
            return v
        raise ValueError(v)

    @field_validator("DEBUG", mode="before")
    @classmethod
    def parse_debug_flag(cls, v):
        """Allow environment-style debug labels in addition to booleans."""

        if isinstance(v, bool):
            return v
        if isinstance(v, str):
            value = v.strip().lower()
            if value in {"1", "true", "yes", "on", "debug", "development", "dev"}:
                return True
            if value in {"0", "false", "no", "off", "release", "production", "prod"}:
                return False
        return v

    @field_validator("PRACTICE_ALIGNMENT_ENGINE")
    @classmethod
    def validate_practice_alignment_engine(cls, v: str) -> str:
        if v != "matchmaker":
            raise ValueError("PRACTICE_ALIGNMENT_ENGINE must be 'matchmaker'")
        return v

    @field_validator("PRACTICE_MATCHMAKER_METHOD")
    @classmethod
    def validate_practice_matchmaker_method(cls, v: str) -> str:
        value = v.strip().lower()
        if value != "arzt":
            raise ValueError("PRACTICE_MATCHMAKER_METHOD currently supports only 'arzt'")
        return value

    @field_validator("PRACTICE_MATCHMAKER_FEATURE_TYPE")
    @classmethod
    def validate_practice_matchmaker_feature_type(cls, v: str) -> str:
        value = v.strip().lower()
        aliases = {
            "lse": "lse",
            "logspectral": "lse",
            "log-spectral": "lse",
            "log_spectral": "lse",
            "log_spectral_energy": "lse",
            "chroma": "chroma",
        }
        if value not in aliases:
            raise ValueError(
                "PRACTICE_MATCHMAKER_FEATURE_TYPE must be one of: lse, logspectral, chroma"
            )
        return aliases[value]

    # Database
    DATABASE_URL: str
    SYNC_DATABASE_URL: str

    # Redis
    REDIS_URL: str

    # Celery defaults to REDIS_URL unless explicitly overridden.
    CELERY_BROKER_URL: Optional[str] = None
    CELERY_RESULT_BACKEND: Optional[str] = None

    # File storage
    UPLOAD_FOLDER: str
    OUTPUT_FOLDER: str
    TEMP_FOLDER: str
    MAX_PROCESSING_TIME: int = 300
    ALLOWED_EXTENSIONS: set = {
        "png",
        "jpg",
        "jpeg",
        "bmp",
        "gif",
        "webp",
        "tiff",
        "tif",
    }

    # External tools
    AUDIVERIS_PATH: str
    MUSESCORE_PATH: str

    # Email
    MAIL_SERVER: str
    MAIL_PORT: int
    MAIL_USE_SSL: bool
    MAIL_USE_TLS: bool = False
    MAIL_USERNAME: str
    MAIL_PASSWORD: str
    MAIL_DEFAULT_SENDER: Optional[str] = None

    # Email verification
    EMAIL_CODE_TTL_SECONDS: int = 180
    EMAIL_CODE_COOLDOWN_SECONDS: int = 60
    EMAIL_VERIFY_TOKEN_MAX_AGE_SECONDS: int = 900

    @model_validator(mode="after")
    def set_default_values(self) -> "Settings":
        """Resolve optional settings from primary configuration values."""

        if self.CELERY_BROKER_URL is None:
            object.__setattr__(self, "CELERY_BROKER_URL", self.REDIS_URL)
        if self.CELERY_RESULT_BACKEND is None:
            object.__setattr__(self, "CELERY_RESULT_BACKEND", self.REDIS_URL)
        if self.MAIL_DEFAULT_SENDER is None:
            object.__setattr__(self, "MAIL_DEFAULT_SENDER", self.MAIL_USERNAME)
        return self

    @field_validator("UPLOAD_FOLDER", "OUTPUT_FOLDER", "TEMP_FOLDER")
    @classmethod
    def resolve_storage_folders(cls, v: str) -> str:
        """Resolve storage paths to absolute directory paths without creating them."""

        if not os.path.isabs(v):
            backend_dir = Path(__file__).parent.parent.parent
            path = (backend_dir / v).resolve()
        else:
            path = Path(v)

        if path.exists() and not path.is_dir():
            raise ValueError(f"{v} exists but is not a directory")

        return str(path)

    @field_validator("SECRET_KEY")
    @classmethod
    def validate_secret_key(cls, v: str) -> str:
        """Require a sufficiently strong secret key."""

        if len(v) < 32:
            raise ValueError(
                "SECRET_KEY must be at least 32 characters long for security"
            )
        return v

    @field_validator("DATABASE_URL", "SYNC_DATABASE_URL")
    @classmethod
    def validate_database_url(cls, v: str) -> str:
        """Allow only supported database URL schemes."""

        supported_prefixes = (
            "postgresql://",
            "postgresql+asyncpg://",
            "postgresql+psycopg://",
            "mysql://",
            "mysql+asyncmy://",
            "mysql+aiomysql://",
            "mysql+pymysql://",
            "sqlite://",
            "sqlite+aiosqlite://",
        )
        if not v.startswith(supported_prefixes):
            raise ValueError(
                f"Unsupported database URL format: {v}\n"
                "Supported engines: PostgreSQL, MySQL, SQLite"
            )
        return v

    @field_validator("AUDIVERIS_PATH", "MUSESCORE_PATH")
    @classmethod
    def resolve_executable_paths(cls, v: str) -> str:
        """Resolve executable paths from absolute paths or PATH lookups."""

        if os.path.isabs(v) and os.path.exists(v):
            return v

        found_path = shutil.which(v)
        if found_path:
            return found_path

        return v

    model_config = SettingsConfigDict(
        env_file=str(ENV_FILE),
        case_sensitive=True,
        extra="ignore",
    )


settings = Settings()
