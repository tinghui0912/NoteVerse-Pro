from __future__ import annotations

import builtins
from contextlib import contextmanager
import os
from typing import Iterator

from app.processing.resources import ensure_partitura_default_soundfont


def load_score_as_part_for_practice(prepared_musicxml_path: str):
    """Load MusicXML through Partitura's score parser.

    Partitura imports its optional FluidSynth audio path from the package root.
    When FluidSynth is importable and the bundled default SoundFont is missing,
    that import path tries to download a SoundFont even though score parsing does
    not need synthesis. The adapter blocks only that optional import when no
    real Practice SoundFont is configured.
    """

    soundfont_path = os.getenv("PRACTICE_SOUNDFONT_PATH")
    if soundfont_path:
        ensure_partitura_default_soundfont(soundfont_path)

    with configure_partitura_for_offline_score_parsing(
        block_optional_fluidsynth=not bool(soundfont_path)
    ):
        try:
            import partitura
        except ImportError as exc:
            missing_module = getattr(exc, "name", None) or "unknown"
            raise RuntimeError(
                "Missing practice score dependency "
                f"'{missing_module}'. Install partitura before building a practice timeline."
            ) from exc

    return partitura.load_score_as_part(prepared_musicxml_path)


@contextmanager
def configure_partitura_for_offline_score_parsing(
    *,
    block_optional_fluidsynth: bool,
) -> Iterator[None]:
    """Prevent Partitura score parsing from initializing optional synthesis resources."""

    if not block_optional_fluidsynth:
        yield
        return

    original_import = builtins.__import__

    def guarded_import(name, globals=None, locals=None, fromlist=(), level=0):
        if name == "fluidsynth" and level == 0:
            raise ImportError(
                "FluidSynth is intentionally disabled for offline score parsing"
            )
        return original_import(name, globals, locals, fromlist, level)

    builtins.__import__ = guarded_import
    try:
        yield
    finally:
        builtins.__import__ = original_import
