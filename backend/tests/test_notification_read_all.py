from datetime import datetime
from unittest.mock import Mock, call

from sqlalchemy import select

from app.db.models import Notification
from app.modules.notifications.repository import NotificationRepository
from app.modules.notifications.service import NotificationService
from tests.test_score_revision_services import (
    score_service_session as score_service_session,
)


def notification(user_id: int, *, read_at: datetime | None = None) -> Notification:
    return Notification(
        recipient_user_id=user_id,
        kind="import.completed",
        import_job_id="job",
        read_at=read_at,
    )


def test_mark_all_read_updates_the_entire_owned_unread_set(score_service_session):
    session, _ = score_service_session
    previous_read_at = datetime(2026, 1, 1)
    unread = [notification(1) for _ in range(250)]
    already_read = [notification(1, read_at=previous_read_at) for _ in range(3)]
    other_user = [notification(2) for _ in range(4)]
    session.add_all([*unread, *already_read, *other_user])
    session.commit()
    unread_ids = {event.id for event in unread}
    already_read_ids = {event.id for event in already_read}
    other_ids = {event.id for event in other_user}

    db = session
    service = NotificationService()
    result = service.mark_all_read(db, 1)

    session.expire_all()
    persisted = {event.id: event for event in session.scalars(select(Notification))}
    timestamps = {persisted[event_id].read_at for event_id in unread_ids}
    assert len(unread_ids) == 250
    assert len(timestamps) == 1
    assert None not in timestamps
    assert all(persisted[event_id].read_at == previous_read_at for event_id in already_read_ids)
    assert all(persisted[event_id].read_at is None for event_id in other_ids)
    assert service.repository.unread_count(db, 1) == 0
    assert service.repository.unread_count(db, 2) == 4
    assert result.count == 0

    assert (service.mark_all_read(db, 1)).count == 0
    session.expire_all()
    assert {session.get(Notification, event_id).read_at for event_id in unread_ids} == timestamps
    assert all(
        session.get(Notification, event_id).read_at == previous_read_at
        for event_id in already_read_ids
    )
    assert service.repository.unread_count(db, 2) == 4


def test_repository_mark_all_read_reports_affected_set_size(score_service_session):
    session, _ = score_service_session
    session.add_all([notification(1), notification(1), notification(2)])
    session.commit()
    db = session
    repository = NotificationRepository()
    read_at = datetime(2026, 2, 1)

    assert repository.mark_all_read_for_user(db, 1, read_at=read_at) == 2
    db.commit()
    assert repository.mark_all_read_for_user(db, 1, read_at=read_at) == 0
    assert repository.unread_count(db, 2) == 1


def test_mark_all_read_returns_count_observed_after_commit(monkeypatch):
    now = datetime(2026, 3, 1)
    clock = Mock(return_value=now)
    monkeypatch.setattr("app.modules.notifications.service.utc_now_naive", clock)
    repository = Mock(spec=NotificationRepository)
    repository.mark_all_read_for_user = Mock(return_value=250)
    repository.unread_count = Mock(return_value=1)
    db = Mock()
    db.commit = Mock()
    calls = Mock()
    calls.attach_mock(repository.mark_all_read_for_user, "mutate")
    calls.attach_mock(db.commit, "commit")
    calls.attach_mock(repository.unread_count, "count")

    monkeypatch.setattr("app.modules.notifications.service.publish_change", Mock())
    result = NotificationService(repository).mark_all_read(db, 7)

    assert calls.mock_calls == [
        call.mutate(db, 7, read_at=now),
        call.commit(),
        call.count(db, 7),
    ]
    clock.assert_called_once_with()
    assert result.count == 1
