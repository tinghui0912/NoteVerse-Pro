"""MusicXML processing helpers."""

from .normalization import normalize_initial_musicxml_clefs
from .metadata import (
    EXTRACTOR_VERSION,
    MetadataExtractionError,
    MusicXMLMetadata,
    extract_musicxml_metadata,
)

__all__ = [
    "EXTRACTOR_VERSION",
    "MetadataExtractionError",
    "MusicXMLMetadata",
    "extract_musicxml_metadata",
    "normalize_initial_musicxml_clefs",
]
