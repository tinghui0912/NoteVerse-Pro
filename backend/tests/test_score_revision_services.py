from __future__ import annotations

from collections.abc import Iterator
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import event
from sqlmodel import Session, SQLModel, create_engine

from app.core.exceptions import (
    ConflictException,
    ResourceNotFoundException,
    UnauthorizedException,
)
from app.db.models import (
    ProcessingJob,
    Score,
    ScoreArtifact,
    ScoreRevision,
    ScoreRevisionMetadata,
    ScoreLibraryEntry,
    ScoreMembership,
    ScorePublication,
    ScoreShareGrant,
    ShareGrantRedemption,
    User,
)
from app.db.models.library import LibraryEntrySourceType
from app.db.models.processing_job import ProcessingJobState
from app.db.models.score import ArtifactKind, RevisionOrigin, ScoreState
from app.db.models.score import MetadataStatus
from app.db.models.score_access import (
    MembershipRole,
    PublicationDiscoverability,
    PublicationStatus,
    ShareTargetMode,
)
from app.db.models.user import UserRole
from app.modules.revisions.schemas import RevisionCreateRequest
from app.modules.revisions.service import RevisionService
from app.modules.artifacts.service import ArtifactService
from app.modules.scores.creation_service import SyncScoreCreationService
from app.modules.score_access.policy import ScoreAccessPolicy, ScoreAction, hash_share_token
from app.modules.score_sharing.schemas import GrantCreateRequest
from app.modules.score_sharing.service import ScoreSharingService
from app.modules.publications.schemas import PublicationUpsertRequest
from app.modules.publications.service import PublicationService
from app.shared.constants import ErrorCode
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

    async def execute(self, statement):
        return self.session.execute(statement)

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
            [User(
                id=1,
                email="owner@example.com",
                display_name="owner",
                password_hash="hash",
                role=UserRole.user,
            ), User(
                id=2,
                email="other@example.com",
                display_name="other",
                password_hash="hash",
                role=UserRole.user,
            )]
        )
        session.commit()
        yield session, storage
    engine.dispose()


