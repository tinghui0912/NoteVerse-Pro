"""Durable presentation demand, post-commit relaying, and generation admission."""

from tests.support.runtime_resources import resources_for

from app.composition import storage_resources as _resource_wiring

from app.modules.import_jobs.requested_options import encode_requested_options

from app.shared.time import utc_now

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
    ScoreRevisionRenderOutbox,
    PlaybackOutbox,
    RevisionMetadataOutbox,
    ImportJob,
    ImportDispatch,
    ImportDispatchStatus,
)
from app.modules.revisions.render_states import ScoreRevisionRenderStatus
from app.modules.playback.domain import PlaybackOutboxStatus
from app.modules.import_jobs.domain import ImportJobState
from app.modules.revisions.domain import RevisionOrigin
from app.modules.revisions.domain import RevisionSourceFormat
from app.runtime.worker.context import get_context as get_worker_context
from app.modules.revisions.post_commit import RevisionPostCommitCoordinator
from app.modules.revisions.schemas import RevisionRestoreRequest
from app.modules.revisions.service import RevisionService
from app.modules.revisions.schemas import RevisionCreateRequest
from app.modules.import_jobs.review.service import ImportReviewService
from app.modules.import_jobs.review.schemas import ReviewConfirmRequest
from app.modules.guest_previews.service import GuestPreviewService
from app.modules.score_assets.derived_assets import derived_asset_status
from tests.test_score_revision_services import score_service_session as score_service_session
from tests.test_score_revision_services import MUSICXML_2
from tests.support.runtime_resources import deliveries
from tests.support.worker_context import inject_worker

dispatch = get_worker_context().dispatches.playback
render_dispatch = get_worker_context().dispatches.render
metadata_dispatch = get_worker_context().dispatches.metadata

revision_post_commit = resources_for().post_commit


@pytest.fixture
def revisions(score_service_session):
    db, storage = score_service_session
    score = Score(id=800, score_uuid="demand-score", display_title="Demand", owner_user_id=1)
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
            ScoreRevisionRenderOutbox(
                outbox_uuid=f"render-{number}",
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
        db.scalar(
            select(ScoreRevisionRenderOutbox).where(
                ScoreRevisionRenderOutbox.outbox_uuid == f"render-{number}"
            )
        ),
        db.scalar(select(PlaybackOutbox).where(PlaybackOutbox.outbox_uuid == f"audio-{number}")),
    )


@pytest.mark.parametrize("enabled", [False, True])
def test_historical_revisions_are_not_generation_demand_and_never_runs_generators(
    revisions, monkeypatch, enabled
):
    db, storage, score, rows = revisions
    if enabled:
        GuestPreviewService(
            delivery=resources_for(storage).build_media_delivery_service()
        ).issue_credential(db, score.score_uuid, 1)
    from app.worker.execution import score_revision_render_outbox, playback_outbox

    @contextmanager
    def database():
        yield db
        db.commit()

    inject_worker(monkeypatch, score_revision_render_outbox, sessions=database)
    inject_worker(monkeypatch, playback_outbox, sessions=database)
    render = Mock(side_effect=AssertionError("Unexpected historical render"))
    audio = Mock(side_effect=AssertionError("Unexpected historical audio"))
    monkeypatch.setattr(score_revision_render_outbox, "_render_revision", render)
    monkeypatch.setattr(
        playback_outbox.get_context().resources,
        "build_playback_generation_service",
        lambda *_: Mock(render_for_worker=audio),
    )
    for number in (1, 2):
        for work in work_rows(db, number):
            work.attempt_count = 2
            work.failure_detail = "an earlier retry"
            work.failure_code = "render_execution_failed"
            work.failure_stage = "render"
            work.failure_classification = "system_error"
            work.failure_retryable = True
        db.commit()
        assert (
            score_revision_render_outbox.execute_score_revision_render_task(
                None, f"render-{number}"
            )["status"]
            == "ignored"
        )
        assert (
            playback_outbox.execute_playback_outbox_task(None, f"audio-{number}")["status"]
            == "ignored"
        )
        for work in work_rows(db, number):
            assert work.status.value == "SUPERSEDED" and work.attempt_count == 2
            assert (
                work.failure_detail
                is work.failure_code
                is work.dispatched_at
                is work.started_at
                is None
            )
    render.assert_not_called()
    audio.assert_not_called()
    assert deliveries().render.claim(db, "render-3") is not None
    assert deliveries().playback.claim(db, "audio-3") is not None
    assert len(db.scalars(select(ScoreRevisionSource)).all()) == 3
    assert all(
        storage.exists(source.stored_object.object_key)
        for source in db.scalars(select(ScoreRevisionSource))
    )


