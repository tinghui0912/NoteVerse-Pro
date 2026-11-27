"""Identity of the SoundFont supplied to playback synthesis."""

from pathlib import Path
import hashlib


def soundfont_sha256(path: Path) -> str:
    """Return the content digest of a SoundFont selected by a runtime profile."""

    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()
