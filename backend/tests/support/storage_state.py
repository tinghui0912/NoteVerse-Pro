"""Explicit storage provisioning for product-workflow test fixtures."""

from app.composition.storage_resources import provision_storage_resources

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import StoragePlanPolicy, User
from app.modules.storage_governance.quota.states import StoragePlanCode
from app.db.model_utils import require_persisted_id


def provision_storage_users(db: Session, *, default_limit_bytes: int = 104857600) -> None:
    """Provision the fixture's existing users; the fixture owns the transaction."""
    for code, factor in [
        (StoragePlanCode.FREE, 1),
        (StoragePlanCode.PLUS, 10),
        (StoragePlanCode.PRO, 100),
    ]:
        if db.get(StoragePlanPolicy, code) is None:
            db.add(
                StoragePlanPolicy(plan_code=code, default_limit_bytes=default_limit_bytes * factor)
            )
    db.flush()
    for user in db.scalars(select(User)):
        provision_storage_resources(db, require_persisted_id(user.id, entity="user"))
