"""Database-authoritative Bundle lifecycle admission across independent transactions."""

from __future__ import annotations

from app.composition import storage_resources as _resource_wiring
from app.modules.practice.bundle.object_keys import (
    practice_bundle_musicxml_object_key,
    practice_bundle_artifact_object_key,
)

from app.modules.practice.bundle.states import PracticeBundleStatus

from tests.support.practice_bundle import bind_bundle
from app.modules.practice.bundle.content import read_verified_bundle

import asyncio
from concurrent.futures import ThreadPoolExecutor
from threading import Event
from time import monotonic, sleep
import os
from pathlib import Path
from uuid import uuid4

import pytest
from sqlalchemy import MetaData, select, text, update
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy import create_engine
from sqlalchemy.engine import make_url
from sqlmodel import SQLModel

import app.db.models  # noqa: F401 -- register the durable reference graph
from app.core.exceptions import ValidationException
from app.db.models.practice_bundle import PracticeBundleRecord
from app.db.models import User, Score, ScoreRevision
from app.modules.practice.bundle.compiler import PracticeBundleCompiler
from app.modules.practice.bundle.repository import PracticeBundleRepository
from tests.support.object_storage import InMemoryObjectStorage


@pytest.fixture
def postgres_bundle(tmp_path, request, monkeypatch):
    url = os.environ.get("NOTEVERSE_TEST_PRACTICE_BUNDLE_POSTGRES_URL")
    if not url:
        pytest.skip(
            "Set NOTEVERSE_TEST_PRACTICE_BUNDLE_POSTGRES_URL to run real PostgreSQL Bundle races"
        )
    parsed = make_url(url)
    assert parsed.drivername == "postgresql+psycopg"
    assert (parsed.database or "").startswith("noteverse_test_"), "Use a dedicated test database"
    schema = "practice_bundle_" + uuid4().hex
    admin = create_engine(url)
    with admin.begin() as connection:
        connection.execute(text(f'CREATE SCHEMA "{schema}"'))
    engine = create_engine(url, connect_args={"options": f"-csearch_path={schema}"})
    from app.composition import storage_resources

    monkeypatch.setattr(
        storage_resources, "write_sessions", sessionmaker(engine, expire_on_commit=False)
    )
    try:
        # DDL compilation owns a private metadata graph, independently of other test dialects.
        metadata = MetaData()
        for table in SQLModel.metadata.tables.values():
            table.to_metadata(metadata)
        with engine.begin() as connection:
            metadata.create_all(connection)
        source = PracticeBundleCompiler().compile(
            canonical_musicxml=(
                Path(__file__).parent
                / "fixtures/musicxml"
                / getattr(request, "param", "bundle-multi-part.musicxml")
            ).read_bytes(),
        )
        with Session(engine) as seed:
            user = User(
                email="source@example.com",
                display_name="Source",
                password_hash="9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
            )
            seed.add(user)
            seed.flush()
            score = Score(
                score_uuid="score-content-owner", owner_user_id=user.id, display_title="Source"
            )
            seed.add(score)
            seed.flush()
            revision = ScoreRevision(
                revision_uuid="revision-content-owner",
                score_id=score.id,
                revision_number=1,
                content_hash="9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
                origin="OMR",
                created_by_user_id=user.id,
            )
            seed.add(revision)
            seed.flush()
            revision_id = revision.id
            score.head_revision_id = revision_id
            seed.commit()
        storage = InMemoryObjectStorage()
        repository = PracticeBundleRepository()
        repository.test_revision_id = revision_id
        repository.test_score_uuid = "score-content-owner"
        repository.test_revision_uuid = "revision-content-owner"
        yield engine, repository, source, storage
    finally:
        engine.dispose()
        with admin.begin() as connection:
            connection.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
        admin.dispose()


