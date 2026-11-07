"""Persisted service witnesses; resource admission has its own domain suites."""

from dataclasses import dataclass
from datetime import datetime, timedelta
import importlib

import pytest
from sqlmodel import SQLModel, Session, create_engine

from app.core.config import settings
from app.db.models import (
    MailOutbox,
    PlaybackOutbox,
    RenderOutbox,
    RenderTargetType,
)
from app.modules.revisions.presentation_demand import RevisionPresentationDemand

NOW = datetime(2026, 11, 6, 12)
CASES = [
    (
        "score_assets.render_outbox_service",
        "RenderOutboxService",
        "RENDER_OUTBOX",
        RenderOutbox,
        dict(
            target_type=RenderTargetType.REVIEW_THUMBNAIL,
            import_job_id=1,
            source_fingerprint="f" * 64,
        ),
    ),
    (
        "playback.outbox_service",
        "PlaybackOutboxService",
        "PLAYBACK_OUTBOX",
        PlaybackOutbox,
        dict(score_id=1, revision_id=1, requested_by_user_id=1, source_fingerprint="f" * 64),
    ),
    (
        "mail.outbox_service",
        "MailOutboxService",
        "MAIL_OUTBOX",
        MailOutbox,
        dict(
            category="test",
            dedupe_key="mail",
            recipient="reader@example.test",
            subject="test",
            text_body="body",
        ),
    ),
]


@dataclass(frozen=True)
class AdmittedPayload:
    attempt: int = 0
    max_attempts: int = 0


@pytest.fixture(params=CASES, ids=[case[1] for case in CASES])
def delivery(request, monkeypatch):
    module_name, service_name, prefix, model, fields = request.param
    module = importlib.import_module(f"app.modules.{module_name}")
    clock = [NOW]
    monkeypatch.setattr(module, "utc_now_naive", lambda: clock[0])
    for suffix, value in [
        ("MAX_ATTEMPTS", 5),
        ("RETRY_BASE_SECONDS", 60),
        ("DISPATCH_TIMEOUT_SECONDS", 300),
        ("PROCESSING_TIMEOUT_SECONDS", 1200),
    ]:
        monkeypatch.setattr(settings, f"{prefix}_{suffix}", value)
    service = getattr(module, service_name)()
    if model in (RenderOutbox, PlaybackOutbox):
        # Exercise lifecycle persistence after a successful domain payload admission.
        monkeypatch.setattr(service, "_build_payload", lambda *_: AdmittedPayload())
    if model is PlaybackOutbox:
        monkeypatch.setattr(module, "lock_presentation_score", lambda *_: None)
        monkeypatch.setattr(
            module, "revision_presentation_demand", lambda *_: RevisionPresentationDemand.DEMANDED
        )
    engine = create_engine("sqlite://")
    SQLModel.metadata.create_all(engine)
    with Session(engine) as db:
        row = model(outbox_uuid="delivery", next_attempt_at=NOW, **fields)
        db.add(row)
        db.commit()
        yield db, service, row, module._delivery_lifecycle().statuses, clock
    engine.dispose()


def test_domain_delivery_persists_dispatch_claim_retry_and_success(delivery):
    db, service, row, statuses, clock = delivery
    assert service.mark_dispatched(db, row.outbox_uuid)
    assert row.status == statuses.dispatched
    assert row.dispatched_at == NOW and row.updated_at == NOW
    service.release_dispatch(db, row.outbox_uuid, "broker" * 1000)
    assert row.status == statuses.pending
    assert row.attempt_count == 0 and row.dispatched_at is None
    assert row.last_error == ("broker" * 1000)[:4000]
    assert service.mark_dispatched(db, row.outbox_uuid)
    payload = service.claim(db, row.outbox_uuid)
    assert payload.attempt == row.attempt_count == 1
    assert payload.max_attempts == 5
    assert service.claim(db, row.outbox_uuid) is None
    fail = service.transient_failure if isinstance(row, MailOutbox) else service.fail
    fail(db, row.outbox_uuid, "transient" * 1000)
    assert row.status == statuses.failed
    assert row.attempt_count == 1
    assert row.next_attempt_at == NOW + timedelta(seconds=60)
    assert row.last_error == ("transient" * 1000)[:4000]
    assert not service.mark_dispatched(db, row.outbox_uuid)
    clock[0] += timedelta(seconds=60)
    assert service.mark_dispatched(db, row.outbox_uuid)
    payload = service.claim(db, row.outbox_uuid)
    assert payload.attempt == row.attempt_count == 2
    if isinstance(row, MailOutbox):
        service.sent(db, row.outbox_uuid, provider_message_id="provider-message")
        assert row.text_body is None and row.html_body is None
        assert row.provider_message_id == "provider-message"
    else:
        service.complete(db, row.outbox_uuid)
    db.commit()
    db.refresh(row)
    assert row.status == statuses.succeeded
    assert row.completed_at == clock[0] and row.updated_at == clock[0]
    assert row.last_error is None
    assert service.claim(db, row.outbox_uuid) is None


@pytest.mark.parametrize("lease", ["dispatch", "processing"])
def test_domain_lease_recovery_is_immediately_due_without_consuming_attempt(delivery, lease):
    db, service, row, statuses, _clock = delivery
    row.attempt_count = 2
    if lease == "dispatch":
        row.status = statuses.dispatched
        row.dispatched_at = NOW - timedelta(seconds=300)
    else:
        row.status = statuses.processing
        row.started_at = NOW - timedelta(seconds=1200)
    db.commit()
    assert service.recover_and_list_due(db) == [row.outbox_uuid]
    db.commit()
    db.refresh(row)
    assert row.status == statuses.failed
    assert row.attempt_count == 2
    assert row.next_attempt_at == NOW and row.updated_at == NOW
    assert row.last_error.endswith("lease expired")
