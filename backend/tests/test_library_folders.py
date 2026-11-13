from app.utils.timezone import utc_now_naive
from datetime import datetime
from uuid import uuid4

import pytest
from pydantic import ValidationError

from app.core.exceptions import ResourceAlreadyExistsException, ResourceNotFoundException
from app.db.models import (
    LibraryEntrySourceType,
    Score,
    ScoreLibraryEntry,
    ScoreLibraryFolder,
)
from app.modules.library.schemas import (
    FolderDeleteMode,
    LibraryEntryBatchMoveRequest,
    LibraryFolderCreateRequest,
    LibraryFolderDeleteRequest,
    LibraryFolderRead,
    LibraryFolderUpdateRequest,
    LibrarySort,
    LibraryView,
)
from app.modules.library.service import LibraryService
from app.db.models import ScoreRevision
from app.db.models.score import RevisionOrigin
from tests.test_score_revision_services import (
    AsyncSessionAdapter,
    score_service_session as score_service_session,
)


def add_entry(session, *, title, folder_id=None, deleted_at=None):
    score = Score(score_uuid=str(uuid4()), owner_user_id=1, title=title)
    session.add(score)
    session.flush()
    revision = ScoreRevision(
        revision_uuid=str(uuid4()),
        score_id=score.id,
        revision_number=1,
        content_hash="a" * 64,
        origin=RevisionOrigin.IMPORT,
    )
    session.add(revision)
    session.flush()
    score.head_revision_id = revision.id
    entry = ScoreLibraryEntry(
        user_id=1,
        score_id=score.id,
        source_type=LibraryEntrySourceType.SELF_ADDED,
        folder_id=folder_id,
        deleted_at=deleted_at,
    )
    session.add(entry)
    session.commit()
    return entry


@pytest.mark.asyncio
async def test_folder_names_are_normalized_and_unique_per_active_user(score_service_session):
    session, _ = score_service_session
    db = AsyncSessionAdapter(session)
    service = LibraryService()
    a = await service.create_folder(db, 1, LibraryFolderCreateRequest(name=" Studies "))
    b = await service.create_folder(db, 1, LibraryFolderCreateRequest(name="Concerts"))
    assert a.name == "Studies"
    assert a.folder_id != b.folder_id
    with pytest.raises(ResourceAlreadyExistsException):
        await service.create_folder(db, 1, LibraryFolderCreateRequest(name="Studies"))
    other = await service.create_folder(db, 2, LibraryFolderCreateRequest(name="Studies"))
    assert other.folder_id != a.folder_id
    await service.delete_folder(db, 1, a.folder_id, LibraryFolderDeleteRequest())
    replacement = await service.create_folder(db, 1, LibraryFolderCreateRequest(name="Studies"))
    assert replacement.folder_id != a.folder_id
    assert {f.name for f in (await service.folder_overview(db, 1)).folders} == {
        "Concerts",
        "Studies",
    }


@pytest.mark.asyncio
async def test_folder_update_preserves_ownership_and_active_name_uniqueness(score_service_session):
    session, _ = score_service_session
    db = AsyncSessionAdapter(session)
    service = LibraryService()
    a = await service.create_folder(db, 1, LibraryFolderCreateRequest(name="Alpha"))
    b = await service.create_folder(db, 1, LibraryFolderCreateRequest(name="Beta"))
    updated = await service.update_folder(
        db, 1, a.folder_id, LibraryFolderUpdateRequest(name=" Renamed ", position=3)
    )
    assert (updated.name, updated.position) == ("Renamed", 3)
    with pytest.raises(ResourceAlreadyExistsException):
        await service.update_folder(db, 1, a.folder_id, LibraryFolderUpdateRequest(name=b.name))
    with pytest.raises(ResourceNotFoundException):
        await service.update_folder(db, 2, a.folder_id, LibraryFolderUpdateRequest(name="Other"))


@pytest.mark.parametrize("schema", [LibraryFolderCreateRequest, LibraryFolderUpdateRequest])
def test_folder_requests_admit_only_current_editable_fields(schema):
    with pytest.raises(ValidationError):
        schema.model_validate({"name": "Studies", "parent_folder_id": None})
    with pytest.raises(ValidationError):
        schema(name="   ")


