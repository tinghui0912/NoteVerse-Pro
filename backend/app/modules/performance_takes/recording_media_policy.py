"""Original Recording admission and signature semantics over the generated container policy."""

from .generated.recording_media_policy import CAPTURE_CONTAINERS, CaptureContainer


def normalize_capture_mime(mime_type: str) -> str:
    return mime_type.split(";", 1)[0].strip().lower()


def _capture_container(kind: str, mime_type: str) -> CaptureContainer:
    canonical = normalize_capture_mime(mime_type)
    for descriptor in CAPTURE_CONTAINERS:
        if descriptor.kind == kind and descriptor.mime_type == canonical:
            return descriptor
    raise ValueError("Unsupported original recording container")


def is_supported_capture_mime(kind: str, mime_type: str) -> bool:
    try:
        _capture_container(kind, mime_type)
        return True
    except ValueError:
        return False


def capture_extension(kind: str, mime_type: str) -> str:
    return _capture_container(kind, mime_type).extension


def verify_capture_container_signature(kind: str, mime_type: str, header_bytes: bytes) -> bool:
    try:
        descriptor = _capture_container(kind, mime_type)
    except ValueError:
        return False
    match descriptor.signature:
        case "EBML":
            return header_bytes.startswith(b"\x1a\x45\xdf\xa3")
        case "OGG":
            return header_bytes.startswith(b"OggS")
        case "RIFF_WAVE":
            return (
                len(header_bytes) >= 12
                and header_bytes[:4] == b"RIFF"
                and header_bytes[8:12] == b"WAVE"
            )
        case "ISO_BMFF_FTYP":
            return len(header_bytes) >= 8 and header_bytes[4:8] == b"ftyp"
        case _:
            raise ValueError("Unsupported recording signature family")
