"""Stateless quality metrics for live score-following updates."""

from dataclasses import dataclass


@dataclass(frozen=True)
class AlignmentQualityConfig:
    """Named thresholds for converting raw follower deltas into quality evidence."""

    feature_mismatch_threshold: float = 0.35
    weak_feature_threshold: float = 0.7
    weak_path_threshold: float = 0.65
    rollback_delta_beats: float = -0.5
    minor_rollback_delta_beats: float = -0.1
    jump_delta_beats: float = 4.0
    large_jump_delta_beats: float = 8.0
    initial_confidence: float = 0.9
    stable_confidence: float = 0.95
    rollback_confidence: float = 0.45
    minor_rollback_confidence: float = 0.65
    large_jump_confidence: float = 0.35
    jump_confidence: float = 0.7
    feature_mismatch_validation_ceiling: float = 0.0
    weak_validation_ceiling: float = 0.5
    unstable_validation_ceiling: float = 0.3
    stable_validation_ceiling: float = 1.0


DEFAULT_ALIGNMENT_QUALITY_CONFIG = AlignmentQualityConfig()


def alignment_state(
    *,
    raw_alignment_confidence: float,
    feature_confidence: float,
    config: AlignmentQualityConfig = DEFAULT_ALIGNMENT_QUALITY_CONFIG,
) -> str:
    if feature_confidence < config.feature_mismatch_threshold:
        return "feature_mismatch"
    if feature_confidence < config.weak_feature_threshold:
        return "weak_feature_match"
    if raw_alignment_confidence < config.weak_path_threshold:
        return "weak_path"
    return "matched"


def continuity_state(
    beat_delta: float | None,
    *,
    config: AlignmentQualityConfig = DEFAULT_ALIGNMENT_QUALITY_CONFIG,
) -> str:
    if beat_delta is None:
        return "initial"
    if beat_delta < config.rollback_delta_beats:
        return "rollback"
    if beat_delta < config.minor_rollback_delta_beats:
        return "minor_rollback"
    if beat_delta > config.large_jump_delta_beats:
        return "large_jump"
    if beat_delta > config.jump_delta_beats:
        return "jump"
    return "stable"


def validation_confidence_ceiling(
    *,
    alignment_state: str,
    continuity_state: str,
    config: AlignmentQualityConfig = DEFAULT_ALIGNMENT_QUALITY_CONFIG,
) -> float:
    if alignment_state == "feature_mismatch":
        return config.feature_mismatch_validation_ceiling
    if alignment_state in {"weak_feature_match", "weak_path"}:
        return config.weak_validation_ceiling
    if continuity_state in {"rollback", "large_jump"}:
        return config.unstable_validation_ceiling
    if continuity_state in {"minor_rollback", "jump"}:
        return config.weak_validation_ceiling
    return config.stable_validation_ceiling


def alignment_path_confidence(
    beat_delta: float | None,
    *,
    config: AlignmentQualityConfig = DEFAULT_ALIGNMENT_QUALITY_CONFIG,
) -> float:
    if beat_delta is None:
        return config.initial_confidence
    if beat_delta < config.rollback_delta_beats:
        return config.rollback_confidence
    if beat_delta < config.minor_rollback_delta_beats:
        return config.minor_rollback_confidence
    return config.stable_confidence


def continuity_confidence(
    beat_delta: float | None,
    *,
    config: AlignmentQualityConfig = DEFAULT_ALIGNMENT_QUALITY_CONFIG,
) -> float:
    if beat_delta is None:
        return config.initial_confidence
    if beat_delta < config.rollback_delta_beats:
        return config.unstable_validation_ceiling
    if beat_delta < config.minor_rollback_delta_beats:
        return config.minor_rollback_confidence
    if beat_delta > config.large_jump_delta_beats:
        return config.large_jump_confidence
    if beat_delta > config.jump_delta_beats:
        return config.jump_confidence
    return config.stable_confidence


def beat_velocity(*, beat_delta: float | None, timestamp_ms: int, previous_timestamp_ms: int | None) -> float | None:
    if beat_delta is None or previous_timestamp_ms is None:
        return None
    elapsed_seconds = (timestamp_ms - previous_timestamp_ms) / 1000
    if elapsed_seconds <= 0:
        return None
    return round(beat_delta / elapsed_seconds, 3)
