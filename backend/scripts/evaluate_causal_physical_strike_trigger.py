"""Research-only causal PCM physical-strike trigger benchmark.

This script replaces oracle target timestamps with a simple PCM-only causal
candidate detector. It does not run ByteDance, does not modify production, and
does not use target times, pitches, MIDI, case kind, or future audio inside the
runtime detector.

Metadata:
- oracle_target_timestamp = false
- causal_attempt_detection = true
- streaming_causal_model = false
- product_false_advance_eligible = false
"""

from __future__ import annotations

import argparse
from collections import Counter, defaultdict, deque
from dataclasses import dataclass
import json
from pathlib import Path
from time import perf_counter

import numpy as np

from compare_step_microphone_frontends_causal_cases import _case_audio_path, _read_wav
from evaluate_public_paired_midi_dataset import (
    DEFAULT_CHORD_WINDOW_SECONDS,
    MidiStrikeGroup,
    group_note_ons,
    parse_midi_note_ons,
)


SAMPLE_RATE = 16_000
MATCH_TOLERANCE_SECONDS = 0.10
DEFAULT_DEV_MANIFEST = Path(
    "data/work/datasets/maestro-v3.0.0/production_step_development_set/"
    "public_step_causal_cases_manifest.json"
)
DEFAULT_CAL_MANIFEST = Path(
    "data/work/datasets/maestro-v3.0.0/production_step_calibration_set/"
    "public_step_causal_cases_manifest.json"
)
DEFAULT_OUTPUT = Path("data/work/datasets/maestro-v3.0.0/causal_physical_strike_trigger.json")


@dataclass(frozen=True)
class StrikeCandidate:
    candidate_anchor_sample: int
    candidate_emit_sample: int
    received_samples_at_emit: int
    rms: float
    spectral_flux: float
    rms_gate: float
    flux_gate: float


@dataclass(frozen=True)
class FrameTrace:
    frame_start_sample: int
    frame_end_sample: int
    rms: float
    spectral_flux: float
    median_rms_baseline: float
    median_flux_baseline: float
    absolute_rms_floor: float
    adaptive_rms_gate: float
    effective_rms_gate: float
    absolute_flux_floor: float
    adaptive_flux_gate: float
    effective_flux_gate: float
    passes_rms: bool
    passes_flux: bool
    passes_refractory: bool
    would_emit: bool


@dataclass(frozen=True)
class DetectorConfig:
    frame_size_samples: int = 512
    hop_samples: int = 160
    baseline_frames: int = 48
    min_rms: float = 0.010
    rms_ratio: float = 2.35
    min_flux: float = 0.080
    flux_ratio: float = 3.0
    refractory_samples: int = 1_600


