"""Database-authoritative Bundle lifecycle admission across independent transactions."""

from __future__ import annotations

import asyncio
import os
from pathlib import Path
from uuid import uuid4

import pytest
import pytest_asyncio
from sqlalchemy import MetaData, select, text, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.engine import make_url
from sqlmodel import SQLModel

import app.db.models  # noqa: F401 -- register the durable reference graph
from app.core.exceptions import ValidationException
from app.db.models.practice_bundle import PracticeBundleRecord
from app.db.models import User, Score, ScoreRevision
from app.modules.practice.bundle.compiler import PracticeBundleCompiler
from app.modules.practice.bundle.repository import PracticeBundleRepository
from tests.support.object_storage import InMemoryObjectStorage


@pytest_asyncio.fixture
async def postgres_bundle(tmp_path, request):
    url = os.environ.get("NOTEVERSE_TEST_PRACTICE_BUNDLE_POSTGRES_URL")
    if not url:
        pytest.skip(
            "Set NOTEVERSE_TEST_PRACTICE_BUNDLE_POSTGRES_URL to run real PostgreSQL Bundle races"
        )
    parsed = make_url(url)
    assert parsed.drivername == "postgresql+asyncpg"
    assert (parsed.database or "").startswith("noteverse_test_"), "Use a dedicated test database"
    schema = "practice_bundle_" + uuid4().hex
    admin = create_async_engine(url)
    async with admin.begin() as connection:
        await connection.execute(text(f'CREATE SCHEMA "{schema}"'))
    engine = create_async_engine(url, connect_args={"server_settings": {"search_path": schema}})
    try:
        # DDL compilation owns a private metadata graph, independently of other test dialects.
        metadata = MetaData()
        for table in SQLModel.metadata.tables.values():
            table.to_metadata(metadata)
        async with engine.begin() as connection:
            await connection.run_sync(metadata.create_all)
        source = await asyncio.to_thread(
            PracticeBundleCompiler().compile,
            canonical_musicxml=(
                Path(__file__).parent
                / "fixtures/musicxml"
                / getattr(request, "param", "score-domain-metadata.musicxml")
            ).read_bytes(),
        )
        async with AsyncSession(engine) as seed:
            user = User(email="source@example.com", display_name="Source", password_hash="test")
            seed.add(user)
            await seed.flush()
            score = Score(score_uuid="score-content-owner", owner_user_id=user.id, title="Source")
            seed.add(score)
            await seed.flush()
            revision = ScoreRevision(
                revision_uuid="revision-content-owner",
                score_id=score.id,
                revision_number=1,
                content_hash="test",
                origin="OMR",
                created_by_user_id=user.id,
            )
            seed.add(revision)
            await seed.flush()
            revision_id = revision.id
            score.head_revision_id = revision_id
            await seed.commit()
        storage = InMemoryObjectStorage()
        repository = PracticeBundleRepository(storage)
        repository.test_revision_id = revision_id
        repository.test_score_uuid = "score-content-owner"
        repository.test_revision_uuid = "revision-content-owner"
        yield engine, repository, source, storage
    finally:
        await engine.dispose()
        async with admin.begin() as connection:
            await connection.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
        await admin.dispose()


@pytest.mark.asyncio
async def test_same_revision_concurrent_candidates_have_one_bundle_one_binding(postgres_bundle):
    from sqlalchemy import func
    from app.db.models import ScoreRevisionPracticeBinding

    engine, repository, bundle, _ = postgres_bundle
    sessions = async_sessionmaker(engine, expire_on_commit=False)

    async def resolve():
        async with sessions() as db:
            return await repository.get_or_create(
                db, bundle, revision_id=repository.test_revision_id
            )

    first, second = await asyncio.gather(resolve(), resolve())
    assert first == second
    async with sessions() as db:
        assert await db.scalar(select(func.count()).select_from(PracticeBundleRecord)) == 1
        assert await db.scalar(select(func.count()).select_from(ScoreRevisionPracticeBinding)) == 1


@pytest.mark.asyncio
async def test_identical_content_across_scores_shares_one_bundle_two_bindings(postgres_bundle):
    from sqlalchemy import func
    from app.db.models import ScoreRevisionPracticeBinding

    engine, repository, bundle, _ = postgres_bundle
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with sessions() as db:
        score = Score(score_uuid="another-score", owner_user_id=1, title="Another")
        db.add(score)
        await db.flush()
        revision = ScoreRevision(
            revision_uuid="another-revision",
            score_id=score.id,
            revision_number=1,
            content_hash="same",
            origin="OMR",
            created_by_user_id=1,
        )
        db.add(revision)
        await db.flush()
        revision_id = revision.id
        await db.commit()

    async def resolve(revision_id):
        async with sessions() as db:
            return await repository.get_or_create(db, bundle, revision_id=revision_id)

    first, second = await asyncio.gather(resolve(repository.test_revision_id), resolve(revision_id))
    assert first == second
    assert first[1].artifact.representation.data == second[1].artifact.representation.data
    async with sessions() as db:
        assert await db.scalar(select(func.count()).select_from(PracticeBundleRecord)) == 1
        assert await db.scalar(select(func.count()).select_from(ScoreRevisionPracticeBinding)) == 2


