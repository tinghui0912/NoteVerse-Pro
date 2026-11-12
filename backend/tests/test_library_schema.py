import pytest
import sqlalchemy as sa
from alembic import command
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db.models import ScoreLibraryFolder, User
from app.utils.timezone import utc_now_naive
from tests.support.postgres_schema import postgres_schema_database


def test_library_folder_schema_and_active_name_uniqueness(monkeypatch):
    with postgres_schema_database(monkeypatch) as (engine, config):
        command.upgrade(config, "head")
        inspector = sa.inspect(engine)
        assert {c["name"] for c in inspector.get_columns("score_library_folders")} == {
            "id",
            "folder_uuid",
            "user_id",
            "name",
            "position",
            "created_at",
            "updated_at",
            "deleted_at",
        }
        assert [
            fk["constrained_columns"] for fk in inspector.get_foreign_keys("score_library_folders")
        ] == [["user_id"]]
        index = next(
            i
            for i in inspector.get_indexes("score_library_folders")
            if i["name"] == "uq_score_library_folders_active_name"
        )
        assert index["unique"]
        assert index["column_names"] == ["user_id", "name"]
        with Session(engine) as db:
            db.add_all(
                [User(id=i, email=f"user{i}@example.com", password_hash="hash") for i in [1, 2]]
            )
            db.commit()
            a = ScoreLibraryFolder(user_id=1, name="Studies")
            db.add(a)
            db.commit()
            db.add(ScoreLibraryFolder(user_id=1, name="Studies"))
            with pytest.raises(IntegrityError):
                db.commit()
            db.rollback()
            db.add(ScoreLibraryFolder(user_id=2, name="Studies"))
            db.commit()
            a.deleted_at = utc_now_naive()
            db.commit()
            db.add(ScoreLibraryFolder(user_id=1, name="Studies"))
            db.commit()
