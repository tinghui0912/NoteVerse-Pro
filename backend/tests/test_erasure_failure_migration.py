"""Populated deletion operations survive schema upgrade with conservative diagnostics."""

import pytest
from alembic import command
import sqlalchemy as sa
from tests.support.postgres_schema import postgres_schema_database


def test_failure_upgrade_preserves_pending_and_failed_operations_and_guards_downgrade(monkeypatch):
    with postgres_schema_database(monkeypatch) as (engine, config):
        command.upgrade(config, "0005_account_resource_commands")
        with engine.begin() as db:
            db.execute(
                sa.text(
                    "INSERT INTO users(id,email,password_hash,is_active,email_verified_at,created_at,updated_at,deleted_at) VALUES(1,'closed@example.test','hash',false,now(),now(),now(),now())"
                )
            )
            db.execute(
                sa.text("""INSERT INTO account_deletion_operations(operation_uuid,user_id,user_id_snapshot,status,phase,attempt_count,next_attempt_at,created_at,updated_at,failure_detail)
                VALUES('account-failed',1,1,'FAILED','TAKES',2,now(),now(),now(),'unsafe old exception')""")
            )
            db.execute(
                sa.text("""INSERT INTO stored_object_retirements(retirement_uuid,object_key,byte_size,sha256,content_type,status,attempt_count,next_attempt_at,created_at,updated_at,deletion_fenced_at)
                VALUES('fenced','internal/key',4,:sha,'audio/wav','FAILED',2,now(),now(),now(),now()),
                      ('pending','pending/key',4,:sha,'audio/wav','PENDING',0,now(),now(),now(),null)"""),
                {"sha": "a" * 64},
            )
        command.upgrade(config, "head")
        with engine.connect() as db:
            account = (
                db.execute(sa.text("SELECT * FROM account_deletion_operations")).mappings().one()
            )
            assert account["phase"] == "TAKES" and account["attempt_count"] == 2
            assert (
                account["failure_retryable"] is False
                and account["failure_code"] == "account_deletion_review_required"
            )
            assert account["user_id_snapshot"] == 1
            assert db.scalar(
                sa.text(
                    "SELECT deletion_fenced_at IS NOT NULL FROM stored_object_retirements WHERE retirement_uuid='fenced'"
                )
            )
            assert (
                db.scalar(
                    sa.text(
                        "SELECT failure_code FROM stored_object_retirements WHERE retirement_uuid='pending'"
                    )
                )
                is None
            )
        with pytest.raises(RuntimeError, match="cannot be discarded"):
            command.downgrade(config, "0005_account_resource_commands")
        with engine.connect() as db:
            assert db.scalar(sa.text("SELECT count(*) FROM stored_object_retirements")) == 2
            assert (
                db.scalar(sa.text("SELECT version_num FROM alembic_version"))
                == "0008_collaboration_closure"
            )
        with engine.begin() as db:
            for table in ("account_deletion_operations", "stored_object_retirements"):
                db.execute(
                    sa.text(
                        f"UPDATE {table} SET failure_code=null,failure_stage=null,failure_classification=null,failure_retryable=null,failure_detail=null"
                    )
                )
        command.downgrade(config, "0005_account_resource_commands")
        command.upgrade(config, "head")
        with engine.connect() as db:
            assert db.scalar(sa.text("SELECT count(*) FROM stored_object_retirements")) == 2


def test_downgrade_preserves_operator_audit_for_erasure_kinds(monkeypatch):
    from sqlalchemy.orm import Session
    from app.db.models import OpsAuditEvent

    with postgres_schema_database(monkeypatch) as (engine, config):
        command.upgrade(config, "head")
        with Session(engine) as db:
            db.add(
                OpsAuditEvent(
                    action="retry_async_operation",
                    operation_kind="account_deletion",
                    operation_id="closed-subject-operation",
                    outcome="succeeded",
                    reason="Verified repair",
                )
            )
            db.commit()
        with pytest.raises(RuntimeError, match="operator audit evidence"):
            command.downgrade(config, "0005_account_resource_commands")
        with engine.connect() as db:
            assert db.scalar(sa.text("SELECT count(*) FROM ops_audit_events")) == 1
            assert (
                db.scalar(sa.text("SELECT version_num FROM alembic_version"))
                == "0008_collaboration_closure"
            )
            assert "failure_code" in {
                column["name"]
                for column in sa.inspect(db).get_columns("account_deletion_operations")
            }
