"""Domain-owned failure facts and exact attempt fencing."""

from unittest.mock import Mock

import pytest
from celery.exceptions import SoftTimeLimitExceeded

from app.core.config import settings
from app.modules.import_jobs.pipeline_runner import ImportPipelineRunner
from app.core.exceptions import (
    FileNotFoundException,
    OmrFailedException,
    PipelineException,
    TimeoutException,
)
from app.db.models import (
    ScoreRevisionRenderOutbox,
    PlaybackOutbox,
    MailOutbox,
    MailOutboxStatus,
    ScoreDeletionOperation,
    ScoreDeletionOperationStatus,
)
from app.modules.revisions.render_states import ScoreRevisionRenderStatus
from app.modules.playback.domain import PlaybackOutboxStatus
from app.modules.durable_work.delivery import DeliveryAttemptLease
from app.modules.durable_work.failure import (
    DurableFailure,
    set_failure_facts,
    clear_failure_facts,
)
from app.shared.durable_failure import DurableFailureClass
from app.modules.revisions.render_delivery import ScoreRevisionRenderDelivery
from app.modules.playback.outbox_service import PlaybackOutboxService
from app.modules.mail.outbox_service import MailOutboxService
from app.modules.scores.deletion_delivery import ScoreDeletionDeliveryService, ScoreDeletionLease
from app.shared.time import utc_now


def failure_facts(record):
    return (
        record.failure_code,
        record.failure_stage,
        record.failure_classification,
        record.failure_retryable,
        record.failure_detail,
    )


@pytest.mark.parametrize(
    "error,code,classification",
    [
        (SoftTimeLimitExceeded(), "import_pipeline_timeout", "transient"),
        (TimeoutException(), "import_pipeline_timeout", "transient"),
        (FileNotFoundException(), "import_inputs_unavailable", "permanent"),
        (OmrFailedException(), "import_pipeline_rejected", "user_error"),
        (PipelineException(), "import_pipeline_failed", "system_error"),
        (
            RuntimeError("storage timeout unsupported file"),
            "import_pipeline_failed",
            "system_error",
        ),
        (RuntimeError("provider refused"), "import_pipeline_failed", "system_error"),
    ],
)
def test_import_execution_failure_uses_typed_evidence(error, code, classification):
    failure = ImportPipelineRunner.failure_for_exception(error)
    assert failure == DurableFailure(code, "pipeline", DurableFailureClass(classification), False)


@pytest.mark.parametrize(
    "kind,model,status,service,max_attempts",
    [
        (
            "render",
            ScoreRevisionRenderOutbox,
            ScoreRevisionRenderStatus,
            ScoreRevisionRenderDelivery,
            settings.REVISION_RENDER_MAX_ATTEMPTS,
        ),
        (
            "playback",
            PlaybackOutbox,
            PlaybackOutboxStatus,
            PlaybackOutboxService,
            settings.PLAYBACK_OUTBOX_MAX_ATTEMPTS,
        ),
    ],
)
@pytest.mark.parametrize("message", ["timeout storage unsupported", "provider refused"])
@pytest.mark.parametrize("exhausted", [False, True])
def test_derivative_execution_failure_is_explicit_and_attempt_fenced(
    kind, model, status, service, max_attempts, message, exhausted
):
    row = model(
        status=status.PROCESSING,
        attempt_count=max_attempts if exhausted else 1,
        attempt_token="current",
        started_at=utc_now(),
    )
    owner = service()
    owner._get = Mock(return_value=row)
    lease = DeliveryAttemptLease(attempt=row.attempt_count, token="current")
    assert owner.fail(Mock(), "operation", message, lease=lease)
    assert row.failure_code == (
        kind + "_attempts_exhausted" if exhausted else kind + "_execution_failed"
    )
    assert row.failure_classification == "system_error"
    assert row.failure_retryable is (not exhausted)
    assert row.failure_detail == message
    facts = (failure_facts(row), row.status)
    assert not owner.fail(Mock(), "operation", "late timeout", lease=lease)
    assert (failure_facts(row), row.status) == facts


