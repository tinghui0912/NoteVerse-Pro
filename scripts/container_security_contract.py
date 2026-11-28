"""Executable container identity and Kubernetes isolation contract."""

from __future__ import annotations

import argparse
from ipaddress import ip_network, ip_address
import json
from pathlib import Path
import re

import yaml

ROOT = Path(__file__).resolve().parents[1]
COMPONENT = "app.kubernetes.io/component"
RUNTIMES = (
    "backend-api",
    "control-plane",
    "backend-worker",
    "backend-beat",
    "customer-web",
    "platform-admin",
    "migration",
    "model-cache-agent",
)
POD_SECURITY = {
    "runAsNonRoot": True,
    "runAsUser": 10001,
    "runAsGroup": 10001,
    "fsGroup": 10001,
    "seccompProfile": {"type": "RuntimeDefault"},
}
CONTAINER_SECURITY = {
    "runAsNonRoot": True,
    "runAsUser": 10001,
    "runAsGroup": 10001,
    "allowPrivilegeEscalation": False,
    "readOnlyRootFilesystem": True,
    "privileged": False,
    "capabilities": {"drop": ["ALL"]},
    "seccompProfile": {"type": "RuntimeDefault"},
}
EXTERNAL_SERVICES = {
    "postgresql_cidrs": (
        5432,
        (
            "backend-api",
            "control-plane",
            "backend-worker",
            "backend-beat",
            "migration",
        ),
    ),
    "redis_cidrs": (
        6379,
        ("backend-api", "control-plane", "backend-worker", "backend-beat"),
    ),
    "s3_fqdns": (443, ("backend-api", "backend-worker")),
    "mail_fqdns": (443, ("backend-worker",)),
    "model_fqdns": (443, ("model-cache-agent",)),
}
IMDS_CIDRS = ["169.254.169.254/32", "100.100.100.200/32"]


def peer(namespace: str, labels: dict) -> dict:
    return {
        "matchLabels": {
            "k8s:io.kubernetes.pod.namespace": namespace,
            **{"k8s:" + key: value for key, value in labels.items()},
        }
    }


def network_policy(name: str, selector: dict, ingress: list, egress: list) -> dict:
    return {
        "apiVersion": "cilium.io/v2",
        "kind": "CiliumNetworkPolicy",
        "metadata": {"name": name},
        "spec": {
            "endpointSelector": selector,
            "enableDefaultDeny": {"ingress": True, "egress": True},
            "ingress": ingress,
            "egress": egress,
        },
    }


def rule(direction: str, target: dict, port: int, protocol: str = "TCP") -> dict:
    return {
        direction: [target],
        "toPorts": [{"ports": [{"protocol": protocol, "port": str(port)}]}],
    }


def dns_rule(names: list[str] | None = None) -> dict:
    queries = (
        [{"matchName": name} for name in names]
        if names
        else [
            {"matchName": "cluster.local"},
            {"matchName": "svc.cluster.local"},
            {"matchPattern": "**.svc.cluster.local"},
            {"matchPattern": "**.cluster.local"},
        ]
    )
    return {
        "toEndpoints": [peer("kube-system", {"k8s-app": "kube-dns"})],
        "toPorts": [
            {
                "ports": [{"port": "53", "protocol": p} for p in ("TCP", "UDP")],
                "rules": {"dns": queries},
            }
        ],
    }


