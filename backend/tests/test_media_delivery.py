"""Delivery mode selection, provider offload and HTTP response contracts."""

from dataclasses import asdict, FrozenInstanceError
from unittest.mock import Mock

from fastapi import FastAPI
from fastapi.testclient import TestClient
import pytest

from app.api.media_delivery import deliver_media_object
from app.modules.media_storage.delivery import DeliveryMode, DeliveryPolicy, MediaDeliveryService
from app.modules.media_storage.reads import StoredObjectDelivery
from tests.support.object_storage import InMemoryObjectStorage


def service():
    storage = InMemoryObjectStorage()
    return storage, MediaDeliveryService(storage, DeliveryPolicy(900, 3600, 20 * 1024 * 1024))


@pytest.mark.parametrize("media_type", ["audio/webm", "video/mp4"])
def test_large_media_defaults_to_signed_delivery_without_reading_bytes(media_type):
    storage, delivery = service()
    storage.download_url = Mock(return_value="https://cdn.example/capability")
    storage.iter_bytes = Mock(side_effect=AssertionError("Application media proxy"))
    target = StoredObjectDelivery(1, "objects/opaque", 100 * 1024 * 1024, media_type, "recording")
    result = delivery.deliver(target)
    assert result.mode == DeliveryMode.SIGNED_REDIRECT
    assert result.location == "https://cdn.example/capability"
    assert result.cache_control == "private, max-age=900, immutable"
    assert set(asdict(result)) == {"mode", "location", "cache_control"}
    storage.iter_bytes.assert_not_called()
    with pytest.raises(ValueError, match="signed"):
        delivery.deliver(target, mode=DeliveryMode.CONTROLLED_STREAM)


def test_public_immutable_target_and_attachment_are_signed_by_policy():
    storage, delivery = service()
    storage.download_url = Mock(return_value="https://cdn.example/avatar")
    target = StoredObjectDelivery(1, "avatars/opaque.jpg", 10, "image/jpeg", "avatar.jpg")
    result = delivery.deliver(target, public=True, attachment=True)
    assert result.cache_control == "public, max-age=900, immutable"
    storage.download_url.assert_called_once_with(
        "avatars/opaque.jpg", filename="avatar.jpg", content_type="image/jpeg", expires_seconds=900
    )
    with pytest.raises(FrozenInstanceError):
        result.location = "https://other.example"


def test_controlled_response_streams_authorized_small_bytes_without_caching():
    storage, delivery = service()
    storage.put_bytes(key="private/source", content=b"score", content_type="application/xml")
    target = StoredObjectDelivery(1, "private/source", 5, "application/xml", "source.musicxml")
    app = FastAPI()

    @app.get("/authorized-source")
    def read():
        return deliver_media_object(
            service=delivery, target=target, mode=DeliveryMode.CONTROLLED_STREAM, attachment=True
        )

    with TestClient(app) as client:
        response = client.get("/authorized-source")
    assert response.status_code == 200 and response.content == b"score"
    assert response.headers["cache-control"] == "private, no-store"
    assert response.headers["content-length"] == "5"


def test_signed_http_response_redirects_without_proxying_body():
    storage, delivery = service()
    storage.read_bytes = Mock(side_effect=AssertionError("Read body"))
    target = StoredObjectDelivery(1, "opaque/video", 100 * 1024 * 1024, "video/mp4", "video.mp4")
    response = deliver_media_object(
        service=delivery, target=target, mode=DeliveryMode.SIGNED_REDIRECT, attachment=False
    )
    assert response.status_code == 307
    assert response.headers["location"].startswith("https://objects.example/")
    storage.read_bytes.assert_not_called()


@pytest.mark.parametrize("values", [(0, 1, 1), (1, 0, 1), (1, 1, 0)])
def test_policy_rejects_nonpositive_limits(values):
    with pytest.raises(ValueError):
        DeliveryPolicy(*values)
