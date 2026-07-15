from __future__ import annotations

from collections.abc import Iterator
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

import pytest
from sqlalchemy import event
from sqlmodel import Session, SQLModel, create_engine

from app.core.exceptions import (
    ConflictException,
    ResourceNotFoundException,
    UnauthorizedException,
    ValidationException,
)
from app.db.model_utils import require_persisted_id
from app.db.models import (
    ImportJob,
    ImportJobUpload,
    ImportDispatchStatus,
    ImportArtifact,
    MailOutbox,
    MailOutboxStatus,
    NotificationEvent,
    PlaybackAssetKind,
    PlaybackOutbox,
    RealtimeEvent,
    Score,
    ScorePlaybackAsset,
    ScoreRenderAsset,
    ScoreRevision,
    ScoreRevisionEvent,
    ScoreRevisionMetadata,
    ScoreRevisionNote,
    ScoreRevisionSource,
    StorageBlob,
    StorageQuotaPolicy,
    StorageUsageCounter,
    StorageUsageCategory,
    ScoreLibraryEntry,
    ScoreInvite,
    ScoreMembership,
    ScorePublication,
    RenderOutbox,
    RenderOutboxStatus,
    RenderTargetType,
    ScoreShareGrant,
    ShareGrantRedemption,
    User,
    Upload,
)
from app.db.models.library import LibraryEntrySourceType
from app.db.models.import_job import ImportJobState
from app.db.models.score import RenderAssetKind, RevisionOrigin, RevisionSourceFormat
from app.db.models.score import MetadataStatus
from app.db.models.score_access import (
    InviteStatus,
    MembershipRole,
    PublicationStatus,
)
from app.db.models.user import UserRole
from app.modules.revisions.schemas import (
    FingeringRequest,
    RevisionCreateRequest,
    RevisionNoteUpdateRequest,
    RevisionRestoreRequest,
)
from app.modules.revisions.derived_asset_retention_service import (
    DerivedAssetRetentionService,
)
from app.modules.revisions.service import RevisionService
from app.modules.revisions.fingering_service import strip_existing_fingerings
from app.modules.score_assets.service import ScoreAssetService
from app.modules.score_assets.render_outbox_service import RenderOutboxService
from app.modules.mail.outbox_service import MailOutboxService
from app.modules.review.schemas import ReviewConfirmRequest, ReviewUpdateRequest
from app.modules.review.service import ReviewService
from app.modules.review.thumbnail_service import ReviewThumbnailService
from app.modules.scores.service import ScoreService
from app.modules.scores.repository import ScoreRepository
from app.modules.scores.creation_service import SyncConfirmedScoreCreationService
from app.modules.import_jobs.worker_service import SyncImportJobService
from app.modules.import_jobs.dispatch_service import ImportDispatchService
from app.modules.score_access.policy import ScoreAccessPolicy, ScoreAction, hash_share_token
from app.modules.score_sharing.schemas import GrantCreateRequest
from app.modules.score_sharing.service import ScoreSharingService
from app.modules.score_invites.schemas import InviteCreateRequest
from app.modules.score_invites.service import ScoreInviteService, hash_invite_token
from app.modules.notifications.maintenance_service import NotificationMaintenanceService
from app.modules.notifications.service import NotificationService, NotificationTypes
from app.modules.realtime.maintenance_service import RealtimeMaintenanceService
from app.modules.publications.schemas import PublicationUpsertRequest
from app.modules.publications.service import PublicationService
from app.modules.playback.service import PlaybackService
from app.shared.constants import ErrorCode
from app.modules.import_jobs.artifact_kinds import ImportArtifactKind
from app.storage import LocalFileStorage
from app.utils.timezone import utc_now_naive

MUSICXML_1 = b"""<?xml version='1.0'?><score-partwise version='4.0'>
<part-list><score-part id='P1'><part-name>Piano</part-name></score-part></part-list>
<part id='P1'><measure number='1'><attributes><divisions>1</divisions></attributes>
<note><rest/><duration>4</duration></note></measure></part></score-partwise>"""
MUSICXML_2 = """<?xml version='1.0'?><score-partwise version='4.0'>
<part-list><score-part id='P1'><part-name>Piano</part-name></score-part></part-list>
<part id='P1'><measure number='1'><attributes><divisions>1</divisions></attributes>
<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration></note>
</measure></part></score-partwise>"""


class AsyncSessionAdapter:
    def __init__(self, session: Session) -> None:
        self.session = session

    async def execute(self, statement, params=None, *args, **kwargs):
        return self.session.execute(statement, params=params, *args, **kwargs)

    async def commit(self) -> None:
        self.session.commit()

    async def rollback(self) -> None:
        self.session.rollback()

    async def flush(self) -> None:
        self.session.flush()

    async def refresh(self, instance) -> None:
        self.session.refresh(instance)

    async def get(self, model, identity):
        return self.session.get(model, identity)

    async def delete(self, instance) -> None:
        self.session.delete(instance)

    def add(self, instance) -> None:
        self.session.add(instance)


class FakeFingeringService:
    def __init__(self, xml_content: str = MUSICXML_2) -> None:
        self.xml_content = xml_content
        self.calls: list[dict[str, str]] = []

    def generate(self, score_id: str, xml_content: str, hand_size: str = "M"):
        self.calls.append(
            {
                "score_id": score_id,
                "xml_content": xml_content,
                "hand_size": hand_size,
            }
        )
        return {"xml_content": self.xml_content, "hand_size": hand_size}


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
        title=title,
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
def score_service_session(tmp_path) -> Iterator[tuple[Session, LocalFileStorage]]:
    engine = create_engine("sqlite:///:memory:")

    @event.listens_for(engine, "connect")
    def enable_foreign_keys(dbapi_connection, _connection_record) -> None:
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    SQLModel.metadata.create_all(engine)
    storage = LocalFileStorage(storage_root=str(tmp_path / "storage"))
    with Session(engine) as session:
        session.add_all(
            [
                User(
                    id=1,
                    email="owner@example.com",
                    display_name="owner",
                    password_hash="hash",
                    role=UserRole.user,
                ),
                User(
                    id=2,
                    email="other@example.com",
                    display_name="other",
                    password_hash="hash",
                    role=UserRole.user,
                ),
                StorageQuotaPolicy(
                    plan_code="FREE",
                    quota_limit_bytes=100 * 1024 * 1024,
                    created_at=utc_now_naive(),
                    updated_at=utc_now_naive(),
                ),
            ]
        )
        session.commit()
        yield session, storage
    engine.dispose()


