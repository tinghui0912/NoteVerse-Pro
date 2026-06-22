from app.modules.files.service import FilesService, files_service


def get_files_service() -> FilesService:
    return files_service


__all__ = ["get_files_service"]
