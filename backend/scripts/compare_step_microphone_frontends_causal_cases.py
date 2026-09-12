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
from typing import Callable
import wave

import numpy as np


DEFAULT_HORIZON_SECONDS = 0.35
DEFAULT_LOCAL_PRE_SECONDS = 0.05
DEFAULT_LOCAL_POST_SECONDS = 0.12
DEFAULT_ONSET_THRESHOLD = 0.5
DEFAULT_FRAME_THRESHOLD = 0.3
DEFAULT_BYTEDANCE_ONSET_THRESHOLD = 0.3
DEFAULT_BYTEDANCE_FRAME_THRESHOLD = 0.1
ONSET_PEAK_FRAME_NEIGHBORHOOD_SECONDS = 0.03
LOCAL_WINDOW_BOUNDARY_BAND_SECONDS = 0.01
MIDI_OFFSET = 21
_PITCH_CLASSES = ("C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B")


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
        local_pre_seconds=args.local_pre_seconds,
        local_post_seconds=args.local_post_seconds,
        onset_threshold=args.onset_threshold,
        frame_threshold=args.frame_threshold,
        model_path=args.basic_pitch_model_path,
    )
    bytedance_summary = _bytedance_frontend_summary(
        cases,
        manifest_path=args.case_manifest,
        work_dir=args.work_dir,
        horizon_seconds=args.horizon_seconds,
        local_pre_seconds=args.local_pre_seconds,
        local_post_seconds=args.local_post_seconds,
        onset_threshold=args.bytedance_onset_threshold,
        frame_threshold=args.bytedance_frame_threshold,
        checkpoint_path=args.bytedance_checkpoint_path,
        device=args.bytedance_device,
    )

    report = {
        "benchmark_scope": "step_microphone_frontend_causal_case_comparison",
        "constraints": {
            "startup_mode": "warm",
            "production_progression_modified": False,
            "matchmaker_startup_optimized": False,
            "full_transcription_f1": False,
            "basic_pitch_uses_raw_onset_frame_activation": True,
            "bytedance_uses_raw_reg_onset_frame_velocity": True,
            "bounded_causal_prefix": True,
            "true_streaming_causal": False,
            "activation_pooling": "strike_local_neighborhood",
            "local_pre_seconds": args.local_pre_seconds,
            "local_post_seconds": args.local_post_seconds,
            "decision_horizon_seconds": args.horizon_seconds,
        },
        "case_manifest": str(args.case_manifest),
        "production_report": str(args.production_report),
        "case_counts": dict(sorted(_case_counts(cases).items())),
        "source_split_readiness": _source_split_readiness(cases),
        "frontends": {
            "production_fft_observer_warm": production_summary,
            "basic_pitch_raw_activation": basic_pitch_summary,
            "bytedance_high_resolution_piano_transcription": bytedance_summary,
        },
        "decision": _decision(production_summary, basic_pitch_summary, bytedance_summary),
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
    parser.add_argument("--local-pre-seconds", type=float, default=DEFAULT_LOCAL_PRE_SECONDS)
    parser.add_argument("--local-post-seconds", type=float, default=DEFAULT_LOCAL_POST_SECONDS)
    parser.add_argument("--onset-threshold", type=float, default=DEFAULT_ONSET_THRESHOLD)
    parser.add_argument("--frame-threshold", type=float, default=DEFAULT_FRAME_THRESHOLD)
    parser.add_argument("--basic-pitch-model-path", type=Path, default=None)
    parser.add_argument(
        "--bytedance-onset-threshold",
        type=float,
        default=DEFAULT_BYTEDANCE_ONSET_THRESHOLD,
    )
    parser.add_argument(
        "--bytedance-frame-threshold",
        type=float,
        default=DEFAULT_BYTEDANCE_FRAME_THRESHOLD,
    )
    parser.add_argument("--bytedance-checkpoint-path", type=Path, default=None)
    parser.add_argument("--bytedance-device", default="cuda")
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
    local_pre_seconds: float,
    local_post_seconds: float,
    onset_threshold: float,
    frame_threshold: float,
    model_path: Path | None,
) -> dict[str, object]:
    provider = BasicPitchRawActivationProvider(model_path=model_path)
    work_dir.mkdir(parents=True, exist_ok=True)
    evaluations = [
        _evaluate_basic_pitch_case(
            case,
            manifest_path=manifest_path,
            work_dir=work_dir,
            horizon_seconds=horizon_seconds,
            local_pre_seconds=local_pre_seconds,
            local_post_seconds=local_post_seconds,
            onset_threshold=onset_threshold,
            frame_threshold=frame_threshold,
            provider=provider,
        )
        for case in cases
    ]
    return _raw_activation_frontend_report(
        provider_id="basic_pitch_raw_activation",
        model_path=str(provider.model_path),
        thresholds={
            "onset": onset_threshold,
            "frame": frame_threshold,
            "horizon_seconds": horizon_seconds,
            "local_pre_seconds": local_pre_seconds,
            "local_post_seconds": local_post_seconds,
        },
        extra_metadata={
            "raw_outputs": ("onset", "note"),
            "bounded_causal_prefix": True,
            "true_streaming_causal": False,
        },
        evaluations=evaluations,
    )


