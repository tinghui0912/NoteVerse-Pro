"""Durable account erasure, authority cutoff and caller-owned cleanup transactions."""

from app.storage import object_storage as _storage_provider

from app.composition import storage_resources as _resource_wiring

import pytest
from sqlalchemy import select, func
from sqlalchemy.orm import Session
from app.core.security import get_password_hash
from app.core.exceptions import ValidationException, ResourceNotFoundException
from app.db.models import (
    User,
    Score,
    StoredObject,
    Upload,
    AccountDeletionOperation,
    AccountDeletionStatus,
    StorageUsageAccount,
    StoredObjectRetirement,
)
from app.modules.storage_governance.usage.domain import StorageUsageCategory as Category
from app.db.models.score_access import InviteTerminalOutcome
from app.modules.account.deletion_service import AccountDeletionService
from app.modules.account.deletion_delivery import account_deletion_delivery as delivery
from app.composition.account_deletion import AccountDeletionExecutor
from app.composition.storage_inventory import build_storage_inventory_registry
from app.modules.account.resource_admission import lock_active_resource_user
from app.modules.score_access.queries import active_score_predicate
from app.composition.storage_resources import storage_usage_service as usage
from tests.support.storage_state import provision_storage_users


@pytest.fixture
def account_database(postgres_engine):
    with Session(postgres_engine) as db:
        db.add_all(
            [
                User(
                    id=n,
                    email=f"erase{n}@example.test",
                    password_hash=get_password_hash("secret123"),
                )
                for n in (1, 2)
            ]
        )
        db.flush()
        provision_storage_users(db)
        db.commit()
    return postgres_engine


def request(engine):
    with Session(engine) as db:
        uuid = AccountDeletionService().request_deletion(db, 1, current_password="secret123")
        db.commit()
        return uuid


def unit(engine, uuid):
    with Session(engine) as db:
        lease = delivery.claim(db, uuid)
        db.commit()
    assert lease is not None
    with Session(engine) as db:
        complete = AccountDeletionExecutor(build_storage_inventory_registry()).execute(db, lease)
        db.commit()
    return complete


def test_admission_rejects_password_and_rolls_back_with_caller(account_database):
    with Session(account_database) as db:
        with pytest.raises(ValidationException):
            AccountDeletionService().request_deletion(db, 1, current_password="incorrect")
        db.rollback()
        assert db.get(User, 1).deleted_at is None
        AccountDeletionService().request_deletion(db, 1, current_password="secret123")
        db.rollback()
        assert db.get(User, 1).deleted_at is None
        assert db.scalar(select(func.count()).select_from(AccountDeletionOperation)) == 0


def test_tombstone_immediately_extinguishes_owned_score_authority(account_database):
    with Session(account_database) as db:
        db.add(Score(score_uuid="erased-score", owner_user_id=1, display_title="Private"))
        db.commit()
    uuid = request(account_database)
    with Session(account_database) as db:
        assert db.scalar(select(Score).where(active_score_predicate())) is None
        assert db.scalar(select(Score)) is not None
        with pytest.raises(ResourceNotFoundException):
            lock_active_resource_user(db, 1)
        assert (
            AccountDeletionService().request_deletion(db, 1, current_password="secret123") == uuid
        )
    for _ in range(15):
        if unit(account_database, uuid):
            break
    else:
        pytest.fail("Account erasure did not finish")
    with Session(account_database) as db:
        assert db.get(User, 1) is None
        assert db.get(User, 2) is not None
        op = db.scalar(select(AccountDeletionOperation))
        assert op.status == AccountDeletionStatus.COMPLETED
        assert op.user_id is None and op.user_id_snapshot == 1


