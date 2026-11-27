"""Real PostgreSQL login roles enforce the reviewed application allowlist."""

import os
import secrets
from pathlib import Path
from uuid import uuid4

import pytest
import sqlalchemy as sa
from sqlalchemy.orm import Session
from psycopg.errors import InsufficientPrivilege
from alembic import command
from alembic.config import Config
from sqlmodel import SQLModel

from app.platform.db.authorization import (
    DATABASE_ROLES,
    bootstrap_roles,
    apply_runtime_grants,
    reviewed_tables,
)
from app.db.models import (
    User,
    Score,
    AuthToken,
    AccountDeletionOperation,
    AccountDeletionPhase,
    AccountDeletionStatus,
)
from app.shared.time import utc_now
from datetime import timedelta
from app.modules.account.resource_admission import lock_active_resource_user
from app.modules.auth.mail_lifecycle import authentication_mail_source_active
from app.db.models.mail_outbox import MailSourceKind
from app.observability.async_operation_metrics import async_operation_metrics_text, MetricsConfig


@pytest.fixture(scope="module")
def roles():
    url = sa.engine.make_url(os.environ["NOTEVERSE_TEST_PRACTICE_BUNDLE_POSTGRES_URL"])
    assert (url.database or "").startswith("noteverse_test_")
    admin = sa.create_engine(url)
    schema = "role_test_" + uuid4().hex
    passwords = {role: secrets.token_urlsafe(32) for role in DATABASE_ROLES}
    with admin.begin() as connection:
        assert connection.scalar(sa.text("SHOW server_version_num")).startswith("17")
        bootstrap_roles(connection, schema, passwords)
    engines = {
        role: sa.create_engine(
            url.set(username=role, password=passwords[role]),
            connect_args={"options": f"-c search_path={schema} -c timezone=UTC"},
        )
        for role in DATABASE_ROLES
    }
    settings_url, options = os.environ.get("DATABASE_URL"), os.environ.get("PGOPTIONS")
    try:
        os.environ["DATABASE_URL"] = url.set(
            username="nv_migrator", password=passwords["nv_migrator"]
        ).render_as_string(hide_password=False)
        os.environ["PGOPTIONS"] = "-csearch_path=" + schema
        config = Config(str(Path(__file__).resolve().parents[2] / "alembic.ini"))
        command.upgrade(config, "head")
        with engines["nv_migrator"].begin() as connection:
            apply_runtime_grants(connection, schema)
            apply_runtime_grants(connection, schema)
        with Session(engines["nv_customer_api"]) as db:
            db.add(User(id=1, email="role@example.test", password_hash="private-hash"))
            db.commit()
        yield engines, schema
    finally:
        for variable, value in (("DATABASE_URL", settings_url), ("PGOPTIONS", options)):
            if value is None:
                os.environ.pop(variable, None)
            else:
                os.environ[variable] = value
        for engine in engines.values():
            engine.dispose()
        with admin.begin() as connection:
            connection.exec_driver_sql(f'DROP SCHEMA "{schema}" CASCADE')
        admin.dispose()


def assert_denied(engine, statement):
    with engine.connect() as connection:
        with pytest.raises(sa.exc.DBAPIError) as failure:
            connection.exec_driver_sql(statement)
        assert isinstance(failure.value.orig, InsufficientPrivilege)
        connection.rollback()


