"""Fresh collaboration schema, unresolved lookup and terminal fact coherence."""

from datetime import UTC


import sqlalchemy as sa
from alembic import command
from sqlalchemy.orm import Session
from app.db.models import User, Score, ScoreMembership, ScoreInvite
from app.db.models.score_access import MembershipRole
from app.db.models.score_access import InviteTerminalOutcome
from sqlalchemy.exc import IntegrityError
from itertools import product
from datetime import datetime
import pytest
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
        inspector = sa.inspect(engine)
        for table, expected in {
            "score_invites": {
                "idx_score_invites_score_created": ["score_id", "created_at", "id"],
                "idx_score_invites_email_unresolved_created": ["email", "created_at", "id"],
            },
            "score_memberships": {
                "idx_score_memberships_score_created": ["score_id", "created_at", "id"],
            },
        }.items():
            indexes = {
                index["name"]: index["column_names"] for index in inspector.get_indexes(table)
            }
            for name, columns in expected.items():
                assert indexes[name] == columns
        with Session(engine) as db:
            owner = User(
                email="roles-owner@example.com", display_name="Owner", password_hash="test"
            )
            db.add(owner)
            db.flush()
            score = Score(score_uuid="role-score", display_title="Roles", owner_user_id=owner.id)
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


def test_postgres_invitation_terminal_facts_and_unresolved_index(monkeypatch):
    with postgres_schema_database(monkeypatch) as (engine, config):
        command.upgrade(config, "head")
        inspector = sa.inspect(engine)
        assert {c["name"] for c in inspector.get_columns("score_invites")} == {
            "id",
            "invite_uuid",
            "score_id",
            "token_hash",
            "email",
            "role",
            "created_by_user_id",
            "created_at",
            "expires_at",
            "terminal_outcome",
            "terminal_at",
            "terminal_actor_user_id",
        }
        enums = {e["name"]: e["labels"] for e in inspector.get_enums()}
        assert enums["inviteterminaloutcome"] == [o.value for o in InviteTerminalOutcome]
        index = next(
            i
            for i in inspector.get_indexes("score_invites")
            if i["name"] == "idx_score_invites_email_unresolved_created"
        )
        assert index["column_names"] == ["email", "created_at", "id"]
        assert index["dialect_options"]["postgresql_where"] == "(terminal_outcome IS NULL)"
        with Session(engine) as db:
            db.add_all(
                [
                    User(id=1, email="owner@example.com", password_hash="hash"),
                    User(id=2, email="actor@example.com", password_hash="hash"),
                ]
            )
            db.flush()
            db.add(Score(id=10, score_uuid="schema-score", owner_user_id=1, display_title="Schema"))
            db.commit()
            for number, (outcome, at, actor) in enumerate(
                product(
                    [None, *InviteTerminalOutcome],
                    [None, datetime(2026, 1, 1, tzinfo=UTC)],
                    [None, 2],
                )
            ):
                valid = (outcome is None and at is None and actor is None) or (
                    outcome is not None and at is not None and actor is not None
                )

                def insert():
                    with db.begin_nested():
                        db.add(
                            ScoreInvite(
                                score_id=10,
                                invite_uuid=f"invite-{number}",
                                token_hash=f"{number:064x}",
                                role=MembershipRole.VIEWER,
                                created_by_user_id=1,
                                terminal_outcome=outcome,
                                terminal_at=at,
                                terminal_actor_user_id=actor,
                            )
                        )
                        db.flush()

                if valid:
                    insert()
                else:
                    with pytest.raises(IntegrityError, match="ck_score_invites_terminal_facts"):
                        insert()
            db.commit()
            assert db.scalar(sa.select(sa.func.count()).select_from(ScoreInvite)) == 1 + len(
                InviteTerminalOutcome
            )
