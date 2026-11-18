"""Committed revision work is an immutable hint, never durable execution authority."""

from dataclasses import fields, MISSING, FrozenInstanceError
from unittest.mock import Mock

import pytest
import sqlalchemy as sa
from sqlalchemy.orm import Session
from sqlmodel import SQLModel

from app.db.models import (
    Score,
    ScoreRevisionSource,
    ScoreRevisionMetadata,
    ScoreRevisionRenderOutbox,
    PlaybackOutbox,
    RevisionMetadataOutbox,
    ImportJob,
)
from app.db.models.import_job import ImportJobState
from app.modules.revisions import post_commit, render_dispatch, metadata_dispatch
from app.modules.playback import dispatch as playback_dispatch
from app.modules.revisions.post_commit import RevisionPostCommitWork, RevisionPostCommitCoordinator
from app.modules.revisions.writer import revision_writer, RevisionWriteResult, InitialRevisionWrite
from app.modules.revisions.service import RevisionService
from app.modules.revisions.schemas import RevisionCreateRequest, RevisionRestoreRequest
from app.modules.import_jobs.review.service import ImportReviewService
from app.modules.import_jobs.review.schemas import ReviewConfirmRequest
from tests.test_revision_writer_postgres import database as database, prepare, initial, snapshot
from tests.test_score_revision_services import MUSICXML_1, MUSICXML_2
from tests.test_import_confirmation_postgres import confirmation as confirmation


def ticket():
    return RevisionPostCommitWork(11, 22, "render", "playback", "metadata")


def dispatchers(monkeypatch, failure):
    targets = [
        (render_dispatch, "dispatch_score_revision_render", "revision_render"),
        (playback_dispatch, "dispatch_playback_outbox", "playback"),
        (metadata_dispatch, "dispatch_revision_metadata", "revision_metadata"),
    ]
    mocks = []
    for module, name, kind in targets:
        mock = Mock(return_value=False)
        if failure in {kind, "all"}:
            mock.side_effect = RuntimeError("dispatcher unavailable")
        monkeypatch.setattr(module, name, mock)
        mocks.append(mock)
    return mocks


@pytest.mark.parametrize(
    "failure", [None, "revision_render", "playback", "revision_metadata", "all"]
)
def test_each_domain_dispatch_is_attempted_once_and_failure_context_is_exact(monkeypatch, failure):
    mocks = dispatchers(monkeypatch, failure)
    log = Mock()
    monkeypatch.setattr(post_commit, "logger", log)
    RevisionPostCommitCoordinator().dispatch_best_effort(ticket())
    for mock, identity in zip(mocks, ["render", "playback", "metadata"], strict=True):
        mock.assert_called_once_with(identity)
    kinds = {"revision_render": "render", "playback": "playback", "revision_metadata": "metadata"}
    expected = kinds if failure == "all" else ({failure: kinds[failure]} if failure else {})
    assert [call.kwargs for call in log.bind.call_args_list] == [
        {
            "event": "revision_post_commit.fast_dispatch_failed",
            "score_id": 11,
            "revision_id": 22,
            "outbox_id": identity,
            "operation_kind": kind,
            "exception_type": "RuntimeError",
        }
        for kind, identity in expected.items()
    ]


def test_post_commit_ticket_is_a_required_immutable_nonpersistent_value():
    assert [field.name for field in fields(RevisionPostCommitWork)] == [
        "score_id",
        "revision_id",
        "render_outbox_uuid",
        "playback_outbox_uuid",
        "metadata_outbox_uuid",
    ]
    assert all(field.default is MISSING for field in fields(RevisionPostCommitWork))
    assert [field.name for field in fields(RevisionWriteResult)] == ["revision", "post_commit_work"]
    assert not issubclass(RevisionPostCommitWork, SQLModel)
    with pytest.raises(FrozenInstanceError):
        ticket().revision_id = 99