def test_account_tombstone_cuts_guest_and_invite_authorities_before_graph_cleanup(account_database):
    from datetime import timedelta
    from app.db.models import ScoreInvite, MembershipRole
    from tests.test_score_revision_services import add_active_score_with_head_revision
    from app.modules.guest_previews.service import GuestPreviewService
    from app.modules.collaboration.invitation_service import InvitationService
    from app.modules.collaboration.invite_lifecycle import hash_invite_token
    from app.shared.time import utc_now

    token = "invite-token"
    guests, invitations = (
        GuestPreviewService(
            delivery=_resource_wiring.build_media_delivery_service(_storage_provider)
        ),
        InvitationService(),
    )
    with Session(account_database) as db:
        score = add_active_score_with_head_revision(
            db,
            score_id=70,
            revision_id=71,
            score_uuid="bearer-score",
            revision_uuid="bearer-head",
            title="Shared",
        )
        credential = guests.issue_credential(db, score.score_uuid, 1)
        db.add(
            ScoreInvite(
                score_id=score.id,
                email="erase2@example.test",
                role=MembershipRole.VIEWER,
                created_by_user_id=1,
                token_hash=hash_invite_token(token),
                expires_at=utc_now() + timedelta(days=1),
            )
        )
        db.commit()
        assert guests.read(db, credential.token).display_title == "Shared"
        assert invitations.inspect_invite(db, token, None).score_id == "bearer-score"
        assert len(invitations.list_my_pending_invites(db, 2).items) == 1
    request(account_database)
    with Session(account_database) as db:
        assert db.get(Score, 70).deleted_at is None
        assert (
            db.scalar(select(ScoreInvite)).terminal_outcome
            == InviteTerminalOutcome.INVITER_ACCOUNT_CLOSED
        )
        with pytest.raises(ResourceNotFoundException):
            guests.read(db, credential.token)
        with pytest.raises(ResourceNotFoundException):
            invitations.inspect_invite(db, token, None)
        with pytest.raises(ResourceNotFoundException):
            invitations.accept_invite(db, token, 2)
        assert invitations.list_my_pending_invites(db, 2).items == []


def test_shared_physical_object_and_other_owner_survive_erasure(account_database):
    with Session(account_database) as db:
        obj = StoredObject(
            object_key="shared", byte_size=10, sha256="a" * 64, content_type="image/png"
        )
        db.add(obj)
        db.flush()
        for n in (1, 2):
            db.add(
                Upload(
                    upload_uuid=f"upload-{n}",
                    uploader_user_id=n,
                    original_filename="image.png",
                    stored_object_id=obj.id,
                )
            )
            usage.record_allocation(
                db, user_id=n, category=Category.UPLOAD, bytes_count=10, reason="seed"
            )
        db.commit()
    uuid = request(account_database)
    for _ in range(15):
        if unit(account_database, uuid):
            break
    with Session(account_database) as db:
        assert db.get(User, 1) is None
        assert db.scalar(select(StoredObject)) is not None
        assert db.scalar(select(Upload)).uploader_user_id == 2
        assert db.get(StorageUsageAccount, 2).used_bytes == 10
        assert db.scalar(select(func.count()).select_from(StoredObjectRetirement)) == 0


def test_session_revocation_and_foreign_actor_history_survive_correctly(account_database):
    from app.modules.auth.sessions_service import SessionService
    from app.db.models import (
        Notification,
        NotificationKind,
        ScoreInvite,
        MembershipRole,
        InviteTerminalOutcome,
    )
    from datetime import timedelta
    from app.shared.time import utc_now

    with Session(account_database) as db:
        SessionService().create_token_pair(db, 1)
        score = Score(score_uuid="other-owner", owner_user_id=2, display_title="Retained")
        db.add(score)
        db.flush()
        db.add(
            ScoreInvite(
                score_id=score.id,
                email="erase1@example.test",
                role=MembershipRole.VIEWER,
                token_hash="b" * 64,
                created_by_user_id=2,
                expires_at=utc_now() + timedelta(days=1),
                terminal_outcome=InviteTerminalOutcome.ACCEPTED,
                terminal_at=utc_now(),
                terminal_actor_user_id=1,
            )
        )
        db.add(
            Notification(
                recipient_user_id=2,
                actor_user_id=1,
                kind=NotificationKind.SCORE_INVITE_ACCEPTED,
                invite_id="response-history",
                score_id=score.score_uuid,
                score_display_title_snapshot=score.display_title,
            )
        )
        db.commit()
    uuid = request(account_database)
    from app.db.models.auth import RefreshToken

    with Session(account_database) as db:
        assert db.scalar(select(RefreshToken)).revoked_at is not None
    for _ in range(15):
        if unit(account_database, uuid):
            break
    with Session(account_database) as db:
        assert db.get(User, 1) is None
        assert db.scalar(select(RefreshToken)) is None
        assert db.scalar(select(ScoreInvite)).terminal_actor_user_id is None
        assert db.scalar(select(Notification)).actor_user_id == 1
        assert db.scalar(select(Score)).owner_user_id == 2


