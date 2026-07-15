from __future__ import annotations

import base64
from dataclasses import dataclass

from app.shared.constants import ErrorCode


@dataclass(frozen=True)
class CompiledMidi:
    content: bytes
    generator: str
    generator_version: str


class VerovioMidiCompiler:
    """Compile MusicXML into MIDI using the same notation engine as score previews."""

    generator = "musicxml-verovio-midi"
    generator_version = "1"

    def compile(self, content: bytes) -> CompiledMidi:
        try:
            import verovio
        except Exception as exc:
            raise RuntimeError(f"{ErrorCode.SCORE_PLAYBACK_FAILED}: {exc}") from exc

        toolkit = verovio.toolkit()
        toolkit.setOptions({"inputFrom": "xml"})
        loaded = toolkit.loadData(content.decode("utf-8"))
        if loaded is False:
            raise RuntimeError(f"{ErrorCode.SCORE_PLAYBACK_FAILED}: failed to load MusicXML")

        encoded = toolkit.renderToMIDI()
        if not encoded:
            raise RuntimeError(f"{ErrorCode.SCORE_PLAYBACK_FAILED}: no MIDI output")
        try:
            midi = base64.b64decode(encoded, validate=True)
        except Exception as exc:
            raise RuntimeError(f"{ErrorCode.SCORE_PLAYBACK_FAILED}: invalid MIDI output") from exc
        if not midi.startswith(b"MThd"):
            raise RuntimeError(f"{ErrorCode.SCORE_PLAYBACK_FAILED}: invalid MIDI header")
        return CompiledMidi(
            content=midi,
            generator=self.generator,
            generator_version=self.generator_version,
        )
