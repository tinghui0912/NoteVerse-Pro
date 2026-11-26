"""Application IO scheduling and domain-specific media admission ownership."""

import ast
from pathlib import Path

from app.core.config import Settings
from app.storage import AsyncObjectReader, object_storage

ROOT = Path(__file__).resolve().parents[1] / "app"
PROVIDER_IO = {
    "put_bytes",
    "exists",
    "read_bytes",
    "object_metadata",
    "copy",
    "delete",
    "download_url",
    "generate_put_upload_url",
    "iter_bytes",
}


def test_database_backed_delivery_executes_in_synchronous_http_operations():
    import inspect
    from app.modules.uploads.router import create_upload
    from app.api.storage_streaming import stream_storage_object

    assert not inspect.iscoroutinefunction(create_upload)
    assert not inspect.iscoroutinefunction(stream_storage_object)
    assert AsyncObjectReader(object_storage)._storage is object_storage


def test_object_write_protocol_uses_exact_generation_admission():
    tree = ast.parse((ROOT / "modules/storage_objects/writes.py").read_text())
    writer = next(
        node
        for node in tree.body
        if isinstance(node, ast.FunctionDef) and node.name == "write_object"
    )
    calls = {ast.unparse(node.func) for node in ast.walk(writer) if isinstance(node, ast.Call)}
    assert {"prepare_object_write", "perform_write"} <= calls
    physical = next(
        node
        for node in tree.body
        if isinstance(node, ast.FunctionDef) and node.name == "perform_write"
    )
    physical_calls = {
        ast.unparse(node.func) for node in ast.walk(physical) if isinstance(node, ast.Call)
    }
    assert {"inspect_write", "finalize_write", "storage.put_bytes", "db.commit"} <= physical_calls


def test_score_upload_admission_is_application_owned_and_domain_specific():
    from app.modules.uploads.upload_admission import (
        SCORE_IMPORT_IMAGES,
        MAX_SCORE_IMPORT_UPLOAD_BYTES,
    )
    from app.core.config import settings

    assert {item.container for item in SCORE_IMPORT_IMAGES} == {
        "PNG",
        "JPEG",
        "BMP",
        "GIF",
        "WEBP",
        "TIFF",
    }
    assert MAX_SCORE_IMPORT_UPLOAD_BYTES == 20 * 1024 * 1024
    assert "ALLOWED_EXTENSIONS" not in Settings.model_fields
    assert settings.AVATAR_MAX_UPLOAD_BYTES == 5 * 1024 * 1024
    source = (ROOT / "modules/uploads/service.py").read_text()
    assert (
        "admit_score_import_image" in source
        and "media.mime_type" in source
        and "media.extension" in source
    )
    assert not any(
        isinstance(node, ast.Attribute) and node.attr == "content_type"
        for node in ast.walk(ast.parse(source))
    )
