"""Access-derived Scores and user-local folder/favorite organization."""

from datetime import timedelta
from unittest.mock import AsyncMock
import pytest
from pydantic import ValidationError
from sqlalchemy import select, func, event
from app.core.exceptions import (
    ResourceAlreadyExistsException,
    ResourceNotFoundException,
    UnauthorizedException,
)
from app.db.models import (
    Score,
    ScoreLibraryOrganization,
    ScoreLibraryFolder,
    ScoreMembership,
    ScoreInvite,
)
from app.db.models.score_access import MembershipRole, InviteStatus
from app.modules.library.schemas import (
    LibraryScoreBatchMoveRequest,
    LibraryScoreBatchFavoriteRequest,
    LibraryFolderCreateRequest,
    LibraryFolderUpdateRequest,
    LibraryView,
    LibrarySort,
    LibraryScoreRead,
)
from app.modules.library.service import LibraryService
from app.modules.library.repository import LibraryRepository
from app.utils.timezone import utc_now_naive
from tests.test_score_revision_services import (
    AsyncSessionAdapter,
    add_active_score_with_head_revision,
    score_service_session as score_service_session,
)


@pytest.fixture
def workspace(score_service_session):
    db, _ = score_service_session
    scores = [
        add_active_score_with_head_revision(
            db,
            score_id=i,
            revision_id=i + 100,
            score_uuid=name,
            revision_uuid=name + "-revision",
            title=name,
        )
        for i, name in [(10, "A"), (20, "B"), (30, "C")]
    ]
    scores[1].owner_user_id = scores[2].owner_user_id = 2
    scores[2].guest_preview_enabled = True
    scores[2].guest_preview_token = "link-only"
    member = ScoreMembership(
        score_id=20, user_id=1, role=MembershipRole.VIEWER, created_by_user_id=2
    )
    db.add(member)
    db.add(
        ScoreInvite(
            score_id=30,
            email="owner@example.com",
            role=MembershipRole.VIEWER,
            token_hash="pending-token",
            created_by_user_id=2,
            status=InviteStatus.PENDING,
        )
    )
    db.commit()
    return db, AsyncSessionAdapter(db), scores, member


async def listed(service, db, view=LibraryView.ALL, folder=None, sort=LibrarySort.NAME_ASC):
    return await service.list_scores(
        db, 1, view=view, folder_id=folder, search=None, sort=sort, page=1, page_size=100
    )


@pytest.mark.asyncio
async def test_owned_and_shared_scores_need_no_organization_row(workspace):
    sync, db, scores, member = workspace
    service = LibraryService()
    service.access_policy.authorize = AsyncMock(
        side_effect=AssertionError("list must use SQL access eligibility")
    )
    for view, expected in [
        (LibraryView.ALL, ["A", "B"]),
        (LibraryView.CREATED_BY_ME, ["A"]),
        (LibraryView.SHARED_WITH_ME, ["B"]),
        (LibraryView.FAVORITES, []),
    ]:
        rows, count = await listed(service, db, view)
        assert [r.score_id for r in rows] == expected and count == len(expected)
    rows, _ = await listed(service, db)
    assert [r.access_origin.value for r in rows] == ["OWNER", "MEMBERSHIP"]
    assert all(r.folder_id is None and not r.is_favorite for r in rows)
    assert rows[0].created_at == scores[0].created_at and rows[0].updated_at == scores[0].updated_at
    assert sync.scalar(select(func.count()).select_from(ScoreLibraryOrganization)) == 0
    for role in MembershipRole:
        member.role = role
        sync.commit()
        assert (await listed(service, db))[1] == 2


