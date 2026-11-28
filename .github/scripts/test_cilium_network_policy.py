"""Cilium schema, DNS visibility and exact egress authority contracts."""

import copy
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

import yaml

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))
from container_security_contract import (  # noqa: E402
    EXTERNAL_SERVICES,
    application_network_policies,
    external_network_policies,
    validate_application_documents,
)
from cilium_schema import validate_cilium_documents, validator  # noqa: E402
import cilium_schema  # noqa: E402


class CiliumPolicyTests(unittest.TestCase):
    def configuration(self):
        return {s: [] for s in EXTERNAL_SERVICES}

    def test_default_deny_has_explicit_enforcement_and_metadata_denials(self):
        spec = application_network_policies()[0]["spec"]
        self.assertEqual(spec["endpointSelector"], {})
        self.assertEqual(spec["ingress"], [])
        self.assertEqual(spec["egress"], [])
        self.assertEqual(spec["enableDefaultDeny"], {"ingress": True, "egress": True})
        self.assertEqual(
            spec["egressDeny"],
            [{"toCIDR": ["169.254.169.254/32", "100.100.100.200/32"]}],
        )
        for field in ("enableDefaultDeny", "egressDeny"):
            docs = application_network_policies()
            del docs[0]["spec"][field]
            self.assertTrue(validate_application_documents(docs))

    def test_control_plane_scrape_is_prometheus_only_on_tcp_8000(self):
        policy = next(
            p
            for p in application_network_policies()
            if p["metadata"]["name"] == "noteverse-control-plane"
        )
        rules = policy["spec"]["ingress"]
        self.assertEqual(len(rules), 2)
        monitoring = [
            r
            for r in rules
            if r["fromEndpoints"][0]["matchLabels"]["k8s:io.kubernetes.pod.namespace"]
            == "observability"
        ]
        self.assertEqual(len(monitoring), 1)
        self.assertEqual(
            monitoring[0]["fromEndpoints"][0]["matchLabels"]["k8s:app.kubernetes.io/name"],
            "prometheus",
        )
        self.assertEqual(
            monitoring[0]["toPorts"], [{"ports": [{"protocol": "TCP", "port": "8000"}]}]
        )
        policies = application_network_policies()
        control = next(p for p in policies if p["metadata"]["name"] == "noteverse-control-plane")
        control["spec"]["ingress"][1]["toPorts"][0]["ports"][0]["port"] = "9090"
        self.assertTrue(validate_application_documents(policies))

    def test_no_empty_allow_all_or_l4_dns_bypass(self):
        for policy in application_network_policies():
            for direction in ("ingress", "egress"):
                self.assertNotIn({}, policy["spec"][direction])
            for rule in policy["spec"]["egress"]:
                for port in rule.get("toPorts", []):
                    if any(p["port"] == "53" for p in port["ports"]):
                        self.assertTrue(port["rules"]["dns"])
                        self.assertEqual({p["protocol"] for p in port["ports"]}, {"TCP", "UDP"})

    def test_exact_https_roles_and_l7_dns_names_with_ndots_search(self):
        config = {
            **self.configuration(),
            "s3_fqdns": ["bucket.storage.example.com"],
            "mail_fqdns": ["api.resend.com"],
            "model_fqdns": ["huggingface.co"],
        }
        policies = external_network_policies(config)
        self.assertEqual(
            validate_application_documents(application_network_policies() + policies),
            [],
        )
        roles = set()
        for policy in policies:
            for rule in policy["spec"]["egress"]:
                if "toFQDNs" not in rule:
                    continue
                roles.add(
                    policy["spec"]["endpointSelector"]["matchLabels"]["app.kubernetes.io/component"]
                )
                self.assertEqual(rule["toPorts"], [{"ports": [{"protocol": "TCP", "port": "443"}]}])
                dns = policy["spec"]["egress"][1]["toPorts"][0]["rules"]["dns"]
                for fqdn in rule["toFQDNs"]:
                    self.assertIn(fqdn, dns)
                    self.assertEqual(
                        dns,
                        [{"matchName": entry["matchName"]} for entry in rule["toFQDNs"]],
                    )
        self.assertEqual(roles, {"backend-api", "backend-worker", "model-cache-agent"})
        internal = application_network_policies()[1]["spec"]["egress"][0]["toPorts"][0]["rules"][
            "dns"
        ]
        self.assertIn({"matchPattern": "**.cluster.local"}, internal)
        self.assertIn({"matchPattern": "**.svc.cluster.local"}, internal)

    def test_empty_configuration_grants_no_external_destinations(self):
        self.assertTrue(
            all(not p["spec"]["egress"] for p in external_network_policies(self.configuration()))
        )

    def test_invalid_fqdn_inputs_are_rejected(self):
        for name in (
            "*",
            "**",
            "*.com",
            "*.example.com",
            "https://api.example.com",
            "api.example.com/path",
            "1.2.3.4",
            "::1",
            "api..com",
            "api.example.com.",
            "API.example.com",
            "api.example.com:443",
            "a.cluster.local",
            "null",
            "-a.example.com",
        ):
            with self.subTest(name=name), self.assertRaises(ValueError):
                external_network_policies({**self.configuration(), "s3_fqdns": [name]})

    def test_database_and_redis_accept_only_explicit_private_networks(self):
        for field in ("postgresql_cidrs", "redis_cidrs"):
            for cidr in (
                "0.0.0.0/0",
                "::/0",
                "8.8.8.8/32",
                "169.254.169.254/32",
                "100.100.100.200/32",
                "127.0.0.1/32",
                "10.1.2.3/24",
            ):
                with (
                    self.subTest(field=field, cidr=cidr),
                    self.assertRaises(ValueError),
                ):
                    external_network_policies({**self.configuration(), field: [cidr]})
            external_network_policies(
                {**self.configuration(), field: ["10.24.0.0/24", "fd01::/64"]}
            )

    def test_official_schema_accepts_every_policy_and_configured_destinations(self):
        config = {
            **self.configuration(),
            "postgresql_cidrs": ["10.1.0.0/24"],
            "s3_fqdns": ["s3.example.com"],
        }
        self.assertEqual(
            validate_cilium_documents(
                application_network_policies() + external_network_policies(config)
            ),
            [],
        )

    def test_official_schema_rejects_invalid_ports_types_and_unknown_fields(self):
        original = application_network_policies()[1]
        printable = copy.deepcopy(original)
        printable["spec"]["log"] = {"value": "dns-绛栫暐"}
        self.assertEqual(validate_cilium_documents([printable]), [])
        for mutation in ("port", "protocol", "unknown", "selector", "log"):
            document = copy.deepcopy(original)
            if mutation == "port":
                document["spec"]["egress"][0]["toPorts"][0]["ports"][0]["port"] = 53
            elif mutation == "protocol":
                document["spec"]["egress"][0]["toPorts"][0]["ports"][0]["protocol"] = "HTTPS"
            elif mutation == "unknown":
                document["spec"]["egress"][0]["toFQDNS"] = [{"matchName": "api.example.com"}]
            elif mutation == "selector":
                document["spec"]["endpointSelector"] = "all"
            else:
                document["spec"]["log"] = {"value": "dns-\x00"}
            self.assertTrue(validate_cilium_documents([document]), mutation)

    def test_mixed_policy_types_and_additive_cilium_rules_are_denied(self):
        for kind in (
            "NetworkPolicy",
            "CiliumNetworkPolicy",
            "CiliumClusterwideNetworkPolicy",
        ):
            extra = {
                "kind": kind,
                "metadata": {"name": "allow-other"},
                "spec": {"endpointSelector": {}, "egress": [{}]},
            }
            self.assertTrue(
                validate_application_documents(application_network_policies() + [extra])
            )

    def test_checked_in_policies_are_schema_valid_and_match_the_contract(self):
        for base in ("deploy/application/base",):
            docs = list(yaml.safe_load_all((ROOT / base / "network-policies.yaml").read_text()))
            self.assertEqual(validate_application_documents(docs), [])
        for path in (ROOT / "deploy").rglob("external-egress.json"):
            config = json.loads(path.read_text())
            self.assertEqual(config, self.configuration())
            self.assertEqual(
                validate_cilium_documents(
                    list(yaml.safe_load_all(path.with_suffix(".yaml").read_text()))
                ),
                [],
            )

    def test_secondary_rule_lists_cannot_add_undeclared_traffic_authority(self):
        for index in (0, 1):
            docs = application_network_policies()
            docs[index]["specs"] = [{"endpointSelector": {}, "ingress": [{}], "egress": [{}]}]
            self.assertTrue(validate_cilium_documents(docs))
            self.assertTrue(validate_application_documents(docs))
        docs = application_network_policies() + external_network_policies(self.configuration())
        docs[-1]["specs"] = [{"endpointSelector": {}, "egress": [{}]}]
        self.assertTrue(validate_application_documents(docs))

    def test_application_namespace_contains_only_cilium_policies(self):
        for base in ("deploy/application", "deploy/gitops/environments"):
            for path in (ROOT / base).rglob("*.yaml"):
                for doc in yaml.safe_load_all(path.read_text(encoding="utf-8")):
                    if isinstance(doc, dict):
                        self.assertNotEqual(doc.get("kind"), "NetworkPolicy", str(path))

    def test_release_workflows_materialize_all_explicit_egress_inputs(self):
        for environment in ("staging", "production"):
            source = (ROOT / f".github/workflows/{environment}-release-package.yml").read_text()
            for name in (
                "POSTGRESQL_EGRESS_CIDRS",
                "REDIS_EGRESS_CIDRS",
                "S3_EGRESS_FQDNS",
                "MAIL_EGRESS_FQDNS",
                "MODEL_EGRESS_FQDNS",
            ):
                self.assertIn(f"vars.{environment.upper()}_{name}", source)
            self.assertIn('--external-egress-config "$RUNNER_TEMP/external-egress.json"', source)

    def test_offline_schema_digest_is_stable_across_linux_and_windows_checkouts(self):
        data = cilium_schema.SCHEMA.read_bytes().replace(b"\r\n", b"\n")
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "schema.json"
            for text in (data, data.replace(b"\n", b"\r\n")):
                path.write_bytes(text)
                validator.cache_clear()
                with patch.object(cilium_schema, "SCHEMA", path):
                    self.assertEqual(validate_cilium_documents(application_network_policies()), [])
        validator.cache_clear()

    def test_manifest_contract_can_import_skip_counter_without_pytest(self):
        code = "import runpy; runpy.run_path('.github/scripts/backend_security_regression.py', run_name='contract')"
        subprocess.run(
            [sys.executable, "-S", "-c", code],
            cwd=ROOT,
            check=True,
            capture_output=True,
        )

    def test_backend_quality_has_explicit_non_secret_s3_settings(self):
        job = yaml.safe_load((ROOT / ".github/workflows/backend-quality.yml").read_text())["jobs"][
            "quality"
        ]
        write = next(
            s["run"] for s in job["steps"] if s["name"] == "Write backend quality environment"
        )
        for name in (
            "S3_ENDPOINT_URL",
            "S3_BUCKET",
            "S3_ACCESS_KEY_ID",
            "S3_SECRET_ACCESS_KEY",
        ):
            self.assertTrue(job["env"][name])
            self.assertIn(f"{name}=${name}", write)


if __name__ == "__main__":
    unittest.main()
