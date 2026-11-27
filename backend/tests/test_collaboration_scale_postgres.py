"""Collaboration collection projections use a fixed number of SQL reads."""

import pytest
from sqlalchemy import event
from sqlalchemy.orm import Session

from app.db.models import Score, ScoreInvite, ScoreMembership, User
from app.db.models.score_access import InviteTerminalOutcome, MembershipRole
from app.modules.collaboration.invitation_service import InvitationService
from app.modules.collaboration.membership_service import MembershipService
from app.modules.media_storage.persistence import object_from_bytes
from app.shared.time import utc_now
from tests.test_score_revision_services import score_service_session as score_service_session


@pytest.mark.parametrize("collection", ["invites", "pending", "members"])
def test_collection_hydration_has_a_fixed_query_bound_for_one_and_one_hundred_rows(
    score_service_session, collection
):
    db, _ = score_service_session
    db.add(Score(id=900, score_uuid="collection", owner_user_id=1, display_title="Collection"))
    for index in range(100):
        for user_id in (100 + index, 500 + index):
            avatar = object_from_bytes(
                object_key=f"avatars/{user_id}", content=b"avatar", content_type="image/png"
            )
            db.add(
                User(
                    id=user_id,
                    email=f"scale-{user_id}@example.com",
                    password_hash="hash",
                    avatar_object=avatar,
                )
            )
    db.flush()
    for index in range(100):
        db.add(
            Score(
                id=1000 + index,
                score_uuid=f"pending-{index}",
                owner_user_id=100 + index,
                display_title=f"Pending {index}",
            )
        )
    db.flush()
    now = utc_now()
    for index in range(100):
        db.add(
            ScoreMembership(
                score_id=900, user_id=500 + index, role=MembershipRole.VIEWER, created_by_user_id=1
            )
        )
        db.add(
            ScoreInvite(
                score_id=900,
                token_hash=f"history-{index}",
                email=f"scale-{100 + index}@example.com",
                role=MembershipRole.VIEWER,
                created_by_user_id=1,
                terminal_outcome=InviteTerminalOutcome.DECLINED,
                terminal_actor_user_id=100 + index,
                terminal_at=now,
            )
        )
        db.add(
            ScoreInvite(
                score_id=1000 + index,
                token_hash=f"pending-{index}",
                email="other@example.com",
                role=MembershipRole.VIEWER,
                created_by_user_id=100 + index,
            )
        )
    db.commit()
    engine = db.get_bind()
    counts = []
    for limit in (1, 100):
        statements = []

        def observe(_conn, _cursor, statement, *_args):
            if statement.lstrip().lower().startswith("select"):
                statements.append(statement)

        with Session(engine) as fresh:
            event.listen(engine, "before_cursor_execute", observe)
            try:
                if collection == "invites":
                    page = InvitationService().list_invites(fresh, "collection", 1, limit=limit)
                    assert all(item.terminal_actor.avatar_url for item in page.items)
                elif collection == "pending":
                    page = InvitationService().list_my_pending_invites(fresh, 2, limit=limit)
                    assert all(item.inviter.avatar_url for item in page.items)
                else:
                    page = MembershipService().list_members(fresh, "collection", 1, limit=limit)
                    assert all(item.avatar_url for item in page.items)
            finally:
                event.remove(engine, "before_cursor_execute", observe)
            assert len(page.items) == limit
        counts.append(len(statements))
    assert counts[0] == counts[1] and 0 < counts[1] <= 6
