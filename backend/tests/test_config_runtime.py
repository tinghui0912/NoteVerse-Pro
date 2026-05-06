from __future__ import annotations

from app.core.config import ENV_FILE, Settings


def test_settings_load_from_backend_env_file() -> None:
    assert ENV_FILE.exists()

    loaded_settings = Settings(_env_file=str(ENV_FILE))

    assert loaded_settings.SECRET_KEY
    assert loaded_settings.DATABASE_URL
    assert loaded_settings.SYNC_DATABASE_URL
    assert loaded_settings.model_config.get("env_file") == str(ENV_FILE)


def test_debug_environment_parsing() -> None:
    parse_debug = Settings.parse_debug_flag

    assert parse_debug("debug") is True
    assert parse_debug("development") is True
    assert parse_debug("true") is True
    assert parse_debug("release") is False
    assert parse_debug("production") is False
    assert parse_debug("false") is False


def test_app_main_import_exposes_routes() -> None:
    from app.main import app

    route_paths = {route.path for route in app.routes}

    assert "/" in route_paths
    assert "/docs" in route_paths
    assert "/api/v1/openapi.json" in route_paths
    assert len(route_paths) > 0