def test_unit_rollback_preserves_resource_and_usage(account_database, monkeypatch):
    with Session(account_database) as db:
        obj = StoredObject(
            object_key="one", byte_size=10, sha256="b" * 64, content_type="image/png"
        )
        db.add(obj)
        db.flush()
        db.add(
            Upload(
                upload_uuid="one",
                uploader_user_id=1,
                original_filename="one.png",
                stored_object_id=obj.id,
            )
        )
        usage.record_allocation(
            db, user_id=1, category=Category.UPLOAD, bytes_count=10, reason="seed"
        )
        db.commit()
    with Session(account_database) as db:
        obj = StoredObject(
            object_key="two", byte_size=10, sha256="c" * 64, content_type="image/png"
        )
        db.add(obj)
        db.flush()
        db.add(
            Upload(
                upload_uuid="two",
                uploader_user_id=1,
                original_filename="two.png",
                stored_object_id=obj.id,
            )
        )
        usage.record_allocation(
            db, user_id=1, category=Category.UPLOAD, bytes_count=10, reason="seed"
        )
        db.commit()
    uuid = request(account_database)
    for _ in range(3):
        assert not unit(account_database, uuid)
    assert not unit(account_database, uuid)  # First Upload cleanup is committed.
    from app.modules.uploads import service

    def fail(*args, **kwargs):
        raise RuntimeError("retirement admission failed")

    monkeypatch.setattr(service, "retire_after_release", fail)
    with pytest.raises(RuntimeError, match="retirement admission"):
        unit(account_database, uuid)
    with Session(account_database) as db:
        assert db.scalar(select(Upload)).upload_uuid == "two"
        assert db.get(StorageUsageAccount, 1).used_bytes == 10
        assert db.scalar(select(func.count()).select_from(StoredObjectRetirement)) == 1


def test_tombstone_and_final_erasure_use_distinct_user_lock_strength(account_database):
    from sqlalchemy import text
    from sqlalchemy.exc import OperationalError
    from app.modules.account.deletion_repository import AccountDeletionRepository

    with Session(account_database) as admitted:
        lock_active_resource_user(admitted, 1)
        # Closing admission never waits for admitted creators or takes Score locks.
        with Session(account_database) as closing:
            closing.execute(text("SET LOCAL statement_timeout='2000ms'"))
            uuid = AccountDeletionService().request_deletion(
                closing, 1, current_password="secret123"
            )
            closing.commit()
        with Session(account_database) as late:
            with pytest.raises(ResourceNotFoundException):
                lock_active_resource_user(late, 1)
        with Session(account_database) as erasing:
            with pytest.raises(OperationalError):
                erasing.execute(select(User).where(User.id == 1).with_for_update(nowait=True))
            erasing.rollback()
        admitted.rollback()
        with Session(account_database) as erasing:
            assert AccountDeletionRepository().lock_user(erasing, 1, erasure=True).deleted_at
    assert uuid


def test_quota_expiry_ignores_only_erased_discovery_lineage(account_database, monkeypatch):
    from datetime import timedelta
    from app.composition.storage_resources import (
        storage_quota_service as quota,
        storage_quota_expiry,
    )
    from app.shared.time import utc_now

    now = utc_now()
    with Session(account_database) as db:
        hold = quota.create_hold(
            db,
            user_id=1,
            category=Category.UPLOAD,
            bytes_count=10,
            command_key="erasure-race",
            expires_at=now + timedelta(minutes=1),
        )
        identity = hold.hold_id
        db.commit()
    uuid = request(account_database)
    for _ in range(20):
        if unit(account_database, uuid):
            break
    with Session(account_database) as db:
        assert db.get(User, 1) is None
        monkeypatch.setattr(
            storage_quota_expiry.quota.repository,
            "expired_candidates",
            lambda *args: [(1, identity)],
        )
        assert storage_quota_expiry.expire_due(db, now=now + timedelta(hours=1)) == 0


