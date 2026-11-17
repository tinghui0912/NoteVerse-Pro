from __future__ import annotations

from app.modules.storage_usage.service import storage_usage_service
from app.modules.revisions.object_keys import canonical_revision_source_object_key

from app.modules.import_jobs.requested_options import encode_requested_options

from app.modules.durable_work.failure import DurableFailure
from app.shared.durable_failure import DurableFailureClass

from collections.abc import Iterator
from datetime import timedelta
import hashlib
from typing import Any, TypeVar
from unittest.mock import Mock, patch

import pytest
from app.modules.collaboration.invite_lifecycle import InviteStatus
from app.db.models.score_access import InviteTerminalOutcome
from sqlalchemy import func, select
from sqlalchemy.orm import Session
from sqlmodel import SQLModel

from app.core.exceptions import (
    ConflictException,
    ResourceNotFoundException,
    UnauthorizedException,
    ValidationException,
)
from app.db.model_utils import require_persisted_id
from tests.support.import_execution import processing_lease
from app.db.models import (
    ImportDispatch,
    ImportJob,
    ImportJobUpload,
    ImportDispatchStatus,
    ImportArtifact,
    MailOutbox,
    MailOutboxStatus,
    Notification,
    PlaybackAssetKind,
    PlaybackOutbox,
    PlaybackOutboxStatus,
    RealtimeChange,
    Score,
    ScorePlaybackAsset,
    ScoreRenderAsset,
    ScoreRevision,
    ScoreRevisionEvent,
    ScoreRevisionMetadata,
    ScoreRevisionNote,
    ScoreRevisionSource,
    StoredObject,
    StoragePlanPolicy,
    StorageUsageCounter,
    StorageUsageCategory,
    ScoreLibraryOrganization,
    ScoreInvite,
    ScoreMembership,
    ScoreRevisionRenderOutbox,
    ScoreRevisionRenderStatus,
    User,
    Upload,
)
from app.db.models.import_job import ImportJobState
from app.db.models.score import RenderAssetKind, RevisionOrigin, RevisionSourceFormat
from app.db.models.score import MetadataStatus
from app.db.models.score_access import (
    MembershipRole,
)
from app.modules.revisions.schemas import (
    RevisionCreateRequest,
    RevisionNoteUpdateRequest,
    RevisionRestoreRequest,
)
from app.modules.revisions.derived_asset_retention_service import (
    DerivedAssetRetentionService,
)
from app.modules.revisions.read_model import RevisionReadModel
from app.modules.revisions.service import RevisionService
from app.modules.score_assets.derived_assets import derived_asset_status
from app.modules.revisions.render_delivery import ScoreRevisionRenderDelivery
from app.modules.mail.outbox_service import MailOutboxService
from app.modules.import_jobs.review.schemas import ReviewConfirmRequest, ReviewUpdateRequest
from app.modules.import_jobs.review.service import ImportReviewService
from app.modules.scores.service import ScoreService
from app.modules.import_jobs.execution_recorder import ImportExecutionRecorder
from app.modules.import_jobs.service import ImportJobService
from app.modules.import_jobs.dispatch_service import ImportDispatchService
from app.modules.score_access.policy import ScoreAccessPolicy, ScoreAction
from app.modules.collaboration.schemas import InviteCreateRequest
from app.modules.collaboration.invite_lifecycle import hash_invite_token
from app.modules.collaboration.invitation_service import InvitationService
from app.modules.notifications.maintenance_service import NotificationMaintenanceService
from app.modules.notifications.service import NotificationService
from app.db.models import NotificationKind
from app.modules.realtime.maintenance_service import RealtimeMaintenanceService
from app.shared.error_codes import CustomerErrorCode
from app.db.models.import_job import ImportArtifactKind
from tests.support.object_storage import InMemoryObjectStorage
from app.shared.time import utc_now
from tests.support.storage_state import provision_storage_users

MUSICXML_1 = b"""<?xml version='1.0'?><score-partwise version='4.0'>
<part-list><score-part id='P1'><part-name>Piano</part-name></score-part></part-list>
<part id='P1'><measure number='1'><attributes><divisions>1</divisions></attributes>
<note><rest/><duration>4</duration></note></measure></part></score-partwise>"""
MUSICXML_2 = """<?xml version='1.0'?><score-partwise version='4.0'>
<part-list><score-part id='P1'><part-name>Piano</part-name></score-part></part-list>
<part id='P1'><measure number='1'><attributes><divisions>1</divisions></attributes>
<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration></note>
</measure></part></score-partwise>"""


def test_derived_asset_status_uses_public_product_states() -> None:
    assert (
        derived_asset_status(
            has_current_asset=False,
            outbox_status=ScoreRevisionRenderStatus.FAILED,
        )
        == "unavailable"
    )
    assert (
        derived_asset_status(
            has_current_asset=False,
            outbox_status=PlaybackOutboxStatus.FAILED,
        )
        == "unavailable"
    )
    assert (
        derived_asset_status(
            has_current_asset=True,
            outbox_status=ScoreRevisionRenderStatus.FAILED,
        )
        == "ready"
    )


T = TypeVar("T")


def one_row(session: Session, model: type[T], **filters: Any) -> T:
    return session.execute(select(model).filter_by(**filters)).scalar_one()


def maybe_one_row(session: Session, model: type[T], **filters: Any) -> T | None:
    return session.execute(select(model).filter_by(**filters)).scalar_one_or_none()


def all_rows(session: Session, model: type[T], **filters: Any) -> list[T]:
    return list(session.execute(select(model).filter_by(**filters)).scalars())


def count_rows(session: Session, model: type[T], **filters: Any) -> int:
    statement = select(func.count()).select_from(model)
    if filters:
        statement = statement.filter_by(**filters)
    return int(session.execute(statement).scalar_one())


def add_active_score_with_head_revision(
    session: Session,
    *,
    score_id: int,
    revision_id: int,
    score_uuid: str,
    revision_uuid: str,
    title: str,
) -> Score:
    score = Score(
        id=score_id,
        score_uuid=score_uuid,
        owner_user_id=1,
        display_title=title,
    )
    revision = ScoreRevision(
        id=revision_id,
        revision_uuid=revision_uuid,
        score_id=score_id,
        revision_number=1,
        content_hash="5d17f78acc41e8e8ad4fe9dfc2c0e998b718a0acb7283f077b797581fb9f715d",
        origin=RevisionOrigin.IMPORT,
    )
    session.add(score)
    session.add(revision)
    session.commit()
    score.head_revision_id = revision_id
    session.add(score)
    session.commit()
    return score


@pytest.fixture
def score_service_session(
    postgres_engine, tmp_path
) -> Iterator[tuple[Session, InMemoryObjectStorage]]:
    engine = postgres_engine

    SQLModel.metadata.create_all(engine)
    storage = InMemoryObjectStorage()
    with Session(engine) as session:
        session.add_all(
            [
                User(
                    id=1,
                    email="owner@example.com",
                    display_name="owner",
                    password_hash="hash",
                ),
                User(
                    id=2,
                    email="other@example.com",
                    display_name="other",
                    password_hash="hash",
                ),
                StoragePlanPolicy(
                    plan_code="FREE",
                    default_limit_bytes=100 * 1024 * 1024,
                    created_at=utc_now(),
                    updated_at=utc_now(),
                ),
            ]
        )
        session.flush()
        provision_storage_users(session)
        session.commit()
        yield session, storage
    engine.dispose()


def test_revision_read_model_projects_actor_restore_and_note(
    score_service_session: tuple[Session, InMemoryObjectStorage],
) -> None:
    session, _storage = score_service_session
    score = add_active_score_with_head_revision(
        session,
        score_id=3500,
        revision_id=3501,
        score_uuid="read-model-score",
        revision_uuid="read-model-base",
        title="Read Model Score",
    )
    restored = ScoreRevision(
        id=3502,
        revision_uuid="read-model-restored",
        score_id=3500,
        revision_number=2,
        content_hash="a" * 64,
        origin=RevisionOrigin.EDIT,
        created_by_user_id=2,
    )
    session.add(restored)
    session.commit()
    score.head_revision_id = 3502
    session.add_all(
        [
            score,
            ScoreRevisionEvent(
                score_id=3500,
                revision_id=3502,
                target_revision_id=3501,
                actor_user_id=2,
                type="RESTORE",
                note="Back to the good version",
            ),
            ScoreRevisionNote(
                score_id=3500,
                revision_id=3502,
                author_user_id=2,
                note="Keep this phrasing",
            ),
        ]
    )
    session.commit()

    read = RevisionReadModel().revision_read(
        session,  # type: ignore[arg-type]
        restored,
    )

    assert read.revision_id == "read-model-restored"
    assert read.created_by is not None
    assert read.created_by.email == "other@example.com"
    assert read.restore is not None
    assert read.restore.restored_from_revision_id == "read-model-base"
    assert read.restore.restored_from_revision_number == 1
    assert read.restore.actor is not None
    assert read.restore.actor.email == "other@example.com"
    assert read.restore.note == "Back to the good version"
    assert read.note is not None
    assert read.note.note == "Keep this phrasing"
    assert read.note.author is not None
    assert read.note.author.email == "other@example.com"


def test_collaborator_revision_source_usage_counts_against_score_owner(
    score_service_session: tuple[Session, InMemoryObjectStorage],
) -> None:
    session, storage = score_service_session
    add_active_score_with_head_revision(
        session,
        score_id=301,
        revision_id=401,
        score_uuid="collab-score",
        revision_uuid="base-revision",
        title="Collab Score",
    )
    session.add(
        ScoreMembership(
            score_id=301,
            user_id=2,
            role=MembershipRole.EDITOR,
            created_by_user_id=1,
        )
    )
    session.commit()
    service = RevisionService(storage=storage)

    result = service.create(
        session,  # type: ignore[arg-type]
        "collab-score",
        2,
        RevisionCreateRequest(
            content=MUSICXML_2,
            expected_head_revision_id="base-revision",
            origin=RevisionOrigin.EDIT,
            idempotency_key="collab-edit-1",
        ),
    )

    created = one_row(session, ScoreRevision, revision_uuid=result.revision_id)
    assert created.created_by_user_id == 2
    owner_counter = one_row(
        session, StorageUsageCounter, user_id=1, category=StorageUsageCategory.SOURCE
    )
    assert owner_counter.used_bytes == len(MUSICXML_2.encode("utf-8"))
    collaborator_counter = maybe_one_row(
        session, StorageUsageCounter, user_id=2, category=StorageUsageCategory.SOURCE
    )
    assert collaborator_counter is None or collaborator_counter.used_bytes == 0