def test_processing_is_not_cancelled_and_missing_source_is_not_superseded(revisions):
    db, _, score, rows = revisions
    render, audio = work_rows(db, 1)
    render.status = ScoreRevisionRenderStatus.PROCESSING
    audio.status = PlaybackOutboxStatus.PROCESSING
    render.attempt_token = audio.attempt_token = "fixture-token"
    db.commit()
    assert deliveries().render.claim(db, "render-1") is None
    assert deliveries().playback.claim(db, "audio-1") is None
    assert render.status.value == audio.status.value == "PROCESSING"
    source = db.scalar(
        select(ScoreRevisionSource).where(ScoreRevisionSource.revision_id == rows[1].id)
    )
    db.delete(source)
    db.commit()
    assert deliveries().render.claim(db, "render-2") is None
    assert deliveries().playback.claim(db, "audio-2") is None
    assert all(work.status.value == "FAILED" and work.failure_detail for work in work_rows(db, 2))
    score.deleted_at = utc_now()
    db.commit()
    assert deliveries().render.claim(db, "render-3") is None
    assert deliveries().playback.claim(db, "audio-3") is None
    assert all(work.status.value == "FAILED" for work in work_rows(db, 3))


@pytest.mark.parametrize("operation", ["save", "restore", "confirm"])
@pytest.mark.parametrize("broker_fails", [False, True])
def test_business_commit_precedes_immediate_dispatch_and_broker_failure_is_recoverable(
    revisions, monkeypatch, operation, broker_fails, tmp_path
):
    db, storage, score, rows = revisions
    calls = []
    observed = []

    @contextmanager
    def database():
        yield db
        db.commit()

    monkeypatch.setattr(dispatch, "sessions", database)
    monkeypatch.setattr(render_dispatch, "sessions", database)
    monkeypatch.setattr(metadata_dispatch, "sessions", database)

    def broker(task_name, *, kwargs, task_id):
        model = (
            ScoreRevisionRenderOutbox
            if "render" in task_name
            else RevisionMetadataOutbox
            if "metadata" in task_name
            else PlaybackOutbox
        )
        with Session(db.get_bind()) as check:
            row = check.scalar(select(model).where(model.outbox_uuid == kwargs["outbox_uuid"]))
            assert row.status.value == "DISPATCHED"
        calls.append(task_name)
        if broker_fails:
            raise ConnectionError("broker unavailable")

    monkeypatch.setattr(dispatch.sender, "send_task", broker)

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
                    select(ScoreRevisionRenderOutbox).where(
                        ScoreRevisionRenderOutbox.outbox_uuid == work.render_outbox_uuid
                    )
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
        RevisionPostCommitCoordinator(
            render_dispatch.dispatch_score_revision_render,
            dispatch.dispatch_playback_outbox,
            metadata_dispatch.dispatch_revision_metadata,
        ).dispatch_best_effort(work)

    def after_commit(work):
        relay_after_commit(work)

    monkeypatch.setattr(revision_post_commit, "dispatch_best_effort", after_commit)
    if operation == "save":
        RevisionService(
            quota=_resource_wiring.storage_quota_service,
            revision_writer=resources_for().build_revision_writer(),
            writes=resources_for(storage).build_object_write_coordinator(),
            post_commit=revision_post_commit,
        ).create(
            db,
            score.score_uuid,
            1,
            RevisionCreateRequest(
                content=MUSICXML_2.replace("<step>C</step>", "<step>F</step>"),
                expected_head_revision_id=rows[2].revision_uuid,
            ),
        )
    elif operation == "restore":
        RevisionService(
            quota=_resource_wiring.storage_quota_service,
            revision_writer=resources_for().build_revision_writer(),
            writes=resources_for(storage).build_object_write_coordinator(),
            post_commit=revision_post_commit,
        ).restore(
            db,
            score.score_uuid,
            rows[0].revision_uuid,
            1,
            RevisionRestoreRequest(expected_head_revision_id=rows[-1].revision_uuid),
        )
    elif operation == "confirm":
        db.add(
            ImportJob(
                processing_started_at=utc_now(),
                processing_finished_at=utc_now(),
                id=850,
                job_uuid="confirm-demand",
                user_id=1,
                state=ImportJobState.READY_FOR_REVIEW,
                requested_options=encode_requested_options({"display_title": "Confirmed"}),
            )
        )
        db.commit()
        db.add(ImportDispatch(job_id=850, status=ImportDispatchStatus.COMPLETED))
        db.commit()
        ImportReviewService(
            quota=_resource_wiring.storage_quota_service,
            revision_writer=resources_for().build_revision_writer(),
            input_assets=resources_for().build_input_asset_lifecycle(),
            usage=_resource_wiring.storage_usage_service,
            writes=resources_for(storage).build_object_write_coordinator(),
            post_commit=revision_post_commit,
        ).confirm(db, "confirm-demand", 1, ReviewConfirmRequest(content=MUSICXML_2))
    assert len(observed) == 1 and len(calls) == 3
    work = observed[0]
    render = db.scalar(
        select(ScoreRevisionRenderOutbox).where(
            ScoreRevisionRenderOutbox.outbox_uuid == work.render_outbox_uuid
        )
    )
    audio = db.scalar(
        select(PlaybackOutbox).where(PlaybackOutbox.outbox_uuid == work.playback_outbox_uuid)
    )
    assert (
        render.status.value == audio.status.value == ("PENDING" if broker_fails else "DISPATCHED")
    )
    if broker_fails:
        from app.worker.execution import maintenance_dispatch

        inject_worker(monkeypatch, maintenance_dispatch, sessions=database)
        monkeypatch.setattr(maintenance_dispatch, "run_scheduler_scan", lambda _name, scan: scan())
        monkeypatch.setattr(dispatch.sender, "send_task", lambda *_a, **_k: None)
        assert maintenance_dispatch.execute_score_revision_render_maintenance()["dispatched"] >= 1
        assert maintenance_dispatch.execute_playback_outbox_maintenance()["dispatched"] >= 1
        from app.worker.execution import revision_metadata as metadata_worker

        inject_worker(monkeypatch, metadata_worker, sessions=database)
        monkeypatch.setattr(metadata_worker, "run_scheduler_scan", lambda _name, scan: scan())
        assert metadata_worker.execute_revision_metadata_maintenance()["dispatched"] >= 1
        db.refresh(render)
        db.refresh(audio)
        assert render.status.value == audio.status.value == "DISPATCHED"


