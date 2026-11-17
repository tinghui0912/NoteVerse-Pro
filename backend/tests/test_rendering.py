"""Rendering target identities, caller-owned admission and bytes-to-pages execution."""

from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from sqlalchemy import select

from app.db.models import (
    ScoreRevisionRenderOutbox,
    ScoreRevisionRenderStatus,
)
from app.modules.durable_work.delivery import DeliveryAttemptLease
from app.modules.rendering import renderer
from app.modules.revisions.render_admission import admit_revision_render
from app.modules.revisions.render_target import (
    ScoreRevisionRenderAttempt,
    revision_render_target,
    ScoreRevisionRenderTarget,
)
from app.shared.time import utc_now
from tests.test_score_revision_services import (
    add_active_score_with_head_revision,
    score_service_session as score_service_session,
)


def revision_target():
    return ScoreRevisionRenderTarget(
        outbox_uuid="render",
        score_uuid="score",
        revision_uuid="revision",
        requested_by_user_id=1,
        render_profile="default",
        source_fingerprint="fingerprint",
    )


@pytest.mark.parametrize(
    "invalid",
    [None, "score_missing", "deleted", "revision_missing", "other_score", "requester_missing"],
)
def test_revision_target_resolves_only_a_live_score_and_its_revision(invalid):
    score = SimpleNamespace(id=1, score_uuid="score", deleted_at=None)
    revision = SimpleNamespace(score_id=1, revision_uuid="revision")
    if invalid == "deleted":
        score.deleted_at = utc_now()
    if invalid == "other_score":
        revision.score_id = 2
    db = Mock()
    db.get.side_effect = [
        None if invalid == "score_missing" else score,
        None if invalid == "revision_missing" else revision,
    ]
    outbox = ScoreRevisionRenderOutbox(
        outbox_uuid="render",
        score_id=1,
        revision_id=1,
        requested_by_user_id=None if invalid == "requester_missing" else 1,
        render_profile="default",
        source_fingerprint="fingerprint",
    )
    result = revision_render_target(db, outbox)
    if invalid is None:
        assert result == revision_target()
    else:
        assert result is None


def test_score_render_boundary_preserves_its_public_failure_mapping(monkeypatch):
    from app.core.exceptions import ScoreRenderFailedException
    from app.modules.score_assets import score_revision_rendering
    from app.shared.error_codes import CustomerErrorCode

    def fail(*args, **kwargs):
        raise renderer.RenderExecutionError(CustomerErrorCode.SCORE_PREVIEW_FAILED)

    monkeypatch.setattr(score_revision_rendering, "render_musicxml", fail)
    with pytest.raises(ScoreRenderFailedException) as failure:
        score_revision_rendering.ScoreRevisionRenderService._render_pages(b"xml", "revision")
    assert failure.value.code == CustomerErrorCode.SCORE_PREVIEW_FAILED


def test_revision_admission_dedupes_and_reactivates_work_in_the_callers_transaction(
    score_service_session,
):
    db, _ = score_service_session
    add_active_score_with_head_revision(
        db, score_id=1, revision_id=1, score_uuid="score", revision_uuid="revision", title="Score"
    )
    db.commit()
    fields = dict(
        score_id=1, revision_id=1, requested_by_user_id=1, source_fingerprint="fingerprint"
    )
    first = admit_revision_render(db, **fields)
    assert admit_revision_render(db, **fields) is first
    first.status = ScoreRevisionRenderStatus.SUPERSEDED
    db.flush()
    assert admit_revision_render(db, **fields) is first
    assert first.status == ScoreRevisionRenderStatus.PENDING
    db.rollback()
    assert db.scalar(select(ScoreRevisionRenderOutbox)) is None


@pytest.mark.parametrize("output_name", ["page", "excerpt"])
def test_renderer_normalizes_outputs_and_releases_its_workspace(tmp_path, monkeypatch, output_name):
    monkeypatch.setattr(renderer.settings, "WORK_ROOT", str(tmp_path))
    workspaces = []

    def engine(*, output_folder):
        workspaces.append(Path(output_folder))

        def render_score(*, xml_path, output_name):
            assert Path(xml_path).read_bytes() == b"<score-partwise/>"
            files = []
            for page, extension, mime in [(1, ".svg", "image/svg+xml"), (2, ".png", "image/png")]:
                path = Path(output_folder) / f"{output_name}-{page}{extension}"
                path.write_bytes(f"page {page}".encode())
                files.append(dict(path=str(path), page=page, mime_type=mime))
            return dict(success=True, engine="test-renderer", files=files)

        return SimpleNamespace(render_score=render_score)

    monkeypatch.setattr(renderer, "create_score_render_engine", engine)
    assert renderer.render_musicxml(b"<score-partwise/>", output_name=output_name) == [
        renderer.RenderedPage(1, b"page 1", "image/svg+xml", ".svg", "test-renderer"),
        renderer.RenderedPage(2, b"page 2", "image/png", ".png", "test-renderer"),
    ]
    assert workspaces and all(not path.exists() for path in workspaces)


@pytest.mark.parametrize(
    "result",
    [
        {"success": False, "code": "score_preview_failed"},
        {"success": True, "files": []},
        RuntimeError("engine diagnostic"),
    ],
)
def test_renderer_classifies_execution_failure_and_cleans_the_workspace(
    tmp_path, monkeypatch, result
):
    monkeypatch.setattr(renderer.settings, "WORK_ROOT", str(tmp_path))
    engine = Mock()
    if isinstance(result, Exception):
        engine.render_score.side_effect = result
    else:
        engine.render_score.return_value = result
    monkeypatch.setattr(renderer, "create_score_render_engine", lambda **_: engine)
    with pytest.raises(renderer.RenderExecutionError):
        renderer.render_musicxml(b"<score-partwise/>", output_name="page")
    assert list(tmp_path.iterdir()) == []


def test_worker_uses_revision_asset_owner_and_exact_attempt(monkeypatch):
    from app.worker.execution import score_revision_render_outbox as worker

    score = Mock()
    monkeypatch.setattr(worker, "ScoreRevisionRenderService", lambda: score)
    target = revision_target()
    lease = DeliveryAttemptLease(attempt=1, token="token")
    db = Mock()
    worker._render_revision(db, ScoreRevisionRenderAttempt(target, lease, 5))
    score.render_for_worker.assert_called_once_with(
        db,
        "score",
        "revision",
        source_fingerprint="fingerprint",
        outbox_uuid="render",
        lease=lease,
        profile=target.render_profile,
    )
