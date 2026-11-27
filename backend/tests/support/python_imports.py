"""Resolve Python import syntax for current dependency-boundary tests without importing code."""

import ast
from importlib.util import resolve_name
from pathlib import Path


def imported_modules(path: Path, root: Path) -> set[str]:
    parts = path.relative_to(root).with_suffix("").parts
    package = ".".join(parts[:-1])
    modules: set[str] = set()
    for node in ast.walk(ast.parse(path.read_text(encoding="utf-8-sig"))):
        if isinstance(node, ast.Import):
            modules.update(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom):
            module = node.module or ""
            if node.level:
                module = resolve_name("." * node.level + module, package)
            modules.add(module)
            modules.update(module + "." + alias.name for alias in node.names if alias.name != "*")
    return modules
