"""Persisted Import replay lineage and Account schema upgrade safety."""

import hashlib
import json
import pytest
import sqlalchemy as sa
from alembic import command
from sqlalchemy.orm import Session
from app.db.models import User, ImportJob
from app.modules.import_jobs.schemas import ImportJobSubmitRequest
from app.modules.import_jobs.submission_service import ImportJobSubmissionService
from app.core.exceptions import ConflictException
from app.composition.storage_resources import provision_storage_resources
from tests.support.postgres_schema import postgres_schema_database


def seed_submission(engine, *, linked: bool) -> None:
    with engine.begin() as db:
        db.execute(
            sa.text(
                "INSERT INTO users(id,email,password_hash,is_active,email_verified_at,created_at,updated_at) VALUES(1,'migration@example.test','hash',true,now(),now(),now())"
            )
        )
        db.execute(
            sa.text("""INSERT INTO import_jobs(id,job_uuid,user_id,state,progress,idempotency_key,requested_options,created_at,updated_at)
          VALUES(1,'submission',1,'QUEUED',0,'stable-request',CAST(:options AS jsonb),now(),now())"""),
            {"options": json.dumps({"schema_version": 1, "display_title": None, "genres": []})},
        )
        if linked:
            db.execute(
                sa.text(
                    "INSERT INTO stored_objects(id,object_key,byte_size,sha256,content_type,created_at) VALUES(1,'migration-input',8,:sha,'image/png',now())"
                ),
                {"sha": "a" * 64},
            )
            db.execute(
                sa.text(
                    "INSERT INTO uploads(id,upload_uuid,stored_object_id,original_filename,uploader_user_id,created_at,updated_at) VALUES(1,'original-input',1,'image.png',1,now(),now())"
                )
            )
            db.execute(
                sa.text(
                    "INSERT INTO import_job_uploads(job_id,upload_id,page_number,sort_order) VALUES(1,1,1,1)"
                )
            )


def test_populated_submission_upgrade_preserves_exact_replay_and_rejects_conflict(monkeypatch):
    with postgres_schema_database(monkeypatch) as (engine, config):
        command.upgrade(config, "0004_finite_storage_plans")
        seed_submission(engine, linked=True)
        command.upgrade(config, "head")
        with Session(engine) as db:
            provision_storage_resources(db, 1)
            db.commit()
            job = db.get(ImportJob, 1)
            expected = hashlib.sha256(
                json.dumps(
                    [["original-input"], job.requested_options],
                    sort_keys=True,
                    separators=(",", ":"),
                    ensure_ascii=False,
                ).encode()
            ).hexdigest()
            assert job.submission_fingerprint == expected
            service = ImportJobSubmissionService()
            result = service.submit(
                db,
                db.get(User, 1),
                ImportJobSubmitRequest(
                    upload_ids=["original-input"], idempotency_key="stable-request"
                ),
            )
            assert result["job_id"] == "submission"
            with pytest.raises(ConflictException):
                service.submit(
                    db,
                    db.get(User, 1),
                    ImportJobSubmitRequest(
                        upload_ids=["different-input"], idempotency_key="stable-request"
                    ),
                )


def test_missing_original_inputs_refuses_upgrade_without_partial_schema_change(monkeypatch):
    with postgres_schema_database(monkeypatch) as (engine, config):
        command.upgrade(config, "0004_finite_storage_plans")
        seed_submission(engine, linked=False)
        with pytest.raises(RuntimeError, match="original input lineage"):
            command.upgrade(config, "head")
        with engine.connect() as db:
            assert (
                db.scalar(sa.text("SELECT version_num FROM alembic_version"))
                == "0004_finite_storage_plans"
            )
            assert "deleted_at" not in {
                column["name"] for column in sa.inspect(db).get_columns("users")
            }
            assert (
                db.scalar(sa.text("SELECT idempotency_key FROM import_jobs WHERE id=1"))
                == "stable-request"
            )


def test_downgrade_cannot_discard_account_erasure_evidence(monkeypatch):
    from app.db.models import AccountDeletionOperation
    from app.shared.time import utc_now

    with postgres_schema_database(monkeypatch) as (engine, config):
        command.upgrade(config, "head")
        with Session(engine) as db:
            db.add(
                User(
                    id=1,
                    email="closed@example.test",
                    password_hash="hash",
                    is_active=False,
                    deleted_at=utc_now(),
                )
            )
            db.flush()
            db.add(AccountDeletionOperation(user_id=1, user_id_snapshot=1))
            db.commit()
        with pytest.raises(RuntimeError, match="cannot be discarded"):
            command.downgrade(config, "0004_finite_storage_plans")
        with engine.connect() as db:
            assert (
                db.scalar(sa.text("SELECT version_num FROM alembic_version"))
                == "0005_account_resource_commands"
            )
            assert db.scalar(sa.text("SELECT count(*) FROM account_deletion_operations")) == 1
