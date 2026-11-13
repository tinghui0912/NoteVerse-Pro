"""Durable presentation demand, post-commit relaying, and generation admission."""

from app.db.models import StoredObject

from contextlib import contextmanager
from hashlib import sha256
from unittest.mock import Mock

import pytest
from sqlalchemy import select, func
from sqlalchemy.orm import Session

from app.db.models import (
    Score,
    ScoreRevision,
    ScoreRevisionSource,
    RenderOutbox,
    RenderOutboxStatus,
    RenderTargetType,
    PlaybackOutbox,
    PlaybackOutboxStatus,
    ImportJob,
    ImportDispatch,
    ImportDispatchStatus,
    ScoreDeletionStatus,
)
from app.db.models.import_job import ImportJobState
from app.db.models.score import RevisionOrigin, RevisionSourceFormat
from app.modules.revisions import dispatch
from app.modules.revisions.derivatives import revision_derivative_service, RevisionDerivativeService
from app.modules.revisions.service import RevisionService
from app.modules.scores.creation_service import SyncConfirmedScoreCreationService
from app.modules.revisions.schemas import RevisionCreateRequest
from app.modules.review.service import ReviewService
from app.modules.review.schemas import ReviewConfirmRequest
from app.modules.guest_previews.service import GuestPreviewService
from app.modules.guest_previews.schemas import GuestPreviewUpdateRequest
from app.modules.score_assets.render_outbox_service import render_outbox_service
from app.modules.playback.outbox_service import playback_outbox_service
from app.modules.score_assets.derived_assets import derived_asset_status
from app.task_queue import producer
from tests.test_score_revision_services import score_service_session as score_service_session
from tests.test_score_revision_services import AsyncSessionAdapter, MUSICXML_2


@pytest.fixture
def revisions(score_service_session):
    db, storage = score_service_session
    score = Score(id=800, score_uuid="demand-score", title="Demand", owner_user_id=1)
    db.add(score)
    db.commit()
    rows = []
    for number, step in enumerate(("C", "D", "E"), 1):
        content = MUSICXML_2.replace("<step>C</step>", f"<step>{step}</step>").encode()
        fingerprint = sha256(content).hexdigest()
        revision = ScoreRevision(
            id=800 + number,
            revision_uuid=f"demand-r{number}",
            score_id=800,
            revision_number=number,
            content_hash=fingerprint,
            origin=RevisionOrigin.EDIT,
        )
        db.add(revision)
        db.flush()
        stored = storage.put_bytes(
            key=f"demand/{number}.musicxml",
            content=content,
            content_type="application/vnd.recordare.musicxml+xml",
        )
        db.add(
            ScoreRevisionSource(
                source_uuid=f"demand-source-{number}",
                revision_id=revision.id,
                format=RevisionSourceFormat.MUSICXML,
                stored_object=StoredObject(
                    object_key=stored.object_key,
                    byte_size=stored.size_bytes,
                    content_type="application/vnd.recordare.musicxml+xml",
                    sha256=fingerprint,
                ),
                filename=stored.object_key.rsplit("/", 1)[-1],
                generator="test",
                generator_version="1",
            )
        )
        db.add(
            RenderOutbox(
                outbox_uuid=f"render-{number}",
                target_type=RenderTargetType.SCORE_REVISION,
                score_id=800,
                revision_id=revision.id,
                source_fingerprint=fingerprint,
                requested_by_user_id=1,
            )
        )
        db.add(
            PlaybackOutbox(
                outbox_uuid=f"audio-{number}",
                score_id=800,
                revision_id=revision.id,
                source_fingerprint=fingerprint,
            )
        )
        rows.append(revision)
    score.head_revision_id = rows[-1].id
    db.commit()
    return db, storage, score, rows


def work_rows(db, number):
    return (
        db.scalar(select(RenderOutbox).where(RenderOutbox.outbox_uuid == f"render-{number}")),
        db.scalar(select(PlaybackOutbox).where(PlaybackOutbox.outbox_uuid == f"audio-{number}")),
    )


