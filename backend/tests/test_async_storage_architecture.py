"""Application IO scheduling and domain-specific media admission ownership."""

import ast
from pathlib import Path

from app.core.config import Settings
from app.storage import AsyncObjectStorage, async_object_storage, object_storage

ROOT = Path(__file__).resolve().parents[1] / "app"
PROVIDER_IO = {
    "put_bytes",
    "exists",
    "read_bytes",
    "size_bytes",
    "object_metadata",
    "copy",
    "delete",
    "download_url",
    "upload_url",
    "materialize_to_local",
    "iter_bytes",
}


def test_async_application_provider_calls_use_the_async_port():
    callers = set()
    for path in ROOT.rglob("*.py"):
        if "storage" == path.parent.name:
            continue  # Infrastructure implements the scheduling boundary.
        tree = ast.parse(path.read_text(encoding="utf-8-sig"))
        parents = {child: node for node in ast.walk(tree) for child in ast.iter_child_nodes(node)}
        for node in ast.walk(tree):
            if (
                not isinstance(node, ast.Call)
                or not isinstance(node.func, ast.Attribute)
                or node.func.attr not in PROVIDER_IO
            ):
                continue
            receiver = ast.unparse(node.func.value)
            if "storage" not in receiver:
                continue
            parent = node
            while parent in parents:
                parent = parents[parent]
                if isinstance(parent, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    break
            if not isinstance(parent, ast.AsyncFunctionDef):
                continue
            callers.add(path.relative_to(ROOT).as_posix())
            if receiver == "storage":
                arg = next(
                    arg for arg in parent.args.args + parent.args.kwonlyargs if arg.arg == "storage"
                )
                assert ast.unparse(arg.annotation) == "AsyncObjectStorage", (path, node.lineno)
            else:
                assert receiver.endswith(".async_storage"), (path, node.lineno)
    assert {"modules/account/router.py", "api/storage_streaming.py"} <= callers
    assert isinstance(async_object_storage, AsyncObjectStorage)
    assert async_object_storage._storage is object_storage


def test_async_prewrite_uses_shared_admission_and_threaded_physical_io():
    tree = ast.parse((ROOT / "modules/storage_objects/writes.py").read_text())
    writer = next(
        node
        for node in tree.body
        if isinstance(node, ast.AsyncFunctionDef) and node.name == "write_object_async"
    )
    calls = [ast.unparse(node.func) for node in ast.walk(writer) if isinstance(node, ast.Call)]
    assert {"prepare_object_write", "inspect_write", "finalize_write", "storage.put_bytes"} <= set(
        calls
    )
    for node in ast.walk(writer):
        if isinstance(node, ast.Lambda):
            assert not any(
                isinstance(call, ast.Call)
                and isinstance(call.func, ast.Attribute)
                and call.func.attr in PROVIDER_IO
                for call in ast.walk(node)
            )


def test_score_upload_admission_is_application_owned_and_domain_specific():
    from app.modules.files.upload_admission import (
        SCORE_IMPORT_IMAGES,
        MAX_SCORE_IMPORT_UPLOAD_BYTES,
    )
    from app.modules.account.avatar_service import AvatarService

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
    assert AvatarService.MAX_FILE_SIZE == 5 * 1024 * 1024
    source = (ROOT / "modules/files/service.py").read_text()
    assert (
        "admit_score_import_image" in source
        and "media.mime_type" in source
        and "media.extension" in source
    )
    assert not any(
        isinstance(node, ast.Attribute) and node.attr == "content_type"
        for node in ast.walk(ast.parse(source))
    )
