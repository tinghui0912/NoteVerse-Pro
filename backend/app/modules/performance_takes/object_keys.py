"""Distinct staging and finalization-generation recording identities."""

from .recording_media_admission import recording_extension


def _require_segment(value: str) -> None:
    if not value or value in {".", ".."} or "/" in value or "\\" in value:
        raise ValueError("Object identity must be a nonempty namespace segment")


def performance_take_staging_object_key(
    *,
    user_id: int,
    take_uuid: str,
    media_kind: str,
    mime_type: str,
) -> str:
    if user_id < 1:
        raise ValueError("Recording owner must be a persisted user")
    _require_segment(take_uuid)
    extension = recording_extension(media_kind, mime_type)
    return f"staging/performance-takes/{user_id}/{take_uuid}/recording.{extension}"


def performance_take_recording_object_key(
    *,
    user_id: int,
    take_uuid: str,
    finalize_token: str,
    media_kind: str,
    mime_type: str,
) -> str:
    if user_id < 1:
        raise ValueError("Recording owner must be a persisted user")
    _require_segment(take_uuid)
    _require_segment(finalize_token)
    extension = recording_extension(media_kind, mime_type)
    return f"performance-takes/{user_id}/{take_uuid}/{finalize_token}.{extension}"
