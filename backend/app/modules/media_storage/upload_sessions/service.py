"""Short database phases surround provider IO; consumption transfers physical authority."""

from dataclasses import dataclass
from datetime import datetime, timedelta
from hashlib import sha256
from math import ceil
from uuid import uuid4
from sqlalchemy import select, func
from sqlalchemy.orm import Session
from app.db.models.upload_session import UploadSession
from app.db.models.user import User
from app.db.models.stored_object import StoredObject
from app.modules.media_storage.facts import StoredObjectFacts
from app.modules.media_storage.persistence import object_to_row
from app.modules.media_storage.adoption import adopt_written_object, receipt_for_intent
from app.modules.media_storage.write_coordinator import ObjectWriteCoordinator, SessionFactory
from app.storage import ObjectStorage, ObjectMetadata
from app.storage.base import ObjectStorageUnavailableError
from app.shared.time import utc_now
from .domain import (
    UploadMode as Mode,
    UploadStatus as Status,
    UploadPurpose as Purpose,
    UploadPolicy,
    ACTIVE_STATUSES,
    part_length,
)
from .schemas import UploadSessionRead, UploadTargetRead, UploadPartRead


@dataclass(frozen=True)
class UploadSnapshot:
    id: int
    generation: int
    uuid: str
    user_id: int
    purpose: Purpose
    mode: Mode
    status: Status
    key: str
    final_key: str
    size: int
    content_type: str
    part_bytes: int
    handle: str | None
    expires_at: datetime
    token: str | None
    operation_kind: str | None
    unknown: bool
    digest: str | None
    etag: str | None


def snapshot(row: UploadSession) -> UploadSnapshot:
    assert row.id is not None
    return UploadSnapshot(
        row.id,
        row.generation,
        row.session_uuid,
        row.user_id,
        row.purpose,
        row.mode,
        row.status,
        row.object_key,
        row.final_object_key,
        row.expected_byte_size,
        row.expected_content_type,
        row.part_bytes,
        row.provider_upload_id,
        row.expires_at,
        row.operation_token,
        row.operation_kind,
        row.operation_unknown,
        row.sha256,
        row.provider_etag,
    )


def lock_session(db: Session, uuid: str, user_id: int | None = None) -> UploadSession:
    query = select(UploadSession).where(UploadSession.session_uuid == uuid)
    if user_id is not None:
        query = query.where(UploadSession.user_id == user_id)
    row = db.scalar(query.with_for_update().execution_options(populate_existing=True))
    if row is None:
        raise ValueError("Upload session is unavailable")
    return row


def lock_upload_user(db: Session, user_id: int) -> None:
    user = db.scalar(
        select(User)
        .where(User.id == user_id, User.is_active.is_(True), User.deleted_at.is_(None))
        .with_for_update()
    )
    if user is None:
        raise ValueError("Upload owner is inactive")


