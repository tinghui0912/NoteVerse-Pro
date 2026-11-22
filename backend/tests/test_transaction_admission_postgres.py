"""Atomic domain batch admission and unique-row races on real PostgreSQL."""

from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from threading import Barrier
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from sqlalchemy import select, func, event, text
from sqlalchemy.exc import IntegrityError, OperationalError
from sqlalchemy.orm import Session

from app.core.exceptions import (
    ResourceNotFoundException,
    UnauthorizedException,
    ResourceAlreadyExistsException,
)
from app.db.models import (
    User,
    Score,
    ScoreMembership,
    ScoreLibraryFolder,
    ScoreLibraryOrganization,
    ScoreDeletionOperation,
)
from app.db.models.score_access import MembershipRole
from app.modules.library.schemas import (
    LibraryScoreBatchMoveRequest,
    LibraryScoreBatchFavoriteRequest,
    LibraryFolderCreateRequest,
    LibraryFolderUpdateRequest,
)
from app.modules.library.service import LibraryService
from app.modules.library.repository import LibraryRepository
from app.modules.scores.service import ScoreService
from app.modules.scores.repository import ScoreRepository
from app.modules.scores.lifecycle_service import ScoreLifecycleService
from app.modules.scores.deletion_delivery import ScoreDeletionDeliveryService
from app.shared.error_codes import CustomerErrorCode
from app.shared.time import utc_now


@pytest.fixture
def batch_database(postgres_engine):
    now = utc_now()
    with Session(postgres_engine) as db:
        db.add_all(
            [User(id=i, email=f"batch-{i}@test.example", password_hash="hash") for i in (1, 2)]
        )
        db.flush()
        db.add_all(
            [
                Score(
                    id=i,
                    score_uuid=f"score-{i}",
                    owner_user_id=1 if i <= 50 or i == 53 else 2,
                    display_title=f"Score {i}",
                    deleted_at=now if i == 53 else None,
                    created_at=now,
                    updated_at=now,
                )
                for i in range(1, 54)
            ]
        )
        db.flush()
        db.add(
            ScoreMembership(
                score_id=51, user_id=1, role=MembershipRole.VIEWER, created_by_user_id=2
            )
        )
        db.add_all(
            [ScoreLibraryFolder(folder_uuid=name, user_id=1, name=name) for name in ("F", "G")]
        )
        db.commit()
    return postgres_engine, now


@contextmanager
def statements(engine):
    sql = []

    def record(_connection, _cursor, statement, *_args):
        sql.append(statement)

    event.listen(engine, "before_cursor_execute", record)
    try:
        yield sql
    finally:
        event.remove(engine, "before_cursor_execute", record)


@pytest.mark.parametrize(
    "invalid,error,code",
    [
        ("missing", ResourceNotFoundException, CustomerErrorCode.SCORE_NOT_FOUND),
        ("score-53", ResourceNotFoundException, CustomerErrorCode.SCORE_NOT_FOUND),
        ("score-52", UnauthorizedException, CustomerErrorCode.NO_DELETE_ACCESS),
        ("score-51", UnauthorizedException, CustomerErrorCode.NO_DELETE_ACCESS),
    ],
)
def test_score_batch_invalid_member_admits_nothing(batch_database, invalid, error, code):
    engine, _ = batch_database
    with Session(engine) as db, pytest.raises(error) as denied:
        ScoreService().batch_delete(db, ["score-1", "score-2", invalid], 1)
    assert denied.value.code == code
    with Session(engine) as db:
        assert all(db.get(Score, i).deleted_at is None for i in (1, 2))
        assert db.scalar(select(func.count()).select_from(ScoreDeletionOperation)) == 0


def test_score_batch_commit_failure_rolls_back_the_complete_graph(batch_database, monkeypatch):
    engine, _ = batch_database
    with Session(engine) as db:
        failure = RuntimeError("commit unavailable")
        monkeypatch.setattr(db, "commit", Mock(side_effect=failure))
        with pytest.raises(RuntimeError) as raised:
            ScoreService().batch_delete(db, ["score-1", "score-2"], 1)
        assert raised.value is failure
    with Session(engine) as db:
        assert all(db.get(Score, i).deleted_at is None for i in (1, 2))
        assert db.scalar(select(func.count()).select_from(ScoreDeletionOperation)) == 0


