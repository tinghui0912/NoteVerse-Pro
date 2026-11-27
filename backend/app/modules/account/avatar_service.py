"""Avatar service under the account module boundary."""

from app.modules.media_storage.delivery import MediaDeliveryService

from app.modules.media_storage.write_coordinator import ObjectWriteCoordinator

import hashlib
import io
import warnings
from typing import BinaryIO
from uuid import uuid4
from sqlalchemy import select

from PIL import Image, UnidentifiedImageError
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.model_utils import require_persisted_id
from app.core.exceptions import ResourceNotFoundException
from app.db.models import User

from app.modules.media_storage.adoption import adopt_written_object
from app.modules.account.avatar_presentation import avatar_url_for_user
from app.modules.media_storage.retirement import retire_after_release


def avatar_object_key(filename: str) -> str:
    if not filename or filename in {".", ".."} or "/" in filename or "\\" in filename:
        raise ValueError("Avatar filename must be a nonempty namespace segment")
    return f"avatars/{filename}"


class AvatarFileTooLargeError(ValueError):
    """The avatar exceeds the bounded input budget."""


class AvatarService:
    """Avatar image processing for account profile pictures."""

    ALLOWED_EXTENSIONS = {"png", "jpg", "jpeg", "gif", "webp"}
    AVATAR_SIZE = (200, 200)

    def __init__(self, *, writes: ObjectWriteCoordinator, delivery: MediaDeliveryService) -> None:
        self.delivery = delivery
        self.writes = writes
        self.storage = writes.storage

    def read_upload(self, stream: BinaryIO) -> bytes:
        limit = settings.AVATAR_MAX_UPLOAD_BYTES
        content = bytearray()
        while chunk := stream.read(min(64 * 1024, limit - len(content) + 1)):
            content.extend(chunk)
            if len(content) > limit:
                raise AvatarFileTooLargeError("Avatar exceeds the upload limit")
        return bytes(content)

    def is_allowed_extension(self, filename: str) -> bool:
        if "." not in filename:
            return False
        ext = filename.rsplit(".", 1)[1].lower()
        return ext in self.ALLOWED_EXTENSIONS

    def validate_file_size(self, file_bytes: bytes) -> bool:
        return len(file_bytes) <= settings.AVATAR_MAX_UPLOAD_BYTES

    def process_avatar(
        self,
        file_bytes: bytes,
        filename: str,
        user_id: int,
    ) -> tuple[str, bytes]:
        if not self.is_allowed_extension(filename):
            raise ValueError("Unsupported file format")
        if not self.validate_file_size(file_bytes):
            raise AvatarFileTooLargeError("Avatar exceeds the upload limit")

        try:
            with warnings.catch_warnings():
                warnings.simplefilter("error", Image.DecompressionBombWarning)
                with Image.open(io.BytesIO(file_bytes)) as source:
                    if source.format not in {"PNG", "JPEG", "GIF", "WEBP"}:
                        raise ValueError("Unsupported image format")
                    width, height = source.size
                    if (
                        width * height > settings.AVATAR_MAX_PIXELS
                        or max(width, height) > settings.AVATAR_MAX_DIMENSION
                    ):
                        raise ValueError("Avatar dimensions exceed the decoding budget")
                    source.load()
                    img = source.copy()
            if img.mode not in ("RGB", "RGBA"):
                img = img.convert("RGB")

            img.thumbnail(self.AVATAR_SIZE, Image.Resampling.LANCZOS)
            canvas = Image.new("RGB", self.AVATAR_SIZE, (255, 255, 255))
            offset = (
                (self.AVATAR_SIZE[0] - img.size[0]) // 2,
                (self.AVATAR_SIZE[1] - img.size[1]) // 2,
            )
            canvas.paste(img, offset, img.getchannel("A") if img.mode == "RGBA" else None)

            output = io.BytesIO()
            canvas.save(output, "JPEG", quality=85, optimize=True)
            content = output.getvalue()
            final_filename = f"{user_id}_{hashlib.sha256(content).hexdigest()}_{uuid4().hex}.jpg"
            return avatar_object_key(final_filename), content
        except (
            UnidentifiedImageError,
            OSError,
            Image.DecompressionBombError,
            Image.DecompressionBombWarning,
        ) as exc:
            raise ValueError("Invalid avatar image") from exc

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
        db.commit()
        db.close()
        written = self.writes.write_bytes(key=key, content=content, content_type="image/jpeg")
        db.add(user)
        user = (
            db.execute(
                select(User)
                .where(User.id == user_id, User.is_active.is_(True), User.deleted_at.is_(None))
                .with_for_update()
                .execution_options(populate_existing=True)
            )
        ).scalar_one_or_none()
        if user is None:
            raise ResourceNotFoundException("user", str(user_id))
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
        user = db.scalar(
            select(User)
            .where(User.id == user.id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        if user is None:
            return False
        previous = user.avatar_object
        if previous is None:
            return False
        user.avatar_object = None
        user.avatar_object_id = None
        retire_after_release(db, previous.id)
        return True