def test_processing_success_notifies_owner_when_ready_for_review(
    score_service_session: tuple[Session, InMemoryObjectStorage],
) -> None:
    session, storage = score_service_session
    session.add(
        ImportJob(
            processing_started_at=utc_now(),
            id=11,
            job_uuid="job-complete-notification",
            user_id=1,
            state=ImportJobState.PROCESSING,
            requested_options=encode_requested_options({"display_title": "Ready Score"}),
        )
    )
    session.commit()
    stored_xml = storage.put_bytes(
        key="jobs/job-complete-notification/review_musicxml/001-score.musicxml",
        content=MUSICXML_1,
        content_type="application/vnd.recordare.musicxml+xml",
    )
    session.add(
        ImportArtifact(
            job_id=11,
            artifact_uuid="completed-review-xml",
            kind=ImportArtifactKind.REVIEW_MUSICXML,
            stored_object=StoredObject(
                object_key=stored_xml.object_key,
                content_type="application/vnd.recordare.musicxml+xml",
                byte_size=stored_xml.size_bytes,
                sha256="5d17f78acc41e8e8ad4fe9dfc2c0e998b718a0acb7283f077b797581fb9f715d",
            ),
            filename=stored_xml.object_key.rsplit("/", 1)[-1],
        )
    )
    session.commit()
    job_service = ImportExecutionRecorder()

    job_service.finalize_success(session, processing_lease(session, session.get(ImportJob, 11)))
    job_service.finalize_success(session, processing_lease(session, session.get(ImportJob, 11)))

    notification = one_row(
        session,
        Notification,
        recipient_user_id=1,
        kind=NotificationKind.IMPORT_READY_FOR_REVIEW,
    )
    assert notification.import_job_id == "job-complete-notification"
    assert notification.score_id is None
    assert notification.import_job_id == "job-complete-notification"
    assert notification.import_display_title_snapshot == "Ready Score"
    assert maybe_one_row(session, Score, display_title="Ready Score") is None
    assert count_rows(session, ScoreRevisionRenderOutbox) == 0
    assert count_rows(session, ScoreRenderAsset) == 0


def test_failed_job_notifies_owner_once(
    score_service_session: tuple[Session, InMemoryObjectStorage],
) -> None:
    session, _storage = score_service_session
    session.add(
        ImportJob(
            requested_options=encode_requested_options(None),
            processing_started_at=utc_now(),
            id=12,
            job_uuid="job-failure-notification",
            user_id=1,
            state=ImportJobState.PROCESSING,
        )
    )
    session.commit()
    job_service = ImportExecutionRecorder()

    job_service.finalize_failure(
        session,
        processing_lease(session, session.get(ImportJob, 12)),
        failure=DurableFailure(
            "import_pipeline_failed", "pipeline", DurableFailureClass.SYSTEM_ERROR, False
        ),
    )
    job_service.finalize_failure(
        session,
        processing_lease(session, session.get(ImportJob, 12)),
        failure=DurableFailure(
            "import_pipeline_failed", "pipeline", DurableFailureClass.SYSTEM_ERROR, False
        ),
    )

    notification = one_row(
        session,
        Notification,
        recipient_user_id=1,
        kind=NotificationKind.IMPORT_FAILED,
    )
    assert notification.import_job_id == "job-failure-notification"
    assert notification.score_id is None
    assert notification.import_job_id == "job-failure-notification"
    assert notification.kind == NotificationKind.IMPORT_FAILED


def test_review_detail_reads_review_ready_artifacts(
    score_service_session: tuple[Session, InMemoryObjectStorage],
) -> None:
    session, storage = score_service_session
    stored_xml = storage.put_bytes(
        key="jobs/job-review/review_musicxml/001-score.musicxml",
        content=MUSICXML_1,
        content_type="application/vnd.recordare.musicxml+xml",
    )
    uploaded_image = storage.put_bytes(
        key="uploads/original/page-1.png",
        content=b"image",
        content_type="image/png",
    )
    session.add(
        ImportJob(
            processing_started_at=utc_now(),
            processing_finished_at=utc_now(),
            id=13,
            job_uuid="job-review",
            user_id=1,
            state=ImportJobState.READY_FOR_REVIEW,
            requested_options=encode_requested_options(
                {
                    "display_title": "Review Score",
                    "genres": ["jazz"],
                }
            ),
        )
    )
    session.commit()
    session.add_all(
        [
            ImportArtifact(
                job_id=13,
                artifact_uuid="review-musicxml-artifact",
                kind=ImportArtifactKind.REVIEW_MUSICXML,
                stored_object=StoredObject(
                    object_key=stored_xml.object_key,
                    content_type="application/vnd.recordare.musicxml+xml",
                    byte_size=stored_xml.size_bytes,
                    sha256="5d17f78acc41e8e8ad4fe9dfc2c0e998b718a0acb7283f077b797581fb9f715d",
                ),
                filename=stored_xml.object_key.rsplit("/", 1)[-1],
                page_number=1,
            ),
            StoredObject(
                id=131,
                sha256="8a10d5bc2234674caf6623192c43720a4dd822fc4ecb31eca6d6dff67ec12ec3",
                object_key=uploaded_image.object_key,
                byte_size=uploaded_image.size_bytes,
                content_type="image/png",
            ),
            Upload(
                id=130,
                stored_object_id=131,
                original_filename="page-1.png",
                uploader_user_id=1,
            ),
        ]
    )
    session.commit()
    session.add(ImportJobUpload(job_id=13, upload_id=130, page_number=1, sort_order=1))
    session.commit()
    service = ImportReviewService(storage=storage)

    detail = service.detail(
        session,  # type: ignore[arg-type]
        "job-review",
        1,
    )

    assert detail.job_id == "job-review"
    assert detail.display_title == "Review Score"
    assert detail.genres == ["jazz"]
    assert detail.musicxml.artifact_id == "review-musicxml-artifact"
    assert detail.musicxml.content == MUSICXML_1.decode("utf-8")
    assert detail.original_images[0].artifact_id == "upload:130"
    assert detail.original_images[0].filename == "page-1.png"
    dumped = detail.model_dump()
    assert "sha256" not in dumped["musicxml"]
    assert "sha256" not in dumped["original_images"][0]


def test_import_job_detail_hides_original_upload_storage_details(score_service_session):
    session, storage = score_service_session
    session.add(
        ImportJob(
            id=60,
            job_uuid="private-job",
            user_id=1,
            requested_options=encode_requested_options(None),
            state=ImportJobState.QUEUED,
        )
    )
    upload = Upload(
        upload_uuid="private-upload",
        uploader_user_id=1,
        original_filename="page.png",
        stored_object=StoredObject(
            object_key="private/image", byte_size=4, sha256="a" * 64, content_type="image/png"
        ),
    )
    session.add(upload)
    session.flush()
    session.add(ImportJobUpload(job_id=60, upload_id=upload.id, sort_order=1, page_number=1))
    session.commit()
    detail = (
        ImportJobService(storage=storage).detail(session, "private-job", 1).model_dump(mode="json")
    )
    image = detail["original_images"][0]
    assert image["upload_id"] == "private-upload"
    assert image["filename"] == "page.png"
    assert "storage_key" not in image and "object_key" not in image


def test_import_job_detail_exposes_public_failure_fields_only(
    score_service_session: tuple[Session, InMemoryObjectStorage],
) -> None:
    session, _ = score_service_session
    session.add(
        ImportJob(
            requested_options=encode_requested_options(None),
            processing_finished_at=utc_now(),
            id=18,
            job_uuid="job-public-failure",
            user_id=1,
            state=ImportJobState.FAILED,
            failure_code="import_pipeline_rejected",
            failure_stage="pipeline",
            failure_classification="user_error",
            failure_retryable=False,
            failure_detail=CustomerErrorCode.SCORE_RECOGNITION_FAILED,
        )
    )
    session.add(
        ImportJob(
            requested_options=encode_requested_options(None),
            processing_finished_at=utc_now(),
            id=19,
            job_uuid="job-raw-failure",
            user_id=1,
            state=ImportJobState.FAILED,
            failure_code="import_pipeline_failed",
            failure_stage="pipeline",
            failure_classification="system_error",
            failure_retryable=False,
            failure_detail="paddleocr crashed while reading /internal/path/score.png",
        )
    )
    session.add(
        ImportJob(
            requested_options=encode_requested_options(None),
            processing_finished_at=utc_now(),
            id=20,
            job_uuid="job-unsafe-code-failure",
            user_id=1,
            state=ImportJobState.FAILED,
            failure_code="unclassified_dispatch_fault",
            failure_stage="dispatch",
            failure_classification="system_error",
            failure_retryable=False,
            failure_detail="redis broker unavailable",
        )
    )
    session.commit()

    detail = (ImportJobService().detail(session, "job-public-failure", 1)).model_dump(
        exclude_unset=True
    )
    raw_detail = (ImportJobService().detail(session, "job-raw-failure", 1)).model_dump(
        exclude_unset=True
    )
    unsafe_code_detail = (
        ImportJobService().detail(session, "job-unsafe-code-failure", 1)
    ).model_dump(exclude_unset=True)

    assert detail["public_code"] == CustomerErrorCode.SCORE_RECOGNITION_FAILED
    assert "failure_detail" not in detail
    assert raw_detail["public_code"] == CustomerErrorCode.TASK_ERROR
    assert "paddleocr" not in str(raw_detail)
    assert "/internal/path" not in str(raw_detail)
    assert unsafe_code_detail["public_code"] is None
    assert "redis" not in str(unsafe_code_detail)


