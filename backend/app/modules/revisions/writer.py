"""Single canonical revision persistence algorithm; the use case owns commit."""

from app.modules.revisions.object_keys import canonical_revision_source_object_key

from dataclasses import dataclass
from uuid import uuid4
from sqlalchemy import select
from sqlalchemy.orm import Session
from app.core.exceptions import ConflictException, ResourceNotFoundException
from app.core.async_trace_context import get_async_trace_context
from app.core.request_correlation import get_request_id
from app.db.model_utils import require_persisted_id
from app.db.models import (
    Score,
    ScoreRevision,
    ScoreRevisionSource,
    ScoreRevisionMetadata,
    ScoreRevisionEvent,
    User,
    StorageUsageCategory,
)
from app.shared.realtime import RealtimeChangeKind
from app.db.models.score import RevisionOrigin, RevisionSourceFormat, MetadataStatus
from app.db.models.revision_metadata_outbox import RevisionMetadataOutbox
from app.modules.storage_objects.writes import ObjectWriteReceipt, adopt_written_object
from app.modules.storage_usage.service import storage_usage_service
from app.composition.storage_resources import storage_quota_service
from app.db.models.storage_quota import StorageQuotaHoldStatus
from app.modules.revisions.render_admission import admit_revision_render
from app.modules.playback.outbox_service import create_playback_outbox
from app.modules.revisions.post_commit import RevisionPostCommitWork
from app.modules.realtime.publisher import score_recipients, publish_change
from app.modules.notifications.service import notification_service
from app.shared.error_codes import CustomerErrorCode
from app.score_semantics.render_profile import SCORE_PRESENTATION_RENDER_PROFILE
from app.shared.time import utc_now


@dataclass(frozen=True)
class PreparedRevisionSource:
    revision_uuid: str
    receipt: ObjectWriteReceipt
    content_hash: str
    generator: str
    generator_version: str
    quota_hold_id: int


@dataclass(frozen=True)
class InitialRevisionWrite:
    score_uuid: str
    actor_user_id: int
    source: PreparedRevisionSource
    idempotency_key: str
    origin: RevisionOrigin = RevisionOrigin.OMR


@dataclass(frozen=True)
class RestoreLineage:
    target_revision_uuid: str
    note: str | None


@dataclass(frozen=True)
class AppendRevisionWrite:
    score_uuid: str
    actor_user_id: int
    source: PreparedRevisionSource
    expected_head_uuid: str
    origin: RevisionOrigin
    idempotency_key: str | None = None
    restore: RestoreLineage | None = None


@dataclass(frozen=True)
class RevisionWriteResult:
    revision: ScoreRevision
    post_commit_work: RevisionPostCommitWork | None


