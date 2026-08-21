from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.core.exceptions import ResourceNotFoundException
from app.db.models import Score
from app.db.models.practice import (
    PracticeInputSource,
    PracticeMode,
    PracticeReportStatus,
    PracticeSessionState,
)
from app.db.models.score_access import AccessOrigin
from app.modules.practice.read_model import PracticeReadModel
from app.shared.constants import ErrorCode


def _session(**overrides: object) -> SimpleNamespace:
    values = {
        "session_uuid": "session-1",
        "score_id": 11,
        "revision_id": 12,
        "access_origin": AccessOrigin.OWNER,
        "state": PracticeSessionState.CREATED,
        "practice_mode": PracticeMode.FREE_FOLLOW,
        "input_source": PracticeInputSource.MICROPHONE,
        "sample_rate": 16000,
        "channels": 1,
        "frame_format": "pcm_s16le",
        "started_at": None,
        "finished_at": None,
        "last_beat_position": None,
        "last_confidence": None,
        "report_status": PracticeReportStatus.NOT_REQUESTED,
        "report_payload": None,
    }
    values.update(overrides)
    return SimpleNamespace(**values)


@pytest.mark.asyncio
async def test_practice_read_model_builds_session_detail() -> None:
    database = AsyncMock()
    database.get = AsyncMock(
        side_effect=lambda model, _identity: (
            SimpleNamespace(score_uuid="score-1")
            if model is Score
            else SimpleNamespace(revision_uuid="revision-1")
        )
    )

    detail = await PracticeReadModel().to_session_detail(database, _session())

    assert detail.session_id == "session-1"
    assert detail.score_id == "score-1"
    assert detail.revision_id == "revision-1"
    assert detail.access_origin == AccessOrigin.OWNER
    assert detail.state == PracticeSessionState.CREATED
    assert detail.practice_mode == PracticeMode.FREE_FOLLOW
    assert detail.input_source == PracticeInputSource.MICROPHONE


@pytest.mark.asyncio
async def test_practice_read_model_rejects_missing_revision_context() -> None:
    database = AsyncMock()
    database.get = AsyncMock(
        side_effect=lambda model, _identity: (
            SimpleNamespace(score_uuid="score-1") if model is Score else None
        )
    )

    with pytest.raises(ResourceNotFoundException) as error:
        await PracticeReadModel().to_session_detail(database, _session())

    assert error.value.code == ErrorCode.REVISION_NOT_FOUND


def test_practice_read_model_parses_report_payload() -> None:
    report = PracticeReadModel().to_report_result(
        _session(
            report_status=PracticeReportStatus.READY,
            report_payload=(
                '{"summary":"done","metrics":{"confidence":0.91},'
                '"recommendations":["keep going"]}'
            ),
        )
    )

    assert report.session_id == "session-1"
    assert report.report_status == PracticeReportStatus.READY
    assert report.report_payload is not None
    assert report.report_payload.summary == "done"
    assert report.report_payload.metrics == {"confidence": 0.91}
    assert report.report_payload.recommendations == ["keep going"]