def test_final_erasure_yields_to_busy_accounting_without_parent_fk_deadlock(account_database):
    from app.db.models import AccountDeletionPhase
    from app.shared.time import utc_now

    uuid = request(account_database)
    with Session(account_database) as db:
        operation = db.scalar(select(AccountDeletionOperation))
        operation.phase = AccountDeletionPhase.FINALIZE
        db.commit()
    with Session(account_database) as accounting:
        usage.committed_bytes(accounting, 1, lock=True)
        assert not unit(account_database, uuid)
        with Session(account_database) as observer:
            assert observer.get(User, 1) is not None
            operation = observer.scalar(select(AccountDeletionOperation))
            assert operation.status == AccountDeletionStatus.PENDING
            operation.next_attempt_at = utc_now()
            observer.commit()
        accounting.rollback()
    assert unit(account_database, uuid)


def test_http_admission_closes_session_without_waiting_for_physical_cleanup(
    account_database, monkeypatch
):
    from fastapi.testclient import TestClient
    from app.main import app
    from app.api.deps import get_db, get_current_user
    from unittest.mock import Mock

    dispatch = Mock()
    monkeypatch.setattr(
        "app.modules.account.router.dispatch_account_deletion_best_effort", dispatch
    )
    with Session(account_database) as db:

        def database():
            yield db

        app.dependency_overrides[get_db] = database
        app.dependency_overrides[get_current_user] = lambda: db.get(User, 1)
        try:
            with TestClient(app) as client:
                response = client.request(
                    "DELETE", "/api/v1/me", json={"current_password": "secret123"}
                )
        finally:
            app.dependency_overrides.pop(get_db, None)
            app.dependency_overrides.pop(get_current_user, None)
        assert response.status_code == 202
        assert "Max-Age=0" in response.headers["set-cookie"]
        dispatch.assert_called_once_with(response.json()["operation_id"])
    with Session(account_database) as db:
        assert db.get(User, 1).deleted_at is not None
        assert db.scalar(select(AccountDeletionOperation)).status == AccountDeletionStatus.PENDING


def test_committed_unit_survives_lost_delivery_acknowledgement(account_database):
    from app.modules.account.deletion_delivery import StaleAccountDeletionAttempt

    uuid = request(account_database)
    with Session(account_database) as db:
        lease = delivery.claim(db, uuid)
        db.commit()
    with Session(account_database) as db:
        assert not AccountDeletionExecutor(build_storage_inventory_registry()).execute(db, lease)
        db.commit()
    # Crash between unit COMMIT and broker continuation: periodic discovery owns retry.
    with Session(account_database) as db:
        assert delivery.recover_and_list_due(db) == [uuid]
        with pytest.raises(StaleAccountDeletionAttempt):
            delivery.require(db, lease)
        db.rollback()
    assert not unit(account_database, uuid)


def test_execution_failure_rolls_back_unit_and_persists_failed_attempt(
    account_database, monkeypatch
):
    from sqlalchemy.orm import sessionmaker
    from app.worker.execution import account_deletion as worker
    from app.db.models import AccountDeletionPhase

    uuid = request(account_database)
    monkeypatch.setattr(worker, "SessionLocal", sessionmaker(account_database))
    original = AccountDeletionExecutor.execute

    def interrupted(self, db, lease):
        original(self, db, lease)
        db.flush()
        raise RuntimeError("unit interrupted")

    monkeypatch.setattr(AccountDeletionExecutor, "execute", interrupted)
    with pytest.raises(RuntimeError, match="unit interrupted"):
        worker.execute_account_deletion_task(None, uuid)
    with Session(account_database) as db:
        op = db.scalar(select(AccountDeletionOperation))
        assert op.status == AccountDeletionStatus.FAILED
        assert op.phase == AccountDeletionPhase.SCORES
        assert op.attempt_count == 1 and op.attempt_token is None
        assert db.get(User, 1).deleted_at is not None


def test_delivery_recovery_is_bounded_and_attempt_exhaustion_stays_visible(
    account_database, monkeypatch
):
    from datetime import timedelta
    from app.core.config import settings
    from app.shared.time import utc_now

    monkeypatch.setattr(settings, "ACCOUNT_DELETION_BATCH_SIZE", 1)
    monkeypatch.setattr(settings, "ACCOUNT_DELETION_MAX_ATTEMPTS", 1)
    first = request(account_database)
    with Session(account_database) as db:
        second = AccountDeletionService().request_deletion(db, 2, current_password="secret123")
        db.commit()
        assert len(delivery.recover_and_list_due(db)) == 1
        lease = delivery.claim(db, first)
        db.commit()
        row = delivery.require(db, lease)
        row.started_at = utc_now() - timedelta(hours=1)
        db.commit()
        assert delivery.recover_and_list_due(db) == [second]
        db.commit()
        row = db.scalar(
            select(AccountDeletionOperation).where(AccountDeletionOperation.operation_uuid == first)
        )
        assert row.status == AccountDeletionStatus.FAILED and row.attempt_count == 1
        assert delivery.claim(db, first) is None


