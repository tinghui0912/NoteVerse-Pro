from __future__ import annotations

import base64
from dataclasses import dataclass
from fractions import Fraction

from app.shared.constants import ErrorCode
from app.processing.musicxml.admission import admit_musicxml_document
from app.score_semantics.musicxml_score import parse_score_semantics
from app.score_semantics.performance_plan import build_performance_plan
from .tempo_projection import playback_musicxml, project_midi_tempos


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
            plan = build_performance_plan(parse_score_semantics(admitted))
        except ValueError as exc:
            raise RuntimeError(f"{ErrorCode.SCORE_PLAYBACK_FAILED}: {exc}") from exc
        try:
            import verovio
        except Exception as exc:
            raise RuntimeError(f"{ErrorCode.SCORE_PLAYBACK_FAILED}: {exc}") from exc

        toolkit = verovio.toolkit()
        toolkit.setOptions({"inputFrom": "xml"})
        loaded = toolkit.loadData(playback_musicxml(admitted))
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
        try:
            tempos = [(Fraction(0), plan.initial_tempo_bpm)] + [
                (t.position, t.bpm) for t in plan.tempo_events
            ]
            midi = project_midi_tempos(midi, tempos)
        except (ValueError, KeyError, IndexError) as exc:
            raise RuntimeError(
                f"{ErrorCode.SCORE_PLAYBACK_FAILED}: invalid tempo projection"
            ) from exc
        return CompiledMidi(
            content=midi,
            generator=self.generator,
            generator_version=self.generator_version,
        )