class CausalPcmStrikeDetector:
    """A fixed-frame causal onset baseline independent of chunk boundaries."""

    def __init__(self, config: DetectorConfig | None = None) -> None:
        self.config = config or DetectorConfig()
        self._audio = np.array([], dtype=np.float32)
        self._next_frame_start = 0
        self._previous_magnitude: np.ndarray | None = None
        self._rms_history: deque[float] = deque(maxlen=self.config.baseline_frames)
        self._flux_history: deque[float] = deque(maxlen=self.config.baseline_frames)
        self._last_candidate_anchor: int | None = None
        self.candidates: list[StrikeCandidate] = []
        self.frame_traces: list[FrameTrace] = []
        self.received_samples = 0

    def ingest(self, chunk: np.ndarray) -> tuple[StrikeCandidate, ...]:
        if chunk.size:
            self._audio = np.concatenate(
                (self._audio, np.asarray(chunk, dtype=np.float32).copy())
            )
            self.received_samples += int(chunk.size)
        emitted: list[StrikeCandidate] = []
        while self._next_frame_start + self.config.frame_size_samples <= self.received_samples:
            frame_start = self._next_frame_start
            frame_end = frame_start + self.config.frame_size_samples
            frame = self._audio[frame_start:frame_end]
            rms = float(np.sqrt(np.mean(np.square(frame), dtype=np.float64)))
            windowed = frame * np.hanning(frame.size).astype(np.float32)
            magnitude = np.abs(np.fft.rfft(windowed))
            if self._previous_magnitude is None:
                flux = 0.0
            else:
                positive = np.maximum(magnitude - self._previous_magnitude, 0.0)
                flux = float(np.sum(positive) / (np.sum(self._previous_magnitude) + 1e-6))

            median_rms = _median_or_zero(self._rms_history)
            median_flux = _median_or_zero(self._flux_history)
            adaptive_rms_gate = median_rms * self.config.rms_ratio
            adaptive_flux_gate = median_flux * self.config.flux_ratio
            rms_gate = max(self.config.min_rms, adaptive_rms_gate)
            flux_gate = max(self.config.min_flux, adaptive_flux_gate)
            enough_refractory = (
                self._last_candidate_anchor is None
                or frame_start - self._last_candidate_anchor >= self.config.refractory_samples
            )
            passes_rms = rms >= rms_gate
            passes_flux = flux >= flux_gate
            would_emit = passes_rms and passes_flux and enough_refractory
            self.frame_traces.append(
                FrameTrace(
                    frame_start_sample=int(frame_start),
                    frame_end_sample=int(frame_end),
                    rms=rms,
                    spectral_flux=flux,
                    median_rms_baseline=median_rms,
                    median_flux_baseline=median_flux,
                    absolute_rms_floor=self.config.min_rms,
                    adaptive_rms_gate=adaptive_rms_gate,
                    effective_rms_gate=rms_gate,
                    absolute_flux_floor=self.config.min_flux,
                    adaptive_flux_gate=adaptive_flux_gate,
                    effective_flux_gate=flux_gate,
                    passes_rms=passes_rms,
                    passes_flux=passes_flux,
                    passes_refractory=enough_refractory,
                    would_emit=would_emit,
                )
            )
            if would_emit:
                candidate = StrikeCandidate(
                    candidate_anchor_sample=int(frame_start),
                    candidate_emit_sample=int(frame_end),
                    received_samples_at_emit=int(self.received_samples),
                    rms=rms,
                    spectral_flux=flux,
                    rms_gate=rms_gate,
                    flux_gate=flux_gate,
                )
                if not (
                    candidate.candidate_anchor_sample
                    <= candidate.candidate_emit_sample
                    <= candidate.received_samples_at_emit
                ):
                    raise AssertionError("causal candidate invariant violated")
                self.candidates.append(candidate)
                emitted.append(candidate)
                self._last_candidate_anchor = frame_start

            self._rms_history.append(rms)
            self._flux_history.append(flux)
            self._previous_magnitude = magnitude
            self._next_frame_start += self.config.hop_samples
        return tuple(emitted)


def main() -> int:
    args = parse_args()
    config = DetectorConfig(
        frame_size_samples=args.frame_size_samples,
        hop_samples=args.hop_samples,
        min_rms=args.min_rms,
        rms_ratio=args.rms_ratio,
        min_flux=args.min_flux,
        flux_ratio=args.flux_ratio,
        refractory_samples=args.refractory_samples,
    )
    cases_by_split = _load_cases(args.development_manifest, args.calibration_manifest)
    report = {
        "metadata": {
            "oracle_target_timestamp": False,
            "causal_attempt_detection": True,
            "streaming_causal_model": False,
            "product_false_advance_eligible": False,
            "frozen_set_touched": False,
            "byte_dance_verifier_run": False,
            "threshold_governance": (
                "development baseline configuration; not formally calibrated; "
                "calibration is a source-disjoint audit and is not used for retuning"
            ),
        },
        "sample_rate": SAMPLE_RATE,
        "match_tolerance_seconds": MATCH_TOLERANCE_SECONDS,
        "detector_config": config.__dict__,
        "chunk_boundary_invariant": {},
        "splits": {},
    }

    for split, cases in cases_by_split.items():
        split_report = _evaluate_split(cases, config=config, chunk_spec=args.primary_chunk_spec)
        report["splits"][split] = split_report

    invariant_cases = [case for cases in cases_by_split.values() for case in cases]
    report["chunk_boundary_invariant"] = _chunk_invariance_report(
        invariant_cases,
        config=config,
        chunk_specs=("640", "683", "743", "irregular"),
    )
    report["combined"] = _combine_summaries(report["splits"])

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(_console_summary(report, args.output), ensure_ascii=False, indent=2))
    return 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--development-manifest", type=Path, default=DEFAULT_DEV_MANIFEST)
    parser.add_argument("--calibration-manifest", type=Path, default=DEFAULT_CAL_MANIFEST)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--primary-chunk-spec", default="640")
    parser.add_argument("--frame-size-samples", type=int, default=512)
    parser.add_argument("--hop-samples", type=int, default=160)
    parser.add_argument("--min-rms", type=float, default=0.010)
    parser.add_argument("--rms-ratio", type=float, default=2.35)
    parser.add_argument("--min-flux", type=float, default=0.080)
    parser.add_argument("--flux-ratio", type=float, default=3.0)
    parser.add_argument("--refractory-samples", type=int, default=1_600)
    return parser.parse_args()