def test_review_update_replaces_review_musicxml(
    score_service_session: tuple[Session, InMemoryObjectStorage],
) -> None:
    session, storage = score_service_session
    stored_xml = storage.put_bytes(
        key="jobs/job-review-update/review_musicxml/001-score.musicxml",
        content=MUSICXML_1,
        content_type="application/vnd.recordare.musicxml+xml",
    )
    session.add(
        ImportJob(
            requested_options=encode_requested_options(None),
            processing_started_at=utc_now(),
            processing_finished_at=utc_now(),
            id=15,
            job_uuid="job-review-update",
            user_id=1,
            state=ImportJobState.READY_FOR_REVIEW,
        )
    )
    session.commit()
    session.add(
        ImportArtifact(
            job_id=15,
            artifact_uuid="review-update-artifact",
            kind=ImportArtifactKind.REVIEW_MUSICXML,
            stored_object=StoredObject(
                object_key=stored_xml.object_key,
                content_type="application/vnd.recordare.musicxml+xml",
                byte_size=stored_xml.size_bytes,
                sha256="5d17f78acc41e8e8ad4fe9dfc2c0e998b718a0acb7283f077b797581fb9f715d",
            ),
            filename=stored_xml.object_key.rsplit("/", 1)[-1],
        )
    )
    session.commit()
    storage_usage_service.record_allocation(
        session,
        user_id=1,
        category=StorageUsageCategory.TEMP_IMPORT,
        bytes_count=stored_xml.size_bytes,
        reason="fixture",
    )
    session.commit()
    service = ImportReviewService(storage=storage)

    detail = service.update(
        session,  # type: ignore[arg-type]
        "job-review-update",
        1,
        ReviewUpdateRequest(content=MUSICXML_2),
    )

    assert detail.musicxml is not None
    assert detail.musicxml.content == MUSICXML_2
    artifact = one_row(session, ImportArtifact, artifact_uuid="review-update-artifact")
    assert artifact.stored_object.object_key != stored_xml.object_key
    assert storage.read_bytes(artifact.stored_object.object_key).decode("utf-8") == MUSICXML_2
    assert count_rows(session, Score) == 0
    assert count_rows(session, ScoreRevisionRenderOutbox) == 0
    assert count_rows(session, ScoreRenderAsset) == 0


def test_review_confirm_creates_active_score_once(
    score_service_session: tuple[Session, InMemoryObjectStorage],
) -> None:
    session, storage = score_service_session
    session.add(
        ImportJob(
            processing_started_at=utc_now(),
            processing_finished_at=utc_now(),
            id=14,
            job_uuid="job-confirm-review",
            user_id=1,
            state=ImportJobState.READY_FOR_REVIEW,
            requested_options=encode_requested_options({"display_title": "Confirmed Score"}),
        )
    )

    from app.modules.import_jobs.notifications import admit_import_processing_outcome

    admit_import_processing_outcome(session, session.get(ImportJob, 14), created_at=utc_now())
    session.flush()
    session.add(ImportDispatch(job_id=14, status=ImportDispatchStatus.COMPLETED))
    session.commit()
    session.commit()
    service = ImportReviewService(storage=storage)
    db = session

    first = service.confirm(
        db,  # type: ignore[arg-type]
        "job-confirm-review",
        1,
        ReviewConfirmRequest(content=MUSICXML_1.decode("utf-8")),
    )
    second = service.confirm(
        db,  # type: ignore[arg-type]
        "job-confirm-review",
        1,
        ReviewConfirmRequest(content=MUSICXML_1.decode("utf-8")),
    )

    assert first.score_id == second.score_id
    assert count_rows(session, Score) == 1
    score = one_row(session, Score)
    revision = one_row(session, ScoreRevision)
    job = one_row(session, ImportJob, job_uuid="job-confirm-review")
    assert count_rows(session, ScoreLibraryOrganization) == 0
    assert score.score_uuid == first.score_id
    assert score.display_title == "Confirmed Score"
    assert score.head_revision_id == revision.id
    assert job.state == ImportJobState.CONFIRMED
    assert job.score_id == score.id
    notification = one_row(session, Notification, import_job_id="job-confirm-review")
    assert notification.score_id == score.score_uuid
    assert notification.score_id == score.score_uuid
    assert notification.score_display_title_snapshot == "Confirmed Score"
    detail_after_confirm = service.detail(
        db,  # type: ignore[arg-type]
        "job-confirm-review",
        1,
    )
    assert detail_after_confirm.state == ImportJobState.CONFIRMED
    assert detail_after_confirm.score_id == score.score_uuid
    assert detail_after_confirm.musicxml is None
    assert one_row(
        session,
        ScoreRevisionSource,
        revision_id=revision.id,
        format=RevisionSourceFormat.MUSICXML,
    )
    assert count_rows(session, ScoreRenderAsset) == 0
    score_revision_render_outbox = one_row(session, ScoreRevisionRenderOutbox)
    assert score_revision_render_outbox.revision_id == revision.id
    assert score_revision_render_outbox.status == ScoreRevisionRenderStatus.PENDING


def test_score_detail_describes_only_head_presentation(
    score_service_session: tuple[Session, InMemoryObjectStorage],
) -> None:
    session, storage = score_service_session
    stored_thumbnail = storage.put_bytes(
        key="scores/score-fallback/revisions/revision-old/renders/default/001-old.svg",
        content=b"<svg>old</svg>",
        content_type="image/svg+xml",
    )
    score = Score(
        id=20,
        score_uuid="score-fallback",
        owner_user_id=1,
        display_title="Fallback Score",
    )
    old_revision = ScoreRevision(
        id=21,
        revision_uuid="revision-old",
        score_id=20,
        revision_number=1,
        content_hash="1" * 64,
        origin=RevisionOrigin.IMPORT,
    )
    new_revision = ScoreRevision(
        id=22,
        revision_uuid="revision-new",
        score_id=20,
        revision_number=2,
        content_hash="2" * 64,
        origin=RevisionOrigin.EDIT,
    )
    session.add_all([score, old_revision, new_revision])
    session.commit()
    score.head_revision_id = 22
    session.add_all(
        [
            ScoreRenderAsset(
                asset_uuid="old-thumbnail",
                revision_id=21,
                kind=RenderAssetKind.RENDERED_PAGE,
                stored_object=StoredObject(
                    object_key=stored_thumbnail.object_key,
                    content_type="image/svg+xml",
                    byte_size=stored_thumbnail.size_bytes,
                    sha256="3" * 64,
                ),
                filename=stored_thumbnail.object_key.rsplit("/", 1)[-1],
                page_number=1,
                render_profile="default",
                generator="test",
                generator_version="1",
            ),
            ScoreRevisionRenderOutbox(
                outbox_uuid="render-new",
                score_id=20,
                revision_id=22,
                requested_by_user_id=1,
                source_fingerprint="2" * 64,
                render_profile="default",
                status=ScoreRevisionRenderStatus.PENDING,
            ),
        ]
    )
    session.commit()

    detail = ScoreService(storage=storage).get(
        session,  # type: ignore[arg-type]
        "score-fallback",
        1,
    )

    assert detail.head_revision_id == "revision-new"
    assert detail.derived_assets.preview.asset_id is None
    assert detail.derived_assets.preview.status == "processing"
    assert detail.derived_assets.audio.status == "pending"


def test_revision_snapshots_preserve_noop_replay_and_expected_head_conflict(
    score_service_session: tuple[Session, InMemoryObjectStorage],
) -> None:
    session, storage = score_service_session
    initial = storage.put_bytes(
        key="scores/score-1/revisions/revision-1/score.musicxml",
        content=MUSICXML_1,
        content_type="application/vnd.recordare.musicxml+xml",
    )
    score = Score(
        id=30,
        score_uuid="score-1",
        owner_user_id=1,
        display_title="Score",
    )
    session.add(score)
    session.commit()
    revision = ScoreRevision(
        id=40,
        revision_uuid="revision-1",
        score_id=30,
        revision_number=1,
        content_hash="5d17f78acc41e8e8ad4fe9dfc2c0e998b718a0acb7283f077b797581fb9f715d",
        origin=RevisionOrigin.IMPORT,
    )
    session.add(revision)
    session.commit()
    score.head_revision_id = 40
    session.add(
        ScoreRevisionSource(
            id=50,
            source_uuid="artifact-1",
            revision_id=40,
            format=RevisionSourceFormat.MUSICXML,
            stored_object=StoredObject(
                object_key=initial.object_key,
                byte_size=initial.size_bytes,
                content_type="application/vnd.recordare.musicxml+xml",
                sha256=revision.content_hash,
            ),
            filename=initial.object_key.rsplit("/", 1)[-1],
            generator="test",
            generator_version="1",
        )
    )
    session.commit()
    service = RevisionService(storage=storage)

    created = service.create(
        session,  # type: ignore[arg-type]
        "score-1",
        1,
        RevisionCreateRequest(
            content=MUSICXML_2,
            expected_head_revision_id="revision-1",
            idempotency_key="snapshot-save-0001",
        ),
    )
    assert created.revision_number == 2
    session.refresh(score)
    assert (
        score.head_revision_id
        == one_row(session, ScoreRevision, revision_uuid=created.revision_id).id
    )
    counts = tuple(
        count_rows(session, model)
        for model in (ScoreRevision, ScoreRevisionSource, ScoreRevisionRenderOutbox, PlaybackOutbox)
    )
    duplicate = service.create(
        session,  # type: ignore[arg-type]
        "score-1",
        1,
        RevisionCreateRequest(content=MUSICXML_2, expected_head_revision_id=created.revision_id),
    )
    session.refresh(score)
    assert duplicate.revision_id == created.revision_id
    assert (
        score.head_revision_id
        == one_row(session, ScoreRevision, revision_uuid=created.revision_id).id
    )
    assert (
        tuple(
            count_rows(session, model)
            for model in (
                ScoreRevision,
                ScoreRevisionSource,
                ScoreRevisionRenderOutbox,
                PlaybackOutbox,
            )
        )
        == counts
    )
    reverted = service.create(
        session,  # type: ignore[arg-type]
        "score-1",
        1,
        RevisionCreateRequest(
            content=MUSICXML_1.decode("utf-8"),
            expected_head_revision_id=created.revision_id,
        ),
    )

    assert duplicate.revision_id == created.revision_id
    assert reverted.revision_id not in {"revision-1", created.revision_id}
    assert count_rows(session, ScoreRevision) == 3
    assert count_rows(session, ScoreRevisionRenderOutbox) == 2

    with pytest.raises(ConflictException) as conflict:
        service.create(
            session,  # type: ignore[arg-type]
            "score-1",
            1,
            RevisionCreateRequest(
                content=MUSICXML_2.replace("P1", "P2"),
                expected_head_revision_id="revision-1",
            ),
        )
    assert conflict.value.code == CustomerErrorCode.REVISION_CONFLICT
    assert conflict.value.details == {
        "score_id": "score-1",
        "expected_head_revision_id": "revision-1",
        "current_head_revision_id": reverted.revision_id,
    }
    replay = service.create(
        session,
        "score-1",
        1,
        RevisionCreateRequest(
            content=MUSICXML_2,
            expected_head_revision_id="revision-1",
            idempotency_key="snapshot-save-0001",
        ),
    )
    assert replay.revision_id == created.revision_id
    session.refresh(score)
    assert (
        score.head_revision_id
        == one_row(session, ScoreRevision, revision_uuid=reverted.revision_id).id
    )
    snapshots = all_rows(session, ScoreRevision, score_id=30)
    assert sorted(revision.revision_number for revision in snapshots) == [1, 2, 3]
    expected_bytes = [MUSICXML_1, MUSICXML_2.encode(), MUSICXML_1]
    for revision, content in zip(
        sorted(snapshots, key=lambda row: row.revision_number), expected_bytes
    ):
        source = one_row(session, ScoreRevisionSource, revision_id=revision.id)
        assert storage.read_bytes(source.stored_object.object_key) == content
    assert (
        count_rows(session, ScoreRevisionRenderOutbox) == count_rows(session, PlaybackOutbox) == 2
    )


