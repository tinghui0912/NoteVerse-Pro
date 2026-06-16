"""
Avatar service under the profile module boundary.
"""
import hashlib
import io
from typing import Tuple

from PIL import Image

from app.core.logger import logger
from app.storage import FileStorage, file_storage


class AvatarService:
    """Avatar image processing for the profile module."""

    ALLOWED_EXTENSIONS = {"png", "jpg", "jpeg", "gif", "webp"}
    MAX_FILE_SIZE = 5 * 1024 * 1024
    AVATAR_SIZE = (200, 200)

    def __init__(self, storage: FileStorage | None = None) -> None:
        self.storage = storage or file_storage

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
    ) -> Tuple[str, str]:
        if not self.is_allowed_extension(filename):
            raise ValueError("Unsupported file format")
        if not self.validate_file_size(file_bytes):
            raise ValueError("File size exceeds the 5MB limit")

        hash_input = f"{user_id}_{filename}".encode("utf-8")
        file_hash = hashlib.md5(hash_input).hexdigest()

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

            final_filename = f"{user_id}_{file_hash}.jpg"
            output = io.BytesIO()
            canvas.save(output, "JPEG", quality=85, optimize=True)
            stored = self.storage.save_avatar(
                content=output.getvalue(),
                filename=final_filename,
            )

            logger.info(f"Avatar saved: {final_filename}")
            return final_filename, stored.public_url or self.storage.avatar_url(final_filename)
        except Exception as exc:
            logger.error(f"Avatar processing failed: {exc}")
            raise ValueError(f"Image processing failed: {str(exc)}")

    def delete_avatar(self, filename: str) -> bool:
        try:
            deleted = self.storage.delete_avatar(filename)
            if deleted:
                logger.info(f"Avatar deleted: {filename}")
            return deleted
        except Exception as exc:
            logger.error(f"Avatar deletion failed: {exc}")
            return False

    def avatar_exists(self, filename: str) -> bool:
        try:
            return self.storage.exists(f"avatars/{filename}")
        except Exception as exc:
            logger.warning(f"Avatar existence check failed for {filename}: {exc}")
            return True


avatar_service = AvatarService()