def test_completed_job_creates_one_score_and_initial_revision(
    score_service_session: tuple[Session, LocalFileStorage], tmp_path
) -> None:
    session, storage = score_service_session
    session.add_all(
        [
            ProcessingJob(
                id=10,
                job_uuid="job-1",
                user_id=1,
                state=ProcessingJobState.PROGRESS,
            ),
        ]
    )
    session.commit()
    source = tmp_path / "score.musicxml"
    source.write_bytes(MUSICXML_1)
    service = SyncScoreCreationService(storage)

    first_id = service.create_from_job(
        session, "job-1", str(source), title="Recognized score"
    )
    second_id = service.create_from_job(
        session, "job-1", str(source), title="Recognized score"
    )

    assert first_id == second_id
    assert session.query(Score).count() == 1
    score = session.query(Score).one()
    revision = session.query(ScoreRevision).one()
    artifact = session.query(ScoreArtifact).one()
    metadata = session.get(ScoreRevisionMetadata, revision.id)
    assert score.head_revision_id == revision.id
    assert score.approved_revision_id is None
    assert score.state == ScoreState.IN_REVIEW
    assert artifact.kind == ArtifactKind.MUSICXML
    assert storage.exists(artifact.storage_key)
    assert metadata is not None
    assert metadata.status == MetadataStatus.READY
    assert metadata.measure_count == 1
    assert metadata.playback_duration_ms == 2000


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
        state=ScoreState.ACTIVE,
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
        ScoreArtifact(
            id=50,
            artifact_uuid="artifact-1",
            revision_id=40,
            kind=ArtifactKind.MUSICXML,
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

    assert duplicate.revision_id == created.revision_id
    assert session.query(ScoreRevision).count() == 2

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
async def test_artifact_delivery_checks_score_access_and_reports_missing_objects(
    score_service_session: tuple[Session, LocalFileStorage], tmp_path
) -> None:
    session, storage = score_service_session
    source = tmp_path / "score.musicxml"
    source.write_bytes(MUSICXML_1)
    session.add_all(
        [
            ProcessingJob(
                id=60,
                job_uuid="job-artifact",
                user_id=1,
                state=ProcessingJobState.PROGRESS,
            ),
        ]
    )
    session.commit()
    score_uuid = SyncScoreCreationService(storage).create_from_job(
        session, "job-artifact", str(source), title="Artifact score"
    )
    score = session.query(Score).filter_by(score_uuid=score_uuid).one()
    revision = session.get(ScoreRevision, score.head_revision_id)
    artifact = session.query(ScoreArtifact).filter_by(revision_id=revision.id).one()
    service = ArtifactService(storage=storage)
    async_db = AsyncSessionAdapter(session)

    delivery = await service.delivery(
        async_db, artifact.artifact_uuid, 1  # type: ignore[arg-type]
    )
    assert delivery.path is not None

    with pytest.raises(UnauthorizedException):
        await service.delivery(
            async_db, artifact.artifact_uuid, 2  # type: ignore[arg-type]
        )

    storage.delete(artifact.storage_key)
    diagnostics = await service.diagnostics(
        async_db,  # type: ignore[arg-type]
        score_uuid,
        revision.revision_uuid,
        1,
    )
    assert diagnostics.missing_artifact_ids == [artifact.artifact_uuid]


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
        state=ScoreState.ACTIVE,
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
                target_mode=ShareTargetMode.PINNED,
                target_revision_id=71,
                allow_download=True,
                allow_practice=False,
                created_by_user_id=1,
            ),
            ScoreShareGrant(
                score_id=70,
                token_hash=hash_share_token("expired-token"),
                target_mode=ShareTargetMode.LATEST,
                expires_at=utc_now_naive() - timedelta(minutes=1),
                created_by_user_id=1,
            ),
            ScorePublication(
                score_id=70,
                public_slug="public-policy-score",
                published_revision_id=71,
                status=PublicationStatus.PUBLISHED,
                discoverability=PublicationDiscoverability.LISTED,
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
            db, "policy-score", ScoreAction.EDIT, user_id=2  # type: ignore[arg-type]
        )

    shared = await policy.resolve(
        db, "policy-score", share_token="view-token"  # type: ignore[arg-type]
    )
    assert shared.revision.revision_uuid == "policy-revision-1"
    assert shared.capabilities.can_download is True
    assert shared.capabilities.can_edit is False

    published = await policy.resolve(
        db, "policy-score", public_slug="public-policy-score"  # type: ignore[arg-type]
    )
    assert published.revision.revision_uuid == "policy-revision-1"
    assert published.capabilities.can_practice is True
    assert published.capabilities.can_download is False

    with pytest.raises(UnauthorizedException):
        await policy.resolve(db, "policy-score")  # type: ignore[arg-type]
    with pytest.raises(UnauthorizedException):
        await policy.resolve(
            db, "policy-score", share_token="expired-token"  # type: ignore[arg-type]
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
        state=ScoreState.ACTIVE,
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
    stored_grant = session.query(ScoreShareGrant).filter_by(
        grant_uuid=created.grant_id
    ).one()
    assert created.token.startswith(f"{created.grant_id}.")
    assert stored_grant.token_hash == hash_share_token(created.token)
    assert created.token not in stored_grant.token_hash
    listed_grants = await service.list_grants(db, "sharing-score", 1)  # type: ignore[arg-type]
    assert listed_grants[0].token is None

    bookmarked = await service.bookmark_grant(
        db, created.token, 2  # type: ignore[arg-type]
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
        state=ScoreState.ACTIVE,
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

    stored_grant = session.query(ScoreShareGrant).filter_by(
        grant_uuid=created.grant_id
    ).one()
    assert stored_grant.expires_at == datetime(2026, 6, 30, 13, 41, 35)
    assert stored_grant.expires_at.tzinfo is None


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
        state=ScoreState.ACTIVE,
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
    artifact_service = ArtifactService(storage=storage, access_policy=policy)
    service = PublicationService(
        access_policy=policy, artifact_service=artifact_service
    )

    published = await service.publish(
        db,  # type: ignore[arg-type]
        "publication-score",
        1,
        PublicationUpsertRequest(revision_id="publication-revision-1"),
    )
    public_detail = await service.public_detail(
        db, published.public_slug  # type: ignore[arg-type]
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
