from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

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
from app.shared.constants import SuccessCode
from app.shared.responses import (
    APIResponse,
    PaginatedResponse,
    paginated_response,
    success_response,
)

router = APIRouter()


@router.get("/folders", response_model=APIResponse[LibraryFolderOverviewRead])
async def list_library_folders(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    service: LibraryService = Depends(get_library_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    result = await service.folder_overview(db, user_id)
    return success_response(data=result)


@router.post("/folders", response_model=APIResponse[LibraryFolderRead])
async def create_library_folder(
    request: LibraryFolderCreateRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    service: LibraryService = Depends(get_library_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    result = await service.create_folder(db, user_id, request)
    return success_response(data=result)


@router.patch("/folders/{folder_id}", response_model=APIResponse[LibraryFolderRead])
async def update_library_folder(
    folder_id: str,
    request: LibraryFolderUpdateRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    service: LibraryService = Depends(get_library_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    result = await service.update_folder(db, user_id, folder_id, request)
    return success_response(data=result, message=SuccessCode.UPDATE_SUCCESS)


@router.delete("/folders/{folder_id}", response_model=APIResponse[None])
async def delete_library_folder(
    folder_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    service: LibraryService = Depends(get_library_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    await service.delete_folder(db, user_id, folder_id)
    return success_response(message=SuccessCode.DELETE_SUCCESS)


@router.get("/scores", response_model=PaginatedResponse[LibraryScoreRead])
async def list_library_scores(
    view: LibraryView = Query(LibraryView.ALL),
    folder_id: str | None = Query(default=None),
    search: str | None = Query(default=None),
    sort: LibrarySort = Query(LibrarySort.UPDATED_DESC),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    service: LibraryService = Depends(get_library_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    items, total = await service.list_scores(
        db,
        user_id,
        view=view,
        folder_id=folder_id,
        search=search,
        sort=sort,
        page=page,
        page_size=page_size,
    )
    return paginated_response(items, page, page_size, total)


@router.post("/scores/batch-move", response_model=APIResponse[LibraryBatchMoveRead])
async def batch_move_library_scores(
    request: LibraryScoreBatchMoveRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    service: LibraryService = Depends(get_library_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    moved = await service.batch_move(db, user_id, request)
    return success_response(
        data=LibraryBatchMoveRead(moved=moved), message=SuccessCode.UPDATE_SUCCESS
    )


@router.post("/scores/batch-favorite", response_model=APIResponse[LibraryBatchUpdateRead])
async def batch_favorite_library_scores(
    request: LibraryScoreBatchFavoriteRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    service: LibraryService = Depends(get_library_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    updated = await service.batch_set_favorite(db, user_id, request)
    return success_response(
        data=LibraryBatchUpdateRead(updated=updated), message=SuccessCode.UPDATE_SUCCESS
    )