def test_folder_public_contract():
    assert set(LibraryFolderCreateRequest.model_fields) == {"name"}
    assert set(LibraryFolderUpdateRequest.model_fields) == {"name", "position"}
    assert set(LibraryFolderRead.model_fields) == {
        "folder_id",
        "name",
        "position",
        "score_count",
        "created_at",
        "updated_at",
    }
    assert LibraryFolderDeleteRequest().mode == FolderDeleteMode.MOVE_CONTENTS_TO_ROOT


@pytest.mark.asyncio
async def test_overview_counts_and_entry_queries_use_the_selected_folder(score_service_session):
    session, _ = score_service_session
    db = AsyncSessionAdapter(session)
    service = LibraryService()
    a = ScoreLibraryFolder(user_id=1, name="Alpha", position=1)
    b = ScoreLibraryFolder(user_id=1, name="Beta", position=1)
    c = ScoreLibraryFolder(user_id=1, name="Concerts", position=0)
    session.add_all([b, a, c])
    session.commit()
    active = add_entry(session, title="Alpha score", folder_id=a.id)
    add_entry(session, title="Beta score", folder_id=b.id)
    add_entry(session, title="Unfiled")
    add_entry(session, title="Trashed", folder_id=a.id, deleted_at=datetime(2026, 1, 1))
    inactive = add_entry(session, title="Deleted score", folder_id=a.id)
    session.get(Score, inactive.score_id).deleted_at = utc_now_naive()
    session.commit()
    overview = await service.folder_overview(db, 1)
    assert [(f.name, f.score_count) for f in overview.folders] == [
        ("Concerts", 0),
        ("Alpha", 1),
        ("Beta", 1),
    ]
    assert overview.all_count == 3
    result, total = await service.list_entries(
        db,
        1,
        view=LibraryView.ALL,
        folder_id=a.folder_uuid,
        search=None,
        sort=LibrarySort.NAME_ASC,
        page=1,
        page_size=20,
    )
    assert total == 1
    assert [entry.entry_id for entry in result] == [active.entry_uuid]


@pytest.mark.asyncio
async def test_entries_move_between_folders_and_library_root(score_service_session):
    session, _ = score_service_session
    db = AsyncSessionAdapter(session)
    service = LibraryService()
    a = ScoreLibraryFolder(user_id=1, name="Alpha")
    b = ScoreLibraryFolder(user_id=1, name="Beta")
    other = ScoreLibraryFolder(user_id=2, name="Other")
    session.add_all([a, b, other])
    session.commit()
    entry = add_entry(session, title="Movable", folder_id=a.id)
    for target in [b, a, None, a]:
        assert (
            await service.batch_move(
                db,
                1,
                LibraryEntryBatchMoveRequest(
                    entry_ids=[entry.entry_uuid],
                    target_folder_id=target.folder_uuid if target else None,
                ),
            )
            == 1
        )
        session.refresh(entry)
        assert entry.folder_id == (target.id if target else None)
    with pytest.raises(ResourceNotFoundException):
        await service.batch_move(
            db,
            1,
            LibraryEntryBatchMoveRequest(
                entry_ids=[entry.entry_uuid], target_folder_id=other.folder_uuid
            ),
        )


@pytest.mark.asyncio
@pytest.mark.parametrize("mode", list(FolderDeleteMode))
async def test_folder_delete_only_changes_its_active_entries(score_service_session, mode):
    session, _ = score_service_session
    db = AsyncSessionAdapter(session)
    a = ScoreLibraryFolder(user_id=1, name="Alpha")
    b = ScoreLibraryFolder(user_id=1, name="Beta")
    session.add_all([a, b])
    session.commit()
    selected = add_entry(session, title="Selected", folder_id=a.id)
    other = add_entry(session, title="Other", folder_id=b.id)
    unfiled = add_entry(session, title="Unfiled")
    previous = datetime(2026, 1, 1)
    trashed = add_entry(session, title="Trashed", folder_id=a.id, deleted_at=previous)

    await LibraryService().delete_folder(
        db, 1, a.folder_uuid, LibraryFolderDeleteRequest(mode=mode)
    )
    session.expire_all()
    assert a.deleted_at is not None
    assert b.deleted_at is None
    assert selected.deleted_at == (
        a.deleted_at if mode == FolderDeleteMode.TRASH_CONTENTS else None
    )
    assert selected.folder_id == (a.id if mode == FolderDeleteMode.TRASH_CONTENTS else None)
    assert other.folder_id == b.id and other.deleted_at is None
    assert unfiled.folder_id is None and unfiled.deleted_at is None
    assert trashed.folder_id == a.id and trashed.deleted_at == previous