@pytest.mark.asyncio
async def test_binding_cascade_retains_shared_bundle_until_last_revision_deleted(postgres_bundle):
    from sqlalchemy import delete
    from app.db.models import ScoreRevisionPracticeBinding
    from app.modules.practice.bundle.retention import practice_bundle_delete_service

    engine, repository, bundle, storage = postgres_bundle
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with sessions() as db:
        revision = ScoreRevision(
            revision_uuid="another-revision",
            score_id=1,
            revision_number=2,
            content_hash="same",
            origin="OMR",
            created_by_user_id=1,
        )
        db.add(revision)
        await db.flush()
        second_id = revision.id
        await db.commit()
        ref, _ = await repository.get_or_create(db, bundle, revision_id=repository.test_revision_id)
        await repository.get_or_create(db, bundle, revision_id=second_id)
        await db.execute(update(Score).values(head_revision_id=None))
        await db.execute(
            delete(ScoreRevision).where(ScoreRevision.id == repository.test_revision_id)
        )
        await db.commit()
        assert await db.get(ScoreRevisionPracticeBinding, repository.test_revision_id) is None
        assert (
            await db.run_sync(
                lambda sync: practice_bundle_delete_service.recover_unowned_ready(
                    sync,
                )
            )
            == []
        )
        await db.commit()
        await db.execute(delete(ScoreRevision).where(ScoreRevision.id == second_id))
        await db.commit()
        due = await db.run_sync(
            lambda sync: practice_bundle_delete_service.recover_unowned_ready(
                sync,
            )
        )
        await db.commit()
        assert len(due) == 1
        assert (await db.get(PracticeBundleRecord, ref.id)).status == "DELETING"


@pytest.mark.asyncio
async def test_gc_marked_bundle_cannot_receive_a_new_binding(postgres_bundle):
    from sqlalchemy import delete
    from app.modules.practice.bundle.retention import practice_bundle_delete_service

    engine, repository, bundle, storage = postgres_bundle
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with sessions() as db:
        ref, _ = await repository.get_or_create(db, bundle, revision_id=repository.test_revision_id)
        from app.db.models import ScoreRevisionPracticeBinding

        await db.execute(delete(ScoreRevisionPracticeBinding))
        await db.commit()
        await db.run_sync(
            lambda sync: practice_bundle_delete_service.enqueue_if_unowned(
                sync, ref.id,
            )
        )
        await db.commit()
        with pytest.raises(ValidationException):
            await repository.get_or_create(db, bundle, revision_id=repository.test_revision_id)
        await db.rollback()


@pytest.mark.asyncio
async def test_binding_committed_before_gc_protects_the_bundle(postgres_bundle):
    from app.modules.practice.bundle.retention import practice_bundle_delete_service

    engine, repository, bundle, storage = postgres_bundle
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with sessions() as a, sessions() as b:
        ref, _ = await repository.get_or_create(a, bundle, revision_id=repository.test_revision_id)
        assert (
            await b.run_sync(
                lambda sync: practice_bundle_delete_service.enqueue_if_unowned(
                    sync, ref.id,
                )
            )
            is None
        )
        await b.commit()
        assert (await repository.read_bound(a, repository.test_revision_id))[0] == ref


@pytest.mark.asyncio
@pytest.mark.parametrize("representation", ["artifact", "prepared_musicxml"])
async def test_durable_representation_corruption_fails_closed(postgres_bundle, representation):
    engine, repository, bundle, storage = postgres_bundle
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with sessions() as db:
        ref, _ = await repository.get_or_create(db, bundle, revision_id=repository.test_revision_id)
        row = await db.get(PracticeBundleRecord, ref.id)
        storage.put_bytes(
            key=getattr(row, representation + "_object_key"),
            content=b"corrupt",
            content_type="application/octet-stream",
        )
        with pytest.raises(ValidationException):
            await repository.read_bound(db, repository.test_revision_id)


