"""Compare STEP microphone acoustic frontends on frozen causal cases.

This diagnostic keeps Matchmaker startup out of the question by consuming the
warm-start production causal replay report. It does not modify production
progression and it does not score full transcription F1.
"""

from __future__ import annotations

import argparse
from collections import defaultdict
import json
from pathlib import Path
import statistics
import wave

import numpy as np

from evaluate_basic_pitch_activation_step_cases import (
    BasicPitchActivationProvider,
    MIDI_OFFSET,
)
from evaluate_score_conditioned_step_cases import (
    _evaluate_expected,
    _midi_note_name,
    _pitch_to_midi_note,
)


DEFAULT_HORIZON_SECONDS = 0.35
DEFAULT_ONSET_THRESHOLD = 0.5
DEFAULT_FRAME_THRESHOLD = 0.3


def main() -> int:
    args = parse_args()
    manifest = json.loads(args.case_manifest.read_text(encoding="utf-8"))
    production_report = json.loads(args.production_report.read_text(encoding="utf-8"))
    cases = tuple(manifest.get("cases", ()))

    production_summary = _production_frontend_summary(production_report)
    basic_pitch_summary = _basic_pitch_frontend_summary(
        cases,
        manifest_path=args.case_manifest,
        work_dir=args.work_dir,
        horizon_seconds=args.horizon_seconds,
        onset_threshold=args.onset_threshold,
        frame_threshold=args.frame_threshold,
        model_path=args.basic_pitch_model_path,
    )

    report = {
        "benchmark_scope": "step_microphone_frontend_causal_case_comparison",
        "constraints": {
            "startup_mode": "warm",
            "production_progression_modified": False,
            "matchmaker_startup_optimized": False,
            "full_transcription_f1": False,
            "basic_pitch_uses_raw_onset_frame_activation": True,
            "piano_specific_frontend_status": "not_integrated_in_repository",
        },
        "case_manifest": str(args.case_manifest),
        "production_report": str(args.production_report),
        "case_counts": dict(sorted(_case_counts(cases).items())),
        "frontends": {
            "production_fft_observer_warm": production_summary,
            "basic_pitch_raw_activation": basic_pitch_summary,
            "piano_specific_pretrained_onset_frame": {
                "status": "not_evaluated",
                "reason": (
                    "No repository script currently exposes a piano-specific "
                    "pretrained onset/frame frontend on the causal case manifest. "
                    "Do not compare it until the provider is integrated into this "
                    "same benchmark contract."
                ),
            },
        },
        "decision": _decision(production_summary, basic_pitch_summary),
    }

    text = json.dumps(report, ensure_ascii=False, indent=2)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(text + "\n", encoding="utf-8")
    print(text)
    return 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--case-manifest", type=Path, required=True)
    parser.add_argument("--production-report", type=Path, required=True)
    parser.add_argument("--output", type=Path, default=None)
    parser.add_argument("--work-dir", type=Path, required=True)
    parser.add_argument("--horizon-seconds", type=float, default=DEFAULT_HORIZON_SECONDS)
    parser.add_argument("--onset-threshold", type=float, default=DEFAULT_ONSET_THRESHOLD)
    parser.add_argument("--frame-threshold", type=float, default=DEFAULT_FRAME_THRESHOLD)
    parser.add_argument("--basic-pitch-model-path", type=Path, default=None)
    return parser.parse_args()


def _production_frontend_summary(report: dict[str, object]) -> dict[str, object]:
    if report.get("startup_mode") != "warm":
        raise ValueError("production report must use startup_mode=warm")
    results = tuple(report.get("results", ()))
    by_kind: dict[str, list[dict[str, object]]] = defaultdict(list)
    for result in results:
        kind = _result_kind(result)
        by_kind[kind].append(result)

    metrics = {
        "correct_single_acceptance": _rate(
            _accepted_production_case(result) for result in by_kind["correct_strike"]
        ),
        "correct_chord_complete_acceptance": _rate(
            _accepted_production_case(result) for result in by_kind["correct_chord"]
        ),
        "wrong_semitone_false_completion": _rate(
            _false_completed_production_case(result) for result in by_kind["wrong_semitone"]
        ),
        "wrong_octave_false_completion": _rate(
            _false_completed_production_case(result) for result in by_kind["wrong_octave"]
        ),
        "missing_note_false_completion": _rate(
            _false_completed_production_case(result) for result in by_kind["missing_chord_tone"]
        ),
        "retrigger_acceptance": _rate(
            _accepted_production_case(result) for result in by_kind["same_note_retrigger"]
        ),
    }
    return {
        "provider_id": "production_fft_observer_warm",
        "runtime_chain": report.get("recognition_chain"),
        "metrics": metrics,
        "case_count": len(results),
        "summary": report.get("summary"),
        "evidence_summary": {
            "target_onset_frame_evidence": "not_available_from_fft_runtime_report",
            "competitor_evidence": "not_available_from_fft_runtime_report",
            "observer_confidence": _production_confidence_summary(results),
        },
    }


