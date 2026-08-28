"""Pure reference-feature transformations for score following."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class ReferenceTimelineSlice:
    """Reference feature slice plus the beat metadata needed by realtime policy."""

    features: Any
    frame_to_beat: Any
    start_beat: float | None
    end_beat: float | None
    terminal_region_start_beat: float | None
    frame_step_beat: float


def slice_reference_timeline(
    reference_features,
    ref_frame_to_beat,
    *,
    score_start_beat: float,
    scope_start_beat: float | None,
    scope_end_beat: float | None,
    np,
) -> ReferenceTimelineSlice:
    """Crop reference features and expose stable endpoint metadata."""
    features, beats = trim_to_playable_start(
        reference_features,
        ref_frame_to_beat,
        score_start_beat=score_start_beat,
        np=np,
    )
    features, beats = trim_to_beat_range(
        features,
        beats,
        start_beat=scope_start_beat,
        end_beat=scope_end_beat,
        np=np,
    )
    if beats.size == 0:
        return ReferenceTimelineSlice(
            features=features,
            frame_to_beat=beats,
            start_beat=None,
            end_beat=None,
            terminal_region_start_beat=None,
            frame_step_beat=0.0,
        )

    start_beat = round(float(beats[0]), 3)
    end_beat = round(float(beats[-1]), 3)
    frame_step_beat = _terminal_frame_step_beat(beats, np=np)
    terminal_region_start_beat = end_beat - frame_step_beat
    if scope_start_beat is not None:
        terminal_region_start_beat = max(float(scope_start_beat), terminal_region_start_beat)

    return ReferenceTimelineSlice(
        features=features,
        frame_to_beat=beats,
        start_beat=start_beat,
        end_beat=end_beat,
        terminal_region_start_beat=round(float(terminal_region_start_beat), 3),
        frame_step_beat=round(float(frame_step_beat), 3),
    )


def trim_to_playable_start(reference_features, ref_frame_to_beat, *, score_start_beat: float, np):
    """Drop score-only leading rests that browser audio never contributes."""
    beats = np.asarray(ref_frame_to_beat, dtype=np.float32)
    features = np.asarray(reference_features)
    indices = np.flatnonzero(beats >= score_start_beat)
    if indices.size == 0:
        return features, beats
    start_index = int(indices[0])
    return features[start_index:], beats[start_index:]


def trim_to_beat_range(
    reference_features,
    ref_frame_to_beat,
    *,
    start_beat: float | None,
    end_beat: float | None,
    np,
):
    """Keep reference frames inside a selected practice beat range."""
    beats = np.asarray(ref_frame_to_beat, dtype=np.float32)
    features = np.asarray(reference_features)
    mask = np.ones(beats.shape, dtype=bool)
    if start_beat is not None:
        mask &= beats >= start_beat
    if end_beat is not None:
        mask &= beats <= end_beat
    indices = np.flatnonzero(mask)
    if indices.size == 0:
        return features[:0], beats[:0]
    return features[indices], beats[indices]


def _terminal_frame_step_beat(ref_frame_to_beat, *, np) -> float:
    positive_deltas = np.diff(ref_frame_to_beat)
    positive_deltas = positive_deltas[positive_deltas > 0]
    if positive_deltas.size == 0:
        return 0.0
    return float(np.median(positive_deltas[-8:]))
