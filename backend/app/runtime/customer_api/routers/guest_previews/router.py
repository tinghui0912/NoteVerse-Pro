from fastapi.responses import Response
from app.api.response_contracts import binary_responses
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.platform.db.dependencies import get_command_db, get_db
from app.runtime.customer_api.deps import get_current_user
from app.modules.media_storage.delivery import MediaAccessRead
from app.api.media_delivery import deliver_media_object
from app.modules.media_storage.delivery import DeliveryMode
from app.db.model_utils import require_persisted_id
from app.db.models import User
from app.runtime.customer_api.resources import get_guest_preview_service
from app.modules.guest_previews.schemas import (
    GuestPreviewCredentialIssuedRead,
    GuestPreviewSettingsRead,
    GuestPreviewRead,
)
from app.modules.guest_previews.service import GuestPreviewService


score_router = APIRouter()
preview_router = APIRouter()


@score_router.get(
    "/{score_id}/guest-preview",
    operation_id="scoreGuestPreviewSettingsGet",
    response_model=GuestPreviewSettingsRead,
)
def read_guest_preview_settings(
    score_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db, scope="function"),
    service: GuestPreviewService = Depends(get_guest_preview_service),
):
    return service.settings(db, score_id, require_persisted_id(current_user.id, entity="user"))


@score_router.post(
    "/{score_id}/guest-preview/credential",
    operation_id="scoreGuestPreviewCredentialIssue",
    response_model=GuestPreviewCredentialIssuedRead,
)
def issue_credential(
    score_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_command_db, scope="function"),
    service: GuestPreviewService = Depends(get_guest_preview_service),
):
    return service.issue_credential(
        db, score_id, require_persisted_id(current_user.id, entity="user")
    )


@score_router.delete(
    "/{score_id}/guest-preview/credential",
    operation_id="scoreGuestPreviewCredentialRevoke",
    status_code=204,
    response_class=Response,
)
def revoke_credential(
    score_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_command_db, scope="function"),
    service: GuestPreviewService = Depends(get_guest_preview_service),
):
    service.revoke_credential(db, score_id, require_persisted_id(current_user.id, entity="user"))
    return Response(status_code=204)


@score_router.post(
    "/{score_id}/guest-preview/credential/rotate",
    operation_id="scoreGuestPreviewCredentialRotate",
    response_model=GuestPreviewCredentialIssuedRead,
)
def rotate_credential(
    score_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_command_db, scope="function"),
    service: GuestPreviewService = Depends(get_guest_preview_service),
):
    return service.rotate_credential(
        db, score_id, require_persisted_id(current_user.id, entity="user")
    )


@preview_router.get("/{token}", operation_id="guestPreviewGet", response_model=GuestPreviewRead)
def read_guest_preview(
    token: str,
    db: Session = Depends(get_db, scope="function"),
    service: GuestPreviewService = Depends(get_guest_preview_service),
):
    return service.read(db, token)


@preview_router.get(
    "/{token}/render-assets/{asset_id}/view",
    response_class=Response,
    responses=binary_responses("image/*"),
    operation_id="guestPreviewPageView",
)
def view_guest_preview_page(
    token: str,
    asset_id: str,
    db: Session = Depends(get_db, scope="function"),
    service: GuestPreviewService = Depends(get_guest_preview_service),
):
    delivery = service.image(db, token, asset_id)
    response = deliver_media_object(
        service=service.delivery,
        mode=DeliveryMode.CONTROLLED_STREAM,
        target=delivery,
        attachment=False,
    )
    return response


@preview_router.get(
    "/{token}/playback",
    response_model=MediaAccessRead,
    operation_id="guestPreviewPlaybackAccessGet",
)
def get_guest_preview_playback(
    token: str,
    response: Response,
    db: Session = Depends(get_db, scope="function"),
    service: GuestPreviewService = Depends(get_guest_preview_service),
):
    delivery = service.audio(db, token)
    db.commit()
    db.close()
    response.headers["Cache-Control"] = "private, no-store"
    return service.delivery.access(delivery)
