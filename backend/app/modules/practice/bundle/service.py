from __future__ import annotations
from app.storage import AsyncObjectStorage

import asyncio
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.exceptions import (
    ExternalServiceException,
    ResourceNotFoundException,
    ValidationException,
)
from app.db.model_utils import require_persisted_id
from app.modules.score_access.policy import ScoreAccessPolicy, ScoreAction
from app.modules.score_assets.repository import ScoreAssetRepository
from app.modules.practice.score.piano_key import PracticeScoreInvalidError
from app.shared.constants import ErrorCode
from app.storage import ObjectStorage, object_storage
from .compiler import PracticeBundleCompiler
from .domain import AuthorizedPracticeBundle
from .repository import PracticeBundleRepository
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
        *,
        access_policy=None,
        asset_repository=None,
        storage: ObjectStorage | None = None,
        compiler: PracticeBundleCompiler | None = None,
        repository=None,
    ):
        self.access_policy = access_policy or ScoreAccessPolicy()
        self.asset_repository = asset_repository or ScoreAssetRepository()
        self.storage = storage or object_storage
        self.async_storage = AsyncObjectStorage(self.storage)
        self.compiler = compiler or PracticeBundleCompiler()
        self.repository = repository or PracticeBundleRepository(self.storage)

    async def resolve_bundle(
        self, db: AsyncSession, score_uuid: str, user_id: int, revision_uuid: str
    ):
        access = await self.access_policy.authorize(
            db, score_uuid, ScoreAction.PRACTICE, user_id=user_id, revision_uuid=revision_uuid
        )
        score_id = require_persisted_id(access.score.id, entity="score")
        revision_id = require_persisted_id(access.revision.id, entity="revision")
        bound = await self.repository.read_bound(db, revision_id)
        if bound is None:
            source = await self.asset_repository.canonical_source(db, revision_id)
            if source is None:
                raise ResourceNotFoundException("source", revision_uuid, ErrorCode.FILE_NOT_FOUND)
            try:
                canonical = await self.async_storage.read_bytes(source.stored_object.object_key)
                candidate = await asyncio.to_thread(
                    self.compiler.compile, canonical_musicxml=canonical
                )
            except PracticeScoreInvalidError as error:
                raise ValidationException(code=ErrorCode.PRACTICE_SCORE_INVALID) from error
            except Exception as error:
                raise ExternalServiceException(
                    service="practice_bundle", code=ErrorCode.PRACTICE_BUNDLE_FAILED
                ) from error

            async def reauthorize_binding_mutation():
                nonlocal access
                access = await lock_live_practice_mutation_access(
                    db,
                    self.access_policy,
                    user_id=user_id,
                    score_uuid=score_uuid,
                    revision_uuid=revision_uuid,
                )

            await reauthorize_binding_mutation()
            bound = await self.repository.get_or_create(
                db,
                candidate,
                revision_id=revision_id,
                reauthorize=reauthorize_binding_mutation,
            )
        reference, bundle = bound
        return AuthorizedPracticeBundle(
            bundle,
            reference,
            score_id,
            revision_id,
            access.score.title,
            access.score.score_uuid,
            access.revision.revision_uuid,
        )

    async def authorize_bundle_for_save(
        self, db: AsyncSession, user_id: int, score_uuid: str, revision_uuid: str, bundle_id: str
    ):
        access = await lock_live_practice_mutation_access(
            db,
            self.access_policy,
            user_id=user_id,
            score_uuid=score_uuid,
            revision_uuid=revision_uuid,
        )
        bound = await self.repository.read_bound_for_update(
            db, require_persisted_id(access.revision.id, entity="revision")
        )
        if bound is None or bound[0].bundle_id != bundle_id:
            raise ResourceNotFoundException(
                "practice_binding", bundle_id, ErrorCode.RESOURCE_NOT_FOUND
            )
        reference, bundle = bound
        return AuthorizedPracticeBundle(
            bundle,
            reference,
            require_persisted_id(access.score.id, entity="score"),
            require_persisted_id(access.revision.id, entity="revision"),
            access.score.title,
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

    async def read_bundle(
        self,
        db: AsyncSession,
        score_uuid: str,
        user_id: int,
        revision_uuid: str,
        *,
        include_notation: bool = False,
    ):
        authorized = await self.resolve_bundle(db, score_uuid, user_id, revision_uuid)
        # The request session releases read locks on close; this read commits no mutation.
        return self.bundle_read(authorized, include_notation=include_notation)
