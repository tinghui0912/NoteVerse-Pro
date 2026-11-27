"""Real PostgreSQL authority transfer, bounded capability plans and recovery."""

from dataclasses import replace
from datetime import timedelta
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from unittest.mock import Mock
from uuid import uuid4
import pytest
from sqlalchemy import select, func
from sqlalchemy.orm import sessionmaker
from app.db.models import (
    User,
    UploadSession,
    StoredObject,
    Upload,
    UploadCreationRequest,
    StoragePlanPolicy,
    UserStorageEntitlement,
    StorageUsageAccount,
    StorageQuotaHold,
)
from app.composition import storage_resources as resources
from app.modules.media_storage.write_coordinator import ObjectWriteCoordinator
from app.modules.media_storage.upload_sessions.domain import (
    UploadPolicy,
    UploadPurpose as Purpose,
    UploadStatus as Status,
    UploadMode as Mode,
)
from app.modules.media_storage.upload_sessions.service import UploadSessionService
from app.modules.media_storage.upload_sessions.maintenance import UploadSessionMaintenance
from app.modules.media_storage.upload_sessions.schemas import UploadCreateRequest
from app.modules.uploads.service import UploadService
from app.storage.base import DirectUploadTarget, ObjectStorageUnavailableError
from tests.support.object_storage import InMemoryObjectStorage
from tests.support.images import image_bytes
from app.shared.time import utc_now
from app.platform.config.object_writes import ObjectWriteSettings


@pytest.fixture
def transfers(postgres_engine):
    sessions = sessionmaker(postgres_engine, expire_on_commit=False)
    storage = InMemoryObjectStorage()
    policy = UploadPolicy(
        20 * 1024**2,
        500 * 1024**2,
        2 * 1024**3,
        20 * 1024**2,
        16 * 1024**2,
        900,
        86400,
        3,
        5,
        4 * 1024**3,
    )
    service = UploadSessionService(
        storage,
        sessions,
        ObjectWriteCoordinator(storage, sessions, config=ObjectWriteSettings()),
        policy,
    )
    with sessions.begin() as db:
        db.add(StoragePlanPolicy(plan_code="FREE", default_limit_bytes=100 * 1024**2))
        db.add_all(
            [User(id=i, email=f"transfer{i}@example.test", password_hash="hash") for i in (1, 2)]
        )
        db.flush()
        db.add_all([UserStorageEntitlement(user_id=i, plan_code="FREE") for i in (1, 2)])
        db.add_all([StorageUsageAccount(user_id=i, used_bytes=0) for i in (1, 2)])
    return sessions, storage, service


def admit(transfers, size, *, purpose=Purpose.PERFORMANCE_TAKE, content_type="audio/webm"):
    sessions, storage, service = transfers
    with sessions() as db:
        row = service.admit(
            db,
            user_id=1,
            purpose=purpose,
            byte_size=size,
            content_type=content_type,
            final_key="recordings/" + str(uuid4()),
        )
        uuid = row.session_uuid
        db.commit()
    return service.start(uuid, 1)


def receive(storage, target, data):
    storage.receive_upload(DirectUploadTarget(target.url, target.method, target.headers), data)


def test_single_put_copy_consumption_and_gc_keep_formal_object(transfers):
    sessions, storage, service = transfers
    data = image_bytes()
    uploads = UploadService(
        uploads=service,
        quota=resources.storage_quota_service,
        usage=resources.storage_usage_service,
    )
    with sessions() as db:
        response = uploads.create_request(
            db,
            1,
            UploadCreateRequest(
                client_request_id="image",
                filename="page.png",
                byte_size=len(data),
                content_type="image/png",
            ),
        )
    transfer = response.upload_session
    assert transfer.mode == Mode.SINGLE_PUT
    receive(storage, transfer.upload_target, data)
    service.complete(transfer.session_id, 1)
    with sessions() as db:
        result = uploads.finalize_upload(db, 1, transfer.session_id)
        again = uploads.finalize_upload(db, 1, transfer.session_id)
        assert result == again
    with sessions() as db:
        row = db.scalar(select(UploadSession))
        assert row.status == Status.CONSUMED
        staging, final = row.object_key, row.final_object_key
        row.capability_expires_at = utc_now() - timedelta(seconds=1)
        db.commit()
    assert UploadSessionMaintenance(service).clean(transfer.session_id)
    assert not storage.exists(staging) and storage.read_bytes(final) == data
    with sessions() as db:
        assert db.scalar(select(func.count()).select_from(Upload)) == 1
        assert db.scalar(select(StorageQuotaHold)).status.value == "CONSUMED"
        assert db.get(StorageUsageAccount, 1).used_bytes == len(data)


