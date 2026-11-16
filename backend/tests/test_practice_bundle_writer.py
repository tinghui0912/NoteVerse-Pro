"""Real transaction phases and live access fences of durable bundle admission."""

from datetime import timedelta
from unittest.mock import patch

import pytest
from sqlalchemy import event, select, update, delete
from sqlalchemy.orm import Session

from app.core.exceptions import UnauthorizedException, ResourceNotFoundException
from app.db.models import (
    PracticeBundleRecord,
    ScoreRevisionPracticeBinding,
    StoredObject,
    ScoreMembership,
    User,
    Score,
    ScoreRevision,
)
from app.db.models.score_access import MembershipRole
from app.modules.practice.bundle.writer import PracticeBundleWriter
from app.modules.practice.bundle.mutation_access import lock_live_practice_mutation_access
from app.modules.score_access.policy import ScoreAccessPolicy
from app.shared.time import utc_now
from tests.support.practice_bundle import bind_bundle
from tests.test_practice_bundle_postgres import postgres_bundle as postgres_bundle


def authorization(db, repository, user_id=1):
    return lambda: lock_live_practice_mutation_access(
        db,
        ScoreAccessPolicy(),
        user_id=user_id,
        score_uuid=repository.test_score_uuid,
        revision_uuid=repository.test_revision_uuid,
    )


def test_writer_commits_creation_before_io_and_reauthorizes_before_binding(
    postgres_bundle, monkeypatch
):
    engine, repository, candidate, storage = postgres_bundle
    timeline = []
    put = storage.put_bytes
    with Session(engine, expire_on_commit=False) as db:
        live = authorization(db, repository)

        def reauthorize():
            live()
            timeline.append("authorize")

        def committed(session):
            timeline.append("commit")

        event.listen(db, "after_commit", committed)

        def physical(**kwargs):
            with Session(engine) as observer:
                row = observer.scalar(select(PracticeBundleRecord))
                assert row.status == "CREATING" and row.creation_expires_at is not None
                assert row.prepared_musicxml_object_id is row.artifact_object_id is None
                assert observer.scalar(select(ScoreRevisionPracticeBinding)) is None
                assert observer.scalar(select(StoredObject)) is None
            timeline.append("physical")
            return put(**kwargs)

        monkeypatch.setattr(storage, "put_bytes", physical)
        writer = PracticeBundleWriter(storage, repository=repository)
        add = repository.add_binding

        def binding(*args, **kwargs):
            assert timeline[-1] == "authorize"
            timeline.append("bind")
            return add(*args, **kwargs)

        monkeypatch.setattr(repository, "add_binding", binding)
        reauthorize()
        ref, verified = writer.ensure_binding(
            db, candidate, revision_id=repository.test_revision_id, reauthorize_mutation=reauthorize
        )
        assert verified == candidate
        assert timeline.count("physical") == timeline.count("authorize") == 2
        assert timeline[-2:] == ["bind", "commit"]
        assert timeline.index("commit") < timeline.index("physical")
        with Session(engine) as observer:
            assert (
                observer.get(ScoreRevisionPracticeBinding, repository.test_revision_id).bundle_id
                == ref.id
            )
            assert observer.get(PracticeBundleRecord, ref.id).status == "READY"