@pytest.mark.asyncio
async def test_revoked_or_deleted_scores_disappear_despite_organization(workspace):
    sync, db, scores, member = workspace
    service = LibraryService()
    folder = await service.create_folder(db, 1, LibraryFolderCreateRequest(name="Studies"))
    await service.batch_move(
        db, 1, LibraryScoreBatchMoveRequest(score_ids=["A", "B"], target_folder_id=folder.folder_id)
    )
    await service.batch_set_favorite(
        db, 1, LibraryScoreBatchFavoriteRequest(score_ids=["A", "B"], is_favorite=True)
    )
    # A persisted preference cannot make a private Score accessible.
    sync.add(ScoreLibraryOrganization(user_id=1, score_id=30, is_favorite=True))
    member.revoked_at = utc_now_naive()
    sync.commit()
    for view, selected in [
        (LibraryView.ALL, None),
        (LibraryView.FAVORITES, None),
        (LibraryView.ALL, folder.folder_id),
    ]:
        assert [r.score_id for r in (await listed(service, db, view, selected))[0]] == ["A"]
    assert (await listed(service, db, LibraryView.SHARED_WITH_ME))[1] == 0
    overview = await service.folder_overview(db, 1)
    assert (
        overview.all_count,
        overview.favorite_count,
        overview.created_by_me_count,
        overview.shared_with_me_count,
    ) == (1, 1, 1, 0)
    assert overview.folders[0].score_count == 1
    scores[0].deleted_at = utc_now_naive()
    sync.commit()
    assert (await listed(service, db))[1] == 0


@pytest.mark.asyncio
@pytest.mark.parametrize("favorite", [True, False])
async def test_organization_mutation_requires_access_and_is_atomic(workspace, favorite):
    sync, db, _, _ = workspace
    service = LibraryService()
    with pytest.raises(UnauthorizedException):
        await service.batch_set_favorite(
            db, 1, LibraryScoreBatchFavoriteRequest(score_ids=["A", "C"], is_favorite=favorite)
        )
    assert sync.scalar(select(func.count()).select_from(ScoreLibraryOrganization)) == 0
    with pytest.raises(UnauthorizedException):
        await service.batch_move(db, 1, LibraryScoreBatchMoveRequest(score_ids=["C"]))
    with pytest.raises(ResourceNotFoundException):
        await service.batch_set_favorite(
            db, 1, LibraryScoreBatchFavoriteRequest(score_ids=["absent"], is_favorite=True)
        )


@pytest.mark.asyncio
async def test_favorites_are_reversible_and_do_not_change_score_timestamps(workspace):
    sync, db, scores, _ = workspace
    service = LibraryService()
    before = [s.updated_at for s in scores]
    for favorite in [True, False]:
        assert (
            await service.batch_set_favorite(
                db,
                1,
                LibraryScoreBatchFavoriteRequest(score_ids=["B", "A", "A"], is_favorite=favorite),
            )
            == 2
        )
        assert (await listed(service, db, LibraryView.FAVORITES))[1] == (2 if favorite else 0)
        assert (await listed(service, db))[1] == 2
    assert [s.updated_at for s in scores] == before
    scores[0].updated_at = utc_now_naive() + timedelta(days=1)
    sync.commit()
    assert [r.score_id for r in (await listed(service, db, sort=LibrarySort.UPDATED_DESC))[0]] == [
        "A",
        "B",
    ]


@pytest.mark.asyncio
async def test_folders_move_owned_and_shared_scores_and_delete_only_organization(workspace):
    sync, db, scores, member = workspace
    service = LibraryService()
    a = await service.create_folder(db, 1, LibraryFolderCreateRequest(name=" Alpha "))
    b = await service.create_folder(db, 1, LibraryFolderCreateRequest(name="Beta"))
    for ids, target in [
        (["A", "B"], a.folder_id),
        (["A"], b.folder_id),
        (["B"], None),
        (["B"], b.folder_id),
    ]:
        await service.batch_move(
            db, 1, LibraryScoreBatchMoveRequest(score_ids=ids, target_folder_id=target)
        )
    assert (await listed(service, db, folder=a.folder_id))[1] == 0
    assert [r.score_id for r in (await listed(service, db, folder=b.folder_id))[0]] == ["A", "B"]
    other = await service.create_folder(db, 2, LibraryFolderCreateRequest(name="Other"))
    with pytest.raises(ResourceNotFoundException):
        await service.batch_move(
            db, 1, LibraryScoreBatchMoveRequest(score_ids=["A"], target_folder_id=other.folder_id)
        )
    folder_db_id = sync.scalar(
        select(ScoreLibraryFolder.id).where(ScoreLibraryFolder.folder_uuid == b.folder_id)
    )
    await service.delete_folder(db, 1, b.folder_id)
    sync.expire_all()
    assert sync.get(ScoreLibraryFolder, folder_db_id) is None
    rows, total = await listed(service, db)
    assert total == 2 and all(r.folder_id is None for r in rows)
    assert [s.owner_user_id for s in scores] == [1, 2, 2] and member.revoked_at is None
    assert len((await service.folder_overview(db, 1)).folders) == 1


