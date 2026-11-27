"""Current producer and presentation-demand dependency direction."""

import ast
from pathlib import Path
from app.modules.revisions.presentation_demand import revision_presentation_demand
from app.modules.revisions import render_delivery as revision_render_delivery
from app.modules.playback import outbox_service

ROOT = Path(__file__).resolve().parents[1] / "app"


def imports(path):
    return {
        node.module
        for node in ast.walk(ast.parse(path.read_text(encoding="utf-8")))
        if isinstance(node, ast.ImportFrom) and node.module
    }


def test_render_and_playback_claim_use_one_demand_policy():
    assert revision_render_delivery.revision_presentation_demand is revision_presentation_demand
    assert outbox_service.revision_presentation_demand is revision_presentation_demand


def test_post_commit_and_maintenance_use_domain_owned_broker_relays():
    relays = {
        "app.modules.revisions.render_dispatch",
        "app.modules.playback.dispatch",
        "app.modules.revisions.metadata_dispatch",
    }
    assert relays <= imports(ROOT / "modules/revisions/post_commit.py")
    assert relays - {"app.modules.revisions.metadata_dispatch"} <= imports(
        ROOT / "worker/execution/maintenance_dispatch.py"
    )
    assert "app.modules.revisions.metadata_dispatch" in imports(
        ROOT / "worker/execution/revision_metadata.py"
    )
    for relative in (
        "modules/revisions/render_dispatch.py",
        "modules/playback/dispatch.py",
        "modules/revisions/metadata_dispatch.py",
    ):
        assert "app.task_queue.producer" in imports(ROOT / relative)
        assert all(not module.startswith("app.worker") for module in imports(ROOT / relative))
    assert "app.modules.revisions.post_commit" not in imports(
        ROOT / "worker/execution/maintenance_dispatch.py"
    )


def test_demand_and_retention_are_independent_policy_owners():
    modules = imports(ROOT / "modules/revisions/presentation_demand.py")
    assert "app.db.models" in modules
    assert all(
        not module.startswith(
            (
                "app.worker",
                "app.modules.practice",
                "app.modules.revisions.derived_asset_retention_service",
            )
        )
        for module in modules
    )


def test_worker_publication_revalidates_generation_after_physical_io():
    cases = [
        (
            "modules/score_assets/score_revision_rendering.py",
            "render_for_worker",
            "require_revision_attempt",
        ),
        ("modules/playback/service.py", "_render_worker_asset", "require_attempt"),
    ]
    for relative, method, admission in cases:
        tree = ast.parse((ROOT / relative).read_text(encoding="utf-8"))
        function = next(
            node
            for node in ast.walk(tree)
            if isinstance(node, ast.FunctionDef) and node.name == method
        )
        calls = [
            node
            for node in ast.walk(function)
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
        ]
        by_name = {}
        for node in calls:
            by_name.setdefault(node.func.attr, []).append(node)
        gate = by_name[admission][0]
        adoption = by_name.get("complete", [])[0]
        assert gate.lineno < adoption.lineno
        object_adoptions = [
            node
            for node in ast.walk(function)
            if isinstance(node, ast.Call)
            and isinstance(node.func, ast.Name)
            and node.func.id in {"adopt_written_object", "adopt_written_objects"}
        ]
        assert object_adoptions and all(
            gate.lineno < node.lineno < adoption.lineno for node in object_adoptions
        )
        boundaries = by_name.get("commit", [])
        assert boundaries and all(node.lineno < gate.lineno for node in boundaries)
        assert {kw.arg for kw in gate.keywords} >= {"outbox_uuid", "lease", "source_fingerprint"}
        assert {kw.arg for kw in adoption.keywords} >= {"lease"}
