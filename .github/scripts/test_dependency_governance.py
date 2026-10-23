"""Policy tests cover missing, stale, ambiguous, and malformed registrations."""

from contextlib import redirect_stderr, redirect_stdout
from copy import deepcopy
import io
import json
from pathlib import Path
import tempfile
import unittest

import dependency_governance as policy


class DependencyGovernanceTests(unittest.TestCase):
    def setUp(self):
        self.manifests = {name: {} for name in policy.MANIFESTS}
        self.registry = {"schema_version": 1, "exceptions": []}

    def add(self, selector=None, version="1.2.3"):
        selector = selector or ["parent@1", "leaf"]
        record = {"manifest": policy.MANIFESTS[0], "selector": selector,
                  "requested_version": version, "category": "security",
                  "reason": "Upstream pins a vulnerable child.",
                  "exit_condition": "Remove after the parent admits a safe child.",
                  "review_trigger": "Recheck on every parent update.",
                  "evidence": ["https://example.com/upstream-evidence"]}
        self.registry["exceptions"].append(record)
        return record

    def live(self):
        self.manifests[policy.MANIFESTS[0]]["overrides"] = {"parent@1": {"leaf": "1.2.3"}}

    def test_no_overrides_needs_no_exceptions(self):
        self.assertEqual(policy.validate(self.manifests, self.registry), [])

    def test_nested_registration_matches(self):
        self.live(); self.add()
        self.assertEqual(policy.validate(self.manifests, self.registry), [])

    def test_global_registration_matches(self):
        self.manifests[policy.MANIFESTS[0]]["overrides"] = {"leaf": "1.2.3"}
        self.add(["leaf"])
        self.assertEqual(policy.validate(self.manifests, self.registry), [])

    def test_missing_registration_rejected(self):
        self.live()
        self.assertIn("Unregistered override", policy.validate(self.manifests, self.registry)[0])

    def test_stale_registration_rejected(self):
        self.add()
        self.assertIn("Obsolete exception", policy.validate(self.manifests, self.registry)[0])

    def test_version_mismatch_rejected(self):
        self.live(); self.add(version="1.2.4")
        self.assertIn("Version mismatch", policy.validate(self.manifests, self.registry)[0])

    def test_duplicate_registration_rejected(self):
        self.add(); self.add()
        with self.assertRaisesRegex(policy.GovernanceError, "Duplicate exception"):
            policy.validate(self.manifests, self.registry)

    def test_manifest_is_part_of_identity(self):
        self.live(); self.add()["manifest"] = policy.MANIFESTS[1]
        self.assertEqual(len(policy.validate(self.manifests, self.registry)), 2)

    def test_all_target_manifests_are_required(self):
        del self.manifests[policy.MANIFESTS[1]]
        with self.assertRaisesRegex(policy.GovernanceError, "Missing or invalid"):
            policy.validate(self.manifests, self.registry)

    def test_unexpected_manifest_rejected(self):
        self.add()["manifest"] = "../elsewhere/package.json"
        with self.assertRaisesRegex(policy.GovernanceError, "unsupported manifest"):
            policy.validate(self.manifests, self.registry)

    def test_required_text_fields_rejected_when_blank(self):
        for field in policy.REQUIRED_TEXT:
            for value in [None, "", "  ", 123]:
                with self.subTest(field=field, value=value):
                    self.registry["exceptions"] = []; self.add()[field] = value
                    with self.assertRaises(policy.GovernanceError):
                        policy.validate(self.manifests, self.registry)

    def test_selector_validation(self):
        for value in [None, "leaf", [], [""], ["."], [1], [" leaf"]]:
            with self.subTest(value=value):
                self.registry["exceptions"] = []; self.add()["selector"] = value
                with self.assertRaises(policy.GovernanceError):
                    policy.validate(self.manifests, self.registry)

    def test_evidence_required(self):
        for value in [None, [], "url", [""]]:
            with self.subTest(value=value):
                self.registry["exceptions"] = []; self.add()["evidence"] = value
                with self.assertRaises(policy.GovernanceError):
                    policy.validate(self.manifests, self.registry)

    def test_unknown_category_rejected(self):
        self.add()["category"] = "dedupe"
        with self.assertRaises(policy.GovernanceError):
            policy.validate(self.manifests, self.registry)

    def test_invalid_registry_shape_rejected(self):
        for value in [None, [], {}, {"schema_version": True, "exceptions": []},
                      {"schema_version": 2, "exceptions": []},
                      {"schema_version": 1, "exceptions": {}}]:
            with self.subTest(value=value), self.assertRaises(policy.GovernanceError):
                policy.validate(self.manifests, value)

    def test_invalid_record_shape_rejected(self):
        self.registry["exceptions"] = [None]
        with self.assertRaises(policy.GovernanceError):
            policy.validate(self.manifests, self.registry)

    def test_invalid_override_shapes_rejected(self):
        for value in [None, [], "1", {"leaf": None}, {"leaf": {}},
                      {"leaf": " "}, {" leaf": "1"}, {".": "1"},
                      {"leaf": {".": {"other": "1"}}}]:
            with self.subTest(value=value), self.assertRaises(policy.GovernanceError):
                policy.flatten_overrides(value)

    def test_flatten_is_deterministic_and_keeps_selector_ranges(self):
        a = {"z": "2", "@scope/pkg@>=1 <2": {"b": "3", "a": "4"}}
        b = {key: deepcopy(a[key]) for key in reversed(a)}
        self.assertEqual(list(policy.flatten_overrides(a).items()), list(policy.flatten_overrides(b).items()))
        self.assertIn(("@scope/pkg@>=1 <2", "a"), policy.flatten_overrides(a))

    def test_self_override_uses_enclosing_path(self):
        self.assertEqual(policy.flatten_overrides({"parent": {".": "1", "child": "2"}}),
                         {("parent",): "1", ("parent", "child"): "2"})

    def test_references_are_preserved_exactly(self):
        self.assertEqual(policy.flatten_overrides({"leaf": "$direct"}), {("leaf",): "$direct"})

    def test_duplicate_json_keys_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "package.json"
            path.write_text('{"overrides":{"leaf":"1","leaf":"2"}}', encoding="utf-8")
            with self.assertRaisesRegex(policy.GovernanceError, "Duplicate JSON key"):
                policy.load_json(path)

    def test_missing_or_malformed_json_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "input.json"
            with self.assertRaises(policy.GovernanceError): policy.load_json(path)
            path.write_text("{", encoding="utf-8")
            with self.assertRaises(policy.GovernanceError): policy.load_json(path)

    def test_cli_pass_and_failure(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            for name in policy.MANIFESTS:
                path = root / name; path.parent.mkdir(parents=True); path.write_text("{}", encoding="utf-8")
            registry = root / policy.REGISTRY; registry.parent.mkdir(parents=True)
            registry.write_text(json.dumps(self.registry), encoding="utf-8")
            with redirect_stdout(io.StringIO()): self.assertEqual(policy.main(["--root", temp]), 0)
            registry.unlink()
            with redirect_stderr(io.StringIO()): self.assertEqual(policy.main(["--root", temp]), 1)


if __name__ == "__main__":
    unittest.main()
