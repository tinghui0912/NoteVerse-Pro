"""Bounded CI-only OCI registry mechanics; no dependency or runtime role policy.

Promotion checks refuse observed competing winners. They are not registry-server
CAS against arbitrary external writers.
"""
from __future__ import annotations

from dataclasses import dataclass
import json
from pathlib import Path
import re
import subprocess
from typing import Protocol


def validate_digest(value: str) -> str:
    if not re.fullmatch(r"sha256:[a-f0-9]{64}", value):
        raise ValueError(f"Invalid OCI digest: {value!r}")
    return value


def candidate_tag(run_id: str, attempt: str) -> str:
    if not re.fullmatch(r"[1-9][0-9]*", run_id) or not re.fullmatch(r"[1-9][0-9]*", attempt):
        raise ValueError("Candidate requires positive run ID and run attempt")
    return f"candidate-{run_id}-{attempt}"


class Registry(Protocol):
    def resolve(self, reference: str) -> str | None: ...
    def attach(self, source: str, target: str) -> None: ...


def _registry_error_is_absence(stderr: str, reference: str) -> bool:
    """Accept only complete, explicit missing-manifest diagnostics."""
    message = stderr.strip().lower().removeprefix("error: ")
    reference = reference.lower()
    # Match whole diagnostics, not substrings inside identifiers or larger errors.
    # Auth/rate-limit, infrastructure and unrecognized responses fail closed.
    return message in {
        reference + ": not found",
        "manifest unknown",
        "manifest unknown: manifest unknown",
        reference + ": manifest unknown",
        reference + ": manifest unknown: manifest unknown",
    }


class DockerRegistry:
    def resolve(self, reference: str) -> str | None:
        result = subprocess.run(
            ["docker", "buildx", "imagetools", "inspect", reference], capture_output=True, text=True,
        )
        if result.returncode:
            if _registry_error_is_absence(result.stderr, reference):
                return None
            raise RuntimeError(f"Registry identity query failed closed: {result.stderr}")
        match = re.search(r"^Digest:\s+(sha256:[a-f0-9]{64})\s*$", result.stdout, re.M)
        if not match:
            raise ValueError("Registry did not return a valid OCI digest")
        return validate_digest(match.group(1))

    def attach(self, source: str, target: str) -> None:
        # A single-platform candidate must not be wrapped in a new image index.
        subprocess.run([
            "docker", "buildx", "imagetools", "create", "--prefer-index=false",
            "--tag", target, source,
        ], check=True)


@dataclass(frozen=True)
class Plan:
    action: str
    canonical_ref: str
    candidate_ref: str
    existing_digest: str
    digest_ref: str


def promote_qualified(registry: Registry, repository: str, tag: str, digest: str,
            qualification: dict[str, str]) -> str:
    validate_digest(digest)
    required = {"contract", "sbom", "trivy"}
    if set(qualification) != required or any(qualification[k] != "success" for k in required):
        raise ValueError("Canonical promotion denied: contract, SBOM and Trivy must all succeed")
    if not re.fullmatch(r"[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}", tag):
        raise ValueError("Invalid canonical OCI tag")
    target = repository + ":" + tag
    existing = registry.resolve(target)
    if existing is not None:
        if validate_digest(existing) != digest:
            raise RuntimeError("First-build-wins: different canonical OCI already exists; never overwrite")
        return "identical-winner-without-repush"
    registry.attach(repository + "@" + digest, target)
    if registry.resolve(target) != digest:
        raise RuntimeError("Promoted reference did not preserve candidate OCI identity")
    return "promoted-qualified-oci"


def outputs(values: dict, output: Path | None) -> None:
    if output:
        with output.open("a", encoding="utf-8", newline="\n") as stream:
            for key, value in values.items():
                if not isinstance(value, (str, int)) or "\n" in str(value):
                    continue
                stream.write(f"{key}={value}\n")
    print(json.dumps(values, sort_keys=True))