def test_revision_restore_creates_new_head_from_target_revision(
    score_service_session: tuple[Session, InMemoryObjectStorage],
) -> None:
    session, storage = score_service_session
    first = storage.put_bytes(
        key="scores/score-restore/revisions/revision-1/score.musicxml",
        content=MUSICXML_1,
        content_type="application/vnd.recordare.musicxml+xml",
    )
    second = storage.put_bytes(
        key="scores/score-restore/revisions/revision-2/score.musicxml",
        content=MUSICXML_2.encode("utf-8"),
        content_type="application/vnd.recordare.musicxml+xml",
    )
    score = Score(
        id=31,
        score_uuid="score-restore",
        owner_user_id=1,
        display_title="Restore Score",
        metadata_version=2,
    )
    revision_1 = ScoreRevision(
        id=41,
        revision_uuid="revision-1",
        score_id=31,
        revision_number=1,
        content_hash="5d17f78acc41e8e8ad4fe9dfc2c0e998b718a0acb7283f077b797581fb9f715d",
        origin=RevisionOrigin.IMPORT,
    )
    revision_2 = ScoreRevision(
        id=42,
        revision_uuid="revision-2",
        score_id=31,
        revision_number=2,
        content_hash="ffbbab55af2ecf00497ab235508d9d3af816c1808458bd6bc88b3076f7f15cc3",
        origin=RevisionOrigin.EDIT,
    )
    session.add_all([score, revision_1, revision_2])
    from app.processing.musicxml.admission import admit_musicxml_document

    revision_1.content_hash = hashlib.sha256(admit_musicxml_document(MUSICXML_1)).hexdigest()
    revision_2.content_hash = hashlib.sha256(
        admit_musicxml_document(MUSICXML_2.encode())
    ).hexdigest()
    session.commit()
    score.head_revision_id = 42
    session.add_all(
        [
            ScoreRevisionSource(
                source_uuid="restore-source-1",
                revision_id=41,
                format=RevisionSourceFormat.MUSICXML,
                stored_object=StoredObject(
                    object_key=first.object_key,
                    byte_size=first.size_bytes,
                    content_type="application/vnd.recordare.musicxml+xml",
                    sha256=revision_1.content_hash,
                ),
                filename=first.object_key.rsplit("/", 1)[-1],
                generator="test",
                generator_version="1",
            ),
            ScoreRevisionSource(
                source_uuid="restore-source-2",
                revision_id=42,
                format=RevisionSourceFormat.MUSICXML,
                stored_object=StoredObject(
                    object_key=second.object_key,
                    byte_size=second.size_bytes,
                    content_type="application/vnd.recordare.musicxml+xml",
                    sha256=revision_2.content_hash,
                ),
                filename=second.object_key.rsplit("/", 1)[-1],
                generator="test",
                generator_version="1",
            ),
        ]
    )
    session.commit()
    service = RevisionService(storage=storage)

    third = service.create(
        session,
        "score-restore",
        1,
        RevisionCreateRequest(
            content=MUSICXML_2.replace("<step>C</step>", "<step>D</step>"),
            expected_head_revision_id="revision-2",
        ),
    )
    fourth = service.create(
        session,
        "score-restore",
        1,
        RevisionCreateRequest(
            content=MUSICXML_2.replace("<step>C</step>", "<step>E</step>"),
            expected_head_revision_id=third.revision_id,
        ),
    )
    restored = service.restore(  # type: ignore[arg-type]
        session,
        "score-restore",
        "revision-2",
        1,
        RevisionRestoreRequest(
            expected_head_revision_id=fourth.revision_id, note="Return to revision 2"
        ),
    )

    session.refresh(score)
    new_revision = one_row(session, ScoreRevision, revision_uuid=restored.revision_id)
    new_artifact = one_row(session, ScoreRevisionSource, revision_id=new_revision.id)
    from tests.support.revision_metadata import drain_revision_metadata

    assert all(r["status"] == "completed" for r in drain_revision_metadata(session, storage))
    metadata = session.get(ScoreRevisionMetadata, new_revision.id)
    assert new_artifact.stored_object.object_key == canonical_revision_source_object_key(
        score_uuid=score.score_uuid, revision_uuid=new_revision.revision_uuid
    )
    assert restored.revision_number == 5
    assert restored.revision_id not in {"revision-1", "revision-2"}
    assert restored.created_by is not None
    assert restored.created_by.email == "owner@example.com"
    assert restored.restore is not None
    assert restored.restore.restored_from_revision_id == "revision-2"
    assert restored.restore.restored_from_revision_number == 2
    assert restored.restore.note == "Return to revision 2"
    assert score.head_revision_id == new_revision.id
    assert score.metadata_version == 2
    assert storage.read_bytes(new_artifact.stored_object.object_key) == MUSICXML_2.encode()
    assert metadata is not None
    assert metadata.status == MetadataStatus.READY
    assert count_rows(session, ScoreRevisionRenderOutbox) == 3
    assert count_rows(session, PlaybackOutbox) == 3
    event = one_row(session, ScoreRevisionEvent)
    assert event.revision_id == new_revision.id
    assert event.target_revision_id == 42
    assert event.note == "Return to revision 2"

    assert count_rows(session, ScoreRevision, score_id=31) == 5
    for read in (third, fourth):
        assert one_row(session, ScoreRevision, revision_uuid=read.revision_id)
    assert storage.read_bytes(first.object_key) == MUSICXML_1
    assert storage.read_bytes(second.object_key) == MUSICXML_2.encode()


def test_revision_note_can_be_added_updated_and_cleared(
    score_service_session: tuple[Session, InMemoryObjectStorage],
) -> None:
    session, storage = score_service_session
    add_active_score_with_head_revision(
        session,
        score_id=33,
        revision_id=43,
        score_uuid="score-revision-note",
        revision_uuid="revision-note",
        title="Revision Note Score",
    )
    service = RevisionService(storage=storage)

    created = service.update_note(  # type: ignore[arg-type]
        session,
        "score-revision-note",
        "revision-note",
        1,
        RevisionNoteUpdateRequest(note="Fixed page 3 rhythm"),
    )
    updated = service.update_note(  # type: ignore[arg-type]
        session,
        "score-revision-note",
        "revision-note",
        1,
        RevisionNoteUpdateRequest(note="Fixed page 3 rhythm and fingering"),
    )
    cleared = service.update_note(  # type: ignore[arg-type]
        session,
        "score-revision-note",
        "revision-note",
        1,
        RevisionNoteUpdateRequest(note="  "),
    )

    assert created.note is not None
    assert created.note.note == "Fixed page 3 rhythm"
    assert created.note.author is not None
    assert created.note.author.email == "owner@example.com"
    assert updated.note is not None
    assert updated.note.note == "Fixed page 3 rhythm and fingering"
    assert cleared.note is None
    assert count_rows(session, ScoreRevisionNote) == 0


