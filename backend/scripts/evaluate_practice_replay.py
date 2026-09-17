"""Replay real practice audio against Matchmaker and emit a JSON report."""

from __future__ import annotations

import argparse
from dataclasses import asdict
import hashlib
import json
from pathlib import Path
import time
import wave
import xml.etree.ElementTree as ET

import numpy as np

from app.processing.engines.practice_alignment.acoustic_evidence_provider import (
    AcousticEvidenceProvider,
)
from app.processing.engines.practice_alignment.matchmaker_live import MatchmakerLiveEngine
from app.processing.engines.practice_alignment.expected_event_evaluator import (
    EvaluatorEvidence,
    ExpectedEventEvaluator,
)
from app.processing.engines.practice_alignment.profile import (
    DEFAULT_PRACTICE_AUDIO_PROFILE,
    PRACTICE_ALIGNMENT_RUNTIME_PROFILE_ID,
)
from app.processing.engines.practice_alignment.target_catalog import (
    practice_target_catalog_from_musicxml,
)
from app.processing.engines.practice_alignment.target_conditioned_acoustic_observation import (
    TargetConditionedPianoObserver,
)
from app.processing.engines.practice_alignment.transcription_midi_evidence_provider import (
    DEFAULT_TRANSCRIPTION_MIDI_PROVIDER_ID,
    TranscriptionMidiEvidenceProvider,
)
from app.processing.practice_score.score_loader import practice_score_timeline_from_musicxml


RELIABLE_ALIGNMENT_CONFIDENCE = 0.75
SHADOW_RUNTIME_WINDOW_SECONDS = 0.5
SHADOW_RUNTIME_HOP_SECONDS = 0.1
SHADOW_RUNTIME_MAX_ATTEMPT_SECONDS = 1.2
BENCHMARK_SCOPE_BASELINE_RUNTIME = "baseline_runtime_replay"
BENCHMARK_SCOPE_OBSERVER_WINDOW = "observer_window_replay"
BENCHMARK_SCOPE_CAUSAL_SHADOW_RUNTIME = "causal_shadow_runtime_replay"
BENCHMARK_SCOPE_OFFLINE_SCORE_ALIGNED_ORACLE = "offline_score_aligned_oracle"

BENCHMARK_METRIC_PRIORITY = (
    "false_match_count",
    "score_expected_strike_coverage",
    "expected_strike_recall",
    "expected_strike_precision",
    "chord_complete_detection_rate",
    "median_time_to_match_ms",
    "p95_time_to_match_ms",
    "per_pitch_extra_rate",
    "uncertain_rate",
)
PROGRESSION_AUTHORITY_BENCHMARK_SCOPES = {
    BENCHMARK_SCOPE_BASELINE_RUNTIME,
    BENCHMARK_SCOPE_CAUSAL_SHADOW_RUNTIME,
}
PHYSICAL_GROUND_TRUTH_SOURCES = {"paired_midi", "synthetic"}


def slim_alignment_update(update: dict) -> dict:
    decision = update.get("decision") or {}
    anchor = decision.get("display_anchor") or {}
    return {
        "beat_position": update.get("beat_position"),
        "confidence": update.get("confidence"),
        "alignment_confidence": update.get("alignment_confidence"),
        "audio_confidence": update.get("audio_confidence"),
        "continuity_confidence": update.get("continuity_confidence"),
        "validation_confidence": update.get("validation_confidence"),
        "input_policy_confidence": update.get("input_policy_confidence"),
        "feature_confidence": update.get("feature_confidence"),
        "match_state": update.get("match_state"),
        "alignment_state": update.get("alignment_state"),
        "continuity_state": update.get("continuity_state"),
        "beat_delta": update.get("beat_delta"),
        "scope_completed": update.get("scope_completed", False),
        "decision_action": decision.get("action"),
        "decision_reason": decision.get("reason"),
        "decision_anchor_beat": anchor.get("beat"),
        "attempt_state": decision.get("attempt_state"),
        "attempt_sequence": decision.get("attempt_sequence"),
        "attempt_started_at_ms": decision.get("attempt_started_at_ms"),
        "attempt_resolved_at_ms": decision.get("attempt_resolved_at_ms"),
        "evaluator_version": decision.get("evaluator_version"),
        "evaluation_result": decision.get("evaluation_result"),
        "matched_pitches": decision.get("matched_pitches"),
        "missing_pitches": decision.get("missing_pitches"),
        "extra_pitches": decision.get("extra_pitches"),
    }