def _load_cases(dev_manifest: Path, cal_manifest: Path) -> dict[str, list[tuple[Path, dict[str, object]]]]:
    return {
        "development": [
            (dev_manifest, case)
            for case in json.loads(dev_manifest.read_text(encoding="utf-8")).get("cases", ())
        ],
        "calibration": [
            (cal_manifest, case)
            for case in json.loads(cal_manifest.read_text(encoding="utf-8")).get("cases", ())
        ],
    }


def _evaluate_split(
    cases: list[tuple[Path, dict[str, object]]],
    *,
    config: DetectorConfig,
    chunk_spec: str,
) -> dict[str, object]:
    case_reports = []
    for manifest_path, case in cases:
        case_reports.append(
            _evaluate_case(manifest_path, case, config=config, chunk_spec=chunk_spec)
        )
    return {
        "case_count": len(case_reports),
        "source_count": len({report["source_recording_id"] for report in case_reports}),
        "summary": _summarize_case_reports(case_reports),
        "per_source": _per_source_summary(case_reports),
        "failure_examples": _failure_examples(case_reports),
        "cases": case_reports,
    }


def _evaluate_case(
    manifest_path: Path,
    case: dict[str, object],
    *,
    config: DetectorConfig,
    chunk_spec: str,
) -> dict[str, object]:
    audio_path = _case_audio_path(case, manifest_path=manifest_path)
    audio, sample_rate = _read_wav(audio_path)
    if sample_rate != SAMPLE_RATE:
        raise ValueError(f"expected {SAMPLE_RATE}Hz WAV, got {sample_rate}: {audio_path}")

    source_start, source_end = (float(value) for value in case["source_time_range_seconds"])
    gt_groups = _case_gt_groups(case, source_start=source_start, source_end=source_end)
    candidates, runtime, frame_traces = _run_detector(audio, config=config, chunk_spec=chunk_spec)
    matches = _match_candidates(gt_groups, candidates, source_start=source_start)
    gate_attributions = _attribute_gt_gate_blocks(
        gt_groups,
        frame_traces,
        source_start=source_start,
        matched_gt_indices=set(matches["gt_to_candidate"]),
    )
    target_seconds = tuple(float(value) for value in case.get("target_group_seconds", ()))
    target_reports = [
        _target_report(target_second, candidates, gt_groups, source_start=source_start)
        for target_second in target_seconds
    ]
    unmatched = _unmatched_candidate_reports(
        candidates,
        gt_groups,
        source_start=source_start,
        used_candidate_indices=set(matches["candidate_to_gt"]),
    )
    duration_minutes = max(float(audio.size) / SAMPLE_RATE / 60.0, 1e-9)
    return {
        "case_id": case.get("case_id"),
        "case_kind": case.get("case_kind"),
        "source_recording_id": case.get("source_audio_sha256"),
        "source_file": case.get("source_file"),
        "source_midi": case.get("source_midi"),
        "source_time_range_seconds": case.get("source_time_range_seconds"),
        "gt_strike_group_count": len(gt_groups),
        "candidate_count": len(candidates),
        "target_count": len(target_reports),
        "gt_matched_count": len(matches["gt_to_candidate"]),
        "target_matched_count": sum(1 for target in target_reports if target["matched"]),
        "duplicate_candidates_for_gt": matches["duplicate_candidates_for_gt"],
        "unmatched_candidates_per_minute": len(unmatched) / duration_minutes,
        "unmatched_candidate_buckets": _bucket_unmatched_candidates(unmatched),
        "candidate_anchor_error_ms": matches["anchor_error_ms"],
        "candidate_emit_delay_ms": matches["emit_delay_ms"],
        "gate_attribution": gate_attributions,
        "audio_sanity": _audio_sanity(audio, config=config),
        "frame_trace_summary": _frame_trace_summary(frame_traces),
        "target_reports": target_reports,
        "unmatched_candidates": unmatched[:30],
        "runtime": runtime,
    }


def _run_detector(
    audio: np.ndarray,
    *,
    config: DetectorConfig,
    chunk_spec: str,
) -> tuple[tuple[StrikeCandidate, ...], dict[str, object], tuple[FrameTrace, ...]]:
    detector = CausalPcmStrikeDetector(config)
    chunk_sizes = []
    started = perf_counter()
    for start, end in _chunk_ranges(int(audio.size), chunk_spec=chunk_spec):
        chunk = audio[start:end]
        chunk_sizes.append(int(chunk.size))
        detector.ingest(chunk)
    latency_ms = (perf_counter() - started) * 1000.0
    return tuple(detector.candidates), {
        "chunk_spec": chunk_spec,
        "chunk_count": len(chunk_sizes),
        "chunk_size_distribution_samples": _distribution(chunk_sizes),
        "detector_runtime_ms": round(latency_ms, 6),
    }, tuple(detector.frame_traces)


