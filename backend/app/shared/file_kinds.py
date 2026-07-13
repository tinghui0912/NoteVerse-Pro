"""Shared file-kind enum used across models, services, and pipeline code."""

import enum


class FileKind(str, enum.Enum):
    REVIEW_MUSICXML = "review_musicxml"
    RESULT_THUMBNAIL = "result_thumbnail"
