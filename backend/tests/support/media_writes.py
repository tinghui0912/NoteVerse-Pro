"""Explicit physical-transaction steps for write crash-window injection tests."""

from sqlalchemy.orm import Session
from app.modules.media_storage.write_contracts import ObjectWriteReceipt
from app.modules.media_storage.write_intents import inspect_write, finalize_write
from app.storage import ObjectStorage


def persist_prepared_bytes(
    db: Session, storage: ObjectStorage, receipt: ObjectWriteReceipt, content: bytes
) -> None:
    row, needs_put = inspect_write(db, receipt, content)
    result = (
        storage.put_bytes(
            key=receipt.object_key, content=content, content_type=receipt.facts.content_type
        )
        if needs_put
        else None
    )
    finalize_write(row, receipt, result)
    db.commit()
