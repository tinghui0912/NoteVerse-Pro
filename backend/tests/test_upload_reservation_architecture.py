"""Current reservation ownership and dependency direction."""

import ast
from pathlib import Path

from app.db.models.performance_take_upload_reservation import PerformanceTakeUploadReservation
from app.modules.performance_takes.upload_reservation.domain import UploadReservationStatus

ROOT = Path(__file__).resolve().parents[1] / "app"
MODULE = ROOT / "modules/performance_takes"


def imports(path):
    return {
        node.module
        for node in ast.walk(ast.parse(path.read_text()))
        if isinstance(node, ast.ImportFrom) and node.module
    }


def test_lifecycle_domain_is_pure_and_owns_status():
    assert imports(MODULE / "upload_reservation/domain.py") <= {
        "__future__",
        "dataclasses",
        "datetime",
        "enum",
        "typing",
    }
    assert (
        UploadReservationStatus.__module__
        == "app.modules.performance_takes.upload_reservation.domain"
    )
    model_imports = imports(ROOT / "db/models/performance_take_upload_reservation.py")
    assert UploadReservationStatus.__module__ in model_imports


def test_lifecycle_writes_belong_to_persistence_adapter():
    fields = {
        "status",
        "practice_source_id",
        "finalizing_token",
        "finalizing_object_key",
        "finalizing_expires_at",
        "orphan_final_object_keys",
        "last_put_url_expires_at",
        "staging_cleanup_after",
        "staging_cleanup_completed_at",
    }
    for name in ["upload_reservation/service.py", "upload_reservation/cleanup.py", "router.py"]:
        tree = ast.parse((MODULE / name).read_text())
        for node in ast.walk(tree):
            if isinstance(node, (ast.Assign, ast.AnnAssign, ast.AugAssign)):
                targets = node.targets if isinstance(node, ast.Assign) else [node.target]
                assert not any(
                    isinstance(target, ast.Attribute) and target.attr in fields
                    for target in targets
                )
    for name in ["service.py", "cleanup.py"]:
        dependencies = imports(MODULE / "upload_reservation" / name)
        assert "app.modules.performance_takes.upload_reservation.persistence" in dependencies
        assert "app.modules.performance_takes.upload_reservation.domain" in dependencies


def test_take_library_and_deletion_are_distinct_application_owners():
    from app.modules.performance_takes.service import PerformanceTakeService
    from app.modules.performance_takes.upload_reservation.service import (
        PerformanceTakeUploadService,
    )
    from app.modules.performance_takes.delete_outbox_service import (
        PerformanceTakeDeleteOutboxService,
    )

    assert {"list_takes", "get_take", "get_practice_source", "delete_take"} <= set(
        vars(PerformanceTakeService)
    )
    assert {"reserve_upload", "cancel_upload_reservation", "finalize_take"} <= set(
        vars(PerformanceTakeUploadService)
    )
    assert not any(
        "upload_reservation" in item for item in imports(MODULE / "delete_outbox_service.py")
    )
    assert "cleanup_expired_reservations" not in vars(PerformanceTakeDeleteOutboxService)


def test_object_ownership_is_explicit_in_persistence_shape():
    from app.db.models.performance_take import PerformanceTake

    columns = set(PerformanceTakeUploadReservation.__table__.columns.keys())
    assert {"staging_object_key", "finalizing_object_key", "orphan_final_object_keys"} <= columns
    assert "final_object_key" not in columns and "final_cleanup_completed_at" not in columns
    assert "media_object_key" in PerformanceTake.__table__.columns
    assert "media_object_key" not in columns


def test_one_orphan_codec_and_router_only_dispatches_commands():
    definitions = [
        (path, node.name)
        for path in MODULE.rglob("*.py")
        for node in ast.walk(ast.parse(path.read_text()))
        if isinstance(node, ast.FunctionDef)
        and node.name in {"decode_orphan_candidates", "encode_orphan_candidates"}
    ]
    assert len(definitions) == 2
    assert all(path == MODULE / "upload_reservation/persistence.py" for path, _ in definitions)
    assert not any("upload_reservation.domain" in name for name in imports(MODULE / "router.py"))
