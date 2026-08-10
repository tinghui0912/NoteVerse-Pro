from __future__ import annotations

from pathlib import Path

import pytest
from pydantic import ValidationError

from app.core.settings.worker_model_engine import WorkerModelEngineSettings


def _settings(**overrides: object) -> WorkerModelEngineSettings:
    values: dict[str, object] = {
        "HF_MODEL_REPOSITORIES": "guangyangmusic/legato,meta-llama/Llama-3.2-11B-Vision",
        "LEGATO_REPO_PATH": "/opt/noteverse/legato",
    }
    values.update(overrides)
    return WorkerModelEngineSettings(
        **values,
    )


def test_worker_model_engine_settings_normalize_paths_and_model_repositories() -> None:
    settings = _settings(
        MODEL_ROOT="~/noteverse/models",
        HF_HOME="~/noteverse/models/huggingface",
        PADDLEOCR_MODEL_ROOT="~/noteverse/models/paddleocr",
    )

    assert settings.MODEL_ROOT == str(Path("~/noteverse/models").expanduser())
    assert settings.HF_HOME == str(Path("~/noteverse/models/huggingface").expanduser())
    assert settings.HF_MODEL_REPOSITORIES == [
        "guangyangmusic/legato",
        "meta-llama/Llama-3.2-11B-Vision",
    ]


def test_worker_model_engine_settings_validate_selected_engines() -> None:
    settings = _settings(OMR_ENGINE="LEGATO", SCORE_RENDER_ENGINE="VEROVIO", VEROVIO_FOOTER="ALWAYS")

    assert settings.OMR_ENGINE == "legato"
    assert settings.SCORE_RENDER_ENGINE == "verovio"
    assert settings.VEROVIO_FOOTER == "always"

    with pytest.raises(ValidationError, match="OMR_ENGINE"):
        _settings(OMR_ENGINE="unknown")
    with pytest.raises(ValidationError, match="SCORE_RENDER_ENGINE"):
        _settings(SCORE_RENDER_ENGINE="unknown")


@pytest.mark.parametrize("field_name", ("PADDLEOCR_TIMEOUT_SECONDS",))
def test_worker_model_engine_settings_reject_non_positive_runtime_limits(field_name: str) -> None:
    with pytest.raises(ValidationError, match="task timing settings must be positive"):
        _settings(**{field_name: 0})


def test_worker_model_engine_settings_require_legato_repository() -> None:
    with pytest.raises(ValidationError, match="LEGATO_REPO_PATH is required"):
        _settings(LEGATO_REPO_PATH=None)
