"""Fresh PostgreSQL snapshots retain same-Score head references."""

import pytest
import sqlalchemy as sa
from alembic import command
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from app.db.models import Score, ScoreRevision, User
from app.modules.revisions.domain import RevisionOrigin
from tests.support.postgres_schema import postgres_schema_database


def test_fresh_snapshot_schema_and_same_score_references(monkeypatch):
    with postgres_schema_database(monkeypatch) as (engine, config):
        command.upgrade(config, "head")
        inspector = sa.inspect(engine)
        columns = {column["name"]: column for column in inspector.get_columns("score_revisions")}
        assert (
            set(columns)
            == set(ScoreRevision.__table__.columns.keys())
            == {
                "id",
                "revision_uuid",
                "score_id",
                "revision_number",
                "content_hash",
                "idempotency_key",
                "origin",
                "created_by_user_id",
                "created_at",
            }
        )
        for column in ScoreRevision.__table__.columns:
            assert columns[column.name]["nullable"] == column.nullable
        assert {
            tuple(fk["constrained_columns"]) for fk in inspector.get_foreign_keys("score_revisions")
        } == {
            ("score_id",),
            ("created_by_user_id",),
        }
        with Session(engine) as db:
            user = User(
                email="snapshot-owner@example.com", display_name="Owner", password_hash="test"
            )
            db.add(user)
            db.flush()
            a = Score(score_uuid="snapshot-a", display_title="A", owner_user_id=user.id)
            b = Score(score_uuid="snapshot-b", display_title="B", owner_user_id=user.id)
            db.add_all([a, b])
            db.flush()
            revisions = [
                ScoreRevision(
                    revision_uuid=f"snapshot-{index}",
                    score_id=score.id,
                    revision_number=1,
                    content_hash=str(index) * 64,
                    origin=RevisionOrigin.IMPORT,
                )
                for index, score in enumerate((a, b))
            ]
            db.add_all(revisions)
            db.commit()
            a_id, b_revision_id = a.id, revisions[1].id
            a.head_revision_id = revisions[0].id
            db.commit()
            with pytest.raises(IntegrityError) as rejected:
                db.execute(
                    sa.update(Score).where(Score.id == a_id).values(head_revision_id=b_revision_id)
                )
                db.commit()
            assert rejected.value.orig.sqlstate == "23503"
            db.rollback()
            next_revision = ScoreRevision(
                revision_uuid="snapshot-a2",
                score_id=a_id,
                revision_number=2,
                content_hash="c" * 64,
                origin=RevisionOrigin.EDIT,
            )
            db.add(next_revision)
            db.flush()
            a.head_revision_id = next_revision.id
            db.commit()
            db.refresh(a)
            assert a.head_revision_id == next_revision.id
