"""Physical prewrite may race; semantic adoption and completion have one fenced commit."""

from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from datetime import timedelta
from hashlib import sha256
from threading import Event
from unittest.mock import Mock

import pytest
import sqlalchemy as sa
from alembic import command
from sqlalchemy.orm import Session

from app.db.models import (
    ImportArtifact,
    ImportJob,
    ImportDispatch,
    ImportDispatchStatus,
    ObjectWriteIntent,
    Score,
    ScoreRevision,
    ScoreRevisionSource,
    ScoreRenderAsset,
    ScorePlaybackAsset,
    StoredObject,
    StoredObjectRetirement,
    StorageUsageCounter,
    StorageUsageEvent,
    RenderOutbox,
    RenderTargetType,
    PlaybackOutbox,
    User,
    RealtimeChange,
)
from app.db.models.import_job import ImportJobState
from app.db.models.score import RevisionOrigin, RevisionSourceFormat
from app.modules.import_jobs.artifact_kinds import ImportArtifactKind
from app.modules.score_assets import render_service
from app.modules.playback import service as playback_service
from app.modules.import_jobs.review import thumbnail_service
from app.modules.score_assets.render_outbox_service import (
    render_outbox_service,
    _delivery_lifecycle as render_lifecycle,
)
from app.modules.playback.outbox_service import (
    playback_outbox_service,
    _delivery_lifecycle as playback_lifecycle,
)
from app.processing.engines.playback.renderer import RenderedAudio
from app.utils.timezone import utc_now_naive
from app.worker.execution import render_outbox, playback_outbox
from tests.support.object_storage import InMemoryObjectStorage
from tests.support.postgres_schema import postgres_schema_database
from tests.support.write_cleanup import drain_write_cleanup
from tests.test_score_revision_services import MUSICXML_2


@pytest.fixture(params=["render", "playback", "thumbnail"])
def generation(request, monkeypatch, tmp_path):
    kind = request.param
    with postgres_schema_database(monkeypatch) as (engine, config):
        command.upgrade(config, "head")
        storage = InMemoryObjectStorage()
        content = MUSICXML_2.encode()
        fingerprint = sha256(content).hexdigest()
        storage.put_bytes(key="source", content=content, content_type="application/xml")
        with Session(engine) as db:
            user = User(email="adoption@example.test", password_hash="hash")
            db.add(user)
            db.flush()
            physical = StoredObject(
                object_key="source",
                byte_size=len(content),
                sha256=fingerprint,
                content_type="application/xml",
            )
            db.add(physical)
            db.flush()
            if kind == "thumbnail":
                job = ImportJob(
                    job_uuid="job", user_id=user.id, state=ImportJobState.PENDING_REVIEW
                )
                db.add(job)
                db.flush()
                db.add_all(
                    [
                        ImportDispatch(job_id=job.id, status=ImportDispatchStatus.COMPLETED),
                        ImportArtifact(
                            job_id=job.id,
                            artifact_uuid="source",
                            kind=ImportArtifactKind.REVIEW_MUSICXML.value,
                            stored_object_id=physical.id,
                            filename="score.musicxml",
                        ),
                        RenderOutbox(
                            outbox_uuid="delivery",
                            target_type=RenderTargetType.REVIEW_THUMBNAIL,
                            import_job_id=job.id,
                            source_fingerprint=fingerprint,
                        ),
                    ]
                )
            else:
                score = Score(score_uuid="score", title="Score", owner_user_id=user.id)
                db.add(score)
                db.flush()
                revision = ScoreRevision(
                    revision_uuid="revision",
                    score_id=score.id,
                    revision_number=1,
                    origin=RevisionOrigin.EDIT,
                    content_hash=fingerprint,
                )
                db.add(revision)
                db.flush()
                score.head_revision_id = revision.id
                db.add(
                    ScoreRevisionSource(
                        source_uuid="source",
                        revision_id=revision.id,
                        format=RevisionSourceFormat.MUSICXML,
                        stored_object_id=physical.id,
                        filename="score.musicxml",
                        generator="test",
                        generator_version="1",
                    )
                )
                fields = dict(
                    outbox_uuid="delivery",
                    score_id=score.id,
                    revision_id=revision.id,
                    source_fingerprint=fingerprint,
                    requested_by_user_id=user.id,
                )
                db.add(
                    RenderOutbox(target_type=RenderTargetType.SCORE_REVISION, **fields)
                    if kind == "render"
                    else PlaybackOutbox(**fields)
                )
            db.commit()

        @contextmanager
        def transaction():
            with Session(engine) as db:
                try:
                    yield db
                    db.commit()
                except Exception:
                    db.rollback()
                    raise

        svg = tmp_path / "page.svg"
        svg.write_bytes(b"<svg>generated</svg>")
        renderer = Mock()
        renderer.render_score.return_value = dict(
            success=True,
            engine="test",
            files=[
                dict(path=str(svg), page=1, mime_type="image/svg+xml"),
            ],
        )
        monkeypatch.setattr(render_service, "create_score_render_engine", lambda **_: renderer)
        monkeypatch.setattr(thumbnail_service, "create_score_render_engine", lambda **_: renderer)
        audio = Mock()
        audio.render.return_value = RenderedAudio(
            content=b"RIFFgenerated",
            mime_type="audio/wav",
            extension=".wav",
            duration_ms=100,
            generator="test",
            generator_version="1",
            soundfont_sha256="a" * 64,
        )
        render = render_service.RevisionRenderService(storage=storage)
        playback = playback_service.PlaybackGenerationService(storage=storage, renderer=audio)
        thumbnail = thumbnail_service.ImportReviewThumbnailService(storage=storage)
        monkeypatch.setattr(render_outbox, "RevisionRenderService", lambda: render)
        monkeypatch.setattr(playback_outbox, "PlaybackGenerationService", lambda: playback)
        monkeypatch.setattr(render_outbox, "import_review_thumbnail_service", thumbnail)
        worker = playback_outbox if kind == "playback" else render_outbox
        monkeypatch.setattr(worker, "SessionLocal", transaction)
        service = playback_outbox_service if kind == "playback" else render_outbox_service
        model = PlaybackOutbox if kind == "playback" else RenderOutbox
        module = {
            "render": render_service,
            "playback": playback_service,
            "thumbnail": thumbnail_service,
        }[kind]
        lifecycle = playback_lifecycle if kind == "playback" else render_lifecycle
        execute = (
            worker.execute_playback_outbox_task
            if kind == "playback"
            else worker.execute_render_outbox_task
        )

        def generate(db, payload):
            common = dict(outbox_uuid=payload.outbox_uuid, lease=payload.lease)
            if kind == "render":
                return render.render_for_worker(
                    db,
                    payload.score_uuid,
                    payload.revision_uuid,
                    source_fingerprint=payload.source_fingerprint,
                    profile=payload.render_profile,
                    **common,
                )
            if kind == "playback":
                return playback.render_for_worker(
                    db,
                    payload.score_uuid,
                    payload.revision_uuid,
                    source_fingerprint=payload.source_fingerprint,
                    asset_kind=payload.asset_kind,
                    **common,
                )
            return thumbnail.render(
                db,
                payload.job_uuid,
                expected_source_fingerprint=payload.source_fingerprint,
                profile=payload.render_profile,
                **common,
            )

        yield kind, engine, storage, service, model, module, lifecycle, execute, generate


