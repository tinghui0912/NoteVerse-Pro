"""Independent durable write transactions and generation-fenced provider execution."""

from collections.abc import Callable, Sequence
from app.platform.config.object_writes import ObjectWriteSettings
from dataclasses import dataclass

from sqlalchemy.orm import Session

from app.modules.media_storage.domain import ObjectWriteIntentStatus
from app.modules.media_storage.facts import StoredObjectFacts
from app.modules.media_storage.write_contracts import ObjectWriteItem, ObjectWriteReceipt
from app.modules.media_storage.write_intents import (
    prepare_write,
    reserve_intent,
    inspect_write,
    finalize_write,
    lock_intent,
    require_generation,
)
from app.modules.media_storage.write_lifecycle import cleanup_transitions
from app.shared.time import utc_now
from app.storage import ObjectStorage, ObjectWriteResult
from app.storage.base import ObjectStorageUnavailableError

SessionFactory = Callable[[], Session]


@dataclass(frozen=True)
class _PhysicalWrite:
    item: ObjectWriteItem
    execute: Callable[[], ObjectWriteResult | None]


class ObjectWriteCoordinator:
    """Own only write sessions; semantic adoption belongs to the caller's transaction.

    Every provider call executes after the preparation session has closed. A durable
    WRITING generation excludes cleanup and replacement until its IO result settles.
    Unknown mutations remain fail-closed and retain their physical responsibility.
    """

    def __init__(
        self, storage: ObjectStorage, sessions: SessionFactory, *, config: ObjectWriteSettings
    ) -> None:
        self.config = config
        self.storage = storage
        self.sessions = sessions

    def write_bytes(
        self, *, key: str, content: bytes, content_type: str = "application/octet-stream"
    ) -> ObjectWriteReceipt:
        return self.write_batch((ObjectWriteItem(key, content, content_type),))[0]

    def write_batch(self, items: Sequence[ObjectWriteItem]) -> tuple[ObjectWriteReceipt, ...]:
        return self._execute(tuple(self._bytes_operation(item) for item in items))

    def _bytes_operation(self, item: ObjectWriteItem) -> _PhysicalWrite:
        def execute() -> ObjectWriteResult:
            return self.storage.put_bytes(
                key=item.key, content=item.content, content_type=item.content_type
            )

        return _PhysicalWrite(item, execute)

    def copy_object(
        self, source_key: str, *, key: str, byte_size: int, sha256: str, content_type: str
    ) -> ObjectWriteReceipt:
        expected = StoredObjectFacts(key, byte_size, sha256, content_type)
        content = self._copy_bytes(source_key, byte_size)
        if (
            StoredObjectFacts.from_bytes(object_key=key, content=content, content_type=content_type)
            != expected
        ):
            raise ValueError("Copy source does not match admitted facts")

        def copy_and_verify() -> ObjectWriteResult:
            self.storage.copy(source_key, key)
            observed = self._copy_bytes(key, byte_size)
            metadata = self.storage.object_metadata(key)
            if (
                StoredObjectFacts.from_bytes(
                    object_key=key, content=observed, content_type=metadata.content_type or ""
                )
                != expected
            ):
                raise ValueError("Copied object does not match admitted facts")
            return ObjectWriteResult(key, len(observed))

        return self._execute(
            (_PhysicalWrite(ObjectWriteItem(key, content, content_type), copy_and_verify),)
        )[0]

    def _copy_bytes(self, key: str, expected_size: int) -> bytes:
        metadata = self.storage.object_metadata(key)
        if metadata.size_bytes != expected_size:
            raise ValueError("Copy object size does not match admitted facts")
        content = bytearray()
        for chunk in self.storage.iter_bytes(key, chunk_size=64 * 1024):
            if len(content) + len(chunk) > expected_size:
                raise ValueError("Copy object exceeds admitted byte budget")
            content.extend(chunk)
        if len(content) != expected_size:
            raise ValueError("Copy object is incomplete")
        return bytes(content)

    def _execute(self, operations: Sequence[_PhysicalWrite]) -> tuple[ObjectWriteReceipt, ...]:
        if not operations:
            return ()
        if len({op.item.key for op in operations}) != len(operations):
            raise ValueError("Batch keys must be unique")
        ordered = sorted(operations, key=lambda op: op.item.key)
        # All facts and conflicting immutable keys are checked before the first IO.
        facts = {
            op.item.key: StoredObjectFacts.from_bytes(
                object_key=op.item.key, content=op.item.content, content_type=op.item.content_type
            )
            for op in ordered
        }
        with self.sessions() as db:
            for op in ordered:
                reserve_intent(db, facts[op.item.key], config=self.config)
            prepared = {
                op.item.key: prepare_write(db, facts[op.item.key], config=self.config)
                for op in ordered
            }
            pending = []
            for op in ordered:
                row, needs_write = inspect_write(db, prepared[op.item.key], op.item.content)
                if needs_write:
                    row.status = ObjectWriteIntentStatus.WRITING
                    pending.append(op)
            db.commit()
        receipts = tuple(prepared[op.item.key] for op in operations)
        results: dict[str, ObjectWriteResult | None] = {}
        try:
            for op in pending:
                results[op.item.key] = op.execute()
            with self.sessions() as db:
                for receipt in sorted(receipts, key=lambda value: value.object_key):
                    row = lock_intent(db, receipt.intent_uuid)
                    require_generation(row, receipt)
                    if receipt.object_key in results and row.status not in (
                        ObjectWriteIntentStatus.WRITING,
                        ObjectWriteIntentStatus.WRITE_UNKNOWN,
                    ):
                        raise ValueError("Write result has no matching unsettled generation")
                    finalize_write(row, receipt, results.get(receipt.object_key))
                db.commit()
        except BaseException as error:
            try:
                self._queue_cleanup(receipts, pending, results, error)
            except BaseException as cleanup_error:
                raise BaseExceptionGroup(
                    "Write execution and cleanup registration failed", [error, cleanup_error]
                ) from None
            raise
        return receipts

    def _queue_cleanup(
        self,
        receipts: Sequence[ObjectWriteReceipt],
        pending: Sequence[_PhysicalWrite],
        results: dict[str, ObjectWriteResult | None],
        error: BaseException,
    ) -> None:
        with self.sessions() as db:
            for receipt in sorted(receipts, key=lambda receipt: receipt.object_key):
                row = lock_intent(db, receipt.intent_uuid)
                if row.write_token != receipt.write_token:
                    continue  # The current generation owns its independent cleanup lineage.
                require_generation(row, receipt)
                uncertain_key = next(
                    (op.item.key for op in pending if op.item.key not in results), None
                )
                if (
                    row.status == ObjectWriteIntentStatus.WRITING
                    and receipt.object_key == uncertain_key
                    and (
                        isinstance(error, (ObjectStorageUnavailableError, OSError))
                        or not isinstance(error, Exception)
                    )
                ):
                    row.status = ObjectWriteIntentStatus.WRITE_UNKNOWN
                    row.updated_at = utc_now()
                    continue
                if row.status in (
                    ObjectWriteIntentStatus.PREPARED,
                    ObjectWriteIntentStatus.WRITING,
                    ObjectWriteIntentStatus.WRITTEN,
                ):
                    cleanup_transitions().reset(
                        row,
                        status=ObjectWriteIntentStatus.CLEANUP_PENDING,
                        reset_attempts=True,
                        now=utc_now(),
                    )
            db.commit()
