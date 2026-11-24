from app.modules.score_access.queries import active_score_predicate
import re

from app.shared.time import utc_now
from app.score_semantics.render_profile import SCORE_PRESENTATION_RENDER_PROFILE
from app.modules.guest_previews.credentials import (
    issue_guest_preview_token,
    guest_preview_token_hash,
)
from app.storage import ObjectStorage
from sqlalchemy import select
from sqlalchemy.orm import Session
from app.db.model_utils import require_persisted_id

from app.core.exceptions import ResourceNotFoundException, ConflictException
from app.db.models import GuestPreviewCredential, Score, ScoreRevision, User
from app.db.models.score import RenderAssetKind
from app.modules.guest_previews.schemas import (
    GuestPreviewCredentialIssuedRead,
    GuestPreviewSettingsRead,
    GuestPreviewPageRead,
    GuestPreviewRead,
)
from app.modules.playback.delivery import PlaybackDeliveryReadModel
from app.modules.score_access.actions import ScoreAction
from app.modules.score_access.policy import ScoreAccessPolicy
from app.modules.score_assets.repository import ScoreAssetRepository
from app.modules.storage_objects.reads import StoredObjectDelivery
from app.shared.error_codes import CustomerErrorCode
from app.storage import object_storage


class GuestPreviewService:
    """Owner settings and presentation-only bearer access to the current Score head."""

    def __init__(
        self,
        *,
        storage: ObjectStorage | None = None,
        access_policy: ScoreAccessPolicy | None = None,
    ) -> None:
        self.storage = storage or object_storage
        self.access_policy = access_policy or ScoreAccessPolicy()
        self.assets = ScoreAssetRepository()
        self.playback = PlaybackDeliveryReadModel(access_policy=self.access_policy)

    def settings(self, db: Session, score_uuid: str, user_id: int) -> GuestPreviewSettingsRead:
        access = self.access_policy.authorize_score(
            db, score_uuid, ScoreAction.MANAGE_GUEST_PREVIEWS, user_id=user_id
        )
        credential = self._credential(db, require_persisted_id(access.score.id, entity="score"))
        return GuestPreviewSettingsRead(
            enabled=credential is not None, issued_at=credential.issued_at if credential else None
        )

    def _locked_score(self, db: Session, score_uuid: str, user_id: int) -> Score:
        self.access_policy.authorize_score(
            db, score_uuid, ScoreAction.MANAGE_GUEST_PREVIEWS, user_id=user_id
        )
        score = db.scalar(
            select(Score)
            .where(
                Score.score_uuid == score_uuid,
                Score.owner_user_id == user_id,
                active_score_predicate(),
            )
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        if score is None:
            raise ResourceNotFoundException("score", code=CustomerErrorCode.SCORE_NOT_FOUND)
        return score

    @staticmethod
    def _credential(
        db: Session, score_id: int, *, lock: bool = False
    ) -> GuestPreviewCredential | None:
        query = (
            select(GuestPreviewCredential)
            .where(GuestPreviewCredential.score_id == score_id)
            .execution_options(populate_existing=True)
        )
        return db.scalar(query.with_for_update() if lock else query)

    def issue_credential(
        self, db: Session, score_uuid: str, user_id: int
    ) -> GuestPreviewCredentialIssuedRead:
        score = self._locked_score(db, score_uuid, user_id)
        score_id = require_persisted_id(score.id, entity="score")
        if self._credential(db, score_id, lock=True) is not None:
            raise ConflictException(code=CustomerErrorCode.GUEST_PREVIEW_ALREADY_ENABLED)
        token = issue_guest_preview_token()
        issued_at = utc_now()
        db.add(
            GuestPreviewCredential(
                score_id=score_id, token_hash=guest_preview_token_hash(token), issued_at=issued_at
            )
        )
        db.flush()
        return GuestPreviewCredentialIssuedRead(token=token, issued_at=issued_at)

    def revoke_credential(self, db: Session, score_uuid: str, user_id: int) -> None:
        score = self._locked_score(db, score_uuid, user_id)
        credential = self._credential(db, require_persisted_id(score.id, entity="score"), lock=True)
        if credential is not None:
            db.delete(credential)
        db.flush()

    def rotate_credential(
        self, db: Session, score_uuid: str, user_id: int
    ) -> GuestPreviewCredentialIssuedRead:
        score = self._locked_score(db, score_uuid, user_id)
        credential = self._credential(db, require_persisted_id(score.id, entity="score"), lock=True)
        if credential is None:
            raise ConflictException(code=CustomerErrorCode.GUEST_PREVIEW_NOT_ENABLED)
        token = issue_guest_preview_token()
        issued_at = utc_now()
        credential.token_hash = guest_preview_token_hash(token)
        credential.issued_at = issued_at
        db.flush()
        return GuestPreviewCredentialIssuedRead(token=token, issued_at=issued_at)

    def read(self, db: Session, token: str) -> GuestPreviewRead:
        score, revision = self._authorize(db, token)
        pages = self.assets.list_render_assets(
            db,
            require_persisted_id(revision.id, entity="revision"),
            RenderAssetKind.RENDERED_PAGE,
            render_profile=SCORE_PRESENTATION_RENDER_PROFILE,
        )
        audio = self.assets.playback_asset(db, require_persisted_id(revision.id, entity="revision"))
        owner = db.get(User, score.owner_user_id)
        return GuestPreviewRead(
            display_title=score.display_title,
            shared_by=(owner.display_name or "") if owner else "",
            render_assets=[
                GuestPreviewPageRead(asset_id=a.asset_uuid, page_number=a.page_number)
                for a in pages
            ],
            audio_available=audio is not None,
        )

    def image(self, db: Session, token: str, asset_uuid: str) -> StoredObjectDelivery:
        _, revision = self._authorize(db, token)
        asset = self.assets.get_render_asset(db, asset_uuid)
        if (
            asset is None
            or asset.revision_id != revision.id
            or asset.render_profile != SCORE_PRESENTATION_RENDER_PROFILE
            or asset.kind != RenderAssetKind.RENDERED_PAGE
        ):
            raise ResourceNotFoundException("render_asset", code=CustomerErrorCode.FILE_NOT_FOUND)
        return StoredObjectDelivery.for_object(asset.stored_object, asset.filename)

    def audio(self, db: Session, token: str) -> StoredObjectDelivery:
        _, revision = self._authorize(db, token)
        return self.playback.delivery_for_revision(
            db, require_persisted_id(revision.id, entity="revision")
        )

    def _authorize(self, db: Session, token: str) -> tuple[Score, ScoreRevision]:
        if not re.fullmatch(r"[A-Za-z0-9_-]{43}", token):
            raise ResourceNotFoundException(
                "guest_preview", code=CustomerErrorCode.GUEST_PREVIEW_NOT_FOUND
            )
        score = db.scalar(
            select(Score)
            .join(GuestPreviewCredential, GuestPreviewCredential.score_id == Score.id)
            .where(
                GuestPreviewCredential.token_hash == guest_preview_token_hash(token),
                active_score_predicate(),
            )
            .execution_options(populate_existing=True)
        )
        revision = (
            db.get(ScoreRevision, score.head_revision_id)
            if score is not None and score.head_revision_id is not None
            else None
        )
        if score is None or revision is None or revision.score_id != score.id:
            raise ResourceNotFoundException(
                "guest_preview", code=CustomerErrorCode.GUEST_PREVIEW_NOT_FOUND
            )
        return score, revision
