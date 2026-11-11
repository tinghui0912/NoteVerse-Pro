"""Fresh PostgreSQL snapshots retain same-Score head and presentation pinning."""

from datetime import timedelta

import pytest
import sqlalchemy as sa
from alembic import command
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from app.db.models import Score, ScoreRevision, ScoreGuestPreviewGrant, User
from app.db.models.score import RevisionOrigin
from app.utils.timezone import utc_now_naive
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
                "created_by_job_id",
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
            ("created_by_job_id",),
        }
        with Session(engine) as db:
            user = User(
                email="snapshot-owner@example.com", display_name="Owner", password_hash="test"
            )
            db.add(user)
            db.flush()
            a = Score(score_uuid="snapshot-a", title="A", owner_user_id=user.id)
            b = Score(score_uuid="snapshot-b", title="B", owner_user_id=user.id)
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
            preview = ScoreGuestPreviewGrant(
                score_id=a_id,
                revision_id=revisions[0].id,
                token_hash="a" * 64,
                expires_at=utc_now_naive() + timedelta(days=7),
                created_by_user_id=user.id,
            )
            db.add(preview)
            db.commit()
            for table, mutation in [
                (Score.__table__, dict(head_revision_id=b_revision_id)),
                (ScoreGuestPreviewGrant.__table__, dict(revision_id=b_revision_id)),
            ]:
                with pytest.raises(IntegrityError) as rejected:
                    db.execute(
                        table.update()
                        .where(table.c.id == (a_id if table.name == "scores" else preview.id))
                        .values(**mutation)
                    )
                    db.commit()
                assert rejected.value.orig.sqlstate == "23503"
                db.rollback()
            # Advancing the head preserves an independently pinned preview snapshot.
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
            db.refresh(preview)
            assert preview.revision_id == revisions[0].id
