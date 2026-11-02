"""Current producer and presentation-demand dependency direction."""

import ast
from pathlib import Path
from app.modules.revisions.presentation_demand import revision_presentation_demand
from app.modules.score_assets import render_outbox_service
from app.modules.playback import outbox_service

ROOT = Path(__file__).resolve().parents[1] / "app"


def imports(path):
    return {
        node.module
        for node in ast.walk(ast.parse(path.read_text(encoding="utf-8")))
        if isinstance(node, ast.ImportFrom) and node.module
    }


def test_render_and_playback_claim_use_one_demand_policy():
    assert render_outbox_service.revision_presentation_demand is revision_presentation_demand
    assert outbox_service.revision_presentation_demand is revision_presentation_demand


def test_api_and_beat_use_the_same_neutral_revision_producer():
    for path in [
        ROOT / "modules/revisions/derivatives.py",
        ROOT / "worker/execution/maintenance_dispatch.py",
    ]:
        assert "app.modules.revisions.dispatch" in imports(path)
    assert "app.task_queue.producer" in imports(ROOT / "modules/revisions/dispatch.py")
    for path in list((ROOT / "task_queue").glob("*.py")) + [
        ROOT / "modules/revisions/dispatch.py",
        ROOT / "modules/revisions/derivatives.py",
    ]:
        assert all(not module.startswith("app.worker") for module in imports(path)), path


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
