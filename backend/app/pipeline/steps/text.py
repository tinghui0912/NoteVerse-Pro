"""Text-recognition and integration step."""

from __future__ import annotations

import os
from typing import TYPE_CHECKING, cast

from celery.exceptions import SoftTimeLimitExceeded
from celery.utils.log import get_task_logger

from app.core.config import settings
from app.core.exceptions import TimeoutException

from ..base import Step
from ..context import JobContext

if TYPE_CHECKING:
    from app.processing.processors.text_recognition import (
        ClassifiedTexts,
        TextRecognitionProcessSuccessResult,
    )
    from app.processing.processors.text_integration import TextIntegrationSuccessResult

logger = get_task_logger(__name__)


class TextOcrStep(Step):
    """Run OCR on the first image and integrate recognized text into XML."""

    name = "text_ocr"
    progress_start = 70
    progress_end = 85

    def run(self, ctx: JobContext) -> None:
        ocr_result = self._recognize_text(ctx)
        if not ocr_result or not ocr_result.get("success"):
            return

        self._integrate_text(ctx, ocr_result)

    def _recognize_text(self, ctx: JobContext) -> TextRecognitionProcessSuccessResult | None:
        """Run PaddleOCR and return classified text metadata."""
        from app.processing.processors.text_recognition import (
            TextRecognitionEngine,
            TextRecognitionProcessSuccessResult,
        )

        image_path = ctx.first_image
        if not image_path or not os.path.exists(image_path):
            logger.warning(f"[{ctx.job_id}] Input image missing; skipping text recognition")
            return None
        if ctx.remaining() <= 0:
            raise TimeoutException(details={"error": "Task deadline exceeded before text recognition"})

        logger.info(f"[{ctx.job_id}] Starting PaddleOCR text recognition")

        try:
            engine = TextRecognitionEngine()
            timeout_seconds = min(
                ctx.remaining(),
                int(settings.PADDLEOCR_TIMEOUT_SECONDS),
            )
            result = engine.process_image(
                image_path,
                timeout_seconds=timeout_seconds,
            )

            if result.get("success"):
                typed_result = cast(TextRecognitionProcessSuccessResult, result)
                classified = typed_result["classified_texts"]
                logger.info(
                    f"[{ctx.job_id}] Text recognition completed: "
                    f"{self._summarize_classified_texts(classified)}"
                )
                return typed_result

            logger.warning(f"[{ctx.job_id}] Text recognition failed: {result.get('error')}")
            return None
        except SoftTimeLimitExceeded:
            raise
        except Exception as exc:
            logger.warning(f"[{ctx.job_id}] PaddleOCR failed: {exc}")
            return None

    def _integrate_text(
        self,
        ctx: JobContext,
        ocr_result: TextRecognitionProcessSuccessResult,
    ) -> None:
        """Write recognized text metadata into the current XML file."""
        from app.processing.processors.text_integration import (
            TextIntegrationEngine,
            TextIntegrationSuccessResult,
        )

        main_xml = ctx.main_xml
        if not main_xml or not os.path.exists(main_xml):
            logger.warning(f"[{ctx.job_id}] XML file missing; skipping text integration")
            return

        text_info = ocr_result["classified_texts"]
        if not text_info:
            logger.warning(f"[{ctx.job_id}] No text info available; skipping integration")
            return

        logger.info(
            f"[{ctx.job_id}] Integrating text into XML: "
            f"{self._summarize_classified_texts(text_info)}"
        )

        try:
            engine = TextIntegrationEngine()
            result = engine.integrate_text_with_existing_info(main_xml, text_info)

            if not result.get("success"):
                logger.warning(f"[{ctx.job_id}] Text integration failed: {result.get('error')}")
                return

            enhanced_path = self._resolve_enhanced_xml_path(
                main_xml,
                cast(TextIntegrationSuccessResult, result),
            )
            if not enhanced_path:
                logger.info(f"[{ctx.job_id}] Text integration completed")
                return

            ctx.main_xml = enhanced_path
            logger.info(f"[{ctx.job_id}] Text integration completed: {enhanced_path}")
        except Exception as exc:
            logger.warning(f"[{ctx.job_id}] Text integration error: {exc}")

    def _resolve_enhanced_xml_path(
        self,
        main_xml: str,
        result: TextIntegrationSuccessResult,
    ) -> str | None:
        """Return the generated enhanced XML path when it exists on disk."""
        enhanced_path = result["output_file"]
        if enhanced_path and os.path.exists(enhanced_path):
            return enhanced_path

        return None

    def _summarize_classified_texts(self, text_info: "ClassifiedTexts") -> str:
        """Return a compact, useful OCR classification summary for worker logs."""

        parts: list[str] = []
        for field in ("title", "subtitle", "composer", "lyricist", "copyright"):
            raw_value = text_info.get(field)
            if not isinstance(raw_value, str):
                continue
            value = raw_value.strip()
            if not value:
                continue
            parts.append(f"{field}={self._shorten_log_text(value)}")

        other_texts = text_info.get("other_texts") or []
        parts.append(f"other_texts={len(other_texts)}")
        return ", ".join(parts)

    @staticmethod
    def _shorten_log_text(value: str, max_length: int = 80) -> str:
        compact = " ".join(value.split())
        if len(compact) <= max_length:
            return repr(compact)
        return repr(f"{compact[:max_length - 1]}...")
