from __future__ import annotations

import base64
from dataclasses import dataclass

from app.shared.error_codes import CustomerErrorCode
from app.processing.musicxml.admission import admit_musicxml_document
from app.processing.musicxml.verovio_written_realization import validate_verovio_written_realization
from app.score_semantics.musicxml_score import parse_score_semantics
from app.score_semantics.performance_plan import build_performance_plan
from .standard_midi import parse_standard_midi, serialize_standard_midi
from .performance_midi import project_performance_midi


@dataclass(frozen=True)
class CompiledMidi:
    content: bytes
    generator: str
    generator_version: str


class VerovioMidiCompiler:
    """Compile MusicXML into MIDI through the Verovio processing engine."""

    generator = "musicxml-verovio-midi"
    generator_version = "1"

    def compile(self, content: bytes) -> CompiledMidi:
        admitted = admit_musicxml_document(content)
        try:
            model = parse_score_semantics(admitted)
            validate_verovio_written_realization(admitted, model)
            plan = build_performance_plan(model)
        except ValueError as exc:
            raise RuntimeError(f"{CustomerErrorCode.SCORE_PLAYBACK_FAILED}: {exc}") from exc
        try:
            import verovio
        except Exception as exc:
            raise RuntimeError(f"{CustomerErrorCode.SCORE_PLAYBACK_FAILED}: {exc}") from exc

        toolkit = verovio.toolkit()
        if toolkit.setOptions({"inputFrom": "xml", "expandNever": True}) is False:
            raise RuntimeError(
                f"{CustomerErrorCode.SCORE_PLAYBACK_FAILED}: written realization options rejected"
            )
        loaded = toolkit.loadData(admitted.decode("utf-8"))
        if loaded is False:
            raise RuntimeError(
                f"{CustomerErrorCode.SCORE_PLAYBACK_FAILED}: failed to load MusicXML"
            )

        encoded = toolkit.renderToMIDI()
        if not encoded:
            raise RuntimeError(f"{CustomerErrorCode.SCORE_PLAYBACK_FAILED}: no MIDI output")
        try:
            midi = base64.b64decode(encoded, validate=True)
        except Exception as exc:
            raise RuntimeError(
                f"{CustomerErrorCode.SCORE_PLAYBACK_FAILED}: invalid MIDI output"
            ) from exc
        if not midi.startswith(b"MThd"):
            raise RuntimeError(f"{CustomerErrorCode.SCORE_PLAYBACK_FAILED}: invalid MIDI header")
        try:
            written = parse_standard_midi(midi)
            midi = serialize_standard_midi(project_performance_midi(written, plan))
        except (ValueError, KeyError, IndexError) as exc:
            raise RuntimeError(
                f"{CustomerErrorCode.SCORE_PLAYBACK_FAILED}: invalid canonical MIDI projection"
            ) from exc
        return CompiledMidi(
            content=midi,
            generator=self.generator,
            generator_version=self.generator_version,
        )
