"""Extract public paired WAV+MIDI cases for causal STEP microphone replay.

Selection uses only MIDI ground truth and source timing metadata. The generated
manifest can be replayed by evaluate_production_step_microphone_causal_replay.py;
the recognizer receives only the exported 16 kHz WAV segment and expected target
pitches, never the MIDI truth.
"""

from __future__ import annotations

import argparse
from dataclasses import asdict, dataclass
import json
from pathlib import Path
import wave

import mido
import numpy as np

from evaluate_public_paired_midi_dataset import (
    DEFAULT_CHORD_WINDOW_SECONDS,
    DEFAULT_SAMPLE_RATE,
    MidiStrikeGroup,
    _file_sha256,
    _midi_pitch_name,
    group_note_ons,
    parse_midi_note_ons,
    read_pcm_wav,
)


DEFAULT_OUTPUT_DIR = Path("data/work/datasets/public_step_causal_cases")
CASE_ORDER = (
    "correct_strike",
    "wrong_semitone",
    "wrong_octave",
    "sustain_tail_without_retrigger",
    "same_note_retrigger",
    "correct_chord",
    "missing_chord_tone",
)


@dataclass(frozen=True)
class MidiNoteSpan:
    pitch: str
    midi_note: int
    start_seconds: float
    end_seconds: float | None
    velocity: int


@dataclass(frozen=True)
class PedalEvent:
    seconds: float
    value: int
    down: bool


@dataclass(frozen=True)
class ExtractedCase:
    case_id: str
    case_kind: str
    audio_path: str
    expected_groups: tuple[tuple[str, ...], ...]
    expected_advances: int
    actual_groups: tuple[tuple[str, ...], ...]
    source_dataset: str
    source_file: str
    source_midi: str
    source_audio_sha256: str
    source_midi_sha256: str
    source_time_range_seconds: tuple[float, float]
    target_group_indices: tuple[int, ...]
    target_group_seconds: tuple[float, ...]
    ground_truth_note_events: tuple[dict[str, object], ...]
    ground_truth_pedal_events: tuple[dict[str, object], ...]
    diagnostic_note: str


def main() -> int:
    args = parse_args()
    audio = read_pcm_wav(args.audio, sample_rate=args.sample_rate)
    notes = parse_midi_note_ons(args.midi)
    groups = group_note_ons(notes, chord_window_seconds=args.chord_window_seconds)
    spans, pedal_events = parse_midi_note_spans_and_pedal(args.midi)
    plans = select_case_plans(groups, spans, max_cases_per_kind=args.max_cases_per_kind)
    cases = export_cases(
        plans,
        audio=audio,
        spans=spans,
        pedal_events=pedal_events,
        audio_path=args.audio,
        midi_path=args.midi,
        output_dir=args.output_dir,
        dataset_id=args.dataset_id,
        pre_context_seconds=args.pre_context_seconds,
        post_context_seconds=args.post_context_seconds,
        sample_rate=args.sample_rate,
    )
    manifest = {
        "benchmark_scope": "public_paired_midi_step_causal_case_selection",
        "dataset": {
            "source_kind": "public_paired_audio_midi",
            "source_dataset": args.dataset_id,
            "public_dataset_case_is_product_validation": False,
            "audio_path": str(args.audio),
            "midi_path": str(args.midi),
            "audio_sha256": _file_sha256(args.audio),
            "midi_sha256": _file_sha256(args.midi),
        },
        "selection_contract": {
            "case_selection_source": "paired_midi_ground_truth_only",
            "recognizer_predictions_used_for_selection": False,
            "midi_visible_to_causal_replay_recognizer": False,
            "export_sample_rate_hz": args.sample_rate,
            "pre_context_seconds": args.pre_context_seconds,
            "post_context_seconds": args.post_context_seconds,
            "case_count": len(cases),
        },
        "cases": [asdict(case) for case in cases],
    }
    args.output_dir.mkdir(parents=True, exist_ok=True)
    manifest_path = args.output_dir / "public_step_causal_cases_manifest.json"
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"manifest": str(manifest_path), "case_count": len(cases)}, indent=2))
    return 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--audio", type=Path, required=True)
    parser.add_argument("--midi", type=Path, required=True)
    parser.add_argument("--dataset-id", default="MAESTRO v3.0.0")
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR)
    parser.add_argument("--sample-rate", type=int, default=DEFAULT_SAMPLE_RATE)
    parser.add_argument("--chord-window-seconds", type=float, default=DEFAULT_CHORD_WINDOW_SECONDS)
    parser.add_argument("--pre-context-seconds", type=float, default=1.0)
    parser.add_argument("--post-context-seconds", type=float, default=1.5)
    parser.add_argument("--max-cases-per-kind", type=int, default=8)
    return parser.parse_args()


