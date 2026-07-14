"""Import/review-stage temporary artifact kinds."""

import enum


class ImportArtifactKind(str, enum.Enum):
    REVIEW_MUSICXML = "review_musicxml"
    REVIEW_PREVIEW_IMAGE = "review_preview_image"
