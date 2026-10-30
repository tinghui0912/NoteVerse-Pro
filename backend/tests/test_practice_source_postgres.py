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
from app.core.exceptions import ValidationException
from app.db.models.practice_source_snapshot import PracticeSourceSnapshot
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
        bundle = await asyncio.to_thread(
            PracticeSourceBuilder().build,
            score_id=str(uuid4()),
            revision_id=str(uuid4()),
            canonical_musicxml=(
                Path(__file__).parent / "fixtures/musicxml/score-domain-metadata.musicxml"
            ).read_bytes(),
        )
        storage = LocalFileStorage(str(tmp_path))
        yield engine, PracticeSourceRepository(storage), bundle, storage
    finally:
        await engine.dispose()
        async with admin.begin() as connection:
            await connection.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
        await admin.dispose()


@pytest.mark.asyncio
async def test_cached_ready_cannot_admit_committed_deleting(postgres_source):
    engine, repository, bundle, _ = postgres_source
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with sessions() as creator:
        ref = await repository.materialize(creator, bundle)
    async with sessions() as a, sessions() as b:
        cached = await a.get(PracticeSourceSnapshot, ref.id)
        assert cached.status == "READY"
        await a.commit()  # retains the identity-map value
        row = (
            await b.execute(
                select(PracticeSourceSnapshot)
                .where(PracticeSourceSnapshot.id == ref.id)
                .with_for_update()
            )
        ).scalar_one()
        row.status = "DELETING"
        await b.commit()
        assert cached.status == "READY"
        with pytest.raises(ValidationException):
            await repository.require_ready(a, ref.id, lock=True)
        assert await repository.find_ready(a, ref.id) is None
        with pytest.raises(ValidationException):
            await repository.read_bundle(a, ref.id)
        with pytest.raises(ValidationException):
            await repository.materialize(a, bundle)
        assert (
            await b.execute(
                select(PracticeSourceSnapshot.status).where(PracticeSourceSnapshot.id == ref.id)
            )
        ).scalar_one() == "DELETING"


@pytest.mark.asyncio
@pytest.mark.parametrize("transition", ["DELETING", "EXPIRED"])
async def test_cached_creator_cannot_ready_ineligible_database_row(postgres_source, transition):
    engine, repository, bundle, storage = postgres_source
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
        task = asyncio.create_task(repository.materialize(a, bundle))
        try:
            assert await asyncio.to_thread(writing.wait, 15)
            cached = next(
                row for row in a.identity_map.values() if isinstance(row, PracticeSourceSnapshot)
            )
            assert cached.status == "CREATING"
            await a.commit()  # leave a retained CREATING object without a transaction lock
            row = (
                await b.execute(
                    select(PracticeSourceSnapshot)
                    .where(PracticeSourceSnapshot.id == cached.id)
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
        assert caught.value.details["reason"] == "source_snapshot_creation_lease_expired"
        assert (await b.execute(select(PracticeSourceSnapshot.status))).scalar_one() == "DELETING"


@pytest.mark.asyncio
async def test_two_creators_race_one_fingerprint_and_reuse_exact_ready_bundle(postgres_source):
    engine, repository, bundle, storage = postgres_source
    barrier = asyncio.Barrier(2)
    writing, resume = Event(), Event()
    loser_done = asyncio.Event()
    writes = []
    original_put = storage.put_bytes

    class RacingSession(AsyncSession):
        first_lookup = True

        async def execute(self, statement, *args, **kwargs):
            result = await super().execute(statement, *args, **kwargs)
            if self.first_lookup and "source_fingerprint =" in str(statement):
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
                return await repository.materialize(session, bundle)
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
    assert failures[0].details["reason"] == "source_snapshot_not_ready"
    async with AsyncSession(engine, expire_on_commit=False) as session:
        row = (await session.execute(select(PracticeSourceSnapshot))).scalar_one()
        assert row.status == "READY"
        assert row.source_fingerprint == bundle.source_id
        assert row.prepared_musicxml_sha256 == bundle.prepared_musicxml.sha256
        assert row.artifact_sha256 == bundle.artifact.representation.sha256
        assert storage.read_bytes(row.prepared_musicxml_object_key) == bundle.prepared_musicxml.data
        assert storage.read_bytes(row.artifact_object_key) == bundle.artifact.representation.data
        assert await repository.materialize(session, bundle) == refs[0]
        assert await repository.read_bundle(session, refs[0].id) == bundle
    assert len(writes) == 2


@pytest.mark.asyncio
async def test_eligible_row_refreshes_cached_representation_attributes(postgres_source):
    engine, repository, bundle, _ = postgres_source
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with sessions() as creator:
        ref = await repository.materialize(creator, bundle)
    async with sessions() as a, sessions() as b:
        cached = await a.get(PracticeSourceSnapshot, ref.id)
        checksum = cached.artifact_sha256
        await a.commit()
        await b.execute(
            update(PracticeSourceSnapshot)
            .where(PracticeSourceSnapshot.id == ref.id)
            .values(artifact_sha256="0" * 64)
        )
        await b.commit()
        assert cached.artifact_sha256 == checksum
        with pytest.raises(ValidationException) as caught:
            await repository.read_bundle(a, ref.id)
        assert caught.value.details["reason"] == "artifact_checksum_mismatch"
        assert cached.artifact_sha256 == "0" * 64