class BasicPitchRawActivationProvider:
    def __init__(self, *, model_path: Path | None = None) -> None:
        from basic_pitch import FilenameSuffix, build_icassp_2022_model_path
        from basic_pitch.inference import Model, run_inference

        self.model_path = (
            Path(build_icassp_2022_model_path(FilenameSuffix.tf))
            if model_path is None
            else model_path
        )
        self._model = Model(self.model_path)
        self._run_inference = run_inference

    def predict(self, clip_path: Path) -> dict[str, np.ndarray]:
        return self._run_inference(clip_path, self._model)


def _bytedance_frontend_summary(
    cases: tuple[dict[str, object], ...],
    *,
    manifest_path: Path,
    work_dir: Path,
    horizon_seconds: float,
    local_pre_seconds: float,
    local_post_seconds: float,
    onset_threshold: float,
    frame_threshold: float,
    checkpoint_path: Path | None,
    device: str,
) -> dict[str, object]:
    try:
        provider = ByteDancePianoTranscriptionProvider(
            checkpoint_path=checkpoint_path,
            device=device,
        )
    except Exception as exc:  # pragma: no cover - research environment dependent
        return {
            "provider_id": "bytedance_high_resolution_piano_transcription",
            "status": "not_evaluated",
            "reason": f"{type(exc).__name__}: {exc}",
        }

    work_dir.mkdir(parents=True, exist_ok=True)
    evaluations = [
        _evaluate_raw_activation_case(
            case,
            manifest_path=manifest_path,
            work_dir=work_dir,
            horizon_seconds=horizon_seconds,
            local_pre_seconds=local_pre_seconds,
            local_post_seconds=local_post_seconds,
            onset_threshold=onset_threshold,
            frame_threshold=frame_threshold,
            provider_id="bytedance_high_resolution_piano_transcription",
            provider=provider,
        )
        for case in cases
    ]
    return _raw_activation_frontend_report(
        provider_id="bytedance_high_resolution_piano_transcription",
        model_path=provider.checkpoint_path,
        thresholds={
            "reg_onset": onset_threshold,
            "frame": frame_threshold,
            "horizon_seconds": horizon_seconds,
            "local_pre_seconds": local_pre_seconds,
            "local_post_seconds": local_post_seconds,
        },
        extra_metadata={
            "raw_outputs": (
                "reg_onset_output",
                "frame_output",
                "velocity_output",
                "reg_offset_output",
            ),
            "velocity_is_diagnostic_only": True,
            "offset_and_pedal_not_used_for_match": True,
            "bounded_causal_prefix": True,
            "true_streaming_causal": False,
            "architecture_note": (
                "The model is piano-specific and uses non-streaming sequence "
                "context. The benchmark clips stop at target + horizon, so it "
                "does not read future real audio beyond the decision horizon, "
                "but this is not a deployable streaming runtime claim."
            ),
        },
        evaluations=evaluations,
    )


class ByteDancePianoTranscriptionProvider:
    def __init__(self, *, checkpoint_path: Path | None, device: str) -> None:
        import torch
        from piano_transcription_inference import PianoTranscription

        resolved_device = torch.device(device if device == "cpu" or torch.cuda.is_available() else "cpu")
        self._transcriber = PianoTranscription(
            checkpoint_path=None if checkpoint_path is None else str(checkpoint_path),
            device=resolved_device,
        )
        self.checkpoint_path = (
            str(checkpoint_path)
            if checkpoint_path is not None
            else str(Path.home() / "piano_transcription_inference_data" / "note_F1=0.9677_pedal_F1=0.9186.pth")
        )

    def predict(self, clip_audio: np.ndarray, *, sample_rate: int) -> dict[str, np.ndarray]:
        if sample_rate != 16000:
            raise ValueError(f"ByteDance provider expects 16 kHz audio, got {sample_rate}")
        audio = np.asarray(clip_audio, dtype=np.float32)
        result = self._transcriber.transcribe(audio, midi_path=None)
        output = result["output_dict"]
        return {
            "onset": output["reg_onset_output"],
            "frame": output["frame_output"],
            "velocity": output["velocity_output"],
            "offset": output.get("reg_offset_output"),
        }

    def __call__(
        self,
        clip_audio: np.ndarray,
        sample_rate: int,
        clip_path: Path,
    ) -> dict[str, np.ndarray]:
        del clip_path
        return self.predict(clip_audio, sample_rate=sample_rate)


