"""User lifecycle fence for final semantic resource admission after external IO."""

from app.modules.account.resource_users import resource_user_query

from sqlalchemy.orm import Session
from app.db.models.user import User
from app.core.exceptions import ResourceNotFoundException


def lock_active_resource_user(db: Session, user_id: int) -> User:
    """KEY SHARE protects final erasure; the deletion request uses NO KEY UPDATE.

    Already-admitted transactions may finish before graph cleanup observes them.
    Post-tombstone admission is rejected. Never hold this lock through prewrite IO.
    """
    user = db.scalar(
        resource_user_query()
        .where(User.id == user_id, User.is_active.is_(True), User.deleted_at.is_(None))
        .with_for_update(read=True, key_share=True)
        .execution_options(populate_existing=True)
    )
    if user is None:
        raise ResourceNotFoundException("user", str(user_id))
    return user
