from app.modules.guest_previews.service import GuestPreviewService


def get_guest_preview_service() -> GuestPreviewService:
    return GuestPreviewService()