def _evaluate_basic_pitch_case(
    case: dict[str, object],
    *,
    manifest_path: Path,
    work_dir: Path,
    horizon_seconds: float,
    local_pre_seconds: float,
    local_post_seconds: float,
    onset_threshold: float,
    frame_threshold: float,
    provider: BasicPitchRawActivationProvider,
) -> dict[str, object]:
    return _evaluate_raw_activation_case(
        case,
        manifest_path=manifest_path,
        work_dir=work_dir,
        horizon_seconds=horizon_seconds,
        local_pre_seconds=local_pre_seconds,
        local_post_seconds=local_post_seconds,
        onset_threshold=onset_threshold,
        frame_threshold=frame_threshold,
        provider_id="basic_pitch_raw_activation",
        provider=lambda clip_audio, sample_rate, clip_path: _predict_basic_pitch(
            provider,
            clip_audio,
            sample_rate=sample_rate,
            clip_path=clip_path,
        ),
    )


def _evaluate_raw_activation_case(
    case: dict[str, object],
    *,
    manifest_path: Path,
    work_dir: Path,
    horizon_seconds: float,
    local_pre_seconds: float,
    local_post_seconds: float,
    onset_threshold: float,
    frame_threshold: float,
    provider_id: str,
    provider: Callable[[np.ndarray, int, Path], dict[str, np.ndarray]],
) -> dict[str, object]:
    audio_path = _case_audio_path(case, manifest_path=manifest_path)
    audio, sample_rate = _read_wav(audio_path)
    source_start = float((case.get("source_time_range_seconds") or (0.0,))[0])
    target_seconds = tuple(float(value) for value in case.get("target_group_seconds", ()))
    expected_groups = tuple(tuple(group) for group in case.get("expected_groups", ()))
    actual_groups = tuple(tuple(group) for group in case.get("actual_groups", ()))
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
            / f"{provider_id}_causal_clips"
            / (
                f"{case['case_id']}_g{index + 1:02d}"
                f"_h{_safe_float(horizon_seconds)}"
                f"_local{_safe_float(local_pre_seconds)}-{_safe_float(local_post_seconds)}.wav"
            )
        )
        _write_wav(clip_path, clip_audio, sample_rate=sample_rate)
        raw_output = provider(clip_audio, sample_rate, clip_path)
        prediction = _activation_prediction(
            raw_output,
            expected_pitches=expected_pitches,
            clip_start_seconds=source_start,
            analysis_start_seconds=target_second - local_pre_seconds,
            analysis_end_seconds=target_second + local_post_seconds,
            target_second=target_second,
            onset_threshold=onset_threshold,
            frame_threshold=frame_threshold,
        )
        observed = tuple(
            pitch for pitch, evidence in prediction["expected_evidence"].items() if evidence["accepted"]
        )
        result, matched, missing, extra = _evaluate_expected(expected_pitches, observed)
        actual_pitches = actual_groups[index] if index < len(actual_groups) else ()
        contamination = _future_target_contamination(
            case,
            expected_pitches=expected_pitches,
            actual_pitches=actual_pitches,
            target_second=target_second,
            decision_end_seconds=target_second + horizon_seconds,
        )
        group_results.append(
            {
                "group_index": index,
                "target_second": round(target_second, 6),
                "expected_pitches": expected_pitches,
                "actual_pitches_at_target": actual_pitches,
                "observed_pitches": observed,
                "result": result,
                "matched_expected": matched,
                "missing_expected": missing,
                "extra_observed": extra,
                "expected_evidence": prediction["expected_evidence"],
                "competitor_evidence": prediction["competitor_evidence"],
                "chord_summary": prediction["chord_summary"],
                "analysis_neighborhood": {
                    "start_seconds": round(target_second - local_pre_seconds, 6),
                    "end_seconds": round(target_second + local_post_seconds, 6),
                    "pre_seconds": local_pre_seconds,
                    "post_seconds": local_post_seconds,
                },
                "future_target_contamination": contamination,
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
        "future_target_contaminated": any(
            group["future_target_contamination"]["contaminated"]
            for group in group_results
        ),
        "source_identity": _case_source_identity(case),
        "group_results": group_results,
        "observed_groups": observed_groups,
    }


def _predict_basic_pitch(
    provider: BasicPitchRawActivationProvider,
    clip_audio: np.ndarray,
    *,
    sample_rate: int,
    clip_path: Path,
) -> dict[str, np.ndarray]:
    del clip_audio, sample_rate
    raw = provider.predict(clip_path)
    return {
        "onset": raw["onset"],
        "frame": raw["note"],
        "velocity": None,
        "offset": None,
    }


def _activation_prediction(
    raw_output: dict[str, np.ndarray],
    *,
    expected_pitches: tuple[str, ...],
    clip_start_seconds: float,
    analysis_start_seconds: float,
    analysis_end_seconds: float,
    target_second: float,
    onset_threshold: float,
    frame_threshold: float,
) -> dict[str, object]:
    onsets = raw_output["onset"]
    notes = raw_output["frame"]
    velocity = raw_output.get("velocity")
    frame_times = _raw_activation_frame_times(raw_output, frame_count=onsets.shape[0]) + clip_start_seconds
    frame_mask = (frame_times >= analysis_start_seconds) & (
        frame_times <= analysis_end_seconds
    )

    expected_evidence = {
        pitch: _pitch_evidence(
            onsets,
            notes,
            velocity,
            frame_mask=frame_mask,
            pitch=pitch,
            onset_threshold=onset_threshold,
            frame_threshold=frame_threshold,
            frame_times=frame_times,
            target_second=target_second,
        )
        for pitch in expected_pitches
    }
    competitor_evidence = {
        pitch: {
            "-12": _pitch_evidence(
                onsets,
                notes,
                velocity,
                frame_mask=frame_mask,
                pitch=_transpose_pitch(pitch, -12),
                onset_threshold=onset_threshold,
                frame_threshold=frame_threshold,
                frame_times=frame_times,
                target_second=target_second,
            ),
            "-1": _pitch_evidence(
                onsets,
                notes,
                velocity,
                frame_mask=frame_mask,
                pitch=_transpose_pitch(pitch, -1),
                onset_threshold=onset_threshold,
                frame_threshold=frame_threshold,
                frame_times=frame_times,
                target_second=target_second,
            ),
            "+1": _pitch_evidence(
                onsets,
                notes,
                velocity,
                frame_mask=frame_mask,
                pitch=_transpose_pitch(pitch, 1),
                onset_threshold=onset_threshold,
                frame_threshold=frame_threshold,
                frame_times=frame_times,
                target_second=target_second,
            ),
            "+12": _pitch_evidence(
                onsets,
                notes,
                velocity,
                frame_mask=frame_mask,
                pitch=_transpose_pitch(pitch, 12),
                onset_threshold=onset_threshold,
                frame_threshold=frame_threshold,
                frame_times=frame_times,
                target_second=target_second,
            ),
        }
        for pitch in expected_pitches
    }
    onset_values = [
        float(evidence["onset_activation"])
        for evidence in expected_evidence.values()
        if isinstance(evidence.get("onset_activation"), (int, float))
    ]
    frame_values = [
        float(evidence["frame_activation"])
        for evidence in expected_evidence.values()
        if isinstance(evidence.get("frame_activation"), (int, float))
    ]
    onset_peak_times = [
        float(evidence["onset_peak_time_relative_ms"])
        for evidence in expected_evidence.values()
        if isinstance(evidence["onset_peak_time_relative_ms"], (int, float))
    ]
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
            "max_onset_time_spread_ms": _round_or_none(
                max(onset_peak_times) - min(onset_peak_times)
                if len(onset_peak_times) >= 2
                else 0.0
                if len(onset_peak_times) == 1
                else None
            ),
            "weakest_expected_tone": _weakest_expected_tone(expected_evidence),
        },
    }


