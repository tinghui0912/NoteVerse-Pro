"""Durable save admission ordering and source-independent media on PostgreSQL."""

from concurrent.futures import ThreadPoolExecutor
from threading import Event
from time import monotonic, sleep
from tests.test_stored_object_retirement_postgres import assert_blocked
from datetime import timedelta
from fractions import Fraction
from app.shared.time import utc_now
from unittest.mock import patch

import pytest
from sqlalchemy import delete, select, text
from sqlalchemy.orm import Session

from app.core.exceptions import ResourceNotFoundException
from app.db.models import (
    Score,
    ScoreRevision,
    PracticeBundleRecord,
    PerformanceTake,
    PerformanceTakeUploadReservation,
)
from app.modules.performance_takes.manifest_persistence import manifest_from_row
from tests.support.take_lifecycle import TakeLifecycleServices
from app.modules.performance_takes.upload_reservation.domain import FinalizeLease
from app.modules.performance_takes.upload_reservation.persistence import (
    initialize_lifecycle,
    lifecycle_from_row,
)
from app.modules.practice.bundle.retention import practice_bundle_retention
from app.modules.scores.lifecycle_service import ScoreLifecycleService
from tests.test_upload_reservation_postgres import setup_bundle, MEDIA

pytest_plugins = ["tests.test_practice_bundle_postgres"]


def test_save_admission_commits_before_waiting_score_deletion(postgres_bundle):
    sessions, source, storage, request = setup_bundle(postgres_bundle)
    service = TakeLifecycleServices(storage=storage, practice_bundle_service=source)
    admitted, release = Event(), Event()
    authorize = source.authorize_bundle_for_save

    def hold_admission(*args, **kwargs):
        value = authorize(*args, **kwargs)
        admitted.set()
        assert release.wait(10)
        return value

    pid = []

    def reserve():
        with sessions() as db:
            return service.reserve_upload(db, 1, request)

    def delete_score():
        with sessions() as db:
            pid.append(db.scalar(text("SELECT pg_backend_pid()")))
            ScoreLifecycleService().delete_score(db, postgres_bundle[1].test_score_uuid, 1)

    with (
        patch.object(source, "authorize_bundle_for_save", side_effect=hold_admission),
        ThreadPoolExecutor(max_workers=2) as pool,
    ):
        reserving = pool.submit(reserve)
        try:
            assert admitted.wait(10)
            deletion = pool.submit(delete_score)
            deadline = monotonic() + 10
            while not pid:
                assert monotonic() < deadline
                sleep(0.01)
            assert_blocked(postgres_bundle[0], pid[0])
            assert not deletion.done()
        finally:
            release.set()
        result = reserving.result(10)
        deletion.result(10)
    with sessions() as db:
        row = service.repository.get_reservation_by_uuid(db, 1, result.reservation_id)
        snapshot = manifest_from_row(row.manifest).snapshot
        assert snapshot.practice_binding.bundle_id == request.practice_binding.bundle_id
        assert snapshot.practice_binding.score_id == postgres_bundle[1].test_score_uuid
        assert snapshot.practice_binding.revision_id == postgres_bundle[1].test_revision_uuid
        assert snapshot.artifact_id == postgres_bundle[2].artifact.artifact_id
        assert snapshot.score_title_snapshot == "Source"
        assert db.scalar(select(Score)).deleted_at is not None