def _accepted_production_case(result: dict[str, object]) -> bool:
    return int(result.get("actual_advances", 0)) >= int(result.get("expected_advances", 0))


def _false_completed_production_case(result: dict[str, object]) -> bool:
    return int(result.get("actual_advances", 0)) > int(result.get("expected_advances", 0))


def _production_confidence_summary(results: tuple[dict[str, object], ...]) -> dict[str, object]:
    values: list[float] = []
    for result in results:
        for attempt in result.get("attempts", ()) or ():
            confidence = attempt.get("observer_confidence")
            if isinstance(confidence, (int, float)):
                values.append(float(confidence))
    return _number_summary(values)


def _basic_pitch_frontend_summary(
    cases: tuple[dict[str, object], ...],
    *,
    manifest_path: Path,
    work_dir: Path,
    horizon_seconds: float,
    onset_threshold: float,
    frame_threshold: float,
    model_path: Path | None,
) -> dict[str, object]:
    provider = BasicPitchActivationProvider(model_path=model_path)
    work_dir.mkdir(parents=True, exist_ok=True)
    evaluations = [
        _evaluate_basic_pitch_case(
            case,
            manifest_path=manifest_path,
            work_dir=work_dir,
            horizon_seconds=horizon_seconds,
            onset_threshold=onset_threshold,
            frame_threshold=frame_threshold,
            provider=provider,
        )
        for case in cases
    ]
    by_kind: dict[str, list[dict[str, object]]] = defaultdict(list)
    for evaluation in evaluations:
        by_kind[str(evaluation["case_kind"])].append(evaluation)

    metrics = {
        "correct_single_acceptance": _rate(
            bool(evaluation["accepted"]) for evaluation in by_kind["correct_strike"]
        ),
        "correct_chord_complete_acceptance": _rate(
            bool(evaluation["accepted"]) for evaluation in by_kind["correct_chord"]
        ),
        "wrong_semitone_false_completion": _rate(
            bool(evaluation["accepted"]) for evaluation in by_kind["wrong_semitone"]
        ),
        "wrong_octave_false_completion": _rate(
            bool(evaluation["accepted"]) for evaluation in by_kind["wrong_octave"]
        ),
        "missing_note_false_completion": _rate(
            bool(evaluation["accepted"]) for evaluation in by_kind["missing_chord_tone"]
        ),
        "retrigger_acceptance": _rate(
            bool(evaluation["accepted"]) for evaluation in by_kind["same_note_retrigger"]
        ),
    }
    return {
        "provider_id": "basic_pitch_raw_activation",
        "model_path": str(provider.model_path),
        "thresholds": {
            "onset": onset_threshold,
            "frame": frame_threshold,
            "horizon_seconds": horizon_seconds,
        },
        "metrics": metrics,
        "evidence_summary": _basic_pitch_evidence_summary(evaluations),
        "evaluations": evaluations,
    }