def _pitch_evidence(
    onsets: np.ndarray,
    notes: np.ndarray,
    velocity: np.ndarray | None,
    *,
    frame_mask: np.ndarray,
    pitch: str | None,
    onset_threshold: float,
    frame_threshold: float,
    frame_times: np.ndarray,
    target_second: float,
) -> dict[str, object]:
    if pitch is None:
        return {
            "pitch": None,
            "local_evidence_status": "NO_PITCH",
            "onset_activation": None,
            "frame_activation": None,
            "velocity_evidence": None,
            "onset_peak_time_relative_ms": None,
            "frame_at_onset_peak": None,
            "frame_max_near_onset_peak": None,
            "accepted": False,
        }
    midi_note = _pitch_to_midi_note(pitch)
    pitch_index = midi_note - MIDI_OFFSET
    if pitch_index < 0 or pitch_index >= onsets.shape[1]:
        return {
            "pitch": pitch,
            "local_evidence_status": "PITCH_OUT_OF_MODEL_RANGE",
            "onset_activation": None,
            "frame_activation": None,
            "velocity_evidence": None,
            "onset_peak_time_relative_ms": None,
            "frame_at_onset_peak": None,
            "frame_max_near_onset_peak": None,
            "accepted": False,
        }
    if not np.any(frame_mask):
        return {
            "pitch": pitch,
            "local_evidence_status": "NO_LOCAL_MODEL_FRAMES",
            "onset_activation": None,
            "frame_activation": None,
            "velocity_evidence": None,
            "onset_peak_time_relative_ms": None,
            "frame_at_onset_peak": None,
            "frame_max_near_onset_peak": None,
            "accepted": False,
        }
    onset_values = onsets[frame_mask, pitch_index]
    onset_argmax = int(np.argmax(onset_values))
    masked_frame_times = frame_times[frame_mask]
    masked_frames = notes[frame_mask, pitch_index]
    onset_max = float(onset_values[onset_argmax])
    onset_peak_time = float(masked_frame_times[onset_argmax])
    frame_max = float(np.max(masked_frames))
    frame_at_onset_peak = float(masked_frames[onset_argmax])
    near_onset_mask = (
        np.abs(masked_frame_times - onset_peak_time)
        <= ONSET_PEAK_FRAME_NEIGHBORHOOD_SECONDS
    )
    frame_max_near_onset_peak = (
        float(np.max(masked_frames[near_onset_mask]))
        if np.any(near_onset_mask)
        else frame_at_onset_peak
    )
    velocity_max = None
    if velocity is not None:
        velocity_max = float(np.max(velocity[frame_mask, pitch_index]))
    return {
        "pitch": pitch,
        "local_evidence_status": "AVAILABLE",
        "onset_activation": round(onset_max, 6),
        "onset_peak_time_relative_ms": round((onset_peak_time - target_second) * 1000.0),
        "frame_activation": round(frame_max, 6),
        "frame_at_onset_peak": round(frame_at_onset_peak, 6),
        "frame_max_near_onset_peak": round(frame_max_near_onset_peak, 6),
        "velocity_evidence": _round_or_none(velocity_max),
        "accepted": onset_max >= onset_threshold and frame_max >= frame_threshold,
    }


