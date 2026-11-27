"""Versioned operator browser identities and their deterministic projections."""

import importlib.util
import json
import os
from pathlib import Path
import pytest
from app.core.generated import control_plane_browser_protocol as protocol
from tests.support.control_plane import control_app as control_app
from app.runtime.control_plane.settings import ControlPlaneSettings

ROOT = Path(os.environ.get("NOTEVERSE_REPO_ROOT", Path(__file__).resolve().parents[2]))
spec = importlib.util.spec_from_file_location(
    "control_protocol_generator", ROOT / "scripts/generate_control_plane_browser_protocol.py"
)
generator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(generator)


def source():
    return generator.load_json(ROOT / generator.PROTOCOL)


def test_generated_protocol_matches_the_canonical_identity_and_composition(control_app):
    identity = source()
    for key, name in generator.EXPORTS.items():
        assert getattr(protocol, name) == identity[key]
    assert generator.generate(ROOT, check=True) == 0
    assert control_app.openapi_url == protocol.CONTROL_PLANE_API_PREFIX + "/openapi.json"
    csrf = next(
        item.kwargs["csrf_settings"]
        for item in control_app.user_middleware
        if item.cls.__name__ == "CsrfProtectionMiddleware"
    )
    assert csrf.session_cookie_names == (protocol.OPERATOR_AUTH_COOKIE_NAME,)
    assert csrf.csrf_cookie_name == protocol.OPERATOR_CSRF_COOKIE_NAME
    assert csrf.csrf_header_name == protocol.OPERATOR_CSRF_HEADER_NAME
    assert csrf.api_prefix == protocol.CONTROL_PLANE_API_PREFIX
    assert {
        name for name in ControlPlaneSettings.model_fields if name.startswith("CONTROL_PLANE_")
    } == {
        "CONTROL_PLANE_COOKIE_SECURE",
        "CONTROL_PLANE_COOKIE_SAMESITE",
        "CONTROL_PLANE_SESSION_EXPIRE_MINUTES",
        "CONTROL_PLANE_CORS_ORIGINS",
    }
    cookies = [
        parameter["name"]
        for parameter in control_app.openapi()["paths"][identity["api_prefix"] + "/auth/me"]["get"][
            "parameters"
        ]
        if parameter["in"] == "cookie"
    ]
    assert cookies == [identity["auth_cookie_name"]]


def test_generation_is_deterministic_and_checks_drift_without_mutation(tmp_path):
    identity = source()
    assert generator.projections(dict(reversed(list(identity.items())))) == generator.projections(
        identity
    )
    path = tmp_path / generator.PROTOCOL
    path.parent.mkdir(parents=True)
    path.write_text(json.dumps(identity))
    assert generator.generate(tmp_path, check=True) == 1
    assert not (tmp_path / generator.PYTHON).exists()
    assert generator.generate(tmp_path) == 0
    assert generator.generate(tmp_path, check=True) == 0
    path = tmp_path / generator.TYPESCRIPT
    path.write_text("stale")
    assert generator.generate(tmp_path, check=True) == 1
    assert path.read_text() == "stale"


@pytest.mark.parametrize(
    "key,value",
    [
        ("api_prefix", "relative"),
        ("api_prefix", "/api/v1/"),
        ("api_prefix", "/api?v=1"),
        ("csrf_header_name", "X-CSRF"),
        ("auth_cookie_name", "invalid cookie"),
        ("csrf_cookie_name", ""),
        ("csrf_header_name", "x:test"),
        ("csrf_cookie_name", 123),
        ("extra", "value"),
    ],
)
def test_protocol_validation_accepts_only_explicit_http_identities(key, value):
    with pytest.raises(ValueError):
        generator.validate_protocol({**source(), key: value})


@pytest.mark.parametrize(
    "document",
    [
        '{"api_prefix":"/api/v1","api_prefix":"/api/v2"}',
        '{"api_prefix":NaN}',
        '{"api_prefix":Infinity}',
        '{"api_prefix":-Infinity}',
        "{invalid}",
    ],
)
def test_protocol_source_requires_strict_json(document, tmp_path):
    path = tmp_path / "protocol.json"
    path.write_text(document)
    with pytest.raises(ValueError):
        generator.load_json(path)


def test_policy_templates_describe_deployment_policy_and_topology():
    allowed = {
        name for name in ControlPlaneSettings.model_fields if name.startswith("CONTROL_PLANE_")
    }
    for relative in [
        "backend/.env.docker.control-plane.example",
        "deploy/application/overlays/staging/control-plane-config.env",
        "deploy/application/overlays/production/control-plane-config.env",
        "deploy/gitops/environments/staging/control-plane-config.env",
    ]:
        keys = {
            line.split("=", 1)[0]
            for line in (ROOT / relative).read_text().splitlines()
            if line and not line.startswith("#")
        }
        assert keys == allowed
    keys = {
        line.split("=", 1)[0]
        for line in (ROOT / "apps/platform-admin/.env.docker.example").read_text().splitlines()
        if line and not line.startswith("#")
    }
    assert keys == {"NEXT_CONTROL_PLANE_ORIGIN"}


@pytest.mark.parametrize("output", [generator.PYTHON, generator.TYPESCRIPT])
def test_check_rejects_stale_projection_without_rewriting(output, tmp_path):
    path = tmp_path / generator.PROTOCOL
    path.parent.mkdir(parents=True)
    path.write_text(json.dumps(source()))
    assert generator.generate(tmp_path) == 0
    projection = tmp_path / output
    projection.write_text("stale")
    assert generator.generate(tmp_path, check=True) == 1
    assert projection.read_text() == "stale"


def test_protocol_requires_distinct_cookie_identities_and_complete_fields():
    identity = source()
    with pytest.raises(ValueError):
        generator.validate_protocol({**identity, "csrf_cookie_name": identity["auth_cookie_name"]})
    identity.pop("api_prefix")
    with pytest.raises(ValueError):
        generator.validate_protocol(identity)