def test_derived_asset_retention_protects_current_head_only(
    score_service_session: tuple[Session, InMemoryObjectStorage],
) -> None:
    session, storage = score_service_session
    score = Score(
        id=34,
        score_uuid="retention-score",
        owner_user_id=1,
        display_title="Retention Score",
        metadata_version=5,
    )
    revisions = [
        ScoreRevision(
            id=60 + number,
            revision_uuid=f"retention-revision-{number}",
            score_id=34,
            revision_number=number,
            content_hash=f"{number:064x}",
            origin=RevisionOrigin.EDIT if number > 1 else RevisionOrigin.IMPORT,
        )
        for number in range(1, 6)
    ]
    session.add(score)
    session.add_all(revisions)
    session.commit()
    score.head_revision_id = revisions[-1].id
    stored_keys: dict[str, str] = {}
    for revision in revisions:
        revision_id = require_persisted_id(revision.id, entity="score revision")
        rendered = storage.put_bytes(
            key=f"scores/retention/revisions/{revision.revision_uuid}/render.svg",
            content=b"<svg />",
            content_type="image/svg+xml",
        )
        audio = storage.put_bytes(
            key=f"scores/retention/revisions/{revision.revision_uuid}/audio.wav",
            content=b"RIFF",
            content_type="audio/wav",
        )
        musicxml = storage.put_bytes(
            key=f"scores/retention/revisions/{revision.revision_uuid}/score.musicxml",
            content=MUSICXML_1,
            content_type="application/vnd.recordare.musicxml+xml",
        )
        stored_keys[f"render-{revision.revision_number}"] = rendered.object_key
        stored_keys[f"audio-{revision.revision_number}"] = audio.object_key
        stored_keys[f"xml-{revision.revision_number}"] = musicxml.object_key
        session.add_all(
            [
                ScoreRenderAsset(
                    asset_uuid=f"retention-render-{revision.revision_number}",
                    revision_id=revision_id,
                    kind=RenderAssetKind.RENDERED_PAGE,
                    stored_object=StoredObject(
                        object_key=rendered.object_key,
                        content_type="image/svg+xml",
                        byte_size=rendered.size_bytes,
                        sha256=hashlib.sha256(b"<svg />").hexdigest(),
                    ),
                    filename=rendered.object_key.rsplit("/", 1)[-1],
                    page_number=1,
                    render_profile="default",
                    generator="test",
                    generator_version="1",
                ),
                ScoreRevisionSource(
                    source_uuid=f"retention-xml-{revision.revision_number}",
                    revision_id=revision_id,
                    format=RevisionSourceFormat.MUSICXML,
                    stored_object=StoredObject(
                        object_key=musicxml.object_key,
                        content_type="application/vnd.recordare.musicxml+xml",
                        byte_size=musicxml.size_bytes,
                        sha256=hashlib.sha256(MUSICXML_1).hexdigest(),
                    ),
                    filename=musicxml.object_key.rsplit("/", 1)[-1],
                    generator="test",
                    generator_version="1",
                ),
                ScorePlaybackAsset(
                    asset_uuid=f"retention-audio-{revision.revision_number}",
                    revision_id=revision_id,
                    kind=PlaybackAssetKind.AUDIO,
                    stored_object=StoredObject(
                        object_key=audio.object_key,
                        content_type="audio/wav",
                        byte_size=audio.size_bytes,
                        sha256=hashlib.sha256(b"RIFF").hexdigest(),
                    ),
                    filename=audio.object_key.rsplit("/", 1)[-1],
                    source_fingerprint=f"{revision.revision_number:064x}",
                    generator="test",
                    generator_version="1",
                ),
            ]
        )
        for category, size in [
            (StorageUsageCategory.DERIVED_RENDER, rendered.size_bytes),
            (StorageUsageCategory.DERIVED_AUDIO, audio.size_bytes),
            (StorageUsageCategory.SOURCE, musicxml.size_bytes),
        ]:
            storage_usage_service.record_allocation(
                session, user_id=1, category=category, bytes_count=size, reason="fixture"
            )
    session.commit()
    service = DerivedAssetRetentionService()

    result = service.cleanup_for_score(  # type: ignore[arg-type]
        session,
        score_id=34,
    )

    assert result.rendered_pages_deleted == 4
    assert result.playback_assets_deleted == 4
    assert count_rows(session, ScoreRenderAsset, kind=RenderAssetKind.RENDERED_PAGE) == 1
    assert count_rows(session, ScorePlaybackAsset) == 1
    assert count_rows(session, ScoreRevisionSource, format=RevisionSourceFormat.MUSICXML) == 5
    from tests.support.retirement import drain_retirements

    assert result.object_retirements_queued == 8
    assert all(storage.exists(key) for key in stored_keys.values())
    assert all(item["status"] == "completed" for item in drain_retirements(session, storage))
    for number in (1, 2, 3, 4):
        assert not storage.exists(stored_keys[f"render-{number}"])
        assert not storage.exists(stored_keys[f"audio-{number}"])
        assert storage.exists(stored_keys[f"xml-{number}"])
    for number in (5,):
        assert storage.exists(stored_keys[f"render-{number}"])
        assert storage.exists(stored_keys[f"audio-{number}"])
        assert storage.exists(stored_keys[f"xml-{number}"])


def test_revision_list_uses_cursor_pagination(
    score_service_session: tuple[Session, InMemoryObjectStorage],
) -> None:
    session, storage = score_service_session
    score = Score(
        id=32,
        score_uuid="score-revision-list",
        owner_user_id=1,
        display_title="Revision List Score",
        metadata_version=5,
    )
    revisions = [
        ScoreRevision(
            id=50 + number,
            revision_uuid=f"revision-{number}",
            score_id=32,
            revision_number=number,
            content_hash=f"{number:064x}",
            origin=RevisionOrigin.EDIT if number > 1 else RevisionOrigin.IMPORT,
        )
        for number in range(1, 6)
    ]
    session.add(score)
    session.add_all(revisions)
    session.commit()
    score.head_revision_id = revisions[-1].id
    session.add(score)
    session.commit()
    service = RevisionService(storage=storage)

    first_page = service.list(  # type: ignore[arg-type]
        session,
        "score-revision-list",
        1,
        limit=2,
    )
    second_page = service.list(  # type: ignore[arg-type]
        session,
        "score-revision-list",
        1,
        limit=2,
        cursor=first_page.next_cursor,
    )

    assert [item.revision_number for item in first_page.items] == [5, 4]
    assert first_page.next_cursor == 4
    assert first_page.items[0].created_by is None
    assert [item.revision_number for item in second_page.items] == [3, 2]
    assert second_page.next_cursor == 2


def test_render_outbox_recovers_stale_delivery_and_lists_due_work(
    score_service_session: tuple[Session, InMemoryObjectStorage],
) -> None:
    session, _storage = score_service_session
    score = add_active_score_with_head_revision(
        session,
        score_id=401,
        revision_id=411,
        score_uuid="render-outbox-score",
        revision_uuid="render-outbox-revision",
        title="Render Outbox",
    )
    now = utc_now()
    stale = ScoreRevisionRenderOutbox(
        outbox_uuid="render-outbox-stale",
        score_id=score.id,
        revision_id=score.head_revision_id,
        source_fingerprint="16a3fe9f344807aa7b7a8dd1da722daa56043317e557bd535cc98ffbaf519867",
        requested_by_user_id=1,
        render_profile="default",
        status=ScoreRevisionRenderStatus.DISPATCHED,
        dispatched_at=now - timedelta(hours=1),
        next_attempt_at=now - timedelta(minutes=1),
    )
    due_failure = ScoreRevisionRenderOutbox(
        outbox_uuid="render-outbox-failed",
        score_id=score.id,
        revision_id=score.head_revision_id,
        source_fingerprint="0ef0b734ebb94ff1fa6af550527abcbca2c07f799b9dfa7820519348943ce070",
        requested_by_user_id=1,
        render_profile="compact",
        status=ScoreRevisionRenderStatus.FAILED,
        attempt_count=1,
        next_attempt_at=now - timedelta(minutes=1),
    )
    session.add_all([stale, due_failure])
    session.commit()

    due = ScoreRevisionRenderDelivery().recover_and_list_due(session)

    assert due == ["render-outbox-stale", "render-outbox-failed"]
    session.refresh(stale)
    assert stale.status == ScoreRevisionRenderStatus.FAILED
    assert stale.failure_detail == "Render delivery lease expired"


def test_render_outbox_claim_failure_and_completion_are_persistent(
    score_service_session: tuple[Session, InMemoryObjectStorage],
) -> None:
    session, _storage = score_service_session
    score = add_active_score_with_head_revision(
        session,
        score_id=402,
        revision_id=412,
        score_uuid="render-claim-score",
        revision_uuid="render-claim-revision",
        title="Render Claim",
    )
    revision = session.get(ScoreRevision, score.head_revision_id)
    session.add(
        ScoreRevisionSource(
            source_uuid="render-claim-source",
            revision_id=revision.id,
            format=RevisionSourceFormat.MUSICXML,
            stored_object=StoredObject(
                object_key="render-claim.musicxml",
                byte_size=len(MUSICXML_1),
                content_type="application/vnd.recordare.musicxml+xml",
                sha256=revision.content_hash,
            ),
            filename="score.musicxml",
            generator="test",
            generator_version="1",
        )
    )
    outbox = ScoreRevisionRenderOutbox(
        outbox_uuid="render-outbox-claim",
        score_id=score.id,
        revision_id=score.head_revision_id,
        source_fingerprint=revision.content_hash,
        requested_by_user_id=1,
    )
    session.add(outbox)
    session.commit()
    service = ScoreRevisionRenderDelivery()

    payload = service.claim(session, outbox.outbox_uuid)
    session.commit()
    assert payload is not None
    assert payload.target.score_uuid == score.score_uuid
    assert payload.target.revision_uuid == "render-claim-revision"
    assert outbox.status == ScoreRevisionRenderStatus.PROCESSING
    assert outbox.attempt_count == 1

    service.fail(session, outbox.outbox_uuid, "temporary failure", lease=payload.lease)
    session.commit()
    assert outbox.status == ScoreRevisionRenderStatus.FAILED
    assert outbox.failure_detail == "temporary failure"

    outbox.next_attempt_at = utc_now() - timedelta(seconds=1)
    session.commit()
    payload = service.claim(session, outbox.outbox_uuid)
    session.commit()
    assert payload is not None
    service.complete(session, outbox.outbox_uuid, lease=payload.lease)
    session.commit()
    assert outbox.status == ScoreRevisionRenderStatus.COMPLETED
    assert outbox.completed_at is not None
    assert outbox.failure_detail is None


def test_mail_outbox_retries_and_scrubs_sensitive_content_after_delivery(
    score_service_session: tuple[Session, InMemoryObjectStorage],
) -> None:
    session, _storage = score_service_session
    outbox = MailOutbox(
        outbox_uuid="mail-outbox-test",
        category="verification.register",
        dedupe_key="verification:test",
        recipient="user@example.com",
        subject="Verification code",
        text_body="123456",
        html_body="<strong>123456</strong>",
        expires_at=utc_now() + timedelta(minutes=10),
    )
    session.add(outbox)
    session.commit()
    service = MailOutboxService()

    payload = service.claim(session, outbox.outbox_uuid)
    session.commit()
    assert payload is not None
    assert payload.text_body == "123456"
    assert outbox.status == MailOutboxStatus.PROCESSING

    service.transient_failure(
        session, outbox.outbox_uuid, "provider unavailable", lease=payload.lease
    )
    session.commit()
    assert outbox.status == MailOutboxStatus.FAILED
    assert outbox.text_body == "123456"

    outbox.next_attempt_at = utc_now() - timedelta(seconds=1)
    session.commit()
    payload = service.claim(session, outbox.outbox_uuid)
    assert payload is not None
    service.sent(session, outbox.outbox_uuid, "resend-message-id", lease=payload.lease)
    session.commit()

    assert outbox.status == MailOutboxStatus.SENT
    assert outbox.provider_message_id == "resend-message-id"
    assert outbox.text_body is None
    assert outbox.html_body is None


