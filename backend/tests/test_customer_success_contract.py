"""Customer success is an operation's typed representation or bodyless acknowledgement."""

from datetime import UTC


from datetime import datetime
from types import SimpleNamespace
from unittest.mock import Mock

from fastapi.routing import iter_route_contexts
from fastapi.testclient import TestClient

from app.api.deps import get_current_user, get_db
from app.main import create_app
from app.modules.account.dependencies import get_profile_service
from app.modules.account.schemas import ProfileRead, ProfileUserRead
from app.modules.uploads.dependencies import get_upload_service
from app.modules.import_jobs.dependencies import get_import_job_service
from app.modules.import_jobs.schemas import ImportJobSubmitRead
from app.modules.library.dependencies import get_library_service
from app.modules.library.schemas import LibraryFolderRead
from app.modules.collaboration.dependencies import get_invitation_service
from app.modules.collaboration.schemas import InviteListRead
from app.shared.api_model import ApiModel


BODYLESS_COMMANDS = {
    "authLogin",
    "authLogout",
    "authRefresh",
    "authRegister",
    "authPasswordResetRequest",
    "authPasswordReset",
    "accountProfileUpdate",
    "accountPasswordChange",
    "accountAvatarDelete",
    "accountEmailChangeRequest",
    "accountSessionRevoke",
    "accountOtherSessionsRevoke",
    "uploadDelete",
    "importJobDelete",
    "libraryFolderDelete",
    "scoreMembershipLeave",
    "scoreMemberRemove",
    "scoreGuestPreviewCredentialRevoke",
    "performanceTakeUploadCancel",
    "performanceTakeDelete",
}


def test_upload_operations_describe_resource_facts_and_import_admission():
    spec = create_app().openapi()
    creation = spec["paths"]["/api/v1/uploads"]["post"]
    assert creation["operationId"] == "uploadsCreate"
    assert creation["responses"]["200"]["content"]["application/json"]["schema"] == {
        "$ref": "#/components/schemas/UploadRead"
    }
    deletion = spec["paths"]["/api/v1/uploads/{upload_id}"]["delete"]
    assert deletion["operationId"] == "uploadDelete"
    assert deletion["parameters"][0]["name"] == "upload_id"
    schemas = spec["components"]["schemas"]
    assert set(schemas["UploadRead"]["properties"]) == {
        "upload_id",
        "original_filename",
        "byte_size",
    }
    upload_ids = schemas["ImportJobSubmitRequest"]["properties"]["upload_ids"]
    assert upload_ids["type"] == "array" and upload_ids["items"]["type"] == "string"
    assert "upload_ids" in schemas["ImportJobSubmitRequest"]["required"]


def test_customer_operations_publish_typed_success_and_bodyless_command_contracts():
    app = create_app()
    spec = app.openapi()
    operations = {
        value["operationId"]: value
        for methods in spec["paths"].values()
        for method, value in methods.items()
        if method in {"get", "post", "put", "patch", "delete"}
    }
    assert {
        identity for identity, operation in operations.items() if "204" in operation["responses"]
    } == BODYLESS_COMMANDS
    for identity in BODYLESS_COMMANDS:
        assert "content" not in operations[identity]["responses"]["204"]
    for identity in ["importJobsSubmit", "importJobRetry"]:
        assert operations[identity]["responses"]["202"]["content"]["application/json"][
            "schema"
        ] == {"$ref": "#/components/schemas/ImportJobSubmitRead"}
    for path, methods in spec["paths"].items():
        if not path.startswith("/api/v1/"):
            continue
        for operation in methods.values():
            for code, response in operation["responses"].items():
                if code.startswith("2") and "application/json" in response.get("content", {}):
                    schema = response["content"]["application/json"]["schema"]
                    assert "$ref" in schema or (
                        schema.get("type") == "array" and "$ref" in schema["items"]
                    )
    # The Customer schema graph consists of resource/read models rather than
    # generic success envelopes. Domain fields such as notification data remain.
    assert not any(
        name.startswith(
            ("APIResponse", "PaginatedResponse", "EmptyResponse", "SuccessResponsePayload")
        )
        for name in spec["components"]["schemas"]
    )
    for route in iter_route_contexts(app.routes):
        if not (route.path or "").startswith("/api/v1/"):
            continue
        model = getattr(route, "response_model", None)
        if isinstance(model, type) and issubclass(model, ApiModel):
            assert not {"success", "data", "message", "code"} <= model.model_fields.keys()


