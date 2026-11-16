from uuid import uuid4

import pytest
import sqlalchemy as sa
from alembic import command
from pydantic import ValidationError
from sqlalchemy.orm import Session

from app.db.models import ImportArtifact, ImportJob, Score, Upload, User
from app.modules.import_jobs.artifact_kinds import ImportArtifactKind
from app.modules.import_jobs.schemas import ImportJobSubmitRequest
from app.modules.import_jobs.submission_service import ImportJobSubmissionService
from app.modules.import_jobs.service import ImportJobService
from app.modules.library.schemas import LibrarySort, LibraryView
from app.modules.library.service import LibraryService
from app.modules.import_jobs.review.schemas import ReviewConfirmRequest
from app.modules.import_jobs.review.service import ImportReviewService
from app.modules.scores.genres import ScoreGenre, ordered_unique_genres
from app.modules.scores.schemas import ScoreUpdateRequest
from app.modules.scores.service import ScoreService
from app.modules.storage_objects.persistence import object_from_bytes
from app.shared.time import utc_now
from tests.support.postgres_schema import postgres_schema_database
from tests.test_score_revision_services import (
    MUSICXML_1,
    add_active_score_with_head_revision,
    score_service_session as score_service_session,
)


@pytest.fixture
def genre_session(score_service_session):
    session, storage = score_service_session

    @sa.event.listens_for(session, "before_flush")
    def check_json_codes(db, *_):
        for row in db.new | db.dirty:
            if isinstance(row, Score):
                assert all(type(code) is str for code in row.genres)
            if isinstance(row, ImportJob) and row.requested_options is not None:
                assert all(type(code) is str for code in row.requested_options.get("genres", []))

    return session, storage


def test_genres_have_one_ordered_vocabulary_and_accept_every_subset():
    assert ordered_unique_genres(["jazz", "classical", "jazz"]) == ["classical", "jazz"]
    assert ordered_unique_genres(reversed(ScoreGenre)) == list(ScoreGenre)
    assert ordered_unique_genres([]) == []
    with pytest.raises(ValueError):
        ordered_unique_genres(["unknown"])


@pytest.mark.parametrize(
    "genres", [[genre.value for genre in ScoreGenre], ["jazz", "classical", "jazz"], []]
)
def test_request_boundaries_normalize_genres(genres):
    expected = ordered_unique_genres(genres)
    assert ScoreUpdateRequest(genres=genres, expected_version=1).genres == expected
    assert ReviewConfirmRequest(content="xml", genres=genres).genres == expected
    request = ImportJobSubmitRequest(upload_ids=["file"], options={"genres": genres})
    assert request.options == {"genres": expected}
    assert all(isinstance(genre, ScoreGenre) for genre in request.options["genres"])
    assert request.model_dump(mode="json")["options"]["genres"] == [
        genre.value for genre in expected
    ]


@pytest.mark.parametrize("genres", [["unknown"], [{"category": "genre", "code": "jazz"}], "jazz"])
def test_request_boundaries_reject_invalid_genre_values(genres):
    for schema, values in [
        (ScoreUpdateRequest, {"expected_version": 1, "genres": genres}),
        (ReviewConfirmRequest, {"content": "xml", "genres": genres}),
        (ImportJobSubmitRequest, {"upload_ids": ["file"], "options": {"genres": genres}}),
    ]:
        with pytest.raises(ValidationError):
            schema.model_validate(values)


def test_request_boundaries_reject_unrecognized_fields():
    for schema, values in [
        (ScoreUpdateRequest, {"expected_version": 1, "taxonomy_tags": []}),
        (ReviewConfirmRequest, {"content": "xml", "taxonomy_tags": []}),
        (ImportJobSubmitRequest, {"upload_ids": ["file"], "options": {"taxonomy_tags": []}}),
    ]:
        with pytest.raises(ValidationError):
            schema.model_validate(values)


def test_score_genres_replace_clear_and_preserve_with_version_checks(genre_session):
    session, storage = genre_session
    score = add_active_score_with_head_revision(
        session,
        score_id=1,
        revision_id=1,
        score_uuid="genre-score",
        revision_uuid="genre-head",
        title="Genres",
    )
    db = session
    service = ScoreService(storage=storage)
    for patch, expected in [
        ({"genres": list(reversed(ScoreGenre))}, list(ScoreGenre)),
        ({"display_title": "Renamed"}, list(ScoreGenre)),
        ({"genres": None}, list(ScoreGenre)),
        ({"genres": []}, []),
    ]:
        current_version = score.version
        read = service.update(
            db, score.score_uuid, 1, ScoreUpdateRequest(expected_version=current_version, **patch)
        )
        session.refresh(score)
        assert score.genres == read.genres == expected
        assert all(type(code) is str for code in score.genres)
        assert all(isinstance(genre, ScoreGenre) for genre in read.genres)
        assert read.model_dump(mode="json")["genres"] == [genre.value for genre in read.genres]
        assert score.version == current_version + 1
    from app.core.exceptions import ConflictException

    with pytest.raises(ConflictException):
        service.update(
            db, score.score_uuid, 1, ScoreUpdateRequest(expected_version=1, genres=["jazz"])
        )