def application_network_policies() -> list[dict]:
    baseline = network_policy("noteverse-default-deny", {}, [], [])
    baseline["spec"]["egressDeny"] = [{"toCIDR": IMDS_CIDRS}]
    policies = [baseline]
    gateway = peer(
        "envoy-gateway-system",
        {COMPONENT: "proxy", "app.kubernetes.io/managed-by": "envoy-gateway"},
    )
    prometheus = peer("observability", {"app.kubernetes.io/name": "prometheus"})
    collector = peer(
        "observability",
        {
            "app.kubernetes.io/name": "opentelemetry-collector",
            "app.kubernetes.io/instance": "otel-collector",
        },
    )
    for runtime in RUNTIMES:
        ingress = []
        if runtime in {
            "backend-api",
            "control-plane",
            "customer-web",
            "platform-admin",
        }:
            ingress.append(
                rule(
                    "fromEndpoints",
                    gateway,
                    3000 if runtime in {"customer-web", "platform-admin"} else 8000,
                )
            )
        if runtime in {"backend-api", "control-plane"}:
            ingress.append(rule("fromEndpoints", prometheus, 8000))
        egress = [dns_rule()]
        for service, (port, runtimes) in EXTERNAL_SERVICES.items():
            if service.endswith("_cidrs") and runtime in runtimes:
                egress.append(
                    rule(
                        "toEndpoints",
                        peer(
                            "noteverse-data",
                            {"app.kubernetes.io/name": service.removesuffix("_cidrs")},
                        ),
                        port,
                    )
                )
        if runtime in {
            "backend-api",
            "control-plane",
            "backend-worker",
            "backend-beat",
        }:
            egress.append(rule("toEndpoints", collector, 4317))
        policies.append(
            network_policy(
                "noteverse-" + runtime,
                {"matchLabels": {COMPONENT: runtime}},
                ingress,
                egress,
            )
        )
    return policies


def validate_fqdn(value: str) -> str:
    if (
        not isinstance(value, str)
        or len(value) > 253
        or value != value.lower()
        or value.endswith(".")
    ):
        raise ValueError("FQDNs require normalized lowercase exact hostnames")
    try:
        ip_address(value)
    except ValueError:
        pass
    else:
        raise ValueError("IP literals are not FQDNs")
    if not re.fullmatch(
        r"(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?",
        value,
    ):
        raise ValueError("Exact FQDNs require valid labels without wildcard, scheme or path")
    if value.endswith((".local", ".internal", ".localhost")):
        raise ValueError("External provider FQDNs must not select cluster or local names")
    return value


