from __future__ import annotations

from pathlib import Path

import pytest
from pydantic import ValidationError

from app.core.config import Settings, WorkerRuntimeSettings


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


def test_trusted_proxy_cidrs_require_an_explicit_valid_json_allowlist() -> None:
    settings = Settings(TRUSTED_PROXY_CIDRS='["10.0.0.0/8", "2001:db8::/32"]')

    assert settings.TRUSTED_PROXY_CIDRS == ["10.0.0.0/8", "2001:db8::/32"]

    with pytest.raises(ValidationError, match="TRUSTED_PROXY_CIDRS"):
        Settings(TRUSTED_PROXY_CIDRS="10.0.0.0/8")

    with pytest.raises(ValidationError, match="TRUSTED_PROXY_CIDRS"):
        Settings(TRUSTED_PROXY_CIDRS='["0.0.0.0/0"]')


def test_practice_diagnostic_intervals_must_be_positive() -> None:
    settings = Settings(
        PRACTICE_AUDIO_DIAGNOSTIC_FRAME_INTERVAL=15,
        PRACTICE_ALIGNMENT_DIAGNOSTIC_UPDATE_INTERVAL=15,
    )

    assert settings.PRACTICE_AUDIO_DIAGNOSTIC_FRAME_INTERVAL == 15
    assert settings.PRACTICE_ALIGNMENT_DIAGNOSTIC_UPDATE_INTERVAL == 15

    with pytest.raises(ValidationError, match="task timing settings must be positive"):
        Settings(PRACTICE_AUDIO_DIAGNOSTIC_FRAME_INTERVAL=0)

    with pytest.raises(ValidationError, match="task timing settings must be positive"):
        Settings(PRACTICE_ALIGNMENT_DIAGNOSTIC_UPDATE_INTERVAL=0)


def test_practice_soundfont_path_expands_user_home() -> None:
    settings = Settings(
        PRACTICE_SOUNDFONT_PATH="~/sounds/default.sf2",
        PLAYBACK_SOUNDFONT_PATH="~/sounds/playback.sf2",
    )

    assert settings.PRACTICE_SOUNDFONT_PATH == str(Path("~/sounds/default.sf2").expanduser())
    assert settings.PLAYBACK_SOUNDFONT_PATH == str(Path("~/sounds/playback.sf2").expanduser())


def test_playback_soundfont_path_is_required() -> None:
    with pytest.raises(ValidationError, match="PLAYBACK_SOUNDFONT_PATH"):
        Settings(
            PRACTICE_SOUNDFONT_PATH="~/sounds/default.sf2",
            PLAYBACK_SOUNDFONT_PATH=None,
        )


def test_playback_soundfont_path_can_be_configured_independently() -> None:
    settings = Settings(
        PRACTICE_SOUNDFONT_PATH="~/sounds/practice.sf2",
        PLAYBACK_SOUNDFONT_PATH="~/sounds/playback.sf2",
    )

    assert settings.PLAYBACK_SOUNDFONT_PATH == str(Path("~/sounds/playback.sf2").expanduser())


def test_offline_model_paths_expand_user_home() -> None:
    settings = WorkerRuntimeSettings(
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
    settings = WorkerRuntimeSettings(OMR_ENGINE="LEGATO", LEGATO_REPO_PATH="/opt/noteverse/legato")

    assert settings.OMR_ENGINE == "legato"

    with pytest.raises(ValidationError, match="OMR_ENGINE"):
        WorkerRuntimeSettings(OMR_ENGINE="unknown")


def test_score_render_engine_is_normalized_and_validated() -> None:
    settings = WorkerRuntimeSettings(SCORE_RENDER_ENGINE="VEROVIO")

    assert settings.SCORE_RENDER_ENGINE == "verovio"


def test_verovio_footer_mode_is_normalized_and_validated() -> None:
    settings = WorkerRuntimeSettings(VEROVIO_FOOTER="ALWAYS")

    assert settings.VEROVIO_FOOTER == "always"

    with pytest.raises(ValidationError, match="VEROVIO_FOOTER"):
        WorkerRuntimeSettings(VEROVIO_FOOTER="visible")


def test_task_reliability_defaults_are_positive() -> None:
    settings = Settings()

    assert settings.IMPORT_DISPATCH_INTERVAL_SECONDS > 0
    assert settings.IMPORT_DISPATCH_TIMEOUT_SECONDS > 0
    assert settings.IMPORT_PROCESSING_TIMEOUT_SECONDS > 0
    assert settings.IMPORT_DISPATCH_MAX_ATTEMPTS > 0
    assert settings.IMPORT_DISPATCH_BATCH_SIZE > 0
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
    settings = WorkerRuntimeSettings(
        OMR_ENGINE="legato",
        LEGATO_REPO_PATH="/opt/noteverse/legato",
        SCORE_RENDER_ENGINE="verovio",
    )

    assert settings.OMR_ENGINE == "legato"
    assert settings.LEGATO_REPO_COMMIT == "179c228d3d5f67113cf739b44891b3abe046f1dc"
    assert settings.SCORE_RENDER_ENGINE == "verovio"

    with pytest.raises(ValidationError, match="SCORE_RENDER_ENGINE"):
        WorkerRuntimeSettings(SCORE_RENDER_ENGINE="unknown")


def test_legato_repository_path_is_required() -> None:
    with pytest.raises(ValidationError, match="LEGATO_REPO_PATH is required"):
        WorkerRuntimeSettings(OMR_ENGINE="legato", LEGATO_REPO_PATH=None)


def test_app_main_import_exposes_routes() -> None:
    from app.main import app

    route_paths = {route.path for route in app.routes}

    assert "/" in route_paths
    assert "/docs" in route_paths
    assert "/api/v1/openapi.json" in route_paths
    assert len(route_paths) > 0
