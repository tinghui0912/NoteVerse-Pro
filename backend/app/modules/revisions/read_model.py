from __future__ import annotations

from app.modules.account.resource_users import resource_user_query
from app.modules.account.avatar_presentation import avatar_url_for_user

from sqlalchemy import select, func
from sqlalchemy.orm import Session, aliased, joinedload
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
    def revision_read(self, db: Session, revision: ScoreRevision) -> RevisionRead:
        return self.revision_page(db, [revision])[0]

    def revision_page(self, db: Session, revisions: list[ScoreRevision]) -> list[RevisionRead]:
        if not revisions:
            return []
        ids = [require_persisted_id(row.id, entity="score revision") for row in revisions]
        notes = {
            row.revision_id: row
            for row in db.scalars(
                select(ScoreRevisionNote).where(ScoreRevisionNote.revision_id.in_(ids))
            )
        }
        ranked = (
            select(
                ScoreRevisionEvent.id,
                func.row_number()
                .over(
                    partition_by=ScoreRevisionEvent.revision_id,
                    order_by=(
                        col(ScoreRevisionEvent.created_at).desc(),
                        ScoreRevisionEvent.id.desc(),
                    ),
                )
                .label("ordinal"),
            )
            .where(ScoreRevisionEvent.revision_id.in_(ids), ScoreRevisionEvent.type == "RESTORE")
            .subquery()
        )
        target = aliased(ScoreRevision)
        events = {
            row[0].revision_id: row
            for row in db.execute(
                select(ScoreRevisionEvent, target.revision_uuid, target.revision_number)
                .join(ranked, ranked.c.id == ScoreRevisionEvent.id)
                .outerjoin(target, target.id == ScoreRevisionEvent.target_revision_id)
                .where(ranked.c.ordinal == 1)
            )
        }
        actor_ids = {
            row.created_by_user_id for row in revisions if row.created_by_user_id is not None
        }
        actor_ids.update(
            row.author_user_id for row in notes.values() if row.author_user_id is not None
        )
        actor_ids.update(
            row[0].actor_user_id for row in events.values() if row[0].actor_user_id is not None
        )
        actors = (
            {
                row.id: row
                for row in db.scalars(
                    resource_user_query()
                    .options(joinedload(User.avatar_object))
                    .where(User.id.in_(actor_ids))
                )
            }
            if actor_ids
            else {}
        )
        result = []
        for revision in revisions:
            event_row = events.get(revision.id)
            event = event_row[0] if event_row else None
            note = notes.get(revision.id)
            result.append(
                RevisionRead(
                    revision_id=revision.revision_uuid,
                    revision_number=revision.revision_number,
                    origin=revision.origin,
                    created_at=revision.created_at,
                    created_by=actor_read(actors.get(revision.created_by_user_id)),
                    restore=RevisionRestoreRead(
                        restored_from_revision_id=event_row[1],
                        restored_from_revision_number=event_row[2],
                        note=event.note,
                        actor=actor_read(actors.get(event.actor_user_id)),
                        created_at=event.created_at,
                    )
                    if event is not None and event_row is not None
                    else None,
                    note=RevisionNoteRead(
                        note=note.note,
                        author=actor_read(actors.get(note.author_user_id)),
                        updated_at=note.updated_at,
                    )
                    if note
                    else None,
                )
            )
        return result

    def restore_read(self, db: Session, revision: ScoreRevision) -> RevisionRestoreRead | None:
        return self.revision_read(db, revision).restore

    def note_read(self, db: Session, revision: ScoreRevision) -> RevisionNoteRead | None:
        return self.revision_read(db, revision).note


def actor_read(user: User | None) -> RevisionActorRead | None:
    if user is None:
        return None
    return RevisionActorRead(
        display_name=user.display_name,
        email=user.email,
        avatar_url=avatar_url_for_user(user),
    )