@pytest.mark.asyncio
async def test_folder_name_uniqueness_rename_position_and_ownership(workspace):
    _, db, _, _ = workspace
    service = LibraryService()
    a = await service.create_folder(db, 1, LibraryFolderCreateRequest(name="Studies"))
    with pytest.raises(ResourceAlreadyExistsException):
        await service.create_folder(db, 1, LibraryFolderCreateRequest(name="Studies"))
    await service.create_folder(db, 2, LibraryFolderCreateRequest(name="Studies"))
    updated = await service.update_folder(
        db, 1, a.folder_id, LibraryFolderUpdateRequest(name=" Renamed ", position=3)
    )
    assert (updated.name, updated.position) == ("Renamed", 3)
    with pytest.raises(ResourceNotFoundException):
        await service.delete_folder(db, 2, a.folder_id)
    await service.delete_folder(db, 1, a.folder_id)
    assert (
        await service.create_folder(db, 1, LibraryFolderCreateRequest(name="Renamed"))
    ).folder_id != a.folder_id


@pytest.mark.asyncio
async def test_repository_access_query_count_is_independent_of_page_size(workspace):
    sync, db, _, _ = workspace
    for i in range(50):
        sync.add(Score(score_uuid=f"extra-{i}", owner_user_id=1, title=f"Extra {i}"))
    sync.commit()
    count = 0

    def observe(*args):
        nonlocal count
        count += 1

    event.listen(sync.get_bind(), "before_cursor_execute", observe)
    try:
        counts = []
        for size in [1, 50]:
            count = 0
            await LibraryRepository().list_scores(
                db,
                1,
                view=LibraryView.ALL,
                folder_id=None,
                search=None,
                sort=LibrarySort.NAME_ASC,
                page=1,
                page_size=size,
            )
            counts.append(count)
        assert counts == [2, 2]
    finally:
        event.remove(sync.get_bind(), "before_cursor_execute", observe)


def test_workspace_request_and_response_contract():
    assert set(LibraryScoreBatchMoveRequest.model_fields) == {"score_ids", "target_folder_id"}
    assert set(LibraryScoreBatchFavoriteRequest.model_fields) == {"score_ids", "is_favorite"}
    assert set(LibraryScoreRead.model_fields) == {
        "score_id",
        "access_origin",
        "folder_id",
        "title",
        "genres",
        "derived_assets",
        "metadata",
        "is_favorite",
        "created_at",
        "updated_at",
    }
    with pytest.raises(ValidationError):
        LibraryScoreBatchMoveRequest.model_validate({"score_ids": ["A"], "entry_ids": ["row"]})


@pytest.mark.asyncio
async def test_workspace_http_routes_use_current_access_and_score_identity(workspace):
    from httpx import ASGITransport, AsyncClient
    from app.api.deps import get_current_user, get_db
    from app.db.models import User
    from app.main import app

    sync, db, _, _ = workspace

    async def database():
        yield db

    async def user():
        return sync.get(User, 1)

    app.dependency_overrides[get_db] = database
    app.dependency_overrides[get_current_user] = user
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            response = await client.get("/api/v1/library/scores")
            assert response.status_code == 200, response.text
            assert {row["score_id"] for row in response.json()["data"]} == {"A", "B"}
            response = await client.post(
                "/api/v1/library/scores/batch-favorite",
                json={"score_ids": ["B"], "is_favorite": True},
            )
            assert response.status_code == 200 and response.json()["data"]["updated"] == 1
            response = await client.get("/api/v1/library/scores?view=favorites")
            assert [row["score_id"] for row in response.json()["data"]] == ["B"]
            response = await client.post(
                "/api/v1/library/scores/batch-move",
                json={"score_ids": ["C"], "target_folder_id": None},
            )
            assert response.status_code == 403
    finally:
        app.dependency_overrides.clear()
