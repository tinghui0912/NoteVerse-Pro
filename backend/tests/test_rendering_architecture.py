"""Rendering orchestration composes domain-owned persistence and pure engine execution."""

import ast
from pathlib import Path

from app.modules.rendering.delivery import RenderOutboxService
from app.modules.rendering.targets import RenderPayloadBuilder
from app.modules.rendering.renderer import render_musicxml
from app.modules.score_assets.score_revision_rendering import ScoreRevisionRenderService
from app.modules.import_jobs.review.thumbnail_service import ImportReviewThumbnailService

ROOT = Path(__file__).parents[1] / "app"


def imports(relative):
    return {
        node.module: {alias.name for alias in node.names}
        for node in ast.walk(ast.parse((ROOT / relative).read_text(encoding="utf-8")))
        if isinstance(node, ast.ImportFrom)
    }


def test_rendering_owns_delivery_resolution_and_engine_execution():
    assert RenderOutboxService.__module__ == "app.modules.rendering.delivery"
    assert RenderPayloadBuilder.__module__ == "app.modules.rendering.targets"
    assert render_musicxml.__module__ == "app.modules.rendering.renderer"
    assert set(imports("modules/rendering/renderer.py")) <= {
        "dataclasses",
        "pathlib",
        "tempfile",
        "app.core.config",
        "app.processing.engines.render",
    }


def test_domains_use_rendering_admission_and_keep_their_persistence():
    writer = imports("modules/revisions/writer.py")
    assert "admit_revision_render" in writer["app.modules.rendering.admission"]
    assert all(not module.startswith("app.modules.score_assets") for module in writer)
    for path in (
        "modules/import_jobs/execution_recorder.py",
        "modules/import_jobs/review/service.py",
    ):
        domain = imports(path)
        assert "admit_review_thumbnail_render" in domain["app.modules.rendering.admission"]
        assert all(not module.startswith("app.modules.score_assets") for module in domain)
    score = imports("modules/score_assets/score_revision_rendering.py")
    review = imports("modules/import_jobs/review/thumbnail_service.py")
    assert "ScoreRenderAsset" in score["app.db.models"]
    assert "ImportArtifact" in review["app.db.models"]
    assert "render_musicxml" in score["app.modules.rendering.renderer"]
    assert "render_musicxml" in review["app.modules.rendering.renderer"]
    assert "render_outbox_service" in score["app.modules.rendering.delivery"]
    assert "render_outbox_service" in review["app.modules.rendering.delivery"]
    assert (
        ScoreRevisionRenderService.__module__ == "app.modules.score_assets.score_revision_rendering"
    )
    assert (
        ImportReviewThumbnailService.__module__
        == "app.modules.import_jobs.review.thumbnail_service"
    )


def test_rendering_dispatch_is_shared_by_composition_roots():
    worker = imports("worker/execution/render_outbox.py")
    assert worker["app.modules.rendering.targets"] >= {
        "RenderAttempt",
        "ScoreRevisionRenderTarget",
        "ReviewThumbnailRenderTarget",
    }
    for path in (
        "worker/execution/render_outbox.py",
        "worker/execution/maintenance_dispatch.py",
        "modules/ops/command_service.py",
    ):
        assert "render_outbox_service" in imports(path)["app.modules.rendering.delivery"]
    assert (
        "dispatch_render_outbox"
        in imports("worker/execution/maintenance_dispatch.py")["app.modules.rendering.dispatch"]
    )
    assert (
        "send_durable_task" in imports("modules/rendering/dispatch.py")["app.task_queue.producer"]
    )
    assert "dispatch" in imports("modules/revisions/dispatch.py")["app.modules.rendering"]


def test_asset_repository_reads_score_records_and_playback_readiness():
    assert imports("modules/score_assets/repository.py")["app.db.models"] <= {
        "PlaybackAssetKind",
        "PlaybackOutbox",
        "Score",
        "ScorePlaybackAsset",
        "ScoreRenderAsset",
        "ScoreRevision",
        "ScoreRevisionSource",
    }
    assert (
        "latest_revision_render_status"
        in imports("modules/score_assets/derived_assets.py")["app.modules.rendering.queries"]
    )
