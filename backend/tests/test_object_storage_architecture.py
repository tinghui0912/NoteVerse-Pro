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
    for directory in ("modules", "worker", "pipeline", "api"):
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
    assert set(SQLModel.metadata.tables["media_blobs"].columns.keys()) == {
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
        for c in SQLModel.metadata.tables["media_blobs"].constraints
    )
