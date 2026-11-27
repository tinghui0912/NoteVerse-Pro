"""Current-user leave, owner management, and explicit invitation reactivation."""

from types import SimpleNamespace

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import func, select

from app.platform.db.dependencies import get_db
from app.runtime.customer_api.deps import get_current_user
from app.core.exceptions import UnauthorizedException
from app.db.models import Score, ScoreRevision, ScoreMembership, ScoreLibraryOrganization
from app.db.models.score_access import MembershipRole
from app.runtime.customer_api.main import app
from app.modules.library.schemas import (
    LibraryView,
    LibrarySort,
    LibraryFolderCreateRequest,
    LibraryScoreBatchMoveRequest,
    LibraryScoreBatchFavoriteRequest,
)
from app.modules.library.service import LibraryService
from app.modules.score_access.actions import ScoreAction
from app.modules.score_access.policy import ScoreAccessPolicy
from app.modules.collaboration.schemas import InviteCreateRequest
from app.modules.collaboration.invitation_service import InvitationService
from app.modules.collaboration.membership_service import MembershipService
from tests.test_score_revision_services import score_service_session as score_service_session
from tests.test_trusted_collaboration import collaboration as collaboration, member_for
from app.platform.config.application import InvitationConfig
from app.runtime.customer_api.context import get_context


@pytest.mark.asyncio
@pytest.mark.parametrize("role", list(MembershipRole))
async def test_self_leave_http_revokes_each_member_role_idempotently(collaboration, role):
    session, _, score, db = collaboration
    member_for(session, role.value)
    membership = session.scalar(select(ScoreMembership))

    def database():
        yield db

    app.dependency_overrides[get_db] = database
    app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(id=2)
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            response = await client.delete(f"/api/v1/me/scores/{score.score_uuid}/membership")
            assert response.status_code == 204 and response.content == b""
            session.refresh(membership)
            revoked_at = membership.revoked_at
            assert revoked_at is not None
            for action in (
                ScoreAction.VIEW,
                ScoreAction.EDIT,
                ScoreAction.PRACTICE,
                ScoreAction.LEAVE,
            ):
                with pytest.raises(UnauthorizedException):
                    ScoreAccessPolicy().authorize_score(db, score.score_uuid, action, user_id=2)
            again = await client.delete(f"/api/v1/me/scores/{score.score_uuid}/membership")
            assert again.status_code == 204 and again.content == b""
            session.refresh(membership)
            assert membership.revoked_at == revoked_at
            assert (await client.get(f"/api/v1/scores/{score.score_uuid}")).status_code == 403
    finally:
        app.dependency_overrides.clear()
    assert session.get(Score, score.id) is not None
    assert session.scalar(select(func.count()).select_from(ScoreRevision)) == 1


@pytest.mark.asyncio
@pytest.mark.parametrize("user_id", [1, 2])
async def test_owner_and_never_member_cannot_leave_http(collaboration, user_id):
    session, _, score, db = collaboration

    def database():
        yield db

    app.dependency_overrides[get_db] = database
    app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(id=user_id)
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            assert (
                await client.delete(f"/api/v1/me/scores/{score.score_uuid}/membership")
            ).status_code == 403
    finally:
        app.dependency_overrides.clear()
    assert session.get(Score, score.id) is not None
    assert session.scalar(select(func.count()).select_from(ScoreMembership)) == 0


@pytest.mark.asyncio
async def test_leave_hides_organization_until_explicit_reinvite_acceptance(collaboration):
    session, _, score, db = collaboration
    member_for(session, "EDITOR")
    membership = session.scalar(select(ScoreMembership))
    membership_id = membership.id
    library, collaboration_service = (
        LibraryService(),
        InvitationService(
            config=InvitationConfig.model_validate(get_context().settings.model_dump())
        ),
    )
    folder = library.create_folder(db, 2, LibraryFolderCreateRequest(name="Studies"))
    library.batch_move(
        db,
        2,
        LibraryScoreBatchMoveRequest(
            score_ids=[score.score_uuid], target_folder_id=folder.folder_id
        ),
    )
    library.batch_set_favorite(
        db, 2, LibraryScoreBatchFavoriteRequest(score_ids=[score.score_uuid], is_favorite=True)
    )
    organization_id = session.scalar(select(ScoreLibraryOrganization)).id
    db.commit()

    def assert_workspace(expected):
        for view, selected_folder in [
            (LibraryView.ALL, None),
            (LibraryView.SHARED_WITH_ME, None),
            (LibraryView.FAVORITES, None),
            (LibraryView.ALL, folder.folder_id),
        ]:
            rows, count = library.list_scores(
                db,
                2,
                view=view,
                folder_id=selected_folder,
                search=None,
                sort=LibrarySort.UPDATED_DESC,
                page=1,
                page_size=20,
            )
            assert count == expected and len(rows) == expected
        overview = library.folder_overview(db, 2)
        assert (
            overview.all_count
            == overview.shared_with_me_count
            == overview.favorite_count
            == expected
        )
        assert overview.folders[0].score_count == expected

    assert_workspace(1)
    MembershipService().leave_score(db, score.score_uuid, 2)
    db.commit()
    assert_workspace(0)
    assert session.get(ScoreLibraryOrganization, organization_id).is_favorite
    assert session.get(Score, score.id) is not None

    # Owner role PATCH cannot restore access, including a direct HTTP call.
    def database():
        yield db

    app.dependency_overrides[get_db] = database
    app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(id=1)
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            response = await client.patch(
                f"/api/v1/scores/{score.score_uuid}/members/{membership_id}",
                json={"role": "VIEWER"},
            )
            assert response.status_code == 422
    finally:
        app.dependency_overrides.clear()
    session.refresh(membership)
    assert membership.revoked_at is not None and membership.role == MembershipRole.EDITOR
    assert_workspace(0)
    invite = collaboration_service.create_invite(
        db,
        score.score_uuid,
        1,
        InviteCreateRequest(email="other@example.com", role=MembershipRole.VIEWER),
    )
    db.commit()
    accepted = collaboration_service.accept_invite(db, invite.token, 2)
    db.commit()
    assert accepted.membership_id == membership_id and accepted.role == MembershipRole.EDITOR
    assert session.scalar(select(func.count()).select_from(ScoreMembership)) == 1
    assert session.get(ScoreLibraryOrganization, organization_id) is not None
    assert_workspace(1)
