"""Application IO scheduling and domain-specific media admission ownership."""

from pathlib import Path

from app.storage import AsyncObjectReader
from app.runtime.customer_api.context import get_context
from tests.support.runtime_resources import storage as object_storage

settings = get_context().settings

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
    from app.runtime.customer_api.routers.uploads.router import create_upload_request
    from app.api.storage_streaming import stream_storage_object

    assert not __import__("inspect").iscoroutinefunction(create_upload_request)
    assert not inspect.iscoroutinefunction(stream_storage_object)
    assert AsyncObjectReader(object_storage)._storage is object_storage


def test_coordinator_exposes_only_independent_write_commands():
    import inspect
    from app.modules.media_storage.write_coordinator import ObjectWriteCoordinator

    for name in ("write_bytes", "write_batch", "copy_object"):
        assert "db" not in inspect.signature(getattr(ObjectWriteCoordinator, name)).parameters


def test_score_upload_admission_uses_the_image_domain_policy_and_session_plan():
    from app.modules.uploads.upload_admission import SCORE_IMPORT_IMAGES

    assert {item.container for item in SCORE_IMPORT_IMAGES} == {
        "PNG",
        "JPEG",
        "BMP",
        "GIF",
        "WEBP",
        "TIFF",
    }
    assert settings.SCORE_IMPORT_MAX_BYTES == 20 * 1024 * 1024
    from app.runtime.customer_api.routers.uploads.router import create_upload_request

    assert not __import__("inspect").iscoroutinefunction(create_upload_request)
