from fastapi import Response, APIRouter, Depends, Query

from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_db
from app.db.model_utils import require_persisted_id
from app.db.models import User
from app.modules.library.dependencies import get_library_service
from app.modules.library.schemas import (
    LibraryBatchMoveRead,
    LibraryBatchUpdateRead,
    LibraryScoreBatchMoveRequest,
    LibraryScoreBatchFavoriteRequest,
    LibraryFolderCreateRequest,
    LibraryScoreRead,
    LibraryFolderRead,
    LibraryFolderOverviewRead,
    LibraryFolderUpdateRequest,
    LibrarySort,
    LibraryView,
)
from app.modules.library.service import LibraryService
from app.shared.pagination import PageNumberPage


router = APIRouter()


@router.get(
    "/folders",
    operation_id="libraryFoldersOverviewGet",
    response_model=LibraryFolderOverviewRead,
)
def list_library_folders(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db, scope="function"),
    service: LibraryService = Depends(get_library_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    result = service.folder_overview(db, user_id)
    return result


@router.post("/folders", operation_id="libraryFoldersCreate", response_model=LibraryFolderRead)
def create_library_folder(
    request: LibraryFolderCreateRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db, scope="function"),
    service: LibraryService = Depends(get_library_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    result = service.create_folder(db, user_id, request)
    return result


@router.patch(
    "/folders/{folder_id}",
    operation_id="libraryFolderUpdate",
    response_model=LibraryFolderRead,
)
def update_library_folder(
    folder_id: str,
    request: LibraryFolderUpdateRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db, scope="function"),
    service: LibraryService = Depends(get_library_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    result = service.update_folder(db, user_id, folder_id, request)
    return result


@router.delete(
    "/folders/{folder_id}",
    operation_id="libraryFolderDelete",
    status_code=204,
    response_model=None,
    response_class=Response,
)
def delete_library_folder(
    folder_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db, scope="function"),
    service: LibraryService = Depends(get_library_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    service.delete_folder(db, user_id, folder_id)
    return Response(status_code=204)


@router.get(
    "/scores", operation_id="libraryScoresList", response_model=PageNumberPage[LibraryScoreRead]
)
def list_library_scores(
    view: LibraryView = Query(LibraryView.ALL),
    folder_id: str | None = Query(default=None),
    search: str | None = Query(default=None),
    sort: LibrarySort = Query(LibrarySort.UPDATED_DESC),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db, scope="function"),
    service: LibraryService = Depends(get_library_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    items, total = service.list_scores(
        db,
        user_id,
        view=view,
        folder_id=folder_id,
        search=search,
        sort=sort,
        page=page,
        page_size=page_size,
    )
    return PageNumberPage(items=items, page=page, page_size=page_size, total=total)


@router.post(
    "/scores/batch-move",
    operation_id="libraryScoresBatchMove",
    response_model=LibraryBatchMoveRead,
)
def batch_move_library_scores(
    request: LibraryScoreBatchMoveRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db, scope="function"),
    service: LibraryService = Depends(get_library_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    moved = service.batch_move(db, user_id, request)
    return LibraryBatchMoveRead(moved=moved)


@router.post(
    "/scores/batch-favorite",
    operation_id="libraryScoresBatchFavorite",
    response_model=LibraryBatchUpdateRead,
)
def batch_favorite_library_scores(
    request: LibraryScoreBatchFavoriteRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db, scope="function"),
    service: LibraryService = Depends(get_library_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    updated = service.batch_set_favorite(db, user_id, request)
    return LibraryBatchUpdateRead(updated=updated)