def select_case_plans(
    groups: tuple[MidiStrikeGroup, ...],
    spans: tuple[MidiNoteSpan, ...],
    *,
    max_cases_per_kind: int,
) -> tuple[dict[str, object], ...]:
    plans: list[dict[str, object]] = []
    for kind in CASE_ORDER:
        candidates = _candidate_plans_for_kind(kind, groups, spans)
        plans.extend(candidates[:max_cases_per_kind])
    return tuple(plans)


def _candidate_plans_for_kind(
    kind: str,
    groups: tuple[MidiStrikeGroup, ...],
    spans: tuple[MidiNoteSpan, ...],
) -> list[dict[str, object]]:
    plans: list[dict[str, object]] = []
    for index, group in enumerate(groups):
        if group.seconds < 1.0:
            continue
        if kind == "correct_strike" and len(group.midi_notes) == 1:
            plans.append(_plan(kind, index, (group,), (group.pitches,), 1, "Single-note positive."))
        elif kind == "wrong_semitone" and len(group.midi_notes) == 1:
            expected = (_nearby_pitch(group.midi_notes[0], semitone_delta=-1),)
            if expected != group.pitches:
                plans.append(
                    _plan(
                        kind,
                        index,
                        (group,),
                        (expected,),
                        0,
                        "Counterfactual expected pitch is one semitone away from the real strike.",
                    )
                )
        elif kind == "wrong_octave" and len(group.midi_notes) == 1:
            expected = (_nearby_pitch(group.midi_notes[0], octave_delta=-1),)
            if expected != group.pitches:
                plans.append(
                    _plan(
                        kind,
                        index,
                        (group,),
                        (expected,),
                        0,
                        "Counterfactual expected pitch is one octave away from the real strike.",
                    )
                )
        elif kind == "correct_chord" and 2 <= len(group.midi_notes) <= 4:
            plans.append(_plan(kind, index, (group,), (group.pitches,), 1, "Chord positive."))
        elif kind == "missing_chord_tone" and len(group.midi_notes) == 1:
            added = _nearby_pitch(group.midi_notes[0], semitone_delta=4)
            plans.append(
                _plan(
                    kind,
                    index,
                    (group,),
                    (tuple(dict.fromkeys((*group.pitches, added))),),
                    0,
                    "Real audio contains one strike; expected chord adds a missing tone.",
                )
            )
        elif kind == "sustain_tail_without_retrigger":
            tail_pitch = _long_sounding_pitch_without_retrigger(group, groups, spans)
            if tail_pitch is not None:
                plans.append(
                    _plan(
                        kind,
                        index,
                        (group,),
                        (group.pitches, (tail_pitch,)),
                        1,
                        "Second expected target is presented over a real strike tail with no same-pitch MIDI retrigger.",
                    )
                )
        elif kind == "same_note_retrigger" and len(group.midi_notes) == 1:
            next_index = _next_same_pitch_group_index(index, groups)
            if next_index is not None:
                next_group = groups[next_index]
                plans.append(
                    _plan(
                        kind,
                        index,
                        (group, next_group),
                        (group.pitches, next_group.pitches),
                        2,
                        "Two same-pitch MIDI note-ons in real continuous audio.",
                        target_indices=(index, next_index),
                    )
                )
    return plans