@pytest.mark.parametrize(
    "role,statement",
    [
        ("nv_worker", "SELECT password_hash FROM users"),
        ("nv_worker", "SELECT * FROM users"),
        ("nv_worker", "SELECT * FROM refresh_tokens"),
        ("nv_worker", "SELECT * FROM auth_tokens"),
        ("nv_worker", "SELECT * FROM pending_registrations"),
        ("nv_worker", "SELECT * FROM email_change_requests"),
        ("nv_worker", "SELECT * FROM operators"),
        ("nv_worker", "SELECT * FROM operator_sessions"),
        ("nv_worker", "SELECT * FROM ops_audit_events"),
        ("nv_worker", "UPDATE users SET password_hash='other'"),
        ("nv_worker", "UPDATE users SET is_active=true"),
        ("nv_worker", "DELETE FROM users"),
        ("nv_customer_api", "SELECT * FROM operators"),
        ("nv_customer_api", "INSERT INTO operators DEFAULT VALUES"),
        ("nv_customer_api", "SELECT * FROM operator_sessions"),
        ("nv_customer_api", "INSERT INTO operator_sessions DEFAULT VALUES"),
        ("nv_customer_api", "SELECT * FROM ops_audit_events"),
        ("nv_control_plane", "SELECT password_hash FROM users"),
        ("nv_control_plane", "SELECT * FROM users"),
        ("nv_control_plane", "SELECT * FROM refresh_tokens"),
        ("nv_control_plane", "SELECT * FROM auth_tokens"),
        ("nv_control_plane", "UPDATE ops_audit_events SET reason='changed'"),
        ("nv_control_plane", "DELETE FROM ops_audit_events"),
        ("nv_beat", "SELECT * FROM users"),
        ("nv_beat", "SELECT * FROM refresh_tokens"),
        ("nv_beat", "SELECT * FROM operators"),
        ("nv_beat", "SELECT * FROM operator_sessions"),
        ("nv_beat", "SELECT * FROM scores"),
        ("nv_beat", "SELECT * FROM score_revisions"),
        ("nv_beat", "SELECT * FROM mail_outbox"),
        ("nv_observability", "SELECT * FROM users"),
        ("nv_observability", "SELECT * FROM refresh_tokens"),
        ("nv_observability", "SELECT * FROM operator_sessions"),
        ("nv_observability", "SELECT text_body FROM mail_outbox"),
        ("nv_observability", "SELECT token_hash FROM auth_tokens"),
        ("nv_observability", "INSERT INTO scheduler_heartbeats DEFAULT VALUES"),
        ("nv_observability", "UPDATE scheduler_heartbeats SET last_error='changed'"),
        ("nv_observability", "DELETE FROM scheduler_heartbeats"),
        ("nv_observability", "SELECT nv_erase_closed_identity(1)"),
    ],
)
def test_cross_boundary_access_is_denied(roles, role, statement):
    assert_denied(roles[0][role], statement)


@pytest.mark.parametrize("role", DATABASE_ROLES[1:])
@pytest.mark.parametrize(
    "statement",
    [
        "CREATE TABLE forbidden(id integer)",
        "CREATE TEMP TABLE forbidden(id integer)",
        "ALTER TABLE scores ADD COLUMN forbidden integer",
        "DROP TABLE scores",
        "CREATE TYPE forbidden AS ENUM ('a')",
        "CREATE SCHEMA forbidden",
    ],
)
def test_runtime_ddl_is_denied(roles, role, statement):
    assert_denied(roles[0][role], statement)


def test_every_application_table_has_an_explicit_privilege_decision():
    assert reviewed_tables() == set(SQLModel.metadata.tables)


def test_worker_can_lock_resource_identity_without_loading_credentials(roles):
    with Session(roles[0]["nv_worker"]) as db:
        user = lock_active_resource_user(db, 1)
        assert user.email == "role@example.test"
        assert "password_hash" not in sa.inspect(user).dict
        with pytest.raises(sa.exc.InvalidRequestError):
            _ = user.password_hash


def test_exporter_executes_all_authoritative_metric_queries(roles):
    with Session(roles[0]["nv_observability"]) as db:
        assert "noteverse_async_operations_by_status" in async_operation_metrics_text(
            db, config=MetricsConfig()
        )


def test_beat_can_upsert_only_its_leader_state(roles):
    with roles[0]["nv_beat"].begin() as connection:
        connection.exec_driver_sql(
            "INSERT INTO scheduler_leader_statuses(scheduler_name,acquired_count,standby_count,child_exit_count,created_at,updated_at) VALUES ('role-test',1,0,0,now(),now()) ON CONFLICT(scheduler_name) DO UPDATE SET acquired_count=scheduler_leader_statuses.acquired_count+1"
        )


def test_authentication_mail_returns_only_liveness_and_closed_cleanup_is_bounded(roles):
    engines, _ = roles
    now = utc_now()
    with Session(engines["nv_customer_api"]) as db:
        db.add(
            User(
                id=2,
                email="erase-role@example.test",
                password_hash="private-hash",
                deleted_at=now,
                is_active=False,
            )
        )
        db.flush()
        db.add_all(
            [
                AuthToken(
                    user_id=2,
                    purpose="reset",
                    token_hash=str(i) * 64,
                    expires_at=now + timedelta(days=1),
                )
                for i in (1, 2)
            ]
        )
        operation = AccountDeletionOperation(
            user_id=2,
            user_id_snapshot=2,
            phase=AccountDeletionPhase.FINALIZE,
            status=AccountDeletionStatus.PROCESSING,
            attempt_token="role-attempt",
            attempt_count=1,
            started_at=now,
        )
        db.add(operation)
        db.commit()
    with Session(engines["nv_worker"]) as db:
        assert not authentication_mail_source_active(db, MailSourceKind.AUTH_TOKEN, 1)
        assert db.scalar(sa.text("SELECT nv_erase_closed_authentication_history(2,1)"))
        db.commit()
    with Session(engines["nv_migrator"]) as db:
        assert (
            db.scalar(
                sa.select(sa.func.count()).select_from(AuthToken).where(AuthToken.user_id == 2)
            )
            == 1
        )
    assert_denied(engines["nv_worker"], "SELECT nv_erase_closed_authentication_history(1,1)")


