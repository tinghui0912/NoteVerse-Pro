from datetime import UTC
from datetime import datetime, timezone, timedelta

import pytest
from pydantic import ValidationError
from app.shared.responses import ApiErrorResponse, error_response
from app.shared.api_model import ApiModel
from app.shared.time import Instant
from app.shared.pagination import PageNumberPage


class NestedRead(ApiModel):
    expires_at: Instant


class TimestampRead(ApiModel):
    created_at: Instant
    nested: NestedRead


def test_direct_representation_serializes_nested_datetimes_as_explicit_utc():
    model = TimestampRead(
        created_at=datetime(2026, 6, 23, 14, 38, tzinfo=UTC),
        nested=NestedRead(
            expires_at=datetime(2026, 6, 30, 22, 38, tzinfo=timezone(timedelta(hours=8)))
        ),
    )
    body = model.model_dump(mode="json")
    for value, expected in [
        (body["created_at"], model.created_at),
        (body["nested"]["expires_at"], model.nested.expires_at),
    ]:
        parsed = datetime.fromisoformat(value)
        assert parsed.utcoffset() == timedelta(0) and parsed == expected
    schema = model.model_json_schema(mode="serialization")
    assert schema["properties"]["created_at"]["format"] == "date-time"
    assert set(model.model_dump(mode="json", exclude={"nested"})) == {"created_at"}


def test_page_number_resource_has_explicit_items_and_total_pages():
    item = NestedRead(expires_at=datetime(2026, 6, 23, 14, 38, tzinfo=UTC))
    page = PageNumberPage[NestedRead](items=[item], page=2, page_size=10, total=21)
    assert page.model_dump(mode="json") == {
        "items": [{"expires_at": item.model_dump(mode="json")["expires_at"]}],
        "page": 2,
        "page_size": 10,
        "total": 21,
        "total_pages": 3,
    }


def test_error_response_contains_required_correlation() -> None:
    response = error_response(
        code="validation_error",
        request_id="req-123",
    )

    assert response == {
        "code": "validation_error",
        "request_id": "req-123",
    }


@pytest.mark.parametrize(
    "payload",
    [
        {"code": "internal_error"},
        {"code": "internal_error", "request_id": None},
        {"code": "internal_error", "request_id": ""},
    ],
)
def test_application_error_requires_nonempty_correlation(payload) -> None:
    with pytest.raises(ValidationError):
        ApiErrorResponse.model_validate(payload)
