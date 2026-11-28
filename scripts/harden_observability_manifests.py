#!/usr/bin/env python3
"""Helm post-renderer applying the numeric identity and read-only observability contract."""

from __future__ import annotations

from copy import deepcopy
import sys
import yaml

from container_security_contract import (
    CONTAINER_SECURITY,
    POD_SECURITY,
    pod_specs,
    validate_workloads,
)

API_CLIENTS = frozenset(
    {
        "fluent-bit",
        "kube-prometheus-stack-operator",
        "kube-prometheus-stack-kube-state-metrics",
    }
)
HOST_OBSERVERS = frozenset({"kube-prometheus-stack-prometheus-node-exporter"})


def harden(documents: list[dict]) -> list[dict]:
    api_client_names = set(API_CLIENTS)
    for document in documents:
        if document.get("metadata", {}).get("name") == "kube-prometheus-stack-grafana":
            for pod in pod_specs(document):
                if any(c["name"] == "grafana-sc-dashboard" for c in pod.get("containers", [])):
                    api_client_names.add("kube-prometheus-stack-grafana")
    api_clients = frozenset(api_client_names)
    for document in documents:
        name = document.get("metadata", {}).get("name", "")
        if document.get("kind") == "Role" and name == "kube-prometheus-stack-grafana":
            document["rules"] = (
                [
                    {
                        "apiGroups": [""],
                        "resources": ["configmaps"],
                        "verbs": ["get", "watch", "list"],
                    }
                ]
                if name in api_clients
                else []
            )
        if (
            document.get("kind") == "ClusterRole"
            and name == "kube-prometheus-stack-grafana-clusterrole"
            and document.get("rules")
        ):
            raise ValueError("Grafana dashboard discovery requires namespaced ConfigMap-only RBAC")
        if document.get("kind") == "ServiceAccount":
            document["automountServiceAccountToken"] = (
                name in api_clients or name == "kube-prometheus-stack-prometheus"
            )
        for pod in pod_specs(document):
            pod["automountServiceAccountToken"] = name in api_clients
            pod.setdefault("securityContext", {}).update(deepcopy(POD_SECURITY))
            volumes = pod.get("volumes") or []
            pod["volumes"] = volumes
            if any(v["name"] == "security-scratch" for v in volumes):
                raise ValueError("Reserved scratch volume name")
            volumes.append({"name": "security-scratch", "emptyDir": {"sizeLimit": "128Mi"}})
            for volume in volumes:
                if "emptyDir" in volume:
                    volume["emptyDir"].setdefault("sizeLimit", "128Mi")
            host_paths = {v["name"] for v in volumes if "hostPath" in v}
            for container in (pod.get("containers") or []) + (pod.get("initContainers") or []):
                container["securityContext"] = deepcopy(CONTAINER_SECURITY)
                mounts = container.get("volumeMounts") or []
                container["volumeMounts"] = mounts
                if not any(m["mountPath"] == "/tmp" for m in mounts):
                    mounts.append({"name": "security-scratch", "mountPath": "/tmp"})
                for mount in mounts:
                    if mount["name"] in host_paths:
                        mount["readOnly"] = True
        if document.get("kind") in {"Prometheus", "Alertmanager"}:
            spec = document["spec"]
            spec["securityContext"] = deepcopy(POD_SECURITY)
            spec["automountServiceAccountToken"] = document["kind"] == "Prometheus"
            spec.setdefault("volumes", []).append(
                {"name": "security-scratch", "emptyDir": {"sizeLimit": "128Mi"}}
            )
            names = (
                ("prometheus", "config-reloader")
                if document["kind"] == "Prometheus"
                else ("alertmanager", "config-reloader")
            )
            for group, entries in (
                ("containers", names),
                ("initContainers", ("init-config-reloader",)),
            ):
                containers = spec.setdefault(group, [])
                for container_name in entries:
                    current = next((c for c in containers if c["name"] == container_name), None)
                    if current is None:
                        current = {"name": container_name}
                        containers.append(current)
                    current["securityContext"] = deepcopy(CONTAINER_SECURITY)
                    current.setdefault("volumeMounts", []).append(
                        {"name": "security-scratch", "mountPath": "/tmp"}
                    )
    errors = validate_workloads(
        documents, api_token_workloads=api_clients, host_namespace_workloads=HOST_OBSERVERS
    )
    if errors:
        raise ValueError("; ".join(errors))
    return documents


def main() -> int:
    documents = [d for d in yaml.safe_load_all(sys.stdin) if d]
    sys.stdout.write(yaml.safe_dump_all(harden(documents), sort_keys=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
