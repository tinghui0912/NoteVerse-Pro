"""Explicit storage provisioning for product-workflow test fixtures."""

from app.composition.storage_resources import provision_storage_resources

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import StoragePlanPolicy, User
from app.db.model_utils import require_persisted_id
from app.modules.storage_quota.entitlements import (
    DEFAULT_STORAGE_PLAN_CODE,
)


def provision_storage_users(db: Session, *, default_limit_bytes: int = 104857600) -> None:
    """Provision the fixture's existing users; the fixture owns the transaction."""
    if db.get(StoragePlanPolicy, DEFAULT_STORAGE_PLAN_CODE) is None:
        db.add(
            StoragePlanPolicy(
                plan_code=DEFAULT_STORAGE_PLAN_CODE, default_limit_bytes=default_limit_bytes
            )
        )
        db.flush()
    for user in db.scalars(select(User)):
        provision_storage_resources(db, require_persisted_id(user.id, entity="user"))