def test_score_admission_participates_in_outer_transaction(batch_database):
    engine, _ = batch_database
    with Session(engine) as db:
        operations = ScoreLifecycleService().admit_deletions(
            db, ["score-2", "score-1", "score-1"], 1
        )
        assert len(operations) == 2
        assert db.scalar(select(func.count()).select_from(ScoreDeletionOperation)) == 2
        db.rollback()
    with Session(engine) as db:
        assert all(db.get(Score, i).deleted_at is None for i in (1, 2))
        assert db.scalar(select(func.count()).select_from(ScoreDeletionOperation)) == 0


def test_score_batch_commits_once_and_fault_isolates_fast_dispatch(batch_database, monkeypatch):
    engine, _ = batch_database
    attempted = []

    def dispatch(identity):
        with Session(engine) as observer:
            assert all(observer.get(Score, i).deleted_at is not None for i in (1, 2))
            assert observer.scalar(select(func.count()).select_from(ScoreDeletionOperation)) == 2
        attempted.append(identity)
        raise RuntimeError("broker unavailable")

    monkeypatch.setattr(
        "app.worker.dispatch.score_deletion.dispatch_score_deletion_best_effort", dispatch
    )
    with Session(engine) as db:
        commit = Mock(wraps=db.commit)
        monkeypatch.setattr(db, "commit", commit)
        assert ScoreService().batch_delete(db, ["score-2", "score-1", "score-1"], 1) == 2
        assert commit.call_count == 1
    with Session(engine) as db:
        operations = list(db.scalars(select(ScoreDeletionOperation)))
        assert len({row.created_at for row in operations}) == 1
        assert set(attempted) == {row.operation_uuid for row in operations}
        due = ScoreDeletionDeliveryService().recover_and_list_due(db)
        assert set(due) == set(attempted)


def test_overlapping_score_batches_lock_in_one_order_and_admit_one_complete_set(batch_database):
    engine, _ = batch_database
    barrier = Barrier(2)

    class RacingRepository(ScoreRepository):
        def lock_active_deletion_set(self, *args, **kwargs):
            barrier.wait(10)
            return super().lock_active_deletion_set(*args, **kwargs)

    def remove(identities):
        with Session(engine) as db:
            db.execute(text("SET LOCAL lock_timeout = '5s'"))
            service = ScoreService(
                lifecycle_service=ScoreLifecycleService(repository=RacingRepository())
            )
            try:
                return service.batch_delete(db, identities, 1)
            except ResourceNotFoundException:
                return "not_found"

    with ThreadPoolExecutor(max_workers=2) as pool:
        first = pool.submit(remove, ["score-1", "score-2"])
        second = pool.submit(remove, ["score-2", "score-1"])
        outcomes = [first.result(20), second.result(20)]
    assert set(outcomes) == {2, "not_found"}
    with Session(engine) as db:
        assert all(db.get(Score, i).deleted_at is not None for i in (1, 2))
        assert sorted(db.scalars(select(ScoreDeletionOperation.score_id))) == [1, 2]


@pytest.mark.parametrize("kind", ["score", "favorite", "move"])
def test_batch_statement_cost_is_bounded_for_one_and_fifty(batch_database, kind):
    engine, original_time = batch_database
    counts = []
    for count in (1, 50):
        with Session(engine) as db, statements(engine) as sql:
            identities = [f"score-{i}" for i in range(1, count + 1)]
            if kind == "score":
                ScoreLifecycleService().admit_deletions(db, identities, 1)
            elif kind == "move":
                LibraryService().batch_move(
                    db, 1, LibraryScoreBatchMoveRequest(score_ids=identities, target_folder_id="F")
                )
            else:
                LibraryService().batch_set_favorite(
                    db, 1, LibraryScoreBatchFavoriteRequest(score_ids=identities, is_favorite=True)
                )
            counts.append(len(sql))
            if kind == "score":
                db.rollback()
    print(f"BATCH_BUDGET {kind}: 1={counts[0]}, 50={counts[1]}")
    assert counts[0] == counts[1]
    if kind != "score":
        with Session(engine) as db:
            organizations = list(db.scalars(select(ScoreLibraryOrganization)))
            assert len(organizations) == 50
            assert len({row.updated_at for row in organizations}) == 1
            assert all(row.updated_at == original_time for row in db.scalars(select(Score)))
            assert db.scalar(select(ScoreMembership)).role is MembershipRole.VIEWER


