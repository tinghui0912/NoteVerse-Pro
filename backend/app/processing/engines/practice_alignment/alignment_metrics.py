"""Stateless quality metrics for live score-following updates."""


def alignment_state(*, raw_alignment_confidence: float, feature_confidence: float) -> str:
    if feature_confidence < 0.35:
        return "feature_mismatch"
    if feature_confidence < 0.7:
        return "weak_feature_match"
    if raw_alignment_confidence < 0.65:
        return "weak_path"
    return "matched"


def continuity_state(beat_delta: float | None) -> str:
    if beat_delta is None:
        return "initial"
    if beat_delta < -0.5:
        return "rollback"
    if beat_delta < -0.1:
        return "minor_rollback"
    if beat_delta > 8.0:
        return "large_jump"
    if beat_delta > 4.0:
        return "jump"
    return "stable"


def validation_confidence_ceiling(*, alignment_state: str, continuity_state: str) -> float:
    if alignment_state == "feature_mismatch":
        return 0.0
    if alignment_state in {"weak_feature_match", "weak_path"}:
        return 0.5
    if continuity_state in {"rollback", "large_jump"}:
        return 0.3
    if continuity_state in {"minor_rollback", "jump"}:
        return 0.5
    return 1.0


def beat_velocity(*, beat_delta: float | None, timestamp_ms: int, previous_timestamp_ms: int | None) -> float | None:
    if beat_delta is None or previous_timestamp_ms is None:
        return None
    elapsed_seconds = (timestamp_ms - previous_timestamp_ms) / 1000
    if elapsed_seconds <= 0:
        return None
    return round(beat_delta / elapsed_seconds, 3)
