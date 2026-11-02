from __future__ import annotations

from fastapi.testclient import TestClient


def test_score_openapi_keeps_read_model_fields_required(client: TestClient) -> None:
    """Prevent optional schema defaults from weakening the customer API contract."""
    components = client.get("/api/v1/openapi.json").json()["components"]["schemas"]

    expected_required_fields = {
        "ScoreCapabilities": {
            "can_view",
            "can_download",
            "can_edit",
            "can_delete",
            "can_manage_sharing",
            "can_manage_members",
            "can_practice",
        },
        "ScoreDerivedAssetRead": {
            "status",
            "asset_id",
            "revision_id",
            "is_fallback",
        },
        "ScoreRead": {
            "score_id",
            "title",
            "taxonomy_tags",
            "version",
            "head_revision_id",
            "derived_assets",
            "input_assets",
            "in_library",
            "metadata",
            "created_at",
            "updated_at",
            "capabilities",
        },
        "ScoreTaxonomyTagRead": {"category", "code", "source", "confidence"},
    }

    for schema_name, fields in expected_required_fields.items():
        assert fields == set(components[schema_name]["required"])
        assert fields == set(components[schema_name]["properties"])


def test_score_access_contract_exposes_current_channels_and_owned_score_filters(
    client: TestClient,
) -> None:
    from app.db.models.score_access import AccessOrigin
    from app.modules.score_access.policy import ScoreAction

    assert {origin.value for origin in AccessOrigin} == {"OWNER", "MEMBERSHIP", "SHARE"}
    assert {action.value for action in ScoreAction} == {
        "VIEW",
        "EDIT",
        "DELETE",
        "MANAGE_SHARING",
        "MANAGE_MEMBERS",
        "DOWNLOAD",
        "PRACTICE",
    }
    paths = client.get("/api/v1/openapi.json").json()["paths"]
    assert {
        item["name"]
        for item in paths["/api/v1/my-scores"]["get"]["parameters"]
        if item["in"] == "query"
    } == {
        "page",
        "page_size",
        "search",
        "sort",
    }
    assert {
        "/api/v1/scores/{score_id}",
        "/api/v1/score-grants/{token}",
        "/api/v1/invites/{token}",
        "/api/v1/scores/{score_id}/members",
    } <= paths.keys()
