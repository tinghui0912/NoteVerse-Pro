"""Finite policy migration preserves supported entitlement and rejects ambiguous capacity."""

import pytest
import sqlalchemy as sa
from alembic import command
from tests.support.postgres_schema import postgres_schema_database


def test_finite_plans_fresh_upgrade_downgrade_and_reupgrade(monkeypatch):
    with postgres_schema_database(monkeypatch) as (engine, config):
        command.upgrade(config, "0003_object_retirement_fence")
        with engine.begin() as db:
            db.execute(
                sa.text(
                    "INSERT INTO users (id,email,password_hash,is_active,created_at,email_verified_at,updated_at) VALUES (1,'plans@example.test','hash',true,now(),now(),now())"
                )
            )
            db.execute(
                sa.text(
                    "INSERT INTO user_storage_entitlements(user_id,plan_code,created_at,updated_at) VALUES (1,'FREE',now(),now())"
                )
            )
        command.upgrade(config, "head")
        with engine.connect() as db:
            assert db.execute(
                sa.text(
                    "SELECT plan_code, default_limit_bytes FROM storage_plan_policies ORDER BY plan_code"
                )
            ).all() == [("FREE", 104857600), ("PLUS", 5368709120), ("PRO", 21474836480)]
            assert (
                db.scalar(
                    sa.text("SELECT plan_code FROM user_storage_entitlements WHERE user_id=1")
                )
                == "FREE"
            )
        command.downgrade(config, "0003_object_retirement_fence")
        command.upgrade(config, "head")


@pytest.mark.parametrize(
    "mutation",
    [
        "UPDATE storage_plan_policies SET mode='UNLIMITED',default_limit_bytes=NULL WHERE plan_code='FREE'",
        "UPDATE user_storage_entitlements SET mode_override='HARD_LIMIT',limit_override_bytes=0 WHERE user_id=1",
    ],
)
def test_unsupported_capacity_fails_before_schema_changes(monkeypatch, mutation):
    with postgres_schema_database(monkeypatch) as (engine, config):
        command.upgrade(config, "0003_object_retirement_fence")
        with engine.begin() as db:
            db.execute(
                sa.text(
                    "INSERT INTO users (id,email,password_hash,is_active,created_at,email_verified_at,updated_at) VALUES (1,'plans@example.test','hash',true,now(),now(),now())"
                )
            )
            db.execute(
                sa.text(
                    "INSERT INTO user_storage_entitlements(user_id,plan_code,created_at,updated_at) VALUES (1,'FREE',now(),now())"
                )
            )
            db.execute(sa.text(mutation))
        with pytest.raises(RuntimeError):
            command.upgrade(config, "head")
        with engine.connect() as db:
            assert (
                db.scalar(sa.text("SELECT version_num FROM alembic_version"))
                == "0003_object_retirement_fence"
            )
            assert "mode" in {
                c["name"] for c in sa.inspect(db).get_columns("storage_plan_policies")
            }


def test_downgrade_preserves_non_free_entitlement_decision(monkeypatch):
    from sqlalchemy.orm import Session
    from app.db.models import User, StoragePlanCode
    from app.composition.storage_resources import provision_storage_resources, storage_quota_service

    with postgres_schema_database(monkeypatch) as (engine, config):
        command.upgrade(config, "head")
        with Session(engine) as db:
            db.add(User(id=1, email="plus@example.test", password_hash="hash"))
            db.flush()
            provision_storage_resources(db, 1)
            storage_quota_service.entitlements.change_plan(db, 1, StoragePlanCode.PLUS)
            db.commit()
        with pytest.raises(RuntimeError, match="PLUS/PRO"):
            command.downgrade(config, "0003_object_retirement_fence")
        with engine.connect() as db:
            assert (
                db.scalar(
                    sa.text("SELECT plan_code FROM user_storage_entitlements WHERE user_id=1")
                )
                == "PLUS"
            )
