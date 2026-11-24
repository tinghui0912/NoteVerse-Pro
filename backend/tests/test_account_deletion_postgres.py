"""Durable account erasure, authority cutoff and caller-owned cleanup transactions."""

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
    StorageUsageCategory as Category,
    StorageUsageAccount,
    StoredObjectRetirement,
)
from app.modules.account.deletion_service import AccountDeletionService
from app.modules.account.deletion_delivery import account_deletion_delivery as delivery
from app.composition.account_deletion import AccountDeletionExecutor
from app.modules.storage_inventory.composition import build_storage_inventory_registry
from app.modules.account.resource_admission import lock_active_resource_user
from app.modules.score_access.queries import active_score_predicate
from app.modules.storage_usage.service import storage_usage_service as usage
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
    guests, invitations = GuestPreviewService(), InvitationService()
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
        assert db.scalar(select(ScoreInvite)).terminal_outcome is None
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
        assert db.scalar(select(ScoreInvite)).terminal_actor_user_id == 1
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
    from app.modules.scores.lifecycle_service import score_lifecycle_service

    with Session(account_database) as db:
        db.add(Score(score_uuid="closing-score", owner_user_id=1, display_title="Closing"))
        db.commit()
    ready = Queue()
    with Session(account_database) as customer, ThreadPoolExecutor(1) as pool:
        owner = customer.scalar(text("SELECT pg_backend_pid()"))
        score_lifecycle_service.admit_deletions(customer, ["closing-score"], 1)
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