def test_new_tables_do_not_inherit_runtime_privileges(roles):
    engines, schema = roles
    with engines["nv_migrator"].begin() as connection:
        connection.exec_driver_sql("CREATE TABLE privilege_drift(id bigserial PRIMARY KEY)")
    try:
        for role in DATABASE_ROLES[1:]:
            assert_denied(engines[role], "SELECT * FROM privilege_drift")
    finally:
        with engines["nv_migrator"].begin() as connection:
            connection.exec_driver_sql("DROP TABLE privilege_drift")


@pytest.mark.parametrize(
    "statement",
    [
        "SELECT text_body FROM mail_outbox",
        "SELECT recipient FROM mail_outbox",
        "UPDATE mail_outbox SET source_id=99",
        "UPDATE stored_object_retirements SET deletion_fenced_at=now()",
    ],
)
def test_control_plane_cannot_read_mail_payload_or_rewrite_resource_facts(roles, statement):
    assert_denied(roles[0]["nv_control_plane"], statement)


def test_control_plane_queries_and_mail_retry_do_not_load_payload(roles):
    from app.db.models import MailOutbox, MailOutboxStatus
    from app.modules.mail.outbox_service import MailOutboxService
    from app.modules.ops.query_service import OpsAsyncOperationQueryService
    from app.modules.ops.audit_service import OpsAuditService
    from app.modules.ops.schemas import AsyncOperationKind, OpsAuditOutcome
    from app.platform.config.delivery import OpsDeliveryConfig
    from app.platform.config.mail_delivery import MailDeliverySettings

    with Session(roles[0]["nv_customer_api"]) as db:
        mail = MailOutbox(
            category="test",
            dedupe_key="role-mail",
            recipient="private@example.test",
            subject="private",
            text_body="private link",
            source_kind="ACCOUNT",
            source_id=1,
            status=MailOutboxStatus.FAILED,
            failure_code="test",
            failure_stage="dispatch",
            failure_classification="transient",
            failure_retryable=True,
        )
        db.add(mail)
        db.commit()
        identity = mail.outbox_uuid
    with Session(roles[0]["nv_control_plane"]) as db:
        service = OpsAsyncOperationQueryService(OpsDeliveryConfig())
        assert service.list_operations(db, limit=10).items
        assert service.summary(db).total >= 1
        assert (
            MailOutboxService(config=MailDeliverySettings()).rearm_for_operator(db, identity)
            == "FAILED"
        )
        db.commit()
        OpsAuditService().record_event(
            db,
            action="retry",
            operation_kind=AsyncOperationKind.MAIL,
            operation_id=identity,
            outcome=OpsAuditOutcome.SUCCEEDED.value,
            reason="Role-isolation verification",
        )
        assert OpsAuditService().list_events(db, limit=10).items


def test_control_plane_import_recovery_executes_domain_reset(roles):
    from app.db.models import ImportJob, ImportDispatch
    from app.modules.import_jobs.domain import ImportJobState
    from app.modules.import_jobs.dispatch_service import ImportDispatchService
    from app.platform.config.import_dispatch import ImportDispatchSettings

    with Session(roles[0]["nv_customer_api"]) as db:
        job = ImportJob(
            job_uuid=str(uuid4()),
            user_id=1,
            state=ImportJobState.QUEUED,
            requested_options={"schema_version": 1, "display_title": None, "genres": []},
        )
        db.add(job)
        db.flush()
        dispatch = ImportDispatch(
            job_id=job.id,
            failure_code="test",
            failure_stage="dispatch",
            failure_classification="transient",
            failure_retryable=True,
        )
        db.add(dispatch)
        db.commit()
        identity = dispatch.dispatch_uuid
    with Session(roles[0]["nv_control_plane"]) as db:
        assert (
            ImportDispatchService(config=ImportDispatchSettings()).rearm_for_operator(db, identity)
            == "QUEUED/PENDING"
        )
        db.commit()


