"""Generated from contracts/practice/recording-media-admission.json. Do not edit."""

from typing import NamedTuple


class RecordingContainer(NamedTuple):
    kind: str
    mime_type: str
    extension: str
    signature: str


ORIGINAL_RECORDING_CONTAINERS = (
    RecordingContainer("AUDIO", "audio/webm", "webm", "EBML"),
    RecordingContainer("AUDIO", "audio/mp4", "mp4", "ISO_BMFF_FTYP"),
    RecordingContainer("AUDIO", "audio/ogg", "ogg", "OGG"),
    RecordingContainer("AUDIO", "audio/wav", "wav", "RIFF_WAVE"),
    RecordingContainer("AUDIO", "audio/x-wav", "wav", "RIFF_WAVE"),
    RecordingContainer("VIDEO", "video/webm", "webm", "EBML"),
    RecordingContainer("VIDEO", "video/mp4", "mp4", "ISO_BMFF_FTYP"),
)
