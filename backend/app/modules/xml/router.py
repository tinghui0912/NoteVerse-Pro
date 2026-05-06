"""
XML editor routes under the xml module boundary.
"""
from typing import Literal

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_db
from app.shared.constants import SuccessCode
from app.db.models import User
from app.db.model_utils import require_persisted_id
from app.modules.tasks.dependencies import get_task_with_view_access
from app.modules.xml.dependencies import get_xml_service
from app.modules.xml.schemas import ConfirmRequest, FingeringRequest, XMLSaveRequest
from app.modules.xml.service import XMLService
from app.shared.responses import success_response

router = APIRouter()


@router.get("/{task_id}/xml")
async def load_xml(
    task_id: str,
    source: Literal["enhanced", "final", "current"] = "current",
    _task=Depends(get_task_with_view_access),
    db: AsyncSession = Depends(get_db),
    xml_service: XMLService = Depends(get_xml_service),
):
    result = await xml_service.load_xml(db, task_id, source=source)
    return success_response(data=result)


@router.post("/{task_id}/xml")
async def save_xml_content(
    task_id: str,
    request: XMLSaveRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    xml_service: XMLService = Depends(get_xml_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    result = await xml_service.save_xml(
        db,
        task_id,
        user_id,
        content=request.content,
        file_type=request.file_type,
        image_type=request.image_type,
        dpi=request.dpi,
    )
    return success_response(data=result, message=SuccessCode.XML_SAVED)


@router.post("/{task_id}/confirm")
async def confirm_recognition(
    task_id: str,
    request: ConfirmRequest = ConfirmRequest(),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    xml_service: XMLService = Depends(get_xml_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    result = await xml_service.confirm_recognition(db, task_id, user_id, dpi=request.dpi)
    has_images = len(result.get("final_images", [])) > 0
    message = (
        SuccessCode.RECOGNITION_CONFIRMED_WITH_IMAGES
        if has_images
        else SuccessCode.RECOGNITION_CONFIRMED
    )
    return success_response(data=result, message=message)


@router.post("/{task_id}/fingering")
async def generate_piano_fingering(
    task_id: str,
    request: FingeringRequest = FingeringRequest(),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    xml_service: XMLService = Depends(get_xml_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    result = await xml_service.generate_fingering(
        db,
        task_id,
        user_id,
        hand=request.hand,
        depth=request.depth,
    )
    return success_response(data=result, message=SuccessCode.FINGERING_GENERATED)
