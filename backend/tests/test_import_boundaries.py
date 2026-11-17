"""Import owns review, processing and atomic confirmation; workers share neutral protocols."""

import ast
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

from app.api.deps import get_current_user, get_db
from app.modules.import_jobs.review.dependencies import get_import_review_service
from app.shared.time import utc_now

from app.main import app
from app.modules.import_jobs.review.service import ImportReviewService
from app.modules.import_jobs.review.read_model import ImportReviewReadModel
from app.modules.import_jobs.pipeline.context import JobContext
from app.task_queue.protocols import CeleryTaskLike

ROOT = Path(__file__).parents[1] / "app"


def test_import_implementations_and_worker_protocol_have_explicit_context_owners():
    for implementation in (
        ImportReviewService,
        ImportReviewReadModel,
    ):
        assert implementation.__module__.startswith("app.modules.import_jobs.review.")
    assert JobContext.__module__ == "app.modules.import_jobs.pipeline.context"
    assert CeleryTaskLike.__module__ == "app.task_queue.protocols"
    for path in (ROOT / "worker").rglob("*.py"):
        tree = ast.parse(path.read_text(encoding="utf8"))
        for node in ast.walk(tree):
            if isinstance(node, ast.ImportFrom) and any(
                a.name == "CeleryTaskLike" for a in node.names
            ):
                assert node.module == "app.task_queue.protocols", path


def test_review_http_resources_are_import_job_subresources_with_semantic_identities():
    paths = app.openapi()["paths"]
    for method, suffix, operation in (
        ("get", "", "importJobReviewGet"),
        ("patch", "", "importJobReviewUpdate"),
        ("post", "/confirm", "importJobReviewConfirm"),
    ):
        assert (
            paths[f"/api/v1/import-jobs/{{job_id}}/review{suffix}"][method]["operationId"]
            == operation
        )
    assert all(not path.startswith("/api/v1/review/") for path in paths)
    operations = [
        value["operationId"]
        for path in paths.values()
        for method, value in path.items()
        if method in {"get", "post", "put", "patch", "delete", "options", "head"}
    ]
    assert len(operations) == len(set(operations))


def test_review_http_subresources_delegate_to_import_owned_use_cases(client):
    representation = dict(
        job_id="job",
        state="READY_FOR_REVIEW",
        genres=[],
        original_images=[],
        created_at=utc_now(),
        updated_at=utc_now(),
    )
    service = SimpleNamespace(
        detail=Mock(return_value=representation),
        update=Mock(return_value=representation),
        confirm=Mock(return_value={"score_id": "score"}),
    )
    overrides = app.dependency_overrides.copy()
    app.dependency_overrides[get_import_review_service] = lambda: service
    app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(id=1)
    app.dependency_overrides[get_db] = lambda: None
    try:
        assert client.get("/api/v1/import-jobs/job/review").json()["job_id"] == "job"
        assert (
            client.patch("/api/v1/import-jobs/job/review", json={"content": "xml"}).json()["job_id"]
            == "job"
        )
        response = client.post("/api/v1/import-jobs/job/review/confirm", json={"content": "xml"})
        assert response.status_code == 200 and response.json() == {"score_id": "score"}
        for operation in (service.detail, service.update, service.confirm):
            operation.assert_called_once()
    finally:
        app.dependency_overrides.clear()
        app.dependency_overrides.update(overrides)


def test_confirmation_owns_realtime_consequences_and_temporary_release():
    tree = ast.parse((ROOT / "modules/import_jobs/review/service.py").read_text())
    imports = {
        alias.name
        for node in ast.walk(tree)
        if isinstance(node, ast.ImportFrom)
        for alias in node.names
    }
    assert "admit_import_confirmation_consequences" in imports and "Notification" not in imports
    confirm = next(
        node
        for node in ast.walk(tree)
        if isinstance(node, ast.FunctionDef) and node.name == "confirm"
    )
    calls = [node for node in ast.walk(confirm) if isinstance(node, ast.Call)]
    cleanup = next(
        node
        for node in calls
        if isinstance(node.func, ast.Attribute) and node.func.attr == "cleanup_binary_artifacts"
    )
    append = next(
        node
        for node in calls
        if isinstance(node.func, ast.Name)
        and node.func.id == "admit_import_confirmation_consequences"
    )
    semantic_transaction = next(
        node
        for node in ast.walk(confirm)
        if isinstance(node, ast.Try)
        and any(cleanup in ast.walk(statement) for statement in node.body)
    )
    semantic_calls = [
        node
        for statement in semantic_transaction.body
        for node in ast.walk(statement)
        if isinstance(node, ast.Call)
    ]
    owner_admission = min(
        node.lineno
        for node in semantic_calls
        if isinstance(node.func, ast.Attribute)
        and isinstance(node.func.value, ast.Name)
        and node.func.value.id == "db"
        and node.func.attr == "add"
    )
    commits = [
        node
        for node in semantic_calls
        if node.lineno >= owner_admission
        and isinstance(node.func, ast.Attribute)
        and node.func.attr == "commit"
    ]
    assert len(commits) == 1 and cleanup.lineno < append.lineno < commits[0].lineno
    release = ast.parse((ROOT / "modules/import_jobs/deletion_service.py").read_text())
    assert not any(
        isinstance(node, ast.Call)
        and isinstance(node.func, ast.Attribute)
        and node.func.attr == "commit"
        for node in ast.walk(release)
    )
