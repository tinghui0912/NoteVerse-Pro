"""Content-addressed identity of the current temporary Review MusicXML."""

import re


def review_musicxml_object_key(*, job_uuid: str, content_sha256: str) -> str:
    if not job_uuid or job_uuid in {".", ".."} or "/" in job_uuid or "\\" in job_uuid:
        raise ValueError("Import identity must be a nonempty namespace segment")
    if re.fullmatch(r"[0-9a-f]{64}", content_sha256) is None:
        raise ValueError("Review MusicXML identity requires a full lowercase SHA-256")
    return f"jobs/{job_uuid}/review_musicxml/{content_sha256}/score.musicxml"
