from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_db
from app.db.model_utils import require_persisted_id
from app.db.models import User
from app.modules.my_scores.dependencies import get_my_scores_service
from app.modules.my_scores.schemas import MyScoresSort, MyScoresView
from app.modules.scores.service import ScoreService
from app.shared.responses import paginated_response

router = APIRouter()


@router.get("")
async def list_my_scores(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    view: MyScoresView = Query(MyScoresView.ALL),
    search: str | None = Query(default=None),
    sort: MyScoresSort = Query(MyScoresSort.UPDATED_DESC),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    service: ScoreService = Depends(get_my_scores_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    items, total = await service.list_owned(
        db,
        user_id,
        page=page,
        page_size=page_size,
        search=search,
        view=view,
        sort=sort,
    )
    return paginated_response([item.model_dump() for item in items], page, page_size, total)
