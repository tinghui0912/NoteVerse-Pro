"""Page presentation from the catalog query and bounded asset projections."""

from sqlalchemy.orm import Session

from app.db.models.score_access import AccessOrigin
from app.db.model_utils import require_persisted_id
from app.modules.library.repository import LibraryPageRow
from app.modules.library.schemas import LibraryScoreRead
from app.modules.metadata.service import MetadataProjectionService
from app.modules.score_assets.repository import ScoreAssetRepository
from app.modules.score_assets.derived_assets import derived_asset_status, derived_assets_read
from app.score_semantics.render_profile import SCORE_PRESENTATION_RENDER_PROFILE


class LibraryReadModel:
    def __init__(self, assets: ScoreAssetRepository) -> None:
        self.assets = assets

    def score_page(
        self, db: Session, user_id: int, rows: list[LibraryPageRow]
    ) -> list[LibraryScoreRead]:
        ids = [
            require_persisted_id(head.id, entity="head revision")
            for _, _, _, _, head in rows
            if head is not None
        ]
        thumbnails, renders, audio, playback = self.assets.page_presentation_facts(
            db, ids, render_profile=SCORE_PRESENTATION_RENDER_PROFILE
        )
        assets = {
            revision_id: derived_assets_read(
                thumbnails.get(revision_id),
                derived_asset_status(
                    has_current_asset=revision_id in thumbnails,
                    outbox_status=renders.get(revision_id),
                ),
                audio.get(revision_id),
                derived_asset_status(
                    has_current_asset=revision_id in audio, outbox_status=playback.get(revision_id)
                ),
            )
            for revision_id in ids
        }
        pending = derived_assets_read(None, "pending", None, "pending")
        return [
            LibraryScoreRead(
                score_id=score.score_uuid,
                access_origin=AccessOrigin.OWNER
                if score.owner_user_id == user_id
                else AccessOrigin.MEMBERSHIP,
                folder_id=folder_uuid,
                display_title=score.display_title,
                genres=score.genres,
                derived_assets=assets[require_persisted_id(head.id, entity="head revision")]
                if head
                else pending,
                metadata=MetadataProjectionService.to_read(head, projection)
                if head and projection
                else None,
                is_favorite=organization.is_favorite if organization else False,
                created_at=score.created_at,
                updated_at=score.updated_at,
            )
            for score, organization, projection, folder_uuid, head in rows
        ]
