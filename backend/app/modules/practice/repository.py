from __future__ import annotations

from sqlalchemy import func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.exc import IntegrityError
from sqlmodel import select

from app.db.models import (
    PracticeAttempt,
    PracticeEvaluationProfile,
    PracticeReplayArtifact,
    PracticeReplayArtifactKind,
    PracticeReplayObjectDeletionOutbox,
    PracticeSession,
    PracticeSessionState,
)


class PracticeRepository:
    """Repository boundary for practice-session persistence."""

    async def create_session(
        self,
        db: AsyncSession,
        session: PracticeSession,
    ) -> PracticeSession:
        db.add(session)
        await db.commit()
        await db.refresh(session)
        return session

    async def get_session_by_uuid(
        self,
        db: AsyncSession,
        session_uuid: str,
    ) -> PracticeSession | None:
        result = await db.exec(
            select(PracticeSession).where(PracticeSession.session_uuid == session_uuid)
        )
        return result.one_or_none()

    async def save_session(
        self,
        db: AsyncSession,
        session: PracticeSession,
    ) -> PracticeSession:
        db.add(session)
        await db.commit()
        await db.refresh(session)
        return session

    async def create_attempt_if_absent(
        self,
        db: AsyncSession,
        attempt: PracticeAttempt,
    ) -> bool:
        """Persist a resolved attempt once per session-scoped attempt identity."""
        db.add(attempt)
        try:
            await db.commit()
        except IntegrityError:
            await db.rollback()
            existing_attempt = await self.get_attempt_by_uid(
                db,
                session_id=attempt.session_id,
                attempt_uid=attempt.attempt_uid,
            )
            if existing_attempt is None:
                raise
            return False
        await db.refresh(attempt)
        return True

    async def get_attempt_by_uid(
        self,
        db: AsyncSession,
        *,
        session_id: int,
        attempt_uid: str,
    ) -> PracticeAttempt | None:
        result = await db.exec(
            select(PracticeAttempt).where(
                PracticeAttempt.session_id == session_id,
                PracticeAttempt.attempt_uid == attempt_uid,
            )
        )
        return result.one_or_none()

    async def next_attempt_index(
        self,
        db: AsyncSession,
        session_id: int,
    ) -> int:
        result = await db.exec(
            select(func.max(PracticeAttempt.attempt_index)).where(
                PracticeAttempt.session_id == session_id
            )
        )
        current = result.one_or_none()
        return int(current or 0) + 1

    async def list_attempts_for_session(
        self,
        db: AsyncSession,
        session_id: int,
    ) -> list[PracticeAttempt]:
        result = await db.exec(
            select(PracticeAttempt)
            .where(PracticeAttempt.session_id == session_id)
            .order_by(PracticeAttempt.attempt_index)
        )
        return list(result.all())

    async def create_replay_artifact(
        self,
        db: AsyncSession,
        artifact: PracticeReplayArtifact,
    ) -> PracticeReplayArtifact:
        db.add(artifact)
        await db.commit()
        await db.refresh(artifact)
        return artifact

    async def get_replay_artifact_by_uuid(
        self,
        db: AsyncSession,
        artifact_uuid: str,
    ) -> PracticeReplayArtifact | None:
        result = await db.exec(
            select(PracticeReplayArtifact).where(
                PracticeReplayArtifact.artifact_uuid == artifact_uuid
            )
        )
        return result.one_or_none()

    async def get_replay_artifact_for_session_kind(
        self,
        db: AsyncSession,
        session_id: int,
        kind: PracticeReplayArtifactKind,
    ) -> PracticeReplayArtifact | None:
        result = await db.exec(
            select(PracticeReplayArtifact).where(
                PracticeReplayArtifact.session_id == session_id,
                PracticeReplayArtifact.kind == kind,
            )
        )
        return result.one_or_none()

    async def list_replay_artifacts_for_session(
        self,
        db: AsyncSession,
        session_id: int,
    ) -> list[PracticeReplayArtifact]:
        result = await db.exec(
            select(PracticeReplayArtifact)
            .where(PracticeReplayArtifact.session_id == session_id)
            .order_by(PracticeReplayArtifact.created_at.desc())
        )
        return list(result.all())

    async def has_replay_artifact_for_session(
        self,
        db: AsyncSession,
        session_id: int,
    ) -> bool:
        result = await db.exec(
            select(PracticeReplayArtifact.id)
            .where(PracticeReplayArtifact.session_id == session_id)
            .limit(1)
        )
        return result.first() is not None

    async def list_saved_performances_for_score_user(
        self,
        db: AsyncSession,
        *,
        score_id: int,
        user_id: int,
        limit: int,
    ) -> list[tuple[PracticeSession, PracticeReplayArtifact]]:
        result = await db.exec(
            select(PracticeSession, PracticeReplayArtifact)
            .join(
                PracticeReplayArtifact,
                PracticeReplayArtifact.session_id == PracticeSession.id,
            )
            .where(
                PracticeSession.score_id == score_id,
                PracticeSession.user_id == user_id,
                PracticeSession.state == PracticeSessionState.FINISHED,
                PracticeSession.evaluation_profile == PracticeEvaluationProfile.PERFORMANCE,
            )
            .order_by(PracticeReplayArtifact.created_at.desc())
            .limit(limit)
        )
        return [(session, artifact) for session, artifact in result.all()]

    async def delete_replay_artifact_and_queue_object_deletion(
        self,
        db: AsyncSession,
        artifact: PracticeReplayArtifact,
        deletion: PracticeReplayObjectDeletionOutbox,
    ) -> None:
        db.add(deletion)
        await db.delete(artifact)
        await db.commit()