def test_ticket_matches_all_durable_admissions_and_outer_rollback_is_atomic(database):
    engine, storage = database
    source = prepare(engine, storage)
    with Session(engine) as db:
        before = snapshot(db)
        result = revision_writer.write(db, InitialRevisionWrite("score", 1, source, 1, "initial"))
        work = result.post_commit_work
        assert work is not None
        assert work.score_id == result.revision.score_id
        assert work.revision_id == result.revision.id
        for model, uuid in (
            (ScoreRevisionRenderOutbox, work.render_outbox_uuid),
            (PlaybackOutbox, work.playback_outbox_uuid),
            (RevisionMetadataOutbox, work.metadata_outbox_uuid),
        ):
            row = db.scalar(sa.select(model).where(model.outbox_uuid == uuid))
            assert row is not None and row.revision_id == work.revision_id
        assert db.get(ScoreRevisionMetadata, work.revision_id) is not None
        assert (
            db.scalar(
                sa.select(ScoreRevisionSource).where(
                    ScoreRevisionSource.revision_id == work.revision_id
                )
            )
            is not None
        )
        db.rollback()
        assert snapshot(db) == before


def test_idempotent_replay_has_no_ticket_or_additional_work(database):
    engine, storage = database
    original = initial(database)
    source = prepare(engine, storage, MUSICXML_2)
    with Session(engine) as db:
        result = revision_writer.write(db, InitialRevisionWrite("score", 1, source, 1, "initial"))
        assert result.post_commit_work is None
        assert result.revision.revision_uuid == original
        db.commit()
        for model in (ScoreRevisionRenderOutbox, PlaybackOutbox, RevisionMetadataOutbox):
            assert db.scalar(sa.select(sa.func.count()).select_from(model)) == 1


@pytest.mark.parametrize("operation", ["create", "restore", "confirm"])
@pytest.mark.parametrize(
    "failure", ["revision_render", "playback", "revision_metadata", "all", "coordinator"]
)
def test_committed_business_success_survives_dispatch_and_coordinator_errors(
    database, monkeypatch, operation, failure
):
    engine, storage = database
    head = initial(database) if operation != "confirm" else None
    if operation == "restore":
        with Session(engine) as db:
            current = (
                RevisionService(storage=storage)
                .create(
                    db,
                    "score",
                    1,
                    RevisionCreateRequest(content=MUSICXML_2, expected_head_revision_id=head),
                )
                .revision_id
            )
    mocks = dispatchers(monkeypatch, failure)
    seen = []
    real = RevisionPostCommitCoordinator()
    with Session(engine) as db:
        rollback = Mock(wraps=db.rollback)
        monkeypatch.setattr(db, "rollback", rollback)

        def after_commit(work):
            assert not db.in_transaction()
            with Session(engine) as observer:
                assert observer.get(Score, work.score_id).head_revision_id == work.revision_id
                for model, uuid in (
                    (ScoreRevisionRenderOutbox, work.render_outbox_uuid),
                    (PlaybackOutbox, work.playback_outbox_uuid),
                    (RevisionMetadataOutbox, work.metadata_outbox_uuid),
                ):
                    assert (
                        observer.scalar(sa.select(model).where(model.outbox_uuid == uuid))
                        is not None
                    )
                if operation == "confirm":
                    job = observer.scalar(sa.select(ImportJob))
                    assert job.state is ImportJobState.CONFIRMED
                    assert job.score_id == work.score_id
            seen.append(work)
            if failure == "coordinator":
                raise RuntimeError("unexpected coordinator bug")
            real.dispatch_best_effort(work)

        monkeypatch.setattr(post_commit.revision_post_commit, "dispatch_best_effort", after_commit)
        if operation == "confirm":
            response = ImportReviewService(storage=storage).confirm(
                db, "job", 1, ReviewConfirmRequest(content=MUSICXML_2)
            )
            assert response.score_id
        elif operation == "restore":
            response = RevisionService(storage=storage).restore(
                db, "score", head, 1, RevisionRestoreRequest(expected_head_revision_id=current)
            )
            assert response.revision_id
        else:
            response = RevisionService(storage=storage).create(
                db,
                "score",
                1,
                RevisionCreateRequest(content=MUSICXML_2, expected_head_revision_id=head),
            )
            assert response.revision_id
        rollback.assert_not_called()
        assert len(seen) == 1
        work = seen[0]
        from app.modules.revisions.render_delivery import revision_render_delivery
        from app.modules.playback.outbox_service import playback_outbox_service
        from app.modules.revisions.metadata_delivery import metadata_delivery

        assert work.render_outbox_uuid in revision_render_delivery.recover_and_list_due(db)
        assert work.playback_outbox_uuid in playback_outbox_service.recover_and_list_due(db)
        assert work.metadata_outbox_uuid in metadata_delivery.recover_and_list_due(db)
        for mock in mocks:
            assert mock.call_count == (0 if failure == "coordinator" else 1)


