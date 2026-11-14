"""Current Take lifecycle transaction and dependency owners."""

import ast
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / "app"
MODULE = ROOT / "modules/performance_takes"


def calls(path):
    return [node for node in ast.walk(ast.parse(path.read_text())) if isinstance(node, ast.Call)]


def dependencies(path):
    return {
        node.module or ""
        for node in ast.walk(ast.parse(path.read_text()))
        if isinstance(node, ast.ImportFrom)
    }


def test_take_semantic_construction_has_one_transaction_participant():
    constructors = [
        path
        for path in ROOT.rglob("*.py")
        for call in calls(path)
        if isinstance(call.func, ast.Name) and call.func.id == "PerformanceTake"
    ]
    assert constructors == [MODULE / "writer.py"]
    writer = MODULE / "writer.py"
    assert not any(name.startswith("app.storage") for name in dependencies(writer))
    assert not {
        call.func.attr for call in calls(writer) if isinstance(call.func, ast.Attribute)
    } & {"commit", "rollback", "copy", "delete", "upload_url", "download_url"}
    assert {"object_to_row", "PerformanceTake"} <= {
        call.func.id for call in calls(writer) if isinstance(call.func, ast.Name)
    }


def test_physical_verifier_and_reservation_commands_have_distinct_dependencies():
    assert not any(
        name.startswith(("sqlalchemy", "app.db"))
        for name in dependencies(MODULE / "final_media.py")
    )
    assert not any(
        name.endswith(("final_media", "writer", "finalization"))
        for name in dependencies(MODULE / "upload_reservation/reservation_service.py")
    )
    for name in [
        "final_media.py",
        "finalization.py",
        "writer.py",
        "upload_reservation/reservation_service.py",
        "upload_reservation/recovery.py",
    ]:
        assert not any(
            isinstance(call.func, ast.Attribute) and call.func.attr == "delete"
            for call in calls(MODULE / name)
        )
    assert any(
        isinstance(call.func, ast.Attribute) and call.func.attr == "delete"
        for call in calls(MODULE / "upload_reservation/cleanup.py")
    )


def test_repository_is_a_transaction_participant():
    tree = ast.parse((MODULE / "repository.py").read_text())
    assert not any(
        isinstance(node, ast.arg) and node.arg == "auto_commit" for node in ast.walk(tree)
    )
    assert not any(
        isinstance(node, ast.Call)
        and isinstance(node.func, ast.Attribute)
        and node.func.attr in {"commit", "rollback"}
        for node in ast.walk(tree)
    )


def test_finalization_orchestrates_verification_writer_and_outer_commit():
    attributes = {
        call.func.attr
        for call in calls(MODULE / "finalization.py")
        if isinstance(call.func, ast.Attribute)
    }
    assert {"verify", "adopt", "commit", "recover", "after_disconnect"} <= attributes
    assert (
        not {"authorize_bundle_for_save", "resolve_practice_score_plan", "object_to_row"}
        & attributes
    )