@pytest.mark.parametrize(
    ("requested", "override", "expected"),
    [
        (["jazz", "classical", "jazz"], None, ["classical", "jazz"]),
        (["classical"], ["rock", "jazz"], ["jazz", "rock"]),
        (list(ScoreGenre), None, list(ScoreGenre)),
        (["classical"], [], []),
    ],
)
def test_import_review_score_and_library_share_score_genres(
    genre_session, monkeypatch, requested, override, expected
):
    session, storage = genre_session
    original = object_from_bytes(
        object_key="uploads/genre.png", content=b"image", content_type="image/png"
    )
    session.add(original)
    session.flush()
    upload = Upload(stored_object_id=original.id, uploader_user_id=1, original_filename="page.png")
    session.add(upload)
    session.commit()
    result = ImportJobSubmissionService().submit(
        session,
        session.get(User, 1),
        ImportJobSubmitRequest(
            upload_ids=[upload.upload_uuid],
            options={"display_title": "Genres", "genres": requested},
        ),
    )
    job = session.scalar(sa.select(ImportJob).where(ImportJob.job_uuid == result["job_id"]))
    assert all(type(code) is str for code in job.requested_options["genres"])
    assert job.requested_options == {
        "display_title": "Genres",
        "genres": ordered_unique_genres(requested),
    }
    from app.modules.import_jobs.lifecycle import begin_processing, mark_ready_for_review

    begin_processing(job, now=utc_now())
    mark_ready_for_review(job, now=utc_now())
    xml = object_from_bytes(
        object_key="jobs/genres/score.musicxml",
        content=MUSICXML_1,
        content_type="application/vnd.recordare.musicxml+xml",
    )
    storage.put_bytes(key=xml.object_key, content=MUSICXML_1, content_type=xml.content_type)
    session.add(
        ImportArtifact(
            job_id=job.id,
            kind=ImportArtifactKind.REVIEW_MUSICXML.value,
            stored_object=xml,
            filename="score.musicxml",
        )
    )
    session.commit()
    db = session
    review = ImportReviewService(storage=storage)
    assert (review.detail(db, job.job_uuid, 1)).genres == ordered_unique_genres(requested)
    assert (ImportJobService().detail(db, job.job_uuid, 1)).genres == ordered_unique_genres(
        requested
    )
    values = {"content": MUSICXML_1.decode()}
    if override is not None:
        values["genres"] = override
    confirmed = review.confirm(db, job.job_uuid, 1, ReviewConfirmRequest.model_validate(values))
    score = session.scalar(sa.select(Score).where(Score.score_uuid == confirmed.score_id))
    assert score.genres == expected
    assert all(type(code) is str for code in score.genres)
    assert (ScoreService(storage=storage).get(db, score.score_uuid, 1)).genres == expected
    entries, total = LibraryService().list_scores(
        db,
        1,
        view=LibraryView.ALL,
        folder_id=None,
        search=None,
        sort=LibrarySort.UPDATED_DESC,
        page=1,
        page_size=20,
    )
    assert total == 1 and entries[0].genres == expected
    assert (review.detail(db, job.job_uuid, 1)).genres == expected
    score.genres = ["pop"]
    session.commit()
    assert (review.detail(db, job.job_uuid, 1)).genres == ["pop"]


def test_score_schema_stores_genres_as_jsonb(monkeypatch):
    with postgres_schema_database(monkeypatch) as (engine, config):
        command.upgrade(config, "head")
        inspector = sa.inspect(engine)
        assert set(inspector.get_table_names()).isdisjoint(
            {"taxonomy_categories", "taxonomy_tags", "score_taxonomy_tags"}
        )
        genre_column = next(c for c in inspector.get_columns("scores") if c["name"] == "genres")
        assert isinstance(genre_column["type"], sa.dialects.postgresql.JSONB)
        assert not genre_column["nullable"]
        with Session(engine) as session:
            session.add(User(id=1, email="genres@example.com", password_hash="hash"))
            session.commit()
            score = Score(
                score_uuid=str(uuid4()),
                owner_user_id=1,
                display_title="Genres",
                genres=[genre.value for genre in ScoreGenre],
            )
            session.add(score)
            session.commit()
            session.expire_all()
            assert session.get(Score, score.id).genres == list(ScoreGenre)
