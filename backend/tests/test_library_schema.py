import pytest
import sqlalchemy as sa
from alembic import command
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db.models import ScoreLibraryFolder, User
from tests.support.postgres_schema import postgres_schema_database


def test_library_folder_schema_and_name_uniqueness(monkeypatch):
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
        }
        assert [
            fk["constrained_columns"] for fk in inspector.get_foreign_keys("score_library_folders")
        ] == [["user_id"]]
        constraint = next(
            c
            for c in inspector.get_unique_constraints("score_library_folders")
            if c["name"] == "uq_score_library_folders_user_name"
        )
        assert constraint["column_names"] == ["user_id", "name"]
        assert {c["name"] for c in inspector.get_columns("score_library_organizations")} == {
            "id",
            "user_id",
            "score_id",
            "folder_id",
            "is_favorite",
            "created_at",
            "updated_at",
        }
        fks = {
            tuple(fk["constrained_columns"]): fk
            for fk in inspector.get_foreign_keys("score_library_organizations")
        }
        assert fks[("folder_id",)]["options"]["ondelete"] == "SET NULL"
        assert fks[("score_id",)]["options"]["ondelete"] == "CASCADE"
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
            db.delete(a)
            db.commit()
            db.add(ScoreLibraryFolder(user_id=1, name="Studies"))
            db.commit()


@pytest.fixture
def postgres_workspace(monkeypatch):
    with postgres_schema_database(monkeypatch) as (engine, config):
        command.upgrade(config, "head")
        yield engine


def test_postgres_workspace_access_and_organization_lifetimes(postgres_workspace):
    from app.db.models import Score, ScoreMembership, ScoreLibraryOrganization
    from app.db.models.score_access import MembershipRole
    from app.modules.library.repository import LibraryRepository
    from app.modules.library.schemas import LibraryView, LibrarySort
    from app.utils.timezone import utc_now_naive
    from tests.test_score_revision_services import Session

    with Session(postgres_workspace) as db:
        db.add_all(
            [User(id=i, email=f"workspace{i}@example.com", password_hash="hash") for i in [1, 2]]
        )
        db.commit()
        scores = [
            Score(score_uuid=code, owner_user_id=1 if code == "A" else 2, title=code)
            for code in ["A", "B", "C"]
        ]
        db.add_all(scores)
        db.flush()
        membership = ScoreMembership(
            score_id=scores[1].id, user_id=1, role=MembershipRole.VIEWER, created_by_user_id=2
        )
        folder = ScoreLibraryFolder(user_id=1, name="Shared")
        db.add_all([membership, folder])
        db.flush()
        organization = ScoreLibraryOrganization(
            user_id=1, score_id=scores[1].id, folder_id=folder.id
        )
        db.add_all(
            [
                organization,
                ScoreLibraryOrganization(user_id=1, score_id=scores[2].id, is_favorite=True),
            ]
        )
        db.commit()

        def visible():
            rows, _ = LibraryRepository().list_scores(
                db,
                1,
                view=LibraryView.ALL,
                folder_id=None,
                search=None,
                sort=LibrarySort.NAME_ASC,
                page=1,
                page_size=20,
            )
            return [score.score_uuid for score, *_ in rows]

        assert visible() == ["A", "B"]
        db.delete(folder)
        db.commit()
        db.refresh(organization)
        assert organization.folder_id is None and visible() == ["A", "B"]
        membership.revoked_at = utc_now_naive()
        db.commit()
        assert visible() == ["A"]
        organization_id = organization.id
        db.delete(scores[1])
        db.commit()
        db.expire_all()
        assert db.get(ScoreLibraryOrganization, organization_id) is None