class RevisionWriter:
    def write(
        self, db: Session, command: InitialRevisionWrite | AppendRevisionWrite
    ) -> RevisionWriteResult:
        score = db.scalar(
            select(Score)
            .where(Score.score_uuid == command.score_uuid)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        if score is None or score.deleted_at is not None:
            raise ResourceNotFoundException(
                "score", command.score_uuid, CustomerErrorCode.SCORE_NOT_FOUND
            )
        score_id = require_persisted_id(score.id, entity="score")
        prepared = command.source
        if (
            prepared.receipt.facts.sha256 != prepared.content_hash
            or prepared.receipt.facts.content_type != "application/vnd.recordare.musicxml+xml"
            or prepared.receipt.object_key
            != canonical_revision_source_object_key(
                score_uuid=score.score_uuid, revision_uuid=prepared.revision_uuid
            )
        ):
            raise ValueError("Prepared canonical source identity disagrees with revision")
        hold = storage_quota_service.lock_hold(db, prepared.quota_hold_id)
        if (
            hold.user_id != score.owner_user_id
            or hold.category != StorageUsageCategory.SOURCE
            or hold.bytes_held != prepared.receipt.facts.byte_size
        ):
            raise ValueError("Canonical source requires its exact quota hold")
        key = command.idempotency_key
        existing = (
            db.scalar(
                select(ScoreRevision).where(
                    ScoreRevision.score_id == score_id, ScoreRevision.idempotency_key == key
                )
            )
            if key
            else None
        )
        if existing is not None:
            return self._unused(db, prepared, existing)
        if hold.status != StorageQuotaHoldStatus.HELD:
            raise ValueError("New canonical source requires an active quota hold")
        initial = isinstance(command, InitialRevisionWrite)
        target = None
        if isinstance(command, InitialRevisionWrite):
            if (
                score.head_revision_id is not None
                or db.scalar(select(ScoreRevision.id).where(ScoreRevision.score_id == score_id))
                is not None
            ):
                raise ConflictException(CustomerErrorCode.REVISION_CONFLICT)
            number, origin = 1, command.origin
        else:
            head = self._expected_head(db, score, command.expected_head_uuid)
            if command.restore is not None:
                target = db.scalar(
                    select(ScoreRevision).where(
                        ScoreRevision.revision_uuid == command.restore.target_revision_uuid,
                        ScoreRevision.score_id == score_id,
                    )
                )
                if target is None:
                    raise ResourceNotFoundException(
                        "revision",
                        command.restore.target_revision_uuid,
                        CustomerErrorCode.REVISION_NOT_FOUND,
                    )
                if target.content_hash != prepared.content_hash:
                    raise ValueError("Restore source differs from immutable target")
            if head.content_hash == prepared.content_hash:
                return self._unused(db, prepared, head)
            number, origin = head.revision_number + 1, command.origin
        now = utc_now()
        revision = ScoreRevision(
            revision_uuid=prepared.revision_uuid,
            score_id=score_id,
            revision_number=number,
            content_hash=prepared.content_hash,
            idempotency_key=key,
            origin=origin,
            created_by_user_id=command.actor_user_id,
            created_at=now,
        )
        db.add(revision)
        db.flush()
        revision_id = require_persisted_id(revision.id, entity="revision")
        source_uuid = str(uuid4())
        db.add(
            ScoreRevisionSource(
                source_uuid=source_uuid,
                revision_id=revision_id,
                format=RevisionSourceFormat.MUSICXML,
                stored_object=adopt_written_object(db, prepared.receipt),
                filename="score.musicxml",
                generator=prepared.generator,
                generator_version=prepared.generator_version,
            )
        )
        db.add(
            ScoreRevisionMetadata(
                revision_id=revision_id, status=MetadataStatus.PENDING, extractor_version="pending"
            )
        )
        render = admit_revision_render(
            db,
            score_id=score_id,
            revision_id=revision_id,
            requested_by_user_id=command.actor_user_id,
            source_fingerprint=prepared.content_hash,
            render_profile=SCORE_PRESENTATION_RENDER_PROFILE,
        )
        playback = create_playback_outbox(
            db,
            score_id=score_id,
            revision_id=revision_id,
            requested_by_user_id=command.actor_user_id,
            source_fingerprint=prepared.content_hash,
        )
        traceparent, tracestate = get_async_trace_context()
        metadata = RevisionMetadataOutbox(
            revision_id=revision_id,
            source_fingerprint=prepared.content_hash,
            originating_request_id=get_request_id(),
            traceparent=traceparent,
            tracestate=tracestate,
        )
        db.add(metadata)
        score.head_revision_id = revision_id
        score.updated_at = now
        if isinstance(command, AppendRevisionWrite) and command.restore is not None:
            assert target is not None
            db.add(
                ScoreRevisionEvent(
                    score_id=score_id,
                    revision_id=revision_id,
                    target_revision_id=target.id,
                    actor_user_id=command.actor_user_id,
                    type="RESTORE",
                    note=(command.restore.note or "").strip() or None,
                    created_at=now,
                )
            )
        if not storage_quota_service.consume_hold(db, prepared.quota_hold_id):
            raise ValueError("New canonical source requires an unconsumed quota hold")
        storage_usage_service.record_allocation(
            db,
            user_id=score.owner_user_id,
            category=StorageUsageCategory.SOURCE,
            bytes_count=prepared.receipt.facts.byte_size,
            reason="revision_source_created",
            object_type="score_revision_source",
            object_id=source_uuid,
            storage_key=prepared.receipt.object_key,
        )
        actor = db.get(User, command.actor_user_id)
        if actor is None:
            raise ValueError("Revision actor must exist")
        if not initial:
            for recipient in score_recipients(db, score.score_uuid):
                notification_service.admit_score_version_created(
                    db,
                    recipient_user_id=recipient,
                    actor_user_id=command.actor_user_id,
                    score_id=score.score_uuid,
                    revision_id=revision.revision_uuid,
                    score_display_title=score.display_title,
                    created_at=now,
                )
                publish_change(
                    db,
                    recipient_user_id=recipient,
                    kind=RealtimeChangeKind.SCORE_REVISIONS_CHANGED,
                    score_id=score.score_uuid,
                    revision_id=revision.revision_uuid,
                )
        db.flush()
        return RevisionWriteResult(
            revision,
            RevisionPostCommitWork(
                score_id=score_id,
                revision_id=revision_id,
                render_outbox_uuid=render.outbox_uuid,
                playback_outbox_uuid=playback.outbox_uuid,
                metadata_outbox_uuid=metadata.outbox_uuid,
            ),
        )

    def existing_append(
        self,
        db: Session,
        *,
        score_uuid: str,
        expected_head_uuid: str,
        content_hash: str,
        idempotency_key: str | None,
    ) -> ScoreRevision | None:
        """Canonical no-op admission before quota/prewrite; write rechecks after prewrite."""
        score = db.scalar(
            select(Score)
            .where(Score.score_uuid == score_uuid)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        if score is None or score.deleted_at is not None:
            raise ResourceNotFoundException("score", score_uuid, CustomerErrorCode.SCORE_NOT_FOUND)
        if idempotency_key:
            existing = db.scalar(
                select(ScoreRevision).where(
                    ScoreRevision.score_id == score.id,
                    ScoreRevision.idempotency_key == idempotency_key,
                )
            )
            if existing is not None:
                return existing
        head = self._expected_head(db, score, expected_head_uuid)
        return head if head.content_hash == content_hash else None

    @staticmethod
    def _expected_head(db: Session, score: Score, expected_head_uuid: str) -> ScoreRevision:
        head = db.get(ScoreRevision, score.head_revision_id)
        expected = db.scalar(
            select(ScoreRevision).where(
                ScoreRevision.revision_uuid == expected_head_uuid,
                ScoreRevision.score_id == score.id,
            )
        )
        if expected is None:
            raise ResourceNotFoundException(
                "revision", expected_head_uuid, CustomerErrorCode.REVISION_NOT_FOUND
            )
        if head is None or head.id != expected.id:
            raise ConflictException(
                CustomerErrorCode.REVISION_CONFLICT,
                {
                    "score_id": score.score_uuid,
                    "expected_head_revision_id": expected_head_uuid,
                    "current_head_revision_id": head.revision_uuid if head else None,
                },
            )
        return head

    @staticmethod
    def _unused(
        db: Session, source: PreparedRevisionSource, revision: ScoreRevision
    ) -> RevisionWriteResult:
        storage_quota_service.release_hold(db, source.quota_hold_id)
        return RevisionWriteResult(revision, None)


revision_writer = RevisionWriter()
