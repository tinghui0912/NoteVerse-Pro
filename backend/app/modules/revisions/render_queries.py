"""Rendering delivery state for domain readiness projections."""

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import ScoreRevisionRenderOutbox
from app.modules.revisions.render_states import ScoreRevisionRenderStatus


def revision_render_status(
    db: Session, revision_id: int, *, render_profile: str
) -> ScoreRevisionRenderStatus | None:
    return db.scalar(
        select(ScoreRevisionRenderOutbox.status).where(
            ScoreRevisionRenderOutbox.revision_id == revision_id,
            ScoreRevisionRenderOutbox.render_profile == render_profile,
        )
    )
