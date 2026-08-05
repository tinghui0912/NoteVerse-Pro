from __future__ import annotations

import ast
from pathlib import Path

from app.core.logger import StructuredLogFieldPolicy, json_format


APP_ROOT = Path(__file__).resolve().parents[1] / "app"
LOGGER_METHODS = {"debug", "info", "warning", "error", "exception", "critical"}


class LoggingContractVisitor(ast.NodeVisitor):
    def __init__(self, path: Path) -> None:
        self.path = path
        self.violations: list[str] = []

    def visit_ImportFrom(self, node: ast.ImportFrom) -> None:  # noqa: N802
        if node.module == "celery.utils.log":
            imported_names = {alias.name for alias in node.names}
            if "get_task_logger" in imported_names:
                self._add_violation(
                    node,
                    "use app.core.logger.logger instead of celery.utils.log.get_task_logger",
                )
        self.generic_visit(node)

    def visit_Call(self, node: ast.Call) -> None:  # noqa: N802
        if isinstance(node.func, ast.Attribute):
            method_name = node.func.attr
            if method_name in LOGGER_METHODS:
                self._check_logger_call(node, method_name)
            if self._is_logging_get_logger_call(node):
                self._check_logging_get_logger_call(node)
        self.generic_visit(node)

    def _check_logger_call(self, node: ast.Call, method_name: str) -> None:
        if node.args and isinstance(node.args[0], ast.JoinedStr):
            self._add_violation(
                node,
                f"avoid f-string logger.{method_name}(...) messages; bind fields instead",
            )
        if method_name == "exception" and any(keyword.arg == "extra" for keyword in node.keywords):
            self._add_violation(
                node,
                "avoid logger.exception(..., extra=...); use logger.bind(...).opt(exception=True)",
            )

    @staticmethod
    def _is_logging_get_logger_call(node: ast.Call) -> bool:
        func = node.func
        return (
            isinstance(func, ast.Attribute)
            and func.attr == "getLogger"
            and isinstance(func.value, ast.Name)
            and func.value.id == "logging"
        )

    def _check_logging_get_logger_call(self, node: ast.Call) -> None:
        allowed = APP_ROOT / "core" / "logging_setup.py"
        if self.path != allowed:
            self._add_violation(
                node,
                "application modules should use app.core.logger.logger, not logging.getLogger",
            )

    def _add_violation(self, node: ast.AST, message: str) -> None:
        relative_path = self.path.relative_to(APP_ROOT.parent)
        line_number = getattr(node, "lineno", 0)
        self.violations.append(f"{relative_path}:{line_number}: {message}")


def _python_files() -> list[Path]:
    return sorted(
        path
        for path in APP_ROOT.rglob("*.py")
        if "__pycache__" not in path.parts
    )


def test_application_logs_use_structured_logger_contract() -> None:
    violations: list[str] = []
    for path in _python_files():
        tree = ast.parse(path.read_text(encoding="utf-8-sig"), filename=str(path))
        visitor = LoggingContractVisitor(path)
        visitor.visit(tree)
        violations.extend(visitor.violations)

    assert not violations, "Structured logging contract violations:\n" + "\n".join(violations)


def test_bound_log_fields_are_classified_by_the_field_policy() -> None:
    classified = (
        StructuredLogFieldPolicy.ALLOWED_EXTRA_FIELDS
        | StructuredLogFieldPolicy.FORBIDDEN_EXTRA_FIELDS
    )
    unclassified: list[str] = []
    for path in _python_files():
        tree = ast.parse(path.read_text(encoding="utf-8-sig"), filename=str(path))
        for node in ast.walk(tree):
            if not (
                isinstance(node, ast.Call)
                and isinstance(node.func, ast.Attribute)
                and node.func.attr == "bind"
            ):
                continue
            for keyword in node.keywords:
                if keyword.arg and keyword.arg not in classified:
                    unclassified.append(f"{path.relative_to(APP_ROOT.parent)}:{node.lineno}:{keyword.arg}")

    assert not unclassified, "Unclassified structured log fields:\n" + "\n".join(unclassified)


def test_json_logs_omit_unknown_and_sensitive_extra_fields() -> None:
    record = {
        "time": __import__("datetime").datetime.now(),
        "level": type("Level", (), {"name": "ERROR"})(),
        "name": "test",
        "message": "failed",
        "function": "test",
        "line": 1,
        "extra": {
            "event": "test.failed",
            "score_id": "score-1",
            "storage_key": "scores/private.musicxml",
            "image_path": "/tmp/private.png",
            "unreviewed_field": "must-not-escape",
        },
        "exception": None,
    }
    payload = __import__("json").loads(json_format(record))

    assert payload["event"] == "test.failed"
    assert payload["score_id"] == "score-1"
    assert "storage_key" not in payload
    assert "image_path" not in payload
    assert "unreviewed_field" not in payload
