"""Deterministic policy and shallow-Git range tests; no GitHub/network required."""

from copy import deepcopy
import io
import json
import re
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import Mock, patch
from urllib.error import HTTPError
import zipfile

import customer_web_ci_policy as policy


BASE, HEAD, MERGE, TREE = (c * 40 for c in "abcd")
REPOSITORY = "owner/repo"


def trusted_evidence():
    return {
        "commit": {"sha": MERGE, "parents": [{"sha": BASE}, {"sha": HEAD}], "tree": {"sha": TREE}},
        "merged_prs": [{
            "number": 42, "state": "closed", "merged": True,
            "merge_commit_sha": MERGE, "merged_at": "2026-10-21T12:00:00Z",
            "base": {"sha": BASE, "ref": "main", "repo": {"full_name": REPOSITORY}},
            "head": {"sha": HEAD},
        }],
        "reviewed_commit": {"sha": HEAD, "tree": {"sha": TREE}},
        "changed_paths": ["apps/customer-web/src/page.tsx"],
        "quality_runs": [{
            "id": 123, "run_attempt": 1, "name": "Customer Web Quality", "path": policy.QUALITY_WORKFLOW,
            "event": "pull_request", "head_sha": HEAD, "status": "completed", "conclusion": "success",
            "updated_at": "2026-10-21T11:59:59Z", "pull_requests": [],
            "pr_proof": {"repository": REPOSITORY, "pr_number": 42,
                         "base_sha": BASE, "head_sha": HEAD, "run_id": 123, "run_attempt": 1},
        }],
    }


