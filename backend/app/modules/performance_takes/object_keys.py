"""Server-generated immutable recording identities."""

from .recording_media_admission import recording_extension


def _require_segment(value: str) -> None:
    if not value or value in {".", ".."} or "/" in value or "\\" in value:
        raise ValueError("Object identity must be a nonempty namespace segment")


def performance_take_recording_object_key(
    *,
    user_id: int,
    take_uuid: str,
    object_generation: str,
    media_kind: str,
    mime_type: str,
) -> str:
    if user_id < 1:
        raise ValueError("Recording owner must be a persisted user")
    _require_segment(take_uuid)
    _require_segment(object_generation)
    extension = recording_extension(media_kind, mime_type)
    return f"performance-takes/{user_id}/{take_uuid}/{object_generation}.{extension}"