def _plan(
    kind: str,
    index: int,
    actual_groups: tuple[MidiStrikeGroup, ...],
    expected_groups: tuple[tuple[str, ...], ...],
    expected_advances: int,
    note: str,
    *,
    target_indices: tuple[int, ...] | None = None,
) -> dict[str, object]:
    return {
        "kind": kind,
        "target_indices": target_indices or (index,),
        "actual_groups": actual_groups,
        "expected_groups": expected_groups,
        "expected_advances": expected_advances,
        "diagnostic_note": note,
    }


def _long_sounding_pitch_without_retrigger(
    group: MidiStrikeGroup,
    groups: tuple[MidiStrikeGroup, ...],
    spans: tuple[MidiNoteSpan, ...],
) -> str | None:
    start = group.seconds
    for note in group.midi_notes:
        same_pitch_retrigger = any(
            later.seconds > start + 0.08
            and later.seconds <= start + 1.2
            and note in later.midi_notes
            for later in groups
        )
        if same_pitch_retrigger:
            continue
        for span in spans:
            if (
                span.midi_note == note
                and abs(span.start_seconds - start) <= 0.04
                and span.end_seconds is not None
                and span.end_seconds - span.start_seconds >= 0.6
            ):
                return span.pitch
    return None


def _next_same_pitch_group_index(index: int, groups: tuple[MidiStrikeGroup, ...]) -> int | None:
    group = groups[index]
    note = group.midi_notes[0]
    for next_index in range(index + 1, len(groups)):
        later = groups[next_index]
        delta = later.seconds - group.seconds
        if delta > 1.5:
            return None
        if delta >= 0.25 and len(later.midi_notes) == 1 and later.midi_notes[0] == note:
            return next_index
    return None


def export_cases(
    plans: tuple[dict[str, object], ...],
    *,
    audio: np.ndarray,
    spans: tuple[MidiNoteSpan, ...],
    pedal_events: tuple[PedalEvent, ...],
    audio_path: Path,
    midi_path: Path,
    output_dir: Path,
    dataset_id: str,
    pre_context_seconds: float,
    post_context_seconds: float,
    sample_rate: int,
) -> tuple[ExtractedCase, ...]:
    output_dir.mkdir(parents=True, exist_ok=True)
    clips_dir = output_dir / "clips"
    clips_dir.mkdir(parents=True, exist_ok=True)
    cases: list[ExtractedCase] = []
    kind_counts: dict[str, int] = {}
    duration_seconds = audio.size / sample_rate
    for plan in plans:
        kind = str(plan["kind"])
        kind_counts[kind] = kind_counts.get(kind, 0) + 1
        actual_groups = tuple(plan["actual_groups"])
        target_indices = tuple(int(index) for index in plan["target_indices"])
        start_seconds = max(0.0, min(group.seconds for group in actual_groups) - pre_context_seconds)
        end_seconds = min(duration_seconds, max(group.seconds for group in actual_groups) + post_context_seconds)
        start_sample = int(round(start_seconds * sample_rate))
        end_sample = int(round(end_seconds * sample_rate))
        clip = audio[start_sample:end_sample]
        case_id = f"{kind}_{kind_counts[kind]:03d}"
        clip_name = f"{case_id}.wav"
        write_pcm16_wav(clips_dir / clip_name, clip, sample_rate=sample_rate)
        cases.append(
            ExtractedCase(
                case_id=case_id,
                case_kind=kind,
                audio_path=str(Path("clips") / clip_name),
                expected_groups=tuple(plan["expected_groups"]),
                expected_advances=int(plan["expected_advances"]),
                actual_groups=tuple(group.pitches for group in actual_groups),
                source_dataset=dataset_id,
                source_file=str(audio_path),
                source_midi=str(midi_path),
                source_audio_sha256=_file_sha256(audio_path),
                source_midi_sha256=_file_sha256(midi_path),
                source_time_range_seconds=(round(start_seconds, 4), round(end_seconds, 4)),
                target_group_indices=target_indices,
                target_group_seconds=tuple(round(group.seconds, 4) for group in actual_groups),
                ground_truth_note_events=_note_events_in_range(
                    spans,
                    start_seconds=start_seconds,
                    end_seconds=end_seconds,
                ),
                ground_truth_pedal_events=_pedal_events_in_range(
                    pedal_events,
                    start_seconds=start_seconds,
                    end_seconds=end_seconds,
                ),
                diagnostic_note=str(plan["diagnostic_note"]),
            )
        )
    return tuple(cases)