def test_expired_verification_mail_is_never_dispatched(
    score_service_session: tuple[Session, InMemoryObjectStorage],
) -> None:
    session, _storage = score_service_session
    outbox = MailOutbox(
        outbox_uuid="expired-mail-outbox",
        category="verification.password_reset",
        dedupe_key="verification:expired",
        recipient="user@example.com",
        subject="Expired code",
        text_body="654321",
        html_body="<strong>654321</strong>",
        expires_at=utc_now() - timedelta(seconds=1),
    )
    session.add(outbox)
    session.commit()

    due = MailOutboxService().recover_and_list_due(session)

    assert due == []
    assert outbox.status == MailOutboxStatus.EXPIRED
    assert outbox.text_body is None
    assert outbox.html_body is None


def test_import_dispatch_claim_resolves_persisted_execution_inputs(
    score_service_session: tuple[Session, InMemoryObjectStorage],
) -> None:
    session, _storage = score_service_session
    job = ImportJob(
        id=501,
        job_uuid="import-dispatch-job",
        user_id=1,
        state=ImportJobState.QUEUED,
        requested_options=encode_requested_options({"display_title": "Queued score"}),
    )
    upload = Upload(
        id=502,
        upload_uuid="queued-upload",
        stored_object_id=602,
        original_filename="queued.png",
        uploader_user_id=1,
    )
    blob = StoredObject(
        id=602,
        sha256="c6a6aef50795992f8112412a4171cda3f041225642c94b4dfef40d2755edf2ef",
        object_key="blobs/qu/queued-upload-sha.png",
        byte_size=5,
        content_type="image/png",
    )
    session.add_all([job, blob, upload])
    session.flush()
    session.add(ImportJobUpload(job_id=501, upload_id=502, page_number=1, sort_order=1))
    session.commit()

    dispatch = ImportDispatch(job_id=job.id)
    session.add(dispatch)
    session.commit()
    payload = ImportDispatchService().claim(session, dispatch.dispatch_uuid)
    session.commit()

    assert payload is not None
    assert payload.job_uuid == job.job_uuid
    assert [item.storage_key for item in payload.inputs] == ["blobs/qu/queued-upload-sha.png"]
    assert not hasattr(payload, "options")
    assert dispatch.status == ImportDispatchStatus.PROCESSING
    assert dispatch.attempt_count == 1


def test_import_dispatch_recovers_stale_worker_without_failing_business_job(
    score_service_session: tuple[Session, InMemoryObjectStorage],
) -> None:
    session, _storage = score_service_session
    now = utc_now()
    job = ImportJob(
        requested_options=encode_requested_options(None),
        processing_started_at=utc_now(),
        id=503,
        job_uuid="stale-import-dispatch",
        user_id=1,
        state=ImportJobState.PROCESSING,
        progress=65,
        current_step="ocr",
    )
    session.add(job)
    session.commit()

    dispatch = ImportDispatch(
        job_id=job.id,
        status=ImportDispatchStatus.PROCESSING,
        attempt_count=1,
        attempt_token="token",
        started_at=now - timedelta(hours=1),
    )
    session.add(dispatch)
    session.commit()
    due = ImportDispatchService().recover_and_list_due(session)

    assert due == [dispatch.dispatch_uuid]
    assert job.state == ImportJobState.QUEUED
    assert dispatch.status == ImportDispatchStatus.FAILED
    assert job.progress == 0
    assert job.current_step is None


def test_import_dispatch_publish_release_preserves_domain_and_attempt(
    score_service_session: tuple[Session, InMemoryObjectStorage],
) -> None:
    session, _storage = score_service_session
    now = utc_now()
    job = ImportJob(
        requested_options=encode_requested_options(None),
        id=504,
        job_uuid="broker-backoff-job",
        user_id=1,
        state=ImportJobState.QUEUED,
    )
    session.add(job)
    session.commit()

    dispatch = ImportDispatch(
        job_id=job.id,
        status=ImportDispatchStatus.DISPATCHED,
        dispatched_at=now,
        next_attempt_at=now,
    )
    session.add(dispatch)
    session.commit()
    ImportDispatchService().release_dispatch(session, dispatch.dispatch_uuid, "broker unavailable")
    session.commit()

    assert job.state == ImportJobState.QUEUED
    assert dispatch.status == ImportDispatchStatus.PENDING
    assert dispatch.attempt_count == 0
    assert dispatch.next_attempt_at == now
    assert dispatch.failure_detail == "broker unavailable"


def test_collaborator_revision_save_notifies_score_owner(
    score_service_session: tuple[Session, InMemoryObjectStorage],
) -> None:
    session, storage = score_service_session
    score = add_active_score_with_head_revision(
        session,
        score_id=45,
        revision_id=46,
        score_uuid="collab-revision-score",
        revision_uuid="collab-base-revision",
        title="Collaborative Score",
    )
    session.add(
        ScoreMembership(
            score_id=45,
            user_id=2,
            role=MembershipRole.EDITOR,
            created_by_user_id=1,
        )
    )
    session.commit()
    db = session
    service = RevisionService(storage=storage)

    created = service.create(
        db,  # type: ignore[arg-type]
        score.score_uuid,
        2,
        RevisionCreateRequest(content=MUSICXML_2, expected_head_revision_id="collab-base-revision"),
    )

    notification = one_row(
        session,
        Notification,
        recipient_user_id=1,
        actor_user_id=2,
        kind=NotificationKind.SCORE_VERSION_CREATED,
    )
    assert notification.score_id == "collab-revision-score"
    assert notification.revision_id == created.revision_id
    assert notification.score_display_title_snapshot == "Collaborative Score"
    assert count_rows(session, Notification, recipient_user_id=2) == 0

    assert one_row(session, ScoreRevision, revision_uuid=created.revision_id) is not None
    actor = session.get(User, 2)
    assert actor is not None
    assert (
        count_rows(
            session,
            Notification,
            recipient_user_id=1,
            actor_user_id=2,
            kind=NotificationKind.SCORE_VERSION_CREATED,
        )
        == 1
    )


def test_score_access_policy_is_deny_by_default_and_context_aware(
    score_service_session: tuple[Session, InMemoryObjectStorage],
) -> None:
    session, _storage = score_service_session
    score = Score(
        id=70,
        score_uuid="policy-score",
        owner_user_id=1,
        display_title="Policy score",
    )
    session.add(score)
    session.commit()
    first = ScoreRevision(
        id=71,
        revision_uuid="policy-revision-1",
        score_id=70,
        revision_number=1,
        content_hash="7" * 64,
        origin=RevisionOrigin.IMPORT,
    )
    second = ScoreRevision(
        id=72,
        revision_uuid="policy-revision-2",
        score_id=70,
        revision_number=2,
        content_hash="8" * 64,
        origin=RevisionOrigin.EDIT,
    )
    session.add_all([first, second])
    session.commit()
    score.head_revision_id = 72
    session.add_all(
        [
            ScoreMembership(
                score_id=70,
                user_id=2,
                role=MembershipRole.VIEWER,
                created_by_user_id=1,
            ),
        ]
    )
    session.commit()
    db = session
    policy = ScoreAccessPolicy()

    owner = policy.resolve_score(db, "policy-score", user_id=1)  # type: ignore[arg-type]
    assert owner.capabilities.can_edit is True

    member = policy.resolve_score(db, "policy-score", user_id=2)  # type: ignore[arg-type]
    assert member.capabilities.can_view is True
    assert member.capabilities.can_edit is False
    assert member.capabilities.can_practice is False
    assert member.capabilities.can_download is False
    assert member.capabilities.can_manage_guest_previews is False
    with pytest.raises(UnauthorizedException):
        policy.authorize_score(
            db,
            "policy-score",
            ScoreAction.EDIT,
            user_id=2,  # type: ignore[arg-type]
        )

    with pytest.raises(UnauthorizedException):
        policy.resolve_score(db, "policy-score")  # type: ignore[arg-type]


def test_invite_acceptance_creates_editable_membership(
    score_service_session: tuple[Session, InMemoryObjectStorage],
) -> None:
    session, _storage = score_service_session
    score = Score(
        id=87,
        score_uuid="invite-score",
        owner_user_id=1,
        display_title="Invite score",
    )
    revision = ScoreRevision(
        id=88,
        revision_uuid="invite-revision",
        score_id=87,
        revision_number=1,
        content_hash="7" * 64,
        origin=RevisionOrigin.IMPORT,
    )
    session.add_all([score, revision])
    session.commit()
    score.head_revision_id = 88
    session.commit()

    db = session
    service = InvitationService()
    created = service.create_invite(
        db,  # type: ignore[arg-type]
        "invite-score",
        1,
        InviteCreateRequest(email="other@example.com", role=MembershipRole.EDITOR),
    )
    stored_invite = one_row(session, ScoreInvite, invite_uuid=created.invite_id)
    assert "." not in created.token
    assert created.invite_id not in created.token
    assert stored_invite.token_hash == hash_invite_token(created.token)
    assert created.token not in stored_invite.token_hash
    queued_mail = one_row(session, MailOutbox)
    assert queued_mail.recipient == "other@example.com"
    assert "Invite score" in (queued_mail.text_body or "")
    assert f"/invite/{created.token}" in (queued_mail.text_body or "")
    assert "<html" in (queued_mail.html_body or "")
    assert f"/invite/{created.token}" in (queued_mail.html_body or "")

    listed = service.list_invites(db, "invite-score", 1)  # type: ignore[arg-type]
    assert listed.items[0].invite_id == created.invite_id
    assert not hasattr(listed.items[0], "token")

    anonymous = service.inspect_invite(db, created.token, None)  # type: ignore[arg-type]
    assert anonymous.requires_login is True
    assert anonymous.can_accept is False

    accepted = service.accept_invite(db, created.token, 2)  # type: ignore[arg-type]
    assert accepted.score_id == "invite-score"
    assert accepted.role == MembershipRole.EDITOR
    assert accepted.membership_id is not None
    stored_membership = one_row(
        session,
        ScoreMembership,
        score_id=87,
        user_id=2,
    )
    assert stored_membership.role == MembershipRole.EDITOR
    assert stored_invite.terminal_outcome == InviteTerminalOutcome.ACCEPTED

    notification = one_row(
        session,
        Notification,
        recipient_user_id=1,
        actor_user_id=2,
        kind=NotificationKind.SCORE_INVITE_ACCEPTED,
    )
    assert notification.score_id == "invite-score"
    assert notification.invite_id == created.invite_id
    assert notification.read_at is None

    policy = ScoreAccessPolicy()
    member_access = policy.resolve_score(db, "invite-score", user_id=2)  # type: ignore[arg-type]
    assert member_access.capabilities.can_edit is True
    with pytest.raises(ValidationException) as accepted_again:
        service.accept_invite(db, created.token, 2)  # type: ignore[arg-type]
    assert accepted_again.value.code == CustomerErrorCode.INVITE_ALREADY_ACCEPTED


