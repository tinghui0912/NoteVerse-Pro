"""Score metadata CAS and immutable revision head CAS are independent domains."""

from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

import pytest
import sqlalchemy as sa
from sqlalchemy.orm import Session

from app.core.exceptions import ConflictException
from app.db.models import Score, ScoreRevision
from app.modules.revisions.schemas import RevisionRestoreRequest
from app.modules.revisions.service import RevisionService
from app.modules.revisions.writer import AppendRevisionWrite, revision_writer
from app.db.models.score import RevisionOrigin
from app.modules.scores.schemas import ScoreUpdateRequest
from app.modules.scores.service import ScoreService
from tests.test_revision_writer_postgres import database as database, initial, prepare
from tests.test_score_revision_services import MUSICXML_2


def append(database, expected_head):
    engine, storage = database
    source = prepare(engine, storage, MUSICXML_2)
    with Session(engine) as db:
        result = revision_writer.write(
            db, AppendRevisionWrite("score", 1, source, expected_head, RevisionOrigin.EDIT)
        )
        db.commit()
        return result.revision.revision_uuid


def update(database, expected_version=1, **patch):
    engine, storage = database
    with Session(engine) as db:
        return ScoreService(storage=storage).update(
            db, "score", 1, ScoreUpdateRequest(expected_metadata_version=expected_version, **patch)
        )


@pytest.mark.parametrize("first", ["metadata", "revision"])
def test_observed_metadata_token_and_head_survive_the_other_domain_write(database, first):
    engine, storage = database
    head = initial(database)
    if first == "metadata":
        metadata = update(database, display_title="Renamed")
        assert metadata.metadata_version == 2
        assert metadata.head_revision_id == head
        with Session(engine) as db:
            assert db.scalar(sa.select(sa.func.count()).select_from(ScoreRevision)) == 1
        new_head = append(database, head)
    else:
        new_head = append(database, head)
        metadata = update(database, display_title="Renamed")
        assert metadata.metadata_version == 2
        assert metadata.head_revision_id == new_head
    with Session(engine) as db:
        read = ScoreService(storage=storage).get(db, "score", 1)
        assert read.metadata_version == 2
        assert read.display_title == "Renamed"
        assert read.head_revision_id == new_head
        assert read.head_revision_number == 2


def test_simultaneous_metadata_and_revision_writes_both_succeed(database):
    engine, storage = database
    head = initial(database)
    source = prepare(engine, storage, MUSICXML_2)
    ready = Barrier(2)

    def metadata_writer():
        ready.wait(timeout=10)
        return update(database, display_title="Independent metadata")

    def notation_writer():
        with Session(engine) as db:
            ready.wait(timeout=10)
            result = revision_writer.write(
                db, AppendRevisionWrite("score", 1, source, head, RevisionOrigin.EDIT)
            )
            db.commit()
            return result.revision.revision_uuid

    with ThreadPoolExecutor(max_workers=2) as pool:
        metadata = pool.submit(metadata_writer)
        notation = pool.submit(notation_writer)
        assert metadata.result(timeout=20).metadata_version == 2
        new_head = notation.result(timeout=20)
    with Session(engine) as db:
        score = db.scalar(sa.select(Score))
        assert score.metadata_version == 2
        assert score.display_title == "Independent metadata"
        assert db.get(ScoreRevision, score.head_revision_id).revision_uuid == new_head


def test_simultaneous_metadata_writers_accept_one_transition(database):
    engine, storage = database
    initial(database)
    ready = Barrier(2)

    def contender(title):
        ready.wait(timeout=10)
        try:
            return update(database, display_title=title).display_title
        except ConflictException as error:
            assert error.details == {
                "score_id": "score",
                "expected_metadata_version": 1,
                "current_metadata_version": 2,
            }
            return error.code

    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = [pool.submit(contender, title) for title in ("First", "Second")]
        results = [future.result(timeout=20) for future in futures]
    assert results.count("score_metadata_conflict") == 1
    with Session(engine) as db:
        score = db.scalar(sa.select(Score))
        assert score.display_title in results
        assert score.metadata_version == 2


def test_normalized_metadata_noop_preserves_token_recency_and_revision_history(database):
    engine, storage = database
    head = initial(database)
    changed = update(database, genres=["jazz", "classical"])
    before = changed.updated_at
    noop = update(database, 2, display_title="  Etudes  ", genres=["jazz", "classical", "jazz"])
    assert noop.metadata_version == 2
    assert noop.updated_at == before
    assert noop.head_revision_id == head
    assert noop.head_revision_number == 1
    with Session(engine) as db:
        assert db.scalar(sa.select(sa.func.count()).select_from(ScoreRevision)) == 1
    # Equal values do not bypass a stale expectation.
    with pytest.raises(ConflictException) as failure:
        update(database, 1, display_title="Etudes", genres=["classical", "jazz"])
    assert failure.value.code == "score_metadata_conflict"
    assert failure.value.details == {
        "score_id": "score",
        "expected_metadata_version": 1,
        "current_metadata_version": 2,
    }


def test_restore_uses_observed_head_and_preserves_metadata_token(database):
    engine, storage = database
    target = initial(database)
    head = append(database, target)
    with Session(engine) as db:
        service = RevisionService(storage=storage)
        with pytest.raises(ConflictException) as failure:
            service.restore(
                db, "score", target, 1, RevisionRestoreRequest(expected_head_revision_id=target)
            )
        assert failure.value.code == "revision_conflict"
        assert failure.value.details["expected_head_revision_id"] == target
        assert failure.value.details["current_head_revision_id"] == head
        db.rollback()
        assert db.scalar(sa.select(sa.func.count()).select_from(ScoreRevision)) == 2
        restored = service.restore(
            db, "score", target, 1, RevisionRestoreRequest(expected_head_revision_id=head)
        )
        read = ScoreService(storage=storage).get(db, "score", 1)
        assert restored.revision_number == read.head_revision_number == 3
        assert read.head_revision_id == restored.revision_id
        assert read.metadata_version == 1


def test_metadata_token_is_positive_in_fresh_baseline(database):
    engine, _ = database
    with Session(engine) as db:
        with pytest.raises(sa.exc.IntegrityError) as failure:
            db.execute(sa.update(Score).values(metadata_version=0))
            db.commit()
        assert failure.value.orig.diag.constraint_name == "ck_scores_metadata_version_positive"
        db.rollback()
