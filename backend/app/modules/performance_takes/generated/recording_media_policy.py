"""Generated from contracts/practice/recording-media-policy.json. Do not edit."""

from typing import NamedTuple


class CaptureContainer(NamedTuple):
    kind: str
    mime_type: str
    extension: str
    signature: str


CAPTURE_CONTAINERS = (
    CaptureContainer("AUDIO", "audio/webm", "webm", "EBML"),
    CaptureContainer("AUDIO", "audio/mp4", "mp4", "ISO_BMFF_FTYP"),
    CaptureContainer("AUDIO", "audio/ogg", "ogg", "OGG"),
    CaptureContainer("AUDIO", "audio/wav", "wav", "RIFF_WAVE"),
    CaptureContainer("AUDIO", "audio/x-wav", "wav", "RIFF_WAVE"),
    CaptureContainer("VIDEO", "video/webm", "webm", "EBML"),
    CaptureContainer("VIDEO", "video/mp4", "mp4", "ISO_BMFF_FTYP"),
)

VIDEO_CAPTURE_MIME_CANDIDATES = (
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
    "video/mp4",
)