@pytest.mark.parametrize("kind", ["same_content", "idempotency"])
def test_revision_service_replay_does_not_fast_dispatch_existing_work(database, monkeypatch, kind):
    engine, storage = database
    head = initial(database)
    hint = Mock()
    monkeypatch.setattr(post_commit.revision_post_commit, "dispatch_best_effort", hint)
    with Session(engine) as db:
        service = RevisionService(storage=storage)
        if kind == "idempotency":
            request = RevisionCreateRequest(
                content=MUSICXML_2, expected_head_revision_id=head, idempotency_key="client-retry"
            )
            expected = service.create(db, "score", 1, request).revision_id
            hint.reset_mock()
        else:
            request = RevisionCreateRequest(
                content=MUSICXML_1.decode(), expected_head_revision_id=head
            )
            expected = head
        before = {
            model: db.scalar(sa.select(sa.func.count()).select_from(model))
            for model in (ScoreRevisionRenderOutbox, PlaybackOutbox, RevisionMetadataOutbox)
        }
        response = service.create(db, "score", 1, request)
        assert response.revision_id == expected
        hint.assert_not_called()
        assert all(
            db.scalar(sa.select(sa.func.count()).select_from(model)) == count
            for model, count in before.items()
        )


def test_confirm_dispatch_failure_preserves_committed_input_ownership_handoff(
    confirmation, monkeypatch
):
    from app.db.models import (
        ImportArtifact,
        ScoreInputAsset,
        StorageUsageCounter,
        StorageUsageCategory,
    )

    engine, storage = confirmation
    mocks = dispatchers(monkeypatch, "all")
    monkeypatch.setattr(
        post_commit.revision_post_commit,
        "dispatch_best_effort",
        RevisionPostCommitCoordinator().dispatch_best_effort,
    )
    with Session(engine) as db:
        response = ImportReviewService(storage=storage).confirm(
            db, "job", 1, ReviewConfirmRequest(content=MUSICXML_1.decode())
        )
    with Session(engine) as db:
        score = db.scalar(sa.select(Score).where(Score.score_uuid == response.score_id))
        job = db.scalar(sa.select(ImportJob))
        assert job.score_id == score.id and job.state is ImportJobState.CONFIRMED
        assert db.scalar(sa.select(ScoreInputAsset)).score_id == score.id
        assert db.scalar(sa.select(ImportArtifact)) is None
        counters = {
            row.category: row.used_bytes for row in db.scalars(sa.select(StorageUsageCounter))
        }
        assert counters[StorageUsageCategory.UPLOAD] == 0
        assert counters[StorageUsageCategory.INPUT_ASSET] == 8
        assert counters[StorageUsageCategory.TEMP_IMPORT] == 0
        for model in (ScoreRevisionRenderOutbox, PlaybackOutbox, RevisionMetadataOutbox):
            row = db.scalar(sa.select(model))
            assert row.revision_id == score.head_revision_id
            assert row.status.value == "PENDING"
        for mock in mocks:
            mock.assert_called_once()
