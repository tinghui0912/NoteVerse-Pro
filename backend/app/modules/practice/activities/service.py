"""One authenticated database command; musical execution remains browser-local."""

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.exceptions import ConflictException, ResourceNotFoundException
from app.db.model_utils import require_persisted_id
from app.db.models.practice_activity import PracticeActivity
from app.modules.practice.bundle.repository import PracticeBundleRepository
from app.modules.score_access.actions import ScoreAction
from app.modules.score_access.policy import ScoreAccessPolicy
from app.shared.error_codes import CustomerErrorCode
from app.shared.time import utc_now
from .schemas import PracticeActivityCreateRequest, PracticeActivityRead


class PracticeActivityService:
    def create(
        self, db: Session, user_id: int, request: PracticeActivityCreateRequest
    ) -> PracticeActivityRead:
        binding = request.practice_binding
        access = ScoreAccessPolicy().authorize_revision(
            db,
            binding.score_id,
            ScoreAction.PRACTICE,
            user_id=user_id,
            revision_uuid=binding.revision_id,
        )
        revision_id = require_persisted_id(access.revision.id, entity="revision")
        row = self._existing(db, user_id, request.client_session_id)
        if row is not None:
            self._require_exact_replay(row, revision_id, request)
        # This repository reads/locks DB binding and READY bundle rows only.
        bundle = PracticeBundleRepository().read_bound(db, revision_id)
        if bundle is None or bundle.bundle_id != binding.bundle_id:
            raise ResourceNotFoundException(
                "practice_bundle", code=CustomerErrorCode.RESOURCE_NOT_FOUND
            )
        if row is None:
            row = PracticeActivity(
                user_id=user_id,
                revision_id=revision_id,
                client_session_id=request.client_session_id,
                bundle_id=binding.bundle_id,
                mode=request.mode,
                input_source=request.input_source,
                scope_kind=request.scope.kind,
                scope_start_tick=request.scope.start_tick,
                scope_terminal_tick=request.scope.terminal_tick,
                completed_at=utc_now(),
            )
            try:
                with db.begin_nested():
                    db.add(row)
                    db.flush()
            except IntegrityError:
                existing = self._existing(db, user_id, request.client_session_id)
                if existing is None:
                    raise
                row = existing
        self._require_exact_replay(row, revision_id, request)
        result = PracticeActivityRead(activity_id=row.activity_uuid, completed_at=row.completed_at)
        return result

    @staticmethod
    def _existing(db: Session, user_id: int, client_session_id: str) -> PracticeActivity | None:
        return db.scalar(
            select(PracticeActivity)
            .where(
                PracticeActivity.user_id == user_id,
                PracticeActivity.client_session_id == client_session_id,
            )
            .execution_options(populate_existing=True)
        )

    @staticmethod
    def _require_exact_replay(
        row: PracticeActivity, revision_id: int, request: PracticeActivityCreateRequest
    ) -> None:
        if (
            row.revision_id,
            row.bundle_id,
            row.mode,
            row.input_source,
            row.scope_kind,
            row.scope_start_tick,
            row.scope_terminal_tick,
        ) != (
            revision_id,
            request.practice_binding.bundle_id,
            request.mode,
            request.input_source,
            request.scope.kind,
            request.scope.start_tick,
            request.scope.terminal_tick,
        ):
            raise ConflictException(CustomerErrorCode.PRACTICE_ACTIVITY_CONFLICT)
