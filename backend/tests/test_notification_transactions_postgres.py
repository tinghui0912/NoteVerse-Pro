"""Notification history and browser wake-ups participate in caller transactions."""

import sqlalchemy as sa
from alembic import command
from sqlalchemy.orm import Session
from app.db.models import User, NotificationEvent, RealtimeEvent
from app.modules.notifications.service import NotificationService
from app.utils.timezone import utc_now_naive
from tests.support.postgres_schema import postgres_schema_database


def test_notification_admission_obeys_caller_commit_rollback_and_dedupe(monkeypatch):
    with postgres_schema_database(monkeypatch) as (engine, config):
        command.upgrade(config, "head")
        with Session(engine) as db:
            db.add_all(
                [User(id=i, email=f"notify{i}@example.test", password_hash="hash") for i in (1, 2)]
            )
            db.commit()
            service = NotificationService()
            now = utc_now_naive()
            fields = dict(
                recipient_user_id=1,
                actor_user_id=2,
                type="system",
                title="Notice",
                resource_type="score",
                dedupe_key="notice:1",
                created_at=now,
            )
            service.admit_event(db, **fields)
            db.rollback()
            assert db.scalar(sa.select(NotificationEvent)) is None
            assert db.scalar(sa.select(RealtimeEvent)) is None
            first = service.admit_event(db, **fields)
            assert service.admit_event(db, **fields) is first
            assert service.admit_event(db, **{**fields, "actor_user_id": 1}) is None
            db.commit()
        with Session(engine) as db:
            assert db.scalar(sa.select(NotificationEvent)).created_at == now
            assert db.scalar(sa.select(sa.func.count()).select_from(NotificationEvent)) == 1
            assert db.scalar(sa.select(sa.func.count()).select_from(RealtimeEvent)) == 1