def _raw_activation_frame_times(raw_output: dict[str, np.ndarray], *, frame_count: int) -> np.ndarray:
    if "velocity" in raw_output and raw_output.get("velocity") is not None:
        return np.arange(frame_count, dtype=np.float32) / 100.0
    from basic_pitch.note_creation import model_frames_to_time

    return model_frames_to_time(frame_count)


def _raw_activation_frontend_report(
    *,
    provider_id: str,
    model_path: str,
    thresholds: dict[str, object],
    extra_metadata: dict[str, object] | None = None,
    evaluations: list[dict[str, object]],
) -> dict[str, object]:
    by_kind: dict[str, list[dict[str, object]]] = defaultdict(list)
    for evaluation in evaluations:
        by_kind[str(evaluation["case_kind"])].append(evaluation)
    report = {
        "provider_id": provider_id,
        "model_path": model_path,
        "thresholds": thresholds,
        "metrics": {
            "correct_single_acceptance": _rate(
                bool(evaluation["accepted"]) for evaluation in by_kind["correct_strike"]
            ),
            "correct_chord_complete_acceptance": _rate(
                bool(evaluation["accepted"]) for evaluation in by_kind["correct_chord"]
            ),
            "wrong_semitone_false_completion": _rate(
                bool(evaluation["accepted"]) for evaluation in by_kind["wrong_semitone"]
            ),
            "wrong_semitone_false_completion_uncontaminated": _rate(
                bool(evaluation["accepted"])
                for evaluation in by_kind["wrong_semitone"]
                if not bool(evaluation["future_target_contaminated"])
            ),
            "wrong_octave_false_completion": _rate(
                bool(evaluation["accepted"]) for evaluation in by_kind["wrong_octave"]
            ),
            "wrong_octave_false_completion_uncontaminated": _rate(
                bool(evaluation["accepted"])
                for evaluation in by_kind["wrong_octave"]
                if not bool(evaluation["future_target_contaminated"])
            ),
            "missing_note_false_completion": _rate(
                bool(evaluation["accepted"]) for evaluation in by_kind["missing_chord_tone"]
            ),
            "missing_note_false_completion_uncontaminated": _rate(
                bool(evaluation["accepted"])
                for evaluation in by_kind["missing_chord_tone"]
                if not bool(evaluation["future_target_contaminated"])
            ),
            "retrigger_acceptance": _rate(
                bool(evaluation["accepted"]) for evaluation in by_kind["same_note_retrigger"]
            ),
            "no_local_frame_case_count": _no_local_frame_case_count(evaluations),
        },
        "evidence_summary": _activation_evidence_summary(evaluations),
        "contaminated_negative_cases": _contaminated_negative_cases(evaluations),
        "evaluations": evaluations,
    }
    if extra_metadata:
        report.update(extra_metadata)
    return report


def _basic_pitch_evidence_summary(evaluations: list[dict[str, object]]) -> dict[str, object]:
    return _activation_evidence_summary(evaluations)


