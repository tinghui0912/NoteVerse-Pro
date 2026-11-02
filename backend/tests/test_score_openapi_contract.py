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
            "can_manage_guest_previews",
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

    assert {origin.value for origin in AccessOrigin} == {"OWNER", "MEMBERSHIP"}
    assert {action.value for action in ScoreAction} == {
        "VIEW",
        "EDIT",
        "DELETE",
        "MANAGE_GUEST_PREVIEWS",
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
        "/api/v1/guest-previews/{token}",
        "/api/v1/invites/{token}",
        "/api/v1/scores/{score_id}/members",
    } <= paths.keys()


def test_guest_preview_contract_is_presentation_only(client: TestClient) -> None:
    schema = client.get("/api/v1/openapi.json").json()
    operations = {
        (method, path)
        for path, methods in schema["paths"].items()
        for method, operation in methods.items()
        if "Guest Previews" in operation.get("tags", [])
    }
    assert operations == {
        ("post", "/api/v1/scores/{score_id}/guest-previews"),
        ("get", "/api/v1/scores/{score_id}/guest-previews"),
        ("post", "/api/v1/scores/guest-previews/{preview_id}/revoke"),
        ("delete", "/api/v1/scores/guest-previews/{preview_id}"),
        ("get", "/api/v1/guest-previews/{token}"),
        ("get", "/api/v1/guest-previews/{token}/render-assets/{asset_id}/view"),
        ("get", "/api/v1/guest-previews/{token}/playback"),
    }
    components = schema["components"]["schemas"]
    assert set(components["GuestPreviewRead"]["properties"]) == {
        "title",
        "shared_by",
        "created_at",
        "expires_at",
        "render_assets",
        "audio_available",
    }
    assert set(components["GuestPreviewCreateRequest"]["properties"]) == {"expires_at"}
    assert components["GuestPreviewCreateRequest"]["additionalProperties"] is False
    assert set(components["GuestPreviewListItem"]["properties"]) == {
        "preview_id",
        "created_at",
        "expires_at",
        "revoked_at",
    }


def test_collaboration_role_contract_is_least_privilege(client: TestClient) -> None:
    components = client.get("/api/v1/openapi.json").json()["components"]["schemas"]
    assert components["MembershipRole"]["enum"] == ["VIEWER", "PRACTITIONER", "EDITOR"]
    assert components["InviteCreateRequest"]["properties"]["role"]["default"] == "VIEWER"


def test_revision_create_contract_describes_snapshot_head_expectation(client: TestClient) -> None:
    schemas = client.get("/api/v1/openapi.json").json()["components"]["schemas"]
    request = schemas["RevisionCreateRequest"]
    assert set(request["properties"]) == {
        "content",
        "expected_head_revision_id",
        "idempotency_key",
        "origin",
    }
    assert set(request["required"]) == {"content", "expected_head_revision_id"}
    assert request["additionalProperties"] is False
    assert set(schemas["RevisionRead"]["properties"]) == {
        "revision_id",
        "revision_number",
        "origin",
        "created_at",
        "created_by",
        "restore",
        "note",
    }