def _evaluate_basic_pitch_case(
    case: dict[str, object],
    *,
    manifest_path: Path,
    work_dir: Path,
    horizon_seconds: float,
    onset_threshold: float,
    frame_threshold: float,
    provider: BasicPitchActivationProvider,
) -> dict[str, object]:
    audio_path = _case_audio_path(case, manifest_path=manifest_path)
    audio, sample_rate = _read_wav(audio_path)
    source_start = float((case.get("source_time_range_seconds") or (0.0,))[0])
    target_seconds = tuple(float(value) for value in case.get("target_group_seconds", ()))
    expected_groups = tuple(tuple(group) for group in case.get("expected_groups", ()))
    if len(target_seconds) < len(expected_groups):
        target_seconds = tuple(source_start + 1.0 for _ in expected_groups)

    group_results = []
    observed_groups = []
    for index, expected_pitches in enumerate(expected_groups):
        target_second = target_seconds[index]
        relative_target = max(0.0, target_second - source_start)
        clip_end_seconds = min(audio.size / sample_rate, relative_target + horizon_seconds)
        clip_audio = audio[: int(round(clip_end_seconds * sample_rate))]
        clip_path = (
            work_dir
            / "basic_pitch_causal_clips"
            / f"{case['case_id']}_g{index + 1:02d}_h{_safe_float(horizon_seconds)}.wav"
        )
        _write_wav(clip_path, clip_audio, sample_rate=sample_rate)
        raw_output = provider.predict(clip_path)
        prediction = _activation_prediction(
            raw_output,
            expected_pitches=expected_pitches,
            clip_start_seconds=source_start,
            decision_start_seconds=target_second,
            decision_end_seconds=target_second + horizon_seconds,
            onset_threshold=onset_threshold,
            frame_threshold=frame_threshold,
        )
        observed = tuple(
            pitch for pitch, evidence in prediction["expected_evidence"].items() if evidence["accepted"]
        )
        result, matched, missing, extra = _evaluate_expected(expected_pitches, observed)
        group_results.append(
            {
                "group_index": index,
                "target_second": round(target_second, 6),
                "expected_pitches": expected_pitches,
                "observed_pitches": observed,
                "result": result,
                "matched_expected": matched,
                "missing_expected": missing,
                "extra_observed": extra,
                "expected_evidence": prediction["expected_evidence"],
                "competitor_evidence": prediction["competitor_evidence"],
                "chord_summary": prediction["chord_summary"],
            }
        )
        observed_groups.append(observed)

    expected_advances = int(case.get("expected_advances", 0))
    matched_groups = sum(1 for group in group_results if group["result"] == "MATCH")
    if expected_advances == 0:
        accepted = matched_groups > 0
    else:
        accepted = matched_groups >= expected_advances
    return {
        "case_id": case.get("case_id"),
        "case_kind": case.get("case_kind"),
        "expected_advances": expected_advances,
        "matched_groups": matched_groups,
        "accepted": accepted,
        "group_results": group_results,
        "observed_groups": observed_groups,
    }


def _activation_prediction(
    raw_output: dict[str, np.ndarray],
    *,
    expected_pitches: tuple[str, ...],
    clip_start_seconds: float,
    decision_start_seconds: float,
    decision_end_seconds: float,
    onset_threshold: float,
    frame_threshold: float,
) -> dict[str, object]:
    from basic_pitch.note_creation import model_frames_to_time

    onsets = raw_output["onset"]
    notes = raw_output["note"]
    frame_times = model_frames_to_time(onsets.shape[0]) + clip_start_seconds
    frame_mask = (frame_times >= decision_start_seconds) & (
        frame_times <= decision_end_seconds
    )
    if not np.any(frame_mask):
        frame_mask = np.ones_like(frame_times, dtype=bool)

    expected_evidence = {
        pitch: _pitch_evidence(
            onsets,
            notes,
            frame_mask=frame_mask,
            pitch=pitch,
            onset_threshold=onset_threshold,
            frame_threshold=frame_threshold,
        )
        for pitch in expected_pitches
    }
    competitor_evidence = {
        pitch: {
            "-12": _pitch_evidence(
                onsets,
                notes,
                frame_mask=frame_mask,
                pitch=_transpose_pitch(pitch, -12),
                onset_threshold=onset_threshold,
                frame_threshold=frame_threshold,
            ),
            "-1": _pitch_evidence(
                onsets,
                notes,
                frame_mask=frame_mask,
                pitch=_transpose_pitch(pitch, -1),
                onset_threshold=onset_threshold,
                frame_threshold=frame_threshold,
            ),
            "+1": _pitch_evidence(
                onsets,
                notes,
                frame_mask=frame_mask,
                pitch=_transpose_pitch(pitch, 1),
                onset_threshold=onset_threshold,
                frame_threshold=frame_threshold,
            ),
            "+12": _pitch_evidence(
                onsets,
                notes,
                frame_mask=frame_mask,
                pitch=_transpose_pitch(pitch, 12),
                onset_threshold=onset_threshold,
                frame_threshold=frame_threshold,
            ),
        }
        for pitch in expected_pitches
    }
    onset_values = [float(evidence["onset_activation"]) for evidence in expected_evidence.values()]
    frame_values = [float(evidence["frame_activation"]) for evidence in expected_evidence.values()]
    return {
        "expected_evidence": expected_evidence,
        "competitor_evidence": competitor_evidence,
        "chord_summary": {
            "target_onset_min": _round_or_none(min(onset_values) if onset_values else None),
            "target_onset_median": _round_or_none(
                statistics.median(onset_values) if onset_values else None
            ),
            "target_onset_spread": _round_or_none(
                max(onset_values) - min(onset_values) if onset_values else None
            ),
            "target_frame_min": _round_or_none(min(frame_values) if frame_values else None),
            "target_frame_median": _round_or_none(
                statistics.median(frame_values) if frame_values else None
            ),
            "target_frame_spread": _round_or_none(
                max(frame_values) - min(frame_values) if frame_values else None
            ),
        },
    }


