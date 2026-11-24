"""Inventory ownership follows import boundaries rather than ORM placement."""

import ast
from pathlib import Path


MODULES = Path(__file__).resolve().parents[1] / "app" / "modules"


def imports(path):
    return [
        node
        for node in ast.walk(ast.parse(path.read_text(encoding="utf-8")))
        if isinstance(node, ast.ImportFrom)
    ]


def test_usage_consumes_inventory_contracts_without_business_models_or_services():
    from app.db.models.storage_usage import __name__ as storage_models
    import app.db.models.storage_usage as models

    own_models = {name for name in vars(models) if name.startswith(("Storage", "UserStorage"))}
    for path in (MODULES / "storage_usage").glob("*.py"):
        for node in imports(path):
            module = node.module or ""
            if module.startswith("app.modules."):
                assert (
                    module.startswith("app.modules.storage_usage.")
                    or module == "app.modules.storage_inventory.contracts"
                ), (path.name, module)
            if module == "app.db.models":
                # HTTP authentication binds User; it is not an inventory query dependency.
                allowed = {"User"} if path.name == "router.py" else own_models
                assert {alias.name for alias in node.names} <= allowed, path.name
            elif module.startswith("app.db.models."):
                assert module == storage_models, path.name


def test_registry_and_contracts_are_independent_of_domain_composition():
    for name in ("contracts.py", "registry.py"):
        for node in imports(MODULES / "storage_inventory" / name):
            if (node.module or "").startswith("app.modules."):
                assert node.module == "app.modules.storage_inventory.contracts"


def test_domain_inventory_providers_only_query_persistence_and_consume_contracts():
    providers = list(MODULES.glob("*/storage_inventory.py"))
    assert providers
    for path in providers:
        for node in imports(path):
            if (node.module or "").startswith("app.modules."):
                assert node.module == "app.modules.storage_inventory.contracts", path
            assert not (node.module or "").startswith("app.storage"), path
    # Concrete cross-domain wiring is limited to the explicit composition root.
    for path in MODULES.rglob("*.py"):
        for node in imports(path):
            module = node.module or ""
            if module.startswith("app.modules.") and module.endswith(".storage_inventory"):
                assert path == MODULES / "storage_inventory" / "composition.py", path
