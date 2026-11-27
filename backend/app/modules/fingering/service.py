"""Application service for interactive, unsaved fingering suggestions."""

from __future__ import annotations

from typing import NoReturn, Protocol, TypedDict

from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.exceptions import ExternalServiceException, ValidationException
from app.core.logger import logger
from app.modules.fingering.execution import (
    FingeringExecutionCapacityExceeded,
    FingeringExecutionService,
    fingering_execution_service,
)
from app.modules.fingering.schemas import FingeringRequest, FingeringResultRead
from app.modules.score_access.actions import ScoreAction
from app.modules.score_access.policy import ScoreAccessPolicy
from app.processing.engines.fingering import PianoplayerFingeringEngine
from app.processing.musicxml.admission import admit_musicxml_document
from app.shared.error_codes import CustomerErrorCode


class FingeringGeneration(TypedDict):
    xml_content: str
    hand_size: str


class FingeringEngine(Protocol):
    def generate(
        self, score_id: str, xml_content: str, hand_size: str = "M"
    ) -> FingeringGeneration: ...


class FingeringService:
    """Authorize and generate a non-persistent editor suggestion."""

    def __init__(
        self,
        *,
        access_policy: ScoreAccessPolicy | None = None,
        engine: FingeringEngine | None = None,
        execution: FingeringExecutionService | None = None,
    ) -> None:
        self._access_policy = access_policy or ScoreAccessPolicy()
        self._engine = engine or PianoplayerFingeringEngine()
        self._execution = execution or fingering_execution_service

    def authorize_generation(self, db: Session, score_uuid: str, user_id: int) -> None:
        self._access_policy.authorize_score(db, score_uuid, ScoreAction.EDIT, user_id=user_id)

    async def generate(self, score_uuid: str, request: FingeringRequest) -> FingeringResultRead:
        content = request.content.encode("utf-8")
        if len(content) > settings.FINGERING_MAX_CONTENT_BYTES:
            raise ValidationException(CustomerErrorCode.REVISION_CONTENT_INVALID, field="content")
        content = admit_musicxml_document(content)

        try:
            generated = await self._execution.run(
                self._engine.generate,
                score_uuid,
                content.decode("utf-8"),
                hand_size=request.hand_size,
            )
        except FingeringExecutionCapacityExceeded as exc:
            raise ExternalServiceException(
                service="score_fingering", code=CustomerErrorCode.SCORE_FINGERING_FAILED
            ) from exc

        generated_content = generated.get("xml_content")
        if not isinstance(generated_content, str):
            self._raise_invalid_engine_result(score_uuid)
        try:
            generated_content = admit_musicxml_document(generated_content.encode("utf-8")).decode(
                "utf-8"
            )
        except ValidationException:
            self._raise_invalid_engine_result(score_uuid)
        return FingeringResultRead(content=generated_content)

    @staticmethod
    def _raise_invalid_engine_result(score_uuid: str) -> NoReturn:
        logger.bind(
            event="score_fingering.invalid_engine_result",
            score_id=score_uuid,
        ).warning("Fingering engine returned an invalid MusicXML document")
        raise ExternalServiceException(
            service="score_fingering",
            code=CustomerErrorCode.SCORE_FINGERING_FAILED,
        )