def _case_gt_groups(
    case: dict[str, object],
    *,
    source_start: float,
    source_end: float,
) -> tuple[MidiStrikeGroup, ...]:
    groups = group_note_ons(
        parse_midi_note_ons(Path(str(case["source_midi"]))),
        chord_window_seconds=DEFAULT_CHORD_WINDOW_SECONDS,
    )
    return tuple(group for group in groups if source_start <= group.seconds <= source_end)


def _match_candidates(
    gt_groups: tuple[MidiStrikeGroup, ...],
    candidates: tuple[StrikeCandidate, ...],
    *,
    source_start: float,
) -> dict[str, object]:
    pairs = []
    for gt_index, group in enumerate(gt_groups):
        gt_sample = _relative_sample(group.seconds, source_start)
        for candidate_index, candidate in enumerate(candidates):
            delta = candidate.candidate_anchor_sample - gt_sample
            if abs(delta) <= round(MATCH_TOLERANCE_SECONDS * SAMPLE_RATE):
                pairs.append((abs(delta), gt_index, candidate_index, delta))
    pairs.sort()
    used_gt: set[int] = set()
    used_candidates: set[int] = set()
    gt_to_candidate: dict[int, int] = {}
    candidate_to_gt: dict[int, int] = {}
    anchor_errors: list[float] = []
    emit_delays: list[float] = []
    for _, gt_index, candidate_index, delta in pairs:
        if gt_index in used_gt or candidate_index in used_candidates:
            continue
        used_gt.add(gt_index)
        used_candidates.add(candidate_index)
        gt_to_candidate[gt_index] = candidate_index
        candidate_to_gt[candidate_index] = gt_index
        group = gt_groups[gt_index]
        gt_sample = _relative_sample(group.seconds, source_start)
        candidate = candidates[candidate_index]
        anchor_errors.append(delta / SAMPLE_RATE * 1000.0)
        emit_delays.append((candidate.candidate_emit_sample - gt_sample) / SAMPLE_RATE * 1000.0)

    duplicate_count = 0
    tolerance_samples = round(MATCH_TOLERANCE_SECONDS * SAMPLE_RATE)
    for group in gt_groups:
        gt_sample = _relative_sample(group.seconds, source_start)
        near = [
            candidate
            for candidate in candidates
            if abs(candidate.candidate_anchor_sample - gt_sample) <= tolerance_samples
        ]
        duplicate_count += max(0, len(near) - 1)

    return {
        "gt_to_candidate": gt_to_candidate,
        "candidate_to_gt": candidate_to_gt,
        "anchor_error_ms": anchor_errors,
        "emit_delay_ms": emit_delays,
        "duplicate_candidates_for_gt": duplicate_count,
    }


def _target_report(
    target_second: float,
    candidates: tuple[StrikeCandidate, ...],
    gt_groups: tuple[MidiStrikeGroup, ...],
    *,
    source_start: float,
) -> dict[str, object]:
    target_sample = _relative_sample(target_second, source_start)
    nearest_candidate = _nearest_candidate(target_sample, candidates)
    nearest_previous = max((group.seconds for group in gt_groups if group.seconds < target_second), default=None)
    return {
        "target_second": round(target_second, 6),
        "matched": bool(
            nearest_candidate
            and abs(nearest_candidate[1].candidate_anchor_sample - target_sample)
            <= round(MATCH_TOLERANCE_SECONDS * SAMPLE_RATE)
        ),
        "nearest_candidate_anchor_sample": (
            None if nearest_candidate is None else nearest_candidate[1].candidate_anchor_sample
        ),
        "nearest_candidate_anchor_error_ms": (
            None if nearest_candidate is None else round(nearest_candidate[0] / SAMPLE_RATE * 1000.0, 6)
        ),
        "nearest_candidate_emit_delay_ms": (
            None
            if nearest_candidate is None
            else round(
                (nearest_candidate[1].candidate_emit_sample - target_sample)
                / SAMPLE_RATE
                * 1000.0,
                6,
            )
        ),
        "nearest_previous_gt_strike_second": (
            None if nearest_previous is None else round(nearest_previous, 6)
        ),
    }