def test_worker_executes_account_erasure_without_credentials_table_access(roles):
    from app.core.security import get_password_hash
    from app.modules.account.deletion_service import AccountDeletionService
    from app.modules.auth.sessions_service import SessionService
    from app.platform.config.application import CustomerAuthConfig
    from app.composition.storage_resources import provision_storage_resources
    from app.composition.account_deletion import AccountDeletionExecutor
    from app.composition.storage_inventory import build_storage_inventory_registry
    from tests.support.runtime_resources import deliveries, resources_for
    from sqlalchemy.orm import sessionmaker

    engines, _ = roles
    with Session(engines["nv_customer_api"]) as db:
        db.add(
            User(
                id=40,
                email="closure-role@example.test",
                password_hash=get_password_hash("secret123"),
            )
        )
        db.flush()
        provision_storage_resources(db, 40)
        db.add(Score(score_uuid=str(uuid4()), owner_user_id=40, display_title="Owned score"))
        db.commit()
        identity = AccountDeletionService(
            SessionService(
                config=CustomerAuthConfig(
                    SECRET_KEY="test-role-key-32-characters-long-enough",
                    AUTH_COOKIE_SECURE=False,
                    AUTH_COOKIE_SAMESITE="lax",
                )
            )
        ).request_deletion(db, 40, current_password="secret123")
        db.commit()
    delivery = deliveries().account_deletion
    executor = AccountDeletionExecutor(
        build_storage_inventory_registry(),
        resources=resources_for(sessions=sessionmaker(engines["nv_worker"])),
        delivery=delivery,
        config=delivery.config,
    )
    for _ in range(30):
        with Session(engines["nv_worker"]) as db:
            lease = delivery.claim(db, identity)
            db.commit()
            assert lease is not None
            complete = executor.execute(db, lease)
            db.commit()
        if complete:
            break
    else:
        pytest.fail("Bounded account erasure did not finish")
    with Session(engines["nv_migrator"]) as db:
        assert db.get(User, 40) is None
        assert (
            db.scalar(
                sa.select(AccountDeletionOperation.status).where(
                    AccountDeletionOperation.operation_uuid == identity
                )
            )
            == AccountDeletionStatus.COMPLETED
        )


def test_exporter_has_no_writes_on_any_table_or_sequence(roles):
    with roles[0]["nv_observability"].connect() as connection:
        for table in reviewed_tables():
            for privilege in ("INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"):
                assert not connection.scalar(
                    sa.text("SELECT has_table_privilege(:table,:privilege)"),
                    {"table": table, "privilege": privilege},
                )
        assert connection.scalar(
            sa.text(
                "SELECT NOT EXISTS(SELECT 1 FROM information_schema.column_privileges WHERE grantee=current_user AND privilege_type IN ('INSERT','UPDATE','REFERENCES'))"
            )
        )


def test_bootstrap_rejects_shared_database_passwords():
    with pytest.raises(ValueError):
        bootstrap_roles(
            None, "test", dict.fromkeys(DATABASE_ROLES, "same-password-for-all-runtime-roles")
        )


@pytest.mark.parametrize(
    "role,table",
    [
        ("nv_customer_api", "stored_objects"),
        ("nv_worker", "stored_objects"),
        ("nv_worker", "practice_bundles"),
        ("nv_worker", "user_storage_entitlements"),
        ("nv_customer_api", "score_revision_practice_bindings"),
        ("nv_worker", "performance_takes"),
        ("nv_customer_api", "uploads"),
    ],
)
def test_domain_row_locks_have_the_required_column_update_privilege(roles, role, table):
    with roles[0][role].begin() as connection:
        connection.exec_driver_sql(f"SELECT * FROM {table} WHERE false FOR UPDATE")


def test_worker_anonymizes_foreign_revision_history_without_modifying_content(roles):
    from app.db.models import ScoreRevision, ScoreRevisionNote, ScoreRevisionEvent
    from app.modules.revisions.domain import RevisionOrigin
    from app.modules.revisions.account_cleanup import erase_revision_actor_links

    with Session(roles[0]["nv_customer_api"]) as db:
        score = Score(score_uuid=str(uuid4()), owner_user_id=1, display_title="Owner history")
        db.add(score)
        db.flush()
        revision = ScoreRevision(
            revision_uuid=str(uuid4()),
            score_id=score.id,
            revision_number=1,
            content_hash="a" * 64,
            origin=RevisionOrigin.IMPORT,
            created_by_user_id=1,
        )
        db.add(revision)
        db.flush()
        note = ScoreRevisionNote(
            score_id=score.id, revision_id=revision.id, author_user_id=1, note="Preserved content"
        )
        event = ScoreRevisionEvent(
            score_id=score.id, revision_id=revision.id, actor_user_id=1, type="created"
        )
        db.add_all([note, event])
        db.commit()
        note_id = note.id
    with Session(roles[0]["nv_worker"]) as db:
        for _ in range(3):
            assert erase_revision_actor_links(db, 1, limit=1)
        db.commit()
    with Session(roles[0]["nv_customer_api"]) as db:
        note = db.get(ScoreRevisionNote, note_id)
        assert note.note == "Preserved content" and note.author_user_id is None
    assert_denied(roles[0]["nv_worker"], "UPDATE score_revision_notes SET note='replacement'")


