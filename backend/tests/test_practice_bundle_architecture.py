"""Practice Bundle dependency ownership at module boundaries."""

import ast
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / "app"


def imports(relative):
    return [
        node
        for node in ast.walk(ast.parse((ROOT / relative).read_text(encoding="utf-8")))
        if isinstance(node, ast.ImportFrom)
    ]


def test_take_library_reads_its_own_provenance_without_bundle_persistence():
    dependencies = {
        node.module for node in imports("modules/performance_takes/service.py") if node.module
    }
    assert "app.modules.performance_takes.repository" in dependencies
    assert not any(module.startswith("app.modules.practice.bundle") for module in dependencies)
    retention = {
        node.module for node in imports("modules/practice/bundle/retention.py") if node.module
    }
    assert not any(module.startswith("app.modules.performance_takes") for module in retention)


def test_bundle_compiler_consumes_compiler_and_score_projections():
    dependencies = {node.module for node in imports("modules/practice/bundle/compiler.py")}
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
                assert node.module in {"domain", "piano_key", "timeline", "time"}
            elif node.module and node.module.startswith("app."):
                assert node.module.startswith("app.modules.practice.score.") or node.module in {
                    "app.score_semantics.musicxml_score",
                    "app.score_semantics.tempo_policy",
                }


def test_bundle_domain_is_independent_of_transport_and_persistence():
    assert all(
        not node.module or not node.module.startswith(("pydantic", "sqlalchemy", "fastapi", "app."))
        for node in imports("modules/practice/bundle/domain.py")
    )


def test_bundle_service_delegates_durable_ownership_to_repository():
    dependencies = {node.module for node in imports("modules/practice/bundle/service.py")}
    assert {"repository", "compiler", "domain", "mutation_access"} <= dependencies
    repository = {node.module for node in imports("modules/practice/bundle/repository.py")}
    assert {"app.storage.base", "app.db.models.practice_bundle", "domain"} <= repository
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
                assert node.module.startswith("app.modules.practice.score.") or node.module in {
                    "app.score_semantics.tempo_policy",
                }
            else:
                assert node.module in {"__future__", "dataclasses", "typing"}
    service = ast.parse(
        (ROOT / "modules/performance_takes/upload_reservation/service.py").read_text()
    )
    calls = [
        node
        for node in ast.walk(service)
        if isinstance(node, ast.Call)
        and isinstance(node.func, ast.Name)
        and node.func.id == "resolve_practice_score_plan"
    ]
    assert len(calls) == 1
