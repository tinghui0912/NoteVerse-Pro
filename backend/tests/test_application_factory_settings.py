from app.runtime.control_plane.context import get_context as get_control_context
from app.runtime.customer_api.context import get_context

settings = get_context().settings


def test_application_factories_apply_shared_service_identity_settings(monkeypatch) -> None:
    monkeypatch.setattr(settings, "PROJECT_NAME", "NoteVerse Test")
    from app.runtime.control_plane.context import get_context as control_context
    from app.runtime.observability.context import get_context as exporter_context

    monkeypatch.setattr(control_context().settings, "PROJECT_NAME", "NoteVerse Test")
    monkeypatch.setattr(exporter_context().settings, "PROJECT_NAME", "NoteVerse Test")
    monkeypatch.setenv("CONTROL_PLANE_COOKIE_SECURE", "true")
    monkeypatch.setenv("CONTROL_PLANE_CORS_ORIGINS", '["https://control.example.test"]')

    from app.runtime.control_plane.main import create_app as create_control_plane_app
    from app.runtime.customer_api.main import create_app as create_api_app
    from app.runtime.observability.main import create_app as create_observability_app

    try:
        api_app = create_api_app()
        control_plane_app = create_control_plane_app()
        observability_app = create_observability_app()

        assert api_app.title == "NoteVerse Test"
        assert api_app.openapi_url == "/api/v1/openapi.json"
        assert control_plane_app.title == "NoteVerse Test Control Plane API"
        assert control_plane_app.openapi_url == "/api/v1/openapi.json"
        assert observability_app.title == "NoteVerse Test Observability Exporter"
        assert observability_app.openapi_url is None
    finally:
        get_control_context.cache_clear()