def test_real_customer_routes_return_direct_nested_representations_pages_and_empty_commands():
    app = create_app()
    now = datetime(2026, 11, 13, 12, 34, 56, tzinfo=UTC)
    profile = ProfileRead(
        user=ProfileUserRead(
            id=1, email="owner@example.com", display_name="Owner", is_active=True, created_at=now
        )
    )
    folder = LibraryFolderRead(
        folder_id="folder", name="Etudes", position=0, score_count=0, created_at=now, updated_at=now
    )
    admission = ImportJobSubmitRead(job_id="job", count=1, state="QUEUED")
    library = SimpleNamespace(
        create_folder=Mock(return_value=folder),
        update_folder=Mock(return_value=folder),
        list_scores=Mock(return_value=([], 21)),
    )
    imports = SimpleNamespace(
        submit=Mock(return_value=admission),
        retry=Mock(return_value=admission),
        list_jobs=Mock(return_value=([], 21)),
    )
    uploads = SimpleNamespace(delete_upload=Mock())

    def database():
        yield object()

    app.dependency_overrides[get_db] = database
    app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(id=1)
    app.dependency_overrides[get_profile_service] = lambda: SimpleNamespace(
        profile_payload=lambda _: profile, update_profile=Mock()
    )
    app.dependency_overrides[get_library_service] = lambda: library
    app.dependency_overrides[get_import_job_service] = lambda: imports
    app.dependency_overrides[get_upload_service] = lambda: uploads
    app.dependency_overrides[get_invitation_service] = lambda: SimpleNamespace(
        list_invites=Mock(return_value=InviteListRead(items=[], next_cursor="opaque"))
    )
    with TestClient(app) as client:
        response = client.get("/api/v1/me/profile")
        assert response.status_code == 200
        assert response.json() == {
            "user": {
                "id": 1,
                "email": "owner@example.com",
                "display_name": "Owner",
                "is_active": True,
                "created_at": response.json()["user"]["created_at"],
                "avatar_url": None,
            }
        }
        assert datetime.fromisoformat(response.json()["user"]["created_at"]) == now
        assert (
            datetime.fromisoformat(response.json()["user"]["created_at"])
            .utcoffset()
            .total_seconds()
            == 0
        )
        changed_profile = client.put("/api/v1/me/profile", json={"display_name": "Etudes"})
        assert changed_profile.status_code == 204 and changed_profile.content == b""
        created = client.post("/api/v1/library/folders", json={"name": "Etudes"})
        assert created.status_code == 200 and created.json() == folder.model_dump(mode="json")
        updated = client.patch("/api/v1/library/folders/folder", json={"name": "Etudes"})
        assert (
            updated.status_code == 200
            and datetime.fromisoformat(updated.json()["updated_at"]) == now
        )
        for response in [
            client.post("/api/v1/import-jobs", json={"upload_ids": ["upload"]}),
            client.post("/api/v1/import-jobs/job/retry"),
        ]:
            assert response.status_code == 202 and response.json() == admission.model_dump(
                mode="json"
            )
        for path in ["/api/v1/import-jobs", "/api/v1/library/scores"]:
            response = client.get(path, params={"page": 2, "page_size": 10})
            assert response.status_code == 200
            assert response.json() == {
                "items": [],
                "page": 2,
                "page_size": 10,
                "total": 21,
                "total_pages": 3,
            }
        page = client.get("/api/v1/scores/score/invites")
        assert page.status_code == 200 and page.json() == {"items": [], "next_cursor": "opaque"}
        deleted = client.delete("/api/v1/uploads/upload-1")
        assert deleted.status_code == 204 and deleted.content == b""
        assert "content-type" not in deleted.headers
        uploads.delete_upload.assert_called_once()


def test_bodyless_account_security_commands_preserve_rotated_and_cleared_cookies():
    from http.cookies import SimpleCookie

    from app.core.generated import customer_browser_protocol as protocol
    from app.modules.auth.dependencies import get_password_service, get_session_service

    app = create_app()

    def database():
        yield object()

    app.dependency_overrides[get_db] = database
    app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(id=1)
    password = SimpleNamespace(
        change_current_user_password=Mock(return_value=("rotated-access", "rotated-refresh"))
    )
    sessions = SimpleNamespace(revoke_user_session=Mock(return_value=True))
    app.dependency_overrides[get_password_service] = lambda: password
    app.dependency_overrides[get_session_service] = lambda: sessions
    expected = {protocol.AUTH_COOKIE_NAME, protocol.REFRESH_COOKIE_NAME, protocol.CSRF_COOKIE_NAME}

    def cookies(response):
        result = SimpleCookie()
        for header in response.headers.get_list("set-cookie"):
            result.load(header)
        return result

    with TestClient(app, base_url="https://testserver") as client:
        changed = client.put(
            "/api/v1/me/password",
            json={"current_password": "OldPassword123!", "new_password": "NewPassword123!"},
        )
        assert changed.status_code == 204 and changed.content == b""
        assert set(cookies(changed)) == expected
        assert client.cookies[protocol.AUTH_COOKIE_NAME] == "rotated-access"
        assert client.cookies[protocol.REFRESH_COOKIE_NAME] == "rotated-refresh"
        revoked = client.delete(
            "/api/v1/me/sessions/1",
            headers={protocol.CSRF_HEADER_NAME: client.cookies[protocol.CSRF_COOKIE_NAME]},
        )
        assert revoked.status_code == 204 and revoked.content == b""
        assert set(cookies(revoked)) == expected
        assert all(cookies(revoked)[name]["max-age"] == "0" for name in expected)
        assert all(client.cookies.get(name) is None for name in expected)
