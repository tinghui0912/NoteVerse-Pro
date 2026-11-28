#!/usr/bin/env python3
"""Validate rendered workloads against the generated settings/credential contract."""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

import yaml

REPO_ROOT = Path(__file__).resolve().parents[1]
CONTRACT_PATH = REPO_ROOT / "backend/docs/contracts/runtime-deployment.json"
TARGETS = (
    "deploy/application/overlays/staging",
    "deploy/application/overlays/production",
    "deploy/gitops/environments/staging",
)


def load_contract() -> dict:
    return json.loads(CONTRACT_PATH.read_text(encoding="utf-8"))


def validate_documents(
    documents: list[dict], *, require_workloads: bool = True, require_configuration: bool = True
) -> list[str]:
    contracts = load_contract()
    configmaps = {
        d["metadata"]["name"]: d.get("data", {}) for d in documents if d.get("kind") == "ConfigMap"
    }
    secrets = {
        d["metadata"]["name"]: set(d.get("data", {})) | set(d.get("stringData", {}))
        for d in documents
        if d.get("kind") == "Secret"
    }
    problems = []
    names = [c["secret_name"] for c in contracts.values() if c["secret_name"]]
    if len(set(names)) != len(names):
        problems.append("Runtime credential identities must be distinct")
    found = set()
    for document in documents:
        kind = document.get("kind")
        if kind not in {"Deployment", "StatefulSet", "Job", "CronJob", "DaemonSet"}:
            continue
        workload = document["metadata"]["name"]
        entry = next(
            ((name, c) for name, c in contracts.items() if c["workload"] == workload), None
        )
        pod = (
            document["spec"]["jobTemplate"]["spec"]["template"]["spec"]
            if kind == "CronJob"
            else document["spec"]["template"]["spec"]
        )
        credential_volumes = {
            volume["name"]
            for volume in pod.get("volumes", [])
            if "secret" in volume
            or any("secret" in source for source in volume.get("projected", {}).get("sources", []))
        }
        for container in pod.get("containers", []) + pod.get("initContainers", []):
            if any(
                mount["name"] in credential_volumes for mount in container.get("volumeMounts", [])
            ):
                problems.append(
                    f"{workload}/{container['name']}: credential volume bundles are not permitted"
                )
            references = [
                (e.get("valueFrom", {}).get("secretKeyRef"), e.get("name"))
                for e in container.get("env", [])
            ]
            references = [(ref, key) for ref, key in references if ref]
            imports = container.get("envFrom", [])
            if entry is None or container["name"] != entry[1]["container"]:
                if references or any("secretRef" in imported for imported in imports):
                    problems.append(
                        f"{workload}/{container['name']}: unexpected runtime credential mount"
                    )
                continue
            role, contract = entry
            found.add(role)
            fields, secret_keys = set(contract["fields"]), set(contract["secret_keys"])
            available = set()
            for imported in imports:
                if "secretRef" in imported:
                    problems.append(f"{role}: secret envFrom is not permitted")
                    continue
                config_name = imported.get("configMapRef", {}).get("name")
                if config_name != contract["config_name"]:
                    problems.append(f"{role}: configuration belongs to another runtime")
                    continue
                values = configmaps.get(config_name)
                if values is None:
                    if require_configuration:
                        problems.append(f"{role}: ConfigMap is missing")
                    continue
                available.update(values)
                invalid = (set(values) - fields) | (set(values) & secret_keys)
                if invalid:
                    problems.append(f"{role}: invalid public config keys {sorted(invalid)}")
            actual_keys = set()
            for ref, key in references:
                if (
                    ref["name"] != contract["secret_name"]
                    or key not in secret_keys
                    or ref["key"] != key
                ):
                    problems.append(f"{role}: invalid credential reference for {key}")
                actual_keys.add(key)
            if actual_keys != secret_keys:
                problems.append(f"{role}: credential keys do not match settings contract")
            for value in container.get("env", []):
                available.add(value["name"])
                if value["name"] not in fields:
                    problems.append(f"{role}: unknown environment key {value['name']}")
                if value["name"] in secret_keys and "value" in value:
                    problems.append(f"{role}: credential literal is not permitted")
            missing = set(contract["required_fields"]) - available
            if missing and require_configuration:
                problems.append(f"{role}: missing required settings {sorted(missing)}")
            declared = secrets.get(contract["secret_name"])
            if declared is not None and declared != secret_keys:
                problems.append(f"{role}: declared Secret contains missing or extra keys")
    if require_workloads:
        required = {name for name, c in contracts.items() if c["workload"]}
        if found != required:
            problems.append(f"Missing workload settings contracts: {sorted(required - found)}")
    return problems


def validate_rendered(
    rendered: str, *, require_workloads: bool = True, require_configuration: bool = True
) -> list[str]:
    return validate_documents(
        [d for d in yaml.safe_load_all(rendered) if d],
        require_workloads=require_workloads,
        require_configuration=require_configuration,
    )


def main() -> int:
    problems = []
    for target in TARGETS:
        if (REPO_ROOT / target / "publication-block.json").is_file():
            from check_gitops_manifests import validate_publication_block

            problems.extend(str(finding) for finding in validate_publication_block(Path(target)))
            print(f"{target}: BLOCKED - no published runtime configuration")
            continue
        rendered = subprocess.run(
            ["kubectl", "kustomize", str(REPO_ROOT / target)],
            capture_output=True,
            text=True,
            check=True,
        ).stdout
        problems.extend(f"{target}: {message}" for message in validate_rendered(rendered))
    if problems:
        print("\n".join(problems))
        return 1
    print("Runtime Settings, ConfigMaps and Secret references match their isolated contracts.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
