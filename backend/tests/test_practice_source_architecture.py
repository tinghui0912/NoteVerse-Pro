"""Practice Source dependency ownership at module boundaries."""

import ast
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / "app"


def imports(relative):
    return [
        node
        for node in ast.walk(ast.parse((ROOT / relative).read_text(encoding="utf-8")))
        if isinstance(node, ast.ImportFrom)
    ]


def test_take_source_dependencies_are_public_service_and_value_contracts():
    dependencies = {
        node.module
        for node in imports("modules/performance_takes/service.py")
        if node.module and node.module.startswith("app.modules.practice.")
    }
    assert dependencies == {
        "app.modules.practice.source.service",
        "app.modules.practice.source.domain",
        "app.modules.practice.source.schemas",
    }


def test_source_builder_consumes_compiler_and_score_projections():
    dependencies = {node.module for node in imports("modules/practice/source/builder.py")}
    assert {
        "app.modules.practice.score.compiler.stable_ids",
        "app.modules.practice.score.compiler.musicxml",
        "app.modules.practice.score.timeline",
        "app.modules.practice.score.artifact",
    } <= dependencies
    assert not any(
        module and module.startswith(("app.modules.performance_takes", "app.db", "fastapi"))
        for module in dependencies
    )


def test_score_compiler_dependency_direction():
    score = ROOT / "modules/practice/score"
    for path in score.rglob("*.py"):
        for node in imports(path.relative_to(ROOT)):
            if node.level:
                assert node.module in {"domain", "piano_key", "timeline"}
            elif node.module and node.module.startswith("app."):
                assert node.module.startswith("app.modules.practice.score.")


def test_source_domain_is_independent_of_transport_and_persistence():
    assert all(
        not node.module or not node.module.startswith(("pydantic", "sqlalchemy", "fastapi", "app."))
        for node in imports("modules/practice/source/domain.py")
    )


def test_source_service_delegates_durable_ownership_to_repository():
    dependencies = {node.module for node in imports("modules/practice/source/service.py")}
    assert {"repository", "builder", "domain"} <= dependencies
    repository = {node.module for node in imports("modules/practice/source/repository.py")}
    assert {"app.storage.base", "app.db.models.practice_source", "domain"} <= repository
    assert not any(
        module and module.startswith(("fastapi", "app.modules.performance_takes"))
        for module in repository
    )


def test_durable_planning_depends_only_on_score_domain_and_standard_library():
    planning = ROOT / "modules/practice/planning"
    for path in planning.rglob("*.py"):
        for node in imports(path.relative_to(ROOT)):
            assert not node.level
            if node.module and node.module.startswith("app."):
                assert node.module.startswith("app.modules.practice.score.")
            else:
                assert node.module in {"__future__", "dataclasses", "typing"}
    service = ast.parse((ROOT / "modules/performance_takes/upload_reservation/service.py").read_text())
    calls = [node for node in ast.walk(service) if isinstance(node, ast.Call)
             and isinstance(node.func, ast.Name) and node.func.id == "resolve_practice_score_plan"]
    assert len(calls) == 1
