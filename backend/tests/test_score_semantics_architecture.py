"""Dependency ownership for canonical written facts and their consumers."""

import ast
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1] / "app"


def test_score_semantics_has_only_standard_library_and_local_semantic_dependencies():
    for path in (ROOT / "score_semantics").glob("*.py"):
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if isinstance(node, ast.ImportFrom):
                if node.level:
                    assert node.level == 1
                    assert node.module in {
                        "musicxml_tempo",
                        "musicxml_sound_position",
                        "musicxml_score",
                    }
                else:
                    assert node.module.split(".")[0] in sys.stdlib_module_names
            elif isinstance(node, ast.Import):
                assert all(a.name.split(".")[0] in sys.stdlib_module_names for a in node.names)


def test_written_consumers_use_the_semantic_entry_point_and_neutral_model():
    for path in (
        ROOT / "modules/practice/score/compiler/musicxml.py",
        ROOT / "processing/musicxml/metadata.py",
    ):
        tree = ast.parse(path.read_text(encoding="utf-8"))
        imported = {
            alias.name
            for node in ast.walk(tree)
            if isinstance(node, ast.ImportFrom)
            and node.module == "app.score_semantics.musicxml_score"
            for alias in node.names
        }
        assert {
            "CanonicalScoreSemanticModel",
            "MusicXMLSemanticError",
            "parse_score_semantics",
        } <= imported


def test_written_chronology_consumes_the_explicit_tempo_semantic_owner():
    tree = ast.parse((ROOT / "score_semantics/musicxml_score.py").read_text(encoding="utf-8"))
    imported = {
        alias.name
        for node in ast.walk(tree)
        if isinstance(node, ast.ImportFrom) and node.level == 1 and node.module == "musicxml_tempo"
        for alias in node.names
    }
    assert {"MusicXMLTempoError", "parse_tempo_directive", "put_tempo_fact"} <= imported


def test_metadata_consumes_domain_performance_projection():
    tree = ast.parse((ROOT / "processing/musicxml/metadata.py").read_text(encoding="utf-8"))
    imported = {
        alias.name
        for node in ast.walk(tree)
        if isinstance(node, ast.ImportFrom)
        and node.module == "app.score_semantics.performance_navigation"
        for alias in node.names
    }
    assert {
        "PerformanceNavigationError",
        "PerformanceProjection",
        "project_performance_occurrences",
    } <= imported


def test_navigation_projection_depends_on_written_facts_and_standard_library():
    tree = ast.parse(
        (ROOT / "score_semantics/performance_navigation.py").read_text(encoding="utf-8")
    )
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom):
            if node.level:
                assert node.level == 1 and node.module == "musicxml_score"
            else:
                assert node.module.split(".")[0] in sys.stdlib_module_names
        elif isinstance(node, ast.Import):
            assert all(alias.name.split(".")[0] in sys.stdlib_module_names for alias in node.names)