@pytest.mark.parametrize("enabled", [False, True])
def test_historical_revisions_are_not_generation_demand_and_never_runs_generators(
    revisions, monkeypatch, enabled
):
    db, storage, score, rows = revisions
    score.guest_preview_enabled = enabled
    db.commit()
    from app.worker.execution import render_outbox, playback_outbox

    @contextmanager
    def database():
        yield db
        db.commit()

    monkeypatch.setattr(render_outbox, "get_worker_db", database)
    monkeypatch.setattr(playback_outbox, "get_worker_db", database)
    render = Mock(side_effect=AssertionError("Unexpected historical render"))
    audio = Mock(side_effect=AssertionError("Unexpected historical audio"))
    monkeypatch.setattr(render_outbox, "_render_target", render)
    monkeypatch.setattr(playback_outbox.PlaybackGenerationService, "render_sync", audio)
    for number in (1, 2):
        for work in work_rows(db, number):
            work.attempt_count = 2
            work.last_error = "an earlier retry"
            work.internal_error_code = "earlier diagnostic"
        db.commit()
        assert (
            render_outbox.execute_render_outbox_task(None, f"render-{number}")["status"]
            == "ignored"
        )
        assert (
            playback_outbox.execute_playback_outbox_task(None, f"audio-{number}")["status"]
            == "ignored"
        )
        for work in work_rows(db, number):
            assert work.status.value == "SUPERSEDED" and work.attempt_count == 2
            assert (
                work.last_error
                is work.internal_error_code
                is work.dispatched_at
                is work.started_at
                is None
            )
    render.assert_not_called()
    audio.assert_not_called()
    assert render_outbox_service.claim(db, "render-3") is not None
    assert playback_outbox_service.claim(db, "audio-3") is not None
    assert len(db.scalars(select(ScoreRevisionSource)).all()) == 3
    assert all(
        storage.exists(source.stored_object.object_key)
        for source in db.scalars(select(ScoreRevisionSource))
    )


def test_processing_is_not_cancelled_and_missing_source_is_not_superseded(revisions):
    db, _, score, rows = revisions
    render, audio = work_rows(db, 1)
    render.status = RenderOutboxStatus.PROCESSING
    audio.status = PlaybackOutboxStatus.PROCESSING
    db.commit()
    assert render_outbox_service.claim(db, "render-1") is None
    assert playback_outbox_service.claim(db, "audio-1") is None
    assert render.status.value == audio.status.value == "PROCESSING"
    source = db.scalar(
        select(ScoreRevisionSource).where(ScoreRevisionSource.revision_id == rows[1].id)
    )
    db.delete(source)
    db.commit()
    assert render_outbox_service.claim(db, "render-2") is None
    assert playback_outbox_service.claim(db, "audio-2") is None
    assert all(work.status.value == "FAILED" and work.last_error for work in work_rows(db, 2))
    score.deletion_status = ScoreDeletionStatus.DELETING
    db.commit()
    assert render_outbox_service.claim(db, "render-3") is None
    assert playback_outbox_service.claim(db, "audio-3") is None
    assert all(work.status.value == "FAILED" for work in work_rows(db, 3))


@pytest.mark.parametrize("operation", ["save", "restore", "confirm", "confirm_sync"])
@pytest.mark.parametrize("broker_fails", [False, True])
@pytest.mark.asyncio
async def test_business_commit_precedes_immediate_dispatch_and_broker_failure_is_recoverable(
    revisions, monkeypatch, operation, broker_fails, tmp_path
):
    db, storage, score, rows = revisions
    calls = []
    observed = []

    @contextmanager
    def database():
        yield db
        db.commit()

    monkeypatch.setattr(dispatch, "get_worker_db", database)

    def broker(task_name, *, kwargs, task_id):
        model = RenderOutbox if "render" in task_name else PlaybackOutbox
        with Session(db.get_bind()) as check:
            row = check.scalar(select(model).where(model.outbox_uuid == kwargs["outbox_uuid"]))
            assert row.status.value == "DISPATCHED"
        calls.append(task_name)
        if broker_fails:
            raise ConnectionError("broker unavailable")

    monkeypatch.setattr(producer.celery_app, "send_task", broker)

    def relay_after_commit(work):
        assert not db.in_transaction()
        with Session(db.get_bind()) as check:
            revision = check.get(ScoreRevision, work.revision_id)
            assert check.get(Score, work.score_id).head_revision_id == revision.id
            source = check.scalar(
                select(ScoreRevisionSource).where(ScoreRevisionSource.revision_id == revision.id)
            )
            assert source is not None and storage.exists(source.stored_object.object_key)
            assert (
                check.scalar(
                    select(RenderOutbox).where(RenderOutbox.outbox_uuid == work.render_outbox_uuid)
                )
                is not None
            )
            assert (
                check.scalar(
                    select(PlaybackOutbox).where(
                        PlaybackOutbox.outbox_uuid == work.playback_outbox_uuid
                    )
                )
                is not None
            )
        observed.append(work)
        dispatch.dispatch_revision_derivatives_best_effort(work)

    async def after_commit(work):
        relay_after_commit(work)

    monkeypatch.setattr(
        revision_derivative_service, "dispatch_after_commit_sync", relay_after_commit
    )
    monkeypatch.setattr(revision_derivative_service, "dispatch_after_commit", after_commit)
    async_db = AsyncSessionAdapter(db)
    if operation == "save":
        await RevisionService(storage=storage).create(
            async_db,
            score.score_uuid,
            1,
            RevisionCreateRequest(
                content=MUSICXML_2.replace("<step>C</step>", "<step>F</step>"),
                expected_head_revision_id=rows[2].revision_uuid,
            ),
        )
    elif operation == "restore":
        await RevisionService(storage=storage).restore(
            async_db, score.score_uuid, rows[0].revision_uuid, 1
        )
    elif operation == "confirm":
        db.add(
            ImportJob(
                id=850,
                job_uuid="confirm-demand",
                user_id=1,
                state=ImportJobState.PENDING_REVIEW,
                requested_options={"title": "Confirmed"},
            )
        )
        db.commit()
        db.add(ImportDispatch(job_id=850, status=ImportDispatchStatus.COMPLETED))
        db.commit()
        await ReviewService(storage=storage).confirm(
            async_db, "confirm-demand", 1, ReviewConfirmRequest(content=MUSICXML_2)
        )
    elif operation == "confirm_sync":
        db.add(
            ImportJob(
                id=851,
                job_uuid="confirm-sync-demand",
                user_id=1,
                state=ImportJobState.PENDING_REVIEW,
            )
        )
        db.commit()
        path = tmp_path / "canonical.musicxml"
        path.write_text(MUSICXML_2)
        SyncConfirmedScoreCreationService(storage=storage).create_confirmed_from_job(
            db, "confirm-sync-demand", str(path)
        )
    assert len(observed) == 1 and len(calls) == 2
    work = observed[0]
    render = db.scalar(
        select(RenderOutbox).where(RenderOutbox.outbox_uuid == work.render_outbox_uuid)
    )
    audio = db.scalar(
        select(PlaybackOutbox).where(PlaybackOutbox.outbox_uuid == work.playback_outbox_uuid)
    )
    assert (
        render.status.value == audio.status.value == ("PENDING" if broker_fails else "DISPATCHED")
    )
    if broker_fails:
        from app.worker.execution import maintenance_dispatch

        monkeypatch.setattr(maintenance_dispatch, "get_worker_db", database)
        monkeypatch.setattr(maintenance_dispatch, "run_scheduler_scan", lambda _name, scan: scan())
        monkeypatch.setattr(producer.celery_app, "send_task", lambda *_a, **_k: None)
        assert maintenance_dispatch.execute_render_outbox_maintenance()["dispatched"] >= 1
        assert maintenance_dispatch.execute_playback_outbox_maintenance()["dispatched"] >= 1
        db.refresh(render)
        db.refresh(audio)
        assert render.status.value == audio.status.value == "DISPATCHED"


