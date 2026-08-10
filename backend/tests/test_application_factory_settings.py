from app.core.config import settings


def test_application_factories_apply_shared_service_identity_settings(monkeypatch) -> None:
    monkeypatch.setattr(settings, "PROJECT_NAME", "NoteVerse Test")
    monkeypatch.setattr(settings, "API_V1_STR", "/api/v9")
    monkeypatch.setattr(settings, "CONTROL_PLANE_AUTH_COOKIE_NAME", "noteverse_control_session")
    monkeypatch.setattr(settings, "CONTROL_PLANE_CSRF_COOKIE_NAME", "noteverse_control_csrf")
    monkeypatch.setattr(settings, "CONTROL_PLANE_CSRF_HEADER_NAME", "X-Control-CSRF-Token")
    monkeypatch.setattr(settings, "CONTROL_PLANE_COOKIE_SECURE", True)
    monkeypatch.setattr(settings, "CONTROL_PLANE_COOKIE_SAMESITE", "strict")
    monkeypatch.setattr(settings, "CONTROL_PLANE_SESSION_EXPIRE_MINUTES", 60)
    monkeypatch.setattr(settings, "CONTROL_PLANE_CORS_ORIGINS", ["https://control.example.test"])

    from app.control_plane_main import create_app as create_control_plane_app
    from app.main import create_app as create_api_app
    from app.observability_main import create_app as create_observability_app
    from app.practice_main import create_app as create_practice_app

    api_app = create_api_app()
    practice_app = create_practice_app()
    control_plane_app = create_control_plane_app()
    observability_app = create_observability_app()

    assert api_app.title == "NoteVerse Test"
    assert api_app.openapi_url == "/api/v9/openapi.json"
    assert practice_app.title == "NoteVerse Test Practice Service"
    assert practice_app.openapi_url == "/api/v9/practice/openapi.json"
    assert control_plane_app.title == "NoteVerse Test Control Plane API"
    assert control_plane_app.openapi_url == "/api/v1/openapi.json"
    assert observability_app.title == "NoteVerse Test Observability Exporter"
    assert observability_app.openapi_url is None
