from pathlib import Path

import pytest

from app.processing.musicxml import MetadataExtractionError, extract_musicxml_metadata

FIXTURES = Path(__file__).parent / "fixtures" / "musicxml"


def test_metadata_extractor_handles_repeats_key_meter_tempo_and_parts() -> None:
    result = extract_musicxml_metadata(
        (FIXTURES / "score-domain-metadata.musicxml").read_bytes()
    )

    assert result.measure_count == 4
    assert result.part_count == 2
    assert result.playback_duration_ms == 12000
    assert result.primary_key_fifths == 0
    assert result.primary_mode == "major"
    assert [event["fifths"] for event in result.key_signature_events if event["part"] == 1] == [0, 1]
    assert [event["beats"] for event in result.time_signature_events if event["part"] == 1] == [4, 3]
    assert [event["bpm"] for event in result.tempo_events] == [120.0, 90.0]
    assert result.extractor_version == "musicxml-metadata-v1"


def test_metadata_extractor_classifies_invalid_values() -> None:
    with pytest.raises(MetadataExtractionError) as error:
        extract_musicxml_metadata(
            (FIXTURES / "score-domain-invalid-metadata.musicxml").read_bytes()
        )

    assert str(error.value) == "invalid_key_fifths"
