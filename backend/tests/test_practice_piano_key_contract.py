from pathlib import Path
from unittest.mock import Mock, patch

from tests.practice_bundle_fixtures import bundle_service_for_notation, authorize_test_revision
import pytest

from app.core.exceptions import ExternalServiceException, ValidationException
from app.modules.practice.score.piano_key import PracticeScoreInvalidError
from app.modules.practice.score.domain import (
    CompiledPracticeScore,
    CompiledPracticeNote,
    PracticeMeterSegment,
)
from app.modules.practice.score.time import PracticeScoreTimebase
from app.modules.practice.score.timeline import practice_timeline_from_compiled
from app.modules.practice.score.artifact import practice_score_artifact_from_timeline


def make_timeline(keys):
    return practice_timeline_from_compiled(
        CompiledPracticeScore(
            tuple(
                CompiledPracticeNote(f"n{i}", i, 1, key, "1", "1", "1", f"p1-m1-e{i + 1}", ())
                for i, key in enumerate(keys)
            ),
            (PracticeMeterSegment(0, 4, 4),),
            (),
            (),
            PracticeScoreTimebase(1),
            len(keys),
        )
    )


@pytest.mark.parametrize("key", [21, 108])
def test_piano_endpoints_are_practice_ready(key):
    timeline = make_timeline([key])
    artifact = practice_score_artifact_from_timeline(timeline, score_tempo_segments=())
    assert artifact["schemaVersion"] == 1
    assert [a["pianoKey"] for a in artifact["moments"][0]["attacks"]] == [key]


@pytest.mark.parametrize("keys", [[20], [109], [60, 20], [60, 109], []])
def test_entire_revision_is_invalid_even_if_an_earlier_section_is_playable(keys):
    with pytest.raises(PracticeScoreInvalidError):
        make_timeline(keys)


@pytest.mark.parametrize(
    "error, exception, code, status",
    [
        (
            PracticeScoreInvalidError("outside piano domain"),
            ValidationException,
            "practice_score_invalid",
            422,
        ),
        (
            RuntimeError("parser unavailable"),
            ExternalServiceException,
            "practice_bundle_failed",
            503,
        ),
    ],
)
def test_score_invalidity_is_distinct_from_infrastructure(error, exception, code, status):
    service = bundle_service_for_notation(b"xml")
    with (
        patch.object(Path, "read_bytes", return_value=b"xml"),
        patch.object(service.compiler, "compile", side_effect=error),
    ):
        with pytest.raises(exception) as caught:
            service.read_bundle(Mock(), "s", 1, "r")
    assert caught.value.code == code
    assert caught.value.status_code == status


@pytest.fixture(autouse=True)
def authorized_revision(monkeypatch):
    authorize_test_revision(monkeypatch)
