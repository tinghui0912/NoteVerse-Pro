from app.modules.artifacts.render_service import RevisionRenderService
from app.modules.artifacts.service import ArtifactService


def get_artifact_service() -> ArtifactService:
    return ArtifactService()


def get_revision_render_service() -> RevisionRenderService:
    return RevisionRenderService()
