"""Stable public-profile avatar delivery projection from the current object reference."""

from app.core.settings.service_identity import CUSTOMER_API_PREFIX
from app.db.models import User


def avatar_url_for_user(user: User) -> str | None:
    current = user.avatar_object
    if current is None:
        return None
    filename = current.object_key.rsplit("/", 1)[-1]
    return f"{CUSTOMER_API_PREFIX}/account/avatars/{filename}"
