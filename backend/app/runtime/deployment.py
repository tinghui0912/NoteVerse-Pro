"""Deployment credential boundaries derived from the real process settings schemas."""

from dataclasses import dataclass
from pydantic_settings import BaseSettings
from app.runtime.customer_api.settings import CustomerApiSettings
from app.runtime.control_plane.settings import ControlPlaneSettings
from app.runtime.worker.settings import WorkerSettings
from app.runtime.beat.settings import BeatSettings
from app.runtime.observability.settings import ObservabilitySettings
from app.runtime.migrations.settings import MigrationSettings
from app.runtime.cli.settings import AssetCommandSettings
from app.runtime.paddle_ocr.settings import PaddleOcrSettings


@dataclass(frozen=True)
class DeploymentContract:
    settings: type[BaseSettings]
    database_role: str | None
    secret_name: str | None
    secret_keys: tuple[str, ...]
    config_name: str | None
    config_file: str | None
    workload: str | None
    container: str | None


DEPLOYMENTS = {
    "migrator": DeploymentContract(
        MigrationSettings,
        "nv_migrator",
        "noteverse-migrator-secret",
        ("DATABASE_URL",),
        None,
        None,
        "noteverse-db-migrate",
        "migrate",
    ),
    "customer_api": DeploymentContract(
        CustomerApiSettings,
        "nv_customer_api",
        "noteverse-customer-api-secret",
        (
            "DATABASE_URL",
            "REDIS_URL",
            "CELERY_BROKER_URL",
            "CELERY_RESULT_BACKEND",
            "S3_ACCESS_KEY_ID",
            "S3_SECRET_ACCESS_KEY",
        ),
        "noteverse-customer-api-config",
        "customer-api-config.env",
        "noteverse-backend-api",
        "api",
    ),
    "control_plane": DeploymentContract(
        ControlPlaneSettings,
        "nv_control_plane",
        "noteverse-control-plane-secret",
        ("DATABASE_URL", "REDIS_URL", "OPERATOR_TOTP_ENCRYPTION_KEY"),
        "noteverse-control-plane-config",
        "control-plane-config.env",
        "noteverse-control-plane",
        "control-plane",
    ),
    "worker": DeploymentContract(
        WorkerSettings,
        "nv_worker",
        "noteverse-worker-secret",
        (
            "DATABASE_URL",
            "SCHEDULER_LOCK_DATABASE_URL",
            "REDIS_URL",
            "CELERY_BROKER_URL",
            "CELERY_RESULT_BACKEND",
            "S3_ACCESS_KEY_ID",
            "S3_SECRET_ACCESS_KEY",
            "RESEND_API_KEY",
        ),
        "noteverse-worker-config",
        "worker-config.env",
        "noteverse-backend-worker",
        "worker",
    ),
    "beat": DeploymentContract(
        BeatSettings,
        "nv_beat",
        "noteverse-beat-secret",
        (
            "DATABASE_URL",
            "SCHEDULER_LOCK_DATABASE_URL",
            "REDIS_URL",
            "CELERY_BROKER_URL",
            "CELERY_RESULT_BACKEND",
        ),
        "noteverse-beat-config",
        "beat-config.env",
        "noteverse-backend-beat",
        "beat",
    ),
    "observability": DeploymentContract(
        ObservabilitySettings,
        "nv_observability",
        "noteverse-observability-secret",
        ("DATABASE_URL",),
        "noteverse-observability-config",
        "observability-config.env",
        "noteverse-observability-exporter",
        "observability-exporter",
    ),
    "model_assets": DeploymentContract(
        AssetCommandSettings,
        None,
        "noteverse-model-assets-secret",
        ("HF_TOKEN",),
        "noteverse-model-assets-config",
        "model-assets-config.env",
        "noteverse-model-cache-agent",
        "prepare-model-assets",
    ),
    "paddle_ocr": DeploymentContract(PaddleOcrSettings, None, None, (), None, None, None, None),
}


def deployment_snapshot() -> dict:
    result = {}
    for name, contract in DEPLOYMENTS.items():
        fields = contract.settings.model_fields
        if not set(contract.secret_keys) <= fields.keys():
            raise ValueError(f"Credential contract does not match {name} settings")
        result[name] = {
            "settings": contract.settings.__module__ + "." + contract.settings.__name__,
            "fields": sorted(fields),
            "required_fields": sorted(key for key, field in fields.items() if field.is_required()),
            "database_role": contract.database_role,
            "secret_name": contract.secret_name,
            "secret_keys": list(contract.secret_keys),
            "config_name": contract.config_name,
            "config_file": contract.config_file,
            "workload": contract.workload,
            "container": contract.container,
        }
    return result
