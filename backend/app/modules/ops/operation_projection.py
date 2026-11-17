"""Query-time projection of domain-owned durable work; no persisted Ops entity."""

from sqlalchemy import String, cast, case, func, literal, select, union_all
from app.core.config import settings
from app.db.models import (
    ImportJob,
    ImportDispatch,
    ScoreRevisionRenderOutbox,
    PlaybackOutbox,
    MailOutbox,
    ScoreDeletionOperation,
    ScoreRevision,
)
from app.modules.ops.operation_filters import AsyncOperationFilters
from app.modules.ops.schemas import AsyncOperationKind


def _delivery_status(c, *, succeeded="COMPLETED"):
    status = cast(c.status, String)
    return case(
        (status == succeeded, "succeeded"),
        (status == "SUPERSEDED", "superseded"),
        (status == "PROCESSING", "processing"),
        (status == "DISPATCHED", "dispatched"),
        (c.failure_retryable.is_(True), "retrying"),
        (status.in_(["FAILED", "PERMANENT_FAILURE", "EXPIRED"]), "failed"),
        else_="queued",
    )


def _delivery_projection(
    model, *, kind, identity, resource_type, resource_id, max_attempts, succeeded="COMPLETED"
):
    c = model.__table__.c
    return select(
        identity.label("operation_id"),
        literal(kind.value).label("kind"),
        resource_type.label("resource_type"),
        resource_id.label("resource_id"),
        c.originating_request_id,
        _delivery_status(c, succeeded=succeeded).label("status"),
        c.attempt_count.label("attempts"),
        literal(max_attempts).label("max_attempts"),
        c.next_attempt_at,
        c.failure_code.label("failure_code"),
        c.failure_stage.label("failure_stage"),
        c.failure_classification.label("failure_class"),
        c.failure_retryable.label("failure_retryable"),
        c.failure_detail.label("failure_detail"),
        c.created_at,
        c.updated_at,
        c.started_at,
        c.completed_at,
    )


def _import_projection():
    j, d = ImportJob.__table__.c, ImportDispatch.__table__.c
    terminal_failure = j.state == "FAILED"
    status = case(
        (j.state.in_(["READY_FOR_REVIEW", "CONFIRMED"]), "succeeded"),
        (terminal_failure, "failed"),
        else_=_delivery_status(d),
    )

    def failure(name):
        return case((terminal_failure, j["failure_" + name]), else_=d["failure_" + name])

    return select(
        d.dispatch_uuid.label("operation_id"),
        literal("import").label("kind"),
        literal("import_job").label("resource_type"),
        j.job_uuid.label("resource_id"),
        d.originating_request_id,
        status.label("status"),
        d.attempt_count.label("attempts"),
        literal(settings.IMPORT_DISPATCH_MAX_ATTEMPTS).label("max_attempts"),
        d.next_attempt_at,
        failure("code").label("failure_code"),
        failure("stage").label("failure_stage"),
        failure("classification").label("failure_class"),
        failure("retryable").label("failure_retryable"),
        case((terminal_failure, j.failure_detail), else_=d.failure_detail).label("failure_detail"),
        d.created_at,
        case((j.updated_at > d.updated_at, j.updated_at), else_=d.updated_at).label("updated_at"),
        func.coalesce(j.processing_started_at, d.started_at).label("started_at"),
        func.coalesce(j.processing_finished_at, d.completed_at).label("completed_at"),
    ).select_from(ImportJob.__table__.join(ImportDispatch.__table__, d.job_id == j.id))


def operation_projection():
    """One aligned SQL definition per kind, shared by list, summary and metrics."""
    r, p, m, s = (
        model.__table__.c
        for model in (ScoreRevisionRenderOutbox, PlaybackOutbox, MailOutbox, ScoreDeletionOperation)
    )
    return union_all(
        _import_projection(),
        _delivery_projection(
            ScoreRevisionRenderOutbox,
            kind=AsyncOperationKind.REVISION_RENDER,
            identity=r.outbox_uuid,
            resource_type=literal("score_revision"),
            resource_id=ScoreRevision.revision_uuid,
            max_attempts=settings.REVISION_RENDER_MAX_ATTEMPTS,
        )
        .select_from(ScoreRevisionRenderOutbox)
        .join(ScoreRevision, ScoreRevision.id == r.revision_id),
        _delivery_projection(
            PlaybackOutbox,
            kind=AsyncOperationKind.PLAYBACK,
            identity=p.outbox_uuid,
            resource_type=func.lower(cast(p.asset_kind, String)),
            resource_id=p.outbox_uuid,
            max_attempts=settings.PLAYBACK_OUTBOX_MAX_ATTEMPTS,
        ),
        _delivery_projection(
            MailOutbox,
            kind=AsyncOperationKind.MAIL,
            identity=m.outbox_uuid,
            resource_type=m.category,
            resource_id=m.outbox_uuid,
            max_attempts=settings.MAIL_OUTBOX_MAX_ATTEMPTS,
            succeeded="SENT",
        ),
        _delivery_projection(
            ScoreDeletionOperation,
            kind=AsyncOperationKind.SCORE_DELETION,
            identity=s.operation_uuid,
            resource_type=literal("score_deletion"),
            resource_id=s.score_uuid,
            max_attempts=settings.SCORE_DELETION_MAX_ATTEMPTS,
        ),
    ).subquery("durable_work")


def projection_predicates(
    c, filters: AsyncOperationFilters, *, kinds: tuple[AsyncOperationKind, ...]
):
    predicates = [c.kind.in_([kind.value for kind in kinds])]
    for column, value in (
        (c.status, filters.status),
        (c.failure_class, filters.failure_class),
        (c.resource_type, filters.resource_type),
    ):
        if value is not None:
            predicates.append(column == value)
    if filters.created_after is not None:
        predicates.append(c.created_at >= filters.created_after)
    if filters.updated_before is not None:
        predicates.append(c.updated_at <= filters.updated_before)
    return predicates
