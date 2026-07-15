from datetime import datetime, timezone, timedelta

from app.shared.responses import error_response, paginated_response, success_response


def test_success_response_serializes_datetimes_as_explicit_utc() -> None:
    response = success_response(
        data={
            "created_at": datetime(2026, 6, 23, 14, 38, 0),
            "nested": {
                "expires_at": datetime(
                    2026,
                    6,
                    30,
                    22,
                    38,
                    0,
                    tzinfo=timezone(timedelta(hours=8)),
                )
            },
        }
    )

    assert response["data"] == {
        "created_at": "2026-06-23T14:38:00.000000Z",
        "nested": {"expires_at": "2026-06-30T14:38:00.000000Z"},
    }


def test_paginated_response_serializes_nested_datetimes() -> None:
    response = paginated_response(
        data=[{"updated_at": datetime(2026, 6, 23, 14, 38, 0)}],
        page=1,
        page_size=10,
        total=1,
    )

    assert response["data"] == [{"updated_at": "2026-06-23T14:38:00.000000Z"}]


def test_error_response_includes_request_id_when_available() -> None:
    response = error_response(
        public_code="validation_error",
        public_message="validation_error",
        request_id="req-123",
        internal_details={"field": "name"},
    )

    assert response == {
        "success": False,
        "public_code": "validation_error",
        "public_message": "validation_error",
        "request_id": "req-123",
        "internal_details": {"field": "name"},
    }
