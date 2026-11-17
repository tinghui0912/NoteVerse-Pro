"""Dependency ownership for canonical written facts and their consumers."""

import ast
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1] / "app"


def test_renderer_source_capability_depends_only_on_written_semantics_and_stdlib():
    path = ROOT / "processing/musicxml/verovio_written_realization.py"
    for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
        if isinstance(node, ast.ImportFrom):
            assert node.module == "app.score_semantics.musicxml_score" or (
                node.module.split(".")[0] in sys.stdlib_module_names
            )
        elif isinstance(node, ast.Import):
            assert all(a.name.split(".")[0] in sys.stdlib_module_names for a in node.names)


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
                        "musicxml_direction_position",
                        "musicxml_time_only",
                        "musicxml_score",
                        "written_point",
                        "performance_navigation",
                        "tempo_policy",
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
    assert {"MusicXMLTempoError", "parse_tempo_directive", "put_written_tempo_fact"} <= imported


def test_written_markers_consume_independent_visual_and_playback_position_owners():
    tree = ast.parse((ROOT / "score_semantics/musicxml_score.py").read_text(encoding="utf-8"))
    imports = {
        node.module: {alias.name for alias in node.names}
        for node in ast.walk(tree)
        if isinstance(node, ast.ImportFrom) and node.level == 1
    }
    assert "resolve_direction_offset_quarters" in imports["musicxml_direction_position"]
    assert "resolve_sound_offset_quarters" in imports["musicxml_sound_position"]


def test_sound_consumers_share_the_time_only_datatype_owner():
    for name in ("musicxml_score", "musicxml_tempo"):
        tree = ast.parse((ROOT / f"score_semantics/{name}.py").read_text(encoding="utf-8"))
        imports = {
            alias.name
            for node in ast.walk(tree)
            if isinstance(node, ast.ImportFrom)
            and node.level == 1
            and node.module == "musicxml_time_only"
            for alias in node.names
        }
        assert {"MusicXMLTimeOnlyError", "parse_time_only"} <= imports


def test_performance_consumers_share_the_plan_entry_point():
    for path in (
        "processing/engines/playback/verovio_midi.py",
        "modules/playback/performance_plan_service.py",
    ):
        tree = ast.parse((ROOT / path).read_text(encoding="utf-8"))
        imported = {
            alias.name
            for node in ast.walk(tree)
            if isinstance(node, ast.ImportFrom)
            and node.module == "app.score_semantics.performance_plan"
            for alias in node.names
        }
        assert "build_performance_plan" in imported


def test_navigation_projection_depends_on_written_facts_and_standard_library():
    tree = ast.parse(
        (ROOT / "score_semantics/performance_navigation.py").read_text(encoding="utf-8")
    )
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom):
            if node.level:
                assert node.level == 1 and node.module in {"musicxml_score", "written_point"}
            else:
                assert node.module.split(".")[0] in sys.stdlib_module_names
        elif isinstance(node, ast.Import):
            assert all(alias.name.split(".")[0] in sys.stdlib_module_names for alias in node.names)


def test_midi_codec_and_projection_have_explicit_adapter_dependencies():
    allowed = {
        "standard_midi": set(),
        "midi_event_semantics": {"standard_midi"},
        "written_midi_streams": {"standard_midi", "midi_event_semantics"},
        "performance_midi": {
            "written_midi_streams",
            "standard_midi",
            "midi_event_semantics",
            "app.score_semantics.performance_plan",
            "app.score_semantics.written_point",
        },
    }
    for module, dependencies in allowed.items():
        tree = ast.parse(
            (ROOT / f"processing/engines/playback/{module}.py").read_text(encoding="utf-8")
        )
        for node in ast.walk(tree):
            if isinstance(node, ast.ImportFrom):
                assert (
                    node.module in dependencies
                    or node.module.split(".")[0] in sys.stdlib_module_names
                )
            elif isinstance(node, ast.Import):
                assert all(a.name.split(".")[0] in sys.stdlib_module_names for a in node.names)


def test_metadata_depends_only_on_written_score_semantics():
    tree = ast.parse((ROOT / "processing/musicxml/metadata.py").read_text(encoding="utf-8"))
    imports = []
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom):
            imports.append(node.module)
            imports.extend(f"{node.module}.{alias.name}" for alias in node.names)
        elif isinstance(node, ast.Import):
            imports.extend(alias.name for alias in node.names)
    assert "app.score_semantics.musicxml_score" in imports
    for dependency in imports:
        assert not dependency.startswith(
            (
                "app.score_semantics.performance_plan",
                "app.score_semantics.performance_navigation",
            )
        )