@pytest.mark.asyncio
@pytest.mark.parametrize("winner", ["BINDING", "GC"])
async def test_binding_and_gc_serialize_on_bundle_row(postgres_bundle, winner):
    from sqlalchemy import delete
    from app.db.models import ScoreRevisionPracticeBinding
    from app.modules.practice.bundle.retention import practice_bundle_delete_service

    engine, repository, bundle, storage = postgres_bundle
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with sessions() as db:
        ref, _ = await repository.get_or_create(db, bundle, revision_id=repository.test_revision_id)
        await db.execute(delete(ScoreRevisionPracticeBinding))
        await db.commit()

    async def blocked(observer, pid):
        async with asyncio.timeout(10):
            while not await observer.scalar(
                text("SELECT cardinality(pg_blocking_pids(:pid)) > 0"), {"pid": pid}
            ):
                await observer.commit()

    if winner == "GC":
        async with sessions() as gc, sessions() as bind, sessions() as observer:
            await gc.execute(
                select(PracticeBundleRecord)
                .where(PracticeBundleRecord.id == ref.id)
                .with_for_update()
            )
            pid = await bind.scalar(text("SELECT pg_backend_pid()"))
            binding = asyncio.create_task(
                repository.get_or_create(bind, bundle, revision_id=repository.test_revision_id)
            )
            try:
                await blocked(observer, pid)
                assert not binding.done()
                outbox = await gc.run_sync(
                    lambda sync: practice_bundle_delete_service.enqueue_if_unowned(
                        sync, ref.id,
                    )
                )
                assert outbox is not None
            finally:
                await gc.commit()
            with pytest.raises(ValidationException):
                await asyncio.wait_for(binding, 10)
            await bind.rollback()
            assert await bind.scalar(select(ScoreRevisionPracticeBinding)) is None
    else:
        ready, release = asyncio.Event(), asyncio.Event()

        class BindingTransaction(AsyncSession):
            async def commit(self):
                ready.set()
                await release.wait()
                await super().commit()

        async with (
            BindingTransaction(engine, expire_on_commit=False) as bind,
            sessions() as gc,
            sessions() as observer,
        ):
            binding = asyncio.create_task(
                repository.get_or_create(bind, bundle, revision_id=repository.test_revision_id)
            )
            await asyncio.wait_for(ready.wait(), 10)
            pid = await gc.scalar(text("SELECT pg_backend_pid()"))
            collecting = asyncio.create_task(
                gc.run_sync(
                    lambda sync: practice_bundle_delete_service.enqueue_if_unowned(
                        sync, ref.id,
                    )
                )
            )
            try:
                await blocked(observer, pid)
                assert not collecting.done()
            finally:
                release.set()
            assert (await asyncio.wait_for(binding, 10))[0] == ref
            assert await asyncio.wait_for(collecting, 10) is None
            await gc.commit()
            assert (await repository.read_bound(gc, repository.test_revision_id))[0] == ref


@pytest.mark.asyncio
async def test_interrupted_creation_has_durable_lease_for_orphan_cleanup(postgres_bundle):
    from datetime import timedelta
    from unittest.mock import patch
    from app.db.models import ScoreRevisionPracticeBinding
    from app.modules.practice.bundle.retention import practice_bundle_delete_service
    from app.utils.timezone import utc_now_naive

    engine, repository, bundle, storage = postgres_bundle
    sessions = async_sessionmaker(engine, expire_on_commit=False)

    class Interrupted(BaseException):
        pass

    original = storage.put_bytes

    def interrupted(**kwargs):
        original(**kwargs)
        raise Interrupted()

    with patch.object(storage, "put_bytes", side_effect=interrupted):
        async with sessions() as db:
            with pytest.raises(Interrupted):
                await repository.get_or_create(db, bundle, revision_id=repository.test_revision_id)
            await db.rollback()
    async with sessions() as db:
        row = await db.scalar(select(PracticeBundleRecord))
        assert row.status == "CREATING" and row.creation_expires_at is not None
        assert storage.exists(row.prepared_musicxml_object_key)
        assert await db.scalar(select(ScoreRevisionPracticeBinding)) is None
        row.creation_expires_at = utc_now_naive() - timedelta(seconds=1)
        await db.commit()
        due = await db.run_sync(
            lambda sync: practice_bundle_delete_service.recover_stale_creating(
                sync,
            )
        )
        await db.commit()
        assert len(due) == 1 and row.status == "DELETING"