def _pitch_evidence(
    onsets: np.ndarray,
    notes: np.ndarray,
    *,
    frame_mask: np.ndarray,
    pitch: str | None,
    onset_threshold: float,
    frame_threshold: float,
) -> dict[str, object]:
    if pitch is None:
        return {
            "pitch": None,
            "onset_activation": None,
            "frame_activation": None,
            "accepted": False,
        }
    midi_note = _pitch_to_midi_note(pitch)
    pitch_index = midi_note - MIDI_OFFSET
    if pitch_index < 0 or pitch_index >= onsets.shape[1]:
        return {
            "pitch": pitch,
            "onset_activation": None,
            "frame_activation": None,
            "accepted": False,
        }
    onset_max = float(np.max(onsets[frame_mask, pitch_index]))
    frame_max = float(np.max(notes[frame_mask, pitch_index]))
    return {
        "pitch": pitch,
        "onset_activation": round(onset_max, 6),
        "frame_activation": round(frame_max, 6),
        "accepted": onset_max >= onset_threshold and frame_max >= frame_threshold,
    }


def _basic_pitch_evidence_summary(evaluations: list[dict[str, object]]) -> dict[str, object]:
    target_onsets: list[float] = []
    target_frames: list[float] = []
    competitor_values: dict[str, dict[str, list[float]]] = {
        "-12": {"onset": [], "frame": []},
        "-1": {"onset": [], "frame": []},
        "+1": {"onset": [], "frame": []},
        "+12": {"onset": [], "frame": []},
    }
    chord_onset_mins: list[float] = []
    chord_onset_spreads: list[float] = []
    chord_frame_mins: list[float] = []
    chord_frame_spreads: list[float] = []
    for evaluation in evaluations:
        for group in evaluation["group_results"]:
            for evidence in group["expected_evidence"].values():
                _append_number(target_onsets, evidence.get("onset_activation"))
                _append_number(target_frames, evidence.get("frame_activation"))
            for by_pitch in group["competitor_evidence"].values():
                for offset, evidence in by_pitch.items():
                    _append_number(competitor_values[offset]["onset"], evidence.get("onset_activation"))
                    _append_number(competitor_values[offset]["frame"], evidence.get("frame_activation"))
            expected_count = len(group["expected_pitches"])
            if expected_count > 1:
                summary = group["chord_summary"]
                _append_number(chord_onset_mins, summary.get("target_onset_min"))
                _append_number(chord_onset_spreads, summary.get("target_onset_spread"))
                _append_number(chord_frame_mins, summary.get("target_frame_min"))
                _append_number(chord_frame_spreads, summary.get("target_frame_spread"))
    return {
        "target_onset": _number_summary(target_onsets),
        "target_frame": _number_summary(target_frames),
        "competitors": {
            offset: {
                "onset": _number_summary(values["onset"]),
                "frame": _number_summary(values["frame"]),
            }
            for offset, values in competitor_values.items()
        },
        "chord": {
            "target_onset_min": _number_summary(chord_onset_mins),
            "target_onset_spread": _number_summary(chord_onset_spreads),
            "target_frame_min": _number_summary(chord_frame_mins),
            "target_frame_spread": _number_summary(chord_frame_spreads),
        },
    }


