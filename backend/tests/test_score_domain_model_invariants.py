from __future__ import annotations

from collections.abc import Iterator

import pytest
from sqlalchemy import event
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, SQLModel, create_engine

from app.db.models.score import (
    ArtifactKind,
    MetadataStatus,
    RevisionOrigin,
    Score,
    ScoreArtifact,
    ScoreRevision,
    ScoreRevisionMetadata,
    ScoreState,
)
from app.db.models.score_access import (
    MembershipRole,
    PublicationDiscoverability,
    PublicationStatus,
    ScoreMembership,
    ScorePublication,
    ScoreShareGrant,
    ShareTargetMode,
)
from app.db.models.library import LibraryEntrySourceType, ScoreLibraryEntry
from app.db.models.user import User, UserRole


@pytest.fixture
def score_session() -> Iterator[Session]:
    engine = create_engine("sqlite:///:memory:")

    @event.listens_for(engine, "connect")
    def enable_sqlite_foreign_keys(dbapi_connection, _connection_record) -> None:
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    SQLModel.metadata.create_all(engine)
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
                    email="member@example.com",
                    display_name="member",
                    password_hash="hash",
                    role=UserRole.user,
                ),
            ]
        )
        session.commit()
        session.add_all(
            [
                Score(
                    id=10,
                    score_uuid="score-10",
                    owner_user_id=1,
                    title="First score",
                    state=ScoreState.ACTIVE,
                ),
                Score(
                    id=11,
                    score_uuid="score-11",
                    owner_user_id=1,
                    title="Second score",
                    state=ScoreState.ACTIVE,
                ),
            ]
        )
        session.commit()
        session.add_all(
            [
                ScoreRevision(
                    id=100,
                    revision_uuid="revision-100",
                    score_id=10,
                    revision_number=1,
                    content_hash="a" * 64,
                    origin=RevisionOrigin.IMPORT,
                ),
                ScoreRevision(
                    id=101,
                    revision_uuid="revision-101",
                    score_id=11,
                    revision_number=1,
                    content_hash="b" * 64,
                    origin=RevisionOrigin.IMPORT,
                ),
            ]
        )
        session.commit()
        yield session
    engine.dispose()


def assert_commit_rejected(session: Session, instance: SQLModel) -> None:
    session.add(instance)
    with pytest.raises(IntegrityError):
        session.commit()
    session.rollback()


def artifact(*, artifact_id: int, key: str, kind: ArtifactKind) -> ScoreArtifact:
    return ScoreArtifact(
        id=artifact_id,
        artifact_uuid=f"artifact-{artifact_id}",
        revision_id=100,
        kind=kind,
        storage_backend="local",
        storage_key=key,
        filename="score.musicxml",
        mime_type="application/vnd.recordare.musicxml+xml",
        sha256=str(artifact_id).zfill(64),
        generator="noteverse",
        generator_version="1",
    )


def test_revision_order_content_and_lineage_are_constrained(score_session: Session) -> None:
    assert_commit_rejected(
        score_session,
        ScoreRevision(
            id=102,
            revision_uuid="duplicate-number",
            score_id=10,
            revision_number=1,
            content_hash="c" * 64,
            origin=RevisionOrigin.EDIT,
        ),
    )
    assert_commit_rejected(
        score_session,
        ScoreRevision(
            id=103,
            revision_uuid="duplicate-content",
            score_id=10,
            revision_number=2,
            content_hash="a" * 64,
            origin=RevisionOrigin.EDIT,
        ),
    )
    assert_commit_rejected(
        score_session,
        ScoreRevision(
            id=104,
            revision_uuid="cross-score-base",
            score_id=10,
            revision_number=2,
            base_revision_id=101,
            content_hash="d" * 64,
            origin=RevisionOrigin.EDIT,
        ),
    )


def test_score_revision_pointer_cannot_cross_scores(score_session: Session) -> None:
    score = score_session.get(Score, 10)
    assert score is not None
    score.head_revision_id = 101
    with pytest.raises(IntegrityError):
        score_session.commit()
    score_session.rollback()


def test_artifact_constraints_protect_canonical_and_rendered_payloads(
    score_session: Session,
) -> None:
    score_session.add(artifact(artifact_id=200, key="scores/10/revisions/100/musicxml.xml", kind=ArtifactKind.MUSICXML))
    score_session.commit()

    assert_commit_rejected(
        score_session,
        artifact(
            artifact_id=201,
            key="scores/10/revisions/100/duplicate.musicxml",
            kind=ArtifactKind.MUSICXML,
        ),
    )
    assert_commit_rejected(
        score_session,
        artifact(
            artifact_id=202,
            key="scores/10/revisions/100/page.svg",
            kind=ArtifactKind.RENDERED_PAGE,
        ),
    )


def test_metadata_status_requires_a_classified_failure(score_session: Session) -> None:
    assert_commit_rejected(
        score_session,
        ScoreRevisionMetadata(
            revision_id=100,
            status=MetadataStatus.FAILED,
            extractor_version="metadata-v1",
        ),
    )


def test_share_target_and_token_hash_are_constrained(score_session: Session) -> None:
    assert_commit_rejected(
        score_session,
        ScoreShareGrant(
            id=300,
            score_id=10,
            token_hash="1" * 64,
            target_mode=ShareTargetMode.PINNED,
            target_revision_id=None,
            created_by_user_id=1,
        ),
    )
    assert_commit_rejected(
        score_session,
        ScoreShareGrant(
            id=301,
            score_id=10,
            token_hash="2" * 64,
            target_mode=ShareTargetMode.PINNED,
            target_revision_id=101,
            created_by_user_id=1,
        ),
    )

    score_session.add(
        ScoreShareGrant(
            id=302,
            score_id=10,
            token_hash="3" * 64,
            target_mode=ShareTargetMode.LATEST,
            created_by_user_id=1,
        )
    )
    score_session.commit()
    assert_commit_rejected(
        score_session,
        ScoreShareGrant(
            id=303,
            score_id=10,
            token_hash="3" * 64,
            target_mode=ShareTargetMode.LATEST,
            created_by_user_id=1,
        ),
    )


def test_membership_and_library_entry_are_unique_per_user_and_source(score_session: Session) -> None:
    score_session.add_all(
        [
            ScoreMembership(
                id=400,
                score_id=10,
                user_id=2,
                role=MembershipRole.VIEWER,
                created_by_user_id=1,
            ),
            ScoreLibraryEntry(id=500, score_id=10, user_id=2, source_type=LibraryEntrySourceType.BOOKMARK),
        ]
    )
    score_session.commit()

    assert_commit_rejected(
        score_session,
        ScoreMembership(
            id=401,
            score_id=10,
            user_id=2,
            role=MembershipRole.EDITOR,
            created_by_user_id=1,
        ),
    )
    assert_commit_rejected(
        score_session,
        ScoreLibraryEntry(id=501, score_id=10, user_id=2, source_type=LibraryEntrySourceType.BOOKMARK),
    )


def test_publication_must_pin_a_revision_from_its_score(score_session: Session) -> None:
    assert_commit_rejected(
        score_session,
        ScorePublication(
            id=600,
            score_id=10,
            public_slug="cross-score-revision",
            published_revision_id=101,
            status=PublicationStatus.PUBLISHED,
            discoverability=PublicationDiscoverability.LISTED,
            published_by_user_id=1,
        ),
    )