def _unmatched_candidate_reports(
    candidates: tuple[StrikeCandidate, ...],
    gt_groups: tuple[MidiStrikeGroup, ...],
    *,
    source_start: float,
    used_candidate_indices: set[int],
) -> list[dict[str, object]]:
    reports = []
    gt_samples = [_relative_sample(group.seconds, source_start) for group in gt_groups]
    for index, candidate in enumerate(candidates):
        if index in used_candidate_indices:
            continue
        if gt_samples:
            nearest = min(gt_samples, key=lambda sample: abs(sample - candidate.candidate_anchor_sample))
            nearest_ms = abs(candidate.candidate_anchor_sample - nearest) / SAMPLE_RATE * 1000.0
        else:
            nearest_ms = None
        reports.append(
            {
                "candidate_anchor_sample": candidate.candidate_anchor_sample,
                "candidate_emit_sample": candidate.candidate_emit_sample,
                "nearest_gt_distance_ms": None if nearest_ms is None else round(nearest_ms, 6),
                "rms": round(candidate.rms, 8),
                "spectral_flux": round(candidate.spectral_flux, 8),
                "rms_gate": round(candidate.rms_gate, 8),
                "flux_gate": round(candidate.flux_gate, 8),
            }
        )
    return reports


def _attribute_gt_gate_blocks(
    gt_groups: tuple[MidiStrikeGroup, ...],
    frame_traces: tuple[FrameTrace, ...],
    *,
    source_start: float,
    matched_gt_indices: set[int],
) -> list[dict[str, object]]:
    reports = []
    window_pre = round(0.050 * SAMPLE_RATE)
    window_post = round(0.080 * SAMPLE_RATE)
    for gt_index, group in enumerate(gt_groups):
        gt_sample = _relative_sample(group.seconds, source_start)
        nearby = [
            trace
            for trace in frame_traces
            if gt_sample - window_pre <= trace.frame_start_sample <= gt_sample + window_post
        ]
        if not nearby:
            reports.append(
                {
                    "gt_second": round(group.seconds, 6),
                    "matched_by_candidate": gt_index in matched_gt_indices,
                    "primary_attribution": "no_detector_frame_in_window",
                    "best_rms_ratio": None,
                    "best_flux_ratio": None,
                    "passes_rms": False,
                    "passes_flux": False,
                    "passes_both": False,
                    "passes_all_including_refractory": False,
                    "multi_label_blocks": ("no_detector_frame_in_window",),
                }
            )
            continue
        best = max(nearby, key=_trace_score)
        labels = _block_labels(best)
        reports.append(
            {
                "gt_second": round(group.seconds, 6),
                "matched_by_candidate": gt_index in matched_gt_indices,
                "frame_start_sample": best.frame_start_sample,
                "frame_start_delta_ms": round(
                    (best.frame_start_sample - gt_sample) / SAMPLE_RATE * 1000.0,
                    6,
                ),
                "best_rms": round(best.rms, 8),
                "best_flux": round(best.spectral_flux, 8),
                "best_rms_gate": round(best.effective_rms_gate, 8),
                "best_flux_gate": round(best.effective_flux_gate, 8),
                "best_rms_ratio": _safe_ratio(best.rms, best.effective_rms_gate),
                "best_flux_ratio": _safe_ratio(best.spectral_flux, best.effective_flux_gate),
                "median_rms_baseline": round(best.median_rms_baseline, 8),
                "median_flux_baseline": round(best.median_flux_baseline, 8),
                "passes_rms": best.passes_rms,
                "passes_flux": best.passes_flux,
                "passes_both": best.passes_rms and best.passes_flux,
                "passes_all_including_refractory": best.would_emit,
                "primary_attribution": _primary_attribution(best),
                "multi_label_blocks": labels,
            }
        )
    return reports


def _trace_score(trace: FrameTrace) -> float:
    rms_ratio = _safe_ratio(trace.rms, trace.effective_rms_gate) or 0.0
    flux_ratio = _safe_ratio(trace.spectral_flux, trace.effective_flux_gate) or 0.0
    return min(rms_ratio, flux_ratio)


def _primary_attribution(trace: FrameTrace) -> str:
    if trace.would_emit:
        return "feature_passed_but_no_emit"
    if trace.passes_rms and trace.passes_flux and not trace.passes_refractory:
        return "refractory_only_block"
    if not trace.passes_rms and not trace.passes_flux:
        return "rms_and_flux_block"
    if not trace.passes_rms:
        return (
            "absolute_rms_floor_block"
            if trace.absolute_rms_floor >= trace.adaptive_rms_gate
            else "adaptive_rms_ratio_block"
        )
    if not trace.passes_flux:
        return (
            "absolute_flux_floor_block"
            if trace.absolute_flux_floor >= trace.adaptive_flux_gate
            else "adaptive_flux_ratio_block"
        )
    return "feature_passed_but_no_emit"


