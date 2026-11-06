"""Fresh PostgreSQL schema enforces exact revision pinning and token identity."""

from datetime import timedelta

import pytest
import sqlalchemy as sa
from alembic import command
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
from app.db.models import ScoreGuestPreviewGrant, Score, ScoreRevision, User
from app.db.models.score import RevisionOrigin
from app.utils.timezone import utc_now_naive
from tests.test_practice_bundle_migration import migration_database


def test_fresh_postgres_preview_constraints_and_cascade(monkeypatch):
    with migration_database(monkeypatch) as (engine, config):
        command.upgrade(config, "head")
        inspector = sa.inspect(engine)
        table = ScoreGuestPreviewGrant.__table__
        actual = {column["name"]: column for column in inspector.get_columns(table.name)}
        assert set(actual) == set(table.columns.keys())
        assert all(actual[c.name]["nullable"] == c.nullable for c in table.columns)
        assert {fk["referred_table"] for fk in inspector.get_foreign_keys(table.name)} == {
            "users",
            "scores",
            "score_revisions",
        }
        with Session(engine) as db:
            user = User(
                email="preview-schema@example.com", display_name="Owner", password_hash="hash"
            )
            db.add(user)
            db.flush()
            a = Score(score_uuid="a", title="A", owner_user_id=user.id)
            b = Score(score_uuid="b", title="B", owner_user_id=user.id)
            db.add_all([a, b])
            db.flush()
            ra = ScoreRevision(
                revision_uuid="ra",
                score_id=a.id,
                revision_number=1,
                content_hash="a" * 64,
                origin=RevisionOrigin.IMPORT,
            )
            rb = ScoreRevision(
                revision_uuid="rb",
                score_id=b.id,
                revision_number=1,
                content_hash="b" * 64,
                origin=RevisionOrigin.IMPORT,
            )
            db.add_all([ra, rb])
            db.commit()
            values = dict(
                score_id=a.id,
                revision_id=ra.id,
                token_hash="a" * 64,
                expires_at=utc_now_naive() + timedelta(days=7),
                created_by_user_id=user.id,
            )
            preview = ScoreGuestPreviewGrant(**values)
            db.add(preview)
            db.commit()
            # PostgreSQL, not a mock, rejects cross-score pinning, duplicate secrets/IDs, and missing expiry.
            for index, (changes, sqlstate) in enumerate(
                [
                    (dict(revision_id=rb.id, token_hash="b" * 64), "23503"),
                    (dict(token_hash="a" * 64), "23505"),
                    (dict(preview_uuid=preview.preview_uuid, token_hash="c" * 64), "23505"),
                    (dict(expires_at=None, token_hash="d" * 64), "23502"),
                ]
            ):
                with pytest.raises(IntegrityError) as rejected:
                    db.execute(
                        table.insert().values(
                            **(values | {"preview_uuid": f"new-preview-{index}"} | changes)
                        )
                    )
                    db.commit()
                assert rejected.value.orig.sqlstate == sqlstate
                db.rollback()
            db.delete(ra)
            db.commit()
            assert db.scalar(sa.select(sa.func.count()).select_from(table)) == 0
        # Current access origins are runtime authorities, not a retired session DB enum.
        with engine.connect() as connection:
            enums = connection.scalars(
                sa.text(
                    "SELECT typname FROM pg_type JOIN pg_namespace ON pg_namespace.oid=pg_type.typnamespace WHERE nspname=current_schema() AND typtype='e'"
                )
            ).all()
            assert "accessorigin" not in enums