def test_multipart_plan_and_consumed_object_are_not_gc_targets(transfers):
    sessions, storage, service = transfers
    data = b"\x1aE\xdf\xa3" + b"x" * (21 * 1024**2 - 4)
    transfer = admit(transfers, len(data))
    assert (
        transfer.mode == Mode.MULTIPART
        and transfer.upload_target is None
        and transfer.part_count == 2
    )
    for number in (1, 2):
        target = service.part_url(transfer.session_id, 1, number)
        start = (number - 1) * transfer.part_size
        receive(storage, target, data[start : start + transfer.part_size])
        receive(storage, target, data[start : start + transfer.part_size])
    service.complete(transfer.session_id, 1)
    storage.copy = Mock(side_effect=AssertionError("Multipart promotion copies bytes"))
    storage.iter_bytes = Mock(side_effect=AssertionError("Multipart completion reads full bytes"))
    service.prepare_adoption(transfer.session_id, 1, Purpose.PERFORMANCE_TAKE)
    with sessions() as db:
        obj = service.consume(
            db, uuid=transfer.session_id, user_id=1, purpose=Purpose.PERFORMANCE_TAKE
        )
        assert obj.sha256 is None and obj.provider_etag
        key = obj.object_key
        db.commit()
    storage.delete = Mock(wraps=storage.delete)
    assert UploadSessionMaintenance(service).clean(transfer.session_id)
    storage.delete.assert_not_called()
    assert storage.exists(key)


def test_initiate_unknown_recovers_only_through_exact_key_discovery(transfers, monkeypatch):
    sessions, storage, service = transfers
    create = storage.create_multipart_upload

    def unknown(*args, **kwargs):
        create(*args, **kwargs)
        raise ObjectStorageUnavailableError("acknowledgement unavailable")

    monkeypatch.setattr(storage, "create_multipart_upload", unknown)
    with pytest.raises(ObjectStorageUnavailableError):
        admit(transfers, 21 * 1024**2)
    with sessions() as db:
        row = db.scalar(select(UploadSession))
        uuid = row.session_uuid
        assert row.operation_unknown and row.provider_upload_id is None
    assert service.recover(uuid)
    with sessions() as db:
        row = db.scalar(select(UploadSession))
        assert row.provider_upload_id in storage.uploads and not row.operation_unknown


def test_unknown_initiate_empty_discovery_keeps_cleanup_responsibility(transfers, monkeypatch):
    sessions, storage, service = transfers
    monkeypatch.setattr(
        storage,
        "create_multipart_upload",
        Mock(side_effect=ObjectStorageUnavailableError("unknown")),
    )
    with pytest.raises(ObjectStorageUnavailableError):
        admit(transfers, 21 * 1024**2)
    with sessions() as db:
        row = db.scalar(select(UploadSession))
        uuid = row.session_uuid
        service.cancel(db, row.id)
        db.commit()
    assert not service.recover(uuid)
    assert not UploadSessionMaintenance(service).clean(uuid)
    with sessions() as db:
        row = db.scalar(select(UploadSession))
        assert row.cleanup_completed_at is None and row.operation_unknown


def test_complete_unknown_recovers_committed_object_without_repeating_complete(
    transfers, monkeypatch
):
    sessions, storage, service = transfers
    transfer = admit(transfers, 21 * 1024**2)
    for number in (1, 2):
        target = service.part_url(transfer.session_id, 1, number)
        receive(storage, target, b"x" * int(target.headers["content-length"]))
    complete = storage.complete_multipart_upload

    def unknown(*args, **kwargs):
        complete(*args, **kwargs)
        raise ObjectStorageUnavailableError("acknowledgement unavailable")

    monkeypatch.setattr(storage, "complete_multipart_upload", unknown)
    with pytest.raises(ObjectStorageUnavailableError):
        service.complete(transfer.session_id, 1)
    monkeypatch.setattr(
        storage,
        "complete_multipart_upload",
        Mock(side_effect=AssertionError("Duplicate completion")),
    )
    assert service.recover(transfer.session_id)
    assert service.read(transfer.session_id, 1).status == Status.COMPLETED


