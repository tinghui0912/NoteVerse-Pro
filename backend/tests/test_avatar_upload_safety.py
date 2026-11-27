"""Bounded avatar input and image decoding budgets."""

from tests.support.runtime_resources import resources_for


from io import BytesIO
from unittest.mock import Mock
import struct
import zlib

import pytest
from fastapi import HTTPException, UploadFile
from PIL import Image

from app.modules.account.avatar_service import AvatarService, AvatarFileTooLargeError
from app.runtime.customer_api.routers.account.router import upload_avatar
from tests.support.object_storage import InMemoryObjectStorage
from app.runtime.customer_api.context import get_context
from app.platform.config.storage import MediaStoragePolicyConfig

settings = get_context().settings


def png() -> bytes:
    output = BytesIO()
    Image.new("RGB", (24, 24), "red").save(output, "PNG")
    return output.getvalue()


@pytest.mark.parametrize("size", [None, 5 * 1024 * 1024])
def test_avatar_accepts_bounded_bytes_and_normalizes_jpeg(size):
    service = AvatarService(
        writes=resources_for(InMemoryObjectStorage()).build_object_write_coordinator(),
        delivery=resources_for(InMemoryObjectStorage()).build_media_delivery_service(),
        config=MediaStoragePolicyConfig.model_validate(get_context().settings.model_dump()),
    )
    data = png()
    if size:
        data += b"\0" * (size - len(data))
    content = service.read_upload(BytesIO(data))
    key, result = service.process_avatar(content, "photo.png", 1)
    assert key.startswith("avatars/") and key.endswith(".jpg")
    with Image.open(BytesIO(result)) as image:
        assert image.format == "JPEG" and image.mode == "RGB" and image.size == (200, 200)


def test_oversized_avatar_stops_after_one_sentinel_byte_and_returns_413():
    class Stream(BytesIO):
        def read(self, size=-1):
            assert 0 < size <= 64 * 1024
            return super().read(size)

    stream = Stream(b"x" * (settings.AVATAR_MAX_UPLOAD_BYTES + 1024 * 1024))
    service = AvatarService(
        writes=resources_for(InMemoryObjectStorage()).build_object_write_coordinator(),
        delivery=resources_for(InMemoryObjectStorage()).build_media_delivery_service(),
        config=MediaStoragePolicyConfig.model_validate(get_context().settings.model_dump()),
    )
    service.replace_user_avatar = Mock()
    with pytest.raises(HTTPException) as raised:
        upload_avatar(UploadFile(stream, filename="large.png"), Mock(), Mock(), service)
    assert raised.value.status_code == 413
    assert stream.tell() == settings.AVATAR_MAX_UPLOAD_BYTES + 1
    service.replace_user_avatar.assert_not_called()


def test_http_avatar_rejects_input_larger_than_budget():
    from tests.support.browser import BrowserTestClient as TestClient
    from app.runtime.customer_api.main import create_app
    from app.platform.db.dependencies import get_db
    from app.runtime.customer_api.deps import get_current_user
    from app.runtime.customer_api.resources import get_avatar_service

    app = create_app()
    service = AvatarService(
        writes=resources_for(InMemoryObjectStorage()).build_object_write_coordinator(),
        delivery=resources_for(InMemoryObjectStorage()).build_media_delivery_service(),
        config=MediaStoragePolicyConfig.model_validate(get_context().settings.model_dump()),
    )
    service.replace_user_avatar = Mock()
    app.dependency_overrides[get_current_user] = lambda: Mock()
    app.dependency_overrides[get_db] = lambda: Mock()
    app.dependency_overrides[get_avatar_service] = lambda: service
    with TestClient(app) as client:
        response = client.post(
            "/api/v1/me/avatar",
            files={
                "file": ("photo.png", b"x" * (settings.AVATAR_MAX_UPLOAD_BYTES + 1), "image/png")
            },
        )
    assert response.status_code == 413
    service.replace_user_avatar.assert_not_called()


@pytest.mark.parametrize("data", [b"", b"not an image", png()[:40]])
def test_corrupt_images_fail_closed(data):
    with pytest.raises(ValueError):
        AvatarService(
            writes=resources_for(InMemoryObjectStorage()).build_object_write_coordinator(),
            delivery=resources_for(InMemoryObjectStorage()).build_media_delivery_service(),
            config=MediaStoragePolicyConfig.model_validate(get_context().settings.model_dump()),
        ).process_avatar(data, "photo.png", 1)


@pytest.mark.parametrize("width,height", [(5000, 5000), (9000, 1), (100000, 100000)])
def test_image_header_exceeding_decode_budget_is_rejected_before_load(width, height, monkeypatch):
    data = bytearray(png())
    data[16:24] = struct.pack(">II", width, height)
    data[29:33] = struct.pack(">I", zlib.crc32(data[12:29]))
    monkeypatch.setattr(
        "PIL.PngImagePlugin.PngImageFile.load", Mock(side_effect=AssertionError("decode"))
    )
    with pytest.raises(ValueError):
        AvatarService(
            writes=resources_for(InMemoryObjectStorage()).build_object_write_coordinator(),
            delivery=resources_for(InMemoryObjectStorage()).build_media_delivery_service(),
            config=MediaStoragePolicyConfig.model_validate(get_context().settings.model_dump()),
        ).process_avatar(bytes(data), "photo.png", 1)


def test_stream_limit_uses_injected_configuration(monkeypatch):
    monkeypatch.setattr(settings, "AVATAR_MAX_UPLOAD_BYTES", 16)
    with pytest.raises(AvatarFileTooLargeError):
        AvatarService(
            writes=resources_for(InMemoryObjectStorage()).build_object_write_coordinator(),
            delivery=resources_for(InMemoryObjectStorage()).build_media_delivery_service(),
            config=MediaStoragePolicyConfig.model_validate(get_context().settings.model_dump()),
        ).read_upload(BytesIO(b"x" * 17))