@pytest.mark.asyncio
@pytest.mark.parametrize("reader_role", ["OWNER", "PRACTITIONER"])
async def test_bound_readers_share_locks_and_fence_gc_during_verification(
    postgres_bundle, reader_role
):
    from unittest.mock import patch
    from sqlalchemy import event
    from app.db.models import ScoreMembership
    from app.db.models.score_access import MembershipRole
    from app.modules.practice.bundle.service import PracticeBundleService
    from app.modules.practice.bundle.retention import practice_bundle_delete_service

    engine, repository, bundle, storage = postgres_bundle
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    user_id = 1
    async with sessions() as seed:
        ref, _ = await repository.get_or_create(
            seed, bundle, revision_id=repository.test_revision_id
        )
        if reader_role == "PRACTITIONER":
            user = User(email="reader@example.com", display_name="Reader", password_hash="test")
            seed.add(user)
            await seed.flush()
            user_id = user.id
            seed.add(
                ScoreMembership(
                    score_id=1,
                    user_id=user_id,
                    role=MembershipRole.PRACTITIONER,
                    created_by_user_id=1,
                )
            )
            await seed.commit()

    service = PracticeBundleService(repository=repository, storage=storage)
    entered, release = asyncio.Event(), asyncio.Event()
    verified_read = repository._read_verified_bundle
    first = True

    async def verification(row):
        nonlocal first
        if first:
            first = False
            entered.set()
            await release.wait()
        return await verified_read(row)

    statements = []

    def observe_sql(connection, cursor, statement, parameters, context, executemany):
        statements.append(statement)

    async def request():
        async with sessions() as db:
            return await service.read_bundle(
                db,
                repository.test_score_uuid,
                user_id,
                repository.test_revision_uuid,
                include_notation=True,
            )

    event.listen(engine.sync_engine, "before_cursor_execute", observe_sql)
    try:
        with (
            patch.object(repository, "_read_verified_bundle", side_effect=verification),
            patch(
                "app.modules.practice.bundle.service.lock_live_practice_mutation_access",
                side_effect=AssertionError(
                    "Ordinary bound GET must not acquire mutation admission"
                ),
            ),
            patch.object(
                service.compiler,
                "compile",
                side_effect=AssertionError("Bound GET must not compile"),
            ),
            patch.object(
                service.asset_repository,
                "canonical_source",
                side_effect=AssertionError("Bound GET must not read canonical notation"),
            ),
        ):
            first_read = asyncio.create_task(request())
            try:
                await asyncio.wait_for(entered.wait(), 10)
                # A second ordinary request completes while the first verified read is pending.
                second = await asyncio.wait_for(request(), 10)
                assert (
                    second.binding.bundle_id == ref.bundle_id
                    and second.notation.musicxml == bundle.prepared_musicxml.content
                )
                locking = [
                    statement.upper() for statement in statements if " FOR " in statement.upper()
                ]
                assert locking and all("FOR SHARE" in statement for statement in locking)
                assert all(
                    "SCORE_MEMBERSHIPS" not in statement and "FROM SCORES " not in statement
                    for statement in locking
                )
                async with sessions() as gc, sessions() as observer:
                    pid = await gc.scalar(text("SELECT pg_backend_pid()"))
                    collecting = asyncio.create_task(
                        gc.run_sync(
                            lambda sync: practice_bundle_delete_service.enqueue_if_unowned(
                                sync, ref.id,
                            )
                        )
                    )
                    try:
                        async with asyncio.timeout(10):
                            while not await observer.scalar(
                                text("SELECT cardinality(pg_blocking_pids(:pid)) > 0"), {"pid": pid}
                            ):
                                await observer.commit()
                        assert not collecting.done()
                        row = await observer.get(PracticeBundleRecord, ref.id)
                        assert storage.exists(row.prepared_musicxml_object_key) and storage.exists(
                            row.artifact_object_key
                        )
                    finally:
                        release.set()
                    assert (
                        await asyncio.wait_for(first_read, 10)
                    ).binding.bundle_id == ref.bundle_id
                    assert await asyncio.wait_for(collecting, 10) is None
                    await gc.commit()
            finally:
                release.set()
                await first_read
    finally:
        event.remove(engine.sync_engine, "before_cursor_execute", observe_sql)


@pytest.mark.asyncio
async def test_durable_bundle_rejects_graph_corruption_with_consistent_content_hashes(
    postgres_bundle,
):
    import hashlib
    from app.modules.practice.score.artifact import (
        canonical_practice_artifact_bytes,
        practice_artifact_id,
    )
    from app.modules.practice.bundle.domain import calculate_bundle_id

    engine, repository, bundle, storage = postgres_bundle
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with sessions() as db:
        ref, _ = await repository.get_or_create(db, bundle, revision_id=repository.test_revision_id)
        row = await db.get(PracticeBundleRecord, ref.id)
        value = bundle.artifact.value
        value["notes"][0]["eventId"] = "missing"
        value["artifactId"] = practice_artifact_id(value)
        data = canonical_practice_artifact_bytes(value)
        storage.put_bytes(
            key=row.artifact_object_key, content=data, content_type="application/json"
        )
        row.artifact_id = value["artifactId"]
        row.artifact_byte_size = len(data)
        row.artifact_sha256 = hashlib.sha256(data).hexdigest()
        row.bundle_id = calculate_bundle_id(
            row.artifact_schema_version, row.prepared_musicxml_sha256, row.artifact_sha256
        )
        await db.commit()
        with pytest.raises(ValueError, match="dangling"):
            await repository.read_bound(db, repository.test_revision_id)