def _no_local_frame_case_count(evaluations: list[dict[str, object]]) -> dict[str, object]:
    return {
        "count": sum(1 for evaluation in evaluations if _has_no_local_model_frames(evaluation)),
        "total": len(evaluations),
    }


def _has_no_local_model_frames(evaluation: dict[str, object]) -> bool:
    for group in evaluation.get("group_results", ()) or ():
        for evidence in group.get("expected_evidence", {}).values():
            if evidence.get("local_evidence_status") == "NO_LOCAL_MODEL_FRAMES":
                return True
    return False


def _contaminated_negative_cases(evaluations: list[dict[str, object]]) -> list[dict[str, object]]:
    contaminated = []
    negative_kinds = {"wrong_semitone", "wrong_octave", "missing_chord_tone"}
    for evaluation in evaluations:
        if evaluation.get("case_kind") not in negative_kinds:
            continue
        for group in evaluation.get("group_results", ()) or ():
            contamination = group.get("future_target_contamination") or {}
            if not contamination.get("contaminated"):
                continue
            contaminated.append(
                {
                    "case_id": evaluation.get("case_id"),
                    "case_kind": evaluation.get("case_kind"),
                    "group_index": group.get("group_index"),
                    "expected_pitches": group.get("expected_pitches"),
                    "actual_target_pitches": contamination.get("actual_target_pitches"),
                    "counterfactual_pitches": contamination.get("counterfactual_pitches"),
                    "future_contaminating_events": contamination.get("events"),
                }
            )
    return contaminated


def _activation_evidence_summary(evaluations: list[dict[str, object]]) -> dict[str, object]:
    target_onsets: list[float] = []
    target_frames: list[float] = []
    target_velocities: list[float] = []
    positive_onset_peak_times: list[float] = []
    positive_near_left_boundary_count = 0
    positive_near_right_boundary_count = 0
    competitor_values: dict[str, dict[str, list[float]]] = {
        "-12": {"onset": [], "frame": [], "velocity": []},
        "-1": {"onset": [], "frame": [], "velocity": []},
        "+1": {"onset": [], "frame": [], "velocity": []},
        "+12": {"onset": [], "frame": [], "velocity": []},
    }
    semitone_onset_contrast: list[float] = []
    semitone_frame_contrast: list[float] = []
    octave_onset_contrast: list[float] = []
    octave_frame_contrast: list[float] = []
    chord_onset_mins: list[float] = []
    chord_onset_spreads: list[float] = []
    chord_frame_mins: list[float] = []
    chord_frame_spreads: list[float] = []
    positive_kinds = {"correct_strike", "correct_chord", "same_note_retrigger"}
    for evaluation in evaluations:
        for group in evaluation["group_results"]:
            neighborhood = group.get("analysis_neighborhood") or {}
            left_boundary_ms = -float(neighborhood.get("pre_seconds", DEFAULT_LOCAL_PRE_SECONDS)) * 1000.0
            right_boundary_ms = float(neighborhood.get("post_seconds", DEFAULT_LOCAL_POST_SECONDS)) * 1000.0
            boundary_band_ms = LOCAL_WINDOW_BOUNDARY_BAND_SECONDS * 1000.0
            for evidence in group["expected_evidence"].values():
                _append_number(target_onsets, evidence.get("onset_activation"))
                _append_number(target_frames, evidence.get("frame_activation"))
                _append_number(target_velocities, evidence.get("velocity_evidence"))
                peak_time = evidence.get("onset_peak_time_relative_ms")
                if (
                    evaluation.get("case_kind") in positive_kinds
                    and isinstance(peak_time, (int, float))
                ):
                    positive_onset_peak_times.append(float(peak_time))
                    if float(peak_time) <= left_boundary_ms + boundary_band_ms:
                        positive_near_left_boundary_count += 1
                    if float(peak_time) >= right_boundary_ms - boundary_band_ms:
                        positive_near_right_boundary_count += 1
            for by_pitch in group["competitor_evidence"].values():
                for offset, evidence in by_pitch.items():
                    _append_number(competitor_values[offset]["onset"], evidence.get("onset_activation"))
                    _append_number(competitor_values[offset]["frame"], evidence.get("frame_activation"))
                    _append_number(
                        competitor_values[offset]["velocity"],
                        evidence.get("velocity_evidence"),
                    )
                _append_contrast(
                    semitone_onset_contrast,
                    group["expected_evidence"],
                    by_pitch,
                    evidence_key="onset_activation",
                    offsets=("-1", "+1"),
                )
                _append_contrast(
                    semitone_frame_contrast,
                    group["expected_evidence"],
                    by_pitch,
                    evidence_key="frame_activation",
                    offsets=("-1", "+1"),
                )
                _append_contrast(
                    octave_onset_contrast,
                    group["expected_evidence"],
                    by_pitch,
                    evidence_key="onset_activation",
                    offsets=("-12", "+12"),
                )
                _append_contrast(
                    octave_frame_contrast,
                    group["expected_evidence"],
                    by_pitch,
                    evidence_key="frame_activation",
                    offsets=("-12", "+12"),
                )
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
        "target_velocity": _number_summary(target_velocities),
        "competitors": {
            offset: {
                "onset": _number_summary(values["onset"]),
                "frame": _number_summary(values["frame"]),
                "velocity": _number_summary(values["velocity"]),
            }
            for offset, values in competitor_values.items()
        },
        "semitone_contrast": {
            "target_minus_strongest_competitor_onset": _number_summary(
                semitone_onset_contrast
            ),
            "target_minus_strongest_competitor_frame": _number_summary(
                semitone_frame_contrast
            ),
        },
        "octave_contrast": {
            "target_minus_strongest_competitor_onset": _number_summary(
                octave_onset_contrast
            ),
            "target_minus_strongest_competitor_frame": _number_summary(
                octave_frame_contrast
            ),
        },
        "chord": {
            "target_onset_min": _number_summary(chord_onset_mins),
            "target_onset_spread": _number_summary(chord_onset_spreads),
            "target_frame_min": _number_summary(chord_frame_mins),
            "target_frame_spread": _number_summary(chord_frame_spreads),
        },
        "positive_onset_peak_timing": {
            "relative_ms": _number_summary(positive_onset_peak_times),
            "near_left_boundary_count": positive_near_left_boundary_count,
            "near_right_boundary_count": positive_near_right_boundary_count,
            "left_boundary_ms": round(-DEFAULT_LOCAL_PRE_SECONDS * 1000.0),
            "right_boundary_ms": round(DEFAULT_LOCAL_POST_SECONDS * 1000.0),
            "boundary_band_ms": round(LOCAL_WINDOW_BOUNDARY_BAND_SECONDS * 1000.0),
        },
    }


