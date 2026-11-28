"""Container identity, privilege reduction and exact runtime traffic matrices."""

import copy
import importlib.util
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest

import yaml

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))
from container_security_contract import (  # noqa: E402
    application_network_policies,
    external_network_policies,
    EXTERNAL_SERVICES,
    validate_application_documents,
    validate_workloads,
    validate_dockerfiles,
    validate_external_files,
)
from browser_security_contract import validate_browser_documents  # noqa: E402
from harden_observability_manifests import harden, API_CLIENTS, HOST_OBSERVERS  # noqa: E402


class ContainerSecurityPolicyTests(unittest.TestCase):
    def fixture(self):
        workload = yaml.safe_load(
            (ROOT / "deploy/application/base/backend-api-deployment.yaml").read_text()
        )
        return [workload, *application_network_policies()]

    def test_all_runtime_images_have_numeric_non_root_identity(self):
        self.assertEqual(validate_dockerfiles(), [])

    def test_missing_root_and_username_only_image_identities_fail(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "docker/backend/Dockerfile.api"
            path.parent.mkdir(parents=True)
            for user in ("", "USER root", "USER node", "USER 0:0", "USER 10001"):
                path.write_text("FROM python:3.12\n" + user + "\n")
                self.assertTrue(validate_dockerfiles(Path(directory)))

    def test_every_pod_and_init_container_is_hardened(self):
        documents = []
        for base in (
            "deploy/application/base",
            "deploy/gitops/environments/staging/base",
            "deploy/application/model-cache",
        ):
            for path in (ROOT / base).glob("*.yaml"):
                documents.extend(d for d in yaml.safe_load_all(path.read_text()) if d)
        self.assertEqual(validate_workloads(documents), [])

    def test_pod_security_fields_are_required_individually(self):
        for key in ("runAsNonRoot", "runAsUser", "runAsGroup", "fsGroup", "seccompProfile"):
            docs = self.fixture()
            del docs[0]["spec"]["template"]["spec"]["securityContext"][key]
            self.assertTrue(validate_workloads(docs), key)

    def test_container_and_init_security_fields_are_required_individually(self):
        for group in ("containers", "initContainers"):
            for key in (
                "runAsNonRoot",
                "runAsUser",
                "runAsGroup",
                "allowPrivilegeEscalation",
                "readOnlyRootFilesystem",
                "privileged",
                "capabilities",
                "seccompProfile",
            ):
                docs = self.fixture()
                pod = docs[0]["spec"]["template"]["spec"]
                if group == "initContainers":
                    pod[group] = [copy.deepcopy(pod["containers"][0])]
                del pod[group][0]["securityContext"][key]
                self.assertTrue(validate_workloads(docs), (group, key))

    def test_token_mount_host_namespace_and_unbounded_scratch_are_rejected(self):
        for mutation in ("token", "host", "scratch"):
            docs = self.fixture()
            pod = docs[0]["spec"]["template"]["spec"]
            if mutation == "token":
                pod["automountServiceAccountToken"] = True
            if mutation == "host":
                pod["hostNetwork"] = True
            if mutation == "scratch":
                pod["volumes"][0]["emptyDir"] = {}
            self.assertTrue(validate_workloads(docs))

    def test_exact_base_traffic_matrix_and_default_deny(self):
        self.assertEqual(validate_application_documents(self.fixture()), [])
        for index in range(len(application_network_policies())):
            docs = self.fixture()
            del docs[index + 1]
            self.assertTrue(validate_application_documents(docs))

    def test_additive_policies_and_forbidden_cross_runtime_paths_fail(self):
        for runtime, destination in (
            ("backend-api", "control-plane"),
            ("backend-worker", "control-plane"),
            ("platform-admin", "control-plane"),
            ("control-plane", "backend-worker"),
        ):
            docs = self.fixture()
            policy = next(
                d
                for d in docs
                if d.get("kind") == "CiliumNetworkPolicy"
                and d.get("metadata", {}).get("name") == "noteverse-" + runtime
            )
            policy["spec"]["egress"].append(
                {
                    "toEndpoints": [{"matchLabels": {"app.kubernetes.io/component": destination}}],
                    "toPorts": [{"ports": [{"port": "8000", "protocol": "TCP"}]}],
                }
            )
            self.assertTrue(validate_application_documents(docs))
        docs = self.fixture()
        docs.append(
            {
                "kind": "NetworkPolicy",
                "metadata": {"name": "allow-all"},
                "spec": {"podSelector": {}, "ingress": [{}], "egress": [{}]},
            }
        )
        self.assertTrue(validate_application_documents(docs))

    def test_gateway_and_metrics_peers_require_namespace_and_pod_selector(self):
        docs = self.fixture()
        policy = next(
            d for d in docs if d.get("metadata", {}).get("name") == "noteverse-control-plane"
        )
        del policy["spec"]["ingress"][0]["fromEndpoints"][0]["matchLabels"][
            "k8s:io.kubernetes.pod.namespace"
        ]
        self.assertTrue(validate_application_documents(docs))

    def test_external_egress_is_closed_and_scoped_by_service(self):
        configuration = {service: [] for service in EXTERNAL_SERVICES}
        policies = external_network_policies(configuration)
        self.assertTrue(all(not p["spec"]["egress"] for p in policies))
        self.assertEqual(validate_application_documents(self.fixture() + policies), [])
        configuration["s3_fqdns"] = ["storage.example.com"]
        policies = external_network_policies(configuration)
        self.assertEqual(validate_application_documents(self.fixture() + policies), [])
        affected = [p for p in policies if p["spec"]["egress"]]
        self.assertEqual(len(affected), 2)
        for policy in affected:
            self.assertEqual(
                policy["spec"]["egress"][0]["toPorts"],
                [{"ports": [{"protocol": "TCP", "port": "443"}]}],
            )
        affected[0]["spec"]["egress"][0]["toPorts"][0]["ports"][0]["port"] = "8000"
        self.assertTrue(validate_application_documents(self.fixture() + policies))

    def test_external_fqdn_input_rejects_wildcards_and_ip_literals(self):
        for cidr in (
            "0.0.0.0/0",
            "::/0",
            "127.0.0.1/32",
            "10.0.0.0/8",
            "*.example.com",
            "8.8.8.8/24",
        ):
            configuration = {service: [] for service in EXTERNAL_SERVICES}
            configuration["s3_fqdns"] = [cidr]
            with self.assertRaises(ValueError, msg=cidr):
                external_network_policies(configuration)

    def test_admin_api_is_direct_and_cannot_be_shadowed_by_frontend(self):
        for path in (ROOT / "deploy").rglob("gateway.yaml"):
            docs = [d for d in yaml.safe_load_all(path.read_text()) if d]
            self.assertEqual(validate_browser_documents(docs), [])
            admin = next(
                d
                for d in docs
                if d.get("kind") == "HTTPRoute"
                and d["metadata"]["name"] == "noteverse-platform-admin"
            )
            admin["spec"]["rules"][0]["backendRefs"][0]["name"] = "noteverse-platform-admin"
            self.assertTrue(validate_browser_documents(docs))

    def test_gateway_hop_count_is_exact(self):
        for value in ("0", "2", None):
            docs = self.fixture() + [
                {
                    "kind": "ConfigMap",
                    "metadata": {"name": "noteverse-control-plane-config"},
                    "data": {"TRUSTED_PROXY_HOPS": value},
                }
            ]
            self.assertTrue(validate_application_documents(docs))

    def test_security_gate_counts_skips_and_is_explicit_in_workflow(self):
        spec = importlib.util.spec_from_file_location(
            "required_security", ROOT / ".github/scripts/backend_security_regression.py"
        )
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        checks = module.RequiredChecks()
        checks.pytest_collectreport(SimpleNamespace(skipped=True))
        checks.pytest_runtest_logreport(SimpleNamespace(skipped=True, when="setup"))
        self.assertEqual(checks.skipped, 2)
        workflow = yaml.safe_load((ROOT / ".github/workflows/backend-quality.yml").read_text())
        steps = workflow["jobs"]["quality"]["steps"]
        command = next(
            s["run"]
            for s in steps
            if s["name"] == "Run mandatory zero-skip security and architecture regression"
        )
        self.assertIn("backend_security_regression.py", command)
        self.assertIn("--read-only", command)
        self.assertIn("--cap-drop ALL", command)
        self.assertIn("NOTEVERSE_TEST_REDIS_URL", command)
        self.assertIn("NOTEVERSE_TEST_PRACTICE_BUNDLE_POSTGRES_URL", command)

    def test_observability_chart_pods_have_identical_hardening(self):
        docs = [
            {
                "kind": "Deployment",
                "metadata": {"name": "otel-collector-opentelemetry-collector"},
                "spec": {
                    "template": {
                        "spec": {
                            "volumes": None,
                            "containers": [{"name": "collector", "volumeMounts": None}],
                        }
                    }
                },
            }
        ]
        rendered = harden(docs)
        self.assertEqual(validate_workloads(rendered), [])
        pod = rendered[0]["spec"]["template"]["spec"]
        self.assertEqual(pod["volumes"][0]["emptyDir"], {"sizeLimit": "128Mi"})

    def test_only_named_observability_api_clients_mount_tokens(self):
        for name in ("fluent-bit", "kube-prometheus-stack-operator", "tempo"):
            docs = [
                {
                    "kind": "Deployment",
                    "metadata": {"name": name},
                    "spec": {"template": {"spec": {"containers": [{"name": "main"}]}}},
                }
            ]
            docs = harden(docs)
            self.assertEqual(
                docs[0]["spec"]["template"]["spec"]["automountServiceAccountToken"],
                name in API_CLIENTS,
            )
            self.assertEqual(
                validate_workloads(
                    docs, api_token_workloads=API_CLIENTS, host_namespace_workloads=HOST_OBSERVERS
                ),
                [],
            )

    def test_observability_operator_managed_pods_have_explicit_contexts(self):
        for kind in ("Prometheus", "Alertmanager"):
            doc = harden([{"kind": kind, "metadata": {"name": "metrics"}, "spec": {}}])[0]
            spec = doc["spec"]
            self.assertEqual(spec["securityContext"]["runAsUser"], 10001)
            self.assertEqual(spec["automountServiceAccountToken"], kind == "Prometheus")
            for container in spec["containers"] + spec["initContainers"]:
                self.assertTrue(container["securityContext"]["readOnlyRootFilesystem"])
                self.assertFalse(container["securityContext"]["allowPrivilegeEscalation"])

    def test_observability_renderer_and_install_contract_use_same_post_renderer(self):
        source = (ROOT / "scripts/render_observability_helm.py").read_text()
        self.assertIn("harden_observability_manifests import harden", source)
        values = yaml.safe_load(
            (ROOT / "deploy/observability/values/kube-prometheus-stack.values.yaml").read_text()
        )
        self.assertFalse(values["grafana"]["initChownData"]["enabled"])

    def test_publication_contracts_execute_with_read_only_images(self):
        for name in (
            ".github/actions/backend-service-image/action.yml",
            ".github/workflows/backend-worker-image.yml",
            ".github/workflows/backend-worker-pr-image.yml",
        ):
            source = (ROOT / name).read_text()
            for line in source.splitlines():
                if "docker run --rm --network none" in line:
                    self.assertIn("--read-only", line)
                    self.assertIn("--cap-drop ALL", line)
                    self.assertIn("--security-opt no-new-privileges", line)

    def test_application_policy_files_enforce_non_negotiable_runtime_boundaries(self):
        for base in ("deploy/application/base", "deploy/gitops/environments/staging/base"):
            docs = list(yaml.safe_load_all((ROOT / base / "network-policies.yaml").read_text()))
            by_name = {d["metadata"]["name"]: d["spec"] for d in docs}
            self.assertEqual(by_name["noteverse-default-deny"]["endpointSelector"], {})
            self.assertEqual(by_name["noteverse-default-deny"]["ingress"], [])
            self.assertEqual(by_name["noteverse-default-deny"]["egress"], [])
            for runtime in ("backend-worker", "backend-beat", "migration", "model-cache-agent"):
                self.assertEqual(by_name["noteverse-" + runtime]["ingress"], [])
            for runtime in ("customer-web", "platform-admin"):
                self.assertEqual(
                    {
                        p["port"]
                        for rule in by_name["noteverse-" + runtime]["egress"]
                        for to_port in rule["toPorts"]
                        for p in to_port["ports"]
                    },
                    {"53"},
                )
            for runtime in ("control-plane", "backend-api", "backend-worker", "backend-beat"):
                for rule in by_name["noteverse-" + runtime]["egress"]:
                    for target in rule["toEndpoints"]:
                        self.assertIn("k8s:io.kubernetes.pod.namespace", target["matchLabels"])
                        self.assertNotIn(
                            "app.kubernetes.io/component",
                            target.get("matchLabels", {}),
                        )
            for runtime in ("control-plane", "backend-beat", "migration", "observability-exporter"):
                self.assertNotIn(
                    443,
                    {
                        p["port"]
                        for rule in by_name["noteverse-" + runtime]["egress"]
                        for to_port in rule["toPorts"]
                        for p in to_port["ports"]
                    },
                )

    def test_image_contexts_exclude_local_runtime_credentials(self):
        paths = [ROOT / ".dockerignore", *(ROOT / "docker/backend").glob("*.dockerignore")]
        for path in paths:
            patterns = set(path.read_text().splitlines())
            self.assertTrue(
                {"backend/.env*", "backend/db/secret-templates/*.env", "apps/**/.env*"}.issubset(
                    patterns
                ),
                path,
            )

    def test_rendered_external_policy_cannot_bypass_its_egress_configuration(self):
        with tempfile.TemporaryDirectory() as directory:
            owner = Path(directory)
            config = {service: [] for service in EXTERNAL_SERVICES}
            import json

            (owner / "external-egress.json").write_text(json.dumps(config))
            policies = external_network_policies(config)
            (owner / "external-egress.yaml").write_text(
                yaml.safe_dump_all(policies, sort_keys=False)
            )
            self.assertEqual(validate_external_files(owner, policies), [])
            policies[0]["spec"]["egress"] = [
                {
                    "to": [{"ipBlock": {"cidr": "8.8.8.8/32"}}],
                    "ports": [{"protocol": "TCP", "port": 5432}],
                }
            ]
            self.assertTrue(validate_external_files(owner, policies))

    def test_explicit_service_account_projection_requires_api_authority(self):
        docs = self.fixture()
        pod = docs[0]["spec"]["template"]["spec"]
        pod["volumes"].append(
            {
                "name": "api-token",
                "projected": {"sources": [{"serviceAccountToken": {"path": "token"}}]},
            }
        )
        self.assertTrue(validate_workloads(docs))

    def test_grafana_api_token_requires_an_active_dashboard_discovery_sidecar(self):
        for enabled in (False, True):
            containers = [{"name": "grafana"}] + (
                [{"name": "grafana-sc-dashboard"}] if enabled else []
            )
            docs = [
                {
                    "kind": "Deployment",
                    "metadata": {"name": "kube-prometheus-stack-grafana"},
                    "spec": {"template": {"spec": {"containers": containers}}},
                }
            ]
            pod = harden(docs)[0]["spec"]["template"]["spec"]
            self.assertEqual(pod["automountServiceAccountToken"], enabled)
        values = yaml.safe_load(
            (ROOT / "deploy/observability/values/kube-prometheus-stack.values.yaml").read_text()
        )
        self.assertTrue(values["grafana"]["rbac"]["namespaced"])
        self.assertEqual(values["grafana"]["sidecar"]["dashboards"]["resource"], "configmap")
        self.assertEqual(
            values["grafana"]["sidecar"]["dashboards"]["searchNamespace"], "observability"
        )

    def test_grafana_role_contains_only_namespaced_configmap_reads(self):
        deployment = {
            "kind": "Deployment",
            "metadata": {"name": "kube-prometheus-stack-grafana"},
            "spec": {
                "template": {
                    "spec": {"containers": [{"name": "grafana-sc-dashboard"}, {"name": "grafana"}]}
                }
            },
        }
        role = {
            "kind": "Role",
            "metadata": {"name": "kube-prometheus-stack-grafana", "namespace": "observability"},
            "rules": [
                {
                    "apiGroups": [""],
                    "resources": ["configmaps", "secrets"],
                    "verbs": ["get", "list", "watch"],
                }
            ],
        }
        result = harden([deployment, role])
        self.assertEqual(
            result[1]["rules"],
            [{"apiGroups": [""], "resources": ["configmaps"], "verbs": ["get", "watch", "list"]}],
        )
        with self.assertRaises(ValueError):
            harden(
                [
                    {
                        "kind": "ClusterRole",
                        "metadata": {"name": "kube-prometheus-stack-grafana-clusterrole"},
                        "rules": role["rules"],
                    }
                ]
            )

    def test_frontend_writable_cache_matches_runtime_capabilities(self):
        for base in ("deploy/application/base", "deploy/gitops/environments/staging/base"):
            for runtime, expected in (("customer-web", True), ("platform-admin", False)):
                pod = yaml.safe_load((ROOT / base / (runtime + "-deployment.yaml")).read_text())[
                    "spec"
                ]["template"]["spec"]
                mounts = [m["mountPath"] for c in pod["containers"] for m in c["volumeMounts"]]
                self.assertEqual("/app/.next/cache" in mounts, expected)
