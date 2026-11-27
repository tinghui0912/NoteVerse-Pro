"""Small byte fixtures for the original Recording signature families."""

SIGNATURE_HEADERS = {
    "EBML": b"\x1a\x45\xdf\xa3",
    "OGG": b"OggS",
    "RIFF_WAVE": b"RIFF\x00\x00\x00\x00WAVE",
    "ISO_BMFF_FTYP": b"\x00\x00\x00\x18ftypisom\x00\x00\x00\x00isommp42",
}
