"""Application settings and configuration validation."""

from pathlib import Path
from typing import List, Optional
import os

from pydantic import AnyHttpUrl, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


BASE_DIR = Path(__file__).resolve().parent.parent.parent


class Settings(BaseSettings):
    PROJECT_NAME: str = "NoteVerse Pro"
    API_V1_STR: str = "/api/v1"
    SECRET_KEY: str
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 15
    REFRESH_TOKEN_EXPIRE_DAYS: int = 30
    AUTH_COOKIE_NAME: str
    REFRESH_COOKIE_NAME: str
    CSRF_COOKIE_NAME: str
    CSRF_HEADER_NAME: str
    AUTH_COOKIE_SECURE: bool
    AUTH_COOKIE_SAMESITE: str
    DEBUG: bool = False
    FRONTEND_BASE_URL: str
    PRACTICE_MATCHMAKER_FRAME_RATE: int = 30
    PRACTICE_AUDIO_RMS_GATE: float = 0.015
    PRACTICE_AUDIO_PEAK_GATE: float = 0.06
    PRACTICE_AUDIO_START_RMS_GATE: float = 0.025
    PRACTICE_AUDIO_START_PEAK_GATE: float = 0.06
    PRACTICE_AUDIO_MIN_ACTIVE_FRAMES: int = 3
    PRACTICE_AUDIO_WARMUP_FRAMES: int = 30
    PRACTICE_AUDIO_RMS_NOISE_MULTIPLIER: float = 4.0
    PRACTICE_AUDIO_PEAK_NOISE_MULTIPLIER: float = 2.5
    PRACTICE_AUDIO_NO_INPUT_FRAMES: int = 24
    PRACTICE_AUDIO_TONAL_GATE_ENABLED: bool = True
    PRACTICE_AUDIO_MAX_SPECTRAL_FLATNESS: float = 0.35
    PRACTICE_AUDIO_MIN_PEAK_PROMINENCE: float = 8.0
    PRACTICE_AUDIO_ONSET_FLUX_GATE: float = 0.35
    PRACTICE_AUDIO_ONSET_HOLD_FRAMES: int = 45
    PRACTICE_AUDIO_DIAGNOSTICS: bool = False
    PRACTICE_SOUNDFONT_PATH: str
    PLAYBACK_SOUNDFONT_PATH: str
    PLAYBACK_SAMPLE_RATE: int = 44100
    PLAYBACK_MAX_DURATION_SECONDS: float = 180.0
    REALTIME_EVENT_CATCHUP_INTERVAL_SECONDS: int = 2
    REALTIME_EVENT_HEARTBEAT_INTERVAL_SECONDS: int = 15
    REALTIME_EVENT_BATCH_SIZE: int = 100
    REALTIME_EVENT_CLEANUP_INTERVAL_SECONDS: int
    REALTIME_EVENT_RETENTION_DAYS: int
    MODEL_ROOT: Optional[str] = None
    HF_HOME: Optional[str] = None
    HF_HUB_OFFLINE: bool = False
    TRANSFORMERS_OFFLINE: bool = False
    PADDLEOCR_MODEL_ROOT: Optional[str] = None
    PADDLEOCR_DETECTION_MODEL_DIR: Optional[str] = None
    PADDLEOCR_RECOGNITION_MODEL_DIR: Optional[str] = None
    PADDLEOCR_TEXTLINE_ORIENTATION_MODEL_DIR: Optional[str] = None
    LOG_DIR: str = str(BASE_DIR / "logs")

    # CORS
    BACKEND_CORS_ORIGINS: List[AnyHttpUrl]

    @field_validator("BACKEND_CORS_ORIGINS", mode="before")
    def assemble_cors_origins(cls, v: str | List[str]) -> List[str]:
        if v in (None, ""):
            return []
        if isinstance(v, list):
            return v
        raise ValueError("BACKEND_CORS_ORIGINS must be a JSON array")

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

    @field_validator("PRACTICE_AUDIO_MIN_ACTIVE_FRAMES")
    @classmethod
    def validate_practice_audio_min_active_frames(cls, v: int) -> int:
        return max(v, 3)

    @field_validator("PRACTICE_AUDIO_ONSET_HOLD_FRAMES")
    @classmethod
    def validate_practice_audio_onset_hold_frames(cls, v: int) -> int:
        return max(v, 1)

    @field_validator(
        "LOG_DIR",
        "PRACTICE_SOUNDFONT_PATH",
        "PLAYBACK_SOUNDFONT_PATH",
        "MODEL_ROOT",
        "HF_HOME",
        "PADDLEOCR_MODEL_ROOT",
        "PADDLEOCR_DETECTION_MODEL_DIR",
        "PADDLEOCR_RECOGNITION_MODEL_DIR",
        "PADDLEOCR_TEXTLINE_ORIENTATION_MODEL_DIR",
    )
    @classmethod
    def normalize_path(cls, v: Optional[str]) -> Optional[str]:
        if not v:
            return None
        return str(Path(v).expanduser())

    @field_validator(
        "IMPORT_DISPATCH_INTERVAL_SECONDS",
        "IMPORT_DISPATCH_TIMEOUT_SECONDS",
        "IMPORT_PROCESSING_TIMEOUT_SECONDS",
        "IMPORT_DISPATCH_MAX_ATTEMPTS",
        "IMPORT_DISPATCH_BATCH_SIZE",
        "NOTIFICATION_CLEANUP_INTERVAL_SECONDS",
        "NOTIFICATION_RETENTION_DAYS",
        "ORPHAN_UPLOAD_TTL_SECONDS",
        "RENDER_OUTBOX_DISPATCH_INTERVAL_SECONDS",
        "RENDER_OUTBOX_DISPATCH_TIMEOUT_SECONDS",
        "RENDER_OUTBOX_PROCESSING_TIMEOUT_SECONDS",
        "RENDER_OUTBOX_RETRY_BASE_SECONDS",
        "RENDER_OUTBOX_MAX_ATTEMPTS",
        "RENDER_OUTBOX_DISPATCH_BATCH_SIZE",
        "PLAYBACK_OUTBOX_DISPATCH_INTERVAL_SECONDS",
        "PLAYBACK_OUTBOX_DISPATCH_TIMEOUT_SECONDS",
        "PLAYBACK_OUTBOX_PROCESSING_TIMEOUT_SECONDS",
        "PLAYBACK_OUTBOX_RETRY_BASE_SECONDS",
        "PLAYBACK_OUTBOX_MAX_ATTEMPTS",
        "PLAYBACK_OUTBOX_DISPATCH_BATCH_SIZE",
        "PLAYBACK_SAMPLE_RATE",
        "REALTIME_EVENT_CATCHUP_INTERVAL_SECONDS",
        "REALTIME_EVENT_HEARTBEAT_INTERVAL_SECONDS",
        "REALTIME_EVENT_BATCH_SIZE",
        "REALTIME_EVENT_CLEANUP_INTERVAL_SECONDS",
        "REALTIME_EVENT_RETENTION_DAYS",
        "MAIL_OUTBOX_DISPATCH_INTERVAL_SECONDS",
        "MAIL_OUTBOX_DISPATCH_TIMEOUT_SECONDS",
        "MAIL_OUTBOX_PROCESSING_TIMEOUT_SECONDS",
        "MAIL_OUTBOX_RETRY_BASE_SECONDS",
        "MAIL_OUTBOX_MAX_ATTEMPTS",
        "MAIL_OUTBOX_DISPATCH_BATCH_SIZE",
        "MAIL_OUTBOX_RETENTION_DAYS",
        "DERIVED_ASSET_CLEANUP_INTERVAL_SECONDS",
        "MAX_PROCESSING_TIME",
        "PADDLEOCR_TIMEOUT_SECONDS",
        "CELERY_TASK_SOFT_TIME_LIMIT",
        "CELERY_TASK_TIME_LIMIT",
    )
    @classmethod
    def validate_positive_reliability_setting(cls, v: int) -> int:
        if v <= 0:
            raise ValueError("task timing settings must be positive integers")
        return v

    @field_validator("PLAYBACK_MAX_DURATION_SECONDS")
    @classmethod
    def validate_playback_max_duration(cls, v: float) -> float:
        if v <= 0:
            raise ValueError("PLAYBACK_MAX_DURATION_SECONDS must be positive")
        return v

    @field_validator("DERIVED_ASSET_RETAIN_RECENT_REVISIONS")
    @classmethod
    def validate_derived_asset_retention_count(cls, v: int) -> int:
        if v < 0:
            raise ValueError("DERIVED_ASSET_RETAIN_RECENT_REVISIONS must be non-negative")
        return v

    # Database
    DATABASE_URL: str
    SYNC_DATABASE_URL: str

    # Redis
    REDIS_URL: str

    CELERY_BROKER_URL: str
    CELERY_RESULT_BACKEND: str
    IMPORT_DISPATCH_INTERVAL_SECONDS: int = 30
    IMPORT_DISPATCH_TIMEOUT_SECONDS: int = 300
    IMPORT_PROCESSING_TIMEOUT_SECONDS: int = 1200
    IMPORT_DISPATCH_MAX_ATTEMPTS: int = 3
    IMPORT_DISPATCH_BATCH_SIZE: int = 20
    NOTIFICATION_CLEANUP_INTERVAL_SECONDS: int = 86400
    NOTIFICATION_RETENTION_DAYS: int = 90
    ORPHAN_UPLOAD_TTL_SECONDS: int = 86400
    RENDER_OUTBOX_DISPATCH_INTERVAL_SECONDS: int = 30
    RENDER_OUTBOX_DISPATCH_TIMEOUT_SECONDS: int = 300
    RENDER_OUTBOX_PROCESSING_TIMEOUT_SECONDS: int = 1200
    RENDER_OUTBOX_RETRY_BASE_SECONDS: int = 60
    RENDER_OUTBOX_MAX_ATTEMPTS: int = 5
    RENDER_OUTBOX_DISPATCH_BATCH_SIZE: int = 50
    PLAYBACK_OUTBOX_DISPATCH_INTERVAL_SECONDS: int = 30
    PLAYBACK_OUTBOX_DISPATCH_TIMEOUT_SECONDS: int = 300
    PLAYBACK_OUTBOX_PROCESSING_TIMEOUT_SECONDS: int = 1200
    PLAYBACK_OUTBOX_RETRY_BASE_SECONDS: int = 60
    PLAYBACK_OUTBOX_MAX_ATTEMPTS: int = 5
    PLAYBACK_OUTBOX_DISPATCH_BATCH_SIZE: int = 50
    MAIL_OUTBOX_DISPATCH_INTERVAL_SECONDS: int = 10
    MAIL_OUTBOX_DISPATCH_TIMEOUT_SECONDS: int = 120
    MAIL_OUTBOX_PROCESSING_TIMEOUT_SECONDS: int = 120
    MAIL_OUTBOX_RETRY_BASE_SECONDS: int = 30
    MAIL_OUTBOX_MAX_ATTEMPTS: int = 5
    MAIL_OUTBOX_DISPATCH_BATCH_SIZE: int = 50
    MAIL_OUTBOX_RETENTION_DAYS: int = 7
    DERIVED_ASSET_RETAIN_RECENT_REVISIONS: int = 10
    DERIVED_ASSET_CLEANUP_INTERVAL_SECONDS: int = 86400

    # File storage
    FILE_STORAGE_BACKEND: str = "local"
    S3_ENDPOINT_URL: Optional[str] = None
    S3_REGION: str = "auto"
    S3_BUCKET: Optional[str] = None
    S3_ACCESS_KEY_ID: Optional[str] = None
    S3_SECRET_ACCESS_KEY: Optional[str] = None
    S3_PUBLIC_BASE_URL: Optional[str] = None
    S3_FORCE_PATH_STYLE: bool = True
    S3_PRESIGN_EXPIRE_SECONDS: int = 900
    STORAGE_ROOT: str = "data/storage"
    WORK_ROOT: str = "data/work"
    MAX_PROCESSING_TIME: int = 900
    PADDLEOCR_TIMEOUT_SECONDS: int = 300
    CELERY_TASK_SOFT_TIME_LIMIT: int = 960
    CELERY_TASK_TIME_LIMIT: int = 1020
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
    OMR_ENGINE: str = "legato"
    LEGATO_REPO_PATH: Optional[str] = None
    LEGATO_REPO_COMMIT: Optional[str] = "179c228d3d5f67113cf739b44891b3abe046f1dc"
    LEGATO_PYTHON: str = "python3"
    LEGATO_MODEL_PATH: str = "guangyangmusic/legato"
    LEGATO_PROCESSOR_PATH: Optional[str] = None
    LEGATO_DEVICE: str = "cuda"
    LEGATO_FP16: bool = True
    LEGATO_BEAM_SIZE: int = 10
    LEGATO_BATCH_SIZE: int = 1
    LEGATO_TIMEOUT_SECONDS: int = 600
    SCORE_RENDER_ENGINE: str = "verovio"
    VEROVIO_PAGE_WIDTH: int = 2100
    VEROVIO_PAGE_HEIGHT: int = 2970
    VEROVIO_SCALE: int = 40
    VEROVIO_BREAKS: str = "encoded"
    VEROVIO_ADJUST_PAGE_HEIGHT: bool = False
    VEROVIO_JUSTIFY_VERTICALLY: bool = True
    VEROVIO_PAGE_MARGIN_TOP: int = 390
    VEROVIO_PAGE_MARGIN_BOTTOM: int = 80
    VEROVIO_HEADER: str = "none"
    VEROVIO_FOOTER: str = "always"
    VEROVIO_USE_PG_FOOTER_FOR_ALL: bool = True
    VEROVIO_PREVIEW_HEADER_POSTPROCESSING: bool = True

    # Email
    MAIL_DEFAULT_SENDER: Optional[str] = None
    RESEND_API_KEY: Optional[str] = None
    RESEND_API_URL: str = "https://api.resend.com/emails"

    # Auth email links
    EMAIL_PASSWORD_RESET_TOKEN_TTL_SECONDS: int = 300
    EMAIL_VERIFY_TOKEN_MAX_AGE_SECONDS: int = 900

    @model_validator(mode="after")
    def validate_task_time_limits(self) -> "Settings":
        """Keep component timeouts inside the task shutdown envelope."""

        if self.PADDLEOCR_TIMEOUT_SECONDS > self.MAX_PROCESSING_TIME:
            raise ValueError(
                "PADDLEOCR_TIMEOUT_SECONDS must not exceed MAX_PROCESSING_TIME"
            )
        if self.MAX_PROCESSING_TIME >= self.CELERY_TASK_SOFT_TIME_LIMIT:
            raise ValueError(
                "MAX_PROCESSING_TIME must be lower than CELERY_TASK_SOFT_TIME_LIMIT"
            )
        if self.CELERY_TASK_SOFT_TIME_LIMIT >= self.CELERY_TASK_TIME_LIMIT:
            raise ValueError(
                "CELERY_TASK_SOFT_TIME_LIMIT must be lower than CELERY_TASK_TIME_LIMIT"
            )
        return self

    @field_validator("STORAGE_ROOT", "WORK_ROOT")
    @classmethod
    def resolve_runtime_folders(cls, v: str) -> str:
        """Resolve runtime paths to absolute directory paths without creating them."""

        if not os.path.isabs(v):
            backend_dir = Path(__file__).parent.parent.parent
            path = (backend_dir / v).resolve()
        else:
            path = Path(v)

        if path.exists() and not path.is_dir():
            raise ValueError(f"{v} exists but is not a directory")

        return str(path)

    @field_validator("FILE_STORAGE_BACKEND")
    @classmethod
    def validate_file_storage_backend(cls, v: str) -> str:
        """Validate the configured file storage backend."""

        value = v.strip().lower()
        if value not in {"local", "s3"}:
            raise ValueError("FILE_STORAGE_BACKEND must be one of: local, s3")
        return value

    @field_validator("S3_ENDPOINT_URL", "S3_PUBLIC_BASE_URL")
    @classmethod
    def normalize_optional_url(cls, v: Optional[str]) -> Optional[str]:
        """Normalize optional storage URLs."""

        if not v:
            return None
        value = v.strip().rstrip("/")
        if value and not value.startswith(("http://", "https://")):
            value = f"https://{value}"
        return value

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

    @field_validator("OMR_ENGINE")
    @classmethod
    def validate_omr_engine(cls, v: str) -> str:
        """Validate the configured optical music recognition engine."""

        value = v.strip().lower()
        if value != "legato":
            raise ValueError("OMR_ENGINE must be: legato")
        return value

    @field_validator("SCORE_RENDER_ENGINE")
    @classmethod
    def validate_score_render_engine(cls, v: str) -> str:
        """Validate the configured score rendering engine."""

        value = v.strip().lower()
        if value != "verovio":
            raise ValueError("SCORE_RENDER_ENGINE must be: verovio")
        return value

    @field_validator("VEROVIO_HEADER")
    @classmethod
    def validate_verovio_header(cls, v: str) -> str:
        """Validate Verovio header rendering mode."""

        value = v.strip().lower()
        if value not in {"none", "auto", "encoded"}:
            raise ValueError("VEROVIO_HEADER must be one of: none, auto, encoded")
        return value

    @field_validator("VEROVIO_FOOTER")
    @classmethod
    def validate_verovio_footer(cls, v: str) -> str:
        """Validate Verovio footer rendering mode."""

        value = v.strip().lower()
        if value not in {"none", "auto", "encoded", "always"}:
            raise ValueError("VEROVIO_FOOTER must be one of: none, auto, encoded, always")
        return value

    @model_validator(mode="after")
    def validate_engine_settings(self) -> "Settings":
        """Validate engine-specific settings."""

        if self.OMR_ENGINE == "legato" and not self.LEGATO_REPO_PATH:
            raise ValueError("LEGATO_REPO_PATH is required when OMR_ENGINE=legato")
        if self.FILE_STORAGE_BACKEND == "s3":
            missing = [
                name
                for name, value in (
                    ("S3_ENDPOINT_URL", self.S3_ENDPOINT_URL),
                    ("S3_BUCKET", self.S3_BUCKET),
                    ("S3_ACCESS_KEY_ID", self.S3_ACCESS_KEY_ID),
                    ("S3_SECRET_ACCESS_KEY", self.S3_SECRET_ACCESS_KEY),
                )
                if not value
            ]
            if missing:
                raise ValueError(
                    "Missing required S3 storage settings: " + ", ".join(missing)
                )
        return self

    model_config = SettingsConfigDict(
        case_sensitive=True,
        extra="ignore",
    )


settings = Settings()
