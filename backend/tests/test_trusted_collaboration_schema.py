"""The fresh shared role enum matches both collaboration persistence owners."""

import sqlalchemy as sa
from alembic import command
from sqlalchemy.orm import Session
from app.db.models import User, Score, ScoreMembership, ScoreInvite
from app.db.models.score_access import MembershipRole
from tests.support.postgres_schema import postgres_schema_database


def test_fresh_membership_role_enum_and_both_consumers(monkeypatch):
    with postgres_schema_database(monkeypatch) as (engine, config):
        command.upgrade(config, "head")
        enums = {item["name"]: item["labels"] for item in sa.inspect(engine).get_enums()}
        assert (
            enums["membershiprole"]
            == [role.value for role in MembershipRole]
            == ["VIEWER", "PRACTITIONER", "EDITOR"]
        )
        with Session(engine) as db:
            owner = User(
                email="roles-owner@example.com", display_name="Owner", password_hash="test"
            )
            db.add(owner)
            db.flush()
            score = Score(score_uuid="role-score", title="Roles", owner_user_id=owner.id)
            db.add(score)
            db.flush()
            for index, role in enumerate(MembershipRole):
                user = User(
                    email=f"role-{index}@example.com", display_name=role.value, password_hash="test"
                )
                db.add(user)
                db.flush()
                db.add(
                    ScoreMembership(
                        score_id=score.id, user_id=user.id, role=role, created_by_user_id=owner.id
                    )
                )
                db.add(
                    ScoreInvite(
                        score_id=score.id,
                        token_hash=str(index) * 64,
                        email=user.email,
                        role=role,
                        created_by_user_id=owner.id,
                    )
                )
            db.commit()
            assert set(db.scalars(sa.select(ScoreMembership.role))) == set(MembershipRole)
            assert set(db.scalars(sa.select(ScoreInvite.role))) == set(MembershipRole)
