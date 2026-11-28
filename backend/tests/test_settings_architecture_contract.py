"""Value-model configuration is independent of process environment loading."""

import ast
from pathlib import Path


def test_configuration_blocks_are_pure():
    directory = Path(__file__).resolve().parents[1] / "app" / "platform" / "config"
    files = tuple(directory.glob("*.py"))
    assert files
    for path in files:
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if isinstance(node, ast.ImportFrom):
                module = node.module or ""
                assert not module.startswith(("app.runtime", "app.modules", "pydantic_settings")), (
                    path
                )
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute):
                assert ast.unparse(node.func) not in ("os.getenv", "os.environ.get"), path
