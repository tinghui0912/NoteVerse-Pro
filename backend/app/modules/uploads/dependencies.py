from app.modules.uploads.service import UploadService, upload_service


def get_upload_service() -> UploadService:
    return upload_service


__all__ = ["get_upload_service"]