@pytest.mark.asyncio
async def test_collaborator_revision_source_usage_counts_against_score_owner(
    score_service_session: tuple[Session, LocalFileStorage],
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

    result = await service.create(
        AsyncSessionAdapter(session),  # type: ignore[arg-type]
        "collab-score",
        2,
        RevisionCreateRequest(
            content=MUSICXML_2,
            base_revision_id="base-revision",
            origin=RevisionOrigin.EDIT,
            idempotency_key="collab-edit-1",
        ),
    )

    created = session.query(ScoreRevision).filter_by(revision_uuid=result.revision_id).one()
    assert created.created_by_user_id == 2
    owner_counter = (
        session.query(StorageUsageCounter)
        .filter_by(user_id=1, category=StorageUsageCategory.SOURCE)
        .one()
    )
    assert owner_counter.used_bytes == len(MUSICXML_2.encode("utf-8"))
    collaborator_counter = (
        session.query(StorageUsageCounter)
        .filter_by(user_id=2, category=StorageUsageCategory.SOURCE)
        .one_or_none()
    )
    assert collaborator_counter is None or collaborator_counter.used_bytes == 0


def test_confirmed_job_creates_one_active_score_and_initial_revision(
    score_service_session: tuple[Session, LocalFileStorage], tmp_path
) -> None:
    session, storage = score_service_session
    session.add_all(
        [
            ImportJob(
                id=10,
                job_uuid="job-1",
                user_id=1,
                state=ImportJobState.RUNNING,
            ),
        ]
    )
    session.commit()
    source = tmp_path / "score.musicxml"
    source.write_bytes(MUSICXML_1)
    service = SyncConfirmedScoreCreationService(storage)

    first_id = service.create_confirmed_from_job(
        session, "job-1", str(source), title="Recognized score"
    )
    second_id = service.create_confirmed_from_job(
        session, "job-1", str(source), title="Recognized score"
    )

    assert first_id == second_id
    assert session.query(Score).count() == 1
    score = session.query(Score).one()
    revision = session.query(ScoreRevision).one()
    revision_source = session.query(ScoreRevisionSource).one()
    metadata = session.get(ScoreRevisionMetadata, revision.id)
    assert score.head_revision_id == revision.id
    assert revision_source.format == RevisionSourceFormat.MUSICXML
    assert storage.exists(revision_source.storage_key)
    assert metadata is not None
    assert metadata.status == MetadataStatus.READY
    assert metadata.measure_count == 1
    assert metadata.playback_duration_ms == 2000


def test_completed_job_notifies_owner_when_ready_for_review(
    score_service_session: tuple[Session, LocalFileStorage],
) -> None:
    session, storage = score_service_session
    session.add(
        ImportJob(
            id=11,
            job_uuid="job-complete-notification",
            user_id=1,
            state=ImportJobState.RUNNING,
            requested_options={"title": "Ready Score"},
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
            kind=ImportArtifactKind.REVIEW_MUSICXML.value,
            storage_backend="local",
            storage_key=stored_xml.storage_key,
            filename=stored_xml.filename,
            mime_type="application/vnd.recordare.musicxml+xml",
            size_bytes=stored_xml.size_bytes,
            sha256="5d17f78acc41e8e8ad4fe9dfc2c0e998b718a0acb7283f077b797581fb9f715d",
        )
    )
    session.commit()
    job_service = SyncImportJobService()

    job_service.finalize_success(session, "job-complete-notification")
    job_service.finalize_success(session, "job-complete-notification")

    notification = (
        session.query(NotificationEvent)
        .filter_by(
            recipient_user_id=1,
            type=NotificationTypes.IMPORT_COMPLETED,
        )
        .one()
    )
    assert notification.resource_type == "job"
    assert notification.resource_id == "job-complete-notification"
    assert notification.score_id is None
    assert notification.data["job_id"] == "job-complete-notification"
    assert notification.data["job_title"] == "Ready Score"
    assert session.query(Score).filter_by(title="Ready Score").one_or_none() is None
    render_outbox = session.query(RenderOutbox).one()
    assert render_outbox.target_type == RenderTargetType.REVIEW_THUMBNAIL
    assert render_outbox.import_job_id == 11
    assert render_outbox.status == RenderOutboxStatus.PENDING


def test_failed_job_notifies_owner_once(
    score_service_session: tuple[Session, LocalFileStorage],
) -> None:
    session, _storage = score_service_session
    session.add(
        ImportJob(
            id=12,
            job_uuid="job-failure-notification",
            user_id=1,
            state=ImportJobState.RUNNING,
        )
    )
    session.commit()
    job_service = SyncImportJobService()

    job_service.finalize_failure(
        session,
        "job-failure-notification",
        error="OCR failed",
        error_type="PipelineError",
        code=ErrorCode.UNKNOWN_ERROR,
    )
    job_service.finalize_failure(
        session,
        "job-failure-notification",
        error="OCR failed again",
        error_type="PipelineError",
        code=ErrorCode.UNKNOWN_ERROR,
    )

    notification = (
        session.query(NotificationEvent)
        .filter_by(
            recipient_user_id=1,
            type=NotificationTypes.IMPORT_FAILED,
        )
        .one()
    )
    assert notification.resource_type == "job"
    assert notification.resource_id == "job-failure-notification"
    assert notification.score_id is None
    assert notification.data["job_id"] == "job-failure-notification"
    assert notification.data["code"] == ErrorCode.UNKNOWN_ERROR


@pytest.mark.asyncio
async def test_review_detail_reads_pending_job_artifacts(
    score_service_session: tuple[Session, LocalFileStorage],
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
            id=13,
            job_uuid="job-review",
            user_id=1,
            state=ImportJobState.PENDING_REVIEW,
            requested_options={
                "title": "Review Score",
                "taxonomy_tags": [{"category": "level", "code": "beginner"}],
            },
        )
    )
    session.commit()
    session.add_all(
        [
            ImportArtifact(
                job_id=13,
                artifact_uuid="review-musicxml-artifact",
                kind=ImportArtifactKind.REVIEW_MUSICXML.value,
                storage_backend="local",
                storage_key=stored_xml.storage_key,
                filename=stored_xml.filename,
                mime_type="application/vnd.recordare.musicxml+xml",
                size_bytes=stored_xml.size_bytes,
                sha256="5d17f78acc41e8e8ad4fe9dfc2c0e998b718a0acb7283f077b797581fb9f715d",
                page_number=1,
            ),
            StorageBlob(
                id=131,
                sha256="upload-sha",
                storage_backend="local",
                storage_key=uploaded_image.storage_key,
                filename=uploaded_image.filename,
                size_bytes=uploaded_image.size_bytes,
                mime_type="image/png",
            ),
            Upload(
                id=130,
                blob_id=131,
                original_filename="page-1.png",
                uploader_user_id=1,
            ),
            ImportJobUpload(job_id=13, upload_id=130, page_number=1, sort_order=1),
        ]
    )
    session.commit()
    service = ReviewService(storage=storage)

    detail = await service.detail(
        AsyncSessionAdapter(session),  # type: ignore[arg-type]
        "job-review",
        1,
    )

    assert detail.job_id == "job-review"
    assert detail.title == "Review Score"
    assert detail.taxonomy_tags == [{"category": "level", "code": "beginner"}]
    assert detail.musicxml.artifact_id == "review-musicxml-artifact"
    assert detail.musicxml.content == MUSICXML_1.decode("utf-8")
    assert detail.original_images[0].artifact_id == "upload:130"
    assert detail.original_images[0].filename == "page-1.png"


def test_job_detail_uses_review_preview_image_only(
    score_service_session: tuple[Session, LocalFileStorage],
) -> None:
    session, _ = score_service_session
    session.add(
        ImportJob(
            id=16,
            job_uuid="job-thumbnail",
            user_id=1,
            state=ImportJobState.PENDING_REVIEW,
        )
    )
    session.commit()
    session.add_all(
        [
            ImportArtifact(
                job_id=16,
                artifact_uuid="result-thumbnail-artifact",
                kind=ImportArtifactKind.REVIEW_PREVIEW_IMAGE.value,
                storage_backend="local",
                storage_key="jobs/job-thumbnail/review_preview_image/001-result.svg",
                filename="001-result.svg",
                mime_type="image/svg+xml",
                page_number=1,
            ),
        ]
    )
    session.commit()

    detail = SyncImportJobService().get_detail(session, "job-thumbnail")

    assert detail["thumbnail_artifact_id"] == "result-thumbnail-artifact"


def test_import_job_detail_exposes_public_failure_fields_only(
    score_service_session: tuple[Session, LocalFileStorage],
) -> None:
    session, _ = score_service_session
    session.add(
        ImportJob(
            id=18,
            job_uuid="job-public-failure",
            user_id=1,
            state=ImportJobState.FAILURE,
            error=ErrorCode.SCORE_RECOGNITION_FAILED,
            code=ErrorCode.SCORE_RECOGNITION_FAILED,
            error_type="PipelineEngineError",
        )
    )
    session.add(
        ImportJob(
            id=19,
            job_uuid="job-raw-failure",
            user_id=1,
            state=ImportJobState.FAILURE,
            error="paddleocr crashed while reading /internal/path/score.png",
            code=None,
            error_type="PipelineEngineError",
        )
    )
    session.commit()

    detail = SyncImportJobService().get_detail(session, "job-public-failure")
    raw_detail = SyncImportJobService().get_detail(session, "job-raw-failure")

    assert detail["public_code"] == ErrorCode.SCORE_RECOGNITION_FAILED
    assert detail["public_message"] == ErrorCode.SCORE_RECOGNITION_FAILED
    assert "error" not in detail
    assert "code" not in detail
    assert "error_type" not in detail
    assert raw_detail["public_code"] == ErrorCode.TASK_ERROR
    assert raw_detail["public_message"] == ErrorCode.TASK_ERROR
    assert "paddleocr" not in str(raw_detail)
    assert "/internal/path" not in str(raw_detail)


def test_review_thumbnail_records_temp_import_usage(
    score_service_session: tuple[Session, LocalFileStorage], tmp_path
) -> None:
    session, storage = score_service_session
    stored_xml = storage.put_bytes(
        key="jobs/job-thumbnail-usage/review_musicxml/001-score.musicxml",
        content=MUSICXML_1,
        content_type="application/vnd.recordare.musicxml+xml",
    )
    session.add(
        ImportJob(
            id=17,
            job_uuid="job-thumbnail-usage",
            user_id=1,
            state=ImportJobState.PENDING_REVIEW,
        )
    )
    session.commit()
    session.add(
        ImportArtifact(
            job_id=17,
            artifact_uuid="thumbnail-usage-review-xml",
            kind=ImportArtifactKind.REVIEW_MUSICXML.value,
            storage_backend="local",
            storage_key=stored_xml.storage_key,
            filename=stored_xml.filename,
            mime_type="application/vnd.recordare.musicxml+xml",
            size_bytes=stored_xml.size_bytes,
            sha256="5d17f78acc41e8e8ad4fe9dfc2c0e998b718a0acb7283f077b797581fb9f715d",
        )
    )
    session.commit()

    class FakeEngine:
        def __init__(self, output_folder: str) -> None:
            self.output_folder = output_folder

        def render_score(self, *, xml_path: str, output_name: str):
            output = tmp_path / "thumbnail.svg"
            output.write_bytes(b"<svg />")
            return {
                "success": True,
                "engine": "fake-renderer",
                "files": [
                    {
                        "path": str(output),
                        "page": 1,
                        "mime_type": "image/svg+xml",
                    }
                ],
            }

    with patch(
        "app.modules.review.thumbnail_service.create_score_render_engine",
        side_effect=lambda output_folder: FakeEngine(output_folder),
    ):
        artifact_id = ReviewThumbnailService(storage=storage).render(
            session,
            "job-thumbnail-usage",
            expected_source_fingerprint="5d17f78acc41e8e8ad4fe9dfc2c0e998b718a0acb7283f077b797581fb9f715d",
        )

    assert artifact_id is not None
    counter = (
        session.query(StorageUsageCounter)
        .filter_by(user_id=1, category=StorageUsageCategory.TEMP_IMPORT)
        .one()
    )
    assert counter.used_bytes == len(b"<svg />")


@pytest.mark.asyncio
async def test_review_update_replaces_pending_review_musicxml(
    score_service_session: tuple[Session, LocalFileStorage],
) -> None:
    session, storage = score_service_session
    stored_xml = storage.put_bytes(
        key="jobs/job-review-update/review_musicxml/001-score.musicxml",
        content=MUSICXML_1,
        content_type="application/vnd.recordare.musicxml+xml",
    )
    session.add(
        ImportJob(
            id=15,
            job_uuid="job-review-update",
            user_id=1,
            state=ImportJobState.PENDING_REVIEW,
        )
    )
    session.commit()
    session.add(
        ImportArtifact(
            job_id=15,
            artifact_uuid="review-update-artifact",
            kind=ImportArtifactKind.REVIEW_MUSICXML.value,
            storage_backend="local",
            storage_key=stored_xml.storage_key,
            filename=stored_xml.filename,
            mime_type="application/vnd.recordare.musicxml+xml",
            size_bytes=stored_xml.size_bytes,
            sha256="5d17f78acc41e8e8ad4fe9dfc2c0e998b718a0acb7283f077b797581fb9f715d",
        )
    )
    session.commit()
    service = ReviewService(storage=storage)

    detail = await service.update(
        AsyncSessionAdapter(session),  # type: ignore[arg-type]
        "job-review-update",
        1,
        ReviewUpdateRequest(content=MUSICXML_2),
    )

    assert detail.musicxml is not None
    assert detail.musicxml.content == MUSICXML_2
    artifact = session.query(ImportArtifact).filter_by(artifact_uuid="review-update-artifact").one()
    assert artifact.storage_key != stored_xml.storage_key
    assert storage.read_bytes(artifact.storage_key).decode("utf-8") == MUSICXML_2
    assert session.query(Score).count() == 0
    render_outbox = session.query(RenderOutbox).one()
    assert render_outbox.target_type == RenderTargetType.REVIEW_THUMBNAIL
    assert render_outbox.import_job_id == 15
    assert render_outbox.source_fingerprint == artifact.sha256
    assert render_outbox.status == RenderOutboxStatus.PENDING