def test_invite_email_target_is_enforced(
    score_service_session: tuple[Session, InMemoryObjectStorage],
) -> None:
    session, _storage = score_service_session
    score = add_active_score_with_head_revision(
        session,
        score_id=89,
        revision_id=90,
        score_uuid="targeted-invite-score",
        revision_uuid="targeted-invite-revision",
        title="Targeted Invite",
    )
    assert score.score_uuid == "targeted-invite-score"
    db = session
    service = InvitationService()

    created = service.create_invite(
        db,  # type: ignore[arg-type]
        "targeted-invite-score",
        1,
        InviteCreateRequest(email="someone-else@example.com", role=MembershipRole.EDITOR),
    )

    inspected = service.inspect_invite(db, created.token, 2)  # type: ignore[arg-type]
    assert inspected.requires_login is False
    assert inspected.can_accept is False
    assert count_rows(session, MailOutbox) == 1
    with pytest.raises(ValidationException) as mismatch:
        service.accept_invite(db, created.token, 2)  # type: ignore[arg-type]
    assert mismatch.value.code == CustomerErrorCode.INVITE_EMAIL_MISMATCH
    assert maybe_one_row(session, ScoreMembership, score_id=89, user_id=2) is None


def test_user_pending_invites_can_be_accepted_without_token(
    score_service_session: tuple[Session, InMemoryObjectStorage],
) -> None:
    session, _storage = score_service_session
    add_active_score_with_head_revision(
        session,
        score_id=91,
        revision_id=92,
        score_uuid="pending-invite-score",
        revision_uuid="pending-invite-revision",
        title="Pending Invite",
    )
    db = session
    service = InvitationService()

    created = service.create_invite(
        db,  # type: ignore[arg-type]
        "pending-invite-score",
        1,
        InviteCreateRequest(email="other@example.com", role=MembershipRole.EDITOR),
    )
    pending = service.list_my_pending_invites(db, 2)  # type: ignore[arg-type]

    assert [invite.invite_id for invite in pending.items] == [created.invite_id]
    assert pending.items[0].score_id == "pending-invite-score"
    assert pending.items[0].score_display_title == "Pending Invite"

    accepted = service.accept_pending_invite(
        db,  # type: ignore[arg-type]
        created.invite_id,
        2,
    )

    assert accepted.score_id == "pending-invite-score"
    assert accepted.role == MembershipRole.EDITOR
    assert maybe_one_row(session, ScoreMembership, score_id=91, user_id=2)
    assert (service.list_my_pending_invites(db, 2)).items == []  # type: ignore[arg-type]


def test_user_pending_invites_can_be_declined(
    score_service_session: tuple[Session, InMemoryObjectStorage],
) -> None:
    session, _storage = score_service_session
    add_active_score_with_head_revision(
        session,
        score_id=93,
        revision_id=94,
        score_uuid="decline-invite-score",
        revision_uuid="decline-invite-revision",
        title="Decline Invite",
    )
    db = session
    service = InvitationService()

    created = service.create_invite(
        db,  # type: ignore[arg-type]
        "decline-invite-score",
        1,
        InviteCreateRequest(email="other@example.com", role=MembershipRole.VIEWER),
    )
    declined = service.decline_pending_invite(
        db,  # type: ignore[arg-type]
        created.invite_id,
        2,
    )

    stored_invite = one_row(session, ScoreInvite, invite_uuid=created.invite_id)
    assert declined.status == InviteStatus.DECLINED
    assert stored_invite.terminal_outcome == InviteTerminalOutcome.DECLINED
    assert stored_invite.terminal_at is not None

    notification = one_row(
        session,
        Notification,
        recipient_user_id=1,
        actor_user_id=2,
        kind=NotificationKind.SCORE_INVITE_DECLINED,
    )
    assert notification.score_id == "decline-invite-score"
    assert notification.score_display_title_snapshot == "Decline Invite"
    assert (service.list_my_pending_invites(db, 2)).items == []  # type: ignore[arg-type]
    with pytest.raises(ValidationException) as declined_again:
        service.accept_pending_invite(
            db,  # type: ignore[arg-type]
            created.invite_id,
            2,
        )
    assert declined_again.value.code == CustomerErrorCode.INVITE_DECLINED


def test_notifications_are_scoped_and_can_be_marked_read(
    score_service_session: tuple[Session, InMemoryObjectStorage],
) -> None:
    session, _storage = score_service_session
    db = session
    service = NotificationService()

    created = service.admit_import_ready_for_review(
        db,
        recipient_user_id=1,
        import_job_id="score-1",
        import_display_title="Etudes",
        created_at=utc_now(),
    )
    assert created is not None

    owner_notifications = service.list_for_user(db, 1)  # type: ignore[arg-type]
    other_notifications = service.list_for_user(db, 2)  # type: ignore[arg-type]
    assert [item.notification_id for item in owner_notifications] == [created.notification_uuid]
    public_notification = owner_notifications[0].model_dump()
    assert "resource_type" not in public_notification
    assert "resource_id" not in public_notification
    assert other_notifications == []
    assert (service.unread_count(db, 1)).count == 1  # type: ignore[arg-type]
    assert (service.unread_count(db, 2)).count == 0  # type: ignore[arg-type]

    with pytest.raises(ResourceNotFoundException):
        service.mark_read(db, created.notification_uuid, 2)  # type: ignore[arg-type]

    marked = service.mark_read(db, created.notification_uuid, 1)  # type: ignore[arg-type]
    assert marked.read_at is not None
    assert (service.unread_count(db, 1)).count == 0  # type: ignore[arg-type]


def test_notification_dedupe_key_returns_existing_event(
    score_service_session: tuple[Session, InMemoryObjectStorage],
) -> None:
    session, _storage = score_service_session
    db = session
    service = NotificationService()

    first = service.admit_import_ready_for_review(
        db,
        recipient_user_id=1,
        import_job_id="score-1",
        import_display_title="Etudes",
        created_at=utc_now(),
    )
    second = service.admit_import_ready_for_review(
        db,
        recipient_user_id=1,
        import_job_id="score-1",
        import_display_title="Etudes",
        created_at=utc_now(),
    )

    assert first is not None
    assert second is not None
    assert second.notification_uuid == first.notification_uuid
    assert count_rows(session, Notification, dedupe_key="import.ready_for_review:score-1:1") == 1


def test_notification_cleanup_removes_events_older_than_retention(
    score_service_session: tuple[Session, InMemoryObjectStorage],
) -> None:
    session, _storage = score_service_session
    db = session
    service = NotificationService()
    now = utc_now()

    old_event = Notification(
        recipient_user_id=1,
        kind=NotificationKind.IMPORT_READY_FOR_REVIEW,
        import_job_id="old-score",
        created_at=now - timedelta(days=91),
    )
    fresh_event = Notification(
        recipient_user_id=1,
        kind=NotificationKind.IMPORT_READY_FOR_REVIEW,
        import_job_id="fresh-score",
        created_at=now - timedelta(days=2),
    )
    session.add(old_event)
    session.add(fresh_event)
    session.commit()

    deleted = service.cleanup_expired_notifications(
        db,  # type: ignore[arg-type]
        retention_days=90,
    )

    assert deleted == 1
    remaining = all_rows(session, Notification)
    assert [event.import_job_id for event in remaining] == ["fresh-score"]


def test_notification_maintenance_removes_events_older_than_retention(
    score_service_session: tuple[Session, InMemoryObjectStorage],
) -> None:
    session, _storage = score_service_session
    service = NotificationMaintenanceService()
    now = utc_now()

    session.add(
        Notification(
            recipient_user_id=1,
            kind=NotificationKind.IMPORT_READY_FOR_REVIEW,
            import_job_id="old-score",
            created_at=now - timedelta(days=91),
        )
    )
    session.add(
        Notification(
            recipient_user_id=1,
            kind=NotificationKind.IMPORT_READY_FOR_REVIEW,
            import_job_id="fresh-score",
            created_at=now - timedelta(days=2),
        )
    )
    session.commit()

    result = service.run(session)

    assert result.expired_notifications_deleted == 1
    remaining = all_rows(session, Notification)
    assert [event.import_job_id for event in remaining] == ["fresh-score"]


def test_realtime_maintenance_removes_events_older_than_retention(
    score_service_session: tuple[Session, InMemoryObjectStorage],
) -> None:
    session, _storage = score_service_session
    service = RealtimeMaintenanceService()
    now = utc_now()

    from app.modules.realtime.publisher import publish_change
    from app.shared.realtime import RealtimeChangeKind

    for score_id, age in (("old-score", 8), ("fresh-score", 2)):
        change = publish_change(
            session,
            recipient_user_id=1,
            kind=RealtimeChangeKind.SCORE_DERIVED_ASSETS_CHANGED,
            score_id=score_id,
            revision_id="revision",
        )
        change.created_at = now - timedelta(days=age)
    session.commit()

    result = service.run(session)

    assert result.expired_changes_deleted == 1
    remaining = all_rows(session, RealtimeChange)
    assert [event.score_id for event in remaining] == ["fresh-score"]


def test_realtime_maintenance_rejects_non_positive_retention(
    score_service_session: tuple[Session, InMemoryObjectStorage],
) -> None:
    session, _storage = score_service_session
    service = RealtimeMaintenanceService()

    with pytest.raises(ValueError, match="realtime change retention days must be positive"):
        service.cleanup_expired_changes(session, retention_days=0)


