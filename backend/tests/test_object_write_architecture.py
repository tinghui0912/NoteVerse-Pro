"""Physical mutation ownership and independent write-transaction boundaries."""

import ast
from pathlib import Path
from tests.support.python_imports import imported_modules

ROOT = Path(__file__).resolve().parents[1]
MODULES = ROOT / "app/modules"


def test_business_resource_mutations_have_explicit_physical_authorities():
    for path in MODULES.rglob("*.py"):
        relative = path.relative_to(MODULES).as_posix()
        physical = relative.startswith("media_storage/")
        for node in ast.walk(ast.parse(path.read_text(encoding="utf-8-sig"))):
            if not isinstance(node, ast.Call):
                continue
            name = (
                node.func.id
                if isinstance(node.func, ast.Name)
                else node.func.attr
                if isinstance(node.func, ast.Attribute)
                else ""
            )
            if name in {
                "StoredObject",
                "object_to_row",
                "object_from_bytes",
                "put_bytes",
                "copy",
                "delete",
            }:
                receiver = (
                    ast.unparse(node.func.value) if isinstance(node.func, ast.Attribute) else ""
                )
                mutation = (
                    name in {"StoredObject", "object_to_row", "object_from_bytes", "put_bytes"}
                    or "storage" in receiver
                )
                if mutation:
                    assert physical, (
                        relative,
                        node.lineno,
                        name,
                    )
            if name in {"put_object", "copy_object", "delete_object"} and not physical:
                raise AssertionError((relative, node.lineno, "Provider SDK belongs to app/storage"))


def test_business_services_receive_infrastructure_from_composition():
    core = {
        "StorageUsageService",
        "StorageQuotaService",
        "ObjectWriteCoordinator",
        "S3CompatibleObjectStorage",
    }
    for path in MODULES.rglob("*.py"):
        for imported in imported_modules(path, ROOT):
            assert not imported.startswith("app.composition"), (path, imported)
        for node in ast.walk(ast.parse(path.read_text(encoding="utf-8-sig"))):
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Name):
                assert node.func.id not in core, (path, node.lineno, node.func.id)


def test_adoption_only_mutates_the_callers_transaction():
    from app.modules.media_storage import adoption

    tree = ast.parse(Path(adoption.__file__).read_text())
    assert not any(
        isinstance(node, ast.Call)
        and isinstance(node.func, ast.Attribute)
        and node.func.attr in {"commit", "rollback"}
        for node in ast.walk(tree)
    )


def test_persisted_resource_enums_are_owned_by_pure_domain_modules():
    import importlib
    import sys
    from sqlmodel import SQLModel
    import app.db.models  # noqa: F401 -- register persistence metadata

    owned = {
        "StorageUsageCategory": "app.modules.storage_governance.usage.domain",
        "StoragePlanCode": "app.modules.storage_governance.quota.states",
        "StorageQuotaHoldStatus": "app.modules.storage_governance.quota.states",
        "ObjectWriteIntentStatus": "app.modules.media_storage.domain",
        "UploadPurpose": "app.modules.media_storage.upload_sessions.domain",
        "UploadMode": "app.modules.media_storage.upload_sessions.domain",
        "UploadStatus": "app.modules.media_storage.upload_sessions.domain",
        "TakeMediaStatus": "app.modules.performance_takes.processing_states",
        "TakeProcessingStatus": "app.modules.performance_takes.processing_states",
        "StoredObjectRetirementStatus": "app.modules.media_storage.domain",
        "UploadReservationStatus": "app.modules.performance_takes.upload_reservation.states",
        "PracticeBundleStatus": "app.modules.practice.bundle.states",
        "RevisionOrigin": "app.modules.revisions.domain",
        "RevisionSourceFormat": "app.modules.revisions.domain",
        "RenderAssetKind": "app.modules.score_assets.domain",
        "PlaybackAssetKind": "app.modules.playback.domain",
        "PlaybackOutboxStatus": "app.modules.playback.domain",
        "ScoreRevisionRenderStatus": "app.modules.revisions.render_states",
        "RevisionMetadataOutboxStatus": "app.modules.metadata.delivery_states",
        "MetadataStatus": "app.modules.metadata.domain",
        "ScoreInputAssetPurpose": "app.modules.scores.domain",
        "ImportArtifactKind": "app.modules.import_jobs.domain",
        "ImportJobState": "app.modules.import_jobs.domain",
        "ImportJobStepStatus": "app.modules.import_jobs.domain",
    }
    seen = set()
    for table in SQLModel.metadata.tables.values():
        for column in table.columns:
            enum = getattr(column.type, "enum_class", None)
            if enum is not None and enum.__name__ in owned:
                assert enum.__module__ == owned[enum.__name__]
                assert getattr(importlib.import_module(enum.__module__), enum.__name__) is enum
                seen.add(enum.__name__)
    from app.db.models import ScoreInputAsset

    purpose = ScoreInputAsset.model_fields["purpose"].annotation
    assert purpose.__module__ == owned["ScoreInputAssetPurpose"]
    assert getattr(importlib.import_module(purpose.__module__), purpose.__name__) is purpose
    seen.add(purpose.__name__)
    assert seen == set(owned)
    for module in set(owned.values()):
        path = Path(importlib.import_module(module).__file__)
        for imported in imported_modules(path, ROOT):
            assert imported.split(".")[0] in sys.stdlib_module_names, (path, imported)
    for path in MODULES.rglob("*.py"):
        for node in ast.walk(ast.parse(path.read_text(encoding="utf-8-sig"))):
            if isinstance(node, ast.ImportFrom) and (node.module or "").startswith("app.db.models"):
                assert not ({name.name for name in node.names} & owned.keys()), path


def test_transport_ownership_and_delivery_contracts():
    from app.db.models import (
        UploadSession,
        Upload,
        UploadCreationRequest,
        PerformanceTakeUploadReservation,
    )
    from app.main import app
    from sqlalchemy import UniqueConstraint

    table = UploadSession.__table__
    assert not {"owner_id", "owner_type"} & set(table.c.keys())
    assert next(iter(table.c.user_id.foreign_keys)).ondelete == "RESTRICT"
    for model in (Upload, UploadCreationRequest, PerformanceTakeUploadReservation):
        foreign = model.__table__.c.upload_session_id
        assert not foreign.nullable
        assert next(iter(foreign.foreign_keys)).target_fullname == "upload_sessions.id"
        assert any(
            isinstance(c, UniqueConstraint)
            and [column.name for column in c.columns] == ["upload_session_id"]
            for c in model.__table__.constraints
        )
    paths = app.openapi()["paths"]
    for path in (
        "/api/v1/scores/{score_id}/revisions/{revision_id}/playback",
        "/api/v1/guest-previews/{token}/playback",
        "/api/v1/performance-takes/{take_id}/playback-url",
    ):
        operation = paths[path]["get"]
        assert set(operation["responses"]["200"]["content"]) == {"application/json"}
        assert not any(
            parameter["name"].lower() == "range" for parameter in operation.get("parameters", [])
        )
    assert set(paths["/api/v1/uploads"]["post"]["requestBody"]["content"]) == {"application/json"}