def test_declared_size_mismatch_rejects_completion(transfers):
    sessions, storage, service = transfers
    transfer = admit(transfers, 4)
    with sessions() as db:
        key = db.scalar(select(UploadSession.object_key))
    storage.put_bytes(key=key, content=b"wrong-size", content_type="audio/webm")
    with pytest.raises(ValueError):
        service.complete(transfer.session_id, 1)
    with sessions() as db:
        assert db.scalar(select(StoredObject)) is None
        assert db.scalar(select(UploadSession)).status == Status.FAILED


def test_active_session_and_temporary_byte_guards(transfers):
    sessions, storage, service = transfers
    service.policy = replace(service.policy, max_active_sessions=1)
    admit(transfers, 4)
    with pytest.raises(ValueError, match="transport capacity"):
        admit(transfers, 4)
    service.policy = replace(service.policy, max_active_sessions=5, temporary_byte_budget=5)
    with pytest.raises(ValueError, match="transport capacity"):
        admit(transfers, 4)


@pytest.mark.parametrize(
    "purpose,size,content_type",
    [
        (Purpose.SCORE_IMPORT, 20 * 1024**2 + 1, "image/png"),
        (Purpose.PERFORMANCE_TAKE, 500 * 1024**2 + 1, "audio/webm"),
        (Purpose.PERFORMANCE_TAKE, 2 * 1024**3 + 1, "video/webm"),
    ],
)
def test_file_limits_are_checked_before_provider_io(transfers, purpose, size, content_type):
    sessions, storage, service = transfers
    storage.generate_put_upload_url = Mock(side_effect=AssertionError("Issued upload capability"))
    with pytest.raises(ValueError, match="file limit"):
        admit(transfers, size, purpose=purpose, content_type=content_type)


def test_same_upload_command_concurrently_creates_one_session_and_hold(transfers):
    sessions, storage, service = transfers
    uploads = UploadService(
        uploads=service,
        quota=resources.storage_quota_service,
        usage=resources.storage_usage_service,
    )
    barrier = Barrier(2)

    def create():
        with sessions() as db:
            barrier.wait(10)
            return uploads.create_request(
                db,
                1,
                UploadCreateRequest(
                    client_request_id="same",
                    filename="page.png",
                    byte_size=20,
                    content_type="image/png",
                ),
            ).upload_session.session_id

    with ThreadPoolExecutor(2) as pool:
        ids = list(pool.map(lambda _: create(), range(2)))
    assert ids[0] == ids[1]
    with sessions() as db:
        assert db.scalar(select(func.count()).select_from(UploadSession)) == 1
        assert db.scalar(select(func.count()).select_from(UploadCreationRequest)) == 1
        assert db.scalar(select(func.count()).select_from(StorageQuotaHold)) == 1


@pytest.mark.parametrize("cleanup_first", [False, True])
def test_consumption_and_terminal_cleanup_serialize_on_same_session(transfers, cleanup_first):
    from threading import Event
    from time import monotonic
    from sqlalchemy import text
    from app.modules.media_storage.upload_sessions.service import lock_session

    sessions, storage, service = transfers
    transfer = admit(transfers, 21 * 1024**2)
    for number in (1, 2):
        target = service.part_url(transfer.session_id, 1, number)
        receive(storage, target, b"x" * int(target.headers["content-length"]))
    service.complete(transfer.session_id, 1)
    entered, release = Event(), Event()
    pids = {}

    def first():
        with sessions() as db:
            pids["first"] = db.scalar(text("SELECT pg_backend_pid()"))
            row = lock_session(db, transfer.session_id, 1)
            if cleanup_first:
                row.status = Status.CANCELLED
            else:
                service.consume(
                    db, uuid=transfer.session_id, user_id=1, purpose=Purpose.PERFORMANCE_TAKE
                )
            db.flush()
            entered.set()
            assert release.wait(10)
            db.commit()

    def second():
        with sessions() as db:
            pids["second"] = db.scalar(text("SELECT pg_backend_pid()"))
            if cleanup_first:
                with pytest.raises(ValueError):
                    service.consume(
                        db, uuid=transfer.session_id, user_id=1, purpose=Purpose.PERFORMANCE_TAKE
                    )
                db.rollback()
            else:
                service.cancel(db, db.scalar(select(UploadSession.id)))
                db.commit()

    with ThreadPoolExecutor(2) as pool:
        winner = pool.submit(first)
        try:
            assert entered.wait(10)
            loser = pool.submit(second)
            deadline = monotonic() + 5
            with sessions() as observer:
                while True:
                    pid = pids.get("second")
                    blockers = (
                        observer.scalar(text("SELECT pg_blocking_pids(:pid)"), {"pid": pid})
                        if pid
                        else []
                    )
                    if pids["first"] in blockers:
                        break
                    assert monotonic() < deadline
        finally:
            release.set()
        winner.result(10)
        loser.result(10)
    if cleanup_first:
        with sessions() as db:
            row = db.scalar(select(UploadSession))
            row.capability_expires_at = utc_now() - timedelta(seconds=1)
            db.commit()
        assert UploadSessionMaintenance(service).clean(transfer.session_id)
        with sessions() as db:
            assert db.scalar(select(StoredObject)) is None
    else:
        assert UploadSessionMaintenance(service).clean(transfer.session_id)
        with sessions() as db:
            obj = db.scalar(select(StoredObject))
            assert obj is not None and storage.exists(obj.object_key)


