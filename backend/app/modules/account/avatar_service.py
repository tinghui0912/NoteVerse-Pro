"""Avatar service under the account module boundary."""

import hashlib
import io
from uuid import uuid4
from sqlalchemy import select

from PIL import Image
from sqlalchemy.orm import Session

from app.core.logger import logger
from app.db.model_utils import require_persisted_id
from app.db.models import User
from app.modules.storage_objects.writes import write_object, adopt_written_object
from app.modules.account.avatar_presentation import avatar_url_for_user
from app.modules.storage_objects.retirement import retire_after_release
from app.storage import object_storage, ObjectStorage


def avatar_object_key(filename: str) -> str:
    return f"avatars/{filename}"


class AvatarService:
    """Avatar image processing for account profile pictures."""

    ALLOWED_EXTENSIONS = {"png", "jpg", "jpeg", "gif", "webp"}
    MAX_FILE_SIZE = 5 * 1024 * 1024
    AVATAR_SIZE = (200, 200)

    def __init__(self, storage: ObjectStorage | None = None) -> None:
        self.storage = storage or object_storage

    def is_allowed_extension(self, filename: str) -> bool:
        if "." not in filename:
            return False
        ext = filename.rsplit(".", 1)[1].lower()
        return ext in self.ALLOWED_EXTENSIONS

    def validate_file_size(self, file_bytes: bytes) -> bool:
        return len(file_bytes) <= self.MAX_FILE_SIZE

    def process_avatar(
        self,
        file_bytes: bytes,
        filename: str,
        user_id: int,
    ) -> tuple[str, bytes]:
        if not self.is_allowed_extension(filename):
            raise ValueError("Unsupported file format")
        if not self.validate_file_size(file_bytes):
            raise ValueError("File size exceeds the 5MB limit")

        try:
            img = Image.open(io.BytesIO(file_bytes))
            if img.mode not in ("RGB", "RGBA"):
                img = img.convert("RGB")

            img.thumbnail(self.AVATAR_SIZE, Image.Resampling.LANCZOS)
            canvas = Image.new("RGB", self.AVATAR_SIZE, (255, 255, 255))
            offset = (
                (self.AVATAR_SIZE[0] - img.size[0]) // 2,
                (self.AVATAR_SIZE[1] - img.size[1]) // 2,
            )
            canvas.paste(img, offset)

            output = io.BytesIO()
            canvas.save(output, "JPEG", quality=85, optimize=True)
            content = output.getvalue()
            final_filename = f"{user_id}_{hashlib.sha256(content).hexdigest()}_{uuid4().hex}.jpg"
            return avatar_object_key(final_filename), content
        except Exception as exc:
            logger.bind(
                event="account.avatar.processing_failed",
                user_id=user_id,
                filename=filename,
            ).opt(exception=exc).error("Avatar processing failed")
            raise ValueError(f"Image processing failed: {str(exc)}")

    def replace_user_avatar(
        self,
        db: Session,
        user: User,
        *,
        file_bytes: bytes,
        filename: str,
    ) -> tuple[str, str]:
        user_id = require_persisted_id(user.id, entity="user")
        key, content = self.process_avatar(
            file_bytes=file_bytes, filename=filename, user_id=user_id
        )
        written = write_object(
            db, self.storage, key=key, content=content, content_type="image/jpeg"
        )
        user = (
            db.execute(
                select(User)
                .where(User.id == user_id)
                .with_for_update()
                .execution_options(populate_existing=True)
            )
        ).scalar_one()
        previous = user.avatar_object
        try:
            current = adopt_written_object(db, written)
            user.avatar_object = current
            db.add(user)
            if previous is not None:
                retire_after_release(db, previous.id)
            db.commit()
            db.refresh(user)
        except Exception:
            db.rollback()
            raise
        return current.object_key.rsplit("/", 1)[-1], avatar_url_for_user(user) or ""

    def clear_user_avatar(self, db: Session, user: User) -> bool:
        previous = user.avatar_object
        if previous is None:
            return False
        user.avatar_object = None
        user.avatar_object_id = None
        retire_after_release(db, previous.id)
        db.commit()
        return True

    def clear_missing_avatar_reference(self, db: Session, user: User) -> bool:
        current = user.avatar_object
        if current is None or (self.avatar_exists(current.object_key.rsplit("/", 1)[-1])):
            return False
        self.clear_user_avatar(db, user)
        return True

    def avatar_exists(self, filename: str) -> bool:
        try:
            return self.storage.exists(avatar_object_key(filename))
        except Exception as exc:
            logger.bind(
                event="account.avatar.exists_check_failed",
                filename=filename,
            ).opt(exception=exc).warning("Avatar existence check failed")
            return True


avatar_service = AvatarService()
