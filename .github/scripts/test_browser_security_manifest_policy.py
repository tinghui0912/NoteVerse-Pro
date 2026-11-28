"""Gateway HSTS and browser CSP configuration have distinct immutable ownership."""

import copy
import sys
import unittest
from pathlib import Path
import yaml

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))
from browser_security_contract import storage_origins, validate_browser_documents  # noqa: E402


class BrowserSecurityManifestTests(unittest.TestCase):
    def gateway_sets(self):
        return [
            [doc for doc in yaml.safe_load_all(path.read_text(encoding="utf-8")) if doc]
            for path in (ROOT / "deploy").rglob("gateway.yaml")
        ]

    def gateways(self):
        return [doc for documents in self.gateway_sets() for doc in documents]

    def test_every_public_gateway_rule_sets_exact_hsts(self):
        documents = self.gateways()
        routes = [doc for doc in documents if doc.get("kind") == "HTTPRoute"]
        self.assertEqual(len(routes), 2 * len(self.gateway_sets()))
        for group in self.gateway_sets():
            self.assertEqual(validate_browser_documents(group), [])
        gateways = [doc for doc in documents if doc.get("kind") == "Gateway"]
        for gateway in gateways:
            self.assertTrue(
                all(
                    listener["protocol"] == "HTTPS" and listener["tls"]["mode"] == "Terminate"
                    for listener in gateway["spec"]["listeners"]
                )
            )

    def test_missing_duplicate_or_relaxed_hsts_is_rejected(self):
        route = next(doc for doc in self.gateways() if doc.get("kind") == "HTTPRoute")
        for changes in (
            [],
            [
                {
                    "type": "ResponseHeaderModifier",
                    "responseHeaderModifier": {
                        "set": [{"name": "Strict-Transport-Security", "value": "max-age=1"}]
                    },
                }
            ],
        ):
            candidate = copy.deepcopy(route)
            candidate["spec"]["rules"][0]["filters"] = changes
            self.assertTrue(validate_browser_documents([candidate]))
        candidate = copy.deepcopy(route)
        candidate["spec"]["rules"][0]["filters"] *= 2
        self.assertTrue(validate_browser_documents([candidate]))

    def test_gateway_cannot_emit_or_strip_document_csp(self):
        route = next(doc for doc in self.gateways() if doc.get("kind") == "HTTPRoute")
        for mutation in (
            {"set": [{"name": "Content-Security-Policy", "value": "default-src 'self'"}]},
            {"remove": ["Content-Security-Policy"]},
        ):
            candidate = copy.deepcopy(route)
            candidate["spec"]["rules"][0]["filters"].append(
                {"type": "ResponseHeaderModifier", "responseHeaderModifier": mutation}
            )
            self.assertTrue(validate_browser_documents([candidate]))

    def test_public_configmaps_and_deployments_wire_explicit_origins(self):
        for path in (ROOT / "deploy").rglob("customer-web-config.env"):
            data = dict(
                line.split("=", 1)
                for line in path.read_text(encoding="utf-8").splitlines()
                if line and not line.startswith("#")
            )
            self.assertTrue(storage_origins(data["CSP_OBJECT_STORAGE_ORIGINS"]))
            self.assertFalse(
                validate_browser_documents(
                    [
                        {
                            "kind": "ConfigMap",
                            "metadata": {"name": "noteverse-customer-web-config"},
                            "data": data,
                        }
                    ]
                )
            )
        for path in (ROOT / "deploy").rglob("customer-web-deployment.yaml"):
            deployment = yaml.safe_load(path.read_text(encoding="utf-8"))
            container = deployment["spec"]["template"]["spec"]["containers"][0]
            self.assertIn(
                {"configMapRef": {"name": "noteverse-customer-web-config"}}, container["envFrom"]
            )
            self.assertFalse(any("secretRef" in item for item in container["envFrom"]))

    def test_malformed_or_wildcard_origins_are_rejected(self):
        for value in (
            "",
            "*",
            "null",
            "https:",
            "https://*.example.com",
            "https://cdn.test/path",
            "https://user@cdn.test",
            "https://cdn.test,",
            "https://cdn.test#",
            "https://cdn.test;upgrade-insecure-requests",
            "https://cdn.test%2f",
            "https://cdn.test\\path",
        ):
            with self.subTest(value=value), self.assertRaises(ValueError):
                storage_origins(value)
        self.assertEqual(
            storage_origins("https://cdn.test,https://cdn.test/"), ("https://cdn.test",)
        )

    def test_gateway_body_limits_are_finite_and_align_with_api_envelopes(self):
        for documents in self.gateway_sets():
            self.assertEqual(validate_browser_documents(documents), [])
            policies = [d for d in documents if d.get("kind") == "BackendTrafficPolicy"]
            self.assertEqual(len(policies), 2)
            for policy in policies:
                candidate = copy.deepcopy(documents)
                altered = next(d for d in candidate if d == policy)
                altered["spec"]["requestBuffer"]["limit"] = "1Mi"
                self.assertTrue(validate_browser_documents(candidate))
            missing = [d for d in documents if d.get("kind") != "BackendTrafficPolicy"]
            self.assertTrue(validate_browser_documents(missing))

    def test_body_limits_cannot_be_scoped_away_or_replaced_with_buffer_only_mode(self):
        for documents in self.gateway_sets():
            for mutation in ("scope", "group", "namespace", "mode"):
                candidate = copy.deepcopy(documents)
                policy = next(d for d in candidate if d.get("kind") == "BackendTrafficPolicy")
                if mutation == "mode":
                    policy["spec"]["requestBuffer"]["mode"] = "LimitOnly"
                elif mutation == "namespace":
                    policy["metadata"]["namespace"] = "different"
                elif mutation == "group":
                    policy["spec"]["targetRefs"][0]["group"] = "different.example"
                else:
                    policy["spec"]["targetRefs"][0]["sectionName"] = "one-rule"
                self.assertTrue(validate_browser_documents(candidate))

    def test_platform_bootstrap_provisions_the_body_policy_crd(self):
        bootstrap = (ROOT / "scripts/minikube_platform_bootstrap.ps1").read_text(encoding="utf-8")
        self.assertIn("gateway-crds-helm", bootstrap)
        self.assertIn("--set crds.gatewayAPI.enabled=false", bootstrap)
        self.assertIn("--set crds.envoyGateway.enabled=true", bootstrap)
        self.assertLess(
            bootstrap.index('Invoke-Checked "envoy-gateway:crds"'),
            bootstrap.index('Invoke-WithRetry "envoy-gateway:install"'),
        )

    def test_release_calls_explicitly_pass_public_origins(self):
        for name in (
            "staging-release-package.yml",
            "production-release-package.yml",
            "k8s-application-manifests.yml",
        ):
            text = (ROOT / ".github/workflows" / name).read_text(encoding="utf-8")
            self.assertIn("--csp-object-storage-origins", text)
        self.assertIn(
            "CSP_OBJECT_STORAGE_ORIGINS",
            (ROOT / "apps/customer-web/.env.docker.example").read_text(encoding="utf-8"),
        )


if __name__ == "__main__":
    unittest.main()
