"""Upload transport states and injected resource limits."""

from dataclasses import dataclass
from enum import StrEnum
from math import ceil


class UploadPurpose(StrEnum):
    SCORE_IMPORT = "SCORE_IMPORT"
    PERFORMANCE_TAKE = "PERFORMANCE_TAKE"


class UploadMode(StrEnum):
    SINGLE_PUT = "SINGLE_PUT"
    MULTIPART = "MULTIPART"


class UploadStatus(StrEnum):
    CREATING = "CREATING"
    UPLOADING = "UPLOADING"
    COMPLETING = "COMPLETING"
    COMPLETED = "COMPLETED"
    CONSUMED = "CONSUMED"
    CANCELLED = "CANCELLED"
    EXPIRED = "EXPIRED"
    FAILED = "FAILED"


ACTIVE_STATUSES = (
    UploadStatus.CREATING,
    UploadStatus.UPLOADING,
    UploadStatus.COMPLETING,
    UploadStatus.COMPLETED,
)
TERMINAL_STATUSES = (UploadStatus.CANCELLED, UploadStatus.EXPIRED, UploadStatus.FAILED)


@dataclass(frozen=True)
class UploadPolicy:
    score_max_bytes: int
    audio_max_bytes: int
    video_max_bytes: int
    single_put_max_bytes: int
    part_bytes: int
    url_ttl_seconds: int
    session_ttl_seconds: int
    concurrency: int
    max_active_sessions: int
    temporary_byte_budget: int

    def __post_init__(self) -> None:
        if min(vars(self).values()) <= 0 or self.part_bytes < 5 * 1024 * 1024:
            raise ValueError("Upload limits must be positive and parts at least 5 MiB")

    def mode_for(self, purpose: UploadPurpose, size: int, content_type: str) -> UploadMode:
        if type(size) is not int or size <= 0:
            raise ValueError("Upload requires positive exact bytes")
        limit = (
            self.score_max_bytes
            if purpose == UploadPurpose.SCORE_IMPORT
            else self.video_max_bytes
            if content_type.startswith("video/")
            else self.audio_max_bytes
        )
        if size > limit:
            raise ValueError("Upload exceeds the resource file limit")
        return UploadMode.SINGLE_PUT if size <= self.single_put_max_bytes else UploadMode.MULTIPART

    def part_plan(self, size: int, number: int) -> int:
        return part_length(size, self.part_bytes, number)


def part_length(size: int, part_bytes: int, number: int) -> int:
    if type(number) is not int or not 1 <= number <= min(10000, ceil(size / part_bytes)):
        raise ValueError("Part number is outside the immutable upload plan")
    return min(part_bytes, size - (number - 1) * part_bytes)