class QualityReuseTests(unittest.TestCase):
    def setUp(self):
        self.evidence = trusted_evidence()

    def decision(self, **kwargs):
        return policy.quality_reuse(kwargs.get("event", "push"), kwargs.get("ref", "refs/heads/main"),
                                    MERGE, REPOSITORY, self.evidence)

    def denied(self):
        self.assertFalse(self.decision().reuse_pr_quality)

    def test_normal_exact_pr_merge_and_identical_tree_reuses_success(self):
        result = self.decision()
        self.assertTrue(result.reuse_pr_quality)
        self.assertEqual((result.pr_number, result.run_id, result.tree_sha), (42, 123, TREE))

    def test_pr_events_always_run_full_quality(self):
        self.assertFalse(self.decision(event="pull_request").reuse_pr_quality)

    def test_non_main_push_runs_full_quality(self):
        self.assertFalse(self.decision(ref="refs/heads/feature").reuse_pr_quality)

    def test_direct_one_parent_push_is_denied(self):
        self.evidence["commit"]["parents"] = [{"sha": BASE}]
        self.denied()

    def test_octopus_merge_is_denied(self):
        self.evidence["commit"]["parents"].append({"sha": TREE})
        self.denied()

    def test_parent_one_must_equal_pr_base(self):
        self.evidence["commit"]["parents"][0]["sha"] = TREE
        self.denied()

    def test_parent_two_must_equal_pr_head(self):
        self.evidence["commit"]["parents"][1]["sha"] = TREE
        self.denied()

    def test_tree_mismatch_denies_reuse(self):
        self.evidence["reviewed_commit"]["tree"]["sha"] = BASE
        self.denied()

    def test_missing_quality_denies_reuse(self):
        self.evidence["quality_runs"] = []
        self.denied()

    def test_failed_cancelled_or_running_quality_denies_reuse(self):
        for status, conclusion in [("completed", "failure"), ("completed", "cancelled"), ("in_progress", None)]:
            with self.subTest(status=status, conclusion=conclusion):
                self.evidence["quality_runs"][0].update(status=status, conclusion=conclusion)
                self.denied()

    def test_successful_quality_for_wrong_head_is_denied(self):
        self.evidence["quality_runs"][0]["head_sha"] = BASE
        self.denied()

    def test_successful_quality_for_wrong_pr_is_denied_even_with_same_head(self):
        self.evidence["quality_runs"][0]["pr_proof"]["pr_number"] = 43
        self.denied()

    def test_missing_proof_cannot_infer_pr_identity_from_head(self):
        del self.evidence["quality_runs"][0]["pr_proof"]
        self.denied()

    def test_proof_is_bound_to_repository_run_and_attempt(self):
        for field, value in [("repository", "other/repo"), ("run_id", 124), ("run_attempt", 2),
                             ("head_sha", TREE), ("base_sha", TREE)]:
            with self.subTest(field=field):
                self.evidence = trusted_evidence()
                self.evidence["quality_runs"][0]["pr_proof"][field] = value
                self.denied()

    def test_wrong_workflow_or_event_cannot_supply_proof(self):
        for field, value in [("path", policy.IMAGE_WORKFLOW), ("name", "Other Quality"), ("event", "push")]:
            with self.subTest(field=field):
                self.evidence = trusted_evidence()
                self.evidence["quality_runs"][0][field] = value
                self.denied()

    def test_quality_must_be_terminal_strictly_before_merge(self):
        for timestamp in ["2026-10-21T12:00:00Z", "2026-10-21T12:00:01Z", "not-a-date", "2026-10-21T11:00:00"]:
            with self.subTest(timestamp=timestamp):
                self.evidence["quality_runs"][0]["updated_at"] = timestamp
                self.denied()

    def test_quality_workflow_changes_cannot_self_certify(self):
        self.evidence["changed_paths"].append(policy.QUALITY_WORKFLOW)
        self.denied()

    def test_policy_implementation_and_tests_cannot_self_certify(self):
        for path in policy.POLICY_PATHS:
            with self.subTest(path=path):
                self.evidence["changed_paths"] = [path]
                self.denied()

    def test_ambiguous_or_missing_merged_pr_is_denied(self):
        for prs in [[], self.evidence["merged_prs"] * 2]:
            with self.subTest(prs=prs):
                self.evidence["merged_prs"] = prs
                self.denied()

    def test_pr_must_be_merged_into_this_repository_main_at_this_commit(self):
        changes = [lambda p: p.update(state="open"), lambda p: p.update(merged=False),
                   lambda p: p.update(merge_commit_sha=HEAD),
                   lambda p: p["base"].update(ref="other"),
                   lambda p: p["base"]["repo"].update(full_name="other/repo")]
        for change in changes:
            self.evidence = trusted_evidence()
            change(self.evidence["merged_prs"][0])
            self.denied()

    def test_missing_or_malformed_metadata_denies_reuse(self):
        for key in trusted_evidence():
            with self.subTest(missing=key):
                self.evidence = trusted_evidence()
                del self.evidence[key]
                self.denied()
        self.evidence = {"commit": None}
        self.denied()

    def test_evidence_error_denies_reuse(self):
        self.evidence["error"] = "API unavailable"
        self.denied()

    def test_api_permission_parsing_and_graph_errors_fall_back_to_full(self):
        env = {"GITHUB_EVENT_NAME": "push", "GITHUB_REF": "refs/heads/main",
               "GITHUB_SHA": MERGE, "GITHUB_REPOSITORY": REPOSITORY, "GH_TOKEN": "test"}
        for error in [PermissionError(), TimeoutError(), ValueError(), KeyError()]:
            with self.subTest(error=type(error).__name__):
                with patch.object(policy, "collect_quality_evidence", side_effect=error):
                    self.assertFalse(policy.quality_from_environment(env, lambda *_: object()).reuse_pr_quality)

    def test_pr_never_needs_api_credentials(self):
        self.assertFalse(policy.quality_from_environment({"GITHUB_EVENT_NAME": "pull_request"},
                                                        lambda *_: self.fail("API must not run")).reuse_pr_quality)

    def test_pr_proof_uses_event_head_not_synthetic_checkout_sha(self):
        env = {"GITHUB_EVENT_NAME": "pull_request", "GITHUB_REPOSITORY": REPOSITORY,
               "GITHUB_SHA": MERGE, "GITHUB_RUN_ID": "123", "GITHUB_RUN_ATTEMPT": "1"}
        proof = policy.pr_proof(env, {"pull_request": trusted_evidence()["merged_prs"][0]})
        self.assertEqual(proof, self.evidence["quality_runs"][0]["pr_proof"])