@pytest.mark.asyncio
async def test_same_revision_concurrent_candidates_have_one_bundle_one_binding(postgres_bundle):
    from sqlalchemy import func
    from app.db.models import ScoreRevisionPracticeBinding

    engine, repository, bundle, storage = postgres_bundle
    sessions = sessionmaker(engine, expire_on_commit=False)

    def resolve():
        with sessions() as db:
            return bind_bundle(db, storage, bundle, revision_id=repository.test_revision_id)

    with ThreadPoolExecutor(max_workers=2) as pool:
        a, b = pool.submit(resolve), pool.submit(resolve)
        first, second = a.result(15), b.result(15)
    assert first == second
    with sessions() as db:
        assert db.scalar(select(func.count()).select_from(PracticeBundleRecord)) == 1
        assert db.scalar(select(func.count()).select_from(ScoreRevisionPracticeBinding)) == 1
        row = db.scalar(select(PracticeBundleRecord))
        assert row.prepared_musicxml_object.object_key == practice_bundle_musicxml_object_key(
            bundle.bundle_id
        )
        assert row.artifact_object.object_key == practice_bundle_artifact_object_key(
            bundle.bundle_id
        )


@pytest.mark.asyncio
async def test_identical_content_across_scores_shares_one_bundle_two_bindings(postgres_bundle):
    from sqlalchemy import func
    from app.db.models import ScoreRevisionPracticeBinding

    engine, repository, bundle, storage = postgres_bundle
    sessions = sessionmaker(engine, expire_on_commit=False)
    with sessions() as db:
        score = Score(score_uuid="another-score", owner_user_id=1, display_title="Another")
        db.add(score)
        db.flush()
        revision = ScoreRevision(
            revision_uuid="another-revision",
            score_id=score.id,
            revision_number=1,
            content_hash="0967115f2813a3541eaef77de9d9d5773f1c0c04314b0bbfe4ff3b3b1c55b5d5",
            origin="OMR",
            created_by_user_id=1,
        )
        db.add(revision)
        db.flush()
        revision_id = revision.id
        db.commit()

    def resolve(revision_id):
        with sessions() as db:
            return bind_bundle(db, storage, bundle, revision_id=revision_id)

    with ThreadPoolExecutor(max_workers=2) as pool:
        a, b = pool.submit(resolve, repository.test_revision_id), pool.submit(resolve, revision_id)
        first, second = a.result(15), b.result(15)
    assert first == second
    assert first[1].artifact.representation.data == second[1].artifact.representation.data
    with sessions() as db:
        assert db.scalar(select(func.count()).select_from(PracticeBundleRecord)) == 1
        assert db.scalar(select(func.count()).select_from(ScoreRevisionPracticeBinding)) == 2


def test_binding_cascade_retains_shared_bundle_until_last_revision_deleted(postgres_bundle):
    from sqlalchemy import delete
    from app.db.models import ScoreRevisionPracticeBinding
    from app.modules.practice.bundle.retention import practice_bundle_retention

    engine, repository, bundle, storage = postgres_bundle
    sessions = sessionmaker(engine, expire_on_commit=False)
    with sessions() as db:
        revision = ScoreRevision(
            revision_uuid="another-revision",
            score_id=1,
            revision_number=2,
            content_hash="0967115f2813a3541eaef77de9d9d5773f1c0c04314b0bbfe4ff3b3b1c55b5d5",
            origin="OMR",
            created_by_user_id=1,
        )
        db.add(revision)
        db.flush()
        second_id = revision.id
        db.commit()
        ref, _ = bind_bundle(db, storage, bundle, revision_id=repository.test_revision_id)
        bind_bundle(db, storage, bundle, revision_id=second_id)
        db.execute(update(Score).values(head_revision_id=None))
        db.execute(delete(ScoreRevision).where(ScoreRevision.id == repository.test_revision_id))
        db.commit()
        assert db.get(ScoreRevisionPracticeBinding, repository.test_revision_id) is None
        assert practice_bundle_retention.collect_unowned_ready(db) == []
        db.commit()
        db.execute(delete(ScoreRevision).where(ScoreRevision.id == second_id))
        db.commit()
        due = practice_bundle_retention.collect_unowned_ready(db)
        db.commit()
        assert len(due) == 2
        assert db.get(PracticeBundleRecord, ref.id) is None


