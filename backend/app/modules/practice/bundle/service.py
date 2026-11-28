from __future__ import annotations


from app.modules.practice.bundle.retention import PracticeBundleRetention

from app.modules.media_storage.write_coordinator import ObjectWriteCoordinator
from app.modules.media_storage.reads import StoredObjectReadTarget, read_admitted_bytes

from sqlalchemy.orm import Session
from app.core.exceptions import (
    ExternalServiceException,
    ResourceNotFoundException,
    ValidationException,
)
from app.db.model_utils import require_persisted_id
from app.modules.score_access.actions import ScoreAction
from app.modules.score_access.policy import ScoreAccessPolicy
from app.modules.score_assets.repository import ScoreAssetRepository
from app.modules.practice.score.piano_key import PracticeScoreInvalidError
from app.shared.error_codes import CustomerErrorCode
from .compiler import PracticeBundleCompiler
from .domain import AuthorizedPracticeBundle
from .repository import PracticeBundleRepository
from .writer import PracticeBundleWriter
from .content import read_verified_bundle
from .mutation_access import lock_live_practice_mutation_access
from app.modules.practice.score.generated.artifact_transport import PracticeScoreArtifactRead
from .schemas import (
    PracticeBundleRead,
    PracticeBundleNotationRead,
    ScoreRevisionPracticeBindingRead,
)


class PracticeBundleService:
    """Revision authorization and immutable content binding orchestration."""

    def __init__(
        self,
        retention: PracticeBundleRetention,
        *,
        access_policy=None,
        asset_repository=None,
        compiler: PracticeBundleCompiler | None = None,
        repository: PracticeBundleRepository | None = None,
        writer: PracticeBundleWriter | None = None,
        writes: ObjectWriteCoordinator,
    ) -> None:
        self.writes = writes
        self.access_policy = access_policy or ScoreAccessPolicy()
        self.asset_repository = asset_repository or ScoreAssetRepository()
        self.storage = writes.storage
        self.compiler = compiler or PracticeBundleCompiler()
        self.repository = repository or PracticeBundleRepository()
        self.writer = writer or PracticeBundleWriter(
            retention=retention, writes=writes, repository=self.repository
        )

    def resolve_bundle(self, db: Session, score_uuid: str, user_id: int, revision_uuid: str):
        access = self.access_policy.authorize_revision(
            db, score_uuid, ScoreAction.PRACTICE, user_id=user_id, revision_uuid=revision_uuid
        )
        score_id = require_persisted_id(access.score.id, entity="score")
        revision_id = require_persisted_id(access.revision.id, entity="revision")
        bound = self.repository.read_bound(db, revision_id)
        if bound is None:
            source = self.asset_repository.canonical_source(db, revision_id)
            if source is None:
                raise ResourceNotFoundException(
                    "source", revision_uuid, CustomerErrorCode.FILE_NOT_FOUND
                )
            canonical = read_admitted_bytes(
                self.storage, StoredObjectReadTarget.from_object(source.stored_object)
            )
            try:
                candidate = self.compiler.compile(canonical_musicxml=canonical)
            except PracticeScoreInvalidError as error:
                raise ValidationException(code=CustomerErrorCode.PRACTICE_SCORE_INVALID) from error
            except Exception as error:
                raise ExternalServiceException(
                    service="practice_bundle", code=CustomerErrorCode.PRACTICE_BUNDLE_FAILED
                ) from error

            def reauthorize_binding_mutation() -> None:
                nonlocal access
                access = lock_live_practice_mutation_access(
                    db,
                    self.access_policy,
                    user_id=user_id,
                    score_uuid=score_uuid,
                    revision_uuid=revision_uuid,
                )

            reauthorize_binding_mutation()
            reference, bundle = self.writer.ensure_binding(
                db,
                candidate,
                revision_id=revision_id,
                reauthorize_mutation=reauthorize_binding_mutation,
            )
        else:
            reference = self.repository.reference(bound)
            bundle = read_verified_bundle(self.storage, bound)
        return AuthorizedPracticeBundle(
            bundle,
            reference,
            score_id,
            revision_id,
            access.score.display_title,
            access.score.score_uuid,
            access.revision.revision_uuid,
        )

    def authorize_bundle_for_save(
        self, db: Session, user_id: int, score_uuid: str, revision_uuid: str, bundle_id: str
    ):
        access = lock_live_practice_mutation_access(
            db,
            self.access_policy,
            user_id=user_id,
            score_uuid=score_uuid,
            revision_uuid=revision_uuid,
        )
        bound = self.repository.read_bound_for_update(
            db, require_persisted_id(access.revision.id, entity="revision")
        )
        if bound is None or bound.bundle_id != bundle_id:
            raise ResourceNotFoundException(
                "practice_binding", bundle_id, CustomerErrorCode.RESOURCE_NOT_FOUND
            )
        reference = self.repository.reference(bound)
        bundle = read_verified_bundle(self.storage, bound)
        return AuthorizedPracticeBundle(
            bundle,
            reference,
            require_persisted_id(access.score.id, entity="score"),
            require_persisted_id(access.revision.id, entity="revision"),
            access.score.display_title,
            access.score.score_uuid,
            access.revision.revision_uuid,
        )

    @staticmethod
    def bundle_read(authorized: AuthorizedPracticeBundle, *, include_notation: bool):
        bundle = authorized.bundle
        return PracticeBundleRead(
            binding=ScoreRevisionPracticeBindingRead(
                score_id=authorized.score_uuid,
                revision_id=authorized.revision_uuid,
                bundle_id=bundle.bundle_id,
            ),
            artifact=PracticeScoreArtifactRead.model_validate(bundle.artifact.value),
            notation=PracticeBundleNotationRead(musicxml=bundle.prepared_musicxml.content)
            if include_notation
            else None,
        )

    def read_bundle(
        self,
        db: Session,
        score_uuid: str,
        user_id: int,
        revision_uuid: str,
        *,
        include_notation: bool = False,
    ):
        authorized = self.resolve_bundle(db, score_uuid, user_id, revision_uuid)
        # The request session releases read locks on close; this read commits no mutation.
        return self.bundle_read(authorized, include_notation=include_notation)
