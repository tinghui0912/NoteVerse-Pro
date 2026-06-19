from __future__ import annotations

from pathlib import Path

import pytest
from pydantic import ValidationError

from app.core.config import Settings


def test_settings_do_not_implicitly_load_an_env_file() -> None:
    loaded_settings = Settings()

    assert loaded_settings.SECRET_KEY
    assert loaded_settings.DATABASE_URL
    assert loaded_settings.SYNC_DATABASE_URL
    assert loaded_settings.model_config.get("env_file") is None


def test_debug_environment_parsing() -> None:
    parse_debug = Settings.parse_debug_flag

    assert parse_debug("debug") is True
    assert parse_debug("development") is True
    assert parse_debug("true") is True
    assert parse_debug("release") is False
    assert parse_debug("production") is False
    assert parse_debug("false") is False


def test_practice_audio_min_active_frames_uses_stable_floor() -> None:
    settings = Settings(PRACTICE_AUDIO_MIN_ACTIVE_FRAMES=2)

    assert settings.PRACTICE_AUDIO_MIN_ACTIVE_FRAMES == 3


def test_practice_soundfont_path_expands_user_home() -> None:
    settings = Settings(PRACTICE_SOUNDFONT_PATH="~/sounds/default.sf2")

    assert settings.PRACTICE_SOUNDFONT_PATH == str(Path("~/sounds/default.sf2").expanduser())


def test_offline_model_paths_expand_user_home() -> None:
    settings = Settings(
        MODEL_ROOT="~/noteverse/models",
        HF_HOME="~/noteverse/models/huggingface",
        PADDLEOCR_MODEL_ROOT="~/noteverse/models/paddleocr/official_models",
        PADDLEOCR_DETECTION_MODEL_DIR="~/noteverse/models/paddleocr/official_models/det",
        PADDLEOCR_RECOGNITION_MODEL_DIR="~/noteverse/models/paddleocr/official_models/rec",
        PADDLEOCR_TEXTLINE_ORIENTATION_MODEL_DIR="~/noteverse/models/paddleocr/official_models/ori",
    )

    assert settings.MODEL_ROOT == str(Path("~/noteverse/models").expanduser())
    assert settings.HF_HOME == str(Path("~/noteverse/models/huggingface").expanduser())
    assert settings.PADDLEOCR_MODEL_ROOT == str(
        Path("~/noteverse/models/paddleocr/official_models").expanduser()
    )
    assert settings.PADDLEOCR_DETECTION_MODEL_DIR == str(
        Path("~/noteverse/models/paddleocr/official_models/det").expanduser()
    )
    assert settings.PADDLEOCR_RECOGNITION_MODEL_DIR == str(
        Path("~/noteverse/models/paddleocr/official_models/rec").expanduser()
    )
    assert settings.PADDLEOCR_TEXTLINE_ORIENTATION_MODEL_DIR == str(
        Path("~/noteverse/models/paddleocr/official_models/ori").expanduser()
    )


def test_omr_engine_is_normalized_and_validated() -> None:
    settings = Settings(OMR_ENGINE="LEGATO", LEGATO_REPO_PATH="../external/legato")

    assert settings.OMR_ENGINE == "legato"

    with pytest.raises(ValidationError, match="OMR_ENGINE"):
        Settings(OMR_ENGINE="unknown")


def test_score_render_engine_is_normalized_and_validated() -> None:
    settings = Settings(SCORE_RENDER_ENGINE="VEROVIO")

    assert settings.SCORE_RENDER_ENGINE == "verovio"


def test_verovio_footer_mode_is_normalized_and_validated() -> None:
    settings = Settings(VEROVIO_FOOTER="ALWAYS")

    assert settings.VEROVIO_FOOTER == "always"

    with pytest.raises(ValidationError, match="VEROVIO_FOOTER"):
        Settings(VEROVIO_FOOTER="visible")


def test_task_reliability_defaults_are_positive() -> None:
    settings = Settings()

    assert settings.TASK_PENDING_STALE_SECONDS > 0
    assert settings.TASK_PROGRESS_STALE_SECONDS > 0
    assert settings.ORPHAN_UPLOAD_TTL_SECONDS > 0


def test_s3_storage_settings_are_validated() -> None:
    with pytest.raises(ValidationError, match="Missing required S3 storage settings"):
        Settings(
            FILE_STORAGE_BACKEND="s3",
            S3_ENDPOINT_URL=None,
            S3_BUCKET=None,
            S3_ACCESS_KEY_ID=None,
            S3_SECRET_ACCESS_KEY=None,
        )

    settings = Settings(
        FILE_STORAGE_BACKEND="s3",
        S3_ENDPOINT_URL="oss-cn-shenzhen.aliyuncs.com",
        S3_BUCKET="bucket",
        S3_ACCESS_KEY_ID="access-key",
        S3_SECRET_ACCESS_KEY="secret-key",
    )

    assert settings.FILE_STORAGE_BACKEND == "s3"
    assert settings.S3_ENDPOINT_URL == "https://oss-cn-shenzhen.aliyuncs.com"


def test_selected_engine_settings_are_valid() -> None:
    settings = Settings(
        OMR_ENGINE="legato",
        LEGATO_REPO_PATH="../external/legato",
        SCORE_RENDER_ENGINE="verovio",
    )

    assert settings.OMR_ENGINE == "legato"
    assert settings.LEGATO_REPO_COMMIT == "179c228d3d5f67113cf739b44891b3abe046f1dc"
    assert settings.SCORE_RENDER_ENGINE == "verovio"

    with pytest.raises(ValidationError, match="SCORE_RENDER_ENGINE"):
        Settings(SCORE_RENDER_ENGINE="unknown")


def test_legato_repository_path_is_required() -> None:
    with pytest.raises(ValidationError, match="LEGATO_REPO_PATH is required"):
        Settings(OMR_ENGINE="legato", LEGATO_REPO_PATH=None)


def test_app_main_import_exposes_routes() -> None:
    from app.main import app

    route_paths = {route.path for route in app.routes}

    assert "/" in route_paths
    assert "/docs" in route_paths
    assert "/api/v1/openapi.json" in route_paths
    assert len(route_paths) > 0
