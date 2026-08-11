from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import col

from app.db.model_utils import require_persisted_id
from app.db.models import ScoreRevision, ScoreRevisionEvent, ScoreRevisionNote, User
from app.modules.revisions.schemas import (
    RevisionActorRead,
    RevisionNoteRead,
    RevisionRead,
    RevisionRestoreRead,
)


class RevisionReadModel:
    async def revision_read(self, db: AsyncSession, revision: ScoreRevision) -> RevisionRead:
        actor = await db.get(User, revision.created_by_user_id) if revision.created_by_user_id else None
        restore = await self.restore_read(db, revision)
        note = await self.note_read(db, revision)
        return RevisionRead(
            revision_id=revision.revision_uuid,
            revision_number=revision.revision_number,
            origin=revision.origin,
            created_at=revision.created_at,
            created_by=actor_read(actor),
            restore=restore,
            note=note,
        )

    async def restore_read(
        self, db: AsyncSession, revision: ScoreRevision
    ) -> RevisionRestoreRead | None:
        revision_id = require_persisted_id(revision.id, entity="score revision")
        event = (
            await db.execute(
                select(ScoreRevisionEvent)
                .where(
                    ScoreRevisionEvent.revision_id == revision_id,
                    ScoreRevisionEvent.type == "RESTORE",
                )
                .order_by(col(ScoreRevisionEvent.created_at).desc())
                .limit(1)
            )
        ).scalar_one_or_none()
        if event is None:
            return None
        target = await db.get(ScoreRevision, event.target_revision_id) if event.target_revision_id else None
        actor = await db.get(User, event.actor_user_id) if event.actor_user_id else None
        return RevisionRestoreRead(
            restored_from_revision_id=target.revision_uuid if target else None,
            restored_from_revision_number=target.revision_number if target else None,
            note=event.note,
            actor=actor_read(actor),
            created_at=event.created_at,
        )

    async def note_read(
        self, db: AsyncSession, revision: ScoreRevision
    ) -> RevisionNoteRead | None:
        revision_id = require_persisted_id(revision.id, entity="score revision")
        note = (
            await db.execute(
                select(ScoreRevisionNote).where(ScoreRevisionNote.revision_id == revision_id)
            )
        ).scalar_one_or_none()
        if note is None:
            return None
        author = await db.get(User, note.author_user_id) if note.author_user_id else None
        return RevisionNoteRead(
            note=note.note,
            author=actor_read(author),
            updated_at=note.updated_at,
        )


def actor_read(user: User | None) -> RevisionActorRead | None:
    if user is None:
        return None
    return RevisionActorRead(
        display_name=user.display_name,
        email=user.email,
        avatar_url=user.avatar_url,
    )