class ImagePolicyTests(unittest.TestCase):
    def assert_no_image(self, event, paths):
        self.assertEqual(policy.image_policy(event, paths),
                         {"runtime_changed": False, "pr_image_validation_required": False,
                          "image_pipeline_required": False})

    def assert_full_image(self, event, paths):
        self.assertEqual(policy.image_policy(event, paths),
                         {"runtime_changed": True, "pr_image_validation_required": True,
                          "image_pipeline_required": True})

    def test_quality_workflow_alone_skips_pr_image(self):
        self.assert_no_image("pull_request", [policy.QUALITY_WORKFLOW])

    def test_policy_implementation_alone_skips_pr_image(self):
        self.assert_no_image("pull_request", [".github/scripts/customer_web_ci_policy.py"])

    def test_policy_tests_alone_skip_pr_image(self):
        self.assert_no_image("pull_request", [".github/scripts/test_customer_web_ci_policy.py"])

    def test_quality_workflow_alone_skips_main_image(self):
        self.assert_no_image("push", [policy.QUALITY_WORKFLOW])

    def test_policy_implementation_alone_skips_main_image(self):
        self.assert_no_image("push", [".github/scripts/customer_web_ci_policy.py"])

    def test_policy_tests_alone_skip_main_image(self):
        self.assert_no_image("push", [".github/scripts/test_customer_web_ci_policy.py"])

    def test_combined_ci_trust_paths_still_skip_image(self):
        for event in ["pull_request", "push"]:
            with self.subTest(event=event):
                self.assert_no_image(event, [policy.QUALITY_WORKFLOW, *sorted(policy.POLICY_PATHS)])

    def test_ci_trust_paths_are_not_image_content(self):
        for path in [policy.QUALITY_WORKFLOW, *sorted(policy.POLICY_PATHS)]:
            with self.subTest(path=path):
                self.assertIn(path, policy.IMAGE_POLICY_TRUST_PATHS)
                self.assertNotIn(path, policy.IMAGE_INPUTS)
                self.assertFalse(policy.runtime_relevant(path))
                self.assertFalse(policy.image_risk(path))

    def test_quality_workflow_with_source_cannot_use_source_only_fast_path(self):
        self.assert_full_image("pull_request", [policy.QUALITY_WORKFLOW,
                                                "apps/customer-web/src/page.tsx"])

    def test_policy_implementation_with_source_requires_full_pr_image(self):
        self.assert_full_image("pull_request", [".github/scripts/customer_web_ci_policy.py",
                                                "apps/customer-web/src/page.tsx"])

    def test_policy_tests_with_source_require_full_pr_image(self):
        self.assert_full_image("pull_request", [".github/scripts/test_customer_web_ci_policy.py",
                                                "apps/customer-web/src/page.tsx"])

    def test_ci_trust_paths_with_source_publish_on_main(self):
        for path in [policy.QUALITY_WORKFLOW, *sorted(policy.POLICY_PATHS)]:
            with self.subTest(path=path):
                self.assert_full_image("push", [path, "apps/customer-web/src/page.tsx"])

    def test_ci_trust_paths_with_only_tests_still_skip_image(self):
        for event in ["pull_request", "push"]:
            for path in [policy.QUALITY_WORKFLOW, *sorted(policy.POLICY_PATHS)]:
                with self.subTest(event=event, path=path):
                    self.assert_no_image(event, [path, "apps/customer-web/src/foo.test.tsx",
                                                 "apps/customer-web/tests/fixtures/foo.musicxml"])

    def test_source_only_pr_skips_image_but_is_runtime_relevant(self):
        self.assertEqual(policy.image_policy("pull_request", ["apps/customer-web/src/page.tsx"]),
                         {"runtime_changed": True, "pr_image_validation_required": False,
                          "image_pipeline_required": False})

    def test_test_files_support_and_fixtures_are_not_runtime_relevant(self):
        for path in ["apps/customer-web/src/foo.test.ts", "apps/customer-web/src/foo.test.tsx",
                     "apps/customer-web/src/foo.spec.ts", "apps/customer-web/tests/e2e/foo.spec.ts",
                     "apps/customer-web/tests/e2e/support/helper.ts", "apps/customer-web/tests/fixtures/foo.musicxml"]:
            with self.subTest(path=path):
                self.assert_no_image("pull_request", [path])

    def test_image_risk_prs_run_full_image_pipeline(self):
        inputs = {".dockerignore", policy.IMAGE_WORKFLOW,
                  "apps/customer-web/package.json", "apps/customer-web/package-lock.json",
                  "apps/customer-web/next.config.ts", "apps/customer-web/.npmrc",
                  "apps/customer-web/npm-shrinkwrap.json"}
        self.assertEqual(policy.IMAGE_INPUTS, inputs)
        for path in inputs | {"docker/customer-web/Dockerfile.runtime",
                              "docker/customer-web/support/config.txt"}:
            with self.subTest(path=path):
                self.assert_full_image("pull_request", [path])

    def test_image_workflow_alone_requires_full_pr_image(self):
        self.assert_full_image("pull_request", [policy.IMAGE_WORKFLOW])

    def test_image_risk_with_ci_trust_paths_still_requires_full_pr_image(self):
        for path in [policy.QUALITY_WORKFLOW, *sorted(policy.POLICY_PATHS)]:
            with self.subTest(path=path):
                self.assert_full_image("pull_request", [path, "apps/customer-web/package-lock.json"])

    def test_conservative_runtime_inputs_remain_runtime_relevant(self):
        for path in ["public/example.svg", "messages/en/practice.json", "tsconfig.json",
                     "postcss.config.mjs", "vitest.config.mts", "playwright.config.ts", "README.md", "knip.json"]:
            with self.subTest(path=path):
                self.assertTrue(policy.image_policy("pull_request", ["apps/customer-web/" + path])["runtime_changed"])

    def test_mixed_source_and_tests_remains_runtime_relevant(self):
        result = policy.image_policy("pull_request", ["apps/customer-web/src/page.tsx", "apps/customer-web/src/foo.test.ts"])
        self.assertEqual(result, {"runtime_changed": True, "pr_image_validation_required": False,
                                  "image_pipeline_required": False})

    def test_main_source_push_requires_full_publish_pipeline(self):
        self.assertEqual(policy.image_policy("push", ["apps/customer-web/src/page.tsx"]),
                         {"runtime_changed": True, "pr_image_validation_required": False,
                          "image_pipeline_required": True})

    def test_main_test_only_push_still_skips_image(self):
        self.assert_no_image("push", ["apps/customer-web/tests/helper.ts"])

    def test_dispatch_always_requires_full_image(self):
        for paths in [[], [policy.QUALITY_WORKFLOW], sorted(policy.POLICY_PATHS),
                      ["apps/customer-web/tests/helper.ts"]]:
            with self.subTest(paths=paths):
                result = policy.image_policy("workflow_dispatch", paths)
                self.assertTrue(result["runtime_changed"])
                self.assertTrue(result["image_pipeline_required"])

    def test_empty_pr_and_push_ranges_skip_image(self):
        for event in ["pull_request", "push"]:
            with self.subTest(event=event):
                self.assert_no_image(event, [])

    def test_backend_and_unrelated_workflow_are_not_customer_runtime(self):
        self.assertFalse(policy.runtime_relevant("backend/app/main.py"))
        self.assertFalse(policy.runtime_relevant(".github/workflows/backend-quality.yml"))


