from __future__ import annotations

import ast
from pathlib import Path


BACKEND_ROOT = Path(__file__).resolve().parents[1]
WORKER_ROOT = BACKEND_ROOT / "app" / "worker"
TASKS_PATH = WORKER_ROOT / "tasks.py"


def test_worker_tasks_module_is_only_a_celery_registration_surface() -> None:
    tree = ast.parse(TASKS_PATH.read_text(encoding="utf-8"))
    violations: list[str] = []

    for node in tree.body:
        if not isinstance(node, ast.FunctionDef):
            continue
        body = _body_without_docstring(node)
        if len(body) != 1 or not _is_execute_return(body[0]):
            violations.append(node.name)

    assert not violations, (
        "Celery task entrypoints must only delegate to worker.execution handlers: "
        + ", ".join(violations)
    )


def test_worker_tasks_module_does_not_import_domain_or_database_services() -> None:
    tree = ast.parse(TASKS_PATH.read_text(encoding="utf-8"))
    violations: list[str] = []

    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                if _is_forbidden_tasks_import(alias.name):
                    violations.append(alias.name)
        elif isinstance(node, ast.ImportFrom) and node.module:
            if _is_forbidden_tasks_import(node.module):
                violations.append(node.module)

    assert not violations, (
        "app.worker.tasks must not import domain/database services directly: "
        + ", ".join(sorted(violations))
    )


def test_worker_execution_modules_do_not_import_task_entrypoints() -> None:
    violations: list[str] = []

    for path in (WORKER_ROOT / "execution").glob("*.py"):
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                for alias in node.names:
                    if alias.name == "app.worker.tasks":
                        violations.append(f"{path.name}: import {alias.name}")
            elif isinstance(node, ast.ImportFrom) and node.module == "app.worker.tasks":
                violations.append(f"{path.name}: from {node.module} import ...")

    assert not violations, (
        "worker.execution modules must not depend on Celery task entrypoints: "
        + "; ".join(violations)
    )


def test_worker_dispatch_modules_delegate_shared_producer_runtime() -> None:
    violations: list[str] = []

    for path in (WORKER_ROOT / "dispatch").glob("*.py"):
        if path.name in {"__init__.py", "runtime.py"}:
            continue
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if isinstance(node, ast.ImportFrom) and node.module in {
                "app.worker.celery_config",
                "app.core.background_tracing",
            }:
                violations.append(f"{path.name}: from {node.module} import ...")
            elif (
                isinstance(node, ast.Call)
                and isinstance(node.func, ast.Attribute)
                and node.func.attr == "send_task"
            ):
                violations.append(f"{path.name}: direct send_task call")

    assert not violations, (
        "worker.dispatch modules must delegate shared producer behavior to "
        "worker.dispatch.runtime: " + "; ".join(violations)
    )


def _body_without_docstring(node: ast.FunctionDef) -> list[ast.stmt]:
    body = list(node.body)
    if (
        body
        and isinstance(body[0], ast.Expr)
        and isinstance(body[0].value, ast.Constant)
        and isinstance(body[0].value.value, str)
    ):
        return body[1:]
    return body


def _is_execute_return(node: ast.stmt) -> bool:
    if not isinstance(node, ast.Return):
        return False
    value = node.value
    if not isinstance(value, ast.Call):
        return False
    return isinstance(value.func, ast.Name) and value.func.id.startswith("execute_")


def _is_forbidden_tasks_import(module: str) -> bool:
    if module == "app.modules.import_jobs.schemas":
        return False
    return module.startswith("app.db") or module.startswith("app.modules")
