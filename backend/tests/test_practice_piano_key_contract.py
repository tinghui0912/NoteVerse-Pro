from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import numpy as np
import pytest

from app.core.exceptions import ExternalServiceException, ValidationException
from app.modules.practice.source.service import PracticeSourceService
from app.processing.practice_score.piano_key import PracticeScoreInvalidError
from app.processing.practice_score.score_timeline import PracticeScoreTimeline
from app.processing.practice_score.practice_score_artifact import practice_score_artifact_from_timeline


def notes(keys):
    return np.array([(float(i), 1., key, f"n{i}") for i, key in enumerate(keys)],
                    dtype=[("onset_beat", "f8"), ("duration_beat", "f8"), ("pitch", "i4"), ("id", "U20")])


@pytest.mark.parametrize("key", [21, 108])
def test_piano_endpoints_are_practice_ready(key):
    timeline = PracticeScoreTimeline.from_note_array(notes([key]))
    artifact = practice_score_artifact_from_timeline(timeline, score_id="s", revision_id="r", score_tempo_segments=())
    assert artifact["schemaVersion"] == 3
    assert [a["pianoKey"] for a in artifact["moments"][0]["attacks"]] == [key]


@pytest.mark.parametrize("keys", [[20], [109], [60, 20], [60, 109], []])
def test_entire_revision_is_invalid_even_if_an_earlier_section_is_playable(keys):
    with pytest.raises(PracticeScoreInvalidError):
        PracticeScoreTimeline.from_note_array(notes(keys))


@pytest.mark.asyncio
@pytest.mark.parametrize("error, exception, code, status", [
    (PracticeScoreInvalidError("outside piano domain"), ValidationException, "practice_score_invalid", 422),
    (RuntimeError("parser unavailable"), ExternalServiceException, "practice_source_failed", 503),
])
async def test_score_invalidity_is_distinct_from_infrastructure(error, exception, code, status):
    service = PracticeSourceService()
    access = SimpleNamespace(score=SimpleNamespace(score_uuid="s"), revision=SimpleNamespace(revision_uuid="r"))
    service._authorized_musicxml_path = AsyncMock(return_value=(access, Path("score.musicxml")))
    with patch.object(Path, "read_bytes", return_value=b"xml"), patch.object(service.builder, "build", side_effect=error):
        with pytest.raises(exception) as caught:
            await service.read_source(AsyncMock(), "s", 1, "r")
    assert caught.value.code == code
    assert caught.value.status_code == status
