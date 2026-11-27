"""Retention and replay serialize at each bounded page, including empty streams."""

from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from threading import Event
from time import monotonic
import pytest
import sqlalchemy as sa
from sqlalchemy.orm import Session
from alembic import command
from app.db.models import User, RealtimeChange, RealtimeStreamState
from app.shared.realtime import RealtimeChangeKind
from app.modules.realtime.publisher import publish_change
from app.modules.realtime.replay import read_page
from app.shared.time import utc_now
from tests.support.postgres_schema import postgres_schema_database
from tests.support.maintenance import configure_maintenance


@pytest.fixture
def database(monkeypatch):
    with postgres_schema_database(monkeypatch) as (engine, config):
        command.upgrade(config, "head")
        with Session(engine) as db:
            db.add_all(
                [User(id=i, email=f"stream{i}@example.test", password_hash="hash") for i in (1, 2)]
            )
            db.commit()
        yield engine


@pytest.fixture
def retention_worker(database, monkeypatch):
    return configure_maintenance(monkeypatch, database)


def publish(db, recipient, job="job"):
    return publish_change(
        db,
        recipient_user_id=recipient,
        kind=RealtimeChangeKind.IMPORT_JOBS_CHANGED,
        import_job_id=job,
    )


@pytest.fixture
def stream(database):
    with Session(database) as db:
        for job in ("a", "b"):
            publish(db, 1, job).created_at = utc_now() - timedelta(days=30)
        db.commit()
    return database


def wait_until_blocked(engine, owner, waiting):
    deadline = monotonic() + 10
    with engine.connect().execution_options(isolation_level="AUTOCOMMIT") as observer:
        while not observer.scalar(
            sa.text("SELECT :owner=ANY(pg_blocking_pids(:waiting))"),
            {"owner": owner, "waiting": waiting},
        ):
            assert monotonic() < deadline


def test_retention_waits_for_replay_page_and_next_page_reports_the_gap(
    stream, retention_worker, monkeypatch
):
    engine = stream
    ready = Event()
    pid = []

    original = retention_worker.realtime_maintenance_service.cleanup_recipient

    def cleanup_recipient(db, recipient_user_id, *, cutoff):
        pid.append(db.scalar(sa.text("SELECT pg_backend_pid()")))
        ready.set()
        return original(db, recipient_user_id, cutoff=cutoff)

    monkeypatch.setattr(
        retention_worker.realtime_maintenance_service, "cleanup_recipient", cleanup_recipient
    )

    def cleanup():
        return retention_worker.execute_realtime_maintenance()["expired_changes_deleted"]

    with ThreadPoolExecutor(max_workers=1) as pool:
        with Session(engine) as db:
            page = read_page(db, 1, 0, limit=1)
            assert page.cursor == 1 and page.has_more
            owner = db.scalar(sa.text("SELECT pg_backend_pid()"))
            pending = pool.submit(cleanup)
            assert ready.wait(10)
            wait_until_blocked(engine, owner, pid[0])
            assert not pending.done()
            db.commit()
        assert pending.result(10) == 2
    with Session(engine) as db:
        assert db.scalar(sa.select(RealtimeChange)) is None
        state = db.get(RealtimeStreamState, 1)
        assert (state.high_watermark_sequence, state.replay_floor_sequence) == (2, 2)
        gap = read_page(db, 1, page.cursor, limit=1)
        assert gap.reason == "retention_gap" and gap.cursor == 2 and gap.changes == ()
        db.commit()
        change = publish_change(
            db,
            recipient_user_id=1,
            kind=RealtimeChangeKind.IMPORT_JOBS_CHANGED,
            import_job_id="live",
        )
        sequence = change.sequence
        db.commit()
        live = read_page(db, 1, gap.cursor, limit=1)
        assert [row.sequence for row in live.changes] == [sequence] and live.reason is None


def test_retention_floor_and_deletion_roll_back_together(stream, retention_worker, monkeypatch):
    original = retention_worker.realtime_maintenance_service.cleanup_recipient

    def interrupted(db, recipient_user_id, *, cutoff):
        assert original(db, recipient_user_id, cutoff=cutoff) == 2
        raise RuntimeError("retention interrupted")

    monkeypatch.setattr(
        retention_worker.realtime_maintenance_service, "cleanup_recipient", interrupted
    )
    with pytest.raises(RuntimeError, match="retention interrupted"):
        retention_worker.execute_realtime_maintenance()
    with Session(stream) as db:
        assert db.get(RealtimeStreamState, 1).replay_floor_sequence == 0
        assert db.scalar(sa.select(sa.func.count()).select_from(RealtimeChange)) == 2


