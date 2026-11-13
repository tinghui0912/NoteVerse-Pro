"""Real PostgreSQL head-writer / final-admission serialization for both derivatives."""

from app.utils.timezone import utc_now_naive

from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from hashlib import sha256
from threading import Event
from unittest.mock import Mock
import pytest
import sqlalchemy as sa
from alembic import command
from sqlalchemy.orm import Session
from app.db.models import (
    StoredObject,
    User,
    Score,
    ScoreRevision,
    ScoreRevisionSource,
    RenderOutbox,
    RenderOutboxStatus,
    RenderTargetType,
    PlaybackOutbox,
    PlaybackOutboxStatus,
    ScoreRenderAsset,
    ScorePlaybackAsset,
    ObjectWriteIntent,
    StorageUsageCounter,
)
from app.db.models.score import RevisionOrigin, RevisionSourceFormat
from app.modules.score_assets import render_service
from app.modules.playback import service as playback_service
from app.processing.engines.playback.renderer import RenderedAudio
from app.worker.execution import render_outbox, playback_outbox
from tests.support.object_storage import InMemoryObjectStorage
from tests.support.postgres_schema import postgres_schema_database
from tests.support.write_cleanup import drain_write_cleanup
from tests.test_score_revision_services import MUSICXML_2


@pytest.mark.parametrize("kind", ["render", "audio"])
@pytest.mark.parametrize("change", ["head", "deleted"])
def test_final_admission_serializes_with_current_score(monkeypatch, tmp_path, kind, change):
    with postgres_schema_database(monkeypatch) as (engine, config):
        command.upgrade(config, "head")
        enums = {item["name"]: item["labels"] for item in sa.inspect(engine).get_enums()}
        assert enums["renderoutboxstatus"] == [status.value for status in RenderOutboxStatus]
        assert enums["playbackoutboxstatus"] == [status.value for status in PlaybackOutboxStatus]
        for model in (RenderOutbox, PlaybackOutbox):
            assert {
                column["name"] for column in sa.inspect(engine).get_columns(model.__tablename__)
            } == set(model.__table__.columns.keys())
        storage = InMemoryObjectStorage()
        fingerprint = sha256(MUSICXML_2.encode()).hexdigest()
        with Session(engine) as seed:
            user = User(email="demand-race@example.com", display_name="Owner", password_hash="hash")
            seed.add(user)
            seed.flush()
            user_id = user.id
            score = Score(
                score_uuid="race-score",
                title="Race",
                owner_user_id=user_id,
                guest_preview_enabled=True,
            )
            seed.add(score)
            seed.flush()
            score_id = score.id
            rows = [
                ScoreRevision(
                    revision_uuid=f"race-r{n}",
                    score_id=score_id,
                    revision_number=n,
                    content_hash=fingerprint,
                    origin=RevisionOrigin.EDIT,
                )
                for n in (1, 2)
            ]
            seed.add_all(rows)
            seed.flush()
            r1, r2 = (row.id for row in rows)
            score.head_revision_id = r1
            stored = storage.put_bytes(
                key="race/score.musicxml",
                content=MUSICXML_2.encode(),
                content_type="application/vnd.recordare.musicxml+xml",
            )
            seed.add(
                ScoreRevisionSource(
                    source_uuid="race-source",
                    revision_id=r1,
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
            render_work = RenderOutbox(
                outbox_uuid="race-render",
                target_type=RenderTargetType.SCORE_REVISION,
                score_id=score_id,
                revision_id=r1,
                requested_by_user_id=user_id,
                source_fingerprint=fingerprint,
            )
            audio_work = PlaybackOutbox(
                outbox_uuid="race-audio",
                score_id=score_id,
                revision_id=r1,
                source_fingerprint=fingerprint,
            )
            seed.add(render_work if kind == "render" else audio_work)
            seed.commit()
        physical_written, admit = Event(), Event()
        worker = render_outbox if kind == "render" else playback_outbox
        service_module = render_service if kind == "render" else playback_service
        original_write = service_module.write_object

        def paused_write(*args, **kwargs):
            receipt = original_write(*args, **kwargs)
            physical_written.set()
            assert admit.wait(15)
            return receipt

        @contextmanager
        def database():
            with Session(engine) as db:
                try:
                    yield db
                    db.commit()
                except Exception:
                    db.rollback()
                    raise

        monkeypatch.setattr(service_module, "write_object", paused_write)
        monkeypatch.setattr(worker, "get_worker_db", database)
        publish = Mock()
        if kind == "render":
            svg = tmp_path / "page.svg"
            svg.write_bytes(b'<svg xmlns="http://www.w3.org/2000/svg"/>')
            renderer = Mock()
            renderer.render_score.return_value = {
                "success": True,
                "engine": "test",
                "files": [{"path": str(svg), "page": 1, "mime_type": "image/svg+xml"}],
            }
            monkeypatch.setattr(render_service, "create_score_render_engine", lambda **_: renderer)
            monkeypatch.setattr(
                worker,
                "RevisionRenderService",
                lambda: render_service.RevisionRenderService(storage=storage),
            )
            monkeypatch.setattr(worker, "_publish_revision_render_status", publish)
            execute = worker.execute_render_outbox_task
            model = RenderOutbox
            asset_model = ScoreRenderAsset
        else:
            renderer = Mock()
            renderer.render.return_value = RenderedAudio(
                content=b"RIFF....WAVE",
                mime_type="audio/wav",
                extension=".wav",
                duration_ms=1000,
                generator="test",
                generator_version="1",
                soundfont_sha256="a" * 64,
            )
            monkeypatch.setattr(
                worker,
                "PlaybackGenerationService",
                lambda: playback_service.PlaybackGenerationService(
                    storage=storage, renderer=renderer
                ),
            )
            monkeypatch.setattr(worker, "_publish_playback_status", publish)
            execute = worker.execute_playback_outbox_task
            model = PlaybackOutbox
            asset_model = ScorePlaybackAsset
        with ThreadPoolExecutor(max_workers=1) as executor:
            future = executor.submit(execute, None, f"race-{kind}")
            try:
                assert physical_written.wait(15)
                with Session(engine) as editor:
                    score = editor.scalar(
                        sa.select(Score).where(Score.id == score_id).with_for_update()
                    )
                    assert (
                        editor.scalar(sa.select(model.status))
                        == model.__table__.c.status.type.enum_class.PROCESSING
                    )
                    if change == "head":
                        score.head_revision_id = r2
                    else:
                        score.deleted_at = utc_now_naive()
                    editor.commit()
            finally:
                admit.set()
            result = future.result(15)
        assert result["status"] == ("superseded" if change == "head" else "failed")
        if change == "head":
            publish.assert_not_called()
        else:
            assert publish.call_args.args[-1] == "failed"
        with Session(engine) as check:
            work = check.scalar(sa.select(model))
            assert work.status.value == ("SUPERSEDED" if change == "head" else "FAILED")
            assert work.attempt_count == 1 and work.completed_at is None
            assert check.scalar(sa.select(asset_model)) is None
            assert check.scalar(sa.select(StorageUsageCounter)) is None
            intents = list(check.scalars(sa.select(ObjectWriteIntent)))
            assert len(intents) == 1 and intents[0].status == "WRITTEN"
            abandoned_key = intents[0].object_key
            assert storage.exists(abandoned_key)
            assert (
                check.scalar(
                    sa.select(StoredObject).where(StoredObject.object_key == abandoned_key)
                )
                is None
            )
            if change == "head":
                assert execute(None, f"race-{kind}")["status"] == "ignored"
                delivery = (
                    worker.render_outbox_service
                    if kind == "render"
                    else worker.playback_outbox_service
                )
                delivery.complete(check, f"race-{kind}")
                check.commit()
                check.refresh(work)
                assert work.status.value == "SUPERSEDED" and work.completed_at is None
            assert all(item["status"] == "cleaned" for item in drain_write_cleanup(check, storage))
            assert not storage.exists(abandoned_key)
            assert check.get(ScoreRevision, r1) is not None
            assert check.get(ScoreRevision, r2) is not None