def _block_labels(trace: FrameTrace) -> tuple[str, ...]:
    labels: list[str] = []
    if not trace.passes_rms:
        labels.append(
            "absolute_rms_floor_block"
            if trace.absolute_rms_floor >= trace.adaptive_rms_gate
            else "adaptive_rms_ratio_block"
        )
    if not trace.passes_flux:
        labels.append(
            "absolute_flux_floor_block"
            if trace.absolute_flux_floor >= trace.adaptive_flux_gate
            else "adaptive_flux_ratio_block"
        )
    if trace.passes_rms and trace.passes_flux and not trace.passes_refractory:
        labels.append("refractory_only_block")
    if trace.would_emit:
        labels.append("feature_passed_but_no_emit")
    return tuple(labels)


def _audio_sanity(audio: np.ndarray, *, config: DetectorConfig) -> dict[str, object]:
    frame_rms = _frame_rms_values(audio, config=config)
    non_silent = [value for value in frame_rms if value >= 1e-4]
    return {
        "audio_absolute_peak": round(float(np.max(np.abs(audio))) if audio.size else 0.0, 8),
        "audio_rms": round(float(np.sqrt(np.mean(np.square(audio), dtype=np.float64))) if audio.size else 0.0, 8),
        "frame_rms_distribution": _quantiles(frame_rms),
        "non_silent_frame_rms_distribution": _quantiles(non_silent),
    }


def _frame_rms_values(audio: np.ndarray, *, config: DetectorConfig) -> list[float]:
    values = []
    for start in range(0, max(0, int(audio.size) - config.frame_size_samples + 1), config.hop_samples):
        frame = audio[start : start + config.frame_size_samples]
        values.append(float(np.sqrt(np.mean(np.square(frame), dtype=np.float64))))
    return values


def _frame_trace_summary(frame_traces: tuple[FrameTrace, ...]) -> dict[str, object]:
    return {
        "frame_count": len(frame_traces),
        "would_emit_count": sum(1 for trace in frame_traces if trace.would_emit),
        "passes_rms_count": sum(1 for trace in frame_traces if trace.passes_rms),
        "passes_flux_count": sum(1 for trace in frame_traces if trace.passes_flux),
        "passes_both_count": sum(
            1 for trace in frame_traces if trace.passes_rms and trace.passes_flux
        ),
        "rms_distribution": _quantiles([trace.rms for trace in frame_traces]),
        "flux_distribution": _quantiles([trace.spectral_flux for trace in frame_traces]),
        "median_rms_baseline_distribution": _quantiles(
            [trace.median_rms_baseline for trace in frame_traces]
        ),
        "median_flux_baseline_distribution": _quantiles(
            [trace.median_flux_baseline for trace in frame_traces]
        ),
    }


def _chunk_invariance_report(
    cases: list[tuple[Path, dict[str, object]]],
    *,
    config: DetectorConfig,
    chunk_specs: tuple[str, ...],
) -> dict[str, object]:
    failures = []
    checked = 0
    for manifest_path, case in cases:
        audio, sample_rate = _read_wav(_case_audio_path(case, manifest_path=manifest_path))
        if sample_rate != SAMPLE_RATE:
            raise ValueError(f"expected {SAMPLE_RATE}Hz WAV")
        reference = None
        for spec in chunk_specs:
            candidates, _, _ = _run_detector(audio, config=config, chunk_spec=spec)
            signature = tuple(
                (candidate.candidate_anchor_sample, candidate.candidate_emit_sample)
                for candidate in candidates
            )
            if reference is None:
                reference = signature
            elif signature != reference:
                failures.append(
                    {
                        "case_id": case.get("case_id"),
                        "case_kind": case.get("case_kind"),
                        "source_recording_id": case.get("source_audio_sha256"),
                        "chunk_spec": spec,
                        "reference_count": len(reference),
                        "candidate_count": len(signature),
                    }
                )
        checked += 1
    return {
        "chunk_specs": chunk_specs,
        "cases_checked": checked,
        "passed": not failures,
        "failures": failures[:20],
    }


def _chunk_ranges(length: int, *, chunk_spec: str):
    if chunk_spec == "irregular":
        pattern = (317, 743, 512, 991, 640, 683)
        offset = 0
        index = 0
        while offset < length:
            size = pattern[index % len(pattern)]
            yield offset, min(length, offset + size)
            offset += size
            index += 1
        return
    size = int(chunk_spec)
    for offset in range(0, length, size):
        yield offset, min(length, offset + size)