class UploadSessionService:
    def __init__(
        self,
        storage: ObjectStorage,
        sessions: SessionFactory,
        writes: ObjectWriteCoordinator,
        policy: UploadPolicy,
    ) -> None:
        self.storage, self.sessions, self.writes, self.policy = storage, sessions, writes, policy

    def admit(
        self,
        db: Session,
        *,
        user_id: int,
        purpose: Purpose,
        byte_size: int,
        content_type: str,
        final_key: str,
    ) -> UploadSession:
        lock_upload_user(db, user_id)
        mode = self.policy.mode_for(purpose, byte_size, content_type)
        count = (
            db.scalar(
                select(func.count()).where(
                    UploadSession.user_id == user_id, UploadSession.status.in_(ACTIVE_STATUSES)
                )
            )
            or 0
        )
        temporary = (
            db.scalar(
                select(func.coalesce(func.sum(UploadSession.expected_byte_size), 0)).where(
                    UploadSession.user_id == user_id,
                    UploadSession.cleanup_completed_at.is_(None),
                    ~(
                        (UploadSession.mode == Mode.MULTIPART)
                        & (UploadSession.status == Status.CONSUMED)
                    ),
                )
            )
            or 0
        )
        if (
            count >= self.policy.max_active_sessions
            or temporary + byte_size > self.policy.temporary_byte_budget
        ):
            raise ValueError("Upload transport capacity is exhausted")
        uuid = str(uuid4())
        key = f"transfers/{uuid}/input" if mode == Mode.SINGLE_PUT else final_key
        StoredObjectFacts(key, byte_size, None, content_type)
        row = UploadSession(
            session_uuid=uuid,
            user_id=user_id,
            purpose=purpose,
            mode=mode,
            object_key=key,
            final_object_key=final_key,
            expected_byte_size=byte_size,
            expected_content_type=content_type,
            part_bytes=self.policy.part_bytes,
            expires_at=utc_now() + timedelta(seconds=self.policy.session_ttl_seconds),
        )
        db.add(row)
        db.flush()
        return row

    def start(self, uuid: str, user_id: int) -> UploadSessionRead:
        with self.sessions() as db:
            lock_upload_user(db, user_id)
            row = lock_session(db, uuid, user_id)
            if row.status == Status.CREATING and row.operation_token is None:
                if row.mode == Mode.SINGLE_PUT:
                    row.status = Status.UPLOADING
                else:
                    row.operation_token, row.operation_kind, row.operation_unknown = (
                        str(uuid4()),
                        "CREATE",
                        True,
                    )
                    work = snapshot(row)
                    db.commit()
                    # The preparation session is closed before provider execution below.
                    initialize = True
            else:
                initialize = False
            if row.mode == Mode.SINGLE_PUT:
                initialize = False
            db.commit()
        if initialize:
            try:
                handle = self.storage.create_multipart_upload(
                    work.key, content_type=work.content_type
                )
            except BaseException:
                self._failure(work, "upload_initiate_unsettled", uncertain=True)
                raise
            with self.sessions() as db:
                row = lock_session(db, uuid)
                if row.operation_token != work.token or row.generation != work.generation:
                    raise ValueError("Upload initiation generation changed")
                row.provider_upload_id, row.operation_unknown = handle, False
                if row.status == Status.CREATING:
                    row.status = Status.UPLOADING
                db.commit()
        return self.read(uuid, user_id)

    def read(self, uuid: str, user_id: int) -> UploadSessionRead:
        with self.sessions() as db:
            lock_upload_user(db, user_id)
            row = lock_session(db, uuid, user_id)
            if row.expires_at <= utc_now() and row.status in ACTIVE_STATUSES:
                row.status = Status.EXPIRED
            target = row.mode == Mode.SINGLE_PUT and row.status == Status.UPLOADING
            ttl = self._ttl(row) if target else 0
            work = snapshot(row)
            db.commit()
        capability = (
            self.storage.generate_put_upload_url(
                work.key, content_type=work.content_type, content_length=work.size, expires_in=ttl
            )
            if target
            else None
        )
        return UploadSessionRead(
            session_id=work.uuid,
            mode=work.mode,
            status=work.status,
            expected_byte_size=work.size,
            expected_content_type=work.content_type,
            expires_at=work.expires_at,
            part_size=work.part_bytes,
            part_count=ceil(work.size / work.part_bytes) if work.mode == Mode.MULTIPART else 1,
            recommended_concurrency=self.policy.concurrency,
            upload_target=UploadTargetRead(
                url=capability.upload_url,
                method=capability.upload_method,
                headers=capability.upload_headers,
                expires_in=ttl,
            )
            if capability
            else None,
        )

    def _ttl(self, row: UploadSession) -> int:
        ttl = min(self.policy.url_ttl_seconds, int((row.expires_at - utc_now()).total_seconds()))
        if ttl <= 0:
            raise ValueError("Upload session has expired")
        expires_at = utc_now() + timedelta(seconds=ttl)
        if row.capability_expires_at is None or row.capability_expires_at < expires_at:
            row.capability_expires_at = expires_at
        return ttl

    def part_url(self, uuid: str, user_id: int, number: int) -> UploadTargetRead:
        with self.sessions() as db:
            lock_upload_user(db, user_id)
            row = lock_session(db, uuid, user_id)
            if (
                row.mode != Mode.MULTIPART
                or row.status != Status.UPLOADING
                or not row.provider_upload_id
            ):
                raise ValueError("Multipart upload is not available")
            length = part_length(row.expected_byte_size, row.part_bytes, number)
            ttl = self._ttl(row)
            work = snapshot(row)
            db.commit()
        assert work.handle is not None
        value = self.storage.generate_part_upload_url(
            work.key, work.handle, number, content_length=length, expires_in=ttl
        )
        return UploadTargetRead(
            url=value.upload_url,
            method=value.upload_method,
            headers=value.upload_headers,
            expires_in=ttl,
        )

    def parts(self, uuid: str, user_id: int) -> list[UploadPartRead]:
        with self.sessions() as db:
            lock_upload_user(db, user_id)
            work = snapshot(lock_session(db, uuid, user_id))
            db.commit()
        if work.mode != Mode.MULTIPART or not work.handle or work.status != Status.UPLOADING:
            raise ValueError("Multipart upload is not available")
        return [
            UploadPartRead(part_number=p.part_number, etag=p.etag, byte_size=p.size_bytes)
            for p in self.storage.list_uploaded_parts(work.key, work.handle)
        ]

    def complete(self, uuid: str, user_id: int) -> UploadSessionRead:
        with self.sessions() as db:
            lock_upload_user(db, user_id)
            row = lock_session(db, uuid, user_id)
            if row.status in (Status.COMPLETED, Status.CONSUMED):
                db.commit()
                work = snapshot(row)
                already = True
            else:
                if row.status != Status.UPLOADING or row.expires_at <= utc_now():
                    raise ValueError("Upload cannot complete in its current state")
                row.status, row.operation_kind, row.operation_token, row.operation_unknown = (
                    Status.COMPLETING,
                    "COMPLETE",
                    str(uuid4()),
                    True,
                )
                work = snapshot(row)
                db.commit()
                already = False
        if already:
            return self.read(uuid, user_id)
        issued = False
        try:
            if work.mode == Mode.MULTIPART:
                if not work.handle:
                    raise ValueError("Multipart handle is missing")
                parts = self.storage.list_uploaded_parts(work.key, work.handle)
                if len(parts) != ceil(work.size / work.part_bytes) or any(
                    p.part_number != i or p.size_bytes != part_length(work.size, work.part_bytes, i)
                    for i, p in enumerate(parts, 1)
                ):
                    raise ValueError("Multipart parts do not match the exact upload plan")
                issued = True
                self.storage.complete_multipart_upload(work.key, work.handle, parts)
            metadata = self._metadata(work)
            digest = (
                sha256(self._bounded_bytes(work)).hexdigest()
                if work.mode == Mode.SINGLE_PUT
                else None
            )
        except BaseException as error:
            self._failure(
                work,
                "upload_completion_unsettled" if issued else "upload_verification_failed",
                uncertain=issued
                and (
                    isinstance(error, (ObjectStorageUnavailableError, OSError))
                    or not isinstance(error, Exception)
                ),
            )
            raise
        self._complete_facts(work, metadata, digest)
        return self.read(uuid, user_id)

    def _metadata(self, work: UploadSnapshot) -> ObjectMetadata:
        value = self.storage.object_metadata(work.key)
        if (
            value.size_bytes != work.size
            or value.content_type != work.content_type
            or not value.etag
        ):
            raise ValueError("Object metadata does not match the admitted upload")
        return value

    def _bounded_bytes(self, work: UploadSnapshot) -> bytes:
        if work.size > self.policy.single_put_max_bytes:
            raise ValueError("Full upload reads are limited to single PUT inputs")
        data = bytearray()
        for chunk in self.storage.iter_bytes(work.key, chunk_size=64 * 1024):
            if len(data) + len(chunk) > work.size:
                raise ValueError("Uploaded bytes exceed the declared length")
            data.extend(chunk)
        if len(data) != work.size:
            raise ValueError("Uploaded bytes are incomplete")
        return bytes(data)

    def verified_bytes(self, uuid: str, user_id: int, purpose: Purpose) -> bytes:
        with self.sessions() as db:
            work = snapshot(lock_session(db, uuid, user_id))
            db.commit()
        if (
            work.status != Status.COMPLETED
            or work.purpose != purpose
            or work.mode != Mode.SINGLE_PUT
        ):
            raise ValueError("Completed single PUT input is required")
        data = self._bounded_bytes(work)
        if sha256(data).hexdigest() != work.digest:
            raise ValueError("Completed upload bytes changed")
        return data

    def prepare_adoption(self, uuid: str, user_id: int, purpose: Purpose) -> None:
        with self.sessions() as db:
            lock_upload_user(db, user_id)
            work = snapshot(lock_session(db, uuid, user_id))
            db.commit()
        if work.status != Status.COMPLETED or work.purpose != purpose:
            raise ValueError("Completed matching upload is required")
        if work.mode == Mode.MULTIPART:
            return
        if work.digest is None:
            raise ValueError("Single PUT verification digest is missing")
        receipt = self.writes.copy_object(
            work.key,
            key=work.final_key,
            byte_size=work.size,
            sha256=work.digest,
            content_type=work.content_type,
        )
        with self.sessions() as db:
            row = lock_session(db, uuid, user_id)
            if row.status != Status.COMPLETED:
                raise ValueError("Upload no longer permits adoption")
            row.write_intent_uuid = receipt.intent_uuid
            db.commit()

    def consume(self, db: Session, *, uuid: str, user_id: int, purpose: Purpose) -> StoredObject:
        row = lock_session(db, uuid, user_id)
        if row.purpose != purpose or row.status != Status.COMPLETED or row.expires_at <= utc_now():
            raise ValueError("Upload generation is not available for consumption")
        if row.mode == Mode.SINGLE_PUT:
            if row.write_intent_uuid is None:
                raise ValueError("Upload copy is not durably prepared")
            receipt = receipt_for_intent(db, row.write_intent_uuid)
            if (
                receipt.object_key != row.final_object_key
                or receipt.facts.sha256 != row.sha256
                or receipt.facts.byte_size != row.expected_byte_size
            ):
                raise ValueError("Upload copy does not match session facts")
            obj = adopt_written_object(db, receipt)
        else:
            obj = object_to_row(
                StoredObjectFacts(
                    row.object_key,
                    row.expected_byte_size,
                    None,
                    row.expected_content_type,
                    row.provider_etag,
                    row.transport_checksum_algorithm,
                    row.transport_checksum,
                )
            )
            db.add(obj)
            db.flush()
        row.status, row.consumed_at, row.updated_at = Status.CONSUMED, utc_now(), utc_now()
        return obj

    @staticmethod
    def cancel(db: Session, session_id: int) -> None:
        row = db.scalar(
            select(UploadSession).where(UploadSession.id == session_id).with_for_update()
        )
        if row is not None and row.status in ACTIVE_STATUSES:
            row.status, row.updated_at = Status.CANCELLED, utc_now()

    def _failure(self, work: UploadSnapshot, code: str, *, uncertain: bool) -> None:
        with self.sessions() as db:
            row = lock_session(db, work.uuid)
            if row.operation_token == work.token and row.generation == work.generation:
                row.operation_unknown, row.failure_code = uncertain, code
                if not uncertain and row.status in ACTIVE_STATUSES:
                    row.status = Status.FAILED
                db.commit()

    def _complete_facts(
        self, work: UploadSnapshot, metadata: ObjectMetadata, digest: str | None
    ) -> None:
        with self.sessions() as db:
            row = lock_session(db, work.uuid)
            if row.operation_token != work.token or row.generation != work.generation:
                raise ValueError("Upload completion attempt changed")
            row.provider_etag, row.sha256, row.operation_unknown = metadata.etag, digest, False
            row.transport_checksum_algorithm = (
                metadata.checksum_algorithm + "_COMPOSITE"
                if metadata.checksum_algorithm and metadata.checksum_type == "COMPOSITE"
                else metadata.checksum_algorithm
            )
            row.transport_checksum = metadata.checksum
            if row.status == Status.COMPLETING:
                row.status, row.completed_at = Status.COMPLETED, utc_now()
            db.commit()

    def recover(self, uuid: str) -> bool:
        with self.sessions() as db:
            work = snapshot(lock_session(db, uuid))
            db.commit()
        if not work.unknown:
            return True
        if work.operation_kind == "CREATE":
            handles = self.storage.list_multipart_uploads(work.key)
            if len(handles) != 1:
                return False
            with self.sessions() as db:
                row = lock_session(db, uuid)
                if row.operation_token != work.token or row.generation != work.generation:
                    return False
                row.provider_upload_id, row.operation_unknown = handles[0], False
                if row.status == Status.CREATING:
                    row.status = Status.UPLOADING
                db.commit()
            return True
        if work.operation_kind == "COMPLETE" and self.storage.exists(work.key):
            metadata = self._metadata(work)
            digest = (
                sha256(self._bounded_bytes(work)).hexdigest()
                if work.mode == Mode.SINGLE_PUT
                else None
            )
            self._complete_facts(work, metadata, digest)
            return True
        return False
