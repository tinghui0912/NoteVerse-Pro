"""Business key identity belongs to semantic owners, not physical infrastructure."""

import ast
from pathlib import Path

ROOT = Path(__file__).parents[1] / "app"


def test_storage_infrastructure_treats_domain_locators_as_opaque():
    namespaces = (
        "scores/",
        "jobs/",
        "practice-bundles/",
        "performance-takes/",
        "staging/performance-takes/",
        "blobs/",
        "avatars/",
    )
    key_owners = {
        "app.modules.revisions.object_keys",
        "app.modules.import_jobs.object_keys",
        "app.modules.practice.bundle.object_keys",
        "app.modules.performance_takes.object_keys",
        "app.modules.score_assets.render_asset_records",
        "app.modules.playback.asset_records",
        "app.modules.uploads.service",
        "app.modules.account.avatar_service",
    }
    for folder in (
        "storage",
        "modules/storage_objects",
        "modules/storage_usage",
        "modules/storage_quota",
    ):
        for path in (ROOT / folder).rglob("*.py"):
            tree = ast.parse(path.read_text(encoding="utf-8"))
            from tests.support.python_imports import imported_modules

            for imported in imported_modules(path, ROOT.parent):
                assert not any(
                    imported == owner or imported.startswith(owner + ".") for owner in key_owners
                ), path
                assert ".object_keys" not in imported, path
            for node in ast.walk(tree):
                if isinstance(node, ast.ImportFrom) and node.module:
                    assert node.module not in key_owners and not node.module.endswith(
                        ".object_keys"
                    ), path
                if isinstance(node, ast.Import):
                    assert all(alias.name not in key_owners for alias in node.names), path
                if isinstance(node, ast.Constant) and isinstance(node.value, str):
                    assert not node.value.startswith(namespaces), path


def test_producers_and_identity_verifiers_consume_domain_key_authorities():
    consumers = {
        "modules/revisions/service.py": {"canonical_revision_source_object_key"},
        "modules/revisions/writer.py": {"canonical_revision_source_object_key"},
        "modules/import_jobs/review/service.py": {
            "canonical_revision_source_object_key",
            "review_musicxml_object_key",
        },
        "modules/import_jobs/pipeline/artifact_recorder.py": {"review_musicxml_object_key"},
        "modules/practice/bundle/writer.py": {
            "practice_bundle_musicxml_object_key",
            "practice_bundle_artifact_object_key",
        },
        "modules/performance_takes/finalization.py": {"performance_take_recording_object_key"},
        "modules/performance_takes/upload_reservation/reservation_service.py": {
            "performance_take_staging_object_key"
        },
    }
    for relative, required in consumers.items():
        tree = ast.parse((ROOT / relative).read_text(encoding="utf-8"))
        imported = {
            alias.name
            for node in ast.walk(tree)
            if isinstance(node, ast.ImportFrom)
            for alias in node.names
        }
        called = {
            node.func.id
            for node in ast.walk(tree)
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Name)
        }
        assert required <= imported & called, relative
        # Domain callers delegate namespace construction; they do not format identities.
        for node in ast.walk(tree):
            if isinstance(node, ast.JoinedStr):
                assert not any(
                    isinstance(value, ast.Constant)
                    and isinstance(value.value, str)
                    and value.value.startswith(
                        (
                            "scores/",
                            "jobs/",
                            "practice-bundles/",
                            "performance-takes/",
                            "staging/performance-takes/",
                        )
                    )
                    for value in node.values
                ), relative
