from __future__ import annotations

from dataclasses import dataclass
from enum import Enum

from app.db.models.practice import (
    PracticeEvaluationProfile,
    PracticeInputSource,
    PracticeProgressionMode,
    PracticeRealtimeGuidance,
)
from app.core.exceptions import ValidationException


class PracticeSessionPreset(str, Enum):
    STEP_BY_STEP = "STEP_BY_STEP"
    CONTINUOUS_PLAY = "CONTINUOUS_PLAY"


class PracticeRuntimeKind(str, Enum):
    STEP_BY_STEP = "STEP_BY_STEP"
    FIXED_CLOCK_PERFORMANCE = "FIXED_CLOCK_PERFORMANCE"


@dataclass(frozen=True)
class PracticeRuntimeConfig:
    runtime_kind: PracticeRuntimeKind
    progression_mode: PracticeProgressionMode
    realtime_guidance: PracticeRealtimeGuidance
    evaluation_profile: PracticeEvaluationProfile
    input_source: PracticeInputSource


def canonical_runtime_config_for_preset(
    *,
    preset: PracticeSessionPreset,
    input_source: PracticeInputSource,
) -> PracticeRuntimeConfig:
    if input_source not in {PracticeInputSource.MICROPHONE, PracticeInputSource.MIDI}:
        raise ValidationException(field="input_source")

    if preset == PracticeSessionPreset.STEP_BY_STEP:
        return PracticeRuntimeConfig(
            runtime_kind=PracticeRuntimeKind.STEP_BY_STEP,
            progression_mode=PracticeProgressionMode.WAIT_FOR_NOTE,
            realtime_guidance=PracticeRealtimeGuidance.GUIDED,
            evaluation_profile=PracticeEvaluationProfile.LEARNING,
            input_source=input_source,
        )

    if preset == PracticeSessionPreset.CONTINUOUS_PLAY:
        return PracticeRuntimeConfig(
            runtime_kind=PracticeRuntimeKind.FIXED_CLOCK_PERFORMANCE,
            progression_mode=PracticeProgressionMode.CONTINUOUS,
            realtime_guidance=PracticeRealtimeGuidance.STATUS_ONLY,
            evaluation_profile=PracticeEvaluationProfile.PERFORMANCE,
            input_source=input_source,
        )

    raise ValidationException(field="preset")


def canonical_runtime_kind_for_execution_config(
    *,
    progression_mode: PracticeProgressionMode,
    realtime_guidance: PracticeRealtimeGuidance,
    evaluation_profile: PracticeEvaluationProfile,
) -> PracticeRuntimeKind:
    if (
        progression_mode == PracticeProgressionMode.WAIT_FOR_NOTE
        and realtime_guidance == PracticeRealtimeGuidance.GUIDED
        and evaluation_profile == PracticeEvaluationProfile.LEARNING
    ):
        return PracticeRuntimeKind.STEP_BY_STEP

    if (
        progression_mode == PracticeProgressionMode.CONTINUOUS
        and realtime_guidance == PracticeRealtimeGuidance.STATUS_ONLY
        and evaluation_profile == PracticeEvaluationProfile.PERFORMANCE
    ):
        return PracticeRuntimeKind.FIXED_CLOCK_PERFORMANCE

    raise ValidationException(field="runtime_config")
