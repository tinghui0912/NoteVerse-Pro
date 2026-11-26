"""Empty logical accounting aggregate provisioning."""

from sqlalchemy.orm import Session
from app.db.models.storage_usage import StorageUsageAccount


def provision_usage_account(db: Session, user_id: int) -> None:
    db.add(StorageUsageAccount(user_id=user_id, used_bytes=0))
    db.flush()
