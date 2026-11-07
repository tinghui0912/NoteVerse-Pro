"""Durable save admission ordering and source-independent media on PostgreSQL."""

import asyncio
from datetime import timedelta
from fractions import Fraction
from app.utils.timezone import utc_now_naive
from unittest.mock import patch

import pytest
from sqlalchemy import delete, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import ResourceNotFoundException
from app.db.models import (
    Score,
    ScoreRevision,
    PracticeBundleRecord,
    PerformanceTake,
    PerformanceTakeUploadReservation,
)
from app.modules.performance_takes.manifest_persistence import manifest_from_row
from app.modules.performance_takes.upload_reservation.service import PerformanceTakeUploadService
from app.modules.performance_takes.upload_reservation.domain import FinalizeLease
from app.modules.performance_takes.upload_reservation.persistence import (
    initialize_lifecycle,
    lifecycle_from_row,
)
from app.modules.practice.bundle.retention import practice_bundle_retention
from app.modules.scores.lifecycle_service import ScoreLifecycleService
from tests.test_upload_reservation_postgres import setup_bundle, MEDIA

pytest_plugins = ["tests.test_practice_bundle_postgres"]


async def wait_for_database_lock(observer, pid):
    async with asyncio.timeout(10):
        while not await observer.scalar(
            text("SELECT cardinality(pg_blocking_pids(:pid)) > 0"), {"pid": pid}
        ):
            await observer.commit()


@pytest.mark.asyncio
async def test_save_admission_commits_before_waiting_score_deletion(postgres_bundle):
    sessions, source, storage, request = await setup_bundle(postgres_bundle)
    service = PerformanceTakeUploadService(storage=storage, practice_bundle_service=source)
    admitted, release = asyncio.Event(), asyncio.Event()
    authorize = source.authorize_bundle_for_save

    async def hold_admission(*args, **kwargs):
        value = await authorize(*args, **kwargs)
        admitted.set()
        await release.wait()
        return value

    with patch.object(source, "authorize_bundle_for_save", side_effect=hold_admission):
        async with sessions() as a, sessions() as b, sessions() as observer:
            pid = await b.scalar(text("SELECT pg_backend_pid()"))
            reserve = asyncio.create_task(service.reserve_upload(a, 1, request))
            await asyncio.wait_for(admitted.wait(), 10)
            deletion = asyncio.create_task(
                ScoreLifecycleService().delete_score(b, postgres_bundle[1].test_score_uuid, 1)
            )
            try:
                await wait_for_database_lock(observer, pid)
                assert not deletion.done()
            finally:
                release.set()
            result = await asyncio.wait_for(reserve, 10)
            await asyncio.wait_for(deletion, 10)
            row = await service.repository.get_reservation_by_uuid(a, 1, result.reservation_id)
            assert row.manifest.practice_bundle_id == request.practice_binding.bundle_id
            assert row.manifest.practice_score_uuid == postgres_bundle[1].test_score_uuid
            assert row.manifest.practice_revision_uuid == postgres_bundle[1].test_revision_uuid
            assert row.manifest.practice_artifact_id == postgres_bundle[2].artifact.artifact_id
            assert row.manifest.score_title_snapshot == "Source"
            score = await b.scalar(select(Score))
            assert score.deletion_status.value == "DELETING"


@pytest.mark.asyncio
async def test_score_deletion_commit_denies_waiting_new_save(postgres_bundle):
    sessions, source, storage, request = await setup_bundle(postgres_bundle)
    service = PerformanceTakeUploadService(storage=storage, practice_bundle_service=source)
    deleting, release = asyncio.Event(), asyncio.Event()

    class DeletionTransaction(AsyncSession):
        async def commit(self):
            deleting.set()
            await release.wait()
            await super().commit()

    async with (
        DeletionTransaction(postgres_bundle[0], expire_on_commit=False) as a,
        sessions() as b,
        sessions() as observer,
    ):
        deletion = asyncio.create_task(
            ScoreLifecycleService().delete_score(a, postgres_bundle[1].test_score_uuid, 1)
        )
        await asyncio.wait_for(deleting.wait(), 10)
        pid = await b.scalar(text("SELECT pg_backend_pid()"))
        reserve = asyncio.create_task(service.reserve_upload(b, 1, request))
        try:
            await wait_for_database_lock(observer, pid)
            assert not reserve.done()
        finally:
            release.set()
        await asyncio.wait_for(deletion, 10)
        with pytest.raises(ResourceNotFoundException):
            await asyncio.wait_for(reserve, 10)
        await b.rollback()
        assert await b.scalar(select(PerformanceTakeUploadReservation)) is None


