from __future__ import annotations

from fastapi.testclient import TestClient


def test_score_genre_fields_reference_the_named_domain_enum(client: TestClient) -> None:
    from app.modules.scores.genres import ScoreGenre

    components = client.get("/api/v1/openapi.json").json()["components"]["schemas"]
    assert components["ScoreGenre"]["type"] == "string"
    assert components["ScoreGenre"]["enum"] == [genre.value for genre in ScoreGenre]
    genre_fields = {
        name: component["properties"]["genres"]
        for name, component in components.items()
        if "genres" in component.get("properties", {})
    }
    assert {
        "ScoreRead",
        "ScoreUpdateRequest",
        "ImportJobRead",
        "ImportJobProcessingOptions",
        "ImportJobReviewRead",
        "ReviewConfirmRequest",
        "LibraryScoreRead",
    } <= genre_fields.keys()
    for name, field in genre_fields.items():
        alternatives = field.get("anyOf", [field])
        arrays = [alternative for alternative in alternatives if alternative.get("type") == "array"]
        assert len(arrays) == 1, name
        assert arrays[0]["items"] == {"$ref": "#/components/schemas/ScoreGenre"}, name


def test_score_openapi_keeps_read_model_fields_required(client: TestClient) -> None:
    """Prevent optional schema defaults from weakening the customer API contract."""
    components = client.get("/api/v1/openapi.json").json()["components"]["schemas"]

    expected_required_fields = {
        "ScoreCapabilities": {
            "can_view",
            "can_download",
            "can_edit",
            "can_delete",
            "can_leave",
            "can_manage_guest_previews",
            "can_manage_members",
            "can_practice",
        },
        "ScoreDerivedAssetRead": {
            "status",
            "asset_id",
        },
        "ScoreRead": {
            "score_id",
            "display_title",
            "genres",
            "version",
            "head_revision_id",
            "derived_assets",
            "input_assets",
            "metadata",
            "created_at",
            "updated_at",
            "capabilities",
        },
    }

    for schema_name, fields in expected_required_fields.items():
        assert fields == set(components[schema_name]["required"])
        assert fields == set(components[schema_name]["properties"])


def test_score_access_contract_exposes_current_channels_and_workspace_filters(
    client: TestClient,
) -> None:
    from app.db.models.score_access import AccessOrigin
    from app.modules.score_access.policy import ScoreAction

    assert {origin.value for origin in AccessOrigin} == {"OWNER", "MEMBERSHIP"}
    assert {action.value for action in ScoreAction} == {
        "VIEW",
        "EDIT",
        "DELETE",
        "LEAVE",
        "MANAGE_GUEST_PREVIEWS",
        "MANAGE_MEMBERS",
        "DOWNLOAD",
        "PRACTICE",
    }
    paths = client.get("/api/v1/openapi.json").json()["paths"]
    assert {
        item["name"]
        for item in paths["/api/v1/library/scores"]["get"]["parameters"]
        if item["in"] == "query"
    } == {
        "page",
        "page_size",
        "search",
        "sort",
        "view",
        "folder_id",
    }
    assert {
        "/api/v1/scores/{score_id}",
        "/api/v1/guest-previews/{token}",
        "/api/v1/invites/{token}",
        "/api/v1/scores/{score_id}/members",
        "/api/v1/me/scores/{score_id}/membership",
    } <= paths.keys()
    leave = paths["/api/v1/me/scores/{score_id}/membership"]["delete"]
    assert "requestBody" not in leave
    assert [
        parameter["name"] for parameter in leave["parameters"] if parameter["in"] == "path"
    ] == ["score_id"]
    assert not any(parameter["in"] == "query" for parameter in leave["parameters"])


def test_guest_preview_contract_is_presentation_only(client: TestClient) -> None:
    schema = client.get("/api/v1/openapi.json").json()
    operations = {
        (method, path)
        for path, methods in schema["paths"].items()
        for method, operation in methods.items()
        if "Guest Previews" in operation.get("tags", [])
    }
    assert operations == {
        ("get", "/api/v1/scores/{score_id}/guest-preview"),
        ("patch", "/api/v1/scores/{score_id}/guest-preview"),
        ("get", "/api/v1/guest-previews/{token}"),
        ("get", "/api/v1/guest-previews/{token}/render-assets/{asset_id}/view"),
        ("get", "/api/v1/guest-previews/{token}/playback"),
    }
    components = schema["components"]["schemas"]
    assert set(components["GuestPreviewRead"]["properties"]) == {
        "display_title",
        "shared_by",
        "render_assets",
        "audio_available",
    }
    assert set(components["GuestPreviewUpdateRequest"]["properties"]) == {"enabled"}
    assert components["GuestPreviewUpdateRequest"]["additionalProperties"] is False
    assert set(components["GuestPreviewSettingsRead"]["properties"]) == {"enabled", "token"}


def test_collaboration_role_contract_is_least_privilege(client: TestClient) -> None:
    from app.modules.score_invites.lifecycle import InviteStatus

    components = client.get("/api/v1/openapi.json").json()["components"]["schemas"]
    assert components["MembershipRole"]["enum"] == ["VIEWER", "PRACTITIONER", "EDITOR"]
    assert components["InviteCreateRequest"]["properties"]["role"]["default"] == "VIEWER"
    assert components["InviteStatus"]["enum"] == [status.value for status in InviteStatus]
    assert set(components["InviteRead"]["properties"]) == {
        "invite_id",
        "email",
        "role",
        "status",
        "expires_at",
        "terminal_at",
        "terminal_actor",
        "created_at",
        "created_by",
    }


def test_invitation_routes_express_lifecycle_commands(client: TestClient) -> None:
    paths = client.get("/api/v1/openapi.json").json()["paths"]
    assert set(paths["/api/v1/scores/{score_id}/invites"]) == {"get", "post"}
    assert set(paths["/api/v1/scores/{score_id}/invites/{invite_id}/revoke"]) == {"post"}
    assert "delete" in paths["/api/v1/scores/{score_id}/members/{membership_id}"]


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


def test_library_http_contract_is_score_based(client: TestClient) -> None:
    spec = client.get("/api/v1/openapi.json").json()
    paths = {
        path: operations
        for path, operations in spec["paths"].items()
        if path.startswith("/api/v1/library/")
    }
    assert set(paths) == {
        "/api/v1/library/folders",
        "/api/v1/library/folders/{folder_id}",
        "/api/v1/library/scores",
        "/api/v1/library/scores/batch-move",
        "/api/v1/library/scores/batch-favorite",
    }
    assert {
        p["name"]
        for p in paths["/api/v1/library/scores"]["get"]["parameters"]
        if p["in"] == "query"
    } == {
        "view",
        "folder_id",
        "search",
        "sort",
        "page",
        "page_size",
    }
    components = spec["components"]["schemas"]
    assert components["LibraryView"]["enum"] == [
        "all",
        "favorites",
        "created_by_me",
        "shared_with_me",
    ]
    assert components["LibrarySort"]["enum"] == [
        "updated_desc",
        "updated_asc",
        "name_asc",
        "name_desc",
    ]
    assert components["LibraryScoreRead"]["properties"]["access_origin"] == {
        "$ref": "#/components/schemas/AccessOrigin"
    }