@pytest.mark.asyncio
async def test_review_confirm_creates_active_score_once(
    score_service_session: tuple[Session, LocalFileStorage],
) -> None:
    session, storage = score_service_session
    stored_thumbnail = storage.put_bytes(
        key="jobs/job-confirm-review/review_preview_image/001-result.svg",
        content=b"<svg />",
        content_type="image/svg+xml",
    )
    session.add(
        ImportJob(
            id=14,
            job_uuid="job-confirm-review",
            user_id=1,
            state=ImportJobState.PENDING_REVIEW,
            requested_options={"title": "Confirmed Score"},
        )
    )
    session.add(
        NotificationEvent(
            notification_uuid="notification-review-ready",
            recipient_user_id=1,
            actor_user_id=None,
            type=NotificationTypes.IMPORT_COMPLETED,
            resource_type="job",
            resource_id="job-confirm-review",
            score_id=None,
            title="Processing complete",
            data={"job_id": "job-confirm-review", "job_title": "Confirmed Score"},
        )
    )
    session.commit()
    session.add(
        ImportArtifact(
            job_id=14,
            artifact_uuid="confirm-review-thumbnail",
            kind=ImportArtifactKind.REVIEW_PREVIEW_IMAGE.value,
            storage_backend="local",
            storage_key=stored_thumbnail.storage_key,
            filename=stored_thumbnail.filename,
            mime_type="image/svg+xml",
            size_bytes=stored_thumbnail.size_bytes,
            page_number=1,
            sha256="thumbnail",
        )
    )
    session.commit()
    service = ReviewService(storage=storage)
    db = AsyncSessionAdapter(session)

    first = await service.confirm(
        db,  # type: ignore[arg-type]
        "job-confirm-review",
        1,
        ReviewConfirmRequest(content=MUSICXML_1.decode("utf-8")),
    )
    second = await service.confirm(
        db,  # type: ignore[arg-type]
        "job-confirm-review",
        1,
        ReviewConfirmRequest(content=MUSICXML_1.decode("utf-8")),
    )

    assert first.score_id == second.score_id
    assert session.query(Score).count() == 1
    score = session.query(Score).one()
    revision = session.query(ScoreRevision).one()
    job = session.query(ImportJob).filter_by(job_uuid="job-confirm-review").one()
    library_entry = session.query(ScoreLibraryEntry).one()
    assert score.score_uuid == first.score_id
    assert score.title == "Confirmed Score"
    assert score.head_revision_id == revision.id
    assert job.state == ImportJobState.CONFIRMED
    assert job.score_id == score.id
    assert library_entry.score_id == score.id
    notification = (
        session.query(NotificationEvent)
        .filter_by(notification_uuid="notification-review-ready")
        .one()
    )
    assert notification.score_id == score.score_uuid
    assert notification.data["score_id"] == score.score_uuid
    assert notification.data["score_title"] == "Confirmed Score"
    detail_after_confirm = await service.detail(
        db,  # type: ignore[arg-type]
        "job-confirm-review",
        1,
    )
    assert detail_after_confirm.state == ImportJobState.CONFIRMED
    assert detail_after_confirm.score_id == score.score_uuid
    assert detail_after_confirm.musicxml is None
    assert (
        session.query(ScoreRevisionSource)
        .filter_by(
            revision_id=revision.id,
            format=RevisionSourceFormat.MUSICXML,
        )
            .one()
    )
    copied_thumbnail = (
        session.query(ScoreRenderAsset)
        .filter_by(
            revision_id=revision.id,
            kind=RenderAssetKind.RENDERED_PAGE,
            render_profile="default",
            page_number=1,
        )
        .one()
    )
    assert copied_thumbnail.generator == "review-thumbnail"
    assert storage.read_bytes(copied_thumbnail.storage_key) == b"<svg />"
    render_outbox = session.query(RenderOutbox).one()
    assert render_outbox.revision_id == revision.id
    assert render_outbox.status == RenderOutboxStatus.PENDING


@pytest.mark.asyncio
async def test_score_detail_uses_previous_thumbnail_while_head_render_is_pending(
    score_service_session: tuple[Session, LocalFileStorage],
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
        title="Fallback Score",
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
        parent_revision_id=21,
        base_revision_id=21,
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
                storage_backend="local",
                storage_key=stored_thumbnail.storage_key,
                filename=stored_thumbnail.filename,
                mime_type="image/svg+xml",
                size_bytes=stored_thumbnail.size_bytes,
                sha256="3" * 64,
                page_number=1,
                render_profile="default",
                generator="test",
                generator_version="1",
            ),
            RenderOutbox(
                outbox_uuid="render-new",
                target_type=RenderTargetType.SCORE_REVISION,
                score_id=20,
                revision_id=22,
                requested_by_user_id=1,
                source_fingerprint="2" * 64,
                render_profile="default",
                status=RenderOutboxStatus.PENDING,
            ),
        ]
    )
    session.commit()

    detail = await ScoreService(storage=storage).get(
        AsyncSessionAdapter(session),  # type: ignore[arg-type]
        "score-fallback",
        1,
    )

    assert detail.head_revision_id == "revision-new"
    assert detail.derived_assets.preview.asset_id == "old-thumbnail"
    assert detail.derived_assets.preview.revision_id == "revision-old"
    assert detail.derived_assets.preview.is_fallback is True
    assert detail.derived_assets.preview.status == "processing"
    assert detail.derived_assets.audio.status == "pending"


@pytest.mark.asyncio
async def test_revision_save_deduplicates_and_rejects_stale_base(
    score_service_session: tuple[Session, LocalFileStorage],
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
        title="Score",
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
            storage_backend="local",
            storage_key=initial.storage_key,
            filename=initial.filename,
            mime_type="application/vnd.recordare.musicxml+xml",
            sha256=revision.content_hash,
            generator="test",
            generator_version="1",
        )
    )
    session.commit()
    async_db = AsyncSessionAdapter(session)
    service = RevisionService(storage=storage)

    created = await service.create(
        async_db,  # type: ignore[arg-type]
        "score-1",
        1,
        RevisionCreateRequest(content=MUSICXML_2, base_revision_id="revision-1"),
    )
    duplicate = await service.create(
        async_db,  # type: ignore[arg-type]
        "score-1",
        1,
        RevisionCreateRequest(content=MUSICXML_2, base_revision_id=created.revision_id),
    )
    reverted = await service.create(
        async_db,  # type: ignore[arg-type]
        "score-1",
        1,
        RevisionCreateRequest(
            content=MUSICXML_1.decode("utf-8"),
            base_revision_id=created.revision_id,
        ),
    )

    assert duplicate.revision_id == created.revision_id
    assert reverted.revision_id not in {"revision-1", created.revision_id}
    assert session.query(ScoreRevision).count() == 3
    assert session.query(RenderOutbox).count() == 2

    with pytest.raises(ConflictException) as conflict:
        await service.create(
            async_db,  # type: ignore[arg-type]
            "score-1",
            1,
            RevisionCreateRequest(
                content=MUSICXML_2.replace("P1", "P2"),
                base_revision_id="revision-1",
            ),
        )
    assert conflict.value.code == ErrorCode.REVISION_CONFLICT


@pytest.mark.asyncio
async def test_revision_restore_creates_new_head_from_target_revision(
    score_service_session: tuple[Session, LocalFileStorage],
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
        title="Restore Score",
        version=2,
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
        parent_revision_id=41,
        base_revision_id=41,
        content_hash="ffbbab55af2ecf00497ab235508d9d3af816c1808458bd6bc88b3076f7f15cc3",
        origin=RevisionOrigin.EDIT,
    )
    session.add_all([score, revision_1, revision_2])
    session.commit()
    score.head_revision_id = 42
    session.add_all(
        [
            ScoreRevisionSource(
                source_uuid="restore-source-1",
                revision_id=41,
                format=RevisionSourceFormat.MUSICXML,
                storage_backend="local",
                storage_key=first.storage_key,
                filename=first.filename,
                mime_type="application/vnd.recordare.musicxml+xml",
                sha256=revision_1.content_hash,
                generator="test",
                generator_version="1",
            ),
            ScoreRevisionSource(
                source_uuid="restore-source-2",
                revision_id=42,
                format=RevisionSourceFormat.MUSICXML,
                storage_backend="local",
                storage_key=second.storage_key,
                filename=second.filename,
                mime_type="application/vnd.recordare.musicxml+xml",
                sha256=revision_2.content_hash,
                generator="test",
                generator_version="1",
            ),
        ]
    )
    session.commit()
    async_db = AsyncSessionAdapter(session)
    service = RevisionService(storage=storage)

    restored = await service.restore(  # type: ignore[arg-type]
        async_db,
        "score-restore",
        "revision-1",
        1,
        RevisionRestoreRequest(note="Return to the imported baseline"),
    )

    session.refresh(score)
    new_revision = (
        session.query(ScoreRevision)
        .filter(ScoreRevision.revision_uuid == restored.revision_id)
        .one()
    )
    new_artifact = (
        session.query(ScoreRevisionSource)
        .filter(ScoreRevisionSource.revision_id == new_revision.id)
        .one()
    )
    metadata = session.get(ScoreRevisionMetadata, new_revision.id)
    assert restored.revision_number == 3
    assert restored.parent_revision_id == "revision-2"
    assert restored.base_revision_id == "revision-1"
    assert restored.revision_id not in {"revision-1", "revision-2"}
    assert restored.created_by is not None
    assert restored.created_by.email == "owner@example.com"
    assert restored.restore is not None
    assert restored.restore.restored_from_revision_id == "revision-1"
    assert restored.restore.restored_from_revision_number == 1
    assert restored.restore.note == "Return to the imported baseline"
    assert score.head_revision_id == new_revision.id
    assert score.version == 3
    assert storage.read_bytes(new_artifact.storage_key) == MUSICXML_1
    assert metadata is not None
    assert metadata.status == MetadataStatus.READY
    assert session.query(RenderOutbox).count() == 1
    assert session.query(PlaybackOutbox).count() == 1
    event = session.query(ScoreRevisionEvent).one()
    assert event.revision_id == new_revision.id
    assert event.target_revision_id == 41
    assert event.note == "Return to the imported baseline"


