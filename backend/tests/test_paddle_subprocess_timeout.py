from __future__ import annotations

import subprocess
import os
from types import SimpleNamespace
from unittest.mock import patch

from app.processing.engines.paddle_worker import _build_paddleocr_kwargs
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


def test_run_ocr_subprocess_prefers_structured_stdout_error() -> None:
    completed = subprocess.CompletedProcess(
        args=["python"],
        returncode=1,
        stdout='{"success": false, "error": "real paddle error", "code": "ocr_failed"}',
        stderr="No ccache found warning",
    )

    with patch("app.processing.engines.paddle.subprocess.run", return_value=completed):
        result = run_ocr_subprocess(__file__, timeout_seconds=12)

    assert result["success"] is False
    assert result["code"] == "ocr_failed"
    assert result["error"] == "real paddle error"


def test_build_paddleocr_kwargs_supports_v3_device_parameter(monkeypatch) -> None:
    class FakePaddleOcr:
        def __init__(
            self,
            lang: str,
            use_textline_orientation: bool,
            use_doc_orientation_classify: bool,
            use_doc_unwarping: bool,
            device: str,
            text_detection_model_dir: str,
            text_recognition_model_dir: str,
            textline_orientation_model_dir: str,
        ) -> None:
            pass

    monkeypatch.setenv("PADDLEOCR_DETECTION_MODEL_DIR", "/models/det")
    monkeypatch.setenv("PADDLEOCR_RECOGNITION_MODEL_DIR", "/models/rec")
    monkeypatch.setenv("PADDLEOCR_TEXTLINE_ORIENTATION_MODEL_DIR", "/models/ori")
    fake_paddle = SimpleNamespace(
        device=SimpleNamespace(is_compiled_with_cuda=lambda: True)
    )

    kwargs = _build_paddleocr_kwargs(fake_paddle, FakePaddleOcr)

    assert kwargs == {
        "lang": "ch",
        "use_textline_orientation": True,
        "use_doc_orientation_classify": False,
        "use_doc_unwarping": False,
        "device": "gpu",
        "text_detection_model_dir": os.path.abspath("/models/det"),
        "text_recognition_model_dir": os.path.abspath("/models/rec"),
        "textline_orientation_model_dir": os.path.abspath("/models/ori"),
    }


def test_build_paddleocr_kwargs_supports_v2_use_gpu_parameter(monkeypatch) -> None:
    class FakePaddleOcr:
        def __init__(
            self,
            lang: str,
            use_angle_cls: bool,
            use_gpu: bool,
            det_model_dir: str,
            rec_model_dir: str,
            cls_model_dir: str,
        ) -> None:
            pass

    monkeypatch.setenv("PADDLEOCR_DETECTION_MODEL_DIR", "/models/det")
    monkeypatch.setenv("PADDLEOCR_RECOGNITION_MODEL_DIR", "/models/rec")
    monkeypatch.setenv("PADDLEOCR_TEXTLINE_ORIENTATION_MODEL_DIR", "/models/ori")
    fake_paddle = SimpleNamespace(
        device=SimpleNamespace(is_compiled_with_cuda=lambda: False)
    )

    kwargs = _build_paddleocr_kwargs(fake_paddle, FakePaddleOcr)

    assert kwargs == {
        "lang": "ch",
        "use_angle_cls": True,
        "use_gpu": False,
        "det_model_dir": os.path.abspath("/models/det"),
        "rec_model_dir": os.path.abspath("/models/rec"),
        "cls_model_dir": os.path.abspath("/models/ori"),
    }


def test_text_ocr_step_caps_timeout_at_remaining_task_time() -> None:
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


def test_text_ocr_step_caps_timeout_at_paddle_limit(monkeypatch) -> None:
    step = TextOcrStep()
    ctx = SimpleNamespace(
        task_id="task-ocr",
        first_image=__file__,
        remaining=lambda: 600,
    )
    monkeypatch.setattr(
        "app.pipeline.steps.text.settings.PADDLEOCR_TIMEOUT_SECONDS",
        120,
    )

    with patch.object(
        TextRecognitionEngine,
        "process_image",
        return_value={"success": False, "error": "noop", "texts": []},
    ) as process_image_mock:
        result = step._recognize_text(ctx)

    assert result is None
    process_image_mock.assert_called_once_with(__file__, timeout_seconds=120)


def test_text_ocr_step_summarizes_classified_text_values() -> None:
    step = TextOcrStep()

    summary = step._summarize_classified_texts(
        {
            "title": "Once Again",
            "subtitle": "再次见到你",
            "composer": "原唱：金妍英&Mad Clown",
            "lyricist": None,
            "copyright": "MayPiano 版权所有",
            "other_texts": [
                {"text": "Piano", "confidence": 0.9, "position": "(1, 2)", "relative_y": 0.5}
            ],
        }
    )

    assert "title='Once Again'" in summary
    assert "subtitle='再次见到你'" in summary
    assert "composer='原唱：金妍英&Mad Clown'" in summary
    assert "copyright='MayPiano 版权所有'" in summary
    assert "other_texts=1" in summary


def test_text_classifier_allows_title_words_containing_metadata_terms() -> None:
    engine = TextRecognitionEngine()

    result = engine.classify_texts(
        [
            {
                "text": "作曲家",
                "confidence": 0.99,
                "bbox": None,
                "center_x": 100,
                "center_y": 10,
                "width": 100,
                "height": 20,
            }
        ]
    )

    assert result["title"] == "作曲家"


def test_text_classifier_excludes_title_metadata_labels() -> None:
    engine = TextRecognitionEngine()

    result = engine.classify_texts(
        [
            {
                "text": "作曲：久石让",
                "confidence": 0.99,
                "bbox": None,
                "center_x": 100,
                "center_y": 10,
                "width": 100,
                "height": 20,
            }
        ]
    )

    assert result["title"] is None
