from __future__ import annotations

import subprocess
from types import SimpleNamespace
from unittest.mock import patch

from app.pipeline.steps.text import TextOcrStep
from app.processing.engines.paddle import run_ocr_subprocess
from app.processing.processors.text_recognition import TextRecognitionEngine


def test_run_ocr_subprocess_maps_timeout_to_failure() -> None:
    with patch(
        "app.processing.engines.paddle.subprocess.run",
        side_effect=subprocess.TimeoutExpired(cmd=["python"], timeout=12),
    ):
        result = run_ocr_subprocess(__file__, timeout_seconds=12)

    assert result["success"] is False
    assert result["code"] == "task_timeout"


def test_text_ocr_step_passes_remaining_timeout_to_engine() -> None:
    step = TextOcrStep()
    ctx = SimpleNamespace(
        task_id="task-ocr",
        first_image=__file__,
        remaining=lambda: 55,
    )

    with patch.object(
        TextRecognitionEngine,
        "process_image",
        return_value={"success": False, "error": "noop", "texts": []},
    ) as process_image_mock:
        result = step._recognize_text(ctx)

    assert result is None
    process_image_mock.assert_called_once_with(__file__, timeout_seconds=55)
