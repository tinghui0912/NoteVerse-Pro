from __future__ import annotations

import asyncio
from pathlib import Path

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import ExternalServiceException, ResourceNotFoundException
from app.core.logger import logger
from app.db.model_utils import require_persisted_id
from app.modules.practice.source_schemas import (
    PracticeAttackTargetRead,
    PracticeReadyScoreContentRead,
    PracticeScoreArtifactRead,
    PracticeStepNoteRead,
    PracticeTargetCatalogRead,
    PracticeTargetRead,
)
from app.modules.score_access.policy import ScoreAccessContext, ScoreAccessPolicy, ScoreAction
from app.modules.score_assets.repository import ScoreAssetRepository
from app.processing.engines.practice_alignment.musicxml_stable_ids import (
    prepare_musicxml_ids_for_practice,
)
from app.processing.engines.practice_alignment.score_timeline import (
    PracticeAttackTarget,
    PracticeStepNote,
)
from app.processing.engines.practice_alignment.target_catalog import (
    PracticeTargetCatalog,
    practice_target_catalog_from_musicxml,
)
from app.processing.practice_score.practice_score_artifact import (
    practice_score_artifact_from_timeline,
)
from app.processing.practice_score.score_loader import (
    practice_score_timeline_from_musicxml,
)
from app.processing.practice_score.tempo import practice_tempo_segments_from_musicxml
from app.shared.constants import ErrorCode
from app.storage import FileStorage, file_storage


