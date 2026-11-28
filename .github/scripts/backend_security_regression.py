"""Run the security and architectural contract with mandatory zero-skip evidence."""

from __future__ import annotations

import os
from pathlib import Path

TARGETS = (
    "tests/security",
    "tests/architecture",
    "tests/test_authentication_session_contract.py",
    "tests/test_auth_email_links.py",
    "tests/test_security_primitives.py",
    "tests/test_customer_session_security_settings.py",
    "tests/test_database_schema.py",
)


class RequiredChecks:
    def __init__(self):
        self.skipped = 0
        self.executed = 0

    def pytest_collectreport(self, report):
        if report.skipped:
            self.skipped += 1

    def pytest_runtest_logreport(self, report):
        if report.skipped or getattr(report, "wasxfail", False):
            self.skipped += 1
        if report.when == "call":
            self.executed += 1


def main() -> int:
    import pytest

    if not os.environ.get("NOTEVERSE_TEST_PRACTICE_BUNDLE_POSTGRES_URL") or not os.environ.get(
        "NOTEVERSE_TEST_REDIS_URL"
    ):
        print("Security regression requires explicit real PostgreSQL and Redis test URLs")
        return 1
    os.chdir(Path(__file__).resolve().parents[2] / "backend")
    checks = RequiredChecks()
    result = pytest.main([*TARGETS, "-q", "-ra", "-p", "no:cacheprovider"], plugins=[checks])
    if checks.skipped or not checks.executed:
        print(
            f"Required security checks: {checks.executed} executed, {checks.skipped} skipped/xfail"
        )
        return 1
    return int(result)


if __name__ == "__main__":
    raise SystemExit(main())
