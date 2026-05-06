"""
Avatar service under the profile module boundary.
"""
import hashlib
import io
import os
from typing import Tuple

from PIL import Image

from app.core.config import settings
from app.core.logger import logger


class AvatarService:
    """Avatar image processing for the profile module."""

    ALLOWED_EXTENSIONS = {"png", "jpg", "jpeg", "gif", "webp"}
    MAX_FILE_SIZE = 5 * 1024 * 1024
    AVATAR_SIZE = (200, 200)

    @property
    def avatar_dir(self) -> str:
        avatar_path = os.path.join(settings.UPLOAD_FOLDER, "avatars")
        os.makedirs(avatar_path, exist_ok=True)
        return avatar_path

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
            final_path = os.path.join(self.avatar_dir, final_filename)
            canvas.save(final_path, "JPEG", quality=85, optimize=True)

            relative_url = f"{settings.API_V1_STR}/uploads/avatars/{final_filename}"
            logger.info(f"Avatar saved: {final_filename}")
            return final_filename, relative_url
        except Exception as exc:
            logger.error(f"Avatar processing failed: {exc}")
            raise ValueError(f"Image processing failed: {str(exc)}")

    def delete_avatar(self, filename: str) -> bool:
        file_path = os.path.join(self.avatar_dir, filename)
        if os.path.exists(file_path):
            try:
                os.remove(file_path)
                logger.info(f"Avatar deleted: {filename}")
                return True
            except Exception as exc:
                logger.error(f"Avatar deletion failed: {exc}")
                return False
        return False


avatar_service = AvatarService()
