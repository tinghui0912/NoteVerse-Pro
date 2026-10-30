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


def test_builder_depends_on_prepared_processing_and_immutable_domain_only():
    dependencies = imports("modules/practice/source/builder.py")
    processing = {
        alias.name
        for node in dependencies
        if node.module and node.module.startswith("app.processing.")
        for alias in node.names
    }
    assert processing == {
        "prepare_musicxml_ids_for_practice",
        "practice_score_timeline_from_prepared_musicxml",
        "practice_tempo_segments_from_musicxml",
        "practice_score_artifact_from_timeline",
        "canonical_practice_artifact_bytes",
    }
    assert not any(
        node.module
        and node.module.startswith(("app.modules.performance_takes", "app.db", "fastapi"))
        for node in dependencies
    )


def test_source_domain_is_independent_of_transport_and_persistence():
    assert all(
        not node.module or not node.module.startswith(("pydantic", "sqlalchemy", "fastapi", "app."))
        for node in imports("modules/practice/source/domain.py")
    )