def test_account_closure_preserves_unsettled_transfer_and_restricts_user_deletion(transfers):
    from sqlalchemy.exc import IntegrityError
    from app.modules.media_storage.upload_sessions.account_cleanup import close_account_transfers

    sessions, storage, service = transfers
    transfer = admit(transfers, 4)
    with sessions() as db:
        user = db.get(User, 1)
        user.is_active = False
        user.deleted_at = utc_now()
        db.commit()
        assert close_account_transfers(db, 1) == "progress"
        db.commit()
        assert close_account_transfers(db, 1) == "busy"
        db.rollback()
    with sessions() as db:
        # Remove unrelated accounting FKs so the session RESTRICT is independently observed.
        from sqlalchemy import delete

        db.execute(delete(UserStorageEntitlement).where(UserStorageEntitlement.user_id == 1))
        db.execute(delete(StorageUsageAccount).where(StorageUsageAccount.user_id == 1))
        db.delete(db.get(User, 1))
        with pytest.raises(IntegrityError):
            db.commit()
        db.rollback()
    with sessions() as db:
        row = db.scalar(select(UploadSession))
        assert row.cleanup_completed_at is None
    with pytest.raises(ValueError, match="inactive"):
        service.read(transfer.session_id, 1)


def test_http_capability_signing_releases_authentication_connection(transfers, monkeypatch):
    from fastapi.testclient import TestClient
    from app.runtime.customer_api.main import app
    from app.platform.db.dependencies import get_db
    from app.runtime.customer_api.deps import get_current_user
    from app.runtime.customer_api.resources import get_upload_session_service

    sessions, storage, service = transfers
    transfer = admit(transfers, 4)
    engine = sessions.kw["bind"]
    sign = storage.generate_put_upload_url

    def signed(*args, **kwargs):
        assert engine.pool.checkedout() == 0
        return sign(*args, **kwargs)

    monkeypatch.setattr(storage, "generate_put_upload_url", signed)
    with sessions() as db:

        def principal():
            return db.get(User, 1)

        app.dependency_overrides.update(
            {
                get_db: lambda: db,
                get_current_user: principal,
                get_upload_session_service: lambda: service,
            }
        )
        try:
            with TestClient(app) as client:
                result = client.get(f"/api/v1/upload-sessions/{transfer.session_id}")
                assert result.status_code == 200, result.text
        finally:
            app.dependency_overrides.clear()


def test_interrupted_complete_keeps_unknown_physical_responsibility(transfers, monkeypatch):
    import asyncio

    sessions, storage, service = transfers
    transfer = admit(transfers, 21 * 1024**2)
    for number in (1, 2):
        target = service.part_url(transfer.session_id, 1, number)
        receive(storage, target, b"x" * int(target.headers["content-length"]))

    def interrupted(*args, **kwargs):
        raise asyncio.CancelledError()

    monkeypatch.setattr(storage, "complete_multipart_upload", interrupted)
    with pytest.raises(asyncio.CancelledError):
        service.complete(transfer.session_id, 1)
    with sessions() as db:
        row = db.scalar(select(UploadSession))
        assert row.operation_unknown and row.status == Status.COMPLETING
        service.cancel(db, row.id)
        db.commit()
    assert not UploadSessionMaintenance(service).clean(transfer.session_id)


def test_shorter_capability_ttl_does_not_shorten_cleanup_horizon(transfers):
    sessions, storage, service = transfers
    transfer = admit(transfers, 4)
    with sessions() as db:
        original = db.scalar(select(UploadSession.capability_expires_at))
    service.policy = replace(service.policy, url_ttl_seconds=1)
    refreshed = service.read(transfer.session_id, 1)
    assert refreshed.upload_target.expires_in == 1
    with sessions() as db:
        assert db.scalar(select(UploadSession.capability_expires_at)) == original
