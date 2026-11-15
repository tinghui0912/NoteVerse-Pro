"""Retention and replay serialize at each bounded page, including empty streams."""

from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from threading import Event
from time import monotonic
import pytest
import sqlalchemy as sa
from sqlalchemy.orm import Session
from alembic import command
from app.db.models import User, RealtimeChange, RealtimeChangeKind, RealtimeStreamState
from app.modules.realtime.publisher import publish_change
from app.modules.realtime.replay import read_page
from app.modules.realtime.maintenance_service import RealtimeMaintenanceService
from app.utils.timezone import utc_now_naive
from tests.support.postgres_schema import postgres_schema_database


@pytest.fixture
def stream(monkeypatch):
    with postgres_schema_database(monkeypatch) as (engine, config):
        command.upgrade(config, "head")
        with Session(engine) as db:
            db.add(User(id=1, email="stream@example.test", password_hash="hash"))
            db.commit()
            for job in ("a", "b"):
                row = publish_change(
                    db,
                    recipient_user_id=1,
                    kind=RealtimeChangeKind.IMPORT_JOBS_CHANGED,
                    import_job_id=job,
                )
                row.created_at = utc_now_naive() - timedelta(days=30)
            db.commit()
        yield engine


def wait_until_blocked(engine, owner, waiting):
    deadline = monotonic() + 10
    with engine.connect().execution_options(isolation_level="AUTOCOMMIT") as observer:
        while not observer.scalar(
            sa.text("SELECT :owner=ANY(pg_blocking_pids(:waiting))"),
            {"owner": owner, "waiting": waiting},
        ):
            assert monotonic() < deadline


def test_retention_waits_for_replay_page_and_next_page_reports_the_gap(stream):
    engine = stream
    ready = Event()
    pid = []

    def cleanup():
        with Session(engine) as db:
            pid.append(db.scalar(sa.text("SELECT pg_backend_pid()")))
            ready.set()
            return RealtimeMaintenanceService().cleanup_expired_changes(db)

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
        assert db.get(RealtimeStreamState, 1).replay_floor_sequence == 2
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


def test_retention_floor_and_deletion_roll_back_together(stream, monkeypatch):
    with Session(stream) as db:

        def interrupted_commit():
            db.flush()
            raise RuntimeError("retention interrupted")

        monkeypatch.setattr(db, "commit", interrupted_commit)
        with pytest.raises(RuntimeError, match="retention interrupted"):
            RealtimeMaintenanceService().cleanup_expired_changes(db)
        db.rollback()
        assert db.get(RealtimeStreamState, 1).replay_floor_sequence == 0
        assert db.scalar(sa.select(sa.func.count()).select_from(RealtimeChange)) == 2


def test_retention_without_expired_rows_keeps_the_floor(stream):
    with Session(stream) as db:
        db.execute(sa.update(RealtimeChange).values(created_at=utc_now_naive()))
        db.commit()
        assert RealtimeMaintenanceService().cleanup_expired_changes(db) == 0
        assert db.get(RealtimeStreamState, 1).replay_floor_sequence == 0


def test_change_sequence_admission_is_ordered_with_committed_watermarks(stream):
    ready = Event()
    pid = []

    def second():
        with Session(stream) as db:
            pid.append(db.scalar(sa.text("SELECT pg_backend_pid()")))
            ready.set()
            row = publish_change(
                db,
                recipient_user_id=1,
                kind=RealtimeChangeKind.IMPORT_JOBS_CHANGED,
                import_job_id="second",
            )
            sequence = row.sequence
            db.commit()
            return sequence

    with ThreadPoolExecutor(max_workers=1) as pool:
        with Session(stream) as db:
            first = publish_change(
                db,
                recipient_user_id=1,
                kind=RealtimeChangeKind.IMPORT_JOBS_CHANGED,
                import_job_id="first",
            )
            sequence = first.sequence
            owner = db.scalar(sa.text("SELECT pg_backend_pid()"))
            future = pool.submit(second)
            assert ready.wait(10)
            wait_until_blocked(stream, owner, pid[0])
            db.commit()
        assert future.result(10) > sequence
    with Session(stream) as db:
        page = read_page(db, 1, sequence, limit=10)
        assert [row.importJobId for row in page.changes] == ["second"]