def rows(db, model):
    return [
        dict(row)
        for row in db.execute(
            sa.select(model.__table__).order_by(*model.__table__.primary_key.columns)
        ).mappings()
    ]


def semantic_snapshot(db):
    return {
        model.__tablename__: rows(db, model)
        for model in (
            ScoreRenderAsset,
            ScorePlaybackAsset,
            ImportArtifact,
            StoredObject,
            StorageUsageCounter,
            StorageUsageEvent,
            StoredObjectRetirement,
            RealtimeChange,
        )
    }


@pytest.mark.parametrize("existing_asset", [False, True])
def test_mid_generation_takeover_cannot_adopt_or_replace(generation, monkeypatch, existing_asset):
    kind, engine, storage, service, model, module, lifecycle, execute, generate = generation
    if existing_asset:
        assert execute(None, "delivery")["status"] in ("rendered", "generated")
        with Session(engine) as db:
            lifecycle().rearm(db.scalars(sa.select(model)).one(), now=utc_now_naive())
            db.commit()
    with Session(engine) as db:
        before = semantic_snapshot(db)
    physical_written, admit = Event(), Event()
    original_write = module.write_object
    abandoned = []

    def paused_write(*args, **kwargs):
        receipt = original_write(*args, **kwargs)
        abandoned.append(receipt.object_key)
        physical_written.set()
        assert admit.wait(20)
        return receipt

    monkeypatch.setattr(module, "write_object", paused_write)
    with ThreadPoolExecutor(max_workers=1) as pool:
        old_worker = pool.submit(execute, None, "delivery")
        try:
            assert physical_written.wait(20), "Worker must finish physical prewrite before takeover"
            with Session(engine) as db:
                first = db.scalars(sa.select(model)).one()
                token_a = first.attempt_token
                assert first.status.value == "PROCESSING" and first.attempt_count == 1
                first.started_at = utc_now_naive() - timedelta(days=1)
                db.commit()
                assert service.recover_and_list_due(db) == ["delivery"]
                second = service.claim(db, "delivery")
                db.commit()
                assert second.lease.token != token_a and second.lease.attempt == 2
                current = rows(db, model)
        finally:
            admit.set()
        assert old_worker.result(timeout=20)["status"] == "stale"
    with Session(engine) as db:
        assert semantic_snapshot(db) == before
        assert rows(db, model) == current
        intent = db.scalars(
            sa.select(ObjectWriteIntent).where(ObjectWriteIntent.object_key == abandoned[0])
        ).one()
        assert intent.status == "WRITTEN" and storage.exists(abandoned[0])
        assert drain_write_cleanup(db, storage)[0]["status"] == "cleaned"
        assert not storage.exists(abandoned[0])
    monkeypatch.setattr(module, "write_object", original_write)
    with Session(engine) as db:
        generate(db, second)
        db.commit()
        row = db.scalars(sa.select(model)).one()
        assert row.status.value == "COMPLETED" and row.attempt_token is None
        assert semantic_snapshot(db) != before