class EvidenceIOTests(unittest.TestCase):
    def test_api_pagination_preserves_complete_evidence(self):
        api = policy.GitHubEvidence(REPOSITORY, "not-a-real-token")
        api.get = Mock(side_effect=[list(range(100)), [100]])
        self.assertEqual(api.pages("/pulls"), list(range(101)))
        self.assertIn("page=2", api.get.call_args.args[0])

    def test_oversized_pagination_falls_back_instead_of_truncating(self):
        api = policy.GitHubEvidence(REPOSITORY, "not-a-real-token")
        api.get = Mock(return_value=list(range(100)))
        with self.assertRaisesRegex(ValueError, "pagination"):
            api.pages("/pulls")

    def test_incomplete_paginated_pr_file_list_is_an_error(self):
        class API:
            def get(self, path):
                if path.startswith("/git/commits/"):
                    return trusted_evidence()["commit"]
                return {**trusted_evidence()["merged_prs"][0], "changed_files": 2}

            def pages(self, path, key=None):
                if path.endswith("/pulls"):
                    return trusted_evidence()["merged_prs"]
                return [{"filename": "apps/customer-web/src/page.tsx"}]

        with self.assertRaisesRegex(ValueError, "Incomplete PR file list"):
            policy.collect_quality_evidence(API(), MERGE)

    def test_renamed_policy_original_path_prevents_self_certification(self):
        evidence = trusted_evidence()

        class API:
            def get(self, path):
                if path == f"/git/commits/{MERGE}":
                    return evidence["commit"]
                if path == f"/git/commits/{HEAD}":
                    return evidence["reviewed_commit"]
                return {**evidence["merged_prs"][0], "changed_files": 1}

            def pages(self, path, key=None):
                if path.endswith("/pulls"):
                    return evidence["merged_prs"]
                if path.endswith("/files"):
                    return [{"filename": "elsewhere.py", "previous_filename": next(iter(policy.POLICY_PATHS))}]
                return deepcopy(evidence["quality_runs"])

            def proof(self, run):
                return run["pr_proof"]

        collected = policy.collect_quality_evidence(API(), MERGE)
        self.assertFalse(policy.quality_reuse("push", "refs/heads/main", MERGE, REPOSITORY, collected).reuse_pr_quality)