@pytest.mark.parametrize(
    "method,code,classification",
    [
        ("transient_failure", "mail_provider_transient", "transient"),
        ("permanent_failure", "mail_provider_permanent", "permanent"),
        ("execution_failure", "mail_execution_failed", "system_error"),
    ],
)
@pytest.mark.parametrize("exhausted", [False, True])
def test_mail_provider_outcome_owns_failure_taxonomy(method, code, classification, exhausted):
    row = MailOutbox(
        source_kind="ACCOUNT",
        source_id=1,
        status=MailOutboxStatus.PROCESSING,
        attempt_count=settings.MAIL_OUTBOX_MAX_ATTEMPTS if exhausted else 1,
        attempt_token="current",
        text_body="body",
        started_at=utc_now(),
    )
    owner = MailOutboxService()
    owner._get = Mock(return_value=row)
    assert getattr(owner, method)(
        Mock(),
        "operation",
        "timeout unsupported storage",
        lease=DeliveryAttemptLease(attempt=row.attempt_count, token="current"),
    )
    assert row.failure_classification == classification
    assert row.failure_code == (
        "mail_attempts_exhausted" if exhausted and method != "permanent_failure" else code
    )
    assert row.failure_retryable is (not exhausted and method != "permanent_failure")
    assert row.failure_stage == "delivery" and row.failure_detail == "timeout unsupported storage"
    facts = failure_facts(row)
    assert not getattr(owner, method)(
        Mock(),
        "operation",
        "late evidence",
        lease=DeliveryAttemptLease(attempt=row.attempt_count, token="current"),
    )
    assert failure_facts(row) == facts


def test_score_deletion_failure_records_system_class_and_terminal_exhaustion(monkeypatch):
    row = ScoreDeletionOperation(
        status=ScoreDeletionOperationStatus.PROCESSING,
        attempt_count=settings.SCORE_DELETION_MAX_ATTEMPTS,
        attempt_token="current",
        score_uuid="score",
        started_at=utc_now(),
    )
    monkeypatch.setattr("app.modules.scores.deletion_delivery.lock_operation", lambda *_: row)
    lease = ScoreDeletionLease(
        operation_uuid="operation", score_uuid="score", attempt=row.attempt_count, token="current"
    )
    assert ScoreDeletionDeliveryService().fail(Mock(), lease, "timeout unavailable unsupported")
    assert row.failure_code == "score_deletion_attempts_exhausted"
    assert row.failure_classification == "system_error"
    assert row.failure_retryable is False
    assert row.failure_detail == "timeout unavailable unsupported"
    facts = failure_facts(row)
    assert not ScoreDeletionDeliveryService().fail(Mock(), lease, "late evidence")
    assert failure_facts(row) == facts


def test_failure_facts_copies_and_clears_exact_facts():
    row = Mock()
    failure = DurableFailure(
        "render_execution_failed", "render", DurableFailureClass.SYSTEM_ERROR, True
    )
    set_failure_facts(row, failure, detail="provider evidence" * 1000)
    assert row.failure_detail == ("provider evidence" * 1000)[:4000]
    assert (
        row.failure_code,
        row.failure_stage,
        row.failure_classification,
        row.failure_retryable,
    ) == (failure.code, failure.stage, failure.classification, True)
    clear_failure_facts(row)
    assert (
        row.failure_code
        is row.failure_stage
        is row.failure_classification
        is row.failure_retryable
        is row.failure_detail
        is None
    )


@pytest.mark.parametrize(
    "kind,model,status,service,max_attempts",
    [
        (
            "render",
            ScoreRevisionRenderOutbox,
            ScoreRevisionRenderStatus,
            ScoreRevisionRenderDelivery,
            settings.REVISION_RENDER_MAX_ATTEMPTS,
        ),
        (
            "playback",
            PlaybackOutbox,
            PlaybackOutboxStatus,
            PlaybackOutboxService,
            settings.PLAYBACK_OUTBOX_MAX_ATTEMPTS,
        ),
    ],
)
@pytest.mark.parametrize("exhausted", [False, True])
def test_derivative_lease_recovery_records_exact_cause_and_retry_capacity(
    kind, model, status, service, max_attempts, exhausted
):
    from datetime import timedelta

    row = model(
        status=status.PROCESSING,
        attempt_count=max_attempts if exhausted else 1,
        attempt_token="current",
        started_at=utc_now() - timedelta(days=1),
    )
    db = Mock()
    db.execute.return_value.scalars.return_value.all.side_effect = [[row], []]
    service().recover_and_list_due(db)
    assert row.failure_code == (
        kind + "_attempts_exhausted" if exhausted else kind + "_delivery_lease_expired"
    )
    assert row.failure_classification == "transient"
    assert row.failure_retryable is (not exhausted)
    assert row.attempt_token is None