def test_repository_queries_and_insertions_are_transaction_neutral(postgres_bundle):
    engine, repository, candidate, storage = postgres_bundle
    with Session(engine, expire_on_commit=False) as db:
        ref, _ = bind_bundle(db, storage, candidate, revision_id=repository.test_revision_id)
        second_revision = ScoreRevision(
            revision_uuid="second-revision",
            score_id=1,
            revision_number=2,
            content_hash="f" * 64,
            origin="OMR",
            created_by_user_id=1,
        )
        db.add(second_revision)
        db.flush()
        with (
            patch.object(db, "commit", wraps=db.commit) as commit,
            patch.object(db, "rollback", wraps=db.rollback) as rollback,
        ):
            assert (
                repository.reference(repository.read_bound(db, repository.test_revision_id)) == ref
            )
            assert repository.read_bound_for_update(db, repository.test_revision_id).id == ref.id
            assert repository.read_by_bundle_id(db, candidate.bundle_id).id == ref.id
            assert repository.lock_by_bundle_id(db, candidate.bundle_id).id == ref.id
            assert repository.lock_by_row_id(db, ref.id).id == ref.id
            row = repository.insert_creation(
                db,
                bundle_id="practice-bundle:" + "f" * 64,
                artifact_id=candidate.artifact.artifact_id,
                artifact_schema_version=1,
                expires_at=utc_now() + timedelta(minutes=5),
            )
            assert row.id is not None
            repository.add_binding(db, revision_id=second_revision.id, bundle_row_id=ref.id)
            commit.assert_not_called()
            rollback.assert_not_called()
            with Session(engine) as observer:
                assert observer.get(ScoreRevisionPracticeBinding, second_revision.id) is None
                assert (
                    observer.scalar(
                        select(PracticeBundleRecord).where(PracticeBundleRecord.id == row.id)
                    )
                    is None
                )


@pytest.mark.parametrize("change", ["revoke_membership", "delete_score", "delete_revision"])
def test_creation_reauthorizes_live_access_after_physical_write(
    postgres_bundle, monkeypatch, change
):
    engine, repository, candidate, storage = postgres_bundle
    with Session(engine) as db:
        member = User(email="member@example.test", password_hash="hash")
        db.add(member)
        db.flush()
        member_id = member.id
        db.add(
            ScoreMembership(
                score_id=1,
                user_id=member_id,
                role=MembershipRole.PRACTITIONER,
                created_by_user_id=1,
            )
        )
        db.commit()
    put = storage.put_bytes
    changed = False

    def physical(**kwargs):
        nonlocal changed
        if not changed:
            changed = True
            with Session(engine) as other:
                if change == "revoke_membership":
                    other.execute(
                        update(ScoreMembership)
                        .where(ScoreMembership.user_id == member_id)
                        .values(revoked_at=utc_now())
                    )
                elif change == "delete_score":
                    other.execute(update(Score).where(Score.id == 1).values(deleted_at=utc_now()))
                else:
                    other.execute(update(Score).where(Score.id == 1).values(head_revision_id=None))
                    other.execute(
                        delete(ScoreRevision).where(ScoreRevision.id == repository.test_revision_id)
                    )
                other.commit()
        return put(**kwargs)

    monkeypatch.setattr(storage, "put_bytes", physical)
    with Session(engine) as db:
        live = authorization(db, repository, member_id)
        live()
        with pytest.raises((UnauthorizedException, ResourceNotFoundException)):
            PracticeBundleWriter(storage).ensure_binding(
                db,
                candidate,
                revision_id=repository.test_revision_id,
                reauthorize_mutation=lambda: live(),
            )
        db.rollback()
    with Session(engine) as observer:
        assert observer.scalar(select(ScoreRevisionPracticeBinding)) is None
        assert observer.scalar(select(StoredObject)) is None


def test_expired_creation_lease_cannot_adopt_or_bind(postgres_bundle, monkeypatch):
    engine, repository, candidate, storage = postgres_bundle
    put = storage.put_bytes

    def physical(**kwargs):
        with Session(engine) as other:
            other.execute(
                update(PracticeBundleRecord).values(
                    creation_expires_at=utc_now() - timedelta(seconds=1)
                )
            )
            other.commit()
        return put(**kwargs)

    monkeypatch.setattr(storage, "put_bytes", physical)
    with Session(engine) as db:
        live = authorization(db, repository)
        live()
        with pytest.raises(ValueError, match="lease expired"):
            PracticeBundleWriter(storage).ensure_binding(
                db,
                candidate,
                revision_id=repository.test_revision_id,
                reauthorize_mutation=lambda: live(),
            )
        db.rollback()
    with Session(engine) as observer:
        assert observer.scalar(select(ScoreRevisionPracticeBinding)) is None
        assert observer.scalar(select(StoredObject)) is None
        assert observer.scalar(select(PracticeBundleRecord)).status == "CREATING"
