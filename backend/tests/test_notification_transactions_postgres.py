"""Semantic notification admission and read changes obey caller-owned transactions."""

import pytest
import sqlalchemy as sa
from alembic import command
from sqlalchemy.orm import Session
from app.db.models import User, Notification, RealtimeChange
from app.modules.notifications.service import NotificationService
from app.shared.time import utc_now
from tests.support.postgres_schema import postgres_schema_database


@pytest.fixture
def notifications(monkeypatch):
    with postgres_schema_database(monkeypatch) as (engine, config):
        command.upgrade(config, "head")
        with Session(engine) as db:
            db.add_all(
                [User(id=i, email=f"notify{i}@example.test", password_hash="hash") for i in (1, 2)]
            )
            db.commit()
        yield engine


def test_notification_admission_obeys_caller_commit_rollback_and_dedupe(notifications):
    engine = notifications
    with Session(engine) as db:
        service = NotificationService()
        fields = dict(
            recipient_user_id=1,
            actor_user_id=2,
            score_id="score",
            revision_id="revision",
            score_display_title="Etudes",
            created_at=utc_now(),
        )
        service.admit_score_version_created(db, **fields)
        db.rollback()
        assert (
            db.scalar(sa.select(Notification)) is None
            and db.scalar(sa.select(RealtimeChange)) is None
        )
        first = service.admit_score_version_created(db, **fields)
        assert service.admit_score_version_created(db, **fields) is first
        assert service.admit_score_version_created(db, **{**fields, "actor_user_id": 1}) is None
        db.commit()
    with Session(engine) as db:
        assert db.scalar(sa.select(Notification)).created_at == fields["created_at"]
        assert db.scalar(sa.select(sa.func.count()).select_from(Notification)) == 1
        assert db.scalar(sa.select(sa.func.count()).select_from(RealtimeChange)) == 1


def test_each_notification_kind_hydrates_a_typed_variant_and_read_preserves_semantics(
    notifications,
):
    engine = notifications
    service = NotificationService()
    now = utc_now()
    with Session(engine) as db:
        for accepted in (True, False):
            service.admit_score_invite_response(
                db,
                recipient_user_id=1,
                actor_user_id=2,
                accepted=accepted,
                invite_id="invite",
                score_id="score",
                score_display_title="Etudes",
                created_at=now,
            )
        service.admit_score_version_created(
            db,
            recipient_user_id=1,
            actor_user_id=2,
            score_id="score",
            revision_id="revision",
            score_display_title="Etudes",
            created_at=now,
        )
        service.admit_import_ready_for_review(
            db,
            recipient_user_id=1,
            import_job_id="job",
            import_display_title="Imported",
            created_at=now,
        )
        service.admit_import_failed(
            db,
            recipient_user_id=1,
            import_job_id="failed",
            import_display_title=None,
            created_at=now,
        )
        db.commit()
        page = service.list_for_user(db, 1)
        rows = page.items
        assert {row.kind for row in rows} == {
            "score_invite.accepted",
            "score_invite.declined",
            "score.version.created",
            "import.ready_for_review",
            "import.failed",
        }
        from fastapi.testclient import TestClient
        from app.platform.db.dependencies import get_db
        from app.runtime.customer_api.deps import get_current_user
        from app.runtime.customer_api.main import create_app

        application = create_app()
        application.dependency_overrides[get_db] = lambda: db
        application.dependency_overrides[get_current_user] = lambda: db.get(User, 1)
        with TestClient(application) as client:
            response = client.get("/api/v1/me/notifications")
        assert response.status_code == 200
        assert response.json() == page.model_dump(mode="json")
        for row in rows:
            before = row.model_dump()
            marked = service.mark_read(db, row.notification_id, 1).model_dump()
            assert marked["read_at"] is not None
            assert {k: v for k, v in marked.items() if k != "read_at"} == {
                k: v for k, v in before.items() if k != "read_at"
            }
        changes = list(db.scalars(sa.select(RealtimeChange)))
        assert len(changes) == 10
        assert service.mark_all_read(db, 1).count == 0
        assert db.scalar(sa.select(sa.func.count()).select_from(RealtimeChange)) == 10


