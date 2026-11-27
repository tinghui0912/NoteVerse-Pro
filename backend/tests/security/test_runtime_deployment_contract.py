"""Settings schemas, workload mounts and release inputs share one contract."""

import sys
from pathlib import Path

import pytest
import yaml

from app.runtime.deployment import DEPLOYMENTS, deployment_snapshot

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "scripts"))
import check_k8s_config_ownership as ownership  # noqa: E402
import validate_runtime_secrets as secrets  # noqa: E402


def documents():
    base = ROOT / "deploy/application/base"
    result = []
    for path in base.glob("*.yaml"):
        if path.name != "kustomization.yaml":
            result.extend(d for d in yaml.safe_load_all(path.read_text()) if d)
    for contract in DEPLOYMENTS.values():
        if contract.config_file:
            path = ROOT / "deploy/application/overlays/staging" / contract.config_file
            values = dict(
                line.split("=", 1)
                for line in path.read_text().splitlines()
                if line and not line.startswith("#") and "=" in line
            )
            result.append(
                {"kind": "ConfigMap", "metadata": {"name": contract.config_name}, "data": values}
            )
    return result


def customer_container(docs):
    deployment = next(
        d for d in docs if d.get("metadata", {}).get("name") == "noteverse-backend-api"
    )
    return deployment["spec"]["template"]["spec"]["containers"][0]


def test_snapshot_matches_actual_settings_schemas():
    assert ownership.load_contract() == deployment_snapshot()
    assert {c.database_role for c in DEPLOYMENTS.values() if c.database_role} == {
        "nv_migrator",
        "nv_customer_api",
        "nv_control_plane",
        "nv_worker",
        "nv_beat",
        "nv_observability",
    }
    names = [c.secret_name for c in DEPLOYMENTS.values() if c.secret_name]
    assert len(names) == len(set(names))
    assert DEPLOYMENTS["paddle_ocr"].secret_keys == ()
    assert DEPLOYMENTS["model_assets"].secret_keys == ("HF_TOKEN",)


def test_workloads_and_public_configuration_match_settings():
    assert ownership.validate_documents(documents()) == []


@pytest.mark.parametrize(
    "mutation",
    [
        "foreign_secret",
        "unknown_key",
        "secret_env_from",
        "secret_literal",
        "extra_declared_key",
        "foreign_config",
        "secret_volume",
    ],
)
def test_cross_runtime_and_unknown_credentials_are_rejected(mutation):
    docs = documents()
    container = customer_container(docs)
    if mutation == "foreign_secret":
        container["env"][0]["valueFrom"]["secretKeyRef"]["name"] = DEPLOYMENTS["worker"].secret_name
    elif mutation == "unknown_key":
        container["env"].append({"name": "OPERATOR_PASSWORD", "value": "test"})
    elif mutation == "secret_env_from":
        container["envFrom"].append(
            {"secretRef": {"name": DEPLOYMENTS["customer_api"].secret_name}}
        )
    elif mutation == "secret_literal":
        container["env"].append({"name": "SECRET_KEY", "value": "test"})
    elif mutation == "extra_declared_key":
        docs.append(
            {
                "kind": "Secret",
                "metadata": {"name": DEPLOYMENTS["customer_api"].secret_name},
                "stringData": {
                    **dict.fromkeys(DEPLOYMENTS["customer_api"].secret_keys, "test"),
                    "OPERATOR_PASSWORD": "test",
                },
            }
        )
    elif mutation == "secret_volume":
        pod = next(d for d in docs if d.get("metadata", {}).get("name") == "noteverse-backend-api")[
            "spec"
        ]["template"]["spec"]
        pod.setdefault("volumes", []).append(
            {"name": "credentials", "secret": {"secretName": "arbitrary-secret"}}
        )
        container.setdefault("volumeMounts", []).append(
            {"name": "credentials", "mountPath": "/credentials"}
        )
    else:
        container["envFrom"][0]["configMapRef"]["name"] = DEPLOYMENTS["worker"].config_name
    assert ownership.validate_documents(docs)


@pytest.mark.parametrize("runtime", [name for name, c in DEPLOYMENTS.items() if c.database_role])
def test_secret_templates_have_exact_keys_and_explicit_role(runtime):
    contract = DEPLOYMENTS[runtime]
    path = ROOT / "backend/db/secret-templates" / (runtime + ".env.example")
    values = dict(
        line.split("=", 1)
        for line in path.read_text().splitlines()
        if line and not line.startswith("#") and "=" in line
    )
    assert set(values) == set(contract.secret_keys)
    secrets.validate_values(runtime, values)
    values["DATABASE_URL"] = "postgresql+psycopg://test:placeholder@db/noteverse"
    with pytest.raises(ValueError):
        secrets.validate_values(runtime, values)


def test_secret_validation_errors_do_not_include_values():
    with pytest.raises(ValueError) as error:
        secrets.validate_values(
            "migrator", {"DATABASE_URL": "postgresql+psycopg://admin:private-value@db/noteverse"}
        )
    assert "private-value" not in str(error.value)


def test_quality_compose_is_self_contained_and_uses_no_runtime_secret_files():
    compose = yaml.safe_load((ROOT / "docker-compose.backend-quality.yml").read_text())
    assert set(compose["services"]) == {"quality", "quality-postgres"}
    for service in compose["services"].values():
        assert "env_file" not in service
    assert compose["services"]["quality"]["environment"]["S3_ACCESS_KEY_ID"] == "quality"