class ProofArtifactTests(unittest.TestCase):
    def setUp(self):
        self.run = trusted_evidence()["quality_runs"][0]
        self.api = policy.GitHubEvidence(REPOSITORY, "test-secret")
        self.artifact = {"id": 456, "name": "customer-web-quality-proof-123-1", "expired": False,
                         "workflow_run": {"id": 123}}
        self.api.pages = Mock(return_value=[self.artifact])
        data = io.BytesIO()
        with zipfile.ZipFile(data, "w") as archive:
            archive.writestr("quality-proof.json", json.dumps(self.run["pr_proof"]))
        self.archive = data.getvalue()

    def test_reads_proof_only_from_exact_run_attempt_artifact(self):
        opener = Mock()
        opener.open.return_value = io.BytesIO(self.archive)
        with patch.object(policy, "build_opener", return_value=opener):
            self.assertEqual(self.api.proof(self.run), self.run["pr_proof"])
        self.assertIn("customer-web-quality-proof-123-1", self.api.pages.call_args.args[0])

    def test_missing_expired_or_duplicate_artifacts_cannot_prove_identity(self):
        for artifacts in [[], [{**self.artifact, "expired": True}], [self.artifact, self.artifact]]:
            self.api.pages.return_value = artifacts
            self.assertIsNone(self.api.proof(self.run))

    def test_artifact_from_different_run_is_rejected(self):
        self.artifact["workflow_run"]["id"] = 999
        with self.assertRaisesRegex(ValueError, "another run"):
            self.api.proof(self.run)

    def test_download_redirect_does_not_forward_github_authorization(self):
        opener = Mock()
        opener.open.side_effect = HTTPError("https://api.github.com/artifact", 302, "redirect",
                                            {"Location": "https://storage.example.invalid/signed"}, None)
        with patch.object(policy, "build_opener", return_value=opener), \
                patch.object(policy, "urlopen", return_value=io.BytesIO(self.archive)) as download:
            self.assertEqual(self.api.proof(self.run), self.run["pr_proof"])
        self.assertEqual(download.call_args.args, ("https://storage.example.invalid/signed",))
        self.assertEqual(download.call_args.kwargs, {"timeout": 20})

    def test_insecure_download_redirect_is_rejected(self):
        opener = Mock()
        opener.open.side_effect = HTTPError("https://api.github.com/artifact", 302, "redirect",
                                            {"Location": "http://storage.example.invalid/signed"}, None)
        with patch.object(policy, "build_opener", return_value=opener):
            with self.assertRaisesRegex(ValueError, "Insecure"):
                self.api.proof(self.run)


class GitRangeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.repo = self.root / "origin"
        self.repo.mkdir()
        self.git("init", "-b", "main")
        self.git("config", "user.email", "ci-policy@example.invalid")
        self.git("config", "user.name", "CI policy test")
        self.write("apps/customer-web/src/original.ts", "original")
        self.base = self.commit("base")

    def git(self, *args):
        return subprocess.check_output(["git", "-C", str(self.repo), *args], stderr=subprocess.DEVNULL).decode().strip()

    def write(self, path, content):
        target = self.repo / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content)

    def commit(self, message):
        self.git("add", ".")
        self.git("commit", "-m", message)
        return self.git("rev-parse", "HEAD")

    def changed(self, event, payload, sha, repo=None):
        original = Path.cwd()
        try:
            import os
            os.chdir(repo or self.repo)
            return policy.changed_paths(event, payload, sha)[0]
        finally:
            os.chdir(original)

    def test_push_includes_all_commits_in_before_to_sha_range(self):
        self.write("apps/customer-web/src/later.ts", "runtime")
        self.commit("runtime")
        self.write("apps/customer-web/tests/test.ts", "test")
        head = self.commit("test")
        paths = self.changed("push", {"before": self.base}, head)
        self.assertEqual(set(paths), {"apps/customer-web/src/later.ts", "apps/customer-web/tests/test.ts"})
        self.assertTrue(policy.image_policy("push", paths)["image_pipeline_required"])

    def test_rename_to_test_exposes_deleted_runtime_path(self):
        self.git("mv", "apps/customer-web/src/original.ts", "apps/customer-web/src/original.test.ts")
        head = self.commit("rename")
        paths = self.changed("push", {"before": self.base}, head)
        self.assertEqual(set(paths), {"apps/customer-web/src/original.ts", "apps/customer-web/src/original.test.ts"})
        self.assertTrue(policy.image_policy("push", paths)["runtime_changed"])

    def test_all_zero_before_uses_empty_tree(self):
        paths = self.changed("push", {"before": "0" * 40}, self.base)
        self.assertEqual(paths, ["apps/customer-web/src/original.ts"])

    def test_shallow_pr_diff_uses_merge_base_and_all_pr_commits(self):
        self.git("checkout", "-b", "feature")
        self.write("apps/customer-web/src/feature.tsx", "source")
        self.commit("first PR commit")
        self.write("apps/customer-web/src/feature.test.tsx", "test")
        head = self.commit("second PR commit")
        self.git("checkout", "main")
        self.write("apps/customer-web/src/base-only.ts", "base advance")
        base = self.commit("base advanced independently")
        clone = self.root / "shallow"
        subprocess.check_call(["git", "clone", "--quiet", "--depth=1", "--branch", "feature",
                               self.repo.as_uri(), str(clone)])
        paths = self.changed("pull_request", {"pull_request": {"base": {"sha": base}, "head": {"sha": head}}}, head, clone)
        self.assertEqual(set(paths), {"apps/customer-web/src/feature.tsx", "apps/customer-web/src/feature.test.tsx"})


class RecordingMediaWorkflowTests(unittest.TestCase):
    def test_both_quality_workflows_select_policy_and_generator_changes(self):
        root = Path(__file__).resolve().parents[2]
        for name in ['backend-quality.yml', 'customer-web-quality.yml']:
            text = (root / '.github/workflows' / name).read_text(encoding='utf-8')
            triggers = text.split('jobs:', 1)[0]
            for event in ['push', 'pull_request']:
                block = re.search(r'^  ' + event + r':\n(.*?)(?=^  [a-z_]+:|^\S|\Z)', triggers, re.M | re.S)
                self.assertIsNotNone(block)
                for path in ['contracts/practice/recording-media-policy.json', 'scripts/generate_practice_recording_media_policy.py']:
                    self.assertIn('      - "' + path + '"', block.group(1))

    def test_customer_policy_check_runs_from_root_before_quality_reuse_and_types(self):
        root = Path(__file__).resolve().parents[2]
        text = (root / '.github/workflows/customer-web-quality.yml').read_text(encoding='utf-8')
        block = next(part for part in text.split('      - name: ') if 'run: python3 scripts/generate_practice_recording_media_policy.py --check' in part)
        self.assertIn('working-directory: .', block)
        self.assertNotIn('        if:', block)
        self.assertLess(text.index(block), text.index('      - name: Verify reusable PR Quality proof'))
        self.assertLess(text.index(block), text.index('      - name: Run TypeScript checks'))

    def test_backend_checks_recording_policy_with_practice_projections_from_root(self):
        root = Path(__file__).resolve().parents[2]
        text = (root / '.github/workflows/backend-quality.yml').read_text(encoding='utf-8')
        block = next(part for part in text.split('      - name: ') if 'python scripts/generate_practice_recording_media_policy.py --check' in part)
        self.assertIn('cd /repo &&', block)
        self.assertIn('python scripts/generate_practice_score_contract.py --check', block)


if __name__ == "__main__":
    unittest.main()
