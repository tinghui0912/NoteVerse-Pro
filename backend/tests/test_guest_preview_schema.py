"""Fresh PostgreSQL Score-owned bearer capability constraints."""

import pytest
import sqlalchemy as sa
from alembic import command
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
from app.db.models import Score, User
from tests.support.postgres_schema import postgres_schema_database


def test_fresh_postgres_preview_settings_constraints(monkeypatch):
    with postgres_schema_database(monkeypatch) as (engine, config):
        command.upgrade(config, "head")
        inspector = sa.inspect(engine)
        columns = {c["name"]: c for c in inspector.get_columns("scores")}
        assert not columns["guest_preview_token"]["nullable"]
        assert not columns["guest_preview_enabled"]["nullable"]
        assert any(
            c["column_names"] == ["guest_preview_token"]
            for c in inspector.get_unique_constraints("scores")
        )
        with Session(engine) as db:
            user = User(email="schema-preview@example.com", password_hash="hash")
            db.add(user)
            db.flush()
            score = Score(score_uuid="preview", display_title="Preview", owner_user_id=user.id)
            db.add(score)
            db.commit()
            assert len(score.guest_preview_token) >= 43 and not score.guest_preview_enabled
            for values in [dict(guest_preview_token=None), dict(guest_preview_enabled=None)]:
                with pytest.raises(IntegrityError):
                    db.execute(sa.update(Score).where(Score.id == score.id).values(**values))
                    db.commit()
                db.rollback()
            duplicate = Score(
                score_uuid="duplicate",
                display_title="Duplicate",
                owner_user_id=user.id,
                guest_preview_token=score.guest_preview_token,
            )
            db.add(duplicate)
            with pytest.raises(IntegrityError):
                db.commit()
            db.rollback()
