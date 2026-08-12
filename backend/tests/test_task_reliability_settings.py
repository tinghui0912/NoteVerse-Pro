import pytest
from pydantic import ValidationError

from app.core.settings.worker_runtime import WorkerRuntimeSettings
from app.core.settings.task_reliability import TaskReliabilitySettings


def test_task_reliability_settings_accept_an_ordered_shutdown_envelope() -> None:
    settings = TaskReliabilitySettings(
        MAX_PROCESSING_TIME=900,
        CELERY_TASK_SOFT_TIME_LIMIT=960,
        CELERY_TASK_TIME_LIMIT=1020,
    )

    assert settings.CELERY_TASK_TIME_LIMIT == 1020


@pytest.mark.parametrize(
    ("values", "message"),
    [
        (
            {"MAX_PROCESSING_TIME": 960, "CELERY_TASK_SOFT_TIME_LIMIT": 960},
            "MAX_PROCESSING_TIME must be lower",
        ),
        (
            {"CELERY_TASK_SOFT_TIME_LIMIT": 1020, "CELERY_TASK_TIME_LIMIT": 1020},
            "CELERY_TASK_SOFT_TIME_LIMIT must be lower",
        ),
        ({"MAX_PROCESSING_TIME": 0}, "task timing settings must be positive"),
    ],
)
def test_task_reliability_settings_reject_invalid_deadline_envelopes(
    values: dict[str, int], message: str
) -> None:
    with pytest.raises(ValidationError, match=message):
        TaskReliabilitySettings(**values)


def test_worker_runtime_settings_reject_ocr_deadline_above_processing_deadline() -> None:
    with pytest.raises(ValidationError, match="PADDLEOCR_TIMEOUT_SECONDS must not exceed"):
        WorkerRuntimeSettings(
            LEGATO_REPO_PATH="/opt/noteverse/legato",
            PLAYBACK_SOUNDFONT_PATH="/opt/noteverse/models/soundfonts/FluidR3_GM.sf2",
            PADDLEOCR_TIMEOUT_SECONDS=901,
            MAX_PROCESSING_TIME=900,
        )