def test_customer_upload_adoption_and_worker_gc_use_only_their_runtime_roles(roles):
    from sqlalchemy.orm import sessionmaker
    from app.db.models import UploadSession, StorageUsageAccount
    from app.composition.storage_resources import provision_storage_resources
    from app.modules.media_storage.upload_sessions.schemas import UploadCreateRequest
    from app.modules.media_storage.upload_sessions.maintenance import UploadSessionMaintenance
    from app.storage.base import DirectUploadTarget
    from tests.support.object_storage import InMemoryObjectStorage
    from tests.support.runtime_resources import resources_for
    from tests.support.images import image_bytes

    provider = InMemoryObjectStorage()
    customer = resources_for(provider=provider, sessions=sessionmaker(roles[0]["nv_customer_api"]))
    uploads = customer.build_upload_service()
    data = image_bytes()
    with Session(roles[0]["nv_customer_api"]) as db:
        provision_storage_resources(db, 1)
        db.commit()
        request = uploads.create_request(
            db,
            1,
            UploadCreateRequest(
                client_request_id="role-upload",
                filename="score.png",
                byte_size=len(data),
                content_type="image/png",
            ),
        )
    transfer = request.upload_session
    target = transfer.upload_target
    provider.receive_upload(DirectUploadTarget(target.url, target.method, target.headers), data)
    uploads.uploads.complete(transfer.session_id, 1)
    with Session(roles[0]["nv_customer_api"]) as db:
        result = uploads.finalize_upload(db, 1, transfer.session_id)
        assert result == uploads.finalize_upload(db, 1, transfer.session_id)
        session = db.scalar(
            sa.select(UploadSession).where(UploadSession.session_uuid == transfer.session_id)
        )
        staging, final = session.object_key, session.final_object_key
        session.capability_expires_at = utc_now() - timedelta(seconds=1)
        db.commit()
        assert db.get(StorageUsageAccount, 1).used_bytes == len(data)
    worker = resources_for(provider=provider, sessions=sessionmaker(roles[0]["nv_worker"]))
    assert UploadSessionMaintenance(worker.build_upload_service().uploads).clean(
        transfer.session_id
    )
    assert not provider.exists(staging) and provider.read_bytes(final) == data


def test_reapplication_removes_schema_and_global_default_privilege_drift(roles):
    engines, schema = roles
    with engines["nv_migrator"].begin() as connection:
        connection.exec_driver_sql(f'GRANT CREATE ON SCHEMA "{schema}" TO nv_worker')
        connection.exec_driver_sql(
            "ALTER DEFAULT PRIVILEGES FOR ROLE nv_migrator GRANT SELECT ON TABLES TO nv_worker"
        )
        apply_runtime_grants(connection, schema)
        connection.exec_driver_sql("CREATE TABLE default_drift_probe(id integer)")
    try:
        assert_denied(engines["nv_worker"], "SELECT * FROM default_drift_probe")
        assert_denied(engines["nv_worker"], "CREATE TABLE schema_drift_probe(id integer)")
    finally:
        with engines["nv_migrator"].begin() as connection:
            connection.exec_driver_sql("DROP TABLE default_drift_probe")


def test_runtime_database_owner_is_rejected_before_credentials_change(roles):
    url = sa.engine.make_url(os.environ["NOTEVERSE_TEST_PRACTICE_BUNDLE_POSTGRES_URL"])
    database = "noteverse_test_role_owner_" + uuid4().hex
    admin = sa.create_engine(url, isolation_level="AUTOCOMMIT")
    try:
        with admin.connect() as connection:
            connection.exec_driver_sql(f'CREATE DATABASE "{database}" OWNER nv_customer_api')
        candidate = sa.create_engine(url.set(database=database))
        try:
            with candidate.begin() as connection, pytest.raises(ValueError, match="cannot own"):
                bootstrap_roles(
                    connection,
                    "public",
                    {role: secrets.token_urlsafe(32) for role in DATABASE_ROLES},
                )
        finally:
            candidate.dispose()
    finally:
        with admin.connect() as connection:
            connection.exec_driver_sql(f'DROP DATABASE IF EXISTS "{database}"')
        admin.dispose()
    with roles[0]["nv_customer_api"].connect() as connection:
        assert connection.scalar(sa.text("SELECT current_user")) == "nv_customer_api"
