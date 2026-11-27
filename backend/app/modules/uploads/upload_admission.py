"""Backend-owned admission for Score-import image inputs, independent of other media domains."""

from dataclasses import dataclass
from io import BytesIO
from pathlib import PurePath
import warnings
from PIL import Image, ImageSequence, UnidentifiedImageError
from app.core.exceptions import ValidationException
from app.shared.error_codes import CustomerErrorCode


@dataclass(frozen=True)
class ScoreImportImage:
    container: str
    mime_type: str
    extension: str
    aliases: frozenset[str]


SCORE_IMPORT_IMAGES = (
    ScoreImportImage("PNG", "image/png", ".png", frozenset({".png"})),
    ScoreImportImage("JPEG", "image/jpeg", ".jpg", frozenset({".jpg", ".jpeg"})),
    ScoreImportImage("BMP", "image/bmp", ".bmp", frozenset({".bmp"})),
    ScoreImportImage("GIF", "image/gif", ".gif", frozenset({".gif"})),
    ScoreImportImage("WEBP", "image/webp", ".webp", frozenset({".webp"})),
    ScoreImportImage("TIFF", "image/tiff", ".tiff", frozenset({".tif", ".tiff"})),
)


def admit_score_import_image(content: bytes, filename: str) -> ScoreImportImage:
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(BytesIO(content)) as image:
                descriptor = next(
                    (item for item in SCORE_IMPORT_IMAGES if item.container == image.format), None
                )
                if (
                    descriptor is None
                    or PurePath(filename).suffix.lower() not in descriptor.aliases
                ):
                    raise ValueError("Image container and filename disagree")
                image.verify()
            with Image.open(BytesIO(content)) as image:
                for frame in ImageSequence.Iterator(image):
                    frame.load()
        return descriptor
    except (
        OSError,
        ValueError,
        SyntaxError,
        UnidentifiedImageError,
        Image.DecompressionBombWarning,
        Image.DecompressionBombError,
    ) as exc:
        raise ValidationException(
            code=CustomerErrorCode.FILE_TYPE_NOT_ALLOWED, field="file"
        ) from exc