def _summarize_case_reports(case_reports: list[dict[str, object]]) -> dict[str, object]:
    gt_count = sum(int(report["gt_strike_group_count"]) for report in case_reports)
    gt_matched = sum(int(report["gt_matched_count"]) for report in case_reports)
    target_count = sum(int(report["target_count"]) for report in case_reports)
    target_matched = sum(int(report["target_matched_count"]) for report in case_reports)
    unmatched_per_minute_values = [float(report["unmatched_candidates_per_minute"]) for report in case_reports]
    duplicate_count = sum(int(report["duplicate_candidates_for_gt"]) for report in case_reports)
    by_kind = {}
    for kind in ("correct_strike", "correct_chord", "same_note_retrigger"):
        kind_reports = [report for report in case_reports if report["case_kind"] == kind]
        kind_targets = sum(int(report["target_count"]) for report in kind_reports)
        kind_matched = sum(int(report["target_matched_count"]) for report in kind_reports)
        by_kind[f"{kind}_target_recall"] = _ratio(kind_matched, kind_targets)
    anchor_errors = [value for report in case_reports for value in report["candidate_anchor_error_ms"]]
    emit_delays = [value for report in case_reports for value in report["candidate_emit_delay_ms"]]
    bucket_counts: Counter[str] = Counter()
    for report in case_reports:
        bucket_counts.update(report["unmatched_candidate_buckets"])
    return {
        "all_gt_strike_group_recall": _ratio(gt_matched, gt_count),
        "target_strike_recall": _ratio(target_matched, target_count),
        **by_kind,
        "unmatched_candidates_per_minute": _distribution(unmatched_per_minute_values),
        "duplicate_candidates_per_strike": _ratio(duplicate_count, gt_count),
        "candidate_anchor_error_ms": _signed_distribution(anchor_errors),
        "candidate_emit_delay_ms": _distribution(emit_delays),
        "unmatched_candidate_distance_buckets": dict(bucket_counts),
        "gate_diagnostics": _gate_diagnostics_summary(case_reports),
        "audio_sanity": _audio_sanity_summary(case_reports),
    }


def _per_source_summary(case_reports: list[dict[str, object]]) -> dict[str, object]:
    grouped: dict[str, list[dict[str, object]]] = defaultdict(list)
    for report in case_reports:
        grouped[str(report["source_recording_id"])].append(report)
    return {source: _summarize_case_reports(reports) for source, reports in grouped.items()}


def _failure_examples(case_reports: list[dict[str, object]]) -> list[dict[str, object]]:
    failures = []
    for report in case_reports:
        for target in report["target_reports"]:
            if target["matched"]:
                continue
            failures.append(
                {
                    "source": report["source_recording_id"],
                    "case": report["case_id"],
                    "case_kind": report["case_kind"],
                    "gt_strike_time": target["target_second"],
                    "nearest_candidate_anchor": target["nearest_candidate_anchor_sample"],
                    "anchor_error_ms": target["nearest_candidate_anchor_error_ms"],
                    "emit_delay_ms": target["nearest_candidate_emit_delay_ms"],
                    "nearest_previous_gt_strike": target["nearest_previous_gt_strike_second"],
                }
            )
    return failures[:80]


def _combine_summaries(splits: dict[str, object]) -> dict[str, object]:
    cases = []
    for split in splits.values():
        cases.extend(split["cases"])
    return {
        "case_count": len(cases),
        "source_count": len({report["source_recording_id"] for report in cases}),
        "summary": _summarize_case_reports(cases),
    }


def _gate_diagnostics_summary(case_reports: list[dict[str, object]]) -> dict[str, object]:
    attributions = [
        attribution
        for report in case_reports
        for attribution in report.get("gate_attribution", ())
    ]
    missed = [item for item in attributions if not item.get("matched_by_candidate")]
    return {
        "all_gt": _gate_diagnostics_for_attributions(attributions),
        "missed_gt": _gate_diagnostics_for_attributions(missed),
    }


def _gate_diagnostics_for_attributions(attributions: list[dict[str, object]]) -> dict[str, object]:
    primary = Counter(str(item["primary_attribution"]) for item in attributions)
    labels: Counter[str] = Counter()
    for item in attributions:
        labels.update(item.get("multi_label_blocks", ()))
    return {
        "gt_near_frame_rms": _quantiles([float(item["best_rms"]) for item in attributions if item.get("best_rms") is not None]),
        "gt_near_frame_spectral_flux": _quantiles(
            [float(item["best_flux"]) for item in attributions if item.get("best_flux") is not None]
        ),
        "rms_to_effective_gate_ratio": _quantiles(
            [
                float(item["best_rms_ratio"])
                for item in attributions
                if item.get("best_rms_ratio") is not None
            ]
        ),
        "flux_to_effective_gate_ratio": _quantiles(
            [
                float(item["best_flux_ratio"])
                for item in attributions
                if item.get("best_flux_ratio") is not None
            ]
        ),
        "median_rms_baseline": _quantiles(
            [
                float(item["median_rms_baseline"])
                for item in attributions
                if item.get("median_rms_baseline") is not None
            ]
        ),
        "median_flux_baseline": _quantiles(
            [
                float(item["median_flux_baseline"])
                for item in attributions
                if item.get("median_flux_baseline") is not None
            ]
        ),
        "primary_attribution_counts": dict(primary),
        "multi_label_block_counts": dict(labels),
        "passes_rms_count": sum(1 for item in attributions if item.get("passes_rms")),
        "passes_flux_count": sum(1 for item in attributions if item.get("passes_flux")),
        "passes_both_count": sum(1 for item in attributions if item.get("passes_both")),
        "passes_all_including_refractory_count": sum(
            1 for item in attributions if item.get("passes_all_including_refractory")
        ),
    }