def test_mark_all_read_emits_one_collection_change_only_for_an_actual_transition(notifications):
    with Session(notifications) as db:
        service = NotificationService()
        for job in ("a", "b"):
            service.admit_import_failed(
                db,
                recipient_user_id=1,
                import_job_id=job,
                import_display_title=job,
                created_at=utc_now(),
            )
        db.commit()
        assert service.mark_all_read(db, 1).count == 0
        changes = list(db.scalars(sa.select(RealtimeChange).order_by(RealtimeChange.sequence)))
        assert len(changes) == 3 and changes[-1].notification_id is None
        service.mark_all_read(db, 1)
        assert db.scalar(sa.select(sa.func.count()).select_from(RealtimeChange)) == 3


@pytest.mark.parametrize("operation", ["one", "all"])
def test_read_transition_and_change_admission_roll_back_together(
    notifications, monkeypatch, operation
):
    from app.modules.realtime import publisher

    with Session(notifications) as db:
        service = NotificationService()
        notice = service.admit_import_ready_for_review(
            db,
            recipient_user_id=1,
            import_job_id="job",
            import_display_title="Etudes",
            created_at=utc_now(),
        )
        notification_id = notice.notification_uuid
        db.commit()
        original = publisher._notify_change

        def interrupted(db, change):
            original(db, change)
            raise RuntimeError("read publication interrupted")

        monkeypatch.setattr(publisher, "_notify_change", interrupted)
        with pytest.raises(RuntimeError, match="read publication interrupted"):
            if operation == "one":
                service.mark_read(db, notification_id, 1)
            else:
                service.mark_all_read(db, 1)
        db.rollback()
        assert db.scalar(sa.select(Notification)).read_at is None
        assert db.scalar(sa.select(sa.func.count()).select_from(RealtimeChange)) == 1


def test_mark_all_read_uses_collection_scope_beyond_an_already_read_page(notifications):
    from datetime import timedelta

    now = utc_now()
    with Session(notifications) as db:
        db.add_all(
            [
                Notification(
                    recipient_user_id=1,
                    kind="import.failed",
                    import_job_id=f"job-{i}",
                    created_at=now + timedelta(seconds=i),
                    read_at=now if i >= 20 else None,
                )
                for i in range(40)
            ]
        )
        db.add(Notification(recipient_user_id=2, kind="import.failed", import_job_id="other"))
        db.commit()
        service = NotificationService()
        page = service.list_for_user(db, 1, limit=20)
        assert page.next_cursor is not None
        assert len(page.items) == 20
        assert all(row.read_at is not None for row in page.items)
        assert service.repository.unread_count(db, 1) == 20
        assert service.mark_all_read(db, 1).count == 0
        db.expire_all()
        assert service.repository.unread_count(db, 1) == 0
        assert service.repository.unread_count(db, 2) == 1
        assert all(
            row.read_at is not None
            for row in service.list_for_user(db, 1, cursor=page.next_cursor).items
        )


def test_concurrent_notification_dedupe_preserves_both_caller_transactions(notifications):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier
    from app.db.models import ScoreLibraryFolder

    barrier = Barrier(2)

    def admit(index):
        with Session(notifications, expire_on_commit=False) as db:
            db.add(ScoreLibraryFolder(user_id=1, name=f"before-{index}"))
            db.flush()
            barrier.wait(10)
            notice = NotificationService().admit_import_failed(
                db,
                recipient_user_id=1,
                import_job_id="same-job",
                import_display_title="Score",
                created_at=utc_now(),
            )
            db.add(ScoreLibraryFolder(user_id=1, name=f"after-{index}"))
            db.commit()
            return notice.notification_uuid

    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = [pool.submit(admit, i) for i in (0, 1)]
        ids = [future.result(20) for future in futures]
    assert ids[0] == ids[1]
    with Session(notifications) as db:
        assert db.scalar(sa.select(sa.func.count()).select_from(Notification)) == 1
        assert db.scalar(sa.select(sa.func.count()).select_from(RealtimeChange)) == 1
        assert sorted(db.scalars(sa.select(ScoreLibraryFolder.name))) == [
            "after-0",
            "after-1",
            "before-0",
            "before-1",
        ]


def test_notifications_without_dedupe_key_are_independent_admissions(notifications):
    from app.db.models import NotificationKind

    with Session(notifications) as db:
        service = NotificationService()
        rows = [
            service._admit(
                db,
                Notification(
                    recipient_user_id=1,
                    kind=NotificationKind.IMPORT_FAILED,
                    import_job_id="same-job",
                ),
            )
            for _ in range(2)
        ]
        assert rows[0].notification_uuid != rows[1].notification_uuid
        db.commit()
        assert db.scalar(sa.select(sa.func.count()).select_from(Notification)) == 2
        assert db.scalar(sa.select(sa.func.count()).select_from(RealtimeChange)) == 2
