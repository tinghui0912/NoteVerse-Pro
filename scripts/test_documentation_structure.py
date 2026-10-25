"""Deterministic structural policy tests; no application or network dependencies."""

from contextlib import redirect_stdout
from io import StringIO
from pathlib import Path
import subprocess
import sys
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

import check_documentation_structure as policy


class DocumentationStructureTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / "docs").mkdir()

    def write(self, name: str, text: str = "# Current contract\n") -> Path:
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")
        return path

    def test_current_reference_categories_pass(self) -> None:
        for name in (
            "product/behavior.md", "architecture/runtime.md", "adr/0007-model.md",
            "engineering/guides/testing.md", "operations/runbooks/recovery.md",
            "security/access-contract.md",
        ):
            self.write("docs/" + name)
        self.assertEqual(policy.find_violations(self.root), [])

    def test_each_prohibited_directory_fails_even_when_empty(self) -> None:
        for name in policy.PROHIBITED_DIRECTORIES:
            with self.subTest(directory=name):
                path = self.root / name
                path.mkdir(parents=True, exist_ok=True)
                self.assertTrue(any(name in v for v in policy.find_violations(self.root)))
                path.rmdir()

    def test_each_work_tracking_filename_fails_at_any_depth(self) -> None:
        for suffix in policy.WORK_TRACKING_SUFFIXES:
            with self.subTest(suffix=suffix):
                path = self.write("docs/architecture/nested/topic" + suffix)
                self.assertTrue(policy.find_violations(self.root))
                path.unlink()

    def test_migration_and_refactoring_plan_names_fail(self) -> None:
        self.write("docs/product/account-migration-plan.md")
        self.write("docs/architecture/editor-refactoring-plan.md")
        self.assertEqual(len(policy.find_violations(self.root)), 2)

    def test_filename_policy_is_case_insensitive(self) -> None:
        self.write("docs/architecture/Topic-ROADMAP.MD")
        self.assertEqual(len(policy.find_violations(self.root)), 1)

    def test_current_protocol_versions_and_runtime_terms_are_not_linted(self) -> None:
        self.write(
            "docs/operations/database-migrations.md",
            "# Database migrations\nAPI /v1; Python 3.12; SPDX-2.3.\n"
            "A migration phase may inspect legacy data and versioned protocols.\n",
        )
        self.assertEqual(policy.find_violations(self.root), [])

    def test_files_outside_docs_are_outside_filename_policy(self) -> None:
        self.write("backend/tests/example-audit.md")
        self.assertEqual(policy.find_violations(self.root), [])

    def test_result_is_sorted_and_read_only(self) -> None:
        paths = [self.write("docs/z-plan.md"), self.write("docs/a-ledger.md")]
        before = {p: p.read_bytes() for p in paths}
        violations = policy.find_violations(self.root)
        self.assertEqual(violations, sorted(violations))
        self.assertEqual({p: p.read_bytes() for p in paths}, before)

    def test_missing_docs_root_fails_closed(self) -> None:
        (self.root / "docs").rmdir()
        self.assertEqual(policy.find_violations(self.root), ["docs/: documentation root is missing"])

    def test_cli_success_and_failure(self) -> None:
        for invalid in (False, True):
            with self.subTest(invalid=invalid):
                if invalid:
                    self.write("docs/example-plan.md")
                output = StringIO()
                with patch.object(sys, "argv", ["check", "--root", str(self.root)]):
                    with redirect_stdout(output):
                        result = policy.main()
                self.assertEqual(result, int(invalid))
                self.assertIn("failed" if invalid else "OK", output.getvalue())

    def test_standalone_cli_has_failure_exit_status(self) -> None:
        self.write("docs/example-roadmap.md")
        result = subprocess.run(
            [sys.executable, str(Path(policy.__file__)), "--root", str(self.root)],
            check=False, capture_output=True, text=True,
        )
        self.assertEqual(result.returncode, 1)
        self.assertIn("example-roadmap.md", result.stdout)


if __name__ == "__main__":
    unittest.main()