def parse_midi_note_spans_and_pedal(path: Path) -> tuple[tuple[MidiNoteSpan, ...], tuple[PedalEvent, ...]]:
    midi = mido.MidiFile(path)
    active: dict[tuple[int, int], list[tuple[float, int]]] = {}
    spans: list[MidiNoteSpan] = []
    pedals: list[PedalEvent] = []
    current_seconds = 0.0
    current_tempo = 500000
    for message in mido.merge_tracks(midi.tracks):
        current_seconds += mido.tick2second(message.time, midi.ticks_per_beat, current_tempo)
        if message.type == "set_tempo":
            current_tempo = int(message.tempo)
            continue
        if message.type == "control_change" and message.control == 64:
            pedals.append(PedalEvent(seconds=current_seconds, value=int(message.value), down=message.value >= 64))
        if message.type not in {"note_on", "note_off"}:
            continue
        key = (getattr(message, "channel", 0), int(message.note))
        if message.type == "note_on" and message.velocity > 0:
            active.setdefault(key, []).append((current_seconds, int(message.velocity)))
            continue
        starts = active.get(key)
        if not starts:
            continue
        start_seconds, velocity = starts.pop(0)
        spans.append(
            MidiNoteSpan(
                pitch=_midi_pitch_name(int(message.note)),
                midi_note=int(message.note),
                start_seconds=start_seconds,
                end_seconds=current_seconds,
                velocity=velocity,
            )
        )
    for (_channel, note), starts in active.items():
        for start_seconds, velocity in starts:
            spans.append(
                MidiNoteSpan(
                    pitch=_midi_pitch_name(int(note)),
                    midi_note=int(note),
                    start_seconds=start_seconds,
                    end_seconds=None,
                    velocity=velocity,
                )
            )
    return tuple(sorted(spans, key=lambda span: span.start_seconds)), tuple(pedals)


def _note_events_in_range(
    spans: tuple[MidiNoteSpan, ...],
    *,
    start_seconds: float,
    end_seconds: float,
) -> tuple[dict[str, object], ...]:
    return tuple(
        asdict(span)
        for span in spans
        if span.start_seconds < end_seconds and (span.end_seconds is None or span.end_seconds >= start_seconds)
    )


def _pedal_events_in_range(
    pedals: tuple[PedalEvent, ...],
    *,
    start_seconds: float,
    end_seconds: float,
) -> tuple[dict[str, object], ...]:
    return tuple(asdict(event) for event in pedals if start_seconds <= event.seconds <= end_seconds)


def _nearby_pitch(midi_note: int, *, semitone_delta: int = 0, octave_delta: int = 0) -> str:
    candidate = midi_note + semitone_delta + octave_delta * 12
    if candidate < 21:
        candidate = midi_note + abs(semitone_delta) + abs(octave_delta) * 12
    if candidate > 108:
        candidate = midi_note - abs(semitone_delta) - abs(octave_delta) * 12
    return _midi_pitch_name(candidate)


def write_pcm16_wav(path: Path, audio: np.ndarray, *, sample_rate: int) -> None:
    clipped = np.clip(audio, -1.0, 1.0)
    pcm = (clipped * 32767.0).astype("<i2")
    with wave.open(str(path), "wb") as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(sample_rate)
        wav_file.writeframes(pcm.tobytes())


if __name__ == "__main__":
    raise SystemExit(main())
