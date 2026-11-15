"""The canonical source graph has one revision admission boundary."""

import ast
from pathlib import Path

ROOT = Path(__file__).parents[1] / "app"


def test_revision_model_creation_and_head_advancement_have_one_semantic_owner():
    constructors = {"ScoreRevision", "ScoreRevisionSource", "ScoreRevisionMetadata"}
    owners = {name: set() for name in constructors}
    heads = set()
    derivative_admission = set()
    for path in ROOT.rglob("*.py"):
        relative = path.relative_to(ROOT).as_posix()
        for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Name):
                if node.func.id in constructors:
                    owners[node.func.id].add(relative)
                if node.func.id in {
                    "create_revision_render_outbox",
                    "create_playback_outbox",
                }:
                    derivative_admission.add(relative)
            if (
                isinstance(node, ast.Attribute)
                and isinstance(node.ctx, ast.Store)
                and node.attr == "head_revision_id"
            ):
                heads.add(relative)
    assert all(owner == {"modules/revisions/writer.py"} for owner in owners.values())
    assert heads == {"modules/revisions/writer.py", "modules/scores/deletion_executor.py"}
    assert derivative_admission == {"modules/revisions/writer.py"}


def test_revision_writer_is_a_transaction_participant_admitting_all_durable_work():
    tree = ast.parse((ROOT / "modules/revisions/writer.py").read_text())
    calls = [node.func for node in ast.walk(tree) if isinstance(node, ast.Call)]
    assert not any(
        isinstance(call, ast.Attribute) and call.attr in {"commit", "rollback"} for call in calls
    )
    names = {call.id for call in calls if isinstance(call, ast.Name)}
    assert names >= {
        "ScoreRevision",
        "ScoreRevisionSource",
        "ScoreRevisionMetadata",
        "RevisionMetadataOutbox",
        "publish_change",
        "score_recipients",
        "create_revision_render_outbox",
        "create_playback_outbox",
    }
    assert any(
        isinstance(call, ast.Attribute) and call.attr == "commit_reservation" for call in calls
    )


def test_use_cases_delegate_revision_admission_and_only_hint_after_commit():
    for file in ("modules/revisions/service.py", "modules/import_jobs/review/service.py"):
        tree = ast.parse((ROOT / file).read_text())
        imports = {node.module for node in ast.walk(tree) if isinstance(node, ast.ImportFrom)}
        assert "app.modules.revisions.writer" in imports
        if file.endswith("revisions/service.py"):
            assert imports.isdisjoint(
                {
                    "app.modules.notifications.service",
                    "app.modules.realtime.publisher",
                    "app.modules.metadata.service",
                    "app.modules.revisions.derived_asset_retention_service",
                }
            )


def test_executable_seed_and_smoke_paths_delegate_to_the_canonical_writer():
    repo = ROOT.parents[1]
    for path in (
        ROOT.parent / "scripts/seed_integration_user.py",
        repo / "scripts/k8s_smoke_derived_assets.py",
    ):
        tree = ast.parse(path.read_text(encoding="utf-8"))
        trees = [tree]
        for node in ast.walk(tree):
            if isinstance(node, ast.JoinedStr):
                source = "".join(
                    value.value if isinstance(value, ast.Constant) else "None"
                    for value in node.values
                )
                if "from app.modules.revisions.writer import" in source:
                    trees.append(ast.parse(source))
        for parsed in trees:
            assert not any(
                isinstance(node, ast.Call)
                and isinstance(node.func, ast.Name)
                and node.func.id
                in {"ScoreRevision", "ScoreRevisionSource", "ScoreRevisionMetadata"}
                for node in ast.walk(parsed)
            )
        assert "app.modules.revisions.writer" in path.read_text(encoding="utf-8")