def test_semantic_adoption_and_completion_roll_back_together(generation, monkeypatch):
    kind, engine, storage, service, model, module, lifecycle, execute, generate = generation
    with Session(engine) as db:
        payload = service.claim(db, "delivery")
        db.commit()
        before = semantic_snapshot(db)
        current = rows(db, model)
    complete = service.complete

    def fail_after_completion(db, uuid, *, lease):
        assert complete(db, uuid, lease=lease)
        if kind != "thumbnail":
            from app.modules.realtime.publisher import publish_score_change

            publish_score_change(
                db,
                score_id="score",
                revision_id="revision",
                kind="score.derived_assets.changed",
            )
            assert rows(db, RealtimeChange)
        db.flush()
        assert db.scalars(sa.select(model)).one().status.value == "COMPLETED"
        assert semantic_snapshot(db) != before
        raise RuntimeError("abort before final commit")

    monkeypatch.setattr(service, "complete", fail_after_completion)
    with Session(engine) as db:
        with pytest.raises(RuntimeError, match="before final commit"):
            generate(db, payload)
        db.rollback()
        assert semantic_snapshot(db) == before
        assert rows(db, model) == current
        intent = db.scalars(sa.select(ObjectWriteIntent)).one()
        assert intent.status == "WRITTEN"
        assert drain_write_cleanup(db, storage)[0]["status"] == "cleaned"


def test_final_admission_locks_aggregate_before_delivery_and_subordinates(generation, monkeypatch):
    kind, engine, storage, service, model, module, lifecycle, execute, generate = generation
    locks = []
    original_write = module.write_object

    def prewrite(*args, **kwargs):
        receipt = original_write(*args, **kwargs)
        locks.clear()  # Observe only the final admission transaction.
        return receipt

    def observe(connection, cursor, statement, parameters, context, executemany):
        if "FOR UPDATE" in statement:
            locks.append(statement.lower())

    monkeypatch.setattr(module, "write_object", prewrite)
    sa.event.listen(engine, "before_cursor_execute", observe)
    try:
        assert execute(None, "delivery")["status"] in ("rendered", "generated")
    finally:
        sa.event.remove(engine, "before_cursor_execute", observe)
    aggregate = "import_jobs" if kind == "thumbnail" else "scores"
    assert f"from {aggregate}" in locks[0]
    assert f"from {model.__tablename__}" in locks[1]
    assert any("object_write_intents" in statement for statement in locks[2:])


def test_execution_target_identity_is_checked_before_adoption(generation):
    kind, engine, storage, service, model, module, lifecycle, execute, generate = generation
    from app.modules.async_operations.durable_delivery import StaleDeliveryAttempt

    with Session(engine) as db:
        payload = service.claim(db, "delivery")
        db.commit()
        row = db.scalars(sa.select(model)).one()
        row.source_fingerprint = "c" * 64
        db.commit()
        before, delivery = semantic_snapshot(db), rows(db, model)
        with pytest.raises(StaleDeliveryAttempt):
            generate(db, payload)
        db.rollback()
        assert semantic_snapshot(db) == before and rows(db, model) == delivery
        assert drain_write_cleanup(db, storage)[0]["status"] == "cleaned"


def test_source_change_after_prewrite_is_domain_invalidation(generation, monkeypatch):
    kind, engine, storage, service, model, module, lifecycle, execute, generate = generation
    original_write = module.write_object
    with Session(engine) as db:
        before = semantic_snapshot(db)

    def change_source(*args, **kwargs):
        receipt = original_write(*args, **kwargs)
        with Session(engine) as editor:
            source = editor.scalars(
                sa.select(StoredObject).where(StoredObject.object_key == "source")
            ).one()
            source.sha256 = "c" * 64
            editor.commit()
        return receipt

    monkeypatch.setattr(module, "write_object", change_source)
    expected = "superseded" if kind == "thumbnail" else "failed"
    assert execute(None, "delivery")["status"] == expected
    with Session(engine) as db:
        after = semantic_snapshot(db)
        for model_name in (
            "score_render_assets",
            "score_playback_assets",
            "storage_usage_counters",
            "storage_usage_events",
            "stored_object_retirements",
            "import_artifacts",
        ):
            assert after[model_name] == before[model_name]
        if kind == "thumbnail":
            assert after["realtime_changes"] == before["realtime_changes"]
        else:
            changes = after["realtime_changes"]
            assert len(changes) == len(before["realtime_changes"]) + 1
            assert changes[-1]["kind"] == "score.derived_assets.changed"
            assert changes[-1]["score_id"] == "score" and changes[-1]["revision_id"] == "revision"
        assert db.scalars(sa.select(model)).one().status.value == expected.upper()
        assert drain_write_cleanup(db, storage)[0]["status"] == "cleaned"
