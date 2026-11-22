"""Architecture contracts for score authorization entry points."""

from __future__ import annotations

import ast
from pathlib import Path


BACKEND_ROOT = Path(__file__).resolve().parents[1]

# Individual Score/revision operations delegate to ScoreAccessPolicy. Personal
# Library batches use its shared SQL eligibility predicate; deletion batches
# validate the complete locked set against the owner-only lifecycle rule.
PROTECTED_SERVICE_MODULES = (
    "app/modules/fingering/service.py",
    "app/modules/metadata/service.py",
    "app/modules/playback/delivery.py",
    "app/modules/practice/bundle/service.py",
    "app/modules/practice/activities/service.py",
    "app/modules/revisions/service.py",
    "app/modules/score_assets/service.py",
    "app/modules/collaboration/invitation_service.py",
    "app/modules/collaboration/membership_service.py",
    "app/modules/guest_previews/service.py",
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
            violations.append(f"{relative_path} must import ScoreAccessPolicy")

    assert not violations, "Score access architecture violations:\n" + "\n".join(violations)


def test_guest_preview_dependencies_own_presentation_authorization_and_demand_provisioning() -> (
    None
):
    allowed_contexts = {
        "guest_previews",
        "score_access",
        "score_assets",
        "playback",
        "revisions",
        "storage_objects",
    }
    for path in (BACKEND_ROOT / "app/modules/guest_previews").glob("*.py"):
        tree = ast.parse(path.read_text(encoding="utf-8"))
        contexts = {
            node.module.split(".")[2]
            for node in ast.walk(tree)
            if isinstance(node, ast.ImportFrom)
            and node.module
            and node.module.startswith("app.modules.")
        }
        assert contexts <= allowed_contexts, (path.name, contexts)
        revision_dependencies = {
            node.module
            for node in ast.walk(tree)
            if isinstance(node, ast.ImportFrom)
            and node.module
            and node.module.startswith("app.modules.revisions.")
        }
        assert revision_dependencies <= {
            "app.modules.revisions.derived_asset_retention_service",
        }


def test_library_batch_resolution_consumes_shared_access_eligibility() -> None:
    path = BACKEND_ROOT / "app/modules/library/repository.py"
    tree = ast.parse(path.read_text(encoding="utf-8"))
    assert any(
        isinstance(node, ast.ImportFrom)
        and node.module == "app.modules.score_access.queries"
        and any(alias.name == "accessible_score_predicate" for alias in node.names)
        for node in ast.walk(tree)
    )
    resolver = next(
        node
        for node in ast.walk(tree)
        if isinstance(node, ast.FunctionDef) and node.name == "mutation_scores"
    )
    assert any(
        isinstance(node, ast.Call)
        and isinstance(node.func, ast.Name)
        and node.func.id == "accessible_score_predicate"
        for node in ast.walk(resolver)
    )


def test_score_batch_admission_has_a_caller_owned_transaction() -> None:
    path = BACKEND_ROOT / "app/modules/scores/lifecycle_service.py"
    tree = ast.parse(path.read_text(encoding="utf-8"))
    admission = next(
        node
        for node in ast.walk(tree)
        if isinstance(node, ast.FunctionDef) and node.name == "admit_deletions"
    )
    calls = {
        node.func.attr
        for node in ast.walk(admission)
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
    }
    assert "lock_active_deletion_set" in calls
    assert not calls & {"commit", "rollback", "send_task", "dispatch_best_effort"}
