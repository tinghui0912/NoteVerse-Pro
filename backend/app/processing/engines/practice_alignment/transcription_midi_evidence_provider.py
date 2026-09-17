"""Benchmark-only provider that projects external AMT MIDI onto practice targets."""

from __future__ import annotations

from dataclasses import dataclass
import hashlib
from pathlib import Path

import mido

from app.processing.engines.practice_alignment.acoustic_evidence_provider import (
    AcousticEvidenceProviderDescriptor,
)
from app.processing.engines.practice_alignment.score_timeline import (
    ExpectedPracticeGroup,
    ScoreBeat,
)
from app.processing.engines.practice_alignment.target_conditioned_acoustic_observation import (
    ExpectedPitchActivation,
    TargetConditionedObservation,
)


_NOTE_NAMES = ("C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B")
DEFAULT_TRANSCRIPTION_MIDI_PROVIDER_ID = "transkun-pypi-2-0-1-default-midi-oracle"


@dataclass(frozen=True)
class TranscribedMidiNoteOn:
    seconds: float
    pitch: str


@dataclass(frozen=True)
class TranscriptScoreAlignment:
    """Maps score practice groups onto an external transcript time axis."""

    group_time_seconds_by_id: dict[str, float]
    tolerance_seconds: float = 0.12


@dataclass(frozen=True)
class TranscriptionMidiEvidenceProvider:
    """Uses an exported transcription MIDI as an offline benchmark oracle."""

    note_ons: tuple[TranscribedMidiNoteOn, ...]
    provider_id: str = DEFAULT_TRANSCRIPTION_MIDI_PROVIDER_ID
    alignment: TranscriptScoreAlignment | None = None
    metadata: dict[str, object] | None = None

    @classmethod
    def from_midi_file(
        cls,
        midi_path: Path,
        *,
        provider_id: str = DEFAULT_TRANSCRIPTION_MIDI_PROVIDER_ID,
        expected_groups: tuple[ExpectedPracticeGroup, ...] = (),
        alignment_tolerance_seconds: float = 0.12,
        provider_metadata: dict[str, object] | None = None,
    ) -> "TranscriptionMidiEvidenceProvider":
        note_ons = _read_midi_note_ons(midi_path)
        alignment = (
            None
            if not expected_groups
            else align_transcript_to_expected_groups(
                expected_groups,
                note_ons,
                tolerance_seconds=alignment_tolerance_seconds,
            )
        )
        return cls(
            note_ons=note_ons,
            provider_id=provider_id,
            alignment=alignment,
            metadata={
                "benchmark_schema_version": "acoustic-evidence-provider-v1",
                "artifact_kind": "external_transcription_midi",
                "midi_path": str(midi_path),
                "midi_sha256": _file_sha256(midi_path),
                "provider_config": {
                    "alignment_version": "greedy-note-on-cluster-v1",
                    "alignment_tolerance_seconds": alignment_tolerance_seconds,
                },
                **(provider_metadata or {}),
            },
        )

    @property
    def descriptor(self) -> AcousticEvidenceProviderDescriptor:
        return AcousticEvidenceProviderDescriptor(
            provider_id=self.provider_id,
            benchmark_only=True,
            output_semantics=(
                "external AMT MIDI note-on transcript projected onto expected "
                "practice strike targets"
            ),
            metadata=dict(self.metadata or {}),
        )

    @property
    def uses_offline_score_alignment(self) -> bool:
        return self.alignment is not None

    def observe_expected_group(
        self,
        samples,
        *,
        expected_group: ExpectedPracticeGroup,
        sample_rate: int,
        np_module,
        onset_beat: ScoreBeat | None = None,
        window_start_seconds: float | None = None,
        window_end_seconds: float | None = None,
    ) -> TargetConditionedObservation:
        if window_start_seconds is None or window_end_seconds is None:
            raise ValueError(
                "TranscriptionMidiEvidenceProvider requires benchmark window times"
            )

        projection_window = _projection_window(
            expected_group,
            alignment=self.alignment,
            window_start_seconds=window_start_seconds,
            window_end_seconds=window_end_seconds,
        )
        if projection_window is None:
            return TargetConditionedObservation(
                expected_group_id=expected_group.group_id,
                onset_beat=onset_beat,
                activations=tuple(
                    ExpectedPitchActivation(
                        pitch=strike.pitch,
                        spectral_score=0.0,
                        confidence=0.0,
                        matched=False,
                    )
                    for strike in expected_group.strike_targets
                ),
            )

        projection_start_seconds, projection_end_seconds = projection_window
        expected_pitches = tuple(strike.pitch for strike in expected_group.strike_targets)
        expected_pitch_set = set(expected_pitches)
        observed_pitches = tuple(
            dict.fromkeys(
                note.pitch
                for note in self.note_ons
                if projection_start_seconds <= note.seconds <= projection_end_seconds
            )
        )
        observed_pitch_set = set(observed_pitches)
        activations = tuple(
            ExpectedPitchActivation(
                pitch=pitch,
                spectral_score=1.0 if pitch in observed_pitch_set else 0.0,
                confidence=1.0 if pitch in observed_pitch_set else 0.0,
                matched=pitch in observed_pitch_set,
            )
            for pitch in expected_pitches
        )
        extra_observed_pitches = tuple(
            pitch for pitch in observed_pitches if pitch not in expected_pitch_set
        )
        return TargetConditionedObservation(
            expected_group_id=expected_group.group_id,
            onset_beat=onset_beat,
            activations=activations,
            extra_observed_pitches=extra_observed_pitches,
            extra_confidence=1.0 if extra_observed_pitches else 0.0,
        )