class PracticeSourceService:
    """Provides immutable revision-bound source data for browser-local practice."""

    def __init__(
        self,
        *,
        access_policy: ScoreAccessPolicy | None = None,
        asset_repository: ScoreAssetRepository | None = None,
        storage: FileStorage | None = None,
    ) -> None:
        self.access_policy = access_policy or ScoreAccessPolicy()
        self.asset_repository = asset_repository or ScoreAssetRepository()
        self.storage = storage or file_storage

    async def list_practice_targets(
        self,
        db: AsyncSession,
        score_uuid: str,
        user_id: int,
        revision_uuid: str | None,
    ) -> PracticeTargetCatalogRead:
        access, score_file_path = await self._practice_musicxml_path(
            db,
            score_uuid=score_uuid,
            user_id=user_id,
            revision_uuid=revision_uuid,
        )
        try:
            catalog = await asyncio.to_thread(
                practice_target_catalog_from_musicxml,
                score_file_path,
            )
        except Exception as exc:
            logger.bind(
                event="practice.target_catalog.failed",
                score_id=access.score.score_uuid,
                revision_id=access.revision.revision_uuid,
            ).opt(exception=exc).warning("Practice target catalog generation failed")
            raise ExternalServiceException(
                service="practice_target_catalog",
                code=ErrorCode.PRACTICE_ALIGNMENT_FAILED,
            ) from exc

        return self._target_catalog_read(
            access.score.score_uuid,
            access.revision.revision_uuid,
            catalog,
        )

    async def get_practice_score_artifact(
        self,
        db: AsyncSession,
        score_uuid: str,
        user_id: int,
        revision_uuid: str | None,
    ) -> PracticeScoreArtifactRead:
        access, score_file_path = await self._practice_musicxml_path(
            db,
            score_uuid=score_uuid,
            user_id=user_id,
            revision_uuid=revision_uuid,
        )
        try:
            timeline = await asyncio.to_thread(
                practice_score_timeline_from_musicxml,
                score_file_path,
            )
            score_tempo_segments = await asyncio.to_thread(
                practice_tempo_segments_from_musicxml,
                score_file_path,
            )
            artifact = await asyncio.to_thread(
                practice_score_artifact_from_timeline,
                timeline,
                score_id=access.score.score_uuid,
                revision_id=access.revision.revision_uuid,
                score_tempo_segments=score_tempo_segments,
            )
        except Exception as exc:
            logger.bind(
                event="practice.score_artifact.failed",
                score_id=access.score.score_uuid,
                revision_id=access.revision.revision_uuid,
            ).opt(exception=exc).warning("Practice score artifact generation failed")
            raise ExternalServiceException(
                service="practice_score_artifact",
                code=ErrorCode.PRACTICE_ALIGNMENT_FAILED,
            ) from exc

        return PracticeScoreArtifactRead(**artifact)

    async def get_practice_ready_score_content(
        self,
        db: AsyncSession,
        score_uuid: str,
        user_id: int,
        revision_uuid: str,
    ) -> PracticeReadyScoreContentRead:
        access, score_file_path = await self._practice_musicxml_path(
            db,
            score_uuid=score_uuid,
            user_id=user_id,
            revision_uuid=revision_uuid,
        )
        try:
            source_xml = await asyncio.to_thread(score_file_path.read_text, encoding="utf-8")
            prepared_xml = await asyncio.to_thread(prepare_musicxml_ids_for_practice, source_xml)
        except Exception as exc:
            logger.bind(
                event="practice.ready_score_content.failed",
                score_id=access.score.score_uuid,
                revision_id=access.revision.revision_uuid,
            ).opt(exception=exc).warning("Practice ready score content generation failed")
            raise ExternalServiceException(
                service="practice_ready_score_content",
                code=ErrorCode.PRACTICE_ALIGNMENT_FAILED,
            ) from exc

        return PracticeReadyScoreContentRead(
            score_id=access.score.score_uuid,
            revision_id=access.revision.revision_uuid,
            content=prepared_xml,
        )

    @staticmethod
    def _target_catalog_read(
        score_uuid: str,
        revision_uuid: str,
        catalog: PracticeTargetCatalog,
    ) -> PracticeTargetCatalogRead:
        return PracticeTargetCatalogRead(
            score_id=score_uuid,
            revision_id=revision_uuid,
            targets=[
                PracticeTargetRead(
                    index=target.index,
                    group_id=target.group_id,
                    onset_beat=target.onset_beat,
                    event_ids=list(target.event_ids),
                    render_note_ids=list(target.render_note_ids),
                    pitches=list(target.pitches),
                    measure_numbers=list(target.measure_numbers),
                    staff_ids=list(target.staff_ids),
                    voice_ids=list(target.voice_ids),
                    step_id=target.step_id,
                    attack_targets=[
                        PracticeSourceService._attack_target_read(attack_target)
                        for attack_target in target.attack_targets
                    ],
                    continuation=[
                        PracticeSourceService._step_note_read(note)
                        for note in target.continuation
                    ],
                )
                for target in catalog.targets
            ],
        )

    @staticmethod
    def _step_note_read(note: PracticeStepNote) -> PracticeStepNoteRead:
        return PracticeStepNoteRead(
            step_note_id=note.step_note_id,
            event_id=note.event_id,
            pitch=note.pitch,
            render_note_id=note.render_note_id,
            measure_numbers=list(note.measure_numbers),
            staff_ids=list(note.staff_ids),
            voice_ids=list(note.voice_ids),
        )

    @staticmethod
    def _attack_target_read(target: PracticeAttackTarget) -> PracticeAttackTargetRead:
        return PracticeAttackTargetRead(
            attack_id=target.attack_id,
            pitch=target.pitch,
            notes=[PracticeSourceService._step_note_read(note) for note in target.notes],
            event_ids=list(target.event_ids),
            render_note_ids=list(target.render_note_ids),
            measure_numbers=list(target.measure_numbers),
        )

    async def _practice_musicxml_path(
        self,
        db: AsyncSession,
        *,
        score_uuid: str,
        user_id: int,
        revision_uuid: str | None,
    ) -> tuple[ScoreAccessContext, Path]:
        access = await self.access_policy.authorize(
            db,
            score_uuid,
            ScoreAction.PRACTICE,
            user_id=user_id,
            revision_uuid=revision_uuid,
        )
        revision_id = require_persisted_id(access.revision.id, entity="score revision")
        source = await self.asset_repository.canonical_source(db, revision_id)
        if not source:
            raise ResourceNotFoundException("source", revision_uuid, ErrorCode.FILE_NOT_FOUND)

        return access, Path(
            self.storage.materialize_to_local(
                source.storage_key,
                self.storage.local_path(source.storage_key),
            )
        )
