"""Personal Take page presentation with one visibility query, without per-row authorization."""

from sqlalchemy import select
from sqlalchemy.orm import Session
from app.db.models import Score, PerformanceTake
from app.modules.score_access.queries import accessible_score_predicate
from app.modules.performance_takes.aggregate import performance_take_facts_from_row
from app.modules.performance_takes.schemas import PerformanceTakeRead


def take_read(take: PerformanceTake, linked_score_id: str | None) -> PerformanceTakeRead:
    facts = performance_take_facts_from_row(take)
    manifest, recording = facts.manifest, facts.recording_object

    return PerformanceTakeRead(
        take_id=manifest.take_uuid,
        media_status=take.media_status,
        manifest=manifest.snapshot,
        recording_media={"mime_type": recording.content_type, "byte_size": recording.byte_size},
        linked_score_id=linked_score_id,
        can_open_score=linked_score_id is not None,
        created_at=take.created_at,
    )


class PerformanceTakeReadModel:
    def take_page(
        self, db: Session, user_id: int, rows: list[PerformanceTake]
    ) -> list[PerformanceTakeRead]:
        ids = {row.linked_score_id for row in rows if row.linked_score_id is not None}
        accessible = (
            dict(
                db.execute(
                    select(Score.id, Score.score_uuid).where(
                        Score.id.in_(ids), accessible_score_predicate(user_id)
                    )
                ).all()
            )
            if ids
            else {}
        )
        return [take_read(row, accessible.get(row.linked_score_id)) for row in rows]