@pytest.mark.asyncio
@pytest.mark.parametrize("postgres_bundle", ["durable-practice-score.musicxml"], indirect=True)
async def test_snapshot_replay_finalize_and_take_reads_survive_bundle_gc(postgres_bundle):
    sessions, source, storage, request = await setup_bundle(postgres_bundle)
    service = PerformanceTakeUploadService(storage=storage, practice_bundle_service=source)
    async with sessions() as db:
        accepted = await service.reserve_upload(db, 1, request)
        row = await service.repository.get_reservation_by_uuid(db, 1, accepted.reservation_id)
        snapshot = manifest_from_row(row.manifest)
        manifest_id = row.manifest_id
        assert snapshot.snapshot.score_timebase.ticks_per_quarter == 60
        assert Fraction(
            snapshot.snapshot.scope.start_tick, snapshot.snapshot.score_timebase.ticks_per_quarter
        ) == Fraction(1, 2)
        assert Fraction(
            snapshot.snapshot.tempo_plan.model_dump(mode="json")["segments"][-1]["startTick"], 60
        ) == Fraction(113, 60)
        storage.put_bytes(key=row.staging_object_key, content=MEDIA, content_type="audio/webm")
        score = await db.scalar(select(Score))
        score.title = "Title after admission"
        await db.commit()
        await ScoreLifecycleService().delete_score(db, score.score_uuid, 1)
        score.head_revision_id = None
        await db.flush()
        await db.execute(delete(ScoreRevision))
        await db.execute(delete(Score))
        await db.commit()
        due = await db.run_sync(
            lambda sync: practice_bundle_retention.collect_unowned_ready(
                sync,
            )
        )
        assert len(due) == 2
        from tests.support.retirement import drain_retirements

        results = await db.run_sync(lambda sync: drain_retirements(sync, storage))
        assert all(result["status"] == "completed" for result in results)
        await db.commit()
        assert await db.scalar(select(PracticeBundleRecord)) is None
        await db.commit()

        with (
            patch(
                "app.modules.performance_takes.upload_reservation.service.resolve_practice_score_plan",
                side_effect=AssertionError("Manifest finalization does not plan"),
            ),
            patch.object(
                source,
                "authorize_bundle_for_save",
                side_effect=AssertionError("Committed metadata is self-contained"),
            ),
            patch.object(
                source.repository,
                "read_by_bundle_id",
                side_effect=AssertionError("No source read after admission"),
            ),
        ):
            replay = await service.reserve_upload(db, 1, request)
            assert replay.reservation_id == accepted.reservation_id
            assert replay.manifest == accepted.manifest
            assert replay.manifest.score_timebase == accepted.manifest.score_timebase
            assert replay.manifest.score_timebase.ticks_per_quarter == 60
            assert replay.manifest.scope == accepted.manifest.scope
            assert replay.manifest.tempo_plan == accepted.manifest.tempo_plan
            take = await service.finalize_take(db, 1, accepted.reservation_id)
            completed = await service.reserve_upload(db, 1, request)
            assert completed.take == take
            assert row.manifest_id == manifest_id
            assert manifest_from_row(row.manifest) == snapshot
            assert take.manifest == snapshot.snapshot
            assert (
                take.manifest.score_timebase.ticks_per_quarter
                == snapshot.snapshot.score_timebase.ticks_per_quarter
            )
            assert take.manifest.scope.start_tick == snapshot.snapshot.scope.start_tick
            assert take.manifest.scope.terminal_tick == snapshot.snapshot.scope.terminal_tick
            assert take.manifest.tempo_plan.model_dump(
                mode="json"
            ) == snapshot.snapshot.tempo_plan.model_dump(mode="json")
            assert (
                take.manifest.practice_binding.bundle_id
                == snapshot.snapshot.practice_binding.bundle_id
            )
            assert take.manifest.score_title_snapshot == snapshot.snapshot.score_title_snapshot
            assert take.linked_score_id is None and not take.can_open_score
            listed = await service.takes.list_takes(db, 1)
            assert listed.items == [take]
            assert await service.takes.get_take(db, 1, take.take_id) == take
            key, filename, mime = await service.takes.get_media_delivery(db, 1, take.take_id)
            assert (
                storage.read_bytes(key) == MEDIA
                and filename.endswith("webm")
                and mime == "audio/webm"
            )
            stored = await db.scalar(select(PerformanceTake))
            assert stored.manifest_id == manifest_id
            assert manifest_from_row(stored.manifest) == snapshot