def _decision(
    production_summary: dict[str, object],
    basic_pitch_summary: dict[str, object],
    bytedance_summary: dict[str, object],
) -> dict[str, object]:
    production_metrics = production_summary["metrics"]
    basic_metrics = basic_pitch_summary["metrics"]
    bytedance_metrics = bytedance_summary.get("metrics")
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
        "bytedance_comparison_ready": bytedance_metrics is not None,
        "bytedance_improves_basic_pitch_semitone_safety": (
            False
            if bytedance_metrics is None
            else bytedance_metrics["wrong_semitone_false_completion"]["accepted"]
            < basic_metrics["wrong_semitone_false_completion"]["accepted"]
        ),
        "bytedance_preserves_basic_pitch_chord_recall": (
            False
            if bytedance_metrics is None
            else bytedance_metrics["correct_chord_complete_acceptance"]["accepted"]
            >= basic_metrics["correct_chord_complete_acceptance"]["accepted"]
        ),
        "recommended_next_step": (
            "If ByteDance raw evidence has lower semitone false completion while "
            "preserving chord recall, test a single global calibration policy. "
            "If not, inspect raw contrast distributions before considering a "
            "tiny target-conditioned strike verifier."
        ),
    }


def _append_contrast(
    values: list[float],
    expected_evidence: dict[str, dict[str, object]],
    competitor_evidence: dict[str, dict[str, object]],
    *,
    evidence_key: str,
    offsets: tuple[str, ...],
) -> None:
    if len(expected_evidence) != 1:
        return
    target = next(iter(expected_evidence.values())).get(evidence_key)
    if not isinstance(target, (int, float)):
        return
    competitor_numbers = [
        float(competitor_evidence[offset][evidence_key])
        for offset in offsets
        if offset in competitor_evidence
        and isinstance(competitor_evidence[offset].get(evidence_key), (int, float))
    ]
    if competitor_numbers:
        values.append(float(target) - max(competitor_numbers))


def _case_counts(cases: tuple[dict[str, object], ...]) -> dict[str, int]:
    counts: dict[str, int] = defaultdict(int)
    for case in cases:
        counts[str(case.get("case_kind"))] += 1
    return counts


def _source_split_readiness(cases: tuple[dict[str, object], ...]) -> dict[str, object]:
    source_groups: dict[str, set[str]] = defaultdict(set)
    identity_kind_counts: dict[str, int] = defaultdict(int)
    for case in cases:
        identity = _case_source_identity(case)
        source_groups[identity["source_recording_id"]].add(str(case.get("case_id")))
        identity_kind_counts[str(identity["source_recording_id_kind"])] += 1
    return {
        "source_recording_count": len(source_groups),
        "case_count_by_source_recording": {
            source: len(case_ids) for source, case_ids in sorted(source_groups.items())
        },
        "source_recording_id_kind_counts": dict(sorted(identity_kind_counts.items())),
        "can_create_disjoint_calibration_evaluation_split": len(source_groups) >= 2,
        "split_rule": (
            "Group by source_recording_id. All derived cases from the same "
            "source performance must stay on the same side of calibration vs "
            "evaluation."
        ),
    }


