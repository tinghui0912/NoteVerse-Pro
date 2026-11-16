"""Rendering delivery state for domain readiness projections."""

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import RenderOutbox, RenderOutboxStatus


def latest_revision_render_status(
    db: Session, revision_id: int, *, render_profile: str = "default"
) -> RenderOutboxStatus | None:
    return db.scalar(
        select(RenderOutbox.status)
        .where(
            RenderOutbox.revision_id == revision_id,
            RenderOutbox.render_profile == render_profile,
        )
        .order_by(RenderOutbox.created_at.desc())
        .limit(1)
    )
