"""Research-only parity check for ByteDanceRollingStepVerifier.

This script compares the adapter contract against the existing
``evaluate_bytedance_score_aware_rolling_step.py`` temporally-bound formulation.
It is not production integration and does not use the frozen evaluation set.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.processing.engines.practice_alignment.bytedance_step_verifier import (  # noqa: E402
    ByteDanceRawOutput,
    ByteDanceRollingStepVerifier,
)
from app.processing.engines.practice_alignment.step_microphone_verifier import (  # noqa: E402
    StepVerifierTarget,
)
from compare_step_microphone_frontends_causal_cases import (  # noqa: E402
    ByteDancePianoTranscriptionProvider,
    _case_audio_path,
    _case_source_identity,
    _read_wav,
)
from evaluate_bytedance_direct_note_frontend import (  # noqa: E402
    _checkpoint_path,
    _sha256,
    _validate_policy,
    _warm_up_note_model,
)
from evaluate_bytedance_rolling_step_events import (  # noqa: E402
    FUTURE_SECONDS,
    INITIALIZATION_PRE_SECONDS,
    RETRIGGER_MAX_DELTA_SECONDS,
    RETRIGGER_MIN_DELTA_SECONDS,
    SAMPLE_RATE,
    _direct_note_forward_batch,
)
from evaluate_bytedance_score_aware_rolling_step import (  # noqa: E402
    _score_aware_cases_from_manifest_case,
    _summary,
)


FRAME_RULE_NAME = "temporally_bound"
CHUNK_SAMPLES = 512


class DirectNoteBackend:
    def __init__(self, provider: ByteDancePianoTranscriptionProvider, *, device: str) -> None:
        self.provider = provider
        self.device = device

    def infer_note_model(
        self,
        clips: tuple[np.ndarray, ...],
        *,
        sample_rate: int,
    ) -> tuple[ByteDanceRawOutput, ...]:
        raw_outputs, _latency = _direct_note_forward_batch(
            self.provider,
            list(clips),
            sample_rate,
            device=self.device,
        )
        return tuple(
            ByteDanceRawOutput(
                reg_onset_output=raw["onset"],
                frame_output=raw["frame"],
            )
            for raw in raw_outputs
        )


class AdapterReplay:
    def __init__(self, audio: np.ndarray, backend: DirectNoteBackend) -> None:
        self.audio = audio
        self.verifier = ByteDanceRollingStepVerifier(backend)
        self.cursor = 0
        self.inactive_target = StepVerifierTarget(
            step_id="inactive",
            attack_pitches=(),
            continuation_pitches=(),
        )

    def feed_until(self, end_sample: int, target: StepVerifierTarget) -> list:
        observations = []
        bounded_end = min(max(end_sample, self.cursor), int(self.audio.size))
        while self.cursor < bounded_end:
            next_cursor = min(bounded_end, self.cursor + CHUNK_SAMPLES)
            chunk = _float_audio_to_pcm16(self.audio[self.cursor:next_cursor])
            observation = self.verifier.observe_audio(chunk, target=target)
            if observation is not None:
                observations.append(observation)
            self.cursor = next_cursor
        return observations

    def first_match(
        self,
        *,
        step_id: str,
        attack_pitches: tuple[str, ...],
        continuation_pitches: tuple[str, ...],
        active_from: float,
        active_until: float | None,
        event_min_time: float | None,
        event_max_time: float | None,
    ) -> dict[str, object] | None:
        active_sample = _seconds_to_samples(active_from)
        self.feed_until(active_sample, self.inactive_target)
        target = StepVerifierTarget(
            step_id=step_id,
            attack_pitches=attack_pitches,
            continuation_pitches=continuation_pitches,
        )
        if active_until is None:
            end_sample = int(self.audio.size)
        else:
            end_sample = min(
                int(self.audio.size),
                _seconds_to_samples(active_until + FUTURE_SECONDS + 0.150),
            )
        while self.cursor < end_sample:
            observations = self.feed_until(min(end_sample, self.cursor + CHUNK_SAMPLES), target)
            for observation in observations:
                if _observation_in_event_bounds(
                    observation,
                    event_min_time=event_min_time,
                    event_max_time=event_max_time,
                ):
                    return _match_from_observation(observation)
        return None


def main() -> int:
    args = parse_args()
    policy_artifact = json.loads(args.policy.read_text(encoding="utf-8"))
    _validate_policy(policy_artifact)
    frontend = policy_artifact["frontend"]
    checkpoint_path = _checkpoint_path(frontend)
    checkpoint_sha256 = _sha256(checkpoint_path)
    if checkpoint_sha256 != frontend["checkpoint_sha256"]:
        raise ValueError(
            "ByteDance checkpoint SHA256 mismatch: "
            f"expected {frontend['checkpoint_sha256']}, got {checkpoint_sha256}"
        )

    provider = ByteDancePianoTranscriptionProvider(
        checkpoint_path=checkpoint_path,
        device=args.device,
    )
    _warm_up_note_model(provider, device=args.device)
    backend = DirectNoteBackend(provider, device=args.device)

    reference_report = json.loads(args.reference_report.read_text(encoding="utf-8"))
    cases = [
        (manifest_path, case)
        for manifest_path in args.case_manifest
        for case in json.loads(manifest_path.read_text(encoding="utf-8")).get("cases", ())
    ]
    if args.case_limit is not None:
        cases = cases[: args.case_limit]
    evaluations = [
        _evaluate_case_with_adapter(manifest_path, case, backend=backend)
        for manifest_path, case in cases
    ]
    diffs = _diff_against_reference(evaluations, reference_report)
    report = {
        "benchmark_scope": "bytedance_step_verifier_adapter_parity_dev_cal",
        "scope_wording": (
            "Research-only adapter parity check. The adapter uses StepVerifierTarget "
            "and PCM chunks. It does not define final production handoff semantics."
        ),
        "constraints": {
            "production_modified": False,
            "production_verifier_enabled": False,
            "frozen_evaluation_used": False,
            "threshold_tuning": False,
            "cadence_tuning": False,
            "dedupe_tuning": False,
            "event_rule": FRAME_RULE_NAME,
        },
        "integration_question_left_open": (
            "Final verifier-driven progression still needs an explicit accepted-event "
            "to consumed-boundary handoff design."
        ),
        "case_manifests": [str(path) for path in args.case_manifest],
        "case_count": len(cases),
        "summary_by_event_rule": {FRAME_RULE_NAME: _summary(evaluations, rule_name=FRAME_RULE_NAME)},
        "parity": {
            "reference_report": str(args.reference_report),
            "diff_count": len(diffs),
            "diffs": diffs,
        },
        "evaluations": evaluations,
    }
    text = json.dumps(report, ensure_ascii=False, indent=2)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(text + "\n", encoding="utf-8")
    print(text)
    return 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--policy", type=Path, required=True)
    parser.add_argument("--case-manifest", type=Path, action="append", required=True)
    parser.add_argument("--reference-report", type=Path, required=True)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--device", default="cuda")
    parser.add_argument(
        "--case-limit",
        type=int,
        default=None,
        help="Run only the first N manifest cases for CPU-only smoke parity checks.",
    )
    return parser.parse_args()


def _evaluate_case_with_adapter(
    manifest_path: Path,
    case: dict[str, object],
    *,
    backend: DirectNoteBackend,
) -> dict[str, object]:
    audio_path = _case_audio_path(case, manifest_path=manifest_path)
    audio, sample_rate = _read_wav(audio_path)
    if sample_rate != SAMPLE_RATE:
        raise ValueError(f"expected {SAMPLE_RATE} Hz case audio, got {sample_rate}: {audio_path}")
    source_start = float((case.get("source_time_range_seconds") or (0.0,))[0])
    source_id = str(_case_source_identity(case)["source_recording_id"])
    expected_groups = tuple(tuple(group) for group in case.get("expected_groups", ()))
    actual_groups = tuple(tuple(group) for group in case.get("actual_groups", ()))
    target_seconds = tuple(float(value) for value in case.get("target_group_seconds", ()))
    target_relative = tuple(max(0.0, value - source_start) for value in target_seconds)
    score_cases = _score_aware_cases_from_manifest_case(
        case,
        case_kind=str(case.get("case_kind")),
        source_recording_id=source_id,
        expected_groups=expected_groups,
        actual_groups=actual_groups,
        target_relative=target_relative,
        source_start=source_start,
    )
    results = [_evaluate_score_case_with_adapter(score_case, audio, backend=backend) for score_case in score_cases]
    return {
        "case_id": case.get("case_id"),
        "case_kind": str(case.get("case_kind")),
        "source_identity": _case_source_identity(case),
        "score_case_count": len(score_cases),
        "score_cases": score_cases,
        "results_by_event_rule": {FRAME_RULE_NAME: results},
    }


def _evaluate_score_case_with_adapter(
    score_case: dict[str, object],
    audio: np.ndarray,
    *,
    backend: DirectNoteBackend,
) -> dict[str, object]:
    replay = AdapterReplay(audio, backend)
    family = str(score_case["family"])
    if "target_time" in score_case:
        target = float(score_case["target_time"])
        match = replay.first_match(
            step_id=str(score_case.get("transition_key") or f"{family}:{target:.6f}"),
            attack_pitches=tuple(score_case["attack_required"]),
            continuation_pitches=tuple(score_case["continuation"]),
            active_from=max(0.0, target - INITIALIZATION_PRE_SECONDS),
            active_until=target + RETRIGGER_MAX_DELTA_SECONDS,
            event_min_time=target + RETRIGGER_MIN_DELTA_SECONDS,
            event_max_time=target + RETRIGGER_MAX_DELTA_SECONDS,
        )
        auto_advanced = match is not None
        return {
            "family": family,
            "expected_auto_advance": bool(score_case["expected_auto_advance"]),
            "future_target_contaminated": bool(score_case.get("future_target_contaminated", False)),
            "transition_key": score_case.get("transition_key"),
            "auto_advanced": auto_advanced,
            "false_automatic_advance": auto_advanced and not bool(score_case["expected_auto_advance"]),
            "missed_expected_advance": (not auto_advanced) and bool(score_case["expected_auto_advance"]),
            "match": match,
            "score_case": score_case,
        }

    first = replay.first_match(
        step_id=f"{score_case.get('transition_key')}:first",
        attack_pitches=tuple(score_case["first_expected_group"]),
        continuation_pitches=(),
        active_from=max(0.0, float(score_case["first_target_time"]) - INITIALIZATION_PRE_SECONDS),
        active_until=float(score_case["first_target_time"]) + RETRIGGER_MAX_DELTA_SECONDS,
        event_min_time=float(score_case["first_target_time"]) + RETRIGGER_MIN_DELTA_SECONDS,
        event_max_time=float(score_case["first_target_time"]) + RETRIGGER_MAX_DELTA_SECONDS,
    )
    if first is None:
        return {
            "family": family,
            "first_advance_established": False,
            "auto_advanced": False,
            "false_automatic_advance": False,
            "missed_expected_advance": bool(score_case["expected_auto_advance"]),
            "score_case": score_case,
        }
    second = replay.first_match(
        step_id=f"{score_case.get('transition_key')}:second",
        attack_pitches=tuple(score_case["second_attack_required"]),
        continuation_pitches=tuple(score_case["second_continuation"]),
        active_from=float(first["decision_time"]),
        active_until=None,
        event_min_time=None,
        event_max_time=None,
    )
    auto_advanced = second is not None
    classification = None
    if second is not None and "second_target_time" in score_case:
        delta = float(second["latest_event_time"]) - float(score_case["second_target_time"])
        if delta < RETRIGGER_MIN_DELTA_SECONDS:
            classification = "PREMATURE_FALSE_ADVANCE"
        elif delta <= RETRIGGER_MAX_DELTA_SECONDS:
            classification = "LEGITIMATE_ADVANCE"
        else:
            classification = "LATE_OR_STALE_MATCH"
    return {
        "family": family,
        "first_advance_established": True,
        "expected_auto_advance": bool(score_case["expected_auto_advance"]),
        "future_target_contaminated": bool(score_case.get("future_target_contaminated", False)),
        "transition_key": score_case.get("transition_key"),
        "auto_advanced": auto_advanced,
        "false_automatic_advance": (
            auto_advanced
            and (
                not bool(score_case["expected_auto_advance"])
                or classification == "PREMATURE_FALSE_ADVANCE"
            )
        ),
        "missed_expected_advance": (
            (not auto_advanced or classification in {"PREMATURE_FALSE_ADVANCE", "LATE_OR_STALE_MATCH"})
            and bool(score_case["expected_auto_advance"])
        ),
        "second_classification": classification,
        "first_match": first,
        "second_match": second,
        "score_case": score_case,
    }


def _match_from_observation(observation) -> dict[str, object]:
    latest_event_time = max(float(event.event_time_seconds) for event in observation.events)
    earliest_event_time = min(float(event.event_time_seconds) for event in observation.events)
    decision_time = float(observation.decision_time_seconds or latest_event_time)
    return {
        "decision_time": round(decision_time, 6),
        "expected_pitches": observation.observed_attack_pitches,
        "event_rule": "frame_at_onset_peak",
        "events": [
            {
                "pitch": event.pitch,
                "event_time": round(event.event_time_seconds, 6),
                "onset_peak_time": round(event.event_time_seconds, 6),
                "onset_peak_score": round(float(event.onset_score), 6),
                "frame_score_at_onset_peak": round(float(event.frame_score), 6),
                "frame_score_used": round(float(event.frame_score), 6),
                "event_sample_index": event.event_sample_index,
            }
            for event in observation.events
        ],
        "earliest_event_time": round(earliest_event_time, 6),
        "latest_event_time": round(latest_event_time, 6),
        "latest_event_time_before_dedupe": round(latest_event_time, 6),
        "consumed_through_time": round(latest_event_time + 0.050, 6),
        "event_dedupe_ms": 50,
        "matched_expected": observation.observed_attack_pitches,
        "missing_expected": (),
        "extra_observed": (),
    }


def _observation_in_event_bounds(
    observation,
    *,
    event_min_time: float | None,
    event_max_time: float | None,
) -> bool:
    for event in observation.events:
        event_time = float(event.event_time_seconds)
        if event_min_time is not None and event_time < event_min_time - 1e-9:
            return False
        if event_max_time is not None and event_time > event_max_time + 1e-9:
            return False
    return True


def _float_audio_to_pcm16(audio: np.ndarray) -> bytes:
    clipped = np.clip(audio, -1.0, 1.0)
    return (clipped * 32767.0).astype(np.int16).tobytes()


def _seconds_to_samples(seconds: float) -> int:
    return int(round(seconds * SAMPLE_RATE))


def _diff_against_reference(
    evaluations: list[dict[str, object]],
    reference_report: dict[str, object],
) -> list[dict[str, object]]:
    diffs = []
    reference_evaluations = reference_report.get("evaluations", [])
    for adapter_case, reference_case in zip(evaluations, reference_evaluations, strict=False):
        adapter_results = adapter_case["results_by_event_rule"][FRAME_RULE_NAME]
        reference_results = reference_case["results_by_event_rule"][FRAME_RULE_NAME]
        for index, (adapter, reference) in enumerate(
            zip(adapter_results, reference_results, strict=False)
        ):
            if _decision_signature(adapter) == _decision_signature(reference):
                continue
            diffs.append(
                {
                    "case_id": adapter_case.get("case_id"),
                    "case_kind": adapter_case.get("case_kind"),
                    "score_case_index": index,
                    "transition_key": adapter.get("transition_key"),
                    "old_decision": _decision_signature(reference),
                    "adapter_decision": _decision_signature(adapter),
                    "old_event_time": _extract_event_time(reference),
                    "adapter_event_time": _extract_event_time(adapter),
                    "reason": "adapter decision/event differs from saved temporally_bound reference",
                }
            )
    return diffs


def _decision_signature(result: dict[str, object]) -> dict[str, object]:
    return {
        "auto_advanced": result.get("auto_advanced"),
        "false_automatic_advance": result.get("false_automatic_advance"),
        "missed_expected_advance": result.get("missed_expected_advance"),
        "second_classification": result.get("second_classification"),
        "first_advance_established": result.get("first_advance_established"),
    }


def _extract_event_time(result: dict[str, object]) -> float | None:
    for key in ("match", "second_match", "first_match"):
        match = result.get(key)
        if isinstance(match, dict) and "latest_event_time" in match:
            return float(match["latest_event_time"])
    return None


if __name__ == "__main__":
    raise SystemExit(main())
