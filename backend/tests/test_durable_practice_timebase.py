"""Exact durable score timebase and transport admission."""

from fractions import Fraction
import pytest
from pydantic import ValidationError
from app.modules.performance_takes.schemas import (
    PerformanceTakeScoreTimebase,
    PerformanceTakeTempoPlan,
    PerformanceTakeResolvedFullScope,
)
from app.modules.practice.score.generated.contract import MAX_JSON_SAFE_INTEGER as MAX_SAFE


@pytest.mark.parametrize("value", [0, -1, True, 1.0, MAX_SAFE + 1])
def test_score_timebase_transport_requires_positive_safe_integer(value):
    with pytest.raises(ValidationError):
        PerformanceTakeScoreTimebase(ticks_per_quarter=value)


def test_complete_snapshot_validation_is_source_independent():
    grid = PerformanceTakeScoreTimebase(ticks_per_quarter=60)
    scope = PerformanceTakeResolvedFullScope(kind="FULL", start_tick=30, terminal_tick=120)
    tempo = PerformanceTakeTempoPlan.model_validate(
        {
            "selection": {"mode": "SCORE"},
            "segments": [
                {"startTick": 0, "bpm": 80, "source": "PRODUCT_DEFAULT"},
                {"startTick": 113, "bpm": 100, "source": "MUSICXML"},
            ],
        }
    )
    assert Fraction(scope.start_tick, grid.ticks_per_quarter) == Fraction(1, 2)
    assert Fraction(tempo.segments[-1].startTick, grid.ticks_per_quarter) == Fraction(113, 60)
    for tick in [-1, 1.5, MAX_SAFE + 1]:
        with pytest.raises(ValidationError):
            PerformanceTakeTempoPlan.model_validate(
                {
                    "selection": {"mode": "SCORE"},
                    "segments": [{"startTick": tick, "bpm": 100, "source": "MUSICXML"}],
                }
            )
    with pytest.raises(ValidationError):
        PerformanceTakeResolvedFullScope(kind="FULL", start_tick=31, terminal_tick=30)


def test_client_cannot_choose_durable_score_timebase():
    from app.modules.performance_takes.schemas import PerformanceTakeUploadReservationRequest

    payload = {
        "client_request_id": "request",
        "practice_binding": {"score_id": "score", "revision_id": "revision", "bundle_id": "bundle"},
        "media": {"kind": "AUDIO", "byte_size": 1, "mime_type": "audio/webm"},
        "scope": {"kind": "FULL"},
        "tempo_selection": {"mode": "SCORE"},
        "recording_timebase": {
            "nominalMediaDurationUs": 1000000,
            "activeSegments": [
                {
                    "performanceStartUs": 0,
                    "performanceEndUs": 1000000,
                    "mediaStartUs": 0,
                    "mediaEndUs": 1000000,
                }
            ],
        },
    }
    for field, value in [("ticks_per_quarter", 60), ("score_timebase", {"ticks_per_quarter": 60})]:
        with pytest.raises(ValidationError):
            PerformanceTakeUploadReservationRequest.model_validate(payload | {field: value})
