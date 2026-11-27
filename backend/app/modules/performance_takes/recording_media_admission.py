"""Original Recording admission and signature semantics over the generated durable container descriptors."""

from .generated.recording_media_admission import ORIGINAL_RECORDING_CONTAINERS, RecordingContainer


def normalize_recording_mime(mime_type: str) -> str:
    return mime_type.split(";", 1)[0].strip().lower()


def _recording_container(kind: str, mime_type: str) -> RecordingContainer:
    canonical = normalize_recording_mime(mime_type)
    for descriptor in ORIGINAL_RECORDING_CONTAINERS:
        if descriptor.kind == kind and descriptor.mime_type == canonical:
            return descriptor
    raise ValueError("Unsupported original recording container")


def is_admitted_recording_mime(kind: str, mime_type: str) -> bool:
    try:
        _recording_container(kind, mime_type)
        return True
    except ValueError:
        return False


def recording_extension(kind: str, mime_type: str) -> str:
    return _recording_container(kind, mime_type).extension


def verify_recording_container_signature(kind: str, mime_type: str, header_bytes: bytes) -> bool:
    try:
        descriptor = _recording_container(kind, mime_type)
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