@pytest.mark.parametrize(
    "kind,model,status,service,max_attempts",
    [
        (
            "render",
            ScoreRevisionRenderOutbox,
            ScoreRevisionRenderStatus,
            ScoreRevisionRenderDelivery,
            settings.REVISION_RENDER_MAX_ATTEMPTS,
        ),
        (
            "playback",
            PlaybackOutbox,
            PlaybackOutboxStatus,
            PlaybackOutboxService,
            settings.PLAYBACK_OUTBOX_MAX_ATTEMPTS,
        ),
        (
            "mail",
            MailOutbox,
            MailOutboxStatus,
            MailOutboxService,
            settings.MAIL_OUTBOX_MAX_ATTEMPTS,
        ),
    ],
)
def test_broker_rejection_records_dispatch_failure_without_consuming_attempt(
    kind, model, status, service, max_attempts
):
    row = model(status=status.DISPATCHED, attempt_count=1)
    owner = service()
    owner._get = Mock(return_value=row)
    owner.release_dispatch(Mock(), "operation", "unsupported timeout provider")
    assert row.attempt_count == 1 and row.status == status.PENDING
    assert row.failure_code == kind + "_dispatch_failed"
    assert row.failure_stage == "dispatch"
    assert row.failure_classification == "transient" and row.failure_retryable is True


@pytest.mark.parametrize(
    "kind,model,service",
    [
        ("render", ScoreRevisionRenderOutbox, ScoreRevisionRenderDelivery),
        ("playback", PlaybackOutbox, PlaybackOutboxService),
    ],
)
def test_unavailable_derivative_input_is_permanent(kind, model, service):
    row = model()
    service()._exhaust_unavailable_resources(row)
    assert row.failure_code == kind + "_resources_unavailable"
    assert row.failure_classification == "permanent" and row.failure_retryable is False


@pytest.mark.parametrize(
    "cause,code,classification",
    [
        ("body", "mail_body_unavailable", "permanent"),
        ("expired", "mail_expired", "permanent"),
        ("attempts", "mail_attempts_exhausted", "transient"),
    ],
)
def test_mail_admission_records_non_retryable_failure(cause, code, classification):
    from datetime import timedelta

    row = MailOutbox(
        source_kind="ACCOUNT",
        source_id=1,
        status=MailOutboxStatus.PENDING,
        text_body="body" if cause != "body" else None,
        attempt_count=settings.MAIL_OUTBOX_MAX_ATTEMPTS if cause == "attempts" else 0,
        expires_at=utc_now() - timedelta(seconds=1) if cause == "expired" else None,
    )
    db = Mock()
    db.execute.return_value.scalar_one_or_none.return_value = row
    assert MailOutboxService().claim(db, "operation") is None
    assert row.failure_code == code
    assert row.failure_stage == "delivery"
    assert row.failure_classification == classification
    assert row.failure_retryable is False


@pytest.mark.parametrize("exhausted", [False, True])
def test_mail_lease_recovery_preserves_transient_cause_until_attempts_exhausted(exhausted):
    from datetime import timedelta

    row = MailOutbox(
        source_kind="ACCOUNT",
        source_id=1,
        status=MailOutboxStatus.PROCESSING,
        text_body="body",
        attempt_token="current",
        attempt_count=settings.MAIL_OUTBOX_MAX_ATTEMPTS if exhausted else 1,
        started_at=utc_now() - timedelta(days=1),
    )
    db = Mock()
    db.execute.return_value.scalars.return_value.all.side_effect = [[row], [], []]
    MailOutboxService().recover_and_list_due(db)
    assert row.failure_code == (
        "mail_attempts_exhausted" if exhausted else "mail_delivery_lease_expired"
    )
    assert row.failure_classification == "transient"
    assert row.failure_retryable is (not exhausted)
    assert row.attempt_token is None


