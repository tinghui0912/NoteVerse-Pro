"""Soundfont helpers for score-audio synthesis runtimes."""

from __future__ import annotations

import importlib.util
import os
import shutil
from pathlib import Path


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