@pytest.mark.parametrize("kind", ["favorite", "move"])
@pytest.mark.parametrize(
    "invalid,error",
    [
        ("missing", ResourceNotFoundException),
        ("score-53", ResourceNotFoundException),
        ("score-52", UnauthorizedException),
    ],
)
def test_library_batch_invalid_member_changes_nothing(batch_database, kind, invalid, error):
    engine, _ = batch_database
    with Session(engine) as db:
        db.add(ScoreLibraryOrganization(user_id=1, score_id=1, is_favorite=False))
        db.commit()
        ids = ["score-1", "score-2", invalid]
        with pytest.raises(error):
            if kind == "move":
                LibraryService().batch_move(
                    db, 1, LibraryScoreBatchMoveRequest(score_ids=ids, target_folder_id="F")
                )
            else:
                LibraryService().batch_set_favorite(
                    db, 1, LibraryScoreBatchFavoriteRequest(score_ids=ids, is_favorite=True)
                )
    with Session(engine) as db:
        rows = list(db.scalars(select(ScoreLibraryOrganization)))
        assert len(rows) == 1 and rows[0].folder_id is None and rows[0].is_favorite is False


@pytest.mark.parametrize("kind", ["favorite", "move", "mixed"])
def test_concurrent_library_creation_commits_complete_mutations(batch_database, kind):
    engine, original_time = batch_database
    barrier = Barrier(2)

    class RacingRepository(LibraryRepository):
        def upsert_organizations(self, *args, **kwargs):
            barrier.wait(10)
            return super().upsert_organizations(*args, **kwargs)

    def mutate(index):
        with Session(engine) as db:
            db.execute(text("SET LOCAL lock_timeout = '5s'"))
            service = LibraryService(repository=RacingRepository())
            ids = ["score-1", "score-2"] if index == 0 else ["score-2", "score-1"]
            if kind == "move" or (kind == "mixed" and index == 0):
                return service.batch_move(
                    db,
                    1,
                    LibraryScoreBatchMoveRequest(
                        score_ids=ids, target_folder_id="F" if index == 0 else "G"
                    ),
                )
            return service.batch_set_favorite(
                db,
                1,
                LibraryScoreBatchFavoriteRequest(
                    score_ids=ids, is_favorite=index == 0 if kind != "mixed" else True
                ),
            )

    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = [pool.submit(mutate, i) for i in (0, 1)]
        assert [future.result(20) for future in futures] == [2, 2]
    with Session(engine) as db:
        rows = list(db.scalars(select(ScoreLibraryOrganization)))
        assert len(rows) == 2 and {row.score_id for row in rows} == {1, 2}
        assert len({row.updated_at for row in rows}) == 1
        if kind == "favorite":
            assert len({row.is_favorite for row in rows}) == 1
        elif kind == "move":
            assert len({row.folder_id for row in rows}) == 1
        else:
            folder = db.scalar(
                select(ScoreLibraryFolder).where(ScoreLibraryFolder.folder_uuid == "F")
            )
            assert all(row.folder_id == folder.id and row.is_favorite for row in rows)
        assert all(row.updated_at == original_time for row in db.scalars(select(Score)))


@pytest.mark.parametrize("command", ["create", "update"])
def test_folder_name_uniqueness_is_a_precise_business_conflict(batch_database, command):
    engine, _ = batch_database
    with Session(engine) as db, pytest.raises(ResourceAlreadyExistsException):
        if command == "create":
            LibraryService().create_folder(db, 1, LibraryFolderCreateRequest(name="F"))
        else:
            LibraryService().update_folder(db, 1, "G", LibraryFolderUpdateRequest(name="F"))


@pytest.mark.parametrize("command", ["create", "update"])
@pytest.mark.parametrize("kind", ["runtime", "driver", "integrity"])
def test_folder_unrelated_failures_keep_the_original_error(
    batch_database, monkeypatch, command, kind
):
    engine, _ = batch_database
    original = SimpleNamespace(
        sqlstate="23505", diag=SimpleNamespace(constraint_name="uq_unrelated")
    )
    error = (
        RuntimeError("programming error")
        if kind == "runtime"
        else OperationalError("statement", {}, RuntimeError("driver unavailable"))
        if kind == "driver"
        else IntegrityError("statement", {}, original)
    )
    with Session(engine) as db:
        monkeypatch.setattr(db, "commit", Mock(side_effect=error))
        with pytest.raises(type(error)) as raised:
            if command == "create":
                LibraryService().create_folder(db, 1, LibraryFolderCreateRequest(name="new"))
            else:
                LibraryService().update_folder(
                    db, 1, "G", LibraryFolderUpdateRequest(name="changed")
                )
        assert raised.value is error
        db.rollback()
    with Session(engine) as db:
        assert sorted(db.scalars(select(ScoreLibraryFolder.name))) == ["F", "G"]
