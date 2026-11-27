"""HTTP pure-DB commands commit or roll back their complete semantic consequences."""

from contextlib import contextmanager
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.platform.db.dependencies import get_db
from app.runtime.customer_api.deps import get_current_user
from app.db.models import (
    MailOutbox,
    Notification,
    RealtimeChange,
    ScoreInvite,
    ScoreMembership,
    User,
)
from app.db.models.score_access import InviteTerminalOutcome
from app.runtime.customer_api.main import create_app
from app.modules.collaboration.invitation_service import InvitationService
from tests.test_collaboration_parent_lifecycle_postgres import parent_graph as parent_graph


@contextmanager
def command_client(engine, user_id):
    application = create_app()
    with Session(engine, autoflush=False) as db:
        application.dependency_overrides[get_db] = lambda: db
        application.dependency_overrides[get_current_user] = lambda: db.get(User, user_id)
        with TestClient(application, raise_server_exceptions=False) as client:
            yield client, db


@pytest.mark.parametrize("outcome", ["commit", "interrupt"])
def test_invite_and_mail_outbox_share_the_request_transaction(parent_graph, monkeypatch, outcome):
    engine, _ = parent_graph
    if outcome == "interrupt":
        queue_mail = InvitationService._queue_invite_email

        def interrupted(self, db, *args):
            queue_mail(self, db, *args)
            db.flush()
            assert db.scalar(select(func.count()).select_from(MailOutbox)) == 1
            raise RuntimeError("after mail admission")

        monkeypatch.setattr(InvitationService, "_queue_invite_email", interrupted)
    with (
        command_client(engine, 1) as (client, db),
        patch.object(db, "commit", wraps=db.commit) as commit,
    ):
        response = client.post(
            "/api/v1/scores/shared/invites", json={"email": "new@example.com", "role": "VIEWER"}
        )
        assert response.status_code == (200 if outcome == "commit" else 500)
        assert commit.call_count == (1 if outcome == "commit" else 0)
    with Session(engine) as db:
        assert db.scalar(select(func.count()).select_from(ScoreInvite)) == (
            2 if outcome == "commit" else 1
        )
        assert db.scalar(select(func.count()).select_from(MailOutbox)) == (
            1 if outcome == "commit" else 0
        )


@pytest.mark.parametrize("operation", ["token_accept", "pending_accept", "decline"])
@pytest.mark.parametrize("outcome", ["commit", "interrupt"])
def test_invite_actor_membership_and_notification_change_are_atomic(
    parent_graph, monkeypatch, operation, outcome
):
    from app.shared.time import utc_now

    engine, member_id = parent_graph
    revoked_at = utc_now()
    with Session(engine) as db:
        db.get(ScoreMembership, member_id).revoked_at = revoked_at
        db.commit()
    if outcome == "interrupt":
        notify = InvitationService._notify_invite_response

        def interrupted(self, db, **kwargs):
            notify(self, db, **kwargs)
            db.flush()
            assert db.scalar(select(func.count()).select_from(Notification)) == 1
            assert db.scalar(select(func.count()).select_from(RealtimeChange)) == 1
            raise RuntimeError("after notification admission")

        monkeypatch.setattr(InvitationService, "_notify_invite_response", interrupted)
    path = (
        "/api/v1/invites/token/accept"
        if operation == "token_accept"
        else f"/api/v1/me/invites/invitation/{'decline' if operation == 'decline' else 'accept'}"
    )
    with (
        command_client(engine, 2) as (client, db),
        patch.object(db, "commit", wraps=db.commit) as commit,
    ):
        assert client.post(path).status_code == (200 if outcome == "commit" else 500)
        assert commit.call_count == (1 if outcome == "commit" else 0)
    with Session(engine) as db:
        invite = db.scalar(select(ScoreInvite))
        member = db.get(ScoreMembership, member_id)
        if outcome == "commit":
            assert invite.terminal_outcome is (
                InviteTerminalOutcome.DECLINED
                if operation == "decline"
                else InviteTerminalOutcome.ACCEPTED
            )
            assert invite.terminal_at is not None and invite.terminal_actor_user_id == 2
            assert member.revoked_at == (revoked_at if operation == "decline" else None)
        else:
            assert invite.terminal_outcome is None
            assert invite.terminal_at is None and invite.terminal_actor_user_id is None
            assert member.revoked_at == revoked_at
        for model in (Notification, RealtimeChange, MailOutbox):
            assert db.scalar(select(func.count()).select_from(model)) == (
                1 if outcome == "commit" and model is not MailOutbox else 0
            )


@pytest.mark.parametrize("operation", ["create", "update"])
def test_duplicate_folder_request_rolls_back_and_same_session_accepts_the_next_command(
    parent_graph, operation
):
    from app.db.models import ScoreLibraryFolder

    engine, _ = parent_graph
    with command_client(engine, 1) as (client, db):
        first = client.post("/api/v1/library/folders", json={"name": "Studies"})
        second = client.post("/api/v1/library/folders", json={"name": "Etudes"})
        assert first.status_code == second.status_code == 200
        if operation == "create":
            failed = client.post("/api/v1/library/folders", json={"name": "Studies"})
        else:
            failed = client.patch(
                f"/api/v1/library/folders/{second.json()['folder_id']}", json={"name": "Studies"}
            )
        assert failed.status_code == 409 and failed.json()["code"] == "resource_already_exists"
        assert db.is_active
        assert client.post("/api/v1/library/folders", json={"name": "Sonatas"}).status_code == 200
    with Session(engine) as db:
        assert sorted(db.scalars(select(ScoreLibraryFolder.name))) == [
            "Etudes",
            "Sonatas",
            "Studies",
        ]


@pytest.mark.parametrize("operation", ["one", "all"])
@pytest.mark.parametrize("outcome", ["commit", "interrupt"])
def test_notification_read_and_realtime_change_share_request_commit(
    parent_graph, monkeypatch, operation, outcome
):
    from app.modules.notifications.service import NotificationService
    from app.modules.realtime import publisher
    from app.shared.time import utc_now

    engine, _ = parent_graph
    with Session(engine) as db:
        notice = NotificationService().admit_import_failed(
            db,
            recipient_user_id=1,
            import_job_id="job",
            import_display_title="Score",
            created_at=utc_now(),
        )
        notice_uuid = notice.notification_uuid
        db.commit()
    if outcome == "interrupt":
        notify = publisher._notify_change

        def interrupted(db, change):
            notify(db, change)
            raise RuntimeError("after read change admission")

        monkeypatch.setattr(publisher, "_notify_change", interrupted)
    path = (
        f"/api/v1/me/notifications/{notice_uuid}/read"
        if operation == "one"
        else "/api/v1/me/notifications/read-all"
    )
    with (
        command_client(engine, 1) as (client, db),
        patch.object(db, "commit", wraps=db.commit) as commit,
    ):
        assert client.post(path).status_code == (200 if outcome == "commit" else 500)
        assert commit.call_count == (1 if outcome == "commit" else 0)
    with Session(engine) as db:
        assert (db.scalar(select(Notification)).read_at is not None) is (outcome == "commit")
        assert db.scalar(select(func.count()).select_from(RealtimeChange)) == (
            2 if outcome == "commit" else 1
        )
