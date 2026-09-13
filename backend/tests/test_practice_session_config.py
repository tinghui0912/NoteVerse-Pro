from __future__ import annotations

import pytest

from app.core.exceptions import ValidationException
from app.db.models.practice import (
    PracticeEvaluationProfile,
    PracticeInputSource,
    PracticeProgressionMode,
    PracticeRealtimeGuidance,
)
from app.modules.practice.session_config import (
    PracticeRuntimeKind,
    PracticeSessionPreset,
    canonical_runtime_config_for_preset,
    canonical_runtime_kind_for_execution_config,
)


def test_canonical_runtime_kind_recognizes_step_by_step_learning() -> None:
    assert (
        canonical_runtime_kind_for_execution_config(
            progression_mode=PracticeProgressionMode.WAIT_FOR_NOTE,
            realtime_guidance=PracticeRealtimeGuidance.GUIDED,
            evaluation_profile=PracticeEvaluationProfile.LEARNING,
        )
        == PracticeRuntimeKind.STEP_BY_STEP
    )


def test_step_by_step_preset_projects_to_learning_runtime_config() -> None:
    config = canonical_runtime_config_for_preset(
        preset=PracticeSessionPreset.STEP_BY_STEP,
        input_source=PracticeInputSource.MICROPHONE,
    )

    assert config.runtime_kind == PracticeRuntimeKind.STEP_BY_STEP
    assert config.progression_mode == PracticeProgressionMode.WAIT_FOR_NOTE
    assert config.realtime_guidance == PracticeRealtimeGuidance.GUIDED
    assert config.evaluation_profile == PracticeEvaluationProfile.LEARNING


def test_continuous_play_preset_projects_to_fixed_clock_runtime_config() -> None:
    config = canonical_runtime_config_for_preset(
        preset=PracticeSessionPreset.CONTINUOUS_PLAY,
        input_source=PracticeInputSource.MIDI,
    )

    assert config.runtime_kind == PracticeRuntimeKind.FIXED_CLOCK_PERFORMANCE
    assert config.progression_mode == PracticeProgressionMode.CONTINUOUS
    assert config.realtime_guidance == PracticeRealtimeGuidance.STATUS_ONLY
    assert config.evaluation_profile == PracticeEvaluationProfile.PERFORMANCE


def test_canonical_runtime_kind_recognizes_fixed_clock_performance() -> None:
    assert (
        canonical_runtime_kind_for_execution_config(
            progression_mode=PracticeProgressionMode.CONTINUOUS,
            realtime_guidance=PracticeRealtimeGuidance.STATUS_ONLY,
            evaluation_profile=PracticeEvaluationProfile.PERFORMANCE,
        )
        == PracticeRuntimeKind.FIXED_CLOCK_PERFORMANCE
    )


def test_canonical_runtime_kind_rejects_free_axis_combinations() -> None:
    with pytest.raises(ValidationException):
        canonical_runtime_kind_for_execution_config(
            progression_mode=PracticeProgressionMode.CONTINUOUS,
            realtime_guidance=PracticeRealtimeGuidance.GUIDED,
            evaluation_profile=PracticeEvaluationProfile.LEARNING,
        )