def test_collected_bundle_rebinds_only_through_fenced_object_adoption(postgres_bundle):
    from sqlalchemy import delete
    from app.db.models import ScoreRevisionPracticeBinding, StoredObjectRetirement
    from app.modules.practice.bundle.retention import practice_bundle_retention

    engine, repository, bundle, storage = postgres_bundle
    sessions = sessionmaker(engine, expire_on_commit=False)
    with sessions() as db:
        ref, _ = bind_bundle(db, storage, bundle, revision_id=repository.test_revision_id)
        db.execute(delete(ScoreRevisionPracticeBinding))
        due = practice_bundle_retention.retire_unowned(db, ref.id)
        db.commit()
        assert len(due) == 2
        rebound, verified = bind_bundle(
            db, storage, bundle, revision_id=repository.test_revision_id
        )
        assert verified.bundle_id == bundle.bundle_id
        assert (
            repository.reference(repository.read_bound(db, repository.test_revision_id)) == rebound
        )
        assert all(
            op.status == "CANCELLED" for op in (db.scalars(select(StoredObjectRetirement))).all()
        )


def test_binding_committed_before_gc_protects_the_bundle(postgres_bundle):
    from app.modules.practice.bundle.retention import practice_bundle_retention

    engine, repository, bundle, storage = postgres_bundle
    sessions = sessionmaker(engine, expire_on_commit=False)
    with sessions() as a, sessions() as b:
        ref, _ = bind_bundle(a, storage, bundle, revision_id=repository.test_revision_id)
        assert practice_bundle_retention.retire_unowned(b, ref.id) == []
        b.commit()
        assert repository.reference(repository.read_bound(a, repository.test_revision_id)) == ref


@pytest.mark.parametrize("representation", ["artifact", "prepared_musicxml"])
def test_durable_representation_corruption_fails_closed(postgres_bundle, representation):
    engine, repository, bundle, storage = postgres_bundle
    sessions = sessionmaker(engine, expire_on_commit=False)
    with sessions() as db:
        ref, _ = bind_bundle(db, storage, bundle, revision_id=repository.test_revision_id)
        row = db.get(PracticeBundleRecord, ref.id)
        storage.put_bytes(
            key=getattr(row, representation + "_object").object_key,
            content=b"corrupt",
            content_type="application/octet-stream",
        )
        with pytest.raises(ValidationException):
            read_verified_bundle(storage, repository.read_bound(db, repository.test_revision_id))


@pytest.mark.parametrize("winner", ["GC", "BINDING"])
def test_binding_and_gc_serialize_on_bundle_row(postgres_bundle, winner):
    from sqlalchemy import delete
    from app.db.models import ScoreRevisionPracticeBinding
    from app.modules.practice.bundle.retention import practice_bundle_retention
    from tests.test_stored_object_retirement_postgres import assert_blocked

    engine, repository, bundle, storage = postgres_bundle
    sessions = sessionmaker(engine, expire_on_commit=False)
    with sessions() as db:
        ref, _ = bind_bundle(db, storage, bundle, revision_id=repository.test_revision_id)
        db.execute(delete(ScoreRevisionPracticeBinding))
        db.commit()
    ready, release = Event(), Event()
    pid = []

    class BindingSession(Session):
        def commit(self):
            if winner == "BINDING":
                ready.set()
                assert release.wait(10)
            super().commit()

    def bind():
        with BindingSession(engine, expire_on_commit=False) as db:
            pid.append(db.scalar(text("SELECT pg_backend_pid()")))
            return bind_bundle(db, storage, bundle, revision_id=repository.test_revision_id)

    def collect():
        with sessions() as db:
            pid.append(db.scalar(text("SELECT pg_backend_pid()")))
            outcome = practice_bundle_retention.retire_unowned(db, ref.id)
            db.commit()
            return outcome

    with ThreadPoolExecutor(max_workers=2) as pool:
        if winner == "GC":
            with sessions() as gc:
                gc.execute(
                    select(PracticeBundleRecord)
                    .where(PracticeBundleRecord.id == ref.id)
                    .with_for_update()
                )
                pending = pool.submit(bind)
                try:
                    deadline = monotonic() + 10
                    while not pid:
                        assert monotonic() < deadline
                        sleep(0.01)
                    assert_blocked(engine, pid[0])
                    assert not pending.done()
                    assert practice_bundle_retention.retire_unowned(gc, ref.id) is not None
                finally:
                    gc.commit()
                rebound, verified = pending.result(10)
                assert verified.bundle_id == bundle.bundle_id
        else:
            binding = pool.submit(bind)
            try:
                assert ready.wait(10)
                collecting = pool.submit(collect)
                deadline = monotonic() + 10
                while len(pid) < 2:
                    assert monotonic() < deadline
                    sleep(0.01)
                assert_blocked(engine, pid[1])
                assert not collecting.done()
            finally:
                release.set()
            assert binding.result(10)[0] == ref
            assert collecting.result(10) == []
            rebound = ref
    with sessions() as db:
        assert (
            repository.reference(repository.read_bound(db, repository.test_revision_id)) == rebound
        )