@pytest.mark.asyncio
async def test_dispatcher_crash_does_not_escape_post_commit_boundary(monkeypatch):
    from app.modules.revisions.derivatives import RevisionDerivativeOutboxes

    monkeypatch.setattr(
        dispatch,
        "dispatch_revision_derivatives_best_effort",
        Mock(side_effect=RuntimeError("dispatcher crashed")),
    )
    await RevisionDerivativeService().dispatch_after_commit(
        RevisionDerivativeOutboxes(1, 2, "render", "audio")
    )


@pytest.mark.parametrize("status", [RenderOutboxStatus.SUPERSEDED, PlaybackOutboxStatus.SUPERSEDED])
def test_internal_superseded_state_has_safe_presentation_status(status):
    assert derived_asset_status(has_current_asset=False, outbox_status=status) == "pending"
    assert derived_asset_status(has_current_asset=True, outbox_status=status) == "ready"


@pytest.mark.asyncio
async def test_preview_toggle_only_changes_access_state(revisions, monkeypatch):
    from unittest.mock import AsyncMock

    db, storage, score, rows = revisions
    assert render_outbox_service.claim(db, "render-1") is None
    assert playback_outbox_service.claim(db, "audio-1") is None
    db.commit()
    snapshot = [
        (type(work), work.outbox_uuid, work.status, work.attempt_count)
        for n in (1, 2, 3)
        for work in work_rows(db, n)
    ]
    enqueue = AsyncMock(side_effect=AssertionError("Toggle must not enqueue work"))
    relay = AsyncMock(side_effect=AssertionError("Toggle must not dispatch work"))
    monkeypatch.setattr(revision_derivative_service, "enqueue", enqueue)
    monkeypatch.setattr(revision_derivative_service, "dispatch_after_commit", relay)
    service = GuestPreviewService(storage=storage)
    for enabled in [True, False]:
        await service.update_settings(
            AsyncSessionAdapter(db), score.score_uuid, 1, GuestPreviewUpdateRequest(enabled=enabled)
        )
        assert db.scalar(select(func.count()).select_from(RenderOutbox)) == 3
        assert db.scalar(select(func.count()).select_from(PlaybackOutbox)) == 3
        for model, identity, status, attempt in snapshot:
            work = db.scalar(select(model).where(model.outbox_uuid == identity))
            assert work.status == status and work.attempt_count == attempt
    enqueue.assert_not_awaited()
    relay.assert_not_awaited()
