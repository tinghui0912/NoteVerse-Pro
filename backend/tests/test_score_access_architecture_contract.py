"""Architecture contracts for score authorization entry points."""

from __future__ import annotations

import ast
from pathlib import Path


BACKEND_ROOT = Path(__file__).resolve().parents[1]

# These services accept a caller identity and act on an existing score or one
# of its revisions. Authorization must be delegated to ScoreAccessPolicy rather
# than reconstructed from owner, membership, grant, or publication tables.
PROTECTED_SERVICE_MODULES = (
    "app/modules/fingering/service.py",
    "app/modules/library/service.py",
    "app/modules/metadata/service.py",
    "app/modules/playback/delivery.py",
    "app/modules/practice/service.py",
    "app/modules/publications/service.py",
    "app/modules/revisions/service.py",
    "app/modules/score_assets/render_service.py",
    "app/modules/score_assets/service.py",
    "app/modules/score_invites/service.py",
    "app/modules/score_sharing/service.py",
    "app/modules/scores/lifecycle_service.py",
    "app/modules/scores/service.py",
)


def _imports_score_access_policy(tree: ast.Module) -> bool:
    for node in ast.walk(tree):
        if not isinstance(node, ast.ImportFrom):
            continue
        if node.module != "app.modules.score_access.policy":
            continue
        if any(alias.name == "ScoreAccessPolicy" for alias in node.names):
            return True
    return False


def test_score_authorization_services_depend_on_the_central_policy() -> None:
    """Prevent a new score-facing service from silently owning authorization.

    The allowlist is deliberately explicit. It documents the current protected
    entry points without forbidding legitimate ownership, notification, or
    repository queries that also read score-related tables.
    """

    violations: list[str] = []
    for relative_path in PROTECTED_SERVICE_MODULES:
        path = BACKEND_ROOT / relative_path
        tree = ast.parse(path.read_text(encoding="utf-8-sig"), filename=str(path))
        if not _imports_score_access_policy(tree):
            violations.append(
                f"{relative_path} must import ScoreAccessPolicy")

    assert not violations, "Score access architecture violations:\n" + "\n".join(violations)
