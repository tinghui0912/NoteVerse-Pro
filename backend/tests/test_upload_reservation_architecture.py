"""Current reservation ownership and dependency direction."""

import ast
from pathlib import Path

from app.db.models.performance_take_upload_reservation import PerformanceTakeUploadReservation
from app.modules.performance_takes.upload_reservation.states import UploadReservationStatus

ROOT = Path(__file__).resolve().parents[1] / "app"
MODULE = ROOT / "modules/performance_takes"


def imports(path):
    return {
        node.module
        for node in ast.walk(ast.parse(path.read_text()))
        if isinstance(node, ast.ImportFrom) and node.module
    }


def test_lifecycle_domain_and_persistence_consume_domain_owned_status_vocabulary():
    assert imports(MODULE / "upload_reservation/domain.py") <= {
        "__future__",
        "dataclasses",
        "datetime",
        "app.modules.performance_takes.upload_reservation.states",
        "typing",
        "states",
    }
    assert (
        UploadReservationStatus.__module__
        == "app.modules.performance_takes.upload_reservation.states"
    )
    assert imports(MODULE / "upload_reservation/states.py") == {"enum"}
    model_imports = imports(ROOT / "db/models/performance_take_upload_reservation.py")
    assert UploadReservationStatus.__module__ in model_imports


def test_lifecycle_writes_belong_to_persistence_adapter():
    fields = {"status", "finalizing_token", "finalizing_expires_at"}
    for name in [
        "upload_reservation/reservation_service.py",
        "upload_reservation/cleanup.py",
        "router.py",
    ]:
        tree = ast.parse((MODULE / name).read_text())
        for node in ast.walk(tree):
            if isinstance(node, (ast.Assign, ast.AnnAssign, ast.AugAssign)):
                targets = node.targets if isinstance(node, ast.Assign) else [node.target]
                assert not any(
                    isinstance(target, ast.Attribute) and target.attr in fields
                    for target in targets
                )
    for name in ["reservation_service.py", "cleanup.py"]:
        dependencies = imports(MODULE / "upload_reservation" / name)
        assert dependencies & {
            "app.modules.performance_takes.upload_reservation.persistence",
            "persistence",
        }
        assert dependencies & {"app.modules.performance_takes.upload_reservation.states", "states"}


def test_archive_admission_and_physical_retirement_have_distinct_owners():
    from app.modules.performance_takes.service import PerformanceTakeService
    from app.modules.performance_takes.upload_reservation.reservation_service import (
        PerformanceTakeReservationService,
    )
    from app.modules.performance_takes.finalization import PerformanceTakeFinalizationService
    from app.modules.media_storage.retirement import StoredObjectRetirementDelivery

    assert {"list_takes", "get_take", "get_playback_url", "delete_take"} <= set(
        vars(PerformanceTakeService)
    )
    assert {"reserve_upload", "cancel_upload_reservation"} <= set(
        vars(PerformanceTakeReservationService)
    )
    assert "finalize_take" in vars(PerformanceTakeFinalizationService)
    assert {"claim", "fail", "mark_dispatched", "release_dispatch", "recover_and_list_due"} <= set(
        vars(StoredObjectRetirementDelivery)
    )


def test_object_ownership_is_explicit_in_persistence_shape():
    from app.db.models.performance_take import PerformanceTake

    from app.db.models import UploadSession

    columns = set(PerformanceTakeUploadReservation.__table__.columns.keys())
    assert {
        "upload_session_id",
        "manifest_id",
        "quota_hold_id",
        "finalizing_token",
        "finalizing_expires_at",
    } <= columns
    assert any(
        fk.target_fullname == "upload_sessions.id" and fk.ondelete == "RESTRICT"
        for fk in PerformanceTakeUploadReservation.__table__.foreign_keys
    )
    assert "recording_object_id" in PerformanceTake.__table__.columns
    assert {"object_key", "provider_upload_id", "cleanup_completed_at"} <= set(
        UploadSession.__table__.columns.keys()
    )


def test_router_dispatches_domain_commands():
    assert not any("upload_reservation.domain" in name for name in imports(MODULE / "router.py"))


def test_manifest_semantics_and_persistence_have_explicit_dependency_owners():
    assert imports(MODULE / "manifest.py") <= {
        "__future__",
        "dataclasses",
        "schemas",
        "recording_media_admission",
    }
    assert imports(MODULE / "recording_media_admission.py") == {
        "generated.recording_media_admission"
    }
    assert imports(MODULE / "generated/recording_media_admission.py") == {"typing"}
    dependencies = imports(MODULE / "manifest_persistence.py")
    assert {"manifest", "app.db.models.performance_take_manifest"} <= dependencies
    assert "app.modules.performance_takes.aggregate" in imports(MODULE / "service.py")
    assert "app.modules.performance_takes.manifest_persistence" in imports(
        MODULE / "upload_reservation/reservation_service.py"
    )
    assert {"manifest_persistence", "app.modules.media_storage.persistence"} <= imports(
        MODULE / "aggregate.py"
    )
    # The upload aggregate consumes lifecycle facts independently of admitted recording policy.
    assert imports(MODULE / "upload_reservation/domain.py") <= {
        "__future__",
        "dataclasses",
        "datetime",
        "app.modules.performance_takes.upload_reservation.states",
        "typing",
        "states",
    }
