"""Identity metadata admitted to resource workflows without credential material."""

from sqlalchemy import select
from sqlalchemy.orm import load_only
from app.db.models.user import User


def resource_user_query():
    return select(User).options(
        load_only(
            User.id,
            User.email,
            User.display_name,
            User.is_active,
            User.deleted_at,
            User.avatar_object_id,
            User.created_at,
            User.updated_at,
            raiseload=True,
        )
    )
