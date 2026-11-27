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
    assert {"PerformanceTake"} <= {
        call.func.id for call in calls(writer) if isinstance(call.func, ast.Name)
    }


def test_physical_verification_and_business_commands_have_distinct_owners():
    for name in (
        "finalization.py",
        "writer.py",
        "upload_reservation/reservation_service.py",
        "upload_reservation/recovery.py",
        "upload_reservation/cleanup.py",
    ):
        assert not any(
            isinstance(call.func, ast.Attribute)
            and call.func.attr in {"put_bytes", "copy", "generate_put_upload_url", "delete"}
            for call in calls(MODULE / name)
        )
    assert "app.modules.media_storage.upload_sessions.service" in dependencies(MODULE / "writer.py")


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
    assert {
        "prepare_adoption",
        "adopt",
        "commit",
        "recover_known_failure",
        "recover_unknown_commit",
    } <= attributes
    assert (
        not {"authorize_bundle_for_save", "resolve_practice_score_plan", "object_to_row"}
        & attributes
    )


def test_semantic_commit_exception_boundary_reconciles_independently():
    tree = ast.parse((MODULE / "finalization.py").read_text())
    service = next(
        node
        for node in tree.body
        if isinstance(node, ast.ClassDef) and node.name == "PerformanceTakeFinalizationService"
    )
    finalize = next(
        node
        for node in service.body
        if isinstance(node, ast.FunctionDef) and node.name == "finalize_take"
    )
    boundary = next(
        node
        for node in finalize.body
        if isinstance(node, ast.Try)
        and len(node.body) == 1
        and isinstance(node.body[0], ast.Expr)
        and isinstance(node.body[0].value, ast.Call)
        and ast.unparse(node.body[0].value.func) == "db.commit"
    )
    assert len(boundary.handlers) == 1
    assert ast.unparse(boundary.handlers[0].type) == "BaseException"
    handler_calls = [node for node in ast.walk(boundary.handlers[0]) if isinstance(node, ast.Call)]
    names = {ast.unparse(node.func) for node in handler_calls}
    assert "self._reconcile_unknown_commit" in names
    assert "is_transient_db_disconnect" not in names
    assert not {"self.recovery.recover", "self.recovery.recover_known_failure"} & names
    for call in calls(MODULE / "finalization.py"):
        assert not any(keyword.arg == "unknown_outcome" for keyword in call.keywords)
    recovery_tree = ast.parse((MODULE / "upload_reservation/recovery.py").read_text())
    fresh = next(
        node
        for node in ast.walk(recovery_tree)
        if isinstance(node, ast.FunctionDef) and node.name == "recover_unknown_commit"
    )
    assert not any(arg.arg == "db" for arg in fresh.args.args + fresh.args.kwonlyargs)
    assert any(
        isinstance(node, ast.With)
        and any(
            isinstance(item.context_expr, ast.Call)
            and ast.unparse(item.context_expr.func) == "self.sessions"
            for item in node.items
        )
        for node in ast.walk(fresh)
    )
