"""Fingering-generation helpers for XML workflows."""
from __future__ import annotations

import os

from app.core.config import settings
from app.core.exceptions import ExternalServiceException
from app.core.logger import logger
from app.modules.xml.schemas import XMLFingeringResult
from app.shared.constants import ErrorCode


class XMLFingeringService:
    """Generate fingering-enhanced XML from current XML content."""

    def generate(
        self,
        task_uuid: str,
        xml_content: str,
        hand: str = "both",
        depth: int = 6,
    ) -> XMLFingeringResult:
        try:
            from pianoplayer import run_pianoplayer

            temp_input = os.path.join(settings.WORK_ROOT, task_uuid, "fingering_input.xml")
            temp_output = os.path.join(settings.WORK_ROOT, task_uuid, "fingering_output.xml")
            os.makedirs(os.path.dirname(temp_input), exist_ok=True)

            with open(temp_input, "w", encoding="utf-8") as file_handle:
                file_handle.write(xml_content)

            run_pianoplayer(temp_input, temp_output, hand=hand, depth=depth)

            with open(temp_output, "r", encoding="utf-8") as file_handle:
                result_xml = file_handle.read()

            return {"xml_content": result_xml, "hand": hand, "depth": depth}

        except ImportError:
            raise ExternalServiceException(
                service="pianoplayer",
                code=ErrorCode.EXTERNAL_SERVICE_ERROR,
                details={"error": "pianoplayer module not installed"},
            )
        except Exception as exc:
            logger.error(f"Fingering generation failed: {exc}")
            raise ExternalServiceException(
                service="pianoplayer",
                code=ErrorCode.EXTERNAL_SERVICE_ERROR,
                details={"error": str(exc)},
            )


xml_fingering_service = XMLFingeringService()
