"""Validate Kubernetes env-file ownership boundaries.

This guard prevents runtime-specific configuration from drifting back into the
shared backend ConfigMap. It intentionally checks only clear ownership
boundaries; ambiguous product policy remains a review decision instead of a
script-enforced taxonomy.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]

BACKEND_CONFIG_FILES = (
    Path("deploy/application/overlays/staging/backend-config.env"),
    Path("deploy/application/overlays/production/backend-config.env"),
    Path("deploy/gitops/environments/staging/backend-config.env"),
)
WORKER_CONFIG_FILES = (
    Path("deploy/application/overlays/staging/backend-worker-config.env"),
    Path("deploy/application/overlays/production/backend-worker-config.env"),
    Path("deploy/gitops/environments/staging/backend-worker-config.env"),
)
PRACTICE_CONFIG_FILES = (
    Path("deploy/application/overlays/staging/backend-practice-config.env"),
    Path("deploy/application/overlays/production/backend-practice-config.env"),
    Path("deploy/gitops/environments/staging/backend-practice-config.env"),
)

WORKER_OWNED_KEYS = frozenset(
    {
        "CELERY_WORKER_CONCURRENCY",
        "PADDLEOCR_TIMEOUT_SECONDS",
        "MODEL_ROOT",
        "PLAYBACK_SOUNDFONT_PATH",
        "HF_HOME",
        "HF_HUB_OFFLINE",
        "TRANSFORMERS_OFFLINE",
        "PADDLEOCR_MODEL_ROOT",
        "PADDLEOCR_DETECTION_MODEL_DIR",
        "PADDLEOCR_RECOGNITION_MODEL_DIR",
        "PADDLEOCR_TEXTLINE_ORIENTATION_MODEL_DIR",
        "LEGATO_REPO_PATH",
        "LEGATO_PYTHON",
        "LEGATO_DEVICE",
        "LEGATO_FP16",
        "LEGATO_BEAM_SIZE",
        "LEGATO_BATCH_SIZE",
        "LEGATO_TIMEOUT_SECONDS",
    }
)
PRACTICE_OWNED_KEYS = frozenset(
    {
        "PRACTICE_AUDIO_DIAGNOSTICS",
        "PRACTICE_AUDIO_DIAGNOSTIC_FRAME_INTERVAL",
        "PRACTICE_ALIGNMENT_DIAGNOSTIC_UPDATE_INTERVAL",
    }
)

SHARED_MODEL_ASSET_KEYS = frozenset({"PRACTICE_SOUNDFONT_PATH"})

KUSTOMIZATION_CONFIG_REFERENCES = {
    Path("deploy/application/overlays/staging/kustomization.yaml"): (
        "backend-worker-config.env",
        "backend-practice-config.env",
    ),
    Path("deploy/application/overlays/production/kustomization.yaml"): (
        "backend-worker-config.env",
        "backend-practice-config.env",
    ),
    Path("deploy/gitops/environments/staging/kustomization.yaml"): (
        "backend-worker-config.env",
        "backend-practice-config.env",
    ),
}


@dataclass(frozen=True, slots=True)
class Finding:
    path: str
    line: int
    rule: str
    text: str


def repo_path(path: Path) -> Path:
    return path if path.is_absolute() else REPO_ROOT / path


def parse_env_file(path: Path) -> dict[str, int]:
    env_path = repo_path(path)
    keys: dict[str, int] = {}
    for line_number, raw_line in enumerate(env_path.read_text(encoding="utf-8").splitlines(), start=1):
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if "=" not in line:
            continue
        key = line.split("=", 1)[0].strip()
        keys[key] = line_number
    return keys


def validate_required_files(paths: tuple[Path, ...]) -> list[Finding]:
    findings: list[Finding] = []
    for path in paths:
        if not repo_path(path).is_file():
            findings.append(Finding(path.as_posix(), 1, "required-file", "missing env file"))
    return findings


def validate_shared_backend_config() -> list[Finding]:
    findings: list[Finding] = []
    forbidden_keys = WORKER_OWNED_KEYS | PRACTICE_OWNED_KEYS | SHARED_MODEL_ASSET_KEYS
    for path in BACKEND_CONFIG_FILES:
        if not repo_path(path).is_file():
            continue
        keys = parse_env_file(path)
        for key in sorted(forbidden_keys & keys.keys()):
            findings.append(
                Finding(
                    path.as_posix(),
                    keys[key],
                    "runtime-specific-key-in-shared-config",
                    f"{key} belongs in a role-specific env file",
                )
            )
    return findings


def validate_role_config_files(paths: tuple[Path, ...], required_keys: frozenset[str], role: str) -> list[Finding]:
    findings: list[Finding] = []
    for path in paths:
        if not repo_path(path).is_file():
            continue
        keys = parse_env_file(path)
        missing = sorted(required_keys - keys.keys())
        for key in missing:
            findings.append(Finding(path.as_posix(), 1, f"{role}-required-key", f"missing {key}"))
    return findings


def validate_kustomization_references() -> list[Finding]:
    findings: list[Finding] = []
    for path, required_references in KUSTOMIZATION_CONFIG_REFERENCES.items():
        kustomization_path = repo_path(path)
        if not kustomization_path.is_file():
            findings.append(Finding(path.as_posix(), 1, "required-file", "missing kustomization"))
            continue
        text = kustomization_path.read_text(encoding="utf-8")
        for reference in required_references:
            if reference not in text:
                findings.append(
                    Finding(
                        path.as_posix(),
                        1,
                        "role-configmap-reference",
                        f"missing configMapGenerator env reference: {reference}",
                    )
                )
    return findings


def print_findings(findings: list[Finding]) -> None:
    for finding in findings:
        print(f"{finding.path}:{finding.line}: {finding.rule}: {finding.text}")


def main() -> int:
    findings: list[Finding] = []
    findings.extend(validate_required_files(BACKEND_CONFIG_FILES + WORKER_CONFIG_FILES + PRACTICE_CONFIG_FILES))
    findings.extend(validate_shared_backend_config())
    findings.extend(validate_role_config_files(WORKER_CONFIG_FILES, WORKER_OWNED_KEYS | SHARED_MODEL_ASSET_KEYS, "worker"))
    findings.extend(validate_role_config_files(PRACTICE_CONFIG_FILES, PRACTICE_OWNED_KEYS | SHARED_MODEL_ASSET_KEYS, "practice"))
    findings.extend(validate_kustomization_references())

    if findings:
        print_findings(findings)
        return 1
    print("Kubernetes env-file ownership check passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
