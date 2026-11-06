"""Fresh schema and deterministic Preview/head/claim ordering on real PostgreSQL."""

import asyncio
from concurrent.futures import ThreadPoolExecutor
from hashlib import sha256
from threading import Event, current_thread

import pytest
import sqlalchemy as sa
from alembic import command
from sqlalchemy.orm import Session
from app.db.models import (
    User,
    Score,
    ScoreRevision,
    ScoreRevisionSource,
    ScoreGuestPreviewGrant,
    RenderOutbox,
    RenderOutboxStatus,
    RenderTargetType,
    PlaybackOutbox,
    PlaybackOutboxStatus,
)
from app.db.models.score import RevisionOrigin, RevisionSourceFormat
from app.modules.guest_previews.service import GuestPreviewService
from app.modules.guest_previews.schemas import GuestPreviewCreateRequest
from app.modules.score_access.policy import ScoreAccessPolicy
from app.modules.score_assets.render_outbox_service import render_outbox_service
from app.modules.playback.outbox_service import playback_outbox_service
from tests.support.object_storage import InMemoryObjectStorage
from tests.test_practice_bundle_migration import migration_database
from tests.test_score_revision_services import AsyncSessionAdapter, MUSICXML_2


@pytest.mark.parametrize("order", ["worker_first", "preview_first"])
def test_preview_head_race_preserves_durable_demand(monkeypatch, tmp_path, order):
    with migration_database(monkeypatch) as (engine, config):
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
            score = Score(score_uuid="race-score", title="Race", owner_user_id=user_id)
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

                    storage_key=stored.object_key,
                    filename=stored.object_key.rsplit("/", 1)[-1],
                    mime_type="application/vnd.recordare.musicxml+xml",
                    sha256=fingerprint,
                    generator="test",
                    generator_version="1",
                )
            )
            seed.add(
                RenderOutbox(
                    outbox_uuid="race-render",
                    target_type=RenderTargetType.SCORE_REVISION,
                    score_id=score_id,
                    revision_id=r1,
                    requested_by_user_id=user_id,
                    source_fingerprint=fingerprint,
                )
            )
            seed.add(
                PlaybackOutbox(
                    outbox_uuid="race-audio",
                    score_id=score_id,
                    revision_id=r1,
                    source_fingerprint=fingerprint,
                )
            )
            seed.commit()
        resolved, proceed, prepared, commit_allowed, worker_at_lock = (Event() for _ in range(5))

        class ResolvingPolicy(ScoreAccessPolicy):
            async def authorize(self, *args, **kwargs):
                access = await super().authorize(*args, **kwargs)
                resolved.set()
                assert await asyncio.to_thread(proceed.wait, 10)
                return access

        class PreviewDB(AsyncSessionAdapter):
            async def commit(self):
                if order == "preview_first":
                    prepared.set()
                    assert await asyncio.to_thread(commit_allowed.wait, 10)
                await super().commit()

        def create_preview():
            with Session(engine) as db:
                return asyncio.run(
                    GuestPreviewService(storage=storage, access_policy=ResolvingPolicy()).create(
                        PreviewDB(db), "race-score", user_id, GuestPreviewCreateRequest()
                    )
                )

        def claim():
            with Session(engine) as db:
                rendered = render_outbox_service.claim(db, "race-render")
                audio = playback_outbox_service.claim(db, "race-audio")
                db.commit()
                return rendered is not None, audio is not None

        def before_execute(_connection, _cursor, statement, _parameters, _context, _many):
            if (
                "claim-worker" in current_thread().name
                and "FROM scores" in statement
                and "FOR UPDATE" in statement
            ):
                worker_at_lock.set()

        sa.event.listen(engine, "before_cursor_execute", before_execute)
        try:
            with (
                ThreadPoolExecutor(max_workers=1, thread_name_prefix="preview-command") as previews,
                ThreadPoolExecutor(max_workers=1, thread_name_prefix="claim-worker") as workers,
            ):
                future = previews.submit(create_preview)
                assert resolved.wait(10)
                with Session(engine) as editor:
                    editor.execute(
                        sa.update(Score).where(Score.id == score_id).values(head_revision_id=r2)
                    )
                    editor.commit()
                if order == "worker_first":
                    assert workers.submit(claim).result(10) == (False, False)
                    with Session(engine) as check:
                        assert (
                            check.scalar(sa.select(RenderOutbox.status))
                            == RenderOutboxStatus.SUPERSEDED
                        )
                        assert (
                            check.scalar(sa.select(PlaybackOutbox.status))
                            == PlaybackOutboxStatus.SUPERSEDED
                        )
                    proceed.set()
                    future.result(10)
                    with Session(engine) as check:
                        assert (
                            check.scalar(sa.select(RenderOutbox.status))
                            == RenderOutboxStatus.PENDING
                        )
                        assert (
                            check.scalar(sa.select(PlaybackOutbox.status))
                            == PlaybackOutboxStatus.PENDING
                        )
                    assert workers.submit(claim).result(10) == (True, True)
                else:
                    proceed.set()
                    assert prepared.wait(10)
                    worker = workers.submit(claim)
                    assert worker_at_lock.wait(10)
                    commit_allowed.set()
                    future.result(10)
                    assert worker.result(10) == (True, True)
                with Session(engine) as check:
                    assert check.scalar(sa.select(ScoreGuestPreviewGrant.revision_id)) == r1
                    assert (
                        check.scalar(sa.select(RenderOutbox.status))
                        == RenderOutboxStatus.PROCESSING
                    )
                    assert (
                        check.scalar(sa.select(PlaybackOutbox.status))
                        == PlaybackOutboxStatus.PROCESSING
                    )
        finally:
            proceed.set()
            commit_allowed.set()
            sa.event.remove(engine, "before_cursor_execute", before_execute)