def test_account_score_admission_serializes_with_pre_admitted_customer_deletion(account_database):
    from concurrent.futures import ThreadPoolExecutor
    from queue import Queue
    from time import monotonic
    from sqlalchemy import text
    from app.composition.media_resources import build_score_lifecycle_service

    with Session(account_database) as db:
        db.add(Score(score_uuid="closing-score", owner_user_id=1, display_title="Closing"))
        db.commit()
    ready = Queue()
    with Session(account_database) as customer, ThreadPoolExecutor(1) as pool:
        owner = customer.scalar(text("SELECT pg_backend_pid()"))
        build_score_lifecycle_service().admit_deletions(customer, ["closing-score"], 1)
        uuid = request(account_database)

        def erase():
            with Session(account_database) as db:
                lease = delivery.claim(db, uuid)
                db.commit()
                ready.put(db.scalar(text("SELECT pg_backend_pid()")))
                result = AccountDeletionExecutor(build_storage_inventory_registry()).execute(
                    db, lease
                )
                db.commit()
                return result

        future = pool.submit(erase)
        contender = ready.get(timeout=10)
        try:
            deadline = monotonic() + 10
            with account_database.connect().execution_options(
                isolation_level="AUTOCOMMIT"
            ) as observer:
                while not observer.scalar(
                    text("SELECT :owner = ANY(pg_blocking_pids(:contender))"),
                    {"owner": owner, "contender": contender},
                ):
                    assert monotonic() < deadline
            assert not future.done()
        finally:
            customer.commit()
        assert not future.result(timeout=10)
    for _ in range(20):
        if unit(account_database, uuid):
            break
    with Session(account_database) as db:
        assert db.get(User, 1) is None
        assert db.scalar(select(Score)) is None


def test_real_access_cookie_is_rejected_immediately_and_missed_dispatch_is_discoverable(
    account_database, monkeypatch
):
    from fastapi.testclient import TestClient
    from app.main import app
    from app.api.deps import get_db
    from app.modules.auth.sessions_service import SessionService
    from app.core.generated.customer_browser_protocol import (
        AUTH_COOKIE_NAME,
        CSRF_COOKIE_NAME,
        CSRF_HEADER_NAME,
    )
    from app.worker.dispatch import account_deletion as dispatcher

    with Session(account_database) as db:
        db.get(User, 1).email = "closed@example.com"
        access, _, _ = SessionService().create_token_pair(db, 1)
        db.commit()

    def database():
        with Session(account_database) as db:
            yield db

    def unavailable(uuid):
        raise OSError("broker unavailable")

    monkeypatch.setattr(dispatcher, "dispatch_account_deletion", unavailable)
    app.dependency_overrides[get_db] = database
    try:
        with TestClient(app) as client:
            client.cookies.set(AUTH_COOKIE_NAME, access)
            client.cookies.set(CSRF_COOKIE_NAME, "csrf-test")
            assert client.get("/api/v1/me/profile").status_code == 200
            result = client.request(
                "DELETE",
                "/api/v1/me",
                json={"current_password": "secret123"},
                headers={CSRF_HEADER_NAME: "csrf-test"},
            )
            assert result.status_code == 202, result.text
            assert "Max-Age=0" in result.headers["set-cookie"]
            operation = result.json()["operation_id"]
            client.cookies.set(AUTH_COOKIE_NAME, access)
            assert client.get("/api/v1/me/profile").status_code == 401
            assert client.get("/api/v1/me/deletion-status").status_code == 404
            with Session(account_database) as observer:
                assert delivery.recover_and_list_due(observer) == [operation]
            for _ in range(20):
                if unit(account_database, operation):
                    break
            assert client.get("/api/v1/me/profile").status_code == 401
        with Session(account_database) as db:
            assert delivery.recover_and_list_due(db) == []
            assert db.get(User, 1) is None
            assert (
                db.scalar(select(AccountDeletionOperation)).status
                == AccountDeletionStatus.COMPLETED
            )
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.mark.parametrize(
    "error,classification,retryable",
    [
        (TimeoutError("secret provider URL"), "transient", True),
        (RuntimeError("unexpected worker failure"), "system_error", True),
        (ValueError("secret resource facts"), "permanent", False),
    ],
)
def test_account_failure_facts_classify_typed_errors_and_do_not_leak_details(
    account_database, error, classification, retryable
):
    uuid = request(account_database)
    with Session(account_database) as db:
        lease = delivery.claim(db, uuid)
        db.commit()
        delivery.fail(db, lease, error)
        db.commit()
        row = db.scalar(select(AccountDeletionOperation))
        assert row.failure_classification == classification and row.failure_retryable is retryable
        assert row.failure_stage == "scores" and len(row.failure_detail) <= 4000
        assert str(error) not in row.failure_detail
        from app.shared.time import utc_now

        row.next_attempt_at = utc_now()
        db.commit()
        assert (uuid in delivery.recover_and_list_due(db)) is retryable