def decision_counts(updates: list[dict]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for update in updates:
        decision = update.get("decision") or {}
        key = f"{decision.get('action', 'missing')}:{decision.get('reason', 'missing')}"
        counts[key] = counts.get(key, 0) + 1
    return counts


def accepted_alignment_events(
    updates: list[dict],
    update_samples: list[int],
    sample_rate: int,
) -> list[dict]:
    events: list[dict] = []
    for index, update in enumerate(updates):
        decision = update.get("decision") or {}
        if decision.get("action") != "advance":
            continue
        anchor = decision.get("display_anchor") or {}
        anchor_beat = anchor.get("beat")
        if anchor_beat is None:
            continue
        events.append(
            {
                "update_index": index,
                "seconds": round(update_samples[index] / sample_rate, 3),
                "anchor_beat": float(anchor_beat),
                "action": decision.get("action"),
                "reason": decision.get("reason"),
                "confidence": update.get("confidence"),
            }
        )
    return events


def attempt_events(
    updates: list[dict],
    update_samples: list[int],
    sample_rate: int,
    target_contexts: dict[str, dict] | None = None,
) -> list[dict]:
    events: list[dict] = []
    for index, update in enumerate(updates):
        decision = update.get("decision") or {}
        attempt_sequence = decision.get("attempt_sequence")
        if attempt_sequence is None:
            continue
        anchor = decision.get("display_anchor") or {}
        event = {
            "update_index": index,
            "seconds": round(update_samples[index] / sample_rate, 3),
            "beat_position": update.get("beat_position"),
            "anchor_beat": anchor.get("beat"),
            "attempt_state": decision.get("attempt_state"),
            "attempt_sequence": attempt_sequence,
            "attempt_started_at_ms": decision.get("attempt_started_at_ms"),
            "attempt_resolved_at_ms": decision.get("attempt_resolved_at_ms"),
            "decision_action": decision.get("action"),
            "decision_reason": decision.get("reason"),
            "experience_state": decision.get("experience_state"),
            "evaluator_version": decision.get("evaluator_version"),
            "evaluation_result": decision.get("evaluation_result"),
            "matched_pitches": decision.get("matched_pitches"),
            "missing_pitches": decision.get("missing_pitches"),
            "extra_pitches": decision.get("extra_pitches"),
            "scope_completed": update.get("scope_completed", False),
            "confidence": update.get("confidence"),
            "validation_confidence": update.get("validation_confidence"),
            "input_policy_confidence": update.get("input_policy_confidence"),
            "gate_reason": update.get("gate_reason"),
            "queue_decision": update.get("queue_decision"),
            "tonal_signal": update.get("tonal_signal"),
            "onset_signal": update.get("onset_signal"),
            "alignment_state": update.get("alignment_state"),
        }
        if target_contexts is not None:
            event.update(_attempt_target_context(event, anchor, target_contexts))
        events.append(event)
    return events


def target_contexts_from_score(score_path: Path) -> dict[str, dict]:
    measure_start_beats = _measure_start_beats(score_path)
    catalog = practice_target_catalog_from_musicxml(score_path)
    contexts: dict[str, dict] = {}
    for target in catalog.targets:
        measure_number = target.measure_numbers[0] if target.measure_numbers else None
        measure_start = (
            None if measure_number is None else measure_start_beats.get(measure_number)
        )
        contexts[target.group_id] = {
            "index": target.index,
            "group_id": target.group_id,
            "onset_beat": target.onset_beat,
            "measure_number": measure_number,
            "beat_in_measure": (
                None
                if measure_start is None
                else round(float(target.onset_beat) - measure_start + 1.0, 3)
            ),
            "expected_pitches": list(target.pitches),
            "render_note_ids": list(target.render_note_ids),
        }
    return contexts


def _attempt_target_context(
    event: dict,
    anchor: dict,
    contexts_by_group_id: dict[str, dict],
) -> dict:
    display_group_id = anchor.get("group_id")
    display_context = _context_for_group_id(display_group_id, contexts_by_group_id)
    evaluated_context = display_context
    if (
        event.get("decision_action") == "advance"
        and event.get("evaluation_result") == "MATCH"
        and not event.get("scope_completed")
        and display_context is not None
    ):
        evaluated_context = _context_by_index(
            int(display_context["index"]) - 1,
            contexts_by_group_id,
        )
    return {
        "display_target": display_context,
        "evaluated_target": evaluated_context,
    }


def _context_for_group_id(group_id: str | None, contexts_by_group_id: dict[str, dict]) -> dict | None:
    if group_id is None:
        return None
    return contexts_by_group_id.get(group_id)


def _context_by_index(index: int, contexts_by_group_id: dict[str, dict]) -> dict | None:
    return next(
        (
            context
            for context in contexts_by_group_id.values()
            if int(context["index"]) == index
        ),
        None,
    )


def benchmark_summary(
    attempts: list[dict],
    annotated_events: dict | None = None,
    *,
    benchmark_scope: str = BENCHMARK_SCOPE_BASELINE_RUNTIME,
    ground_truth_source: str = "score_expectation",
) -> dict:
    resolved_attempts = [
        attempt
        for attempt in attempts
        if attempt.get("attempt_state") == "resolved"
        and attempt.get("evaluation_result") is not None
    ]
    expected_strikes = sum(_expected_strike_count(attempt) for attempt in resolved_attempts)
    matched_strikes = sum(len(attempt.get("matched_pitches") or []) for attempt in resolved_attempts)
    extra_pitches = sum(len(attempt.get("extra_pitches") or []) for attempt in resolved_attempts)
    chord_attempts = [
        attempt for attempt in resolved_attempts if _expected_strike_count(attempt) > 1
    ]
    complete_chord_attempts = [
        attempt
        for attempt in chord_attempts
        if attempt.get("evaluation_result") == "MATCH"
        and len(attempt.get("missing_pitches") or []) == 0
    ]
    match_latencies = [
        resolved_at - started_at
        for attempt in resolved_attempts
        if attempt.get("evaluation_result") == "MATCH"
        and (started_at := attempt.get("attempt_started_at_ms")) is not None
        and (resolved_at := attempt.get("attempt_resolved_at_ms")) is not None
        and resolved_at >= started_at
    ]
    progression_authority = benchmark_scope in PROGRESSION_AUTHORITY_BENCHMARK_SCOPES
    offline_score_aligned = benchmark_scope == BENCHMARK_SCOPE_OFFLINE_SCORE_ALIGNED_ORACLE
    has_physical_ground_truth = ground_truth_source in PHYSICAL_GROUND_TRUTH_SOURCES
    false_match_count = sum(
        1
        for attempt in attempts
        if attempt.get("decision_action") == "advance"
        and attempt.get("evaluation_result") not in {None, "MATCH"}
    )
    annotated_false_advance_count = sum(
        int(metrics.get("accepted_outside_region", 0))
        for metrics in (annotated_events or {}).values()
    )
    uncertain_attempts = sum(
        1 for attempt in resolved_attempts if attempt.get("evaluation_result") == "UNCERTAIN"
    )

    scope_metadata = _benchmark_scope_metadata(benchmark_scope)
    return {
        "benchmark_scope": benchmark_scope,
        **scope_metadata,
        "ground_truth_source": ground_truth_source,
        "progression_authority": progression_authority,
        "metric_priority": list(BENCHMARK_METRIC_PRIORITY),
        "attempt_count": len(resolved_attempts),
        "expected_strike_count": expected_strikes,
        "matched_strike_count": matched_strikes,
        "extra_pitch_count": extra_pitches,
        "false_match_count": None if offline_score_aligned else false_match_count,
        "false_advance_guard_count": false_match_count if progression_authority else None,
        "annotated_false_advance_count": annotated_false_advance_count,
        "score_expected_strike_coverage": _ratio(matched_strikes, expected_strikes),
        "expected_strike_recall": _ratio(matched_strikes, expected_strikes)
        if has_physical_ground_truth
        else None,
        "expected_strike_precision": _ratio(matched_strikes, matched_strikes + extra_pitches)
        if has_physical_ground_truth
        else None,
        "chord_attempt_count": len(chord_attempts),
        "chord_complete_detection_rate": _ratio(
            len(complete_chord_attempts),
            len(chord_attempts),
        ),
        "per_pitch_extra_rate": _ratio(extra_pitches, expected_strikes),
        "median_time_to_match_ms": None
        if offline_score_aligned
        else _percentile(match_latencies, 50),
        "p95_time_to_match_ms": None
        if offline_score_aligned
        else _percentile(match_latencies, 95),
        "uncertain_rate": _ratio(uncertain_attempts, len(resolved_attempts)),
        "diagnostic_reason_counts": diagnostic_reason_counts(attempts),
    }


def _benchmark_scope_metadata(benchmark_scope: str) -> dict[str, object]:
    if benchmark_scope == BENCHMARK_SCOPE_BASELINE_RUNTIME:
        return {
            "causal": True,
            "uses_future_context": False,
            "evidence_horizon_ms": 0,
        }
    if benchmark_scope == BENCHMARK_SCOPE_CAUSAL_SHADOW_RUNTIME:
        return {
            "causal": True,
            "uses_future_context": False,
            "evidence_horizon_ms": int(round(SHADOW_RUNTIME_WINDOW_SECONDS * 1000)),
        }
    if benchmark_scope == BENCHMARK_SCOPE_OBSERVER_WINDOW:
        return {
            "causal": False,
            "uses_future_context": True,
            "evidence_horizon_ms": None,
        }
    if benchmark_scope == BENCHMARK_SCOPE_OFFLINE_SCORE_ALIGNED_ORACLE:
        return {
            "causal": False,
            "uses_future_context": True,
            "evidence_horizon_ms": None,
        }
    return {
        "causal": None,
        "uses_future_context": None,
        "evidence_horizon_ms": None,
    }


def target_conditioned_shadow_runtime_benchmark(
    *,
    audio: np.ndarray,
    sample_rate: int,
    score_path: Path,
    practice_scope: dict[str, str | None],
    target_contexts: dict[str, dict] | None = None,
    provider: AcousticEvidenceProvider | None = None,
) -> dict:
    evidence_provider = provider or TargetConditionedPianoObserver()
    attempts = target_conditioned_shadow_runtime_attempts(
        audio=audio,
        sample_rate=sample_rate,
        score_path=score_path,
        practice_scope=practice_scope,
        target_contexts=target_contexts,
        provider=evidence_provider,
    )
    return {
        "benchmark_scope": BENCHMARK_SCOPE_CAUSAL_SHADOW_RUNTIME,
        "progression_authority": True,
        "candidate": evidence_provider.descriptor.provider_id,
        "provider": asdict(evidence_provider.descriptor),
        "status": "experimental",
        "attempt_events": attempts[-40:],
        "benchmark_summary": benchmark_summary(
            attempts,
            benchmark_scope=BENCHMARK_SCOPE_CAUSAL_SHADOW_RUNTIME,
        ),
        "runtime_parameters": {
            "window_seconds": SHADOW_RUNTIME_WINDOW_SECONDS,
            "hop_seconds": SHADOW_RUNTIME_HOP_SECONDS,
            "max_attempt_seconds": SHADOW_RUNTIME_MAX_ATTEMPT_SECONDS,
        },
    }


def target_conditioned_shadow_runtime_attempts(
    *,
    audio: np.ndarray,
    sample_rate: int,
    score_path: Path,
    practice_scope: dict[str, str | None],
    target_contexts: dict[str, dict] | None = None,
    provider: AcousticEvidenceProvider | None = None,
) -> list[dict]:
    groups = _scoped_expected_groups(
        practice_score_timeline_from_musicxml(score_path).expected_practice_groups,
        start_group_id=practice_scope.get("start_expected_group_id"),
        end_group_id=practice_scope.get("end_expected_group_id"),
    )
    if not groups or sample_rate <= 0:
        return []

    evidence_provider = provider or TargetConditionedPianoObserver()
    evaluator = ExpectedEventEvaluator()
    window_samples = max(1, int(round(SHADOW_RUNTIME_WINDOW_SECONDS * sample_rate)))
    hop_samples = max(1, int(round(SHADOW_RUNTIME_HOP_SECONDS * sample_rate)))
    max_attempt_ms = int(round(SHADOW_RUNTIME_MAX_ATTEMPT_SECONDS * 1000))

    attempts: list[dict] = []
    group_index = 0
    attempt_sequence = 0
    attempt_started_at_ms: int | None = None
    last_evaluation = None
    last_observation = None
    end_start = max(0, audio.size - window_samples)
    for start_sample in range(0, end_start + 1, hop_samples):
        if group_index >= len(groups):
            break
        end_sample = start_sample + window_samples
        window = audio[start_sample:end_sample]
        if not _audio_window_active(window):
            continue

        now_ms = int(round(end_sample * 1000 / sample_rate))
        expected_group = groups[group_index]
        if attempt_started_at_ms is None:
            attempt_sequence += 1
            attempt_started_at_ms = int(round(start_sample * 1000 / sample_rate))

        observation = evidence_provider.observe_expected_group(
            window,
            expected_group=expected_group,
            sample_rate=sample_rate,
            np_module=np,
            onset_beat=expected_group.onset_beat,
            window_start_seconds=round(start_sample / sample_rate, 6),
            window_end_seconds=round(end_sample / sample_rate, 6),
        )
        evaluation = evaluator.evaluate(
            expected_group,
            EvaluatorEvidence.from_audio(observation.to_audio_observation()),
        )
        last_evaluation = evaluation
        last_observation = observation

        if evaluation.result == "MATCH":
            next_group = groups[group_index + 1] if group_index + 1 < len(groups) else expected_group
            attempts.append(
                _shadow_runtime_attempt_event(
                    update_index=len(attempts),
                    seconds=round(end_sample / sample_rate, 3),
                    expected_group=expected_group,
                    display_group=next_group,
                    attempt_sequence=attempt_sequence,
                    attempt_started_at_ms=attempt_started_at_ms,
                    attempt_resolved_at_ms=now_ms,
                    evaluation=evaluation,
                    observation=observation,
                    provider_id=evidence_provider.descriptor.provider_id,
                    action="advance",
                    reason="stable_match",
                    scope_completed=group_index + 1 >= len(groups),
                    target_contexts=target_contexts,
                )
            )
            group_index += 1
            attempt_started_at_ms = None
            last_evaluation = None
            last_observation = None
            continue

        if now_ms - attempt_started_at_ms >= max_attempt_ms:
            attempts.append(
                _shadow_runtime_attempt_event(
                    update_index=len(attempts),
                    seconds=round(end_sample / sample_rate, 3),
                    expected_group=expected_group,
                    display_group=expected_group,
                    attempt_sequence=attempt_sequence,
                    attempt_started_at_ms=attempt_started_at_ms,
                    attempt_resolved_at_ms=now_ms,
                    evaluation=evaluation,
                    observation=observation,
                    provider_id=evidence_provider.descriptor.provider_id,
                    action="wait",
                    reason="candidate_attempt_timeout",
                    scope_completed=False,
                    target_contexts=target_contexts,
                )
            )
            attempt_started_at_ms = None

    if attempt_started_at_ms is not None and last_evaluation is not None and last_observation is not None:
        expected_group = groups[group_index]
        attempts.append(
            _shadow_runtime_attempt_event(
                update_index=len(attempts),
                seconds=round(audio.size / sample_rate, 3),
                expected_group=expected_group,
                display_group=expected_group,
                attempt_sequence=attempt_sequence,
                attempt_started_at_ms=attempt_started_at_ms,
                attempt_resolved_at_ms=int(round(audio.size * 1000 / sample_rate)),
                evaluation=last_evaluation,
                observation=last_observation,
                provider_id=evidence_provider.descriptor.provider_id,
                action="wait",
                reason="candidate_stream_end",
                scope_completed=False,
                target_contexts=target_contexts,
            )
        )
    return attempts


def offline_score_aligned_oracle_benchmark(
    *,
    score_path: Path,
    practice_scope: dict[str, str | None],
    target_contexts: dict[str, dict] | None = None,
    provider: AcousticEvidenceProvider,
) -> dict:
    attempts = offline_score_aligned_oracle_attempts(
        score_path=score_path,
        practice_scope=practice_scope,
        target_contexts=target_contexts,
        provider=provider,
    )
    return {
        "benchmark_scope": BENCHMARK_SCOPE_OFFLINE_SCORE_ALIGNED_ORACLE,
        "progression_authority": False,
        "candidate": provider.descriptor.provider_id,
        "provider": asdict(provider.descriptor),
        "status": "offline_oracle",
        "attempt_events": attempts[-40:],
        "benchmark_summary": benchmark_summary(
            attempts,
            benchmark_scope=BENCHMARK_SCOPE_OFFLINE_SCORE_ALIGNED_ORACLE,
        ),
    }


def offline_score_aligned_oracle_attempts(
    *,
    score_path: Path,
    practice_scope: dict[str, str | None],
    target_contexts: dict[str, dict] | None = None,
    provider: AcousticEvidenceProvider,
) -> list[dict]:
    groups = _scoped_expected_groups(
        practice_score_timeline_from_musicxml(score_path).expected_practice_groups,
        start_group_id=practice_scope.get("start_expected_group_id"),
        end_group_id=practice_scope.get("end_expected_group_id"),
    )
    if not groups:
        return []

    evaluator = ExpectedEventEvaluator()
    attempts: list[dict] = []
    alignment = getattr(provider, "alignment", None)
    tolerance_seconds = float(getattr(alignment, "tolerance_seconds", 0.12) or 0.12)
    group_times = getattr(alignment, "group_time_seconds_by_id", {}) or {}
    for index, expected_group in enumerate(groups):
        aligned_seconds = group_times.get(expected_group.group_id)
        window_start_seconds = (
            max(0.0, aligned_seconds - tolerance_seconds)
            if aligned_seconds is not None
            else 0.0
        )
        window_end_seconds = (
            aligned_seconds + tolerance_seconds
            if aligned_seconds is not None
            else 0.0
        )
        observation = provider.observe_expected_group(
            (),
            expected_group=expected_group,
            sample_rate=0,
            np_module=np,
            onset_beat=expected_group.onset_beat,
            window_start_seconds=window_start_seconds,
            window_end_seconds=window_end_seconds,
        )
        evaluation = evaluator.evaluate(
            expected_group,
            EvaluatorEvidence.from_audio(observation.to_audio_observation()),
        )
        attempts.append(
            {
                "update_index": index,
                "seconds": None if aligned_seconds is None else round(aligned_seconds, 3),
                "beat_position": expected_group.onset_beat,
                "anchor_beat": expected_group.onset_beat,
                "attempt_state": "resolved",
                "attempt_sequence": index + 1,
                "attempt_started_at_ms": None,
                "attempt_resolved_at_ms": None,
                "decision_action": "project",
                "decision_reason": "offline_score_aligned_projection",
                "experience_state": "offline_projection",
                "evaluator_version": provider.descriptor.provider_id,
                "evaluation_result": evaluation.result,
                "matched_pitches": list(evaluation.matched_pitches),
                "missing_pitches": list(evaluation.missing_pitches),
                "extra_pitches": list(evaluation.extra_pitches),
                "scope_completed": index + 1 >= len(groups),
                "confidence": observation.confidence,
                "validation_confidence": observation.confidence,
                "input_policy_confidence": observation.confidence,
                "gate_reason": "offline_score_alignment",
                "queue_decision": "offline_projected",
                "tonal_signal": True,
                "onset_signal": True,
                "alignment_state": "offline_score_aligned_oracle",
                "pitch_activations": [
                    {
                        "pitch": activation.pitch,
                        "spectral_score": activation.spectral_score,
                        "confidence": activation.confidence,
                        "matched": activation.matched,
                    }
                    for activation in observation.activations
                ],
                "display_target": _context_for_group_id(
                    expected_group.group_id,
                    target_contexts or {},
                ),
                "evaluated_target": _context_for_group_id(
                    expected_group.group_id,
                    target_contexts or {},
                ),
            }
        )
    return attempts


def _scoped_expected_groups(
    groups: tuple,
    *,
    start_group_id: str | None,
    end_group_id: str | None,
) -> tuple:
    start_index = 0
    end_index = len(groups) - 1
    if start_group_id is not None:
        start_index = next(
            (index for index, group in enumerate(groups) if group.group_id == start_group_id),
            start_index,
        )
    if end_group_id is not None:
        end_index = next(
            (index for index, group in enumerate(groups) if group.group_id == end_group_id),
            end_index,
        )
    if end_index < start_index:
        return ()
    return tuple(groups[start_index : end_index + 1])


def _shadow_runtime_attempt_event(
    *,
    update_index: int,
    seconds: float,
    expected_group,
    display_group,
    attempt_sequence: int,
    attempt_started_at_ms: int,
    attempt_resolved_at_ms: int,
    evaluation,
    observation,
    provider_id: str,
    action: str,
    reason: str,
    scope_completed: bool,
    target_contexts: dict[str, dict] | None,
) -> dict:
    event = {
        "update_index": update_index,
        "seconds": seconds,
        "beat_position": expected_group.onset_beat,
        "anchor_beat": display_group.onset_beat,
        "attempt_state": "resolved",
        "attempt_sequence": attempt_sequence,
        "attempt_started_at_ms": attempt_started_at_ms,
        "attempt_resolved_at_ms": attempt_resolved_at_ms,
        "decision_action": action,
        "decision_reason": reason,
        "experience_state": "following" if action == "advance" else "heard_but_uncertain",
        "evaluator_version": provider_id,
        "evaluation_result": evaluation.result,
        "matched_pitches": list(evaluation.matched_pitches),
        "missing_pitches": list(evaluation.missing_pitches),
        "extra_pitches": list(evaluation.extra_pitches),
        "scope_completed": scope_completed,
        "confidence": observation.confidence,
        "validation_confidence": observation.confidence,
        "input_policy_confidence": observation.confidence,
        "gate_reason": "shadow_activity",
        "queue_decision": "shadow_evaluated",
        "tonal_signal": True,
        "onset_signal": True,
        "alignment_state": "target_conditioned_shadow_runtime",
        "pitch_activations": [
            {
                "pitch": activation.pitch,
                "spectral_score": activation.spectral_score,
                "confidence": activation.confidence,
                "matched": activation.matched,
            }
            for activation in observation.activations
        ],
    }
    if target_contexts is not None:
        event["display_target"] = _context_for_group_id(display_group.group_id, target_contexts)
        event["evaluated_target"] = _context_for_group_id(expected_group.group_id, target_contexts)
    return event


def _audio_window_active(samples: np.ndarray) -> bool:
    if samples.size == 0 or not np.isfinite(samples).all():
        return False
    rms = float(np.sqrt(np.mean(np.square(samples))))
    return rms > TargetConditionedPianoObserver().profile.min_rms


def target_conditioned_candidate_attempts(
    *,
    baseline_attempts: list[dict],
    audio: np.ndarray,
    sample_rate: int,
    score_path: Path,
    provider: AcousticEvidenceProvider | None = None,
) -> list[dict]:
    expected_groups = {
        group.group_id: group
        for group in practice_score_timeline_from_musicxml(score_path).expected_practice_groups
    }
    evidence_provider = provider or TargetConditionedPianoObserver()
    evaluator = ExpectedEventEvaluator()
    candidate_attempts: list[dict] = []
    for baseline_attempt in baseline_attempts:
        evaluated_target = baseline_attempt.get("evaluated_target") or {}
        group_id = evaluated_target.get("group_id")
        expected_group = expected_groups.get(str(group_id)) if group_id is not None else None
        if expected_group is None:
            continue
        audio_window = _attempt_audio_window(
            baseline_attempt=baseline_attempt,
            audio=audio,
            sample_rate=sample_rate,
        )
        observation = evidence_provider.observe_expected_group(
            audio_window,
            expected_group=expected_group,
            sample_rate=sample_rate,
            np_module=np,
            onset_beat=expected_group.onset_beat,
            window_start_seconds=audio_window_start_seconds(
                baseline_attempt=baseline_attempt,
                audio=audio,
                sample_rate=sample_rate,
            ),
            window_end_seconds=audio_window_end_seconds(
                baseline_attempt=baseline_attempt,
                audio=audio,
                sample_rate=sample_rate,
            ),
        )
        evaluation = evaluator.evaluate(
            expected_group,
            EvaluatorEvidence.from_audio(observation.to_audio_observation()),
        )
        candidate_attempts.append(
            {
                "update_index": baseline_attempt.get("update_index"),
                "seconds": baseline_attempt.get("seconds"),
                "beat_position": baseline_attempt.get("beat_position"),
                "anchor_beat": baseline_attempt.get("anchor_beat"),
                "attempt_state": baseline_attempt.get("attempt_state"),
                "attempt_sequence": baseline_attempt.get("attempt_sequence"),
                "attempt_started_at_ms": baseline_attempt.get("attempt_started_at_ms"),
                "attempt_resolved_at_ms": baseline_attempt.get("attempt_resolved_at_ms"),
                "decision_action": "advance" if evaluation.result == "MATCH" else "wait",
                "decision_reason": (
                    "stable_match" if evaluation.result == "MATCH" else "candidate_evaluation"
                ),
                "experience_state": baseline_attempt.get("experience_state"),
                "evaluator_version": evidence_provider.descriptor.provider_id,
                "evaluation_result": evaluation.result,
                "matched_pitches": list(evaluation.matched_pitches),
                "missing_pitches": list(evaluation.missing_pitches),
                "extra_pitches": list(evaluation.extra_pitches),
                "scope_completed": baseline_attempt.get("scope_completed", False),
                "confidence": observation.confidence,
                "validation_confidence": observation.confidence,
                "input_policy_confidence": observation.confidence,
                "gate_reason": baseline_attempt.get("gate_reason"),
                "queue_decision": baseline_attempt.get("queue_decision"),
                "tonal_signal": baseline_attempt.get("tonal_signal"),
                "onset_signal": baseline_attempt.get("onset_signal"),
                "alignment_state": "target_conditioned_candidate",
                "display_target": baseline_attempt.get("display_target"),
                "evaluated_target": baseline_attempt.get("evaluated_target"),
                "pitch_activations": [
                    {
                        "pitch": activation.pitch,
                        "spectral_score": activation.spectral_score,
                        "confidence": activation.confidence,
                        "matched": activation.matched,
                    }
                    for activation in observation.activations
                ],
            }
        )
    return candidate_attempts


def candidate_benchmarks(
    *,
    providers: tuple[AcousticEvidenceProvider, ...],
    baseline_attempts: list[dict],
    audio: np.ndarray,
    sample_rate: int,
    score_path: Path,
    practice_scope: dict[str, str | None],
    target_contexts: dict[str, dict] | None,
) -> dict[str, dict]:
    benchmarks: dict[str, dict] = {}
    for provider in providers:
        benchmark_key = provider.descriptor.provider_id.replace("-", "_")
        if getattr(provider, "uses_offline_score_alignment", False):
            benchmarks[benchmark_key] = {
                "provider": asdict(provider.descriptor),
                "score_aligned_oracle_benchmark": offline_score_aligned_oracle_benchmark(
                    score_path=score_path,
                    practice_scope=practice_scope,
                    target_contexts=target_contexts,
                    provider=provider,
                ),
            }
            continue

        attempts = target_conditioned_candidate_attempts(
            baseline_attempts=baseline_attempts,
            audio=audio,
            sample_rate=sample_rate,
            score_path=score_path,
            provider=provider,
        )
        benchmarks[benchmark_key] = {
            "provider": asdict(provider.descriptor),
            "attempt_events": attempts[-40:],
            "benchmark_summary": benchmark_summary(
                attempts,
                benchmark_scope=BENCHMARK_SCOPE_OBSERVER_WINDOW,
            ),
            "shadow_runtime_benchmark": target_conditioned_shadow_runtime_benchmark(
                audio=audio,
                sample_rate=sample_rate,
                score_path=score_path,
                practice_scope=practice_scope,
                target_contexts=target_contexts,
                provider=provider,
            ),
        }
    return benchmarks


def _attempt_audio_window(
    *,
    baseline_attempt: dict,
    audio: np.ndarray,
    sample_rate: int,
) -> np.ndarray:
    start_sample, end_sample = _attempt_audio_window_sample_range(
        baseline_attempt=baseline_attempt,
        audio=audio,
        sample_rate=sample_rate,
    )
    return audio[start_sample:end_sample]


def audio_window_start_seconds(
    *,
    baseline_attempt: dict,
    audio: np.ndarray,
    sample_rate: int,
) -> float:
    start_sample, _ = _attempt_audio_window_sample_range(
        baseline_attempt=baseline_attempt,
        audio=audio,
        sample_rate=sample_rate,
    )
    return round(start_sample / sample_rate, 6)


def audio_window_end_seconds(
    *,
    baseline_attempt: dict,
    audio: np.ndarray,
    sample_rate: int,
) -> float:
    _, end_sample = _attempt_audio_window_sample_range(
        baseline_attempt=baseline_attempt,
        audio=audio,
        sample_rate=sample_rate,
    )
    return round(end_sample / sample_rate, 6)


def _attempt_audio_window_sample_range(
    *,
    baseline_attempt: dict,
    audio: np.ndarray,
    sample_rate: int,
) -> tuple[int, int]:
    resolved_seconds = float(baseline_attempt.get("seconds") or 0.0)
    started_at_ms = baseline_attempt.get("attempt_started_at_ms")
    resolved_at_ms = baseline_attempt.get("attempt_resolved_at_ms")
    duration_seconds = 0.5
    if (
        isinstance(started_at_ms, int | float)
        and isinstance(resolved_at_ms, int | float)
        and resolved_at_ms > started_at_ms
    ):
        duration_seconds = max(duration_seconds, float(resolved_at_ms - started_at_ms) / 1000.0)
    end_sample = min(audio.size, max(0, int(round(resolved_seconds * sample_rate))))
    window_samples = max(1, int(round(duration_seconds * sample_rate)))
    start_sample = max(0, end_sample - window_samples)
    return start_sample, end_sample


def diagnostic_reason_counts(attempts: list[dict]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for attempt in attempts:
        reason = diagnostic_reason(attempt)
        counts[reason] = counts.get(reason, 0) + 1
    return counts


def diagnostic_reason(attempt: dict) -> str:
    evaluation_result = attempt.get("evaluation_result")
    action = attempt.get("decision_action")
    if action == "advance" and evaluation_result == "MATCH":
        return "accepted_match"
    if action == "advance":
        return "false_advance_guard"
    if attempt.get("gate_reason") == "start_feature_mismatch":
        return "startup_pitch_mismatch"
    if attempt.get("decision_reason") == "low_alignment_confidence":
        return "low_alignment_confidence"
    if evaluation_result == "PARTIAL":
        return "low_expected_activation"
    if evaluation_result == "MISMATCH" and attempt.get("extra_pitches"):
        return "extra_candidate"
    if evaluation_result == "MISMATCH":
        return "no_expected_activation"
    if evaluation_result == "UNCERTAIN":
        return "uncertain_evidence"
    if attempt.get("onset_signal") is False:
        return "no_onset"
    return "unclassified"


def _expected_strike_count(attempt: dict) -> int:
    matched = attempt.get("matched_pitches") or []
    missing = attempt.get("missing_pitches") or []
    return len(set((*matched, *missing)))


def _ratio(numerator: int, denominator: int) -> float | None:
    if denominator <= 0:
        return None
    return round(numerator / denominator, 4)


def _percentile(values: list[int | float], percentile: int) -> float | None:
    if not values:
        return None
    ordered = sorted(float(value) for value in values)
    index = round((len(ordered) - 1) * percentile / 100)
    return round(ordered[index], 3)


def _measure_start_beats(score_path: Path) -> dict[str, float]:
    try:
        root = ET.parse(score_path).getroot()
    except (OSError, ET.ParseError):
        return {}

    first_part = next(iter(root.findall("{*}part")), None)
    if first_part is None:
        return {}

    measure_starts: dict[str, float] = {}
    divisions = 1.0
    measure_start_beat = 0.0
    current_measure_duration_beats = 4.0
    for measure in first_part.findall("{*}measure"):
        measure_number = measure.get("number")
        if measure_number:
            measure_starts[measure_number] = round(measure_start_beat, 6)
        cursor = 0.0
        measure_extent = 0.0
        for element in list(measure):
            tag = _local_name(element.tag)
            if tag == "attributes":
                if divisions_text := _child_text(element, "divisions"):
                    divisions = _positive_float_or_default(divisions_text, divisions)
                time = element.find("{*}time")
                if time is not None:
                    numerator = _positive_float_or_default(_child_text(time, "beats"), 0.0)
                    denominator = _positive_float_or_default(_child_text(time, "beat-type"), 0.0)
                    if numerator > 0 and denominator > 0:
                        current_measure_duration_beats = numerator * 4.0 / denominator
                continue
            if tag == "note" and element.find("{*}chord") is not None:
                measure_extent = max(measure_extent, cursor)
                continue
            if tag in {"note", "forward"}:
                cursor += _duration_beats(element, divisions)
                measure_extent = max(measure_extent, cursor)
            elif tag == "backup":
                cursor = max(0.0, cursor - _duration_beats(element, divisions))
        measure_start_beat += (
            measure_extent if measure_extent > 0 else current_measure_duration_beats
        )
    return measure_starts


def _duration_beats(element: ET.Element, divisions: float) -> float:
    duration = _positive_float_or_default(_child_text(element, "duration"), 0.0)
    if duration <= 0.0 or divisions <= 0.0:
        return 0.0
    return duration / divisions


def _child_text(element: ET.Element, child_name: str) -> str:
    child = element.find(f"{{*}}{child_name}")
    if child is None or child.text is None:
        return ""
    return child.text.strip()


def _positive_float_or_default(value: str, default: float) -> float:
    try:
        parsed = float(value)
    except ValueError:
        return default
    return parsed if parsed > 0.0 else default


def _local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def count_state_episodes(frame_states: list[dict], *, state: str) -> int:
    episodes = 0
    previous_state: str | None = None
    for frame_state in frame_states:
        current_state = str(frame_state["state"])
        if current_state == state and previous_state != state:
            episodes += 1
        previous_state = current_state
    return episodes


def annotation_metrics(
    annotations: list[dict],
    *,
    accepted_events: list[dict],
    frame_states: list[dict],
) -> dict[str, dict]:
    metrics: dict[str, dict] = {}
    for annotation in annotations:
        annotation_id = str(annotation["id"])
        start_seconds = float(annotation["start_seconds"])
        end_seconds = float(annotation.get("end_seconds", start_seconds))
        expected_min = annotation.get("expected_anchor_beat_min")
        expected_max = annotation.get("expected_anchor_beat_max")
        window_events = [
            event
            for event in accepted_events
            if start_seconds <= float(event["seconds"]) <= end_seconds
        ]
        in_region_events = window_events
        outside_region_events: list[dict] = []
        if expected_min is not None and expected_max is not None:
            min_beat = float(expected_min)
            max_beat = float(expected_max)
            in_region_events = [
                event
                for event in window_events
                if min_beat <= float(event["anchor_beat"]) <= max_beat
            ]
            outside_region_events = [
                event
                for event in window_events
                if not min_beat <= float(event["anchor_beat"]) <= max_beat
            ]

        first_in_region_seconds = (
            None if not in_region_events else float(in_region_events[0]["seconds"])
        )
        stability_seconds = annotation.get("post_recovery_stability_seconds")
        stability_states: list[dict] = []
        if stability_seconds is not None:
            stability_end = end_seconds + float(stability_seconds)
            stability_states = [
                state
                for state in frame_states
                if end_seconds <= float(state["seconds"]) <= stability_end
            ]

        metrics[annotation_id] = {
            "kind": annotation.get("kind"),
            "start_seconds": start_seconds,
            "end_seconds": end_seconds,
            "expected_anchor_beat_min": expected_min,
            "expected_anchor_beat_max": expected_max,
            "accepted_events": len(window_events),
            "accepted_in_region": len(in_region_events),
            "accepted_outside_region": len(outside_region_events),
            "first_accepted_in_region_seconds": first_in_region_seconds,
            "recovery_latency_seconds": (
                None
                if first_in_region_seconds is None
                else round(first_in_region_seconds - start_seconds, 3)
            ),
            "post_recovery_lost_episodes": count_state_episodes(
                stability_states,
                state="lost",
            ),
        }
    return metrics


def read_pcm_wav(path: Path, sample_rate: int) -> np.ndarray:
    with wave.open(str(path), "rb") as wav_file:
        channels = wav_file.getnchannels()
        width = wav_file.getsampwidth()
        source_rate = wav_file.getframerate()
        frames = wav_file.readframes(wav_file.getnframes())

    if width != 2:
        raise ValueError(f"Expected 16-bit PCM WAV: {path}")

    audio = np.frombuffer(frames, dtype=np.int16).astype(np.float32) / 32768.0
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
    if audio.size == 0 or source_rate == target_rate:
        return audio.astype(np.float32, copy=False)

    source_times = np.arange(audio.size, dtype=np.float64) / source_rate
    target_size = int(round(audio.size * target_rate / source_rate))
    target_times = np.arange(target_size, dtype=np.float64) / target_rate
    return np.interp(target_times, source_times, audio).astype(np.float32)


def mix_sources(root: Path, spec: dict, sample_rate: int) -> np.ndarray:
    duration_samples = int(float(spec["duration_seconds"]) * sample_rate)
    mix = np.zeros(duration_samples, dtype=np.float32)

    for source in spec["sources"]:
        audio = read_pcm_wav(root / source["path"], sample_rate)
        offset = int(float(source.get("offset_seconds", 0.0)) * sample_rate)
        if offset >= duration_samples:
            continue
        available_samples = duration_samples - offset
        if bool(source.get("loop", False)) and audio.size:
            audio = np.tile(audio, int(np.ceil(available_samples / audio.size)))
        gain = 10 ** (float(source.get("gain_db", 0.0)) / 20.0)
        length = min(audio.size, available_samples)
        mix[offset : offset + length] += audio[:length] * gain

    peak = float(np.max(np.abs(mix))) if mix.size else 0.0
    return mix * (0.98 / peak) if peak > 0.98 else mix


def slice_audio(audio: np.ndarray, spec: dict, sample_rate: int) -> np.ndarray:
    start = int(float(spec.get("start_seconds", 0.0)) * sample_rate)
    if start < 0:
        raise ValueError("start_seconds must be non-negative")
    if "duration_seconds" not in spec:
        return audio[start:]
    duration = int(float(spec["duration_seconds"]) * sample_rate)
    if duration < 0:
        raise ValueError("duration_seconds must be non-negative")
    return audio[start : start + duration]


def scenario_audio(root: Path, scenario: dict, sample_rate: int) -> np.ndarray:
    chunks: list[np.ndarray] = []
    for frame_spec in scenario["frames"]:
        frame_type = frame_spec["type"]
        repeat_count = int(frame_spec.get("repeat", 1))
        if repeat_count <= 0:
            raise ValueError("frame repeat must be positive")
        if frame_type == "wav":
            frame_audio = slice_audio(
                read_pcm_wav(root / frame_spec["path"], sample_rate),
                frame_spec,
                sample_rate,
            )
        elif frame_type == "mix_wav":
            frame_audio = mix_sources(root, frame_spec, sample_rate)
        elif frame_type == "silence":
            duration_samples = int(float(frame_spec["duration_seconds"]) * sample_rate)
            frame_audio = np.zeros(duration_samples, dtype=np.float32)
        else:
            raise ValueError(f"Unsupported replay source: {frame_type}")
        chunks.extend(frame_audio for _ in range(repeat_count))
    audio = np.concatenate(chunks) if chunks else np.array([], dtype=np.float32)

    armed_delay_samples = int(float(scenario.get("armed_delay_seconds", 0.0)) * sample_rate)
    leading_sample_offset = int(scenario.get("leading_sample_offset", 0))
    if armed_delay_samples < 0:
        raise ValueError("armed_delay_seconds must be non-negative")
    if leading_sample_offset < 0:
        raise ValueError("leading_sample_offset must be non-negative")

    prefix_samples = armed_delay_samples + leading_sample_offset
    if prefix_samples:
        audio = np.concatenate((np.zeros(prefix_samples, dtype=np.float32), audio))
    return audio


def pcm_s16le(frame: np.ndarray) -> bytes:
    clipped = np.clip(frame, -1.0, 1.0)
    return (clipped * 32767).astype("<i2").tobytes()


def pcm_float32_sha256(audio: np.ndarray) -> str:
    return hashlib.sha256(np.ascontiguousarray(audio, dtype=np.float32).tobytes()).hexdigest()


def audio_input_identity(audio: np.ndarray, sample_rate: int) -> dict[str, object]:
    return {
        "sha256": pcm_float32_sha256(audio),
        "sample_rate_hz": sample_rate,
        "channels": 1,
        "sample_format": "float32_mono",
        "sample_count": int(audio.size),
    }


def resolve_practice_scope(score_path: Path, scenario: dict) -> dict[str, str | None]:
    explicit_scope = scenario.get("practice_scope")
    beat_scope = scenario.get("practice_scope_by_beat")
    if explicit_scope and beat_scope:
        raise ValueError("Use either practice_scope or practice_scope_by_beat, not both")
    if explicit_scope:
        return {
            "start_expected_group_id": explicit_scope.get("start_expected_group_id"),
            "end_expected_group_id": explicit_scope.get("end_expected_group_id"),
        }
    if not beat_scope:
        return {"start_expected_group_id": None, "end_expected_group_id": None}

    start_beat = float(beat_scope["start_beat"])
    end_beat = float(beat_scope["end_beat"])
    catalog = practice_target_catalog_from_musicxml(score_path)
    groups_by_beat = {round(target.onset_beat, 6): target for target in catalog.targets}
    start_target = groups_by_beat.get(round(start_beat, 6))
    end_target = groups_by_beat.get(round(end_beat, 6))
    if start_target is None or end_target is None:
        available_beats = ", ".join(str(target.onset_beat) for target in catalog.targets)
        raise ValueError(
            "practice_scope_by_beat must resolve to playable expected groups: "
            f"start={start_beat} end={end_beat} available=[{available_beats}]"
        )
    return {
        "start_expected_group_id": start_target.group_id,
        "end_expected_group_id": end_target.group_id,
    }


def run_scenario(
    *,
    score_path: Path,
    fixture_root: Path,
    scenario: dict,
    sample_rate: int,
    acoustic_candidate_providers: tuple[AcousticEvidenceProvider, ...] = (),
) -> dict:
    practice_scope = resolve_practice_scope(score_path, scenario)
    engine = MatchmakerLiveEngine(
        score_file_path=str(score_path),
        sample_rate=sample_rate,
        channels=1,
        frame_format="pcm_s16le",
        start_expected_group_id=practice_scope.get("start_expected_group_id"),
        end_expected_group_id=practice_scope.get("end_expected_group_id"),
    )
    try:
        target_contexts = target_contexts_from_score(score_path)
        hop_length = engine.hop_length
        silence = np.zeros(hop_length, dtype=np.float32)
        calibration_sample_count = DEFAULT_PRACTICE_AUDIO_PROFILE.calibration_sample_count(sample_rate)
        calibrated_samples = 0
        while calibrated_samples < calibration_sample_count:
            engine.ingest_audio(pcm_s16le(silence))
            calibrated_samples += hop_length

        audio = scenario_audio(fixture_root, scenario, sample_rate)
        chunk_size_samples = int(scenario.get("chunk_size_samples", hop_length))
        if chunk_size_samples <= 0:
            raise ValueError("chunk_size_samples must be positive")
        emitted_updates: list[dict] = []
        emitted_update_samples: list[int] = []
        post_start_states: list[str] = []
        post_start_frame_states: list[dict] = []
        started_frame: int | None = None
        started_sample: int | None = None
        first_reliable_sample: int | None = None
        start_feature_confidence: float | None = None
        start_feature_mismatch_frames = 0
        max_start_feature_confidence: float | None = None
        pause_after_seconds = scenario.get("pause_after_seconds")
        metric_end_seconds = max(
            0.0,
            (audio.size / sample_rate) - float(scenario.get("tail_ignore_seconds", 0.0)),
        )
        pause_checked = False
        pause_emitted_updates = 0
        emitted_updates_before_pause: int | None = None

        for frame_index, start in enumerate(
            range(0, len(audio) - chunk_size_samples + 1, chunk_size_samples),
            1,
        ):
            elapsed_seconds = start / sample_rate
            if (
                pause_after_seconds is not None
                and not pause_checked
                and elapsed_seconds >= float(pause_after_seconds)
            ):
                before_pause = len(emitted_updates)
                time.sleep(0.2)
                pause_emitted_updates = len(emitted_updates) - before_pause
                emitted_updates_before_pause = before_pause
                pause_checked = True

            update = engine.ingest_audio(pcm_s16le(audio[start : start + chunk_size_samples]))
            if update is not None:
                emitted_updates.append(update)
                emitted_update_samples.append(start)
                confidence = float(update.get("confidence", 0.0))
                if (
                    first_reliable_sample is None
                    and confidence >= RELIABLE_ALIGNMENT_CONFIDENCE
                ):
                    first_reliable_sample = start
            if engine._stream.started:
                if elapsed_seconds <= metric_end_seconds:
                    post_start_states.append(engine._stream.stream_state)
                    post_start_frame_states.append(
                        {
                            "seconds": round(elapsed_seconds, 3),
                            "state": engine._stream.stream_state,
                        }
                    )
            start_confidence = engine._stream.last_start_feature_confidence
            if start_confidence is not None:
                max_start_feature_confidence = (
                    start_confidence
                    if max_start_feature_confidence is None
                    else max(max_start_feature_confidence, start_confidence)
                )
            if engine._stream.last_gate_reason == "start_feature_mismatch":
                start_feature_mismatch_frames += 1
            if engine._stream.started and started_frame is None:
                started_frame = frame_index
                started_sample = start
                start_feature_confidence = engine._stream.last_start_feature_confidence

        start_seconds = (
            None
            if started_sample is None
            else round(started_sample / sample_rate, 3)
        )
        first_update = emitted_updates[0] if emitted_updates else None
        emitted_beats = [update["beat_position"] for update in emitted_updates]
        accepted_anchor_beats = [
            float(anchor["beat"])
            for update in emitted_updates
            if (decision := update.get("decision"))
            and decision.get("action") == "advance"
            and (anchor := decision.get("display_anchor"))
            and anchor.get("beat") is not None
        ]
        accepted_events = accepted_alignment_events(
            emitted_updates,
            emitted_update_samples,
            sample_rate,
        )
        emitted_attempt_events = attempt_events(
            emitted_updates,
            emitted_update_samples,
            sample_rate,
            target_contexts,
        )
        completion_update_index = next(
            (
                index
                for index, update in enumerate(emitted_updates)
                if update.get("scope_completed")
            ),
            None,
        )
        accepted_completion_beat = None
        accepted_completion_alignment_beat = None
        accepted_completion_seconds = None
        if completion_update_index is not None:
            completion_update = emitted_updates[completion_update_index]
            completion_decision = completion_update.get("decision") or {}
            completion_anchor = completion_decision.get("display_anchor") or {}
            completion_beat = completion_anchor.get("beat")
            if completion_beat is not None:
                accepted_completion_beat = float(completion_beat)
            accepted_completion_alignment_beat = float(completion_update["beat_position"])
            accepted_completion_seconds = round(
                emitted_update_samples[completion_update_index] / sample_rate,
                3,
            )
        terminal_region_start = engine._reference_slice.terminal_region_start_beat
        terminal_region_updates = [
            update
            for update in emitted_updates
            if terminal_region_start is not None
            and float(update["beat_position"]) >= terminal_region_start
        ]
        reliable_updates = [
            update
            for update in emitted_updates
            if float(update.get("confidence", 0.0)) >= RELIABLE_ALIGNMENT_CONFIDENCE
        ]
        first_alignment_beat = None if first_update is None else first_update["beat_position"]
        max_alignment_beat = max(emitted_beats, default=None)
        post_start_frame_count = len(post_start_states)
        lost_frames = sum(state == "lost" for state in post_start_states)
        lost_episode_count = 0
        previous_state: str | None = None
        for state in post_start_states:
            if state == "lost" and previous_state != "lost":
                lost_episode_count += 1
            previous_state = state
        annotated_events = annotation_metrics(
            scenario.get("performance_annotations", []),
            accepted_events=accepted_events,
            frame_states=post_start_frame_states,
        )
        default_candidate_provider = TargetConditionedPianoObserver()
        candidate_providers = (default_candidate_provider, *acoustic_candidate_providers)
        return {
            "id": scenario["id"],
            "quality_status": scenario.get("quality_status", "required"),
            "runtime_profile": engine.runtime_profile_id,
            "started": engine._stream.started,
            "start_seconds": start_seconds,
            "chunk_size_samples": chunk_size_samples,
            "leading_sample_offset": int(scenario.get("leading_sample_offset", 0)),
            "armed_delay_seconds": float(scenario.get("armed_delay_seconds", 0.0)),
            "audio_input": audio_input_identity(audio, sample_rate),
            "start_feature_confidence": start_feature_confidence,
            "max_start_feature_confidence": max_start_feature_confidence,
            "start_feature_mismatch_frames": start_feature_mismatch_frames,
            "first_alignment_beat": first_alignment_beat,
            "max_alignment_beat": max_alignment_beat,
            "alignment_advance": (
                None
                if first_alignment_beat is None or max_alignment_beat is None
                else round(max_alignment_beat - first_alignment_beat, 3)
            ),
            "accepted_anchor_beat_min": min(accepted_anchor_beats, default=None),
            "accepted_anchor_beat_max": max(accepted_anchor_beats, default=None),
            "accepted_events": accepted_events[-20:],
            "attempt_events": emitted_attempt_events[-40:],
            "attempt_event_counts": decision_counts(
                [update for update in emitted_updates if (update.get("decision") or {}).get("attempt_sequence")]
            ),
            "benchmark_summary": benchmark_summary(
                emitted_attempt_events,
                annotated_events,
                benchmark_scope=BENCHMARK_SCOPE_BASELINE_RUNTIME,
            ),
            "candidate_benchmarks": candidate_benchmarks(
                providers=candidate_providers,
                baseline_attempts=emitted_attempt_events,
                audio=audio,
                sample_rate=sample_rate,
                score_path=score_path,
                practice_scope=practice_scope,
                target_contexts=target_contexts,
            ),
            "annotated_events": annotated_events,
            "reference_slice": {
                "start_beat": engine._reference_slice.start_beat,
                "end_beat": engine._reference_slice.end_beat,
                "terminal_region_start_beat": (
                    engine._reference_slice.terminal_region_start_beat
                ),
                "frame_step_beat": engine._reference_slice.frame_step_beat,
            },
            "scope_completed": any(
                bool(update.get("scope_completed")) for update in emitted_updates
            ),
            "completion_reason": next(
                (
                    update.get("completion_reason")
                    for update in emitted_updates
                    if update.get("scope_completed")
                ),
                None,
            ),
            "accepted_completion_beat": accepted_completion_beat,
            "accepted_completion_alignment_beat": accepted_completion_alignment_beat,
            "accepted_completion_seconds": accepted_completion_seconds,
            "terminal_region_updates": len(terminal_region_updates),
            "terminal_region_decision_counts": decision_counts(terminal_region_updates),
            "terminal_region_last_update": (
                None
                if not terminal_region_updates
                else slim_alignment_update(terminal_region_updates[-1])
            ),
            "last_updates": [slim_alignment_update(update) for update in emitted_updates[-5:]],
            "first_gate_reason": (
                None if first_update is None else first_update.get("gate_reason")
            ),
            "emitted_updates": len(emitted_updates),
            "reliable_confidence_threshold": RELIABLE_ALIGNMENT_CONFIDENCE,
            "reliable_updates": len(reliable_updates),
            "reliable_update_ratio": (
                0.0 if not emitted_updates else round(len(reliable_updates) / len(emitted_updates), 4)
            ),
            "time_to_first_reliable_alignment": (
                None
                if first_reliable_sample is None or started_sample is None
                else round((first_reliable_sample - started_sample) / sample_rate, 3)
            ),
            "lost_frames": lost_frames,
            "lost_frame_ratio": (
                0.0
                if not post_start_frame_count
                else round(lost_frames / post_start_frame_count, 4)
            ),
            "lost_episodes": lost_episode_count,
            "following_frame_ratio": (
                0.0
                if not post_start_frame_count
                else round(
                    sum(state == "following" for state in post_start_states)
                    / post_start_frame_count,
                    4,
                )
            ),
            "pause_checked": pause_checked,
            "pause_emitted_updates": pause_emitted_updates,
            "resume_emitted_updates": (
                0
                if emitted_updates_before_pause is None
                else len(emitted_updates) - emitted_updates_before_pause
            ),
        }
    finally:
        engine.close()


def evaluate_result(result: dict, expect: dict) -> list[str]:
    failures: list[str] = []
    if result.get("error"):
        return [f"error={result['error']}"]
    if result["started"] is not expect["starts"]:
        failures.append(f"started={result['started']} expected={expect['starts']}")
    if result["started"]:
        start_seconds = result["start_seconds"]
        if start_seconds is None:
            failures.append("missing start time")
        elif start_seconds < expect.get("start_seconds_min", 0):
            failures.append(f"start_seconds={start_seconds} below minimum")
        elif start_seconds > expect.get("start_seconds_max", float("inf")):
            failures.append(f"start_seconds={start_seconds} above maximum")
        if result["lost_frames"] > expect.get("max_lost_frames", float("inf")):
            failures.append(f"lost_frames={result['lost_frames']} above maximum")
        if result["lost_episodes"] > expect.get("max_lost_episodes", float("inf")):
            failures.append(f"lost_episodes={result['lost_episodes']} above maximum")
        if result["lost_frame_ratio"] > expect.get("max_lost_frame_ratio", float("inf")):
            failures.append(f"lost_frame_ratio={result['lost_frame_ratio']} above maximum")
        if result["following_frame_ratio"] < expect.get("min_following_frame_ratio", 0):
            failures.append(
                f"following_frame_ratio={result['following_frame_ratio']} below minimum"
            )
        if result["reliable_updates"] < expect.get("min_reliable_updates", 0):
            failures.append(f"reliable_updates={result['reliable_updates']} below minimum")
        if result["reliable_update_ratio"] < expect.get("min_reliable_update_ratio", 0):
            failures.append(
                f"reliable_update_ratio={result['reliable_update_ratio']} below minimum"
            )
        if "max_time_to_first_reliable_alignment" in expect:
            time_to_reliable = result["time_to_first_reliable_alignment"]
            if time_to_reliable is None:
                failures.append("missing time_to_first_reliable_alignment")
            elif time_to_reliable > expect["max_time_to_first_reliable_alignment"]:
                failures.append(
                    "time_to_first_reliable_alignment="
                    f"{time_to_reliable} above maximum"
                )
        if (
            "first_alignment_beat" in expect
            and result["first_alignment_beat"] != expect["first_alignment_beat"]
        ):
            failures.append(
                "first_alignment_beat="
                f"{result['first_alignment_beat']} expected={expect['first_alignment_beat']}"
            )
        if "first_alignment_beat_min" in expect:
            first_alignment_beat = result["first_alignment_beat"]
            if first_alignment_beat is None:
                failures.append("missing first_alignment_beat")
            elif first_alignment_beat < expect["first_alignment_beat_min"]:
                failures.append(f"first_alignment_beat={first_alignment_beat} below minimum")
        if "first_alignment_beat_max" in expect:
            first_alignment_beat = result["first_alignment_beat"]
            if first_alignment_beat is None:
                failures.append("missing first_alignment_beat")
            elif first_alignment_beat > expect["first_alignment_beat_max"]:
                failures.append(f"first_alignment_beat={first_alignment_beat} above maximum")
        if result["alignment_advance"] is not None and result["alignment_advance"] < expect.get(
            "min_alignment_advance", 0
        ):
            failures.append(f"alignment_advance={result['alignment_advance']} below minimum")
        if (
            "completion_reason" in expect
            and result["completion_reason"] != expect["completion_reason"]
        ):
            failures.append(
                "completion_reason="
                f"{result['completion_reason']} expected={expect['completion_reason']}"
            )
        if "accepted_anchor_beat_min" in expect:
            accepted_anchor_beat_min = result["accepted_anchor_beat_min"]
            if accepted_anchor_beat_min is None:
                failures.append("missing accepted_anchor_beat_min")
            elif accepted_anchor_beat_min < expect["accepted_anchor_beat_min"]:
                failures.append(
                    f"accepted_anchor_beat_min={accepted_anchor_beat_min} below minimum"
                )
        if "accepted_anchor_beat_max" in expect:
            accepted_anchor_beat_max = result["accepted_anchor_beat_max"]
            if accepted_anchor_beat_max is None:
                failures.append("missing accepted_anchor_beat_max")
            elif accepted_anchor_beat_max > expect["accepted_anchor_beat_max"]:
                failures.append(
                    f"accepted_anchor_beat_max={accepted_anchor_beat_max} above maximum"
                )
        if "accepted_completion_beat_min" in expect:
            accepted_completion_beat = result["accepted_completion_beat"]
            if accepted_completion_beat is None:
                failures.append("missing accepted_completion_beat")
            elif accepted_completion_beat < expect["accepted_completion_beat_min"]:
                failures.append(
                    f"accepted_completion_beat={accepted_completion_beat} below minimum"
                )
        if "accepted_completion_beat_max" in expect:
            accepted_completion_beat = result["accepted_completion_beat"]
            if accepted_completion_beat is None:
                failures.append("missing accepted_completion_beat")
            elif accepted_completion_beat > expect["accepted_completion_beat_max"]:
                failures.append(
                    f"accepted_completion_beat={accepted_completion_beat} above maximum"
                )
        if expect.get("accepted_completion_must_reach_terminal_region"):
            accepted_completion_beat = result["accepted_completion_beat"]
            accepted_completion_alignment_beat = result.get(
                "accepted_completion_alignment_beat",
                accepted_completion_beat,
            )
            terminal_region_start = result["reference_slice"]["terminal_region_start_beat"]
            if accepted_completion_beat is None:
                failures.append("missing accepted_completion_beat")
            elif terminal_region_start is None:
                failures.append("missing terminal_region_start_beat")
            elif accepted_completion_alignment_beat < terminal_region_start:
                failures.append(
                    "accepted_completion_alignment_beat="
                    f"{accepted_completion_alignment_beat} before terminal_region_start_beat="
                    f"{terminal_region_start}"
                )
        for annotation_expect in expect.get("annotation_checks", []):
            annotation_id = annotation_expect["id"]
            annotations = result.get("annotated_events") or {}
            metrics = annotations.get(annotation_id)
            if metrics is None:
                failures.append(f"missing annotation metrics for {annotation_id}")
                continue
            if "min_accepted_in_region" in annotation_expect:
                accepted_in_region = int(metrics["accepted_in_region"])
                if accepted_in_region < annotation_expect["min_accepted_in_region"]:
                    failures.append(
                        f"{annotation_id}.accepted_in_region={accepted_in_region} "
                        "below minimum"
                    )
            if "max_accepted_outside_region" in annotation_expect:
                accepted_outside = int(metrics["accepted_outside_region"])
                if accepted_outside > annotation_expect["max_accepted_outside_region"]:
                    failures.append(
                        f"{annotation_id}.accepted_outside_region={accepted_outside} "
                        "above maximum"
                    )
            if "max_recovery_latency_seconds" in annotation_expect:
                recovery_latency = metrics["recovery_latency_seconds"]
                if recovery_latency is None:
                    failures.append(f"{annotation_id}.missing recovery latency")
                elif recovery_latency > annotation_expect["max_recovery_latency_seconds"]:
                    failures.append(
                        f"{annotation_id}.recovery_latency_seconds={recovery_latency} "
                        "above maximum"
                    )
            if "max_post_recovery_lost_episodes" in annotation_expect:
                lost_episodes = int(metrics["post_recovery_lost_episodes"])
                if lost_episodes > annotation_expect["max_post_recovery_lost_episodes"]:
                    failures.append(
                        f"{annotation_id}.post_recovery_lost_episodes={lost_episodes} "
                        "above maximum"
                    )
    if (
        "scope_completed" in expect
        and result["scope_completed"] is not expect["scope_completed"]
    ):
        failures.append(
            f"scope_completed={result['scope_completed']} expected={expect['scope_completed']}"
        )
    if (
        "accepted_completion_beat" in expect
        and result["accepted_completion_beat"] != expect["accepted_completion_beat"]
    ):
        failures.append(
            "accepted_completion_beat="
            f"{result['accepted_completion_beat']} expected="
            f"{expect['accepted_completion_beat']}"
        )
    if result["pause_checked"] and result["pause_emitted_updates"]:
        failures.append("emitted an update while paused")
    if result["pause_checked"] and not result["resume_emitted_updates"]:
        failures.append("did not resume emitting updates")
    return failures


def required_replay_results_pass(results: list[dict]) -> bool:
    return all(
        result.get("quality_status", "required") != "required" or not result["failures"]
        for result in results
    )


def known_gap_failures(results: list[dict]) -> dict[str, list[str]]:
    return {
        result["id"]: result["failures"]
        for result in results
        if result.get("quality_status") == "known_gap" and result["failures"]
    }


def parse_args() -> argparse.Namespace:
    fixture_root = Path(__file__).parents[1] / "tests" / "fixtures" / "practice_audio"
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--score", type=Path, required=True)
    parser.add_argument(
        "--manifest",
        type=Path,
        default=fixture_root / "profile_manifest.json",
    )
    parser.add_argument(
        "--transkun-midi",
        type=Path,
        default=None,
        help=(
            "Optional external AMT MIDI transcription for benchmark-only "
            "offline score-aligned oracle comparison."
        ),
    )
    parser.add_argument(
        "--transkun-provider-id",
        default=DEFAULT_TRANSCRIPTION_MIDI_PROVIDER_ID,
        help="Provider id to label the external Transkun MIDI benchmark.",
    )
    parser.add_argument(
        "--transkun-package-version",
        default="2.0.1",
        help="Transkun package version used to create --transkun-midi.",
    )
    parser.add_argument(
        "--transkun-checkpoint-id",
        default="pretrained/2.0.pt",
        help="Transkun checkpoint identifier used to create --transkun-midi.",
    )
    parser.add_argument(
        "--transkun-checkpoint-sha256",
        default=None,
        help="Optional SHA-256 digest of the checkpoint used to create --transkun-midi.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    manifest = json.loads(args.manifest.read_text(encoding="utf-8"))
    fixture_root = args.manifest.parent
    sample_rate = int(manifest["sample_rate"])
    acoustic_candidate_providers: tuple[AcousticEvidenceProvider, ...] = ()
    if args.transkun_midi is not None:
        expected_groups = practice_score_timeline_from_musicxml(args.score).expected_practice_groups
        acoustic_candidate_providers = (
            TranscriptionMidiEvidenceProvider.from_midi_file(
                args.transkun_midi,
                provider_id=args.transkun_provider_id,
                expected_groups=expected_groups,
                provider_metadata={
                    "package": "transkun",
                    "package_version": args.transkun_package_version,
                    "checkpoint_id": args.transkun_checkpoint_id,
                    "checkpoint_sha256": args.transkun_checkpoint_sha256,
                },
            ),
        )
    results = []

    for scenario in manifest["scenarios"]:
        try:
            result = run_scenario(
                score_path=args.score,
                fixture_root=fixture_root,
                scenario=scenario,
                sample_rate=sample_rate,
                acoustic_candidate_providers=acoustic_candidate_providers,
            )
        except Exception as exc:  # pragma: no cover - exercised by real-engine fixtures.
            result = {
                "id": scenario["id"],
                "quality_status": scenario.get("quality_status", "required"),
                "runtime_profile": PRACTICE_ALIGNMENT_RUNTIME_PROFILE_ID,
                "started": False,
                "error": f"{type(exc).__name__}: {exc}",
                "chunk_size_samples": scenario.get("chunk_size_samples"),
                "leading_sample_offset": int(scenario.get("leading_sample_offset", 0)),
                "armed_delay_seconds": float(scenario.get("armed_delay_seconds", 0.0)),
            }
        result["failures"] = evaluate_result(result, scenario["expect"])
        results.append(result)

    report = {
        "runtime_profile": PRACTICE_ALIGNMENT_RUNTIME_PROFILE_ID,
        "audio_profile": asdict(DEFAULT_PRACTICE_AUDIO_PROFILE),
        "passed": required_replay_results_pass(results),
        "known_gap_failures": known_gap_failures(results),
        "results": results,
    }
    print(json.dumps(report, ensure_ascii=True, indent=2))
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