def validate_egress_configuration(configuration: dict) -> dict:
    if not isinstance(configuration, dict) or set(configuration) != set(EXTERNAL_SERVICES):
        raise ValueError("Every service requires an explicit private CIDR or exact FQDN list")
    result = {}
    private = [ip_network(c) for c in ("10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "fc00::/7")]
    for service, values in configuration.items():
        if (
            not isinstance(values, list)
            or any(not isinstance(v, str) for v in values)
            or len(values) != len(set(values))
        ):
            raise ValueError("Egress destinations require distinct string lists")
        if service.endswith("_cidrs"):
            for value in values:
                network = ip_network(value, strict=True)
                if not any(network.version == p.version and network.subnet_of(p) for p in private):
                    raise ValueError("Database and Redis destinations require private CIDRs")
            result[service] = sorted(values)
        else:
            result[service] = sorted(validate_fqdn(v) for v in values)
    return result


def external_network_policies(configuration: dict) -> list[dict]:
    configuration = validate_egress_configuration(configuration)
    policies = []
    for service, (port, runtimes) in EXTERNAL_SERVICES.items():
        values = configuration[service]
        egress = []
        if values:
            destination = (
                {"toCIDR": values}
                if service.endswith("_cidrs")
                else {"toFQDNs": [{"matchName": n} for n in values]}
            )
            egress.append(
                {
                    **destination,
                    "toPorts": [{"ports": [{"protocol": "TCP", "port": str(port)}]}],
                }
            )
            if service.endswith("_fqdns"):
                egress.append(dns_rule(values))
        for runtime in runtimes:
            policies.append(
                network_policy(
                    "noteverse-external-" + service.replace("_", "-") + "-" + runtime,
                    {"matchLabels": {COMPONENT: runtime}},
                    [],
                    egress,
                )
            )
    return policies


def pod_specs(document: dict):
    kind = document.get("kind")
    if kind == "Pod":
        yield document["spec"]
    elif kind in {"Deployment", "DaemonSet", "StatefulSet", "Job"}:
        yield document["spec"]["template"]["spec"]
    elif kind == "CronJob":
        yield document["spec"]["jobTemplate"]["spec"]["template"]["spec"]


def validate_workloads(
    documents: list[dict],
    *,
    api_token_workloads: frozenset[str] = frozenset(),
    host_namespace_workloads: frozenset[str] = frozenset(),
) -> list[str]:
    errors = []
    for document in documents:
        name = document.get("metadata", {}).get("name", "unknown")
        for pod in pod_specs(document):
            if pod.get("automountServiceAccountToken") is not (name in api_token_workloads):
                errors.append(f"{name}: service account token must not be mounted")
            if any(
                pod.get("securityContext", {}).get(key) != value
                for key, value in POD_SECURITY.items()
            ):
                errors.append(f"{name}: numeric non-root pod security context is required")
            if (
                any(pod.get(key) for key in ("hostNetwork", "hostPID", "hostIPC"))
                and name not in host_namespace_workloads
            ):
                errors.append(f"{name}: host namespaces are forbidden")
            volumes = {v["name"]: v for v in pod.get("volumes", [])}
            for volume in volumes.values():
                if name not in api_token_workloads and any(
                    "serviceAccountToken" in source
                    for source in volume.get("projected", {}).get("sources", [])
                ):
                    errors.append(f"{name}: explicit Kubernetes API token projection is forbidden")
                if "emptyDir" in volume and not re.fullmatch(
                    r"[1-9][0-9]*(Mi|Gi)", str(volume["emptyDir"].get("sizeLimit", ""))
                ):
                    errors.append(f"{name}: scratch volumes require a finite sizeLimit")
            for container in (
                pod.get("containers", [])
                + pod.get("initContainers", [])
                + pod.get("ephemeralContainers", [])
            ):
                if any(
                    container.get("securityContext", {}).get(key) != value
                    for key, value in CONTAINER_SECURITY.items()
                ):
                    errors.append(
                        f"{name}/{container['name']}: hardened container security context is required"
                    )
                if any(port.get("hostPort") for port in container.get("ports", [])):
                    errors.append(f"{name}: hostPort is forbidden")
                for mount in container.get("volumeMounts", []):
                    if "hostPath" in volumes.get(mount["name"], {}) and not mount.get("readOnly"):
                        if name not in {
                            "noteverse-model-cache-agent",
                            "noteverse-model-cache-sim",
                        }:
                            errors.append(
                                f"{name}: writable host paths are restricted to model preparation"
                            )
    return errors


def validate_application_documents(documents: list[dict]) -> list[str]:
    errors = validate_workloads(documents)
    namespaces = set()
    for document in documents:
        if list(pod_specs(document)):
            namespaces.add(document.get("metadata", {}).get("namespace"))
            component = (
                document.get("spec", {})
                .get("template", {})
                .get("metadata", {})
                .get("labels", {})
                .get(COMPONENT)
            )
            if component not in RUNTIMES:
                errors.append("Every application workload requires a declared network identity")
    from cilium_schema import validate_cilium_documents

    errors.extend(validate_cilium_documents(documents))
    if any(d.get("kind") in {"NetworkPolicy", "CiliumClusterwideNetworkPolicy"} for d in documents):
        errors.append("Application networking requires exclusively namespaced CiliumNetworkPolicy")
    policies = [d for d in documents if d.get("kind") == "CiliumNetworkPolicy"]
    if namespaces and any(
        d.get("metadata", {}).get("namespace") not in namespaces for d in policies
    ):
        errors.append("Network policy and workload namespaces must match")
    expected = {d["metadata"]["name"]: d["spec"] for d in application_network_policies()}
    seen = set()
    external = []
    for document in policies:
        name, spec = document["metadata"]["name"], document.get("spec", {})
        if name in seen:
            errors.append(f"{name}: duplicate network policy")
        seen.add(name)
        if name in expected:
            if spec != expected[name]:
                errors.append(f"{name}: runtime traffic matrix differs")
        elif name.startswith("noteverse-external-"):
            external.append(document)
        else:
            errors.append(f"{name}: undeclared additive network policy")
    if not set(expected).issubset(seen):
        errors.append("Missing default-deny or runtime network policy")
    if external:
        empty = {s: [] for s in EXTERNAL_SERVICES}
        external_names = {d["metadata"]["name"] for d in external_network_policies(empty)}
        if {d["metadata"]["name"] for d in external} != external_names:
            errors.append("External egress requires all reviewed per-service policies")
        for document in external:
            try:
                name = document["metadata"]["name"]
                service = next(
                    s
                    for s in EXTERNAL_SERVICES
                    if name.startswith("noteverse-external-" + s.replace("_", "-") + "-")
                )
                egress = document["spec"]["egress"]
                values = []
                if egress:
                    values = (
                        egress[0]["toCIDR"]
                        if service.endswith("_cidrs")
                        else [v["matchName"] for v in egress[0]["toFQDNs"]]
                    )
                configuration = {**empty, service: values}
                expected_external = {
                    d["metadata"]["name"]: d["spec"]
                    for d in external_network_policies(configuration)
                }
                if document["spec"] != expected_external.get(name):
                    errors.append(f"{name}: external service/role/port/DNS authority differs")
            except (KeyError, ValueError, TypeError, StopIteration):
                errors.append("Invalid external Cilium egress authority")
    for document in documents:
        if document.get("kind") == "ConfigMap" and document["metadata"]["name"] in {
            "noteverse-customer-api-config",
            "noteverse-control-plane-config",
        }:
            if document.get("data", {}).get("TRUSTED_PROXY_HOPS") != "1":
                errors.append("Gateway HTTP runtimes require exactly one trusted proxy hop")
    return errors


def validate_external_files(directory: Path, documents: list[dict] | None = None) -> list[str]:
    """Validate the configuration owner, including explicitly composed overlays."""
    return _validate_external_owner(directory.resolve(), documents, set())


def _validate_external_owner(
    directory: Path, documents: list[dict] | None, visited: set[Path]
) -> list[str]:
    if directory in visited:
        return []
    visited.add(directory)
    configuration = directory / "external-egress.json"
    manifest = directory / "external-egress.yaml"
    try:
        kustomization = directory / "kustomization.yaml"
        resources = (
            yaml.safe_load(kustomization.read_text(encoding="utf-8")).get("resources", [])
            if kustomization.exists()
            else []
        )
        errors = []
        if "external-egress.yaml" in resources and not configuration.exists():
            return ["Explicit external egress configuration is required"]
        if configuration.exists():
            expected = external_network_policies(
                json.loads(configuration.read_text(encoding="utf-8"))
            )
            observed = list(yaml.safe_load_all(manifest.read_text(encoding="utf-8")))
            if observed != expected:
                errors.append(
                    "External egress manifest differs from its reviewed egress configuration"
                )
            if documents is not None:
                for policy in expected:
                    matches = [
                        d
                        for d in documents
                        if d.get("kind") == "CiliumNetworkPolicy"
                        and d.get("metadata", {}).get("name") == policy["metadata"]["name"]
                    ]
                    if (
                        len(matches) != 1
                        or matches[0]["spec"] != policy["spec"]
                        or "specs" in matches[0]
                    ):
                        errors.append(
                            "Rendered external egress differs from its reviewed egress configuration"
                        )
        for resource in resources:
            path = (directory / resource).resolve()
            if path.is_dir():
                errors.extend(_validate_external_owner(path, documents, visited))
        return errors
    except (ValueError, OSError, yaml.YAMLError) as error:
        return ["Invalid external egress configuration: " + type(error).__name__]


def validate_dockerfiles(root: Path = ROOT) -> list[str]:
    errors = []
    for path in (root / "docker").rglob("Dockerfile*"):
        if not path.is_file() or path.name.endswith(".dockerignore"):
            continue
        ignore_path = Path(str(path) + ".dockerignore")
        if not ignore_path.exists():
            ignore_path = root / ".dockerignore"
        if ignore_path.exists():
            patterns = set(ignore_path.read_text(encoding="utf-8").splitlines())
            if not {
                "backend/.env*",
                "backend/db/secret-templates/*.env",
                "apps/**/.env*",
            }.issubset(patterns):
                errors.append(
                    f"{ignore_path.relative_to(root)}: local credential files must be excluded"
                )
        users = re.findall(r"^USER\s+(.+)$", path.read_text(encoding="utf-8"), re.M)
        if not users or users[-1].strip() != "10001:10001":
            errors.append(f"{path.relative_to(root)}: final USER must be 10001:10001")
    return errors


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--external-config", type=Path)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    if args.external_config:
        if not args.output:
            parser.error("--output is required")
        policies = external_network_policies(
            json.loads(args.external_config.read_text(encoding="utf-8"))
        )
        args.output.write_text(yaml.safe_dump_all(policies, sort_keys=False), encoding="utf-8")
    errors = validate_dockerfiles()
    for error in errors:
        print(error)
    return bool(errors)


if __name__ == "__main__":
    raise SystemExit(main())
