"""SoundFont runtime-resource preparation and identity helpers."""

from __future__ import annotations

import importlib.util
import hashlib
import os
import shutil
from pathlib import Path


def soundfont_sha256(path: Path) -> str:
    """Return the content digest of a SoundFont selected by a runtime profile."""

    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def ensure_partitura_default_soundfont(soundfont_path: str | None) -> Path | None:
    """Prevent partitura from downloading its bundled default soundfont at import time."""

    if not soundfont_path:
        return None

    source = Path(soundfont_path).expanduser()
    if not source.is_file():
        return None

    spec = importlib.util.find_spec("partitura")
    if spec is None or not spec.submodule_search_locations:
        return None

    package_root = Path(next(iter(spec.submodule_search_locations)))
    target = package_root / "assets" / "MuseScore_General.sf3"
    if target.exists():
        return target

    target.parent.mkdir(parents=True, exist_ok=True)
    try:
        os.symlink(source, target)
    except OSError:
        shutil.copyfile(source, target)
    return target
