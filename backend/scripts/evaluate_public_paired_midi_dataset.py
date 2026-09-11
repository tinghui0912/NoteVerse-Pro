"""Evaluate acoustic pitch observation against a public paired WAV+MIDI recording.

This script is intentionally separate from the score-following replay benchmark.
Public paired datasets such as MAESTRO provide physical MIDI truth synchronized
with the acoustic recording, but they do not provide the app's MusicXML score
timeline. This benchmark therefore measures only acoustic observation quality
against same-performance MIDI note-on truth.
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass
from datetime import UTC, datetime
import hashlib
import json
from pathlib import Path
import struct
import wave

import numpy as np

from app.processing.engines.practice_alignment.acoustic_event_observation import (
    AcousticEventObserver,
    AcousticEventObservationProfile,
)


DEFAULT_SAMPLE_RATE = 16000
DEFAULT_WINDOW_SECONDS = 0.35
DEFAULT_CHORD_WINDOW_SECONDS = 0.05
DEFAULT_MAX_GROUPS = 120
BENCHMARK_SCOPE_PAIRED_MIDI_ORACLE_ONSET = "paired_midi_oracle_onset_window"
DENSE_PASSAGE_WINDOW_SECONDS = 1.0
DENSE_PASSAGE_MIN_GROUPS = 8
REPEATED_PITCH_WINDOW_SECONDS = 0.75
DEFAULT_GROUPS_PER_BUCKET = 20
BUCKET_ORDER = (
    "single_note",
    "dyad",
    "triad",
    "four_plus_note_chord",
    "octave",
    "repeated_pitch_context",
    "dense_passage",
)

_PITCH_CLASSES = ("C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B")


@dataclass(frozen=True)
class MidiNoteOn:
    seconds: float
    pitch: str
    midi_note: int


@dataclass(frozen=True)
class MidiStrikeGroup:
    seconds: float
    pitches: tuple[str, ...]
    midi_notes: tuple[int, ...]


def main() -> int:
    args = parse_args()
    audio = read_pcm_wav(args.audio, sample_rate=args.sample_rate)
    notes = parse_midi_note_ons(args.midi)
    groups = group_note_ons(notes, chord_window_seconds=args.chord_window_seconds)
    groups = tuple(
        group
        for group in groups
        if group.seconds + args.window_seconds <= audio.size / args.sample_rate
    )
    all_group_count = len(groups)
    all_group_buckets = classify_groups(groups)
    if args.selection_manifest:
        manifest = load_selection_manifest(args.selection_manifest)
        groups, group_buckets, selection = select_groups_from_manifest(
            groups,
            all_group_buckets,
            manifest=manifest,
            manifest_path=args.selection_manifest,
        )
    else:
        groups, group_buckets, selection = select_groups(
            groups,
            all_group_buckets,
            mode=args.selection_mode,
            max_groups=args.max_groups,
            groups_per_bucket=args.groups_per_bucket,
        )

    observer = AcousticEventObserver(
        AcousticEventObservationProfile(max_frequency_candidates=args.max_frequency_candidates)
    )
    evaluations = evaluate_groups(
        audio,
        groups=groups,
        group_buckets=group_buckets,
        observer=observer,
        sample_rate=args.sample_rate,
        window_seconds=args.window_seconds,
    )
    report = build_report(
        audio_path=args.audio,
        midi_path=args.midi,
        dataset_id=args.dataset_id,
        dataset_version=args.dataset_version,
        official_split=args.official_split,
        recording_id=args.recording_id,
        audio=audio,
        groups=groups,
        group_buckets=group_buckets,
        evaluations=evaluations,
        sample_rate=args.sample_rate,
        window_seconds=args.window_seconds,
        chord_window_seconds=args.chord_window_seconds,
        source_group_count=all_group_count,
        selection=selection,
        observer_id="dominant_fft_baseline"
        if args.max_frequency_candidates == 1
        else f"fft_top_{args.max_frequency_candidates}_candidates",
    )

    text = json.dumps(report, ensure_ascii=False, indent=2)
    if args.write_selection_manifest:
        manifest = build_selection_manifest(
            audio_path=args.audio,
            midi_path=args.midi,
            dataset_id=args.dataset_id,
            dataset_version=args.dataset_version,
            official_split=args.official_split,
            recording_id=args.recording_id,
            groups=groups,
            group_buckets=group_buckets,
            all_groups=tuple(
                group
                for group in group_note_ons(
                    notes,
                    chord_window_seconds=args.chord_window_seconds,
                )
                if group.seconds + args.window_seconds <= audio.size / args.sample_rate
            ),
            sample_rate=args.sample_rate,
            window_seconds=args.window_seconds,
            chord_window_seconds=args.chord_window_seconds,
            selection=selection,
        )
        args.write_selection_manifest.parent.mkdir(parents=True, exist_ok=True)
        args.write_selection_manifest.write_text(
            json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(text + "\n", encoding="utf-8")
    print(text)
    return 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--audio", type=Path, required=True)
    parser.add_argument("--midi", type=Path, required=True)
    parser.add_argument("--output", type=Path, default=None)
    parser.add_argument("--sample-rate", type=int, default=DEFAULT_SAMPLE_RATE)
    parser.add_argument("--dataset-id", default=None)
    parser.add_argument("--dataset-version", default=None)
    parser.add_argument("--official-split", default=None)
    parser.add_argument("--recording-id", default=None)
    parser.add_argument("--window-seconds", type=float, default=DEFAULT_WINDOW_SECONDS)
    parser.add_argument(
        "--chord-window-seconds",
        type=float,
        default=DEFAULT_CHORD_WINDOW_SECONDS,
    )
    parser.add_argument("--max-groups", type=int, default=DEFAULT_MAX_GROUPS)
    parser.add_argument(
        "--selection-mode",
        choices=("prefix", "balanced"),
        default="prefix",
        help=(
            "prefix evaluates the first max-groups MIDI strike groups; balanced samples "
            "up to groups-per-bucket from each musical bucket, then restores score order."
        ),
    )
    parser.add_argument(
        "--groups-per-bucket",
        type=int,
        default=DEFAULT_GROUPS_PER_BUCKET,
        help="Maximum groups to select per bucket when --selection-mode balanced is used.",
    )
    parser.add_argument(
        "--selection-manifest",
        type=Path,
        default=None,
        help="Frozen selection manifest to evaluate. Overrides --selection-mode.",
    )
    parser.add_argument(
        "--write-selection-manifest",
        type=Path,
        default=None,
        help="Write the selected MIDI strike groups to a frozen selection manifest.",
    )
    parser.add_argument("--max-frequency-candidates", type=int, default=1)
    return parser.parse_args()


def read_pcm_wav(path: Path, *, sample_rate: int) -> np.ndarray:
    with wave.open(str(path), "rb") as wav_file:
        channels = wav_file.getnchannels()
        sample_width = wav_file.getsampwidth()
        source_rate = wav_file.getframerate()
        frames = wav_file.readframes(wav_file.getnframes())

    if sample_width != 2:
        raise ValueError(f"Expected 16-bit PCM WAV: {path}")
    audio = np.frombuffer(frames, dtype="<i2").astype(np.float32) / 32768.0
    if channels > 1:
        audio = audio.reshape(-1, channels).mean(axis=1)
    if source_rate == sample_rate:
        return audio
    return resample_audio(audio, source_rate=source_rate, target_rate=sample_rate)


def resample_audio(
    audio: np.ndarray,
    *,
    source_rate: int,
    target_rate: int,
) -> np.ndarray:
    if source_rate <= 0 or target_rate <= 0:
        raise ValueError("WAV sample rates must be positive")
    if audio.size == 0:
        return audio.astype(np.float32, copy=False)
    source_times = np.arange(audio.size, dtype=np.float64) / source_rate
    target_size = int(round(audio.size * target_rate / source_rate))
    target_times = np.arange(target_size, dtype=np.float64) / target_rate
    return np.interp(target_times, source_times, audio).astype(np.float32)


def parse_midi_note_ons(path: Path) -> tuple[MidiNoteOn, ...]:
    data = path.read_bytes()
    cursor = 0
    if data[cursor : cursor + 4] != b"MThd":
        raise ValueError(f"Invalid MIDI header: {path}")
    cursor += 4
    header_length = _read_u32(data, cursor)
    cursor += 4
    header = data[cursor : cursor + header_length]
    cursor += header_length
    if len(header) < 6:
        raise ValueError(f"Invalid MIDI header length: {path}")
    _, track_count, division = struct.unpack(">HHH", header[:6])
    if division & 0x8000:
        raise ValueError("SMPTE MIDI time division is not supported")

    tempo_events: list[tuple[int, int]] = [(0, 500_000)]
    note_events: list[tuple[int, int]] = []

    for _ in range(track_count):
        if data[cursor : cursor + 4] != b"MTrk":
            raise ValueError(f"Invalid MIDI track header at byte {cursor}")
        cursor += 4
        length = _read_u32(data, cursor)
        cursor += 4
        track = data[cursor : cursor + length]
        cursor += length
        track_tempos, track_notes = _parse_track(track)
        tempo_events.extend(track_tempos)
        note_events.extend(track_notes)

    tempo_events = sorted(set(tempo_events))
    return tuple(
        MidiNoteOn(
            seconds=_ticks_to_seconds(tick, tempo_events=tempo_events, ticks_per_quarter=division),
            pitch=_midi_pitch_name(note),
            midi_note=note,
        )
        for tick, note in sorted(note_events)
    )


def _parse_track(track: bytes) -> tuple[list[tuple[int, int]], list[tuple[int, int]]]:
    cursor = 0
    tick = 0
    running_status: int | None = None
    tempo_events: list[tuple[int, int]] = []
    note_events: list[tuple[int, int]] = []

    while cursor < len(track):
        delta, cursor = _read_vlq(track, cursor)
        tick += delta
        status = track[cursor]
        if status < 0x80:
            if running_status is None:
                raise ValueError("MIDI running status used before a status byte")
            status = running_status
        else:
            cursor += 1
            if status < 0xF0:
                running_status = status

        if status == 0xFF:
            meta_type = track[cursor]
            cursor += 1
            length, cursor = _read_vlq(track, cursor)
            payload = track[cursor : cursor + length]
            cursor += length
            if meta_type == 0x51 and length == 3:
                tempo_events.append((tick, int.from_bytes(payload, "big")))
            continue
        if status in {0xF0, 0xF7}:
            length, cursor = _read_vlq(track, cursor)
            cursor += length
            continue

        event_type = status & 0xF0
        data_length = 1 if event_type in {0xC0, 0xD0} else 2
        payload = track[cursor : cursor + data_length]
        cursor += data_length
        if event_type == 0x90 and len(payload) == 2 and payload[1] > 0:
            note_events.append((tick, payload[0]))

    return tempo_events, note_events


def _read_u32(data: bytes, cursor: int) -> int:
    return struct.unpack(">I", data[cursor : cursor + 4])[0]


def _read_vlq(data: bytes, cursor: int) -> tuple[int, int]:
    value = 0
    while True:
        byte = data[cursor]
        cursor += 1
        value = (value << 7) | (byte & 0x7F)
        if not byte & 0x80:
            return value, cursor


def _ticks_to_seconds(
    tick: int,
    *,
    tempo_events: list[tuple[int, int]],
    ticks_per_quarter: int,
) -> float:
    seconds = 0.0
    previous_tick = 0
    current_tempo = 500_000
    for tempo_tick, tempo in tempo_events:
        if tempo_tick > tick:
            break
        seconds += (tempo_tick - previous_tick) * current_tempo / ticks_per_quarter / 1_000_000
        previous_tick = tempo_tick
        current_tempo = tempo
    seconds += (tick - previous_tick) * current_tempo / ticks_per_quarter / 1_000_000
    return seconds


def _midi_pitch_name(midi_note: int) -> str:
    octave = midi_note // 12 - 1
    return f"{_PITCH_CLASSES[midi_note % 12]}{octave}"


def group_note_ons(
    notes: tuple[MidiNoteOn, ...],
    *,
    chord_window_seconds: float,
) -> tuple[MidiStrikeGroup, ...]:
    groups: list[MidiStrikeGroup] = []
    for note in notes:
        if groups and note.seconds - groups[-1].seconds <= chord_window_seconds:
            previous = groups[-1]
            pitches = tuple(dict.fromkeys((*previous.pitches, note.pitch)))
            midi_notes = tuple(sorted(set((*previous.midi_notes, note.midi_note))))
            groups[-1] = MidiStrikeGroup(
                seconds=previous.seconds,
                pitches=pitches,
                midi_notes=midi_notes,
            )
        else:
            groups.append(
                MidiStrikeGroup(
                    seconds=note.seconds,
                    pitches=(note.pitch,),
                    midi_notes=(note.midi_note,),
                )
            )
    return tuple(groups)


def evaluate_groups(
    audio: np.ndarray,
    *,
    groups: tuple[MidiStrikeGroup, ...],
    group_buckets: tuple[tuple[str, ...], ...],
    observer: AcousticEventObserver,
    sample_rate: int,
    window_seconds: float,
) -> list[dict[str, object]]:
    evaluations: list[dict[str, object]] = []
    window_samples = int(round(window_seconds * sample_rate))
    for group, buckets in zip(groups, group_buckets, strict=True):
        start = int(round(group.seconds * sample_rate))
        frame = audio[start : start + window_samples]
        observation = observer.observe_mono_pcm(
            frame,
            sample_rate=sample_rate,
            np_module=np,
        )
        expected = set(group.pitches)
        observed = set(observation.observed_pitches)
        evaluations.append(
            {
                "seconds": round(group.seconds, 3),
                "buckets": buckets,
                "expected_pitches": group.pitches,
                "observed_pitches": observation.observed_pitches,
                "confidence": observation.confidence,
                "matched_expected": tuple(pitch for pitch in group.pitches if pitch in observed),
                "missing_expected": tuple(pitch for pitch in group.pitches if pitch not in observed),
                "extra_observed": tuple(pitch for pitch in observation.observed_pitches if pitch not in expected),
            }
        )
    return evaluations


def build_report(
    *,
    audio_path: Path,
    midi_path: Path,
    dataset_id: str | None,
    dataset_version: str | None,
    official_split: str | None,
    recording_id: str | None,
    audio: np.ndarray,
    groups: tuple[MidiStrikeGroup, ...],
    group_buckets: tuple[tuple[str, ...], ...],
    evaluations: list[dict[str, object]],
    sample_rate: int,
    window_seconds: float,
    chord_window_seconds: float,
    source_group_count: int,
    selection: dict[str, object],
    observer_id: str,
) -> dict[str, object]:
    expected_count = sum(len(group.pitches) for group in groups)
    matched_count = sum(len(evaluation["matched_expected"]) for evaluation in evaluations)
    observed_count = sum(len(evaluation["observed_pitches"]) for evaluation in evaluations)
    extra_count = sum(len(evaluation["extra_observed"]) for evaluation in evaluations)
    chord_groups = [
        (group, evaluation)
        for group, evaluation in zip(groups, evaluations, strict=True)
        if len(group.pitches) > 1
    ]
    chord_complete_count = sum(
        1
        for group, evaluation in chord_groups
        if set(evaluation["matched_expected"]) == set(group.pitches)
    )
    uncertain_count = sum(1 for evaluation in evaluations if not evaluation["observed_pitches"])
    return {
        "dataset": {
            "ground_truth_source": "paired_midi",
            "dataset_id": dataset_id,
            "dataset_version": dataset_version,
            "official_split": official_split,
            "recording_id": recording_id,
            "audio_path": str(audio_path),
            "midi_path": str(midi_path),
            "audio_sha256": _file_sha256(audio_path),
            "midi_sha256": _file_sha256(midi_path),
        },
        "benchmark": {
            "benchmark_scope": BENCHMARK_SCOPE_PAIRED_MIDI_ORACLE_ONSET,
            "observer_id": observer_id,
            "onset_source": "paired_midi",
            "causal": False,
            "uses_future_context": True,
            "sample_rate_hz": sample_rate,
            "window_seconds": window_seconds,
            "chord_window_seconds": chord_window_seconds,
            "group_count": len(groups),
            "source_group_count": source_group_count,
            "selection": selection,
            "bucket_membership": "multi_label",
            "audio_duration_seconds": round(audio.size / sample_rate, 3),
        },
        "metrics": {
            "expected_strike_recall": _ratio(matched_count, expected_count),
            "expected_strike_precision": _ratio(matched_count, observed_count),
            "false_discovery_rate": _ratio(extra_count, observed_count),
            "exact_group_match_rate": _ratio(
                sum(
                    1
                    for group, evaluation in zip(groups, evaluations, strict=True)
                    if set(evaluation["observed_pitches"]) == set(group.pitches)
                ),
                len(groups),
            ),
            "chord_complete_detection_rate": _ratio(chord_complete_count, len(chord_groups)),
            "uncertain_rate": _ratio(uncertain_count, len(groups)),
            "matched_expected_count": matched_count,
            "expected_strike_count": expected_count,
            "observed_pitch_count": observed_count,
            "extra_observed_count": extra_count,
            "chord_group_count": len(chord_groups),
        },
        "metrics_by_bucket": bucket_metrics(groups, group_buckets, evaluations),
        "diagnostics": {
            "first_20_groups": evaluations[:20],
            "first_20_misses": [
                evaluation
                for evaluation in evaluations
                if evaluation["missing_expected"] or evaluation["extra_observed"]
            ][:20],
        },
    }


def build_selection_manifest(
    *,
    audio_path: Path,
    midi_path: Path,
    dataset_id: str | None,
    dataset_version: str | None,
    official_split: str | None,
    recording_id: str | None,
    groups: tuple[MidiStrikeGroup, ...],
    group_buckets: tuple[tuple[str, ...], ...],
    all_groups: tuple[MidiStrikeGroup, ...],
    sample_rate: int,
    window_seconds: float,
    chord_window_seconds: float,
    selection: dict[str, object],
) -> dict[str, object]:
    source_index_by_key = {
        _group_key(group): index
        for index, group in enumerate(all_groups)
    }
    return {
        "schema_version": 1,
        "created_at": datetime.now(UTC).isoformat(),
        "dataset": {
            "ground_truth_source": "paired_midi",
            "dataset_id": dataset_id,
            "dataset_version": dataset_version,
            "official_split": official_split,
            "recording_id": recording_id,
            "audio_path": str(audio_path),
            "midi_path": str(midi_path),
            "audio_sha256": _file_sha256(audio_path),
            "midi_sha256": _file_sha256(midi_path),
        },
        "benchmark": {
            "benchmark_scope": BENCHMARK_SCOPE_PAIRED_MIDI_ORACLE_ONSET,
            "onset_source": "paired_midi",
            "sample_rate_hz": sample_rate,
            "window_seconds": window_seconds,
            "chord_window_seconds": chord_window_seconds,
            "source_group_count": len(all_groups),
            "selection": selection,
            "bucket_membership": "multi_label",
        },
        "groups": [
            {
                "source_index": source_index_by_key[_group_key(group)],
                "seconds": round(group.seconds, 6),
                "truth_pitches": group.pitches,
                "midi_notes": group.midi_notes,
                "tags": buckets,
            }
            for group, buckets in zip(groups, group_buckets, strict=True)
        ],
    }


def load_selection_manifest(path: Path) -> dict[str, object]:
    manifest = json.loads(path.read_text(encoding="utf-8"))
    if manifest.get("schema_version") != 1:
        raise ValueError(f"Unsupported selection manifest schema_version: {path}")
    benchmark = manifest.get("benchmark", {})
    if benchmark.get("benchmark_scope") != BENCHMARK_SCOPE_PAIRED_MIDI_ORACLE_ONSET:
        raise ValueError(f"Unsupported selection manifest benchmark_scope: {path}")
    if benchmark.get("onset_source") != "paired_midi":
        raise ValueError(f"Unsupported selection manifest onset_source: {path}")
    return manifest


def select_groups_from_manifest(
    groups: tuple[MidiStrikeGroup, ...],
    group_buckets: tuple[tuple[str, ...], ...],
    *,
    manifest: dict[str, object],
    manifest_path: Path,
) -> tuple[tuple[MidiStrikeGroup, ...], tuple[tuple[str, ...], ...], dict[str, object]]:
    selected_groups: list[MidiStrikeGroup] = []
    selected_buckets: list[tuple[str, ...]] = []
    manifest_groups = manifest.get("groups")
    if not isinstance(manifest_groups, list):
        raise ValueError(f"Selection manifest has no groups list: {manifest_path}")
    for item in manifest_groups:
        if not isinstance(item, dict):
            raise ValueError(f"Invalid selection manifest group: {manifest_path}")
        source_index = item.get("source_index")
        if not isinstance(source_index, int) or source_index < 0 or source_index >= len(groups):
            raise ValueError(f"Selection manifest source_index is out of range: {source_index}")
        group = groups[source_index]
        expected_seconds = item.get("seconds")
        if not isinstance(expected_seconds, int | float):
            raise ValueError(f"Selection manifest group has no seconds: {source_index}")
        if abs(group.seconds - float(expected_seconds)) > 0.001:
            raise ValueError(f"Selection manifest seconds mismatch at source_index {source_index}")
        expected_pitches = tuple(item.get("truth_pitches", ()))
        if group.pitches != expected_pitches:
            raise ValueError(f"Selection manifest truth_pitches mismatch at source_index {source_index}")
        selected_groups.append(group)
        selected_buckets.append(group_buckets[source_index])
    return (
        tuple(selected_groups),
        tuple(selected_buckets),
        {
            "mode": "manifest",
            "manifest_path": str(manifest_path),
            "selected_group_count": len(selected_groups),
        },
    )


def select_groups(
    groups: tuple[MidiStrikeGroup, ...],
    group_buckets: tuple[tuple[str, ...], ...],
    *,
    mode: str,
    max_groups: int | None,
    groups_per_bucket: int,
) -> tuple[tuple[MidiStrikeGroup, ...], tuple[tuple[str, ...], ...], dict[str, object]]:
    if mode == "prefix":
        selected_count = len(groups) if max_groups is None else min(max_groups, len(groups))
        return (
            groups[:selected_count],
            group_buckets[:selected_count],
            {
                "mode": "prefix",
                "max_groups": max_groups,
                "selected_group_count": selected_count,
                "bucket_membership": "multi_label",
            },
        )
    if mode != "balanced":
        raise ValueError(f"Unsupported selection mode: {mode}")
    if groups_per_bucket <= 0:
        raise ValueError("groups_per_bucket must be positive for balanced selection")

    selected_indices: set[int] = set()
    selected_by_bucket: dict[str, int] = {}
    available_by_bucket: dict[str, int] = {}
    for bucket_name in BUCKET_ORDER:
        matching_indices = [
            index for index, buckets in enumerate(group_buckets) if bucket_name in buckets
        ]
        available_by_bucket[bucket_name] = len(matching_indices)
        added = 0
        for index in matching_indices:
            if index in selected_indices:
                continue
            selected_indices.add(index)
            added += 1
            if added >= groups_per_bucket:
                break
        selected_by_bucket[bucket_name] = added

    ordered_indices = sorted(selected_indices)
    if max_groups is not None:
        ordered_indices = ordered_indices[:max_groups]
    selected_groups = tuple(groups[index] for index in ordered_indices)
    selected_buckets = tuple(group_buckets[index] for index in ordered_indices)
    return (
        selected_groups,
        selected_buckets,
        {
            "mode": "balanced",
            "groups_per_bucket": groups_per_bucket,
            "max_groups": max_groups,
            "selected_group_count": len(selected_groups),
            "bucket_membership": "multi_label",
            "available_by_bucket": available_by_bucket,
            "selected_by_bucket": {
                bucket: sum(1 for buckets in selected_buckets if bucket in buckets)
                for bucket in BUCKET_ORDER
            },
            "unique_groups_added_by_bucket": selected_by_bucket,
        },
    )


def _group_key(group: MidiStrikeGroup) -> tuple[float, tuple[int, ...]]:
    return (round(group.seconds, 6), group.midi_notes)


def classify_groups(groups: tuple[MidiStrikeGroup, ...]) -> tuple[tuple[str, ...], ...]:
    classified: list[tuple[str, ...]] = []
    for index, group in enumerate(groups):
        buckets: list[str] = []
        pitch_count = len(group.pitches)
        if pitch_count == 1:
            buckets.append("single_note")
        elif pitch_count == 2:
            buckets.append("dyad")
        elif pitch_count == 3:
            buckets.append("triad")
        else:
            buckets.append("four_plus_note_chord")

        if _is_octave_group(group):
            buckets.append("octave")
        if _is_repeated_pitch_context(groups, index):
            buckets.append("repeated_pitch_context")
        if _is_dense_passage_context(groups, index):
            buckets.append("dense_passage")
        classified.append(tuple(buckets))
    return tuple(classified)


def bucket_metrics(
    groups: tuple[MidiStrikeGroup, ...],
    group_buckets: tuple[tuple[str, ...], ...],
    evaluations: list[dict[str, object]],
) -> dict[str, dict[str, object]]:
    bucket_names = sorted({bucket for buckets in group_buckets for bucket in buckets})
    return {
        bucket_name: _metrics_for_bucket(
            [
                (group, evaluation)
                for group, buckets, evaluation in zip(groups, group_buckets, evaluations, strict=True)
                if bucket_name in buckets
            ]
        )
        for bucket_name in bucket_names
    }


def _metrics_for_bucket(items: list[tuple[MidiStrikeGroup, dict[str, object]]]) -> dict[str, object]:
    expected_count = sum(len(group.pitches) for group, _ in items)
    matched_count = sum(len(evaluation["matched_expected"]) for _, evaluation in items)
    observed_count = sum(len(evaluation["observed_pitches"]) for _, evaluation in items)
    extra_count = sum(len(evaluation["extra_observed"]) for _, evaluation in items)
    chord_items = [(group, evaluation) for group, evaluation in items if len(group.pitches) > 1]
    chord_complete_count = sum(
        1
        for group, evaluation in chord_items
        if set(evaluation["matched_expected"]) == set(group.pitches)
    )
    uncertain_count = sum(1 for _, evaluation in items if not evaluation["observed_pitches"])
    return {
        "group_count": len(items),
        "expected_strike_recall": _ratio(matched_count, expected_count),
        "expected_strike_precision": _ratio(matched_count, observed_count),
        "false_discovery_rate": _ratio(extra_count, observed_count),
        "exact_group_match_rate": _ratio(
            sum(
                1
                for group, evaluation in items
                if set(evaluation["observed_pitches"]) == set(group.pitches)
            ),
            len(items),
        ),
        "chord_complete_detection_rate": _ratio(chord_complete_count, len(chord_items)),
        "uncertain_rate": _ratio(uncertain_count, len(items)),
    }


def _is_octave_group(group: MidiStrikeGroup) -> bool:
    pitch_classes: dict[int, int] = {}
    for midi_note in group.midi_notes:
        pitch_class = midi_note % 12
        if pitch_class in pitch_classes and abs(midi_note - pitch_classes[pitch_class]) >= 12:
            return True
        pitch_classes[pitch_class] = midi_note
    return False


def _is_repeated_pitch_context(groups: tuple[MidiStrikeGroup, ...], index: int) -> bool:
    current = groups[index]
    current_pitches = set(current.pitches)
    for other_index in (index - 1, index + 1):
        if other_index < 0 or other_index >= len(groups):
            continue
        other = groups[other_index]
        if abs(other.seconds - current.seconds) <= REPEATED_PITCH_WINDOW_SECONDS:
            if current_pitches.intersection(other.pitches):
                return True
    return False


def _is_dense_passage_context(groups: tuple[MidiStrikeGroup, ...], index: int) -> bool:
    current = groups[index]
    nearby_count = sum(
        1
        for group in groups
        if abs(group.seconds - current.seconds) <= DENSE_PASSAGE_WINDOW_SECONDS / 2
    )
    return nearby_count >= DENSE_PASSAGE_MIN_GROUPS


def _ratio(numerator: int, denominator: int) -> float | None:
    if denominator <= 0:
        return None
    return round(numerator / denominator, 4)


def _file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as file:
        for chunk in iter(lambda: file.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


if __name__ == "__main__":
    raise SystemExit(main())