def _case_source_identity(case: dict[str, object]) -> dict[str, object]:
    source_audio_sha256 = case.get("source_audio_sha256")
    if source_audio_sha256:
        source_recording = str(source_audio_sha256)
        source_recording_id_kind = "source_audio_sha256"
    else:
        source_recording = str(case.get("source_file") or case.get("source_dataset") or "unknown")
        source_recording_id_kind = "fallback_source_file_or_dataset"
    return {
        "source_recording_id": source_recording,
        "source_recording_id_kind": source_recording_id_kind,
        "source_dataset": case.get("source_dataset"),
        "source_file": case.get("source_file"),
        "source_audio_sha256": source_audio_sha256,
        "source_midi": case.get("source_midi"),
        "source_midi_sha256": case.get("source_midi_sha256"),
        "target_group_indices": tuple(case.get("target_group_indices", ())),
        "target_group_seconds": tuple(case.get("target_group_seconds", ())),
        "source_time_range_seconds": tuple(case.get("source_time_range_seconds", ())),
    }


def _future_target_contamination(
    case: dict[str, object],
    *,
    expected_pitches: tuple[str, ...],
    actual_pitches: tuple[str, ...],
    target_second: float,
    decision_end_seconds: float,
) -> dict[str, object]:
    matches = []
    actual = set(actual_pitches)
    counterfactual = tuple(pitch for pitch in expected_pitches if pitch not in actual)
    counterfactual_set = set(counterfactual)
    for event in case.get("ground_truth_note_events", ()) or ():
        pitch = event.get("pitch")
        start = event.get("start_seconds")
        if not isinstance(pitch, str) or not isinstance(start, (int, float)):
            continue
        start = float(start)
        if start <= target_second + 1e-6:
            continue
        if start > decision_end_seconds + 1e-6:
            continue
        if pitch in counterfactual_set:
            matches.append(
                {
                    "pitch": pitch,
                    "start_seconds": round(start, 6),
                    "delta_ms": round((start - target_second) * 1000.0),
                }
            )
    return {
        "contaminated": bool(matches),
        "actual_target_pitches": actual_pitches,
        "counterfactual_pitches": counterfactual,
        "events": matches,
    }


def _weakest_expected_tone(
    expected_evidence: dict[str, dict[str, object]]
) -> dict[str, object] | None:
    weakest_pitch = None
    weakest_value = None
    for pitch, evidence in expected_evidence.items():
        value = evidence.get("onset_activation")
        if not isinstance(value, (int, float)):
            continue
        if weakest_value is None or float(value) < weakest_value:
            weakest_pitch = pitch
            weakest_value = float(value)
    if weakest_pitch is None:
        return None
    evidence = expected_evidence[weakest_pitch]
    return {
        "pitch": weakest_pitch,
        "onset_activation": evidence.get("onset_activation"),
        "frame_activation": evidence.get("frame_activation"),
        "velocity_evidence": evidence.get("velocity_evidence"),
        "onset_peak_time_relative_ms": evidence.get("onset_peak_time_relative_ms"),
    }



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


def _evaluate_expected(
    expected_pitches: tuple[str, ...],
    observed_pitches: tuple[str, ...],
) -> tuple[str, tuple[str, ...], tuple[str, ...], tuple[str, ...]]:
    expected = tuple(dict.fromkeys(expected_pitches))
    observed = tuple(dict.fromkeys(observed_pitches))
    expected_set = set(expected)
    observed_set = set(observed)
    matched = tuple(pitch for pitch in expected if pitch in observed_set)
    missing = tuple(pitch for pitch in expected if pitch not in observed_set)
    extra = tuple(pitch for pitch in observed if pitch not in expected_set)
    if matched and not missing and not extra:
        result = "MATCH"
    elif matched:
        result = "PARTIAL"
    elif observed:
        result = "MISMATCH"
    else:
        result = "UNCERTAIN"
    return result, matched, missing, extra


def _pitch_to_midi_note(pitch: str) -> int:
    pitch_class = pitch[:2] if len(pitch) > 1 and pitch[1] == "#" else pitch[:1]
    octave_text = pitch[len(pitch_class) :]
    if pitch_class not in _PITCH_CLASSES:
        raise ValueError(f"Unsupported pitch: {pitch}")
    return (int(octave_text) + 1) * 12 + _PITCH_CLASSES.index(pitch_class)


def _midi_note_name(note_number: int) -> str:
    return f"{_PITCH_CLASSES[note_number % 12]}{note_number // 12 - 1}"


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
