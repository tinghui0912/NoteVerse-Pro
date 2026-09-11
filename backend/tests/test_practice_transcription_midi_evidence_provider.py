from __future__ import annotations

import mido
import numpy as np
import pytest

from app.processing.engines.practice_alignment.expected_event_evaluator import (
    EvaluatorEvidence,
    ExpectedEventEvaluator,
)
from app.processing.engines.practice_alignment.score_timeline import (
    ExpectedPracticeGroup,
    ExpectedPracticeNote,
    ExpectedPracticeStrikeTarget,
)
from app.processing.engines.practice_alignment.transcription_midi_evidence_provider import (
    DEFAULT_TRANSCRIPTION_MIDI_PROVIDER_ID,
    TranscriptionMidiEvidenceProvider,
)


SAMPLE_RATE = 16000


def test_transcription_midi_provider_projects_expected_and_extra_pitches(tmp_path) -> None:
    midi_path = tmp_path / "transkun-output.mid"
    midi = mido.MidiFile(ticks_per_beat=480)
    track = mido.MidiTrack()
    midi.tracks.append(track)
    track.append(mido.MetaMessage("set_tempo", tempo=500000, time=0))
    track.append(mido.Message("note_on", note=60, velocity=80, time=0))
    track.append(mido.Message("note_on", note=65, velocity=70, time=0))
    track.append(mido.Message("note_off", note=60, velocity=0, time=240))
    track.append(mido.Message("note_off", note=65, velocity=0, time=0))
    midi.save(midi_path)

    provider = TranscriptionMidiEvidenceProvider.from_midi_file(midi_path)
    group = expected_group("C4", "E4")
    observation = provider.observe_expected_group(
        np.zeros(int(SAMPLE_RATE * 0.5), dtype=np.float32),
        expected_group=group,
        sample_rate=SAMPLE_RATE,
        np_module=np,
        onset_beat=group.onset_beat,
        window_start_seconds=0.0,
        window_end_seconds=0.1,
    )

    assert provider.descriptor.benchmark_only is True
    assert provider.descriptor.provider_id == DEFAULT_TRANSCRIPTION_MIDI_PROVIDER_ID
    assert provider.descriptor.metadata["artifact_kind"] == "external_transcription_midi"
    assert provider.descriptor.metadata["midi_sha256"]
    assert observation.observed_pitches == ("C4", "F4")
    assert observation.extra_observed_pitches == ("F4",)

    evaluation = ExpectedEventEvaluator().evaluate(
        group,
        EvaluatorEvidence.from_audio(observation.to_audio_observation()),
    )
    assert evaluation.result == "MISMATCH"
    assert evaluation.matched_pitches == ("C4",)
    assert evaluation.missing_pitches == ("E4",)
    assert evaluation.extra_pitches == ("F4",)


def test_transcription_midi_provider_alignment_narrows_projection_window(tmp_path) -> None:
    midi_path = tmp_path / "transkun-output.mid"
    midi = mido.MidiFile(ticks_per_beat=480)
    track = mido.MidiTrack()
    midi.tracks.append(track)
    track.append(mido.MetaMessage("set_tempo", tempo=500000, time=0))
    track.append(mido.Message("note_on", note=60, velocity=80, time=0))
    track.append(mido.Message("note_on", note=65, velocity=70, time=192))
    midi.save(midi_path)

    group = expected_group("C4")
    provider = TranscriptionMidiEvidenceProvider.from_midi_file(
        midi_path,
        expected_groups=(group,),
        alignment_tolerance_seconds=0.05,
    )

    observation = provider.observe_expected_group(
        np.zeros(int(SAMPLE_RATE * 0.5), dtype=np.float32),
        expected_group=group,
        sample_rate=SAMPLE_RATE,
        np_module=np,
        onset_beat=group.onset_beat,
        window_start_seconds=0.0,
        window_end_seconds=0.3,
    )

    assert observation.observed_pitches == ("C4",)
    assert observation.extra_observed_pitches == ()


def test_transcription_midi_provider_alignment_returns_uncertain_outside_window(
    tmp_path,
) -> None:
    midi_path = tmp_path / "transkun-output.mid"
    midi = mido.MidiFile(ticks_per_beat=480)
    track = mido.MidiTrack()
    midi.tracks.append(track)
    track.append(mido.MetaMessage("set_tempo", tempo=500000, time=0))
    track.append(mido.Message("note_on", note=60, velocity=80, time=0))
    midi.save(midi_path)

    group = expected_group("C4")
    provider = TranscriptionMidiEvidenceProvider.from_midi_file(
        midi_path,
        expected_groups=(group,),
        alignment_tolerance_seconds=0.05,
    )

    observation = provider.observe_expected_group(
        np.zeros(int(SAMPLE_RATE * 0.5), dtype=np.float32),
        expected_group=group,
        sample_rate=SAMPLE_RATE,
        np_module=np,
        onset_beat=group.onset_beat,
        window_start_seconds=0.2,
        window_end_seconds=0.3,
    )

    assert observation.observed_pitches == ()
    assert observation.confidence == 0.0


def test_transcription_midi_provider_requires_benchmark_window(tmp_path) -> None:
    midi_path = tmp_path / "empty.mid"
    mido.MidiFile().save(midi_path)
    provider = TranscriptionMidiEvidenceProvider.from_midi_file(midi_path)

    with pytest.raises(ValueError, match="requires benchmark window times"):
        provider.observe_expected_group(
            np.zeros(int(SAMPLE_RATE * 0.5), dtype=np.float32),
            expected_group=expected_group("C4"),
            sample_rate=SAMPLE_RATE,
            np_module=np,
        )


def expected_group(*pitches: str) -> ExpectedPracticeGroup:
    expected_notes = tuple(
        ExpectedPracticeNote(
            expected_note_id=f"event-1:n{index}",
            event_id="event-1",
            pitch=pitch,
            render_note_id=f"n{index}",
            measure_numbers=("1",),
        )
        for index, pitch in enumerate(pitches, start=1)
    )
    strike_targets = tuple(
        ExpectedPracticeStrikeTarget(
            strike_id=f"entry-1:strike:{pitch}",
            pitch=pitch,
            expected_notes=tuple(note for note in expected_notes if note.pitch == pitch),
            event_ids=("event-1",),
            render_note_ids=tuple(
                note.render_note_id for note in expected_notes if note.pitch == pitch
            ),
            measure_numbers=("1",),
        )
        for pitch in dict.fromkeys(pitches)
    )
    return ExpectedPracticeGroup(
        group_id="entry-1",
        onset_beat=4.0,
        event_ids=("event-1",),
        expected_notes=expected_notes,
        strike_targets=strike_targets,
        render_note_ids=tuple(note.render_note_id for note in expected_notes),
        pitches=tuple(dict.fromkeys(pitches)),
        measure_numbers=("1",),
        staff_ids=("1",),
        voice_ids=("1",),
    )
