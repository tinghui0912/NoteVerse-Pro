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
            "can_publish",
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
            "publication",
            "in_library",
            "metadata",
            "created_at",
            "updated_at",
            "capabilities",
        },
        "ScoreTaxonomyTagRead": {"category", "code", "source", "confidence"},
    }

    for schema_name, fields in expected_required_fields.items():
        assert fields.issubset(components[schema_name]["required"])