@pytest.mark.parametrize("expected", ["missing-revision", "other-score-revision"])
def test_expected_head_must_resolve_within_the_score(score_service_session, expected):
    session, storage = score_service_session
    add_active_score_with_head_revision(
        session,
        score_id=600,
        revision_id=601,
        score_uuid="expected-score",
        revision_uuid="expected-head",
        title="Expected",
    )
    add_active_score_with_head_revision(
        session,
        score_id=610,
        revision_id=611,
        score_uuid="other-score",
        revision_uuid="other-score-revision",
        title="Other",
    )
    with pytest.raises(ResourceNotFoundException) as rejected:
        RevisionService(storage=storage).create(
            session,
            "expected-score",
            1,
            RevisionCreateRequest(content=MUSICXML_2, expected_head_revision_id=expected),
        )
    assert rejected.value.code == CustomerErrorCode.REVISION_NOT_FOUND
    assert count_rows(session, ScoreRevision, score_id=600) == 1
    assert count_rows(session, ScoreRevisionSource) == 0
    assert (
        count_rows(session, ScoreRevisionRenderOutbox) == count_rows(session, PlaybackOutbox) == 0
    )


def test_two_editors_cannot_branch_the_same_expected_head(score_service_session):
    session, storage = score_service_session
    score = add_active_score_with_head_revision(
        session,
        score_id=620,
        revision_id=621,
        score_uuid="linear-score",
        revision_uuid="revision-10",
        title="Linear",
    )
    head = session.get(ScoreRevision, 621)
    head.revision_number = 10
    session.add(
        User(id=3, email="editor-b@example.com", display_name="Editor B", password_hash="hash")
    )
    session.commit()
    session.add_all(
        [
            ScoreMembership(
                score_id=620, user_id=user_id, role=MembershipRole.EDITOR, created_by_user_id=1
            )
            for user_id in (2, 3)
        ]
    )
    session.commit()
    service = RevisionService(storage=storage)
    db = session
    created = service.create(
        db,
        "linear-score",
        2,
        RevisionCreateRequest(content=MUSICXML_2, expected_head_revision_id="revision-10"),
    )
    assert created.revision_number == 11
    with pytest.raises(ConflictException) as rejected:
        service.create(
            db,
            "linear-score",
            3,
            RevisionCreateRequest(
                content=MUSICXML_1.decode(), expected_head_revision_id="revision-10"
            ),
        )
    assert rejected.value.details == {
        "score_id": "linear-score",
        "expected_head_revision_id": "revision-10",
        "current_head_revision_id": created.revision_id,
    }
    session.refresh(score)
    assert (
        score.head_revision_id
        == one_row(session, ScoreRevision, revision_uuid=created.revision_id).id
    )
    assert count_rows(session, ScoreRevision, score_id=620) == 2


INVALID_WRITTEN_XML = MUSICXML_2.replace(
    "<note>", "<backup><duration>1</duration></backup><note>", 1
)
MATERIALIZING_XML = MUSICXML_2.replace(
    "<note>",
    "<direction><direction-type><metronome><beat-unit>half</beat-unit><per-minute>60</per-minute></metronome></direction-type></direction><note>",
    1,
)


def test_revision_semantic_admission_precedes_reservation_and_durable_put(
    score_service_session,
):
    session, storage = score_service_session
    score = add_active_score_with_head_revision(
        session,
        score_id=301,
        revision_id=401,
        score_uuid="admission-score",
        revision_uuid="admission-head",
        title="Admission",
    )
    service = RevisionService(storage=storage)
    with (
        patch.object(storage, "put_bytes", wraps=storage.put_bytes) as put,
        patch(
            "app.modules.revisions.service.storage_usage_service.reserve", new_callable=Mock
        ) as reserve,
    ):
        with pytest.raises(ValidationException) as caught:
            service.create(
                session,
                score.score_uuid,
                1,
                RevisionCreateRequest(
                    content=INVALID_WRITTEN_XML, expected_head_revision_id="admission-head"
                ),
            )
        put.assert_not_called()
        reserve.assert_not_called()
    assert caught.value.code == CustomerErrorCode.REVISION_CONTENT_INVALID
    assert score.head_revision_id == 401
    assert count_rows(session, ScoreRevision) == 1
    assert count_rows(session, ScoreRevisionSource) == 0


@pytest.mark.parametrize("operation", ["confirm", "update"])
def test_review_semantic_admission_precedes_storage(score_service_session, operation):
    session, storage = score_service_session
    original = storage.put_bytes(
        key="jobs/admission-review/review.musicxml",
        content=MUSICXML_1,
        content_type="application/vnd.recordare.musicxml+xml",
    )
    session.add(
        ImportJob(
            requested_options=encode_requested_options(None),
            processing_started_at=utc_now(),
            processing_finished_at=utc_now(),
            id=14,
            job_uuid="admission-review",
            user_id=1,
            state=ImportJobState.READY_FOR_REVIEW,
        )
    )
    session.flush()
    session.add(ImportDispatch(job_id=14, status=ImportDispatchStatus.COMPLETED))
    session.commit()
    artifact = ImportArtifact(
        job_id=14,
        artifact_uuid="admission-artifact",
        kind=ImportArtifactKind.REVIEW_MUSICXML,
        stored_object=StoredObject(
            object_key=original.object_key,
            content_type="application/vnd.recordare.musicxml+xml",
            byte_size=original.size_bytes,
            sha256=hashlib.sha256(MUSICXML_1).hexdigest(),
        ),
        filename=original.object_key.rsplit("/", 1)[-1],
    )
    session.add(artifact)
    session.commit()
    service = ImportReviewService(storage=storage)
    with (
        patch.object(storage, "put_bytes", wraps=storage.put_bytes) as put,
        patch(
            "app.modules.import_jobs.review.service.storage_usage_service.reserve",
            new_callable=Mock,
        ) as reserve,
    ):
        with pytest.raises(ValidationException) as caught:
            if operation == "confirm":
                service.confirm(
                    session,
                    "admission-review",
                    1,
                    ReviewConfirmRequest(content=INVALID_WRITTEN_XML),
                )
            else:
                service.update(
                    session,
                    "admission-review",
                    1,
                    ReviewUpdateRequest(content=INVALID_WRITTEN_XML),
                )
        put.assert_not_called()
        reserve.assert_not_called()
    assert caught.value.code == CustomerErrorCode.REVISION_CONTENT_INVALID
    assert artifact.stored_object.object_key == original.object_key
    assert storage.read_bytes(original.object_key) == MUSICXML_1
    assert count_rows(session, Score) == count_rows(session, ScoreRevisionSource) == 0


@pytest.mark.parametrize("operation", ["revision", "review-confirm"])
def test_service_hash_and_storage_use_exact_admitted_bytes(score_service_session, operation):
    from app.processing.musicxml.admission import admit_musicxml_document

    session, storage = score_service_session
    raw = MATERIALIZING_XML.encode()
    admitted = admit_musicxml_document(raw)
    assert admitted != raw
    expected_hash = hashlib.sha256(admitted).hexdigest()
    if operation == "revision":
        add_active_score_with_head_revision(
            session,
            score_id=301,
            revision_id=401,
            score_uuid="admission-score",
            revision_uuid="admission-head",
            title="Admission",
        )
    else:
        session.add(
            ImportJob(
                requested_options=encode_requested_options(None),
                processing_started_at=utc_now(),
                processing_finished_at=utc_now(),
                id=14,
                job_uuid="admission-review",
                user_id=1,
                state=ImportJobState.READY_FOR_REVIEW,
            )
        )
        session.flush()
        session.add(ImportDispatch(job_id=14, status=ImportDispatchStatus.COMPLETED))
        session.commit()
    with patch.object(storage, "put_bytes", wraps=storage.put_bytes) as put:
        if operation == "revision":
            result = RevisionService(storage=storage).create(
                session,
                "admission-score",
                1,
                RevisionCreateRequest(
                    content=MATERIALIZING_XML, expected_head_revision_id="admission-head"
                ),
            )
            revision = one_row(session, ScoreRevision, revision_uuid=result.revision_id)
        else:
            result = ImportReviewService(storage=storage).confirm(
                session,
                "admission-review",
                1,
                ReviewConfirmRequest(content=MATERIALIZING_XML),
            )
            score = one_row(session, Score, score_uuid=result.score_id)
            revision = session.get(ScoreRevision, score.head_revision_id)
        put.assert_called_once()
        assert put.call_args.kwargs["content"] == admitted
    source = one_row(session, ScoreRevisionSource, revision_id=revision.id)
    assert revision.content_hash == source.stored_object.sha256 == expected_hash
    assert source.stored_object.byte_size == len(admitted)
    owner = session.get(Score, revision.score_id)
    assert source.stored_object.object_key == canonical_revision_source_object_key(
        score_uuid=owner.score_uuid, revision_uuid=revision.revision_uuid
    )
    assert storage.read_bytes(source.stored_object.object_key) == admitted


def test_admitted_revision_survives_unsupported_metadata_projection(score_service_session):
    from app.processing.musicxml.admission import admit_musicxml_document
    from app.score_semantics.musicxml_score import parse_score_semantics

    session, storage = score_service_session
    session.add(
        ImportJob(
            requested_options=encode_requested_options(None),
            processing_started_at=utc_now(),
            processing_finished_at=utc_now(),
            id=14,
            job_uuid="admission-review",
            user_id=1,
            state=ImportJobState.READY_FOR_REVIEW,
        )
    )
    session.flush()
    session.add(ImportDispatch(job_id=14, status=ImportDispatchStatus.COMPLETED))
    session.commit()
    content = MUSICXML_2.replace(
        "</attributes>", "<key><key-step>B</key-step><key-alter>-1</key-alter></key></attributes>"
    )
    admitted = admit_musicxml_document(content.encode())
    assert parse_score_semantics(admitted).keys[0].fifths is None
    result = ImportReviewService(storage=storage).confirm(
        session, "admission-review", 1, ReviewConfirmRequest(content=content)
    )
    score = one_row(session, Score, score_uuid=result.score_id)
    revision = session.get(ScoreRevision, score.head_revision_id)
    source = one_row(session, ScoreRevisionSource, revision_id=revision.id)
    from tests.support.revision_metadata import drain_revision_metadata

    assert all(r["status"] == "completed" for r in drain_revision_metadata(session, storage))
    projection = session.get(ScoreRevisionMetadata, revision.id)
    assert storage.read_bytes(source.stored_object.object_key) == admitted
    assert revision.content_hash == hashlib.sha256(admitted).hexdigest()
    assert projection.status == MetadataStatus.FAILED
    assert projection.error_code == "unsupported_nontraditional_key"