def _read_midi_note_ons(midi_path: Path) -> tuple[TranscribedMidiNoteOn, ...]:
    midi = mido.MidiFile(midi_path)
    seconds = 0.0
    note_ons: list[TranscribedMidiNoteOn] = []
    for message in midi:
        seconds += float(message.time)
        if message.type == "note_on" and int(message.velocity) > 0:
            note_ons.append(
                TranscribedMidiNoteOn(
                    seconds=round(seconds, 6),
                    pitch=_midi_note_name(int(message.note)),
                )
            )
    return tuple(note_ons)


def _file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def align_transcript_to_expected_groups(
    expected_groups: tuple[ExpectedPracticeGroup, ...],
    note_ons: tuple[TranscribedMidiNoteOn, ...],
    *,
    tolerance_seconds: float = 0.12,
) -> TranscriptScoreAlignment:
    """Greedily anchors expected groups to matching transcript note-on clusters.

    This is benchmark scaffolding, not a production following policy. It keeps
    offline AMT output on its own time axis and narrows each projected group to
    the matching transcript gesture instead of treating a broad runtime window as
    the truth.
    """

    group_time_seconds_by_id: dict[str, float] = {}
    note_index = 0
    sorted_note_ons = tuple(sorted(note_ons, key=lambda note: note.seconds))
    for group in expected_groups:
        expected_pitches = {strike.pitch for strike in group.strike_targets}
        if not expected_pitches:
            continue

        anchor_index = next(
            (
                index
                for index in range(note_index, len(sorted_note_ons))
                if sorted_note_ons[index].pitch in expected_pitches
            ),
            None,
        )
        if anchor_index is None:
            break

        anchor_seconds = sorted_note_ons[anchor_index].seconds
        group_time_seconds_by_id[group.group_id] = anchor_seconds
        note_index = next(
            (
                index
                for index in range(anchor_index + 1, len(sorted_note_ons))
                if sorted_note_ons[index].seconds > anchor_seconds + tolerance_seconds
            ),
            len(sorted_note_ons),
        )

    return TranscriptScoreAlignment(
        group_time_seconds_by_id=group_time_seconds_by_id,
        tolerance_seconds=tolerance_seconds,
    )


def _projection_window(
    expected_group: ExpectedPracticeGroup,
    *,
    alignment: TranscriptScoreAlignment | None,
    window_start_seconds: float,
    window_end_seconds: float,
) -> tuple[float, float] | None:
    if alignment is None:
        return window_start_seconds, window_end_seconds

    aligned_seconds = alignment.group_time_seconds_by_id.get(expected_group.group_id)
    if aligned_seconds is None:
        return None

    aligned_start = aligned_seconds - alignment.tolerance_seconds
    aligned_end = aligned_seconds + alignment.tolerance_seconds
    projection_start = max(window_start_seconds, aligned_start)
    projection_end = min(window_end_seconds, aligned_end)
    if projection_end < projection_start:
        return None
    return projection_start, projection_end


def _midi_note_name(note_number: int) -> str:
    pitch_class = _NOTE_NAMES[note_number % 12]
    octave = note_number // 12 - 1
    return f"{pitch_class}{octave}"
