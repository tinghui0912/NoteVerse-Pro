"""Governance core boundaries and explicit read-only inventory composition."""

from pathlib import Path
from tests.support.python_imports import imported_modules

ROOT = Path(__file__).resolve().parents[1]
MODULES = ROOT / "app/modules"


def test_governance_core_consumes_only_its_owned_models_and_reader_contracts():
    governance = MODULES / "storage_governance"
    for part in ("usage", "quota", "inventory"):
        paths = list((governance / part).rglob("*.py"))
        assert paths
        for path in paths:
            for imported in imported_modules(path, ROOT):
                if imported.startswith("app.modules."):
                    allowed = [f"app.modules.storage_governance.{part}"]
                    if part == "usage":
                        allowed += ["app.modules.storage_governance.inventory.contracts"]
                    if part == "quota":
                        allowed += [
                            "app.modules.storage_governance.usage.contracts",
                            "app.modules.storage_governance.usage.domain",
                        ]
                    if part == "inventory":
                        allowed += ["app.modules.storage_governance.usage.domain"]
                    assert any(
                        imported == module or imported.startswith(module + ".")
                        for module in allowed
                    ), (path, imported)
                if imported.startswith("app.db.models"):
                    allowed = ["app.db.models.storage_usage"] if part in {"usage", "quota"} else []
                    if part == "quota":
                        allowed += ["app.db.models.storage_quota"]
                    if part == "quota" and path.name == "router.py":
                        allowed += ["app.db.models.user"]
                    assert any(
                        imported == module or imported.startswith(module + ".")
                        for module in allowed
                    ), (path, imported)
                assert not imported.startswith("app.storage"), (path, imported)


def test_domain_inventory_providers_own_sql_aggregation_without_mutation_or_io():
    import ast

    providers = list(MODULES.glob("*/storage_inventory.py"))
    assert providers
    for path in providers:
        for imported in imported_modules(path, ROOT):
            if imported.startswith("app.modules."):
                assert imported.startswith(
                    (
                        "app.modules.storage_governance.inventory.contracts",
                        "app.modules.storage_governance.usage.domain",
                        "app.modules." + path.parent.name + ".domain",
                    )
                ), (
                    path,
                    imported,
                )
            assert not imported.startswith("app.storage"), path
        for node in ast.walk(ast.parse(path.read_text())):
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute):
                assert node.func.attr not in {"add", "delete", "commit", "rollback"}, (
                    path,
                    node.lineno,
                )
    for path in MODULES.rglob("*.py"):
        for imported in imported_modules(path, ROOT):
            assert not (
                imported.startswith("app.modules.") and imported.endswith(".storage_inventory")
            ), (path, imported)