@pytest.mark.parametrize("exhausted", [False, True])
def test_score_deletion_lease_recovery_owns_retry_capacity(exhausted):
    from datetime import timedelta

    row = ScoreDeletionOperation(
        status=ScoreDeletionOperationStatus.PROCESSING,
        attempt_token="current",
        attempt_count=settings.SCORE_DELETION_MAX_ATTEMPTS if exhausted else 1,
        started_at=utc_now() - timedelta(days=1),
    )
    db = Mock()
    db.scalars.return_value.all.return_value = [row]
    ScoreDeletionDeliveryService().recover_and_list_due(db)
    assert row.failure_code == (
        "score_deletion_attempts_exhausted" if exhausted else "score_deletion_lease_expired"
    )
    assert row.failure_classification == "transient"
    assert row.failure_retryable is (not exhausted)
    assert row.attempt_token is None


@pytest.mark.parametrize(
    "model,service",
    [
        (ScoreRevisionRenderOutbox, ScoreRevisionRenderDelivery),
        (PlaybackOutbox, PlaybackOutboxService),
        (MailOutbox, MailOutboxService),
    ],
)
def test_healthy_queued_delivery_rejects_operator_rearm(model, service):
    from app.core.exceptions import ValidationException

    row = model(text_body="body")
    owner = service()
    owner._get = Mock(return_value=row)
    with pytest.raises(ValidationException):
        owner.rearm_for_operator(Mock(), "operation")
    assert row.attempt_count == 0 and row.failure_code is None


@pytest.mark.parametrize(
    "kind",
    [
        "import",
        "revision_render",
        "playback",
        "mail",
        "score_deletion",
        "account_deletion",
        "stored_object_retirement",
    ],
)
def test_ops_flushes_domain_rearm_for_atomic_audit_and_reads_the_sql_projection(kind, monkeypatch):
    from app.modules.ops import command_service
    from app.modules.ops.schemas import AsyncOperationKind

    owners = {
        "import": command_service.import_dispatch_service,
        "revision_render": command_service.revision_render_delivery,
        "playback": command_service.playback_outbox_service,
        "mail": command_service.mail_outbox_service,
        "score_deletion": command_service.score_deletion_delivery,
        "account_deletion": command_service.account_deletion_delivery,
        "stored_object_retirement": command_service.retirement_delivery,
    }
    owner = Mock(return_value="FAILED")
    monkeypatch.setattr(owners[kind], "rearm_for_operator", owner)
    read = Mock()
    monkeypatch.setattr(command_service.ops_async_operation_query_service, "get_operation", read)
    db = Mock()
    result = command_service.OpsAsyncOperationCommandService().retry_operation(
        db, kind=AsyncOperationKind(kind), operation_id="operation"
    )
    owner.assert_called_once_with(db, "operation")
    db.flush.assert_called_once()
    db.commit.assert_not_called()
    read.assert_called_once_with(db, kind=AsyncOperationKind(kind), operation_id="operation")
    assert result.operation is read.return_value and result.previous_state == "FAILED"


def test_import_broker_rejection_records_delivery_facts_without_mutating_job(monkeypatch):
    from app.db.models import ImportDispatch, ImportDispatchStatus
    from app.modules.import_jobs.dispatch_service import ImportDispatchService

    row = ImportDispatch(status=ImportDispatchStatus.DISPATCHED, attempt_count=0)
    monkeypatch.setattr("app.modules.import_jobs.dispatch_service.lock_dispatch", lambda *_: row)
    ImportDispatchService().release_dispatch(Mock(), "operation", "timeout storage unsupported")
    assert row.status == ImportDispatchStatus.PENDING and row.attempt_count == 0
    assert (
        row.failure_code,
        row.failure_stage,
        row.failure_classification,
        row.failure_retryable,
    ) == ("import_dispatch_failed", "dispatch", "transient", True)


def test_score_deletion_broker_rejection_records_dispatch_facts(monkeypatch):
    row = ScoreDeletionOperation(status=ScoreDeletionOperationStatus.DISPATCHED, attempt_count=0)
    monkeypatch.setattr("app.modules.scores.deletion_delivery.lock_operation", lambda *_: row)
    assert ScoreDeletionDeliveryService().release_dispatch(
        Mock(), "operation", "timeout storage unsupported"
    )
    assert row.status == ScoreDeletionOperationStatus.PENDING and row.attempt_count == 0
    assert (
        row.failure_code,
        row.failure_stage,
        row.failure_classification,
        row.failure_retryable,
    ) == ("score_deletion_dispatch_failed", "dispatch", "transient", True)
