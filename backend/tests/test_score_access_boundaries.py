"""Score authority is independent of Revision identity; Revision access is explicit."""

import pytest
from sqlalchemy import event
from fastapi.testclient import TestClient

from app.api.deps import get_current_user, get_db
from app.core.exceptions import ResourceNotFoundException
from app.db.models import Score, ScoreMembership, ScoreRevision, User
from app.modules.revisions.domain import RevisionOrigin
from app.db.models.score_access import MembershipRole
from app.main import app
from app.modules.score_access.actions import ScoreAction
from app.modules.score_access.policy import ScoreAccessPolicy
from tests.test_score_revision_services import score_service_session as score_service_session


@pytest.mark.parametrize(
    "action,user_id",
    [
        (ScoreAction.MANAGE_MEMBERS, 1),
        (ScoreAction.MANAGE_GUEST_PREVIEWS, 1),
        (ScoreAction.DELETE, 1),
        (ScoreAction.EDIT, 1),
        (ScoreAction.VIEW, 2),
        (ScoreAction.LEAVE, 2),
    ],
)
def test_score_authorization_reads_no_revision_even_without_a_head(
    score_service_session, action, user_id
):
    db, _ = score_service_session
    db.add(Score(id=990, score_uuid="headless", owner_user_id=1, display_title="Headless"))
    db.flush()
    db.add(
        ScoreMembership(score_id=990, user_id=2, role=MembershipRole.VIEWER, created_by_user_id=1)
    )
    db.commit()
    statements = []

    def observe(_conn, _cursor, statement, *_args):
        statements.append(statement.lower())

    engine = db.get_bind()
    event.listen(engine, "before_cursor_execute", observe)
    try:
        access = ScoreAccessPolicy().authorize_score(db, "headless", action, user_id=user_id)
    finally:
        event.remove(engine, "before_cursor_execute", observe)
    assert access.score.score_uuid == "headless"
    assert statements and all("score_revisions" not in statement for statement in statements)


def test_revision_authorization_resolves_head_and_enforces_score_identity(score_service_session):
    db, _ = score_service_session
    db.add_all(
        [
            Score(id=990, score_uuid="score", owner_user_id=1, display_title="Score"),
            Score(id=991, score_uuid="other", owner_user_id=1, display_title="Other"),
        ]
    )
    db.flush()
    db.add_all(
        [
            ScoreRevision(
                id=990,
                score_id=990,
                revision_uuid="head",
                revision_number=1,
                content_hash="a" * 64,
                origin=RevisionOrigin.EDIT,
            ),
            ScoreRevision(
                id=991,
                score_id=991,
                revision_uuid="foreign",
                revision_number=1,
                content_hash="b" * 64,
                origin=RevisionOrigin.EDIT,
            ),
        ]
    )
    db.flush()
    db.get(Score, 990).head_revision_id = 990
    db.commit()
    policy = ScoreAccessPolicy()
    assert (
        policy.authorize_revision(db, "score", ScoreAction.VIEW, user_id=1).revision.revision_uuid
        == "head"
    )
    assert policy.resolve_revision(db, "score", user_id=1, revision_uuid="head").revision.id == 990
    with pytest.raises(ResourceNotFoundException):
        policy.resolve_revision(db, "score", user_id=1, revision_uuid="foreign")


def test_member_remove_is_bodyless_idempotent_and_revoked_members_cannot_be_patched(
    score_service_session,
):
    db, _ = score_service_session
    db.add(Score(id=990, score_uuid="membership", owner_user_id=1, display_title="Membership"))
    db.flush()
    member = ScoreMembership(
        score_id=990, user_id=2, role=MembershipRole.EDITOR, created_by_user_id=1
    )
    db.add(member)
    db.commit()
    member_id = member.id
    overrides = app.dependency_overrides.copy()
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: db.get(User, 1)
    try:
        with TestClient(app) as client:
            path = f"/api/v1/scores/membership/members/{member_id}"
            first = client.delete(path)
            assert first.status_code == 204 and first.content == b""
            revoked_at = db.get(ScoreMembership, member_id).revoked_at
            second = client.delete(path)
            assert second.status_code == 204 and second.content == b""
            assert db.get(ScoreMembership, member_id).revoked_at == revoked_at
            assert client.get("/api/v1/scores/membership/members").json()["items"] == []
            assert client.patch(path, json={"role": "VIEWER"}).status_code == 422
            assert db.get(ScoreMembership, member_id).revoked_at == revoked_at
    finally:
        app.dependency_overrides.clear()
        app.dependency_overrides.update(overrides)
