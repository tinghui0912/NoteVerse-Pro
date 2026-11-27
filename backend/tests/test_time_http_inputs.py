"""HTTP time filters use aware UTC instant admission."""

from datetime import UTC, datetime
from unittest.mock import Mock
import pytest
from app.runtime.control_plane.routers.ops.router import get_ops_async_operation_query_service
from app.shared.pagination import OffsetPage
from tests.support.control_plane import (
    control_app as control_app,
    control_db as control_db,
    operator_client as operator_client,
)


@pytest.mark.parametrize(
    "value,accepted",
    [
        ("2026-11-15T10:00:00Z", True),
        ("2026-11-15T18:00:00+08:00", True),
        ("2026-11-15T10:00:00", False),
    ],
)
def test_operator_time_filters_require_offset_and_normalize_to_utc(
    control_app, operator_client, value, accepted
):
    query = Mock()
    query.list_operations.return_value = OffsetPage(items=[], limit=100, offset=0, has_more=False)
    control_app.dependency_overrides[get_ops_async_operation_query_service] = lambda: query
    response = operator_client.get(
        "/api/v1/ops/async-operations", params={"created_after": value, "updated_before": value}
    )
    assert response.status_code == (200 if accepted else 422)
    if accepted:
        for field in ("created_after", "updated_before"):
            actual = query.list_operations.call_args.kwargs[field]
            assert actual == datetime(2026, 11, 15, 10, tzinfo=UTC) and actual.tzinfo is UTC
    else:
        query.list_operations.assert_not_called()
        assert response.json()["code"] == "validation_error"
