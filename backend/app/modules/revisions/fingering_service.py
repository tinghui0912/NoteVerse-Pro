from __future__ import annotations

import os
from typing import TypedDict

from app.core.config import settings
from app.core.exceptions import ExternalServiceException
from app.core.logger import logger
from app.shared.constants import ErrorCode


class FingeringResult(TypedDict):
    xml_content: str
    hand: str
    depth: int


class XMLFingeringService:
    def generate(self, score_id: str, xml_content: str, hand: str = "both", depth: int = 6) -> FingeringResult:
        try:
            from pianoplayer import run_pianoplayer

            work_dir = os.path.join(settings.WORK_ROOT, score_id)
            input_path = os.path.join(work_dir, "fingering_input.xml")
            output_path = os.path.join(work_dir, "fingering_output.xml")
            os.makedirs(work_dir, exist_ok=True)
            with open(input_path, "w", encoding="utf-8") as handle:
                handle.write(xml_content)
            run_pianoplayer(input_path, output_path, hand=hand, depth=depth)
            with open(output_path, encoding="utf-8") as handle:
                return {"xml_content": handle.read(), "hand": hand, "depth": depth}
        except ImportError as exc:
            raise ExternalServiceException(
                service="pianoplayer",
                code=ErrorCode.EXTERNAL_SERVICE_ERROR,
                details={"error": "pianoplayer module not installed"},
            ) from exc
        except Exception as exc:
            logger.error(f"Fingering generation failed: {exc}")
            raise ExternalServiceException(
                service="pianoplayer",
                code=ErrorCode.EXTERNAL_SERVICE_ERROR,
                details={"error": str(exc)},
            ) from exc
