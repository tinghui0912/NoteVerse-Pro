from pathlib import Path

import pytest

from app.processing.musicxml import MetadataExtractionError, extract_musicxml_metadata
from app.processing.musicxml.notation_title import extract_notation_title

FIXTURES = Path(__file__).parent / "fixtures" / "musicxml"


@pytest.mark.parametrize(
    "work,expected",
    [
        ("", None),
        ("<work><work-title> \n </work-title></work>", None),
        ("<work><work-title>  月光 — Sonata  </work-title></work>", "月光 — Sonata"),
    ],
)
def test_notation_title_uses_work_metadata_and_preserves_content(work, expected):
    from tests.test_score_revision_services import MUSICXML_1

    content = MUSICXML_1.decode().replace(
        "<part-list>",
        work
        + "<credit><credit-type>title</credit-type><credit-words>Visible credit</credit-words></credit><part-list>",
    )
    assert extract_notation_title(content) == expected
    assert extract_musicxml_metadata(content).notation_title == expected


def test_notation_title_accepts_a_namespaced_canonical_document():
    assert (
        extract_notation_title(
            '<score-partwise xmlns="http://www.musicxml.org/ns/musicxml"><work><work-title> Étude </work-title></work></score-partwise>'
        )
        == "Étude"
    )


def test_metadata_projection_applies_and_clears_derived_notation_title():
    from app.db.models import ScoreRevisionMetadata
    from app.modules.metadata.service import MetadataProjectionService
    from tests.test_score_revision_services import MUSICXML_1

    result = extract_musicxml_metadata(
        MUSICXML_1.decode().replace(
            "<part-list>", "<work><work-title>Notation</work-title></work><part-list>"
        )
    )
    projection = ScoreRevisionMetadata(revision_id=1)
    MetadataProjectionService._apply_result(projection, result)
    assert projection.notation_title == "Notation"
    MetadataProjectionService._mark_failed(projection, "metadata_invalid")
    assert projection.notation_title is None


def test_metadata_extractor_handles_repeats_key_meter_tempo_and_parts() -> None:
    result = extract_musicxml_metadata((FIXTURES / "score-domain-metadata.musicxml").read_bytes())

    assert result.measure_count == 4
    assert result.part_count == 2
    assert result.playback_duration_ms == 12000
    assert result.primary_key_fifths == 0
    assert result.primary_mode == "major"
    assert [event["fifths"] for event in result.key_signature_events if event["part"] == 1] == [
        0,
        1,
    ]
    assert [event["beats"] for event in result.time_signature_events if event["part"] == 1] == [
        4,
        3,
    ]
    assert [event["bpm"] for event in result.tempo_events] == [120.0, 90.0]
    assert result.extractor_version == "musicxml-metadata-v1"


def test_metadata_extractor_classifies_invalid_values() -> None:
    with pytest.raises(MetadataExtractionError) as error:
        extract_musicxml_metadata(
            (FIXTURES / "score-domain-invalid-metadata.musicxml").read_bytes()
        )

    assert str(error.value) == "invalid_key_fifths"