def _audio_sanity_summary(case_reports: list[dict[str, object]]) -> dict[str, object]:
    return {
        "audio_absolute_peak": _quantiles(
            [float(report["audio_sanity"]["audio_absolute_peak"]) for report in case_reports]
        ),
        "audio_rms": _quantiles([float(report["audio_sanity"]["audio_rms"]) for report in case_reports]),
        "non_silent_frame_rms_median_by_case": _quantiles(
            [
                float(report["audio_sanity"]["non_silent_frame_rms_distribution"]["median"])
                for report in case_reports
                if report["audio_sanity"]["non_silent_frame_rms_distribution"]["median"] is not None
            ]
        ),
    }


def _bucket_unmatched_candidates(unmatched: list[dict[str, object]]) -> dict[str, int]:
    buckets = {"0-100ms": 0, "100-300ms": 0, "300-1000ms": 0, ">1000ms": 0}
    for candidate in unmatched:
        distance = candidate["nearest_gt_distance_ms"]
        if distance is None or distance > 1000:
            buckets[">1000ms"] += 1
        elif distance <= 100:
            buckets["0-100ms"] += 1
        elif distance <= 300:
            buckets["100-300ms"] += 1
        else:
            buckets["300-1000ms"] += 1
    return buckets


def _relative_sample(seconds: float, source_start: float) -> int:
    return int(round((seconds - source_start) * SAMPLE_RATE))


def _nearest_candidate(
    target_sample: int,
    candidates: tuple[StrikeCandidate, ...],
) -> tuple[int, StrikeCandidate] | None:
    if not candidates:
        return None
    candidate = min(candidates, key=lambda item: abs(item.candidate_anchor_sample - target_sample))
    return abs(candidate.candidate_anchor_sample - target_sample), candidate


def _median_or_zero(values: deque[float]) -> float:
    return float(np.median(np.asarray(values, dtype=np.float64))) if values else 0.0


def _safe_ratio(numerator: float, denominator: float) -> float | None:
    if denominator == 0:
        return None
    return round(float(numerator / denominator), 8)


def _ratio(numerator: int | float, denominator: int | float) -> dict[str, object]:
    return {
        "count": numerator,
        "total": denominator,
        "rate": None if denominator == 0 else numerator / denominator,
    }


def _distribution(values: list[float] | list[int]) -> dict[str, object]:
    if not values:
        return {"count": 0, "mean": None, "median": None, "p95": None, "max": None}
    array = np.asarray(values, dtype=np.float64)
    return {
        "count": int(array.size),
        "mean": round(float(np.mean(array)), 6),
        "median": round(float(np.median(array)), 6),
        "p95": round(float(np.percentile(array, 95)), 6),
        "max": round(float(np.max(array)), 6),
    }


def _quantiles(values: list[float] | list[int]) -> dict[str, object]:
    if not values:
        return {"count": 0, "p10": None, "median": None, "p90": None}
    array = np.asarray(values, dtype=np.float64)
    return {
        "count": int(array.size),
        "p10": round(float(np.percentile(array, 10)), 8),
        "median": round(float(np.median(array)), 8),
        "p90": round(float(np.percentile(array, 90)), 8),
    }


def _signed_distribution(values: list[float]) -> dict[str, object]:
    base = _distribution(values)
    if values:
        array = np.asarray(values, dtype=np.float64)
        base.update(
            {
                "min": round(float(np.min(array)), 6),
                "signed_mean": round(float(np.mean(array)), 6),
            }
        )
    else:
        base.update({"min": None, "signed_mean": None})
    return base


def _console_summary(report: dict[str, object], output: Path) -> dict[str, object]:
    return {
        "output": str(output),
        "development": report["splits"]["development"]["summary"],
        "calibration": report["splits"]["calibration"]["summary"],
        "chunk_boundary_invariant": report["chunk_boundary_invariant"],
    }


if __name__ == "__main__":
    raise SystemExit(main())
