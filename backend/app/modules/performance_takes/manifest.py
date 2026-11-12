"""Immutable admitted saved-performance truth, independent of upload and media lifecycle."""

from dataclasses import dataclass
from .schemas import PerformanceTakeManifestRead, PerformanceTakeUploadMetadata

from .recording_media_policy import is_supported_capture_mime, normalize_capture_mime


@dataclass(frozen=True)
class TakeManifest:
    take_uuid: str
    user_id: int
    snapshot: PerformanceTakeManifestRead

    def __post_init__(self) -> None:
        if (
            not isinstance(self.take_uuid, str)
            or not self.take_uuid
            or type(self.user_id) is not int
            or self.user_id <= 0
        ):
            raise ValueError("Invalid saved-performance identity")
        media = self.snapshot.capture
        if media.mime_type != normalize_capture_mime(
            media.mime_type
        ) or not is_supported_capture_mime(media.kind, media.mime_type):
            raise ValueError("Manifest requires a canonical admitted media MIME")

    def agrees_with(self, request: PerformanceTakeUploadMetadata) -> bool:
        value = self.snapshot
        scope = value.scope
        return (
            value.practice_binding == request.practice_binding
            and value.capture == request.media
            and scope.kind == request.scope.kind
            and (
                scope.kind == "FULL"
                or (
                    request.scope.kind == "RANGE"
                    and scope.start_group_id == request.scope.start_group_id
                    and scope.end_group_id == request.scope.end_group_id
                )
            )
            and value.tempo_plan.selection == request.tempo_selection
            and value.recording_timebase == request.recording_timebase
        )
