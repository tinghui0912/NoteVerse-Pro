"""Admit concrete domain deliveries for synchronous generation-service tests."""

from sqlalchemy import select
from uuid import uuid4
from app.db.models import ScoreRevisionRenderOutbox, PlaybackOutbox
from app.modules.revisions.render_delivery import (
    revision_render_delivery,
    _delivery_lifecycle as render_lifecycle,
)
from app.modules.playback.outbox_service import (
    playback_outbox_service,
    _delivery_lifecycle as playback_lifecycle,
)
from app.shared.time import utc_now


def revision_attempt(db, kind, score, revision):
    model, service, lifecycle = (
        (ScoreRevisionRenderOutbox, revision_render_delivery, render_lifecycle)
        if kind == "render"
        else (PlaybackOutbox, playback_outbox_service, playback_lifecycle)
    )
    row = db.scalars(select(model).where(model.revision_id == revision.id)).one_or_none()
    if row is None:
        fields = dict(
            outbox_uuid=str(uuid4()),
            score_id=score.id,
            revision_id=revision.id,
            source_fingerprint=revision.content_hash,
            requested_by_user_id=score.owner_user_id,
        )
        row = model(**fields)
        db.add(row)
    else:
        # This fixture explicitly requests a fresh replacement generation.
        lifecycle().rearm(row, now=utc_now())
    db.commit()
    payload = service.claim(db, row.outbox_uuid)
    assert payload is not None
    db.commit()
    return payload
