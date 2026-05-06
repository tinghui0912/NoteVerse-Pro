from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.api.deps import get_current_user, get_db
from app.shared.constants import ErrorCode
from app.core.exceptions import ResourceNotFoundException, UnauthorizedException
from app.db.models import Share, User
from app.modules.shares.service import ShareService


def get_share_service() -> ShareService:
    """Provide the share service from the shares module boundary."""
    return ShareService()


async def verify_share_ownership(
    share_token: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Share:
    """Ensure the current user owns the requested share."""
    share_result = await db.execute(select(Share).where(Share.token == share_token))
    share = share_result.scalars().first()

    if not share:
        raise ResourceNotFoundException(
            resource_type="share",
            resource_id=share_token,
            code=ErrorCode.SHARE_NOT_FOUND,
        )

    if share.owner_user_id != current_user.id:
        raise UnauthorizedException(
            code=ErrorCode.NO_DELETE_ACCESS,
            details={"share_token": share_token},
        )

    return share
