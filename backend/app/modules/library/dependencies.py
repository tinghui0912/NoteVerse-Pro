from app.modules.library.service import LibraryService


def get_library_service() -> LibraryService:
    return LibraryService()