def test_retention_without_expired_rows_keeps_the_floor(stream, retention_worker):
    with Session(stream) as db:
        db.execute(sa.update(RealtimeChange).values(created_at=utc_now()))
        db.commit()
        assert retention_worker.execute_realtime_maintenance()["expired_changes_deleted"] == 0
        assert db.get(RealtimeStreamState, 1).replay_floor_sequence == 0


@pytest.mark.parametrize("first_publication", [True, False])
def test_same_recipient_changes_follow_commit_order(database, first_publication):
    baseline = 0
    if not first_publication:
        with Session(database) as db:
            baseline = publish(db, 1, "seed").sequence
            db.commit()
    ready = Event()
    pid = []

    def second():
        with Session(database) as db:
            pid.append(db.scalar(sa.text("SELECT pg_backend_pid()")))
            ready.set()
            sequence = publish(db, 1, "second").sequence
            db.commit()
            return sequence

    with ThreadPoolExecutor(max_workers=1) as pool:
        with Session(database) as db:
            first = publish(db, 1, "first")
            assert first.sequence == baseline + 1
            owner = db.scalar(sa.text("SELECT pg_backend_pid()"))
            future = pool.submit(second)
            try:
                assert ready.wait(10)
                wait_until_blocked(database, owner, pid[0])
                assert not future.done()
                db.commit()
            finally:
                db.rollback()
        assert future.result(10) == baseline + 2
    with Session(database) as db:
        page = read_page(db, 1, baseline, limit=10)
        assert [row.sequence for row in page.changes] == [baseline + 1, baseline + 2]
        assert [row.importJobId for row in page.changes] == ["first", "second"]
        assert db.get(RealtimeStreamState, 1).high_watermark_sequence == baseline + 2


def publish_independently(engine, recipient):
    with Session(engine) as db:
        db.execute(sa.text("SET LOCAL lock_timeout = '5s'"))
        sequence = publish(db, recipient).sequence
        db.commit()
        return sequence


def test_independent_recipients_publish_without_cross_stream_blocking(database):
    with ThreadPoolExecutor(max_workers=1) as pool:
        with Session(database) as first:
            assert publish(first, 1).sequence == 1
            future = pool.submit(publish_independently, database, 2)
            try:
                assert future.result(10) == 1
                with Session(database) as observer:
                    assert observer.get(RealtimeStreamState, 1) is None
                    assert observer.get(RealtimeStreamState, 2).high_watermark_sequence == 1
                first.commit()
            finally:
                first.rollback()
    with Session(database) as db:
        assert [row.sequence for row in read_page(db, 1, 0, limit=10).changes] == [1]
        assert [row.sequence for row in read_page(db, 2, 0, limit=10).changes] == [1]


def test_recipient_replay_allows_another_recipient_to_publish(stream):
    with ThreadPoolExecutor(max_workers=1) as pool:
        with Session(stream) as reader:
            assert read_page(reader, 1, 0, limit=1).has_more
            future = pool.submit(publish_independently, stream, 2)
            try:
                assert future.result(10) == 1
            finally:
                reader.rollback()


def test_recipient_retention_allows_another_recipient_to_publish(
    stream, retention_worker, monkeypatch
):
    ready, release = Event(), Event()
    original = retention_worker.realtime_maintenance_service.cleanup_recipient

    def paused(db, recipient_user_id, *, cutoff):
        count = original(db, recipient_user_id, cutoff=cutoff)
        db.expire_all()
        assert db.get(RealtimeStreamState, 1).replay_floor_sequence == 2
        assert db.scalar(sa.select(sa.func.count()).select_from(RealtimeChange)) == 0
        ready.set()
        assert release.wait(15)
        return count

    monkeypatch.setattr(retention_worker.realtime_maintenance_service, "cleanup_recipient", paused)
    with ThreadPoolExecutor(max_workers=2) as pool:
        cleaning = pool.submit(retention_worker.execute_realtime_maintenance)
        try:
            assert ready.wait(10)
            assert pool.submit(publish_independently, stream, 2).result(10) == 1
            with Session(stream) as observer:
                assert observer.get(RealtimeStreamState, 1).replay_floor_sequence == 0
                assert observer.get(RealtimeStreamState, 2).high_watermark_sequence == 1
        finally:
            release.set()
        assert cleaning.result(10) == {"expired_changes_deleted": 2}


def test_replay_uses_recipient_local_watermark(database):
    with Session(database) as db:
        for recipient, count in ((1, 3), (2, 100)):
            for _ in range(count):
                publish(db, recipient)
        db.commit()
        first = read_page(db, 1, None, limit=10)
        second = read_page(db, 2, None, limit=10)
        assert first.cursor == 3 and first.changes == ()
        assert second.cursor == 100 and second.changes == ()
        assert read_page(db, 1, 4, limit=10).reason == "cursor_out_of_range"
        assert read_page(db, 2, 4, limit=100).reason is None