def test_score_deletion_commit_denies_waiting_new_save(postgres_bundle):
    sessions, source, storage, request = setup_bundle(postgres_bundle)
    service = TakeLifecycleServices(storage=storage, practice_bundle_service=source)
    deleting, release = Event(), Event()

    class DeletionSession(Session):
        def commit(self):
            deleting.set()
            assert release.wait(10)
            super().commit()

    pid = []

    def delete_score():
        with DeletionSession(postgres_bundle[0], expire_on_commit=False) as db:
            ScoreLifecycleService().delete_score(db, postgres_bundle[1].test_score_uuid, 1)

    def reserve():
        with sessions() as db:
            pid.append(db.scalar(text("SELECT pg_backend_pid()")))
            return service.reserve_upload(db, 1, request)

    with ThreadPoolExecutor(max_workers=2) as pool:
        deletion = pool.submit(delete_score)
        try:
            assert deleting.wait(10)
            reserving = pool.submit(reserve)
            deadline = monotonic() + 10
            while not pid:
                assert monotonic() < deadline
                sleep(0.01)
            assert_blocked(postgres_bundle[0], pid[0])
            assert not reserving.done()
        finally:
            release.set()
        deletion.result(10)
        with pytest.raises(ResourceNotFoundException):
            reserving.result(10)
    with sessions() as db:
        assert db.scalar(select(PerformanceTakeUploadReservation)) is None


