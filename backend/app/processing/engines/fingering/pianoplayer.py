from __future__ import annotations

import os
import xml.etree.ElementTree as ET
from typing import TypedDict

from app.core.config import settings
from app.core.exceptions import ExternalServiceException
from app.core.logger import logger
from app.shared.constants import ErrorCode


class FingeringResult(TypedDict):
    xml_content: str
    hand_size: str


class PianoplayerFingeringEngine:
    def generate(self, score_id: str, xml_content: str, hand_size: str = "M") -> FingeringResult:
        try:
            from pianoplayer.core import run_annotate

            work_dir = os.path.join(settings.WORK_ROOT, score_id)
            input_path = os.path.join(work_dir, "fingering_input.xml")
            output_path = os.path.join(work_dir, "fingering_output.xml")
            os.makedirs(work_dir, exist_ok=True)
            with open(input_path, "w", encoding="utf-8") as handle:
                handle.write(strip_existing_fingerings(xml_content))
            run_annotate(input_path, outputfile=output_path, quiet=True, hand_size=hand_size)
            with open(output_path, encoding="utf-8") as handle:
                return {"xml_content": handle.read(), "hand_size": hand_size}
        except ImportError as exc:
            raise ExternalServiceException(
                service="score_fingering",
                code=ErrorCode.SCORE_FINGERING_FAILED,
            ) from exc
        except Exception as exc:
            logger.bind(
                event="score_fingering.generation_failed",
                score_id=score_id,
                hand_size=hand_size,
                exception_type=type(exc).__name__,
            ).opt(exception=exc).error("Score fingering generation failed")
            raise ExternalServiceException(
                service="score_fingering",
                code=ErrorCode.SCORE_FINGERING_FAILED,
            ) from exc


def strip_existing_fingerings(xml_content: str) -> str:
    root = ET.fromstring(xml_content)
    parent_map = {child: parent for parent in root.iter() for child in parent}

    for fingering in list(root.iter()):
        if _local_name(fingering.tag) != "fingering":
            continue
        technical = parent_map.get(fingering)
        if technical is None:
            continue
        technical.remove(fingering)

        if _local_name(technical.tag) == "technical" and len(list(technical)) == 0:
            notations = parent_map.get(technical)
            if notations is not None:
                notations.remove(technical)
                if _local_name(notations.tag) == "notations" and len(list(notations)) == 0:
                    note = parent_map.get(notations)
                    if note is not None:
                        note.remove(notations)

    return ET.tostring(root, encoding="unicode")


def _local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]