@pytest.mark.asyncio
async def test_revision_note_can_be_added_updated_and_cleared(
    score_service_session: tuple[Session, LocalFileStorage],
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
    async_db = AsyncSessionAdapter(session)
    service = RevisionService(storage=storage)

    created = await service.update_note(  # type: ignore[arg-type]
        async_db,
        "score-revision-note",
        "revision-note",
        1,
        RevisionNoteUpdateRequest(note="Fixed page 3 rhythm"),
    )
    updated = await service.update_note(  # type: ignore[arg-type]
        async_db,
        "score-revision-note",
        "revision-note",
        1,
        RevisionNoteUpdateRequest(note="Fixed page 3 rhythm and fingering"),
    )
    cleared = await service.update_note(  # type: ignore[arg-type]
        async_db,
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
    assert session.query(ScoreRevisionNote).count() == 0


@pytest.mark.asyncio
async def test_derived_asset_retention_keeps_current_and_recent_history(
    score_service_session: tuple[Session, LocalFileStorage],
) -> None:
    session, storage = score_service_session
    score = Score(
        id=34,
        score_uuid="retention-score",
        owner_user_id=1,
        title="Retention Score",
        version=5,
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
        stored_keys[f"render-{revision.revision_number}"] = rendered.storage_key
        stored_keys[f"audio-{revision.revision_number}"] = audio.storage_key
        stored_keys[f"xml-{revision.revision_number}"] = musicxml.storage_key
        session.add_all(
            [
                ScoreRenderAsset(
                    asset_uuid=f"retention-render-{revision.revision_number}",
                    revision_id=revision_id,
                    kind=RenderAssetKind.RENDERED_PAGE,
                    storage_backend="local",
                    storage_key=rendered.storage_key,
                    filename=rendered.filename,
                    mime_type="image/svg+xml",
                    size_bytes=rendered.size_bytes,
                    sha256=f"r{revision.revision_number}" * 32,
                    page_number=1,
                    render_profile="default",
                    generator="test",
                    generator_version="1",
                ),
                ScoreRevisionSource(
                    source_uuid=f"retention-xml-{revision.revision_number}",
                    revision_id=revision_id,
                    format=RevisionSourceFormat.MUSICXML,
                    storage_backend="local",
                    storage_key=musicxml.storage_key,
                    filename=musicxml.filename,
                    mime_type="application/vnd.recordare.musicxml+xml",
                    size_bytes=musicxml.size_bytes,
                    sha256=f"x{revision.revision_number}" * 32,
                    generator="test",
                    generator_version="1",
                ),
                ScorePlaybackAsset(
                    asset_uuid=f"retention-audio-{revision.revision_number}",
                    revision_id=revision_id,
                    kind=PlaybackAssetKind.AUDIO,
                    storage_backend="local",
                    storage_key=audio.storage_key,
                    filename=audio.filename,
                    mime_type="audio/wav",
                    size_bytes=audio.size_bytes,
                    sha256=f"a{revision.revision_number}" * 32,
                    source_fingerprint=f"{revision.revision_number:064x}",
                    generator="test",
                    generator_version="1",
                ),
            ]
        )
    session.commit()
    service = DerivedAssetRetentionService(storage=storage)

    result = await service.cleanup_for_score(  # type: ignore[arg-type]
        AsyncSessionAdapter(session),
        score_id=34,
        head_revision_id=require_persisted_id(score.head_revision_id, entity="score revision"),
        retain_recent_revisions=2,
    )

    assert result.rendered_pages_deleted == 2
    assert result.playback_assets_deleted == 2
    assert session.query(ScoreRenderAsset).filter_by(kind=RenderAssetKind.RENDERED_PAGE).count() == 3
    assert session.query(ScorePlaybackAsset).count() == 3
    assert session.query(ScoreRevisionSource).filter_by(format=RevisionSourceFormat.MUSICXML).count() == 5
    for number in (1, 2):
        assert not storage.exists(stored_keys[f"render-{number}"])
        assert not storage.exists(stored_keys[f"audio-{number}"])
        assert storage.exists(stored_keys[f"xml-{number}"])
    for number in (3, 4, 5):
        assert storage.exists(stored_keys[f"render-{number}"])
        assert storage.exists(stored_keys[f"audio-{number}"])
        assert storage.exists(stored_keys[f"xml-{number}"])


@pytest.mark.asyncio
async def test_revision_list_uses_cursor_pagination(
    score_service_session: tuple[Session, LocalFileStorage],
) -> None:
    session, storage = score_service_session
    score = Score(
        id=32,
        score_uuid="score-revision-list",
        owner_user_id=1,
        title="Revision List Score",
        version=5,
    )
    revisions = [
        ScoreRevision(
            id=50 + number,
            revision_uuid=f"revision-{number}",
            score_id=32,
            revision_number=number,
            parent_revision_id=49 + number if number > 1 else None,
            base_revision_id=49 + number if number > 1 else None,
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
    async_db = AsyncSessionAdapter(session)
    service = RevisionService(storage=storage)

    first_page = await service.list(  # type: ignore[arg-type]
        async_db,
        "score-revision-list",
        1,
        limit=2,
    )
    second_page = await service.list(  # type: ignore[arg-type]
        async_db,
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
    score_service_session: tuple[Session, LocalFileStorage],
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
    now = utc_now_naive()
    stale = RenderOutbox(
        outbox_uuid="render-outbox-stale",
        target_type=RenderTargetType.SCORE_REVISION,
        score_id=score.id,
        revision_id=score.head_revision_id,
        source_fingerprint="stale-source",
        requested_by_user_id=1,
        render_profile="default",
        status=RenderOutboxStatus.DISPATCHED,
        dispatched_at=now - timedelta(hours=1),
        next_attempt_at=now - timedelta(minutes=1),
    )
    due_failure = RenderOutbox(
        outbox_uuid="render-outbox-failed",
        target_type=RenderTargetType.SCORE_REVISION,
        score_id=score.id,
        revision_id=score.head_revision_id,
        source_fingerprint="failed-source",
        requested_by_user_id=1,
        render_profile="compact",
        status=RenderOutboxStatus.FAILED,
        attempt_count=1,
        next_attempt_at=now - timedelta(minutes=1),
    )
    session.add_all([stale, due_failure])
    session.commit()

    due = RenderOutboxService().recover_and_list_due(session)

    assert due == ["render-outbox-stale", "render-outbox-failed"]
    session.refresh(stale)
    assert stale.status == RenderOutboxStatus.FAILED
    assert stale.last_error == "Render delivery lease expired"


def test_render_outbox_claim_failure_and_completion_are_persistent(
    score_service_session: tuple[Session, LocalFileStorage],
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
    outbox = RenderOutbox(
        outbox_uuid="render-outbox-claim",
        target_type=RenderTargetType.SCORE_REVISION,
        score_id=score.id,
        revision_id=score.head_revision_id,
        source_fingerprint="claim-source",
        requested_by_user_id=1,
    )
    session.add(outbox)
    session.commit()
    service = RenderOutboxService()

    payload = service.claim(session, outbox.outbox_uuid)
    session.commit()
    assert payload is not None
    assert payload.score_uuid == score.score_uuid
    assert payload.revision_uuid == "render-claim-revision"
    assert outbox.status == RenderOutboxStatus.PROCESSING
    assert outbox.attempt_count == 1

    service.fail(session, outbox.outbox_uuid, "temporary failure")
    session.commit()
    assert outbox.status == RenderOutboxStatus.FAILED
    assert outbox.last_error == "temporary failure"

    outbox.next_attempt_at = utc_now_naive() - timedelta(seconds=1)
    session.commit()
    payload = service.claim(session, outbox.outbox_uuid)
    session.commit()
    assert payload is not None
    service.complete(session, outbox.outbox_uuid)
    session.commit()
    assert outbox.status == RenderOutboxStatus.COMPLETED
    assert outbox.completed_at is not None
    assert outbox.last_error is None


def test_review_thumbnail_outbox_claims_only_the_current_musicxml(
    score_service_session: tuple[Session, LocalFileStorage],
) -> None:
    session, _storage = score_service_session
    job = ImportJob(
        id=413,
        job_uuid="review-thumbnail-job",
        user_id=1,
        state=ImportJobState.PENDING_REVIEW,
    )
    session.add(job)
    session.commit()
    session.add(
        ImportArtifact(
            job_id=413,
            artifact_uuid="review-thumbnail-source",
            kind=ImportArtifactKind.REVIEW_MUSICXML.value,
            storage_backend="local",
            storage_key="jobs/review-thumbnail-job/review_musicxml/score.musicxml",
            filename="score.musicxml",
            mime_type="application/vnd.recordare.musicxml+xml",
            sha256="current-source",
        )
    )
    current = RenderOutbox(
        outbox_uuid="review-thumbnail-current",
        target_type=RenderTargetType.REVIEW_THUMBNAIL,
        import_job_id=413,
        source_fingerprint="current-source",
        render_profile="review-thumbnail",
    )
    stale = RenderOutbox(
        outbox_uuid="review-thumbnail-stale",
        target_type=RenderTargetType.REVIEW_THUMBNAIL,
        import_job_id=413,
        source_fingerprint="stale-source",
        render_profile="review-thumbnail",
    )
    session.add_all([current, stale])
    session.commit()
    service = RenderOutboxService()

    payload = service.claim(session, current.outbox_uuid)
    stale_payload = service.claim(session, stale.outbox_uuid)
    session.commit()

    assert payload is not None
    assert payload.target_type == RenderTargetType.REVIEW_THUMBNAIL
    assert payload.job_uuid == job.job_uuid
    assert stale_payload is None
    assert stale.status == RenderOutboxStatus.COMPLETED


def test_mail_outbox_retries_and_scrubs_sensitive_content_after_delivery(
    score_service_session: tuple[Session, LocalFileStorage],
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
        expires_at=utc_now_naive() + timedelta(minutes=10),
    )
    session.add(outbox)
    session.commit()
    service = MailOutboxService()

    payload = service.claim(session, outbox.outbox_uuid)
    session.commit()
    assert payload is not None
    assert payload.text_body == "123456"
    assert outbox.status == MailOutboxStatus.PROCESSING

    service.transient_failure(session, outbox.outbox_uuid, "provider unavailable")
    session.commit()
    assert outbox.status == MailOutboxStatus.FAILED
    assert outbox.text_body == "123456"

    outbox.next_attempt_at = utc_now_naive() - timedelta(seconds=1)
    session.commit()
    assert service.claim(session, outbox.outbox_uuid) is not None
    service.sent(session, outbox.outbox_uuid, "resend-message-id")
    session.commit()

    assert outbox.status == MailOutboxStatus.SENT
    assert outbox.provider_message_id == "resend-message-id"
    assert outbox.text_body is None
    assert outbox.html_body is None


def test_expired_verification_mail_is_never_dispatched(
    score_service_session: tuple[Session, LocalFileStorage],
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
        expires_at=utc_now_naive() - timedelta(seconds=1),
    )
    session.add(outbox)
    session.commit()

    due = MailOutboxService().recover_and_list_due(session)

    assert due == []
    assert outbox.status == MailOutboxStatus.EXPIRED
    assert outbox.text_body is None
    assert outbox.html_body is None


def test_import_dispatch_claim_reconstructs_persisted_request(
    score_service_session: tuple[Session, LocalFileStorage],
) -> None:
    session, _storage = score_service_session
    job = ImportJob(
        id=501,
        job_uuid="import-dispatch-job",
        user_id=1,
        state=ImportJobState.PENDING,
        requested_options={"title": "Queued score"},
    )
    upload = Upload(
        id=502,
        upload_uuid="queued-upload",
        blob_id=602,
        original_filename="queued.png",
        uploader_user_id=1,
    )
    blob = StorageBlob(
        id=602,
        blob_uuid="queued-blob",
        sha256="queued-upload-sha",
        storage_backend="local",
        storage_key="blobs/qu/queued-upload-sha.png",
        filename="queued.png",
        size_bytes=5,
        mime_type="image/png",
    )
    session.add_all([job, blob, upload])
    session.flush()
    session.add(ImportJobUpload(job_id=501, upload_id=502, page_number=1, sort_order=1))
    session.commit()

    payload = ImportDispatchService().claim(session, job.job_uuid)
    session.commit()

    assert payload is not None
    assert payload.job_uuid == job.job_uuid
    assert payload.storage_keys == ["blobs/qu/queued-upload-sha.png"]
    assert payload.options == {"title": "Queued score"}
    assert job.dispatch_status == ImportDispatchStatus.PROCESSING
    assert job.dispatch_attempt_count == 1


def test_import_dispatch_recovers_stale_worker_without_failing_business_job(
    score_service_session: tuple[Session, LocalFileStorage],
) -> None:
    session, _storage = score_service_session
    now = utc_now_naive()
    job = ImportJob(
        id=503,
        job_uuid="stale-import-dispatch",
        user_id=1,
        state=ImportJobState.RUNNING,
        progress=65,
        current_step="ocr",
        dispatch_status=ImportDispatchStatus.PROCESSING,
        dispatch_attempt_count=1,
        dispatch_started_at=now - timedelta(hours=1),
        next_dispatch_at=now - timedelta(minutes=1),
    )
    session.add(job)
    session.commit()

    due = ImportDispatchService().recover_and_claim_due(session)

    assert due == [job.job_uuid]
    assert job.state == ImportJobState.PENDING
    assert job.dispatch_status == ImportDispatchStatus.DISPATCHED
    assert job.progress == 0
    assert job.current_step is None
    assert job.error is None


def test_import_dispatch_publish_failure_uses_exponential_backoff(
    score_service_session: tuple[Session, LocalFileStorage],
) -> None:
    session, _storage = score_service_session
    now = utc_now_naive()
    job = ImportJob(
        id=504,
        job_uuid="broker-backoff-job",
        user_id=1,
        state=ImportJobState.PENDING,
        dispatch_status=ImportDispatchStatus.DISPATCHED,
        dispatched_at=now,
        next_dispatch_at=now,
    )
    session.add(job)
    session.commit()

    ImportDispatchService().release_dispatch(session, job.job_uuid, "broker unavailable")
    session.commit()

    assert job.state == ImportJobState.PENDING
    assert job.dispatch_status == ImportDispatchStatus.PENDING
    assert job.publish_attempt_count == 1
    assert job.next_dispatch_at > now
    assert job.dispatch_error == "broker unavailable"


@pytest.mark.asyncio
async def test_collaborator_revision_save_notifies_score_owner(
    score_service_session: tuple[Session, LocalFileStorage],
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
    db = AsyncSessionAdapter(session)
    service = RevisionService(storage=storage)

    created = await service.create(
        db,  # type: ignore[arg-type]
        score.score_uuid,
        2,
        RevisionCreateRequest(content=MUSICXML_2, base_revision_id="collab-base-revision"),
    )

    notification = (
        session.query(NotificationEvent)
        .filter_by(
            recipient_user_id=1,
            actor_user_id=2,
            type=NotificationTypes.SCORE_VERSION_CREATED,
        )
        .one()
    )
    assert notification.score_id == "collab-revision-score"
    assert notification.resource_id == "collab-revision-score"
    assert notification.data["revision_id"] == created.revision_id
    assert notification.data["revision_number"] == created.revision_number
    assert session.query(NotificationEvent).filter_by(recipient_user_id=2).count() == 0

    revision = session.query(ScoreRevision).filter_by(revision_uuid=created.revision_id).one()
    actor = session.get(User, 2)
    assert actor is not None
    await service.notification_service.notify_score_version_created_best_effort(
        db,  # type: ignore[arg-type]
        score=score,
        revision=revision,
        actor=actor,
    )
    assert (
        session.query(NotificationEvent)
        .filter_by(
            recipient_user_id=1,
            actor_user_id=2,
            type=NotificationTypes.SCORE_VERSION_CREATED,
        )
        .count()
        == 1
    )


@pytest.mark.asyncio
async def test_generate_fingering_returns_xml_without_creating_revision(
    score_service_session: tuple[Session, LocalFileStorage],
) -> None:
    session, storage = score_service_session
    add_active_score_with_head_revision(
        session,
        score_id=301,
        revision_id=311,
        score_uuid="fingering-score",
        revision_uuid="fingering-revision",
        title="Fingering Score",
    )
    fingering_service = FakeFingeringService()
    service = RevisionService(storage=storage, fingering_service=fingering_service)
    revision_count = session.query(ScoreRevision).count()
    source_count = session.query(ScoreRevisionSource).count()

    result = await service.generate_fingering(
        AsyncSessionAdapter(session),  # type: ignore[arg-type]
        "fingering-score",
        1,
        FingeringRequest(content=MUSICXML_1.decode("utf-8"), hand_size="L"),
    )

    assert result.content == MUSICXML_2
    assert fingering_service.calls == [
        {
            "score_id": "fingering-score",
            "xml_content": MUSICXML_1.decode("utf-8"),
            "hand_size": "L",
        }
    ]
    assert session.query(ScoreRevision).count() == revision_count
    assert session.query(ScoreRevisionSource).count() == source_count


@pytest.mark.asyncio
async def test_generate_fingering_validates_input_and_generated_xml(
    score_service_session: tuple[Session, LocalFileStorage],
) -> None:
    session, storage = score_service_session
    add_active_score_with_head_revision(
        session,
        score_id=302,
        revision_id=312,
        score_uuid="invalid-fingering-score",
        revision_uuid="invalid-fingering-revision",
        title="Invalid Fingering Score",
    )
    service = RevisionService(
        storage=storage, fingering_service=FakeFingeringService(xml_content="<bad />")
    )
    db = AsyncSessionAdapter(session)

    with pytest.raises(ValidationException):
        await service.generate_fingering(
            db,  # type: ignore[arg-type]
            "invalid-fingering-score",
            1,
            FingeringRequest(content="<bad />"),
        )

    with pytest.raises(ValidationException):
        await service.generate_fingering(
            db,  # type: ignore[arg-type]
            "invalid-fingering-score",
            1,
            FingeringRequest(content=MUSICXML_1.decode("utf-8")),
        )


def test_strip_existing_fingerings_before_generation() -> None:
    xml = """<?xml version="1.0"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1"><measure number="1">
    <note>
      <pitch><step>C</step><octave>4</octave></pitch>
      <duration>1</duration>
      <notations><technical><fingering>5</fingering></technical></notations>
    </note>
    <note>
      <pitch><step>D</step><octave>4</octave></pitch>
      <duration>1</duration>
      <notations><technical><fingering>3</fingering></technical><slur type="start" number="1"/></notations>
    </note>
  </measure></part>
</score-partwise>"""

    stripped = strip_existing_fingerings(xml)

    assert "<fingering>" not in stripped
    assert "<technical" not in stripped
    assert "slur" in stripped


@pytest.mark.asyncio
async def test_source_delivery_checks_score_access_and_reports_missing_objects(
    score_service_session: tuple[Session, LocalFileStorage], tmp_path
) -> None:
    session, storage = score_service_session
    source = tmp_path / "score.musicxml"
    source.write_bytes(MUSICXML_1)
    session.add_all(
        [
            ImportJob(
                id=60,
                job_uuid="job-source",
                user_id=1,
                state=ImportJobState.RUNNING,
            ),
        ]
    )
    session.commit()
    score_uuid = SyncConfirmedScoreCreationService(storage).create_confirmed_from_job(
        session, "job-source", str(source), title="Source score"
    )
    score = session.query(Score).filter_by(score_uuid=score_uuid).one()
    revision = session.get(ScoreRevision, score.head_revision_id)
    revision_source = session.query(ScoreRevisionSource).filter_by(revision_id=revision.id).one()
    service = ScoreAssetService(storage=storage)
    async_db = AsyncSessionAdapter(session)

    delivery = await service.source_delivery(
        async_db,
        revision_source.source_uuid,
        1,  # type: ignore[arg-type]
    )
    assert delivery.path is not None

    with pytest.raises(UnauthorizedException):
        await service.source_delivery(
            async_db,
            revision_source.source_uuid,
            2,  # type: ignore[arg-type]
        )

    storage.delete(revision_source.storage_key)
    diagnostics = await service.diagnostics(
        async_db,  # type: ignore[arg-type]
        score_uuid,
        revision.revision_uuid,
        1,
    )
    assert diagnostics.missing_render_asset_ids == []


@pytest.mark.asyncio
async def test_score_access_policy_is_deny_by_default_and_context_aware(
    score_service_session: tuple[Session, LocalFileStorage],
) -> None:
    session, _storage = score_service_session
    score = Score(
        id=70,
        score_uuid="policy-score",
        owner_user_id=1,
        title="Policy score",
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
        parent_revision_id=71,
        base_revision_id=71,
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
            ScoreShareGrant(
                score_id=70,
                token_hash=hash_share_token("view-token"),
                allow_download=True,
                allow_practice=False,
                created_by_user_id=1,
            ),
            ScoreShareGrant(
                score_id=70,
                token_hash=hash_share_token("expired-token"),
                expires_at=utc_now_naive() - timedelta(minutes=1),
                created_by_user_id=1,
            ),
            ScorePublication(
                score_id=70,
                public_slug="public-policy-score",
                published_revision_id=71,
                status=PublicationStatus.PUBLISHED,
                allow_download=False,
                allow_practice=True,
                published_by_user_id=1,
            ),
        ]
    )
    session.commit()
    db = AsyncSessionAdapter(session)
    policy = ScoreAccessPolicy()

    owner = await policy.resolve(db, "policy-score", user_id=1)  # type: ignore[arg-type]
    assert owner.capabilities.can_edit is True
    assert owner.capabilities.can_publish is True

    member = await policy.resolve(db, "policy-score", user_id=2)  # type: ignore[arg-type]
    assert member.capabilities.can_view is True
    assert member.capabilities.can_edit is False
    with pytest.raises(UnauthorizedException):
        await policy.authorize(
            db,
            "policy-score",
            ScoreAction.EDIT,
            user_id=2,  # type: ignore[arg-type]
        )

    shared = await policy.resolve(
        db,
        "policy-score",
        share_token="view-token",  # type: ignore[arg-type]
    )
    assert shared.revision.revision_uuid == "policy-revision-2"
    assert shared.capabilities.can_download is True
    assert shared.capabilities.can_edit is False

    published = await policy.resolve(
        db,
        "policy-score",
        public_slug="public-policy-score",  # type: ignore[arg-type]
    )
    assert published.revision.revision_uuid == "policy-revision-1"
    assert published.capabilities.can_practice is True
    assert published.capabilities.can_download is False

    with pytest.raises(UnauthorizedException):
        await policy.resolve(db, "policy-score")  # type: ignore[arg-type]
    with pytest.raises(UnauthorizedException):
        await policy.resolve(
            db,
            "policy-score",
            share_token="expired-token",  # type: ignore[arg-type]
        )
    with pytest.raises(UnauthorizedException):
        await policy.resolve(
            db,  # type: ignore[arg-type]
            "policy-score",
            public_slug="public-policy-score",
            revision_uuid="policy-revision-2",
        )


@pytest.mark.asyncio
async def test_grant_redemption_and_bookmark_have_distinct_lifecycles(
    score_service_session: tuple[Session, LocalFileStorage],
) -> None:
    session, _storage = score_service_session
    score = Score(
        id=80,
        score_uuid="sharing-score",
        owner_user_id=1,
        title="Sharing score",
    )
    session.add(score)
    session.commit()
    revision = ScoreRevision(
        id=81,
        revision_uuid="sharing-revision",
        score_id=80,
        revision_number=1,
        content_hash="9" * 64,
        origin=RevisionOrigin.IMPORT,
    )
    session.add(revision)
    session.commit()
    score.head_revision_id = 81
    session.commit()
    db = AsyncSessionAdapter(session)
    service = ScoreSharingService()

    created = await service.create_grant(
        db,  # type: ignore[arg-type]
        "sharing-score",
        1,
        GrantCreateRequest(),
    )
    stored_grant = session.query(ScoreShareGrant).filter_by(grant_uuid=created.grant_id).one()
    assert "." not in created.token
    assert created.grant_id not in created.token
    assert stored_grant.token_hash == hash_share_token(created.token)
    assert created.token not in stored_grant.token_hash
    listed_grants = await service.list_grants(db, "sharing-score", 1)  # type: ignore[arg-type]
    assert listed_grants[0].token is None

    bookmarked = await service.bookmark_grant(
        db,
        created.token,
        2,  # type: ignore[arg-type]
    )
    assert bookmarked.available is True
    access = await service.access_grant(db, created.token, None)  # type: ignore[arg-type]
    assert access.shared_by is not None
    assert access.shared_by.display_name == "owner"
    assert access.shared_at == stored_grant.created_at

    await service.revoke_grant(db, created.grant_id, 1)  # type: ignore[arg-type]
    assert session.query(ShareGrantRedemption).count() == 1
    library_entry = session.query(ScoreLibraryEntry).one()
    assert library_entry.source_type == LibraryEntrySourceType.BOOKMARK
    assert library_entry.is_favorite is True
    assert library_entry.deleted_at is None


@pytest.mark.asyncio
async def test_create_grant_normalizes_aware_expiration_to_naive_utc(
    score_service_session: tuple[Session, LocalFileStorage],
) -> None:
    session, _storage = score_service_session
    score = Score(
        id=85,
        score_uuid="sharing-expiration-score",
        owner_user_id=1,
        title="Sharing expiration score",
    )
    revision = ScoreRevision(
        id=86,
        revision_uuid="sharing-expiration-revision",
        score_id=85,
        revision_number=1,
        content_hash="8" * 64,
        origin=RevisionOrigin.IMPORT,
    )
    session.add_all([score, revision])
    session.commit()
    score.head_revision_id = 86
    session.commit()

    db = AsyncSessionAdapter(session)
    service = ScoreSharingService()
    expires_at = datetime(2026, 6, 30, 13, 41, 35, tzinfo=timezone.utc)

    created = await service.create_grant(
        db,  # type: ignore[arg-type]
        "sharing-expiration-score",
        1,
        GrantCreateRequest(expires_at=expires_at),
    )

    stored_grant = session.query(ScoreShareGrant).filter_by(grant_uuid=created.grant_id).one()
    assert stored_grant.expires_at == datetime(2026, 6, 30, 13, 41, 35)
    assert stored_grant.expires_at.tzinfo is None


@pytest.mark.asyncio
async def test_share_detail_exposes_display_assets_without_musicxml_when_download_blocked(
    score_service_session: tuple[Session, LocalFileStorage],
) -> None:
    session, storage = score_service_session
    score = Score(
        id=210,
        score_uuid="share-derived-score",
        owner_user_id=1,
        title="Share Derived Score",
    )
    old_revision = ScoreRevision(
        id=211,
        revision_uuid="share-derived-revision-1",
        score_id=210,
        revision_number=1,
        content_hash="b1" * 32,
        origin=RevisionOrigin.IMPORT,
    )
    new_revision = ScoreRevision(
        id=212,
        revision_uuid="share-derived-revision-2",
        score_id=210,
        revision_number=2,
        content_hash="b2" * 32,
        origin=RevisionOrigin.EDIT,
        parent_revision_id=211,
        base_revision_id=211,
    )
    session.add_all([score, old_revision, new_revision])
    session.commit()
    score.head_revision_id = 212
    old_thumbnail = storage.put_bytes(
        key="scores/share-derived/revisions/old/render.svg",
        content=b"<svg />",
        content_type="image/svg+xml",
    )
    old_audio = storage.put_bytes(
        key="scores/share-derived/revisions/old/playback.wav",
        content=b"RIFF....WAVE",
        content_type="audio/wav",
    )
    new_xml = storage.put_bytes(
        key="scores/share-derived/revisions/new/score.musicxml",
        content=MUSICXML_2.encode("utf-8"),
        content_type="application/vnd.recordare.musicxml+xml",
    )
    session.add_all(
        [
            ScoreRenderAsset(
                asset_uuid="share-old-preview",
                revision_id=211,
                kind=RenderAssetKind.RENDERED_PAGE,
                storage_backend="local",
                storage_key=old_thumbnail.storage_key,
                filename=old_thumbnail.filename,
                mime_type="image/svg+xml",
                size_bytes=old_thumbnail.size_bytes,
                sha256="b" * 64,
                page_number=1,
                render_profile="default",
                generator="test",
                generator_version="1",
            ),
            ScorePlaybackAsset(
                asset_uuid="share-old-audio",
                revision_id=211,
                kind=PlaybackAssetKind.AUDIO,
                storage_backend="local",
                storage_key=old_audio.storage_key,
                filename=old_audio.filename,
                mime_type="audio/wav",
                size_bytes=old_audio.size_bytes,
                sha256="c" * 64,
                duration_ms=1000,
                source_fingerprint="b1" * 32,
                generator="test",
                generator_version="1",
            ),
            ScoreRevisionSource(
                source_uuid="share-new-musicxml",
                revision_id=212,
                format=RevisionSourceFormat.MUSICXML,
                storage_backend="local",
                storage_key=new_xml.storage_key,
                filename=new_xml.filename,
                mime_type="application/vnd.recordare.musicxml+xml",
                size_bytes=new_xml.size_bytes,
                sha256="d" * 64,
                generator="test",
                generator_version="1",
            ),
        ]
    )
    session.commit()

    db = AsyncSessionAdapter(session)
    sharing_service = ScoreSharingService()
    created = await sharing_service.create_grant(
        db,  # type: ignore[arg-type]
        "share-derived-score",
        1,
        GrantCreateRequest(allow_download=False, allow_practice=True),
    )

    detail = await sharing_service.access_grant(db, created.token, None)  # type: ignore[arg-type]
    assert detail.revision_assets.revision_sources == []
    assert detail.derived_assets.preview.asset_id == "share-old-preview"
    assert detail.derived_assets.preview.is_fallback is True
    assert detail.derived_assets.audio.asset_id == "share-old-audio"
    assert detail.derived_assets.audio.is_fallback is True

    playback = await PlaybackService(storage=storage).grant_delivery(
        db, created.token, None  # type: ignore[arg-type]
    )
    assert playback.path == storage.local_path(old_audio.storage_key)

    with pytest.raises(UnauthorizedException):
        await sharing_service.grant_revision_source_delivery(
            db,  # type: ignore[arg-type]
            created.token,
            "share-new-musicxml",
            None,
        )


@pytest.mark.asyncio
async def test_invite_acceptance_creates_editable_membership(
    score_service_session: tuple[Session, LocalFileStorage],
) -> None:
    session, _storage = score_service_session
    score = Score(
        id=87,
        score_uuid="invite-score",
        owner_user_id=1,
        title="Invite score",
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

    db = AsyncSessionAdapter(session)
    service = ScoreInviteService()
    created = await service.create_invite(
        db,  # type: ignore[arg-type]
        "invite-score",
        1,
        InviteCreateRequest(email="other@example.com", role=MembershipRole.EDITOR),
    )
    stored_invite = session.query(ScoreInvite).filter_by(invite_uuid=created.invite_id).one()
    assert "." not in created.token
    assert created.invite_id not in created.token
    assert stored_invite.token_hash == hash_invite_token(created.token)
    assert created.token not in stored_invite.token_hash
    queued_mail = session.query(MailOutbox).one()
    assert queued_mail.recipient == "other@example.com"
    assert "Invite score" in (queued_mail.text_body or "")
    assert f"/invite/{created.token}" in (queued_mail.text_body or "")
    assert "<html" in (queued_mail.html_body or "")
    assert f"/invite/{created.token}" in (queued_mail.html_body or "")

    listed = await service.list_invites(db, "invite-score", 1)  # type: ignore[arg-type]
    assert listed[0].invite_id == created.invite_id
    assert not hasattr(listed[0], "token")

    anonymous = await service.inspect_invite(db, created.token, None)  # type: ignore[arg-type]
    assert anonymous.requires_login is True
    assert anonymous.can_accept is False

    accepted = await service.accept_invite(db, created.token, 2)  # type: ignore[arg-type]
    assert accepted.score_id == "invite-score"
    assert accepted.role == MembershipRole.EDITOR
    assert accepted.membership_id is not None
    stored_membership = (
        session.query(ScoreMembership)
        .filter_by(
            score_id=87,
            user_id=2,
        )
        .one()
    )
    assert stored_membership.role == MembershipRole.EDITOR
    assert stored_invite.status == InviteStatus.ACCEPTED
    notification = (
        session.query(NotificationEvent)
        .filter_by(
            recipient_user_id=1,
            actor_user_id=2,
            type=NotificationTypes.SCORE_INVITE_ACCEPTED,
        )
        .one()
    )
    assert notification.score_id == "invite-score"
    assert notification.resource_id == "invite-score"
    assert notification.read_at is None

    policy = ScoreAccessPolicy()
    member_access = await policy.resolve(db, "invite-score", user_id=2)  # type: ignore[arg-type]
    assert member_access.capabilities.can_edit is True
    with pytest.raises(ValidationException) as accepted_again:
        await service.accept_invite(db, created.token, 2)  # type: ignore[arg-type]
    assert accepted_again.value.code == ErrorCode.INVITE_ALREADY_ACCEPTED


@pytest.mark.asyncio
async def test_invite_email_target_is_enforced(
    score_service_session: tuple[Session, LocalFileStorage],
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
    db = AsyncSessionAdapter(session)
    service = ScoreInviteService()

    created = await service.create_invite(
        db,  # type: ignore[arg-type]
        "targeted-invite-score",
        1,
        InviteCreateRequest(email="someone-else@example.com", role=MembershipRole.EDITOR),
    )

    inspected = await service.inspect_invite(db, created.token, 2)  # type: ignore[arg-type]
    assert inspected.requires_login is False
    assert inspected.can_accept is False
    assert session.query(MailOutbox).count() == 1
    with pytest.raises(ValidationException) as mismatch:
        await service.accept_invite(db, created.token, 2)  # type: ignore[arg-type]
    assert mismatch.value.code == ErrorCode.INVITE_EMAIL_MISMATCH
    assert session.query(ScoreMembership).filter_by(score_id=89, user_id=2).one_or_none() is None


@pytest.mark.asyncio
async def test_user_pending_invites_can_be_accepted_without_token(
    score_service_session: tuple[Session, LocalFileStorage],
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
    db = AsyncSessionAdapter(session)
    service = ScoreInviteService()

    created = await service.create_invite(
        db,  # type: ignore[arg-type]
        "pending-invite-score",
        1,
        InviteCreateRequest(email="other@example.com", role=MembershipRole.EDITOR),
    )
    pending = await service.list_my_pending_invites(db, 2)  # type: ignore[arg-type]

    assert [invite.invite_id for invite in pending] == [created.invite_id]
    assert pending[0].score_id == "pending-invite-score"
    assert pending[0].score_title == "Pending Invite"

    accepted = await service.accept_pending_invite(
        db,  # type: ignore[arg-type]
        created.invite_id,
        2,
    )

    assert accepted.score_id == "pending-invite-score"
    assert accepted.role == MembershipRole.EDITOR
    assert session.query(ScoreMembership).filter_by(score_id=91, user_id=2).one_or_none()
    assert await service.list_my_pending_invites(db, 2) == []  # type: ignore[arg-type]


@pytest.mark.asyncio
async def test_user_pending_invites_can_be_declined(
    score_service_session: tuple[Session, LocalFileStorage],
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
    db = AsyncSessionAdapter(session)
    service = ScoreInviteService()

    created = await service.create_invite(
        db,  # type: ignore[arg-type]
        "decline-invite-score",
        1,
        InviteCreateRequest(email="other@example.com", role=MembershipRole.VIEWER),
    )
    declined = await service.decline_pending_invite(
        db,  # type: ignore[arg-type]
        created.invite_id,
        2,
    )

    stored_invite = session.query(ScoreInvite).filter_by(invite_uuid=created.invite_id).one()
    assert declined.status == InviteStatus.DECLINED
    assert stored_invite.status == InviteStatus.DECLINED
    assert stored_invite.declined_at is not None
    notification = (
        session.query(NotificationEvent)
        .filter_by(
            recipient_user_id=1,
            actor_user_id=2,
            type=NotificationTypes.SCORE_INVITE_DECLINED,
        )
        .one()
    )
    assert notification.score_id == "decline-invite-score"
    assert notification.data["invite_id"] == created.invite_id
    assert await service.list_my_pending_invites(db, 2) == []  # type: ignore[arg-type]
    with pytest.raises(ValidationException) as declined_again:
        await service.accept_pending_invite(
            db,  # type: ignore[arg-type]
            created.invite_id,
            2,
        )
    assert declined_again.value.code == ErrorCode.INVITE_DECLINED


@pytest.mark.asyncio
async def test_notifications_are_scoped_and_can_be_marked_read(
    score_service_session: tuple[Session, LocalFileStorage],
) -> None:
    session, _storage = score_service_session
    db = AsyncSessionAdapter(session)
    service = NotificationService()

    created = await service.create_event(
        db,  # type: ignore[arg-type]
        recipient_user_id=1,
        actor_user_id=2,
        type=NotificationTypes.SYSTEM,
        resource_type="score",
        resource_id="score-1",
        score_id="score-1",
        title="System update",
        body="A score update is ready.",
        data={"kind": "test"},
    )
    assert created is not None

    owner_notifications = await service.list_for_user(db, 1)  # type: ignore[arg-type]
    other_notifications = await service.list_for_user(db, 2)  # type: ignore[arg-type]
    assert [item.notification_id for item in owner_notifications] == [created.notification_id]
    assert other_notifications == []
    assert (await service.unread_count(db, 1)).count == 1  # type: ignore[arg-type]
    assert (await service.unread_count(db, 2)).count == 0  # type: ignore[arg-type]

    with pytest.raises(ResourceNotFoundException):
        await service.mark_read(db, created.notification_id, 2)  # type: ignore[arg-type]

    marked = await service.mark_read(db, created.notification_id, 1)  # type: ignore[arg-type]
    assert marked.read_at is not None
    assert (await service.unread_count(db, 1)).count == 0  # type: ignore[arg-type]


@pytest.mark.asyncio
async def test_notification_dedupe_key_returns_existing_event(
    score_service_session: tuple[Session, LocalFileStorage],
) -> None:
    session, _storage = score_service_session
    db = AsyncSessionAdapter(session)
    service = NotificationService()

    first = await service.create_event(
        db,  # type: ignore[arg-type]
        recipient_user_id=1,
        actor_user_id=2,
        type=NotificationTypes.SYSTEM,
        resource_type="score",
        resource_id="score-1",
        score_id="score-1",
        title="First",
        body="First notification.",
        dedupe_key="system:test:score-1:owner",
    )
    second = await service.create_event(
        db,  # type: ignore[arg-type]
        recipient_user_id=1,
        actor_user_id=2,
        type=NotificationTypes.SYSTEM,
        resource_type="score",
        resource_id="score-1",
        score_id="score-1",
        title="Second",
        body="Second notification.",
        dedupe_key="system:test:score-1:owner",
    )

    assert first is not None
    assert second is not None
    assert second.notification_id == first.notification_id
    assert (
        session.query(NotificationEvent).filter_by(dedupe_key="system:test:score-1:owner").count()
        == 1
    )


@pytest.mark.asyncio
async def test_notification_cleanup_removes_events_older_than_retention(
    score_service_session: tuple[Session, LocalFileStorage],
) -> None:
    session, _storage = score_service_session
    db = AsyncSessionAdapter(session)
    service = NotificationService()
    now = utc_now_naive()

    old_event = NotificationEvent(
        recipient_user_id=1,
        actor_user_id=2,
        type=NotificationTypes.SYSTEM,
        resource_type="score",
        resource_id="old-score",
        title="Old notification",
        created_at=now - timedelta(days=91),
    )
    fresh_event = NotificationEvent(
        recipient_user_id=1,
        actor_user_id=2,
        type=NotificationTypes.SYSTEM,
        resource_type="score",
        resource_id="fresh-score",
        title="Fresh notification",
        created_at=now - timedelta(days=2),
    )
    session.add(old_event)
    session.add(fresh_event)
    session.commit()

    deleted = await service.cleanup_expired_events(
        db,  # type: ignore[arg-type]
        retention_days=90,
    )

    assert deleted == 1
    remaining = session.query(NotificationEvent).all()
    assert [event.resource_id for event in remaining] == ["fresh-score"]


def test_notification_maintenance_removes_events_older_than_retention(
    score_service_session: tuple[Session, LocalFileStorage],
) -> None:
    session, _storage = score_service_session
    service = NotificationMaintenanceService()
    now = utc_now_naive()

    session.add(
        NotificationEvent(
            recipient_user_id=1,
            actor_user_id=2,
            type=NotificationTypes.SYSTEM,
            resource_type="score",
            resource_id="old-score",
            title="Old notification",
            created_at=now - timedelta(days=91),
        )
    )
    session.add(
        NotificationEvent(
            recipient_user_id=1,
            actor_user_id=2,
            type=NotificationTypes.SYSTEM,
            resource_type="score",
            resource_id="fresh-score",
            title="Fresh notification",
            created_at=now - timedelta(days=2),
        )
    )
    session.commit()

    result = service.run(session)

    assert result.expired_notifications_deleted == 1
    remaining = session.query(NotificationEvent).all()
    assert [event.resource_id for event in remaining] == ["fresh-score"]


def test_realtime_maintenance_removes_events_older_than_retention(
    score_service_session: tuple[Session, LocalFileStorage],
) -> None:
    session, _storage = score_service_session
    service = RealtimeMaintenanceService()
    now = utc_now_naive()

    session.add(
        RealtimeEvent(
            recipient_user_id=1,
            type="score.derived_asset.updated",
            resource_type="score",
            resource_id="old-score",
            score_id="old-score",
            payload={"status": "ready"},
            created_at=now - timedelta(days=8),
        )
    )
    session.add(
        RealtimeEvent(
            recipient_user_id=1,
            type="score.derived_asset.updated",
            resource_type="score",
            resource_id="fresh-score",
            score_id="fresh-score",
            payload={"status": "ready"},
            created_at=now - timedelta(days=2),
        )
    )
    session.commit()

    result = service.run(session)

    assert result.expired_events_deleted == 1
    remaining = session.query(RealtimeEvent).all()
    assert [event.resource_id for event in remaining] == ["fresh-score"]


def test_realtime_maintenance_rejects_non_positive_retention(
    score_service_session: tuple[Session, LocalFileStorage],
) -> None:
    session, _storage = score_service_session
    service = RealtimeMaintenanceService()

    with pytest.raises(ValueError, match="realtime event retention days must be positive"):
        service.cleanup_expired_events(session, retention_days=0)


@pytest.mark.asyncio
async def test_publication_pins_revision_until_explicit_republish(
    score_service_session: tuple[Session, LocalFileStorage],
) -> None:
    session, storage = score_service_session
    score = Score(
        id=90,
        score_uuid="publication-score",
        owner_user_id=1,
        title="Public Score",
    )
    session.add(score)
    session.commit()
    first = ScoreRevision(
        id=91,
        revision_uuid="publication-revision-1",
        score_id=90,
        revision_number=1,
        content_hash="a1" * 32,
        origin=RevisionOrigin.IMPORT,
    )
    second = ScoreRevision(
        id=92,
        revision_uuid="publication-revision-2",
        score_id=90,
        revision_number=2,
        parent_revision_id=91,
        base_revision_id=91,
        content_hash="a2" * 32,
        origin=RevisionOrigin.EDIT,
    )
    session.add_all([first, second])
    session.commit()
    score.head_revision_id = 92
    session.commit()
    db = AsyncSessionAdapter(session)
    policy = ScoreAccessPolicy()
    asset_service = ScoreAssetService(storage=storage, access_policy=policy)
    service = PublicationService(access_policy=policy, asset_service=asset_service)

    published = await service.publish(
        db,  # type: ignore[arg-type]
        "publication-score",
        1,
        PublicationUpsertRequest(revision_id="publication-revision-1"),
    )
    public_detail = await service.public_detail(
        db,
        published.public_slug,  # type: ignore[arg-type]
    )
    assert public_detail.publication.revision_id == "publication-revision-1"

    republished = await service.publish(
        db,  # type: ignore[arg-type]
        "publication-score",
        1,
        PublicationUpsertRequest(revision_id="publication-revision-2"),
    )
    assert republished.revision_id == "publication-revision-2"

    await service.unpublish(db, "publication-score", 1)  # type: ignore[arg-type]
    with pytest.raises(ResourceNotFoundException):
        await service.public_detail(db, published.public_slug)  # type: ignore[arg-type]


@pytest.mark.asyncio
async def test_public_detail_exposes_derived_fallback_without_musicxml_when_download_blocked(
    score_service_session: tuple[Session, LocalFileStorage],
) -> None:
    session, storage = score_service_session
    score = Score(
        id=220,
        score_uuid="public-derived-score",
        owner_user_id=1,
        title="Public Derived Score",
    )
    old_revision = ScoreRevision(
        id=221,
        revision_uuid="public-derived-revision-1",
        score_id=220,
        revision_number=1,
        content_hash="e1" * 32,
        origin=RevisionOrigin.IMPORT,
    )
    new_revision = ScoreRevision(
        id=222,
        revision_uuid="public-derived-revision-2",
        score_id=220,
        revision_number=2,
        content_hash="e2" * 32,
        origin=RevisionOrigin.EDIT,
        parent_revision_id=221,
        base_revision_id=221,
    )
    session.add_all([score, old_revision, new_revision])
    session.commit()
    score.head_revision_id = 222
    old_thumbnail = storage.put_bytes(
        key="scores/public-derived/revisions/old/render.svg",
        content=b"<svg />",
        content_type="image/svg+xml",
    )
    new_xml = storage.put_bytes(
        key="scores/public-derived/revisions/new/score.musicxml",
        content=MUSICXML_2.encode("utf-8"),
        content_type="application/vnd.recordare.musicxml+xml",
    )
    session.add_all(
        [
            ScoreRenderAsset(
                asset_uuid="public-old-preview",
                revision_id=221,
                kind=RenderAssetKind.RENDERED_PAGE,
                storage_backend="local",
                storage_key=old_thumbnail.storage_key,
                filename=old_thumbnail.filename,
                mime_type="image/svg+xml",
                size_bytes=old_thumbnail.size_bytes,
                sha256="e" * 64,
                page_number=1,
                render_profile="default",
                generator="test",
                generator_version="1",
            ),
            ScoreRevisionSource(
                source_uuid="public-new-musicxml",
                revision_id=222,
                format=RevisionSourceFormat.MUSICXML,
                storage_backend="local",
                storage_key=new_xml.storage_key,
                filename=new_xml.filename,
                mime_type="application/vnd.recordare.musicxml+xml",
                size_bytes=new_xml.size_bytes,
                sha256="f" * 64,
                generator="test",
                generator_version="1",
            ),
        ]
    )
    session.commit()

    db = AsyncSessionAdapter(session)
    service = PublicationService(
        asset_service=ScoreAssetService(storage=storage),
        score_repository=ScoreRepository(),
    )
    published = await service.publish(
        db,  # type: ignore[arg-type]
        "public-derived-score",
        1,
        PublicationUpsertRequest(
            revision_id="public-derived-revision-2",
            public_slug="public-derived-score",
            allow_download=False,
            allow_practice=True,
        ),
    )

    detail = await service.public_detail(db, published.public_slug)  # type: ignore[arg-type]
    assert detail.revision_assets.revision_sources == []
    assert detail.derived_assets.preview.asset_id == "public-old-preview"
    assert detail.derived_assets.preview.is_fallback is True

    with pytest.raises(UnauthorizedException):
        await service.public_revision_source_delivery(
            db,  # type: ignore[arg-type]
            published.public_slug,
            "public-new-musicxml",
        )
