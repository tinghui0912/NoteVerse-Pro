"""Architecture contracts for standalone backend settings groups."""

from __future__ import annotations

import ast
from pathlib import Path


SETTINGS_ROOT = Path(__file__).resolve().parents[1] / "app" / "core" / "settings"


def _settings_group_files() -> list[Path]:
    """Return concrete settings-group modules, excluding the package marker."""

    return sorted(path for path in SETTINGS_ROOT.glob("*.py") if path.name != "__init__.py")


def test_settings_groups_do_not_depend_on_application_modules() -> None:
    """Keep reusable configuration validation independent from runtime behavior.

    ``app.core.config`` composes groups and is intentionally allowed to import
    them. The inverse direction would make a settings group depend on a runtime
    owner, create circular-import risk, and prevent isolated validation tests.
    """

    violations: list[str] = []
    for path in _settings_group_files():
        tree = ast.parse(path.read_text(encoding="utf-8-sig"), filename=str(path))
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                imported_modules = (alias.name for alias in node.names)
            elif isinstance(node, ast.ImportFrom) and node.level == 0 and node.module:
                imported_modules = (node.module,)
            else:
                continue
            for module_name in imported_modules:
                if module_name == "app" or module_name.startswith("app."):
                    relative_path = path.relative_to(SETTINGS_ROOT.parent.parent.parent)
                    violations.append(
                        f"{relative_path}:{node.lineno}: settings groups must not import {module_name}"
                    )

    assert not violations, "Settings architecture contract violations:\n" + "\n".join(violations)