def test_private_history_erasure_is_bounded_and_preserves_other_recipients(
    account_database, monkeypatch
):
    from app.core.config import settings
    from app.db.models import AccountDeletionPhase, Notification, NotificationKind

    monkeypatch.setattr(settings, "ACCOUNT_DELETION_RESOURCE_BATCH_SIZE", 2)
    with Session(account_database) as db:
        for number in range(5):
            db.add(
                Notification(
                    recipient_user_id=1,
                    kind=NotificationKind.IMPORT_FAILED,
                    import_job_id=f"job-{number}",
                )
            )
        db.add(
            Notification(
                recipient_user_id=2,
                kind=NotificationKind.IMPORT_FAILED,
                import_job_id="retained-job",
            )
        )
        db.commit()
    uuid = request(account_database)
    with Session(account_database) as db:
        operation = db.scalar(select(AccountDeletionOperation))
        operation.phase = AccountDeletionPhase.FINALIZE
        db.commit()
    assert not unit(account_database, uuid)
    with Session(account_database) as db:
        assert (
            db.scalar(
                select(func.count())
                .select_from(Notification)
                .where(Notification.recipient_user_id == 1)
            )
            == 3
        )
        assert db.get(User, 1) is not None
    for _ in range(15):
        if unit(account_database, uuid):
            break
    with Session(account_database) as db:
        assert db.get(User, 1) is None
        assert db.scalar(select(Notification)).recipient_user_id == 2


def test_closed_recipient_admission_does_not_recreate_private_history(account_database):
    from app.modules.notifications.service import NotificationService
    from app.db.models import Notification, RealtimeChange
    from app.shared.time import utc_now

    request(account_database)
    with Session(account_database) as db:
        assert (
            NotificationService().admit_import_failed(
                db,
                recipient_user_id=1,
                import_job_id="late-job",
                import_display_title=None,
                created_at=utc_now(),
            )
            is None
        )
        db.commit()
        assert db.scalar(select(func.count()).select_from(Notification)) == 0
        assert db.scalar(select(func.count()).select_from(RealtimeChange)) == 0


def test_foreign_revision_actor_is_anonymized_without_erasing_the_resource(account_database):
    from tests.test_score_revision_services import add_active_score_with_head_revision
    from app.db.models import ScoreRevision

    with Session(account_database) as db:
        score = add_active_score_with_head_revision(
            db,
            score_id=81,
            revision_id=82,
            score_uuid="retained-score",
            revision_uuid="retained-revision",
            title="Other owner's work",
        )
        score.owner_user_id = 2
        revision = db.get(ScoreRevision, 82)
        revision.created_by_user_id = 1
        db.commit()
    uuid = request(account_database)
    for _ in range(20):
        if unit(account_database, uuid):
            break
    with Session(account_database) as db:
        assert db.get(User, 1) is None
        assert db.get(Score, 81).owner_user_id == 2
        assert db.get(ScoreRevision, 82).created_by_user_id is None


