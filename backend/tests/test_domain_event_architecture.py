"""Domain facts, database representations and external delivery have separate owners."""

import ast
from pathlib import Path

import pytest
from pydantic import ValidationError

from app.db.models import DomainEvent, DomainProjectionCheckpoint
from app.modules.import_jobs.events import ImportJobCompleted, ImportJobFailed
from app.modules.import_jobs.projections import IMPORT_PROJECTIONS

APP = Path(__file__).resolve().parents[1] / "app"


def test_journal_facts_and_checkpoint_progress_have_separate_schemas():
    assert set(DomainEvent.__table__.c.keys()) == {
        "id",
        "event_uuid",
        "event_type",
        "schema_version",
        "aggregate_type",
        "aggregate_id",
        "dedupe_key",
        "payload",
        "occurred_at",
        "recorded_at",
    }
    assert not DomainEvent.__table__.foreign_keys
    assert set(DomainProjectionCheckpoint.__table__.c.keys()) == {
        "projection_name",
        "last_event_id",
        "updated_at",
    }
    assert [projection.name for projection in IMPORT_PROJECTIONS] == [
        "import_notifications_v1",
        "import_realtime_v1",
    ]


def test_import_definitions_are_frozen_versioned_semantic_facts():
    completed = ImportJobCompleted(job_id="job", recipient_user_id=1, requested_title="Etudes")
    failed = ImportJobFailed(job_id="job", recipient_user_id=1, public_failure_code="task_timeout")
    assert (
        completed.event_type == "import.job.completed" and failed.event_type == "import.job.failed"
    )
    assert completed.schema_version == failed.schema_version == 1
    assert completed.dedupe_key == "import.job.completed:job"
    assert failed.model_dump() == {
        "job_id": "job",
        "recipient_user_id": 1,
        "public_failure_code": "task_timeout",
    }
    with pytest.raises(ValidationError):
        completed.job_id = "other"
    with pytest.raises(ValidationError):
        ImportJobFailed(
            job_id="job", recipient_user_id=1, public_failure_code="private worker detail"
        )
    with pytest.raises(ValidationError):
        ImportJobFailed(job_id="job", recipient_user_id=1, error_type="InternalCrash")


def test_import_finalization_appends_facts_and_owns_one_business_commit():
    tree = ast.parse((APP / "modules/import_jobs/worker_service.py").read_text(encoding="utf-8"))
    imports = {node.module for node in ast.walk(tree) if isinstance(node, ast.ImportFrom)}
    assert "app.modules.domain_events.journal" in imports
    assert not any(
        module
        and (
            module.startswith("app.modules.notifications")
            or module.startswith("app.modules.realtime")
        )
        for module in imports
    )
    for method in (
        node
        for node in ast.walk(tree)
        if isinstance(node, ast.FunctionDef)
        and node.name in {"finalize_success", "finalize_failure"}
    ):
        statements = [
            node
            for node in method.body
            if isinstance(node, ast.Expr) and isinstance(node.value, ast.Call)
        ]
        calls = [ast.unparse(node.value.func) for node in statements]
        assert calls.count("db.commit") == 1
        assert isinstance(method.body[0], ast.Assign)
        assert ast.unparse(method.body[0].value.func) == "require_current_attempt"
        assert (
            calls.index("append_fact")
            < calls.index("db.commit")
            < calls.index("catch_up_import_projections_best_effort")
        )


def test_projection_semantics_are_database_only_and_commit_belongs_to_runner():
    path = APP / "modules/import_jobs/projections.py"
    tree = ast.parse(path.read_text(encoding="utf-8"))
    handlers = [
        node
        for node in tree.body
        if isinstance(node, ast.FunctionDef) and node.name.startswith("project_import_")
    ]
    assert len(handlers) == len(IMPORT_PROJECTIONS)
    for handler in handlers:
        calls = {ast.unparse(node.func) for node in ast.walk(handler) if isinstance(node, ast.Call)}
        assert calls <= {
            "isinstance",
            "TypeError",
            "select",
            "select(NotificationEvent.id).where",
            "db.scalar",
            "db.add",
            "db.flush",
            "NotificationEvent",
            "publish_event_sync",
        }
    for path in [
        *(APP / "modules/domain_events").glob("*.py"),
        APP / "modules/import_jobs/projections.py",
    ]:
        tree = ast.parse(path.read_text(encoding="utf-8"))
        modules = {node.module for node in ast.walk(tree) if isinstance(node, ast.ImportFrom)}
        assert not any(
            module
            and module.startswith(("app.storage", "app.task_queue", "celery", "httpx", "requests"))
            for module in modules
        )
