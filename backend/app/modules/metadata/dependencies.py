from app.modules.metadata.service import MetadataProjectionService


def get_metadata_service() -> MetadataProjectionService:
    return MetadataProjectionService()