@pytest.mark.parametrize("status", ["RESERVED", "FINALIZING", "COMPLETED"])
@pytest.mark.asyncio
async def test_revision_only_retention_with_existing_reservation_or_take(postgres_bundle, status):
    sessions, source, storage, request = await setup_bundle(postgres_bundle)
    service = PerformanceTakeUploadService(storage=storage, practice_bundle_service=source)
    async with sessions() as db:
        accepted = await service.reserve_upload(db, 1, request)
        row = await service.repository.get_reservation_by_uuid(db, 1, accepted.reservation_id)
        if status == "COMPLETED":
            storage.put_bytes(key=row.staging_object_key, content=MEDIA, content_type="audio/webm")
            await service.finalize_take(db, 1, accepted.reservation_id)
        elif status == "FINALIZING":
            now = utc_now_naive()
            initialize_lifecycle(
                row,
                lifecycle_from_row(row)
                .begin_finalize(
                    lease=FinalizeLease("token", "candidate", now + timedelta(minutes=10)),
                    now=now,
                )
                .after,
            )
            await db.commit()
        source_row = await db.scalar(select(PracticeBundleRecord))
        assert (
            await db.run_sync(
                lambda sync: practice_bundle_retention.collect_unowned_ready(
                    sync,
                )
            )
            == []
        )
        score = await db.scalar(select(Score))
        score.head_revision_id = None
        await db.flush()
        await db.execute(delete(ScoreRevision))
        await db.commit()
        due = await db.run_sync(
            lambda sync: practice_bundle_retention.collect_unowned_ready(
                sync,
            )
        )
        assert len(due) == 2
        assert await db.get(PracticeBundleRecord, source_row.id) is None
        assert row.manifest.practice_bundle_id == request.practice_binding.bundle_id
        assert row.status == status
        if status == "COMPLETED":
            take = await db.scalar(select(PerformanceTake))
            assert take.manifest.practice_bundle_id == row.manifest.practice_bundle_id
        await db.commit()
        from tests.support.retirement import drain_retirements

        results = await db.run_sync(lambda sync: drain_retirements(sync, storage))
        assert all(result["status"] == "completed" for result in results)
        await db.commit()
        assert await db.scalar(select(PracticeBundleRecord)) is None
        await db.refresh(row)
        assert (
            row.manifest.practice_bundle_id == request.practice_binding.bundle_id
            and row.status == status
        )
        if status == "COMPLETED":
            retained = await service.takes.get_take(db, 1, take.manifest.take_uuid)
            assert (
                retained.manifest.practice_binding.bundle_id == request.practice_binding.bundle_id
            )
            assert (await service.takes.list_takes(db, 1)).items == [retained]
            key, _, _ = await service.takes.get_media_delivery(db, 1, take.manifest.take_uuid)
            assert storage.read_bytes(key) == MEDIA


@pytest.mark.asyncio
@pytest.mark.parametrize("role", ["PRACTITIONER", "EDITOR"])
async def test_save_holds_current_authorization_facts_until_commit(postgres_bundle, role):
    from sqlalchemy import update
    from app.core.exceptions import UnauthorizedException
    from app.db.models import User, ScoreMembership
    from app.db.models.score_access import MembershipRole

    sessions, source, _, request = await setup_bundle(postgres_bundle)
    async with sessions() as seed:
        user = User(
            email="practitioner@example.com", display_name="Practitioner", password_hash="test"
        )
        seed.add(user)
        await seed.flush()
        user_id = user.id
        score = await seed.scalar(select(Score))
        fact = ScoreMembership(
            score_id=score.id, user_id=user_id, role=MembershipRole(role), created_by_user_id=1
        )
        seed.add(fact)
        await seed.flush()
        fact_id = fact.id
        await seed.commit()
    async with sessions() as a, sessions() as b, sessions() as observer:
        admitted = await source.authorize_bundle_for_save(
            a,
            user_id,
            request.practice_binding.score_id,
            request.practice_binding.revision_id,
            request.practice_binding.bundle_id,
        )
        assert admitted.bundle.bundle_id == request.practice_binding.bundle_id
        pid = await b.scalar(text("SELECT pg_backend_pid()"))
        fact_model = ScoreMembership
        revocation = asyncio.create_task(
            b.execute(
                update(fact_model)
                .where(fact_model.id == fact_id)
                .values(revoked_at=utc_now_naive())
            )
        )
        try:
            await wait_for_database_lock(observer, pid)
            assert not revocation.done()
        finally:
            await a.commit()
        await asyncio.wait_for(revocation, 10)
        await b.commit()
        with pytest.raises(UnauthorizedException):
            await source.authorize_bundle_for_save(
                a,
                user_id,
                request.practice_binding.score_id,
                request.practice_binding.revision_id,
                request.practice_binding.bundle_id,
            )
