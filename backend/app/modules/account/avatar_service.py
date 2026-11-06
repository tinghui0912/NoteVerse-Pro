"""Avatar service under the account module boundary."""

import hashlib
import io
from uuid import uuid4
from sqlalchemy import select

from PIL import Image
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logger import logger
from app.db.model_utils import require_persisted_id
from app.db.models import User, StoredObject
from app.modules.storage_objects.persistence import object_from_bytes
from app.modules.account.avatar_presentation import avatar_url_for_user
from app.storage import ObjectStorage, object_storage


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
    ) -> StoredObject:
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
            self.storage.put_bytes(
                content=content,
                key=avatar_object_key(final_filename),
                content_type="image/jpeg",
            )

            logger.bind(
                event="account.avatar.saved",
                user_id=user_id,
                filename=final_filename,
            ).info("Avatar saved")
            return object_from_bytes(
                object_key=avatar_object_key(final_filename),
                content=content,
                content_type="image/jpeg",
            )
        except Exception as exc:
            logger.bind(
                event="account.avatar.processing_failed",
                user_id=user_id,
                filename=filename,
            ).opt(exception=exc).error("Avatar processing failed")
            raise ValueError(f"Image processing failed: {str(exc)}")

    async def replace_user_avatar(
        self,
        db: AsyncSession,
        user: User,
        *,
        file_bytes: bytes,
        filename: str,
    ) -> tuple[str, str]:
        user_id = require_persisted_id(user.id, entity="user")
        user = (
            await db.execute(
                select(User)
                .where(User.id == user_id)
                .with_for_update()
                .execution_options(populate_existing=True)
            )
        ).scalar_one()
        previous = user.avatar_object
        current = self.process_avatar(file_bytes=file_bytes, filename=filename, user_id=user_id)
        try:
            user.avatar_object = current
            db.add(user)
            await db.commit()
            await db.refresh(user)
        except Exception:
            await db.rollback()
            self.delete_avatar(current.object_key.rsplit("/", 1)[-1])
            raise
        await self._discard_avatar(db, previous)
        return current.object_key.rsplit("/", 1)[-1], avatar_url_for_user(user) or ""

    async def _discard_avatar(self, db: AsyncSession, previous: StoredObject | None) -> None:
        if previous is None:
            return
        key = previous.object_key
        # Avatar references are explicit. A still-current avatar is never deleted.
        owner = await db.scalar(
            select(User.id).where(User.avatar_object_id == previous.id).limit(1)
        )
        if owner is not None:
            return
        await db.delete(previous)
        await db.commit()
        self.delete_avatar(key.rsplit("/", 1)[-1])

    async def clear_user_avatar(self, db: AsyncSession, user: User) -> bool:
        previous = user.avatar_object
        if previous is None:
            return False
        user.avatar_object = None
        user.avatar_object_id = None
        await db.commit()
        await self._discard_avatar(db, previous)
        return True

    async def clear_missing_avatar_reference(self, db: AsyncSession, user: User) -> bool:
        current = user.avatar_object
        if current is None or self.avatar_exists(current.object_key.rsplit("/", 1)[-1]):
            return False
        await self.clear_user_avatar(db, user)
        return True

    def delete_avatar(self, filename: str) -> bool:
        try:
            deleted = self.storage.delete(avatar_object_key(filename))
            if deleted:
                logger.bind(
                    event="account.avatar.deleted",
                    filename=filename,
                ).info("Avatar deleted")
            return deleted
        except Exception as exc:
            logger.bind(
                event="account.avatar.deletion_failed",
                filename=filename,
            ).opt(exception=exc).error("Avatar deletion failed")
            return False

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
