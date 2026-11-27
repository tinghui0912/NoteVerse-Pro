"""One durable Import intent codec and a separate public command contract."""

import pytest
from pydantic import ValidationError
from app.modules.import_jobs.requested_options import (
    ImportJobRequestedOptionsV1,
    encode_requested_options,
    decode_requested_options,
)
from app.modules.import_jobs.schemas import ImportJobSubmitRequest
from app.modules.scores.genres import ScoreGenre
from app.main import app


def test_default_and_requested_intent_have_canonical_versioned_json():
    assert encode_requested_options(None) == {
        "schema_version": 1,
        "display_title": None,
        "genres": [],
    }
    encoded = encode_requested_options(
        {"display_title": "Etudes", "genres": ["jazz", "classical", "jazz"]}
    )
    assert encoded == {
        "schema_version": 1,
        "display_title": "Etudes",
        "genres": ["classical", "jazz"],
    }
    decoded = decode_requested_options(encoded)
    assert isinstance(decoded, ImportJobRequestedOptionsV1)
    assert decoded.display_title == "Etudes"
    assert decoded.genres == [ScoreGenre.CLASSICAL, ScoreGenre.JAZZ]


@pytest.mark.parametrize(
    "payload",
    [
        None,
        {},
        {"display_title": "Etudes"},
        {"schema_version": 2},
        {"schema_version": 1, "display_title": None, "genres": [], "unknown_field": True},
        {"schema_version": 1, "display_title": 12, "genres": []},
        {"schema_version": 1, "display_title": None, "genres": ["unknown"]},
        {"schema_version": 1, "display_title": None, "genres": "jazz"},
        {"schema_version": True, "display_title": None, "genres": []},
        {"schema_version": 1.0, "display_title": None, "genres": []},
        {"schema_version": "1", "display_title": None, "genres": []},
        {"schema_version": 1},
    ],
)
def test_durable_decoder_requires_complete_supported_schema(payload):
    with pytest.raises(ValidationError):
        decode_requested_options(payload)


def test_public_submit_options_are_unversioned_requested_metadata():
    request = ImportJobSubmitRequest(
        upload_ids=["upload"], options={"display_title": "Etudes", "genres": ["jazz"]}
    )
    assert request.options == {"display_title": "Etudes", "genres": [ScoreGenre.JAZZ]}
    with pytest.raises(ValidationError):
        ImportJobSubmitRequest.model_validate(
            {"upload_ids": ["upload"], "options": {"schema_version": 1}}
        )
    properties = app.openapi()["components"]["schemas"]["ImportJobRequestedOptions"]["properties"]
    assert set(properties) == {"display_title", "genres"}


@pytest.mark.parametrize(
    "explicit,requested,notation,expected",
    [
        ("Explicit", "Requested", "Notation", "Explicit"),
        (None, " Requested ", "Notation", "Requested"),
        (None, None, "Notation", "Notation"),
        (None, None, None, "Untitled score"),
    ],
)
def test_confirmation_title_uses_typed_requested_defaults(explicit, requested, notation, expected):
    from app.modules.import_jobs.review.service import ImportReviewService
    from app.modules.import_jobs.review.schemas import ReviewConfirmRequest

    content = (
        "<score-partwise>"
        + (f"<work><work-title>{notation}</work-title></work>" if notation else "")
        + "</score-partwise>"
    ).encode()
    options = ImportJobRequestedOptionsV1(schema_version=1, display_title=requested, genres=[])
    request = ReviewConfirmRequest(content=content.decode(), display_title=explicit)
    assert ImportReviewService._confirmed_display_title(options, request, content) == expected
