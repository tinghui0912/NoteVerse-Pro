"""Durable object capability ownership and one deployment namespace."""

import ast
from pathlib import Path
from typing import get_type_hints
from app.storage.base import ObjectStorage, DirectUploadTarget
from sqlmodel import SQLModel
import app.db.models  # noqa: F401

ROOT = Path(__file__).parents[1] / "app"


def test_application_depends_on_storage_port_and_composition_only():
    allowed = {"app.storage", "app.storage.base", "app.storage.factory", "app.storage.paths"}
    for directory in ("modules", "worker", "api"):
        for path in (ROOT / directory).rglob("*.py"):
            for node in ast.walk(ast.parse(path.read_text(encoding="utf-8-sig"))):
                if isinstance(node, ast.ImportFrom) and (node.module or "").startswith(
                    "app.storage"
                ):
                    assert node.module in allowed, path
                if isinstance(node, ast.ImportFrom):
                    assert not (node.module or "").startswith(
                        ("boto3", "botocore", "alibabacloud_oss_v2")
                    ), path
                if isinstance(node, ast.Import):
                    assert not any(
                        x.name.startswith(("boto3", "botocore", "alibabacloud_oss_v2"))
                        for x in node.names
                    ), path


def test_one_object_namespace_and_required_direct_upload():
    assert get_type_hints(ObjectStorage.upload_url)["return"] is DirectUploadTarget
    assert set(SQLModel.metadata.tables["stored_objects"].columns.keys()) == {
        "id",
        "object_key",
        "byte_size",
        "sha256",
        "content_type",
        "created_at",
    }
    for table in SQLModel.metadata.tables.values():
        assert "storage_backend" not in table.columns, table.name
    from sqlalchemy import UniqueConstraint

    assert any(
        isinstance(c, UniqueConstraint) and [x.name for x in c.columns] == ["object_key"]
        for c in SQLModel.metadata.tables["stored_objects"].constraints
    )


def test_capability_surface_and_write_observation():
    from dataclasses import fields, FrozenInstanceError
    import pytest
    from app.storage.base import ObjectWriteResult
    from app.storage.s3_compatible import S3CompatibleObjectStorage
    from tests.support.object_storage import InMemoryObjectStorage

    expected = {
        "put_bytes",
        "exists",
        "read_bytes",
        "size_bytes",
        "object_metadata",
        "upload_url",
        "iter_bytes",
        "copy",
        "delete",
        "download_url",
        "materialize_to_local",
    }

    def public_operations(owner):
        return {
            name
            for name, value in vars(owner).items()
            if not name.startswith("_") and callable(value)
        }

    assert public_operations(ObjectStorage) == expected
    assert public_operations(S3CompatibleObjectStorage) == expected
    assert public_operations(InMemoryObjectStorage) == expected
    assert set(vars(S3CompatibleObjectStorage())) == {
        "bucket",
        "endpoint_url",
        "region",
        "_client",
        "_signing_client",
    }
    assert [f.name for f in fields(ObjectWriteResult)] == ["object_key", "size_bytes"]
    written = ObjectWriteResult("objects/one", 3)
    with pytest.raises(FrozenInstanceError):
        written.object_key = "objects/two"