def test_interrupted_creation_has_durable_lease_for_orphan_cleanup(postgres_bundle):
    from datetime import timedelta
    from unittest.mock import patch
    from app.db.models import ScoreRevisionPracticeBinding
    from app.modules.practice.bundle.retention import practice_bundle_retention
    from app.shared.time import utc_now

    engine, repository, bundle, storage = postgres_bundle
    sessions = sessionmaker(engine, expire_on_commit=False)

    class Interrupted(BaseException):
        pass

    original = storage.put_bytes

    def interrupted(**kwargs):
        original(**kwargs)
        raise Interrupted()

    with patch.object(storage, "put_bytes", side_effect=interrupted):
        with sessions() as db:
            with pytest.raises(Interrupted):
                bind_bundle(db, storage, bundle, revision_id=repository.test_revision_id)
            db.rollback()
    with sessions() as db:
        row = db.scalar(select(PracticeBundleRecord))
        assert row.status is PracticeBundleStatus.CREATING and row.creation_expires_at is not None
        from app.db.models import ObjectWriteIntent, StoredObject

        assert row.prepared_musicxml_object_id is None and row.artifact_object_id is None
        intents = list(db.scalars(select(ObjectWriteIntent)))
        assert len(intents) == 2 and all(intent.status == "CLEANUP_PENDING" for intent in intents)
        written_keys = {
            intent.object_key for intent in intents if storage.exists(intent.object_key)
        }
        assert len(written_keys) == 1
        assert db.scalar(select(StoredObject)) is None
        assert db.scalar(select(ScoreRevisionPracticeBinding)) is None
        row.creation_expires_at = utc_now() - timedelta(seconds=1)
        db.commit()
        due = practice_bundle_retention.recover_stale_creating(db)
        db.commit()
        assert due == [] and db.scalar(select(PracticeBundleRecord)) is None
        assert db.scalar(select(StoredObject)) is None
        assert all(storage.exists(key) for key in written_keys)


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
    from app.modules.practice.bundle.retention import practice_bundle_retention

    engine, repository, bundle, storage = postgres_bundle
    sessions = sessionmaker(engine, expire_on_commit=False)
    user_id = 1
    with sessions() as seed:
        ref, _ = bind_bundle(seed, storage, bundle, revision_id=repository.test_revision_id)
        if reader_role == "PRACTITIONER":
            user = User(
                email="reader@example.com",
                display_name="Reader",
                password_hash="9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
            )
            seed.add(user)
            seed.flush()
            user_id = user.id
            seed.add(
                ScoreMembership(
                    score_id=1,
                    user_id=user_id,
                    role=MembershipRole.PRACTITIONER,
                    created_by_user_id=1,
                )
            )
            seed.commit()

    service = PracticeBundleService(
        repository=repository, writes=_resource_wiring.build_object_write_coordinator(storage)
    )
    entered, release = Event(), Event()
    from app.modules.practice.bundle.content import read_verified_bundle

    verified_read = read_verified_bundle
    first = True

    def verification(storage, row):
        nonlocal first
        if first:
            first = False
            entered.set()
            assert release.wait(10)
        return verified_read(storage, row)

    statements = []

    def observe_sql(connection, cursor, statement, parameters, context, executemany):
        statements.append(statement)

    def request():
        with sessions() as db:
            return service.read_bundle(
                db,
                repository.test_score_uuid,
                user_id,
                repository.test_revision_uuid,
                include_notation=True,
            )

    event.listen(engine, "before_cursor_execute", observe_sql)
    try:
        with (
            patch(
                "app.modules.practice.bundle.service.read_verified_bundle", side_effect=verification
            ),
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
            first_read = asyncio.create_task(asyncio.to_thread(request))
            try:
                assert await asyncio.to_thread(entered.wait, 10)
                # A second ordinary request completes while the first verified read is pending.
                second = await asyncio.wait_for(asyncio.to_thread(request), 10)
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
                with sessions() as gc, sessions() as observer:
                    gc.scalar(text("SELECT pg_backend_pid()"))

                    def collect():
                        with sessions() as db:
                            collection_pid.append(db.scalar(text("SELECT pg_backend_pid()")))
                            outcome = practice_bundle_retention.retire_unowned(db, ref.id)
                            db.commit()
                            return outcome

                    collection_pid = []
                    collecting = asyncio.create_task(asyncio.to_thread(collect))
                    try:
                        from tests.test_stored_object_retirement_postgres import assert_blocked

                        async with asyncio.timeout(10):
                            while not collection_pid:
                                await asyncio.sleep(0.01)
                        await asyncio.to_thread(assert_blocked, engine, collection_pid[0])
                        assert not collecting.done()
                        row = observer.get(PracticeBundleRecord, ref.id)
                        assert storage.exists(
                            row.prepared_musicxml_object.object_key
                        ) and storage.exists(row.artifact_object.object_key)
                    finally:
                        release.set()
                    assert (
                        await asyncio.wait_for(first_read, 10)
                    ).binding.bundle_id == ref.bundle_id
                    assert await asyncio.wait_for(collecting, 10) == []
                    gc.commit()
            finally:
                release.set()
                await first_read
    finally:
        event.remove(engine, "before_cursor_execute", observe_sql)


def test_durable_bundle_rejects_graph_corruption_with_consistent_content_hashes(
    postgres_bundle,
):
    import hashlib
    from app.modules.practice.score.artifact import (
        canonical_practice_artifact_bytes,
        practice_artifact_id,
    )
    from app.modules.practice.bundle.domain import calculate_bundle_id

    engine, repository, bundle, storage = postgres_bundle
    sessions = sessionmaker(engine, expire_on_commit=False)
    with sessions() as db:
        ref, _ = bind_bundle(db, storage, bundle, revision_id=repository.test_revision_id)
        row = db.get(PracticeBundleRecord, ref.id)
        value = bundle.artifact.value
        value["notes"][0]["eventId"] = "missing"
        value["artifactId"] = practice_artifact_id(value)
        data = canonical_practice_artifact_bytes(value)
        storage.put_bytes(
            key=row.artifact_object.object_key, content=data, content_type="application/json"
        )
        row.artifact_id = value["artifactId"]
        row.artifact_object.byte_size = len(data)
        row.artifact_object.sha256 = hashlib.sha256(data).hexdigest()
        row.bundle_id = calculate_bundle_id(
            row.artifact_schema_version,
            row.prepared_musicxml_object.sha256,
            row.artifact_object.sha256,
        )
        db.commit()
        with pytest.raises(ValueError, match="dangling"):
            read_verified_bundle(storage, repository.read_bound(db, repository.test_revision_id))
