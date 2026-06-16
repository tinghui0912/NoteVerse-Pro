"""Audiveris implementation of the generic OMR engine contract."""

from __future__ import annotations

from typing import cast

from app.core.config import settings
from app.processing.engines.audiveris import (
    AudiverisEngine,
    AudiverisFailureResult,
    AudiverisSuccessResult,
)

from .base import OmrFailureResult, OmrResult, OmrSuccessResult


class AudiverisOmrEngine:
    """Adapt the existing Audiveris CLI wrapper to the OMR interface."""

    engine_name = "audiveris"

    def __init__(
        self,
        output_folder: str,
        timeout_seconds: int,
        audiveris_path: str | None = None,
    ) -> None:
        self._engine = AudiverisEngine(
            audiveris_path=audiveris_path or settings.AUDIVERIS_PATH,
            output_folder=output_folder,
            timeout_seconds=timeout_seconds,
        )

    def process_image(self, image_path: str) -> OmrResult:
        result = self._engine.process_image(image_path)
        return self._adapt_result(result)

    def process_pdf(self, pdf_path: str) -> OmrResult:
        result = self._engine.process_pdf(pdf_path)
        return self._adapt_result(result)

    def _adapt_result(
        self,
        result: AudiverisSuccessResult | AudiverisFailureResult,
    ) -> OmrResult:
        if result.get("success"):
            success = cast(AudiverisSuccessResult, result)
            return OmrSuccessResult(
                success=True,
                engine=self.engine_name,
                files=success["files"],
                stdout=success["stdout"],
                stderr=success["stderr"],
            )

        failure = cast(AudiverisFailureResult, result)
        return OmrFailureResult(
            success=False,
            engine=self.engine_name,
            error=failure["error"],
            code=failure["code"],
        )