def test_account_completion_precedes_independent_physical_retirement(account_database, monkeypatch):
    from sqlalchemy.orm import sessionmaker
    from app.worker.execution import stored_object_retirement as worker
    from app.modules.media_storage.persistence import object_from_bytes
    from tests.support.object_storage import InMemoryObjectStorage
    from app.modules.media_storage.domain import StoredObjectRetirementStatus

    storage = InMemoryObjectStorage()
    content = b"owned resource"
    storage.put_bytes(
        key="account-only-object", content=content, content_type="application/octet-stream"
    )
    with Session(account_database) as db:
        obj = object_from_bytes(
            object_key="account-only-object",
            content=content,
            content_type="application/octet-stream",
        )
        db.add(obj)
        db.flush()
        object_id = obj.id
        db.add(
            Upload(
                upload_uuid="owned-upload",
                uploader_user_id=1,
                original_filename="owned.bin",
                stored_object_id=object_id,
            )
        )
        usage.record_allocation(
            db, user_id=1, category=Category.UPLOAD, bytes_count=len(content), reason="seed"
        )
        db.commit()
    uuid = request(account_database)
    for _ in range(20):
        if unit(account_database, uuid):
            break
    with Session(account_database) as db:
        assert db.get(User, 1) is None
        assert db.scalar(select(AccountDeletionOperation)).status == AccountDeletionStatus.COMPLETED
        retirement = db.scalar(select(StoredObjectRetirement))
        assert retirement.status == StoredObjectRetirementStatus.PENDING
        assert db.get(StoredObject, object_id) is not None
        retirement_uuid = retirement.retirement_uuid
    assert storage.exists("account-only-object")
    monkeypatch.setattr(worker, "SessionLocal", sessionmaker(account_database))
    monkeypatch.setattr(worker, "object_storage", storage)
    assert (
        worker.execute_stored_object_retirement_task(None, retirement_uuid)["status"] == "completed"
    )
    with Session(account_database) as db:
        assert db.get(StoredObject, object_id) is None
        retirement = db.scalar(select(StoredObjectRetirement))
        assert retirement.stored_object_id is None and retirement.deletion_fenced_at is not None
        assert db.scalar(select(AccountDeletionOperation)).status == AccountDeletionStatus.COMPLETED
    assert not storage.exists("account-only-object")


def test_actor_anonymization_does_not_erase_a_concurrent_other_user_attribution(account_database):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Event
    from sqlalchemy import event, update
    from tests.test_score_revision_services import add_active_score_with_head_revision
    from app.db.models import ScoreRevision, ScoreRevisionNote
    from app.modules.revisions.account_cleanup import erase_revision_actor_links
    from app.modules.account.deletion_repository import AccountDeletionRepository

    with Session(account_database) as db:
        score = add_active_score_with_head_revision(
            db,
            score_id=91,
            revision_id=92,
            score_uuid="foreign-score",
            revision_uuid="foreign-revision",
            title="Foreign owner",
        )
        score.owner_user_id = 2
        db.get(ScoreRevision, 92).created_by_user_id = 2
        db.add(
            ScoreRevisionNote(score_id=91, revision_id=92, author_user_id=1, note="Original note")
        )
        db.commit()
    request(account_database)
    selected, edited = Event(), Event()

    def edit():
        assert selected.wait(10)
        try:
            with Session(account_database) as db:
                db.execute(
                    update(ScoreRevisionNote)
                    .where(ScoreRevisionNote.revision_id == 92)
                    .values(author_user_id=2, note="Updated by surviving owner")
                )
                db.commit()
        finally:
            edited.set()

    with Session(account_database) as db, ThreadPoolExecutor(1) as pool:
        AccountDeletionRepository().lock_user(db, 1, erasure=True)
        connection = db.connection()

        def before_update(_connection, _cursor, statement, _parameters, _context, _executemany):
            if statement.startswith("UPDATE score_revision_notes"):
                selected.set()
                assert edited.wait(10)

        event.listen(connection, "before_cursor_execute", before_update)
        future = pool.submit(edit)
        try:
            assert erase_revision_actor_links(db, 1, limit=1)
            db.commit()
            future.result(timeout=10)
        finally:
            event.remove(connection, "before_cursor_execute", before_update)
    with Session(account_database) as db:
        note = db.scalar(select(ScoreRevisionNote))
        assert note.author_user_id == 2 and note.note == "Updated by surviving owner"
