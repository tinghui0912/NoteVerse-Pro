"""Database-authoritative source lifecycle admission across independent transactions."""

from __future__ import annotations

import asyncio
from datetime import timedelta
import os
from pathlib import Path
from threading import Event
from uuid import uuid4

import pytest
import pytest_asyncio
from sqlalchemy import MetaData, select, text, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.engine import make_url
from sqlmodel import SQLModel

import app.db.models  # noqa: F401 -- register the durable reference graph
from app.core.exceptions import ValidationException, ResourceNotFoundException
from app.db.models.practice_source import PracticeSourceRecord
from app.db.models import User, Score, ScoreRevision
from app.modules.practice.source.builder import PracticeSourceBuilder
from app.modules.practice.source.repository import PracticeSourceRepository
from app.storage.local import LocalFileStorage
from app.utils.timezone import utc_now_naive


@pytest_asyncio.fixture
async def postgres_source(tmp_path):
    url = os.environ.get("NOTEVERSE_TEST_PRACTICE_SOURCE_POSTGRES_URL")
    if not url:
        pytest.skip(
            "Set NOTEVERSE_TEST_PRACTICE_SOURCE_POSTGRES_URL to run real PostgreSQL source races"
        )
    parsed = make_url(url)
    assert parsed.drivername == "postgresql+asyncpg"
    assert (parsed.database or "").startswith("noteverse_test_"), "Use a dedicated test database"
    schema = "practice_source_" + uuid4().hex
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
            PracticeSourceBuilder().build,
            score_id=str(uuid4()),
            revision_id=str(uuid4()),
            canonical_musicxml=(
                Path(__file__).parent / "fixtures/musicxml/score-domain-metadata.musicxml"
            ).read_bytes(),
        )
        async with AsyncSession(engine) as seed:
            user = User(email="source@example.com", display_name="Source", password_hash="test")
            seed.add(user)
            await seed.flush()
            score = Score(score_uuid=source.score_id, owner_user_id=user.id, title="Source")
            seed.add(score)
            await seed.flush()
            revision = ScoreRevision(
                revision_uuid=source.revision_id,
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
        storage = LocalFileStorage(str(tmp_path))
        repository = PracticeSourceRepository(storage)
        repository.test_revision_id = revision_id
        yield engine, repository, source, storage
    finally:
        await engine.dispose()
        async with admin.begin() as connection:
            await connection.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
        await admin.dispose()


@pytest.mark.asyncio
async def test_cached_ready_cannot_admit_committed_deleting(postgres_source):
    engine, repository, source, _ = postgres_source
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with sessions() as creator:
        (ref, _) = await repository.get_or_create(
            creator, source, live_revision_id=repository.test_revision_id
        )
    async with sessions() as a, sessions() as b:
        cached = await a.get(PracticeSourceRecord, ref.id)
        assert cached.status == "READY"
        await a.commit()  # retains the identity-map value
        row = (
            await b.execute(
                select(PracticeSourceRecord)
                .where(PracticeSourceRecord.id == ref.id)
                .with_for_update()
            )
        ).scalar_one()
        row.status = "DELETING"
        await b.commit()
        assert cached.status == "READY"
        with pytest.raises(ResourceNotFoundException):
            await repository.require_ready_by_source_id(a, ref.source_id, lock=True)
        with pytest.raises(ResourceNotFoundException):
            await repository.read_by_source_id(a, ref.source_id)
        with pytest.raises(ValidationException):
            await repository.get_or_create(a, source, live_revision_id=repository.test_revision_id)
        assert (
            await b.execute(
                select(PracticeSourceRecord.status).where(PracticeSourceRecord.id == ref.id)
            )
        ).scalar_one() == "DELETING"


@pytest.mark.asyncio
@pytest.mark.parametrize("transition", ["DELETING", "EXPIRED"])
async def test_cached_creator_cannot_ready_ineligible_database_row(postgres_source, transition):
    engine, repository, source, storage = postgres_source
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    writing, resume = Event(), Event()
    original_put = storage.put_bytes

    def blocked_put(**kwargs):
        writing.set()
        if not resume.wait(15):
            raise TimeoutError("Source creator synchronization timed out")
        return original_put(**kwargs)

    storage.put_bytes = blocked_put
    async with sessions() as a, sessions() as b:
        task = asyncio.create_task(
            repository.get_or_create(a, source, live_revision_id=repository.test_revision_id)
        )
        try:
            assert await asyncio.to_thread(writing.wait, 15)
            cached = next(
                row for row in a.identity_map.values() if isinstance(row, PracticeSourceRecord)
            )
            assert cached.status == "CREATING"
            await a.commit()  # leave a retained CREATING object without a transaction lock
            row = (
                await b.execute(
                    select(PracticeSourceRecord)
                    .where(PracticeSourceRecord.id == cached.id)
                    .with_for_update()
                )
            ).scalar_one()
            if transition == "DELETING":
                row.status, row.creation_expires_at = "DELETING", None
            else:
                row.creation_expires_at = utc_now_naive() - timedelta(seconds=1)
            await b.commit()
            assert cached.status == "CREATING"
            assert cached.creation_expires_at > utc_now_naive()
        finally:
            resume.set()
        with pytest.raises(ValidationException) as caught:
            await asyncio.wait_for(task, 15)
        assert caught.value.details["reason"] == "practice_source_creation_lease_expired"
        assert (await b.execute(select(PracticeSourceRecord.status))).scalar_one() == "DELETING"


@pytest.mark.asyncio
async def test_two_creators_race_one_source_identity_and_reuse_exact_ready_source(postgres_source):
    engine, repository, source, storage = postgres_source
    barrier = asyncio.Barrier(2)
    writing, resume = Event(), Event()
    loser_done = asyncio.Event()
    writes = []
    original_put = storage.put_bytes

    class RacingSession(AsyncSession):
        first_lookup = True

        async def execute(self, statement, *args, **kwargs):
            result = await super().execute(statement, *args, **kwargs)
            if self.first_lookup and "source_id =" in str(statement):
                self.first_lookup = False
                await asyncio.wait_for(barrier.wait(), 15)
            return result

    def blocked_put(**kwargs):
        writes.append(kwargs["key"])
        writing.set()
        if not resume.wait(15):
            raise TimeoutError("Fingerprint race synchronization timed out")
        return original_put(**kwargs)

    storage.put_bytes = blocked_put

    async def create():
        async with RacingSession(engine, expire_on_commit=False) as session:
            try:
                return await repository.get_or_create(
                    session, source, live_revision_id=repository.test_revision_id
                )
            except ValidationException as error:
                loser_done.set()
                return error

    tasks = [asyncio.create_task(create()), asyncio.create_task(create())]
    try:
        assert await asyncio.to_thread(writing.wait, 15)
        await asyncio.wait_for(loser_done.wait(), 15)
        assert len(writes) == 1  # winner is CREATING; loser performs no writes
    finally:
        resume.set()
    outcomes = await asyncio.wait_for(asyncio.gather(*tasks), 15)
    failures = [value for value in outcomes if isinstance(value, ValidationException)]
    refs = [value for value in outcomes if not isinstance(value, Exception)]
    assert len(failures) == len(refs) == 1
    assert failures[0].details["reason"] == "practice_source_not_ready"
    async with AsyncSession(engine, expire_on_commit=False) as session:
        row = (await session.execute(select(PracticeSourceRecord))).scalar_one()
        assert row.status == "READY"
        assert row.source_id == source.source_id
        assert row.prepared_musicxml_sha256 == source.prepared_musicxml.sha256
        assert row.artifact_sha256 == source.artifact.representation.sha256
        assert storage.read_bytes(row.prepared_musicxml_object_key) == source.prepared_musicxml.data
        assert storage.read_bytes(row.artifact_object_key) == source.artifact.representation.data
        assert (
            await repository.get_or_create(
                session, source, live_revision_id=repository.test_revision_id
            )
            == refs[0]
        )
        assert await repository.read_by_source_id(session, refs[0][0].source_id) == source
    assert len(writes) == 2


@pytest.mark.asyncio
async def test_eligible_row_refreshes_cached_representation_attributes(postgres_source):
    engine, repository, source, _ = postgres_source
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with sessions() as creator:
        (ref, _) = await repository.get_or_create(
            creator, source, live_revision_id=repository.test_revision_id
        )
    async with sessions() as a, sessions() as b:
        cached = await a.get(PracticeSourceRecord, ref.id)
        checksum = cached.artifact_sha256
        await a.commit()
        await b.execute(
            update(PracticeSourceRecord)
            .where(PracticeSourceRecord.id == ref.id)
            .values(artifact_sha256="0" * 64)
        )
        await b.commit()
        assert cached.artifact_sha256 == checksum
        with pytest.raises(ValidationException) as caught:
            await repository.read_by_source_id(a, ref.source_id)
        assert caught.value.details["reason"] == "artifact_checksum_mismatch"
        assert cached.artifact_sha256 == "0" * 64


@pytest.mark.asyncio
async def test_revision_fk_release_and_orphan_scan_use_current_database_ownership(postgres_source):
    from app.modules.practice.source.retention import practice_source_delete_service
    from sqlalchemy import delete, update

    engine, repository, source, storage = postgres_source
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with sessions() as a, sessions() as b:
        reference, _ = await repository.get_or_create(
            a, source, live_revision_id=repository.test_revision_id
        )
        cached = await a.get(PracticeSourceRecord, reference.id)
        assert cached.live_revision_id == repository.test_revision_id
        await a.commit()
        assert (
            await b.run_sync(
                lambda db: practice_source_delete_service.recover_unowned_ready(
                    db, storage_backend=storage.backend_name
                )
            )
            == []
        )
        await b.execute(update(Score).values(head_revision_id=None))
        await b.execute(
            delete(ScoreRevision).where(ScoreRevision.id == repository.test_revision_id)
        )
        await b.commit()
        assert cached.live_revision_id == repository.test_revision_id
        due = await a.run_sync(
            lambda db: practice_source_delete_service.recover_unowned_ready(
                db, storage_backend=storage.backend_name
            )
        )
        await a.commit()
        assert len(due) == 1
        assert cached.status == "DELETING"
        assert cached.live_revision_id is None