@pytest.mark.parametrize("postgres_bundle", ["durable-practice-score.musicxml"], indirect=True)
def test_snapshot_replay_finalize_and_take_reads_survive_bundle_gc(postgres_bundle):
    sessions, source, storage, request = setup_bundle(postgres_bundle)
    service = TakeLifecycleServices(storage=storage, practice_bundle_service=source)
    with sessions() as db:
        accepted = service.reserve_upload(db, 1, request)
        row = service.repository.get_reservation_by_uuid(db, 1, accepted.reservation_id)
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
        score = db.scalar(select(Score))
        score.title = "Title after admission"
        db.commit()
        ScoreLifecycleService().delete_score(db, score.score_uuid, 1)
        score.head_revision_id = None
        db.flush()
        db.execute(delete(ScoreRevision))
        db.execute(delete(Score))
        db.commit()
        due = practice_bundle_retention.collect_unowned_ready(db)
        assert len(due) == 2
        from tests.support.retirement import drain_retirements

        results = drain_retirements(db, storage)
        assert all(result["status"] == "completed" for result in results)
        db.commit()
        assert db.scalar(select(PracticeBundleRecord)) is None
        db.commit()

        with (
            patch(
                "app.modules.performance_takes.upload_reservation.reservation_service.resolve_practice_score_plan",
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
            replay = service.reserve_upload(db, 1, request)
            assert replay.reservation_id == accepted.reservation_id
            assert replay.manifest == accepted.manifest
            assert replay.manifest.score_timebase == accepted.manifest.score_timebase
            assert replay.manifest.score_timebase.ticks_per_quarter == 60
            assert replay.manifest.scope == accepted.manifest.scope
            assert replay.manifest.tempo_plan == accepted.manifest.tempo_plan
            take = service.finalize_take(db, 1, accepted.reservation_id)
            completed = service.reserve_upload(db, 1, request)
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
            listed = service.takes.list_takes(db, 1)
            assert listed.items == [take]
            assert service.takes.get_take(db, 1, take.take_id) == take
            key, filename, mime = service.takes.get_media_delivery(db, 1, take.take_id)
            assert (
                storage.read_bytes(key) == MEDIA
                and filename.endswith("webm")
                and mime == "audio/webm"
            )
            stored = db.scalar(select(PerformanceTake))
            assert stored.manifest_id == manifest_id
            assert manifest_from_row(stored.manifest) == snapshot


@pytest.mark.parametrize("status", ["RESERVED", "FINALIZING", "COMPLETED"])
def test_revision_only_retention_with_existing_reservation_or_take(postgres_bundle, status):
    sessions, source, storage, request = setup_bundle(postgres_bundle)
    service = TakeLifecycleServices(storage=storage, practice_bundle_service=source)
    with sessions() as db:
        accepted = service.reserve_upload(db, 1, request)
        row = service.repository.get_reservation_by_uuid(db, 1, accepted.reservation_id)
        if status == "COMPLETED":
            storage.put_bytes(key=row.staging_object_key, content=MEDIA, content_type="audio/webm")
            service.finalize_take(db, 1, accepted.reservation_id)
        elif status == "FINALIZING":
            now = utc_now()
            initialize_lifecycle(
                row,
                lifecycle_from_row(row)
                .begin_finalize(
                    lease=FinalizeLease("token", "candidate", now + timedelta(minutes=10)),
                    now=now,
                )
                .after,
            )
            db.commit()
        source_row = db.scalar(select(PracticeBundleRecord))
        assert practice_bundle_retention.collect_unowned_ready(db) == []
        score = db.scalar(select(Score))
        score.head_revision_id = None
        db.flush()
        db.execute(delete(ScoreRevision))
        db.commit()
        due = practice_bundle_retention.collect_unowned_ready(db)
        assert len(due) == 2
        assert db.get(PracticeBundleRecord, source_row.id) is None
        assert (
            manifest_from_row(row.manifest).snapshot.practice_binding.bundle_id
            == request.practice_binding.bundle_id
        )
        assert row.status == status
        if status == "COMPLETED":
            take = db.scalar(select(PerformanceTake))
            assert (
                manifest_from_row(take.manifest).snapshot.practice_binding.bundle_id
                == manifest_from_row(row.manifest).snapshot.practice_binding.bundle_id
            )
        db.commit()
        from tests.support.retirement import drain_retirements

        results = drain_retirements(db, storage)
        assert all(result["status"] == "completed" for result in results)
        db.commit()
        assert db.scalar(select(PracticeBundleRecord)) is None
        db.refresh(row)
        assert (
            manifest_from_row(row.manifest).snapshot.practice_binding.bundle_id
            == request.practice_binding.bundle_id
            and row.status == status
        )
        if status == "COMPLETED":
            retained = service.takes.get_take(db, 1, take.manifest.take_uuid)
            assert (
                retained.manifest.practice_binding.bundle_id == request.practice_binding.bundle_id
            )
            assert (service.takes.list_takes(db, 1)).items == [retained]
            key, _, _ = service.takes.get_media_delivery(db, 1, take.manifest.take_uuid)
            assert storage.read_bytes(key) == MEDIA


@pytest.mark.parametrize("role", ["PRACTITIONER", "EDITOR"])
def test_save_holds_current_authorization_facts_until_commit(postgres_bundle, role):
    from sqlalchemy import update
    from app.core.exceptions import UnauthorizedException
    from app.db.models import User, ScoreMembership
    from app.db.models.score_access import MembershipRole

    sessions, source, _, request = setup_bundle(postgres_bundle)
    with sessions() as seed:
        user = User(
            email="practitioner@example.com", display_name="Practitioner", password_hash="test"
        )
        seed.add(user)
        seed.flush()
        user_id = user.id
        score = seed.scalar(select(Score))
        fact = ScoreMembership(
            score_id=score.id, user_id=user_id, role=MembershipRole(role), created_by_user_id=1
        )
        seed.add(fact)
        seed.flush()
        fact_id = fact.id
        seed.commit()
    ready = Event()
    pid = []

    def revoke():
        with sessions() as db:
            pid.append(db.scalar(text("SELECT pg_backend_pid()")))
            ready.set()
            db.execute(
                update(ScoreMembership)
                .where(ScoreMembership.id == fact_id)
                .values(revoked_at=utc_now())
            )
            db.commit()

    with ThreadPoolExecutor(max_workers=1) as pool, sessions() as db:
        admitted = source.authorize_bundle_for_save(
            db,
            user_id,
            request.practice_binding.score_id,
            request.practice_binding.revision_id,
            request.practice_binding.bundle_id,
        )
        assert admitted.bundle.bundle_id == request.practice_binding.bundle_id
        revocation = pool.submit(revoke)
        try:
            assert ready.wait(10)
            assert_blocked(postgres_bundle[0], pid[0])
            assert not revocation.done()
        finally:
            db.commit()
        revocation.result(10)
        with pytest.raises(UnauthorizedException):
            source.authorize_bundle_for_save(
                db,
                user_id,
                request.practice_binding.score_id,
                request.practice_binding.revision_id,
                request.practice_binding.bundle_id,
            )
