from __future__ import annotations
from app.db.models import StoredObject

from collections.abc import Iterator

import pytest
from sqlalchemy import event
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from sqlmodel import SQLModel, create_engine

from app.db.models.score import (
    MetadataStatus,
    RenderAssetKind,
    RevisionOrigin,
    RevisionSourceFormat,
    Score,
    ScoreRenderAsset,
    ScoreRevision,
    ScoreRevisionMetadata,
    ScoreRevisionSource,
)
from app.db.models.score_access import (
    MembershipRole,
    ScoreMembership,
)
from app.db.models.library import ScoreLibraryOrganization
from app.db.models.user import User


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
                ),
                User(
                    id=2,
                    email="member@example.com",
                    display_name="member",
                    password_hash="hash",
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
                ),
                Score(
                    id=11,
                    score_uuid="score-11",
                    owner_user_id=1,
                    title="Second score",
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


def revision_source(*, source_id: int, key: str) -> ScoreRevisionSource:
    return ScoreRevisionSource(
        id=source_id,
        source_uuid=f"source-{source_id}",
        revision_id=100,
        format=RevisionSourceFormat.MUSICXML,
        stored_object=StoredObject(
            object_key=key,
            byte_size=0,
            content_type="application/vnd.recordare.musicxml+xml",
            sha256=str(source_id).zfill(64),
        ),
        filename="score.musicxml",
        generator="noteverse",
        generator_version="1",
    )


def render_asset(*, asset_id: int, key: str) -> ScoreRenderAsset:
    return ScoreRenderAsset(
        id=asset_id,
        asset_uuid=f"asset-{asset_id}",
        revision_id=100,
        kind=RenderAssetKind.RENDERED_PAGE,
        stored_object=StoredObject(
            object_key=key,
            byte_size=0,
            content_type="image/svg+xml",
            sha256=str(asset_id).zfill(64),
        ),
        filename="page.svg",
        generator="noteverse",
        generator_version="1",
    )


def test_revision_numbers_are_positive_and_unique(score_session: Session) -> None:
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
            id=104,
            revision_uuid="invalid-number",
            score_id=10,
            revision_number=0,
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
    score_session.add(revision_source(source_id=200, key="scores/10/revisions/100/musicxml.xml"))
    score_session.commit()

    assert_commit_rejected(
        score_session,
        revision_source(
            source_id=201,
            key="scores/10/revisions/100/duplicate.musicxml",
        ),
    )
    assert_commit_rejected(
        score_session,
        render_asset(
            asset_id=202,
            key="scores/10/revisions/100/page.svg",
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


def test_score_guest_preview_token_is_unique(score_session: Session) -> None:
    first = score_session.get(Score, 10)
    second = score_session.get(Score, 11)
    assert first.guest_preview_token != second.guest_preview_token
    second.guest_preview_token = first.guest_preview_token
    with pytest.raises(IntegrityError):
        score_session.commit()
    score_session.rollback()


def test_membership_and_library_organization_are_unique_per_user(
    score_session: Session,
) -> None:
    score_session.add_all(
        [
            ScoreMembership(
                id=400,
                score_id=10,
                user_id=2,
                role=MembershipRole.VIEWER,
                created_by_user_id=1,
            ),
            ScoreLibraryOrganization(id=500, score_id=10, user_id=2),
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
        ScoreLibraryOrganization(id=501, score_id=10, user_id=2),
    )