def test_retention_advances_only_the_recipient_floor(database, retention_worker):
    with Session(database) as db:
        for _ in range(20):
            publish(db, 1).created_at = utc_now() - timedelta(days=30)
        for _ in range(2):
            publish(db, 2)
        db.commit()
        assert retention_worker.execute_realtime_maintenance()["expired_changes_deleted"] == 20
        db.expire_all()
        first = db.get(RealtimeStreamState, 1)
        second = db.get(RealtimeStreamState, 2)
        assert (first.high_watermark_sequence, first.replay_floor_sequence) == (20, 20)
        assert (second.high_watermark_sequence, second.replay_floor_sequence) == (2, 0)
        assert read_page(db, 1, 0, limit=10).reason == "retention_gap"
        page = read_page(db, 2, 0, limit=10)
        assert page.reason is None and [row.sequence for row in page.changes] == [1, 2]


@pytest.mark.parametrize("existing_stream", [True, False])
def test_publication_failure_rolls_back_sequence_allocation(database, monkeypatch, existing_stream):
    from app.modules.realtime import publisher

    baseline = 0
    with Session(database) as db:
        if existing_stream:
            baseline = publish(db, 1).sequence
            db.commit()
        original = publisher._notify_change

        def interrupted(db, change):
            original(db, change)
            raise RuntimeError("publication interrupted")

        with monkeypatch.context() as patch:
            patch.setattr(publisher, "_notify_change", interrupted)
            with pytest.raises(RuntimeError, match="publication interrupted"):
                publish(db, 1)
        db.rollback()
        state = db.get(RealtimeStreamState, 1)
        assert (state.high_watermark_sequence if state else 0) == baseline
        assert db.scalar(sa.select(sa.func.count()).select_from(RealtimeChange)) == baseline
        assert publish(db, 1).sequence == baseline + 1
        db.commit()


def test_retention_commits_each_recipient_independently(stream, retention_worker, monkeypatch):
    from app.db.models import SchedulerHeartbeat

    with Session(stream) as db:
        publish(db, 2).created_at = utc_now() - timedelta(days=30)
        db.commit()
    original = retention_worker.realtime_maintenance_service.cleanup_recipient

    def interrupted(db, recipient_user_id, *, cutoff):
        count = original(db, recipient_user_id, cutoff=cutoff)
        if recipient_user_id == 2:
            raise RuntimeError("second recipient interrupted")
        return count

    with monkeypatch.context() as patch:
        patch.setattr(
            retention_worker.realtime_maintenance_service, "cleanup_recipient", interrupted
        )
        with pytest.raises(RuntimeError, match="second recipient interrupted"):
            retention_worker.execute_realtime_maintenance()
    with Session(stream) as observer:
        assert observer.get(RealtimeStreamState, 1).replay_floor_sequence == 2
        assert observer.get(RealtimeStreamState, 2).replay_floor_sequence == 0
        assert list(observer.scalars(sa.select(RealtimeChange.recipient_user_id))) == [2]
        heartbeat = observer.scalar(sa.select(SchedulerHeartbeat))
        assert heartbeat.failure_count == 1 and heartbeat.success_count == 0
    assert retention_worker.execute_realtime_maintenance() == {"expired_changes_deleted": 1}
    with Session(stream) as observer:
        assert observer.get(RealtimeStreamState, 2).replay_floor_sequence == 1
        assert observer.scalar(sa.select(RealtimeChange)) is None


def test_retention_processes_a_bounded_recipient_batch(stream, retention_worker, monkeypatch):
    from app.modules.realtime import maintenance_service

    monkeypatch.setattr(maintenance_service, "RETENTION_RECIPIENT_BATCH_SIZE", 1)
    with Session(stream) as db:
        publish(db, 2).created_at = utc_now() - timedelta(days=30)
        db.commit()
        assert retention_worker.execute_realtime_maintenance()["expired_changes_deleted"] == 2
        db.expire_all()
        assert db.get(RealtimeStreamState, 1).replay_floor_sequence == 2
        assert db.get(RealtimeStreamState, 2).replay_floor_sequence == 0
        assert retention_worker.execute_realtime_maintenance()["expired_changes_deleted"] == 1
        db.expire_all()
        assert db.get(RealtimeStreamState, 2).replay_floor_sequence == 1


def test_recipient_service_leaves_commit_to_its_caller(stream):
    from app.modules.realtime.maintenance_service import RealtimeMaintenanceService

    service = RealtimeMaintenanceService()
    with Session(stream) as db:
        assert service.cleanup_recipient(db, 1, cutoff=service.retention_cutoff()) == 2
        db.rollback()
    with Session(stream) as db:
        assert db.get(RealtimeStreamState, 1).replay_floor_sequence == 0
        assert db.scalar(sa.select(sa.func.count()).select_from(RealtimeChange)) == 2