def _decision(
    production_summary: dict[str, object],
    basic_pitch_summary: dict[str, object],
) -> dict[str, object]:
    production_metrics = production_summary["metrics"]
    basic_metrics = basic_pitch_summary["metrics"]
    return {
        "correct_chord_failure_mainly_fft_observer": (
            production_metrics["correct_chord_complete_acceptance"]["accepted"] == 0
        ),
        "basic_pitch_improves_chord_recall": (
            basic_metrics["correct_chord_complete_acceptance"]["rate"]
            is not None
            and production_metrics["correct_chord_complete_acceptance"]["rate"]
            is not None
            and basic_metrics["correct_chord_complete_acceptance"]["rate"]
            > production_metrics["correct_chord_complete_acceptance"]["rate"]
        ),
        "basic_pitch_keeps_negative_safety": all(
            (basic_metrics[key]["accepted"] == 0)
            for key in (
                "wrong_semitone_false_completion",
                "wrong_octave_false_completion",
                "missing_note_false_completion",
            )
        ),
        "piano_specific_frontend_comparison_ready": False,
        "recommended_next_step": (
            "Run this same causal-case contract against a piano-specific "
            "pretrained onset/frame provider before choosing calibration or a "
            "tiny target-conditioned strike verifier."
        ),
    }


def _case_counts(cases: tuple[dict[str, object], ...]) -> dict[str, int]:
    counts: dict[str, int] = defaultdict(int)
    for case in cases:
        counts[str(case.get("case_kind"))] += 1
    return counts


def _result_kind(result: dict[str, object]) -> str:
    metadata = result.get("source_metadata")
    if isinstance(metadata, dict):
        return str(metadata.get("case_kind", result.get("case_id")))
    return str(result.get("case_id"))


def _case_audio_path(case: dict[str, object], *, manifest_path: Path) -> Path:
    audio_path = Path(str(case["audio_path"]))
    if audio_path.is_absolute():
        return audio_path
    candidate = manifest_path.parent / audio_path
    if candidate.exists():
        return candidate
    return Path.cwd() / audio_path


def _read_wav(path: Path) -> tuple[np.ndarray, int]:
    with wave.open(str(path), "rb") as wav_file:
        channels = wav_file.getnchannels()
        sample_width = wav_file.getsampwidth()
        sample_rate = wav_file.getframerate()
        frames = wav_file.readframes(wav_file.getnframes())
    if sample_width != 2:
        raise ValueError(f"Only PCM16 WAV is supported: {path}")
    pcm = np.frombuffer(frames, dtype="<i2").astype(np.float32) / 32768.0
    if channels > 1:
        pcm = pcm.reshape(-1, channels).mean(axis=1)
    return pcm, sample_rate


def _write_wav(path: Path, audio: np.ndarray, *, sample_rate: int) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    pcm = (np.clip(audio, -1.0, 1.0) * 32767.0).astype("<i2")
    with wave.open(str(path), "wb") as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(sample_rate)
        wav_file.writeframes(pcm.tobytes())


def _transpose_pitch(pitch: str, semitones: int) -> str | None:
    midi_note = _pitch_to_midi_note(pitch) + semitones
    if midi_note < MIDI_OFFSET or midi_note >= MIDI_OFFSET + 88:
        return None
    return _midi_note_name(midi_note)


def _rate(values: object) -> dict[str, object]:
    value_list = [bool(value) for value in values]
    if not value_list:
        return {"accepted": 0, "total": 0, "rate": None}
    accepted = sum(1 for value in value_list if value)
    return {"accepted": accepted, "total": len(value_list), "rate": round(accepted / len(value_list), 4)}


def _append_number(values: list[float], value: object) -> None:
    if isinstance(value, (int, float)):
        values.append(float(value))


def _number_summary(values: list[float]) -> dict[str, object]:
    if not values:
        return {"count": 0, "min": None, "median": None, "max": None}
    return {
        "count": len(values),
        "min": _round_or_none(min(values)),
        "median": _round_or_none(statistics.median(values)),
        "max": _round_or_none(max(values)),
    }


def _round_or_none(value: float | None) -> float | None:
    return None if value is None else round(float(value), 6)


def _safe_float(value: float) -> str:
    return str(value).replace(".", "p")


if __name__ == "__main__":
    raise SystemExit(main())
