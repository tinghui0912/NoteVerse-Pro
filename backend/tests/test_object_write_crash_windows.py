"""Feature failures leave committed intent evidence, not best-effort orphan cleanup."""

from app.shared.time import utc_now

import hashlib
from tests.support.derivative_execution import revision_attempt
from contextlib import contextmanager
from unittest.mock import Mock

import pytest
from sqlalchemy import select

from app.db.models import (
    ScoreRevision,
    ImportJob,
    ImportDispatch,
    ImportDispatchStatus,
    ImportArtifact,
    ObjectWriteIntent,
    Score,
    ScoreRenderAsset,
    ScoreRevisionSource,
    StoredObject,
)
from app.db.models.import_job import ImportJobState
from app.db.models.score import RevisionSourceFormat
from app.modules.storage_objects.persistence import object_from_bytes
from app.modules.import_jobs.review.service import ImportReviewService
from app.modules.import_jobs.review.schemas import ReviewConfirmRequest
from app.modules.score_assets.score_revision_rendering import ScoreRevisionRenderService
from tests.support.write_cleanup import drain_write_cleanup
from tests.test_score_revision_services import (
    score_service_session as score_service_session,
    MUSICXML_1,
    add_active_score_with_head_revision,
)


def test_review_confirm_source_and_thumbnail_survive_failed_semantic_adoption_as_intents(
    score_service_session, monkeypatch
):
    db, storage = score_service_session
    job = ImportJob(
        processing_started_at=utc_now(),
        processing_finished_at=utc_now(),
        job_uuid="dual-write",
        user_id=1,
        state=ImportJobState.READY_FOR_REVIEW,
    )
    db.add(job)
    db.flush()
    db.add(ImportDispatch(job_id=job.id, status=ImportDispatchStatus.COMPLETED))
    key = "jobs/dual-write/thumbnail.svg"
    storage.put_bytes(key=key, content=b"<svg />", content_type="image/svg+xml")
    db.add(
        ImportArtifact(
            job_id=job.id,
            kind="review_preview_image",
            filename="thumbnail.svg",
            stored_object=object_from_bytes(
                object_key=key, content=b"<svg />", content_type="image/svg+xml"
            ),
        )
    )
    db.commit()
    service = ImportReviewService(storage=storage)
    monkeypatch.setattr(
        "app.modules.import_jobs.review.service.ImportJobDeletionService.cleanup_binary_artifacts",
        Mock(side_effect=RuntimeError("semantic confirmation failed")),
    )
    with pytest.raises(RuntimeError, match="semantic confirmation failed"):
        service.confirm(
            db,
            job.job_uuid,
            1,
            ReviewConfirmRequest(content=MUSICXML_1.decode()),
        )
    intents = list(db.scalars(select(ObjectWriteIntent)))
    assert len(intents) == 2 and all(row.status == "WRITTEN" for row in intents)
    keys = [row.object_key for row in intents]
    assert all(storage.exists(key) for key in keys)
    assert db.scalar(select(Score)) is None and db.scalar(select(ScoreRevisionSource)) is None
    assert len(list(db.scalars(select(StoredObject)))) == 1
    assert all(item["status"] == "cleaned" for item in drain_write_cleanup(db, storage))
    assert all(not storage.exists(key) for key in keys)
    assert storage.exists("jobs/dual-write/thumbnail.svg")


def test_render_partial_pages_remain_cleanup_owned(score_service_session, monkeypatch, tmp_path):
    db, storage = score_service_session
    score = add_active_score_with_head_revision(
        db,
        score_id=701,
        revision_id=702,
        score_uuid="partial",
        revision_uuid="partial-revision",
        title="Partial",
    )
    source_key = "scores/partial/source"
    storage.put_bytes(key=source_key, content=MUSICXML_1, content_type="application/xml")
    db.add(
        ScoreRevisionSource(
            source_uuid="partial-source",
            revision_id=702,
            format=RevisionSourceFormat.MUSICXML,
            filename="score.xml",
            generator="test",
            generator_version="1",
            stored_object=object_from_bytes(
                object_key=source_key, content=MUSICXML_1, content_type="application/xml"
            ),
        )
    )
    db.commit()
    files = []
    for page in range(1, 4):
        path = tmp_path / f"page{page}.svg"
        path.write_bytes(f"<svg>{page}</svg>".encode())
        files.append(dict(path=str(path), page=page, mime_type="image/svg+xml"))
    engine = Mock()
    engine.render_score.return_value = dict(success=True, files=files, engine="test")
    monkeypatch.setattr(
        "app.modules.rendering.renderer.create_score_render_engine", lambda **_: engine
    )
    put = storage.put_bytes

    def put_page(**kwargs):
        if kwargs["content"] == b"<svg>3</svg>":
            raise OSError("third page write failed")
        return put(**kwargs)

    monkeypatch.setattr(storage, "put_bytes", put_page)
    revision = db.get(ScoreRevision, 702)
    revision.content_hash = hashlib.sha256(MUSICXML_1).hexdigest()
    db.commit()
    payload = revision_attempt(db, "render", score, revision)
    with pytest.raises(OSError, match="third page"):
        ScoreRevisionRenderService(storage=storage).render_for_worker(
            db,
            score.score_uuid,
            "partial-revision",
            source_fingerprint=db.get(ScoreRevision, 702).content_hash,
            profile="default",
            outbox_uuid=payload.target.outbox_uuid,
            lease=payload.lease,
        )
    intents = list(db.scalars(select(ObjectWriteIntent)))
    assert len(intents) == 3 and sorted(row.status for row in intents) == [
        "PREPARED",
        "WRITTEN",
        "WRITTEN",
    ]
    assert db.scalar(select(ScoreRenderAsset)) is None
    assert len(list(db.scalars(select(StoredObject)))) == 1
    assert all(item["status"] == "cleaned" for item in drain_write_cleanup(db, storage))
    assert all(not storage.exists(row.object_key) for row in intents)


def test_import_artifact_handoff_failure_leaves_intent_until_cleanup(
    score_service_session, monkeypatch, tmp_path
):
    from app.modules.import_jobs.pipeline import artifact_recorder
    from app.modules.import_jobs.execution_recorder import import_execution_recorder

    db, storage = score_service_session
    from app.db.models import ImportJob
    from tests.support.import_execution import processing_lease

    job = ImportJob(job_uuid="artifact-handoff", user_id=1, state="QUEUED")
    db.add(job)
    db.commit()
    lease = processing_lease(db, job)

    @contextmanager
    def session():
        try:
            yield db
            db.commit()
        except Exception:
            db.rollback()
            raise

    monkeypatch.setattr(artifact_recorder, "SessionLocal", session)
    monkeypatch.setattr("app.db.session.SessionLocal", session)
    monkeypatch.setattr(artifact_recorder, "object_storage", storage)
    monkeypatch.setattr(
        import_execution_recorder,
        "replace_artifacts",
        Mock(side_effect=RuntimeError("artifact adoption failed")),
    )
    path = tmp_path / "review.musicxml"
    path.write_bytes(MUSICXML_1)
    with pytest.raises(RuntimeError, match="artifact adoption failed"):
        artifact_recorder.replace_files(lease, "review_musicxml", [str(path)])
    row = db.scalar(select(ObjectWriteIntent))
    assert row.status == "WRITTEN" and row.sha256 == hashlib.sha256(MUSICXML_1).hexdigest()
    assert db.scalar(select(ImportArtifact)) is None and db.scalar(select(StoredObject)) is None
    assert drain_write_cleanup(db, storage)[0]["status"] == "cleaned"
    assert not storage.exists(row.object_key)
