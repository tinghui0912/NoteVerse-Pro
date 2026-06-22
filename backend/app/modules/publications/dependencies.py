from app.modules.publications.service import PublicationService


def get_publication_service() -> PublicationService:
    return PublicationService()
