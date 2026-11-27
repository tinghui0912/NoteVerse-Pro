"""Strict persistence is a caller-owned transaction participant."""

import ast
from pathlib import Path
from unittest.mock import Mock
import pytest
from app.modules.realtime import publisher


def test_strict_score_publication_uses_current_audience_and_propagates_partial_failure(monkeypatch):
    db = Mock()
    monkeypatch.setattr(publisher, "score_recipients", Mock(return_value=[8, 7, 8]))
    error = RuntimeError("publication interrupted")
    persist = Mock(side_effect=[None, error])
    monkeypatch.setattr(publisher, "publish_change", persist)
    with pytest.raises(RuntimeError) as raised:
        publisher.publish_score_change(
            db,
            score_id="score",
            revision_id="revision",
            kind=publisher.RealtimeChangeKind.SCORE_METADATA_CHANGED,
        )
    assert raised.value is error and persist.call_count == 2
    assert [call.kwargs["recipient_user_id"] for call in persist.call_args_list] == [7, 8]
    assert all(call.kwargs["score_id"] == "score" for call in persist.call_args_list)
    db.commit.assert_not_called()
    db.rollback.assert_not_called()


def test_strict_event_persistence_propagates_notify_failure_after_flush(monkeypatch):
    db = Mock()
    failure = RuntimeError("notify interrupted")
    notify = Mock(side_effect=failure)
    monkeypatch.setattr(publisher, "_notify_change", notify)
    monkeypatch.setattr(
        publisher, "admit_stream_state", Mock(return_value=Mock(high_watermark_sequence=0))
    )
    with pytest.raises(RuntimeError) as raised:
        publisher.publish_change(
            db, recipient_user_id=7, kind=publisher.RealtimeChangeKind.NOTIFICATIONS_CHANGED
        )
    assert raised.value is failure
    db.add.assert_called_once()
    db.flush.assert_called_once()
    notify.assert_called_once()
    db.commit.assert_not_called()
    db.rollback.assert_not_called()


def test_notification_admission_propagates_publication_failure_without_owning_transaction(
    monkeypatch,
):
    from app.modules.notifications import service as notifications

    db = Mock()
    failure = RuntimeError("notification publication unavailable")
    persist = Mock(side_effect=failure)
    monkeypatch.setattr(notifications, "publish_change", persist)
    repository = Mock()
    repository.admit_deduplicated.side_effect = lambda _db, notification: (notification, True)
    with pytest.raises(RuntimeError) as raised:
        notifications.NotificationService(repository).admit_import_failed(
            db,
            recipient_user_id=7,
            import_job_id="job",
            import_display_title=None,
            created_at=notifications.utc_now(),
        )
    assert raised.value is failure
    repository.admit_deduplicated.assert_called_once()
    persist.assert_called_once()
    db.commit.assert_not_called()
    db.rollback.assert_not_called()


def test_authoritative_durable_outcomes_select_strict_realtime_persistence():
    root = Path(__file__).parents[1] / "app"
    for file in (
        "modules/revisions/metadata_delivery.py",
        "worker/execution/score_revision_render_outbox.py",
        "worker/execution/playback_outbox.py",
    ):
        tree = ast.parse((root / file).read_text())
        imports = {
            alias.name
            for node in ast.walk(tree)
            if isinstance(node, ast.ImportFrom) and node.module == "app.modules.realtime.publisher"
            for alias in node.names
        }
        assert "publish_score_change" in imports
        assert all(not name.endswith("best_effort") for name in imports)
    tree = ast.parse((root / "modules/realtime/publisher.py").read_text())
    for name in ("publish_score_change", "publish_change", "_notify_change"):
        function = next(
            node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == name
        )
        assert not any(isinstance(node, ast.Try) for node in ast.walk(function))
        assert not any(
            isinstance(node, ast.Call)
            and isinstance(node.func, ast.Attribute)
            and node.func.attr in {"commit", "rollback"}
            for node in ast.walk(function)
        )