@pytest.mark.parametrize(
    "status", [ScoreRevisionRenderStatus.SUPERSEDED, PlaybackOutboxStatus.SUPERSEDED]
)
def test_internal_superseded_state_has_safe_presentation_status(status):
    assert derived_asset_status(has_current_asset=False, outbox_status=status) == "pending"
    assert derived_asset_status(has_current_asset=True, outbox_status=status) == "ready"


def test_preview_toggle_only_changes_access_state(revisions, monkeypatch):
    from unittest.mock import Mock

    db, storage, score, rows = revisions
    assert deliveries().render.claim(db, "render-1") is None
    assert deliveries().playback.claim(db, "audio-1") is None
    db.commit()
    snapshot = [
        (type(work), work.outbox_uuid, work.status, work.attempt_count)
        for n in (1, 2, 3)
        for work in work_rows(db, n)
    ]
    relay = Mock(side_effect=AssertionError("Toggle must not dispatch work"))
    monkeypatch.setattr(revision_post_commit, "dispatch_best_effort", relay)
    service = GuestPreviewService(delivery=resources_for(storage).build_media_delivery_service())
    for enabled in [True, False]:
        if enabled:
            service.issue_credential(db, score.score_uuid, 1)
        else:
            service.revoke_credential(db, score.score_uuid, 1)
        assert db.scalar(select(func.count()).select_from(ScoreRevisionRenderOutbox)) == 3
        assert db.scalar(select(func.count()).select_from(PlaybackOutbox)) == 3
        for model, identity, status, attempt in snapshot:
            work = db.scalar(select(model).where(model.outbox_uuid == identity))
            assert work.status == status and work.attempt_count == attempt
    relay.assert_not_called()
